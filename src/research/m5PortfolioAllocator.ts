/**
 * Gate M5 Multi-Opportunity Portfolio Capital Rationing & Sandbox Formula Stress-Testing
 *
 * Implements Stage 3 portfolio capital allocation across multiple competing
 * physical arbitrage opportunities under hard treasury working-capital constraints,
 * discrete MOQ lot-sizing, concentration caps, and sovereign T-Bill cash sweeps.
 *
 * Enforces:
 * 1. Multi-candidate evaluation and ranking by Risk-Adjusted Annualized RoWC net of hurdle rate.
 * 2. Hard corporate treasury working-capital budget (e.g. ₹50,000.0000 = 500,000,000 subunits).
 * 3. Single-candidate concentration cap (e.g. max 50.00% / 5000 bps).
 * 4. Discrete MOQ lot sizing (integer multiples only; zero fractional lots).
 * 5. Sovereign 91-day T-Bill reserve sweep enforcing exact budget conservation.
 * 6. Dual-pass Formula Registry bridge: authoritative PROMOTED_NORMATIVE evaluation vs.
 *    isolated shadow what-if sandbox comparison for CANDIDATE_UI_MODEL formulas.
 * 7. Bit-for-bit deterministic RFC 8785 JCS canonicalization and SHA-256 attestation.
 */

import { createHash } from 'crypto';
import { canonicalizeJCS } from '../canonical/jcs.js';
import {
  M4ResearchAllocationEngine,
  M4VerticalSliceInputs,
  CapitalAllocationDecisionResult
} from './m4VerticalSlice.js';
import {
  FormulaCard,
  FormulaRegistry,
  evaluateSymbolicExpression
} from './formulaRegistry.js';

export interface CandidateOpportunityInput {
  candidate_id: string;
  product_id: string;
  title: string;
  vertical_slice_inputs: M4VerticalSliceInputs;
  moq: number;
  custom_hurdle_rate_bps?: bigint;
  stress_parameters?: Record<string, bigint | number>;
}

export interface PortfolioAllocatorConfig {
  total_treasury_budget_subunits: bigint; // e.g. 500000000n = ₹50,000.0000
  max_single_candidate_concentration_bps?: bigint; // default 5000n = 50.00%
  risk_free_rate_bps?: bigint; // default 650n = 6.50% (91-day T-Bill)
  default_hurdle_rate_bps?: bigint; // default 1500n = 15.00%
  formula_registry?: FormulaRegistry;
}

export interface EvaluatedCandidateUnit {
  candidate_id: string;
  product_id: string;
  title: string;
  moq: number;
  unit_landed_cost_subunits: bigint;
  unit_net_contribution_subunits: bigint;
  cash_conversion_cycle_days: number;
  cash_margin_bps: bigint;
  annualized_rowc_bps: bigint;
  hurdle_rate_bps: bigint;
  excess_rowc_bps: bigint;
  batch_outlay_subunits: bigint; // moq * unit_landed_cost_subunits
  is_provenance_valid: boolean;
  isolated_viable: boolean;
  rejection_reasons: string[];
  m4_result: CapitalAllocationDecisionResult;
}

export interface AllocatedPosition {
  candidate_id: string;
  product_id: string;
  title: string;
  rank: number;
  allocated_lots: number;
  allocated_quantity: number;
  unit_landed_cost_subunits: string;
  allocated_capital_subunits: string;
  annualized_rowc_bps: string;
  cash_conversion_cycle_days: number;
}

export interface RejectedCandidate {
  candidate_id: string;
  product_id: string;
  title: string;
  status: 'REJECTED' | 'QUARANTINED';
  rejection_reasons: string[];
  isolated_viable: boolean;
  unit_landed_cost_subunits?: string;
  batch_outlay_subunits?: string;
  annualized_rowc_bps?: string;
}

export interface ShadowOpportunityDelta {
  candidate_id: string;
  product_id: string;
  original_decision: 'APPROVED' | 'REJECTED' | 'QUARANTINED';
  shadow_decision: 'APPROVED' | 'REJECTED' | 'QUARANTINED';
  decision_flipped: boolean;
  original_rank?: number;
  shadow_rank?: number;
  rank_flipped: boolean;
  original_unit_contribution_subunits: string;
  shadow_unit_contribution_subunits: string;
  unit_contribution_delta_subunits: string; // shadow - original
  original_rowc_bps: string;
  shadow_rowc_bps: string;
  rowc_delta_bps: string;
  stress_formula_id_applied?: string;
  rejection_reasons: string[];
}

export interface ShadowDeltaReport {
  stress_formulas_applied: string[];
  candidate_deltas: ShadowOpportunityDelta[];
  aggregate_authoritative_committed_subunits: string;
  aggregate_shadow_committed_subunits: string;
  net_committed_capital_delta_subunits: string;
  has_decision_flips: boolean;
  has_rank_flips: boolean;
}

export interface PortfolioAllocationDecision {
  decision_id: string;
  timestamp_utc: string;
  execution_mode: 'PAPER_SIMULATION';
  total_treasury_budget_subunits: string;
  committed_capital_subunits: string;
  unallocated_tbill_sweep_subunits: string;
  tbill_annualized_yield_bps: string;
  effective_portfolio_rowc_bps: string;
  conservation_verified: boolean;
  allocations: AllocatedPosition[];
  rejections: RejectedCandidate[];
  shadow_sandbox_comparison?: ShadowDeltaReport;
  portfolio_decision_sha256: string;
}

export interface ShadowStressOption {
  stress_formula?: FormulaCard;
  candidate_parameter_overrides?: Record<string, Record<string, bigint | number>>;
}

export class M5PortfolioCapitalAllocator {
  private readonly config: Required<PortfolioAllocatorConfig>;
  private readonly m4Engine: M4ResearchAllocationEngine;

  constructor(config: PortfolioAllocatorConfig) {
    this.config = {
      total_treasury_budget_subunits: config.total_treasury_budget_subunits,
      max_single_candidate_concentration_bps:
        config.max_single_candidate_concentration_bps ?? 5000n, // 50.00%
      risk_free_rate_bps: config.risk_free_rate_bps ?? 650n, // 6.50%
      default_hurdle_rate_bps: config.default_hurdle_rate_bps ?? 1500n, // 15.00%
      formula_registry: config.formula_registry ?? new FormulaRegistry()
    };
    this.m4Engine = new M4ResearchAllocationEngine();
  }

  /**
   * Evaluates an individual candidate through the M4 unit-economics and provenance pipeline.
   * Authoritative mode strictly permits PROMOTED_NORMATIVE formulas only.
   */
  public evaluateCandidate(
    candidate: CandidateOpportunityInput,
    stressOption?: ShadowStressOption
  ): EvaluatedCandidateUnit {
    const m4Result = this.m4Engine.evaluateOpportunity(candidate.vertical_slice_inputs);
    const reasons: string[] = [];
    let isProvenanceValid = true;

    if (!m4Result.constraint_evaluations.evidence_provenance_verified) {
      isProvenanceValid = false;
      reasons.push(
        ...((m4Result.rejection_reasons ?? []).filter((r) =>
          r.includes('UNVERIFIED') || r.includes('STALE') || r.includes('CLOCK') || r.includes('MANDATORY')
        ))
      );
      if (reasons.length === 0) {
        reasons.push('E-M5-UNVERIFIED-PROVENANCE: Defective or unverified cryptographic evidence envelope');
      }
    }

    const sq = candidate.vertical_slice_inputs.supplier_quote?.payload;
    const log = candidate.vertical_slice_inputs.inbound_logistics?.payload;
    const pkg = candidate.vertical_slice_inputs.packaging_kitting?.payload;
    const ops = candidate.vertical_slice_inputs.operational_params;

    let landedCostSubunits = 0n;
    if (sq && log && pkg) {
      landedCostSubunits =
        sq.raw_material_purchase_subunits +
        log.inbound_freight_subunits +
        pkg.packaging_kitting_subunits +
        log.insurance_handling_subunits +
        log.customs_inspection_subunits;
    }

    let unitContributionSubunits = 0n;
    let cccDays = ops?.procurement_lead_time_days
      ? ops.procurement_lead_time_days + ops.warehouse_dwell_days + ops.marketplace_settlement_delay_days
      : 35;
    if (sq && sq.payment_terms_days) {
      cccDays = Math.max(1, cccDays - sq.payment_terms_days);
    }

    if (m4Result.allocation_parameters) {
      const parsedContrib = BigInt(
        Math.round(parseFloat(m4Result.allocation_parameters.unit_net_contribution_inr) * 10000)
      );
      unitContributionSubunits = parsedContrib;
      cccDays = m4Result.allocation_parameters.cash_conversion_cycle_days;
    }

    const hurdleRateBps = candidate.custom_hurdle_rate_bps ?? this.config.default_hurdle_rate_bps;

    // Apply stress formula if in shadow what-if mode
    let appliedStressFormulaId: string | undefined;
    if (stressOption?.stress_formula) {
      appliedStressFormulaId = stressOption.stress_formula.formula_id;
      const formula = stressOption.stress_formula;
      const overrideVars =
        stressOption.candidate_parameter_overrides?.[candidate.candidate_id] ??
        candidate.stress_parameters ??
        {};

      const evalInputs: Record<string, bigint | number> = {
        landed_cost_subunits: landedCostSubunits,
        landed_cost: landedCostSubunits,
        landedcost: landedCostSubunits,
        unit_landed_cost: landedCostSubunits,
        unit_net_contribution_subunits: unitContributionSubunits,
        unit_net_contribution: unitContributionSubunits,
        net_contribution: unitContributionSubunits,
        netcontribution: unitContributionSubunits,
        ...overrideVars
      };

      // Add lowercase aliases for any override variable
      for (const [k, v] of Object.entries(overrideVars)) {
        const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        evalInputs[clean] = v;
      }

      try {
        let dragSubunits = 0n;
        if (this.config.formula_registry.hasEvaluator(formula.formula_id)) {
          dragSubunits = this.config.formula_registry.evaluateFormula(
            formula.formula_id,
            evalInputs,
            { allowCandidate: true }
          );
        } else {
          dragSubunits = evaluateSymbolicExpression(formula.symbolic_expression, evalInputs);
        }
        unitContributionSubunits -= dragSubunits;
      } catch (e: any) {
        reasons.push(`E-M5-STRESS-EVALUATION-FAILED: ${e.message}`);
      }
    }

    // Compute RoWC
    const cashMarginBps =
      landedCostSubunits > 0n
        ? (unitContributionSubunits * 10000n) / landedCostSubunits
        : -10000n;

    const annualizedRowcBps =
      cccDays > 0 ? (cashMarginBps * 365n) / BigInt(cccDays) : 0n;

    const excessRowcBps = annualizedRowcBps - hurdleRateBps;

    let isolatedViable = false;
    if (isProvenanceValid) {
      if (unitContributionSubunits <= 0n) {
        reasons.push(
          `E-M5-NEGATIVE-CONTRIBUTION: Unit net contribution ${unitContributionSubunits} subunits is non-positive`
        );
      } else if (annualizedRowcBps < hurdleRateBps) {
        reasons.push(
          `E-M5-SUB-HURDLE-RETURN: Annualized RoWC ${annualizedRowcBps} bps is below hurdle rate ${hurdleRateBps} bps`
        );
      } else if (m4Result.decision === 'DO_NOT_ALLOCATE_CAPITAL') {
        reasons.push(
          ...(m4Result.rejection_reasons ?? ['E-M5-UNIT-ECONOMICS-DECAYED: Unit economics failed normative thresholds'])
        );
      } else {
        isolatedViable = true;
      }
    }

    const batchOutlaySubunits = BigInt(candidate.moq) * landedCostSubunits;

    return {
      candidate_id: candidate.candidate_id,
      product_id: candidate.product_id,
      title: candidate.title,
      moq: candidate.moq,
      unit_landed_cost_subunits: landedCostSubunits,
      unit_net_contribution_subunits: unitContributionSubunits,
      cash_conversion_cycle_days: cccDays,
      cash_margin_bps: cashMarginBps,
      annualized_rowc_bps: annualizedRowcBps,
      hurdle_rate_bps: hurdleRateBps,
      excess_rowc_bps: excessRowcBps,
      batch_outlay_subunits: batchOutlaySubunits,
      is_provenance_valid: isProvenanceValid,
      isolated_viable: isolatedViable,
      rejection_reasons: Array.from(new Set(reasons)),
      m4_result: m4Result
    };
  }

  /**
   * Executes discrete capital rationing over a pool of evaluated candidates.
   */
  private rationCapital(
    evaluatedCandidates: EvaluatedCandidateUnit[]
  ): {
    allocations: AllocatedPosition[];
    rejections: RejectedCandidate[];
    committedCapitalSubunits: bigint;
    unallocatedTbillSweepSubunits: bigint;
    effectivePortfolioRowcBps: bigint;
  } {
    const totalBudget = this.config.total_treasury_budget_subunits;
    const maxSingleCap = (totalBudget * this.config.max_single_candidate_concentration_bps) / 10000n;

    // Filter viable candidates vs non-viable
    const viable: EvaluatedCandidateUnit[] = [];
    const initialRejections: RejectedCandidate[] = [];

    for (const cand of evaluatedCandidates) {
      if (!cand.is_provenance_valid) {
        initialRejections.push({
          candidate_id: cand.candidate_id,
          product_id: cand.product_id,
          title: cand.title,
          status: 'QUARANTINED',
          rejection_reasons: cand.rejection_reasons,
          isolated_viable: false,
          unit_landed_cost_subunits: cand.unit_landed_cost_subunits.toString(),
          batch_outlay_subunits: cand.batch_outlay_subunits.toString(),
          annualized_rowc_bps: cand.annualized_rowc_bps.toString()
        });
      } else if (!cand.isolated_viable) {
        initialRejections.push({
          candidate_id: cand.candidate_id,
          product_id: cand.product_id,
          title: cand.title,
          status: 'REJECTED',
          rejection_reasons: cand.rejection_reasons,
          isolated_viable: false,
          unit_landed_cost_subunits: cand.unit_landed_cost_subunits.toString(),
          batch_outlay_subunits: cand.batch_outlay_subunits.toString(),
          annualized_rowc_bps: cand.annualized_rowc_bps.toString()
        });
      } else {
        viable.push(cand);
      }
    }

    // Rank viable candidates descending by excess_rowc_bps
    // Tie-breaker: shorter CCC days, higher unit contribution, ascending product_id
    viable.sort((a, b) => {
      if (b.excess_rowc_bps !== a.excess_rowc_bps) {
        return b.excess_rowc_bps > a.excess_rowc_bps ? 1 : -1;
      }
      if (a.cash_conversion_cycle_days !== b.cash_conversion_cycle_days) {
        return a.cash_conversion_cycle_days - b.cash_conversion_cycle_days;
      }
      if (b.unit_net_contribution_subunits !== a.unit_net_contribution_subunits) {
        return b.unit_net_contribution_subunits > a.unit_net_contribution_subunits ? 1 : -1;
      }
      return a.product_id.localeCompare(b.product_id);
    });

    let remainingBudget = totalBudget;
    const allocations: AllocatedPosition[] = [];
    const rationingRejections: RejectedCandidate[] = [];

    let rankCounter = 1;
    for (const cand of viable) {
      const batchOutlay = cand.batch_outlay_subunits;

      if (batchOutlay > maxSingleCap) {
        rationingRejections.push({
          candidate_id: cand.candidate_id,
          product_id: cand.product_id,
          title: cand.title,
          status: 'REJECTED',
          rejection_reasons: [
            `E-M5-CONCENTRATION-CAP-EXCEEDED: Single MOQ batch outlay ${batchOutlay} exceeds concentration cap ${maxSingleCap}`
          ],
          isolated_viable: true,
          unit_landed_cost_subunits: cand.unit_landed_cost_subunits.toString(),
          batch_outlay_subunits: batchOutlay.toString(),
          annualized_rowc_bps: cand.annualized_rowc_bps.toString()
        });
        continue;
      }

      if (batchOutlay > remainingBudget) {
        rationingRejections.push({
          candidate_id: cand.candidate_id,
          product_id: cand.product_id,
          title: cand.title,
          status: 'REJECTED',
          rejection_reasons: [
            `E-M5-BUDGET-EXHAUSTED: Single MOQ batch outlay ${batchOutlay} exceeds remaining budget ${remainingBudget}`
          ],
          isolated_viable: true,
          unit_landed_cost_subunits: cand.unit_landed_cost_subunits.toString(),
          batch_outlay_subunits: batchOutlay.toString(),
          annualized_rowc_bps: cand.annualized_rowc_bps.toString()
        });
        continue;
      }

      // Discrete integer lot sizing: k = min(floor(maxSingleCap / batchOutlay), floor(remainingBudget / batchOutlay))
      const maxLotsFromCap = maxSingleCap / batchOutlay;
      const maxLotsFromBudget = remainingBudget / batchOutlay;
      const allocatedLots = Number(maxLotsFromCap < maxLotsFromBudget ? maxLotsFromCap : maxLotsFromBudget);

      if (allocatedLots < 1) {
        rationingRejections.push({
          candidate_id: cand.candidate_id,
          product_id: cand.product_id,
          title: cand.title,
          status: 'REJECTED',
          rejection_reasons: [
            `E-M5-BUDGET-EXHAUSTED: Insufficient budget or concentration room for full MOQ batch`
          ],
          isolated_viable: true,
          unit_landed_cost_subunits: cand.unit_landed_cost_subunits.toString(),
          batch_outlay_subunits: batchOutlay.toString(),
          annualized_rowc_bps: cand.annualized_rowc_bps.toString()
        });
        continue;
      }

      const allocatedQty = allocatedLots * cand.moq;
      const allocatedCapital = BigInt(allocatedLots) * batchOutlay;

      remainingBudget -= allocatedCapital;

      allocations.push({
        candidate_id: cand.candidate_id,
        product_id: cand.product_id,
        title: cand.title,
        rank: rankCounter++,
        allocated_lots: allocatedLots,
        allocated_quantity: allocatedQty,
        unit_landed_cost_subunits: cand.unit_landed_cost_subunits.toString(),
        allocated_capital_subunits: allocatedCapital.toString(),
        annualized_rowc_bps: cand.annualized_rowc_bps.toString(),
        cash_conversion_cycle_days: cand.cash_conversion_cycle_days
      });
    }

    const committedCapitalSubunits = totalBudget - remainingBudget;
    const unallocatedTbillSweepSubunits = remainingBudget;

    // Effective portfolio RoWC: weighted average of allocated investments and T-Bill yield
    let totalWeightedReturn = unallocatedTbillSweepSubunits * this.config.risk_free_rate_bps;
    for (const alloc of allocations) {
      totalWeightedReturn += BigInt(alloc.allocated_capital_subunits) * BigInt(alloc.annualized_rowc_bps);
    }
    const effectivePortfolioRowcBps = totalBudget > 0n ? totalWeightedReturn / totalBudget : 0n;

    return {
      allocations,
      rejections: [...rationingRejections, ...initialRejections],
      committedCapitalSubunits,
      unallocatedTbillSweepSubunits,
      effectivePortfolioRowcBps
    };
  }

  /**
   * Main entrypoint: allocates capital across candidates using authoritative PROMOTED_NORMATIVE
   * formulas, and optionally computes a non-binding shadow what-if comparison report.
   */
  public allocatePortfolio(
    candidates: CandidateOpportunityInput[],
    options?: {
      decision_id?: string;
      timestamp_utc?: string;
      shadow_stress?: ShadowStressOption;
    }
  ): PortfolioAllocationDecision {
    const timestampUtc = options?.timestamp_utc ?? new Date().toISOString();
    const decisionId = options?.decision_id ?? `dec:m5:${Date.now()}`;

    // 1. Authoritative Evaluation (strictly PROMOTED_NORMATIVE)
    const authoritativeEvaluated = candidates.map((cand) => this.evaluateCandidate(cand));
    const authoritativeRationing = this.rationCapital(authoritativeEvaluated);

    // Verify budget conservation invariant: committed + sweep === total_budget
    const conservationVerified =
      authoritativeRationing.committedCapitalSubunits +
        authoritativeRationing.unallocatedTbillSweepSubunits ===
      this.config.total_treasury_budget_subunits;

    let shadowDeltaReport: ShadowDeltaReport | undefined;

    // 2. Shadow What-If Sandbox Evaluation (if stress formulas provided)
    if (options?.shadow_stress?.stress_formula) {
      const stressFormula = options.shadow_stress.stress_formula;
      const shadowEvaluated = candidates.map((cand) =>
        this.evaluateCandidate(cand, options.shadow_stress)
      );
      const shadowRationing = this.rationCapital(shadowEvaluated);

      const candidateDeltas: ShadowOpportunityDelta[] = [];
      let hasDecisionFlips = false;
      let hasRankFlips = false;

      for (const cand of candidates) {
        const authEval = authoritativeEvaluated.find((e) => e.candidate_id === cand.candidate_id)!;
        const shadEval = shadowEvaluated.find((e) => e.candidate_id === cand.candidate_id)!;

        const authAlloc = authoritativeRationing.allocations.find(
          (a) => a.candidate_id === cand.candidate_id
        );
        const shadAlloc = shadowRationing.allocations.find(
          (a) => a.candidate_id === cand.candidate_id
        );

        const authDecision: 'APPROVED' | 'REJECTED' | 'QUARANTINED' = !authEval.is_provenance_valid
          ? 'QUARANTINED'
          : authAlloc
          ? 'APPROVED'
          : 'REJECTED';

        const shadDecision: 'APPROVED' | 'REJECTED' | 'QUARANTINED' = !shadEval.is_provenance_valid
          ? 'QUARANTINED'
          : shadAlloc
          ? 'APPROVED'
          : 'REJECTED';

        const decisionFlipped = authDecision !== shadDecision;
        if (decisionFlipped) hasDecisionFlips = true;

        const originalRank = authAlloc?.rank;
        const shadowRank = shadAlloc?.rank;
        const rankFlipped =
          (originalRank !== undefined && shadowRank !== undefined && originalRank !== shadowRank) ||
          (originalRank !== undefined && shadowRank === undefined) ||
          (originalRank === undefined && shadowRank !== undefined);
        if (rankFlipped) hasRankFlips = true;

        const contribDelta =
          shadEval.unit_net_contribution_subunits - authEval.unit_net_contribution_subunits;
        const rowcDelta = shadEval.annualized_rowc_bps - authEval.annualized_rowc_bps;

        candidateDeltas.push({
          candidate_id: cand.candidate_id,
          product_id: cand.product_id,
          original_decision: authDecision,
          shadow_decision: shadDecision,
          decision_flipped: decisionFlipped,
          original_rank: originalRank,
          shadow_rank: shadowRank,
          rank_flipped: rankFlipped,
          original_unit_contribution_subunits: authEval.unit_net_contribution_subunits.toString(),
          shadow_unit_contribution_subunits: shadEval.unit_net_contribution_subunits.toString(),
          unit_contribution_delta_subunits: contribDelta.toString(),
          original_rowc_bps: authEval.annualized_rowc_bps.toString(),
          shadow_rowc_bps: shadEval.annualized_rowc_bps.toString(),
          rowc_delta_bps: rowcDelta.toString(),
          stress_formula_id_applied: stressFormula.formula_id,
          rejection_reasons: shadEval.rejection_reasons
        });
      }

      const netCapitalDelta =
        shadowRationing.committedCapitalSubunits - authoritativeRationing.committedCapitalSubunits;

      shadowDeltaReport = {
        stress_formulas_applied: [stressFormula.formula_id],
        candidate_deltas: candidateDeltas,
        aggregate_authoritative_committed_subunits:
          authoritativeRationing.committedCapitalSubunits.toString(),
        aggregate_shadow_committed_subunits:
          shadowRationing.committedCapitalSubunits.toString(),
        net_committed_capital_delta_subunits: netCapitalDelta.toString(),
        has_decision_flips: hasDecisionFlips,
        has_rank_flips: hasRankFlips
      };
    }

    // Build Decision record for RFC 8785 JCS canonicalization
    const decisionRecordWithoutHash = {
      decision_id: decisionId,
      timestamp_utc: timestampUtc,
      execution_mode: 'PAPER_SIMULATION' as const,
      total_treasury_budget_subunits: this.config.total_treasury_budget_subunits.toString(),
      committed_capital_subunits: authoritativeRationing.committedCapitalSubunits.toString(),
      unallocated_tbill_sweep_subunits: authoritativeRationing.unallocatedTbillSweepSubunits.toString(),
      tbill_annualized_yield_bps: this.config.risk_free_rate_bps.toString(),
      effective_portfolio_rowc_bps: authoritativeRationing.effectivePortfolioRowcBps.toString(),
      conservation_verified: conservationVerified,
      allocations: authoritativeRationing.allocations,
      rejections: authoritativeRationing.rejections,
      ...(shadowDeltaReport ? { shadow_sandbox_comparison: shadowDeltaReport } : {})
    };

    const jcsCanonical = canonicalizeJCS(decisionRecordWithoutHash);
    const portfolioDecisionSha256 = createHash('sha256').update(jcsCanonical).digest('hex');

    return {
      ...decisionRecordWithoutHash,
      portfolio_decision_sha256: portfolioDecisionSha256
    };
  }
}
