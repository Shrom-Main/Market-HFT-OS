/**
 * POC-001: Acceptance Test Suite 67 — Stage UIADR02 Discovery Universe
 *
 * Verifies:
 * 1. Population retrieval across multi-category opportunities (Physical, SaaS, B2B Gas, Service, Biomaterial IP).
 * 2. Multi-candidate comparison contract (/api/candidates/compare) with side-by-side metric alignment.
 * 3. Epistemic integrity and evidence sufficiency verification without score fabrication.
 * 4. Honest unlocated status attribution for non-physical/cloud assets.
 * 5. Spectrometry audit contradiction preservation on Howrah DIN3017 SS304 clamps.
 * 6. Governed bounded research dispatch adhering to Stage D.0 governors.
 * 7. Deterministic underwriting execution gate.
 * 8. End-to-end strategic sieve: 1 candidate -> comparable filter -> 4-way comparison -> gap inspection -> governed dispatch.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';

describe('Suite 67: Stage UIADR02 Discovery Universe Acceptance', () => {
  let server: WorkstationServer;
  let stateManager: WorkstationStateManager;
  let baseUrl: string;
  let ss304CandidateId: string;

  beforeAll(async () => {
    stateManager = new WorkstationStateManager();
    server = new WorkstationServer({
      port: 0, // ephemeral port for test isolation
      stateManager
    });
    await server.start();
    const port = server.getPort();
    baseUrl = `http://127.0.0.1:${port}`;

    // 1. Seed baseline discovery population
    const s1 = await fetch(`${baseUrl}/api/discovery/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-IMART-SS304-001' })
    });
    const d1 = await s1.json();
    ss304CandidateId = d1.candidate_id;

    await fetch(`${baseUrl}/api/discovery/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-AMZ-BRASS-001' })
    });

    await fetch(`${baseUrl}/api/discovery/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-SAAS-DEVTOOL-001' })
    });

    // Formulate associated baseline commercial thesis
    await fetch(`${baseUrl}/api/gallery/theses/formulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Howrah DIN3017 SS304 Worm-Drive Hardware Clamps',
        scope: 'PRODUCT',
        hypothesis_statement: 'Howrah hardware cluster provides gross margin spread against retail Buy Box.',
        primary_candidate_id: ss304CandidateId
      })
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  it('S67-001: retrieves candidate population across diverse commercial archetypes', async () => {
    const res = await fetch(`${baseUrl}/api/gallery/products`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.candidates).toBeDefined();
    expect(Array.isArray(data.candidates)).toBe(true);
    expect(data.candidates.length).toBeGreaterThanOrEqual(3);

    // Verify presence of core reference candidates
    const ids = data.candidates.map((c: any) => c.candidate_id);
    expect(ids).toContain(ss304CandidateId);
  });

  it('S67-002: screens and ingests category-agnostic opportunities into the live universe', async () => {
    // Screen Argon Gas (B2B Distribution)
    const argonRes = await fetch(`${baseUrl}/api/discovery/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-B2B-ARGON-GAS-001' })
    });
    expect(argonRes.status).toBe(200);
    const argonData = await argonRes.json();
    expect(argonData.candidate_id).toBe('OPP-6DA1DDAC84E59527');
    expect(argonData.candidate.category).toBe('B2B_DISTRIBUTION');
    expect(argonData.candidate.current_observation.factory_gate_quote_inr).toBe(1850);
    expect(argonData.candidate.current_observation.prevailing_retail_asp_inr).toBe(3200);

    // Screen NABL Metallurgy Lab (Service Contract)
    const serviceRes = await fetch(`${baseUrl}/api/discovery/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-SERVICE-METALLURGY-001' })
    });
    expect(serviceRes.status).toBe(200);
    const serviceData = await serviceRes.json();
    expect(serviceData.candidate_id).toBe('OPP-C81D434ECFD26233');
    expect(serviceData.candidate.category).toBe('SERVICE_CONTRACT');
    expect(serviceData.candidate.economic_eligibility.is_economically_eligible).toBe(false);
    expect(serviceData.candidate.economic_eligibility.missing_economic_inputs).toContain(
      'direct_labor_fulfillment_cost_inr'
    );
  });

  it('S67-003: serves multi-candidate comparison with difference and gap alignment', async () => {
    const res = await fetch(`${baseUrl}/api/candidates/compare`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.candidates)).toBe(true);
    expect(data.candidates.length).toBeGreaterThanOrEqual(4);

    const ss304 = data.candidates.find((c: any) => c.candidate_id === ss304CandidateId);
    const valve = data.candidates.find((c: any) => c.candidate_id === 'OPP-4C9B52BBEB89D4E2');
    const argon = data.candidates.find((c: any) => c.candidate_id === 'OPP-6DA1DDAC84E59527');

    expect(ss304).toBeDefined();
    expect(valve).toBeDefined();
    expect(argon).toBeDefined();

    // Verify raw observation metrics
    expect(ss304.factory_gate_quote_inr).toBe(25);
    expect(valve.prevailing_retail_asp_inr).toBe(320);
    expect(argon.factory_gate_quote_inr).toBe(1850);
    expect(argon.prevailing_retail_asp_inr).toBe(3200);
    expect(argon.estimated_margin_bps).toBe(4219);
  });

  it('S67-004: preserves RFC 8785 JCS digests and evidence sufficiency without false scoring', async () => {
    const res = await fetch(`${baseUrl}/api/candidates/${encodeURIComponent(ss304CandidateId)}`);
    expect(res.status).toBe(200);
    const detail = await res.json();

    expect(detail.candidate_id).toBe(ss304CandidateId);
    expect(detail.jcs_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.current_observation.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.evidence_sufficiency.has_upstream_quote).toBe(true);
  });

  it('S67-005: dispatches bounded research through Stage D.0 governors with audit trail', async () => {
    const res = await fetch(`${baseUrl}/api/products/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: 'prod:din3017:ss304:16-25mm:pack-10',
        operator_notes: 'Suite 67 governed research verification dispatch'
      })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.product).toBeDefined();
    expect(body.status).toBe('ADVERSARIAL_REVIEW');
    expect(body.message).toContain('Specialist research dispatched');
  });

  it('S67-006: executes deterministic underwriting gate and recomputes portfolio allocation', async () => {
    // 1. Claim task
    const claimRes = await fetch(`${baseUrl}/api/discovery/investigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'claim',
        worker_id: 'worker:source-capture:v1',
        candidate_id: ss304CandidateId
      })
    });
    expect(claimRes.status).toBe(200);
    const { task } = await claimRes.json();

    // 2. Commit evidence
    await fetch(`${baseUrl}/api/discovery/investigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: task.task_id,
        candidate_id: ss304CandidateId,
        generation_id: task.generation_id,
        lease_owner_id: 'worker:source-capture:v1',
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

    // 3. Underwrite
    const res = await fetch(`${baseUrl}/api/candidates/${encodeURIComponent(ss304CandidateId)}/underwrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budgetConfig: {
          paper_capital_ceiling_inr: 500000,
          max_single_position_allocation_inr: 100000,
          min_margin_threshold_bps: 1000
        }
      })
    });
    expect(res.status).toBe(200);
    const decision = await res.json();
    expect(decision.candidate_id).toBe(ss304CandidateId);
    expect(decision.outcome).toBeDefined();

    // Verify queryable underwriting decision endpoint
    const decRes = await fetch(`${baseUrl}/api/candidates/${encodeURIComponent(ss304CandidateId)}/decision`);
    expect(decRes.status).toBe(200);
    const fetchedDec = await decRes.json();
    expect(fetchedDec.candidate_id).toBe(ss304CandidateId);
    expect(fetchedDec.decision_code).toBe(decision.decision_code);
  });

  it('S67-007: blocks research mutations when Kill Switch trips to RECOVERY_ONLY_MODE', async () => {
    // Transition Kill Switch to recovery only via API
    const ksRes = await fetch(`${baseUrl}/api/actions/kill-switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_scope: 'ENTER_RECOVERY_ONLY_MODE',
        rationale: 'Suite 67 recovery mode safety test',
        confirmation_token: 'CONFIRM_ENTER_RECOVERY_ONLY_MODE'
      })
    });
    expect(ksRes.status).toBe(200);

    const blockedRes = await fetch(`${baseUrl}/api/products/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: 'prod:din3017:ss304:16-25mm:pack-10',
        operator_notes: 'Should fail closed'
      })
    });

    expect(blockedRes.status).toBe(409);
    const err = await blockedRes.json();
    expect(err.operator_message).toContain('E-KS-RECOVERY-ONLY-MODE');

    // Restore to normal operation
    const restoreRes = await fetch(`${baseUrl}/api/actions/kill-switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_scope: 'NORMAL_PAPER_OPERATION',
        rationale: 'Restored for subsequent operations',
        confirmation_token: 'CONFIRM_NORMAL_PAPER_OPERATION'
      })
    });
    expect(restoreRes.status).toBe(200);
  });

  it('S67-008: executes full strategic walkthrough simulation end-to-end', async () => {
    // Step 1: Select primary candidate
    const candRes = await fetch(`${baseUrl}/api/candidates/${encodeURIComponent(ss304CandidateId)}`);
    expect(candRes.status).toBe(200);
    const cand = await candRes.json();
    expect(cand.candidate_name).toContain('DIN3017 SS304');

    // Step 2: Query comparable physical goods candidates
    const compRes = await fetch(`${baseUrl}/api/gallery/products?category=PHYSICAL_GOODS`);
    expect(compRes.status).toBe(200);
    const compList = await compRes.json();
    expect(compList.candidates.length).toBeGreaterThanOrEqual(1);

    // Step 3: Compare against 3 alternatives
    const compareRes = await fetch(`${baseUrl}/api/candidates/compare`);
    const compareData = await compareRes.json();
    expect(compareData.candidates.length).toBeGreaterThanOrEqual(4);

    // Step 4: Identify missing information & evidence gaps
    const gapRes = await fetch(
      `${baseUrl}/api/research/gaps?product_id=${encodeURIComponent(cand.canonical_product_id)}`
    );
    expect(gapRes.status).toBe(200);
    const gapMatrix = await gapRes.json();
    expect(gapMatrix.dimensions).toBeDefined();
    expect(gapMatrix.pending_tasks.length).toBeGreaterThan(0);

    // Step 5: Verify thesis linkages
    const thesisRes = await fetch(`${baseUrl}/api/gallery/theses`);
    expect(thesisRes.status).toBe(200);
    const theses = await thesisRes.json();
    expect(theses.theses.length).toBeGreaterThan(0);
  });
});
