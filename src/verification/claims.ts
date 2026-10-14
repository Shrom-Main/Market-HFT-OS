import {
  CanonicalMoney,
  createCanonicalMoney,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256, ed25519Verify } from '../canonical/crypto.js';

export type AttesterRole =
  | 'PORTFOLIO_MANAGER'
  | 'COMMERCIAL_SOURCING_SPECIALIST'
  | 'WAREHOUSE_OPERATIONS_MANAGER'
  | 'SUPPLY_CHAIN_ANALYST'
  | 'COMPLIANCE_OFFICER'
  | 'LEGAL_COUNSEL'
  | 'RISK_OFFICER'
  | 'VERIFIED_EXTERNAL_ORACLE';

export interface RegisteredPrincipal {
  principal_id: string;
  principal_type: 'HUMAN_OPERATOR' | 'CRYPTOGRAPHIC_ORACLE';
  assigned_roles: AttesterRole[];
  public_key_hex: string;
  valid_from_utc: string;
  valid_until_utc: string;
  revoked: boolean;
  revoked_at_utc?: string;
  compromised?: boolean;
}

export type PrincipalAuthorityRegistry = Readonly<Record<string, RegisteredPrincipal>>;

export interface RegisteredGateway {
  gateway_id: string;
  public_key_hex: string;
  valid_from_utc: string;
  valid_until_utc: string;
  revoked: boolean;
  revoked_at_utc?: string;
  compromised?: boolean;
}

export interface GatewayClaimEndorsementReceipt {
  auth_gateway_id: string;
  claim_signing_payload_sha256: string;
  claim_payload_digest?: string;
  domain_tag: 'GATEWAY_CLAIM_ENDORSEMENT';
  expires_at_utc: string;
  issued_at_utc: string;
  nonce: string;
  operator_id: string;
  operator_role: AttesterRole;
  schema_version: 'POC-001/GATEWAY_ENDORSEMENT/v1';
  gateway_signature: string;
}

export type ClaimAuthentication =
  | {
      auth_mechanism: 'DIRECT_KEY_SIGNATURE';
      attestation_signature?: string;
      direct_signature?: string;
    }
  | {
      auth_mechanism: 'GATEWAY_CLAIM_ENDORSEMENT';
      endorsement_receipt: GatewayClaimEndorsementReceipt;
    };

export interface ClaimAttestation {
  evidence_id: string;
  evidence_sha256: string;
  attester_id: string;
  attested_at_utc: string;
  claimed_role: AttesterRole;
  epistemic_type: 'HUMAN_EXPERT_DOCUMENT_APPRAISAL' | 'AUTOMATED_CRYPTOGRAPHIC_EXTRACT';
  auth: ClaimAuthentication;
}

export interface SourceAuthenticityParameters {
  verification_mechanism: 'BUSINESS_REGISTRY_GSTIN_LOOKUP' | 'DOMAIN_CERTIFICATE_PKI' | 'PHYSICAL_AUDIT_ON_SITE';
}

export interface PriceConfirmationParameters {
  confirmed_unit_price: CanonicalMoney;
  price_evidence_kind: 'PROFORMA_INVOICE' | 'SIGNED_QUOTATION' | 'PUBLISHED_OFFICIAL_TARIFF';
}

export interface StockVerificationParameters {
  availability_evidence_kind: 'SUPPLIER_INVENTORY_REPORT' | 'FACTORY_LEAD_TIME_COMMITMENT';
  confirmed_quantity_available: number;
  inventory_location: string;
}

export type IncotermsCode = 'EXW' | 'FCA' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP' | 'FAS' | 'FOB' | 'CFR' | 'CIF';

export interface CommercialTermsParameters {
  incoterms: IncotermsCode;
  minimum_order_quantity: number;
  payment_terms_days: number;
  terms_evidence_kind: 'SUPPLIER_CONTRACT' | 'PROFORMA_INVOICE' | 'FORMAL_TERMS_SCHEDULE';
  valid_until_utc: string;
}

export interface VerificationClaim<TParams> {
  claim_type: 'SOURCE_AUTHENTICITY' | 'PRICE_CONFIRMATION' | 'STOCK_AVAILABILITY' | 'COMMERCIAL_TERMS';
  claim_parameters: TParams;
  attestation: ClaimAttestation;
}

export type AnyVerificationClaim =
  | VerificationClaim<SourceAuthenticityParameters>
  | VerificationClaim<PriceConfirmationParameters>
  | VerificationClaim<StockVerificationParameters>
  | VerificationClaim<CommercialTermsParameters>;

export interface VerificationClaimsAssessment {
  claim_source_authenticity: VerificationClaim<SourceAuthenticityParameters>;
  claim_price_confirmation: VerificationClaim<PriceConfirmationParameters>;
  claim_stock_availability: VerificationClaim<StockVerificationParameters>;
  claim_commercial_terms: VerificationClaim<CommercialTermsParameters>;
}

export interface ClaimSigningPayload {
  schema_version: 'POC-001/CLAIM_ATTESTATION/v1';
  domain_tag: 'CLAIM_ATTESTATION';
  offer_id: string;
  product_id: string;
  claim_type: 'SOURCE_AUTHENTICITY' | 'PRICE_CONFIRMATION' | 'STOCK_AVAILABILITY' | 'COMMERCIAL_TERMS';
  claimed_role: AttesterRole;
  evidence_id: string;
  evidence_sha256: string;
  attester_id: string;
  attested_at_utc: string;
  claim_parameters: Record<string, unknown>;
}

export interface ProvenanceMetadata {
  observed_at_utc: string;
  is_authenticated_source_feed?: boolean;
  occurred_at_raw?: string;
  is_historical_import?: boolean;
}

export interface ResolvedEvidenceEnvelope {
  evidence_id: string;
  event_sha256: string;
  provenance: ProvenanceMetadata;
  evidence_kind?: string;
  verification_status?: string;
  offer_status?: string;
  document_type?: string;
}

// Production authority is deliberately empty until a verified bootstrap supplies principals.
// Test keys live under tests/fixtures and are passed explicitly by test callers.
export const PRINCIPAL_AUTHORITY_REGISTRY: PrincipalAuthorityRegistry = Object.freeze({});

export const GATEWAY_AUTHORITY_REGISTRY: Record<string, RegisteredGateway> = {
  'gw:auth:platform-core-01': {
    gateway_id: 'gw:auth:platform-core-01',
    public_key_hex: '43cdc023d22d5f9e107d1a0693457d35d1d10eb7d21c721192f56f5de40665d3',
    valid_from_utc: '2026-01-01T00:00:00Z',
    valid_until_utc: '2027-01-01T00:00:00Z',
    revoked: false
  }
};

export const STREAM_EVIDENCE_REGISTRY: Map<string, ResolvedEvidenceEnvelope> = new Map();

export function resolveStreamEvidence(evidence_id: string): ResolvedEvidenceEnvelope | undefined {
  return STREAM_EVIDENCE_REGISTRY.get(evidence_id);
}

export function registerStreamEvidence(ev: ResolvedEvidenceEnvelope): void {
  STREAM_EVIDENCE_REGISTRY.set(ev.evidence_id, ev);
}

/**
 * Strict Input-Shape Validation Before Dereferencing (AUDIT-14)
 */
export function validateAssessmentStructure(assessment: unknown): asserts assessment is VerificationClaimsAssessment {
  if (!assessment || typeof assessment !== 'object') {
    throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Assessment payload must be a non-null object');
  }
  const obj = assessment as Record<string, unknown>;
  const requiredSlots = [
    'claim_source_authenticity',
    'claim_price_confirmation',
    'claim_stock_availability',
    'claim_commercial_terms'
  ];
  for (const slot of requiredSlots) {
    if (!obj[slot] || typeof obj[slot] !== 'object') {
      throw new Error(`E-ERR-024: INVALID_CLAIM_PARAMETERS: Missing or malformed required slot '${slot}'`);
    }
  }
  const allowedKeys = new Set(requiredSlots);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`E-ERR-024: INVALID_CLAIM_PARAMETERS: Unexpected extraneous slot '${key}' in assessment`);
    }
  }

  const src = obj.claim_source_authenticity as Record<string, unknown>;
  const prc = obj.claim_price_confirmation as Record<string, unknown>;
  const stk = obj.claim_stock_availability as Record<string, unknown>;
  const com = obj.claim_commercial_terms as Record<string, unknown>;

  if (src.claim_type !== 'SOURCE_AUTHENTICITY') throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Invalid claim_type in claim_source_authenticity');
  if (prc.claim_type !== 'PRICE_CONFIRMATION') throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Invalid claim_type in claim_price_confirmation');
  if (stk.claim_type !== 'STOCK_AVAILABILITY') throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Invalid claim_type in claim_stock_availability');
  if (com.claim_type !== 'COMMERCIAL_TERMS') throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Invalid claim_type in claim_commercial_terms');

  for (const item of [src, prc, stk, com]) {
    if (!item.attestation || typeof item.attestation !== 'object') {
      throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Missing attestation object');
    }
    if (!item.claim_parameters || typeof item.claim_parameters !== 'object') {
      throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Missing claim_parameters object');
    }
  }
}

/**
 * Shared Normative Gateway Receipt Validator (AUDIT-13, AUDIT-24)
 */
export function validateGatewayEndorsementReceipt(
  rcpt: GatewayClaimEndorsementReceipt,
  current_time_utc: string,
  gateway_registry: Record<string, RegisteredGateway> = GATEWAY_AUTHORITY_REGISTRY
): void {
  validateIso8601UtcTimestamp(rcpt.issued_at_utc);
  validateIso8601UtcTimestamp(rcpt.expires_at_utc);
  validateIso8601UtcTimestamp(current_time_utc);

  const issued_ms = Date.parse(rcpt.issued_at_utc);
  const expires_ms = Date.parse(rcpt.expires_at_utc);
  const current_ms = Date.parse(current_time_utc);

  // 1. Exact 300,000 ms duration check
  if (expires_ms - issued_ms !== 300000) {
    throw new Error('E-ERR-027: INVALID_GATEWAY_RECEIPT_LIFETIME: Expiration interval must be exactly 300,000 ms (5 minutes)');
  }

  // 2. Strict Future clock-skew upper bound (5,000 ms policy tolerance, AUDIT-31)
  const MAX_FUTURE_CLOCK_SKEW_MS = 5000;
  if (issued_ms > current_ms + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error('E-ERR-007: CLOCK_SKEW_EXCEEDED: Gateway receipt issuance timestamp exceeds future tolerance (5,000 ms)');
  }

  // 3. Inclusive upper bound on expiry (current_ms <= expires_ms is valid; current_ms > expires_ms rejects)
  if (current_ms > expires_ms) {
    throw new Error('E-ERR-027: GATEWAY_RECEIPT_EXPIRED: Gateway receipt validity window has expired');
  }

  // 4. Nonce regex check
  if (!/^[a-zA-Z0-9_-]{16,64}$/.test(rcpt.nonce)) {
    throw new Error('E-ERR-024: INVALID_NONCE_FORMAT: Nonce must be 16-64 base64url/alphanumeric characters');
  }

  // 5. Gateway Authority Registry Pre-Validation
  const gateway = gateway_registry[rcpt.auth_gateway_id];
  if (!gateway) {
    throw new Error('E-ERR-017: INVALID_OR_MISSING_ATTESTATION_AUTHENTICATION: Unregistered gateway ID');
  }
  validateIso8601UtcTimestamp(gateway.valid_from_utc);
  validateIso8601UtcTimestamp(gateway.valid_until_utc);
  const gw_from_ms = Date.parse(gateway.valid_from_utc);
  const gw_until_ms = Date.parse(gateway.valid_until_utc);
  if (issued_ms < gw_from_ms || issued_ms > gw_until_ms) {
    throw new Error('E-ERR-017: INVALID_OR_MISSING_ATTESTATION_AUTHENTICATION: Gateway key not valid at receipt issuance time');
  }
  if (gateway.compromised) {
    throw new Error('E-ERR-017: INVALID_OR_MISSING_ATTESTATION_AUTHENTICATION: Gateway key is compromised');
  }
  if (gateway.revoked) {
    if (!gateway.revoked_at_utc) throw new Error('E-ERR-017: INVALID_OR_MISSING_ATTESTATION_AUTHENTICATION: Revoked gateway missing revocation timestamp');
    validateIso8601UtcTimestamp(gateway.revoked_at_utc);
    const gw_rev_ms = Date.parse(gateway.revoked_at_utc);
    if (issued_ms >= gw_rev_ms) {
      throw new Error('E-ERR-017: INVALID_OR_MISSING_ATTESTATION_AUTHENTICATION: Gateway receipt issued at or after revocation timestamp');
    }
  }

  // 6. Cryptographic Ed25519 Signature Verification
  const { gateway_signature, ...unsigned_rcpt } = rcpt;
  const unsigned_bytes = Buffer.from(canonicalizeJCS(unsigned_rcpt), 'utf8');
  if (!ed25519Verify(unsigned_bytes, gateway.public_key_hex, gateway_signature)) {
    throw new Error('E-ERR-017: INVALID_OR_MISSING_ATTESTATION_AUTHENTICATION: Gateway Ed25519 signature invalid');
  }
}

export function validateAttesterAuthority(
  attester_id: string,
  claimed_role: AttesterRole,
  claim_type: 'SOURCE_AUTHENTICITY' | 'PRICE_CONFIRMATION' | 'STOCK_AVAILABILITY' | 'COMMERCIAL_TERMS',
  attested_at_utc: string,
  current_time_utc: string,
  principal_registry: PrincipalAuthorityRegistry = PRINCIPAL_AUTHORITY_REGISTRY
): RegisteredPrincipal {
  validateIso8601UtcTimestamp(attested_at_utc);
  validateIso8601UtcTimestamp(current_time_utc);

  const principal = principal_registry[attester_id];
  if (!principal || principal.principal_id !== attester_id) {
    throw new Error('E-ERR-018: INSUFFICIENT_ATTESTER_ROLE: Unregistered principal');
  }

  if (principal.principal_type === 'HUMAN_OPERATOR' && claimed_role === 'VERIFIED_EXTERNAL_ORACLE') {
    throw new Error('E-ERR-018: INSUFFICIENT_ATTESTER_ROLE: Human operator cannot assert external oracle role');
  }

  const required_roles: Record<string, AttesterRole[]> = {
    SOURCE_AUTHENTICITY: ['COMPLIANCE_OFFICER', 'PORTFOLIO_MANAGER', 'RISK_OFFICER'],
    PRICE_CONFIRMATION: ['PORTFOLIO_MANAGER', 'COMMERCIAL_SOURCING_SPECIALIST', 'VERIFIED_EXTERNAL_ORACLE'],
    STOCK_AVAILABILITY: ['PORTFOLIO_MANAGER', 'WAREHOUSE_OPERATIONS_MANAGER', 'SUPPLY_CHAIN_ANALYST', 'VERIFIED_EXTERNAL_ORACLE'],
    COMMERCIAL_TERMS: ['PORTFOLIO_MANAGER', 'COMMERCIAL_SOURCING_SPECIALIST', 'LEGAL_COUNSEL']
  };
  if (!principal.assigned_roles.includes(claimed_role) || !required_roles[claim_type].includes(claimed_role)) {
    throw new Error('E-ERR-018: INSUFFICIENT_ATTESTER_ROLE: Role not assigned or not authorized for claim type');
  }

  const attested_ms = Date.parse(attested_at_utc);
  const current_ms = Date.parse(current_time_utc);
  const from_ms = Date.parse(principal.valid_from_utc);
  const until_ms = Date.parse(principal.valid_until_utc);

  if (attested_ms > current_ms + 300000) {
    throw new Error('E-ERR-026: FUTURE_DATED_ATTESTATION: Attestation timestamp exceeds maximum allowable future clock skew (300s)');
  }
  if (attested_ms < from_ms || attested_ms > until_ms) {
    throw new Error('E-ERR-019: OPERATOR_KEY_REVOKED: Principal key validity window elapsed at attestation time');
  }

  if (principal.compromised) {
    throw new Error('E-ERR-019: OPERATOR_KEY_REVOKED: Principal key compromised (retroactive invalidation)');
  }

  if (principal.revoked) {
    if (!principal.revoked_at_utc) {
      throw new Error('E-ERR-019: OPERATOR_KEY_REVOKED: Revoked principal missing revocation timestamp');
    }
    try {
      validateIso8601UtcTimestamp(principal.revoked_at_utc);
    } catch {
      throw new Error('E-ERR-019: OPERATOR_KEY_REVOKED: Invalid revocation timestamp format');
    }
    const revoked_ms = Date.parse(principal.revoked_at_utc);
    if (attested_ms >= revoked_ms) {
      throw new Error('E-ERR-019: OPERATOR_KEY_REVOKED: Attestation signed at or after key revocation timestamp');
    }
  }

  return principal;
}

/**
 * Strict Builder with Schema Validation & Exact Lifetime Check (AUDIT-13)
 */
export function validateAndBuildClaimSigningPayload(
  offer_id: string,
  product_id: string,
  claim: AnyVerificationClaim
): ClaimSigningPayload {
  if (typeof offer_id !== 'string' || !offer_id.startsWith('off:') ||
      typeof product_id !== 'string' || !product_id.startsWith('prod:')) {
    throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Malformed offer_id or product_id');
  }

  validateIso8601UtcTimestamp(claim.attestation.attested_at_utc);
  if (!/^[a-f0-9]{64}$/.test(claim.attestation.evidence_sha256)) {
    throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Malformed evidence SHA-256');
  }

  // Exact 300-second lifetime enforcement on gateway endorsements (AUDIT-13)
  if (claim.attestation.auth.auth_mechanism === 'GATEWAY_CLAIM_ENDORSEMENT') {
    const rcpt = claim.attestation.auth.endorsement_receipt;
    validateIso8601UtcTimestamp(rcpt.issued_at_utc);
    validateIso8601UtcTimestamp(rcpt.expires_at_utc);
    const iss_ms = Date.parse(rcpt.issued_at_utc);
    const exp_ms = Date.parse(rcpt.expires_at_utc);
    if (exp_ms - iss_ms !== 300000) {
      throw new Error('E-ERR-027: INVALID_GATEWAY_RECEIPT_LIFETIME: Expiration interval must be exactly 300,000 ms (5 minutes)');
    }
  }

  let claim_parameters: Record<string, unknown>;

  if (claim.claim_type === 'SOURCE_AUTHENTICITY') {
    const params = claim.claim_parameters as SourceAuthenticityParameters;
    const validMechs = ['BUSINESS_REGISTRY_GSTIN_LOOKUP', 'DOMAIN_CERTIFICATE_PKI', 'PHYSICAL_AUDIT_ON_SITE'];
    if (!params.verification_mechanism || !validMechs.includes(params.verification_mechanism)) {
      throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Invalid verification mechanism');
    }
    claim_parameters = { verification_mechanism: params.verification_mechanism };
  } else if (claim.claim_type === 'PRICE_CONFIRMATION') {
    const params = claim.claim_parameters as PriceConfirmationParameters;
    const validKinds = ['PROFORMA_INVOICE', 'SIGNED_QUOTATION', 'PUBLISHED_OFFICIAL_TARIFF'];
    if (!params.price_evidence_kind || !validKinds.includes(params.price_evidence_kind)) {
      throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Invalid price evidence kind');
    }
    const p = params.confirmed_unit_price;
    if (!p || typeof p !== 'object') throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Missing confirmed_unit_price');
    const validatedMoney = createCanonicalMoney(p.amount_subunits, p.currency, p.scale);
    if (BigInt(validatedMoney.amount_subunits) <= 0n) {
      throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Price must be strictly positive');
    }
    claim_parameters = {
      confirmed_unit_price: validatedMoney,
      price_evidence_kind: params.price_evidence_kind
    };
  } else if (claim.claim_type === 'STOCK_AVAILABILITY') {
    const params = claim.claim_parameters as StockVerificationParameters;
    const validKinds = ['SUPPLIER_INVENTORY_REPORT', 'FACTORY_LEAD_TIME_COMMITMENT'];
    if (!params.availability_evidence_kind || !validKinds.includes(params.availability_evidence_kind)) {
      throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Invalid stock availability evidence kind');
    }
    if (!Number.isSafeInteger(params.confirmed_quantity_available) || params.confirmed_quantity_available <= 0) {
      throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: confirmed_quantity_available must be positive safe integer');
    }
    claim_parameters = {
      availability_evidence_kind: params.availability_evidence_kind,
      confirmed_quantity_available: params.confirmed_quantity_available,
      inventory_location: typeof params.inventory_location === 'string' ? params.inventory_location : ''
    };
  } else if (claim.claim_type === 'COMMERCIAL_TERMS') {
    const params = claim.claim_parameters as CommercialTermsParameters;
    const validInco: IncotermsCode[] = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'];
    if (!validInco.includes(params.incoterms)) {
      throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Invalid Incoterms code');
    }
    if (!Number.isSafeInteger(params.minimum_order_quantity) || params.minimum_order_quantity <= 0) {
      throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: minimum_order_quantity must be positive safe integer');
    }
    if (!Number.isSafeInteger(params.payment_terms_days) || params.payment_terms_days < 0) {
      throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: payment_terms_days must be non-negative safe integer');
    }
    const validKinds = ['SUPPLIER_CONTRACT', 'PROFORMA_INVOICE', 'FORMAL_TERMS_SCHEDULE'];
    if (!params.terms_evidence_kind || !validKinds.includes(params.terms_evidence_kind)) {
      throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Invalid terms evidence kind');
    }
    validateIso8601UtcTimestamp(params.valid_until_utc);
    claim_parameters = {
      incoterms: params.incoterms,
      minimum_order_quantity: params.minimum_order_quantity,
      payment_terms_days: params.payment_terms_days,
      terms_evidence_kind: params.terms_evidence_kind,
      valid_until_utc: params.valid_until_utc
    };
  } else {
    throw new Error('E-ERR-024: INVALID_CLAIM_PARAMETERS: Unknown claim type');
  }

  return {
    schema_version: 'POC-001/CLAIM_ATTESTATION/v1',
    domain_tag: 'CLAIM_ATTESTATION',
    offer_id,
    product_id,
    claim_type: claim.claim_type,
    claimed_role: claim.attestation.claimed_role,
    evidence_id: claim.attestation.evidence_id,
    evidence_sha256: claim.attestation.evidence_sha256,
    attester_id: claim.attestation.attester_id,
    attested_at_utc: claim.attestation.attested_at_utc,
    claim_parameters
  };
}
