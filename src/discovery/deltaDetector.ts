/**
 * POC-001: Stage 0 Discovery Screener — Versioned Delta Detector (Slice 2B)
 *
 * Implements explicit, versioned delta-detection rules comparing incoming observations
 * against existing candidate state.
 *
 * Invariants:
 * 1. Materiality Thresholds: Price and quote fluctuations below explicit thresholds (bps & absolute INR)
 *    are classified as immaterial and emit UNCHANGED (heartbeat update without false alarms).
 * 2. Unbroken Provenance: Signals reflect commercial reality without modifying historical event hashes.
 * 3. Multi-Signal Detection: Detects pricing deltas, supplier quote shifts, newly surfaced customer grievances,
 *    stale evidence, specification modifications, and cross-source conflicts.
 */

import { OpportunityCandidate, ObservationChangeSignal, CandidateObservationSnapshot } from '../research/opportunityLifecycleEngine.js';
import { ScreeningPolicyConfig, DEFAULT_SCREENING_POLICY_V1 } from './screeningPolicy.js';

export interface DeltaDetectionInput {
  readonly prev_observation?: CandidateObservationSnapshot | null;
  readonly new_asp_inr?: number | null;
  readonly new_quote_inr?: number | null;
  readonly new_moq?: number | null;
  readonly new_sentiment_summary?: string | null;
  readonly new_payload_sha256?: string;
  readonly observed_at_utc?: string;
  readonly is_new_candidate?: boolean;
  readonly existing_active_signals?: readonly ObservationChangeSignal[];
  readonly source_connector_id?: string;
  readonly existing_source_connector_id?: string;
}

export interface DeltaDetectionResult {
  readonly primary_signal: ObservationChangeSignal;
  readonly all_detected_signals: readonly ObservationChangeSignal[];
  readonly is_material_change: boolean;
  readonly transition_reason: string;
  readonly price_delta_bps: number | null;
  readonly quote_delta_bps: number | null;
  readonly grievance_detected: boolean;
  readonly stale_detected: boolean;
  readonly conflict_detected: boolean;
}

export class DeltaDetector {
  private readonly config: ScreeningPolicyConfig;

  private static readonly GRIEVANCE_KEYWORDS = [
    'defect',
    'complaint',
    'broke',
    'broken',
    'stripped',
    'failure',
    'rust',
    'corrosion',
    'leak',
    'counterfeit',
    'inferior',
    'poor quality',
    'substandard'
  ];

  constructor(config?: Partial<ScreeningPolicyConfig>) {
    this.config = Object.freeze({
      ...DEFAULT_SCREENING_POLICY_V1,
      ...(config || {})
    });
  }

  public getConfig(): ScreeningPolicyConfig {
    return this.config;
  }

  /**
   * Compares incoming observation parameters against existing candidate state.
   */
  public detectDelta(input: DeltaDetectionInput): DeltaDetectionResult {
    const signals: ObservationChangeSignal[] = [];

    // 1. Initial Observation / New Candidate
    if (input.is_new_candidate || !input.prev_observation) {
      return {
        primary_signal: 'INITIAL_OBSERVATION',
        all_detected_signals: Object.freeze(['INITIAL_OBSERVATION']),
        is_material_change: true,
        transition_reason: 'Initial candidate discovery from marketplace listing',
        price_delta_bps: null,
        quote_delta_bps: null,
        grievance_detected: false,
        stale_detected: false,
        conflict_detected: false
      };
    }

    const prev = input.prev_observation;
    let isMaterial = false;
    let reason = 'Observation updated; values identical or below materiality threshold';
    let priceDeltaBps: number | null = null;
    let quoteDeltaBps: number | null = null;
    let grievanceDetected = false;
    let staleDetected = false;
    let conflictDetected = false;

    // 2. Retail ASP Movement & Materiality Check
    let priceEvaluated = false;
    let isPriceMaterial = false;
    if (
      typeof input.new_asp_inr === 'number' &&
      typeof prev.prevailing_retail_asp_inr === 'number' &&
      prev.prevailing_retail_asp_inr > 0
    ) {
      priceEvaluated = true;
      const prevAsp = prev.prevailing_retail_asp_inr;
      const newAsp = input.new_asp_inr;
      const absDelta = Math.abs(newAsp - prevAsp);
      priceDeltaBps = Math.round((absDelta / prevAsp) * 10000);

      isPriceMaterial =
        priceDeltaBps >= this.config.price_change_materiality_bps &&
        absDelta >= this.config.price_change_min_absolute_inr;

      if (isPriceMaterial) {
        signals.push('PRICE_CHANGED');
        isMaterial = true;
        reason = `Material retail ASP change: ₹${prevAsp.toFixed(2)} -> ₹${newAsp.toFixed(2)} (${priceDeltaBps} bps delta)`;
      }
    }

    // 3. Supplier Quote Movement & Materiality Check
    let quoteEvaluated = false;
    let isQuoteMaterial = false;
    if (
      typeof input.new_quote_inr === 'number' &&
      typeof prev.factory_gate_quote_inr === 'number' &&
      prev.factory_gate_quote_inr > 0
    ) {
      quoteEvaluated = true;
      const prevQuote = prev.factory_gate_quote_inr;
      const newQuote = input.new_quote_inr;
      const absDelta = Math.abs(newQuote - prevQuote);
      quoteDeltaBps = Math.round((absDelta / prevQuote) * 10000);

      isQuoteMaterial =
        quoteDeltaBps >= this.config.quote_change_materiality_bps &&
        absDelta >= this.config.quote_change_min_absolute_inr;

      if (isQuoteMaterial) {
        signals.push('SUPPLIER_QUOTE_UPDATED');
        isMaterial = true;
        reason = `Material factory quote update: ₹${prevQuote.toFixed(2)} -> ₹${newQuote.toFixed(2)} (${quoteDeltaBps} bps delta)`;
      }
    }

    // 4. Cross-Source Disagreement & Conflict Detection
    if (
      input.source_connector_id &&
      prev.source_connector_id &&
      input.source_connector_id !== prev.source_connector_id
    ) {
      // Different sources reporting quotes with significant variance
      if (
        typeof input.new_quote_inr === 'number' &&
        typeof prev.factory_gate_quote_inr === 'number' &&
        prev.factory_gate_quote_inr > 0
      ) {
        const quoteVarianceBps = Math.round(
          (Math.abs(input.new_quote_inr - prev.factory_gate_quote_inr) / prev.factory_gate_quote_inr) * 10000
        );
        if (quoteVarianceBps >= this.config.conflict_spread_threshold_bps) {
          signals.unshift('EVIDENCE_CONFLICT_DETECTED');
          conflictDetected = true;
          isMaterial = true;
          reason = `Cross-source quote divergence (${quoteVarianceBps} bps) between ${input.source_connector_id} and ${prev.source_connector_id}`;
        }
      }
    }

    // 5. Customer Grievance / Defect Detection
    if (input.new_sentiment_summary) {
      const lower = input.new_sentiment_summary.toLowerCase();
      const hasDefectKeyword = DeltaDetector.GRIEVANCE_KEYWORDS.some((kw) => lower.includes(kw));
      const prevLower = (prev.review_sentiment_summary || '').toLowerCase();
      const prevHadGrievance = DeltaDetector.GRIEVANCE_KEYWORDS.some((kw) => prevLower.includes(kw));

      if (hasDefectKeyword && (!prevHadGrievance || input.new_sentiment_summary !== prev.review_sentiment_summary)) {
        signals.push('GRIEVANCE_SURFACED');
        grievanceDetected = true;
        isMaterial = true;
        reason = `Customer defect grievance surfaced: "${input.new_sentiment_summary.slice(0, 100)}"`;
      }
    }

    // 6. Stale Evidence Check (TTL Check)
    const observationTime = input.observed_at_utc ? new Date(input.observed_at_utc).getTime() : Date.now();
    const prevTime = new Date(prev.observed_at_utc).getTime();
    const ageHours = (observationTime - prevTime) / (1000 * 60 * 60);

    if (ageHours > this.config.evidence_ttl_hours) {
      signals.push('EVIDENCE_STALE');
      staleDetected = true;
      isMaterial = true;
      reason = `Evidence age (${Math.round(ageHours)} hours) exceeds maximum TTL (${this.config.evidence_ttl_hours} hours)`;
    }

    // 7. Specification Modification Check
    const hasImmaterialPriceOrQuote =
      (priceEvaluated && !isPriceMaterial && (priceDeltaBps ?? 0) > 0) ||
      (quoteEvaluated && !isQuoteMaterial && (quoteDeltaBps ?? 0) > 0);

    if (
      !hasImmaterialPriceOrQuote &&
      input.new_payload_sha256 &&
      prev.payload_sha256 &&
      input.new_payload_sha256 !== prev.payload_sha256 &&
      signals.length === 0
    ) {
      signals.push('SPEC_MODIFIED');
      isMaterial = true;
      reason = 'Commercial listing specification or packaging attributes modified';
    }

    // 8. Fallback to UNCHANGED if no material signals
    if (signals.length === 0) {
      signals.push('UNCHANGED');
    }

    return {
      primary_signal: signals[0],
      all_detected_signals: Object.freeze(signals),
      is_material_change: isMaterial,
      transition_reason: reason,
      price_delta_bps: priceDeltaBps,
      quote_delta_bps: quoteDeltaBps,
      grievance_detected: grievanceDetected,
      stale_detected: staleDetected,
      conflict_detected: conflictDetected
    };
  }
}
