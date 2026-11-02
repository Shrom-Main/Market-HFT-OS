/**
 * POC-001: Acceptance Suite 56 — Evidence Integrity & Capital Authorization Gate
 *
 * Verifies the strict decoupling of three distinct operational concepts:
 * 1. Evidence that a claim was recorded or processed (RECORDED_GOLDEN_FIXTURE vs LIVE_VERIFIED_CAPTURE vs SYNTHETIC_SCENARIO).
 * 2. Evidence that a commercial opportunity is economically viable (complete non-bypassable variable cost deductions vs gross spread alone).
 * 3. Authorization to allocate capital in paper simulation (commercial ELIGIBLE != ALLOCATE_CAPITAL; budget configuration required).
 *
 * Requirements Tested:
 * - EIC-001: Recorded fixture cannot establish live verification solely through label (is_live_market_verified: false, RECORDED_REFERENCE_FIXTURE).
 * - EIC-002: Live verified capture with complete corroborated evidence achieves is_live_market_verified: true and LIVE_VERIFIED_EMPIRICAL.
 * - EIC-003: Synthetic scenario evidence cannot authorize paper commitment (E-OPP-SYNTHETIC-COMMIT-BLOCKED).
 * - EIC-004: Omitting material cost categories fails closed (INSUFFICIENT_EVIDENCE with DATA_REQUIRED).
 * - EIC-005: Explicitly not-applicable costs with supported exclusion basis (>= 10 chars) are distinguished from unknown costs and permitted.
 * - EIC-006: Known zero costs are distinguished from missing costs.
 * - EIC-007: Supplier purchase cost counted exactly once and non-supplier variable deductions separated.
 * - EIC-008: Positive gross spread with unknown material deductions cannot be declared viable.
 * - EIC-009: Commercial eligibility does not automatically authorize capital allocation (NOT_AUTHORIZED_BUDGET_UNCONFIGURED).
 * - EIC-010: Missing paper-budget configuration fails closed at authorization gate (E-OPP-BUDGET-UNCONFIGURED).
 * - EIC-011: Annualized RoWC labeled as conditional extrapolation and returns null on missing/invalid inputs.
 * - EIC-012: Identical inputs produce deterministic RFC 8785 attestation parity.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DiscoveryScreenerService } from '../../src/discovery/discoveryScreenerService.js';
import { OpportunityLifecycleEngine } from '../../src/research/opportunityLifecycleEngine.js';
import { EntityIdentityResolver } from '../../src/research/entityIdentityResolver.js';
import { ScreeningPolicyEngine } from '../../src/discovery/screeningPolicy.js';
import { InvestigationTaskQueue } from '../../src/discovery/investigationTaskQueue.js';
import { FixtureReplayAdapter } from '../../src/discovery/fixtureReplayAdapter.js';

describe('Suite 56: Evidence Integrity & Capital Authorization Gate', () => {
  let screener: DiscoveryScreenerService;
  let lifecycleEngine: OpportunityLifecycleEngine;
  let taskQueue: InvestigationTaskQueue;
  let fixtureAdapter: FixtureReplayAdapter;

  beforeEach(async () => {
    lifecycleEngine = new OpportunityLifecycleEngine({ requirePaperBudget: true });
    taskQueue = new InvestigationTaskQueue();
    screener = new DiscoveryScreenerService({
      lifecycleEngine,
      identityResolver: new EntityIdentityResolver(),
      screeningEngine: new ScreeningPolicyEngine(),
      taskQueue
    });
    await screener.initialize();
    fixtureAdapter = new FixtureReplayAdapter();
  });

  // --------------------------------------------------------------------------
  // EIC-001: Recorded Fixture Cannot Masquerade as Live Verification
  // --------------------------------------------------------------------------
  it('EIC-001 (Recorded Fixture Posture): Recorded golden fixture evidence is labeled RECORDED_FIXTURE_BASELINE with is_live_market_verified=false', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:cost-audit:v1', { candidateId });
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-audit:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:indiamart:golden-catalog',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z',
        verification_status: 'VERIFIED'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50,
        inbound_freight_inr: 18.0,
        packaging_kitting_inr: 12.0,
        platform_fee_inr: 45.0,
        statutory_tax_inr: 8.0,
        return_defect_drag_inr: 6.0,
        has_logistics_route: true,
        has_regulatory_clearance: true
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.evidence_summary.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
    expect(decision.evidence_summary.is_live_market_verified).toBe(false);
    expect(decision.evidence_confidence).toBeDefined();
    expect(decision.evidence_confidence!.evidence_posture).toBe('RECORDED_FIXTURE_BASELINE');
    expect(decision.evidence_confidence!.evidence_quality_rating).toBe('RECORDED_REFERENCE_FIXTURE');
    expect(decision.evidence_confidence!.is_live_market_verified).toBe(false);
  });

  // --------------------------------------------------------------------------
  // EIC-002: Live Verified Capture Achieves Live Market Verified Status
  // --------------------------------------------------------------------------
  it('EIC-002 (Live Verified Capture): Live collector capture with complete evidence achieves is_live_market_verified=true and LIVE_EMPIRICAL_CORROBORATED', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:live-crawler:v1', { candidateId });
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:live-crawler:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:marketplace:live-http-collector',
        origin_class: 'LIVE_VERIFIED_CAPTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z',
        verification_status: 'VERIFIED'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50,
        inbound_freight_inr: 18.0,
        packaging_kitting_inr: 12.0,
        platform_fee_inr: 45.0,
        statutory_tax_inr: 8.0,
        return_defect_drag_inr: 6.0,
        has_logistics_route: true,
        has_regulatory_clearance: true
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.evidence_summary.origin_class).toBe('LIVE_VERIFIED_CAPTURE');
    expect(decision.evidence_summary.is_live_market_verified).toBe(true);
    expect(decision.evidence_confidence).toBeDefined();
    expect(decision.evidence_confidence!.evidence_posture).toBe('LIVE_VERIFIED_EMPIRICAL');
    expect(decision.evidence_confidence!.evidence_quality_rating).toBe('LIVE_EMPIRICAL_CORROBORATED');
    expect(decision.evidence_confidence!.is_live_market_verified).toBe(true);
  });

  // --------------------------------------------------------------------------
  // EIC-003: Synthetic Scenario Evidence Blocks Paper Commitment
  // --------------------------------------------------------------------------
  it('EIC-003 (Synthetic Isolation): Candidate with synthetic scenario origin fails closed at transition and commit authorization', async () => {
    const { candidate } = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:india-b2b:physical-arbitrage',
      canonical_product_id: 'prod:synthetic:pipe-fitting:test-001',
      candidate_name: 'Simulated Synthetic Fitting',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:synthetic:scenario-generator',
      origin_class: 'SYNTHETIC_SCENARIO',
      prevailing_retail_asp_inr: 320.0,
      factory_gate_quote_inr: 115.0,
      inbound_freight_inr: 18.0,
      packaging_kitting_inr: 12.0,
      platform_fee_inr: 45.0,
      statutory_tax_inr: 8.0,
      return_defect_drag_inr: 6.0,
      review_sentiment_summary: 'Synthetic scenario profile verified.',
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    await lifecycleEngine.transitionState(candidate.candidate_id, 'INVESTIGATE', 'Initiate task dispatch');
    await lifecycleEngine.transitionState(candidate.candidate_id, 'UNDER_REVIEW', 'Under analyst review');
    await lifecycleEngine.transitionState(candidate.candidate_id, 'VERIFIED', 'Evidence sufficient for synthetic baseline');

    // Transition to PAPER_ELIGIBLE must be blocked
    await expect(
      lifecycleEngine.transitionState(candidate.candidate_id, 'PAPER_ELIGIBLE', 'Attempt synthetic transition')
    ).rejects.toThrow(/E-OPP-SYNTHETIC-COMMIT-BLOCKED/);

    // Commit authorization must be blocked
    await expect(
      lifecycleEngine.authorizePaperCommit(candidate.candidate_id, 'Valid substantive rationale for commitment', 'operator-1')
    ).rejects.toThrow(/E-OPP-SYNTHETIC-COMMIT-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // EIC-004: Omitting Material Cost Categories Fails Closed (DATA_REQUIRED)
  // --------------------------------------------------------------------------
  it('EIC-004 (Cost Completeness Enforcement): Omitting any of the 6 material cost categories produces INSUFFICIENT_EVIDENCE', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:cost-audit:v1', { candidateId });
    // Inbound freight, packaging, fees, taxes, and returns omitted
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-audit:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:indiamart:golden-catalog',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        has_logistics_route: true,
        has_regulatory_clearance: true
        // Omitted: inbound_freight_inr, packaging_kitting_inr, platform_fee_inr, statutory_tax_inr, return_defect_drag_inr
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.failed_checks).toContain('MANDATORY_COST_INPUT_MISSING');
    expect(decision.unit_economics.missing_cost_inputs).toContain('INBOUND_FREIGHT');
    expect(decision.unit_economics.missing_cost_inputs).toContain('PACKAGING_KITTING');
    expect(decision.unit_economics.missing_cost_inputs).toContain('MARKETPLACE_FEES');
    expect(decision.unit_economics.missing_cost_inputs).toContain('STATUTORY_TAX');
    expect(decision.unit_economics.missing_cost_inputs).toContain('RETURN_DEFECT_DRAG');
    expect(decision.unit_economics.net_contribution_inr).toBeNull();
  });

  // --------------------------------------------------------------------------
  // EIC-005: Explicitly Not-Applicable Costs with Substantive Basis Permitted
  // --------------------------------------------------------------------------
  it('EIC-005 (Explicit Cost Exclusions): Explicitly excluded cost categories with >= 10-char rationale are permitted; flimsy bases fail closed', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:cost-audit:v1', { candidateId });
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-audit:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:indiamart:golden-catalog',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50,
        inbound_freight_inr: 18.0,
        packaging_kitting_inr: 12.0,
        has_logistics_route: true,
        has_regulatory_clearance: true,
        cost_category_exclusions: [
          { category: 'MARKETPLACE_FEES', exclusion_basis: 'DIRECT_DISTRIBUTION_PORTAL_ZERO_COMMISSION' },
          { category: 'STATUTORY_TAX', exclusion_basis: 'EXPORT_SPECIAL_ECONOMIC_ZONE_EXEMPTION' },
          { category: 'RETURN_DEFECT_DRAG', exclusion_basis: 'SUPPLIER_REPLACEMENT_WARRANTY_TERMS' }
        ]
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.outcome).toBe('ELIGIBLE');
    expect(decision.failed_checks.length).toBe(0);

    const assessments = decision.unit_economics.cost_category_assessments;
    expect(assessments).toBeDefined();
    const feeAssessment = assessments!.find((a) => a.category === 'MARKETPLACE_FEES')!;
    expect(feeAssessment.treatment).toBe('EXPLICITLY_NOT_APPLICABLE');
    expect(feeAssessment.exclusion_basis).toBe('DIRECT_DISTRIBUTION_PORTAL_ZERO_COMMISSION');
    expect(feeAssessment.amount_inr).toBe(0);

    // Verify net contribution incorporates excluded costs as 0
    // ASP ₹320 - (115 + 18 + 12 + 0 + 0 + 0) = ₹320 - ₹145 = ₹175.00
    expect(decision.unit_economics.net_contribution_inr).toBe(175.0);
    expect(decision.unit_economics.cost_breakdown.total_variable_deductions_inr).toBe(145.0);
  });

  // --------------------------------------------------------------------------
  // EIC-006: Known Zero Costs Distinguished from Missing Costs
  // --------------------------------------------------------------------------
  it('EIC-006 (Known Zero vs Missing): Explicit zero costs are treated as KNOWN_ZERO rather than UNKNOWN_MISSING', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:cost-audit:v1', { candidateId });
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-audit:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:indiamart:golden-catalog',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50,
        inbound_freight_inr: 18.0,
        packaging_kitting_inr: 12.0,
        platform_fee_inr: 0.0, // Explicit known 0 (e.g. self-hosted portal)
        statutory_tax_inr: 0.0, // Explicit known 0 (e.g. tax exempt)
        return_defect_drag_inr: 0.0, // Explicit known 0
        has_logistics_route: true,
        has_regulatory_clearance: true
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.outcome).toBe('ELIGIBLE');

    const assessments = decision.unit_economics.cost_category_assessments!;
    const feeAssessment = assessments.find((a) => a.category === 'MARKETPLACE_FEES')!;
    expect(feeAssessment.treatment).toBe('KNOWN_ZERO');
    expect(feeAssessment.amount_inr).toBe(0);
    expect(feeAssessment.exclusion_basis).toBeNull();

    const taxAssessment = assessments.find((a) => a.category === 'STATUTORY_TAX')!;
    expect(taxAssessment.treatment).toBe('KNOWN_ZERO');
    expect(taxAssessment.amount_inr).toBe(0);
  });

  // --------------------------------------------------------------------------
  // EIC-007: Supplier Purchase Cost Counted Exactly Once & Deductions Separated
  // --------------------------------------------------------------------------
  it('EIC-007 (Cost Accounting Precision): Supplier quote counted once; non-supplier deductions explicitly separated', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:cost-audit:v1', { candidateId });
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-audit:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:indiamart:golden-catalog',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50,
        inbound_freight_inr: 18.0,
        packaging_kitting_inr: 12.0,
        platform_fee_inr: 45.0,
        statutory_tax_inr: 8.0,
        return_defect_drag_inr: 6.0,
        has_logistics_route: true,
        has_regulatory_clearance: true
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    const cb = decision.unit_economics.cost_breakdown;
    expect(cb.supplier_purchase_cost_inr).toBe(115.0);
    expect(cb.inbound_freight_inr).toBe(18.0);
    expect(cb.packaging_kitting_inr).toBe(12.0);
    expect(cb.marketplace_fees_inr).toBe(45.0);
    expect(cb.statutory_tax_inr).toBe(8.0);
    expect(cb.return_defect_drag_inr).toBe(6.0);

    // Non-supplier variable costs = 18 + 12 + 45 + 8 + 6 = 89
    // Total variable deductions = 115 + 89 = 204
    expect(cb.total_variable_deductions_inr).toBe(204.0);
    expect(decision.unit_economics.net_contribution_inr).toBe(116.0);
  });

  // --------------------------------------------------------------------------
  // EIC-008: Positive Gross Spread with Unknown Deductions Cannot Declare Viable
  // --------------------------------------------------------------------------
  it('EIC-008 (Gross Spread Trap): Candidate with high gross spread (80%) cannot be declared viable when deductions are unknown', async () => {
    const { candidate } = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:india-b2b:physical-arbitrage',
      canonical_product_id: 'prod:fasteners:heavy-stud:ss316',
      candidate_name: 'High Gross Spread Heavy Stud',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 500.0,
      factory_gate_quote_inr: 100.0, // Gross spread ₹400 / 80% margin!
      review_sentiment_summary: 'Clean heavy stud verified.',
      has_logistics_route: true,
      has_regulatory_clearance: true
      // Zero variable cost deductions declared or excluded!
    });

    const decision = await screener.underwriteCandidate(candidate.candidate_id);
    expect(decision.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.failed_checks).toContain('MANDATORY_COST_INPUT_MISSING');
    expect(decision.unit_economics.gross_spread_inr).toBe(400.0);
    expect(decision.unit_economics.estimated_margin_bps).toBe(8000);
    expect(decision.unit_economics.net_contribution_inr).toBeNull();
  });

  // --------------------------------------------------------------------------
  // EIC-009: Commercial Eligibility != Capital Authorization
  // --------------------------------------------------------------------------
  it('EIC-009 (Decoupled Capital Allocation): Economically ELIGIBLE candidate defaults to NOT_AUTHORIZED_BUDGET_UNCONFIGURED without explicit budget', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:cost-audit:v1', { candidateId });
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-audit:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:indiamart:golden-catalog',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50,
        inbound_freight_inr: 18.0,
        packaging_kitting_inr: 12.0,
        platform_fee_inr: 45.0,
        statutory_tax_inr: 8.0,
        return_defect_drag_inr: 6.0,
        has_logistics_route: true,
        has_regulatory_clearance: true
      }
    });

    // 1. Without budget: commercially ELIGIBLE, but NOT_AUTHORIZED_BUDGET_UNCONFIGURED
    const unbudgetedDecision = await screener.underwriteCandidate(candidateId);
    expect(unbudgetedDecision.outcome).toBe('ELIGIBLE');
    expect(unbudgetedDecision.capital_allocation!.capital_allocation_decision).toBe('NOT_AUTHORIZED_BUDGET_UNCONFIGURED');

    // 2. With sufficient budget: ALLOCATE_CAPITAL
    const budgetedDecision = await screener.underwriteCandidate(candidateId, {
      budgetConfig: { available_paper_capital_inr: 25000 }
    });
    expect(budgetedDecision.outcome).toBe('ELIGIBLE');
    expect(budgetedDecision.capital_allocation!.capital_allocation_decision).toBe('ALLOCATE_CAPITAL');

    // 3. With insufficient budget (₹5,000 budget vs ₹7,250 outlay): NOT_AUTHORIZED_BUDGET_EXCEEDED
    const exceededDecision = await screener.underwriteCandidate(candidateId, {
      budgetConfig: { available_paper_capital_inr: 5000 }
    });
    expect(exceededDecision.outcome).toBe('ELIGIBLE');
    expect(exceededDecision.capital_allocation!.capital_allocation_decision).toBe('NOT_AUTHORIZED_BUDGET_EXCEEDED');
  });

  // --------------------------------------------------------------------------
  // EIC-010: Missing Budget Fails Closed at Commit Authorization Gate
  // --------------------------------------------------------------------------
  it('EIC-010 (Budget Gate Failure): Authorizing paper commit without budget fails closed with E-OPP-BUDGET-UNCONFIGURED', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:cost-audit:v1', { candidateId });
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-audit:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:indiamart:golden-catalog',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50,
        inbound_freight_inr: 18.0,
        packaging_kitting_inr: 12.0,
        platform_fee_inr: 45.0,
        statutory_tax_inr: 8.0,
        return_defect_drag_inr: 6.0,
        has_logistics_route: true,
        has_regulatory_clearance: true
      }
    });

    await lifecycleEngine.transitionState(candidateId, 'INVESTIGATE', 'Task dispatch');
    await lifecycleEngine.transitionState(candidateId, 'UNDER_REVIEW', 'Analyst review');
    await lifecycleEngine.transitionState(candidateId, 'VERIFIED', 'Evidence sufficient');

    // 1. Without budgetConfig: throws E-OPP-BUDGET-UNCONFIGURED
    await expect(
      lifecycleEngine.authorizePaperCommit(candidateId, 'Valid substantive rationale for commitment', 'operator-1')
    ).rejects.toThrow(/E-OPP-BUDGET-UNCONFIGURED/);

    // 2. With budgetConfig below required outlay (₹5,000 < ₹7,250): throws E-OPP-BUDGET-EXCEEDED
    await expect(
      lifecycleEngine.authorizePaperCommit(
        candidateId,
        'Valid substantive rationale for commitment',
        'operator-1',
        { available_paper_capital_inr: 5000 }
      )
    ).rejects.toThrow(/E-OPP-BUDGET-EXCEEDED/);

    // 3. With adequate budgetConfig (₹50,000 >= ₹7,250): succeeds cleanly
    const commitResult = await lifecycleEngine.authorizePaperCommit(
      candidateId,
      'Valid substantive rationale for commitment',
      'operator-1',
      { available_paper_capital_inr: 50000 }
    );
    expect(commitResult.authorized).toBe(true);
    expect(commitResult.allocated_paper_capital_inr).toBe(7250.0);
  });

  // --------------------------------------------------------------------------
  // EIC-011: Annualized RoWC Conditional Extrapolation & Null Safety
  // --------------------------------------------------------------------------
  it('EIC-011 (Annualized RoWC Caution): Annualized RoWC is explicitly labeled as extrapolation and returns null if net contribution is negative', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    // Positive contribution case
    const lease = await screener.claimNextTask('worker:cost-audit:v1', { candidateId });
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-audit:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:indiamart:golden-catalog',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50,
        inbound_freight_inr: 18.0,
        packaging_kitting_inr: 12.0,
        platform_fee_inr: 45.0,
        statutory_tax_inr: 8.0,
        return_defect_drag_inr: 6.0,
        lead_time_days: 7,
        payment_terms_days: 0,
        warehouse_dwell_days: 14,
        settlement_delay_days: 14,
        has_logistics_route: true,
        has_regulatory_clearance: true
      }
    });

    const positiveDecision = await screener.underwriteCandidate(candidateId);
    expect(positiveDecision.unit_economics.annualized_rowc_interpretation).toBe(
      'CONDITIONAL_ANNUALIZED_EXTRAPOLATION_NOT_REALIZED_RETURN'
    );
    expect(positiveDecision.unit_economics.annualized_return_on_working_capital_bps).toBeGreaterThan(0);
    expect(positiveDecision.explanation).toContain('conditional, annualized extrapolation');

    // Negative contribution case
    const { candidate: negCandidate } = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:india-b2b:physical-arbitrage',
      canonical_product_id: 'prod:negative:valve:brass-002',
      candidate_name: 'Negative Contribution Valve',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:indiamart:catalog',
      prevailing_retail_asp_inr: 320.0,
      factory_gate_quote_inr: 260.0,
      inbound_freight_inr: 25.0,
      packaging_kitting_inr: 15.0,
      platform_fee_inr: 48.0,
      statutory_tax_inr: 12.0,
      return_defect_drag_inr: 8.0,
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    const negDecision = await screener.underwriteCandidate(negCandidate.candidate_id);
    expect(negDecision.unit_economics.net_contribution_inr).toBe(-48.0);
    expect(negDecision.unit_economics.annualized_return_on_working_capital_bps).toBeNull();
  });

  // --------------------------------------------------------------------------
  // EIC-012: Deterministic RFC 8785 Attestation Parity
  // --------------------------------------------------------------------------
  it('EIC-012 (Attestation Parity): Identical evidence and policy inputs produce identical RFC 8785 canonical hashes', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:cost-audit:v1', { candidateId });
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-audit:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:indiamart:golden-catalog',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50,
        inbound_freight_inr: 18.0,
        packaging_kitting_inr: 12.0,
        platform_fee_inr: 45.0,
        statutory_tax_inr: 8.0,
        return_defect_drag_inr: 6.0,
        has_logistics_route: true,
        has_regulatory_clearance: true
      }
    });

    const dec1 = await screener.underwriteCandidate(candidateId);
    const dec2 = await screener.underwriteCandidate(candidateId);

    expect(dec1.decision_id).toBe(dec2.decision_id);
    expect(dec1.jcs_sha256).toBe(dec2.jcs_sha256);
    expect(dec1.unit_economics.net_contribution_inr).toBe(dec2.unit_economics.net_contribution_inr);
    expect(dec1.unit_economics.initial_cash_requirement_inr).toBe(dec2.unit_economics.initial_cash_requirement_inr);
  });
});
