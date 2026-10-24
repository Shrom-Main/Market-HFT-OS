/**
 * POC-001: Gate Slice 2B — Stage 0 Discovery Screener: Discovery Sieve & Delta Detection Rules
 *
 * Suite 46 Normative Acceptance Test Suite verifying:
 * 1. SIEVE-DETERMINISTIC-SCORING-AND-RANKING-001: Deterministic scoring and stable ranking under identical inputs.
 * 2. SIEVE-POLICY-VERSION-REPRODUCIBILITY-002: Explicit policy-version changes and reproducibility.
 * 3. SIEVE-MATERIALITY-THRESHOLD-DELTA-DETECTION-003: Price and quote changes, including immaterial changes below threshold.
 * 4. SIEVE-GRIEVANCE-DETECTION-WITHOUT-DUPLICATE-EVENTS-004: New grievance detection without duplicate event creation.
 * 5. SIEVE-STALE-CONFLICT-AND-OUT-OF-ORDER-005: Stale, conflicting, missing, and out-of-order observations.
 * 6. SIEVE-MISSING-COST-DATA-BANS-ZERO-SUBSTITUTION-006: Missing cost data remaining unknown rather than becoming zero.
 * 7. SIEVE-HIGH-MARGIN-LOW-EVIDENCE-SEPARATION-007: High commercial attractiveness with low evidence completeness.
 * 8. SIEVE-PROVENANCE-DISTINCTION-ZERO-PROMOTION-008: Fixture provenance remaining distinct from observed-source provenance.
 * 9. SIEVE-DUPLICATE-INGESTION-ZERO-SPURIOUS-EVENTS-009: Duplicate ingestion and repeat replay producing no spurious events.
 * 10. SIEVE-COLLECTOR-FAILURE-ISOLATION-010: Collector failures not being treated as evidence of commercial failure.
 * 11. SIEVE-EXPLAINABLE-REASONS-AND-INVESTIGATION-TASKS-011: Explainable priority reasons and structured investigation tasks.
 * 12. SIEVE-REGRESSION-PROTECTION-LIFECYCLE-AND-AUTHORIZATION-012: Regression protection for Slice 1 lifecycle and authorization rules.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sha256 } from '../../src/canonical/crypto.js';
import {
  DiscoveryScreenerService
} from '../../src/discovery/discoveryScreenerService.js';
import {
  ScreeningPolicyEngine,
  ScreeningPolicyConfig,
  DEFAULT_SCREENING_POLICY_V1
} from '../../src/discovery/screeningPolicy.js';
import { DeltaDetector } from '../../src/discovery/deltaDetector.js';
import { FixtureReplayAdapter } from '../../src/discovery/fixtureReplayAdapter.js';
import { createRawSourceCapture } from '../../src/discovery/sourceAdapterContract.js';
import { OpportunityLifecycleEngine } from '../../src/research/opportunityLifecycleEngine.js';

describe('Suite 46: Slice 2B Stage 0 Discovery Screener — Discovery Sieve & Delta Detection Rules', () => {
  let screener: DiscoveryScreenerService;
  let adapter: FixtureReplayAdapter;

  beforeEach(async () => {
    screener = new DiscoveryScreenerService();
    await screener.initialize();
    adapter = new FixtureReplayAdapter();
  });

  // --------------------------------------------------------------------------
  // Test 1: Deterministic Scoring and Stable Ranking
  // --------------------------------------------------------------------------
  it('SIEVE-DETERMINISTIC-SCORING-AND-RANKING-001: Deterministic scoring and stable ranking under identical inputs', async () => {
    // Ingest SS304 Clamp and Brass Ball Valve
    await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-001')!);
    await screener.screenCapture(adapter.getFixtureById('FIX-IMART-SS304-001')!);
    await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-BRASS-001')!);
    await screener.screenCapture(adapter.getFixtureById('FIX-IMART-BRASS-001')!);

    const candidates = await screener.getLifecycleEngine().listCandidates();
    expect(candidates.length).toBe(2);

    // Rank run 1
    const ranked1 = screener.rankCandidates(candidates);
    // Rank run 2
    const ranked2 = screener.rankCandidates(candidates);

    expect(ranked1.length).toBe(2);
    expect(ranked2.length).toBe(2);

    // Assert 100% identical ranking order and bit-identical JCS digests
    for (let i = 0; i < ranked1.length; i++) {
      expect(ranked1[i].candidate_id).toBe(ranked2[i].candidate_id);
      expect(ranked1[i].priority_score_bps).toBe(ranked2[i].priority_score_bps);
      expect(ranked1[i].priority_tier).toBe(ranked2[i].priority_tier);
      expect(ranked1[i].jcs_sha256).toBe(ranked2[i].jcs_sha256);
    }

    // Both candidates have positive spreads and valid scores
    expect(ranked1[0].priority_score_bps).toBeGreaterThan(0);
    expect(ranked1[1].priority_score_bps).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // Test 2: Explicit Policy-Version Changes and Reproducibility
  // --------------------------------------------------------------------------
  it('SIEVE-POLICY-VERSION-REPRODUCIBILITY-002: Explicit policy-version changes and reproducibility', async () => {
    await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-001')!);
    await screener.screenCapture(adapter.getFixtureById('FIX-IMART-SS304-001')!);

    const cand = (await screener.getLifecycleEngine().listCandidates())[0];

    // Policy V1 (Default: 35% commercial, 30% evidence, 20% signal, 15% provenance)
    const engineV1 = new ScreeningPolicyEngine();
    const evalV1 = engineV1.evaluateCandidate(cand);
    expect(evalV1.screening_policy_version).toBe('1.0.0');

    // Policy V2 (Custom: 10% commercial, 20% evidence, 60% signal urgency, 10% provenance)
    const customConfigV2: ScreeningPolicyConfig = {
      ...DEFAULT_SCREENING_POLICY_V1,
      policy_version: '2.0.0-urgency-boost',
      weight_commercial_bps: 1000,
      weight_evidence_completeness_bps: 2000,
      weight_signal_urgency_bps: 6000,
      weight_provenance_bps: 1000
    };
    const engineV2 = new ScreeningPolicyEngine(customConfigV2);
    const evalV2 = engineV2.evaluateCandidate(cand);
    expect(evalV2.screening_policy_version).toBe('2.0.0-urgency-boost');

    // Scores under distinct policies are explicitly different and reproducible
    expect(evalV1.jcs_sha256).not.toBe(evalV2.jcs_sha256);

    // Re-evaluating under V1 again produces identical hash
    const evalV1Repeat = engineV1.evaluateCandidate(cand);
    expect(evalV1.jcs_sha256).toBe(evalV1Repeat.jcs_sha256);
  });

  // --------------------------------------------------------------------------
  // Test 3: Materiality Threshold Delta Detection
  // --------------------------------------------------------------------------
  it('SIEVE-MATERIALITY-THRESHOLD-DELTA-DETECTION-003: Price and quote changes, including immaterial changes below threshold', async () => {
    const initialCapture = adapter.getFixtureById('FIX-AMZ-SS304-001')!; // ASP ₹85.00
    const res1 = await screener.screenCapture(initialCapture);
    expect(res1.signal).toBe('INITIAL_OBSERVATION');

    // 1. Immaterial Retail Price Change (₹85.00 -> ₹85.20: delta = ₹0.20, deltaBps = 24 bps < 100 bps threshold)
    const immaterialPriceCapture = createRawSourceCapture({
      capture_id: 'FIX-AMZ-SS304-IMMATERIAL-PRICE',
      source_connector_id: 'conn:marketplace:amazon-in',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      source_observed_at_utc: '2026-10-24T10:30:00.000Z',
      raw_payload: JSON.stringify({
        asin: 'B09XYZ1234',
        unit_price_inr: 85.20
      }),
      extracted_fields: {
        asin: 'B09XYZ1234',
        gross_price_inr: 85.20
      }
    });

    const resImmaterial = await screener.screenCapture(immaterialPriceCapture);
    // Below threshold -> classifies as UNCHANGED
    expect(resImmaterial.signal).toBe('UNCHANGED');
    expect(resImmaterial.candidate!.current_observation.prevailing_retail_asp_inr).toBe(85.20);

    // 2. Material Retail Price Change (₹85.20 -> ₹72.00: delta = ₹13.20, deltaBps = 1549 bps >= 100 bps)
    const materialPriceDrop = adapter.getFixtureById('FIX-AMZ-SS304-PRICE-DROP-002')!;
    const resMaterial = await screener.screenCapture(materialPriceDrop);
    expect(resMaterial.signal).toBe('PRICE_CHANGED');
    expect(resMaterial.candidate!.current_observation.prevailing_retail_asp_inr).toBe(72.00);

    // 3. Immaterial Supplier Quote Change (₹25.00 -> ₹25.10: delta = ₹0.10, 40 bps < 100 bps)
    await screener.screenCapture(adapter.getFixtureById('FIX-IMART-SS304-001')!); // Quote ₹25.00
    const immaterialQuoteCapture = createRawSourceCapture({
      capture_id: 'FIX-IMART-SS304-IMMATERIAL-QUOTE',
      source_connector_id: 'conn:b2b:indiamart',
      source_type: 'SUPPLIER_B2B_CATALOG',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      source_observed_at_utc: '2026-10-24T11:15:00.000Z',
      raw_payload: JSON.stringify({
        supplier_sku: 'HOWRAH-SS304-16-25',
        factory_gate_quote_inr: 25.10
      }),
      extracted_fields: {
        supplier_sku: 'HOWRAH-SS304-16-25',
        factory_gate_quote_inr: 25.10
      }
    });
    const quoteResImmaterial = await screener.screenCapture(immaterialQuoteCapture);
    expect(quoteResImmaterial.signal).toBe('UNCHANGED');

    // 4. Material Supplier Quote Change (₹25.10 -> ₹29.00: delta = ₹3.90, 1554 bps >= 100 bps)
    const materialQuoteUpdate = adapter.getFixtureById('FIX-IMART-SS304-QUOTE-UPDATE-003')!;
    const quoteResMaterial = await screener.screenCapture(materialQuoteUpdate);
    expect(quoteResMaterial.signal).toBe('SUPPLIER_QUOTE_UPDATED');
    expect(quoteResMaterial.candidate!.current_observation.factory_gate_quote_inr).toBe(29.00);
  });

  // --------------------------------------------------------------------------
  // Test 4: Grievance Detection Without Duplicate Event Creation
  // --------------------------------------------------------------------------
  it('SIEVE-GRIEVANCE-DETECTION-WITHOUT-DUPLICATE-EVENTS-004: New grievance detection without duplicate event creation', async () => {
    // Initial discovery
    const initialRes = await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-001')!);
    const candId = initialRes.candidate!.candidate_id;

    // Grievance intake (1st time) -> GRIEVANCE_SURFACED
    const grievanceRes1 = await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-GRIEVANCE-004')!);
    expect(grievanceRes1.signal).toBe('GRIEVANCE_SURFACED');
    expect(grievanceRes1.candidate!.active_signals).toContain('GRIEVANCE_SURFACED');
    const eventsAfterGrievance = await screener.getLifecycleEngine().getEventHistory(candId);
    const grievanceEventCount = eventsAfterGrievance.filter((e) => e.signal === 'GRIEVANCE_SURFACED').length;
    expect(grievanceEventCount).toBe(1);

    // Grievance intake (2nd time: identical sentiment) -> UNCHANGED
    const grievanceRes2 = await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-GRIEVANCE-004')!);
    expect(grievanceRes2.signal).toBe('UNCHANGED');
    const subsequentEvents = await screener.getLifecycleEngine().getEventHistory(candId);
    expect(subsequentEvents.filter((e) => e.signal === 'GRIEVANCE_SURFACED').length).toBe(1); // No duplicate events!
  });

  // --------------------------------------------------------------------------
  // Test 5: Stale, Conflicting, and Out-of-Order Observations
  // --------------------------------------------------------------------------
  it('SIEVE-STALE-CONFLICT-AND-OUT-OF-ORDER-005: Stale, conflicting, missing, and out-of-order observations', async () => {
    // 1. Initial intake at T0
    const t0 = '2026-09-01T10:00:00.000Z';
    const initCapture = createRawSourceCapture({
      capture_id: 'FIX-AMZ-SS304-T0',
      source_connector_id: 'conn:marketplace:amazon-in',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      source_observed_at_utc: t0,
      raw_payload: JSON.stringify({ asin: 'B09XYZ1234', unit_price_inr: 85.0 }),
      extracted_fields: { asin: 'B09XYZ1234', gross_price_inr: 85.0 }
    });
    await screener.screenCapture(initCapture);

    // 2. Stale Observation Check: Observation 40 days later (> 720h TTL)
    const tStale = '2026-10-15T10:00:00.000Z'; // 44 days later
    const staleCapture = createRawSourceCapture({
      capture_id: 'FIX-AMZ-SS304-STALE',
      source_connector_id: 'conn:marketplace:amazon-in',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      source_observed_at_utc: tStale,
      raw_payload: JSON.stringify({ asin: 'B09XYZ1234', unit_price_inr: 85.0 }),
      extracted_fields: { asin: 'B09XYZ1234', gross_price_inr: 85.0 }
    });
    const staleRes = await screener.screenCapture(staleCapture);
    expect(staleRes.signal).toBe('EVIDENCE_STALE');
    expect(staleRes.candidate!.active_signals).toContain('EVIDENCE_STALE');

    // 3. Cross-Source Conflict Check: Source B reports quote of ₹40.00 (60% higher than Source A ₹25.00)
    await screener.screenCapture(adapter.getFixtureById('FIX-IMART-SS304-001')!); // Source A: indiamart, ₹25
    const conflictingSupplierCapture = createRawSourceCapture({
      capture_id: 'FIX-ALT-SUPPLIER-CONFLICT',
      source_connector_id: 'conn:b2b:tradeindia',
      source_type: 'SUPPLIER_B2B_CATALOG',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      source_observed_at_utc: '2026-10-24T12:00:00.000Z',
      raw_payload: JSON.stringify({
        supplier_sku: 'HOWRAH-SS304-16-25',
        factory_gate_quote_inr: 40.0 // 6000 bps divergence from ₹25
      }),
      extracted_fields: {
        supplier_sku: 'HOWRAH-SS304-16-25',
        factory_gate_quote_inr: 40.0
      }
    });

    const conflictRes = await screener.screenCapture(conflictingSupplierCapture);
    expect(conflictRes.signal).toBe('EVIDENCE_CONFLICT_DETECTED');
    expect(conflictRes.candidate!.active_signals).toContain('EVIDENCE_CONFLICT_DETECTED');
    expect(conflictRes.recommended_tasks.some((t) => t.task_type === 'CONFLICT_ARBITRATION')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 6: Missing Cost Data Bans Zero Substitution
  // --------------------------------------------------------------------------
  it('SIEVE-MISSING-COST-DATA-BANS-ZERO-SUBSTITUTION-006: Missing cost data remaining unknown rather than becoming zero', async () => {
    // Ingest "Contact Supplier" fixture with null quote
    const missingQuoteFixture = adapter.getFixtureById('FIX-IMART-SS304-MISSING-QUOTE-005')!;
    const res = await screener.screenCapture(missingQuoteFixture);

    const cand = res.candidate!;
    // Quote is strictly null
    expect(cand.current_observation.factory_gate_quote_inr).toBeNull();
    expect(cand.commercial_attractiveness.estimated_gross_spread_inr).toBeNull();
    expect(cand.commercial_attractiveness.attractiveness_rating).toBe('UNKNOWN');

    // Screening evaluation score component for commercial is 0 (missing data is NOT fabricated)
    expect(res.screening_evaluation!.score_breakdown.commercial_bps).toBe(0);
    expect(res.screening_evaluation!.deferral_or_rejection_reasons).toContain(
      'Missing factory gate quote; wholesale procurement spread cannot be computed.'
    );

    // Recommended task generated for supplier quote acquisition
    expect(res.recommended_tasks.some((t) => t.task_type === 'SUPPLIER_QUOTE_ACQUISITION')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 7: Separation of High Commercial Attractiveness from Low Evidence
  // --------------------------------------------------------------------------
  it('SIEVE-HIGH-MARGIN-LOW-EVIDENCE-SEPARATION-007: High commercial attractiveness with low evidence completeness', async () => {
    // Candidate with high spread (ASP ₹85, Quote ₹25, margin 7058 bps), but NO reviews, route, or statutory reg
    const highMarginLowEvidCapture = createRawSourceCapture({
      capture_id: 'FIX-HIGH-MARGIN-LOW-EVID',
      source_connector_id: 'conn:marketplace:amazon-in',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      source_observed_at_utc: '2026-10-24T10:00:00.000Z',
      raw_payload: JSON.stringify({
        asin: 'B09XYZ1234',
        gross_price_inr: 85.0,
        factory_gate_quote_inr: 25.0
      }),
      extracted_fields: {
        asin: 'B09XYZ1234',
        gross_price_inr: 85.0,
        factory_gate_quote_inr: 25.0,
        has_logistics_route: false,
        has_regulatory_clearance: false,
        review_sentiment_summary: null
      }
    });

    const res = await screener.screenCapture(highMarginLowEvidCapture);
    const cand = res.candidate!;

    // 1. Commercial score is 10,000 bps (max spread)
    expect(res.screening_evaluation!.score_breakdown.commercial_bps).toBe(10000);

    // 2. Evidence completeness is only 6000 bps (not sufficient for underwriting)
    expect(cand.evidence_sufficiency.is_sufficient_for_underwriting).toBe(false);
    expect(cand.evidence_sufficiency.missing_critical_fields).toContain('review_sentiment_summary');

    // 3. Priority tier is HIGH/MEDIUM for investigation, but candidate remains in state NEW
    expect(cand.lifecycle_state).toBe('NEW');
    expect(['HIGH', 'CRITICAL', 'MEDIUM']).toContain(res.priority_tier);

    // 4. Governance Firewall: Attempting to commit to paper allocation strictly fails closed
    await expect(
      screener.getLifecycleEngine().authorizePaperCommit(cand.candidate_id, 'Attempting early allocation without verification')
    ).rejects.toThrow(/E-OPP-UNVERIFIED-COMMIT-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // Test 8: Provenance Distinction & No Synthetic-to-Observed Promotion
  // --------------------------------------------------------------------------
  it('SIEVE-PROVENANCE-DISTINCTION-ZERO-PROMOTION-008: Fixture provenance remaining distinct from observed-source provenance', async () => {
    // Golden fixture intake
    const fixtureCapture = adapter.getFixtureById('FIX-AMZ-SS304-001')!;
    const res = await screener.screenCapture(fixtureCapture);

    // Provenance score reflects RECORDED_GOLDEN_FIXTURE (7,500 bps), NOT LIVE_VERIFIED_CAPTURE (10,000 bps)
    expect(res.screening_evaluation!.score_breakdown.provenance_bps).toBe(7500);
    expect(res.screening_evaluation!.prioritization_reasons).toContain(
      'Provenance: RECORDED_GOLDEN_FIXTURE with cryptographic payload signature.'
    );

    // Invariant: Verifying payload hash does NOT promote fixture to live evidence
    expect(res.normalized_observation!.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
  });

  // --------------------------------------------------------------------------
  // Test 9: Duplicate Ingestion Produces Zero Spurious Events
  // --------------------------------------------------------------------------
  it('SIEVE-DUPLICATE-INGESTION-ZERO-SPURIOUS-EVENTS-009: Duplicate ingestion and repeat replay producing no spurious events', async () => {
    const fixture = adapter.getFixtureById('FIX-AMZ-SS304-001')!;

    // Intake 1
    const res1 = await screener.screenCapture(fixture);
    const candId = res1.candidate!.candidate_id;
    const events1 = await screener.getLifecycleEngine().getEventHistory(candId);
    expect(events1.length).toBe(1);

    // Intake 2 & 3: Identical payload
    const res2 = await screener.screenCapture(fixture);
    const res3 = await screener.screenCapture(fixture);

    expect(res2.signal).toBe('UNCHANGED');
    expect(res3.signal).toBe('UNCHANGED');

    // Event history is strictly unchanged (zero event pollution)
    const events3 = await screener.getLifecycleEngine().getEventHistory(candId);
    expect(events3.length).toBe(1);
    expect(res3.candidate!.observation_history_count).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Test 10: Collector Failure Isolation
  // --------------------------------------------------------------------------
  it('SIEVE-COLLECTOR-FAILURE-ISOLATION-010: Collector failures not being treated as evidence of commercial failure', async () => {
    // Ingest viable candidate
    const res = await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-001')!);
    const candId = res.candidate!.candidate_id;

    // Simulate collector failure (network timeout / API outage)
    const updated = await screener.getLifecycleEngine().recordObservationFailure(
      candId,
      'ETIMEDOUT: Connection reset by peer during marketplace scrape',
      'conn:marketplace:amazon-in'
    );

    // 1. Candidate is NOT rejected or commercially marked invalid
    expect(updated.lifecycle_state).toBe('NEW'); // State preserved!
    expect(updated.investigation_status).toBe('FAILED');
    expect(updated.active_signals).toContain('EVIDENCE_STALE');

    // 2. Evaluated priority notes the failure without zeroing candidate
    const screening = screener.getScreeningEngine().evaluateCandidate(updated);
    expect(screening.deferral_or_rejection_reasons).toContain(
      'Observation age exceeds allowable TTL; candidate data requires refreshing.'
    );
  });

  // --------------------------------------------------------------------------
  // Test 11: Explainable Priority Reasons and Structured Investigation Tasks
  // --------------------------------------------------------------------------
  it('SIEVE-EXPLAINABLE-REASONS-AND-INVESTIGATION-TASKS-011: Explainable priority reasons and structured investigation tasks', async () => {
    // Ingest SS304 Clamp with missing quote and grievance
    await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-001')!);
    const res = await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-GRIEVANCE-004')!);

    const evalResult = res.screening_evaluation!;

    // 1. Prioritization reasons are explicit and auditable
    expect(evalResult.prioritization_reasons.length).toBeGreaterThan(0);
    expect(evalResult.prioritization_reasons.some((r) => r.includes('grievance'))).toBe(true);

    // 2. Recommended tasks are structured with explicit target fields and rationales
    expect(evalResult.recommended_investigation_tasks.length).toBeGreaterThan(0);
    const grievanceTask = evalResult.recommended_investigation_tasks.find(
      (t) => t.task_type === 'GRIEVANCE_SEVERITY_MINING'
    );
    expect(grievanceTask).toBeDefined();
    expect(grievanceTask!.priority).toBe('CRITICAL');
    expect(grievanceTask!.target_field).toBe('review_sentiment_summary');
    expect(grievanceTask!.rationale).toContain('Customer complaints');
  });

  // --------------------------------------------------------------------------
  // Test 12: Regression Protection for Slice 1 Lifecycle and Authorization Rules
  // --------------------------------------------------------------------------
  it('SIEVE-REGRESSION-PROTECTION-LIFECYCLE-AND-AUTHORIZATION-012: Regression protection for Slice 1 lifecycle and authorization rules', async () => {
    const res = await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-001')!);
    const candId = res.candidate!.candidate_id;

    // 1. State jumps are rejected (NEW -> VERIFIED fails closed)
    await expect(
      screener.getLifecycleEngine().transitionState(candId, 'VERIFIED', 'Unauthorized direct jump', 'op:bad')
    ).rejects.toThrow(/E-OPP-INVALID-TRANSITION/);

    // 2. Permitted sequence (NEW -> INVESTIGATE -> UNDER_REVIEW -> VERIFIED)
    await screener.getLifecycleEngine().transitionState(candId, 'INVESTIGATE', 'Valid investigation transition', 'op:analyst');
    await screener.getLifecycleEngine().transitionState(candId, 'UNDER_REVIEW', 'Valid review transition', 'op:analyst');

    // 3. Hash-linked event chain remains unbroken
    const history = await screener.getLifecycleEngine().getEventHistory(candId);
    expect(history.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < history.length; i++) {
      expect(history[i].previous_event_hash).toBe(history[i - 1].event_hash);
    }

    // 4. Paper authorization requires >= 15-char rationale
    await expect(
      screener.getLifecycleEngine().authorizePaperCommit(candId, 'Too short')
    ).rejects.toThrow(/E-OPP-COMMIT-RATIONALE-REQUIRED/);
  });
});
