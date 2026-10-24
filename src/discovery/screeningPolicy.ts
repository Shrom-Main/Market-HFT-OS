/**
 * POC-001: Stage 0 Discovery Screener — Explainable Screening Policy & Priority Engine (Slice 2B)
 *
 * Implements a deterministic, versioned screening and prioritization policy for candidate opportunities.
 *
 * Invariants:
 * 1. Orthogonal Separation: Commercial attractiveness, evidence completeness, and underwriting eligibility
 *    remain strictly separate dimensions. High commercial spread with low evidence receives investigation
 *    priority, NEVER verified or paper-eligible status.
 * 2. Zero Fabrication: Missing data remains null. Banned from substituting zero for missing quotes, fabricating
 *    prices, or inferring volume from review counts.
 * 3. 100% Deterministic Reproducibility: For identical inputs and policy versions, produces bit-identical
 *    score breakdowns, ranking orders, and canonical RFC 8785 JCS digests.
 * 4. Explainable Rationale: Every score and tier assignment includes machine-readable and human-auditable
 *    prioritization and deferral reasons.
 */

import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { OpportunityCandidate, ObservationChangeSignal } from '../research/opportunityLifecycleEngine.js';

export type ScreeningPriorityTier =
  | 'CRITICAL'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'DEFERRED'
  | 'REJECTED';

export type InvestigationTaskType =
  | 'SUPPLIER_QUOTE_ACQUISITION'
  | 'RETAIL_ASP_VERIFICATION'
  | 'GRIEVANCE_SEVERITY_MINING'
  | 'LOGISTICS_ROUTE_VERIFICATION'
  | 'STATUTORY_REGULATORY_CLEARANCE'
  | 'CONFLICT_ARBITRATION';

export interface RecommendedInvestigationTask {
  readonly task_id: string;
  readonly task_type: InvestigationTaskType;
  readonly target_field: string;
  readonly priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly rationale: string;
}

export interface ScreeningPolicyConfig {
  readonly policy_version: string;
  readonly price_change_materiality_bps: number; // e.g. 100 bps (1.0%)
  readonly price_change_min_absolute_inr: number; // e.g. 0.50 INR
  readonly quote_change_materiality_bps: number; // e.g. 100 bps
  readonly quote_change_min_absolute_inr: number; // e.g. 0.50 INR
  readonly conflict_spread_threshold_bps: number; // e.g. 500 bps (5.0%)
  readonly evidence_ttl_hours: number; // e.g. 720 hours (30 days)
  // Deterministic weight allocation in basis points (sum to 10,000 bps = 100%):
  readonly weight_commercial_bps: number; // 3500 bps (35%)
  readonly weight_evidence_completeness_bps: number; // 3000 bps (30%)
  readonly weight_signal_urgency_bps: number; // 2000 bps (20%)
  readonly weight_provenance_bps: number; // 1500 bps (15%)
}

export const DEFAULT_SCREENING_POLICY_V1: ScreeningPolicyConfig = Object.freeze({
  policy_version: '1.0.0',
  price_change_materiality_bps: 100, // 1.0%
  price_change_min_absolute_inr: 0.5,
  quote_change_materiality_bps: 100, // 1.0%
  quote_change_min_absolute_inr: 0.5,
  conflict_spread_threshold_bps: 500, // 5.0%
  evidence_ttl_hours: 720, // 30 days
  weight_commercial_bps: 3500,
  weight_evidence_completeness_bps: 3000,
  weight_signal_urgency_bps: 2000,
  weight_provenance_bps: 1500
});

export interface SupportingObservationReference {
  readonly source_connector_id: string;
  readonly capture_id?: string;
  readonly observed_at_utc: string;
  readonly origin_class: string;
  readonly payload_sha256: string;
}

export interface ScreeningEvaluationResult {
  readonly candidate_id: string;
  readonly canonical_product_id: string;
  readonly screening_policy_version: string;
  readonly priority_tier: ScreeningPriorityTier;
  readonly priority_score_bps: number; // 0 to 10,000 bps
  readonly score_breakdown: {
    readonly commercial_bps: number;
    readonly evidence_completeness_bps: number;
    readonly signal_urgency_bps: number;
    readonly provenance_bps: number;
  };
  readonly active_signals: readonly ObservationChangeSignal[];
  readonly missing_critical_fields: readonly string[];
  readonly uncorroborated_fields: readonly string[];
  readonly prioritization_reasons: readonly string[];
  readonly deferral_or_rejection_reasons: readonly string[];
  readonly recommended_investigation_tasks: readonly RecommendedInvestigationTask[];
  readonly supporting_observations: readonly SupportingObservationReference[];
  readonly evaluated_at_utc: string;
  readonly jcs_sha256: string;
}

/**
 * Deterministic Screening and Prioritization Engine.
 */
export class ScreeningPolicyEngine {
  private readonly config: ScreeningPolicyConfig;

  constructor(config?: Partial<ScreeningPolicyConfig>) {
    this.config = Object.freeze({
      ...DEFAULT_SCREENING_POLICY_V1,
      ...(config || {})
    });

    const totalWeight =
      this.config.weight_commercial_bps +
      this.config.weight_evidence_completeness_bps +
      this.config.weight_signal_urgency_bps +
      this.config.weight_provenance_bps;

    if (totalWeight !== 10000) {
      throw new Error(`E-SCREEN-WEIGHT-SUM: Screening policy weights must sum exactly to 10,000 bps (got ${totalWeight})`);
    }
  }

  public getConfig(): ScreeningPolicyConfig {
    return this.config;
  }

  /**
   * Evaluates a candidate under the configured screening policy.
   * Deterministic, explainable, and invariant to execution time when evaluated_at_utc is provided.
   */
  public evaluateCandidate(
    candidate: OpportunityCandidate,
    options?: {
      evaluated_at_utc?: string;
      supporting_observations?: readonly SupportingObservationReference[];
      origin_class?: string;
    }
  ): ScreeningEvaluationResult {
    const evaluatedAt = options?.evaluated_at_utc ?? candidate.last_seen_utc;
    const prioritizationReasons: string[] = [];
    const deferralReasons: string[] = [];
    const recommendedTasks: RecommendedInvestigationTask[] = [];

    // 1. Commercial Attractiveness Component (0..10,000 bps)
    const commResult = this.computeCommercialScore(candidate, prioritizationReasons, deferralReasons);

    // 2. Evidence Completeness Component (0..10,000 bps)
    const evidResult = this.computeEvidenceCompletenessScore(candidate, prioritizationReasons, deferralReasons);

    // 3. Signal Urgency Component (0..10,000 bps)
    const signalResult = this.computeSignalUrgencyScore(candidate, prioritizationReasons, deferralReasons);

    // 4. Provenance Reliability Component (0..10,000 bps)
    const provResult = this.computeProvenanceScore(options?.origin_class, prioritizationReasons, deferralReasons);

    // 5. Generate Recommended Investigation Tasks
    this.generateInvestigationTasks(candidate, recommendedTasks);

    // 6. Weighted Composite Priority Score (0..10,000 bps)
    // Pure integer arithmetic: floor((S1*W1 + S2*W2 + S3*W3 + S4*W4) / 10000)
    const rawWeighted =
      commResult.score_bps * this.config.weight_commercial_bps +
      evidResult.score_bps * this.config.weight_evidence_completeness_bps +
      signalResult.score_bps * this.config.weight_signal_urgency_bps +
      provResult.score_bps * this.config.weight_provenance_bps;

    const compositeScoreBps = Math.min(10000, Math.max(0, Math.floor(rawWeighted / 10000)));

    // 7. Determine Priority Tier
    const priorityTier = this.derivePriorityTier(compositeScoreBps, candidate, deferralReasons);

    // 8. Build Supporting Observation References
    const obsRef: SupportingObservationReference = {
      source_connector_id: candidate.current_observation.source_connector_id,
      observed_at_utc: candidate.current_observation.observed_at_utc,
      origin_class: options?.origin_class ?? 'RECORDED_GOLDEN_FIXTURE',
      payload_sha256: candidate.current_observation.payload_sha256
    };
    const supporting = options?.supporting_observations && options.supporting_observations.length > 0
      ? options.supporting_observations
      : [obsRef];

    // 9. Produce Bit-Identical RFC 8785 Canonical State Digest
    const payloadForHash = {
      candidate_id: candidate.candidate_id,
      canonical_product_id: candidate.canonical_product_id,
      screening_policy_version: this.config.policy_version,
      priority_tier: priorityTier,
      priority_score_bps: compositeScoreBps,
      score_breakdown: {
        commercial_bps: commResult.score_bps,
        evidence_completeness_bps: evidResult.score_bps,
        signal_urgency_bps: signalResult.score_bps,
        provenance_bps: provResult.score_bps
      },
      active_signals: candidate.active_signals,
      missing_critical_fields: candidate.evidence_sufficiency.missing_critical_fields,
      evaluated_at_utc: evaluatedAt
    };

    const jcsSha256 = sha256(canonicalizeJCS(payloadForHash));

    return {
      candidate_id: candidate.candidate_id,
      canonical_product_id: candidate.canonical_product_id,
      screening_policy_version: this.config.policy_version,
      priority_tier: priorityTier,
      priority_score_bps: compositeScoreBps,
      score_breakdown: {
        commercial_bps: commResult.score_bps,
        evidence_completeness_bps: evidResult.score_bps,
        signal_urgency_bps: signalResult.score_bps,
        provenance_bps: provResult.score_bps
      },
      active_signals: candidate.active_signals,
      missing_critical_fields: candidate.evidence_sufficiency.missing_critical_fields,
      uncorroborated_fields: candidate.evidence_sufficiency.uncorroborated_fields,
      prioritization_reasons: Object.freeze(prioritizationReasons),
      deferral_or_rejection_reasons: Object.freeze(deferralReasons),
      recommended_investigation_tasks: Object.freeze(recommendedTasks),
      supporting_observations: Object.freeze(supporting),
      evaluated_at_utc: evaluatedAt,
      jcs_sha256: jcsSha256
    };
  }

  private computeCommercialScore(
    candidate: OpportunityCandidate,
    prioritizationReasons: string[],
    deferralReasons: string[]
  ): { score_bps: number } {
    const asp = candidate.current_observation.prevailing_retail_asp_inr;
    const quote = candidate.current_observation.factory_gate_quote_inr;

    if (asp === null || quote === null) {
      if (quote === null) {
        deferralReasons.push('Missing factory gate quote; wholesale procurement spread cannot be computed.');
      }
      if (asp === null) {
        deferralReasons.push('Missing retail ASP; retail contribution margin cannot be computed.');
      }
      return { score_bps: 0 };
    }

    if (asp <= 0 || quote <= 0) {
      deferralReasons.push('Non-positive price or quote reported; economic contribution is invalid.');
      return { score_bps: 0 };
    }

    const spread = asp - quote;
    if (spread <= 0) {
      deferralReasons.push(`Negative gross spread (₹${quote} quote exceeds ₹${asp} retail ASP); negative arbitrage margin.`);
      return { score_bps: 0 };
    }

    const marginBps = Math.round((spread / asp) * 10000);
    prioritizationReasons.push(`Estimated gross spread ₹${spread.toFixed(2)} (${marginBps} bps gross margin).`);

    // Scale margin to 0..10,000 bps score: 50% margin (5000 bps) maps to max 10,000 score
    const score = Math.min(10000, Math.round((marginBps / 5000) * 10000));
    return { score_bps: score };
  }

  private computeEvidenceCompletenessScore(
    candidate: OpportunityCandidate,
    prioritizationReasons: string[],
    deferralReasons: string[]
  ): { score_bps: number } {
    const score = candidate.evidence_sufficiency.sufficiency_score_bps;

    if (candidate.evidence_sufficiency.is_sufficient_for_underwriting) {
      prioritizationReasons.push(`Evidence sufficiency complete (${score} bps): all 5 mandatory facets verified.`);
    } else {
      const missingCount = candidate.evidence_sufficiency.missing_critical_fields.length;
      if (missingCount > 0) {
        deferralReasons.push(`Incomplete evidence (${score} bps): missing ${missingCount} critical field(s) [${candidate.evidence_sufficiency.missing_critical_fields.join(', ')}].`);
      }
    }

    return { score_bps: score };
  }

  private computeSignalUrgencyScore(
    candidate: OpportunityCandidate,
    prioritizationReasons: string[],
    deferralReasons: string[]
  ): { score_bps: number } {
    let maxSignalScore = 1000; // Baseline UNCHANGED score

    for (const signal of candidate.active_signals) {
      switch (signal) {
        case 'GRIEVANCE_SURFACED':
          prioritizationReasons.push('Urgent customer grievance / product defect detected in review sentiment.');
          maxSignalScore = Math.max(maxSignalScore, 10000);
          break;
        case 'PRICE_CHANGED':
          prioritizationReasons.push('Material retail ASP movement detected; commercial window active.');
          maxSignalScore = Math.max(maxSignalScore, 8000);
          break;
        case 'SUPPLIER_QUOTE_UPDATED':
          prioritizationReasons.push('Supplier factory gate quote updated; cost structure refreshed.');
          maxSignalScore = Math.max(maxSignalScore, 8000);
          break;
        case 'EVIDENCE_CONFLICT_DETECTED':
          prioritizationReasons.push('Cross-source evidence disagreement requires arbitration.');
          maxSignalScore = Math.max(maxSignalScore, 7500);
          break;
        case 'EVIDENCE_STALE':
          deferralReasons.push('Observation age exceeds allowable TTL; candidate data requires refreshing.');
          maxSignalScore = Math.max(maxSignalScore, 6000);
          break;
        case 'INITIAL_OBSERVATION':
        case 'NEW_CANDIDATE':
          prioritizationReasons.push('New candidate discovered; awaiting initial screener prioritization.');
          maxSignalScore = Math.max(maxSignalScore, 5000);
          break;
        case 'SPEC_MODIFIED':
          prioritizationReasons.push('Listing specification or packaging changed.');
          maxSignalScore = Math.max(maxSignalScore, 4000);
          break;
        case 'UNCHANGED':
        default:
          break;
      }
    }

    return { score_bps: maxSignalScore };
  }

  private computeProvenanceScore(
    originClass: string | undefined,
    prioritizationReasons: string[],
    deferralReasons: string[]
  ): { score_bps: number } {
    const origin = originClass ?? 'RECORDED_GOLDEN_FIXTURE';

    switch (origin) {
      case 'LIVE_VERIFIED_CAPTURE':
        prioritizationReasons.push('Provenance: LIVE_VERIFIED_CAPTURE from authenticated provider.');
        return { score_bps: 10000 };
      case 'RECORDED_GOLDEN_FIXTURE':
        prioritizationReasons.push('Provenance: RECORDED_GOLDEN_FIXTURE with cryptographic payload signature.');
        return { score_bps: 7500 };
      case 'ESTIMATED_PROXY':
        deferralReasons.push('Provenance: ESTIMATED_PROXY requires primary source verification.');
        return { score_bps: 4000 };
      case 'UNATTESTED_USER_INTAKE':
      default:
        deferralReasons.push('Provenance: UNATTESTED_USER_INTAKE lacks cryptographic verification.');
        return { score_bps: 2000 };
    }
  }

  private derivePriorityTier(
    scoreBps: number,
    candidate: OpportunityCandidate,
    deferralReasons: string[]
  ): ScreeningPriorityTier {
    if (candidate.lifecycle_state === 'REJECTED') {
      return 'REJECTED';
    }

    // Negative commercial spread or invalid pricing forces DEFERRED
    const asp = candidate.current_observation.prevailing_retail_asp_inr;
    const quote = candidate.current_observation.factory_gate_quote_inr;
    if (asp !== null && quote !== null && asp <= quote) {
      return 'DEFERRED';
    }

    if (scoreBps >= 8000) return 'CRITICAL';
    if (scoreBps >= 6000) return 'HIGH';
    if (scoreBps >= 4000) return 'MEDIUM';
    if (scoreBps >= 2000) return 'LOW';
    return 'DEFERRED';
  }

  private generateInvestigationTasks(
    candidate: OpportunityCandidate,
    tasks: RecommendedInvestigationTask[]
  ): void {
    const candidateId = candidate.candidate_id;

    // Missing factory quote
    if (candidate.current_observation.factory_gate_quote_inr === null) {
      tasks.push({
        task_id: `TASK-QUOTE-${candidateId.slice(4, 12)}`,
        task_type: 'SUPPLIER_QUOTE_ACQUISITION',
        target_field: 'factory_gate_quote_inr',
        priority: 'HIGH',
        rationale: 'Missing factory gate quote prevents gross spread and unit economics calculation.'
      });
    }

    // Missing retail ASP
    if (candidate.current_observation.prevailing_retail_asp_inr === null) {
      tasks.push({
        task_id: `TASK-ASP-${candidateId.slice(4, 12)}`,
        task_type: 'RETAIL_ASP_VERIFICATION',
        target_field: 'prevailing_retail_asp_inr',
        priority: 'HIGH',
        rationale: 'Missing prevailing retail ASP prevents market price benchmark and margin evaluation.'
      });
    }

    // Grievance surfaced
    if (candidate.active_signals.includes('GRIEVANCE_SURFACED')) {
      tasks.push({
        task_id: `TASK-GRIEVANCE-${candidateId.slice(4, 12)}`,
        task_type: 'GRIEVANCE_SEVERITY_MINING',
        target_field: 'review_sentiment_summary',
        priority: 'CRITICAL',
        rationale: 'Customer complaints or defect patterns surfaced; requires verbatim quote extraction and risk analysis.'
      });
    }

    // Logistics corridor uncorroborated
    if (!candidate.evidence_sufficiency.has_logistics_route) {
      tasks.push({
        task_id: `TASK-LOGISTICS-${candidateId.slice(4, 12)}`,
        task_type: 'LOGISTICS_ROUTE_VERIFICATION',
        target_field: 'logistics_freight_corridor',
        priority: 'MEDIUM',
        rationale: 'Freight corridor between supplier manufacturing hub and fulfillment destination unverified.'
      });
    }

    // Regulatory / HSN clearance uncorroborated
    if (!candidate.evidence_sufficiency.has_regulatory_clearance) {
      tasks.push({
        task_id: `TASK-REGULATORY-${candidateId.slice(4, 12)}`,
        task_type: 'STATUTORY_REGULATORY_CLEARANCE',
        target_field: 'statutory_hsn_gst_rate',
        priority: 'MEDIUM',
        rationale: 'HSN statutory code and applicable GST tax rate require official regulatory clearance.'
      });
    }

    // Conflict detected
    if (candidate.active_signals.includes('EVIDENCE_CONFLICT_DETECTED')) {
      tasks.push({
        task_id: `TASK-CONFLICT-${candidateId.slice(4, 12)}`,
        task_type: 'CONFLICT_ARBITRATION',
        target_field: 'all_observations',
        priority: 'HIGH',
        rationale: 'Conflicting commercial data reported across multiple independent sources requires cross-source arbitration.'
      });
    }
  }
}
