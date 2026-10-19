/**
 * Gate M7.2 (Decision OD-22 / Charter DEC-022):
 * Suite 34: Multi-Product Universe Observation Deck, Sell-Side Analytics,
 * Buyer Review Grievance Mining, Operational Edge Formulation, and Governed Research Dispatch
 *
 * Verifies all 10 normative Gate M7.2 specifications:
 * 1.  M72-PROD-UNIVERSE-CATALOG-001: Multi-product universe catalog completeness across commercial archetypes with SS304 as guiding reference.
 * 2.  M72-PROD-SELLSIDE-METRICS-002: Sell-side marketplace dynamics (BSR, volume velocity, gross revenue in INR, ASP, competitors).
 * 3.  M72-PROD-GRIEVANCE-MINING-003: Buyer review grievance mining (negative review %, failure modes, exact customer quotes, severity).
 * 4.  M72-PROD-ENGINEERED-EDGE-004: Engineered operational edge formulations (quality remediation to eliminate returns and capture Buy Box).
 * 5.  M72-PROD-SOURCING-SPREAD-005: Upstream manufacturing hubs, factory quotes, gross spreads, contribution margin, and RoWC.
 * 6.  M72-PROD-PUSH-OBSERVATION-006: POST /api/products/observe dynamic ingestion and fail-closed validation.
 * 7.  M72-PROD-RESEARCH-DISPATCH-007: POST /api/products/research specialist research dispatch and McpRunLedger event recording.
 * 8.  M72-PROD-REST-ENDPOINTS-008: HTTP REST endpoints GET /api/products/universe and GET /api/products/detail.
 * 9.  M72-PROD-TERMINAL-HTML-009: Workspace 0 Product Observation Deck UI markup, archetype filters, and teardown slide-over drawer.
 * 10. M72-PROD-RADAR-INTEGRATION-010: Cross-workspace reflection in Opportunity Radar and standalone HTML export.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import { ProductObservationDeckRegistry } from '../../src/research/productObservationDeckRegistry.js';
import { exportStandaloneHtml } from '../../src/cli/exportStandaloneHtml.js';
import { PushProductObservationRequest } from '../../src/mcp/contracts/productObservationContract.js';

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
            statusCode: res.statusCode || 500,
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

describe('Gate M7.2: Suite 34 — Multi-Product Observation Deck, Grievance Mining & Operational Edge', () => {
  let server: WorkstationServer;
  let stateManager: WorkstationStateManager;
  const testPort = 4314; // Distinct port to prevent collision with running daemon

  beforeAll(async () => {
    stateManager = new WorkstationStateManager();
    server = new WorkstationServer({
      stateManager,
      port: testPort,
      corsAllowedOrigins: [`http://127.0.0.1:${testPort}`, `http://localhost:${testPort}`]
    });
    await server.start();
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  it('M72-PROD-UNIVERSE-CATALOG-001: Multi-product universe catalog boots with distinct archetypes and SS304 as guiding reference', () => {
    const registry = new ProductObservationDeckRegistry();
    const products = registry.getAllProducts();

    expect(products.length).toBeGreaterThanOrEqual(8);

    // Verify SS304 is the guiding reference opportunity
    const ss304 = products.find(p => p.product_id === 'prod:din3017:ss304:16-25mm:pack-10');
    expect(ss304).toBeDefined();
    expect(ss304!.is_guiding_reference).toBe(true);
    expect(ss304!.commercial_archetype).toBe('CLUSTER_MRO_STANDARDIZED');

    // Verify non-guiding products
    const nonGuiding = products.filter(p => !p.is_guiding_reference);
    expect(nonGuiding.length).toBeGreaterThanOrEqual(7);
    for (const p of nonGuiding) {
      expect(p.is_guiding_reference).toBe(false);
      expect(p.sku_id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.category).toBeTruthy();
      expect(p.jcs_sha256).toMatch(/^[a-f0-9]{64}$/);
    }

    // Verify archetype coverage
    const archetypes = new Set(products.map(p => p.commercial_archetype));
    expect(archetypes.has('CLUSTER_MRO_STANDARDIZED')).toBe(true);
    expect(archetypes.has('TECHNICAL_COMPLIANCE')).toBe(true);
    expect(archetypes.has('SEASONAL_D2C_VISUAL')).toBe(true);
    expect(archetypes.has('D2C_CONSUMABLE')).toBe(true);
    expect(archetypes.has('MRO_INDUSTRIAL')).toBe(true);
    expect(archetypes.has('REPLACEMENT_PARTS')).toBe(true);
  });

  it('M72-PROD-SELLSIDE-METRICS-002: Sell-side marketplace dynamics capture BSR, volume, gross revenue, ASP, and competitor landscape', () => {
    const registry = new ProductObservationDeckRegistry();
    const products = registry.getAllProducts();

    for (const p of products) {
      const sell = p.sell_side;
      expect(sell).toBeDefined();
      expect(sell.primary_marketplace).toBeTruthy();
      expect(sell.best_seller_rank).toBeGreaterThan(0);
      expect(sell.monthly_sales_volume_est).toBeGreaterThan(0);
      expect(sell.monthly_gross_revenue_inr_est).toBeGreaterThan(0);
      expect(sell.prevailing_retail_asp_inr).toBeGreaterThan(0);
      expect(sell.competitor_count).toBeGreaterThan(0);
      expect((sell.top_competitor_brands || sell.top_competitor_names).length).toBeGreaterThanOrEqual(1);
      expect(sell.dominant_pack_formats.length).toBeGreaterThanOrEqual(1);

      // Verify revenue consistency (volume * ASP roughly matches gross revenue)
      const expectedRev = sell.monthly_sales_volume_est * sell.prevailing_retail_asp_inr;
      expect(sell.monthly_gross_revenue_inr_est).toBeCloseTo(expectedRev, -2);
    }
  });

  it('M72-PROD-GRIEVANCE-MINING-003: Buyer review grievance mining extracts structured failure modes, severity, and customer quotes', () => {
    const registry = new ProductObservationDeckRegistry();
    const products = registry.getAllProducts();

    for (const p of products) {
      expect(p.overall_negative_review_pct).toBeGreaterThan(0);
      expect(p.overall_negative_review_pct).toBeLessThanOrEqual(50);
      expect(p.buyer_grievances.length).toBeGreaterThanOrEqual(2);

      for (const g of p.buyer_grievances) {
        expect(g.category).toBeTruthy();
        expect(g.frequency_pct).toBeGreaterThan(0);
        expect(g.summary).toBeTruthy();
        expect(g.representative_quote.length).toBeGreaterThan(10);
        expect(g.failure_mode).toBeTruthy();
        expect(['CRITICAL', 'HIGH', 'MEDIUM']).toContain(g.severity);
      }
    }
  });

  it('M72-PROD-ENGINEERED-EDGE-004: Engineered operational edge formulates concrete physical and operational quality remediations', () => {
    const registry = new ProductObservationDeckRegistry();
    const products = registry.getAllProducts();

    for (const p of products) {
      for (const g of p.buyer_grievances) {
        expect(g.engineered_remediation).toBeTruthy();
        expect(g.engineered_remediation.length).toBeGreaterThan(25);
      }

      // Check specific remediation examples
      if (p.product_id === 'prod:din3017:ss304:16-25mm:pack-10') {
        expect(p.buyer_grievances[0].engineered_remediation.toLowerCase()).toContain('cold-rolled');
      }
      if (p.product_id === 'prod:brass:ball-valve:1-2in-pn20') {
        expect(p.buyer_grievances[0].engineered_remediation.toLowerCase()).toContain('stainless steel handle');
      }
      if (p.product_id === 'prod:festive:diya:terracotta-12p') {
        expect(p.buyer_grievances[0].engineered_remediation.toLowerCase()).toContain('pulp');
      }
    }
  });

  it('M72-PROD-SOURCING-SPREAD-005: Upstream sourcing cluster specifies manufacturing hubs, factory quotes, and spreads', () => {
    const registry = new ProductObservationDeckRegistry();
    const products = registry.getAllProducts();

    for (const p of products) {
      const supply = p.upstream_supply;
      expect(supply.hub_name).toBeTruthy();
      expect(supply.factory_gate_quote_inr).toBeGreaterThan(0);
      expect(supply.minimum_order_quantity).toBeGreaterThan(0);
      expect(supply.lead_time_days).toBeGreaterThan(0);
      expect(supply.per_unit_landed_cost_est_inr).toBeGreaterThanOrEqual(supply.factory_gate_quote_inr);

      const strat = p.strategy;
      expect(strat.target_gross_spread_inr).toBeGreaterThan(0);
      expect(strat.target_contribution_margin_bps).toBeGreaterThan(0);
      expect(strat.estimated_annualized_rowc_bps).toBeGreaterThan(0);
      expect(strat.cash_conversion_cycle_days).toBeGreaterThan(0);
      expect((strat.bull_case_thesis || strat.bull_case_rationale).length).toBeGreaterThan(20);
      expect((strat.bear_case_thesis || strat.bear_case_risk).length).toBeGreaterThan(20);
      expect((strat.min_capital_requirement_inr || strat.working_capital_req_inr)).toBeGreaterThan(0);
    }
  });

  it('M72-PROD-PUSH-OBSERVATION-006: POST /api/products/observe ingests new product observations and enforces fail-closed validation', async () => {
    // 1. Ingest new valid product
    const newProductReq: PushProductObservationRequest = {
      name: 'Stainless Steel Cable Ties 300mm Heavy Duty',
      category: 'Electrical Hardware & Wire Management',
      commercial_archetype: 'CLUSTER_MRO_STANDARDIZED',
      retail_asp_inr: 450.00,
      upstream_factory_quote_inr: 160.00,
      upstream_hub_name: 'Jamnagar Fastener Hub',
      observed_grievance: 'Ties snap when bent around sharp sheet metal edges in high vibration machinery',
      strategic_decision: 'PURSUE'
    };

    const res = await httpRequest({
      port: testPort,
      path: '/api/products/observe',
      method: 'POST',
      headers: {
        'Origin': `http://127.0.0.1:${testPort}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(newProductReq)
    });

    expect(res.statusCode).toBe(200);
    expect(res.json.product).toBeDefined();
    expect(res.json.product.name).toBe(newProductReq.name);
    expect(res.json.product.commercial_archetype).toBe('CLUSTER_MRO_STANDARDIZED');
    expect(res.json.product.strategy.strategic_decision).toBe('PURSUE');
    expect(res.json.product.strategy.target_gross_spread_inr).toBeGreaterThan(200);

    // 2. Reject request with missing mandatory fields (fail-closed)
    const invalidRes = await httpRequest({
      port: testPort,
      path: '/api/products/observe',
      method: 'POST',
      headers: {
        'Origin': `http://127.0.0.1:${testPort}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'Incomplete Item' })
    });

    expect(invalidRes.statusCode).toBe(400);
    const errCode = invalidRes.json.audit_detail?.error_code || invalidRes.json.error?.error_id || invalidRes.json.error;
    expect(errCode).toBe('E-SRV-MISSING-ARGUMENT');
  });

  it('M72-PROD-RESEARCH-DISPATCH-007: POST /api/products/research dispatches specialist research and records McpRunLedger events', async () => {
    const res = await httpRequest({
      port: testPort,
      path: '/api/products/research',
      method: 'POST',
      headers: {
        'Origin': `http://127.0.0.1:${testPort}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        product_id: 'prod:brass:ball-valve:1-2in-pn20',
        target_specialist_workers: ['SourceCaptureWorker', 'MediaAndChatterWorker', 'GovtAndStatutoryWorker']
      })
    });

    expect(res.statusCode).toBe(200);
    expect(res.json.status).toBe('ADVERSARIAL_REVIEW');
    expect(res.json.product).toBeDefined();
    expect(res.json.product.strategy.research_case_status).toBe('ADVERSARIAL_REVIEW');

    // Reject missing product_id
    const badRes = await httpRequest({
      port: testPort,
      path: '/api/products/research',
      method: 'POST',
      headers: {
        'Origin': `http://127.0.0.1:${testPort}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    expect(badRes.statusCode).toBe(400);
    const errCode = badRes.json.audit_detail?.error_code || badRes.json.error?.error_id || badRes.json.error;
    expect(errCode).toBe('E-SRV-MISSING-ARGUMENT');
  });

  it('M72-PROD-REST-ENDPOINTS-008: HTTP REST endpoints GET /api/products/universe and GET /api/products/detail operate with full fidelity', async () => {
    // 1. GET /api/products/universe
    const universeRes = await httpRequest({
      port: testPort,
      path: '/api/products/universe',
      method: 'GET'
    });

    expect(universeRes.statusCode).toBe(200);
    expect(universeRes.json.total_products_count).toBeGreaterThanOrEqual(8);
    expect(Array.isArray(universeRes.json.products)).toBe(true);
    expect(universeRes.json.archetypes).toBeDefined();
    expect(universeRes.json.categories).toBeDefined();

    // 2. GET /api/products/detail by query param
    const detailRes = await httpRequest({
      port: testPort,
      path: '/api/products/detail?id=prod:electrical:mcb:16a-c-curve',
      method: 'GET'
    });

    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json.product).toBeDefined();
    expect(detailRes.json.product.product_id).toBe('prod:electrical:mcb:16a-c-curve');
    expect(detailRes.json.product.category).toContain('Electrical');

    // 3. GET /api/products/detail 404 for unknown product
    const notFoundRes = await httpRequest({
      port: testPort,
      path: '/api/products/detail?id=prod:non-existent-sku',
      method: 'GET'
    });

    expect(notFoundRes.statusCode).toBe(404);
    const errCode = notFoundRes.json.audit_detail?.error_code || notFoundRes.json.error?.error_id || notFoundRes.json.error;
    expect(errCode).toBe('E-SRV-PRODUCT-NOT-FOUND');
  });

  it('M72-PROD-TERMINAL-HTML-009: Workspace 0 Product Observation Deck UI renders table, filter pills, and slide-over teardown drawer', async () => {
    const htmlRes = await httpRequest({
      port: testPort,
      path: '/',
      method: 'GET'
    });

    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.headers['content-type']).toContain('text/html');

    const html = htmlRes.body;

    // Check table and Workspace 0 presence
    expect(html).toContain('id="workspace-0"');
    expect(html).toContain('Product Observation Deck &amp; Grievance Mining');
    expect(html).toContain('id="product-observation-deck-table"');

    // Check archetype filter buttons
    expect(html).toContain('data-filter="ALL"');
    expect(html).toContain('data-filter="CLUSTER_MRO_STANDARDIZED"');
    expect(html).toContain('data-filter="TECHNICAL_COMPLIANCE"');
    expect(html).toContain('data-filter="SEASONAL_D2C_VISUAL"');
    expect(html).toContain('data-filter="D2C_CONSUMABLE"');

    // Check action buttons and drawer
    expect(html).toContain('btn-inspect-product');
    expect(html).toContain('btn-dispatch-product-research');
    expect(html).toContain('id="lineage-drawer"');
    expect(html).toContain('id="drawer-custom-content"');
    expect(html).toContain('window.__PRODUCT_OBSERVATIONS__ =');

    // Check guiding reference badge
    expect(html).toContain('[GUIDING REFERENCE]');
  });

  it('M72-PROD-RADAR-INTEGRATION-010: Cross-workspace reflection in Opportunity Radar and standalone HTML exporter', () => {
    // 1. Fresh state manager boots truthfully with all fixture origins
    const freshManager = new WorkstationStateManager();
    const freshSnapshot = freshManager.getSnapshot();
    const freshRadar = freshSnapshot.workspaces.opportunity_radar;

    expect(freshRadar.opportunities.length).toBeGreaterThanOrEqual(8);
    for (const opp of freshRadar.opportunities) {
      expect(opp.evidence_origin?.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
    }

    // 2. Active state manager after research dispatch reflects live promotion for SS304
    const activeSnapshot = stateManager.getSnapshot();
    const activeRadar = activeSnapshot.workspaces.opportunity_radar;
    expect(activeRadar.opportunities.length).toBeGreaterThanOrEqual(8);
    expect(activeRadar.opportunities[0].evidence_origin?.origin_class).toBe('LIVE_VERIFIED_CAPTURE');

    // 3. Verify standalone exporter generates self-contained file with products embedded
    const exportResult = exportStandaloneHtml();
    expect(fs.existsSync(exportResult.filePath)).toBe(true);
    expect(exportResult.byteLength).toBeGreaterThan(100000);

    const exportedContent = fs.readFileSync(exportResult.filePath, 'utf8');
    expect(exportedContent).toContain('Product Observation Deck &amp; Grievance Mining');
    expect(exportedContent).toContain('window.__PRODUCT_OBSERVATIONS__ =');
    expect(exportedContent).toContain('prod:brass:ball-valve:1-2in-pn20');
  });
});
