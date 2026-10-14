import {
  CanonicalMoney,
  CurrencyCode,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';

export interface OperatingCashFlowEntry {
  entry_timestamp_utc: string;
  sequence_number: number;
  amount: number | bigint | CanonicalMoney; // Positive for inflow, negative for outflow
  amount_subunits?: string; // string representation of integer subunits
  currency?: CurrencyCode; // ISO 4217 currency code
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

export function extractOperatingCashFlowAmount(entry: OperatingCashFlowEntry): number {
  if (entry.amount_subunits !== undefined) {
    const val = BigInt(entry.amount_subunits);
    if (val > BigInt(Number.MAX_SAFE_INTEGER) || val < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error('E-ERR-024: INVALID_CASH_FLOW_AMOUNT: Subunit amount exceeds safe integer range');
    }
    return Number(val);
  }
  if (typeof entry.amount === 'object' && entry.amount !== null && 'amount_subunits' in entry.amount) {
    const val = BigInt(entry.amount.amount_subunits);
    if (val > BigInt(Number.MAX_SAFE_INTEGER) || val < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error('E-ERR-024: INVALID_CASH_FLOW_AMOUNT: Subunit amount exceeds safe integer range');
    }
    return Number(val);
  }
  if (typeof entry.amount === 'bigint') {
    if (entry.amount > BigInt(Number.MAX_SAFE_INTEGER) || entry.amount < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error('E-ERR-024: INVALID_CASH_FLOW_AMOUNT: Subunit amount exceeds safe integer range');
    }
    return Number(entry.amount);
  }
  if (typeof entry.amount === 'number' && Number.isSafeInteger(entry.amount)) {
    return entry.amount;
  }
  throw new Error('E-ERR-024: INVALID_CASH_FLOW_AMOUNT: Operating cash flow amounts must be safe integers or integer subunits');
}

export function validateCashFlowDoubleCounting(entries: OperatingCashFlowEntry[]): void {
  let hasGross = false;
  let hasNetDisbursement = false;
  let hasNetProceeds = false;

  for (const entry of entries) {
    if (entry.flow_kind === 'GROSS_CHECKOUT_PROCEEDS') {
      hasGross = true;
    }
    if (entry.flow_kind === 'NET_MERCHANT_DISBURSEMENT') {
      hasNetDisbursement = true;
    }
    if (entry.flow_kind === 'NET_MERCHANT_PROCEEDS') {
      hasNetProceeds = true;
    }
  }

  if (hasGross && (hasNetDisbursement || hasNetProceeds)) {
    throw new Error('E-ERR-038: CASH_FLOW_DOUBLE_COUNTING_PROHIBITED: Cannot include both gross checkout proceeds and net merchant disbursements or proceeds in operating series');
  }
}

export function validateCashFlowEntries(
  entries: OperatingCashFlowEntry[],
  inceptionMs: number
): void {
  validateCashFlowDoubleCounting(entries);
  let baseCurrency: CurrencyCode | undefined;

  for (const e of entries) {
    validateIso8601UtcTimestamp(e.entry_timestamp_utc);
    extractOperatingCashFlowAmount(e);

    if (e.currency) {
      if (!baseCurrency) {
        baseCurrency = e.currency;
      } else if (baseCurrency !== e.currency) {
        throw new Error(`E-ERR-008: CROSS_CURRENCY_OPERATION_PROHIBITED: Mixed currencies in operating cash flow series ('${baseCurrency}' and '${e.currency}')`);
      }
    }

    if (typeof e.amount === 'object' && e.amount !== null && 'currency' in e.amount) {
      if (!baseCurrency) {
        baseCurrency = e.amount.currency;
      } else if (baseCurrency !== e.amount.currency) {
        throw new Error(`E-ERR-008: CROSS_CURRENCY_OPERATION_PROHIBITED: Mixed currencies in operating cash flow series ('${baseCurrency}' and '${e.amount.currency}')`);
      }
    }

    if (Date.parse(e.entry_timestamp_utc) < inceptionMs) {
      throw new Error('E-ERR-024: CASH_FLOW_BEFORE_INCEPTION: Entry timestamp precedes position inception timestamp');
    }
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
  validateIso8601UtcTimestamp(position_inception_utc);
  const inceptionMs = Date.parse(position_inception_utc);
  validateCashFlowEntries(entries, inceptionMs);

  // Deterministic sort strictly by parsed timestamp ms, then sequence_number
  const sorted = [...entries].sort((a, b) => {
    const timeDelta = Date.parse(a.entry_timestamp_utc) - Date.parse(b.entry_timestamp_utc);
    if (timeDelta !== 0) return timeDelta;
    return a.sequence_number - b.sequence_number;
  });

  // Pre-event baseline B_ops(0) === 0
  const balances: number[] = [0];
  let currentBalance = 0;
  let maxDeficit = 0;

  for (let j = 0; j < sorted.length; j++) {
    const amount = extractOperatingCashFlowAmount(sorted[j]);
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
    dailyNets.set(dateKey, prev + extractOperatingCashFlowAmount(entry));
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
  status: 'RECOVERED' | 'NOT_RECOVERED' | 'ZERO_OPERATING_OUTLAY' | 'RELAPSED_INTO_DEFICIT';
  k_outlay?: number;
  outlay_timestamp_utc?: string;
  k_rec?: number;
  recovery_timestamp_utc?: string;
  outlay_recovery_duration_days?: number;
  lifecycle_recovery_duration_days?: number;
  peak_operating_funding: number;
  transient_recovery_detected?: boolean;
  transient_k_rec?: number;
  note?: string;
}

export function computePostOutlayRecoveryMetrics(
  entries: OperatingCashFlowEntry[],
  position_inception_utc: string
): CapitalRecoveryResult {
  validateIso8601UtcTimestamp(position_inception_utc);
  const t0_ms = Date.parse(position_inception_utc);
  validateCashFlowEntries(entries, t0_ms);

  const sorted = [...entries].sort((a, b) => {
    const timeDelta = Date.parse(a.entry_timestamp_utc) - Date.parse(b.entry_timestamp_utc);
    if (timeDelta !== 0) return timeDelta;
    return a.sequence_number - b.sequence_number;
  });

  const balances: number[] = [0]; // B_ops(0) === 0
  let currentBalance = 0;
  let maxDeficit = 0;

  for (let j = 0; j < sorted.length; j++) {
    currentBalance += extractOperatingCashFlowAmount(sorted[j]);
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

  // Check if balance ever relapses into deficit after k_rec
  let hasRelapsed = false;
  for (let k = k_rec + 1; k < balances.length; k++) {
    if (balances[k] < 0) {
      hasRelapsed = true;
      break;
    }
  }

  if (hasRelapsed) {
    return {
      status: 'NOT_RECOVERED',
      k_outlay,
      outlay_timestamp_utc: outlay_entry.entry_timestamp_utc,
      peak_operating_funding: peak_funding,
      transient_recovery_detected: true,
      transient_k_rec: k_rec,
      note: 'Transient zero-crossing detected, but operating balance relapsed into deficit'
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

  const sumOperatingFlows = entries.reduce((acc, e) => acc + extractOperatingCashFlowAmount(e), 0);
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
    const amt = extractOperatingCashFlowAmount(e);
    if (amt > 0) {
      inflows += amt;
    } else if (amt < 0) {
      outflows += Math.abs(amt);
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
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error(`E-ERR-035: INVALID_PO_AMOUNT: Authorized amount must be a strictly positive safe integer for '${po_id}'`);
    }
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
    if (['CANCELLED', 'REPLACED', 'FULFILLED'].includes(po.status)) {
      throw new Error(`E-ERR-035: PO_ALREADY_TERMINAL: '${po_id}' is already in terminal state '${po.status}'`);
    }
    this.total_committed_capital -= po.unfulfilled_commitment;
    po.unfulfilled_commitment = 0;
    po.status = 'CANCELLED';
  }

  public fulfillPO(po_id: string, delivery_amount: number): void {
    const po = this.orders.get(po_id);
    if (!po) throw new Error(`E-ERR-035: UNKNOWN_PO: '${po_id}'`);
    if (['CANCELLED', 'REPLACED', 'FULFILLED'].includes(po.status)) {
      throw new Error(`E-ERR-035: PO_ALREADY_TERMINAL: '${po_id}' is already in terminal state '${po.status}'`);
    }
    if (typeof delivery_amount !== 'number' || !Number.isSafeInteger(delivery_amount) || delivery_amount <= 0) {
      throw new Error(`E-ERR-035: INVALID_PO_AMOUNT: Delivery fulfillment amount must be strictly positive for '${po_id}'`);
    }
    const relief = Math.min(delivery_amount, po.unfulfilled_commitment);
    po.unfulfilled_commitment -= relief;
    this.total_committed_capital -= relief;
    if (po.unfulfilled_commitment === 0) {
      po.status = 'FULFILLED';
    }
  }

  public amendPO(po_id: string, new_amount: number): void {
    const po = this.orders.get(po_id);
    if (!po) throw new Error(`E-ERR-035: UNKNOWN_PO: '${po_id}'`);
    if (['CANCELLED', 'REPLACED', 'FULFILLED'].includes(po.status)) {
      throw new Error(`E-ERR-035: PO_ALREADY_TERMINAL: '${po_id}' is already in terminal state '${po.status}'`);
    }
    if (typeof new_amount !== 'number' || !Number.isSafeInteger(new_amount) || new_amount <= 0) {
      throw new Error(`E-ERR-035: INVALID_PO_AMOUNT: Amended amount must be strictly positive for '${po_id}'`);
    }
    const delivered = po.authorized_amount - po.unfulfilled_commitment;
    if (new_amount < delivered) {
      throw new Error(`E-ERR-035: INVALID_PO_AMENDMENT: Amended amount (${new_amount}) cannot be less than already delivered amount (${delivered})`);
    }
    const delta = new_amount - po.authorized_amount;
    po.authorized_amount = new_amount;
    po.unfulfilled_commitment += delta;
    this.total_committed_capital += delta;
  }

  public replacePO(old_po_id: string, new_po_id: string, new_amount: number): void {
    const old_po = this.orders.get(old_po_id);
    if (!old_po) throw new Error(`E-ERR-035: UNKNOWN_PO: '${old_po_id}'`);
    if (['CANCELLED', 'REPLACED', 'FULFILLED'].includes(old_po.status)) {
      throw new Error(`E-ERR-035: PO_ALREADY_TERMINAL: '${old_po_id}' is already in terminal state '${old_po.status}'`);
    }
    if (typeof new_amount !== 'number' || !Number.isSafeInteger(new_amount) || new_amount <= 0) {
      throw new Error(`E-ERR-035: INVALID_PO_AMOUNT: New authorized amount must be strictly positive for '${new_po_id}'`);
    }
    if (this.orders.has(new_po_id)) {
      throw new Error(`E-ERR-035: DUPLICATE_PO: Replacement purchase order '${new_po_id}' already exists`);
    }

    this.total_committed_capital -= old_po.unfulfilled_commitment;
    old_po.unfulfilled_commitment = 0;
    old_po.status = 'REPLACED';

    this.authorizePO(new_po_id, new_amount);
  }
}

/**
 * Two-Tier Gross-Clearing Accounting Ledger
 * Isolates Tier 1 trade clearing asset (B_clearing) from Tier 2 liquid treasury bank cash (B_bank).
 */
export class TwoTierGrossClearingLedger {
  private b_clearing: number = 0;
  private b_bank: number = 0;

  constructor(initialBankCash: number = 0) {
    if (typeof initialBankCash !== 'number' || !Number.isSafeInteger(initialBankCash) || initialBankCash < 0) {
      throw new Error('E-ERR-024: INVALID_INITIAL_CASH: Initial bank cash must be a non-negative safe integer');
    }
    this.b_bank = initialBankCash;
  }

  public recordGrossProceeds(grossAmount: number): void {
    if (typeof grossAmount !== 'number' || !Number.isSafeInteger(grossAmount) || grossAmount <= 0) {
      throw new Error('E-ERR-024: INVALID_GROSS_PROCEEDS: Gross proceeds must be a strictly positive safe integer');
    }
    this.b_clearing += grossAmount;
  }

  public recordClearingDeduction(deductionAmount: number): void {
    if (typeof deductionAmount !== 'number' || !Number.isSafeInteger(deductionAmount) || deductionAmount <= 0) {
      throw new Error('E-ERR-024: INVALID_DEDUCTION: Clearing deduction must be a strictly positive safe integer');
    }
    this.b_clearing -= deductionAmount;
  }

  public recordNetDisbursementToBank(p_net: number): void {
    if (typeof p_net !== 'number' || !Number.isSafeInteger(p_net) || p_net <= 0) {
      throw new Error('E-ERR-024: INVALID_NET_DISBURSEMENT: Net disbursement must be a strictly positive safe integer');
    }
    this.b_clearing -= p_net;
    this.b_bank += p_net;
  }

  public getBalances(): { b_clearing: number; b_bank: number } {
    return {
      b_clearing: this.b_clearing,
      b_bank: this.b_bank
    };
  }
}

export type XIRRStatus =
  | 'CONVERGED'
  | 'NO_ROOT_FOUND_IN_SEARCH_DOMAIN'
  | 'MULTIPLE_ROOTS_DETECTED'
  | 'OUT_OF_SUPPORTED_DOMAIN'
  | 'INVALID_CASH_FLOWS'
  | 'NUMERICAL_FAILURE';

export interface XIRRSolverResult {
  status: XIRRStatus;
  xirr?: number;
  xirr_percentage?: number;
  roots?: number[];
  note?: string;
}

/**
 * Robust Polynomial Return Solver (DEC-012, DEC-014)
 * Solves NPV(r) = sum(C_j / (1 + r)^t_j) = 0 across search domain [-0.99, 10.0].
 * Explicitly distinguishes unique roots, multiple roots, and domain failures.
 */
export function solveXIRR(
  flows: { amount: number; entry_timestamp_utc?: string; date_utc?: string; t_years?: number }[]
): XIRRSolverResult {
  if (!Array.isArray(flows) || flows.length < 2) {
    return { status: 'INVALID_CASH_FLOWS', note: 'At least 2 cash flows required' };
  }

  let hasInflow = false;
  let hasOutflow = false;

  for (const f of flows) {
    if (typeof f.amount !== 'number' || !Number.isFinite(f.amount)) {
      return { status: 'INVALID_CASH_FLOWS', note: 'Amounts must be finite numbers' };
    }
    if (f.amount > 0) hasInflow = true;
    if (f.amount < 0) hasOutflow = true;
  }

  if (!hasInflow || !hasOutflow) {
    return { status: 'INVALID_CASH_FLOWS', note: 'Cash flows must contain both positive inflows and negative outflows' };
  }

  let baseMs: number | null = null;
  const parsedFlows: { amount: number; t: number }[] = [];

  for (let i = 0; i < flows.length; i++) {
    const f = flows[i];
    if (f.t_years !== undefined) {
      parsedFlows.push({ amount: f.amount, t: f.t_years });
    } else {
      const ts = f.entry_timestamp_utc || f.date_utc;
      if (!ts) {
        parsedFlows.push({ amount: f.amount, t: i });
      } else {
        validateIso8601UtcTimestamp(ts);
        const ms = Date.parse(ts);
        if (baseMs === null) baseMs = ms;
        parsedFlows.push({ amount: f.amount, t: (ms - baseMs) / (365.25 * 86400000) });
      }
    }
  }

  function npv(r: number): number {
    let sum = 0;
    for (const f of parsedFlows) {
      const denom = Math.pow(1 + r, f.t);
      if (denom === 0 || !Number.isFinite(denom)) return NaN;
      sum += f.amount / denom;
    }
    return sum;
  }

  const domainMin = -0.99;
  const domainMax = 10.0;
  const step = 0.01;
  const detectedBrackets: [number, number][] = [];
  const exactRoots: number[] = [];

  let prevR = domainMin;
  let prevV = npv(prevR);

  for (let r = domainMin + step; r <= domainMax + 1e-9; r += step) {
    const v = npv(r);
    if (!Number.isFinite(v)) continue;

    if (Math.abs(v) < 1e-9) {
      exactRoots.push(Math.round(r * 1e6) / 1e6);
    } else if (Number.isFinite(prevV) && prevV * v < 0) {
      detectedBrackets.push([prevR, r]);
    }
    prevR = r;
    prevV = v;
  }

  const allRootCount = exactRoots.length + detectedBrackets.length;
  if (allRootCount > 1) {
    const rootsFound = [...exactRoots];
    for (const [a, b] of detectedBrackets) {
      rootsFound.push(Math.round(((a + b) / 2) * 1e4) / 1e4);
    }
    return {
      status: 'MULTIPLE_ROOTS_DETECTED',
      roots: rootsFound,
      note: 'Multiple internal rates of return exist for non-conventional cash flow series'
    };
  }

  if (allRootCount === 0) {
    return {
      status: 'NO_ROOT_FOUND_IN_SEARCH_DOMAIN',
      note: 'No root found in search domain [-0.99, 10.0]'
    };
  }

  let root = exactRoots.length > 0 ? exactRoots[0] : 0;
  if (detectedBrackets.length > 0) {
    let [low, high] = detectedBrackets[0];
    let fLow = npv(low);
    for (let iter = 0; iter < 100; iter++) {
      const mid = (low + high) / 2;
      const fMid = npv(mid);
      if (Math.abs(fMid) < 1e-10 || (high - low) / 2 < 1e-8) {
        root = mid;
        break;
      }
      if (fLow * fMid < 0) {
        high = mid;
      } else {
        low = mid;
        fLow = fMid;
      }
      root = mid;
    }
  }

  return {
    status: 'CONVERGED',
    xirr: root,
    xirr_percentage: root * 100
  };
}
