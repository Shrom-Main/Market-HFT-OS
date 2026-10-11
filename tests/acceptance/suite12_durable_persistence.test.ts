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
import { sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import {
  InMemoryOfferPersistenceDatabaseSession,
  reconcileAmbiguousPromotionCommit
} from '../../src/persistence/atomicPromotion.js';

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
});
