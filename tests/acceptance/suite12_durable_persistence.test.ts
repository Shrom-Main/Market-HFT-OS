import { describe, it, expect } from 'vitest';
import {
  POSTGRES_SCHEMA_DDL,
  PostgresOfferPersistenceDatabaseTransaction,
  PostgresClientLike
} from '../../src/persistence/postgresAdapter.js';
import {
  parseCanonicalStreamSequence,
  CanonicalOffer,
  createCanonicalMoney
} from '../../src/canonical/domain.js';
import { sha256, ed25519Sign } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import {
  InMemoryOfferPersistenceDatabaseSession,
  commitPromotionIfVersionAndConsumeNonces,
  reconcileAmbiguousPromotionCommit
} from '../../src/persistence/atomicPromotion.js';
import {
  evaluateOfferPromotionReadOnly,
  ServiceBoundaryEvaluatorTokenVerifier
} from '../../src/verification/gate.js';
import {
  registerStreamEvidence,
  validateAndBuildClaimSigningPayload,
  VerificationClaimsAssessment
} from '../../src/verification/claims.js';
import { TEST_PRINCIPAL_AUTHORITY_REGISTRY } from '../fixtures/trustedRegistries.js';

describe('SUITE-12: Durable Persistence & Ambiguous Commit Recovery', () => {
  const offer_id = 'off:din3017:sup-01:2026-q4';

  it('DURABLE-SCHEMA-DDL-001: Validates normative PostgreSQL schema DDL constraints and types', () => {
    // 1. All 4 relational tables present
    expect(POSTGRES_SCHEMA_DDL).toContain('CREATE TABLE IF NOT EXISTS offer_stream_heads');
    expect(POSTGRES_SCHEMA_DDL).toContain('CREATE TABLE IF NOT EXISTS offer_stream_events');
    expect(POSTGRES_SCHEMA_DDL).toContain('CREATE TABLE IF NOT EXISTS offer_nonce_store');
    expect(POSTGRES_SCHEMA_DDL).toContain('CREATE TABLE IF NOT EXISTS offer_assessment_store');

    // 2. uint64 upper bound and decimal regex CHECK constraint
    expect(POSTGRES_SCHEMA_DDL).toContain("sequence_number ~ '^(0|[1-9][0-9]*)$'");
    expect(POSTGRES_SCHEMA_DDL).toContain('CAST(sequence_number AS NUMERIC) <= 18446744073709551615');

    // 3. Primary keys and foreign integrity
    expect(POSTGRES_SCHEMA_DDL).toContain('offer_id VARCHAR(128) PRIMARY KEY');
    expect(POSTGRES_SCHEMA_DDL).toContain('PRIMARY KEY (stream_id, sequence_number)');
    expect(POSTGRES_SCHEMA_DDL).toContain('nonce VARCHAR(128) PRIMARY KEY');
    expect(POSTGRES_SCHEMA_DDL).toContain('assessment_sha256 CHAR(64) PRIMARY KEY');
  });

  it('POSTGRES-INIT-ROWLOCK-001: First-time stream initialization acquires exclusive row lock after INSERT ON CONFLICT', async () => {
    const executedQueries: Array<{ sql: string; params?: unknown[] }> = [];
    const mockClient: PostgresClientLike = {
      async query(sql: string, params?: unknown[]) {
        executedQueries.push({ sql, params });
        if (sql.includes('SELECT sequence_number, offer_status FROM offer_stream_heads WHERE offer_id = $1 FOR UPDATE')) {
          if (executedQueries.length === 1) {
            // Initial check: row does not exist yet
            return { rows: [], rowCount: 0 };
          } else {
            // Authoritative re-read after INSERT ON CONFLICT: row exists and is locked
            return {
              rows: [{ sequence_number: '0', offer_status: 'INDICATIVE_QUOTE' }],
              rowCount: 1
            };
          }
        }
        if (sql.includes('INSERT INTO offer_stream_heads')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    };

    const tx = new PostgresOfferPersistenceDatabaseTransaction(mockClient);
    const head = await tx.getOfferStreamHeadForUpdate(offer_id);

    // 1. Returns initial sequence 0 and INDICATIVE_QUOTE
    expect(head.sequence_number).toBe('0');
    expect(head.offer_status).toBe('INDICATIVE_QUOTE');

    // 2. Exactly 3 queries executed in strict order
    expect(executedQueries.length).toBe(3);
    expect(executedQueries[0].sql).toContain('SELECT sequence_number, offer_status FROM offer_stream_heads WHERE offer_id = $1 FOR UPDATE');
    expect(executedQueries[0].params).toEqual([offer_id]);

    expect(executedQueries[1].sql).toContain('INSERT INTO offer_stream_heads');
    expect(executedQueries[1].sql).toContain('ON CONFLICT (offer_id) DO NOTHING');
    expect(executedQueries[1].params).toEqual([offer_id, '0', 'INDICATIVE_QUOTE']);

    expect(executedQueries[2].sql).toContain('SELECT sequence_number, offer_status FROM offer_stream_heads WHERE offer_id = $1 FOR UPDATE');
    expect(executedQueries[2].params).toEqual([offer_id]);
  });

  it('POSTGRES-CONCURRENT-INIT-RACE-002: Concurrent stream initialization authoritatively re-reads locked committed head', async () => {
    const executedQueries: Array<{ sql: string; params?: unknown[] }> = [];
    const mockClient: PostgresClientLike = {
      async query(sql: string, params?: unknown[]) {
        executedQueries.push({ sql, params });
        if (sql.includes('SELECT sequence_number, offer_status FROM offer_stream_heads WHERE offer_id = $1 FOR UPDATE')) {
          if (executedQueries.length === 1) {
            // Initial check: absent
            return { rows: [], rowCount: 0 };
          } else {
            // Concurrent transaction already inserted and committed sequence 1
            return {
              rows: [{ sequence_number: '1', offer_status: 'VERIFIED_EXECUTABLE_OFFER' }],
              rowCount: 1
            };
          }
        }
        if (sql.includes('INSERT INTO offer_stream_heads')) {
          // Conflict detected, 0 rows inserted
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }
    };

    const tx = new PostgresOfferPersistenceDatabaseTransaction(mockClient);
    const head = await tx.getOfferStreamHeadForUpdate(offer_id);

    // Must return the authoritative committed state from the re-read SELECT FOR UPDATE, not stale '0'
    expect(head.sequence_number).toBe('1');
    expect(head.offer_status).toBe('VERIFIED_EXECUTABLE_OFFER');
    expect(executedQueries.length).toBe(3);
  });

  it('CONCURRENT-PROMOTIONS-CAS-CONFLICT-003: Concurrent promotions against the same stream serialize under row-locking; second promotion fails with CONCURRENCY_CONFLICT', async () => {
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
    const EVALUATOR_SECRET_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const PRINCIPAL_KEY_SEED = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
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

    const assessment: VerificationClaimsAssessment = {
      claim_source_authenticity: createSignedClaim(
        'SOURCE_AUTHENTICITY',
        { verification_mechanism: 'BUSINESS_REGISTRY_GSTIN_LOOKUP' },
        'ev:src:c01'
      ) as any,
      claim_price_confirmation: createSignedClaim(
        'PRICE_CONFIRMATION',
        {
          confirmed_unit_price: createCanonicalMoney('105000', 'INR', 4),
          price_evidence_kind: 'PROFORMA_INVOICE'
        },
        'ev:prc:c01'
      ) as any,
      claim_stock_availability: createSignedClaim(
        'STOCK_AVAILABILITY',
        {
          availability_evidence_kind: 'SUPPLIER_INVENTORY_REPORT',
          confirmed_quantity_available: 500,
          inventory_location: 'Hub-1'
        },
        'ev:stk:c01'
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
        'ev:com:c01'
      ) as any
    };

    // Both evaluations evaluate against initial stream sequence '0'
    const draftA = evaluateOfferPromotionReadOnly(offer, assessment, '0', EVALUATOR_SECRET_HEX, nowUtc, TEST_PRINCIPAL_AUTHORITY_REGISTRY);
    const draftB = evaluateOfferPromotionReadOnly(offer, assessment, '0', EVALUATOR_SECRET_HEX, nowUtc, TEST_PRINCIPAL_AUTHORITY_REGISTRY);

    const db = new InMemoryOfferPersistenceDatabaseSession();
    const clock = { nowUtc: () => nowUtc };

    // Fire both promotion transactions concurrently
    const promiseA = commitPromotionIfVersionAndConsumeNonces(db, clock, offer, '0', draftA, assessment, tokenVerifier, TEST_PRINCIPAL_AUTHORITY_REGISTRY);
    const promiseB = commitPromotionIfVersionAndConsumeNonces(db, clock, offer, '0', draftB, assessment, tokenVerifier, TEST_PRINCIPAL_AUTHORITY_REGISTRY);

    const results = await Promise.allSettled([promiseA, promiseB]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Exactly one promotion commits and advances head to sequence 1
    expect(fulfilled.length).toBe(1);
    expect((fulfilled[0] as PromiseFulfilledResult<any>).value.resulting_stream_sequence).toBe('1');

    // Exactly one promotion is rejected with CONCURRENCY_CONFLICT because stream advanced
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('E-ERR-037: CONCURRENCY_CONFLICT');

    // Authoritative stream head is now sequence '1'
    const finalHead = db.heads.get(offer.offer_id);
    expect(finalHead?.sequence_number).toBe('1');
  });

  it('RECONCILE-SUBSEQUENT-EVENT-002: Reconciles committed promotion even when head advanced to higher sequence', async () => {
    const db = new InMemoryOfferPersistenceDatabaseSession();

    // 1. Establish state: promotion committed at sequence 12
    const attemptedSeq = '12';
    const attemptedAssessmentSha = sha256('valid-canonical-assessment-bytes');
    const validAssessmentBytes = Buffer.from('valid-canonical-assessment-bytes', 'utf8');
    await db.assessments.set(attemptedAssessmentSha, { bytes: validAssessmentBytes, created_at_utc: '2026-10-10T12:00:00Z' });

    const promotionPayload: any = {
      offer_id,
      expected_stream_sequence: '11',
      resulting_stream_sequence: '12',
      assessment_id: `asmt:${offer_id}:abc`,
      assessment_sha256: attemptedAssessmentSha,
      policy_version: 'POC-001/PROMOTION_POLICY/v1',
      evaluator_version: 'POC-001/EVALUATOR/v1',
      target_offer_status: 'VERIFIED_EXECUTABLE_OFFER',
      target_verification_status: 'VERIFIED',
      consumed_nonces: ['nonce-gw-01'],
      decision_timestamp_utc: '2026-10-10T12:00:00Z'
    };
    const validEventSha = sha256(canonicalizeJCS(promotionPayload));

    // Store committed event at sequence 12
    db.events.set(`stream:offer:${offer_id}:12`, {
      stream_id: `stream:offer:${offer_id}`,
      sequence_number: parseCanonicalStreamSequence('12'),
      payload_kind: 'OFFER_STATUS_TRANSITION',
      payload: promotionPayload,
      event_sha256: validEventSha,
      created_at_utc: '2026-10-10T12:00:00Z'
    });

    // 2. Later legitimate transaction advances head to sequence 13
    db.heads.set(offer_id, {
      sequence_number: parseCanonicalStreamSequence('13'),
      offer_status: 'VERIFIED_EXECUTABLE_OFFER'
    });

    // 3. Ambiguous commit reconciliation runs
    const recon = await reconcileAmbiguousPromotionCommit(
      db,
      offer_id,
      '11',
      '12',
      attemptedAssessmentSha,
      validEventSha
    );

    expect(recon.outcome).toBe('COMMITTED');
    expect(recon.stream_sequence).toBe('13'); // Authoritative current head
    expect(recon.event_sha256).toBe(validEventSha);
    expect(recon.promotion_event?.offer_id).toBe(offer_id);
  });

  it('RECONCILE-DEFINITIVE-ROLLBACK-003: Establishes definitive rollback when event absent and head unchanged', async () => {
    const db = new InMemoryOfferPersistenceDatabaseSession();

    // Stream head remains at prior sequence 11
    db.heads.set(offer_id, {
      sequence_number: parseCanonicalStreamSequence('11'),
      offer_status: 'INDICATIVE_QUOTE'
    });
    // Attempted sequence 12 event does NOT exist (rolled back)

    const recon = await reconcileAmbiguousPromotionCommit(
      db,
      offer_id,
      '11',
      '12',
      'some_hash'
    );

    expect(recon.outcome).toBe('ROLLED_BACK');
    expect(recon.stream_sequence).toBe('11');
    expect(recon.reason).toContain('original transaction resolved via rollback');
  });

  it('RECONCILE-EVENT-HASH-MISMATCH-004: Detects corrupted event payload digest and invalidates draft', async () => {
    const db = new InMemoryOfferPersistenceDatabaseSession();
    const attemptedAssessmentSha = sha256('assessment-bytes');
    db.assessments.set(attemptedAssessmentSha, { bytes: Buffer.from('assessment-bytes'), created_at_utc: '2026-10-10T12:00:00Z' });

    const promotionPayload: any = {
      offer_id,
      expected_stream_sequence: '11',
      resulting_stream_sequence: '12',
      assessment_sha256: attemptedAssessmentSha
    };

    // Store event with tampered/corrupted stored hash
    db.events.set(`stream:offer:${offer_id}:12`, {
      stream_id: `stream:offer:${offer_id}`,
      sequence_number: parseCanonicalStreamSequence('12'),
      payload_kind: 'OFFER_STATUS_TRANSITION',
      payload: promotionPayload,
      event_sha256: 'ff'.repeat(32), // Tampered hash!
      created_at_utc: '2026-10-10T12:00:00Z'
    });
    db.heads.set(offer_id, { sequence_number: parseCanonicalStreamSequence('12'), offer_status: 'VERIFIED_EXECUTABLE_OFFER' });

    const recon = await reconcileAmbiguousPromotionCommit(db, offer_id, '11', '12', attemptedAssessmentSha);
    expect(recon.outcome).toBe('STREAM_ADVANCED_UNRELATED');
    expect(recon.reason).toContain('failed cryptographic integrity verification');
  });

  it('RECONCILE-ASSESSMENT-HASH-MISMATCH-005: Detects missing or corrupted assessment store bytes', async () => {
    const db = new InMemoryOfferPersistenceDatabaseSession();
    const attemptedAssessmentSha = sha256('expected-assessment-bytes');
    // Assessment store has corrupted bytes
    db.assessments.set(attemptedAssessmentSha, { bytes: Buffer.from('corrupted-bytes'), created_at_utc: '2026-10-10T12:00:00Z' });

    const promotionPayload: any = {
      offer_id,
      expected_stream_sequence: '11',
      resulting_stream_sequence: '12',
      assessment_sha256: attemptedAssessmentSha
    };
    const validEventSha = sha256(canonicalizeJCS(promotionPayload));

    db.events.set(`stream:offer:${offer_id}:12`, {
      stream_id: `stream:offer:${offer_id}`,
      sequence_number: parseCanonicalStreamSequence('12'),
      payload_kind: 'OFFER_STATUS_TRANSITION',
      payload: promotionPayload,
      event_sha256: validEventSha,
      previous_event_hash: '0'.repeat(64),
      created_at_utc: '2026-10-10T12:00:00Z'
    });
    db.heads.set(offer_id, { sequence_number: parseCanonicalStreamSequence('12'), offer_status: 'VERIFIED_EXECUTABLE_OFFER' });

    const recon = await reconcileAmbiguousPromotionCommit(db, offer_id, '11', '12', attemptedAssessmentSha);
    expect(recon.outcome).toBe('STREAM_ADVANCED_UNRELATED');
  });

  it('RECONCILE-LOCK-TIMEOUT-006: Preserves OUTCOME_UNKNOWN with stream_sequence: null on lock timeout', async () => {
    const db = new InMemoryOfferPersistenceDatabaseSession();
    db.simulate_lock_timeout = true;

    const recon = await reconcileAmbiguousPromotionCommit(db, offer_id, '11', '12', 'hash');
    expect(recon.outcome).toBe('OUTCOME_UNKNOWN');
    expect(recon.stream_sequence).toBeNull();
  });

  it('RECONCILE-DATABASE-UNAVAILABLE-007: Preserves OUTCOME_UNKNOWN with stream_sequence: null on network severing', async () => {
    const db = new InMemoryOfferPersistenceDatabaseSession();
    db.simulate_connection_failure = true;

    const recon = await reconcileAmbiguousPromotionCommit(db, offer_id, '11', '12', 'hash');
    expect(recon.outcome).toBe('OUTCOME_UNKNOWN');
    expect(recon.stream_sequence).toBeNull();
  });

  it('PERSIST-STREAM-HASH-CHAIN-008: Verifies previous_event_hash chaining across stream event transitions', async () => {
    const db = new InMemoryOfferPersistenceDatabaseSession();
    const stream_id = 'stream:offer:off_chain_test';

    await db.executeTransaction(async (tx) => {
      await tx.appendOfferStreamEvent({
        stream_id,
        sequence_number: parseCanonicalStreamSequence('0'),
        payload_kind: 'OFFER_STATUS_TRANSITION',
        payload: {
          offer_id: 'off_chain_test',
          expected_stream_sequence: '0',
          resulting_stream_sequence: parseCanonicalStreamSequence('0'),
          assessment_id: 'asmt:0',
          assessment_sha256: 'a'.repeat(64),
          claims_evidence_summary: { summary: 'genesis' },
          policy_version: 'v1.0',
          evaluator_version: 'eval-v1',
          target_offer_status: 'INDICATIVE_QUOTE',
          target_verification_status: 'UNVERIFIED',
          consumed_nonces: [],
          decision_timestamp_utc: '2026-10-10T00:00:00Z'
        },
        event_sha256: '1'.repeat(64),
        previous_event_hash: '0'.repeat(64),
        created_at_utc: '2026-10-10T00:00:00Z'
      });

      await tx.appendOfferStreamEvent({
        stream_id,
        sequence_number: parseCanonicalStreamSequence('1'),
        payload_kind: 'OFFER_STATUS_TRANSITION',
        payload: {
          offer_id: 'off_chain_test',
          expected_stream_sequence: '0',
          resulting_stream_sequence: parseCanonicalStreamSequence('1'),
          assessment_id: 'asmt:1',
          assessment_sha256: 'b'.repeat(64),
          claims_evidence_summary: { summary: 'promoted' },
          policy_version: 'v1.0',
          evaluator_version: 'eval-v1',
          target_offer_status: 'VERIFIED_EXECUTABLE_OFFER',
          target_verification_status: 'VERIFIED',
          consumed_nonces: [],
          decision_timestamp_utc: '2026-10-10T01:00:00Z'
        },
        event_sha256: '2'.repeat(64),
        previous_event_hash: '1'.repeat(64),
        created_at_utc: '2026-10-10T01:00:00Z'
      });
    });

    const ev0 = await db.executeTransaction(tx => tx.getOfferStreamEvent(stream_id, parseCanonicalStreamSequence('0')));
    const ev1 = await db.executeTransaction(tx => tx.getOfferStreamEvent(stream_id, parseCanonicalStreamSequence('1')));

    expect(ev0).not.toBeNull();
    expect(ev0!.previous_event_hash).toBe('0'.repeat(64));
    expect(ev1).not.toBeNull();
    expect(ev1!.previous_event_hash).toBe(ev0!.event_sha256);
  });
});
