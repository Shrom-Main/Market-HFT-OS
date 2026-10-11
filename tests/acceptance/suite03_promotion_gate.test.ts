import { describe, it, expect, beforeEach } from 'vitest';
import {
  CanonicalOffer,
  createCanonicalMoney,
  parseCanonicalStreamSequence
} from '../../src/canonical/domain.js';
import { ed25519Sign, sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import {
  VerificationClaimsAssessment,
  registerStreamEvidence,
  validateAndBuildClaimSigningPayload
} from '../../src/verification/claims.js';
import {
  evaluateOfferPromotionReadOnly,
  ServiceBoundaryEvaluatorTokenVerifier,
  generateEvaluatorDecisionAuthToken,
  validateEvaluationDraftIntegrity
} from '../../src/verification/gate.js';
import {
  SystemTrustedClock,
  InMemoryOfferPersistenceDatabaseSession,
  commitPromotionIfVersionAndConsumeNonces,
  reconcileAmbiguousPromotionCommit
} from '../../src/persistence/atomicPromotion.js';

const EVALUATOR_SECRET_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const PRINCIPAL_KEY_SEED = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';

describe('SUITE-03: Two-Phase Promotion Gate & Atomic Persistence', () => {
  const offer: CanonicalOffer = {
    offer_id: 'off:din3017:sup-01:2026-q4',
    product_id: 'prod:din3017:16-25mm',
    unit_price: createCanonicalMoney('105000', 'INR', 4),
    minimum_order_quantity: 10,
    payment_terms_days: 30,
    incoterms: 'EXW',
    valid_until_utc: '2026-12-31T00:00:00Z',
    offer_status: 'INDICATIVE_QUOTE',
    verification_status: 'UNVERIFIED'
  };

  const nowUtc = '2026-10-10T12:00:00Z';
  const tokenVerifier = new ServiceBoundaryEvaluatorTokenVerifier(EVALUATOR_SECRET_HEX);

  function createSignedClaim(claimType: any, params: any, evidenceId: string) {
    const evSha = sha256(`content:${evidenceId}`);
    registerStreamEvidence({
      evidence_id: evidenceId,
      event_sha256: evSha,
      provenance: {
        observed_at_utc: nowUtc,
        is_authenticated_source_feed: true
      }
    });

    const unsignedClaim = {
      claim_type: claimType,
      claim_parameters: params,
      attestation: {
        evidence_id: evidenceId,
        evidence_sha256: evSha,
        attester_id: 'op:sec:shrom-principal-01',
        attested_at_utc: nowUtc,
        claimed_role: 'PORTFOLIO_MANAGER' as const,
        epistemic_type: 'HUMAN_EXPERT_DOCUMENT_APPRAISAL' as const,
        auth: {
          auth_mechanism: 'DIRECT_KEY_SIGNATURE' as const
        }
      }
    };

    const signingPayload = validateAndBuildClaimSigningPayload(offer.offer_id, offer.product_id, unsignedClaim as any);
    const payloadBytes = Buffer.from(canonicalizeJCS(signingPayload), 'utf8');
    const signature = ed25519Sign(payloadBytes, PRINCIPAL_KEY_SEED);

    return {
      ...unsignedClaim,
      attestation: {
        ...unsignedClaim.attestation,
        auth: {
          auth_mechanism: 'DIRECT_KEY_SIGNATURE' as const,
          direct_signature: signature,
          attestation_signature: signature
        }
      }
    };
  }

  function createValidAssessment(): VerificationClaimsAssessment {
    return {
      claim_source_authenticity: createSignedClaim(
        'SOURCE_AUTHENTICITY',
        { verification_mechanism: 'BUSINESS_REGISTRY_GSTIN_LOOKUP' },
        'ev:src:001'
      ) as any,
      claim_price_confirmation: createSignedClaim(
        'PRICE_CONFIRMATION',
        {
          confirmed_unit_price: createCanonicalMoney('105000', 'INR', 4),
          price_evidence_kind: 'PROFORMA_INVOICE'
        },
        'ev:prc:001'
      ) as any,
      claim_stock_availability: createSignedClaim(
        'STOCK_AVAILABILITY',
        {
          availability_evidence_kind: 'SUPPLIER_INVENTORY_REPORT',
          confirmed_quantity_available: 500,
          inventory_location: 'Hub-1'
        },
        'ev:stk:001'
      ) as any,
      claim_commercial_terms: createSignedClaim(
        'COMMERCIAL_TERMS',
        {
          incoterms: 'EXW',
          minimum_order_quantity: 10,
          payment_terms_days: 30,
          terms_evidence_kind: 'PROFORMA_INVOICE',
          valid_until_utc: '2026-12-31T00:00:00Z'
        },
        'ev:com:001'
      ) as any
    };
  }

  it('SEQUENCE-CANON-DECIMAL-035: Rejects leading zeros and negative numbers', () => {
    expect(() => parseCanonicalStreamSequence('01')).toThrow(/E-ERR-024: INVALID_SEQUENCE_FORMAT/);
    expect(() => parseCanonicalStreamSequence('-1')).toThrow(/E-ERR-024: INVALID_SEQUENCE_FORMAT/);
    expect(parseCanonicalStreamSequence('0')).toBe('0');
    expect(parseCanonicalStreamSequence('12')).toBe('12');
  });

  it('PROMO-GATE-PASS-010: Passes gate and commits atomically with 4 fresh claims', async () => {
    const assessment = createValidAssessment();
    const draft = evaluateOfferPromotionReadOnly(offer, assessment, '0', EVALUATOR_SECRET_HEX, nowUtc);

    expect(draft.promoted).toBe(true);
    expect(draft.assigned_offer_status).toBe('VERIFIED_EXECUTABLE_OFFER');

    const db = new InMemoryOfferPersistenceDatabaseSession();
    const clock = new SystemTrustedClock();

    const event = await commitPromotionIfVersionAndConsumeNonces(
      db,
      clock,
      offer,
      '0',
      draft,
      assessment,
      tokenVerifier
    );

    expect(event.resulting_stream_sequence).toBe('1');
    expect(event.target_offer_status).toBe('VERIFIED_EXECUTABLE_OFFER');

    // Verify stored assessment in database matches canonical bytes bitwise
    const storedAssessmentBytes = await db.getAssessment(draft.assessment_sha256);
    expect(storedAssessmentBytes).not.toBeNull();
    expect(sha256(storedAssessmentBytes!)).toBe(draft.assessment_sha256);
  });

  it('EVAL-DECISION-HMAC-COVERAGE-039: Tampered evaluation draft fails HMAC verification', () => {
    const assessment = createValidAssessment();
    const draft = evaluateOfferPromotionReadOnly(offer, assessment, '0', EVALUATOR_SECRET_HEX, nowUtc);

    // Tamper with assigned status
    const tampered = { ...draft, assigned_offer_status: 'INDICATIVE_QUOTE' as const };
    expect(tokenVerifier.verifyEvaluatorToken(tampered)).toBe(false);
  });

  it('RECONCILE-AMBIGUOUS-COMMIT-045 & RECONCILE-SUBSEQUENT-EVENT-HEAD-046: Reconciles committed promotion even when head advanced', async () => {
    const assessment = createValidAssessment();
    const draft = evaluateOfferPromotionReadOnly(offer, assessment, '0', EVALUATOR_SECRET_HEX, nowUtc);
    const db = new InMemoryOfferPersistenceDatabaseSession();
    const clock = new SystemTrustedClock();

    // Commit promotion at sequence 1
    const event = await commitPromotionIfVersionAndConsumeNonces(
      db,
      clock,
      offer,
      '0',
      draft,
      assessment,
      tokenVerifier
    );

    // Simulate subsequent unrelated event advancing head to sequence 2
    db.heads.set(offer.offer_id, {
      sequence_number: parseCanonicalStreamSequence('2'),
      offer_status: 'VERIFIED_EXECUTABLE_OFFER'
    });

    // Authoritative reconciliation must inspect event at sequence 1 and report COMMITTED
    const recon = await reconcileAmbiguousPromotionCommit(
      db,
      offer.offer_id,
      '0',
      '1',
      draft.assessment_sha256
    );

    expect(recon.outcome).toBe('COMMITTED');
    expect(recon.stream_sequence).toBe('2'); // Reports current head
    expect(recon.promotion_event?.offer_id).toBe(offer.offer_id);
  });

  it('RECONCILE-EVENT-HASH-MISMATCH-047: Detects corrupted event and rejects as STREAM_ADVANCED_UNRELATED', async () => {
    const assessment = createValidAssessment();
    const draft = evaluateOfferPromotionReadOnly(offer, assessment, '0', EVALUATOR_SECRET_HEX, nowUtc);
    const db = new InMemoryOfferPersistenceDatabaseSession();
    const clock = new SystemTrustedClock();

    await commitPromotionIfVersionAndConsumeNonces(db, clock, offer, '0', draft, assessment, tokenVerifier);

    // Corrupt stored event_sha256
    const key = `stream:offer:${offer.offer_id}:1`;
    const evRecord = db.events.get(key)!;
    db.events.set(key, { ...evRecord, event_sha256: '00'.repeat(32) });

    const recon = await reconcileAmbiguousPromotionCommit(db, offer.offer_id, '0', '1', draft.assessment_sha256);
    expect(recon.outcome).toBe('STREAM_ADVANCED_UNRELATED');
  });

  it('RECONCILE-LOCK-TIMEOUT-UNKNOWN-049: Preserves OUTCOME_UNKNOWN with stream_sequence: null on database failure', async () => {
    const db = new InMemoryOfferPersistenceDatabaseSession();
    db.simulate_lock_timeout = true;

    const recon = await reconcileAmbiguousPromotionCommit(db, offer.offer_id, '0', '1', 'some_hash');
    expect(recon.outcome).toBe('OUTCOME_UNKNOWN');
    expect(recon.stream_sequence).toBeNull();
  });
});
