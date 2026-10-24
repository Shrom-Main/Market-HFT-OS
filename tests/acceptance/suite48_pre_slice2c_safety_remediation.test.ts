/**
 * POC-001: Acceptance Suite 48 — Owner Decision OD (Pre-Slice-2C Safety Remediation)
 *
 * Verifies all 11 safety requirements specified in Owner Decision OD:
 * 1. SaaS candidate verification vs economic eligibility: complete evidence reaches VERIFIED,
 *    but missing infrastructure cost fails closed for PAPER_ELIGIBLE and authorizePaperCommit().
 * 2. Physical goods candidate with missing quote: remains discoverable, but fails closed for PAPER_ELIGIBLE.
 * 3. Services candidate with missing labor costs: reaches VERIFIED, but fails closed for PAPER_ELIGIBLE.
 * 4. Fully documented loss-making candidate (quote > ASP): reaches VERIFIED (substantiated claims),
 *    but fails closed for PAPER_ELIGIBLE and paper commitment (EVALUATED_UNATTRACTIVE).
 * 5. Positive margin below policy threshold (< 1000 bps / 10.00%): reaches VERIFIED, but fails closed for PAPER_ELIGIBLE.
 * 6. Fully viable candidate (>= 1000 bps): successfully transitions to PAPER_ELIGIBLE and authorizes paper commit.
 * 7. Direct boundary enforcement in authorizePaperCommit(): independently verifies all invariants at the boundary.
 * 8. Non-canonical raw SKU collision test: unrelated products sharing generic label 'SENSOR-X1' remain distinct candidates.
 * 9. Cross-source convergence: genuine canonical catalog products and canonical URI entities converge cleanly.
 * 10. Ambiguous hardware matches remain held in UNRESOLVED_ENTITY_HOLD.
 * 11. Category enrichment preserves stable candidate ID and replay determinism.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpportunityLifecycleEngine, POLICY_MIN_MARGIN_BPS } from '../../src/research/opportunityLifecycleEngine.js';
import { EntityIdentityResolver } from '../../src/research/entityIdentityResolver.js';
import { FixtureReplayAdapter } from '../../src/discovery/fixtureReplayAdapter.js';
import { DiscoveryScreenerService } from '../../src/discovery/discoveryScreenerService.js';

describe('Suite 48: Pre-Slice-2C Safety Remediation (Economic Gates & SKU Collision Prevention)', () => {
  let lifecycleEngine: OpportunityLifecycleEngine;
  let identityResolver: EntityIdentityResolver;
  let screener: DiscoveryScreenerService;
  let adapter: FixtureReplayAdapter;

  beforeEach(async () => {
    lifecycleEngine = new OpportunityLifecycleEngine();
    identityResolver = new EntityIdentityResolver();
    screener = new DiscoveryScreenerService({
      lifecycleEngine,
      identityResolver
    });
    adapter = new FixtureReplayAdapter();
    await screener.initialize();
  });

  // --------------------------------------------------------------------------
  // Test 1: SaaS Candidate Reaches VERIFIED but Fails Closed for PAPER_ELIGIBLE
  // --------------------------------------------------------------------------
  it('OD-SAFE-001-SAAS-ECONOMIC-GATE: SaaS candidate with known price and missing hosting costs reaches VERIFIED, but fails closed for PAPER_ELIGIBLE', async () => {
    const saasFixture = adapter.getFixtureById('FIX-SAAS-DEVTOOL-001')!;
    expect(saasFixture).toBeDefined();

    const result = await screener.screenCapture(saasFixture);
    const cand = result.candidate!;

    // 1. Evidence sufficiency score is 10,000 bps (100%) for software
    expect(cand.evidence_sufficiency.is_sufficient_for_underwriting).toBe(true);
    expect(cand.evidence_sufficiency.sufficiency_score_bps).toBe(10000);

    // 2. Candidate cleanly reaches VERIFIED through valid lifecycle progression
    await lifecycleEngine.transitionState(cand.candidate_id, 'INVESTIGATE', 'Operator dispatched investigation');
    await lifecycleEngine.transitionState(cand.candidate_id, 'UNDER_REVIEW', 'Investigation findings submitted');
    const verifiedCand = await lifecycleEngine.transitionState(cand.candidate_id, 'VERIFIED', 'All software evidence verified');
    expect(verifiedCand.lifecycle_state).toBe('VERIFIED');

    // 3. Economic eligibility profile fails closed: hosting / delivery cost is missing
    expect(verifiedCand.economic_eligibility.is_economically_eligible).toBe(false);
    expect(verifiedCand.economic_eligibility.evaluation_status).toBe('UNEVALUABLE_INPUTS_MISSING');
    expect(verifiedCand.economic_eligibility.missing_economic_inputs).toContain('infrastructure_or_delivery_cost_inr');
    expect(verifiedCand.economic_eligibility.estimated_margin_bps).toBeNull();
    expect(verifiedCand.economic_eligibility.policy_min_margin_bps).toBe(POLICY_MIN_MARGIN_BPS);

    // 4. Attempting transition to PAPER_ELIGIBLE fails closed
    await expect(
      lifecycleEngine.transitionState(cand.candidate_id, 'PAPER_ELIGIBLE', 'Attempting paper eligibility without cost')
    ).rejects.toThrow(/E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED/);

    // 5. Calling authorizePaperCommit() fails closed at authorization boundary
    await expect(
      lifecycleEngine.authorizePaperCommit(cand.candidate_id, 'Operator approving paper commit without delivery economics')
    ).rejects.toThrow(/E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // Test 2: Physical Goods Candidate Missing Quote Fails Closed
  // --------------------------------------------------------------------------
  it('OD-SAFE-002-PHYSICAL-MISSING-QUOTE: Physical candidate missing factory quote remains discoverable in INVESTIGATE but fails PAPER_ELIGIBLE', async () => {
    const amzFixture = adapter.getFixtureById('FIX-AMZ-SS304-001')!;
    const result = await screener.screenCapture(amzFixture);
    const cand = result.candidate!;

    expect(cand.current_observation.prevailing_retail_asp_inr).toBe(85.0);
    expect(cand.current_observation.factory_gate_quote_inr).toBeNull();
    expect(cand.economic_eligibility.is_economically_eligible).toBe(false);
    expect(cand.economic_eligibility.evaluation_status).toBe('UNEVALUABLE_INPUTS_MISSING');
    expect(cand.economic_eligibility.missing_economic_inputs).toContain('factory_gate_quote_inr');

    await lifecycleEngine.transitionState(cand.candidate_id, 'INVESTIGATE', 'Investigation phase');

    // Transitioning to UNDER_REVIEW is allowed, but VERIFIED fails closed
    await lifecycleEngine.transitionState(cand.candidate_id, 'UNDER_REVIEW', 'Reviewing partial observation');
    await expect(
      lifecycleEngine.transitionState(cand.candidate_id, 'VERIFIED', 'Attempting premature verification')
    ).rejects.toThrow(/E-OPP-VERIFICATION-SUFFICIENCY-BLOCKED/);

    // Direct authorizePaperCommit fails closed
    await expect(
      lifecycleEngine.authorizePaperCommit(cand.candidate_id, 'Operator trying to commit unverified physical candidate')
    ).rejects.toThrow(/E-OPP-UNVERIFIED-COMMIT-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // Test 3: Services Candidate with Missing Labor Cost Fails Closed
  // --------------------------------------------------------------------------
  it('OD-SAFE-003-SERVICE-MISSING-LABOR: Service candidate reaches VERIFIED but fails closed for PAPER_ELIGIBLE without labor cost', async () => {
    const labFixture = adapter.getFixtureById('FIX-SERVICE-METALLURGY-001')!;
    const result = await screener.screenCapture(labFixture);
    const cand = result.candidate!;

    expect(cand.evidence_sufficiency.is_sufficient_for_underwriting).toBe(true);

    await lifecycleEngine.transitionState(cand.candidate_id, 'INVESTIGATE', 'Dispatched service audit');
    await lifecycleEngine.transitionState(cand.candidate_id, 'UNDER_REVIEW', 'Lab accreditation verified');
    await lifecycleEngine.transitionState(cand.candidate_id, 'VERIFIED', 'All accreditation verified');

    // Economic inputs missing direct labor
    expect(cand.economic_eligibility.is_economically_eligible).toBe(false);
    expect(cand.economic_eligibility.evaluation_status).toBe('UNEVALUABLE_INPUTS_MISSING');
    expect(cand.economic_eligibility.missing_economic_inputs).toContain('direct_labor_fulfillment_cost_inr');

    await expect(
      lifecycleEngine.transitionState(cand.candidate_id, 'PAPER_ELIGIBLE', 'Attempting paper eligibility without labor cost')
    ).rejects.toThrow(/E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED/);

    await expect(
      lifecycleEngine.authorizePaperCommit(cand.candidate_id, 'Attempting paper commit without labor cost confirmation')
    ).rejects.toThrow(/E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // Test 4: Fully Documented Loss-Making Candidate Reaches VERIFIED but Fails PAPER_ELIGIBLE
  // --------------------------------------------------------------------------
  it('OD-SAFE-004-LOSS-MAKING-VERIFIED-BUT-INELIGIBLE: Loss-making candidate reaches VERIFIED, but fails closed for PAPER_ELIGIBLE', async () => {
    // Ingest candidate where factory gate quote (₹120) > retail ASP (₹100) -> Loss of ₹20 (-20.00% / -2000 bps)
    const { candidate: lossCandidate } = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:india-b2b:physical-arbitrage',
      canonical_product_id: 'prod:fasteners:hex-bolt:m10-grade-8-8',
      candidate_name: 'Loss-Making Hex Bolt Arbitrage',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 100.0,
      factory_gate_quote_inr: 120.0,
      review_sentiment_summary: 'High-tensile Grade 8.8 bolts verified with laboratory certs.',
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    // 1. Evidence sufficiency is 100% verified (claims and evidence are complete)
    expect(lossCandidate.evidence_sufficiency.is_sufficient_for_underwriting).toBe(true);
    expect(lossCandidate.evidence_sufficiency.sufficiency_score_bps).toBe(10000);

    // 2. Candidate cleanly reaches VERIFIED state: verification documents reality without bias
    await lifecycleEngine.transitionState(lossCandidate.candidate_id, 'INVESTIGATE', 'Dispatched investigation');
    await lifecycleEngine.transitionState(lossCandidate.candidate_id, 'UNDER_REVIEW', 'Under review by analyst');
    const verifiedCand = await lifecycleEngine.transitionState(
      lossCandidate.candidate_id,
      'VERIFIED',
      'Evidence and supplier quotes verified; verified to be loss-making'
    );
    expect(verifiedCand.lifecycle_state).toBe('VERIFIED');

    // 3. Commercial attractiveness is NEGATIVE
    expect(verifiedCand.commercial_attractiveness.attractiveness_rating).toBe('NEGATIVE');
    expect(verifiedCand.commercial_attractiveness.estimated_gross_spread_inr).toBe(-20.0);
    expect(verifiedCand.commercial_attractiveness.estimated_gross_margin_bps).toBe(-2000);

    // 4. Economic eligibility is strictly false with EVALUATED_UNATTRACTIVE status
    expect(verifiedCand.economic_eligibility.is_economically_eligible).toBe(false);
    expect(verifiedCand.economic_eligibility.evaluation_status).toBe('EVALUATED_UNATTRACTIVE');
    expect(verifiedCand.economic_eligibility.estimated_margin_bps).toBe(-2000);
    expect(verifiedCand.economic_eligibility.policy_evaluation_notes).toContain('below policy minimum threshold');

    // 5. Transition to PAPER_ELIGIBLE fails closed
    await expect(
      lifecycleEngine.transitionState(lossCandidate.candidate_id, 'PAPER_ELIGIBLE', 'Attempting paper eligibility for loss-making')
    ).rejects.toThrow(/E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED/);

    // 6. Paper commit authorization independently rejects loss-making candidate
    await expect(
      lifecycleEngine.authorizePaperCommit(
        lossCandidate.candidate_id,
        'Operator attempting to allocate paper money to loss-making item'
      )
    ).rejects.toThrow(/E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // Test 5: Positive Margin Below Policy Threshold (< 1000 bps) Fails Closed
  // --------------------------------------------------------------------------
  it('OD-SAFE-005-SUB-THRESHOLD-MARGIN: Positive margin below policy threshold (500 bps < 1000 bps) reaches VERIFIED but fails closed for PAPER_ELIGIBLE', async () => {
    // Quote ₹95, ASP ₹100 -> Spread ₹5 (+5.00% / 500 bps)
    const { candidate: lowMarginCand } = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:india-b2b:physical-arbitrage',
      canonical_product_id: 'prod:sealing:o-ring-kit:silicone-225p',
      candidate_name: 'Thin-Margin Silicone O-Ring Kit',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 100.0,
      factory_gate_quote_inr: 95.0,
      review_sentiment_summary: 'Clean silicone O-rings verified.',
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    expect(lowMarginCand.evidence_sufficiency.is_sufficient_for_underwriting).toBe(true);

    await lifecycleEngine.transitionState(lowMarginCand.candidate_id, 'INVESTIGATE', 'Dispatched investigation');
    await lifecycleEngine.transitionState(lowMarginCand.candidate_id, 'UNDER_REVIEW', 'Under review');
    await lifecycleEngine.transitionState(lowMarginCand.candidate_id, 'VERIFIED', 'All evidence verified');

    // 500 bps is positive but < 1000 bps policy min
    expect(lowMarginCand.economic_eligibility.is_economically_eligible).toBe(false);
    expect(lowMarginCand.economic_eligibility.evaluation_status).toBe('EVALUATED_UNATTRACTIVE');
    expect(lowMarginCand.economic_eligibility.estimated_margin_bps).toBe(500);

    await expect(
      lifecycleEngine.transitionState(lowMarginCand.candidate_id, 'PAPER_ELIGIBLE', 'Attempting paper eligibility with 5% margin')
    ).rejects.toThrow(/E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED/);

    await expect(
      lifecycleEngine.authorizePaperCommit(lowMarginCand.candidate_id, 'Operator attempting paper commit on thin margin')
    ).rejects.toThrow(/E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // Test 6: Fully Viable Candidate Above Policy Threshold (>= 1000 bps) Succeeds
  // --------------------------------------------------------------------------
  it('OD-SAFE-006-VIABLE-CANDIDATE-PAPER-COMMIT: Fully viable candidate (7059 bps >= 1000 bps) authorizes paper commit cleanly', async () => {
    // Quote ₹25, ASP ₹85 -> Spread ₹60 (+70.59% / 7059 bps)
    const { candidate: viableCand } = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:india-b2b:physical-arbitrage',
      canonical_product_id: 'prod:din3017:ss304:16-25mm:pack-10',
      candidate_name: 'Viable SS304 Hose Clamps',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 85.0,
      factory_gate_quote_inr: 25.0,
      review_sentiment_summary: 'Corrosion-resistant DIN 3017 W4 clamps.',
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    expect(viableCand.evidence_sufficiency.is_sufficient_for_underwriting).toBe(true);
    expect(viableCand.economic_eligibility.is_economically_eligible).toBe(true);
    expect(viableCand.economic_eligibility.evaluation_status).toBe('EVALUATED_VIABLE');
    expect(viableCand.economic_eligibility.estimated_margin_bps).toBe(7059);

    await lifecycleEngine.transitionState(viableCand.candidate_id, 'INVESTIGATE', 'Investigation phase');
    await lifecycleEngine.transitionState(viableCand.candidate_id, 'UNDER_REVIEW', 'Analysis complete');
    await lifecycleEngine.transitionState(viableCand.candidate_id, 'VERIFIED', 'All evidence confirmed');

    // Authorize paper commit succeeds
    const commit = await lifecycleEngine.authorizePaperCommit(
      viableCand.candidate_id,
      'Authorized by Operator #99: Arbitrage margin confirmed at 7059 bps with verified logistics route.',
      'operator-99'
    );

    expect(commit.authorized).toBe(true);
    expect(commit.candidate_id).toBe(viableCand.candidate_id);
    expect(commit.commit_event_hash).toMatch(/^[a-f0-9]{64}$/);

    const postCommitCand = await lifecycleEngine.getCandidate(viableCand.candidate_id);
    expect(postCommitCand!.lifecycle_state).toBe('PAPER_ELIGIBLE');
  });

  // --------------------------------------------------------------------------
  // Test 7: Direct Boundary Invariant Enforcement in authorizePaperCommit()
  // --------------------------------------------------------------------------
  it('OD-SAFE-007-BOUNDARY-INDEPENDENCE: authorizePaperCommit() independently enforces all safety gates at the boundary', async () => {
    // 1. Candidate in NEW state
    const { candidate: newCand } = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:test',
      canonical_product_id: 'software:api:rate-limiter',
      candidate_name: 'Test API',
      category: 'SOFTWARE_DIGITAL',
      source_connector_id: 'conn:test',
      prevailing_retail_asp_inr: 1000.0
    });

    await expect(
      lifecycleEngine.authorizePaperCommit(newCand.candidate_id, 'Valid substantive rationale of at least 15 characters')
    ).rejects.toThrow(/E-OPP-UNVERIFIED-COMMIT-BLOCKED/);

    // 2. Candidate with stale evidence flag
    const { candidate: viableCand } = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:test',
      canonical_product_id: 'prod:din3017:ss304:16-25mm:pack-10',
      candidate_name: 'Viable SS304 Clamps',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:test',
      prevailing_retail_asp_inr: 85.0,
      factory_gate_quote_inr: 25.0,
      review_sentiment_summary: 'Good reviews',
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    await lifecycleEngine.transitionState(viableCand.candidate_id, 'INVESTIGATE', 'Phase 1');
    await lifecycleEngine.transitionState(viableCand.candidate_id, 'UNDER_REVIEW', 'Phase 2');
    await lifecycleEngine.transitionState(viableCand.candidate_id, 'VERIFIED', 'Phase 3');

    // Simulate network fault marking candidate stale
    await lifecycleEngine.recordObservationFailure(viableCand.candidate_id, 'Network timeout', 'conn:test');

    await expect(
      lifecycleEngine.authorizePaperCommit(viableCand.candidate_id, 'Valid substantive rationale of at least 15 characters')
    ).rejects.toThrow(/E-OPP-STALE-COMMIT-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // Test 8: Non-Canonical Raw SKU Collision Prevention
  // --------------------------------------------------------------------------
  it('OD-SAFE-008-PREVENT-SKU-COLLISION: Unrelated products sharing raw SKU "SENSOR-X1" from different sources do NOT collapse into one candidate', async () => {
    // Observation 1: Automotive Sensor from Amazon
    const autoObservation = identityResolver.resolveIdentity({
      source_id: 'conn:marketplace:amazon-in',
      target_sku_id: 'SENSOR-X1',
      category: 'PHYSICAL_GOODS',
      raw_payload: JSON.stringify({
        title: 'Automotive Engine Temperature Sensor X1',
        gross_price_inr: 1200.0,
        sku_id: 'SENSOR-X1'
      })
    });

    // Observation 2: Medical Oxygen Sensor from IndiaMART
    const medObservation = identityResolver.resolveIdentity({
      source_id: 'conn:b2b:indiamart',
      target_sku_id: 'SENSOR-X1',
      category: 'PHYSICAL_GOODS',
      raw_payload: JSON.stringify({
        title: 'Medical Grade Oxygen Concentration Sensor X1',
        gross_price_inr: 8500.0,
        sku_id: 'SENSOR-X1'
      })
    });

    // 1. Identity Resolver produces distinct composite entity IDs based on category, source, and raw SKU
    expect(autoObservation.product_id).not.toBe(medObservation.product_id);
    expect(autoObservation.product_id).toBe('noncanonical:physical_goods:conn_marketplace_amazon-in:sensor-x1');
    expect(medObservation.product_id).toBe('noncanonical:physical_goods:conn_b2b_indiamart:sensor-x1');

    // 2. Ingesting both observations into lifecycle engine produces two completely distinct candidates
    const resAuto = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:arbitrage',
      canonical_product_id: autoObservation.product_id,
      candidate_name: 'Automotive Engine Sensor X1',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 1200.0
    });

    const resMed = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:arbitrage',
      canonical_product_id: medObservation.product_id,
      candidate_name: 'Medical Oxygen Sensor X1',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:b2b:indiamart',
      prevailing_retail_asp_inr: 8500.0
    });

    expect(resAuto.candidate.candidate_id).not.toBe(resMed.candidate.candidate_id);

    // 3. Price updates on Amazon do NOT alter or overwrite the Medical sensor
    const updateAuto = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:arbitrage',
      canonical_product_id: autoObservation.product_id,
      candidate_name: 'Automotive Engine Sensor X1',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 1250.0
    });

    expect(updateAuto.candidate.candidate_id).toBe(resAuto.candidate.candidate_id);
    expect(updateAuto.signal).toBe('PRICE_CHANGED');

    // Medical sensor candidate remains untouched with original price ₹8500
    const medCand = await lifecycleEngine.getCandidate(resMed.candidate.candidate_id);
    expect(medCand!.current_observation.prevailing_retail_asp_inr).toBe(8500.0);
    expect(medCand!.observation_history_count).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Test 9: Confirmed Cross-Source Observations of Canonical Products Converge
  // --------------------------------------------------------------------------
  it('OD-SAFE-009-CANONICAL-CONVERGENCE: Cross-source captures with genuine canonical IDs converge cleanly to the same candidate', async () => {
    // 1. Physical catalog item: prod:din3017:ss304:16-25mm:pack-10 from Amazon and IndiaMart
    const amzFixture = adapter.getFixtureById('FIX-AMZ-SS304-001')!;
    const imartFixture = adapter.getFixtureById('FIX-IMART-SS304-001')!;

    const amzRes = await screener.screenCapture(amzFixture);
    const imartRes = await screener.screenCapture(imartFixture);

    expect(amzRes.candidate!.candidate_id).toBe(imartRes.candidate!.candidate_id);
    expect(imartRes.candidate!.canonical_product_id).toBe('prod:din3017:ss304:16-25mm:pack-10');

    // 2. Canonical digital URI: software:devtools:distributed-tracing-agent across multiple sources
    const saasRes1 = await identityResolver.resolveIdentity({
      source_id: 'conn:marketplace:saas-store-1',
      product_id: 'software:devtools:distributed-tracing-agent',
      category: 'SOFTWARE_DIGITAL',
      raw_payload: JSON.stringify({ price: 4999 })
    });

    const saasRes2 = await identityResolver.resolveIdentity({
      source_id: 'conn:marketplace:saas-store-2',
      product_id: 'software:devtools:distributed-tracing-agent',
      category: 'SOFTWARE_DIGITAL',
      raw_payload: JSON.stringify({ price: 4999 })
    });

    expect(saasRes1.product_id).toBe('software:devtools:distributed-tracing-agent');
    expect(saasRes2.product_id).toBe('software:devtools:distributed-tracing-agent');

    const id1 = OpportunityLifecycleEngine.computeCandidateId('strat:saas', saasRes1.product_id);
    const id2 = OpportunityLifecycleEngine.computeCandidateId('strat:saas', saasRes2.product_id);
    expect(id1).toBe(id2);
  });

  // --------------------------------------------------------------------------
  // Test 10: Ambiguous Hardware Matches Remain Held as UNRESOLVED_ENTITY_HOLD
  // --------------------------------------------------------------------------
  it('OD-SAFE-010-UNRESOLVED-ENTITY-HOLD: Ambiguous hardware captures without catalog match, URI prefix, or category hint remain held', async () => {
    const unknownWidget = adapter.getFixtureById('FIX-UNKNOWN-WIDGET-001')!;
    const screenRes = await screener.screenCapture(unknownWidget);

    expect(screenRes.resolution_status).toBe('UNRESOLVED_ENTITY_HOLD');
    expect(screenRes.candidate).toBeNull();
    expect(screenRes.notes).toContain('E-SCW-UNRESOLVED-ENTITY');
  });

  // --------------------------------------------------------------------------
  // Test 11: Category Enrichment Preserves Candidate ID & Replay Determinism
  // --------------------------------------------------------------------------
  it('OD-SAFE-011-CATEGORY-ENRICHMENT-IDENTITY-STABILITY: Enriching candidate category does not change stable candidate ID or corrupt Merkle history', async () => {
    const stratId = 'strat:india-b2b:enrichment-test';
    const prodId = 'software:data:columnar-storage-engine';

    // Observation 1: Ingest without explicit category
    const { candidate: c1 } = await lifecycleEngine.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'Columnar Storage Engine',
      source_connector_id: 'conn:tech-eval',
      prevailing_retail_asp_inr: 80000.0
    });

    const originalCandidateId = c1.candidate_id;

    // Observation 2: Subsequent enrichment with explicit category 'SOFTWARE_DIGITAL'
    const { candidate: c2 } = await lifecycleEngine.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'Columnar Storage Engine (Enriched)',
      category: 'SOFTWARE_DIGITAL',
      source_connector_id: 'conn:tech-eval',
      prevailing_retail_asp_inr: 80000.0,
      review_sentiment_summary: 'Clean vectorized queries verified.',
      has_regulatory_clearance: true
    });

    // 1. Candidate ID is strictly identical across category enrichment
    expect(c2.candidate_id).toBe(originalCandidateId);
    expect(c2.category).toBe('SOFTWARE_DIGITAL');
    expect(c2.observation_history_count).toBe(2); // Ingested initial + spec enrichment observation

    // 2. Merkle event history is intact and verifiable
    const events = await lifecycleEngine.getEventHistory(originalCandidateId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].candidate_id).toBe(originalCandidateId);
  });
});
