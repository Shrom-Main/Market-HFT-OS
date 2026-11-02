/**
 * POC-001: Acceptance Suite 52 — Gate DEC-030 (Slice 2C: Controlled Investigation Orchestration)
 *
 * Verifies all 5 mandatory acceptance criteria specified in the Owner Master Directive:
 * - INV-PLAN-001: Missing factory quote produces a prioritized supply investigation task.
 * - INV-PLAN-002: Missing defect rate and customer sentiment produce the appropriate investigation task.
 * - INV-LEASE-003: A stale lease fencing token cannot complete or overwrite a task.
 * - INV-RETRY-004: Three consecutive failures result in terminal dead-letter quarantine.
 * - INV-GATE-005: An incomplete candidate cannot bypass the existing authorization boundary into PAPER_ELIGIBLE.
 *
 * Additional Invariant Coverage:
 * - INV-CONCURRENCY-006: Global (max 4) and per-candidate (max 2) concurrency limits are strictly enforced.
 * - INV-REPLAY-007: Idempotent replay of identical commit parameters returns IDEMPOTENT_REPLAY_ACK.
 *
 * Category Neutrality:
 * - Exercises candidates across Electronics (RS485 Modbus Sensor), Laboratory Consumables (Sterile Pipette Tips),
 *   and Precision Fasteners (High-Tensile Grade 8.8 Hex Bolts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InvestigationPlanner,
  InvestigationPlan
} from '../../src/discovery/investigationPlanner.js';
import {
  InvestigationTaskQueue,
  MAX_GLOBAL_CONCURRENT_LEASES,
  MAX_PER_CANDIDATE_CONCURRENT_LEASES
} from '../../src/discovery/investigationTaskQueue.js';
import { NormalizedDiscoveryObservation } from '../../src/discovery/sourceAdapterContract.js';
import { OpportunityLifecycleEngine } from '../../src/research/opportunityLifecycleEngine.js';
import { DiscoveryScreenerService } from '../../src/discovery/discoveryScreenerService.js';
import { EntityIdentityResolver } from '../../src/research/entityIdentityResolver.js';

describe('Suite 52: Gate DEC-030 — Controlled Investigation Orchestration (Slice 2C)', () => {
  let queue: InvestigationTaskQueue;
  let lifecycleEngine: OpportunityLifecycleEngine;
  let screener: DiscoveryScreenerService;

  beforeEach(async () => {
    queue = new InvestigationTaskQueue();
    lifecycleEngine = new OpportunityLifecycleEngine();
    screener = new DiscoveryScreenerService({
      lifecycleEngine,
      identityResolver: new EntityIdentityResolver()
    });
    await screener.initialize();
  });

  // --------------------------------------------------------------------------
  // INV-PLAN-001: Missing Factory Quote Produces Prioritized Supply Task
  // Category: Electronics / Precision Sensor
  // --------------------------------------------------------------------------
  it('INV-PLAN-001: Missing factory quote produces a prioritized supply investigation task', async () => {
    const electronicsObservation: NormalizedDiscoveryObservation = {
      observation_id: 'OBS-ELEC-MODBUS-001',
      capture_id: 'CAP-ELEC-MODBUS-001',
      strategy_id: 'strat:india-b2b:physical-arbitrage',
      canonical_product_id: 'prod:electronics:rs485-sensor',
      candidate_name: 'Industrial RS485 Modbus Temperature & Humidity Probe',
      category: 'ELECTRONICS_AND_ELECTRICAL' as any,
      source_connector_id: 'conn:marketplace:b2b-electronics',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      prevailing_retail_asp_inr: 1850.0,
      factory_gate_quote_inr: null, // MISSING: Factory supply quote absent
      unit_batch_moq: 50,
      observed_seller_count: 8,
      review_sentiment_summary: 'Stable Modbus RTU telemetry with industrial IP65 enclosure.',
      raw_payload_snippet: '{"title":"RS485 Temp Humidity Probe","price":1850}',
      payload_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      source_observed_at_utc: '2026-10-25T12:00:00.000Z',
      ingestion_timestamp_utc: '2026-10-25T12:00:02.000Z',
      has_logistics_route: true,
      has_regulatory_clearance: true,
      normalization_notes: 'Electronics sensor category observation with verified retail ASP'
    };

    const plan: InvestigationPlan = InvestigationPlanner.planInvestigation(
      'cand:electronics:modbus-probe',
      electronicsObservation,
      'GEN-01'
    );

    expect(plan.candidate_id).toBe('cand:electronics:modbus-probe');
    expect(plan.generation_id).toBe('GEN-01');
    expect(plan.missing_critical_fields).toContain('factory_gate_quote_inr');

    // Invariant: Missing supply quote produces a prioritized SupplyTaskAgent task
    const supplyTask = plan.tasks.find((t) => t.target_role === 'SupplyTaskAgent');
    expect(supplyTask).toBeDefined();
    expect(supplyTask!.task_type).toBe('VERIFY_FACTORY_QUOTE');
    expect(supplyTask!.target_field).toBe('factory_gate_quote_inr');
    expect(supplyTask!.priority).toBe(1); // Priority 1: critical prerequisite for unit economics
    expect(supplyTask!.state).toBe('QUEUED');
  });

  // --------------------------------------------------------------------------
  // INV-PLAN-002: Missing Defect Rate and Sentiment Produces Customer Task
  // Category: Laboratory Consumables
  // --------------------------------------------------------------------------
  it('INV-PLAN-002: Missing defect rate and customer sentiment produce the appropriate investigation task', async () => {
    const labConsumableObservation: NormalizedDiscoveryObservation = {
      observation_id: 'OBS-LAB-TIPS-001',
      capture_id: 'CAP-LAB-TIPS-001',
      strategy_id: 'strat:india-b2b:physical-arbitrage',
      canonical_product_id: 'prod:laboratory:pipette-tips-200ul',
      candidate_name: 'Sterile Filter Pipette Tips (200 uL, Low Retention, Pack of 960)',
      category: 'MEDICAL_AND_HEALTHCARE' as any,
      source_connector_id: 'conn:b2b:biotech-supplies',
      source_type: 'SUPPLIER_B2B_CATALOG',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      prevailing_retail_asp_inr: 2400.0,
      factory_gate_quote_inr: 1100.0,
      unit_batch_moq: 10,
      observed_seller_count: 4,
      review_sentiment_summary: null, // MISSING: Customer sentiment & defect history absent
      raw_payload_snippet: '{"title":"Sterile Filter Pipette Tips","price":2400,"quote":1100}',
      payload_sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      source_observed_at_utc: '2026-10-25T14:00:00.000Z',
      ingestion_timestamp_utc: '2026-10-25T14:00:01.500Z',
      has_logistics_route: true,
      has_regulatory_clearance: true,
      normalization_notes: 'Lab consumable observation with verified pricing but unassessed customer sentiment'
    };

    const plan = InvestigationPlanner.planInvestigation(
      'cand:lab:pipette-tips',
      labConsumableObservation,
      'GEN-01'
    );

    expect(plan.missing_critical_fields).toContain('review_sentiment_summary');
    expect(plan.missing_critical_fields).toContain('observed_defect_rate_bps');

    // Invariant: Missing customer feedback produces a CustomerTaskAgent task
    const customerTask = plan.tasks.find((t) => t.target_role === 'CustomerTaskAgent');
    expect(customerTask).toBeDefined();
    expect(customerTask!.task_type).toBe('ASSESS_CUSTOMER_SENTIMENT_AND_DEFECTS');
    expect(customerTask!.target_field).toBe('observed_defect_rate_bps');
    expect(customerTask!.priority).toBe(2);
    expect(customerTask!.state).toBe('QUEUED');
  });

  // --------------------------------------------------------------------------
  // INV-LEASE-003: Stale Lease Fencing Token Rejection
  // --------------------------------------------------------------------------
  it('INV-LEASE-003: A stale lease fencing token cannot complete or overwrite a task', async () => {
    // 1. Create a task for precision fasteners
    const observation: NormalizedDiscoveryObservation = {
      observation_id: 'OBS-FASTENER-HEX-001',
      capture_id: 'CAP-FASTENER-HEX-001',
      strategy_id: 'strat:india-b2b:physical-arbitrage',
      canonical_product_id: 'prod:fasteners:hex-bolt-m8',
      candidate_name: 'High-Tensile Grade 8.8 Hex Bolts (M8 x 50mm, Zinc Plated)',
      source_connector_id: 'conn:catalog:fasteners',
      source_type: 'SUPPLIER_B2B_CATALOG',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      prevailing_retail_asp_inr: 450.0,
      factory_gate_quote_inr: null,
      unit_batch_moq: 100,
      observed_seller_count: 5,
      review_sentiment_summary: 'Verified tensile strength.',
      raw_payload_snippet: '{"sku":"HEX-M8-50","asp":450}',
      payload_sha256: 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1',
      source_observed_at_utc: '2026-10-25T15:00:00.000Z',
      ingestion_timestamp_utc: '2026-10-25T15:00:01.000Z',
      has_logistics_route: true,
      has_regulatory_clearance: true,
      normalization_notes: 'Hex bolt observation'
    };

    const plan = InvestigationPlanner.planInvestigation('cand:fasteners:hex-bolt-m8', observation);
    await queue.enqueueTasks(plan.tasks);

    // 2. Worker A leases the task with short duration (100ms)
    const leasedWorkerA = await queue.claimNextTask('worker-agent-A', {
      candidateId: 'cand:fasteners:hex-bolt-m8',
      leaseDurationMs: 100
    });
    expect(leasedWorkerA).not.toBeNull();
    expect(leasedWorkerA!.lease_owner_id).toBe('worker-agent-A');
    expect(leasedWorkerA!.fencing_token).toBe(1);

    // 3. Worker A pauses/stalls; lease expires
    await new Promise((resolve) => setTimeout(resolve, 150));
    queue.sweepExpiredLeases();

    // 4. Worker B claims the recovered task with fence token 2
    const leasedWorkerB = await queue.claimNextTask('worker-agent-B', {
      candidateId: 'cand:fasteners:hex-bolt-m8',
      leaseDurationMs: 30_000
    });
    expect(leasedWorkerB).not.toBeNull();
    expect(leasedWorkerB!.lease_owner_id).toBe('worker-agent-B');
    expect(leasedWorkerB!.fencing_token).toBe(2);

    // 5. Worker A wakes up and attempts to complete with stale fence token 1
    await expect(
      queue.commitTaskResult({
        task_id: leasedWorkerA!.task_id,
        candidate_id: leasedWorkerA!.candidate_id,
        generation_id: leasedWorkerA!.generation_id,
        task_type: leasedWorkerA!.task_type,
        lease_owner_id: 'worker-agent-A',
        fencing_token: 1, // Stale token
        result_payload: { quote_inr: 180.0, factory: 'Ludhiana Fasteners Ltd' }
      })
    ).rejects.toThrow(/E-QUEUE-STALE-LEASE-FENCE-REJECTED/);

    // 6. Worker B completes with valid active fence token 2
    const commitResult = await queue.commitTaskResult({
      task_id: leasedWorkerB!.task_id,
      candidate_id: leasedWorkerB!.candidate_id,
      generation_id: leasedWorkerB!.generation_id,
      task_type: leasedWorkerB!.task_type,
      lease_owner_id: 'worker-agent-B',
      fencing_token: 2, // Active token
      result_payload: { quote_inr: 185.0, factory: 'Apex Precision Bolts' }
    });

    expect(commitResult.status).toBe('COMMITTED');

    // Verify task is terminal SUCCEEDED
    const finalTask = await queue.getTask(leasedWorkerB!.task_id);
    expect(finalTask!.state).toBe('SUCCEEDED');
    expect(finalTask!.fencing_token).toBe(2);
  });

  // --------------------------------------------------------------------------
  // INV-RETRY-004: Three Consecutive Failures Result in Terminal DLQ
  // --------------------------------------------------------------------------
  it('INV-RETRY-004: Three consecutive failures result in terminal dead-letter quarantine', async () => {
    const observation: NormalizedDiscoveryObservation = {
      observation_id: 'OBS-ELEC-FLAWED-001',
      capture_id: 'CAP-ELEC-FLAWED-001',
      strategy_id: 'strat:india-b2b:physical-arbitrage',
      canonical_product_id: 'prod:electronics:analog-sensor',
      candidate_name: 'Analog Pressure Transmitter (4-20mA)',
      source_connector_id: 'conn:b2b:electronics',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      prevailing_retail_asp_inr: 3200.0,
      factory_gate_quote_inr: null,
      unit_batch_moq: 20,
      observed_seller_count: 3,
      review_sentiment_summary: 'Reliable sensor.',
      raw_payload_snippet: '{"title":"Pressure Transmitter","asp":3200}',
      payload_sha256: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2',
      source_observed_at_utc: '2026-10-25T16:00:00.000Z',
      ingestion_timestamp_utc: '2026-10-25T16:00:01.000Z',
      has_logistics_route: true,
      has_regulatory_clearance: true,
      normalization_notes: 'Analog transmitter observation'
    };

    const plan = InvestigationPlanner.planInvestigation('cand:elec:pressure-trans', observation);
    await queue.enqueueTasks(plan.tasks);
    const targetTaskId = plan.tasks[0].task_id;

    // Attempt 1: Worker 1 claims and fails
    const claim1 = await queue.claimNextTask('worker-1', { candidateId: 'cand:elec:pressure-trans' });
    expect(claim1!.task_id).toBe(targetTaskId);
    expect(claim1!.attempts).toBe(1);

    const fail1 = await queue.recordTaskFailure({
      task_id: targetTaskId,
      lease_owner_id: 'worker-1',
      fencing_token: claim1!.fencing_token,
      error_message: 'Supplier catalog network timeout'
    });
    expect(fail1.state).toBe('RETRYING');
    expect(fail1.attempts).toBe(1);

    // Sweep RETRYING back to QUEUED
    queue.sweepExpiredLeases();

    // Attempt 2: Worker 2 claims and fails
    const claim2 = await queue.claimNextTask('worker-2', { candidateId: 'cand:elec:pressure-trans' });
    expect(claim2!.task_id).toBe(targetTaskId);
    expect(claim2!.attempts).toBe(2);

    const fail2 = await queue.recordTaskFailure({
      task_id: targetTaskId,
      lease_owner_id: 'worker-2',
      fencing_token: claim2!.fencing_token,
      error_message: 'HTTP 429 Rate limit exceeded on catalog'
    });
    expect(fail2.state).toBe('RETRYING');
    expect(fail2.attempts).toBe(2);

    queue.sweepExpiredLeases();

    // Attempt 3: Worker 3 claims and fails -> Terminal DEAD_LETTER_QUARANTINE
    const claim3 = await queue.claimNextTask('worker-3', { candidateId: 'cand:elec:pressure-trans' });
    expect(claim3!.task_id).toBe(targetTaskId);
    expect(claim3!.attempts).toBe(3);

    const fail3 = await queue.recordTaskFailure({
      task_id: targetTaskId,
      lease_owner_id: 'worker-3',
      fencing_token: claim3!.fencing_token,
      error_message: 'Supplier factory permanently discontinued SKU'
    });
    expect(fail3.state).toBe('DEAD_LETTER_QUARANTINE');
    expect(fail3.attempts).toBe(3);

    // Verify task cannot be claimed by any subsequent worker
    queue.sweepExpiredLeases();
    const subsequentClaim = await queue.claimNextTask('worker-4', { candidateId: 'cand:elec:pressure-trans' });
    expect(subsequentClaim).toBeNull();

    const dlqTask = await queue.getTask(targetTaskId);
    expect(dlqTask!.state).toBe('DEAD_LETTER_QUARANTINE');
    expect(dlqTask!.last_error_message).toBe('Supplier factory permanently discontinued SKU');
  });

  // --------------------------------------------------------------------------
  // INV-GATE-005: Incomplete Candidate Cannot Bypass Authorization Gate
  // --------------------------------------------------------------------------
  it('INV-GATE-005: An incomplete candidate cannot bypass the existing authorization boundary into PAPER_ELIGIBLE', async () => {
    // 1. Ingest observation with missing factory quote
    const ingestResult = await lifecycleEngine.ingestObservation({
      strategy_id: 'strat:india-b2b:physical-arbitrage',
      canonical_product_id: 'prod:fasteners:incomplete-bolt',
      candidate_name: 'Incomplete Fastener Assembly',
      source_connector_id: 'conn:marketplace:fasteners',
      prevailing_retail_asp_inr: 500.0,
      factory_gate_quote_inr: null, // Critical supply quote missing
      unit_batch_moq: 100,
      observed_seller_count: 2,
      review_sentiment_summary: null
    });

    const candidate = ingestResult.candidate;
    expect(candidate).toBeDefined();

    // 2. Planning generates tasks for missing fields
    const observation: NormalizedDiscoveryObservation = {
      observation_id: candidate.current_observation.observation_id,
      capture_id: 'CAP-INCOMPLETE-001',
      strategy_id: candidate.strategy_id,
      canonical_product_id: candidate.canonical_product_id,
      candidate_name: candidate.candidate_name,
      source_connector_id: candidate.current_observation.source_connector_id,
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      prevailing_retail_asp_inr: candidate.current_observation.prevailing_retail_asp_inr,
      factory_gate_quote_inr: candidate.current_observation.factory_gate_quote_inr,
      unit_batch_moq: candidate.current_observation.unit_batch_moq,
      observed_seller_count: candidate.current_observation.observed_seller_count,
      review_sentiment_summary: candidate.current_observation.review_sentiment_summary,
      raw_payload_snippet: '{"title":"Incomplete Fastener"}',
      payload_sha256: candidate.current_observation.payload_sha256,
      source_observed_at_utc: '2026-10-25T17:00:00.000Z',
      ingestion_timestamp_utc: '2026-10-25T17:00:01.000Z',
      has_logistics_route: false,
      has_regulatory_clearance: false,
      normalization_notes: 'Incomplete observation'
    };

    const plan = InvestigationPlanner.planInvestigation(candidate.candidate_id, observation);
    expect(plan.tasks.length).toBeGreaterThanOrEqual(3);

    // 3. Candidate evidence sufficiency is false
    expect(candidate.evidence_sufficiency.is_sufficient_for_underwriting).toBe(false);

    // 4. Invariant: Direct transition to PAPER_ELIGIBLE must throw fail-closed
    await expect(
      lifecycleEngine.transitionState(
        candidate.candidate_id,
        'PAPER_ELIGIBLE',
        'Attempting unauthorized promotion of incomplete candidate'
      )
    ).rejects.toThrow(/E-OPP-ECONOMIC-ELIGIBILITY-BLOCKED|E-OPP-INVALID-TRANSITION/);

    // 5. Invariant: authorizePaperCommit() must throw fail-closed
    await expect(
      lifecycleEngine.authorizePaperCommit(
        candidate.candidate_id,
        'Operator attempting paper commit without complete investigation'
      )
    ).rejects.toThrow(/E-OPP-UNVERIFIED-COMMIT-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // INV-CONCURRENCY-006: Concurrency Limits (Max 4 Global, Max 2 Per Candidate)
  // --------------------------------------------------------------------------
  it('INV-CONCURRENCY-006: Global (max 4) and per-candidate (max 2) concurrency limits are strictly enforced', async () => {
    // Create 3 tasks for Candidate A and 3 tasks for Candidate B
    const createTasksFor = (candidateId: string) => [
      {
        task_id: `TASK-${candidateId}-1`,
        candidate_id: candidateId,
        generation_id: 'GEN-01',
        task_type: 'VERIFY_FACTORY_QUOTE' as const,
        target_role: 'SupplyTaskAgent' as const,
        target_field: 'factory_gate_quote_inr',
        priority: 1,
        state: 'QUEUED' as const,
        description: 'Task 1',
        payload: {},
        created_at_utc: new Date().toISOString()
      },
      {
        task_id: `TASK-${candidateId}-2`,
        candidate_id: candidateId,
        generation_id: 'GEN-01',
        task_type: 'VERIFY_RETAIL_ASP' as const,
        target_role: 'UnitEconomicsTaskAgent' as const,
        target_field: 'prevailing_retail_asp_inr',
        priority: 1,
        state: 'QUEUED' as const,
        description: 'Task 2',
        payload: {},
        created_at_utc: new Date().toISOString()
      },
      {
        task_id: `TASK-${candidateId}-3`,
        candidate_id: candidateId,
        generation_id: 'GEN-01',
        task_type: 'VERIFY_LOGISTICS_AND_FREIGHT' as const,
        target_role: 'LogisticsTaskAgent' as const,
        target_field: 'has_logistics_route',
        priority: 2,
        state: 'QUEUED' as const,
        description: 'Task 3',
        payload: {},
        created_at_utc: new Date().toISOString()
      }
    ];

    await queue.enqueueTasks(createTasksFor('cand:candidate-A'));
    await queue.enqueueTasks(createTasksFor('cand:candidate-B'));

    // Claim 2 tasks for Candidate A -> reaches per-candidate ceiling (2)
    const a1 = await queue.claimNextTask('worker-1', { candidateId: 'cand:candidate-A' });
    const a2 = await queue.claimNextTask('worker-2', { candidateId: 'cand:candidate-A' });
    expect(a1).not.toBeNull();
    expect(a2).not.toBeNull();

    // Attempting a 3rd claim for Candidate A throws per-candidate concurrency limit
    await expect(
      queue.claimNextTask('worker-3', { candidateId: 'cand:candidate-A' })
    ).rejects.toThrow(/E-QUEUE-CANDIDATE-CONCURRENCY-LIMIT/);

    // Claim 2 tasks for Candidate B -> reaches global ceiling (4 total: 2 A + 2 B)
    const b1 = await queue.claimNextTask('worker-3', { candidateId: 'cand:candidate-B' });
    const b2 = await queue.claimNextTask('worker-4', { candidateId: 'cand:candidate-B' });
    expect(b1).not.toBeNull();
    expect(b2).not.toBeNull();

    // Attempting a 5th global claim throws global concurrency limit
    await expect(
      queue.claimNextTask('worker-5')
    ).rejects.toThrow(/E-QUEUE-GLOBAL-CONCURRENCY-LIMIT/);
  });

  // --------------------------------------------------------------------------
  // INV-REPLAY-007: Idempotent Replay Protocol
  // --------------------------------------------------------------------------
  it('INV-REPLAY-007: Idempotent replay of identical commit parameters returns IDEMPOTENT_REPLAY_ACK', async () => {
    const task = {
      task_id: 'TASK-REPLAY-TEST-001',
      candidate_id: 'cand:replay:test',
      generation_id: 'GEN-01',
      task_type: 'VERIFY_FACTORY_QUOTE' as const,
      target_role: 'SupplyTaskAgent' as const,
      target_field: 'factory_gate_quote_inr',
      priority: 1,
      state: 'QUEUED' as const,
      description: 'Replay test task',
      payload: {},
      created_at_utc: new Date().toISOString()
    };

    await queue.enqueueTasks([task]);
    const leased = await queue.claimNextTask('worker-replay-1');
    expect(leased).not.toBeNull();

    const commitParams = {
      task_id: 'TASK-REPLAY-TEST-001',
      candidate_id: 'cand:replay:test',
      generation_id: 'GEN-01',
      task_type: 'VERIFY_FACTORY_QUOTE' as const,
      lease_owner_id: 'worker-replay-1',
      fencing_token: leased!.fencing_token,
      result_payload: { quote_inr: 120.0, vendor: 'Reliable Fasteners Corp' }
    };

    // First commit -> COMMITTED
    const res1 = await queue.commitTaskResult(commitParams);
    expect(res1.status).toBe('COMMITTED');

    // Second commit with identical parameters -> IDEMPOTENT_REPLAY_ACK
    const res2 = await queue.commitTaskResult(commitParams);
    expect(res2.status).toBe('IDEMPOTENT_REPLAY_ACK');

    // Conflicting commit parameters -> throws E-QUEUE-COMMIT-ENVELOPE-MISMATCH
    await expect(
      queue.commitTaskResult({
        ...commitParams,
        result_payload: { quote_inr: 999.0, vendor: 'Conflicting Vendor' }
      })
    ).rejects.toThrow(/E-QUEUE-COMMIT-ENVELOPE-MISMATCH/);
  });
});
