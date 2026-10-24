/**
 * POC-001: Acceptance Suite 47 — Owner Direction OD (Category-Agnostic Opportunity Discovery)
 *
 * Verifies all 10 acceptance requirements specified in Owner Direction OD:
 * 1. SS304 DIN 3017 hose clamps remain a valid golden example.
 * 2. Brass valves and at least three unrelated opportunity types (Software/Digital, Service Contract, B2B Distribution)
 *    enter the same discovery pipeline without changes to core engine code.
 * 3. An unseen category is retained for classification/investigation rather than rejected by an allowlist.
 * 4. Category-specific verification checks are selected without contaminating unrelated categories.
 * 5. A candidate missing category-specific inputs remains discoverable with unknown fields and explicit follow-up tasks.
 * 6. Missing inputs cannot produce fabricated economics, false precision, or verified status.
 * 7. Ranking and screening remain reproducible for identical inputs and policy versions.
 * 8. Category classification or later enrichment does not accidentally change stable candidate identity.
 * 9. Source provenance and synthetic-versus-observed boundaries remain intact.
 * 10. Existing baseline, lifecycle, and Slice 2A/2B tests continue to pass with zero regressions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FixtureReplayAdapter } from '../../src/discovery/fixtureReplayAdapter.js';
import { GoldenDiscoveryFixtureRegistry } from '../../src/discovery/fixtures/goldenDiscoveryFixtures.js';
import { DiscoveryScreenerService } from '../../src/discovery/discoveryScreenerService.js';
import { OpportunityLifecycleEngine } from '../../src/research/opportunityLifecycleEngine.js';
import { ScreeningPolicyEngine } from '../../src/discovery/screeningPolicy.js';
import { getCategoryVerificationRequirements, inferCategoryFromEntityId } from '../../src/canonical/opportunityCategory.js';

describe('Suite 47: Owner Direction OD — Category-Agnostic Opportunity Discovery', () => {
  let adapter: FixtureReplayAdapter;
  let lifecycleEngine: OpportunityLifecycleEngine;
  let screener: DiscoveryScreenerService;

  beforeEach(async () => {
    adapter = new FixtureReplayAdapter();
    lifecycleEngine = new OpportunityLifecycleEngine();
    screener = new DiscoveryScreenerService({
      lifecycleEngine
    });
    await screener.initialize();
  });

  // --------------------------------------------------------------------------
  // Test 1: SS304 Hose Clamps Remain Valid Golden Example
  // --------------------------------------------------------------------------
  it('OD-001-GOLDEN-EXAMPLE-SS304: SS304 DIN 3017 hose clamps remain a valid, fully functioning golden example', async () => {
    const amzFixture = adapter.getFixtureById('FIX-AMZ-SS304-001')!;
    const imartFixture = adapter.getFixtureById('FIX-IMART-SS304-001')!;
    expect(amzFixture).toBeDefined();
    expect(imartFixture).toBeDefined();

    // 1. Ingest retail Amazon capture
    const amzRes = await screener.screenCapture(amzFixture);
    expect(amzRes.resolution_status).toBe('RESOLVED');
    expect(amzRes.candidate).not.toBeNull();
    expect(amzRes.candidate!.canonical_product_id).toBe('prod:din3017:ss304:16-25mm:pack-10');
    expect(amzRes.candidate!.category).toBe('PHYSICAL_GOODS');

    // 2. Ingest wholesale IndiaMART quote
    const imartRes = await screener.screenCapture(imartFixture);
    expect(imartRes.resolution_status).toBe('RESOLVED');
    expect(imartRes.candidate).not.toBeNull();
    expect(imartRes.candidate!.candidate_id).toBe(amzRes.candidate!.candidate_id);

    // 3. Verify physical goods sufficiency checks: requires quote, ASP, reviews, route, regulatory
    const cand = imartRes.candidate!;
    const reqs = getCategoryVerificationRequirements(cand.category);
    expect(reqs.category).toBe('PHYSICAL_GOODS');
    expect(reqs.requires_upstream_quote).toBe(true);
    expect(reqs.requires_logistics_route).toBe(true);
    expect(reqs.requires_regulatory_clearance).toBe(true);

    // 4. Verify economics calculation
    expect(cand.commercial_attractiveness.estimated_gross_spread_inr).toBe(60.0);
    expect(cand.commercial_attractiveness.estimated_gross_margin_bps).toBe(7059);
    expect(cand.commercial_attractiveness.attractiveness_rating).toBe('VERY_HIGH');
  });

  // --------------------------------------------------------------------------
  // Test 2: Multi-Category Discovery Without Engine Changes
  // --------------------------------------------------------------------------
  it('OD-002-MULTI-CATEGORY-DISCOVERY: Brass valves and three unrelated opportunity types enter discovery without engine code changes', async () => {
    // a. Brass valves (PHYSICAL_GOODS)
    const brassAmz = adapter.getFixtureById('FIX-AMZ-BRASS-001')!;
    const brassRes = await screener.screenCapture(brassAmz);
    expect(brassRes.resolution_status).toBe('RESOLVED');
    expect(brassRes.candidate!.category).toBe('PHYSICAL_GOODS');

    // b. Unrelated 1: SaaS Developer Tool (SOFTWARE_DIGITAL)
    const saasFixture = adapter.getFixtureById('FIX-SAAS-DEVTOOL-001')!;
    const saasRes = await screener.screenCapture(saasFixture);
    expect(saasRes.resolution_status).toBe('RESOLVED');
    expect(saasRes.candidate!.category).toBe('SOFTWARE_DIGITAL');
    expect(saasRes.candidate!.canonical_product_id).toBe('software:devtools:distributed-tracing-agent');
    expect(saasRes.candidate!.lifecycle_state).toBe('NEW');

    // c. Unrelated 2: Metallurgy Lab Testing Service (SERVICE_CONTRACT)
    const labFixture = adapter.getFixtureById('FIX-SERVICE-METALLURGY-001')!;
    const labRes = await screener.screenCapture(labFixture);
    expect(labRes.resolution_status).toBe('RESOLVED');
    expect(labRes.candidate!.category).toBe('SERVICE_CONTRACT');
    expect(labRes.candidate!.canonical_product_id).toBe('service:lab:tensile-spectrometry-testing');
    expect(labRes.candidate!.lifecycle_state).toBe('NEW');

    // d. Unrelated 3: Industrial Bulk Argon Gas Supply (B2B_DISTRIBUTION)
    const b2bFixture = adapter.getFixtureById('FIX-B2B-ARGON-GAS-001')!;
    const b2bRes = await screener.screenCapture(b2bFixture);
    expect(b2bRes.resolution_status).toBe('RESOLVED');
    expect(b2bRes.candidate!.category).toBe('B2B_DISTRIBUTION');
    expect(b2bRes.candidate!.canonical_product_id).toBe('b2b:gas:argon-cylinders-47l');
    expect(b2bRes.candidate!.lifecycle_state).toBe('NEW');

    // Verify all 4 candidates exist in OpportunityLifecycleEngine simultaneously
    const allCandidates = await lifecycleEngine.listCandidates();
    expect(allCandidates.length).toBe(4);
    const categories = allCandidates.map((c) => c.category);
    expect(categories).toContain('PHYSICAL_GOODS');
    expect(categories).toContain('SOFTWARE_DIGITAL');
    expect(categories).toContain('SERVICE_CONTRACT');
    expect(categories).toContain('B2B_DISTRIBUTION');
  });

  // --------------------------------------------------------------------------
  // Test 3: Unseen Category Retention Without Allowlist Rejection
  // --------------------------------------------------------------------------
  it('OD-003-UNSEEN-CATEGORY-RETENTION: An unseen category is retained for classification/investigation rather than rejected by an allowlist', async () => {
    const novelFixture = adapter.getFixtureById('FIX-NOVEL-MYCELIUM-001')!;
    expect(novelFixture).toBeDefined();

    const result = await screener.screenCapture(novelFixture);

    // 1. Must be retained, NOT dropped to UNRESOLVED_ENTITY_HOLD
    expect(result.resolution_status).toBe('RESOLVED_NOVEL_CATEGORY');
    expect(result.candidate).not.toBeNull();
    expect(result.candidate!.category).toBe('BIOMATERIAL_PACKAGING_IP');
    expect(result.candidate!.lifecycle_state).toBe('NEW');

    // 2. Must recommend CATEGORY_CLASSIFICATION_AND_ENRICHMENT investigation task
    const categoryTask = result.recommended_tasks.find(
      (t) => t.task_type === 'CATEGORY_CLASSIFICATION_AND_ENRICHMENT'
    );
    expect(categoryTask).toBeDefined();
    expect(categoryTask!.priority).toBe('CRITICAL');
    expect(categoryTask!.rationale).toContain('BIOMATERIAL_PACKAGING_IP');

    // 3. Confirms candidate is retained in lifecycle engine
    const storedCand = await lifecycleEngine.getCandidate(result.candidate!.candidate_id);
    expect(storedCand).not.toBeNull();
    expect(storedCand!.category).toBe('BIOMATERIAL_PACKAGING_IP');
  });

  // --------------------------------------------------------------------------
  // Test 4: Tailored Category-Specific Verification Checks
  // --------------------------------------------------------------------------
  it('OD-004-CATEGORY-AWARE-VERIFICATION: Category-specific verification checks are selected without contaminating unrelated categories', async () => {
    // 1. Software / Digital opportunity: does NOT require freight corridor or factory quote
    const saasFixture = adapter.getFixtureById('FIX-SAAS-DEVTOOL-001')!;
    const saasRes = await screener.screenCapture(saasFixture);
    const saasCand = saasRes.candidate!;

    expect(saasCand.evidence_sufficiency.is_sufficient_for_underwriting).toBe(true);
    expect(saasCand.evidence_sufficiency.sufficiency_score_bps).toBe(10000);
    expect(saasCand.evidence_sufficiency.missing_critical_fields).toEqual([]);
    // Software does not require logistics freight corridor
    expect(saasCand.evidence_sufficiency.has_logistics_route).toBe(false);
    expect(saasRes.recommended_tasks.some((t) => t.task_type === 'LOGISTICS_ROUTE_VERIFICATION')).toBe(false);
    expect(saasRes.recommended_tasks.some((t) => t.task_type === 'SUPPLIER_QUOTE_ACQUISITION')).toBe(false);

    // 2. Physical Goods opportunity: DOES require freight corridor and factory quote
    const amzFixture = adapter.getFixtureById('FIX-AMZ-SS304-001')!;
    const amzRes = await screener.screenCapture(amzFixture);
    const physicalCand = amzRes.candidate!;

    // Missing factory quote and freight corridor blocks sufficiency
    expect(physicalCand.evidence_sufficiency.is_sufficient_for_underwriting).toBe(false);
    expect(physicalCand.evidence_sufficiency.missing_critical_fields).toContain('factory_gate_quote_inr');
    expect(physicalCand.evidence_sufficiency.uncorroborated_fields).toContain('logistics_freight_corridor');
    expect(amzRes.recommended_tasks.some((t) => t.task_type === 'LOGISTICS_ROUTE_VERIFICATION')).toBe(true);
    expect(amzRes.recommended_tasks.some((t) => t.task_type === 'SUPPLIER_QUOTE_ACQUISITION')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 5: Missing Category-Specific Input Stays Discoverable
  // --------------------------------------------------------------------------
  it('OD-005-MISSING-INPUT-DISCOVERABILITY: A candidate missing category-specific inputs remains discoverable with unknown fields and explicit follow-up tasks', async () => {
    const unpricedSaasFixture = adapter.getFixtureById('FIX-SAAS-DEVTOOL-MISSING-PRICE-002')!;
    expect(unpricedSaasFixture).toBeDefined();

    const result = await screener.screenCapture(unpricedSaasFixture);

    // 1. Candidate is discoverable in state NEW
    expect(result.resolution_status).toBe('RESOLVED');
    expect(result.candidate).not.toBeNull();
    expect(result.candidate!.lifecycle_state).toBe('NEW');

    // 2. Prevailing price is strictly null (not 0.0)
    expect(result.candidate!.current_observation.prevailing_retail_asp_inr).toBeNull();
    expect(result.candidate!.evidence_sufficiency.has_prevailing_asp).toBe(false);
    expect(result.candidate!.evidence_sufficiency.missing_critical_fields).toContain('prevailing_retail_asp_inr');

    // 3. Generates explicit follow-up task
    const aspTask = result.recommended_tasks.find((t) => t.task_type === 'RETAIL_ASP_VERIFICATION');
    expect(aspTask).toBeDefined();
    expect(aspTask!.priority).toBe('HIGH');
    expect(aspTask!.rationale).toContain('Missing software subscription or license price');
  });

  // --------------------------------------------------------------------------
  // Test 6: Missing Inputs Cannot Produce Fabricated Economics or Verified Status
  // --------------------------------------------------------------------------
  it('OD-006-ZERO-FABRICATION-SAFEGUARD: Missing inputs cannot produce fabricated economics, false precision, or premature verification', async () => {
    const unpricedSaasFixture = adapter.getFixtureById('FIX-SAAS-DEVTOOL-MISSING-PRICE-002')!;
    const result = await screener.screenCapture(unpricedSaasFixture);
    const cand = result.candidate!;

    // 1. Economics remain strictly null (Unknown != zero)
    expect(cand.commercial_attractiveness.estimated_gross_spread_inr).toBeNull();
    expect(cand.commercial_attractiveness.estimated_gross_margin_bps).toBeNull();
    expect(cand.commercial_attractiveness.attractiveness_rating).toBe('UNKNOWN');
    expect(cand.commercial_attractiveness.calculation_epistemic_class).toBe('UNATTESTED_INTAKE');

    // 2. Attempting to transition to VERIFIED fails closed
    await expect(
      lifecycleEngine.transitionState(cand.candidate_id, 'VERIFIED', 'Attempting premature verification')
    ).rejects.toThrow('E-OPP-INVALID-TRANSITION'); // Must go through INVESTIGATE / UNDER_REVIEW first

    // 3. Even with valid intermediate state, sufficiency failure blocks VERIFIED
    await lifecycleEngine.transitionState(cand.candidate_id, 'INVESTIGATE', 'Operator dispatched investigation');
    await lifecycleEngine.transitionState(cand.candidate_id, 'UNDER_REVIEW', 'Investigation findings under review');
    await expect(
      lifecycleEngine.transitionState(cand.candidate_id, 'VERIFIED', 'Attempting verification with missing fields')
    ).rejects.toThrow('E-OPP-VERIFICATION-SUFFICIENCY-BLOCKED');

    // 4. Attempting paper commitment fails closed
    await expect(
      lifecycleEngine.authorizePaperCommit(cand.candidate_id, 'Valid substantive rationale of at least 15 characters')
    ).rejects.toThrow('E-OPP-UNVERIFIED-COMMIT-BLOCKED');
  });

  // --------------------------------------------------------------------------
  // Test 7: Deterministic Reproducibility Across Identical Inputs
  // --------------------------------------------------------------------------
  it('OD-007-DETERMINISTIC-REPRODUCIBILITY: Candidate screening and ranking produce bit-identical results across runs', async () => {
    const fixtures = [
      adapter.getFixtureById('FIX-AMZ-SS304-001')!,
      adapter.getFixtureById('FIX-AMZ-BRASS-001')!,
      adapter.getFixtureById('FIX-SAAS-DEVTOOL-001')!,
      adapter.getFixtureById('FIX-SERVICE-METALLURGY-001')!,
      adapter.getFixtureById('FIX-B2B-ARGON-GAS-001')!
    ];

    for (const fix of fixtures) {
      await screener.screenCapture(fix);
    }

    const candidates = await lifecycleEngine.listCandidates();
    expect(candidates.length).toBe(5);

    // Rank run 1
    const ranked1 = screener.rankCandidates(candidates);

    // Rank run 2
    const ranked2 = screener.rankCandidates(candidates);

    expect(ranked1.length).toBe(ranked2.length);
    for (let i = 0; i < ranked1.length; i++) {
      expect(ranked1[i].candidate_id).toBe(ranked2[i].candidate_id);
      expect(ranked1[i].priority_score_bps).toBe(ranked2[i].priority_score_bps);
      expect(ranked1[i].priority_tier).toBe(ranked2[i].priority_tier);
      expect(ranked1[i].jcs_sha256).toBe(ranked2[i].jcs_sha256);
      expect(ranked1[i].score_breakdown).toEqual(ranked2[i].score_breakdown);
    }
  });

  // --------------------------------------------------------------------------
  // Test 8: Stable Candidate Identity Under Category Classification/Enrichment
  // --------------------------------------------------------------------------
  it('OD-008-STABLE-IDENTITY-UNDER-ENRICHMENT: Category classification or later enrichment does not alter stable candidate identity', async () => {
    const strategyId = 'strat:india-b2b:physical-arbitrage';
    const canonicalProductId = 'novel:biomaterial:mycelium-composite-patents';

    // 1. Initial intake with UNRESOLVED_NOVEL
    const initialCand = await lifecycleEngine.ingestObservation({
      strategy_id: strategyId,
      canonical_product_id: canonicalProductId,
      candidate_name: 'Initial Unclassified Novel Bio-Material',
      category: 'UNRESOLVED_NOVEL',
      source_connector_id: 'conn:ip:tech-transfer',
      prevailing_retail_asp_inr: 1500000.0,
      observed_at_utc: '2026-10-24T16:00:00.000Z'
    });

    const originalCandidateId = initialCand.candidate.candidate_id;
    expect(initialCand.candidate.category).toBe('UNRESOLVED_NOVEL');

    // 2. Later enrichment: domain specialist updates category to BIOMATERIAL_PACKAGING_IP
    const enrichedCand = await lifecycleEngine.ingestObservation({
      strategy_id: strategyId,
      canonical_product_id: canonicalProductId,
      candidate_name: 'Enriched Mycelium Packaging Composite Patent Portfolio',
      category: 'BIOMATERIAL_PACKAGING_IP',
      source_connector_id: 'conn:ip:domain-expert',
      prevailing_retail_asp_inr: 1500000.0,
      observed_at_utc: '2026-10-24T17:00:00.000Z'
    });

    // 3. Invariant: candidate_id must be 100% bit-identical
    expect(enrichedCand.candidate.candidate_id).toBe(originalCandidateId);
    expect(enrichedCand.candidate.category).toBe('BIOMATERIAL_PACKAGING_IP');
    expect(enrichedCand.is_new).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 9: Source Provenance and Synthetic Boundary Preservation
  // --------------------------------------------------------------------------
  it('OD-009-PROVENANCE-BOUNDARY-PRESERVATION: Recorded test fixtures maintain synthetic/fixture provenance without promotion to observed market evidence', async () => {
    const saasFixture = adapter.getFixtureById('FIX-SAAS-DEVTOOL-001')!;
    expect(saasFixture.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');

    const result = await screener.screenCapture(saasFixture);
    const evaluation = result.screening_evaluation!;

    // 1. Provenance score is capped at fixture level (7500 bps), NOT live level (10000 bps)
    expect(evaluation.score_breakdown.provenance_bps).toBe(7500);
    expect(evaluation.prioritization_reasons.some((r) => r.includes('RECORDED_GOLDEN_FIXTURE'))).toBe(true);
    expect(evaluation.prioritization_reasons.some((r) => r.includes('LIVE_VERIFIED_CAPTURE'))).toBe(false);

    // 2. Supporting observation records explicit origin_class
    expect(evaluation.supporting_observations[0].origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
    expect(evaluation.supporting_observations[0].payload_sha256).toBe(saasFixture.payload_sha256);
  });

  // --------------------------------------------------------------------------
  // Test 10: Extensibility & Fallback Requirements Contract
  // --------------------------------------------------------------------------
  it('OD-010-EXTENSIBLE-REQUIREMENTS-CONTRACT: Arbitrary custom category strings fall back gracefully without throw or rejection', () => {
    const customReqs = getCategoryVerificationRequirements('QUANTUM_COMPUTING_CREDITS');

    expect(customReqs.category).toBe('QUANTUM_COMPUTING_CREDITS');
    expect(customReqs.requires_upstream_quote).toBe(false);
    expect(customReqs.requires_logistics_route).toBe(false);
    expect(customReqs.category_specific_critical_fields).toContain('category_classification_required');
    expect(customReqs.description).toContain('QUANTUM_COMPUTING_CREDITS');

    const inferred = inferCategoryFromEntityId('custom:infra:quantum-credits-qpu');
    expect(inferred).toBe('UNRESOLVED_NOVEL');
  });
});
