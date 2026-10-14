import {
  CanonicalMoney,
  CanonicalOffer,
  createCanonicalMoney,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256 } from '../canonical/crypto.js';
import { deepFreeze } from '../verification/gate.js';
import {
  NormalizedMarketFeedEvent,
  MarketFeedHandler
} from '../feeds/feedHandler.js';
import {
  DryRunExecutionEngine,
  ExecutionIntent
} from '../execution/engine.js';
import {
  SimulatedExecutionGateway,
  SimulatedOrderRecord,
  SimulatedFillEvent
} from '../execution/simulatedGateway.js';
import {
  SimulationPortfolio,
  PortfolioSnapshot
} from '../portfolio/simulationPortfolio.js';
import { DeterministicClock } from '../canonical/deterministic.js';

export interface PipelineStepReport {
  offer_id: string;
  intent: ExecutionIntent;
  order: SimulatedOrderRecord | null;
  fill: SimulatedFillEvent | null;
  portfolio_snapshot: PortfolioSnapshot | null;
  invariants_satisfied: boolean;
  executed: boolean;
  skip_reason?: string;
}

export interface SimulationPipelineOptions {
  feedHandler?: MarketFeedHandler;
  executionEngine?: DryRunExecutionEngine;
  executionGateway?: SimulatedExecutionGateway;
  initialCash: CanonicalMoney;
  allowShort?: boolean;
  autoFundInventoryFromOffer?: boolean;
  clock?: DeterministicClock;
}

/**
 * Deterministic Simulation Pipeline Coordinator (Gate M2 Increment 4)
 * 
 * Orchestrates the closed event-driven simulation loop:
 * MarketFeedHandler -> DryRunExecutionEngine -> SimulatedExecutionGateway -> SimulationPortfolio
 * 
 * Non-Negotiable Pipeline Invariants:
 * 1. Deterministic Replay: Identical inputs yield identical execution decisions, orders, balances, and state digest.
 * 2. Conservation of Capital: Available Cash + Aggregate Open Cost === Initial Cash + Realized P&L (verified per-event).
 * 3. Quantity Conservation: Filled Quantity + Remaining Quantity === Total Order Quantity.
 * 4. Dual-Ledger Safety: Locked strictly to DRY_RUN; all actuals ledger mutations fail closed (E-ERR-020).
 * 5. Strict Provenance: All events and downstream records retain explicit simulated provenance.
 */
export class SimulationPipeline {
  private feedHandler: MarketFeedHandler;
  private executionEngine: DryRunExecutionEngine;
  private executionGateway: SimulatedExecutionGateway;
  private portfolio: SimulationPortfolio;
  private autoFundInventoryFromOffer: boolean;
  private clock?: DeterministicClock;
  private verifiedOffers: Map<string, CanonicalOffer> = new Map();
  private processedEventsHistory: NormalizedMarketFeedEvent[] = [];
  private stepReports: PipelineStepReport[] = [];

  constructor(options: SimulationPipelineOptions) {
    this.feedHandler = options.feedHandler ?? new MarketFeedHandler();
    this.executionEngine = options.executionEngine ?? new DryRunExecutionEngine();
    this.clock = options.clock;
    this.executionGateway = options.executionGateway ?? new SimulatedExecutionGateway({
      clock: options.clock
    });
    this.autoFundInventoryFromOffer = options.autoFundInventoryFromOffer ?? true;
    this.portfolio = new SimulationPortfolio({
      initialCash: options.initialCash,
      allowShort: options.allowShort ?? false
    });
  }

  public getClock(): DeterministicClock | undefined {
    return this.clock;
  }

  public getFeedHandler(): MarketFeedHandler {
    return this.feedHandler;
  }

  public getExecutionEngine(): DryRunExecutionEngine {
    return this.executionEngine;
  }

  public getExecutionGateway(): SimulatedExecutionGateway {
    return this.executionGateway;
  }

  public getPortfolio(): SimulationPortfolio {
    return this.portfolio;
  }

  public registerVerifiedOffer(offer: CanonicalOffer): void {
    if (offer.verification_status !== 'VERIFIED') {
      throw new Error(`E-ERR-024: UNVERIFIED_OFFER: Cannot register offer with status '${offer.verification_status}'`);
    }
    if (offer.offer_status !== 'VERIFIED_EXECUTABLE_OFFER') {
      throw new Error(`E-ERR-024: UNVERIFIED_OFFER: Cannot register offer with offer status '${offer.offer_status}'`);
    }
    this.verifiedOffers.set(offer.offer_id, { ...offer });
  }

  public getVerifiedOffer(offer_id: string): CanonicalOffer | null {
    const off = this.verifiedOffers.get(offer_id);
    return off ? deepFreeze({ ...off }) : null;
  }

  /**
   * Processes a normalized market data event through the entire execution and accounting pipeline.
   * Atomically coordinates intent evaluation, order lifecycle submission, venue fill execution,
   * and portfolio position update. Verifies continuous accounting invariants at every step.
   */
  public processMarketEvent(event: NormalizedMarketFeedEvent, nowUtc?: string): PipelineStepReport[] {
    const currentTime = nowUtc ?? this.clock?.nowUtc() ?? new Date().toISOString();
    validateIso8601UtcTimestamp(currentTime);

    // Provenance Check: reject any attempt to pass live capital claims
    if (event.provenance.is_authenticated_source_feed) {
      throw new Error('E-ERR-020: ACTUALS_LEDGER_WRITE_VIOLATION: Authenticated live venue feeds forbidden in simulation pipeline');
    }

    this.processedEventsHistory.push({ ...event });
    const reports: PipelineStepReport[] = [];

    // Find verified offers for this product
    for (const offer of this.verifiedOffers.values()) {
      if (offer.product_id !== event.product_id) continue;

      // 1. Evaluate Execution Intent
      const intent = this.executionEngine.evaluateExecutionIntent(offer, event, currentTime);

      // Verify mode is strictly DRY_RUN
      if (intent.payload.mode !== 'DRY_RUN') {
        throw new Error('E-ERR-020: ACTUALS_LEDGER_WRITE_VIOLATION: Pipeline strictly restricted to DRY_RUN');
      }

      if (intent.payload.decision_status !== 'EXECUTE_DRY_RUN') {
        const skipReport: PipelineStepReport = {
          offer_id: offer.offer_id,
          intent,
          order: null,
          fill: null,
          portfolio_snapshot: this.portfolio.getSnapshot(),
          invariants_satisfied: true,
          executed: false,
          skip_reason: `${intent.payload.decision_status}: ${intent.payload.decision_reason}`
        };
        reports.push(skipReport);
        this.stepReports.push(skipReport);
        continue;
      }

      const fillQty = intent.payload.order_quantity;
      const fillPrice = intent.payload.market_unit_price;

      // Commercial Arbitrage Execution:
      // If selling into market bid, fund inventory from supplier offer first
      if (this.autoFundInventoryFromOffer && intent.payload.target_side === 'SELL') {
        const buyNotionalSubunits = (BigInt(offer.unit_price.amount_subunits) * BigInt(fillQty)).toString();
        const supplierPayload = {
          ...intent.payload,
          intent_id: `sup:${intent.payload.intent_id}`,
          target_side: 'BUY' as const,
          market_unit_price: offer.unit_price,
          gross_notional: createCanonicalMoney(buyNotionalSubunits, offer.unit_price.currency, offer.unit_price.scale)
        };
        const supplierIntent: ExecutionIntent = {
          payload: supplierPayload,
          canonical_intent_sha256: sha256(Buffer.from(canonicalizeJCS(supplierPayload), 'utf8'))
        };
        const buyOrder = this.executionGateway.submitExecutionIntent(supplierIntent, currentTime);
        const buyFilled = this.executionGateway.simulateFill(buyOrder.order_id, fillQty, offer.unit_price, currentTime);
        this.portfolio.processFill(buyFilled.fills[0], buyFilled, currentTime);
      }

      // 2. Submit Intent to Execution Gateway (Market Venue Leg)
      const order = this.executionGateway.submitExecutionIntent(intent, currentTime);

      // 3. Simulate Venue Fill
      const filledOrder = this.executionGateway.simulateFill(order.order_id, fillQty, fillPrice, currentTime);
      const latestFill = filledOrder.fills[filledOrder.fills.length - 1];

      // 4. Update Simulation Portfolio
      const portfolioSnap = this.portfolio.processFill(latestFill, filledOrder, currentTime);

      // 4b. Decrement available quantity on verified offer to prevent infinite inventory replay
      const currentOffer = this.verifiedOffers.get(offer.offer_id);
      if (currentOffer && currentOffer.available_quantity !== undefined) {
        currentOffer.available_quantity = Math.max(0, currentOffer.available_quantity - fillQty);
        if (currentOffer.available_quantity < currentOffer.minimum_order_quantity) {
          currentOffer.offer_status = 'EXPIRED_OFFER';
        }
      }

      // 5. Verify Continuous Accounting Invariants
      const invariantsSatisfied = this.verifyAccountingInvariants(filledOrder, portfolioSnap);
      if (!invariantsSatisfied) {
        throw new Error('E-ERR-024: ACCOUNTING_INVARIANT_VIOLATION: Pipeline capital or quantity conservation broken');
      }

      const successReport: PipelineStepReport = {
        offer_id: offer.offer_id,
        intent,
        order: filledOrder,
        fill: latestFill,
        portfolio_snapshot: portfolioSnap,
        invariants_satisfied: true,
        executed: true
      };

      reports.push(successReport);
      this.stepReports.push(successReport);
    }

    return reports;
  }

  /**
   * Continuous Invariant Verification:
   * 1. Quantity Conservation: Filled Quantity + Remaining Quantity === Total Quantity
   * 2. Capital Conservation: Available Cash + Open Inventory Aggregate Cost === Initial Cash + Cumulative Realized P&L
   */
  public verifyAccountingInvariants(
    order: SimulatedOrderRecord,
    portfolioSnap: PortfolioSnapshot
  ): boolean {
    // Invariant 1: Order Quantity Conservation
    if (order.filled_quantity + order.remaining_quantity !== order.total_quantity) {
      return false;
    }

    // Invariant 2: Capital Conservation across all open inventory
    let totalAggregateOpenCostBig = 0n;
    for (const pos of portfolioSnap.positions) {
      totalAggregateOpenCostBig += BigInt(pos.aggregate_cost_subunits);
    }

    const availableCashBig = BigInt(portfolioSnap.available_cash.amount_subunits);
    const initialCashBig = BigInt(portfolioSnap.initial_cash.amount_subunits);
    const cumulativePnlBig = BigInt(portfolioSnap.cumulative_realized_pnl.amount_subunits);

    const totalAssetsBig = availableCashBig + totalAggregateOpenCostBig;
    const expectedAssetsBig = initialCashBig + cumulativePnlBig;

    return totalAssetsBig === expectedAssetsBig;
  }

  public getStepReports(): readonly PipelineStepReport[] {
    return deepFreeze(this.stepReports.map(r => ({ ...r })));
  }

  /**
   * Computes a deterministic cryptographic state digest of the entire pipeline.
   * Serializes normalized event log, order histories, transition journals, portfolio snapshots,
   * and audit journals via RFC 8785 JCS, and computes SHA-256 digest.
   */
  public computeStateDigest(): string {
    const snap = this.portfolio.getSnapshot();

    const canonicalState = {
      pipeline_version: 'GATE-M2-SIM-v0.2.0',
      processed_events_count: this.processedEventsHistory.length,
      offers_count: this.verifiedOffers.size,
      reports_count: this.stepReports.length,
      events: this.processedEventsHistory,
      offers: Array.from(this.verifiedOffers.values()).sort((a, b) => a.offer_id.localeCompare(b.offer_id)),
      orders: this.executionGateway.getAllOrders(),
      portfolio: {
        currency: snap.currency,
        scale: snap.scale,
        available_cash_subunits: snap.available_cash.amount_subunits,
        cumulative_realized_pnl_subunits: snap.cumulative_realized_pnl.amount_subunits,
        positions: snap.positions.map(p => ({
          product_id: p.product_id,
          net_quantity: p.net_quantity,
          aggregate_cost_subunits: p.aggregate_cost_subunits,
          weighted_cost_basis_subunits: p.weighted_cost_basis_subunits,
          cumulative_realized_pnl_subunits: p.cumulative_realized_pnl_subunits
        })),
        journal: snap.journal
      },
      step_reports: this.stepReports.map(r => ({
        offer_id: r.offer_id,
        executed: r.executed,
        invariants_satisfied: r.invariants_satisfied,
        skip_reason: r.skip_reason
      }))
    };

    const jcsBytes = Buffer.from(canonicalizeJCS(canonicalState), 'utf8');
    return sha256(jcsBytes);
  }
}
