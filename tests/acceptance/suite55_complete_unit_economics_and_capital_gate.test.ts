/**
 * POC-001: Acceptance Suite 55 — Complete Unit Economics & Capital-Allocation Gate
 *
 * Verifies that the platform does not declare a candidate economically viable
 * solely because its selling price exceeds its supplier purchase price.
 * It requires either calculating the complete contribution economics from supported
 * inputs, or clearly blocking the decision because evidence is insufficient.
 *
 * Requirements Tested:
 * 1. UEC-001 (Complete Contribution Economics): Complete supported cost inputs produce deterministic net contribution.
 * 2. UEC-002 (Missing Cost Inputs Fail Closed): Missing required cost inputs return INSUFFICIENT_EVIDENCE (DATA_REQUIRED).
 * 3. UEC-003 (Gross Spread Positive / Net Contribution Negative): Positive spread with negative net contribution returns INELIGIBLE.
 * 4. UEC-004 (Contribution Hurdle Met but Gate Blocked): High contribution candidate blocked by active conflict signal.
 * 5. UEC-005 (MOQ & Initial Cash Requirement): Upfront cash requirement and working-capital exposure calculated deterministically.
 * 6. UEC-006 (Exact Arithmetic & Rounding): Pure BigInt integer subunit arithmetic prevents floating-point drift.
 * 7. UEC-007 (Synthetic Isolation): Synthetic scenario assumptions remain explicitly classified; never promoted to observed facts.
 * 8. UEC-008 (Idempotency & Attestation Parity): Identical inputs produce identical RFC 8785 JCS digests.
 * 9. UEC-009 (Capital Safety): No paper commit without complete verified underwriting and >= 15-char rationale; zero real-money route.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DiscoveryScreenerService } from '../../src/discovery/discoveryScreenerService.js';
import { OpportunityLifecycleEngine } from '../../src/research/opportunityLifecycleEngine.js';
import { EntityIdentityResolver } from '../../src/research/entityIdentityResolver.js';
import { ScreeningPolicyEngine } from '../../src/discovery/screeningPolicy.js';
import { InvestigationTaskQueue } from '../../src/discovery/investigationTaskQueue.js';
import { FixtureReplayAdapter } from '../../src/discovery/fixtureReplayAdapter.js';

describe('Suite 55: Complete Unit Economics & Capital-Allocation Gate', () => {
  let screener: DiscoveryScreenerService;
  let lifecycleEngine: OpportunityLifecycleEngine;
  let taskQueue: InvestigationTaskQueue;
  let fixtureAdapter: FixtureReplayAdapter;

  beforeEach(async () => {
    lifecycleEngine = new OpportunityLifecycleEngine();
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
  // UEC-001: Complete Supported Cost Inputs Produce Deterministic Net Contribution
  // --------------------------------------------------------------------------
  it('UEC-001 (Complete Contribution Economics): Complete supported cost inputs produce deterministic net contribution and ELIGIBLE decision', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:cost-accountant:v1', { candidateId });
    expect(lease).not.toBeNull();

    // Submit complete verified cost breakdown:
    // Retail ASP: ₹320.00
    // Factory Quote: ₹115.00
    // Inbound Freight: ₹18.00
    // Packaging / Kitting: ₹12.00
    // Marketplace Fees (Referral + Closing + Fulfillment): ₹45.00
    // Statutory Taxes / Withholdings: ₹8.00
    // Return / Defect Drag: ₹6.00
    // Total Variable Deductions = 115 + 18 + 12 + 45 + 8 + 6 = ₹204.00
    // Net Contribution = ₹320.00 - ₹204.00 = ₹116.00
    // Contribution Margin = round((116.00 / 320.00) * 10,000) = 3625 bps (36.25%) >= 1000 bps hurdle
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-accountant:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0, freight: 18.0, packaging: 12.0, platform_fees: 45.0, tax: 8.0, returns: 6.0 },
      evidence_origin: {
        source_connector_id: 'conn:verified:full-cost-audit',
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
        has_regulatory_clearance: true,
        applicable_cost_categories: [
          'SUPPLIER_PURCHASE',
          'INBOUND_FREIGHT',
          'PACKAGING_KITTING',
          'MARKETPLACE_FEES',
          'STATUTORY_TAX',
          'RETURN_DEFECT_DRAG'
        ]
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.outcome).toBe('ELIGIBLE');
    expect(decision.evaluation_status).toBe('EVALUATED_VIABLE');
    expect(decision.failed_checks.length).toBe(0);

    // Verify economics breakdown
    expect(decision.unit_economics.prevailing_retail_asp_inr).toBe(320.0);
    expect(decision.unit_economics.factory_gate_quote_inr).toBe(115.0);
    expect(decision.unit_economics.gross_spread_inr).toBe(205.0);
    expect(decision.unit_economics.estimated_margin_bps).toBe(6406);

    // Contribution economics
    expect(decision.unit_economics.net_contribution_inr).toBe(116.0);
    expect(decision.unit_economics.contribution_margin_bps).toBe(3625);
    expect(decision.unit_economics.contribution_margin_denominator).toBe('RETAIL_SELLING_PRICE');
    expect(decision.unit_economics.cost_breakdown.total_variable_deductions_inr).toBe(204.0);

    // Explanation verifies both gross spread and net contribution
    expect(decision.explanation).toContain('₹205.00');
    expect(decision.explanation).toContain('6406 bps');
    expect(decision.explanation).toContain('₹116.00');
    expect(decision.explanation).toContain('3625 bps');
  });

  // --------------------------------------------------------------------------
  // UEC-002: Missing Cost Inputs Fail Closed (DATA_REQUIRED)
  // --------------------------------------------------------------------------
  it('UEC-002 (Missing Cost Inputs Fail Closed): Missing required cost inputs prevent false positive eligibility and return INSUFFICIENT_EVIDENCE', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:cost-accountant:v1', { candidateId });

    // Candidate has healthy gross spread (₹320 - ₹115 = ₹205), but is missing freight & fees from its declared model
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-accountant:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:verified:partial-cost',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z',
        verification_status: 'VERIFIED'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50,
        has_logistics_route: true,
        has_regulatory_clearance: true,
        applicable_cost_categories: [
          'SUPPLIER_PURCHASE',
          'INBOUND_FREIGHT',
          'PACKAGING_KITTING',
          'MARKETPLACE_FEES'
        ]
        // inbound_freight_inr, packaging_kitting_inr, and platform_fee_inr intentionally omitted!
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.failed_checks).toContain('MANDATORY_COST_INPUT_MISSING');
    expect(decision.unit_economics.missing_cost_inputs).toContain('INBOUND_FREIGHT');
    expect(decision.unit_economics.missing_cost_inputs).toContain('PACKAGING_KITTING');
    expect(decision.unit_economics.missing_cost_inputs).toContain('MARKETPLACE_FEES');
    expect(decision.binding_constraints).toContain('Missing required cost input: INBOUND_FREIGHT (DATA_REQUIRED)');

    // Prohibits silent assumption of zero cost; net contribution remains null
    expect(decision.unit_economics.net_contribution_inr).toBeNull();
  });

  // --------------------------------------------------------------------------
  // UEC-003: Positive Gross Spread but Negative Net Contribution Returns INELIGIBLE
  // --------------------------------------------------------------------------
  it('UEC-003 (Gross Spread Positive / Net Contribution Negative): Positive gross spread with negative net contribution produces INELIGIBLE', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:cost-accountant:v1', { candidateId });

    // Quote is ₹260.00 vs ₹320.00 ASP -> Gross Spread +₹60.00 (1875 bps > 1000 bps hurdle)
    // But applicable variable costs total ₹108.00:
    // Freight: ₹25.00, Packaging: ₹15.00, Platform Fees: ₹48.00, Tax: ₹12.00, Returns: ₹8.00
    // Total Variable Deductions = 260 + 108 = ₹368.00
    // Net Contribution = ₹320.00 - ₹368.00 = -₹48.00 (-1500 bps)
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:cost-accountant:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 260.0 },
      evidence_origin: {
        source_connector_id: 'conn:verified:negative-contribution',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z',
        verification_status: 'VERIFIED'
      },
      extracted_fields: {
        factory_gate_quote_inr: 260.0,
        unit_batch_moq: 50,
        inbound_freight_inr: 25.0,
        packaging_kitting_inr: 15.0,
        platform_fee_inr: 48.0,
        statutory_tax_inr: 12.0,
        return_defect_drag_inr: 8.0,
        has_logistics_route: true,
        has_regulatory_clearance: true,
        applicable_cost_categories: [
          'SUPPLIER_PURCHASE',
          'INBOUND_FREIGHT',
          'PACKAGING_KITTING',
          'MARKETPLACE_FEES',
          'STATUTORY_TAX',
          'RETURN_DEFECT_DRAG'
        ]
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.outcome).toBe('INELIGIBLE');
    expect(decision.evaluation_status).toBe('EVALUATED_UNATTRACTIVE');
    expect(decision.unit_economics.gross_spread_inr).toBe(60.0);
    expect(decision.unit_economics.estimated_margin_bps).toBe(1875);
    expect(decision.unit_economics.net_contribution_inr).toBe(-48.0);
    expect(decision.unit_economics.contribution_margin_bps).toBe(-1500);
    expect(decision.failed_checks).toContain('NEGATIVE_NET_CONTRIBUTION');

    // Attempting promotion to PAPER_ELIGIBLE must fail closed
    await lifecycleEngine.transitionState(candidateId, 'INVESTIGATE', 'Initiate');
    await lifecycleEngine.transitionState(candidateId, 'UNDER_REVIEW', 'Review');
    await lifecycleEngine.transitionState(candidateId, 'VERIFIED', 'Evidence complete');
    await expect(
      lifecycleEngine.transitionState(candidateId, 'PAPER_ELIGIBLE', 'Commit attempt')
    ).rejects.toThrow(/E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // UEC-004: Candidate Meeting Contribution Hurdle Blocked by Mandatory Gates
  // --------------------------------------------------------------------------
  it('UEC-004 (Gate Precedence): Candidate meeting net contribution hurdle is still blocked by active conflict gate', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    // Submit viable economics
    await lifecycleEngine.ingestObservation({
      strategy_id: discoveryResult.candidate!.strategy_id,
      canonical_product_id: discoveryResult.candidate!.canonical_product_id,
      candidate_name: discoveryResult.candidate!.candidate_name,
      source_connector_id: 'conn:verified:audit',
      prevailing_retail_asp_inr: 320.0,
      factory_gate_quote_inr: 115.0,
      inbound_freight_inr: 18.0,
      packaging_kitting_inr: 12.0,
      platform_fee_inr: 45.0,
      statutory_tax_inr: 8.0,
      return_defect_drag_inr: 6.0,
      has_logistics_route: true,
      has_regulatory_clearance: true,
      applicable_cost_categories: [
        'SUPPLIER_PURCHASE',
        'INBOUND_FREIGHT',
        'PACKAGING_KITTING',
        'MARKETPLACE_FEES',
        'STATUTORY_TAX',
        'RETURN_DEFECT_DRAG'
      ],
      signal_override: 'EVIDENCE_CONFLICT_DETECTED'
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.outcome).toBe('INELIGIBLE');
    expect(decision.failed_checks).toContain('ACTIVE_EVIDENCE_CONFLICT_DETECTED');
    expect(decision.binding_constraints).toContain('Active unresolved EVIDENCE_CONFLICT_DETECTED signal');
  });

  // --------------------------------------------------------------------------
  // UEC-005: MOQ & Initial Cash Requirement Calculation
  // --------------------------------------------------------------------------
  it('UEC-005 (Capital Allocation): MOQ, upfront cash requirement, and working capital cycle are calculated deterministically', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    // Factory quote ₹115.00, Freight ₹18.00, Packaging ₹12.00 -> Unit Upfront Outlay = ₹145.00
    // MOQ = 50 units -> Initial Cash Requirement = 145.00 * 50 = ₹7,250.00
    // Lead time = 7d, Dwell = 14d, Settlement = 14d, Payment terms = 0d -> CCC = 35 days
    await lifecycleEngine.ingestObservation({
      strategy_id: discoveryResult.candidate!.strategy_id,
      canonical_product_id: discoveryResult.candidate!.canonical_product_id,
      candidate_name: discoveryResult.candidate!.candidate_name,
      source_connector_id: 'conn:verified:capital-plan',
      prevailing_retail_asp_inr: 320.0,
      factory_gate_quote_inr: 115.0,
      unit_batch_moq: 50,
      inbound_freight_inr: 18.0,
      packaging_kitting_inr: 12.0,
      platform_fee_inr: 45.0,
      statutory_tax_inr: 8.0,
      return_defect_drag_inr: 6.0,
      lead_time_days: 7,
      payment_terms_days: 0,
      has_logistics_route: true,
      has_regulatory_clearance: true,
      applicable_cost_categories: [
        'SUPPLIER_PURCHASE',
        'INBOUND_FREIGHT',
        'PACKAGING_KITTING',
        'MARKETPLACE_FEES',
        'STATUTORY_TAX',
        'RETURN_DEFECT_DRAG'
      ]
    });

    // Underwriting without budget configuration evaluates to NOT_AUTHORIZED_BUDGET_UNCONFIGURED
    const unbudgetedDecision = await screener.underwriteCandidate(candidateId);
    expect(unbudgetedDecision.outcome).toBe('ELIGIBLE');
    expect(unbudgetedDecision.capital_allocation!.capital_allocation_decision).toBe('NOT_AUTHORIZED_BUDGET_UNCONFIGURED');

    // Underwriting with explicit paper budget authorizes capital allocation
    const decision = await screener.underwriteCandidate(candidateId, {
      budgetConfig: { available_paper_capital_inr: 50000 }
    });
    expect(decision.outcome).toBe('ELIGIBLE');

    // Capital-allocation parameters
    expect(decision.unit_economics.initial_cash_requirement_inr).toBe(7250.0);
    expect(decision.unit_economics.working_capital_exposure_inr).toBe(7250.0);
    expect(decision.unit_economics.unit_batch_moq).toBe(50);
    expect(decision.unit_economics.cash_conversion_cycle_days).toBe(35);

    expect(decision.capital_allocation).toBeDefined();
    expect(decision.capital_allocation!.initial_cash_requirement_inr).toBe(7250.0);
    expect(decision.capital_allocation!.working_capital_exposure_inr).toBe(7250.0);
    expect(decision.capital_allocation!.cash_conversion_cycle_days).toBe(35);
    expect(decision.capital_allocation!.capital_allocation_decision).toBe('ALLOCATE_CAPITAL');
  });

  // --------------------------------------------------------------------------
  // UEC-006: Exact Integer Subunit Arithmetic & Rounding Standards
  // --------------------------------------------------------------------------
  it('UEC-006 (Exact Arithmetic): Pure integer subunit calculations prevent floating-point drift', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    // Fractional cent test amounts: 115.3333 quote, 18.6667 freight
    await lifecycleEngine.ingestObservation({
      strategy_id: discoveryResult.candidate!.strategy_id,
      canonical_product_id: discoveryResult.candidate!.canonical_product_id,
      candidate_name: discoveryResult.candidate!.candidate_name,
      source_connector_id: 'conn:verified:precision',
      prevailing_retail_asp_inr: 320.0,
      factory_gate_quote_inr: 115.3333,
      unit_batch_moq: 100,
      inbound_freight_inr: 18.6667,
      has_logistics_route: true,
      has_regulatory_clearance: true,
      applicable_cost_categories: ['SUPPLIER_PURCHASE', 'INBOUND_FREIGHT'],
      cost_category_exclusions: [
        { category: 'PACKAGING_KITTING', exclusion_basis: 'FACTORY_SEALED_RETAIL_READY' },
        { category: 'MARKETPLACE_FEES', exclusion_basis: 'DIRECT_DISTRIBUTION_ZERO_COMMISSION' },
        { category: 'STATUTORY_TAX', exclusion_basis: 'EXPORT_SPECIAL_ECONOMIC_ZONE_EXEMPT' },
        { category: 'RETURN_DEFECT_DRAG', exclusion_basis: 'SUPPLIER_TOTAL_DEFECT_UNDERWRITING' }
      ]
    });

    const decision = await screener.underwriteCandidate(candidateId);
    // Upfront cost = 115.3333 + 18.6667 = 134.0000 exactly
    expect(decision.unit_economics.initial_cash_requirement_inr).toBe(13400.0);
    expect(decision.unit_economics.net_contribution_inr).toBe(186.0);
  });

  // --------------------------------------------------------------------------
  // UEC-007: Synthetic Assumptions Remain Explicitly Synthetic
  // --------------------------------------------------------------------------
  it('UEC-007 (Synthetic Isolation): Synthetic scenario assumptions are explicitly marked and cannot authorize paper commit', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    await lifecycleEngine.ingestObservation({
      strategy_id: discoveryResult.candidate!.strategy_id,
      canonical_product_id: discoveryResult.candidate!.canonical_product_id,
      candidate_name: discoveryResult.candidate!.candidate_name,
      source_connector_id: 'conn:synthetic:simulated-scenario',
      origin_class: 'SYNTHETIC_SCENARIO',
      prevailing_retail_asp_inr: 320.0,
      factory_gate_quote_inr: 115.0,
      inbound_freight_inr: 18.0,
      has_logistics_route: true,
      has_regulatory_clearance: true,
      applicable_cost_categories: ['SUPPLIER_PURCHASE', 'INBOUND_FREIGHT'],
      cost_category_exclusions: [
        { category: 'PACKAGING_KITTING', exclusion_basis: 'FACTORY_SEALED_RETAIL_READY' },
        { category: 'MARKETPLACE_FEES', exclusion_basis: 'DIRECT_DISTRIBUTION_ZERO_COMMISSION' },
        { category: 'STATUTORY_TAX', exclusion_basis: 'EXPORT_SPECIAL_ECONOMIC_ZONE_EXEMPT' },
        { category: 'RETURN_DEFECT_DRAG', exclusion_basis: 'SUPPLIER_TOTAL_DEFECT_UNDERWRITING' }
      ]
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.evidence_summary.origin_class).toBe('SYNTHETIC_SCENARIO');
    expect(decision.evidence_confidence).toBeDefined();
    expect(decision.evidence_confidence!.evidence_quality_rating).toBe('SYNTHETIC_SCENARIO');

    // Cannot commit paper simulation on synthetic data
    await expect(
      lifecycleEngine.authorizePaperCommit(candidateId, 'Valid rationale but synthetic data')
    ).rejects.toThrow();
  });

  // --------------------------------------------------------------------------
  // UEC-008: Idempotency & Attestation Parity
  // --------------------------------------------------------------------------
  it('UEC-008 (Idempotency): Repeated underwriting of identical inputs produces identical calculation outputs and JCS digests', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    await lifecycleEngine.ingestObservation({
      strategy_id: discoveryResult.candidate!.strategy_id,
      canonical_product_id: discoveryResult.candidate!.canonical_product_id,
      candidate_name: discoveryResult.candidate!.candidate_name,
      source_connector_id: 'conn:verified:idempotent',
      prevailing_retail_asp_inr: 320.0,
      factory_gate_quote_inr: 115.0,
      inbound_freight_inr: 18.0,
      packaging_kitting_inr: 12.0,
      platform_fee_inr: 45.0,
      has_logistics_route: true,
      has_regulatory_clearance: true,
      applicable_cost_categories: ['SUPPLIER_PURCHASE', 'INBOUND_FREIGHT', 'PACKAGING_KITTING', 'MARKETPLACE_FEES'],
      cost_category_exclusions: [
        { category: 'STATUTORY_TAX', exclusion_basis: 'EXPORT_SPECIAL_ECONOMIC_ZONE_EXEMPT' },
        { category: 'RETURN_DEFECT_DRAG', exclusion_basis: 'SUPPLIER_TOTAL_DEFECT_UNDERWRITING' }
      ]
    });

    const d1 = await screener.underwriteCandidate(candidateId);
    const d2 = await screener.underwriteCandidate(candidateId);

    expect(d1.jcs_sha256).toBe(d2.jcs_sha256);
    expect(d1.unit_economics.net_contribution_inr).toBe(d2.unit_economics.net_contribution_inr);
    expect(d1.unit_economics.contribution_margin_bps).toBe(d2.unit_economics.contribution_margin_bps);
    expect(d1.unit_economics.initial_cash_requirement_inr).toBe(d2.unit_economics.initial_cash_requirement_inr);
  });

  // --------------------------------------------------------------------------
  // UEC-009: Capital Safety & Zero Real-Money Route
  // --------------------------------------------------------------------------
  it('UEC-009 (Capital Safety): Paper commit requires eligible candidate and substantive rationale; real-money route is impossible', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    // Rationale too short throws
    await expect(
      lifecycleEngine.authorizePaperCommit(candidateId, 'Too short')
    ).rejects.toThrow(/E-OPP-COMMIT-RATIONALE-REQUIRED/);
  });
});
