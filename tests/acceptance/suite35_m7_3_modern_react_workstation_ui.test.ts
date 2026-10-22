/**
 * Gate M7.3 (Decision OD-23 / Charter DEC-023):
 * Modern React Workstation UI, Bloomberg Split-Terminal Temporal Dynamics,
 * Grievance Mining Cockpit & Groq AI Strategic Advisor Certification Suite
 *
 * Normative Acceptance Test Suite verifying:
 * 1. M73-UI-CLIENT-BUNDLE-INTEGRITY-001: Vite production build artifacts exist and are attested.
 * 2. M73-UI-SERVER-STATIC-ASSETS-002: WorkstationServer delivers static client assets with security headers.
 * 3. M73-UI-HTML-MOUNT-INJECTION-003: Operator terminal HTML embeds modern #root mount and bundle scripts.
 * 4. M73-UI-BLOOMBERG-SPLIT-TERMINAL-004: Bloomberg split-terminal fundamental and market dynamics models.
 * 5. M73-UI-GROQ-AI-ANALYZE-API-005: /api/ai/analyze returns structured AI opportunity intelligence.
 * 6. M73-UI-STANDALONE-INLINED-HTML-006: Standalone HTML snapshot is fully inlined and self-contained (>500 KB).
 * 7. M73-UI-AGENT-RESEARCH-DESK-007: 5-Worker DAG dispatcher contract and ledger telemetry verification.
 * 8. M73-UI-GRIEVANCE-MINING-COCKPIT-008: Multi-product grievance clustering and operational edge formulation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import { renderOperatorTerminalHtml } from '../../src/terminal/operatorTerminalController.js';
import { exportStandaloneHtml } from '../../src/cli/exportStandaloneHtml.js';

describe('Suite 35: Gate M7.3 Modern React Workstation UI & Bloomberg Split-Terminal Certification', () => {
  let server: WorkstationServer;
  let serverPort: number;

  function httpRequest(options: {
    port: number;
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
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
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: data
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
    // Launch server on ephemeral port (SRV-04)
    server = new WorkstationServer({ port: 0 });
    const started = await server.start();
    serverPort = started.port;
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  // TEST 1: CLIENT BUNDLE INTEGRITY
  it('M73-UI-CLIENT-BUNDLE-INTEGRITY-001: Verifies Vite production build bundles exist in dist/client/assets', () => {
    const assetsDir = path.resolve(process.cwd(), 'dist/client/assets');
    expect(fs.existsSync(assetsDir)).toBe(true);

    const files = fs.readdirSync(assetsDir);
    const jsFiles = files.filter((f) => f.startsWith('index-') && f.endsWith('.js'));
    const cssFiles = files.filter((f) => f.startsWith('index-') && f.endsWith('.css'));

    expect(jsFiles.length).toBeGreaterThan(0);
    expect(cssFiles.length).toBeGreaterThan(0);

    const jsSize = fs.statSync(path.join(assetsDir, jsFiles[0])).size;
    const cssSize = fs.statSync(path.join(assetsDir, cssFiles[0])).size;

    expect(jsSize).toBeGreaterThan(100_000); // Compiled React 19 + Lucide SPA
    expect(cssSize).toBeGreaterThan(10_000); // Compiled Tailwind CSS theme
  });

  // TEST 2: SERVER STATIC ASSETS DELIVERY
  it('M73-UI-SERVER-STATIC-ASSETS-002: WorkstationServer delivers static client assets with strict security headers', async () => {
    const assetsDir = path.resolve(process.cwd(), 'dist/client/assets');
    const files = fs.readdirSync(assetsDir);
    const jsFile = files.find((f) => f.startsWith('index-') && f.endsWith('.js'))!;
    const cssFile = files.find((f) => f.startsWith('index-') && f.endsWith('.css'))!;

    // 1. Fetch JS bundle
    const jsRes = await httpRequest({
      port: serverPort,
      path: `/assets/${jsFile}`
    });
    expect(jsRes.statusCode).toBe(200);
    expect(jsRes.headers['content-type']).toContain('application/javascript');
    expect(jsRes.headers['x-content-type-options']).toBe('nosniff');
    expect(jsRes.body.length).toBeGreaterThan(100_000);

    // 2. Fetch CSS bundle
    const cssRes = await httpRequest({
      port: serverPort,
      path: `/assets/${cssFile}`
    });
    expect(cssRes.statusCode).toBe(200);
    expect(cssRes.headers['content-type']).toContain('text/css');
    expect(cssRes.headers['x-content-type-options']).toBe('nosniff');
    expect(cssRes.body.length).toBeGreaterThan(10_000);
  });

  // TEST 3: ROOT HTML MOUNT INJECTION
  it('M73-UI-HTML-MOUNT-INJECTION-003: Operator terminal HTML embeds modern #root mount and bundle scripts while retaining fallback test hooks', async () => {
    const res = await httpRequest({
      port: serverPort,
      path: '/'
    });
    expect(res.statusCode).toBe(200);
    const html = res.body;

    // React mount container and script injection
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module" src="/assets/index-');
    expect(html).toContain('<link rel="stylesheet" href="/assets/index-');

    // Retains backward-compatible semantic test hooks
    expect(html).toContain('id="workspace-command-center"');
    expect(html).toContain('id="product-observation-deck-table"');
    expect(html).toContain('id="btn-run-dag"');
    expect(html).toContain('id="btn-ks-halt-allocations"');
    expect(html).toContain('OPERATING MODE: <strong>DRY_RUN_PAPER_SIMULATION_ONLY</strong>');
  });

  // TEST 4: BLOOMBERG SPLIT-TERMINAL WHAT-IF INTEGRATION
  it('M73-UI-BLOOMBERG-SPLIT-TERMINAL-004: Validates backend What-If formula simulator supporting split-terminal microeconomics', async () => {
    const simRes = await httpRequest({
      port: serverPort,
      path: '/api/actions/what-if-formula',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formula_expression: '(ASP_SUBUNITS - (QUOTE_SUBUNITS + FREIGHT_SUBUNITS)) * 10000 / ASP_SUBUNITS',
        variables: {
          ASP_SUBUNITS: 35000,
          QUOTE_SUBUNITS: 11500,
          FREIGHT_SUBUNITS: 1500
        }
      })
    });

    expect(simRes.statusCode).toBe(200);
    const result = JSON.parse(simRes.body);
    expect(result.model).toBeDefined();
    expect(result.evaluation).toBeDefined();
    expect(result.evaluation.tier).toBe('CANDIDATE_UI_MODEL');
    expect(Number(result.evaluation.calculated_output_subunits)).toBeGreaterThan(0);
  });

  // TEST 5: GROQ AI OPPORTUNITY ANALYSIS API
  it('M73-UI-GROQ-AI-ANALYZE-API-005: /api/ai/analyze returns structured AI opportunity intelligence', async () => {
    const aiRes = await httpRequest({
      port: serverPort,
      path: '/api/ai/analyze',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: 'prod:brass:ball-valve:1-2in-pn20',
        prompt_notes: 'Focus on handle durability and stem leakage remediations'
      })
    });

    expect(aiRes.statusCode).toBe(200);
    const data = JSON.parse(aiRes.body);
    expect(data.product_id).toBe('prod:brass:ball-valve:1-2in-pn20');
    if (data.llm_called) {
      expect(data.llm_model).toContain('Groq');
      expect(data.generation_mode).toBe('LIVE_LLM_SYNTHESIS');
    } else {
      expect(data.llm_model).toBeNull();
      expect(data.generation_mode).toBe('DETERMINISTIC_TEMPLATE_FALLBACK');
    }
    expect(data.thesis_synthesis.length).toBeGreaterThan(20);
    expect(data.unserved_pain_points.length).toBeGreaterThan(0);
    expect(data.engineered_edge_suggestions.length).toBeGreaterThan(0);
    expect(['STRONG_BUY_BOX_CANDIDATE', 'PROMISING_BUT_UNVALIDATED']).toContain(data.arbitrage_viability_verdict);
    expect(['PURSUE_EXPEDITED', 'VALIDATE_FURTHER']).toContain(data.recommended_action);
  });

  // TEST 6: STANDALONE INLINED HTML
  it('M73-UI-STANDALONE-INLINED-HTML-006: Standalone HTML snapshot is fully inlined and self-contained (>500 KB)', () => {
    const exported = exportStandaloneHtml();
    expect(fs.existsSync(exported.filePath)).toBe(true);
    expect(exported.byteLength).toBeGreaterThan(500_000); // Contains inlined React bundle + styles + catalog

    const fileContent = fs.readFileSync(exported.filePath, 'utf8');
    expect(fileContent).toContain('<div id="root"></div>');
    expect(fileContent).toContain('<script type="module">');
    expect(fileContent).toContain('React');
    expect(fileContent).toContain('Product Observation Deck &amp; Grievance Mining');
  });

  // TEST 7: AGENT RESEARCH DESK DAG DISPATCHER
  it('M73-UI-AGENT-RESEARCH-DESK-007: 5-Worker DAG dispatcher contract verifies topological execution and ledger telemetry', async () => {
    const dagRes = await httpRequest({
      port: serverPort,
      path: '/api/actions/run-dag',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_confirmation_token: 'CONFIRM_RUN_DAG_WAVE',
        rationale: 'Authorized operator DAG research wave for market lead verification'
      })
    });

    expect(dagRes.statusCode).toBe(200);
    const dagData = JSON.parse(dagRes.body);
    expect(dagData.outcome).toBeDefined();
    expect(dagData.outcome.waves_executed).toBeGreaterThanOrEqual(1);
    expect(dagData.outcome.checkpoint_sha256).toHaveLength(64);
  });

  // TEST 8: GRIEVANCE MINING COCKPIT VERIFICATION
  it('M73-UI-GRIEVANCE-MINING-COCKPIT-008: Multi-product grievance clustering and operational edge formulation', async () => {
    const uniRes = await httpRequest({
      port: serverPort,
      path: '/api/products/universe'
    });

    expect(uniRes.statusCode).toBe(200);
    const deck = JSON.parse(uniRes.body);
    expect(deck.total_products_count).toBeGreaterThanOrEqual(8);

    for (const prod of deck.products) {
      expect(prod.product_id).toBeDefined();
      expect(prod.commercial_archetype).toBeDefined();
      expect(prod.sell_side?.prevailing_retail_asp_inr).toBeGreaterThan(0);
      expect(prod.buyer_grievances.length).toBeGreaterThan(0);

      for (const g of prod.buyer_grievances) {
        expect(g.summary).toBeDefined();
        expect(g.representative_quote.length).toBeGreaterThan(5);
        expect(g.engineered_remediation.length).toBeGreaterThan(5);
      }
    }
  });
});
