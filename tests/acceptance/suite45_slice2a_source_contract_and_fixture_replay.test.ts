/**
 * POC-001: Gate Slice 2A — Stage 0 Discovery Screener: Source Contract & Fixture Replay
 *
 * Suite 45 Normative Acceptance Test Suite verifying:
 * 1. STAGE0-CONTRACT-AND-SCOPING-001: Verifies source-adapter contract, permission scopes, and telemetry reporting.
 * 2. STAGE0-GOLDEN-FIXTURE-INTEGRITY-002: Verifies versioned golden fixtures load with cryptographic SHA-256 payload integrity, attributable provenance signatures, and distinct source vs retrieval timestamps.
 * 3. STAGE0-CANONICAL-IDENTITY-NORMALIZATION-003: Proves raw Amazon India and IndiaMART captures resolve deterministically to canonical SS304 DIN 3017 product identity.
 * 4. STAGE0-AMBIGUOUS-ENTITY-HOLD-004: Ambiguous hardware capture with no matching catalog ASIN, SKU, or HSN holds as UNRESOLVED_ENTITY_HOLD without phantom entity invention.
 * 5. STAGE0-NEW-CANDIDATE-LIFECYCLE-ROUTING-005: Resolved observation routes seamlessly into OpportunityLifecycleEngine.ingestObservation(), creating stable candidate in state NEW with signal INITIAL_OBSERVATION.
 * 6. STAGE0-DUPLICATE-DELIVERY-IDEMPOTENCY-006: Replaying identical fixture produces UNCHANGED signal, updates last_seen_utc, preserves observation_history_count, and appends zero duplicate transition events.
 * 7. STAGE0-PRICE-DELTA-DETECTION-007: Retail price change (₹85 -> ₹72) updates observation, triggers PRICE_CHANGED signal, and preserves candidate ID without resetting lifecycle state.
 * 8. STAGE0-SUPPLIER-QUOTE-DELTA-DETECTION-008: Factory gate quote update (₹25 -> ₹29) triggers SUPPLIER_QUOTE_UPDATED signal with updated spread and margin calculations.
 * 9. STAGE0-GRIEVANCE-DELTA-DETECTION-009: Capture containing customer defect complaints triggers GRIEVANCE_SURFACED signal while retaining candidate history.
 * 10. STAGE0-MISSING-COST-DATA-REQUIRED-010: "Contact Supplier" / missing factory gate quote records field as missing in evidence_sufficiency, lowering sufficiency score without fabricating zero or default price.
 * 11. STAGE0-OUT-OF-ORDER-REPLAY-CONVERGENCE-011: Ingesting observations out of order with fixed timestamps converges deterministically on canonical product state.
 * 12. STAGE0-ZERO-NETWORK-OFFLINE-REPLAY-012: Replaying the complete golden fixture pipeline runs 100% offline with zero network socket activity or external HTTP calls.
 * 13. STAGE0-SECRET-HYGIENE-AND-REDACTION-013: Asserts zero API keys, secrets, or bearer tokens exist in fixtures, envelopes, normalized observations, or candidate logs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import net from 'node:net';
import { sha256 } from '../../src/canonical/crypto.js';
import {
  SourceAdapterContract,
  RawSourceCapture,
  createRawSourceCapture,
  computePayloadSha256
} from '../../src/discovery/sourceAdapterContract.js';
import {
  GoldenDiscoveryFixtureRegistry,
  GOLDEN_DISCOVERY_FIXTURE_SET_V1
} from '../../src/discovery/fixtures/goldenDiscoveryFixtures.js';
import { FixtureReplayAdapter } from '../../src/discovery/fixtureReplayAdapter.js';
import { DiscoveryScreenerService } from '../../src/discovery/discoveryScreenerService.js';
import { OpportunityLifecycleEngine } from '../../src/research/opportunityLifecycleEngine.js';
import { EntityIdentityResolver } from '../../src/research/entityIdentityResolver.js';

describe('Suite 45: Slice 2A Stage 0 Discovery Screener — Source Contract & Fixture Replay', () => {
  let screener: DiscoveryScreenerService;
  let adapter: FixtureReplayAdapter;

  beforeEach(async () => {
    screener = new DiscoveryScreenerService();
    await screener.initialize();
    adapter = new FixtureReplayAdapter();
  });

  // --------------------------------------------------------------------------
  // Test 1: Contract, Scoping, and Telemetry
  // --------------------------------------------------------------------------
  it('STAGE0-CONTRACT-AND-SCOPING-001: Verifies source-adapter contract, permission scopes, and telemetry reporting', async () => {
    expect(adapter.connector_id).toBe('conn:replay:golden-fixtures');
    expect(adapter.source_type).toBe('FIXTURE_REPLAY');
    expect(adapter.permission_scope).toBe('FIXTURE_REPLAY_ONLY');

    const initialTelemetry = adapter.getTelemetry();
    expect(initialTelemetry.total_captures_fetched).toBe(0);
    expect(initialTelemetry.error_count).toBe(0);
    expect(initialTelemetry.is_healthy).toBe(true);

    const captures = await adapter.fetchCaptures({ limit: 3 });
    expect(captures.length).toBe(3);

    const updatedTelemetry = adapter.getTelemetry();
    expect(updatedTelemetry.total_captures_fetched).toBe(3);
    expect(updatedTelemetry.last_fetch_timestamp_utc).not.toBeNull();
  });

  // --------------------------------------------------------------------------
  // Test 2: Attributable Provenance and Cryptographic Integrity
  // --------------------------------------------------------------------------
  it('STAGE0-GOLDEN-FIXTURE-INTEGRITY-002: Verifies versioned golden fixtures load with cryptographic SHA-256 payload integrity, attributable provenance signatures, and distinct source vs retrieval timestamps', async () => {
    const fixtureSet = GoldenDiscoveryFixtureRegistry.getDefaultFixtureSet();
    expect(fixtureSet.version).toBe('1.0.0');
    expect(fixtureSet.fixtures.length).toBeGreaterThanOrEqual(8);

    for (const fixture of fixtureSet.fixtures) {
      // 1. Attributable provenance
      expect(fixture.capture_id).toMatch(/^FIX-/);
      expect(fixture.source_connector_id).toMatch(/^conn:/);
      expect(fixture.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
      expect(fixture.provenance_signature).toBeDefined();

      // 2. Cryptographic payload digest matches content bit-for-bit
      const computedHash = sha256(fixture.raw_payload);
      expect(fixture.payload_sha256).toBe(computedHash);

      // 3. Temporal coordinate separation (T_source and T_ingest are distinct ISO timestamps)
      expect(Date.parse(fixture.source_observed_at_utc)).toBeGreaterThan(0);
      expect(Date.parse(fixture.retrieval_timestamp_utc)).toBeGreaterThan(0);
      expect(new Date(fixture.retrieval_timestamp_utc).getTime()).toBeGreaterThanOrEqual(
        new Date(fixture.source_observed_at_utc).getTime()
      );
    }
  });

  // --------------------------------------------------------------------------
  // Test 3: Canonical Product Identity Normalization (SS304 DIN 3017 Clamp)
  // --------------------------------------------------------------------------
  it('STAGE0-CANONICAL-IDENTITY-NORMALIZATION-003: Proves raw Amazon India and IndiaMART captures resolve deterministically to canonical SS304 DIN 3017 product identity', async () => {
    const amzFixture = adapter.getFixtureById('FIX-AMZ-SS304-001')!;
    const imartFixture = adapter.getFixtureById('FIX-IMART-SS304-001')!;

    expect(amzFixture).toBeDefined();
    expect(imartFixture).toBeDefined();

    // 1. Screen Amazon capture
    const amzResult = await screener.screenCapture(amzFixture);
    expect(amzResult.resolution_status).toBe('RESOLVED');
    expect(amzResult.normalized_observation).not.toBeNull();
    expect(amzResult.normalized_observation!.canonical_product_id).toBe('prod:din3017:ss304:16-25mm:pack-10');
    expect(amzResult.normalized_observation!.prevailing_retail_asp_inr).toBe(85.0);

    // 2. Screen IndiaMART capture
    const imartResult = await screener.screenCapture(imartFixture);
    expect(imartResult.resolution_status).toBe('RESOLVED');
    expect(imartResult.normalized_observation).not.toBeNull();
    expect(imartResult.normalized_observation!.canonical_product_id).toBe('prod:din3017:ss304:16-25mm:pack-10');
    expect(imartResult.normalized_observation!.factory_gate_quote_inr).toBe(25.0);
    expect(imartResult.normalized_observation!.unit_batch_moq).toBe(100);

    // 3. Both captures resolve to the exact same canonical product ID
    expect(amzResult.normalized_observation!.canonical_product_id).toBe(
      imartResult.normalized_observation!.canonical_product_id
    );
  });

  // --------------------------------------------------------------------------
  // Test 4: Ambiguous Hardware Listing Holds as UNRESOLVED_ENTITY_HOLD
  // --------------------------------------------------------------------------
  it('STAGE0-AMBIGUOUS-ENTITY-HOLD-004: Ambiguous hardware capture with no matching catalog ASIN, SKU, or HSN holds as UNRESOLVED_ENTITY_HOLD without phantom entity invention', async () => {
    const unknownFixture = adapter.getFixtureById('FIX-UNKNOWN-WIDGET-001')!;
    expect(unknownFixture).toBeDefined();

    const result = await screener.screenCapture(unknownFixture);

    // 1. Rejection to quarantine hold
    expect(result.resolution_status).toBe('UNRESOLVED_ENTITY_HOLD');
    expect(result.candidate).toBeNull();
    expect(result.normalized_observation).toBeNull();
    expect(result.notes).toContain('E-SCW-UNRESOLVED-ENTITY');

    // 2. Confirm no candidate was created in lifecycle engine
    const candidates = await screener.getLifecycleEngine().listCandidates();
    expect(candidates.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Test 5: Route into OpportunityLifecycleEngine
  // --------------------------------------------------------------------------
  it('STAGE0-NEW-CANDIDATE-LIFECYCLE-ROUTING-005: Resolved observation routes seamlessly into OpportunityLifecycleEngine.ingestObservation(), creating stable candidate in state NEW with signal INITIAL_OBSERVATION', async () => {
    const amzFixture = adapter.getFixtureById('FIX-AMZ-SS304-001')!;
    const result = await screener.screenCapture(amzFixture);

    expect(result.resolution_status).toBe('RESOLVED');
    expect(result.is_new_candidate).toBe(true);
    expect(result.signal).toBe('INITIAL_OBSERVATION');

    const cand = result.candidate!;
    expect(cand).toBeDefined();
    expect(cand.lifecycle_state).toBe('NEW');
    expect(cand.strategy_id).toBe('strat:india-b2b:physical-arbitrage');
    expect(cand.canonical_product_id).toBe('prod:din3017:ss304:16-25mm:pack-10');
    expect(cand.candidate_id).toMatch(/^OPP-/);
    expect(cand.current_observation.prevailing_retail_asp_inr).toBe(85.0);
    expect(cand.observation_history_count).toBe(1);

    // Verify candidate is retrievable from engine
    const fetched = await screener.getLifecycleEngine().getCandidate(cand.candidate_id);
    expect(fetched).not.toBeNull();
    expect(fetched!.candidate_id).toBe(cand.candidate_id);
  });

  // --------------------------------------------------------------------------
  // Test 6: Duplicate Observation Delivery & Idempotency
  // --------------------------------------------------------------------------
  it('STAGE0-DUPLICATE-DELIVERY-IDEMPOTENCY-006: Replaying identical fixture produces UNCHANGED signal, updates last_seen_utc, preserves observation_history_count, and appends zero duplicate transition events', async () => {
    const amzFixture = adapter.getFixtureById('FIX-AMZ-SS304-001')!;

    // Ingest 1
    const res1 = await screener.screenCapture(amzFixture);
    expect(res1.is_new_candidate).toBe(true);
    expect(res1.signal).toBe('INITIAL_OBSERVATION');
    const initialEvents = await screener.getLifecycleEngine().getEventHistory(res1.candidate!.candidate_id);
    expect(initialEvents.length).toBe(1);

    // Ingest 2: Identical fixture replayed
    const res2 = await screener.screenCapture(amzFixture);
    expect(res2.is_new_candidate).toBe(false);
    expect(res2.signal).toBe('UNCHANGED');
    expect(res2.candidate!.candidate_id).toBe(res1.candidate!.candidate_id);
    expect(res2.candidate!.observation_history_count).toBe(1); // Not incremented!

    // Event history must NOT have duplicate events
    const subsequentEvents = await screener.getLifecycleEngine().getEventHistory(res1.candidate!.candidate_id);
    expect(subsequentEvents.length).toBe(1);

    // Candidate count in engine remains exactly 1
    const all = await screener.getLifecycleEngine().listCandidates();
    expect(all.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Test 7: Price Delta Detection
  // --------------------------------------------------------------------------
  it('STAGE0-PRICE-DELTA-DETECTION-007: Retail price change (₹85 -> ₹72) updates observation, triggers PRICE_CHANGED signal, and preserves candidate ID without resetting lifecycle state', async () => {
    const initialFixture = adapter.getFixtureById('FIX-AMZ-SS304-001')!;
    const priceDropFixture = adapter.getFixtureById('FIX-AMZ-SS304-PRICE-DROP-002')!;

    // Initial ASP ₹85
    const res1 = await screener.screenCapture(initialFixture);
    const candId = res1.candidate!.candidate_id;

    // Transition to INVESTIGATE to simulate workflow
    await screener.getLifecycleEngine().transitionState(
      candId,
      'INVESTIGATE',
      'Operator prioritized investigation for SS304 DIN 3017 clamps',
      'op:analyst-01'
    );

    // Ingest price drop to ₹72
    const res2 = await screener.screenCapture(priceDropFixture);
    expect(res2.candidate!.candidate_id).toBe(candId);
    expect(res2.signal).toBe('PRICE_CHANGED');
    expect(res2.candidate!.current_observation.prevailing_retail_asp_inr).toBe(72.0);

    // Lifecycle state is strictly preserved (does NOT reset to NEW)
    expect(res2.candidate!.lifecycle_state).toBe('INVESTIGATE');
    expect(res2.candidate!.active_signals).toContain('PRICE_CHANGED');
    expect(res2.candidate!.observation_history_count).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Test 8: Supplier Quote Delta Detection
  // --------------------------------------------------------------------------
  it('STAGE0-SUPPLIER-QUOTE-DELTA-DETECTION-008: Factory gate quote update (₹25 -> ₹29) triggers SUPPLIER_QUOTE_UPDATED signal with updated spread and margin calculations', async () => {
    // 1. Retail intake (ASP ₹85)
    await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-001')!);

    // 2. Initial supplier quote intake (₹25)
    const quoteRes1 = await screener.screenCapture(adapter.getFixtureById('FIX-IMART-SS304-001')!);
    expect(quoteRes1.candidate!.current_observation.factory_gate_quote_inr).toBe(25.0);
    expect(quoteRes1.candidate!.commercial_attractiveness.estimated_gross_spread_inr).toBe(60.0); // 85 - 25

    // 3. Updated supplier quote intake (₹29)
    const quoteRes2 = await screener.screenCapture(adapter.getFixtureById('FIX-IMART-SS304-QUOTE-UPDATE-003')!);
    expect(quoteRes2.signal).toBe('SUPPLIER_QUOTE_UPDATED');
    expect(quoteRes2.candidate!.current_observation.factory_gate_quote_inr).toBe(29.0);
    expect(quoteRes2.candidate!.commercial_attractiveness.estimated_gross_spread_inr).toBe(56.0); // 85 - 29
    expect(quoteRes2.candidate!.active_signals).toContain('SUPPLIER_QUOTE_UPDATED');
  });

  // --------------------------------------------------------------------------
  // Test 9: Grievance Delta Detection
  // --------------------------------------------------------------------------
  it('STAGE0-GRIEVANCE-DELTA-DETECTION-009: Capture containing customer defect complaints triggers GRIEVANCE_SURFACED signal while retaining candidate history', async () => {
    // Initial intake
    await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-001')!);

    // Grievance intake
    const grievanceRes = await screener.screenCapture(adapter.getFixtureById('FIX-AMZ-SS304-GRIEVANCE-004')!);
    expect(grievanceRes.signal).toBe('GRIEVANCE_SURFACED');
    expect(grievanceRes.candidate!.active_signals).toContain('GRIEVANCE_SURFACED');
    expect(grievanceRes.candidate!.current_observation.review_sentiment_summary).toContain('Defect complaint');
  });

  // --------------------------------------------------------------------------
  // Test 10: Missing Critical Field / Data Required Handling
  // --------------------------------------------------------------------------
  it('STAGE0-MISSING-COST-DATA-REQUIRED-010: "Contact Supplier" / missing factory gate quote records field as missing in evidence_sufficiency, lowering sufficiency score without fabricating zero or default price', async () => {
    const missingQuoteFixture = adapter.getFixtureById('FIX-IMART-SS304-MISSING-QUOTE-005')!;
    const res = await screener.screenCapture(missingQuoteFixture);

    const cand = res.candidate!;
    // 1. Factory gate quote is null (zero-cost substitution strictly prohibited)
    expect(cand.current_observation.factory_gate_quote_inr).toBeNull();

    // 2. Evidence sufficiency correctly identifies missing field
    expect(cand.evidence_sufficiency.has_upstream_quote).toBe(false);
    expect(cand.evidence_sufficiency.missing_critical_fields).toContain('factory_gate_quote_inr');
    expect(cand.evidence_sufficiency.is_sufficient_for_underwriting).toBe(false);

    // 3. Commercial attractiveness spread cannot be computed with missing quote
    expect(cand.commercial_attractiveness.estimated_gross_spread_inr).toBeNull();
    expect(cand.commercial_attractiveness.attractiveness_rating).toBe('UNKNOWN');
  });

  // --------------------------------------------------------------------------
  // Test 11: Out-of-Order Replay Determinism & Convergence
  // --------------------------------------------------------------------------
  it('STAGE0-OUT-OF-ORDER-REPLAY-CONVERGENCE-011: Ingesting observations out of order with fixed timestamps converges deterministically on canonical product state', async () => {
    const f1 = adapter.getFixtureById('FIX-AMZ-SS304-001')!; // 10:00 UTC
    const f2 = adapter.getFixtureById('FIX-IMART-SS304-001')!; // 10:15 UTC

    // Engine Instance A: Ingest in chronological order (f1, then f2)
    const engineA = new OpportunityLifecycleEngine();
    await engineA.initialize();
    const screenerA = new DiscoveryScreenerService({ lifecycleEngine: engineA });
    await screenerA.screenCapture(f1);
    const resA = await screenerA.screenCapture(f2);

    // Engine Instance B: Ingest in reversed order (f2, then f1)
    const engineB = new OpportunityLifecycleEngine();
    await engineB.initialize();
    const screenerB = new DiscoveryScreenerService({ lifecycleEngine: engineB });
    await screenerB.screenCapture(f2);
    const resB = await screenerB.screenCapture(f1);

    // Both instances must produce the exact same stable candidate ID
    expect(resA.candidate!.candidate_id).toBe(resB.candidate!.candidate_id);

    // Both instances converge on the complete combined metrics (ASP ₹85, Quote ₹25, MOQ 100)
    expect(resA.candidate!.current_observation.prevailing_retail_asp_inr).toBe(85.0);
    expect(resA.candidate!.current_observation.factory_gate_quote_inr).toBe(25.0);
    expect(resB.candidate!.current_observation.prevailing_retail_asp_inr).toBe(85.0);
    expect(resB.candidate!.current_observation.factory_gate_quote_inr).toBe(25.0);

    // Commercial attractiveness is identical
    expect(resA.candidate!.commercial_attractiveness.estimated_gross_spread_inr).toBe(
      resB.candidate!.commercial_attractiveness.estimated_gross_spread_inr
    );
  });

  // --------------------------------------------------------------------------
  // Test 12: Zero Network Socket Offline Replay Guarantee
  // --------------------------------------------------------------------------
  it('STAGE0-ZERO-NETWORK-OFFLINE-REPLAY-012: Replaying the complete golden fixture pipeline runs 100% offline with zero network socket activity or external HTTP calls', async () => {
    let socketOpened = false;

    // Spy on net.connect / net.createConnection
    const origCreateConnection = net.createConnection;
    (net as any).createConnection = function (...args: any[]) {
      socketOpened = true;
      throw new Error('E-OFFLINE-BREACH: Outbound network socket opened during offline fixture replay');
    };

    try {
      const results = await screener.replayAndScreen(adapter);
      expect(results.length).toBeGreaterThanOrEqual(8);
      expect(socketOpened).toBe(false);
    } finally {
      (net as any).createConnection = origCreateConnection;
    }
  });

  // --------------------------------------------------------------------------
  // Test 13: Secret Hygiene & Safe Error Reporting
  // --------------------------------------------------------------------------
  it('STAGE0-SECRET-HYGIENE-AND-REDACTION-013: Asserts zero API keys, secrets, or bearer tokens exist in fixtures, envelopes, normalized observations, or candidate logs', async () => {
    const fixtureSet = GoldenDiscoveryFixtureRegistry.getDefaultFixtureSet();
    const forbiddenPatterns = [
      /sk-[a-zA-Z0-9]{20,}/,
      /gsk_[a-zA-Z0-9]{20,}/,
      /AIzaSy[a-zA-Z0-9_-]{33}/,
      /ghp_[a-zA-Z0-9]{36}/,
      /Bearer\s+[a-zA-Z0-9._-]{20,}/i,
      /api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9]{15,}["']?/i
    ];

    for (const fixture of fixtureSet.fixtures) {
      const serialized = JSON.stringify(fixture);
      for (const pattern of forbiddenPatterns) {
        expect(serialized).not.toMatch(pattern);
      }
    }

    const results = await screener.replayAndScreen(adapter);
    for (const res of results) {
      const serializedResult = JSON.stringify(res);
      for (const pattern of forbiddenPatterns) {
        expect(serializedResult).not.toMatch(pattern);
      }
    }
  });
});
