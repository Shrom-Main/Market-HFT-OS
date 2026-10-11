import { validateIso8601UtcTimestamp } from '../canonical/domain.js';

export interface OperatingCashFlowEntry {
  entry_timestamp_utc: string;
  sequence_number: number;
  amount: number; // Positive for inflow, negative for outflow
  flow_kind:
    | 'PROCUREMENT_OUTLAY'
    | 'FREIGHT'
    | 'CUSTOMS_DUTIES'
    | 'STATUTORY_TAX_REMIT'
    | 'NET_MERCHANT_PROCEEDS'
    | 'ITC_RECOVERY'
    | 'GROSS_CHECKOUT_PROCEEDS'
    | 'SETTLEMENT_DEDUCTION'
    | 'NET_MERCHANT_DISBURSEMENT';
}

export interface CashFlowSeriesValidationResult {
  has_gross: boolean;
  has_net_disbursement: boolean;
}

export function validateCashFlowDoubleCounting(entries: OperatingCashFlowEntry[]): void {
  let hasGross = false;
  let hasNetDisbursement = false;

  for (const entry of entries) {
    if (entry.flow_kind === 'GROSS_CHECKOUT_PROCEEDS') {
      hasGross = true;
    }
    if (entry.flow_kind === 'NET_MERCHANT_DISBURSEMENT') {
      hasNetDisbursement = true;
    }
  }

  if (hasGross && hasNetDisbursement) {
    throw new Error('E-ERR-038: CASH_FLOW_DOUBLE_COUNTING_PROHIBITED: Cannot include both gross checkout proceeds and net merchant disbursements in operating series');
  }
}

export interface OperatingCashSeriesResult {
  cumulative_balances: number[]; // B_ops(k) for k = 0, 1, ..., K
  peak_operating_funding: number; // C_peak, ops
  peak_daily_net_ops: number;     // C_peak, daily_net_ops
}

export function computeOperatingCashFlowSeries(
  entries: OperatingCashFlowEntry[],
  position_inception_utc: string
): OperatingCashSeriesResult {
  validateCashFlowDoubleCounting(entries);
  validateIso8601UtcTimestamp(position_inception_utc);

  // Deterministic sort strictly by (entry_timestamp_utc, sequence_number)
  const sorted = [...entries].sort((a, b) => {
    if (a.entry_timestamp_utc < b.entry_timestamp_utc) return -1;
    if (a.entry_timestamp_utc > b.entry_timestamp_utc) return 1;
    return a.sequence_number - b.sequence_number;
  });

  // Pre-event baseline B_ops(0) === 0
  const balances: number[] = [0];
  let currentBalance = 0;
  let maxDeficit = 0;

  for (let j = 0; j < sorted.length; j++) {
    const amount = sorted[j].amount;
    currentBalance += amount;
    balances.push(currentBalance);
    const deficit = -currentBalance;
    if (deficit > maxDeficit) {
      maxDeficit = deficit;
    }
  }

  const peak_operating_funding = Math.max(0, maxDeficit);

  // Group by midnight UTC date for Net Daily Operating Funding
  const dailyNets = new Map<string, number>();
  for (const entry of sorted) {
    const dateKey = entry.entry_timestamp_utc.substring(0, 10);
    const prev = dailyNets.get(dateKey) || 0;
    dailyNets.set(dateKey, prev + entry.amount);
  }

  let dailyRunningBalance = 0;
  let maxDailyDeficit = 0;
  for (const [, net] of dailyNets.entries()) {
    dailyRunningBalance += net;
    const deficit = -dailyRunningBalance;
    if (deficit > maxDailyDeficit) {
      maxDailyDeficit = deficit;
    }
  }
  const peak_daily_net_ops = Math.max(0, maxDailyDeficit);

  return {
    cumulative_balances: balances,
    peak_operating_funding,
    peak_daily_net_ops
  };
}

export interface CapitalRecoveryResult {
  status: 'RECOVERED' | 'NOT_RECOVERED' | 'ZERO_OPERATING_OUTLAY';
  k_outlay?: number;
  outlay_timestamp_utc?: string;
  k_rec?: number;
  recovery_timestamp_utc?: string;
  outlay_recovery_duration_days?: number;
  lifecycle_recovery_duration_days?: number;
  peak_operating_funding: number;
  note?: string;
}

export function computePostOutlayRecoveryMetrics(
  entries: OperatingCashFlowEntry[],
  position_inception_utc: string
): CapitalRecoveryResult {
  validateCashFlowDoubleCounting(entries);
  validateIso8601UtcTimestamp(position_inception_utc);
  const t0_ms = Date.parse(position_inception_utc);

  const sorted = [...entries].sort((a, b) => {
    if (a.entry_timestamp_utc < b.entry_timestamp_utc) return -1;
    if (a.entry_timestamp_utc > b.entry_timestamp_utc) return 1;
    return a.sequence_number - b.sequence_number;
  });

  const balances: number[] = [0]; // B_ops(0) === 0
  let currentBalance = 0;
  let maxDeficit = 0;

  for (let j = 0; j < sorted.length; j++) {
    currentBalance += sorted[j].amount;
    balances.push(currentBalance);
    if (-currentBalance > maxDeficit) {
      maxDeficit = -currentBalance;
    }
  }
  const peak_funding = Math.max(0, maxDeficit);

  // 1. Check funded outlay precondition
  let k_outlay = -1;
  for (let k = 1; k < balances.length; k++) {
    if (balances[k] < 0) {
      k_outlay = k;
      break;
    }
  }

  if (k_outlay === -1) {
    return {
      status: 'ZERO_OPERATING_OUTLAY',
      peak_operating_funding: 0,
      note: 'Cumulative operating cash balance never entered negative territory'
    };
  }

  const outlay_entry = sorted[k_outlay - 1];
  const t_outlay_ms = Date.parse(outlay_entry.entry_timestamp_utc);

  // 2. Strict post-outlay zero-crossing
  let k_rec = -1;
  for (let k = k_outlay + 1; k < balances.length; k++) {
    if (balances[k] >= 0) {
      k_rec = k;
      break;
    }
  }

  if (k_rec === -1) {
    return {
      status: 'NOT_RECOVERED',
      k_outlay,
      outlay_timestamp_utc: outlay_entry.entry_timestamp_utc,
      peak_operating_funding: peak_funding,
      note: 'Operating cash balance entered deficit but has not returned to zero or above'
    };
  }

  const rec_entry = sorted[k_rec - 1];
  const t_rec_ms = Date.parse(rec_entry.entry_timestamp_utc);

  const MS_PER_DAY = 86400000;
  const outlay_recovery_days = Math.floor((t_rec_ms - t_outlay_ms) / MS_PER_DAY);
  const lifecycle_recovery_days = Math.floor((t_rec_ms - t0_ms) / MS_PER_DAY);

  return {
    status: 'RECOVERED',
    k_outlay,
    outlay_timestamp_utc: outlay_entry.entry_timestamp_utc,
    k_rec,
    recovery_timestamp_utc: rec_entry.entry_timestamp_utc,
    outlay_recovery_duration_days: outlay_recovery_days,
    lifecycle_recovery_duration_days: lifecycle_recovery_days,
    peak_operating_funding: peak_funding
  };
}

export type RoPFResult =
  | { status: 'SUCCESS'; ropf_percentage: number }
  | { status: 'ZERO_OPERATING_OUTLAY'; note: string }
  | { status: 'DATA_REQUIRED'; note: string };

export function computeRoPF(
  entries: OperatingCashFlowEntry[],
  position_inception_utc: string,
  verified_ending_valuation?: number | null
): RoPFResult {
  if (verified_ending_valuation === undefined || verified_ending_valuation === null) {
    return { status: 'DATA_REQUIRED', note: 'Missing or unverified ending inventory valuation' };
  }

  const series = computeOperatingCashFlowSeries(entries, position_inception_utc);
  if (series.peak_operating_funding === 0) {
    return {
      status: 'ZERO_OPERATING_OUTLAY',
      note: 'Cumulative operating cash flow series never entered deficit; RoPF undefined'
    };
  }

  const sumOperatingFlows = entries.reduce((acc, e) => acc + e.amount, 0);
  const ropf = ((sumOperatingFlows + verified_ending_valuation) / series.peak_operating_funding) * 100;

  return {
    status: 'SUCCESS',
    ropf_percentage: ropf
  };
}

export function computeCoC(entries: OperatingCashFlowEntry[]): number | { status: 'DATA_REQUIRED'; note: string } {
  let inflows = 0;
  let outflows = 0;

  for (const e of entries) {
    if (e.amount > 0) {
      inflows += e.amount;
    } else if (e.amount < 0) {
      outflows += Math.abs(e.amount);
    }
  }

  if (outflows === 0) {
    return { status: 'DATA_REQUIRED', note: 'No operating cash outflows recorded; CoC undefined' };
  }

  return inflows / outflows;
}

export function computeHPR(v0: number, vT: number, distributions: number): number {
  if (v0 <= 0) {
    throw new Error('E-ERR-024: INVALID_INITIAL_VALUE: Initial capital must be strictly positive for HPR');
  }
  return ((vT - v0 + distributions) / v0) * 100;
}

export interface PurchaseOrderLifecycleState {
  po_id: string;
  authorized_amount: number;
  unfulfilled_commitment: number;
  status: 'AUTHORIZED' | 'CANCELLED' | 'FULFILLED' | 'REPLACED';
}

export class CommittedCapitalManager {
  private orders: Map<string, PurchaseOrderLifecycleState> = new Map();
  public total_committed_capital: number = 0;

  public authorizePO(po_id: string, amount: number): void {
    if (this.orders.has(po_id)) {
      throw new Error(`E-ERR-035: DUPLICATE_PO: Purchase order '${po_id}' already exists`);
    }
    this.orders.set(po_id, {
      po_id,
      authorized_amount: amount,
      unfulfilled_commitment: amount,
      status: 'AUTHORIZED'
    });
    this.total_committed_capital += amount;
  }

  public cancelPO(po_id: string): void {
    const po = this.orders.get(po_id);
    if (!po) throw new Error(`E-ERR-035: UNKNOWN_PO: '${po_id}'`);
    if (['CANCELLED', 'REPLACED'].includes(po.status)) {
      throw new Error(`E-ERR-035: PO_ALREADY_TERMINAL: '${po_id}'`);
    }
    this.total_committed_capital -= po.unfulfilled_commitment;
    po.unfulfilled_commitment = 0;
    po.status = 'CANCELLED';
  }

  public fulfillPO(po_id: string, delivery_amount: number): void {
    const po = this.orders.get(po_id);
    if (!po) throw new Error(`E-ERR-035: UNKNOWN_PO: '${po_id}'`);
    if (['CANCELLED', 'REPLACED'].includes(po.status)) {
      throw new Error(`E-ERR-035: PO_ALREADY_TERMINAL: '${po_id}'`);
    }
    const relief = Math.min(delivery_amount, po.unfulfilled_commitment);
    po.unfulfilled_commitment -= relief;
    this.total_committed_capital -= relief;
    if (po.unfulfilled_commitment === 0) {
      po.status = 'FULFILLED';
    }
  }

  public replacePO(old_po_id: string, new_po_id: string, new_amount: number): void {
    const old_po = this.orders.get(old_po_id);
    if (!old_po) throw new Error(`E-ERR-035: UNKNOWN_PO: '${old_po_id}'`);
    if (['CANCELLED', 'REPLACED'].includes(old_po.status)) {
      throw new Error(`E-ERR-035: PO_ALREADY_TERMINAL: '${old_po_id}'`);
    }
    this.total_committed_capital -= old_po.unfulfilled_commitment;
    old_po.unfulfilled_commitment = 0;
    old_po.status = 'REPLACED';

    this.authorizePO(new_po_id, new_amount);
  }
}
