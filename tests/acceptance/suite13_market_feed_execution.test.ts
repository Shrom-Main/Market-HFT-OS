import { describe, it, expect } from 'vitest';
import {
  MarketFeedHandler,
  RawMarketDataMessage,
  parseDecimalPriceToSubunits
} from '../../src/feeds/feedHandler.js';
import {
  DryRunExecutionEngine,
  ExecutionIntent
} from '../../src/execution/engine.js';
import {
  CanonicalOffer,
  createCanonicalMoney
} from '../../src/canonical/domain.js';
import { sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import { enforceActualsLedgerWrite } from '../../src/ledger/actualsGuard.js';

describe('SUITE-13: Gate M2 Market Feed Normalization & Dry-Run Execution Engine', () => {
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

  it('M2-FEED-NORM-001: Normalizes raw market feed message with exact BigInt subunits and JCS digest', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const rawMsg: RawMarketDataMessage = {
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
      feed_status: 'ACTIVE'
    };

    const res = handler.ingestRawMessage(rawMsg, '2026-10-11T12:00:01Z');
    expect(res.outcome).toBe('ACCEPTED');
    expect(res.event).toBeDefined();

    const ev = res.event!;
    expect(ev.product_id).toBe(canonicalProductId);
    expect(ev.venue_id).toBe(venueId);
    expect(ev.stream_sequence).toBe('1');
    expect(ev.bid_price.amount_subunits).toBe('1155000'); // 115.5000 INR
    expect(ev.bid_price.scale).toBe(4);
    expect(ev.bid_price.currency).toBe('INR');
    expect(ev.ask_price.amount_subunits).toBe('1160000'); // 116.0000 INR
    expect(ev.bid_quantity).toBe(50);
    expect(ev.ask_quantity).toBe(40);
    expect(ev.feed_status).toBe('ACTIVE');
    expect(ev.provenance.is_authenticated_source_feed).toBe(true);

    // Verify bitwise cryptographic hash
    const expectedSha = sha256(canonicalizeJCS({
      event_id: ev.event_id,
      venue_id: ev.venue_id,
      product_id: ev.product_id,
      stream_sequence: ev.stream_sequence,
      occurred_at_utc: ev.occurred_at_utc,
      ingested_at_utc: ev.ingested_at_utc,
      bid_price: ev.bid_price,
      ask_price: ev.ask_price,
      bid_quantity: ev.bid_quantity,
      ask_quantity: ev.ask_quantity,
      feed_status: ev.feed_status,
      provenance: ev.provenance
    }));
    expect(ev.event_sha256).toBe(expectedSha);
  });

  it('M2-FEED-SEQ-MONO-002: Enforces monotonic sequence advancement on market stream', () => {
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

  it('M2-FEED-DUP-REJECT-003: Detects and discards duplicate sequence messages', () => {
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

    // Duplicate arrival of sequence 5
    const resDup = handler.ingestRawMessage(msg, '2026-10-11T12:00:02Z');
    expect(resDup.outcome).toBe('DUPLICATE_IGNORED');
    expect(resDup.received_sequence).toBe('5');
    expect(resDup.expected_sequence).toBe('6');
    expect(handler.getExpectedSequence(venueId, canonicalProductId)).toBe('6');
  });

  it('M2-FEED-GAP-DETECT-004: Detects sequence gaps fail-closed without advancing head', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

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

    // Gap: sequence jumps from 1 to 4 (missing 2 and 3)
    const resGap = handler.ingestRawMessage({
      message_id: 'msg-304',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 4,
      timestamp_utc: '2026-10-11T12:00:05Z',
      bid_price: '115.50',
      bid_quantity: 10,
      ask_price: '116.50',
      ask_quantity: 10
    }, '2026-10-11T12:00:06Z');

    expect(resGap.outcome).toBe('GAP_DETECTED');
    expect(resGap.expected_sequence).toBe('2');
    expect(resGap.received_sequence).toBe('4');
    expect(resGap.gap_size).toBe(2);
    // Head remains at sequence 2, not 4
    expect(handler.getExpectedSequence(venueId, canonicalProductId)).toBe('2');
  });

  it('M2-FEED-REPLAY-SYNC-005: Replay buffer resolves sequence gap and restores stream integrity', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    handler.ingestRawMessage({
      message_id: 'msg-401',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.00',
      bid_quantity: 10,
      ask_price: '116.00',
      ask_quantity: 10
    }, '2026-10-11T12:00:01Z');

    // Missing messages 2 and 3 replayed in batch
    const replayedMessages: RawMarketDataMessage[] = [
      {
        message_id: 'msg-403',
        venue_id: venueId,
        raw_symbol: rawSymbol,
        sequence: 3,
        timestamp_utc: '2026-10-11T12:00:03Z',
        bid_price: '115.30',
        bid_quantity: 10,
        ask_price: '116.30',
        ask_quantity: 10
      },
      {
        message_id: 'msg-402',
        venue_id: venueId,
        raw_symbol: rawSymbol,
        sequence: 2,
        timestamp_utc: '2026-10-11T12:00:02Z',
        bid_price: '115.10',
        bid_quantity: 10,
        ask_price: '116.10',
        ask_quantity: 10
      }
    ];

    const replayResults = handler.replayAndSync(replayedMessages, '2026-10-11T12:00:05Z');
    expect(replayResults.length).toBe(2);
    expect(replayResults[0].outcome).toBe('ACCEPTED');
    expect(replayResults[0].received_sequence).toBe('2');
    expect(replayResults[1].outcome).toBe('ACCEPTED');
    expect(replayResults[1].received_sequence).toBe('3');

    // Stream head successfully caught up to 4
    expect(handler.getExpectedSequence(venueId, canonicalProductId)).toBe('4');
  });

  it('M2-FEED-SKEW-BOUND-006: Rejects message with future timestamp exceeding tolerance', () => {
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

  it('M2-EXEC-DRYRUN-PROFITABLE-007: Generates EXECUTE_DRY_RUN with exact margin and notional on profitable spread', () => {
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

  it('M2-EXEC-SKIP-NO-SPREAD-008: Rejects execution intent when market bid is lower than offer cost', () => {
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    // Bid price 100.00 INR vs offer price 105.00 INR -> Negative spread (-5.00 INR)
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

  it('M2-EXEC-SKIP-UNVERIFIED-009: Rejects execution intent on unverified indicative offer', () => {
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const unverifiedOffer: CanonicalOffer = {
      ...sampleOffer,
      offer_status: 'INDICATIVE_QUOTE' // Not executable!
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

    const intent = engine.evaluateExecutionIntent(unverifiedOffer, feedRes.event!, '2026-10-11T12:00:02Z');
    expect(intent.payload.decision_status).toBe('SKIP_UNVERIFIED_OFFER');
    expect(intent.payload.decision_reason).toContain('is not VERIFIED_EXECUTABLE_OFFER');
  });

  it('M2-EXEC-SKIP-EXPIRED-010: Rejects execution intent on expired offer', () => {
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const expiredOffer: CanonicalOffer = {
      ...sampleOffer,
      valid_until_utc: '2026-10-10T00:00:00Z' // Expired in the past
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

  it('M2-EXEC-SKIP-MOQ-011: Rejects execution intent when market liquidity is below offer MOQ', () => {
    const engine = new DryRunExecutionEngine();
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const highMoqOffer: CanonicalOffer = {
      ...sampleOffer,
      minimum_order_quantity: 100 // Requires MOQ 100
    };

    const feedRes = handler.ingestRawMessage({
      message_id: 'msg-1001',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '120.00',
      bid_quantity: 25, // Only 25 available on market bid
      ask_price: '121.00',
      ask_quantity: 50
    }, '2026-10-11T12:00:01Z');

    const intent = engine.evaluateExecutionIntent(highMoqOffer, feedRes.event!, '2026-10-11T12:00:02Z');
    expect(intent.payload.decision_status).toBe('SKIP_MOQ_MISMATCH');
    expect(intent.payload.decision_reason).toContain('less than offer MOQ');
  });

  it('M2-EXEC-DUAL-LEDGER-GUARD-012: Enforces dual-ledger isolation blocking dry-run intent from mutating actuals', async () => {
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

    // Attempting to pass simulation/dry-run context to actuals write guard must fail fail-closed
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
});
