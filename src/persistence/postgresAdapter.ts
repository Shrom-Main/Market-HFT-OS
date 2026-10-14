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
  previous_event_hash CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  created_at_utc TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (stream_id, sequence_number),
  CONSTRAINT chk_event_sequence_bounds CHECK (
    sequence_number ~ '^(0|[1-9][0-9]*)$' AND 
    CAST(sequence_number AS NUMERIC) <= 18446744073709551615
  )
);
ALTER TABLE offer_stream_events ADD COLUMN IF NOT EXISTS previous_event_hash CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000';

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
 * Adapter bridging native pg.Pool instance to PostgresPoolLike interface.
 * Connects PostgresOfferPersistenceDatabaseSession to real PostgreSQL database.
 */
export class PostgresNativePoolAdapter implements PostgresPoolLike {
  constructor(private pool: {
    connect(): Promise<{
      query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
      release(): void;
    }>;
    end(): Promise<void>;
  }) {}

  public async connect(): Promise<{
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
    release(): void;
  }> {
    const client = await this.pool.connect();
    return {
      query: async (sql: string, params?: unknown[]) => {
        const res = await client.query(sql, params as any[]);
        return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
      },
      release: () => client.release()
    };
  }

  public async end(): Promise<void> {
    await this.pool.end();
  }
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
    previous_event_hash?: string;
    created_at_utc?: string;
  }): Promise<void> {
    const prevHash = event.previous_event_hash ?? '0'.repeat(64);
    const createdAt = event.created_at_utc ?? new Date().toISOString();
    await this.client.query(
      'INSERT INTO offer_stream_events (stream_id, sequence_number, payload_kind, payload, event_sha256, previous_event_hash, created_at_utc) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [event.stream_id, event.sequence_number, event.payload_kind, JSON.stringify(event.payload), event.event_sha256, prevHash, createdAt]
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
    previous_event_hash: string;
    created_at_utc: string;
  } | null> {
    const res = await this.client.query(
      'SELECT stream_id, sequence_number, payload_kind, payload, event_sha256, COALESCE(previous_event_hash, repeat(\'0\', 64)) AS previous_event_hash, created_at_utc FROM offer_stream_events WHERE stream_id = $1 AND sequence_number = $2',
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
      previous_event_hash: row.previous_event_hash ?? '0'.repeat(64),
      created_at_utc: row.created_at_utc instanceof Date ? row.created_at_utc.toISOString() : String(row.created_at_utc)
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

export type AmbiguousCommitSimulationMode = 'NONE' | 'DISCONNECT_AFTER_COMMIT' | 'DISCONNECT_BEFORE_COMMIT';

export interface PostgresTransactionalClient extends PostgresClientLike {
  release(): void;
  setAmbiguousCommitSimulation(mode: AmbiguousCommitSimulationMode): void;
}

export interface PostgresTransactionalPoolOptions {
  maxConnections?: number;
  lockTimeoutMs?: number;
}

/**
 * High-Fidelity PostgreSQL Transactional Engine
 * Emulates PostgreSQL MVCC, pessimistic SELECT ... FOR UPDATE row locks,
 * lock wait queues, lock timeouts, transaction rollback, and ambiguous commits.
 */
export class PostgresTransactionalEngine {
  public readonly streamHeads = new Map<string, { sequence_number: string; offer_status: string; updated_at_utc: string }>();
  public readonly streamEvents = new Map<string, { stream_id: string; sequence_number: string; payload_kind: string; payload: any; event_sha256: string; previous_event_hash: string; created_at_utc: string }>();
  public readonly nonces = new Map<string, { nonce: string; gateway_id: string; expires_at_utc: string; consumed_at_utc: string }>();
  public readonly assessments = new Map<string, { assessment_sha256: string; canonical_bytes: Buffer; created_at_utc: string }>();

  private rowLocks = new Map<string, string>(); // resourceKey -> clientId
  private lockWaiters = new Map<string, Array<{ clientId: string; resolve: () => void; reject: (err: Error) => void; timer?: any }>>();

  public getActiveLocksCount(): number {
    return this.rowLocks.size;
  }

  public getLockOwner(resourceKey: string): string | undefined {
    return this.rowLocks.get(resourceKey);
  }

  public async acquireRowLock(resourceKey: string, clientId: string, timeoutMs: number = 2000): Promise<void> {
    const currentOwner = this.rowLocks.get(resourceKey);
    if (!currentOwner || currentOwner === clientId) {
      this.rowLocks.set(resourceKey, clientId);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let timer: any;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const waiters = this.lockWaiters.get(resourceKey) || [];
          this.lockWaiters.set(resourceKey, waiters.filter(w => w.clientId !== clientId));
          reject(new Error(`E-ERR-038: PERSISTENCE_LOCK_TIMEOUT: Timed out waiting for row lock on '${resourceKey}' after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      const waiters = this.lockWaiters.get(resourceKey) || [];
      waiters.push({ clientId, resolve, reject, timer });
      this.lockWaiters.set(resourceKey, waiters);
    });
  }

  public releaseRowLocks(clientId: string): void {
    for (const [key, owner] of Array.from(this.rowLocks.entries())) {
      if (owner === clientId) {
        this.rowLocks.delete(key);
        const waiters = this.lockWaiters.get(key);
        if (waiters && waiters.length > 0) {
          const next = waiters.shift()!;
          if (next.timer) clearTimeout(next.timer);
          this.rowLocks.set(key, next.clientId);
          next.resolve();
        }
      }
    }
  }
}

/**
 * Transactional PostgreSQL Pool implementing PostgresPoolLike
 * Supports connection pool capacity queueing, lock timeouts, and fault injection.
 */
export class PostgresTransactionalPool implements PostgresPoolLike {
  private engine: PostgresTransactionalEngine;
  private maxConnections: number;
  private lockTimeoutMs: number;
  private activeClients = new Set<string>();
  private connectionWaitQueue: Array<(client: PostgresTransactionalClient) => void> = [];
  private clientCounter = 0;

  constructor(options?: PostgresTransactionalPoolOptions, engine?: PostgresTransactionalEngine) {
    this.maxConnections = options?.maxConnections ?? 5;
    this.lockTimeoutMs = options?.lockTimeoutMs ?? 2000;
    this.engine = engine ?? new PostgresTransactionalEngine();
  }

  public getEngine(): PostgresTransactionalEngine {
    return this.engine;
  }

  public getActiveConnectionCount(): number {
    return this.activeClients.size;
  }

  public getWaitQueueLength(): number {
    return this.connectionWaitQueue.length;
  }

  public async connect(): Promise<PostgresTransactionalClient> {
    if (this.activeClients.size >= this.maxConnections) {
      return new Promise<PostgresTransactionalClient>((resolve) => {
        this.connectionWaitQueue.push(resolve);
      });
    }

    const clientId = `pg:client:${++this.clientCounter}`;
    this.activeClients.add(clientId);
    return this.createClient(clientId);
  }

  private releaseClient(clientId: string): void {
    this.activeClients.delete(clientId);
    if (this.connectionWaitQueue.length > 0) {
      const nextResolve = this.connectionWaitQueue.shift()!;
      const nextClientId = `pg:client:${++this.clientCounter}`;
      this.activeClients.add(nextClientId);
      nextResolve(this.createClient(nextClientId));
    }
  }

  private createClient(clientId: string): PostgresTransactionalClient {
    const engine = this.engine;
    const lockTimeoutMs = this.lockTimeoutMs;
    let ambiguousCommitMode: AmbiguousCommitSimulationMode = 'NONE';
    let inTransaction = false;

    // Transaction staging
    let stagedStreamHeads = new Map<string, { sequence_number: string; offer_status: string; updated_at_utc: string }>();
    let stagedStreamEvents = new Map<string, { stream_id: string; sequence_number: string; payload_kind: string; payload: any; event_sha256: string; previous_event_hash: string; created_at_utc: string }>();
    let stagedNonces = new Map<string, { nonce: string; gateway_id: string; expires_at_utc: string; consumed_at_utc: string }>();
    let stagedAssessments = new Map<string, { assessment_sha256: string; canonical_bytes: Buffer; created_at_utc: string }>();

    const client: PostgresTransactionalClient = {
      setAmbiguousCommitSimulation(mode: AmbiguousCommitSimulationMode) {
        ambiguousCommitMode = mode;
      },

      release: () => {
        if (inTransaction) {
          // Uncommitted rollback on connection release
          stagedStreamHeads.clear();
          stagedStreamEvents.clear();
          stagedNonces.clear();
          stagedAssessments.clear();
          engine.releaseRowLocks(clientId);
          inTransaction = false;
        }
        this.releaseClient(clientId);
      },

      async query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }> {
        const trimmed = sql.trim();

        if (trimmed.startsWith('BEGIN')) {
          inTransaction = true;
          stagedStreamHeads = new Map();
          stagedStreamEvents = new Map();
          stagedNonces = new Map();
          stagedAssessments = new Map();
          return { rows: [], rowCount: 0 };
        }

        if (trimmed.startsWith('COMMIT')) {
          if (!inTransaction) {
            return { rows: [], rowCount: 0 };
          }

          if (ambiguousCommitMode === 'DISCONNECT_BEFORE_COMMIT') {
            // Drop staged changes and throw simulated network disconnect
            stagedStreamHeads.clear();
            stagedStreamEvents.clear();
            stagedNonces.clear();
            stagedAssessments.clear();
            engine.releaseRowLocks(clientId);
            inTransaction = false;
            throw new Error('E-ERR-039: AMBIGUOUS_COMMIT_DROPPED: Simulated network reset before commit write');
          }

          // Atomically commit staged mutations to engine
          for (const [k, v] of stagedStreamHeads.entries()) {
            engine.streamHeads.set(k, { ...v });
          }
          for (const [k, v] of stagedStreamEvents.entries()) {
            engine.streamEvents.set(k, { ...v });
          }
          for (const [k, v] of stagedNonces.entries()) {
            engine.nonces.set(k, { ...v });
          }
          for (const [k, v] of stagedAssessments.entries()) {
            engine.assessments.set(k, { ...v });
          }

          engine.releaseRowLocks(clientId);
          inTransaction = false;

          if (ambiguousCommitMode === 'DISCONNECT_AFTER_COMMIT') {
            // Server committed data, but ACK lost over network
            throw new Error('E-ERR-039: AMBIGUOUS_COMMIT_DROPPED: Simulated network reset after commit write (ACK dropped)');
          }

          return { rows: [], rowCount: 0 };
        }

        if (trimmed.startsWith('ROLLBACK')) {
          stagedStreamHeads.clear();
          stagedStreamEvents.clear();
          stagedNonces.clear();
          stagedAssessments.clear();
          engine.releaseRowLocks(clientId);
          inTransaction = false;
          return { rows: [], rowCount: 0 };
        }

        // SELECT stream head FOR UPDATE
        if (trimmed.includes('FROM offer_stream_heads WHERE offer_id = $1 FOR UPDATE')) {
          const offer_id = params![0] as string;
          await engine.acquireRowLock(offer_id, clientId, lockTimeoutMs);
          const head = stagedStreamHeads.get(offer_id) ?? engine.streamHeads.get(offer_id);
          if (!head) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [{ sequence_number: head.sequence_number, offer_status: head.offer_status }], rowCount: 1 };
        }

        // INSERT INTO offer_stream_heads ON CONFLICT DO NOTHING
        if (trimmed.includes('INSERT INTO offer_stream_heads')) {
          const offer_id = params![0] as string;
          const sequence_number = params![1] as string;
          const offer_status = params![2] as string;
          const nowStr = new Date().toISOString();

          const existing = stagedStreamHeads.get(offer_id) ?? engine.streamHeads.get(offer_id);
          if (existing) {
            return { rows: [], rowCount: 0 };
          }

          const record = { sequence_number, offer_status, updated_at_utc: nowStr };
          if (inTransaction) {
            stagedStreamHeads.set(offer_id, record);
          } else {
            engine.streamHeads.set(offer_id, record);
          }
          return { rows: [], rowCount: 1 };
        }

        // UPDATE offer_stream_heads
        if (trimmed.includes('UPDATE offer_stream_heads SET sequence_number = $2, offer_status = $3, updated_at_utc = $4 WHERE offer_id = $1')) {
          const offer_id = params![0] as string;
          const sequence_number = params![1] as string;
          const offer_status = params![2] as string;
          const updated_at_utc = params![3] as string;

          const record = { sequence_number, offer_status, updated_at_utc };
          if (inTransaction) {
            stagedStreamHeads.set(offer_id, record);
          } else {
            engine.streamHeads.set(offer_id, record);
          }
          return { rows: [], rowCount: 1 };
        }

        // INSERT INTO offer_nonce_store ON CONFLICT DO NOTHING
        if (trimmed.includes('INSERT INTO offer_nonce_store')) {
          const nonce = params![0] as string;
          const gateway_id = params![1] as string;
          const expires_at_utc = params![2] as string;
          const consumed_at_utc = params![3] as string;

          const existing = stagedNonces.get(nonce) ?? engine.nonces.get(nonce);
          if (existing) {
            return { rows: [], rowCount: 0 };
          }

          const record = { nonce, gateway_id, expires_at_utc, consumed_at_utc };
          if (inTransaction) {
            stagedNonces.set(nonce, record);
          } else {
            engine.nonces.set(nonce, record);
          }
          return { rows: [], rowCount: 1 };
        }

        // INSERT INTO offer_assessment_store ON CONFLICT DO NOTHING
        if (trimmed.includes('INSERT INTO offer_assessment_store')) {
          const assessment_sha256 = params![0] as string;
          const canonical_bytes = Buffer.isBuffer(params![1]) ? params![1] as Buffer : Buffer.from(params![1] as any);
          const created_at_utc = params![2] as string;

          const existing = stagedAssessments.get(assessment_sha256) ?? engine.assessments.get(assessment_sha256);
          if (existing) {
            return { rows: [], rowCount: 0 };
          }

          const record = { assessment_sha256, canonical_bytes, created_at_utc };
          if (inTransaction) {
            stagedAssessments.set(assessment_sha256, record);
          } else {
            engine.assessments.set(assessment_sha256, record);
          }
          return { rows: [], rowCount: 1 };
        }

        // SELECT canonical_bytes FROM offer_assessment_store
        if (trimmed.includes('FROM offer_assessment_store WHERE assessment_sha256 = $1')) {
          const assessment_sha256 = params![0] as string;
          const item = stagedAssessments.get(assessment_sha256) ?? engine.assessments.get(assessment_sha256);
          if (!item) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [{ canonical_bytes: item.canonical_bytes }], rowCount: 1 };
        }

        // INSERT INTO offer_stream_events
        if (trimmed.includes('INSERT INTO offer_stream_events')) {
          const stream_id = params![0] as string;
          const sequence_number = params![1] as string;
          const payload_kind = params![2] as string;
          const rawPayload = params![3] as string;
          const event_sha256 = params![4] as string;
          const previous_event_hash = (params!.length >= 7 ? params![5] : '0'.repeat(64)) as string;
          const createdAt = (params!.length >= 7 ? params![6] : (params!.length >= 6 ? params![5] : new Date().toISOString())) as string;

          const key = `${stream_id}::${sequence_number}`;
          const payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
          const record = { stream_id, sequence_number, payload_kind, payload, event_sha256, previous_event_hash, created_at_utc: createdAt };

          if (inTransaction) {
            stagedStreamEvents.set(key, record);
          } else {
            engine.streamEvents.set(key, record);
          }
          return { rows: [], rowCount: 1 };
        }

        // SELECT FROM offer_stream_events
        if (trimmed.includes('FROM offer_stream_events WHERE stream_id = $1 AND sequence_number = $2')) {
          const stream_id = params![0] as string;
          const sequence_number = params![1] as string;
          const key = `${stream_id}::${sequence_number}`;

          const item = stagedStreamEvents.get(key) ?? engine.streamEvents.get(key);
          if (!item) {
            return { rows: [], rowCount: 0 };
          }
          return {
            rows: [{
              stream_id: item.stream_id,
              sequence_number: item.sequence_number,
              payload_kind: item.payload_kind,
              payload: item.payload,
              event_sha256: item.event_sha256,
              previous_event_hash: item.previous_event_hash ?? '0'.repeat(64),
              created_at_utc: item.created_at_utc
            }],
            rowCount: 1
          };
        }

        return { rows: [], rowCount: 0 };
      }
    };

    return client;
  }
}
