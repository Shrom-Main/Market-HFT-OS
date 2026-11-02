/**
 * Gate M7.2 (Decision OD-22 / Charter DEC-022 / Slice 2F):
 * Multi-Candidate Decision Workflow & Constrained Portfolio Paper-Capital Allocation
 *
 * Types for:
 * 1. Multi-candidate side-by-side comparison with strict separation of Gross Spread/Margin
 *    vs. Net Contribution/Contribution Margin, provenance, freshness, and evidence gaps.
 * 2. Deterministic, explainable ranking engine contracts.
 * 3. Constrained portfolio paper-capital allocation with cumulative budget safety,
 *    fencing against double-allocation, and explicit deferral/rejection reasoning.
 */

import type {
  UnderwritingOutcome,
  EconomicEvaluationStatus,
  CandidateUnderwritingDecision,
  OpportunityCandidate
} from './opportunityLifecycleEngine.js';

export type PortfolioAllocationStatus =
  | 'ALLOCATED'
  | 'DEFERRED_BUDGET_EXCEEDED'
  | 'REJECTED_INSUFFICIENT_EVIDENCE'
  | 'REJECTED_UNECONOMIC'
  | 'REJECTED_NOT_AUTHORIZED'
  | 'PENDING_UNDERWRITING';

export interface CandidateComparisonRow {
  readonly candidate_id: string;
  readonly canonical_product_id: string;
  readonly candidate_name: string;
  readonly category: string;
  readonly origin_class: string;
  readonly source_connector_id: string;
  readonly observed_at_utc: string;
  readonly freshness_age_seconds: number;
  readonly evidence_gap_status: 'DATA_COMPLETE' | 'DATA_REQUIRED';
  readonly unresolved_gaps: readonly string[];
  readonly underwriting_outcome: UnderwritingOutcome | 'PENDING';
  readonly evaluation_status: EconomicEvaluationStatus | 'NOT_EVALUATED';

  // Strict separation of financial return concepts
  readonly prevailing_retail_asp_inr: number | null;
  readonly factory_gate_quote_inr: number | null;
  readonly gross_spread_inr: number | null;
  readonly estimated_margin_bps: number | null; // Gross spread margin
  readonly net_unit_contribution_inr: number | null; // ASP minus quote minus variable deductions
  readonly contribution_margin_bps: number | null; // Net contribution margin
  readonly initial_cash_requirement_inr: number | null;
  readonly unit_batch_moq: number | null;

  readonly sufficiency_score_bps: number;
  readonly priority_rank: number;
  readonly ranking_rationale: string;
}

export interface PortfolioAllocationItem {
  readonly rank: number;
  readonly candidate_id: string;
  readonly canonical_product_id: string;
  readonly candidate_name: string;
  readonly outcome: UnderwritingOutcome;
  readonly evaluation_status: EconomicEvaluationStatus;

  // Financial metrics
  readonly prevailing_retail_asp_inr: number | null;
  readonly factory_gate_quote_inr: number | null;
  readonly gross_spread_inr: number | null;
  readonly estimated_margin_bps: number | null;
  readonly net_unit_contribution_inr: number | null;
  readonly contribution_margin_bps: number | null;
  readonly initial_cash_requirement_inr: number;
  readonly unit_batch_moq: number | null;

  // Allocation result
  readonly allocated_capital_inr: number;
  readonly allocation_status: PortfolioAllocationStatus;
  readonly ranking_rationale: string;
  readonly cumulative_allocated_inr: number;
  readonly remaining_budget_after_inr: number;
}

export interface PortfolioDeferredItem {
  readonly candidate_id: string;
  readonly canonical_product_id: string;
  readonly candidate_name: string;
  readonly required_capital_inr: number;
  readonly remaining_budget_inr: number;
  readonly shortfall_inr: number;
  readonly rank: number;
  readonly reason: string;
}

export interface PortfolioRejectedItem {
  readonly candidate_id: string;
  readonly canonical_product_id: string;
  readonly candidate_name: string;
  readonly outcome: UnderwritingOutcome;
  readonly evaluation_status: EconomicEvaluationStatus;
  readonly rank: number;
  readonly reason: string;
}

export interface PortfolioAllocationDeck {
  readonly evaluated_at_utc: string;
  readonly total_configured_budget_inr: number;
  readonly max_single_allocation_inr: number | null;
  readonly total_allocated_capital_inr: number;
  readonly remaining_budget_inr: number;

  // Complete ranked items
  readonly items: readonly PortfolioAllocationItem[];

  // Filtered views
  readonly allocations: readonly PortfolioAllocationItem[];
  readonly deferred_candidates: readonly PortfolioDeferredItem[];
  readonly rejected_candidates: readonly PortfolioRejectedItem[];

  readonly summary: {
    readonly total_candidates_evaluated: number;
    readonly total_allocated_count: number;
    readonly total_deferred_count: number;
    readonly total_rejected_count: number;
    readonly budget_utilization_bps: number;
  };
}

export interface PortfolioEvaluationOptions {
  readonly total_paper_budget_inr: number;
  readonly max_single_allocation_inr?: number | null;
}
