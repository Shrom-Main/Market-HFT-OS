/**
/**
 * POC-001: Agent Reasoning & Execution Quality Contracts
 *
 * Implements data structures, inspectable decision records, epistemic taxonomy,
 * execution state, and resource budget profiles for adaptive, bounded, evidence-aware
 * investigation agents.
 *
 * Architectural Invariants:
 * 1. Structured Inspectability: Stores structured decision records (question, evidence observed,
 *    selected action, rationale, stopping criteria), NOT private chain-of-thought bloat.
 * 2. Epistemic Separation: Strictly distinguishes OBSERVED_FACT, PRIMARY_REGISTRY,
 *    DIRECTORY_CLAIM, INDEPENDENT_CORROBORATION, INFERENCE, ANALOGY, and UNVERIFIED_HYPOTHESIS.
 * 3. Non-Promotion Invariant: Hypotheses and unverified claims are NEVER silently promoted to facts
 *    or validated memory.
 * 4. Bounded Execution: Explicit configurable resource bounds (iterations, tool calls, delegation depth,
 *    circuit breakers, wall-clock timeout) with early termination and escalation.
 * 5. Deterministic Non-Float Math: All financial values use integer cents/paise or BigInt subunits.
 */

import { OpportunityCategory } from '../../canonical/opportunityCategory.js';

// ============================================================================
// 1. EPISTEMIC TAXONOMY & EVIDENCE CONTRACTS
// ============================================================================

export type EpistemicClassification =
  | 'OBSERVED_FACT'              // Direct physical observation, cryptographically signed record, primary measurement
  | 'PRIMARY_REGISTRY'           // Official statutory/regulatory registry (MCA, GSTN, Patent/Trademark Office)
  | 'DIRECTORY_CLAIM'            // Supplier-declared listing, B2B marketplace portal, unverified catalog
  | 'INDEPENDENT_CORROBORATION'  // Corroborated by 2+ genuinely independent, un-syndicated sources
  | 'INFERENCE'                  // Logical deduction derived from verified facts
  | 'ANALOGY'                    // Structural cross-domain transfer from a validated reference domain
  | 'UNVERIFIED_HYPOTHESIS'      // Speculative assumption or working conjecture
  | 'UNVERIFIED_CLAIM'           // Unverified claim from secondary source or ungrounded capture
  | 'DERIVED_ESTIMATE';          // Model-estimated or derived proxy value

export type FreshnessStatus = 'CURRENT' | 'PROVISIONAL_CACHE' | 'STALE_HISTORICAL';

export type FallbackType =
  | 'TYPE_1_ALTERNATIVE_TRANSPORT'      // Same source, alternative transport/socket protocol
  | 'TYPE_2_DIFFERENT_CONNECTOR_SAME_SOURCE' // Same underlying origin/domain, different connector
  | 'TYPE_2_SAME_SOURCE_RETRIEVAL'      // Same underlying domain/origin, different connector or archive snapshot
  | 'TYPE_3_INDEPENDENT_SOURCE'         // Genuinely distinct independent source provider
  | 'TYPE_4_HISTORICAL_CACHE'           // Historical snapshot / offline cache (stale)
  | 'TYPE_5_PARTIAL_EVIDENCE';          // Reduced-fidelity or partial signal alternative

export interface FallbackProvenance {
  readonly is_offline_snapshot: boolean;
  readonly snapshot_timestamp_utc: string;
  readonly freshness_status: FreshnessStatus;
  readonly original_source_origin: string;
  readonly staleness_age_hours?: number;
  readonly fallback_type?: FallbackType;
  readonly was_fallback?: boolean;
}

export interface StatutoryStatusBreakdown {
  readonly corporate_registration_status: 'ACTIVE' | 'STRUCK_OFF' | 'UNDER_LIQUIDATION' | 'DORMANT' | 'AMALGAMATED';
  readonly gst_registration_status: 'ACTIVE' | 'CANCELLED' | 'SUSPENDED' | 'PROVISIONAL';
  readonly annual_filing_compliance_status: 'COMPLIANT_UP_TO_DATE' | 'DELINQUENT_DEFAULTER' | 'OVERDUE_RETURNS';
  readonly manufacturing_capability_proven: boolean; // Invariant: Always false from statutory registration alone!
}

export interface EconomicComparisonResult {
  readonly valid: boolean;
  readonly defect_type?: 'DIMENSIONAL_UNIT_MISMATCH' | 'UNSUPPORTED_ESTIMATE' | 'NONE';
  readonly explanation: string;
  readonly commodity_benchmark_inr_per_kg?: number;
  readonly component_mass_grams?: number;
  readonly derived_unit_scrap_floor_inr?: number;
  readonly finished_unit_quote_inr?: number;
  readonly margin_ratio?: number;
  readonly epistemic_classification: EpistemicClassification;
}

export interface ObservedEvidenceRecord {
  readonly evidence_id: string;
  readonly source_uri: string;
  readonly source_name: string;
  readonly source_type: string;
  readonly provenance_fingerprint: string;
  readonly syndication_identifiers?: {
    readonly phone?: string;
    readonly email_domain?: string;
    readonly gstin?: string;
    readonly physical_address_hash?: string;
    readonly corporate_cin?: string;
  };
  readonly syndication_cluster_id?: string;
  readonly epistemic_status: EpistemicClassification;
  readonly claims: Record<string, unknown>;
  readonly observed_at_utc: string;
  readonly raw_payload_sha256: string;
  readonly fallback_provenance?: FallbackProvenance;
}

export interface EvidenceConflict {
  readonly conflict_id: string;
  readonly target_field_or_claim: string;
  readonly evidence_a_id: string;
  readonly evidence_a_claim: unknown;
  readonly evidence_b_id: string;
  readonly evidence_b_claim: unknown;
  readonly severity: 'FATAL_DISQUALIFIER' | 'MATERIAL_AMBIGUITY' | 'MINOR_DISCREPANCY';
  readonly status: 'ACTIVE' | 'RESOLVED_SUPERSEDED' | 'ESCALATED_HUMAN_REVIEW';
  readonly resolution_notes?: string;
  readonly recorded_at_utc: string;
}

// ============================================================================
// 2. HYPOTHESIS & INFORMATION GAPS
// ============================================================================

export type HypothesisStatus =
  | 'PROPOSED'
  | 'TESTING'
  | 'SUPPORTED'
  | 'REFUTED'
  | 'SUPERSEDED';

export interface ClaimEvidenceAssessment {
  readonly status: 'SUPPORTED' | 'REFUTED' | 'TESTING';
  readonly confidence_bps: number; // 0 to 10,000 for legacy scoring compatibility
  readonly confidenceBps: number;  // CamelCase alias for backwards compatibility
  readonly independent_origins_count: number;
  readonly highest_source_reliability: string;
  readonly has_direct_observation: boolean;
  readonly has_primary_registry: boolean;
  readonly is_syndicated: boolean;
  readonly active_contradictions_count: number;
  readonly unresolved_uncertainty_reasons: readonly string[];
}

export interface StructuredHypothesis {
  readonly hypothesis_id: string;
  readonly statement: string;
  status: HypothesisStatus;
  readonly supporting_evidence_ids: string[];
  readonly contradicting_evidence_ids: string[];
  confidence_bps: number; // 0 to 10,000 (100.00%)
  assessment?: ClaimEvidenceAssessment;
  last_evaluated_at_utc: string;
}

export type GapPriority = 1 | 2 | 3 | 4 | 5; // 1 = Highest, 5 = Lowest

export interface InformationGap {
  readonly gap_id: string;
  readonly topic_or_field: string;
  readonly priority: GapPriority;
  state: 'UNRESOLVED' | 'IN_PROGRESS' | 'RESOLVED' | 'ABANDONED_UNPRODUCTIVE';
  readonly required_epistemic_level: EpistemicClassification;
  resolved_by_evidence_id?: string;
  reason_abandoned?: string;
}

// ============================================================================
// 3. PLAN & ACTIONS
// ============================================================================

export type PlanStepState =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SKIPPED_OBSOLETE'
  | 'FAILED_RETRIED'
  | 'FAILED_CIRCUIT_BROKEN';

export interface InvestigationPlanStep {
  readonly step_id: string;
  readonly sequence_index: number;
  readonly description: string;
  readonly action_description?: string;
  readonly target_gap_id: string;
  readonly tool_or_specialist: string;
  readonly parameters: Record<string, unknown>;
  state: PlanStepState;
  readonly created_at_utc: string;
  completed_at_utc?: string;
  failure_reason?: string;
}

export interface ReplanRecord {
  readonly replan_id: string;
  readonly trigger_reason:
    | 'CONTRADICTION_DISCOVERED'
    | 'SOURCE_UNPRODUCTIVE'
    | 'NEW_CRITICAL_GAP_SURFACED'
    | 'PATH_OBSOLETE'
    | 'SPECIALIST_RECOMMENDATION'
    | 'RATE_LIMIT_CIRCUIT_BREAK';
  readonly explanation: string;
  readonly previous_plan_version: number;
  readonly new_plan_version: number;
  readonly discarded_step_ids: readonly string[];
  readonly added_step_ids: readonly string[];
  readonly timestamp_utc: string;
}

export interface StructuredDecisionRecord {
  readonly step_index: number;
  readonly question_being_resolved: string;
  readonly evidence_observed_ids: readonly string[];
  readonly action_selected: string;
  readonly action_rationale: string;
  readonly stopping_or_pivoting_criteria: string;
  readonly recorded_at_utc: string;
}

export interface ActionExecutionOutcome {
  readonly action_id: string;
  readonly step_id: string;
  readonly tool_name: string;
  readonly execution_status: 'SUCCESS' | 'TRANSIENT_FAILURE' | 'FATAL_FAILURE' | 'CIRCUIT_BROKEN' | 'TIMEOUT';
  readonly result_summary: string;
  readonly extracted_evidence?: ObservedEvidenceRecord[];
  readonly raw_output?: Record<string, unknown>;
  readonly error_message?: string;
  readonly execution_duration_ms: number;
}

// ============================================================================
// 4. SPECIALIST DELEGATION CONTRACTS
// ============================================================================

export type SpecialistRole =
  | 'SupplySpecialist'
  | 'StatutoryRegistrySpecialist'
  | 'MarketplaceChannelSpecialist'
  | 'LogisticsRouteSpecialist'
  | 'AdversarialAuditorSpecialist';

export interface SpecialistTaskBrief {
  readonly delegation_id: string;
  readonly parent_investigation_id: string;
  readonly target_specialist_role: SpecialistRole;
  readonly sub_question: string;
  readonly context_scope: {
    readonly candidate_id?: string;
    readonly category?: OpportunityCategory;
    readonly target_entity_name?: string;
    readonly relevant_evidence_ids: readonly string[];
    readonly constraints?: readonly string[];
  };
  readonly bounded_context?: Record<string, unknown>;
  readonly expected_artifact_type?: 'FINDINGS' | 'RECONCILIATION';
  readonly max_tool_calls?: number;
  readonly timeout_ms?: number;
}

export interface SpecialistFindingArtifact {
  readonly delegation_id: string;
  readonly specialist_role: SpecialistRole;
  readonly sub_question: string;
  readonly status: 'RESOLVED' | 'UNRESOLVED' | 'CONTRADICTION_FOUND' | 'FINDINGS_RETURNED' | 'BLOCKED_BY_DEPENDENCY';
  readonly key_findings: readonly string[];
  readonly evidence_produced: readonly ObservedEvidenceRecord[];
  readonly detected_conflicts?: readonly EvidenceConflict[];
  readonly epistemic_classification: EpistemicClassification;
  readonly recommended_next_action?: string;
  readonly artifact_sha256: string;
}

// ============================================================================
// 5. RESOURCE CONTROLS & BUDGET
// ============================================================================

export interface InvestigationBudgetConfig {
  readonly max_reasoning_iterations: number;
  readonly max_tool_calls: number;
  readonly max_delegation_depth: number;
  readonly max_concurrent_specialists: number;
  readonly max_retries_per_action: number;
  readonly circuit_breaker_threshold: number; // Consecutive failures before tripping
  readonly wall_clock_timeout_ms: number;
  readonly token_quota?: number;
}

export const DEFAULT_INVESTIGATION_BUDGET: InvestigationBudgetConfig = {
  max_reasoning_iterations: 10,
  max_tool_calls: 15,
  max_delegation_depth: 2,
  max_concurrent_specialists: 2,
  max_retries_per_action: 3,
  circuit_breaker_threshold: 3,
  wall_clock_timeout_ms: 30_000,
  token_quota: 50_000
};

export interface AutonomyClusterBudgetConfig {
  readonly max_investigations_per_day: number;
  readonly hard_max_investigations_per_day: number;
  readonly default_plan_task_limit: number;
  readonly hard_max_tasks_per_investigation: number;
  readonly max_recursive_replans: number;
  readonly max_connector_calls_per_source: number;
  readonly max_compute_cost_usd_cents_per_day: number;
  readonly compute_safety_reserve_multiplier: number;
  readonly max_wall_clock_ms_per_task: number;
}

export const DEFAULT_AUTONOMY_CLUSTER_BUDGET: AutonomyClusterBudgetConfig = {
  max_investigations_per_day: 25,
  hard_max_investigations_per_day: 50,
  default_plan_task_limit: 6,
  hard_max_tasks_per_investigation: 8,
  max_recursive_replans: 3,
  max_connector_calls_per_source: 10,
  max_compute_cost_usd_cents_per_day: 1000, // $10.00
  compute_safety_reserve_multiplier: 1.20,
  max_wall_clock_ms_per_task: 60_000
};

export interface AutonomyDailyLedgerRecord {
  readonly date_utc: string; // YYYY-MM-DD
  investigations_count: number;
  tasks_count: number;
  replans_count: number;
  connector_calls_count: number;
  tokens_consumed: number;
  estimated_compute_cost_usd_cents: number;
  is_halted: boolean;
  halt_reason?: string;
  last_updated_utc: string;
}

export interface ResourceLedger {
  iterations_count: number;
  tool_calls_count: number;
  delegations_count: number;
  retries_count: number;
  tokens_consumed: number;
  wall_clock_start_utc: string;
  wall_clock_elapsed_ms: number;
  circuit_breaker_trips: Record<string, number>;
}

// ============================================================================
// 6. STRUCTURED INVESTIGATION STATE
// ============================================================================

export type InvestigationExecutionState =
  | 'INITIALIZING'
  | 'REASONING_LOOP_ACTIVE'
  | 'PAUSED_CHECKPOINTED'
  | 'AWAITING_VERIFICATION'
  | 'AWAITING_HUMAN_REVIEW'
  | 'COMPLETED_SUCCESS'
  | 'TERMINATED_BUDGET_EXHAUSTED'
  | 'TERMINATED_EARLY_SATISFIED'
  | 'TERMINATED_CONTRADICTION_HALT'
  | 'TERMINATED_FATAL_ERROR';

export interface CheckpointableInvestigationState {
  readonly investigation_id: string;
  readonly candidate_id: string;
  readonly candidate_name: string;
  readonly category: OpportunityCategory;
  readonly primary_objective: string;
  state: InvestigationExecutionState;
  fencing_token: number;
  plan_version: number;
  readonly hypotheses: StructuredHypothesis[];
  readonly information_gaps: InformationGap[];
  readonly plan_steps: InvestigationPlanStep[];
  readonly replan_history: ReplanRecord[];
  readonly decision_records: StructuredDecisionRecord[];
  readonly evidence_records: ObservedEvidenceRecord[];
  readonly conflicts: EvidenceConflict[];
  readonly specialist_artifacts: SpecialistFindingArtifact[];
  readonly retrieved_memory_ids: string[];
  readonly failed_search_paths: string[];
  readonly budget_config: InvestigationBudgetConfig;
  readonly resource_ledger: ResourceLedger;
  readonly created_at_utc: string;
  updated_at_utc: string;
  completed_at_utc?: string;
  final_summary?: string;
}

// ============================================================================
// 7. VERIFICATION CRITIC CONTRACTS
// ============================================================================

export interface VerificationCritiqueResult {
  readonly investigation_id: string;
  readonly approved: boolean;
  readonly rejection_reasons: readonly string[];
  readonly ungrounded_claim_ids: readonly string[];
  readonly unaddressed_conflict_ids: readonly string[];
  readonly missing_mandatory_fields: readonly string[];
  readonly verified_epistemic_ceiling: EpistemicClassification;
  readonly recommended_remedial_actions: readonly string[];
  readonly evaluated_at_utc: string;
}
