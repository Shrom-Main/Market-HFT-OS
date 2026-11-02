/**
/**
 * POC-001: Dynamic Specialist Delegator
 *
 * Implements the Lead Investigator / Specialist Worker delegation pattern.
 * Enables decoupling long-horizon deliberation from specialist tool execution:
 * 1. Scoped Context Passing: Specialists receive bounded sub-problems and minimal
 *    relevant context, preventing token bloat and trace contamination.
 * 2. Typed Artifact Returns: Specialists emit cryptographic SpecialistFindingArtifacts,
 *    not conversational noise.
 * 3. Synthesis & Conflict Reconciliation: Lead investigator parses specialist findings,
 *    integrates new evidence into the central ledger, and detects cross-specialist conflicts.
 */

import { sha256 } from '../../canonical/crypto.js';
import { canonicalizeJCS } from '../../canonical/jcs.js';
import {
  SpecialistRole,
  SpecialistTaskBrief,
  SpecialistFindingArtifact,
  ObservedEvidenceRecord,
  EvidenceConflict,
  EpistemicClassification
} from './reasoningTypes.js';
import { BoundedExecutionGovernor } from './boundedExecutionGovernor.js';
import { ConnectorGateway } from '../../mcp/connectorGateway.js';

export type SpecialistHandler = (
  brief: SpecialistTaskBrief
) => Promise<
  Omit<SpecialistFindingArtifact, 'delegation_id' | 'artifact_sha256' | 'specialist_role' | 'sub_question'> &
    Partial<Pick<SpecialistFindingArtifact, 'specialist_role' | 'sub_question'>>
>;

export class SpecialistDelegator {
  private readonly specialistHandlers: Map<SpecialistRole, SpecialistHandler> = new Map();
  private readonly gateway?: ConnectorGateway;

  constructor(
    private readonly governor: BoundedExecutionGovernor,
    options?: { gateway?: ConnectorGateway }
  ) {
    this.gateway = options?.gateway;
  }

  /**
   * Registers a specialist execution handler.
   */
  public registerSpecialist(role: SpecialistRole, handler: SpecialistHandler): void {
    this.specialistHandlers.set(role, handler);
  }

  /**
   * Dispatches a bounded task brief to a target specialist role.
   */
  public async delegateTask(
    brief: SpecialistTaskBrief,
    currentDepth: number,
    currentConcurrent: number,
    ledger: any
  ): Promise<SpecialistFindingArtifact> {
    this.governor.assertDelegationAllowed(currentDepth, currentConcurrent, ledger);

    const handler = this.specialistHandlers.get(brief.target_specialist_role);
    let rawResult: Omit<SpecialistFindingArtifact, 'delegation_id' | 'artifact_sha256' | 'specialist_role' | 'sub_question'> &
      Partial<Pick<SpecialistFindingArtifact, 'specialist_role' | 'sub_question'>>;

    if (handler) {
      rawResult = await handler(brief);
    } else {
      // Route through ConnectorGateway if available
      const gw = this.gateway ?? ConnectorGateway.getInstance();
      rawResult = await this.executeViaGateway(gw, brief);
    }

    const rawPayload = {
      delegation_id: brief.delegation_id,
      specialist_role: brief.target_specialist_role,
      sub_question: brief.sub_question,
      status: rawResult.status,
      key_findings: rawResult.key_findings,
      evidence_produced: rawResult.evidence_produced,
      detected_conflicts: rawResult.detected_conflicts ?? [],
      epistemic_classification: rawResult.epistemic_classification,
      recommended_next_action: rawResult.recommended_next_action
    };

    const hash = sha256(canonicalizeJCS(rawPayload));

    const artifact: SpecialistFindingArtifact = Object.freeze({
      ...rawPayload,
      artifact_sha256: hash
    });

    return artifact;
  }

  private async executeViaGateway(
    gw: ConnectorGateway,
    brief: SpecialistTaskBrief
  ): Promise<
    Omit<SpecialistFindingArtifact, 'delegation_id' | 'artifact_sha256' | 'specialist_role' | 'sub_question'> &
      Partial<Pick<SpecialistFindingArtifact, 'specialist_role' | 'sub_question'>>
  > {
    // Map specialist role to Gateway capability
    let capId: string;
    switch (brief.target_specialist_role) {
      case 'StatutoryRegistrySpecialist':
        capId = 'audit_statutory_registry';
        break;
      case 'SupplySpecialist':
        capId = 'extract_pricing_and_terms';
        break;
      case 'MarketplaceChannelSpecialist':
        capId = 'fetch_clean_dom';
        break;
      case 'LogisticsRouteSpecialist':
        capId = 'logistics_transit_route';
        break;
      case 'AdversarialAuditorSpecialist':
        capId = 'audit_conflict_and_bias';
        break;
      default:
        throw new Error(`E-AGENT-UNKNOWN-SPECIALIST: No registered handler or capability route for role '${brief.target_specialist_role}'`);
    }

    const envelope = await gw.executeCapability(capId, {
      ...brief.bounded_context,
      investigation_id: brief.parent_investigation_id,
      sub_question: brief.sub_question
    }, {
      correlation_id: `SPEC-${brief.delegation_id}`,
      caller_role: brief.target_specialist_role
    });

    const isSuccess = envelope.transport_outcome === 'SUCCESS';
    const epistemicClass: EpistemicClassification =
      envelope.freshness_status === 'CURRENT'
        ? 'OBSERVED_FACT'
        : envelope.freshness_status === 'PROVISIONAL_CACHE'
        ? 'DERIVED_ESTIMATE'
        : 'UNVERIFIED_CLAIM';

    const findings: string[] = [
      `Executed capability '${capId}' via connector '${envelope.connector_id}'. Transport outcome: ${envelope.transport_outcome}`,
      `Source URI: ${envelope.source_uri}`,
      `Freshness status: ${envelope.freshness_status}`
    ];
    if (envelope.fallback_provenance) {
      findings.push(`Fallback reason: ${envelope.fallback_provenance.fallback_reason}`);
    }

    const evidenceList: ObservedEvidenceRecord[] = [];
    if (isSuccess && envelope.payload) {
      const payloadObj = (envelope.payload as Record<string, unknown>) || {};
      const evPayload: ObservedEvidenceRecord = {
        evidence_id: `EV-${brief.delegation_id}-01`,
        source_uri: envelope.source_uri,
        source_name: envelope.connector_id,
        source_type: 'CONNECTOR_GATEWAY',
        provenance_fingerprint: envelope.envelope_sha256,
        epistemic_status: epistemicClass,
        claims: payloadObj,
        observed_at_utc: envelope.timestamps.completed_at,
        raw_payload_sha256: envelope.envelope_sha256,
        syndication_cluster_id: `SYN-${envelope.connector_id}`
      };
      evidenceList.push(Object.freeze(evPayload));
    }

    return {
      status: isSuccess ? 'FINDINGS_RETURNED' : 'BLOCKED_BY_DEPENDENCY',
      key_findings: findings,
      evidence_produced: evidenceList,
      detected_conflicts: [],
      epistemic_classification: epistemicClass,
      recommended_next_action: isSuccess ? 'PROCEED_TO_SYNTHESIS' : 'FLAG_FOR_SUPERVISOR_REVIEW'
    };
  }

  /**
   * Dispatches multiple independent specialist tasks in parallel, bounding concurrency.
   */
  public async delegateParallelTasks(
    briefs: readonly SpecialistTaskBrief[],
    currentDepth: number,
    ledger: any
  ): Promise<SpecialistFindingArtifact[]> {
    if (briefs.length === 0) return [];

    const results: SpecialistFindingArtifact[] = [];
    const maxConcurrent = this.governor.getBudgetConfig().max_concurrent_specialists;

    // Process in batches capped by maxConcurrent
    for (let i = 0; i < briefs.length; i += maxConcurrent) {
      const batch = briefs.slice(i, i + maxConcurrent);
      const batchPromises = batch.map((brief, idx) =>
        this.delegateTask(brief, currentDepth + 1, idx + 1, ledger)
      );
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Reconciles findings from multiple specialists into consolidated evidence and conflicts.
   */
  public reconcileFindings(artifacts: readonly SpecialistFindingArtifact[]): {
    consolidatedEvidence: ObservedEvidenceRecord[];
    reconciledConflicts: EvidenceConflict[];
    overallStatus: 'ALL_RESOLVED' | 'HAS_UNRESOLVED' | 'HAS_CONTRADICTIONS';
  } {
    const evidenceList: ObservedEvidenceRecord[] = [];
    const conflicts: EvidenceConflict[] = [];
    let hasContradictions = false;
    let hasUnresolved = false;

    for (const art of artifacts) {
      evidenceList.push(...art.evidence_produced);
      if (art.detected_conflicts) {
        conflicts.push(...art.detected_conflicts);
      }
      if (art.status === 'CONTRADICTION_FOUND') {
        hasContradictions = true;
      }
      if (art.status === 'UNRESOLVED') {
        hasUnresolved = true;
      }
    }

    const overallStatus = hasContradictions
      ? 'HAS_CONTRADICTIONS'
      : hasUnresolved
      ? 'HAS_UNRESOLVED'
      : 'ALL_RESOLVED';

    return {
      consolidatedEvidence: evidenceList,
      reconciledConflicts: conflicts,
      overallStatus
    };
  }
}
