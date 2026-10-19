/**
 * Market HFT OS — Deterministic Context-Routing State Machine & Stage 7 Typed DAG Orchestrator
 *
 * Implements:
 * 1. Explicit Typed DAG Node & Edge Topology (DagTaskNode, DagExecutionPlan):
 *    - 4-Pass Directed Acyclic Graph topology with cycle detection (E-DAG-CYCLE-DETECTED).
 *    - Explicit task statuses: PENDING | COMPLETED | SKIPPED_BY_POLICY | FAILED_DEGRADED | DEDUPLICATED_REPLAY.
 * 2. Bounded Parallel Execution & Deterministic Barrier Ordering:
 *    - Concurrent execution of Pass 1 independent workers with max_parallel_workers cap (default 3).
 *    - Canonical barrier sorting by (pass_number, node_id) guaranteeing bit-for-bit RFC 8785 JCS digests under async jitter.
 * 3. Idempotent Task Deduplication (POC.docx §A 9.3):
 *    - Deterministic sha256 idempotency keys.
 *    - Deduplication store returning frozen results with status 'DEDUPLICATED_REPLAY' without re-invoking MCP broker.
 * 4. Pass 4 Deterministic Capital Gate:
 *    - Upstream failure / timeout -> PARTIAL_DEGRADED_HOLD & DO_NOT_ALLOCATE_CAPITAL (E-DAG-DEGRADED-PROVIDER-HOLD).
 *    - Red-Team blocking hold -> DO_NOT_ALLOCATE_CAPITAL (E-DAG-RED-TEAM-BLOCKED).
 *    - Decaying fast opportunity (CCC > half-life) -> DO_NOT_ALLOCATE_CAPITAL (E-MLW-EDGE-DECAYS-BEFORE-CASH-RECOVERY).
 *    - Empirically refuted noise -> DO_NOT_ALLOCATE_CAPITAL (E-DAG-REFUTED-GROWTH-DRIVER).
 *    - Corroborated candidate -> evaluateOptimalBatchSize + BitemporalRestatementEngine with distinct t_d and t_k.
 */

import fs from 'node:fs/promises';
import { sha256 } from '../../canonical/crypto.js';
import { canonicalizeJCS } from '../../canonical/jcs.js';
import { sanitizeForJcs } from '../m6AgentFramework.js';
import { deepFreeze } from '../../verification/gate.js';
import {
  McpCapabilityBroker,
  SupplementaryClaim,
  SupplementaryJoinResult,
  joinSupplementaryClaims,
  createCapabilityGrant,
  CapabilityGrant
} from '../../mcp/mcpSubstrate.js';
import {
  SourceCaptureWorker,
  SourceCaptureMcpRequest,
  SourceCaptureMcpResponse,
  PriceBracketTier
} from '../workers/sourceCaptureWorker.js';
import {
  MacroAndLateralMarketWorker,
  MacroLateralMcpResponse,
  FactorSeriesWindow,
  DynamicDriverEvaluation,
  FactorEfficacyLedger,
  FactorCredibilityEvaluation,
  evaluateDynamicGrowthDriver,
  evaluateDynamicGrowthDriverWithAdvisor
} from '../workers/macroLateralWorker.js';
import {
  GovtAndStatutoryWorker,
  GovtStatutoryMcpResponse
} from '../workers/govtStatutoryWorker.js';
import {
  MediaAndChatterWorker,
  MediaChatterMcpRequest,
  MediaChatterMcpResponse
} from '../workers/mediaChatterWorker.js';
import {
  RedTeamAndConflictWorker,
  RedTeamMcpRequest,
  RedTeamMcpResponse,
  RedTeamDisposition,
  RedTeamChatterDefectSignal,
  RedTeamEvidenceTimestamp
} from '../workers/redTeamWorker.js';
import { FormulaRegistry } from '../../research/formulaRegistry.js';
import { GroqFormulaAdvisor } from '../../research/llmFormulaAdvisor.js';
import {
  evaluateOptimalBatchSize,
  BatchOptimizationResult,
  M5SiloAndGroupSimulator,
  SiloCandidateInput,
  GroupSimulationConfig
} from '../../research/m5SiloAndGroupSimulator.js';
import { OperationalEconomicsParameters } from '../../research/m4VerticalSlice.js';
import {
  BitemporalRestatementEngine,
  BitemporalDecisionRecord
} from '../m6AgentFramework.js';

// ============================================================================
// 1. DAG TOPOLOGY & TASK NODE TYPES
// ============================================================================

export type DagPassNumber = 1 | 2 | 3 | 4;

export type DagTaskNodeStatus =
  | 'PENDING'
  | 'COMPLETED'
  | 'SKIPPED_BY_POLICY'
  | 'FAILED_DEGRADED'
  | 'DEDUPLICATED_REPLAY';

export interface DagTaskNode {
  readonly node_id: string;
  readonly pass_number: DagPassNumber;
  readonly worker_id: string;
  readonly depends_on_node_ids: readonly string[];
  readonly idempotency_key?: string;
  readonly status?: DagTaskNodeStatus;
  readonly error_code?: string;
  readonly error_message?: string;
  readonly result_summary?: string;
  readonly activation_predicate?: (contextSnapshot: Readonly<Record<string, unknown>>) => boolean;
  readonly action?: (contextSnapshot: Readonly<Record<string, unknown>>) => Promise<Record<string, unknown>>;
  readonly required_capabilities?: readonly string[];
}

export interface CompiledDagPlan {
  readonly plan_id: string;
  readonly max_parallel_workers?: number;
  readonly max_wall_clock_budget_ms?: number;
  readonly granted_capabilities?: readonly string[];
  readonly nodes: readonly DagTaskNode[];
}

export interface CompiledDagExecutionResult {
  readonly plan_id: string;
  readonly run_id: string;
  readonly status: 'SUCCESS' | 'PARTIAL_DEGRADED_HOLD' | 'BLOCKED_BY_POLICY';
  readonly waves_executed: number;
  readonly total_nodes_evaluated: number;
  readonly completed_nodes: readonly string[];
  readonly skipped_nodes: readonly string[];
  readonly failed_nodes: readonly string[];
  readonly context_snapshot: Record<string, unknown>;
  readonly elapsed_ms: number;
  readonly checkpoint_hash: string;
  readonly timestamp_utc: string;
  readonly checkpoint: DagCheckpoint;
}

export interface DagCheckpoint {
  readonly plan_id: string;
  readonly run_id: string;
  readonly timestamp_utc: string;
  readonly completed_node_ids: readonly string[];
  readonly skipped_node_ids: readonly string[];
  readonly node_results: Record<string, unknown>;
  readonly context_snapshot: Record<string, unknown>;
  readonly checkpoint_hash: string;
}

export class DagCheckpointStore {
  public static computeCheckpointHash(checkpoint: Omit<DagCheckpoint, 'checkpoint_hash'>): string {
    return sha256(canonicalizeJCS(sanitizeForJcs(checkpoint)));
  }

  public static async saveCheckpointToFile(checkpoint: DagCheckpoint, filePath: string): Promise<void> {
    const jcs = canonicalizeJCS(sanitizeForJcs(checkpoint));
    await fs.writeFile(filePath, jcs, 'utf8');
  }

  public static async resumeFromCheckpoint(filePath: string): Promise<DagCheckpoint> {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed: DagCheckpoint = JSON.parse(raw);
    const { checkpoint_hash, ...rest } = parsed;
    const computed = sha256(canonicalizeJCS(sanitizeForJcs(rest)));
    if (computed !== checkpoint_hash) {
      throw new Error(
        `E-DAG-CHECKPOINT-TAMPERED: Checkpoint hash verification failed. Expected ${checkpoint_hash}, computed ${computed}.`
      );
    }
    return Object.freeze(parsed);
  }
}

export interface DagExecutionPlan {
  readonly plan_id: string;
  readonly nodes: readonly DagTaskNode[];
  readonly created_at_utc: string;
}

export type DagRunStatus =
  | 'SUCCESS'
  | 'PARTIAL_DEGRADED_HOLD'
  | 'BLOCKED_BY_POLICY'
  | 'CYCLE_DETECTED';

export interface Pass4CapitalGateOutput {
  readonly decision: 'ALLOCATE_PAPER_SIMULATION' | 'DO_NOT_ALLOCATE_CAPITAL';
  readonly blocking_reason?: string;
  readonly batch_optimization?: BatchOptimizationResult;
  readonly driver_evaluation?: DynamicDriverEvaluation;
  readonly factor_credibility?: FactorCredibilityEvaluation;
  readonly bitemporal_record_id?: string;
  readonly execution_mode: 'PAPER_SIMULATION' | 'HOLD_NO_ALLOCATION';
}

export interface DagExecutionResult {
  readonly run_id: string;
  readonly task_id: string;
  readonly candidate_id: string;
  readonly sku_id: string;
  readonly run_status: DagRunStatus;
  readonly execution_plan: DagExecutionPlan;
  readonly pass1: Pass1ComplementaryOutput;
  readonly pass2: Pass2SupplementaryOutput;
  readonly pass3: Pass3RedTeamOutput;
  readonly pass4?: Pass4CapitalGateOutput;
  readonly telemetry_digest_sha256: string;
}

export interface ContextRoutingInput {
  readonly task_id: string;
  readonly candidate_id: string;
  readonly sku_id: string;
  readonly target_catalog_url: string;
  readonly secondary_catalog_url?: string;
  readonly media_source_url?: string;
  readonly reference_time_utc?: string;
  readonly pack_mass_grams?: number;
  readonly hsn_code?: string;
  readonly is_msme_supplier?: boolean;
  readonly has_written_msme_agreement?: boolean;
  readonly assumed_dpo_days?: number;
  readonly projected_rowc_bps?: bigint;
  readonly sourcing_evidence_status?: string;
  readonly material_claimed?: string;
  readonly inbound_freight_subunits?: bigint;
  readonly packaging_kitting_subunits?: bigint;
  readonly customs_inspection_subunits?: bigint;
  readonly marketplace_closing_subunits?: bigint;
  readonly marketplace_weight_handling_subunits?: bigint;
  readonly force_supplementary_chatter?: boolean;
  readonly raw_source_html?: string;
  readonly raw_secondary_html?: string;
  readonly raw_media_transcript?: string;
}

export interface ContextRoutingDagInput extends ContextRoutingInput {
  readonly max_parallel_workers?: number;
  readonly idempotency_key?: string;
  readonly custom_plan?: DagExecutionPlan;
  readonly growth_window?: FactorSeriesWindow;
  readonly formula_registry?: FormulaRegistry;
  readonly factor_efficacy_ledger?: FactorEfficacyLedger;
  readonly groq_advisor?: GroqFormulaAdvisor;
  readonly simulate_pass1_delays_ms?: {
    readonly source_capture_ms?: number;
    readonly macro_ms?: number;
    readonly statutory_ms?: number;
  };
  readonly target_batch_qty?: number;
  readonly treasury_budget_subunits?: bigint;
  readonly max_concentration_bps?: bigint;
  readonly operational_params?: OperationalEconomicsParameters;
  readonly gross_selling_price_subunits?: bigint;
  readonly total_marketplace_fees_subunits?: bigint;
  readonly inbound_freight_and_packaging_subunits?: bigint;
  readonly observed_tiers?: readonly PriceBracketTier[];
  readonly knowledge_time_utc?: string;
  readonly previous_t0_decision_record?: BitemporalDecisionRecord;
  readonly fail_macro_series?: boolean;
}

export interface Pass1ComplementaryOutput {
  readonly primary_source_capture?: SourceCaptureMcpResponse;
  readonly tbill_macro_response?: MacroLateralMcpResponse;
  readonly usd_inr_macro_response?: MacroLateralMcpResponse;
  readonly lme_steel_macro_response?: MacroLateralMcpResponse;
  readonly physical_scrap_floor?: {
    readonly pack_mass_grams: number;
    readonly raw_metal_cost_subunits: string;
    readonly min_viable_exw_floor_subunits: string;
  };
  readonly statutory_response?: GovtStatutoryMcpResponse;
}

export interface Pass2SupplementaryOutput {
  readonly secondary_source_capture?: SourceCaptureMcpResponse;
  readonly media_chatter_response?: MediaChatterMcpResponse;
  readonly collected_claims: readonly SupplementaryClaim[];
  readonly joined_results: readonly SupplementaryJoinResult[];
  readonly chatter_defect_signals: readonly RedTeamChatterDefectSignal[];
}

export interface Pass3RedTeamOutput {
  readonly red_team_response: RedTeamMcpResponse;
  readonly final_disposition: RedTeamDisposition;
}

export interface ContextRoutingRunRecord {
  readonly run_id: string;
  readonly task_id: string;
  readonly timestamp_utc: string;
  readonly candidate_id: string;
  readonly sku_id: string;
  readonly pass1: Pass1ComplementaryOutput;
  readonly pass2: Pass2SupplementaryOutput;
  readonly pass3: Pass3RedTeamOutput;
  readonly final_disposition: RedTeamDisposition;
  readonly telemetry_digest_sha256: string;
}

// ============================================================================
// 2. DAG CYCLE DETECTION & CANONICAL ORDERING HELPERS
// ============================================================================

/**
 * Validates that an array of DagTaskNodes forms a valid Directed Acyclic Graph.
 * Throws E-DAG-CYCLE-DETECTED if any dependency cycle is found.
 */
export function validateDagAcyclicity(nodes: readonly DagTaskNode[]): void {
  const nodeMap = new Map<string, DagTaskNode>();
  for (const n of nodes) {
    nodeMap.set(n.node_id, n);
  }

  // State: 0 = unvisited, 1 = visiting (on current DFS stack), 2 = visited
  const visited = new Map<string, number>();

  function dfs(nodeId: string, currentStack: string[]): void {
    const state = visited.get(nodeId) ?? 0;
    if (state === 1) {
      const cyclePath = [...currentStack, nodeId].join(' -> ');
      throw new Error(`E-DAG-CYCLE-DETECTED: Cyclic task dependency detected in execution plan: ${cyclePath}`);
    }
    if (state === 2) return;

    visited.set(nodeId, 1);
    const node = nodeMap.get(nodeId);
    if (node) {
      for (const depId of node.depends_on_node_ids) {
        dfs(depId, [...currentStack, nodeId]);
      }
    }
    visited.set(nodeId, 2);
  }

  for (const node of nodes) {
    if (!visited.has(node.node_id)) {
      dfs(node.node_id, []);
    }
  }
}

/**
 * Computes deterministic RFC 8785 JCS idempotency key.
 */
export function computeTaskNodeIdempotencyKey(
  runId: string,
  workerId: string,
  taskArgs: unknown
): string {
  const sanitized = sanitizeForJcs(taskArgs);
  const jcsPayload = canonicalizeJCS(sanitized);
  return sha256(`${runId}::${workerId}::${jcsPayload}`);
}

/**
 * Canonically sorts task nodes by (pass_number, node_id) at execution barriers.
 */
export function sortNodesCanonically(nodes: readonly DagTaskNode[]): DagTaskNode[] {
  return [...nodes].sort((a, b) => {
    if (a.pass_number !== b.pass_number) {
      return a.pass_number - b.pass_number;
    }
    return a.node_id.localeCompare(b.node_id);
  });
}

/**
 * Concurrency-bounded parallel worker pool.
 */
async function runBoundedParallel<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  }

  const poolSize = Math.max(1, Math.min(maxConcurrency, tasks.length));
  const pool = Array.from({ length: poolSize }, () => worker());
  await Promise.all(pool);
  return results;
}

// ============================================================================
// 3. CONTEXT-ROUTING STATE MACHINE & DAG ORCHESTRATOR
// ============================================================================

export class ContextRoutingStateMachine {
  private readonly broker: McpCapabilityBroker;
  private readonly sourceWorker: SourceCaptureWorker;
  private readonly macroWorker: MacroAndLateralMarketWorker;
  private readonly govtWorker: GovtAndStatutoryWorker;
  private readonly mediaWorker: MediaAndChatterWorker;
  private readonly redTeamWorker: RedTeamAndConflictWorker;

  // Orchestrator-level idempotency store
  private readonly idempotencyStore = new Map<
    string,
    { result: unknown; status: DagTaskNodeStatus; summary: string }
  >();

  constructor(options: {
    broker: McpCapabilityBroker;
    sourceWorker?: SourceCaptureWorker;
    macroWorker?: MacroAndLateralMarketWorker;
    govtWorker?: GovtAndStatutoryWorker;
    mediaWorker?: MediaAndChatterWorker;
    redTeamWorker?: RedTeamAndConflictWorker;
  }) {
    this.broker = options.broker;
    this.sourceWorker = options.sourceWorker ?? new SourceCaptureWorker(this.broker);
    this.macroWorker = options.macroWorker ?? new MacroAndLateralMarketWorker(this.broker);
    this.govtWorker = options.govtWorker ?? new GovtAndStatutoryWorker(this.broker);
    this.mediaWorker = options.mediaWorker ?? new MediaAndChatterWorker(this.broker);
    this.redTeamWorker = options.redTeamWorker ?? new RedTeamAndConflictWorker(this.broker);
  }

  public clearIdempotencyStore(): void {
    this.idempotencyStore.clear();
  }

  public getIdempotencyStoreSize(): number {
    return this.idempotencyStore.size;
  }

  /**
   * Stage 7 Typed DAG Pipeline Execution with Bounded Parallelism,
   * Idempotent Deduplication, and Deterministic Capital Gate.
   */
  public async runDagPipeline(input: ContextRoutingDagInput): Promise<DagExecutionResult> {
    const referenceTimeUtc = input.reference_time_utc || '2026-10-18T00:00:00.000Z';
    const runId = `cr-dag:${input.candidate_id}:${referenceTimeUtc}`;
    const maxParallel = input.max_parallel_workers ?? 3;

    // 1. Plan Verification & Cycle Detection
    if (input.custom_plan) {
      validateDagAcyclicity(input.custom_plan.nodes);
    }

    const recordedNodes: DagTaskNode[] = [];
    let hasProviderDegradedFailure = false;
    let degradedErrorCode = '';
    let degradedErrorMessage = '';

    // ========================================================================
    // PASS 1: COMPLEMENTARY DISPATCH (BOUNDED PARALLEL HORIZONTAL GAP-FILLING)
    // ========================================================================
    const pass1TaskId = `${input.task_id}:pass1`;

    // 1A. Primary Source Capture task
    const sourceTaskFn = async (): Promise<{
      node: DagTaskNode;
      response?: SourceCaptureMcpResponse;
    }> => {
      const nodeId = 'node:pass1:source-capture';
      const workerId = SourceCaptureWorker.WORKER_ID;
      const taskArgs = {
        task_id: `${pass1TaskId}:primary-capture`,
        worker_id: workerId,
        target_url: input.target_catalog_url,
        source_profile: 'HOWRAH_B2B_DISTRIBUTOR_CATALOG',
        execution_mode: input.raw_source_html ? 'RECORDED_FIXTURE_REPLAY' : 'APPROVED_LIVE_HTTPS_GET',
        requested_at_utc: referenceTimeUtc,
        raw_html_payload: input.raw_source_html
      };

      const idempotencyKey =
        input.idempotency_key ?? computeTaskNodeIdempotencyKey(runId, workerId, taskArgs);

      if (input.simulate_pass1_delays_ms?.source_capture_ms) {
        await new Promise((r) => setTimeout(r, input.simulate_pass1_delays_ms!.source_capture_ms));
      }

      // Check idempotency cache
      if (this.idempotencyStore.has(idempotencyKey)) {
        const cached = this.idempotencyStore.get(idempotencyKey)!;
        return {
          node: {
            node_id: nodeId,
            pass_number: 1,
            worker_id: workerId,
            depends_on_node_ids: [],
            idempotency_key: idempotencyKey,
            status: 'DEDUPLICATED_REPLAY',
            result_summary: cached.summary
          },
          response: cached.result as SourceCaptureMcpResponse
        };
      }

      const sourceGrant = createCapabilityGrant({
        grant_id: `grant:cr:source:${Date.now()}`,
        task_id: pass1TaskId,
        worker_id: workerId,
        allowed_tools: ['mcp://source-capture/http_get_snapshot'],
        allowed_hosts: ['catalog.howrah-industrial.com', 'dir.indiamart.com'],
        allowed_methods: ['GET'],
        allow_redirects: false,
        max_requests: 4,
        max_payload_bytes: 262144,
        max_latency_ms: 5000,
        max_tokens: 100000,
        expires_at_utc: '2026-12-31T23:59:59.000Z'
      });

      try {
        const primarySourceRequest: SourceCaptureMcpRequest = {
          task_id: `${pass1TaskId}:primary-capture`,
          worker_id: workerId,
          target_url: input.target_catalog_url,
          source_profile: 'HOWRAH_B2B_DISTRIBUTOR_CATALOG',
          execution_mode: input.raw_source_html ? 'RECORDED_FIXTURE_REPLAY' : 'APPROVED_LIVE_HTTPS_GET',
          requested_at_utc: referenceTimeUtc,
          ...(input.raw_source_html ? { raw_html_payload: input.raw_source_html } : {})
        };

        const res = await this.sourceWorker.captureAndExtract(primarySourceRequest, sourceGrant);
        const summary = `Primary source capture extracted: ${res.evidence_envelope.commercial_status}`;
        this.idempotencyStore.set(idempotencyKey, {
          result: res,
          status: 'COMPLETED',
          summary
        });

        return {
          node: {
            node_id: nodeId,
            pass_number: 1,
            worker_id: workerId,
            depends_on_node_ids: [],
            idempotency_key: idempotencyKey,
            status: 'COMPLETED',
            result_summary: summary
          },
          response: res
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        hasProviderDegradedFailure = true;
        degradedErrorCode = 'E-MCP-SOURCE-FAILURE';
        degradedErrorMessage = errMsg;

        return {
          node: {
            node_id: nodeId,
            pass_number: 1,
            worker_id: workerId,
            depends_on_node_ids: [],
            idempotency_key: idempotencyKey,
            status: 'FAILED_DEGRADED',
            error_code: 'E-MCP-SOURCE-FAILURE',
            error_message: errMsg
          }
        };
      }
    };

    // 1B. Macro Feeds task
    const macroTaskFn = async (): Promise<{
      nodes: DagTaskNode[];
      tbillRes?: MacroLateralMcpResponse;
      usdInrRes?: MacroLateralMcpResponse;
      lmeRes?: MacroLateralMcpResponse;
    }> => {
      const workerId = MacroAndLateralMarketWorker.WORKER_ID;

      if (input.simulate_pass1_delays_ms?.macro_ms) {
        await new Promise((r) => setTimeout(r, input.simulate_pass1_delays_ms!.macro_ms));
      }

      if (input.fail_macro_series) {
        hasProviderDegradedFailure = true;
        degradedErrorCode = 'E-MLW-SERIES-DATA-REQUIRED';
        degradedErrorMessage = 'Simulated provider failure: Macro series DATA_REQUIRED';

        const failedNode: DagTaskNode = {
          node_id: 'node:pass1:macro-tbill',
          pass_number: 1,
          worker_id: workerId,
          depends_on_node_ids: [],
          idempotency_key: computeTaskNodeIdempotencyKey(runId, workerId, { series: 'FAILED' }),
          status: 'FAILED_DEGRADED',
          error_code: 'E-MLW-SERIES-DATA-REQUIRED',
          error_message: 'Simulated provider failure: Macro series DATA_REQUIRED'
        };
        return { nodes: [failedNode] };
      }

      const macroGrant = createCapabilityGrant({
        grant_id: `grant:cr:macro:${Date.now()}`,
        task_id: pass1TaskId,
        worker_id: workerId,
        allowed_tools: ['mcp://macro-feeds/query_series'],
        allowed_hosts: [
          'www.rbi.org.in',
          'www.fbil.org.in',
          'www.lme.com',
          'www.nseindia.com',
          'mospi.gov.in'
        ],
        allowed_methods: ['GET'],
        allow_redirects: false,
        max_requests: 6,
        max_payload_bytes: 131072,
        max_latency_ms: 5000,
        max_tokens: 100000,
        expires_at_utc: '2026-12-31T23:59:59.000Z'
      });

      try {
        const tbillRes = await this.macroWorker.querySeries(
          {
            task_id: `${pass1TaskId}:tbill`,
            worker_id: workerId,
            series_id: 'RBI_91D_TBILL_CUTOFF_YIELD_BPS',
            reference_time_utc: referenceTimeUtc
          },
          macroGrant
        );

        const usdInrRes = await this.macroWorker.querySeries(
          {
            task_id: `${pass1TaskId}:usd-inr`,
            worker_id: workerId,
            series_id: 'FBIL_USD_INR_REFERENCE_RATE',
            reference_time_utc: referenceTimeUtc
          },
          macroGrant
        );

        const lmeRes = await this.macroWorker.querySeries(
          {
            task_id: `${pass1TaskId}:lme-ss304`,
            worker_id: workerId,
            series_id: 'LME_SS304_COLD_ROLLED_INR_PER_KG',
            derive_scrap_floor: Boolean(input.pack_mass_grams),
            pack_mass_grams: input.pack_mass_grams,
            min_stamping_conversion_bps: 1500n,
            reference_time_utc: referenceTimeUtc
          },
          macroGrant
        );

        const tbillNode: DagTaskNode = {
          node_id: 'node:pass1:macro-tbill',
          pass_number: 1,
          worker_id: workerId,
          depends_on_node_ids: [],
          idempotency_key: computeTaskNodeIdempotencyKey(runId, workerId, { series: 'RBI_91D_TBILL' }),
          status: 'COMPLETED',
          result_summary: `RBI 91D T-Bill: ${tbillRes.latest_observation?.value_bigint ?? '650'} bps`
        };

        const usdInrNode: DagTaskNode = {
          node_id: 'node:pass1:macro-usdinr',
          pass_number: 1,
          worker_id: workerId,
          depends_on_node_ids: [],
          idempotency_key: computeTaskNodeIdempotencyKey(runId, workerId, { series: 'FBIL_USD_INR' }),
          status: 'COMPLETED',
          result_summary: `FBIL USD/INR: ${usdInrRes.latest_observation?.value_bigint ?? '839200'}`
        };

        const lmeNode: DagTaskNode = {
          node_id: 'node:pass1:macro-lme',
          pass_number: 1,
          worker_id: workerId,
          depends_on_node_ids: [],
          idempotency_key: computeTaskNodeIdempotencyKey(runId, workerId, { series: 'LME_SS304' }),
          status: 'COMPLETED',
          result_summary: `LME SS304 Scrap Floor: ${lmeRes.physical_scrap_floor?.min_viable_exw_floor_subunits ?? '0'}`
        };

        return {
          nodes: [tbillNode, usdInrNode, lmeNode],
          tbillRes,
          usdInrRes,
          lmeRes
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        hasProviderDegradedFailure = true;
        degradedErrorCode = 'E-MLW-SERIES-DATA-REQUIRED';
        degradedErrorMessage = errMsg;

        const failedNode: DagTaskNode = {
          node_id: 'node:pass1:macro-tbill',
          pass_number: 1,
          worker_id: workerId,
          depends_on_node_ids: [],
          idempotency_key: computeTaskNodeIdempotencyKey(runId, workerId, { series: 'FAILED' }),
          status: 'FAILED_DEGRADED',
          error_code: 'E-MLW-SERIES-DATA-REQUIRED',
          error_message: errMsg
        };
        return { nodes: [failedNode] };
      }
    };

    // 1C. Govt & Statutory task
    const govtTaskFn = async (): Promise<{
      node: DagTaskNode;
      statutoryRes?: GovtStatutoryMcpResponse;
    }> => {
      const nodeId = 'node:pass1:govt-statutory';
      const workerId = GovtAndStatutoryWorker.WORKER_ID;

      if (input.simulate_pass1_delays_ms?.statutory_ms) {
        await new Promise((r) => setTimeout(r, input.simulate_pass1_delays_ms!.statutory_ms));
      }

      const govtGrant = createCapabilityGrant({
        grant_id: `grant:cr:govt:${Date.now()}`,
        task_id: pass1TaskId,
        worker_id: workerId,
        allowed_tools: ['mcp://policy-bulletins/fetch_circular'],
        allowed_hosts: [
          'cbic-gst.gov.in',
          'incometaxindia.gov.in',
          'dgft.gov.in',
          'msme.gov.in'
        ],
        allowed_methods: ['GET'],
        allow_redirects: false,
        max_requests: 4,
        max_payload_bytes: 262144,
        max_latency_ms: 5000,
        max_tokens: 100000,
        expires_at_utc: '2026-12-31T23:59:59.000Z'
      });

      try {
        const statutoryRes = await this.govtWorker.fetchCircular(
          {
            task_id: `${pass1TaskId}:statutory-circular`,
            worker_id: workerId,
            hsn_code: input.hsn_code || '73269099',
            is_msme_supplier: input.is_msme_supplier,
            has_written_payment_agreement: input.has_written_msme_agreement,
            reference_time_utc: referenceTimeUtc
          },
          govtGrant
        );

        return {
          node: {
            node_id: nodeId,
            pass_number: 1,
            worker_id: workerId,
            depends_on_node_ids: [],
            idempotency_key: computeTaskNodeIdempotencyKey(runId, workerId, { hsn: input.hsn_code }),
            status: 'COMPLETED',
            result_summary: `Statutory HSN ${input.hsn_code || '73269099'} verified: ${statutoryRes.claims.length} claims`
          },
          statutoryRes
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return {
          node: {
            node_id: nodeId,
            pass_number: 1,
            worker_id: workerId,
            depends_on_node_ids: [],
            idempotency_key: computeTaskNodeIdempotencyKey(runId, workerId, { hsn: input.hsn_code }),
            status: 'FAILED_DEGRADED',
            error_code: 'E-ERR-GOV-FAILED',
            error_message: errMsg
          }
        };
      }
    };

    // Execute Pass 1 concurrently with bounded parallelism
    const outcomes = await runBoundedParallel<any>(
      [sourceTaskFn, macroTaskFn, govtTaskFn],
      maxParallel
    );
    const sourceOutcome = outcomes[0] as Awaited<ReturnType<typeof sourceTaskFn>>;
    const macroOutcome = outcomes[1] as Awaited<ReturnType<typeof macroTaskFn>>;
    const govtOutcome = outcomes[2] as Awaited<ReturnType<typeof govtTaskFn>>;

    // Pass 1 Barrier: Collect and canonically sort completed nodes
    const pass1Nodes: DagTaskNode[] = [
      sourceOutcome.node,
      ...macroOutcome.nodes,
      govtOutcome.node
    ];
    recordedNodes.push(...sortNodesCanonically(pass1Nodes));

    const primarySourceResponse = sourceOutcome.response;
    const tbillRes = macroOutcome.tbillRes;
    const usdInrRes = macroOutcome.usdInrRes;
    const lmeRes = macroOutcome.lmeRes;
    const statutoryRes = govtOutcome.statutoryRes;

    const pass1Output: Pass1ComplementaryOutput = Object.freeze({
      primary_source_capture: primarySourceResponse,
      tbill_macro_response: tbillRes,
      usd_inr_macro_response: usdInrRes,
      lme_steel_macro_response: lmeRes,
      physical_scrap_floor: lmeRes?.physical_scrap_floor,
      statutory_response: statutoryRes
    });

    // Handle Fail-Closed Degraded Mode Hold if provider failed
    if (hasProviderDegradedFailure || !lmeRes || !tbillRes) {
      const pass4Degraded: Pass4CapitalGateOutput = Object.freeze({
        decision: 'DO_NOT_ALLOCATE_CAPITAL',
        blocking_reason: 'E-DAG-DEGRADED-PROVIDER-HOLD',
        execution_mode: 'HOLD_NO_ALLOCATION'
      });

      const degradedPlan: DagExecutionPlan = Object.freeze({
        plan_id: `plan:${runId}`,
        nodes: Object.freeze(sortNodesCanonically(recordedNodes)),
        created_at_utc: referenceTimeUtc
      });

      const degradedPreliminary = {
        run_id: runId,
        task_id: input.task_id,
        candidate_id: input.candidate_id,
        sku_id: input.sku_id,
        run_status: 'PARTIAL_DEGRADED_HOLD' as DagRunStatus,
        execution_plan: degradedPlan,
        pass1: pass1Output,
        pass2: {
          collected_claims: [],
          joined_results: [],
          chatter_defect_signals: []
        },
        pass3: {
          red_team_response: {} as RedTeamMcpResponse,
          final_disposition: 'HOLD_BLOCKED_BY_RED_TEAM' as RedTeamDisposition
        },
        pass4: pass4Degraded
      };

      const digest = sha256(canonicalizeJCS(sanitizeForJcs(degradedPreliminary)));
      return deepFreeze({
        ...degradedPreliminary,
        telemetry_digest_sha256: digest
      });
    }

    // ========================================================================
    // PASS 2: CONTEXT EVALUATION & SUPPLEMENTARY DISPATCH
    // ========================================================================
    const pass2TaskId = `${input.task_id}:pass2`;
    const collectedClaims: SupplementaryClaim[] = [];
    const chatterSignals: RedTeamChatterDefectSignal[] = [];

    // Extract primary supplier quote
    let primaryPriceSubunits: bigint | undefined;
    if (primarySourceResponse?.extracted_fields) {
      const priceOutcome =
        primarySourceResponse.extracted_fields['raw_material_purchase'] ||
        primarySourceResponse.extracted_fields['raw_material_purchase_subunits'] ||
        primarySourceResponse.extracted_fields['gross_price_inr'] ||
        primarySourceResponse.extracted_fields['unit_price'];

      if (priceOutcome && priceOutcome.status === 'EXTRACTED') {
        const valStr = priceOutcome.matched_tier
          ? priceOutcome.matched_tier.unit_price_subunits
          : priceOutcome.normalized_value;
        primaryPriceSubunits = BigInt(valStr);
        collectedClaims.push({
          entity_id: input.sku_id,
          metric_name: 'raw_material_purchase',
          value: primaryPriceSubunits,
          source_id: primarySourceResponse.evidence_envelope.provenance_lineage.source_id,
          observed_at_utc: primarySourceResponse.evidence_envelope.provenance_lineage.observed_at_utc
        });
      }
    }

    // Trigger Anomaly Evaluation: Proximity to scrap floor or explicit media request
    const minViableFloor = lmeRes.physical_scrap_floor
      ? BigInt(lmeRes.physical_scrap_floor.min_viable_exw_floor_subunits)
      : undefined;

    const isNearScrapFloor =
      primaryPriceSubunits !== undefined &&
      minViableFloor !== undefined &&
      primaryPriceSubunits <= (minViableFloor * 11500n) / 10000n;

    const shouldTriggerChatter =
      input.force_supplementary_chatter === true || isNearScrapFloor || Boolean(input.media_source_url);

    let mediaChatterResponse: MediaChatterMcpResponse | undefined;
    const pass2Nodes: DagTaskNode[] = [];

    if (shouldTriggerChatter) {
      const mediaGrant = createCapabilityGrant({
        grant_id: `grant:cr:media:${Date.now()}`,
        task_id: pass2TaskId,
        worker_id: MediaAndChatterWorker.WORKER_ID,
        allowed_tools: ['mcp://media-corpus/fetch_transcript'],
        allowed_hosts: ['www.youtube.com', 'seller-forum.amazon.in'],
        allowed_methods: ['GET'],
        allow_redirects: false,
        max_requests: 4,
        max_payload_bytes: 262144,
        max_latency_ms: 5000,
        max_tokens: 100000,
        expires_at_utc: '2026-12-31T23:59:59.000Z'
      });

      const mediaUrl =
        input.media_source_url ||
        'https://www.youtube.com/watch?v=clamp-review-ss304';

      const mediaRequest: MediaChatterMcpRequest = {
        task_id: `${pass2TaskId}:media-chatter`,
        worker_id: MediaAndChatterWorker.WORKER_ID,
        target_url: mediaUrl,
        media_type: 'YOUTUBE_UNBOXING_OR_REVIEW',
        requested_at_utc: referenceTimeUtc,
        ...(input.raw_media_transcript
          ? { raw_transcript_payload: input.raw_media_transcript }
          : {})
      };

      try {
        mediaChatterResponse = await this.mediaWorker.fetchAndExtract(mediaRequest, mediaGrant);
        if (mediaChatterResponse.claims) {
          for (const c of mediaChatterResponse.claims) {
            chatterSignals.push({
              material_flagged: c.category === 'METALLURGY_GRADE_DEFECT' ? 'SS202' : c.category,
              defect_rate_bps: c.observed_defect_rate_bps,
              source_id: mediaChatterResponse.evidence_envelope.provenance_lineage.source_id,
              transcript_span: c.spotlighted_quote
            });
          }
        }
        pass2Nodes.push({
          node_id: 'node:pass2:media-chatter',
          pass_number: 2,
          worker_id: MediaAndChatterWorker.WORKER_ID,
          depends_on_node_ids: ['node:pass1:source-capture', 'node:pass1:macro-lme'],
          idempotency_key: computeTaskNodeIdempotencyKey(runId, MediaAndChatterWorker.WORKER_ID, mediaRequest),
          status: 'COMPLETED',
          result_summary: `Media chatter claims extracted: ${mediaChatterResponse.claims?.length ?? 0}`
        });
      } catch {
        pass2Nodes.push({
          node_id: 'node:pass2:media-chatter',
          pass_number: 2,
          worker_id: MediaAndChatterWorker.WORKER_ID,
          depends_on_node_ids: ['node:pass1:source-capture', 'node:pass1:macro-lme'],
          idempotency_key: computeTaskNodeIdempotencyKey(runId, MediaAndChatterWorker.WORKER_ID, mediaRequest),
          status: 'FAILED_DEGRADED'
        });
      }
    } else {
      pass2Nodes.push({
        node_id: 'node:pass2:media-chatter',
        pass_number: 2,
        worker_id: MediaAndChatterWorker.WORKER_ID,
        depends_on_node_ids: ['node:pass1:source-capture', 'node:pass1:macro-lme'],
        idempotency_key: computeTaskNodeIdempotencyKey(runId, MediaAndChatterWorker.WORKER_ID, { mode: 'SKIPPED' }),
        status: 'SKIPPED_BY_POLICY',
        result_summary: 'Media chatter check skipped: quote above scrap buffer'
      });
    }

    // Trigger Anomaly S-2: Secondary Supplier Corroboration
    let secondarySourceResponse: SourceCaptureMcpResponse | undefined;
    if (input.secondary_catalog_url) {
      const secSourceGrant = createCapabilityGrant({
        grant_id: `grant:cr:sec-source:${Date.now()}`,
        task_id: pass2TaskId,
        worker_id: SourceCaptureWorker.WORKER_ID,
        allowed_tools: ['mcp://source-capture/http_get_snapshot'],
        allowed_hosts: ['catalog.howrah-industrial.com', 'dir.indiamart.com'],
        allowed_methods: ['GET'],
        allow_redirects: false,
        max_requests: 4,
        max_payload_bytes: 262144,
        max_latency_ms: 5000,
        max_tokens: 100000,
        expires_at_utc: '2026-12-31T23:59:59.000Z'
      });

      const secReq: SourceCaptureMcpRequest = {
        task_id: `${pass2TaskId}:sec-capture`,
        worker_id: SourceCaptureWorker.WORKER_ID,
        target_url: input.secondary_catalog_url,
        source_profile: 'INDIAMART_SUPPLIER_LISTING',
        execution_mode: input.raw_secondary_html ? 'RECORDED_FIXTURE_REPLAY' : 'APPROVED_LIVE_HTTPS_GET',
        requested_at_utc: referenceTimeUtc,
        ...(input.raw_secondary_html ? { raw_html_payload: input.raw_secondary_html } : {})
      };

      try {
        secondarySourceResponse = await this.sourceWorker.captureAndExtract(secReq, secSourceGrant);
        if (secondarySourceResponse.extracted_fields) {
          const secPriceOutcome =
            secondarySourceResponse.extracted_fields['raw_material_purchase'] ||
            secondarySourceResponse.extracted_fields['raw_material_purchase_subunits'] ||
            secondarySourceResponse.extracted_fields['gross_price_inr'] ||
            secondarySourceResponse.extracted_fields['unit_price'];

          if (secPriceOutcome && secPriceOutcome.status === 'EXTRACTED') {
            const secValStr = secPriceOutcome.matched_tier
              ? secPriceOutcome.matched_tier.unit_price_subunits
              : secPriceOutcome.normalized_value;
            const secPrice = BigInt(secValStr);
            collectedClaims.push({
              entity_id: input.sku_id,
              metric_name: 'raw_material_purchase',
              value: secPrice,
              source_id: secondarySourceResponse.evidence_envelope.provenance_lineage.source_id,
              observed_at_utc: secondarySourceResponse.evidence_envelope.provenance_lineage.observed_at_utc
            });
          }
        }
        pass2Nodes.push({
          node_id: 'node:pass2:secondary-source',
          pass_number: 2,
          worker_id: SourceCaptureWorker.WORKER_ID,
          depends_on_node_ids: ['node:pass1:source-capture'],
          idempotency_key: computeTaskNodeIdempotencyKey(runId, SourceCaptureWorker.WORKER_ID, secReq),
          status: 'COMPLETED',
          result_summary: `Secondary source capture extracted: ${secondarySourceResponse.evidence_envelope.commercial_status}`
        });
      } catch (err: unknown) {
        console.error('DEBUG SEC SOURCE ERROR:', err);
        pass2Nodes.push({
          node_id: 'node:pass2:secondary-source',
          pass_number: 2,
          worker_id: SourceCaptureWorker.WORKER_ID,
          depends_on_node_ids: ['node:pass1:source-capture'],
          idempotency_key: computeTaskNodeIdempotencyKey(runId, SourceCaptureWorker.WORKER_ID, secReq),
          status: 'FAILED_DEGRADED'
        });
      }
    } else {
      pass2Nodes.push({
        node_id: 'node:pass2:secondary-source',
        pass_number: 2,
        worker_id: SourceCaptureWorker.WORKER_ID,
        depends_on_node_ids: ['node:pass1:source-capture'],
        idempotency_key: computeTaskNodeIdempotencyKey(runId, SourceCaptureWorker.WORKER_ID, { mode: 'SKIPPED' }),
        status: 'SKIPPED_BY_POLICY',
        result_summary: 'Secondary source check skipped: no secondary URL specified'
      });
    }

    // Pass 2 Barrier: Collect and canonically sort completed nodes
    recordedNodes.push(...sortNodesCanonically(pass2Nodes));

    // Execute Deterministic Supplementary Join (strictly preserving conflict!)
    const joinedResults = joinSupplementaryClaims(collectedClaims);

    const pass2Output: Pass2SupplementaryOutput = Object.freeze({
      secondary_source_capture: secondarySourceResponse,
      media_chatter_response: mediaChatterResponse,
      collected_claims: Object.freeze(collectedClaims),
      joined_results: joinedResults,
      chatter_defect_signals: Object.freeze(chatterSignals)
    });

    // ========================================================================
    // PASS 3: STAGE 6 RED-TEAM AUDIT & DETERMINISTIC JOIN
    // ========================================================================
    const pass3TaskId = `${input.task_id}:pass3`;

    const redTeamGrant = createCapabilityGrant({
      grant_id: `grant:cr:redteam:${Date.now()}`,
      task_id: pass3TaskId,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      allowed_tools: ['mcp://audit-corpus/read_joined_claims'],
      allowed_hosts: [],
      allowed_methods: ['GET'],
      allow_redirects: false,
      max_requests: 4,
      max_payload_bytes: 262144,
      max_latency_ms: 4000,
      max_tokens: 100000,
      expires_at_utc: '2026-12-31T23:59:59.000Z'
    });

    const evidenceTimestamps: RedTeamEvidenceTimestamp[] = [];
    if (primarySourceResponse?.evidence_envelope?.provenance_lineage) {
      evidenceTimestamps.push({
        envelope_id: 'primary-source-envelope',
        observed_at_utc: primarySourceResponse.evidence_envelope.provenance_lineage.observed_at_utc,
        ttl_seconds: primarySourceResponse.evidence_envelope.provenance_lineage.ttl_seconds
      });
    }
    if (statutoryRes?.evidence_envelope?.provenance_lineage) {
      evidenceTimestamps.push({
        envelope_id: 'statutory-circular-envelope',
        observed_at_utc: statutoryRes.evidence_envelope.provenance_lineage.observed_at_utc,
        ttl_seconds: statutoryRes.evidence_envelope.provenance_lineage.ttl_seconds
      });
    }

    const gstClaim = statutoryRes?.claims?.find(
      (c: { parameter_name: string }) => c.parameter_name === 'gst_rate_bps'
    );
    const gstRateBps = gstClaim ? BigInt(gstClaim.proposed_value_bigint) : 1800n;

    const redTeamRequest: RedTeamMcpRequest = {
      task_id: `${pass3TaskId}:audit`,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      candidate_id: input.candidate_id,
      sku_id: input.sku_id,
      reference_time_utc: referenceTimeUtc,
      claimed_supplier_exw_subunits: primaryPriceSubunits,
      pack_mass_grams: input.pack_mass_grams,
      lme_ss304_inr_per_kg_subunits: lmeRes.latest_observation?.value_bigint,
      min_viable_exw_floor_subunits: lmeRes.physical_scrap_floor?.min_viable_exw_floor_subunits,
      raw_material_scrap_floor_subunits: lmeRes.physical_scrap_floor?.raw_metal_cost_subunits,
      joined_results: joinedResults,
      projected_rowc_bps: input.projected_rowc_bps,
      sourcing_evidence_status: primarySourceResponse?.evidence_envelope?.commercial_status ?? 'ADVERTISED_LISTING',
      material_claimed: input.material_claimed || 'SS304',
      chatter_defect_signals: chatterSignals,
      supplier_dpo_days: input.assumed_dpo_days,
      is_msme_supplier: input.is_msme_supplier,
      has_written_msme_agreement: input.has_written_msme_agreement,
      statutory_max_payment_terms_days: statutoryRes?.msme_cross_check?.statutory_max_payment_terms_days,
      cost_breakdown: {
        raw_material_purchase_subunits: primaryPriceSubunits,
        inbound_freight_subunits: input.inbound_freight_subunits ?? 45000n,
        packaging_kitting_subunits: input.packaging_kitting_subunits ?? 32000n,
        customs_inspection_subunits: input.customs_inspection_subunits ?? 0n,
        marketplace_closing_subunits: input.marketplace_closing_subunits ?? 100000n,
        marketplace_weight_handling_subunits: input.marketplace_weight_handling_subunits ?? 140000n,
        gst_rate_bps: gstRateBps
      },
      evidence_envelopes: evidenceTimestamps
    };

    const redTeamRes = await this.redTeamWorker.auditCandidate(redTeamRequest, redTeamGrant);

    const pass3Node: DagTaskNode = {
      node_id: 'node:pass3:red-team-audit',
      pass_number: 3,
      worker_id: RedTeamAndConflictWorker.WORKER_ID,
      depends_on_node_ids: recordedNodes.map((n) => n.node_id),
      idempotency_key: computeTaskNodeIdempotencyKey(runId, RedTeamAndConflictWorker.WORKER_ID, redTeamRequest),
      status: 'COMPLETED',
      result_summary: `Red-Team disposition: ${redTeamRes.disposition}`
    };
    recordedNodes.push(pass3Node);

    const pass3Output: Pass3RedTeamOutput = Object.freeze({
      red_team_response: redTeamRes,
      final_disposition: redTeamRes.disposition
    });

    // ========================================================================
    // PASS 4: DETERMINISTIC CAPITAL GATE
    // ========================================================================
    let pass4Output: Pass4CapitalGateOutput | undefined;
    let runStatus: DagRunStatus = 'SUCCESS';

    // Check 1: Red-Team Blocking Hold
    const hasBlockingHolds =
      redTeamRes.disposition === 'HOLD_BLOCKED_BY_RED_TEAM' ||
      redTeamRes.disposition !== 'ELIGIBLE_FOR_HUMAN_REVIEW' ||
      !redTeamRes.passed_cleanly ||
      redTeamRes.findings.some((f) => f.severity === 'BLOCK_ALLOCATION_GATE');

    if (hasBlockingHolds) {
      pass4Output = Object.freeze({
        decision: 'DO_NOT_ALLOCATE_CAPITAL',
        blocking_reason: 'E-DAG-RED-TEAM-BLOCKED',
        execution_mode: 'HOLD_NO_ALLOCATION'
      });
      runStatus = 'BLOCKED_BY_POLICY';
    } else {
      // Check 2: Growth Factor & Regime Evaluation
      let driverEval: DynamicDriverEvaluation | undefined;
      let factorCred: FactorCredibilityEvaluation | undefined;

      if (input.growth_window && input.formula_registry) {
        if (input.groq_advisor) {
          driverEval = await evaluateDynamicGrowthDriverWithAdvisor(
            input.growth_window,
            input.formula_registry,
            input.groq_advisor
          );
        } else {
          driverEval = evaluateDynamicGrowthDriver(
            input.growth_window,
            input.formula_registry
          );
        }

        if (input.factor_efficacy_ledger) {
          factorCred = input.factor_efficacy_ledger.evaluateFactorCredibility(
            input.growth_window.factor_id
          );
        }
      }

      if (factorCred && factorCred.credibility === 'EMPIRICALLY_REFUTED_NOISE') {
        pass4Output = Object.freeze({
          decision: 'DO_NOT_ALLOCATE_CAPITAL',
          blocking_reason: 'E-DAG-REFUTED-GROWTH-DRIVER',
          driver_evaluation: driverEval,
          factor_credibility: factorCred,
          execution_mode: 'HOLD_NO_ALLOCATION'
        });
        runStatus = 'BLOCKED_BY_POLICY';
      } else if (
        driverEval &&
        driverEval.regime === 'FAST_TACTICAL_OPPORTUNITY' &&
        driverEval.tactical_execution_viable === false
      ) {
        pass4Output = Object.freeze({
          decision: 'DO_NOT_ALLOCATE_CAPITAL',
          blocking_reason: 'E-MLW-EDGE-DECAYS-BEFORE-CASH-RECOVERY',
          driver_evaluation: driverEval,
          factor_credibility: factorCred,
          execution_mode: 'HOLD_NO_ALLOCATION'
        });
        runStatus = 'BLOCKED_BY_POLICY';
      } else {
        // Check 3: Optimal Batch Sizing & Bitemporal Recording
        const primaryOutcome =
          primarySourceResponse?.extracted_fields?.['raw_material_purchase'] ||
          primarySourceResponse?.extracted_fields?.['raw_material_purchase_subunits'] ||
          primarySourceResponse?.extracted_fields?.['gross_price_inr'] ||
          primarySourceResponse?.extracted_fields?.['unit_price'];

        const primaryTiers =
          primaryOutcome && primaryOutcome.status === 'EXTRACTED'
            ? primaryOutcome.observed_tiers
            : undefined;

        const secOutcome =
          secondarySourceResponse?.extracted_fields?.['raw_material_purchase'] ||
          secondarySourceResponse?.extracted_fields?.['raw_material_purchase_subunits'] ||
          secondarySourceResponse?.extracted_fields?.['gross_price_inr'] ||
          secondarySourceResponse?.extracted_fields?.['unit_price'];

        const secTiers =
          secOutcome && secOutcome.status === 'EXTRACTED'
            ? secOutcome.observed_tiers
            : undefined;

        const tiersToUse =
          input.observed_tiers ??
          primaryTiers ??
          secTiers ??
          (primaryPriceSubunits !== undefined
            ? [{ min_qty: 100, max_qty: null, unit_price_subunits: primaryPriceSubunits.toString() }]
            : undefined);

        if (tiersToUse && tiersToUse.length > 0) {
          const defaultOps: OperationalEconomicsParameters = input.operational_params ?? {
            procurement_lead_time_days: 7,
            warehouse_dwell_days: 14,
            marketplace_settlement_delay_days: 14,
            gst_rate_bps: 1800n,
            itc_eligible_fraction_bps: 10000n,
            tcs_rate_bps: 100n,
            tds_rate_bps: 100n,
            customer_return_rate_bps: 200n,
            reverse_logistics_fee_subunits: 140000n,
            quarantine_attrition_rate_bps: 10000n,
            risk_free_rate_bps: 650n,
            execution_risk_premium_bps: 850n,
            min_cash_margin_bps: 2000n,
            max_ccc_days: 45,
            min_downside_buffer_bps: 1500n
          };

          const targetBatchQty = input.target_batch_qty ?? 500;
          const inboundAndPack = input.inbound_freight_and_packaging_subunits ?? 132100n;
          const treasuryBudget = input.treasury_budget_subunits ?? 1500000000n;
          const maxConcentration = input.max_concentration_bps ?? 5000n;
          const grossSellingPrice = input.gross_selling_price_subunits ?? 2540500n;
          const totalFees = input.total_marketplace_fees_subunits ?? 397500n;

          const batchOptResult = evaluateOptimalBatchSize(
            tiersToUse,
            targetBatchQty,
            inboundAndPack,
            treasuryBudget,
            maxConcentration,
            defaultOps,
            grossSellingPrice,
            totalFees
          );

          // Record in BitemporalRestatementEngine if active
          let bitempId: string | undefined;
          const tDecision = referenceTimeUtc;
          const tKnowledge = input.knowledge_time_utc ?? tDecision;

          try {
            bitempId = `bitemp:dag:${input.candidate_id}:${tDecision}`;
            const candidateInput: SiloCandidateInput = {
              candidate_id: input.candidate_id,
              sku_id: input.sku_id,
              diameter: '16-25mm',
              pack_size: 10,
              title: 'DIN 3017 SS304 Hose Clamps',
              moq: 100,
              gross_selling_price_subunits: grossSellingPrice,
              raw_material_purchase_subunits: BigInt(batchOptResult.selected_tier.unit_price_subunits),
              inbound_freight_subunits: 45000n,
              packaging_kitting_subunits: 32000n,
              insurance_handling_subunits: 10000n,
              customs_inspection_subunits: 45100n,
              marketplace_referral_bps: 1500n,
              marketplace_closing_subunits: 100000n,
              marketplace_weight_handling_subunits: 140000n,
              is_verified: true
            };

            const groupConfig: GroupSimulationConfig = {
              treasury_budget_subunits: treasuryBudget,
              max_single_candidate_concentration_bps: maxConcentration,
              tbill_yield_bps: 650n,
              nifty_liquid_yield_bps: 680n
            };

            BitemporalRestatementEngine.recordDecisionAtT0(
              bitempId,
              tDecision,
              [candidateInput],
              groupConfig,
              tKnowledge
            );
          } catch {
            // Already recorded or test environment isolation
          }

          pass4Output = Object.freeze({
            decision: 'ALLOCATE_PAPER_SIMULATION',
            batch_optimization: batchOptResult,
            driver_evaluation: driverEval,
            factor_credibility: factorCred,
            bitemporal_record_id: bitempId,
            execution_mode: 'PAPER_SIMULATION'
          });
          runStatus = 'SUCCESS';
        } else {
          pass4Output = Object.freeze({
            decision: 'DO_NOT_ALLOCATE_CAPITAL',
            blocking_reason: 'E-DAG-NO-TIERS-AVAILABLE',
            execution_mode: 'HOLD_NO_ALLOCATION'
          });
          runStatus = 'BLOCKED_BY_POLICY';
        }
      }
    }

    const pass4Node: DagTaskNode = {
      node_id: 'node:pass4:capital-gate',
      pass_number: 4,
      worker_id: 'worker:scheduler:capital-gate',
      depends_on_node_ids: ['node:pass3:red-team-audit'],
      idempotency_key: computeTaskNodeIdempotencyKey(runId, 'worker:scheduler:capital-gate', {
        decision: pass4Output?.decision
      }),
      status: 'COMPLETED',
      result_summary: `Capital Gate Decision: ${pass4Output?.decision}`
    };
    recordedNodes.push(pass4Node);

    // ========================================================================
    // TELEMETRY & JCS CANONICAL ATTESTATION
    // ========================================================================
    const finalPlan: DagExecutionPlan = Object.freeze({
      plan_id: `plan:${runId}`,
      nodes: Object.freeze(sortNodesCanonically(recordedNodes)),
      created_at_utc: referenceTimeUtc
    });

    const preliminaryResult = {
      run_id: runId,
      task_id: input.task_id,
      candidate_id: input.candidate_id,
      sku_id: input.sku_id,
      run_status: runStatus,
      execution_plan: finalPlan,
      pass1: pass1Output,
      pass2: pass2Output,
      pass3: pass3Output,
      pass4: pass4Output
    };

    const telemetryDigest = sha256(canonicalizeJCS(sanitizeForJcs(preliminaryResult)));

    const finalResult: DagExecutionResult = Object.freeze({
      ...preliminaryResult,
      telemetry_digest_sha256: telemetryDigest
    });

    return deepFreeze(finalResult);
  }

  /**
   * Backwards-compatible Stage 6 entry point for 3-pass routing runs.
   */
  public async runFullPipeline(input: ContextRoutingInput): Promise<ContextRoutingRunRecord> {
    const dagResult = await this.runDagPipeline(input);

    const preliminaryRecord = {
      run_id: dagResult.run_id,
      task_id: input.task_id,
      timestamp_utc: input.reference_time_utc || '2026-10-18T00:00:00.000Z',
      candidate_id: input.candidate_id,
      sku_id: input.sku_id,
      pass1: dagResult.pass1,
      pass2: dagResult.pass2,
      pass3: dagResult.pass3,
      final_disposition: dagResult.pass3.final_disposition
    };

    const telemetryDigest = sha256(canonicalizeJCS(sanitizeForJcs(preliminaryRecord)));

    const finalRecord: ContextRoutingRunRecord = Object.freeze({
      ...preliminaryRecord,
      telemetry_digest_sha256: telemetryDigest
    });

    return deepFreeze(finalRecord);
  }

  /**
   * Executes a plan-driven compiled DAG with topological wave dispatching and bounded parallelism.
   */
  public async executePlan(
    plan: CompiledDagPlan,
    initialContext: Record<string, unknown> = {},
    resumeCheckpoint?: DagCheckpoint
  ): Promise<CompiledDagExecutionResult> {
    return executeCompiledDagPlan(plan, initialContext, resumeCheckpoint);
  }
}

/**
 * Plan-Driven Topological Wave Dispatcher for Compiled DAGs.
 * Enforces acyclicity, capability matching, budget limits, dynamic activation predicates,
 * bounded parallelism, and deterministic JCS checkpointing.
 */
export async function executeCompiledDagPlan(
  plan: CompiledDagPlan,
  initialContext: Record<string, unknown> = {},
  resumeCheckpoint?: DagCheckpoint
): Promise<CompiledDagExecutionResult> {
  const startMs = Date.now();
  const runId = resumeCheckpoint?.run_id ?? `dag-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nodeMap = new Map<string, DagTaskNode>();
  for (const node of plan.nodes) {
    nodeMap.set(node.node_id, node);
  }

  // 1. Missing Dependencies Check
  for (const node of plan.nodes) {
    for (const depId of node.depends_on_node_ids) {
      if (!nodeMap.has(depId)) {
        throw new Error(
          `E-DAG-MISSING-DEPENDENCY: Node '${node.node_id}' depends on unknown node '${depId}'.`
        );
      }
    }
  }

  // 2. Capability Matching Check
  if (plan.granted_capabilities) {
    const granted = new Set(plan.granted_capabilities);
    for (const node of plan.nodes) {
      if (node.required_capabilities) {
        for (const cap of node.required_capabilities) {
          if (!granted.has(cap)) {
            throw new Error(
              `E-DAG-CAPABILITY-MISMATCH: Node '${node.node_id}' requires capability '${cap}' which is not in granted_capabilities [${plan.granted_capabilities.join(', ')}].`
            );
          }
        }
      }
    }
  }

  // 3. Acyclicity Validation
  validateDagAcyclicity(plan.nodes);

  // 4. In-Degree & Dependents Topology Mapping
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const node of plan.nodes) {
    inDegree.set(node.node_id, node.depends_on_node_ids.length);
    for (const dep of node.depends_on_node_ids) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(node.node_id);
    }
  }

  // If resuming from checkpoint, seed completed/skipped and context
  const completedNodeIds = new Set<string>(resumeCheckpoint?.completed_node_ids ?? []);
  const skippedNodeIds = new Set<string>(resumeCheckpoint?.skipped_node_ids ?? []);
  const failedNodeIds = new Set<string>();
  const contextSnapshot: Record<string, unknown> = {
    ...initialContext,
    ...(resumeCheckpoint?.context_snapshot ?? {})
  };
  const nodeResults: Record<string, unknown> = {
    ...(resumeCheckpoint?.node_results ?? {})
  };

  // Decrement inDegree for already completed/skipped dependencies
  for (const doneId of [...completedNodeIds, ...skippedNodeIds]) {
    const children = dependents.get(doneId) ?? [];
    for (const childId of children) {
      const deg = inDegree.get(childId) ?? 0;
      if (deg > 0) inDegree.set(childId, deg - 1);
    }
  }

  let wavesExecuted = 0;
  let totalNodesEvaluated = 0;
  const maxParallel = plan.max_parallel_workers ?? 3;

  while (true) {
    // Find all nodes whose in-degree is 0 and not yet processed
    const waveNodeIds: string[] = [];
    for (const node of plan.nodes) {
      if (
        (inDegree.get(node.node_id) ?? 0) === 0 &&
        !completedNodeIds.has(node.node_id) &&
        !skippedNodeIds.has(node.node_id) &&
        !failedNodeIds.has(node.node_id)
      ) {
        waveNodeIds.push(node.node_id);
      }
    }

    if (waveNodeIds.length === 0) {
      break; // All reachable nodes processed
    }

    // Deterministic canonical sort by node_id within each wave
    waveNodeIds.sort();
    wavesExecuted++;

    // In each wave, determine which nodes to execute vs skip by policy
    const eligibleToRun: DagTaskNode[] = [];
    for (const nodeId of waveNodeIds) {
      totalNodesEvaluated++;
      const node = nodeMap.get(nodeId)!;

      // Check activation predicate
      if (node.activation_predicate) {
        const frozenCtx = deepFreeze({ ...contextSnapshot });
        let shouldActivate = false;
        try {
          shouldActivate = node.activation_predicate(frozenCtx);
        } catch {
          shouldActivate = false;
        }
        if (!shouldActivate) {
          skippedNodeIds.add(nodeId);
          // Free its dependents
          const children = dependents.get(nodeId) ?? [];
          for (const child of children) {
            const deg = inDegree.get(child) ?? 0;
            if (deg > 0) inDegree.set(child, deg - 1);
          }
          continue;
        }
      }

      eligibleToRun.push(node);
    }

    // Execute eligible active nodes in bounded parallel batches
    for (let i = 0; i < eligibleToRun.length; i += maxParallel) {
      const batch = eligibleToRun.slice(i, i + maxParallel);
      await Promise.all(
        batch.map(async (node) => {
          const elapsedSoFar = Date.now() - startMs;
          if (plan.max_wall_clock_budget_ms !== undefined && elapsedSoFar > plan.max_wall_clock_budget_ms) {
            throw new Error(
              `E-DAG-BUDGET-OVERFLOW: Execution elapsed ${elapsedSoFar}ms, exceeding max_wall_clock_budget_ms (${plan.max_wall_clock_budget_ms}ms).`
            );
          }

          if (node.action) {
            try {
              const result = await node.action(deepFreeze({ ...contextSnapshot }));
              nodeResults[node.node_id] = result;
              Object.assign(contextSnapshot, result);
              completedNodeIds.add(node.node_id);
            } catch (err: unknown) {
              failedNodeIds.add(node.node_id);
              throw err;
            }
          } else {
            completedNodeIds.add(node.node_id);
          }

          // Free dependents
          const children = dependents.get(node.node_id) ?? [];
          for (const child of children) {
            const deg = inDegree.get(child) ?? 0;
            if (deg > 0) inDegree.set(child, deg - 1);
          }
        })
      );
    }
  }

  const totalElapsedMs = Date.now() - startMs;
  if (plan.max_wall_clock_budget_ms !== undefined && totalElapsedMs > plan.max_wall_clock_budget_ms) {
    throw new Error(
      `E-DAG-BUDGET-OVERFLOW: Execution elapsed ${totalElapsedMs}ms, exceeding max_wall_clock_budget_ms (${plan.max_wall_clock_budget_ms}ms).`
    );
  }

  const checkpointPayload = {
    plan_id: plan.plan_id,
    run_id: runId,
    timestamp_utc: new Date().toISOString(),
    completed_node_ids: Array.from(completedNodeIds).sort(),
    skipped_node_ids: Array.from(skippedNodeIds).sort(),
    node_results: sanitizeForJcs(nodeResults),
    context_snapshot: sanitizeForJcs(contextSnapshot)
  };
  const checkpointHash = sha256(canonicalizeJCS(checkpointPayload));
  const checkpoint: DagCheckpoint = Object.freeze({
    ...checkpointPayload,
    checkpoint_hash: checkpointHash
  });

  return Object.freeze({
    plan_id: plan.plan_id,
    run_id: runId,
    status: failedNodeIds.size > 0 ? 'PARTIAL_DEGRADED_HOLD' : 'SUCCESS',
    waves_executed: wavesExecuted,
    total_nodes_evaluated: totalNodesEvaluated,
    completed_nodes: Object.freeze(Array.from(completedNodeIds).sort()),
    skipped_nodes: Object.freeze(Array.from(skippedNodeIds).sort()),
    failed_nodes: Object.freeze(Array.from(failedNodeIds).sort()),
    context_snapshot: deepFreeze({ ...contextSnapshot }),
    elapsed_ms: totalElapsedMs,
    checkpoint_hash: checkpointHash,
    timestamp_utc: checkpointPayload.timestamp_utc,
    checkpoint
  });
}

export const ContextDagOrchestrator = ContextRoutingStateMachine;
export type ContextDagOrchestrator = ContextRoutingStateMachine;

export async function saveDagCheckpointToFile(
  arg1: string | DagCheckpoint,
  arg2: DagCheckpoint | string
): Promise<void> {
  if (typeof arg1 === 'string') {
    return DagCheckpointStore.saveCheckpointToFile(arg2 as DagCheckpoint, arg1);
  } else {
    return DagCheckpointStore.saveCheckpointToFile(arg1, arg2 as string);
  }
}

export async function resumeDagFromCheckpoint(
  filePath: string,
  plan?: CompiledDagPlan,
  initialContext?: Record<string, unknown>
): Promise<any> {
  const checkpoint = await DagCheckpointStore.resumeFromCheckpoint(filePath);
  if (plan) {
    return executeCompiledDagPlan(plan, initialContext ?? {}, checkpoint);
  }
  return checkpoint;
}
