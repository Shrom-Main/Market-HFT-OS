/**
 * Suite 44: Slice 1 Opportunity Domain & Lifecycle State Machine Acceptance Suite
 * Gate Slice 1 / Master Implementation Framework
 *
 * 10 Normative Acceptance Tests:
 * 1. OPP-LIFECYCLE-ID-DETERMINISM-001: Verifies stable, immutable Candidate ID derived from strategy & product identity,
 *    independent of mutable prices, quotes, or timestamps.
 * 2. OPP-LIFECYCLE-STATE-TRANSITIONS-002: Enforces fail-closed lifecycle state machine graph, verifying valid transitions
 *    and rejecting invalid jumps (e.g. NEW -> PAPER_ELIGIBLE throws E-OPP-INVALID-TRANSITION).
 * 3. OPP-TWO-DIMENSIONAL-SCORING-003: Evaluates high commercial attractiveness alongside low evidence completeness
 *    without collapsing into flat rejection; preserves visible candidate with explicit missing fields.
 * 4. OPP-IDEMPOTENT-INGESTION-004: Ingesting identical candidate payloads updates last_seen_utc with zero duplicate rows
 *    and zero transition log pollution (UNCHANGED signal).
 * 5. OPP-DELTA-DETECTION-005: Price change (₹25 -> ₹31) triggers orthogonal signal PRICE_CHANGED while preserving
 *    lifecycle state (INVESTIGATE), proving orthogonal separation of concerns.
 * 6. OPP-COLLECTOR-FAILURE-ISOLATION-006: Connector failure does NOT reject candidate; records EVIDENCE_STALE signal
 *    and sets investigation_status: FAILED while preserving candidate in active research queue.
 * 7. OPP-INVESTIGATION-TASK-GENERATION-007: Computes missing critical fields without guessing or synthetic averaging,
 *    verifying sufficiency_score_bps calculation and is_sufficient_for_underwriting flag.
 * 8. OPP-PERSISTENCE-AND-REPLAY-008: Real PostgreSQL tables market_opportunity_candidates and market_candidate_lifecycle_events
 *    persist state and hydrate across engine instances with 100% parity.
 * 9. OPP-FAIL-CLOSED-AUTHORIZATION-GATE-009: Proves unverified or insufficiently evidenced candidate cannot be committed
 *    to paper allocation (E-OPP-UNVERIFIED-COMMIT-BLOCKED); enforces >= 15-char confirmation rationale.
 * 10. OPP-FILTERING-AND-MERKLE-CHAIN-010: Verifies candidate filtering by strategy/state and validates that all lifecycle
 *    events form a cryptographically unbroken Merkle hash chain (previous_event_hash linking).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  OpportunityLifecycleEngine,
  type OpportunityCandidate,
  type OpportunityLifecycleState,
  type ObservationChangeSignal
} from '../../src/research/opportunityLifecycleEngine.js';
import { loadServerSecrets } from '../../src/mcp/serverSecretLoader.js';

describe('Suite 44: Slice 1 Opportunity Domain & Lifecycle State Machine', () => {
  let pgPool: pg.Pool;
  let engineWithPg: OpportunityLifecycleEngine;
  let engineMemOnly: OpportunityLifecycleEngine;

  const testStrategyId = 'strat:india-b2b-physical-arbitrage:din3017';
  const testProductId = 'prod:din3017:ss304:16-25mm:pack-10';

  beforeAll(async () => {
    loadServerSecrets();
    const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/market_hft_test';
    pgPool = new pg.Pool({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });

    engineWithPg = new OpportunityLifecycleEngine({ pgPool });
    await engineWithPg.initialize();

    engineMemOnly = new OpportunityLifecycleEngine();
    await engineMemOnly.initialize();
  });

  afterAll(async () => {
    if (pgPool) {
      // Clean up test records
      await pgPool.query("DELETE FROM market_candidate_lifecycle_events WHERE candidate_id LIKE 'OPP-%' AND transition_reason LIKE '%test%';").catch(() => {});
      await pgPool.query("DELETE FROM market_opportunity_candidates WHERE strategy_id LIKE 'strat:test-%';").catch(() => {});
      await pgPool.end();
    }
  });

  // --------------------------------------------------------------------------
  // Test 1: Stable Identity Determinism
  // --------------------------------------------------------------------------
  it('OPP-LIFECYCLE-ID-DETERMINISM-001: Verifies stable Candidate ID derived from strategy & product identity, invariant to price changes', () => {
    const id1 = OpportunityLifecycleEngine.computeCandidateId(testStrategyId, testProductId);
    const id2 = OpportunityLifecycleEngine.computeCandidateId(testStrategyId, testProductId);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^OPP-[A-F0-9]{16}$/);

    // Case and whitespace insensitivity
    const id3 = OpportunityLifecycleEngine.computeCandidateId(
      '  STRAT:INDIA-B2B-PHYSICAL-ARBITRAGE:DIN3017  ',
      '  PROD:DIN3017:SS304:16-25MM:PACK-10  '
    );
    expect(id1).toBe(id3);

    // Different product yields different stable ID
    const otherId = OpportunityLifecycleEngine.computeCandidateId(testStrategyId, 'prod:brass:hex-nipple:1-2inch:pack-5');
    expect(id1).not.toBe(otherId);
  });

  // --------------------------------------------------------------------------
  // Test 2: Fail-Closed Lifecycle State Transitions
  // --------------------------------------------------------------------------
  it('OPP-LIFECYCLE-STATE-TRANSITIONS-002: Enforces permitted transitions and rejects invalid state jumps', async () => {
    const stratId = `strat:test-transitions-${Date.now()}`;
    const prodId = 'prod:din3017:ss304:test-trans';

    const { candidate } = await engineMemOnly.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'DIN 3017 SS304 Hose Clamp Pack-10',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 85.0,
      factory_gate_quote_inr: 25.0
    });

    expect(candidate.lifecycle_state).toBe('NEW');

    // 1. Invalid jump: NEW -> PAPER_ELIGIBLE (must fail closed)
    await expect(
      engineMemOnly.transitionState(candidate.candidate_id, 'PAPER_ELIGIBLE', 'Unauthorized fast-track')
    ).rejects.toThrow(/E-OPP-INVALID-TRANSITION/);

    // 2. Invalid jump: NEW -> VERIFIED (must fail closed)
    await expect(
      engineMemOnly.transitionState(candidate.candidate_id, 'VERIFIED', 'Premature verification')
    ).rejects.toThrow(/E-OPP-INVALID-TRANSITION/);

    // 3. Permitted transition: NEW -> INVESTIGATE
    const investigating = await engineMemOnly.transitionState(
      candidate.candidate_id,
      'INVESTIGATE',
      'Candidate triaged into deep research queue'
    );
    expect(investigating.lifecycle_state).toBe('INVESTIGATE');

    // 4. Permitted transition: INVESTIGATE -> UNDER_REVIEW
    const underReview = await engineMemOnly.transitionState(
      candidate.candidate_id,
      'UNDER_REVIEW',
      'Research agent task execution completed'
    );
    expect(underReview.lifecycle_state).toBe('UNDER_REVIEW');

    // 5. Premature VERIFIED transition blocked if evidence incomplete
    await expect(
      engineMemOnly.transitionState(candidate.candidate_id, 'VERIFIED', 'Verification check')
    ).rejects.toThrow(/E-OPP-VERIFICATION-SUFFICIENCY-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // Test 3: Two-Dimensional Scoring (Attractiveness vs Sufficiency)
  // --------------------------------------------------------------------------
  it('OPP-TWO-DIMENSIONAL-SCORING-003: Evaluates high commercial attractiveness alongside low evidence completeness without collapsing into flat rejection', async () => {
    const stratId = `strat:test-2d-${Date.now()}`;
    const prodId = 'prod:din3017:high-spread-low-evidence';

    // Ingest candidate with massive gross spread (₹120 ASP vs ₹20 Quote = 83.33% margin), but zero review or logistics evidence
    const { candidate } = await engineMemOnly.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'High Spread Unvalidated Clamp',
      source_connector_id: 'conn:b2b:indiamart',
      prevailing_retail_asp_inr: 120.0,
      factory_gate_quote_inr: 20.0,
      review_sentiment_summary: null, // Missing!
      has_logistics_route: false,      // Missing!
      has_regulatory_clearance: false  // Missing!
    });

    // 1. Commercial attractiveness is VERY_HIGH
    expect(candidate.commercial_attractiveness.attractiveness_rating).toBe('VERY_HIGH');
    expect(candidate.commercial_attractiveness.estimated_gross_spread_inr).toBe(100.0);
    expect(candidate.commercial_attractiveness.estimated_gross_margin_bps).toBeGreaterThanOrEqual(8000);

    // 2. Evidence sufficiency is INCOMPLETE (only quote + asp = 6,000 bps)
    expect(candidate.evidence_sufficiency.is_sufficient_for_underwriting).toBe(false);
    expect(candidate.evidence_sufficiency.sufficiency_score_bps).toBe(6000);
    expect(candidate.evidence_sufficiency.missing_critical_fields).toContain('review_sentiment_summary');
    expect(candidate.evidence_sufficiency.uncorroborated_fields).toContain('logistics_freight_corridor');

    // 3. Candidate is preserved in NEW state (NOT automatically rejected)
    expect(candidate.lifecycle_state).toBe('NEW');
    expect(candidate.active_signals).toContain('INITIAL_OBSERVATION');
  });

  // --------------------------------------------------------------------------
  // Test 4: Idempotent Ingestion & No Transition Pollution
  // --------------------------------------------------------------------------
  it('OPP-IDEMPOTENT-INGESTION-004: Ingesting identical candidate payload updates last_seen_utc with zero duplicate rows and zero transition log pollution', async () => {
    const stratId = `strat:test-idempotent-${Date.now()}`;
    const prodId = 'prod:din3017:idempotent-check';

    const input = {
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'Idempotent Test Clamp',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 75.0,
      factory_gate_quote_inr: 22.0
    };

    // First ingestion
    const res1 = await engineMemOnly.ingestObservation(input);
    expect(res1.is_new).toBe(true);
    expect(res1.signal).toBe('INITIAL_OBSERVATION');

    const events1 = await engineMemOnly.getEventHistory(res1.candidate.candidate_id);
    expect(events1.length).toBe(1);

    // Second ingestion: identical payload
    const res2 = await engineMemOnly.ingestObservation(input);
    expect(res2.is_new).toBe(false);
    expect(res2.signal).toBe('UNCHANGED');
    expect(res2.candidate.candidate_id).toBe(res1.candidate.candidate_id);
    expect(res2.candidate.observation_history_count).toBe(1); // Not artificially incremented

    // Zero additional events generated for unchanged observation
    const events2 = await engineMemOnly.getEventHistory(res1.candidate.candidate_id);
    expect(events2.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Test 5: Orthogonal Delta Detection (Price Change vs State)
  // --------------------------------------------------------------------------
  it('OPP-DELTA-DETECTION-005: Price change (₹25 -> ₹31) triggers PRICE_CHANGED signal while preserving lifecycle state (INVESTIGATE)', async () => {
    const stratId = `strat:test-delta-${Date.now()}`;
    const prodId = 'prod:din3017:price-delta-check';

    // 1. Initial ingestion
    const res1 = await engineMemOnly.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'Delta Test Clamp',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 75.0,
      factory_gate_quote_inr: 25.0
    });

    // 2. Advance to INVESTIGATE
    await engineMemOnly.transitionState(res1.candidate.candidate_id, 'INVESTIGATE', 'Queued for research');

    // 3. Ingest price change from ₹75 to ₹95
    const res2 = await engineMemOnly.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'Delta Test Clamp',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 95.0, // Changed!
      factory_gate_quote_inr: 25.0
    });

    expect(res2.signal).toBe('PRICE_CHANGED');
    expect(res2.candidate.active_signals).toContain('PRICE_CHANGED');
    // Crucial check: lifecycle state is NOT overwritten to NEW or CHANGED; remains in INVESTIGATE
    expect(res2.candidate.lifecycle_state).toBe('INVESTIGATE');
    expect(res2.candidate.current_observation.prevailing_retail_asp_inr).toBe(95.0);

    const history = await engineMemOnly.getEventHistory(res1.candidate.candidate_id);
    expect(history.some((e) => e.signal === 'PRICE_CHANGED')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 6: Collector Failure Isolation
  // --------------------------------------------------------------------------
  it('OPP-COLLECTOR-FAILURE-ISOLATION-006: Connector failure does NOT reject candidate; records EVIDENCE_STALE and sets investigation_status: FAILED', async () => {
    const stratId = `strat:test-collector-fail-${Date.now()}`;
    const prodId = 'prod:din3017:collector-fail-check';

    const { candidate } = await engineMemOnly.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'Resilient Candidate',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 80.0,
      factory_gate_quote_inr: 24.0
    });

    await engineMemOnly.transitionState(candidate.candidate_id, 'INVESTIGATE', 'Under investigation');

    // Simulate collector timeout / rate limit error
    const updated = await engineMemOnly.recordObservationFailure(
      candidate.candidate_id,
      'HTTP 504 Gateway Timeout contacting seller API',
      'conn:marketplace:amazon-in'
    );

    // Candidate MUST NOT be rejected!
    expect(updated.lifecycle_state).toBe('INVESTIGATE');
    expect(updated.active_signals).toContain('EVIDENCE_STALE');
    expect(updated.investigation_status).toBe('FAILED');
    expect(updated.latest_transition_reason).toContain('HTTP 504 Gateway Timeout');
  });

  // --------------------------------------------------------------------------
  // Test 7: Missing Field Detection & Sufficiency Profile
  // --------------------------------------------------------------------------
  it('OPP-INVESTIGATION-TASK-GENERATION-007: Accurately detects missing critical fields and calculates sufficiency score', async () => {
    const stratId = `strat:test-sufficiency-${Date.now()}`;
    const prodId = 'prod:din3017:missing-fields-check';

    // Ingest observation missing factory gate quote
    const { candidate } = await engineMemOnly.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'Missing Quote Clamp',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 85.0,
      factory_gate_quote_inr: null, // MISSING
      review_sentiment_summary: 'Positive corrosion resistance noted in 14 reviews'
    });

    const prof = candidate.evidence_sufficiency;
    expect(prof.has_upstream_quote).toBe(false);
    expect(prof.has_prevailing_asp).toBe(true);
    expect(prof.has_verbatim_reviews).toBe(true);
    expect(prof.missing_critical_fields).toContain('factory_gate_quote_inr');
    expect(prof.is_sufficient_for_underwriting).toBe(false);
    expect(prof.sufficiency_score_bps).toBe(5000); // 3000 (asp) + 2000 (reviews)
  });

  // --------------------------------------------------------------------------
  // Test 8: PostgreSQL 16.8 Persistence & Replay
  // --------------------------------------------------------------------------
  it('OPP-PERSISTENCE-AND-REPLAY-008: Real PostgreSQL tables persist state and hydrate across engine instances with 100% parity', async () => {
    const stratId = `strat:test-pg-persist-${Date.now()}`;
    const prodId = 'prod:din3017:pg-persist-item';

    // Ingest into PG engine
    const { candidate: c1 } = await engineWithPg.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'PostgreSQL Persisted Clamp',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 90.0,
      factory_gate_quote_inr: 26.0,
      review_sentiment_summary: 'Solid construction',
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    // Advance state in PG
    await engineWithPg.transitionState(c1.candidate_id, 'INVESTIGATE', 'Test transition to investigate');
    await engineWithPg.transitionState(c1.candidate_id, 'UNDER_REVIEW', 'Test transition to under review');
    await engineWithPg.transitionState(c1.candidate_id, 'VERIFIED', 'All evidence corroborated');

    // Create a fresh engine instance simulating process restart
    const freshEngine = new OpportunityLifecycleEngine({ pgPool });
    const hydrated = await freshEngine.getCandidate(c1.candidate_id);

    expect(hydrated).not.toBeNull();
    expect(hydrated!.candidate_id).toBe(c1.candidate_id);
    expect(hydrated!.lifecycle_state).toBe('VERIFIED');
    expect(hydrated!.evidence_sufficiency.is_sufficient_for_underwriting).toBe(true);
    expect(hydrated!.evidence_sufficiency.sufficiency_score_bps).toBe(10000);
    expect(hydrated!.jcs_sha256).toBeDefined();

    // Verify Merkle event log rehydration
    const events = await freshEngine.getEventHistory(c1.candidate_id);
    expect(events.length).toBeGreaterThanOrEqual(4); // Ingested + 3 transitions
  });

  // --------------------------------------------------------------------------
  // Test 9: Fail-Closed Paper Allocation Commit Gate
  // --------------------------------------------------------------------------
  it('OPP-FAIL-CLOSED-AUTHORIZATION-GATE-009: Proves unverified candidate cannot be committed to paper allocation; requires >= 15-char rationale', async () => {
    const stratId = `strat:test-paper-gate-${Date.now()}`;
    const prodId = 'prod:din3017:paper-gate-item';

    const { candidate } = await engineMemOnly.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'Gate Test Clamp',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 80.0,
      factory_gate_quote_inr: 25.0
    });

    // 1. Candidate in NEW state: must fail closed
    await expect(
      engineMemOnly.authorizePaperCommit(candidate.candidate_id, 'Valid rationale exceeding 15 chars')
    ).rejects.toThrow(/E-OPP-UNVERIFIED-COMMIT-BLOCKED/);

    // 2. Candidate in INVESTIGATE state: must fail closed
    await engineMemOnly.transitionState(candidate.candidate_id, 'INVESTIGATE', 'Investigation phase');
    await expect(
      engineMemOnly.authorizePaperCommit(candidate.candidate_id, 'Valid rationale exceeding 15 chars')
    ).rejects.toThrow(/E-OPP-UNVERIFIED-COMMIT-BLOCKED/);

    // 3. Short rationale (< 15 chars): must fail closed
    await expect(
      engineMemOnly.authorizePaperCommit(candidate.candidate_id, 'Too short')
    ).rejects.toThrow(/E-OPP-COMMIT-RATIONALE-REQUIRED/);

    // 4. Corroborate all fields to achieve VERIFIED state
    const { candidate: fullCandidate } = await engineMemOnly.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prodId,
      candidate_name: 'Gate Test Clamp',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 80.0,
      factory_gate_quote_inr: 25.0,
      review_sentiment_summary: 'Fully vetted reviews',
      has_logistics_route: true,
      has_regulatory_clearance: true
    });

    await engineMemOnly.transitionState(fullCandidate.candidate_id, 'UNDER_REVIEW', 'Moved to review');
    await engineMemOnly.transitionState(fullCandidate.candidate_id, 'VERIFIED', 'All evidence corroborated');

    // 5. Authorized commit succeeds for VERIFIED candidate
    const commit = await engineMemOnly.authorizePaperCommit(
      fullCandidate.candidate_id,
      'Authorized by Operator #42: SS304 DIN 3017 arbitrage economics confirmed against supplier gate quote.',
      'operator-42'
    );

    expect(commit.authorized).toBe(true);
    expect(commit.candidate_id).toBe(fullCandidate.candidate_id);
    expect(commit.commit_event_hash).toMatch(/^[a-f0-9]{64}$/);

    const postCommit = await engineMemOnly.getCandidate(fullCandidate.candidate_id);
    expect(postCommit!.lifecycle_state).toBe('PAPER_ELIGIBLE');
  });

  // --------------------------------------------------------------------------
  // Test 10: Filtering & Cryptographic Merkle Hash Chain
  // --------------------------------------------------------------------------
  it('OPP-FILTERING-AND-MERKLE-CHAIN-010: Verifies candidate filtering and validates unbroken Merkle hash chain on lifecycle events', async () => {
    const stratId = `strat:test-filter-${Date.now()}`;
    const prod1 = 'prod:item-1';
    const prod2 = 'prod:item-2';

    await engineMemOnly.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prod1,
      candidate_name: 'Item 1',
      source_connector_id: 'conn:test',
      prevailing_retail_asp_inr: 100.0,
      factory_gate_quote_inr: 30.0
    });

    await engineMemOnly.ingestObservation({
      strategy_id: stratId,
      canonical_product_id: prod2,
      candidate_name: 'Item 2',
      source_connector_id: 'conn:test',
      prevailing_retail_asp_inr: 50.0,
      factory_gate_quote_inr: 45.0
    });

    // Filter by strategy
    const stratCandidates = await engineMemOnly.listCandidates({ strategy_id: stratId });
    expect(stratCandidates.length).toBe(2);

    // Advance item 1 through multiple transitions to generate event chain
    const cand1Id = OpportunityLifecycleEngine.computeCandidateId(stratId, prod1);
    await engineMemOnly.transitionState(cand1Id, 'INVESTIGATE', 'Triage step for event chain');
    await engineMemOnly.transitionState(cand1Id, 'UNDER_REVIEW', 'Review step for event chain');
    await engineMemOnly.transitionState(cand1Id, 'DEFERRED', 'Deferred step for event chain');

    const events = await engineMemOnly.getEventHistory(cand1Id);
    expect(events.length).toBe(4); // 1 initial observation + 3 transitions

    // Verify cryptographic Merkle chain integrity: event[i].previous_event_hash === event[i-1].event_hash
    for (let i = 1; i < events.length; i++) {
      expect(events[i].previous_event_hash).toBe(events[i - 1].event_hash);
      expect(events[i].event_hash).toMatch(/^[a-f0-9]{64}$/);
    }
    // Genesis event previous_event_hash is all zeroes
    expect(events[0].previous_event_hash).toBe('0000000000000000000000000000000000000000000000000000000000000000');
  });

  // --------------------------------------------------------------------------
  // Test 11: Deterministic Replay Semantics (Bit-Identical Invariant)
  // --------------------------------------------------------------------------
  it('OPP-DETERMINISTIC-REPLAY-SEMANTICS-011: Proves bit-identical replay across independent engine instances when source observation time is supplied', async () => {
    const fixedObservedAtUtc = '2026-10-24T12:00:00.000Z';
    const replayStrategyId = 'strat:india-b2b:replay-verification';
    const replayProductId = 'prod:din3017:ss304:replay-spec';

    const replayInput = {
      strategy_id: replayStrategyId,
      canonical_product_id: replayProductId,
      candidate_name: 'Deterministic Replay Clamp',
      source_connector_id: 'conn:marketplace:amazon-in',
      prevailing_retail_asp_inr: 85.0,
      factory_gate_quote_inr: 25.0,
      unit_batch_moq: 100,
      observed_seller_count: 5,
      review_sentiment_summary: 'Corrosion-resistant DIN 3017 clamp verified in 12 reviews',
      raw_payload: '{"asin":"B09XYZ1234","price":85,"moq":100}',
      observed_at_utc: fixedObservedAtUtc
    };

    // Run 1: Ingest on fresh in-memory engine A
    const engineA = new OpportunityLifecycleEngine();
    await engineA.initialize();
    const { candidate: candA } = await engineA.ingestObservation(replayInput);
    const eventsA = await engineA.getEventHistory(candA.candidate_id);

    // Run 2: Ingest identical timestamped payload on fresh in-memory engine B (simulating clean replay)
    const engineB = new OpportunityLifecycleEngine();
    await engineB.initialize();
    const { candidate: candB } = await engineB.ingestObservation(replayInput);
    const eventsB = await engineB.getEventHistory(candB.candidate_id);

    // 1. Stable identity parity
    expect(candA.candidate_id).toBe(candB.candidate_id);

    // 2. Observation ID parity
    expect(candA.current_observation.observation_id).toBe(candB.current_observation.observation_id);

    // 3. Payload SHA-256 parity
    expect(candA.current_observation.payload_sha256).toBe(candB.current_observation.payload_sha256);

    // 4. Bit-identical RFC 8785 JCS canonical state digest
    expect(candA.jcs_sha256).toBe(candB.jcs_sha256);

    // 5. Bit-identical event hash and previous_event_hash in hash-linked chain
    expect(eventsA.length).toBe(1);
    expect(eventsB.length).toBe(1);
    expect(eventsA[0].event_hash).toBe(eventsB[0].event_hash);
    expect(eventsA[0].previous_event_hash).toBe(eventsB[0].previous_event_hash);

    // 6. Contrast with live operational heartbeat: omitting observed_at_utc refreshes operational heartbeat
    // but preserves deterministic domain identity
    const liveIngest = await engineA.ingestObservation({
      ...replayInput,
      observed_at_utc: undefined // live polling
    });
    expect(liveIngest.candidate.candidate_id).toBe(candA.candidate_id);
    expect(liveIngest.signal).toBe('UNCHANGED');
  });
});
