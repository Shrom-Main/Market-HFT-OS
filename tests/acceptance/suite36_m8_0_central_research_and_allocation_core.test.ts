/**
 * Gate M8.0 (Decision OD-24 / Charter DEC-024):
 * Central Research & Allocation Core Loop Acceptance Suite
 *
 * Normative Acceptance Test Suite verifying:
 * 1. M80-RES-BITEMPORAL-STORE-001: Bitemporal evidence store prevents lookahead bias via as_of_utc filter.
 * 2. M80-RES-EPISTEMIC-PROVENANCE-002: Rejection of caller-supplied self-attested LIVE_VERIFIED_CAPTURE.
 * 3. M80-RES-DEMAND-POWER-LAW-003: Power-law demand sales estimation formula with confidence intervals.
 * 4. M80-RES-NEED-DRIVEN-PLANNER-004: 6-dimension evidence coverage matrix and dynamic micro-agent task generation.
 * 5. M80-RES-PRODUCT-RESEARCH-EXEC-005: Product-specific worker execution and genuine evidence promotion.
 * 6. M80-RES-GROQ-REVIEW-MINING-006: Groq review mining extracts verbatim quotes with character spans and citations.
 * 7. M80-RES-BUNDLE-PAPER-SIM-007: 3-scenario paper allocation simulator with pure BigInt rational math.
 * 8. M80-RES-GOVERNED-BUNDLE-COMMIT-008: Bundle commitment enforces >= 15-char rationale and kill-switch gate.
 * 9. M80-RES-SERVER-REST-ENDPOINTS-009: WorkstationServer REST endpoints (/api/research/gaps, /api/bitemporal/series, /api/bundle/*, /api/health/db).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  CentralResearchCore,
  DemandSalesEstimator,
  EvidenceProvenanceVerifier,
  BitemporalEvidenceRecord,
  McpToolProof
} from '../../src/research/centralResearchCore.js';
import { sha256 } from '../../src/canonical/crypto.js';
import { GroqResearchSynthesizer } from '../../src/research/groqResearchSynthesizer.js';
import { BundleEvaluator } from '../../src/research/bundleEvaluator.js';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import { KillSwitchController } from '../../src/terminal/operatorTerminalController.js';

describe('Suite 36: Gate M8.0 Central Research & Allocation Core Loop Certification', () => {
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
      const defaultHeaders: Record<string, string> = {
        Host: `127.0.0.1:${options.port}`,
        Origin: `http://127.0.0.1:${options.port}`,
        ...(options.headers || {})
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
    // Start an isolated test instance of WorkstationServer on ephemeral port
    const stateManager = new WorkstationStateManager();
    server = new WorkstationServer({ port: 0, stateManager });
    const started = await server.start();
    serverPort = started.port;
  });

  afterAll(async () => {
    if (server) {
      const store = server.getStateManager().getCentralResearchCore().getEvidenceStore();
      const pool = store.getPgPool();
      if (pool) {
        await pool.query("DELETE FROM market_signal_traces WHERE trace_id LIKE 'TRACE-%' AND created_at_utc >= NOW() - INTERVAL '30 minutes';").catch(() => {});
      }
      await server.stop();
    }
  });

  // --------------------------------------------------------------------------
  // 1. Bitemporal Evidence Store & Lookahead Bias Prevention
  // --------------------------------------------------------------------------
  it('M80-RES-BITEMPORAL-STORE-001: Bitemporal evidence store prevents lookahead bias via as_of_utc filter', async () => {
    const core = new CentralResearchCore();
    await core.initialize();

    const t0 = new Date('2026-10-10T12:00:00.000Z').toISOString();
    const t1 = new Date('2026-10-15T12:00:00.000Z').toISOString();
    const t2 = new Date('2026-10-18T12:00:00.000Z').toISOString();

    // Store record 1 recorded at t0
    const rec1: BitemporalEvidenceRecord = {
      evidence_id: 'ev-test-1',
      product_id: 'prod:test:item1',
      channel: 'SOURCING_COSTS',
      observed_at_utc: t0,
      as_of_utc: t0,
      payload_sha256: 'a1b2c3d4e5f601',
      raw_payload: JSON.stringify({ quote_inr: 25.5 }),
      extracted_claims: { quote_inr: 25.5 },
      origin: {
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        source_url: 'fixture://test1',
        captured_at_utc: t0,
        cryptographic_hash: 'a1b2c3d4e5f601',
        is_attested: true
      },
      epistemic_class: 'OBSERVED_FACT',
      jcs_sha256: 'hash1'
    };
    await core.storeEvidence(rec1);

    // Store record 2 recorded at t2
    const rec2: BitemporalEvidenceRecord = {
      evidence_id: 'ev-test-2',
      product_id: 'prod:test:item1',
      channel: 'SOURCING_COSTS',
      observed_at_utc: t1,
      as_of_utc: t2,
      payload_sha256: 'a1b2c3d4e5f602',
      raw_payload: JSON.stringify({ quote_inr: 27.0 }),
      extracted_claims: { quote_inr: 27.0 },
      origin: {
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        source_url: 'fixture://test2',
        captured_at_utc: t2,
        cryptographic_hash: 'a1b2c3d4e5f602',
        is_attested: true
      },
      epistemic_class: 'OBSERVED_FACT',
      jcs_sha256: 'hash2'
    };
    await core.storeEvidence(rec2);

    // Query as of t1: Should ONLY see record 1, record 2 must be excluded (as_of_utc was t2)
    const recordsAsOfT1 = core.queryEvidence('prod:test:item1', t1);
    expect(recordsAsOfT1.length).toBe(1);
    expect(recordsAsOfT1[0].evidence_id).toBe('ev-test-1');

    // Query as of t2: Should see both records
    const recordsAsOfT2 = core.queryEvidence('prod:test:item1', t2);
    expect(recordsAsOfT2.length).toBe(2);
  });

  // --------------------------------------------------------------------------
  // 2. Epistemic Truthfulness & Evidence Provenance Verifier
  // --------------------------------------------------------------------------
  it('M80-RES-EPISTEMIC-PROVENANCE-002: Rejection of caller-supplied self-attested LIVE_VERIFIED_CAPTURE', () => {
    // 1. Unverified caller trying to claim LIVE_VERIFIED_CAPTURE without cryptographic proof
    const unverified = EvidenceProvenanceVerifier.verifyAndNormalizeOrigin('LIVE_VERIFIED_CAPTURE');
    expect(unverified.origin_class).toBe('UNATTESTED_USER_INTAKE');
    expect(unverified.is_attested).toBe(false);

    // 2. Legitimate verification with genuine signed MCP tool proof
    const rawPayload = '{"supplier": "IndiaMART", "unit_price": 25.50}';
    const payloadHash = sha256(rawPayload);
    const legitimateProof = EvidenceProvenanceVerifier.signProof({
      tool_run_id: 'run-test-001',
      worker_id: 'worker:source-capture:v1',
      dns_pre_resolution_ip: '157.240.22.35', // Genuine public IP
      http_status: 200,
      wall_clock_ms: 120,
      raw_payload_sha256: payloadHash
    });

    const verified = EvidenceProvenanceVerifier.verifyAndNormalizeOrigin(
      'LIVE_VERIFIED_CAPTURE',
      legitimateProof,
      'https://indiamart.com/proddetail/ss304-clamp.html',
      rawPayload
    );
    expect(verified.origin_class).toBe('LIVE_VERIFIED_CAPTURE');
    expect(verified.is_attested).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3. Power-Law Demand Sales Estimation Formula
  // --------------------------------------------------------------------------
  it('M80-RES-DEMAND-POWER-LAW-003: Power-law demand sales estimation formula with confidence intervals', () => {
    // Estimate for BSR #12 in Fasteners & Industrial Hardware
    const estimate = DemandSalesEstimator.estimateMonthlyDemand(
      'Fasteners & Industrial Hardware',
      12,
      499.0
    );

    expect(estimate.best_seller_rank).toBe(12);
    expect(estimate.monthly_volume_est).toBeGreaterThan(0);
    // Confidence intervals lower <= est <= upper
    expect(estimate.lower_bound_units).toBeLessThanOrEqual(estimate.monthly_volume_est);
    expect(estimate.upper_bound_units).toBeGreaterThanOrEqual(estimate.monthly_volume_est);
    // Formula documentation must be transparent
    expect(estimate.formula_expression).toContain('V = round(');
    expect(estimate.methodology_declaration).toContain('Power-Law');
  });

  // --------------------------------------------------------------------------
  // 4. Need-Driven Research Planner & 6-Dimension Coverage Matrix
  // --------------------------------------------------------------------------
  it('M80-RES-NEED-DRIVEN-PLANNER-004: 6-dimension evidence coverage matrix and dynamic micro-agent task generation', async () => {
    const core = new CentralResearchCore();
    await core.initialize();

    const mockProduct: any = {
      product_id: 'prod:test:brass-valve',
      name: 'Brass Ball Valve IS 9890',
      category: 'PLUMBING_INDUSTRIAL',
      commercial_archetype: 'COMMODITY_ARBITRAGE',
      upstream_supply: {
        supplier_name: 'Jamnagar Brass Forging Ltd',
        hub_name: 'Jamnagar, Gujarat'
      },
      sell_side: {
        best_seller_rank: 45
      },
      buyer_grievances: []
    };

    const gaps = core.evaluateEvidenceGaps(mockProduct);

    expect(gaps.product_id).toBe('prod:test:brass-valve');
    expect(gaps.dimensions).toHaveProperty('sourcing_costs');
    expect(gaps.dimensions).toHaveProperty('buyer_grievances');
    expect(gaps.dimensions).toHaveProperty('demand_velocity');
    expect(gaps.dimensions).toHaveProperty('statutory_compliance');
    expect(gaps.dimensions).toHaveProperty('seasonality_decay');
    expect(gaps.dimensions).toHaveProperty('adversarial_review');

    // Demand velocity should be covered from BSR #45
    expect(gaps.dimensions.demand_velocity.covered).toBe(true);

    // Pending tasks should contain worker tasks for uncovered dimensions
    expect(gaps.pending_tasks.length).toBeGreaterThan(0);
    const workerIds = gaps.pending_tasks.map((t) => t.worker_id);
    expect(workerIds).toContain('worker:source-capture:v1');
    expect(workerIds).toContain('worker:media-chatter:v1');
  });

  // --------------------------------------------------------------------------
  // 5. Product-Specific Targeted Research Execution
  // --------------------------------------------------------------------------
  it('M80-RES-PRODUCT-RESEARCH-EXEC-005: Product-specific worker execution and genuine evidence promotion', async () => {
    const stateManager = new WorkstationStateManager();
    const productBefore = stateManager.getProductById('prod:brass:ball-valve:1-2in-pn20');
    expect(productBefore).toBeDefined();

    const outcome = await stateManager.researchProduct({
      product_id: 'prod:brass:ball-valve:1-2in-pn20'
    });

    expect(outcome.product_id).toBe('prod:brass:ball-valve:1-2in-pn20');
    expect(outcome.strategy.research_case_status).toBe('ADVERSARIAL_REVIEW');

    // Evidence must be promoted in the central core
    const core = stateManager.getCentralResearchCore();
    const evidenceList = core.queryEvidence('prod:brass:ball-valve:1-2in-pn20');
    expect(evidenceList.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 6. Groq Review Mining & Thesis Synthesis
  // --------------------------------------------------------------------------
  it('M80-RES-GROQ-REVIEW-MINING-006: Groq review mining extracts verbatim quotes with character spans and citations', async () => {
    const synthesizer = new GroqResearchSynthesizer();
    const stateManager = new WorkstationStateManager();
    const product = stateManager.getProductById('prod:din3017:ss304:16-25mm:pack-10')!;

    const rawCorpus = 'The clamp screw stripped completely on first turn with a hand screwdriver! Junk metal. Fast delivery but band snapped when tightening around 19mm silicone hose.';

    const mined = await synthesizer.mineBuyerReviews(product, rawCorpus);

    expect(mined.product_id).toBe('prod:din3017:ss304:16-25mm:pack-10');
    expect(mined.grievances.length).toBeGreaterThan(0);

    for (const g of mined.grievances) {
      expect(g.verbatim_quote).toBeTruthy();
      expect(g.citation_character_span[0]).toBeGreaterThanOrEqual(0);
      expect(g.citation_character_span[1]).toBeGreaterThanOrEqual(g.citation_character_span[0]);
    }

    // Thesis synthesis
    const thesis = await synthesizer.synthesizeResearchThesis(product);

    expect(thesis.product_id).toBe('prod:din3017:ss304:16-25mm:pack-10');
    expect(thesis.thesis_synthesis).toBeTruthy();
    expect(thesis.unserved_pain_points.length).toBeGreaterThan(0);
    expect(thesis.engineered_edge_suggestions.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 7. Multi-Scenario Bundle Paper Allocator (Pure BigInt Rational Arithmetic)
  // --------------------------------------------------------------------------
  it('M80-RES-BUNDLE-PAPER-SIM-007: 3-scenario paper allocation simulator with pure BigInt rational math', () => {
    const evaluator = new BundleEvaluator();
    const stateManager = new WorkstationStateManager();
    const products = stateManager.getProductObservationDeck().products;

    const result = evaluator.evaluateBundle(
      {
        intent_id: 'INTENT-TEST-001',
        operator_id: 'operator:acceptance:test',
        target_capital_inr: 500000,
        target_capital_subunits: '5000000000',
        min_return_hurdle_bps: 2500, // 25.00%
        target_holding_period_days: 45,
        max_risk_tolerance: 'MEDIUM',
        max_drawdown_pct: 12.0,
        selected_product_ids: [
          'prod:din3017:ss304:16-25mm:pack-10',
          'prod:brass:ball-valve:1-2in-pn20'
        ],
        created_at_utc: new Date().toISOString()
      },
      products
    );

    expect(result.bundle_id).toMatch(/^BNDL-/);
    expect(result.slices.length).toBe(2);

    // Scenarios verification
    const { base, upside, downside } = result.scenarios;
    expect(base.scenario_name).toBe('BASE');
    expect(upside.scenario_name).toBe('UPSIDE');
    expect(downside.scenario_name).toBe('DOWNSIDE_STRESS');

    // Rational BigInt math validation: no NaN or undefined, strings serialize valid bigints
    expect(BigInt(base.allocated_capital_subunits)).toBeGreaterThan(0n);
    expect(BigInt(base.projected_net_profit_subunits)).toBeGreaterThan(0n);
    expect(base.contribution_margin_bps).toBeGreaterThan(0);
    expect(base.annualized_rowc_bps).toBeGreaterThan(0);

    // Upside profit must exceed Base profit, Base must exceed Downside profit
    expect(BigInt(upside.projected_net_profit_subunits)).toBeGreaterThan(
      BigInt(base.projected_net_profit_subunits)
    );
    expect(BigInt(base.projected_net_profit_subunits)).toBeGreaterThan(
      BigInt(downside.projected_net_profit_subunits)
    );

    // Cryptographic hash validation
    expect(result.jcs_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  // --------------------------------------------------------------------------
  // 8. Governed Bundle Commitment Gate
  // --------------------------------------------------------------------------
  it('M80-RES-GOVERNED-BUNDLE-COMMIT-008: Bundle commitment enforces >= 15-char rationale and kill-switch gate', () => {
    const evaluator = new BundleEvaluator();
    const ksController = new KillSwitchController();
    const stateManager = new WorkstationStateManager();
    const products = stateManager.getProductObservationDeck().products;

    const evaluation = evaluator.evaluateBundle(
      {
        intent_id: 'INTENT-TEST-COMMIT',
        operator_id: 'operator:test',
        target_capital_inr: 300000,
        target_capital_subunits: '3000000000',
        min_return_hurdle_bps: 2000,
        target_holding_period_days: 30,
        max_risk_tolerance: 'LOW',
        max_drawdown_pct: 10.0,
        selected_product_ids: ['prod:din3017:ss304:16-25mm:pack-10'],
        created_at_utc: new Date().toISOString()
      },
      products
    );

    // 1. Rejection when rationale < 15 characters
    expect(() => {
      evaluator.commitBundleToPaperSimulation(
        evaluation,
        {
          operator_id: 'operator:test',
          action_type: 'APPROVE_PAPER_ALLOCATION',
          target_entity_id: evaluation.bundle_id,
          explicit_rationale: 'Too short', // < 15 chars
          confirmation_token: 'tok-1',
          confirmed_at_utc: new Date().toISOString()
        },
        ksController
      );
    }).toThrow(/CONFIRMATION-AND-RATIONALE-REQUIRED/);

    // 2. Rejection when kill switch is HALTED
    ksController.activateKillSwitch('HALT_ALL_SIMULATION_PROCESSING', {
      operator_id: 'operator:audit',
      action_type: 'ACTIVATE_KILL_SWITCH',
      target_entity_id: 'kill-switch:test',
      explicit_rationale: 'Audit emergency test halt execution gate',
      confirmation_token: 'tok-ks',
      confirmed_at_utc: new Date().toISOString()
    });

    expect(() => {
      evaluator.commitBundleToPaperSimulation(
        evaluation,
        {
          operator_id: 'operator:test',
          action_type: 'APPROVE_PAPER_ALLOCATION',
          target_entity_id: evaluation.bundle_id,
          explicit_rationale: 'Valid rationale with sufficient characters',
          confirmation_token: 'tok-2',
          confirmed_at_utc: new Date().toISOString()
        },
        ksController
      );
    }).toThrow(/KILLSWITCH-ALL-SIMULATION-HALTED/);

    // 3. Success when kill switch is NORMAL and rationale >= 15 chars
    ksController.resetKillSwitch({
      operator_id: 'operator:audit',
      action_type: 'RESET_KILL_SWITCH',
      target_entity_id: 'kill-switch:reset',
      explicit_rationale: 'Reset kill switch back to normal paper simulation operation',
      confirmation_token: 'tok-reset',
      confirmed_at_utc: new Date().toISOString()
    });

    const commitResult = evaluator.commitBundleToPaperSimulation(
      evaluation,
      {
        operator_id: 'operator:test',
        action_type: 'APPROVE_PAPER_ALLOCATION',
        target_entity_id: evaluation.bundle_id,
        explicit_rationale: 'Approved paper bundle commit for DIN 3017 clamps',
        confirmation_token: 'tok-3',
        confirmed_at_utc: new Date().toISOString()
      },
      ksController
    );

    expect(commitResult.outcome.status).toBe('COMMITTED_TO_PAPER_SIMULATION');
    expect(commitResult.outcome.bundle_id).toBe(evaluation.bundle_id);
    expect(commitResult.outcome.jcs_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  // --------------------------------------------------------------------------
  // 9. Workstation Server Gate M8.0 REST Endpoints
  // --------------------------------------------------------------------------
  it('M80-RES-SERVER-REST-ENDPOINTS-009: WorkstationServer REST endpoints (/api/research/gaps, /api/bitemporal/series, /api/bundle/*, /api/health/db)', async () => {
    // 1. Evidence Gap Matrix
    const gapsRes = await httpRequest({
      port: serverPort,
      path: '/api/research/gaps?product_id=prod:din3017:ss304:16-25mm:pack-10'
    });
    expect(gapsRes.statusCode).toBe(200);
    const gaps = JSON.parse(gapsRes.body);
    expect(gaps.product_id).toBe('prod:din3017:ss304:16-25mm:pack-10');
    expect(gaps.dimensions).toHaveProperty('sourcing_costs');

    // 2. Bitemporal Series
    const seriesRes = await httpRequest({
      port: serverPort,
      path: '/api/bitemporal/series?product_id=prod:din3017:ss304:16-25mm:pack-10'
    });
    expect(seriesRes.statusCode).toBe(200);
    const seriesData = JSON.parse(seriesRes.body);
    expect(seriesData.product_id).toBe('prod:din3017:ss304:16-25mm:pack-10');
    expect(Array.isArray(seriesData.points)).toBe(true);

    // 3. Database Health
    const dbRes = await httpRequest({
      port: serverPort,
      path: '/api/health/db'
    });
    expect(dbRes.statusCode).toBe(200);
    const dbHealth = JSON.parse(dbRes.body);
    expect(dbHealth).toHaveProperty('is_connected');
    expect(dbHealth).toHaveProperty('backend');

    // 4. Bundle Paper Evaluation API
    const evalRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_capital_inr: 400000,
        min_return_hurdle_bps: 2000,
        target_holding_period_days: 45,
        max_risk_tolerance: 'MEDIUM',
        max_drawdown_pct: 10.0,
        selected_product_ids: ['prod:din3017:ss304:16-25mm:pack-10']
      })
    });
    expect(evalRes.statusCode).toBe(200);
    const evalData = JSON.parse(evalRes.body);
    expect(evalData.bundle_id).toBeTruthy();
    expect(evalData.scenarios.base.scenario_name).toBe('BASE');

    // 5. Bundle Commitment Gate API
    const commitRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/commit',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        evaluation: evalData,
        confirmation: {
          operator_id: 'operator:acceptance',
          action_type: 'APPROVE_PAPER_ALLOCATION',
          target_entity_id: evalData.bundle_id,
          explicit_rationale: 'Approved paper bundle commit for DIN 3017 clamps',
          confirmation_token: 'tok-api-commit',
          confirmed_at_utc: new Date().toISOString()
        }
      })
    });
    expect(commitRes.statusCode).toBe(200);
    const commitData = JSON.parse(commitRes.body);
    expect(commitData.outcome.status).toBe('COMMITTED_TO_PAPER_SIMULATION');
  });
});
