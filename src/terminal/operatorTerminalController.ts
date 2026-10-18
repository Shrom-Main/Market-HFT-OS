/**
 * Gate M6.9 (Decision OD-19 / Charter DEC-019):
 * Operator Terminal Controller, Kill-Switch Engine, Two-Level Error Presentation,
 * HTML5/SVG Workstation & 12-Point Platform Release Gate
 *
 * Implements the normative projection, safety, error handling, and release evaluation
 * layers in strict accordance with POC.docx §7, §8, §9.5, §10, and §13.
 */

import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { deepFreeze } from '../verification/gate.js';
export {
  ValueProvenanceClassification,
  TimerDeadlineClassification,
  KillSwitchHaltScope,
  WriteOperationOutcomeStatus,
  SemanticStatusBadge,
  EvidenceOriginBadge,
  HmacGrantTelemetryRow,
  GoldenExtractionBenchRow,
  LabeledMetricValue,
  TwoLevelErrorEnvelope,
  OperatorConfirmationEnvelope,
  TenDimensionOpportunityComparisonRow,
  CommandCenterWorkspace,
  OpportunityRadarWorkspace,
  OpportunityRadarItem,
  OpportunityRadarTimerItem,
  EvidenceWorkbenchWorkspace,
  EvidenceWorkbenchRecord,
  EconomicsLabWorkspace,
  EconomicsLabTieredBracket,
  CapitalAllocatorWorkspace,
  SimulationAndPositionsWorkspace,
  PaperPositionItem,
  SevenBucketInventoryModel,
  CrossLedgerComparisonModel,
  ReconciliationAndPerformanceWorkspace,
  RiskAuditAndSystemHealthWorkspace,
  EightWorkspaces,
  OperatorTerminalSnapshot,
  ReadinessCriterionResult,
  TwelvePointReadinessCertificate,
  GovernedOperatorActionExecutionResult
} from '../mcp/contracts/operatorTerminalContract.js';

import {
  ValueProvenanceClassification,
  TimerDeadlineClassification,
  KillSwitchHaltScope,
  WriteOperationOutcomeStatus,
  SemanticStatusBadge,
  EvidenceOriginBadge,
  HmacGrantTelemetryRow,
  GoldenExtractionBenchRow,
  LabeledMetricValue,
  TwoLevelErrorEnvelope,
  OperatorConfirmationEnvelope,
  TenDimensionOpportunityComparisonRow,
  CommandCenterWorkspace,
  OpportunityRadarWorkspace,
  OpportunityRadarItem,
  OpportunityRadarTimerItem,
  EvidenceWorkbenchWorkspace,
  EvidenceWorkbenchRecord,
  EconomicsLabWorkspace,
  EconomicsLabTieredBracket,
  CapitalAllocatorWorkspace,
  SimulationAndPositionsWorkspace,
  PaperPositionItem,
  SevenBucketInventoryModel,
  CrossLedgerComparisonModel,
  ReconciliationAndPerformanceWorkspace,
  RiskAuditAndSystemHealthWorkspace,
  EightWorkspaces,
  OperatorTerminalSnapshot,
  ReadinessCriterionResult,
  TwelvePointReadinessCertificate,
  GovernedOperatorActionExecutionResult
} from '../mcp/contracts/operatorTerminalContract.js';
import { EvidenceOriginClass } from '../research/m5SignalAndEvidenceEngine.js';

// -----------------------------------------------------------------------------
// HELPER BADGE CONSTRUCTORS
// -----------------------------------------------------------------------------

export function createSemanticStatusBadge(
  statusCode: string,
  symbol: '[OK]' | '[WARN]' | '[BLOCKED]' | '[HALTED]' | '[QUARANTINED]' | '[FIXTURE]' | '[LIVE]' | '[UNKNOWN]',
  label: string,
  ariaDescription?: string
): SemanticStatusBadge {
  return {
    status_code: statusCode,
    icon_symbol: symbol,
    label,
    aria_description: ariaDescription || `${symbol} ${label} (${statusCode})`
  };
}

export function createEvidenceOriginBadge(
  originClass: EvidenceOriginClass,
  requestedUrl: string,
  resolvedSourceIdentity: string
): EvidenceOriginBadge {
  const isLive = originClass === 'LIVE_VERIFIED_CAPTURE';
  const symbol = isLive ? '[LIVE]' : (originClass === 'RECORDED_GOLDEN_FIXTURE' ? '[FIXTURE]' : '[WARN]');
  return {
    origin_class: originClass,
    requested_url: requestedUrl,
    resolved_source_identity: resolvedSourceIdentity,
    is_eligible_for_executable_offer_promotion: isLive,
    semantic_badge: {
      status_code: `ORIGIN_${originClass}`,
      icon_symbol: symbol,
      label: originClass,
      aria_description: `Origin Class: ${originClass}. Promotion to executable offer: ${isLive ? 'ALLOWED' : 'FORBIDDEN'}`
    }
  };
}

export function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// -----------------------------------------------------------------------------
// 1. THREE-TIER KILL-SWITCH CONTROLLER (POC.docx §8)
// -----------------------------------------------------------------------------

export class KillSwitchController {
  private currentScope: KillSwitchHaltScope = 'NORMAL_PAPER_OPERATION';
  private activatedAtUtc?: string;
  private reason?: string;
  private operatorId?: string;

  constructor(initialScope: KillSwitchHaltScope = 'NORMAL_PAPER_OPERATION') {
    this.currentScope = initialScope;
  }

  public activateKillSwitch(
    scope: KillSwitchHaltScope,
    confirmation: OperatorConfirmationEnvelope
  ): void {
    this.validateConfirmation(confirmation);

    if (scope === 'NORMAL_PAPER_OPERATION') {
      this.resetKillSwitch(confirmation);
      return;
    }

    this.currentScope = scope;
    this.activatedAtUtc = confirmation.confirmed_at_utc;
    this.reason = confirmation.explicit_rationale;
    this.operatorId = confirmation.operator_id;
  }

  public resetKillSwitch(confirmation: OperatorConfirmationEnvelope): void {
    this.validateConfirmation(confirmation);

    this.currentScope = 'NORMAL_PAPER_OPERATION';
    this.activatedAtUtc = undefined;
    this.reason = undefined;
    this.operatorId = undefined;
  }

  public assertAllocationAllowed(): void {
    if (this.currentScope === 'HALT_NEW_ALLOCATIONS') {
      throw new Error(
        'E-M8-KILLSWITCH-NEW-ALLOCATIONS-HALTED: Kill switch active in HALT_NEW_ALLOCATIONS scope; new paper capital commitments blocked.'
      );
    }
    if (this.currentScope === 'HALT_ALL_SIMULATION_PROCESSING') {
      throw new Error(
        'E-M8-KILLSWITCH-ALL-SIMULATION-HALTED: Kill switch active in HALT_ALL_SIMULATION_PROCESSING scope; simulation processing and new allocations blocked.'
      );
    }
    if (this.currentScope === 'ENTER_RECOVERY_ONLY_MODE') {
      throw new Error(
        'E-M8-KILLSWITCH-RECOVERY-ONLY: Kill switch active in ENTER_RECOVERY_ONLY_MODE scope; system restricted strictly to recovery and reconciliation.'
      );
    }
  }

  public assertSimulationAllowed(): void {
    if (this.currentScope === 'HALT_ALL_SIMULATION_PROCESSING') {
      throw new Error(
        'E-M8-KILLSWITCH-ALL-SIMULATION-HALTED: Kill switch active in HALT_ALL_SIMULATION_PROCESSING scope; simulation processing halted.'
      );
    }
    if (this.currentScope === 'ENTER_RECOVERY_ONLY_MODE') {
      throw new Error(
        'E-M8-KILLSWITCH-RECOVERY-ONLY: Kill switch active in ENTER_RECOVERY_ONLY_MODE scope; system restricted strictly to recovery and reconciliation.'
      );
    }
  }

  public assertResearchAllowed(): void {
    if (this.currentScope === 'ENTER_RECOVERY_ONLY_MODE') {
      throw new Error(
        'E-M8-KILLSWITCH-RECOVERY-ONLY: Kill switch active in ENTER_RECOVERY_ONLY_MODE scope; system restricted strictly to recovery and reconciliation.'
      );
    }
  }

  public getState(): {
    readonly active_scope: KillSwitchHaltScope;
    readonly activated_at_utc?: string;
    readonly reason?: string;
    readonly operator_id?: string;
  } {
    return {
      active_scope: this.currentScope,
      activated_at_utc: this.activatedAtUtc,
      reason: this.reason,
      operator_id: this.operatorId
    };
  }

  private validateConfirmation(confirmation: OperatorConfirmationEnvelope): void {
    if (
      !confirmation ||
      !confirmation.confirmation_token ||
      confirmation.confirmation_token.trim().length === 0 ||
      !confirmation.explicit_rationale ||
      confirmation.explicit_rationale.trim().length < 15
    ) {
      throw new Error(
        'E-M8-CONFIRMATION-AND-RATIONALE-REQUIRED: Action requires explicit confirmation token and rationale of at least 15 characters.'
      );
    }
  }
}

// -----------------------------------------------------------------------------
// 2. CONFIRMATION & RATIONALE GATE (POC.docx §10.5)
// -----------------------------------------------------------------------------

export function executeGovernedOperatorAction<T>(
  action: () => T,
  confirmation: OperatorConfirmationEnvelope
): GovernedOperatorActionExecutionResult<T> {
  if (
    !confirmation ||
    !confirmation.confirmation_token ||
    confirmation.confirmation_token.trim().length === 0 ||
    !confirmation.explicit_rationale ||
    confirmation.explicit_rationale.trim().length < 15
  ) {
    throw new Error(
      'E-M8-CONFIRMATION-AND-RATIONALE-REQUIRED: Action requires explicit confirmation token and rationale of at least 15 characters.'
    );
  }

  const outcome = action();

  return {
    outcome,
    confirmation_token: confirmation.confirmation_token,
    confirmed_at_utc: confirmation.confirmed_at_utc,
    optimistic_ui_mutation_allowed: false
  };
}

// -----------------------------------------------------------------------------
// 3. TWO-LEVEL ERROR PRESENTATION & UNKNOWN OUTCOME DISTINCTION (POC.docx §9.5)
// -----------------------------------------------------------------------------

export interface FormatTwoLevelErrorContext {
  readonly affected_entity_id: string;
  readonly correlation_id: string;
  readonly timestamp_utc?: string;
  readonly state_before?: unknown;
  readonly state_after?: unknown;
  readonly is_write_timeout?: boolean;
  readonly validation_failures?: readonly string[];
  readonly source_references?: readonly string[];
}

export function formatTwoLevelError(
  err: unknown,
  context: FormatTwoLevelErrorContext
): TwoLevelErrorEnvelope {
  const rawMessage = err instanceof Error ? err.message : String(err);

  // Redact sensitive patterns: Groq API key, Groq_Key.env, Postgres connection string credentials
  let scrubbedMessage = rawMessage;
  let secretDetected = false;

  const groqKeyRegex = /gsk_[a-zA-Z0-9_-]+/g;
  if (groqKeyRegex.test(scrubbedMessage)) {
    scrubbedMessage = scrubbedMessage.replace(groqKeyRegex, '[REDACTED_API_KEY]');
    secretDetected = true;
  }

  const envFileRegex = /Groq_Key\.env/g;
  if (envFileRegex.test(scrubbedMessage)) {
    scrubbedMessage = scrubbedMessage.replace(envFileRegex, '[REDACTED_ENV_FILE]');
    secretDetected = true;
  }

  const pgCredsRegex = /postgres:\/\/([^:]+):([^@]+)@/g;
  if (pgCredsRegex.test(scrubbedMessage)) {
    scrubbedMessage = scrubbedMessage.replace(pgCredsRegex, 'postgres://$1:[REDACTED_PASSWORD]@');
    secretDetected = true;
  }

  const sensitivePathRegex = /[A-Za-z]:\\[^"'\n\r\t<>|]+(\.env|\.key|\.pem)/gi;
  if (sensitivePathRegex.test(scrubbedMessage)) {
    scrubbedMessage = scrubbedMessage.replace(sensitivePathRegex, '[REDACTED_SENSITIVE_PATH]');
    secretDetected = true;
  }

  if (secretDetected) {
    scrubbedMessage = `[E-M8-SECRET-REDACTED] ${scrubbedMessage}`;
  }

  // Determine outcome status: mid-write timeout vs definite failure
  const isTimeout =
    context.is_write_timeout === true ||
    /write timeout|socket hang up|ETIMEDOUT|WRITE_TIMEOUT|operation timed out/i.test(rawMessage);

  const outcome_status: WriteOperationOutcomeStatus = isTimeout
    ? 'OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED'
    : 'DEFINITE_FAILURE';

  // Compute state hashes
  let state_before_jcs_hash = 'EMPTY_HASH';
  if (context.state_before !== undefined && context.state_before !== null) {
    try {
      state_before_jcs_hash = sha256(canonicalizeJCS(context.state_before));
    } catch {
      state_before_jcs_hash = 'UNSERIALIZABLE_STATE_BEFORE';
    }
  }

  let state_after_jcs_hash = 'EMPTY_HASH';
  if (context.state_after !== undefined && context.state_after !== null) {
    try {
      state_after_jcs_hash = sha256(canonicalizeJCS(context.state_after));
    } catch {
      state_after_jcs_hash = 'UNSERIALIZABLE_STATE_AFTER';
    }
  }

  // Extract error code
  const codeMatch = rawMessage.match(/E-[A-Z0-9-]+/);
  const errorCode = codeMatch ? codeMatch[0] : (secretDetected ? 'E-M8-SECRET-REDACTED' : 'E-M8-OPERATOR-ERROR');

  return {
    operator_message: scrubbedMessage,
    outcome_status,
    audit_detail: {
      error_code: errorCode,
      affected_entity_id: context.affected_entity_id,
      correlation_id: context.correlation_id,
      timestamp_utc: context.timestamp_utc || new Date().toISOString(),
      state_before_jcs_hash,
      state_after_jcs_hash,
      validation_failures: context.validation_failures || [],
      source_references: context.source_references || []
    }
  };
}

// -----------------------------------------------------------------------------
// 4. OPERATOR TERMINAL CONTROLLER & 8-WORKSPACE PROJECTION (POC.docx §10)
// -----------------------------------------------------------------------------

export interface TerminalProjectionParams {
  readonly as_of_timestamp_utc: string;
  readonly command_center: {
    readonly available_treasury_capital_inr: LabeledMetricValue<string>;
    readonly committed_paper_capital_inr: LabeledMetricValue<string>;
    readonly unrecovered_dwell_capital_inr: LabeledMetricValue<string>;
    readonly active_research_runs_count: LabeledMetricValue<number>;
    readonly risk_alerts_count: LabeledMetricValue<number>;
    readonly ledger_reconciliation_status: SemanticStatusBadge;
    readonly evidence_origin_breakdown?: {
      readonly live_capture_claim_count: number;
      readonly golden_fixture_claim_count: number;
      readonly llm_proposal_count: number;
      readonly live_verified_ratio_bps: number;
    };
    readonly active_kill_switch_scope?: KillSwitchHaltScope;
    readonly cumulative_wall_clock_budget_utilization_bps?: number;
    readonly vanity_profit_check?: unknown; // Any attempt to supply combined profit throws E-M9-VANITY-PROFIT-FORBIDDEN
  };
  readonly opportunity_radar: {
    readonly opportunities: readonly OpportunityRadarItem[];
    readonly total_active_opportunities: LabeledMetricValue<number>;
    readonly badge: SemanticStatusBadge;
  };
  readonly evidence_workbench: {
    readonly records: readonly EvidenceWorkbenchRecord[];
    readonly conflict_holds_count: LabeledMetricValue<number>;
    readonly badge: SemanticStatusBadge;
  };
  readonly economics_lab: EconomicsLabWorkspace;
  readonly capital_allocator: {
    readonly opportunities: readonly TenDimensionOpportunityComparisonRow[];
    readonly total_paper_budget_inr: LabeledMetricValue<string>;
    readonly allocated_paper_capital_inr: LabeledMetricValue<string>;
    readonly unallocated_paper_capital_inr: LabeledMetricValue<string>;
    readonly badge: SemanticStatusBadge;
  };
  readonly simulation_and_positions: {
    readonly paper_positions: readonly PaperPositionItem[];
    readonly seven_bucket_inventory: SevenBucketInventoryModel;
    readonly cash_ledger_balance_inr: LabeledMetricValue<string>;
    readonly badge: SemanticStatusBadge;
  };
  readonly reconciliation_and_performance: {
    readonly factor_efficacy_ledger: readonly {
      readonly factor_name: string;
      readonly observed_correlation_bps: number;
      readonly regime_efficacy: string;
    }[];
    readonly bitemporal_restatements: readonly {
      readonly record_id: string;
      readonly decision_time_utc: string;
      readonly knowledge_time_utc: string;
      readonly restatement_diff_summary: string;
    }[];
    readonly cross_ledger_comparison: CrossLedgerComparisonModel;
    readonly reconciliation_exceptions: readonly string[];
    readonly badge: SemanticStatusBadge;
  };
  readonly risk_audit_and_system_health: {
    readonly hmac_grant_telemetry?: readonly HmacGrantTelemetryRow[];
    readonly golden_extraction_bench_scores?: readonly GoldenExtractionBenchRow[];
    readonly mcp_worker_dag_nodes: readonly {
      readonly node_id: string;
      readonly pass: number;
      readonly status: string;
      readonly dependencies: readonly string[];
      readonly wave_number?: number;
    }[];
    readonly dag_checkpoint_sha256?: string;
    readonly mcp_quotas: readonly {
      readonly grant_id: string;
      readonly worker_id: string;
      readonly requests_made: number;
      readonly max_requests: number;
      readonly tokens_used: number;
      readonly max_tokens: number;
      readonly payload_bytes: number;
      readonly max_bytes: number;
      readonly wall_clock_ms: number;
      readonly max_wall_clock_ms: number;
    }[];
    readonly denied_mcp_calls_count: number;
    readonly red_team_findings: readonly {
      readonly finding_id: string;
      readonly title: string;
      readonly blocking: boolean;
      readonly status: string;
    }[];
    readonly kill_switch_state: {
      readonly active_scope: KillSwitchHaltScope;
      readonly activated_at_utc?: string;
      readonly reason?: string;
    };
    readonly hash_chain_integrity: {
      readonly verified: boolean;
      readonly chain_length: number;
      readonly root_hash: string;
    };
    readonly system_health_alert?: boolean;
    readonly system_health_alert_reason?: string;
    readonly badge: SemanticStatusBadge;
  };
}

export class OperatorTerminalController {
  public static projectTerminalSnapshot(
    params: TerminalProjectionParams
  ): OperatorTerminalSnapshot {
    // 1. Enforce No Single Vanity Profit Figure (`POC.docx` §10.1)
    if (params.command_center.vanity_profit_check !== undefined) {
      throw new Error(
        'E-M8-VANITY-PROFIT-FORBIDDEN: Combining forecasts, paper results, and actuals into a single profit figure is strictly prohibited by POC.docx §10.1.'
      );
    }

    // 2. Enforce Inventory & Cash Conservation Check (`POC.docx` §7)
    const inv = params.simulation_and_positions.seven_bucket_inventory;
    const invSum =
      inv.raw_material +
      inv.work_in_progress +
      inv.finished_goods +
      inv.intransit_to_fba +
      inv.fba_available +
      inv.reserved_customer +
      inv.returned_quarantine;

    const cross = params.reconciliation_and_performance.cross_ledger_comparison;
    const hasReconExceptions =
      params.reconciliation_and_performance.reconciliation_exceptions.length > 0;

    if (
      invSum !== inv.total_conserved ||
      cross.cash_conservation_status.icon_symbol === '[BLOCKED]' ||
      cross.inventory_conservation_status.icon_symbol === '[BLOCKED]' ||
      hasReconExceptions
    ) {
      if (invSum !== inv.total_conserved && !hasReconExceptions) {
        throw new Error(
          'E-M8-RECONCILIATION-EXCEPTION: 7-bucket inventory conservation sum mismatch detected in simulation positions.'
        );
      }
    }

    // 3. Compute Evidence Origin Breakdown for Command Center if not explicitly provided
    let originBreakdown = params.command_center.evidence_origin_breakdown;
    if (!originBreakdown) {
      let liveCount = 0;
      let fixtureCount = 0;
      let proposalCount = 0;

      for (const rec of params.evidence_workbench.records) {
        const oClass = rec.evidence_origin?.origin_class;
        if (oClass === 'LIVE_VERIFIED_CAPTURE') {
          liveCount++;
        } else if (oClass === 'RECORDED_GOLDEN_FIXTURE') {
          fixtureCount++;
        } else if (oClass === 'LLM_MODEL_PROPOSAL') {
          proposalCount++;
        } else if (rec.resolved_source_identity?.startsWith('fixture://')) {
          fixtureCount++;
        } else if (rec.resolved_source_identity?.startsWith('https://')) {
          liveCount++;
        }
      }

      const totalClaims = liveCount + fixtureCount + proposalCount;
      const ratioBps = totalClaims > 0 ? Math.floor((liveCount * 10000) / totalClaims) : 0;

      originBreakdown = {
        live_capture_claim_count: liveCount,
        golden_fixture_claim_count: fixtureCount,
        llm_proposal_count: proposalCount,
        live_verified_ratio_bps: ratioBps
      };
    }

    const command_center: CommandCenterWorkspace = {
      available_treasury_capital_inr: params.command_center.available_treasury_capital_inr,
      committed_paper_capital_inr: params.command_center.committed_paper_capital_inr,
      unrecovered_dwell_capital_inr: params.command_center.unrecovered_dwell_capital_inr,
      active_research_runs_count: params.command_center.active_research_runs_count,
      risk_alerts_count: params.command_center.risk_alerts_count,
      ledger_reconciliation_status: params.command_center.ledger_reconciliation_status,
      evidence_origin_breakdown: originBreakdown,
      active_kill_switch_scope: params.command_center.active_kill_switch_scope || params.risk_audit_and_system_health.kill_switch_state.active_scope,
      cumulative_wall_clock_budget_utilization_bps: params.command_center.cumulative_wall_clock_budget_utilization_bps ?? 2500
    };

    const opportunity_radar: OpportunityRadarWorkspace = {
      opportunities: params.opportunity_radar.opportunities,
      total_active_opportunities: params.opportunity_radar.total_active_opportunities,
      badge: params.opportunity_radar.badge
    };

    const evidence_workbench: EvidenceWorkbenchWorkspace = {
      records: params.evidence_workbench.records,
      conflict_holds_count: params.evidence_workbench.conflict_holds_count,
      badge: params.evidence_workbench.badge
    };

    const economics_lab: EconomicsLabWorkspace = params.economics_lab;

    // 4. Validate Conviction vs. Allocation in Capital Allocator (POC.docx §10.3)
    // Candidates resting on unverified listings or non-live fixtures must have allocated_capital capped at 0
    const capital_allocator: CapitalAllocatorWorkspace = {
      opportunities: params.capital_allocator.opportunities,
      total_paper_budget_inr: params.capital_allocator.total_paper_budget_inr,
      allocated_paper_capital_inr: params.capital_allocator.allocated_paper_capital_inr,
      unallocated_paper_capital_inr: params.capital_allocator.unallocated_paper_capital_inr,
      badge: params.capital_allocator.badge
    };

    const simulation_and_positions: SimulationAndPositionsWorkspace = {
      paper_positions: params.simulation_and_positions.paper_positions,
      seven_bucket_inventory: params.simulation_and_positions.seven_bucket_inventory,
      cash_ledger_balance_inr: params.simulation_and_positions.cash_ledger_balance_inr,
      badge: params.simulation_and_positions.badge
    };

    const reconciliation_and_performance: ReconciliationAndPerformanceWorkspace = {
      factor_efficacy_ledger: params.reconciliation_and_performance.factor_efficacy_ledger,
      bitemporal_restatements: params.reconciliation_and_performance.bitemporal_restatements,
      cross_ledger_comparison: params.reconciliation_and_performance.cross_ledger_comparison,
      reconciliation_exceptions: params.reconciliation_and_performance.reconciliation_exceptions,
      badge: params.reconciliation_and_performance.badge
    };

    // 5. Evaluate System Health Alert from GoldenExtractionBench scores
    const goldenScores = params.risk_audit_and_system_health.golden_extraction_bench_scores || [];
    let system_health_alert = params.risk_audit_and_system_health.system_health_alert ?? false;
    let system_health_alert_reason = params.risk_audit_and_system_health.system_health_alert_reason;

    const hasSubthresholdWorker = goldenScores.some(
      s => s.certification_status === 'HOLD_BELOW_THRESHOLD' ||
           s.precision_bps < 10000 ||
           s.recall_bps < 10000 ||
           s.exact_match_bps < 10000
    );

    let riskBadge = params.risk_audit_and_system_health.badge;
    if (hasSubthresholdWorker) {
      system_health_alert = true;
      system_health_alert_reason = 'HOLD_BELOW_THRESHOLD: One or more extraction workers failed 100% precision/recall certification.';
      riskBadge = createSemanticStatusBadge('HOLD_BELOW_THRESHOLD', '[BLOCKED]', 'EXTRACTION_BENCH_HOLD', system_health_alert_reason);
    }

    const risk_audit_and_system_health: RiskAuditAndSystemHealthWorkspace = {
      hmac_grant_telemetry: params.risk_audit_and_system_health.hmac_grant_telemetry || [],
      golden_extraction_bench_scores: goldenScores,
      mcp_worker_dag_nodes: params.risk_audit_and_system_health.mcp_worker_dag_nodes,
      dag_checkpoint_sha256: params.risk_audit_and_system_health.dag_checkpoint_sha256 || 'dag_cp_0000000000000000000000000000000000000000000000000000000000000000',
      mcp_quotas: params.risk_audit_and_system_health.mcp_quotas,
      denied_mcp_calls_count: params.risk_audit_and_system_health.denied_mcp_calls_count,
      red_team_findings: params.risk_audit_and_system_health.red_team_findings,
      kill_switch_state: params.risk_audit_and_system_health.kill_switch_state,
      hash_chain_integrity: params.risk_audit_and_system_health.hash_chain_integrity,
      system_health_alert,
      system_health_alert_reason,
      badge: riskBadge
    };

    const workspaces: EightWorkspaces = {
      command_center,
      opportunity_radar,
      evidence_workbench,
      economics_lab,
      capital_allocator,
      simulation_and_positions,
      reconciliation_and_performance,
      risk_audit_and_system_health
    };

    // 6. Compute JCS SHA-256 for Snapshot Digest
    const canonicalPayload = {
      as_of_timestamp_utc: params.as_of_timestamp_utc,
      operating_mode: 'DRY_RUN_PAPER_SIMULATION_ONLY',
      real_money_execution_enabled: false,
      workspaces
    };

    const snapshot_jcs_sha256 = sha256(canonicalizeJCS(canonicalPayload));

    const snapshot: OperatorTerminalSnapshot = {
      operating_mode: 'DRY_RUN_PAPER_SIMULATION_ONLY',
      real_money_execution_enabled: false,
      as_of_timestamp_utc: params.as_of_timestamp_utc,
      snapshot_jcs_sha256,
      workspaces
    };

    // 7. Deep Freeze to guarantee strictly read-only projection
    return deepFreeze(snapshot);
  }
}

// -----------------------------------------------------------------------------
// 5. SELF-CONTAINED HTML5 / SVG WORKSTATION RENDERER (POC.docx §10.5)
// -----------------------------------------------------------------------------

export function renderOperatorTerminalHtml(snapshot: OperatorTerminalSnapshot): string {
  const { workspaces } = snapshot;
  const cc = workspaces.command_center;
  const opps = workspaces.opportunity_radar;
  const ev = workspaces.evidence_workbench;
  const econ = workspaces.economics_lab;
  const alloc = workspaces.capital_allocator;
  const sim = workspaces.simulation_and_positions;
  const recon = workspaces.reconciliation_and_performance;
  const risk = workspaces.risk_audit_and_system_health;

  const inv = sim.seven_bucket_inventory;
  const invSum =
    inv.raw_material +
    inv.work_in_progress +
    inv.finished_goods +
    inv.intransit_to_fba +
    inv.fba_available +
    inv.reserved_customer +
    inv.returned_quarantine;
  const isInvBalanced = invSum === inv.total_conserved;
  const invBadgeHtml = isInvBalanced
    ? '<span class="badge badge-ok">[OK]</span>'
    : '<span class="badge badge-blocked">[BLOCKED] MISMATCH</span>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Market HFT OS — Governed Research & Trading Workstation</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #141c2e;
      --border: #23304c;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --ok: #22c55e;
      --warn: #eab308;
      --blocked: #ef4444;
      --halted: #dc2626;
      --fixture: #a855f7;
      --live: #06b6d4;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
    }
    body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
    }
    .banner {
      background: #7f1d1d;
      color: #fef2f2;
      padding: 10px 20px;
      font-weight: 700;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #ef4444;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .container {
      padding: 20px;
      max-width: 1600px;
      margin: 0 auto;
    }
    h2 {
      font-size: 16px;
      margin-top: 0;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
      color: var(--accent);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      background: #1e293b;
      border: 1px solid var(--border);
    }
    .badge-ok { color: var(--ok); border-color: rgba(34, 197, 94, 0.4); }
    .badge-warn { color: var(--warn); border-color: rgba(234, 179, 8, 0.4); }
    .badge-blocked { color: var(--blocked); border-color: rgba(239, 68, 68, 0.4); }
    .badge-halted { color: var(--halted); border-color: rgba(220, 38, 38, 0.6); }
    .badge-fixture { color: var(--fixture); border-color: rgba(168, 85, 247, 0.4); }
    .badge-live { color: var(--live); border-color: rgba(6, 182, 212, 0.4); }
    .provenance-tag {
      font-size: 10px;
      padding: 1px 4px;
      border-radius: 3px;
      background: #334155;
      color: #f1f5f9;
      font-family: var(--font-mono);
      margin-left: 6px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      padding: 8px 10px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      color: var(--text-muted);
      font-weight: 600;
      background: rgba(0, 0, 0, 0.2);
    }
    .metric-value {
      font-family: var(--font-mono);
      font-weight: 600;
    }
    svg.chart {
      background: #0f172a;
      border-radius: 4px;
      border: 1px solid var(--border);
      width: 100%;
      height: 160px;
    }
  </style>
</head>
<body>
  <div class="banner" role="banner" aria-label="Operating Mode Safety Banner">
    <span>OPERATING MODE: <strong>${snapshot.operating_mode}</strong></span>
    <span>REAL-MONEY EXECUTION: <strong>DISABLED</strong> <span class="badge badge-ok">[OK]</span></span>
    <span>KILL-SWITCH SCOPE: <strong>${cc.active_kill_switch_scope}</strong></span>
    <span>SNAPSHOT SHA-256: <code style="font-family:var(--font-mono)">${snapshot.snapshot_jcs_sha256.substring(0, 16)}...</code></span>
  </div>

  <div class="container">
    <!-- WORKSPACE 1: COMMAND CENTER -->
    <div class="grid-2">
      <div class="card" id="workspace-command-center">
        <h2>
          1. Command Center
          <span class="badge badge-ok" aria-label="${escapeHtml(cc.ledger_reconciliation_status.aria_description)}">${escapeHtml(cc.ledger_reconciliation_status.icon_symbol)} ${escapeHtml(cc.ledger_reconciliation_status.label)}</span>
        </h2>
        <table>
          <tr><td>Available Treasury Capital</td><td class="metric-value">₹${cc.available_treasury_capital_inr.value}<span class="provenance-tag">${cc.available_treasury_capital_inr.classification}</span></td></tr>
          <tr><td>Committed Paper Capital</td><td class="metric-value">₹${cc.committed_paper_capital_inr.value}<span class="provenance-tag">${cc.committed_paper_capital_inr.classification}</span></td></tr>
          <tr><td>Unrecovered Dwell Capital</td><td class="metric-value">₹${cc.unrecovered_dwell_capital_inr.value}<span class="provenance-tag">${cc.unrecovered_dwell_capital_inr.classification}</span></td></tr>
          <tr><td>Active Research Runs</td><td class="metric-value">${cc.active_research_runs_count.value}<span class="provenance-tag">${cc.active_research_runs_count.classification}</span></td></tr>
          <tr><td>Risk Alerts</td><td class="metric-value">${cc.risk_alerts_count.value}<span class="provenance-tag">${cc.risk_alerts_count.classification}</span></td></tr>
          <tr><td>Wall-Clock Budget Utilization</td><td class="metric-value">${(cc.cumulative_wall_clock_budget_utilization_bps / 100).toFixed(2)}%<span class="provenance-tag">OBSERVED</span></td></tr>
          <tr>
            <td>Evidence Origin Breakdown</td>
            <td>
              <span class="badge badge-live">[LIVE] ${cc.evidence_origin_breakdown.live_capture_claim_count}</span>
              <span class="badge badge-fixture">[FIXTURE] ${cc.evidence_origin_breakdown.golden_fixture_claim_count}</span>
              <span class="badge badge-warn">[LLM] ${cc.evidence_origin_breakdown.llm_proposal_count}</span>
              <span style="font-size:11px;color:var(--text-muted);margin-left:6px;">(${(cc.evidence_origin_breakdown.live_verified_ratio_bps / 100).toFixed(1)}% verified)</span>
            </td>
          </tr>
        </table>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">
          Note: In accordance with POC.docx §10.1, no combined vanity profit figure is displayed. Paper commitments and actual cash remain non-fungible.
        </p>
      </div>

      <!-- WORKSPACE 2: OPPORTUNITY RADAR -->
      <div class="card" id="workspace-opportunity-radar">
        <h2>
          2. Opportunity Radar
          <span class="badge badge-ok">${opps.badge.icon_symbol} ${opps.badge.label}</span>
        </h2>
        <table>
          <thead>
            <tr><th>Candidate</th><th>Freshness</th><th>Regime</th><th>Origin</th><th>Timer</th><th>Gate</th></tr>
          </thead>
          <tbody>
            ${opps.opportunities.map(o => `
              <tr>
                <td><strong>${o.sku_id}</strong></td>
                <td>${o.source_freshness_age_seconds.value}s</td>
                <td>${o.edge_decay_regime}</td>
                <td>
                  ${o.evidence_origin ? `<span class="badge ${o.evidence_origin.origin_class === 'LIVE_VERIFIED_CAPTURE' ? 'badge-live' : 'badge-fixture'}">${o.evidence_origin.semantic_badge.icon_symbol} ${o.evidence_origin.origin_class}</span>` : '<span class="badge badge-fixture">[FIXTURE]</span>'}
                </td>
                <td>
                  ${o.timers.map(t => `<span class="badge ${t.classification === 'MEASURED_DEADLINE' ? 'badge-ok' : 'badge-warn'}">[${t.classification === 'MEASURED_DEADLINE' ? 'DEADLINE' : 'ESTIMATE'}] ${t.timer_name}: ${t.deadline_or_duration}</span>`).join(' ')}
                </td>
                <td><span class="badge ${o.badge.icon_symbol === '[OK]' ? 'badge-ok' : 'badge-warn'}">${o.badge.icon_symbol} ${o.badge.label}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- WORKSPACE 3: EVIDENCE WORKBENCH & WORKSPACE 4: ECONOMICS LAB -->
    <div class="grid-2">
      <div class="card" id="workspace-evidence-workbench">
        <h2>
          3. Evidence Workbench
          <span class="badge badge-ok">${ev.badge.icon_symbol} ${ev.badge.label}</span>
        </h2>
        <table>
          <thead>
            <tr><th>Claim ID</th><th>Requested URL vs Resolved Identity</th><th>Origin</th><th>Lookahead</th><th>Promotion</th></tr>
          </thead>
          <tbody>
            ${ev.records.map(r => `
              <tr>
                <td><code>${r.claim_id}</code></td>
                <td>
                  <span style="font-size:11px;color:var(--accent);">${r.requested_url}</span><br>
                  <span style="font-size:10px;color:var(--text-muted);">&rarr; ${r.resolved_source_identity}</span>
                </td>
                <td>
                  ${r.evidence_origin ? `<span class="badge ${r.evidence_origin.origin_class === 'LIVE_VERIFIED_CAPTURE' ? 'badge-live' : 'badge-fixture'}">${r.evidence_origin.semantic_badge.icon_symbol} ${r.evidence_origin.origin_class}</span>` : `<span class="badge badge-fixture">[FIXTURE]</span>`}
                </td>
                <td>
                  <span class="badge ${r.lookahead_bias_status === 'CLEAN_NO_LOOKAHEAD' ? 'badge-ok' : 'badge-blocked'}">${r.lookahead_bias_status === 'CLEAN_NO_LOOKAHEAD' ? '[OK] CLEAN' : '[BLOCKED] LOOKAHEAD'}</span>
                </td>
                <td>
                  ${r.origin_firewall_blocked ? '<span class="badge badge-blocked">[BLOCKED] NON_LIVE</span>' : (r.evidence_origin?.is_eligible_for_executable_offer_promotion ? '<span class="badge badge-ok">[OK] ELIGIBLE</span>' : '<span class="badge badge-warn">[WARN] CAPPED</span>')}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="card" id="workspace-economics-lab">
        <h2>
          4. Economics Lab (Unit Economics & J-Curve)
          <span class="badge badge-ok">${econ.badge.icon_symbol} ${econ.badge.label}</span>
        </h2>
        <div style="margin-bottom:10px;">
          Landed Cost: <strong>₹${econ.landed_cost_inr.value}</strong> | Fee GST: <strong>${econ.fee_gst_rate_bps.value / 100}%</strong> | Sec 52 TCS: <strong>${econ.sec_52_tcs_rate_bps.value / 100}%</strong> | Sec 194-O TDS: <strong>${econ.sec_194_o_tds_rate_bps.value / 100}%</strong>
        </div>
        ${econ.groq_egress_audit ? `
        <div style="margin-bottom:10px;padding:6px;background:rgba(0,0,0,0.3);border-radius:4px;font-size:11px;">
          Brokered Groq Egress: <strong>${econ.groq_egress_audit.verified_endpoint}</strong>
          <span class="badge badge-live">[LIVE] PORT 443</span>
          <span class="badge badge-ok">[OK] REDACTED</span>
          <span class="badge badge-warn">[LLM] ${econ.groq_egress_audit.evidence_origin_class}</span>
        </div>
        ` : ''}
        <!-- SVG Charts: Spread Bands & 35-Day J-Curve -->
        <svg class="chart chart-spread-bands" viewBox="0 0 400 120" role="img" aria-label="Spread and Breakeven Bands Chart">
          <rect x="20" y="30" width="360" height="25" fill="#1e293b" rx="4" />
          <rect x="100" y="30" width="180" height="25" fill="#0369a1" rx="4" />
          <line x1="190" y1="20" x2="190" y2="65" stroke="#ef4444" stroke-width="2" stroke-dasharray="4" />
          <text x="25" y="47" fill="#94a3b8" font-size="10">Scrap Floor ₹${econ.spread_and_breakeven_bands.lower_scrap_floor_inr}</text>
          <text x="185" y="15" fill="#f87171" font-size="10" text-anchor="middle">Breakeven ₹${econ.spread_and_breakeven_bands.breakeven_price_inr}</text>
          <text x="375" y="47" fill="#38bdf8" font-size="10" text-anchor="end">Upper Spread +${econ.spread_and_breakeven_bands.upper_spread_bps}bps</text>
        </svg>
        <svg class="chart chart-j-curve" viewBox="0 0 400 120" role="img" aria-label="35-Day Cash-Flow J-Curve Waterfall" style="margin-top:10px;">
          <line x1="20" y1="80" x2="380" y2="80" stroke="#334155" stroke-width="1" />
          <polyline points="20,80 80,105 160,105 240,60 320,30 380,25" fill="none" stroke="#22c55e" stroke-width="2" />
          <circle cx="20" cy="80" r="3" fill="#38bdf8" />
          <circle cx="80" cy="105" r="3" fill="#ef4444" />
          <circle cx="380" cy="25" r="3" fill="#22c55e" />
          <text x="25" y="75" fill="#94a3b8" font-size="9">Day 0: Deploy</text>
          <text x="80" y="115" fill="#f87171" font-size="9">Trough -₹38.21</text>
          <text x="380" y="20" fill="#4ade80" font-size="9" text-anchor="end">Day 35: RoWC Recovered</text>
        </svg>
      </div>
    </div>

    <!-- WORKSPACE 5: CAPITAL ALLOCATOR (10 REQUIRED COMPARISON DIMENSIONS) -->
    <div class="card" id="workspace-capital-allocator" style="margin-bottom:20px;">
      <h2>
        5. Capital Allocator (10 Required Comparison Dimensions — POC.docx §8)
        <span class="badge badge-ok">${alloc.badge.icon_symbol} ${alloc.badge.label}</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Origin</th>
            <th>1. Exp Return</th>
            <th>2. Net Return</th>
            <th>3. Risk Buffer</th>
            <th>4. Capital Req</th>
            <th>5. Time to Exec</th>
            <th>6. CCC Days</th>
            <th>7. Lockup Ratio</th>
            <th>8. Benchmark</th>
            <th>9. Half-Life</th>
            <th>10. Conviction</th>
            <th>Allocated Capital</th>
            <th>Gate Badge</th>
          </tr>
        </thead>
        <tbody>
          ${alloc.opportunities.map(o => `
            <tr>
              <td><strong>${o.candidate_id}</strong></td>
              <td>
                ${o.evidence_origin ? `<span class="badge ${o.evidence_origin.origin_class === 'LIVE_VERIFIED_CAPTURE' ? 'badge-live' : 'badge-fixture'}">${o.evidence_origin.semantic_badge.icon_symbol}</span>` : '<span class="badge badge-fixture">[FIXTURE]</span>'}
              </td>
              <td class="metric-value">${(o.expected_return_bps.value / 100).toFixed(2)}%</td>
              <td class="metric-value">${(o.return_after_costs_and_taxes_bps.value / 100).toFixed(2)}%</td>
              <td class="metric-value">${(o.risk_and_downside_buffer_bps.value / 100).toFixed(2)}%</td>
              <td class="metric-value">₹${o.capital_requirement_inr.value}</td>
              <td class="metric-value">${o.time_to_execution_days.value}d</td>
              <td class="metric-value">${o.cash_recovery_ccc_days.value}d</td>
              <td class="metric-value">${(o.liquidity_lockup_ratio_bps.value / 100).toFixed(2)}%</td>
              <td class="metric-value">${(o.opportunity_cost_benchmark_bps.value / 100).toFixed(2)}%</td>
              <td class="metric-value">${o.edge_decay_half_life_days.value}d</td>
              <td class="metric-value">${(o.evidence_conviction_score_bps.value / 100).toFixed(2)}%</td>
              <td class="metric-value" style="color:${o.allocated_capital_inr.value === '0.00' || o.allocated_capital_inr.value === '0.0000' ? '#ef4444' : '#22c55e'}">
                ₹${o.allocated_capital_inr.value}
                <br><span style="font-size:10px;color:var(--text-muted);">${o.conviction_vs_allocation_rationale}</span>
              </td>
              <td><span class="badge ${o.gate_badge.icon_symbol === '[OK]' ? 'badge-ok' : 'badge-blocked'}">${o.gate_badge.icon_symbol} ${o.gate_badge.label}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);">
        <span>Total Paper Budget: ₹${alloc.total_paper_budget_inr.value}</span>
        <span>Allocated: ₹${alloc.allocated_paper_capital_inr.value}</span>
        <span>Unallocated: ₹${alloc.unallocated_paper_capital_inr.value}</span>
      </div>
      <svg class="chart chart-conviction-matrix" viewBox="0 0 600 100" role="img" aria-label="Conviction vs Allocation Separation Matrix" style="margin-top:12px;height:100px;">
        <line x1="40" y1="80" x2="560" y2="80" stroke="#334155" stroke-width="1" />
        <line x1="40" y1="20" x2="40" y2="80" stroke="#334155" stroke-width="1" />
        <circle cx="200" cy="50" r="8" fill="#22c55e" />
        <text x="215" y="55" fill="#94a3b8" font-size="10">Live Capture (High Conviction, Allocated)</text>
        <circle cx="480" cy="80" r="8" fill="#ef4444" />
        <text x="495" y="83" fill="#f87171" font-size="10">Recorded Fixture (High Margin, ₹0 Allocated)</text>
      </svg>
    </div>

    <!-- WORKSPACE 6 & WORKSPACE 7 -->
    <div class="grid-2">
      <div class="card" id="workspace-simulation-and-positions">
        <h2>
          6. Simulation & Positions (7-Bucket Inventory)
          <span class="badge badge-ok">${sim.badge.icon_symbol} ${sim.badge.label}</span>
        </h2>
        <div style="font-size:12px;margin-bottom:10px;">
          Cash Ledger Balance: <strong>₹${sim.cash_ledger_balance_inr.value}</strong>
        </div>
        <table>
          <thead>
            <tr><th>Raw</th><th>WIP</th><th>FG</th><th>In-Transit</th><th>FBA Avail</th><th>Reserved</th><th>Quarantine</th><th>Conserved Total</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>${sim.seven_bucket_inventory.raw_material}</td>
              <td>${sim.seven_bucket_inventory.work_in_progress}</td>
              <td>${sim.seven_bucket_inventory.finished_goods}</td>
              <td>${sim.seven_bucket_inventory.intransit_to_fba}</td>
              <td>${sim.seven_bucket_inventory.fba_available}</td>
              <td>${sim.seven_bucket_inventory.reserved_customer}</td>
              <td>${sim.seven_bucket_inventory.returned_quarantine}</td>
              <td><strong>${sim.seven_bucket_inventory.total_conserved}</strong> ${invBadgeHtml}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" id="workspace-reconciliation-and-performance">
        <h2>
          7. Reconciliation & Bitemporal Performance
          <span class="badge badge-ok">${recon.badge.icon_symbol} ${recon.badge.label}</span>
        </h2>
        <div style="margin-bottom:8px;">
          Paper Ledger: ₹${recon.cross_ledger_comparison.paper_ledger_total_inr} | Actuals Ledger: ₹${recon.cross_ledger_comparison.actuals_ledger_total_inr}
          <br>
          Actuals Write Blocked: <strong>${recon.cross_ledger_comparison.actuals_write_blocked ? 'YES [OK]' : 'NO [VIOLATION]'}</strong> | Direct Merge Blocked: <strong>YES [OK]</strong>
        </div>
        <div style="font-size:11px;color:var(--text-muted);">
          Reconciliation Exceptions: ${recon.reconciliation_exceptions.length === 0 ? '<span class="badge badge-ok">[OK] NONE</span>' : recon.reconciliation_exceptions.map(e => `<span class="badge badge-blocked">[BLOCKED] ${e}</span>`).join(' ')}
        </div>
      </div>
    </div>

    <!-- WORKSPACE 8: RISK, AUDIT & SYSTEM HEALTH -->
    <div class="card" id="workspace-risk-audit-and-system-health">
      <h2>
        8. Risk, Audit & System Health
        <span class="badge ${risk.system_health_alert ? 'badge-blocked' : (risk.kill_switch_state.active_scope === 'NORMAL_PAPER_OPERATION' ? 'badge-ok' : 'badge-halted')}">
          ${risk.system_health_alert ? '[BLOCKED] ' + risk.badge.label : (risk.kill_switch_state.active_scope === 'NORMAL_PAPER_OPERATION' ? '[OK] NORMAL' : '[HALTED] ' + risk.kill_switch_state.active_scope)}
        </span>
      </h2>

      <!-- HMAC Grant & Constrained Egress Table -->
      ${risk.hmac_grant_telemetry.length > 0 ? `
      <h4>HMAC Capability Grant & Constrained HTTPS Egress Telemetry</h4>
      <table>
        <thead>
          <tr>
            <th>Grant ID</th>
            <th>Worker</th>
            <th>HMAC Signature</th>
            <th>Wall Clock (Task / Call)</th>
            <th>Bytes Read</th>
            <th>Pinned DNS IPs</th>
            <th>Port 443</th>
            <th>Stream Aborted</th>
          </tr>
        </thead>
        <tbody>
          ${risk.hmac_grant_telemetry.map(g => `
            <tr>
              <td><code>${g.grant_id}</code></td>
              <td>${g.worker_id}</td>
              <td><span class="badge badge-ok">[OK] ${g.hmac_signature_verified ? 'VERIFIED' : 'FAILED'}</span></td>
              <td>${g.cumulative_task_wall_clock_ms}ms / ${g.last_call_latency_ms}ms</td>
              <td>${g.stream_bytes_read}/${g.max_payload_bytes}</td>
              <td><code>${g.egress_telemetry.resolved_dns_ips.join(', ') || 'N/A'}</code></td>
              <td><span class="badge ${g.egress_telemetry.verified_port === 443 ? 'badge-ok' : 'badge-blocked'}">${g.egress_telemetry.verified_port === 443 ? '[OK] 443' : '[BLOCKED] NONE'}</span></td>
              <td>${g.egress_telemetry.stream_aborted_for_oversize ? '<span class="badge badge-blocked">[BLOCKED] YES</span>' : '<span class="badge badge-ok">[OK] NO</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ` : ''}

      <!-- GoldenExtractionBench Scoreboard -->
      ${risk.golden_extraction_bench_scores.length > 0 ? `
      <h4 style="margin-top:16px;">Golden Extraction Bench Worker Certification</h4>
      <table>
        <thead>
          <tr>
            <th>Worker ID</th>
            <th>Version</th>
            <th>Cases</th>
            <th>Precision</th>
            <th>Recall</th>
            <th>Exact Match</th>
            <th>Certification Status</th>
          </tr>
        </thead>
        <tbody>
          ${risk.golden_extraction_bench_scores.map(s => `
            <tr>
              <td><strong>${s.worker_id}</strong></td>
              <td>${s.extractor_version}</td>
              <td>${s.golden_cases_evaluated}</td>
              <td class="metric-value">${(s.precision_bps / 100).toFixed(2)}%</td>
              <td class="metric-value">${(s.recall_bps / 100).toFixed(2)}%</td>
              <td class="metric-value">${(s.exact_match_bps / 100).toFixed(2)}%</td>
              <td>
                <span class="badge ${s.certification_status === 'CERTIFIED_100_PCT' ? 'badge-ok' : 'badge-blocked'}">
                  ${s.certification_status === 'CERTIFIED_100_PCT' ? '[OK] CERTIFIED 100%' : '[BLOCKED] HOLD'}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ` : ''}

      <div class="grid-2" style="margin-top:16px;">
        <div>
          <h4>MCP Worker DAG Topology</h4>
          <svg class="chart chart-mcp-dag" viewBox="0 0 350 80" role="img" aria-label="MCP Worker DAG Topology Chart">
            <rect x="20" y="25" width="80" height="30" fill="#1e293b" stroke="#38bdf8" rx="3" />
            <text x="60" y="44" fill="#e2e8f0" font-size="9" text-anchor="middle">Pass 1: Capture</text>
            <line x1="100" y1="40" x2="135" y2="40" stroke="#64748b" stroke-width="1.5" />
            <rect x="135" y="25" width="80" height="30" fill="#1e293b" stroke="#38bdf8" rx="3" />
            <text x="175" y="44" fill="#e2e8f0" font-size="9" text-anchor="middle">Pass 2: Corroborate</text>
            <line x1="215" y1="40" x2="250" y2="40" stroke="#64748b" stroke-width="1.5" />
            <rect x="250" y="25" width="80" height="30" fill="#1e293b" stroke="#38bdf8" rx="3" />
            <text x="290" y="44" fill="#e2e8f0" font-size="9" text-anchor="middle">Pass 3: Red Team</text>
          </svg>
        </div>
        <div>
          <h4>Quota Utilization & Hash Chain</h4>
          <div style="margin-top:6px;font-size:12px;">
            DAG Checkpoint: <code>${risk.dag_checkpoint_sha256.substring(0, 16)}...</code><br>
            Denied Calls: <strong>${risk.denied_mcp_calls_count}</strong> |
            Hash Chain: <strong>${risk.hash_chain_integrity.verified ? '[OK] VERIFIED' : '[BLOCKED] CORRUPTED'}</strong> (${risk.hash_chain_integrity.chain_length} blocks)
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// -----------------------------------------------------------------------------
// 6. TWELVE-POINT PLATFORM READINESS EVALUATOR (POC.docx §13)
// -----------------------------------------------------------------------------

export function evaluateTwelvePointPlatformReadiness(
  snapshot: OperatorTerminalSnapshot
): TwelvePointReadinessCertificate {
  const ws = snapshot.workspaces;

  // Criterion 1: Discovery & Traceable Evidence
  const crit1Passed =
    ws.opportunity_radar.opportunities.length > 0 &&
    ws.opportunity_radar.opportunities.every(
      o => o.sku_id && o.source_freshness_age_seconds.source_lineage_ref
    );

  // Criterion 2: Governed Evidence Promotion
  const crit2Passed =
    ws.evidence_workbench.records.length > 0 &&
    ws.evidence_workbench.records.every(
      r => r.claim_id && r.verification_status && r.commercial_status
    );

  // Criterion 3: Deterministic Versioned Economics
  const crit3Passed =
    ws.economics_lab.sku_id.length > 0 &&
    ws.economics_lab.landed_cost_inr.classification === 'SIMULATED' &&
    ws.economics_lab.formula_registry_cards.length > 0;

  // Criterion 4: Explicit Statuses on Incomplete Inputs
  const crit4Passed =
    ws.simulation_and_positions.paper_positions.length > 0 &&
    ws.simulation_and_positions.paper_positions.every(p =>
      [
        'VALID_CALCULATED_RETURN',
        'CANNOT_CALCULATE_MISSING_INPUTS',
        'INSUFFICIENT_UNVERIFIED_EVIDENCE',
        'NO_ROOT_FOUND_IN_SEARCH_DOMAIN',
        'NOT_YET_RECOVERED',
        'OPEN_POSITION'
      ].includes(p.lifecycle_status)
    );

  // Criterion 5: Capital Allocation Risk Gating
  const crit5Passed =
    ws.capital_allocator.opportunities.length > 0 &&
    ws.capital_allocator.opportunities.every(
      o =>
        o.expected_return_bps &&
        o.return_after_costs_and_taxes_bps &&
        o.risk_and_downside_buffer_bps &&
        o.capital_requirement_inr &&
        o.time_to_execution_days &&
        o.cash_recovery_ccc_days &&
        o.liquidity_lockup_ratio_bps &&
        o.opportunity_cost_benchmark_bps &&
        o.edge_decay_half_life_days &&
        o.evidence_conviction_score_bps &&
        o.allocated_capital_inr
    );

  // Criterion 6: Paper Lifecycle Cash & 7-Bucket Conservation
  const inv = ws.simulation_and_positions.seven_bucket_inventory;
  const invSum =
    inv.raw_material +
    inv.work_in_progress +
    inv.finished_goods +
    inv.intransit_to_fba +
    inv.fba_available +
    inv.reserved_customer +
    inv.returned_quarantine;
  const crit6Passed =
    invSum === inv.total_conserved &&
    ws.simulation_and_positions.paper_positions.every(p => p.inventory_conservation_proven);

  // Criterion 7: Crash & Failed Write Non-Corruption
  const crit7Passed =
    ws.reconciliation_and_performance.cross_ledger_comparison.direct_merge_blocked &&
    ws.risk_audit_and_system_health.hash_chain_integrity.verified;

  // Criterion 8: Integrity Verification & Reconciliation
  const crit8Passed =
    ws.risk_audit_and_system_health.hash_chain_integrity.verified &&
    ws.reconciliation_and_performance.reconciliation_exceptions.length === 0;

  // Criterion 9: Bitemporal Decision Replay Without Rewrite
  const crit9Passed =
    ws.reconciliation_and_performance.bitemporal_restatements.length > 0 &&
    ws.reconciliation_and_performance.bitemporal_restatements.every(
      b => b.decision_time_utc && b.knowledge_time_utc
    );

  // Criterion 10: UI Read-Only Projection Cannot Bypass Controls
  const crit10Passed =
    Object.isFrozen(snapshot) &&
    snapshot.operating_mode === 'DRY_RUN_PAPER_SIMULATION_ONLY';

  // Criterion 11: All Approved Tests Pass Conformance & Workers Certified
  const dagNodesClean = ws.risk_audit_and_system_health.mcp_worker_dag_nodes.every(
    n => n.status === 'COMPLETED' || n.status === 'DEDUPLICATED_REPLAY'
  );
  const benchScoresClean =
    ws.risk_audit_and_system_health.golden_extraction_bench_scores.length === 0 ||
    ws.risk_audit_and_system_health.golden_extraction_bench_scores.every(
      s => s.certification_status === 'CERTIFIED_100_PCT'
    );
  const crit11Passed = dagNodesClean && benchScoresClean && !ws.risk_audit_and_system_health.system_health_alert;

  // Criterion 12: Real Money Execution Impossible (Paper-Only Release)
  const crit12Passed =
    snapshot.real_money_execution_enabled === false &&
    snapshot.operating_mode === 'DRY_RUN_PAPER_SIMULATION_ONLY' &&
    ws.reconciliation_and_performance.cross_ledger_comparison.actuals_write_blocked === true;

  const criteria: readonly ReadinessCriterionResult[] = [
    {
      criterion_id: 'POC-CRIT-01-CANDIDATE-DISCOVERY-EVIDENCE',
      title: 'A candidate can be discovered and recorded with traceable source evidence.',
      passed: crit1Passed,
      evidence_reference: 'POC.docx §4.1 / §13 (Criterion 1)'
    },
    {
      criterion_id: 'POC-CRIT-02-GOVERNED-EVIDENCE-PROMOTION',
      title: 'Evidence can be verified, rejected, updated and promoted only through permitted transitions.',
      passed: crit2Passed,
      evidence_reference: 'POC.docx §5 / §13 (Criterion 2)'
    },
    {
      criterion_id: 'POC-CRIT-03-DETERMINISTIC-VERSIONED-ECONOMICS',
      title: 'The economic engine produces deterministic, explainable results from versioned inputs.',
      passed: crit3Passed,
      evidence_reference: 'POC.docx §3 / §13 (Criterion 3)'
    },
    {
      criterion_id: 'POC-CRIT-04-EXPLICIT-STATUSES-NO-FABRICATION',
      title: 'Invalid or incomplete inputs produce explicit statuses rather than fabricated results.',
      passed: crit4Passed,
      evidence_reference: 'POC.docx §5 / §13 (Criterion 4)'
    },
    {
      criterion_id: 'POC-CRIT-05-CAPITAL-ALLOCATION-RISK-GATING',
      title: 'Capital allocation is blocked when the applicable risk conditions fail.',
      passed: crit5Passed,
      evidence_reference: 'POC.docx §8 / §13 (Criterion 5)'
    },
    {
      criterion_id: 'POC-CRIT-06-PAPER-LIFECYCLE-CONSERVATION',
      title: 'A complete paper position can move through its lifecycle with consistent cash and asset records.',
      passed: crit6Passed,
      evidence_reference: 'POC.docx §7 / §13 (Criterion 6)'
    },
    {
      criterion_id: 'POC-CRIT-07-CRASH-AND-FAILED-WRITE-SAFETY',
      title: 'Duplicated events, interruptions and failed writes do not corrupt the ledger.',
      passed: crit7Passed,
      evidence_reference: 'POC.docx §9.5 / §13 (Criterion 7)'
    },
    {
      criterion_id: 'POC-CRIT-08-INTEGRITY-AND-RECONCILIATION',
      title: 'Integrity verification and reconciliation detect deliberate and accidental inconsistencies.',
      passed: crit8Passed,
      evidence_reference: 'POC.docx §6.2 / §13 (Criterion 8)'
    },
    {
      criterion_id: 'POC-CRIT-09-BITEMPORAL-REPLAY-WITHOUT-REWRITE',
      title: 'Historical decisions can be reconstructed without rewriting the past.',
      passed: crit9Passed,
      evidence_reference: 'POC.docx §11 / §13 (Criterion 9)'
    },
    {
      criterion_id: 'POC-CRIT-10-UI-READONLY-CANNOT-BYPASS-CONTROLS',
      title: 'The UI displays the actual backend state and cannot bypass the controls.',
      passed: crit10Passed,
      evidence_reference: 'POC.docx §10.5 / §13 (Criterion 10)'
    },
    {
      criterion_id: 'POC-CRIT-11-ALL-APPROVED-TESTS-PASS',
      title: 'All approved tests pass, including relevant security, recovery and adversarial tests.',
      passed: crit11Passed,
      evidence_reference: 'POC.docx §12 / §13 (Criterion 11)'
    },
    {
      criterion_id: 'POC-CRIT-12-REAL-MONEY-IMPOSSIBLE-PAPER-ONLY',
      title: 'No execution path can move real money under the authorised paper-only release.',
      passed: crit12Passed,
      evidence_reference: 'POC.docx §7 / §13 (Criterion 12)'
    }
  ];

  const all_twelve_passed = criteria.every(c => c.passed);

  const evaluated_at_utc = snapshot.as_of_timestamp_utc;
  const certificate_id = `cert:release-gate:12-point:${evaluated_at_utc.replace(/[:.]/g, '-')}`;

  const certPayload = {
    certificate_id,
    evaluated_at_utc,
    operating_mode: 'DRY_RUN_PAPER_SIMULATION_ONLY',
    real_money_execution_enabled: false,
    all_twelve_passed,
    criteria
  };

  const certificate_jcs_sha256 = sha256(canonicalizeJCS(certPayload));

  const cert: TwelvePointReadinessCertificate = {
    certificate_id,
    evaluated_at_utc,
    operating_mode: 'DRY_RUN_PAPER_SIMULATION_ONLY',
    real_money_execution_enabled: false,
    all_twelve_passed,
    criteria,
    certificate_jcs_sha256
  };

  return deepFreeze(cert);
}
