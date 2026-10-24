/**
 * POC-001: Opportunity Domain & Lifecycle State Machine
 * Gate Slice 1 / Master Implementation Framework
 *
 * Implements:
 * 1. STABLE IDENTITY: candidate_id = "OPP-" + sha256(strategy_id + ":" + canonical_product_id).slice(0, 16).
 *    Independent of mutable commercial observations (prices, quotes, inventory).
 * 2. FOUR ORTHOGONAL DIMENSIONS:
 *    - Lifecycle State: NEW | INVESTIGATE | UNDER_REVIEW | VERIFIED | PAPER_ELIGIBLE | DEFERRED | REJECTED
 *    - Observation Signals: INITIAL_OBSERVATION | PRICE_CHANGED | GRIEVANCE_SURFACED | SUPPLIER_QUOTE_UPDATED | EVIDENCE_CONFLICT_DETECTED | EVIDENCE_STALE | SPEC_MODIFIED | UNCHANGED
 *    - Investigation Status: UNSCHEDULED | PENDING | IN_PROGRESS | COMPLETED | FAILED | AWAITING_HUMAN_REVIEW
 *    - Evidence Sufficiency: Evaluates explicit field presence without guessing or synthetic averaging.
 * 3. HASH-CHAINED AUDIT TRAIL: Merkle-chained CandidateLifecycleEvent records with previous_event_hash and RFC 8785 JCS digests.
 * 4. FAIL-CLOSED PAPER COMMIT GATE: Only VERIFIED candidates with full evidence sufficiency can be authorized for paper simulation.
 * 5. POSTGRESQL 16.8 PERSISTENCE: market_opportunity_candidates & market_candidate_lifecycle_events with zero-loss in-memory fallback.
 */

import type { Pool } from 'pg';
import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';

// ============================================================================
// 1. DATA CONTRACTS & TYPES
// ============================================================================

export type OpportunityLifecycleState =
  | 'NEW'
  | 'INVESTIGATE'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'PAPER_ELIGIBLE'
  | 'DEFERRED'
  | 'REJECTED';

export type ObservationChangeSignal =
  | 'INITIAL_OBSERVATION'
  | 'PRICE_CHANGED'
  | 'GRIEVANCE_SURFACED'
  | 'SUPPLIER_QUOTE_UPDATED'
  | 'EVIDENCE_CONFLICT_DETECTED'
  | 'EVIDENCE_STALE'
  | 'SPEC_MODIFIED'
  | 'UNCHANGED';

export type InvestigationStatus =
  | 'UNSCHEDULED'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'AWAITING_HUMAN_REVIEW';

export type LifecycleTrigger =
  | 'OBSERVATION_INGESTED'
  | 'INVESTIGATION_DISPATCHED'
  | 'INVESTIGATION_RESOLVED'
  | 'OPERATOR_DECISION'
  | 'SUFFICIENCY_EVALUATED'
  | 'EVALUATION_FAILED'
  | 'SOURCE_FAULT_DETECTED';

export interface EvidenceSufficiencyProfile {
  readonly is_sufficient_for_underwriting: boolean;
  readonly sufficiency_score_bps: number; // 0 to 10,000 (0.00% to 100.00%)
  readonly has_upstream_quote: boolean;
  readonly has_prevailing_asp: boolean;
  readonly has_verbatim_reviews: boolean;
  readonly has_logistics_route: boolean;
  readonly has_regulatory_clearance: boolean;
  readonly missing_critical_fields: readonly string[];
  readonly uncorroborated_fields: readonly string[];
  readonly last_evaluated_at_utc: string;
}

export interface CommercialAttractivenessEstimate {
  readonly estimated_gross_spread_inr: number | null;
  readonly estimated_gross_margin_bps: number | null;
  readonly attractiveness_rating: 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW' | 'NEGATIVE' | 'UNKNOWN';
  readonly heuristic_rationale: string;
  readonly calculation_epistemic_class: 'ESTIMATED_PROXY' | 'UNATTESTED_INTAKE';
}

export interface CandidateObservationSnapshot {
  readonly observation_id: string;
  readonly source_connector_id: string;
  readonly observed_at_utc: string;
  readonly prevailing_retail_asp_inr: number | null;
  readonly factory_gate_quote_inr: number | null;
  readonly unit_batch_moq: number | null;
  readonly observed_seller_count: number | null;
  readonly review_sentiment_summary: string | null;
  readonly raw_payload_snippet?: string;
  readonly payload_sha256: string;
}

export interface OpportunityCandidate {
  readonly candidate_id: string; // Stable: OPP-<sha256(strategy_id + ":" + canonical_product_id).slice(0, 16)>
  readonly strategy_id: string;
  readonly canonical_product_id: string;
  readonly candidate_name: string;
  readonly lifecycle_state: OpportunityLifecycleState;
  readonly active_signals: readonly ObservationChangeSignal[];
  readonly investigation_status: InvestigationStatus;
  readonly evidence_sufficiency: EvidenceSufficiencyProfile;
  readonly commercial_attractiveness: CommercialAttractivenessEstimate;
  readonly current_observation: CandidateObservationSnapshot;
  readonly observation_history_count: number;
  readonly latest_transition_reason: string;
  readonly first_seen_utc: string;
  readonly last_seen_utc: string;
  readonly updated_at_utc: string;
  readonly jcs_sha256: string;
}

export interface CandidateLifecycleEvent {
  readonly event_id: string;
  readonly candidate_id: string;
  readonly previous_state: OpportunityLifecycleState;
  readonly next_state: OpportunityLifecycleState;
  readonly signal: ObservationChangeSignal;
  readonly trigger: LifecycleTrigger;
  readonly operator_id?: string;
  readonly transition_reason: string;
  readonly previous_event_hash: string;
  readonly event_hash: string;
  readonly timestamp_utc: string;
}

export interface IngestObservationInput {
  readonly strategy_id: string;
  readonly canonical_product_id: string;
  readonly candidate_name: string;
  readonly source_connector_id: string;
  readonly prevailing_retail_asp_inr?: number | null;
  readonly factory_gate_quote_inr?: number | null;
  readonly unit_batch_moq?: number | null;
  readonly observed_seller_count?: number | null;
  readonly review_sentiment_summary?: string | null;
  readonly raw_payload?: string | null;
  readonly has_logistics_route?: boolean;
  readonly has_regulatory_clearance?: boolean;
  readonly observed_at_utc?: string;
}

export interface CandidateFilter {
  readonly strategy_id?: string;
  readonly lifecycle_state?: OpportunityLifecycleState;
  readonly investigation_status?: InvestigationStatus;
  readonly min_attractiveness_rating?: 'VERY_HIGH' | 'HIGH' | 'MODERATE' | 'LOW';
  readonly is_sufficient_for_underwriting?: boolean;
}

// ============================================================================
// 2. STATE MACHINE TRANSITION GRAPH (Fail-Closed)
// ============================================================================

const PERMITTED_TRANSITIONS: Readonly<Record<OpportunityLifecycleState, readonly OpportunityLifecycleState[]>> = {
  NEW: ['INVESTIGATE', 'DEFERRED', 'REJECTED'],
  INVESTIGATE: ['UNDER_REVIEW', 'DEFERRED', 'REJECTED'],
  UNDER_REVIEW: ['VERIFIED', 'INVESTIGATE', 'DEFERRED', 'REJECTED'],
  VERIFIED: ['PAPER_ELIGIBLE', 'UNDER_REVIEW', 'DEFERRED', 'REJECTED'],
  PAPER_ELIGIBLE: ['VERIFIED', 'DEFERRED'],
  DEFERRED: ['INVESTIGATE', 'REJECTED'],
  REJECTED: ['INVESTIGATE'] // Requires explicit override rationale >= 15 chars
};

// ============================================================================
// 3. OPPORTUNITY LIFECYCLE ENGINE
// ============================================================================

export interface OpportunityLifecycleEngineOptions {
  readonly pgPool?: Pool;
}

export class OpportunityLifecycleEngine {
  private readonly pgPool?: Pool;
  private isInitialized = false;

  // In-memory fallback stores
  private readonly inMemoryCandidates = new Map<string, OpportunityCandidate>();
  private readonly inMemoryEvents = new Map<string, CandidateLifecycleEvent[]>();

  constructor(options?: OpportunityLifecycleEngineOptions) {
    this.pgPool = options?.pgPool;
  }

  /**
   * Initializes PostgreSQL schema idempotently.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (this.pgPool) {
      try {
        await this.pgPool.query(`
          CREATE TABLE IF NOT EXISTS market_opportunity_candidates (
            candidate_id VARCHAR(64) PRIMARY KEY,
            strategy_id VARCHAR(128) NOT NULL,
            canonical_product_id VARCHAR(128) NOT NULL,
            candidate_name TEXT NOT NULL,
            lifecycle_state VARCHAR(32) NOT NULL,
            active_signals JSONB NOT NULL,
            investigation_status VARCHAR(32) NOT NULL,
            evidence_sufficiency JSONB NOT NULL,
            commercial_attractiveness JSONB NOT NULL,
            current_observation JSONB NOT NULL,
            observation_history_count INT NOT NULL DEFAULT 1,
            latest_transition_reason TEXT NOT NULL,
            first_seen_utc TIMESTAMPTZ NOT NULL,
            last_seen_utc TIMESTAMPTZ NOT NULL,
            updated_at_utc TIMESTAMPTZ NOT NULL,
            jcs_sha256 CHAR(64) NOT NULL
          );

          CREATE TABLE IF NOT EXISTS market_candidate_lifecycle_events (
            event_id VARCHAR(64) PRIMARY KEY,
            candidate_id VARCHAR(64) NOT NULL REFERENCES market_opportunity_candidates(candidate_id) ON DELETE CASCADE,
            previous_state VARCHAR(32) NOT NULL,
            next_state VARCHAR(32) NOT NULL,
            signal VARCHAR(64) NOT NULL,
            trigger VARCHAR(64) NOT NULL,
            operator_id VARCHAR(64),
            transition_reason TEXT NOT NULL,
            previous_event_hash CHAR(64) NOT NULL,
            event_hash CHAR(64) NOT NULL,
            timestamp_utc TIMESTAMPTZ NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_opp_cand_state ON market_opportunity_candidates(lifecycle_state);
          CREATE INDEX IF NOT EXISTS idx_opp_cand_strat ON market_opportunity_candidates(strategy_id);
          CREATE INDEX IF NOT EXISTS idx_opp_events_cand ON market_candidate_lifecycle_events(candidate_id, timestamp_utc);
        `);
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres table initialization warning:', err?.message ?? String(err));
      }
    }

    this.isInitialized = true;
  }

  /**
   * Computes deterministic, immutable Candidate ID from strategy and canonical product identity.
   * Stable across price changes, quote refreshes, and connector re-runs.
   */
  public static computeCandidateId(strategyId: string, canonicalProductId: string): string {
    const seed = `${strategyId.trim().toLowerCase()}::${canonicalProductId.trim().toLowerCase()}`;
    return `OPP-${sha256(seed).slice(0, 16).toUpperCase()}`;
  }

  /**
   * Ingests a new or updated observation for a candidate.
   * Performs delta detection, evidence sufficiency profiling, and provisional attractiveness estimation.
   */
  public async ingestObservation(input: IngestObservationInput): Promise<{
    candidate: OpportunityCandidate;
    signal: ObservationChangeSignal;
    is_new: boolean;
  }> {
    await this.initialize();

    const candidateId = OpportunityLifecycleEngine.computeCandidateId(input.strategy_id, input.canonical_product_id);
    const nowUtc = new Date().toISOString();
    const observedAtUtc = input.observed_at_utc ?? nowUtc;

    const existing = await this.getCandidate(candidateId);
    const isNew = existing === null;

    // Build observation snapshot
    const rawPayload = input.raw_payload ?? '';
    const contentToHash = rawPayload || `${input.prevailing_retail_asp_inr ?? ''}:${input.factory_gate_quote_inr ?? ''}:${input.unit_batch_moq ?? ''}:${input.observed_seller_count ?? ''}:${input.review_sentiment_summary ?? ''}`;
    const payloadHash = sha256(contentToHash);
    const observationId = `OBS-${sha256(candidateId + observedAtUtc + payloadHash).slice(0, 12).toUpperCase()}`;

    const newObservation: CandidateObservationSnapshot = {
      observation_id: observationId,
      source_connector_id: input.source_connector_id,
      observed_at_utc: observedAtUtc,
      prevailing_retail_asp_inr: input.prevailing_retail_asp_inr ?? existing?.current_observation.prevailing_retail_asp_inr ?? null,
      factory_gate_quote_inr: input.factory_gate_quote_inr ?? existing?.current_observation.factory_gate_quote_inr ?? null,
      unit_batch_moq: input.unit_batch_moq ?? existing?.current_observation.unit_batch_moq ?? null,
      observed_seller_count: input.observed_seller_count ?? existing?.current_observation.observed_seller_count ?? null,
      review_sentiment_summary: input.review_sentiment_summary ?? existing?.current_observation.review_sentiment_summary ?? null,
      raw_payload_snippet: rawPayload ? rawPayload.slice(0, 200) : undefined,
      payload_sha256: payloadHash
    };

    // Delta detection against existing observation
    let detectedSignal: ObservationChangeSignal = 'UNCHANGED';
    if (isNew) {
      detectedSignal = 'INITIAL_OBSERVATION';
    } else {
      const prevObs = existing.current_observation;
      const prevAsp = prevObs.prevailing_retail_asp_inr;
      const newAsp = newObservation.prevailing_retail_asp_inr;
      const prevQuote = prevObs.factory_gate_quote_inr;
      const newQuote = newObservation.factory_gate_quote_inr;

      if (prevAsp !== null && newAsp !== null && prevAsp !== newAsp) {
        detectedSignal = 'PRICE_CHANGED';
      } else if (prevQuote !== null && newQuote !== null && prevQuote !== newQuote) {
        detectedSignal = 'SUPPLIER_QUOTE_UPDATED';
      } else if (
        input.review_sentiment_summary &&
        input.review_sentiment_summary !== prevObs.review_sentiment_summary &&
        (input.review_sentiment_summary.toLowerCase().includes('defect') ||
          input.review_sentiment_summary.toLowerCase().includes('complaint') ||
          input.review_sentiment_summary.toLowerCase().includes('broke') ||
          input.review_sentiment_summary.toLowerCase().includes('poor'))
      ) {
        detectedSignal = 'GRIEVANCE_SURFACED';
      } else if (prevObs.payload_sha256 !== newObservation.payload_sha256) {
        detectedSignal = 'SPEC_MODIFIED';
      }
    }

    // Evaluate evidence sufficiency
    const sufficiency = this.computeSufficiencyProfile({
      quote: newObservation.factory_gate_quote_inr,
      asp: newObservation.prevailing_retail_asp_inr,
      sentiment: newObservation.review_sentiment_summary,
      hasRoute: input.has_logistics_route ?? (existing?.evidence_sufficiency.has_logistics_route ?? false),
      hasReg: input.has_regulatory_clearance ?? (existing?.evidence_sufficiency.has_regulatory_clearance ?? false),
      nowUtc
    });

    // Evaluate provisional commercial attractiveness
    const attractiveness = this.computeCommercialAttractiveness(
      newObservation.factory_gate_quote_inr,
      newObservation.prevailing_retail_asp_inr
    );

    // Active signals aggregation: keep stale/conflict flags if not resolved
    const signalsSet = new Set<ObservationChangeSignal>();
    if (detectedSignal !== 'UNCHANGED') {
      signalsSet.add(detectedSignal);
    }
    if (existing) {
      for (const sig of existing.active_signals) {
        if (sig === 'EVIDENCE_STALE' && detectedSignal !== 'INITIAL_OBSERVATION' && detectedSignal !== 'UNCHANGED') {
          // Fresh observation clears stale flag
          continue;
        }
        if (sig !== 'UNCHANGED') {
          signalsSet.add(sig);
        }
      }
    }
    const activeSignals = Array.from(signalsSet);

    // Determine target lifecycle state
    let targetState: OpportunityLifecycleState = existing ? existing.lifecycle_state : 'NEW';
    let transitionReason = existing?.latest_transition_reason ?? 'Initial candidate discovery from marketplace listing';

    if (isNew) {
      targetState = 'NEW';
      transitionReason = `Initial candidate discovered from ${input.source_connector_id}`;
    } else if (detectedSignal === 'PRICE_CHANGED') {
      transitionReason = `Observed retail price change: ₹${existing.current_observation.prevailing_retail_asp_inr} -> ₹${newObservation.prevailing_retail_asp_inr}`;
    } else if (detectedSignal === 'SUPPLIER_QUOTE_UPDATED') {
      transitionReason = `Updated supplier quote: ₹${existing.current_observation.factory_gate_quote_inr} -> ₹${newObservation.factory_gate_quote_inr}`;
    }

    // Build candidate representation
    const historyCount = (existing?.observation_history_count ?? 0) + (detectedSignal === 'UNCHANGED' ? 0 : 1);
    const candidateData = {
      candidate_id: candidateId,
      strategy_id: input.strategy_id,
      canonical_product_id: input.canonical_product_id,
      candidate_name: input.candidate_name,
      lifecycle_state: targetState,
      active_signals: activeSignals,
      investigation_status: existing?.investigation_status ?? 'UNSCHEDULED',
      evidence_sufficiency: sufficiency,
      commercial_attractiveness: attractiveness,
      current_observation: newObservation,
      observation_history_count: Math.max(1, historyCount),
      latest_transition_reason: transitionReason,
      first_seen_utc: existing?.first_seen_utc ?? observedAtUtc,
      last_seen_utc: nowUtc,
      updated_at_utc: nowUtc
    };

    const jcsSha256 = sha256(canonicalizeJCS(candidateData));
    const candidate: OpportunityCandidate = {
      ...candidateData,
      jcs_sha256: jcsSha256
    };

    // Persist candidate
    await this.persistCandidate(candidate);

    // Record lifecycle event if new or material signal detected
    if (isNew || detectedSignal !== 'UNCHANGED') {
      await this.recordEvent({
        candidateId,
        previousState: existing?.lifecycle_state ?? 'NEW',
        nextState: targetState,
        signal: detectedSignal,
        trigger: 'OBSERVATION_INGESTED',
        transitionReason,
        timestampUtc: nowUtc
      });
    }

    return {
      candidate,
      signal: detectedSignal,
      is_new: isNew
    };
  }

  /**
   * Transitions a candidate to a new lifecycle state.
   * Fail-closed: invalid transitions are strictly rejected.
   */
  public async transitionState(
    candidateId: string,
    nextState: OpportunityLifecycleState,
    transitionReason: string,
    operatorId?: string
  ): Promise<OpportunityCandidate> {
    await this.initialize();

    const candidate = await this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`E-OPP-NOT-FOUND: Candidate '${candidateId}' does not exist`);
    }

    const currentState = candidate.lifecycle_state;
    if (currentState === nextState) {
      return candidate; // No-op idempotent transition
    }

    // Validate against permitted transitions
    const allowed = PERMITTED_TRANSITIONS[currentState];
    if (!allowed || !allowed.includes(nextState)) {
      throw new Error(
        `E-OPP-INVALID-TRANSITION: Cannot transition candidate '${candidateId}' from '${currentState}' to '${nextState}'. Permitted: [${allowed ? allowed.join(', ') : 'none'}]`
      );
    }

    // Special constraint: REJECTED -> INVESTIGATE requires explicit rationale >= 15 chars
    if (currentState === 'REJECTED' && nextState === 'INVESTIGATE') {
      if (!transitionReason || transitionReason.trim().length < 15) {
        throw new Error(
          `E-OPP-OVERRIDE-RATIONALE-REQUIRED: Re-opening a REJECTED candidate requires an explicit operator justification of at least 15 characters.`
        );
      }
    }

    // Special constraint: transition to VERIFIED requires evidence sufficiency
    if (nextState === 'VERIFIED' && !candidate.evidence_sufficiency.is_sufficient_for_underwriting) {
      throw new Error(
        `E-OPP-VERIFICATION-SUFFICIENCY-BLOCKED: Cannot transition candidate '${candidateId}' to VERIFIED. Evidence sufficiency score is ${candidate.evidence_sufficiency.sufficiency_score_bps} bps (requires 10,000 bps). Missing: [${candidate.evidence_sufficiency.missing_critical_fields.join(', ')}]`
      );
    }

    const nowUtc = new Date().toISOString();
    const updatedData = {
      ...candidate,
      lifecycle_state: nextState,
      latest_transition_reason: transitionReason,
      updated_at_utc: nowUtc
    };

    const jcsSha256 = sha256(canonicalizeJCS(updatedData));
    const updatedCandidate: OpportunityCandidate = {
      ...updatedData,
      jcs_sha256: jcsSha256
    };

    await this.persistCandidate(updatedCandidate);

    await this.recordEvent({
      candidateId,
      previousState: currentState,
      nextState,
      signal: 'UNCHANGED',
      trigger: operatorId ? 'OPERATOR_DECISION' : 'SUFFICIENCY_EVALUATED',
      operatorId,
      transitionReason,
      timestampUtc: nowUtc
    });

    return updatedCandidate;
  }

  /**
   * Fail-Closed Human Gate for Paper Allocation Commitment.
   * Only VERIFIED or PAPER_ELIGIBLE candidates with full evidence sufficiency can be committed.
   */
  public async authorizePaperCommit(
    candidateId: string,
    confirmationRationale: string,
    operatorId?: string
  ): Promise<{ authorized: boolean; candidate_id: string; commit_event_hash: string }> {
    await this.initialize();

    const candidate = await this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`E-OPP-NOT-FOUND: Candidate '${candidateId}' does not exist`);
    }

    if (!confirmationRationale || confirmationRationale.trim().length < 15) {
      throw new Error(
        `E-OPP-COMMIT-RATIONALE-REQUIRED: Paper commitment requires a substantive human confirmation rationale of at least 15 characters (got ${confirmationRationale ? confirmationRationale.length : 0}).`
      );
    }

    // Fail-closed state check
    if (candidate.lifecycle_state !== 'VERIFIED' && candidate.lifecycle_state !== 'PAPER_ELIGIBLE') {
      throw new Error(
        `E-OPP-UNVERIFIED-COMMIT-BLOCKED: Cannot commit candidate '${candidateId}' with status '${candidate.lifecycle_state}'. Only candidates passing all evidence gates (VERIFIED or PAPER_ELIGIBLE) may be committed to paper allocation.`
      );
    }

    if (!candidate.evidence_sufficiency.is_sufficient_for_underwriting) {
      throw new Error(
        `E-OPP-INSUFFICIENT-COMMIT-BLOCKED: Candidate '${candidateId}' has incomplete evidence. Missing: [${candidate.evidence_sufficiency.missing_critical_fields.join(', ')}]`
      );
    }

    // Transition to PAPER_ELIGIBLE if not already
    const committedCandidate = await this.transitionState(
      candidateId,
      'PAPER_ELIGIBLE',
      `Authorized for paper simulation allocation by ${operatorId ?? 'operator'}: ${confirmationRationale.trim()}`,
      operatorId
    );

    const history = await this.getEventHistory(candidateId);
    const lastEvent = history[history.length - 1];

    return {
      authorized: true,
      candidate_id: candidateId,
      commit_event_hash: lastEvent ? lastEvent.event_hash : candidate.jcs_sha256
    };
  }

  /**
   * Records a collector or network failure.
   * INVARIANT: Collector failure does NOT reject the candidate!
   * Marks observation as EVIDENCE_STALE and sets investigation status to FAILED or AWAITING_HUMAN_REVIEW.
   */
  public async recordObservationFailure(
    candidateId: string,
    errorMessage: string,
    connectorId: string
  ): Promise<OpportunityCandidate> {
    await this.initialize();

    const candidate = await this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`E-OPP-NOT-FOUND: Candidate '${candidateId}' does not exist`);
    }

    const nowUtc = new Date().toISOString();
    const signalsSet = new Set(candidate.active_signals);
    signalsSet.add('EVIDENCE_STALE');

    const updatedData = {
      ...candidate,
      active_signals: Array.from(signalsSet),
      investigation_status: 'FAILED' as const,
      latest_transition_reason: `Connector ${connectorId} failed: ${errorMessage} (candidate preserved; not rejected)`,
      updated_at_utc: nowUtc
    };

    const jcsSha256 = sha256(canonicalizeJCS(updatedData));
    const updatedCandidate: OpportunityCandidate = {
      ...updatedData,
      jcs_sha256: jcsSha256
    };

    await this.persistCandidate(updatedCandidate);

    await this.recordEvent({
      candidateId,
      previousState: candidate.lifecycle_state,
      nextState: candidate.lifecycle_state, // State unchanged!
      signal: 'EVIDENCE_STALE',
      trigger: 'SOURCE_FAULT_DETECTED',
      transitionReason: `Connector failure recorded: ${errorMessage}`,
      timestampUtc: nowUtc
    });

    return updatedCandidate;
  }

  /**
   * Sets the investigation status of a candidate.
   */
  public async updateInvestigationStatus(
    candidateId: string,
    status: InvestigationStatus,
    reason: string
  ): Promise<OpportunityCandidate> {
    await this.initialize();

    const candidate = await this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`E-OPP-NOT-FOUND: Candidate '${candidateId}' does not exist`);
    }

    const nowUtc = new Date().toISOString();
    const updatedData = {
      ...candidate,
      investigation_status: status,
      latest_transition_reason: reason,
      updated_at_utc: nowUtc
    };

    const jcsSha256 = sha256(canonicalizeJCS(updatedData));
    const updatedCandidate: OpportunityCandidate = {
      ...updatedData,
      jcs_sha256: jcsSha256
    };

    await this.persistCandidate(updatedCandidate);
    return updatedCandidate;
  }

  /**
   * Marks a candidate's evidence as stale without modifying its lifecycle state.
   */
  public async markStale(candidateId: string, reason: string): Promise<OpportunityCandidate> {
    await this.initialize();

    const candidate = await this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`E-OPP-NOT-FOUND: Candidate '${candidateId}' does not exist`);
    }

    const nowUtc = new Date().toISOString();
    const signalsSet = new Set(candidate.active_signals);
    signalsSet.add('EVIDENCE_STALE');

    const updatedData = {
      ...candidate,
      active_signals: Array.from(signalsSet),
      latest_transition_reason: reason,
      updated_at_utc: nowUtc
    };

    const jcsSha256 = sha256(canonicalizeJCS(updatedData));
    const updatedCandidate: OpportunityCandidate = {
      ...updatedData,
      jcs_sha256: jcsSha256
    };

    await this.persistCandidate(updatedCandidate);
    return updatedCandidate;
  }

  /**
   * Retrieves a candidate by its stable ID.
   */
  public async getCandidate(candidateId: string): Promise<OpportunityCandidate | null> {
    await this.initialize();

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT candidate_id, strategy_id, canonical_product_id, candidate_name,
                  lifecycle_state, active_signals, investigation_status, evidence_sufficiency,
                  commercial_attractiveness, current_observation, observation_history_count,
                  latest_transition_reason, first_seen_utc, last_seen_utc, updated_at_utc, jcs_sha256
           FROM market_opportunity_candidates
           WHERE candidate_id = $1`,
          [candidateId]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            candidate_id: row.candidate_id,
            strategy_id: row.strategy_id,
            canonical_product_id: row.canonical_product_id,
            candidate_name: row.candidate_name,
            lifecycle_state: row.lifecycle_state as OpportunityLifecycleState,
            active_signals: row.active_signals,
            investigation_status: row.investigation_status as InvestigationStatus,
            evidence_sufficiency: row.evidence_sufficiency,
            commercial_attractiveness: row.commercial_attractiveness,
            current_observation: row.current_observation,
            observation_history_count: row.observation_history_count,
            latest_transition_reason: row.latest_transition_reason,
            first_seen_utc: row.first_seen_utc.toISOString ? row.first_seen_utc.toISOString() : String(row.first_seen_utc),
            last_seen_utc: row.last_seen_utc.toISOString ? row.last_seen_utc.toISOString() : String(row.last_seen_utc),
            updated_at_utc: row.updated_at_utc.toISOString ? row.updated_at_utc.toISOString() : String(row.updated_at_utc),
            jcs_sha256: row.jcs_sha256
          };
        }
        return null;
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres getCandidate fallback:', err?.message ?? String(err));
      }
    }

    return this.inMemoryCandidates.get(candidateId) ?? null;
  }

  /**
   * Lists all candidates matching an optional filter.
   */
  public async listCandidates(filter?: CandidateFilter): Promise<OpportunityCandidate[]> {
    await this.initialize();

    let list: OpportunityCandidate[] = [];

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT candidate_id, strategy_id, canonical_product_id, candidate_name,
                  lifecycle_state, active_signals, investigation_status, evidence_sufficiency,
                  commercial_attractiveness, current_observation, observation_history_count,
                  latest_transition_reason, first_seen_utc, last_seen_utc, updated_at_utc, jcs_sha256
           FROM market_opportunity_candidates
           ORDER BY last_seen_utc DESC`
        );
        list = res.rows.map((row) => ({
          candidate_id: row.candidate_id,
          strategy_id: row.strategy_id,
          canonical_product_id: row.canonical_product_id,
          candidate_name: row.candidate_name,
          lifecycle_state: row.lifecycle_state as OpportunityLifecycleState,
          active_signals: row.active_signals,
          investigation_status: row.investigation_status as InvestigationStatus,
          evidence_sufficiency: row.evidence_sufficiency,
          commercial_attractiveness: row.commercial_attractiveness,
          current_observation: row.current_observation,
          observation_history_count: row.observation_history_count,
          latest_transition_reason: row.latest_transition_reason,
          first_seen_utc: row.first_seen_utc.toISOString ? row.first_seen_utc.toISOString() : String(row.first_seen_utc),
          last_seen_utc: row.last_seen_utc.toISOString ? row.last_seen_utc.toISOString() : String(row.last_seen_utc),
          updated_at_utc: row.updated_at_utc.toISOString ? row.updated_at_utc.toISOString() : String(row.updated_at_utc),
          jcs_sha256: row.jcs_sha256
        }));
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres listCandidates fallback:', err?.message ?? String(err));
        list = Array.from(this.inMemoryCandidates.values());
      }
    } else {
      list = Array.from(this.inMemoryCandidates.values());
    }

    if (!filter) return list;

    return list.filter((c) => {
      if (filter.strategy_id && c.strategy_id !== filter.strategy_id) return false;
      if (filter.lifecycle_state && c.lifecycle_state !== filter.lifecycle_state) return false;
      if (filter.investigation_status && c.investigation_status !== filter.investigation_status) return false;
      if (filter.is_sufficient_for_underwriting !== undefined && c.evidence_sufficiency.is_sufficient_for_underwriting !== filter.is_sufficient_for_underwriting) return false;
      return true;
    });
  }

  /**
   * Retrieves the Merkle-chained event history for a candidate.
   */
  public async getEventHistory(candidateId: string): Promise<CandidateLifecycleEvent[]> {
    await this.initialize();

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT event_id, candidate_id, previous_state, next_state, signal, trigger,
                  operator_id, transition_reason, previous_event_hash, event_hash, timestamp_utc
           FROM market_candidate_lifecycle_events
           WHERE candidate_id = $1
           ORDER BY timestamp_utc ASC`,
          [candidateId]
        );
        return res.rows.map((row) => ({
          event_id: row.event_id,
          candidate_id: row.candidate_id,
          previous_state: row.previous_state as OpportunityLifecycleState,
          next_state: row.next_state as OpportunityLifecycleState,
          signal: row.signal as ObservationChangeSignal,
          trigger: row.trigger as LifecycleTrigger,
          operator_id: row.operator_id ?? undefined,
          transition_reason: row.transition_reason,
          previous_event_hash: row.previous_event_hash,
          event_hash: row.event_hash,
          timestamp_utc: row.timestamp_utc.toISOString ? row.timestamp_utc.toISOString() : String(row.timestamp_utc)
        }));
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres getEventHistory fallback:', err?.message ?? String(err));
      }
    }

    return this.inMemoryEvents.get(candidateId) ?? [];
  }

  // ============================================================================
  // 4. PRIVATE HELPERS
  // ============================================================================

  private computeSufficiencyProfile(params: {
    quote: number | null;
    asp: number | null;
    sentiment: string | null;
    hasRoute: boolean;
    hasReg: boolean;
    nowUtc: string;
  }): EvidenceSufficiencyProfile {
    const missing: string[] = [];
    const uncorroborated: string[] = [];
    let score = 0;

    const hasQuote = typeof params.quote === 'number' && !isNaN(params.quote) && params.quote > 0;
    if (hasQuote) score += 3000;
    else missing.push('factory_gate_quote_inr');

    const hasAsp = typeof params.asp === 'number' && !isNaN(params.asp) && params.asp > 0;
    if (hasAsp) score += 3000;
    else missing.push('prevailing_retail_asp_inr');

    const hasReviews = typeof params.sentiment === 'string' && params.sentiment.trim().length > 0;
    if (hasReviews) score += 2000;
    else missing.push('review_sentiment_summary');

    if (params.hasRoute) score += 1000;
    else uncorroborated.push('logistics_freight_corridor');

    if (params.hasReg) score += 1000;
    else uncorroborated.push('statutory_hsn_gst_rate');

    const isSufficient = hasQuote && hasAsp && hasReviews && params.hasRoute && params.hasReg;

    return {
      is_sufficient_for_underwriting: isSufficient,
      sufficiency_score_bps: score,
      has_upstream_quote: hasQuote,
      has_prevailing_asp: hasAsp,
      has_verbatim_reviews: hasReviews,
      has_logistics_route: params.hasRoute,
      has_regulatory_clearance: params.hasReg,
      missing_critical_fields: missing,
      uncorroborated_fields: uncorroborated,
      last_evaluated_at_utc: params.nowUtc
    };
  }

  private computeCommercialAttractiveness(
    quote: number | null,
    asp: number | null
  ): CommercialAttractivenessEstimate {
    if (quote === null || asp === null || quote <= 0 || asp <= 0) {
      return {
        estimated_gross_spread_inr: null,
        estimated_gross_margin_bps: null,
        attractiveness_rating: 'UNKNOWN',
        heuristic_rationale: 'Missing factory gate quote or prevailing retail ASP; spread cannot be computed.',
        calculation_epistemic_class: 'UNATTESTED_INTAKE'
      };
    }

    const spread = Number((asp - quote).toFixed(2));
    const marginBps = Math.round((spread / asp) * 10000);

    let rating: CommercialAttractivenessEstimate['attractiveness_rating'] = 'MODERATE';
    if (marginBps >= 6000) rating = 'VERY_HIGH';
    else if (marginBps >= 4000) rating = 'HIGH';
    else if (marginBps >= 2000) rating = 'MODERATE';
    else if (marginBps >= 0) rating = 'LOW';
    else rating = 'NEGATIVE';

    return {
      estimated_gross_spread_inr: spread,
      estimated_gross_margin_bps: marginBps,
      attractiveness_rating: rating,
      heuristic_rationale: `Gross spread is ₹${spread.toFixed(2)} (${(marginBps / 100).toFixed(2)}% gross margin).`,
      calculation_epistemic_class: 'ESTIMATED_PROXY'
    };
  }

  private async persistCandidate(candidate: OpportunityCandidate): Promise<void> {
    this.inMemoryCandidates.set(candidate.candidate_id, candidate);

    if (this.pgPool) {
      try {
        await this.pgPool.query(
          `INSERT INTO market_opportunity_candidates (
            candidate_id, strategy_id, canonical_product_id, candidate_name,
            lifecycle_state, active_signals, investigation_status, evidence_sufficiency,
            commercial_attractiveness, current_observation, observation_history_count,
            latest_transition_reason, first_seen_utc, last_seen_utc, updated_at_utc, jcs_sha256
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ON CONFLICT (candidate_id) DO UPDATE SET
            candidate_name = EXCLUDED.candidate_name,
            lifecycle_state = EXCLUDED.lifecycle_state,
            active_signals = EXCLUDED.active_signals,
            investigation_status = EXCLUDED.investigation_status,
            evidence_sufficiency = EXCLUDED.evidence_sufficiency,
            commercial_attractiveness = EXCLUDED.commercial_attractiveness,
            current_observation = EXCLUDED.current_observation,
            observation_history_count = EXCLUDED.observation_history_count,
            latest_transition_reason = EXCLUDED.latest_transition_reason,
            last_seen_utc = EXCLUDED.last_seen_utc,
            updated_at_utc = EXCLUDED.updated_at_utc,
            jcs_sha256 = EXCLUDED.jcs_sha256`,
          [
            candidate.candidate_id,
            candidate.strategy_id,
            candidate.canonical_product_id,
            candidate.candidate_name,
            candidate.lifecycle_state,
            JSON.stringify(candidate.active_signals),
            candidate.investigation_status,
            JSON.stringify(candidate.evidence_sufficiency),
            JSON.stringify(candidate.commercial_attractiveness),
            JSON.stringify(candidate.current_observation),
            candidate.observation_history_count,
            candidate.latest_transition_reason,
            candidate.first_seen_utc,
            candidate.last_seen_utc,
            candidate.updated_at_utc,
            candidate.jcs_sha256
          ]
        );
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres persistCandidate warning:', err?.message ?? String(err));
      }
    }
  }

  private async recordEvent(params: {
    candidateId: string;
    previousState: OpportunityLifecycleState;
    nextState: OpportunityLifecycleState;
    signal: ObservationChangeSignal;
    trigger: LifecycleTrigger;
    operatorId?: string;
    transitionReason: string;
    timestampUtc: string;
  }): Promise<CandidateLifecycleEvent> {
    const existingEvents = await this.getEventHistory(params.candidateId);
    const lastEvent = existingEvents.length > 0 ? existingEvents[existingEvents.length - 1] : null;
    const prevHash = lastEvent ? lastEvent.event_hash : '0000000000000000000000000000000000000000000000000000000000000000';

    const eventId = `EVT-${sha256(params.candidateId + params.timestampUtc + existingEvents.length).slice(0, 12).toUpperCase()}`;
    const payloadForHash = {
      event_id: eventId,
      candidate_id: params.candidateId,
      previous_state: params.previousState,
      next_state: params.nextState,
      signal: params.signal,
      trigger: params.trigger,
      operator_id: params.operatorId ?? null,
      transition_reason: params.transitionReason,
      previous_event_hash: prevHash,
      timestamp_utc: params.timestampUtc
    };

    const eventHash = sha256(canonicalizeJCS(payloadForHash));
    const event: CandidateLifecycleEvent = {
      ...payloadForHash,
      operator_id: params.operatorId,
      event_hash: eventHash
    };

    // Store in-memory
    const memList = this.inMemoryEvents.get(params.candidateId) ?? [];
    memList.push(event);
    this.inMemoryEvents.set(params.candidateId, memList);

    // Persist to Postgres
    if (this.pgPool) {
      try {
        await this.pgPool.query(
          `INSERT INTO market_candidate_lifecycle_events (
            event_id, candidate_id, previous_state, next_state, signal,
            trigger, operator_id, transition_reason, previous_event_hash,
            event_hash, timestamp_utc
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (event_id) DO NOTHING`,
          [
            event.event_id,
            event.candidate_id,
            event.previous_state,
            event.next_state,
            event.signal,
            event.trigger,
            event.operator_id ?? null,
            event.transition_reason,
            event.previous_event_hash,
            event.event_hash,
            event.timestamp_utc
          ]
        );
      } catch (err: any) {
        console.warn('[OpportunityLifecycleEngine] Postgres recordEvent warning:', err?.message ?? String(err));
      }
    }

    return event;
  }
}
