/**
 * POC-001: Stage 0 Discovery — Investigation Planner Contract (Slice 2C)
 *
 * Implements deterministic planning for investigating unverified market observations.
 * Analyzes normalized discovery observations, identifies missing critical fields across
 * domains (factory quotes, retail ASP, customer sentiment, defect rates, logistics, tax),
 * and generates a prioritized, role-specific InvestigationPlan.
 *
 * Invariants Enforced:
 * 1. Category Neutrality: Applies uniform evaluation rules across all categories (electronics,
 *    laboratory consumables, precision fasteners, bio-materials, SaaS).
 * 2. Deterministic Prioritization: Prioritizes prerequisite inputs (factory quote, retail ASP)
 *    over secondary factors without relying on LLM heuristics.
 * 3. Bounded Dispatch: Emits at most 5 tasks per candidate generation (per Spec Section 11).
 * 4. Zero Data Fabrication: Missing fields are explicitly flagged as DATA_REQUIRED; zero-cost
 *    or guessed values are strictly prohibited.
 */

import { NormalizedDiscoveryObservation } from './sourceAdapterContract.js';
import type { InvestigationTaskType as ScreeningTaskType, RecommendedInvestigationTask } from './screeningPolicy.js';

export type InvestigationAgentRole =
  | 'SupplyTaskAgent'
  | 'CustomerTaskAgent'
  | 'LogisticsTaskAgent'
  | 'UnitEconomicsTaskAgent'
  | 'AdversarialTaskAgent';

export type InvestigationTaskType =
  | 'VERIFY_FACTORY_QUOTE'
  | 'VERIFY_RETAIL_ASP'
  | 'ASSESS_CUSTOMER_SENTIMENT_AND_DEFECTS'
  | 'VERIFY_LOGISTICS_AND_FREIGHT'
  | 'AUDIT_REGULATORY_AND_TAX'
  | 'RESOLVE_CONTRADICTORY_SIGNALS';

/**
 * Explicitly maps screening task types from ScreeningPolicyEngine to InvestigationPlanner task types.
 * Ensures zero unsafe casts and exhaustive translation across the dual nomenclature.
 */
export function mapScreeningTaskToPlannerTask(screeningTaskType: ScreeningTaskType): InvestigationTaskType {
  switch (screeningTaskType) {
    case 'SUPPLIER_QUOTE_ACQUISITION':
      return 'VERIFY_FACTORY_QUOTE';
    case 'RETAIL_ASP_VERIFICATION':
      return 'VERIFY_RETAIL_ASP';
    case 'GRIEVANCE_SEVERITY_MINING':
      return 'ASSESS_CUSTOMER_SENTIMENT_AND_DEFECTS';
    case 'LOGISTICS_ROUTE_VERIFICATION':
      return 'VERIFY_LOGISTICS_AND_FREIGHT';
    case 'STATUTORY_REGULATORY_CLEARANCE':
      return 'AUDIT_REGULATORY_AND_TAX';
    case 'CONFLICT_ARBITRATION':
    case 'CATEGORY_CLASSIFICATION_AND_ENRICHMENT':
      return 'RESOLVE_CONTRADICTORY_SIGNALS';
    default: {
      const _exhaustive: never = screeningTaskType;
      throw new Error(`E-UNKNOWN-TASK-TYPE: Unrecognized screening task type '${_exhaustive}'`);
    }
  }
}

export type TaskState =
  | 'QUEUED'
  | 'LEASED'
  | 'RETRYING'
  | 'SUCCEEDED'
  | 'CANCELLED_SUPERSEDED'
  | 'DEAD_LETTER_QUARANTINE'
  | 'CANCELLED';

export interface InvestigationTask {
  readonly task_id: string;
  readonly candidate_id: string;
  readonly generation_id: string;
  readonly task_type: InvestigationTaskType;
  readonly target_role: InvestigationAgentRole;
  readonly target_field: string;
  readonly priority: number; // 1 (Highest) - 5 (Lowest)
  readonly state: TaskState;
  readonly description: string;
  readonly payload: Record<string, unknown>;
  readonly created_at_utc: string;
}

export interface InvestigationPlan {
  readonly plan_id: string;
  readonly candidate_id: string;
  readonly generation_id: string;
  readonly candidate_name: string;
  readonly category?: string;
  readonly missing_critical_fields: readonly string[];
  readonly tasks: readonly InvestigationTask[];
  readonly planned_at_utc: string;
}

export class InvestigationPlanner {
  /**
   * Plans investigation for a normalized discovery observation.
   * Deterministically inspects observation fields and constructs a prioritized plan.
   *
   * @param candidateId Unique candidate identifier
   * @param observation Normalized discovery observation from adapter or screener
   * @param generationId Generation identifier (defaults to 'GEN-01')
   */
  public static planInvestigation(
    candidateId: string,
    observation: NormalizedDiscoveryObservation,
    generationId: string = 'GEN-01',
    recommendedTasks?: readonly RecommendedInvestigationTask[]
  ): InvestigationPlan {
    if (!candidateId || candidateId.trim().length === 0) {
      throw new Error('E-PLANNER-INVALID-CANDIDATE-ID: Candidate ID must be a non-empty string');
    }
    if (!observation) {
      throw new Error('E-PLANNER-INVALID-OBSERVATION: Observation must be provided');
    }

    const missingFields: string[] = [];
    const candidateTasks: InvestigationTask[] = [];
    const nowUtc = new Date().toISOString();

    // 1. Supply-Side Economics (Factory quote, supplier MOQ)
    // Invariant: Missing quote is a critical prerequisite for commercial viability.
    const hasFactoryQuote =
      observation.factory_gate_quote_inr !== null &&
      observation.factory_gate_quote_inr !== undefined &&
      observation.factory_gate_quote_inr > 0;

    if (!hasFactoryQuote) {
      missingFields.push('factory_gate_quote_inr');
      candidateTasks.push({
        task_id: `TASK-${candidateId}-${generationId}-SUPPLY-QUOTE`,
        candidate_id: candidateId,
        generation_id: generationId,
        task_type: 'VERIFY_FACTORY_QUOTE',
        target_role: 'SupplyTaskAgent',
        target_field: 'factory_gate_quote_inr',
        priority: 1, // Highest priority: without supply quote, gross margin is undefined
        state: 'QUEUED',
        description: `Investigate supplier factory-gate quote and minimum order quantity for '${observation.candidate_name}'`,
        payload: {
          candidate_name: observation.candidate_name,
          category: observation.category ?? 'UNCATEGORIZED',
          unit_batch_moq: observation.unit_batch_moq ?? null,
          source_type: observation.source_type
        },
        created_at_utc: nowUtc
      });
    }

    // 2. Demand-Side Economics (Retail ASP)
    // Invariant: Missing retail selling price prevents revenue estimation.
    const hasRetailAsp =
      observation.prevailing_retail_asp_inr !== null &&
      observation.prevailing_retail_asp_inr !== undefined &&
      observation.prevailing_retail_asp_inr > 0;

    if (!hasRetailAsp) {
      missingFields.push('prevailing_retail_asp_inr');
      candidateTasks.push({
        task_id: `TASK-${candidateId}-${generationId}-RETAIL-ASP`,
        candidate_id: candidateId,
        generation_id: generationId,
        task_type: 'VERIFY_RETAIL_ASP',
        target_role: 'UnitEconomicsTaskAgent',
        target_field: 'prevailing_retail_asp_inr',
        priority: 1, // Highest priority: without selling price, unit contribution margin is undefined
        state: 'QUEUED',
        description: `Verify prevailing retail ASP and marketplace fee schedule for '${observation.candidate_name}'`,
        payload: {
          candidate_name: observation.candidate_name,
          category: observation.category ?? 'UNCATEGORIZED',
          source_type: observation.source_type
        },
        created_at_utc: nowUtc
      });
    }

    // 3. Customer Sentiment, Defect Rate, and Quality Grievances
    // Invariant: Missing reviews or defect rates represents unknown product return risk.
    const hasSentiment =
      typeof observation.review_sentiment_summary === 'string' &&
      observation.review_sentiment_summary.trim().length > 0;

    if (!hasSentiment) {
      missingFields.push('review_sentiment_summary');
      missingFields.push('observed_defect_rate_bps');
      candidateTasks.push({
        task_id: `TASK-${candidateId}-${generationId}-CUSTOMER-SENTIMENT`,
        candidate_id: candidateId,
        generation_id: generationId,
        task_type: 'ASSESS_CUSTOMER_SENTIMENT_AND_DEFECTS',
        target_role: 'CustomerTaskAgent',
        target_field: 'observed_defect_rate_bps',
        priority: 2, // Secondary priority: product return risk & customer pain analysis
        state: 'QUEUED',
        description: `Extract customer complaints, unbox defect mentions, and compute observed defect rate for '${observation.candidate_name}'`,
        payload: {
          candidate_name: observation.candidate_name,
          category: observation.category ?? 'UNCATEGORIZED'
        },
        created_at_utc: nowUtc
      });
    }

    // 4. Logistics, Freight, and Inbound Lane Verification
    if (!observation.has_logistics_route) {
      missingFields.push('has_logistics_route');
      candidateTasks.push({
        task_id: `TASK-${candidateId}-${generationId}-LOGISTICS-FREIGHT`,
        candidate_id: candidateId,
        generation_id: generationId,
        task_type: 'VERIFY_LOGISTICS_AND_FREIGHT',
        target_role: 'LogisticsTaskAgent',
        target_field: 'has_logistics_route',
        priority: 3,
        state: 'QUEUED',
        description: `Verify transport lane, volumetric dimensions, and landed freight quote for '${observation.candidate_name}'`,
        payload: {
          candidate_name: observation.candidate_name,
          category: observation.category ?? 'UNCATEGORIZED'
        },
        created_at_utc: nowUtc
      });
    }

    // 5. Statutory, Regulatory, HSN, and GST Rate Verification
    if (!observation.has_regulatory_clearance) {
      missingFields.push('has_regulatory_clearance');
      candidateTasks.push({
        task_id: `TASK-${candidateId}-${generationId}-REGULATORY-TAX`,
        candidate_id: candidateId,
        generation_id: generationId,
        task_type: 'AUDIT_REGULATORY_AND_TAX',
        target_role: 'UnitEconomicsTaskAgent',
        target_field: 'has_regulatory_clearance',
        priority: 4,
        state: 'QUEUED',
        description: `Audit HSN code, GST rate, mandatory statutory standards, and regulatory clearance for '${observation.candidate_name}'`,
        payload: {
          candidate_name: observation.candidate_name,
          category: observation.category ?? 'UNCATEGORIZED'
        },
        created_at_utc: nowUtc
      });
    }

    // 6. Integrate Screening Policy Recommendations (e.g. CONFLICT_ARBITRATION, CATEGORY_CLASSIFICATION)
    if (recommendedTasks && recommendedTasks.length > 0) {
      for (const rec of recommendedTasks) {
        const mappedType = mapScreeningTaskToPlannerTask(rec.task_type);
        // Avoid duplicating tasks if already enqueued
        if (!candidateTasks.some((t) => t.task_type === mappedType)) {
          let role: InvestigationAgentRole = 'AdversarialTaskAgent';
          if (mappedType === 'VERIFY_FACTORY_QUOTE') role = 'SupplyTaskAgent';
          else if (mappedType === 'VERIFY_RETAIL_ASP') role = 'UnitEconomicsTaskAgent';
          else if (mappedType === 'ASSESS_CUSTOMER_SENTIMENT_AND_DEFECTS') role = 'CustomerTaskAgent';
          else if (mappedType === 'VERIFY_LOGISTICS_AND_FREIGHT') role = 'LogisticsTaskAgent';
          else if (mappedType === 'AUDIT_REGULATORY_AND_TAX') role = 'UnitEconomicsTaskAgent';

          let prio = 5;
          if (rec.priority === 'CRITICAL') prio = 1;
          else if (rec.priority === 'HIGH') prio = 2;
          else if (rec.priority === 'MEDIUM') prio = 3;
          else if (rec.priority === 'LOW') prio = 4;

          candidateTasks.push({
            task_id: `TASK-${candidateId}-${generationId}-${rec.task_id.replace(/^TASK-/, '')}`,
            candidate_id: candidateId,
            generation_id: generationId,
            task_type: mappedType,
            target_role: role,
            target_field: rec.target_field,
            priority: prio,
            state: 'QUEUED',
            description: rec.rationale || `Investigate ${rec.target_field} for '${observation.candidate_name}'`,
            payload: {
              candidate_name: observation.candidate_name,
              category: observation.category ?? 'UNCATEGORIZED',
              target_field: rec.target_field
            },
            created_at_utc: nowUtc
          });
        }
      }
    }

    // Enforce Spec Section 11 resource limit: Maximum 5 tasks per candidate generation.
    // Sort tasks strictly by priority ascending (1 = Highest first).
    const sortedTasks = candidateTasks
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 5);

    return {
      plan_id: `PLAN-${candidateId}-${generationId}`,
      candidate_id: candidateId,
      generation_id: generationId,
      candidate_name: observation.candidate_name,
      category: observation.category,
      missing_critical_fields: Object.freeze(missingFields),
      tasks: Object.freeze(sortedTasks),
      planned_at_utc: nowUtc
    };
  }
}
