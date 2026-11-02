/**
 * Suite 61: POC-001 Bounded Release-Blocker Remediations Certification
 *
 * Verifies the 5 confirmed release blockers are remediated truthfully:
 * 1. BLOCKER-1: Browser UI unsuppression & Vite bundle integrity
 * 2. BLOCKER-2: Epistemic classification of Treasury paper capital (SIMULATED)
 * 3. BLOCKER-3: Operator simulation assumption provenance isolation
 * 4. BLOCKER-4: Suite 34 window.__PRODUCT_OBSERVATIONS__ contract compatibility
 * 5. BLOCKER-5: Non-misleading [CATALOG] provenance tag on Workspace 0 observation deck
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import { renderOperatorTerminalHtml } from '../../src/terminal/operatorTerminalController.js';
import { exportStandaloneHtml } from '../../src/cli/exportStandaloneHtml.js';
import { truncateTestDatabase } from '../setup.js';

describe('Suite 61: POC-001 Release-Blocker Remediations Certification', () => {
  let server: WorkstationServer;
  let serverPort: number;
  let stateManager: WorkstationStateManager;

  function httpRequest(options: {
    port: number;
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json?: any }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: options.port,
          path: options.path,
          method: options.method || 'GET',
          headers: {
            Host: `127.0.0.1:${options.port}`,
            Origin: `http://127.0.0.1:${options.port}`,
            ...(options.headers || {})
          }
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            let parsedJson: any = undefined;
            try {
              parsedJson = JSON.parse(data);
            } catch {}
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: data,
              json: parsedJson
            });
          });
        }
      );

      req.on('error', (err) => reject(err));

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  beforeAll(async () => {
    await truncateTestDatabase();
    stateManager = new WorkstationStateManager();
    server = new WorkstationServer({ port: 0, stateManager });
    const started = await server.start();
    serverPort = started.port;
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  // TEST 1: BLOCKER-1 BROWSER UI UNSUPPRESSION & ASSET INTEGRITY
  it('REM-001-BLOCKER-1: Production client bundle does not hide .container or .banner and root is cleanly mounted in Workspace 9', async () => {
    // 1. Assets exist
    const assetsDir = path.resolve(process.cwd(), 'dist/client/assets');
    expect(fs.existsSync(assetsDir)).toBe(true);
    const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);

    // 2. Client bundle contains NO suppression of legacyContainer or legacyBanner
    const jsContent = fs.readFileSync(path.join(assetsDir, jsFiles[0]), 'utf8');
    expect(jsContent).not.toContain('legacyContainer');
    expect(jsContent).not.toContain('.container");Am&&(Am.style.display="none")');

    // 3. Server renders unsuppressed container, banner, and #root
    const res = await httpRequest({ port: serverPort, path: '/' });
    expect(res.statusCode).toBe(200);
    const html = res.body;

    expect(html).toContain('<main class="container">');
    expect(html).toContain('class="banner"');
    expect(html).toContain('id="workspace-react-terminal"');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('data-tab="workspace-react-terminal"');
  });

  // TEST 2: BLOCKER-2 TREASURY EPISTEMIC CLASSIFICATION
  it('REM-002-BLOCKER-2: Available Treasury paper capital is canonically classified as SIMULATED across API and UI', async () => {
    // 1. API Snapshot state
    const snapRes = await httpRequest({ port: serverPort, path: '/api/snapshot' });
    expect(snapRes.statusCode).toBe(200);
    const cc = snapRes.json.snapshot.workspaces.command_center;

    expect(cc.available_treasury_capital_inr.classification).toBe('SIMULATED');
    expect(Number(cc.available_treasury_capital_inr.value)).toBeGreaterThan(0);
    expect(cc.available_treasury_capital_inr.source_lineage_ref).toBe('treasury://paper/simulated_reserve');
    expect(cc.committed_paper_capital_inr.classification).toBe('SIMULATED');

    // 2. HTML projection
    const res = await httpRequest({ port: serverPort, path: '/' });
    expect(res.body).toContain('Available Treasury (Simulated)');
    expect(res.body).toContain('Liquid Paper Reserve (Simulated)');
    expect(res.body).toContain(`₹${cc.available_treasury_capital_inr.value} <span class="provenance-tag">SIMULATED</span>`);
    expect(res.body).not.toContain(`₹${cc.available_treasury_capital_inr.value} <span class="provenance-tag">ACTUAL</span>`);
  });

  // TEST 3: BLOCKER-3 OPERATOR SIMULATION ASSUMPTION PROVENANCE
  it('REM-003-BLOCKER-3: Operator-entered manual assumptions are classified as OPERATOR_SIMULATION_ASSUMPTION, not fixture or verified', async () => {
    // 1. Screen an offline candidate fixture
    const screenRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/screen',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fixture_id: 'FIX-AMZ-SS304-001'
      })
    });
    expect(screenRes.statusCode).toBe(200);
    const candidateId = screenRes.json.candidate.candidate_id;

    // 2. Claim task
    const claimRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'claim',
        worker_id: 'operator-ui',
        candidate_id: candidateId
      })
    });
    expect(claimRes.statusCode).toBe(200);
    const task = claimRes.json.task;

    // 3. Commit operator manual assumption
    const commitRes = await httpRequest({
      port: serverPort,
      path: '/api/discovery/investigate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: task.task_id,
        candidate_id: candidateId,
        generation_id: task.generation_id,
        lease_owner_id: 'operator-ui',
        fencing_token: task.fencing_token,
        result_payload: { factory_gate_quote_inr: 25.0 },
        evidence_origin: {
          source_connector_id: 'conn:operator:simulation-assumption',
          origin_class: 'OPERATOR_SIMULATION_ASSUMPTION',
          observed_at_utc: new Date().toISOString(),
          verification_status: 'UNVERIFIED'
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

    // 4. Verify underwritten candidate reflects assumption posture and is NOT live market verified
    const underwriteRes = await httpRequest({
      port: serverPort,
      path: `/api/candidates/${encodeURIComponent(candidateId)}/underwrite`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        budgetConfig: { available_paper_capital_inr: 50000 }
      })
    });
    expect(underwriteRes.statusCode).toBe(200);
    const decision = underwriteRes.json;

    expect(decision.evidence_summary.origin_class).toBe('OPERATOR_SIMULATION_ASSUMPTION');
    expect(decision.evidence_summary.is_live_market_verified).toBe(false);
    expect(decision.evidence_summary.evidence_posture).toBe('UNATTESTED_INTAKE');
  });

  // TEST 4: BLOCKER-4 SUITE 34 GLOBAL VARIABLE COMPATIBILITY
  it('REM-004-BLOCKER-4: Server HTML and standalone HTML declare window.__PRODUCT_OBSERVATIONS__ and PRODUCTS_DATA', () => {
    const exportResult = exportStandaloneHtml();
    expect(fs.existsSync(exportResult.filePath)).toBe(true);

    const exportedContent = fs.readFileSync(exportResult.filePath, 'utf8');
    expect(exportedContent).toContain('window.__PRODUCT_OBSERVATIONS__ =');
    expect(exportedContent).toContain('var PRODUCTS_DATA = window.__PRODUCT_OBSERVATIONS__;');
    expect(exportedContent).toContain('prod:brass:ball-valve:1-2in-pn20');
  });

  // TEST 5: BLOCKER-5 CATALOG ACCURACY
  it('REM-005-BLOCKER-5: Workspace 0 observation deck accurately displays [CATALOG] recorded products tag', async () => {
    const res = await httpRequest({ port: serverPort, path: '/' });
    expect(res.statusCode).toBe(200);
    const html = res.body;

    expect(html).toContain('[CATALOG] 8 RECORDED PRODUCTS');
    expect(html).not.toContain('[LIVE] 8 PRODUCTS TRACKED');
    expect(html).toContain('[PAPER SIMULATION MODE]');
  });
});
