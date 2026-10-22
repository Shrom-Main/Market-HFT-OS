/**
 * POC-001: Review & Grievance Miner
 * Gate Slice 4 / Decision OD-28 & Slice 5 / Decision OD-29
 *
 * Deterministic, category-agnostic review and discussion analysis.
 * Extracts:
 * 1. ExtractedCustomerProblem[] — Detailed defect clusters with sample denominator, severity,
 *    willingness-to-pay, bias flags, and verified verbatim character citation spans.
 * 2. ExtractedIncumbentStrength[] — Positive features valued by customers that product redesign
 *    must preserve, with verified character spans.
 *
 * Epistemic Rules:
 * - Customer complaints remain classified as 'CUSTOMER_ALLEGATION' until corroborated by
 *   'MEASURED_RESULT' or 'VERIFIED_TECHNICAL_FINDING'.
 * - Technical / industrial failure reports are weighted higher than unverified comments.
 * - Sample denominator is mandatory (never omitted).
 * - Every citation span [start, end] strictly satisfies sourceText.slice(start, end) === verbatimQuote.
 * - ZERO SYNTHETIC REVIEWS: When no review corpus or source artifact exists, return an explicit
 *   evidence gap (DATA_REQUIRED) and no review-derived claim. Never construct synthetic review strings.
 * - ZERO INVENTED WTP: Do not invent arbitrary WTP percentages; mark as unobserved unless supported.
 */

import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sanitizeForJcs } from '../agents/m6AgentFramework.js';
import type { ProductObservationItem } from '../mcp/contracts/productObservationContract.js';

// ============================================================================
// 1. DATA CONTRACTS
// ============================================================================

export type ReviewFailureSeverity = 'COSMETIC' | 'REPLACEMENT_REQUIRED' | 'OPERATIONAL_FAILURE';

export type ReviewSourceBias =
  | 'NONE_DETECTED'
  | 'SELECTION_BIAS_RISK'
  | 'INCENTIVIZED_REVIEW_SUSPECTED'
  | 'UNVERIFIED_ALLEGATION';

export type EvidenceWeight =
  | 'ANECDOTAL_REVIEW'
  | 'AGGREGATED_FIELD_FEEDBACK'
  | 'TECHNICAL_LAB_FINDING';

export interface EmotionalSentimentDimension {
  readonly sentiment_polarity: 'HIGHLY_NEGATIVE' | 'NEGATIVE' | 'MIXED_FRUSTRATED' | 'NEUTRAL';
  readonly frustration_severity: 'EXTREME' | 'HIGH' | 'MODERATE' | 'LOW';
  readonly urgency_score_bps: number; // e.g. 8500 = 85.00%
  readonly emotional_keywords_detected: readonly string[];
}

export interface ExtractedCustomerProblem {
  readonly problem_id: string;
  readonly product_id: string;
  readonly source_id: string; // Preserves authentic source_id of the review
  readonly problem_category: string;
  readonly problem_statement: string;
  readonly application_context: string;
  readonly failure_severity: ReviewFailureSeverity;
  readonly emotional_sentiment?: EmotionalSentimentDimension;
  readonly failure_frequency_count: number;
  readonly sample_denominator: number;
  readonly root_cause_candidate: string;
  readonly current_workaround: string;
  readonly switching_trigger: string;
  readonly willingness_to_pay_evidence: string;
  readonly source_bias: ReviewSourceBias;
  readonly citation_span: [number, number];
  readonly verbatim_quote: string;
  readonly quote_sha256?: string;
  readonly epistemic_class: 'CUSTOMER_ALLEGATION' | 'MEASURED_RESULT';
  readonly evidence_weight: EvidenceWeight;
}

export interface ExtractedIncumbentStrength {
  readonly strength_id: string;
  readonly product_id: string;
  readonly feature_name: string;
  readonly feature_description: string;
  readonly preservation_priority: 'CRITICAL' | 'DESIRABLE' | 'SECONDARY';
  readonly citation_span: [number, number];
  readonly verbatim_quote: string;
  readonly quote_sha256?: string;
  readonly sentiment_frequency_count: number;
  readonly sample_denominator: number;
}

export interface ReviewCorpusItem {
  readonly text: string;
  readonly source_id: string;
  readonly source_type?: 'MARKETPLACE_REVIEW' | 'TECHNICAL_FORUM' | 'LAB_TEST_REPORT' | 'FIELD_LOG';
  readonly captured_at_utc?: string;
  readonly rating?: number;
}

export interface MinedReviewAnalysisResult {
  readonly product_id: string;
  readonly analyzed_at_utc: string;
  readonly customer_problems: readonly ExtractedCustomerProblem[];
  readonly incumbent_strengths: readonly ExtractedIncumbentStrength[];
  readonly total_reviews_analyzed: number;
  readonly overall_negative_review_pct: number;
  readonly unserved_pain_points: readonly string[];
  readonly jcs_sha256: string;
}

// ============================================================================
// 2. VERBATIM CITATION SPAN & GROUNDING VERIFICATION
// ============================================================================

export interface CitationValidationDetails {
  readonly isValid: boolean;
  readonly failure_reason?:
    | 'SOURCE_TEXT_MISSING'
    | 'INVALID_SPAN_STRUCTURE'
    | 'SPAN_OUT_OF_BOUNDS'
    | 'EMPTY_QUOTE'
    | 'SPAN_TEXT_MISMATCH'
    | 'QUOTE_HASH_MISMATCH'
    | 'UNICODE_CORRUPTION_DETECTED';
  readonly extracted_text?: string;
  readonly expected_hash?: string;
  readonly actual_hash?: string;
}

/**
 * Validates citation grounding against adversarial vectors:
 * - Missing source text
 * - Invalid span types or inverted/out-of-bounds indices
 * - Empty verbatim quotes
 * - Mismatches between extracted span text and claimed quote
 * - Mismatches between claimed quote SHA-256 and computed hash
 * - Unicode surrogate corruption (bisecting emoji surrogate pairs)
 */
export function validateCitationGrounding(params: {
  sourceText: string;
  span: [number, number];
  verbatimQuote: string;
  quoteHash?: string;
}): CitationValidationDetails {
  const { sourceText, span, verbatimQuote, quoteHash } = params;

  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    return { isValid: false, failure_reason: 'SOURCE_TEXT_MISSING' };
  }

  if (
    !Array.isArray(span) ||
    span.length !== 2 ||
    typeof span[0] !== 'number' ||
    typeof span[1] !== 'number' ||
    !Number.isInteger(span[0]) ||
    !Number.isInteger(span[1])
  ) {
    return { isValid: false, failure_reason: 'INVALID_SPAN_STRUCTURE' };
  }

  const [start, end] = span;
  if (start < 0 || end > sourceText.length || start >= end) {
    return { isValid: false, failure_reason: 'SPAN_OUT_OF_BOUNDS' };
  }

  if (typeof verbatimQuote !== 'string' || verbatimQuote.length === 0) {
    return { isValid: false, failure_reason: 'EMPTY_QUOTE' };
  }

  // Unicode integrity: ensure span boundaries do not bisect a UTF-16 surrogate pair
  // High surrogate: 0xD800 - 0xDBFF, Low surrogate: 0xDC00 - 0xDFFF
  if (start > 0) {
    const prevCode = sourceText.charCodeAt(start - 1);
    const currCode = sourceText.charCodeAt(start);
    if (prevCode >= 0xD800 && prevCode <= 0xDBFF && currCode >= 0xDC00 && currCode <= 0xDFFF) {
      return { isValid: false, failure_reason: 'UNICODE_CORRUPTION_DETECTED' };
    }
  }
  if (end < sourceText.length) {
    const prevCode = sourceText.charCodeAt(end - 1);
    const nextCode = sourceText.charCodeAt(end);
    if (prevCode >= 0xD800 && prevCode <= 0xDBFF && nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
      return { isValid: false, failure_reason: 'UNICODE_CORRUPTION_DETECTED' };
    }
  }

  const extracted = sourceText.slice(start, end);
  if (extracted !== verbatimQuote) {
    return {
      isValid: false,
      failure_reason: 'SPAN_TEXT_MISMATCH',
      extracted_text: extracted
    };
  }

  const actualHash = sha256(verbatimQuote);
  if (quoteHash && actualHash !== quoteHash) {
    return {
      isValid: false,
      failure_reason: 'QUOTE_HASH_MISMATCH',
      expected_hash: quoteHash,
      actual_hash: actualHash,
      extracted_text: extracted
    };
  }

  return {
    isValid: true,
    extracted_text: extracted,
    actual_hash: actualHash
  };
}

/**
 * Validates that a citation span strictly slices the source text to the expected verbatim quote.
 */
export function verifyCitationSpan(
  sourceText: string,
  span: [number, number],
  expectedQuote: string,
  expectedHash?: string
): boolean {
  return validateCitationGrounding({
    sourceText,
    span,
    verbatimQuote: expectedQuote,
    quoteHash: expectedHash
  }).isValid;
}

export function classifyEmotionalSentiment(
  text: string,
  severity: ReviewFailureSeverity
): EmotionalSentimentDimension {
  const lower = text.toLowerCase();
  const extremeWords = ['disaster', 'nightmare', 'furious', 'hazardous', 'fire hazard', 'ruined', 'burst', 'shattered', 'scandalous', 'cheated'];
  const highWords = ['awful', 'terrible', 'horrible', 'waste of money', 'unusable', 'garbage', 'useless', 'broke immediately', 'flooded', 'leaking everywhere'];
  const moderateWords = ['poor', 'disappointed', 'loose', 'cracked', 'dripping', 'stripped', 'snapped', 'defect', 'substandard'];

  const detected: string[] = [];
  let extremeMatches = 0;
  let highMatches = 0;
  let modMatches = 0;

  for (const w of extremeWords) {
    if (lower.includes(w)) {
      extremeMatches++;
      detected.push(w);
    }
  }
  for (const w of highWords) {
    if (lower.includes(w)) {
      highMatches++;
      detected.push(w);
    }
  }
  for (const w of moderateWords) {
    if (lower.includes(w)) {
      modMatches++;
      detected.push(w);
    }
  }

  let frustrationSeverity: EmotionalSentimentDimension['frustration_severity'] = 'LOW';
  let polarity: EmotionalSentimentDimension['sentiment_polarity'] = 'NEGATIVE';
  let urgencyBps = 4000;

  if (extremeMatches > 0 || severity === 'OPERATIONAL_FAILURE') {
    frustrationSeverity = extremeMatches > 0 ? 'EXTREME' : 'HIGH';
    polarity = 'HIGHLY_NEGATIVE';
    urgencyBps = extremeMatches > 0 ? 9200 : 8000;
  } else if (highMatches > 0 || severity === 'REPLACEMENT_REQUIRED') {
    frustrationSeverity = 'HIGH';
    polarity = 'HIGHLY_NEGATIVE';
    urgencyBps = 7500;
  } else if (modMatches > 0) {
    frustrationSeverity = 'MODERATE';
    polarity = 'MIXED_FRUSTRATED';
    urgencyBps = 5500;
  }

  return {
    sentiment_polarity: polarity,
    frustration_severity: frustrationSeverity,
    urgency_score_bps: urgencyBps,
    emotional_keywords_detected: detected
  };
}

// ============================================================================
// 3. REVIEW AND GRIEVANCE MINER
// ============================================================================

export class ReviewAndGrievanceMiner {
  /**
   * Mines positive and negative themes deterministically across authentic captured review text.
   */
  public static mineReviews(params: {
    product: ProductObservationItem;
    reviewCorpus?: readonly ReviewCorpusItem[];
    capturedEvidence?: readonly any[];
    asOfUtc?: string;
  }): MinedReviewAnalysisResult {
    const { product } = params;
    const nowUtc = params.asOfUtc || new Date().toISOString();

    const problems: ExtractedCustomerProblem[] = [];
    const strengths: ExtractedIncumbentStrength[] = [];

    // Assemble authentic corpus items: explicit reviewCorpus plus any real captured evidence artifacts
    const allCorpusItems: ReviewCorpusItem[] = [
      ...(params.reviewCorpus || [])
    ];

    if (params.capturedEvidence) {
      for (const ev of params.capturedEvidence) {
        if (ev.channel === 'BUYER_REVIEWS' || ev.channel === 'MEDIA_CHATTER') {
          if (ev.raw_payload && typeof ev.raw_payload === 'string') {
            allCorpusItems.push({
              text: ev.raw_payload,
              source_id: ev.evidence_id || ev.origin?.source_url || 'captured:review:evidence',
              source_type: ev.channel === 'BUYER_REVIEWS' ? 'MARKETPLACE_REVIEW' : 'TECHNICAL_FORUM',
              captured_at_utc: ev.observed_at_utc
            });
          }
        }
      }
    }

    // RULE: If no empirical review corpus or source artifact exists, return an explicit evidence gap
    // and no review-derived claim. Never construct synthetic 'review' text or citation spans from product summaries.
    if (allCorpusItems.length === 0) {
      const rawResult: Omit<MinedReviewAnalysisResult, 'jcs_sha256'> = {
        product_id: product.product_id,
        analyzed_at_utc: nowUtc,
        customer_problems: [],
        incumbent_strengths: [],
        total_reviews_analyzed: 0,
        overall_negative_review_pct: 0,
        unserved_pain_points: [
          `No empirical review corpus or customer feedback transcript captured for product "${product.product_id}" (DATA_REQUIRED).`
        ]
      };
      const jcsSha256 = sha256(canonicalizeJCS(sanitizeForJcs(rawResult)));
      return {
        ...rawResult,
        jcs_sha256: jcsSha256
      };
    }

    const totalItems = allCorpusItems.length;
    let negativeCount = 0;

    for (let idx = 0; idx < allCorpusItems.length; idx++) {
      const item = allCorpusItems[idx];
      const text = item.text;
      const sourceType = item.source_type || 'MARKETPLACE_REVIEW';
      const evidenceWeight: EvidenceWeight =
        sourceType === 'LAB_TEST_REPORT'
          ? 'TECHNICAL_LAB_FINDING'
          : (sourceType === 'FIELD_LOG' ? 'AGGREGATED_FIELD_FEEDBACK' : 'ANECDOTAL_REVIEW');

      // Mine negative issues
      const issuePatterns: {
        category: string;
        regex: RegExp;
        severity: ReviewFailureSeverity;
        rootCause: string;
        workaround: string;
        trigger: string;
      }[] = [
        {
          category: 'CORROSION_AND_RUST',
          regex: /(rust(?:ed|ing)?\s+after\s+\w+|corrod(?:ed|ing)|surface\s+oxidation|magnetic\s+impurit\w+)/i,
          severity: 'OPERATIONAL_FAILURE',
          rootCause: 'Sub-standard stainless metallurgy or lack of passivation treatment',
          workaround: 'Coating with protective grease or frequent manual replacement',
          trigger: 'Visible rust marks during routine inspection or equipment leak'
        },
        {
          category: 'TRANSIT_BREAKAGE',
          regex: /(shatter(?:ed)?\s+in\s+transit|broken\s+pieces|cracked\s+on\s+arrival|poor\s+bubble\s+wrap)/i,
          severity: 'REPLACEMENT_REQUIRED',
          rootCause: 'Insufficient packaging dampening for fragile ceramic/terracotta',
          workaround: 'Ordering excess backup units to cover transit breakage loss',
          trigger: 'Unusable broken goods upon delivery during festival deadline'
        },
        {
          category: 'VALVE_MECHANICAL_AND_LEAK',
          regex: /(handle\s+broke|snapped\s+off|brittle\s+cast|thread\s+leak(?:age)?|pinhole\s+porosity|pressure\s+drop|seepage\s+at\s+joint|dripping|leaked|stripped.*threads?)/i,
          severity: 'OPERATIONAL_FAILURE',
          rootCause: 'Brittle handle metallurgy or stem packing seal defect under pressure',
          workaround: 'Using pliers/vice grips or excessive PTFE tape wrap',
          trigger: 'Broken handle or continuous drip under water line pressure'
        },
        {
          category: 'WAX_TUNNELING_AND_SOOT',
          regex: /(tunnel(?:ing)?\s+down\s+the\s+center|excessive\s+soot|black\s+smoke|weak\s+scent\s+throw)/i,
          severity: 'COSMETIC',
          rootCause: 'Mismatched wick diameter and uncalibrated fragrance oil load',
          workaround: 'Tin foil tenting around candle rim to pool wax manually',
          trigger: 'Wasted half of candle wax with uneven burn and smoky residue'
        },
        {
          category: 'MECHANICAL_WEAR_AND_STRIP',
          regex: /(worm\s+drive\s+stripped|screw\s+head\s+rounded|clamp\s+loosens|band\s+snapped)/i,
          severity: 'OPERATIONAL_FAILURE',
          rootCause: 'Low shear yield strength and unhardened screw casing',
          workaround: 'Manual under-torquing or double-clamping',
          trigger: 'Hose slip or pressure rupture during high-load pump cycle'
        }
      ];

      let itemHasComplaint = false;
      for (const pattern of issuePatterns) {
        const match = text.match(pattern.regex);
        if (match && match.index !== undefined) {
          itemHasComplaint = true;
          const quote = match[0];
          const startOffset = match.index;
          const endOffset = startOffset + quote.length;

          // Verify verbatim citation span
          if (verifyCitationSpan(text, [startOffset, endOffset], quote)) {
            const probId = `PRB-${sha256(`${product.product_id}:${pattern.category}:${quote}:${idx}`).slice(0, 10).toUpperCase()}`;
            problems.push({
              problem_id: probId,
              product_id: product.product_id,
              source_id: item.source_id,
              problem_category: pattern.category,
              problem_statement: `Customer reported ${pattern.category.toLowerCase().replace(/_/g, ' ')}: "${quote}"`,
              application_context: `Application under ${product.category} usage environment`,
              failure_severity: pattern.severity,
              emotional_sentiment: classifyEmotionalSentiment(quote, pattern.severity),
              failure_frequency_count: 1,
              sample_denominator: totalItems,
              root_cause_candidate: pattern.rootCause,
              current_workaround: pattern.workaround,
              switching_trigger: pattern.trigger,
              willingness_to_pay_evidence: 'UNOBSERVED_IN_REVIEW_CORPUS: Buyer willingness to pay is unobserved in public review text (requires formal willingness-to-pay conjoint survey)',
              source_bias: item.rating && item.rating <= 2 ? 'SELECTION_BIAS_RISK' : 'NONE_DETECTED',
              citation_span: [startOffset, endOffset],
              verbatim_quote: quote,
              quote_sha256: sha256(quote),
              epistemic_class: sourceType === 'LAB_TEST_REPORT' ? 'MEASURED_RESULT' : 'CUSTOMER_ALLEGATION',
              evidence_weight: evidenceWeight
            });
          }
        }
      }

      // If text didn't match the 5 specific regexes, check if it contains other clear defect phrases (support up to 2,000 characters)
      if (!itemHasComplaint && text.length >= 10 && text.length <= 2000) {
        const genericMatch = text.match(/(leak|defect|break|broke|broken|shatter|stripped|crack|rust|fail|poor|damage|snapped|snap|dripping|drip|loose)/i);
        if (genericMatch) {
          const quote = text;
          const startOffset = 0;
          const endOffset = text.length;
          if (verifyCitationSpan(text, [startOffset, endOffset], quote)) {
            itemHasComplaint = true;
            problems.push({
              problem_id: `PRB-${sha256(`${product.product_id}:grievance:${quote}:${idx}`).slice(0, 10).toUpperCase()}`,
              product_id: product.product_id,
              source_id: item.source_id,
              problem_category: 'CUSTOMER_REPORTED_GRIEVANCE',
              problem_statement: `Customer reported grievance: "${quote}"`,
              application_context: `Operational use of ${product.name}`,
              failure_severity: 'OPERATIONAL_FAILURE',
              emotional_sentiment: classifyEmotionalSentiment(quote, 'OPERATIONAL_FAILURE'),
              failure_frequency_count: 1,
              sample_denominator: totalItems,
              root_cause_candidate: 'Operational defect observed in captured source artifact',
              current_workaround: 'Manual sorting and replacement',
              switching_trigger: 'Recurring product defect',
              willingness_to_pay_evidence: 'UNOBSERVED_IN_REVIEW_CORPUS: Buyer willingness to pay is unobserved in public review text',
              source_bias: 'UNVERIFIED_ALLEGATION',
              citation_span: [startOffset, endOffset],
              verbatim_quote: quote,
              quote_sha256: sha256(quote),
              epistemic_class: sourceType === 'LAB_TEST_REPORT' ? 'MEASURED_RESULT' : 'CUSTOMER_ALLEGATION',
              evidence_weight: evidenceWeight
            });
          }
        }
      }

      if (itemHasComplaint || (item.rating && item.rating <= 2)) {
        negativeCount++;
      }

      // Mine positive incumbent strengths
      const strengthPatterns: {
        name: string;
        regex: RegExp;
        priority: 'CRITICAL' | 'DESIRABLE' | 'SECONDARY';
        description: string;
      }[] = [
        {
          name: 'Fast Reliable Delivery',
          regex: /(delivered\s+very\s+fast|quick\s+prime\s+shipping|next\s+day\s+delivery|prompt\s+dispatch)/i,
          priority: 'CRITICAL',
          description: 'Timely fulfillment for seasonal deadlines; retain existing fulfillment logistics.'
        },
        {
          name: 'Traditional Festive Aesthetics',
          regex: /(traditional\s+terracotta\s+finish|festive\s+look|beautiful\s+handcrafted|authentic\s+clay)/i,
          priority: 'CRITICAL',
          description: 'Aesthetic appeal drives high conversion; retain traditional hand-crafted clay styling.'
        },
        {
          name: 'Solid Forged Brass Body',
          regex: /(solid\s+brass|heavy\s+duty\s+casting|substantial\s+metal|heavier\s+than\s+competition)/i,
          priority: 'CRITICAL',
          description: 'Heavy metal weight creates perception of durability; preserve solid brass material basis.'
        },
        {
          name: 'Pleasant Fragrance Throw',
          regex: /(natural\s+soy\s+scent|calming\s+aroma|great\s+scent\s+throw|relaxing\s+lavender)/i,
          priority: 'DESIRABLE',
          description: 'Aromatherapy profile well-received; retain pure essential oil blend.'
        },
        {
          name: 'Reusable Packaging Box',
          regex: /(sturdy\s+storage\s+box|convenient\s+carry\s+case|reusable\s+plastic\s+container)/i,
          priority: 'SECONDARY',
          description: 'Pack offer packaging doubles as organizer; retain convenient packaging format.'
        }
      ];

      for (const sp of strengthPatterns) {
        const match = text.match(sp.regex);
        if (match && match.index !== undefined) {
          const quote = match[0];
          const startOffset = match.index;
          const endOffset = startOffset + quote.length;

          if (verifyCitationSpan(text, [startOffset, endOffset], quote)) {
            const strId = `STR-${sha256(`${product.product_id}:${sp.name}:${quote}:${idx}`).slice(0, 10).toUpperCase()}`;
            strengths.push({
              strength_id: strId,
              product_id: product.product_id,
              feature_name: sp.name,
              feature_description: sp.description,
              preservation_priority: sp.priority,
              citation_span: [startOffset, endOffset],
              verbatim_quote: quote,
              quote_sha256: sha256(quote),
              sentiment_frequency_count: 1,
              sample_denominator: totalItems
            });
          }
        }
      }
    }

    const negativePct = totalItems > 0 ? Math.round((negativeCount / totalItems) * 100) : 0;
    const unservedPainPoints = problems.length > 0
      ? Array.from(new Set(problems.map((p) => p.problem_statement)))
      : [`No empirical customer grievances mined from ${totalItems} captured reviews.`];

    const rawResult: Omit<MinedReviewAnalysisResult, 'jcs_sha256'> = {
      product_id: product.product_id,
      analyzed_at_utc: nowUtc,
      customer_problems: problems,
      incumbent_strengths: strengths,
      total_reviews_analyzed: totalItems,
      overall_negative_review_pct: negativePct,
      unserved_pain_points: unservedPainPoints
    };

    const jcsSha256 = sha256(canonicalizeJCS(sanitizeForJcs(rawResult)));
    return {
      ...rawResult,
      jcs_sha256: jcsSha256
    };
  }
}
