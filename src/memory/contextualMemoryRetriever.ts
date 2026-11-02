/**
 * POC-001: Contextual Memory Retriever with Strict Applicability Gates (Stage B)
 *
 * Implements context-aware retrieval across persistent procedural and semantic memories:
 * 1. Evaluates explicit applicability conditions (jurisdiction, category, industry, scale).
 * 2. Enforces boundaries: An Indian corporate-registry verification playbook can transfer
 *    to another Indian industrial category, but rejects transfer to a foreign jurisdiction
 *    or a software subscription candidate with a MEMORY_APPLICABILITY_MISMATCH event.
 * 3. Temporal & Bitemporal filtering: Stale or superseded memories are excluded.
 * 4. Validation Gate: Only 'VALIDATED' procedural playbooks are returned for active execution.
 * 5. Emits MEMORY_RETRIEVED and MEMORY_APPLICABILITY_MISMATCH events.
 */

import {
  ProceduralMemoryRecord,
  SemanticMemoryRecord,
  InvestigationRetrievalContext,
  RetrievalMatchResult,
  ApplicabilityCriteria
} from './memoryTypes.js';
import { PersistentMemoryStore } from './persistentMemoryStore.js';

export class ContextualMemoryRetriever {
  constructor(private readonly memoryStore: PersistentMemoryStore) {}

  /**
   * Retrieves applicable procedural memories (playbooks) for an investigation context.
   */
  public async retrieveApplicableProcedural(
    context: InvestigationRetrievalContext
  ): Promise<{
    applicablePlaybooks: readonly RetrievalMatchResult<ProceduralMemoryRecord>[];
    mismatchedPlaybooks: readonly RetrievalMatchResult<ProceduralMemoryRecord>[];
  }> {
    const activeProcedurals = this.memoryStore
      .getActiveMemories('PROCEDURAL', context.as_of_utc)
      .map((m) => m as ProceduralMemoryRecord);

    const applicable: RetrievalMatchResult<ProceduralMemoryRecord>[] = [];
    const mismatched: RetrievalMatchResult<ProceduralMemoryRecord>[] = [];

    for (const playbook of activeProcedurals) {
      // Must be in VALIDATED state to be returned for active investigation execution
      if (playbook.validation_state !== 'VALIDATED') {
        continue;
      }

      const matchResult = this.evaluateApplicability(playbook, context);

      if (matchResult.is_applicable) {
        applicable.push(matchResult);
        await this.memoryStore.getEventStore().emit({
          event_type: 'MEMORY_RETRIEVED',
          investigation_id: context.investigation_id,
          memory_id: playbook.memory_id,
          details: {
            candidate_id: context.candidate_id,
            playbook_name: playbook.playbook_name,
            applicability_reason: matchResult.applicability_reason,
            matched_criteria: matchResult.matched_criteria
          }
        });
      } else {
        mismatched.push(matchResult);
        await this.memoryStore.getEventStore().emit({
          event_type: 'MEMORY_APPLICABILITY_MISMATCH',
          investigation_id: context.investigation_id,
          memory_id: playbook.memory_id,
          details: {
            candidate_id: context.candidate_id,
            playbook_name: playbook.playbook_name,
            mismatch_reason: matchResult.applicability_reason,
            missing_criteria: matchResult.missing_criteria
          }
        });
      }
    }

    // Sort applicable playbooks by relevance score descending
    applicable.sort((a, b) => b.relevance_score - a.relevance_score);

    return {
      applicablePlaybooks: Object.freeze(applicable),
      mismatchedPlaybooks: Object.freeze(mismatched)
    };
  }

  /**
   * Retrieves active semantic memories relevant to an entity or concept.
   */
  public async retrieveRelevantSemantic(params: {
    investigation_id: string;
    subject_name?: string;
    entity_id?: string;
    as_of_utc?: string;
  }): Promise<readonly SemanticMemoryRecord[]> {
    const activeSemantics = this.memoryStore
      .getActiveMemories('SEMANTIC', params.as_of_utc)
      .map((m) => m as SemanticMemoryRecord);

    const matches = activeSemantics.filter((m) => {
      if (m.validation_state !== 'VALIDATED') return false;
      if (params.entity_id && m.subject_entity_id === params.entity_id) return true;
      if (
        params.subject_name &&
        m.subject_name.toLowerCase().trim() === params.subject_name.toLowerCase().trim()
      ) {
        return true;
      }
      return false;
    });

    for (const match of matches) {
      await this.memoryStore.getEventStore().emit({
        event_type: 'MEMORY_RETRIEVED',
        investigation_id: params.investigation_id,
        memory_id: match.memory_id,
        details: { subject_name: match.subject_name, tier: 'SEMANTIC' }
      });
    }

    return Object.freeze(matches);
  }

  /**
   * Evaluates whether a memory's applicability criteria match the investigation context.
   */
  public evaluateApplicability(
    playbook: ProceduralMemoryRecord,
    context: InvestigationRetrievalContext
  ): RetrievalMatchResult<ProceduralMemoryRecord> {
    const app: ApplicabilityCriteria = playbook.applicability ?? {};
    const matchedCriteria: string[] = [];
    const missingCriteria: string[] = [];

    // 1. Jurisdiction Gate (Strict Boundary)
    if (app.jurisdictions && app.jurisdictions.length > 0) {
      if (app.jurisdictions.includes(context.jurisdiction)) {
        matchedCriteria.push(`jurisdiction:${context.jurisdiction}`);
      } else {
        missingCriteria.push(
          `jurisdiction_mismatch (required one of [${app.jurisdictions.join(', ')}], found '${context.jurisdiction}')`
        );
      }
    }

    // 2. Category Gate
    if (app.categories && app.categories.length > 0) {
      if (app.categories.includes(context.category)) {
        matchedCriteria.push(`category:${context.category}`);
      } else {
        missingCriteria.push(
          `category_mismatch (required one of [${app.categories.join(', ')}], found '${context.category}')`
        );
      }
    }

    // 3. Archetype Gate
    if (app.archetypes && app.archetypes.length > 0) {
      if (context.archetype && app.archetypes.includes(context.archetype)) {
        matchedCriteria.push(`archetype:${context.archetype}`);
      } else if (!context.archetype) {
        // Archetype unknown is not a hard rejection if category and jurisdiction match
        matchedCriteria.push(`archetype:unspecified_permissive`);
      } else {
        missingCriteria.push(
          `archetype_mismatch (required one of [${app.archetypes.join(', ')}], found '${context.archetype}')`
        );
      }
    }

    // 4. Prerequisite Signals Gate (e.g. B2B_DIRECTORY_LISTING)
    if (playbook.prerequisite_signals && playbook.prerequisite_signals.length > 0) {
      const missingSignals = playbook.prerequisite_signals.filter(
        (sig) => !context.signals_observed.includes(sig)
      );
      if (missingSignals.length === 0) {
        matchedCriteria.push(`signals:[${playbook.prerequisite_signals.join(', ')}]`);
      } else {
        missingCriteria.push(`missing_prerequisite_signals:[${missingSignals.join(', ')}]`);
      }
    }

    const isApplicable = missingCriteria.length === 0;
    let relevanceScore = 0.0;

    if (isApplicable) {
      // Base score on matched criteria count + historical success rate
      const baseRelevance = matchedCriteria.length * 20; // up to 80
      const totalApps = playbook.historical_applications_count;
      const successRate = totalApps > 0 ? playbook.successful_applications_count / totalApps : 1.0;
      relevanceScore = Math.min(100, Math.round(baseRelevance + successRate * 20));
    }

    const reason = isApplicable
      ? `Playbook '${playbook.playbook_name}' is APPLICABLE to candidate '${context.candidate_id}': matched ${matchedCriteria.join('; ')}`
      : `Playbook '${playbook.playbook_name}' is INAPPLICABLE to candidate '${context.candidate_id}': failed ${missingCriteria.join('; ')}`;

    return {
      memory: playbook,
      is_applicable: isApplicable,
      applicability_reason: reason,
      relevance_score: relevanceScore,
      matched_criteria: Object.freeze(matchedCriteria),
      missing_criteria: Object.freeze(missingCriteria)
    };
  }
}
