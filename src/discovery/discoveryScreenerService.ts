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
  IngestObservationInput
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

export interface DiscoveryScreeningResult {
  readonly capture_id: string;
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
}

export interface DiscoveryScreenerOptions {
  readonly lifecycleEngine?: OpportunityLifecycleEngine;
  readonly identityResolver?: EntityIdentityResolver;
  readonly screeningEngine?: ScreeningPolicyEngine;
  readonly deltaDetector?: DeltaDetector;
  readonly defaultStrategyId?: string;
  readonly policyConfig?: Partial<ScreeningPolicyConfig>;
}

export class DiscoveryScreenerService {
  private readonly lifecycleEngine: OpportunityLifecycleEngine;
  private readonly identityResolver: EntityIdentityResolver;
  private readonly screeningEngine: ScreeningPolicyEngine;
  private readonly deltaDetector: DeltaDetector;
  private readonly defaultStrategyId: string;

  constructor(options?: DiscoveryScreenerOptions) {
    this.lifecycleEngine = options?.lifecycleEngine ?? new OpportunityLifecycleEngine();
    this.identityResolver = options?.identityResolver ?? new EntityIdentityResolver();
    this.defaultStrategyId = options?.defaultStrategyId ?? 'strat:india-b2b:physical-arbitrage';

    const policyConfig = options?.policyConfig;
    this.screeningEngine = options?.screeningEngine ?? new ScreeningPolicyEngine(policyConfig);
    this.deltaDetector = options?.deltaDetector ?? new DeltaDetector(policyConfig);
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

    return {
      capture_id: capture.capture_id,
      resolution_status: resolvedIdentity.resolution_status,
      normalized_observation: normalizedObs,
      candidate: ingestResult.candidate,
      signal: ingestResult.signal,
      is_new_candidate: ingestResult.is_new,
      notes: `${deltaResult.transition_reason}. Priority: ${screeningEval.priority_tier} (${screeningEval.priority_score_bps} bps).`,
      screening_evaluation: screeningEval,
      priority_score_bps: screeningEval.priority_score_bps,
      priority_tier: screeningEval.priority_tier,
      recommended_tasks: screeningEval.recommended_investigation_tasks
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
