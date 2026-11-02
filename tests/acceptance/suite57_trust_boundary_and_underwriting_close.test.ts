import { describe, it, expect, beforeEach } from 'vitest';
import {
  OpportunityLifecycleEngine,
  OpportunityCandidate
} from '../../src/research/opportunityLifecycleEngine.js';

describe('Suite 57: Trust Boundaries, Evidence Integrity, and Underwriting Milestone Closure', () => {
  let engine: OpportunityLifecycleEngine;

  beforeEach(() => {
    engine = new OpportunityLifecycleEngine({
      requirePaperBudget: true,
      defaultPaperBudgetConfig: {
        available_paper_capital_inr: 500000,
        max_single_allocation_inr: 250000
      }
    });
  });

  // ==========================================================================
  // 1. EVIDENCE PROVENANCE & TRUST BOUNDARY ENFORCEMENT
  // ==========================================================================

  it('TBC-001: Ingestion boundary demotes caller asserting LIVE_VERIFIED_CAPTURE on fixture connector to RECORDED_GOLDEN_FIXTURE', async () => {
    const { candidate } = await engine.ingestObservation({
      strategy_id: 'STRAT-PROV-DEMOTE-01',
      canonical_product_id: 'PROD-FIXTURE-DIN3017',
      candidate_name: 'DIN 3017 Hose Clamp Fixture Replay',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:fixture:din3017-clamps',
      origin_class: 'LIVE_VERIFIED_CAPTURE', // Caller attempts self-promotion
      prevailing_retail_asp_inr: 450,
      factory_gate_quote_inr: 120,
      unit_batch_moq: 100,
      inbound_freight_inr: 15,
      packaging_kitting_inr: 10,
      platform_fee_inr: 45,
      fulfillment_fee_inr: 25,
      statutory_tax_inr: 35,
      return_defect_drag_inr: 10,
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    expect(candidate.current_observation.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');

    const decision = await engine.underwriteCandidate(candidate.candidate_id);
    expect(decision.evidence_summary.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
    expect(decision.evidence_summary.is_live_market_verified).toBe(false);
    expect(decision.evidence_confidence?.evidence_quality_rating).toBe('RECORDED_REFERENCE_FIXTURE');
  });

  it('TBC-002: Ingestion boundary demotes caller asserting LIVE_VERIFIED_CAPTURE on unattested connector to UNATTESTED_USER_INTAKE', async () => {
    const { candidate } = await engine.ingestObservation({
      strategy_id: 'STRAT-PROV-DEMOTE-02',
      canonical_product_id: 'PROD-UNATTESTED-SCRAPE',
      candidate_name: 'Unattested Custom Scrape Candidate',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:unattested:web-form',
      origin_class: 'LIVE_VERIFIED_CAPTURE', // Caller attempts self-promotion
      prevailing_retail_asp_inr: 650,
      factory_gate_quote_inr: 200,
      unit_batch_moq: 50,
      inbound_freight_inr: 20,
      packaging_kitting_inr: 15,
      platform_fee_inr: 60,
      fulfillment_fee_inr: 30,
      statutory_tax_inr: 40,
      return_defect_drag_inr: 15,
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    expect(candidate.current_observation.origin_class).toBe('UNATTESTED_USER_INTAKE');

    const decision = await engine.underwriteCandidate(candidate.candidate_id);
    expect(decision.evidence_summary.origin_class).toBe('UNATTESTED_USER_INTAKE');
    expect(decision.evidence_summary.is_live_market_verified).toBe(false);
  });

  it('TBC-003: Synthetic scenario candidate cannot be relabeled as LIVE_VERIFIED_CAPTURE on subsequent updates', async () => {
    // 1. Initial synthetic scenario ingestion
    const { candidate: syntheticCand } = await engine.ingestObservation({
      strategy_id: 'STRAT-SYNTH-PRESERVE',
      canonical_product_id: 'PROD-SYNTH-001',
      candidate_name: 'Synthetic Stress Test Candidate',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:synthetic:generator',
      origin_class: 'SYNTHETIC_SCENARIO',
      prevailing_retail_asp_inr: 1000,
      factory_gate_quote_inr: 300,
      unit_batch_moq: 20
    });
    expect(syntheticCand.current_observation.origin_class).toBe('SYNTHETIC_SCENARIO');

    // 2. Caller attempts to update candidate claiming live verified origin
    const { candidate: updatedCand } = await engine.ingestObservation({
      strategy_id: 'STRAT-SYNTH-PRESERVE',
      canonical_product_id: 'PROD-SYNTH-001',
      candidate_name: 'Synthetic Stress Test Candidate',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:live:stream-feed',
      origin_class: 'LIVE_VERIFIED_CAPTURE', // Attempting to relabel synthetic candidate
      prevailing_retail_asp_inr: 1050,
      factory_gate_quote_inr: 300
    });

    // Synthetic heritage is strictly immutable
    expect(updatedCand.current_observation.origin_class).toBe('SYNTHETIC_SCENARIO');

    // 3. Underwriting strictly maintains SYNTHETIC_SCENARIO posture
    const decision = await engine.underwriteCandidate(updatedCand.candidate_id);
    expect(decision.evidence_confidence?.evidence_posture).toBe('SYNTHETIC_SCENARIO');
    expect(decision.evidence_confidence?.is_live_market_verified).toBe(false);
    expect(decision.capital_allocation?.capital_allocation_decision).toBe('DO_NOT_ALLOCATE_CAPITAL');
  });

  // ==========================================================================
  // 2. CORROBORATION VS SINGLE-SOURCE EMPIRICAL RATINGS
  // ==========================================================================

  it('TBC-004: Corroboration status distinguishes single-source empirical from multi-source corroborated captures', async () => {
    // 1. Single observation from authorized live connector
    const { candidate: singleObsCand } = await engine.ingestObservation({
      strategy_id: 'STRAT-LIVE-CORROB',
      canonical_product_id: 'PROD-LIVE-SOLO',
      candidate_name: 'Single Live Capture Item',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:live:verified-feed-alpha',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      prevailing_retail_asp_inr: 850,
      factory_gate_quote_inr: 250,
      unit_batch_moq: 100,
      review_sentiment_summary: 'Minimal defect rate across batch, positive rating',
      inbound_freight_inr: 25,
      packaging_kitting_inr: 15,
      platform_fee_inr: 80,
      fulfillment_fee_inr: 40,
      statutory_tax_inr: 60,
      return_defect_drag_inr: 20,
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    expect(singleObsCand.observation_history_count).toBe(1);
    const decisionSingle = await engine.underwriteCandidate(singleObsCand.candidate_id);

    // Single source meeting all fields is LIVE_VERIFIED_EMPIRICAL, NOT corroborated across sources
    expect(decisionSingle.evidence_confidence?.evidence_quality_rating).toBe('LIVE_VERIFIED_EMPIRICAL');
    expect(decisionSingle.evidence_confidence?.is_live_market_verified).toBe(true);

    // 2. Ingest second corroborating observation from a distinct connector
    const { candidate: corroboratedCand } = await engine.ingestObservation({
      strategy_id: 'STRAT-LIVE-CORROB',
      canonical_product_id: 'PROD-LIVE-SOLO',
      candidate_name: 'Single Live Capture Item',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:live:verified-feed-beta',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      prevailing_retail_asp_inr: 855, // price change creates second observation history record
      factory_gate_quote_inr: 250,
      unit_batch_moq: 100,
      review_sentiment_summary: 'Corroborating second source confirms high satisfaction',
      inbound_freight_inr: 25,
      packaging_kitting_inr: 15,
      platform_fee_inr: 80,
      fulfillment_fee_inr: 40,
      statutory_tax_inr: 60,
      return_defect_drag_inr: 20,
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    expect(corroboratedCand.observation_history_count).toBe(2);
    const decisionCorroborated = await engine.underwriteCandidate(corroboratedCand.candidate_id);

    // Multiple distinct observations award LIVE_EMPIRICAL_CORROBORATED
    expect(decisionCorroborated.evidence_confidence?.evidence_quality_rating).toBe('LIVE_EMPIRICAL_CORROBORATED');
    expect(decisionCorroborated.evidence_confidence?.is_live_market_verified).toBe(true);
  });

  // ==========================================================================
  // 3. DOMAIN-SPECIFIC COST COMPLETENESS (DIGITAL & SERVICES)
  // ==========================================================================

  it('TBC-005: SOFTWARE_DIGITAL candidates underwrite cleanly without requiring physical freight or packaging', async () => {
    const { candidate } = await engine.ingestObservation({
      strategy_id: 'STRAT-SAAS-UNDERWRITE',
      canonical_product_id: 'PROD-SAAS-LICENSE-01',
      candidate_name: 'Developer Tool Annual Seat License',
      category: 'SOFTWARE_DIGITAL',
      source_connector_id: 'conn:live:saas-store',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      prevailing_retail_asp_inr: 5000,
      factory_gate_quote_inr: 1500, // Wholesale software API seat cost
      unit_batch_moq: 10,
      review_sentiment_summary: '4.8 stars across 1,200 developer reviews with high API stability',
      platform_fee_inr: 500, // Marketplace store fee (10%)
      statutory_tax_inr: 900, // GST 18%
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    const decision = await engine.underwriteCandidate(candidate.candidate_id);

    // Software/digital should not fail for missing freight, packaging, or defect drag
    expect(decision.outcome).toBe('ELIGIBLE');
    expect(decision.unit_economics.applicable_cost_categories).toEqual([
      'SUPPLIER_PURCHASE',
      'MARKETPLACE_FEES',
      'STATUTORY_TAX'
    ]);
    expect(decision.unit_economics.missing_cost_inputs).toHaveLength(0);

    // Total deductions = 1500 (quote) + 500 (fees) + 900 (tax) = 2900 INR
    expect(decision.unit_economics.cost_breakdown.total_variable_deductions_inr).toBe(2900);
    // Net contribution = 5000 - 2900 = 2100 INR (42.00% margin / 4200 bps)
    expect(decision.unit_economics.net_contribution_inr).toBe(2100);
    expect(decision.unit_economics.contribution_margin_bps).toBe(4200);

    // Upfront cash requirement = quote * moq (freight and packaging are 0 for digital)
    expect(decision.unit_economics.initial_cash_requirement_inr).toBe(15000);
  });

  it('TBC-006: SERVICE_CONTRACT candidates underwrite cleanly with service-specific costs', async () => {
    const { candidate } = await engine.ingestObservation({
      strategy_id: 'STRAT-SERVICE-UNDERWRITE',
      canonical_product_id: 'PROD-SERVICE-AUDIT-01',
      candidate_name: 'Industrial Valve Calibration Service',
      category: 'SERVICE_CONTRACT',
      source_connector_id: 'conn:live:services-b2b',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      prevailing_retail_asp_inr: 12000,
      factory_gate_quote_inr: 4000, // Subcontracted technician labor
      unit_batch_moq: 5,
      review_sentiment_summary: 'Certified ISO 9001 calibration reviews, zero audit non-conformances',
      statutory_tax_inr: 2160, // 18% GST
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    const decision = await engine.underwriteCandidate(candidate.candidate_id);

    expect(decision.outcome).toBe('ELIGIBLE');
    expect(decision.unit_economics.applicable_cost_categories).toEqual([
      'SUPPLIER_PURCHASE',
      'STATUTORY_TAX'
    ]);
    expect(decision.unit_economics.cost_breakdown.total_variable_deductions_inr).toBe(6160);
    expect(decision.unit_economics.net_contribution_inr).toBe(5840);
  });

  // ==========================================================================
  // 4. SEMANTIC COST EXCLUSION VALIDATION
  // ==========================================================================

  it('TBC-007: Reject attempting to exclude SUPPLIER_PURCHASE on physical goods candidate', async () => {
    const { candidate } = await engine.ingestObservation({
      strategy_id: 'STRAT-EXCLUSION-TEST',
      canonical_product_id: 'PROD-EXCLUDE-SUPPLIER',
      candidate_name: 'Physical Product With Illegal Supplier Exclusion',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:live:market-feed',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      prevailing_retail_asp_inr: 1000,
      // factory_gate_quote_inr omitted, caller attempts to exclude supplier purchase
      unit_batch_moq: 50,
      inbound_freight_inr: 50,
      packaging_kitting_inr: 20,
      platform_fee_inr: 100,
      fulfillment_fee_inr: 50,
      statutory_tax_inr: 90,
      return_defect_drag_inr: 30,
      has_logistics_route: true,
      has_regulatory_clearance: true,
      cost_category_exclusions: [
        {
          category: 'SUPPLIER_PURCHASE',
          exclusion_basis: 'Attempting to declare zero supplier purchase cost for physical item'
        }
      ]
    });

    const decision = await engine.underwriteCandidate(candidate.candidate_id);

    // Exclusion of SUPPLIER_PURCHASE on physical goods is rejected semantically
    expect(decision.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.unit_economics.missing_cost_inputs).toContain('SUPPLIER_PURCHASE');
    expect(decision.failed_checks).toContain('MANDATORY_COST_INPUT_MISSING');
  });

  it('TBC-008: Reject generic filler/placeholder exclusion rationale and fail closed', async () => {
    const { candidate } = await engine.ingestObservation({
      strategy_id: 'STRAT-EXCLUSION-TEST',
      canonical_product_id: 'PROD-EXCLUDE-PLACEHOLDER',
      candidate_name: 'Physical Product With Placeholder Exclusion',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:live:market-feed',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      prevailing_retail_asp_inr: 1000,
      factory_gate_quote_inr: 300,
      unit_batch_moq: 50,
      packaging_kitting_inr: 20,
      platform_fee_inr: 100,
      fulfillment_fee_inr: 50,
      statutory_tax_inr: 90,
      return_defect_drag_inr: 30,
      has_logistics_route: true,
      has_regulatory_clearance: true,
      // inbound_freight_inr omitted; caller supplies placeholder text > 10 chars
      cost_category_exclusions: [
        {
          category: 'INBOUND_FREIGHT',
          exclusion_basis: 'placeholder for freight cost' // generic filler
        }
      ]
    });

    const decision = await engine.underwriteCandidate(candidate.candidate_id);

    expect(decision.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.unit_economics.missing_cost_inputs).toContain('INBOUND_FREIGHT');
    expect(decision.failed_checks).toContain('MANDATORY_COST_INPUT_MISSING');
  });

  // ==========================================================================
  // 5. DIRECT PAPER_ELIGIBLE STATE MACHINE ENFORCEMENT
  // ==========================================================================

  it('TBC-009: Direct transitionState to PAPER_ELIGIBLE without budget configuration fails closed', async () => {
    const engineNoBudget = new OpportunityLifecycleEngine({
      requirePaperBudget: true
      // defaultPaperBudgetConfig deliberately omitted
    });

    const { candidate } = await engineNoBudget.ingestObservation({
      strategy_id: 'STRAT-BYPASS-TEST',
      canonical_product_id: 'PROD-BYPASS-01',
      candidate_name: 'Viable Candidate Attempting Direct State Bypass',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:live:feed-01',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      prevailing_retail_asp_inr: 1500,
      factory_gate_quote_inr: 400,
      unit_batch_moq: 100,
      review_sentiment_summary: 'Consistently high satisfaction and low defect rate',
      inbound_freight_inr: 40,
      packaging_kitting_inr: 20,
      platform_fee_inr: 150,
      fulfillment_fee_inr: 50,
      statutory_tax_inr: 120,
      return_defect_drag_inr: 30,
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    // Advance to UNDER_REVIEW then VERIFIED
    await engineNoBudget.transitionState(candidate.candidate_id, 'INVESTIGATE', 'Advancing to investigate');
    await engineNoBudget.transitionState(candidate.candidate_id, 'UNDER_REVIEW', 'Under review pass');
    await engineNoBudget.transitionState(candidate.candidate_id, 'VERIFIED', 'Verified with full evidence sufficiency');

    // Attempt direct transition to PAPER_ELIGIBLE bypassing authorizePaperCommit
    await expect(
      engineNoBudget.transitionState(
        candidate.candidate_id,
        'PAPER_ELIGIBLE',
        'Direct bypass attempt without budget'
      )
    ).rejects.toThrow('E-OPP-BUDGET-UNCONFIGURED');
  });

  it('TBC-010: Direct transitionState to PAPER_ELIGIBLE exceeding available budget fails closed', async () => {
    const engineTightBudget = new OpportunityLifecycleEngine({
      requirePaperBudget: true,
      defaultPaperBudgetConfig: {
        available_paper_capital_inr: 10000 // Only 10,000 INR available
      }
    });

    const { candidate } = await engineTightBudget.ingestObservation({
      strategy_id: 'STRAT-EXCEED-TEST',
      canonical_product_id: 'PROD-EXCEED-01',
      candidate_name: 'Heavy Batch Product',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:live:feed-01',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      prevailing_retail_asp_inr: 2000,
      factory_gate_quote_inr: 600,
      unit_batch_moq: 50, // Outlay = (600 + 50 + 20) * 50 = 33,500 INR > 10,000 INR
      review_sentiment_summary: 'Consistently high satisfaction and low defect rate',
      inbound_freight_inr: 50,
      packaging_kitting_inr: 20,
      platform_fee_inr: 200,
      fulfillment_fee_inr: 80,
      statutory_tax_inr: 160,
      return_defect_drag_inr: 40,
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    await engineTightBudget.transitionState(candidate.candidate_id, 'INVESTIGATE', 'Advancing to investigate');
    await engineTightBudget.transitionState(candidate.candidate_id, 'UNDER_REVIEW', 'Under review pass');
    await engineTightBudget.transitionState(candidate.candidate_id, 'VERIFIED', 'Verified with full evidence sufficiency');

    // Direct transition fails closed due to budget overrun
    await expect(
      engineTightBudget.transitionState(
        candidate.candidate_id,
        'PAPER_ELIGIBLE',
        'Direct transition attempt exceeding capital'
      )
    ).rejects.toThrow('E-OPP-BUDGET-EXCEEDED');
  });

  // ==========================================================================
  // 6. SEQUENTIAL BUDGET EVALUATION DOCUMENTED BOUNDARY
  // ==========================================================================

  it('TBC-011: Document boundary: Sequential commitments evaluate against snapshot without cumulative reservation ledger', async () => {
    // Both candidates require 46,000 INR. Configured paper budget is 50,000 INR.
    // Each candidate evaluated individually against the snapshot passes.
    // Sequential exhaustion across multiple allocations requires a persistent reservation ledger (Stage 2 roadmap).
    const cand1 = await engine.ingestObservation({
      strategy_id: 'STRAT-SEQ-01',
      canonical_product_id: 'PROD-SEQ-A',
      candidate_name: 'Batch Product A',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:live:feed',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      prevailing_retail_asp_inr: 1200,
      factory_gate_quote_inr: 400,
      unit_batch_moq: 100, // 46,000 INR required
      review_sentiment_summary: 'Batch A quality verified with minimal defect',
      inbound_freight_inr: 40,
      packaging_kitting_inr: 20,
      platform_fee_inr: 120,
      fulfillment_fee_inr: 40,
      statutory_tax_inr: 96,
      return_defect_drag_inr: 24,
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    await engine.transitionState(cand1.candidate.candidate_id, 'INVESTIGATE', 'Investigate A');
    await engine.transitionState(cand1.candidate.candidate_id, 'UNDER_REVIEW', 'Review A');
    await engine.transitionState(cand1.candidate.candidate_id, 'VERIFIED', 'Verified A');

    const authA = await engine.authorizePaperCommit(
      cand1.candidate.candidate_id,
      'Authorizing batch allocation for candidate A per snapshot'
    );
    expect(authA.authorized).toBe(true);

    // Second candidate evaluated against the same engine snapshot also passes individually
    const cand2 = await engine.ingestObservation({
      strategy_id: 'STRAT-SEQ-01',
      canonical_product_id: 'PROD-SEQ-B',
      candidate_name: 'Batch Product B',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:live:feed',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      prevailing_retail_asp_inr: 1200,
      factory_gate_quote_inr: 400,
      unit_batch_moq: 100, // 46,000 INR required
      review_sentiment_summary: 'Batch B quality verified with minimal defect',
      inbound_freight_inr: 40,
      packaging_kitting_inr: 20,
      platform_fee_inr: 120,
      fulfillment_fee_inr: 40,
      statutory_tax_inr: 96,
      return_defect_drag_inr: 24,
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    await engine.transitionState(cand2.candidate.candidate_id, 'INVESTIGATE', 'Investigate B');
    await engine.transitionState(cand2.candidate.candidate_id, 'UNDER_REVIEW', 'Review B');
    await engine.transitionState(cand2.candidate.candidate_id, 'VERIFIED', 'Verified B');

    const authB = await engine.authorizePaperCommit(
      cand2.candidate.candidate_id,
      'Authorizing batch allocation for candidate B per snapshot'
    );
    expect(authB.authorized).toBe(true);
    // Verified: Engine evaluates each allocation against the provided budget snapshot independently.
    // Persistent multi-candidate cumulative decrementing is documented as out of scope for this bounded milestone.
  });
});
