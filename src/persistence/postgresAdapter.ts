import {
  CommercialOfferStatus,
  CanonicalStreamSequence,
  OfferPromotionEventPayload,
  parseCanonicalStreamSequence,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';
import {
  OfferPersistenceDatabaseSession,
  OfferPersistenceDatabaseTransaction
} from './atomicPromotion.js';

/**
 * Normative PostgreSQL DDL Schema Script
 * Conforms to §4.1 (AUDIT-37, AUDIT-42, AUDIT-49)
 */
export const POSTGRES_SCHEMA_DDL = `
-- 1. Offer Stream Heads Table with uint64 and decimal check constraint
CREATE TABLE IF NOT EXISTS offer_stream_heads (
  offer_id VARCHAR(128) PRIMARY KEY,
  sequence_number VARCHAR(64) NOT NULL,
  offer_status VARCHAR(64) NOT NULL,
  updated_at_utc TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_stream_sequence_bounds CHECK (
    sequence_number ~ '^(0|[1-9][0-9]*)$' AND 
    CAST(sequence_number AS NUMERIC) <= 18446744073709551615
  )
);

-- 2. Offer Stream Events Append-Only Log
CREATE TABLE IF NOT EXISTS offer_stream_events (
  stream_id VARCHAR(128) NOT NULL,
  sequence_number VARCHAR(64) NOT NULL,
  payload_kind VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  event_sha256 CHAR(64) NOT NULL,
  created_at_utc TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (stream_id, sequence_number),
  CONSTRAINT chk_event_sequence_bounds CHECK (
    sequence_number ~ '^(0|[1-9][0-9]*)$' AND 
    CAST(sequence_number AS NUMERIC) <= 18446744073709551615
  )
);

-- 3. Offer Nonce Store with bound gateway_id
CREATE TABLE IF NOT EXISTS offer_nonce_store (
  nonce VARCHAR(128) PRIMARY KEY,
  gateway_id VARCHAR(128) NOT NULL,
  expires_at_utc TIMESTAMPTZ NOT NULL,
  consumed_at_utc TIMESTAMPTZ NOT NULL
);

-- 4. Offer Canonical Assessment Store
CREATE TABLE IF NOT EXISTS offer_assessment_store (
  assessment_sha256 CHAR(64) PRIMARY KEY,
  canonical_bytes BYTEA NOT NULL,
  created_at_utc TIMESTAMPTZ NOT NULL
);

-- Indexes for high-throughput stream lookup
CREATE INDEX IF NOT EXISTS idx_stream_events_hash ON offer_stream_events (stream_id, event_sha256);
`;

export interface PostgresClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

export interface PostgresPoolLike {
  connect(): Promise<{
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
    release(): void;
  }>;
}

/**
 * Production PostgreSQL Persistence Transaction Implementation
 * Implements parameterized queries with SELECT ... FOR UPDATE pessimistic row locking (§4.1)
 */
export class PostgresOfferPersistenceDatabaseTransaction implements OfferPersistenceDatabaseTransaction {
  constructor(private client: PostgresClientLike) {}

  public async getOfferStreamHeadForUpdate(offer_id: string): Promise<{ sequence_number: CanonicalStreamSequence; offer_status: CommercialOfferStatus }> {
    let res = await this.client.query(
      'SELECT sequence_number, offer_status FROM offer_stream_heads WHERE offer_id = $1 FOR UPDATE',
      [offer_id]
    );
    if (res.rows.length === 0) {
      // Stream uninitialized. Insert initial head row (sequence 0, INDICATIVE_QUOTE)
      const initSeq = parseCanonicalStreamSequence('0');
      const initStatus = 'INDICATIVE_QUOTE' as CommercialOfferStatus;
      await this.client.query(
        'INSERT INTO offer_stream_heads (offer_id, sequence_number, offer_status, updated_at_utc) VALUES ($1, $2, $3, NOW()) ON CONFLICT (offer_id) DO NOTHING',
        [offer_id, initSeq, initStatus]
      );
      // Authoritatively re-read and acquire row lock following initialization or conflict resolution
      res = await this.client.query(
        'SELECT sequence_number, offer_status FROM offer_stream_heads WHERE offer_id = $1 FOR UPDATE',
        [offer_id]
      );
    }
    if (res.rows.length === 0) {
      throw new Error(`E-ERR-037: PERSISTENCE_STREAM_HEAD_UNAVAILABLE: Failed to acquire stream head lock for offer '${offer_id}'`);
    }
    const row = res.rows[0];
    return {
      sequence_number: parseCanonicalStreamSequence(row.sequence_number),
      offer_status: row.offer_status as CommercialOfferStatus
    };
  }

  public async insertNonceIfUnused(nonce: string, gateway_id: string, expires_at_utc: string, consumed_at_utc: string): Promise<boolean> {
    const res = await this.client.query(
      'INSERT INTO offer_nonce_store (nonce, gateway_id, expires_at_utc, consumed_at_utc) VALUES ($1, $2, $3, $4) ON CONFLICT (nonce) DO NOTHING',
      [nonce, gateway_id, expires_at_utc, consumed_at_utc]
    );
    return res.rowCount > 0;
  }

  public async putAssessment(assessment_sha256: string, canonical_bytes: Buffer, created_at_utc: string): Promise<void> {
    await this.client.query(
      'INSERT INTO offer_assessment_store (assessment_sha256, canonical_bytes, created_at_utc) VALUES ($1, $2, $3) ON CONFLICT (assessment_sha256) DO NOTHING',
      [assessment_sha256, canonical_bytes, created_at_utc]
    );
  }

  public async getAssessment(assessment_sha256: string): Promise<Buffer | null> {
    const res = await this.client.query(
      'SELECT canonical_bytes FROM offer_assessment_store WHERE assessment_sha256 = $1',
      [assessment_sha256]
    );
    if (res.rows.length === 0) return null;
    return Buffer.isBuffer(res.rows[0].canonical_bytes) ? res.rows[0].canonical_bytes : Buffer.from(res.rows[0].canonical_bytes);
  }

  public async appendOfferStreamEvent(event: {
    stream_id: string;
    sequence_number: CanonicalStreamSequence;
    payload_kind: string;
    payload: OfferPromotionEventPayload;
    event_sha256: string;
  }): Promise<void> {
    await this.client.query(
      'INSERT INTO offer_stream_events (stream_id, sequence_number, payload_kind, payload, event_sha256, created_at_utc) VALUES ($1, $2, $3, $4, $5, NOW())',
      [event.stream_id, event.sequence_number, event.payload_kind, JSON.stringify(event.payload), event.event_sha256]
    );
  }

  public async updateOfferStreamHead(offer_id: string, resulting_sequence_number: CanonicalStreamSequence, resulting_status: CommercialOfferStatus, updated_at_utc: string): Promise<void> {
    await this.client.query(
      'UPDATE offer_stream_heads SET sequence_number = $2, offer_status = $3, updated_at_utc = $4 WHERE offer_id = $1',
      [offer_id, resulting_sequence_number, resulting_status, updated_at_utc]
    );
  }

  public async getOfferStreamEvent(stream_id: string, sequence_number: CanonicalStreamSequence): Promise<{
    stream_id: string;
    sequence_number: CanonicalStreamSequence;
    payload_kind: string;
    payload: OfferPromotionEventPayload;
    event_sha256: string;
    created_at_utc: string;
  } | null> {
    const res = await this.client.query(
      'SELECT stream_id, sequence_number, payload_kind, payload, event_sha256, created_at_utc FROM offer_stream_events WHERE stream_id = $1 AND sequence_number = $2',
      [stream_id, sequence_number]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return {
      stream_id: row.stream_id,
      sequence_number: parseCanonicalStreamSequence(row.sequence_number),
      payload_kind: row.payload_kind,
      payload,
      event_sha256: row.event_sha256,
      created_at_utc: typeof row.created_at_utc === 'string' ? row.created_at_utc : row.created_at_utc.toISOString()
    };
  }
}

/**
 * Production PostgreSQL Persistence Session
 */
export class PostgresOfferPersistenceDatabaseSession implements OfferPersistenceDatabaseSession {
  constructor(private pool: PostgresPoolLike) {}

  public async getAssessment(assessment_sha256: string): Promise<Buffer | null> {
    const client = await this.pool.connect();
    try {
      const res = await client.query('SELECT canonical_bytes FROM offer_assessment_store WHERE assessment_sha256 = $1', [assessment_sha256]);
      if (res.rows.length === 0) return null;
      return Buffer.isBuffer(res.rows[0].canonical_bytes) ? res.rows[0].canonical_bytes : Buffer.from(res.rows[0].canonical_bytes);
    } finally {
      client.release();
    }
  }

  public async executeTransaction<T>(fn: (tx: OfferPersistenceDatabaseTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED');
      const tx = new PostgresOfferPersistenceDatabaseTransaction(client);
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Rollback attempt recorded
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
