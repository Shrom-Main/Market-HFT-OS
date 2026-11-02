/**
 * POC-001: Stage 0 Discovery Screener — Discovery Funnel & Normalization Service (Slice 2A & 2B)
 *
 * Implements the Stage 0 Discovery Screener that:
 * 1. Takes RawSourceCapture envelopes from discovery source adapters.
 * 2. Uses EntityIdentityResolver to map raw captures to canonical product/offer identities.
 * 3. Rejects ambiguous or non-catalog listings to UNRESOLVED_ENTITY_HOLD without phantom entity invention.
 * 4. Applies DeltaDetector with explicit, versioned materiality thresholds to detect material price changes,
 *    quote updates, grievance surfacing, stale data, and cross-source conflicts.
 * 5. Feeds normalized observations into OpportunityLifecycleEngine.ingestObservation().
 * 6. Evaluates candidates under ScreeningPolicyEngine to produce explainable priority scores, tiers,
 *    and structured recommended investigation tasks.
 * 7. Supports 100% reproducible candidate ranking under identical inputs and policy versions.
 */

import { sha256 } from '../canonical/crypto.js';
import { EntityIdentityResolver, RawObservationEnvelope, ResolvedCanonicalIdentity } from '../research/entityIdentityResolver.js';
import {
  OpportunityLifecycleEngine,
  OpportunityCandidate,
  ObservationChangeSignal,
  IngestObservationInput,
  UnderwritingOutcome,
  CandidateUnderwritingDecision,
  ApplicableCostCategory,
  CostCategoryExclusion,
  CostCategoryTreatment,
  CostCategoryAssessment,
  CapitalAllocationDecision,
  PaperCapitalBudgetConfig
} from '../research/opportunityLifecycleEngine.js';
import {
  RawSourceCapture,
  NormalizedDiscoveryObservation,
  SourceAdapterContract
} from './sourceAdapterContract.js';
import {
  ScreeningPolicyConfig,
  ScreeningPolicyEngine,
  ScreeningEvaluationResult,
  ScreeningPriorityTier,
  RecommendedInvestigationTask,
  DEFAULT_SCREENING_POLICY_V1
} from './screeningPolicy.js';
import { DeltaDetector } from './deltaDetector.js';
import {
  InvestigationPlanner,
  InvestigationPlan,
  InvestigationAgentRole,
  TaskState
} from './investigationPlanner.js';
import {
  InvestigationTaskQueue,
  InvestigationTaskRecord
} from './investigationTaskQueue.js';
import type { DiscoveryGalleryPipeline } from '../gallery/discoveryGalleryPipeline.js';
import type { ProductQueueCandidate } from '../gallery/galleryTypes.js';
import type { CheckpointableInvestigationState } from '../agents/reasoning/reasoningTypes.js';

export interface DiscoveryScreeningResult {
  readonly capture_id: string;
  readonly candidate_id?: string;
  readonly resolution_status: 'RESOLVED' | 'RESOLVED_NOVEL_CATEGORY' | 'UNRESOLVED_ENTITY_HOLD' | 'CONFLICT_DETECTED';
  readonly normalized_observation: NormalizedDiscoveryObservation | null;
  readonly candidate: OpportunityCandidate | null;
  readonly signal: ObservationChangeSignal | null;
  readonly is_new_candidate: boolean;
  readonly notes: string;
  readonly screening_evaluation: ScreeningEvaluationResult | null;
  readonly priority_score_bps: number | null;
  readonly priority_tier: ScreeningPriorityTier | null;
  readonly recommended_tasks: readonly RecommendedInvestigationTask[];
  readonly investigation_plan?: InvestigationPlan | null;
  readonly enqueued_task_count?: number;
  readonly gallery_candidate?: ProductQueueCandidate;
  readonly adaptive_state?: CheckpointableInvestigationState;
}

export interface DiscoveryScreenerOptions {
  readonly lifecycleEngine?: OpportunityLifecycleEngine;
  readonly identityResolver?: EntityIdentityResolver;
  readonly screeningEngine?: ScreeningPolicyEngine;
  readonly deltaDetector?: DeltaDetector;
  readonly defaultStrategyId?: string;
  readonly policyConfig?: Partial<ScreeningPolicyConfig>;
  readonly taskQueue?: InvestigationTaskQueue;
  readonly galleryPipeline?: DiscoveryGalleryPipeline;
}

export interface SubmitInvestigationResultParams {
  readonly task_id: string;
  readonly candidate_id: string;
  readonly generation_id: string;
  readonly lease_owner_id: string;
  readonly fencing_token: number;
  readonly result_payload: Record<string, unknown>;
  readonly evidence_origin: {
    readonly source_connector_id: string;
    readonly origin_class: 'RECORDED_GOLDEN_FIXTURE' | 'LIVE_VERIFIED_CAPTURE' | 'UNATTESTED_USER_INTAKE' | 'SYNTHETIC_SCENARIO' | 'ESTIMATED_PROXY' | 'OPERATOR_SIMULATION_ASSUMPTION';
    readonly observed_at_utc: string;
    readonly verification_status?: 'VERIFIED' | 'UNVERIFIED' | 'CONFLICT_DETECTED';
  };
  readonly extracted_fields?: {
    readonly factory_gate_quote_inr?: number | null;
    readonly prevailing_retail_asp_inr?: number | null;
    readonly unit_batch_moq?: number | null;
    readonly observed_seller_count?: number | null;
    readonly review_sentiment_summary?: string | null;
    readonly has_logistics_route?: boolean;
    readonly has_regulatory_clearance?: boolean;
    readonly applicable_cost_categories?: readonly ApplicableCostCategory[];
    readonly cost_category_exclusions?: readonly CostCategoryExclusion[];
    readonly inbound_freight_inr?: number | null;
    readonly packaging_kitting_inr?: number | null;
    readonly platform_fee_inr?: number | null;
    readonly fulfillment_fee_inr?: number | null;
    readonly statutory_tax_inr?: number | null;
    readonly return_defect_drag_inr?: number | null;
    readonly lead_time_days?: number | null;
    readonly payment_terms_days?: number | null;
    readonly warehouse_dwell_days?: number | null;
    readonly settlement_delay_days?: number | null;
  };
}

export interface SubmitInvestigationResultOutcome {
  readonly commit_status: 'COMMITTED' | 'IDEMPOTENT_REPLAY_ACK';
  readonly task_id: string;
  readonly candidate: OpportunityCandidate;
  readonly screening_evaluation: ScreeningEvaluationResult;
}

export type {
  UnderwritingOutcome,
  CandidateUnderwritingDecision,
  ApplicableCostCategory,
  CostCategoryExclusion,
  CostCategoryTreatment,
  CostCategoryAssessment,
  CapitalAllocationDecision,
  PaperCapitalBudgetConfig
};

export class DiscoveryScreenerService {
  private readonly lifecycleEngine: OpportunityLifecycleEngine;
  private readonly identityResolver: EntityIdentityResolver;
  private readonly screeningEngine: ScreeningPolicyEngine;
  private readonly deltaDetector: DeltaDetector;
  private readonly defaultStrategyId: string;
  private readonly taskQueue: InvestigationTaskQueue;
  private readonly galleryPipeline?: DiscoveryGalleryPipeline;

  constructor(options?: DiscoveryScreenerOptions) {
    this.lifecycleEngine = options?.lifecycleEngine ?? new OpportunityLifecycleEngine();
    this.identityResolver = options?.identityResolver ?? new EntityIdentityResolver();
    this.defaultStrategyId = options?.defaultStrategyId ?? 'strat:india-b2b:physical-arbitrage';

    const policyConfig = options?.policyConfig;
    this.screeningEngine = options?.screeningEngine ?? new ScreeningPolicyEngine(policyConfig);
    this.deltaDetector = options?.deltaDetector ?? new DeltaDetector(policyConfig);
    this.taskQueue = options?.taskQueue ?? new InvestigationTaskQueue();
    this.galleryPipeline = options?.galleryPipeline;
  }

  public getGalleryPipeline(): DiscoveryGalleryPipeline | undefined {
    return this.galleryPipeline;
  }

  public getTaskQueue(): InvestigationTaskQueue {
    return this.taskQueue;
  }

  public async claimNextTask(
    workerId: string,
    options?: {
      candidateId?: string;
      targetRole?: InvestigationAgentRole;
      leaseDurationMs?: number;
    }
  ): Promise<InvestigationTaskRecord | null> {
    return this.taskQueue.claimNextTask(workerId, options);
  }

  public async recordTaskFailure(params: {
    task_id: string;
    lease_owner_id: string;
    fencing_token: number;
    error_message: string;
  }): Promise<{ state: TaskState; attempts: number }> {
    return this.taskQueue.recordTaskFailure(params);
  }

  /**
   * Initializes the underlying lifecycle engine.
   */
  public async initialize(): Promise<void> {
    await this.lifecycleEngine.initialize();
  }

  public getLifecycleEngine(): OpportunityLifecycleEngine {
    return this.lifecycleEngine;
  }

  public getCandidates(): OpportunityCandidate[] {
    return this.lifecycleEngine.getInMemoryCandidates();
  }

  public async getCandidate(candidateId: string): Promise<OpportunityCandidate | null> {
    return this.lifecycleEngine.getCandidate(candidateId);
  }

  public getIdentityResolver(): EntityIdentityResolver {
    return this.identityResolver;
  }

  public getScreeningEngine(): ScreeningPolicyEngine {
    return this.screeningEngine;
  }

  public getDeltaDetector(): DeltaDetector {
    return this.deltaDetector;
  }

  /**
   * Screens a single raw source capture through canonical identity resolution,
   * versioned delta detection, lifecycle engine intake, and priority policy scoring.
   */
  public async screenCapture(capture: RawSourceCapture): Promise<DiscoveryScreeningResult> {
    // 1. Build observation envelope for EntityIdentityResolver
    const envelope: RawObservationEnvelope = {
      source_id: capture.source_connector_id,
      target_url: capture.target_url,
      product_id: typeof capture.extracted_fields?.product_id === 'string' ? capture.extracted_fields.product_id : undefined,
      raw_payload: capture.raw_payload,
      event_time_utc: capture.source_observed_at_utc,
      receipt_time_utc: capture.retrieval_timestamp_utc,
      origin_class: capture.origin_class,
      extracted_fields: capture.extracted_fields
    };

    // 2. Resolve to canonical product/SKU identity
    const resolvedIdentity = this.identityResolver.resolveIdentity(envelope);

    if (resolvedIdentity.resolution_status === 'UNRESOLVED_ENTITY_HOLD') {
      return {
        capture_id: capture.capture_id,
        resolution_status: 'UNRESOLVED_ENTITY_HOLD',
        normalized_observation: null,
        candidate: null,
        signal: null,
        is_new_candidate: false,
        notes: resolvedIdentity.resolution_notes,
        screening_evaluation: null,
        priority_score_bps: null,
        priority_tier: null,
        recommended_tasks: Object.freeze([])
      };
    }

    // 3. Extract and normalize commercial metrics
    const metrics = resolvedIdentity.extracted_metrics || {};

    const prevailingAsp = typeof metrics.gross_price_inr === 'number' && !isNaN(metrics.gross_price_inr)
      ? metrics.gross_price_inr
      : typeof metrics.unit_price_inr === 'number' && !isNaN(metrics.unit_price_inr)
        ? metrics.unit_price_inr
        : null;

    const factoryQuote = typeof metrics.factory_gate_quote_inr === 'number' && !isNaN(metrics.factory_gate_quote_inr)
      ? metrics.factory_gate_quote_inr
      : null;

    const moq = typeof metrics.unit_batch_moq === 'number' && !isNaN(metrics.unit_batch_moq)
      ? metrics.unit_batch_moq
      : typeof metrics.moq_units === 'number' && !isNaN(metrics.moq_units)
        ? metrics.moq_units
        : null;

    const sellerCount = typeof metrics.observed_seller_count === 'number' && !isNaN(metrics.observed_seller_count)
      ? metrics.observed_seller_count
      : null;

    const reviewSentiment = typeof metrics.review_sentiment_summary === 'string' && metrics.review_sentiment_summary.trim().length > 0
      ? metrics.review_sentiment_summary.trim()
      : null;

    const hasRoute = Boolean(metrics.has_logistics_route ?? false);
    const hasReg = Boolean(metrics.has_regulatory_clearance ?? false);

    const observationId = `DISC-OBS-${sha256(capture.capture_id + capture.source_observed_at_utc).slice(0, 12).toUpperCase()}`;

    const normalizedObs: NormalizedDiscoveryObservation = {
      observation_id: observationId,
      capture_id: capture.capture_id,
      strategy_id: this.defaultStrategyId,
      canonical_product_id: resolvedIdentity.product_id,
      candidate_name: this.deriveCandidateName(resolvedIdentity),
      category: resolvedIdentity.category,
      source_connector_id: capture.source_connector_id,
      source_type: capture.source_type,
      origin_class: capture.origin_class,
      prevailing_retail_asp_inr: prevailingAsp,
      factory_gate_quote_inr: factoryQuote,
      unit_batch_moq: moq,
      observed_seller_count: sellerCount,
      review_sentiment_summary: reviewSentiment,
      raw_payload_snippet: capture.raw_payload.slice(0, 200),
      payload_sha256: capture.payload_sha256,
      source_observed_at_utc: capture.source_observed_at_utc,
      ingestion_timestamp_utc: capture.retrieval_timestamp_utc,
      has_logistics_route: hasRoute,
      has_regulatory_clearance: hasReg,
      normalization_notes: resolvedIdentity.resolution_notes
    };

    // 4. Query existing candidate to check for delta detection
    const candidateId = OpportunityLifecycleEngine.computeCandidateId(this.defaultStrategyId, resolvedIdentity.product_id);
    const existingCandidate = await this.lifecycleEngine.getCandidate(candidateId);
    const isNew = existingCandidate === null;

    // 5. Versioned Delta Detection with explicit materiality thresholds
    const deltaResult = this.deltaDetector.detectDelta({
      prev_observation: existingCandidate?.current_observation,
      new_asp_inr: prevailingAsp,
      new_quote_inr: factoryQuote,
      new_moq: moq,
      new_sentiment_summary: reviewSentiment,
      new_payload_sha256: capture.payload_sha256,
      observed_at_utc: capture.source_observed_at_utc,
      is_new_candidate: isNew,
      existing_active_signals: existingCandidate?.active_signals,
      source_connector_id: capture.source_connector_id,
      existing_source_connector_id: existingCandidate?.current_observation.source_connector_id
    });

    // 6. Ingest into OpportunityLifecycleEngine
    const ingestInput: IngestObservationInput = {
      strategy_id: normalizedObs.strategy_id,
      canonical_product_id: normalizedObs.canonical_product_id,
      candidate_name: normalizedObs.candidate_name,
      category: normalizedObs.category,
      source_connector_id: normalizedObs.source_connector_id,
      prevailing_retail_asp_inr: normalizedObs.prevailing_retail_asp_inr,
      factory_gate_quote_inr: normalizedObs.factory_gate_quote_inr,
      unit_batch_moq: normalizedObs.unit_batch_moq,
      observed_seller_count: normalizedObs.observed_seller_count,
      review_sentiment_summary: normalizedObs.review_sentiment_summary,
      raw_payload: capture.raw_payload,
      has_logistics_route: normalizedObs.has_logistics_route,
      has_regulatory_clearance: normalizedObs.has_regulatory_clearance,
      observed_at_utc: normalizedObs.source_observed_at_utc,
      signal_override: deltaResult.primary_signal,
      origin_class: capture.origin_class
    };

    const ingestResult = await this.lifecycleEngine.ingestObservation(ingestInput);

    // 7. Evaluate Candidate under Screening Policy
    const screeningEval = this.screeningEngine.evaluateCandidate(ingestResult.candidate, {
      origin_class: capture.origin_class,
      evaluated_at_utc: normalizedObs.source_observed_at_utc,
      supporting_observations: [
        {
          source_connector_id: capture.source_connector_id,
          capture_id: capture.capture_id,
          observed_at_utc: capture.source_observed_at_utc,
          origin_class: capture.origin_class,
          payload_sha256: capture.payload_sha256
        }
      ]
    });

    // 8. Controlled Investigation Planning & Enqueuing
    let investigationPlan: InvestigationPlan | null = null;
    let enqueuedTaskCount = 0;

    if (
      !ingestResult.candidate.evidence_sufficiency.is_sufficient_for_underwriting ||
      screeningEval.recommended_investigation_tasks.length > 0
    ) {
      investigationPlan = InvestigationPlanner.planInvestigation(
        ingestResult.candidate.candidate_id,
        normalizedObs,
        'GEN-01',
        screeningEval.recommended_investigation_tasks
      );
      enqueuedTaskCount = await this.taskQueue.enqueueTasks(investigationPlan.tasks);
    }

    // 9. Adaptive Reasoning & Living Gallery Ingestion (Stage C / 64A Integration)
    let galleryCandidate: ProductQueueCandidate | undefined = undefined;
    let adaptiveState: CheckpointableInvestigationState | undefined = undefined;

    if (this.galleryPipeline) {
      try {
        const adaptiveRes = await this.galleryPipeline.processAdaptiveDiscovery({
          candidate_id: ingestResult.candidate.candidate_id,
          canonical_product_id: normalizedObs.canonical_product_id,
          observation: normalizedObs,
          jurisdiction: 'IN'
        });
        galleryCandidate = adaptiveRes.candidate;
        adaptiveState = adaptiveRes.adaptive_state;
      } catch (err: any) {
        console.warn('[DiscoveryScreenerService] processAdaptiveDiscovery warning:', err?.message || err);
      }
    }

    return {
      capture_id: capture.capture_id,
      resolution_status: resolvedIdentity.resolution_status,
      normalized_observation: normalizedObs,
      candidate: ingestResult.candidate,
      signal: ingestResult.signal,
      is_new_candidate: ingestResult.is_new,
      notes: `${deltaResult.transition_reason}. Priority: ${screeningEval.priority_tier} (${screeningEval.priority_score_bps} bps).`,
      candidate_id: ingestResult.candidate?.candidate_id ?? galleryCandidate?.candidate_id,
      screening_evaluation: screeningEval,
      priority_score_bps: screeningEval.priority_score_bps,
      priority_tier: screeningEval.priority_tier,
      recommended_tasks: screeningEval.recommended_investigation_tasks,
      investigation_plan: investigationPlan,
      enqueued_task_count: enqueuedTaskCount,
      gallery_candidate: galleryCandidate,
      adaptive_state: adaptiveState
    };
  }

  /**
   * Commits task result to the task queue under atomic lease fencing,
   * validates result payload and provenance, and updates candidate evidence
   * in OpportunityLifecycleEngine for deterministic underwriting reevaluation.
   */
  public async submitInvestigationResult(
    params: SubmitInvestigationResultParams
  ): Promise<SubmitInvestigationResultOutcome> {
    const candidate = await this.lifecycleEngine.getCandidate(params.candidate_id);
    if (!candidate) {
      throw new Error(`E-DISC-CANDIDATE-NOT-FOUND: Candidate '${params.candidate_id}' not found`);
    }

    const task = await this.taskQueue.getTask(params.task_id);
    const taskType = task?.task_type ?? 'VERIFY_FACTORY_QUOTE';

    // 1. Commit to task queue (enforces lease fencing, expiry, and replay idempotency)
    const commitResult = await this.taskQueue.commitTaskResult({
      task_id: params.task_id,
      candidate_id: params.candidate_id,
      generation_id: params.generation_id,
      task_type: taskType,
      lease_owner_id: params.lease_owner_id,
      fencing_token: params.fencing_token,
      result_payload: params.result_payload,
      observation: {
        observation_id: `DISC-OBS-${sha256(params.task_id + params.evidence_origin.observed_at_utc).slice(0, 12).toUpperCase()}`,
        target_field: Object.keys(params.extracted_fields ?? {})[0] ?? 'investigated_evidence'
      }
    });

    // 2. Handle Idempotent Replay without duplicating observation records
    if (commitResult.status === 'IDEMPOTENT_REPLAY_ACK') {
      const screeningEval = this.screeningEngine.evaluateCandidate(candidate, {
        origin_class: params.evidence_origin.origin_class as any,
        evaluated_at_utc: params.evidence_origin.observed_at_utc
      });
      return {
        commit_status: 'IDEMPOTENT_REPLAY_ACK',
        task_id: params.task_id,
        candidate,
        screening_evaluation: screeningEval
      };
    }

    // 3. Validate extracted fields schema and bounds
    const extracted = params.extracted_fields ?? {};
    if (extracted.factory_gate_quote_inr !== undefined && extracted.factory_gate_quote_inr !== null) {
      if (extracted.factory_gate_quote_inr <= 0 || isNaN(extracted.factory_gate_quote_inr)) {
        throw new Error(`E-DISC-INVALID-QUOTE: Factory gate quote must be positive (got ${extracted.factory_gate_quote_inr})`);
      }
    }
    if (extracted.prevailing_retail_asp_inr !== undefined && extracted.prevailing_retail_asp_inr !== null) {
      if (extracted.prevailing_retail_asp_inr <= 0 || isNaN(extracted.prevailing_retail_asp_inr)) {
        throw new Error(`E-DISC-INVALID-ASP: Prevailing retail ASP must be positive (got ${extracted.prevailing_retail_asp_inr})`);
      }
    }

    // 4. Update Candidate Evidence in OpportunityLifecycleEngine
    const prevObs = candidate.current_observation;
    const ingestInput: IngestObservationInput = {
      strategy_id: candidate.strategy_id,
      canonical_product_id: candidate.canonical_product_id,
      candidate_name: candidate.candidate_name,
      category: candidate.category,
      source_connector_id: params.evidence_origin.source_connector_id,
      prevailing_retail_asp_inr: extracted.prevailing_retail_asp_inr ?? prevObs.prevailing_retail_asp_inr,
      factory_gate_quote_inr: extracted.factory_gate_quote_inr ?? prevObs.factory_gate_quote_inr,
      unit_batch_moq: extracted.unit_batch_moq ?? prevObs.unit_batch_moq,
      observed_seller_count: extracted.observed_seller_count ?? prevObs.observed_seller_count,
      review_sentiment_summary: extracted.review_sentiment_summary ?? prevObs.review_sentiment_summary,
      has_logistics_route: extracted.has_logistics_route ?? candidate.evidence_sufficiency.has_logistics_route,
      has_regulatory_clearance: extracted.has_regulatory_clearance ?? candidate.evidence_sufficiency.has_regulatory_clearance,
      applicable_cost_categories: extracted.applicable_cost_categories ?? prevObs.applicable_cost_categories,
      cost_category_exclusions: extracted.cost_category_exclusions ?? prevObs.cost_category_exclusions,
      inbound_freight_inr: extracted.inbound_freight_inr ?? prevObs.inbound_freight_inr,
      packaging_kitting_inr: extracted.packaging_kitting_inr ?? prevObs.packaging_kitting_inr,
      platform_fee_inr: extracted.platform_fee_inr ?? prevObs.platform_fee_inr,
      fulfillment_fee_inr: extracted.fulfillment_fee_inr ?? prevObs.fulfillment_fee_inr,
      statutory_tax_inr: extracted.statutory_tax_inr ?? prevObs.statutory_tax_inr,
      return_defect_drag_inr: extracted.return_defect_drag_inr ?? prevObs.return_defect_drag_inr,
      lead_time_days: extracted.lead_time_days ?? prevObs.lead_time_days,
      payment_terms_days: extracted.payment_terms_days ?? prevObs.payment_terms_days,
      warehouse_dwell_days: extracted.warehouse_dwell_days ?? prevObs.warehouse_dwell_days,
      settlement_delay_days: extracted.settlement_delay_days ?? prevObs.settlement_delay_days,
      observed_at_utc: params.evidence_origin.observed_at_utc,
      origin_class: params.evidence_origin.origin_class as any
    };

    const ingestResult = await this.lifecycleEngine.ingestObservation(ingestInput);

    // 5. Deterministic Screening Reevaluation
    const screeningEval = this.screeningEngine.evaluateCandidate(ingestResult.candidate, {
      origin_class: params.evidence_origin.origin_class as any,
      evaluated_at_utc: params.evidence_origin.observed_at_utc
    });

    // 6. Sync Completed Evidence back into Living Gallery Pipeline (Stage C Integration)
    if (this.galleryPipeline) {
      try {
        await this.galleryPipeline.completeInvestigationTask({
          candidate_id: params.candidate_id,
          task_id: params.task_id,
          evidence_id: `EVID-${params.task_id}`,
          extracted_fields: {
            factory_gate_quote_inr: extracted.factory_gate_quote_inr ?? undefined,
            prevailing_retail_asp_inr: extracted.prevailing_retail_asp_inr ?? undefined
          },
          finding_summary: `Committed task result '${params.task_id}' for candidate '${params.candidate_id}'`
        });
      } catch (err: any) {
        // Non-fatal gallery sync
      }
    }

    return {
      commit_status: 'COMMITTED',
      task_id: params.task_id,
      candidate: ingestResult.candidate,
      screening_evaluation: screeningEval
    };
  }

  /**
   * Replays captures from an adapter and screens them in sequence.
   */
  public async replayAndScreen(
    adapter: SourceAdapterContract,
    options?: { limit?: number; since_utc?: string }
  ): Promise<readonly DiscoveryScreeningResult[]> {
    const captures = await adapter.fetchCaptures(options);
    const results: DiscoveryScreeningResult[] = [];

    for (const capture of captures) {
      const res = await this.screenCapture(capture);
      results.push(res);
    }

    return Object.freeze(results);
  }

  /**
   * Deterministically ranks a collection of candidates under the configured policy.
   * Ranking is reproducible across identical candidates and policy versions.
   * Sorted by priority_score_bps DESC, with candidate_id ASC tie-breaking.
   */
  public rankCandidates(
    candidates: readonly OpportunityCandidate[],
    policyEngine?: ScreeningPolicyEngine
  ): readonly ScreeningEvaluationResult[] {
    const engine = policyEngine ?? this.screeningEngine;
    const evaluated = candidates.map((cand) => engine.evaluateCandidate(cand));

    // Stable deterministic sort: score DESC, candidate_id ASC
    evaluated.sort((a, b) => {
      if (b.priority_score_bps !== a.priority_score_bps) {
        return b.priority_score_bps - a.priority_score_bps;
      }
      return a.candidate_id.localeCompare(b.candidate_id);
    });

    return Object.freeze(evaluated);
  }

  /**
   * Deterministically underwrites a discovered candidate against verified evidence,
   * unit economics, and formal policy constraints.
   */
  public async underwriteCandidate(
    candidateId: string,
    options?: {
      budgetConfig?: PaperCapitalBudgetConfig;
    }
  ): Promise<CandidateUnderwritingDecision> {
    return this.lifecycleEngine.underwriteCandidate(candidateId, options);
  }

  private deriveCandidateName(identity: ResolvedCanonicalIdentity): string {
    const metrics = identity.extracted_metrics || {};
    if (typeof metrics.title === 'string' && metrics.title.trim().length > 0) {
      return metrics.title.trim();
    }
    if (typeof metrics.item_name === 'string' && metrics.item_name.trim().length > 0) {
      return metrics.item_name.trim();
    }
    const parts = identity.product_id.split(':');
    if (parts.length >= 3) {
      return parts.slice(1).map((s) => s.toUpperCase()).join(' ');
    }
    return identity.product_id;
  }
}
