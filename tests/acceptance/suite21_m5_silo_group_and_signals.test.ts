/**
 * SUITE-21: Gate M5 6-Channel Signal Bus, 4D Evidence Architecture,
 * and Silo vs. Simultaneous Group Strategy Simulator Acceptance Suite
 *
 * Normative Acceptance Suite for Stage 3 Gate M5:
 * 1. M5-4D-EVIDENCE-ORTHOGONALITY-001: 4D evidence dimensions and fail-closed promotion firewall.
 * 2. M5-SIX-CHANNEL-SIGNAL-INGEST-002: 6-channel signal normalization & 9-stage DAG pipeline.
 * 3. M5-SIX-STATUS-VOCABULARY-003: 6-status return vocabulary preventing 0% collapse.
 * 4. M5-SILO-PACK-SIZE-MATRIX-004: SS304 DIN 3017 matrix (4 sizes x 2 packs), price bands, J-curves, Greeks.
 * 5. M5-SIMULTANEOUS-GROUP-CORRELATION-005: Portfolio allocation, LME steel shock, T-Bill sweep, conservation.
 * 6. M5-CONVICTION-VS-ALLOCATION-SEPARATION-006: Firewall rejecting unverified listings (₹0 capital).
 * 7. M5-TRADING-CHART-JCS-DETERMINISM-007: Bit-for-bit RFC 8785 JCS telemetry attestation.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import {
  EvidenceKind,
  EvidenceVerificationStatus,
  CommercialStatus,
  createEvidenceEnvelope,
  EvidencePromotionEngine,
  SignalNormalizer,
  RawSignalInput,
  resolveReturnStatus,
  DeepResearchPipelineOrchestrator
} from '../../src/research/m5SignalAndEvidenceEngine.js';
import {
  M5SiloAndGroupSimulator,
  SiloCandidateInput,
  SS304Diameter,
  SS304PackSize
} from '../../src/research/m5SiloAndGroupSimulator.js';
import { OperationalEconomicsParameters } from '../../src/research/m4VerticalSlice.js';

describe('SUITE-21: Gate M5 Signal Bus, 4D Evidence & Silo/Group Simulator Acceptance', () => {
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

  /**
   * Helper to build candidate input for SS304 DIN 3017 matrix
   */
  function createSiloMatrixCandidate(
    diameter: SS304Diameter,
    packSize: SS304PackSize,
    overrides?: Partial<SiloCandidateInput>
  ): SiloCandidateInput {
    // Monotonic cost & price progression based on diameter and pack size
    let rawMaterial = 250000n; // ₹25.0000 for 16-25mm 10-pack
    let grossPrice = 1050000n; // ₹105.0000 for 16-25mm 10-pack
    let moq = 500;

    if (diameter === '20-32mm') {
      rawMaterial = 292900n; // ₹29.2900 -> Landed ~₹42.50
      grossPrice = 1180000n; // ₹118.0000
    } else if (diameter === '25-40mm') {
      rawMaterial = 347900n; // ₹34.7900 -> Landed ~₹48.00
      grossPrice = 1320000n; // ₹132.0000
      moq = 400;
    } else if (diameter === '32-50mm') {
      rawMaterial = 417900n; // ₹41.7900 -> Landed ~₹55.00
      grossPrice = 1500000n; // ₹150.0000
      moq = 400;
    }

    if (packSize === 20) {
      rawMaterial = rawMaterial * 2n - 20000n; // volume discount on 20-pack
      grossPrice = (grossPrice * 18n) / 10n; // bundle discount on retail price
      moq = Math.floor(moq / 2);
    }

    return {
      candidate_id: `cand:ss304:${diameter}:pack-${packSize}`,
      sku_id: `prod:din3017:ss304:${diameter}:pack-${packSize}`,
      diameter,
      pack_size: packSize,
      title: `SS304 DIN 3017 Hose Clamp ${diameter} (Pack of ${packSize})`,
      moq,
      gross_selling_price_subunits: grossPrice,
      raw_material_purchase_subunits: rawMaterial,
      inbound_freight_subunits: 45000n, // ₹4.5000
      packaging_kitting_subunits: packSize === 10 ? 32000n : 52000n,
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
  // TEST 1: M5-4D-EVIDENCE-ORTHOGONALITY-001
  // ==========================================================================
  it('M5-4D-EVIDENCE-ORTHOGONALITY-001: Enforces 4D evidence dimensions and blocks illegal promotion to verified offer without cryptographic attestation or corroboration', () => {
    // 1. Create an unverified advertised listing envelope
    const listingEnvelope = createEvidenceEnvelope({
      evidence_id: 'ev:indiamart:howrah:ss304-1625',
      kind: 'OBSERVED_FACT' as EvidenceKind,
      verification_status: 'UNVERIFIED' as EvidenceVerificationStatus,
      commercial_status: 'ADVERTISED_LISTING' as CommercialStatus,
      provenance: {
        source_id: 'src:indiamart:public-listing',
        channel: 'NEWS_TRADE_PRESS',
        observed_at_utc: REF_TIME,
        ttl_seconds: 86400
      },
      payload: {
        advertised_rate_inr: 25.0,
        supplier_claimed_name: 'Howrah Clamp Works'
      }
    });

    expect(listingEnvelope.jcs_hash).toHaveLength(64);
    expect(listingEnvelope.commercial_status).toBe('ADVERTISED_LISTING');
    expect(listingEnvelope.verification_status).toBe('UNVERIFIED');

    // 2. Promotion Firewall Invariant: Attempting to promote to VERIFIED_EXECUTABLE_OFFER
    // without attestation signature or corroborating source IDs MUST throw E-ERR-EV-001
    expect(() => {
      EvidencePromotionEngine.promoteCommercialStatus(
        listingEnvelope,
        'VERIFIED_EXECUTABLE_OFFER'
      );
    }).toThrow(/E-ERR-EV-001: ILLEGAL_EVIDENCE_PROMOTION/);

    // 3. Promote with valid cryptographic signature attestation
    const attestedEnvelope = EvidencePromotionEngine.promoteCommercialStatus(
      listingEnvelope,
      'VERIFIED_EXECUTABLE_OFFER',
      { attestation_signature: 'sig:rsa4096:mock-valid-cert-anchor-001' }
    );

    expect(attestedEnvelope.commercial_status).toBe('VERIFIED_EXECUTABLE_OFFER');
    expect(attestedEnvelope.verification_status).toBe('CRYPTOGRAPHICALLY_ATTESTED');
    expect(attestedEnvelope.attestation_signature).toBe('sig:rsa4096:mock-valid-cert-anchor-001');
    expect(attestedEnvelope.jcs_hash).toHaveLength(64);

    // 4. Promote with 2 independent corroborating sources
    const corroboratedEnvelope = EvidencePromotionEngine.promoteCommercialStatus(
      listingEnvelope,
      'VERIFIED_EXECUTABLE_OFFER',
      { corroborating_source_ids: ['supp:src-01-howrah', 'supp:src-02-mumbai-trader'] }
    );

    expect(corroboratedEnvelope.commercial_status).toBe('VERIFIED_EXECUTABLE_OFFER');
    expect(corroboratedEnvelope.verification_status).toBe('CROSS_SOURCE_CORROBORATED');

    // 5. Conviction Score evaluation: Attested envelope has high score (>= 70), unverified has low score (<= 30)
    const highConviction = EvidencePromotionEngine.computeConvictionScore([attestedEnvelope]);
    const lowConviction = EvidencePromotionEngine.computeConvictionScore([listingEnvelope]);

    expect(highConviction).toBeGreaterThanOrEqual(70);
    expect(lowConviction).toBeLessThanOrEqual(30);
  });

  // ==========================================================================
  // TEST 2: M5-SIX-CHANNEL-SIGNAL-INGEST-002
  // ==========================================================================
  it('M5-SIX-CHANNEL-SIGNAL-INGEST-002: Normalizes testable signals across all 6 operational channels into typed economic factor shocks with JCS integrity', () => {
    const rawSignals: RawSignalInput[] = [
      {
        signal_id: 'sig:news:freight-delay-001',
        channel: 'NEWS_TRADE_PRESS',
        source_id: 'source:economic-times-logistics',
        observed_at_utc: REF_TIME,
        ttl_seconds: 86400,
        data: { freight_delay_bps: 500, headline: 'Port Congestion Nhava Sheva' }
      },
      {
        signal_id: 'sig:yt:review-defect-002',
        channel: 'YOUTUBE_VIDEO_TRANSCRIPT',
        source_id: 'source:industrial-mechanic-channel',
        observed_at_utc: REF_TIME,
        ttl_seconds: 604800,
        data: { defect_complaint_bps: 300, channel_name: 'Workshop Tools India' }
      },
      {
        signal_id: 'sig:soc:seller-forum-003',
        channel: 'SOCIAL_FORUM_CHATTER',
        source_id: 'source:seller-forum-india',
        observed_at_utc: REF_TIME,
        ttl_seconds: 43200,
        data: { breakage_report_bps: 400, platform: 'SellerCentralForum' }
      },
      {
        signal_id: 'sig:macro:rbi-rate-004',
        channel: 'MACROECONOMIC_INDICATOR',
        source_id: 'source:rbi-bulletin',
        observed_at_utc: REF_TIME,
        ttl_seconds: 2592000,
        data: { tbill_yield_bps: 650, value_bps: 650 }
      },
      {
        signal_id: 'sig:lat:lme-steel-005',
        channel: 'LATERAL_FINANCIAL_MARKET',
        source_id: 'source:lme-metals-feed',
        observed_at_utc: REF_TIME,
        ttl_seconds: 3600,
        data: { steel_coil_inflation_bps: 1000, symbol: 'SS304_COIL' }
      },
      {
        signal_id: 'sig:gov:msme-circular-006',
        channel: 'GOVERNMENT_SCHEME_POLICY',
        source_id: 'source:cbic-circular-dept',
        observed_at_utc: REF_TIME,
        ttl_seconds: 31536000,
        data: { customs_duty_bps: 1200, statutory_act: 'Customs Tariff Act 2026' }
      }
    ];

    // Ingest and normalize all 6 signals
    const normalized = rawSignals.map((s) => SignalNormalizer.normalizeSignal(s));

    expect(normalized).toHaveLength(6);
    expect(normalized[0].economic_factor_name).toBe('INBOUND_LOGISTICS_LEAD_TIME_SHOCK');
    expect(normalized[0].magnitude_bps).toBe(500n);

    expect(normalized[1].economic_factor_name).toBe('CUSTOMER_RETURN_RATE_SHOCK');
    expect(normalized[1].magnitude_bps).toBe(300n);

    expect(normalized[2].economic_factor_name).toBe('DAMAGED_QUARANTINE_ATTRITION_SHOCK');
    expect(normalized[2].magnitude_bps).toBe(400n);

    expect(normalized[3].economic_factor_name).toBe('RISK_FREE_TBILL_YIELD');
    expect(normalized[3].magnitude_bps).toBe(650n);

    expect(normalized[4].economic_factor_name).toBe('RAW_MATERIAL_LME_STEEL_SHOCK');
    expect(normalized[4].magnitude_bps).toBe(1000n);

    expect(normalized[5].economic_factor_name).toBe('STATUTORY_CUSTOMS_DUTY_SHOCK');
    expect(normalized[5].magnitude_bps).toBe(1200n);

    // Verify JCS hashes
    for (const norm of normalized) {
      expect(norm.jcs_hash).toHaveLength(64);
    }

    // Test 9-Stage "Deep Research Pro" Pipeline Orchestrator Contract
    const orchestrator = new DeepResearchPipelineOrchestrator();
    const researchRecord = orchestrator.executeResearchWorkflow({
      query_id: 'query:ss304:matrix-research',
      thesis: 'SS304 DIN 3017 clamp Howrah manufacturing versus Amazon retail arbitrage',
      signals: rawSignals
    });

    expect(researchRecord.stages_completed).toEqual([
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
    expect(researchRecord.signals_ingested).toBe(6);
    expect(researchRecord.evidence_envelopes).toHaveLength(6);
    expect(researchRecord.telemetry_digest_sha256).toHaveLength(64);
  });

  // ==========================================================================
  // TEST 3: M5-SIX-STATUS-VOCABULARY-003
  // ==========================================================================
  it('M5-SIX-STATUS-VOCABULARY-003: Distinguishes incomplete and unrecovered lifecycles rather than collapsing them to 0% return', () => {
    // 1. Missing mandatory inputs
    const missingInputsResult = resolveReturnStatus({
      hasMissingMandatoryInputs: true,
      hasUnverifiedEvidence: false,
      isOpenPosition: false,
      isRecovered: false,
      solverConverged: true
    });
    expect(missingInputsResult.status).toBe('CANNOT_CALCULATE_MISSING_INPUTS');
    expect(missingInputsResult.annualized_rowc_bps).toBeUndefined();

    // 2. Unverified evidence
    const unverifiedResult = resolveReturnStatus({
      hasMissingMandatoryInputs: false,
      hasUnverifiedEvidence: true,
      isOpenPosition: false,
      isRecovered: false,
      solverConverged: true
    });
    expect(unverifiedResult.status).toBe('INSUFFICIENT_UNVERIFIED_EVIDENCE');
    expect(unverifiedResult.annualized_rowc_bps).toBeUndefined();

    // 3. Polynomial solver failed to converge
    const solverFailResult = resolveReturnStatus({
      hasMissingMandatoryInputs: false,
      hasUnverifiedEvidence: false,
      isOpenPosition: false,
      isRecovered: false,
      solverConverged: false
    });
    expect(solverFailResult.status).toBe('NO_ROOT_FOUND_IN_SEARCH_DOMAIN');

    // 4. Open position (active inventory / in-transit)
    const openPosResult = resolveReturnStatus({
      hasMissingMandatoryInputs: false,
      hasUnverifiedEvidence: false,
      isOpenPosition: true,
      isRecovered: false,
      solverConverged: true
    });
    expect(openPosResult.status).toBe('OPEN_POSITION');

    // 5. Not yet recovered (capital deployed, cumulative cash < 0)
    const unrecoveredResult = resolveReturnStatus({
      hasMissingMandatoryInputs: false,
      hasUnverifiedEvidence: false,
      isOpenPosition: false,
      isRecovered: false,
      solverConverged: true
    });
    expect(unrecoveredResult.status).toBe('NOT_YET_RECOVERED');

    // 6. Complete verified lifecycle
    const validResult = resolveReturnStatus({
      hasMissingMandatoryInputs: false,
      hasUnverifiedEvidence: false,
      isOpenPosition: false,
      isRecovered: true,
      solverConverged: true,
      calculatedRoWcBps: 39912n
    });
    expect(validResult.status).toBe('VALID_CALCULATED_RETURN');
    expect(validResult.annualized_rowc_bps).toBe('39912');
  });

  // ==========================================================================
  // TEST 4: M5-SILO-PACK-SIZE-MATRIX-004
  // ==========================================================================
  it('M5-SILO-PACK-SIZE-MATRIX-004: Evaluates SS304 DIN 3017 clamps across 4 diameters and 2 pack hypotheses with price bands, J-curves, and Arbitrage Greeks', () => {
    const diameters: SS304Diameter[] = ['16-25mm', '20-32mm', '25-40mm', '32-50mm'];
    const packSizes: SS304PackSize[] = [10, 20];

    const results = [];

    for (const diameter of diameters) {
      for (const pack of packSizes) {
        const cand = createSiloMatrixCandidate(diameter, pack);
        const res = M5SiloAndGroupSimulator.runSiloSimulation(cand);
        results.push(res);

        // Check valid return status
        expect(res.return_status).toBe('VALID_CALCULATED_RETURN');
        expect(BigInt(res.annualized_rowc_bps)).toBeGreaterThan(0n);

        // Check price and breakeven bands
        const grossPrice = BigInt(res.price_and_breakeven_bands.gross_selling_price);
        const breakevenFloor = BigInt(res.price_and_breakeven_bands.breakeven_floor);
        const landedCost = BigInt(res.price_and_breakeven_bands.unit_landed_cost);

        expect(grossPrice).toBeGreaterThan(breakevenFloor);
        expect(breakevenFloor).toBeGreaterThan(landedCost);

        // Check J-Curve series: Day 0 negative, Day 35 positive
        expect(res.cash_flow_j_curve_series).toHaveLength(4);
        expect(BigInt(res.cash_flow_j_curve_series[0].cumulative_cash_subunits)).toBeLessThan(0n);
        expect(BigInt(res.cash_flow_j_curve_series[3].cumulative_cash_subunits)).toBeGreaterThan(0n);

        // Check Arbitrage Greeks
        const delta = BigInt(res.arbitrage_greeks_sensitivity.delta_bps_per_inr);
        const theta = BigInt(res.arbitrage_greeks_sensitivity.theta_bps_per_day);
        const vega = BigInt(res.arbitrage_greeks_sensitivity.vega_bps_per_100bps_returns);

        expect(delta).toBeGreaterThan(0n); // Higher price increases RoWC
        expect(theta).toBeLessThan(0n); // Longer dwell decays RoWC
        expect(vega).toBeLessThan(0n); // Higher return drag decreases RoWC
      }
    }

    // Verify strict monotonicity across 10-packs
    const tenPackResults = results.filter((r) => r.pack_size === 10);
    for (let i = 0; i < tenPackResults.length - 1; i++) {
      const costCurrent = BigInt(tenPackResults[i].unit_landed_cost_subunits);
      const costNext = BigInt(tenPackResults[i + 1].unit_landed_cost_subunits);
      expect(costNext).toBeGreaterThan(costCurrent);
    }

    // Verify 20-pack landed cost > 10-pack landed cost for each diameter
    for (const diam of diameters) {
      const ten = results.find((r) => r.diameter === diam && r.pack_size === 10)!;
      const twenty = results.find((r) => r.diameter === diam && r.pack_size === 20)!;
      expect(BigInt(twenty.unit_landed_cost_subunits)).toBeGreaterThan(
        BigInt(ten.unit_landed_cost_subunits)
      );
    }
  });

  // ==========================================================================
  // TEST 5: M5-SIMULTANEOUS-GROUP-CORRELATION-005
  // ==========================================================================
  it('M5-SIMULTANEOUS-GROUP-CORRELATION-005: Simulates portfolio allocation under ₹50,000 treasury budget, correlated LME steel shock, concentration limits, and T-Bill sweep', () => {
    // Build cohort candidates
    const candidates = [
      createSiloMatrixCandidate('16-25mm', 10),
      createSiloMatrixCandidate('20-32mm', 10),
      createSiloMatrixCandidate('25-40mm', 10),
      createSiloMatrixCandidate('32-50mm', 10)
    ];

    // Correlated lateral shock: LME Stainless Steel coil surges by +1000 bps (+10%)
    const lmeShock = SignalNormalizer.normalizeSignal({
      signal_id: 'sig:lme:steel-surge-10pct',
      channel: 'LATERAL_FINANCIAL_MARKET',
      source_id: 'source:lme-market-feed',
      observed_at_utc: REF_TIME,
      ttl_seconds: 7200,
      data: { change_24h_bps: 1000, symbol: 'SS304_COIL' }
    });

    const groupResult = M5SiloAndGroupSimulator.runGroupSimulation(candidates, {
      treasury_budget_subunits: TOTAL_BUDGET,
      max_single_candidate_concentration_bps: 5000n, // 50%
      tbill_yield_bps: 650n,
      nifty_liquid_yield_bps: 680n,
      correlated_shocks: [lmeShock]
    });

    // 1. Shocks recorded
    expect(groupResult.correlated_shocks_applied).toContain('RAW_MATERIAL_LME_STEEL_SHOCK');

    // 2. Budget conservation verified
    const totalAllocated = BigInt(groupResult.total_allocated_capital_subunits);
    const tbillSweep = BigInt(groupResult.tbill_sweep_subunits);
    expect(totalAllocated + tbillSweep).toBe(TOTAL_BUDGET);
    expect(groupResult.conservation_verified).toBe(true);

    // 3. Allocations exist and respect single-SKU concentration limit (<= 50% = 250,000,000 subunits)
    expect(groupResult.allocations.length).toBeGreaterThan(0);
    for (const alloc of groupResult.allocations) {
      const cap = BigInt(alloc.allocated_capital_subunits);
      expect(cap).toBeLessThanOrEqual(250000000n);
      const cand = candidates.find((c) => c.sku_id === alloc.sku_id)!;
      expect(alloc.allocated_units).toBe(alloc.allocated_lots * cand.moq);
    }

    // 4. Benchmarks evaluated
    expect(groupResult.benchmarks.rbi_91d_tbill_yield_bps).toBe('650');
    expect(groupResult.benchmarks.nifty_liquid_benchmark_yield_bps).toBe('680');
    expect(BigInt(groupResult.benchmarks.effective_portfolio_rowc_bps)).toBeGreaterThan(650n);
    expect(BigInt(groupResult.benchmarks.excess_over_tbill_bps)).toBeGreaterThan(0n);
  });

  // ==========================================================================
  // TEST 6: M5-CONVICTION-VS-ALLOCATION-SEPARATION-006
  // ==========================================================================
  it('M5-CONVICTION-VS-ALLOCATION-SEPARATION-006: Enforces conviction-allocation firewall: unverified high-margin candidate receives ₹0 capital while verified candidate is funded', () => {
    // Candidate A: High gross margin (₹200 selling price on ₹25 cost), but UNVERIFIED (public IndiaMART listing)
    const unverifiedCandidate = createSiloMatrixCandidate('16-25mm', 10, {
      candidate_id: 'cand:unverified:howrah-listing-001',
      title: 'Unverified Web Listing Claiming ₹25/unit',
      gross_selling_price_subunits: 2000000n, // ₹200.0000
      raw_material_purchase_subunits: 250000n,
      is_verified: false // UNVERIFIED!
    });

    // Candidate B: Normal gross margin (₹105 selling price on ₹38.21 cost), but VERIFIED with cryptographic attestation
    const verifiedCandidate = createSiloMatrixCandidate('16-25mm', 10, {
      candidate_id: 'cand:verified:metalcraft-quote-002',
      title: 'Verified Supplier Executable Quote',
      gross_selling_price_subunits: 1050000n, // ₹105.0000
      raw_material_purchase_subunits: 250000n,
      is_verified: true // VERIFIED!
    });

    const result = M5SiloAndGroupSimulator.runGroupSimulation(
      [unverifiedCandidate, verifiedCandidate],
      {
        treasury_budget_subunits: TOTAL_BUDGET
      }
    );

    // Assert: Candidate A receives ₹0 capital
    const candAAllocation = result.allocations.find(
      (a) => a.candidate_id === 'cand:unverified:howrah-listing-001'
    );
    expect(candAAllocation).toBeUndefined();

    const candARejection = result.rejected_candidates.find(
      (r) => r.candidate_id === 'cand:unverified:howrah-listing-001'
    );
    expect(candARejection).toBeDefined();
    expect(candARejection!.allocated_capital_subunits).toBe('0');
    expect(candARejection!.rejection_reasons.some((r) => r.includes('E-M5-UNVERIFIED-PROVENANCE'))).toBe(true);

    // Assert: Candidate B receives capital
    const candBAllocation = result.allocations.find(
      (a) => a.candidate_id === 'cand:verified:metalcraft-quote-002'
    );
    expect(candBAllocation).toBeDefined();
    expect(BigInt(candBAllocation!.allocated_capital_subunits)).toBeGreaterThan(0n);

    // Assert Bubble Points:
    const bubbleA = result.bubble_chart_points.find(
      (p) => p.candidate_id === 'cand:unverified:howrah-listing-001'
    )!;
    const bubbleB = result.bubble_chart_points.find(
      (p) => p.candidate_id === 'cand:verified:metalcraft-quote-002'
    )!;

    expect(bubbleA.x_conviction_score).toBeLessThanOrEqual(30);
    expect(bubbleA.z_allocated_capital_subunits).toBe('0');

    expect(bubbleB.x_conviction_score).toBeGreaterThanOrEqual(70);
    expect(BigInt(bubbleB.z_allocated_capital_subunits)).toBeGreaterThan(0n);
  });

  // ==========================================================================
  // TEST 7: M5-TRADING-CHART-JCS-DETERMINISM-007
  // ==========================================================================
  it('M5-TRADING-CHART-JCS-DETERMINISM-007: Guarantees bit-for-bit RFC 8785 JCS determinism and SHA-256 digest reproducibility across simulation runs', () => {
    const candidates = [
      createSiloMatrixCandidate('16-25mm', 10),
      createSiloMatrixCandidate('20-32mm', 10),
      createSiloMatrixCandidate('25-40mm', 10),
      createSiloMatrixCandidate('32-50mm', 10)
    ];

    const run1 = M5SiloAndGroupSimulator.runGroupSimulation(candidates, {
      treasury_budget_subunits: TOTAL_BUDGET
    });

    const run2 = M5SiloAndGroupSimulator.runGroupSimulation(candidates, {
      treasury_budget_subunits: TOTAL_BUDGET
    });

    // Bit-for-bit identical SHA-256 telemetry digest
    expect(run1.telemetry_digest_sha256).toBe(run2.telemetry_digest_sha256);
    expect(run1.telemetry_digest_sha256).toHaveLength(64);

    // Verify that direct JCS canonicalization of the result matches the stored digest
    const { telemetry_digest_sha256, ...payloadWithoutDigest } = run1;
    const computedHash = createHash('sha256')
      .update(canonicalizeJCS(payloadWithoutDigest))
      .digest('hex');

    expect(computedHash).toBe(telemetry_digest_sha256);
  });
});
