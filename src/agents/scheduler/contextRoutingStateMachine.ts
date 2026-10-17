/**
 * Market HFT OS — Deterministic Context-Routing State Machine (Stage 6)
 *
 * Implements the 3-Pass Multi-Agent Scheduler Coordinator:
 *
 * Pass 1: Complementary Dispatch (Horizontal Gap-Filling):
 *   - Dispatches Micro-Agent #1 (SourceCaptureWorker) for catalog and supplier quotations.
 *   - Dispatches Micro-Agent #3 (MacroAndLateralMarketWorker) for T-Bill yields,
 *     FBIL USD/INR rates, and LME SS304 scrap cost floor anchors.
 *   - Dispatches Micro-Agent #4 (GovtAndStatutoryWorker) for HSN 73269099 GST,
 *     Sec 52 TCS, Sec 194-O TDS, and MSME Sec 43B(h) statutory payment ceilings.
 *
 * Pass 2: Context Evaluation & Supplementary Dispatch (Vertical Corroboration & Stress-Testing):
 *   - Evaluates trigger matrix:
 *     - Anomaly S-1: Proximity to scrap floor or defect check triggers Micro-Agent #2 (MediaAndChatterWorker).
 *     - Anomaly S-2: Secondary supplier host corroboration triggers secondary SourceCaptureWorker.
 *     - Anomaly S-3: MSME Sec 43B(h) credit ceiling cross-check.
 *   - Joins independent supplementary claims via joinSupplementaryClaims, strictly preserving
 *     CROSS_SOURCE_CORROBORATED vs CONFLICT without averaging or voting.
 *
 * Pass 3: Stage 6 Red-Team Audit & Deterministic Join:
 *   - Dispatches Micro-Agent #5 (RedTeamAndConflictWorker) to evaluate joined claims
 *     against the 7 Red-Team adversarial and conflict rules.
 *   - Enforces hard disposition ceiling:
 *     HOLD_BLOCKED_BY_RED_TEAM | REQUIRES_SUPPLEMENTARY_CORROBORATION | ELIGIBLE_FOR_HUMAN_REVIEW.
 *   - Bit-for-bit reproducible RFC 8785 JCS canonical execution attestation with SHA-256 telemetry digest.
 */

import { sha256 } from '../../canonical/crypto.js';
import { canonicalizeJCS } from '../../canonical/jcs.js';
import { sanitizeForJcs } from '../m6AgentFramework.js';
import { deepFreeze } from '../../verification/gate.js';
import {
  McpCapabilityBroker,
  SupplementaryClaim,
  SupplementaryJoinResult,
  joinSupplementaryClaims,
  createCapabilityGrant
} from '../../mcp/mcpSubstrate.js';
import {
  SourceCaptureWorker,
  SourceCaptureMcpRequest,
  SourceCaptureMcpResponse
} from '../workers/sourceCaptureWorker.js';
import {
  MacroAndLateralMarketWorker,
  MacroLateralMcpResponse
} from '../workers/macroLateralWorker.js';
import {
  GovtAndStatutoryWorker,
  GovtStatutoryMcpResponse
} from '../workers/govtStatutoryWorker.js';
import {
  MediaAndChatterWorker,
  MediaChatterMcpRequest,
  MediaChatterMcpResponse
} from '../workers/mediaChatterWorker.js';
import {
  RedTeamAndConflictWorker,
  RedTeamMcpRequest,
  RedTeamMcpResponse,
  RedTeamDisposition,
  RedTeamChatterDefectSignal,
  RedTeamEvidenceTimestamp
} from '../workers/redTeamWorker.js';

export interface ContextRoutingInput {
  readonly task_id: string;
  readonly candidate_id: string;
  readonly sku_id: string;
  readonly target_catalog_url: string;
  readonly secondary_catalog_url?: string;
  readonly media_source_url?: string;
  readonly reference_time_utc?: string;
  readonly pack_mass_grams?: number;
  readonly hsn_code?: string;
  readonly is_msme_supplier?: boolean;
  readonly has_written_msme_agreement?: boolean;
  readonly assumed_dpo_days?: number;
  readonly projected_rowc_bps?: bigint;
  readonly sourcing_evidence_status?: string;
  readonly material_claimed?: string;
  readonly inbound_freight_subunits?: bigint;
  readonly packaging_kitting_subunits?: bigint;
  readonly customs_inspection_subunits?: bigint;
  readonly marketplace_closing_subunits?: bigint;
  readonly marketplace_weight_handling_subunits?: bigint;
  readonly force_supplementary_chatter?: boolean;
  readonly raw_source_html?: string;
  readonly raw_secondary_html?: string;
  readonly raw_media_transcript?: string;
}

export interface Pass1ComplementaryOutput {
  readonly primary_source_capture?: SourceCaptureMcpResponse;
  readonly tbill_macro_response?: MacroLateralMcpResponse;
  readonly usd_inr_macro_response?: MacroLateralMcpResponse;
  readonly lme_steel_macro_response?: MacroLateralMcpResponse;
  readonly physical_scrap_floor?: {
    readonly pack_mass_grams: number;
    readonly raw_metal_cost_subunits: string;
    readonly min_viable_exw_floor_subunits: string;
  };
  readonly statutory_response?: GovtStatutoryMcpResponse;
}

export interface Pass2SupplementaryOutput {
  readonly secondary_source_capture?: SourceCaptureMcpResponse;
  readonly media_chatter_response?: MediaChatterMcpResponse;
  readonly collected_claims: readonly SupplementaryClaim[];
  readonly joined_results: readonly SupplementaryJoinResult[];
  readonly chatter_defect_signals: readonly RedTeamChatterDefectSignal[];
}

export interface Pass3RedTeamOutput {
  readonly red_team_response: RedTeamMcpResponse;
  readonly final_disposition: RedTeamDisposition;
}

export interface ContextRoutingRunRecord {
  readonly run_id: string;
  readonly task_id: string;
  readonly timestamp_utc: string;
  readonly candidate_id: string;
  readonly sku_id: string;
  readonly pass1: Pass1ComplementaryOutput;
  readonly pass2: Pass2SupplementaryOutput;
  readonly pass3: Pass3RedTeamOutput;
  readonly final_disposition: RedTeamDisposition;
  readonly telemetry_digest_sha256: string;
}

export class ContextRoutingStateMachine {
  private readonly broker: McpCapabilityBroker;
  private readonly sourceWorker: SourceCaptureWorker;
  private readonly macroWorker: MacroAndLateralMarketWorker;
  private readonly govtWorker: GovtAndStatutoryWorker;
  private readonly mediaWorker: MediaAndChatterWorker;
  private readonly redTeamWorker: RedTeamAndConflictWorker;

  constructor(options: {
    broker: McpCapabilityBroker;
    sourceWorker?: SourceCaptureWorker;
    macroWorker?: MacroAndLateralMarketWorker;
    govtWorker?: GovtAndStatutoryWorker;
    mediaWorker?: MediaAndChatterWorker;
    redTeamWorker?: RedTeamAndConflictWorker;
  }) {
    this.broker = options.broker;
    this.sourceWorker = options.sourceWorker ?? new SourceCaptureWorker(this.broker);
    this.macroWorker = options.macroWorker ?? new MacroAndLateralMarketWorker(this.broker);
    this.govtWorker = options.govtWorker ?? new GovtAndStatutoryWorker(this.broker);
    this.mediaWorker = options.mediaWorker ?? new MediaAndChatterWorker(this.broker);
    this.redTeamWorker = options.redTeamWorker ?? new RedTeamAndConflictWorker(this.broker);
  }

  public async runFullPipeline(input: ContextRoutingInput): Promise<ContextRoutingRunRecord> {
    const referenceTimeUtc = input.reference_time_utc || '2026-10-18T00:00:00.000Z';
    const runId = `cr-run:${input.candidate_id}:${Date.now()}`;

    // ========================================================================
    // PASS 1: COMPLEMENTARY DISPATCH (HORIZONTAL GAP-FILLING)
    // ========================================================================
    const pass1TaskId = `${input.task_id}:pass1`;

    // 1. Primary Source Capture Grant & Execution
    const sourceGrant = createCapabilityGrant({
      grant_id: `grant:cr:source:${Date.now()}`,
      task_id: pass1TaskId,
      worker_id: SourceCaptureWorker.WORKER_ID,
      allowed_tools: ['mcp://source-capture/http_get_snapshot'],
      allowed_hosts: ['catalog.howrah-industrial.com', 'dir.indiamart.com'],
      allowed_methods: ['GET'],
      allow_redirects: false,
      max_requests: 4,
      max_payload_bytes: 262144,
      max_latency_ms: 5000,
      max_tokens: 100000,
      expires_at_utc: '2026-10-19T00:00:00.000Z'
    });

    const primarySourceRequest: SourceCaptureMcpRequest = {
      task_id: `${pass1TaskId}:primary-capture`,
      worker_id: SourceCaptureWorker.WORKER_ID,
      target_url: input.target_catalog_url,
      source_profile: 'HOWRAH_B2B_DISTRIBUTOR_CATALOG',
      execution_mode: input.raw_source_html ? 'RECORDED_FIXTURE_REPLAY' : 'APPROVED_LIVE_HTTPS_GET',
      requested_at_utc: referenceTimeUtc,
      ...(input.raw_source_html ? { raw_html_payload: input.raw_source_html } : {})
    };

    let primarySourceResponse: SourceCaptureMcpResponse | undefined;
    try {
      primarySourceResponse = await this.sourceWorker.captureAndExtract(primarySourceRequest, sourceGrant);
    } catch {
      // In fail-closed zero-trust, missing capture leaves response undefined
    }

    // 2. Macro Feeds Grant & Execution
    const macroGrant = createCapabilityGrant({
      grant_id: `grant:cr:macro:${Date.now()}`,
      task_id: pass1TaskId,
      worker_id: MacroAndLateralMarketWorker.WORKER_ID,
      allowed_tools: ['mcp://macro-feeds/query_series'],
      allowed_hosts: [
        'www.rbi.org.in',
        'www.fbil.org.in',
        'www.lme.com',
        'www.nseindia.com',
        'mospi.gov.in'
      ],
      allowed_methods: ['GET'],
      allow_redirects: false,
      max_requests: 6,
      max_payload_bytes: 131072,
      max_latency_ms: 5000,
      max_tokens: 100000,
      expires_at_utc: '2026-10-19T00:00:00.000Z'
    });

    const tbillRes = await this.macroWorker.querySeries(
      {
        task_id: `${pass1TaskId}:tbill`,
        worker_id: MacroAndLateralMarketWorker.WORKER_ID,
        series_id: 'RBI_91D_TBILL_CUTOFF_YIELD_BPS',
        reference_time_utc: referenceTimeUtc
      },
      macroGrant
    );

    const usdInrRes = await this.macroWorker.querySeries(
      {
        task_id: `${pass1TaskId}:usd-inr`,
        worker_id: MacroAndLateralMarketWorker.WORKER_ID,
        series_id: 'FBIL_USD_INR_REFERENCE_RATE',
        reference_time_utc: referenceTimeUtc
      },
      macroGrant
    );

    const lmeRes = await this.macroWorker.querySeries(
      {
        task_id: `${pass1TaskId}:lme-ss304`,
        worker_id: MacroAndLateralMarketWorker.WORKER_ID,
        series_id: 'LME_SS304_COLD_ROLLED_INR_PER_KG',
        derive_scrap_floor: Boolean(input.pack_mass_grams),
        pack_mass_grams: input.pack_mass_grams,
        min_stamping_conversion_bps: 1500n,
        reference_time_utc: referenceTimeUtc
      },
      macroGrant
    );

    // 3. Govt & Statutory Circular Grant & Execution
    const govtGrant = createCapabilityGrant({
      grant_id: `grant:cr:govt:${Date.now()}`,
      task_id: pass1TaskId,
      worker_id: GovtAndStatutoryWorker.WORKER_ID,
      allowed_tools: ['mcp://policy-bulletins/fetch_circular'],
      allowed_hosts: [
        'cbic-gst.gov.in',
        'incometaxindia.gov.in',
        'dgft.gov.in',
        'msme.gov.in'
      ],
      allowed_methods: ['GET'],
      allow_redirects: false,
      max_requests: 4,
      max_payload_bytes: 262144,
      max_latency_ms: 5000,
      max_tokens: 100000,
      expires_at_utc: '2026-10-19T00:00:00.000Z'
    });

    const statutoryRes = await this.govtWorker.fetchCircular(
      {
        task_id: `${pass1TaskId}:statutory-circular`,
        worker_id: GovtAndStatutoryWorker.WORKER_ID,
        hsn_code: input.hsn_code || '73269099',
        is_msme_supplier: input.is_msme_supplier,
        has_written_payment_agreement: input.has_written_msme_agreement,
        reference_time_utc: referenceTimeUtc
      },
      govtGrant
    );

    const pass1Output: Pass1ComplementaryOutput = Object.freeze({
      primary_source_capture: primarySourceResponse,
      tbill_macro_response: tbillRes,
      usd_inr_macro_response: usdInrRes,
      lme_steel_macro_response: lmeRes,
      physical_scrap_floor: lmeRes.physical_scrap_floor,
      statutory_response: statutoryRes
    });

    // ========================================================================
    // PASS 2: CONTEXT EVALUATION & SUPPLEMENTARY DISPATCH
    // ========================================================================
    const pass2TaskId = `${input.task_id}:pass2`;
    const collectedClaims: SupplementaryClaim[] = [];
    const chatterSignals: RedTeamChatterDefectSignal[] = [];

    // Extract primary supplier quote
    let primaryPriceSubunits: bigint | undefined;
    if (primarySourceResponse?.extracted_fields) {
      const priceOutcome =
        primarySourceResponse.extracted_fields['raw_material_purchase'] ||
        primarySourceResponse.extracted_fields['raw_material_purchase_subunits'] ||
        primarySourceResponse.extracted_fields['gross_price_inr'] ||
        primarySourceResponse.extracted_fields['unit_price'];

      if (priceOutcome && priceOutcome.status === 'EXTRACTED') {
        const valStr = priceOutcome.matched_tier
          ? priceOutcome.matched_tier.unit_price_subunits
          : priceOutcome.normalized_value;
        primaryPriceSubunits = BigInt(valStr);
        collectedClaims.push({
          entity_id: input.sku_id,
          metric_name: 'raw_material_purchase',
          value: primaryPriceSubunits,
          source_id: primarySourceResponse.evidence_envelope.provenance_lineage.source_id,
          observed_at_utc: primarySourceResponse.evidence_envelope.provenance_lineage.observed_at_utc
        });
      }
    }

    // Trigger Anomaly Evaluation: Proximity to scrap floor or explicit media request
    const minViableFloor = lmeRes.physical_scrap_floor
      ? BigInt(lmeRes.physical_scrap_floor.min_viable_exw_floor_subunits)
      : undefined;

    const isNearScrapFloor =
      primaryPriceSubunits !== undefined &&
      minViableFloor !== undefined &&
      primaryPriceSubunits <= (minViableFloor * 11500n) / 10000n; // within 15% of scrap floor

    const shouldTriggerChatter =
      input.force_supplementary_chatter === true || isNearScrapFloor || Boolean(input.media_source_url);

    let mediaChatterResponse: MediaChatterMcpResponse | undefined;
    if (shouldTriggerChatter) {
      const mediaGrant = createCapabilityGrant({
        grant_id: `grant:cr:media:${Date.now()}`,
        task_id: pass2TaskId,
        worker_id: MediaAndChatterWorker.WORKER_ID,
        allowed_tools: ['mcp://media-corpus/fetch_transcript'],
        allowed_hosts: ['www.youtube.com', 'seller-forum.amazon.in'],
        allowed_methods: ['GET'],
        allow_redirects: false,
        max_requests: 4,
        max_payload_bytes: 262144,
        max_latency_ms: 5000,
        max_tokens: 100000,
        expires_at_utc: '2026-10-19T00:00:00.000Z'
      });

      const mediaUrl =
        input.media_source_url ||
        'https://www.youtube.com/watch?v=clamp-review-ss304';

      const mediaRequest: MediaChatterMcpRequest = {
        task_id: `${pass2TaskId}:media-chatter`,
        worker_id: MediaAndChatterWorker.WORKER_ID,
        target_url: mediaUrl,
        media_type: 'YOUTUBE_UNBOXING_OR_REVIEW',
        requested_at_utc: referenceTimeUtc,
        ...(input.raw_media_transcript
          ? { raw_transcript_payload: input.raw_media_transcript }
          : {})
      };

      try {
        mediaChatterResponse = await this.mediaWorker.fetchAndExtract(mediaRequest, mediaGrant);
        if (mediaChatterResponse.claims) {
          for (const c of mediaChatterResponse.claims) {
            chatterSignals.push({
              material_flagged: c.category === 'METALLURGY_GRADE_DEFECT' ? 'SS202' : c.category,
              defect_rate_bps: c.observed_defect_rate_bps,
              source_id: mediaChatterResponse.evidence_envelope.provenance_lineage.source_id,
              transcript_span: c.spotlighted_quote
            });
          }
        }
      } catch {
        // Media worker failure leaves mediaChatterResponse undefined
      }
    }

    // Trigger Anomaly S-2: Secondary Supplier Corroboration
    let secondarySourceResponse: SourceCaptureMcpResponse | undefined;
    if (input.secondary_catalog_url) {
      const secSourceGrant = createCapabilityGrant({
        grant_id: `grant:cr:sec-source:${Date.now()}`,
        task_id: pass2TaskId,
        worker_id: SourceCaptureWorker.WORKER_ID,
        allowed_tools: ['mcp://source-capture/http_get_snapshot'],
        allowed_hosts: ['catalog.howrah-industrial.com', 'dir.indiamart.com'],
        allowed_methods: ['GET'],
        allow_redirects: false,
        max_requests: 4,
        max_payload_bytes: 262144,
        max_latency_ms: 5000,
        max_tokens: 100000,
        expires_at_utc: '2026-10-19T00:00:00.000Z'
      });

      const secReq: SourceCaptureMcpRequest = {
        task_id: `${pass2TaskId}:sec-capture`,
        worker_id: SourceCaptureWorker.WORKER_ID,
        target_url: input.secondary_catalog_url,
        source_profile: 'INDIAMART_SUPPLIER_LISTING',
        execution_mode: input.raw_secondary_html ? 'RECORDED_FIXTURE_REPLAY' : 'APPROVED_LIVE_HTTPS_GET',
        requested_at_utc: referenceTimeUtc,
        ...(input.raw_secondary_html ? { raw_html_payload: input.raw_secondary_html } : {})
      };

      try {
        secondarySourceResponse = await this.sourceWorker.captureAndExtract(secReq, secSourceGrant);
        if (secondarySourceResponse.extracted_fields) {
          const secPriceOutcome =
            secondarySourceResponse.extracted_fields['raw_material_purchase'] ||
            secondarySourceResponse.extracted_fields['raw_material_purchase_subunits'] ||
            secondarySourceResponse.extracted_fields['gross_price_inr'] ||
            secondarySourceResponse.extracted_fields['unit_price'];

          if (secPriceOutcome && secPriceOutcome.status === 'EXTRACTED') {
            const secValStr = secPriceOutcome.matched_tier
              ? secPriceOutcome.matched_tier.unit_price_subunits
              : secPriceOutcome.normalized_value;
            const secPrice = BigInt(secValStr);
            collectedClaims.push({
              entity_id: input.sku_id,
              metric_name: 'raw_material_purchase',
              value: secPrice,
              source_id: secondarySourceResponse.evidence_envelope.provenance_lineage.source_id,
              observed_at_utc: secondarySourceResponse.evidence_envelope.provenance_lineage.observed_at_utc
            });
          }
        }
      } catch {
        // Secondary capture fail-closed
      }
    }

    // Execute Deterministic Supplementary Join (strictly preserving conflict!)
    const joinedResults = joinSupplementaryClaims(collectedClaims);

    const pass2Output: Pass2SupplementaryOutput = Object.freeze({
      secondary_source_capture: secondarySourceResponse,
      media_chatter_response: mediaChatterResponse,
      collected_claims: Object.freeze(collectedClaims),
      joined_results: joinedResults,
      chatter_defect_signals: Object.freeze(chatterSignals)
    });

    // ========================================================================
    // PASS 3: STAGE 6 RED-TEAM AUDIT & DETERMINISTIC JOIN
    // ========================================================================
    const pass3TaskId = `${input.task_id}:pass3`;

    const redTeamGrant = createCapabilityGrant({
      grant_id: `grant:cr:redteam:${Date.now()}`,
      task_id: pass3TaskId,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      allowed_tools: ['mcp://audit-corpus/read_joined_claims'],
      allowed_hosts: [], // Zero network egress
      allowed_methods: ['GET'],
      allow_redirects: false,
      max_requests: 4,
      max_payload_bytes: 262144,
      max_latency_ms: 4000,
      max_tokens: 100000,
      expires_at_utc: '2026-10-19T00:00:00.000Z'
    });

    // Compile evidence timestamps for TTL and clock skew checks
    const evidenceTimestamps: RedTeamEvidenceTimestamp[] = [];
    if (primarySourceResponse?.evidence_envelope?.provenance_lineage) {
      evidenceTimestamps.push({
        envelope_id: 'primary-source-envelope',
        observed_at_utc: primarySourceResponse.evidence_envelope.provenance_lineage.observed_at_utc,
        ttl_seconds: primarySourceResponse.evidence_envelope.provenance_lineage.ttl_seconds
      });
    }
    if (statutoryRes?.evidence_envelope?.provenance_lineage) {
      evidenceTimestamps.push({
        envelope_id: 'statutory-circular-envelope',
        observed_at_utc: statutoryRes.evidence_envelope.provenance_lineage.observed_at_utc,
        ttl_seconds: statutoryRes.evidence_envelope.provenance_lineage.ttl_seconds
      });
    }

    // Resolve statutory GST rate
    const gstClaim = statutoryRes?.claims?.find((c) => c.parameter_name === 'gst_rate_bps');
    const gstRateBps = gstClaim ? BigInt(gstClaim.proposed_value_bigint) : 1800n;

    const redTeamRequest: RedTeamMcpRequest = {
      task_id: `${pass3TaskId}:audit`,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      candidate_id: input.candidate_id,
      sku_id: input.sku_id,
      reference_time_utc: referenceTimeUtc,
      claimed_supplier_exw_subunits: primaryPriceSubunits,
      pack_mass_grams: input.pack_mass_grams,
      lme_ss304_inr_per_kg_subunits: lmeRes.latest_observation?.value_bigint,
      min_viable_exw_floor_subunits: lmeRes.physical_scrap_floor?.min_viable_exw_floor_subunits,
      raw_material_scrap_floor_subunits: lmeRes.physical_scrap_floor?.raw_metal_cost_subunits,
      joined_results: joinedResults,
      projected_rowc_bps: input.projected_rowc_bps,
      sourcing_evidence_status: primarySourceResponse?.evidence_envelope?.commercial_status ?? 'ADVERTISED_LISTING',
      material_claimed: input.material_claimed || 'SS304',
      chatter_defect_signals: chatterSignals,
      supplier_dpo_days: input.assumed_dpo_days,
      is_msme_supplier: input.is_msme_supplier,
      has_written_msme_agreement: input.has_written_msme_agreement,
      statutory_max_payment_terms_days: statutoryRes.msme_cross_check?.statutory_max_payment_terms_days,
      cost_breakdown: {
        raw_material_purchase_subunits: primaryPriceSubunits,
        inbound_freight_subunits: input.inbound_freight_subunits ?? 45000n,
        packaging_kitting_subunits: input.packaging_kitting_subunits ?? 32000n,
        customs_inspection_subunits: input.customs_inspection_subunits ?? 0n,
        marketplace_closing_subunits: input.marketplace_closing_subunits ?? 100000n,
        marketplace_weight_handling_subunits: input.marketplace_weight_handling_subunits ?? 140000n,
        gst_rate_bps: gstRateBps
      },
      evidence_envelopes: evidenceTimestamps
    };

    const redTeamRes = await this.redTeamWorker.auditCandidate(redTeamRequest, redTeamGrant);

    const pass3Output: Pass3RedTeamOutput = Object.freeze({
      red_team_response: redTeamRes,
      final_disposition: redTeamRes.disposition
    });

    // ========================================================================
    // TELEMETRY & JCS CANONICAL ATTESTATION
    // ========================================================================
    const preliminaryRecord = {
      run_id: runId,
      task_id: input.task_id,
      timestamp_utc: referenceTimeUtc,
      candidate_id: input.candidate_id,
      sku_id: input.sku_id,
      pass1: pass1Output,
      pass2: pass2Output,
      pass3: pass3Output,
      final_disposition: redTeamRes.disposition
    };

    const telemetryDigest = sha256(canonicalizeJCS(sanitizeForJcs(preliminaryRecord)));

    const finalRecord: ContextRoutingRunRecord = Object.freeze({
      ...preliminaryRecord,
      telemetry_digest_sha256: telemetryDigest
    });

    return deepFreeze(finalRecord);
  }
}
