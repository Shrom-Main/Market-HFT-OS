/**
 * POC-001: Persistent Living Gallery Store (Stage C)
 *
 * Implements persistent, event-driven queues for both Product Gallery and Thesis Gallery.
 * Supports disk journal persistence, event replay, reconnection, and idempotent projection updates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import {
  ProductQueueCandidate,
  ThesisQueueRecord,
  GalleryEventPayload,
  GalleryEventType,
  CandidateLocation,
  CandidateEntityRelationship,
  ThesisScope,
  ThesisLifecycleState
} from './galleryTypes.js';
import { DurableMemoryEventStore } from '../memory/durableEventStore.js';
import { OpportunityCategory } from '../canonical/opportunityCategory.js';
import { OpportunityLifecycleState, InvestigationStatus } from '../research/opportunityLifecycleEngine.js';

export class PersistentGalleryStore {
  private candidates: Map<string, ProductQueueCandidate> = new Map();
  private theses: Map<string, ThesisQueueRecord> = new Map();
  private galleryEvents: GalleryEventPayload[] = [];
  private sequenceCounter: number = 0;
  private readonly listeners: Set<(event: GalleryEventPayload) => void> = new Set();
  private readonly journalDir?: string;
  private readonly candidatesFile?: string;
  private readonly thesesFile?: string;
  private readonly eventsFile?: string;

  constructor(options?: {
    journalDir?: string;
    journalPath?: string;
    eventStore?: DurableMemoryEventStore;
  }) {
    if (options?.journalDir) {
      this.journalDir = options.journalDir;
    } else if (options?.journalPath) {
      this.journalDir = options.journalPath.endsWith('.jsonl')
        ? path.dirname(options.journalPath)
        : options.journalPath;
    }
    if (this.journalDir) {
      this.candidatesFile = path.join(this.journalDir, 'gallery_candidates.jsonl');
      this.thesesFile = path.join(this.journalDir, 'gallery_theses.jsonl');
      this.eventsFile = path.join(this.journalDir, 'gallery_events.jsonl');
      this.loadFromDisk();
    }
  }

  private loadFromDisk(): void {
    if (!this.journalDir) return;

    // 1. Load events
    if (this.eventsFile && fs.existsSync(this.eventsFile)) {
      try {
        const raw = fs.readFileSync(this.eventsFile, 'utf8');
        const lines = raw.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const ev = JSON.parse(line) as GalleryEventPayload;
          this.galleryEvents.push(ev);
          if (ev.sequence_number > this.sequenceCounter) {
            this.sequenceCounter = ev.sequence_number;
          }
        }
      } catch (err) {
        console.error(`[PersistentGalleryStore] Error loading events from ${this.eventsFile}:`, err);
      }
    }

    // 2. Load candidates
    if (this.candidatesFile && fs.existsSync(this.candidatesFile)) {
      try {
        const raw = fs.readFileSync(this.candidatesFile, 'utf8');
        const lines = raw.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const cand = JSON.parse(line) as ProductQueueCandidate;
          this.candidates.set(cand.candidate_id, cand);
        }
      } catch (err) {
        console.error(`[PersistentGalleryStore] Error loading candidates from ${this.candidatesFile}:`, err);
      }
    }

    // 3. Load theses
    if (this.thesesFile && fs.existsSync(this.thesesFile)) {
      try {
        const raw = fs.readFileSync(this.thesesFile, 'utf8');
        const lines = raw.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const th = JSON.parse(line) as ThesisQueueRecord;
          this.theses.set(th.thesis_id, th);
        }
      } catch (err) {
        console.error(`[PersistentGalleryStore] Error loading theses from ${this.thesesFile}:`, err);
      }
    }
  }

  private appendToDisk(filePath: string | undefined, data: unknown): void {
    if (!filePath) return;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(filePath, JSON.stringify(data) + '\n', 'utf8');
    } catch (err) {
      console.error(`[PersistentGalleryStore] Error writing to ${filePath}:`, err);
    }
  }

  private rewriteCandidates(): void {
    if (!this.candidatesFile) return;
    try {
      const dir = path.dirname(this.candidatesFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = Array.from(this.candidates.values())
        .map((c) => JSON.stringify(c))
        .join('\n') + '\n';
      fs.writeFileSync(this.candidatesFile, data, 'utf8');
    } catch (err) {
      console.error(`[PersistentGalleryStore] Error rewriting candidates:`, err);
    }
  }

  private rewriteTheses(): void {
    if (!this.thesesFile) return;
    try {
      const dir = path.dirname(this.thesesFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = Array.from(this.theses.values())
        .map((t) => JSON.stringify(t))
        .join('\n') + '\n';
      fs.writeFileSync(this.thesesFile, data, 'utf8');
    } catch (err) {
      console.error(`[PersistentGalleryStore] Error rewriting theses:`, err);
    }
  }

  public async emitGalleryEvent(params: {
    event_type: GalleryEventType;
    aggregate_type: 'CANDIDATE' | 'THESIS' | 'INVESTIGATION';
    aggregate_id: string;
    summary: string;
    details: Record<string, unknown>;
  }): Promise<GalleryEventPayload> {
    this.sequenceCounter += 1;
    const nowUtc = new Date().toISOString();
    const eventId = `GEVT-${Date.now()}-${this.sequenceCounter}`;

    const raw = {
      event_id: eventId,
      sequence_number: this.sequenceCounter,
      event_type: params.event_type,
      aggregate_type: params.aggregate_type,
      aggregate_id: params.aggregate_id,
      timestamp_utc: nowUtc,
      summary: params.summary,
      details: params.details
    };

    const hash = sha256(canonicalizeJCS(raw));
    const fullEvent: GalleryEventPayload = Object.freeze({ ...raw, jcs_sha256: hash });

    this.galleryEvents.push(fullEvent);
    this.appendToDisk(this.eventsFile, fullEvent);

    for (const listener of this.listeners) {
      try {
        listener(fullEvent);
      } catch (err) {
        console.error('[PersistentGalleryStore] Listener error:', err);
      }
    }

    return fullEvent;
  }

  // ============================================================================
  // 1. PRODUCT CANDIDATE QUEUE OPERATIONS
  // ============================================================================
  public async ingestDiscoveredCandidate(params: {
    candidate_id: string;
    canonical_product_id: string;
    name: string;
    category: OpportunityCategory;
    origin_class: 'LIVE_VERIFIED_CAPTURE' | 'RECORDED_GOLDEN_FIXTURE' | 'UNATTESTED_USER_INTAKE' | 'SPATIAL_DISCOVERY_SWEEP';
    source_url?: string;
    relevant_locations?: CandidateLocation[];
    entity_relationships?: CandidateEntityRelationship[];
    financial_summary?: {
      factory_gate_quote_inr?: number | null;
      prevailing_retail_asp_inr?: number | null;
      estimated_gross_margin_bps?: number | null;
      data_required_fields: readonly string[];
    };
    initial_supporting_evidence?: readonly string[];
  }): Promise<ProductQueueCandidate> {
    const nowUtc = new Date().toISOString();
    const initialEventSummary = `Candidate '${params.name}' discovered via ${params.origin_class}`;

    const raw: Omit<ProductQueueCandidate, 'jcs_sha256'> = {
      candidate_id: params.candidate_id,
      canonical_product_id: params.canonical_product_id,
      name: params.name,
      category: params.category,
      origin_class: params.origin_class,
      source_url: params.source_url,
      discovered_at_utc: nowUtc,
      updated_at_utc: nowUtc,
      lifecycle_state: 'NEW',
      supporting_evidence_ids: params.initial_supporting_evidence ? [...params.initial_supporting_evidence] : [],
      contradictory_evidence_ids: [],
      relevant_locations: params.relevant_locations ? [...params.relevant_locations] : [],
      entity_relationships: params.entity_relationships ? [...params.entity_relationships] : [],
      investigation_status: 'UNSCHEDULED',
      outstanding_tasks: [],
      applicable_procedural_memories: [],
      last_event_id: `GEVT-INIT-${params.candidate_id}`,
      last_event_type: 'CANDIDATE_DISCOVERED',
      last_event_summary: initialEventSummary,
      financial_summary: params.financial_summary
    };

    const hash = sha256(canonicalizeJCS(raw));
    const candidate: ProductQueueCandidate = { ...raw, jcs_sha256: hash };

    this.candidates.set(candidate.candidate_id, candidate);
    this.appendToDisk(this.candidatesFile, candidate);

    const ev = await this.emitGalleryEvent({
      event_type: 'CANDIDATE_DISCOVERED',
      aggregate_type: 'CANDIDATE',
      aggregate_id: candidate.candidate_id,
      summary: initialEventSummary,
      details: {
        category: candidate.category,
        origin_class: candidate.origin_class,
        source_url: candidate.source_url
      }
    });

    candidate.last_event_id = ev.event_id;
    this.rewriteCandidates();

    return candidate;
  }

  public async updateCandidate(
    candidateId: string,
    updates: Partial<Omit<ProductQueueCandidate, 'candidate_id' | 'discovered_at_utc' | 'jcs_sha256'>>,
    eventParams?: { event_type?: GalleryEventType; summary?: string; details?: Record<string, unknown> }
  ): Promise<ProductQueueCandidate> {
    const existing = this.candidates.get(candidateId);
    if (!existing) {
      throw new Error(`E-GALLERY-CANDIDATE-NOT-FOUND: Candidate '${candidateId}' does not exist in queue`);
    }

    const nowUtc = new Date().toISOString();
    const eventType = eventParams?.event_type ?? 'CANDIDATE_UPDATED';
    const summary = eventParams?.summary ?? `Updated candidate '${existing.name}'`;

    const ev = await this.emitGalleryEvent({
      event_type: eventType,
      aggregate_type: 'CANDIDATE',
      aggregate_id: candidateId,
      summary,
      details: eventParams?.details ?? {}
    });

    const merged: Omit<ProductQueueCandidate, 'jcs_sha256'> = {
      ...existing,
      ...updates,
      updated_at_utc: nowUtc,
      last_event_id: ev.event_id,
      last_event_type: eventType,
      last_event_summary: summary
    };

    const hash = sha256(canonicalizeJCS(merged));
    const updated: ProductQueueCandidate = { ...merged, jcs_sha256: hash };

    this.candidates.set(candidateId, updated);
    this.rewriteCandidates();

    return updated;
  }

  public async applyMemoryToCandidate(params: {
    candidate_id: string;
    memory_id: string;
    playbook_name: string;
    applicability_reason: string;
  }): Promise<ProductQueueCandidate> {
    const candidate = this.candidates.get(params.candidate_id);
    if (!candidate) {
      throw new Error(`E-GALLERY-CANDIDATE-NOT-FOUND: Candidate '${params.candidate_id}' not found`);
    }

    const nowUtc = new Date().toISOString();
    // Avoid duplicate memory application
    if (!candidate.applicable_procedural_memories.some((m) => m.memory_id === params.memory_id)) {
      candidate.applicable_procedural_memories.push({
        memory_id: params.memory_id,
        playbook_name: params.playbook_name,
        applicability_reason: params.applicability_reason,
        applied_at_utc: nowUtc
      });
    }

    return this.updateCandidate(
      params.candidate_id,
      { applicable_procedural_memories: candidate.applicable_procedural_memories },
      {
        event_type: 'MEMORY_APPLIED',
        summary: `Applied procedural playbook '${params.playbook_name}' (${params.memory_id})`,
        details: { memory_id: params.memory_id, playbook_name: params.playbook_name }
      }
    );
  }

  public async linkEvidenceToCandidate(params: {
    candidate_id: string;
    evidence_id: string;
    is_contradiction?: boolean;
    rationale?: string;
  }): Promise<ProductQueueCandidate> {
    const candidate = this.candidates.get(params.candidate_id);
    if (!candidate) {
      throw new Error(`E-GALLERY-CANDIDATE-NOT-FOUND: Candidate '${params.candidate_id}' not found`);
    }

    const isContradiction = params.is_contradiction ?? false;
    const eventType: GalleryEventType = isContradiction ? 'CONTRADICTION_DETECTED' : 'EVIDENCE_INGESTED';
    const summary = isContradiction
      ? `Contradiction detected on '${candidate.name}' via evidence ${params.evidence_id}: ${params.rationale || 'conflicting claims'}`
      : `Ingested supporting evidence ${params.evidence_id} for '${candidate.name}'`;

    if (isContradiction) {
      if (!candidate.contradictory_evidence_ids.includes(params.evidence_id)) {
        candidate.contradictory_evidence_ids.push(params.evidence_id);
      }
    } else {
      if (!candidate.supporting_evidence_ids.includes(params.evidence_id)) {
        candidate.supporting_evidence_ids.push(params.evidence_id);
      }
    }

    return this.updateCandidate(
      params.candidate_id,
      {
        supporting_evidence_ids: candidate.supporting_evidence_ids,
        contradictory_evidence_ids: candidate.contradictory_evidence_ids
      },
      {
        event_type: eventType,
        summary,
        details: { evidence_id: params.evidence_id, is_contradiction: isContradiction }
      }
    );
  }

  // ============================================================================
  // 2. THESIS QUEUE OPERATIONS
  // ============================================================================
  public async formulateThesis(params: {
    title: string;
    scope: ThesisScope;
    hypothesis_statement: string;
    originating_observations?: readonly string[];
    supporting_evidence_ids?: readonly string[];
    related_candidate_ids?: readonly string[];
    related_entity_ids?: readonly string[];
    related_locations?: readonly string[];
    uncertainty_rating?: 'LOW' | 'MEDIUM' | 'HIGH' | 'SPECULATIVE';
    thesis_id?: string;
  }): Promise<ThesisQueueRecord> {
    const nowUtc = new Date().toISOString();
    const thesisId = params.thesis_id ?? `THS-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const raw: Omit<ThesisQueueRecord, 'jcs_sha256'> = {
      thesis_id: thesisId,
      title: params.title,
      scope: params.scope,
      hypothesis_statement: params.hypothesis_statement,
      originating_observations: params.originating_observations ? [...params.originating_observations] : [],
      supporting_evidence_ids: params.supporting_evidence_ids ? [...params.supporting_evidence_ids] : [],
      disconfirming_evidence_ids: [],
      related_candidate_ids: params.related_candidate_ids ? [...params.related_candidate_ids] : [],
      related_entity_ids: params.related_entity_ids ? [...params.related_entity_ids] : [],
      related_locations: params.related_locations ? [...params.related_locations] : [],
      applicability: {},
      uncertainty_rating: params.uncertainty_rating ?? 'HIGH',
      investigation_history: [],
      lifecycle_state: 'NEW',
      revisions: [
        {
          revision_number: 1,
          previous_statement: '',
          updated_statement: params.hypothesis_statement,
          rationale: 'Initial formulation',
          timestamp_utc: nowUtc
        }
      ],
      created_at_utc: nowUtc,
      last_updated_utc: nowUtc
    };

    const hash = sha256(canonicalizeJCS(raw));
    const record: ThesisQueueRecord = { ...raw, jcs_sha256: hash };

    this.theses.set(record.thesis_id, record);
    this.appendToDisk(this.thesesFile, record);

    await this.emitGalleryEvent({
      event_type: 'THESIS_FORMULATED',
      aggregate_type: 'THESIS',
      aggregate_id: record.thesis_id,
      summary: `Formulated commercial thesis: '${params.title}' [${params.scope}]`,
      details: { title: params.title, scope: params.scope, uncertainty: record.uncertainty_rating }
    });

    return record;
  }

  public async reviseThesis(params: {
    thesis_id: string;
    updated_statement: string;
    rationale: string;
    triggering_evidence_id?: string;
    updated_uncertainty?: 'LOW' | 'MEDIUM' | 'HIGH' | 'SPECULATIVE';
    updated_state?: ThesisLifecycleState;
  }): Promise<ThesisQueueRecord> {
    const existing = this.theses.get(params.thesis_id);
    if (!existing) {
      throw new Error(`E-GALLERY-THESIS-NOT-FOUND: Thesis '${params.thesis_id}' not found`);
    }

    const nowUtc = new Date().toISOString();
    const newRevNum = existing.revisions.length + 1;

    existing.revisions.push({
      revision_number: newRevNum,
      previous_statement: existing.hypothesis_statement,
      updated_statement: params.updated_statement,
      rationale: params.rationale,
      timestamp_utc: nowUtc,
      triggering_evidence_id: params.triggering_evidence_id
    });

    existing.hypothesis_statement = params.updated_statement;
    if (params.updated_uncertainty) existing.uncertainty_rating = params.updated_uncertainty;
    if (params.updated_state) existing.lifecycle_state = params.updated_state;
    existing.last_updated_utc = nowUtc;

    if (params.triggering_evidence_id) {
      if (!existing.supporting_evidence_ids.includes(params.triggering_evidence_id)) {
        existing.supporting_evidence_ids.push(params.triggering_evidence_id);
      }
    }

    const raw = {
      thesis_id: existing.thesis_id,
      title: existing.title,
      scope: existing.scope,
      hypothesis_statement: existing.hypothesis_statement,
      originating_observations: existing.originating_observations,
      supporting_evidence_ids: existing.supporting_evidence_ids,
      disconfirming_evidence_ids: existing.disconfirming_evidence_ids,
      related_candidate_ids: existing.related_candidate_ids,
      related_entity_ids: existing.related_entity_ids,
      related_locations: existing.related_locations,
      applicability: existing.applicability,
      uncertainty_rating: existing.uncertainty_rating,
      investigation_history: existing.investigation_history,
      lifecycle_state: existing.lifecycle_state,
      revisions: existing.revisions,
      created_at_utc: existing.created_at_utc,
      last_updated_utc: existing.last_updated_utc
    };

    existing.jcs_sha256 = sha256(canonicalizeJCS(raw));
    this.rewriteTheses();

    await this.emitGalleryEvent({
      event_type: 'THESIS_REVISED',
      aggregate_type: 'THESIS',
      aggregate_id: existing.thesis_id,
      summary: `Revised thesis '${existing.title}' (Revision ${newRevNum}): ${params.rationale}`,
      details: {
        revision_number: newRevNum,
        rationale: params.rationale,
        triggering_evidence_id: params.triggering_evidence_id
      }
    });

    return existing;
  }

  public async linkEvidenceToThesis(params: {
    thesis_id: string;
    evidence_id: string;
    is_disconfirming?: boolean;
    investigation_id?: string;
    finding_summary?: string;
  }): Promise<ThesisQueueRecord> {
    const thesis = this.theses.get(params.thesis_id);
    if (!thesis) {
      throw new Error(`E-GALLERY-THESIS-NOT-FOUND: Thesis '${params.thesis_id}' not found`);
    }

    const nowUtc = new Date().toISOString();
    const isDisconfirming = params.is_disconfirming ?? false;

    if (isDisconfirming) {
      if (!thesis.disconfirming_evidence_ids.includes(params.evidence_id)) {
        thesis.disconfirming_evidence_ids.push(params.evidence_id);
      }
      thesis.uncertainty_rating = 'HIGH';
    } else {
      if (!thesis.supporting_evidence_ids.includes(params.evidence_id)) {
        thesis.supporting_evidence_ids.push(params.evidence_id);
      }
    }

    if (params.investigation_id && params.finding_summary) {
      thesis.investigation_history.push({
        investigation_id: params.investigation_id,
        timestamp_utc: nowUtc,
        finding: params.finding_summary,
        evidence_ids: [params.evidence_id]
      });
    }

    thesis.last_updated_utc = nowUtc;
    this.rewriteTheses();

    await this.emitGalleryEvent({
      event_type: isDisconfirming ? 'CONTRADICTION_DETECTED' : 'EVIDENCE_INGESTED',
      aggregate_type: 'THESIS',
      aggregate_id: thesis.thesis_id,
      summary: `Linked evidence ${params.evidence_id} to thesis '${thesis.title}' (${isDisconfirming ? 'DISCONFIRMING' : 'SUPPORTING'})`,
      details: { evidence_id: params.evidence_id, is_disconfirming: isDisconfirming }
    });

    return thesis;
  }

  // ============================================================================
  // 3. EVENT REPLAY & SUBSCRIPTION
  // ============================================================================
  public subscribe(listener: (event: GalleryEventPayload) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public replayEvents(sinceSequence: number = 0): readonly GalleryEventPayload[] {
    return this.galleryEvents.filter((e) => e.sequence_number > sinceSequence);
  }

  public getEvents(): readonly GalleryEventPayload[] {
    return this.galleryEvents;
  }

  public getCandidate(candidateId: string): ProductQueueCandidate | undefined {
    return this.candidates.get(candidateId);
  }

  public getAllCandidates(filter?: { category?: string; lifecycle_state?: OpportunityLifecycleState }): readonly ProductQueueCandidate[] {
    let list = Array.from(this.candidates.values());
    if (filter?.category) list = list.filter((c) => c.category === filter.category);
    if (filter?.lifecycle_state) list = list.filter((c) => c.lifecycle_state === filter.lifecycle_state);
    return list;
  }

  public getThesis(thesisId: string): ThesisQueueRecord | undefined {
    return this.theses.get(thesisId);
  }

  public getAllTheses(filter?: { scope?: ThesisScope; lifecycle_state?: ThesisLifecycleState }): readonly ThesisQueueRecord[] {
    let list = Array.from(this.theses.values());
    if (filter?.scope) list = list.filter((t) => t.scope === filter.scope);
    if (filter?.lifecycle_state) list = list.filter((t) => t.lifecycle_state === filter.lifecycle_state);
    return list;
  }

  public getCandidateCount(): number {
    return this.candidates.size;
  }

  public getThesisCount(): number {
    return this.theses.size;
  }

  public getEventCount(): number {
    return this.galleryEvents.length;
  }
}
