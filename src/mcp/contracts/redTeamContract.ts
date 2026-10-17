/**
 * Market HFT OS — MCP Contract: RedTeamAndConflictWorker (Stage 6)
 *
 * Defines the capability-governed MCP tool policy, audit finding schemas,
 * candidate evaluation inputs, and fail-closed disposition ceilings for
 * adversarial multi-agent corroboration and conflict resolution.
 */

import { SupplementaryClaim, SupplementaryJoinResult } from '../mcpSubstrate.js';

export interface RedTeamToolPolicy {
  readonly tool_id: 'mcp://audit-corpus/read_joined_claims';
  readonly allowed_methods: readonly ['GET'];
  readonly allowed_schemes: readonly ['mcp'];
  readonly allowed_hosts: readonly []; // Strictly internal memory/ledger read, zero network egress
  readonly allow_redirects: false;
  readonly block_private_and_loopback_ips: true;
  readonly allowed_content_types: readonly ['application/json'];
  readonly max_payload_bytes: 262144; // 256 KB max audit payload
  readonly max_latency_ms: 4000;
  readonly max_requests_per_task: 4;
}

export const RED_TEAM_TOOL_POLICY: RedTeamToolPolicy = Object.freeze({
  tool_id: 'mcp://audit-corpus/read_joined_claims',
  allowed_methods: Object.freeze(['GET'] as const),
  allowed_schemes: Object.freeze(['mcp'] as const),
  allowed_hosts: Object.freeze([] as const),
  allow_redirects: false,
  block_private_and_loopback_ips: true,
  allowed_content_types: Object.freeze(['application/json'] as const),
  max_payload_bytes: 262144,
  max_latency_ms: 4000,
  max_requests_per_task: 4
});

export type RedTeamRuleId =
  | 'RT-01-BELOW-PHYSICAL-SCRAP-FLOOR'
  | 'RT-02-UNRESOLVED-CROSS-SOURCE-CONFLICT'
  | 'RT-03-UNVERIFIED-HIGH-RETURN-ILLUSION'
  | 'RT-04-METALLURGY-CHATTER-CONTRADICTION'
  | 'RT-05-ILLEGAL-MSME-CREDIT-TERM-ASSUMPTION'
  | 'RT-06-MANDATORY-COST-DATA-REQUIRED'
  | 'RT-07-EXPIRED-OR-CLOCK-SKEWED-EVIDENCE';

export type RedTeamFindingSeverity =
  | 'BLOCK_ALLOCATION_GATE'
  | 'WARNING_REQUIRES_CORROBORATION'
  | 'INFO';

/**
 * Hardcoded disposition ceiling.
 * Structurally forbidden from ever emitting 'APPROVED_FOR_EXECUTION'.
 * Real capital execution promotion rests strictly with the Human Project Owner.
 */
export type RedTeamDisposition =
  | 'HOLD_BLOCKED_BY_RED_TEAM'
  | 'REQUIRES_SUPPLEMENTARY_CORROBORATION'
  | 'ELIGIBLE_FOR_HUMAN_REVIEW';

export interface RedTeamAuditFinding {
  readonly rule_id: RedTeamRuleId;
  readonly severity: RedTeamFindingSeverity;
  readonly rule_name: string;
  readonly description: string;
  readonly evidence_citations: readonly string[];
  readonly metric_involved?: string;
  readonly observed_value?: string;
  readonly threshold_or_floor?: string;
}

export interface RedTeamEvidenceEnvelope {
  readonly evidence_kind: 'AUDIT_RECORD';
  readonly verification_status: 'UNVERIFIED'; // Red-team findings never self-promote
  readonly commercial_status: 'NOT_APPLICABLE';
  readonly provenance_lineage: {
    readonly source_id: 'mcp://audit-corpus/read_joined_claims';
    readonly observed_at_utc: string;
    readonly ttl_seconds: number;
    readonly document_sha256?: string;
    readonly auditor_version: 'rtw-conflict-sieve-v1.0.0';
  };
}

export interface RedTeamChatterDefectSignal {
  readonly material_flagged?: string; // e.g. 'SS202' or 'RUST'
  readonly defect_rate_bps?: number;
  readonly source_id?: string;
  readonly transcript_span?: string;
}

export interface RedTeamCostBreakdown {
  readonly raw_material_purchase_subunits?: string | bigint;
  readonly inbound_freight_subunits?: string | bigint;
  readonly packaging_kitting_subunits?: string | bigint;
  readonly customs_inspection_subunits?: string | bigint;
  readonly marketplace_closing_subunits?: string | bigint;
  readonly marketplace_weight_handling_subunits?: string | bigint;
  readonly gst_rate_bps?: string | bigint;
}

export interface RedTeamEvidenceTimestamp {
  readonly envelope_id?: string;
  readonly observed_at_utc: string;
  readonly ttl_seconds: number;
}

export interface RedTeamMcpRequest {
  readonly task_id: string;
  readonly worker_id: 'worker:red-team:v1';
  readonly candidate_id: string;
  readonly sku_id: string;
  readonly reference_time_utc?: string;
  readonly max_clock_skew_seconds?: number;
  readonly claimed_supplier_exw_subunits?: string | bigint;
  readonly pack_mass_grams?: number;
  readonly lme_ss304_inr_per_kg_subunits?: string | bigint;
  readonly min_stamping_conversion_bps?: string | bigint;
  readonly raw_material_scrap_floor_subunits?: string | bigint;
  readonly min_viable_exw_floor_subunits?: string | bigint;
  readonly joined_claims?: readonly SupplementaryClaim[];
  readonly joined_results?: readonly SupplementaryJoinResult[];
  readonly projected_rowc_bps?: string | bigint;
  readonly sourcing_evidence_status?: string; // 'ADVERTISED_LISTING' | 'SUPPLIER_QUOTE' | 'VERIFIED_INVOICE'
  readonly material_claimed?: string; // e.g. 'SS304'
  readonly chatter_defect_signals?: readonly RedTeamChatterDefectSignal[];
  readonly supplier_dpo_days?: number;
  readonly is_msme_supplier?: boolean;
  readonly has_written_msme_agreement?: boolean;
  readonly statutory_max_payment_terms_days?: number;
  readonly cost_breakdown?: RedTeamCostBreakdown;
  readonly evidence_envelopes?: readonly RedTeamEvidenceTimestamp[];
  readonly attempted_disposition_override?: string;
}

export interface RedTeamMcpResponse {
  readonly request_id: string;
  readonly candidate_id: string;
  readonly audited_at_utc: string;
  readonly disposition: RedTeamDisposition;
  readonly passed_cleanly: boolean;
  readonly findings: readonly RedTeamAuditFinding[];
  readonly joined_claims_summary?: readonly SupplementaryJoinResult[];
  readonly evidence_envelope: RedTeamEvidenceEnvelope;
  readonly error_code?: string;
  readonly error_reason?: string;
}
