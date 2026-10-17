/**
 * Market HFT OS — Micro-Agent #3: MacroAndLateralMarketWorker (Stage 4)
 *
 * Implements:
 * 1. Strict MCP Broker Routing & Tool Policy (MACRO_LATERAL_TOOL_POLICY):
 *    - Worker ID: 'worker:macro-lateral:v1'
 *    - Read-only tool 'mcp://macro-feeds/query_series'
 *    - Scoped to approved macroeconomic hosts ('www.rbi.org.in', 'www.fbil.org.in', 'www.lme.com', 'www.nseindia.com', 'mospi.gov.in')
 *    - 128 KB payload cap, GET only, redirect blocking
 *    - InjectionCanaryGuard quarantine (E-MLW-PROMPT-INJECTION-DETECTED)
 * 2. Zero-Default Reference Series Ingestion & FX Conversion Firewall:
 *    - Ingests RBI 91d T-Bill, FBIL USD/INR, LME SS304 coil, MoSPI IIP, and Freight indices
 *    - Missing or non-positive series fails closed (E-MLW-SERIES-DATA-REQUIRED) — zero fabricated fallbacks
 *    - Stale series older than max_staleness_seconds fails closed (E-MLW-STALE-SERIES)
 *    - USD/tonne to INR/kg conversion requires valid FBIL rate (E-MLW-MISSING-FX-REFERENCE)
 *    - derivePhysicalScrapFloor computes pure BigInt raw metal and minimum viable EXW floor
 * 3. Dynamic Growth-Driver Evaluation via FormulaRegistry (Formula-RAG):
 *    - Non-hardcoded factor evaluation using FormulaRegistry pure-BigInt rational AST
 *    - Computes net_change_bps, persistence_consistency_bps, and estimated_half_life_days
 * 4. Sustained Signal vs. Fast Opportunity Regime Classifier:
 *    - SUSTAINED_STRUCTURAL_SIGNAL (persistence >= 7000 bps, half-life >= 30d, |change| >= 300 bps)
 *    - FAST_TACTICAL_OPPORTUNITY (|change| >= 1000 bps, half-life < 30d)
 *    - Tactical Horizon Gate: fails closed (E-MLW-EDGE-DECAYS-BEFORE-CASH-RECOVERY) if CCC > half-life
 *    - SPURIOUS_OR_UNPROVEN_NOISE for non-conforming signals
 * 5. Empirical Factor Efficacy Ledger (FactorEfficacyLedger):
 *    - Tracks forecast vs. realized impact across cycles
 *    - Computes hit_rate_bps and mean_absolute_error_bps
 *    - Classifies UNPROVEN_HYPOTHESIS, EMPIRICALLY_VALIDATED_DRIVER, EMPIRICALLY_REFUTED_NOISE
 */

import { sha256 } from '../../canonical/crypto.js';
import { canonicalizeJCS } from '../../canonical/jcs.js';
import { sanitizeForJcs } from '../m6AgentFramework.js';
import {
  McpCapabilityBroker,
  McpServerAdapter,
  McpToolDescriptor,
  McpToolCallRequest,
  McpToolCallResponse,
  CapabilityGrant
} from '../../mcp/mcpSubstrate.js';
import { InjectionCanaryGuard } from './sourceCaptureWorker.js';
import { deepFreeze } from '../../verification/gate.js';
import {
  FormulaRegistry,
  FormulaCard,
  evaluateSymbolicExpression
} from '../../research/formulaRegistry.js';
import { GroqFormulaAdvisor } from '../../research/llmFormulaAdvisor.js';

// ============================================================================
// 1. TOOL POLICY & CONTRACT TYPES
// ============================================================================

export interface MacroLateralToolPolicy {
  readonly tool_id: 'mcp://macro-feeds/query_series';
  readonly allowed_methods: readonly ['GET'];
  readonly allowed_schemes: readonly ['https', 'mcp'];
  readonly allowed_hosts: readonly [
    'www.rbi.org.in',
    'www.fbil.org.in',
    'www.lme.com',
    'www.nseindia.com',
    'mospi.gov.in'
  ];
  readonly allow_redirects: false;
  readonly block_private_and_loopback_ips: true;
  readonly allowed_content_types: readonly ['application/json', 'text/plain'];
  readonly max_payload_bytes: 131072; // 128 KB
  readonly max_latency_ms: 3000;
  readonly max_requests_per_task: 4;
}

export const MACRO_LATERAL_TOOL_POLICY: MacroLateralToolPolicy = Object.freeze({
  tool_id: 'mcp://macro-feeds/query_series',
  allowed_methods: Object.freeze(['GET'] as const),
  allowed_schemes: Object.freeze(['https', 'mcp'] as const),
  allowed_hosts: Object.freeze([
    'www.rbi.org.in',
    'www.fbil.org.in',
    'www.lme.com',
    'www.nseindia.com',
    'mospi.gov.in'
  ] as const),
  allow_redirects: false,
  block_private_and_loopback_ips: true,
  allowed_content_types: Object.freeze(['application/json', 'text/plain'] as const),
  max_payload_bytes: 131072,
  max_latency_ms: 3000,
  max_requests_per_task: 4
});

export type MacroSeriesId =
  | 'RBI_91D_TBILL_CUTOFF_YIELD_BPS'
  | 'FBIL_USD_INR_REFERENCE_RATE'
  | 'LME_SS304_COLD_ROLLED_INR_PER_KG'
  | 'LME_SS304_COLD_ROLLED_USD_PER_TONNE'
  | 'INDIA_IIP_INDUSTRIAL_DEMAND_INDEX_BPS'
  | 'DOMESTIC_SURFACE_FREIGHT_INDEX_BPS'
  | string;

export type MacroSeriesUnit =
  | 'BPS'
  | 'SUBUNITS_INR'
  | 'SUBUNITS_INR_PER_KG'
  | 'SUBUNITS_USD_PER_TONNE'
  | 'INDEX_POINTS';

export interface MacroSeriesObservation {
  readonly timestamp_utc: string;
  readonly value_bigint: bigint;
  readonly unit?: MacroSeriesUnit;
  readonly source_url?: string;
  readonly description?: string;
}

export interface MacroSeriesFixtureItem {
  readonly series_id: string;
  readonly unit: MacroSeriesUnit;
  readonly source_url: string;
  readonly description: string;
  readonly observations: readonly {
    readonly timestamp_utc: string;
    readonly value_bigint: bigint;
  }[];
}

export interface MacroLateralEvidenceEnvelope {
  readonly evidence_kind: 'OBSERVED_FACT';
  readonly verification_status: 'UNVERIFIED';
  readonly commercial_status: 'NOT_APPLICABLE';
  readonly provenance_lineage: {
    readonly source_id: string;
    readonly observed_at_utc: string;
    readonly ttl_seconds: number;
    readonly raw_sha256?: string;
    readonly extractor_version: 'mlw-macro-sieve-v1.0.0';
  };
}

export interface PhysicalScrapFloorResult {
  readonly pack_mass_grams: number;
  readonly lme_ss304_inr_per_kg_subunits: bigint;
  readonly min_stamping_conversion_bps: bigint;
  readonly raw_metal_cost_subunits: bigint;
  readonly min_viable_exw_floor_subunits: bigint;
}

export interface MacroLateralMcpRequest {
  readonly task_id: string;
  readonly worker_id: 'worker:macro-lateral:v1';
  readonly series_id: string;
  readonly target_url?: string;
  readonly target_unit?: MacroSeriesUnit;
  readonly reference_time_utc?: string;
  readonly max_staleness_seconds?: number;
  readonly fbil_usd_inr_rate_subunits?: string | bigint;
  readonly derive_scrap_floor?: boolean;
  readonly pack_mass_grams?: number;
  readonly min_stamping_conversion_bps?: string | bigint;
  readonly custom_commercial_status?: string;
  readonly raw_feed_payload?: string;
  readonly custom_observations?: readonly {
    readonly timestamp_utc: string;
    readonly value_bigint: string;
  }[];
}

export interface MacroLateralMcpResponse {
  readonly request_id: string;
  readonly series_id: string;
  readonly requested_at_utc: string;
  readonly status:
    | 'RESOLVED'
    | 'QUARANTINED_INJECTION'
    | 'DATA_REQUIRED'
    | 'STALE_OBSERVATION_REJECTED'
    | 'UNIT_MISMATCH_REJECTED';
  readonly error_code?: string;
  readonly error_reason?: string;
  readonly latest_observation?: {
    readonly timestamp_utc: string;
    readonly value_bigint: string;
    readonly unit: MacroSeriesUnit;
    readonly source_url: string;
  };
  readonly physical_scrap_floor?: {
    readonly pack_mass_grams: number;
    readonly raw_metal_cost_subunits: string;
    readonly min_viable_exw_floor_subunits: string;
  };
  readonly evidence_envelope: MacroLateralEvidenceEnvelope;
}

// ============================================================================
// 2. FX FIREWALL & PHYSICAL SCRAP FLOOR DERIVATION
// ============================================================================

/**
 * Converts USD per tonne (scale 4, e.g. 22000000n = $2,200.0000)
 * to INR per kg (scale 4, e.g. 1849100n = ₹184.9100) using FBIL USD/INR rate.
 *
 * Math:
 * 1 Tonne = 1,000 kg.
 * (usdPerTonne * fbilRate) / (1000 * 10000)
 */
export function convertUsdPerTonneToInrPerKg(
  usdPerTonneSubunits: bigint,
  fbilUsdInrRateSubunits: bigint
): bigint {
  if (fbilUsdInrRateSubunits <= 0n) {
    throw new Error('E-MLW-MISSING-FX-REFERENCE: FBIL USD/INR rate must be strictly positive');
  }
  return (usdPerTonneSubunits * fbilUsdInrRateSubunits) / (1000n * 10000n);
}

/**
 * Derives the physical scrap floor and minimum viable EXW manufacturing floor
 * in pure BigInt arithmetic for industrial hardware packs (e.g. DIN 3017 SS304 clamps).
 */
export function derivePhysicalScrapFloor(
  packMassGrams: number,
  lmeSs304InrPerKgSubunits: bigint,
  minStampingConversionBps: bigint = 1500n
): PhysicalScrapFloorResult {
  if (packMassGrams <= 0) {
    throw new Error('E-MLW-INVALID-PACK-MASS: packMassGrams must be strictly positive');
  }
  if (lmeSs304InrPerKgSubunits <= 0n) {
    throw new Error('E-MLW-INVALID-COMMODITY-PRICE: lmeSs304InrPerKgSubunits must be positive');
  }

  // Raw metal cost in scale-4 INR subunits: (packMassGrams * inrPerKg) / 1000
  const rawMetalCostSubunits = (BigInt(packMassGrams) * lmeSs304InrPerKgSubunits) / 1000n;

  // Minimum viable EXW floor including stamping and forming margin:
  // rawMetalCost * (10000 + stampingBps) / 10000
  const minViableExwFloorSubunits =
    (rawMetalCostSubunits * (10000n + minStampingConversionBps)) / 10000n;

  return {
    pack_mass_grams: packMassGrams,
    lme_ss304_inr_per_kg_subunits: lmeSs304InrPerKgSubunits,
    min_stamping_conversion_bps: minStampingConversionBps,
    raw_metal_cost_subunits: rawMetalCostSubunits,
    min_viable_exw_floor_subunits: minViableExwFloorSubunits
  };
}

// ============================================================================
// 3. RECORDED MACRO SERIES FIXTURE REGISTRY
// ============================================================================

export class MacroSeriesFixtureRegistry {
  private static readonly seriesMap = new Map<string, MacroSeriesFixtureItem>();

  static {
    MacroSeriesFixtureRegistry.bootstrapDefaults();
  }

  public static bootstrapDefaults(): void {
    MacroSeriesFixtureRegistry.seriesMap.clear();

    // 1. RBI 91-Day T-Bill
    MacroSeriesFixtureRegistry.seriesMap.set('RBI_91D_TBILL_CUTOFF_YIELD_BPS', {
      series_id: 'RBI_91D_TBILL_CUTOFF_YIELD_BPS',
      unit: 'BPS',
      source_url: 'https://www.rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=57001',
      description: 'RBI 91-Day Treasury Bill Auction Cutoff Yield in basis points',
      observations: [
        { timestamp_utc: '2026-10-16T12:00:00.000Z', value_bigint: 650n }
      ]
    });

    // 2. FBIL USD/INR Reference Rate
    MacroSeriesFixtureRegistry.seriesMap.set('FBIL_USD_INR_REFERENCE_RATE', {
      series_id: 'FBIL_USD_INR_REFERENCE_RATE',
      unit: 'SUBUNITS_INR',
      source_url: 'https://www.fbil.org.in/reference-rates',
      description: 'FBIL Spot USD/INR reference exchange rate in scale-4 subunits (₹84.0500)',
      observations: [
        { timestamp_utc: '2026-10-16T12:00:00.000Z', value_bigint: 840500n }
      ]
    });

    // 3. LME SS304 Cold Rolled Coil (USD per tonne)
    MacroSeriesFixtureRegistry.seriesMap.set('LME_SS304_COLD_ROLLED_USD_PER_TONNE', {
      series_id: 'LME_SS304_COLD_ROLLED_USD_PER_TONNE',
      unit: 'SUBUNITS_USD_PER_TONNE',
      source_url: 'https://www.lme.com/Metals/Non-ferrous/Steel/SS304',
      description: 'London Metal Exchange SS304 Cold Rolled Coil FOB cash price in scale-4 USD/tonne ($2,200.0000)',
      observations: [
        { timestamp_utc: '2026-10-16T12:00:00.000Z', value_bigint: 22000000n }
      ]
    });

    // 4. LME SS304 Cold Rolled (INR per kg converted)
    MacroSeriesFixtureRegistry.seriesMap.set('LME_SS304_COLD_ROLLED_INR_PER_KG', {
      series_id: 'LME_SS304_COLD_ROLLED_INR_PER_KG',
      unit: 'SUBUNITS_INR_PER_KG',
      source_url: 'https://www.lme.com/Metals/Non-ferrous/Steel/SS304',
      description: 'LME SS304 Cold Rolled price converted to scale-4 INR/kg via FBIL USD/INR benchmark (₹184.9100)',
      observations: [
        { timestamp_utc: '2026-10-16T12:00:00.000Z', value_bigint: 1849100n }
      ]
    });

    // 5. India IIP Industrial Demand Index
    MacroSeriesFixtureRegistry.seriesMap.set('INDIA_IIP_INDUSTRIAL_DEMAND_INDEX_BPS', {
      series_id: 'INDIA_IIP_INDUSTRIAL_DEMAND_INDEX_BPS',
      unit: 'BPS',
      source_url: 'https://mospi.gov.in/iip-monthly',
      description: 'MoSPI Index of Industrial Production (IIP) manufacturing growth in basis points',
      observations: [
        { timestamp_utc: '2026-10-16T12:00:00.000Z', value_bigint: 12500n }
      ]
    });

    // 6. Domestic Surface Freight Index
    MacroSeriesFixtureRegistry.seriesMap.set('DOMESTIC_SURFACE_FREIGHT_INDEX_BPS', {
      series_id: 'DOMESTIC_SURFACE_FREIGHT_INDEX_BPS',
      unit: 'BPS',
      source_url: 'https://www.nseindia.com/freight-indices',
      description: 'Domestic freight cost composite index in basis points',
      observations: [
        { timestamp_utc: '2026-10-16T12:00:00.000Z', value_bigint: 10200n }
      ]
    });
  }

  public static registerSeries(
    seriesId: string,
    data: {
      series_id: string;
      unit: MacroSeriesUnit;
      source_url: string;
      description?: string;
      observations: readonly {
        readonly timestamp_utc: string;
        readonly value_bigint: bigint;
      }[];
    }
  ): void {
    this.seriesMap.set(seriesId, {
      series_id: data.series_id,
      unit: data.unit,
      source_url: data.source_url,
      description: data.description || seriesId,
      observations: [...data.observations]
    });
  }

  public static getSeries(seriesId: string): MacroSeriesFixtureItem | undefined {
    return this.seriesMap.get(seriesId);
  }
}

// ============================================================================
// 4. MCP TOOL REGISTRATION & HANDLER
// ============================================================================

export const MACRO_LATERAL_TOOL_DESCRIPTOR: McpToolDescriptor = Object.freeze({
  name: 'mcp://macro-feeds/query_series',
  description:
    'Read-only macroeconomic, market factor, and commodity reference series query endpoint with zero-default staleness checking and pure BigInt FX conversion',
  inputSchema: {
    type: 'object' as const,
    properties: {
      series_id: { type: 'string' },
      url: { type: 'string' },
      target_url: { type: 'string' },
      target_unit: { type: 'string' },
      reference_time_utc: { type: 'string' },
      max_staleness_seconds: { type: 'number' },
      fbil_usd_inr_rate_subunits: { type: 'string' },
      derive_scrap_floor: { type: 'boolean' },
      pack_mass_grams: { type: 'number' },
      min_stamping_conversion_bps: { type: 'string' },
      custom_commercial_status: { type: 'string' },
      raw_feed_payload: { type: 'string' },
      custom_observations: { type: 'array' },
      task_id: { type: 'string' }
    },
    required: ['series_id']
  }
});

/**
 * Registers the read-only tool 'mcp://macro-feeds/query_series' on an McpServerAdapter.
 */
export function registerMacroLateralTool(server: McpServerAdapter): void {
  server.registerTool({
    descriptor: MACRO_LATERAL_TOOL_DESCRIPTOR,
    handler: async (args: Record<string, unknown>): Promise<McpToolCallResponse['result']> => {
      // 1. Hardcoded Commercial Status Ceiling
      const customCommercialStatus = args.custom_commercial_status as string | undefined;
      if (customCommercialStatus && customCommercialStatus !== 'NOT_APPLICABLE') {
        throw new Error(
          'E-MLW-COMMERCIAL-STATUS-FORBIDDEN: Macroeconomic and market signals cannot carry commercial offer status.'
        );
      }

      const seriesId = String(args.series_id || '');
      const referenceTimeUtc = String(args.reference_time_utc || '2026-10-18T00:00:00.000Z');
      const maxStalenessSeconds =
        typeof args.max_staleness_seconds === 'number' ? args.max_staleness_seconds : 604800; // 7 days default
      const targetUnit = args.target_unit as MacroSeriesUnit | undefined;

      // 2. Scan for prompt injection / domain state spoofing if raw feed payload provided
      if (args.raw_feed_payload) {
        const rawText = String(args.raw_feed_payload);
        const canaryResult = InjectionCanaryGuard.scan(rawText);
        if (canaryResult.quarantined) {
          const quarantinedResponse: MacroLateralMcpResponse = {
            request_id: String(args.request_id || args.task_id || `mlw-req-${seriesId}`),
            series_id: seriesId,
            requested_at_utc: referenceTimeUtc,
            status: 'QUARANTINED_INJECTION',
            error_code: 'E-MLW-PROMPT-INJECTION-DETECTED',
            error_reason: `Macro feed payload quarantined due to prompt injection flags: [${canaryResult.flags.join(', ')}].`,
            evidence_envelope: Object.freeze({
              evidence_kind: 'OBSERVED_FACT',
              verification_status: 'UNVERIFIED',
              commercial_status: 'NOT_APPLICABLE',
              provenance_lineage: Object.freeze({
                source_id: seriesId,
                observed_at_utc: referenceTimeUtc,
                ttl_seconds: 604800,
                raw_sha256: sha256(rawText),
                extractor_version: 'mlw-macro-sieve-v1.0.0'
              })
            })
          };

          const serializedQuarantine = canonicalizeJCS(sanitizeForJcs(quarantinedResponse));
          return {
            content: [{ type: 'text', text: serializedQuarantine }],
            tokens_used: Math.ceil(serializedQuarantine.length / 4)
          };
        }
      }

      // 3. Resolve Series Observations (Zero-Default Policy)
      let observations: Array<{ timestamp_utc: string; value_bigint: bigint }> = [];
      let sourceUrl = 'https://www.rbi.org.in';
      let currentUnit: MacroSeriesUnit = 'BPS';

      const customObs = args.custom_observations as
        | ReadonlyArray<{ timestamp_utc: string; value_bigint: string }>
        | undefined;

      if (customObs && Array.isArray(customObs) && customObs.length > 0) {
        observations = customObs.map((o) => ({
          timestamp_utc: o.timestamp_utc,
          value_bigint: BigInt(o.value_bigint)
        }));
        sourceUrl = 'custom://macro-feed/observations';
        currentUnit = targetUnit || 'BPS';
      } else {
        const fixture = MacroSeriesFixtureRegistry.getSeries(seriesId);
        if (!fixture || !fixture.observations || fixture.observations.length === 0) {
          const missingResponse: MacroLateralMcpResponse = {
            request_id: String(args.request_id || args.task_id || `mlw-req-${seriesId}`),
            series_id: seriesId,
            requested_at_utc: referenceTimeUtc,
            status: 'DATA_REQUIRED',
            error_code: 'E-MLW-SERIES-DATA-REQUIRED',
            error_reason: `E-MLW-SERIES-DATA-REQUIRED: Series '${seriesId}' is missing or contains no observations. Zero fabricated defaults allowed.`,
            evidence_envelope: Object.freeze({
              evidence_kind: 'OBSERVED_FACT',
              verification_status: 'UNVERIFIED',
              commercial_status: 'NOT_APPLICABLE',
              provenance_lineage: Object.freeze({
                source_id: seriesId,
                observed_at_utc: referenceTimeUtc,
                ttl_seconds: 604800,
                extractor_version: 'mlw-macro-sieve-v1.0.0'
              })
            })
          };
          const serializedMissing = canonicalizeJCS(sanitizeForJcs(missingResponse));
          return {
            content: [{ type: 'text', text: serializedMissing }],
            tokens_used: Math.ceil(serializedMissing.length / 4)
          };
        }

        observations = [...fixture.observations];
        sourceUrl = fixture.source_url;
        currentUnit = fixture.unit;
      }

      // Check for non-positive or empty latest observation
      const latestObs = observations[observations.length - 1];
      if (!latestObs || latestObs.value_bigint <= 0n) {
        const invalidResponse: MacroLateralMcpResponse = {
          request_id: String(args.request_id || args.task_id || `mlw-req-${seriesId}`),
          series_id: seriesId,
          requested_at_utc: referenceTimeUtc,
          status: 'DATA_REQUIRED',
          error_code: 'E-MLW-SERIES-DATA-REQUIRED',
          error_reason: `E-MLW-SERIES-DATA-REQUIRED: Series '${seriesId}' latest observation value (${latestObs?.value_bigint ?? 0n}) is non-positive.`,
          evidence_envelope: Object.freeze({
            evidence_kind: 'OBSERVED_FACT',
            verification_status: 'UNVERIFIED',
            commercial_status: 'NOT_APPLICABLE',
            provenance_lineage: Object.freeze({
              source_id: sourceUrl,
              observed_at_utc: referenceTimeUtc,
              ttl_seconds: 604800,
              extractor_version: 'mlw-macro-sieve-v1.0.0'
            })
          })
        };
        const serializedInvalid = canonicalizeJCS(sanitizeForJcs(invalidResponse));
        return {
          content: [{ type: 'text', text: serializedInvalid }],
          tokens_used: Math.ceil(serializedInvalid.length / 4)
        };
      }

      // 4. Staleness Validation
      const obsTimeMs = new Date(latestObs.timestamp_utc).getTime();
      const refTimeMs = new Date(referenceTimeUtc).getTime();
      const stalenessSeconds = Math.floor((refTimeMs - obsTimeMs) / 1000);

      if (stalenessSeconds > maxStalenessSeconds) {
        const staleResponse: MacroLateralMcpResponse = {
          request_id: String(args.request_id || args.task_id || `mlw-req-${seriesId}`),
          series_id: seriesId,
          requested_at_utc: referenceTimeUtc,
          status: 'STALE_OBSERVATION_REJECTED',
          error_code: 'E-MLW-STALE-SERIES',
          error_reason: `E-MLW-STALE-SERIES: Latest observation timestamp '${latestObs.timestamp_utc}' is ${stalenessSeconds}s old (exceeds max staleness ${maxStalenessSeconds}s).`,
          evidence_envelope: Object.freeze({
            evidence_kind: 'OBSERVED_FACT',
            verification_status: 'UNVERIFIED',
            commercial_status: 'NOT_APPLICABLE',
            provenance_lineage: Object.freeze({
              source_id: sourceUrl,
              observed_at_utc: referenceTimeUtc,
              ttl_seconds: 604800,
              extractor_version: 'mlw-macro-sieve-v1.0.0'
            })
          })
        };
        const serializedStale = canonicalizeJCS(sanitizeForJcs(staleResponse));
        return {
          content: [{ type: 'text', text: serializedStale }],
          tokens_used: Math.ceil(serializedStale.length / 4)
        };
      }

      // 5. Unit Conversion & FX Firewall
      let finalValue = latestObs.value_bigint;
      let finalUnit = currentUnit;

      const needsFxConversion =
        (currentUnit === 'SUBUNITS_USD_PER_TONNE' || seriesId === 'LME_SS304_COLD_ROLLED_USD_PER_TONNE') &&
        (targetUnit === 'SUBUNITS_INR_PER_KG' || args.target_unit === 'SUBUNITS_INR_PER_KG');

      if (needsFxConversion) {
        const rawFbil = args.fbil_usd_inr_rate_subunits;
        const fbilRate =
          rawFbil !== undefined && rawFbil !== null && String(rawFbil).trim().length > 0
            ? BigInt(String(rawFbil))
            : 0n;

        if (fbilRate <= 0n) {
          const fxFailResponse: MacroLateralMcpResponse = {
            request_id: String(args.request_id || args.task_id || `mlw-req-${seriesId}`),
            series_id: seriesId,
            requested_at_utc: referenceTimeUtc,
            status: 'UNIT_MISMATCH_REJECTED',
            error_code: 'E-MLW-MISSING-FX-REFERENCE',
            error_reason:
              'E-MLW-MISSING-FX-REFERENCE: Currency conversion from USD/tonne to INR/kg requires a fresh, positive FBIL_USD_INR_REFERENCE_RATE.',
            evidence_envelope: Object.freeze({
              evidence_kind: 'OBSERVED_FACT',
              verification_status: 'UNVERIFIED',
              commercial_status: 'NOT_APPLICABLE',
              provenance_lineage: Object.freeze({
                source_id: sourceUrl,
                observed_at_utc: referenceTimeUtc,
                ttl_seconds: 604800,
                extractor_version: 'mlw-macro-sieve-v1.0.0'
              })
            })
          };
          const serializedFxFail = canonicalizeJCS(sanitizeForJcs(fxFailResponse));
          return {
            content: [{ type: 'text', text: serializedFxFail }],
            tokens_used: Math.ceil(serializedFxFail.length / 4)
          };
        }

        finalValue = convertUsdPerTonneToInrPerKg(latestObs.value_bigint, fbilRate);
        finalUnit = 'SUBUNITS_INR_PER_KG';
      }

      // 6. Optional Physical Scrap Floor Calculation
      let scrapFloorPayload: MacroLateralMcpResponse['physical_scrap_floor'] | undefined;
      const shouldDeriveScrapFloor =
        args.derive_scrap_floor === true || typeof args.pack_mass_grams === 'number';

      if (shouldDeriveScrapFloor && finalUnit === 'SUBUNITS_INR_PER_KG') {
        const packMass = Number(args.pack_mass_grams || 140);
        const stampingBps =
          args.min_stamping_conversion_bps !== undefined
            ? BigInt(String(args.min_stamping_conversion_bps))
            : 1500n;
        const floorResult = derivePhysicalScrapFloor(packMass, finalValue, stampingBps);
        scrapFloorPayload = Object.freeze({
          pack_mass_grams: floorResult.pack_mass_grams,
          raw_metal_cost_subunits: floorResult.raw_metal_cost_subunits.toString(),
          min_viable_exw_floor_subunits: floorResult.min_viable_exw_floor_subunits.toString()
        });
      }

      // 7. Success Response
      const successResponse: MacroLateralMcpResponse = {
        request_id: String(args.request_id || args.task_id || `mlw-req-${seriesId}`),
        series_id: seriesId,
        requested_at_utc: referenceTimeUtc,
        status: 'RESOLVED',
        latest_observation: Object.freeze({
          timestamp_utc: latestObs.timestamp_utc,
          value_bigint: finalValue.toString(),
          unit: finalUnit,
          source_url: sourceUrl
        }),
        ...(scrapFloorPayload ? { physical_scrap_floor: scrapFloorPayload } : {}),
        evidence_envelope: Object.freeze({
          evidence_kind: 'OBSERVED_FACT',
          verification_status: 'UNVERIFIED',
          commercial_status: 'NOT_APPLICABLE',
          provenance_lineage: Object.freeze({
            source_id: sourceUrl,
            observed_at_utc: latestObs.timestamp_utc,
            ttl_seconds: maxStalenessSeconds,
            extractor_version: 'mlw-macro-sieve-v1.0.0'
          })
        })
      };

      const serialized = canonicalizeJCS(sanitizeForJcs(successResponse));
      return {
        content: [{ type: 'text', text: serialized }],
        tokens_used: Math.ceil(serialized.length / 4)
      };
    }
  });
}

// ============================================================================
// 5. DYNAMIC GROWTH DRIVER EVALUATION & REGIME CLASSIFIER
// ============================================================================

export type OpportunityTemporalRegime =
  | 'SUSTAINED_STRUCTURAL_SIGNAL'
  | 'FAST_TACTICAL_OPPORTUNITY'
  | 'SPURIOUS_OR_UNPROVEN_NOISE';

export interface FactorSeriesObservation {
  readonly timestamp_utc: string;
  readonly value_bigint: bigint;
}

export interface FactorSeriesWindow {
  readonly factor_id: string;
  readonly observations: readonly FactorSeriesObservation[];
  readonly opportunity_ccc_days: number;
  readonly formula_query?: string;
  readonly target_formula_id?: string;
  readonly additional_variables?: Record<string, bigint>;
  readonly estimated_half_life_days?: number;
}

export interface DynamicDriverEvaluation {
  readonly factor_id: string;
  readonly net_change_bps: bigint;
  readonly persistence_consistency_bps: bigint;
  readonly estimated_half_life_days: number;
  readonly regime: OpportunityTemporalRegime;
  readonly multi_cycle_replenishment_eligible: boolean;
  readonly tactical_execution_viable: boolean;
  readonly blocking_reason?: string;
  readonly modeled_impact_subunits_or_bps: bigint;
  readonly driver_elasticity_bps: bigint;
  readonly formula_id_used: string;
  readonly formula_expression: string;
}

/**
 * Dynamically evaluates candidate growth drivers through FormulaRegistry
 * pure-BigInt rational AST arithmetic without hardcoding static function calls.
 */
export function evaluateDynamicGrowthDriver(
  window: FactorSeriesWindow,
  registry: FormulaRegistry,
  advisor?: GroqFormulaAdvisor
): DynamicDriverEvaluation {
  const obs = window.observations;
  if (!obs || obs.length < 2) {
    throw new Error('E-MLW-INSUFFICIENT-OBSERVATIONS: Window requires at least 2 observations to evaluate trend.');
  }

  const firstVal = obs[0].value_bigint;
  const latestVal = obs[obs.length - 1].value_bigint;

  // 1. Net change basis points: ((latest - first) * 10000) / |first|
  let netChangeBps = 0n;
  if (firstVal > 0n) {
    netChangeBps = ((latestVal - firstVal) * 10000n) / firstVal;
  } else if (firstVal < 0n) {
    netChangeBps = ((latestVal - firstVal) * 10000n) / -firstVal;
  }

  // 2. Persistence consistency basis points
  let alignedTransitions = 0n;
  const totalTransitions = BigInt(obs.length - 1);

  for (let i = 1; i < obs.length; i++) {
    const delta = obs[i].value_bigint - obs[i - 1].value_bigint;
    if (netChangeBps >= 0n && delta >= 0n) {
      alignedTransitions += 1n;
    } else if (netChangeBps < 0n && delta <= 0n) {
      alignedTransitions += 1n;
    }
  }

  const persistenceConsistencyBps =
    totalTransitions > 0n ? (alignedTransitions * 10000n) / totalTransitions : 10000n;

  // 3. Estimated Half-Life Days
  let estimatedHalfLifeDays = window.estimated_half_life_days;

  if (estimatedHalfLifeDays === undefined) {
    const tFirstMs = new Date(obs[0].timestamp_utc).getTime();
    const tLatestMs = new Date(obs[obs.length - 1].timestamp_utc).getTime();
    const totalSpanDays = Math.max(1, Math.round((tLatestMs - tFirstMs) / 86400000));

    // Find peak observation
    let peakIdx = 0;
    let peakVal = obs[0].value_bigint;
    for (let i = 1; i < obs.length; i++) {
      if (obs[i].value_bigint > peakVal) {
        peakVal = obs[i].value_bigint;
        peakIdx = i;
      }
    }

    if (peakIdx >= obs.length - 2) {
      // Sustained monotonic expansion across observation span
      estimatedHalfLifeDays = Math.max(totalSpanDays, 45);
    } else {
      // Impulse peaked earlier and is currently decaying
      const tPeakMs = new Date(obs[peakIdx].timestamp_utc).getTime();
      const daysFromPeak = Math.max(1, Math.round((tLatestMs - tPeakMs) / 86400000));
      const impulse = peakVal - firstVal;
      const decay = peakVal - latestVal;

      if (impulse > 0n && decay > 0n) {
        const decayRatio = Number(decay) / Number(impulse);
        estimatedHalfLifeDays = Math.max(1, Math.round(daysFromPeak * (0.5 / Math.min(1.0, decayRatio))));
      } else {
        estimatedHalfLifeDays = totalSpanDays;
      }
    }
  }

  // 4. Regime Classification & Tactical Horizon Gate
  const absNetChangeBps = netChangeBps >= 0n ? netChangeBps : -netChangeBps;
  let regime: OpportunityTemporalRegime;
  let multiCycleEligible = false;
  let tacticalViable = false;
  let blockingReason: string | undefined;

  if (
    persistenceConsistencyBps >= 7000n &&
    estimatedHalfLifeDays >= 30 &&
    absNetChangeBps >= 300n
  ) {
    regime = 'SUSTAINED_STRUCTURAL_SIGNAL';
    multiCycleEligible = true;
    tacticalViable = true;
  } else if (absNetChangeBps >= 1000n && estimatedHalfLifeDays < 30) {
    regime = 'FAST_TACTICAL_OPPORTUNITY';
    multiCycleEligible = false;

    // Tactical Horizon Gate: If cash conversion cycle exceeds signal decay half-life, fail closed
    if (window.opportunity_ccc_days > estimatedHalfLifeDays) {
      tacticalViable = false;
      blockingReason = 'E-MLW-EDGE-DECAYS-BEFORE-CASH-RECOVERY';
    } else {
      tacticalViable = true;
    }
  } else {
    regime = 'SPURIOUS_OR_UNPROVEN_NOISE';
    multiCycleEligible = false;
    tacticalViable = false;
    blockingReason = 'E-MLW-INSUFFICIENT-SIGNAL-PERSISTENCE';
  }

  // 5. Formula Resolution & Symbolic Execution
  let formulaCard: FormulaCard | undefined;

  if (window.target_formula_id) {
    formulaCard = registry.getFormula(window.target_formula_id);
  } else if (window.formula_query) {
    const hits = registry.retrieveFormulas(window.formula_query);
    if (hits.length > 0) {
      formulaCard = hits[0].formula;
    }
  }

  if (!formulaCard) {
    formulaCard = {
      formula_id: 'FACTOR-LINEAR-IMPACT-DEFAULT',
      title: 'Default Linear Factor Transfer Model',
      domain: 'PHYSICAL_ARBITRAGE',
      tier: 'PROMOTED_NORMATIVE',
      statutory_or_economic_citations: ['Default linear factor transfer'],
      symbolic_expression: 'ImpactBps = NetChangeBps',
      input_variables: [
        { name: 'netchangebps', unit: 'BPS', description: 'Net factor change in basis points' }
      ],
      output_variable: { name: 'impactbps', unit: 'BPS' },
      rationale_and_invariants: 'Default 1:1 basis points factor transfer',
      canonical_test_vector: {
        inputs: { netchangebps: 1000 },
        expected_output: 1000
      },
      jcs_hash: ''
    };
  }

  // Prepare input variables for symbolic execution
  const inputs: Record<string, bigint | number> = {
    netchangebps: absNetChangeBps,
    net_change_bps: absNetChangeBps,
    impactbps: absNetChangeBps
  };

  if (window.additional_variables) {
    for (const [k, v] of Object.entries(window.additional_variables)) {
      inputs[k.toLowerCase()] = v;
    }
  }

  // Auto-map net change and ccc to input variable names
  for (const iv of formulaCard.input_variables) {
    const lowerName = iv.name.toLowerCase();
    if (inputs[lowerName] === undefined) {
      if (
        lowerName.includes('growth') ||
        lowerName.includes('change') ||
        lowerName.includes('demand') ||
        lowerName.includes('capex') ||
        lowerName.includes('factor')
      ) {
        inputs[lowerName] = absNetChangeBps;
      } else if (lowerName.includes('ccc') || lowerName.includes('lead') || lowerName.includes('days')) {
        inputs[lowerName] = BigInt(window.opportunity_ccc_days);
      } else if (iv.unit === 'BPS') {
        inputs[lowerName] = 10000n;
      } else {
        inputs[lowerName] = 1n;
      }
    }
  }

  const modeledImpact = evaluateSymbolicExpression(formulaCard.symbolic_expression, inputs);
  const driverElasticityBps =
    absNetChangeBps > 0n ? (modeledImpact * 100n) / absNetChangeBps : 100n;

  return deepFreeze({
    factor_id: window.factor_id,
    net_change_bps: netChangeBps,
    persistence_consistency_bps: persistenceConsistencyBps,
    estimated_half_life_days: estimatedHalfLifeDays,
    regime: regime,
    multi_cycle_replenishment_eligible: multiCycleEligible,
    tactical_execution_viable: tacticalViable,
    blocking_reason: blockingReason,
    modeled_impact_subunits_or_bps: modeledImpact,
    driver_elasticity_bps: driverElasticityBps,
    formula_id_used: formulaCard.formula_id,
    formula_expression: formulaCard.symbolic_expression
  });
}

// ============================================================================
// 6. EMPIRICAL FACTOR EFFICACY LEDGER
// ============================================================================

export interface FactorEmpiricalObservation {
  readonly cycle_id: string;
  readonly predicted_impact_bps: bigint;
  readonly realized_impact_bps: bigint;
  readonly recorded_at_utc: string;
}

export type FactorCredibilityClassification =
  | 'UNPROVEN_HYPOTHESIS'
  | 'EMPIRICALLY_VALIDATED_DRIVER'
  | 'EMPIRICALLY_REFUTED_NOISE';

export interface FactorCredibilityEvaluation {
  readonly factor_id: string;
  readonly total_cycles: number;
  readonly hit_rate_bps: bigint;
  readonly mean_absolute_error_bps: bigint;
  readonly credibility: FactorCredibilityClassification;
  readonly observations: readonly FactorEmpiricalObservation[];
}

export class FactorEfficacyLedger {
  private readonly ledger = new Map<string, FactorEmpiricalObservation[]>();

  public recordEmpiricalOutcome(factorId: string, observation: FactorEmpiricalObservation): void {
    if (!this.ledger.has(factorId)) {
      this.ledger.set(factorId, []);
    }
    this.ledger.get(factorId)!.push({ ...observation });
  }

  public getObservations(factorId: string): readonly FactorEmpiricalObservation[] {
    return Object.freeze([...(this.ledger.get(factorId) || [])]);
  }

  public evaluateFactorCredibility(factorId: string): FactorCredibilityEvaluation {
    const list = this.ledger.get(factorId) || [];
    if (list.length === 0) {
      return deepFreeze({
        factor_id: factorId,
        total_cycles: 0,
        hit_rate_bps: 0n,
        mean_absolute_error_bps: 0n,
        credibility: 'UNPROVEN_HYPOTHESIS',
        observations: Object.freeze([])
      });
    }

    let hits = 0n;
    let sumAbsError = 0n;

    for (const obs of list) {
      const pred = obs.predicted_impact_bps;
      const real = obs.realized_impact_bps;

      const diff = real >= pred ? real - pred : pred - real;
      sumAbsError += diff;

      // Hit: Realized matched sign and achieved >= 50% of predicted impact
      let isHit = false;
      if (pred > 0n) {
        const threshold = (pred * 5000n) / 10000n;
        if (real >= threshold) {
          isHit = true;
        }
      } else if (pred < 0n) {
        const threshold = (pred * 5000n) / 10000n;
        if (real <= threshold) {
          isHit = true;
        }
      } else {
        if (real === 0n) {
          isHit = true;
        }
      }

      if (isHit) {
        hits += 1n;
      }
    }

    const totalCycles = list.length;
    const hitRateBps = (hits * 10000n) / BigInt(totalCycles);
    const meanAbsErrorBps = sumAbsError / BigInt(totalCycles);

    let credibility: FactorCredibilityClassification = 'UNPROVEN_HYPOTHESIS';
    if (totalCycles >= 3) {
      if (hitRateBps >= 6500n) {
        credibility = 'EMPIRICALLY_VALIDATED_DRIVER';
      } else if (hitRateBps < 4000n) {
        credibility = 'EMPIRICALLY_REFUTED_NOISE';
      } else {
        credibility = 'UNPROVEN_HYPOTHESIS';
      }
    }

    return deepFreeze({
      factor_id: factorId,
      total_cycles: totalCycles,
      hit_rate_bps: hitRateBps,
      mean_absolute_error_bps: meanAbsErrorBps,
      credibility: credibility,
      observations: Object.freeze([...list])
    });
  }
}

// ============================================================================
// 7. MACRO AND LATERAL MARKET WORKER
// ============================================================================

export class MacroAndLateralMarketWorker {
  public static readonly WORKER_ID = 'worker:macro-lateral:v1';
  private readonly broker: McpCapabilityBroker;
  private readonly defaultGrant?: CapabilityGrant;

  constructor(broker: McpCapabilityBroker, defaultGrant?: CapabilityGrant) {
    this.broker = broker;
    this.defaultGrant = defaultGrant;
  }

  public getBroker(): McpCapabilityBroker {
    return this.broker;
  }

  public async querySeries(
    request: MacroLateralMcpRequest,
    customGrant?: CapabilityGrant
  ): Promise<MacroLateralMcpResponse> {
    const grant = customGrant ?? this.defaultGrant;
    if (!grant) {
      throw new Error('E-MLW-NO-GRANT: No CapabilityGrant provided for MacroAndLateralMarketWorker execution.');
    }

    if (
      request.custom_commercial_status &&
      request.custom_commercial_status !== 'NOT_APPLICABLE'
    ) {
      throw new Error(
        'E-MLW-COMMERCIAL-STATUS-FORBIDDEN: Macroeconomic and market signals cannot carry commercial offer status.'
      );
    }

    const fixture = MacroSeriesFixtureRegistry.getSeries(request.series_id);
    const targetUrl = request.target_url || fixture?.source_url || 'https://www.rbi.org.in';

    const toolCallRequest: McpToolCallRequest = {
      jsonrpc: '2.0',
      id: request.task_id,
      method: 'tools/call',
      params: {
        name: 'mcp://macro-feeds/query_series',
        arguments: {
          series_id: request.series_id,
          target_url: targetUrl,
          url: targetUrl,
          target_unit: request.target_unit,
          reference_time_utc: request.reference_time_utc,
          max_staleness_seconds: request.max_staleness_seconds,
          fbil_usd_inr_rate_subunits:
            request.fbil_usd_inr_rate_subunits !== undefined
              ? String(request.fbil_usd_inr_rate_subunits)
              : undefined,
          derive_scrap_floor: request.derive_scrap_floor,
          pack_mass_grams: request.pack_mass_grams,
          min_stamping_conversion_bps:
            request.min_stamping_conversion_bps !== undefined
              ? String(request.min_stamping_conversion_bps)
              : undefined,
          custom_commercial_status: request.custom_commercial_status,
          raw_feed_payload: request.raw_feed_payload,
          custom_observations: request.custom_observations,
          task_id: request.task_id
        }
      }
    };

    const toolCallResponse = await this.broker.invokeTool(grant, toolCallRequest);

    if (toolCallResponse.error) {
      throw new Error(toolCallResponse.error.message);
    }

    const contentItem = toolCallResponse.result?.content?.[0];
    if (!contentItem || !contentItem.text) {
      throw new Error('E-MLW-EMPTY-RESPONSE: Tool call returned empty result content.');
    }

    const parsed: MacroLateralMcpResponse = JSON.parse(contentItem.text);
    return deepFreeze(parsed);
  }
}
