/**
 * Market HFT OS — Micro-Agent #1: SourceCaptureWorker (Stage 2)
 *
 * Implements:
 * 1. Strict MCP Broker Routing:
 *    - Worker ID: 'worker:source-capture:v1'
 *    - No direct access to fetch, http, or fs
 *    - Invokes 'mcp://source-capture/http_get_snapshot' via McpCapabilityBroker
 * 2. 6-Layer DOM Sanitization Sieve (sanitizeHtmlDomSieve):
 *    - Layer 1: Byte-stream & encoding gate (512KB cap, null-byte rejection, raw SHA-256)
 *    - Layer 2: Executable & active tag purge (<script>, <style>, <iframe>, <form>, etc., on* handlers)
 *    - Layer 3: Anti-cloaking & invisible element purge (hidden, aria-hidden, display:none, opacity:0, comments)
 *    - Layer 4: Attribute allowlisting (id, class, data-asin, data-sku, data-price, data-moq, itemprop, href)
 *    - Layer 5: Unicode NFC & confusable homograph normalization (strip zero-width, detect homographs)
 *    - Layer 6: Canonical DOM serialization & sanitized SHA-256 digest
 * 3. 4-Layer Prompt-Injection & Canary Defense (InjectionCanaryGuard):
 *    - Zero-LLM deterministic numeric extraction (BigInt subunits, no ₹0 substitution)
 *    - Lexical & domain-spoofing canary scanner
 *    - Hardcoded status ceiling (UNVERIFIED, ADVERTISED_LISTING / SUPPLIER_QUOTE)
 *    - Cryptographic spotlighting container (<untrusted_dom_field_${nonce}>)
 * 4. Recorded Fixture Store & Live HTTPS Get replay support
 */

import { randomBytes } from 'crypto';
import { sha256 } from '../../canonical/crypto.js';
import { canonicalizeJCS } from '../../canonical/jcs.js';
import { sanitizeForJcs } from '../m6AgentFramework.js';
import {
  McpCapabilityBroker,
  McpServerAdapter,
  McpToolDescriptor,
  McpToolDefinition,
  McpToolCallRequest,
  McpToolCallResponse,
  CapabilityGrant,
  createCapabilityGrant,
  ConstrainedHttpsConnector
} from '../../mcp/mcpSubstrate.js';
import { deepFreeze } from '../../verification/gate.js';

// ============================================================================
// 1. TOOL POLICY & CONTRACT TYPES
// ============================================================================

export interface SourceCaptureToolPolicy {
  readonly tool_id: 'mcp://source-capture/http_get_snapshot';
  readonly allowed_methods: readonly ['GET'];
  readonly allowed_schemes: readonly ['https'];
  readonly allowed_hosts: readonly [
    'www.amazon.in',
    'dir.indiamart.com',
    'www.indiamart.com',
    'gem.gov.in'
  ];
  readonly allow_redirects: false;
  readonly block_private_and_loopback_ips: true;
  readonly allowed_content_types: readonly ['text/html', 'application/xhtml+xml'];
  readonly max_payload_bytes: 524288;
  readonly max_latency_ms: 5000;
  readonly max_requests_per_task: 2;
}

export const SOURCE_CAPTURE_TOOL_POLICY: SourceCaptureToolPolicy = Object.freeze({
  tool_id: 'mcp://source-capture/http_get_snapshot',
  allowed_methods: Object.freeze(['GET'] as const),
  allowed_schemes: Object.freeze(['https'] as const),
  allowed_hosts: Object.freeze([
    'www.amazon.in',
    'dir.indiamart.com',
    'www.indiamart.com',
    'gem.gov.in'
  ] as const),
  allow_redirects: false,
  block_private_and_loopback_ips: true,
  allowed_content_types: Object.freeze(['text/html', 'application/xhtml+xml'] as const),
  max_payload_bytes: 524288,
  max_latency_ms: 5000,
  max_requests_per_task: 2
});

export type SourceProfileId =
  | 'AMAZON_IN_PRODUCT_LISTING'
  | 'INDIAMART_SUPPLIER_LISTING'
  | 'HOWRAH_B2B_DISTRIBUTOR_CATALOG';

export type CaptureExecutionMode =
  | 'RECORDED_FIXTURE_REPLAY'
  | 'APPROVED_LIVE_HTTPS_GET';

export interface PriceBracketTier {
  readonly min_qty: number;
  readonly max_qty: number | null; // null represents open-ended '500+' bracket
  readonly unit_price_subunits: string; // Canonical BigInt string (e.g., '250000' = ₹25.0000)
}

export type ExpectedFieldType =
  | 'SUBUNITS_INR'
  | 'TIERED_SUBUNITS_INR'
  | 'POSITIVE_INT'
  | 'ENUM_STRING'
  | 'HSN_CODE';

export interface ExtractionSelectorRule {
  readonly field_name: string;
  readonly selector: string;
  readonly expected_type: ExpectedFieldType;
  readonly is_mandatory: boolean;
}

export interface SourceCaptureMcpRequest {
  readonly task_id: string;
  readonly worker_id: 'worker:source-capture:v1';
  readonly target_url: string;
  readonly source_profile: SourceProfileId;
  readonly execution_mode: CaptureExecutionMode;
  readonly target_batch_quantity?: number; // Required when extracting TIERED_SUBUNITS_INR
  readonly fixture_id?: string;
  readonly raw_html_payload?: string;
  readonly extraction_rules?: readonly ExtractionSelectorRule[];
  readonly requested_at_utc: string;
  readonly custom_commercial_status?: 'ADVERTISED_LISTING' | 'SUPPLIER_QUOTE';
}

export type FieldExtractionOutcome =
  | {
      readonly status: 'EXTRACTED';
      readonly raw_sanitized_text: string;
      readonly normalized_value: string;
      readonly unit: 'SUBUNITS_INR' | 'UNITS' | 'DAYS' | 'STRING';
      readonly matched_selector: string;
      readonly matched_tier?: PriceBracketTier;
      readonly observed_tiers?: readonly PriceBracketTier[];
    }
  | {
      readonly status: 'DATA_REQUIRED' | 'DATA_INSUFFICIENT' | 'PARSE_REJECTED';
      readonly error_code: string;
      readonly reason: string;
    };

export interface SanitizedDomResult {
  readonly sanitized_html: string;
  readonly raw_response_sha256: string;
  readonly sanitized_dom_sha256: string;
  readonly raw_byte_length: number;
  readonly sanitized_byte_length: number;
  readonly stripped_executable_tags: number;
  readonly stripped_hidden_elements: number;
  readonly stripped_html_comments: number;
}

export interface SanitizationTelemetry {
  readonly raw_byte_length: number;
  readonly sanitized_byte_length: number;
  readonly stripped_executable_tags: number;
  readonly stripped_hidden_elements: number;
  readonly stripped_html_comments: number;
  readonly prompt_injection_flags: readonly string[];
  readonly quarantined_for_injection: boolean;
}

export interface SourceCaptureEvidenceEnvelope {
  readonly evidence_kind: 'OBSERVED_FACT' | 'SOURCE_DOCUMENT';
  readonly verification_status: 'UNVERIFIED';
  readonly commercial_status: 'ADVERTISED_LISTING' | 'SUPPLIER_QUOTE';
  readonly provenance_lineage: {
    readonly source_id: string;
    readonly requested_url?: string;
    readonly resolved_source_identity?: string;
    readonly evidence_origin_class?: 'LIVE_VERIFIED_CAPTURE' | 'RECORDED_GOLDEN_FIXTURE' | 'CALLER_SUPPLIED_PAYLOAD';
    readonly observed_at_utc: string;
    readonly ttl_seconds: number;
    readonly raw_sha256: string;
    readonly sanitized_sha256: string;
    readonly extractor_version: 'scw-dom-sieve-v1.0.0';
  };
}

export interface SourceCaptureMcpResponse {
  readonly request_id: string;
  readonly target_url: string;
  readonly captured_at_utc: string;
  readonly extraction_version: 'scw-dom-sieve-v1.0.0';
  readonly raw_response_sha256: string;
  readonly sanitized_dom_sha256: string;
  readonly extracted_fields: Readonly<Record<string, FieldExtractionOutcome>>;
  readonly sanitization_telemetry: SanitizationTelemetry;
  readonly evidence_envelope: SourceCaptureEvidenceEnvelope;
}

// ============================================================================
// 2. 6-LAYER DOM SANITIZATION SIEVE
// ============================================================================

const ALLOWED_ATTRIBUTES = new Set([
  'id',
  'class',
  'data-asin',
  'data-sku',
  'data-price',
  'data-moq',
  'data-min-qty',
  'data-max-qty',
  'data-pack',
  'data-freight',
  'data-material',
  'data-size',
  'data-hsn',
  'itemprop',
  'href'
]);

const EXECUTABLE_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'object',
  'embed',
  'applet',
  'svg',
  'math',
  'canvas',
  'noscript',
  'template',
  'form',
  'input',
  'textarea',
  'button',
  'meta'
]);

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

/**
 * Checks if attributes string represents a cloaked or hidden element.
 */
function isCloakedElementAttributes(attrs: string): boolean {
  if (/\bhidden\b/i.test(attrs)) return true;
  if (/\baria-hidden\s*=\s*["']?true["']?/i.test(attrs)) return true;

  const styleMatch = attrs.match(/style\s*=\s*["']([^"']*)["']/i);
  if (styleMatch) {
    const s = styleMatch[1].toLowerCase();
    if (/display\s*:\s*none/.test(s)) return true;
    if (/visibility\s*:\s*hidden/.test(s)) return true;
    if (/opacity\s*:\s*0(?![.\d])/.test(s)) return true;
    if (/font-size\s*:\s*0(?![.\d])/.test(s)) return true;
    if (/width\s*:\s*0(?![.\d])/.test(s)) return true;
    if (/height\s*:\s*0(?![.\d])/.test(s)) return true;
    if (/left\s*:\s*-\d{3,}px/.test(s)) return true;
    if (/top\s*:\s*-\d{3,}px/.test(s)) return true;
    if (/color\s*:\s*(?:transparent|rgba\([^)]*,\s*0\s*\))/.test(s)) return true;
  }
  return false;
}

/**
 * Strips HTML elements matching a predicate and tracks removal counts.
 */
function stripSubtrees(
  html: string,
  predicate: (tagName: string, attrs: string) => boolean
): { cleanHtml: string; count: number } {
  let count = 0;
  let prev = '';
  let current = html;

  while (current !== prev) {
    prev = current;
    const openTagRegex = /<([a-zA-Z0-9]+)(\s+[^>]*)?>/gi;
    let match: RegExpExecArray | null;

    while ((match = openTagRegex.exec(current)) !== null) {
      const tagName = match[1].toLowerCase();
      const rawAttrs = match[2] || '';
      const startIndex = match.index;
      const tagEndIndex = openTagRegex.lastIndex;

      if (predicate(tagName, rawAttrs)) {
        count++;

        if (VOID_TAGS.has(tagName) || rawAttrs.trim().endsWith('/')) {
          current = current.slice(0, startIndex) + current.slice(tagEndIndex);
          break;
        }

        // Depth-tracked matching for closing tag
        let depth = 1;
        const rest = current.slice(tagEndIndex);
        const subRegex = new RegExp(`<\/?${tagName}\\b[^>]*>`, 'gi');
        let subMatch: RegExpExecArray | null;
        let closeEndIndex = -1;

        while ((subMatch = subRegex.exec(rest)) !== null) {
          const matchedTag = subMatch[0];
          if (matchedTag.startsWith('</')) {
            depth--;
            if (depth === 0) {
              closeEndIndex = tagEndIndex + subRegex.lastIndex;
              break;
            }
          } else if (!matchedTag.endsWith('/>')) {
            depth++;
          }
        }

        if (closeEndIndex !== -1) {
          current = current.slice(0, startIndex) + current.slice(closeEndIndex);
        } else {
          current = current.slice(0, startIndex) + current.slice(tagEndIndex);
        }
        break; // Restart loop with modified current string
      }
    }
  }

  return { cleanHtml: current, count };
}

/**
 * 6-Layer DOM Sanitization Sieve.
 */
export function sanitizeHtmlDomSieve(rawHtml: string): SanitizedDomResult {
  const rawByteLength = Buffer.byteLength(rawHtml, 'utf8');

  // LAYER 1: Byte-stream & encoding gate
  if (rawByteLength > 524288) {
    throw new Error(
      `E-MCP-PAYLOAD-TOO-LARGE: Payload byte length ${rawByteLength} exceeds 524,288 bytes cap.`
    );
  }
  if (/\x00/.test(rawHtml)) {
    throw new Error('E-SCW-NULL-BYTE-DETECTED: Null byte detected in payload stream.');
  }

  const raw_response_sha256 = sha256(rawHtml);
  let html = rawHtml;

  // LAYER 2: Executable & active tag purge
  const execResult = stripSubtrees(html, (tagName) => EXECUTABLE_TAGS.has(tagName));
  html = execResult.cleanHtml;
  const stripped_executable_tags = execResult.count;

  // Strip event attributes & dangerous URIs
  html = html.replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/\s+(?:href|src)\s*=\s*["']\s*(?:javascript|data|vbscript):[^"']*["']/gi, '');

  // LAYER 3: Anti-cloaking & invisible element purge
  let stripped_html_comments = 0;
  html = html.replace(/<!--[\s\S]*?-->/g, () => {
    stripped_html_comments++;
    return '';
  });

  const cloakedResult = stripSubtrees(html, (_, attrs) => isCloakedElementAttributes(attrs));
  html = cloakedResult.cleanHtml;
  const stripped_hidden_elements = cloakedResult.count;

  // LAYER 4: Attribute allowlisting
  html = html.replace(/<([a-zA-Z0-9]+)(\s+[^>]*)?>/gi, (_, tag, rawAttrs) => {
    if (!rawAttrs) return `<${tag}>`;
    const isSelfClosing = rawAttrs.trim().endsWith('/');
    const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let am: RegExpExecArray | null;
    const cleanAttrs: string[] = [];

    while ((am = attrRegex.exec(rawAttrs)) !== null) {
      const name = am[1].toLowerCase();
      const val = am[2] ?? am[3] ?? am[4] ?? '';

      if (ALLOWED_ATTRIBUTES.has(name)) {
        if (name === 'href') {
          const lowerVal = val.toLowerCase().trim();
          if (
            lowerVal.startsWith('javascript:') ||
            lowerVal.startsWith('data:') ||
            lowerVal.startsWith('vbscript:')
          ) {
            continue;
          }
        }
        cleanAttrs.push(`${name}="${val}"`);
      }
    }

    const attrsStr = cleanAttrs.length > 0 ? ' ' + cleanAttrs.join(' ') : '';
    return `<${tag}${attrsStr}${isSelfClosing ? ' /' : ''}>`;
  });

  // LAYER 5: Unicode NFC & zero-width normalization
  html = html.normalize('NFC');
  html = html.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');

  // LAYER 6: Canonical DOM serialization & digest
  html = html.replace(/\s+/g, ' ').trim();
  const sanitized_byte_length = Buffer.byteLength(html, 'utf8');
  const sanitized_dom_sha256 = sha256(html);

  return {
    sanitized_html: html,
    raw_response_sha256,
    sanitized_dom_sha256,
    raw_byte_length: rawByteLength,
    sanitized_byte_length,
    stripped_executable_tags,
    stripped_hidden_elements,
    stripped_html_comments
  };
}

// ============================================================================
// 3. PROMPT-INJECTION & HOMOGRAPH DEFENSE
// ============================================================================

export class InjectionCanaryGuard {
  public static scan(
    text: string,
    options?: { throwOnDetected?: boolean }
  ): {
    quarantined: boolean;
    flags: readonly string[];
    error_code?: string;
  } {
    const flags: string[] = [];

    // Instruction overrides
    if (
      /ignore\s+(?:all\s+)?(?:previous\s+|prior\s+)?instructions/i.test(text) ||
      /system\s+prompt/i.test(text) ||
      /developer\s+mode/i.test(text) ||
      /you\s+are\s+now/i.test(text)
    ) {
      flags.push('INSTRUCTION_OVERRIDE');
    }

    // Role / ChatML delimiters
    if (
      /<\|im_start\|>/i.test(text) ||
      /<\|im_end\|>/i.test(text) ||
      /<\|endoftext\|>/i.test(text) ||
      /\[INST\]/i.test(text) ||
      /###\s*System:/i.test(text) ||
      /###\s*Instruction:/i.test(text) ||
      /<\/untrusted_data>/i.test(text)
    ) {
      flags.push('ROLE_OR_CHATML_DELIMITER');
    }

    // Domain state spoofing enums
    if (
      /\bVERIFIED_EXECUTABLE_OFFER\b/.test(text) ||
      /\bALLOCATE_CAPITAL\b/.test(text) ||
      /\bCROSS_SOURCE_CORROBORATED\b/.test(text) ||
      /\bACTUALS_LEDGER\b/.test(text) ||
      /\bPROMOTED_NORMATIVE\b/.test(text)
    ) {
      flags.push('DOMAIN_STATE_SPOOFING');
    }

    // Tool / URI smuggling
    if (
      /mcp:\/\//i.test(text) ||
      /file:\/\//i.test(text) ||
      /\b127\.0\.0\.1\b/.test(text) ||
      /\blocalhost\b/i.test(text)
    ) {
      flags.push('TOOL_OR_URI_SMUGGLING');
    }

    if (flags.length > 0) {
      if (options?.throwOnDetected) {
        throw new Error(
          `E-SCW-PROMPT-INJECTION-DETECTED: Adversarial payload detected [${flags.join(', ')}].`
        );
      }
      return {
        quarantined: true,
        flags: Object.freeze(flags),
        error_code: 'E-SCW-PROMPT-INJECTION-DETECTED'
      };
    }

    return {
      quarantined: false,
      flags: Object.freeze([])
    };
  }

  public static assertSafe(text: string): void {
    this.scan(text, { throwOnDetected: true });
  }
}

/**
 * Wraps extracted field values in a nonce-delimited cryptographic spotlight container.
 */
export function createSpotlightContainer(fieldValue: string, nonce?: string): string {
  const chosenNonce = nonce ?? randomBytes(16).toString('hex');
  const safeText = fieldValue.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<untrusted_dom_field_${chosenNonce}>${safeText}</untrusted_dom_field_${chosenNonce}>`;
}

// ============================================================================
// 4. DETERMINISTIC FIELD EXTRACTION & PARSERS
// ============================================================================

/**
 * Parses INR currency string to scale-4 BigInt subunits string (e.g. ₹38.21 -> '382100').
 * Throws on confusable homographs. Never substitutes 0n.
 */
export function parseInrToSubunits(rawText: string): string {
  // Homograph validation
  if (/[\uFF10-\uFF19]/.test(rawText) || /[\u0400-\u04FF]/.test(rawText) || /[\u0370-\u03FF]/.test(rawText)) {
    throw new Error('E-SCW-HOMOGRAPH-DETECTED: Confusable homograph character detected in numeric/text input.');
  }

  // Strip zero-width & BiDi characters
  let clean = rawText.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').trim();

  // Strip currency symbols and formatting commas
  clean = clean.replace(/₹|INR|Rs\.?|,/gi, '').trim();

  // Strip standard marketplace unit denominators (e.g. / Pack, / pc, / piece, / kg, / unit)
  clean = clean.replace(/\s*\/\s*(?:pack|pc|piece|kg|unit|box|set|meter|nos?)\b/gi, '').trim();

  // Check if non-numeric (contains letters or unparseable text)
  if (/[a-zA-Z]/.test(clean) || clean.length === 0) {
    throw new Error(`E-SCW-MANDATORY-COST-MISSING: Non-numeric price string '${rawText}'.`);
  }

  const match = clean.match(/^[-+]?(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`E-SCW-INVALID-NUMERIC-VALUE: Invalid price format '${rawText}'.`);
  }

  const intPart = match[1];
  const decPart = (match[2] || '').padEnd(4, '0').slice(0, 4);
  const subunits = BigInt(intPart) * 10000n + BigInt(decPart);

  if (subunits <= 0n) {
    throw new Error('E-SCW-INVALID-NUMERIC-VALUE: Price must be positive; zero or negative value forbidden.');
  }

  return subunits.toString();
}

/**
 * Parses positive integer strings (e.g. MOQ, pack size).
 */
export function parsePositiveInteger(rawText: string): string {
  if (/[\uFF10-\uFF19]/.test(rawText) || /[\u0400-\u04FF]/.test(rawText)) {
    throw new Error('E-SCW-HOMOGRAPH-DETECTED: Confusable homograph character detected in numeric/text input.');
  }

  const clean = rawText.replace(/[\u200B-\u200F\uFEFF]/g, '').trim();
  const digitsMatch = clean.match(/\b\d+\b/);
  if (!digitsMatch) {
    throw new Error(`E-SCW-INVALID-NUMERIC-VALUE: No integer found in '${rawText}'.`);
  }

  const val = parseInt(digitsMatch[0], 10);
  if (val <= 0) {
    throw new Error(`E-SCW-INVALID-NUMERIC-VALUE: Integer must be positive, received ${val}.`);
  }

  return val.toString();
}

/**
 * Deterministic CSS / attribute selector extraction on sanitized HTML.
 */
export function extractBySelector(
  html: string,
  selector: string
): { matched_selector: string; extracted_text: string } | null {
  const trimmed = selector.trim();

  let targetTag: string | null = null;
  let targetId: string | null = null;
  let targetClass: string | null = null;
  let targetAttr: { name: string; op: string; val: string } | null = null;

  if (trimmed.startsWith('#')) {
    targetId = trimmed.slice(1);
  } else if (trimmed.startsWith('.')) {
    targetClass = trimmed.slice(1);
  } else if (trimmed.startsWith('[')) {
    const m = trimmed.match(/^\[([a-zA-Z0-9_-]+)(?:([*~|^$]?=)["']?([^"'\]]+)["']?)?\]$/);
    if (m) {
      targetAttr = { name: m[1].toLowerCase(), op: m[2] || '', val: m[3] || '' };
    }
  } else {
    const parts = trimmed.match(
      /^([a-zA-Z0-9]+)?(?:#([a-zA-Z0-9_-]+))?(?:\.([a-zA-Z0-9_-]+))?(?:\[([a-zA-Z0-9_-]+)(?:([*~|^$]?=)["']?([^"'\]]+)["']?)?\])?$/
    );
    if (parts) {
      targetTag = parts[1] ? parts[1].toLowerCase() : null;
      targetId = parts[2] || null;
      targetClass = parts[3] || null;
      if (parts[4]) {
        targetAttr = { name: parts[4].toLowerCase(), op: parts[5] || '', val: parts[6] || '' };
      }
    }
  }

  const openTagRegex = /<([a-zA-Z0-9]+)(\s+[^>]*)?>/gi;
  let match: RegExpExecArray | null;

  while ((match = openTagRegex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const rawAttrs = match[2] || '';
    const tagEndIndex = openTagRegex.lastIndex;

    if (targetTag && tagName !== targetTag) continue;

    const attrMap = new Map<string, string>();
    const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRegex.exec(rawAttrs)) !== null) {
      attrMap.set(am[1].toLowerCase(), am[2] ?? am[3] ?? am[4] ?? '');
    }

    if (targetId && attrMap.get('id') !== targetId) continue;
    if (targetClass) {
      const cls = attrMap.get('class') || '';
      const classes = cls.split(/\s+/);
      if (!classes.includes(targetClass)) continue;
    }
    if (targetAttr) {
      if (!attrMap.has(targetAttr.name)) continue;
      const actualVal = attrMap.get(targetAttr.name) || '';
      if (targetAttr.op === '=' && actualVal !== targetAttr.val) continue;
      if (targetAttr.op === '*=' && !actualVal.includes(targetAttr.val)) continue;
    }

    // If specific attribute was matched, return it
    if (targetAttr && targetAttr.name.startsWith('data-') && attrMap.get(targetAttr.name)) {
      return {
        matched_selector: selector,
        extracted_text: attrMap.get(targetAttr.name)!
      };
    }

    // Extract text content up to closing tag
    const rest = html.slice(tagEndIndex);
    let depth = 1;
    const subRegex = new RegExp(`<\/?${tagName}\\b[^>]*>`, 'gi');
    let subMatch: RegExpExecArray | null;
    let innerHtml = '';

    while ((subMatch = subRegex.exec(rest)) !== null) {
      if (subMatch[0].startsWith('</')) {
        depth--;
        if (depth === 0) {
          innerHtml = rest.slice(0, subMatch.index);
          break;
        }
      } else if (!subMatch[0].endsWith('/>')) {
        depth++;
      }
    }

    if (depth !== 0) {
      if (attrMap.has('data-price')) {
        return { matched_selector: selector, extracted_text: attrMap.get('data-price')! };
      }
      if (attrMap.has('data-moq')) {
        return { matched_selector: selector, extracted_text: attrMap.get('data-moq')! };
      }
      innerHtml = rest.slice(0, 100);
    }

    const text = innerHtml.replace(/<[^>]+>/g, '').trim();
    return {
      matched_selector: selector,
      extracted_text: text
    };
  }

  return null;
}

/**
 * Deterministic Tiered MOQ Bracket Resolver for IndiaMART / B2B quantity-slab pricing.
 * Parses quantity-slab rows and selects the exact bracket for target_batch_quantity.
 * Fails closed if quantity is below supplier MOQ or if brackets are ambiguous/overlapping.
 */
export function resolveTieredMoqPrice(
  html: string,
  selectorOrQty?: string | number,
  targetBatchQuantity?: number,
  options?: { throwOnError?: boolean }
): FieldExtractionOutcome {
  let selector = '.price-tier-row, [data-min-qty], table';
  let targetQty: number | undefined;

  if (typeof selectorOrQty === 'number') {
    targetQty = selectorOrQty;
  } else if (typeof selectorOrQty === 'string') {
    selector = selectorOrQty;
    targetQty = targetBatchQuantity;
  } else {
    targetQty = targetBatchQuantity;
  }

  // Fail-closed: target quantity must be supplied
  if (targetQty === undefined || targetQty === null || typeof targetQty !== 'number' || Number.isNaN(targetQty)) {
    const outcome: FieldExtractionOutcome = {
      status: 'PARSE_REJECTED',
      error_code: 'E-SCW-MISSING-TARGET-QUANTITY',
      reason: 'target_batch_quantity is required for TIERED_SUBUNITS_INR extraction.'
    };
    if (options?.throwOnError) {
      throw new Error(`${outcome.error_code}: ${outcome.reason}`);
    }
    return outcome;
  }

  if (targetQty <= 0 || !Number.isInteger(targetQty)) {
    const outcome: FieldExtractionOutcome = {
      status: 'PARSE_REJECTED',
      error_code: 'E-SCW-INVALID-TARGET-QUANTITY',
      reason: `target_batch_quantity must be a positive integer, received ${targetQty}.`
    };
    if (options?.throwOnError) {
      throw new Error(`${outcome.error_code}: ${outcome.reason}`);
    }
    return outcome;
  }

  const rawTiers: PriceBracketTier[] = [];

  // Parse HTML elements that contain tier information
  const openTagRegex = /<([a-zA-Z0-9]+)(\s+[^>]*)?>/gi;
  let match: RegExpExecArray | null;

  while ((match = openTagRegex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const rawAttrs = match[2] || '';
    const tagEndIndex = openTagRegex.lastIndex;

    const attrMap = new Map<string, string>();
    const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRegex.exec(rawAttrs)) !== null) {
      attrMap.set(am[1].toLowerCase(), am[2] ?? am[3] ?? am[4] ?? '');
    }

    const hasTierClass = (attrMap.get('class') || '').split(/\s+/).includes('price-tier-row');
    const hasMinQty = attrMap.has('data-min-qty');

    if (!hasTierClass && !hasMinQty) {
      continue;
    }

    // Extract inner HTML with depth tracking
    const rest = html.slice(tagEndIndex);
    let depth = 1;
    const subRegex = new RegExp(`<\/?${tagName}\\b[^>]*>`, 'gi');
    let subMatch: RegExpExecArray | null;
    let innerHtml = '';

    while ((subMatch = subRegex.exec(rest)) !== null) {
      if (subMatch[0].startsWith('</')) {
        depth--;
        if (depth === 0) {
          innerHtml = rest.slice(0, subMatch.index);
          break;
        }
      } else if (!subMatch[0].endsWith('/>')) {
        depth++;
      }
    }

    // Determine min_qty & max_qty
    let min_qty: number | undefined;
    let max_qty: number | null | undefined;

    if (attrMap.has('data-min-qty')) {
      const s = attrMap.get('data-min-qty')!.trim();
      if (/^\d+$/.test(s)) {
        min_qty = parseInt(s, 10);
      }
    }

    if (attrMap.has('data-max-qty')) {
      const s = attrMap.get('data-max-qty')!.trim();
      if (/^\d+$/.test(s)) {
        max_qty = parseInt(s, 10);
      } else {
        max_qty = null;
      }
    }

    const innerText = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (min_qty === undefined) {
      const rangeMatch = innerText.match(/(\d+)\s*[-–—to]\s*(\d+)/i);
      if (rangeMatch) {
        min_qty = parseInt(rangeMatch[1], 10);
        if (max_qty === undefined) {
          max_qty = parseInt(rangeMatch[2], 10);
        }
      } else {
        const plusMatch = innerText.match(/(\d+)\s*\+/);
        if (plusMatch) {
          min_qty = parseInt(plusMatch[1], 10);
          if (max_qty === undefined) {
            max_qty = null;
          }
        }
      }
    }

    if (min_qty === undefined) {
      continue;
    }
    if (max_qty === undefined) {
      max_qty = null;
    }

    // Extract unit price
    let unit_price_subunits: string | undefined;

    if (attrMap.has('data-price')) {
      try {
        unit_price_subunits = parseInrToSubunits(attrMap.get('data-price')!);
      } catch {
        // Fallback
      }
    }

    if (!unit_price_subunits) {
      const dataPriceMatch = innerHtml.match(/data-price\s*=\s*["']([^"']+)["']/i);
      if (dataPriceMatch) {
        try {
          unit_price_subunits = parseInrToSubunits(dataPriceMatch[1]);
        } catch {
          // Fallback
        }
      }
    }

    if (!unit_price_subunits) {
      const priceCellMatch = innerHtml.match(/<[^>]*class\s*=\s*["'][^"']*tier-price[^"']*["'][^>]*>([\s\S]*?)<\/[a-zA-Z0-9]+>/i);
      const textToSearch = priceCellMatch ? priceCellMatch[1].replace(/<[^>]+>/g, ' ') : innerText;
      const inrMatch =
        textToSearch.match(/(?:₹|INR|Rs\.?)\s*([0-9,]+(?:\.[0-9]+)?)/i) ||
        textToSearch.match(/([0-9,]+(?:\.[0-9]+)?)\s*(?:\/|\s*per)/i);
      if (inrMatch) {
        try {
          unit_price_subunits = parseInrToSubunits(inrMatch[1]);
        } catch {
          // Non-numeric
        }
      }
    }

    if (unit_price_subunits) {
      rawTiers.push({
        min_qty,
        max_qty,
        unit_price_subunits
      });
    }
  }

  // Deduplicate and detect conflicts for identical ranges
  const tierMap = new Map<string, PriceBracketTier>();
  for (const t of rawTiers) {
    const key = `${t.min_qty}:${t.max_qty ?? 'null'}`;
    const existing = tierMap.get(key);
    if (existing && existing.unit_price_subunits !== t.unit_price_subunits) {
      const outcome: FieldExtractionOutcome = {
        status: 'PARSE_REJECTED',
        error_code: 'E-SCW-AMBIGUOUS-TIER-BRACKET',
        reason: `Conflicting prices detected for identical tier range [${t.min_qty}-${t.max_qty ?? '+'}]: ${existing.unit_price_subunits} vs ${t.unit_price_subunits}.`
      };
      if (options?.throwOnError) {
        throw new Error(`${outcome.error_code}: ${outcome.reason}`);
      }
      return outcome;
    }
    tierMap.set(key, t);
  }

  const observedTiers = Object.freeze(
    Array.from(tierMap.values()).sort((a, b) => a.min_qty - b.min_qty)
  );

  if (observedTiers.length === 0) {
    const outcome: FieldExtractionOutcome = {
      status: 'DATA_REQUIRED',
      error_code: 'E-SCW-MANDATORY-COST-MISSING',
      reason: `No quantity-slab pricing tiers found in DOM matching selector '${selector}'.`
    };
    if (options?.throwOnError) {
      throw new Error(`${outcome.error_code}: ${outcome.reason}`);
    }
    return outcome;
  }

  const lowestMinQty = Math.min(...observedTiers.map((t) => t.min_qty));

  // Invariant 3: Below minimum supplier tier MOQ -> fail closed with DATA_REQUIRED
  if (targetQty < lowestMinQty) {
    const outcome: FieldExtractionOutcome = {
      status: 'DATA_REQUIRED',
      error_code: 'E-SCW-BELOW-MINIMUM-TIER-MOQ',
      reason: `Target batch quantity ${targetQty} is below minimum supplier tier MOQ ${lowestMinQty}; zero or extrapolation forbidden.`
    };
    if (options?.throwOnError) {
      throw new Error(`${outcome.error_code}: ${outcome.reason}`);
    }
    return outcome;
  }

  // Find all matching tiers
  const matchingTiers = observedTiers.filter(
    (tier) =>
      tier.min_qty <= targetQty! &&
      (tier.max_qty === null || targetQty! <= tier.max_qty)
  );

  // Invariant 4: Ambiguous / overlapping tiers -> fail closed with PARSE_REJECTED
  if (matchingTiers.length > 1) {
    const outcome: FieldExtractionOutcome = {
      status: 'PARSE_REJECTED',
      error_code: 'E-SCW-AMBIGUOUS-TIER-BRACKET',
      reason: `Target batch quantity ${targetQty} matched ${matchingTiers.length} ambiguous/overlapping tiers: [${matchingTiers.map((t) => `${t.min_qty}-${t.max_qty ?? '+'}`).join(', ')}]. Refusing to guess which price applies.`
    };
    if (options?.throwOnError) {
      throw new Error(`${outcome.error_code}: ${outcome.reason}`);
    }
    return outcome;
  }

  // Gap between tiers
  if (matchingTiers.length === 0) {
    const outcome: FieldExtractionOutcome = {
      status: 'DATA_REQUIRED',
      error_code: 'E-SCW-TIER-BRACKET-GAP',
      reason: `Target batch quantity ${targetQty} falls into an unquoted gap between supplier pricing tiers.`
    };
    if (options?.throwOnError) {
      throw new Error(`${outcome.error_code}: ${outcome.reason}`);
    }
    return outcome;
  }

  // Invariant 1 & 2: Clean single match (Exact Bracket Match or Mid-Tier Match)
  const matchedTier = matchingTiers[0];
  return {
    status: 'EXTRACTED',
    raw_sanitized_text: matchedTier.unit_price_subunits,
    normalized_value: matchedTier.unit_price_subunits,
    unit: 'SUBUNITS_INR',
    matched_selector: selector,
    matched_tier: Object.freeze(matchedTier),
    observed_tiers: observedTiers
  };
}

// ============================================================================
// 5. RECORDED FIXTURE REGISTRY
// ============================================================================

export class SourceCaptureFixtureRegistry {
  private static readonly fixtures = new Map<string, string>();

  static {
    // Default Amazon India fixture for ASIN B09XYZ1234
    SourceCaptureFixtureRegistry.fixtures.set(
      'amazon_in_b09xyz1234',
      `<div id="product-overview" class="product-card" data-asin="B09XYZ1234">
  <span class="product-title">SS304 Adjustable Hose Clamp Pack of 10</span>
  <span class="unit-price" data-price="105.00">₹105.00</span>
  <span class="pack-quantity" data-pack="10">Pack of 10</span>
</div>`
    );

    // Default Howrah SS304 Supplier fixture for DIN 3017 16-25mm
    SourceCaptureFixtureRegistry.fixtures.set(
      'howrah_ss304_supplier',
      `<div id="supplier-catalog-item" class="b2b-listing" data-sku="HOWRAH-SS304-16-25" data-freight="15.00">
  <span class="product-title">DIN 3017 SS304 Worm Drive Hose Clamp 16-25mm</span>
  <span class="unit-price" data-price="25.00">₹25.00</span>
  <span class="moq" data-moq="500">MOQ: 500 units</span>
  <span class="material" data-material="SS304">SS304</span>
  <span class="size-range" data-size="16-25mm">16-25mm</span>
</div>`
    );

    // Default IndiaMART Tiered MOQ fixture for DIN 3017 16-25mm Pack of 10
    SourceCaptureFixtureRegistry.fixtures.set(
      'indiamart_tiered_moq',
      `<table id="indiamart-tier-pricing" data-sku="DIN3017-SS304-16-25-P10">
  <tr class="price-tier-row" data-min-qty="100" data-max-qty="249">
    <td class="tier-range">100 - 249 Packs</td>
    <td class="tier-price">₹ 31.00 / Pack</td>
  </tr>
  <tr class="price-tier-row" data-min-qty="250" data-max-qty="499">
    <td class="tier-range">250 - 499 Packs</td>
    <td class="tier-price">₹ 28.50 / Pack</td>
  </tr>
  <tr class="price-tier-row" data-min-qty="500" data-max-qty="">
    <td class="tier-range">500+ Packs</td>
    <td class="tier-price">₹ 25.00 / Pack</td>
  </tr>
</table>`
    );
  }

  public static registerFixture(id: string, html: string): void {
    this.fixtures.set(id, html);
  }

  public static getFixture(id: string): string | undefined {
    return this.fixtures.get(id);
  }
}

// ============================================================================
// 6. DEFAULT EXTRACTION RULES
// ============================================================================

export function getDefaultExtractionRules(profile: SourceProfileId): readonly ExtractionSelectorRule[] {
  switch (profile) {
    case 'AMAZON_IN_PRODUCT_LISTING':
      return Object.freeze([
        {
          field_name: 'gross_price_inr',
          selector: '.unit-price, .a-price-whole, [data-price], #priceblock_ourprice',
          expected_type: 'SUBUNITS_INR',
          is_mandatory: true
        },
        {
          field_name: 'gross_selling_price_subunits',
          selector: '.unit-price, [data-price]',
          expected_type: 'SUBUNITS_INR',
          is_mandatory: false
        },
        {
          field_name: 'asin',
          selector: '[data-asin]',
          expected_type: 'ENUM_STRING',
          is_mandatory: false
        },
        {
          field_name: 'pack_quantity',
          selector: '.pack-quantity, [data-pack]',
          expected_type: 'POSITIVE_INT',
          is_mandatory: false
        }
      ]);

    case 'INDIAMART_SUPPLIER_LISTING':
      return Object.freeze([
        {
          field_name: 'gross_price_inr',
          selector: '.unit-price, [data-price], .price',
          expected_type: 'SUBUNITS_INR',
          is_mandatory: true
        },
        {
          field_name: 'raw_material_purchase_subunits',
          selector: '.unit-price, [data-price]',
          expected_type: 'SUBUNITS_INR',
          is_mandatory: false
        },
        {
          field_name: 'moq_units',
          selector: '[data-moq], .moq',
          expected_type: 'POSITIVE_INT',
          is_mandatory: true
        },
        {
          field_name: 'inbound_freight_inr',
          selector: '#freight-cost, [data-freight]',
          expected_type: 'SUBUNITS_INR',
          is_mandatory: true
        },
        {
          field_name: 'material_grade',
          selector: '[data-material], .material',
          expected_type: 'ENUM_STRING',
          is_mandatory: false
        },
        {
          field_name: 'clamp_size_range_mm',
          selector: '[data-size], .size-range',
          expected_type: 'ENUM_STRING',
          is_mandatory: false
        }
      ]);

    case 'HOWRAH_B2B_DISTRIBUTOR_CATALOG':
      return Object.freeze([
        {
          field_name: 'gross_price_inr',
          selector: '.unit-price, [data-price], .price',
          expected_type: 'SUBUNITS_INR',
          is_mandatory: true
        },
        {
          field_name: 'raw_material_purchase_subunits',
          selector: '.unit-price, [data-price]',
          expected_type: 'SUBUNITS_INR',
          is_mandatory: false
        },
        {
          field_name: 'raw_material_purchase',
          selector: '.unit-price, [data-price]',
          expected_type: 'SUBUNITS_INR',
          is_mandatory: false
        },
        {
          field_name: 'moq_units',
          selector: '[data-moq], .moq',
          expected_type: 'POSITIVE_INT',
          is_mandatory: true
        },
        {
          field_name: 'material_grade',
          selector: '[data-material], .material',
          expected_type: 'ENUM_STRING',
          is_mandatory: false
        },
        {
          field_name: 'clamp_size_range_mm',
          selector: '[data-size], .size-range',
          expected_type: 'ENUM_STRING',
          is_mandatory: false
        }
      ]);
  }
}

// ============================================================================
// 7. MCP TOOL REGISTRATION & HANDLER
// ============================================================================

export const SOURCE_CAPTURE_TOOL_DESCRIPTOR: McpToolDescriptor = Object.freeze({
  name: 'mcp://source-capture/http_get_snapshot',
  description:
    'Read-only HTTP GET snapshot and DOM extraction for approved marketplace and supplier domains',
  inputSchema: {
    type: 'object' as const,
    properties: {
      url: { type: 'string' },
      target_url: { type: 'string' },
      source_profile: { type: 'string' },
      execution_mode: { type: 'string' },
      target_batch_quantity: { type: 'number' },
      fixture_id: { type: 'string' },
      raw_html_payload: { type: 'string' },
      extraction_rules: { type: 'array' },
      method: { type: 'string' },
      allow_redirects: { type: 'boolean' }
    },
    required: ['url']
  }
});

/**
 * Registers the read-only tool 'mcp://source-capture/http_get_snapshot' on an McpServerAdapter.
 */
export function registerSourceCaptureTool(server: McpServerAdapter): void {
  server.registerTool({
    descriptor: SOURCE_CAPTURE_TOOL_DESCRIPTOR,
    handler: async (args: Record<string, unknown>): Promise<McpToolCallResponse['result']> => {
      const targetUrl = String(args.url || args.target_url);
      const executionMode = (args.execution_mode as CaptureExecutionMode) || 'RECORDED_FIXTURE_REPLAY';
      const targetBatchQuantity =
        typeof args.target_batch_quantity === 'number'
          ? args.target_batch_quantity
          : undefined;
      const fixtureId = args.fixture_id as string | undefined;
      let rawHtmlPayload = args.raw_html_payload as string | undefined;
      const sourceProfile = (args.source_profile as SourceProfileId) || 'AMAZON_IN_PRODUCT_LISTING';
      const requestedRules = args.extraction_rules as readonly ExtractionSelectorRule[] | undefined;
      const rules = requestedRules && requestedRules.length > 0
        ? requestedRules
        : getDefaultExtractionRules(sourceProfile);

      let rawHtml = '';
      let evidenceOriginClass: 'LIVE_VERIFIED_CAPTURE' | 'RECORDED_GOLDEN_FIXTURE' | 'CALLER_SUPPLIED_PAYLOAD' = 'RECORDED_GOLDEN_FIXTURE';
      let resolvedSourceIdentity = targetUrl;

      if (executionMode === 'APPROVED_LIVE_HTTPS_GET') {
        evidenceOriginClass = 'LIVE_VERIFIED_CAPTURE';
        resolvedSourceIdentity = targetUrl;
        const fetchRes = await ConstrainedHttpsConnector.fetch(targetUrl, {
          method: 'GET',
          max_payload_bytes: 1_048_576,
          timeout_ms: 10_000,
          allow_redirects: false
        });

        if (fetchRes.status >= 300 && fetchRes.status < 400) {
          throw new Error(`E-MCP-REDIRECT-DENIED: HTTP redirect ${fetchRes.status} encountered.`);
        }
        if (fetchRes.status < 200 || fetchRes.status >= 300) {
          throw new Error(`E-SCW-HTTP-ERROR: HTTP GET failed with status ${fetchRes.status}.`);
        }
        rawHtml = fetchRes.bodyText;
      } else {
        // RECORDED_FIXTURE_REPLAY
        if (rawHtmlPayload) {
          rawHtml = rawHtmlPayload;
          evidenceOriginClass = 'CALLER_SUPPLIED_PAYLOAD';
          resolvedSourceIdentity = 'caller://raw_html_payload';
        } else if (fixtureId) {
          rawHtml = SourceCaptureFixtureRegistry.getFixture(fixtureId) ?? '';
          evidenceOriginClass = 'RECORDED_GOLDEN_FIXTURE';
          resolvedSourceIdentity = `fixture://${fixtureId}`;
        } else if (targetUrl.includes('B09XYZ1234') || targetUrl.includes('amazon')) {
          rawHtml = SourceCaptureFixtureRegistry.getFixture('amazon_in_b09xyz1234') ?? '';
          evidenceOriginClass = 'RECORDED_GOLDEN_FIXTURE';
          resolvedSourceIdentity = 'fixture://amazon_in_b09xyz1234';
        } else if (targetUrl.includes('howrah') || targetUrl.includes('howrah-ss304-clamp')) {
          rawHtml = SourceCaptureFixtureRegistry.getFixture('howrah_ss304_supplier') ?? '';
          evidenceOriginClass = 'RECORDED_GOLDEN_FIXTURE';
          resolvedSourceIdentity = 'fixture://howrah_ss304_supplier';
        } else if (targetUrl.includes('ss304-bracket') || targetUrl.includes('indiamart-tier')) {
          rawHtml = SourceCaptureFixtureRegistry.getFixture('indiamart_tiered_moq') ?? '';
          evidenceOriginClass = 'RECORDED_GOLDEN_FIXTURE';
          resolvedSourceIdentity = 'fixture://indiamart_tiered_moq';
        }

        if (!rawHtml) {
          throw new Error(
            `E-WORKER-UNSUPPORTED-OR-UNMAPPED-SOURCE: Target URL '${targetUrl}' has no mapped golden fixture and live egress is not permitted.`
          );
        }
      }

      // Execute 6-layer DOM sieve
      const sieveResult = sanitizeHtmlDomSieve(rawHtml);

      // Scan canary for prompt injection on sanitized DOM (after cloaking and comments are purged)
      const canarySanitized = InjectionCanaryGuard.scan(sieveResult.sanitized_html);
      const promptInjectionFlags = Array.from(new Set(canarySanitized.flags));
      const quarantined = canarySanitized.quarantined;

      // Execute deterministic field extraction
      const extractedFields: Record<string, FieldExtractionOutcome> = {};

      for (const rule of rules) {
        if (quarantined) {
          extractedFields[rule.field_name] = {
            status: 'PARSE_REJECTED',
            error_code: 'E-SCW-PROMPT-INJECTION-DETECTED',
            reason: `Field '${rule.field_name}' quarantined due to prompt injection flags [${promptInjectionFlags.join(', ')}].`
          };
          continue;
        }

        // TIERED_SUBUNITS_INR delegation to resolveTieredMoqPrice
        if (rule.expected_type === 'TIERED_SUBUNITS_INR') {
          if (targetBatchQuantity === undefined) {
            extractedFields[rule.field_name] = {
              status: 'PARSE_REJECTED',
              error_code: 'E-SCW-MISSING-TARGET-QUANTITY',
              reason: `Field '${rule.field_name}' requires target_batch_quantity for TIERED_SUBUNITS_INR extraction.`
            };
            continue;
          }
          const tierOutcome = resolveTieredMoqPrice(
            sieveResult.sanitized_html,
            rule.selector,
            targetBatchQuantity
          );
          extractedFields[rule.field_name] = tierOutcome;
          continue;
        }

        // Support multiple comma-separated selector fallbacks
        const subSelectors = rule.selector.split(',').map((s) => s.trim());
        let matchResult: { matched_selector: string; extracted_text: string } | null = null;

        for (const subSel of subSelectors) {
          matchResult = extractBySelector(sieveResult.sanitized_html, subSel);
          if (matchResult && matchResult.extracted_text) {
            break;
          }
        }

        if (!matchResult || !matchResult.extracted_text) {
          if (rule.is_mandatory) {
            extractedFields[rule.field_name] = {
              status: 'DATA_REQUIRED',
              error_code: 'E-SCW-MANDATORY-COST-MISSING',
              reason: `Mandatory field '${rule.field_name}' missing from DOM; zero substitution forbidden.`
            };
          } else {
            extractedFields[rule.field_name] = {
              status: 'DATA_INSUFFICIENT',
              error_code: 'E-SCW-OPTIONAL-FIELD-ABSENT',
              reason: `Optional field '${rule.field_name}' absent.`
            };
          }
          continue;
        }

        const rawText = matchResult.extracted_text;

        // Extract based on expected type
        try {
          switch (rule.expected_type) {
            case 'SUBUNITS_INR': {
              const normalizedSubunits = parseInrToSubunits(rawText);
              extractedFields[rule.field_name] = {
                status: 'EXTRACTED',
                raw_sanitized_text: rawText,
                normalized_value: normalizedSubunits,
                unit: 'SUBUNITS_INR',
                matched_selector: matchResult.matched_selector
              };
              break;
            }

            case 'POSITIVE_INT': {
              const normalizedInt = parsePositiveInteger(rawText);
              extractedFields[rule.field_name] = {
                status: 'EXTRACTED',
                raw_sanitized_text: rawText,
                normalized_value: normalizedInt,
                unit: 'UNITS',
                matched_selector: matchResult.matched_selector
              };
              break;
            }

            case 'ENUM_STRING':
            case 'HSN_CODE': {
              // Strip zero-width & BiDi characters
              const cleanStr = rawText
                .replace(/[\u200B-\u200F\uFEFF]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
              extractedFields[rule.field_name] = {
                status: 'EXTRACTED',
                raw_sanitized_text: rawText,
                normalized_value: cleanStr,
                unit: 'STRING',
                matched_selector: matchResult.matched_selector
              };
              break;
            }
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.includes('E-SCW-HOMOGRAPH-DETECTED')) {
            throw err;
          }
          if (rule.is_mandatory) {
            extractedFields[rule.field_name] = {
              status: 'DATA_REQUIRED',
              error_code: 'E-SCW-MANDATORY-COST-MISSING',
              reason: `Selector '${matchResult.matched_selector}' matched non-numeric text "${rawText}"; zero substitution forbidden.`
            };
          } else {
            extractedFields[rule.field_name] = {
              status: 'PARSE_REJECTED',
              error_code: 'E-SCW-INVALID-NUMERIC-VALUE',
              reason: errMsg
            };
          }
        }
      }

      // Hardcoded status ceiling
      const requestedStatus = args.custom_commercial_status as string | undefined;
      let commercialStatus: 'ADVERTISED_LISTING' | 'SUPPLIER_QUOTE';
      if (requestedStatus) {
        if (
          requestedStatus !== 'ADVERTISED_LISTING' &&
          requestedStatus !== 'SUPPLIER_QUOTE'
        ) {
          throw new Error(
            'E-SCW-STATUS-ESCALATION-FORBIDDEN: Source capture worker is structurally barred from elevating commercial_status.'
          );
        }
        commercialStatus = requestedStatus;
      } else {
        commercialStatus =
          sourceProfile === 'AMAZON_IN_PRODUCT_LISTING'
            ? 'ADVERTISED_LISTING'
            : 'SUPPLIER_QUOTE';
      }

      const capturedAtUtc =
        (args.requested_at_utc as string) ||
        (args.captured_at_utc as string) ||
        '2026-10-17T22:00:00.000Z';

      const responsePayload: SourceCaptureMcpResponse = {
        request_id: String(args.request_id || args.task_id || `scw-req-${sieveResult.sanitized_dom_sha256.slice(0, 12)}`),
        target_url: targetUrl,
        captured_at_utc: capturedAtUtc,
        extraction_version: 'scw-dom-sieve-v1.0.0',
        raw_response_sha256: sieveResult.raw_response_sha256,
        sanitized_dom_sha256: sieveResult.sanitized_dom_sha256,
        extracted_fields: Object.freeze(extractedFields),
        sanitization_telemetry: Object.freeze({
          raw_byte_length: sieveResult.raw_byte_length,
          sanitized_byte_length: sieveResult.sanitized_byte_length,
          stripped_executable_tags: sieveResult.stripped_executable_tags,
          stripped_hidden_elements: sieveResult.stripped_hidden_elements,
          stripped_html_comments: sieveResult.stripped_html_comments,
          prompt_injection_flags: Object.freeze(promptInjectionFlags),
          quarantined_for_injection: quarantined
        }),
        evidence_envelope: Object.freeze({
          evidence_kind: 'OBSERVED_FACT',
          verification_status: 'UNVERIFIED',
          commercial_status: commercialStatus,
          provenance_lineage: Object.freeze({
            source_id: targetUrl,
            requested_url: targetUrl,
            resolved_source_identity: resolvedSourceIdentity,
            evidence_origin_class: evidenceOriginClass,
            observed_at_utc: capturedAtUtc,
            ttl_seconds: 86400,
            raw_sha256: sieveResult.raw_response_sha256,
            sanitized_sha256: sieveResult.sanitized_dom_sha256,
            extractor_version: 'scw-dom-sieve-v1.0.0'
          })
        })
      };

      const serializedJcs = canonicalizeJCS(sanitizeForJcs(responsePayload));
      const tokensUsed = Math.ceil(sieveResult.sanitized_byte_length / 4);

      return {
        content: [
          {
            type: 'text',
            text: serializedJcs
          }
        ],
        tokens_used: tokensUsed
      };
    }
  });
}

// ============================================================================
// 8. SOURCE CAPTURE WORKER
// ============================================================================

export class SourceCaptureWorker {
  public static readonly WORKER_ID = 'worker:source-capture:v1';
  private readonly broker: McpCapabilityBroker;
  private readonly defaultGrant?: CapabilityGrant;

  constructor(broker: McpCapabilityBroker, defaultGrant?: CapabilityGrant) {
    this.broker = broker;
    this.defaultGrant = defaultGrant;
  }

  public getBroker(): McpCapabilityBroker {
    return this.broker;
  }

  public async captureAndExtract(
    request: SourceCaptureMcpRequest,
    customGrant?: CapabilityGrant
  ): Promise<SourceCaptureMcpResponse> {
    const grant = customGrant ?? this.defaultGrant;
    if (!grant) {
      throw new Error('E-SCW-NO-GRANT: No CapabilityGrant provided for SourceCaptureWorker execution.');
    }

    // Verify status ceiling before dispatch
    if (
      request.custom_commercial_status &&
      request.custom_commercial_status !== 'ADVERTISED_LISTING' &&
      request.custom_commercial_status !== 'SUPPLIER_QUOTE'
    ) {
      throw new Error(
        'E-SCW-STATUS-ESCALATION-FORBIDDEN: Source capture worker is structurally barred from elevating commercial_status.'
      );
    }

    const toolCallRequest: McpToolCallRequest = {
      jsonrpc: '2.0',
      id: request.task_id,
      method: 'tools/call',
      params: {
        name: 'mcp://source-capture/http_get_snapshot',
        arguments: {
          url: request.target_url,
          target_url: request.target_url,
          source_profile: request.source_profile,
          execution_mode: request.execution_mode,
          target_batch_quantity: request.target_batch_quantity,
          fixture_id: request.fixture_id,
          raw_html_payload: request.raw_html_payload,
          extraction_rules: request.extraction_rules,
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
      throw new Error('E-SCW-EMPTY-RESPONSE: Tool call returned empty result content.');
    }

    const parsed: SourceCaptureMcpResponse = JSON.parse(contentItem.text);
    return deepFreeze(parsed);
  }
}
