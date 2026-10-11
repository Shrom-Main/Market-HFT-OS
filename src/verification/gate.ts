import crypto from 'node:crypto';
import {
  CommercialOfferStatus,
  VerificationStatus,
  CanonicalOffer,
  CanonicalStreamSequence,
  parseCanonicalStreamSequence,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256, hmacSha256, ed25519Verify } from '../canonical/crypto.js';
import {
  AttesterRole,
  AnyVerificationClaim,
  VerificationClaimsAssessment,
  ResolvedEvidenceEnvelope,
  resolveStreamEvidence,
  validateAssessmentStructure,
  validateGatewayEndorsementReceipt,
  validateAttesterAuthority,
  validateAndBuildClaimSigningPayload,
  GATEWAY_AUTHORITY_REGISTRY
} from './claims.js';

export interface CommercialReconciliationResult {
  reconciled: boolean;
  assigned_offer_status: CommercialOfferStatus;
  assigned_verification_status: VerificationStatus;
  rejection_reason?: string;
}

export function reconcileOfferClaims(
  offer: CanonicalOffer,
  assessment: VerificationClaimsAssessment,
  resolved_evidence: Record<string, ResolvedEvidenceEnvelope>,
  current_time_utc: string
): CommercialReconciliationResult {
  const current_ms = Date.parse(current_time_utc);

  // Check for historical import in any evidence (E-ERR-032)
  for (const ev of Object.values(resolved_evidence)) {
    if (ev.provenance?.is_historical_import) {
      throw new Error('E-ERR-032: HISTORICAL_EVIDENCE_NOT_EXECUTABLE: Backfilled historical evidence cannot promote to executable offer');
    }
  }

  // 1. Commercial Terms Reconciliation & Observation Freshness
  const terms = assessment.claim_commercial_terms.claim_parameters;
  const terms_ev = resolved_evidence[assessment.claim_commercial_terms.attestation.evidence_id] || resolved_evidence['COMMERCIAL_TERMS'];
  validateIso8601UtcTimestamp(terms.valid_until_utc);
  const valid_until_ms = Date.parse(terms.valid_until_utc);
  if (current_ms > valid_until_ms) {
    return { reconciled: false, assigned_offer_status: 'EXPIRED_OFFER', assigned_verification_status: 'STALE', rejection_reason: 'Commercial terms validity expired' };
  }
  validateIso8601UtcTimestamp(terms_ev.provenance.observed_at_utc);
  const terms_obs_ms = Date.parse(terms_ev.provenance.observed_at_utc);
  if (terms_obs_ms > current_ms + 300000) throw new Error('E-ERR-007: CLOCK_SKEW_EXCEEDED');
  if (current_ms - terms_obs_ms > 604800000) {
    return { reconciled: false, assigned_offer_status: 'INDICATIVE_QUOTE', assigned_verification_status: 'PARTIALLY_VERIFIED', rejection_reason: 'Commercial terms evidence observation exceeds 7-day freshness window' };
  }
  if (terms.minimum_order_quantity !== offer.minimum_order_quantity) throw new Error('E-ERR-029: OFFER_MOQ_CLAIM_MISMATCH');
  if (terms.payment_terms_days !== offer.payment_terms_days) throw new Error('E-ERR-030: OFFER_PAYMENT_TERMS_MISMATCH');
  if (terms.incoterms !== offer.incoterms) throw new Error('E-ERR-031: OFFER_INCOTERMS_MISMATCH');

  // 2. Price Confirmation Reconciliation & Freshness
  const price = assessment.claim_price_confirmation.claim_parameters.confirmed_unit_price;
  if (price.currency !== offer.unit_price.currency ||
      price.scale !== offer.unit_price.scale ||
      BigInt(price.amount_subunits) !== BigInt(offer.unit_price.amount_subunits)) {
    throw new Error('E-ERR-028: OFFER_PRICE_CLAIM_MISMATCH');
  }
  const price_ev = resolved_evidence[assessment.claim_price_confirmation.attestation.evidence_id] || resolved_evidence['PRICE_CONFIRMATION'];
  const price_ts = (price_ev.provenance.is_authenticated_source_feed && price_ev.provenance.occurred_at_raw)
    ? price_ev.provenance.occurred_at_raw
    : price_ev.provenance.observed_at_utc;
  validateIso8601UtcTimestamp(price_ts);
  const price_ms = Date.parse(price_ts);
  if (price_ms > current_ms + 300000) throw new Error('E-ERR-007: CLOCK_SKEW_EXCEEDED');
  if (current_ms - price_ms > 604800000) {
    return { reconciled: false, assigned_offer_status: 'INDICATIVE_QUOTE', assigned_verification_status: 'PARTIALLY_VERIFIED', rejection_reason: 'Price confirmation exceeds 7-day freshness window' };
  }

  // 3. Stock Availability Reconciliation & Freshness
  const stock = assessment.claim_stock_availability.claim_parameters;
  const stock_ev = resolved_evidence[assessment.claim_stock_availability.attestation.evidence_id] || resolved_evidence['STOCK_AVAILABILITY'];
  validateIso8601UtcTimestamp(stock_ev.provenance.observed_at_utc);
  const stock_ms = Date.parse(stock_ev.provenance.observed_at_utc);
  if (stock_ms > current_ms + 300000) throw new Error('E-ERR-007: CLOCK_SKEW_EXCEEDED');
  if (current_ms - stock_ms > 172800000) {
    return { reconciled: false, assigned_offer_status: 'INDICATIVE_QUOTE', assigned_verification_status: 'PARTIALLY_VERIFIED', rejection_reason: 'Stock availability exceeds 48-hour freshness window' };
  }
  if (stock.confirmed_quantity_available < offer.minimum_order_quantity) {
    return { reconciled: false, assigned_offer_status: 'INDICATIVE_QUOTE', assigned_verification_status: 'PARTIALLY_VERIFIED', rejection_reason: 'Confirmed stock quantity below offer MOQ' };
  }

  // 4. Source Authenticity Freshness
  const src_ev = resolved_evidence[assessment.claim_source_authenticity.attestation.evidence_id] || resolved_evidence['SOURCE_AUTHENTICITY'];
  validateIso8601UtcTimestamp(src_ev.provenance.observed_at_utc);
  const src_ms = Date.parse(src_ev.provenance.observed_at_utc);
  if (src_ms > current_ms + 300000) throw new Error('E-ERR-007: CLOCK_SKEW_EXCEEDED');
  if (current_ms - src_ms > 2592000000) {
    return { reconciled: false, assigned_offer_status: 'INDICATIVE_QUOTE', assigned_verification_status: 'PARTIALLY_VERIFIED', rejection_reason: 'Source authenticity evidence exceeds 30-day freshness window' };
  }

  return { reconciled: true, assigned_offer_status: 'VERIFIED_EXECUTABLE_OFFER', assigned_verification_status: 'VERIFIED' };
}

export interface ClaimEvidenceReference {
  claim_type: 'SOURCE_AUTHENTICITY' | 'PRICE_CONFIRMATION' | 'STOCK_AVAILABILITY' | 'COMMERCIAL_TERMS';
  evidence_id: string;
  evidence_sha256: string;
  parameters_canonical_sha256: string;
  attester_id: string;
  claimed_role: AttesterRole;
  auth_mechanism: 'DIRECT_KEY_SIGNATURE' | 'GATEWAY_CLAIM_ENDORSEMENT';
  gateway_id?: string;
  gateway_receipt_sha256?: string;
  gateway_nonce?: string;
}

export interface PromotionEvaluationDraft {
  schema_version: 'POC-001/PROMOTION_EVALUATION_DRAFT/v1';
  offer_id: string;
  expected_stream_sequence: CanonicalStreamSequence;
  assessment_id: string;
  assessment_sha256: string;
  evaluator_auth_token: string;
  claims_evidence_summary: Record<string, ClaimEvidenceReference>;
  policy_version: 'POC-001/PROMOTION_POLICY/v1';
  evaluator_version: 'POC-001/EVALUATOR/v1';
  evaluated_at_utc: string;
  promoted: boolean;
  assigned_offer_status: CommercialOfferStatus;
  assigned_verification_status: VerificationStatus;
  rejection_reason?: string;
  nonces_to_consume: { nonce: string; expires_at_utc: string; gateway_id: string }[];
}

export interface ValidatedPromotionEvaluation {
  readonly draft: Readonly<PromotionEvaluationDraft>;
  readonly raw_claims: Readonly<Record<string, AnyVerificationClaim>>;
  readonly canonical_assessment_bytes: Buffer;
  readonly assessment_sha256: string;
  readonly validated_at_utc: string;
}

export const PROMOTION_POLICY_REGISTRY: Record<string, { policy_version: string; allowlist_version: string }> = {
  'POC-001/PROMOTION_POLICY/v1': { policy_version: 'POC-001/PROMOTION_POLICY/v1', allowlist_version: '18-TUPLE-ALLOWLIST/v1' }
};

export const EVALUATOR_REGISTRY: Record<string, { evaluator_version: string; engine_release: string; service_key_id: string }> = {
  'POC-001/EVALUATOR/v1': { evaluator_version: 'POC-001/EVALUATOR/v1', engine_release: 'GATE-M1-EVAL-v1.13', service_key_id: 'op:sec:evaluator-service-01' }
};

function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj && typeof obj === 'object' && !ArrayBuffer.isView(obj) && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.getOwnPropertyNames(obj)) {
      deepFreeze((obj as Record<string, unknown>)[key]);
    }
  }
  return obj;
}

export interface EvaluatorDecisionSigningPayload {
  domain_tag: 'POC-001/EVALUATOR_DECISION_AUTH/v1';
  offer_id: string;
  expected_stream_sequence: CanonicalStreamSequence;
  assessment_id: string;
  assessment_sha256: string;
  policy_version: string;
  evaluator_version: string;
  promoted: boolean;
  assigned_offer_status: CommercialOfferStatus;
  assigned_verification_status: VerificationStatus;
  rejection_reason?: string;
  claims_evidence_summary: Record<string, ClaimEvidenceReference>;
  nonces_to_consume: { nonce: string; expires_at_utc: string; gateway_id: string }[];
  evaluated_at_utc: string;
}

export interface EvaluatorTokenVerifier {
  verifyEvaluatorToken(draft: PromotionEvaluationDraft): boolean;
}

export class ServiceBoundaryEvaluatorTokenVerifier implements EvaluatorTokenVerifier {
  private readonly secret_buffer: Buffer;

  constructor(evaluator_secret_hex: string) {
    if (!evaluator_secret_hex || !/^[0-9a-fA-F]{64}$/.test(evaluator_secret_hex)) {
      throw new Error('E-ERR-017: INVALID_EVALUATOR_SECRET: Secret must be a 64-character (256-bit) hex string');
    }
    this.secret_buffer = Buffer.from(evaluator_secret_hex, 'hex');
  }

  public verifyEvaluatorToken(draft: PromotionEvaluationDraft): boolean {
    if (!draft.evaluator_auth_token || !/^[0-9a-fA-F]{64}$/.test(draft.evaluator_auth_token)) {
      return false;
    }

    const signingPayload: EvaluatorDecisionSigningPayload = {
      domain_tag: 'POC-001/EVALUATOR_DECISION_AUTH/v1',
      offer_id: draft.offer_id,
      expected_stream_sequence: draft.expected_stream_sequence,
      assessment_id: draft.assessment_id,
      assessment_sha256: draft.assessment_sha256,
      policy_version: draft.policy_version,
      evaluator_version: draft.evaluator_version,
      promoted: draft.promoted,
      assigned_offer_status: draft.assigned_offer_status,
      assigned_verification_status: draft.assigned_verification_status,
      ...(draft.rejection_reason !== undefined ? { rejection_reason: draft.rejection_reason } : {}),
      claims_evidence_summary: draft.claims_evidence_summary,
      nonces_to_consume: draft.nonces_to_consume,
      evaluated_at_utc: draft.evaluated_at_utc
    };

    const canonical_bytes = Buffer.from(canonicalizeJCS(signingPayload), 'utf8');
    const expected_token_hex = hmacSha256(this.secret_buffer, canonical_bytes);

    const expected_buf = Buffer.from(expected_token_hex, 'hex');
    const actual_buf = Buffer.from(draft.evaluator_auth_token, 'hex');
    if (expected_buf.length !== actual_buf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expected_buf, actual_buf);
  }
}

export function generateEvaluatorDecisionAuthToken(
  evaluator_secret_hex: string,
  signing_payload: EvaluatorDecisionSigningPayload
): string {
  const canonical_payload_json = canonicalizeJCS(signing_payload);
  return hmacSha256(Buffer.from(evaluator_secret_hex, 'hex'), Buffer.from(canonical_payload_json, 'utf8'));
}

export function validateEvaluationDraftIntegrity(
  draft: PromotionEvaluationDraft,
  offer: CanonicalOffer,
  expected_sequence: string,
  raw_assessment: unknown,
  token_verifier: EvaluatorTokenVerifier,
  trusted_time_utc: string
): ValidatedPromotionEvaluation {
  if (!draft || typeof draft !== 'object') {
    throw new Error('E-ERR-024: INVALID_DRAFT: Draft must be a non-null object');
  }
  if (draft.schema_version !== 'POC-001/PROMOTION_EVALUATION_DRAFT/v1') {
    throw new Error('E-ERR-024: INVALID_DRAFT: Unsupported draft schema version');
  }
  if (draft.offer_id !== offer.offer_id) {
    throw new Error(`E-ERR-024: INVALID_DRAFT: Draft offer_id '${draft.offer_id}' does not match target offer '${offer.offer_id}'`);
  }

  const canonical_expected_seq = parseCanonicalStreamSequence(expected_sequence);
  const canonical_draft_seq = parseCanonicalStreamSequence(draft.expected_stream_sequence);
  if (BigInt(canonical_draft_seq) !== BigInt(canonical_expected_seq)) {
    throw new Error(`E-ERR-024: INVALID_DRAFT: Draft expected sequence '${draft.expected_stream_sequence}' does not match requested sequence '${expected_sequence}'`);
  }

  validateIso8601UtcTimestamp(draft.evaluated_at_utc);
  validateIso8601UtcTimestamp(trusted_time_utc);

  validateAssessmentStructure(raw_assessment);

  const canonical_assessment_bytes = Buffer.from(canonicalizeJCS(raw_assessment), 'utf8');
  const computed_assessment_sha256 = sha256(canonical_assessment_bytes);
  if (draft.assessment_sha256 !== computed_assessment_sha256) {
    throw new Error('E-ERR-024: INVALID_DRAFT: Draft assessment_sha256 does not match canonical assessment digest');
  }

  if (!token_verifier.verifyEvaluatorToken(draft)) {
    throw new Error('E-ERR-017: INVALID_EVALUATOR_AUTH_TOKEN: Draft does not bear a valid signature from trusted promotion evaluator');
  }

  if (!PROMOTION_POLICY_REGISTRY[draft.policy_version]) {
    throw new Error(`E-ERR-024: INVALID_DRAFT: Unregistered policy_version '${draft.policy_version}'`);
  }
  if (!EVALUATOR_REGISTRY[draft.evaluator_version]) {
    throw new Error(`E-ERR-024: INVALID_DRAFT: Unregistered evaluator_version '${draft.evaluator_version}'`);
  }

  const rawObj = raw_assessment as unknown as Record<string, unknown>;
  const assessmentClaims: Record<string, AnyVerificationClaim> = {
    SOURCE_AUTHENTICITY: rawObj.claim_source_authenticity as AnyVerificationClaim,
    PRICE_CONFIRMATION: rawObj.claim_price_confirmation as AnyVerificationClaim,
    STOCK_AVAILABILITY: rawObj.claim_stock_availability as AnyVerificationClaim,
    COMMERCIAL_TERMS: rawObj.claim_commercial_terms as AnyVerificationClaim
  };

  const requiredClaims = ['SOURCE_AUTHENTICITY', 'PRICE_CONFIRMATION', 'STOCK_AVAILABILITY', 'COMMERCIAL_TERMS'];
  const summaryKeys = Object.keys(draft.claims_evidence_summary);
  if (summaryKeys.length !== 4) {
    throw new Error('E-ERR-024: INVALID_DRAFT: claims_evidence_summary must contain exactly 4 claim references');
  }

  const expectedNonces: { nonce: string; gateway_id: string; expires_at_utc: string }[] = [];
  const allowedRefKeys = [
    'claim_type', 'evidence_id', 'evidence_sha256', 'parameters_canonical_sha256',
    'attester_id', 'claimed_role', 'auth_mechanism', 'gateway_id', 'gateway_receipt_sha256', 'gateway_nonce'
  ];

  for (const c of requiredClaims) {
    const claim = assessmentClaims[c];
    if (!claim || typeof claim !== 'object' || claim.claim_type !== c) {
      throw new Error(`E-ERR-024: INVALID_DRAFT: Missing or malformed claim '${c}' in raw_assessment`);
    }

    const ref = draft.claims_evidence_summary[c];
    if (!ref || typeof ref !== 'object') {
      throw new Error(`E-ERR-024: INVALID_DRAFT: Missing claim evidence reference for '${c}' in draft summary`);
    }

    for (const k of Object.keys(ref)) {
      if (!allowedRefKeys.includes(k) && (ref as unknown as Record<string, unknown>)[k] !== undefined) {
        throw new Error(`E-ERR-024: INVALID_DRAFT: Extraneous key '${k}' in claims_evidence_summary['${c}']`);
      }
    }

    const params_canonical_bytes = Buffer.from(canonicalizeJCS(claim.claim_parameters), 'utf8');
    const expected_params_sha256 = sha256(params_canonical_bytes);

    if (ref.claim_type !== c) throw new Error(`E-ERR-024: INVALID_DRAFT: claim_type mismatch in summary for '${c}'`);
    if (ref.evidence_id !== claim.attestation.evidence_id) throw new Error(`E-ERR-024: INVALID_DRAFT: evidence_id mismatch in summary for '${c}'`);
    if (ref.evidence_sha256 !== claim.attestation.evidence_sha256) throw new Error(`E-ERR-024: INVALID_DRAFT: evidence_sha256 mismatch in summary for '${c}'`);
    if (ref.parameters_canonical_sha256 !== expected_params_sha256) throw new Error(`E-ERR-024: INVALID_DRAFT: parameters_canonical_sha256 mismatch in summary for '${c}'`);
    if (ref.attester_id !== claim.attestation.attester_id) throw new Error(`E-ERR-024: INVALID_DRAFT: attester_id mismatch in summary for '${c}'`);
    if (ref.claimed_role !== claim.attestation.claimed_role) throw new Error(`E-ERR-024: INVALID_DRAFT: claimed_role mismatch in summary for '${c}'`);
    if (ref.auth_mechanism !== claim.attestation.auth.auth_mechanism) throw new Error(`E-ERR-024: INVALID_DRAFT: auth_mechanism mismatch in summary for '${c}'`);

    if (!['DIRECT_KEY_SIGNATURE', 'GATEWAY_CLAIM_ENDORSEMENT'].includes(ref.auth_mechanism)) {
      throw new Error(`E-ERR-017: INVALID_AUTH_MECHANISM: Unsupported auth_mechanism '${ref.auth_mechanism}'`);
    }

    if (claim.attestation.auth.auth_mechanism === 'GATEWAY_CLAIM_ENDORSEMENT') {
      const rcpt = claim.attestation.auth.endorsement_receipt;
      if (!rcpt || typeof rcpt !== 'object') {
        throw new Error(`E-ERR-017: INVALID_RECEIPT: Missing endorsement receipt in gateway claim '${c}'`);
      }
      const rcpt_bytes = Buffer.from(canonicalizeJCS(rcpt), 'utf8');
      const expected_rcpt_sha256 = sha256(rcpt_bytes);

      if (ref.gateway_id !== rcpt.auth_gateway_id) throw new Error(`E-ERR-024: INVALID_DRAFT: gateway_id mismatch in summary for '${c}'`);
      if (ref.gateway_receipt_sha256 !== expected_rcpt_sha256) throw new Error(`E-ERR-024: INVALID_DRAFT: gateway_receipt_sha256 mismatch in summary for '${c}'`);
      if (ref.gateway_nonce !== rcpt.nonce) throw new Error(`E-ERR-024: INVALID_DRAFT: gateway_nonce mismatch in summary for '${c}'`);

      expectedNonces.push({ nonce: rcpt.nonce, gateway_id: rcpt.auth_gateway_id, expires_at_utc: rcpt.expires_at_utc });
    } else if (claim.attestation.auth.auth_mechanism === 'DIRECT_KEY_SIGNATURE') {
      if (ref.gateway_id !== undefined || ref.gateway_receipt_sha256 !== undefined || ref.gateway_nonce !== undefined) {
        throw new Error(`E-ERR-024: INVALID_DRAFT: Direct key signature claim '${c}' cannot contain gateway fields`);
      }
    }
  }

  const uniqueNonces = new Set(expectedNonces.map(n => n.nonce));
  if (uniqueNonces.size !== expectedNonces.length) {
    throw new Error('E-ERR-024: DUPLICATE_NONCE_IN_ASSESSMENT: Duplicate gateway nonce detected across claims');
  }

  if (draft.promoted) {
    if (draft.assigned_offer_status !== 'VERIFIED_EXECUTABLE_OFFER' || draft.assigned_verification_status !== 'VERIFIED') {
      throw new Error('E-ERR-024: INVALID_DRAFT: Contradictory status: promoted=true requires VERIFIED_EXECUTABLE_OFFER and VERIFIED');
    }
    if (draft.rejection_reason !== undefined) {
      throw new Error('E-ERR-024: INVALID_DRAFT: Contradictory draft: promoted=true cannot contain rejection_reason');
    }

    if (draft.nonces_to_consume.length !== expectedNonces.length) {
      throw new Error(`E-ERR-024: INVALID_DRAFT: nonces_to_consume count (${draft.nonces_to_consume.length}) does not match derived gateway claims (${expectedNonces.length})`);
    }
    const derivedNonceMap = new Map(expectedNonces.map(n => [n.nonce, n]));
    for (const item of draft.nonces_to_consume) {
      const derived = derivedNonceMap.get(item.nonce);
      if (!derived || derived.gateway_id !== item.gateway_id || derived.expires_at_utc !== item.expires_at_utc) {
        throw new Error(`E-ERR-024: INVALID_DRAFT: Unbound or mismatched nonce '${item.nonce}' in nonces_to_consume`);
      }
      validateIso8601UtcTimestamp(item.expires_at_utc);
    }
  } else {
    if (draft.assigned_offer_status === 'VERIFIED_EXECUTABLE_OFFER' || draft.assigned_verification_status === 'VERIFIED') {
      throw new Error('E-ERR-024: INVALID_DRAFT: Contradictory status: promoted=false cannot assign VERIFIED statuses');
    }
    if (draft.nonces_to_consume.length > 0) {
      throw new Error('E-ERR-024: INVALID_DRAFT: Contradictory draft: promoted=false must have empty nonces_to_consume');
    }
    if (typeof draft.rejection_reason !== 'string' || draft.rejection_reason.trim().length === 0) {
      throw new Error('E-ERR-024: INVALID_DRAFT: Contradictory draft: promoted=false requires non-empty rejection_reason string');
    }
  }

  return deepFreeze({
    draft,
    raw_claims: assessmentClaims,
    canonical_assessment_bytes,
    assessment_sha256: computed_assessment_sha256,
    validated_at_utc: trusted_time_utc
  });
}

export function evaluateOfferPromotionReadOnly(
  offer: CanonicalOffer,
  assessment: unknown,
  expected_stream_sequence: string,
  evaluator_secret_hex: string,
  current_time_utc: string
): PromotionEvaluationDraft {
  const canonical_seq = parseCanonicalStreamSequence(expected_stream_sequence);
  validateAssessmentStructure(assessment);
  validateIso8601UtcTimestamp(current_time_utc);

  const assessment_bytes = Buffer.from(canonicalizeJCS(assessment), 'utf8');
  const assessment_sha256 = sha256(assessment_bytes);
  const assessment_id = `asmt:${offer.offer_id}:${assessment_sha256.substring(0, 16)}`;

  const typedAssessment = assessment as VerificationClaimsAssessment;
  const claims: AnyVerificationClaim[] = [
    typedAssessment.claim_source_authenticity,
    typedAssessment.claim_price_confirmation,
    typedAssessment.claim_stock_availability,
    typedAssessment.claim_commercial_terms
  ];

  const resolved_evidence: Record<string, ResolvedEvidenceEnvelope> = {};
  const claims_evidence_summary: Record<string, ClaimEvidenceReference> = {};
  const nonces_to_consume: { nonce: string; expires_at_utc: string; gateway_id: string }[] = [];

  for (const claim of claims) {
    const payload = validateAndBuildClaimSigningPayload(offer.offer_id, offer.product_id, claim);
    const payload_bytes = Buffer.from(canonicalizeJCS(payload), 'utf8');
    const params_sha256 = sha256(Buffer.from(canonicalizeJCS(payload.claim_parameters), 'utf8'));

    const ev = resolveStreamEvidence(claim.attestation.evidence_id);
    if (!ev || ev.event_sha256 !== claim.attestation.evidence_sha256) {
      throw new Error('E-ERR-012: UNRESOLVABLE_EVIDENCE_REFERENCE');
    }
    resolved_evidence[claim.claim_type] = ev;
    resolved_evidence[claim.attestation.evidence_id] = ev;

    let claim_ref: ClaimEvidenceReference;

    if (claim.attestation.auth.auth_mechanism === 'DIRECT_KEY_SIGNATURE') {
      const sig = claim.attestation.auth.direct_signature || claim.attestation.auth.attestation_signature;
      if (!sig || !/^[0-9a-fA-F]{128}$/.test(sig)) {
        throw new Error('E-ERR-017: INVALID_SIGNATURE_FORMAT');
      }

      const principal = validateAttesterAuthority(
        claim.attestation.attester_id,
        claim.attestation.claimed_role,
        claim.claim_type,
        claim.attestation.attested_at_utc,
        current_time_utc
      );

      if (!ed25519Verify(payload_bytes, principal.public_key_hex, sig)) {
        throw new Error('E-ERR-017: INVALID_OR_MISSING_ATTESTATION_AUTHENTICATION');
      }

      claim_ref = {
        claim_type: claim.claim_type,
        evidence_id: claim.attestation.evidence_id,
        evidence_sha256: claim.attestation.evidence_sha256,
        parameters_canonical_sha256: params_sha256,
        attester_id: claim.attestation.attester_id,
        claimed_role: claim.attestation.claimed_role,
        auth_mechanism: 'DIRECT_KEY_SIGNATURE'
      };
    } else if (claim.attestation.auth.auth_mechanism === 'GATEWAY_CLAIM_ENDORSEMENT') {
      const rcpt = claim.attestation.auth.endorsement_receipt;
      if (!rcpt) throw new Error('E-ERR-017: MISSING_GATEWAY_RECEIPT');

      const expectedPayloadDigest = rcpt.claim_payload_digest || rcpt.claim_signing_payload_sha256;
      const actualDigest = sha256(payload_bytes);
      if (expectedPayloadDigest !== actualDigest && expectedPayloadDigest !== params_sha256) {
        throw new Error('E-ERR-017: INVALID_OR_MISSING_ATTESTATION_AUTHENTICATION');
      }

      validateAttesterAuthority(
        claim.attestation.attester_id,
        claim.attestation.claimed_role,
        claim.claim_type,
        claim.attestation.attested_at_utc,
        current_time_utc
      );

      validateGatewayEndorsementReceipt(rcpt, current_time_utc, GATEWAY_AUTHORITY_REGISTRY);

      const rcpt_bytes = Buffer.from(canonicalizeJCS(rcpt), 'utf8');
      const rcpt_sha256 = sha256(rcpt_bytes);

      claim_ref = {
        claim_type: claim.claim_type,
        evidence_id: claim.attestation.evidence_id,
        evidence_sha256: claim.attestation.evidence_sha256,
        parameters_canonical_sha256: params_sha256,
        attester_id: claim.attestation.attester_id,
        claimed_role: claim.attestation.claimed_role,
        auth_mechanism: 'GATEWAY_CLAIM_ENDORSEMENT',
        gateway_id: rcpt.auth_gateway_id,
        gateway_receipt_sha256: rcpt_sha256,
        gateway_nonce: rcpt.nonce
      };

      nonces_to_consume.push({ nonce: rcpt.nonce, expires_at_utc: rcpt.expires_at_utc, gateway_id: rcpt.auth_gateway_id });
    } else {
      throw new Error('E-ERR-017: INVALID_OR_MISSING_ATTESTATION_AUTHENTICATION');
    }

    claims_evidence_summary[claim.claim_type] = claim_ref;
  }

  const recon = reconcileOfferClaims(offer, typedAssessment, resolved_evidence, current_time_utc);
  const promoted = recon.reconciled;
  const policy_version = 'POC-001/PROMOTION_POLICY/v1';

  const signing_payload: EvaluatorDecisionSigningPayload = {
    domain_tag: 'POC-001/EVALUATOR_DECISION_AUTH/v1',
    offer_id: offer.offer_id,
    expected_stream_sequence: canonical_seq,
    assessment_id,
    assessment_sha256,
    policy_version,
    evaluator_version: 'POC-001/EVALUATOR/v1',
    promoted,
    assigned_offer_status: recon.assigned_offer_status,
    assigned_verification_status: recon.assigned_verification_status,
    ...(recon.rejection_reason !== undefined ? { rejection_reason: recon.rejection_reason } : {}),
    claims_evidence_summary,
    nonces_to_consume: promoted ? nonces_to_consume : [],
    evaluated_at_utc: current_time_utc
  };

  const eval_token = generateEvaluatorDecisionAuthToken(evaluator_secret_hex, signing_payload);

  return {
    schema_version: 'POC-001/PROMOTION_EVALUATION_DRAFT/v1',
    offer_id: offer.offer_id,
    expected_stream_sequence: canonical_seq,
    assessment_id,
    assessment_sha256,
    evaluator_auth_token: eval_token,
    claims_evidence_summary,
    policy_version,
    evaluator_version: 'POC-001/EVALUATOR/v1',
    evaluated_at_utc: current_time_utc,
    promoted,
    assigned_offer_status: recon.assigned_offer_status,
    assigned_verification_status: recon.assigned_verification_status,
    rejection_reason: recon.rejection_reason,
    nonces_to_consume: promoted ? nonces_to_consume : []
  };
}
