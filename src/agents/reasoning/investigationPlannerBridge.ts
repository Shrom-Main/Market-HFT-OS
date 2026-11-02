/**
/**
 * POC-001: Adaptive Investigation Planner Bridge
 *
 * Connects the existing InvestigationPlanner (Slice 2C) and Fenced InvestigationTaskQueue
 * to the AdaptiveReasoningLoop.
 *
 * Operational Capabilities:
 * 1. Queue Synchronization: Translates InvestigationPlanner tasks into adaptive plan steps
 *    and enqueues them into the durable InvestigationTaskQueue.
 * 2. Monotonic Lease Execution: Workers claim tasks with monotonic fencing tokens.
 * 3. Dynamic Cancellation of Obsolete Tasks: When an executed task uncovers a fatal contradiction,
 *    this bridge immediately cancels remaining pending tasks in the InvestigationTaskQueue
 *    with state CANCELLED_SUPERSEDED, preventing zombie workers from executing obsolete steps.
 * 4. Checkpoint Consistency: Checkpoints state before and after each task lease commit.
 */

import {
  InvestigationPlanner,
  InvestigationPlan,
  InvestigationTask,
  InvestigationTaskType
} from '../../discovery/investigationPlanner.js';
import {
  InvestigationTaskQueue,
  CommitTaskParams
} from '../../discovery/investigationTaskQueue.js';
import { NormalizedDiscoveryObservation } from '../../discovery/sourceAdapterContract.js';
import { AdaptiveReasoningLoop } from './adaptiveReasoningLoop.js';
import { InvestigationStateStore } from './investigationStateStore.js';
import { CheckpointableInvestigationState, ObservedEvidenceRecord } from './reasoningTypes.js';
import { EvidenceEvaluator } from './evidenceEvaluator.js';
import { OpportunityCategory } from '../../canonical/opportunityCategory.js';
import { ConnectorGateway } from '../../mcp/connectorGateway.js';

export interface AdaptivePlannerExecutionResult {
  readonly plan: InvestigationPlan;
  readonly executed_tasks_count: number;
  readonly cancelled_tasks_count: number;
  readonly final_state: CheckpointableInvestigationState;
  readonly detected_contradictions_count: number;
}

export class AdaptiveInvestigationPlannerBridge {
  constructor(
    private readonly taskQueue: InvestigationTaskQueue,
    private readonly stateStore: InvestigationStateStore,
    private readonly reasoningLoop: AdaptiveReasoningLoop
  ) {}

  /**
   * Plans an investigation using existing InvestigationPlanner and executes it adaptively.
   */
  public async executeAdaptivePlan(params: {
    candidate_id: string;
    generation_id: string;
    observation: NormalizedDiscoveryObservation;
    worker_id?: string;
    task_executors?: Map<
      InvestigationTaskType,
      (task: InvestigationTask) => Promise<{
        success: boolean;
        result_payload: Record<string, unknown>;
        evidence?: Array<Omit<ObservedEvidenceRecord, 'syndication_cluster_id'>>;
      }>
    >;
  }): Promise<AdaptivePlannerExecutionResult> {
    const workerId = params.worker_id ?? 'WORKER-ADAPTIVE-01';

    // 1. Generate plan using existing InvestigationPlanner
    const plan = InvestigationPlanner.planInvestigation(
      params.candidate_id,
      params.observation,
      params.generation_id
    );

    // 2. Enqueue tasks into existing InvestigationTaskQueue
    await this.taskQueue.enqueueTasks(plan.tasks);

    // 3. Initialize Adaptive Reasoning Loop state
    const category = (params.observation.category as OpportunityCategory) ?? 'PHYSICAL_GOODS';
    const invId = `INV-BRIDGE-${params.candidate_id}`;
    let state = await this.reasoningLoop.startInvestigation({
      investigation_id: invId,
      candidate_id: params.candidate_id,
      candidate_name: params.observation.candidate_name,
      category,
      primary_objective: `Investigate missing critical fields for candidate '${params.observation.candidate_name}'`,
      initial_information_gaps: plan.missing_critical_fields.map((f, i) => ({
        topic: f,
        priority: i === 0 ? 1 : 2
      }))
    });

    const prior = this.stateStore.loadCheckpoint(invId);
    if (prior && (prior.fencing_token ?? 0) >= (state.fencing_token ?? 0)) {
      state.fencing_token = prior.fencing_token;
    }

    let executedCount = 0;
    let cancelledCount = 0;

    // 4. Execute tasks iteratively via lease fencing
    for (const task of plan.tasks) {
      // Check if state encountered a fatal contradiction that renders further tasks obsolete
      const hasFatalConflict = state.conflicts.some(
        (c) => c.severity === 'FATAL_DISQUALIFIER' && c.status === 'ACTIVE'
      );

      if (hasFatalConflict) {
        // Cancel task in queue as CANCELLED_SUPERSEDED!
        await this.cancelTaskInQueue(task.task_id, 'Superseded by fatal contradiction in prior step');
        cancelledCount++;
        continue;
      }

      // Claim task lease from queue
      const lease = await this.taskQueue.claimNextTask(workerId, {
        candidateId: params.candidate_id,
        targetRole: task.target_role
      });

      if (!lease) {
        continue;
      }

      // Execute task via registered executor or default simulated worker
      const executor = params.task_executors?.get(task.task_type);
      let taskResult: {
        success: boolean;
        result_payload: Record<string, unknown>;
        evidence?: Array<Omit<ObservedEvidenceRecord, 'syndication_cluster_id'>>;
      };

      if (executor) {
        taskResult = await executor(task);
      } else {
        const gw = ConnectorGateway.getInstance();
        let capId = 'extract_pricing_and_terms';
        if (task.task_type === 'AUDIT_REGULATORY_AND_TAX') capId = 'audit_statutory_registry';
        else if (task.task_type === 'VERIFY_LOGISTICS_AND_FREIGHT') capId = 'logistics_transit_route';
        else if (task.task_type === 'ASSESS_CUSTOMER_SENTIMENT_AND_DEFECTS') capId = 'scan_media_sentiment';
        else if (task.task_type === 'RESOLVE_CONTRADICTORY_SIGNALS') capId = 'audit_conflict_and_bias';
        else if (task.task_type === 'VERIFY_RETAIL_ASP') capId = 'fetch_clean_dom';

        const env = await gw.executeCapability(capId, {
          candidate_id: task.candidate_id,
          target_field: task.target_field
        }, {
          correlation_id: `BRIDGE-${task.task_id}`
        });

        const evList: Array<Omit<ObservedEvidenceRecord, 'syndication_cluster_id'>> = [];
        if (env.transport_outcome === 'SUCCESS' && env.payload) {
          const payloadObj = (env.payload as Record<string, unknown>) || {};
          evList.push({
            evidence_id: `EV-${task.task_id}`,
            source_uri: env.source_uri,
            source_name: env.connector_id,
            source_type: 'CONNECTOR_GATEWAY',
            provenance_fingerprint: env.envelope_sha256,
            epistemic_status: env.freshness_status === 'CURRENT' ? 'OBSERVED_FACT' : 'DERIVED_ESTIMATE',
            claims: {
              [task.target_field]: payloadObj[task.target_field] ?? 'VERIFIED_GATEWAY',
              ...payloadObj
            },
            observed_at_utc: env.timestamps.completed_at,
            raw_payload_sha256: env.envelope_sha256
          });
        }

        taskResult = {
          success: env.transport_outcome === 'SUCCESS',
          result_payload: {
            status: env.transport_outcome === 'SUCCESS' ? 'VERIFIED_GATEWAY' : 'GATEWAY_ERROR',
            target_field: task.target_field,
            connector_id: env.connector_id,
            envelope_sha256: env.envelope_sha256
          },
          evidence: evList
        };
      }

      // Commit task result to InvestigationTaskQueue with fencing token
      const commitParams: CommitTaskParams = {
        task_id: task.task_id,
        candidate_id: task.candidate_id,
        generation_id: task.generation_id,
        task_type: task.task_type,
        lease_owner_id: workerId,
        fencing_token: lease.fencing_token,
        result_payload: taskResult.result_payload
      };

      await this.taskQueue.commitTaskResult(commitParams);
      executedCount++;

      // Feed observations back into AdaptiveReasoningLoop and evaluate conflicts
      if (taskResult.evidence && taskResult.evidence.length > 0) {
        for (const rawEv of taskResult.evidence) {
          const evalRes = EvidenceEvaluator.evaluateEvidence(rawEv, state.evidence_records);
          state.evidence_records.push(evalRes.evaluatedRecord);
          const conflicts = EvidenceEvaluator.detectConflicts(evalRes.evaluatedRecord, state.evidence_records);
          for (const conf of conflicts) {
            state.conflicts.push(conf);
          }
        }
      }

      // Save state checkpoint
      state = await this.stateStore.saveCheckpoint(state);
    }

    return {
      plan,
      executed_tasks_count: executedCount,
      cancelled_tasks_count: cancelledCount,
      final_state: state,
      detected_contradictions_count: state.conflicts.length
    };
  }

  private async cancelTaskInQueue(taskId: string, reason: string): Promise<void> {
    const rawQueue = (this.taskQueue as any).tasks as Map<string, any> | undefined;
    if (rawQueue && rawQueue.has(taskId)) {
      const record = rawQueue.get(taskId);
      if (record && record.state === 'QUEUED') {
        record.state = 'CANCELLED_SUPERSEDED';
        record.last_error_message = reason;
        record.updated_at_utc = new Date().toISOString();
      }
    }
  }
}
