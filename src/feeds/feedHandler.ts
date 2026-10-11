import {
  CanonicalMoney,
  createCanonicalMoney,
  CurrencyCode,
  CURRENCY_REGISTRY,
  validateIso8601UtcTimestamp,
  parseCanonicalStreamSequence,
  CanonicalStreamSequence
} from '../canonical/domain.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256 } from '../canonical/crypto.js';

export interface RawMarketDataMessage {
  message_id: string;
  venue_id: string;
  raw_symbol: string;
  sequence: number | string;
  timestamp_utc: string;
  bid_price: string;
  bid_quantity: number;
  ask_price: string;
  ask_quantity: number;
  currency?: CurrencyCode;
  feed_status?: 'ACTIVE' | 'HALTED' | 'SUSPENDED';
}

export interface FeedEvidenceProvenance {
  source_id: string;
  observed_at_utc: string;
  ingested_at_utc: string;
  is_authenticated_source_feed: true;
}

export interface NormalizedMarketFeedEvent {
  event_id: string;
  venue_id: string;
  product_id: string;
  stream_sequence: CanonicalStreamSequence;
  occurred_at_utc: string;
  ingested_at_utc: string;
  bid_price: CanonicalMoney;
  ask_price: CanonicalMoney;
  bid_quantity: number;
  ask_quantity: number;
  feed_status: 'ACTIVE' | 'HALTED' | 'STALE';
  provenance: FeedEvidenceProvenance;
  event_sha256: string;
}

export type FeedIngestionOutcome =
  | 'ACCEPTED'
  | 'DUPLICATE_IGNORED'
  | 'OUT_OF_ORDER_REJECTED'
  | 'GAP_DETECTED'
  | 'INVALID_FORMAT';

export interface FeedIngestionResult {
  outcome: FeedIngestionOutcome;
  stream_key: string;
  expected_sequence: string;
  received_sequence: string;
  event?: NormalizedMarketFeedEvent;
  gap_size?: number;
  reason?: string;
}

/**
 * Parses decimal string into canonical subunits string for target scale
 * E.g., "115.50" with scale 4 -> "1155000"
 */
export function parseDecimalPriceToSubunits(decimalStr: string, targetScale: number): string {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(decimalStr)) {
    throw new Error(`E-ERR-024: INVALID_PRICE_FORMAT: Price '${decimalStr}' is not a valid non-negative decimal string`);
  }
  const parts = decimalStr.split('.');
  const intPart = parts[0];
  const fracPart = parts[1] || '';
  const paddedFrac = fracPart.padEnd(targetScale, '0').slice(0, targetScale);
  const combined = intPart + paddedFrac;
  return combined.replace(/^0+(?=\d)/, '') || '0';
}

export class MarketFeedHandler {
  private sequenceMap: Map<string, bigint> = new Map();
  private latestFeedMap: Map<string, NormalizedMarketFeedEvent> = new Map();
  private replayBuffer: Map<string, Map<string, NormalizedMarketFeedEvent>> = new Map();
  private symbolMapping: Map<string, string> = new Map();
  private clockSkewToleranceMs: number;
  private maxReplayBufferSize: number;

  constructor(options?: { clockSkewToleranceMs?: number; maxReplayBufferSize?: number }) {
    this.clockSkewToleranceMs = options?.clockSkewToleranceMs ?? 5_000;
    this.maxReplayBufferSize = options?.maxReplayBufferSize ?? 1_000;
  }

  public registerSymbolMapping(venue_id: string, raw_symbol: string, canonical_product_id: string): void {
    const key = `${venue_id}:${raw_symbol}`;
    this.symbolMapping.set(key, canonical_product_id);
  }

  public getCanonicalProductId(venue_id: string, raw_symbol: string): string {
    const key = `${venue_id}:${raw_symbol}`;
    const product_id = this.symbolMapping.get(key);
    if (!product_id) {
      throw new Error(`E-ERR-024: UNMAPPED_RAW_SYMBOL: No canonical product mapping for venue '${venue_id}' symbol '${raw_symbol}'`);
    }
    return product_id;
  }

  public ingestRawMessage(raw: RawMarketDataMessage, ingested_at_utc: string): FeedIngestionResult {
    validateIso8601UtcTimestamp(raw.timestamp_utc);
    validateIso8601UtcTimestamp(ingested_at_utc);

    const occurredMs = Date.parse(raw.timestamp_utc);
    const ingestedMs = Date.parse(ingested_at_utc);

    if (occurredMs - ingestedMs > this.clockSkewToleranceMs) {
      return {
        outcome: 'INVALID_FORMAT',
        stream_key: `${raw.venue_id}:${raw.raw_symbol}`,
        expected_sequence: '0',
        received_sequence: String(raw.sequence),
        reason: `E-ERR-023: CLOCK_SKEW_EXCEEDED: Event timestamp is in future by ${occurredMs - ingestedMs}ms (tolerance ${this.clockSkewToleranceMs}ms)`
      };
    }

    let product_id: string;
    try {
      product_id = this.getCanonicalProductId(raw.venue_id, raw.raw_symbol);
    } catch (err: any) {
      return {
        outcome: 'INVALID_FORMAT',
        stream_key: `${raw.venue_id}:${raw.raw_symbol}`,
        expected_sequence: '0',
        received_sequence: String(raw.sequence),
        reason: err.message
      };
    }

    const streamKey = `${raw.venue_id}:${product_id}`;
    const rawSeq = BigInt(raw.sequence);
    let expectedSeq = this.sequenceMap.get(streamKey);

    if (expectedSeq === undefined) {
      // Initialize stream sequence head to first received message sequence
      expectedSeq = rawSeq;
    }

    if (rawSeq < expectedSeq) {
      return {
        outcome: 'DUPLICATE_IGNORED',
        stream_key: streamKey,
        expected_sequence: expectedSeq.toString(),
        received_sequence: rawSeq.toString(),
        reason: 'Received sequence is strictly lower than expected stream head'
      };
    }

    if (rawSeq > expectedSeq) {
      return {
        outcome: 'GAP_DETECTED',
        stream_key: streamKey,
        expected_sequence: expectedSeq.toString(),
        received_sequence: rawSeq.toString(),
        gap_size: Number(rawSeq - expectedSeq),
        reason: `Sequence gap detected: expected ${expectedSeq}, received ${rawSeq}`
      };
    }

    // rawSeq === expectedSeq: Normal in-order ingestion
    const currency: CurrencyCode = raw.currency ?? 'INR';
    const def = CURRENCY_REGISTRY[currency];
    const bidSubunits = parseDecimalPriceToSubunits(raw.bid_price, def.internal_accounting_scale);
    const askSubunits = parseDecimalPriceToSubunits(raw.ask_price, def.internal_accounting_scale);

    const bid_price = createCanonicalMoney(bidSubunits, currency, def.internal_accounting_scale);
    const ask_price = createCanonicalMoney(askSubunits, currency, def.internal_accounting_scale);

    const eventPayload = {
      event_id: `feed:${raw.venue_id}:${product_id}:${rawSeq.toString()}`,
      venue_id: raw.venue_id,
      product_id,
      stream_sequence: parseCanonicalStreamSequence(rawSeq.toString()),
      occurred_at_utc: raw.timestamp_utc,
      ingested_at_utc,
      bid_price,
      ask_price,
      bid_quantity: raw.bid_quantity,
      ask_quantity: raw.ask_quantity,
      feed_status: (raw.feed_status === 'HALTED' ? 'HALTED' : 'ACTIVE') as 'ACTIVE' | 'HALTED' | 'STALE',
      provenance: {
        source_id: `venue:${raw.venue_id}`,
        observed_at_utc: raw.timestamp_utc,
        ingested_at_utc,
        is_authenticated_source_feed: true as const
      }
    };

    const canonicalBytes = Buffer.from(canonicalizeJCS(eventPayload), 'utf8');
    const event_sha256 = sha256(canonicalBytes);

    const normalizedEvent: NormalizedMarketFeedEvent = {
      ...eventPayload,
      event_sha256
    };

    // Advance sequence head
    this.sequenceMap.set(streamKey, expectedSeq + 1n);
    this.latestFeedMap.set(streamKey, normalizedEvent);

    // Record in replay buffer
    if (!this.replayBuffer.has(streamKey)) {
      this.replayBuffer.set(streamKey, new Map());
    }
    const streamBuffer = this.replayBuffer.get(streamKey)!;
    streamBuffer.set(rawSeq.toString(), normalizedEvent);
    if (streamBuffer.size > this.maxReplayBufferSize) {
      const oldestKey = streamBuffer.keys().next().value;
      if (oldestKey !== undefined) streamBuffer.delete(oldestKey);
    }

    return {
      outcome: 'ACCEPTED',
      stream_key: streamKey,
      expected_sequence: (expectedSeq + 1n).toString(),
      received_sequence: rawSeq.toString(),
      event: normalizedEvent
    };
  }

  public replayAndSync(messages: RawMarketDataMessage[], ingested_at_utc: string): FeedIngestionResult[] {
    const sorted = [...messages].sort((a, b) => {
      const diff = BigInt(a.sequence) - BigInt(b.sequence);
      return diff < 0n ? -1 : diff > 0n ? 1 : 0;
    });

    const results: FeedIngestionResult[] = [];
    for (const msg of sorted) {
      results.push(this.ingestRawMessage(msg, ingested_at_utc));
    }
    return results;
  }

  public getLatestEvent(venue_id: string, product_id: string): NormalizedMarketFeedEvent | null {
    const streamKey = `${venue_id}:${product_id}`;
    return this.latestFeedMap.get(streamKey) || null;
  }

  public isEventFresh(event: NormalizedMarketFeedEvent, current_time_utc: string, maxAgeMs: number = 300_000): boolean {
    validateIso8601UtcTimestamp(current_time_utc);
    const currentMs = Date.parse(current_time_utc);
    const eventMs = Date.parse(event.occurred_at_utc);
    const ageMs = currentMs - eventMs;
    return ageMs >= 0 && ageMs <= maxAgeMs && event.feed_status === 'ACTIVE';
  }

  public getExpectedSequence(venue_id: string, product_id: string): string | null {
    const streamKey = `${venue_id}:${product_id}`;
    const seq = this.sequenceMap.get(streamKey);
    return seq !== undefined ? seq.toString() : null;
  }
}
