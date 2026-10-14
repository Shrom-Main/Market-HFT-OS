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
  is_authenticated_source_feed?: boolean;
}

export type NormalizedFeedStatus = 'ACTIVE' | 'HALTED' | 'SUSPENDED' | 'STALE';

export interface FeedEvidenceProvenance {
  source_id: string;
  observed_at_utc: string;
  ingested_at_utc: string;
  is_authenticated_source_feed: boolean;
  adapter_mode: 'SIMULATED_TEST' | 'AUTHENTICATED_FEED';
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
  feed_status: NormalizedFeedStatus;
  provenance: FeedEvidenceProvenance;
  event_sha256: string;
}

export type FeedIngestionOutcome =
  | 'ACCEPTED'
  | 'DUPLICATE_IGNORED'
  | 'OUT_OF_ORDER_REJECTED'
  | 'GAP_DETECTED'
  | 'INVALID_FORMAT'
  | 'BUFFER_OVERFLOW';

export interface FeedIngestionResult {
  outcome: FeedIngestionOutcome;
  stream_key: string;
  expected_sequence: string;
  received_sequence: string;
  event?: NormalizedMarketFeedEvent;
  gap_size?: number;
  reason?: string;
  drained_sequences?: string[];
}

/**
 * Parses decimal string into canonical subunits string for target scale.
 * Strictly verifies decimal precision to prevent silent truncation.
 * Excess nonzero fractional digits are rejected fail-closed.
 * Extra trailing zeros are safely accepted.
 * E.g., "115.50" with scale 4 -> "1155000"
 * E.g., "115.50000" with scale 4 -> "1155000"
 * E.g., "115.50001" with scale 4 -> throws UNSUPPORTED_PRICE_PRECISION
 */
export function parseDecimalPriceToSubunits(decimalStr: string, targetScale: number): string {
  if (typeof decimalStr !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(decimalStr)) {
    throw new Error(`E-ERR-024: INVALID_PRICE_FORMAT: Price '${decimalStr}' is not a valid non-negative decimal string`);
  }
  const parts = decimalStr.split('.');
  const intPart = parts[0];
  const fracPart = parts[1] || '';

  if (fracPart.length > targetScale) {
    const excess = fracPart.slice(targetScale);
    if (/[^0]/.test(excess)) {
      throw new Error(`E-ERR-024: UNSUPPORTED_PRICE_PRECISION: Price '${decimalStr}' exceeds target scale ${targetScale} with non-zero excess digits '${excess}'`);
    }
  }

  const paddedFrac = fracPart.padEnd(targetScale, '0').slice(0, targetScale);
  const combined = intPart + paddedFrac;
  return combined.replace(/^0+(?=\d)/, '') || '0';
}

export class MarketFeedHandler {
  private sequenceMap: Map<string, bigint> = new Map();
  private latestFeedMap: Map<string, NormalizedMarketFeedEvent> = new Map();
  private replayBuffer: Map<string, Map<string, NormalizedMarketFeedEvent>> = new Map();
  private pendingGapBuffer: Map<string, Map<string, RawMarketDataMessage>> = new Map();
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

    const seqStr = String(raw.sequence);
    if (!/^\d+$/.test(seqStr)) {
      return {
        outcome: 'INVALID_FORMAT',
        stream_key: `${raw.venue_id}:${raw.raw_symbol}`,
        expected_sequence: '0',
        received_sequence: seqStr,
        reason: 'E-ERR-024: INVALID_SEQUENCE_FORMAT: Sequence must be a non-negative integer string'
      };
    }
    const rawSeq = BigInt(seqStr);

    if (!Number.isSafeInteger(raw.bid_quantity) || raw.bid_quantity <= 0 ||
        !Number.isSafeInteger(raw.ask_quantity) || raw.ask_quantity <= 0) {
      return {
        outcome: 'INVALID_FORMAT',
        stream_key: `${raw.venue_id}:${raw.raw_symbol}`,
        expected_sequence: '0',
        received_sequence: seqStr,
        reason: 'E-ERR-024: INVALID_QUANTITY: Bid and ask quantities must be positive safe integers'
      };
    }

    const streamKey = `${raw.venue_id}:${product_id}`;
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
      // Buffer future message received during gap
      if (!this.pendingGapBuffer.has(streamKey)) {
        this.pendingGapBuffer.set(streamKey, new Map());
      }
      const gapMap = this.pendingGapBuffer.get(streamKey)!;
      if (gapMap.size >= this.maxReplayBufferSize) {
        return {
          outcome: 'BUFFER_OVERFLOW',
          stream_key: streamKey,
          expected_sequence: expectedSeq.toString(),
          received_sequence: rawSeq.toString(),
          reason: 'E-ERR-024: GAP_BUFFER_OVERFLOW: Pending gap buffer exceeded maximum capacity'
        };
      }
      gapMap.set(rawSeq.toString(), raw);

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
    if (!def) {
      return {
        outcome: 'INVALID_FORMAT',
        stream_key: streamKey,
        expected_sequence: expectedSeq.toString(),
        received_sequence: rawSeq.toString(),
        reason: `E-ERR-010: INVALID_CURRENCY: Unsupported currency code '${currency}'`
      };
    }

    let bidSubunits: string;
    let askSubunits: string;
    try {
      bidSubunits = parseDecimalPriceToSubunits(raw.bid_price, def.internal_accounting_scale);
      askSubunits = parseDecimalPriceToSubunits(raw.ask_price, def.internal_accounting_scale);
    } catch (err: any) {
      return {
        outcome: 'INVALID_FORMAT',
        stream_key: streamKey,
        expected_sequence: expectedSeq.toString(),
        received_sequence: rawSeq.toString(),
        reason: `E-ERR-024: INVALID_PRICE_FORMAT: ${err.message}`
      };
    }

    if (BigInt(bidSubunits) <= 0n || BigInt(askSubunits) <= 0n || BigInt(bidSubunits) > BigInt(askSubunits)) {
      return {
        outcome: 'INVALID_FORMAT',
        stream_key: streamKey,
        expected_sequence: expectedSeq.toString(),
        received_sequence: rawSeq.toString(),
        reason: 'E-ERR-024: INVALID_MARKET_PRICES: Bid and ask prices must be positive and non-crossed'
      };
    }

    const bid_price = createCanonicalMoney(bidSubunits, currency, def.internal_accounting_scale);
    const ask_price = createCanonicalMoney(askSubunits, currency, def.internal_accounting_scale);

    // Explicit feed status mapping (SUSPENDED must never map to ACTIVE)
    let feed_status: NormalizedFeedStatus;
    if (raw.feed_status === 'HALTED') {
      feed_status = 'HALTED';
    } else if (raw.feed_status === 'SUSPENDED') {
      feed_status = 'SUSPENDED';
    } else if (raw.feed_status === 'ACTIVE' || raw.feed_status === undefined) {
      feed_status = 'ACTIVE';
    } else {
      feed_status = 'HALTED'; // Fail-closed
    }

    const isAuthenticated = raw.is_authenticated_source_feed === true;
    const adapterMode: 'AUTHENTICATED_FEED' | 'SIMULATED_TEST' = isAuthenticated ? 'AUTHENTICATED_FEED' : 'SIMULATED_TEST';

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
      feed_status,
      provenance: {
        source_id: `venue:${raw.venue_id}`,
        observed_at_utc: raw.timestamp_utc,
        ingested_at_utc,
        is_authenticated_source_feed: isAuthenticated,
        adapter_mode: adapterMode
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

    // Automatically drain any consecutive buffered pending gap messages
    const drainedSequences: string[] = [];
    const pending = this.pendingGapBuffer.get(streamKey);
    if (pending) {
      let nextExpected = expectedSeq + 1n;
      while (pending.has(nextExpected.toString())) {
        const nextMsg = pending.get(nextExpected.toString())!;
        pending.delete(nextExpected.toString());
        drainedSequences.push(nextExpected.toString());
        // Ingest the previously buffered future message exactly once
        this.ingestRawMessage(nextMsg, ingested_at_utc);
        nextExpected = this.sequenceMap.get(streamKey)!;
      }
    }

    return {
      outcome: 'ACCEPTED',
      stream_key: streamKey,
      expected_sequence: this.sequenceMap.get(streamKey)!.toString(),
      received_sequence: rawSeq.toString(),
      event: this.latestFeedMap.get(streamKey),
      drained_sequences: drainedSequences.length > 0 ? drainedSequences : undefined
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

  public getPendingGapCount(venue_id: string, product_id: string): number {
    const streamKey = `${venue_id}:${product_id}`;
    const pending = this.pendingGapBuffer.get(streamKey);
    return pending ? pending.size : 0;
  }
}
