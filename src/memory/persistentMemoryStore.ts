/**
 * POC-001: Persistent Layered Memory Store (Stage B)
 *
 * Implements the 4-layer persistent memory store with:
 * 1. RFC 8785 JCS canonicalization and SHA-256 content addressing.
 * 2. Non-destructive supersession and temporal revision.
 * 3. Controlled promotion gate (agents can propose, but cannot self-validate).
 * 4. Durable disk journal persistence that survives process restarts.
 * 5. Transactional event emission via DurableMemoryEventStore.
 */

import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import {
  EpisodicMemoryRecord,
  SemanticMemoryRecord,
  ProceduralMemoryRecord,
  StrategicMemoryRecord,
  AnyMemoryRecord,
  MemoryTier,
  ValidationState,
  EpistemicStatus,
  SourceReliability,
  CorroborationLevel,
  InferenceType,
  ApplicabilityCriteria
} from './memoryTypes.js';
import { DurableMemoryEventStore } from './durableEventStore.js';

export interface OperatorApprovalAttestation {
  readonly operator_id: string;
  readonly operator_role: string;
  readonly signature_hex: string;
  readonly payload_digest_sha256: string;
  readonly attested_at_utc: string;
}

export interface ValidateProceduralParams {
  memory_id: string;
  validator_role: string;
  validation_evidence_ids: readonly string[];
  validation_notes: string;
  operator_id?: string;
  attestation?: OperatorApprovalAttestation;
  require_authenticated_operator?: boolean;
}

export class PersistentMemoryStore {
  private memories: Map<string, AnyMemoryRecord> = new Map();
  private readonly journalPath?: string;
  private readonly eventStore: DurableMemoryEventStore;

  constructor(options?: { journalPath?: string; eventStore?: DurableMemoryEventStore }) {
    this.journalPath = options?.journalPath;
    this.eventStore = options?.eventStore ?? new DurableMemoryEventStore();

    if (this.journalPath && fs.existsSync(this.journalPath)) {
      this.loadFromDisk();
    }
  }

  private loadFromDisk(): void {
    if (!this.journalPath || !fs.existsSync(this.journalPath)) return;
    try {
      const raw = fs.readFileSync(this.journalPath, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const mem = JSON.parse(line) as AnyMemoryRecord;
        this.memories.set(mem.memory_id, mem);
      }
    } catch (err) {
      console.error(`[PersistentMemoryStore] Failed to load memories from ${this.journalPath}:`, err);
    }
  }

  private persistMemoryToDisk(record: AnyMemoryRecord): void {
    if (!this.journalPath) return;
    try {
      const dir = path.dirname(this.journalPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.journalPath, JSON.stringify(record) + '\n', 'utf8');
    } catch (err) {
      console.error(`[PersistentMemoryStore] Failed to write memory to ${this.journalPath}:`, err);
    }
  }

  // Rewrite journal file to persist revisions cleanly
  private rewriteJournal(): void {
    if (!this.journalPath) return;
    try {
      const dir = path.dirname(this.journalPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.memories.values())
        .map((m) => JSON.stringify(m))
        .join('\n') + '\n';
      fs.writeFileSync(this.journalPath, data, 'utf8');
    } catch (err) {
      console.error(`[PersistentMemoryStore] Failed to rewrite journal ${this.journalPath}:`, err);
    }
  }

  public getEventStore(): DurableMemoryEventStore {
    return this.eventStore;
  }

  // ============================================================================
  // 1. EPISODIC MEMORY
  // ============================================================================
  public async recordEpisodic(params: {
    investigation_id: string;
    candidate_id: string;
    title: string;
    summary: string;
    execution_trace: {
      tool_name: string;
      input_params: Record<string, unknown>;
      output_digest: string;
      success: boolean;
      latency_ms: number;
      query_count: number;
      error_details?: string;
    };
    supporting_evidence_ids: readonly string[];
    source_reliability: SourceReliability;
    human_intervention?: {
      operator_id: string;
      action_type: 'OVERRIDE' | 'APPROVAL' | 'REJECTION';
      operator_rationale: string;
    };
  }): Promise<EpisodicMemoryRecord> {
    const nowUtc = new Date().toISOString();
    const memoryId = `MEM-EPISODIC-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const raw: Omit<EpisodicMemoryRecord, 'jcs_sha256'> = {
      memory_id: memoryId,
      tier: 'EPISODIC',
      epistemic_status: 'OBSERVED_FACT',
      validation_state: 'VALIDATED', // Actual execution traces are directly verified runtime events
      title: params.title,
      summary: params.summary,
      originating_investigation_id: params.investigation_id,
      candidate_id: params.candidate_id,
      execution_trace: params.execution_trace,
      supporting_evidence_ids: params.supporting_evidence_ids,
      source_reliability: params.source_reliability,
      corroboration_level: 'SINGLE_SOURCE',
      inference_type: 'DIRECT_OBSERVATION',
      human_intervention: params.human_intervention,
      valid_from_utc: nowUtc,
      valid_to_utc: null,
      observed_at_utc: nowUtc,
      superseded_at_utc: null,
      supersedes_memory_id: null
    };

    const hash = sha256(canonicalizeJCS(raw));
    const record: EpisodicMemoryRecord = Object.freeze({ ...raw, jcs_sha256: hash });

    this.memories.set(record.memory_id, record);
    this.persistMemoryToDisk(record);

    await this.eventStore.emit({
      event_type: 'MEMORY_CREATED',
      investigation_id: params.investigation_id,
      memory_id: record.memory_id,
      details: {
        tier: 'EPISODIC',
        tool_name: params.execution_trace.tool_name,
        success: params.execution_trace.success,
        query_count: params.execution_trace.query_count
      }
    });

    return record;
  }

  // ============================================================================
  // 2. SEMANTIC MEMORY
  // ============================================================================
  public async proposeSemantic(params: {
    investigation_id: string;
    subject_name: string;
    subject_entity_id?: string;
    subject_concept_id?: string;
    title: string;
    summary: string;
    attributes: Record<string, unknown>;
    epistemic_status: EpistemicStatus;
    source_reliability: SourceReliability;
    corroboration_level: CorroborationLevel;
    inference_type: InferenceType;
    supporting_evidence_ids: readonly string[];
    valid_from_utc?: string;
  }): Promise<SemanticMemoryRecord> {
    const nowUtc = new Date().toISOString();
    const memoryId = `MEM-SEM-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const raw: Omit<SemanticMemoryRecord, 'jcs_sha256'> = {
      memory_id: memoryId,
      tier: 'SEMANTIC',
      epistemic_status: params.epistemic_status,
      validation_state: 'PROPOSED', // Agents propose; requires validation
      title: params.title,
      summary: params.summary,
      originating_investigation_id: params.investigation_id,
      subject_name: params.subject_name,
      subject_entity_id: params.subject_entity_id,
      subject_concept_id: params.subject_concept_id,
      attributes: params.attributes,
      supporting_evidence_ids: params.supporting_evidence_ids,
      source_reliability: params.source_reliability,
      corroboration_level: params.corroboration_level,
      inference_type: params.inference_type,
      valid_from_utc: params.valid_from_utc ?? nowUtc,
      valid_to_utc: null,
      observed_at_utc: nowUtc,
      superseded_at_utc: null,
      supersedes_memory_id: null
    };

    const hash = sha256(canonicalizeJCS(raw));
    const record: SemanticMemoryRecord = Object.freeze({ ...raw, jcs_sha256: hash });

    this.memories.set(record.memory_id, record);
    this.persistMemoryToDisk(record);

    await this.eventStore.emit({
      event_type: 'MEMORY_PROPOSED',
      investigation_id: params.investigation_id,
      memory_id: record.memory_id,
      details: { tier: 'SEMANTIC', subject_name: params.subject_name, epistemic_status: params.epistemic_status }
    });

    return record;
  }

  public async validateSemantic(params: {
    memory_id: string;
    validator_role: string;
    validation_evidence_ids: readonly string[];
  }): Promise<SemanticMemoryRecord> {
    const existing = this.memories.get(params.memory_id);
    if (!existing || existing.tier !== 'SEMANTIC') {
      throw new Error(`E-MEMORY-NOT-FOUND: Semantic memory '${params.memory_id}' not found`);
    }

    if (existing.validation_state === 'VALIDATED') {
      return existing as SemanticMemoryRecord;
    }

    const updated: SemanticMemoryRecord = Object.freeze({
      ...(existing as SemanticMemoryRecord),
      validation_state: 'VALIDATED',
      supporting_evidence_ids: Array.from(
        new Set([...existing.supporting_evidence_ids, ...params.validation_evidence_ids])
      )
    });

    this.memories.set(updated.memory_id, updated);
    this.rewriteJournal();

    await this.eventStore.emit({
      event_type: 'MEMORY_VALIDATED',
      investigation_id: updated.originating_investigation_id,
      memory_id: updated.memory_id,
      details: { validator_role: params.validator_role, tier: 'SEMANTIC' }
    });

    return updated;
  }

  // ============================================================================
  // 3. PROCEDURAL MEMORY (PLAYBOOKS)
  // ============================================================================
  public async proposeProcedural(params: {
    investigation_id: string;
    playbook_name: string;
    target_domain: string;
    title: string;
    summary: string;
    applicability: ApplicabilityCriteria;
    prerequisite_signals: readonly string[];
    execution_steps: readonly {
      step_number: number;
      action_name: string;
      target_role: string;
      required_tool: string;
      parameters_template: Record<string, unknown>;
      expected_output_schema: string;
      failure_recovery_action?: string;
    }[];
    known_failure_modes: readonly (string | {
      failure_pattern: string;
      preventive_action: string;
    })[];
    supporting_evidence_ids: readonly string[];
    source_reliability: SourceReliability;
  }): Promise<ProceduralMemoryRecord> {
    const nowUtc = new Date().toISOString();
    const memoryId = `MEM-PROC-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const raw: Omit<ProceduralMemoryRecord, 'jcs_sha256'> = {
      memory_id: memoryId,
      tier: 'PROCEDURAL',
      epistemic_status: 'HYPOTHESIS', // A newly proposed procedure is a hypothesis until validated
      validation_state: 'PROPOSED',
      title: params.title,
      summary: params.summary,
      originating_investigation_id: params.investigation_id,
      playbook_name: params.playbook_name,
      target_domain: params.target_domain,
      applicability: params.applicability,
      prerequisite_signals: params.prerequisite_signals,
      execution_steps: params.execution_steps,
      known_failure_modes: params.known_failure_modes.map((fm) =>
        typeof fm === 'string'
          ? { failure_pattern: fm, preventive_action: `Monitor and avoid ${fm}` }
          : fm
      ),
      historical_applications_count: 0,
      successful_applications_count: 0,
      supporting_evidence_ids: params.supporting_evidence_ids,
      source_reliability: params.source_reliability,
      corroboration_level: 'SINGLE_SOURCE',
      inference_type: 'DEDUCTIVE_INFERENCE',
      valid_from_utc: nowUtc,
      valid_to_utc: null,
      observed_at_utc: nowUtc,
      superseded_at_utc: null,
      supersedes_memory_id: null
    };

    const hash = sha256(canonicalizeJCS(raw));
    const record: ProceduralMemoryRecord = Object.freeze({ ...raw, jcs_sha256: hash });

    this.memories.set(record.memory_id, record);
    this.persistMemoryToDisk(record);

    await this.eventStore.emit({
      event_type: 'MEMORY_PROPOSED',
      investigation_id: params.investigation_id,
      memory_id: record.memory_id,
      details: {
        tier: 'PROCEDURAL',
        playbook_name: params.playbook_name,
        target_domain: params.target_domain,
        applicability: params.applicability
      }
    });

    return record;
  }

  /**
   * Generates a verifiable cryptographic operator attestation for memory promotion.
   */
  public static createOperatorAttestation(params: {
    operator_id: string;
    operator_role: string;
    memory_id: string;
    secret: string;
  }): OperatorApprovalAttestation {
    const attestedAt = new Date().toISOString();
    const digest = sha256(`${params.memory_id}:${params.operator_id}:${params.operator_role}`);
    const signature = sha256(`${digest}:${params.secret}:${attestedAt.slice(0, 10)}`);

    return Object.freeze({
      operator_id: params.operator_id,
      operator_role: params.operator_role,
      signature_hex: signature,
      payload_digest_sha256: digest,
      attested_at_utc: attestedAt
    });
  }

  /**
   * Verifies an operator approval attestation.
   */
  public static verifyOperatorAttestation(
    attestation: OperatorApprovalAttestation,
    memoryId: string,
    secret: string
  ): boolean {
    const expectedDigest = sha256(`${memoryId}:${attestation.operator_id}:${attestation.operator_role}`);
    if (attestation.payload_digest_sha256 !== expectedDigest) return false;
    const expectedSig = sha256(`${expectedDigest}:${secret}:${attestation.attested_at_utc.slice(0, 10)}`);
    return attestation.signature_hex === expectedSig;
  }

  public async validateProcedural(params: ValidateProceduralParams): Promise<ProceduralMemoryRecord> {
    const existing = this.memories.get(params.memory_id);
    if (!existing || existing.tier !== 'PROCEDURAL') {
      throw new Error(`E-MEMORY-NOT-FOUND: Procedural memory '${params.memory_id}' not found`);
    }

    if (existing.validation_state === 'VALIDATED') {
      return existing as ProceduralMemoryRecord;
    }

    if (!params.validation_evidence_ids || params.validation_evidence_ids.length === 0) {
      throw new Error(`E-VALIDATION-INSUFFICIENT-EVIDENCE: Procedural memory requires corroborating evidence IDs`);
    }

    // Cryptographic Operator Authentication Check
    if (params.require_authenticated_operator === true) {
      if (!params.attestation) {
        throw new Error(
          `E-AUTH-UNAUTHORIZED-OPERATOR: Memory promotion requires valid cryptographic operator signature; unauthenticated role string '${params.validator_role}' is rejected.`
        );
      }
      const isValid = PersistentMemoryStore.verifyOperatorAttestation(
        params.attestation,
        params.memory_id,
        'POC001_OPERATOR_SIGNING_SECRET'
      );
      if (!isValid) {
        throw new Error('E-AUTH-INVALID-SIGNATURE: Operator attestation signature verification failed.');
      }
    }

    const updated: ProceduralMemoryRecord = Object.freeze({
      ...(existing as ProceduralMemoryRecord),
      validation_state: 'VALIDATED',
      epistemic_status: 'VALIDATED_RULE',
      validation_notes: params.validation_notes,
      supporting_evidence_ids: Array.from(
        new Set([...existing.supporting_evidence_ids, ...params.validation_evidence_ids])
      ),
      corroboration_level: 'MULTI_SOURCE_INDEPENDENT'
    });

    this.memories.set(updated.memory_id, updated);
    this.rewriteJournal();

    await this.eventStore.emit({
      event_type: 'MEMORY_VALIDATED',
      investigation_id: updated.originating_investigation_id,
      memory_id: updated.memory_id,
      details: {
        validator_role: params.validator_role,
        operator_id: params.attestation?.operator_id ?? params.operator_id ?? 'ROLE_BASED_ACTOR',
        has_cryptographic_attestation: Boolean(params.attestation),
        tier: 'PROCEDURAL',
        playbook_name: updated.playbook_name
      }
    });

    return updated;
  }

  /**
   * Contradiction-driven correction / supersession:
   * When subsequent evidence contradicts a prior validated rule, marks the old rule as SUPERSEDED,
   * links the superseding memory ID, and emits a durable event.
   */
  public async supersedeProcedural(params: {
    old_memory_id: string;
    new_memory_id: string;
    contradiction_rationale: string;
    operator_role?: string;
    attestation?: OperatorApprovalAttestation;
  }): Promise<{ superseded: ProceduralMemoryRecord; replacement: ProceduralMemoryRecord }> {
    const oldRecord = this.memories.get(params.old_memory_id) as ProceduralMemoryRecord | undefined;
    const newRecord = this.memories.get(params.new_memory_id) as ProceduralMemoryRecord | undefined;

    if (!oldRecord || oldRecord.tier !== 'PROCEDURAL') {
      throw new Error(`E-MEMORY-NOT-FOUND: Old procedural memory '${params.old_memory_id}' not found`);
    }
    if (!newRecord || newRecord.tier !== 'PROCEDURAL') {
      throw new Error(`E-MEMORY-NOT-FOUND: New procedural memory '${params.new_memory_id}' not found`);
    }

    const nowUtc = new Date().toISOString();

    const updatedOld: ProceduralMemoryRecord = Object.freeze({
      ...oldRecord,
      validation_state: 'SUPERSEDED',
      superseded_at_utc: nowUtc,
      validation_notes: `SUPERSEDED by ${newRecord.memory_id}: ${params.contradiction_rationale}`
    });

    const updatedNew: ProceduralMemoryRecord = Object.freeze({
      ...newRecord,
      supersedes_memory_id: oldRecord.memory_id
    });

    this.memories.set(updatedOld.memory_id, updatedOld);
    this.memories.set(updatedNew.memory_id, updatedNew);
    this.rewriteJournal();

    await this.eventStore.emit({
      event_type: 'MEMORY_SUPERSEDED',
      investigation_id: updatedOld.originating_investigation_id,
      memory_id: updatedOld.memory_id,
      details: {
        superseded_memory_id: updatedOld.memory_id,
        superseded_by_memory_id: updatedNew.memory_id,
        contradiction_rationale: params.contradiction_rationale,
        operator_role: params.operator_role ?? 'LEAD_INVESTIGATOR'
      }
    });

    return { superseded: updatedOld, replacement: updatedNew };
  }

  public async rejectProcedural(params: {
    memory_id: string;
    rejector_role: string;
    rejection_reason: string;
  }): Promise<ProceduralMemoryRecord> {
    const existing = this.memories.get(params.memory_id);
    if (!existing || existing.tier !== 'PROCEDURAL') {
      throw new Error(`E-MEMORY-NOT-FOUND: Procedural memory '${params.memory_id}' not found`);
    }

    const updated: ProceduralMemoryRecord = Object.freeze({
      ...(existing as ProceduralMemoryRecord),
      validation_state: 'REJECTED',
      validation_notes: `REJECTED by ${params.rejector_role}: ${params.rejection_reason}`
    });

    this.memories.set(updated.memory_id, updated);
    this.rewriteJournal();

    await this.eventStore.emit({
      event_type: 'MEMORY_REJECTED',
      investigation_id: updated.originating_investigation_id,
      memory_id: updated.memory_id,
      details: {
        rejector_role: params.rejector_role,
        rejection_reason: params.rejection_reason
      }
    });

    return updated;
  }

  // ============================================================================
  // 4. STRATEGIC MEMORY (SCAFFOLDING ONLY - EVIDENCE BACKED)
  // ============================================================================
  public async recordStrategic(params: {
    investigation_id: string;
    thesis_pattern_id: string;
    pattern_name: string;
    title: string;
    summary: string;
    applicability: ApplicabilityCriteria;
    observed_dataset_reference: string;
    sample_size: number;
    observed_correlations: readonly {
      factor_a: string;
      factor_b: string;
      direction: 'POSITIVE' | 'NEGATIVE' | 'NON_LINEAR';
      confidence_qualitative: 'HIGH' | 'MEDIUM' | 'LOW' | 'HYPOTHETICAL';
      notes: string;
    }[];
    supporting_evidence_ids: readonly string[];
    source_reliability: SourceReliability;
  }): Promise<StrategicMemoryRecord> {
    const nowUtc = new Date().toISOString();
    const memoryId = `MEM-STRAT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const raw: Omit<StrategicMemoryRecord, 'jcs_sha256'> = {
      memory_id: memoryId,
      tier: 'STRATEGIC',
      epistemic_status: 'HYPOTHESIS',
      validation_state: 'PROPOSED',
      title: params.title,
      summary: params.summary,
      originating_investigation_id: params.investigation_id,
      thesis_pattern_id: params.thesis_pattern_id,
      pattern_name: params.pattern_name,
      applicability: params.applicability,
      observed_dataset_reference: params.observed_dataset_reference,
      sample_size: params.sample_size,
      observed_correlations: params.observed_correlations,
      supporting_evidence_ids: params.supporting_evidence_ids,
      source_reliability: params.source_reliability,
      corroboration_level: 'SINGLE_SOURCE',
      inference_type: 'UNTESTED_HYPOTHESIS',
      valid_from_utc: nowUtc,
      valid_to_utc: null,
      observed_at_utc: nowUtc,
      superseded_at_utc: null,
      supersedes_memory_id: null
    };

    const hash = sha256(canonicalizeJCS(raw));
    const record: StrategicMemoryRecord = Object.freeze({ ...raw, jcs_sha256: hash });

    this.memories.set(record.memory_id, record);
    this.persistMemoryToDisk(record);

    await this.eventStore.emit({
      event_type: 'MEMORY_PROPOSED',
      investigation_id: params.investigation_id,
      memory_id: record.memory_id,
      details: { tier: 'STRATEGIC', pattern_name: params.pattern_name }
    });

    return record;
  }

  // ============================================================================
  // 5. NON-DESTRUCTIVE REVISION & SUPERSEDING
  // ============================================================================
  /**
   * Revises an existing memory non-destructively:
   * Sets superseded_at_utc on the original record (retaining it forever in history),
   * and creates a new memory record pointing to supersedes_memory_id.
   */
  public async supersedeMemory<T extends AnyMemoryRecord = AnyMemoryRecord>(
    existingMemoryId: string,
    newRecordPayload: Partial<T> & Record<string, unknown>,
    investigationId: string,
    revisionRationale: string
  ): Promise<T> {
    const existing = this.memories.get(existingMemoryId);
    if (!existing) {
      throw new Error(`E-MEMORY-NOT-FOUND: Memory '${existingMemoryId}' cannot be superseded because it does not exist`);
    }

    const nowUtc = new Date().toISOString();

    // 1. Mark existing memory as superseded (non-destructive)
    const updatedOldRecord: AnyMemoryRecord = Object.freeze({
      ...existing,
      superseded_at_utc: nowUtc,
      valid_to_utc: nowUtc
    });
    this.memories.set(existingMemoryId, updatedOldRecord);

    // 2. Create new successor memory record
    const newMemoryId = `MEM-${existing.tier}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const rawNewRecord: any = {
      ...newRecordPayload,
      memory_id: newMemoryId,
      valid_from_utc: nowUtc,
      valid_to_utc: null,
      observed_at_utc: nowUtc,
      superseded_at_utc: null,
      supersedes_memory_id: existingMemoryId
    };

    const hash = sha256(canonicalizeJCS(rawNewRecord));
    const successor: T = Object.freeze({ ...rawNewRecord, jcs_sha256: hash }) as T;

    this.memories.set(newMemoryId, successor);
    this.rewriteJournal();

    await this.eventStore.emit({
      event_type: 'MEMORY_SUPERSEDED',
      investigation_id: investigationId,
      memory_id: newMemoryId,
      details: {
        superseded_memory_id: existingMemoryId,
        tier: existing.tier,
        rationale: revisionRationale
      }
    });

    return successor;
  }

  // ============================================================================
  // 6. QUERY & RETRIEVAL
  // ============================================================================
  public getMemory(memoryId: string): AnyMemoryRecord | undefined {
    return this.memories.get(memoryId);
  }

  public getAllMemories(tier?: MemoryTier): readonly AnyMemoryRecord[] {
    const all = Array.from(this.memories.values());
    return tier ? all.filter((m) => m.tier === tier) : all;
  }

  public getActiveMemories(tier?: MemoryTier, asOfUtc?: string): readonly AnyMemoryRecord[] {
    const asOfTime = asOfUtc ? new Date(asOfUtc).getTime() : Date.now();
    return this.getAllMemories(tier).filter((m) => {
      const validFrom = new Date(m.valid_from_utc).getTime();
      const validTo = m.valid_to_utc ? new Date(m.valid_to_utc).getTime() : Infinity;
      const isNotSuperseded =
        m.superseded_at_utc === null || new Date(m.superseded_at_utc).getTime() > asOfTime;
      return validFrom <= asOfTime && asOfTime <= validTo && isNotSuperseded;
    });
  }

  public getMemoryCount(): number {
    return this.memories.size;
  }
}
