/**
 * Gate M7.1 (Decision OD-21 / Charter DEC-021):
 * Signal Ingestion & 6-Hop Processing Lineage Contract
 *
 * Defines the authoritative schemas for multi-channel raw signal ingestion,
 * connector health monitoring, and the 6-stage Signal-to-Decision Lineage Trace.
 */

import { EvidenceOriginClass } from '../../research/m5SignalAndEvidenceEngine.js';

export type SignalIntakeChannel =
  | 'MARKETPLACE_OR_SUPPLIER_HTML'
  | 'YOUTUBE_VIDEO_TRANSCRIPT'
  | 'SOCIAL_FORUM_CHATTER'
  | 'MACROECONOMIC_SERIES'
  | 'LATERAL_COMMODITY_MARKET'
  | 'GOVERNMENT_STATUTORY_CIRCULAR';

export interface RawSignalIntakeRequest {
  readonly signal_id?: string;
  readonly channel: SignalIntakeChannel;
  readonly source_id: string;
  readonly target_url?: string;
  readonly raw_payload: string | Record<string, unknown>;
  readonly event_time_utc?: string;
  readonly receipt_time_utc?: string;
  readonly origin_class?: EvidenceOriginClass;
  readonly target_sku_id?: string;
  readonly custom_parameters?: Record<string, unknown>;
}

export type SignalFinalProcessingStatus =
  | 'PROCESSED'
  | 'DATA_REQUIRED'
  | 'QUARANTINED_INJECTION'
  | 'QUARANTINED_MALFORMED'
  | 'DUPLICATE_IGNORED'
  | 'STALE_REJECTED'
  | 'LOOKAHEAD_REJECTED';

export interface RawInputStageTrace {
  readonly raw_payload_preview: string;
  readonly source_id: string;
  readonly requested_url: string;
  readonly event_time_utc: string;
  readonly receipt_time_utc: string;
  readonly raw_sha256: string;
  readonly origin_class: EvidenceOriginClass;
  readonly claimed_origin_rejected?: string;
}

export interface ValidatedFieldsStageTrace {
  readonly status: 'VALIDATED' | 'DATA_REQUIRED' | 'QUARANTINED' | 'DUPLICATE' | 'REJECTED';
  readonly extracted_fields: Record<string, unknown>;
  readonly missing_fields: readonly string[];
  readonly sanitization_telemetry: {
    readonly injection_detected: boolean;
    readonly canary_triggered: boolean;
    readonly sanitized_chars_count: number;
    readonly notes?: string;
  };
}

export interface NormalizedSignalStageTrace {
  readonly signal_id: string;
  readonly channel: SignalIntakeChannel;
  readonly magnitude_bps_or_subunits: string;
  readonly temporal_regime: 'FAST_TACTICAL_OPPORTUNITY' | 'SUSTAINED_STRUCTURAL_SIGNAL';
  readonly half_life_days: number;
  readonly economic_factor_name: string;
}

export interface EvidenceRecordStageTrace {
  readonly claim_id: string;
  readonly evidence_kind: string;
  readonly verification_status: 'UNVERIFIED' | 'CROSS_SOURCE_CORROBORATED' | 'CRYPTOGRAPHICALLY_ATTESTED';
  readonly commercial_status: string;
  readonly provenance_lineage: string;
}

export interface WorkerAndRedTeamStageTrace {
  readonly worker_id: string;
  readonly mcp_grant_id: string;
  readonly red_team_findings: readonly {
    readonly rule_id: string;
    readonly severity: string;
    readonly rationale: string;
  }[];
  readonly disposition: string;
}

export interface EconomicAndGateImpactStageTrace {
  readonly affected_sku_id: string;
  readonly landed_cost_before_inr: number;
  readonly landed_cost_after_inr: number | null;
  readonly rowc_before_bps: number;
  readonly rowc_after_bps: number | null;
  readonly allocation_gate_status: 'PASSED' | 'HELD_FOR_REVIEW' | 'BLOCKED_BY_POLICY' | 'DATA_REQUIRED' | 'HOLD_DATA_REQUIRED';
  readonly economic_impact_status?: 'CALCULATED' | 'DATA_REQUIRED';
}

export interface SignalProcessingTraceRecord {
  readonly trace_id: string;
  readonly signal_id: string;
  readonly channel: SignalIntakeChannel;
  readonly created_at_utc: string;
  readonly final_status: SignalFinalProcessingStatus;
  readonly error_code?: string;
  readonly error_message?: string;
  readonly raw_input_stage: RawInputStageTrace;
  readonly validated_fields_stage: ValidatedFieldsStageTrace;
  readonly normalized_signal_stage?: NormalizedSignalStageTrace;
  readonly evidence_record_stage?: EvidenceRecordStageTrace;
  readonly worker_and_red_team_stage?: WorkerAndRedTeamStageTrace;
  readonly economic_and_gate_impact_stage?: EconomicAndGateImpactStageTrace;
  readonly jcs_sha256: string;
}

export interface SourceConnectorHealthRow {
  readonly connector_id: string;
  readonly name: string;
  readonly channel: SignalIntakeChannel;
  readonly endpoint: string;
  readonly status: 'ACTIVE' | 'FIXTURE_SIMULATED' | 'IDLE' | 'IDLE_NEVER_RUN' | 'DEGRADED' | 'QUARANTINED';
  readonly last_heartbeat_utc: string | null;
  readonly last_successful_fetch_utc?: string | null;
  readonly ingested_count: number;
  readonly quarantined_count: number;
  readonly error_count: number;
  readonly freshness_age_seconds: number | null;
}

export interface SS304VariantRow {
  readonly variant_id: string;
  readonly sku_id: string;
  readonly diameter: '16-25mm' | '20-32mm' | '25-40mm' | '32-50mm';
  readonly pack_size: 10 | 20;
  readonly unit_landed_cost_inr: number;
  readonly per_clamp_landed_cost_inr: number;
  readonly gross_selling_price_inr: number;
  readonly breakeven_floor_inr: number;
  readonly contribution_margin_bps: number;
  readonly annualized_rowc_bps: number;
  readonly sub_10_inr_target_met: boolean;
  readonly margin_floor_met: boolean;
  readonly status_badge: string;
}

export interface SignalsInboxResponse {
  readonly connectors: readonly SourceConnectorHealthRow[];
  readonly signals: readonly SignalProcessingTraceRecord[];
  readonly quarantine_count: number;
  readonly data_required_count: number;
  readonly total_signals_count: number;
  readonly timestamp_utc: string;
}
