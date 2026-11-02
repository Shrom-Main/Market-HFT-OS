/**
 * Gate M7.2 (Decision OD-22 / Charter DEC-022 / Slice 2F):
 * Portfolio Allocation Engine
 *
 * Implements deterministic multi-candidate ranking, side-by-side comparison matrix generation,
 * and constrained portfolio paper-capital allocation with cumulative budget safety.
 *
 * Invariants Enforced:
 * 1. Strict separation of Gross Spread/Margin vs Net Contribution/Contribution Margin.
 * 2. Candidates with missing costs (UNKNOWN_MISSING) must have null net contribution; never defaulted to 0.
 * 3. Commercial eligibility does NOT imply paper capital authorization.
 * 4. Total allocated paper capital across the portfolio can NEVER exceed configured paper budget.
 * 5. Deterministic, explainable ranking reproducibility across identical inputs.
 * 6. Explicit tracking and reporting of remaining budget and deferral/rejection rationales.
 */

import type {
  OpportunityCandidate,
  CandidateUnderwritingDecision,
  UnderwritingOutcome,
  EconomicEvaluationStatus
} from './opportunityLifecycleEngine.js';
import type {
  CandidateComparisonRow,
  PortfolioAllocationItem,
  PortfolioDeferredItem,
  PortfolioRejectedItem,
  PortfolioAllocationDeck,
  PortfolioEvaluationOptions,
  PortfolioAllocationStatus
} from './portfolioAllocationTypes.js';

/**
 * Builds side-by-side comparison rows for discovered candidates and their underwriting decisions.
 */
export function buildCandidateComparisonRows(
  candidates: readonly OpportunityCandidate[],
  decisions: ReadonlyMap<string, CandidateUnderwritingDecision>
): readonly CandidateComparisonRow[] {
  const now = Date.now();
  const unrankedRows: CandidateComparisonRow[] = candidates.map((cand) => {
    const decision = decisions.get(cand.candidate_id);
    const observedAtUtc = decision?.evidence_summary?.observed_at_utc ??
      cand.current_observation?.observed_at_utc ??
      cand.first_seen_utc;
    const observedMs = new Date(observedAtUtc).getTime();
    const freshnessAgeSeconds = Number.isFinite(observedMs)
      ? Math.max(0, Math.floor((now - observedMs) / 1000))
      : 0;

    if (decision) {
      const isSufficient = decision.evidence_summary.is_sufficient_for_underwriting;
      const missingInputs = decision.unit_economics.missing_cost_inputs ?? [];
      const unresolvedGaps = missingInputs.length > 0
        ? missingInputs
        : (decision.evidence_summary.missing_critical_fields ?? []);

      return {
        candidate_id: cand.candidate_id,
        canonical_product_id: cand.canonical_product_id,
        candidate_name: cand.candidate_name,
        category: cand.category ?? 'COMMERCIAL_HARDWARE',
        origin_class: decision.evidence_summary.origin_class ?? cand.current_observation?.origin_class ?? 'RECORDED_GOLDEN_FIXTURE',
        source_connector_id: decision.evidence_summary.source_connector_id ?? cand.current_observation?.source_connector_id ?? 'unknown',
        observed_at_utc: observedAtUtc,
        freshness_age_seconds: freshnessAgeSeconds,
        evidence_gap_status: isSufficient && unresolvedGaps.length === 0 ? 'DATA_COMPLETE' : 'DATA_REQUIRED',
        unresolved_gaps: unresolvedGaps,
        underwriting_outcome: decision.outcome,
        evaluation_status: decision.evaluation_status,

        // Financials from decision
        prevailing_retail_asp_inr: decision.unit_economics.prevailing_retail_asp_inr,
        factory_gate_quote_inr: decision.unit_economics.factory_gate_quote_inr,
        gross_spread_inr: decision.unit_economics.gross_spread_inr,
        estimated_margin_bps: decision.unit_economics.estimated_margin_bps,
        net_unit_contribution_inr: decision.unit_economics.net_contribution_inr,
        contribution_margin_bps: decision.unit_economics.contribution_margin_bps,
        initial_cash_requirement_inr: decision.unit_economics.initial_cash_requirement_inr,
        unit_batch_moq: decision.unit_economics.unit_batch_moq,

        sufficiency_score_bps: decision.evidence_summary.sufficiency_score_bps,
        priority_rank: 0,
        ranking_rationale: ''
      };
    }

    // Candidate screened but not yet underwritten
    const obs = cand.current_observation;
    const asp = obs?.prevailing_retail_asp_inr ?? null;
    const quote = obs?.factory_gate_quote_inr ?? null;
    const grossSpread = asp !== null && quote !== null ? Math.round((asp - quote) * 100) / 100 : null;
    const grossMarginBps = grossSpread !== null && asp !== null && asp > 0
      ? Math.round((grossSpread / asp) * 10000)
      : null;

    return {
      candidate_id: cand.candidate_id,
      canonical_product_id: cand.canonical_product_id,
      candidate_name: cand.candidate_name,
      category: cand.category ?? 'COMMERCIAL_HARDWARE',
      origin_class: obs?.origin_class ?? 'RECORDED_GOLDEN_FIXTURE',
      source_connector_id: obs?.source_connector_id ?? 'unknown',
      observed_at_utc: observedAtUtc,
      freshness_age_seconds: freshnessAgeSeconds,
      evidence_gap_status: cand.evidence_sufficiency?.is_sufficient_for_underwriting ? 'DATA_COMPLETE' : 'DATA_REQUIRED',
      unresolved_gaps: cand.evidence_sufficiency?.missing_critical_fields ?? [],
      underwriting_outcome: 'PENDING',
      evaluation_status: 'NOT_EVALUATED',

      prevailing_retail_asp_inr: asp,
      factory_gate_quote_inr: quote,
      gross_spread_inr: grossSpread,
      estimated_margin_bps: grossMarginBps,
      net_unit_contribution_inr: null, // Strictly null before underwriting
      contribution_margin_bps: null, // Strictly null before underwriting
      initial_cash_requirement_inr: null,
      unit_batch_moq: obs?.unit_batch_moq ?? null,

      sufficiency_score_bps: cand.evidence_sufficiency?.sufficiency_score_bps ?? 0,
      priority_rank: 0,
      ranking_rationale: ''
    };
  });

  // Sort deterministically
  unrankedRows.sort((a, b) => compareCandidatesForRanking(a, b));

  // Assign ranks and rationales
  return unrankedRows.map((row, idx) => {
    const rank = idx + 1;
    const rationale = buildRankingRationale(rank, row);
    return {
      ...row,
      priority_rank: rank,
      ranking_rationale: rationale
    };
  });
}

/**
 * Deterministic candidate comparison comparator.
 * Enforces tier ordering, financial superiority, capital efficiency, and lexicographical stability.
 */
function compareCandidatesForRanking(a: CandidateComparisonRow, b: CandidateComparisonRow): number {
  const tierA = getOutcomeTier(a.underwriting_outcome);
  const tierB = getOutcomeTier(b.underwriting_outcome);
  if (tierA !== tierB) {
    return tierA - tierB;
  }

  // Tier 1: Both ELIGIBLE
  if (tierA === 1) {
    // Primary: contribution_margin_bps DESC
    const marginA = a.contribution_margin_bps ?? -Infinity;
    const marginB = b.contribution_margin_bps ?? -Infinity;
    if (marginA !== marginB) {
      return marginB - marginA;
    }

    // Tie-breaker 1: initial_cash_requirement_inr ASC (capital efficiency)
    const cashA = a.initial_cash_requirement_inr ?? Infinity;
    const cashB = b.initial_cash_requirement_inr ?? Infinity;
    if (cashA !== cashB) {
      return cashA - cashB;
    }

    // Tie-breaker 2: sufficiency_score_bps DESC
    if (a.sufficiency_score_bps !== b.sufficiency_score_bps) {
      return b.sufficiency_score_bps - a.sufficiency_score_bps;
    }

    // Tie-breaker 3: candidate_id ASC
    return a.candidate_id.localeCompare(b.candidate_id);
  }

  // Tier 2 or 3 (INSUFFICIENT_EVIDENCE, INELIGIBLE, PENDING)
  // Compare estimated_margin_bps DESC
  const estMarginA = a.estimated_margin_bps ?? -Infinity;
  const estMarginB = b.estimated_margin_bps ?? -Infinity;
  if (estMarginA !== estMarginB) {
    return estMarginB - estMarginA;
  }

  // Tie-breaker: sufficiency_score_bps DESC
  if (a.sufficiency_score_bps !== b.sufficiency_score_bps) {
    return b.sufficiency_score_bps - a.sufficiency_score_bps;
  }

  // Lexicographical stability
  return a.candidate_id.localeCompare(b.candidate_id);
}

function getOutcomeTier(outcome: UnderwritingOutcome | 'PENDING'): number {
  switch (outcome) {
    case 'ELIGIBLE':
      return 1;
    case 'INSUFFICIENT_EVIDENCE':
      return 2;
    case 'INELIGIBLE':
      return 3;
    case 'PENDING':
    default:
      return 4;
  }
}

function buildRankingRationale(rank: number, row: CandidateComparisonRow): string {
  if (row.underwriting_outcome === 'ELIGIBLE') {
    const marginPct = ((row.contribution_margin_bps ?? 0) / 100).toFixed(2);
    const netContrib = (row.net_unit_contribution_inr ?? 0).toFixed(2);
    const cashReq = (row.initial_cash_requirement_inr ?? 0).toFixed(2);
    return `Rank ${rank} [ELIGIBLE]: Contribution margin ${marginPct}% (${row.contribution_margin_bps} bps), net unit contribution ₹${netContrib} on ₹${(row.prevailing_retail_asp_inr ?? 0).toFixed(2)} ASP, initial cash req ₹${cashReq}, evidence sufficiency ${row.sufficiency_score_bps} bps.`;
  }

  if (row.underwriting_outcome === 'INSUFFICIENT_EVIDENCE') {
    const gaps = row.unresolved_gaps.length > 0 ? row.unresolved_gaps.join(', ') : 'MISSING_DATA';
    return `Rank ${rank} [INSUFFICIENT_EVIDENCE]: Underwriting blocked by unresolved evidence/cost gaps: [${gaps}]. Net contribution unknown. Paper capital allocation prohibited.`;
  }

  if (row.underwriting_outcome === 'INELIGIBLE') {
    return `Rank ${rank} [INELIGIBLE]: Commercial underwriting rejected (${row.evaluation_status}). Non-viable unit economics or policy violation.`;
  }

  return `Rank ${rank} [PENDING]: Screened observation pending deterministic underwriting.`;
}

/**
 * Evaluates a configured paper budget against all underwritten candidates.
 * Enforces cumulative budget limits, prevents double allocation, and reports explicit reasons.
 */
export function evaluatePortfolioAllocationDeck(
  decisions: readonly CandidateUnderwritingDecision[],
  options: PortfolioEvaluationOptions
): PortfolioAllocationDeck {
  const evaluatedAtUtc = new Date().toISOString();
  const totalBudget = Math.max(0, options.total_paper_budget_inr);
  const maxSingle = options.max_single_allocation_inr != null && options.max_single_allocation_inr > 0
    ? options.max_single_allocation_inr
    : null;

  // Stable sort of underwriting decisions
  const sortedDecisions = [...decisions].sort((a, b) => {
    const tierA = getOutcomeTier(a.outcome);
    const tierB = getOutcomeTier(b.outcome);
    if (tierA !== tierB) {
      return tierA - tierB;
    }

    if (tierA === 1) {
      // Primary: contribution_margin_bps DESC
      const marginA = a.unit_economics.contribution_margin_bps ?? -Infinity;
      const marginB = b.unit_economics.contribution_margin_bps ?? -Infinity;
      if (marginA !== marginB) {
        return marginB - marginA;
      }

      // Tie-breaker 1: initial_cash_requirement_inr ASC
      const cashA = a.unit_economics.initial_cash_requirement_inr ?? Infinity;
      const cashB = b.unit_economics.initial_cash_requirement_inr ?? Infinity;
      if (cashA !== cashB) {
        return cashA - cashB;
      }

      // Tie-breaker 2: sufficiency_score_bps DESC
      if (a.evidence_summary.sufficiency_score_bps !== b.evidence_summary.sufficiency_score_bps) {
        return b.evidence_summary.sufficiency_score_bps - a.evidence_summary.sufficiency_score_bps;
      }

      return a.candidate_id.localeCompare(b.candidate_id);
    }

    const estMarginA = a.unit_economics.estimated_margin_bps ?? -Infinity;
    const estMarginB = b.unit_economics.estimated_margin_bps ?? -Infinity;
    if (estMarginA !== estMarginB) {
      return estMarginB - estMarginA;
    }

    return a.candidate_id.localeCompare(b.candidate_id);
  });

  let remainingBudget = totalBudget;
  let cumulativeAllocated = 0;

  const items: PortfolioAllocationItem[] = [];
  const allocations: PortfolioAllocationItem[] = [];
  const deferred: PortfolioDeferredItem[] = [];
  const rejected: PortfolioRejectedItem[] = [];

  for (let idx = 0; idx < sortedDecisions.length; idx++) {
    const dec = sortedDecisions[idx];
    const rank = idx + 1;
    const u = dec.unit_economics;
    const requiredCash = u.initial_cash_requirement_inr ?? 0;

    // Gate 1: Check outcome eligibility
    if (dec.outcome === 'INSUFFICIENT_EVIDENCE') {
      const missingInputs = u.missing_cost_inputs ?? [];
      const reason = `Rank ${rank} [INSUFFICIENT_EVIDENCE]: Rejected from paper allocation: Insufficient evidence (missing cost inputs: [${missingInputs.join(', ')}]). Sufficiency score ${dec.evidence_summary.sufficiency_score_bps} bps.`;
      const item: PortfolioAllocationItem = {
        rank,
        candidate_id: dec.candidate_id,
        canonical_product_id: dec.canonical_product_id,
        candidate_name: dec.candidate_name,
        outcome: dec.outcome,
        evaluation_status: dec.evaluation_status,
        prevailing_retail_asp_inr: u.prevailing_retail_asp_inr,
        factory_gate_quote_inr: u.factory_gate_quote_inr,
        gross_spread_inr: u.gross_spread_inr,
        estimated_margin_bps: u.estimated_margin_bps,
        net_unit_contribution_inr: u.net_contribution_inr,
        contribution_margin_bps: u.contribution_margin_bps,
        initial_cash_requirement_inr: requiredCash,
        unit_batch_moq: u.unit_batch_moq,
        allocated_capital_inr: 0,
        allocation_status: 'REJECTED_INSUFFICIENT_EVIDENCE',
        ranking_rationale: reason,
        cumulative_allocated_inr: cumulativeAllocated,
        remaining_budget_after_inr: remainingBudget
      };
      items.push(item);
      rejected.push({
        candidate_id: dec.candidate_id,
        canonical_product_id: dec.canonical_product_id,
        candidate_name: dec.candidate_name,
        outcome: dec.outcome,
        evaluation_status: dec.evaluation_status,
        rank,
        reason
      });
      continue;
    }

    if (dec.outcome === 'INELIGIBLE' || dec.evaluation_status !== 'EVALUATED_VIABLE' || (u.net_contribution_inr ?? 0) <= 0) {
      const reason = `Rank ${rank} [INELIGIBLE]: Rejected from paper allocation: Uneconomic or policy non-compliant (${dec.evaluation_status}). Net contribution non-positive.`;
      const item: PortfolioAllocationItem = {
        rank,
        candidate_id: dec.candidate_id,
        canonical_product_id: dec.canonical_product_id,
        candidate_name: dec.candidate_name,
        outcome: dec.outcome,
        evaluation_status: dec.evaluation_status,
        prevailing_retail_asp_inr: u.prevailing_retail_asp_inr,
        factory_gate_quote_inr: u.factory_gate_quote_inr,
        gross_spread_inr: u.gross_spread_inr,
        estimated_margin_bps: u.estimated_margin_bps,
        net_unit_contribution_inr: u.net_contribution_inr,
        contribution_margin_bps: u.contribution_margin_bps,
        initial_cash_requirement_inr: requiredCash,
        unit_batch_moq: u.unit_batch_moq,
        allocated_capital_inr: 0,
        allocation_status: 'REJECTED_UNECONOMIC',
        ranking_rationale: reason,
        cumulative_allocated_inr: cumulativeAllocated,
        remaining_budget_after_inr: remainingBudget
      };
      items.push(item);
      rejected.push({
        candidate_id: dec.candidate_id,
        canonical_product_id: dec.canonical_product_id,
        candidate_name: dec.candidate_name,
        outcome: dec.outcome,
        evaluation_status: dec.evaluation_status,
        rank,
        reason
      });
      continue;
    }

    // Gate 2: Eligible candidate - check portfolio budget constraints
    // Check max single allocation cap
    if (maxSingle !== null && requiredCash > maxSingle) {
      const shortfall = Math.round((requiredCash - maxSingle) * 100) / 100;
      const reason = `Rank ${rank} [DEFERRED_BUDGET_EXCEEDED]: Required capital ₹${requiredCash.toFixed(2)} exceeds maximum single allocation limit of ₹${maxSingle.toFixed(2)} by ₹${shortfall.toFixed(2)}. Allocation deferred.`;
      const item: PortfolioAllocationItem = {
        rank,
        candidate_id: dec.candidate_id,
        canonical_product_id: dec.canonical_product_id,
        candidate_name: dec.candidate_name,
        outcome: dec.outcome,
        evaluation_status: dec.evaluation_status,
        prevailing_retail_asp_inr: u.prevailing_retail_asp_inr,
        factory_gate_quote_inr: u.factory_gate_quote_inr,
        gross_spread_inr: u.gross_spread_inr,
        estimated_margin_bps: u.estimated_margin_bps,
        net_unit_contribution_inr: u.net_contribution_inr,
        contribution_margin_bps: u.contribution_margin_bps,
        initial_cash_requirement_inr: requiredCash,
        unit_batch_moq: u.unit_batch_moq,
        allocated_capital_inr: 0,
        allocation_status: 'DEFERRED_BUDGET_EXCEEDED',
        ranking_rationale: reason,
        cumulative_allocated_inr: cumulativeAllocated,
        remaining_budget_after_inr: remainingBudget
      };
      items.push(item);
      deferred.push({
        candidate_id: dec.candidate_id,
        canonical_product_id: dec.canonical_product_id,
        candidate_name: dec.candidate_name,
        required_capital_inr: requiredCash,
        remaining_budget_inr: remainingBudget,
        shortfall_inr: shortfall,
        rank,
        reason
      });
      continue;
    }

    // Check remaining portfolio budget
    if (requiredCash <= remainingBudget) {
      // Allocate safely
      const allocatedAmt = requiredCash;
      cumulativeAllocated = Math.round((cumulativeAllocated + allocatedAmt) * 100) / 100;
      remainingBudget = Math.round((remainingBudget - allocatedAmt) * 100) / 100;

      const marginPct = ((u.contribution_margin_bps ?? 0) / 100).toFixed(2);
      const rationale = `Rank ${rank} [ALLOCATED]: Net contribution margin ${marginPct}% (${u.contribution_margin_bps} bps), initial outlay ₹${allocatedAmt.toFixed(2)}. Remaining budget: ₹${remainingBudget.toFixed(2)}.`;

      const item: PortfolioAllocationItem = {
        rank,
        candidate_id: dec.candidate_id,
        canonical_product_id: dec.canonical_product_id,
        candidate_name: dec.candidate_name,
        outcome: dec.outcome,
        evaluation_status: dec.evaluation_status,
        prevailing_retail_asp_inr: u.prevailing_retail_asp_inr,
        factory_gate_quote_inr: u.factory_gate_quote_inr,
        gross_spread_inr: u.gross_spread_inr,
        estimated_margin_bps: u.estimated_margin_bps,
        net_unit_contribution_inr: u.net_contribution_inr,
        contribution_margin_bps: u.contribution_margin_bps,
        initial_cash_requirement_inr: requiredCash,
        unit_batch_moq: u.unit_batch_moq,
        allocated_capital_inr: allocatedAmt,
        allocation_status: 'ALLOCATED',
        ranking_rationale: rationale,
        cumulative_allocated_inr: cumulativeAllocated,
        remaining_budget_after_inr: remainingBudget
      };
      items.push(item);
      allocations.push(item);
    } else {
      // Exceeds remaining budget -> defer
      const shortfall = Math.round((requiredCash - remainingBudget) * 100) / 100;
      const reason = `Rank ${rank} [DEFERRED_BUDGET_EXCEEDED]: Required capital ₹${requiredCash.toFixed(2)} exceeds remaining portfolio paper budget ₹${remainingBudget.toFixed(2)} by ₹${shortfall.toFixed(2)}. Allocation deferred.`;

      const item: PortfolioAllocationItem = {
        rank,
        candidate_id: dec.candidate_id,
        canonical_product_id: dec.canonical_product_id,
        candidate_name: dec.candidate_name,
        outcome: dec.outcome,
        evaluation_status: dec.evaluation_status,
        prevailing_retail_asp_inr: u.prevailing_retail_asp_inr,
        factory_gate_quote_inr: u.factory_gate_quote_inr,
        gross_spread_inr: u.gross_spread_inr,
        estimated_margin_bps: u.estimated_margin_bps,
        net_unit_contribution_inr: u.net_contribution_inr,
        contribution_margin_bps: u.contribution_margin_bps,
        initial_cash_requirement_inr: requiredCash,
        unit_batch_moq: u.unit_batch_moq,
        allocated_capital_inr: 0,
        allocation_status: 'DEFERRED_BUDGET_EXCEEDED',
        ranking_rationale: reason,
        cumulative_allocated_inr: cumulativeAllocated,
        remaining_budget_after_inr: remainingBudget
      };
      items.push(item);
      deferred.push({
        candidate_id: dec.candidate_id,
        canonical_product_id: dec.canonical_product_id,
        candidate_name: dec.candidate_name,
        required_capital_inr: requiredCash,
        remaining_budget_inr: remainingBudget,
        shortfall_inr: shortfall,
        rank,
        reason
      });
    }
  }

  // Final invariant check: cumulativeAllocated <= totalBudget
  if (cumulativeAllocated > totalBudget) {
    throw new Error(
      `FATAL INVARIANT VIOLATION: Cumulative allocated paper capital (₹${cumulativeAllocated}) exceeds total configured budget (₹${totalBudget})!`
    );
  }

  const budgetUtilBps = totalBudget > 0
    ? Math.round((cumulativeAllocated / totalBudget) * 10000)
    : 0;

  return {
    evaluated_at_utc: evaluatedAtUtc,
    total_configured_budget_inr: totalBudget,
    max_single_allocation_inr: maxSingle,
    total_allocated_capital_inr: cumulativeAllocated,
    remaining_budget_inr: remainingBudget,
    items,
    allocations,
    deferred_candidates: deferred,
    rejected_candidates: rejected,
    summary: {
      total_candidates_evaluated: sortedDecisions.length,
      total_allocated_count: allocations.length,
      total_deferred_count: deferred.length,
      total_rejected_count: rejected.length,
      budget_utilization_bps: budgetUtilBps
    }
  };
}
