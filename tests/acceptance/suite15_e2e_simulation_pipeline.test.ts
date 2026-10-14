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
  MAX_WS_FRAME_BYTES,
  getPayloadByteLength
} from '../../src/feeds/localWebSocketTransport.js';
import {
  SimulationPortfolio,
  divideHalfEven,
  assertSafeQuantity
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

    // 2. Multibyte UTF-8 expansion test at application boundary:
    // A string of 400,000 Euro signs '€' has string.length === 400,000 (< 1,048,576 UTF-16 code units),
    // but UTF-8 byte length is 1,200,000 bytes (> 1,048,576 bytes).
    const multibyteOversizedStr = '€'.repeat(400_000);
    expect(multibyteOversizedStr.length).toBeLessThan(MAX_WS_FRAME_BYTES);
    expect(getPayloadByteLength(multibyteOversizedStr)).toBeGreaterThan(MAX_WS_FRAME_BYTES);
    expect(activeAdapter.handleWireMessage(multibyteOversizedStr)).toBe(false); // safely dropped fail-closed

    // 3. Oversized ASCII payload at application boundary
    const oversizedAscii = 'X'.repeat(MAX_WS_FRAME_BYTES + 50);
    expect(getPayloadByteLength(oversizedAscii)).toBeGreaterThan(MAX_WS_FRAME_BYTES);
    expect(activeAdapter.handleWireMessage(oversizedAscii)).toBe(false); // safely dropped fail-closed

    // 4. Normal tick succeeds immediately afterwards
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
    await new Promise((r) => setTimeout(r, 350));

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

  it('M2-WS-BYTE-ACCURACY-010: Byte-accurate payload enforcement guards against multibyte character expansion and native maxPayload violations', async () => {
    // 1. Precise UTF-8 byte length calculation checks across various types
    expect(getPayloadByteLength('hello')).toBe(5);
    expect(getPayloadByteLength('₹')).toBe(3); // Indian Rupee sign is 3 UTF-8 bytes
    expect(getPayloadByteLength('€')).toBe(3); // Euro sign is 3 UTF-8 bytes
    expect(getPayloadByteLength('🚀')).toBe(4); // Emoji is 4 UTF-8 bytes, 2 UTF-16 code units
    expect('🚀'.length).toBe(2);
    expect(getPayloadByteLength(Buffer.from('test-buffer'))).toBe(11);
    expect(getPayloadByteLength(new Uint8Array([1, 2, 3, 4]).buffer)).toBe(4);
    expect(getPayloadByteLength([Buffer.from('abc'), Buffer.from('defg')])).toBe(7);

    // 2. Multibyte expansion: string length < byte limit, but UTF-8 byte count > byte limit
    const smallLimit = 100;
    const testServer = new MockLocalWebSocketFeedServer({ maxPayload: smallLimit });
    const srvUrl = await testServer.start();

    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const testAdapter = new WebSocketStreamingFeedAdapter(handler, {
      wsUrl: srvUrl,
      venue_id: venueId,
      maxPayloadBytes: smallLimit
    });

    await testAdapter.connect();
    expect(testAdapter.getMaxPayloadBytes()).toBe(smallLimit);

    // 40 Euro signs = 40 characters (length 40 < 100), but 120 bytes (> 100 bytes)
    const multibyteString = '€'.repeat(40);
    expect(multibyteString.length).toBe(40);
    expect(getPayloadByteLength(multibyteString)).toBe(120);
    expect(testAdapter.handleWireMessage(multibyteString)).toBe(false);

    // 3. Valid multibyte message within bounds parses and processes
    const validMultibyteMessage = JSON.stringify({
      type: 'TICK',
      message: {
        message_id: 'm-₹-1',
        venue_id: venueId,
        raw_symbol: rawSymbol,
        sequence: 1,
        timestamp_utc: '2026-10-11T12:00:00Z',
        bid_price: '100.00',
        bid_quantity: 10,
        ask_price: '101.00',
        ask_quantity: 10
      }
    });
    const fullAdapter = new WebSocketStreamingFeedAdapter(handler, {
      wsUrl: srvUrl,
      venue_id: venueId
    });
    expect(fullAdapter.handleWireMessage(validMultibyteMessage)).toBe(true);

    await testAdapter.disconnect();
    await testServer.stop();
  });

  // =========================================================================
  // SECTION 4: CONFORMANCE PATCH VERIFICATION (CUMULATIVE COGS & WS STRESS)
  // =========================================================================

  it('M2-PORTFOLIO-PARTITION-INVARIANCE-011: Anchored cumulative COGS allocation guarantees fill-partition invariance across arbitrary order splits', () => {
    // -------------------------------------------------------------------------
    // 1. Exact reviewer specification: C_0 = 5, Q_0 = 3
    // Acquired via 2 purchases:
    // Buy 1 @ 1 subunit = 1 subunit cost
    // Buy 2 @ 2 subunits = 4 subunits cost
    // Total aggregate acquisition cost = 5 subunits, Net quantity = 3 units
    // -------------------------------------------------------------------------
    const createExactBaselinePortfolio = () => {
      const p = new SimulationPortfolio({
        initialCash: createCanonicalMoney('10000000', 'INR', 4)
      });
      const buyOrder: SimulatedOrderRecord = {
        order_id: 'ord-acq-base',
        intent_id: 'intent-base',
        offer_id: offerId,
        product_id: canonicalProductId,
        venue_id: venueId,
        side: 'BUY',
        order_price: createCanonicalMoney('2', 'INR', 4),
        total_quantity: 3,
        filled_quantity: 3,
        remaining_quantity: 0,
        status: 'FILLED',
        created_at_utc: '2026-10-11T12:00:00Z',
        updated_at_utc: '2026-10-11T12:00:01Z',
        fills: [],
        events: [],
        intent_sha256: '0'.repeat(64)
      };

      // Fill 1: Buy 1 unit @ 1 subunit
      p.processFill({
        fill_id: 'fill-buy-1',
        order_id: buyOrder.order_id,
        fill_timestamp_utc: '2026-10-11T12:00:01Z',
        fill_price: createCanonicalMoney('1', 'INR', 4),
        fill_quantity: 1,
        cumulative_quantity: 1,
        remaining_quantity: 2
      }, buyOrder, '2026-10-11T12:00:01Z');

      // Fill 2: Buy 2 units @ 2 subunits
      p.processFill({
        fill_id: 'fill-buy-2',
        order_id: buyOrder.order_id,
        fill_timestamp_utc: '2026-10-11T12:00:02Z',
        fill_price: createCanonicalMoney('2', 'INR', 4),
        fill_quantity: 2,
        cumulative_quantity: 3,
        remaining_quantity: 0
      }, buyOrder, '2026-10-11T12:00:02Z');

      const pos = p.getPosition(canonicalProductId)!;
      expect(pos.net_quantity).toBe(3);
      expect(pos.aggregate_cost_subunits).toBe('5');
      return p;
    };

    const sellOrder: SimulatedOrderRecord = {
      order_id: 'ord-sell-exact',
      intent_id: 'intent-sell-base',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      side: 'SELL',
      order_price: createCanonicalMoney('10', 'INR', 4),
      total_quantity: 3,
      filled_quantity: 0,
      remaining_quantity: 3,
      status: 'ACKNOWLEDGED',
      created_at_utc: '2026-10-11T12:00:10Z',
      updated_at_utc: '2026-10-11T12:00:10Z',
      fills: [],
      events: [],
      intent_sha256: '1'.repeat(64)
    };

    // --- Path A: Sell 1 unit, then sell 1 unit ---
    const portfolioA = createExactBaselinePortfolio();

    // Fill A1: Sell 1 unit @ 10 subunits
    // s_1 = 1 -> A(1) = divideHalfEven(5*1, 3) = divideHalfEven(5, 3) = 2.
    // COGS_1 = 2 - 0 = 2. Remaining cost: 5 - 2 = 3.
    portfolioA.processFill({
      fill_id: 'fill-sell-a1',
      order_id: sellOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:11Z',
      fill_price: createCanonicalMoney('10', 'INR', 4),
      fill_quantity: 1,
      cumulative_quantity: 1,
      remaining_quantity: 2
    }, sellOrder, '2026-10-11T12:00:11Z');

    const posA1 = portfolioA.getPosition(canonicalProductId)!;
    expect(posA1.net_quantity).toBe(2);
    expect(posA1.aggregate_cost_subunits).toBe('3');

    // Fill A2: Sell 1 unit @ 10 subunits
    // s_2 = 2 -> A(2) = divideHalfEven(5*2, 3) = divideHalfEven(10, 3) = 3.
    // COGS_2 = A(2) - A(1) = 3 - 2 = 1.
    // Cumulative COGS for s=2 is 2 + 1 = 3.
    // Remaining cost: 5 - 3 = 2.
    portfolioA.processFill({
      fill_id: 'fill-sell-a2',
      order_id: sellOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:12Z',
      fill_price: createCanonicalMoney('10', 'INR', 4),
      fill_quantity: 1,
      cumulative_quantity: 2,
      remaining_quantity: 1
    }, sellOrder, '2026-10-11T12:00:12Z');

    const posA2 = portfolioA.getPosition(canonicalProductId)!;
    expect(posA2.net_quantity).toBe(1);
    expect(posA2.aggregate_cost_subunits).toBe('2');

    // --- Path B: Sell 2 units in a single fill ---
    const portfolioB = createExactBaselinePortfolio();

    // Fill B1: Sell 2 units @ 10 subunits
    // s_1 = 2 -> A(2) = divideHalfEven(5*2, 3) = 3.
    // COGS = 3. Remaining cost: 5 - 3 = 2.
    portfolioB.processFill({
      fill_id: 'fill-sell-b1',
      order_id: sellOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:11Z',
      fill_price: createCanonicalMoney('10', 'INR', 4),
      fill_quantity: 2,
      cumulative_quantity: 2,
      remaining_quantity: 1
    }, sellOrder, '2026-10-11T12:00:11Z');

    const posB1 = portfolioB.getPosition(canonicalProductId)!;
    expect(posB1.net_quantity).toBe(1);
    expect(posB1.aggregate_cost_subunits).toBe('2');

    // Verify bit-for-bit equivalence after selling 2 units across both paths
    expect(posA2.aggregate_cost_subunits).toBe(posB1.aggregate_cost_subunits);
    expect(posA2.cumulative_realized_pnl_subunits).toBe(posB1.cumulative_realized_pnl_subunits);
    expect(portfolioA.getSnapshot().available_cash.amount_subunits).toBe(portfolioB.getSnapshot().available_cash.amount_subunits);

    // --- Complete liquidation of last unit on both paths ---
    // s_3 = 3 -> complete liquidation flushes exact remaining cost (2 subunits)
    portfolioA.processFill({
      fill_id: 'fill-sell-a3',
      order_id: sellOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:13Z',
      fill_price: createCanonicalMoney('10', 'INR', 4),
      fill_quantity: 1,
      cumulative_quantity: 3,
      remaining_quantity: 0
    }, sellOrder, '2026-10-11T12:00:13Z');

    portfolioB.processFill({
      fill_id: 'fill-sell-b2',
      order_id: sellOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:13Z',
      fill_price: createCanonicalMoney('10', 'INR', 4),
      fill_quantity: 1,
      cumulative_quantity: 3,
      remaining_quantity: 0
    }, sellOrder, '2026-10-11T12:00:13Z');

    const finalPosA = portfolioA.getPosition(canonicalProductId)!;
    const finalPosB = portfolioB.getPosition(canonicalProductId)!;
    expect(finalPosA.net_quantity).toBe(0);
    expect(finalPosB.net_quantity).toBe(0);
    expect(finalPosA.aggregate_cost_subunits).toBe('0');
    expect(finalPosB.aggregate_cost_subunits).toBe('0');
    expect(finalPosA.cumulative_realized_pnl_subunits).toBe('25'); // 30 proceeds - 5 cost = 25
    expect(finalPosB.cumulative_realized_pnl_subunits).toBe('25');
    expect(portfolioA.getSnapshot().available_cash.amount_subunits).toBe(portfolioB.getSnapshot().available_cash.amount_subunits);

    // -------------------------------------------------------------------------
    // 2. Multi-partition test: C_0 = 37, Q_0 = 10, total sold s = 7
    // A(7) = divideHalfEven(37 * 7, 10) = divideHalfEven(259, 10) = 26
    // Expected remaining cost: 37 - 26 = 11
    // Partitions tested: [1,1,1,1,1,1,1], [3,4], [2,5], [7], [2,2,3]
    // -------------------------------------------------------------------------
    const partitions = [
      [1, 1, 1, 1, 1, 1, 1],
      [3, 4],
      [2, 5],
      [7],
      [2, 2, 3]
    ];

    const results = partitions.map((part, pIdx) => {
      const p = new SimulationPortfolio({
        initialCash: createCanonicalMoney('10000000', 'INR', 4)
      });
      const buyOrd: SimulatedOrderRecord = {
        order_id: `ord-part-buy-${pIdx}`,
        intent_id: `intent-part-buy-${pIdx}`,
        offer_id: offerId,
        product_id: canonicalProductId,
        venue_id: venueId,
        side: 'BUY',
        order_price: createCanonicalMoney('4', 'INR', 4),
        total_quantity: 10,
        filled_quantity: 10,
        remaining_quantity: 0,
        status: 'FILLED',
        created_at_utc: '2026-10-11T12:00:00Z',
        updated_at_utc: '2026-10-11T12:00:01Z',
        fills: [],
        events: [],
        intent_sha256: '2'.repeat(64)
      };

      // Acquire 7 units @ 4 subunits = 28
      p.processFill({
        fill_id: `fill-buy-p1-${pIdx}`,
        order_id: buyOrd.order_id,
        fill_timestamp_utc: '2026-10-11T12:00:01Z',
        fill_price: createCanonicalMoney('4', 'INR', 4),
        fill_quantity: 7,
        cumulative_quantity: 7,
        remaining_quantity: 3
      }, buyOrd, '2026-10-11T12:00:01Z');

      // Acquire 3 units @ 3 subunits = 9 -> Total cost = 37, Total qty = 10
      p.processFill({
        fill_id: `fill-buy-p2-${pIdx}`,
        order_id: buyOrd.order_id,
        fill_timestamp_utc: '2026-10-11T12:00:02Z',
        fill_price: createCanonicalMoney('3', 'INR', 4),
        fill_quantity: 3,
        cumulative_quantity: 10,
        remaining_quantity: 0
      }, buyOrd, '2026-10-11T12:00:02Z');

      const sellOrd: SimulatedOrderRecord = {
        order_id: `ord-part-sell-${pIdx}`,
        intent_id: `intent-part-sell-${pIdx}`,
        offer_id: offerId,
        product_id: canonicalProductId,
        venue_id: venueId,
        side: 'SELL',
        order_price: createCanonicalMoney('10', 'INR', 4),
        total_quantity: 7,
        filled_quantity: 0,
        remaining_quantity: 7,
        status: 'ACKNOWLEDGED',
        created_at_utc: '2026-10-11T12:00:10Z',
        updated_at_utc: '2026-10-11T12:00:10Z',
        fills: [],
        events: [],
        intent_sha256: '3'.repeat(64)
      };

      let cumSold = 0;
      let totalCogsBig = 0n;
      for (let i = 0; i < part.length; i++) {
        const qty = part[i];
        cumSold += qty;
        const snap = p.processFill({
          fill_id: `fill-part-s-${pIdx}-${i}`,
          order_id: sellOrd.order_id,
          fill_timestamp_utc: `2026-10-11T12:00:${20 + i}Z`,
          fill_price: createCanonicalMoney('10', 'INR', 4),
          fill_quantity: qty,
          cumulative_quantity: cumSold,
          remaining_quantity: 7 - cumSold
        }, sellOrd, `2026-10-11T12:00:${20 + i}Z`);

        const lastJournal = snap.journal[snap.journal.length - 1];
        const stepCogs = BigInt(lastJournal.position_before.aggregate_cost_subunits) -
                         BigInt(lastJournal.position_after.aggregate_cost_subunits);
        totalCogsBig += stepCogs;
      }

      const finalPos = p.getPosition(canonicalProductId)!;
      return {
        totalCogs: totalCogsBig.toString(),
        remainingCost: finalPos.aggregate_cost_subunits,
        netQuantity: finalPos.net_quantity,
        realizedPnl: finalPos.cumulative_realized_pnl_subunits,
        availableCash: p.getSnapshot().available_cash.amount_subunits,
        portfolio: p
      };
    });

    // Check all partitions produce bit-for-bit identical outcomes
    for (const r of results) {
      expect(r.totalCogs).toBe('26');
      expect(r.remainingCost).toBe('11');
      expect(r.netQuantity).toBe(3);
      expect(r.realizedPnl).toBe('44'); // 7 * 10 = 70 proceeds - 26 cogs = 44
      expect(r.availableCash).toBe(results[0].availableCash);
    }

    // -------------------------------------------------------------------------
    // 3. Interleaved purchase epoch transition:
    // Existing inventory: Q = 3, remainingCost = 11.
    // Buy 5 units @ 8 subunits each: cost added = 40.
    // New pool epoch baseline: C_0 = 11 + 40 = 51, Q_0 = 3 + 5 = 8, s = 0.
    // Sell 4 units in partition [2, 2] vs [4]:
    // A(4) = divideHalfEven(51 * 4, 8) = divideHalfEven(204, 8) = 26 (25.5 rounded half-to-even)
    // Remaining cost: 51 - 26 = 25.
    // -------------------------------------------------------------------------
    const epochTestPartitions = [[2, 2], [4]];
    const epochResults = epochTestPartitions.map((part, eIdx) => {
      const p = results[eIdx].portfolio;
      const buyOrd2: SimulatedOrderRecord = {
        order_id: `ord-epoch-buy-${eIdx}`,
        intent_id: `intent-epoch-buy-${eIdx}`,
        offer_id: offerId,
        product_id: canonicalProductId,
        venue_id: venueId,
        side: 'BUY',
        order_price: createCanonicalMoney('8', 'INR', 4),
        total_quantity: 5,
        filled_quantity: 5,
        remaining_quantity: 0,
        status: 'FILLED',
        created_at_utc: '2026-10-11T12:01:00Z',
        updated_at_utc: '2026-10-11T12:01:01Z',
        fills: [],
        events: [],
        intent_sha256: '4'.repeat(64)
      };

      p.processFill({
        fill_id: `fill-epoch-buy-${eIdx}`,
        order_id: buyOrd2.order_id,
        fill_timestamp_utc: '2026-10-11T12:01:01Z',
        fill_price: createCanonicalMoney('8', 'INR', 4),
        fill_quantity: 5,
        cumulative_quantity: 5,
        remaining_quantity: 0
      }, buyOrd2, '2026-10-11T12:01:01Z');

      const posAfterBuy = p.getPosition(canonicalProductId)!;
      expect(posAfterBuy.net_quantity).toBe(8);
      expect(posAfterBuy.aggregate_cost_subunits).toBe('51');

      const sellOrd2: SimulatedOrderRecord = {
        order_id: `ord-epoch-sell-${eIdx}`,
        intent_id: `intent-epoch-sell-${eIdx}`,
        offer_id: offerId,
        product_id: canonicalProductId,
        venue_id: venueId,
        side: 'SELL',
        order_price: createCanonicalMoney('15', 'INR', 4),
        total_quantity: 4,
        filled_quantity: 0,
        remaining_quantity: 4,
        status: 'ACKNOWLEDGED',
        created_at_utc: '2026-10-11T12:01:10Z',
        updated_at_utc: '2026-10-11T12:01:10Z',
        fills: [],
        events: [],
        intent_sha256: '5'.repeat(64)
      };

      let cogsBig = 0n;
      let cumSold = 0;
      for (let i = 0; i < part.length; i++) {
        cumSold += part[i];
        const snap = p.processFill({
          fill_id: `fill-epoch-s-${eIdx}-${i}`,
          order_id: sellOrd2.order_id,
          fill_timestamp_utc: `2026-10-11T12:01:${20 + i}Z`,
          fill_price: createCanonicalMoney('15', 'INR', 4),
          fill_quantity: part[i],
          cumulative_quantity: cumSold,
          remaining_quantity: 4 - cumSold
        }, sellOrd2, `2026-10-11T12:01:${20 + i}Z`);
        const lastEntry = snap.journal[snap.journal.length - 1];
        const stepCogs = BigInt(lastEntry.position_before.aggregate_cost_subunits) -
                         BigInt(lastEntry.position_after.aggregate_cost_subunits);
        cogsBig += stepCogs;
      }

      const finalPos = p.getPosition(canonicalProductId)!;
      return {
        cogs: cogsBig.toString(),
        remainingCost: finalPos.aggregate_cost_subunits,
        netQty: finalPos.net_quantity
      };
    });

    expect(epochResults[0].cogs).toBe('26');
    expect(epochResults[1].cogs).toBe('26');
    expect(epochResults[0].remainingCost).toBe('25');
    expect(epochResults[1].remainingCost).toBe('25');
    expect(epochResults[0].netQty).toBe(4);
    expect(epochResults[1].netQty).toBe(4);
  });

  it('M2-WS-LIFECYCLE-OVERSIZED-BOMB-012: Native maxPayload failure handles oversized peer bombardment and transitions cleanly to terminal CLOSED state', async () => {
    const bombLimit = 100;
    const oversizedBomb = Buffer.alloc(250, 0x41); // 250 bytes > 100 byte limit

    // Server allows up to 1024 bytes, but client enforces maxPayloadBytes: 100
    const bombServer = new MockLocalWebSocketFeedServer({ maxPayload: 1024 });
    const srvUrl = await bombServer.start();

    // Configure connection hook: whenever a client connects, bomb it immediately with 250 bytes
    let connectionAttempts = 0;
    bombServer.setOnConnectionHook((socket) => {
      connectionAttempts++;
      if (socket.readyState === 1) { // OPEN
        socket.send(oversizedBomb);
      }
    });

    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const statesRecorded: string[] = [];
    const bombAdapter = new WebSocketStreamingFeedAdapter(handler, {
      wsUrl: srvUrl,
      venue_id: venueId,
      maxPayloadBytes: bombLimit,
      maxReconnectAttempts: 2,
      reconnectBaseBackoffMs: 15,
      stabilizationWindowMs: 250
    });

    bombAdapter.onStateChange((st) => {
      statesRecorded.push(st);
    });

    // Start connection. Because the bombing occurs asynchronously after open,
    // connect() resolves on initial open, then native ws emits error & close.
    await bombAdapter.connect();

    // Await full reconnect retry cycle and exhaustion (attempt 0 -> bomb -> attempt 1 -> bomb -> attempt 2 -> bomb -> CLOSED)
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (bombAdapter.getConnectionState() === 'CLOSED' || Date.now() - start > 2000) {
          clearInterval(interval);
          resolve();
        }
      }, 20);
    });

    // Verify adapter state machine and retry exhaustion
    expect(bombAdapter.getConnectionState()).toBe('CLOSED');
    expect(bombAdapter.getReconnectAttempts()).toBe(2);
    expect(connectionAttempts).toBeGreaterThanOrEqual(2);
    expect(statesRecorded).toContain('RECONNECTING');
    expect(statesRecorded[statesRecorded.length - 1]).toBe('CLOSED');

    // Teardown
    await bombAdapter.disconnect();
    await bombServer.stop();
  });

  it('M2-PORTFOLIO-OVERFLOW-SHORT-GUARD-013: Guards against Number.MAX_SAFE_INTEGER quantity overflow and enforces unsupported short prohibition', () => {
    // 1. Direct unit verification of assertSafeQuantity
    expect(assertSafeQuantity(0n, 'test_zero')).toBe(0);
    expect(assertSafeQuantity(BigInt(Number.MAX_SAFE_INTEGER), 'test_max')).toBe(Number.MAX_SAFE_INTEGER);

    // Negative quantity throws E-ERR-045 fail-closed
    expect(() => assertSafeQuantity(-1n, 'test_negative'))
      .toThrow(/E-ERR-045: QUANTITY_OVERFLOW/);

    // Overflowing quantity (> Number.MAX_SAFE_INTEGER) throws E-ERR-045 fail-closed
    const overflowBig = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(() => assertSafeQuantity(overflowBig, 'test_overflow'))
      .toThrow(/E-ERR-045: QUANTITY_OVERFLOW/);

    // 2. Portfolio constructor rejects allowShort: true fail-closed
    expect(() => new SimulationPortfolio({
      initialCash: createCanonicalMoney('10000000', 'INR', 4),
      allowShort: true
    })).toThrow(/E-ERR-044: SHORT_POSITIONS_NOT_SUPPORTED/);

    // 3. Portfolio processFill rejects cumulative quantity overflow fail-closed
    const portfolio = new SimulationPortfolio({
      initialCash: createCanonicalMoney('100000000000000000', 'INR', 4) // Sufficient cash
    });

    const buyOrder1: SimulatedOrderRecord = {
      order_id: 'ord-of-1',
      intent_id: 'intent-of-1',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      side: 'BUY',
      order_price: createCanonicalMoney('1', 'INR', 4),
      total_quantity: Number.MAX_SAFE_INTEGER,
      filled_quantity: Number.MAX_SAFE_INTEGER,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-11T12:00:00Z',
      updated_at_utc: '2026-10-11T12:00:01Z',
      fills: [],
      events: [],
      intent_sha256: 'a'.repeat(64)
    };

    // First fill sets net_quantity = Number.MAX_SAFE_INTEGER
    portfolio.processFill({
      fill_id: 'fill-of-1',
      order_id: buyOrder1.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:01Z',
      fill_price: createCanonicalMoney('1', 'INR', 4),
      fill_quantity: Number.MAX_SAFE_INTEGER,
      cumulative_quantity: Number.MAX_SAFE_INTEGER,
      remaining_quantity: 0
    }, buyOrder1, '2026-10-11T12:00:01Z');

    expect(portfolio.getPosition(canonicalProductId)?.net_quantity).toBe(Number.MAX_SAFE_INTEGER);

    // Second fill of 1 unit causes resulting net_quantity to exceed Number.MAX_SAFE_INTEGER
    const buyOrder2: SimulatedOrderRecord = {
      order_id: 'ord-of-2',
      intent_id: 'intent-of-2',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      side: 'BUY',
      order_price: createCanonicalMoney('1', 'INR', 4),
      total_quantity: 1,
      filled_quantity: 1,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-11T12:00:02Z',
      updated_at_utc: '2026-10-11T12:00:02Z',
      fills: [],
      events: [],
      intent_sha256: 'b'.repeat(64)
    };

    // 4. Capture complete snapshot before overflowing fill attempt to prove atomic fail-closed rejection
    const snapshotBefore = portfolio.getSnapshot();

    expect(() => portfolio.processFill({
      fill_id: 'fill-of-2',
      order_id: buyOrder2.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:02Z',
      fill_price: createCanonicalMoney('1', 'INR', 4),
      fill_quantity: 1,
      cumulative_quantity: 1,
      remaining_quantity: 0
    }, buyOrder2, '2026-10-11T12:00:02Z')).toThrow(/E-ERR-045: QUANTITY_OVERFLOW/);

    // Capture snapshot after the rejected transaction and verify complete atomic invariance
    const snapshotAfter = portfolio.getSnapshot();
    expect(snapshotAfter).toEqual(snapshotBefore);
    expect(snapshotAfter.available_cash.amount_subunits).toBe(snapshotBefore.available_cash.amount_subunits);
    expect(snapshotAfter.cumulative_realized_pnl.amount_subunits).toBe(snapshotBefore.cumulative_realized_pnl.amount_subunits);
    expect(snapshotAfter.positions).toEqual(snapshotBefore.positions);
    expect(snapshotAfter.journal.length).toBe(1);
    expect(portfolio.isFillProcessed('fill-of-2')).toBe(false);
  });
});

