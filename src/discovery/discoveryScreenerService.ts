/**
 * POC-001: Stage 0 Discovery Screener — Discovery Funnel & Normalization Service (Slice 2A)
 *
 * Implements the Stage 0 Discovery Screener that:
 * 1. Takes RawSourceCapture envelopes from discovery source adapters.
 * 2. Uses EntityIdentityResolver to map raw captures to canonical product/offer identities.
 * 3. Rejects ambiguous or non-catalog listings to UNRESOLVED_ENTITY_HOLD without phantom entity invention.
 * 4. Normalizes commercial parameters without zero-cost or synthetic price substitution.
 * 5. Feeds normalized observations into OpportunityLifecycleEngine.ingestObservation().
 * 6. Preserves complete provenance, timestamps (T_source and T_ingest), and hash digests.
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

export interface DiscoveryScreeningResult {
  readonly capture_id: string;
  readonly resolution_status: 'RESOLVED' | 'UNRESOLVED_ENTITY_HOLD' | 'CONFLICT_DETECTED';
  readonly normalized_observation: NormalizedDiscoveryObservation | null;
  readonly candidate: OpportunityCandidate | null;
  readonly signal: ObservationChangeSignal | null;
  readonly is_new_candidate: boolean;
  readonly notes: string;
}

export interface DiscoveryScreenerOptions {
  readonly lifecycleEngine?: OpportunityLifecycleEngine;
  readonly identityResolver?: EntityIdentityResolver;
  readonly defaultStrategyId?: string;
}

export class DiscoveryScreenerService {
  private readonly lifecycleEngine: OpportunityLifecycleEngine;
  private readonly identityResolver: EntityIdentityResolver;
  private readonly defaultStrategyId: string;

  constructor(options?: DiscoveryScreenerOptions) {
    this.lifecycleEngine = options?.lifecycleEngine ?? new OpportunityLifecycleEngine();
    this.identityResolver = options?.identityResolver ?? new EntityIdentityResolver();
    this.defaultStrategyId = options?.defaultStrategyId ?? 'strat:india-b2b:physical-arbitrage';
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

  /**
   * Screens a single raw source capture through canonical identity resolution
   * and routes it to the opportunity lifecycle engine if resolved.
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
        notes: resolvedIdentity.resolution_notes
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

    // 4. Ingest into OpportunityLifecycleEngine
    const ingestInput: IngestObservationInput = {
      strategy_id: normalizedObs.strategy_id,
      canonical_product_id: normalizedObs.canonical_product_id,
      candidate_name: normalizedObs.candidate_name,
      source_connector_id: normalizedObs.source_connector_id,
      prevailing_retail_asp_inr: normalizedObs.prevailing_retail_asp_inr,
      factory_gate_quote_inr: normalizedObs.factory_gate_quote_inr,
      unit_batch_moq: normalizedObs.unit_batch_moq,
      observed_seller_count: normalizedObs.observed_seller_count,
      review_sentiment_summary: normalizedObs.review_sentiment_summary,
      raw_payload: capture.raw_payload,
      has_logistics_route: normalizedObs.has_logistics_route,
      has_regulatory_clearance: normalizedObs.has_regulatory_clearance,
      observed_at_utc: normalizedObs.source_observed_at_utc
    };

    const ingestResult = await this.lifecycleEngine.ingestObservation(ingestInput);

    return {
      capture_id: capture.capture_id,
      resolution_status: resolvedIdentity.resolution_status,
      normalized_observation: normalizedObs,
      candidate: ingestResult.candidate,
      signal: ingestResult.signal,
      is_new_candidate: ingestResult.is_new,
      notes: `Ingested into OpportunityLifecycleEngine with signal: ${ingestResult.signal}`
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

  private deriveCandidateName(identity: ResolvedCanonicalIdentity): string {
    const parts = identity.product_id.split(':');
    if (parts.length >= 3) {
      return parts.slice(1).map((s) => s.toUpperCase()).join(' ');
    }
    return identity.product_id;
  }
}
