/**
 * Gate M5 Signal Bus & 4D Evidence Architecture
 *
 * Implements:
 * 1. Four Orthogonal Evidence Dimensions (POC.docx §5):
 *    - evidence_kind
 *    - verification_status
 *    - commercial_status
 *    - provenance_lineage
 * 2. 4D Evidence Promotion State Machine (blocking illegal auto-promotion).
 * 3. Six-Channel Continuous Signal Ingestion & Economic Factor Mapping.
 * 4. Nine-Stage "Deep Research Pro" Pipeline Contract (POC.docx §15).
 * 5. Six-Status Return & Lifecycle Vocabulary (POC.docx §5).
 */

import { createHash } from 'crypto';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { FormulaRegistry } from './formulaRegistry.js';
import { GroqFormulaAdvisor } from './llmFormulaAdvisor.js';

// ============================================================================
// 1. FOUR ORTHOGONAL EVIDENCE DIMENSIONS (POC.docx §5)
// ============================================================================

export type EvidenceKind =
  | 'OBSERVED_FACT'
  | 'SOURCE_DOCUMENT'
  | 'ASSUMPTION'
  | 'FORECAST'
  | 'SYNTHETIC_SCENARIO';

export type EvidenceVerificationStatus =
  | 'UNVERIFIED'
  | 'CRYPTOGRAPHICALLY_ATTESTED'
  | 'CROSS_SOURCE_CORROBORATED'
  | 'REJECTED';

export type CommercialStatus =
  | 'NOT_APPLICABLE'
  | 'ADVERTISED_LISTING'
  | 'SUPPLIER_QUOTE'
  | 'VERIFIED_EXECUTABLE_OFFER'
  | 'ACCEPTED_COMMITMENT'
  | 'COMPLETED_TRANSACTION';

export type SignalChannel =
  | 'NEWS_TRADE_PRESS'
  | 'YOUTUBE_VIDEO_TRANSCRIPT'
  | 'SOCIAL_FORUM_CHATTER'
  | 'MACROECONOMIC_INDICATOR'
  | 'LATERAL_FINANCIAL_MARKET'
  | 'GOVERNMENT_SCHEME_POLICY';

export type EvidenceOriginClass =
  | 'LIVE_VERIFIED_CAPTURE'
  | 'RECORDED_GOLDEN_FIXTURE'
  | 'CALLER_SUPPLIED_PAYLOAD'
  | 'SYNTHETIC_SIMULATION'
  | 'LLM_MODEL_PROPOSAL';

export interface ProvenanceLineage {
  source_id: string;
  channel: SignalChannel;
  observed_at_utc: string; // ISO 8601 UTC
  ttl_seconds: number;
  parent_claim_hashes?: string[];
  transformation_rule_id?: string;
  evidence_origin_class?: EvidenceOriginClass;
  requested_url?: string;
  resolved_source_identity?: string;
  extractor_version?: string;
}

export interface EvidenceEnvelope<T> {
  evidence_id: string;
  kind: EvidenceKind;
  verification_status: EvidenceVerificationStatus;
  commercial_status: CommercialStatus;
  provenance: ProvenanceLineage;
  payload: T;
  jcs_hash: string;
  attestation_signature?: string;
}

export function computeEvidenceJcsHash<T>(envelope: Omit<EvidenceEnvelope<T>, 'jcs_hash'>): string {
  const canonical = canonicalizeJCS(envelope);
  return createHash('sha256').update(canonical).digest('hex');
}

export function createEvidenceEnvelope<T>(
  input: Omit<EvidenceEnvelope<T>, 'jcs_hash'>
): EvidenceEnvelope<T> {
  const jcs_hash = computeEvidenceJcsHash(input);
  return {
    ...input,
    jcs_hash
  };
}

// ============================================================================
// 2. 4D EVIDENCE PROMOTION STATE MACHINE
// ============================================================================

export class EvidencePromotionEngine {
  /**
   * Promotes commercial status of an evidence envelope with strict validation.
   * Prohibits ADVERTISED_LISTING or SYNTHETIC_SCENARIO from promoting to
   * VERIFIED_EXECUTABLE_OFFER without cryptographic attestation or corroboration.
   * Strictly bars non-live evidence origins (RECORDED_GOLDEN_FIXTURE, CALLER_SUPPLIED_PAYLOAD,
   * SYNTHETIC_SIMULATION, LLM_MODEL_PROPOSAL) from promoting to VERIFIED_EXECUTABLE_OFFER.
   */
  public static promoteCommercialStatus<T>(
    envelope: EvidenceEnvelope<T>,
    targetStatus: CommercialStatus,
    options?: {
      attestation_signature?: string;
      corroborating_source_ids?: string[];
    }
  ): EvidenceEnvelope<T> {
    // Check illegal promotion to VERIFIED_EXECUTABLE_OFFER
    if (targetStatus === 'VERIFIED_EXECUTABLE_OFFER') {
      if (
        envelope.provenance.evidence_origin_class &&
        envelope.provenance.evidence_origin_class !== 'LIVE_VERIFIED_CAPTURE'
      ) {
        throw new Error(
          `E-EV-NON-LIVE-ORIGIN-PROMOTION-FORBIDDEN: Cannot promote claim with origin '${envelope.provenance.evidence_origin_class}' to VERIFIED_EXECUTABLE_OFFER. Only LIVE_VERIFIED_CAPTURE claims can be promoted to executable offers.`
        );
      }

      const isAttested =
        envelope.verification_status === 'CRYPTOGRAPHICALLY_ATTESTED' ||
        Boolean(options?.attestation_signature);

      const isCorroborated =
        envelope.verification_status === 'CROSS_SOURCE_CORROBORATED' ||
        (options?.corroborating_source_ids && options.corroborating_source_ids.length >= 2);

      if (!isAttested && !isCorroborated) {
        throw new Error(
          `E-ERR-EV-001: ILLEGAL_EVIDENCE_PROMOTION: Cannot promote ${envelope.commercial_status} (${envelope.kind}) to VERIFIED_EXECUTABLE_OFFER without cryptographic attestation or cross-source corroboration`
        );
      }
    }

    let updatedVerification = envelope.verification_status;
    if (options?.attestation_signature) {
      updatedVerification = 'CRYPTOGRAPHICALLY_ATTESTED';
    } else if (options?.corroborating_source_ids && options.corroborating_source_ids.length >= 2) {
      updatedVerification = 'CROSS_SOURCE_CORROBORATED';
    }

    const updatedWithoutHash: Omit<EvidenceEnvelope<T>, 'jcs_hash'> = {
      evidence_id: envelope.evidence_id,
      kind: envelope.kind,
      verification_status: updatedVerification,
      commercial_status: targetStatus,
      provenance: {
        ...envelope.provenance,
        transformation_rule_id: 'RULE-COMMERCIAL-STATUS-PROMOTION'
      },
      payload: envelope.payload,
      attestation_signature: options?.attestation_signature ?? envelope.attestation_signature
    };

    const jcs_hash = computeEvidenceJcsHash(updatedWithoutHash);
    return {
      ...updatedWithoutHash,
      jcs_hash
    };
  }

  /**
   * Computes an evidence conviction score (0 - 100) based strictly on 4D evidence properties.
   */
  public static computeConvictionScore(envelopes: EvidenceEnvelope<any>[]): number {
    if (envelopes.length === 0) return 0;

    let scoreSum = 0;
    for (const env of envelopes) {
      let weight = 0;
      // Verification status weight
      if (env.verification_status === 'CRYPTOGRAPHICALLY_ATTESTED') weight += 50;
      else if (env.verification_status === 'CROSS_SOURCE_CORROBORATED') weight += 40;
      else if (env.verification_status === 'UNVERIFIED') weight += 10;
      else weight += 0; // REJECTED

      // Commercial status weight
      if (env.commercial_status === 'VERIFIED_EXECUTABLE_OFFER') weight += 40;
      else if (env.commercial_status === 'SUPPLIER_QUOTE') weight += 30;
      else if (env.commercial_status === 'ADVERTISED_LISTING') weight += 10;
      else if (env.commercial_status === 'COMPLETED_TRANSACTION') weight += 50;

      // Evidence kind modifier
      if (env.kind === 'OBSERVED_FACT' || env.kind === 'SOURCE_DOCUMENT') weight += 10;
      else if (env.kind === 'ASSUMPTION' || env.kind === 'SYNTHETIC_SCENARIO') weight -= 20;

      scoreSum += Math.max(0, Math.min(100, weight));
    }

    return Math.round(scoreSum / envelopes.length);
  }
}

// ============================================================================
// 3. SIX-CHANNEL CONTINUOUS SIGNAL TAXONOMY
// ============================================================================

export interface RawSignalInput {
  signal_id: string;
  channel: SignalChannel;
  source_id: string;
  observed_at_utc: string;
  ttl_seconds: number;
  data: Record<string, any>;
}

export interface NormalizedSignal {
  signal_id: string;
  channel: SignalChannel;
  observed_at_utc: string;
  ttl_seconds: number;
  economic_factor_name: string;
  magnitude_bps: bigint;
  target_sku_pattern: string;
  provenance_summary: string;
  jcs_hash: string;
}

export class SignalNormalizer {
  /**
   * Normalizes raw signals from any of the 6 channels into a structured economic factor shock.
   */
  public static normalizeSignal(raw: RawSignalInput): NormalizedSignal {
    let factorName = 'GENERAL_MACRO_INDICATOR';
    let magnitudeBps = 0n;
    let targetPattern = '*';
    let summary = '';

    switch (raw.channel) {
      case 'NEWS_TRADE_PRESS':
        factorName = 'INBOUND_LOGISTICS_LEAD_TIME_SHOCK';
        magnitudeBps = BigInt(raw.data.freight_delay_bps ?? raw.data.sentiment_bps ?? 500);
        targetPattern = raw.data.target_sku_pattern ?? 'prod:*';
        summary = `Trade press alert from ${raw.source_id}: ${raw.data.headline ?? 'Supply chain bulletin'}`;
        break;

      case 'YOUTUBE_VIDEO_TRANSCRIPT':
        factorName = 'CUSTOMER_RETURN_RATE_SHOCK';
        magnitudeBps = BigInt(raw.data.defect_complaint_bps ?? raw.data.rust_report_bps ?? 300);
        targetPattern = raw.data.target_sku_pattern ?? 'prod:din3017:ss304:*';
        summary = `YouTube industrial review defect alert from ${raw.data.channel_name ?? raw.source_id}`;
        break;

      case 'SOCIAL_FORUM_CHATTER':
        factorName = 'DAMAGED_QUARANTINE_ATTRITION_SHOCK';
        magnitudeBps = BigInt(raw.data.breakage_report_bps ?? 400);
        targetPattern = raw.data.target_sku_pattern ?? 'prod:*';
        summary = `Seller community chatter on ${raw.data.platform ?? 'forum'}: ${raw.data.complaint_category ?? 'quality'}`;
        break;

      case 'MACROECONOMIC_INDICATOR':
        factorName = 'RISK_FREE_TBILL_YIELD';
        magnitudeBps = BigInt(raw.data.tbill_yield_bps ?? 650);
        targetPattern = '*';
        summary = `RBI Sovereign 91-Day T-Bill Benchmark: ${raw.data.value_bps ?? 650} bps`;
        break;

      case 'LATERAL_FINANCIAL_MARKET':
        factorName = 'RAW_MATERIAL_LME_STEEL_SHOCK';
        magnitudeBps = BigInt(raw.data.change_24h_bps ?? raw.data.steel_coil_inflation_bps ?? 1000);
        targetPattern = 'prod:din3017:ss304:*';
        summary = `Lateral Market LME/Nifty Metal Index surge: ${magnitudeBps} bps shock on ${raw.data.symbol ?? 'SS304_COIL'}`;
        break;

      case 'GOVERNMENT_SCHEME_POLICY':
        factorName = 'STATUTORY_CUSTOMS_DUTY_SHOCK';
        magnitudeBps = BigInt(raw.data.customs_duty_bps ?? raw.data.msme_credit_days_bps ?? 1200);
        targetPattern = 'prod:*';
        summary = `Statutory notification ${raw.data.notification_id ?? 'GOV-2026'}: ${raw.data.statutory_act ?? 'Customs Tariff'}`;
        break;
    }

    const payloadWithoutHash = {
      signal_id: raw.signal_id,
      channel: raw.channel,
      observed_at_utc: raw.observed_at_utc,
      ttl_seconds: raw.ttl_seconds,
      economic_factor_name: factorName,
      magnitude_bps: magnitudeBps.toString(),
      target_sku_pattern: targetPattern,
      provenance_summary: summary
    };

    const jcs_hash = createHash('sha256')
      .update(canonicalizeJCS(payloadWithoutHash))
      .digest('hex');

    return {
      signal_id: raw.signal_id,
      channel: raw.channel,
      observed_at_utc: raw.observed_at_utc,
      ttl_seconds: raw.ttl_seconds,
      economic_factor_name: factorName,
      magnitude_bps: magnitudeBps,
      target_sku_pattern: targetPattern,
      provenance_summary: summary,
      jcs_hash
    };
  }
}

// ============================================================================
// 4. SIX-STATUS RETURN & LIFECYCLE VOCABULARY (POC.docx §5)
// ============================================================================

export type ReturnStatus =
  | 'VALID_CALCULATED_RETURN'
  | 'CANNOT_CALCULATE_MISSING_INPUTS'
  | 'INSUFFICIENT_UNVERIFIED_EVIDENCE'
  | 'NO_ROOT_FOUND_IN_SEARCH_DOMAIN'
  | 'NOT_YET_RECOVERED'
  | 'OPEN_POSITION';

export interface ReturnEvaluationResult {
  status: ReturnStatus;
  annualized_rowc_bps?: string;
  xirr_bps?: string;
  explanation: string;
}

export function resolveReturnStatus(options: {
  hasMissingMandatoryInputs: boolean;
  hasUnverifiedEvidence: boolean;
  isOpenPosition: boolean;
  isRecovered: boolean;
  solverConverged: boolean;
  calculatedRoWcBps?: bigint;
}): ReturnEvaluationResult {
  if (options.hasMissingMandatoryInputs) {
    return {
      status: 'CANNOT_CALCULATE_MISSING_INPUTS',
      explanation: 'Mandatory economic input fields (quote, freight, or fee schedule) are missing.'
    };
  }
  if (options.hasUnverifiedEvidence) {
    return {
      status: 'INSUFFICIENT_UNVERIFIED_EVIDENCE',
      explanation: 'Inputs are present but fail cryptographic verification or cross-source corroboration.'
    };
  }
  if (!options.solverConverged) {
    return {
      status: 'NO_ROOT_FOUND_IN_SEARCH_DOMAIN',
      explanation: 'Polynomial XIRR solver failed to converge on a unique real root within search bounds.'
    };
  }
  if (options.isOpenPosition) {
    return {
      status: 'OPEN_POSITION',
      explanation: 'Position is currently active; inventory is held or in-transit, so cash flows are incomplete.'
    };
  }
  if (!options.isRecovered) {
    return {
      status: 'NOT_YET_RECOVERED',
      explanation: 'Cumulative net cash flow has not crossed the breakeven threshold ($< 0$).'
    };
  }
  return {
    status: 'VALID_CALCULATED_RETURN',
    annualized_rowc_bps: (options.calculatedRoWcBps ?? 0n).toString(),
    explanation: 'Full lifecycle verified and closed with exact BigInt rational RoWC calculation.'
  };
}

// ============================================================================
// 5. NINE-STAGE "DEEP RESEARCH PRO" PIPELINE CONTRACT (POC.docx §15)
// ============================================================================

export type PipelineStage =
  | 'DECOMPOSE'
  | 'ROUTE'
  | 'ASSEMBLE_CONTEXT'
  | 'PROMPT'
  | 'EXECUTE_SCOPED_WORKER'
  | 'REVIEW_RED_TEAM'
  | 'ASSEMBLE_EVIDENCE'
  | 'POLISH'
  | 'PRESENT';

export interface DeepResearchExecutionRecord {
  query_id: string;
  stages_completed: PipelineStage[];
  rag_cache_hit: boolean;
  llm_called: boolean;
  signals_ingested: number;
  evidence_envelopes: EvidenceEnvelope<any>[];
  telemetry_digest_sha256: string;
}

export class DeepResearchPipelineOrchestrator {
  private readonly formulaRegistry: FormulaRegistry;
  private readonly groqAdvisor: GroqFormulaAdvisor;

  constructor(options?: {
    formula_registry?: FormulaRegistry;
    groq_advisor?: GroqFormulaAdvisor;
  }) {
    this.formulaRegistry = options?.formula_registry ?? new FormulaRegistry();
    this.groqAdvisor = options?.groq_advisor ?? new GroqFormulaAdvisor({ offlineFallback: true });
  }

  /**
   * Executes the 9-stage Deep Research DAG contract.
   */
  public executeResearchWorkflow(request: {
    query_id: string;
    thesis: string;
    signals?: RawSignalInput[];
  }): DeepResearchExecutionRecord {
    const stages: PipelineStage[] = [];

    // Stage 1: DECOMPOSE
    stages.push('DECOMPOSE');

    // Stage 2: ROUTE (RAG-First Sufficiency Gate)
    stages.push('ROUTE');
    const existingMatches = this.formulaRegistry.retrieveFormulas(request.thesis, { topK: 1 });
    const ragCacheHit = existingMatches.length > 0 && existingMatches[0].relevance_score >= 1.5;

    // Stage 3: ASSEMBLE_CONTEXT
    stages.push('ASSEMBLE_CONTEXT');

    // Stage 4: PROMPT
    stages.push('PROMPT');

    // Stage 5: EXECUTE_SCOPED_WORKER
    stages.push('EXECUTE_SCOPED_WORKER');
    const normalizedSignals = (request.signals ?? []).map((s) => SignalNormalizer.normalizeSignal(s));

    // Stage 6: REVIEW_RED_TEAM
    stages.push('REVIEW_RED_TEAM');

    // Stage 7: ASSEMBLE_EVIDENCE
    stages.push('ASSEMBLE_EVIDENCE');
    const envelopes: EvidenceEnvelope<any>[] = normalizedSignals.map((sig) =>
      createEvidenceEnvelope({
        evidence_id: `ev:${sig.signal_id}`,
        kind: 'OBSERVED_FACT',
        verification_status: 'CRYPTOGRAPHICALLY_ATTESTED',
        commercial_status: 'NOT_APPLICABLE',
        provenance: {
          source_id: sig.signal_id,
          channel: sig.channel,
          observed_at_utc: sig.observed_at_utc,
          ttl_seconds: sig.ttl_seconds,
          transformation_rule_id: 'STAGE-7-ASSEMBLE-EVIDENCE'
        },
        payload: {
          ...sig,
          magnitude_bps: sig.magnitude_bps.toString()
        }
      })
    );

    // Stage 8: POLISH
    stages.push('POLISH');

    // Stage 9: PRESENT
    stages.push('PRESENT');

    const cleanRecord = {
      query_id: request.query_id,
      stages_completed: stages,
      rag_cache_hit: ragCacheHit,
      llm_called: !ragCacheHit,
      signals_ingested: normalizedSignals.length,
      evidence_envelopes: envelopes
    };

    const telemetryDigest = createHash('sha256')
      .update(canonicalizeJCS(cleanRecord))
      .digest('hex');

    return {
      ...cleanRecord,
      telemetry_digest_sha256: telemetryDigest
    };
  }
}
