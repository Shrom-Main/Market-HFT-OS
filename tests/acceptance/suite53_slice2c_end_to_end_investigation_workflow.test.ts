/**
 * POC-001: Acceptance Suite 53 — Slice 2C End-to-End Investigation Workflow Integration
 *
 * Verifies the production integration bridge connecting Discovery Screener,
 * Investigation Planner, Fenced Task Queue, and Opportunity Lifecycle Engine.
 *
 * Requirements Tested:
 * 1. E2E-INV-001 (Happy Path): Discovery produces tasks, execution records valid evidence,
 *    underwriting reevaluates candidate, and candidate legitimately achieves PAPER_ELIGIBLE.
 * 2. E2E-INV-002 (Missing Evidence): Incomplete candidate remains strictly ineligible.
 * 3. E2E-INV-003 (Unverified Result): Task success does not promote unverified/synthetic data to verified status.
 * 4. E2E-INV-004 (Stale/Expired Lease): Stale fencing token is rejected without corrupting candidate state.
 * 5. E2E-INV-005 (Idempotency): Replay does not duplicate evidence or corrupt state.
 * 6. E2E-INV-006 (Failure Handling): Terminal 3-attempt failure leaves task in DEAD_LETTER_QUARANTINE.
 * 7. E2E-INV-007 (Capital Safety): No investigation path bypasses paper commitment rationale or accesses real capital.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DiscoveryScreenerService } from '../../src/discovery/discoveryScreenerService.js';
import { OpportunityLifecycleEngine } from '../../src/research/opportunityLifecycleEngine.js';
import { EntityIdentityResolver } from '../../src/research/entityIdentityResolver.js';
import { ScreeningPolicyEngine } from '../../src/discovery/screeningPolicy.js';
import { InvestigationTaskQueue } from '../../src/discovery/investigationTaskQueue.js';
import { RawSourceCapture } from '../../src/discovery/sourceAdapterContract.js';

describe('Suite 53: Slice 2C End-to-End Investigation Workflow Integration', () => {
  let screener: DiscoveryScreenerService;
  let lifecycleEngine: OpportunityLifecycleEngine;
  let taskQueue: InvestigationTaskQueue;

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
  });

  // Synthetic Category-Neutral Raw Capture: Industrial RS485 Modbus Sensor
  // Explicitly missing: factory_gate_quote_inr, has_logistics_route, has_regulatory_clearance
  const syntheticElectronicsCapture: RawSourceCapture = {
    capture_id: 'CAP-SYNTH-ELEC-001',
    source_connector_id: 'conn:marketplace:b2b-electronics',
    source_type: 'MARKETPLACE_RETAIL',
    origin_class: 'RECORDED_GOLDEN_FIXTURE',
    target_url: 'https://b2b.example.com/item/rs485-modbus-sensor',
    raw_payload: JSON.stringify({
      product_id: 'prod:electrical:mcb:16a-c-curve',
      title: 'Industrial 16A C-Curve Circuit Breaker / RS485 Telemetry',
      retail_price: 1850.0,
      sentiment: 'Robust industrial telemetry with IP65 weather enclosure.'
    }),
    payload_sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    source_observed_at_utc: '2026-10-27T10:00:00.000Z',
    retrieval_timestamp_utc: '2026-10-27T10:00:02.000Z',
    extracted_fields: {
      product_id: 'prod:electrical:mcb:16a-c-curve',
      gross_price_inr: 1850.0,
      factory_gate_quote_inr: null, // MISSING
      observed_seller_count: 6,
      review_sentiment_summary: 'Robust industrial telemetry with IP65 weather enclosure.'
    }
  };

  // --------------------------------------------------------------------------
  // E2E-INV-001: Happy Path End-to-End Workflow
  // --------------------------------------------------------------------------
  it('E2E-INV-001 (Happy Path): Discovery screens candidate, enqueues investigation tasks, executes task, updates evidence, and legitimately unlocks PAPER_ELIGIBLE', async () => {
    // 1. Candidate enters discovery/screening workflow
    const screeningResult = await screener.screenCapture(syntheticElectronicsCapture);
    expect(screeningResult.resolution_status).toBe('RESOLVED');
    expect(screeningResult.candidate).not.toBeNull();
    const candidateId = screeningResult.candidate!.candidate_id;

    // 2. Screener automatically plans and enqueues investigation tasks
    expect(screeningResult.investigation_plan).toBeDefined();
    expect(screeningResult.investigation_plan!.candidate_id).toBe(candidateId);
    expect(screeningResult.investigation_plan!.missing_critical_fields).toContain('factory_gate_quote_inr');
    expect(screeningResult.enqueued_task_count).toBeGreaterThan(0);

    const queue = screener.getTaskQueue();
    expect(queue.size()).toBeGreaterThan(0);

    // Initial state: Candidate evidence is insufficient
    expect(screeningResult.candidate!.evidence_sufficiency.is_sufficient_for_underwriting).toBe(false);

    // 3. Controlled Execution Path: Worker claims factory quote task
    const lease = await screener.claimNextTask('worker:supply-agent:v1', {
      candidateId,
      targetRole: 'SupplyTaskAgent'
    });
    expect(lease).not.toBeNull();
    expect(lease!.target_field).toBe('factory_gate_quote_inr');
    expect(lease!.fencing_token).toBe(1);

    // 4. Submit valid, provenance-bearing evidence update for factory quote (₹620)
    const quoteSubmitResult = await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:supply-agent:v1',
      fencing_token: lease!.fencing_token,
      result_payload: {
        supplier_hub: 'Jamnagar Industrial Cluster',
        verified_factory_quote_inr: 620.0,
        moq_units: 50,
        verification_status: 'VERIFIED'
      },
      evidence_origin: {
        source_connector_id: 'conn:supplier:indiamart-verified',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-27T10:15:00.000Z'
      },
      extracted_fields: {
        factory_gate_quote_inr: 620.0,
        unit_batch_moq: 50
      }
    });

    expect(quoteSubmitResult.commit_status).toBe('COMMITTED');
    expect(quoteSubmitResult.candidate.current_observation.factory_gate_quote_inr).toBe(620.0);
    // Factory quote is now present, but candidate still lacks logistics corridor & statutory clearance
    expect(quoteSubmitResult.candidate.evidence_sufficiency.is_sufficient_for_underwriting).toBe(false);

    // 5. Complete remaining prerequisite tasks: Logistics route & Regulatory clearance
    const logisticsLease = await screener.claimNextTask('worker:logistics-agent:v1', {
      candidateId,
      targetRole: 'LogisticsTaskAgent'
    });
    expect(logisticsLease).not.toBeNull();

    await screener.submitInvestigationResult({
      task_id: logisticsLease!.task_id,
      candidate_id: candidateId,
      generation_id: logisticsLease!.generation_id,
      lease_owner_id: 'worker:logistics-agent:v1',
      fencing_token: logisticsLease!.fencing_token,
      result_payload: { route: 'Jamnagar -> Delhi NCR Hub', verified: true },
      evidence_origin: {
        source_connector_id: 'conn:logistics:verified-carrier',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-27T10:20:00.000Z'
      },
      extracted_fields: {
        has_logistics_route: true
      }
    });

    const regLease = await screener.claimNextTask('worker:regulatory-agent:v1', {
      candidateId,
      targetRole: 'UnitEconomicsTaskAgent'
    });
    expect(regLease).not.toBeNull();

    const finalSubmitResult = await screener.submitInvestigationResult({
      task_id: regLease!.task_id,
      candidate_id: candidateId,
      generation_id: regLease!.generation_id,
      lease_owner_id: 'worker:regulatory-agent:v1',
      fencing_token: regLease!.fencing_token,
      result_payload: { hsn_code: '85362030', gst_rate_bps: 1800, cleared: true },
      evidence_origin: {
        source_connector_id: 'conn:statutory:cbic-tariff',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-27T10:25:00.000Z'
      },
      extracted_fields: {
        has_regulatory_clearance: true
      }
    });

    // 6. Evidence Sufficiency Emerges Organically (NOT hardcoded)
    const fullyInvestigatedCandidate = finalSubmitResult.candidate;
    expect(fullyInvestigatedCandidate.evidence_sufficiency.is_sufficient_for_underwriting).toBe(true);
    expect(fullyInvestigatedCandidate.evidence_sufficiency.has_upstream_quote).toBe(true);
    expect(fullyInvestigatedCandidate.evidence_sufficiency.has_prevailing_asp).toBe(true);
    expect(fullyInvestigatedCandidate.evidence_sufficiency.has_verbatim_reviews).toBe(true);
    expect(fullyInvestigatedCandidate.evidence_sufficiency.has_logistics_route).toBe(true);
    expect(fullyInvestigatedCandidate.evidence_sufficiency.has_regulatory_clearance).toBe(true);

    // 7. Deterministic Underwriting Re-evaluation
    // Gross Spread: ₹1850 ASP vs ₹620 Factory Quote -> ~66% gross margin >= 10% policy hurdle
    expect(fullyInvestigatedCandidate.economic_eligibility.is_economically_eligible).toBe(true);
    expect(fullyInvestigatedCandidate.economic_eligibility.evaluation_status).toBe('EVALUATED_VIABLE');

    // 8. Legitimate Promotion to PAPER_ELIGIBLE via normative lifecycle transitions:
    // NEW -> INVESTIGATE -> UNDER_REVIEW -> VERIFIED -> PAPER_ELIGIBLE
    await lifecycleEngine.transitionState(
      candidateId,
      'INVESTIGATE',
      'Investigation tasks initiated'
    );
    await lifecycleEngine.transitionState(
      candidateId,
      'UNDER_REVIEW',
      'Investigation tasks completed, evidence submitted'
    );
    const verifiedCandidate = await lifecycleEngine.transitionState(
      candidateId,
      'VERIFIED',
      'All evidence sufficiency gates genuinely satisfied via investigation'
    );
    expect(verifiedCandidate.lifecycle_state).toBe('VERIFIED');

    const paperEligibleCandidate = await lifecycleEngine.transitionState(
      candidateId,
      'PAPER_ELIGIBLE',
      'All economic hurdles genuinely satisfied via deterministic underwriting'
    );
    expect(paperEligibleCandidate.lifecycle_state).toBe('PAPER_ELIGIBLE');
  });

  // --------------------------------------------------------------------------
  // E2E-INV-002: Incomplete Candidate Remains Strictly Ineligible
  // --------------------------------------------------------------------------
  it('E2E-INV-002 (Missing Evidence): Incomplete candidate remains ineligible and cannot bypass eligibility gates', async () => {
    const screeningResult = await screener.screenCapture(syntheticElectronicsCapture);
    const candidateId = screeningResult.candidate!.candidate_id;

    // Only complete factory quote, leaving logistics & regulatory missing
    const lease = await screener.claimNextTask('worker:supply-agent:v1', {
      candidateId,
      targetRole: 'SupplyTaskAgent'
    });

    await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:supply-agent:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { quote: 700.0 },
      evidence_origin: {
        source_connector_id: 'conn:supplier:indiamart',
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        observed_at_utc: '2026-10-27T10:10:00.000Z'
      },
      extracted_fields: { factory_gate_quote_inr: 700.0 }
    });

    const candidate = (await lifecycleEngine.getCandidate(candidateId))!;
    expect(candidate.evidence_sufficiency.is_sufficient_for_underwriting).toBe(false);

    // Transition to INVESTIGATE then UNDER_REVIEW
    await lifecycleEngine.transitionState(candidateId, 'INVESTIGATE', 'Investigation tasks initiated');
    await lifecycleEngine.transitionState(candidateId, 'UNDER_REVIEW', 'Investigation tasks submitted');

    // Fail-closed enforcement: Transition from UNDER_REVIEW to VERIFIED must throw E-OPP-VERIFICATION-SUFFICIENCY-BLOCKED
    await expect(
      lifecycleEngine.transitionState(
        candidateId,
        'VERIFIED',
        'Attempting bypass with incomplete logistics and regulatory evidence'
      )
    ).rejects.toThrow(/E-OPP-VERIFICATION-SUFFICIENCY-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // E2E-INV-003: Unverified / Synthetic Result Rejection
  // --------------------------------------------------------------------------
  it('E2E-INV-003 (Unverified Result): Task result with unverified origin does not promote unverified data to verified status', async () => {
    const screeningResult = await screener.screenCapture(syntheticElectronicsCapture);
    const candidateId = screeningResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:untrusted:v1', { candidateId });

    // Submit payload with UNATTESTED_USER_INTAKE origin class
    const submitResult = await screener.submitInvestigationResult({
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:untrusted:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { guessed_quote: 100.0 },
      evidence_origin: {
        source_connector_id: 'conn:untrusted:user-input',
        origin_class: 'UNATTESTED_USER_INTAKE',
        observed_at_utc: '2026-10-27T10:10:00.000Z'
      },
      extracted_fields: { factory_gate_quote_inr: 100.0 }
    });

    // Transition to INVESTIGATE then UNDER_REVIEW
    await lifecycleEngine.transitionState(candidateId, 'INVESTIGATE', 'Investigation tasks initiated');
    await lifecycleEngine.transitionState(candidateId, 'UNDER_REVIEW', 'Investigation tasks submitted');

    // Invariant: Unattested intake with missing fields cannot promote candidate to VERIFIED state
    await expect(
      lifecycleEngine.transitionState(candidateId, 'VERIFIED', 'Attempting verification on unattested intake')
    ).rejects.toThrow(/E-OPP-VERIFICATION-SUFFICIENCY-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // E2E-INV-004: Stale Lease & Expired Fence Rejection
  // --------------------------------------------------------------------------
  it('E2E-INV-004 (Stale Lease): Stale fencing token is rejected without corrupting candidate state', async () => {
    const screeningResult = await screener.screenCapture(syntheticElectronicsCapture);
    const candidateId = screeningResult.candidate!.candidate_id;

    // Worker 1 claims task
    const lease1 = await screener.claimNextTask('worker-1', { candidateId, leaseDurationMs: 10 });
    const initialCandidate = (await lifecycleEngine.getCandidate(candidateId))!;

    // Wait for lease to expire
    await new Promise((r) => setTimeout(r, 20));
    screener.getTaskQueue().sweepExpiredLeases();

    // Worker 2 claims the swept task
    const lease2 = await screener.claimNextTask('worker-2', { candidateId });
    expect(lease2!.fencing_token).toBe(lease1!.fencing_token + 1);

    // Worker 1 attempts submit with stale token -> must throw E-QUEUE-STALE-LEASE-FENCE-REJECTED
    await expect(
      screener.submitInvestigationResult({
        task_id: lease1!.task_id,
        candidate_id: candidateId,
        generation_id: lease1!.generation_id,
        lease_owner_id: 'worker-1',
        fencing_token: lease1!.fencing_token,
        result_payload: { quote: 500.0 },
        evidence_origin: {
          source_connector_id: 'conn:supplier:stale',
          origin_class: 'RECORDED_GOLDEN_FIXTURE',
          observed_at_utc: '2026-10-27T10:10:00.000Z'
        },
        extracted_fields: { factory_gate_quote_inr: 500.0 }
      })
    ).rejects.toThrow(/E-QUEUE-STALE-LEASE-FENCE-REJECTED/);

    // Invariant: Candidate state was NOT modified or corrupted by the stale worker
    const currentCandidate = (await lifecycleEngine.getCandidate(candidateId))!;
    expect(currentCandidate.current_observation.factory_gate_quote_inr).toBe(
      initialCandidate.current_observation.factory_gate_quote_inr
    );
  });

  // --------------------------------------------------------------------------
  // E2E-INV-005: Idempotent Replay Protocol
  // --------------------------------------------------------------------------
  it('E2E-INV-005 (Idempotency): Replay of identical commit parameters returns IDEMPOTENT_REPLAY_ACK', async () => {
    const screeningResult = await screener.screenCapture(syntheticElectronicsCapture);
    const candidateId = screeningResult.candidate!.candidate_id;

    const lease = await screener.claimNextTask('worker:supply-agent:v1', { candidateId });

    const submitParams = {
      task_id: lease!.task_id,
      candidate_id: candidateId,
      generation_id: lease!.generation_id,
      lease_owner_id: 'worker:supply-agent:v1',
      fencing_token: lease!.fencing_token,
      result_payload: { verified_quote: 650.0 },
      evidence_origin: {
        source_connector_id: 'conn:supplier:indiamart',
        origin_class: 'RECORDED_GOLDEN_FIXTURE' as const,
        observed_at_utc: '2026-10-27T10:10:00.000Z'
      },
      extracted_fields: { factory_gate_quote_inr: 650.0 }
    };

    const firstSubmit = await screener.submitInvestigationResult(submitParams);
    expect(firstSubmit.commit_status).toBe('COMMITTED');

    const candidateAfterFirst = (await lifecycleEngine.getCandidate(candidateId))!;
    const obsCountAfterFirst = candidateAfterFirst.observation_history_count;

    // Replay identical submit
    const secondSubmit = await screener.submitInvestigationResult(submitParams);
    expect(secondSubmit.commit_status).toBe('IDEMPOTENT_REPLAY_ACK');

    // Invariant: Observation count did not increment on replay
    const candidateAfterSecond = (await lifecycleEngine.getCandidate(candidateId))!;
    expect(candidateAfterSecond.observation_history_count).toBe(obsCountAfterFirst);
  });

  // --------------------------------------------------------------------------
  // E2E-INV-006: Terminal Failure & Dead-Letter Quarantine
  // --------------------------------------------------------------------------
  it('E2E-INV-006 (Failure Handling): 3 consecutive failures transition task to DEAD_LETTER_QUARANTINE and leave candidate visible', async () => {
    const screeningResult = await screener.screenCapture(syntheticElectronicsCapture);
    const candidateId = screeningResult.candidate!.candidate_id;

    const lease1 = await screener.claimNextTask('worker-1', { candidateId });
    await screener.recordTaskFailure({
      task_id: lease1!.task_id,
      lease_owner_id: 'worker-1',
      fencing_token: lease1!.fencing_token,
      error_message: 'Failure 1: Network timeout'
    });
    screener.getTaskQueue().sweepExpiredLeases();

    const lease2 = await screener.claimNextTask('worker-2', { candidateId });
    await screener.recordTaskFailure({
      task_id: lease2!.task_id,
      lease_owner_id: 'worker-2',
      fencing_token: lease2!.fencing_token,
      error_message: 'Failure 2: Supplier 429 Too Many Requests'
    });
    screener.getTaskQueue().sweepExpiredLeases();

    const lease3 = await screener.claimNextTask('worker-3', { candidateId });
    const fail3 = await screener.recordTaskFailure({
      task_id: lease3!.task_id,
      lease_owner_id: 'worker-3',
      fencing_token: lease3!.fencing_token,
      error_message: 'Failure 3: Catalog permanently removed'
    });

    expect(fail3.state).toBe('DEAD_LETTER_QUARANTINE');

    // Invariant: Task is permanently quarantined and cannot be claimed again
    screener.getTaskQueue().sweepExpiredLeases();
    const claimAfterDlq = await screener.claimNextTask('worker-4', { candidateId });
    expect(claimAfterDlq?.task_id).not.toBe(lease1!.task_id);
  });

  // --------------------------------------------------------------------------
  // E2E-INV-007: Capital Safety & Zero Real-Money Route
  // --------------------------------------------------------------------------
  it('E2E-INV-007 (Capital Safety): No investigation path bypasses paper commitment rationale or accesses real capital', async () => {
    const screeningResult = await screener.screenCapture(syntheticElectronicsCapture);
    const candidateId = screeningResult.candidate!.candidate_id;

    // 1. Candidate in DISCOVERED / NEW cannot authorize paper commit
    await expect(
      lifecycleEngine.authorizePaperCommit(candidateId, 'Valid rationale of at least fifteen characters')
    ).rejects.toThrow(/E-OPP-UNVERIFIED-COMMIT-BLOCKED/);

    // 2. Paper commit requires at least 15 characters of human confirmation rationale
    await expect(
      lifecycleEngine.authorizePaperCommit(candidateId, 'Too short')
    ).rejects.toThrow(/E-OPP-COMMIT-RATIONALE-REQUIRED/);
  });
});
