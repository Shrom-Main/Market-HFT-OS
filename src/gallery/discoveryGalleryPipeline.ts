/**
 * POC-001: Discovery-to-Gallery Pipeline Orchestrator (Stage C)
 *
 * Implements the continuous end-to-end intelligence cycle:
 * Discovery -> Candidate Resolution -> Evidence Ingestion -> Memory Retrieval ->
 * Investigation Planning -> Task Execution -> Candidate/Thesis Enrichment -> Durable Event Emission.
 *
 * Enforces category insulation: Physical goods and software/digital candidates coexist
 * without category-specific assumptions leaking across domains.
 */

import { NormalizedDiscoveryObservation } from '../discovery/sourceAdapterContract.js';
import { PersistentGalleryStore } from './persistentGalleryStore.js';
import { ProductQueueCandidate, ThesisQueueRecord } from './galleryTypes.js';
import { PersistentMemoryStore } from '../memory/persistentMemoryStore.js';
import { ContextualMemoryRetriever } from '../memory/contextualMemoryRetriever.js';
import { InvestigationMemoryBridge } from '../memory/investigationMemoryBridge.js';
import { InvestigationTaskQueue } from '../discovery/investigationTaskQueue.js';
import { InvestigationRetrievalContext } from '../memory/memoryTypes.js';
import { CATEGORY_VERIFICATION_REQUIREMENTS } from '../canonical/opportunityCategory.js';
import { AdaptiveReasoningLoop, ToolExecutionHandler } from '../agents/reasoning/adaptiveReasoningLoop.js';
import { CheckpointableInvestigationState, InvestigationBudgetConfig } from '../agents/reasoning/reasoningTypes.js';
import { InvestigationStateStore } from '../agents/reasoning/investigationStateStore.js';

export interface IngestDiscoveryInput {
  readonly candidate_id: string;
  readonly canonical_product_id: string;
  readonly observation: NormalizedDiscoveryObservation;
  readonly jurisdiction: string;
  readonly industry?: string;
  readonly archetype?: string;
  readonly initial_evidence_id?: string;
  readonly associated_thesis_id?: string;
}

export interface PipelineExecutionResult {
  readonly candidate: ProductQueueCandidate;
  readonly associated_thesis?: ThesisQueueRecord;
  readonly applied_playbooks: readonly string[];
  readonly planned_tasks_count: number;
  readonly emitted_events_count: number;
  readonly category_verified: string;
  readonly preserved_critical_fields: readonly string[];
}

export class DiscoveryGalleryPipeline {
  constructor(
    private readonly galleryStore: PersistentGalleryStore,
    private readonly memoryStore: PersistentMemoryStore,
    private readonly memoryRetriever: ContextualMemoryRetriever,
    private readonly memoryBridge: InvestigationMemoryBridge,
    private readonly taskQueue: InvestigationTaskQueue
  ) {}

  /**
   * Processes a newly discovered market observation through the entire intelligence funnel.
   */
  public async processDiscovery(input: IngestDiscoveryInput): Promise<PipelineExecutionResult> {
    const obs = input.observation;
    const category = obs.category ?? 'PHYSICAL_GOODS';
    const categoryReqs = CATEGORY_VERIFICATION_REQUIREMENTS[category] ?? CATEGORY_VERIFICATION_REQUIREMENTS['PHYSICAL_GOODS'];

    // 1. Ingest into Living Product Gallery Queue
    const initialEvidence = input.initial_evidence_id ? [input.initial_evidence_id] : [];
    const missingFields: string[] = [];

    if (categoryReqs.requires_upstream_quote && !obs.factory_gate_quote_inr) {
      missingFields.push('factory_gate_quote_inr');
    }
    if (categoryReqs.requires_prevailing_price && !obs.prevailing_retail_asp_inr) {
      missingFields.push('prevailing_retail_asp_inr');
    }

    const isB2BListing =
      obs.source_type === 'B2B_DIRECTORY' ||
      obs.source_type === 'SUPPLIER_B2B_CATALOG' ||
      obs.source_connector_id?.toLowerCase().includes('b2b') ||
      obs.source_connector_id?.toLowerCase().includes('directory') ||
      obs.source_connector_id?.toLowerCase().includes('indiamart');

    const candidate = await this.galleryStore.ingestDiscoveredCandidate({
      candidate_id: input.candidate_id,
      canonical_product_id: input.canonical_product_id,
      name: obs.candidate_name,
      category: category,
      origin_class: (obs.origin_class as any) || (isB2BListing ? 'LIVE_VERIFIED_CAPTURE' : 'UNATTESTED_USER_INTAKE'),
      source_url: (obs as any).source_url || `connector://${obs.source_connector_id}`,
      financial_summary: {
        factory_gate_quote_inr: obs.factory_gate_quote_inr ?? null,
        prevailing_retail_asp_inr: obs.prevailing_retail_asp_inr ?? null,
        estimated_gross_margin_bps:
          obs.factory_gate_quote_inr && obs.prevailing_retail_asp_inr && obs.prevailing_retail_asp_inr > 0
            ? Math.round(((obs.prevailing_retail_asp_inr - obs.factory_gate_quote_inr) / obs.prevailing_retail_asp_inr) * 10000)
            : null,
        data_required_fields: missingFields
      },
      initial_supporting_evidence: initialEvidence
    });

    // 2. Query Stage B Contextual Memory Retriever
    const retrievalContext: InvestigationRetrievalContext = {
      investigation_id: `INV-${candidate.candidate_id}-${Date.now()}`,
      candidate_id: candidate.candidate_id,
      category: category,
      jurisdiction: input.jurisdiction,
      industry: input.industry,
      archetype: input.archetype,
      signals_observed: isB2BListing ? ['B2B_DIRECTORY_LISTING'] : []
    };

    const retrievalResult = await this.memoryRetriever.retrieveApplicableProcedural(retrievalContext);
    const appliedPlaybookNames: string[] = [];

    for (const match of retrievalResult.applicablePlaybooks) {
      appliedPlaybookNames.push(match.memory.playbook_name);
      await this.galleryStore.applyMemoryToCandidate({
        candidate_id: candidate.candidate_id,
        memory_id: match.memory.memory_id,
        playbook_name: match.memory.playbook_name,
        applicability_reason: match.applicability_reason
      });
    }

    // 3. Plan Investigation via Bridge (incorporates memories and respects category constraints)
    const adaptedPlan = await this.memoryBridge.planWithMemory(candidate.candidate_id, obs, {
      jurisdiction: input.jurisdiction,
      industry: input.industry,
      archetype: input.archetype,
      signals_observed: isB2BListing ? ['B2B_DIRECTORY_LISTING'] : []
    });

    // 4. Enqueue tasks into Task Queue
    if (adaptedPlan.tasks.length > 0) {
      await this.taskQueue.enqueueTasks(adaptedPlan.tasks);
      await this.galleryStore.updateCandidate(
        candidate.candidate_id,
        {
          lifecycle_state: 'INVESTIGATE',
          investigation_status: 'IN_PROGRESS',
          outstanding_tasks: [...adaptedPlan.tasks]
        },
        {
          event_type: 'INVESTIGATION_QUEUED',
          summary: `Enqueued ${adaptedPlan.tasks.length} investigation tasks for '${candidate.name}'`,
          details: { tasks_count: adaptedPlan.tasks.length, plan_id: adaptedPlan.plan_id }
        }
      );
    }

    // 5. Connect to Thesis Gallery if an associated thesis ID is provided or formulated
    let associatedThesis: ThesisQueueRecord | undefined = undefined;
    if (input.associated_thesis_id) {
      const existingThesis = this.galleryStore.getThesis(input.associated_thesis_id);
      if (existingThesis) {
        if (!existingThesis.related_candidate_ids.includes(candidate.candidate_id)) {
          existingThesis.related_candidate_ids.push(candidate.candidate_id);
        }
        if (input.initial_evidence_id && !existingThesis.supporting_evidence_ids.includes(input.initial_evidence_id)) {
          existingThesis.supporting_evidence_ids.push(input.initial_evidence_id);
        }
        associatedThesis = existingThesis;
      }
    }

    return {
      candidate: this.galleryStore.getCandidate(candidate.candidate_id)!,
      associated_thesis: associatedThesis,
      applied_playbooks: Object.freeze(appliedPlaybookNames),
      planned_tasks_count: adaptedPlan.tasks.length,
      emitted_events_count: this.galleryStore.getEventCount(),
      category_verified: category,
      preserved_critical_fields: Object.freeze([...categoryReqs.category_specific_critical_fields])
    };
  }

  /**
   * Feeds the result of a completed investigation task back into the candidate and thesis records.
   */
  public async completeInvestigationTask(params: {
    candidate_id: string;
    task_id: string;
    evidence_id: string;
    is_contradiction?: boolean;
    extracted_fields?: {
      factory_gate_quote_inr?: number;
      prevailing_retail_asp_inr?: number;
      corporate_status?: string;
    };
    thesis_id_to_update?: string;
    finding_summary: string;
  }): Promise<{ candidate: ProductQueueCandidate; thesis?: ThesisQueueRecord }> {
    // 1. Link evidence to candidate
    let candidate = await this.galleryStore.linkEvidenceToCandidate({
      candidate_id: params.candidate_id,
      evidence_id: params.evidence_id,
      is_contradiction: params.is_contradiction,
      rationale: params.finding_summary
    });

    // 2. Update financial summary if quote or ASP discovered
    if (params.extracted_fields?.factory_gate_quote_inr || params.extracted_fields?.prevailing_retail_asp_inr) {
      const currentFin = candidate.financial_summary || { data_required_fields: [] };
      const quote = params.extracted_fields.factory_gate_quote_inr ?? currentFin.factory_gate_quote_inr;
      const asp = params.extracted_fields.prevailing_retail_asp_inr ?? currentFin.prevailing_retail_asp_inr;
      const remainingMissing = currentFin.data_required_fields.filter(
        (f) => !(f === 'factory_gate_quote_inr' && quote) && !(f === 'prevailing_retail_asp_inr' && asp)
      );

      candidate = await this.galleryStore.updateCandidate(
        params.candidate_id,
        {
          financial_summary: {
            factory_gate_quote_inr: quote,
            prevailing_retail_asp_inr: asp,
            estimated_gross_margin_bps:
              quote && asp && asp > 0 ? Math.round(((asp - quote) / asp) * 10000) : null,
            data_required_fields: remainingMissing
          },
          lifecycle_state: remainingMissing.length === 0 ? 'VERIFIED' : 'INVESTIGATE',
          investigation_status: remainingMissing.length === 0 ? 'COMPLETED' : 'IN_PROGRESS'
        },
        {
          event_type: 'CANDIDATE_UPDATED',
          summary: `Updated financial quote for '${candidate.name}': factory quote ₹${quote || 'N/A'}, retail ASP ₹${asp || 'N/A'}`
        }
      );
    }

    // 3. Link evidence to thesis if requested
    let thesis: ThesisQueueRecord | undefined = undefined;
    if (params.thesis_id_to_update) {
      thesis = await this.galleryStore.linkEvidenceToThesis({
        thesis_id: params.thesis_id_to_update,
        evidence_id: params.evidence_id,
        is_disconfirming: params.is_contradiction,
        investigation_id: `INV-${params.candidate_id}`,
        finding_summary: params.finding_summary
      });
    }

    return { candidate, thesis };
  }

  /**
   * Production Entry Point: Executes an end-to-end adaptive investigation using the AdaptiveReasoningLoop,
   * updating candidate lifecycle, evidence collections, and thesis associations in real time.
   */
  public async processAdaptiveDiscovery(
    input: IngestDiscoveryInput,
    options?: {
      reasoningLoop?: AdaptiveReasoningLoop;
      stateStore?: InvestigationStateStore;
      budgetConfig?: Partial<InvestigationBudgetConfig>;
      toolOverrides?: Map<string, ToolExecutionHandler>;
    }
  ): Promise<{
    candidate: ProductQueueCandidate;
    adaptive_state: CheckpointableInvestigationState;
    associated_thesis?: ThesisQueueRecord;
    replanned: boolean;
    has_contradiction: boolean;
  }> {
    // 1. Ingest observation and initial memories
    const discoveryResult = await this.processDiscovery(input);
    let candidate = discoveryResult.candidate;

    // 2. Instantiate or reuse AdaptiveReasoningLoop
    const stateStore = options?.stateStore ?? new InvestigationStateStore();
    const loop =
      options?.reasoningLoop ??
      new AdaptiveReasoningLoop(this.memoryStore, this.memoryRetriever, {
        stateStore,
        budgetConfig: options?.budgetConfig
      });

    // 3. Register tool overrides if provided
    if (options?.toolOverrides) {
      for (const [name, handler] of options.toolOverrides.entries()) {
        loop.registerTool(name, handler);
      }
    }

    // 4. Run the adaptive reasoning loop
    const state = await loop.startInvestigation({
      investigation_id: `INV-ADAPTIVE-${candidate.candidate_id}`,
      candidate_id: candidate.candidate_id,
      candidate_name: candidate.name,
      category: candidate.category,
      primary_objective: `Adaptive investigation for '${candidate.name}' in category '${candidate.category}'`,
      jurisdiction: input.jurisdiction,
      budget_config: options?.budgetConfig
    });

    const hasContradiction = state.conflicts.length > 0;
    const replanned = state.replan_history.length > 0;

    // 5. Connect findings back into Living Candidate & Thesis queues
    if (hasContradiction) {
      for (const conf of state.conflicts) {
        if (conf.severity === 'FATAL_DISQUALIFIER') {
          for (const evId of [conf.evidence_a_id, conf.evidence_b_id]) {
            await this.completeInvestigationTask({
              candidate_id: candidate.candidate_id,
              task_id: 'TASK-CONTRADICTION',
              evidence_id: evId,
              is_contradiction: true,
              thesis_id_to_update: input.associated_thesis_id,
              finding_summary: `Fatal conflict detected on '${conf.target_field_or_claim}': ${conf.resolution_notes}`
            });
          }
        }
      }
      candidate = this.galleryStore.getCandidate(candidate.candidate_id)!;
    } else if (state.state === 'COMPLETED_SUCCESS') {
      // Find factory quote or retail price in evidence claims
      let foundQuote: number | undefined = undefined;
      let foundAsp: number | undefined = undefined;
      for (const ev of state.evidence_records) {
        if (ev.claims['factory_gate_quote_inr']) foundQuote = Number(ev.claims['factory_gate_quote_inr']);
        if (ev.claims['quote_inr']) foundQuote = Number(ev.claims['quote_inr']);
        if (ev.claims['prevailing_retail_asp_inr']) foundAsp = Number(ev.claims['prevailing_retail_asp_inr']);
        if (ev.claims['retail_price_inr']) foundAsp = Number(ev.claims['retail_price_inr']);
      }

      if (foundQuote || foundAsp) {
        const updateRes = await this.completeInvestigationTask({
          candidate_id: candidate.candidate_id,
          task_id: 'TASK-VERIFIED-DATA',
          evidence_id: state.evidence_records[0]?.evidence_id ?? 'EVID-VERIFIED',
          is_contradiction: false,
          extracted_fields: {
            factory_gate_quote_inr: foundQuote,
            prevailing_retail_asp_inr: foundAsp
          },
          thesis_id_to_update: input.associated_thesis_id,
          finding_summary: state.final_summary || 'Adaptive investigation verified successfully'
        });
        candidate = updateRes.candidate;
      }
    }

    return {
      candidate,
      adaptive_state: state,
      associated_thesis: input.associated_thesis_id
        ? this.galleryStore.getThesis(input.associated_thesis_id)
        : undefined,
      replanned,
      has_contradiction: hasContradiction
    };
  }
}
