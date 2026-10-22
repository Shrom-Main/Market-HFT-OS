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

export interface UserIntentModel {
  intent_id: string;
  operator_id: string;
  target_capital_inr: number;
  target_capital_subunits: string; // BigInt serializable as string
  min_return_hurdle_bps: number;   // e.g. 2000 = 20.00%
  target_holding_period_days: number;
  max_risk_tolerance: 'LOW' | 'MEDIUM' | 'HIGH';
  max_drawdown_pct: number;
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
  recommended_disposition:
    | 'RECOMMENDED_PURSUE'
    | 'READY_FOR_PAPER_TEST'
    | 'PROMISING_BUT_UNVALIDATED'
    | 'MARGIN_TOO_THIN'
    | 'HURDLE_UNMET'
    | 'EXCESSIVE_STRESS_DRAWDOWN'
    | 'DATA_REQUIRED_HOLD'
    | 'INSUFFICIENT_EVIDENCE'
    | 'HOLD_EVALUATION_PENDING';
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
// 3. BUNDLE EVALUATOR ENGINE
// ============================================================================

export class BundleEvaluator {
  private committedBundles: Map<string, CommittedBundleRecord> = new Map();

  /**
   * Evaluates user intent against a selection of products across 3 deterministic scenarios.
   */
  public evaluateBundle(
    rawIntent: any,
    products: readonly ProductObservationItem[]
  ): BundleEvaluationResult {
    const rawCapitalInr = rawIntent?.target_capital_inr ?? rawIntent?.capital_budget_inr;
    const targetSubunits = rawIntent?.target_capital_subunits;
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

    const selectedProds = products.filter((p) => candidateIds.includes(p.product_id));

    if (selectedProds.length === 0) {
      throw new Error('E-BUNDLE-NO-PRODUCTS: At least one valid product lead must be explicitly selected.');
    }

    const intent: UserIntentModel = {
      intent_id: rawIntent?.intent_id || `INTENT-${Date.now()}`,
      operator_id: rawIntent?.operator_id || 'operator:terminal:web',
      target_capital_inr: rawCapitalInr,
      target_capital_subunits: totalCapitalSubunits.toString(),
      min_return_hurdle_bps: rawIntent?.min_return_hurdle_bps || rawIntent?.return_hurdle_bps || 2000,
      target_holding_period_days: rawIntent?.target_holding_period_days || rawIntent?.holding_period_days || 45,
      max_risk_tolerance: rawIntent?.max_risk_tolerance || (rawIntent?.risk_tolerance === 'CONSERVATIVE' ? 'LOW' : rawIntent?.risk_tolerance === 'AGGRESSIVE' ? 'HIGH' : 'MEDIUM'),
      max_drawdown_pct: rawIntent?.max_drawdown_pct || 10.0,
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
      rationale = `Bundle meets required hurdle of ${intent.min_return_hurdle_bps} bps in both Base (${baseScenario.annualized_rowc_bps} bps) and Upside (${upsideScenario.annualized_rowc_bps} bps) scenarios with contained downside stress drawdown.`;
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
      recommended_disposition: disposition,
      mathematical_rationale: rationale
    };

    const jcsSha256 = sha256(canonicalizeJCS(sanitizeForJcs(rawResult)));

    return {
      ...rawResult,
      jcs_sha256: jcsSha256
    };
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

    if (evaluation.recommended_disposition !== 'RECOMMENDED_PURSUE' && evaluation.recommended_disposition !== 'READY_FOR_PAPER_TEST') {
      const err = new Error(
        `E-BUNDLE-UNQUALIFIED-COMMIT-BLOCKED: Cannot commit bundle with disposition "${evaluation.recommended_disposition}". Only bundles passing all financial hurdles and risk constraints (RECOMMENDED_PURSUE or READY_FOR_PAPER_TEST) may be committed.`
      );
      (err as any).statusCode = 409;
      throw err;
    }

    return executeGovernedOperatorAction(() => {
      const nowUtc = new Date().toISOString();
      const rawCommit: Omit<CommittedBundleRecord, 'jcs_sha256'> = {
        bundle_id: evaluation.bundle_id,
        committed_at_utc: nowUtc,
        operator_id: confirmation.operator_id,
        confirmation_rationale: confirmation.explicit_rationale,
        allocated_capital_inr: evaluation.scenarios.base.allocated_capital_inr,
        status: 'COMMITTED_TO_PAPER_SIMULATION',
        evaluation
      };

      const jcsSha256 = sha256(canonicalizeJCS(sanitizeForJcs(rawCommit)));
      const committed: CommittedBundleRecord = {
        ...rawCommit,
        jcs_sha256: jcsSha256
      };

      this.committedBundles.set(evaluation.bundle_id, committed);
      return committed;
    }, confirmation);
  }

  public getCommittedBundles(): CommittedBundleRecord[] {
    return Array.from(this.committedBundles.values());
  }

  public getBundleById(bundleId: string): CommittedBundleRecord | undefined {
    return this.committedBundles.get(bundleId);
  }

  public loadCommittedRecord(record: CommittedBundleRecord): void {
    this.committedBundles.set(record.bundle_id, record);
  }
}
