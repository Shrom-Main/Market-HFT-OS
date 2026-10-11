import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  PostgresNativePoolAdapter,
  POSTGRES_SCHEMA_DDL,
  PostgresOfferPersistenceDatabaseSession
} from '../../src/persistence/postgresAdapter.js';
import {
  CanonicalOffer,
  parseCanonicalStreamSequence,
  createCanonicalMoney
} from '../../src/canonical/domain.js';
import { reconcileAmbiguousPromotionCommit } from '../../src/persistence/atomicPromotion.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import { sha256 } from '../../src/canonical/crypto.js';

const dbUrl = process.env.DATABASE_URL;
const isDbConfigured = Boolean(dbUrl && dbUrl.trim().length > 0);

describe('SUITE-17: Gate M3 — Real PostgreSQL Persistence & Concurrency Integration', () => {
  if (!isDbConfigured) {
    it('M3-REAL-POSTGRES-STATUS-001: [OPEN / CONDITIONALLY GATED] Real PostgreSQL acceptance item requires external PostgreSQL instance (DATABASE_URL)', () => {
      // Explains status: unit emulator passes in Suite 16; real database integration remains OPEN until DATABASE_URL is configured.
      expect(isDbConfigured).toBe(false);
      console.log(
        '[INTEGRATION AUDIT NOTICE] Real PostgreSQL integration suite is conditionally gated: ' +
        'DATABASE_URL environment variable is not configured. Real PostgreSQL acceptance item remains OPEN. ' +
        'Protocol unit verification is proven via in-memory PostgreSQL emulator in Suite 16.'
      );
    });

    it.skip('M3-REAL-POSTGRES-ROWLOCK-002: Real PostgreSQL SELECT ... FOR UPDATE serializes concurrent TCP client connections', async () => {});
    it.skip('M3-REAL-POSTGRES-ROLLBACK-003: Real PostgreSQL transaction rollback discards staged writes without dirty records', async () => {});
    it.skip('M3-REAL-POSTGRES-AMBIGUOUS-COMMIT-004: Real PostgreSQL ambiguous commit reconciliation recovers committed stream head', async () => {});
    return;
  }

  // Live PostgreSQL integration tests executed when DATABASE_URL is provided
  let pool: pg.Pool;
  let adapter: PostgresNativePoolAdapter;
  let session: PostgresOfferPersistenceDatabaseSession;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 5 });
    adapter = new PostgresNativePoolAdapter(pool);
    session = new PostgresOfferPersistenceDatabaseSession(adapter);

    // Apply DDL schema
    const client = await pool.connect();
    try {
      await client.query(POSTGRES_SCHEMA_DDL);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('M3-REAL-POSTGRES-ROWLOCK-002: Real PostgreSQL SELECT ... FOR UPDATE serializes concurrent TCP client connections', async () => {
    const testOfferId = `live-off-${Date.now()}`;
    const tx1 = await session.beginTransaction();
    const head1 = await tx1.getOfferStreamHeadForUpdate(testOfferId);
    expect(head1.sequence_number).toBe('0');

    let tx2Acquired = false;
    let head2Seq = '';

    // Launch concurrent transaction on separate TCP connection
    const tx2Promise = (async () => {
      const tx2 = await session.beginTransaction();
      const head2 = await tx2.getOfferStreamHeadForUpdate(testOfferId);
      tx2Acquired = true;
      head2Seq = head2.sequence_number;
      await tx2.commit();
    })();

    // Verify tx2 is blocked while tx1 holds row lock
    await new Promise(r => setTimeout(r, 100));
    expect(tx2Acquired).toBe(false);

    // Update and commit tx1
    await tx1.advanceOfferStreamHead(testOfferId, parseCanonicalStreamSequence('1'), 'FIRM_QUOTE', new Date().toISOString());
    await tx1.commit();

    // tx2 unblocks and reads committed sequence '1'
    await tx2Promise;
    expect(tx2Acquired).toBe(true);
    expect(head2Seq).toBe('1');
  });

  it('M3-REAL-POSTGRES-ROLLBACK-003: Real PostgreSQL transaction rollback discards staged writes without dirty records', async () => {
    const testOfferId = `live-off-rollback-${Date.now()}`;
    const tx = await session.beginTransaction();
    await tx.getOfferStreamHeadForUpdate(testOfferId);
    await tx.advanceOfferStreamHead(testOfferId, parseCanonicalStreamSequence('1'), 'FIRM_QUOTE', new Date().toISOString());
    await tx.rollback();

    // Verify aborted writes do not persist in live database
    const verifyTx = await session.beginTransaction();
    const verifyHead = await verifyTx.getOfferStreamHeadForUpdate(testOfferId);
    expect(verifyHead.sequence_number).toBe('0'); // uninitialized default, staged seq 1 was dropped
    await verifyTx.rollback();
  });
});
