/**
 * Market HFT OS — MCP Contract: GovtAndStatutoryWorker (Stage 5)
 *
 * Defines the capability-governed MCP tool policy, citation data contracts,
 * rule claims, and fail-closed response schemas for statutory circular ingestion.
 */

export interface GovtStatutoryToolPolicy {
  readonly tool_id: 'mcp://policy-bulletins/fetch_circular';
  readonly allowed_methods: readonly ['GET'];
  readonly allowed_schemes: readonly ['https', 'mcp'];
  readonly allowed_hosts: readonly [
    'cbic-gst.gov.in',
    'incometaxindia.gov.in',
    'dgft.gov.in',
    'msme.gov.in'
  ];
  readonly allow_redirects: false;
  readonly block_private_and_loopback_ips: true;
  readonly allowed_content_types: readonly ['application/json', 'text/plain'];
  readonly max_payload_bytes: 262144; // 256 KB max circular payload
  readonly max_latency_ms: 4000;
  readonly max_requests_per_task: 2;
}

export const GOVT_STATUTORY_TOOL_POLICY: GovtStatutoryToolPolicy = Object.freeze({
  tool_id: 'mcp://policy-bulletins/fetch_circular',
  allowed_methods: Object.freeze(['GET'] as const),
  allowed_schemes: Object.freeze(['https', 'mcp'] as const),
  allowed_hosts: Object.freeze([
    'cbic-gst.gov.in',
    'incometaxindia.gov.in',
    'dgft.gov.in',
    'msme.gov.in'
  ] as const),
  allow_redirects: false,
  block_private_and_loopback_ips: true,
  allowed_content_types: Object.freeze(['application/json', 'text/plain'] as const),
  max_payload_bytes: 262144,
  max_latency_ms: 4000,
  max_requests_per_task: 2
});

export type StatutoryAuthority = 'CBIC' | 'CBDT' | 'DGFT' | 'MINISTRY_OF_MSME';

export interface StatutoryCitation {
  readonly authority: StatutoryAuthority;
  readonly notification_or_section_id: string; // e.g., 'Notification No. 15/2024-Central Tax' or 'IT Act Sec 43B(h)'
  readonly effective_from_date: string; // YYYY-MM-DD
  readonly hsn_or_sac_code?: string; // e.g., '73269099'
  readonly document_sha256: string;
}

export type StatutoryParameterName =
  | 'gst_rate_bps'
  | 'tcs_rate_bps'
  | 'tds_rate_bps'
  | 'customs_bcd_bps'
  | 'anti_dumping_duty_subunits_per_kg'
  | 'msme_max_payment_terms_days';

export type StatutoryUnit = 'BPS' | 'SUBUNITS_INR' | 'DAYS';

export interface CandidateFormulaProposal {
  readonly target_formula_id: string;
  readonly requires_owner_promotion: true; // Cannot overwrite PROMOTED_NORMATIVE cards
  readonly symbolic_expression?: string;
}

export interface StatutoryRuleClaim {
  readonly rule_id: string;
  readonly parameter_name: StatutoryParameterName;
  readonly proposed_value_bigint: bigint;
  readonly unit: StatutoryUnit;
  readonly citation: StatutoryCitation;
  readonly verification_status: 'UNVERIFIED'; // Always UNVERIFIED; human review required
  readonly candidate_formula_proposal?: CandidateFormulaProposal;
}

export interface GovtStatutoryEvidenceEnvelope {
  readonly evidence_kind: 'SOURCE_DOCUMENT' | 'OBSERVED_FACT';
  readonly verification_status: 'UNVERIFIED'; // Never self-promotes
  readonly commercial_status: 'NOT_APPLICABLE'; // Statutory rules are never commercial offers
  readonly provenance_lineage: {
    readonly source_id: string;
    readonly observed_at_utc: string;
    readonly ttl_seconds: number;
    readonly document_sha256?: string;
    readonly extractor_version: 'gsw-statutory-sieve-v1.0.0';
  };
}

export interface GovtStatutoryMcpRequest {
  readonly task_id: string;
  readonly worker_id: 'worker:govt-statutory:v1';
  readonly circular_id?: string;
  readonly hsn_code?: string;
  readonly parameter_name?: StatutoryParameterName;
  readonly target_url?: string;
  readonly is_msme_supplier?: boolean;
  readonly has_written_payment_agreement?: boolean;
  readonly reference_time_utc?: string;
  readonly custom_commercial_status?: string;
  readonly raw_circular_payload?: string;
  readonly custom_claims?: readonly {
    readonly rule_id: string;
    readonly parameter_name: StatutoryParameterName;
    readonly proposed_value_bigint: string;
    readonly unit: StatutoryUnit;
    readonly citation: StatutoryCitation;
  }[];
}

export interface GovtStatutoryMcpResponse {
  readonly request_id: string;
  readonly requested_at_utc: string;
  readonly status:
    | 'RESOLVED'
    | 'QUARANTINED_INJECTION'
    | 'DATA_REQUIRED'
    | 'CITATION_INVALID_REJECTED';
  readonly error_code?: string;
  readonly error_reason?: string;
  readonly claims: readonly {
    readonly rule_id: string;
    readonly parameter_name: StatutoryParameterName;
    readonly proposed_value_bigint: string;
    readonly unit: StatutoryUnit;
    readonly citation: StatutoryCitation;
    readonly verification_status: 'UNVERIFIED';
    readonly candidate_formula_proposal?: CandidateFormulaProposal;
  }[];
  readonly msme_cross_check?: {
    readonly is_msme_supplier: boolean;
    readonly has_written_agreement: boolean;
    readonly statutory_max_payment_terms_days: number;
    readonly citation_section: 'Income Tax Act 1961 Section 43B(h)';
  };
  readonly evidence_envelope: GovtStatutoryEvidenceEnvelope;
}
