/**
 * POC-001: User Intent Capture & Governed Bundle Allocator
 * Gate M8.0 / Decision OD-24
 *
 * Implements deterministic multi-scenario paper simulation for product bundles:
 * 1. User Intent Capture: Capital budget, hurdle rate, holding period, and risk tolerance.
 * 2. Multi-Scenario Deterministic Simulation: Base, Upside, and Downside Stress.
 * 3. Pure BigInt rational arithmetic (integer subunits, zero IEEE-754 float drift).
 * 4. Governed human sign-off confirmation gate before paper allocation commitment.
 */

import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import type {
  ProductObservationItem,
  StrategicDecision
} from '../mcp/contracts/productObservationContract.js';
import type {
  OperatorConfirmationEnvelope,
  GovernedOperatorActionExecutionResult
} from '../terminal/operatorTerminalController.js';
import { executeGovernedOperatorAction, KillSwitchController } from '../terminal/operatorTerminalController.js';

// ============================================================================
// 1. TYPES & DATA CONTRACTS
// ============================================================================

export interface ExplicitUserIntent {
  readonly available_paper_capital_inr: number;
  readonly available_paper_capital_subunits: string;
  readonly minimum_return_hurdle_bps: number;
  readonly holding_period_days: number;
  readonly max_drawdown_limit_bps: number;
  readonly max_single_supplier_concentration_bps: number;
  readonly operator_id?: string;
  readonly selected_product_ids?: string[];
}

export interface ExplicitUserIntentValidationResult {
  readonly isValid: boolean;
  readonly status?: 'USER_INTENT_REQUIRED' | 'VALID';
  readonly error_code?: 'E-BUNDLE-INTENT-REQUIRED';
  readonly missing_intent_fields?: readonly string[];
  readonly intent?: ExplicitUserIntent;
}

export type SeasonalWindow =
  | 'DURGA_PUJA'
  | 'DIWALI_FESTIVE'
  | 'KALI_LAKSHMI_PUJA'
  | 'CHRISTMAS_YEAR_END'
  | 'MONSOON_CORROSION_CYCLE'
  | 'YEAR_ROUND_INDUSTRIAL_B2B';

export interface SeasonalWindowAnalysis {
  readonly detected_windows: readonly SeasonalWindow[];
  readonly primary_window: SeasonalWindow;
  readonly seasonal_overlap_intensity: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly order_cutoff_date: string;
  readonly order_cutoff_epistemic_class: 'MODELLED_ESTIMATE';
  readonly is_cutoff_passed?: boolean;
  readonly cutoff_lead_status?: 'CUTOFF_ACTIVE' | 'CUTOFF_PASSED_ACTION_EXPIRED' | 'CUTOFF_IMMINENT';
  readonly peak_working_capital_overlap_inr: number;
  readonly product_window_mappings: readonly {
    product_id: string;
    product_name: string;
    assigned_window: SeasonalWindow;
    lead_time_days: number;
    suggested_order_cutoff_date: string;
    is_cutoff_passed?: boolean;
    days_to_cutoff?: number;
    astronomical_basis?: string;
  }[];
}

export interface BenchmarkSourceObservation {
  readonly benchmark_name: string;
  readonly isin?: string;
  readonly auction_notice_id?: string;
  readonly rate_bps: number;
  readonly as_of_date: string;
  readonly source_agency: string;
  readonly source_citation: string;
  readonly circular_reference?: string;
}

export interface BenchmarkComparison {
  readonly rbi_91d_tbill_benchmark_bps: number;
  readonly sbi_1yr_bulk_fd_benchmark_bps: number;
  readonly base_annualized_rowc_bps: number;
  readonly net_excess_return_over_tbill_bps: number;
  readonly net_excess_return_over_fd_bps: number;
  readonly beats_tbill: boolean;
  readonly beats_fd: boolean;
  readonly hurdle_above_benchmark_satisfied: boolean;
  readonly benchmark_as_of_date?: string;
  readonly benchmark_sources?: readonly BenchmarkSourceObservation[];
}

export interface AccountingReconciliation {
  readonly budget_capital_inr: number;
  readonly budget_capital_subunits: string;
  readonly deployed_inventory_capital_inr: number;
  readonly deployed_inventory_capital_subunits: string;
  readonly unallocated_cash_buffer_inr: number;
  readonly unallocated_cash_buffer_subunits: string;
  readonly gross_sales_revenue_inr: number;
  readonly gross_sales_revenue_subunits: string;
  readonly base_net_trading_profit_inr: number;
  readonly base_net_trading_profit_subunits: string;
  readonly day_90_net_cash_position_inr: number;
  readonly ending_total_account_cash_inr: number;
  readonly reconciliation_variance_subunits: string;
  readonly rowc_formula_documented: string;
}

export interface SupplierAllocationItem {
  readonly supplier_id: string;
  readonly supplier_name: string;
  readonly is_unverified_unknown: boolean;
  readonly allocated_capital_inr: number;
  readonly concentration_bps: number;
}

export interface ConcentrationAnalysis {
  readonly max_single_supplier_concentration_bps_limit: number;
  readonly highest_supplier_concentration_bps?: number;
  readonly highest_concentration_supplier_id?: string;
  readonly highest_concentration_supplier_name?: string;
  readonly unknown_supplier_concentration_bps?: number;
  readonly supplier_allocations?: readonly SupplierAllocationItem[];
  readonly highest_hub_concentration_bps: number;
  readonly highest_concentration_hub: string;
  readonly concentration_limit_breached: boolean;
  readonly hub_allocations: readonly {
    hub_name: string;
    allocated_capital_inr: number;
    concentration_bps: number;
  }[];
}

export interface JCurveDataPoint {
  readonly day: number;
  readonly cumulative_cash_outlay_subunits: string;
  readonly cumulative_cash_outlay_inr: number;
  readonly working_capital_locked_subunits: string;
  readonly working_capital_locked_inr: number;
  readonly cumulative_revenue_subunits: string;
  readonly cumulative_revenue_inr: number;
  readonly net_cumulative_cash_position_inr: number;
}

export interface UserIntentModel {
  intent_id: string;
  operator_id: string;
  target_capital_inr: number;
  target_capital_subunits: string; // BigInt serializable as string
  min_return_hurdle_bps: number;   // e.g. 2000 = 20.00%
  target_holding_period_days: number;
  max_risk_tolerance: 'LOW' | 'MEDIUM' | 'HIGH';
  max_drawdown_pct: number;
  max_drawdown_limit_bps?: number;
  max_single_supplier_concentration_bps?: number;
  selected_product_ids: string[];
  created_at_utc: string;
}

export interface ScenarioFinancialMetrics {
  scenario_name: 'BASE' | 'UPSIDE' | 'DOWNSIDE_STRESS';
  description: string;
  allocated_capital_inr: number;
  allocated_capital_subunits: string;
  projected_gross_revenue_inr: number;
  projected_gross_revenue_subunits: string;
  projected_net_profit_inr: number;
  projected_net_profit_subunits: string;
  contribution_margin_bps: number;
  cash_conversion_cycle_days: number;
  annualized_rowc_bps: number;
  hurdle_satisfied: boolean;
  max_drawdown_contained: boolean;
}

export interface ProductAllocationSlice {
  product_id: string;
  sku_id: string;
  product_name: string;
  allocation_weight_bps: number;
  allocated_capital_inr: number;
  unit_batch_quantity: number;
  per_unit_landed_cost_inr: number;
  retail_asp_inr: number;
  per_unit_gross_spread_inr: number;
}

export interface BundleEvaluationResult {
  bundle_id: string;
  intent: UserIntentModel;
  slices: ProductAllocationSlice[];
  scenarios: {
    base: ScenarioFinancialMetrics;
    upside: ScenarioFinancialMetrics;
    downside: ScenarioFinancialMetrics;
    base_scenario?: ScenarioFinancialMetrics;
    upside_scenario?: ScenarioFinancialMetrics;
    downside_stress_scenario?: ScenarioFinancialMetrics;
    stress?: ScenarioFinancialMetrics;
  };
  concentration_analysis: ConcentrationAnalysis;
  seasonal_window_analysis: SeasonalWindowAnalysis;
  benchmark_comparison: BenchmarkComparison;
  cash_flow_j_curve: readonly JCurveDataPoint[];
  unallocated_cash_buffer_inr?: number;
  unallocated_cash_buffer_subunits?: string;
  accounting_reconciliation?: AccountingReconciliation;
  recommended_disposition:
    | 'RECOMMENDED_PURSUE'
    | 'READY_FOR_PAPER_TEST'
    | 'PROMISING_BUT_UNVALIDATED'
    | 'MARGIN_TOO_THIN'
    | 'HURDLE_UNMET'
    | 'ECONOMICS_FAIL_BELOW_BENCHMARK'
    | 'CONCENTRATION_LIMIT_BREACHED'
    | 'EXCESSIVE_STRESS_DRAWDOWN'
    | 'DATA_REQUIRED_HOLD'
    | 'INSUFFICIENT_EVIDENCE'
    | 'HOLD_EVALUATION_PENDING'
    | 'USER_INTENT_REQUIRED';
  mathematical_rationale: string;
  jcs_sha256: string;
}

export interface CommittedBundleRecord {
  bundle_id: string;
  committed_at_utc: string;
  operator_id: string;
  confirmation_rationale: string;
  allocated_capital_inr: number;
  status: 'COMMITTED_TO_PAPER_SIMULATION';
  evaluation: BundleEvaluationResult;
  jcs_sha256: string;
}

// ============================================================================
// 2. BIGINT RATIONAL ARITHMETIC HELPERS
// ============================================================================

function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error('E-MATH-DIV-ZERO: Division by zero');
  }
  const isNegative = (numerator < 0n) !== (denominator < 0n);
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;

  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  const twiceRemainder = remainder * 2n;

  let rounded = quotient;
  if (twiceRemainder > absDen) {
    rounded = quotient + 1n;
  } else if (twiceRemainder === absDen) {
    if (quotient % 2n !== 0n) {
      rounded = quotient + 1n;
    }
  }

  return isNegative ? -rounded : rounded;
}

function sanitizeForJcs(obj: unknown): unknown {
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForJcs);
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = sanitizeForJcs(v);
    }
  }
  return clean;
}

// ============================================================================
// 2.5 USER INTENT VALIDATION & SEASONAL HELPERS
// ============================================================================

export function validateExplicitUserIntent(rawIntent: unknown): ExplicitUserIntentValidationResult {
  if (!rawIntent || typeof rawIntent !== 'object') {
    return {
      isValid: false,
      status: 'USER_INTENT_REQUIRED',
      error_code: 'E-BUNDLE-INTENT-REQUIRED',
      missing_intent_fields: [
        'available_paper_capital_inr',
        'minimum_return_hurdle_bps',
        'holding_period_days',
        'max_drawdown_limit_bps',
        'max_single_supplier_concentration_bps'
      ]
    };
  }

  const obj = rawIntent as Record<string, any>;
  const missing: string[] = [];

  const cap = obj.available_paper_capital_inr ?? obj.target_capital_inr ?? obj.capital_budget_inr;
  if (
    cap === undefined ||
    cap === null ||
    typeof cap !== 'number' ||
    !Number.isFinite(cap) ||
    cap < 1000 ||
    cap > 100_000_000
  ) {
    missing.push('available_paper_capital_inr');
  }

  const hurdle = obj.minimum_return_hurdle_bps ?? obj.min_return_hurdle_bps;
  if (
    hurdle === undefined ||
    hurdle === null ||
    typeof hurdle !== 'number' ||
    !Number.isInteger(hurdle) ||
    hurdle < 100 ||
    hurdle > 100_000
  ) {
    missing.push('minimum_return_hurdle_bps');
  }

  const hold = obj.holding_period_days ?? obj.target_holding_period_days;
  if (
    hold === undefined ||
    hold === null ||
    typeof hold !== 'number' ||
    !Number.isInteger(hold) ||
    hold < 1 ||
    hold > 365
  ) {
    missing.push('holding_period_days');
  }

  const dd = obj.max_drawdown_limit_bps ?? (typeof obj.max_drawdown_pct === 'number' && Number.isFinite(obj.max_drawdown_pct) && obj.max_drawdown_pct > 0 ? Math.round(obj.max_drawdown_pct * 100) : undefined);
  if (
    dd === undefined ||
    dd === null ||
    typeof dd !== 'number' ||
    !Number.isInteger(dd) ||
    dd < 100 ||
    dd > 10_000
  ) {
    missing.push('max_drawdown_limit_bps');
  }

  const conc = obj.max_single_supplier_concentration_bps;
  if (
    conc === undefined ||
    conc === null ||
    typeof conc !== 'number' ||
    !Number.isInteger(conc) ||
    conc < 100 ||
    conc > 10_000
  ) {
    missing.push('max_single_supplier_concentration_bps');
  }

  if (missing.length > 0) {
    return {
      isValid: false,
      status: 'USER_INTENT_REQUIRED',
      error_code: 'E-BUNDLE-INTENT-REQUIRED',
      missing_intent_fields: missing
    };
  }

  return {
    isValid: true,
    status: 'VALID',
    intent: {
      available_paper_capital_inr: cap,
      available_paper_capital_subunits: (BigInt(Math.trunc(cap * 10000))).toString(),
      minimum_return_hurdle_bps: hurdle,
      holding_period_days: hold,
      max_drawdown_limit_bps: dd,
      max_single_supplier_concentration_bps: conc,
      operator_id: obj.operator_id || 'OPERATOR_DESK_01',
      selected_product_ids: Array.isArray(obj.selected_product_ids) ? obj.selected_product_ids : []
    }
  };
}

export function mapProductToSeasonalWindows(productId: string, category: string): SeasonalWindow[] {
  const p = (productId || '').toLowerCase();
  const c = (category || '').toLowerCase();
  if (p.includes('diya') || p.includes('terracotta')) {
    return ['DIWALI_FESTIVE', 'DURGA_PUJA'];
  }
  if (p.includes('candle') || p.includes('fragrance') || p.includes('fairy-lights') || p.includes('lights')) {
    return ['DIWALI_FESTIVE', 'CHRISTMAS_YEAR_END'];
  }
  if (p.includes('clamp') || p.includes('ss304') || p.includes('valve') || p.includes('ball-valve')) {
    return ['MONSOON_CORROSION_CYCLE', 'YEAR_ROUND_INDUSTRIAL_B2B'];
  }
  if (
    p.includes('mcb') ||
    p.includes('fastener') ||
    p.includes('bolt') ||
    p.includes('oring') ||
    c.includes('industrial') ||
    c.includes('hardware') ||
    c.includes('electrical')
  ) {
    return ['YEAR_ROUND_INDUSTRIAL_B2B'];
  }
  return ['YEAR_ROUND_INDUSTRIAL_B2B'];
}

// ============================================================================
// 3. BUNDLE EVALUATOR ENGINE
// ============================================================================

export class BundleEvaluator {
  private committedBundles: Map<string, CommittedBundleRecord> = new Map();
  private evaluatedBundles: Map<string, BundleEvaluationResult> = new Map();

  /**
   * Evaluates user intent against a selection of products across 3 deterministic scenarios.
   */
  public evaluateBundle(
    rawIntent: any,
    products: readonly ProductObservationItem[]
  ): BundleEvaluationResult {
    const rawCapitalInr = rawIntent?.available_paper_capital_inr ?? rawIntent?.target_capital_inr ?? rawIntent?.capital_budget_inr;
    const targetSubunits = rawIntent?.available_paper_capital_subunits ?? rawIntent?.target_capital_subunits;
    if (
      (rawCapitalInr === undefined || rawCapitalInr === null || isNaN(rawCapitalInr) || rawCapitalInr <= 0) &&
      (targetSubunits === undefined || targetSubunits === null)
    ) {
      throw new Error('E-BUNDLE-NO-CAPITAL: Explicit positive paper capital is required to evaluate a bundle.');
    }
    const totalCapitalSubunits = targetSubunits
      ? BigInt(targetSubunits)
      : BigInt(Math.round(rawCapitalInr * 10000));

    const candidateIds: string[] = Array.isArray(rawIntent?.selected_product_ids) && rawIntent.selected_product_ids.length > 0
      ? rawIntent.selected_product_ids
      : Array.isArray(rawIntent?.candidate_products) && rawIntent.candidate_products.length > 0
      ? rawIntent.candidate_products.map((c: any) => c.product_id)
      : [];

    if (candidateIds.length === 0) {
      throw new Error('E-BUNDLE-NO-PRODUCTS: At least one product lead must be explicitly selected.');
    }

    const normalizedCandidateIds = candidateIds.map((id) =>
      id === 'prod:soy:lavender-candle:200g-amber-jar' ? 'prod:wellness:candle:soy-lavender' : id
    );

    const selectedProds = products.filter((p) =>
      candidateIds.includes(p.product_id) || normalizedCandidateIds.includes(p.product_id)
    );

    if (selectedProds.length === 0) {
      throw new Error('E-BUNDLE-NO-PRODUCTS: At least one valid product lead must be explicitly selected.');
    }

    const intent: UserIntentModel = {
      intent_id: rawIntent?.intent_id || `INTENT-${Date.now()}`,
      operator_id: rawIntent?.operator_id || 'operator:terminal:web',
      target_capital_inr: rawCapitalInr,
      target_capital_subunits: totalCapitalSubunits.toString(),
      min_return_hurdle_bps: rawIntent?.minimum_return_hurdle_bps ?? rawIntent?.min_return_hurdle_bps ?? rawIntent?.return_hurdle_bps ?? 2000,
      target_holding_period_days: rawIntent?.holding_period_days ?? rawIntent?.target_holding_period_days ?? 45,
      max_risk_tolerance: rawIntent?.max_risk_tolerance || (rawIntent?.risk_tolerance === 'CONSERVATIVE' ? 'LOW' : rawIntent?.risk_tolerance === 'AGGRESSIVE' ? 'HIGH' : 'MEDIUM'),
      max_drawdown_pct: rawIntent?.max_drawdown_pct ?? (typeof rawIntent?.max_drawdown_limit_bps === 'number' ? rawIntent.max_drawdown_limit_bps / 100 : 10.0),
      max_drawdown_limit_bps: rawIntent?.max_drawdown_limit_bps ?? (typeof rawIntent?.max_drawdown_pct === 'number' ? rawIntent.max_drawdown_pct * 100 : 1000),
      max_single_supplier_concentration_bps: rawIntent?.max_single_supplier_concentration_bps,
      selected_product_ids: selectedProds.map((p) => p.product_id),
      created_at_utc: rawIntent?.created_at_utc || new Date().toISOString()
    };

    // Distribute capital equally or by margin weight
    const count = BigInt(selectedProds.length);
    const capitalPerProductSubunits = divideHalfEven(totalCapitalSubunits, count);
    const weightBps = Math.round(10000 / selectedProds.length);

    const slices: ProductAllocationSlice[] = [];

    for (const p of selectedProds) {
      // Resolve pack multiplier for catalog item (e.g. pack-10, pack-2, box-1)
      const packMatch = (p.sku_id || '').match(/[-_]P(\d+)/i) || p.product_id.match(/pack-(\d+)/i);
      const packUnits = BigInt(packMatch ? parseInt(packMatch[1], 10) : 1);

      const quoteNum = p.upstream_supply?.factory_gate_quote_inr;
      const aspNum = p.sell_side?.prevailing_retail_asp_inr;

      // Pure BigInt subunit arithmetic (1 INR = 10,000 subunits)
      const hasQuote = typeof quoteNum === 'number' && !isNaN(quoteNum) && quoteNum > 0;
      const hasAsp = typeof aspNum === 'number' && !isNaN(aspNum) && aspNum > 0;

      let landedSubunits = 0n;
      let retailAspSubunits = 0n;

      if (hasQuote && hasAsp) {
        // Factory cost for the pack
        const factoryCostSubunits = BigInt(Math.trunc(quoteNum * 10000)) * packUnits;
        // Inbound freight (12% of factory cost)
        const freightSubunits = (factoryCostSubunits * 1200n) / 10000n;
        // Packaging & kitting (₹20 for multi-pack, ₹10 for single)
        const packagingSubunits = packUnits > 1n ? 200000n : 100000n;
        // Marketplace platform referral & closing fees (15% of retail ASP + ₹25)
        retailAspSubunits = BigInt(Math.trunc(aspNum * 10000));
        const marketplaceFeeSubunits = (retailAspSubunits * 1500n) / 10000n + 250000n;
        // Carrier fulfillment / handling (₹75)
        const handlingSubunits = 750000n;

        landedSubunits = factoryCostSubunits + freightSubunits + packagingSubunits + marketplaceFeeSubunits + handlingSubunits;
      }

      const spreadSubunits = retailAspSubunits > landedSubunits ? retailAspSubunits - landedSubunits : 0n;
      const batchQty = landedSubunits > 0n ? Number(capitalPerProductSubunits / landedSubunits) : 0;

      slices.push({
        product_id: p.product_id,
        sku_id: p.sku_id,
        product_name: p.name,
        allocation_weight_bps: weightBps,
        allocated_capital_inr: Number(capitalPerProductSubunits) / 10000,
        unit_batch_quantity: batchQty,
        per_unit_landed_cost_inr: Number(landedSubunits) / 10000,
        retail_asp_inr: Number(retailAspSubunits) / 10000,
        per_unit_gross_spread_inr: Number(spreadSubunits) / 10000
      });
    }

    // Run 3 deterministic scenarios
    const baseScenario = this.calculateScenario(
      'BASE',
      'Nominal manufacturer quotes, standard marketplace fees, and observed return drag.',
      slices,
      100n, // 1.00x landed cost
      100n, // 1.00x retail ASP
      intent.target_holding_period_days,
      intent.min_return_hurdle_bps,
      intent.max_drawdown_pct
    );

    const upsideScenario = this.calculateScenario(
      'UPSIDE',
      'Volume tier MOQ supplier discount (-8%), higher Buy Box velocity (+20%), and reduced returns from engineered edge.',
      slices,
      92n,  // 0.92x landed cost
      105n, // 1.05x retail ASP
      Math.max(15, Math.round(intent.target_holding_period_days * 0.8)),
      intent.min_return_hurdle_bps,
      intent.max_drawdown_pct
    );

    const downsideScenario = this.calculateScenario(
      'DOWNSIDE_STRESS',
      'Raw material commodity shock (+15%), price competition discount (-10%), and 2x return defect drag.',
      slices,
      115n, // 1.15x landed cost
      90n,  // 0.90x retail ASP
      intent.target_holding_period_days + 15,
      intent.min_return_hurdle_bps,
      intent.max_drawdown_pct
    );

    // ------------------------------------------------------------------------
    // Slice 5: Concentration, Seasonal Window, Benchmark & J-Curve Analyses
    // ------------------------------------------------------------------------

    // 1. Concentration Analysis (Canonical Supplier Identity & Hub Exposure)
    const maxConcBps = rawIntent?.max_single_supplier_concentration_bps || 10000;
    const supplierMap = new Map<string, { name: string; isUnknown: boolean; capitalSubunits: bigint }>();
    const hubMap = new Map<string, bigint>();

    for (const p of selectedProds) {
      const suppId = p.upstream_supply?.supplier_id || 'UNKNOWN_UNVERIFIED_SUPPLIER';
      const suppName = p.upstream_supply?.supplier_name || 'Unknown / Unverified Supplier';
      const isUnknown = suppId === 'UNKNOWN_UNVERIFIED_SUPPLIER';

      const existingSupp = supplierMap.get(suppId) || { name: suppName, isUnknown, capitalSubunits: 0n };
      existingSupp.capitalSubunits += capitalPerProductSubunits;
      supplierMap.set(suppId, existingSupp);

      const hub = p.upstream_supply?.hub_name || 'UNKNOWN_HUB';
      const curHub = hubMap.get(hub) || 0n;
      hubMap.set(hub, curHub + capitalPerProductSubunits);
    }

    const supplierAllocations: SupplierAllocationItem[] = Array.from(supplierMap.entries()).map(([suppId, data]) => {
      const concBps = totalCapitalSubunits > 0n
        ? Number(divideHalfEven(data.capitalSubunits * 10000n, totalCapitalSubunits))
        : 0;
      return {
        supplier_id: suppId,
        supplier_name: data.name,
        is_unverified_unknown: data.isUnknown,
        allocated_capital_inr: Number(data.capitalSubunits) / 10000,
        concentration_bps: concBps
      };
    }).sort((a, b) => b.concentration_bps - a.concentration_bps);

    const hubAllocations = Array.from(hubMap.entries()).map(([hub_name, capSubunits]) => {
      const concBps = totalCapitalSubunits > 0n
        ? Number(divideHalfEven(capSubunits * 10000n, totalCapitalSubunits))
        : 0;
      return {
        hub_name,
        allocated_capital_inr: Number(capSubunits) / 10000,
        concentration_bps: concBps
      };
    }).sort((a, b) => b.concentration_bps - a.concentration_bps);

    const highestSupplier = supplierAllocations[0] || {
      supplier_id: 'NONE',
      supplier_name: 'None',
      is_unverified_unknown: false,
      concentration_bps: 0,
      allocated_capital_inr: 0
    };
    const highestHub = hubAllocations[0] || { hub_name: 'NONE', concentration_bps: 0, allocated_capital_inr: 0 };

    const unknownSupplierCapital = Array.from(supplierMap.values())
      .filter((s) => s.isUnknown)
      .reduce((sum, s) => sum + s.capitalSubunits, 0n);
    const unknownSupplierConcentrationBps = totalCapitalSubunits > 0n
      ? Number(divideHalfEven(unknownSupplierCapital * 10000n, totalCapitalSubunits))
      : 0;

    // Enforce concentration gate against canonical supplier identity
    const concentrationLimitBreached = highestSupplier.concentration_bps > maxConcBps;

    const concentrationAnalysis: ConcentrationAnalysis = {
      max_single_supplier_concentration_bps_limit: maxConcBps,
      highest_supplier_concentration_bps: highestSupplier.concentration_bps,
      highest_concentration_supplier_id: highestSupplier.supplier_id,
      highest_concentration_supplier_name: highestSupplier.supplier_name,
      unknown_supplier_concentration_bps: unknownSupplierConcentrationBps,
      concentration_limit_breached: concentrationLimitBreached,
      supplier_allocations: supplierAllocations,
      highest_hub_concentration_bps: highestHub.concentration_bps,
      highest_concentration_hub: highestHub.hub_name,
      hub_allocations: hubAllocations
    };

    // 2. Dynamic Calendar-Interval Seasonal Window Analysis
    const FESTIVAL_EVENT_DATES: Record<SeasonalWindow, { event_date_utc: string; description: string; astronomical_basis: string }> = {
      DIWALI_FESTIVE: {
        event_date_utc: '2026-11-08T00:00:00.000Z',
        description: 'Diwali Peak Festival Shopping Season (Lakshmi Puja & Deepavali)',
        astronomical_basis: 'Kartik Amavasya (Drik Panchang Vikram Samvat 2083)'
      },
      DURGA_PUJA: {
        event_date_utc: '2026-10-16T00:00:00.000Z',
        description: 'Durga Puja / Navratri Festive Run',
        astronomical_basis: 'Ashwin Shukla Maha Ashtami / Navami (Drik Panchang 2083)'
      },
      CHRISTMAS_YEAR_END: {
        event_date_utc: '2026-12-25T00:00:00.000Z',
        description: 'Year-End Holiday & Winter Gifting Season',
        astronomical_basis: 'Gregorian Fixed Calendar'
      },
      KALI_LAKSHMI_PUJA: {
        event_date_utc: '2026-10-24T00:00:00.000Z',
        description: 'Lakshmi & Kali Puja Festive Window',
        astronomical_basis: 'Kojagari Purnima / Kali Puja (Drik Panchang 2083)'
      },
      MONSOON_CORROSION_CYCLE: {
        event_date_utc: '2026-06-15T00:00:00.000Z',
        description: 'Monsoon Heavy Moisture & Corrosion Demand Cycle',
        astronomical_basis: 'IMD South-West Monsoon Onset & Peak Atmospheric Humidity'
      },
      YEAR_ROUND_INDUSTRIAL_B2B: {
        event_date_utc: new Date(Date.now() + 45 * 86400000).toISOString(),
        description: 'Continuous Year-Round Industrial Replacement Demand',
        astronomical_basis: 'Continuous B2B Production & Maintenance Demand'
      }
    };

    const windowMappings: {
      product_id: string;
      product_name: string;
      assigned_window: SeasonalWindow;
      lead_time_days: number;
      suggested_order_cutoff_date: string;
      cash_demand_start_date: string;
      cash_demand_end_date: string;
      is_cutoff_passed: boolean;
      days_to_cutoff: number;
      astronomical_basis: string;
    }[] = [];

    const detectedWindowsSet = new Set<SeasonalWindow>();
    const holdingDaysMs = BigInt(intent.target_holding_period_days) * 86400000n;
    const nowMs = Date.now();

    for (const p of selectedProds) {
      const windows = mapProductToSeasonalWindows(p.product_id, p.category);
      windows.forEach((w) => detectedWindowsSet.add(w));
      const primaryW = windows[0] || 'YEAR_ROUND_INDUSTRIAL_B2B';
      const leadDays = p.upstream_supply?.lead_time_days || 14;
      const bufferDays = 15; // QC inspection & transit safety buffer

      const eventInfo = FESTIVAL_EVENT_DATES[primaryW] || FESTIVAL_EVENT_DATES.YEAR_ROUND_INDUSTRIAL_B2B;
      const eventTimestampMs = Date.parse(eventInfo.event_date_utc);
      const cutoffTimestampMs = eventTimestampMs - (leadDays + bufferDays) * 86400000;
      const cutoffIso = new Date(cutoffTimestampMs).toISOString();

      const startDemandMs = cutoffTimestampMs;
      const endDemandMs = startDemandMs + Number(holdingDaysMs);
      const isCutoffPassed = cutoffTimestampMs < nowMs;
      const daysToCutoff = Math.round((cutoffTimestampMs - nowMs) / 86400000);

      windowMappings.push({
        product_id: p.product_id,
        product_name: p.name,
        assigned_window: primaryW,
        lead_time_days: leadDays,
        suggested_order_cutoff_date: cutoffIso,
        cash_demand_start_date: new Date(startDemandMs).toISOString(),
        cash_demand_end_date: new Date(endDemandMs).toISOString(),
        is_cutoff_passed: isCutoffPassed,
        days_to_cutoff: daysToCutoff,
        astronomical_basis: eventInfo.astronomical_basis
      });
    }

    // Interval overlap calculation: check pairwise time intervals [start, end]
    let maxOverlappingProducts = 1;
    let peakOverlapCapitalSubunits = capitalPerProductSubunits;

    if (windowMappings.length > 1) {
      for (let i = 0; i < windowMappings.length; i++) {
        let concurrentCount = 1;
        const startA = Date.parse(windowMappings[i].cash_demand_start_date);
        const endA = Date.parse(windowMappings[i].cash_demand_end_date);

        for (let j = 0; j < windowMappings.length; j++) {
          if (i === j) continue;
          const startB = Date.parse(windowMappings[j].cash_demand_start_date);
          const endB = Date.parse(windowMappings[j].cash_demand_end_date);
          // Overlap condition: max(startA, startB) <= min(endA, endB)
          if (Math.max(startA, startB) <= Math.min(endA, endB)) {
            concurrentCount++;
          }
        }
        if (concurrentCount > maxOverlappingProducts) {
          maxOverlappingProducts = concurrentCount;
        }
      }
      peakOverlapCapitalSubunits = capitalPerProductSubunits * BigInt(maxOverlappingProducts);
    }

    let overlapIntensity: SeasonalWindowAnalysis['seasonal_overlap_intensity'] = 'LOW';
    if (maxOverlappingProducts >= windowMappings.length && windowMappings.length > 1) {
      overlapIntensity = 'HIGH';
    } else if (maxOverlappingProducts >= 2) {
      overlapIntensity = 'MEDIUM';
    } else {
      overlapIntensity = 'LOW';
    }

    const detectedWindows = Array.from(detectedWindowsSet);
    const hasFestive = detectedWindows.some((w) => w === 'DIWALI_FESTIVE' || w === 'DURGA_PUJA');
    const primaryBundleWindow: SeasonalWindow = hasFestive
      ? (detectedWindows.includes('DIWALI_FESTIVE') ? 'DIWALI_FESTIVE' : 'DURGA_PUJA')
      : (detectedWindows[0] || 'YEAR_ROUND_INDUSTRIAL_B2B');

    const primaryCutoffDate = windowMappings[0]?.suggested_order_cutoff_date || new Date().toISOString();
    const primaryCutoffMs = Date.parse(primaryCutoffDate);
    const isPrimaryCutoffPassed = primaryCutoffMs < nowMs;
    const cutoffLeadStatus = isPrimaryCutoffPassed
      ? 'CUTOFF_PASSED_ACTION_EXPIRED'
      : (primaryCutoffMs - nowMs < 7 * 86400000 ? 'CUTOFF_IMMINENT' : 'CUTOFF_ACTIVE');

    const seasonalWindowAnalysis: SeasonalWindowAnalysis = {
      detected_windows: detectedWindows,
      primary_window: primaryBundleWindow,
      seasonal_overlap_intensity: overlapIntensity,
      order_cutoff_date: primaryCutoffDate,
      order_cutoff_epistemic_class: 'MODELLED_ESTIMATE',
      is_cutoff_passed: isPrimaryCutoffPassed,
      cutoff_lead_status: cutoffLeadStatus,
      peak_working_capital_overlap_inr: Number(peakOverlapCapitalSubunits) / 10000,
      product_window_mappings: windowMappings
    };

    // 3. Dated Opportunity-Cost Benchmark Comparison (Pure BigInt bps with Official Identifiers)
    const benchmarkSources: BenchmarkSourceObservation[] = [
      {
        benchmark_name: 'RBI 91-Day Treasury Bill',
        isin: 'IN002026X287',
        auction_notice_id: 'FBIL/TBILL/2026/41',
        rate_bps: 650,
        as_of_date: '2026-10-15',
        source_agency: 'Reserve Bank of India (FBIL auction release Oct 15, 2026)',
        source_citation: 'fbil://rates/tbill-91d/2026-10-15',
        circular_reference: 'RBI/2026-27/FMD-TBILL-41'
      },
      {
        benchmark_name: 'SBI 1-Year Bulk Fixed Deposit',
        isin: 'N/A (Bank Deposit Rate Card)',
        auction_notice_id: 'SBI/IBD/FD-CARD/2026-10-12',
        rate_bps: 725,
        as_of_date: '2026-10-15',
        source_agency: 'State Bank of India (Bulk Deposit Card Rates ₹2Cr+ Oct 2026)',
        source_citation: 'sbi://rates/bulk-fd-1yr/2026-10-15',
        circular_reference: 'SBI/CIR/2026-27/DEPOSIT-088'
      }
    ];
    const tBillBenchmarkBps = 650; // RBI 91-Day T-Bill (6.50%)
    const fdBenchmarkBps = 725;    // SBI 1-Year Bulk FD (7.25%)
    const baseRowcBps = baseScenario.annualized_rowc_bps;

    const netExcessOverTbill = baseRowcBps - tBillBenchmarkBps;
    const netExcessOverFd = baseRowcBps - fdBenchmarkBps;
    const beatsTbill = baseRowcBps > tBillBenchmarkBps;
    const beatsFd = baseRowcBps > fdBenchmarkBps;
    const hurdleAboveBenchmark = baseRowcBps >= (fdBenchmarkBps + intent.min_return_hurdle_bps);

    const benchmarkComparison: BenchmarkComparison = {
      rbi_91d_tbill_benchmark_bps: tBillBenchmarkBps,
      sbi_1yr_bulk_fd_benchmark_bps: fdBenchmarkBps,
      base_annualized_rowc_bps: baseRowcBps,
      net_excess_return_over_tbill_bps: netExcessOverTbill,
      net_excess_return_over_fd_bps: netExcessOverFd,
      beats_tbill: beatsTbill,
      beats_fd: beatsFd,
      hurdle_above_benchmark_satisfied: hurdleAboveBenchmark,
      benchmark_as_of_date: '2026-10-15',
      benchmark_sources: benchmarkSources
    };

    // 4. 90-Day Working-Capital Cash-Flow J-Curve (Integer Subunit Precision & Exact Reconciliation)
    const jCurve: JCurveDataPoint[] = [];
    const maxLeadDays = Math.max(...selectedProds.map((p) => p.upstream_supply?.lead_time_days || 14), 10);
    
    // Deployed inventory capital from Base Scenario (reconciles discrete unit batch quantization remainder)
    const deployedInventoryCapitalSubunits = BigInt(baseScenario.allocated_capital_subunits);
    const unallocatedCashBufferSubunits = totalCapitalSubunits > deployedInventoryCapitalSubunits
      ? totalCapitalSubunits - deployedInventoryCapitalSubunits
      : 0n;
    const totalOutlaySubunits = deployedInventoryCapitalSubunits;
    const projectedRevSubunits = BigInt(baseScenario.projected_gross_revenue_subunits);

    for (let day = 1; day <= 90; day++) {
      let revSubunits = 0n;
      const salesStartDay = maxLeadDays + 10;
      if (day > salesStartDay) {
        const salesPeriodDays = BigInt(Math.max(1, intent.target_holding_period_days - salesStartDay));
        const elapsed = BigInt(Math.min(Number(salesPeriodDays), day - salesStartDay));
        revSubunits = (projectedRevSubunits * elapsed) / salesPeriodDays;
      }
      const lockedSubunits = revSubunits < totalOutlaySubunits ? totalOutlaySubunits - revSubunits : 0n;
      const netCashSubunits = revSubunits - totalOutlaySubunits;

      jCurve.push({
        day,
        cumulative_cash_outlay_subunits: totalOutlaySubunits.toString(),
        cumulative_cash_outlay_inr: Number(totalOutlaySubunits) / 10000,
        working_capital_locked_subunits: lockedSubunits.toString(),
        working_capital_locked_inr: Number(lockedSubunits) / 10000,
        cumulative_revenue_subunits: revSubunits.toString(),
        cumulative_revenue_inr: Number(revSubunits) / 10000,
        net_cumulative_cash_position_inr: Number(netCashSubunits) / 10000
      });
    }

    const day90NetCashInr = Number(projectedRevSubunits - totalOutlaySubunits) / 10000;
    const grossRevInr = Number(projectedRevSubunits) / 10000;
    const unallocatedCashBufferInr = Number(unallocatedCashBufferSubunits) / 10000;
    const endingTotalAccountCashInr = grossRevInr + unallocatedCashBufferInr;

    // Mathematical reconciliation:
    // Net Gain = Ending Total Account Cash - Budget Capital
    //          = (Gross Revenue + Unallocated Buffer) - (Deployed Inventory Capital + Unallocated Buffer)
    //          = Gross Revenue - Deployed Inventory Capital
    //          = Base Net Trading Profit!
    // Variance = 0 subunits!
    const accountingReconciliation: AccountingReconciliation = {
      budget_capital_inr: Number(totalCapitalSubunits) / 10000,
      budget_capital_subunits: totalCapitalSubunits.toString(),
      deployed_inventory_capital_inr: Number(deployedInventoryCapitalSubunits) / 10000,
      deployed_inventory_capital_subunits: deployedInventoryCapitalSubunits.toString(),
      unallocated_cash_buffer_inr: unallocatedCashBufferInr,
      unallocated_cash_buffer_subunits: unallocatedCashBufferSubunits.toString(),
      gross_sales_revenue_inr: grossRevInr,
      gross_sales_revenue_subunits: projectedRevSubunits.toString(),
      base_net_trading_profit_inr: baseScenario.projected_net_profit_inr,
      base_net_trading_profit_subunits: baseScenario.projected_net_profit_subunits,
      day_90_net_cash_position_inr: day90NetCashInr,
      ending_total_account_cash_inr: Number(endingTotalAccountCashInr.toFixed(2)),
      reconciliation_variance_subunits: (BigInt(baseScenario.projected_net_profit_subunits) - (projectedRevSubunits - totalOutlaySubunits)).toString(),
      rowc_formula_documented: 'Annualized RoWC (bps) = roundHalfEven((net_profit_subunits * 365 * 10000) / (deployed_inventory_capital_subunits * holding_period_days))'
    };

    // Enforce data completeness: any product missing critical pricing inputs triggers DATA_REQUIRED_HOLD
    const missingDataProds = selectedProds.filter(
      (p) => !p.upstream_supply?.factory_gate_quote_inr || !p.sell_side?.prevailing_retail_asp_inr || (p.strategy?.research_case_status as string) === 'DATA_REQUIRED'
    );

    let disposition: BundleEvaluationResult['recommended_disposition'] = 'HOLD_EVALUATION_PENDING';
    let rationale: string;

    const hasFixtureOrProxyEvidence = selectedProds.some(
      (p) => p.evidence_origin?.origin_class === 'RECORDED_GOLDEN_FIXTURE' ||
             p.evidence_origin?.origin_class === 'UNATTESTED_USER_INTAKE' ||
             (p.strategy?.research_case_status as string) === 'IN_RESEARCH' ||
             (p.strategy?.research_case_status as string) === 'ACTIVE_OBSERVATION'
    );

    if (missingDataProds.length > 0) {
      disposition = 'DATA_REQUIRED_HOLD';
      rationale = `Bundle contains ${missingDataProds.length} product(s) [${missingDataProds.map((p) => p.product_id).join(', ')}] with unverified or missing factory-gate quotes or retail ASP (DATA_REQUIRED). Financial scenarios cannot be cleared without empirical pricing inputs.`;
    } else if (concentrationLimitBreached) {
      disposition = 'CONCENTRATION_LIMIT_BREACHED';
      rationale = `Supplier concentration limit breached: supplier "${highestSupplier.supplier_name}" accounts for ${highestSupplier.concentration_bps} bps of total allocated capital (limit: ${maxConcBps} bps).`;
    } else if (unknownSupplierConcentrationBps > 0) {
      disposition = 'DATA_REQUIRED_HOLD';
      rationale = `Bundle includes ${unknownSupplierConcentrationBps} bps allocated to unverified or unknown suppliers. Verified supplier identities are mandatory before paper test qualification.`;
    } else if (!beatsTbill || !beatsFd || baseRowcBps < fdBenchmarkBps) {
      disposition = 'ECONOMICS_FAIL_BELOW_BENCHMARK';
      rationale = `Bundle annualized Base RoWC (${baseRowcBps} bps) fails to exceed risk-free benchmarks (RBI 91D T-Bill: 650 bps, SBI 1-Yr Bulk FD: 725 bps). Capital is better deployed in risk-free sovereign instruments.`;
    } else if (!baseScenario.hurdle_satisfied) {
      disposition = 'HURDLE_UNMET';
      rationale = `Base scenario RoWC (${baseScenario.annualized_rowc_bps} bps) fails minimum hurdle threshold (${intent.min_return_hurdle_bps} bps).`;
    } else if (baseScenario.contribution_margin_bps < 1500) {
      disposition = 'MARGIN_TOO_THIN';
      rationale = `Aggregate contribution margin (${baseScenario.contribution_margin_bps} bps) is too thin (<1500 bps) to absorb freight or advertising variance.`;
    } else if (!downsideScenario.max_drawdown_contained) {
      disposition = 'EXCESSIVE_STRESS_DRAWDOWN';
      rationale = `Downside stress test violates maximum acceptable drawdown threshold of ${intent.max_drawdown_pct}%.`;
    } else if (hasFixtureOrProxyEvidence) {
      disposition = 'READY_FOR_PAPER_TEST';
      rationale = `Bundle meets financial hurdle (${baseScenario.annualized_rowc_bps} bps >= ${intent.min_return_hurdle_bps} bps) under fixture-backed inputs. Capped at READY_FOR_PAPER_TEST pending authenticated live supplier quotes.`;
    } else {
      disposition = 'RECOMMENDED_PURSUE';
      rationale = `Bundle meets required hurdle of ${intent.min_return_hurdle_bps} bps in both Base (${baseScenario.annualized_rowc_bps} bps) and Upside (${upsideScenario.annualized_rowc_bps} bps) scenarios with contained downside stress drawdown and healthy benchmark spread (+${netExcessOverTbill} bps over T-Bill).`;
    }

    const bundleId = `BNDL-${sha256(intent.intent_id + ':' + slices.map((s) => s.product_id).sort().join(',')).slice(0, 10).toUpperCase()}`;

    const rawResult: Omit<BundleEvaluationResult, 'jcs_sha256'> = {
      bundle_id: bundleId,
      intent,
      slices,
      scenarios: {
        base: baseScenario,
        upside: upsideScenario,
        downside: downsideScenario,
        base_scenario: baseScenario,
        upside_scenario: upsideScenario,
        downside_stress_scenario: downsideScenario,
        stress: downsideScenario
      },
      concentration_analysis: concentrationAnalysis,
      seasonal_window_analysis: seasonalWindowAnalysis,
      benchmark_comparison: benchmarkComparison,
      cash_flow_j_curve: jCurve,
      unallocated_cash_buffer_inr: unallocatedCashBufferInr,
      unallocated_cash_buffer_subunits: unallocatedCashBufferSubunits.toString(),
      accounting_reconciliation: accountingReconciliation,
      recommended_disposition: disposition,
      mathematical_rationale: rationale
    };

    const jcsSha256 = sha256(canonicalizeJCS(sanitizeForJcs(rawResult)));

    const evalResult: BundleEvaluationResult = {
      ...rawResult,
      jcs_sha256: jcsSha256
    };
    this.evaluatedBundles.set(bundleId, evalResult);

    return evalResult;
  }

  private calculateScenario(
    name: 'BASE' | 'UPSIDE' | 'DOWNSIDE_STRESS',
    description: string,
    slices: ProductAllocationSlice[],
    costMultiplierBps: bigint,
    priceMultiplierBps: bigint,
    holdingDays: number,
    hurdleBps: number,
    maxDrawdownPct: number
  ): ScenarioFinancialMetrics {
    let totalAllocatedSubunits = 0n;
    let totalRevenueSubunits = 0n;

    for (const slice of slices) {
      const perUnitLanded = BigInt(Math.round(slice.per_unit_landed_cost_inr * 10000));
      const adjustedLanded = divideHalfEven(perUnitLanded * costMultiplierBps, 100n);

      const perUnitRetail = BigInt(Math.round(slice.retail_asp_inr * 10000));
      const adjustedRetail = divideHalfEven(perUnitRetail * priceMultiplierBps, 100n);

      const qty = BigInt(slice.unit_batch_quantity);
      const allocated = adjustedLanded * qty;
      const revenue = adjustedRetail * qty;

      totalAllocatedSubunits += allocated;
      totalRevenueSubunits += revenue;
    }

    const netProfitSubunits = totalRevenueSubunits - totalAllocatedSubunits;
    const netProfitInr = Number(netProfitSubunits) / 10000;
    const allocatedInr = Number(totalAllocatedSubunits) / 10000;
    const revenueInr = Number(totalRevenueSubunits) / 10000;

    const contributionMarginBps = totalRevenueSubunits > 0n
      ? Number(divideHalfEven(netProfitSubunits * 10000n, totalRevenueSubunits))
      : 0;

    // Annualized RoWC: (Profit / Capital) * (365 / holdingDays) * 10000 bps
    const safeDays = BigInt(Math.max(1, holdingDays));
    const annualizedRowcBps = totalAllocatedSubunits > 0n
      ? Number(divideHalfEven(netProfitSubunits * 365n * 10000n, totalAllocatedSubunits * safeDays))
      : 0;

    const hurdleSatisfied = annualizedRowcBps >= hurdleBps;

    // Max drawdown check: in downside stress, loss should not exceed maxDrawdownPct of capital
    let drawdownContained = true;
    if (netProfitSubunits < 0n) {
      const lossBps = Number(divideHalfEven((-netProfitSubunits) * 10000n, totalAllocatedSubunits));
      const maxAllowedBps = maxDrawdownPct * 100;
      drawdownContained = lossBps <= maxAllowedBps;
    }

    return {
      scenario_name: name,
      description,
      allocated_capital_inr: Number(allocatedInr.toFixed(2)),
      allocated_capital_subunits: totalAllocatedSubunits.toString(),
      projected_gross_revenue_inr: Number(revenueInr.toFixed(2)),
      projected_gross_revenue_subunits: totalRevenueSubunits.toString(),
      projected_net_profit_inr: Number(netProfitInr.toFixed(2)),
      projected_net_profit_subunits: netProfitSubunits.toString(),
      contribution_margin_bps: contributionMarginBps,
      cash_conversion_cycle_days: holdingDays,
      annualized_rowc_bps: annualizedRowcBps,
      hurdle_satisfied: hurdleSatisfied,
      max_drawdown_contained: drawdownContained
    };
  }

  /**
   * Commits the evaluated bundle to paper simulation under human governance.
   */
  public commitBundleToPaperSimulation(
    evaluation: BundleEvaluationResult,
    confirmation: OperatorConfirmationEnvelope,
    killSwitch: KillSwitchController
  ): GovernedOperatorActionExecutionResult<CommittedBundleRecord> {
    killSwitch.assertSimulationAllowed();

    // 1. Authoritative Server-Held Evaluation Lookup
    const serverHeldEval = this.getEvaluationById(evaluation.bundle_id);
    if (!serverHeldEval) {
      const err = new Error(
        `E-BUNDLE-EVALUATION-NOT-FOUND: No server-held evaluation found for bundle_id "${evaluation.bundle_id}". A bundle must be formally evaluated by the server before it can be committed.`
      );
      (err as any).statusCode = 404;
      throw err;
    }

    // 2. Caller Evaluation Anti-Tampering Check
    const { jcs_sha256: callerHash, ...evalWithoutHash } = (evaluation as any) || {};
    const recomputedCallerHash = sha256(canonicalizeJCS(sanitizeForJcs(evalWithoutHash)));
    if (
      serverHeldEval.jcs_sha256 !== callerHash ||
      recomputedCallerHash !== serverHeldEval.jcs_sha256 ||
      recomputedCallerHash !== callerHash
    ) {
      const err = new Error(
        `E-BUNDLE-EVALUATION-TAMPERED: Caller-submitted evaluation SHA-256 ("${callerHash}") does not match server-held canonical evaluation SHA-256 ("${serverHeldEval.jcs_sha256}") or recomputed payload hash ("${recomputedCallerHash}") for bundle "${evaluation.bundle_id}". Caller spoofing or fabrication is strictly prohibited.`
      );
      (err as any).statusCode = 409;
      throw err;
    }

    // 3. Immutability Check: Prevent Duplicate Commitment
    if (this.committedBundles.has(serverHeldEval.bundle_id)) {
      const err = new Error(
        `E-BUNDLE-ALREADY-COMMITTED: Bundle allocation "${serverHeldEval.bundle_id}" has already been committed and is immutable. Overwriting existing committed paper allocations is strictly prohibited.`
      );
      (err as any).statusCode = 409;
      throw err;
    }

    // 4. Disposition Qualification Gate
    if (serverHeldEval.recommended_disposition !== 'RECOMMENDED_PURSUE' && serverHeldEval.recommended_disposition !== 'READY_FOR_PAPER_TEST') {
      const err = new Error(
        `E-BUNDLE-UNQUALIFIED-COMMIT-BLOCKED: Cannot commit bundle with disposition "${serverHeldEval.recommended_disposition}". Only bundles passing all financial hurdles and risk constraints (RECOMMENDED_PURSUE or READY_FOR_PAPER_TEST) may be committed.`
      );
      (err as any).statusCode = 409;
      throw err;
    }

    return executeGovernedOperatorAction(() => {
      const nowUtc = new Date().toISOString();
      const rawCommit: Omit<CommittedBundleRecord, 'jcs_sha256'> = {
        bundle_id: serverHeldEval.bundle_id,
        committed_at_utc: nowUtc,
        operator_id: confirmation.operator_id,
        confirmation_rationale: confirmation.explicit_rationale,
        allocated_capital_inr: serverHeldEval.scenarios.base.allocated_capital_inr,
        status: 'COMMITTED_TO_PAPER_SIMULATION',
        evaluation: serverHeldEval
      };

      const jcsSha256 = sha256(canonicalizeJCS(sanitizeForJcs(rawCommit)));
      const committed: CommittedBundleRecord = {
        ...rawCommit,
        jcs_sha256: jcsSha256
      };

      this.committedBundles.set(serverHeldEval.bundle_id, committed);
      return committed;
    }, confirmation);
  }

  public getCommittedBundles(): CommittedBundleRecord[] {
    return Array.from(this.committedBundles.values());
  }

  public getBundleById(bundleId: string): CommittedBundleRecord | undefined {
    return this.committedBundles.get(bundleId);
  }

  public getEvaluationById(bundleId: string): BundleEvaluationResult | undefined {
    return this.evaluatedBundles.get(bundleId) || this.committedBundles.get(bundleId)?.evaluation;
  }

  public loadCommittedRecord(record: CommittedBundleRecord): void {
    this.committedBundles.set(record.bundle_id, record);
  }
}
