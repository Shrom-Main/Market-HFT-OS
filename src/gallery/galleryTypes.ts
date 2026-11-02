/**
 * POC-001: Living Product Gallery & Thesis Gallery Types (Stage C)
 *
 * Implements the normative type contracts for:
 * 1. Persistent Product Candidate Queue
 * 2. Independent Persistent Thesis Queue
 * 3. Dynamic Workstation Gallery Events & Replay
 * 4. Grounded Operator LLM Interaction (Evidence-linked, zero float math)
 */

import { OpportunityCategory } from '../canonical/opportunityCategory.js';
import { OpportunityLifecycleState, InvestigationStatus } from '../research/opportunityLifecycleEngine.js';
import { InvestigationTask } from '../discovery/investigationPlanner.js';
import { ApplicabilityCriteria } from '../memory/memoryTypes.js';

export type GalleryCandidateOriginClass =
  | 'LIVE_VERIFIED_CAPTURE'
  | 'RECORDED_GOLDEN_FIXTURE'
  | 'UNATTESTED_USER_INTAKE'
  | 'SPATIAL_DISCOVERY_SWEEP';

export interface CandidateLocation {
  readonly cluster_id: string;
  readonly city: string;
  readonly state: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface CandidateEntityRelationship {
  readonly entity_id: string;
  readonly entity_name: string;
  readonly relationship_type: 'PRIMARY_MANUFACTURER' | 'SUPPLIER' | 'BUYER' | 'TRADER' | 'DISTRIBUTOR';
  readonly verification_status: 'VERIFIED' | 'UNVERIFIED' | 'DISQUALIFIED';
}

export interface CandidateApplicableMemory {
  readonly memory_id: string;
  readonly playbook_name: string;
  readonly applicability_reason: string;
  readonly applied_at_utc: string;
}

export interface ProductQueueCandidate {
  readonly candidate_id: string;
  readonly canonical_product_id: string;
  readonly name: string;
  readonly category: OpportunityCategory;
  readonly origin_class: GalleryCandidateOriginClass;
  readonly source_url?: string;
  readonly discovered_at_utc: string;
  updated_at_utc: string;
  lifecycle_state: OpportunityLifecycleState | 'UNDERWRITING';
  readonly supporting_evidence_ids: string[];
  readonly contradictory_evidence_ids: string[];
  readonly relevant_locations: CandidateLocation[];
  readonly entity_relationships: CandidateEntityRelationship[];
  investigation_status: InvestigationStatus | 'BLOCKED';
  readonly outstanding_tasks: InvestigationTask[];
  readonly applicable_procedural_memories: CandidateApplicableMemory[];
  last_event_id: string;
  last_event_type: string;
  last_event_summary: string;
  financial_summary?: {
    readonly factory_gate_quote_inr?: number | null;
    readonly prevailing_retail_asp_inr?: number | null;
    readonly estimated_gross_margin_bps?: number | null;
    readonly data_required_fields: readonly string[];
  };
  jcs_sha256: string;
}

export type ThesisScope =
  | 'PRODUCT'
  | 'CATEGORY'
  | 'GEOGRAPHIC_CLUSTER'
  | 'SUPPLY_CHAIN_INEFFICIENCY'
  | 'MARKET_STRUCTURE'
  | 'SERVICE_SOFTWARE'
  | 'CROSS_ENTITY_PATTERN';

export type ThesisLifecycleState =
  | 'NEW'
  | 'EVALUATING'
  | 'REVIEW_REQUIRED'
  | 'VALIDATED'
  | 'DEFERRED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'ARCHIVED';

export interface ThesisInvestigationHistoryEntry {
  readonly investigation_id: string;
  readonly timestamp_utc: string;
  readonly finding: string;
  readonly evidence_ids: readonly string[];
}

export interface ThesisRevisionEntry {
  readonly revision_number: number;
  readonly previous_statement: string;
  readonly updated_statement: string;
  readonly rationale: string;
  readonly timestamp_utc: string;
  readonly triggering_evidence_id?: string;
}

export interface ThesisQueueRecord {
  readonly thesis_id: string;
  readonly title: string;
  readonly scope: ThesisScope;
  hypothesis_statement: string;
  readonly originating_observations: string[];
  readonly supporting_evidence_ids: string[];
  readonly disconfirming_evidence_ids: string[];
  readonly related_candidate_ids: string[];
  readonly related_entity_ids: string[];
  readonly related_locations: string[];
  readonly applicability: ApplicabilityCriteria;
  uncertainty_rating: 'LOW' | 'MEDIUM' | 'HIGH' | 'SPECULATIVE';
  readonly investigation_history: ThesisInvestigationHistoryEntry[];
  lifecycle_state: ThesisLifecycleState;
  readonly revisions: ThesisRevisionEntry[];
  created_at_utc: string;
  last_updated_utc: string;
  jcs_sha256: string;
}

export interface FormulateThesisParams {
  readonly title: string;
  readonly scope: ThesisScope;
  readonly hypothesis_statement: string;
  readonly originating_observations?: readonly string[];
  readonly supporting_evidence_ids?: readonly string[];
  readonly related_candidate_ids?: readonly string[];
  readonly related_entity_ids?: readonly string[];
  readonly related_locations?: readonly string[];
  readonly uncertainty_rating?: 'LOW' | 'MEDIUM' | 'HIGH' | 'SPECULATIVE';
  readonly thesis_id?: string;
}

export type GalleryEventType =
  | 'CANDIDATE_DISCOVERED'
  | 'CANDIDATE_UPDATED'
  | 'THESIS_FORMULATED'
  | 'THESIS_REVISED'
  | 'EVIDENCE_INGESTED'
  | 'CONTRADICTION_DETECTED'
  | 'INVESTIGATION_QUEUED'
  | 'INVESTIGATION_STARTED'
  | 'INVESTIGATION_COMPLETED'
  | 'MEMORY_APPLIED'
  | 'REVIEW_REQUIRED'
  | 'CANDIDATE_REJECTED'
  | 'CANDIDATE_DEFERRED'
  | 'CANDIDATE_ARCHIVED'
  | 'THESIS_REJECTED'
  | 'THESIS_ARCHIVED';

export interface GalleryEventPayload {
  readonly event_id: string;
  readonly sequence_number: number;
  readonly event_type: GalleryEventType;
  readonly aggregate_type: 'CANDIDATE' | 'THESIS' | 'INVESTIGATION';
  readonly aggregate_id: string;
  readonly timestamp_utc: string;
  readonly summary: string;
  readonly details: Record<string, unknown>;
  readonly jcs_sha256: string;
}

export interface OperatorInteractionResponse {
  readonly query: string;
  readonly target_id: string;
  readonly target_type: 'CANDIDATE' | 'THESIS';
  readonly epistemic_breakdown: {
    readonly observed_facts: readonly string[];
    readonly source_claims: readonly string[];
    readonly inferences: readonly string[];
    readonly hypotheses: readonly string[];
  };
  readonly cited_evidence_ids: readonly string[];
  readonly cited_memory_ids: readonly string[];
  readonly missing_data_fields: readonly string[];
  readonly identified_contradictions: readonly string[];
  readonly recommended_next_task?: string;
  readonly natural_language_explanation: string;
  readonly deterministic_guard_asserted: boolean;
}
