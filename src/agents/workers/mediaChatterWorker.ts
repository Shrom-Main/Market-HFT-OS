/**
 * Market HFT OS — Micro-Agent #2: MediaAndChatterWorker (Stage 3)
 *
 * Implements:
 * 1. Strict MCP Broker Routing:
 *    - Worker ID: 'worker:media-chatter:v1'
 *    - Read-only tool 'mcp://media-corpus/fetch_transcript'
 *    - Scoped to approved media hosts ('transcripts.approved-corpus.local', 'www.youtube.com', 'sellercentral.amazon.in', 'www.amazon.in')
 *    - 256 KB payload cap, GET only, redirect blocking
 * 2. Mandatory Verbatim Citation Span Verification (verifyVerbatimCitationSpan):
 *    - Every extracted claim MUST carry >= 1 VerbatimCitationSpan
 *    - Exact substring verification: sanitizedTranscript.slice(start, end) === verbatim_quote
 *    - Zero-citation claims fail closed (E-MCW-UNCITED-CLAIM-REJECTED)
 *    - Offset mismatch fails closed (E-MCW-INVALID-CITATION-SPAN)
 * 3. Structured Chatter Signal Taxonomy & Empirical Defect Math:
 *    - 4 Categories: METALLURGY_GRADE_DEFECT, DIMENSIONAL_OR_TORQUE_FAILURE, PACKAGING_COUNT_SHORTFALL, SELLER_FEE_OR_RETURN_SPIKE
 *    - Empirical defect rate: Math.floor((observed_defect_mention_count * 10000) / total_sampled)
 *    - Cryptographic spotlighting container (<untrusted_dom_field_${nonce}>)
 * 4. Hardcoded 4D Evidence Ceiling & Trigger Helper:
 *    - Hard-bound verification_status: 'UNVERIFIED', commercial_status: 'NOT_APPLICABLE'
 *    - Zero economic or commercial pricing authority (E-MCW-COMMERCIAL-STATUS-FORBIDDEN)
 *    - evaluateChatterSupplementTrigger: COMPLEMENTARY_GAP_FILL vs SUPPLEMENTARY_ANOMALY_CHECK vs NONE
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
import {
  InjectionCanaryGuard,
  createSpotlightContainer,
  SourceCaptureMcpResponse
} from './sourceCaptureWorker.js';
import { deepFreeze } from '../../verification/gate.js';

// ============================================================================
// 1. TOOL POLICY & CONTRACT TYPES
// ============================================================================

export interface MediaChatterToolPolicy {
  readonly tool_id: 'mcp://media-corpus/fetch_transcript';
  readonly allowed_methods: readonly ['GET'];
  readonly allowed_schemes: readonly ['https', 'mcp'];
  readonly allowed_hosts: readonly [
    'transcripts.approved-corpus.local',
    'www.youtube.com',
    'sellercentral.amazon.in',
    'www.amazon.in'
  ];
  readonly allow_redirects: false;
  readonly block_private_and_loopback_ips: true;
  readonly allowed_content_types: readonly ['text/plain', 'application/json', 'text/html'];
  readonly max_payload_bytes: 262144; // 256 KB
  readonly max_latency_ms: 4000;
  readonly max_requests_per_task: 3;
}

export const MEDIA_CHATTER_TOOL_POLICY: MediaChatterToolPolicy = Object.freeze({
  tool_id: 'mcp://media-corpus/fetch_transcript',
  allowed_methods: Object.freeze(['GET'] as const),
  allowed_schemes: Object.freeze(['https', 'mcp'] as const),
  allowed_hosts: Object.freeze([
    'transcripts.approved-corpus.local',
    'www.youtube.com',
    'sellercentral.amazon.in',
    'www.amazon.in'
  ] as const),
  allow_redirects: false,
  block_private_and_loopback_ips: true,
  allowed_content_types: Object.freeze(['text/plain', 'application/json', 'text/html'] as const),
  max_payload_bytes: 262144,
  max_latency_ms: 4000,
  max_requests_per_task: 3
});

export type ChatterMediaType =
  | 'YOUTUBE_UNBOXING_OR_REVIEW'
  | 'AMAZON_BUYER_REVIEWS'
  | 'SELLER_FORUM_THREAD';

export type ChatterSignalCategory =
  | 'METALLURGY_GRADE_DEFECT'
  | 'DIMENSIONAL_OR_TORQUE_FAILURE'
  | 'PACKAGING_COUNT_SHORTFALL'
  | 'SELLER_FEE_OR_RETURN_SPIKE';

export interface VerbatimCitationSpan {
  readonly source_artifact_sha256: string;
  readonly start_char_offset: number;
  readonly end_char_offset: number;
  readonly media_timestamp_seconds?: number;
  readonly verbatim_quote: string;
}

export interface ExtractedChatterClaim {
  readonly claim_id: string;
  readonly category: ChatterSignalCategory;
  readonly summary: string;
  readonly observed_defect_mention_count: number;
  readonly total_sampled_reviews_or_segments: number;
  readonly observed_defect_rate_bps: number;
  readonly citations: readonly VerbatimCitationSpan[];
  readonly spotlighted_quote: string;
}

export interface MediaChatterEvidenceEnvelope {
  readonly evidence_kind: 'OBSERVED_FACT';
  readonly verification_status: 'UNVERIFIED';
  readonly commercial_status: 'NOT_APPLICABLE';
  readonly provenance_lineage: {
    readonly source_id: string;
    readonly requested_url?: string;
    readonly resolved_source_identity?: string;
    readonly evidence_origin_class?: 'LIVE_VERIFIED_CAPTURE' | 'RECORDED_GOLDEN_FIXTURE' | 'CALLER_SUPPLIED_PAYLOAD';
    readonly observed_at_utc: string;
    readonly ttl_seconds: number;
    readonly raw_sha256: string;
    readonly sanitized_sha256: string;
    readonly extractor_version: 'mcw-transcript-sieve-v1.0.0';
  };
}

export interface MediaChatterCandidateClaimInput {
  readonly claim_id: string;
  readonly category: ChatterSignalCategory;
  readonly summary: string;
  readonly observed_defect_mention_count: number;
  readonly citations: readonly VerbatimCitationSpan[];
}

export interface MediaChatterMcpRequest {
  readonly task_id: string;
  readonly worker_id: 'worker:media-chatter:v1';
  readonly target_url: string;
  readonly media_type: ChatterMediaType;
  readonly fixture_id?: string;
  readonly raw_transcript_payload?: string;
  readonly total_sampled_reviews_or_segments?: number;
  readonly candidate_claims?: readonly MediaChatterCandidateClaimInput[];
  readonly requested_at_utc: string;
  readonly custom_commercial_status?: string;
}

export interface MediaChatterMcpResponse {
  readonly request_id: string;
  readonly target_url: string;
  readonly media_type: ChatterMediaType;
  readonly captured_at_utc: string;
  readonly extraction_version: 'mcw-transcript-sieve-v1.0.0';
  readonly raw_payload_sha256: string;
  readonly sanitized_payload_sha256: string;
  readonly status: 'EXTRACTED' | 'QUARANTINED_INJECTION' | 'DATA_INSUFFICIENT' | 'PARSE_REJECTED';
  readonly error_code?: string;
  readonly error_reason?: string;
  readonly claims: readonly ExtractedChatterClaim[];
  readonly evidence_envelope: MediaChatterEvidenceEnvelope;
}

// ============================================================================
// 2. VERBATIM CITATION SPAN VERIFICATION
// ============================================================================

/**
 * Validates that a VerbatimCitationSpan strictly matches the underlying sanitized transcript text.
 * Enforces:
 * - Valid character offset boundaries [start_char_offset, end_char_offset]
 * - Verbatim slice match: transcript.slice(start, end) === verbatim_quote
 * - Quote length constraints: 10 to 280 characters
 * - Optional SHA-256 integrity check against the source artifact
 */
export function verifyVerbatimCitationSpan(
  sanitizedTranscript: string,
  citation: VerbatimCitationSpan,
  expectedSha256?: string
): boolean {
  if (citation.start_char_offset < 0) {
    throw new Error('E-MCW-INVALID-CITATION-SPAN: start_char_offset cannot be negative.');
  }

  if (citation.end_char_offset <= citation.start_char_offset) {
    throw new Error(
      `E-MCW-INVALID-CITATION-SPAN: end_char_offset (${citation.end_char_offset}) must be strictly greater than start_char_offset (${citation.start_char_offset}).`
    );
  }

  if (citation.end_char_offset > sanitizedTranscript.length) {
    throw new Error(
      `E-MCW-INVALID-CITATION-SPAN: end_char_offset (${citation.end_char_offset}) exceeds transcript length (${sanitizedTranscript.length}).`
    );
  }

  const quoteLen = citation.verbatim_quote.length;
  if (quoteLen < 10 || quoteLen > 280) {
    throw new Error(
      `E-MCW-INVALID-CITATION-SPAN: Verbatim quote length (${quoteLen}) must be between 10 and 280 characters.`
    );
  }

  const actualSlice = sanitizedTranscript.slice(citation.start_char_offset, citation.end_char_offset);
  if (actualSlice !== citation.verbatim_quote) {
    throw new Error(
      `E-MCW-INVALID-CITATION-SPAN: Citation character offsets [${citation.start_char_offset}, ${citation.end_char_offset}] do not match verbatim quote in sanitized transcript.`
    );
  }

  if (expectedSha256 && citation.source_artifact_sha256 !== expectedSha256) {
    throw new Error(
      `E-MCW-INVALID-CITATION-SPAN: Citation artifact SHA-256 (${citation.source_artifact_sha256}) does not match expected (${expectedSha256}).`
    );
  }

  return true;
}

/**
 * Sanitizes transcript text: rejects null bytes, validates 256KB cap, NFC normalizes,
 * and strips zero-width/BiDi characters.
 */
export function sanitizeTranscript(rawText: string): {
  sanitizedText: string;
  rawSha256: string;
  sanitizedSha256: string;
  rawByteLength: number;
  sanitizedByteLength: number;
} {
  const rawByteLength = Buffer.byteLength(rawText, 'utf8');
  if (rawByteLength > 262144) {
    throw new Error(`E-MCP-PAYLOAD-TOO-LARGE: Payload byte length ${rawByteLength} exceeds 262,144 bytes cap.`);
  }

  if (/\x00/.test(rawText)) {
    throw new Error('E-MCW-NULL-BYTE-DETECTED: Null byte detected in transcript stream.');
  }

  const rawSha256 = sha256(rawText);

  // Unicode NFC normalization
  let sanitized = rawText.normalize('NFC');

  // Strip zero-width & BiDi formatting characters
  sanitized = sanitized.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');

  const sanitizedByteLength = Buffer.byteLength(sanitized, 'utf8');
  const sanitizedSha256 = sha256(sanitized);

  return {
    sanitizedText: sanitized,
    rawSha256,
    sanitizedSha256,
    rawByteLength,
    sanitizedByteLength
  };
}

// ============================================================================
// 3. COMPLEMENTARY & SUPPLEMENTARY TRIGGER HELPER
// ============================================================================

/**
 * Evaluates whether MediaAndChatterWorker should be triggered:
 * - COMPLEMENTARY_GAP_FILL: When customer_return_rate_bps has no empirical observation
 * - SUPPLEMENTARY_ANOMALY_CHECK: When a captured supplier quote is suspiciously near or below the physical scrap floor
 * - NONE: When data is already sufficient and no pricing anomalies exist
 */
export function evaluateChatterSupplementTrigger(
  captureResponse: SourceCaptureMcpResponse,
  lmeScrapFloorSubunits: bigint,
  hasEmpiricalReturnRate: boolean
): {
  trigger_required: boolean;
  mode: 'COMPLEMENTARY_GAP_FILL' | 'SUPPLEMENTARY_ANOMALY_CHECK' | 'NONE';
  reason: string;
} {
  // Complementary gap fill: return rate has no empirical source
  if (!hasEmpiricalReturnRate) {
    return {
      trigger_required: true,
      mode: 'COMPLEMENTARY_GAP_FILL',
      reason: 'Customer return rate has no empirical source; dispatching MediaAndChatterWorker for unboxing and review sentiment.'
    };
  }

  // Supplementary anomaly check: quote is suspiciously near or below scrap floor
  let quoteSubunits: bigint | null = null;
  const grossPrice = captureResponse.extracted_fields?.['gross_price_inr'];
  const rawMaterial = captureResponse.extracted_fields?.['raw_material_purchase_subunits'];
  if (grossPrice && grossPrice.status === 'EXTRACTED' && grossPrice.normalized_value) {
    quoteSubunits = BigInt(grossPrice.normalized_value);
  } else if (rawMaterial && rawMaterial.status === 'EXTRACTED' && rawMaterial.normalized_value) {
    quoteSubunits = BigInt(rawMaterial.normalized_value);
  } else if (captureResponse.extracted_fields) {
    for (const field of Object.values(captureResponse.extracted_fields)) {
      if (field && field.status === 'EXTRACTED' && field.unit === 'SUBUNITS_INR' && field.normalized_value) {
        quoteSubunits = BigInt(field.normalized_value);
        break;
      }
    }
  }

  if (quoteSubunits !== null && lmeScrapFloorSubunits > 0n) {
    // 15% scrap buffer: floor * 1.15 = (floor * 11500) / 10000
    const threshold = (lmeScrapFloorSubunits * 11500n) / 10000n;
    if (quoteSubunits <= threshold) {
      return {
        trigger_required: true,
        mode: 'SUPPLEMENTARY_ANOMALY_CHECK',
        reason: `Supplier quote of ₹${(Number(quoteSubunits) / 10000).toFixed(2)} is within 15% buffer of physical scrap floor ₹${(Number(lmeScrapFloorSubunits) / 10000).toFixed(2)}; triggering supplementary anomaly check for SS202 manganese substitution.`
      };
    }
  }

  return {
    trigger_required: false,
    mode: 'NONE',
    reason: 'Commercial quote exceeds scrap floor buffer and empirical return data is already present.'
  };
}

// ============================================================================
// 4. RECORDED FIXTURE REGISTRY
// ============================================================================

export interface RegisteredChatterFixture {
  readonly transcript: string;
  readonly media_type: ChatterMediaType;
  readonly total_sampled_segments: number;
  readonly default_claims: readonly MediaChatterCandidateClaimInput[];
}

export class MediaChatterFixtureRegistry {
  private static readonly fixtures = new Map<string, RegisteredChatterFixture>();

  static {
    // 1. YouTube SS304 Clamp Unboxing & Torque Review
    const ytTranscript =
      'In this video we review the SS304 hose clamps. At 01:25 we run the magnet test and notice strong magnetic pull, indicating manganese substitution typical of SS202 steel. In our torque test at 02:40, the DIN 3017 screw thread stripped at just 3.2 Nm of torque.';
    const ytSha256 = sha256(ytTranscript);

    const ytMagnetQuote = 'notice strong magnetic pull, indicating manganese substitution typical of SS202 steel.';
    const ytMagnetStart = ytTranscript.indexOf(ytMagnetQuote);
    const ytMagnetEnd = ytMagnetStart + ytMagnetQuote.length;

    const ytTorqueQuote = 'the DIN 3017 screw thread stripped at just 3.2 Nm of torque.';
    const ytTorqueStart = ytTranscript.indexOf(ytTorqueQuote);
    const ytTorqueEnd = ytTorqueStart + ytTorqueQuote.length;

    MediaChatterFixtureRegistry.fixtures.set('youtube_ss304_unboxing', {
      transcript: ytTranscript,
      media_type: 'YOUTUBE_UNBOXING_OR_REVIEW',
      total_sampled_segments: 100,
      default_claims: [
        {
          claim_id: 'claim:yt:ss202-magnet-defect',
          category: 'METALLURGY_GRADE_DEFECT',
          summary: 'Magnet test indicates SS202 manganese substitution in SS304 clamps',
          observed_defect_mention_count: 8,
          citations: [
            {
              source_artifact_sha256: ytSha256,
              start_char_offset: ytMagnetStart,
              end_char_offset: ytMagnetEnd,
              media_timestamp_seconds: 85,
              verbatim_quote: ytMagnetQuote
            }
          ]
        },
        {
          claim_id: 'claim:yt:torque-thread-failure',
          category: 'DIMENSIONAL_OR_TORQUE_FAILURE',
          summary: 'Screw thread stripped at 3.2 Nm below DIN 3017 specification',
          observed_defect_mention_count: 5,
          citations: [
            {
              source_artifact_sha256: ytSha256,
              start_char_offset: ytTorqueStart,
              end_char_offset: ytTorqueEnd,
              media_timestamp_seconds: 160,
              verbatim_quote: ytTorqueQuote
            }
          ]
        }
      ]
    });

    // 2. Amazon Buyer Customer Reviews
    const amzTranscript =
      'Buyer Review 1: After 2 weeks outdoors, the clamp bands started showing orange rust spots. Clearly not SS304 stainless steel.\nBuyer Review 2: Great clamp, holds tight on 20mm hose.\nBuyer Review 3: Only received 8 clamps in the bag instead of 10. Packaging shortfall.';
    const amzSha256 = sha256(amzTranscript);

    const amzRustQuote = 'After 2 weeks outdoors, the clamp bands started showing orange rust spots. Clearly not SS304 stainless steel.';
    const amzRustStart = amzTranscript.indexOf(amzRustQuote);
    const amzRustEnd = amzRustStart + amzRustQuote.length;

    const amzCountQuote = 'Only received 8 clamps in the bag instead of 10. Packaging shortfall.';
    const amzCountStart = amzTranscript.indexOf(amzCountQuote);
    const amzCountEnd = amzCountStart + amzCountQuote.length;

    MediaChatterFixtureRegistry.fixtures.set('amazon_buyer_reviews', {
      transcript: amzTranscript,
      media_type: 'AMAZON_BUYER_REVIEWS',
      total_sampled_segments: 50,
      default_claims: [
        {
          claim_id: 'claim:amz:outdoor-rust-ss202',
          category: 'METALLURGY_GRADE_DEFECT',
          summary: 'Outdoor orange rust spots observed after 2 weeks exposure',
          observed_defect_mention_count: 3,
          citations: [
            {
              source_artifact_sha256: amzSha256,
              start_char_offset: amzRustStart,
              end_char_offset: amzRustEnd,
              verbatim_quote: amzRustQuote
            }
          ]
        },
        {
          claim_id: 'claim:amz:packaging-shortfall-count',
          category: 'PACKAGING_COUNT_SHORTFALL',
          summary: 'Received 8 clamps instead of 10 in standard pack',
          observed_defect_mention_count: 2,
          citations: [
            {
              source_artifact_sha256: amzSha256,
              start_char_offset: amzCountStart,
              end_char_offset: amzCountEnd,
              verbatim_quote: amzCountQuote
            }
          ]
        }
      ]
    });

    // 3. Seller Central Forum Thread
    const forumTranscript =
      'Has anyone else noticed Amazon suddenly increased the FBA weight-handling fee tier on small hardware packs? Many sellers report a sharp return spike due to customer complaints about missing clamps.';
    const forumSha256 = sha256(forumTranscript);

    const forumSpikeQuote = 'Many sellers report a sharp return spike due to customer complaints about missing clamps.';
    const forumSpikeStart = forumTranscript.indexOf(forumSpikeQuote);
    const forumSpikeEnd = forumSpikeStart + forumSpikeQuote.length;

    MediaChatterFixtureRegistry.fixtures.set('seller_central_forum', {
      transcript: forumTranscript,
      media_type: 'SELLER_FORUM_THREAD',
      total_sampled_segments: 40,
      default_claims: [
        {
          claim_id: 'claim:forum:fba-return-spike',
          category: 'SELLER_FEE_OR_RETURN_SPIKE',
          summary: 'Sellers reporting sharp customer return spike on hardware packs',
          observed_defect_mention_count: 6,
          citations: [
            {
              source_artifact_sha256: forumSha256,
              start_char_offset: forumSpikeStart,
              end_char_offset: forumSpikeEnd,
              verbatim_quote: forumSpikeQuote
            }
          ]
        }
      ]
    });
  }

  public static registerFixture(id: string, fixture: RegisteredChatterFixture): void {
    this.fixtures.set(id, fixture);
  }

  public static getFixture(id: string): RegisteredChatterFixture | undefined {
    return this.fixtures.get(id);
  }
}

// ============================================================================
// 5. MCP TOOL REGISTRATION & HANDLER
// ============================================================================

export const MEDIA_CHATTER_TOOL_DESCRIPTOR: McpToolDescriptor = Object.freeze({
  name: 'mcp://media-corpus/fetch_transcript',
  description:
    'Read-only transcript fetch and verbatim citation claim extraction for approved review/unboxing media and seller forums',
  inputSchema: {
    type: 'object' as const,
    properties: {
      url: { type: 'string' },
      target_url: { type: 'string' },
      media_type: { type: 'string' },
      fixture_id: { type: 'string' },
      raw_transcript_payload: { type: 'string' },
      total_sampled_reviews_or_segments: { type: 'number' },
      candidate_claims: { type: 'array' },
      task_id: { type: 'string' },
      requested_at_utc: { type: 'string' },
      custom_commercial_status: { type: 'string' }
    },
    required: ['url']
  }
});

/**
 * Registers the read-only tool 'mcp://media-corpus/fetch_transcript' on an McpServerAdapter.
 */
export function registerMediaChatterTool(server: McpServerAdapter): void {
  server.registerTool({
    descriptor: MEDIA_CHATTER_TOOL_DESCRIPTOR,
    handler: async (args: Record<string, unknown>): Promise<McpToolCallResponse['result']> => {
      // Hardcoded Commercial Status Ceiling: Chatter worker is structurally barred from commercial offers
      const customCommercialStatus = args.custom_commercial_status as string | undefined;
      if (customCommercialStatus && customCommercialStatus !== 'NOT_APPLICABLE') {
        throw new Error(
          'E-MCW-COMMERCIAL-STATUS-FORBIDDEN: Media and chatter signals cannot carry commercial offer status.'
        );
      }

      const targetUrl = String(args.url || args.target_url);
      const mediaType = (args.media_type as ChatterMediaType) || 'YOUTUBE_UNBOXING_OR_REVIEW';
      const fixtureId = args.fixture_id as string | undefined;
      const rawPayload = args.raw_transcript_payload as string | undefined;

      let rawText = '';
      let fixtureData: RegisteredChatterFixture | undefined;
      let evidenceOriginClass: 'LIVE_VERIFIED_CAPTURE' | 'RECORDED_GOLDEN_FIXTURE' | 'CALLER_SUPPLIED_PAYLOAD' = 'RECORDED_GOLDEN_FIXTURE';
      let resolvedSourceIdentity = targetUrl;

      if (rawPayload) {
        rawText = rawPayload;
        evidenceOriginClass = 'CALLER_SUPPLIED_PAYLOAD';
        resolvedSourceIdentity = 'caller://raw_transcript_payload';
      } else if (fixtureId) {
        fixtureData = MediaChatterFixtureRegistry.getFixture(fixtureId);
        if (!fixtureData) {
          throw new Error(`E-WORKER-UNSUPPORTED-OR-UNMAPPED-SOURCE: Fixture '${fixtureId}' not found.`);
        }
        rawText = fixtureData.transcript;
        evidenceOriginClass = 'RECORDED_GOLDEN_FIXTURE';
        resolvedSourceIdentity = `fixture://${fixtureId}`;
      } else if (targetUrl.includes('youtube')) {
        fixtureData = MediaChatterFixtureRegistry.getFixture('youtube_ss304_unboxing');
        rawText = fixtureData?.transcript ?? '';
        evidenceOriginClass = 'RECORDED_GOLDEN_FIXTURE';
        resolvedSourceIdentity = 'fixture://youtube_ss304_unboxing';
      } else if (targetUrl.includes('sellercentral')) {
        fixtureData = MediaChatterFixtureRegistry.getFixture('seller_central_forum');
        rawText = fixtureData?.transcript ?? '';
        evidenceOriginClass = 'RECORDED_GOLDEN_FIXTURE';
        resolvedSourceIdentity = 'fixture://seller_central_forum';
      } else if (targetUrl.includes('amazon')) {
        fixtureData = MediaChatterFixtureRegistry.getFixture('amazon_buyer_reviews');
        rawText = fixtureData?.transcript ?? '';
        evidenceOriginClass = 'RECORDED_GOLDEN_FIXTURE';
        resolvedSourceIdentity = 'fixture://amazon_buyer_reviews';
      } else {
        throw new Error(`E-WORKER-UNSUPPORTED-OR-UNMAPPED-SOURCE: Target URL '${targetUrl}' has no mapped golden fixture and live egress is not permitted.`);
      }

      if (!rawText) {
        throw new Error(`E-WORKER-UNSUPPORTED-OR-UNMAPPED-SOURCE: No transcript available for target '${targetUrl}'.`);
      }

      // 1. Sanitize transcript stream (256KB cap, null-byte check, NFC normalize, zero-width strip)
      const {
        sanitizedText,
        rawSha256,
        sanitizedSha256
      } = sanitizeTranscript(rawText);

      // 2. Scan for prompt injection / domain state spoofing
      const canaryResult = InjectionCanaryGuard.scan(sanitizedText);
      const capturedAtUtc =
        (args.requested_at_utc as string) ||
        (args.captured_at_utc as string) ||
        '2026-10-18T00:00:00.000Z';

      if (canaryResult.quarantined) {
        const quarantinedResponse: MediaChatterMcpResponse = {
          request_id: String(args.request_id || args.task_id || `mcw-req-${sanitizedSha256.slice(0, 12)}`),
          target_url: targetUrl,
          media_type: mediaType,
          captured_at_utc: capturedAtUtc,
          extraction_version: 'mcw-transcript-sieve-v1.0.0',
          raw_payload_sha256: rawSha256,
          sanitized_payload_sha256: sanitizedSha256,
          status: 'QUARANTINED_INJECTION',
          error_code: 'E-MCW-PROMPT-INJECTION-DETECTED',
          error_reason: `Transcript quarantined due to prompt injection flags: [${canaryResult.flags.join(', ')}].`,
          claims: Object.freeze([]),
          evidence_envelope: Object.freeze({
            evidence_kind: 'OBSERVED_FACT',
            verification_status: 'UNVERIFIED',
            commercial_status: 'NOT_APPLICABLE',
            provenance_lineage: Object.freeze({
              source_id: targetUrl,
              observed_at_utc: capturedAtUtc,
              ttl_seconds: 604800,
              raw_sha256: rawSha256,
              sanitized_sha256: sanitizedSha256,
              extractor_version: 'mcw-transcript-sieve-v1.0.0'
            })
          })
        };

        const serializedQuarantine = canonicalizeJCS(sanitizeForJcs(quarantinedResponse));
        return {
          content: [
            {
              type: 'text',
              text: serializedQuarantine
            }
          ],
          tokens_used: Math.ceil(sanitizedText.length / 4)
        };
      }

      // 3. Resolve sample size & candidate claims
      const totalSampled =
        typeof args.total_sampled_reviews_or_segments === 'number'
          ? args.total_sampled_reviews_or_segments
          : (fixtureData?.total_sampled_segments ?? 100);

      if (totalSampled <= 0) {
        const insufficientResponse: MediaChatterMcpResponse = {
          request_id: String(args.request_id || args.task_id || `mcw-req-${sanitizedSha256.slice(0, 12)}`),
          target_url: targetUrl,
          media_type: mediaType,
          captured_at_utc: capturedAtUtc,
          extraction_version: 'mcw-transcript-sieve-v1.0.0',
          raw_payload_sha256: rawSha256,
          sanitized_payload_sha256: sanitizedSha256,
          status: 'DATA_INSUFFICIENT',
          error_code: 'E-MCW-ZERO-SAMPLE-SIZE',
          error_reason: `Total sampled reviews or segments must be greater than 0, received ${totalSampled}.`,
          claims: Object.freeze([]),
          evidence_envelope: Object.freeze({
            evidence_kind: 'OBSERVED_FACT',
            verification_status: 'UNVERIFIED',
            commercial_status: 'NOT_APPLICABLE',
            provenance_lineage: Object.freeze({
              source_id: targetUrl,
              observed_at_utc: capturedAtUtc,
              ttl_seconds: 604800,
              raw_sha256: rawSha256,
              sanitized_sha256: sanitizedSha256,
              extractor_version: 'mcw-transcript-sieve-v1.0.0'
            })
          })
        };

        const serializedInsufficient = canonicalizeJCS(sanitizeForJcs(insufficientResponse));
        return {
          content: [
            {
              type: 'text',
              text: serializedInsufficient
            }
          ],
          tokens_used: Math.ceil(sanitizedText.length / 4)
        };
      }

      const rawCandidateClaims = (args.candidate_claims as readonly MediaChatterCandidateClaimInput[] | undefined) ||
        fixtureData?.default_claims ||
        [];

      // 4. Validate verbatim citations and compute empirical defect rates
      const validatedClaims: ExtractedChatterClaim[] = [];

      for (const candidate of rawCandidateClaims) {
        // Enforce citation count requirement
        if (!candidate.citations || candidate.citations.length === 0) {
          throw new Error(
            `E-MCW-UNCITED-CLAIM-REJECTED: Claim '${candidate.claim_id}' has 0 citations; all claims require >= 1 verbatim citation span.`
          );
        }

        // Validate each citation span against sanitized transcript
        for (const citation of candidate.citations) {
          verifyVerbatimCitationSpan(sanitizedText, citation, sanitizedSha256);
        }

        const defectRateBps = Math.floor((candidate.observed_defect_mention_count * 10000) / totalSampled);
        const primaryCitation = candidate.citations[0];
        const spotlightNonce = sha256(`${sanitizedSha256}:${candidate.claim_id}:${primaryCitation.start_char_offset}`).slice(0, 32);
        const spotlightedQuote = createSpotlightContainer(primaryCitation.verbatim_quote, spotlightNonce);

        validatedClaims.push({
          claim_id: candidate.claim_id,
          category: candidate.category,
          summary: candidate.summary,
          observed_defect_mention_count: candidate.observed_defect_mention_count,
          total_sampled_reviews_or_segments: totalSampled,
          observed_defect_rate_bps: defectRateBps,
          citations: Object.freeze([...candidate.citations]),
          spotlighted_quote: spotlightedQuote
        });
      }

      // 5. Build authoritative response payload
      const responsePayload: MediaChatterMcpResponse = {
        request_id: String(args.request_id || args.task_id || `mcw-req-${sanitizedSha256.slice(0, 12)}`),
        target_url: targetUrl,
        media_type: mediaType,
        captured_at_utc: capturedAtUtc,
        extraction_version: 'mcw-transcript-sieve-v1.0.0',
        raw_payload_sha256: rawSha256,
        sanitized_payload_sha256: sanitizedSha256,
        status: 'EXTRACTED',
        claims: Object.freeze(validatedClaims),
        evidence_envelope: Object.freeze({
          evidence_kind: 'OBSERVED_FACT',
          verification_status: 'UNVERIFIED',
          commercial_status: 'NOT_APPLICABLE',
          provenance_lineage: Object.freeze({
            source_id: targetUrl,
            requested_url: targetUrl,
            resolved_source_identity: resolvedSourceIdentity,
            evidence_origin_class: evidenceOriginClass,
            observed_at_utc: capturedAtUtc,
            ttl_seconds: 604800,
            raw_sha256: rawSha256,
            sanitized_sha256: sanitizedSha256,
            extractor_version: 'mcw-transcript-sieve-v1.0.0'
          })
        })
      };

      const serialized = canonicalizeJCS(sanitizeForJcs(responsePayload));
      const tokensUsed = Math.ceil(sanitizedText.length / 4);

      return {
        content: [
          {
            type: 'text',
            text: serialized
          }
        ],
        tokens_used: tokensUsed
      };
    }
  });
}

// ============================================================================
// 6. MEDIA AND CHATTER WORKER
// ============================================================================

export class MediaAndChatterWorker {
  public static readonly WORKER_ID = 'worker:media-chatter:v1';
  private readonly broker: McpCapabilityBroker;
  private readonly defaultGrant?: CapabilityGrant;

  constructor(broker: McpCapabilityBroker, defaultGrant?: CapabilityGrant) {
    this.broker = broker;
    this.defaultGrant = defaultGrant;
  }

  public getBroker(): McpCapabilityBroker {
    return this.broker;
  }

  public async fetchAndExtract(
    request: MediaChatterMcpRequest,
    customGrant?: CapabilityGrant
  ): Promise<MediaChatterMcpResponse> {
    const grant = customGrant ?? this.defaultGrant;
    if (!grant) {
      throw new Error('E-MCW-NO-GRANT: No CapabilityGrant provided for MediaAndChatterWorker execution.');
    }

    // Verify commercial status ceiling before dispatch
    if (
      request.custom_commercial_status &&
      request.custom_commercial_status !== 'NOT_APPLICABLE'
    ) {
      throw new Error(
        'E-MCW-COMMERCIAL-STATUS-FORBIDDEN: Media and chatter signals cannot carry commercial offer status.'
      );
    }

    const toolCallRequest: McpToolCallRequest = {
      jsonrpc: '2.0',
      id: request.task_id,
      method: 'tools/call',
      params: {
        name: 'mcp://media-corpus/fetch_transcript',
        arguments: {
          url: request.target_url,
          target_url: request.target_url,
          media_type: request.media_type,
          fixture_id: request.fixture_id,
          raw_transcript_payload: request.raw_transcript_payload,
          total_sampled_reviews_or_segments: request.total_sampled_reviews_or_segments,
          candidate_claims: request.candidate_claims,
          task_id: request.task_id,
          requested_at_utc: request.requested_at_utc,
          custom_commercial_status: request.custom_commercial_status
        }
      }
    };

    const toolCallResponse = await this.broker.invokeTool(grant, toolCallRequest);

    if (toolCallResponse.error) {
      throw new Error(toolCallResponse.error.message);
    }

    const contentItem = toolCallResponse.result?.content?.[0];
    if (!contentItem || !contentItem.text) {
      throw new Error('E-MCW-EMPTY-RESPONSE: Tool call returned empty result content.');
    }

    const parsed: MediaChatterMcpResponse = JSON.parse(contentItem.text);
    return deepFreeze(parsed);
  }
}
