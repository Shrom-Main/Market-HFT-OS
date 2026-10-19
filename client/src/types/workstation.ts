export type KillSwitchTier =
  | 'NORMAL_OPERATION'
  | 'HALT_NEW_ALLOCATIONS'
  | 'HALT_ALL_SIMULATION_PROCESSING'
  | 'ENTER_RECOVERY_ONLY_MODE';

export interface KillSwitchState {
  current_tier: KillSwitchTier;
  operator_rationale: string;
  updated_at_utc: string;
  halt_new_allocations: boolean;
  halt_simulation_processing: boolean;
  recovery_only_mode: boolean;
  active_incidents_count: number;
}

export interface SignalEnvelope {
  signal_id: string;
  channel: string;
  source_id: string;
  source_url: string;
  observed_at_utc: string;
  received_at_utc: string;
  raw_payload: any;
  normalized_metric_bps?: number;
  jcs_sha256: string;
  canary_passed: boolean;
  deduplicated: boolean;
  origin_class: string;
}

export interface SignalTraceRecord {
  signal_id: string;
  stage_name: string;
  status: 'PENDING' | 'SUCCESS' | 'QUARANTINED' | 'FAILED';
  timestamp_utc: string;
  detail: string;
  latency_ms: number;
}

export interface TerminalSnapshot {
  snapshot_id: string;
  timestamp_utc: string;
  operating_mode: string;
  kill_switch: KillSwitchState;
  origin_breakdown: {
    live_verified_capture_pct: number;
    recorded_golden_fixture_pct: number;
    total_evidence_count: number;
    live_evidence_count: number;
    fixture_evidence_count: number;
  };
  conserved_working_capital_inr: number;
  total_active_opportunities: number;
  unrecovered_cash_exposure_inr: number;
  inventory_bucket_integrity: boolean;
  readiness_passed: boolean;
}

export interface TwoLevelErrorEnvelope {
  error_code: string;
  operator_message: string;
  technical_diagnostics: string;
  correlation_id: string;
  timestamp_utc: string;
}

export interface WhatIfSimulationResult {
  formula_expression: string;
  evaluated_result_subunits: string;
  evaluated_result_decimal: number;
  evaluator_tier: 'CANDIDATE_UI_MODEL' | 'GOVERNED_CORE';
  comparison: {
    baseline_decimal: number;
    shock_decimal: number;
    delta_bps: number;
  };
}

export interface AiOpportunityAnalysisResult {
  product_id: string;
  analysis_timestamp_utc: string;
  llm_model: string;
  thesis_synthesis: string;
  unserved_pain_points: string[];
  engineered_edge_suggestions: string[];
  arbitrage_viability_verdict: 'STRONG_BUY_BOX_CANDIDATE' | 'HIGH_COMPLIANCE_BARRIER' | 'MARGIN_COMPRESSION_RISK';
  raw_material_sensitivity_commentary: string;
  recommended_action: 'PURSUE_EXPEDITED' | 'REQUEST_MORE_SUPPLIER_QUOTES' | 'ABANDON';
}
