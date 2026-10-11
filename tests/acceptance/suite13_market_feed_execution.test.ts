import { describe, it, expect } from 'vitest';
import {
  MarketFeedHandler,
  RawMarketDataMessage,
  parseDecimalPriceToSubunits
} from '../../src/feeds/feedHandler.js';
import {
  SimulatedStreamingMarketFeedAdapter
} from '../../src/feeds/streamingAdapter.js';
import {
  DryRunExecutionEngine,
  ExecutionIntent
} from '../../src/execution/engine.js';
import {
  SimulatedExecutionGateway
} from '../../src/execution/simulatedGateway.js';
import {
  CanonicalOffer,
  createCanonicalMoney
} from '../../src/canonical/domain.js';
import { sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import { enforceActualsLedgerWrite } from '../../src/ledger/actualsGuard.js';

describe('SUITE-13: Gate M2 Market Feed Normalization, Streaming Adapter & Simulated Execution Gateway', () => {
  const venueId = 'VENUE_NSE_COMMERCIAL';
  const rawSymbol = 'DIN3017-W4-16-25';
  const canonicalProductId = 'prod:din3017:16-25mm';
  const offerId = 'off:din3017:sup-01:2026-q4';

  const sampleOffer: CanonicalOffer = {
    offer_id: offerId,
    product_id: canonicalProductId,
    unit_price: createCanonicalMoney('1050000', 'INR', 4), // 105.0000 INR
    minimum_order_quantity: 10,
    available_quantity: 100,
    payment_terms_days: 30,
    incoterms: 'EXW',
    valid_until_utc: '2026-12-31T00:00:00Z',
    offer_status: 'VERIFIED_EXECUTABLE_OFFER',
    verification_status: 'VERIFIED'
  };

  // --- PART A: CORE FEED & EXECUTION CORRECTNESS ---

  it('M2-FEED-NORM-001: Normalizes raw market feed message with explicit provenance distinction and JCS digest', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const rawMsgAuthenticated: RawMarketDataMessage = {
      message_id: 'msg-001',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 40,
      currency: 'INR',
      feed_status: 'ACTIVE',
      is_authenticated_source_feed: true
    };

    const resAuth = handler.ingestRawMessage(rawMsgAuthenticated, '2026-10-11T12:00:01Z');
    expect(resAuth.outcome).toBe('ACCEPTED');
    const evAuth = resAuth.event!;
    expect(evAuth.provenance.is_authenticated_source_feed).toBe(true);
    expect(evAuth.provenance.adapter_mode).toBe('AUTHENTICATED_FEED');

    // Unauthenticated / Simulated message defaults to is_authenticated_source_feed: false
    const rawMsgSimulated: RawMarketDataMessage = {
      message_id: 'msg-002',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 2,
      timestamp_utc: '2026-10-11T12:00:02Z',
      bid_price: '115.60',
      bid_quantity: 30,
      ask_price: '116.10',
      ask_quantity: 20
    };
    const resSim = handler.ingestRawMessage(rawMsgSimulated, '2026-10-11T12:00:03Z');
    expect(resSim.outcome).toBe('ACCEPTED');
    const evSim = resSim.event!;
    expect(evSim.provenance.is_authenticated_source_feed).toBe(false);
    expect(evSim.provenance.adapter_mode).toBe('SIMULATED_TEST');
  });

  it('M2-FEED-PRICE-PRECISION-002: Enforces exact decimal precision without silent truncation', () => {
    // 1. Exact target scale (scale 4)
    expect(parseDecimalPriceToSubunits('115.5000', 4)).toBe('1155000');
    expect(parseDecimalPriceToSubunits('115.5', 4)).toBe('1155000');

    // 2. Extra trailing zeros safely accepted
    expect(parseDecimalPriceToSubunits('115.500000', 4)).toBe('1155000');

    // 3. Extra nonzero digits rejected fail-closed (prevents silent truncation)
    expect(() => parseDecimalPriceToSubunits('115.50001', 4)).toThrow(/E-ERR-024: UNSUPPORTED_PRICE_PRECISION/);
    expect(() => parseDecimalPriceToSubunits('115.50009', 4)).toThrow(/E-ERR-024: UNSUPPORTED_PRICE_PRECISION/);

    // 4. Zero-decimal currencies (JPY, scale 0)
    expect(parseDecimalPriceToSubunits('1500', 0)).toBe('1500');
    expect(parseDecimalPriceToSubunits('1500.00', 0)).toBe('1500');
    expect(() => parseDecimalPriceToSubunits('1500.5', 0)).toThrow(/E-ERR-024: UNSUPPORTED_PRICE_PRECISION/);

    // 5. Malformed inputs rejected
    expect(() => parseDecimalPriceToSubunits('abc', 4)).toThrow(/E-ERR-024: INVALID_PRICE_FORMAT/);
    expect(() => parseDecimalPriceToSubunits('-10.50', 4)).toThrow(/E-ERR-024: INVALID_PRICE_FORMAT/);
    expect(() => parseDecimalPriceToSubunits('0105.50', 4)).toThrow(/E-ERR-024: INVALID_PRICE_FORMAT/);
  });

  it('M2-FEED-STATUS-SUSPENDED-003: Maps SUSPENDED status explicitly and rejects dry-run execution', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);
    const engine = new DryRunExecutionEngine();

    const rawSuspended: RawMarketDataMessage = {
      message_id: 'msg-susp-01',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 40,
      feed_status: 'SUSPENDED'
    };

    const res = handler.ingestRawMessage(rawSuspended, '2026-10-11T12:00:01Z');
    expect(res.outcome).toBe('ACCEPTED');
    expect(res.event?.feed_status).toBe('SUSPENDED'); // Never maps to ACTIVE!

    // Freshness check returns false for SUSPENDED
    expect(handler.isEventFresh(res.event!, '2026-10-11T12:00:02Z')).toBe(false);

    // Execution engine rejects opportunity on SUSPENDED feed
    const intent = engine.evaluateExecutionIntent(sampleOffer, res.event!, '2026-10-11T12:00:02Z');
    expect(intent.payload.decision_status).toBe('SKIP_STALE_FEED');
    expect(intent.payload.decision_reason).toContain("is not ACTIVE (status 'SUSPENDED')");
  });

  it('M2-FEED-SEQ-MONO-004: Enforces monotonic sequence advancement on market stream', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const msg1: RawMarketDataMessage = {
      message_id: 'msg-101',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 10,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.00',
      bid_quantity: 10,
      ask_price: '116.00',
      ask_quantity: 10
    };
    const res1 = handler.ingestRawMessage(msg1, '2026-10-11T12:00:01Z');
    expect(res1.outcome).toBe('ACCEPTED');
    expect(handler.getExpectedSequence(venueId, canonicalProductId)).toBe('11');

    const msg2: RawMarketDataMessage = {
      message_id: 'msg-102',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 11,
      timestamp_utc: '2026-10-11T12:00:02Z',
      bid_price: '115.20',
      bid_quantity: 15,
      ask_price: '116.10',
      ask_quantity: 10
    };
    const res2 = handler.ingestRawMessage(msg2, '2026-10-11T12:00:03Z');
    expect(res2.outcome).toBe('ACCEPTED');
    expect(handler.getExpectedSequence(venueId, canonicalProductId)).toBe('12');
  });

  it('M2-FEED-DUP-REJECT-005: Detects and discards duplicate sequence messages', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const msg: RawMarketDataMessage = {
      message_id: 'msg-201',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 5,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.00',
      bid_quantity: 10,
      ask_price: '116.00',
      ask_quantity: 10
    };
    handler.ingestRawMessage(msg, '2026-10-11T12:00:01Z');

    const resDup = handler.ingestRawMessage(msg, '2026-10-11T12:00:02Z');
    expect(resDup.outcome).toBe('DUPLICATE_IGNORED');
    expect(resDup.received_sequence).toBe('5');
    expect(resDup.expected_sequence).toBe('6');
  });

  it('M2-FEED-GAP-REPLAY-DRAIN-006: Retains future message during gap and drains it automatically after replay', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    // Initial sequence 1
    handler.ingestRawMessage({
      message_id: 'msg-301',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.00',
      bid_quantity: 10,
      ask_price: '116.00',
      ask_quantity: 10
    }, '2026-10-11T12:00:01Z');

    // Future message sequence 4 arrives while expected is 2 -> GAP_DETECTED and buffered in pending buffer
    const resGap = handler.ingestRawMessage({
      message_id: 'msg-304',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 4,
      timestamp_utc: '2026-10-11T12:00:04Z',
      bid_price: '115.40',
      bid_quantity: 40,
      ask_price: '116.40',
      ask_quantity: 40
    }, '2026-10-11T12:00:05Z');

    expect(resGap.outcome).toBe('GAP_DETECTED');
    expect(resGap.expected_sequence).toBe('2');
    expect(resGap.received_sequence).toBe('4');
    expect(handler.getPendingGapCount(venueId, canonicalProductId)).toBe(1);

    // Replay missing messages 2 and 3
    const replayMessages: RawMarketDataMessage[] = [
      {
        message_id: 'msg-302',
        venue_id: venueId,
        raw_symbol: rawSymbol,
        sequence: 2,
        timestamp_utc: '2026-10-11T12:00:02Z',
        bid_price: '115.20',
        bid_quantity: 20,
        ask_price: '116.20',
        ask_quantity: 20
      },
      {
        message_id: 'msg-303',
        venue_id: venueId,
        raw_symbol: rawSymbol,
        sequence: 3,
        timestamp_utc: '2026-10-11T12:00:03Z',
        bid_price: '115.30',
        bid_quantity: 30,
        ask_price: '116.30',
        ask_quantity: 30
      }
    ];

    const replayResults = handler.replayAndSync(replayMessages, '2026-10-11T12:00:06Z');
    expect(replayResults.length).toBe(2);

    // Message 3's ingestion completed sequence 3, which automatically drained pending sequence 4!
    expect(replayResults[1].drained_sequences).toEqual(['4']);

    // Final expected sequence has advanced to 5!
    expect(handler.getExpectedSequence(venueId, canonicalProductId)).toBe('5');
    expect(handler.getPendingGapCount(venueId, canonicalProductId)).toBe(0);

    // Latest event is sequence 4 (the previously pending message was accepted)
    const latest = handler.getLatestEvent(venueId, canonicalProductId);
    expect(latest?.stream_sequence).toBe('4');
    expect(latest?.bid_price.amount_subunits).toBe('1154000');
  });

  it('M2-FEED-SKEW-BOUND-007: Rejects message with future timestamp exceeding tolerance', () => {
    const handler = new MarketFeedHandler({ clockSkewToleranceMs: 5000 });
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const futureMsg: RawMarketDataMessage = {
      message_id: 'msg-501',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:01:00Z', // 60s in future
      bid_price: '115.00',
      bid_quantity: 10,
      ask_price: '116.00',
      ask_quantity: 10
    };

    const res = handler.ingestRawMessage(futureMsg, '2026-10-11T12:00:00Z');
    expect(res.outcome).toBe('INVALID_FORMAT');
    expect(res.reason).toContain('E-ERR-023: CLOCK_SKEW_EXCEEDED');
  });

  it('M2-EXEC-VERIF-CONTRADICTION-008: Rejects contradictory offer where verification_status is not VERIFIED', () => {
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const contradictoryOffer: CanonicalOffer = {
      ...sampleOffer,
      offer_status: 'VERIFIED_EXECUTABLE_OFFER',
      verification_status: 'PARTIALLY_VERIFIED' // Contradictory!
    };

    const feedRes = handler.ingestRawMessage({
      message_id: 'msg-801',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '120.00',
      bid_quantity: 50,
      ask_price: '121.00',
      ask_quantity: 50
    }, '2026-10-11T12:00:01Z');

    const intent = engine.evaluateExecutionIntent(contradictoryOffer, feedRes.event!, '2026-10-11T12:00:02Z');
    expect(intent.payload.decision_status).toBe('SKIP_UNVERIFIED_OFFER');
    expect(intent.payload.decision_reason).toContain("requires offer_status 'VERIFIED_EXECUTABLE_OFFER' and verification_status 'VERIFIED'");
  });

  it('M2-EXEC-DRYRUN-PROFITABLE-009: Generates EXECUTE_DRY_RUN with exact margin and notional on profitable spread', () => {
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const rawMsg: RawMarketDataMessage = {
      message_id: 'msg-601',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50', // 115.5000 INR vs offer 105.0000 INR -> +10.5000 INR spread
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    };
    const feedRes = handler.ingestRawMessage(rawMsg, '2026-10-11T12:00:01Z');
    const feedEvent = feedRes.event!;

    const intent = engine.evaluateExecutionIntent(sampleOffer, feedEvent, '2026-10-11T12:00:02Z');

    expect(intent.payload.decision_status).toBe('EXECUTE_DRY_RUN');
    expect(intent.payload.mode).toBe('DRY_RUN');
    expect(intent.payload.order_quantity).toBe(50);
    expect(intent.payload.target_side).toBe('SELL');
    // Notional = 50 * 115.5000 INR = 5775.0000 INR -> 57750000 subunits
    expect(intent.payload.gross_notional.amount_subunits).toBe('57750000');
    // Margin = 50 * (115.5000 - 105.0000) INR = 50 * 10.5000 INR = 525.0000 INR -> 5250000 subunits
    expect(intent.payload.expected_gross_margin_subunits).toBe('5250000');
    expect(intent.payload.decision_reason).toContain('Profitable crossing opportunity');

    // Intent is cryptographically bound and deep-frozen
    expect(intent.canonical_intent_sha256).toBeDefined();
    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent.payload)).toBe(true);
  });

  it('M2-EXEC-SKIP-NO-SPREAD-010: Rejects execution intent when market bid is lower than offer cost', () => {
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const rawMsg: RawMarketDataMessage = {
      message_id: 'msg-701',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '100.00',
      bid_quantity: 50,
      ask_price: '101.00',
      ask_quantity: 50
    };
    const feedRes = handler.ingestRawMessage(rawMsg, '2026-10-11T12:00:01Z');

    const intent = engine.evaluateExecutionIntent(sampleOffer, feedRes.event!, '2026-10-11T12:00:02Z');

    expect(intent.payload.decision_status).toBe('SKIP_NO_SPREAD');
    expect(intent.payload.decision_reason).toContain('insufficient spread');
    expect(BigInt(intent.payload.expected_gross_margin_subunits) < 0n).toBe(true);
  });

  it('M2-EXEC-SKIP-EXPIRED-011: Rejects execution intent on expired offer', () => {
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const expiredOffer: CanonicalOffer = {
      ...sampleOffer,
      valid_until_utc: '2026-10-10T00:00:00Z'
    };

    const feedRes = handler.ingestRawMessage({
      message_id: 'msg-901',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '120.00',
      bid_quantity: 50,
      ask_price: '121.00',
      ask_quantity: 50
    }, '2026-10-11T12:00:01Z');

    const intent = engine.evaluateExecutionIntent(expiredOffer, feedRes.event!, '2026-10-11T12:00:02Z');
    expect(intent.payload.decision_status).toBe('SKIP_EXPIRED_OFFER');
    expect(intent.payload.decision_reason).toContain('expired');
  });

  it('M2-EXEC-SKIP-MOQ-012: Rejects execution intent when market liquidity is below offer MOQ', () => {
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const highMoqOffer: CanonicalOffer = {
      ...sampleOffer,
      minimum_order_quantity: 100
    };

    const feedRes = handler.ingestRawMessage({
      message_id: 'msg-1001',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '120.00',
      bid_quantity: 25,
      ask_price: '121.00',
      ask_quantity: 50
    }, '2026-10-11T12:00:01Z');

    const intent = engine.evaluateExecutionIntent(highMoqOffer, feedRes.event!, '2026-10-11T12:00:02Z');
    expect(intent.payload.decision_status).toBe('SKIP_MOQ_MISMATCH');
    expect(intent.payload.decision_reason).toContain('less than offer MOQ');
  });

  it('M2-EXEC-DUAL-LEDGER-GUARD-013: Enforces dual-ledger isolation blocking dry-run intent from mutating actuals', async () => {
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const feedRes = handler.ingestRawMessage({
      message_id: 'msg-1101',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    }, '2026-10-11T12:00:01Z');

    const intent = engine.evaluateExecutionIntent(sampleOffer, feedRes.event!, '2026-10-11T12:00:02Z');
    expect(intent.payload.mode).toBe('DRY_RUN');

    const fakeDbSession: any = {
      executeActualsMutationInTransaction: async () => { throw new Error('Unreachable'); }
    };
    const simContext: any = {
      ledger_type: 'SIMULATION_LEDGER',
      simulation_run_id: 'run-sim-01',
      scenario_parameters_hash: 'hash'
    };
    const mutation = {
      transaction_id: 'tx-001',
      position_id: 'pos-001',
      debit_account: 'acc-1',
      credit_account: 'acc-2',
      amount: intent.payload.gross_notional,
      description: 'Attempted actuals write from dry run'
    };

    await expect(enforceActualsLedgerWrite(mutation, simContext, '2026-10-11T12:00:03Z', fakeDbSession))
      .rejects
      .toThrow(/E-ERR-020: ACTUALS_LEDGER_WRITE_VIOLATION/);
  });

  // --- PART B: STREAMING ADAPTER & SIMULATED EXECUTION GATEWAY ---

  it('M2-ADAPTER-LIFECYCLE-014: Manages streaming connection states and blocks transmission when disconnected', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const adapter = new SimulatedStreamingMarketFeedAdapter(handler, {
      venue_id: venueId,
      isAuthenticatedSource: true
    });

    expect(adapter.getConnectionState()).toBe('DISCONNECTED');

    const tick: RawMarketDataMessage = {
      message_id: 'msg-ad-1',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    };

    // Pushing while disconnected throws error fail-closed
    expect(() => adapter.pushMessage(tick, '2026-10-11T12:00:01Z')).toThrow(/E-ERR-038: ADAPTER_NOT_CONNECTED/);

    // Connect
    adapter.connect();
    expect(adapter.getConnectionState()).toBe('CONNECTED');

    // Now message push succeeds
    const pushRes = adapter.pushMessage(tick, '2026-10-11T12:00:01Z');
    expect(pushRes.outcome).toBe('ACCEPTED');
    expect(pushRes.event?.provenance.is_authenticated_source_feed).toBe(true);

    // Disconnect and reconnect
    adapter.disconnect();
    expect(adapter.getConnectionState()).toBe('DISCONNECTED');
    adapter.reconnect();
    expect(adapter.getConnectionState()).toBe('CONNECTED');
  });

  it('M2-ADAPTER-GAP-RECOVERY-015: Automatically resolves detected sequence gap via journal replay', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const adapter = new SimulatedStreamingMarketFeedAdapter(handler, {
      venue_id: venueId
    });
    adapter.connect();

    // Push seq 10
    adapter.pushMessage({
      message_id: 't-10',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 10,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.00',
      bid_quantity: 10,
      ask_price: '116.00',
      ask_quantity: 10
    }, '2026-10-11T12:00:01Z');

    // Simulate journaled missing ticks in adapter history (ticks 11 and 12)
    const tick11: RawMarketDataMessage = {
      message_id: 't-11',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 11,
      timestamp_utc: '2026-10-11T12:00:01Z',
      bid_price: '115.10',
      bid_quantity: 10,
      ask_price: '116.10',
      ask_quantity: 10
    };
    const tick12: RawMarketDataMessage = {
      message_id: 't-12',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 12,
      timestamp_utc: '2026-10-11T12:00:02Z',
      bid_price: '115.20',
      bid_quantity: 10,
      ask_price: '116.20',
      ask_quantity: 10
    };
    (adapter as any).messageHistory.set(`${venueId}:${rawSymbol}:11`, tick11);
    (adapter as any).messageHistory.set(`${venueId}:${rawSymbol}:12`, tick12);

    // Incoming tick 13 causes gap detection (expected 11, received 13)
    const gapRes = adapter.pushMessage({
      message_id: 't-13',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 13,
      timestamp_utc: '2026-10-11T12:00:03Z',
      bid_price: '115.30',
      bid_quantity: 10,
      ask_price: '116.30',
      ask_quantity: 10
    }, '2026-10-11T12:00:04Z');

    expect(gapRes.outcome).toBe('GAP_DETECTED');

    // Recover gap via journal replay
    const replaySummary = adapter.recoverGapViaReplay(rawSymbol, 11, 12, '2026-10-11T12:00:05Z');
    expect(replaySummary.messages_found).toBe(2);
    expect(replaySummary.gap_resolved).toBe(true);

    // Head is now 14 and latest event is sequence 13
    expect(handler.getExpectedSequence(venueId, canonicalProductId)).toBe('14');
    expect(handler.getLatestEvent(venueId, canonicalProductId)?.stream_sequence).toBe('13');
  });

  it('M2-GATEWAY-IDEMPOTENT-SUBMISSION-016: Acknowledges DRY_RUN intent and returns identical order on repeated submission', () => {
    const gateway = new SimulatedExecutionGateway();
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const feedRes = handler.ingestRawMessage({
      message_id: 'msg-g-01',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    }, '2026-10-11T12:00:01Z');

    const intent = engine.evaluateExecutionIntent(sampleOffer, feedRes.event!, '2026-10-11T12:00:02Z');
    expect(intent.payload.decision_status).toBe('EXECUTE_DRY_RUN');

    // First submission: creates ACKNOWLEDGED order
    const order1 = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:03Z');
    expect(order1.status).toBe('ACKNOWLEDGED');
    expect(order1.total_quantity).toBe(50);
    expect(order1.filled_quantity).toBe(0);
    expect(order1.remaining_quantity).toBe(50);
    expect(order1.intent_id).toBe(intent.payload.intent_id);

    // Repeated submission of identical intent returns the exact same order state (idempotency)
    const order2 = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:04Z');
    expect(order2.order_id).toBe(order1.order_id);
    expect(order2.status).toBe('ACKNOWLEDGED');
    expect(order2.created_at_utc).toBe(order1.created_at_utc);
  });

  it('M2-GATEWAY-NON-EXEC-REJECT-017: Submitting non-executable intent records REJECTED simulated order', () => {
    const gateway = new SimulatedExecutionGateway();
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    // Feed with insufficient spread
    const feedRes = handler.ingestRawMessage({
      message_id: 'msg-g-02',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '100.00',
      bid_quantity: 50,
      ask_price: '101.00',
      ask_quantity: 50
    }, '2026-10-11T12:00:01Z');

    const nonExecIntent = engine.evaluateExecutionIntent(sampleOffer, feedRes.event!, '2026-10-11T12:00:02Z');
    expect(nonExecIntent.payload.decision_status).toBe('SKIP_NO_SPREAD');

    const order = gateway.submitExecutionIntent(nonExecIntent, '2026-10-11T12:00:03Z');
    expect(order.status).toBe('REJECTED');
    expect(order.rejection_reason).toContain('SKIP_NO_SPREAD');
  });

  it('M2-GATEWAY-PARTIAL-AND-FULL-FILL-018: Executes partial and full fills with rigorous quantity accounting', () => {
    const gateway = new SimulatedExecutionGateway();
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const feedRes = handler.ingestRawMessage({
      message_id: 'msg-g-03',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    }, '2026-10-11T12:00:01Z');

    const intent = engine.evaluateExecutionIntent(sampleOffer, feedRes.event!, '2026-10-11T12:00:02Z');
    const order = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:03Z');

    // Partial fill: 20 units
    const fillPrice = feedRes.event!.bid_price;
    const partialOrder = gateway.simulateFill(order.order_id, 20, fillPrice, '2026-10-11T12:00:04Z');
    expect(partialOrder.status).toBe('PARTIALLY_FILLED');
    expect(partialOrder.filled_quantity).toBe(20);
    expect(partialOrder.remaining_quantity).toBe(30);
    expect(partialOrder.fills.length).toBe(1);
    expect(partialOrder.fills[0].cumulative_quantity).toBe(20);
    expect(partialOrder.fills[0].remaining_quantity).toBe(30);

    // Full fill: remaining 30 units
    const fullOrder = gateway.simulateFill(order.order_id, 30, fillPrice, '2026-10-11T12:00:05Z');
    expect(fullOrder.status).toBe('FILLED');
    expect(fullOrder.filled_quantity).toBe(50);
    expect(fullOrder.remaining_quantity).toBe(0);
    expect(fullOrder.fills.length).toBe(2);
    expect(fullOrder.fills[1].cumulative_quantity).toBe(50);
    expect(fullOrder.fills[1].remaining_quantity).toBe(0);
  });

  it('M2-GATEWAY-CANCEL-OPEN-ORDER-019: Cancels open acknowledged order cleanly', () => {
    const gateway = new SimulatedExecutionGateway();
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const feedRes = handler.ingestRawMessage({
      message_id: 'msg-g-04',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    }, '2026-10-11T12:00:01Z');

    const intent = engine.evaluateExecutionIntent(sampleOffer, feedRes.event!, '2026-10-11T12:00:02Z');
    const order = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:03Z');

    const cancelledOrder = gateway.requestCancellation(order.order_id, '2026-10-11T12:00:04Z');
    expect(cancelledOrder.status).toBe('CANCELLED');
  });

  it('M2-GATEWAY-TERMINAL-PROTECTION-020: Blocks fills or cancellations on terminal orders', () => {
    const gateway = new SimulatedExecutionGateway();
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const feedRes = handler.ingestRawMessage({
      message_id: 'msg-g-05',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    }, '2026-10-11T12:00:01Z');

    const intent = engine.evaluateExecutionIntent(sampleOffer, feedRes.event!, '2026-10-11T12:00:02Z');
    const order = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:03Z');

    // Fill completely
    gateway.simulateFill(order.order_id, 50, feedRes.event!.bid_price, '2026-10-11T12:00:04Z');

    // Attempting further fill on FILLED order throws error
    expect(() => gateway.simulateFill(order.order_id, 1, feedRes.event!.bid_price, '2026-10-11T12:00:05Z'))
      .toThrow(/E-ERR-036: TERMINAL_ORDER_STATE/);

    // Attempting cancellation on FILLED order throws error
    expect(() => gateway.requestCancellation(order.order_id, '2026-10-11T12:00:06Z'))
      .toThrow(/E-ERR-036: TERMINAL_ORDER_STATE/);
  });

  it('M2-GATEWAY-LIVE-ORDER-REJECT-021: Rejects routing non-dry-run orders to simulated gateway', () => {
    const gateway = new SimulatedExecutionGateway();

    const illegalIntent: any = {
      payload: {
        intent_id: 'intent-live-01',
        mode: 'LIVE_EXECUTION', // Illegal live mode
        decision_status: 'EXECUTE_DRY_RUN'
      },
      canonical_intent_sha256: 'hash'
    };

    expect(() => gateway.submitExecutionIntent(illegalIntent, '2026-10-11T12:00:00Z'))
      .toThrow(/E-ERR-020: ACTUALS_LEDGER_WRITE_VIOLATION/);
  });
});
