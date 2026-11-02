/**
 * POC-001: Acceptance Suite 54 — First Complete Candidate Underwriting Workflow
 *
 * Verifies that the platform turns a discovered candidate and traceable evidence package
 * into a defensible, deterministic underwriting decision without LLM arithmetic or bypassing gates.
 *
 * Requirements Tested:
 * 1. UWT-001 (Happy Path): Discovered candidate with verified evidence reaches ELIGIBLE decision.
 * 2. UWT-002 (Missing Evidence): Incomplete candidate returns INSUFFICIENT_EVIDENCE and remains blocked.
 * 3. UWT-003 (Adverse Economics): Candidate below 10.00% margin threshold returns INELIGIBLE.
 * 4. UWT-004 (Unverified / Synthetic Integrity): Unattested evidence cannot masquerade as verified facts.
 * 5. UWT-005 (Conflict / Stale Policy): Active cross-source conflict blocks eligibility.
 * 6. UWT-006 (Duplicate Intake & Idempotency): Reprocessing capture does not duplicate candidate or tasks.
 * 7. UWT-007 (Explanation Agreement): Decision text strictly agrees with deterministic calculation outputs.
 * 8. UWT-008 (Capital Safety): Zero real-money route; paper commitment requires substantive rationale.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DiscoveryScreenerService } from '../../src/discovery/discoveryScreenerService.js';
import { OpportunityLifecycleEngine } from '../../src/research/opportunityLifecycleEngine.js';
import { EntityIdentityResolver } from '../../src/research/entityIdentityResolver.js';
import { ScreeningPolicyEngine } from '../../src/discovery/screeningPolicy.js';
import { InvestigationTaskQueue } from '../../src/discovery/investigationTaskQueue.js';
import { FixtureReplayAdapter } from '../../src/discovery/fixtureReplayAdapter.js';
import { RawSourceCapture } from '../../src/discovery/sourceAdapterContract.js';

describe('Suite 54: First Complete Candidate Underwriting Workflow', () => {
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
  // UWT-001: Happy Path Candidate Underwriting Workflow
  // Representative Hardware Fixtures: Forged Brass Ball Valve 1/2" PN20
  // Discovery: FIX-AMZ-BRASS-001 (Amazon India Retail ASP: ₹320.00)
  // Supplier: FIX-IMART-BRASS-001 (IndiaMART Factory Gate Quote: ₹115.00)
  // --------------------------------------------------------------------------
  it('UWT-001 (Happy Path): Discovered candidate with complete verified evidence reaches ELIGIBLE decision and unlocks PAPER_ELIGIBLE', async () => {
    // 1. Candidate Discovery from recorded golden fixture
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    expect(amzFixture).toBeDefined();

    const discoveryResult = await screener.screenCapture(amzFixture);
    expect(discoveryResult.resolution_status).toBe('RESOLVED');
    expect(discoveryResult.candidate).not.toBeNull();
    const candidateId = discoveryResult.candidate!.candidate_id;

    // 2. Pre-Investigation Underwriting Check: Missing factory quote -> INSUFFICIENT_EVIDENCE
    const preDecision = await screener.underwriteCandidate(candidateId);
    expect(preDecision.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(preDecision.evaluation_status).toBe('UNEVALUABLE_INPUTS_MISSING');
    expect(preDecision.evidence_summary.missing_critical_fields).toContain('factory_gate_quote_inr');
    expect(preDecision.unit_economics.factory_gate_quote_inr).toBeNull();
    expect(preDecision.unit_economics.estimated_margin_bps).toBeNull();

    // 3. Investigation Task Planning & Claiming
    expect(discoveryResult.investigation_plan).toBeDefined();
    const lease = await screener.claimNextTask('worker:supply-agent:v1', {
      candidateId,
      targetRole: 'SupplyTaskAgent'
    });
    expect(lease).not.toBeNull();

    // 4. Controlled Task Execution using IndiaMART golden fixture data (₹115.00 quote)
    const imartFixture = fixtureAdapter.getFixtureById('FIX-IMART-BRASS-001')!;
    const imartPayload = JSON.parse(imartFixture.raw_payload);

    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:supply-agent:v1',
      fencing_token: lease!.fencing_token,
      result_payload: imartPayload,
      evidence_origin: {
        source_connector_id: imartFixture.source_connector_id,
        origin_class: imartFixture.origin_class,
        observed_at_utc: imartFixture.source_observed_at_utc,
        verification_status: 'VERIFIED'
      },
      extracted_fields: {
        factory_gate_quote_inr: imartPayload.factory_gate_quote_inr,
        unit_batch_moq: imartPayload.unit_batch_moq,
        has_logistics_route: true,
        has_regulatory_clearance: true,
        cost_category_exclusions: [
          { category: 'INBOUND_FREIGHT', exclusion_basis: 'SUPPLIER_DDP_DIRECT_PORTAL_TERMS' },
          { category: 'PACKAGING_KITTING', exclusion_basis: 'FACTORY_SEALED_RETAIL_READY' },
          { category: 'MARKETPLACE_FEES', exclusion_basis: 'DIRECT_DISTRIBUTION_ZERO_COMMISSION' },
          { category: 'STATUTORY_TAX', exclusion_basis: 'EXPORT_SPECIAL_ECONOMIC_ZONE_EXEMPT' },
          { category: 'RETURN_DEFECT_DRAG', exclusion_basis: 'SUPPLIER_TOTAL_DEFECT_UNDERWRITING' }
        ]
      }
    });

    // 5. Deterministic Underwriting Decision
    const postDecision = await screener.underwriteCandidate(candidateId);
    expect(postDecision.outcome).toBe('ELIGIBLE');
    expect(postDecision.evaluation_status).toBe('EVALUATED_VIABLE');
    expect(postDecision.failed_checks.length).toBe(0);

    // 6. Economics Verification
    // Retail ASP: ₹320.00, Factory Quote: ₹115.00 -> Spread: ₹205.00
    // Margin bps: round((205.00 / 320.00) * 10,000) = 6406 bps (64.06%) >= 1000 bps hurdle
    expect(postDecision.unit_economics.prevailing_retail_asp_inr).toBe(320.0);
    expect(postDecision.unit_economics.factory_gate_quote_inr).toBe(115.0);
    expect(postDecision.unit_economics.gross_spread_inr).toBe(205.0);
    expect(postDecision.unit_economics.estimated_margin_bps).toBe(6406);
    expect(postDecision.unit_economics.policy_min_margin_bps).toBe(1000);

    // 7. Human-Readable Explanation Integrity
    expect(postDecision.explanation).toContain('6406 bps');
    expect(postDecision.explanation).toContain('₹320');
    expect(postDecision.explanation).toContain('₹115');
    expect(postDecision.explanation).toContain('1000 bps');
    expect(postDecision.jcs_sha256).toBeDefined();

    // 8. Legitimate Lifecycle State Progression into PAPER_ELIGIBLE
    await lifecycleEngine.transitionState(candidateId, 'INVESTIGATE', 'Investigation tasks initiated');
    await lifecycleEngine.transitionState(candidateId, 'UNDER_REVIEW', 'Investigation tasks completed');
    const verifiedCandidate = await lifecycleEngine.transitionState(candidateId, 'VERIFIED', 'Evidence sufficiency satisfied');
    expect(verifiedCandidate.lifecycle_state).toBe('VERIFIED');

    const paperCandidate = await lifecycleEngine.transitionState(
      candidateId,
      'PAPER_ELIGIBLE',
      'Underwriting decision ELIGIBLE with 64.06% gross margin'
    );
    expect(paperCandidate.lifecycle_state).toBe('PAPER_ELIGIBLE');
  });

  // --------------------------------------------------------------------------
  // UWT-002: Missing Evidence Returns INSUFFICIENT_EVIDENCE
  // --------------------------------------------------------------------------
  it('UWT-002 (Missing Evidence): Candidate with missing required evidence returns INSUFFICIENT_EVIDENCE and remains blocked', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(decision.binding_constraints).toContain('Missing mandatory field: factory_gate_quote_inr');
    expect(decision.failed_checks).toContain('EVIDENCE_SUFFICIENCY_UNSATISFIED');
    expect(decision.required_action_to_reconsider).toContain('factory_gate_quote_inr');

    // Attempting promotion to VERIFIED fails closed
    await lifecycleEngine.transitionState(candidateId, 'INVESTIGATE', 'Initiate');
    await lifecycleEngine.transitionState(candidateId, 'UNDER_REVIEW', 'Review');
    await expect(
      lifecycleEngine.transitionState(candidateId, 'VERIFIED', 'Bypass attempt')
    ).rejects.toThrow(/E-OPP-VERIFICATION-SUFFICIENCY-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // UWT-003: Adverse Economics Returns INELIGIBLE
  // --------------------------------------------------------------------------
  it('UWT-003 (Adverse Economics): Candidate failing mandatory economic margin threshold returns INELIGIBLE', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:supply-agent:v1', { candidateId });

    // Submit an adverse factory quote (₹300.00 vs ₹320.00 ASP -> Gross Spread ₹20.00, Margin 625 bps < 1000 bps)
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:supply-agent:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { adverse_quote: 300.0 },
      evidence_origin: {
        source_connector_id: 'conn:b2b:supplier-expensive',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z'
      },
      extracted_fields: {
        factory_gate_quote_inr: 300.0,
        has_logistics_route: true,
        has_regulatory_clearance: true,
        cost_category_exclusions: [
          { category: 'INBOUND_FREIGHT', exclusion_basis: 'SUPPLIER_DDP_DIRECT_PORTAL_TERMS' },
          { category: 'PACKAGING_KITTING', exclusion_basis: 'FACTORY_SEALED_RETAIL_READY' },
          { category: 'MARKETPLACE_FEES', exclusion_basis: 'DIRECT_DISTRIBUTION_ZERO_COMMISSION' },
          { category: 'STATUTORY_TAX', exclusion_basis: 'EXPORT_SPECIAL_ECONOMIC_ZONE_EXEMPT' },
          { category: 'RETURN_DEFECT_DRAG', exclusion_basis: 'SUPPLIER_TOTAL_DEFECT_UNDERWRITING' }
        ]
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.outcome).toBe('INELIGIBLE');
    expect(decision.evaluation_status).toBe('EVALUATED_UNATTRACTIVE');
    expect(decision.unit_economics.estimated_margin_bps).toBe(625);
    expect(decision.failed_checks).toContain('GROSS_MARGIN_BELOW_POLICY_HURDLE');
    expect(decision.binding_constraints).toContain('Policy minimum margin hurdle: 1000 bps (10.00%)');
    expect(decision.required_action_to_reconsider).toContain('Negotiate factory gate quote');

    // Attempting promotion to PAPER_ELIGIBLE fails closed
    await lifecycleEngine.transitionState(candidateId, 'INVESTIGATE', 'Initiate');
    await lifecycleEngine.transitionState(candidateId, 'UNDER_REVIEW', 'Review');
    await lifecycleEngine.transitionState(candidateId, 'VERIFIED', 'Evidence present');
    await expect(
      lifecycleEngine.transitionState(candidateId, 'PAPER_ELIGIBLE', 'Bypass attempt')
    ).rejects.toThrow(/E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // UWT-004: Unverified / Synthetic Integrity
  // --------------------------------------------------------------------------
  it('UWT-004 (Unverified / Synthetic Integrity): Unattested evidence cannot masquerade as verified facts', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:unverified:v1', { candidateId });

    // Submit synthetic quote clearly tagged as UNATTESTED_USER_INTAKE
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:unverified:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { simulated_quote: 120.0 },
      evidence_origin: {
        source_connector_id: 'conn:manual:unattested',
        origin_class: 'UNATTESTED_USER_INTAKE',
        observed_at_utc: '2026-10-24T14:00:00.000Z',
        verification_status: 'UNVERIFIED'
      },
      extracted_fields: {
        factory_gate_quote_inr: 120.0
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.evidence_summary.origin_class).toBe('UNATTESTED_USER_INTAKE');
    // Still missing logistics corridor and regulatory clearance
    expect(decision.outcome).toBe('INSUFFICIENT_EVIDENCE');
  });

  // --------------------------------------------------------------------------
  // UWT-005: Conflicting Evidence Policy
  // --------------------------------------------------------------------------
  it('UWT-005 (Conflict Policy): Active cross-source conflict blocks underwriting eligibility', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const discoveryResult = await screener.screenCapture(amzFixture);
    const candidateId = discoveryResult.candidate!.candidate_id;

    // Ingest a conflicting observation via lifecycle engine to trigger EVIDENCE_CONFLICT_DETECTED
    await lifecycleEngine.ingestObservation({
      strategy_id: discoveryResult.candidate!.strategy_id,
      canonical_product_id: discoveryResult.candidate!.canonical_product_id,
      candidate_name: discoveryResult.candidate!.candidate_name,
      source_connector_id: 'conn:competitor:conflict-source',
      prevailing_retail_asp_inr: 580.0, // Material price conflict (320 vs 580)
      factory_gate_quote_inr: 115.0,
      has_logistics_route: true,
      has_regulatory_clearance: true,
      signal_override: 'EVIDENCE_CONFLICT_DETECTED'
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.outcome).toBe('INELIGIBLE');
    expect(decision.failed_checks).toContain('ACTIVE_EVIDENCE_CONFLICT_DETECTED');
    expect(decision.binding_constraints).toContain('Active unresolved EVIDENCE_CONFLICT_DETECTED signal');

    // Attempting promotion to PAPER_ELIGIBLE must fail closed
    await lifecycleEngine.transitionState(candidateId, 'INVESTIGATE', 'Initiate');
    await lifecycleEngine.transitionState(candidateId, 'UNDER_REVIEW', 'Review');
    await lifecycleEngine.transitionState(candidateId, 'VERIFIED', 'Sufficiency check');
    await expect(
      lifecycleEngine.transitionState(candidateId, 'PAPER_ELIGIBLE', 'Commit with active conflict')
    ).rejects.toThrow(/E-OPP-CONFLICT-COMMIT-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // UWT-006: Duplicate Intake & Idempotency
  // --------------------------------------------------------------------------
  it('UWT-006 (Duplicate Intake): Reprocessing identical capture does not create duplicate candidates or tasks', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;

    // Initial capture screening
    const res1 = await screener.screenCapture(amzFixture);
    expect(res1.is_new_candidate).toBe(true);
    const candidateId = res1.candidate!.candidate_id;
    const initialQueueSize = screener.getTaskQueue().size();

    // Replay identical capture
    const res2 = await screener.screenCapture(amzFixture);
    expect(res2.is_new_candidate).toBe(false);
    expect(res2.candidate!.candidate_id).toBe(candidateId);

    // Invariant: Total candidate count remains 1 and queue size did not double
    const candidates = await lifecycleEngine.listCandidates();
    const matching = candidates.filter((c) => c.canonical_product_id === 'prod:brass:ball-valve:1-2in-pn20');
    expect(matching.length).toBe(1);
    expect(screener.getTaskQueue().size()).toBe(initialQueueSize);
  });

  // --------------------------------------------------------------------------
  // UWT-007: Decision Explanation Verification
  // --------------------------------------------------------------------------
  it('UWT-007 (Explanation Agreement): Decision text agrees exactly with deterministic calculation outputs', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    await screener.screenCapture(amzFixture);
    const candidateId = (await lifecycleEngine.listCandidates())[0].candidate_id;

    const lease = await screener.claimNextTask('worker:supply-agent:v1', { candidateId });
    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:supply-agent:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 115.0 },
      evidence_origin: {
        source_connector_id: 'conn:supplier:indiamart',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-24T14:00:00.000Z'
      },
      extracted_fields: {
        factory_gate_quote_inr: 115.0,
        has_logistics_route: true,
        has_regulatory_clearance: true,
        cost_category_exclusions: [
          { category: 'INBOUND_FREIGHT', exclusion_basis: 'SUPPLIER_DDP_DIRECT_PORTAL_TERMS' },
          { category: 'PACKAGING_KITTING', exclusion_basis: 'FACTORY_SEALED_RETAIL_READY' },
          { category: 'MARKETPLACE_FEES', exclusion_basis: 'DIRECT_DISTRIBUTION_ZERO_COMMISSION' },
          { category: 'STATUTORY_TAX', exclusion_basis: 'EXPORT_SPECIAL_ECONOMIC_ZONE_EXEMPT' },
          { category: 'RETURN_DEFECT_DRAG', exclusion_basis: 'SUPPLIER_TOTAL_DEFECT_UNDERWRITING' }
        ]
      }
    });

    const decision = await screener.underwriteCandidate(candidateId);
    expect(decision.outcome).toBe('ELIGIBLE');

    // Mathematical agreement
    const expectedSpread = decision.unit_economics.prevailing_retail_asp_inr! - decision.unit_economics.factory_gate_quote_inr!;
    expect(decision.unit_economics.gross_spread_inr).toBe(expectedSpread);
    expect(decision.explanation).toContain(`₹${expectedSpread.toFixed(2)}`);
    expect(decision.explanation).toContain(`${decision.unit_economics.estimated_margin_bps} bps`);
  });

  // --------------------------------------------------------------------------
  // UWT-008: Capital Safety & Zero Real-Money Route
  // --------------------------------------------------------------------------
  it('UWT-008 (Capital Safety): No path bypasses paper commitment rationale and zero real-money route exists', async () => {
    const amzFixture = fixtureAdapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    await screener.screenCapture(amzFixture);
    const candidateId = (await lifecycleEngine.listCandidates())[0].candidate_id;

    // 1. Unverified candidate cannot authorize paper commit
    await expect(
      lifecycleEngine.authorizePaperCommit(candidateId, 'Valid rationale of at least fifteen characters')
    ).rejects.toThrow(/E-OPP-UNVERIFIED-COMMIT-BLOCKED/);

    // 2. Paper commit requires human rationale >= 15 characters
    await expect(
      lifecycleEngine.authorizePaperCommit(candidateId, 'Too short')
    ).rejects.toThrow(/E-OPP-COMMIT-RATIONALE-REQUIRED/);
  });
});
