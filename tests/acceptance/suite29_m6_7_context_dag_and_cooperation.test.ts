/**
 * SUITE-29: Gate M6.7 Stage 7 Context DAG Orchestrator, Bounded Parallelism,
 * Idempotent Deduplication, Degraded-Mode Hold & End-to-End Capital Gate
 *
 * Normative Acceptance Suite for Stage 7:
 * 1. MCP-DAG-BOUNDED-PARALLEL-JITTER-INVARIANCE-001:
 *    - Runs Pass 1 workers in parallel twice with artificial async delays (25ms jitter).
 *    - Proves canonical barrier sorting by (pass_number, node_id) produces bit-for-bit identical
 *      DagExecutionResult and RFC 8785 JCS SHA-256 telemetry digests.
 * 2. MCP-DAG-COMPLEMENTARY-AND-SUPPLEMENTARY-COOPERATION-002:
 *    - An anomalous ₹119.00 quote dynamically activates Pass 2 supplementary MediaAndChatterWorker
 *      and secondary SourceCaptureWorker.
 *    - Cross-source price conflict joins as CONFLICT, triggering Pass 3 RedTeam to block allocation.
 * 3. MCP-DAG-VIABLE-CORROBORATED-E2E-OPTIMIZATION-003:
 *    - Clean corroborated IndiaMART tiered quote (100-249 @ ₹131, 250-499 @ ₹128.50, 500+ @ ₹125)
 *      with SUSTAINED_STRUCTURAL_SIGNAL and EMPIRICALLY_VALIDATED_DRIVER passes Pass 3.
 *    - Executes Pass 4 evaluateOptimalBatchSize selecting 500 packs @ ₹138.2100 landed cost and
 *      399.41% RoWC in PAPER_SIMULATION mode.
 * 4. MCP-DAG-TACTICAL-DECAY-AND-REFUTED-FACTOR-BLOCK-004:
 *    - Proves Pass 4 blocks capital allocation when:
 *      (a) FAST_TACTICAL_OPPORTUNITY has 10d half-life vs 35d CCC (E-MLW-EDGE-DECAYS-BEFORE-CASH-RECOVERY).
 *      (b) Factor is flagged as EMPIRICALLY_REFUTED_NOISE (E-DAG-REFUTED-GROWTH-DRIVER).
 * 5. MCP-DAG-PROVIDER-TIMEOUT-DEGRADED-HOLD-005:
 *    - Macro series provider failure during Pass 1 enters PARTIAL_DEGRADED_HOLD.
 *    - Preserves prior t0 bitemporal record untouched, refusing capital (E-DAG-DEGRADED-PROVIDER-HOLD).
 * 6. MCP-DAG-IDEMPOTENT-RETRY-DEDUPLICATION-006:
 *    - Submitting identical idempotency_key returns cached DEDUPLICATED_REPLAY.
 *    - Proves MCP Broker requests_made increments only once.
 * 7. MCP-DAG-BITEMPORAL-LINEAGE-REPLAY-007:
 *    - Records viable t0 DAG run in BitemporalRestatementEngine.
 *    - Replays at t1 after new evidence arrives, verifying complete lineage reconstruction without mutating t0.
 * 8. MCP-DAG-CYCLE-DETECTION-AND-PURE-BIGINT-HALFLIFE-008:
 *    - Verifies E-DAG-CYCLE-DETECTED on cyclic dependency topology.
 *    - Verifies MLW-01 pure-BigInt half-life calculation on large subunit values (> Number.MAX_SAFE_INTEGER).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import { sanitizeForJcs } from '../../src/agents/m6AgentFramework.js';
import {
  McpServerAdapter,
  McpCapabilityBroker,
  createCapabilityGrant,
  McpRunLedger
} from '../../src/mcp/mcpSubstrate.js';
import {
  SourceCaptureWorker,
  registerSourceCaptureTool,
  PriceBracketTier
} from '../../src/agents/workers/sourceCaptureWorker.js';
import {
  MacroAndLateralMarketWorker,
  registerMacroLateralTool,
  FactorSeriesWindow,
  FactorEfficacyLedger,
  evaluateDynamicGrowthDriver
} from '../../src/agents/workers/macroLateralWorker.js';
import {
  GovtAndStatutoryWorker,
  registerGovtStatutoryTool
} from '../../src/agents/workers/govtStatutoryWorker.js';
import {
  MediaAndChatterWorker,
  registerMediaChatterTool
} from '../../src/agents/workers/mediaChatterWorker.js';
import {
  RedTeamAndConflictWorker,
  registerRedTeamTool
} from '../../src/agents/workers/redTeamWorker.js';
import {
  ContextRoutingStateMachine,
  ContextRoutingDagInput,
  validateDagAcyclicity,
  DagTaskNode
} from '../../src/agents/scheduler/contextRoutingStateMachine.js';
import { FormulaRegistry } from '../../src/research/formulaRegistry.js';
import {
  BitemporalRestatementEngine,
  BitemporalDecisionRecord
} from '../../src/agents/m6AgentFramework.js';
import { SiloCandidateInput, GroupSimulationConfig } from '../../src/research/m5SiloAndGroupSimulator.js';

describe('SUITE-29: Gate M6.7 Stage 7 Context DAG Orchestrator & End-to-End Capital Gate', () => {
  let server: McpServerAdapter;
  let runLedger: McpRunLedger;
  let broker: McpCapabilityBroker;
  let scheduler: ContextRoutingStateMachine;
  let formulaRegistry: FormulaRegistry;

  const TASK_ID = 'task:dag:stage7:verification';
  const CANDIDATE_ID = 'cand:ss304:16-25mm:pack-10';
  const SKU_ID = 'prod:din3017:ss304:16-25mm:pack-10';
  const REF_TIME = '2026-10-18T00:00:00.000Z';

  beforeEach(() => {
    server = new McpServerAdapter();
    registerSourceCaptureTool(server);
    registerMacroLateralTool(server);
    registerGovtStatutoryTool(server);
    registerMediaChatterTool(server);
    registerRedTeamTool(server);

    runLedger = new McpRunLedger();
    broker = new McpCapabilityBroker(server, runLedger);
    scheduler = new ContextRoutingStateMachine({ broker });
    formulaRegistry = new FormulaRegistry();
    BitemporalRestatementEngine.clearStoreForTesting();
  });

  // --------------------------------------------------------------------------
  // Assertion 1: MCP-DAG-BOUNDED-PARALLEL-JITTER-INVARIANCE-001
  // --------------------------------------------------------------------------
  it('MCP-DAG-BOUNDED-PARALLEL-JITTER-INVARIANCE-001: barrier sorting produces bit-for-bit identical results under async jitter', async () => {
    const baseInput: ContextRoutingDagInput = {
      task_id: `${TASK_ID}:jitter-test`,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      target_catalog_url: 'https://catalog.howrah-industrial.com/din3017-ss304-16-25-p10',
      reference_time_utc: REF_TIME,
      pack_mass_grams: 140,
      hsn_code: '73269099',
      is_msme_supplier: true,
      has_written_msme_agreement: true,
      assumed_dpo_days: 45,
      inbound_freight_subunits: 45000n,
      packaging_kitting_subunits: 32000n,
      customs_inspection_subunits: 0n,
      raw_source_html: `
        <div id="catalog-listing" data-sku="${SKU_ID}">
          <span class="product-title">DIN 3017 SS304 Hose Clamp 16-25mm Pack of 10</span>
          <span class="unit-price" data-price="1250000">₹ 125.00 / Pack</span>
          <span class="supplier-moq" data-moq="500">MOQ: 500 Packs</span>
        </div>
      `
    };

    // Run 1: SourceCapture delayed by 25ms
    const run1 = await scheduler.runDagPipeline({
      ...baseInput,
      simulate_pass1_delays_ms: { source_capture_ms: 25, macro_ms: 0, statutory_ms: 0 }
    });

    // Run 2: Macro delayed by 25ms (fresh run to compare parallel jitter vs barrier sorting)
    scheduler.clearIdempotencyStore();
    const run2 = await scheduler.runDagPipeline({
      ...baseInput,
      simulate_pass1_delays_ms: { source_capture_ms: 0, macro_ms: 25, statutory_ms: 0 }
    });

    expect(run1.run_status).toBe('SUCCESS');
    expect(run2.run_status).toBe('SUCCESS');

    // Canonical barrier sorting ensures identical node order
    const nodes1 = run1.execution_plan.nodes.map((n) => n.node_id);
    const nodes2 = run2.execution_plan.nodes.map((n) => n.node_id);
    expect(nodes1).toEqual(nodes2);


    // Bit-for-bit identical RFC 8785 JCS telemetry digests
    expect(run1.telemetry_digest_sha256).toBe(run2.telemetry_digest_sha256);
    expect(run1.telemetry_digest_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalizeJCS(sanitizeForJcs(run1))).toBe(canonicalizeJCS(sanitizeForJcs(run2)));
  });

  // --------------------------------------------------------------------------
  // Assertion 2: MCP-DAG-COMPLEMENTARY-AND-SUPPLEMENTARY-COOPERATION-002
  // --------------------------------------------------------------------------
  it('MCP-DAG-COMPLEMENTARY-AND-SUPPLEMENTARY-COOPERATION-002: anomalous ₹119 quote triggers Pass 2 & Pass 3 red-team block', async () => {
    const pipelineInput: ContextRoutingDagInput = {
      task_id: `${TASK_ID}:anomalous-quote`,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      target_catalog_url: 'https://catalog.howrah-industrial.com/din3017-ss304-16-25-p10',
      secondary_catalog_url: 'https://dir.indiamart.com/impcat/hose-clamp-ss304.html',
      reference_time_utc: REF_TIME,
      pack_mass_grams: 140,
      hsn_code: '73269099',
      inbound_freight_subunits: 45000n,
      packaging_kitting_subunits: 32000n,
      // Anomalous primary quote of ₹11.90 / pack (119000 subunits)
      raw_source_html: `
        <div id="catalog-listing" data-sku="${SKU_ID}">
          <span class="unit-price" data-price="119000">₹ 11.90 / Pack</span>
          <span class="supplier-moq" data-moq="500">MOQ: 500 Packs</span>
        </div>
      `,
      // Secondary supplier quotes ₹32.00 / pack (320000 subunits)
      raw_secondary_html: `
        <div id="indiamart-tier-pricing">
          <span class="price" data-price="320000">₹ 32.00 / Pack</span>
          <span class="supplier-moq" data-moq="100">MOQ: 100 Packs</span>
          <span id="freight-cost" data-freight="45000">₹ 4.50</span>
        </div>
      `
    };

    const result = await scheduler.runDagPipeline(pipelineInput);

    // Dynamic activation of Pass 2
    expect(result.pass2.secondary_source_capture).toBeDefined();
    expect(result.pass2.joined_results.length).toBeGreaterThanOrEqual(1);

    const priceJoin = result.pass2.joined_results.find((j) => j.metric_name === 'raw_material_purchase');
    expect(priceJoin).toBeDefined();
    expect(priceJoin!.status).toBe('CONFLICT');

    // Pass 3 Red Team blocks allocation
    expect(result.pass3.final_disposition).toBe('HOLD_BLOCKED_BY_RED_TEAM');

    // Pass 4 enforces capital gate hold
    expect(result.run_status).toBe('BLOCKED_BY_POLICY');
    expect(result.pass4).toBeDefined();
    expect(result.pass4!.decision).toBe('DO_NOT_ALLOCATE_CAPITAL');
    expect(result.pass4!.blocking_reason).toBe('E-DAG-RED-TEAM-BLOCKED');
    expect(result.pass4!.execution_mode).toBe('HOLD_NO_ALLOCATION');
  });

  // --------------------------------------------------------------------------
  // Assertion 3: MCP-DAG-VIABLE-CORROBORATED-E2E-OPTIMIZATION-003
  // --------------------------------------------------------------------------
  it('MCP-DAG-VIABLE-CORROBORATED-E2E-OPTIMIZATION-003: corroborated tiered quote executes Pass 4 batch optimization at 399.41% RoWC', async () => {
    // Corroborated IndiaMART tiered slabs:
    // 100-249 @ ₹131.0000 (1310000 subunits)
    // 250-499 @ ₹128.5000 (1285000 subunits)
    // 500+    @ ₹125.0000 (1250000 subunits)
    const observedTiers: readonly PriceBracketTier[] = [
      { min_qty: 100, max_qty: 249, unit_price_subunits: '1310000' },
      { min_qty: 250, max_qty: 499, unit_price_subunits: '1285000' },
      { min_qty: 500, max_qty: null, unit_price_subunits: '1250000' }
    ];

    // Growth window with sustained structural expansion
    const growthWindow: FactorSeriesWindow = {
      factor_id: 'FACTOR-PLUMBING-CAPEX-SURGE',
      opportunity_ccc_days: 35,
      estimated_half_life_days: 45,
      observations: [
        { timestamp_utc: '2026-09-01T00:00:00.000Z', value_bigint: 10000n },
        { timestamp_utc: '2026-09-10T00:00:00.000Z', value_bigint: 10400n },
        { timestamp_utc: '2026-09-20T00:00:00.000Z', value_bigint: 10800n },
        { timestamp_utc: '2026-10-01T00:00:00.000Z', value_bigint: 11200n },
        { timestamp_utc: '2026-10-18T00:00:00.000Z', value_bigint: 11600n }
      ]
    };

    // Factor Efficacy Ledger with 4 validated observations
    const efficacyLedger = new FactorEfficacyLedger();
    for (let i = 1; i <= 4; i++) {
      efficacyLedger.recordEmpiricalOutcome('FACTOR-PLUMBING-CAPEX-SURGE', {
        cycle_id: `cycle-00${i}`,
        predicted_impact_bps: 1600n,
        realized_impact_bps: 1550n,
        recorded_at_utc: `2026-0${i + 5}-01T00:00:00.000Z`
      });
    }

    const input: ContextRoutingDagInput = {
      task_id: `${TASK_ID}:viable-e2e`,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      target_catalog_url: 'https://catalog.howrah-industrial.com/din3017-ss304-16-25-p10',
      reference_time_utc: REF_TIME,
      pack_mass_grams: 140,
      hsn_code: '73269099',
      is_msme_supplier: true,
      has_written_msme_agreement: true,
      assumed_dpo_days: 45,
      inbound_freight_subunits: 45000n,
      packaging_kitting_subunits: 32000n,
      customs_inspection_subunits: 0n,
      observed_tiers: observedTiers,
      growth_window: growthWindow,
      formula_registry: formulaRegistry,
      factor_efficacy_ledger: efficacyLedger,
      target_batch_qty: 500,
      inbound_freight_and_packaging_subunits: 132100n, // ₹13.2100
      treasury_budget_subunits: 1500000000n, // ₹150,000.0000
      max_concentration_bps: 5000n, // 50.00% (cap = ₹75,000 covers ₹69,105 outlay)
      gross_selling_price_subunits: 2540500n, // ₹254.0500
      total_marketplace_fees_subunits: 397500n, // ₹39.7500
      raw_source_html: `
        <div id="catalog-listing" data-sku="${SKU_ID}">
          <span class="unit-price" data-price="1250000">₹ 125.00 / Pack</span>
          <span class="supplier-moq" data-moq="500">MOQ: 500 Packs</span>
        </div>
      `
    };

    const result = await scheduler.runDagPipeline(input);

    expect(result.run_status).toBe('SUCCESS');
    expect(result.pass3.final_disposition).toBe('ELIGIBLE_FOR_HUMAN_REVIEW');

    // Pass 4 Execution Verification
    expect(result.pass4).toBeDefined();
    expect(result.pass4!.decision).toBe('ALLOCATE_PAPER_SIMULATION');
    expect(result.pass4!.execution_mode).toBe('PAPER_SIMULATION');
    expect(result.pass4!.batch_optimization).toBeDefined();

    const opt = result.pass4!.batch_optimization!;
    expect(opt.optimal_batch_quantity).toBe(500);
    expect(opt.selected_tier.unit_price_subunits).toBe('1250000'); // ₹125.0000 EXW
    expect(opt.unit_landed_cost_subunits).toBe(1382100n); // ₹138.2100 Landed
    expect(opt.annualized_rowc_bps).toBe(39941); // 399.41% exact RoWC

    // Factor credibility and regime verification
    expect(result.pass4!.driver_evaluation?.regime).toBe('SUSTAINED_STRUCTURAL_SIGNAL');
    expect(result.pass4!.factor_credibility?.credibility).toBe('EMPIRICALLY_VALIDATED_DRIVER');

    // Bitemporal storage verification
    expect(result.pass4!.bitemporal_record_id).toBeDefined();
    const storedRecord = BitemporalRestatementEngine.getStoredRecord(result.pass4!.bitemporal_record_id!);
    expect(storedRecord).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Assertion 4: MCP-DAG-TACTICAL-DECAY-AND-REFUTED-FACTOR-BLOCK-004
  // --------------------------------------------------------------------------
  it('MCP-DAG-TACTICAL-DECAY-AND-REFUTED-FACTOR-BLOCK-004: blocks capital on tactical edge decay and refuted factor noise', async () => {
    const observedTiers: readonly PriceBracketTier[] = [
      { min_qty: 100, max_qty: null, unit_price_subunits: '1250000' }
    ];

    // Case A: 10-day half-life vs 35-day CCC -> E-MLW-EDGE-DECAYS-BEFORE-CASH-RECOVERY
    const tacticalDecayWindow: FactorSeriesWindow = {
      factor_id: 'FACTOR-AMAZON-STOCKOUT-SPIKE',
      opportunity_ccc_days: 35,
      estimated_half_life_days: 10,
      observations: [
        { timestamp_utc: '2026-10-01T00:00:00.000Z', value_bigint: 1000n },
        { timestamp_utc: '2026-10-05T00:00:00.000Z', value_bigint: 5000n },
        { timestamp_utc: '2026-10-08T00:00:00.000Z', value_bigint: 2000n }
      ]
    };

    const caseAInput: ContextRoutingDagInput = {
      task_id: `${TASK_ID}:tactical-decay`,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      target_catalog_url: 'https://catalog.howrah-industrial.com/din3017-ss304-16-25-p10',
      reference_time_utc: REF_TIME,
      pack_mass_grams: 140,
      hsn_code: '73269099',
      is_msme_supplier: true,
      has_written_msme_agreement: true,
      assumed_dpo_days: 45,
      inbound_freight_subunits: 45000n,
      packaging_kitting_subunits: 32000n,
      customs_inspection_subunits: 0n,
      observed_tiers: observedTiers,
      growth_window: tacticalDecayWindow,
      formula_registry: formulaRegistry,
      raw_source_html: `
        <div id="catalog-listing" data-sku="${SKU_ID}">
          <span class="unit-price" data-price="1250000">₹ 125.00 / Pack</span>
        </div>
      `
    };

    const resultA = await scheduler.runDagPipeline(caseAInput);
    expect(resultA.run_status).toBe('BLOCKED_BY_POLICY');
    expect(resultA.pass4!.decision).toBe('DO_NOT_ALLOCATE_CAPITAL');
    expect(resultA.pass4!.blocking_reason).toBe('E-MLW-EDGE-DECAYS-BEFORE-CASH-RECOVERY');

    // Case B: Empirically Refuted Noise
    const refutedLedger = new FactorEfficacyLedger();
    for (let i = 1; i <= 4; i++) {
      refutedLedger.recordEmpiricalOutcome('FACTOR-HYPED-SIGNAL', {
        cycle_id: `cycle-err-00${i}`,
        predicted_impact_bps: 2000n,
        realized_impact_bps: 0n, // repeated complete misses
        recorded_at_utc: `2026-0${i + 5}-01T00:00:00.000Z`
      });
    }

    const refutedWindow: FactorSeriesWindow = {
      factor_id: 'FACTOR-HYPED-SIGNAL',
      opportunity_ccc_days: 10,
      estimated_half_life_days: 60,
      observations: [
        { timestamp_utc: '2026-10-01T00:00:00.000Z', value_bigint: 1000n },
        { timestamp_utc: '2026-10-18T00:00:00.000Z', value_bigint: 1500n }
      ]
    };

    const caseBInput: ContextRoutingDagInput = {
      ...caseAInput,
      task_id: `${TASK_ID}:refuted-factor`,
      growth_window: refutedWindow,
      factor_efficacy_ledger: refutedLedger
    };

    const resultB = await scheduler.runDagPipeline(caseBInput);
    expect(resultB.run_status).toBe('BLOCKED_BY_POLICY');
    expect(resultB.pass4!.decision).toBe('DO_NOT_ALLOCATE_CAPITAL');
    expect(resultB.pass4!.blocking_reason).toBe('E-DAG-REFUTED-GROWTH-DRIVER');
  });

  // --------------------------------------------------------------------------
  // Assertion 5: MCP-DAG-PROVIDER-TIMEOUT-DEGRADED-HOLD-005
  // --------------------------------------------------------------------------
  it('MCP-DAG-PROVIDER-TIMEOUT-DEGRADED-HOLD-005: provider failure enters PARTIAL_DEGRADED_HOLD preserving prior t0 record', async () => {
    // 1. Establish baseline t0 decision record in Bitemporal store
    const priorCandidate: SiloCandidateInput = {
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      diameter: '16-25mm',
      pack_size: 10,
      title: 'DIN 3017 SS304 Clamps',
      moq: 100,
      gross_selling_price_subunits: 3800000n,
      raw_material_purchase_subunits: 1250000n,
      inbound_freight_subunits: 45000n,
      packaging_kitting_subunits: 32000n
    };

    const priorConfig: GroupSimulationConfig = {
      treasury_budget_subunits: 500000000n,
      max_single_candidate_concentration_bps: 5000n,
      tbill_yield_bps: 650n,
      nifty_liquid_yield_bps: 680n
    };

    const t0RecordId = `bitemp:prior:${CANDIDATE_ID}`;
    const t0Record = BitemporalRestatementEngine.recordDecisionAtT0(
      t0RecordId,
      REF_TIME,
      [priorCandidate],
      priorConfig
    );
    const priorDigest = t0Record.record_digest_sha256;

    // 2. Execute DAG with simulated provider failure in Pass 1 Macro Worker
    const degradedInput: ContextRoutingDagInput = {
      task_id: `${TASK_ID}:degraded-run`,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      target_catalog_url: 'https://catalog.howrah-industrial.com/din3017-ss304-16-25-p10',
      reference_time_utc: REF_TIME,
      fail_macro_series: true,
      raw_source_html: `
        <div id="catalog-listing" data-sku="${SKU_ID}">
          <span class="unit-price" data-price="1250000">₹ 125.00 / Pack</span>
        </div>
      `
    };

    const degradedResult = await scheduler.runDagPipeline(degradedInput);

    expect(degradedResult.run_status).toBe('PARTIAL_DEGRADED_HOLD');
    expect(degradedResult.pass4).toBeDefined();
    expect(degradedResult.pass4!.decision).toBe('DO_NOT_ALLOCATE_CAPITAL');
    expect(degradedResult.pass4!.blocking_reason).toBe('E-DAG-DEGRADED-PROVIDER-HOLD');

    // 3. Verify prior t0 bitemporal record remains pristine and unmutated
    const fetchedRecord = BitemporalRestatementEngine.getStoredRecord(t0RecordId);
    expect(fetchedRecord).toBeDefined();
    expect(fetchedRecord!.record_digest_sha256).toBe(priorDigest);
  });

  // --------------------------------------------------------------------------
  // Assertion 6: MCP-DAG-IDEMPOTENT-RETRY-DEDUPLICATION-006
  // --------------------------------------------------------------------------
  it('MCP-DAG-IDEMPOTENT-RETRY-DEDUPLICATION-006: deduplicates replayed tasks and preserves quota', async () => {
    const fixedIdempotencyKey = 'idem-task-key-stage7-verified';

    const input: ContextRoutingDagInput = {
      task_id: `${TASK_ID}:dedup-run`,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      target_catalog_url: 'https://catalog.howrah-industrial.com/din3017-ss304-16-25-p10',
      reference_time_utc: REF_TIME,
      pack_mass_grams: 140,
      hsn_code: '73269099',
      is_msme_supplier: true,
      has_written_msme_agreement: true,
      assumed_dpo_days: 45,
      inbound_freight_subunits: 45000n,
      packaging_kitting_subunits: 32000n,
      customs_inspection_subunits: 0n,
      idempotency_key: fixedIdempotencyKey,
      raw_source_html: `
        <div id="catalog-listing" data-sku="${SKU_ID}">
          <span class="unit-price" data-price="320000">₹ 32.00 / Pack</span>
        </div>
      `
    };

    // First invocation: executes worker and populates store
    const run1 = await scheduler.runDagPipeline(input);
    const sourceNode1 = run1.execution_plan.nodes.find((n) => n.node_id === 'node:pass1:source-capture');
    expect(sourceNode1).toBeDefined();
    expect(sourceNode1!.status).toBe('COMPLETED');
    expect(scheduler.getIdempotencyStoreSize()).toBeGreaterThanOrEqual(1);

    const initialToolEvents = runLedger.getEvents().filter((e) => e.worker_id === SourceCaptureWorker.WORKER_ID);
    const initialCount = initialToolEvents.length;

    // Second invocation: replayed task deduplicates
    const run2 = await scheduler.runDagPipeline(input);
    const sourceNode2 = run2.execution_plan.nodes.find((n) => n.node_id === 'node:pass1:source-capture');
    expect(sourceNode2).toBeDefined();
    expect(sourceNode2!.status).toBe('DEDUPLICATED_REPLAY');

    // Proves MCP broker did not consume additional requests
    const afterToolEvents = runLedger.getEvents().filter((e) => e.worker_id === SourceCaptureWorker.WORKER_ID);
    expect(afterToolEvents.length).toBe(initialCount);
  });

  // --------------------------------------------------------------------------
  // Assertion 7: MCP-DAG-BITEMPORAL-LINEAGE-REPLAY-007
  // --------------------------------------------------------------------------
  it('MCP-DAG-BITEMPORAL-LINEAGE-REPLAY-007: reconstructs t0-to-t1 restatement lineage without mutating historical record', async () => {
    const observedTiers: readonly PriceBracketTier[] = [
      { min_qty: 100, max_qty: null, unit_price_subunits: '1250000' }
    ];

    const t0 = '2026-10-18T00:00:00.000Z';
    const t1 = '2026-10-18T06:00:00.000Z';

    const inputT0: ContextRoutingDagInput = {
      task_id: `${TASK_ID}:lineage-t0`,
      candidate_id: CANDIDATE_ID,
      sku_id: SKU_ID,
      target_catalog_url: 'https://catalog.howrah-industrial.com/din3017-ss304-16-25-p10',
      reference_time_utc: t0,
      pack_mass_grams: 140,
      hsn_code: '73269099',
      is_msme_supplier: true,
      has_written_msme_agreement: true,
      assumed_dpo_days: 45,
      inbound_freight_subunits: 45000n,
      packaging_kitting_subunits: 32000n,
      customs_inspection_subunits: 0n,
      observed_tiers: observedTiers,
      gross_selling_price_subunits: 3800000n,
      raw_source_html: `
        <div id="catalog-listing" data-sku="${SKU_ID}">
          <span class="unit-price" data-price="1250000">₹ 125.00 / Pack</span>
        </div>
      `
    };

    const resT0 = await scheduler.runDagPipeline(inputT0);
    expect(resT0.run_status).toBe('SUCCESS');
    expect(resT0.pass4?.bitemporal_record_id).toBeDefined();

    const t0Record = BitemporalRestatementEngine.getStoredRecord(resT0.pass4!.bitemporal_record_id!)!;
    expect(t0Record).toBeDefined();
    const t0Digest = t0Record.record_digest_sha256;

    // At t1: restate with increased raw material cost (₹145.0000)
    const updatedCandidates: SiloCandidateInput[] = [
      {
        ...t0Record.candidate_inputs[0],
        raw_material_purchase_subunits: 1450000n
      }
    ];

    const restatementReport = BitemporalRestatementEngine.reconcileAndRestateDecision(
      t0Record,
      t1,
      updatedCandidates
    );

    expect(restatementReport.original_decision_id).toBe(t0Record.decision_id);
    expect(restatementReport.t1_restatement_time_utc).toBe(t1);
    expect(restatementReport.input_deltas[`${CANDIDATE_ID}:raw_material`]).toBeDefined();
    expect(restatementReport.input_deltas[`${CANDIDATE_ID}:raw_material`].t0_value).toBe('1250000');
    expect(restatementReport.input_deltas[`${CANDIDATE_ID}:raw_material`].t1_value).toBe('1450000');

    // Verify original t0 record was never altered or rewritten
    const unchangedT0 = BitemporalRestatementEngine.getStoredRecord(resT0.pass4!.bitemporal_record_id!)!;
    expect(unchangedT0.record_digest_sha256).toBe(t0Digest);
  });

  // --------------------------------------------------------------------------
  // Assertion 8: MCP-DAG-CYCLE-DETECTION-AND-PURE-BIGINT-HALFLIFE-008
  // --------------------------------------------------------------------------
  it('MCP-DAG-CYCLE-DETECTION-AND-PURE-BIGINT-HALFLIFE-008: detects cycles and computes MLW-01 pure-BigInt half-life', () => {
    // 1. Cycle detection in execution plan
    const cyclicNodes: DagTaskNode[] = [
      {
        node_id: 'node:A',
        pass_number: 1,
        worker_id: 'worker:A',
        depends_on_node_ids: ['node:B'],
        idempotency_key: 'key:A',
        status: 'PENDING'
      },
      {
        node_id: 'node:B',
        pass_number: 1,
        worker_id: 'worker:B',
        depends_on_node_ids: ['node:A'],
        idempotency_key: 'key:B',
        status: 'PENDING'
      }
    ];

    expect(() => validateDagAcyclicity(cyclicNodes)).toThrow(/E-DAG-CYCLE-DETECTED/);

    // 2. MLW-01 Pure BigInt Half-Life Math on values > Number.MAX_SAFE_INTEGER
    // MAX_SAFE_INTEGER = 9,007,199,254,740,991
    const hugeBase = 10_000_000_000_000_000_000n; // 10^19 subunits
    const hugePeak = 16_000_000_000_000_000_000n;
    const hugeDecay = 13_000_000_000_000_000_000n;

    const largeWindow: FactorSeriesWindow = {
      factor_id: 'FACTOR-HUGE-SUBUNIT-VOLUME',
      opportunity_ccc_days: 15,
      observations: [
        { timestamp_utc: '2026-10-01T00:00:00.000Z', value_bigint: hugeBase },
        { timestamp_utc: '2026-10-10T00:00:00.000Z', value_bigint: hugePeak },
        { timestamp_utc: '2026-10-18T00:00:00.000Z', value_bigint: hugeDecay }
      ]
    };

    const evalResult = evaluateDynamicGrowthDriver(largeWindow, formulaRegistry);
    expect(evalResult.estimated_half_life_days).toBeGreaterThan(0);
    expect(Number.isFinite(evalResult.estimated_half_life_days)).toBe(true);
    expect(evalResult.net_change_bps).toBeGreaterThan(0n);
  });
});
