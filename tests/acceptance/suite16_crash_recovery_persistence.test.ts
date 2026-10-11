import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import {
  CanonicalMoney,
  CanonicalOffer,
  createCanonicalMoney,
  parseCanonicalStreamSequence
} from '../../src/canonical/domain.js';
import { sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import {
  SimulationPortfolio,
  computeFillFingerprint,
  PortfolioSnapshot,
  PortfolioCheckpoint
} from '../../src/portfolio/simulationPortfolio.js';
import {
  SimulatedExecutionGateway,
  SimulatedOrderRecord,
  SimulatedFillEvent
} from '../../src/execution/simulatedGateway.js';
import {
  MonotonicVirtualClock,
  DeterministicCounterIdGenerator
} from '../../src/canonical/deterministic.js';
import {
  SimulationPipeline
} from '../../src/simulation/simulationPipeline.js';
import {
  NormalizedMarketFeedEvent
} from '../../src/feeds/feedHandler.js';
import {
  PostgresTransactionalPool,
  PostgresOfferPersistenceDatabaseSession,
  PostgresOfferPersistenceDatabaseTransaction
} from '../../src/persistence/postgresAdapter.js';
import {
  reconcileAmbiguousPromotionCommit
} from '../../src/persistence/atomicPromotion.js';
import {
  DurableRecoveryJournal,
  FileBackedDurableRecoveryJournal,
  DurablePortfolioCheckpointStore,
  CrashRecoveryEngine
} from '../../src/persistence/durableRecoveryJournal.js';
import {
  MockLocalWebSocketFeedServer,
  WebSocketStreamingFeedAdapter
} from '../../src/feeds/localWebSocketTransport.js';
import { MarketFeedHandler } from '../../src/feeds/feedHandler.js';

describe('SUITE-16: Gate M3 — Persistence, Crash Recovery & Multi-Stream Integration', () => {
  const initialCashEur = createCanonicalMoney('500000000', 'EUR', 4); // €50,000.0000

  // --------------------------------------------------------------------------------------
  // 1. Fill Idempotency & Conflicting Fill-ID Reuse Guard (E-ERR-046)
  // --------------------------------------------------------------------------------------
  it('M3-IDEMPOTENCY-CONFLICT-001: Reusing fill ID with conflicting attributes throws E-ERR-046 and preserves atomic snapshot invariance', () => {
    const portfolio = new SimulationPortfolio({ initialCash: initialCashEur });
    const order: SimulatedOrderRecord = {
      order_id: 'sim:ord:intent-001',
      intent_id: 'intent-001',
      offer_id: 'off-001',
      product_id: 'DIN3017-W4-CLAMP-001',
      venue_id: 'VENUE-A',
      side: 'BUY',
      order_price: createCanonicalMoney('1250000', 'EUR', 4),
      total_quantity: 100,
      filled_quantity: 100,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-12T10:00:00.000Z',
      updated_at_utc: '2026-10-12T10:00:00.000Z',
      fills: [],
      events: [],
      intent_sha256: 'a'.repeat(64)
    };

    const initialFill: SimulatedFillEvent = {
      fill_id: 'fill:001',
      order_id: order.order_id,
      fill_timestamp_utc: '2026-10-12T10:00:00.000Z',
      fill_price: createCanonicalMoney('1250000', 'EUR', 4),
      fill_quantity: 100,
      cumulative_quantity: 100,
      remaining_quantity: 0
    };

    // First fill processes successfully
    portfolio.processFill(initialFill, order, '2026-10-12T10:00:00.000Z');
    const validSnapshotBefore = portfolio.getSnapshot();
    expect(portfolio.isFillProcessed('fill:001')).toBe(true);
    expect(portfolio.getProcessedFillsCount()).toBe(1);

    // Conflicting Fill: Same fill_id, but altered quantity and price
    const conflictingFill: SimulatedFillEvent = {
      fill_id: 'fill:001',
      order_id: order.order_id,
      fill_timestamp_utc: '2026-10-12T10:00:05.000Z',
      fill_price: createCanonicalMoney('1500000', 'EUR', 4), // Conflicting price
      fill_quantity: 50, // Conflicting quantity
      cumulative_quantity: 50,
      remaining_quantity: 50
    };

    expect(() => {
      portfolio.processFill(conflictingFill, order, '2026-10-12T10:00:05.000Z');
    }).toThrow(/E-ERR-046: FILL_IDEMPOTENCY_CONFLICT/);

    // Assert full snapshot atomic invariance: no mutation occurred
    const snapshotAfterConflict = portfolio.getSnapshot();
    expect(snapshotAfterConflict).toEqual(validSnapshotBefore);
    expect(portfolio.getProcessedFillsCount()).toBe(1);
  });

  it('M3-IDEMPOTENCY-EXACT-REPLAY-002: Replaying identical fill is idempotent with zero accounting mutation', () => {
    const portfolio = new SimulationPortfolio({ initialCash: initialCashEur });
    const order: SimulatedOrderRecord = {
      order_id: 'sim:ord:intent-002',
      intent_id: 'intent-002',
      offer_id: 'off-002',
      product_id: 'DIN3017-W4-CLAMP-001',
      venue_id: 'VENUE-A',
      side: 'BUY',
      order_price: createCanonicalMoney('1000000', 'EUR', 4),
      total_quantity: 50,
      filled_quantity: 50,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-12T10:00:00.000Z',
      updated_at_utc: '2026-10-12T10:00:00.000Z',
      fills: [],
      events: [],
      intent_sha256: 'b'.repeat(64)
    };

    const fill: SimulatedFillEvent = {
      fill_id: 'fill:002',
      order_id: order.order_id,
      fill_timestamp_utc: '2026-10-12T10:00:00.000Z',
      fill_price: createCanonicalMoney('1000000', 'EUR', 4),
      fill_quantity: 50,
      cumulative_quantity: 50,
      remaining_quantity: 0
    };

    const firstSnap = portfolio.processFill(fill, order, '2026-10-12T10:00:00.000Z');
    expect(firstSnap.available_cash.amount_subunits).toBe('450000000'); // 500000000 - 50000000

    // Exact Replay
    const replaySnap = portfolio.processFill(fill, order, '2026-10-12T10:00:01.000Z');
    expect(replaySnap).toEqual(firstSnap);
    expect(portfolio.getJournal().length).toBe(1); // Zero duplicate journal entry
  });

  // --------------------------------------------------------------------------------------
  // 2. Deterministic Clock and ID Provider Invariance
  // --------------------------------------------------------------------------------------
  it('M3-DETERMINISTIC-CLOCK-REPLAY-003: Deterministic virtual clock and counter ID generator produce bit-identical pipeline state digests', () => {
    const verifiedOffer: CanonicalOffer = {
      offer_id: 'off:din3017:sup-01:2026-q4',
      product_id: 'DIN3017-W4-CLAMP-001',
      supplier_id: 'sup:te-connectivity-01',
      unit_price: createCanonicalMoney('1000000', 'EUR', 4),
      minimum_order_quantity: 10,
      payment_terms_days: 30,
      incoterms: 'DAP',
      offer_status: 'VERIFIED_EXECUTABLE_OFFER',
      verification_status: 'VERIFIED',
      valid_until_utc: '2026-12-31T23:59:59.000Z'
    };

    const feedEvent: NormalizedMarketFeedEvent = {
      event_id: 'evt:feed:001',
      venue_id: 'VENUE-A',
      product_id: 'DIN3017-W4-CLAMP-001',
      stream_sequence: parseCanonicalStreamSequence('1'),
      occurred_at_utc: '2026-10-12T10:00:00.000Z',
      ingested_at_utc: '2026-10-12T10:00:00.010Z',
      bid_price: createCanonicalMoney('1500000', 'EUR', 4),
      bid_quantity: 20,
      ask_price: createCanonicalMoney('1600000', 'EUR', 4),
      ask_quantity: 30,
      feed_status: 'ACTIVE',
      provenance: {
        source_id: 'src:simulated',
        observed_at_utc: '2026-10-12T10:00:00.000Z',
        ingested_at_utc: '2026-10-12T10:00:00.010Z',
        is_authenticated_source_feed: false,
        adapter_mode: 'SIMULATED_TEST'
      },
      event_sha256: 'e'.repeat(64)
    };

    // Run 1: with deterministic clock and ID generator
    const clock1 = new MonotonicVirtualClock({ startUtc: '2026-10-12T12:00:00.000Z', autoAdvanceStepMs: 10 });
    const idGen1 = new DeterministicCounterIdGenerator(1);
    const gateway1 = new SimulatedExecutionGateway({ clock: clock1, idGenerator: idGen1 });
    const pipeline1 = new SimulationPipeline({
      initialCash: initialCashEur,
      clock: clock1,
      executionGateway: gateway1,
      autoFundInventoryFromOffer: true
    });
    pipeline1.registerVerifiedOffer(verifiedOffer);
    pipeline1.processMarketEvent(feedEvent);
    const digest1 = pipeline1.computeStateDigest();

    // Run 2: independent instance with identical deterministic inputs
    const clock2 = new MonotonicVirtualClock({ startUtc: '2026-10-12T12:00:00.000Z', autoAdvanceStepMs: 10 });
    const idGen2 = new DeterministicCounterIdGenerator(1);
    const gateway2 = new SimulatedExecutionGateway({ clock: clock2, idGenerator: idGen2 });
    const pipeline2 = new SimulationPipeline({
      initialCash: initialCashEur,
      clock: clock2,
      executionGateway: gateway2,
      autoFundInventoryFromOffer: true
    });
    pipeline2.registerVerifiedOffer(verifiedOffer);
    pipeline2.processMarketEvent(feedEvent);
    const digest2 = pipeline2.computeStateDigest();

    expect(digest1).toBe(digest2);
    expect(pipeline1.getPortfolio().getSnapshot()).toEqual(pipeline2.getPortfolio().getSnapshot());
  });

  // --------------------------------------------------------------------------------------
  // 3. PostgreSQL Transaction Concurrency, Row-Locking & Queueing
  // --------------------------------------------------------------------------------------
  it('M3-POSTGRES-CONCURRENCY-ROWLOCK-004: Concurrent transactions on identical offer serialize via SELECT FOR UPDATE row lock wait queue', async () => {
    const pool = new PostgresTransactionalPool({ maxConnections: 5, lockTimeoutMs: 2000 });
    const session = new PostgresOfferPersistenceDatabaseSession(pool);
    const offerId = 'off:din3017:concurrent-001';

    const executionOrder: string[] = [];

    // Client 1: acquires row lock, simulates some async work, updates stream head, commits
    const client1Promise = session.executeTransaction(async (tx) => {
      executionOrder.push('client1:before_lock');
      const head = await tx.getOfferStreamHeadForUpdate(offerId);
      executionOrder.push(`client1:lock_acquired:seq_${head.sequence_number}`);

      // Hold lock while doing work
      await new Promise(r => setTimeout(r, 50));

      const nextSeq = parseCanonicalStreamSequence('1');
      await tx.updateOfferStreamHead(offerId, nextSeq, 'VERIFIED_EXECUTABLE_OFFER', '2026-10-12T10:00:00.000Z');
      executionOrder.push('client1:before_commit');
      return head.sequence_number;
    });

    // Client 2: started 10ms after Client 1, attempts lock on SAME offerId -> must wait in queue
    await new Promise(r => setTimeout(r, 10));
    const client2Promise = session.executeTransaction(async (tx) => {
      executionOrder.push('client2:before_lock');
      const head = await tx.getOfferStreamHeadForUpdate(offerId);
      executionOrder.push(`client2:lock_acquired:seq_${head.sequence_number}`);

      const nextSeq = parseCanonicalStreamSequence('2');
      await tx.updateOfferStreamHead(offerId, nextSeq, 'VERIFIED_EXECUTABLE_OFFER', '2026-10-12T10:00:01.000Z');
      executionOrder.push('client2:before_commit');
      return head.sequence_number;
    });

    const [seq1, seq2] = await Promise.all([client1Promise, client2Promise]);

    expect(seq1).toBe('0');
    expect(seq2).toBe('1'); // Client 2 read sequence 1 committed by Client 1!

    // Verify execution ordering: client 2 waited until client 1 committed
    const client1CommitIdx = executionOrder.indexOf('client1:before_commit');
    const client2AcquiredIdx = executionOrder.indexOf('client2:lock_acquired:seq_1');
    expect(client1CommitIdx).toBeLessThan(client2AcquiredIdx);

    // Final head sequence in DB is 2
    const finalHead = pool.getEngine().streamHeads.get(offerId);
    expect(finalHead?.sequence_number).toBe('2');
  });

  it('M3-POSTGRES-LOCK-TIMEOUT-FAILCLOSED-005: Contention exceeding lockTimeoutMs throws E-ERR-038 fail-closed without corrupting state', async () => {
    const pool = new PostgresTransactionalPool({ maxConnections: 5, lockTimeoutMs: 60 });
    const offerId = 'off:din3017:timeout-001';

    const clientA = await pool.connect();
    await clientA.query('BEGIN');
    const txA = new PostgresOfferPersistenceDatabaseTransaction(clientA);
    await txA.getOfferStreamHeadForUpdate(offerId);

    const clientB = await pool.connect();
    await clientB.query('BEGIN');
    const txB = new PostgresOfferPersistenceDatabaseTransaction(clientB);

    // Client B attempts lock on same offer; client A holds it -> Client B times out
    await expect(txB.getOfferStreamHeadForUpdate(offerId)).rejects.toThrow(/E-ERR-038: PERSISTENCE_LOCK_TIMEOUT/);

    // Clean up
    await clientB.query('ROLLBACK');
    clientB.release();
    await clientA.query('COMMIT');
    clientA.release();
  });

  it('M3-POSTGRES-ROLLBACK-DIRTY-ISOLATION-006: Aborted transaction leaves zero dirty stream events or nonces', async () => {
    const pool = new PostgresTransactionalPool({ maxConnections: 5 });
    const session = new PostgresOfferPersistenceDatabaseSession(pool);
    const offerId = 'off:din3017:rollback-001';
    const nonce = 'nonce:test:dirty:001';

    await expect(session.executeTransaction(async (tx) => {
      await tx.getOfferStreamHeadForUpdate(offerId);
      await tx.insertNonceIfUnused(nonce, 'gw-01', '2026-10-12T11:00:00.000Z', '2026-10-12T10:00:00.000Z');
      await tx.updateOfferStreamHead(offerId, parseCanonicalStreamSequence('5'), 'VERIFIED_EXECUTABLE_OFFER', '2026-10-12T10:00:00.000Z');
      // Intentionally abort
      throw new Error('SIMULATED_ABORT');
    })).rejects.toThrow('SIMULATED_ABORT');

    // Verify zero dirty state
    const engine = pool.getEngine();
    expect(engine.nonces.has(nonce)).toBe(false);
    // Uncommitted stream head staged in transaction rolls back completely
    expect(engine.streamHeads.get(offerId)).toBeUndefined();
  });

  it('M3-POSTGRES-AMBIGUOUS-COMMIT-007: Ambiguous commit disconnect is authoritatively reconciled via stream inspection', async () => {
    const pool = new PostgresTransactionalPool({ maxConnections: 5 });
    const session = new PostgresOfferPersistenceDatabaseSession(pool);
    const offerId = 'off:din3017:ambiguous-001';
    const attemptedSeq = '1';
    const assessmentBytes = Buffer.from('canonical_assessment_bytes', 'utf8');
    const assessmentSha = sha256(assessmentBytes);

    // Simulate Case A: Server committed, but network dropped during ACK (DISCONNECT_AFTER_COMMIT)
    const client = await pool.connect();
    client.setAmbiguousCommitSimulation('DISCONNECT_AFTER_COMMIT');

    try {
      await client.query('BEGIN');
      const tx = new PostgresOfferPersistenceDatabaseTransaction(client);
      await tx.getOfferStreamHeadForUpdate(offerId);
      await tx.putAssessment(assessmentSha, assessmentBytes, '2026-10-12T10:00:00.000Z');
      const payload: any = {
        offer_id: offerId,
        assessment_sha256: assessmentSha,
        assigned_offer_status: 'VERIFIED_EXECUTABLE_OFFER',
        resulting_sequence: attemptedSeq
      };
      const eventJson = canonicalizeJCS(payload);
      const eventSha = sha256(Buffer.from(eventJson, 'utf8'));
      await tx.appendOfferStreamEvent({
        stream_id: `stream:offer:${offerId}`,
        sequence_number: parseCanonicalStreamSequence(attemptedSeq),
        payload_kind: 'OFFER_STATUS_TRANSITION',
        payload,
        event_sha256: eventSha
      });
      await tx.updateOfferStreamHead(offerId, parseCanonicalStreamSequence(attemptedSeq), 'VERIFIED_EXECUTABLE_OFFER', '2026-10-12T10:00:00.000Z');
      await client.query('COMMIT'); // Throws simulated disconnect!
    } catch (err: any) {
      expect(err.message).toContain('AMBIGUOUS_COMMIT_DROPPED');
    } finally {
      client.release();
    }

    // Recovery Reconciler inspects durable store
    const reconciliation = await reconcileAmbiguousPromotionCommit(
      session,
      offerId,
      '0',
      attemptedSeq,
      assessmentSha
    );

    expect(reconciliation.outcome).toBe('COMMITTED');
    expect(reconciliation.stream_sequence).toBe('1');
  });

  it('M3-POSTGRES-CONNECTION-POOL-QUEUE-008: Connection pool serializes requests when maxConnections is exhausted', async () => {
    const pool = new PostgresTransactionalPool({ maxConnections: 2 });
    expect(pool.getActiveConnectionCount()).toBe(0);

    const c1 = await pool.connect();
    const c2 = await pool.connect();
    expect(pool.getActiveConnectionCount()).toBe(2);

    let c3Acquired = false;
    const c3Promise = pool.connect().then(c => {
      c3Acquired = true;
      return c;
    });

    // c3 is queued waiting for a free slot
    expect(pool.getWaitQueueLength()).toBe(1);
    expect(c3Acquired).toBe(false);

    // Release c1
    c1.release();

    const c3 = await c3Promise;
    expect(c3Acquired).toBe(true);
    expect(pool.getWaitQueueLength()).toBe(0);

    c2.release();
    c3.release();
  });

  // --------------------------------------------------------------------------------------
  // 4. Crash Fault Injection & Durable Journal Recovery
  // --------------------------------------------------------------------------------------
  it('M3-CRASH-FAULT-INJECTION-JOURNAL-RECOVERY-009: Process crash between gateway fill generation and portfolio consumption recovers exact-once state', () => {
    const journal = new DurableRecoveryJournal();
    const benchmarkPortfolio = new SimulationPortfolio({ initialCash: initialCashEur });
    const recoveryPortfolio = new SimulationPortfolio({ initialCash: initialCashEur });

    const order: SimulatedOrderRecord = {
      order_id: 'sim:ord:crash-001',
      intent_id: 'intent-crash-001',
      offer_id: 'off-crash-001',
      product_id: 'DIN3017-W4-CLAMP-001',
      venue_id: 'VENUE-A',
      side: 'BUY',
      order_price: createCanonicalMoney('1000000', 'EUR', 4),
      total_quantity: 100,
      filled_quantity: 100,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-12T10:00:00.000Z',
      updated_at_utc: '2026-10-12T10:00:00.000Z',
      fills: [],
      events: [],
      intent_sha256: 'd'.repeat(64)
    };

    // Fill 1: Committed normally
    const fill1: SimulatedFillEvent = {
      fill_id: 'fill:crash:1',
      order_id: order.order_id,
      fill_timestamp_utc: '2026-10-12T10:00:01.000Z',
      fill_price: createCanonicalMoney('1000000', 'EUR', 4),
      fill_quantity: 40,
      cumulative_quantity: 40,
      remaining_quantity: 60
    };
    journal.appendEvent('FILL_RECORDED', { fill: fill1, order }, '2026-10-12T10:00:01.000Z');
    recoveryPortfolio.processFill(fill1, order, '2026-10-12T10:00:01.000Z');
    benchmarkPortfolio.processFill(fill1, order, '2026-10-12T10:00:01.000Z');
    journal.appendEvent('PORTFOLIO_APPLIED', { fill_id: fill1.fill_id, order_id: order.order_id }, '2026-10-12T10:00:01.000Z');

    // Fill 2: Gateway logs fill in durable journal, BUT process crashes before portfolio consumption!
    const fill2: SimulatedFillEvent = {
      fill_id: 'fill:crash:2',
      order_id: order.order_id,
      fill_timestamp_utc: '2026-10-12T10:00:02.000Z',
      fill_price: createCanonicalMoney('1000000', 'EUR', 4),
      fill_quantity: 60,
      cumulative_quantity: 100,
      remaining_quantity: 0
    };
    journal.appendEvent('FILL_RECORDED', { fill: fill2, order }, '2026-10-12T10:00:02.000Z');
    // In benchmark, fill 2 also processed
    benchmarkPortfolio.processFill(fill2, order, '2026-10-12T10:00:02.000Z');

    // Check that before recovery, recoveryPortfolio has NOT accounted for fill 2
    expect(recoveryPortfolio.isFillProcessed('fill:crash:2')).toBe(false);
    expect(recoveryPortfolio.getPosition('DIN3017-W4-CLAMP-001')?.net_quantity).toBe(40);

    // Crash Recovery Engine is invoked on restart
    const recoveryResult = CrashRecoveryEngine.recover(
      journal,
      recoveryPortfolio,
      '2026-10-12T10:00:05.000Z'
    );

    expect(recoveryResult.recovered_fills_count).toBe(1);
    expect(recoveryResult.skipped_duplicate_fills_count).toBe(1); // fill 1 was skipped idempotently
    expect(recoveryPortfolio.isFillProcessed('fill:crash:2')).toBe(true);

    // Verify exact equality between non-crashed benchmark and recovered portfolio
    const benchmarkSnap = benchmarkPortfolio.getSnapshot();
    const recoveredSnap = recoveryPortfolio.getSnapshot();
    expect(recoveredSnap.available_cash).toEqual(benchmarkSnap.available_cash);
    expect(recoveredSnap.positions).toEqual(benchmarkSnap.positions);
    expect(recoveredSnap.cumulative_realized_pnl).toEqual(benchmarkSnap.cumulative_realized_pnl);
  });

  // --------------------------------------------------------------------------------------
  // 5. Multi-Stream Concurrent WebSocket Feeds Stress
  // --------------------------------------------------------------------------------------
  it('M3-MULTI-STREAM-CONCURRENCY-010: Concurrent multi-symbol WebSocket feeds stream concurrently without cross-talk', async () => {
    const server = new MockLocalWebSocketFeedServer();
    await server.start();

    const handler1 = new MarketFeedHandler();
    const handler2 = new MarketFeedHandler();

    handler1.registerSymbolMapping('VENUE-A', 'DIN3017-W4-CLAMP-001', 'prod:clamp:001');
    handler1.registerSymbolMapping('VENUE-A', 'DIN3017-W4-CLAMP-002', 'prod:clamp:002');
    handler2.registerSymbolMapping('VENUE-A', 'DIN3017-W4-CLAMP-001', 'prod:clamp:001');
    handler2.registerSymbolMapping('VENUE-A', 'DIN3017-W4-CLAMP-002', 'prod:clamp:002');

    const adapter1 = new WebSocketStreamingFeedAdapter(handler1, {
      wsUrl: server.getUrl(),
      venue_id: 'VENUE-A'
    });
    const adapter2 = new WebSocketStreamingFeedAdapter(handler2, {
      wsUrl: server.getUrl(),
      venue_id: 'VENUE-A'
    });

    await Promise.all([adapter1.connect(), adapter2.connect()]);

    // Server publishes interleaved ticks for two distinct products
    const nowUtc = new Date().toISOString();
    for (let seq = 1; seq <= 5; seq++) {
      server.publishTick({
        message_id: `msg-1-${seq}`,
        venue_id: 'VENUE-A',
        raw_symbol: 'DIN3017-W4-CLAMP-001',
        sequence: seq.toString(),
        bid_price: '150.00',
        bid_quantity: 20,
        ask_price: '160.00',
        ask_quantity: 30,
        feed_status: 'ACTIVE',
        timestamp_utc: nowUtc
      });
      server.publishTick({
        message_id: `msg-2-${seq}`,
        venue_id: 'VENUE-A',
        raw_symbol: 'DIN3017-W4-CLAMP-002',
        sequence: seq.toString(),
        bid_price: '250.00',
        bid_quantity: 10,
        ask_price: '260.00',
        ask_quantity: 15,
        feed_status: 'ACTIVE',
        timestamp_utc: nowUtc
      });
    }

    // Await delivery window
    await new Promise(r => setTimeout(r, 80));

    expect(handler1.getExpectedSequence('VENUE-A', 'prod:clamp:001')).toBe('6');
    expect(handler1.getExpectedSequence('VENUE-A', 'prod:clamp:002')).toBe('6');
    expect(handler2.getExpectedSequence('VENUE-A', 'prod:clamp:001')).toBe('6');
    expect(handler2.getExpectedSequence('VENUE-A', 'prod:clamp:002')).toBe('6');

    expect(handler1.getLatestEvent('VENUE-A', 'prod:clamp:001')?.stream_sequence).toBe('5');
    expect(handler1.getLatestEvent('VENUE-A', 'prod:clamp:002')?.stream_sequence).toBe('5');

    await adapter1.disconnect();
    await adapter2.disconnect();
    await server.stop();
  });

  // --------------------------------------------------------------------------------------
  // 6. File-Backed WAL Flush, Fsync & Tamper Detection
  // --------------------------------------------------------------------------------------
  it('M3-FILE-BACKED-WAL-INTEGRITY-011: File-backed recovery journal flushes with fsync and detects tamper corruption fail-closed', () => {
    const tmpDir = path.resolve(process.cwd(), 'tmp_test_wal');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const walPath = path.join(tmpDir, `test_wal_${Date.now()}.log`);

    try {
      const journal = new FileBackedDurableRecoveryJournal(walPath);
      journal.appendEvent('INTENT_RECORDED', { intent_id: 'i-001' }, '2026-10-12T10:00:00.000Z');
      journal.appendEvent('ORDER_SUBMITTED', { order_id: 'o-001' }, '2026-10-12T10:00:01.000Z');
      journal.close();

      // Verify file exists on disk and is non-empty
      expect(fs.existsSync(walPath)).toBe(true);
      const content = fs.readFileSync(walPath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim().length > 0);
      expect(lines.length).toBe(2);

      // Re-open in fresh journal instance and verify integrity
      const reloaded = new FileBackedDurableRecoveryJournal(walPath);
      expect(reloaded.getEntryCount()).toBe(2);
      expect(reloaded.verifyIntegrity().isValid).toBe(true);
      reloaded.close();

      // Tamper with the file: modify a character in the payload
      const tamperedContent = content.replace('i-001', 'i-999');
      fs.writeFileSync(walPath, tamperedContent, 'utf8');

      // Re-opening tampered file must throw E-ERR-024: CORRUPT_JOURNAL
      expect(() => new FileBackedDurableRecoveryJournal(walPath)).toThrow('E-ERR-024: CORRUPT_JOURNAL');
    } finally {
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------------------
  // 7. Recovery Contract Failure Boundaries Reconciliation
  // --------------------------------------------------------------------------------------
  it('M3-RECOVERY-FAILURE-BOUNDARIES-012: CrashRecoveryEngine.recoverDurable handles all 5 specification failure boundaries', () => {
    const order: SimulatedOrderRecord = {
      order_id: 'ord-fb-1',
      intent_id: 'intent-fb-1',
      offer_id: 'off-fb-1',
      product_id: 'DIN3017-W4-CLAMP-001',
      venue_id: 'VENUE-A',
      side: 'BUY',
      order_price: initialCashEur,
      total_quantity: 10,
      filled_quantity: 10,
      remaining_quantity: 0,
      status: 'FILLED',
      created_at_utc: '2026-10-12T10:00:00.000Z',
      updated_at_utc: '2026-10-12T10:00:01.000Z',
      fills: [],
      events: [],
      intent_sha256: 'a'.repeat(64)
    };

    const fillA: SimulatedFillEvent = {
      fill_id: 'fill-fb-a',
      order_id: order.order_id,
      fill_price: createCanonicalMoney('100000', 'EUR', 4),
      fill_quantity: 10,
      cumulative_quantity: 10,
      remaining_quantity: 0,
      fill_timestamp_utc: '2026-10-12T10:00:01.000Z'
    };

    // Boundary 1: Fill recorded in journal, portfolio not updated => Replay fill exactly once
    {
      const journal = new DurableRecoveryJournal();
      const portfolio = new SimulationPortfolio({ initialCash: initialCashEur });
      journal.appendEvent('FILL_RECORDED', { fill: fillA, order }, '2026-10-12T10:00:01.000Z');

      const result = CrashRecoveryEngine.recoverDurable(journal, portfolio, '2026-10-12T10:00:02.000Z');
      expect(result.recovered_fills_count).toBe(1);
      expect(portfolio.isFillProcessed('fill-fb-a')).toBe(true);
      const markers = journal.getEntries().filter(e => e.event_type === 'PORTFOLIO_APPLIED');
      expect(markers.length).toBe(1);
    }

    // Boundary 2: Portfolio updated, marker not recorded => Reconcile without double accounting
    {
      const journal = new DurableRecoveryJournal();
      const portfolio = new SimulationPortfolio({ initialCash: initialCashEur });
      journal.appendEvent('FILL_RECORDED', { fill: fillA, order }, '2026-10-12T10:00:01.000Z');
      portfolio.processFill(fillA, order, '2026-10-12T10:00:01.000Z');

      const snapBefore = portfolio.getSnapshot();
      const result = CrashRecoveryEngine.recoverDurable(journal, portfolio, '2026-10-12T10:00:02.000Z');
      expect(result.reconciled_unmarked_fills_count).toBe(1);
      expect(result.recovered_fills_count).toBe(0);
      expect(portfolio.getSnapshot().available_cash).toEqual(snapBefore.available_cash);
      expect(portfolio.getSnapshot().positions).toEqual(snapBefore.positions);
    }

    // Boundary 3: Marker recorded, state restoration incomplete => Replay fill from journal
    {
      const journal = new DurableRecoveryJournal();
      const portfolio = new SimulationPortfolio({ initialCash: initialCashEur });
      journal.appendEvent('FILL_RECORDED', { fill: fillA, order }, '2026-10-12T10:00:01.000Z');
      journal.appendEvent('PORTFOLIO_APPLIED', { fill_id: fillA.fill_id, order_id: order.order_id }, '2026-10-12T10:00:01.000Z');
      expect(portfolio.isFillProcessed('fill-fb-a')).toBe(false);

      const result = CrashRecoveryEngine.recoverDurable(journal, portfolio, '2026-10-12T10:00:02.000Z');
      expect(result.recovered_fills_count).toBe(1);
      expect(portfolio.isFillProcessed('fill-fb-a')).toBe(true);
    }

    // Boundary 4: Same fill ID, altered content => Reject with E-ERR-046
    {
      const journal = new DurableRecoveryJournal();
      const portfolio = new SimulationPortfolio({ initialCash: initialCashEur });
      portfolio.processFill(fillA, order, '2026-10-12T10:00:01.000Z');

      const fillConflicting: SimulatedFillEvent = { ...fillA, fill_quantity: 20 };
      journal.appendEvent('FILL_RECORDED', { fill: fillConflicting, order }, '2026-10-12T10:00:01.000Z');

      expect(() => CrashRecoveryEngine.recoverDurable(journal, portfolio, '2026-10-12T10:00:02.000Z'))
        .toThrow('E-ERR-046: FILL_IDEMPOTENCY_CONFLICT');
    }

    // Boundary 5: Journal integrity failure => Reject with E-ERR-024
    {
      const journal = new DurableRecoveryJournal();
      const portfolio = new SimulationPortfolio({ initialCash: initialCashEur });
      journal.appendEvent('FILL_RECORDED', { fill: fillA, order }, '2026-10-12T10:00:01.000Z');
      (journal as any).entries[0].entry_sha256 = 'f'.repeat(64);

      expect(() => CrashRecoveryEngine.recoverDurable(journal, portfolio, '2026-10-12T10:00:02.000Z'))
        .toThrow('E-ERR-024: CORRUPT_JOURNAL_ON_RECOVERY');
    }
  });

  // --------------------------------------------------------------------------------------
  // 8. Genuine OS Process Crash & Fresh Restart Recovery Parity
  // --------------------------------------------------------------------------------------
  it('M3-GENUINE-PROCESS-RESTART-RECOVERY-013: Genuine OS child process crash terminates in-memory state; fresh restart recovers 100% benchmark parity', () => {
    const tmpDir = path.resolve(process.cwd(), 'tmp_process_crash_test');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const benchWal = path.join(tmpDir, 'bench.wal');
    const benchCheckpoint = path.join(tmpDir, 'bench.json');
    const benchOutput = path.join(tmpDir, 'bench_out.json');

    const crashWal = path.join(tmpDir, 'crash.wal');
    const crashCheckpoint = path.join(tmpDir, 'crash.json');
    const crashOutput = path.join(tmpDir, 'crash_out.json');

    const workerScript = path.resolve(process.cwd(), 'scripts', 'test_crash_worker.ts');
    const tsxCli = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

    try {
      // 1. Run uninterrupted benchmark in separate child process
      const benchProc = spawnSync(process.execPath, [
        tsxCli,
        workerScript,
        JSON.stringify({
          mode: 'BENCHMARK',
          journalPath: benchWal,
          checkpointPath: benchCheckpoint,
          outputPath: benchOutput,
          currency: 'EUR',
          scale: 4
        })
      ], { encoding: 'utf8' });
      expect(benchProc.status).toBe(0);
      const benchmarkData = JSON.parse(fs.readFileSync(benchOutput, 'utf8'));

      // 2. Spawn Child Process 1: Runs Fill 1, checkpoints, logs Fill 2 to WAL, and hard crashes (process.exit(99))
      const crashProc = spawnSync(process.execPath, [
        tsxCli,
        workerScript,
        JSON.stringify({
          mode: 'CRASH_BEFORE_FILL2_APPLY',
          journalPath: crashWal,
          checkpointPath: crashCheckpoint,
          currency: 'EUR',
          scale: 4
        })
      ], { encoding: 'utf8' });

      // Verify Child Process 1 crashed abnormally with exit code 99
      expect(crashProc.status).toBe(99);

      // Verify WAL and Checkpoint exist on disk
      expect(fs.existsSync(crashWal)).toBe(true);
      expect(fs.existsSync(crashCheckpoint)).toBe(true);

      // 3. Spawn Child Process 2: Starts up completely fresh from disk and recovers state
      const recoverProc = spawnSync(process.execPath, [
        tsxCli,
        workerScript,
        JSON.stringify({
          mode: 'RECOVER',
          journalPath: crashWal,
          checkpointPath: crashCheckpoint,
          outputPath: crashOutput,
          currency: 'EUR',
          scale: 4
        })
      ], { encoding: 'utf8' });
      expect(recoverProc.status).toBe(0);

      const recoveredData = JSON.parse(fs.readFileSync(crashOutput, 'utf8'));

      // 4. Prove complete bit-for-bit parity between recovered process and benchmark across all dimensions
      // A. Complete snapshot parity (cash, positions, P&L, journal)
      expect(recoveredData.snapshot).toEqual(benchmarkData.snapshot);
      expect(canonicalizeJCS(recoveredData.snapshot)).toBe(canonicalizeJCS(benchmarkData.snapshot));

      // B. Complete checkpoint parity (including processed fill IDs and fingerprints)
      expect(recoveredData.checkpoint).toEqual(benchmarkData.checkpoint);
      expect(canonicalizeJCS(recoveredData.checkpoint)).toBe(canonicalizeJCS(benchmarkData.checkpoint));

      // C. Processed fill fingerprints parity
      expect(recoveredData.checkpoint.processed_fill_fingerprints).toEqual(benchmarkData.checkpoint.processed_fill_fingerprints);

      // D. Full journal entries history parity
      expect(recoveredData.snapshot.journal).toEqual(benchmarkData.snapshot.journal);

      // E. Recovery result verification
      expect(recoveredData.recoveryResult.recovered_fills_count).toBe(1);
      expect(recoveredData.recoveryResult.skipped_duplicate_fills_count).toBe(1);

      // F. Verify reloaded WAL hash chain
      const reloadedJournal = new FileBackedDurableRecoveryJournal(crashWal);
      expect(reloadedJournal.verifyIntegrity().isValid).toBe(true);
      reloadedJournal.close();
    } finally {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  // --------------------------------------------------------------------------------------
  // 9. WAL Flush Failure Fault Injection & Live State Poisoning
  // --------------------------------------------------------------------------------------
  it('M3-WAL-FLUSH-FAIL-POISONING-014: Disk flush failure poisons live journal without in-memory state divergence', () => {
    const tmpDir = path.resolve(process.cwd(), 'tmp_test_wal_poison');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const walPath = path.join(tmpDir, `poison_test_${Date.now()}.log`);

    try {
      const journal = new FileBackedDurableRecoveryJournal(walPath);
      // Sequence 1 succeeds
      journal.appendEvent('INTENT_RECORDED', { intent: 'i-001' }, '2026-10-12T10:00:00.000Z');
      expect(journal.getEntryCount()).toBe(1);

      // Fault Injection: mock writeSync to simulate physical I/O write failure
      const origWriteSync = fs.writeSync;
      (fs as any).writeSync = () => {
        throw new Error('EIO: simulated physical I/O write failure');
      };

      try {
        // Attempting to append sequence 2 must fail on disk write/flush
        expect(() => journal.appendEvent('ORDER_SUBMITTED', { order: 'o-001' }, '2026-10-12T10:00:01.000Z'))
          .toThrow('E-ERR-024: WAL_FSYNC_FAILED');
      } finally {
        fs.writeSync = origWriteSync;
      }

      // Verify in-memory state did NOT advance (strictly stayed at sequence 1)
      expect(journal.getEntryCount()).toBe(1);
      expect(journal.getIsPoisoned()).toBe(true);

      // Verify live journal is permanently poisoned and rejects further writes
      expect(() => journal.appendEvent('ORDER_SUBMITTED', { order: 'o-002' }, '2026-10-12T10:00:02.000Z'))
        .toThrow('E-ERR-024: JOURNAL_POISONED');
    } finally {
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------------------
  // 10. Torn-Tail WAL Append Recovery & Mid-Log Tamper Fail-Closed
  // --------------------------------------------------------------------------------------
  it('M3-WAL-TORN-TAIL-RECOVERY-015: Torn-tail recovery safely truncates unacknowledged trailing partial writes while failing closed on mid-log corruption', () => {
    const tmpDir = path.resolve(process.cwd(), 'tmp_test_wal_torn');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const walPath = path.join(tmpDir, `torn_test_${Date.now()}.log`);

    try {
      // 1. Write 2 valid acknowledged entries to WAL
      const initialJournal = new FileBackedDurableRecoveryJournal(walPath);
      initialJournal.appendEvent('INTENT_RECORDED', { intent_id: 'i-100' }, '2026-10-12T10:00:00.000Z');
      initialJournal.appendEvent('ORDER_SUBMITTED', { order_id: 'o-100' }, '2026-10-12T10:00:01.000Z');
      initialJournal.close();

      // 2. Fault Injection: simulate an abrupt process kill mid-write by appending an incomplete, truncated torn line
      fs.appendFileSync(walPath, '{"entry_id":"rec:ent:3","event_type":"FILL_RECORDED","payload":{"par', 'utf8');

      // 3. Restart process with default TRUNCATE_TORN_TAIL policy
      const recoveredJournal = new FileBackedDurableRecoveryJournal({
        filePath: walPath,
        tornTailPolicy: 'TRUNCATE_TORN_TAIL'
      });

      // Verify torn tail was truncated and journal recovered valid entries 1 and 2
      expect(recoveredJournal.getEntryCount()).toBe(2);
      expect(recoveredJournal.verifyIntegrity().isValid).toBe(true);

      // 4. Verify recovered journal can cleanly accept sequence 3 with valid hash chaining
      const entry3 = recoveredJournal.appendEvent('PORTFOLIO_APPLIED', { fill_id: 'f-100' }, '2026-10-12T10:00:02.000Z');
      expect(entry3.sequence_number).toBe(3);
      expect(recoveredJournal.verifyIntegrity().isValid).toBe(true);
      recoveredJournal.close();

      // 5. Fault Injection: Mid-log corruption (line 1 of 3 corrupted) must FAIL CLOSED even under TRUNCATE_TORN_TAIL
      const allContent = fs.readFileSync(walPath, 'utf8');
      const corruptedMidLog = allContent.replace('i-100', 'i-CORRUPTED');
      fs.writeFileSync(walPath, corruptedMidLog, 'utf8');

      expect(() => new FileBackedDurableRecoveryJournal({
        filePath: walPath,
        tornTailPolicy: 'TRUNCATE_TORN_TAIL'
      })).toThrow('E-ERR-024: CORRUPT_JOURNAL');
    } finally {
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
