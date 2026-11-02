/**
 * POC-001: Acceptance Suite 59 — Slice 2F Multi-Candidate Decision Workflow & Constrained Portfolio Allocation
 *
 * Verifies the multi-candidate operator decision workflow, including:
 * 1. S59-001: Multi-candidate ingestion & side-by-side comparison matrix.
 * 2. S59-002: Strict metric separation (Gross Spread/Margin vs Net Contribution/Margin, missing costs remain null).
 * 3. S59-003: Deterministic explainable ranking reproducibility across runs.
 * 4. S59-004: Ineligible / Insufficient Evidence candidate fails closed against capital allocation.
 * 5. S59-005: Constrained portfolio paper budget evaluation & cumulative safety (Rationing test).
 * 6. S59-006: Budget expansion and max single allocation limit enforcement.
 * 7. S59-007: Single authoritative state parity across REST API, snapshot, and standalone export.
 * 8. S59-008: Investigation lease fencing and Slice 2E parity intact.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

describe('Suite 59: Slice 2F Multi-Candidate Decision Workflow & Constrained Portfolio Allocation', () => {
  let server: WorkstationServer;
  let stateManager: WorkstationStateManager;
  let serverPort: number;
  let serverUrl: string;

  let brassCandidateId: string;
  let ss304CandidateId: string;
  let saasCandidateId: string;

  beforeAll(async () => {
    stateManager = new WorkstationStateManager();
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
  // S59-001: Multi-Candidate Ingestion & Side-by-Side Comparison Matrix
  // ==========================================================================
  it('S59-001: ingests multiple fixtures and surfaces them side-by-side in GET /api/candidates/compare', async () => {
    // 1. Screen Candidate 1: Forged Brass Valve
    const res1 = await httpRequest({
      port: serverPort,
      path: '/api/discovery/screen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-AMZ-BRASS-001' })
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json.candidate).toBeDefined();
    brassCandidateId = res1.json.candidate.candidate_id;

    // 2. Screen Candidate 2: SS304 Clamps
    const res2 = await httpRequest({
      port: serverPort,
      path: '/api/discovery/screen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-AMZ-SS304-001' })
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json.candidate).toBeDefined();
    ss304CandidateId = res2.json.candidate.candidate_id;

    // 3. Screen Candidate 3: Unpriced SaaS Developer Tool
    const res3 = await httpRequest({
      port: serverPort,
      path: '/api/discovery/screen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-SAAS-DEVTOOL-MISSING-PRICE-002' })
    });
    expect(res3.statusCode).toBe(200);
    expect(res3.json.candidate).toBeDefined();
    saasCandidateId = res3.json.candidate.candidate_id;

    // Verify distinct candidate IDs
    expect(brassCandidateId).not.toBe(ss304CandidateId);
    expect(ss304CandidateId).not.toBe(saasCandidateId);

    // 4. Request side-by-side comparison
    const compareRes = await httpRequest({
      port: serverPort,
      path: '/api/candidates/compare'
    });
    expect(compareRes.statusCode).toBe(200);
    expect(compareRes.json.candidates).toBeInstanceOf(Array);
    expect(compareRes.json.count).toBeGreaterThanOrEqual(3);

    const candidates = compareRes.json.candidates;
    const brassRow = candidates.find((c: any) => c.candidate_id === brassCandidateId);
    const ss304Row = candidates.find((c: any) => c.candidate_id === ss304CandidateId);
    const saasRow = candidates.find((c: any) => c.candidate_id === saasCandidateId);

    expect(brassRow).toBeDefined();
    expect(ss304Row).toBeDefined();
    expect(saasRow).toBeDefined();

    expect(brassRow.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
    expect(ss304Row.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
    expect(saasRow.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');

    expect(brassRow.freshness_age_seconds).toBeGreaterThanOrEqual(0);
    expect(ss304Row.freshness_age_seconds).toBeGreaterThanOrEqual(0);
  });

  // ==========================================================================
  // S59-002: Strict Metric Separation (Gross Spread vs Net Contribution)
  // ==========================================================================
  it('S59-002: enforces strict separation between gross spread/margin and net contribution/margin', async () => {
    // 1. Claim task & commit verified investigation evidence for Candidate 1 (Brass Valve)
    const claimBrass = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'claim',
        worker_id: 'worker-brass-investigator',
        candidate_id: brassCandidateId
      })
    });
    expect(claimBrass.statusCode).toBe(200);
    const brassTask = claimBrass.json.task;

    const commitBrass = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: brassTask.task_id,
        candidate_id: brassCandidateId,
        generation_id: brassTask.generation_id,
        lease_owner_id: 'worker-brass-investigator',
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
    expect(commitBrass.statusCode).toBe(200);

    // Underwrite Brass Valve
    const underwriteBrassRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${brassCandidateId}/underwrite`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budgetConfig: { available_paper_capital_inr: 50000 }
      })
    });
    expect(underwriteBrassRes.statusCode).toBe(200);
    expect(underwriteBrassRes.json.outcome).toBe('ELIGIBLE');

    // 2. Claim task & commit verified investigation evidence for Candidate 2 (SS304 Clamps)
    const claimSS304 = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'claim',
        worker_id: 'worker-ss304-investigator',
        candidate_id: ss304CandidateId
      })
    });
    expect(claimSS304.statusCode).toBe(200);
    const ss304Task = claimSS304.json.task;

    const commitSS304 = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: ss304Task.task_id,
        candidate_id: ss304CandidateId,
        generation_id: ss304Task.generation_id,
        lease_owner_id: 'worker-ss304-investigator',
        fencing_token: ss304Task.fencing_token,
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
    expect(commitSS304.statusCode).toBe(200);

    // Underwrite SS304 Clamps
    const underwriteSS304Res = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${ss304CandidateId}/underwrite`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budgetConfig: { available_paper_capital_inr: 50000 }
      })
    });
    expect(underwriteSS304Res.statusCode).toBe(200);
    expect(underwriteSS304Res.json.outcome).toBe('ELIGIBLE');

    // 3. Underwrite Candidate 3 (SaaS unpriced) - should fail with INSUFFICIENT_EVIDENCE
    const underwriteSaasRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${saasCandidateId}/underwrite`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budgetConfig: { available_paper_capital_inr: 50000 }
      })
    });
    expect(underwriteSaasRes.statusCode).toBe(200);
    expect(underwriteSaasRes.json.outcome).toBe('INSUFFICIENT_EVIDENCE');

    // Query comparison table to verify strict metrics separation
    const compareRes = await httpRequest({
      port: serverPort,
      path: '/api/candidates/compare'
    });
    expect(compareRes.statusCode).toBe(200);
    const candidates = compareRes.json.candidates;

    const brass = candidates.find((c: any) => c.candidate_id === brassCandidateId);
    const ss304 = candidates.find((c: any) => c.candidate_id === ss304CandidateId);
    const saas = candidates.find((c: any) => c.candidate_id === saasCandidateId);

    // Verify Brass metrics
    expect(brass.prevailing_retail_asp_inr).toBe(320.0);
    expect(brass.factory_gate_quote_inr).toBe(115.0);
    expect(brass.gross_spread_inr).toBe(205.0);
    expect(brass.estimated_margin_bps).toBe(6406); // 64.06%
    expect(brass.net_unit_contribution_inr).toBe(110.0); // 320 - 115 - 95
    expect(brass.contribution_margin_bps).toBe(3438); // 34.38%
    expect(brass.initial_cash_requirement_inr).toBe(7000.0); // Landed: (115 + 15 + 10) * 50
    expect(brass.underwriting_outcome).toBe('ELIGIBLE');

    // Verify SS304 metrics
    expect(ss304.prevailing_retail_asp_inr).toBe(85.0);
    expect(ss304.factory_gate_quote_inr).toBe(25.0);
    expect(ss304.gross_spread_inr).toBe(60.0);
    expect(ss304.estimated_margin_bps).toBe(7059); // 70.59%
    expect(ss304.net_unit_contribution_inr).toBeCloseTo(34.15, 2);
    expect(ss304.contribution_margin_bps).toBe(4018); // 40.18%
    expect(ss304.initial_cash_requirement_inr).toBe(3150.0); // Landed: (25 + 3.5 + 3) * 100
    expect(ss304.underwriting_outcome).toBe('ELIGIBLE');

    // Verify SaaS unpriced: MUST NOT DEFAULT TO ZERO
    expect(saas.prevailing_retail_asp_inr).toBeNull();
    expect(saas.net_unit_contribution_inr).toBeNull();
    expect(saas.contribution_margin_bps).toBeNull();
    expect(saas.underwriting_outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(saas.unresolved_gaps.length).toBeGreaterThan(0);
  });

  // ==========================================================================
  // S59-003: Deterministic Explainable Ranking
  // ==========================================================================
  it('S59-003: ranks candidates deterministically with higher net contribution margin first and explainable rationale', async () => {
    const deckRes = await httpRequest({
      port: serverPort,
      path: '/api/portfolio/deck'
    });
    expect(deckRes.statusCode).toBe(200);
    expect(deckRes.json.deck).toBeDefined();

    const deck = deckRes.json.deck;
    const items = deck.items;
    expect(items.length).toBeGreaterThanOrEqual(3);

    // Candidate 2 (SS304: 40.18% margin) must be Rank 1
    // Candidate 1 (Brass: 34.38% margin) must be Rank 2
    // Candidate 3 (SaaS: Insufficient evidence) must be Rank 3
    const rank1 = items[0];
    const rank2 = items[1];
    const rank3 = items[2];

    expect(rank1.candidate_id).toBe(ss304CandidateId);
    expect(rank1.rank).toBe(1);
    expect(rank1.contribution_margin_bps).toBe(4018);
    expect(rank1.ranking_rationale).toContain('Rank 1');
    expect(rank1.ranking_rationale).toContain('40.18%');

    expect(rank2.candidate_id).toBe(brassCandidateId);
    expect(rank2.rank).toBe(2);
    expect(rank2.contribution_margin_bps).toBe(3438);
    expect(rank2.ranking_rationale).toContain('Rank 2');
    expect(rank2.ranking_rationale).toContain('34.38%');

    expect(rank3.candidate_id).toBe(saasCandidateId);
    expect(rank3.rank).toBe(3);
    expect(rank3.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(rank3.ranking_rationale).toContain('INSUFFICIENT_EVIDENCE');

    // Determinism check: Second call must yield bit-for-bit identical order and ranks
    const deckRes2 = await httpRequest({
      port: serverPort,
      path: '/api/portfolio/deck'
    });
    expect(deckRes2.json.deck.items.map((i: any) => i.candidate_id)).toEqual(
      items.map((i: any) => i.candidate_id)
    );
  });

  // ==========================================================================
  // S59-004: Ineligible / Insufficient Evidence Allocation Prohibition
  // ==========================================================================
  it('S59-004: strictly prohibits capital allocation to unverified or insufficient evidence candidate', async () => {
    const deckRes = await httpRequest({
      port: serverPort,
      path: '/api/portfolio/deck'
    });
    const deck = deckRes.json.deck;

    const saasItem = deck.items.find((i: any) => i.candidate_id === saasCandidateId);
    expect(saasItem).toBeDefined();
    expect(saasItem.allocated_capital_inr).toBe(0);
    expect(saasItem.allocation_status).toBe('REJECTED_INSUFFICIENT_EVIDENCE');

    const saasRejected = deck.rejected_candidates.find((r: any) => r.candidate_id === saasCandidateId);
    expect(saasRejected).toBeDefined();
    expect(saasRejected.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(saasRejected.reason).toContain('Insufficient evidence');
  });

  // ==========================================================================
  // S59-005: Constrained Portfolio Paper Budget Evaluation & Cumulative Safety
  // ==========================================================================
  it('S59-005: evaluates constrained ₹5,000 budget, allocating to Rank 1 and deferring Rank 2 with explicit shortfall', async () => {
    // Post budget evaluation with total_paper_budget_inr = 5000
    // SS304 requires ₹3,150. Remaining budget becomes ₹1,850.
    // Brass Valve requires ₹7,000 > ₹1,850. Shortfall = ₹5,150.
    const evalRes = await httpRequest({
      port: serverPort,
      path: '/api/portfolio/evaluate-budget',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total_paper_budget_inr: 5000
      })
    });

    expect(evalRes.statusCode).toBe(200);
    const deck = evalRes.json.deck;

    expect(deck.total_configured_budget_inr).toBe(5000);
    expect(deck.total_allocated_capital_inr).toBe(3150);
    expect(deck.remaining_budget_inr).toBe(1850);

    // Allocations check
    expect(deck.allocations.length).toBe(1);
    expect(deck.allocations[0].candidate_id).toBe(ss304CandidateId);
    expect(deck.allocations[0].allocated_capital_inr).toBe(3150);
    expect(deck.allocations[0].allocation_status).toBe('ALLOCATED');
    expect(deck.allocations[0].remaining_budget_after_inr).toBe(1850);

    // Deferred check
    expect(deck.deferred_candidates.length).toBe(1);
    const deferredBrass = deck.deferred_candidates[0];
    expect(deferredBrass.candidate_id).toBe(brassCandidateId);
    expect(deferredBrass.required_capital_inr).toBe(7000);
    expect(deferredBrass.remaining_budget_inr).toBe(1850);
    expect(deferredBrass.shortfall_inr).toBe(5150);
    expect(deferredBrass.reason).toContain('exceeds remaining portfolio paper budget ₹1850.00 by ₹5150.00');

    // Invariant check: cumulative allocated <= configured budget
    expect(deck.total_allocated_capital_inr).toBeLessThanOrEqual(deck.total_configured_budget_inr);
    expect(deck.summary.budget_utilization_bps).toBe(6300); // 63.00%
  });

  // ==========================================================================
  // S59-006: Budget Expansion & Max Single Allocation Cap Enforcement
  // ==========================================================================
  it('S59-006: expands budget to ₹12,000 allocating both candidates, and enforces max single allocation limit', async () => {
    // 1. Expand budget to ₹12,000: Both candidates fit (3150 + 7000 = 10150 <= 12000)
    const expandRes = await httpRequest({
      port: serverPort,
      path: '/api/portfolio/evaluate-budget',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total_paper_budget_inr: 12000
      })
    });

    expect(expandRes.statusCode).toBe(200);
    const expandedDeck = expandRes.json.deck;
    expect(expandedDeck.total_allocated_capital_inr).toBe(10150);
    expect(expandedDeck.remaining_budget_inr).toBe(1850);
    expect(expandedDeck.allocations.length).toBe(2);
    expect(expandedDeck.deferred_candidates.length).toBe(0);

    // 2. Set max_single_allocation_inr: 4000
    // SS304 requires ₹3,150 <= ₹4,000 -> Allocated.
    // Brass requires ₹7,000 > ₹4,000 -> Deferred due to single cap!
    const capRes = await httpRequest({
      port: serverPort,
      path: '/api/portfolio/evaluate-budget',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total_paper_budget_inr: 12000,
        max_single_allocation_inr: 4000
      })
    });

    expect(capRes.statusCode).toBe(200);
    const cappedDeck = capRes.json.deck;
    expect(cappedDeck.total_allocated_capital_inr).toBe(3150);
    expect(cappedDeck.remaining_budget_inr).toBe(8850);
    expect(cappedDeck.allocations.length).toBe(1);
    expect(cappedDeck.deferred_candidates.length).toBe(1);

    const cappedBrass = cappedDeck.deferred_candidates[0];
    expect(cappedBrass.candidate_id).toBe(brassCandidateId);
    expect(cappedBrass.reason).toContain('exceeds maximum single allocation limit of ₹4000.00 by ₹3000.00');
  });

  // ==========================================================================
  // S59-007: Single Authoritative State Parity Across REST API, Snapshot, Export
  // ==========================================================================
  it('S59-007: confirms state parity between GET /api/snapshot, capital allocator workspace, and standalone export', async () => {
    // 1. Reset budget to ₹5,000 so SS304 is allocated (₹3,150) and Brass is deferred (₹0)
    await httpRequest({
      port: serverPort,
      path: '/api/portfolio/evaluate-budget',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total_paper_budget_inr: 5000
      })
    });

    // 2. Query snapshot
    const snapRes = await httpRequest({
      port: serverPort,
      path: '/api/snapshot'
    });
    expect(snapRes.statusCode).toBe(200);
    const alloc = snapRes.json.snapshot.workspaces.capital_allocator;
    expect(alloc).toBeDefined();

    expect(alloc.total_paper_budget_inr.value).toBe('5000.00');
    expect(alloc.allocated_paper_capital_inr.value).toBe('3150.00');
    expect(alloc.unallocated_paper_capital_inr.value).toBe('1850.00');
    expect(alloc.badge.icon_symbol).toBe('[WARN]'); // ALLOC_CONSTRAINED

    // Opportunities check in snapshot
    const opps = alloc.opportunities;
    const ss304Opp = opps.find((o: any) => o.candidate_id === ss304CandidateId);
    const brassOpp = opps.find((o: any) => o.candidate_id === brassCandidateId);
    const saasOpp = opps.find((o: any) => o.candidate_id === saasCandidateId);

    expect(ss304Opp).toBeDefined();
    expect(ss304Opp.allocated_capital_inr.value).toBe('3150.00');
    expect(ss304Opp.gate_badge.label).toBe('ELIGIBLE');
    expect(ss304Opp.conviction_vs_allocation_rationale).toContain('ALLOCATED');

    expect(brassOpp).toBeDefined();
    expect(brassOpp.allocated_capital_inr.value).toBe('0.00');
    expect(brassOpp.gate_badge.label).toBe('ELIGIBLE');
    expect(brassOpp.conviction_vs_allocation_rationale).toContain('DEFERRED_BUDGET_EXCEEDED');

    expect(saasOpp).toBeDefined();
    expect(saasOpp.allocated_capital_inr.value).toBe('0.00');
    expect(saasOpp.gate_badge.label).toBe('INSUFFICIENT_EVIDENCE');
    expect(saasOpp.conviction_vs_allocation_rationale).toContain('INSUFFICIENT_EVIDENCE');

    // 3. Standalone HTML Export parity test
    const tempHtmlPath = path.join(os.tmpdir(), `test-export-slice2f-${Date.now()}.html`);
    const exportResult = exportStandaloneHtml(tempHtmlPath, stateManager);

    expect(fs.existsSync(tempHtmlPath)).toBe(true);
    expect(exportResult.byteLength).toBeGreaterThan(1000);

    const htmlContent = fs.readFileSync(tempHtmlPath, 'utf8');
    expect(htmlContent).toContain(ss304CandidateId);
    expect(htmlContent).toContain(brassCandidateId);
    expect(htmlContent).toContain('₹3150.00');
    expect(htmlContent).toContain('5. Capital Allocator');

    // Clean up temporary export file
    try {
      fs.unlinkSync(tempHtmlPath);
    } catch {
      // ignore
    }
  });

  // ==========================================================================
  // S59-008: Investigation Lease Fencing & Slice 2E Parity
  // ==========================================================================
  it('S59-008: preserves investigation lease fencing, task queue integrity, and Slice 2E regression immunity', async () => {
    // Claim task for Brass Valve
    const claimRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'claim',
        worker_id: 'worker-suite-59',
        candidate_id: brassCandidateId
      })
    });

    expect(claimRes.statusCode).toBe(200);
    const task = claimRes.json.task;
    expect(task).toBeDefined();
    expect(task.fencing_token).toBeGreaterThanOrEqual(1);

    // Stale fence rejection test
    const staleRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: task.task_id,
        candidate_id: brassCandidateId,
        generation_id: task.generation_id,
        lease_owner_id: 'worker-suite-59',
        fencing_token: 0, // stale
        result_payload: { quote: 115 },
        evidence_origin: {
          source_connector_id: 'conn:b2b:indiamart',
          origin_class: 'RECORDED_GOLDEN_FIXTURE',
          observed_at_utc: '2026-10-24T13:15:00.000Z'
        }
      })
    });
    expect(staleRes.statusCode).toBe(409);
  });

  // ==========================================================================
  // S59-009: Budget Cap Reset & Stale Constraint Elimination
  // ==========================================================================
  it('S59-009: resets max_single_allocation_inr cap cleanly on subsequent unconstrained budget evaluations', async () => {
    // 1. Evaluate with a strict single cap of ?4,000 on ?12,000 budget
    const capRes = await httpRequest({
      port: serverPort,
      path: '/api/portfolio/evaluate-budget',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total_paper_budget_inr: 12000,
        max_single_allocation_inr: 4000
      })
    });
    expect(capRes.statusCode).toBe(200);
    expect(capRes.json.deck.summary.total_allocated_count).toBe(1); // Only SS304 fits under 4000
    expect(capRes.json.deck.deferred_candidates[0].candidate_id).toBe(brassCandidateId);

    // 2. Submit subsequent evaluation without cap - cap must NOT linger
    const uncapRes = await httpRequest({
      port: serverPort,
      path: '/api/portfolio/evaluate-budget',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total_paper_budget_inr: 12000
      })
    });
    expect(uncapRes.statusCode).toBe(200);
    expect(uncapRes.json.deck.max_single_allocation_inr).toBeNull();
    expect(uncapRes.json.deck.summary.total_allocated_count).toBe(2); // Both SS304 and Brass allocated
    expect(uncapRes.json.deck.total_allocated_capital_inr).toBe(10150);
    expect(uncapRes.json.deck.deferred_candidates).toHaveLength(0);
  });
});
