/**
 * POC-001: Persistent Knowledge & Layered Memory Types (Stage B)
 *
 * Implements the normative type system for the 4-layer persistent memory model,
 * temporal property graph, epistemic status, source-level provenance,
 * explicit applicability criteria, and durable memory events.
 */

export type MemoryTier = 'EPISODIC' | 'SEMANTIC' | 'PROCEDURAL' | 'STRATEGIC';

export type EpistemicStatus =
  | 'OBSERVED_FACT'
  | 'SOURCE_CLAIM'
  | 'INFERENCE'
  | 'HYPOTHESIS'
  | 'VALIDATED_RULE';

export type ValidationState =
  | 'PROPOSED'
  | 'VALIDATED'
  | 'REJECTED'
  | 'SUPERSEDED';

export type SourceReliability =
  | 'OFFICIAL_REGISTRY'
  | 'DIRECT_SUPPLIER_DISCLOSURE'
  | 'PUBLIC_DIRECTORY_SELF_REPORTED'
  | 'SECONDARY_PRESS'
  | 'UNVERIFIED_WEB';

export type CorroborationLevel =
  | 'SINGLE_SOURCE'
  | 'MULTI_SOURCE_INDEPENDENT'
  | 'CONFLICTING_OBSERVATIONS';

export type InferenceType =
  | 'DIRECT_OBSERVATION'
  | 'DEDUCTIVE_INFERENCE'
  | 'ANALOGICAL_TRANSFER'
  | 'UNTESTED_HYPOTHESIS';

export interface ApplicabilityCriteria {
  readonly jurisdictions?: readonly string[]; // e.g. ['IN']
  readonly categories?: readonly string[]; // e.g. ['PHYSICAL_GOODS', 'B2B_DISTRIBUTION']
  readonly industries?: readonly string[]; // e.g. ['ENGINEERING_FABRICATION', 'ROTATING_MACHINERY']
  readonly archetypes?: readonly string[]; // e.g. ['SME_FABRICATOR', 'JOB_WORK_SHOP']
  readonly scale?: readonly string[]; // e.g. ['MICRO_ENTERPRISE', 'SME']
  readonly required_signals?: readonly string[]; // e.g. ['B2B_DIRECTORY_LISTING']
}

export interface BaseMemoryRecord {
  readonly memory_id: string; // e.g. MEM_EPISODIC_xxx, MEM_PROC_xxx
  readonly tier: MemoryTier;
  readonly epistemic_status: EpistemicStatus;
  readonly validation_state: ValidationState;
  readonly title: string;
  readonly summary: string;
  readonly originating_investigation_id: string;
  readonly supporting_evidence_ids: readonly string[];
  readonly source_reliability: SourceReliability;
  readonly corroboration_level: CorroborationLevel;
  readonly inference_type: InferenceType;
  readonly applicability?: ApplicabilityCriteria;
  readonly valid_from_utc: string;
  readonly valid_to_utc: string | null;
  readonly observed_at_utc: string;
  readonly superseded_at_utc: string | null;
  readonly supersedes_memory_id: string | null;
  readonly jcs_sha256: string;
}

// 1. Episodic Memory Record
export interface EpisodicMemoryRecord extends BaseMemoryRecord {
  readonly tier: 'EPISODIC';
  readonly candidate_id: string;
  readonly execution_trace: {
    readonly tool_name: string;
    readonly input_params: Record<string, unknown>;
    readonly output_digest: string;
    readonly success: boolean;
    readonly latency_ms: number;
    readonly query_count: number;
    readonly error_details?: string;
  };
  readonly human_intervention?: {
    readonly operator_id: string;
    readonly action_type: 'OVERRIDE' | 'APPROVAL' | 'REJECTION';
    readonly operator_rationale: string;
  };
}

// 2. Semantic Memory Record
export interface SemanticMemoryRecord extends BaseMemoryRecord {
  readonly tier: 'SEMANTIC';
  readonly subject_entity_id?: string;
  readonly subject_concept_id?: string;
  readonly subject_name: string;
  readonly attributes: Record<string, unknown>;
}

// 3. Procedural Memory Record (Investigation Playbooks)
export interface ProceduralMemoryRecord extends BaseMemoryRecord {
  readonly tier: 'PROCEDURAL';
  readonly playbook_name: string;
  readonly target_domain: string;
  readonly applicability: ApplicabilityCriteria;
  readonly prerequisite_signals: readonly string[];
  readonly execution_steps: readonly {
    readonly step_number: number;
    readonly action_name: string;
    readonly target_role: string;
    readonly required_tool: string;
    readonly parameters_template: Record<string, unknown>;
    readonly expected_output_schema: string;
    readonly failure_recovery_action?: string;
  }[];
  readonly known_failure_modes: readonly {
    readonly failure_pattern: string;
    readonly preventive_action: string;
  }[];
  readonly historical_applications_count: number;
  readonly successful_applications_count: number;
  readonly validation_notes?: string;
}

// 4. Strategic Memory Record
export interface StrategicMemoryRecord extends BaseMemoryRecord {
  readonly tier: 'STRATEGIC';
  readonly thesis_pattern_id: string;
  readonly pattern_name: string;
  readonly observed_dataset_reference: string;
  readonly sample_size: number;
  readonly observed_correlations: readonly {
    readonly factor_a: string;
    readonly factor_b: string;
    readonly direction: 'POSITIVE' | 'NEGATIVE' | 'NON_LINEAR';
    readonly confidence_qualitative: 'HIGH' | 'MEDIUM' | 'LOW' | 'HYPOTHETICAL';
    readonly notes: string;
  }[];
}

export type AnyMemoryRecord =
  | EpisodicMemoryRecord
  | SemanticMemoryRecord
  | ProceduralMemoryRecord
  | StrategicMemoryRecord;

// Memory Lifecycle Events
export type MemoryEventType =
  | 'MEMORY_CREATED'
  | 'MEMORY_RETRIEVED'
  | 'MEMORY_PROPOSED'
  | 'MEMORY_VALIDATED'
  | 'MEMORY_SUPERSEDED'
  | 'MEMORY_REJECTED'
  | 'MEMORY_APPLICABILITY_MISMATCH';

export interface MemoryEvent {
  readonly event_id: string;
  readonly sequence_number: number;
  readonly event_type: MemoryEventType;
  readonly timestamp_utc: string;
  readonly investigation_id: string;
  readonly memory_id: string;
  readonly details: Record<string, unknown>;
  readonly jcs_sha256: string;
}

// Target Investigation Context for Retrieval
export interface InvestigationRetrievalContext {
  readonly investigation_id: string;
  readonly candidate_id: string;
  readonly category: string;
  readonly jurisdiction: string;
  readonly industry?: string;
  readonly archetype?: string;
  readonly signals_observed: readonly string[];
  readonly as_of_utc?: string;
}

export interface RetrievalMatchResult<T extends BaseMemoryRecord = BaseMemoryRecord> {
  readonly memory: T;
  readonly is_applicable: boolean;
  readonly applicability_reason: string;
  readonly relevance_score: number;
  readonly matched_criteria: readonly string[];
  readonly missing_criteria: readonly string[];
}
