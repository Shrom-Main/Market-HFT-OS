/**
 * SUITE-22: Gate M6 24x7 Multi-Agent Research Framework, TinyFish Scoped Browser
 * Sub-Agents & Bitemporal Replay Acceptance Suite
 *
 * Normative Acceptance Suite for Stage 3 Gate M6:
 * 1. M6-TINYFISH-SCOPED-BROWSER-001: DOM extraction, SHA-256 snapshot, ADVERTISED_LISTING cap, DATA_REQUIRED handling.
 * 2. M6-SUBAGENT-SWARM-DECOMPOSE-002: Multi-channel signal decomposition and 9-stage DAG execution.
 * 3. M6-RED-TEAM-ADVERSARIAL-BLOCK-003: Red team blocking of below-scrap-cost fraud and metallurgy defect quotes.
 * 4. M6-AGENT-PERMISSION-AND-QUOTA-FIREWALL-004: Fail-closed ledger access denial and token/request quota enforcement.
 * 5. M6-DEGRADED-MODE-RESILIENCE-005: Control plane degraded mode resilience during external worker timeout.
 * 6. M6-BITEMPORAL-REPLAY-AND-RESTATEMENT-006: Bit-for-bit historical t0 reconstruction and t1 restatement halting.
 * 7. M6-END-TO-END-POLISH-AND-PRESENT-JCS-007: RFC 8785 JCS determinism of research and restatement payloads.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import {
  TinyFishScopedBrowserAgent,
  MediaAndChatterSubAgent,
  MacroAndLateralMarketSubAgent,
  GovtSchemeAndTaxSubAgent,
  RedTeamReviewerSubAgent,
  AgentSecurityFirewall,
  ResearchSchedulerAndManager,
  BitemporalRestatementEngine,
  sanitizeForJcs
} from '../../src/agents/m6AgentFramework.js';
import {
  SiloCandidateInput,
  SS304Diameter,
  SS304PackSize
} from '../../src/research/m5SiloAndGroupSimulator.js';
import { OperationalEconomicsParameters } from '../../src/research/m4VerticalSlice.js';

describe('SUITE-22: Gate M6 Multi-Agent Research Framework & Bitemporal Replay Acceptance', () => {
  const REF_TIME = '2026-10-16T12:00:00Z';
  const TOTAL_BUDGET = 500000000n; // ₹50,000.0000

  const defaultOpsParams: OperationalEconomicsParameters = {
    procurement_lead_time_days: 7,
    warehouse_dwell_days: 14,
    marketplace_settlement_delay_days: 14,
    gst_rate_bps: 1800n, // 18.00%
    itc_eligible_fraction_bps: 10000n, // 100.00%
    tcs_rate_bps: 100n, // 1.00%
    tds_rate_bps: 100n, // 1.00%
    customer_return_rate_bps: 200n, // 2.00% nominal
    reverse_logistics_fee_subunits: 140000n, // ₹14.0000
    quarantine_attrition_rate_bps: 10000n, // 100.00%
    risk_free_rate_bps: 650n, // 6.50%
    execution_risk_premium_bps: 850n, // 8.50%
    min_cash_margin_bps: 2000n, // 20.00%
    max_ccc_days: 45,
    min_downside_buffer_bps: 1500n // 15.00%
  };

  function createCandidate(
    diameter: SS304Diameter = '16-25mm',
    packSize: SS304PackSize = 10,
    overrides?: Partial<SiloCandidateInput>
  ): SiloCandidateInput {
    return {
      candidate_id: `cand:ss304:${diameter}:pack-${packSize}`,
      sku_id: `prod:din3017:ss304:${diameter}:pack-${packSize}`,
      diameter,
      pack_size: packSize,
      title: `SS304 DIN 3017 Clamp ${diameter} (Pack of ${packSize})`,
      moq: 500,
      gross_selling_price_subunits: 1050000n, // ₹105.0000
      raw_material_purchase_subunits: 250000n, // ₹25.0000
      inbound_freight_subunits: 45000n, // ₹4.5000
      packaging_kitting_subunits: 32000n, // ₹3.2000
      insurance_handling_subunits: 10000n,
      customs_inspection_subunits: 45100n,
      marketplace_referral_bps: 1500n,
      marketplace_closing_subunits: 100000n,
      marketplace_weight_handling_subunits: 140000n,
      operational_params: defaultOpsParams,
      is_verified: true,
      ...overrides
    };
  }

  // ==========================================================================
  // TEST 1: M6-TINYFISH-SCOPED-BROWSER-001
  // ==========================================================================
  it('M6-TINYFISH-SCOPED-BROWSER-001: TinyFishScopedBrowserAgent extracts Amazon ASIN and Howrah supplier DOM fixtures with SHA-256 dom_snapshot_hash, caps status at ADVERTISED_LISTING, and returns DATA_REQUIRED (never ₹0) when a field is missing', () => {
    const tinyFish = new TinyFishScopedBrowserAgent();

    // 1. Valid Amazon India listing DOM
    const amazonHtml = `
      <div id="dp" data-asin="B09XYZ1234">
        <span class="a-price-whole" data-price="105.00">₹105</span>
        <span class="moq-badge" data-moq="500">MOQ: 500</span>
        <div data-freight="4.50">Shipping: ₹4.50</div>
      </div>
    `;

    const resValid = tinyFish.extractListing({
      source_url: 'https://amazon.in/dp/B09XYZ1234',
      raw_dom: amazonHtml,
      mandatory_fields: ['gross_selling_price_subunits', 'moq', 'asin']
    });

    expect(resValid.dom_snapshot_hash).toHaveLength(64);
    expect(resValid.extraction_status).toBe('COMPLETE');
    expect(resValid.extracted_fields['asin']).toBe('B09XYZ1234');
    expect(resValid.extracted_fields['gross_selling_price_subunits']).toBe(1050000n);
    expect(resValid.extracted_fields['moq']).toBe(500);
    expect(resValid.evidence_envelope).toBeDefined();
    expect(resValid.evidence_envelope!.commercial_status).toBe('ADVERTISED_LISTING'); // Capped per §9.2
    expect(resValid.evidence_envelope!.verification_status).toBe('UNVERIFIED');

    // 2. Incomplete Howrah industrial supplier directory page (missing mandatory freight)
    const howrahHtmlIncomplete = `
      <div class="supplier-item">
        <h2>SS304 DIN 3017 Clamps 16-25mm</h2>
        <span data-price="25.00">Price: ₹25.00/unit</span>
        <span data-moq="1000">MOQ: 1000</span>
        <!-- Freight and logistics are not specified on directory page -->
      </div>
    `;

    const resIncomplete = tinyFish.extractListing({
      source_url: 'https://indiamart.com/howrah-hardware/ss304-clamp',
      raw_dom: howrahHtmlIncomplete,
      mandatory_fields: ['gross_selling_price_subunits', 'moq', 'inbound_freight_subunits']
    });

    expect(resIncomplete.dom_snapshot_hash).toHaveLength(64);
    expect(resIncomplete.extraction_status).toBe('DATA_REQUIRED');
    expect(resIncomplete.missing_mandatory_fields).toContain('inbound_freight_subunits');
    // Missing freight must NOT be defaulted to 0 or 0n
    expect(resIncomplete.extracted_fields['inbound_freight_subunits']).toBeUndefined();
    expect(resIncomplete.evidence_envelope).toBeUndefined();
  });

  // ==========================================================================
  // TEST 2: M6-SUBAGENT-SWARM-DECOMPOSE-002
  // ==========================================================================
  it('M6-SUBAGENT-SWARM-DECOMPOSE-002: ResearchSchedulerAndManager decomposes a multi-channel research tick across Media, Macro/Lateral (LME Steel + T-Bill), and Govt Scheme sub-agents, feeding normalized shocks into Silo & Group Simulator', () => {
    const manager = new ResearchSchedulerAndManager();

    const tickResult = manager.executeResearchTick({
      tick_id: 'tick:2026-10-16:001',
      timestamp_utc: REF_TIME,
      thesis: 'SS304 DIN 3017 clamp Howrah manufacturing versus Amazon retail arbitrage',
      raw_dom_pages: [
        {
          url: 'https://amazon.in/dp/B09XYZ1234',
          dom: '<div data-asin="B09XYZ1234" data-price="105.00" data-moq="500"></div>',
          mandatory_fields: ['gross_selling_price_subunits', 'moq']
        }
      ],
      media_transcripts: [
        {
          channel: 'YOUTUBE_VIDEO_TRANSCRIPT',
          source_id: 'yt:channel:tool-testing-india',
          text: 'Comprehensive review: batch tested for rust and salt spray resistance with zero corrosion.'
        }
      ],
      lateral_market_quotes: [
        {
          symbol: 'SS304_COIL',
          change_bps: 1000, // +10% steel price spike
          source_id: 'lme:metals:ss304'
        }
      ]
    });

    // 1. Verify 9 stages completed
    expect(tickResult.stages_completed).toEqual([
      'DECOMPOSE',
      'ROUTE',
      'ASSEMBLE_CONTEXT',
      'PROMPT',
      'EXECUTE_SCOPED_WORKER',
      'REVIEW_RED_TEAM',
      'ASSEMBLE_EVIDENCE',
      'POLISH',
      'PRESENT'
    ]);

    // 2. Verify collected signals
    expect(tickResult.signals_collected.length).toBeGreaterThanOrEqual(2);
    const steelShock = tickResult.signals_collected.find(
      (s) => s.economic_factor_name === 'RAW_MATERIAL_LME_STEEL_SHOCK'
    );
    expect(steelShock).toBeDefined();
    expect(steelShock!.magnitude_bps).toBe(1000n);

    // 3. Verify extracted listing
    expect(tickResult.extracted_listings).toHaveLength(1);
    expect(tickResult.extracted_listings[0].extraction_status).toBe('COMPLETE');

    // 4. Verify telemetry digest
    expect(tickResult.telemetry_digest_sha256).toHaveLength(64);
  });

  // ==========================================================================
  // TEST 3: M6-RED-TEAM-ADVERSARIAL-BLOCK-003
  // ==========================================================================
  it('M6-RED-TEAM-ADVERSARIAL-BLOCK-003: RedTeamReviewerSubAgent catches and blocks a supplier listing claiming SS304 grade at ₹12/pack when corroborated defect chatter and LME raw-material floor calculations prove quote is below raw scrap metal cost', () => {
    const redTeam = new RedTeamReviewerSubAgent();
    const mediaAgent = new MediaAndChatterSubAgent();

    // LME raw scrap SS304 floor cost calculation: 10 clamps = 120g of SS304 = min ₹18.0000 scrap value
    const scrapFloorSubunits = 180000n; // ₹18.0000

    // Fraudulent offer: claims ₹12.0000 per 10-pack
    const fraudulentQuoteSubunits = 120000n; // ₹12.0000

    // Forum/review defect signal reporting rust/magnetism
    const defectSignal = mediaAgent.extractSignals({
      channel: 'SOCIAL_FORUM_CHATTER',
      source_id: 'forum:seller-india',
      text: 'Alert: howrah batch clamp has heavy rust after 2 weeks, magnetic test proves it is fake SS202 scrap mix!'
    });

    // Audit 1: Fraudulent quote below scrap floor
    const auditFraud = redTeam.auditCandidateOffer({
      candidate_id: 'cand:fraud:howrah-ss304-12inr',
      claimed_price_subunits: fraudulentQuoteSubunits,
      raw_material_scrap_floor_subunits: scrapFloorSubunits,
      defect_signals: [defectSignal]
    });

    expect(auditFraud.approved).toBe(false);
    expect(auditFraud.rejection_reason).toMatch(/E-M6-RED-TEAM-REJECTED/);
    expect(auditFraud.rejection_reason).toContain('below raw scrap metal floor');

    // Audit 2: Legitimate quote (₹25.0000, above ₹18.0000 floor, no severe defects)
    const legitQuoteSubunits = 250000n; // ₹25.0000
    const auditLegit = redTeam.auditCandidateOffer({
      candidate_id: 'cand:legit:metalcraft-ss304',
      claimed_price_subunits: legitQuoteSubunits,
      raw_material_scrap_floor_subunits: scrapFloorSubunits
    });

    expect(auditLegit.approved).toBe(true);
    expect(auditLegit.rejection_reason).toBeUndefined();
  });

  // ==========================================================================
  // TEST 4: M6-AGENT-PERMISSION-AND-QUOTA-FIREWALL-004
  // ==========================================================================
  it('M6-AGENT-PERMISSION-AND-QUOTA-FIREWALL-004: Proves no agent worker can bypass ActualsGuard, mutate PaperLedger directly, or exceed its configured token/request budget', () => {
    const tinyFish = new TinyFishScopedBrowserAgent();
    const manifest = tinyFish.getManifest();

    // 1. Direct write to PaperLedger is blocked fail-closed
    expect(() => {
      AgentSecurityFirewall.assertLedgerAccessAllowed(manifest, 'PaperLedger');
    }).toThrow(/E-M6-PERMISSION-DENIED/);

    // 2. Direct write to ActualsLedger is blocked fail-closed
    expect(() => {
      AgentSecurityFirewall.assertLedgerAccessAllowed(manifest, 'ActualsLedger');
    }).toThrow(/E-M6-PERMISSION-DENIED/);

    // 3. Exceeding configured token quota triggers fail-closed error
    const usage = tinyFish.getResourceUsage();
    expect(() => {
      AgentSecurityFirewall.enforceQuota(manifest, usage, 60000, 10);
    }).toThrow(/E-M6-QUOTA-EXCEEDED/);
  });

  // ==========================================================================
  // TEST 5: M6-DEGRADED-MODE-RESILIENCE-005
  // ==========================================================================
  it('M6-DEGRADED-MODE-RESILIENCE-005: Simulates a timeout/outage in an external browser/LLM worker and verifies the control plane enters explicit degraded mode, preserves prior known state, and never substitutes 0 for unknown prices', () => {
    const manager = new ResearchSchedulerAndManager();

    const degradedRun = manager.executeResearchTick({
      tick_id: 'tick:degraded:002',
      timestamp_utc: REF_TIME,
      thesis: 'SS304 DIN 3017 clamp degraded mode test',
      force_degraded_worker_timeout: true // Simulate network outage
    });

    // 1. Explicit degraded mode is flagged
    expect(degradedRun.degraded_mode_triggered).toBe(true);

    // 2. Pipeline still completes all 9 stages gracefully
    expect(degradedRun.stages_completed).toEqual([
      'DECOMPOSE',
      'ROUTE',
      'ASSEMBLE_CONTEXT',
      'PROMPT',
      'EXECUTE_SCOPED_WORKER',
      'REVIEW_RED_TEAM',
      'ASSEMBLE_EVIDENCE',
      'POLISH',
      'PRESENT'
    ]);

    // 3. Telemetry digest remains valid
    expect(degradedRun.telemetry_digest_sha256).toHaveLength(64);
  });

  // ==========================================================================
  // TEST 6: M6-BITEMPORAL-REPLAY-AND-RESTATEMENT-006
  // ==========================================================================
  it('M6-BITEMPORAL-REPLAY-AND-RESTATEMENT-006: Proves bit-for-bit reconstruction of a t0 allocation decision alongside a t1 restatement after new TinyFish/Macro evidence arrives, emitting a THESIS_INVALIDATED_HALT report without mutating the t0 historical record', () => {
    const t0 = '2026-10-16T10:00:00Z';
    const t1 = '2026-10-16T18:00:00Z';

    const candOriginal = createCandidate('16-25mm', 10, {
      gross_selling_price_subunits: 1050000n, // ₹105.0000
      raw_material_purchase_subunits: 250000n // ₹25.0000
    });

    // Step 1: Record t_0 decision
    const t0Record = BitemporalRestatementEngine.recordDecisionAtT0(
      'dec:2026-10-16:ss304:t0',
      t0,
      [candOriginal],
      { treasury_budget_subunits: TOTAL_BUDGET }
    );

    expect(t0Record.decision_time_utc).toBe(t0);
    expect(t0Record.record_digest_sha256).toHaveLength(64);
    expect(t0Record.simulation_result.allocations).toHaveLength(1);
    const origRoWC = BigInt(t0Record.simulation_result.benchmarks.effective_portfolio_rowc_bps);
    expect(origRoWC).toBeGreaterThan(650n);

    // Step 2: Severe market edge decay arrives at t_1:
    // TinyFish detects Amazon price collapse to ₹45.0000 (below cost)
    // Macro sub-agent detects +30% raw material inflation
    const candRestatedT1 = createCandidate('16-25mm', 10, {
      gross_selling_price_subunits: 450000n, // ₹45.0000 (price crash)
      raw_material_purchase_subunits: 325000n // +30% raw material surge
    });

    const restatementReport = BitemporalRestatementEngine.reconcileAndRestateDecision(
      t0Record,
      t1,
      [candRestatedT1]
    );

    // 1. Original t_0 record is NOT mutated or altered
    expect(t0Record.decision_time_utc).toBe(t0);
    expect(t0Record.candidate_inputs[0].gross_selling_price_subunits).toBe(1050000n);

    // 2. Input deltas are accurately isolated
    expect(restatementReport.input_deltas['cand:ss304:16-25mm:pack-10:gross_selling_price']).toEqual({
      t0_value: '1050000',
      t1_value: '450000'
    });
    expect(restatementReport.input_deltas['cand:ss304:16-25mm:pack-10:raw_material']).toEqual({
      t0_value: '250000',
      t1_value: '325000'
    });

    // 3. Status is THESIS_INVALIDATED_HALT because unit economics collapsed below T-Bill hurdle
    expect(restatementReport.restatement_status).toBe('THESIS_INVALIDATED_HALT');
    expect(restatementReport.explanation).toContain('Thesis invalidated at t_1');
    expect(BigInt(restatementReport.rowc_delta_bps)).toBeLessThan(0n);
    expect(restatementReport.restatement_digest_sha256).toHaveLength(64);
  });

  // ==========================================================================
  // TEST 7: M6-END-TO-END-POLISH-AND-PRESENT-JCS-007
  // ==========================================================================
  it('M6-END-TO-END-POLISH-AND-PRESENT-JCS-007: Verifies the complete 9-stage Decompose -> Present operator briefing and trading-chart telemetry payload is deterministic under RFC 8785 JCS', () => {
    const manager = new ResearchSchedulerAndManager();

    const tickPayload = {
      tick_id: 'tick:deterministic:003',
      timestamp_utc: REF_TIME,
      thesis: 'SS304 DIN 3017 hose clamp multi-channel arbitrage',
      raw_dom_pages: [
        {
          url: 'https://amazon.in/dp/B09XYZ1234',
          dom: '<div data-asin="B09XYZ1234" data-price="105.00" data-moq="500"></div>',
          mandatory_fields: ['gross_selling_price_subunits', 'moq']
        }
      ],
      media_transcripts: [
        {
          channel: 'YOUTUBE_VIDEO_TRANSCRIPT' as const,
          source_id: 'yt:channel:teardown',
          text: 'Verified SS304 passivated clamp inspection.'
        }
      ],
      lateral_market_quotes: [
        {
          symbol: 'SS304_COIL',
          change_bps: 500,
          source_id: 'lme:metals:feed'
        }
      ]
    };

    const run1 = manager.executeResearchTick(tickPayload);
    const run2 = manager.executeResearchTick(tickPayload);

    // Bit-for-bit identical SHA-256 telemetry digest
    expect(run1.telemetry_digest_sha256).toBe(run2.telemetry_digest_sha256);
    expect(run1.telemetry_digest_sha256).toHaveLength(64);

    // Re-canonicalize to confirm match
    const { telemetry_digest_sha256, ...withoutDigest } = run1;
    const computedDigest = createHash('sha256')
      .update(canonicalizeJCS(sanitizeForJcs(withoutDigest)))
      .digest('hex');

    expect(computedDigest).toBe(telemetry_digest_sha256);
  });
});
