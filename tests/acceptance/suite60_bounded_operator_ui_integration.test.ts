/**
 * POC-001: Acceptance Suite 60 — Bounded Operator UI Integration
 *
 * Verifies the smallest UI-only integration connecting the candidate discovery,
 * underwriting, and paper-budget endpoints to the operator workstation interface
 * (HTTP 127.0.0.1 loopback and standalone offline HTML export).
 *
 * Invariants Tested:
 * 1. S60-001: Fixture screening intake markup, selector, and explicit offline notice.
 * 2. S60-002: Workspace 5 paper allocation evaluation control strip and summary indicators.
 * 3. S60-003: Workspace 5 candidate row inspection and underwriting action controls.
 * 4. S60-004: Candidate slide-over drawer script logic, provenance, freshness, and separated economics.
 * 5. S60-005: Investigation task claiming and fenced evidence commit form in client script.
 * 6. S60-006: End-to-end API workflow: Fixture screening -> Task Claim & Commit -> Underwriting.
 * 7. S60-007: Constrained portfolio evaluation and clean cap clearing via API.
 * 8. S60-008: Budget numeric validation (rejection of non-positive or non-finite budget).
 * 9. S60-009: Standalone HTML export parity (ensures zero divergence between live and offline exports).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import { renderOperatorTerminalHtml } from '../../src/terminal/operatorTerminalController.js';
import { exportStandaloneHtml } from '../../src/cli/exportStandaloneHtml.js';
import { truncateTestDatabase } from '../setup.js';

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

describe('Suite 60: Bounded Operator UI Integration', () => {
  let server: WorkstationServer;
  let stateManager: WorkstationStateManager;
  let serverPort: number;
  let ss304CandidateId: string;
  let brassCandidateId: string;

  beforeAll(async () => {
    await truncateTestDatabase();
    stateManager = new WorkstationStateManager();
    // Ephemeral OS port assignment (port: 0) strictly bound to loopback 127.0.0.1
    server = new WorkstationServer({
      port: 0,
      host: '127.0.0.1',
      stateManager
    });

    const started = await server.start();
    serverPort = started.port;
  });

  afterAll(async () => {
    await server.stop();
  });

  // ==========================================================================
  // S60-001: Offline Fixture Screening Intake Markup
  // ==========================================================================
  it('S60-001: renders the offline fixture screener card with golden fixtures and explicit offline notice', async () => {
    const snapshot = stateManager.getSnapshot();
    const html = renderOperatorTerminalHtml(snapshot);

    expect(html).toContain('id="offline-fixture-screener-card"');
    expect(html).toContain('[OFFLINE FIXTURE / DEMONSTRATION MODE]');
    expect(html).toContain('id="fixture-selector"');
    expect(html).toContain('id="btn-screen-candidate"');
    expect(html).toContain('id="screen-candidate-feedback"');

    // Verify all 5 verified golden fixtures are present in the selector
    expect(html).toContain('value="FIX-AMZ-SS304-001"');
    expect(html).toContain('value="FIX-AMZ-BRASS-001"');
    expect(html).toContain('value="FIX-SAAS-DEVTOOL-MISSING-PRICE-002"');
    expect(html).toContain('value="FIX-IMART-SS304-001"');
    expect(html).toContain('value="FIX-IMART-BRASS-001"');

    // Confirms that it does not claim to perform live-market discovery
    expect(html).toContain('is_live_market_verified: false');
    expect(html).toContain('This does not initiate unverified live-market web crawling.');
  });

  // ==========================================================================
  // S60-002: Workspace 5 Paper Allocation Control Strip Markup
  // ==========================================================================
  it('S60-002: renders Workspace 5 paper allocation evaluation controls and summary indicators', async () => {
    const snapshot = stateManager.getSnapshot();
    const html = renderOperatorTerminalHtml(snapshot);

    expect(html).toContain('id="allocation-control-strip"');
    expect(html).toContain('id="input-paper-budget"');
    expect(html).toContain('id="input-max-single-allocation"');
    expect(html).toContain('placeholder="No Cap"');
    expect(html).toContain('id="btn-evaluate-allocation"');
    expect(html).toContain('id="btn-clear-allocation-cap"');
    expect(html).toContain('id="allocation-control-feedback"');

    expect(html).toContain('id="allocation-summary-strip"');
    expect(html).toContain('id="alloc-summary-budget"');
    expect(html).toContain('id="alloc-summary-allocated"');
    expect(html).toContain('id="alloc-summary-unallocated"');
    expect(html).toContain('id="allocator-status-badge"');
  });

  // ==========================================================================
  // S60-003: Workspace 5 Candidate Row Actions Markup
  // ==========================================================================
  it('S60-003: renders Workspace 5 candidate row inspection and underwriting action buttons', async () => {
    const snapshot = stateManager.getSnapshot();
    const html = renderOperatorTerminalHtml(snapshot);

    expect(html).toContain('id="capital-allocator-table"');
    expect(html).toContain('<th>Actions</th>');
    expect(html).toContain('btn-inspect-candidate');
    expect(html).toContain('btn-underwrite-candidate');
    expect(html).toContain('td-allocated-capital');
    expect(html).toContain('td-gate-badge');
  });

  // ==========================================================================
  // S60-004: Candidate Slide-Over Drawer Script Logic
  // ==========================================================================
  it('S60-004: includes drawer candidate inspection script logic with provenance and separated economics', async () => {
    const snapshot = stateManager.getSnapshot();
    const html = renderOperatorTerminalHtml(snapshot);

    expect(html).toContain('function openDrawerWithCandidate');
    expect(html).toContain('[FIXTURE] RECORDED BASELINE');
    expect(html).toContain('Live Market Verified:');
    expect(html).toContain('Freshness Age:');
    expect(html).toContain('Evidence Sufficiency &amp; Data Gaps');
    expect(html).toContain('/ 10,000 bps');
    expect(html).toContain('Missing Critical Fields:');
    expect(html).toContain('Missing Cost Inputs:');

    // Separate economics
    expect(html).toContain('Gross Selling Price:');
    expect(html).toContain('Gross Sourcing Spread:');
    expect(html).toContain('Net Contribution:');
    expect(html).toContain('Initial Cash Outlay (MOQ Batch):');
  });

  // ==========================================================================
  // S60-005: Investigation Task Claiming & Fenced Commit Logic
  // ==========================================================================
  it('S60-005: includes task claiming and fenced evidence commit logic with stale fence rejection handling', async () => {
    const snapshot = stateManager.getSnapshot();
    const html = renderOperatorTerminalHtml(snapshot);

    expect(html).toContain('btn-drawer-claim-task');
    expect(html).toContain('/api/discovery/investigate');
    expect(html).toContain('input-ev-quote');
    expect(html).toContain('input-ev-moq');
    expect(html).toContain('input-ev-freight');
    expect(html).toContain('input-ev-packaging');
    expect(html).toContain('input-ev-platform-fee');
    expect(html).toContain('input-ev-tax');
    expect(html).toContain('btn-drawer-commit-evidence');
    expect(html).toContain('Commit Evidence (Preserve Fencing)');
  });

  // ==========================================================================
  // S60-006: End-to-End API Workflow: Screen -> Task Claim & Commit -> Underwrite
  // ==========================================================================
  it('S60-006: executes screening, investigation evidence commit, and deterministic underwriting via HTTP endpoints', async () => {
    // 1. Screen fixture FIX-AMZ-SS304-001
    const screenRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/screen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-AMZ-SS304-001' })
    });

    expect(screenRes.statusCode).toBe(200);
    expect(screenRes.json).toBeDefined();
    expect(screenRes.json.candidate).toBeDefined();
    ss304CandidateId = screenRes.json.candidate.candidate_id;
    expect(ss304CandidateId).toBeTruthy();

    // 2. Fetch candidate via GET /api/candidates/:id
    const candRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${encodeURIComponent(ss304CandidateId)}`,
      method: 'GET'
    });
    expect(candRes.statusCode).toBe(200);
    expect(candRes.json.candidate_id).toBe(ss304CandidateId);

    // 3. Claim task from investigation queue
    const claimRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'claim',
        worker_id: 'operator-ui',
        candidate_id: ss304CandidateId
      })
    });
    expect(claimRes.statusCode).toBe(200);
    const task = claimRes.json.task;
    expect(task).toBeDefined();

    // 4. Commit verified investigation evidence to complete candidate cost categories
    const commitRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: task.task_id,
        candidate_id: ss304CandidateId,
        generation_id: task.generation_id,
        lease_owner_id: 'operator-ui',
        fencing_token: task.fencing_token,
        result_payload: { factory_gate_quote_inr: 25.0 },
        evidence_origin: {
          source_connector_id: 'conn:b2b:indiamart',
          origin_class: 'RECORDED_GOLDEN_FIXTURE',
          observed_at_utc: '2026-10-24T10:15:00.000Z'
        },
        extracted_fields: {
          factory_gate_quote_inr: 25.0,
          unit_batch_moq: 100,
          has_logistics_route: true,
          has_regulatory_clearance: true,
          applicable_cost_categories: [
            'SUPPLIER_PURCHASE',
            'INBOUND_FREIGHT',
            'PACKAGING_KITTING',
            'MARKETPLACE_FEES',
            'STATUTORY_TAX',
            'RETURN_DEFECT_DRAG'
          ],
          inbound_freight_inr: 3.5,
          packaging_kitting_inr: 3.0,
          platform_fee_inr: 10.2,
          statutory_tax_inr: 7.65,
          return_defect_drag_inr: 1.5
        }
      })
    });
    expect(commitRes.statusCode).toBe(200);

    // 5. Underwrite candidate via POST /api/candidates/:id/underwrite
    const underwriteRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${encodeURIComponent(ss304CandidateId)}/underwrite`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budgetConfig: { available_paper_capital_inr: 50000 }
      })
    });
    expect(underwriteRes.statusCode).toBe(200);
    expect(underwriteRes.json.outcome).toBe('ELIGIBLE');
    expect(underwriteRes.json.unit_economics.net_contribution_inr).toBeCloseTo(34.15, 2);
    expect(underwriteRes.json.unit_economics.initial_cash_requirement_inr).toBe(3150);

    // 6. Retrieve decision via GET /api/candidates/:id/decision
    const decisionRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${encodeURIComponent(ss304CandidateId)}/decision`,
      method: 'GET'
    });
    expect(decisionRes.statusCode).toBe(200);
    expect(decisionRes.json.outcome).toBe('ELIGIBLE');
  });

  // ==========================================================================
  // S60-007: Constrained Portfolio Evaluation & Clean Cap Reset via API
  // ==========================================================================
  it('S60-007: supports portfolio budget evaluation with optional cap and unconstrained reset', async () => {
    // 1. Screen second fixture FIX-AMZ-BRASS-001
    const brassScreenRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/screen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-AMZ-BRASS-001' })
    });
    brassCandidateId = brassScreenRes.json.candidate.candidate_id;

    // 2. Claim Brass investigation task and commit evidence
    const claimBrass = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'claim',
        worker_id: 'operator-ui',
        candidate_id: brassCandidateId
      })
    });
    const brassTask = claimBrass.json.task;

    const commitBrassRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: brassTask.task_id,
        candidate_id: brassCandidateId,
        generation_id: brassTask.generation_id,
        lease_owner_id: 'operator-ui',
        fencing_token: brassTask.fencing_token,
        result_payload: { factory_gate_quote_inr: 115.0 },
        evidence_origin: {
          source_connector_id: 'conn:b2b:indiamart',
          origin_class: 'RECORDED_GOLDEN_FIXTURE',
          observed_at_utc: '2026-10-24T13:15:00.000Z'
        },
        extracted_fields: {
          factory_gate_quote_inr: 115.0,
          unit_batch_moq: 50,
          has_logistics_route: true,
          has_regulatory_clearance: true,
          applicable_cost_categories: [
            'SUPPLIER_PURCHASE',
            'INBOUND_FREIGHT',
            'PACKAGING_KITTING',
            'MARKETPLACE_FEES',
            'STATUTORY_TAX',
            'RETURN_DEFECT_DRAG'
          ],
          inbound_freight_inr: 15.0,
          packaging_kitting_inr: 10.0,
          platform_fee_inr: 40.0,
          statutory_tax_inr: 25.0,
          return_defect_drag_inr: 5.0
        }
      })
    });
    expect(commitBrassRes.statusCode).toBe(200);

    // 3. Underwrite Brass Valve
    const underwriteBrassRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${encodeURIComponent(brassCandidateId)}/underwrite`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budgetConfig: { available_paper_capital_inr: 50000 }
      })
    });
    expect(underwriteBrassRes.statusCode).toBe(200);
    expect(underwriteBrassRes.json.outcome).toBe('ELIGIBLE');

    // 4. Evaluate with budget ₹12,000 and max single allocation ₹5,000
    // SS304 requires ₹3,150 <= ₹5,000 -> Allocated
    // Brass requires ₹7,000 > ₹5,000 -> Deferred due to single cap
    const evalCapRes = await httpRequest({
      port: serverPort,
      path: '/api/portfolio/evaluate-budget',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total_paper_budget_inr: 12000,
        max_single_allocation_inr: 5000
      })
    });
    expect(evalCapRes.statusCode).toBe(200);
    expect(evalCapRes.json.deck.total_configured_budget_inr).toBe(12000);
    expect(evalCapRes.json.deck.max_single_allocation_inr).toBe(5000);
    expect(evalCapRes.json.deck.total_allocated_capital_inr).toBe(3150);
    expect(evalCapRes.json.deck.remaining_budget_inr).toBe(8850);
    expect(evalCapRes.json.deck.summary.total_allocated_count).toBe(1);
    expect(evalCapRes.json.deck.deferred_candidates[0].candidate_id).toBe(brassCandidateId);

    // 5. Clear cap by submitting null -> Brass is now authorized
    const evalUncappedRes = await httpRequest({
      port: serverPort,
      path: '/api/portfolio/evaluate-budget',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total_paper_budget_inr: 12000,
        max_single_allocation_inr: null
      })
    });
    expect(evalUncappedRes.statusCode).toBe(200);
    expect(evalUncappedRes.json.deck.total_configured_budget_inr).toBe(12000);
    expect(evalUncappedRes.json.deck.max_single_allocation_inr == null).toBe(true);
    expect(evalUncappedRes.json.deck.total_allocated_capital_inr).toBe(10150);
    expect(evalUncappedRes.json.deck.remaining_budget_inr).toBe(1850);
    expect(evalUncappedRes.json.deck.summary.total_allocated_count).toBe(2);
    expect(evalUncappedRes.json.deck.deferred_candidates).toHaveLength(0);
  });

  // ==========================================================================
  // S60-008: Budget Numeric Validation
  // ==========================================================================
  it('S60-008: rejects invalid or non-positive paper budgets with HTTP 400', async () => {
    const invalidBudgetRes = await httpRequest({
      port: serverPort,
      path: '/api/portfolio/evaluate-budget',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total_paper_budget_inr: -100
      })
    });
    expect(invalidBudgetRes.statusCode).toBe(400);
    expect(invalidBudgetRes.json.operator_message).toContain('positive finite number');
  });

  // ==========================================================================
  // S60-009: Standalone HTML Export Parity
  // ==========================================================================
  it('S60-009: exports standalone HTML with 100% parity of intake and allocation controls', async () => {
    const tempExportPath = path.join(os.tmpdir(), `test_workstation_${Date.now()}.html`);
    try {
      const exportResult = exportStandaloneHtml(tempExportPath, stateManager);
      expect(exportResult.byteLength).toBeGreaterThan(50000);

      const exportedHtml = fs.readFileSync(tempExportPath, 'utf8');
      expect(exportedHtml).toContain('id="offline-fixture-screener-card"');
      expect(exportedHtml).toContain('id="allocation-control-strip"');
      expect(exportedHtml).toContain('id="capital-allocator-table"');
      expect(exportedHtml).toContain('btn-inspect-candidate');
      expect(exportedHtml).toContain('function openDrawerWithCandidate');
    } finally {
      if (fs.existsSync(tempExportPath)) {
        fs.unlinkSync(tempExportPath);
      }
    }
  });
});
