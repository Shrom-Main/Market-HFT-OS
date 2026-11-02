/**
/**
 * POC-001: Adaptive Reasoning & Execution Loop (ReAct Core)
 *
 * Implements the 6-phase adaptive investigation loop:
 * 1. Understand & Retrieve: Ingests candidate context, queries Stage B memory for playbooks.
 * 2. Plan: Identifies unknowns, ranks information gaps, generates prioritized plan steps.
 * 3. Act: Executes tool or delegates to specialist under BoundedExecutionGovernor.
 * 4. Observe & Validate: Evaluates evidence, detects syndication, uncovers contradictions.
 * 5. Reassess: Dynamically replans on contradictions, unproductive sources, or circuit breaks.
 * 6. Consolidate & Learn: Audits via VerificationCritic, proposes Stage B memories, saves state.
 *
 * Invariants:
 * - Structured inspectability: Saves explicit decision records, not opaque CoT text.
 * - Dynamic pivoting: Never blindly forces execution of obsolete plan steps.
 * - Zero float math: Uses integer cents/paise for economic figures.
 * - Bounded autonomy: Ceases execution when budgets expire or marginal value drops to zero.
 */

import { OpportunityCategory } from '../../canonical/opportunityCategory.js';
import { sha256 } from '../../canonical/crypto.js';
import {
  CheckpointableInvestigationState,
  InvestigationPlanStep,
  InformationGap,
  StructuredHypothesis,
  StructuredDecisionRecord,
  ReplanRecord,
  ObservedEvidenceRecord,
  InvestigationBudgetConfig
} from './reasoningTypes.js';
import { EvidenceEvaluator } from './evidenceEvaluator.js';
import { BoundedExecutionGovernor, CircuitBreakerOpenError, BudgetExhaustedError } from './boundedExecutionGovernor.js';
import { SpecialistDelegator } from './specialistDelegator.js';
import { VerificationCritic } from './verificationCritic.js';
import { InvestigationStateStore } from './investigationStateStore.js';
import { PersistentMemoryStore } from '../../memory/persistentMemoryStore.js';
import { ContextualMemoryRetriever } from '../../memory/contextualMemoryRetriever.js';
import { ConnectorGateway } from '../../mcp/connectorGateway.js';
import { ClusterAutonomyGovernor, AutonomyLimitExceededError } from './clusterAutonomyGovernor.js';

export type ToolExecutionHandler = (args: Record<string, unknown>) => Promise<{
  success: boolean;
  result_summary: string;
  evidence_records?: Array<Omit<ObservedEvidenceRecord, 'syndication_cluster_id'>> | readonly ObservedEvidenceRecord[];
  unproductive?: boolean;
  raw_payload?: Record<string, unknown>;
  error_message?: string;
}>;

export interface StartInvestigationParams {
  readonly investigation_id: string;
  readonly candidate_id: string;
  readonly candidate_name: string;
  readonly category: OpportunityCategory;
  readonly primary_objective: string;
  readonly initial_hypotheses?: Array<{ statement: string }>;
  readonly initial_information_gaps?: Array<{ topic: string; priority: 1 | 2 | 3 | 4 | 5 }>;
  readonly jurisdiction?: string;
  readonly budget_config?: Partial<InvestigationBudgetConfig>;
}

export class AdaptiveReasoningLoop {
  private readonly toolRegistry: Map<string, ToolExecutionHandler> = new Map();
  private readonly governor: BoundedExecutionGovernor;
  private readonly delegator: SpecialistDelegator;
  private readonly stateStore: InvestigationStateStore;

  constructor(
    private readonly memoryStore?: PersistentMemoryStore,
    private readonly memoryRetriever?: ContextualMemoryRetriever,
    options?: {
      stateStore?: InvestigationStateStore;
      budgetConfig?: Partial<InvestigationBudgetConfig>;
    }
  ) {
    this.governor = new BoundedExecutionGovernor(options?.budgetConfig);
    this.delegator = new SpecialistDelegator(this.governor);
    this.stateStore = options?.stateStore ?? new InvestigationStateStore();
  }

  public registerTool(name: string, handler: ToolExecutionHandler): void {
    this.toolRegistry.set(name, handler);
  }

  public getDelegator(): SpecialistDelegator {
    return this.delegator;
  }

  public getGovernor(): BoundedExecutionGovernor {
    return this.governor;
  }

  public getStateStore(): InvestigationStateStore {
    return this.stateStore;
  }

  /**
   * Starts a brand new adaptive investigation.
   */
  public async startInvestigation(
    params: StartInvestigationParams
  ): Promise<CheckpointableInvestigationState> {
    // Assert cluster daily autonomy limits before initiating investigation
    await ClusterAutonomyGovernor.getInstance().assertInvestigationStartAllowed();

    const nowUtc = new Date().toISOString();

    const hypotheses: StructuredHypothesis[] = (params.initial_hypotheses ?? [
      { statement: `Candidate '${params.candidate_name}' is a viable opportunity in category '${params.category}'` }
    ]).map((h, i) => ({
      hypothesis_id: `HYP-${i + 1}`,
      statement: h.statement,
      status: 'PROPOSED',
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      confidence_bps: 0,
      last_evaluated_at_utc: nowUtc
    }));

    const informationGaps: InformationGap[] = (params.initial_information_gaps ?? [
      { topic: 'corporate_status', priority: 1 },
      { topic: 'factory_gate_quote_inr', priority: 1 },
      { topic: 'spec_standard', priority: 2 }
    ]).map((g, i) => ({
      gap_id: `GAP-${i + 1}`,
      topic_or_field: g.topic,
      priority: g.priority,
      state: 'UNRESOLVED',
      required_epistemic_level: g.priority === 1 ? 'PRIMARY_REGISTRY' : 'DIRECTORY_CLAIM'
    }));

    const state: CheckpointableInvestigationState = {
      investigation_id: params.investigation_id,
      candidate_id: params.candidate_id,
      candidate_name: params.candidate_name,
      category: params.category,
      primary_objective: params.primary_objective,
      state: 'INITIALIZING',
      fencing_token: 0,
      plan_version: 1,
      hypotheses,
      information_gaps: informationGaps,
      plan_steps: [],
      replan_history: [],
      decision_records: [],
      evidence_records: [],
      conflicts: [],
      specialist_artifacts: [],
      retrieved_memory_ids: [],
      failed_search_paths: [],
      budget_config: this.governor.getBudgetConfig(),
      resource_ledger: this.governor.initializeLedger(),
      created_at_utc: nowUtc,
      updated_at_utc: nowUtc
    };

    return this.runReasoningLoop(state);
  }

  /**
   * Resumes an interrupted investigation from its last checkpoint.
   */
  public async resumeInvestigation(investigationId: string): Promise<CheckpointableInvestigationState> {
    const state = this.stateStore.loadCheckpoint(investigationId);
    if (!state) {
      throw new Error(`E-AGENT-STATE-NOT-FOUND: Investigation checkpoint '${investigationId}' does not exist.`);
    }

    if (
      state.state === 'COMPLETED_SUCCESS' ||
      state.state === 'TERMINATED_EARLY_SATISFIED' ||
      state.state === 'TERMINATED_FATAL_ERROR'
    ) {
      return state; // Already terminal
    }

    // Adopt runner's updated budget configuration upon resumption
    (state as any).budget_config = this.governor.getBudgetConfig();
    state.state = 'REASONING_LOOP_ACTIVE';
    return this.runReasoningLoop(state);
  }

  /**
   * Executes the ReAct reasoning-action-observation cycle until completion or boundary condition.
   */
  public async runReasoningLoop(
    state: CheckpointableInvestigationState
  ): Promise<CheckpointableInvestigationState> {
    state.state = 'REASONING_LOOP_ACTIVE';

    // --------------------------------------------------------------------------
    // PHASE 1: UNDERSTAND & RETRIEVE (Memory Ingestion)
    // --------------------------------------------------------------------------
    if (this.memoryRetriever && state.retrieved_memory_ids.length === 0) {
      try {
        const memoryMatches = await this.memoryRetriever.retrieveApplicableProcedural({
          investigation_id: state.investigation_id,
          candidate_id: state.candidate_id,
          category: state.category,
          jurisdiction: 'IN',
          signals_observed: ['B2B_DIRECTORY_LISTING']
        });

        for (const match of memoryMatches.applicablePlaybooks) {
          state.retrieved_memory_ids.push(match.memory.memory_id);
          // If memory prescribes known failure modes, seed an informational gap
          for (const fm of match.memory.known_failure_modes) {
            const pat = typeof fm === 'string' ? fm : (fm as any).failure_pattern || '';
            if (pat && !state.information_gaps.some((g) => g.topic_or_field.toLowerCase().includes(pat.toLowerCase()))) {
              state.information_gaps.push({
                gap_id: `GAP-MEM-${state.information_gaps.length + 1}`,
                topic_or_field: `verify_against_known_failure_${pat}`,
                priority: 2,
                state: 'UNRESOLVED',
                required_epistemic_level: 'OBSERVED_FACT'
              });
            }
          }
        }
      } catch {
        // Memory retrieval error falls back safely
      }
    }

    // --------------------------------------------------------------------------
    // PHASE 2: INITIAL PLAN FORMULATION (if plan empty)
    // --------------------------------------------------------------------------
    if (state.plan_steps.length === 0) {
      this.formulateInitialPlan(state);
    }

    await this.stateStore.saveCheckpoint(state);

    // --------------------------------------------------------------------------
    // MAIN REACT LOOP
    // --------------------------------------------------------------------------
    while (state.state === 'REASONING_LOOP_ACTIVE') {
      try {
        this.governor.assertIterationAllowed(state.resource_ledger);
      } catch (err: any) {
        if (err instanceof BudgetExhaustedError) {
          state.state = 'TERMINATED_BUDGET_EXHAUSTED';
          state.final_summary = `Terminated: ${err.message}`;
          break;
        }
        throw err;
      }

      // Check early termination
      const unresolvedHigh = state.information_gaps.filter(
        (g) => g.priority === 1 && g.state === 'UNRESOLVED'
      ).length;
      const activeConflicts = state.conflicts.filter((c) => c.status === 'ACTIVE').length;

      if (
        this.governor.shouldTerminateEarly({
          unresolvedHighPriorityGapsCount: unresolvedHigh,
          activeConflictsCount: activeConflicts,
          iterationsCount: state.resource_ledger.iterations_count
        })
      ) {
        state.state = 'AWAITING_VERIFICATION';
        break;
      }

      // Find next pending plan step
      const step = state.plan_steps.find((s) => s.state === 'PENDING');
      if (!step) {
        // If there is an active fatal conflict, don't generate endless general inquiry steps; proceed to verification/critic!
        const hasActiveFatalConflict = state.conflicts.some(
          (c) => c.severity === 'FATAL_DISQUALIFIER' && c.status === 'ACTIVE'
        );
        if (hasActiveFatalConflict) {
          state.state = 'AWAITING_VERIFICATION';
          break;
        }

        // No pending steps remaining - check if any gaps remain unresolved
        const anyUnresolved = state.information_gaps.some((g) => g.state === 'UNRESOLVED');
        if (anyUnresolved && state.replan_history.length < 3) {
          // Replan to tackle remaining gaps
          this.replanForRemainingGaps(state, 'NEW_CRITICAL_GAP_SURFACED', 'Pending steps exhausted but unresolved gaps remain.');
          continue;
        } else {
          state.state = 'AWAITING_VERIFICATION';
          break;
        }
      }

      // ------------------------------------------------------------------------
      // PHASE 3: ACT (Execute tool or specialist)
      // ------------------------------------------------------------------------
      step.state = 'IN_PROGRESS';
      await ClusterAutonomyGovernor.getInstance().recordTaskExecuted();
      const stepIndex = state.resource_ledger.iterations_count;

      let toolOutcome: {
        success: boolean;
        result_summary: string;
        evidence_records?: Array<Omit<ObservedEvidenceRecord, 'syndication_cluster_id'>> | readonly ObservedEvidenceRecord[];
        unproductive?: boolean;
        raw_payload?: Record<string, unknown>;
        error_message?: string;
      };

      try {
        this.governor.assertToolCallAllowed(step.tool_or_specialist, state.resource_ledger, 100);

        let tool = this.toolRegistry.get(step.tool_or_specialist);
        if (!tool) {
          const gw = ConnectorGateway.getInstance();
          if (gw.getCapability(step.tool_or_specialist)) {
            // Direct execution through ConnectorGateway
            tool = async (params: Record<string, unknown>) => {
              const env = await gw.executeCapability(step.tool_or_specialist, params, {
                correlation_id: `LOOP-${state.investigation_id}-${step.step_id}`
              });
              return {
                success: env.transport_outcome === 'SUCCESS',
                result_summary: `Gateway capability '${step.tool_or_specialist}' outcome: ${env.transport_outcome} via ${env.connector_id}`,
                raw_payload: (env.payload as Record<string, unknown>) || {},
                error_message: env.structured_error?.message
              };
            };
          } else if (
            [
              'SupplySpecialist',
              'StatutoryRegistrySpecialist',
              'MarketplaceChannelSpecialist',
              'LogisticsRouteSpecialist',
              'AdversarialAuditorSpecialist'
            ].includes(step.tool_or_specialist)
          ) {
            // Delegation to SpecialistDelegator
            tool = async (params: Record<string, unknown>) => {
              const artifact = await this.delegator.delegateTask(
                {
                  delegation_id: `DEL-${step.step_id}`,
                  parent_investigation_id: state.investigation_id,
                  target_specialist_role: step.tool_or_specialist as any,
                  sub_question: step.action_description || step.description,
                  context_scope: {
                    candidate_id: state.candidate_id,
                    category: state.category,
                    relevant_evidence_ids: []
                  },
                  bounded_context: params,
                  expected_artifact_type: 'FINDINGS'
                },
                1,
                1,
                state.resource_ledger
              );
              return {
                success: artifact.status === 'FINDINGS_RETURNED',
                result_summary: artifact.key_findings.join('; '),
                evidence_records: artifact.evidence_produced,
                raw_payload: { artifact_sha256: artifact.artifact_sha256 }
              };
            };
          } else {
            throw new Error(`E-AGENT-TOOL-NOT-FOUND: Tool '${step.tool_or_specialist}' is not registered`);
          }
        }

        if (!tool) {
          throw new Error(`E-AGENT-TOOL-NOT-FOUND: Tool '${step.tool_or_specialist}' could not be resolved`);
        }
        toolOutcome = await tool(step.parameters);
        this.governor.recordToolOutcome(step.tool_or_specialist, toolOutcome.success, state.resource_ledger);
      } catch (err: any) {
        if (err instanceof CircuitBreakerOpenError) {
          step.state = 'FAILED_CIRCUIT_BROKEN';
          step.failure_reason = err.message;
          this.replanOnCircuitBreaker(state, step, err.toolName);
          await this.stateStore.saveCheckpoint(state);
          continue;
        }

        if (err instanceof BudgetExhaustedError) {
          state.state = 'TERMINATED_BUDGET_EXHAUSTED';
          state.final_summary = `Terminated: ${err.message}`;
          break;
        }

        // Record tool failure
        this.governor.recordToolOutcome(step.tool_or_specialist, false, state.resource_ledger);

        // Check if this failure tripped the circuit breaker
        if (this.governor.isCircuitOpen(step.tool_or_specialist)) {
          step.state = 'FAILED_CIRCUIT_BROKEN';
          step.failure_reason = `Circuit breaker tripped for '${step.tool_or_specialist}'`;
          this.replanOnCircuitBreaker(state, step, step.tool_or_specialist);
          await this.stateStore.saveCheckpoint(state);
          continue;
        }

        const stepAttempts = ((step as any).attempts = ((step as any).attempts ?? 1) + 1);
        if (stepAttempts <= state.budget_config.max_retries_per_action) {
          state.resource_ledger.retries_count++;
          step.state = 'PENDING';
        } else {
          step.state = 'FAILED_RETRIED';
          step.failure_reason = err.message;
        }
        await this.stateStore.saveCheckpoint(state);
        continue;
      }

      // ------------------------------------------------------------------------
      // PHASE 4: OBSERVE & VALIDATE
      // ------------------------------------------------------------------------
      const observedEvidenceIds: string[] = [];
      let detectedFatalConflict = false;

      if (toolOutcome.unproductive) {
        state.failed_search_paths.push(
          `${step.tool_or_specialist} with params: ${JSON.stringify(step.parameters)}`
        );
      }

      if (toolOutcome.evidence_records && toolOutcome.evidence_records.length > 0) {
        for (const rawEv of toolOutcome.evidence_records) {
          const evalResult = EvidenceEvaluator.evaluateEvidence(rawEv, state.evidence_records);
          state.evidence_records.push(evalResult.evaluatedRecord);
          observedEvidenceIds.push(evalResult.evaluatedRecord.evidence_id);

          // Conflict detection
          const conflicts = EvidenceEvaluator.detectConflicts(evalResult.evaluatedRecord, state.evidence_records);
          for (const conf of conflicts) {
            state.conflicts.push(conf);
            if (conf.severity === 'FATAL_DISQUALIFIER') {
              detectedFatalConflict = true;
            }
          }
        }
      }

      // Update relevant information gap
      const targetGap = state.information_gaps.find((g) => g.gap_id === step.target_gap_id);
      if (targetGap) {
        if (toolOutcome.success && observedEvidenceIds.length > 0) {
          targetGap.state = 'RESOLVED';
          targetGap.resolved_by_evidence_id = observedEvidenceIds[0];
        } else if (toolOutcome.unproductive) {
          // If unproductive, do not mark as resolved, mark as in-progress or pivot
        }
      }

      // Update hypotheses confidence
      const evidenceMap = new Map(state.evidence_records.map((e) => [e.evidence_id, e]));
      for (const hyp of state.hypotheses) {
        // Link relevant supporting evidence
        for (const ev of state.evidence_records) {
          if (!hyp.supporting_evidence_ids.includes(ev.evidence_id)) {
            hyp.supporting_evidence_ids.push(ev.evidence_id);
          }
        }
        // Link contradicting evidence from active fatal conflicts
        for (const conf of state.conflicts) {
          if (conf.severity === 'FATAL_DISQUALIFIER' && conf.status === 'ACTIVE') {
            if (!hyp.contradicting_evidence_ids.includes(conf.evidence_b_id)) {
              hyp.contradicting_evidence_ids.push(conf.evidence_b_id);
            }
          }
        }

        const hypEval = EvidenceEvaluator.calculateHypothesisConfidence(
          hyp.supporting_evidence_ids,
          hyp.contradicting_evidence_ids,
          evidenceMap,
          hyp.statement
        );
        hyp.confidence_bps = hypEval.confidence_bps;
        hyp.status = hypEval.status;
        hyp.assessment = hypEval;
        hyp.last_evaluated_at_utc = new Date().toISOString();
      }

      // Complete current step
      step.state = 'COMPLETED';
      step.completed_at_utc = new Date().toISOString();

      // ------------------------------------------------------------------------
      // RECORD STRUCTURED DECISION (Inspectable audit, zero private CoT requirement)
      // ------------------------------------------------------------------------
      const decisionRecord: StructuredDecisionRecord = {
        step_index: stepIndex,
        question_being_resolved: step.description,
        evidence_observed_ids: Object.freeze(observedEvidenceIds),
        action_selected: step.tool_or_specialist,
        action_rationale: `Executed '${step.tool_or_specialist}' to resolve gap '${step.target_gap_id}'. Result: ${toolOutcome.result_summary}`,
        stopping_or_pivoting_criteria: detectedFatalConflict
          ? 'FATAL_CONTRADICTION_PIVOT_REQUIRED'
          : toolOutcome.unproductive
          ? 'UNPRODUCTIVE_SOURCE_PIVOT_REQUIRED'
          : 'CONTINUE_NEXT_GAP',
        recorded_at_utc: new Date().toISOString()
      };
      state.decision_records.push(decisionRecord);

      // ------------------------------------------------------------------------
      // PHASE 5: REASSESS & ADAPTIVE REPLANNING
      // ------------------------------------------------------------------------
      if (detectedFatalConflict) {
        // A contradictory result requires immediate strategy pivot!
        this.replanOnContradiction(state, step);
      } else if (toolOutcome.unproductive) {
        // Unproductive source requires selecting an alternative
        this.replanOnUnproductiveSource(state, step);
      }

      await this.stateStore.saveCheckpoint(state);
    }

    // --------------------------------------------------------------------------
    // PHASE 6: CONSOLIDATE & LEARN
    // --------------------------------------------------------------------------
    if (state.state === 'AWAITING_VERIFICATION') {
      const critique = VerificationCritic.critiqueInvestigation(state);

      if (critique.approved) {
        state.state = 'COMPLETED_SUCCESS';
        state.final_summary = `Investigation successfully verified at epistemic ceiling '${critique.verified_epistemic_ceiling}'.`;

        // Propose reusable procedural and semantic learning to Stage B memory
        if (this.memoryStore) {
          try {
            // Verify all supporting evidence IDs resolve to actual stored evidence records
            const validEvidenceIds = state.evidence_records
              .filter((e) => e.fallback_provenance?.freshness_status !== 'STALE_HISTORICAL')
              .map((e) => e.evidence_id);

            const isAnalogical = state.retrieved_memory_ids.length > 0;

            await this.memoryStore.proposeProcedural({
              investigation_id: state.investigation_id,
              playbook_name: `INVESTIGATION_PROCEDURE_${state.category}_${state.candidate_id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`,
              target_domain: state.category,
              title: `Learned verification workflow for ${state.candidate_name}`,
              summary: `${isAnalogical ? '[ANALOGICAL_TRANSFER] ' : '[DIRECT_VALIDATION] '}Discovered and verified via ${state.decision_records.length} adaptive steps with zero active contradictions.`,
              applicability: {
                jurisdictions: ['IN'],
                categories: [state.category]
              },
              prerequisite_signals: ['B2B_DIRECTORY_LISTING'],
              execution_steps: state.plan_steps
                .filter((s) => s.state === 'COMPLETED')
                .map((s, idx) => ({
                  step_number: idx + 1,
                  action_name: s.tool_or_specialist,
                  target_role: s.tool_or_specialist,
                  required_tool: s.tool_or_specialist,
                  parameters_template: s.parameters,
                  expected_output_schema: 'evidence_collection_schema',
                  failure_recovery_action: 'RETRY_WITH_ALTERNATIVE_SPECIALIST'
                })),
              known_failure_modes: state.conflicts.map((c) => ({
                failure_pattern: c.target_field_or_claim,
                preventive_action: `Resolve contradiction between ${c.evidence_a_id} and ${c.evidence_b_id}`
              })),
              supporting_evidence_ids: validEvidenceIds,
              source_reliability:
                critique.verified_epistemic_ceiling === 'PRIMARY_REGISTRY' || critique.verified_epistemic_ceiling === 'OBSERVED_FACT'
                  ? 'OFFICIAL_REGISTRY'
                  : 'DIRECT_SUPPLIER_DISCLOSURE'
            });
          } catch {
            // Memory proposal non-fatal
          }
        }
      } else {
        // Critic rejected unsupported assertions!
        if (critique.unaddressed_conflict_ids.length > 0) {
          state.state = 'AWAITING_HUMAN_REVIEW';
          state.final_summary = `Critic halted investigation: Unresolved fatal conflicts require operator arbitration. Rejection reasons: ${critique.rejection_reasons.join('; ')}`;
        } else {
          state.state = 'TERMINATED_CONTRADICTION_HALT';
          state.final_summary = `Critic rejected completion: ${critique.rejection_reasons.join('; ')}`;
        }
      }
    }

    state.completed_at_utc = new Date().toISOString();
    await this.stateStore.saveCheckpoint(state);

    return state;
  }

  // ============================================================================
  // PLANNING & REPLANNING ENGINES
  // ============================================================================

  private formulateInitialPlan(state: CheckpointableInvestigationState): void {
    const steps: InvestigationPlanStep[] = [];
    const nowUtc = new Date().toISOString();

    let seq = 1;
    for (const gap of state.information_gaps) {
      if (gap.topic_or_field === 'corporate_status') {
        steps.push({
          step_id: `STEP-${seq}`,
          sequence_index: seq,
          description: `Query corporate registration records for candidate '${state.candidate_name}'`,
          target_gap_id: gap.gap_id,
          tool_or_specialist: 'registry_search_tool',
          parameters: { entity_name: state.candidate_name, jurisdiction: 'IN' },
          state: 'PENDING',
          created_at_utc: nowUtc
        });
        seq++;
      } else if (gap.topic_or_field === 'factory_gate_quote_inr') {
        steps.push({
          step_id: `STEP-${seq}`,
          sequence_index: seq,
          description: `Acquire manufacturer rate sheet or quote for '${state.candidate_name}'`,
          target_gap_id: gap.gap_id,
          tool_or_specialist: 'supplier_catalog_tool',
          parameters: { candidate_id: state.candidate_id },
          state: 'PENDING',
          created_at_utc: nowUtc
        });
        seq++;
      } else if (gap.topic_or_field === 'spec_standard') {
        steps.push({
          step_id: `STEP-${seq}`,
          sequence_index: seq,
          description: `Audit technical compliance and metallurgical test certificates for '${state.candidate_name}'`,
          target_gap_id: gap.gap_id,
          tool_or_specialist: 'technical_spec_audit_tool',
          parameters: { candidate_id: state.candidate_id },
          state: 'PENDING',
          created_at_utc: nowUtc
        });
        seq++;
      }
    }

    // Apply default initial plan soft limit (default: 6)
    const autonomyGov = ClusterAutonomyGovernor.getInstance();
    const cappedSteps = steps.slice(0, autonomyGov.getConfig().default_plan_task_limit);
    state.plan_steps.push(...cappedSteps);
  }

  private replanOnContradiction(
    state: CheckpointableInvestigationState,
    triggerStep: InvestigationPlanStep
  ): void {
    const autonomyGov = ClusterAutonomyGovernor.getInstance();
    autonomyGov.assertReplanAllowed(state.investigation_id, state.replan_history.length);
    autonomyGov.assertTaskEnqueueAllowed(state.investigation_id, state.plan_steps.length);
    autonomyGov.recordReplanExecuted();

    const prevVersion = state.plan_version;
    state.plan_version++;

    const discardedStepIds: string[] = [];
    const addedStepIds: string[] = [];

    // Skip dependent pending steps that were based on superseded assumption
    for (const step of state.plan_steps) {
      if (step.state === 'PENDING') {
        step.state = 'SKIPPED_OBSOLETE';
        discardedStepIds.push(step.step_id);
      }
    }

    // Add a targeted conflict resolution / verification step
    const resolutionStepId = `STEP-REPLAN-${state.plan_steps.length + 1}`;
    const resolutionStep: InvestigationPlanStep = {
      step_id: resolutionStepId,
      sequence_index: state.plan_steps.length + 1,
      description: `Investigate contradiction surfaced by '${triggerStep.tool_or_specialist}' on candidate '${state.candidate_name}'`,
      target_gap_id: triggerStep.target_gap_id,
      tool_or_specialist: 'conflict_arbitration_tool',
      parameters: {
        candidate_id: state.candidate_id,
        conflict_details: state.conflicts.filter((c) => c.status === 'ACTIVE')
      },
      state: 'PENDING',
      created_at_utc: new Date().toISOString()
    };

    state.plan_steps.push(resolutionStep);
    addedStepIds.push(resolutionStepId);

    const replanRecord: ReplanRecord = {
      replan_id: `REPLAN-${sha256(state.investigation_id + state.plan_version).substring(0, 10)}`,
      trigger_reason: 'CONTRADICTION_DISCOVERED',
      explanation: `Observation from '${triggerStep.tool_or_specialist}' contradicted earlier assumption. Obsolete pending steps discarded.`,
      previous_plan_version: prevVersion,
      new_plan_version: state.plan_version,
      discarded_step_ids: Object.freeze(discardedStepIds),
      added_step_ids: Object.freeze(addedStepIds),
      timestamp_utc: new Date().toISOString()
    };

    state.replan_history.push(replanRecord);
  }

  private replanOnUnproductiveSource(
    state: CheckpointableInvestigationState,
    triggerStep: InvestigationPlanStep
  ): void {
    const autonomyGov = ClusterAutonomyGovernor.getInstance();
    autonomyGov.assertReplanAllowed(state.investigation_id, state.replan_history.length);
    autonomyGov.assertTaskEnqueueAllowed(state.investigation_id, state.plan_steps.length);
    autonomyGov.recordReplanExecuted();

    const prevVersion = state.plan_version;
    state.plan_version++;

    const addedStepIds: string[] = [];
    const altStepId = `STEP-ALT-${state.plan_steps.length + 1}`;

    // Select alternative tool based on trigger tool
    let altTool = 'alternative_directory_search_tool';
    if (triggerStep.tool_or_specialist === 'supplier_catalog_tool') {
      altTool = 'direct_rfq_dispatcher_tool';
    } else if (triggerStep.tool_or_specialist === 'registry_search_tool') {
      altTool = 'state_gazette_archive_tool';
    }

    const altStep: InvestigationPlanStep = {
      step_id: altStepId,
      sequence_index: state.plan_steps.length + 1,
      description: `Fallback search for gap '${triggerStep.target_gap_id}' after unproductive '${triggerStep.tool_or_specialist}'`,
      target_gap_id: triggerStep.target_gap_id,
      tool_or_specialist: altTool,
      parameters: { ...triggerStep.parameters, is_fallback: true },
      state: 'PENDING',
      created_at_utc: new Date().toISOString()
    };

    state.plan_steps.push(altStep);
    addedStepIds.push(altStepId);

    state.replan_history.push({
      replan_id: `REPLAN-UNPROD-${sha256(state.investigation_id + state.plan_version).substring(0, 10)}`,
      trigger_reason: 'SOURCE_UNPRODUCTIVE',
      explanation: `Source '${triggerStep.tool_or_specialist}' yielded 0 useful results. Routed to alternative tool '${altTool}'.`,
      previous_plan_version: prevVersion,
      new_plan_version: state.plan_version,
      discarded_step_ids: [],
      added_step_ids: Object.freeze(addedStepIds),
      timestamp_utc: new Date().toISOString()
    });
  }

  private replanOnCircuitBreaker(
    state: CheckpointableInvestigationState,
    triggerStep: InvestigationPlanStep,
    failingTool: string
  ): void {
    const prevVersion = state.plan_version;
    state.plan_version++;

    const addedStepIds: string[] = [];
    const fallbackStepId = `STEP-CB-${state.plan_steps.length + 1}`;

    const fallbackStep: InvestigationPlanStep = {
      step_id: fallbackStepId,
      sequence_index: state.plan_steps.length + 1,
      description: `Circuit-breaker fallback routing away from failing tool '${failingTool}'`,
      target_gap_id: triggerStep.target_gap_id,
      tool_or_specialist: 'cached_offline_snapshot_tool',
      parameters: { original_tool: failingTool, candidate_id: state.candidate_id },
      state: 'PENDING',
      created_at_utc: new Date().toISOString()
    };

    state.plan_steps.push(fallbackStep);
    addedStepIds.push(fallbackStepId);

    state.replan_history.push({
      replan_id: `REPLAN-CB-${sha256(state.investigation_id + state.plan_version).substring(0, 10)}`,
      trigger_reason: 'RATE_LIMIT_CIRCUIT_BREAK',
      explanation: `Tool '${failingTool}' tripped circuit breaker. Switched to offline snapshot provider.`,
      previous_plan_version: prevVersion,
      new_plan_version: state.plan_version,
      discarded_step_ids: [],
      added_step_ids: Object.freeze(addedStepIds),
      timestamp_utc: new Date().toISOString()
    });
  }

  private replanForRemainingGaps(
    state: CheckpointableInvestigationState,
    reason: any,
    explanation: string
  ): void {
    const autonomyGov = ClusterAutonomyGovernor.getInstance();
    autonomyGov.assertReplanAllowed(state.investigation_id, state.replan_history.length);
    autonomyGov.recordReplanExecuted();

    const prevVersion = state.plan_version;
    state.plan_version++;

    const unresolved = state.information_gaps.filter((g) => g.state === 'UNRESOLVED');
    const addedStepIds: string[] = [];

    let seq = state.plan_steps.length + 1;
    for (const g of unresolved) {
      if (state.plan_steps.length >= autonomyGov.getConfig().hard_max_tasks_per_investigation) {
        break; // Hard task ceiling enforced
      }
      autonomyGov.assertTaskEnqueueAllowed(state.investigation_id, state.plan_steps.length);
      const stepId = `STEP-GAP-${seq}`;
      state.plan_steps.push({
        step_id: stepId,
        sequence_index: seq,
        description: `Dedicated investigation for remaining gap '${g.topic_or_field}'`,
        target_gap_id: g.gap_id,
        tool_or_specialist: 'generalized_inquiry_tool',
        parameters: { topic: g.topic_or_field, candidate_id: state.candidate_id },
        state: 'PENDING',
        created_at_utc: new Date().toISOString()
      });
      addedStepIds.push(stepId);
      seq++;
    }

    state.replan_history.push({
      replan_id: `REPLAN-GAP-${sha256(state.investigation_id + state.plan_version).substring(0, 10)}`,
      trigger_reason: reason,
      explanation,
      previous_plan_version: prevVersion,
      new_plan_version: state.plan_version,
      discarded_step_ids: [],
      added_step_ids: Object.freeze(addedStepIds),
      timestamp_utc: new Date().toISOString()
    });
  }
}
