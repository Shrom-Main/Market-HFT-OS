import { describe, it, expect, afterEach } from 'vitest';
import {
  MarketFeedHandler,
  RawMarketDataMessage
} from '../../src/feeds/feedHandler.js';
import {
  SimulatedStreamingMarketFeedAdapter
} from '../../src/feeds/streamingAdapter.js';
import {
  MockLocalWebSocketFeedServer,
  WebSocketStreamingFeedAdapter,
  UnrecoverableGapReport
} from '../../src/feeds/localWebSocketTransport.js';
import {
  DryRunExecutionEngine,
  ExecutionIntent,
  ExecutionIntentPayload
} from '../../src/execution/engine.js';
import {
  SimulatedExecutionGateway,
  SimulatedFillEvent,
  SimulatedOrderRecord
} from '../../src/execution/simulatedGateway.js';
import {
  SimulationPortfolio,
  PortfolioJournalEntry
} from '../../src/portfolio/simulationPortfolio.js';
import {
  CanonicalOffer,
  createCanonicalMoney
} from '../../src/canonical/domain.js';

describe('SUITE-14: Gate M2 Increment 3 — WebSocket Transport, Order Lifecycle Events & Simulation Portfolio', () => {
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

  function createSampleIntent(
    intent_id: string,
    sha: string,
    overrides?: Partial<ExecutionIntentPayload>
  ): ExecutionIntent {
    const payload: ExecutionIntentPayload = {
      intent_id,
      engine_release: 'GATE-M2-EXEC-v0.1.0',
      mode: 'DRY_RUN',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      target_side: 'BUY',
      offer_unit_price: createCanonicalMoney('1050000', 'INR', 4),
      market_unit_price: createCanonicalMoney('1155000', 'INR', 4),
      order_quantity: 50,
      gross_notional: createCanonicalMoney('57750000', 'INR', 4),
      expected_gross_margin_subunits: '5250000',
      decision_status: 'EXECUTE_DRY_RUN',
      decision_reason: 'Profitable spread',
      evaluated_at_utc: '2026-10-11T12:00:00Z',
      market_event_sha256: '0'.repeat(64),
      ...overrides
    };
    return {
      payload,
      canonical_intent_sha256: sha
    };
  }

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
  // PART A — THREE BOUNDED CORRECTNESS FIXES
  // =========================================================================

  it('M2-CORR-PROVENANCE-001: Simulated adapter forcefully overrides contradictory input authentication assertions', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const adapter = new SimulatedStreamingMarketFeedAdapter(handler, {
      venue_id: venueId
    });
    adapter.connect();

    expect(adapter.isSimulated()).toBe(true);

    // Raw message falsely claiming authenticated source feed
    const rawContradictory: RawMarketDataMessage = {
      message_id: 'msg-prov-01',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50,
      is_authenticated_source_feed: true // contradictory assertion
    };

    const res = adapter.pushMessage(rawContradictory, '2026-10-11T12:00:01Z');
    expect(res.outcome).toBe('ACCEPTED');
    expect(res.event).toBeDefined();
    // Strict Provenance Guard: overridden to false fail-closed
    expect(res.event?.provenance.is_authenticated_source_feed).toBe(false);
  });

  it('M2-CORR-IDEMPOTENCY-002: Intent retry with identical canonical hash returns existing order without duplicate mutation', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    const feedRes = handler.ingestRawMessage({
      message_id: 'msg-idemp-01',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    }, '2026-10-11T12:00:01Z');

    const engine = new DryRunExecutionEngine();
    const intent = engine.evaluateExecutionIntent(sampleOffer, feedRes.event!, '2026-10-11T12:00:02Z');

    const gateway = new SimulatedExecutionGateway();
    const order1 = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:03Z');
    expect(order1.status).toBe('ACKNOWLEDGED');

    // Partially fill the order
    gateway.simulateFill(order1.order_id, 20, feedRes.event!.bid_price, '2026-10-11T12:00:04Z');

    // Resubmit identical intent
    const orderRetry = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:05Z');
    expect(orderRetry.order_id).toBe(order1.order_id);
    expect(orderRetry.status).toBe('PARTIALLY_FILLED');
    expect(orderRetry.filled_quantity).toBe(20);
    expect(orderRetry.remaining_quantity).toBe(30);
    expect(orderRetry.fills.length).toBe(1);
  });

  it('M2-CORR-IDEMPOTENCY-003: Intent submission with conflicting canonical hash under same intent_id throws E-ERR-039', () => {
    const gateway = new SimulatedExecutionGateway();

    const validIntent = createSampleIntent('intent-conflict-test', 'a'.repeat(64));
    gateway.submitExecutionIntent(validIntent, '2026-10-11T12:00:01Z');

    // Conflicting payload under same intent_id
    const conflictingIntent = createSampleIntent('intent-conflict-test', 'b'.repeat(64));

    expect(() => gateway.submitExecutionIntent(conflictingIntent, '2026-10-11T12:00:02Z'))
      .toThrow(/E-ERR-039: IDEMPOTENCY_CONFLICT/);
  });

  it('M2-CORR-TRANSITION-JOURNAL-004: Explicit order-state transition journal records full history with sequential numbering', () => {
    const gateway = new SimulatedExecutionGateway();

    const intent = createSampleIntent('intent-journal-01', 'c'.repeat(64), { order_quantity: 100 });

    const o1 = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:01Z');
    expect(o1.events.length).toBe(1);
    expect(o1.events[0]).toMatchObject({
      sequence_number: 1,
      previous_status: null,
      resulting_status: 'ACKNOWLEDGED',
      remaining_quantity: 100
    });

    const o2 = gateway.simulateFill(o1.order_id, 30, createCanonicalMoney('1155000', 'INR', 4), '2026-10-11T12:00:02Z');
    expect(o2.events.length).toBe(2);
    expect(o2.events[1]).toMatchObject({
      sequence_number: 2,
      previous_status: 'ACKNOWLEDGED',
      resulting_status: 'PARTIALLY_FILLED',
      delta_filled_quantity: 30,
      remaining_quantity: 70
    });

    const o3 = gateway.simulateFill(o1.order_id, 70, createCanonicalMoney('1155000', 'INR', 4), '2026-10-11T12:00:03Z');
    expect(o3.events.length).toBe(3);
    expect(o3.events[2]).toMatchObject({
      sequence_number: 3,
      previous_status: 'PARTIALLY_FILLED',
      resulting_status: 'FILLED',
      delta_filled_quantity: 70,
      remaining_quantity: 0
    });
  });

  it('M2-CORR-CANCEL-TWOSTEP-005: Cancellation requires explicit request followed by confirmation, blocking premature confirmation', () => {
    const gateway = new SimulatedExecutionGateway();

    const intent = createSampleIntent('intent-twostep-01', 'd'.repeat(64));
    const order = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:01Z');

    // Premature confirmation on ACKNOWLEDGED order fails closed
    expect(() => gateway.confirmCancellation(order.order_id, '2026-10-11T12:00:02Z'))
      .toThrow(/E-ERR-037: CANCELLATION_NOT_REQUESTED/);

    // Step 1: Request cancellation
    const requested = gateway.requestCancellation(order.order_id, '2026-10-11T12:00:03Z', 'Client cancelled order');
    expect(requested.status).toBe('CANCELLATION_REQUESTED');
    expect(requested.events[1]).toMatchObject({
      sequence_number: 2,
      previous_status: 'ACKNOWLEDGED',
      resulting_status: 'CANCELLATION_REQUESTED'
    });

    // Step 2: Confirm cancellation
    const confirmed = gateway.confirmCancellation(order.order_id, '2026-10-11T12:00:04Z', 'Venue cancellation ack');
    expect(confirmed.status).toBe('CANCELLED');
    expect(confirmed.events[2]).toMatchObject({
      sequence_number: 3,
      previous_status: 'CANCELLATION_REQUESTED',
      resulting_status: 'CANCELLED'
    });

    // Filling cancelled order throws E-ERR-036
    expect(() => gateway.simulateFill(order.order_id, 10, createCanonicalMoney('1155000', 'INR', 4), '2026-10-11T12:00:05Z'))
      .toThrow(/E-ERR-036: TERMINAL_ORDER_STATE/);
  });

  it('M2-CORR-FILL-CANCEL-RACE-006: Manages fill arriving while cancellation is requested, preserving filled + remaining === total invariant', () => {
    const gateway = new SimulatedExecutionGateway();

    const intent = createSampleIntent('intent-race-01', 'e'.repeat(64), { order_quantity: 100 });
    const order = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:01Z');

    // Client sends cancel request
    const pendingCancel = gateway.requestCancellation(order.order_id, '2026-10-11T12:00:02Z');
    expect(pendingCancel.status).toBe('CANCELLATION_REQUESTED');

    // Partial fill arrives from matching venue before cancel is processed
    const racedPartial = gateway.simulateFill(
      order.order_id,
      40,
      createCanonicalMoney('1155000', 'INR', 4),
      '2026-10-11T12:00:03Z'
    );
    expect(racedPartial.status).toBe('CANCELLATION_REQUESTED');
    expect(racedPartial.filled_quantity).toBe(40);
    expect(racedPartial.remaining_quantity).toBe(60);
    expect(racedPartial.filled_quantity + racedPartial.remaining_quantity).toBe(100);

    // Cancel confirms remaining 60 balance
    const cancelled = gateway.confirmCancellation(order.order_id, '2026-10-11T12:00:04Z');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.filled_quantity).toBe(40);
    expect(cancelled.remaining_quantity).toBe(60);
    expect(cancelled.filled_quantity + cancelled.remaining_quantity).toBe(100);
  });

  it('M2-CORR-IMMUTABILITY-007: Gateway order snapshots and transition histories are deeply immutable', () => {
    const gateway = new SimulatedExecutionGateway();

    const intent = createSampleIntent('intent-freeze-01', 'f'.repeat(64));
    const order = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:01Z');

    expect(() => {
      (order as any).status = 'HACKED';
    }).toThrow();

    expect(() => {
      (order.events as any).push({ event_id: 'fake' });
    }).toThrow();
  });

  // =========================================================================
  // PART B — LOCAL WEBSOCKET TRANSPORT
  // =========================================================================

  it('M2-WS-TRANSPORT-IO-008: Real asynchronous local socket I/O streams ticks into MarketFeedHandler', async () => {
    activeServer = new MockLocalWebSocketFeedServer();
    const wsUrl = await activeServer.start();

    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    activeAdapter = new WebSocketStreamingFeedAdapter(handler, {
      wsUrl,
      venue_id: venueId
    });

    await activeAdapter.connect();
    expect(activeAdapter.getConnectionState()).toBe('CONNECTED');

    const receivedTicks: any[] = [];
    activeAdapter.onMessage((res) => {
      receivedTicks.push(res);
    });

    // Publish tick from mock server
    activeServer.publishTick({
      message_id: 'ws-tick-1',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    });

    // Await asynchronous message processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(receivedTicks.length).toBe(1);
    expect(receivedTicks[0].outcome).toBe('ACCEPTED');
    expect(receivedTicks[0].event.event_sha256).toBeDefined();

    const latest = handler.getLatestEvent(venueId, canonicalProductId);
    expect(latest).toBeDefined();
    expect(latest?.bid_price.amount_subunits).toBe('1155000');
  });

  it('M2-WS-LIFECYCLE-RECONNECT-009: Detects socket connection drops and reconnects automatically with bounded backoff', async () => {
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

    // Simulate connection drop
    activeServer.simulateDropConnection();

    // Give adapter time to detect drop, transition to RECONNECTING, and reconnect
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(activeAdapter.getConnectionState()).toBe('CONNECTED');
    expect(activeAdapter.getReconnectAttempts()).toBe(0); // reset upon successful reconnect
  });

  it('M2-WS-REPLAY-RECOVERY-010: Detects gap on socket tick 3, requests replay for tick 2, and resolves sequence head', async () => {
    activeServer = new MockLocalWebSocketFeedServer();
    const wsUrl = await activeServer.start();

    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    activeAdapter = new WebSocketStreamingFeedAdapter(handler, {
      wsUrl,
      venue_id: venueId
    });

    await activeAdapter.connect();

    const tick1: RawMarketDataMessage = {
      message_id: 'ws-r-1',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    };

    const tick2: RawMarketDataMessage = {
      message_id: 'ws-r-2',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 2,
      timestamp_utc: '2026-10-11T12:00:01Z',
      bid_price: '115.60',
      bid_quantity: 50,
      ask_price: '116.10',
      ask_quantity: 50
    };

    const tick3: RawMarketDataMessage = {
      message_id: 'ws-r-3',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 3,
      timestamp_utc: '2026-10-11T12:00:02Z',
      bid_price: '115.70',
      bid_quantity: 50,
      ask_price: '116.20',
      ask_quantity: 50
    };

    // Client receives tick 1
    activeServer.publishTick(tick1);
    await new Promise((r) => setTimeout(r, 40));
    expect(handler.getExpectedSequence(venueId, canonicalProductId)).toBe('2');

    // Server has tick 2 in history, and sends tick 3 over socket
    activeServer.publishTick(tick2); // recorded in server history
    activeServer.publishTick(tick3); // recorded in history and broadcasted

    await new Promise((r) => setTimeout(r, 80));

    // After automatic replay request and response, expected sequence should advance to 4
    expect(handler.getExpectedSequence(venueId, canonicalProductId)).toBe('4');
    expect(handler.getPendingGapCount(venueId, canonicalProductId)).toBe(0);
  });

  it('M2-WS-UNRECOVERABLE-GAP-011: Reports explicit UNRECOVERABLE_SEQUENCE_GAP when server replay fails', async () => {
    activeServer = new MockLocalWebSocketFeedServer();
    const wsUrl = await activeServer.start();

    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    activeAdapter = new WebSocketStreamingFeedAdapter(handler, {
      wsUrl,
      venue_id: venueId
    });

    let reportedGap: UnrecoverableGapReport | null = null;
    activeAdapter.onUnrecoverableGap((gap) => {
      reportedGap = gap;
    });

    await activeAdapter.connect();

    // Ingest tick 1
    activeServer.publishTick({
      message_id: 'ws-u-1',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50
    });
    await new Promise((r) => setTimeout(r, 30));

    // Publish tick 10 with retainInHistory: false, simulating missing server journal entries
    activeServer.publishTick({
      message_id: 'ws-u-10',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 10,
      timestamp_utc: '2026-10-11T12:00:01Z',
      bid_price: '115.80',
      bid_quantity: 50,
      ask_price: '116.30',
      ask_quantity: 50
    }, false);

    await new Promise((r) => setTimeout(r, 60));

    expect(reportedGap).not.toBeNull();
    const gap = reportedGap as unknown as UnrecoverableGapReport;
    expect(gap.reason).toContain('UNRECOVERABLE_SEQUENCE_GAP');
    expect(gap.expected_sequence).toBe('2');
    expect(gap.received_sequence).toBe('10');
  });

  it('M2-WS-PROVENANCE-ISOLATION-012: Enforces simulated provenance on all socket frames, blocking authenticated claims', async () => {
    activeServer = new MockLocalWebSocketFeedServer();
    const wsUrl = await activeServer.start();

    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping(venueId, rawSymbol, canonicalProductId);

    activeAdapter = new WebSocketStreamingFeedAdapter(handler, {
      wsUrl,
      venue_id: venueId
    });

    expect(activeAdapter.isSimulated()).toBe(true);
    expect(activeAdapter.getTransportType()).toBe('LOCAL_WEBSOCKET_TCP');

    let normalizedEvent: any = null;
    activeAdapter.onMessage((res) => {
      if (res.event) normalizedEvent = res.event;
    });

    await activeAdapter.connect();

    // Server broadcasts tick claiming to be authenticated
    activeServer.publishTick({
      message_id: 'ws-prov-tick',
      venue_id: venueId,
      raw_symbol: rawSymbol,
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.50',
      bid_quantity: 50,
      ask_price: '116.00',
      ask_quantity: 50,
      is_authenticated_source_feed: true
    });

    await new Promise((r) => setTimeout(r, 40));

    expect(normalizedEvent).toBeDefined();
    expect(normalizedEvent.provenance.is_authenticated_source_feed).toBe(false);
  });

  // =========================================================================
  // PART C — SIMULATION PORTFOLIO & POSITION TRACKER
  // =========================================================================

  it('M2-PORTFOLIO-BUY-ACCOUNTING-013: Debits cash, credits inventory, and computes weighted average cost basis using exact BigInt subunits', () => {
    const portfolio = new SimulationPortfolio({
      initialCash: createCanonicalMoney('10000000', 'INR', 4) // 1,000.0000 INR
    });

    const mockOrder: SimulatedOrderRecord = {
      order_id: 'ord-buy-01',
      intent_id: 'intent-01',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      side: 'BUY',
      order_price: createCanonicalMoney('200000', 'INR', 4),
      total_quantity: 20,
      filled_quantity: 10,
      remaining_quantity: 10,
      status: 'PARTIALLY_FILLED',
      created_at_utc: '2026-10-11T12:00:00Z',
      updated_at_utc: '2026-10-11T12:00:01Z',
      fills: [],
      events: [],
      intent_sha256: 'a'.repeat(64)
    };

    // Fill 1: Buy 10 units @ 20.0000 INR (200000 subunits each -> 2,000,000 subunits notional)
    const fill1: SimulatedFillEvent = {
      fill_id: 'fill-01',
      order_id: mockOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:01Z',
      fill_price: createCanonicalMoney('200000', 'INR', 4),
      fill_quantity: 10,
      cumulative_quantity: 10,
      remaining_quantity: 10
    };

    const snap1 = portfolio.processFill(fill1, mockOrder, '2026-10-11T12:00:01Z');
    expect(snap1.available_cash.amount_subunits).toBe('8000000'); // 800.0000 INR
    const pos1 = portfolio.getPosition(canonicalProductId);
    expect(pos1?.net_quantity).toBe(10);
    expect(pos1?.weighted_cost_basis_subunits).toBe('200000');

    // Fill 2: Buy 10 units @ 30.0000 INR (300000 subunits each -> 3,000,000 subunits notional)
    const fill2: SimulatedFillEvent = {
      fill_id: 'fill-02',
      order_id: mockOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:02Z',
      fill_price: createCanonicalMoney('300000', 'INR', 4),
      fill_quantity: 10,
      cumulative_quantity: 20,
      remaining_quantity: 0
    };

    const snap2 = portfolio.processFill(fill2, mockOrder, '2026-10-11T12:00:02Z');
    expect(snap2.available_cash.amount_subunits).toBe('5000000'); // 500.0000 INR
    const pos2 = portfolio.getPosition(canonicalProductId);
    expect(pos2?.net_quantity).toBe(20);
    // (2,000,000 + 3,000,000) / 20 = 250,000 subunits (25.0000 INR)
    expect(pos2?.weighted_cost_basis_subunits).toBe('250000');
  });

  it('M2-PORTFOLIO-SELL-PNL-014: Credits cash, debits inventory, and calculates realized P&L with BigInt precision', () => {
    const portfolio = new SimulationPortfolio({
      initialCash: createCanonicalMoney('10000000', 'INR', 4) // 1,000.0000 INR
    });

    const buyOrder: SimulatedOrderRecord = {
      order_id: 'ord-b-01',
      intent_id: 'intent-b-01',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      side: 'BUY',
      order_price: createCanonicalMoney('250000', 'INR', 4),
      total_quantity: 20,
      filled_quantity: 20,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-11T12:00:00Z',
      updated_at_utc: '2026-10-11T12:00:01Z',
      fills: [],
      events: [],
      intent_sha256: 'a'.repeat(64)
    };

    // Buy 20 units @ 25.0000 INR -> 5,000,000 subunits cash debited
    portfolio.processFill({
      fill_id: 'fill-b-01',
      order_id: buyOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:01Z',
      fill_price: createCanonicalMoney('250000', 'INR', 4),
      fill_quantity: 20,
      cumulative_quantity: 20,
      remaining_quantity: 0
    }, buyOrder, '2026-10-11T12:00:01Z');

    const sellOrder: SimulatedOrderRecord = {
      order_id: 'ord-s-01',
      intent_id: 'intent-s-01',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      side: 'SELL',
      order_price: createCanonicalMoney('350000', 'INR', 4),
      total_quantity: 10,
      filled_quantity: 10,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-11T12:00:02Z',
      updated_at_utc: '2026-10-11T12:00:03Z',
      fills: [],
      events: [],
      intent_sha256: 'b'.repeat(64)
    };

    // Sell 10 units @ 35.0000 INR
    // Proceeds: 10 * 350,000 = 3,500,000
    // COGS: 10 * 250,000 = 2,500,000
    // Realized P&L: +1,000,000 (+100.0000 INR)
    const snap = portfolio.processFill({
      fill_id: 'fill-s-01',
      order_id: sellOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:03Z',
      fill_price: createCanonicalMoney('350000', 'INR', 4),
      fill_quantity: 10,
      cumulative_quantity: 10,
      remaining_quantity: 0
    }, sellOrder, '2026-10-11T12:00:03Z');

    // Cash: 5,000,000 + 3,500,000 = 8,500,000
    expect(snap.available_cash.amount_subunits).toBe('8500000');
    expect(snap.cumulative_realized_pnl.amount_subunits).toBe('1000000');

    const pos = portfolio.getPosition(canonicalProductId);
    expect(pos?.net_quantity).toBe(10);
    expect(pos?.weighted_cost_basis_subunits).toBe('250000');
    expect(pos?.cumulative_realized_pnl_subunits).toBe('1000000');
  });

  it('M2-PORTFOLIO-SHORT-POLICY-015: Disallows short-selling by default, rejecting excess sell fills without partial mutation', () => {
    const portfolio = new SimulationPortfolio({
      initialCash: createCanonicalMoney('10000000', 'INR', 4),
      allowShort: false
    });

    const sellOrder: SimulatedOrderRecord = {
      order_id: 'ord-short-01',
      intent_id: 'intent-short-01',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      side: 'SELL',
      order_price: createCanonicalMoney('100000', 'INR', 4),
      total_quantity: 10,
      filled_quantity: 10,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-11T12:00:00Z',
      updated_at_utc: '2026-10-11T12:00:01Z',
      fills: [],
      events: [],
      intent_sha256: 'c'.repeat(64)
    };

    expect(() => portfolio.processFill({
      fill_id: 'fill-short-01',
      order_id: sellOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:01Z',
      fill_price: createCanonicalMoney('100000', 'INR', 4),
      fill_quantity: 5,
      cumulative_quantity: 5,
      remaining_quantity: 0
    }, sellOrder, '2026-10-11T12:00:01Z')).toThrow(/E-ERR-042: INSUFFICIENT_INVENTORY/);

    // Verify balances untouched
    const snap = portfolio.getSnapshot();
    expect(snap.available_cash.amount_subunits).toBe('10000000');
    expect(snap.journal.length).toBe(0);
  });

  it('M2-PORTFOLIO-ATOMIC-FAIL-016: Rejects insufficient cash and currency mismatch atomically without state corruption', () => {
    const portfolio = new SimulationPortfolio({
      initialCash: createCanonicalMoney('1000000', 'INR', 4) // 100.0000 INR
    });

    const buyOrder: SimulatedOrderRecord = {
      order_id: 'ord-fail-01',
      intent_id: 'intent-fail-01',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      side: 'BUY',
      order_price: createCanonicalMoney('500000', 'INR', 4),
      total_quantity: 10,
      filled_quantity: 10,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-11T12:00:00Z',
      updated_at_utc: '2026-10-11T12:00:01Z',
      fills: [],
      events: [],
      intent_sha256: 'd'.repeat(64)
    };

    // Insufficient cash: Requires 50 * 10 = 500 INR, available is only 100 INR
    expect(() => portfolio.processFill({
      fill_id: 'fill-fail-cash',
      order_id: buyOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:01Z',
      fill_price: createCanonicalMoney('500000', 'INR', 4),
      fill_quantity: 10,
      cumulative_quantity: 10,
      remaining_quantity: 0
    }, buyOrder, '2026-10-11T12:00:01Z')).toThrow(/E-ERR-041: INSUFFICIENT_CASH/);

    // Currency mismatch: USD fill on INR portfolio
    expect(() => portfolio.processFill({
      fill_id: 'fill-fail-cur',
      order_id: buyOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:01Z',
      fill_price: createCanonicalMoney('500000', 'USD', 4),
      fill_quantity: 1,
      cumulative_quantity: 1,
      remaining_quantity: 0
    }, buyOrder, '2026-10-11T12:00:01Z')).toThrow(/E-ERR-043: CURRENCY_MISMATCH/);

    // Check balances remain pristine
    const snap = portfolio.getSnapshot();
    expect(snap.available_cash.amount_subunits).toBe('1000000');
    expect(snap.positions.length).toBe(0);
    expect(snap.journal.length).toBe(0);
  });

  it('M2-PORTFOLIO-FILL-IDEMPOTENCY-017: Replaying duplicate fill returns identical state without double counting', () => {
    const portfolio = new SimulationPortfolio({
      initialCash: createCanonicalMoney('10000000', 'INR', 4)
    });

    const buyOrder: SimulatedOrderRecord = {
      order_id: 'ord-idemp-01',
      intent_id: 'intent-idemp-01',
      offer_id: offerId,
      product_id: canonicalProductId,
      venue_id: venueId,
      side: 'BUY',
      order_price: createCanonicalMoney('100000', 'INR', 4),
      total_quantity: 10,
      filled_quantity: 10,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-11T12:00:00Z',
      updated_at_utc: '2026-10-11T12:00:01Z',
      fills: [],
      events: [],
      intent_sha256: 'e'.repeat(64)
    };

    const fill: SimulatedFillEvent = {
      fill_id: 'fill-idemp-test-01',
      order_id: buyOrder.order_id,
      fill_timestamp_utc: '2026-10-11T12:00:01Z',
      fill_price: createCanonicalMoney('100000', 'INR', 4),
      fill_quantity: 10,
      cumulative_quantity: 10,
      remaining_quantity: 0
    };

    const firstSnap = portfolio.processFill(fill, buyOrder, '2026-10-11T12:00:01Z');
    expect(firstSnap.available_cash.amount_subunits).toBe('9000000');
    expect(firstSnap.journal.length).toBe(1);

    // Replay identical fill
    const secondSnap = portfolio.processFill(fill, buyOrder, '2026-10-11T12:00:02Z');
    expect(secondSnap.available_cash.amount_subunits).toBe('9000000');
    expect(secondSnap.journal.length).toBe(1);
    expect(portfolio.isFillProcessed('fill-idemp-test-01')).toBe(true);
  });

  it('M2-PORTFOLIO-CANCEL-INDEPENDENCE-018: Cancelling gateway order does not alter or reverse prior fills', () => {
    const gateway = new SimulatedExecutionGateway();
    const portfolio = new SimulationPortfolio({
      initialCash: createCanonicalMoney('10000000', 'INR', 4)
    });

    const intent = createSampleIntent('intent-part-cancel-01', 'f'.repeat(64));
    const order = gateway.submitExecutionIntent(intent, '2026-10-11T12:00:01Z');

    // Partial fill 20 units
    const filledOrder = gateway.simulateFill(
      order.order_id,
      20,
      createCanonicalMoney('100000', 'INR', 4),
      '2026-10-11T12:00:02Z'
    );

    // Consume fill into portfolio
    portfolio.processFill(filledOrder.fills[0], filledOrder, '2026-10-11T12:00:02Z');

    expect(portfolio.getSnapshot().available_cash.amount_subunits).toBe('8000000');
    expect(portfolio.getPosition(canonicalProductId)?.net_quantity).toBe(20);

    // Cancel remaining order balance in gateway
    gateway.requestCancellation(order.order_id, '2026-10-11T12:00:03Z');
    gateway.confirmCancellation(order.order_id, '2026-10-11T12:00:04Z');

    // Prior fill remains permanently intact in portfolio
    expect(portfolio.getSnapshot().available_cash.amount_subunits).toBe('8000000');
    expect(portfolio.getPosition(canonicalProductId)?.net_quantity).toBe(20);
    expect(portfolio.getJournal().length).toBe(1);
  });

  it('M2-PORTFOLIO-IMMUTABILITY-019: Deep immutability protects portfolio snapshot and journal from caller mutation', () => {
    const portfolio = new SimulationPortfolio({
      initialCash: createCanonicalMoney('10000000', 'INR', 4)
    });

    const snap = portfolio.getSnapshot();

    expect(() => {
      (snap.available_cash as any).amount_subunits = '99999999';
    }).toThrow();

    expect(() => {
      (snap.journal as any).push({ entry_id: 'fake' });
    }).toThrow();
  });
});
