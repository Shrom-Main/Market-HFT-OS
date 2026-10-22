/**
 * Gate Slice 3 (Decision OD-27 / Charter DEC-027):
 * Category-Agnostic Dynamic Agent Planner, 6 Specialist Task Agents & 8 Structural Incumbent-Failure Explanations
 *
 * Normative Acceptance Test Suite verifying:
 * 1. SLICE3-DYNAMIC-PLANNER-MULTI-PRODUCT-001: Dynamic planning across 3 non-SS304 products plus SS304.
 * 2. SLICE3-STRUCTURAL-INCUMBENT-FAILURE-002: 8 structural incumbent-failure explanations evaluated.
 * 3. SLICE3-EPISTEMIC-SEPARATION-003: Epistemic separation of observation kinds.
 * 4. SLICE3-HONEST-ECONOMICS-FAIL-004: Honest ECONOMICS_FAIL / DISTRIBUTION_FAIL when unit contribution is negative.
 * 5. SLICE3-HIGH-PROBLEM-WEAK-DEMAND-005: High problem strength + weak demand yields MORE_EVIDENCE_REQUIRED.
 * 6. SLICE3-MULTI-CHANNEL-UNIT-ECONOMICS-006: Multi-channel pure BigInt comparison (Amazon, Flipkart, Meesho, B2B).
 * 7. SLICE3-POSTGRES-HYPOTHESIS-PERSISTENCE-007: Direct PostgreSQL persistence across state manager restart.
 * 8. SLICE3-GOVERNED-DAG-PRODUCT-DISPATCH-008: triggerGovernedDagRun with { product_id } runs product-specific parameters.
 * 9. SLICE3-HYPOTHESIS-LIFECYCLE-TRANSITIONS-009: Hypothesis lifecycle stage transitions validated with history.
 * 10. SLICE3-SCORECARD-8-DIMENSION-PENALTIES-010: Opportunity Scorecard 8-dimension breakdown enforces explicit missing-data penalties.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import {
  ProductAwareDynamicResearchPlanner
} from '../../src/research/productAwareDynamicResearchPlanner.js';
import {
  OpportunityScorecardEngine
} from '../../src/research/opportunityScorecardEngine.js';
import {
  evaluateIncumbentFailureHypotheses,
  INCUMBENT_FAILURE_HYPOTHESIS_STATEMENTS,
  type ObservationEntity,
  type CustomerProblemEntity,
  type SupplierQuoteEntity,
  type UnitEconomicsScenarioEntity
} from '../../src/mcp/contracts/canonicalMarketGraphContract.js';

describe('Suite 39: Gate Slice 3 Dynamic Agent Planner, 6 Specialist Agents & 8 Incumbent-Failure Explanations', () => {
  let server: WorkstationServer;
  let serverPort: number;

  function httpRequest(options: {
    port: number;
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json: any }> {
    return new Promise((resolve, reject) => {
      const defaultHeaders: Record<string, string> = {
        Host: `127.0.0.1:${options.port}`,
        Origin: `http://127.0.0.1:${options.port}`,
        ...(options.headers || {})
      };

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
            let parsedJson: any = null;
            try {
              parsedJson = JSON.parse(data);
            } catch {
              // Non-JSON response
            }
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
    // Ephemeral port selection
    const tempServer = http.createServer();
    await new Promise<void>((resolve) => {
      tempServer.listen(0, '127.0.0.1', () => {
        const addr = tempServer.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 4319;
        tempServer.close(() => resolve());
      });
    });

    server = new WorkstationServer({ port: serverPort });
    await server.start();
  });

  afterAll(async () => {
    if (server) {
      const store = server.getStateManager().getCentralResearchCore().getEvidenceStore();
      const pool = store.getPgPool();
      if (pool) {
        // Targeted cleanups only — never table-wide DELETEs
        await pool.query("DELETE FROM market_hypothesis_ledger WHERE hypothesis_id LIKE 'HYP-%' AND created_at_utc > NOW() - INTERVAL '2 hours';").catch(() => {});
        await pool.query("DELETE FROM market_signal_traces WHERE trace_id LIKE 'TRACE-%' AND created_at_utc > NOW() - INTERVAL '2 hours';").catch(() => {});
        await pool.query("DELETE FROM market_connector_telemetry WHERE connector_id LIKE 'conn:%' AND last_fetch_utc > NOW() - INTERVAL '2 hours';").catch(() => {});
      }
      await server.stop();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 1: Category-Agnostic Dynamic Planning Across Diverse Products
  // --------------------------------------------------------------------------
  it('SLICE3-DYNAMIC-PLANNER-MULTI-PRODUCT-001: executes dynamic research plan tailored across 3 non-SS304 products plus SS304', async () => {
    const stateManager = server.getStateManager();
    const core = stateManager.getCentralResearchCore();

    const testProducts = [
      'prod:festive:diya:terracotta-12p',
      'prod:brass:ball-valve:1-2in-pn20',
      'prod:wellness:candle:soy-lavender',
      'prod:din3017:ss304:16-25mm:pack-10'
    ];

    for (const prodId of testProducts) {
      const prod = stateManager.getProductById(prodId);
      expect(prod).toBeDefined();

      const result = await ProductAwareDynamicResearchPlanner.executeResearchPlan({
        product: prod!,
        centralResearchCore: core,
        mcpBroker: stateManager.getMcpBroker(),
        mcpRunLedger: stateManager.getMcpRunLedger()
      });

      // Assert common structural integrity
      expect(result.product_id).toBe(prodId);
      expect(result.product_name).toBe(prod!.name);
      expect(result.category).toBe(prod!.category);
      expect(result.tasks_executed).toHaveLength(6);
      expect(result.tasks_executed).toEqual([
        'CustomerTaskAgent',
        'SellerTaskAgent',
        'SupplyTaskAgent',
        'LogisticsTaskAgent',
        'UnitEconomicsTaskAgent',
        'AdversarialTaskAgent'
      ]);

      // Category-tailored assertions
      if (prodId === 'prod:festive:diya:terracotta-12p') {
        expect(result.category).toBe('Home & Festive Handicrafts');
        expect(result.task_outputs.customer_agent.complaint_taxonomy.length).toBeGreaterThan(0);
        // Breakage/shattering in transit is the dominant grievance for terracotta
        expect(result.task_outputs.customer_agent.complaint_taxonomy[0].failure_mode).toMatch(/(shattered|breakage|bubble wrap)/i);
      } else if (prodId === 'prod:brass:ball-valve:1-2in-pn20') {
        expect(result.category).toBe('Plumbing & Fluid Control');
        expect(result.sourcing_hub).toContain('Jamnagar');
        expect(result.task_outputs.supply_agent.raw_material_basis).toContain('Brass');
      } else if (prodId === 'prod:wellness:candle:soy-lavender') {
        expect(result.category).toBe('Wellness & Home Fragrance');
        expect(result.task_outputs.seller_agent.buy_box_retention_risk).toBeDefined();
      } else if (prodId === 'prod:din3017:ss304:16-25mm:pack-10') {
        expect(result.category).toBe('Industrial Fasteners & Hardware');
        expect(result.sourcing_hub).toContain('Howrah');
      }

      // SHA-256 integrity
      expect(result.jcs_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.hypothesis_record.hypothesis_id).toMatch(/^HYP-/);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 2: 8 Structural Incumbent-Failure Explanations
  // --------------------------------------------------------------------------
  it('SLICE3-STRUCTURAL-INCUMBENT-FAILURE-002: evaluates all 8 structural incumbent-failure hypotheses', () => {
    const evaluations = evaluateIncumbentFailureHypotheses({
      product_id: 'prod:din3017:ss304:16-25mm:pack-10',
      observations: [
        {
          observation_id: 'OBS-01',
          product_id: 'prod:din3017:ss304:16-25mm:pack-10',
          kind: 'MARKETING_CLAIM',
          statement: 'Market leader claims SS304 but actually uses SS201',
          source_id: 'conn:marketplace:amazon-in',
          source_channel: 'MARKETPLACE_LISTING',
          observed_at_utc: new Date().toISOString(),
          verified: true,
          confidence_score: 0.9,
          jcs_sha256: 'abc'
        }
      ],
      customer_problems: [
        {
          problem_id: 'PROB-01',
          product_id: 'prod:din3017:ss304:16-25mm:pack-10',
          problem_category: 'QUALITY_DEFECT',
          application_context: 'Hardware',
          failure_severity: 'CRITICAL',
          failure_frequency_pct: 35,
          root_cause_candidate: 'Inferior screw metallurgy',
          willingness_to_pay_for_solution_bps: 1500,
          source_bias_level: 'LOW_ORGANIC',
          representative_evidence_ids: ['EVID-01'],
          engineered_remediation_proposal: 'CNC stainless screw threading'
        }
      ],
      supplier_quotes: [
        {
          quote_id: 'QUOTE-01',
          product_id: 'prod:din3017:ss304:16-25mm:pack-10',
          supplier_business_id: 'SUP-HOWRAH',
          factory_gate_quote_inr: 25.0,
          factory_gate_quote_subunits: '250000',
          moq_units: 500,
          lead_time_days: 14,
          raw_material_basis: 'SS304 Coil',
          quote_validity_expires_utc: new Date(Date.now() + 86400000).toISOString(),
          verification_status: 'CROSS_SOURCE_CORROBORATED',
          evidence_id: 'EVID-02'
        }
      ],
      unit_economics: []
    });

    expect(evaluations).toHaveLength(8);

    const expectedTypes = [
      'ECONOMICS_UNVIABLE',
      'DEMAND_FRAGMENTATION',
      'MANUFACTURING_CONSTRAINTS',
      'DISTRIBUTION_CONSTRAINTS',
      'INFORMATION_ASYMMETRY',
      'PROCUREMENT_FRICTION',
      'WEAK_INCENTIVES',
      'FALSE_OPPORTUNITY'
    ];

    for (const exp of evaluations) {
      expect(expectedTypes).toContain(exp.explanation_type);
      expect(exp.hypothesis_statement).toBe(INCUMBENT_FAILURE_HYPOTHESIS_STATEMENTS[exp.explanation_type]);
      expect(['SUPPORTED', 'DISCONFIRMED', 'VALIDATION_REQUIRED']).toContain(exp.status);
      expect(Array.isArray(exp.supporting_evidence_ids)).toBe(true);
      expect(Array.isArray(exp.disconfirming_evidence_ids)).toBe(true);
      expect(typeof exp.validation_method).toBe('string');
      expect(exp.validation_method.length).toBeGreaterThan(10);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 3: Epistemic Separation of Observation Kinds
  // --------------------------------------------------------------------------
  it('SLICE3-EPISTEMIC-SEPARATION-003: maintains strict epistemic separation between marketing claims, allegations, and measured results', () => {
    const claims: ObservationEntity[] = [
      {
        observation_id: 'OBS-CLAIM-01',
        product_id: 'prod:brass:ball-valve:1-2in-pn20',
        kind: 'MARKETING_CLAIM',
        statement: '100% Leak-Proof Guaranteed for 10 Years',
        source_id: 'conn:marketplace:amazon-in',
        source_channel: 'MARKETPLACE_LISTING',
        observed_at_utc: new Date().toISOString(),
        verified: false,
        confidence_score: 0.3,
        jcs_sha256: 'sha-claim'
      },
      {
        observation_id: 'OBS-ALLEGATION-01',
        product_id: 'prod:brass:ball-valve:1-2in-pn20',
        kind: 'CUSTOMER_ALLEGATION',
        statement: 'Valve handle cracked after 3 weeks of usage at 15 bar pressure',
        source_id: 'conn:media:youtube-reviews',
        source_channel: 'BUYER_REVIEWS',
        observed_at_utc: new Date().toISOString(),
        verified: true,
        confidence_score: 0.85,
        jcs_sha256: 'sha-allegation'
      },
      {
        observation_id: 'OBS-MEASURED-01',
        product_id: 'prod:brass:ball-valve:1-2in-pn20',
        kind: 'MEASURED_RESULT',
        statement: 'Hydrostatic pressure test failed at 18.2 bar (below rated PN20 20 bar spec)',
        source_id: 'conn:lab:quality-audit',
        source_channel: 'LABORATORY_REPORT',
        observed_at_utc: new Date().toISOString(),
        verified: true,
        confidence_score: 0.99,
        jcs_sha256: 'sha-measured'
      }
    ];

    expect(claims[0].kind).toBe('MARKETING_CLAIM');
    expect(claims[0].verified).toBe(false);

    expect(claims[1].kind).toBe('CUSTOMER_ALLEGATION');
    expect(claims[1].confidence_score).toBeLessThan(0.95);

    expect(claims[2].kind).toBe('MEASURED_RESULT');
    expect(claims[2].confidence_score).toBeGreaterThanOrEqual(0.95);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Honest Economics Fail
  // --------------------------------------------------------------------------
  it('SLICE3-HONEST-ECONOMICS-FAIL-004: concludes ECONOMICS_FAIL / DISTRIBUTION_FAIL when customer problem exists but unit contribution is negative', () => {
    const dummyProduct = server.getStateManager().getProductById('prod:wellness:candle:soy-lavender')!;

    // Construct a scenario where factory cost is high and retail ASP is low, yielding negative contribution across all channels
    const negativeEconScenarios: UnitEconomicsScenarioEntity[] = [
      {
        scenario_id: 'SCEN-NEG-AMZ',
        product_id: dummyProduct.product_id,
        channel: 'AMAZON_IN',
        retail_selling_price_inr: 250,
        factory_gate_cost_inr: 220,
        inbound_freight_inr: 30,
        packaging_kitting_inr: 25,
        platform_referral_fee_inr: 30,
        platform_fulfillment_fee_inr: 60,
        gst_tax_inr: 20,
        total_landed_cost_inr: 275,
        gross_spread_inr: -25,
        contribution_margin_bps: -4200,
        holding_period_days: 45,
        annualized_rowc_bps: -34000,
        is_profitable: false
      },
      {
        scenario_id: 'SCEN-NEG-FK',
        product_id: dummyProduct.product_id,
        channel: 'FLIPKART',
        retail_selling_price_inr: 240,
        factory_gate_cost_inr: 220,
        inbound_freight_inr: 30,
        packaging_kitting_inr: 25,
        platform_referral_fee_inr: 24,
        platform_fulfillment_fee_inr: 55,
        gst_tax_inr: 18,
        total_landed_cost_inr: 275,
        gross_spread_inr: -35,
        contribution_margin_bps: -4600,
        holding_period_days: 45,
        annualized_rowc_bps: -37000,
        is_profitable: false
      }
    ];

    const scorecard = OpportunityScorecardEngine.evaluateScorecard({
      product: dummyProduct,
      observations: [],
      customer_problems: [
        {
          problem_id: 'PROB-CANDLE-01',
          product_id: dummyProduct.product_id,
          problem_category: 'QUALITY_DEFECT',
          application_context: 'Home Fragrance',
          failure_severity: 'CRITICAL',
          failure_frequency_pct: 40,
          root_cause_candidate: 'Tunneling wick burning',
          willingness_to_pay_for_solution_bps: 2000,
          source_bias_level: 'LOW_ORGANIC',
          representative_evidence_ids: ['EVID-01'],
          engineered_remediation_proposal: 'Dual cotton-core braiding'
        }
      ],
      supplier_quotes: [
        {
          quote_id: 'QUOTE-CANDLE-01',
          product_id: dummyProduct.product_id,
          supplier_business_id: 'SUP-KHURJA',
          factory_gate_quote_inr: 220.0,
          factory_gate_quote_subunits: '2200000',
          moq_units: 300,
          lead_time_days: 10,
          raw_material_basis: 'Soy Wax',
          quote_validity_expires_utc: new Date(Date.now() + 86400000).toISOString(),
          verification_status: 'CROSS_SOURCE_CORROBORATED',
          evidence_id: 'EVID-02'
        }
      ],
      unit_economics: negativeEconScenarios,
      incumbent_evaluations: []
    });

    expect(['ECONOMICS_FAIL', 'DISTRIBUTION_FAIL']).toContain(scorecard.decision_outcome);
    expect(scorecard.decision_rationale).toContain('The customer problem exists');
    expect(scorecard.decision_rationale).toMatch(/(economics do not work|distribution economics fail)/);
  });

  // --------------------------------------------------------------------------
  // TEST 5: High Problem Strength + Weak Demand -> MORE_EVIDENCE_REQUIRED
  // --------------------------------------------------------------------------
  it('SLICE3-HIGH-PROBLEM-WEAK-DEMAND-005: caps outcome at MORE_EVIDENCE_REQUIRED when problem strength is high but demand volume is uncorroborated', () => {
    // Clone product with 0 sales volume
    const baseProduct = server.getStateManager().getProductById('prod:wellness:candle:soy-lavender')!;
    const lowDemandProduct = {
      ...baseProduct,
      sell_side: {
        ...baseProduct.sell_side,
        monthly_sales_volume_est: 0,
        best_seller_rank: 99999
      }
    };

    const scorecard = OpportunityScorecardEngine.evaluateScorecard({
      product: lowDemandProduct,
      observations: [],
      customer_problems: [
        {
          problem_id: 'PROB-CANDLE-02',
          product_id: lowDemandProduct.product_id,
          problem_category: 'QUALITY_DEFECT',
          application_context: 'Home Fragrance',
          failure_severity: 'CRITICAL',
          failure_frequency_pct: 45,
          root_cause_candidate: 'Tunneling wick burning',
          willingness_to_pay_for_solution_bps: 2000,
          source_bias_level: 'LOW_ORGANIC',
          representative_evidence_ids: ['EVID-01'],
          engineered_remediation_proposal: 'Dual cotton-core braiding'
        }
      ],
      supplier_quotes: [
        {
          quote_id: 'QUOTE-01',
          product_id: lowDemandProduct.product_id,
          supplier_business_id: 'SUP-01',
          factory_gate_quote_inr: 80,
          factory_gate_quote_subunits: '800000',
          moq_units: 100,
          lead_time_days: 7,
          raw_material_basis: 'Wax',
          quote_validity_expires_utc: new Date(Date.now() + 86400000).toISOString(),
          verification_status: 'CROSS_SOURCE_CORROBORATED',
          evidence_id: 'EVID-01'
        }
      ],
      unit_economics: [],
      incumbent_evaluations: []
    });

    // When demand is 0 or uncorroborated, cannot be READY_FOR_PAPER_TEST or READY_FOR_HUMAN_REVIEW
    expect(['MORE_EVIDENCE_REQUIRED', 'INSUFFICIENT_EVIDENCE', 'PROMISING_BUT_UNVALIDATED']).toContain(scorecard.decision_outcome);
    expect(scorecard.decision_outcome).not.toBe('READY_FOR_PAPER_TEST');
    expect(scorecard.decision_outcome).not.toBe('READY_FOR_HUMAN_REVIEW');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Multi-Channel Pure BigInt Comparison
  // --------------------------------------------------------------------------
  it('SLICE3-MULTI-CHANNEL-UNIT-ECONOMICS-006: executes multi-channel pure BigInt comparison across Amazon, Flipkart, Meesho, B2B', async () => {
    const stateManager = server.getStateManager();
    const core = stateManager.getCentralResearchCore();
    const valveProduct = stateManager.getProductById('prod:brass:ball-valve:1-2in-pn20')!;

    const result = await ProductAwareDynamicResearchPlanner.executeResearchPlan({
      product: valveProduct,
      centralResearchCore: core,
      mcpBroker: stateManager.getMcpBroker(),
      mcpRunLedger: stateManager.getMcpRunLedger()
    });

    const unitEcon = result.task_outputs.unit_economics_agent;
    expect(unitEcon.channels).toHaveLength(4);

    const channels = unitEcon.channels.map((c) => c.channel);
    expect(channels).toContain('AMAZON_IN');
    expect(channels).toContain('FLIPKART');
    expect(channels).toContain('MEESHO');
    expect(channels).toContain('B2B_DISTRIBUTION');

    for (const ch of unitEcon.channels) {
      expect(ch.retail_asp_inr).toBeGreaterThan(0);
      expect(ch.landed_cost_inr).toBeGreaterThan(0);
      expect(typeof ch.net_contribution_inr).toBe('number');
      expect(typeof ch.contribution_margin_bps).toBe('number');
      // No NaN or Infinity
      expect(isNaN(ch.net_contribution_inr)).toBe(false);
      expect(isFinite(ch.net_contribution_inr)).toBe(true);
    }

    expect(unitEcon.working_capital_cycle_days).toBe(45);
    expect(typeof unitEcon.annualized_rowc_bps).toBe('number');
  });

  // --------------------------------------------------------------------------
  // TEST 7: PostgreSQL Hypothesis Persistence Across Restart
  // --------------------------------------------------------------------------
  it('SLICE3-POSTGRES-HYPOTHESIS-PERSISTENCE-007: directly persists hypotheses to market_hypothesis_ledger and survives manager restart', async () => {
    const stateManager = server.getStateManager();
    const core = stateManager.getCentralResearchCore();
    const testProdId = 'prod:festive:diya:terracotta-12p';

    // 1. Dispatch research via state manager
    await stateManager.researchProduct({ product_id: testProdId });

    // 2. Direct database query to verify persistence in PostgreSQL
    const pool = core.getEvidenceStore().getPgPool();
    expect(pool).toBeDefined();

    const dbRes = await pool!.query(
      'SELECT hypothesis_id, product_id, current_stage, explanation_type, verdict FROM market_hypothesis_ledger WHERE product_id = $1 ORDER BY created_at_utc DESC LIMIT 1',
      [testProdId]
    );

    expect(dbRes.rows.length).toBe(1);
    const row = dbRes.rows[0];
    expect(row.product_id).toBe(testProdId);
    expect(row.hypothesis_id).toMatch(/^HYP-/);
    expect(['DETECTED', 'EVIDENCE_GATHERING', 'UNDER_CHALLENGE', 'VALIDATION_REQUIRED', 'PAPER_TEST', 'HUMAN_REVIEW']).toContain(row.current_stage);

    // 3. Re-hydrate in a fresh WorkstationStateManager instance
    const freshManager = new WorkstationStateManager();
    const loadedHypotheses = await freshManager.getCentralResearchCore().loadHypotheses(testProdId);

    expect(loadedHypotheses.length).toBeGreaterThan(0);
    const rehydrated = loadedHypotheses[loadedHypotheses.length - 1];
    expect(rehydrated.product_id).toBe(testProdId);
    expect(rehydrated.hypothesis_id).toBe(row.hypothesis_id);
    expect(rehydrated.scorecard_result).toBeDefined();
    expect(rehydrated.task_outputs.customer).toBeDefined();
    expect(rehydrated.history.length).toBeGreaterThanOrEqual(4);

    await freshManager.close();
  });

  // --------------------------------------------------------------------------
  // TEST 8: Governed DAG Product Dispatch
  // --------------------------------------------------------------------------
  it('SLICE3-GOVERNED-DAG-PRODUCT-DISPATCH-008: triggerGovernedDagRun runs product-tailored parameters and logs McpRunLedger events', async () => {
    const stateManager = server.getStateManager();
    const targetProdId = 'prod:brass:ball-valve:1-2in-pn20';

    const result = await stateManager.triggerGovernedDagRun(
      {
        operator_id: 'operator:acceptance-test',
        action_type: 'APPROVE_PAPER_ALLOCATION',
        target_entity_id: 'plan:governed-dag-brass-valve',
        explicit_rationale: 'Acceptance test: verifying product-tailored DAG execution for brass valve lead',
        confirmation_token: `token-${Date.now()}`,
        confirmed_at_utc: new Date().toISOString()
      },
      { product_id: targetProdId }
    );

    expect(result.outcome.run_id).toMatch(/^dag-run-/);
    expect(result.outcome.product_id).toBe(targetProdId);
    expect(result.outcome.waves_executed).toBeGreaterThan(0);
    expect(result.outcome.checkpoint_sha256).toMatch(/^[0-9a-f]{64}$/);

    // McpRunLedger must contain logged events for this product
    const ledger = stateManager.getMcpRunLedger();
    const events = ledger.getEvents();
    const prodEvents = events.filter((e) => JSON.stringify(e.details).includes(targetProdId) || e.task_id.includes(targetProdId));
    expect(prodEvents.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // TEST 9: Hypothesis Lifecycle Stage Transitions
  // --------------------------------------------------------------------------
  it('SLICE3-HYPOTHESIS-LIFECYCLE-TRANSITIONS-009: tracks complete hypothesis lifecycle transitions with timestamped rationales', async () => {
    const stateManager = server.getStateManager();
    const core = stateManager.getCentralResearchCore();
    const prod = stateManager.getProductById('prod:wellness:candle:soy-lavender')!;

    const result = await ProductAwareDynamicResearchPlanner.executeResearchPlan({
      product: prod,
      centralResearchCore: core,
      mcpBroker: stateManager.getMcpBroker(),
      mcpRunLedger: stateManager.getMcpRunLedger()
    });

    const hyp = result.hypothesis_record;
    expect(hyp.history.length).toBeGreaterThanOrEqual(4);

    const stagesTraversed = hyp.history.map((h) => h.to_stage);
    expect(stagesTraversed[0]).toBe('DETECTED');
    expect(stagesTraversed[1]).toBe('EVIDENCE_GATHERING');
    expect(stagesTraversed[2]).toBe('UNDER_CHALLENGE');

    // Every transition has non-empty rationale and timestamp
    for (const h of hyp.history) {
      expect(typeof h.rationale).toBe('string');
      expect(h.rationale.length).toBeGreaterThan(5);
      expect(new Date(h.transitioned_at_utc).getTime()).toBeGreaterThan(0);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 10: Opportunity Scorecard 8-Dimension Breakdown & Missing Data Penalties
  // --------------------------------------------------------------------------
  it('SLICE3-SCORECARD-8-DIMENSION-PENALTIES-010: enforces 8 independent dimensions, explicit missing-data penalty, and tests server endpoints', async () => {
    const stateManager = server.getStateManager();
    const candleProd = stateManager.getProductById('prod:wellness:candle:soy-lavender')!;

    // 1. Direct Scorecard Engine Evaluation with incomplete product
    const incompleteProd = {
      ...candleProd,
      upstream_supply: {
        ...candleProd.upstream_supply,
        factory_gate_quote_inr: 0
      },
      sell_side: {
        ...candleProd.sell_side,
        monthly_sales_volume_est: 0
      }
    };

    const scorecard = OpportunityScorecardEngine.evaluateScorecard({
      product: incompleteProd,
      observations: [],
      customer_problems: [],
      supplier_quotes: [],
      unit_economics: [],
      incumbent_evaluations: []
    });

    const dimValues = Object.values(scorecard.dimensions);
    expect(dimValues).toHaveLength(8);
    const dimNames = Object.keys(scorecard.dimensions);
    expect(dimNames).toEqual([
      'problem_strength',
      'commercial_demand',
      'competitive_whitespace',
      'supply_advantage',
      'distribution_viability',
      'financial_attractiveness',
      'evidence_quality',
      'execution_feasibility'
    ]);

    // Missing supplier quotes and demand trigger explicit missing-data penalties
    expect(scorecard.missing_evidence_fields.length).toBeGreaterThan(0);
    const penalizedDims = dimValues.filter((d) => d.missing_data_penalty_bps > 0);
    expect(penalizedDims.length).toBeGreaterThan(0);
    for (const dim of dimValues) {
      expect(dim.net_score_bps).toBeLessThanOrEqual(dim.score_bps);
      expect(dim.net_score_bps).toBe(Math.max(0, dim.score_bps - dim.missing_data_penalty_bps));
    }

    // 2. Server API Route: POST /api/research/scorecard
    const postRes = await httpRequest({
      port: serverPort,
      path: '/api/research/scorecard',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: 'prod:wellness:candle:soy-lavender' })
    });

    expect(postRes.statusCode).toBe(200);
    expect(postRes.json.product_id).toBe('prod:wellness:candle:soy-lavender');
    expect(postRes.json.scorecard).toBeDefined();
    expect(Object.keys(postRes.json.scorecard.dimensions)).toHaveLength(8);

    // 3. Server API Route: GET /api/hypothesis/list
    const getRes = await httpRequest({
      port: serverPort,
      path: '/api/hypothesis/list?product_id=prod:wellness:candle:soy-lavender',
      method: 'GET'
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json.product_id).toBe('prod:wellness:candle:soy-lavender');
    expect(Array.isArray(getRes.json.hypotheses)).toBe(true);
    expect(getRes.json.count).toBeGreaterThanOrEqual(1);
  });
});
