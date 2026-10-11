import {
  CanonicalMoney,
  CurrencyCode,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256 } from '../canonical/crypto.js';
import { deepFreeze } from '../verification/gate.js';
import {
  SimulatedFillEvent,
  SimulatedOrderRecord
} from '../execution/simulatedGateway.js';

export interface CostBasisRational {
  numerator_subunits: string;
  denominator_quantity: number;
}

export interface PositionSnapshot {
  product_id: string;
  net_quantity: number;
  total_bought_quantity: number;
  total_sold_quantity: number;
  aggregate_cost_subunits: string;
  cost_basis_rational: CostBasisRational;
  weighted_cost_basis_subunits: string;
  cumulative_realized_pnl_subunits: string;
  epoch_start_cost_subunits?: string;
  epoch_start_quantity?: number;
  epoch_cumulative_sold_quantity?: number;
}

export interface PortfolioJournalEntry {
  entry_id: string;
  sequence_number: number;
  timestamp_utc: string;
  order_id: string;
  intent_id: string;
  fill_id: string;
  product_id: string;
  side: 'BUY' | 'SELL';
  fill_quantity: number;
  fill_price: CanonicalMoney;
  total_notional_subunits: string;
  cash_balance_before: CanonicalMoney;
  cash_balance_after: CanonicalMoney;
  position_before: PositionSnapshot;
  position_after: PositionSnapshot;
  realized_pnl_delta_subunits: string;
  cumulative_realized_pnl_subunits: string;
}

export interface PortfolioSnapshot {
  currency: CurrencyCode;
  scale: number;
  initial_cash: CanonicalMoney;
  available_cash: CanonicalMoney;
  positions: readonly PositionSnapshot[];
  cumulative_realized_pnl: CanonicalMoney;
  journal: readonly PortfolioJournalEntry[];
}

export interface PortfolioCheckpoint {
  currency: CurrencyCode;
  scale: number;
  initial_cash: CanonicalMoney;
  available_cash_subunits: string;
  cumulative_realized_pnl_subunits: string;
  allow_short: boolean;
  positions: Array<{
    product_id: string;
    net_quantity: number;
    total_bought_quantity: number;
    total_sold_quantity: number;
    aggregate_cost_subunits: string;
    cumulative_realized_pnl_subunits: string;
    epoch_start_cost_subunits: string;
    epoch_start_quantity: number;
    epoch_cumulative_sold_quantity: number;
  }>;
  processed_fill_ids: string[];
  processed_fill_fingerprints: Array<[string, string]>;
  journal: PortfolioJournalEntry[];
}

export interface SimulationPortfolioOptions {
  initialCash: CanonicalMoney;
  allowShort?: boolean;
}

interface InternalPosition {
  product_id: string;
  net_quantity: number;
  total_bought_quantity: number;
  total_sold_quantity: number;
  aggregate_cost_subunits: string;
  cumulative_realized_pnl_subunits: string;
  epoch_start_cost_subunits: string;
  epoch_start_quantity: number;
  epoch_cumulative_sold_quantity: number;
}

/**
 * Deterministic HALF_EVEN rounding (banker's rounding) on positive integer division.
 * Computes round(numerator / denominator) where numerator >= 0 and denominator > 0.
 * - If 2 * remainder > denominator => rounds up
 * - If 2 * remainder < denominator => rounds down
 * - If 2 * remainder == denominator => rounds to nearest even integer
 */
export function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error('E-ERR-024: DIVISION_BY_ZERO: Denominator cannot be zero in divideHalfEven');
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twiceRemainder = remainder * 2n;

  if (twiceRemainder > denominator) {
    return quotient + 1n;
  } else if (twiceRemainder < denominator) {
    return quotient;
  } else {
    // Exact halfway boundary: round to nearest even integer
    return quotient % 2n !== 0n ? quotient + 1n : quotient;
  }
}

/**
 * Validates that an accumulated quantity fits within JavaScript safe integer range [0, Number.MAX_SAFE_INTEGER].
 * Throws E-ERR-045 fail-closed if bounds are exceeded.
 */
export function assertSafeQuantity(qtyBig: bigint, label: string): number {
  if (qtyBig < 0n || qtyBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `E-ERR-045: QUANTITY_OVERFLOW: ${label} ${qtyBig.toString()} exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER})`
    );
  }
  return Number(qtyBig);
}

/**
 * Computes deterministic RFC 8785 JCS SHA-256 fingerprint for a simulated fill and order.
 * Canonicalized attributes guarantee bit-exact comparison across restarts and replay events.
 */
export function computeFillFingerprint(
  fill: Pick<SimulatedFillEvent, 'fill_id' | 'order_id' | 'fill_price' | 'fill_quantity' | 'cumulative_quantity' | 'remaining_quantity'>,
  order: Pick<SimulatedOrderRecord, 'product_id' | 'side'>
): string {
  const canonicalFill = {
    cumulative_quantity: fill.cumulative_quantity,
    fill_id: fill.fill_id,
    fill_price: {
      amount_subunits: fill.fill_price.amount_subunits,
      currency: fill.fill_price.currency,
      scale: fill.fill_price.scale
    },
    fill_quantity: fill.fill_quantity,
    order_id: fill.order_id,
    product_id: order.product_id,
    remaining_quantity: fill.remaining_quantity,
    side: order.side
  };
  return sha256(canonicalizeJCS(canonicalFill));
}

/**
 * Deterministic Simulation-Only Portfolio & Position Tracker
 * 
 * Strict Dual-Ledger Isolation & Exact Rational Accounting:
 * - Operates strictly in simulation mode; zero coupling or mutation to actuals ledger.
 * - Single-currency rational arithmetic strictly in BigInt subunits. Floating-point arithmetic is forbidden.
 * - Tracks exact aggregate acquisition cost basis (`aggregate_cost_subunits`) without integer division loss.
 * - Enforces deterministic HALF_EVEN rounding for partial sales.
 * - Preserves Conservation of Basis: COGS + remaining_cost === previous_cost.
 * - Flushes residual fractions completely on final liquidation.
 * - Enforces atomic updates: invalid currency, impossible quantities, or insufficient cash/inventory
 *   fail closed without partial mutation.
 * - Prevents double counting via fill ID idempotency checks and detects conflicting fill ID reuse (E-ERR-046).
 * - Order cancellations do not alter or reverse prior fills.
 * - Disallows unsupported short-selling fail-closed (E-ERR-044).
 * - Enforces cumulative quantity overflow guards against Number.MAX_SAFE_INTEGER (E-ERR-045).
 */
export class SimulationPortfolio {
  private readonly currency: CurrencyCode;
  private readonly scale: number;
  private readonly initialCash: CanonicalMoney;
  private availableCashSubunits: string;
  private cumulativeRealizedPnlSubunits: string = '0';
  private readonly allowShort: boolean;

  private positions: Map<string, InternalPosition> = new Map();
  private processedFillIds: Set<string> = new Set();
  private processedFillFingerprints: Map<string, string> = new Map();
  private journal: PortfolioJournalEntry[] = [];

  constructor(options: SimulationPortfolioOptions) {
    if (!options.initialCash || typeof options.initialCash.amount_subunits !== 'string') {
      throw new Error('E-ERR-024: INVALID_INITIAL_CASH: Initial cash must be a valid CanonicalMoney object with amount_subunits');
    }
    const initBig = BigInt(options.initialCash.amount_subunits);
    if (initBig < 0n) {
      throw new Error(`E-ERR-024: NEGATIVE_INITIAL_CASH: Initial cash cannot be negative, got ${options.initialCash.amount_subunits}`);
    }

    if (options.allowShort === true) {
      throw new Error(
        'E-ERR-044: SHORT_POSITIONS_NOT_SUPPORTED: Short-position accounting is not supported in Gate M2 simulation portfolio. Set allowShort: false or omit.'
      );
    }

    this.currency = options.initialCash.currency;
    this.scale = options.initialCash.scale;
    this.initialCash = { ...options.initialCash };
    this.availableCashSubunits = options.initialCash.amount_subunits;
    this.allowShort = false;
  }

  public getCurrency(): CurrencyCode {
    return this.currency;
  }

  public getScale(): number {
    return this.scale;
  }

  public isShortAllowed(): boolean {
    return this.allowShort;
  }

  public isFillProcessed(fill_id: string): boolean {
    return this.processedFillIds.has(fill_id);
  }

  public getFillFingerprint(fill_id: string): string | undefined {
    return this.processedFillFingerprints.get(fill_id);
  }

  public getProcessedFillsCount(): number {
    return this.processedFillIds.size;
  }

  private getOrCreateInternalPosition(product_id: string): InternalPosition {
    let pos = this.positions.get(product_id);
    if (!pos) {
      pos = {
        product_id,
        net_quantity: 0,
        total_bought_quantity: 0,
        total_sold_quantity: 0,
        aggregate_cost_subunits: '0',
        cumulative_realized_pnl_subunits: '0',
        epoch_start_cost_subunits: '0',
        epoch_start_quantity: 0,
        epoch_cumulative_sold_quantity: 0
      };
      this.positions.set(product_id, pos);
    }
    return pos;
  }

  private clonePositionSnapshot(pos: InternalPosition): PositionSnapshot {
    const netQty = pos.net_quantity;
    const aggCostBig = BigInt(pos.aggregate_cost_subunits);
    const wacbSubunits = netQty > 0 ? (aggCostBig / BigInt(netQty)).toString() : '0';

    return {
      product_id: pos.product_id,
      net_quantity: netQty,
      total_bought_quantity: pos.total_bought_quantity,
      total_sold_quantity: pos.total_sold_quantity,
      aggregate_cost_subunits: pos.aggregate_cost_subunits,
      cost_basis_rational: {
        numerator_subunits: pos.aggregate_cost_subunits,
        denominator_quantity: netQty
      },
      weighted_cost_basis_subunits: wacbSubunits,
      cumulative_realized_pnl_subunits: pos.cumulative_realized_pnl_subunits,
      epoch_start_cost_subunits: pos.epoch_start_cost_subunits,
      epoch_start_quantity: pos.epoch_start_quantity,
      epoch_cumulative_sold_quantity: pos.epoch_cumulative_sold_quantity
    };
  }

  public getPosition(product_id: string): PositionSnapshot | null {
    const pos = this.positions.get(product_id);
    return pos ? deepFreeze(this.clonePositionSnapshot(pos)) : null;
  }

  public getJournal(): readonly PortfolioJournalEntry[] {
    return deepFreeze(this.journal.map(e => ({ ...e })));
  }

  public getSnapshot(): PortfolioSnapshot {
    const posList: PositionSnapshot[] = [];
    for (const pos of this.positions.values()) {
      posList.push(this.clonePositionSnapshot(pos));
    }

    return deepFreeze({
      currency: this.currency,
      scale: this.scale,
      initial_cash: { ...this.initialCash },
      available_cash: {
        currency: this.currency,
        amount_subunits: this.availableCashSubunits,
        scale: this.scale
      },
      positions: posList,
      cumulative_realized_pnl: {
        currency: this.currency,
        amount_subunits: this.cumulativeRealizedPnlSubunits,
        scale: this.scale
      },
      journal: this.journal.map(e => ({ ...e }))
    });
  }

  /**
   * Consumes a recorded simulated fill from the execution gateway.
   * Atomic: fails closed without partial mutation if currency mismatch, impossible quantity,
   * insufficient cash, or insufficient inventory occurs.
   * Idempotent: replaying an already-accounted fill returns the current snapshot without duplicate accounting.
   */
  public processFill(
    fill: SimulatedFillEvent,
    order: SimulatedOrderRecord,
    timestamp_utc: string
  ): PortfolioSnapshot {
    validateIso8601UtcTimestamp(timestamp_utc);

    // 1. Idempotency Check: prevent duplicate fill counting & guard against conflicting fill ID reuse
    const fillFingerprint = computeFillFingerprint(fill, order);
    if (this.processedFillIds.has(fill.fill_id)) {
      const existingFingerprint = this.processedFillFingerprints.get(fill.fill_id);
      if (existingFingerprint !== fillFingerprint) {
        throw new Error(
          `E-ERR-046: FILL_IDEMPOTENCY_CONFLICT: Fill ID '${fill.fill_id}' was previously processed with conflicting attributes (recorded ${existingFingerprint}, received ${fillFingerprint})`
        );
      }
      return this.getSnapshot();
    }

    // 2. Currency & Scale Conformance Check
    if (fill.fill_price.currency !== this.currency || fill.fill_price.scale !== this.scale) {
      throw new Error(
        `E-ERR-043: CURRENCY_MISMATCH: Fill price currency/scale '${fill.fill_price.currency}' (scale ${fill.fill_price.scale}) does not match portfolio '${this.currency}' (scale ${this.scale})`
      );
    }

    // 3. Fill Quantity Validation
    if (!Number.isSafeInteger(fill.fill_quantity) || fill.fill_quantity <= 0) {
      throw new Error(
        `E-ERR-024: INVALID_FILL_QUANTITY: Fill quantity must be a positive safe integer, got ${fill.fill_quantity}`
      );
    }

    // 4. Side & Notional Validation
    if (order.side !== 'BUY' && order.side !== 'SELL') {
      throw new Error(`E-ERR-024: INVALID_ORDER_SIDE: Order side must be BUY or SELL, got '${order.side}'`);
    }

    const priceSubunitsBig = BigInt(fill.fill_price.amount_subunits);
    if (priceSubunitsBig < 0n) {
      throw new Error(`E-ERR-024: NEGATIVE_PRICE: Fill price cannot be negative, got ${fill.fill_price.amount_subunits}`);
    }

    const notionalSubunitsBig = BigInt(fill.fill_quantity) * priceSubunitsBig;
    const availableCashBig = BigInt(this.availableCashSubunits);

    // 5. Pre-execution atomic capacity checks (fail-closed before mutation)
    const existingPos = this.positions.get(order.product_id);
    const posBeforeSnapshot: PositionSnapshot = existingPos
      ? this.clonePositionSnapshot(existingPos)
      : {
          product_id: order.product_id,
          net_quantity: 0,
          total_bought_quantity: 0,
          total_sold_quantity: 0,
          aggregate_cost_subunits: '0',
          cost_basis_rational: {
            numerator_subunits: '0',
            denominator_quantity: 0
          },
          weighted_cost_basis_subunits: '0',
          cumulative_realized_pnl_subunits: '0'
        };

    const cashBeforeSnapshot: CanonicalMoney = {
      currency: this.currency,
      amount_subunits: this.availableCashSubunits,
      scale: this.scale
    };

    let pnlDeltaBig = 0n;
    let currentPos: InternalPosition;

    if (order.side === 'BUY') {
      if (availableCashBig < notionalSubunitsBig) {
        throw new Error(
          `E-ERR-041: INSUFFICIENT_CASH: Required ${notionalSubunitsBig.toString()} subunits for BUY of ${fill.fill_quantity} units, but available cash is ${availableCashBig.toString()} subunits`
        );
      }

      const prevNetQty = existingPos ? existingPos.net_quantity : 0;
      const newNetQtyBig = BigInt(prevNetQty) + BigInt(fill.fill_quantity);
      const safeNewNetQty = assertSafeQuantity(newNetQtyBig, 'Resulting net quantity');

      const prevTotalBought = existingPos ? existingPos.total_bought_quantity : 0;
      const newTotalBoughtBig = BigInt(prevTotalBought) + BigInt(fill.fill_quantity);
      const safeNewTotalBought = assertSafeQuantity(newTotalBoughtBig, 'Resulting total bought quantity');

      // Execute BUY mutations
      this.availableCashSubunits = (availableCashBig - notionalSubunitsBig).toString();

      currentPos = this.getOrCreateInternalPosition(order.product_id);
      currentPos.total_bought_quantity = safeNewTotalBought;

      // Exact aggregate acquisition cost accumulation (zero integer division loss)
      const prevAggregateCost = BigInt(currentPos.aggregate_cost_subunits);
      const newAggregateCost = prevAggregateCost + notionalSubunitsBig;
      currentPos.aggregate_cost_subunits = newAggregateCost.toString();
      currentPos.net_quantity = safeNewNetQty;

      // Re-anchor cost-pool epoch to the new acquisition baseline
      currentPos.epoch_start_cost_subunits = newAggregateCost.toString();
      currentPos.epoch_start_quantity = safeNewNetQty;
      currentPos.epoch_cumulative_sold_quantity = 0;
    } else {
      // SELL
      const availableInventory = existingPos ? existingPos.net_quantity : 0;
      if (fill.fill_quantity > availableInventory) {
        throw new Error(
          `E-ERR-042: INSUFFICIENT_INVENTORY: Cannot sell ${fill.fill_quantity} units of '${order.product_id}'; available inventory is ${availableInventory} (short-selling disabled)`
        );
      }

      const sPrev = BigInt(existingPos?.epoch_cumulative_sold_quantity ?? 0);
      const sNewBig = sPrev + BigInt(fill.fill_quantity);
      const safeSNew = assertSafeQuantity(sNewBig, 'Cumulative sold quantity in epoch');

      const prevTotalSold = existingPos ? existingPos.total_sold_quantity : 0;
      const newTotalSoldBig = BigInt(prevTotalSold) + BigInt(fill.fill_quantity);
      const safeNewTotalSold = assertSafeQuantity(newTotalSoldBig, 'Resulting total sold quantity');

      // Execute SELL mutations
      this.availableCashSubunits = (availableCashBig + notionalSubunitsBig).toString();

      currentPos = this.getOrCreateInternalPosition(order.product_id);
      const prevNetQty = currentPos.net_quantity;

      // Anchored Cumulative Allocation:
      // A(s) = divideHalfEven(C_0 * s, Q_0)
      // COGS_i = A(s_i) - A(s_{i-1})
      // Ensures fill-partition invariance: total COGS for cumulative quantity sold
      // is strictly independent of how that quantity was split across fills.
      const C0 = BigInt(currentPos.epoch_start_cost_subunits);
      const Q0 = BigInt(currentPos.epoch_start_quantity);

      const computeCumulativeCogs = (s: bigint): bigint => {
        if (s <= 0n) return 0n;
        if (Q0 <= 0n) return 0n;
        if (s >= Q0) return C0; // Complete liquidation flushes entire epoch cost
        return divideHalfEven(C0 * s, Q0);
      };

      const cumulativeCogsPrev = computeCumulativeCogs(sPrev);
      const cumulativeCogsNew = computeCumulativeCogs(sNewBig);
      const cogsSubunitsBig = cumulativeCogsNew - cumulativeCogsPrev;

      const newAggregateCost = C0 - cumulativeCogsNew;
      currentPos.aggregate_cost_subunits = newAggregateCost.toString();
      currentPos.net_quantity = prevNetQty - fill.fill_quantity;
      currentPos.total_sold_quantity = safeNewTotalSold;
      currentPos.epoch_cumulative_sold_quantity = safeSNew;

      if (currentPos.net_quantity === 0) {
        // Complete liquidation: reset epoch baseline completely to zero
        currentPos.aggregate_cost_subunits = '0';
        currentPos.epoch_start_cost_subunits = '0';
        currentPos.epoch_start_quantity = 0;
        currentPos.epoch_cumulative_sold_quantity = 0;
      }

      const proceedsSubunitsBig = notionalSubunitsBig;
      pnlDeltaBig = proceedsSubunitsBig - cogsSubunitsBig;

      currentPos.cumulative_realized_pnl_subunits = (
        BigInt(currentPos.cumulative_realized_pnl_subunits) + pnlDeltaBig
      ).toString();

      this.cumulativeRealizedPnlSubunits = (
        BigInt(this.cumulativeRealizedPnlSubunits) + pnlDeltaBig
      ).toString();
    }

    const posAfterSnapshot = this.clonePositionSnapshot(currentPos);
    const cashAfterSnapshot: CanonicalMoney = {
      currency: this.currency,
      amount_subunits: this.availableCashSubunits,
      scale: this.scale
    };

    // 6. Record journal entry and mark fill as processed
    this.processedFillIds.add(fill.fill_id);
    this.processedFillFingerprints.set(fill.fill_id, fillFingerprint);

    const seq = this.journal.length + 1;
    const journalEntry: PortfolioJournalEntry = {
      entry_id: `pf:ent:${seq}`,
      sequence_number: seq,
      timestamp_utc,
      order_id: order.order_id,
      intent_id: order.intent_id,
      fill_id: fill.fill_id,
      product_id: order.product_id,
      side: order.side,
      fill_quantity: fill.fill_quantity,
      fill_price: { ...fill.fill_price },
      total_notional_subunits: notionalSubunitsBig.toString(),
      cash_balance_before: cashBeforeSnapshot,
      cash_balance_after: cashAfterSnapshot,
      position_before: posBeforeSnapshot,
      position_after: posAfterSnapshot,
      realized_pnl_delta_subunits: pnlDeltaBig.toString(),
      cumulative_realized_pnl_subunits: this.cumulativeRealizedPnlSubunits
    };

    this.journal.push(journalEntry);
    return this.getSnapshot();
  }
}
