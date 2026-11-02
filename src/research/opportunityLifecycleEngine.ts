/**
 * POC-001: Opportunity Domain & Lifecycle State Machine
 * Gate Slice 1 / Master Implementation Framework
 *
 * Implements:
 * 1. STABLE IDENTITY: candidate_id = "OPP-" + sha256(strategy_id + ":" + canonical_product_id).slice(0, 16).
 *    Independent of mutable commercial observations (prices, quotes, inventory).
 * 2. FOUR ORTHOGONAL DIMENSIONS:
 *    - Lifecycle State: NEW | INVESTIGATE | UNDER_REVIEW | VERIFIED | PAPER_ELIGIBLE | DEFERRED | REJECTED
 *    - Observation Signals: INITIAL_OBSERVATION | PRICE_CHANGED | GRIEVANCE_SURFACED | SUPPLIER_QUOTE_UPDATED | EVIDENCE_CONFLICT_DETECTED | EVIDENCE_STALE | SPEC_MODIFIED | UNCHANGED
 *    - Investigation Status: UNSCHEDULED | PENDING | IN_PROGRESS | COMPLETED | FAILED | AWAITING_HUMAN_REVIEW
 *    - Evidence Sufficiency: Evaluates explicit field presence without guessing or synthetic averaging.
 * 3. HASH-CHAINED AUDIT TRAIL: Merkle-chained CandidateLifecycleEvent records with previous_event_hash and RFC 8785 JCS digests.
 * 4. FAIL-CLOSED PAPER COMMIT GATE: Only VERIFIED candidates with full evidence sufficiency can be authorized for paper simulation.
 * 5. POSTGRESQL 16.8 PERSISTENCE: market_opportunity_candidates & market_candidate_lifecycle_events with zero-loss in-memory fallback.
 */

import type { Pool } from 'pg';
import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { OpportunityCategory, inferCategoryFromEntityId } from '../canonical/opportunityCategory.js';

// ============================================================================
// 1. DATA CONTRACTS & TYPES
// ============================================================================

export type OpportunityLifecycleState =
  | 'NEW'
  | 'INVESTIGATE'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'PAPER_ELIGIBLE'
  | 'DEFERRED'
  | 'REJECTED';

export type ObservationChangeSignal =
  | 'INITIAL_OBSERVATION'
  | 'NEW_CANDIDATE'
  | 'PRICE_CHANGED'
  | 'GRIEVANCE_SURFACED'
  | 'SUPPLIER_QUOTE_UPDATED'
  | 'EVIDENCE_CONFLICT_DETECTED'
  | 'EVIDENCE_STALE'
  | 'SPEC_MODIFIED'
  | 'UNCHANGED';

export type InvestigationStatus =
  | 'UNSCHEDULED'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'AWAITING_HUMAN_REVIEW';

export type LifecycleTrigger =
  | 'OBSERVATION_INGESTED'
  | 'INVESTIGATION_DISPATCHED'
  | 'INVESTIGATION_RESOLVED'
  | 'OPERATOR_DECISION'
  | 'SUFFICIENCY_EVALUATED'
  | 'EVALUATION_FAILED'
  | 'SOURCE_FAULT_DETECTED';

export interface EvidenceSufficiencyProfile {
  readonly is_sufficient_for_underwriting: boolean;
  readonly sufficiency_score_bps: number; // 0 to 10,000 (0.00% to 100.00%)
  readonly has_upstream_quote: boolean;
  readonly has_prevailing_asp: boolean;
  readonly has_verbatim_reviews: boolean;
  readonly has_logistics_route: boolean;
  readonly has_regulatory_clearance: boolean;
  readonly missing_critical_fields: readonly string[];
  readonly uncorroborated_fields: readonly string[];
  readonly last_evaluated_at_utc: string;
}

export interface CommercialAttractivenessEstimate {
  readonly estimated_gross_spread_inr: number | null;
  readonly estimated_gross_margin_bps: number | null;
  readonly attractiveness_rating: 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW' | 'NEGATIVE' | 'UNKNOWN';
  readonly heuristic_rationale: string;
  readonly calculation_epistemic_class: 'ESTIMATED_PROXY' | 'UNATTESTED_INTAKE';
}

export type EconomicEvaluationStatus =
  | 'EVALUATED_VIABLE'
  | 'EVALUATED_UNATTRACTIVE'
  | 'UNEVALUABLE_INPUTS_MISSING'
  | 'UNEVALUABLE_UNCLASSIFIED';

export const POLICY_MIN_MARGIN_BPS = 1000; // 10.00% gross margin threshold for paper commitment

export interface EconomicEligibilityProfile {
  readonly is_economically_eligible: boolean;
  readonly evaluation_status: EconomicEvaluationStatus;
  readonly missing_economic_inputs: readonly string[];
  readonly economic_model_applied: string;
  readonly policy_min_margin_bps: number;
  readonly estimated_margin_bps: number | null;
  readonly policy_evaluation_notes: string;
  readonly last_evaluated_at_utc: string;
}

export interface CandidateObservationSnapshot {
  readonly observation_id: string;
  readonly source_connector_id: string;
  readonly origin_class?: string;
  readonly observed_at_utc: string;
  readonly prevailing_retail_asp_inr: number | null;
  readonly factory_gate_quote_inr: number | null;
  readonly unit_batch_moq: number | null;
  readonly observed_seller_count: number | null;
  readonly review_sentiment_summary: string | null;
  readonly raw_payload_snippet?: string;
  readonly payload_sha256: string;
  readonly applicable_cost_categories?: readonly ApplicableCostCategory[];
  readonly cost_category_exclusions?: readonly CostCategoryExclusion[];
  readonly inbound_freight_inr?: number | null;
  readonly packaging_kitting_inr?: number | null;
  readonly platform_fee_inr?: number | null;
  readonly fulfillment_fee_inr?: number | null;
  readonly statutory_tax_inr?: number | null;
  readonly return_defect_drag_inr?: number | null;
  readonly lead_time_days?: number | null;
  readonly payment_terms_days?: number | null;
  readonly warehouse_dwell_days?: number | null;
  readonly settlement_delay_days?: number | null;
}

export type ApplicableCostCategory =
  | 'SUPPLIER_PURCHASE'
  | 'INBOUND_FREIGHT'
  | 'PACKAGING_KITTING'
  | 'MARKETPLACE_FEES'
  | 'STATUTORY_TAX'
  | 'RETURN_DEFECT_DRAG';

export interface CostCategoryExclusion {
  readonly category: ApplicableCostCategory;
  readonly exclusion_basis: string;
}

export type CostCategoryTreatment =
  | 'KNOWN_VALUE'
  | 'KNOWN_ZERO'
  | 'EXPLICITLY_NOT_APPLICABLE'
  | 'UNKNOWN_MISSING';

export interface CostCategoryAssessment {
  readonly category: ApplicableCostCategory;
  readonly treatment: CostCategoryTreatment;
  readonly amount_inr: number | null;
  readonly exclusion_basis: string | null;
}

export type CapitalAllocationDecision =
  | 'ALLOCATE_CAPITAL'
  | 'DO_NOT_ALLOCATE_CAPITAL'
  | 'NOT_AUTHORIZED_BUDGET_UNCONFIGURED'
  | 'NOT_AUTHORIZED_BUDGET_EXCEEDED'
  | 'REJECTED_UNECONOMIC';

export interface PaperCapitalBudgetConfig {
  readonly available_paper_capital_inr: number;
  readonly max_single_allocation_inr?: number;
}

export type CandidateOriginClass =
  | 'RECORDED_GOLDEN_FIXTURE'
  | 'LIVE_VERIFIED_CAPTURE'
  | 'UNATTESTED_USER_INTAKE'
  | 'SYNTHETIC_SCENARIO'
  | 'ESTIMATED_PROXY'
  | 'OPERATOR_SIMULATION_ASSUMPTION';

export type UnderwritingOutcome =
  | 'ELIGIBLE'
  | 'INELIGIBLE'
  | 'INSUFFICIENT_EVIDENCE';

export interface CandidateUnderwritingDecision {
  readonly decision_id: string;
  readonly candidate_id: string;
  readonly canonical_product_id: string;
  readonly candidate_name: string;
  readonly category: string;
  readonly outcome: UnderwritingOutcome;
  readonly lifecycle_state: OpportunityLifecycleState;
  readonly evaluation_status: EconomicEvaluationStatus;
  readonly unit_economics: {
    readonly prevailing_retail_asp_inr: number | null;
    readonly factory_gate_quote_inr: number | null;
    readonly gross_spread_inr: number | null;
    readonly estimated_margin_bps: number | null;
    readonly policy_min_margin_bps: number;
    readonly calculation_method: string;
    readonly net_contribution_inr: number | null;
    readonly contribution_margin_bps: number | null;
    readonly contribution_margin_denominator: 'RETAIL_SELLING_PRICE' | 'LANDED_COST';
    readonly initial_cash_requirement_inr: number | null;
    readonly working_capital_exposure_inr: number | null;
    readonly cash_conversion_cycle_days: number | null;
    readonly annualized_return_on_working_capital_bps?: number | null;
    readonly annualized_rowc_interpretation?: string;
    readonly annualized_rowc_caveat?: string;
    readonly unit_batch_moq: number | null;
    readonly purchase_quantity: number | null;
    readonly applicable_cost_categories: readonly ApplicableCostCategory[];
    readonly cost_category_assessments?: readonly CostCategoryAssessment[];
    readonly cost_breakdown: {
      readonly supplier_purchase_cost_inr: number | null;
      readonly inbound_freight_inr: number | null;
      readonly packaging_kitting_inr: number | null;
      readonly marketplace_fees_inr: number | null;
      readonly statutory_tax_inr: number | null;
      readonly return_defect_drag_inr: number | null;
      readonly non_supplier_variable_costs_inr: number | null;
      readonly total_variable_deductions_inr: number | null;
      readonly cost_exclusions: readonly CostCategoryExclusion[];
      readonly cost_assessments: readonly CostCategoryAssessment[];
    };
    readonly missing_cost_inputs: readonly string[];
  };
  readonly evidence_summary: {
    readonly is_sufficient_for_underwriting: boolean;
    readonly sufficiency_score_bps: number;
    readonly missing_critical_fields: readonly string[];
    readonly uncorroborated_fields: readonly string[];
    readonly source_connector_id: string;
    readonly origin_class: string;
    readonly evidence_posture?: 'LIVE_VERIFIED_EMPIRICAL' | 'RECORDED_FIXTURE_BASELINE' | 'SYNTHETIC_SCENARIO' | 'UNATTESTED_INTAKE';
    readonly is_live_market_verified: boolean;
    readonly observed_at_utc: string;
  };
  readonly capital_allocation?: {
    readonly initial_cash_requirement_inr: number | null;
    readonly working_capital_exposure_inr: number | null;
    readonly unit_batch_moq: number | null;
    readonly recommended_batch_quantity: number | null;
    readonly cash_conversion_cycle_days: number | null;
    readonly annualized_rowc_bps: number | null;
    readonly annualized_rowc_extrapolation_bps: number | null;
    readonly annualized_rowc_interpretation: string;
    readonly annualized_rowc_caveat?: string;
    readonly break_even_price_inr: number | null;
    readonly capital_allocation_decision: CapitalAllocationDecision;
    readonly budget_allocation_notes?: string;
  };
  readonly evidence_confidence?: {
    readonly evidence_posture?: 'LIVE_VERIFIED_EMPIRICAL' | 'RECORDED_FIXTURE_BASELINE' | 'SYNTHETIC_SCENARIO' | 'UNATTESTED_INTAKE';
    readonly evidence_quality_rating: 'LIVE_VERIFIED_EMPIRICAL' | 'LIVE_EMPIRICAL_CORROBORATED' | 'RECORDED_REFERENCE_FIXTURE' | 'PARTIALLY_CORROBORATED' | 'SYNTHETIC_SCENARIO' | 'UNATTESTED_HOLD';
    readonly primary_origin_class: string;
    readonly source_connector_id: string;
    readonly observed_at_utc: string;
    readonly is_live_market_verified: boolean;
    readonly has_logistics_route: boolean;
    readonly has_regulatory_clearance: boolean;
  };
  readonly binding_constraints: readonly string[];
  readonly failed_checks: readonly string[];
  readonly explanation: string;
  readonly required_action_to_reconsider: string | null;
  readonly evaluated_at_utc: string;
  readonly jcs_sha256: string;
}

export interface OpportunityCandidate {
  readonly candidate_id: string; // Stable: OPP-<sha256(strategy_id + ":" + canonical_product_id).slice(0, 16)>
  readonly strategy_id: string;
  readonly canonical_product_id: string;
  readonly candidate_name: string;
  readonly category?: OpportunityCategory;
  readonly lifecycle_state: OpportunityLifecycleState;
  readonly active_signals: readonly ObservationChangeSignal[];
  readonly investigation_status: InvestigationStatus;
  readonly evidence_sufficiency: EvidenceSufficiencyProfile;
  readonly commercial_attractiveness: CommercialAttractivenessEstimate;
  readonly economic_eligibility: EconomicEligibilityProfile;
  readonly current_observation: CandidateObservationSnapshot;
  readonly observation_history_count: number;
  readonly latest_transition_reason: string;
  readonly first_seen_utc: string;
  readonly last_seen_utc: string;
  readonly updated_at_utc: string;
  readonly jcs_sha256: string;
}

export interface CandidateLifecycleEvent {
  readonly event_id: string;
  readonly candidate_id: string;
  readonly previous_state: OpportunityLifecycleState;
  readonly next_state: OpportunityLifecycleState;
  readonly signal: ObservationChangeSignal;
  readonly trigger: LifecycleTrigger;
  readonly operator_id?: string;
  readonly transition_reason: string;
  readonly previous_event_hash: string;
  readonly event_hash: string;
  readonly timestamp_utc: string;
}

export interface IngestObservationInput {
  readonly strategy_id: string;
  readonly canonical_product_id: string;
  readonly candidate_name: string;
  readonly category?: OpportunityCategory;
  readonly source_connector_id: string;
  readonly prevailing_retail_asp_inr?: number | null;
  readonly factory_gate_quote_inr?: number | null;
  readonly unit_batch_moq?: number | null;
  readonly observed_seller_count?: number | null;
  readonly review_sentiment_summary?: string | null;
  readonly raw_payload?: string | null;
  readonly has_logistics_route?: boolean;
  readonly has_regulatory_clearance?: boolean;
  readonly observed_at_utc?: string;
  readonly signal_override?: ObservationChangeSignal;
  readonly origin_class?: string;
  readonly applicable_cost_categories?: readonly ApplicableCostCategory[];
  readonly cost_category_exclusions?: readonly CostCategoryExclusion[];
  readonly inbound_freight_inr?: number | null;
  readonly packaging_kitting_inr?: number | null;
  readonly platform_fee_inr?: number | null;
  readonly fulfillment_fee_inr?: number | null;
  readonly statutory_tax_inr?: number | null;
  readonly return_defect_drag_inr?: number | null;
  readonly lead_time_days?: number | null;
  readonly payment_terms_days?: number | null;
  readonly warehouse_dwell_days?: number | null;
  readonly settlement_delay_days?: number | null;
}

export interface CandidateFilter {
  readonly strategy_id?: string;
  readonly category?: OpportunityCategory;
  readonly lifecycle_state?: OpportunityLifecycleState;
  readonly investigation_status?: InvestigationStatus;
  readonly min_attractiveness_rating?: 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW';
  readonly is_sufficient_for_underwriting?: boolean;
}

// ============================================================================
// 2. STATE MACHINE TRANSITION GRAPH (Fail-Closed)
// ============================================================================

const PERMITTED_TRANSITIONS: Readonly<Record<OpportunityLifecycleState, readonly OpportunityLifecycleState[]>> = {
  NEW: ['INVESTIGATE', 'DEFERRED', 'REJECTED'],
  INVESTIGATE: ['UNDER_REVIEW', 'DEFERRED', 'REJECTED'],
  UNDER_REVIEW: ['VERIFIED', 'INVESTIGATE', 'DEFERRED', 'REJECTED'],
  VERIFIED: ['PAPER_ELIGIBLE', 'UNDER_REVIEW', 'DEFERRED', 'REJECTED'],
  PAPER_ELIGIBLE: ['VERIFIED', 'DEFERRED'],
  DEFERRED: ['INVESTIGATE', 'REJECTED'],
  REJECTED: ['INVESTIGATE'] // Requires explicit override rationale >= 15 chars
};

// ============================================================================
// 3. OPPORTUNITY LIFECYCLE ENGINE
// ============================================================================

export interface OpportunityLifecycleEngineOptions {
  readonly pgPool?: Pool;
  readonly requirePaperBudget?: boolean;
  readonly defaultPaperBudgetConfig?: PaperCapitalBudgetConfig;
}

export class OpportunityLifecycleEngine {
  private pgPool?: Pool;
  private isInitialized = false;
  private readonly requirePaperBudget: boolean;
  private readonly defaultPaperBudgetConfig?: PaperCapitalBudgetConfig;

  // In-memory fallback stores
  private readonly inMemoryCandidates = new Map<string, OpportunityCandidate>();
  private readonly inMemoryEvents = new Map<string, CandidateLifecycleEvent[]>();

  constructor(options?: OpportunityLifecycleEngineOptions) {
    this.pgPool = options?.pgPool;
    this.requirePaperBudget = options?.requirePaperBudget ?? false;
    this.defaultPaperBudgetConfig = options?.defaultPaperBudgetConfig;
  }

  public setPgPool(pool: Pool): void {
    this.pgPool = pool;
    this.isInitialized = false;
  }

  /**
   * Initializes PostgreSQL schema idempotently and hydrates existing candidates.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (this.pgPool) {
      try {
        await this.pgPool.query(`
          CREATE TABLE IF NOT EXISTS market_opportunity_candidates (
            candidate_id VARCHAR(64) PRIMARY KEY,
            strategy_id VARCHAR(128) NOT NULL,
            canonical_product_id VARCHAR(128) NOT NULL,
            candidate_name TEXT NOT NULL,
            lifecycle_state VARCHAR(32) NOT NULL,
            active_signals JSONB NOT NULL,
            investigation_status VARCHAR(32) NOT NULL,
            evidence_sufficiency JSONB NOT NULL,
            commercial_attractiveness JSONB NOT NULL,
            economic_eligibility JSONB,
            current_observation JSONB NOT NULL,
            observation_history_count INT NOT NULL DEFAULT 1,
            latest_transition_reason TEXT NOT NULL,
            first_seen_utc TIMESTAMPTZ NOT NULL,
            last_seen_utc TIMESTAMPTZ NOT NULL,
            updated_at_utc TIMESTAMPTZ NOT NULL,
            jcs_sha256 CHAR(64) NOT NULL,
            category VARCHAR(64)
          );

          ALTER TABLE market_opportunity_candidates ADD COLUMN IF NOT EXISTS category VARCHAR(64);
          ALTER TABLE market_opportunity_candidates ADD COLUMN IF NOT EXISTS economic_eligibility JSONB;

          CREATE TABLE IF NOT EXISTS market_candidate_lifecycle_events (
            event_id VARCHAR(64) PRIMARY KEY,
            candidate_id VARCHAR(64) NOT NULL REFERENCES market_opportunity_candidates(candidate_id) ON DELETE CASCADE,
            previous_state VARCHAR(32) NOT NULL,
            next_state VARCHAR(32) NOT NULL,
            signal VARCHAR(64) NOT NULL,
            trigger VARCHAR(64) NOT NULL,
            operator_id VARCHAR(64),
            transition_reason TEXT NOT NULL,
            previous_event_hash CHAR(64) NOT NULL,
            event_hash CHAR(64) NOT NULL,
            timestamp_utc TIMESTAMPTZ NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_opp_cand_state ON market_opportunity_candidates(lifecycle_state);
          CREATE INDEX IF NOT EXISTS idx_opp_cand_strat ON market_opportunity_candidates(strategy_id);
          CREATE INDEX IF NOT EXISTS idx_opp_events_cand ON market_candidate_lifecycle_events(candidate_id, timestamp_utc);
        `);

        // Hydrate persisted candidates into memory cache for zero-latency lookups
        const res = await this.pgPool.query(
          `SELECT candidate_id, strategy_id, canonical_product_id, candidate_name, category,
                  lifecycle_state, active_signals, investigation_status, evidence_sufficiency,
                  commercial_attractiveness, economic_eligibility, current_observation, observation_history_count,
                  latest_transition_reason, first_seen_utc, last_seen_utc, updated_at_utc, jcs_sha256
           FROM market_opportunity_candidates
           ORDER BY last_seen_utc DESC`
        );
        for (const row of res.rows) {
          const candidate: OpportunityCandidate = {
            candidate_id: row.candidate_id,
            strategy_id: row.strategy_id,
            canonical_product_id: row.canonical_product_id,
            candidate_name: row.candidate_name,
            category: row.category,
            lifecycle_state: row.lifecycle_state as OpportunityLifecycleState,
            active_signals: row.active_signals,
            investigation_status: row.investigation_status as InvestigationStatus,
            evidence_sufficiency: row.evidence_sufficiency,
            commercial_attractiveness: row.commercial_attractiveness,
            economic_eligibility: row.economic_eligibility || this.computeEconomicEligibility({
              quote: row.current_observation?.factory_gate_quote_inr ?? null,
              asp: row.current_observation?.prevailing_retail_asp_inr ?? null,
              category: row.category,
              nowUtc: row.updated_at_utc?.toISOString ? row.updated_at_utc.toISOString() : String(row.updated_at_utc),
              applicable_cost_categories: row.current_observation?.applicable_cost_categories,
              cost_category_exclusions: row.current_observation?.cost_category_exclusions,
              inbound_freight_inr: row.current_observation?.inbound_freight_inr,
              packaging_kitting_inr: row.current_observation?.packaging_kitting_inr,
              platform_fee_inr: row.current_observation?.platform_fee_inr ?? row.current_observation?.fulfillment_fee_inr,
              statutory_tax_inr: row.current_observation?.statutory_tax_inr,
              return_defect_drag_inr: row.current_observation?.return_defect_drag_inr
            }),
            current_observation: row.current_observation,
            observation_history_count: row.observation_history_count,
            latest_transition_reason: row.latest_transition_reason,
            first_seen_utc: row.first_seen_utc.toISOString ? row.first_seen_utc.toISOString() : String(row.first_seen_utc),
            last_seen_utc: row.last_seen_utc.toISOString ? row.last_seen_utc.toISOString() : String(row.last_seen_utc),
            updated_at_utc: row.updated_at_utc.toISOString ? row.updated_at_utc.toISOString() : String(row.updated_at_utc),
            jcs_sha256: row.jcs_sha256
          };
          this.inMemoryCandidates.set(candidate.candidate_id, candidate);
        }
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres table initialization warning:', err?.message ?? String(err));
      }
    }

    this.isInitialized = true;
  }

  /**
   * Fail-Closed Evidence Provenance Derivation.
   * Derives trusted origin class from connector identity and prevents untrusted self-promotion.
   * Synthetic connectors cannot be relabeled as live or fixture.
   * Recorded fixtures cannot be relabeled as live.
   * Live claims without authorized live collector fail closed to UNATTESTED_USER_INTAKE.
   */
  public static deriveTrustedOriginClass(
    sourceConnectorId: string,
    declaredOrigin?: string,
    existingCandidateOrigin?: string
  ): CandidateOriginClass {
    const connIdLower = (sourceConnectorId || '').trim().toLowerCase();

    // 1. Synthetic scenarios cannot be relabeled as live or fixture
    if (
      existingCandidateOrigin === 'SYNTHETIC_SCENARIO' ||
      declaredOrigin === 'SYNTHETIC_SCENARIO' ||
      connIdLower.includes('synthetic') ||
      connIdLower.includes('scenario') ||
      connIdLower.includes('simulated') ||
      connIdLower.includes('mock')
    ) {
      return 'SYNTHETIC_SCENARIO';
    }

    // 2. Recorded golden fixtures / replay adapters / archives
    const isFixtureConnector =
      connIdLower.includes('fixture') ||
      connIdLower.includes('golden') ||
      connIdLower.includes('replay') ||
      connIdLower.includes('archive') ||
      connIdLower.startsWith('conn:fixture') ||
      connIdLower.startsWith('fixture://');

    if (isFixtureConnector) {
      return 'RECORDED_GOLDEN_FIXTURE';
    }

    // 3. Unattested user intake or manual inputs
    const isUnattestedConnector =
      connIdLower.includes('unattested') ||
      connIdLower.includes('manual') ||
      connIdLower.includes('user_intake') ||
      connIdLower.includes('unverified');

    if (isUnattestedConnector) {
      return 'UNATTESTED_USER_INTAKE';
    }

    // 3b. Operator simulation assumptions
    if (
      declaredOrigin === 'OPERATOR_SIMULATION_ASSUMPTION' ||
      existingCandidateOrigin === 'OPERATOR_SIMULATION_ASSUMPTION' ||
      connIdLower.includes('simulation-assumption') ||
      connIdLower.includes('operator')
    ) {
      return 'OPERATOR_SIMULATION_ASSUMPTION';
    }

    // 4. Authorized live collectors (e.g. conn:live:amazon-in, conn:verified:live-feed)
    const isAuthorizedLive =
      connIdLower.startsWith('conn:live:') ||
      connIdLower.includes(':live-') ||
      connIdLower.includes(':live:') ||
      connIdLower === 'conn:live' ||
      connIdLower.includes('live_verified');

    if (isAuthorizedLive) {
      return 'LIVE_VERIFIED_CAPTURE';
    }

    // 5. If caller claimed LIVE_VERIFIED_CAPTURE without an authorized live connector:
    if (declaredOrigin === 'LIVE_VERIFIED_CAPTURE') {
      // Demote to RECORDED_GOLDEN_FIXTURE if connector is a known recorded marketplace connector or candidate was fixture
      if (
        existingCandidateOrigin === 'RECORDED_GOLDEN_FIXTURE' ||
        connIdLower.includes('indiamart') ||
        connIdLower.includes('amazon') ||
        connIdLower.includes('gem')
      ) {
        return 'RECORDED_GOLDEN_FIXTURE';
      }
      return 'UNATTESTED_USER_INTAKE';
    }

    if (declaredOrigin === 'RECORDED_GOLDEN_FIXTURE' || declaredOrigin === 'UNATTESTED_USER_INTAKE' || declaredOrigin === 'OPERATOR_SIMULATION_ASSUMPTION') {
      return declaredOrigin;
    }

    if (existingCandidateOrigin === 'RECORDED_GOLDEN_FIXTURE' || existingCandidateOrigin === 'UNATTESTED_USER_INTAKE' || existingCandidateOrigin === 'OPERATOR_SIMULATION_ASSUMPTION') {
      return existingCandidateOrigin;
    }

    return 'RECORDED_GOLDEN_FIXTURE';
  }

  /**
   * Fail-Closed Semantic Cost Exclusion Validation.
   * Rationale length alone is NOT proof of genuine inapplicability.
   * Prohibits generic filler/placeholders and non-excludable costs (e.g. supplier purchase on physical goods).
   */
  public static validateCostExclusion(
    category: OpportunityCategory | string,
    costCat: ApplicableCostCategory,
    exclusionBasis: string
  ): boolean {
    if (!exclusionBasis || typeof exclusionBasis !== 'string') {
      return false;
    }
    const trimmed = exclusionBasis.trim();
    if (trimmed.length < 10) {
      return false;
    }

    // SUPPLIER_PURCHASE cannot be excluded for physical goods or B2B distribution
    if (
      (category === 'PHYSICAL_GOODS' || category === 'B2B_DISTRIBUTION' || !category) &&
      costCat === 'SUPPLIER_PURCHASE'
    ) {
      return false;
    }

    // Reject generic filler, repetition, or meaningless non-rationales
    const lower = trimmed.toLowerCase();
    const genericRejectionPatterns = [
      'placeholder',
      'not applicable',
      'none',
      'n/a',
      'na',
      'dummy',
      'test test',
      'asdf',
      '1234567890',
      'qwerty',
      'no cost',
      'zero cost',
      'exempt without reason'
    ];
    for (const pattern of genericRejectionPatterns) {
      if (lower === pattern || (pattern.length > 5 && lower.includes(pattern))) {
        return false;
      }
    }

    // Reject all-digit or repetitive character sequences
    if (/^\d+$/.test(trimmed) || /^([a-zA-Z0-9])\1{5,}$/.test(trimmed)) {
      return false;
    }

    return true;
  }

  /**
   * Computes deterministic, immutable Candidate ID from strategy and canonical product identity.
   * Stable across price changes, quote refreshes, and connector re-runs.
   */
  public static computeCandidateId(strategyId: string, canonicalProductId: string): string {
    const seed = `${strategyId.trim().toLowerCase()}::${canonicalProductId.trim().toLowerCase()}`;
    return `OPP-${sha256(seed).slice(0, 16).toUpperCase()}`;
  }

  /**
   * Ingests a new or updated observation for a candidate.
   * Performs delta detection, evidence sufficiency profiling, and provisional attractiveness estimation.
   */
  public async ingestObservation(input: IngestObservationInput): Promise<{
    candidate: OpportunityCandidate;
    signal: ObservationChangeSignal;
    is_new: boolean;
  }> {
    await this.initialize();

    const candidateId = OpportunityLifecycleEngine.computeCandidateId(input.strategy_id, input.canonical_product_id);
    const nowUtc = new Date().toISOString();
    const observedAtUtc = input.observed_at_utc ?? nowUtc;

    const existing = await this.getCandidate(candidateId);
    const isNew = existing === null;

    // Build observation snapshot
    const rawPayload = input.raw_payload ?? '';
    const contentToHash = rawPayload || `${input.prevailing_retail_asp_inr ?? ''}:${input.factory_gate_quote_inr ?? ''}:${input.unit_batch_moq ?? ''}:${input.observed_seller_count ?? ''}:${input.review_sentiment_summary ?? ''}`;
    const payloadHash = sha256(contentToHash);
    const observationId = `OBS-${sha256(candidateId + observedAtUtc + payloadHash).slice(0, 12).toUpperCase()}`;

    const trustedOriginClass = OpportunityLifecycleEngine.deriveTrustedOriginClass(
      input.source_connector_id,
      input.origin_class,
      existing?.current_observation.origin_class
    );

    const newObservation: CandidateObservationSnapshot = {
      observation_id: observationId,
      source_connector_id: input.source_connector_id,
      origin_class: trustedOriginClass,
      observed_at_utc: observedAtUtc,
      prevailing_retail_asp_inr: input.prevailing_retail_asp_inr ?? existing?.current_observation.prevailing_retail_asp_inr ?? null,
      factory_gate_quote_inr: input.factory_gate_quote_inr ?? existing?.current_observation.factory_gate_quote_inr ?? null,
      unit_batch_moq: input.unit_batch_moq ?? existing?.current_observation.unit_batch_moq ?? null,
      observed_seller_count: input.observed_seller_count ?? existing?.current_observation.observed_seller_count ?? null,
      review_sentiment_summary: input.review_sentiment_summary ?? existing?.current_observation.review_sentiment_summary ?? null,
      raw_payload_snippet: rawPayload ? rawPayload.slice(0, 200) : undefined,
      payload_sha256: payloadHash,
      applicable_cost_categories: input.applicable_cost_categories ?? existing?.current_observation.applicable_cost_categories,
      cost_category_exclusions: input.cost_category_exclusions ?? existing?.current_observation.cost_category_exclusions,
      inbound_freight_inr: input.inbound_freight_inr ?? existing?.current_observation.inbound_freight_inr ?? null,
      packaging_kitting_inr: input.packaging_kitting_inr ?? existing?.current_observation.packaging_kitting_inr ?? null,
      platform_fee_inr: input.platform_fee_inr ?? existing?.current_observation.platform_fee_inr ?? null,
      fulfillment_fee_inr: input.fulfillment_fee_inr ?? existing?.current_observation.fulfillment_fee_inr ?? null,
      statutory_tax_inr: input.statutory_tax_inr ?? existing?.current_observation.statutory_tax_inr ?? null,
      return_defect_drag_inr: input.return_defect_drag_inr ?? existing?.current_observation.return_defect_drag_inr ?? null,
      lead_time_days: input.lead_time_days ?? existing?.current_observation.lead_time_days ?? null,
      payment_terms_days: input.payment_terms_days ?? existing?.current_observation.payment_terms_days ?? null,
      warehouse_dwell_days: input.warehouse_dwell_days ?? existing?.current_observation.warehouse_dwell_days ?? null,
      settlement_delay_days: input.settlement_delay_days ?? existing?.current_observation.settlement_delay_days ?? null
    };

    // Delta detection against existing observation
    let detectedSignal: ObservationChangeSignal = 'UNCHANGED';
    if (input.signal_override) {
      detectedSignal = input.signal_override;
    } else if (isNew) {
      detectedSignal = 'INITIAL_OBSERVATION';
    } else {
      const prevObs = existing.current_observation;
      const prevAsp = prevObs.prevailing_retail_asp_inr;
      const newAsp = newObservation.prevailing_retail_asp_inr;
      const prevQuote = prevObs.factory_gate_quote_inr;
      const newQuote = newObservation.factory_gate_quote_inr;

      if (prevAsp !== null && newAsp !== null && prevAsp !== newAsp) {
        detectedSignal = 'PRICE_CHANGED';
      } else if (prevQuote !== null && newQuote !== null && prevQuote !== newQuote) {
        detectedSignal = 'SUPPLIER_QUOTE_UPDATED';
      } else if (
        input.review_sentiment_summary &&
        input.review_sentiment_summary !== prevObs.review_sentiment_summary &&
        (input.review_sentiment_summary.toLowerCase().includes('defect') ||
          input.review_sentiment_summary.toLowerCase().includes('complaint') ||
          input.review_sentiment_summary.toLowerCase().includes('broke') ||
          input.review_sentiment_summary.toLowerCase().includes('poor'))
      ) {
        detectedSignal = 'GRIEVANCE_SURFACED';
      } else if (prevObs.payload_sha256 !== newObservation.payload_sha256) {
        detectedSignal = 'SPEC_MODIFIED';
      }
    }

    const category = input.category ?? existing?.category ?? inferCategoryFromEntityId(input.canonical_product_id);

    // Evaluate evidence sufficiency
    const sufficiency = this.computeSufficiencyProfile({
      quote: newObservation.factory_gate_quote_inr,
      asp: newObservation.prevailing_retail_asp_inr,
      sentiment: newObservation.review_sentiment_summary,
      hasRoute: input.has_logistics_route ?? (existing?.evidence_sufficiency.has_logistics_route ?? false),
      hasReg: input.has_regulatory_clearance ?? (existing?.evidence_sufficiency.has_regulatory_clearance ?? false),
      nowUtc: observedAtUtc,
      category
    });

    // Evaluate provisional commercial attractiveness
    const attractiveness = this.computeCommercialAttractiveness(
      newObservation.factory_gate_quote_inr,
      newObservation.prevailing_retail_asp_inr,
      category
    );

    // Evaluate category-specific economic eligibility
    const economicEligibility = this.computeEconomicEligibility({
      quote: newObservation.factory_gate_quote_inr,
      asp: newObservation.prevailing_retail_asp_inr,
      category,
      nowUtc: observedAtUtc,
      applicable_cost_categories: newObservation.applicable_cost_categories,
      cost_category_exclusions: newObservation.cost_category_exclusions,
      inbound_freight_inr: newObservation.inbound_freight_inr,
      packaging_kitting_inr: newObservation.packaging_kitting_inr,
      platform_fee_inr: newObservation.platform_fee_inr ?? newObservation.fulfillment_fee_inr,
      statutory_tax_inr: newObservation.statutory_tax_inr,
      return_defect_drag_inr: newObservation.return_defect_drag_inr
    });

    // Active signals aggregation: keep stale/conflict flags if not resolved
    const signalsSet = new Set<ObservationChangeSignal>();
    if (detectedSignal !== 'UNCHANGED') {
      signalsSet.add(detectedSignal);
    }
    if (existing) {
      for (const sig of existing.active_signals) {
        if (sig === 'EVIDENCE_STALE' && detectedSignal !== 'INITIAL_OBSERVATION' && detectedSignal !== 'UNCHANGED') {
          // Fresh observation clears stale flag
          continue;
        }
        if (sig !== 'UNCHANGED') {
          signalsSet.add(sig);
        }
      }
    }
    const activeSignals = Array.from(signalsSet);

    // Determine target lifecycle state
    let targetState: OpportunityLifecycleState = existing ? existing.lifecycle_state : 'NEW';
    let transitionReason = existing?.latest_transition_reason ?? 'Initial candidate discovery from marketplace listing';

    if (isNew) {
      targetState = 'NEW';
      transitionReason = `Initial candidate discovered from ${input.source_connector_id}`;
    } else if (detectedSignal === 'PRICE_CHANGED') {
      transitionReason = `Observed retail price change: ₹${existing.current_observation.prevailing_retail_asp_inr} -> ₹${newObservation.prevailing_retail_asp_inr}`;
    } else if (detectedSignal === 'SUPPLIER_QUOTE_UPDATED') {
      transitionReason = `Updated supplier quote: ₹${existing.current_observation.factory_gate_quote_inr} -> ₹${newObservation.factory_gate_quote_inr}`;
    }

    // Build candidate representation
    const historyCount = (existing?.observation_history_count ?? 0) + (detectedSignal === 'UNCHANGED' ? 0 : 1);
    const candidateData = {
      candidate_id: candidateId,
      strategy_id: input.strategy_id,
      canonical_product_id: input.canonical_product_id,
      candidate_name: input.candidate_name,
      category,
      lifecycle_state: targetState,
      active_signals: activeSignals,
      investigation_status: existing?.investigation_status ?? 'UNSCHEDULED',
      evidence_sufficiency: sufficiency,
      commercial_attractiveness: attractiveness,
      economic_eligibility: economicEligibility,
      current_observation: newObservation,
      observation_history_count: Math.max(1, historyCount),
      latest_transition_reason: transitionReason,
      first_seen_utc: existing?.first_seen_utc ?? observedAtUtc,
      last_seen_utc: input.observed_at_utc ?? nowUtc,
      updated_at_utc: input.observed_at_utc ?? nowUtc
    };

    const jcsSha256 = sha256(canonicalizeJCS(candidateData));
    const candidate: OpportunityCandidate = {
      ...candidateData,
      jcs_sha256: jcsSha256
    };

    // Persist candidate
    await this.persistCandidate(candidate);

    // Record lifecycle event if new or material signal detected
    if (isNew || detectedSignal !== 'UNCHANGED') {
      await this.recordEvent({
        candidateId,
        previousState: existing?.lifecycle_state ?? 'NEW',
        nextState: targetState,
        signal: detectedSignal,
        trigger: 'OBSERVATION_INGESTED',
        transitionReason,
        timestampUtc: input.observed_at_utc ?? nowUtc
      });
    }

    return {
      candidate,
      signal: detectedSignal,
      is_new: isNew
    };
  }

  /**
   * Transitions a candidate to a new lifecycle state.
   * Fail-closed: invalid transitions are strictly rejected.
   */
  public async transitionState(
    candidateId: string,
    nextState: OpportunityLifecycleState,
    transitionReason: string,
    operatorId?: string
  ): Promise<OpportunityCandidate> {
    await this.initialize();

    const candidate = await this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`E-OPP-NOT-FOUND: Candidate '${candidateId}' does not exist`);
    }

    const currentState = candidate.lifecycle_state;
    if (currentState === nextState) {
      return candidate; // No-op idempotent transition
    }

    // Validate against permitted transitions
    const allowed = PERMITTED_TRANSITIONS[currentState];
    if (!allowed || !allowed.includes(nextState)) {
      throw new Error(
        `E-OPP-INVALID-TRANSITION: Cannot transition candidate '${candidateId}' from '${currentState}' to '${nextState}'. Permitted: [${allowed ? allowed.join(', ') : 'none'}]`
      );
    }

    // Special constraint: REJECTED -> INVESTIGATE requires explicit rationale >= 15 chars
    if (currentState === 'REJECTED' && nextState === 'INVESTIGATE') {
      if (!transitionReason || transitionReason.trim().length < 15) {
        throw new Error(
          `E-OPP-OVERRIDE-RATIONALE-REQUIRED: Re-opening a REJECTED candidate requires an explicit operator justification of at least 15 characters.`
        );
      }
    }

    // Special constraint: transition to VERIFIED requires evidence sufficiency
    if (nextState === 'VERIFIED' && !candidate.evidence_sufficiency.is_sufficient_for_underwriting) {
      throw new Error(
        `E-OPP-VERIFICATION-SUFFICIENCY-BLOCKED: Cannot transition candidate '${candidateId}' to VERIFIED. Evidence sufficiency score is ${candidate.evidence_sufficiency.sufficiency_score_bps} bps (requires 10,000 bps). Missing: [${candidate.evidence_sufficiency.missing_critical_fields.join(', ')}]`
      );
    }

    // Special constraint: transition to PAPER_ELIGIBLE requires evidence sufficiency AND economic eligibility
    if (nextState === 'PAPER_ELIGIBLE') {
      if (!candidate.evidence_sufficiency.is_sufficient_for_underwriting) {
        throw new Error(
          `E-OPP-INSUFFICIENT-COMMIT-BLOCKED: Cannot transition candidate '${candidateId}' to PAPER_ELIGIBLE. Evidence sufficiency score is ${candidate.evidence_sufficiency.sufficiency_score_bps} bps (requires 10,000 bps). Missing: [${candidate.evidence_sufficiency.missing_critical_fields.join(', ')}]`
        );
      }
      if (candidate.active_signals.includes('EVIDENCE_CONFLICT_DETECTED')) {
        throw new Error(
          `E-OPP-CONFLICT-COMMIT-BLOCKED: Cannot transition candidate '${candidateId}' to PAPER_ELIGIBLE while unresolved EVIDENCE_CONFLICT_DETECTED signal is active.`
        );
      }
      if (candidate.current_observation.origin_class === 'SYNTHETIC_SCENARIO') {
        throw new Error(
          `E-OPP-SYNTHETIC-COMMIT-BLOCKED: Cannot transition candidate '${candidateId}' with synthetic scenario origin to PAPER_ELIGIBLE.`
        );
      }
      if (candidate.active_signals.includes('EVIDENCE_STALE')) {
        throw new Error(
          `E-OPP-STALE-COMMIT-BLOCKED: Cannot transition candidate '${candidateId}' to PAPER_ELIGIBLE while EVIDENCE_STALE signal is active.`
        );
      }
      if (!candidate.economic_eligibility?.is_economically_eligible) {
        throw new Error(
          `E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED: Cannot transition candidate '${candidateId}' to PAPER_ELIGIBLE. Status: ${candidate.economic_eligibility?.evaluation_status}. Missing inputs: [${candidate.economic_eligibility?.missing_economic_inputs?.join(', ') || 'none'}]. ${candidate.economic_eligibility?.policy_evaluation_notes || ''}`
        );
      }
      if (
        candidate.commercial_attractiveness.attractiveness_rating === 'UNKNOWN' ||
        candidate.commercial_attractiveness.attractiveness_rating === 'NEGATIVE'
      ) {
        throw new Error(
          `E-OPP-UNATTRACTIVE-COMMIT-BLOCKED: Cannot transition candidate '${candidateId}' to PAPER_ELIGIBLE. Attractiveness rating is '${candidate.commercial_attractiveness.attractiveness_rating}'.`
        );
      }

      // Paper budget verification when requirePaperBudget is active
      if (this.requirePaperBudget) {
        const isFromAuthorizedCommit = transitionReason?.startsWith('Authorized for paper simulation allocation');
        if (!isFromAuthorizedCommit) {
          const effectiveBudget = this.defaultPaperBudgetConfig;
          if (!effectiveBudget || typeof effectiveBudget.available_paper_capital_inr !== 'number' || effectiveBudget.available_paper_capital_inr <= 0) {
            throw new Error(
              `E-OPP-BUDGET-UNCONFIGURED: Direct transition to PAPER_ELIGIBLE requires configured paper budget or invocation via authorizePaperCommit().`
            );
          }
          const moq = candidate.current_observation.unit_batch_moq ?? 1;
          const quote = candidate.current_observation.factory_gate_quote_inr ?? 0;
          const freight = candidate.current_observation.inbound_freight_inr ?? 0;
          const packaging = candidate.current_observation.packaging_kitting_inr ?? 0;
          const requiredOutlay = (quote + freight + packaging) * moq;

          if (requiredOutlay > effectiveBudget.available_paper_capital_inr) {
            throw new Error(
              `E-OPP-BUDGET-EXCEEDED: Candidate '${candidateId}' requires initial cash of ₹${requiredOutlay.toFixed(2)}, which exceeds configured paper budget of ₹${effectiveBudget.available_paper_capital_inr.toFixed(2)}.`
            );
          }
          if (effectiveBudget.max_single_allocation_inr && requiredOutlay > effectiveBudget.max_single_allocation_inr) {
            throw new Error(
              `E-OPP-ALLOCATION-LIMIT-EXCEEDED: Candidate '${candidateId}' requires initial cash of ₹${requiredOutlay.toFixed(2)}, which exceeds max single allocation limit of ₹${effectiveBudget.max_single_allocation_inr.toFixed(2)}.`
            );
          }
        }
      }
    }

    const nowUtc = new Date().toISOString();
    const updatedData = {
      ...candidate,
      lifecycle_state: nextState,
      latest_transition_reason: transitionReason,
      updated_at_utc: nowUtc
    };

    const jcsSha256 = sha256(canonicalizeJCS(updatedData));
    const updatedCandidate: OpportunityCandidate = {
      ...updatedData,
      jcs_sha256: jcsSha256
    };

    await this.persistCandidate(updatedCandidate);

    await this.recordEvent({
      candidateId,
      previousState: currentState,
      nextState,
      signal: 'UNCHANGED',
      trigger: operatorId ? 'OPERATOR_DECISION' : 'SUFFICIENCY_EVALUATED',
      operatorId,
      transitionReason,
      timestampUtc: nowUtc
    });

    return updatedCandidate;
  }

  /**
   * Fail-Closed Human Gate for Paper Allocation Commitment.
   * Only VERIFIED or PAPER_ELIGIBLE candidates with full evidence sufficiency can be committed.
   */
  public async authorizePaperCommit(
    candidateId: string,
    confirmationRationale: string,
    operatorId?: string,
    budgetConfig?: PaperCapitalBudgetConfig | null
  ): Promise<{ authorized: boolean; candidate_id: string; commit_event_hash: string; allocated_paper_capital_inr?: number }> {
    await this.initialize();

    const candidate = await this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`E-OPP-NOT-FOUND: Candidate '${candidateId}' does not exist`);
    }

    if (!confirmationRationale || confirmationRationale.trim().length < 15) {
      throw new Error(
        `E-OPP-COMMIT-RATIONALE-REQUIRED: Paper commitment requires a substantive human confirmation rationale of at least 15 characters (got ${confirmationRationale ? confirmationRationale.length : 0}).`
      );
    }

    // Fail-closed state check
    if (candidate.lifecycle_state !== 'VERIFIED' && candidate.lifecycle_state !== 'PAPER_ELIGIBLE') {
      throw new Error(
        `E-OPP-UNVERIFIED-COMMIT-BLOCKED: Cannot commit candidate '${candidateId}' with status '${candidate.lifecycle_state}'. Only candidates passing all evidence gates (VERIFIED or PAPER_ELIGIBLE) may be committed to paper allocation.`
      );
    }

    if (!candidate.evidence_sufficiency.is_sufficient_for_underwriting) {
      throw new Error(
        `E-OPP-INSUFFICIENT-COMMIT-BLOCKED: Candidate '${candidateId}' has incomplete evidence. Missing: [${candidate.evidence_sufficiency.missing_critical_fields.join(', ')}]`
      );
    }

    if (!candidate.economic_eligibility?.is_economically_eligible) {
      throw new Error(
        `E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED: Candidate '${candidateId}' is not economically eligible for paper simulation. Status: ${candidate.economic_eligibility?.evaluation_status}. Missing inputs: [${candidate.economic_eligibility?.missing_economic_inputs?.join(', ') || 'none'}]. ${candidate.economic_eligibility?.policy_evaluation_notes || ''}`
      );
    }

    if (
      candidate.commercial_attractiveness.attractiveness_rating === 'UNKNOWN' ||
      candidate.commercial_attractiveness.attractiveness_rating === 'NEGATIVE'
    ) {
      throw new Error(
        `E-OPP-UNATTRACTIVE-COMMIT-BLOCKED: Candidate '${candidateId}' has unattractive or unknown commercial rating: '${candidate.commercial_attractiveness.attractiveness_rating}'.`
      );
    }

    if (candidate.active_signals.includes('EVIDENCE_CONFLICT_DETECTED')) {
      throw new Error(
        `E-OPP-CONFLICT-COMMIT-BLOCKED: Candidate '${candidateId}' has active unresolved EVIDENCE_CONFLICT_DETECTED signal.`
      );
    }

    if (candidate.current_observation.origin_class === 'SYNTHETIC_SCENARIO') {
      throw new Error(
        `E-OPP-SYNTHETIC-COMMIT-BLOCKED: Candidate '${candidateId}' has origin_class SYNTHETIC_SCENARIO and cannot authorize paper commitments.`
      );
    }

    if (candidate.active_signals.includes('EVIDENCE_STALE')) {
      throw new Error(
        `E-OPP-STALE-COMMIT-BLOCKED: Candidate '${candidateId}' has active EVIDENCE_STALE signal.`
      );
    }

    // Paper capital budget authorization gate
    const effectiveBudget = budgetConfig ?? this.defaultPaperBudgetConfig;
    if (this.requirePaperBudget || budgetConfig !== undefined) {
      if (!effectiveBudget || typeof effectiveBudget.available_paper_capital_inr !== 'number' || effectiveBudget.available_paper_capital_inr <= 0) {
        throw new Error(
          `E-OPP-BUDGET-UNCONFIGURED: Paper capital commitment requires explicit available_paper_capital_inr budget configuration.`
        );
      }
      const moq = candidate.current_observation.unit_batch_moq ?? 1;
      const quote = candidate.current_observation.factory_gate_quote_inr ?? 0;
      const freight = candidate.current_observation.inbound_freight_inr ?? 0;
      const packaging = candidate.current_observation.packaging_kitting_inr ?? 0;
      const requiredOutlay = (quote + freight + packaging) * moq;

      if (requiredOutlay > effectiveBudget.available_paper_capital_inr) {
        throw new Error(
          `E-OPP-BUDGET-EXCEEDED: Candidate '${candidateId}' requires initial cash of ₹${requiredOutlay.toFixed(2)}, which exceeds configured paper budget of ₹${effectiveBudget.available_paper_capital_inr.toFixed(2)}.`
        );
      }
      if (effectiveBudget.max_single_allocation_inr && requiredOutlay > effectiveBudget.max_single_allocation_inr) {
        throw new Error(
          `E-OPP-ALLOCATION-LIMIT-EXCEEDED: Candidate '${candidateId}' requires initial cash of ₹${requiredOutlay.toFixed(2)}, which exceeds max single allocation limit of ₹${effectiveBudget.max_single_allocation_inr.toFixed(2)}.`
        );
      }
    }

    // Transition to PAPER_ELIGIBLE if not already
    const committedCandidate = await this.transitionState(
      candidateId,
      'PAPER_ELIGIBLE',
      `Authorized for paper simulation allocation by ${operatorId ?? 'operator'}: ${confirmationRationale.trim()}`,
      operatorId
    );

    const history = await this.getEventHistory(candidateId);
    const lastEvent = history[history.length - 1];

    const moq = candidate.current_observation.unit_batch_moq ?? 1;
    const quote = candidate.current_observation.factory_gate_quote_inr ?? 0;
    const freight = candidate.current_observation.inbound_freight_inr ?? 0;
    const packaging = candidate.current_observation.packaging_kitting_inr ?? 0;
    const allocatedCapital = (quote + freight + packaging) * moq;

    return {
      authorized: true,
      candidate_id: candidateId,
      commit_event_hash: lastEvent ? lastEvent.event_hash : candidate.jcs_sha256,
      allocated_paper_capital_inr: allocatedCapital
    };
  }

  /**
   * Evaluates a candidate against deterministic underwriting criteria,
   * producing an immutable CandidateUnderwritingDecision with RFC 8785 attestation.
   */
  /**
   * Evaluates a candidate against deterministic underwriting criteria,
   * producing an immutable CandidateUnderwritingDecision with RFC 8785 attestation.
   */
  public async underwriteCandidate(
    candidateId: string,
    options?: {
      budgetConfig?: PaperCapitalBudgetConfig;
    }
  ): Promise<CandidateUnderwritingDecision> {
    await this.initialize();

    const candidate = await this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`E-OPP-NOT-FOUND: Candidate '${candidateId}' does not exist`);
    }

    const nowUtc = new Date().toISOString();
    const evaluatedAtUtc = candidate.current_observation.observed_at_utc || nowUtc;

    const asp = candidate.current_observation.prevailing_retail_asp_inr;
    const quote = candidate.current_observation.factory_gate_quote_inr;
    const hasBothPrices = typeof asp === 'number' && !isNaN(asp) && asp > 0 && typeof quote === 'number' && !isNaN(quote) && quote > 0;
    const grossSpread = hasBothPrices ? Number((asp! - quote!).toFixed(2)) : null;
    const estimatedMarginBps = hasBothPrices ? Math.round(((asp! - quote!) / asp!) * 10000) : null;

    const failedChecks: string[] = [];
    const bindingConstraints: string[] = [];

    // Check active disqualifying signals (conflict / stale)
    if (candidate.active_signals.includes('EVIDENCE_CONFLICT_DETECTED')) {
      failedChecks.push('ACTIVE_EVIDENCE_CONFLICT_DETECTED');
      bindingConstraints.push('Active unresolved EVIDENCE_CONFLICT_DETECTED signal');
    }

    if (candidate.active_signals.includes('EVIDENCE_STALE')) {
      failedChecks.push('ACTIVE_EVIDENCE_STALE');
      bindingConstraints.push('Active unresolved EVIDENCE_STALE signal');
    }

    // Check evidence sufficiency
    if (!candidate.evidence_sufficiency.is_sufficient_for_underwriting) {
      failedChecks.push('EVIDENCE_SUFFICIENCY_UNSATISFIED');
      for (const field of candidate.evidence_sufficiency.missing_critical_fields) {
        bindingConstraints.push(`Missing mandatory field: ${field}`);
      }
      for (const field of candidate.evidence_sufficiency.uncorroborated_fields) {
        bindingConstraints.push(`Uncorroborated evidence field: ${field}`);
      }
      if (candidate.evidence_sufficiency.sufficiency_score_bps < 10000) {
        bindingConstraints.push(`Evidence sufficiency score: ${candidate.evidence_sufficiency.sufficiency_score_bps} bps (requires 10,000 bps)`);
      }
    }

    // Check cost completeness across all material categories for category
    const obs = candidate.current_observation;
    const category = candidate.category ?? 'PHYSICAL_GOODS';
    const missingCostInputs: string[] = [];
    const costAssessments: CostCategoryAssessment[] = [];
    const recordedExclusions: CostCategoryExclusion[] = [];

    const exclusionsMap = new Map<ApplicableCostCategory, string>();
    if (obs.cost_category_exclusions && Array.isArray(obs.cost_category_exclusions)) {
      for (const ex of obs.cost_category_exclusions) {
        if (typeof ex?.category === 'string' && typeof ex?.exclusion_basis === 'string') {
          const basisTrimmed = ex.exclusion_basis.trim();
          if (OpportunityLifecycleEngine.validateCostExclusion(category, ex.category, basisTrimmed)) {
            exclusionsMap.set(ex.category, basisTrimmed);
            recordedExclusions.push({
              category: ex.category,
              exclusion_basis: basisTrimmed
            });
          }
        }
      }
    }

    // Standard material cost categories conditionally defined by domain category
    const standardCategories: readonly ApplicableCostCategory[] =
      category === 'SOFTWARE_DIGITAL'
        ? ['SUPPLIER_PURCHASE', 'MARKETPLACE_FEES', 'STATUTORY_TAX']
        : category === 'SERVICE_CONTRACT'
        ? ['SUPPLIER_PURCHASE', 'STATUTORY_TAX']
        : [
            'SUPPLIER_PURCHASE',
            'INBOUND_FREIGHT',
            'PACKAGING_KITTING',
            'MARKETPLACE_FEES',
            'STATUTORY_TAX',
            'RETURN_DEFECT_DRAG'
          ];

    let freightAmount = 0;
    let packagingAmount = 0;
    let feesAmount = 0;
    let taxAmount = 0;
    let returnAmount = 0;

    for (const cat of standardCategories) {
      if (cat === 'SUPPLIER_PURCHASE') {
        if (typeof quote === 'number' && !isNaN(quote) && quote > 0) {
          costAssessments.push({
            category: 'SUPPLIER_PURCHASE',
            treatment: 'KNOWN_VALUE',
            amount_inr: quote,
            exclusion_basis: null
          });
        } else {
          costAssessments.push({
            category: 'SUPPLIER_PURCHASE',
            treatment: 'UNKNOWN_MISSING',
            amount_inr: null,
            exclusion_basis: null
          });
          missingCostInputs.push('SUPPLIER_PURCHASE');
          bindingConstraints.push('Missing required cost input: SUPPLIER_PURCHASE (DATA_REQUIRED)');
        }
      } else {
        const rawVal =
          cat === 'INBOUND_FREIGHT'
            ? obs.inbound_freight_inr
            : cat === 'PACKAGING_KITTING'
            ? obs.packaging_kitting_inr
            : cat === 'MARKETPLACE_FEES'
            ? (obs.platform_fee_inr ?? obs.fulfillment_fee_inr)
            : cat === 'STATUTORY_TAX'
            ? obs.statutory_tax_inr
            : obs.return_defect_drag_inr;

        if (exclusionsMap.has(cat)) {
          const basis = exclusionsMap.get(cat)!;
          costAssessments.push({
            category: cat,
            treatment: 'EXPLICITLY_NOT_APPLICABLE',
            amount_inr: 0,
            exclusion_basis: basis
          });
        } else if (typeof rawVal === 'number' && !isNaN(rawVal)) {
          if (rawVal === 0) {
            costAssessments.push({
              category: cat,
              treatment: 'KNOWN_ZERO',
              amount_inr: 0,
              exclusion_basis: null
            });
          } else if (rawVal > 0) {
            costAssessments.push({
              category: cat,
              treatment: 'KNOWN_VALUE',
              amount_inr: rawVal,
              exclusion_basis: null
            });
            if (cat === 'INBOUND_FREIGHT') freightAmount = rawVal;
            else if (cat === 'PACKAGING_KITTING') packagingAmount = rawVal;
            else if (cat === 'MARKETPLACE_FEES') feesAmount = rawVal;
            else if (cat === 'STATUTORY_TAX') taxAmount = rawVal;
            else if (cat === 'RETURN_DEFECT_DRAG') returnAmount = rawVal;
          } else {
            costAssessments.push({
              category: cat,
              treatment: 'UNKNOWN_MISSING',
              amount_inr: null,
              exclusion_basis: null
            });
            missingCostInputs.push(cat);
            bindingConstraints.push(`Missing required cost input: ${cat} (DATA_REQUIRED)`);
          }
        } else {
          costAssessments.push({
            category: cat,
            treatment: 'UNKNOWN_MISSING',
            amount_inr: null,
            exclusion_basis: null
          });
          missingCostInputs.push(cat);
          bindingConstraints.push(`Missing required cost input: ${cat} (DATA_REQUIRED)`);
        }
      }
    }

    if (missingCostInputs.length > 0) {
      failedChecks.push('MANDATORY_COST_INPUT_MISSING');
    }

    // Precise integer subunit arithmetic (scale 10,000; 1 INR = 10,000 subunits)
    const SCALE = 10000n;
    const toSubunits = (val: number): bigint => BigInt(Math.round(val * 10000));
    const fromSubunits = (subunits: bigint): number => {
      const isNeg = subunits < 0n;
      const absVal = isNeg ? -subunits : subunits;
      const whole = absVal / SCALE;
      const frac = absVal % SCALE;
      const num = Number(whole) + Number(frac) / 10000;
      return isNeg ? -num : num;
    };

    let netContributionInr: number | null = null;
    let contributionMarginBps: number | null = null;
    let nonSupplierVariableCostsInr: number | null = null;
    let totalDeductionsInr: number | null = null;
    let initialCashRequirementInr: number | null = null;
    let workingCapitalExposureInr: number | null = null;
    let cccDays: number | null = null;
    const moq = obs.unit_batch_moq ?? null;

    if (hasBothPrices && missingCostInputs.length === 0) {
      const supplierSub = toSubunits(quote!);
      const freightSub = toSubunits(freightAmount);
      const packagingSub = toSubunits(packagingAmount);
      const feesSub = toSubunits(feesAmount);
      const taxSub = toSubunits(taxAmount);
      const returnSub = toSubunits(returnAmount);

      // Non-supplier variable costs
      const nonSupplierSub = freightSub + packagingSub + feesSub + taxSub + returnSub;
      nonSupplierVariableCostsInr = fromSubunits(nonSupplierSub);

      // Total variable deductions = supplier purchase + non-supplier variable costs
      const totalDeductionsSub = supplierSub + nonSupplierSub;
      totalDeductionsInr = fromSubunits(totalDeductionsSub);

      const aspSub = toSubunits(asp!);
      const netContributionSub = aspSub - totalDeductionsSub;

      netContributionInr = fromSubunits(netContributionSub);
      contributionMarginBps = Math.round((Number(netContributionSub) / Number(aspSub)) * 10000);

      // Upfront outlay: supplier purchase + inbound freight + packaging kitting
      const unitUpfrontSub =
        category === 'SOFTWARE_DIGITAL' || category === 'SERVICE_CONTRACT'
          ? supplierSub
          : supplierSub + freightSub + packagingSub;
      if (moq !== null && moq > 0) {
        const initialCashSub = unitUpfrontSub * BigInt(moq);
        initialCashRequirementInr = fromSubunits(initialCashSub);
        workingCapitalExposureInr = initialCashRequirementInr;
      }

      const leadTime = obs.lead_time_days ?? 7;
      const dwell = obs.warehouse_dwell_days ?? 14;
      const settlement = obs.settlement_delay_days ?? 14;
      const terms = obs.payment_terms_days ?? 0;
      cccDays = Math.max(1, leadTime + dwell + settlement - terms);

      if (netContributionInr <= 0) {
        failedChecks.push('NEGATIVE_NET_CONTRIBUTION');
        bindingConstraints.push(`Negative net contribution: ₹${netContributionInr.toFixed(2)} (${contributionMarginBps} bps)`);
      } else if (contributionMarginBps < POLICY_MIN_MARGIN_BPS) {
        failedChecks.push('NET_CONTRIBUTION_BELOW_POLICY_HURDLE');
        bindingConstraints.push(`Policy minimum margin hurdle: ${POLICY_MIN_MARGIN_BPS} bps (10.00%)`);
        bindingConstraints.push(`Observed contribution margin: ${contributionMarginBps} bps (${(contributionMarginBps / 100).toFixed(2)}%)`);
      }
    }

    // Check economic hurdle on gross margin
    if (hasBothPrices && estimatedMarginBps !== null && estimatedMarginBps < POLICY_MIN_MARGIN_BPS) {
      failedChecks.push('GROSS_MARGIN_BELOW_POLICY_HURDLE');
      bindingConstraints.push(`Policy minimum margin hurdle: ${POLICY_MIN_MARGIN_BPS} bps (10.00%)`);
      bindingConstraints.push(`Observed gross margin: ${estimatedMarginBps} bps (${(estimatedMarginBps / 100).toFixed(2)}%)`);
    }

    // Determine deterministic outcome
    let outcome: UnderwritingOutcome;
    if (candidate.active_signals.includes('EVIDENCE_CONFLICT_DETECTED') || candidate.active_signals.includes('EVIDENCE_STALE')) {
      outcome = 'INELIGIBLE';
    } else if (!candidate.evidence_sufficiency.is_sufficient_for_underwriting || missingCostInputs.length > 0) {
      outcome = 'INSUFFICIENT_EVIDENCE';
    } else if (
      netContributionInr !== null &&
      (netContributionInr <= 0 || contributionMarginBps! < POLICY_MIN_MARGIN_BPS)
    ) {
      outcome = 'INELIGIBLE';
    } else if (estimatedMarginBps !== null && estimatedMarginBps < POLICY_MIN_MARGIN_BPS) {
      outcome = 'INELIGIBLE';
    } else if (!candidate.economic_eligibility.is_economically_eligible) {
      outcome = 'INELIGIBLE';
    } else {
      outcome = 'ELIGIBLE';
    }

    const evaluationStatus: EconomicEvaluationStatus =
      outcome === 'ELIGIBLE'
        ? 'EVALUATED_VIABLE'
        : outcome === 'INSUFFICIENT_EVIDENCE'
        ? 'UNEVALUABLE_INPUTS_MISSING'
        : 'EVALUATED_UNATTRACTIVE';

    // Determine actionable guidance to reconsider
    let requiredAction: string | null = null;
    if (outcome === 'INSUFFICIENT_EVIDENCE') {
      const missingEvidence = candidate.evidence_sufficiency.missing_critical_fields;
      const allMissing = [...missingEvidence, ...missingCostInputs];
      requiredAction = `Acquire and verify missing evidence fields: [${allMissing.join(', ')}]`;
    } else if (outcome === 'INELIGIBLE') {
      if (candidate.active_signals.includes('EVIDENCE_CONFLICT_DETECTED')) {
        requiredAction = 'Resolve active cross-source evidence conflict with verified authoritative observation.';
      } else if (candidate.active_signals.includes('EVIDENCE_STALE')) {
        requiredAction = 'Refresh stale observation data with fresh connector retrieval.';
      } else if (netContributionInr !== null && netContributionInr <= 0) {
        requiredAction = `Renegotiate purchase cost or reduce variable expenses: net contribution ₹${netContributionInr.toFixed(2)} is negative.`;
      } else if (contributionMarginBps !== null && contributionMarginBps < POLICY_MIN_MARGIN_BPS) {
        requiredAction = `Negotiate factory gate quote or target higher retail pricing to achieve minimum policy margin hurdle of ${POLICY_MIN_MARGIN_BPS} bps (10.00%).`;
      } else if (estimatedMarginBps !== null && estimatedMarginBps < POLICY_MIN_MARGIN_BPS) {
        requiredAction = `Negotiate factory gate quote or target higher retail pricing to achieve minimum policy margin hurdle of ${POLICY_MIN_MARGIN_BPS} bps (10.00%).`;
      } else {
        requiredAction = 'Address binding constraints and re-evaluate underwriting eligibility.';
      }
    }

    const originClass = candidate.current_observation.origin_class ?? 'RECORDED_GOLDEN_FIXTURE';
    const isLiveMarket = originClass === 'LIVE_VERIFIED_CAPTURE';
    let rating: 'LIVE_VERIFIED_EMPIRICAL' | 'LIVE_EMPIRICAL_CORROBORATED' | 'RECORDED_REFERENCE_FIXTURE' | 'PARTIALLY_CORROBORATED' | 'SYNTHETIC_SCENARIO' | 'UNATTESTED_HOLD';
    let evidencePosture: 'LIVE_VERIFIED_EMPIRICAL' | 'RECORDED_FIXTURE_BASELINE' | 'SYNTHETIC_SCENARIO' | 'UNATTESTED_INTAKE';
    if (originClass === 'SYNTHETIC_SCENARIO') {
      rating = 'SYNTHETIC_SCENARIO';
      evidencePosture = 'SYNTHETIC_SCENARIO';
    } else if (originClass === 'RECORDED_GOLDEN_FIXTURE') {
      rating = 'RECORDED_REFERENCE_FIXTURE';
      evidencePosture = 'RECORDED_FIXTURE_BASELINE';
    } else if (originClass === 'OPERATOR_SIMULATION_ASSUMPTION') {
      rating = 'PARTIALLY_CORROBORATED';
      evidencePosture = 'UNATTESTED_INTAKE';
    } else if (isLiveMarket && candidate.evidence_sufficiency.is_sufficient_for_underwriting) {
      if (candidate.observation_history_count >= 2) {
        rating = 'LIVE_EMPIRICAL_CORROBORATED';
      } else {
        rating = 'LIVE_VERIFIED_EMPIRICAL';
      }
      evidencePosture = 'LIVE_VERIFIED_EMPIRICAL';
    } else if (candidate.evidence_sufficiency.sufficiency_score_bps > 0) {
      rating = 'PARTIALLY_CORROBORATED';
      evidencePosture = isLiveMarket ? 'LIVE_VERIFIED_EMPIRICAL' : 'UNATTESTED_INTAKE';
    } else {
      rating = 'UNATTESTED_HOLD';
      evidencePosture = 'UNATTESTED_INTAKE';
    }

    const isLiveMarketVerified = isLiveMarket && candidate.evidence_sufficiency.is_sufficient_for_underwriting;

    // Calculate conditional annualized RoWC extrapolation
    let annualizedRowcBps: number | null = null;
    let annualizedRowcInterpretation: string;
    let annualizedRowcCaveat: string | undefined;

    if (
      netContributionInr !== null &&
      netContributionInr > 0 &&
      contributionMarginBps !== null &&
      contributionMarginBps > 0 &&
      cccDays !== null &&
      cccDays > 0
    ) {
      annualizedRowcBps = Math.round((contributionMarginBps * 365) / cccDays);
      annualizedRowcInterpretation = 'CONDITIONAL_ANNUALIZED_EXTRAPOLATION_NOT_REALIZED_RETURN';
      annualizedRowcCaveat =
        'Extrapolated velocity metric based on modeled contribution and CCC cycle assumptions; not an expected or realized investment return.';
    } else {
      annualizedRowcBps = null;
      annualizedRowcInterpretation = 'UNAVAILABLE_MISSING_OR_NEGATIVE_CONTRIBUTION';
    }

    // Generate human-readable explanation
    let explanation: string;
    const postureTag = isLiveMarket
      ? '[LIVE_OBSERVATION]'
      : originClass === 'SYNTHETIC_SCENARIO'
      ? '[SYNTHETIC_SIMULATION]'
      : '[RECORDED_FIXTURE_BASELINE]';

    if (outcome === 'ELIGIBLE') {
      const netPart = netContributionInr !== null
        ? `, Net contribution ₹${netContributionInr.toFixed(2)}, Contribution margin ${contributionMarginBps} bps (${((contributionMarginBps ?? 0) / 100).toFixed(2)}%)`
        : '';
      const rowcPart = annualizedRowcBps !== null
        ? ` Annualized RoWC: ${annualizedRowcBps} bps (conditional, annualized extrapolation; not realized return).`
        : '';
      const verifiedLiveNote = isLiveMarket ? ' live market verified' : ' deterministic reference baseline (not live market verification)';
      explanation = `${postureTag} Candidate '${candidate.candidate_name}' satisfies all evidence sufficiency, commercial viability, and policy criteria (${verifiedLiveNote}). Unit economics: Prevailing ASP ₹${asp!.toFixed(2)}, Factory quote ₹${quote!.toFixed(2)}, Gross spread ₹${grossSpread!.toFixed(2)}, Estimated gross margin ${estimatedMarginBps} bps (${((estimatedMarginBps ?? 0) / 100).toFixed(2)}%)${netPart} exceeding policy minimum hurdle of ${POLICY_MIN_MARGIN_BPS} bps (10.00%). Evidence score: ${candidate.evidence_sufficiency.sufficiency_score_bps} bps.${rowcPart}`;
    } else if (outcome === 'INSUFFICIENT_EVIDENCE') {
      const reasons: string[] = [];
      if (candidate.evidence_sufficiency.missing_critical_fields.length > 0) {
        reasons.push(`Missing critical fields: [${candidate.evidence_sufficiency.missing_critical_fields.join(', ')}]`);
      }
      if (missingCostInputs.length > 0) {
        reasons.push(`Missing required cost inputs: [${missingCostInputs.join(', ')}]`);
      }
      explanation = `${postureTag} Candidate '${candidate.candidate_name}' cannot be underwritten due to insufficient verified evidence. ${reasons.join('. ')}. Evidence sufficiency score is ${candidate.evidence_sufficiency.sufficiency_score_bps} bps (requires 10,000 bps).`;
    } else {
      if (candidate.active_signals.includes('EVIDENCE_CONFLICT_DETECTED') || candidate.active_signals.includes('EVIDENCE_STALE')) {
        const active = candidate.active_signals.filter((s) => s === 'EVIDENCE_CONFLICT_DETECTED' || s === 'EVIDENCE_STALE');
        explanation = `${postureTag} Candidate '${candidate.candidate_name}' is ineligible for underwriting due to active unresolved signals: [${active.join(', ')}].`;
      } else if (netContributionInr !== null && (netContributionInr <= 0 || contributionMarginBps! < POLICY_MIN_MARGIN_BPS)) {
        explanation = `${postureTag} Candidate '${candidate.candidate_name}' does not meet minimum policy economic threshold. Unit economics: Prevailing ASP ₹${asp?.toFixed(2) ?? 'N/A'}, Factory quote ₹${quote?.toFixed(2) ?? 'N/A'}, Gross spread ₹${grossSpread?.toFixed(2) ?? 'N/A'}, Net contribution ₹${netContributionInr.toFixed(2)}, Contribution margin ${contributionMarginBps} bps (${((contributionMarginBps ?? 0) / 100).toFixed(2)}%) is below policy minimum hurdle of ${POLICY_MIN_MARGIN_BPS} bps (10.00%).`;
      } else {
        explanation = `${postureTag} Candidate '${candidate.candidate_name}' does not meet minimum policy economic threshold. Unit economics: Prevailing ASP ₹${asp?.toFixed(2) ?? 'N/A'}, Factory quote ₹${quote?.toFixed(2) ?? 'N/A'}, Gross spread ₹${grossSpread?.toFixed(2) ?? 'N/A'}, Estimated gross margin ${estimatedMarginBps} bps (${((estimatedMarginBps ?? 0) / 100).toFixed(2)}%) is below policy minimum hurdle of ${POLICY_MIN_MARGIN_BPS} bps (10.00%).`;
      }
    }

    const evidenceConfidence = {
      evidence_posture: evidencePosture,
      evidence_quality_rating: rating,
      primary_origin_class: originClass,
      source_connector_id: candidate.current_observation.source_connector_id,
      observed_at_utc: candidate.current_observation.observed_at_utc,
      is_live_market_verified: isLiveMarketVerified,
      has_logistics_route: !!candidate.evidence_sufficiency.has_logistics_route,
      has_regulatory_clearance: !!candidate.evidence_sufficiency.has_regulatory_clearance
    };

    // Determine capital allocation decision distinctly from commercial underwriting
    let capitalAllocationDecision: CapitalAllocationDecision;
    let budgetAllocationNotes: string | undefined;

    if (outcome !== 'ELIGIBLE' || originClass === 'SYNTHETIC_SCENARIO') {
      capitalAllocationDecision = 'DO_NOT_ALLOCATE_CAPITAL';
      if (originClass === 'SYNTHETIC_SCENARIO') {
        budgetAllocationNotes = 'Synthetic scenario evidence cannot authorize capital allocation.';
      } else {
        budgetAllocationNotes = 'Candidate is commercially ineligible; capital allocation denied.';
      }
    } else {
      // Commercial eligibility established: check explicit paper budget configuration
      const budgetConfig = options?.budgetConfig;
      if (
        !budgetConfig ||
        typeof budgetConfig.available_paper_capital_inr !== 'number' ||
        budgetConfig.available_paper_capital_inr <= 0
      ) {
        capitalAllocationDecision = 'NOT_AUTHORIZED_BUDGET_UNCONFIGURED';
        budgetAllocationNotes =
          'Commercial eligibility established; paper capital allocation unconfigured (available_paper_capital_inr required).';
      } else {
        const requiredOutlay = initialCashRequirementInr ?? 0;
        if (requiredOutlay > budgetConfig.available_paper_capital_inr) {
          capitalAllocationDecision = 'NOT_AUTHORIZED_BUDGET_EXCEEDED';
          budgetAllocationNotes = `Initial cash requirement ₹${requiredOutlay.toFixed(2)} exceeds available paper budget of ₹${budgetConfig.available_paper_capital_inr.toFixed(2)}.`;
          failedChecks.push('PAPER_BUDGET_EXCEEDED');
          bindingConstraints.push(
            `Required batch outlay ₹${requiredOutlay.toFixed(2)} exceeds configured budget ₹${budgetConfig.available_paper_capital_inr.toFixed(2)}`
          );
        } else if (
          budgetConfig.max_single_allocation_inr &&
          requiredOutlay > budgetConfig.max_single_allocation_inr
        ) {
          capitalAllocationDecision = 'NOT_AUTHORIZED_BUDGET_EXCEEDED';
          budgetAllocationNotes = `Initial cash requirement ₹${requiredOutlay.toFixed(2)} exceeds max single allocation limit of ₹${budgetConfig.max_single_allocation_inr.toFixed(2)}.`;
          failedChecks.push('SINGLE_ALLOCATION_LIMIT_EXCEEDED');
          bindingConstraints.push(
            `Required batch outlay ₹${requiredOutlay.toFixed(2)} exceeds single allocation limit ₹${budgetConfig.max_single_allocation_inr.toFixed(2)}`
          );
        } else {
          capitalAllocationDecision = 'ALLOCATE_CAPITAL';
          budgetAllocationNotes = `Batch outlay of ₹${requiredOutlay.toFixed(2)} authorized within paper budget of ₹${budgetConfig.available_paper_capital_inr.toFixed(2)}.`;
        }
      }
    }

    const capitalAllocation = {
      initial_cash_requirement_inr: initialCashRequirementInr,
      working_capital_exposure_inr: workingCapitalExposureInr,
      unit_batch_moq: moq,
      recommended_batch_quantity: moq,
      cash_conversion_cycle_days: cccDays,
      annualized_rowc_bps: annualizedRowcBps,
      annualized_rowc_extrapolation_bps: annualizedRowcBps,
      annualized_rowc_interpretation: annualizedRowcInterpretation,
      annualized_rowc_caveat: annualizedRowcCaveat,
      break_even_price_inr: totalDeductionsInr,
      capital_allocation_decision: capitalAllocationDecision,
      budget_allocation_notes: budgetAllocationNotes
    };

    const decisionId = `UWD-${sha256(candidateId + evaluatedAtUtc).slice(0, 16).toUpperCase()}`;

    const decisionPayload = {
      decision_id: decisionId,
      candidate_id: candidate.candidate_id,
      canonical_product_id: candidate.canonical_product_id,
      candidate_name: candidate.candidate_name,
      category,
      outcome,
      lifecycle_state: candidate.lifecycle_state,
      evaluation_status: evaluationStatus,
      unit_economics: {
        prevailing_retail_asp_inr: asp,
        factory_gate_quote_inr: quote,
        gross_spread_inr: grossSpread,
        estimated_margin_bps: estimatedMarginBps,
        policy_min_margin_bps: POLICY_MIN_MARGIN_BPS,
        calculation_method: candidate.economic_eligibility.economic_model_applied || 'PHYSICAL_ARBITRAGE_NET_SPREAD_V1',
        net_contribution_inr: netContributionInr,
        contribution_margin_bps: contributionMarginBps,
        contribution_margin_denominator: 'RETAIL_SELLING_PRICE' as const,
        initial_cash_requirement_inr: initialCashRequirementInr,
        working_capital_exposure_inr: workingCapitalExposureInr,
        cash_conversion_cycle_days: cccDays,
        annualized_return_on_working_capital_bps: annualizedRowcBps,
        annualized_rowc_interpretation: annualizedRowcInterpretation,
        annualized_rowc_caveat: annualizedRowcCaveat,
        unit_batch_moq: moq,
        purchase_quantity: moq,
        applicable_cost_categories: standardCategories,
        cost_category_assessments: Object.freeze(costAssessments),
        cost_breakdown: {
          supplier_purchase_cost_inr: quote,
          inbound_freight_inr: freightAmount > 0 ? freightAmount : (costAssessments.find(a => a.category === 'INBOUND_FREIGHT')?.treatment === 'KNOWN_ZERO' ? 0 : null),
          packaging_kitting_inr: packagingAmount > 0 ? packagingAmount : (costAssessments.find(a => a.category === 'PACKAGING_KITTING')?.treatment === 'KNOWN_ZERO' ? 0 : null),
          marketplace_fees_inr: feesAmount > 0 ? feesAmount : (costAssessments.find(a => a.category === 'MARKETPLACE_FEES')?.treatment === 'KNOWN_ZERO' ? 0 : null),
          statutory_tax_inr: taxAmount > 0 ? taxAmount : (costAssessments.find(a => a.category === 'STATUTORY_TAX')?.treatment === 'KNOWN_ZERO' ? 0 : null),
          return_defect_drag_inr: returnAmount > 0 ? returnAmount : (costAssessments.find(a => a.category === 'RETURN_DEFECT_DRAG')?.treatment === 'KNOWN_ZERO' ? 0 : null),
          non_supplier_variable_costs_inr: nonSupplierVariableCostsInr,
          total_variable_deductions_inr: totalDeductionsInr,
          cost_exclusions: Object.freeze(recordedExclusions),
          cost_assessments: Object.freeze(costAssessments)
        },
        missing_cost_inputs: Object.freeze(missingCostInputs)
      },
      evidence_summary: {
        is_sufficient_for_underwriting: candidate.evidence_sufficiency.is_sufficient_for_underwriting,
        sufficiency_score_bps: candidate.evidence_sufficiency.sufficiency_score_bps,
        missing_critical_fields: candidate.evidence_sufficiency.missing_critical_fields,
        uncorroborated_fields: candidate.evidence_sufficiency.uncorroborated_fields,
        source_connector_id: candidate.current_observation.source_connector_id,
        origin_class: originClass,
        evidence_posture: evidencePosture,
        is_live_market_verified: isLiveMarketVerified,
        observed_at_utc: candidate.current_observation.observed_at_utc
      },
      capital_allocation: capitalAllocation,
      evidence_confidence: evidenceConfidence,
      binding_constraints: Object.freeze(bindingConstraints),
      failed_checks: Object.freeze(failedChecks),
      explanation,
      required_action_to_reconsider: requiredAction,
      evaluated_at_utc: evaluatedAtUtc
    };

    const jcsSha256 = sha256(canonicalizeJCS(decisionPayload));

    return {
      ...decisionPayload,
      jcs_sha256: jcsSha256
    };
  }

  /**
   * Records a collector or network failure.
   * INVARIANT: Collector failure does NOT reject the candidate!
   * Marks observation as EVIDENCE_STALE and sets investigation status to FAILED or AWAITING_HUMAN_REVIEW.
   */
  public async recordObservationFailure(
    candidateId: string,
    errorMessage: string,
    connectorId: string
  ): Promise<OpportunityCandidate> {
    await this.initialize();

    const candidate = await this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`E-OPP-NOT-FOUND: Candidate '${candidateId}' does not exist`);
    }

    const nowUtc = new Date().toISOString();
    const signalsSet = new Set(candidate.active_signals);
    signalsSet.add('EVIDENCE_STALE');

    const updatedData = {
      ...candidate,
      active_signals: Array.from(signalsSet),
      investigation_status: 'FAILED' as const,
      latest_transition_reason: `Connector ${connectorId} failed: ${errorMessage} (candidate preserved; not rejected)`,
      updated_at_utc: nowUtc
    };

    const jcsSha256 = sha256(canonicalizeJCS(updatedData));
    const updatedCandidate: OpportunityCandidate = {
      ...updatedData,
      jcs_sha256: jcsSha256
    };

    await this.persistCandidate(updatedCandidate);

    await this.recordEvent({
      candidateId,
      previousState: candidate.lifecycle_state,
      nextState: candidate.lifecycle_state, // State unchanged!
      signal: 'EVIDENCE_STALE',
      trigger: 'SOURCE_FAULT_DETECTED',
      transitionReason: `Connector failure recorded: ${errorMessage}`,
      timestampUtc: nowUtc
    });

    return updatedCandidate;
  }

  /**
   * Sets the investigation status of a candidate.
   */
  public async updateInvestigationStatus(
    candidateId: string,
    status: InvestigationStatus,
    reason: string
  ): Promise<OpportunityCandidate> {
    await this.initialize();

    const candidate = await this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`E-OPP-NOT-FOUND: Candidate '${candidateId}' does not exist`);
    }

    const nowUtc = new Date().toISOString();
    const updatedData = {
      ...candidate,
      investigation_status: status,
      latest_transition_reason: reason,
      updated_at_utc: nowUtc
    };

    const jcsSha256 = sha256(canonicalizeJCS(updatedData));
    const updatedCandidate: OpportunityCandidate = {
      ...updatedData,
      jcs_sha256: jcsSha256
    };

    await this.persistCandidate(updatedCandidate);
    return updatedCandidate;
  }

  /**
   * Marks a candidate's evidence as stale without modifying its lifecycle state.
   */
  public async markStale(candidateId: string, reason: string): Promise<OpportunityCandidate> {
    await this.initialize();

    const candidate = await this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`E-OPP-NOT-FOUND: Candidate '${candidateId}' does not exist`);
    }

    const nowUtc = new Date().toISOString();
    const signalsSet = new Set(candidate.active_signals);
    signalsSet.add('EVIDENCE_STALE');

    const updatedData = {
      ...candidate,
      active_signals: Array.from(signalsSet),
      latest_transition_reason: reason,
      updated_at_utc: nowUtc
    };

    const jcsSha256 = sha256(canonicalizeJCS(updatedData));
    const updatedCandidate: OpportunityCandidate = {
      ...updatedData,
      jcs_sha256: jcsSha256
    };

    await this.persistCandidate(updatedCandidate);
    return updatedCandidate;
  }

  /**
   * Retrieves a candidate by its stable ID.
   */
  public async getCandidate(candidateId: string): Promise<OpportunityCandidate | null> {
    await this.initialize();

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT candidate_id, strategy_id, canonical_product_id, candidate_name, category,
                  lifecycle_state, active_signals, investigation_status, evidence_sufficiency,
                  commercial_attractiveness, economic_eligibility, current_observation, observation_history_count,
                  latest_transition_reason, first_seen_utc, last_seen_utc, updated_at_utc, jcs_sha256
           FROM market_opportunity_candidates
           WHERE candidate_id = $1`,
          [candidateId]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          const econ = row.economic_eligibility || this.computeEconomicEligibility({
            quote: row.current_observation?.factory_gate_quote_inr ?? null,
            asp: row.current_observation?.prevailing_retail_asp_inr ?? null,
            category: row.category,
            nowUtc: row.updated_at_utc?.toISOString ? row.updated_at_utc.toISOString() : String(row.updated_at_utc),
            applicable_cost_categories: row.current_observation?.applicable_cost_categories,
            cost_category_exclusions: row.current_observation?.cost_category_exclusions,
            inbound_freight_inr: row.current_observation?.inbound_freight_inr,
            packaging_kitting_inr: row.current_observation?.packaging_kitting_inr,
            platform_fee_inr: row.current_observation?.platform_fee_inr ?? row.current_observation?.fulfillment_fee_inr,
            statutory_tax_inr: row.current_observation?.statutory_tax_inr,
            return_defect_drag_inr: row.current_observation?.return_defect_drag_inr
          });
          return {
            candidate_id: row.candidate_id,
            strategy_id: row.strategy_id,
            canonical_product_id: row.canonical_product_id,
            candidate_name: row.candidate_name,
            category: row.category,
            lifecycle_state: row.lifecycle_state as OpportunityLifecycleState,
            active_signals: row.active_signals,
            investigation_status: row.investigation_status as InvestigationStatus,
            evidence_sufficiency: row.evidence_sufficiency,
            commercial_attractiveness: row.commercial_attractiveness,
            economic_eligibility: econ,
            current_observation: row.current_observation,
            observation_history_count: row.observation_history_count,
            latest_transition_reason: row.latest_transition_reason,
            first_seen_utc: row.first_seen_utc.toISOString ? row.first_seen_utc.toISOString() : String(row.first_seen_utc),
            last_seen_utc: row.last_seen_utc.toISOString ? row.last_seen_utc.toISOString() : String(row.last_seen_utc),
            updated_at_utc: row.updated_at_utc.toISOString ? row.updated_at_utc.toISOString() : String(row.updated_at_utc),
            jcs_sha256: row.jcs_sha256
          };
        }
        return null;
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres getCandidate fallback:', err?.message ?? String(err));
      }
    }

    return this.inMemoryCandidates.get(candidateId) ?? null;
  }

  /**
   * Lists all candidates matching an optional filter.
   */
  public async listCandidates(filter?: CandidateFilter): Promise<OpportunityCandidate[]> {
    await this.initialize();

    let list: OpportunityCandidate[] = [];

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT candidate_id, strategy_id, canonical_product_id, candidate_name, category,
                  lifecycle_state, active_signals, investigation_status, evidence_sufficiency,
                  commercial_attractiveness, economic_eligibility, current_observation, observation_history_count,
                  latest_transition_reason, first_seen_utc, last_seen_utc, updated_at_utc, jcs_sha256
           FROM market_opportunity_candidates
           ORDER BY last_seen_utc DESC`
        );
        list = res.rows.map((row) => ({
          candidate_id: row.candidate_id,
          strategy_id: row.strategy_id,
          canonical_product_id: row.canonical_product_id,
          candidate_name: row.candidate_name,
          category: row.category,
          lifecycle_state: row.lifecycle_state as OpportunityLifecycleState,
          active_signals: row.active_signals,
          investigation_status: row.investigation_status as InvestigationStatus,
          evidence_sufficiency: row.evidence_sufficiency,
          commercial_attractiveness: row.commercial_attractiveness,
          economic_eligibility: row.economic_eligibility || this.computeEconomicEligibility({
            quote: row.current_observation?.factory_gate_quote_inr ?? null,
            asp: row.current_observation?.prevailing_retail_asp_inr ?? null,
            category: row.category,
            nowUtc: row.updated_at_utc?.toISOString ? row.updated_at_utc.toISOString() : String(row.updated_at_utc),
            applicable_cost_categories: row.current_observation?.applicable_cost_categories,
            cost_category_exclusions: row.current_observation?.cost_category_exclusions,
            inbound_freight_inr: row.current_observation?.inbound_freight_inr,
            packaging_kitting_inr: row.current_observation?.packaging_kitting_inr,
            platform_fee_inr: row.current_observation?.platform_fee_inr ?? row.current_observation?.fulfillment_fee_inr,
            statutory_tax_inr: row.current_observation?.statutory_tax_inr,
            return_defect_drag_inr: row.current_observation?.return_defect_drag_inr
          }),
          current_observation: row.current_observation,
          observation_history_count: row.observation_history_count,
          latest_transition_reason: row.latest_transition_reason,
          first_seen_utc: row.first_seen_utc.toISOString ? row.first_seen_utc.toISOString() : String(row.first_seen_utc),
          last_seen_utc: row.last_seen_utc.toISOString ? row.last_seen_utc.toISOString() : String(row.last_seen_utc),
          updated_at_utc: row.updated_at_utc.toISOString ? row.updated_at_utc.toISOString() : String(row.updated_at_utc),
          jcs_sha256: row.jcs_sha256
        }));
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres listCandidates fallback:', err?.message ?? String(err));
        list = Array.from(this.inMemoryCandidates.values());
      }
    } else {
      list = Array.from(this.inMemoryCandidates.values());
    }

    if (!filter) return list;

    return list.filter((c) => {
      if (filter.strategy_id && c.strategy_id !== filter.strategy_id) return false;
      if (filter.category && c.category !== filter.category) return false;
      if (filter.lifecycle_state && c.lifecycle_state !== filter.lifecycle_state) return false;
      if (filter.investigation_status && c.investigation_status !== filter.investigation_status) return false;
      if (filter.is_sufficient_for_underwriting !== undefined && c.evidence_sufficiency.is_sufficient_for_underwriting !== filter.is_sufficient_for_underwriting) return false;
      return true;
    });
  }

  /**
   * Retrieves all candidates currently in memory.
   */
  public getInMemoryCandidates(): OpportunityCandidate[] {
    return Array.from(this.inMemoryCandidates.values());
  }

  /**
   * Retrieves the Merkle-chained event history for a candidate.
   */
  public async getEventHistory(candidateId: string): Promise<CandidateLifecycleEvent[]> {
    await this.initialize();

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT event_id, candidate_id, previous_state, next_state, signal, trigger,
                  operator_id, transition_reason, previous_event_hash, event_hash, timestamp_utc
           FROM market_candidate_lifecycle_events
           WHERE candidate_id = $1
           ORDER BY timestamp_utc ASC`,
          [candidateId]
        );
        return res.rows.map((row) => ({
          event_id: row.event_id,
          candidate_id: row.candidate_id,
          previous_state: row.previous_state as OpportunityLifecycleState,
          next_state: row.next_state as OpportunityLifecycleState,
          signal: row.signal as ObservationChangeSignal,
          trigger: row.trigger as LifecycleTrigger,
          operator_id: row.operator_id ?? undefined,
          transition_reason: row.transition_reason,
          previous_event_hash: row.previous_event_hash,
          event_hash: row.event_hash,
          timestamp_utc: row.timestamp_utc.toISOString ? row.timestamp_utc.toISOString() : String(row.timestamp_utc)
        }));
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres getEventHistory fallback:', err?.message ?? String(err));
      }
    }

    return this.inMemoryEvents.get(candidateId) ?? [];
  }

  // ============================================================================
  // 4. PRIVATE HELPERS
  // ============================================================================

  private computeSufficiencyProfile(params: {
    quote: number | null;
    asp: number | null;
    sentiment: string | null;
    hasRoute: boolean;
    hasReg: boolean;
    nowUtc: string;
    category?: OpportunityCategory;
  }): EvidenceSufficiencyProfile {
    const category = params.category || 'PHYSICAL_GOODS';
    const missing: string[] = [];
    const uncorroborated: string[] = [];
    let score = 0;

    const hasQuote = typeof params.quote === 'number' && !isNaN(params.quote) && params.quote > 0;
    const hasAsp = typeof params.asp === 'number' && !isNaN(params.asp) && params.asp > 0;
    const hasReviews = typeof params.sentiment === 'string' && params.sentiment.trim().length > 0;

    if (category === 'SOFTWARE_DIGITAL') {
      // Software / Digital products: direct retail/subscription pricing, reviews/bug reports, SLA/licensing
      if (hasAsp) score += 4000;
      else missing.push('prevailing_retail_asp_inr');

      if (hasReviews) score += 3000;
      else missing.push('review_sentiment_summary');

      if (params.hasReg) score += 3000;
      else uncorroborated.push('statutory_regulatory_clearance');

      const isSufficient = hasAsp && hasReviews && params.hasReg;
      return {
        is_sufficient_for_underwriting: isSufficient,
        sufficiency_score_bps: score,
        has_upstream_quote: hasQuote,
        has_prevailing_asp: hasAsp,
        has_verbatim_reviews: hasReviews,
        has_logistics_route: false, // Not applicable to software
        has_regulatory_clearance: params.hasReg,
        missing_critical_fields: missing,
        uncorroborated_fields: uncorroborated,
        last_evaluated_at_utc: params.nowUtc
      };
    }

    if (category === 'SERVICE_CONTRACT') {
      // Service contracts: billing rate/ASP, client testimonials/reviews, professional accreditation/SLA
      if (hasAsp) score += 4000;
      else missing.push('prevailing_retail_asp_inr');

      if (hasReviews) score += 3000;
      else missing.push('review_sentiment_summary');

      if (params.hasReg) score += 3000;
      else uncorroborated.push('statutory_regulatory_clearance');

      const isSufficient = hasAsp && hasReviews && params.hasReg;
      return {
        is_sufficient_for_underwriting: isSufficient,
        sufficiency_score_bps: score,
        has_upstream_quote: hasQuote,
        has_prevailing_asp: hasAsp,
        has_verbatim_reviews: hasReviews,
        has_logistics_route: false, // Not applicable to services
        has_regulatory_clearance: params.hasReg,
        missing_critical_fields: missing,
        uncorroborated_fields: uncorroborated,
        last_evaluated_at_utc: params.nowUtc
      };
    }

    if (category === 'UNRESOLVED_NOVEL' || (!['PHYSICAL_GOODS', 'B2B_DISTRIBUTION'].includes(category))) {
      // Unresolved novel or unclassified category
      missing.push('category_classification_required');
      missing.push('commercial_market_boundary_definition');

      return {
        is_sufficient_for_underwriting: false,
        sufficiency_score_bps: 0,
        has_upstream_quote: hasQuote,
        has_prevailing_asp: hasAsp,
        has_verbatim_reviews: hasReviews,
        has_logistics_route: params.hasRoute,
        has_regulatory_clearance: params.hasReg,
        missing_critical_fields: missing,
        uncorroborated_fields: uncorroborated,
        last_evaluated_at_utc: params.nowUtc
      };
    }

    // Default: PHYSICAL_GOODS & B2B_DISTRIBUTION
    if (hasQuote) score += 3000;
    else missing.push('factory_gate_quote_inr');

    if (hasAsp) score += 3000;
    else missing.push('prevailing_retail_asp_inr');

    if (hasReviews) score += 2000;
    else missing.push('review_sentiment_summary');

    if (params.hasRoute) score += 1000;
    else uncorroborated.push('logistics_freight_corridor');

    if (params.hasReg) score += 1000;
    else uncorroborated.push('statutory_hsn_gst_rate');

    const isSufficient = hasQuote && hasAsp && hasReviews && params.hasRoute && params.hasReg;

    return {
      is_sufficient_for_underwriting: isSufficient,
      sufficiency_score_bps: score,
      has_upstream_quote: hasQuote,
      has_prevailing_asp: hasAsp,
      has_verbatim_reviews: hasReviews,
      has_logistics_route: params.hasRoute,
      has_regulatory_clearance: params.hasReg,
      missing_critical_fields: missing,
      uncorroborated_fields: uncorroborated,
      last_evaluated_at_utc: params.nowUtc
    };
  }

  private computeCommercialAttractiveness(
    quote: number | null,
    asp: number | null,
    category?: OpportunityCategory
  ): CommercialAttractivenessEstimate {
    const cat = category || 'PHYSICAL_GOODS';

    if (cat === 'UNRESOLVED_NOVEL') {
      return {
        estimated_gross_spread_inr: null,
        estimated_gross_margin_bps: null,
        attractiveness_rating: 'UNKNOWN',
        heuristic_rationale: 'Novel commercial category unclassified; commercial market boundaries undefined.',
        calculation_epistemic_class: 'UNATTESTED_INTAKE'
      };
    }

    if (cat === 'SOFTWARE_DIGITAL' || cat === 'SERVICE_CONTRACT') {
      if (quote !== null && asp !== null && quote > 0 && asp > 0) {
        const spread = Number((asp - quote).toFixed(2));
        const marginBps = Math.round((spread / asp) * 10000);
        let rating: CommercialAttractivenessEstimate['attractiveness_rating'] = 'MODERATE';
        if (marginBps >= 6000) rating = 'VERY_HIGH';
        else if (marginBps >= 4000) rating = 'HIGH';
        else if (marginBps >= 2000) rating = 'MODERATE';
        else if (marginBps >= 0) rating = 'LOW';
        else rating = 'NEGATIVE';

        return {
          estimated_gross_spread_inr: spread,
          estimated_gross_margin_bps: marginBps,
          attractiveness_rating: rating,
          heuristic_rationale: `Gross spread is ₹${spread.toFixed(2)} (${(marginBps / 100).toFixed(2)}% gross margin).`,
          calculation_epistemic_class: 'ESTIMATED_PROXY'
        };
      }

      if (asp === null || asp <= 0) {
        return {
          estimated_gross_spread_inr: null,
          estimated_gross_margin_bps: null,
          attractiveness_rating: 'UNKNOWN',
          heuristic_rationale: 'Missing retail price/subscription rate; spread cannot be computed.',
          calculation_epistemic_class: 'UNATTESTED_INTAKE'
        };
      }

      // asp is known, quote is null: no quote fabrication
      return {
        estimated_gross_spread_inr: null,
        estimated_gross_margin_bps: null,
        attractiveness_rating: 'UNKNOWN',
        heuristic_rationale: 'Missing direct delivery/infrastructure cost; gross spread cannot be fabricated.',
        calculation_epistemic_class: 'UNATTESTED_INTAKE'
      };
    }

    // Default: PHYSICAL_GOODS, B2B_DISTRIBUTION
    if (quote === null || asp === null || quote <= 0 || asp <= 0) {
      return {
        estimated_gross_spread_inr: null,
        estimated_gross_margin_bps: null,
        attractiveness_rating: 'UNKNOWN',
        heuristic_rationale: 'Missing factory gate quote or prevailing retail ASP; spread cannot be computed.',
        calculation_epistemic_class: 'UNATTESTED_INTAKE'
      };
    }

    const spread = Number((asp - quote).toFixed(2));
    const marginBps = Math.round((spread / asp) * 10000);

    let rating: CommercialAttractivenessEstimate['attractiveness_rating'] = 'MODERATE';
    if (marginBps >= 6000) rating = 'VERY_HIGH';
    else if (marginBps >= 4000) rating = 'HIGH';
    else if (marginBps >= 2000) rating = 'MODERATE';
    else if (marginBps >= 0) rating = 'LOW';
    else rating = 'NEGATIVE';

    return {
      estimated_gross_spread_inr: spread,
      estimated_gross_margin_bps: marginBps,
      attractiveness_rating: rating,
      heuristic_rationale: `Gross spread is ₹${spread.toFixed(2)} (${(marginBps / 100).toFixed(2)}% gross margin).`,
      calculation_epistemic_class: 'ESTIMATED_PROXY'
    };
  }

  private computeEconomicEligibility(params: {
    quote: number | null;
    asp: number | null;
    category?: OpportunityCategory;
    nowUtc: string;
    applicable_cost_categories?: readonly ApplicableCostCategory[];
    cost_category_exclusions?: readonly CostCategoryExclusion[];
    inbound_freight_inr?: number | null;
    packaging_kitting_inr?: number | null;
    platform_fee_inr?: number | null;
    statutory_tax_inr?: number | null;
    return_defect_drag_inr?: number | null;
  }): EconomicEligibilityProfile {
    const cat = params.category || 'PHYSICAL_GOODS';
    const hasQuote = typeof params.quote === 'number' && !isNaN(params.quote) && params.quote > 0;
    const hasAsp = typeof params.asp === 'number' && !isNaN(params.asp) && params.asp > 0;

    if (cat === 'UNRESOLVED_NOVEL' || (!['PHYSICAL_GOODS', 'SOFTWARE_DIGITAL', 'SERVICE_CONTRACT', 'B2B_DISTRIBUTION'].includes(cat))) {
      return {
        is_economically_eligible: false,
        evaluation_status: 'UNEVALUABLE_UNCLASSIFIED',
        missing_economic_inputs: Object.freeze(['category_economic_model_unspecified', 'unit_cost_and_revenue_metrics']),
        economic_model_applied: 'UNCLASSIFIED_CATEGORY_MODEL_V1',
        policy_min_margin_bps: POLICY_MIN_MARGIN_BPS,
        estimated_margin_bps: null,
        policy_evaluation_notes: `Category '${cat}' has no formal economic margin model registered; commercial feasibility cannot be evaluated without category-specific model.`,
        last_evaluated_at_utc: params.nowUtc
      };
    }

    if (cat === 'SOFTWARE_DIGITAL') {
      const missing: string[] = [];
      if (!hasAsp) missing.push('prevailing_retail_asp_inr');
      if (!hasQuote) missing.push('infrastructure_or_delivery_cost_inr');

      if (missing.length > 0) {
        return {
          is_economically_eligible: false,
          evaluation_status: 'UNEVALUABLE_INPUTS_MISSING',
          missing_economic_inputs: Object.freeze(missing),
          economic_model_applied: 'SOFTWARE_SUBSCRIPTION_MARGIN_V1',
          policy_min_margin_bps: POLICY_MIN_MARGIN_BPS,
          estimated_margin_bps: null,
          policy_evaluation_notes: `Missing software economic inputs [${missing.join(', ')}]; subscription gross margin cannot be evaluated without direct delivery/hosting cost.`,
          last_evaluated_at_utc: params.nowUtc
        };
      }

      const spread = Number((params.asp! - params.quote!).toFixed(2));
      const marginBps = Math.round((spread / params.asp!) * 10000);
      const isViable = marginBps >= POLICY_MIN_MARGIN_BPS;

      return {
        is_economically_eligible: isViable,
        evaluation_status: isViable ? 'EVALUATED_VIABLE' : 'EVALUATED_UNATTRACTIVE',
        missing_economic_inputs: Object.freeze([]),
        economic_model_applied: 'SOFTWARE_SUBSCRIPTION_MARGIN_V1',
        policy_min_margin_bps: POLICY_MIN_MARGIN_BPS,
        estimated_margin_bps: marginBps,
        policy_evaluation_notes: isViable
          ? `Estimated subscription margin of ${marginBps} bps (${(marginBps / 100).toFixed(2)}%) satisfies policy threshold (>= ${POLICY_MIN_MARGIN_BPS} bps).`
          : `Estimated subscription margin of ${marginBps} bps (${(marginBps / 100).toFixed(2)}%) is below policy minimum threshold of ${POLICY_MIN_MARGIN_BPS} bps (10.00%).`,
        last_evaluated_at_utc: params.nowUtc
      };
    }

    if (cat === 'SERVICE_CONTRACT') {
      const missing: string[] = [];
      if (!hasAsp) missing.push('client_billing_rate_inr');
      if (!hasQuote) missing.push('direct_labor_fulfillment_cost_inr');

      if (missing.length > 0) {
        return {
          is_economically_eligible: false,
          evaluation_status: 'UNEVALUABLE_INPUTS_MISSING',
          missing_economic_inputs: Object.freeze(missing),
          economic_model_applied: 'SERVICE_CONTRACT_FULFILLMENT_V1',
          policy_min_margin_bps: POLICY_MIN_MARGIN_BPS,
          estimated_margin_bps: null,
          policy_evaluation_notes: `Missing service contract economic inputs [${missing.join(', ')}]; fulfillment margin cannot be evaluated without labor cost.`,
          last_evaluated_at_utc: params.nowUtc
        };
      }

      const spread = Number((params.asp! - params.quote!).toFixed(2));
      const marginBps = Math.round((spread / params.asp!) * 10000);
      const isViable = marginBps >= POLICY_MIN_MARGIN_BPS;

      return {
        is_economically_eligible: isViable,
        evaluation_status: isViable ? 'EVALUATED_VIABLE' : 'EVALUATED_UNATTRACTIVE',
        missing_economic_inputs: Object.freeze([]),
        economic_model_applied: 'SERVICE_CONTRACT_FULFILLMENT_V1',
        policy_min_margin_bps: POLICY_MIN_MARGIN_BPS,
        estimated_margin_bps: marginBps,
        policy_evaluation_notes: isViable
          ? `Estimated service contract gross margin of ${marginBps} bps (${(marginBps / 100).toFixed(2)}%) satisfies policy threshold (>= ${POLICY_MIN_MARGIN_BPS} bps).`
          : `Estimated service contract margin of ${marginBps} bps (${(marginBps / 100).toFixed(2)}%) is below policy minimum threshold of ${POLICY_MIN_MARGIN_BPS} bps (10.00%).`,
        last_evaluated_at_utc: params.nowUtc
      };
    }

    // Default: PHYSICAL_GOODS, B2B_DISTRIBUTION
    const missing: string[] = [];
    if (!hasQuote) missing.push('factory_gate_quote_inr');
    if (!hasAsp) missing.push('prevailing_retail_asp_inr');

    const hasDeclaredCostModel =
      (params.applicable_cost_categories !== undefined && params.applicable_cost_categories.length > 0) ||
      (params.cost_category_exclusions !== undefined && params.cost_category_exclusions.length > 0) ||
      (typeof params.inbound_freight_inr === 'number' && !isNaN(params.inbound_freight_inr)) ||
      (typeof params.packaging_kitting_inr === 'number' && !isNaN(params.packaging_kitting_inr)) ||
      (typeof params.platform_fee_inr === 'number' && !isNaN(params.platform_fee_inr)) ||
      (typeof params.statutory_tax_inr === 'number' && !isNaN(params.statutory_tax_inr)) ||
      (typeof params.return_defect_drag_inr === 'number' && !isNaN(params.return_defect_drag_inr));

    if (hasDeclaredCostModel) {
      const exclusionsMap = new Map<ApplicableCostCategory, string>();
      if (params.cost_category_exclusions && Array.isArray(params.cost_category_exclusions)) {
        for (const ex of params.cost_category_exclusions) {
          if (typeof ex?.category === 'string' && typeof ex?.exclusion_basis === 'string' && ex.exclusion_basis.trim().length >= 10) {
            exclusionsMap.set(ex.category, ex.exclusion_basis.trim());
          }
        }
      }

      const standardCategories: readonly ApplicableCostCategory[] = [
        'SUPPLIER_PURCHASE',
        'INBOUND_FREIGHT',
        'PACKAGING_KITTING',
        'MARKETPLACE_FEES',
        'STATUTORY_TAX',
        'RETURN_DEFECT_DRAG'
      ];

      for (const cat of standardCategories) {
        if (cat === 'SUPPLIER_PURCHASE') {
          if (!hasQuote) {
            if (!missing.includes('SUPPLIER_PURCHASE')) missing.push('SUPPLIER_PURCHASE');
          }
        } else {
          const rawVal =
            cat === 'INBOUND_FREIGHT'
              ? params.inbound_freight_inr
              : cat === 'PACKAGING_KITTING'
              ? params.packaging_kitting_inr
              : cat === 'MARKETPLACE_FEES'
              ? params.platform_fee_inr
              : cat === 'STATUTORY_TAX'
              ? params.statutory_tax_inr
              : params.return_defect_drag_inr;

          if (exclusionsMap.has(cat)) {
            // Explicitly not applicable with substantive basis (>= 10 chars)
            continue;
          } else if (typeof rawVal === 'number' && !isNaN(rawVal) && rawVal >= 0) {
            // Known value or known zero
            continue;
          } else {
            missing.push(cat);
          }
        }
      }

      if (missing.length > 0) {
        return {
          is_economically_eligible: false,
          evaluation_status: 'UNEVALUABLE_INPUTS_MISSING',
          missing_economic_inputs: Object.freeze(missing),
          economic_model_applied: 'PHYSICAL_ARBITRAGE_NET_SPREAD_V1',
          policy_min_margin_bps: POLICY_MIN_MARGIN_BPS,
          estimated_margin_bps: null,
          policy_evaluation_notes: `Missing physical arbitrage economic inputs [${missing.join(', ')}]; economic eligibility cannot be evaluated without all mandatory declared cost inputs or substantive exclusion basis.`,
          last_evaluated_at_utc: params.nowUtc
        };
      }

      // Precise integer subunit calculations
      const SCALE = 10000n;
      const toSub = (v: number) => BigInt(Math.round(v * 10000));
      const fromSub = (s: bigint) => {
        const isNeg = s < 0n;
        const absS = isNeg ? -s : s;
        const whole = absS / SCALE;
        const frac = absS % SCALE;
        const num = Number(whole) + Number(frac) / 10000;
        return isNeg ? -num : num;
      };

      const quoteSub = toSub(params.quote!);
      const freightSub = exclusionsMap.has('INBOUND_FREIGHT') ? 0n : (typeof params.inbound_freight_inr === 'number' ? toSub(params.inbound_freight_inr) : 0n);
      const packSub = exclusionsMap.has('PACKAGING_KITTING') ? 0n : (typeof params.packaging_kitting_inr === 'number' ? toSub(params.packaging_kitting_inr) : 0n);
      const feeSub = exclusionsMap.has('MARKETPLACE_FEES') ? 0n : (typeof params.platform_fee_inr === 'number' ? toSub(params.platform_fee_inr) : 0n);
      const taxSub = exclusionsMap.has('STATUTORY_TAX') ? 0n : (typeof params.statutory_tax_inr === 'number' ? toSub(params.statutory_tax_inr) : 0n);
      const dragSub = exclusionsMap.has('RETURN_DEFECT_DRAG') ? 0n : (typeof params.return_defect_drag_inr === 'number' ? toSub(params.return_defect_drag_inr) : 0n);

      const totalDeductionsSub = quoteSub + freightSub + packSub + feeSub + taxSub + dragSub;
      const aspSub = toSub(params.asp!);
      const netContributionSub = aspSub - totalDeductionsSub;
      const netContributionInr = fromSub(netContributionSub);
      const contributionMarginBps = Math.round((Number(netContributionSub) / Number(aspSub)) * 10000);

      const isViable = netContributionInr > 0 && contributionMarginBps >= POLICY_MIN_MARGIN_BPS;

      return {
        is_economically_eligible: isViable,
        evaluation_status: isViable ? 'EVALUATED_VIABLE' : 'EVALUATED_UNATTRACTIVE',
        missing_economic_inputs: Object.freeze([]),
        economic_model_applied: 'PHYSICAL_ARBITRAGE_NET_SPREAD_V1',
        policy_min_margin_bps: POLICY_MIN_MARGIN_BPS,
        estimated_margin_bps: contributionMarginBps,
        policy_evaluation_notes: isViable
          ? `Estimated physical net contribution of ₹${netContributionInr.toFixed(2)} (${contributionMarginBps} bps) satisfies policy threshold (>= ${POLICY_MIN_MARGIN_BPS} bps).`
          : `Estimated physical net contribution of ₹${netContributionInr.toFixed(2)} (${contributionMarginBps} bps) is below policy minimum threshold of ${POLICY_MIN_MARGIN_BPS} bps (10.00%).`,
        last_evaluated_at_utc: params.nowUtc
      };
    }

    if (missing.length > 0) {
      return {
        is_economically_eligible: false,
        evaluation_status: 'UNEVALUABLE_INPUTS_MISSING',
        missing_economic_inputs: Object.freeze(missing),
        economic_model_applied: 'PHYSICAL_ARBITRAGE_NET_SPREAD_V1',
        policy_min_margin_bps: POLICY_MIN_MARGIN_BPS,
        estimated_margin_bps: null,
        policy_evaluation_notes: `Missing physical arbitrage economic inputs [${missing.join(', ')}]; economic eligibility cannot be evaluated without factory gate quote and prevailing retail ASP.`,
        last_evaluated_at_utc: params.nowUtc
      };
    }

    const spread = Number((params.asp! - params.quote!).toFixed(2));
    const marginBps = Math.round((spread / params.asp!) * 10000);
    const isViable = marginBps >= POLICY_MIN_MARGIN_BPS;

    return {
      is_economically_eligible: isViable,
      evaluation_status: isViable ? 'EVALUATED_VIABLE' : 'EVALUATED_UNATTRACTIVE',
      missing_economic_inputs: Object.freeze([]),
      economic_model_applied: 'PHYSICAL_ARBITRAGE_NET_SPREAD_V1',
      policy_min_margin_bps: POLICY_MIN_MARGIN_BPS,
      estimated_margin_bps: marginBps,
      policy_evaluation_notes: isViable
        ? `Estimated physical gross margin of ${marginBps} bps (${(marginBps / 100).toFixed(2)}%) satisfies policy threshold (>= ${POLICY_MIN_MARGIN_BPS} bps).`
        : `Estimated physical gross margin of ${marginBps} bps (${(marginBps / 100).toFixed(2)}%) is below policy minimum threshold of ${POLICY_MIN_MARGIN_BPS} bps (10.00%).`,
      last_evaluated_at_utc: params.nowUtc
    };
  }

  private async persistCandidate(candidate: OpportunityCandidate): Promise<void> {
    this.inMemoryCandidates.set(candidate.candidate_id, candidate);

    if (this.pgPool) {
      try {
        await this.pgPool.query(
          `INSERT INTO market_opportunity_candidates (
            candidate_id, strategy_id, canonical_product_id, candidate_name, category,
            lifecycle_state, active_signals, investigation_status, evidence_sufficiency,
            commercial_attractiveness, economic_eligibility, current_observation, observation_history_count,
            latest_transition_reason, first_seen_utc, last_seen_utc, updated_at_utc, jcs_sha256
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (candidate_id) DO UPDATE SET
            candidate_name = EXCLUDED.candidate_name,
            category = EXCLUDED.category,
            lifecycle_state = EXCLUDED.lifecycle_state,
            active_signals = EXCLUDED.active_signals,
            investigation_status = EXCLUDED.investigation_status,
            evidence_sufficiency = EXCLUDED.evidence_sufficiency,
            commercial_attractiveness = EXCLUDED.commercial_attractiveness,
            economic_eligibility = EXCLUDED.economic_eligibility,
            current_observation = EXCLUDED.current_observation,
            observation_history_count = EXCLUDED.observation_history_count,
            latest_transition_reason = EXCLUDED.latest_transition_reason,
            last_seen_utc = EXCLUDED.last_seen_utc,
            updated_at_utc = EXCLUDED.updated_at_utc,
            jcs_sha256 = EXCLUDED.jcs_sha256`,
          [
            candidate.candidate_id,
            candidate.strategy_id,
            candidate.canonical_product_id,
            candidate.candidate_name,
            candidate.category ?? null,
            candidate.lifecycle_state,
            JSON.stringify(candidate.active_signals),
            candidate.investigation_status,
            JSON.stringify(candidate.evidence_sufficiency),
            JSON.stringify(candidate.commercial_attractiveness),
            JSON.stringify(candidate.economic_eligibility),
            JSON.stringify(candidate.current_observation),
            candidate.observation_history_count,
            candidate.latest_transition_reason,
            candidate.first_seen_utc,
            candidate.last_seen_utc,
            candidate.updated_at_utc,
            candidate.jcs_sha256
          ]
        );
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres persistCandidate warning:', err?.message ?? String(err));
      }
    }
  }

  private async recordEvent(params: {
    candidateId: string;
    previousState: OpportunityLifecycleState;
    nextState: OpportunityLifecycleState;
    signal: ObservationChangeSignal;
    trigger: LifecycleTrigger;
    operatorId?: string;
    transitionReason: string;
    timestampUtc: string;
  }): Promise<CandidateLifecycleEvent> {
    const existingEvents = await this.getEventHistory(params.candidateId);
    const lastEvent = existingEvents.length > 0 ? existingEvents[existingEvents.length - 1] : null;
    const prevHash = lastEvent ? lastEvent.event_hash : '0000000000000000000000000000000000000000000000000000000000000000';

    const eventId = `EVT-${sha256(params.candidateId + params.timestampUtc + existingEvents.length).slice(0, 12).toUpperCase()}`;
    const payloadForHash = {
      event_id: eventId,
      candidate_id: params.candidateId,
      previous_state: params.previousState,
      next_state: params.nextState,
      signal: params.signal,
      trigger: params.trigger,
      operator_id: params.operatorId ?? null,
      transition_reason: params.transitionReason,
      previous_event_hash: prevHash,
      timestamp_utc: params.timestampUtc
    };

    const eventHash = sha256(canonicalizeJCS(payloadForHash));
    const event: CandidateLifecycleEvent = {
      ...payloadForHash,
      operator_id: params.operatorId,
      event_hash: eventHash
    };

    // Store in-memory
    const memList = this.inMemoryEvents.get(params.candidateId) ?? [];
    memList.push(event);
    this.inMemoryEvents.set(params.candidateId, memList);

    // Persist to Postgres
    if (this.pgPool) {
      try {
        await this.pgPool.query(
          `INSERT INTO market_candidate_lifecycle_events (
            event_id, candidate_id, previous_state, next_state, signal,
            trigger, operator_id, transition_reason, previous_event_hash,
            event_hash, timestamp_utc
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (event_id) DO NOTHING`,
          [
            event.event_id,
            event.candidate_id,
            event.previous_state,
            event.next_state,
            event.signal,
            event.trigger,
            event.operator_id ?? null,
            event.transition_reason,
            event.previous_event_hash,
            event.event_hash,
            event.timestamp_utc
          ]
        );
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres recordEvent warning:', err?.message ?? String(err));
      }
    }

    return event;
  }
}
