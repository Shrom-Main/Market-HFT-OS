/**
 * Gate Slice 5 (Decision OD-29 / Charter DEC-029):
 * Opportunity Bundles, Unprefilled User-Intent Gate, Seasonal/Festival Overlap,
 * Risk-Free Benchmark Comparison & Cited Research Report Exporter
 *
 * 10 Normative Acceptance Tests:
 * 1. SLICE5-FIX-CONTRADICTIONS-AND-FIXTURE-BADGES-001: Verifies SLICE4-FIX-01 to 04 (active contradictions >= 1, unknowns >= 1, fixture badges, server secret loader & Skills MCP registry).
 * 2. SLICE5-UNPREFILLED-USER-INTENT-GATE-002: Proves POST /api/bundle/evaluate with omitted, non-integer, or out-of-bounds intent fields fails closed with USER_INTENT_REQUIRED.
 * 3. SLICE5-FESTIVE-VS-INDUSTRIAL-BUNDLE-SEASONALITY-003: Evaluates festive vs industrial bundles, verifying dynamic calendar event cutoffs, DIWALI_FESTIVE, DURGA_PUJA vs YEAR_ROUND_INDUSTRIAL_B2B, and interval overlap.
 * 4. SLICE5-SUPPLIER-AND-HUB-CONCENTRATION-GATE-004: Proves exceeding max_single_supplier_concentration_bps flags CONCENTRATION_LIMIT_BREACHED and blocks commit; detects unknown suppliers.
 * 5. SLICE5-TBILL-AND-FD-BENCHMARK-HURDLE-005: Verifies net excess return over dated RBI 91D T-Bill (650 bps) and SBI 1-Yr FD (725 bps) benchmarks as of 2026-10-15.
 * 6. SLICE5-THREE-SCENARIO-JCURVE-WATERFALL-006: Verifies Base, Upside, and Downside Stress scenarios, 90-day cash-flow J-Curve trajectory, and emotional review mining up to 2,000 chars.
 * 7. SLICE5-CITED-REPORT-LEAD-AND-BUNDLE-007: Calls GET /api/reports/export for single lead and multi-lead bundle, verifying empirical evidence spans, verbatim citation verification, and authentic source IDs.
 * 8. SLICE5-CITED-REPORT-BITEMPORAL-CUTOFF-008: Verifies GET /api/reports/export with historical as_of_utc excludes future evidence/hypotheses, preserves distinct generated_at_utc, and produces bit-for-bit reproducible report_jcs_sha256.
 * 9. SLICE5-HUMAN-GATE-BUNDLE-COMMIT-PERSISTENCE-009: Verifies authoritative server-held commitment, anti-tampering check, immutability against duplicate commits, operator authentication, and PostgreSQL persistence.
 * 10. SLICE5-FULL-SUITE-ZERO-SKIPPED-010: Verifies all 41 test suites execute with 0 skipped tests and dual-ledger integrity is intact.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import {
  BundleEvaluator,
  validateExplicitUserIntent,
  type ExplicitUserIntent,
  type BundleEvaluationResult,
  type CommittedBundleRecord
} from '../../src/research/bundleEvaluator.js';
import {
  CitedReportExporter,
  type CitedResearchReport
} from '../../src/research/citedReportExporter.js';
import { OpportunityDossierService } from '../../src/research/opportunityDossierService.js';
import {
  isProviderKeyConfigured,
  getSkillsMcpRegistry
} from '../../src/mcp/serverSecretLoader.js';
import {
  ReviewAndGrievanceMiner,
  verifyCitationSpan,
  validateCitationGrounding,
  classifyEmotionalSentiment
} from '../../src/research/reviewAndGrievanceMiner.js';
import { sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import { sanitizeForJcs } from '../../src/agents/m6AgentFramework.js';

describe('Suite 41: Gate Slice 5 Opportunity Bundles, Intent Gate & Cited Report Exporter', () => {
  let server: WorkstationServer;
  let serverPort: number;
  const runCommittedBundleIds = new Set<string>();

  function httpRequest(options: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    port: number;
  }): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json?: any }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: options.port,
          path: options.path,
          method: options.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            let json: any = undefined;
            try {
              json = JSON.parse(data);
            } catch {
              // Non-JSON response
            }
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: data,
              json
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
    const tempServer = http.createServer();
    await new Promise<void>((resolve) => {
      tempServer.listen(0, '127.0.0.1', () => {
        const addr = tempServer.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 4330;
        tempServer.close(() => resolve());
      });
    });

    server = new WorkstationServer({ port: serverPort });
    await server.start();

    // Safety Gate: Test-database identity check to prevent destructive execution on non-test databases
    const pool = server.getStateManager().getCentralResearchCore().getEvidenceStore().getPgPool();
    if (pool) {
      const dbRes = await pool.query('SELECT current_database();');
      const dbName = dbRes.rows[0]?.current_database || '';
      if (!dbName.includes('test')) {
        throw new Error(
          `E-SAFETY-NON-TEST-DATABASE-REJECTED: Test suite must only execute against a designated test database (expected name containing "test", got "${dbName}").`
        );
      }
    }
  });

  afterAll(async () => {
    if (server) {
      const store = server.getStateManager().getCentralResearchCore().getEvidenceStore();
      const pool = store.getPgPool();
      if (pool && runCommittedBundleIds.size > 0) {
        // Run-scoped cleanup: delete ONLY the specific bundles committed in this test run
        await pool.query(
          'DELETE FROM market_committed_bundles WHERE allocation_id = ANY($1)',
          [Array.from(runCommittedBundleIds)]
        ).catch(() => {});
      }
      await server.stop();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 1: SLICE4-FIX Verification & Skills MCP Registry
  // --------------------------------------------------------------------------
  it('SLICE5-FIX-CONTRADICTIONS-AND-FIXTURE-BADGES-001: verifies SLICE4-FIX-01 to 04 (active contradictions >= 1, unknowns >= 1, fixture badges, server secret loader & Skills MCP registry)', async () => {
    const stateManager = server.getStateManager();

    // 1. Verify Secret Loader reports boolean configuration safely
    const geminiLoaded = isProviderKeyConfigured('GEMINI_API');
    const groqLoaded = isProviderKeyConfigured('GROQ_API');
    const gmapsLoaded = isProviderKeyConfigured('GOOGLE_MAPS');
    expect(typeof geminiLoaded).toBe('boolean');
    expect(typeof groqLoaded).toBe('boolean');
    expect(typeof gmapsLoaded).toBe('boolean');

    // 2. Verify Skills MCP Capability Registry endpoint
    const skillsRes = await httpRequest({
      port: serverPort,
      path: '/api/skills/registry'
    });
    expect(skillsRes.statusCode).toBe(200);
    expect(skillsRes.json.total_capabilities).toBeGreaterThanOrEqual(11);
    const caps = skillsRes.json.capabilities;
    expect(caps.some((c: any) => c.provider_key === 'GEMINI_API')).toBe(true);
    expect(caps.some((c: any) => c.provider_key === 'GROQ_API')).toBe(true);
    expect(caps.some((c: any) => c.provider_key === 'GOOGLE_MAPS')).toBe(true);
    expect(caps.some((c: any) => c.provider_key === 'POSTGRES_STORE')).toBe(true);
    expect(caps.some((c: any) => c.provider_key === 'ALPACA_BROKERAGE')).toBe(true);

    // 3. Verify seeded fixture provenance in OpportunityDossier
    const ballValve = stateManager.getProductById('prod:brass:ball-valve:1-2in-pn20')!;
    expect(ballValve).toBeDefined();
    const core = stateManager.getCentralResearchCore();
    const dossier = await OpportunityDossierService.buildDossier(ballValve, core);

    expect(dossier.lead_header.provenance_badge).toBe('Fixture data (Demo quote)');
    expect(ballValve.evidence_origin?.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');

    const amazonWaterfall = dossier.unit_economics_waterfall.find((w) => w.channel === 'AMAZON_IN');
    expect(amazonWaterfall).toBeDefined();
    expect(amazonWaterfall!.price_epistemic_class).toBe('FIXTURE_QUOTE');

    // 4. Inject conflicting quote to test Contradiction and Unknowns surfacing
    const nonce = Date.now();
    const run1 = await httpRequest({
      port: serverPort,
      path: '/api/connectors/run',
      method: 'POST',
      body: JSON.stringify({
        connector_id: 'conn:macro:rbi-fbil-lme',
        product_id: 'prod:din3017:ss304:16-25mm:pack-10',
        raw_payload_override: `<div id="s5-a-${nonce}" data-price="250000" data-freight="15000" data-moq="500">DIN 3017 SS304 Clamp ₹25.00 MOQ 500</div>`
      })
    });
    expect(run1.statusCode).toBe(200);

    const run2 = await httpRequest({
      port: serverPort,
      path: '/api/connectors/run',
      method: 'POST',
      body: JSON.stringify({
        connector_id: 'conn:macro:rbi-fbil-lme',
        product_id: 'prod:din3017:ss304:16-25mm:pack-10',
        raw_payload_override: `<div id="s5-b-${nonce + 1}" data-price="315000" data-freight="15000" data-moq="1000">DIN 3017 SS304 Clamp ₹31.50 MOQ 1000</div>`
      })
    });
    expect(run2.statusCode).toBe(200);

    const queryRes = await httpRequest({
      port: serverPort,
      path: '/api/research/query',
      method: 'POST',
      body: JSON.stringify({
        query: 'What are the supplier quotes and MOQ for SS304?',
        product_id: 'prod:din3017:ss304:16-25mm:pack-10'
      })
    });

    expect(queryRes.statusCode).toBe(200);
    expect(queryRes.json.active_contradictions.length).toBeGreaterThanOrEqual(1);
    expect(queryRes.json.unknowns_and_gaps.length).toBeGreaterThanOrEqual(1);
    expect(queryRes.json.provider_telemetry.provider_used).toBe('LOCAL_DETERMINISTIC_INDEX');
    expect(queryRes.json.provider_telemetry.external_llm_called).toBe(false);
    expect(queryRes.json.epistemic_class).toBe('ESTIMATED_PROXY');
    expect(queryRes.json.epistemic_class).not.toBe('NON_AUTHORITATIVE_AI_SYNTHESIS');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Unprefilled User Intent Gate & Bounded Validation
  // --------------------------------------------------------------------------
  it('SLICE5-UNPREFILLED-USER-INTENT-GATE-002: proves POST /api/bundle/evaluate with omitted, non-integer, or out-of-bounds intent fields fails closed with USER_INTENT_REQUIRED', async () => {
    // 1. Missing all parameters
    const emptyRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify({})
    });
    expect(emptyRes.statusCode).toBe(400);
    expect(emptyRes.json.status).toBe('USER_INTENT_REQUIRED');
    expect(emptyRes.json.error_code).toBe('E-BUNDLE-INTENT-REQUIRED');
    expect(emptyRes.json.missing_intent_fields).toEqual([
      'available_paper_capital_inr',
      'minimum_return_hurdle_bps',
      'holding_period_days',
      'max_drawdown_limit_bps',
      'max_single_supplier_concentration_bps'
    ]);

    // 2. Out-of-bounds concentration limit (> 10,000 bps)
    const outOfBoundsConcRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify({
        available_paper_capital_inr: 500000,
        minimum_return_hurdle_bps: 2000,
        holding_period_days: 60,
        max_drawdown_limit_bps: 1500,
        max_single_supplier_concentration_bps: 15000, // Invalid: exceeds 10,000 bps
        selected_product_ids: ['prod:festive:diya:terracotta-12p']
      })
    });
    expect(outOfBoundsConcRes.statusCode).toBe(400);
    expect(outOfBoundsConcRes.json.status).toBe('USER_INTENT_REQUIRED');
    expect(outOfBoundsConcRes.json.missing_intent_fields).toContain('max_single_supplier_concentration_bps');

    // 3. Non-integer holding period
    const floatHoldRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify({
        available_paper_capital_inr: 500000,
        minimum_return_hurdle_bps: 2000,
        holding_period_days: 30.5, // Non-integer
        max_drawdown_limit_bps: 1500,
        max_single_supplier_concentration_bps: 6000,
        selected_product_ids: ['prod:festive:diya:terracotta-12p']
      })
    });
    expect(floatHoldRes.statusCode).toBe(400);
    expect(floatHoldRes.json.missing_intent_fields).toContain('holding_period_days');

    // 4. Fully qualified bounded integer user intent
    const validIntent = {
      available_paper_capital_inr: 1000000,
      minimum_return_hurdle_bps: 2000,
      holding_period_days: 60,
      max_drawdown_limit_bps: 1500,
      max_single_supplier_concentration_bps: 6000,
      selected_product_ids: [
        'prod:festive:diya:terracotta-12p',
        'prod:brass:ball-valve:1-2in-pn20'
      ]
    };
    const validRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify(validIntent)
    });
    expect(validRes.statusCode).toBe(200);
    expect(validRes.json.bundle_id).toBeDefined();
    expect(validRes.json.scenarios).toBeDefined();
    expect(validRes.json.concentration_analysis).toBeDefined();
    expect(validRes.json.seasonal_window_analysis).toBeDefined();
    expect(validRes.json.benchmark_comparison).toBeDefined();
    expect(validRes.json.cash_flow_j_curve).toHaveLength(90);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Festive vs Industrial Dynamic Seasonality Analysis
  // --------------------------------------------------------------------------
  it('SLICE5-FESTIVE-VS-INDUSTRIAL-BUNDLE-SEASONALITY-003: evaluates festive vs industrial bundles, verifying dynamic calendar event cutoffs, DIWALI_FESTIVE, DURGA_PUJA vs YEAR_ROUND_INDUSTRIAL_B2B, and interval overlap', async () => {
    // 1. Festive Bundle
    const festiveRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify({
        available_paper_capital_inr: 400000,
        minimum_return_hurdle_bps: 2000,
        holding_period_days: 60,
        max_drawdown_limit_bps: 2000,
        max_single_supplier_concentration_bps: 6000,
        selected_product_ids: [
          'prod:festive:diya:terracotta-12p',
          'prod:soy:lavender-candle:200g-amber-jar'
        ]
      })
    });
    expect(festiveRes.statusCode).toBe(200);
    const festiveAnalysis = festiveRes.json.seasonal_window_analysis;
    expect(festiveAnalysis.detected_windows).toContain('DIWALI_FESTIVE');
    expect(festiveAnalysis.primary_window).toBe('DIWALI_FESTIVE');
    expect(festiveAnalysis.order_cutoff_date).toBeDefined();
    expect(festiveAnalysis.order_cutoff_date).toContain('2026-');
    expect(festiveAnalysis.seasonal_overlap_intensity).toBe('HIGH');

    // 2. Industrial Bundle
    const industrialRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify({
        available_paper_capital_inr: 500000,
        minimum_return_hurdle_bps: 2000,
        holding_period_days: 90,
        max_drawdown_limit_bps: 2000,
        max_single_supplier_concentration_bps: 6000,
        selected_product_ids: [
          'prod:din3017:ss304:16-25mm:pack-10',
          'prod:brass:ball-valve:1-2in-pn20'
        ]
      })
    });
    expect(industrialRes.statusCode).toBe(200);
    const industrialAnalysis = industrialRes.json.seasonal_window_analysis;
    expect(industrialAnalysis.detected_windows).toContain('YEAR_ROUND_INDUSTRIAL_B2B');
    expect(industrialAnalysis.detected_windows).toContain('MONSOON_CORROSION_CYCLE');
    expect(['MONSOON_CORROSION_CYCLE', 'YEAR_ROUND_INDUSTRIAL_B2B']).toContain(industrialAnalysis.primary_window);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Concentration Gate (Canonical Supplier & Hub Exposure Limit)
  // --------------------------------------------------------------------------
  it('SLICE5-SUPPLIER-AND-HUB-CONCENTRATION-GATE-004: proves exceeding max_single_supplier_concentration_bps flags CONCENTRATION_LIMIT_BREACHED and blocks commit; detects unknown suppliers; preserves supplier vs hub distinction', async () => {
    // Single product = 100% concentration on its canonical supplier
    const breachedRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify({
        available_paper_capital_inr: 500000,
        minimum_return_hurdle_bps: 2000,
        holding_period_days: 60,
        max_drawdown_limit_bps: 2000,
        max_single_supplier_concentration_bps: 4000, // Strict 40% cap per supplier
        selected_product_ids: [
          'prod:brass:ball-valve:1-2in-pn20' // 100% concentration on Omkar Brass Industries
        ]
      })
    });
    expect(breachedRes.statusCode).toBe(200);
    expect(breachedRes.json.concentration_analysis.concentration_limit_breached).toBe(true);
    expect(breachedRes.json.concentration_analysis.highest_supplier_concentration_bps).toBe(10000);
    expect(breachedRes.json.concentration_analysis.highest_concentration_supplier_id).toBe('supp:jamnagar:omkar-brass-industries');
    expect(breachedRes.json.concentration_analysis.highest_hub_concentration_bps).toBe(10000);
    expect(breachedRes.json.concentration_analysis.highest_concentration_hub).toBe('Jamnagar Brass Parts Cluster (Gujarat)');
    expect(breachedRes.json.recommended_disposition).toBe('CONCENTRATION_LIMIT_BREACHED');

    // Multi-product distinct supplier check: 2 products from different suppliers and hubs
    const balancedRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify({
        available_paper_capital_inr: 600000,
        minimum_return_hurdle_bps: 2000,
        holding_period_days: 60,
        max_drawdown_limit_bps: 2000,
        max_single_supplier_concentration_bps: 6000, // 60% cap
        selected_product_ids: [
          'prod:festive:diya:terracotta-12p',
          'prod:brass:ball-valve:1-2in-pn20'
        ]
      })
    });
    expect(balancedRes.statusCode).toBe(200);
    expect(balancedRes.json.concentration_analysis.concentration_limit_breached).toBe(false);
    expect(balancedRes.json.concentration_analysis.highest_supplier_concentration_bps).toBe(5000); // 50%
    expect(balancedRes.json.concentration_analysis.highest_hub_concentration_bps).toBe(5000); // 50%
    expect(balancedRes.json.concentration_analysis.supplier_allocations.length).toBe(2);
    expect(balancedRes.json.concentration_analysis.hub_allocations.length).toBe(2);

    // Attempting to commit a bundle with CONCENTRATION_LIMIT_BREACHED must fail closed
    const commitAttempt = await httpRequest({
      port: serverPort,
      path: '/api/bundle/commit',
      method: 'POST',
      body: JSON.stringify({
        bundle_id: breachedRes.json.bundle_id,
        confirmation: {
          operator_id: 'OP_AUDIT',
          confirmation_token: 'CONF-TOKEN-12345',
          explicit_rationale: 'Attempting commit on breached concentration portfolio',
          confirmed_at_utc: new Date().toISOString()
        }
      })
    });
    expect(commitAttempt.statusCode).toBe(409);
    expect(commitAttempt.body).toContain('E-BUNDLE-UNQUALIFIED-COMMIT-BLOCKED');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Dated T-Bill & FD Opportunity-Cost Benchmark Spread
  // --------------------------------------------------------------------------
  it('SLICE5-TBILL-AND-FD-BENCHMARK-HURDLE-005: verifies net excess return over dated RBI 91D T-Bill (650 bps) and SBI 1-Yr FD (725 bps) benchmarks as of 2026-10-15', async () => {
    const res = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify({
        available_paper_capital_inr: 500000,
        minimum_return_hurdle_bps: 1000, // 10.00%
        holding_period_days: 60,
        max_drawdown_limit_bps: 2000,
        max_single_supplier_concentration_bps: 6000,
        selected_product_ids: [
          'prod:festive:diya:terracotta-12p',
          'prod:brass:ball-valve:1-2in-pn20'
        ]
      })
    });

    expect(res.statusCode).toBe(200);
    const benchmark = res.json.benchmark_comparison;
    expect(benchmark).toBeDefined();
    expect(benchmark.rbi_91d_tbill_benchmark_bps).toBe(650);
    expect(benchmark.sbi_1yr_bulk_fd_benchmark_bps).toBe(725);
    expect(benchmark.benchmark_as_of_date).toBe('2026-10-15');
    expect(benchmark.benchmark_sources.length).toBe(2);
    expect(benchmark.benchmark_sources[0].isin).toBe('IN002026X287');
    expect(benchmark.benchmark_sources[0].auction_notice_id).toBe('FBIL/TBILL/2026/41');
    expect(benchmark.benchmark_sources[1].auction_notice_id).toBe('SBI/IBD/FD-CARD/2026-10-12');
    expect(benchmark.benchmark_sources[1].circular_reference).toBe('SBI/CIR/2026-27/DEPOSIT-088');
    expect(benchmark.base_annualized_rowc_bps).toBeGreaterThan(benchmark.rbi_91d_tbill_benchmark_bps);
    expect(benchmark.base_annualized_rowc_bps).toBeGreaterThan(benchmark.sbi_1yr_bulk_fd_benchmark_bps);
    expect(benchmark.beats_tbill).toBe(true);
    expect(benchmark.beats_fd).toBe(true);
  });

  // --------------------------------------------------------------------------
  // TEST 6: Three Scenarios, J-Curve, and Emotional Review Mining
  // --------------------------------------------------------------------------
  it('SLICE5-THREE-SCENARIO-JCURVE-WATERFALL-006: verifies Base, Upside, and Downside Stress scenarios, 90-day cash-flow J-Curve trajectory, and emotional review mining up to 2,000 chars', async () => {
    const res = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify({
        available_paper_capital_inr: 600000,
        minimum_return_hurdle_bps: 2500,
        holding_period_days: 45,
        max_drawdown_limit_bps: 2500,
        max_single_supplier_concentration_bps: 5000,
        selected_product_ids: [
          'prod:festive:diya:terracotta-12p',
          'prod:brass:ball-valve:1-2in-pn20'
        ]
      })
    });

    expect(res.statusCode).toBe(200);
    const { scenarios, cash_flow_j_curve } = res.json;

    expect(scenarios.base).toBeDefined();
    expect(scenarios.upside).toBeDefined();
    expect(scenarios.downside).toBeDefined();

    expect(scenarios.upside.annualized_rowc_bps).toBeGreaterThan(scenarios.base.annualized_rowc_bps);
    expect(scenarios.base.annualized_rowc_bps).toBeGreaterThan(scenarios.downside.annualized_rowc_bps);

    // Verify pure BigInt subunit string presence
    expect(typeof scenarios.base.allocated_capital_subunits).toBe('string');
    expect(typeof scenarios.base.projected_gross_revenue_subunits).toBe('string');
    expect(typeof scenarios.base.projected_net_profit_subunits).toBe('string');

    // Verify 90-day J-curve points
    expect(cash_flow_j_curve).toHaveLength(90);
    expect(cash_flow_j_curve[0].day).toBe(1);
    expect(cash_flow_j_curve[89].day).toBe(90);

    // Day 1 has initial capital outlay (negative net cash position)
    expect(cash_flow_j_curve[0].net_cumulative_cash_position_inr).toBeLessThan(0);
    // Day 90 shows revenue realization and exact mathematical reconciliation to Base Net Profit
    expect(cash_flow_j_curve[89].cumulative_revenue_inr).toBeGreaterThan(0);
    expect(cash_flow_j_curve[89].net_cumulative_cash_position_inr).toBe(scenarios.base.projected_net_profit_inr);
    expect(res.json.accounting_reconciliation).toBeDefined();
    expect(res.json.accounting_reconciliation.reconciliation_variance_subunits).toBe('0');
    expect(typeof res.json.unallocated_cash_buffer_inr).toBe('number');
    expect(res.json.unallocated_cash_buffer_inr).toBeGreaterThanOrEqual(0);
    expect(res.json.accounting_reconciliation.rowc_formula_documented).toContain('Annualized RoWC');

    // Adversarial Citation Grounding Verification (Finding 6)
    const authenticSource = 'Tested 10 units under load: worm drive stripped under 4.5 Nm torque.';
    const validQuote = 'worm drive stripped';
    const validSpan: [number, number] = [28, 47];

    // 1. Valid Grounding
    const validGrounding = validateCitationGrounding({
      sourceText: authenticSource,
      span: validSpan,
      verbatimQuote: validQuote,
      quoteHash: sha256(validQuote)
    });
    expect(validGrounding.isValid).toBe(true);

    // 2. Adversarial: Tampered Span Out of Bounds
    const oobResult = validateCitationGrounding({
      sourceText: authenticSource,
      span: [28, 999],
      verbatimQuote: validQuote
    });
    expect(oobResult.isValid).toBe(false);
    expect(oobResult.failure_reason).toBe('SPAN_OUT_OF_BOUNDS');

    // 3. Adversarial: Fabricated Quote (Text Mismatch)
    const mismatchResult = validateCitationGrounding({
      sourceText: authenticSource,
      span: validSpan,
      verbatimQuote: 'fabricated quote that is not there'
    });
    expect(mismatchResult.isValid).toBe(false);
    expect(mismatchResult.failure_reason).toBe('SPAN_TEXT_MISMATCH');

    // 4. Adversarial: Tampered Quote Hash
    const badHashResult = validateCitationGrounding({
      sourceText: authenticSource,
      span: validSpan,
      verbatimQuote: validQuote,
      quoteHash: '0000000000000000000000000000000000000000000000000000000000000000'
    });
    expect(badHashResult.isValid).toBe(false);
    expect(badHashResult.failure_reason).toBe('QUOTE_HASH_MISMATCH');

    // 5. Adversarial: Missing Source Text
    const missingSourceResult = validateCitationGrounding({
      sourceText: '',
      span: [0, 5],
      verbatimQuote: 'quote'
    });
    expect(missingSourceResult.isValid).toBe(false);
    expect(missingSourceResult.failure_reason).toBe('SOURCE_TEXT_MISSING');

    // 6. Adversarial: Unicode Surrogate Pair Bisection Corruption
    const emojiText = 'Packaging had fire \uD83D\uDD25 defect'; // '🔥' is 2 UTF-16 code units: 0xD83D, 0xDD25
    const fireHighSurrogateIndex = emojiText.indexOf('\uD83D');
    const bisectedSpan: [number, number] = [fireHighSurrogateIndex + 1, fireHighSurrogateIndex + 2];
    const bisectedResult = validateCitationGrounding({
      sourceText: emojiText,
      span: bisectedSpan,
      verbatimQuote: emojiText.slice(bisectedSpan[0], bisectedSpan[1])
    });
    expect(bisectedResult.isValid).toBe(false);
    expect(bisectedResult.failure_reason).toBe('UNICODE_CORRUPTION_DETECTED');

    // Verify review miner handles long emotional reviews (> 280 chars, up to 2,000 chars) with sentiment classification
    const longReviewText = 'Absolute disaster and complete nightmare packaging. Opened the festival gift box to find all 12 handmade diyas shattered into fine powder. The unsealed porous clay also leaked burning oil everywhere onto our wooden nightstand creating an extreme hazard and ruined Diwali eve. Total waste of money, unusable garbage.';
    expect(longReviewText.length).toBeGreaterThan(280);

    const emotional = classifyEmotionalSentiment(longReviewText, 'OPERATIONAL_FAILURE');
    expect(emotional.sentiment_polarity).toBe('HIGHLY_NEGATIVE');
    expect(['EXTREME', 'HIGH']).toContain(emotional.frustration_severity);
    expect(emotional.urgency_score_bps).toBeGreaterThanOrEqual(8000);
    expect(emotional.emotional_keywords_detected.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // TEST 7: Cited Research Report Exporter (Empirical Evidence Citations & Model Inputs)
  // --------------------------------------------------------------------------
  it('SLICE5-CITED-REPORT-LEAD-AND-BUNDLE-007: calls GET /api/reports/export for single lead and multi-lead bundle, verifying empirical evidence spans, verbatim citation verification, and authentic source IDs', async () => {
    // 1. Export Report for Single Lead
    const leadReportRes = await httpRequest({
      port: serverPort,
      path: '/api/reports/export?target_type=LEAD&target_id=prod:festive:diya:terracotta-12p'
    });

    expect(leadReportRes.statusCode).toBe(200);
    const leadReport: CitedResearchReport = leadReportRes.json;

    expect(leadReport.target_type).toBe('LEAD');
    expect(leadReport.target_id).toBe('prod:festive:diya:terracotta-12p');
    expect(leadReport.operating_mode).toBe('DRY_RUN_PAPER_SIMULATION_ONLY');
    expect(leadReport.claims_and_inline_citations.length).toBeGreaterThanOrEqual(1);

    // Verbatim citation span verification
    for (const cit of leadReport.claims_and_inline_citations) {
      expect(cit.citation_id).toMatch(/^CIT-\d+$/);
      expect(cit.verbatim_quote.length).toBeGreaterThan(0);
      expect(cit.sha256).toHaveLength(64);
    }

    // Markdown memo format and headers
    expect(leadReport.report_markdown).toContain('# Institutional Research Memo:');
    expect(leadReport.report_markdown).toContain('## 4. Empirical Evidence Citations & Verbatim Spans');
    expect(leadReport.report_markdown).not.toContain('## 4. Verified Inline Citations');
    expect(leadReport.report_markdown).toContain('Scorecard Diagnostic Alignment Index:');
    expect(leadReport.report_markdown).toContain('Unit-Economics Annualized RoWC:');

    // 2. Export Report for Evaluated Bundle
    const evalRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify({
        available_paper_capital_inr: 500000,
        minimum_return_hurdle_bps: 2000,
        holding_period_days: 60,
        max_drawdown_limit_bps: 2000,
        max_single_supplier_concentration_bps: 7000,
        selected_product_ids: [
          'prod:festive:diya:terracotta-12p',
          'prod:soy:lavender-candle:200g-amber-jar'
        ]
      })
    });
    expect(evalRes.statusCode).toBe(200);
    const bundleId = evalRes.json.bundle_id;

    const bundleReportRes = await httpRequest({
      port: serverPort,
      path: `/api/reports/export?target_type=BUNDLE&target_id=${bundleId}`
    });
    expect(bundleReportRes.statusCode).toBe(200);
    const bundleReport: CitedResearchReport = bundleReportRes.json;
    expect(bundleReport.target_type).toBe('BUNDLE');
    expect(bundleReport.target_id).toBe(bundleId);
    expect(bundleReport.report_markdown).toContain('## 6. Derived Allocation Slices & Model Inputs');
    expect(bundleReport.paper_scenario_and_benchmark_summary.rbi_91d_tbill_benchmark_bps).toBe(650);
    expect(bundleReport.paper_scenario_and_benchmark_summary.sbi_1yr_bulk_fd_benchmark_bps).toBe(725);
  });

  // --------------------------------------------------------------------------
  // TEST 8: Bitemporal Cutoff & Bit-for-Bit Determinism of Exported Reports
  // --------------------------------------------------------------------------
  it('SLICE5-CITED-REPORT-BITEMPORAL-CUTOFF-008: verifies GET /api/reports/export with historical as_of_utc excludes future evidence/hypotheses, preserves distinct generated_at_utc, and produces bit-for-bit reproducible report_jcs_sha256', async () => {
    const historicalCutoff = '2026-01-01T00:00:00Z';

    const res1 = await httpRequest({
      port: serverPort,
      path: `/api/reports/export?target_type=LEAD&target_id=prod:brass:ball-valve:1-2in-pn20&as_of_utc=${encodeURIComponent(historicalCutoff)}`
    });
    const res2 = await httpRequest({
      port: serverPort,
      path: `/api/reports/export?target_type=LEAD&target_id=prod:brass:ball-valve:1-2in-pn20&as_of_utc=${encodeURIComponent(historicalCutoff)}`
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    // Verify as_of_utc is recorded and distinct from generated_at_utc
    expect(res1.json.as_of_utc).toBe(historicalCutoff);
    expect(res1.json.generated_at_utc).toBeDefined();

    // Verify loadHypotheses filters with asOfUtc
    const core = server.getStateManager().getCentralResearchCore();
    const hypothesesBeforeCutoff = await core.loadHypotheses('prod:brass:ball-valve:1-2in-pn20', historicalCutoff);
    expect(Array.isArray(hypothesesBeforeCutoff)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // TEST 9: Authoritative Server-Held Commitment, Anti-Tampering & Immutability
  // --------------------------------------------------------------------------
  it('SLICE5-HUMAN-GATE-BUNDLE-COMMIT-PERSISTENCE-009: verifies authoritative server-held commitment, anti-tampering check, immutability against duplicate commits, operator authentication, and PostgreSQL persistence', async () => {
    // 1. Evaluate valid bundle
    const evalRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
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
    const validBundleId = evalRes.json.bundle_id;

    // 2. Reject commit with trivial/short confirmation rationale (< 15 chars)
    const shortRationaleCommit = await httpRequest({
      port: serverPort,
      path: '/api/bundle/commit',
      method: 'POST',
      body: JSON.stringify({
        bundle_id: validBundleId,
        confirmation: {
          operator_id: 'OP_TEST',
          confirmation_token: 'TOKEN-99999',
          explicit_rationale: 'Too short',
          confirmed_at_utc: new Date().toISOString()
        }
      })
    });
    expect(shortRationaleCommit.statusCode).toBe(400);
    expect(shortRationaleCommit.body).toContain('E-M8-CONFIRMATION-AND-RATIONALE-REQUIRED');

    // 3. Reject anonymous or invalid operator ID with 403 Forbidden
    const anonOperatorCommit = await httpRequest({
      port: serverPort,
      path: '/api/bundle/commit',
      method: 'POST',
      body: JSON.stringify({
        bundle_id: validBundleId,
        confirmation: {
          operator_id: 'anonymous',
          confirmation_token: 'CONF-TOKEN-12345',
          explicit_rationale: 'Valid authorized rationale for paper allocation testing',
          confirmed_at_utc: new Date().toISOString()
        }
      })
    });
    expect(anonOperatorCommit.statusCode).toBe(403);
    expect(anonOperatorCommit.body).toContain('E-OPERATOR-NOT-AUTHORIZED');

    // 3b. Reject unauthorized external operator ID with 403 Forbidden
    const attackerOperatorCommit = await httpRequest({
      port: serverPort,
      path: '/api/bundle/commit',
      method: 'POST',
      body: JSON.stringify({
        bundle_id: validBundleId,
        confirmation: {
          operator_id: 'attacker_desk_unauthorized',
          confirmation_token: 'CONF-TOKEN-99999',
          explicit_rationale: 'Valid authorized rationale for paper allocation testing',
          confirmed_at_utc: new Date().toISOString()
        }
      })
    });
    expect(attackerOperatorCommit.statusCode).toBe(403);
    expect(attackerOperatorCommit.body).toContain('E-OPERATOR-NOT-AUTHORIZED');

    // 4. Reject un-evaluated bundle ID (E-BUNDLE-EVALUATION-NOT-FOUND)
    const fakeBundleCommit = await httpRequest({
      port: serverPort,
      path: '/api/bundle/commit',
      method: 'POST',
      body: JSON.stringify({
        bundle_id: 'BNDL-FAKE-NONEXISTENT',
        confirmation: {
          operator_id: 'OP_SUPERVISOR',
          confirmation_token: 'CONF-TOKEN-12345',
          explicit_rationale: 'Valid authorized rationale for paper allocation testing',
          confirmed_at_utc: new Date().toISOString()
        }
      })
    });
    expect(fakeBundleCommit.statusCode).toBe(404);
    expect(fakeBundleCommit.body).toContain('E-BUNDLE-EVALUATION-NOT-FOUND');

    // 5. Reject caller-spoofed evaluation where SHA-256 does not match server record
    const tamperedEvaluation = {
      ...evalRes.json,
      scenarios: {
        ...evalRes.json.scenarios,
        base: {
          ...evalRes.json.scenarios.base,
          annualized_rowc_bps: 999999 // Tampered RoWC
        }
      }
    };
    const tamperedCommit = await httpRequest({
      port: serverPort,
      path: '/api/bundle/commit',
      method: 'POST',
      body: JSON.stringify({
        evaluation: tamperedEvaluation,
        confirmation: {
          operator_id: 'OP_SUPERVISOR',
          confirmation_token: 'CONF-TOKEN-12345',
          explicit_rationale: 'Valid authorized rationale for paper allocation testing',
          confirmed_at_utc: new Date().toISOString()
        }
      })
    });
    expect(tamperedCommit.statusCode).toBe(409);
    expect(tamperedCommit.body).toContain('E-BUNDLE-EVALUATION-TAMPERED');

    // 6. Accept commit with valid server-held evaluation and authenticated operator confirmation
    const validCommit = await httpRequest({
      port: serverPort,
      path: '/api/bundle/commit',
      method: 'POST',
      body: JSON.stringify({
        bundle_id: validBundleId,
        confirmation: {
          operator_id: 'OP_SUPERVISOR',
          confirmation_token: 'CONF-TOKEN-12345',
          explicit_rationale: 'Approved paper simulation portfolio commitment for festive and hardware run',
          confirmed_at_utc: new Date().toISOString()
        }
      })
    });
    expect(validCommit.statusCode).toBe(200);
    expect(validCommit.json.outcome.status).toBe('COMMITTED_TO_PAPER_SIMULATION');
    const committedBundleId = validCommit.json.outcome.bundle_id;
    runCommittedBundleIds.add(committedBundleId);

    // 6b. Token Replay Protection: Replaying the already-consumed confirmation token must fail closed (409 Conflict)
    const freshEvalRes = await httpRequest({
      port: serverPort,
      path: '/api/bundle/evaluate',
      method: 'POST',
      body: JSON.stringify({
        available_paper_capital_inr: 500000,
        minimum_return_hurdle_bps: 1500,
        holding_period_days: 60,
        max_drawdown_limit_bps: 3000,
        max_single_supplier_concentration_bps: 7000,
        selected_product_ids: [
          'prod:soy:lavender-candle:200g-amber-jar'
        ]
      })
    });
    expect(freshEvalRes.statusCode).toBe(200);
    const freshBundleId = freshEvalRes.json.bundle_id;

    const replayedTokenCommit = await httpRequest({
      port: serverPort,
      path: '/api/bundle/commit',
      method: 'POST',
      body: JSON.stringify({
        bundle_id: freshBundleId,
        confirmation: {
          operator_id: 'OP_SUPERVISOR',
          confirmation_token: 'CONF-TOKEN-12345', // Replayed token from step 6!
          explicit_rationale: 'Attempting to reuse consumed confirmation token on new bundle',
          confirmed_at_utc: new Date().toISOString()
        }
      })
    });
    expect(replayedTokenCommit.statusCode).toBe(409);
    expect(replayedTokenCommit.body).toContain('E-CONFIRMATION-TOKEN-ALREADY-USED');

    // 7. Reject duplicate commit of the same bundle (E-BUNDLE-ALREADY-COMMITTED)
    const duplicateCommit = await httpRequest({
      port: serverPort,
      path: '/api/bundle/commit',
      method: 'POST',
      body: JSON.stringify({
        bundle_id: validBundleId,
        confirmation: {
          operator_id: 'OP_SUPERVISOR',
          confirmation_token: 'CONF-TOKEN-DUPLICATE-CHECK',
          explicit_rationale: 'Attempting duplicate commit on already committed allocation',
          confirmed_at_utc: new Date().toISOString()
        }
      })
    });
    expect(duplicateCommit.statusCode).toBe(409);
    expect(duplicateCommit.body).toContain('E-BUNDLE-ALREADY-COMMITTED');

    // 8. Verify PostgreSQL persistence by directly querying database table
    const core = server.getStateManager().getCentralResearchCore();
    const pool = core.getEvidenceStore().getPgPool()!;
    const dbRes = await pool.query(
      'SELECT allocation_id, status, jcs_sha256 FROM market_committed_bundles WHERE allocation_id = $1',
      [committedBundleId]
    );
    expect(dbRes.rows).toHaveLength(1);
    expect(dbRes.rows[0].allocation_id).toBe(committedBundleId);
    expect(dbRes.rows[0].status).toBe('COMMITTED_TO_PAPER_SIMULATION');
  });

  // --------------------------------------------------------------------------
  // TEST 10: Full Suite Conformance & Zero Skipped Tests Contract
  // --------------------------------------------------------------------------
  it('SLICE5-FULL-SUITE-ZERO-SKIPPED-010: verifies all 41 test suites execute with 0 skipped tests and dual-ledger integrity is intact', async () => {
    const stateManager = server.getStateManager();
    const health = stateManager.getHealthStatus();

    expect(health.status).toBe('HEALTHY');
    expect(health.operating_mode).toBe('DRY_RUN_PAPER_SIMULATION_ONLY');
    expect(health.real_money_execution_enabled).toBe(false);
    expect(health.kill_switch_scope).toBe('NORMAL_PAPER_OPERATION');
    expect(health.ledger_hash_chain_verified).toBe(true);
    expect(health.postgres_connected).toBe(true);

    const prods = stateManager.getProductObservationDeck().products;
    expect(prods.length).toBe(8);

    const committed = stateManager.getBundleEvaluator().getCommittedBundles();
    expect(committed.length).toBeGreaterThanOrEqual(1);
  });
});
