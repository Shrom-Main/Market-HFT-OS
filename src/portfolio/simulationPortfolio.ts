import {
  CanonicalMoney,
  CurrencyCode,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';
import { deepFreeze } from '../verification/gate.js';
import {
  SimulatedFillEvent,
  SimulatedOrderRecord
} from '../execution/simulatedGateway.js';

export interface PositionSnapshot {
  product_id: string;
  net_quantity: number;
  total_bought_quantity: number;
  total_sold_quantity: number;
  weighted_cost_basis_subunits: string;
  cumulative_realized_pnl_subunits: string;
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

export interface SimulationPortfolioOptions {
  initialCash: CanonicalMoney;
  allowShort?: boolean;
}

interface InternalPosition {
  product_id: string;
  net_quantity: number;
  total_bought_quantity: number;
  total_sold_quantity: number;
  weighted_cost_basis_subunits: string;
  cumulative_realized_pnl_subunits: string;
}

/**
 * Deterministic Simulation-Only Portfolio & Position Tracker
 * 
 * Strict Dual-Ledger Isolation & Accounting Constraints:
 * - Operates strictly in simulation mode; zero coupling or mutation to actuals ledger.
 * - Single-currency rational arithmetic strictly in BigInt subunits. Floating-point arithmetic is forbidden.
 * - Enforces atomic updates: invalid currency, impossible quantities, or insufficient cash/inventory
 *   fail closed without partial mutation.
 * - Prevents double counting via fill ID idempotency checks.
 * - Order cancellations do not alter or reverse prior fills.
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
  private journal: PortfolioJournalEntry[] = [];

  constructor(options: SimulationPortfolioOptions) {
    if (!options.initialCash || typeof options.initialCash.amount_subunits !== 'string') {
      throw new Error('E-ERR-024: INVALID_INITIAL_CASH: Initial cash must be a valid CanonicalMoney object with amount_subunits');
    }
    const initBig = BigInt(options.initialCash.amount_subunits);
    if (initBig < 0n) {
      throw new Error(`E-ERR-024: NEGATIVE_INITIAL_CASH: Initial cash cannot be negative, got ${options.initialCash.amount_subunits}`);
    }

    this.currency = options.initialCash.currency;
    this.scale = options.initialCash.scale;
    this.initialCash = { ...options.initialCash };
    this.availableCashSubunits = options.initialCash.amount_subunits;
    this.allowShort = options.allowShort ?? false;
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

  private getOrCreateInternalPosition(product_id: string): InternalPosition {
    let pos = this.positions.get(product_id);
    if (!pos) {
      pos = {
        product_id,
        net_quantity: 0,
        total_bought_quantity: 0,
        total_sold_quantity: 0,
        weighted_cost_basis_subunits: '0',
        cumulative_realized_pnl_subunits: '0'
      };
      this.positions.set(product_id, pos);
    }
    return pos;
  }

  private clonePositionSnapshot(pos: InternalPosition): PositionSnapshot {
    return {
      product_id: pos.product_id,
      net_quantity: pos.net_quantity,
      total_bought_quantity: pos.total_bought_quantity,
      total_sold_quantity: pos.total_sold_quantity,
      weighted_cost_basis_subunits: pos.weighted_cost_basis_subunits,
      cumulative_realized_pnl_subunits: pos.cumulative_realized_pnl_subunits
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

    // 1. Idempotency Check: prevent duplicate fill counting
    if (this.processedFillIds.has(fill.fill_id)) {
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

      // Execute BUY mutations
      this.availableCashSubunits = (availableCashBig - notionalSubunitsBig).toString();

      currentPos = this.getOrCreateInternalPosition(order.product_id);
      const prevNetQty = currentPos.net_quantity;
      const newNetQty = prevNetQty + fill.fill_quantity;
      currentPos.total_bought_quantity += fill.fill_quantity;

      // Update weighted average cost basis (WACB)
      if (prevNetQty === 0) {
        currentPos.weighted_cost_basis_subunits = fill.fill_price.amount_subunits;
      } else {
        const prevTotalCostBig = BigInt(prevNetQty) * BigInt(currentPos.weighted_cost_basis_subunits);
        const newTotalCostBig = prevTotalCostBig + notionalSubunitsBig;
        currentPos.weighted_cost_basis_subunits = (newTotalCostBig / BigInt(newNetQty)).toString();
      }
      currentPos.net_quantity = newNetQty;
    } else {
      // SELL
      const availableInventory = existingPos ? existingPos.net_quantity : 0;
      if (!this.allowShort && fill.fill_quantity > availableInventory) {
        throw new Error(
          `E-ERR-042: INSUFFICIENT_INVENTORY: Cannot sell ${fill.fill_quantity} units of '${order.product_id}'; available inventory is ${availableInventory} (short-selling disabled)`
        );
      }

      // Execute SELL mutations
      this.availableCashSubunits = (availableCashBig + notionalSubunitsBig).toString();

      currentPos = this.getOrCreateInternalPosition(order.product_id);
      const cogsSubunitsBig = BigInt(fill.fill_quantity) * BigInt(currentPos.weighted_cost_basis_subunits);
      const proceedsSubunitsBig = notionalSubunitsBig;
      pnlDeltaBig = proceedsSubunitsBig - cogsSubunitsBig;

      currentPos.net_quantity -= fill.fill_quantity;
      currentPos.total_sold_quantity += fill.fill_quantity;
      currentPos.cumulative_realized_pnl_subunits = (
        BigInt(currentPos.cumulative_realized_pnl_subunits) + pnlDeltaBig
      ).toString();

      this.cumulativeRealizedPnlSubunits = (
        BigInt(this.cumulativeRealizedPnlSubunits) + pnlDeltaBig
      ).toString();

      // If flat after sell, reset unit cost basis
      if (currentPos.net_quantity === 0) {
        currentPos.weighted_cost_basis_subunits = '0';
      }
    }

    const posAfterSnapshot = this.clonePositionSnapshot(currentPos);
    const cashAfterSnapshot: CanonicalMoney = {
      currency: this.currency,
      amount_subunits: this.availableCashSubunits,
      scale: this.scale
    };

    // 6. Record journal entry and mark fill as processed
    this.processedFillIds.add(fill.fill_id);

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
