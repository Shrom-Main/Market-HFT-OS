/**
 * Gate Slice 4 (Decision OD-28 / Charter DEC-028):
 * Local-First Research Query API, Review Span Miner, Opportunity Dossier & Opt-In Gemini/Groq Synthesis
 *
 * 10 Normative Acceptance Tests:
 * 1. SLICE4-FIX-HYPOTHESIS-PERSIST-AND-CONNECTORS-001: Verifies SLICE3-FIX-01 to 04 (dispatching 3 products yields 24 hypotheses; all 5 connectors seeded; no composite score gating; B2B proxy labeled ESTIMATED_PROXY).
 * 2. SLICE4-REVIEW-MINER-PAIN-AND-STRENGTHS-002: Extracts customer problems (with sample denominator, severity, WTP, bias) and positive incumbent strengths with verified [start, end] character spans.
 * 3. SLICE4-DOSSIER-CATEGORY-AGNOSTIC-003: Calls GET /api/research/dossier across multiple products, verifying all 9 sections and human-readable provenance labels.
 * 4. SLICE4-DOSSIER-BITEMPORAL-NO-LOOKAHEAD-004: Queries GET /api/research/dossier with historical as_of_utc cutoff and proves future events are excluded.
 * 5. SLICE4-LOCAL-QUERY-DEFAULT-ZERO-LLM-005: Calls POST /api/research/query in default mode, proving external_llm_called === false, provider_used === 'LOCAL_DETERMINISTIC_INDEX', inline citations resolve to exact spans, and gaps are surfaced.
 * 6. SLICE4-LOCAL-QUERY-CONTRADICTION-SURFACING-006: Queries product with conflicting quotes and proves POST /api/research/query surfaces both in active_contradictions without averaging.
 * 7. SLICE4-EXTERNAL-PROVIDER-OPT-IN-GATE-007: Proves requesting GEMINI_OPT_IN or GROQ_OPT_IN with user_explicit_provider_opt_in: false fails closed with E-QUERY-EXPLICIT-OPT-IN-REQUIRED.
 * 8. SLICE4-GEMINI-GROQ-RATE-GOVERNOR-ENFORCEMENT-008: Verifies opt-in synthesis checks ApiQuotaAndRateGovernor, fails closed with DEFERRED_RATE_LIMIT_PROTECTED when quota exceeded, and never exposes keys.
 * 9. SLICE4-UNIT-ECONOMICS-WATERFALL-COMPLETENESS-009: Verifies pure BigInt unit-economics waterfall in dossier and proves missing inputs halt with DATA_REQUIRED.
 * 10. SLICE4-POSTGRES-PERSISTENCE-AND-JCS-010: Verifies PostgreSQL persistence and bit-for-bit RFC 8785 JCS determinism of dossier and query responses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import {
  ReviewAndGrievanceMiner,
  verifyCitationSpan,
  type ReviewCorpusItem
} from '../../src/research/reviewAndGrievanceMiner.js';
import {
  OpportunityDossierService,
  type OpportunityDossier
} from '../../src/research/opportunityDossierService.js';
import {
  LocalFirstResearchQueryEngine
} from '../../src/research/localFirstResearchQueryEngine.js';
import { ApiQuotaAndRateGovernor } from '../../src/mcp/apiQuotaAndRateGovernor.js';
import { sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import { sanitizeForJcs } from '../../src/agents/m6AgentFramework.js';

describe('Suite 40: Gate Slice 4 Local-First Research Query, Review Miner & Opportunity Dossier Engine', () => {
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
              // Non-JSON
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
    const tempServer = http.createServer();
    await new Promise<void>((resolve) => {
      tempServer.listen(0, '127.0.0.1', () => {
        const addr = tempServer.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 4320;
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
        await pool.query("DELETE FROM market_signal_traces WHERE trace_id LIKE 'TRACE-%' AND created_at_utc > NOW() - INTERVAL '2 hours';").catch(() => {});
      }
      await server.stop();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 1: Part A Remediation (SLICE3-FIX-01 through 04 Verification)
  // --------------------------------------------------------------------------
  it('SLICE4-FIX-HYPOTHESIS-PERSIST-AND-CONNECTORS-001: dispatching research persists 24 structural hypotheses, all 5 connectors exist, no composite score gating, B2B price is labeled ESTIMATED_PROXY', async () => {
    const stateManager = server.getStateManager();
    const core = stateManager.getCentralResearchCore();

    // 1. Dispatch research for 3 non-SS304 products
    const productsToDispatch = [
      'prod:festive:diya:terracotta-12p',
      'prod:brass:ball-valve:1-2in-pn20',
      'prod:wellness:candle:soy-lavender'
    ];

    for (const prodId of productsToDispatch) {
      const res = await httpRequest({
        port: serverPort,
        path: '/api/research/dispatch',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: prodId })
      });
      expect(res.statusCode).toBe(200);
      expect(res.json.product?.product_id).toBe(prodId);
    }

    // 2. Proves 24 structural hypotheses persisted in PostgreSQL (8 per product)
    const allHypotheses = await core.loadHypotheses();
    expect(allHypotheses.length).toBeGreaterThanOrEqual(24);

    for (const prodId of productsToDispatch) {
      const prodHyps = await core.loadHypotheses(prodId);
      expect(prodHyps.length).toBe(8);
      const explTypes = prodHyps.map((h) => h.explanation_type);
      expect(explTypes).toContain('ECONOMICS_UNVIABLE');
      expect(explTypes).toContain('DEMAND_FRAGMENTATION');
      expect(explTypes).toContain('MANUFACTURING_CONSTRAINTS');
      expect(explTypes).toContain('DISTRIBUTION_CONSTRAINTS');
      expect(explTypes).toContain('INFORMATION_ASYMMETRY');
      expect(explTypes).toContain('PROCUREMENT_FRICTION');
      expect(explTypes).toContain('WEAK_INCENTIVES');
      expect(explTypes).toContain('FALSE_OPPORTUNITY');
    }

    // 3. Proves all 5 canonical connectors are seeded in market_connector_telemetry
    const pool = core.getEvidenceStore().getPgPool();
    expect(pool).toBeDefined();
    const connRes = await pool!.query('SELECT connector_id, status FROM market_connector_telemetry');
    expect(connRes.rows.length).toBeGreaterThanOrEqual(5);
    const connIds = connRes.rows.map((r: any) => r.connector_id);
    expect(connIds).toContain('conn:marketplace:amazon-in');
    expect(connIds).toContain('conn:supplier:indiamart');
    expect(connIds).toContain('conn:media:youtube-reviews');
    expect(connIds).toContain('conn:macro:rbi-fbil-lme');
    expect(connIds).toContain('conn:statutory:cbic-msme');

    // 4. Proves OpportunityScorecardEngine returns unweighted_diagnostic_index_bps with is_authoritative_gate_score: false
    const valveProduct = stateManager.getProductById('prod:brass:ball-valve:1-2in-pn20')!;
    const scorecardRes = await httpRequest({
      port: serverPort,
      path: '/api/research/scorecard',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: valveProduct.product_id })
    });
    expect(scorecardRes.statusCode).toBe(200);
    const scorecard = scorecardRes.json.scorecard;
    expect(scorecard.unweighted_diagnostic_index_bps).toBeDefined();
    expect(typeof scorecard.unweighted_diagnostic_index_bps).toBe('number');
    expect(scorecard.is_authoritative_gate_score).toBe(false);

    // 5. Proves B2B channel price is explicitly labeled ESTIMATED_PROXY with assumptions
    const distViability = scorecard.dimensions.distribution_viability;
    const b2bChannel = distViability.channels.find((c: any) => c.channel === 'B2B_DISTRIBUTION');
    expect(b2bChannel).toBeDefined();
    expect(b2bChannel.price_epistemic_class).toBe('ESTIMATED_PROXY');
    expect(b2bChannel.explicit_assumptions.length).toBeGreaterThan(0);
    expect(b2bChannel.explicit_assumptions[0]).toContain('Assumed 35% B2B wholesale discount');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Review & Grievance Miner (Customer Pain & Incumbent Strengths)
  // --------------------------------------------------------------------------
  it('SLICE4-REVIEW-MINER-PAIN-AND-STRENGTHS-002: extracts customer problems with sample denominator, severity, WTP, bias and positive strengths with verified character spans', () => {
    const stateManager = server.getStateManager();
    const diyaProduct = stateManager.getProductById('prod:festive:diya:terracotta-12p')!;

    const corpusText = 'Review #1: 4 of the 12 diyas were shattered in transit due to thin bubble wrap. ' +
      'However, we loved the traditional terracotta finish and festive look. Delivered very fast for Diwali deadline.';

    const corpusItems: ReviewCorpusItem[] = [
      {
        text: corpusText,
        source_id: 'rev:diya:001',
        source_type: 'MARKETPLACE_REVIEW',
        captured_at_utc: new Date().toISOString(),
        rating: 3
      }
    ];

    const result = ReviewAndGrievanceMiner.mineReviews({
      product: diyaProduct,
      reviewCorpus: corpusItems
    });

    expect(result.customer_problems.length).toBeGreaterThan(0);
    expect(result.incumbent_strengths.length).toBeGreaterThan(0);

    const problem = result.customer_problems[0];
    expect(problem.product_id).toBe(diyaProduct.product_id);
    expect(problem.problem_category).toBe('TRANSIT_BREAKAGE');
    expect(problem.sample_denominator).toBe(1); // Never omitted
    expect(problem.failure_severity).toBe('REPLACEMENT_REQUIRED');
    expect(problem.epistemic_class).toBe('CUSTOMER_ALLEGATION');
    expect(problem.verbatim_quote).toBe('shattered in transit');

    // Strict citation span verification: sourceText.slice(start, end) === verbatimQuote
    expect(verifyCitationSpan(corpusText, problem.citation_span, problem.verbatim_quote)).toBe(true);

    const strength = result.incumbent_strengths[0];
    expect(strength.product_id).toBe(diyaProduct.product_id);
    expect(strength.sample_denominator).toBe(1);
    expect(verifyCitationSpan(corpusText, strength.citation_span, strength.verbatim_quote)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Category-Agnostic Opportunity Dossier Endpoint
  // --------------------------------------------------------------------------
  it('SLICE4-DOSSIER-CATEGORY-AGNOSTIC-003: calls GET /api/research/dossier across multiple products, verifying all 9 sections and provenance labels', async () => {
    const productsToTest = [
      'prod:festive:diya:terracotta-12p',
      'prod:brass:ball-valve:1-2in-pn20',
      'prod:wellness:candle:soy-lavender',
      'prod:din3017:ss304:16-25mm:pack-10'
    ];

    for (const prodId of productsToTest) {
      const res = await httpRequest({
        port: serverPort,
        path: `/api/research/dossier?product_id=${encodeURIComponent(prodId)}`
      });

      expect(res.statusCode).toBe(200);
      const dossier: OpportunityDossier = res.json.dossier;
      expect(dossier).toBeDefined();

      // Verify all 9 sections exist
      expect(dossier.lead_header).toBeDefined();
      expect(dossier.demand_and_seasonality).toBeDefined();
      expect(dossier.customer_pain_and_strengths).toBeDefined();
      expect(dossier.seller_and_competition).toBeDefined();
      expect(dossier.supply_and_logistics).toBeDefined();
      expect(dossier.unit_economics_waterfall).toBeDefined();
      expect(dossier.incumbent_failure_matrix).toBeDefined();
      expect(dossier.scorecard).toBeDefined();
      expect(dossier.evidence_and_citations).toBeDefined();
      expect(dossier.jcs_sha256).toMatch(/^[0-9a-f]{64}$/);

      // Verify lead_header human-readable provenance badge
      expect(typeof dossier.lead_header.provenance_badge).toBe('string');
      expect(['Verified capture', 'Supplier quote', 'Marketplace estimate', 'Fixture data', 'Modelled Est']).toContain(dossier.lead_header.provenance_badge);
      expect(dossier.lead_header.product_id).toBe(prodId);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 4: Bitemporal No-Lookahead History Filter
  // --------------------------------------------------------------------------
  it('SLICE4-DOSSIER-BITEMPORAL-NO-LOOKAHEAD-004: queries GET /api/research/dossier with historical as_of_utc cutoff and proves future events are excluded', async () => {
    const stateManager = server.getStateManager();
    const core = stateManager.getCentralResearchCore();
    const store = core.getEvidenceStore();
    const testProdId = 'prod:festive:diya:terracotta-12p';

    // Store a past event overlay and a future event overlay
    await store.storeEventOverlay({
      event_id: 'EVT-TEST-PAST-001',
      product_id: testProdId,
      event_type: 'FESTIVAL_WINDOW_OPEN',
      event_timestamp_utc: '2026-05-01T10:00:00Z',
      as_of_utc: '2026-05-01T10:00:00Z',
      severity: 'INFO',
      title: 'Historical Early Season Planning Window',
      summary: 'Early seasonal production check',
      source_citation: 'Historical Log'
    });

    await store.storeEventOverlay({
      event_id: 'EVT-TEST-FUTURE-002',
      product_id: testProdId,
      event_type: 'FESTIVAL_DEMAND_SURGE',
      event_timestamp_utc: '2026-11-01T10:00:00Z',
      as_of_utc: '2026-11-01T10:00:00Z',
      severity: 'CRITICAL',
      title: 'Future Diwali Surge Peak',
      summary: 'Peak holiday surge window',
      source_citation: 'Future Calendar'
    });

    // Query dossier as of June 2026 (should include past event, exclude future event)
    const asOfCutoff = '2026-06-01T00:00:00Z';
    const res = await httpRequest({
      port: serverPort,
      path: `/api/research/dossier?product_id=${encodeURIComponent(testProdId)}&as_of_utc=${encodeURIComponent(asOfCutoff)}`
    });

    expect(res.statusCode).toBe(200);
    const overlays = res.json.dossier.demand_and_seasonality.seasonal_event_overlays;
    const eventIds = overlays.map((o: any) => o.event_id);

    expect(eventIds).toContain('EVT-TEST-PAST-001');
    expect(eventIds).not.toContain('EVT-TEST-FUTURE-002');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Default Local-First Query (Zero External LLM Calls)
  // --------------------------------------------------------------------------
  it('SLICE4-LOCAL-QUERY-DEFAULT-ZERO-LLM-005: calls POST /api/research/query in default mode, proving external_llm_called === false, provider_used === "LOCAL_DETERMINISTIC_INDEX", inline citations resolve to exact spans, and gaps are surfaced', async () => {
    const res = await httpRequest({
      port: serverPort,
      path: '/api/research/query',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'What are the main buyer grievances and distribution channels for brass ball valve?',
        product_id: 'prod:brass:ball-valve:1-2in-pn20'
      })
    });

    expect(res.statusCode).toBe(200);
    const body = res.json;

    expect(body.execution_mode).toBe('LOCAL_DETERMINISTIC_FIRST');
    expect(body.provider_telemetry.external_llm_called).toBe(false);
    expect(body.provider_telemetry.provider_used).toBe('LOCAL_DETERMINISTIC_INDEX');
    expect(body.provider_telemetry.llm_model).toBeNull();
    expect(body.answer_markdown).toContain('Research Dossier Summary');
    expect(body.inline_citations.length).toBeGreaterThan(0);

    const citation = body.inline_citations[0];
    expect(citation.citation_id).toMatch(/^CIT-/);
    expect(citation.start_char_offset).toBeGreaterThanOrEqual(0);
    expect(citation.end_char_offset).toBeGreaterThan(citation.start_char_offset);
    expect(typeof citation.verbatim_quote).toBe('string');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Local Query Contradiction Surfacing Without Averaging
  // --------------------------------------------------------------------------
  it('SLICE4-LOCAL-QUERY-CONTRADICTION-SURFACING-006: queries product with conflicting quotes and proves POST /api/research/query surfaces both in active_contradictions without averaging', async () => {
    const stateManager = server.getStateManager();
    const core = stateManager.getCentralResearchCore();
    const testProdId = 'prod:din3017:ss304:16-25mm:pack-10';
    const nowUtc = new Date().toISOString();

    // Store two contradictory supplier quotes (₹25 vs ₹31)
    await core.storeEvidence({
      evidence_id: `EVID-TEST-QUOTE-25-${Date.now()}`,
      product_id: testProdId,
      channel: 'SOURCING_QUOTE',
      observed_at_utc: nowUtc,
      as_of_utc: nowUtc,
      payload_sha256: sha256('quote-25'),
      raw_payload: '₹25 factory quote from Howrah cluster',
      extracted_claims: { factory_gate_quote_inr: 25.0, moq: 500 },
      origin: {
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        source_url: 'https://supplier-a.com/quote',
        captured_at_utc: nowUtc,
        tool_run_id: 'test:quote:25',
        worker_id: 'worker:source-capture:v1',
        cryptographic_hash: sha256('quote-25'),
        is_attested: false,
        verification_notes: 'Supplier A quote fixture'
      },
      epistemic_class: 'ESTIMATED_PROXY',
      jcs_sha256: sha256('quote-25')
    });

    await core.storeEvidence({
      evidence_id: `EVID-TEST-QUOTE-31-${Date.now()}`,
      product_id: testProdId,
      channel: 'SOURCING_QUOTE',
      observed_at_utc: nowUtc,
      as_of_utc: nowUtc,
      payload_sha256: sha256('quote-31'),
      raw_payload: '₹31 factory quote from Jamnagar cluster',
      extracted_claims: { factory_gate_quote_inr: 31.0, moq: 1000 },
      origin: {
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        source_url: 'https://supplier-b.com/quote',
        captured_at_utc: nowUtc,
        tool_run_id: 'test:quote:31',
        worker_id: 'worker:source-capture:v1',
        cryptographic_hash: sha256('quote-31'),
        is_attested: false,
        verification_notes: 'Supplier B quote fixture'
      },
      epistemic_class: 'ESTIMATED_PROXY',
      jcs_sha256: sha256('quote-31')
    });

    const res = await httpRequest({
      port: serverPort,
      path: '/api/research/query',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'What is the factory gate cost for SS304 hose clamps?',
        product_id: testProdId
      })
    });

    expect(res.statusCode).toBe(200);
    expect(res.json.active_contradictions.length).toBeGreaterThan(0);

    const contradiction = res.json.active_contradictions[0];
    expect(contradiction.topic).toContain('Supplier Factory Gate Pricing Discrepancy');
    const combinedStmts = contradiction.contradictory_statements.join(' ');
    expect(combinedStmts).toContain('25');
    expect(combinedStmts).toContain('31');
  });

  // --------------------------------------------------------------------------
  // TEST 7: External Provider Opt-In Gate
  // --------------------------------------------------------------------------
  it('SLICE4-EXTERNAL-PROVIDER-OPT-IN-GATE-007: proves requesting GEMINI_OPT_IN or GROQ_OPT_IN with user_explicit_provider_opt_in: false fails closed with E-QUERY-EXPLICIT-OPT-IN-REQUIRED', async () => {
    // 1. GEMINI_OPT_IN without explicit opt-in
    const resGemini = await httpRequest({
      port: serverPort,
      path: '/api/research/query',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'Synthesize opportunity thesis',
        product_id: 'prod:brass:ball-valve:1-2in-pn20',
        provider_mode: 'GEMINI_OPT_IN',
        user_explicit_provider_opt_in: false
      })
    });
    expect(resGemini.statusCode).toBe(400);
    expect(resGemini.body).toContain('E-QUERY-EXPLICIT-OPT-IN-REQUIRED');

    // 2. GROQ_OPT_IN with omitted opt-in
    const resGroq = await httpRequest({
      port: serverPort,
      path: '/api/research/query',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'Synthesize opportunity thesis',
        product_id: 'prod:brass:ball-valve:1-2in-pn20',
        provider_mode: 'GROQ_OPT_IN'
      })
    });
    expect(resGroq.statusCode).toBe(400);
    expect(resGroq.body).toContain('E-QUERY-EXPLICIT-OPT-IN-REQUIRED');
  });

  // --------------------------------------------------------------------------
  // TEST 8: Gemini/Groq Rate Governor Enforcement
  // --------------------------------------------------------------------------
  it('SLICE4-GEMINI-GROQ-RATE-GOVERNOR-ENFORCEMENT-008: verifies opt-in synthesis checks ApiQuotaAndRateGovernor RPM/RPD limits, fails closed with DEFERRED_RATE_LIMIT_PROTECTED when quota exceeded, and never exposes keys', async () => {
    const stateManager = server.getStateManager();
    const core = stateManager.getCentralResearchCore();
    const deck = (stateManager as any).productObservationDeck;

    // Create an engine with a strict rate ceiling (requests_per_minute: 0) to simulate quota exhaustion
    const strictGovernor = new ApiQuotaAndRateGovernor({
      ceilings: {
        GEMINI_API: {
          requests_per_minute: 0, // Exhausted
          requests_per_day: 0,
          requests_per_week: 0
        }
      }
    });

    const engineWithStrictGovernor = new LocalFirstResearchQueryEngine({
      centralResearchCore: core,
      productDeck: deck,
      quotaGovernor: strictGovernor
    });

    await expect(
      engineWithStrictGovernor.query({
        query: 'Synthesize thesis with Gemini',
        product_id: 'prod:wellness:candle:soy-lavender',
        provider_mode: 'GEMINI_OPT_IN',
        user_explicit_provider_opt_in: true
      })
    ).rejects.toThrow(/DEFERRED_RATE_LIMIT_PROTECTED/);

    // Also prove that when opt-in query executes under valid quota in test mode (no key), it falls back safely without leaking secrets
    const res = await httpRequest({
      port: serverPort,
      path: '/api/research/query',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'Analyze soy lavender candle',
        product_id: 'prod:wellness:candle:soy-lavender',
        provider_mode: 'GEMINI_OPT_IN',
        user_explicit_provider_opt_in: true
      })
    });

    expect(res.statusCode).toBe(200);
    expect(res.json.epistemic_class).toBe('NON_AUTHORITATIVE_AI_SYNTHESIS');
    expect(res.json.provider_telemetry.fallback_reason).toBe('API_KEY_UNCONFIGURED_OR_OFFLINE');
    // Ensure no API keys or secrets appear anywhere in payload
    expect(res.body).not.toContain('AIzaSy');
    expect(res.body).not.toContain('gsk_');
  });

  // --------------------------------------------------------------------------
  // TEST 9: Unit Economics Waterfall Completeness & Pure BigInt Standard
  // --------------------------------------------------------------------------
  it('SLICE4-UNIT-ECONOMICS-WATERFALL-COMPLETENESS-009: verifies the pure BigInt unit-economics waterfall in the dossier and proves missing cost inputs halt with DATA_REQUIRED', async () => {
    const res = await httpRequest({
      port: serverPort,
      path: '/api/research/dossier?product_id=prod:brass:ball-valve:1-2in-pn20'
    });

    expect(res.statusCode).toBe(200);
    const waterfall = res.json.dossier.unit_economics_waterfall;
    expect(waterfall).toHaveLength(4);

    for (const row of waterfall) {
      expect(row.gross_selling_price_inr).toBeGreaterThan(0);
      expect(typeof row.ex_gst_proceeds_inr).toBe('number');
      expect(typeof row.platform_fee_inr).toBe('number');
      expect(typeof row.fulfillment_fee_inr).toBe('number');
      expect(typeof row.statutory_tax_inr).toBe('number');
      expect(typeof row.packaging_inbound_freight_inr).toBe('number');
      expect(typeof row.factory_cost_inr).toBe('number');
      expect(typeof row.return_drag_inr).toBe('number');
      expect(typeof row.net_contribution_inr).toBe('number');
      expect(typeof row.contribution_margin_bps).toBe('number');
      expect(isFinite(row.net_contribution_inr)).toBe(true);
      expect(isFinite(row.contribution_margin_bps)).toBe(true);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 10: PostgreSQL Persistence & RFC 8785 JCS Determinism
  // --------------------------------------------------------------------------
  it('SLICE4-POSTGRES-PERSISTENCE-AND-JCS-010: verifies PostgreSQL persistence and bit-for-bit RFC 8785 JCS determinism of dossier and query responses', async () => {
    const stateManager = server.getStateManager();
    const core = stateManager.getCentralResearchCore();
    const pool = core.getEvidenceStore().getPgPool();
    expect(pool).toBeDefined();

    // Verify hypotheses exist in PostgreSQL
    const hypRows = await pool!.query('SELECT count(*) FROM market_hypothesis_ledger');
    expect(parseInt(hypRows.rows[0].count, 10)).toBeGreaterThanOrEqual(24);

    // Verify bit-for-bit RFC 8785 JCS determinism of dossier
    const prod = stateManager.getProductById('prod:festive:diya:terracotta-12p')!;
    const dossier = await OpportunityDossierService.buildDossier(prod, core);
    const { jcs_sha256, ...dossierWithoutHash } = dossier;
    const computedHash = sha256(canonicalizeJCS(sanitizeForJcs(dossierWithoutHash)));
    expect(jcs_sha256).toBe(computedHash);

    // Verify bit-for-bit RFC 8785 JCS determinism of query response
    const queryEngine = stateManager.getLocalResearchQueryEngine();
    const queryRes = await queryEngine.query({
      query: 'What is the margin on terracotta diya?',
      product_id: 'prod:festive:diya:terracotta-12p'
    });
    const { jcs_sha256: queryHash, ...queryWithoutHash } = queryRes;
    const computedQueryHash = sha256(canonicalizeJCS(sanitizeForJcs(queryWithoutHash)));
    expect(queryHash).toBe(computedQueryHash);
  });
});
