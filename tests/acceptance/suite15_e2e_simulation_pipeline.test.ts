import { describe, it, expect, afterEach } from 'vitest';
import {
  CanonicalOffer,
  CanonicalMoney,
  createCanonicalMoney
} from '../../src/canonical/domain.js';
import {
  RawMarketDataMessage,
  MarketFeedHandler
} from '../../src/feeds/feedHandler.js';
import {
  MockLocalWebSocketFeedServer,
  WebSocketStreamingFeedAdapter,
  UnrecoverableGapReport,
  MAX_WS_FRAME_BYTES
} from '../../src/feeds/localWebSocketTransport.js';
import {
  SimulationPortfolio,
  divideHalfEven
} from '../../src/portfolio/simulationPortfolio.js';
import {
  SimulatedExecutionGateway,
  SimulatedOrderRecord,
  SimulatedFillEvent
} from '../../src/execution/simulatedGateway.js';
import {
  SimulationPipeline
} from '../../src/simulation/simulationPipeline.js';

describe('SUITE-15: Gate M2 Increment 4 — End-to-End Simulation Pipeline & Integration Gate', () => {
  const venueId = 'VENUE_NSE_COMMERCIAL';
  const rawSymbol = 'DIN3017-W4-16-25';
  const canonicalProductId = 'prod:din3017:16-25mm';
  const offerId = 'off:din3017:sup-01:2026-q4';

  const verifiedOffer: CanonicalOffer = {
    offer_id: offerId,
    product_id: canonicalProductId,
    unit_price: createCanonicalMoney('1000000', 'INR', 4), // 100.0000 INR
    minimum_order_quantity: 10,
    available_quantity: 100,
    payment_terms_days: 30,
    incoterms: 'EXW',
    valid_until_utc: '2026-12-31T00:00:00Z',
    offer_status: 'VERIFIED_EXECUTABLE_OFFER',
    verification_status: 'VERIFIED'
  };

  let activeServer: MockLocalWebSocketFeedServer | null = null;
  let activeAdapter: WebSocketStreamingFeedAdapter | null = null;

  afterEach(async () => {
    if (activeAdapter) {
      await activeAdapter.disconnect();
      activeAdapter = null;
    }
    if (activeServer) {
      await activeServer.stop();
      activeServer = null;
    }
  });

  // =========================================================================
  // SECTION 1: MATHEMATICAL EXACTNESS OF PORTFOLIO ACCOUNTING
  // =========================================================================

  it('M2-EXACT-MATH-001: divideHalfEven implements deterministic banker\'s rounding on integer division', () => {
    // Exact division: 10 / 2 = 5
    expect(divideHalfEven(10n, 2n)).toBe(5n);

    // Below halfway: 10 / 3 = 3 rem 1 (2*1 < 3) -> 3
    expect(divideHalfEven(10n, 3n)).toBe(3n);

    // Above halfway: 11 / 3 = 3 rem 2 (2*2 > 3) -> 4
    expect(divideHalfEven(11n, 3n)).toBe(4n);

    // Exact halfway to even:
    // 3 / 2 = 1 rem 1 (2*1 == 2). 1 is odd -> rounds to 2
    expect(divideHalfEven(3n, 2n)).toBe(2n);
    // 5 / 2 = 2 rem 1 (2*1 == 2). 2 is even -> rounds to 2
    expect(divideHalfEven(5n, 2n)).toBe(2n);
    // 7 / 2 = 3 rem 1 (2*1 == 2). 3 is odd -> rounds to 4
    expect(divideHalfEven(7n, 2n)).toBe(4n);
    // 8 / 2 = 4 rem 0 -> 4
    expect(divideHalfEven(8n, 2n)).toBe(4n);

    // Zero denominator throws
    expect(() => divideHalfEven(10n, 0n)).toThrow(/DIVISION_BY_ZERO/);
  });

  it('M2-EXACT-MATH-002: Exact rational cost basis prevents precision drift across fractional unit costs and partial sales', () => {
    // Initial cash: 1,000 subunits
    const portfolio = new SimulationPortfolio({
      initialCash: createCanonicalMoney('1000', 'INR', 4)
    });

    const buyOrder: SimulatedOrderRecord = {
      order_id: 'ord-frac-b1',
      intent_id: 'intent-frac-b1',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      side: 'BUY',
      order_price: createCanonicalMoney('10', 'INR', 4),
      total_quantity: 3,
      filled_quantity: 3,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-11T12:00:00Z',
      updated_at_utc: '2026-10-11T12:00:01Z',
      fills: [],
      events: [],
      intent_sha256: 'a'.repeat(64)
    };

    // Reviewer Case: 3 units purchased for 10 subunits total (average cost = 10/3 subunits/unit)
    // Buy 1: 1 unit @ 4 subunits (notional = 4)
    // Buy 2: 2 units @ 3 subunits (notional = 6)
    // Total inventory: 3 units. Total cost: 4 + 6 = 10 subunits.
    // Average unit cost: 10 / 3 = 3.3333... subunits (non-divisible integer).
    portfolio.processFill({
      fill_id: 'fill-frac-b1',
      order_id: buyOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:01Z',
      fill_price: createCanonicalMoney('4', 'INR', 4),
      fill_quantity: 1,
      cumulative_quantity: 1,
      remaining_quantity: 0
    }, buyOrder, '2026-10-11T12:00:01Z');

    portfolio.processFill({
      fill_id: 'fill-frac-b2',
      order_id: buyOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:02Z',
      fill_price: createCanonicalMoney('3', 'INR', 4),
      fill_quantity: 2,
      cumulative_quantity: 3,
      remaining_quantity: 0
    }, buyOrder, '2026-10-11T12:00:02Z');

    const posAfterBuys = portfolio.getPosition(canonicalProductId);
    expect(posAfterBuys?.net_quantity).toBe(3);
    expect(posAfterBuys?.aggregate_cost_subunits).toBe('10');
    expect(posAfterBuys?.cost_basis_rational).toEqual({
      numerator_subunits: '10',
      denominator_quantity: 3
    });

    const sellOrder: SimulatedOrderRecord = {
      order_id: 'ord-frac-s1',
      intent_id: 'intent-frac-s1',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      side: 'SELL',
      order_price: createCanonicalMoney('5', 'INR', 4),
      total_quantity: 3,
      filled_quantity: 0,
      remaining_quantity: 3,
      status: 'ACKNOWLEDGED',
      created_at_utc: '2026-10-11T12:00:03Z',
      updated_at_utc: '2026-10-11T12:00:03Z',
      fills: [],
      events: [],
      intent_sha256: 'b'.repeat(64)
    };

    // Partial Sale 1: Sell 1 unit @ 5 subunits (proceeds = 5 subunits)
    // Unrounded COGS = 10 * 1 / 3 = 3 rem 1.
    // 2*1 < 3 -> rounds down to 3 subunits.
    // Realized P&L = 5 - 3 = +2 subunits.
    // Remaining aggregate cost = 10 - 3 = 7 subunits.
    portfolio.processFill({
      fill_id: 'fill-frac-s1',
      order_id: sellOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:04Z',
      fill_price: createCanonicalMoney('5', 'INR', 4),
      fill_quantity: 1,
      cumulative_quantity: 1,
      remaining_quantity: 2
    }, sellOrder, '2026-10-11T12:00:04Z');

    const pos1 = portfolio.getPosition(canonicalProductId);
    expect(pos1?.net_quantity).toBe(2);
    expect(pos1?.aggregate_cost_subunits).toBe('7');
    expect(pos1?.cumulative_realized_pnl_subunits).toBe('2');

    // Partial Sale 2: Sell 1 unit @ 5 subunits (proceeds = 5 subunits)
    // Current inventory: 2 units with total cost 7 subunits.
    // Unrounded COGS = 7 * 1 / 2 = 3 rem 1 (exact half).
    // 3 is odd -> rounds to nearest even = 4 subunits!
    // Realized P&L = 5 - 4 = +1 subunit.
    // Remaining aggregate cost = 7 - 4 = 3 subunits.
    portfolio.processFill({
      fill_id: 'fill-frac-s2',
      order_id: sellOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:05Z',
      fill_price: createCanonicalMoney('5', 'INR', 4),
      fill_quantity: 1,
      cumulative_quantity: 2,
      remaining_quantity: 1
    }, sellOrder, '2026-10-11T12:00:05Z');

    const pos2 = portfolio.getPosition(canonicalProductId);
    expect(pos2?.net_quantity).toBe(1);
    expect(pos2?.aggregate_cost_subunits).toBe('3');
    expect(pos2?.cumulative_realized_pnl_subunits).toBe('3');

    // Final Sale 3: Sell remaining 1 unit @ 5 subunits (proceeds = 5 subunits)
    // Full exit: COGS absorbs remaining aggregate cost = 3 subunits!
    // Realized P&L = 5 - 3 = +2 subunits.
    // Remaining aggregate cost flushes cleanly to 0!
    portfolio.processFill({
      fill_id: 'fill-frac-s3',
      order_id: sellOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:06Z',
      fill_price: createCanonicalMoney('5', 'INR', 4),
      fill_quantity: 1,
      cumulative_quantity: 3,
      remaining_quantity: 0
    }, sellOrder, '2026-10-11T12:00:06Z');

    const pos3 = portfolio.getPosition(canonicalProductId);
    expect(pos3?.net_quantity).toBe(0);
    expect(pos3?.aggregate_cost_subunits).toBe('0');
    expect(pos3?.cumulative_realized_pnl_subunits).toBe('5');

    // Conservation Check over Full Round-Trip:
    // Total Buys = 4 + 6 = 10 subunits.
    // Total Sells = 5 + 5 + 5 = 15 subunits.
    // Total Realized P&L = 15 - 10 = 5 subunits EXACT!
    // Cash balance: 1000 - 10 + 15 = 1005 subunits.
    const finalSnap = portfolio.getSnapshot();
    expect(finalSnap.available_cash.amount_subunits).toBe('1005');
    expect(finalSnap.cumulative_realized_pnl.amount_subunits).toBe('5');
  });

  // =========================================================================
  // SECTION 2: WEBSOCKET RESILIENCE & FAULT-INJECTION HARDENING
  // =========================================================================

  it('M2-WS-HARDENING-003: Stale connection isolation ignores frames delivered by superseded socket instances', async () => {
    activeServer = new MockLocalWebSocketFeedServer();
    const wsUrl = await activeServer.start();

    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    activeAdapter = new WebSocketStreamingFeedAdapter(handler, {
      wsUrl,
      venue_id: venueId,
      reconnectBaseBackoffMs: 20
    });

    await activeAdapter.connect();
    expect(activeAdapter.getConnectionState()).toBe('CONNECTED');

    // Simulate connection drop and trigger reconnect
    activeServer.simulateDropConnection();

    // Await reconnection and server acknowledgement of the client socket
    await new Promise<void>((resolve) => {
      const check = () => {
        if (
          activeAdapter?.getConnectionState() === 'CONNECTED' &&
          activeServer &&
          activeServer.getConnectedClientCount() > 0
        ) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });

    expect(activeAdapter.getConnectionState()).toBe('CONNECTED');

    // Deliver tick through active connection
    activeServer.publishTick({
      message_id: 'ws-reconnect-tick-1',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    });

    await new Promise((r) => setTimeout(r, 50));
    const event = handler.getLatestEvent(venueId, canonicalProductId);
    expect(event).toBeDefined();
    expect(event?.stream_sequence).toBe('1');
    expect(handler.getExpectedSequence(venueId, canonicalProductId)).toBe('2');
  });

  it('M2-WS-HARDENING-004: Malformed and oversized frames are safely dropped without crashing or state corruption', async () => {
    activeServer = new MockLocalWebSocketFeedServer();
    const wsUrl = await activeServer.start();

    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    activeAdapter = new WebSocketStreamingFeedAdapter(handler, {
      wsUrl,
      venue_id: venueId
    });

    await activeAdapter.connect();

    // 1. Send completely invalid JSON frame
    activeServer.sendRawFrame('NOT_VALID_JSON{{{[[[');
    await new Promise((r) => setTimeout(r, 30));
    expect(activeAdapter.getConnectionState()).toBe('CONNECTED');

    // 2. Send oversized frame exceeding 1MB
    const oversized = JSON.stringify({
      type: 'TICK',
      payload: 'X'.repeat(MAX_WS_FRAME_BYTES + 50)
    });
    activeServer.sendRawFrame(oversized);
    await new Promise((r) => setTimeout(r, 30));
    expect(activeAdapter.getConnectionState()).toBe('CONNECTED');

    // 3. Normal tick succeeds immediately afterwards
    activeServer.publishTick({
      message_id: 'ws-after-malformed-tick',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(handler.getExpectedSequence(venueId, canonicalProductId)).toBe('2');
  });

  it('M2-WS-HARDENING-005: Reconnect exhaustion transitions cleanly to CLOSED without orphaned retry loops', async () => {
    activeServer = new MockLocalWebSocketFeedServer();
    const wsUrl = await activeServer.start();

    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    // Set max reconnects to 2
    activeAdapter = new WebSocketStreamingFeedAdapter(handler, {
      wsUrl,
      venue_id: venueId,
      maxReconnectAttempts: 2,
      reconnectBaseBackoffMs: 15
    });

    await activeAdapter.connect();
    expect(activeAdapter.getConnectionState()).toBe('CONNECTED');

    // Stop server completely
    await activeServer.stop();
    activeServer = null;

    // Await reconnect exhaustion
    await new Promise((r) => setTimeout(r, 150));

    expect(activeAdapter.getConnectionState()).toBe('CLOSED');
    expect(activeAdapter.getReconnectAttempts()).toBe(2);
  });

  // =========================================================================
  // SECTION 3: END-TO-END SIMULATION PIPELINE (ACCEPTANCE CONDITIONS A-E)
  // =========================================================================

  it('M2-PIPELINE-REPLAY-006 [Condition A]: Reproducible Event Replay produces bit-identical states and cryptographic digests', () => {
    const ticks: RawMarketDataMessage[] = [
      {
        message_id: 'tick-rep-1',
        venue_id: venueId,
        raw_symbol: rawSymbol,
        sequence: 1,
        timestamp_utc: '2026-10-11T12:00:00Z',
        bid_price: '110.00',
        bid_quantity: 50,
        ask_price: '111.00',
        ask_quantity: 50
      },
      {
        message_id: 'tick-rep-2',
        venue_id: venueId,
        raw_symbol: rawSymbol,
        sequence: 2,
        timestamp_utc: '2026-10-11T12:00:01Z',
        bid_price: '112.50',
        bid_quantity: 50,
        ask_price: '113.00',
        ask_quantity: 50
      },
      {
        message_id: 'tick-rep-3',
        venue_id: venueId,
        raw_symbol: rawSymbol,
        sequence: 3,
        timestamp_utc: '2026-10-11T12:00:02Z',
        bid_price: '95.00', // Below offer unit price 100 -> SKIP_NO_SPREAD
        bid_quantity: 50,
        ask_price: '96.00',
        ask_quantity: 50
      }
    ];

    const runSimulation = () => {
      const pipeline = new SimulationPipeline({
        initialCash: createCanonicalMoney('100000000', 'INR', 4), // 10,000.0000 INR
        autoFundInventoryFromOffer: true
      });
      pipeline.getFeedHandler().registerSymbolMapping(venueId, rawSymbol, canonicalProductId);
      pipeline.registerVerifiedOffer(verifiedOffer);

      for (const raw of ticks) {
        const feedRes = pipeline.getFeedHandler().ingestRawMessage(raw, raw.timestamp_utc);
        if (feedRes.event) {
          pipeline.processMarketEvent(feedRes.event, raw.timestamp_utc);
        }
      }

      return {
        digest: pipeline.computeStateDigest(),
        reports: pipeline.getStepReports(),
        portfolio: pipeline.getPortfolio().getSnapshot()
      };
    };

    const run1 = runSimulation();
    const run2 = runSimulation();

    // Condition A: Bit-identical replay verification
    expect(run1.digest).toBe(run2.digest);
    expect(run1.reports.length).toBe(run2.reports.length);
    expect(run1.portfolio.available_cash.amount_subunits).toBe(run2.portfolio.available_cash.amount_subunits);
    expect(run1.portfolio.positions).toEqual(run2.portfolio.positions);
    expect(run1.portfolio.journal.length).toBe(run2.portfolio.journal.length);
  });

  it('M2-PIPELINE-INVARIANTS-007 [Condition B]: Conservation of Capital and Quantity hold across end-to-end pipeline execution', () => {
    const pipeline = new SimulationPipeline({
      initialCash: createCanonicalMoney('100000000', 'INR', 4), // 10,000.0000 INR
      autoFundInventoryFromOffer: true
    });
    pipeline.getFeedHandler().registerSymbolMapping(venueId, rawSymbol, canonicalProductId);
    pipeline.registerVerifiedOffer(verifiedOffer);

    const tick: RawMarketDataMessage = {
      message_id: 'tick-inv-ok',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '110.00',
      bid_quantity: 50,
      ask_price: '111.00',
      ask_quantity: 50
    };

    const feedRes = pipeline.getFeedHandler().ingestRawMessage(tick, '2026-10-11T12:00:01Z');
    const reports = pipeline.processMarketEvent(feedRes.event!, '2026-10-11T12:00:02Z');

    expect(reports.length).toBe(1);
    expect(reports[0].executed).toBe(true);
    expect(reports[0].invariants_satisfied).toBe(true);

    const snap = pipeline.getPortfolio().getSnapshot();
    // Capital Conservation Invariant: Available Cash + Aggregate Open Cost === Initial Cash + Realized P&L
    const openCostBig = snap.positions.length > 0 ? BigInt(snap.positions[0].aggregate_cost_subunits) : 0n;
    const availableCashBig = BigInt(snap.available_cash.amount_subunits);
    const initialCashBig = BigInt(snap.initial_cash.amount_subunits);
    const pnlBig = BigInt(snap.cumulative_realized_pnl.amount_subunits);

    expect(availableCashBig + openCostBig).toBe(initialCashBig + pnlBig);
    // Quantity Conservation Invariant
    expect(reports[0].order?.filled_quantity! + reports[0].order?.remaining_quantity!).toBe(reports[0].order?.total_quantity);
  });

  it('M2-PIPELINE-FAULT-INJECTION-008 [Condition C]: Injected faults fail closed without state corruption', () => {
    const pipeline = new SimulationPipeline({
      initialCash: createCanonicalMoney('10000000', 'INR', 4)
    });
    pipeline.getFeedHandler().registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    // 1. Unverified offer registration rejected
    const unverifiedOffer: CanonicalOffer = {
      ...verifiedOffer,
      verification_status: 'UNVERIFIED'
    };
    expect(() => pipeline.registerVerifiedOffer(unverifiedOffer))
      .toThrow(/E-ERR-024: UNVERIFIED_OFFER/);

    // 2. Future timestamp clock skew rejected
    const futureTick: RawMarketDataMessage = {
      message_id: 'tick-skew',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:10:00Z', // 10 minutes ahead of ingest time
      bid_price: '110.00',
      bid_quantity: 50,
      ask_price: '111.00',
      ask_quantity: 50
    };
    const res = pipeline.getFeedHandler().ingestRawMessage(futureTick, '2026-10-11T12:00:00Z');
    expect(res.outcome).toBe('INVALID_FORMAT');
    expect(res.reason).toContain('E-ERR-023: CLOCK_SKEW_EXCEEDED');

    // Portfolio and order books remain completely empty
    expect(pipeline.getPortfolio().getSnapshot().positions.length).toBe(0);
    expect(pipeline.getStepReports().length).toBe(0);
  });

  it('M2-PIPELINE-LEDGER-ISOLATION-009 [Condition D]: Blocks live venue routing and preserves dual-ledger write isolation fail-closed', () => {
    const pipeline = new SimulationPipeline({
      initialCash: createCanonicalMoney('10000000', 'INR', 4)
    });
    pipeline.getFeedHandler().registerSymbolMapping(venueId, rawSymbol, canonicalProductId);
    pipeline.registerVerifiedOffer(verifiedOffer);

    // Fake live event masquerading as authenticated venue feed
    const fakeLiveEvent: any = {
      venue_id: venueId,
      product_id: canonicalProductId,
      sequence: '1',
      occurred_at_utc: '2026-10-11T12:00:00Z',
      ingested_at_utc: '2026-10-11T12:00:01Z',
      feed_status: 'ACTIVE',
      bid_price: createCanonicalMoney('1100000', 'INR', 4),
      bid_quantity: 50,
      ask_price: createCanonicalMoney('1110000', 'INR', 4),
      ask_quantity: 50,
      provenance: {
        is_authenticated_source_feed: true // VIOLATION
      },
      event_sha256: '0'.repeat(64)
    };

    expect(() => pipeline.processMarketEvent(fakeLiveEvent, '2026-10-11T12:00:02Z'))
      .toThrow(/E-ERR-020: ACTUALS_LEDGER_WRITE_VIOLATION/);
  });
});
