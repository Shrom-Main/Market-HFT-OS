/**
/**
 * POC-001: Adaptive Research Manager Adapter
 *
 * Integrates the existing ResearchSchedulerAndManager (Gate M6 Governed Multi-Agent Ecosystem)
 * with the AdaptiveReasoningLoop.
 *
 * Capabilities:
 * 1. Adaptive Research Execution: Replaces rigid 9-stage linear execution with adaptive ReAct cycles.
 * 2. Scoped Worker Tool Binding: Binds TinyFishScopedBrowserAgent, MediaAndChatterSubAgent,
 *    and GovtSchemeAndTaxSubAgent as governed tools within the reasoning loop.
 * 3. Circuit-Breaker Protected Fallback: If external DOM endpoints experience timeouts,
 *    circuit breakers trip, routing to offline snapshots with explicit FallbackProvenance.
 * 4. Stale Fallback Quarantine: Automatically tags offline cached data with freshness status,
 *    preventing STALE_HISTORICAL snapshots from masquerading as current verification.
 */

import {
  ResearchSchedulerAndManager,
  ResearchTaskTick,
  ResearchManagerRunRecord,
  TinyFishScopedBrowserAgent,
  RedTeamReviewerSubAgent
} from '../m6AgentFramework.js';
import { AdaptiveReasoningLoop } from './adaptiveReasoningLoop.js';
import { InvestigationStateStore } from './investigationStateStore.js';
import { CheckpointableInvestigationState, FallbackProvenance } from './reasoningTypes.js';

export interface AdaptiveResearchRunResult {
  readonly run_id: string;
  readonly base_record: ResearchManagerRunRecord;
  readonly adaptive_state: CheckpointableInvestigationState;
  readonly circuit_breaker_active: boolean;
  readonly used_stale_fallback: boolean;
}

export class AdaptiveResearchManagerAdapter {
  constructor(
    private readonly manager: ResearchSchedulerAndManager,
    private readonly reasoningLoop: AdaptiveReasoningLoop,
    private readonly stateStore: InvestigationStateStore
  ) {}

  /**
   * Runs an adaptive research tick integrating TinyFish extraction and RedTeam audits.
   */
  public async executeAdaptiveResearchTick(
    tick: ResearchTaskTick,
    options?: {
      fallbackSnapshot?: {
        dom: string;
        snapshotTimestampUtc: string;
        isStaleHistorical?: boolean;
      };
    }
  ): Promise<AdaptiveResearchRunResult> {
    const governor = this.reasoningLoop.getGovernor();
    let circuitTripped = false;
    let usedStale = false;

    // 1. Register TinyFish Scoped DOM extractor tool
    const tinyFish = (this.manager as any).tinyFish as TinyFishScopedBrowserAgent;
    this.reasoningLoop.registerTool('tinyfish_dom_extractor_tool', async (params) => {
      if (tick.force_degraded_worker_timeout) {
        throw new Error('E-HTTP-504-GATEWAY-TIMEOUT: External marketplace connector timed out');
      }

      const res = tinyFish.extractListing({
        source_url: (params.url as string) || 'https://marketplace.example/item',
        raw_dom: (params.raw_dom as string) || '<html><body>Listing</body></html>',
        mandatory_fields: ['price', 'seller']
      });

      return {
        success: res.extraction_status === 'COMPLETE',
        result_summary: `Extracted ${Object.keys(res.extracted_fields).length} fields from DOM`,
        evidence_records: [
          {
            evidence_id: `EVID-TF-${Date.now()}`,
            source_uri: res.source_url,
            source_name: 'TinyFish Scoped DOM Extractor',
            source_type: 'MARKETPLACE_DOM_CAPTURE',
            provenance_fingerprint: res.dom_snapshot_hash,
            epistemic_status: 'DIRECTORY_CLAIM',
            claims: res.extracted_fields,
            observed_at_utc: res.extracted_at_utc,
            raw_payload_sha256: res.dom_snapshot_hash
          }
        ]
      };
    });

    // 2. Register Cached Offline Snapshot Fallback Tool with strict FallbackProvenance
    this.reasoningLoop.registerTool('cached_offline_snapshot_tool', async () => {
      const isStale = options?.fallbackSnapshot?.isStaleHistorical ?? true;
      const snapshotTime = options?.fallbackSnapshot?.snapshotTimestampUtc ?? '2024-01-01T00:00:00.000Z';
      usedStale = isStale;

      const provenance: FallbackProvenance = {
        is_offline_snapshot: true,
        snapshot_timestamp_utc: snapshotTime,
        freshness_status: isStale ? 'STALE_HISTORICAL' : 'PROVISIONAL_CACHE',
        original_source_origin: 'tinyfish_dom_extractor_tool',
        staleness_age_hours: 8760 // ~1 year old
      };

      return {
        success: true,
        result_summary: `Loaded cached snapshot from ${snapshotTime} (Freshness: ${provenance.freshness_status})`,
        evidence_records: [
          {
            evidence_id: `EVID-SNAPSHOT-FALLBACK-${Date.now()}`,
            source_uri: 'cache://offline/marketplace-snapshot',
            source_name: 'Historical Archive Snapshot',
            source_type: 'OFFLINE_ARCHIVE_SNAPSHOT',
            provenance_fingerprint: 'sha256-cached-snapshot-hash',
            epistemic_status: 'DIRECTORY_CLAIM',
            claims: {
              quote_inr: 45.0,
              seller: 'Historical Seller Record'
            },
            observed_at_utc: new Date().toISOString(),
            raw_payload_sha256: '0'.repeat(64),
            fallback_provenance: provenance
          }
        ]
      };
    });

    // 3. Register RedTeam Auditor tool
    const redTeam = (this.manager as any).redTeam as RedTeamReviewerSubAgent;
    this.reasoningLoop.registerTool('red_team_auditor_tool', async (params) => {
      const audit = redTeam.auditCandidateOffer({
        candidate_id: (params.candidate_id as string) || 'CAND-TICK',
        claimed_price_subunits: BigInt(params.claimed_price_subunits as number || 4500),
        raw_material_scrap_floor_subunits: BigInt(params.raw_material_scrap_floor_subunits as number || 3200),
        defect_signals: []
      });

      return {
        success: audit.approved,
        result_summary: audit.approved ? 'RedTeam audit passed' : `RedTeam rejected: ${audit.rejection_reason}`
      };
    });

    // 4. Start investigation through AdaptiveReasoningLoop
    const investigationId = `INV-TICK-${tick.tick_id}`;
    const state = await this.reasoningLoop.startInvestigation({
      investigation_id: investigationId,
      candidate_id: `CAND-${tick.tick_id}`,
      candidate_name: tick.thesis,
      category: 'PHYSICAL_GOODS',
      primary_objective: `Adaptive research tick for thesis '${tick.thesis}'`,
      initial_information_gaps: [
        { topic: 'corporate_status', priority: 1 },
        { topic: 'factory_gate_quote_inr', priority: 1 }
      ]
    });

    circuitTripped = governor.isCircuitOpen('tinyfish_dom_extractor_tool');

    // 5. Execute underlying manager for telemetry compatibility
    const baseRecord = this.manager.executeResearchTick(tick);

    return {
      run_id: tick.tick_id,
      base_record: baseRecord,
      adaptive_state: state,
      circuit_breaker_active: circuitTripped,
      used_stale_fallback: usedStale
    };
  }
}
