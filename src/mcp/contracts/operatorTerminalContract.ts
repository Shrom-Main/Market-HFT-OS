/**
 * Gate M6.9 (Decision OD-19 / Charter DEC-019):
 * Operator Terminal Contracts, Safety & Governance Schemas
 *
 * Implements the normative contracts for the Read-Only Operator Terminal Projection Layer,
 * 3-Tier Kill Switch Controller, Two-Level Error Presentation, and 12-Point Release Gate
 * according to POC.docx §7, §8, §9.5, §10, and §13.
 */

import { EvidenceOriginClass } from '../../research/m5SignalAndEvidenceEngine.js';

/**
 * Every displayed figure in the terminal must carry an explicit value provenance label
 * and a non-color-only semantic badge (`POC.docx` §10.5).
 */
export type ValueProvenanceClassification =
  | 'OBSERVED'
  | 'ESTIMATED'
  | 'SIMULATED'
  | 'ACTUAL';

export type TimerDeadlineClassification =
  | 'MEASURED_DEADLINE' // e.g., Supplier quote expiration timestamp on record
  | 'MODELLED_ESTIMATE'; // e.g., Estimated warehouse dwell or fulfilment duration

export type KillSwitchHaltScope =
  | 'NORMAL_PAPER_OPERATION'
  | 'HALT_NEW_ALLOCATIONS' // Blocks new capital commitments; existing open positions continue tracking
  | 'HALT_ALL_SIMULATION_PROCESSING' // Freezes all simulation ticks and worker dispatches
  | 'ENTER_RECOVERY_ONLY_MODE'; // Restricts system strictly to WAL/PostgreSQL reconciliation & audit

export type WriteOperationOutcomeStatus =
  | 'COMMITTED_SUCCESS'
  | 'DEFINITE_FAILURE'
  | 'OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED'; // Mandatory on write timeout (`POC.docx` §9.5)

export interface SemanticStatusBadge {
  readonly status_code: string;
  readonly icon_symbol:
    | '[OK]'
    | '[WARN]'
    | '[BLOCKED]'
    | '[HALTED]'
    | '[QUARANTINED]'
    | '[FIXTURE]'
    | '[LIVE]'
    | '[UNKNOWN]';
  readonly label: string;
  readonly aria_description: string; // Accessible without relying on color alone (`POC.docx` §10.5)
}

export interface EvidenceOriginBadge {
  readonly origin_class: EvidenceOriginClass;
  readonly requested_url: string;
  readonly resolved_source_identity: string; // e.g. 'fixture://indiamart_tiered_moq' vs 'https://www.amazon.in/...'
  readonly is_eligible_for_executable_offer_promotion: boolean; // true ONLY for LIVE_VERIFIED_CAPTURE
  readonly semantic_badge: SemanticStatusBadge;
}

export interface HmacGrantTelemetryRow {
  readonly grant_id: string;
  readonly task_id: string;
  readonly worker_id: string;
  readonly mcp_session_initialized: boolean;
  readonly grant_signature_hmac: string;
  readonly hmac_signature_verified: boolean;
  readonly positive_manifest_id: string;
  readonly handler_code_sha256: string;
  readonly requests_made: number;
  readonly max_requests: number;
  readonly cumulative_task_wall_clock_ms: number;
  readonly max_task_wall_clock_ms: number;
  readonly last_call_latency_ms: number;
  readonly max_latency_ms: number;
  readonly stream_bytes_read: number;
  readonly max_payload_bytes: number;
  readonly tokens_used: number;
  readonly max_tokens: number;
  readonly egress_telemetry: {
    readonly allow_network_egress: boolean;
    readonly resolved_dns_ips: readonly string[];
    readonly verified_port: 443 | null;
    readonly stream_aborted_for_oversize: boolean;
    readonly abort_signal_triggered: boolean;
  };
}

export interface GoldenExtractionBenchRow {
  readonly worker_id: string;
  readonly extractor_version: string;
  readonly golden_cases_evaluated: number;
  readonly precision_bps: number; // 10000 = 100.00%
  readonly recall_bps: number; // 10000 = 100.00%
  readonly exact_match_bps: number; // 10000 = 100.00%
  readonly certification_status: 'CERTIFIED_100_PCT' | 'HOLD_BELOW_THRESHOLD';
  readonly benchmark_corpus_sha256: string;
}

export interface LabeledMetricValue<T = string | number> {
  readonly value: T;
  readonly unit: 'INR' | 'SUBUNITS_INR' | 'BPS' | 'DAYS' | 'UNITS' | 'RATIO';
  readonly classification: ValueProvenanceClassification;
  readonly source_lineage_ref: string; // Drill-down pointer to claim/formula hash (`POC.docx` §10.2)
}

export interface TwoLevelErrorEnvelope {
  readonly operator_message: string; // Short, actionable, zero secret leakage (`POC.docx` §9.5)
  readonly outcome_status: WriteOperationOutcomeStatus;
  readonly audit_detail: {
    readonly error_code: string;
    readonly affected_entity_id: string;
    readonly correlation_id: string;
    readonly timestamp_utc: string;
    readonly state_before_jcs_hash: string;
    readonly state_after_jcs_hash: string;
    readonly validation_failures: readonly string[];
    readonly source_references: readonly string[];
  };
}

export interface OperatorConfirmationEnvelope {
  readonly operator_id: string;
  readonly action_type:
    | 'PROMOTE_EVIDENCE'
    | 'PROMOTE_FORMULA_CARD'
    | 'APPROVE_PAPER_ALLOCATION'
    | 'ACTIVATE_KILL_SWITCH'
    | 'RESET_KILL_SWITCH';
  readonly target_entity_id: string;
  readonly explicit_rationale: string; // Minimum 15 chars; empty/ambiguous clicks rejected (`POC.docx` §10.5)
  readonly confirmation_token: string;
  readonly confirmed_at_utc: string;
}

/**
 * The 10 Required Capital-Allocation Comparison Dimensions (`POC.docx` §8).
 * Explicitly forbids collapsing into a single composite score.
 */
export interface TenDimensionOpportunityComparisonRow {
  readonly candidate_id: string;
  readonly expected_return_bps: LabeledMetricValue<number>;
  readonly return_after_costs_and_taxes_bps: LabeledMetricValue<number>;
  readonly risk_and_downside_buffer_bps: LabeledMetricValue<number>;
  readonly capital_requirement_inr: LabeledMetricValue<string>;
  readonly time_to_execution_days: LabeledMetricValue<number>;
  readonly cash_recovery_ccc_days: LabeledMetricValue<number>;
  readonly liquidity_lockup_ratio_bps: LabeledMetricValue<number>;
  readonly opportunity_cost_benchmark_bps: LabeledMetricValue<number>;
  readonly edge_decay_half_life_days: LabeledMetricValue<number>;
  readonly evidence_conviction_score_bps: LabeledMetricValue<number>;
  readonly allocated_capital_inr: LabeledMetricValue<string>; // Separated from conviction (`POC.docx` §10.3)
  readonly conviction_vs_allocation_rationale: string;
  readonly evidence_origin?: EvidenceOriginBadge;
  readonly drilldown_lineage?: {
    readonly headline_return_ref: string;
    readonly fee_tax_assumption_ref: string;
    readonly source_document_sha256: string;
  };
  readonly gate_badge: SemanticStatusBadge;
}

// -----------------------------------------------------------------------------
// The 8 Logical Workspaces (`POC.docx` §10)
// -----------------------------------------------------------------------------

export interface CommandCenterWorkspace {
  readonly available_treasury_capital_inr: LabeledMetricValue<string>;
  readonly committed_paper_capital_inr: LabeledMetricValue<string>;
  readonly unrecovered_dwell_capital_inr: LabeledMetricValue<string>;
  readonly active_research_runs_count: LabeledMetricValue<number>;
  readonly risk_alerts_count: LabeledMetricValue<number>;
  readonly ledger_reconciliation_status: SemanticStatusBadge;
  readonly evidence_origin_breakdown: {
    readonly live_capture_claim_count: number;
    readonly golden_fixture_claim_count: number;
    readonly llm_proposal_count: number;
    readonly live_verified_ratio_bps: number;
  };
  readonly active_kill_switch_scope: KillSwitchHaltScope;
  readonly cumulative_wall_clock_budget_utilization_bps: number;
}

export interface OpportunityRadarTimerItem {
  readonly timer_name: string;
  readonly deadline_or_duration: string;
  readonly classification: TimerDeadlineClassification;
}

export interface OpportunityRadarItem {
  readonly candidate_id: string;
  readonly sku_id: string;
  readonly source_freshness_age_seconds: LabeledMetricValue<number>;
  readonly edge_decay_regime: 'SUSTAINED_STRUCTURAL_SIGNAL' | 'FAST_TACTICAL_OPPORTUNITY';
  readonly half_life_days: LabeledMetricValue<number>;
  readonly evidence_gap_status: 'DATA_COMPLETE' | 'DATA_REQUIRED';
  readonly timers: readonly OpportunityRadarTimerItem[];
  readonly evidence_origin?: EvidenceOriginBadge;
  readonly badge: SemanticStatusBadge;
}

export interface OpportunityRadarWorkspace {
  readonly opportunities: readonly OpportunityRadarItem[];
  readonly total_active_opportunities: LabeledMetricValue<number>;
  readonly badge: SemanticStatusBadge;
}

export interface EvidenceWorkbenchRecord {
  readonly claim_id: string;
  readonly entity_id: string;
  readonly evidence_kind: string;
  readonly verification_status: string;
  readonly commercial_status: string;
  readonly requested_url?: string;
  readonly resolved_source_identity?: string;
  readonly evidence_origin?: EvidenceOriginBadge;
  readonly lookahead_bias_status?: 'CLEAN_NO_LOOKAHEAD' | 'LOOKAHEAD_BIAS_REJECTED';
  readonly dom_sha256?: string;
  readonly transcript_sha256?: string;
  readonly circular_sha256?: string;
  readonly provenance_lineage: string;
  readonly conflict_hold: boolean;
  readonly origin_firewall_blocked?: boolean;
  readonly promoted_at_utc?: string;
  readonly badge: SemanticStatusBadge;
}

export interface EvidenceWorkbenchWorkspace {
  readonly records: readonly EvidenceWorkbenchRecord[];
  readonly conflict_holds_count: LabeledMetricValue<number>;
  readonly badge: SemanticStatusBadge;
}

export interface EconomicsLabTieredBracket {
  readonly min_qty: number;
  readonly max_qty: number;
  readonly unit_price_inr: string;
  readonly selected: boolean;
}

export interface EconomicsLabWorkspace {
  readonly sku_id: string;
  readonly landed_cost_inr: LabeledMetricValue<string>;
  readonly fee_gst_rate_bps: LabeledMetricValue<number>;
  readonly sec_52_tcs_rate_bps: LabeledMetricValue<number>;
  readonly sec_194_o_tds_rate_bps: LabeledMetricValue<number>;
  readonly return_attrition_drag_bps: LabeledMetricValue<number>;
  readonly tiered_moq_brackets: readonly EconomicsLabTieredBracket[];
  readonly spread_and_breakeven_bands: {
    readonly upper_spread_bps: number;
    readonly breakeven_price_inr: string;
    readonly lower_scrap_floor_inr: string;
  };
  readonly cash_flow_j_curve: readonly {
    readonly day: number;
    readonly cumulative_cash_flow_inr: string;
  }[];
  readonly arbitrage_greeks: {
    readonly delta_bps: number;
    readonly theta_bps: number;
    readonly vega_bps: number;
  };
  readonly formula_registry_cards: readonly {
    readonly card_id: string;
    readonly title: string;
    readonly status: 'PROMOTED_NORMATIVE' | 'CANDIDATE_UI_MODEL';
  }[];
  readonly groq_egress_audit?: {
    readonly endpoint_locked_to_groq_api: boolean;
    readonly verified_endpoint: string;
    readonly prompt_redaction_applied: boolean;
    readonly evidence_origin_class: 'LLM_MODEL_PROPOSAL';
    readonly badge: SemanticStatusBadge;
  };
  readonly badge: SemanticStatusBadge;
}

export interface CapitalAllocatorWorkspace {
  readonly opportunities: readonly TenDimensionOpportunityComparisonRow[];
  readonly total_paper_budget_inr: LabeledMetricValue<string>;
  readonly allocated_paper_capital_inr: LabeledMetricValue<string>;
  readonly unallocated_paper_capital_inr: LabeledMetricValue<string>;
  readonly badge: SemanticStatusBadge;
}

export interface PaperPositionItem {
  readonly position_id: string;
  readonly candidate_id: string;
  readonly allocated_capital_inr: string;
  readonly lifecycle_status:
    | 'VALID_CALCULATED_RETURN'
    | 'CANNOT_CALCULATE_MISSING_INPUTS'
    | 'INSUFFICIENT_UNVERIFIED_EVIDENCE'
    | 'NO_ROOT_FOUND_IN_SEARCH_DOMAIN'
    | 'NOT_YET_RECOVERED'
    | 'OPEN_POSITION';
  readonly inventory_conservation_proven: boolean;
  readonly badge: SemanticStatusBadge;
}

export interface SevenBucketInventoryModel {
  readonly raw_material: number;
  readonly work_in_progress: number;
  readonly finished_goods: number;
  readonly intransit_to_fba: number;
  readonly fba_available: number;
  readonly reserved_customer: number;
  readonly returned_quarantine: number;
  readonly total_conserved: number;
}

export interface SimulationAndPositionsWorkspace {
  readonly paper_positions: readonly PaperPositionItem[];
  readonly seven_bucket_inventory: SevenBucketInventoryModel;
  readonly cash_ledger_balance_inr: LabeledMetricValue<string>;
  readonly badge: SemanticStatusBadge;
}

export interface CrossLedgerComparisonModel {
  readonly paper_ledger_total_inr: string;
  readonly actuals_ledger_total_inr: string;
  readonly direct_merge_blocked: boolean;
  readonly actuals_write_blocked: boolean;
  readonly cash_conservation_status: SemanticStatusBadge;
  readonly inventory_conservation_status: SemanticStatusBadge;
}

export interface ReconciliationAndPerformanceWorkspace {
  readonly factor_efficacy_ledger: readonly {
    readonly factor_name: string;
    readonly observed_correlation_bps: number;
    readonly regime_efficacy: string;
  }[];
  readonly bitemporal_restatements: readonly {
    readonly record_id: string;
    readonly decision_time_utc: string;
    readonly knowledge_time_utc: string;
    readonly restatement_diff_summary: string;
  }[];
  readonly cross_ledger_comparison: CrossLedgerComparisonModel;
  readonly reconciliation_exceptions: readonly string[];
  readonly badge: SemanticStatusBadge;
}

export interface RiskAuditAndSystemHealthWorkspace {
  readonly hmac_grant_telemetry: readonly HmacGrantTelemetryRow[];
  readonly golden_extraction_bench_scores: readonly GoldenExtractionBenchRow[];
  readonly mcp_worker_dag_nodes: readonly {
    readonly node_id: string;
    readonly pass: number;
    readonly status: string;
    readonly dependencies: readonly string[];
    readonly wave_number?: number;
  }[];
  readonly dag_checkpoint_sha256: string;
  readonly mcp_quotas: readonly {
    readonly grant_id: string;
    readonly worker_id: string;
    readonly requests_made: number;
    readonly max_requests: number;
    readonly tokens_used: number;
    readonly max_tokens: number;
    readonly payload_bytes: number;
    readonly max_bytes: number;
    readonly wall_clock_ms: number;
    readonly max_wall_clock_ms: number;
  }[];
  readonly denied_mcp_calls_count: number;
  readonly red_team_findings: readonly {
    readonly finding_id: string;
    readonly title: string;
    readonly blocking: boolean;
    readonly status: string;
  }[];
  readonly kill_switch_state: {
    readonly active_scope: KillSwitchHaltScope;
    readonly activated_at_utc?: string;
    readonly reason?: string;
  };
  readonly hash_chain_integrity: {
    readonly verified: boolean;
    readonly chain_length: number;
    readonly root_hash: string;
  };
  readonly system_health_alert: boolean;
  readonly system_health_alert_reason?: string;
  readonly badge: SemanticStatusBadge;
}

export interface EightWorkspaces {
  readonly command_center: CommandCenterWorkspace;
  readonly opportunity_radar: OpportunityRadarWorkspace;
  readonly evidence_workbench: EvidenceWorkbenchWorkspace;
  readonly economics_lab: EconomicsLabWorkspace;
  readonly capital_allocator: CapitalAllocatorWorkspace;
  readonly simulation_and_positions: SimulationAndPositionsWorkspace;
  readonly reconciliation_and_performance: ReconciliationAndPerformanceWorkspace;
  readonly risk_audit_and_system_health: RiskAuditAndSystemHealthWorkspace;
}

export interface OperatorTerminalSnapshot {
  readonly operating_mode: 'DRY_RUN_PAPER_SIMULATION_ONLY';
  readonly real_money_execution_enabled: false;
  readonly as_of_timestamp_utc: string;
  readonly snapshot_jcs_sha256: string;
  readonly workspaces: EightWorkspaces;
}

export interface ReadinessCriterionResult {
  readonly criterion_id: string;
  readonly title: string;
  readonly passed: boolean;
  readonly evidence_reference: string;
}

export interface TwelvePointReadinessCertificate {
  readonly certificate_id: string;
  readonly evaluated_at_utc: string;
  readonly operating_mode: 'DRY_RUN_PAPER_SIMULATION_ONLY';
  readonly real_money_execution_enabled: false;
  readonly all_twelve_passed: boolean;
  readonly criteria: readonly ReadinessCriterionResult[];
  readonly certificate_jcs_sha256: string;
}

export interface GovernedOperatorActionExecutionResult<T = unknown> {
  readonly outcome: T;
  readonly confirmation_token: string;
  readonly confirmed_at_utc: string;
  readonly optimistic_ui_mutation_allowed: false;
}
