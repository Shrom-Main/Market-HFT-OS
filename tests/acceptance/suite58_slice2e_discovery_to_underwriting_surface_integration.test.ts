/**
 * POC-001: Acceptance Suite 58 — Slice 2E Discovery-to-Underwriting Product Surface Integration
 *
 * Verifies the complete end-to-end integration connecting the discovery screener,
 * investigation planner, fenced task queue, deterministic underwriting engine,
 * authoritative workstation state manager, loopback HTTP API, and standalone HTML export.
 *
 * Invariants Tested:
 * 1. S58-001: Golden fixture ingestion via HTTP screen endpoint projects into opportunity radar.
 * 2. S58-002: Fenced task claiming and submission enforces monotonically increasing fencing tokens (HTTP 409 on stale).
 * 3. S58-003: Deterministic underwriting computes exact mathematical margins without hardcoding.
 * 4. S58-004: Authoritative snapshot projects underwritten candidates into capital allocator workspace.
 * 5. S58-005: Capital budget safety fails closed under unconfigured budget and authorizes under explicit paper budget.
 * 6. S58-006: Incomplete / unviable candidates retain explicit missing cost inputs (never zeroed).
 * 7. S58-007: Standalone HTML export consumes authoritative state without parallel stores or external dependencies.
 * 8. S58-008: Zero-drift JCS SHA-256 cryptographic attestation and live WebSocket event broadcast.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocket } from 'ws';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import { GoldenDiscoveryFixtureRegistry } from '../../src/discovery/fixtures/goldenDiscoveryFixtures.js';
import { exportStandaloneHtml } from '../../src/cli/exportStandaloneHtml.js';

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

describe('Suite 58: Slice 2E Discovery-to-Underwriting Product Surface Integration', () => {
  let server: WorkstationServer;
  let stateManager: WorkstationStateManager;
  let serverPort: number;
  let serverUrl: string;
  let discoveredCandidateId: string;
  let claimedTaskId: string;
  let claimedGenerationId: string;
  let claimedFencingToken: number;

  beforeAll(async () => {
    stateManager = new WorkstationStateManager();
    // Ephemeral OS port assignment (port: 0) strictly bound to loopback 127.0.0.1
    server = new WorkstationServer({
      port: 0,
      host: '127.0.0.1',
      stateManager
    });

    const started = await server.start();
    serverPort = started.port;
    serverUrl = started.url;
  });

  afterAll(async () => {
    await server.stop();
  });

  // ==========================================================================
  // S58-001: Fixture Screening & Opportunity Radar Projection
  // ==========================================================================
  it('S58-001: screens recorded fixture FIX-AMZ-BRASS-001 and projects candidate into opportunity radar with DATA_REQUIRED', async () => {
    // 1. Post fixture screening request
    const screenRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/screen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fixture_id: 'FIX-AMZ-BRASS-001'
      })
    });

    expect(screenRes.statusCode).toBe(200);
    expect(screenRes.json).toBeDefined();
    expect(screenRes.json.resolution_status).toBe('RESOLVED');
    expect(screenRes.json.candidate).toBeDefined();
    expect(screenRes.json.candidate.candidate_id).toMatch(/^OPP-/);

    discoveredCandidateId = screenRes.json.candidate.candidate_id;

    // 2. Verify candidate inspection endpoint
    const candRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${discoveredCandidateId}`
    });
    expect(candRes.statusCode).toBe(200);
    expect(candRes.json.candidate_id).toBe(discoveredCandidateId);
    expect(candRes.json.lifecycle_state).toBe('NEW');

    // 3. Verify snapshot projection in opportunity_radar
    const snapRes = await httpRequest({
      port: serverPort,
      path: '/api/snapshot'
    });
    expect(snapRes.statusCode).toBe(200);
    const radar = snapRes.json.snapshot.workspaces.opportunity_radar;
    expect(radar).toBeDefined();

    const projectedItem = radar.opportunities.find((o: any) => o.candidate_id === discoveredCandidateId);
    expect(projectedItem).toBeDefined();
    expect(projectedItem.evidence_origin).toBeDefined();
    expect(projectedItem.evidence_origin.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
    expect(projectedItem.evidence_gap_status).toBe('DATA_REQUIRED');
  });

  // ==========================================================================
  // S58-002: Fenced Investigation Claim & Monotonic Lease Rejection
  // ==========================================================================
  it('S58-002: claims investigation task, rejects stale fencing token with HTTP 409, and accepts valid evidence commit', async () => {
    // 1. Claim task via POST /api/discovery/investigate
    const claimRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'claim',
        worker_id: 'worker-suite-58',
        candidate_id: discoveredCandidateId
      })
    });

    expect(claimRes.statusCode).toBe(200);
    expect(claimRes.json.task).toBeDefined();
    expect(claimRes.json.task.task_id).toBeDefined();
    expect(claimRes.json.task.fencing_token).toBeGreaterThanOrEqual(1);

    claimedTaskId = claimRes.json.task.task_id;
    claimedGenerationId = claimRes.json.task.generation_id;
    claimedFencingToken = claimRes.json.task.fencing_token;

    // 2. Reject stale fencing token with HTTP 409
    const staleRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: claimedTaskId,
        candidate_id: discoveredCandidateId,
        generation_id: claimedGenerationId,
        lease_owner_id: 'worker-suite-58',
        fencing_token: 9999, // Stale / invalid fence token
        result_payload: { factory_gate_quote_inr: 115.0 },
        evidence_origin: {
          source_connector_id: 'conn:b2b:indiamart',
          origin_class: 'RECORDED_GOLDEN_FIXTURE',
          observed_at_utc: '2026-10-24T13:15:00.000Z'
        }
      })
    });

    expect(staleRes.statusCode).toBe(409);
    expect(staleRes.json.error.error_id).toContain('E-QUEUE-STALE-LEASE-FENCE-REJECTED');

    // 3. Commit valid investigation evidence with active fencing token
    const imartFixture = GoldenDiscoveryFixtureRegistry.getFixtureById('FIX-IMART-BRASS-001')!;
    const validCommitRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: claimedTaskId,
        candidate_id: discoveredCandidateId,
        generation_id: claimedGenerationId,
        lease_owner_id: 'worker-suite-58',
        fencing_token: claimedFencingToken,
        result_payload: {
          factory_gate_quote_inr: 115.0,
          has_logistics_route: true,
          has_regulatory_clearance: true
        },
        evidence_origin: {
          source_connector_id: imartFixture.source_connector_id,
          origin_class: imartFixture.origin_class,
          observed_at_utc: imartFixture.source_observed_at_utc,
          verification_status: 'VERIFIED'
        },
        extracted_fields: {
          factory_gate_quote_inr: 115.0,
          has_logistics_route: true,
          has_regulatory_clearance: true,
          applicable_cost_categories: ['SUPPLIER_PURCHASE'],
          cost_category_exclusions: [
            { category: 'INBOUND_FREIGHT', exclusion_basis: 'SUPPLIER_INCLUDED_FREIGHT' },
            { category: 'PACKAGING_KITTING', exclusion_basis: 'FACTORY_SEALED_RETAIL_READY' },
            { category: 'MARKETPLACE_FEES', exclusion_basis: 'DIRECT_DISTRIBUTION_ZERO_COMMISSION' },
            { category: 'STATUTORY_TAX', exclusion_basis: 'EXPORT_SPECIAL_ECONOMIC_ZONE_EXEMPT' },
            { category: 'RETURN_DEFECT_DRAG', exclusion_basis: 'SUPPLIER_TOTAL_DEFECT_UNDERWRITING' }
          ]
        }
      })
    });

    expect(validCommitRes.statusCode).toBe(200);
    expect(validCommitRes.json.commit_status).toBe('COMMITTED');

    // 4. Verify candidate in snapshot updated to DATA_COMPLETE
    const snapRes = await httpRequest({ port: serverPort, path: '/api/snapshot' });
    const radar = snapRes.json.snapshot.workspaces.opportunity_radar;
    const updatedItem = radar.opportunities.find((o: any) => o.candidate_id === discoveredCandidateId);
    expect(updatedItem.evidence_gap_status).toBe('DATA_COMPLETE');
  });

  // ==========================================================================
  // S58-003: Deterministic Underwriting & Exact Unit Economics Math
  // ==========================================================================
  it('S58-003: underwrites candidate via HTTP API, calculating exact margin (6406 bps) without hardcoded values', async () => {
    const underwriteRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${discoveredCandidateId}/underwrite`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(underwriteRes.statusCode).toBe(200);
    const decision = underwriteRes.json;
    expect(decision.outcome).toBe('ELIGIBLE');
    expect(decision.evaluation_status).toBe('EVALUATED_VIABLE');

    // Verify exact mathematical derivation:
    // Retail ASP = 320.00, Supplier Quote = 115.00
    // Gross Spread = 320.00 - 115.00 = 205.00
    // Margin bps = Math.round((205.00 / 320.00) * 10000) = 6406 bps (64.06%)
    expect(decision.unit_economics.prevailing_retail_asp_inr).toBe(320.0);
    expect(decision.unit_economics.factory_gate_quote_inr).toBe(115.0);
    expect(decision.unit_economics.gross_spread_inr).toBe(205.0);
    expect(decision.unit_economics.estimated_margin_bps).toBe(6406);
    expect(decision.unit_economics.net_contribution_inr).toBe(205.0);
    expect(decision.unit_economics.contribution_margin_bps).toBe(6406);

    // Verify provenance retention (never promoted to LIVE)
    expect(decision.evidence_summary.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
    expect(decision.evidence_summary.is_live_market_verified).toBe(false);

    // Verify GET /api/candidates/:id/decision retrieves identical decision
    const decisionGetRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${discoveredCandidateId}/decision`
    });
    expect(decisionGetRes.statusCode).toBe(200);
    expect(decisionGetRes.json.unit_economics.estimated_margin_bps).toBe(6406);
    expect(decisionGetRes.json.evidence_summary.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
  });

  // ==========================================================================
  // S58-004: Authoritative Snapshot Projection into Capital Allocator
  // ==========================================================================
  it('S58-004: projects underwritten candidate into capital_allocator workspace with exact return bps and gate badge', async () => {
    const snapRes = await httpRequest({ port: serverPort, path: '/api/snapshot' });
    expect(snapRes.statusCode).toBe(200);

    const allocator = snapRes.json.snapshot.workspaces.capital_allocator;
    expect(allocator).toBeDefined();

    const candidateRow = allocator.opportunities.find((o: any) => o.candidate_id === discoveredCandidateId);
    expect(candidateRow).toBeDefined();
    expect(candidateRow.expected_return_bps.value).toBe(6406);
    expect(candidateRow.return_after_costs_and_taxes_bps.value).toBe(6406);
    expect(candidateRow.gate_badge.label).toBe('ELIGIBLE');
    expect(candidateRow.evidence_origin.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
  });

  // ==========================================================================
  // S58-005: Capital Allocation Safety & Budget Gate Enforcement
  // ==========================================================================
  it('S58-005: refuses paper capital allocation without explicit budget, and authorizes only upon valid budget config', async () => {
    // 1. Initial underwriting without budget resulted in NOT_AUTHORIZED_BUDGET_UNCONFIGURED
    const decisionRes1 = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${discoveredCandidateId}/decision`
    });
    expect(decisionRes1.json.capital_allocation.capital_allocation_decision).toBe('NOT_AUTHORIZED_BUDGET_UNCONFIGURED');

    // Candidate cannot transition to PAPER_ELIGIBLE without budget authorization
    const lifecycleEngine = stateManager.getLifecycleEngine();
    await lifecycleEngine.transitionState(discoveredCandidateId, 'INVESTIGATE', 'Task dispatch');
    await lifecycleEngine.transitionState(discoveredCandidateId, 'UNDER_REVIEW', 'Analyst review');
    await lifecycleEngine.transitionState(discoveredCandidateId, 'VERIFIED', 'Evidence sufficient');

    // Attempting paper commit without budget is blocked fail-closed
    await expect(
      lifecycleEngine.authorizePaperCommit(
        discoveredCandidateId,
        'Authorized operator commitment rationale for paper simulation',
        'operator-suite-58'
      )
    ).rejects.toThrow(/E-OPP-BUDGET-UNCONFIGURED/);

    // 2. Re-underwrite via HTTP API with explicit paper budget
    const decisionRes2 = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${discoveredCandidateId}/underwrite`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budgetConfig: {
          available_paper_capital_inr: 500000,
          max_single_allocation_inr: 250000
        }
      })
    });

    expect(decisionRes2.statusCode).toBe(200);
    expect(decisionRes2.json.capital_allocation.capital_allocation_decision).toBe('ALLOCATE_CAPITAL');

    // 3. Now paper commit with configured budget succeeds cleanly and achieves PAPER_ELIGIBLE
    const commitResult = await lifecycleEngine.authorizePaperCommit(
      discoveredCandidateId,
      'Authorized operator commitment rationale for paper simulation',
      'operator-suite-58',
      {
        available_paper_capital_inr: 500000,
        max_single_allocation_inr: 250000
      }
    );
    expect(commitResult.authorized).toBe(true);

    const candRes2 = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${discoveredCandidateId}`
    });
    expect(candRes2.json.lifecycle_state).toBe('PAPER_ELIGIBLE');
  });

  // ==========================================================================
  // S58-006: Incomplete / Unviable Candidate Gaps Visible in Surface
  // ==========================================================================
  it('S58-006: screens unpriced fixture, fails underwriting closed with INSUFFICIENT_EVIDENCE and explicit missing costs', async () => {
    // 1. Screen unpriced software fixture FIX-SAAS-DEVTOOL-MISSING-PRICE-002
    const screenRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/screen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fixture_id: 'FIX-SAAS-DEVTOOL-MISSING-PRICE-002'
      })
    });

    expect(screenRes.statusCode).toBe(200);
    const unpricedCandidateId = screenRes.json.candidate.candidate_id;

    // 2. Underwriting unpriced candidate fails closed
    const underwriteRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${unpricedCandidateId}/underwrite`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(underwriteRes.statusCode).toBe(200);
    const decision = underwriteRes.json;
    expect(decision.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.evaluation_status).toBe('UNEVALUABLE_INPUTS_MISSING');
    expect(decision.unit_economics.estimated_margin_bps).toBeNull();

    // Missing cost inputs must be explicitly populated (never assumed zero)
    expect(decision.unit_economics.missing_cost_inputs).toContain('SUPPLIER_PURCHASE');
    expect(decision.binding_constraints.length).toBeGreaterThan(0);

    // 3. Gaps projected in snapshot
    const snapRes = await httpRequest({ port: serverPort, path: '/api/snapshot' });
    const radar = snapRes.json.snapshot.workspaces.opportunity_radar;
    const item = radar.opportunities.find((o: any) => o.candidate_id === unpricedCandidateId);
    expect(item).toBeDefined();
    expect(item.evidence_gap_status).toBe('DATA_REQUIRED');
  });

  // ==========================================================================
  // S58-007: Standalone Offline HTML Export Consumption
  // ==========================================================================
  it('S58-007: exports standalone HTML containing discovered candidate ID, [FIXTURE] badge, and calculated margin', async () => {
    const tmpExportPath = path.join(os.tmpdir(), `test-workstation-export-${Date.now()}.html`);

    try {
      const exportResult = exportStandaloneHtml(tmpExportPath, stateManager);
      expect(fs.existsSync(exportResult.filePath)).toBe(true);
      expect(exportResult.byteLength).toBeGreaterThan(10000);

      const htmlContent = fs.readFileSync(exportResult.filePath, 'utf8');

      // 1. Must contain discovered candidate ID
      expect(htmlContent).toContain(discoveredCandidateId);

      // 2. Must contain fixture provenance badge
      expect(htmlContent).toContain('[FIXTURE]');

      // 3. Must contain calculated 64.06% return
      expect(htmlContent).toContain('64.06%');

      // 4. Must not contain un-inlined external CDN scripts
      expect(htmlContent).not.toMatch(/src="https?:\/\//);
    } finally {
      if (fs.existsSync(tmpExportPath)) {
        fs.unlinkSync(tmpExportPath);
      }
    }
  });

  // ==========================================================================
  // S58-008: Zero-Drift JCS SHA-256 Consistency & Live WebSocket Telemetry
  // ==========================================================================
  it('S58-008: maintains identical JCS SHA-256 across reads and broadcasts live updates over WebSocket', async () => {
    // 1. Verify zero-drift on snapshot
    const snap1 = await httpRequest({ port: serverPort, path: '/api/snapshot' });
    const snap2 = await httpRequest({ port: serverPort, path: '/api/snapshot' });
    expect(snap1.json.snapshot.snapshot_jcs_sha256).toBe(snap2.json.snapshot.snapshot_jcs_sha256);
    expect(snap1.json.snapshot.snapshot_jcs_sha256).toMatch(/^[a-f0-9]{64}$/);

    // 2. Verify WebSocket connection and broadcast
    const wsUrl = `ws://127.0.0.1:${serverPort}/ws`;
    const ws = new WebSocket(wsUrl);
    const messages: any[] = [];

    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString('utf8')));
      } catch {
        // ignore non-json
      }
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    // Wait for initial snapshot broadcast
    await new Promise((r) => setTimeout(r, 100));
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].type).toBe('TERMINAL_SNAPSHOT_BROADCAST');
    expect(messages[0].event).toBe('SNAPSHOT_INITIAL');

    // Trigger screening to produce SNAPSHOT_UPDATED
    await httpRequest({
      port: serverPort,
      path: '/api/discovery/screen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fixture_id: 'FIX-SAAS-DEVTOOL-001'
      })
    });

    // Wait for WebSocket update message
    await new Promise((r) => setTimeout(r, 150));
    const updateMsg = messages.find(
      (m) => m.event === 'SNAPSHOT_UPDATED' && m.details?.action === 'DISCOVERY_CANDIDATE_SCREENED'
    );
    expect(updateMsg).toBeDefined();
    expect(updateMsg.snapshot.snapshot_jcs_sha256).toMatch(/^[a-f0-9]{64}$/);

    ws.close();
  });

  // ==========================================================================
  // S58-009: Economics Audit — Gross Spread Does Not Alone Establish Net Margin
  // ==========================================================================
  it('S58-009: verifies gross spread (₹63 / 7412 bps) does not establish net contribution when domain costs are missing', async () => {
    // 1. Screen SS304 Amazon fixture (ASP: ₹85.00)
    const screenRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/screen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-AMZ-SS304-001' })
    });
    expect(screenRes.statusCode).toBe(200);
    const ss304CandId = screenRes.json.candidate.candidate_id;

    // 2. Claim investigation task and submit ONLY factory quote (₹22.00) without other costs
    const claimRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'claim',
        worker_id: 'worker-ss304-audit',
        candidate_id: ss304CandId
      })
    });
    expect(claimRes.statusCode).toBe(200);
    const task = claimRes.json.task;

    const commitRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: task.task_id,
        candidate_id: ss304CandId,
        generation_id: task.generation_id,
        lease_owner_id: 'worker-ss304-audit',
        fencing_token: task.fencing_token,
        result_payload: {
          factory_gate_quote_inr: 22.0,
          has_logistics_route: true,
          has_regulatory_clearance: true
        },
        evidence_origin: {
          source_connector_id: 'conn:b2b:indiamart',
          origin_class: 'RECORDED_GOLDEN_FIXTURE',
          observed_at_utc: '2026-10-24T10:15:00.000Z',
          verification_status: 'VERIFIED'
        },
        extracted_fields: {
          factory_gate_quote_inr: 22.0,
          has_logistics_route: true,
          has_regulatory_clearance: true
        }
      })
    });
    expect(commitRes.statusCode).toBe(200);

    // 3. Underwrite candidate: Gross spread is computed, but Net contribution remains NULL
    const underwriteRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${ss304CandId}/underwrite`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(underwriteRes.statusCode).toBe(200);
    const dec = underwriteRes.json;

    // Fails closed due to missing non-supplier costs
    expect(dec.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(dec.evaluation_status).toBe('UNEVALUABLE_INPUTS_MISSING');

    // Gross spread is mathematically 85.00 - 22.00 = 63.00 (7412 bps)
    expect(dec.unit_economics.prevailing_retail_asp_inr).toBe(85.0);
    expect(dec.unit_economics.factory_gate_quote_inr).toBe(22.0);
    expect(dec.unit_economics.gross_spread_inr).toBe(63.0);
    expect(dec.unit_economics.estimated_margin_bps).toBe(7412);

    // Net contribution and contribution margin MUST remain null (unsupported by complete economics)
    expect(dec.unit_economics.net_contribution_inr).toBeNull();
    expect(dec.unit_economics.contribution_margin_bps).toBeNull();

    // All domain non-supplier cost categories assessed as UNKNOWN_MISSING
    expect(dec.unit_economics.missing_cost_inputs).toEqual([
      'INBOUND_FREIGHT',
      'PACKAGING_KITTING',
      'MARKETPLACE_FEES',
      'STATUTORY_TAX',
      'RETURN_DEFECT_DRAG'
    ]);

    // Snapshot projection confirms Net Return is 0.00% and Gate is [BLOCKED]
    const snapRes = await httpRequest({ port: serverPort, path: '/api/snapshot' });
    const allocRow = snapRes.json.snapshot.workspaces.capital_allocator.opportunities.find(
      (o: any) => o.candidate_id === ss304CandId
    );
    expect(allocRow).toBeDefined();
    expect(allocRow.expected_return_bps.value).toBe(7412);
    expect(allocRow.return_after_costs_and_taxes_bps.value).toBe(0);
    expect(allocRow.gate_badge.icon_symbol).toBe('[BLOCKED]');
    expect(allocRow.allocated_capital_inr.value).toBe('0.00');
  });
});
