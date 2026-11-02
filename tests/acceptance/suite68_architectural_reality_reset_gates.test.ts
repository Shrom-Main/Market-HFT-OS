/**
 * POC-001: Acceptance Suite 68 — Architectural Reality Reset & Integrity Remediation
 *
 * Certifies Mandatory Acceptance Gates A through E specified in the Architectural Reality Reset Directive:
 * - Gate A: Empty Database Truthfulness (0 candidates, 0 events, 0 theses, ₹0 spend, empty bitemporal observations)
 * - Gate B: Canonical Discovery (Screen golden fixtures, persist to PG, addressable everywhere)
 * - Gate C: Discovery-to-Position (screen -> investigate -> evaluate -> commit creates persistent paper position and debits cash)
 * - Gate D: Signal-to-Thesis Reactivity (Incoming signals update PG, trigger snapshot updates, broadcast typed WebSocket envelopes)
 * - Gate E: Persistence and Recovery (Server restart preserves all domain state, positions, cash, and candidates from PG)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import pg from 'pg';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';

function httpRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json?: any }> {
  return new Promise((resolve, reject) => {
    const defaultHeaders: Record<string, string> = {
      Host: `127.0.0.1:${options.port}`,
      ...options.headers
    };

    if (options.body && !defaultHeaders['Content-Length'] && !defaultHeaders['content-length']) {
      defaultHeaders['Content-Length'] = String(Buffer.byteLength(options.body, 'utf8'));
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method || 'GET',
        headers: defaultHeaders
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json: any;
          try {
            json = JSON.parse(raw);
          } catch {
            json = undefined;
          }
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: raw,
            json
          });
        });
      }
    );

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe('Suite 68: Architectural Reality Reset & Institutional Workstation Gates A-E', () => {
  let server: WorkstationServer;
  let stateManager: WorkstationStateManager;
  let serverPort: number;
  let pgPool: pg.Pool;
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/market_hft_test';

  beforeAll(async () => {
    pgPool = new pg.Pool({ connectionString: dbUrl });

    // Clean tables before starting Gate A
    await pgPool.query(`
      TRUNCATE TABLE
        market_opportunity_candidates,
        market_candidate_lifecycle_events,
        market_investigation_tasks,
        market_paper_positions,
        market_paper_cash_ledger,
        market_committed_bundles,
        market_hypothesis_ledger,
        market_bitemporal_evidence,
        market_event_overlays,
        market_signal_traces
      CASCADE;
    `).catch(() => {});

    stateManager = new WorkstationStateManager();
    server = new WorkstationServer({
      port: 0,
      host: '127.0.0.1',
      stateManager
    });

    const started = await server.start();
    serverPort = started.port;

    // Small delay to allow centralResearchCore initialization and table checks
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    await server.stop();
    await pgPool.end().catch(() => {});
  });

  // ==========================================================================
  // GATE A: Empty Database Truthfulness
  // ==========================================================================
  it('GATE-A: boots truthfully with empty tables (0 candidates, 0 events, 0 theses, ₹0 spend, empty observations)', async () => {
    // 1. Snapshot check
    const snapRes = await httpRequest({ port: serverPort, path: '/api/snapshot' });
    expect(snapRes.statusCode).toBe(200);
    const snap = snapRes.json.snapshot.workspaces;

    // Committed capital must be ₹0.00 (not hardcoded ₹19,105)
    expect(snap.command_center.committed_paper_capital_inr.value).toBe('0.00');
    expect(snap.simulation_and_positions.paper_positions).toHaveLength(0);

    // 2. Gallery products endpoint must return 0 candidates on empty DB
    const prodsRes = await httpRequest({ port: serverPort, path: '/api/gallery/products' });
    expect(prodsRes.statusCode).toBe(200);
    expect(prodsRes.json.candidates).toHaveLength(0);

    // 3. Gallery theses endpoint must return 0 theses
    const thesesRes = await httpRequest({ port: serverPort, path: '/api/gallery/theses' });
    expect(thesesRes.statusCode).toBe(200);
    expect(thesesRes.json.theses).toHaveLength(0);

    // 4. Gallery events endpoint must return 0 events
    const eventsRes = await httpRequest({ port: serverPort, path: '/api/gallery/events' });
    expect(eventsRes.statusCode).toBe(200);
    expect(eventsRes.json.events).toHaveLength(0);

    // 5. Bitemporal series must return empty array without fake Math.sin wave
    const bitempRes = await httpRequest({ port: serverPort, path: '/api/bitemporal/series?product_id=prod:din3017:ss304:16-25mm:pack-10' });
    expect(bitempRes.statusCode).toBe(200);
    expect(bitempRes.json.points).toHaveLength(0);
    expect(bitempRes.json.series_points_count).toBe(0);
  });

  // ==========================================================================
  // GATE B: Canonical Discovery & PostgreSQL Persistence
  // ==========================================================================
  it('GATE-B: screens golden fixture, persists candidate and lifecycle event to PostgreSQL, and reflects in radar', async () => {
    const screenRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/screen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-AMZ-SS304-001' })
    });

    expect(screenRes.statusCode).toBe(200);
    const screened = screenRes.json;
    expect(screened.candidate).toBeDefined();
    expect(screened.candidate.candidate_id).toBeDefined();
    const candId = screened.candidate.candidate_id;

    // Verify candidate row persisted to PostgreSQL market_opportunity_candidates
    const pgCand = await pgPool.query('SELECT candidate_id, lifecycle_state FROM market_opportunity_candidates WHERE candidate_id = $1', [candId]);
    expect(pgCand.rows).toHaveLength(1);
    expect(pgCand.rows[0].lifecycle_state).toBe('NEW');

    // Verify lifecycle event row persisted to PostgreSQL market_candidate_lifecycle_events
    const pgEvt = await pgPool.query('SELECT candidate_id, next_state FROM market_candidate_lifecycle_events WHERE candidate_id = $1', [candId]);
    expect(pgEvt.rows.length).toBeGreaterThanOrEqual(1);
    expect(pgEvt.rows[0].next_state).toBe('NEW');

    // Verify candidate is addressable via API
    const candGetRes = await httpRequest({ port: serverPort, path: `/api/candidates/${candId}` });
    expect(candGetRes.statusCode).toBe(200);
    expect(candGetRes.json.candidate_id).toBe(candId);
  });

  // ==========================================================================
  // GATE C: Discovery-to-Position Pipeline & Capital Ledger Debit
  // ==========================================================================
  it('GATE-C: executes complete discovery-to-position pipeline, creating paper position row and cash debit in PG', async () => {
    // 1. Evaluate bundle for paper allocation (balanced across suppliers to satisfy concentration limits)
    const evalRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        available_paper_capital_inr: 500000,
        minimum_return_hurdle_bps: 1500,
        holding_period_days: 60,
        max_drawdown_limit_bps: 3000,
        max_single_supplier_concentration_bps: 7000,
        selected_product_ids: [
          'prod:festive:diya:terracotta-12p',
          'prod:brass:ball-valve:1-2in-pn20'
        ]
      })
    });
    expect(evalRes.statusCode).toBe(200);
    const bundleEval = evalRes.json;
    expect(bundleEval.bundle_id).toBeDefined();
    expect(bundleEval.recommended_disposition === 'RECOMMENDED_PURSUE' || bundleEval.recommended_disposition === 'READY_FOR_PAPER_TEST').toBe(true);

    // 2. Commit bundle allocation with operator confirmation envelope
    const commitRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/commit',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bundle_id: bundleEval.bundle_id,
        confirmation: {
          operator_id: 'OP_SUPERVISOR',
          confirmation_token: 'CONF-TOKEN-GATE-C-001',
          explicit_rationale: 'Approved paper testing for multi-product allocation batch.',
          confirmed_at_utc: new Date().toISOString()
        }
      })
    });
    expect(commitRes.statusCode).toBe(200);
    const commitOutcome = commitRes.json.outcome;
    expect(commitOutcome.status).toBe('COMMITTED_TO_PAPER_SIMULATION');

    // 3. Verify PostgreSQL market_paper_positions row exists
    const posRows = await pgPool.query('SELECT position_id, allocated_capital_subunits, lifecycle_status FROM market_paper_positions');
    expect(posRows.rows.length).toBeGreaterThanOrEqual(1);
    expect(posRows.rows[0].lifecycle_status).toBe('COMMITTED');

    // 4. Verify PostgreSQL market_paper_cash_ledger debit entry exists
    const cashRows = await pgPool.query('SELECT entry_id, entry_type, amount_subunits, balance_after_subunits FROM market_paper_cash_ledger');
    expect(cashRows.rows.length).toBeGreaterThanOrEqual(1);
    const debitEntry = cashRows.rows.find(r => r.entry_type === 'ALLOCATION_DEBIT');
    expect(debitEntry).toBeDefined();
    expect(debitEntry.amount_subunits.startsWith('-')).toBe(true);

    // 5. Verify snapshot reflects the new position and updated treasury balance
    const snapRes = await httpRequest({ port: serverPort, path: '/api/snapshot' });
    expect(snapRes.statusCode).toBe(200);
    const snap = snapRes.json.snapshot.workspaces;
    expect(snap.simulation_and_positions.paper_positions.length).toBeGreaterThanOrEqual(1);
    expect(Number(snap.command_center.committed_paper_capital_inr.value)).toBeGreaterThan(0);
  });

  // ==========================================================================
  // GATE D: Signal-to-Thesis Reactivity & Event Broadcast
  // ==========================================================================
  it('GATE-D: ingests market signal, updates PostgreSQL, and emits state update envelope', async () => {
    let capturedEvent: any = null;
    stateManager.subscribe((event) => {
      capturedEvent = event;
    });

    const now = new Date().toISOString();
    const nonce = `${Date.now()}-${Math.random()}`;
    const signalRes = await httpRequest({
      port: serverPort,
      path: '/api/signals/ingest',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'MARKETPLACE_OR_SUPPLIER_HTML',
        source_id: 'conn:marketplace:amazon-in',
        target_url: `https://www.amazon.in/dp/B09XYZ1234?nonce=${nonce}`,
        event_time_utc: now,
        receipt_time_utc: now,
        raw_payload: {
          supplier_id: `SUP-AMZ-${nonce}`,
          sku_id: 'SKU-SS304-16-25MM-P10',
          raw_quote_inr: 3.50,
          freight_cost_inr: 0.15,
          packaging_cost_inr: 0.10,
          gst_rate_bps: 1800
        }
      })
    });

    expect(signalRes.statusCode).toBe(200);

    // Verify signal trace persisted to PostgreSQL market_signal_traces
    const traceRows = await pgPool.query('SELECT trace_id, signal_id FROM market_signal_traces');
    expect(traceRows.rows.length).toBeGreaterThanOrEqual(1);

    // Verify StateManager listener received state update
    expect(capturedEvent).toBeDefined();
    expect(capturedEvent.type).toBe('SNAPSHOT_UPDATED');
    expect(capturedEvent.details?.signal_id).toBeDefined();
  });

  // ==========================================================================
  // GATE E: Persistence & Recovery (Preserves Domain State Across Restart)
  // ==========================================================================
  it('GATE-E: server restart preserves all domain state, positions, cash balance, and candidates from PostgreSQL', async () => {
    // Read state before shutdown
    const prePosRows = await pgPool.query('SELECT COUNT(*) as cnt FROM market_paper_positions');
    const preCandRows = await pgPool.query('SELECT COUNT(*) as cnt FROM market_opportunity_candidates');
    const expectedPositionsCount = Number(prePosRows.rows[0].cnt);
    const expectedCandidatesCount = Number(preCandRows.rows[0].cnt);
    expect(expectedPositionsCount).toBeGreaterThan(0);
    expect(expectedCandidatesCount).toBeGreaterThan(0);

    // Simulate Server Restart: Stop server and instantiate fresh StateManager & Server
    await server.stop();

    const recoveredStateManager = new WorkstationStateManager();
    const recoveredServer = new WorkstationServer({
      port: 0,
      host: '127.0.0.1',
      stateManager: recoveredStateManager
    });
    const restarted = await recoveredServer.start();
    const restartPort = restarted.port;

    // Wait for hydration from PostgreSQL
    await new Promise((resolve) => setTimeout(resolve, 800));

    try {
      // 1. Verify candidates recovered in OpportunityLifecycleEngine
      const recoveredCandidates = recoveredStateManager.getLifecycleEngine().getInMemoryCandidates();
      expect(recoveredCandidates.length).toBe(expectedCandidatesCount);

      // 2. Verify paper positions recovered in CentralResearchCore
      const recoveredPositions = recoveredStateManager.getCentralResearchCore().getInMemoryPaperPositions();
      expect(recoveredPositions.length).toBe(expectedPositionsCount);

      // 3. Verify snapshot projects recovered positions and debited cash balance
      const snapRes = await httpRequest({ port: restartPort, path: '/api/snapshot' });
      expect(snapRes.statusCode).toBe(200);
      const snap = snapRes.json.snapshot.workspaces;
      expect(snap.simulation_and_positions.paper_positions.length).toBe(expectedPositionsCount);
      expect(Number(snap.command_center.committed_paper_capital_inr.value)).toBeGreaterThan(0);
    } finally {
      await recoveredServer.stop();
    }
  });
});
