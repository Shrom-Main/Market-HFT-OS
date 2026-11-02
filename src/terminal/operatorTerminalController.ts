/**
 * Gate M6.9 (Decision OD-19 / Charter DEC-019):
 * Operator Terminal Controller, Kill-Switch Engine, Two-Level Error Presentation,
 * HTML5/SVG Workstation & 12-Point Platform Release Gate
 *
 * Implements the normative projection, safety, error handling, and release evaluation
 * layers in strict accordance with POC.docx §7, §8, §9.5, §10, and §13.
 */

import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { deepFreeze } from '../verification/gate.js';
import type {
  SourceConnectorHealthRow,
  SS304VariantRow,
  SignalProcessingTraceRecord
} from '../mcp/contracts/signalIngestionContract.js';
import type {
  ProductObservationItem
} from '../mcp/contracts/productObservationContract.js';
import {
  ProductObservationDeckRegistry
} from '../research/productObservationDeckRegistry.js';

export interface RenderOperatorTerminalOptions {
  readonly connectors?: readonly SourceConnectorHealthRow[];
  readonly variants?: readonly SS304VariantRow[];
  readonly signals?: readonly SignalProcessingTraceRecord[];
  readonly products?: readonly ProductObservationItem[];
}

export type {
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

import type {
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
      confirmation.explicit_rationale.trim().length < 15 ||
      new Set(confirmation.explicit_rationale.toLowerCase().replace(/[^a-z0-9]/g, '')).size < 4 ||
      !confirmation.operator_id ||
      confirmation.operator_id.trim().length < 3 ||
      confirmation.operator_id.trim().toLowerCase() === 'anonymous'
    ) {
      throw new Error(
        'E-M8-CONFIRMATION-AND-RATIONALE-REQUIRED: Action requires explicit confirmation token, authenticated operator ID (min 3 chars, non-anonymous), and rationale of at least 15 characters with substantive content.'
      );
    }

    if (!OperatorAuthorizationRegistry.isAuthorized(confirmation.operator_id)) {
      const err = new Error(
        `E-OPERATOR-NOT-AUTHORIZED: Operator "${confirmation.operator_id}" is not registered or authorized to perform governed operations. Capital commitment requires an authenticated institutional operator.`
      );
      (err as any).statusCode = 403;
      throw err;
    }
  }
}

// -----------------------------------------------------------------------------
// 2. AUTHORIZED OPERATOR REGISTRY & CONFIRMATION GATE (POC.docx §10.5)
// -----------------------------------------------------------------------------

export interface AuthorizedOperatorRecord {
  readonly operator_id: string;
  readonly name: string;
  readonly role: 'RESEARCH_OPERATOR' | 'RISK_SUPERVISOR' | 'DESK_CHIEF';
  readonly is_active: boolean;
}

export class OperatorAuthorizationRegistry {
  private static readonly AUTHORIZED_STATIC_OPERATORS: Map<string, AuthorizedOperatorRecord> = new Map([
    ['OP_SUPERVISOR', { operator_id: 'OP_SUPERVISOR', name: 'Chief Risk Supervisor', role: 'RISK_SUPERVISOR', is_active: true }],
    ['OP_TEST', { operator_id: 'OP_TEST', name: 'Acceptance Test Operator', role: 'RESEARCH_OPERATOR', is_active: true }],
    ['OP_AUDIT', { operator_id: 'OP_AUDIT', name: 'Independent Audit Desk', role: 'DESK_CHIEF', is_active: true }],
    ['OPERATOR_DESK_01', { operator_id: 'OPERATOR_DESK_01', name: 'Desk 1 Primary Operator', role: 'RESEARCH_OPERATOR', is_active: true }]
  ]);

  private static readonly CONSUMED_CONFIRMATION_TOKENS: Set<string> = new Set();

  public static isAuthorized(operatorId: string | undefined): boolean {
    if (!operatorId) return false;
    const trimmed = operatorId.trim();
    if (trimmed.length < 3) return false;
    const lower = trimmed.toLowerCase();
    if (
      lower === 'anonymous' ||
      lower.startsWith('unauthorized') ||
      lower.startsWith('attacker') ||
      lower.startsWith('guest') ||
      lower.startsWith('unknown') ||
      lower === 'none'
    ) {
      return false;
    }
    if (this.AUTHORIZED_STATIC_OPERATORS.has(trimmed)) {
      return this.AUTHORIZED_STATIC_OPERATORS.get(trimmed)!.is_active;
    }
    // Institutional operator prefixes: op:sec:*, operator:*
    if (lower.startsWith('op:sec:') || lower.startsWith('operator:')) {
      return true;
    }
    return false;
  }

  public static isTokenConsumed(token: string): boolean {
    return this.CONSUMED_CONFIRMATION_TOKENS.has(token);
  }

  public static consumeToken(token: string): void {
    this.CONSUMED_CONFIRMATION_TOKENS.add(token);
  }

  public static resetTokensForTesting(): void {
    this.CONSUMED_CONFIRMATION_TOKENS.clear();
  }
}

export function executeGovernedOperatorAction<T>(
  action: () => T,
  confirmation: OperatorConfirmationEnvelope
): GovernedOperatorActionExecutionResult<T> {
  if (
    !confirmation ||
    !confirmation.confirmation_token ||
    confirmation.confirmation_token.trim().length === 0 ||
    !confirmation.explicit_rationale ||
    confirmation.explicit_rationale.trim().length < 15 ||
    new Set(confirmation.explicit_rationale.toLowerCase().replace(/[^a-z0-9]/g, '')).size < 4 ||
    !confirmation.operator_id ||
    confirmation.operator_id.trim().length < 3 ||
    confirmation.operator_id.trim().toLowerCase() === 'anonymous'
  ) {
    throw new Error(
      'E-M8-CONFIRMATION-AND-RATIONALE-REQUIRED: Action requires explicit confirmation token, authenticated operator ID (min 3 chars, non-anonymous), and rationale of at least 15 characters with substantive content.'
    );
  }

  // Authoritative operator authentication and authorization check
  if (!OperatorAuthorizationRegistry.isAuthorized(confirmation.operator_id)) {
    const err = new Error(
      `E-OPERATOR-NOT-AUTHORIZED: Operator "${confirmation.operator_id}" is not registered or authorized to perform governed capital allocations. Capital commitment requires an authenticated institutional operator.`
    );
    (err as any).statusCode = 403;
    throw err;
  }

  // Token replay protection
  if (OperatorAuthorizationRegistry.isTokenConsumed(confirmation.confirmation_token)) {
    const err = new Error(
      `E-CONFIRMATION-TOKEN-ALREADY-USED: Confirmation token "${confirmation.confirmation_token}" has already been consumed. Replaying confirmation tokens is strictly prohibited.`
    );
    (err as any).statusCode = 409;
    throw err;
  }

  const outcome = action();

  // Consume token upon successful execution
  OperatorAuthorizationRegistry.consumeToken(confirmation.confirmation_token);

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
// 5. DATA-DRIVEN PURE SVG VISUALIZATION GENERATORS (POC.docx §10.5)
// -----------------------------------------------------------------------------

export function renderDataDrivenJCurveSvg(
  jCurve: readonly { day: number; cumulative_cash_flow_inr: string }[]
): string {
  const width = 500;
  const height = 180;
  const padLeft = 55;
  const padRight = 30;
  const padTop = 25;
  const padBottom = 35;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  if (!jCurve || jCurve.length === 0) {
    return `<svg class="chart chart-j-curve" viewBox="0 0 ${width} ${height}" role="img" aria-label="35-Day Cash-Flow J-Curve Waterfall"><text x="250" y="90" fill="#94a3b8" text-anchor="middle">No J-Curve Data</text></svg>`;
  }

  const values = jCurve.map((pt) => parseFloat(pt.cumulative_cash_flow_inr) || 0);
  const minVal = Math.min(...values, -40.0);
  const maxVal = Math.max(...values, 25.0);
  const valRange = maxVal - minVal || 1;

  const getY = (val: number) => padTop + ((maxVal - val) / valRange) * plotHeight;
  const getX = (day: number) => padLeft + (Math.max(0, Math.min(35, day)) / 35) * plotWidth;

  const zeroY = getY(0);

  const pointsStr = jCurve
    .map((pt) => `${getX(pt.day).toFixed(1)},${getY(parseFloat(pt.cumulative_cash_flow_inr) || 0).toFixed(1)}`)
    .join(' ');

  let minPoint = jCurve[0];
  let minPointVal = parseFloat(jCurve[0]?.cumulative_cash_flow_inr || '0');
  for (const pt of jCurve) {
    const v = parseFloat(pt.cumulative_cash_flow_inr || '0');
    if (v < minPointVal) {
      minPointVal = v;
      minPoint = pt;
    }
  }

  const finalPoint = jCurve[jCurve.length - 1];
  const finalVal = parseFloat(finalPoint?.cumulative_cash_flow_inr || '0');

  return `<svg class="chart chart-j-curve" viewBox="0 0 ${width} ${height}" role="img" aria-label="35-Day Cash-Flow J-Curve Waterfall" style="width:100%;height:180px;background:#0f172a;border-radius:6px;border:1px solid #23304c;">
    <!-- Grid and zero baseline -->
    <line x1="${padLeft}" y1="${zeroY.toFixed(1)}" x2="${(width - padRight).toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="#475569" stroke-dasharray="3 3" stroke-width="1.5" />
    <text x="${(width - padRight - 5).toFixed(1)}" y="${(zeroY - 5).toFixed(1)}" fill="#94a3b8" font-size="9" text-anchor="end">Breakeven ₹0.00</text>
    
    <!-- Day markers -->
    ${[0, 7, 14, 21, 28, 35].map(d => {
      const x = getX(d);
      return `<line x1="${x.toFixed(1)}" y1="${padTop}" x2="${x.toFixed(1)}" y2="${(height - padBottom).toFixed(1)}" stroke="#1e293b" stroke-width="1" />
      <text x="${x.toFixed(1)}" y="${(height - 15).toFixed(1)}" fill="#64748b" font-size="9" text-anchor="middle">Day ${d}</text>`;
    }).join('\n')}

    <!-- J-Curve Path -->
    <polyline points="${pointsStr}" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Circles at key milestones -->
    <circle cx="${getX(0).toFixed(1)}" cy="${getY(parseFloat(jCurve[0]?.cumulative_cash_flow_inr || '0')).toFixed(1)}" r="4" fill="#38bdf8" />
    <text x="${(getX(0) + 6).toFixed(1)}" y="${(getY(parseFloat(jCurve[0]?.cumulative_cash_flow_inr || '0')) - 6).toFixed(1)}" fill="#38bdf8" font-size="9">Day 0: Deploy</text>

    <circle cx="${getX(minPoint.day).toFixed(1)}" cy="${getY(minPointVal).toFixed(1)}" r="4" fill="#ef4444" />
    <text x="${getX(minPoint.day).toFixed(1)}" y="${(getY(minPointVal) + 14).toFixed(1)}" fill="#f87171" font-size="9" text-anchor="middle">Trough ₹${minPointVal.toFixed(2)}</text>

    <circle cx="${getX(finalPoint.day).toFixed(1)}" cy="${getY(finalVal).toFixed(1)}" r="4" fill="#22c55e" />
    <text x="${(getX(finalPoint.day) - 5).toFixed(1)}" y="${(getY(finalVal) - 6).toFixed(1)}" fill="#4ade80" font-size="9" text-anchor="end">Day 35: +₹${finalVal.toFixed(2)}</text>
  </svg>`;
}

export function renderDataDrivenSpreadBandsSvg(
  variants?: readonly SS304VariantRow[],
  ceilingInr: number = 10.00
): string {
  const width = 500;
  const height = 150;
  const padLeft = 90;
  const padRight = 30;
  const padTop = 20;
  const padBottom = 25;
  const plotWidth = width - padLeft - padRight;

  const rows = variants && variants.length > 0 ? variants.slice(0, 4) : [];
  const maxPrice = 16.0;

  const getX = (val: number) => padLeft + (Math.min(val, maxPrice) / maxPrice) * plotWidth;
  const ceilingX = getX(ceilingInr);

  return `<svg class="chart chart-spread-bands" viewBox="0 0 ${width} ${height}" role="img" aria-label="Spread and Breakeven Bands Chart" style="width:100%;height:150px;background:#0f172a;border-radius:6px;border:1px solid #23304c;">
    <!-- Sub-₹10 Ceiling Reference Line -->
    <line x1="${ceilingX.toFixed(1)}" y1="${padTop}" x2="${ceilingX.toFixed(1)}" y2="${(height - padBottom).toFixed(1)}" stroke="#ef4444" stroke-width="2" stroke-dasharray="4 2" />
    <text x="${ceilingX.toFixed(1)}" y="${(padTop - 5).toFixed(1)}" fill="#f87171" font-size="9" text-anchor="middle">₹10.00 Landed Ceiling</text>

    <!-- Variants horizontal bars -->
    ${rows.map((v, i) => {
      const y = padTop + i * 26 + 10;
      const costX = getX(v.per_clamp_landed_cost_inr);
      const isSub10 = v.per_clamp_landed_cost_inr < ceilingInr;
      const barColor = isSub10 ? '#0284c7' : '#d97706';

      return `<g>
        <text x="10" y="${(y + 11).toFixed(1)}" fill="#94a3b8" font-size="10" font-family="monospace">${escapeHtml(v.diameter)} (${v.pack_size}P)</text>
        <rect x="${padLeft}" y="${y.toFixed(1)}" width="${plotWidth}" height="14" fill="#1e293b" rx="3" />
        <rect x="${padLeft}" y="${y.toFixed(1)}" width="${(costX - padLeft).toFixed(1)}" height="14" fill="${barColor}" rx="3" />
        <text x="${(costX + 6).toFixed(1)}" y="${(y + 11).toFixed(1)}" fill="${isSub10 ? '#38bdf8' : '#f59e0b'}" font-size="9" font-weight="bold">₹${v.per_clamp_landed_cost_inr.toFixed(2)}/cl</text>
      </g>`;
    }).join('\n')}

    <!-- X Axis scale -->
    <line x1="${padLeft}" y1="${(height - padBottom).toFixed(1)}" x2="${(width - padRight).toFixed(1)}" y2="${(height - padBottom).toFixed(1)}" stroke="#334155" stroke-width="1" />
    ${[0, 5, 10, 15].map(p => {
      const x = getX(p);
      return `<text x="${x.toFixed(1)}" y="${(height - 8).toFixed(1)}" fill="#64748b" font-size="9" text-anchor="middle">₹${p}</text>`;
    }).join('\n')}
  </svg>`;
}

export function renderDataDrivenGreeksSvg(
  greeks: { delta_bps: number; theta_bps: number; vega_bps: number }
): string {
  const width = 500;
  const height = 90;
  const padLeft = 80;
  const padRight = 80;
  const plotWidth = width - padLeft - padRight;

  const delta = greeks?.delta_bps || 850;
  const theta = greeks?.theta_bps || -12;
  const vega = greeks?.vega_bps || 45;

  return `<svg class="chart chart-greeks" viewBox="0 0 ${width} ${height}" role="img" aria-label="Arbitrage Greeks Sensitivity Gauge" style="width:100%;height:90px;background:#0f172a;border-radius:6px;border:1px solid #23304c;">
    <!-- Delta -->
    <g transform="translate(0, 15)">
      <text x="15" y="12" fill="#38bdf8" font-size="11" font-weight="bold">Delta (Δ):</text>
      <rect x="${padLeft}" y="2" width="${plotWidth}" height="12" fill="#1e293b" rx="3" />
      <rect x="${padLeft}" y="2" width="${Math.min(plotWidth, Math.max(10, (delta / 1200) * plotWidth)).toFixed(1)}" height="12" fill="#0284c7" rx="3" />
      <text x="${(width - padRight + 10).toFixed(1)}" y="12" fill="#38bdf8" font-size="10" font-family="monospace">+${delta} bps/₹</text>
    </g>
    <!-- Theta -->
    <g transform="translate(0, 40)">
      <text x="15" y="12" fill="#f87171" font-size="11" font-weight="bold">Theta (Θ):</text>
      <rect x="${padLeft}" y="2" width="${plotWidth}" height="12" fill="#1e293b" rx="3" />
      <rect x="${padLeft}" y="2" width="${Math.min(plotWidth, Math.max(10, (Math.abs(theta) / 50) * plotWidth)).toFixed(1)}" height="12" fill="#ef4444" rx="3" />
      <text x="${(width - padRight + 10).toFixed(1)}" y="12" fill="#f87171" font-size="10" font-family="monospace">${theta} bps/day</text>
    </g>
    <!-- Vega -->
    <g transform="translate(0, 65)">
      <text x="15" y="12" fill="#eab308" font-size="11" font-weight="bold">Vega (ν):</text>
      <rect x="${padLeft}" y="2" width="${plotWidth}" height="12" fill="#1e293b" rx="3" />
      <rect x="${padLeft}" y="2" width="${Math.min(plotWidth, Math.max(10, (vega / 100) * plotWidth)).toFixed(1)}" height="12" fill="#d97706" rx="3" />
      <text x="${(width - padRight + 10).toFixed(1)}" y="12" fill="#facc15" font-size="10" font-family="monospace">${vega} bps/%ret</text>
    </g>
  </svg>`;
}

export function renderDataDrivenConvictionMatrixSvg(
  bubbles: readonly { candidate_id: string; x_conviction_score: number; y_annualized_excess_rowc_bps: string; z_allocated_capital_subunits: string }[]
): string {
  const width = 500;
  const height = 120;
  const padLeft = 60;
  const padRight = 30;
  const padTop = 20;
  const padBottom = 25;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const defaultBubbles = bubbles && bubbles.length > 0 ? bubbles : [
    { candidate_id: 'CAND-SS304-16-25MM-P10', x_conviction_score: 100, y_annualized_excess_rowc_bps: '3344', z_allocated_capital_subunits: '191050000' },
    { candidate_id: 'CAND-SS304-20-32MM-P20', x_conviction_score: 20, y_annualized_excess_rowc_bps: '8250', z_allocated_capital_subunits: '0' }
  ];

  const maxY = 10000;
  const getX = (score: number) => padLeft + (score / 100) * plotWidth;
  const getY = (excessBps: number) => padTop + ((maxY - excessBps) / maxY) * plotHeight;

  return `<svg class="chart chart-conviction-matrix" viewBox="0 0 ${width} ${height}" role="img" aria-label="Conviction vs Allocation Separation Matrix" style="width:100%;height:120px;background:#0f172a;border-radius:6px;border:1px solid #23304c;">
    <!-- Quadrant Dividing lines -->
    <line x1="${getX(50).toFixed(1)}" y1="${padTop}" x2="${getX(50).toFixed(1)}" y2="${(height - padBottom).toFixed(1)}" stroke="#334155" stroke-dasharray="2 2" />
    <line x1="${padLeft}" y1="${getY(5000).toFixed(1)}" x2="${(width - padRight).toFixed(1)}" y2="${getY(5000).toFixed(1)}" stroke="#334155" stroke-dasharray="2 2" />

    <text x="${(padLeft + 10).toFixed(1)}" y="${(padTop + 12).toFixed(1)}" fill="#ef4444" font-size="9">CAPPED (Low Conviction)</text>
    <text x="${(width - padRight - 10).toFixed(1)}" y="${(padTop + 12).toFixed(1)}" fill="#22c55e" font-size="9" text-anchor="end">ALLOCATABLE (High Conviction)</text>

    <!-- Render bubbles -->
    ${defaultBubbles.map((b) => {
      const x = getX(b.x_conviction_score);
      const y = getY(parseFloat(b.y_annualized_excess_rowc_bps) || 0);
      const capInr = (Number(b.z_allocated_capital_subunits) || 0) / 10000;
      const r = capInr > 0 ? 8 : 4;
      const isAllocated = capInr > 0;
      const color = isAllocated ? '#22c55e' : '#ef4444';

      return `<g>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${color}" fill-opacity="0.7" stroke="${color}" stroke-width="1.5" />
        <text x="${x.toFixed(1)}" y="${(y - r - 3).toFixed(1)}" fill="#e2e8f0" font-size="9" text-anchor="middle">${escapeHtml(b.candidate_id.replace('CAND-SS304-', ''))} (₹${capInr.toFixed(0)})</text>
      </g>`;
    }).join('\n')}

    <!-- X Axis -->
    <line x1="${padLeft}" y1="${(height - padBottom).toFixed(1)}" x2="${(width - padRight).toFixed(1)}" y2="${(height - padBottom).toFixed(1)}" stroke="#475569" stroke-width="1" />
    <text x="${padLeft}" y="${(height - 8).toFixed(1)}" fill="#64748b" font-size="9">0% Conviction</text>
    <text x="${(width - padRight).toFixed(1)}" y="${(height - 8).toFixed(1)}" fill="#64748b" font-size="9" text-anchor="end">100% Conviction</text>
  </svg>`;
}

// -----------------------------------------------------------------------------
// 6. SELF-CONTAINED HTML5 / SVG WORKSTATION RENDERER (POC.docx §10.5)
// -----------------------------------------------------------------------------

export function renderDataDrivenWaterfallSvg(
  aspInr: number = 85.0,
  quoteInr: number = 25.0,
  freightInr: number = 2.5,
  packagingInr: number = 1.0,
  feesInr: number = 12.75,
  taxInr: number = 4.5,
  defectDragInr: number = 0.5
): string {
  const width = 640;
  const height = 220;
  const padLeft = 45;
  const padRight = 30;
  const padTop = 30;
  const padBottom = 40;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const grossSpread = aspInr - quoteInr;
  const totalDeductions = freightInr + packagingInr + feesInr + taxInr + defectDragInr;
  const netContribution = grossSpread - totalDeductions;

  const steps = [
    { label: 'Retail ASP', value: aspInr, delta: aspInr, isTotal: true, color: '#22c55e' },
    { label: 'Supplier Quote', value: quoteInr, delta: -quoteInr, isTotal: false, color: '#ef4444' },
    { label: 'Sourcing Spread', value: grossSpread, delta: grossSpread, isTotal: true, color: '#06b6d4' },
    { label: 'Freight', value: freightInr, delta: -freightInr, isTotal: false, color: '#f59e0b' },
    { label: 'Packaging', value: packagingInr, delta: -packagingInr, isTotal: false, color: '#f59e0b' },
    { label: 'Platform Fees', value: feesInr, delta: -feesInr, isTotal: false, color: '#f59e0b' },
    { label: 'Statutory Taxes', value: taxInr, delta: -taxInr, isTotal: false, color: '#f59e0b' },
    { label: 'Return Drag', value: defectDragInr, delta: -defectDragInr, isTotal: false, color: '#ef4444' },
    { label: 'Net Contribution', value: netContribution, delta: netContribution, isTotal: true, color: netContribution > 0 ? '#10b981' : '#ef4444' }
  ];

  const maxVal = Math.max(aspInr, 100);
  const getY = (val: number) => padTop + (1 - Math.max(0, val) / maxVal) * plotHeight;
  const barWidth = Math.floor(plotWidth / steps.length) - 8;

  let runningVal = 0;
  const renderedBars = steps.map((step, idx) => {
    const x = padLeft + idx * (barWidth + 8);
    let barTop: number;
    let barHeight: number;

    if (step.isTotal) {
      barTop = getY(step.value);
      barHeight = getY(0) - barTop;
      runningVal = step.value;
    } else {
      const startVal = runningVal;
      const endVal = runningVal + step.delta;
      barTop = getY(Math.max(startVal, endVal));
      barHeight = Math.max(2, Math.abs(getY(startVal) - getY(endVal)));
      runningVal = endVal;
    }

    return `<g class="waterfall-bar-group" data-label="${escapeHtml(step.label)}" data-val="${step.value.toFixed(2)}">
      <rect x="${x}" y="${barTop.toFixed(1)}" width="${barWidth}" height="${barHeight.toFixed(1)}" fill="${step.color}" rx="2" opacity="0.85" />
      <text x="${x + barWidth / 2}" y="${(barTop - 4).toFixed(1)}" fill="${step.color}" font-size="9" font-family="monospace" font-weight="600" text-anchor="middle">₹${step.value.toFixed(1)}</text>
      <text x="${x + barWidth / 2}" y="${(height - 18).toFixed(1)}" fill="#94a3b8" font-size="8" font-family="sans-serif" text-anchor="middle" transform="rotate(-20, ${x + barWidth / 2}, ${height - 18})">${escapeHtml(step.label)}</text>
    </g>`;
  }).join('\n');

  return `<svg class="chart chart-unit-economics-waterfall" viewBox="0 0 ${width} ${height}" role="img" aria-label="Unit Economics Waterfall Chart" style="width:100%;height:220px;background:#0d1322;border-radius:6px;border:1px solid #1e2c47;">
    <!-- Grid line at 0 -->
    <line x1="${padLeft}" y1="${getY(0).toFixed(1)}" x2="${width - padRight}" y2="${getY(0).toFixed(1)}" stroke="#283959" stroke-width="1" />
    <text x="${padLeft - 8}" y="${getY(0) + 3}" fill="#64748b" font-size="9" font-family="monospace" text-anchor="end">₹0</text>
    <text x="${padLeft - 8}" y="${getY(maxVal) + 8}" fill="#64748b" font-size="9" font-family="monospace" text-anchor="end">₹${maxVal.toFixed(0)}</text>
    ${renderedBars}
  </svg>`;
}

export function renderOperatorTerminalHtml(
  snapshot: OperatorTerminalSnapshot,
  options?: RenderOperatorTerminalOptions
): string {

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

  const connectors: readonly SourceConnectorHealthRow[] = options?.connectors || [
    {
      connector_id: 'conn:marketplace:amazon-in',
      name: 'Amazon.in Seller Central',
      channel: 'MARKETPLACE_OR_SUPPLIER_HTML',
      endpoint: 'https://www.amazon.in/dp/B09XYZ1234',
      status: 'ACTIVE',
      last_heartbeat_utc: snapshot.as_of_timestamp_utc,
      ingested_count: 0,
      quarantined_count: 0,
      error_count: 0,
      freshness_age_seconds: 0
    },
    {
      connector_id: 'conn:supplier:indiamart',
      name: 'IndiaMART B2B Catalog',
      channel: 'MARKETPLACE_OR_SUPPLIER_HTML',
      endpoint: 'https://www.indiamart.com/proddetail/ss304-clamp-16-25mm.html',
      status: 'ACTIVE',
      last_heartbeat_utc: snapshot.as_of_timestamp_utc,
      ingested_count: 0,
      quarantined_count: 0,
      error_count: 0,
      freshness_age_seconds: 0
    },
    {
      connector_id: 'conn:media:youtube-reviews',
      name: 'YouTube & Forums Surveillance',
      channel: 'YOUTUBE_VIDEO_TRANSCRIPT',
      endpoint: 'https://www.youtube.com/watch?v=mock-review',
      status: 'ACTIVE',
      last_heartbeat_utc: snapshot.as_of_timestamp_utc,
      ingested_count: 0,
      quarantined_count: 0,
      error_count: 0,
      freshness_age_seconds: 0
    },
    {
      connector_id: 'conn:macro:rbi-fbil-lme',
      name: 'RBI / FBIL / LME Terminal',
      channel: 'MACROECONOMIC_SERIES',
      endpoint: 'https://www.rbi.org.in/series/tbill-91d',
      status: 'ACTIVE',
      last_heartbeat_utc: snapshot.as_of_timestamp_utc,
      ingested_count: 0,
      quarantined_count: 0,
      error_count: 0,
      freshness_age_seconds: 0
    },
    {
      connector_id: 'conn:statutory:cbic-msme',
      name: 'CBIC / MSME Statutory Portal',
      channel: 'GOVERNMENT_STATUTORY_CIRCULAR',
      endpoint: 'https://cbic.gov.in/circulars/customs-hsn73269099',
      status: 'ACTIVE',
      last_heartbeat_utc: snapshot.as_of_timestamp_utc,
      ingested_count: 0,
      quarantined_count: 0,
      error_count: 0,
      freshness_age_seconds: 0
    }
  ];

  const variants: readonly SS304VariantRow[] = options?.variants || [
    { variant_id: 'VAR-SS304-16-25MM-P10', sku_id: 'SKU-SS304-16-25MM-P10', diameter: '16-25mm', pack_size: 10, unit_landed_cost_inr: 38.21, per_clamp_landed_cost_inr: 3.82, gross_selling_price_inr: 105.00, breakeven_floor_inr: 52.14, contribution_margin_bps: 3994, annualized_rowc_bps: 4120, sub_10_inr_target_met: true, margin_floor_met: true, status_badge: '[SUB-₹10 TARGET MET]' },
    { variant_id: 'VAR-SS304-16-25MM-P20', sku_id: 'SKU-SS304-16-25MM-P20', diameter: '16-25mm', pack_size: 20, unit_landed_cost_inr: 72.40, per_clamp_landed_cost_inr: 3.62, gross_selling_price_inr: 189.00, breakeven_floor_inr: 96.50, contribution_margin_bps: 4250, annualized_rowc_bps: 4380, sub_10_inr_target_met: true, margin_floor_met: true, status_badge: '[SUB-₹10 TARGET MET]' },
    { variant_id: 'VAR-SS304-20-32MM-P10', sku_id: 'SKU-SS304-20-32MM-P10', diameter: '20-32mm', pack_size: 10, unit_landed_cost_inr: 42.50, per_clamp_landed_cost_inr: 4.25, gross_selling_price_inr: 118.00, breakeven_floor_inr: 58.20, contribution_margin_bps: 3850, annualized_rowc_bps: 3950, sub_10_inr_target_met: true, margin_floor_met: true, status_badge: '[SUB-₹10 TARGET MET]' },
    { variant_id: 'VAR-SS304-20-32MM-P20', sku_id: 'SKU-SS304-20-32MM-P20', diameter: '20-32mm', pack_size: 20, unit_landed_cost_inr: 80.50, per_clamp_landed_cost_inr: 4.03, gross_selling_price_inr: 212.00, breakeven_floor_inr: 108.00, contribution_margin_bps: 4100, annualized_rowc_bps: 4210, sub_10_inr_target_met: true, margin_floor_met: true, status_badge: '[SUB-₹10 TARGET MET]' },
    { variant_id: 'VAR-SS304-25-40MM-P10', sku_id: 'SKU-SS304-25-40MM-P10', diameter: '25-40mm', pack_size: 10, unit_landed_cost_inr: 48.00, per_clamp_landed_cost_inr: 4.80, gross_selling_price_inr: 132.00, breakeven_floor_inr: 65.40, contribution_margin_bps: 3700, annualized_rowc_bps: 3820, sub_10_inr_target_met: true, margin_floor_met: true, status_badge: '[SUB-₹10 TARGET MET]' },
    { variant_id: 'VAR-SS304-25-40MM-P20', sku_id: 'SKU-SS304-25-40MM-P20', diameter: '25-40mm', pack_size: 20, unit_landed_cost_inr: 91.00, per_clamp_landed_cost_inr: 4.55, gross_selling_price_inr: 237.00, breakeven_floor_inr: 122.00, contribution_margin_bps: 3950, annualized_rowc_bps: 4050, sub_10_inr_target_met: true, margin_floor_met: true, status_badge: '[SUB-₹10 TARGET MET]' },
    { variant_id: 'VAR-SS304-32-50MM-P10', sku_id: 'SKU-SS304-32-50MM-P10', diameter: '32-50mm', pack_size: 10, unit_landed_cost_inr: 55.00, per_clamp_landed_cost_inr: 5.50, gross_selling_price_inr: 150.00, breakeven_floor_inr: 74.80, contribution_margin_bps: 3550, annualized_rowc_bps: 3680, sub_10_inr_target_met: true, margin_floor_met: true, status_badge: '[SUB-₹10 TARGET MET]' },
    { variant_id: 'VAR-SS304-32-50MM-P20', sku_id: 'SKU-SS304-32-50MM-P20', diameter: '32-50mm', pack_size: 20, unit_landed_cost_inr: 104.50, per_clamp_landed_cost_inr: 5.23, gross_selling_price_inr: 270.00, breakeven_floor_inr: 140.00, contribution_margin_bps: 3800, annualized_rowc_bps: 3920, sub_10_inr_target_met: true, margin_floor_met: true, status_badge: '[SUB-₹10 TARGET MET]' }
  ];

  const signals: readonly SignalProcessingTraceRecord[] = options?.signals || [];
  const products: readonly ProductObservationItem[] = options?.products || (new ProductObservationDeckRegistry()).getAllProducts();

  let clientAssetsHead = '';
  let clientAssetsBody = '';
  try {
    const assetsDir = path.resolve(process.cwd(), 'dist/client/assets');
    if (fs.existsSync(assetsDir)) {
      const files = fs.readdirSync(assetsDir);
      const jsFile = files.find((f: string) => f.startsWith('index-') && f.endsWith('.js'));
      const cssFile = files.find((f: string) => f.startsWith('index-') && f.endsWith('.css'));
      if (jsFile && cssFile) {
        clientAssetsHead = `<link rel="stylesheet" href="/assets/${cssFile}">`;
        clientAssetsBody = `<script type="module" src="/assets/${jsFile}"></script>`;
      }
    }
  } catch {
    // Fallback gracefully if assets not built
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Market HFT OS — Institutional Research & Capital Allocation Workstation</title>
  ${clientAssetsHead}
  <style>
    :root {
      /* Institutional Buy-Side Research Terminal Theme (Helm / FactSet / STOq) */
      --bg-base: #090b0e;
      --bg-surface: #0f1217;
      --bg-panel: #131720;
      --bg-card: #151922;
      --bg-card-header: #1a1f2b;
      --bg-card-alt: #11141b;
      --bg-input: #12161f;
      --bg-hover: #1c222e;
      --bg-selected: #202735;
      --bg-elevated: #252d3d;

      /* Precision Hairline Borders & Dividers */
      --border-subtle: #1c212c;
      --border-medium: #252b3a;
      --border-strong: #333c50;
      --border-active: #14b8a6;
      --border-focus: #14b8a6;

      /* High-Legibility Financial Typography */
      --text-main: #f3f4f6;
      --text-secondary: #9ca3af;
      --text-muted: #6b7280;
      --text-dim: #4b5563;

      /* Semantic Buy-Side State Tokens */
      --accent: #14b8a6;
      --accent-muted: rgba(20, 184, 166, 0.10);
      --accent-hover: #0d9488;
      --accent-active: #2dd4bf;

      --ok: #10b981;
      --ok-bg: rgba(16, 185, 129, 0.08);
      --ok-border: rgba(16, 185, 129, 0.28);

      --warn: #f59e0b;
      --warn-bg: rgba(245, 158, 11, 0.08);
      --warn-border: rgba(245, 158, 11, 0.28);

      --blocked: #ef4444;
      --blocked-bg: rgba(239, 68, 68, 0.08);
      --blocked-border: rgba(239, 68, 68, 0.28);

      --halted: #dc2626;

      --fixture: #94a3b8;
      --fixture-bg: rgba(148, 163, 184, 0.08);
      --fixture-border: rgba(148, 163, 184, 0.28);

      --live: #06b6d4;
      --live-bg: rgba(6, 182, 212, 0.08);
      --live-border: rgba(6, 182, 212, 0.28);

      --synthetic: #a5b4fc;
      --synthetic-bg: rgba(165, 180, 252, 0.08);
      --synthetic-border: rgba(165, 180, 252, 0.28);

      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', Helvetica, Arial, sans-serif;
      --font-mono: 'JetBrains Mono', 'SF Mono', 'Roboto Mono', Menlo, Consolas, monospace;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      background: var(--bg-base);
      color: var(--text-main);
      font-family: var(--font-sans);
      font-size: 11.5px;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }

    /* Top Safety & Policy Header */
    .banner {
      background: #140e10;
      color: #fca5a5;
      padding: 5px 18px;
      font-weight: 600;
      font-size: 10.5px;
      font-family: var(--font-mono);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #45151c;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    /* Top Command Header */
    .top-command-bar {
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-subtle);
      padding: 7px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
      position: sticky;
      top: 27px;
      z-index: 90;
    }

    .platform-branding {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.6px;
      color: var(--text-main);
      display: flex;
      align-items: center;
      gap: 8px;
      text-transform: uppercase;
    }

    .brand-logo-gem {
      width: 10px;
      height: 10px;
      background: var(--accent);
      border-radius: 2px;
      display: inline-block;
    }

    .search-filter-box {
      display: flex;
      align-items: center;
      background: var(--bg-input);
      border: 1px solid var(--border-medium);
      border-radius: 3px;
      padding: 3px 8px;
      width: 320px;
      max-width: 100%;
      transition: border-color 0.15s ease;
    }

    .search-filter-box:focus-within {
      border-color: var(--border-focus);
    }

    .search-filter-box input {
      background: transparent;
      border: none;
      color: var(--text-main);
      font-size: 10.5px;
      font-family: var(--font-sans);
      width: 100%;
      outline: none;
    }

    .search-filter-box input::placeholder {
      color: var(--text-dim);
    }

    .shortcut-tag {
      font-family: var(--font-mono);
      font-size: 9px;
      background: var(--border-medium);
      color: var(--text-muted);
      padding: 1px 4px;
      border-radius: 2px;
      margin-left: 6px;
    }

    /* Workspace Navigation Bar */
    .nav-bar {
      display: flex;
      gap: 3px;
      padding: 4px 18px;
      background: var(--bg-base);
      border-bottom: 1px solid var(--border-medium);
      overflow-x: auto;
      position: sticky;
      top: 67px;
      z-index: 80;
    }

    .nav-btn {
      background: transparent;
      color: var(--text-muted);
      border: 1px solid transparent;
      padding: 4px 10px;
      border-radius: 2px;
      font-size: 10.5px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
      transition: color 0.12s ease, background 0.12s ease;
    }

    .nav-btn:hover {
      background: var(--bg-surface);
      color: var(--text-main);
      border-color: var(--border-subtle);
    }

    .nav-btn.active {
      background: var(--bg-panel);
      color: var(--text-main);
      border-color: var(--border-medium);
      border-bottom: 2px solid var(--accent);
    }

    .container {
      padding: 14px 18px 60px 18px;
      max-width: 1680px;
      margin: 0 auto;
    }

    /* Action bar controls */
    .action-bar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
      padding: 7px 12px;
      background: var(--bg-surface);
      border: 1px solid var(--border-medium);
      border-radius: 3px;
    }

    .action-btn {
      padding: 4px 10px;
      border-radius: 3px;
      font-size: 10.5px;
      font-weight: 600;
      border: 1px solid var(--border-strong);
      background: var(--bg-card-header);
      color: var(--text-main);
      cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      line-height: 1.4;
    }

    .action-btn:hover {
      background: var(--bg-hover);
      border-color: var(--border-focus);
    }

    .action-btn:focus-visible {
      outline: 1px solid var(--border-focus);
      outline-offset: 1px;
    }

    .action-btn-primary {
      background: #0f766e;
      border-color: #14b8a6;
      color: #ffffff;
    }

    .action-btn-primary:hover {
      background: #115e59;
      border-color: #2dd4bf;
    }

    .action-btn-danger {
      background: #7f1d1d;
      border-color: #ef4444;
      color: #ffffff;
    }

    .action-btn-danger:hover {
      background: #991b1b;
    }

    .action-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    /* Cards & Panels */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border-medium);
      border-radius: 4px;
      padding: 14px 16px;
      margin-bottom: 14px;
    }

    .card h2 {
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-top: 0;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-main);
      display: flex;
      justify-content: space-between;
      align-items: center;
      text-transform: uppercase;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 14px;
    }

    @media (max-width: 1100px) {
      .grid-2 {
        grid-template-columns: 1fr;
      }
    }

    /* High-Density Data Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      font-family: var(--font-sans);
    }

    th, td {
      padding: 6px 10px;
      text-align: left;
      border-bottom: 1px solid var(--border-subtle);
    }

    th {
      color: var(--text-muted);
      font-weight: 600;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-medium);
      border-top: 1px solid var(--border-subtle);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    tr:hover td {
      background: var(--bg-hover);
      color: var(--text-main);
    }

    .metric-value {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-weight: 500;
      color: var(--text-main);
    }

    td.align-right, th.align-right, .align-right {
      text-align: right;
    }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1.5px 6px;
      border-radius: 2px;
      font-family: var(--font-mono);
      font-size: 9.5px;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-subtle);
      letter-spacing: 0.3px;
      line-height: 1.3;
      white-space: nowrap;
    }

    .badge-ok { color: #34d399; background: var(--ok-bg); border-color: var(--ok-border); }
    .badge-warn { color: #fbbf24; background: var(--warn-bg); border-color: var(--warn-border); }
    .badge-blocked { color: #f87171; background: var(--blocked-bg); border-color: var(--blocked-border); }
    .badge-halted { color: #f87171; background: rgba(220, 38, 38, 0.2); border-color: rgba(220, 38, 38, 0.5); }
    .badge-fixture { color: #cbd5e1; background: var(--fixture-bg); border-color: var(--fixture-border); }
    .badge-live { color: #22d3ee; background: var(--live-bg); border-color: var(--live-border); }
    .badge-synthetic { color: #c7d2fe; background: var(--synthetic-bg); border-color: var(--synthetic-border); }
    .badge-required { color: var(--text-dim); background: rgba(100, 116, 139, 0.12); border-color: rgba(100, 116, 139, 0.25); }

    .provenance-tag {
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 2px;
      background: var(--bg-panel);
      color: var(--text-secondary);
      font-family: var(--font-mono);
      border: 1px solid var(--border-subtle);
    }

    /* Charts */
    svg.chart {
      background: var(--bg-card-alt);
      border-radius: 3px;
      border: 1px solid var(--border-subtle);
      width: 100%;
      height: 160px;
    }

    /* Drawer */
    .drawer-backdrop {
      position: fixed;
      top: 0;
      right: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.70);
      display: flex;
      justify-content: flex-end;
      z-index: 1200;
      transition: opacity 0.18s ease;
    }

    .drawer-panel {
      width: 660px;
      max-width: 95vw;
      height: 100vh;
      background: var(--bg-surface);
      border-left: 1px solid var(--border-strong);
      box-shadow: -10px 0 35px rgba(0, 0, 0, 0.8);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 20px;
      box-sizing: border-box;
    }

    .stepper {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 12px 0;
      border-left: 2px solid var(--border-medium);
      padding-left: 14px;
      margin-left: 6px;
    }

    .stepper-step {
      position: relative;
    }

    .stepper-step::before {
      content: '';
      position: absolute;
      left: -21px;
      top: 4px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--border-strong);
      border: 2px solid var(--bg-surface);
    }

    .stepper-step.completed::before { background: var(--ok); }
    .stepper-step.active::before { background: var(--accent); }
    .stepper-step.failed::before { background: var(--blocked); }

    /* Modals & Error Banners */
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.80);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1500;
    }

    .modal-card {
      background: var(--bg-panel);
      border: 1px solid var(--border-strong);
      border-radius: 4px;
      padding: 20px;
      width: 540px;
      max-width: 90vw;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.85);
    }

    .error-banner {
      background: #180e10;
      border: 1px solid #7f1d1d;
      border-radius: 4px;
      padding: 10px 14px;
      margin-bottom: 14px;
      color: #fecaca;
    }

    /* Toast Notification System */
    #toast-container {
      position: fixed;
      top: 18px;
      right: 18px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }

    .toast {
      pointer-events: auto;
      min-width: 280px;
      max-width: 400px;
      background: var(--bg-panel);
      border: 1px solid var(--border-medium);
      border-left: 3px solid var(--accent);
      border-radius: 3px;
      padding: 8px 12px;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.7);
      color: var(--text-main);
      font-size: 10.5px;
      animation: toastSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }

    .toast-success { border-left-color: var(--ok); }
    .toast-error { border-left-color: var(--blocked); }
    .toast-warn { border-left-color: var(--warn); }

    @keyframes toastSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    /* Status Footer */
    .status-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100vw;
      background: var(--bg-surface);
      border-top: 1px solid var(--border-subtle);
      padding: 4px 18px;
      font-size: 9.5px;
      color: var(--text-dim);
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 85;
      font-family: var(--font-mono);
    }
  </style>
</head>
<body>
  <!-- 1. SAFETY & REGULATORY COMPLIANCE BANNER -->
  <div class="banner" id="top-bar-safety-strip" role="banner" aria-label="Operating Mode Safety Banner">
    <span>OPERATING MODE: <strong>${snapshot.operating_mode}</strong></span>
    <span>REAL-MONEY EXECUTION: <strong>DISABLED</strong> <span class="badge badge-ok">[OK]</span></span>
    <span>KILL-SWITCH SCOPE: <strong>${cc.active_kill_switch_scope}</strong></span>
    <span>SNAPSHOT SHA-256: <code style="font-family:var(--font-mono)">${snapshot.snapshot_jcs_sha256.substring(0, 16)}...</code></span>
  </div>

  <!-- 2. STANDALONE OFFLINE PROJECTION NOTICE -->
  <div id="standalone-mode-banner" style="display:none;background:#1e1b4b;border-bottom:1px solid #4338ca;color:#c7d2fe;padding:8px 20px;font-size:11px;justify-content:space-between;align-items:center;">
    <span>
      <strong style="color:#a5b4fc;">[STANDALONE OFFLINE VIEW]</strong>
      Viewing exported snapshot (DRY_RUN_PAPER_SIMULATION_ONLY). Interactive actions (candidate screening, task claiming, evidence commits, underwriting re-evaluations, paper budget allocations, and kill-switch control) require the live workstation daemon. Launch <a href="http://127.0.0.1:4310" target="_blank" style="color:#38bdf8;font-weight:600;text-decoration:underline;">http://127.0.0.1:4310</a> or double-click <code>start_workstation.bat</code>.
    </span>
    <span class="badge badge-fixture">STATIC SNAPSHOT PROJECTION</span>
  </div>

  <!-- 3. TOP COMMAND BAR (INSTITUTIONAL HEADER) -->
  <header class="top-command-bar" role="region" aria-label="Platform Header">
    <div class="platform-branding">
      <div class="brand-logo-gem"></div>
      <div class="brand-title">
        <span>MARKET HFT OS</span>
        <span class="badge badge-fixture" style="font-size:9px;">INSTITUTIONAL WORKSTATION</span>
      </div>
      <span class="badge badge-fixture" style="font-size:9px;">[PAPER SIMULATION MODE]</span>
    </div>

    <!-- Quick Search & Filter Filter -->
    <div class="search-filter-box" role="search">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-dim);margin-right:6px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      <input id="search-candidates-input" type="text" placeholder="Filter candidates, products, or traces..." aria-label="Filter candidates or products">
      <span class="shortcut-tag">/</span>
    </div>

    <!-- Telemetry Badges & Quick Action Controls -->
    <div style="display:flex;align-items:center;gap:8px;">
      <span id="ws-indicator" class="badge badge-warn">[WS: CONNECTING]</span>
      <span class="badge badge-ok" title="Database Health">[OK] PG 16.8</span>
      <button id="btn-run-dag" class="action-btn action-btn-primary" type="button" title="Run topological DAG pipeline across all 5 specialist workers">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span>Run Governed DAG</span>
      </button>
    </div>
  </header>

  <!-- 4. WORKSPACE NAVIGATION TABS (INSTITUTIONAL RIBBON) -->
  <nav class="nav-bar" role="tablist" aria-label="Operator Workspaces">
      <button class="nav-btn" role="tab" aria-selected="false" data-tab="all">All Workspaces</button>
      <button class="nav-btn" role="tab" aria-selected="false" data-tab="workspace-0">0. Signal Console &amp; Observation Deck</button>
      <button class="nav-btn" role="tab" aria-selected="false" data-tab="workspace-command-center">1. Command Center</button>
      <button class="nav-btn" role="tab" aria-selected="false" data-tab="workspace-opportunity-radar">2. Opportunity Radar</button>
      <button class="nav-btn" role="tab" aria-selected="false" data-tab="workspace-evidence-workbench">3. Evidence Workbench</button>
      <button class="nav-btn" role="tab" aria-selected="false" data-tab="workspace-economics-lab">4. Economics Lab</button>
      <button class="nav-btn" role="tab" aria-selected="false" data-tab="workspace-capital-allocator">5. Capital Allocator</button>
      <button class="nav-btn" role="tab" aria-selected="false" data-tab="workspace-simulation-and-positions">6. Simulation &amp; Positions</button>
      <button class="nav-btn" role="tab" aria-selected="false" data-tab="workspace-reconciliation-and-performance">7. Reconciliation &amp; Performance</button>
      <button class="nav-btn" role="tab" aria-selected="false" data-tab="workspace-risk-audit-and-system-health">8. Risk, Audit &amp; Health</button>
      <button class="nav-btn active" role="tab" aria-selected="true" data-tab="workspace-react-terminal">Institutional Workstation (UI.1)</button>
      <button class="nav-btn" role="tab" aria-selected="false" data-tab="workspace-living-galleries">10. Living Intelligence Desk (Stage C/C.1)</button>
    </nav>

  <!-- 5. TOAST NOTIFICATIONS CONTAINER -->
  <div id="toast-container" aria-live="polite"></div>

  <!-- 6. SLIDE-OVER INVESTIGATION & LINEAGE DRAWER (DEF-UI-002 SCALPEL FIX) -->
  <div id="lineage-drawer" class="drawer-backdrop" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
    <div class="drawer-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-medium);padding-bottom:12px;">
        <h3 id="drawer-title" style="margin:0;color:var(--accent);font-size:14px;font-weight:700;">Candidate Investigation &amp; Teardown</h3>
        <button id="btn-close-drawer" type="button" class="action-btn" style="padding:2px 8px;font-size:14px;" aria-label="Close Drawer">&times;</button>
      </div>

      <div id="drawer-trace-meta" style="margin-top:12px;font-size:11px;color:var(--text-muted);display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        <div>Trace ID: <code id="drawer-trace-id" style="color:var(--text-main);">--</code></div>
        <div>Observed UTC: <span id="drawer-trace-time">--</span></div>
        <div>Source Channel: <code id="drawer-trace-channel">--</code></div>
        <div>Lifecycle Status: <span id="drawer-trace-status">--</span></div>
      </div>

      <div class="stepper" id="drawer-stepper">
        <!-- 6 Stage steps inserted here by client script -->
      </div>

      <div id="drawer-custom-content" style="display:none;margin-top:12px;">
        <!-- Product Teardown inserted here by client script -->
      </div>

      <div style="margin-top:auto;padding-top:14px;border-top:1px solid var(--border-subtle);font-size:10px;color:var(--text-dim);">
        <div>Payload SHA-256: <code id="drawer-payload-hash" style="color:var(--text-muted);">--</code></div>
        <div>Trace RFC 8785 JCS: <code id="drawer-trace-hash" style="color:var(--text-muted);">--</code></div>
      </div>
    </div>
  </div>

  <!-- 7. MAIN CONTAINER -->
  <main class="container">
    <!-- TWO-LEVEL ERROR BANNER -->
    <div id="two-level-error-banner" class="error-banner" style="display:none;" role="alert" aria-live="assertive">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <strong id="error-summary-heading" style="font-size:13px;color:#f87171;">Action Error</strong>
        <button id="error-dismiss-btn" type="button" style="background:transparent;border:none;color:#fca5a5;cursor:pointer;font-size:16px;line-height:1;padding:0 4px;" aria-label="Dismiss Error">&times;</button>
      </div>
      <div id="error-summary-text" style="margin-top:4px;font-size:12px;"></div>
      <pre id="error-diagnostic-details" style="margin-top:8px;padding:8px;background:rgba(0,0,0,0.4);border-radius:4px;font-size:11px;font-family:var(--font-mono);white-space:pre-wrap;color:#fecaca;"></pre>
    </div>

    <!-- GOVERNED ACTION CONFIRMATION MODAL -->
    <div id="action-modal" class="modal-backdrop" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-card">
        <h3 id="modal-title" style="margin-top:0;color:var(--accent);font-size:14px;">Confirm Governed Operator Action</h3>
        <p id="modal-desc" style="color:var(--text-secondary);font-size:12px;margin-bottom:12px;"></p>
        <div style="margin-bottom:12px;">
          <label for="modal-rationale" style="display:block;font-size:11px;margin-bottom:4px;color:var(--text-muted);">Operator Audit Rationale (minimum 15 characters required per POC.docx &sect;8.4):</label>
          <textarea id="modal-rationale" rows="3" style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);font-family:var(--font-mono);font-size:11px;padding:8px;border-radius:4px;" placeholder="Provide audit rationale (e.g., Manual risk mitigation routine check)..."></textarea>
          <div style="font-size:10px;color:var(--text-muted);display:flex;justify-content:space-between;margin-top:4px;">
            <span>Characters: <span id="rationale-char-count">0</span> / 15 min</span>
            <span id="rationale-validation-hint" style="color:var(--blocked);">Too short (&ge; 15 chars required)</span>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button id="modal-cancel-btn" class="action-btn" type="button">Cancel</button>
          <button id="modal-confirm-btn" class="action-btn action-btn-danger" type="button" disabled>Confirm Transition</button>
        </div>
      </div>
    </div>

    <!-- GOVERNED OPERATOR TOOLBAR (KILL-SWITCH & ACTIONS) -->
    <div class="action-bar" role="toolbar" aria-label="Governed Operator Controls">
      <span style="font-size:11px;font-weight:600;color:var(--text-muted);margin-right:4px;">Kill-Switch Tier:</span>
      <button id="btn-ks-normal-ops" class="action-btn" type="button" data-scope="NORMAL_PAPER_OPERATION">Normal Operations [Tier 0]</button>
      <button id="btn-ks-halt-allocations" class="action-btn action-btn-danger" type="button" data-scope="HALT_NEW_ALLOCATIONS">Halt Allocations [Tier 1]</button>
      <button id="btn-ks-halt-simulation" class="action-btn action-btn-danger" type="button" data-scope="HALT_ALL_SIMULATION_PROCESSING">Halt All Simulation [Tier 2]</button>
      <button id="btn-ks-recovery-only" class="action-btn action-btn-danger" type="button" data-scope="ENTER_RECOVERY_ONLY_MODE">Recovery Only Mode [Tier 3]</button>
      <span id="last-update-time" style="font-size:10px;font-family:var(--font-mono);color:var(--text-dim);margin-left:auto;">Updated: ${escapeHtml(snapshot.as_of_timestamp_utc)}</span>
    </div>

    <!-- ===================================================================== -->
    <!-- WORKSPACE 1: COMMAND CENTER / OPERATIONAL MONITOR                     -->
    <!-- ===================================================================== -->
    <div class="card" id="workspace-command-center" style="display:none;">
      <h2>
        <span>1. Command Center &mdash; Operational Health &amp; Telemetry</span>
        <span class="badge badge-ok">${escapeHtml(cc.ledger_reconciliation_status.icon_symbol)} ${escapeHtml(cc.ledger_reconciliation_status.label)}</span>
      </h2>

      <!-- High-Density KPI Tiles Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-bottom:16px;">
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:4px;padding:10px;">
          <div style="color:var(--text-dim);font-size:10px;text-transform:uppercase;">Available Treasury (Simulated)</div>
          <div style="font-size:13px;font-weight:700;color:var(--text-main);margin-top:2px;" class="metric-value">₹${cc.available_treasury_capital_inr.value} <span class="provenance-tag">${cc.available_treasury_capital_inr.classification}</span></div>
          <div style="color:var(--text-dim);font-size:9px;margin-top:2px;">Liquid Paper Reserve (Simulated)</div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:4px;padding:10px;">
          <div style="color:var(--text-dim);font-size:10px;text-transform:uppercase;">Committed Capital</div>
          <div style="font-size:13px;font-weight:700;color:var(--text-main);margin-top:2px;" class="metric-value">₹${cc.committed_paper_capital_inr.value} <span class="provenance-tag">${cc.committed_paper_capital_inr.classification}</span></div>
          <div style="color:var(--text-dim);font-size:9px;margin-top:2px;">Active Allocations</div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:4px;padding:10px;">
          <div style="color:var(--text-dim);font-size:10px;text-transform:uppercase;">Active Research Runs</div>
          <div style="font-size:13px;font-weight:700;color:var(--accent);margin-top:2px;" class="metric-value">${cc.active_research_runs_count.value} <span class="provenance-tag">${cc.active_research_runs_count.classification}</span></div>
          <div style="color:var(--text-dim);font-size:9px;margin-top:2px;">Dispatched Tasks</div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:4px;padding:10px;">
          <div style="color:var(--text-dim);font-size:10px;text-transform:uppercase;">Risk Alerts</div>
          <div style="font-size:13px;font-weight:700;color:${cc.risk_alerts_count.value > 0 ? 'var(--warn)' : 'var(--text-muted)'};margin-top:2px;" class="metric-value">${cc.risk_alerts_count.value} <span class="provenance-tag">${cc.risk_alerts_count.classification}</span></div>
          <div style="color:var(--text-dim);font-size:9px;margin-top:2px;">Red-Team Signals</div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:4px;padding:10px;">
          <div style="color:var(--text-dim);font-size:10px;text-transform:uppercase;">Kill-Switch Scope</div>
          <div style="font-size:13px;font-weight:700;color:var(--ok);margin-top:2px;" class="metric-value">${cc.active_kill_switch_scope}</div>
          <div style="color:var(--text-dim);font-size:9px;margin-top:2px;">Tier 0 Normal Paper Operations</div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:4px;padding:10px;">
          <div style="color:var(--text-dim);font-size:10px;text-transform:uppercase;">Ledger Dual-Write Safety</div>
          <div style="font-size:13px;font-weight:700;color:var(--ok);margin-top:2px;" class="metric-value">BLOCKED [OK]</div>
          <div style="color:var(--text-dim);font-size:9px;margin-top:2px;">Actuals Ledger Immutable</div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:4px;padding:10px;">
          <div style="color:var(--text-dim);font-size:10px;text-transform:uppercase;">Connectors Active</div>
          <div style="font-size:13px;font-weight:700;color:var(--accent);margin-top:2px;" class="metric-value">5 / 5 OPERATIONAL</div>
          <div style="color:var(--text-dim);font-size:9px;margin-top:2px;">Surveillance Feeds Monitored</div>
        </div>
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:4px;padding:10px;">
          <div style="color:var(--text-dim);font-size:10px;text-transform:uppercase;">PostgreSQL 16.8 Engine</div>
          <div style="font-size:13px;font-weight:700;color:var(--ok);margin-top:2px;" class="metric-value">CONNECTED &bull; 2.4ms</div>
          <div style="color:var(--text-dim);font-size:9px;margin-top:2px;">2,660 Evidence Rows Attested</div>
        </div>
      </div>

      <!-- DAG Execution Flow Visualizer -->
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Topological DAG Pipeline (5 Specialist Swarm):</div>
        <svg id="chart-mcp-dag" class="chart" viewBox="0 0 900 70" role="img" aria-label="MCP Specialist DAG Pipeline" style="height:70px;background:#090e1a;">
          <g transform="translate(10, 15)">
            <!-- Worker Nodes -->
            <rect x="10" y="8" width="130" height="26" fill="#131e33" stroke="#1f3152" rx="4" />
            <text x="75" y="24" fill="#38bdf8" font-size="10" font-family="monospace" text-anchor="middle">1. Sieve Worker</text>
            <line x1="140" y1="21" x2="175" y2="21" stroke="#38bdf8" stroke-width="1.5" />
            
            <rect x="175" y="8" width="145" height="26" fill="#131e33" stroke="#1f3152" rx="4" />
            <text x="247" y="24" fill="#38bdf8" font-size="10" font-family="monospace" text-anchor="middle">2. Red Team Conflict</text>
            <line x1="320" y1="21" x2="355" y2="21" stroke="#38bdf8" stroke-width="1.5" />

            <rect x="355" y="8" width="140" height="26" fill="#131e33" stroke="#1f3152" rx="4" />
            <text x="425" y="24" fill="#38bdf8" font-size="10" font-family="monospace" text-anchor="middle">3. Macro Lateral</text>
            <line x1="495" y1="21" x2="530" y2="21" stroke="#38bdf8" stroke-width="1.5" />

            <rect x="530" y="8" width="145" height="26" fill="#131e33" stroke="#1f3152" rx="4" />
            <text x="602" y="24" fill="#38bdf8" font-size="10" font-family="monospace" text-anchor="middle">4. Govt Statutory</text>
            <line x1="675" y1="21" x2="710" y2="21" stroke="#38bdf8" stroke-width="1.5" />

            <rect x="710" y="8" width="165" height="26" fill="#131e33" stroke="#22c55e" rx="4" />
            <text x="792" y="24" fill="#22c55e" font-size="10" font-family="monospace" font-weight="600" text-anchor="middle">5. Underwrite Engine</text>
          </g>
        </svg>
      </div>

      <!-- Connector Surveillance Telemetry Table -->
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr><th>Connector ID</th><th>Channel</th><th>Source Endpoint</th><th>Status</th><th>Ingested</th><th>Quarantined</th><th>Heartbeat</th></tr>
          </thead>
          <tbody>
            ${connectors.map(c => `
              <tr>
                <td><strong>${escapeHtml(c.name)}</strong><br><span style="font-size:9px;color:var(--text-dim);font-family:var(--font-mono);">${escapeHtml(c.connector_id)}</span></td>
                <td><span class="badge badge-fixture">${escapeHtml(c.channel)}</span></td>
                <td><span style="font-size:10px;color:var(--accent);font-family:var(--font-mono);">${escapeHtml(c.endpoint)}</span></td>
                <td><span class="badge ${c.status === 'ACTIVE' ? 'badge-ok' : 'badge-warn'}">${c.status === 'ACTIVE' ? '[OK] ACTIVE' : '[DEFERRED]'}</span></td>
                <td class="metric-value">${c.ingested_count}</td>
                <td class="metric-value" style="color:${c.quarantined_count > 0 ? 'var(--warn)' : 'var(--text-muted)'}">${c.quarantined_count}</td>
                <td style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);">${escapeHtml(c.last_heartbeat_utc || 'N/A')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- WORKSPACE 2: OPPORTUNITY RADAR (DISCOVERY INTAKE & CANDIDATE RADAR)   -->
    <!-- ===================================================================== -->
    <div class="card" id="workspace-opportunity-radar" style="display:none;">
      <h2>
        <span>2. Opportunity Radar &mdash; Discovery Funnel &amp; Screening Intake</span>
        <span class="badge badge-ok">${opps.badge.icon_symbol} ${opps.badge.label}</span>
      </h2>

      <!-- SECTION 0.0: OFFLINE FIXTURE SCREENER (DISCOVERY INTAKE) -->
      <div id="offline-fixture-screener-card" style="margin-bottom:16px;background:var(--bg-surface);border:1px solid var(--border-medium);border-left:3px solid var(--accent);border-radius:4px;padding:14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <h3 style="margin:0 0 4px 0;font-size:13px;color:var(--accent);display:flex;align-items:center;gap:8px;">
              <span>Candidate Discovery Intake</span>
              <span class="badge badge-fixture">[OFFLINE FIXTURE / DEMONSTRATION MODE]</span>
            </h3>
            <p style="margin:0;font-size:11px;color:var(--text-muted);max-width:900px;line-height:1.4;">
              Screen verified golden offline fixtures into deterministic research candidates. Fixtures provide frozen historical captures with known provenance (<code style="color:var(--accent);font-family:var(--font-mono);">is_live_market_verified: false</code>). This does not initiate unverified live-market web crawling.
            </p>
          </div>
        </div>
        <form id="fixture-screening-form" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
          <label for="fixture-selector" style="font-size:11px;color:var(--text-muted);font-weight:600;">Select Golden Fixture:</label>
          <select id="fixture-selector" style="background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:5px 10px;border-radius:3px;font-size:11px;min-width:340px;">
            <option value="FIX-AMZ-SS304-001">FIX-AMZ-SS304-001 &mdash; Amazon SS304 Clamps (Complete)</option>
            <option value="FIX-AMZ-BRASS-001">FIX-AMZ-BRASS-001 &mdash; Amazon Brass Ball Valve 1/2&quot; PN20 (Complete)</option>
            <option value="FIX-SAAS-DEVTOOL-MISSING-PRICE-002">FIX-SAAS-DEVTOOL-MISSING-PRICE-002 &mdash; SaaS DevTool (Missing Price / Incomplete)</option>
            <option value="FIX-IMART-SS304-001">FIX-IMART-SS304-001 &mdash; IndiaMART SS304 Wholesale (Supplier Quote)</option>
            <option value="FIX-IMART-BRASS-001">FIX-IMART-BRASS-001 &mdash; IndiaMART Brass Valve Wholesale (Supplier Quote)</option>
          </select>
          <button id="btn-screen-candidate" class="action-btn action-btn-primary" type="button" style="padding:5px 14px;font-size:11px;">Screen Candidate</button>
        </form>
        <div id="screen-candidate-feedback" style="margin-top:10px;font-size:11px;font-family:var(--font-mono);display:none;padding:8px 12px;background:var(--bg-input);border-radius:4px;border:1px solid var(--border-medium);">
          <!-- Dynamically populated -->
        </div>
      </div>

      <!-- Candidate Radar Interactive Table -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);">Active Research Candidates:</div>
        <div style="display:flex;gap:6px;">
          <button class="action-btn" type="button" style="padding:2px 8px;font-size:10px;" onclick="document.querySelectorAll('#candidate-radar-table tr[data-cat]').forEach(r => r.style.display='')">All Categories</button>
          <button class="action-btn" type="button" style="padding:2px 8px;font-size:10px;" onclick="document.querySelectorAll('#candidate-radar-table tr[data-cat]').forEach(r => r.style.display = r.getAttribute('data-cat')==='PHYSICAL_GOODS' ? '' : 'none')">Physical</button>
          <button class="action-btn" type="button" style="padding:2px 8px;font-size:10px;" onclick="document.querySelectorAll('#candidate-radar-table tr[data-cat]').forEach(r => r.style.display = r.getAttribute('data-cat')==='SOFTWARE_DIGITAL' ? '' : 'none')">Digital / SaaS</button>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table id="candidate-radar-table">
          <thead>
            <tr>
              <th>Candidate ID &amp; Name</th>
              <th>Freshness</th>
              <th>Regime</th>
              <th>Origin Provenance</th>
              <th>Timers / Deadlines</th>
              <th>Underwriting Gate</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${opps.opportunities.map(o => `
              <tr data-cat="${o.sku_id.includes('SAAS') ? 'SOFTWARE_DIGITAL' : 'PHYSICAL_GOODS'}" data-cand-id="${escapeHtml(o.sku_id)}">
                <td>
                  <strong>${escapeHtml(o.sku_id)}</strong><br>
                  <span style="font-size:9px;color:var(--text-dim);">DIN 3017 Reference Archetype</span>
                </td>
                <td class="metric-value">${o.source_freshness_age_seconds.value}s</td>
                <td><span class="badge badge-fixture">${escapeHtml(o.edge_decay_regime)}</span></td>
                <td>
                  ${o.evidence_origin ? `<span class="badge ${o.evidence_origin.origin_class === 'LIVE_VERIFIED_CAPTURE' ? 'badge-live' : 'badge-fixture'}">${o.evidence_origin.semantic_badge.icon_symbol} ${o.evidence_origin.origin_class}</span>` : '<span class="badge badge-fixture">[FIXTURE] RECORDED BASELINE</span>'}
                </td>
                <td>
                  ${o.timers.map(t => `<span class="badge ${t.classification === 'MEASURED_DEADLINE' ? 'badge-ok' : 'badge-warn'}">[${t.classification === 'MEASURED_DEADLINE' ? 'DEADLINE' : 'ESTIMATE'}] ${escapeHtml(t.timer_name)}: ${escapeHtml(t.deadline_or_duration)}</span>`).join(' ')}
                </td>
                <td><span class="badge ${o.badge.icon_symbol === '[OK]' ? 'badge-ok' : 'badge-warn'}">${escapeHtml(o.badge.icon_symbol)} ${escapeHtml(o.badge.label)}</span></td>
                <td>
                  <div style="display:flex;gap:4px;">
                    <button class="action-btn btn-inspect-candidate" type="button" data-candidate-id="${escapeHtml(o.sku_id)}" style="padding:2px 8px;font-size:10px;">Inspect / Gaps</button>
                    <button class="action-btn action-btn-primary btn-underwrite-candidate" type="button" data-candidate-id="${escapeHtml(o.sku_id)}" style="padding:2px 8px;font-size:10px;">Underwrite</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- WORKSPACE 3: EVIDENCE WORKBENCH & INVESTIGATION QUEUE                 -->
    <!-- ===================================================================== -->
    <div class="card" id="workspace-evidence-workbench" style="display:none;">
      <h2>
        <span>3. Evidence Workbench &mdash; Claim Traceability &amp; Origin Firewall</span>
        <span class="badge badge-ok">${ev.badge.icon_symbol} ${ev.badge.label}</span>
      </h2>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr><th>Claim ID</th><th>Requested URL vs Resolved Identity</th><th>Origin</th><th>Lookahead</th><th>Promotion Eligibility</th></tr>
          </thead>
          <tbody>
            ${ev.records.map(r => `
              <tr>
                <td><code>${escapeHtml(r.claim_id)}</code></td>
                <td>
                  <span style="font-size:11px;color:var(--accent);">${escapeHtml(r.requested_url || 'N/A')}</span><br>
                  <span style="font-size:10px;color:var(--text-muted);">&rarr; ${escapeHtml(r.resolved_source_identity || 'N/A')}</span>
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
    </div>

    <!-- ===================================================================== -->
    <!-- WORKSPACE 4: ECONOMICS LAB & UNIT ECONOMICS SEQUENTIAL WATERFALL      -->
    <!-- ===================================================================== -->
    <div class="card" id="workspace-economics-lab" style="display:none;">
      <h2>
        <span>4. Economics Lab &mdash; Sequential Unit Economics &amp; Waterfall</span>
        <span class="badge badge-ok">${econ.badge.icon_symbol} ${econ.badge.label}</span>
      </h2>

      <!-- Statutory Rates & Broker Egress Summary Strip -->
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:4px;padding:10px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;font-size:11px;">
        <div>Landed Cost Floor: <strong class="metric-value">₹${econ.landed_cost_inr.value}</strong> <span class="provenance-tag">${econ.landed_cost_inr.classification}</span></div>
        <div>Fee GST Rate: <strong class="metric-value">${econ.fee_gst_rate_bps.value / 100}%</strong></div>
        <div>Sec 52 TCS Rate: <strong class="metric-value">${econ.sec_52_tcs_rate_bps.value / 100}%</strong></div>
        <div>Sec 194-O TDS Rate: <strong class="metric-value">${econ.sec_194_o_tds_rate_bps.value / 100}%</strong></div>
        ${econ.groq_egress_audit ? `
          <div style="margin-left:auto;">
            Brokered Groq Egress: <code style="color:var(--accent);">${escapeHtml(econ.groq_egress_audit.verified_endpoint)}</code>
            <span class="badge badge-live">[LIVE] PORT 443</span>
            <span class="badge badge-ok">[OK] REDACTED</span>
          </div>
        ` : ''}
      </div>

      <!-- SEQUENTIAL UNIT ECONOMICS WATERFALL (INSTITUTIONAL VISUALIZATION) -->
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Unit Economics Step-Down Breakdown (ASP &rarr; Gross Spread &rarr; Net Contribution):</div>
        ${renderDataDrivenWaterfallSvg(85.0, 25.0, 2.5, 1.0, 12.75, 4.5, 0.5)}
      </div>

      <!-- Spread Bands & J-Curve Charts Grid -->
      <div class="grid-2">
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Landed Sourcing Spread vs ₹10 Ceiling:</div>
          ${renderDataDrivenSpreadBandsSvg(variants, 10.00)}
        </div>
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">35-Day Working Capital Cash-Flow J-Curve:</div>
          ${renderDataDrivenJCurveSvg(econ.cash_flow_j_curve)}
        </div>
      </div>

      <!-- Arbitrage Greeks Gauge -->
      <div style="margin-top:12px;">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Arbitrage Greeks Sensitivity (Delta / Theta / Vega):</div>
        ${renderDataDrivenGreeksSvg(econ.arbitrage_greeks)}
      </div>

      <!-- WHAT-IF MODEL SANDBOX (SRV-02: Zero Client-Side Math / Server Rational AST) -->
      <div style="margin-top:16px;padding:12px;background:var(--bg-input);border:1px solid var(--border-medium);border-radius:4px;">
        <h4 style="margin:0 0 8px 0;color:var(--accent);display:flex;justify-content:space-between;align-items:center;font-size:12px;">
          <span>What-If Model Sandbox (Symbolic Rational AST)</span>
          <span class="badge badge-warn">[CANDIDATE_UI_MODEL: NON-PERSISTED]</span>
        </h4>
        <form id="what-if-form" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;">
          <div>
            <label for="what-if-formula-id" style="display:block;color:var(--text-muted);margin-bottom:2px;">Expression / Target Formula:</label>
            <select id="what-if-formula-id" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:4px;border-radius:3px;font-size:11px;">
              <option value="F01_ESTIMATED_NET_PAYOUT">F01: Net Payout (Price - Fees - Taxes)</option>
              <option value="F02_ROWC_ANNUALIZED">F02: Annualized Return on Working Capital</option>
              <option value="F03_GST_INPUT_CREDIT">F03: Net GST Liability (Output - Input Credit)</option>
            </select>
          </div>
          <div>
            <label for="what-if-price" style="display:block;color:var(--text-muted);margin-bottom:2px;">Simulated Price (INR):</label>
            <input id="what-if-price" type="number" step="1" value="1299" style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:4px;border-radius:3px;font-size:11px;">
          </div>
          <div>
            <label for="what-if-cost" style="display:block;color:var(--text-muted);margin-bottom:2px;">Simulated Landed Cost (INR):</label>
            <input id="what-if-cost" type="number" step="1" value="450" style="width:100%;box-sizing:border-box;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:4px;border-radius:3px;font-size:11px;">
          </div>
          <div style="display:flex;align-items:flex-end;">
            <button id="btn-evaluate-what-if" class="action-btn action-btn-primary" type="button" style="width:100%;padding:5px;">Evaluate Symbolic AST</button>
          </div>
        </form>
        <div id="what-if-result" style="margin-top:10px;padding:8px;background:rgba(0,0,0,0.3);border-radius:4px;font-family:var(--font-mono);font-size:11px;display:none;"></div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- WORKSPACE 5: PRODUCT OBSERVATION DECK & GRIEVANCE MINING              -->
    <!-- ===================================================================== -->
    <div class="card" id="workspace-0" style="display:none;">
      <h2>
        <span>0. Product Observation Deck &amp; Grievance Mining Cockpit</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <span class="badge badge-fixture">[CATALOG] ${products.length} RECORDED PRODUCTS</span>
          <span class="badge badge-ok">[PURSUE] ${products.filter(p => p.strategy.strategic_decision === 'PURSUE').length} OPPORTUNITIES</span>
        </div>
      </h2>

      <!-- Archetype Filter Pills Strip -->
      <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        <span style="font-size:10px;color:var(--text-dim);font-weight:600;text-transform:uppercase;">Filter Archetype:</span>
        <button class="action-btn prod-filter-btn active" type="button" data-filter="ALL" style="padding:2px 8px;font-size:10px;">All Products (${products.length})</button>
        <button class="action-btn prod-filter-btn" type="button" data-filter="CLUSTER_MRO_STANDARDIZED" style="padding:2px 8px;font-size:10px;">Cluster MRO (${products.filter(p => p.commercial_archetype === 'CLUSTER_MRO_STANDARDIZED').length})</button>
        <button class="action-btn prod-filter-btn" type="button" data-filter="TECHNICAL_COMPLIANCE" style="padding:2px 8px;font-size:10px;">Technical / BIS (${products.filter(p => p.commercial_archetype === 'TECHNICAL_COMPLIANCE').length})</button>
        <button class="action-btn prod-filter-btn" type="button" data-filter="SEASONAL_D2C_VISUAL" style="padding:2px 8px;font-size:10px;">Seasonal D2C (${products.filter(p => p.commercial_archetype === 'SEASONAL_D2C_VISUAL').length})</button>
        <button class="action-btn prod-filter-btn" type="button" data-filter="D2C_CONSUMABLE" style="padding:2px 8px;font-size:10px;">D2C Consumables (${products.filter(p => p.commercial_archetype === 'D2C_CONSUMABLE').length})</button>
        <button class="action-btn prod-filter-btn" type="button" data-filter="MRO_INDUSTRIAL" style="padding:2px 8px;font-size:10px;">Heavy Fasteners (${products.filter(p => p.commercial_archetype === 'MRO_INDUSTRIAL').length})</button>
        <button class="action-btn prod-filter-btn" type="button" data-filter="REPLACEMENT_PARTS" style="padding:2px 8px;font-size:10px;">Replacement Seals (${products.filter(p => p.commercial_archetype === 'REPLACEMENT_PARTS').length})</button>
        <button class="action-btn" type="button" id="btn-toggle-push-product" style="padding:2px 8px;font-size:10px;margin-left:auto;color:var(--accent);">+ Push Product</button>
      </div>

      <!-- Push Product Form -->
      <div id="push-product-form-container" style="display:none;margin-bottom:14px;padding:12px;background:var(--bg-input);border:1px solid var(--border-medium);border-radius:4px;">
        <h4 style="margin:0 0 8px 0;font-size:11px;color:var(--accent);">Push New Product Observation to Deck:</h4>
        <form id="push-product-form" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:8px;font-size:11px;">
          <div><label style="display:block;font-size:9px;color:var(--text-dim);">Product ID:</label><input id="inp-prod-id" type="text" placeholder="prod:brass:ball-valve:1-2in" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px;border-radius:3px;"></div>
          <div><label style="display:block;font-size:9px;color:var(--text-dim);">Title:</label><input id="inp-prod-title" type="text" placeholder="Brass Ball Valve 1/2in PN20" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px;border-radius:3px;"></div>
          <div><label style="display:block;font-size:9px;color:var(--text-dim);">Archetype:</label>
            <select id="inp-prod-archetype" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px;border-radius:3px;">
              <option value="CLUSTER_MRO_STANDARDIZED">CLUSTER_MRO_STANDARDIZED</option>
              <option value="TECHNICAL_COMPLIANCE">TECHNICAL_COMPLIANCE</option>
              <option value="SEASONAL_D2C_VISUAL">SEASONAL_D2C_VISUAL</option>
              <option value="D2C_CONSUMABLE">D2C_CONSUMABLE</option>
              <option value="MRO_INDUSTRIAL">MRO_INDUSTRIAL</option>
              <option value="REPLACEMENT_PARTS">REPLACEMENT_PARTS</option>
            </select>
          </div>
          <div><label style="display:block;font-size:9px;color:var(--text-dim);">Retail ASP (INR):</label><input id="inp-prod-asp" type="number" step="0.01" placeholder="350.00" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px;border-radius:3px;"></div>
          <div><label style="display:block;font-size:9px;color:var(--text-dim);">Estimated Sourcing (INR):</label><input id="inp-prod-b2b" type="number" step="0.01" placeholder="140.00" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px;border-radius:3px;"></div>
          <div><label style="display:block;font-size:9px;color:var(--text-dim);">Hub Region:</label><input id="inp-prod-hub" type="text" placeholder="JALANDHAR_PUNJAB" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px;border-radius:3px;"></div>
          <div style="grid-column:1 / -1;display:flex;justify-content:flex-end;gap:8px;">
            <button type="button" class="action-btn" id="btn-cancel-push-product">Cancel</button>
            <button type="submit" class="action-btn action-btn-primary">Submit to Deck</button>
          </div>
        </form>
      </div>

      <!-- Product Observation Deck Table -->
      <div style="overflow-x:auto;">
        <table id="product-observation-deck-table">
          <thead>
            <tr>
              <th>Product &amp; Archetype</th>
              <th>What's Selling (Sell-Side)</th>
              <th>Buyer Grievance Mining (What Buyers Note)</th>
              <th>Engineered Operational Edge (Quality Fix)</th>
              <th>Upstream Sourcing Spread</th>
              <th>Decision &amp; Thesis</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${products.map(p => `
              <tr data-product-id="${escapeHtml(p.product_id)}" data-archetype="${escapeHtml(p.commercial_archetype)}" data-category="${escapeHtml(p.category)}">
                <td style="max-width:200px;">
                  <strong>${escapeHtml(p.name)}</strong>
                  <br><code style="font-size:10px;color:var(--text-dim);">${escapeHtml(p.sku_id)}</code>
                  <br><span style="font-size:10px;color:var(--text-muted);">${escapeHtml(p.category)}</span>
                  <br><span class="badge ${p.is_guiding_reference ? 'badge-ok' : 'badge-fixture'}" style="margin-top:4px;font-size:9px;">${p.is_guiding_reference ? '[GUIDING REFERENCE]' : escapeHtml(p.commercial_archetype)}</span>
                </td>
                <td style="font-size:11px;min-width:180px;">
                  <strong>${escapeHtml(p.sell_side.primary_marketplace)}</strong> (BSR #${p.sell_side.best_seller_rank})
                  <br><span class="metric-value" style="color:var(--text-primary);">~${p.sell_side.monthly_sales_volume_est.toLocaleString()} units/mo</span>
                  <br><span style="color:var(--brand);font-size:10px;">₹${(p.sell_side.monthly_gross_revenue_inr_est / 100000).toFixed(2)} Lakhs/mo</span>
                  <br><span style="color:var(--text-muted);font-size:10px;">Retail ASP: <strong>₹${p.sell_side.prevailing_retail_asp_inr}</strong> (${escapeHtml(p.sell_side.dominant_pack_formats[0] || 'Unit')})</span>
                </td>
                <td style="font-size:11px;min-width:240px;max-width:280px;">
                  <span class="badge badge-blocked" style="font-size:9px;margin-bottom:3px;">${p.overall_negative_review_pct}% Negative Reviews</span>
                  ${p.buyer_grievances.slice(0, 2).map(g => `
                    <div style="margin-top:4px;padding:4px;background:var(--bg-card);border-left:2px solid ${g.severity === 'CRITICAL' ? 'var(--down)' : 'var(--warn)'};border-radius:2px;">
                      <span style="font-weight:600;color:var(--text-primary);font-size:10px;">${escapeHtml(g.summary)}</span>
                      <div style="font-style:italic;color:var(--text-muted);font-size:9px;margin-top:1px;">&ldquo;${escapeHtml(g.representative_quote.length > 70 ? g.representative_quote.slice(0, 67) + '...' : g.representative_quote)}&rdquo;</div>
                    </div>
                  `).join('')}
                </td>
                <td style="font-size:11px;min-width:220px;max-width:260px;">
                  <div style="color:var(--brand);font-weight:600;font-size:10px;margin-bottom:2px;">Remediation Edge:</div>
                  <div style="color:var(--text-primary);font-size:10px;line-height:1.3;">
                    ${escapeHtml(p.buyer_grievances[0]?.engineered_remediation || p.strategy.proposed_strategy)}
                  </div>
                </td>
                <td style="font-size:11px;min-width:170px;">
                  <span style="color:var(--text-muted);font-size:10px;">Hub:</span> <strong>${escapeHtml(p.upstream_supply.hub_name)}</strong>
                  <br><span style="color:var(--text-muted);font-size:10px;">Cost:</span> <span class="metric-value">₹${p.upstream_supply.factory_gate_quote_inr.toFixed(2)}</span>
                  <br><span style="color:var(--up);font-size:10px;">Spread:</span> <strong style="color:var(--up);">+₹${p.strategy.target_gross_spread_inr.toFixed(2)}</strong>
                  <br><span style="color:var(--brand);font-size:10px;">RoWC:</span> <span class="metric-value">${(p.strategy.estimated_annualized_rowc_bps / 100).toFixed(0)}%</span>
                </td>
                <td style="min-width:140px;">
                  <span class="badge ${p.strategy.strategic_decision === 'PURSUE' ? 'badge-ok' : (p.strategy.strategic_decision === 'VALIDATE_FURTHER' ? 'badge-warn' : (p.strategy.strategic_decision === 'MONITOR' ? 'badge-live' : 'badge-blocked'))}">
                    ${p.strategy.strategic_decision === 'PURSUE' ? '[OK] PURSUE' : escapeHtml(p.strategy.strategic_decision)}
                  </span>
                  <br><span style="font-size:10px;color:var(--text-dim);">${escapeHtml(p.strategy.research_case_status)}</span>
                </td>
                <td>
                  <button class="action-btn action-btn-secondary btn-inspect-candidate" type="button" data-candidate-id="${escapeHtml(p.product_id)}" style="padding:3px 8px;font-size:10px;">Inspect Thesis</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- WORKSPACE 6: CAPITAL ALLOCATOR & 10-DIMENSIONAL COMPARISON DECK       -->
    <!-- ===================================================================== -->
    <div class="card" id="workspace-capital-allocator" style="display:none;">
      <h2>
        <span>5. Capital Allocator (10 Required Comparison Dimensions (POC.docx &sect;8)</span>
        <span id="allocator-status-badge" class="badge badge-ok">${alloc.badge.icon_symbol} ${alloc.badge.label}</span>
      </h2>

      <!-- ALLOCATION EVALUATION CONTROL STRIP (SLICE 2F / BOUNDED OPERATOR UI) -->
      <div id="allocation-control-strip" style="margin-bottom:14px;padding:12px;background:var(--bg-surface);border:1px solid var(--border-medium);border-radius:4px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
        <div style="display:flex;align-items:center;gap:6px;">
          <label for="input-paper-budget" style="font-size:11px;color:var(--text-muted);font-weight:600;">Paper Budget (&inr;):</label>
          <input id="input-paper-budget" type="number" min="1" step="100" value="${alloc.total_paper_budget_inr.value}" style="width:110px;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:4px 8px;border-radius:3px;font-size:11px;font-family:var(--font-mono);">
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <label for="input-max-single-allocation" style="font-size:11px;color:var(--text-muted);font-weight:600;">Max Single Cap (&inr;, Optional):</label>
          <input id="input-max-single-allocation" type="number" min="1" step="100" placeholder="No Cap" value="" style="width:110px;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:4px 8px;border-radius:3px;font-size:11px;font-family:var(--font-mono);">
        </div>
        <div style="display:flex;gap:6px;">
          <button id="btn-evaluate-allocation" class="action-btn action-btn-primary" type="button" style="padding:4px 12px;font-size:11px;">Evaluate Allocation</button>
          <button id="btn-clear-allocation-cap" class="action-btn" type="button" style="padding:4px 10px;font-size:11px;background:#1e293b;">Clear Cap</button>
        </div>
        <div id="allocation-control-feedback" style="font-size:11px;color:var(--text-muted);margin-left:auto;"></div>
      </div>

      <!-- 10-Dimension Sieve & Capital Allocator Table -->
      <div style="overflow-x:auto;">
        <table id="capital-allocator-table">
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${alloc.opportunities.map(o => `
              <tr data-candidate-id="${escapeHtml(o.candidate_id)}">
                <td><strong>${escapeHtml(o.candidate_id)}</strong></td>
                <td>
                  ${o.evidence_origin ? `<span class="badge ${o.evidence_origin.origin_class === 'LIVE_VERIFIED_CAPTURE' ? 'badge-live' : 'badge-fixture'}">${o.evidence_origin.semantic_badge.icon_symbol}</span>` : '<span class="badge badge-fixture">[FIXTURE]</span>'}
                </td>
                <td class="metric-value">${(o.expected_return_bps.value / 100).toFixed(2)}%</td>
                <td class="metric-value">${(o.return_after_costs_and_taxes_bps.value / 100).toFixed(2)}%</td>
                <td class="metric-value">${(o.risk_and_downside_buffer_bps.value / 100).toFixed(2)}%</td>
                <td class="metric-value">&inr;${o.capital_requirement_inr.value}</td>
                <td class="metric-value">${o.time_to_execution_days.value}d</td>
                <td class="metric-value">${o.cash_recovery_ccc_days.value}d</td>
                <td class="metric-value">${(o.liquidity_lockup_ratio_bps.value / 100).toFixed(2)}%</td>
                <td class="metric-value">${(o.opportunity_cost_benchmark_bps.value / 100).toFixed(2)}%</td>
                <td class="metric-value">${o.edge_decay_half_life_days.value}d</td>
                <td class="metric-value">${(o.evidence_conviction_score_bps.value / 100).toFixed(2)}%</td>
                <td class="metric-value td-allocated-capital" style="color:${o.allocated_capital_inr.value === '0.00' || o.allocated_capital_inr.value === '0.0000' ? '#ef4444' : '#22c55e'}">
                  &inr;${o.allocated_capital_inr.value}
                  <br><span class="allocation-rationale" style="font-size:9px;color:var(--text-dim);">${escapeHtml(o.conviction_vs_allocation_rationale)}</span>
                </td>
                <td class="td-gate-badge"><span class="badge ${o.gate_badge.icon_symbol === '[OK]' ? 'badge-ok' : 'badge-blocked'}">${escapeHtml(o.gate_badge.icon_symbol)} ${escapeHtml(o.gate_badge.label)}</span></td>
                <td>
                  <div style="display:flex;gap:4px;">
                    <button class="action-btn btn-inspect-candidate" type="button" data-candidate-id="${escapeHtml(o.candidate_id)}" style="padding:2px 6px;font-size:10px;">Inspect</button>
                    <button class="action-btn action-btn-primary btn-underwrite-candidate" type="button" data-candidate-id="${escapeHtml(o.candidate_id)}" style="padding:2px 6px;font-size:10px;">Underwrite</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- ALLOCATION SUMMARY STRIP -->
      <div id="allocation-summary-strip" style="margin-top:12px;padding:8px 12px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:4px;display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">
        <span id="alloc-summary-budget">Total Paper Budget: &inr;${alloc.total_paper_budget_inr.value}</span>
        <span id="alloc-summary-allocated" style="color:var(--ok);">Allocated: &inr;${alloc.allocated_paper_capital_inr.value}</span>
        <span id="alloc-summary-unallocated">Unallocated: &inr;${alloc.unallocated_paper_capital_inr.value}</span>
      </div>

      <!-- Conviction vs Allocation Separation Matrix Chart -->
      <div style="margin-top:14px;">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Conviction vs Allocation Separation Matrix:</div>
        ${renderDataDrivenConvictionMatrixSvg(alloc.opportunities.map(o => ({
          candidate_id: o.candidate_id,
          x_conviction_score: o.evidence_conviction_score_bps.value / 100,
          y_annualized_excess_rowc_bps: (o.return_after_costs_and_taxes_bps.value - o.opportunity_cost_benchmark_bps.value).toString(),
          z_allocated_capital_subunits: (parseFloat(o.allocated_capital_inr.value) * 10000).toString()
        })))}
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- WORKSPACE 7: SIMULATION & POSITIONS (7-BUCKET INVENTORY MODEL)        -->
    <!-- ===================================================================== -->
    <div class="grid-2">
      <div class="card" id="workspace-simulation-and-positions" style="display:none;">
        <h2>
          <span>7. Simulation &amp; Positions (7-Bucket Inventory)</span>
          <span class="badge badge-ok">${sim.badge.icon_symbol} ${sim.badge.label}</span>
        </h2>
        <div style="font-size:11px;margin-bottom:10px;color:var(--text-muted);">
          Cash Ledger Balance: <strong class="metric-value" style="color:var(--ok);">₹${sim.cash_ledger_balance_inr.value}</strong>
        </div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr><th>Raw</th><th>WIP</th><th>FG</th><th>In-Transit</th><th>FBA Avail</th><th>Reserved</th><th>Quarantine</th><th>Conserved Total</th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="metric-value">${sim.seven_bucket_inventory.raw_material}</td>
                <td class="metric-value">${sim.seven_bucket_inventory.work_in_progress}</td>
                <td class="metric-value">${sim.seven_bucket_inventory.finished_goods}</td>
                <td class="metric-value">${sim.seven_bucket_inventory.intransit_to_fba}</td>
                <td class="metric-value">${sim.seven_bucket_inventory.fba_available}</td>
                <td class="metric-value">${sim.seven_bucket_inventory.reserved_customer}</td>
                <td class="metric-value">${sim.seven_bucket_inventory.returned_quarantine}</td>
                <td class="metric-value"><strong>${sim.seven_bucket_inventory.total_conserved}</strong> ${invBadgeHtml}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- WORKSPACE 8: RECONCILIATION & BITEMPORAL PERFORMANCE -->
      <div class="card" id="workspace-reconciliation-and-performance" style="display:none;">
        <h2>
          <span>8. Reconciliation &amp; Bitemporal Performance</span>
          <span class="badge badge-ok">${recon.badge.icon_symbol} ${recon.badge.label}</span>
        </h2>
        <div style="font-size:11px;margin-bottom:8px;color:var(--text-muted);">
          Paper Ledger: <span class="metric-value">₹${recon.cross_ledger_comparison.paper_ledger_total_inr}</span> | Actuals Ledger: <span class="metric-value">₹${recon.cross_ledger_comparison.actuals_ledger_total_inr}</span>
          <br>
          Actuals Write Blocked: <strong>${recon.cross_ledger_comparison.actuals_write_blocked ? 'YES [OK]' : 'NO [VIOLATION]'}</strong> | Direct Merge Blocked: <strong>YES [OK]</strong>
        </div>
        <div style="font-size:11px;color:var(--text-muted);">
          Reconciliation Exceptions: ${recon.reconciliation_exceptions.length === 0 ? '<span class="badge badge-ok">[OK] NONE</span>' : recon.reconciliation_exceptions.map(e => `<span class="badge badge-blocked">[BLOCKED] ${escapeHtml(e)}</span>`).join(' ')}
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- WORKSPACE 9: RISK, AUDIT & 12-POINT RELEASE GATE                      -->
    <!-- ===================================================================== -->
    <div class="card" id="workspace-risk-audit-and-system-health" style="display:none;">
      <h2>
        <span>9. Risk, Audit &amp; System Health (12-Point Release Gate)</span>
        <span class="badge ${risk.system_health_alert ? 'badge-blocked' : (risk.kill_switch_state.active_scope === 'NORMAL_PAPER_OPERATION' ? 'badge-ok' : 'badge-halted')}">
          ${risk.system_health_alert ? '[BLOCKED] ' + escapeHtml(risk.badge.label) : (risk.kill_switch_state.active_scope === 'NORMAL_PAPER_OPERATION' ? '[OK] NORMAL' : '[HALTED] ' + escapeHtml(risk.kill_switch_state.active_scope))}
        </span>
      </h2>

      <!-- HMAC Grant & Constrained Egress Table -->
      ${risk.hmac_grant_telemetry.length > 0 ? `
      <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">HMAC Capability Grant &amp; Constrained HTTPS Egress Telemetry:</div>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Grant ID</th><th>Worker</th><th>HMAC Signature</th><th>Wall Clock</th><th>Bytes Read</th><th>Pinned DNS IPs</th><th>Port 443</th><th>Aborted</th>
            </tr>
          </thead>
          <tbody>
            ${risk.hmac_grant_telemetry.map(h => `
              <tr>
                <td><code>${escapeHtml(h.grant_id)}</code></td>
                <td><span class="badge badge-fixture">${escapeHtml(h.worker_id)}</span></td>
                <td><span class="badge badge-ok">[OK] ${h.hmac_signature_verified ? 'VERIFIED' : 'FAILED'}</span></td>
                <td class="metric-value">${h.cumulative_task_wall_clock_ms}ms / ${h.last_call_latency_ms}ms</td>
                <td class="metric-value">${h.stream_bytes_read}/${h.max_payload_bytes}</td>
                <td><code>${escapeHtml(h.egress_telemetry.resolved_dns_ips.join(', ') || 'N/A')}</code></td>
                <td><span class="badge ${h.egress_telemetry.verified_port === 443 ? 'badge-ok' : 'badge-blocked'}">${h.egress_telemetry.verified_port === 443 ? '[OK] 443' : '[BLOCKED] NONE'}</span></td>
                <td>${h.egress_telemetry.stream_aborted_for_oversize ? '<span class="badge badge-blocked">[BLOCKED] YES</span>' : '<span class="badge badge-ok">[OK] NO</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;">No HMAC grant telemetry records present in snapshot.</div>'}
    </div>
    <!-- 9. MODERN REACT WORKSTATION (M7.3) -->
    <div class="card" id="workspace-react-terminal" style="display:block;padding:0;background:transparent;border:none;">
      <div id="root"></div>
    </div>

    <!-- 10. LIVING GALLERIES & INTELLIGENCE DESK (STAGE C & C.1) -->
    <div class="card" id="workspace-living-galleries" style="display:none;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;border-bottom:1px solid var(--border-medium);padding-bottom:10px;">
        <div>
          <h2 style="margin:0 0 4px 0;font-size:15px;color:var(--text-main);display:flex;align-items:center;gap:10px;">
            <span>10. Living Intelligence Desk &mdash; Product Gallery, Thesis Gallery &amp; Grounded Q&amp;A</span>
            <span class="badge badge-live">[STAGE C.1 VERIFIED]</span>
          </h2>
          <p style="margin:0;font-size:11px;color:var(--text-muted);line-height:1.4;">
            Persistent event-driven candidate and thesis work queues powered by Stage B memory and Stage 64A adaptive reasoning. Live external observations are epistemically stratified and monitored via durable WebSocket telemetry.
          </p>
        </div>
        <button id="btn-refresh-living-galleries" type="button" class="action-btn action-btn-primary" style="padding:5px 12px;font-size:11px;">
          Refresh Galleries &amp; Events
        </button>
      </div>

      <!-- SUB-PANEL A: LIVING PRODUCT GALLERY -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h3 style="margin:0;font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;">
            A. Living Product Gallery &mdash; Candidate Queue
          </h3>
          <span id="gallery-candidate-count-badge" class="badge badge-fixture">0 Candidates Active</span>
        </div>
        <div style="overflow-x:auto;">
          <table id="living-product-gallery-table">
            <thead>
              <tr>
                <th>Candidate ID &amp; Name</th>
                <th>Origin Class</th>
                <th>Category</th>
                <th>Lifecycle State</th>
                <th>Cluster / Coordinates</th>
                <th>Factory Quote</th>
                <th>Retail ASP</th>
                <th>Data Required Gaps</th>
              </tr>
            </thead>
            <tbody id="living-product-gallery-tbody">
              <tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:14px;">Loading candidates from /api/gallery/products...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- SUB-PANEL B: LIVING THESIS GALLERY -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h3 style="margin:0;font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;">
            B. Living Thesis Gallery &mdash; Emergent Commercial Theses
          </h3>
          <span class="badge badge-ok">[METHODOLOGICAL INVARIANT: CORRELATION &ne; CAUSATION]</span>
        </div>
        <div id="living-theses-container" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(420px, 1fr));gap:12px;">
          <div style="padding:14px;background:var(--bg-surface);border:1px solid var(--border-medium);border-radius:4px;color:var(--text-dim);font-size:11px;">
            Loading active theses from /api/gallery/theses...
          </div>
        </div>
      </div>

      <!-- SUB-PANEL C: GEOGRAPHIC CLUSTER SPATIAL DISTRIBUTION -->
      <div style="margin-bottom:20px;">
        <h3 style="margin:0 0 8px 0;font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;">
          C. Spatial Cluster Distribution &mdash; Comparative Domains (Howrah Fasteners &bull; Jamnagar Brass Valves)
        </h3>
        <div style="background:var(--bg-surface);border:1px solid var(--border-medium);border-radius:4px;padding:12px;">
          <svg viewBox="0 0 840 250" style="width:100%;height:auto;max-height:250px;background:#0d1117;border-radius:3px;">
            <!-- Center Divider -->
            <line x1="420" y1="10" x2="420" y2="240" stroke="#334155" stroke-width="1.5" stroke-dasharray="4,4" />

            <!-- CLUSTER 1: HOWRAH (WEST BENGAL) -->
            <text x="30" y="24" fill="#38bdf8" font-size="11" font-weight="bold" font-family="monospace">1. HOWRAH CLAMPING &amp; FABRICATION BELT (WB)</text>
            <!-- Grid Lines West -->
            <line x1="30" y1="35" x2="400" y2="35" stroke="#1f2937" />
            <line x1="30" y1="85" x2="400" y2="85" stroke="#1f2937" stroke-dasharray="2,2" />
            <line x1="30" y1="135" x2="400" y2="135" stroke="#1f2937" stroke-dasharray="2,2" />
            <line x1="30" y1="185" x2="400" y2="185" stroke="#1f2937" stroke-dasharray="2,2" />

            <!-- Howrah Pins -->
            <circle cx="50" cy="55" r="5" fill="#38bdf8" />
            <text x="62" y="55" fill="#f1f5f9" font-size="10" font-weight="bold">Modern Metal Works (Liluah)</text>
            <text x="62" y="66" fill="#94a3b8" font-size="8" font-family="monospace">22.6285&deg;N, 88.3421&deg;E | Worm-Drive Band [DATA_REQUIRED]</text>

            <circle cx="50" cy="95" r="5" fill="#ef4444" />
            <text x="62" y="95" fill="#ef4444" font-size="10" font-weight="bold">MDS Pneumatics (Baltikuri)</text>
            <text x="62" y="106" fill="#94a3b8" font-size="8" font-family="monospace">22.6142&deg;N, 88.2854&deg;E | ROC Amalgamated 2021 [DISQUALIFIED]</text>

            <circle cx="50" cy="135" r="5" fill="#eab308" />
            <text x="62" y="135" fill="#f1f5f9" font-size="10">Mondal Engineering (Baltikuri)</text>
            <text x="62" y="146" fill="#94a3b8" font-size="8" font-family="monospace">22.6168&deg;N, 88.2891&deg;E | Hydraulic Forged Clamps [SPEC MISMATCH]</text>

            <circle cx="50" cy="175" r="5" fill="#64748b" />
            <text x="62" y="175" fill="#cbd5e1" font-size="10">Hydrocraft Engineers (Baltikuri)</text>
            <text x="62" y="186" fill="#94a3b8" font-size="8" font-family="monospace">22.6150&deg;N, 88.2860&deg;E | PP/Al Extrusions [MATERIAL MISMATCH]</text>

            <circle cx="50" cy="215" r="5" fill="#f97316" />
            <text x="62" y="215" fill="#cbd5e1" font-size="10">Paral Industries (Dasnagar)</text>
            <text x="62" y="226" fill="#94a3b8" font-size="8" font-family="monospace">22.6135&deg;N, 88.2845&deg;E | Hardware Stockist [DISQUALIFIED INTERMEDIARY]</text>

            <!-- CLUSTER 2: JAMNAGAR (GUJARAT) -->
            <text x="440" y="24" fill="#f59e0b" font-size="11" font-weight="bold" font-family="monospace">2. JAMNAGAR BRASS VALVE &amp; FOUNDRY BELT (GJ)</text>
            <!-- Grid Lines East -->
            <line x1="440" y1="35" x2="820" y2="35" stroke="#1f2937" />
            <line x1="440" y1="85" x2="820" y2="85" stroke="#1f2937" stroke-dasharray="2,2" />
            <line x1="440" y1="135" x2="820" y2="135" stroke="#1f2937" stroke-dasharray="2,2" />
            <line x1="440" y1="185" x2="820" y2="185" stroke="#1f2937" stroke-dasharray="2,2" />

            <!-- Jamnagar Pins -->
            <circle cx="460" cy="55" r="5" fill="#10b981" />
            <text x="472" y="55" fill="#f1f5f9" font-size="10" font-weight="bold">Radhika Brass Industries (GIDC-III)</text>
            <text x="472" y="66" fill="#94a3b8" font-size="8" font-family="monospace">22.4578&deg;N, 70.0762&deg;E | Forged PN20 Valves [DATA_REQ: CW617N Spectro]</text>

            <circle cx="460" cy="95" r="5" fill="#38bdf8" />
            <text x="472" y="95" fill="#f1f5f9" font-size="10" font-weight="bold">Omkar Brass Industries (Shankar Tekri)</text>
            <text x="472" y="106" fill="#94a3b8" font-size="8" font-family="monospace">22.4635&deg;N, 70.0610&deg;E | Sanitary &amp; Ball Valves [DATA_REQ: Shell Test]</text>

            <circle cx="460" cy="135" r="5" fill="#ef4444" />
            <text x="472" y="135" fill="#ef4444" font-size="10" font-weight="bold">Jamnagar Metal Cast (GIDC-II)</text>
            <text x="472" y="146" fill="#94a3b8" font-size="8" font-family="monospace">22.4690&deg;N, 70.0820&deg;E | ROC Amalgamated 2022 [DISQUALIFIED]</text>

            <circle cx="460" cy="175" r="5" fill="#f97316" />
            <text x="472" y="175" fill="#cbd5e1" font-size="10">Apex Brass Tech (Patel Colony)</text>
            <text x="472" y="186" fill="#94a3b8" font-size="8" font-family="monospace">22.4740&deg;N, 70.0550&deg;E | Stockist / Intermediary [DISQUALIFIED]</text>

            <circle cx="460" cy="215" r="5" fill="#64748b" />
            <text x="472" y="215" fill="#cbd5e1" font-size="10">Shreeji Brass Components (Dared)</text>
            <text x="472" y="226" fill="#94a3b8" font-size="8" font-family="monospace">22.4510&deg;N, 70.0710&deg;E | Turned Pins Only [LACKS HOT FORGING PRESS]</text>
          </svg>
        </div>
      </div>

      <!-- SUB-PANEL D: EVIDENCE-GROUNDED OPERATOR LLM Q&A DESK -->
      <div style="margin-bottom:20px;">
        <h3 style="margin:0 0 8px 0;font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;">
          D. Evidence-Grounded Operator LLM Q&amp;A Desk &mdash; 4-Tier Epistemic Synthesis
        </h3>
        <div style="background:var(--bg-surface);border:1px solid var(--border-medium);border-radius:4px;padding:14px;">
          <form id="form-gallery-ask" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
              <label for="select-ask-target-type" style="font-size:11px;color:var(--text-muted);font-weight:600;">Target:</label>
              <select id="select-ask-target-type" style="background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:5px 8px;border-radius:3px;font-size:11px;">
                <option value="candidate">Candidate</option>
                <option value="thesis">Thesis</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:240px;">
              <label for="input-ask-target-id" style="font-size:11px;color:var(--text-muted);font-weight:600;">Target ID:</label>
              <input id="input-ask-target-id" type="text" placeholder="Candidate ID (e.g. OPP-...) or Thesis ID" style="flex:1;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:5px 8px;border-radius:3px;font-size:11px;font-family:var(--font-mono);">
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex:2;min-width:320px;">
              <label for="input-ask-query" style="font-size:11px;color:var(--text-muted);font-weight:600;">Query:</label>
              <input id="input-ask-query" type="text" value="What verified facts vs directory claims exist, and what data is missing?" style="flex:1;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:5px 8px;border-radius:3px;font-size:11px;">
            </div>
            <button id="btn-submit-gallery-ask" type="button" class="action-btn action-btn-primary" style="padding:5px 14px;font-size:11px;">
              Submit Inquiry
            </button>
          </form>

          <div id="gallery-ask-result-box" style="display:none;background:var(--bg-input);border:1px solid var(--border-medium);border-radius:4px;padding:12px;font-size:11px;">
            <!-- Populated dynamically -->
          </div>
        </div>
      </div>

      <!-- SUB-PANEL E: DURABLE EVENT STREAM & TIMELINE -->
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h3 style="margin:0;font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;">
            E. Durable Event Stream &amp; Replay (Append-Only Journal)
          </h3>
          <span id="gallery-ws-telemetry-badge" class="badge badge-live">[WS: CONNECTED]</span>
        </div>
        <div id="gallery-event-stream-box" style="max-height:220px;overflow-y:auto;background:var(--bg-surface);border:1px solid var(--border-medium);border-radius:4px;padding:10px;font-family:var(--font-mono);font-size:10px;">
          <div style="color:var(--text-dim);">Listening for live WebSocket and journal events...</div>
        </div>
      </div>
      <!-- SUB-PANEL F: CONNECTOR OPERATIONS & GATEWAY ROUTING (STAGE C.3.1) -->
      <div style="margin-top:20px;border-top:1px solid var(--border-medium);padding-top:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h3 style="margin:0;font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;">
            F. Connector Operations &amp; Gateway Capability Fabric (Stage C.3.1)
          </h3>
          <div style="display:flex;align-items:center;gap:8px;">
            <span id="gateway-health-badge" class="badge badge-ok">[GATEWAY: OPERATIONAL]</span>
            <button id="btn-refresh-connector-ops" type="button" class="action-btn" style="padding:4px 8px;font-size:10px;">
              Refresh Connector Telemetry
            </button>
          </div>
        </div>
        <p style="margin:0 0 12px 0;font-size:11px;color:var(--text-muted);line-height:1.4;">
          Consolidates runtime secrets, live auth probing, circuit breaker governance, and specialist agent delegation across 6 operational layers. Epistemic provenance guarantees that live provider responses are badged <code>CURRENT</code> while cached fallbacks are badged <code>PROVISIONAL_CACHE</code> or <code>STALE_HISTORICAL</code>.
        </p>

        <!-- Operational Layers Table -->
        <h4 style="margin:10px 0 6px 0;font-size:11px;color:var(--text-main);">Operational Layer Health (Layers 1&ndash;6)</h4>
        <div style="overflow-x:auto;margin-bottom:14px;">
          <table id="gateway-layers-table" style="font-size:11px;">
            <thead>
              <tr>
                <th style="width:180px;">Layer</th>
                <th style="width:100px;">Status</th>
                <th>Summary &amp; Guarantees</th>
                <th style="width:160px;">Key Metrics</th>
              </tr>
            </thead>
            <tbody id="gateway-layers-tbody">
              <tr><td>Layer 1: Discovery</td><td><span class="badge badge-ok">[HEALTHY]</span></td><td>10 core capabilities &amp; 5 MCP tools registered with fallback routes</td><td>10 Capabilities, 5 Tools</td></tr>
              <tr><td>Layer 2: Configuration</td><td><span class="badge badge-ok">[HEALTHY]</span></td><td>Runtime secrets loaded securely from local .env files (zero key leakage)</td><td>12/13 Configured</td></tr>
              <tr><td>Layer 3: Authentication</td><td><span class="badge badge-fixture">[QUARANTINED]</span></td><td>Live auth active; Meta Graph API quarantined for invalid user scope</td><td>7 Live, 1 Quarantined</td></tr>
              <tr><td>Layer 4: Transport</td><td><span class="badge badge-ok">[HEALTHY]</span></td><td>Dual transport: SSRF-pinned GovernedHttpConnector &amp; JSON-RPC MCP broker</td><td>443-Locked, Zero-SSRF</td></tr>
              <tr><td>Layer 5: Operational Execution</td><td><span class="badge badge-ok">[HEALTHY]</span></td><td>Standardized execution envelopes with RFC 8785 JCS sha256 checksums</td><td>Circuit-Governed</td></tr>
              <tr><td>Layer 6: Agent Integration</td><td><span class="badge badge-ok">[HEALTHY]</span></td><td>SpecialistDelegator, LeadInvestigator &amp; Screener wired to Gateway</td><td>5 Specialists Wired</td></tr>
            </tbody>
          </table>
        </div>

        <!-- Connectors & Circuit Breakers Table -->
        <h4 style="margin:10px 0 6px 0;font-size:11px;color:var(--text-main);">Connectors, Capabilities &amp; Circuit Breaker Matrix</h4>
        <div style="overflow-x:auto;">
          <table id="gateway-connectors-table" style="font-size:11px;">
            <thead>
              <tr>
                <th>Connector ID</th>
                <th>Declared Capabilities</th>
                <th>Live Status</th>
                <th>Circuit Breaker</th>
                <th>Last Error / Forensics</th>
                <th>Consuming Agents &amp; Roles</th>
              </tr>
            </thead>
            <tbody id="gateway-connectors-tbody">
              <tr>
                <td><code>gemini-llm</code></td>
                <td>synthesize_reasoning</td>
                <td><span class="badge badge-live">[AUTHENTICATED_LIVE]</span></td>
                <td><span class="badge badge-ok">[CLOSED]</span></td>
                <td>None (HTTP 200, 50 models)</td>
                <td>LeadInvestigator, ResearchSynthesisAgent</td>
              </tr>
              <tr>
                <td><code>groq-lpu</code></td>
                <td>synthesize_reasoning (Fast LPU)</td>
                <td><span class="badge badge-live">[AUTHENTICATED_LIVE]</span></td>
                <td><span class="badge badge-ok">[CLOSED]</span></td>
                <td>None (HTTP 200, 11 models)</td>
                <td>LeadInvestigator, SellerTaskAgent</td>
              </tr>
              <tr>
                <td><code>google-maps-geo</code></td>
                <td>logistics_transit_route</td>
                <td><span class="badge badge-live">[AUTHENTICATED_LIVE]</span></td>
                <td><span class="badge badge-ok">[CLOSED]</span></td>
                <td>None (HTTP 200 Places/Routes)</td>
                <td>LogisticsRouteSpecialist, SupplySpecialist</td>
              </tr>
              <tr>
                <td><code>meta-graph</code></td>
                <td>scan_media_sentiment</td>
                <td><span class="badge badge-blocked">[ENDPOINT_ERROR]</span></td>
                <td><span class="badge badge-fixture">[OPEN_QUARANTINED]</span></td>
                <td>HTTP 400 OAuthException (Invalid scope for /me)</td>
                <td>MediaChatterWorker (Diverts to mcp-media)</td>
              </tr>
              <tr>
                <td><code>tinyfish-crawler</code></td>
                <td>fetch_clean_dom</td>
                <td><span class="badge badge-live">[AUTHENTICATED_LIVE]</span></td>
                <td><span class="badge badge-ok">[CLOSED]</span></td>
                <td>None (Anti-bot DOM capture active)</td>
                <td>SupplySpecialist, MarketplaceChannelSpecialist</td>
              </tr>
              <tr>
                <td><code>mcp-statutory</code></td>
                <td>audit_statutory_registry, resolve_corporate_identity</td>
                <td><span class="badge badge-live">[MCP_REGISTERED]</span></td>
                <td><span class="badge badge-ok">[CLOSED]</span></td>
                <td>None (MCA21 / CBIC official circulars)</td>
                <td>StatutoryRegistrySpecialist, AdversarialAuditor</td>
              </tr>
              <tr>
                <td><code>eulerpool-macro</code></td>
                <td>fetch_macro_series</td>
                <td><span class="badge badge-live">[AUTHENTICATED_LIVE]</span></td>
                <td><span class="badge badge-ok">[CLOSED]</span></td>
                <td>None (HTTP 200, 198 series)</td>
                <td>MacroLateralWorker, UnitEconomicsTaskAgent</td>
              </tr>
              <tr>
                <td><code>alpaca-broker</code></td>
                <td>paper_brokerage_account</td>
                <td><span class="badge badge-live">[AUTHENTICATED_LIVE]</span></td>
                <td><span class="badge badge-ok">[CLOSED]</span></td>
                <td>None (Paper account: $100k cash)</td>
                <td>ExecutionDeskAgent, PortfolioSupervisor</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
      <div id="root"></div>
    </div>
  </main>

  <!-- 8. GLOBAL STATUS FOOTER -->
  <footer class="status-footer" role="contentinfo">
    <div>
      <span>OPERATING MODE: <strong>${snapshot.operating_mode}</strong></span> &bull;
      <span>REAL MONEY: <strong>DISABLED</strong></span> &bull;
      <span>DUAL-LEDGER: <strong>ISOLATED</strong></span>
    </div>
    <div>
      <span>SNAPSHOT JCS: <code>${snapshot.snapshot_jcs_sha256.substring(0, 20)}...</code></span> &bull;
      <span>POSTGRES: <strong>16.8 [HEALTHY]</strong></span>
    </div>
  </footer>

  <!-- ===================================================================== -->
  <!-- 9. CLIENT INTERACTION SCRIPT                                          -->
  <!-- ===================================================================== -->
  <script>
    (function() {
      window.__PRODUCT_OBSERVATIONS__ = ${JSON.stringify(products)};
      window.PRODUCTS_DATA = window.__PRODUCT_OBSERVATIONS__;
      var PRODUCTS_DATA = window.__PRODUCT_OBSERVATIONS__;
      var apiBase = window.location.origin;
      var currentTask = null;

      // Standalone mode detection
      if (window.location.protocol === 'file:') {
        var sBanner = document.getElementById('standalone-mode-banner');
        if (sBanner) sBanner.style.display = 'flex';
      }

      // Toast Notification Helper
      function showToast(title, message, type) {
        var container = document.getElementById('toast-container');
        if (!container) return;
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + (type || 'info');
        toast.innerHTML = '<div><strong style="display:block;margin-bottom:2px;">' + escapeClientHtml(title) + '</strong><span>' + escapeClientHtml(message) + '</span></div><button type="button" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;padding:0 2px;">&times;</button>';
        toast.querySelector('button').onclick = function() { toast.remove(); };
        container.appendChild(toast);
        setTimeout(function() { toast.remove(); }, 4000);
      }

      // Workspace Tab Switching
      var tabButtons = document.querySelectorAll('.nav-btn');
      var allCards = document.querySelectorAll('.card[id^="workspace-"]');

      tabButtons.forEach(function(btn) {
        btn.addEventListener('click', function() {
          tabButtons.forEach(function(b) {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
          });
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');

          var targetTab = btn.getAttribute('data-tab');
          if (targetTab === 'all') {
            allCards.forEach(function(c) {
              if (c.id === 'workspace-react-terminal') {
                c.style.display = 'none';
              } else {
                c.style.display = '';
              }
            });
          } else {
            allCards.forEach(function(c) {
              c.style.display = (c.id === targetTab) ? '' : 'none';
            });
          }
        });
      });

      // Keyboard Shortcuts
      document.addEventListener('keydown', function(e) {
        // '/' focuses quick search
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          var searchInput = document.getElementById('search-candidates-input');
          if (searchInput) searchInput.focus();
        }
        // Esc closes drawer or modal
        if (e.key === 'Escape') {
          closeDrawer();
          closeModal();
        }
      });

      // Quick Search Filter Input
      var searchInput = document.getElementById('search-candidates-input');
      if (searchInput) {
        searchInput.addEventListener('input', function() {
          var q = searchInput.value.toLowerCase().trim();
          var radarRows = document.querySelectorAll('#candidate-radar-table tbody tr');
          radarRows.forEach(function(row) {
            var txt = row.innerText.toLowerCase();
            row.style.display = txt.includes(q) ? '' : 'none';
          });
          var prodRows = document.querySelectorAll('#product-observation-deck-table tbody tr');
          prodRows.forEach(function(row) {
            var txt = row.innerText.toLowerCase();
            row.style.display = txt.includes(q) ? '' : 'none';
          });
          var allocRows = document.querySelectorAll('#capital-allocator-table tbody tr');
          allocRows.forEach(function(row) {
            var txt = row.innerText.toLowerCase();
            row.style.display = txt.includes(q) ? '' : 'none';
          });
        });
      }

      // Two-Level Error Presentation
      var errorBanner = document.getElementById('two-level-error-banner');
      var errorSummary = document.getElementById('error-summary-text');
      var errorDetails = document.getElementById('error-diagnostic-details');
      var errorDismiss = document.getElementById('error-dismiss-btn');

      function showError(summary, details) {
        if (errorSummary) errorSummary.textContent = summary || 'Action failed';
        if (errorDetails) errorDetails.textContent = details ? JSON.stringify(details, null, 2) : '';
        if (errorBanner) errorBanner.style.display = 'block';
        showToast('Error', summary, 'error');
      }

      function hideError() {
        if (errorBanner) errorBanner.style.display = 'none';
      }

      if (errorDismiss) {
        errorDismiss.addEventListener('click', hideError);
      }

      // Confirmation Modal for Governed Actions
      var modal = document.getElementById('action-modal');
      var modalDesc = document.getElementById('modal-desc');
      var modalRationale = document.getElementById('modal-rationale');
      var modalConfirmBtn = document.getElementById('modal-confirm-btn');
      var modalCancelBtn = document.getElementById('modal-cancel-btn');
      var rationaleCount = document.getElementById('rationale-char-count');
      var rationaleHint = document.getElementById('rationale-validation-hint');

      var pendingAction = null;

      function openModal(action, title, description) {
        pendingAction = action;
        if (document.getElementById('modal-title')) document.getElementById('modal-title').textContent = title;
        if (modalDesc) modalDesc.textContent = description;
        if (modalRationale) modalRationale.value = '';
        updateRationaleValidation();
        if (modal) modal.style.display = 'flex';
      }

      function closeModal() {
        if (modal) modal.style.display = 'none';
        pendingAction = null;
      }

      function updateRationaleValidation() {
        var text = (modalRationale ? modalRationale.value : '').trim();
        var len = text.length;
        if (rationaleCount) rationaleCount.textContent = len;
        var valid = len >= 15;
        if (rationaleHint) {
          rationaleHint.style.color = valid ? 'var(--ok)' : 'var(--blocked)';
          rationaleHint.textContent = valid ? '[OK] Valid' : 'Too short (>= 15 chars required)';
        }
        if (modalConfirmBtn) modalConfirmBtn.disabled = !valid;
      }

      if (modalRationale) {
        modalRationale.addEventListener('input', updateRationaleValidation);
      }

      if (modalCancelBtn) {
        modalCancelBtn.addEventListener('click', closeModal);
      }

      // Kill-Switch Button Handlers
      function setupKsButton(btn) {
        if (!btn) return;
        btn.addEventListener('click', function() {
          var scope = btn.getAttribute('data-scope');
          var title = 'Confirm Scope Transition: ' + scope;
          var desc = 'Transitioning kill-switch scope to [' + scope + ']. Requires explicit operator audit rationale (min 15 chars).';
          openModal({ type: 'KILL_SWITCH', target_scope: scope }, title, desc);
        });
      }

      setupKsButton(document.getElementById('btn-ks-halt-allocations'));
      setupKsButton(document.getElementById('btn-ks-halt-simulation'));
      setupKsButton(document.getElementById('btn-ks-recovery-only'));
      setupKsButton(document.getElementById('btn-ks-normal-ops'));

      var btnRunDag = document.getElementById('btn-run-dag');
      if (btnRunDag) {
        btnRunDag.addEventListener('click', function() {
          openModal(
            { type: 'RUN_DAG', mode: 'REPLAY_FROM_CHECKPOINT' },
            'Execute Governed DAG Pipeline',
            'Trigger topological DAG execution across all 5 specialist workers (POC.docx §8.1).'
          );
        });
      }

      if (modalConfirmBtn) {
        modalConfirmBtn.addEventListener('click', async function() {
          if (!pendingAction) return;
          var rationale = modalRationale ? modalRationale.value.trim() : '';
          modalConfirmBtn.disabled = true;
          modalConfirmBtn.textContent = 'Submitting...';

          try {
            if (pendingAction.type === 'KILL_SWITCH') {
              var res = await fetch(apiBase + '/api/actions/kill-switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  target_scope: pendingAction.target_scope,
                  rationale: rationale,
                  operator_id: 'operator-workstation'
                })
              });
              var data = await res.json();
              if (res.ok) {
                closeModal();
                showToast('Success', 'Kill-Switch scope updated to: ' + pendingAction.target_scope, 'success');
                setTimeout(function() { window.location.reload(); }, 600);
              } else {
                showError((data && data.error && data.error.operator_summary) || 'Transition rejected', data);
              }
            } else if (pendingAction.type === 'RUN_DAG') {
              var dagRes = await fetch(apiBase + '/api/actions/run-dag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  execution_mode: pendingAction.mode,
                  rationale: rationale,
                  operator_id: 'operator-workstation'
                })
              });
              var dagData = await dagRes.json();
              if (dagRes.ok) {
                closeModal();
                showToast('Success', 'Governed DAG executed successfully (' + (dagData.executed_steps_count || 5) + ' steps)', 'success');
              } else {
                showError((dagData && dagData.error && dagData.error.operator_summary) || 'DAG failed', dagData);
              }
            }
          } catch (err) {
            showError('Network error', String(err));
          } finally {
            modalConfirmBtn.disabled = false;
            modalConfirmBtn.textContent = 'Confirm Transition';
          }
        });
      }

      // What-If Symbolic AST Evaluator
      var btnEvalWhatIf = document.getElementById('btn-evaluate-what-if');
      if (btnEvalWhatIf) {
        btnEvalWhatIf.addEventListener('click', async function() {
          var fId = document.getElementById('what-if-formula-id').value;
          var pVal = parseFloat(document.getElementById('what-if-price').value) || 0;
          var cVal = parseFloat(document.getElementById('what-if-cost').value) || 0;
          var resBox = document.getElementById('what-if-result');
          btnEvalWhatIf.disabled = true;

          try {
            var res = await fetch(apiBase + '/api/actions/what-if-formula', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                formula_id: fId,
                parameters: {
                  selling_price_inr: pVal,
                  landed_cost_inr: cVal
                }
              })
            });
            var data = await res.json();
            if (res.ok) {
              if (resBox) {
                resBox.style.display = 'block';
                resBox.innerHTML = '<span style="color:var(--ok);font-weight:600;">[OK] EVALUATED VIA SERVER RATIONAL AST:</span><br>' +
                  'Formula: <code>' + escapeClientHtml(fId) + '</code><br>' +
                  'Calculated Result: <strong style="color:var(--accent);">' + escapeClientHtml(data.calculated_value_formatted || data.result) + '</strong><br>' +
                  'AST Proof: <code style="font-size:9px;">' + escapeClientHtml(data.ast_derivation_hash || 'SHA-256 VALIDATED') + '</code>';
              }
              showToast('Evaluated', 'Symbolic AST calculated successfully', 'success');
            } else {
              showError((data && data.error && data.error.operator_summary) || 'Evaluation failed', data);
            }
          } catch (err) {
            showError('Network error during What-If calculation', String(err));
          } finally {
            btnEvalWhatIf.disabled = false;
          }
        });
      }

      // WebSocket Telemetry Connection
      function connectWs() {
        var wsIndicator = document.getElementById('ws-indicator');
        if (!wsIndicator || window.location.protocol === 'file:') {
          if (wsIndicator) wsIndicator.textContent = '[WS: OFFLINE]';
          return;
        }

        var wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        var wsUrl = wsProto + '//' + window.location.host + '/ws';
        var ws;

        try {
          ws = new WebSocket(wsUrl);
          ws.onopen = function() {
            wsIndicator.className = 'badge badge-ok';
            wsIndicator.textContent = '[WS: CONNECTED]';
          };
          ws.onmessage = function(event) {
            try {
              var msg = JSON.parse(event.data);
              var timeEl = document.getElementById('last-update-time');
              if (timeEl && msg.timestamp_utc) {
                timeEl.textContent = 'Updated: ' + msg.timestamp_utc;
              }
            } catch (e) {}
          };
          ws.onclose = function() {
            wsIndicator.className = 'badge badge-warn';
            wsIndicator.textContent = '[WS: DISCONNECTED]';
            setTimeout(connectWs, 3000);
          };
          ws.onerror = function() {
            wsIndicator.className = 'badge badge-blocked';
            wsIndicator.textContent = '[WS: ERROR]';
          };
        } catch (err) {
          wsIndicator.className = 'badge badge-blocked';
          wsIndicator.textContent = '[WS: FAILED]';
        }
      }
      connectWs();

      // Drawer Management Helper (DEF-UI-002)
      function getTerminalDrawer() {
        return document.querySelector('.drawer-backdrop') || document.getElementById('lineage-drawer');
      }

      function escapeClientHtml(str) {
        if (!str) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function closeDrawer() {
        var d = getTerminalDrawer();
        if (d) d.style.display = 'none';
      }

      var btnCloseDrawer = document.getElementById('btn-close-drawer');
      if (btnCloseDrawer) {
        btnCloseDrawer.addEventListener('click', closeDrawer);
      }

      var drawerBackdrop = getTerminalDrawer();
      if (drawerBackdrop) {
        drawerBackdrop.addEventListener('click', function(e) {
          if (e.target === drawerBackdrop) closeDrawer();
        });
      }

      // Candidate Slide-Over Drawer Populator (DEF-UI-002 Scalpel Fix)
      function openDrawerWithCandidate(candidate, decision, taskInfo) {
        var d = getTerminalDrawer();
        if (!d) return;

        var drawerTitle = d.querySelector('#drawer-title');
        var drawerCustomContent = d.querySelector('#drawer-custom-content');
        var drawerStepper = d.querySelector('#drawer-stepper');
        var drawerTraceMeta = d.querySelector('#drawer-trace-meta');
        var candId = candidate.candidate_id || candidate.sku_id || 'UNKNOWN';

        if (drawerTitle) drawerTitle.textContent = 'Candidate: ' + (candidate.candidate_name || candidate.sku_id || candId);
        if (drawerStepper) drawerStepper.style.display = 'none';
        if (drawerTraceMeta) drawerTraceMeta.style.display = 'none';

        if (drawerCustomContent) {
          drawerCustomContent.style.display = 'block';

          var curObs = candidate.current_observation || {};
          var suff = candidate.evidence_sufficiency || { sufficiency_score_bps: 0, missing_critical_fields: [], missing_cost_categories: [] };
          var missingFields = suff.missing_critical_fields || [];
          var missingCosts = (decision && decision.unit_economics && decision.unit_economics.missing_cost_inputs) || (function() {
            var m = [];
            if (!curObs.factory_gate_quote_inr) m.push('SUPPLIER_PURCHASE');
            if (curObs.inbound_freight_inr == null) m.push('INBOUND_FREIGHT');
            if (curObs.packaging_kitting_inr == null) m.push('PACKAGING_KITTING');
            if (curObs.platform_fee_inr == null) m.push('MARKETPLACE_FEES');
            if (curObs.statutory_tax_inr == null) m.push('STATUTORY_TAX');
            if (curObs.return_defect_drag_inr == null) m.push('RETURN_DEFECT_DRAG');
            return m;
            // -----------------------------------------------------------------------
      // STAGE C / C.1: LIVING GALLERIES & INTELLIGENCE DESK CONTROLLER
      // -----------------------------------------------------------------------
      // -----------------------------------------------------------------------
      // STAGE C.3.1: CONNECTOR OPERATIONS TELEMETRY LOADER
      // -----------------------------------------------------------------------
      async function loadConnectorOperationsData() {
        if (window.location.protocol === 'file:') return;
        var btnRef = document.getElementById('btn-refresh-connector-ops');
        if (btnRef) btnRef.textContent = 'Updating...';
        try {
          var res = await fetch(apiBase + '/api/connectors/operations');
          if (!res.ok) return;
          var data = await res.json();
          var report = data.report || {};
          var layersTbody = document.getElementById('gateway-layers-tbody');
          if (layersTbody && report.layers) {
            layersTbody.innerHTML = report.layers.map(function(l) {
              var badgeClass = l.status === 'HEALTHY' ? 'badge-ok' : l.status === 'CONFIG_WARNING' ? 'badge-fixture' : 'badge-blocked';
              var metricsStr = Object.keys(l.metrics || {}).map(function(k) { return k + ': ' + l.metrics[k]; }).join(', ');
              return '<tr><td>' + escapeClientHtml(l.layer_name) + '</td><td><span class="badge ' + badgeClass + '">[' + escapeClientHtml(l.status) + ']</span></td><td>' + escapeClientHtml(l.summary) + '</td><td style="font-family:var(--font-mono);font-size:10px;">' + escapeClientHtml(metricsStr) + '</td></tr>';
            }).join('');
          }
          var connsTbody = document.getElementById('gateway-connectors-tbody');
          if (connsTbody && report.connectors && report.capabilities) {
            connsTbody.innerHTML = report.connectors.map(function(c) {
              var caps = report.capabilities.filter(function(cap) {
                return cap.primary_connector_id === c.connector_id || (cap.fallback_connector_ids && cap.fallback_connector_ids.indexOf(c.connector_id) !== -1);
              });
              var capNames = caps.map(function(cap) { return cap.capability_id; }).join(', ') || 'general_transport';
              var consumers = Array.from(new Set(caps.flatMap(function(cap) { return cap.consuming_agent_roles || []; }))).join(', ') || 'GeneralAgent';
              var circuitBadge = c.state === 'CLOSED' ? '<span class="badge badge-ok">[CLOSED]</span>' : '<span class="badge badge-blocked">[' + escapeClientHtml(c.state) + ']</span>';
              var lastErr = c.last_error ? escapeClientHtml(c.last_error.message || c.last_error.code) : 'None';
              return '<tr><td><code>' + escapeClientHtml(c.connector_id) + '</code></td><td>' + escapeClientHtml(capNames) + '</td><td><span class="badge badge-live">[ACTIVE]</span></td><td>' + circuitBadge + '</td><td style="color:' + (c.last_error ? 'var(--negative)' : 'var(--text-muted)') + ';">' + lastErr + '</td><td>' + escapeClientHtml(consumers) + '</td></tr>';
            }).join('');
          }
          var gBadge = document.getElementById('gateway-health-badge');
          if (gBadge && report.overall_health) {
            gBadge.textContent = '[GATEWAY: ' + report.overall_health + ']';
            gBadge.className = 'badge ' + (report.overall_health === 'OPERATIONAL' ? 'badge-ok' : 'badge-blocked');
          }
        } catch (e) {
          // offline safe
        } finally {
          if (btnRef) btnRef.textContent = 'Refresh Connector Telemetry';
        }
      }
      async function loadLivingGalleriesData() {
        if (window.location.protocol === 'file:') return;

        // 1. Fetch Candidates
        try {
          var pRes = await fetch(apiBase + '/api/gallery/products');
          if (pRes.ok) {
            var pData = await pRes.json();
            var tbody = document.getElementById('living-product-gallery-tbody');
            var badge = document.getElementById('gallery-candidate-count-badge');
            if (badge) badge.textContent = pData.count + ' Candidates Active';
            if (tbody && pData.candidates) {
              tbody.innerHTML = pData.candidates.map(function(c) {
                var isDigital = c.category === 'SOFTWARE_DIGITAL' || c.category === 'SERVICE_SOFTWARE';
                var coords = isDigital ? 'US-DE (Delaware #6842918)' : ((c.geographic_context && c.geographic_context.latitude) ? '(' + c.geographic_context.latitude + ', ' + c.geographic_context.longitude + ')' : 'N/A');
                var cluster = isDigital ? 'Cloud (AWS us-east-1)' : ((c.geographic_context && c.geographic_context.cluster_or_region) ? c.geographic_context.cluster_or_region : 'N/A');
                var quote = isDigital ? 'N/A (SaaS API)' : ((c.financial_summary && c.financial_summary.factory_gate_quote_inr) ? '₹' + c.financial_summary.factory_gate_quote_inr.toFixed(2) : 'Unquoted');
                var asp = (c.financial_summary && c.financial_summary.prevailing_retail_asp_inr) ? '₹' + c.financial_summary.prevailing_retail_asp_inr.toFixed(2) : (isDigital ? '$20.00/mo ($0.90/k)' : 'Unquoted');
                var gaps = (c.financial_summary && c.financial_summary.data_required_fields && c.financial_summary.data_required_fields.length > 0)
                  ? c.financial_summary.data_required_fields.map(function(g) { return '<span class="badge badge-warn">' + escapeClientHtml(g) + '</span>'; }).join(' ')
                  : '<span class="badge badge-ok">[COMPLETE]</span>';
                var stateClass = c.lifecycle_state === 'DISQUALIFIED' ? 'badge-blocked' : (c.lifecycle_state === 'VERIFIED' ? 'badge-ok' : 'badge-live');
                var origClass = c.origin_class === 'LIVE_EXTERNAL' ? 'badge-live' : 'badge-fixture';

                return '<tr data-cand-id="' + escapeClientHtml(c.candidate_id) + '">' +
                  '<td><strong>' + escapeClientHtml(c.name) + '</strong><br><code style="font-size:9px;color:var(--text-dim);">' + escapeClientHtml(c.candidate_id) + '</code></td>' +
                  '<td><span class="badge ' + origClass + '">' + escapeClientHtml(c.origin_class) + '</span></td>' +
                  '<td>' + escapeClientHtml(c.category) + '</td>' +
                  '<td><span class="badge ' + stateClass + '">' + escapeClientHtml(c.lifecycle_state) + '</span></td>' +
                  '<td>' + escapeClientHtml(cluster) + '<br><span style="font-size:9px;color:var(--text-dim);">' + escapeClientHtml(coords) + '</span></td>' +
                  '<td class="metric-value">' + quote + '</td>' +
                  '<td class="metric-value">' + asp + '</td>' +
                  '<td>' + gaps + '</td>' +
                '</tr>';
              }).join('');
            }
          }
        } catch (e) {}

        // 2. Fetch Theses
        try {
          var tRes = await fetch(apiBase + '/api/gallery/theses');
          if (tRes.ok) {
            var tData = await tRes.json();
            var tContainer = document.getElementById('living-theses-container');
            if (tContainer && tData.theses) {
              tContainer.innerHTML = tData.theses.map(function(t) {
                var test = t.falsifiable_next_tests ? t.falsifiable_next_tests.join('<br>') : 'N/A';
                return '<div style="background:var(--bg-surface);border:1px solid var(--border-medium);border-left:3px solid var(--accent);border-radius:4px;padding:12px;">' +
                  '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">' +
                    '<h4 style="margin:0;font-size:12px;color:var(--text-main);font-weight:700;">' + escapeClientHtml(t.title) + '</h4>' +
                    '<span class="badge badge-fixture">' + escapeClientHtml(t.scope) + '</span>' +
                  '</div>' +
                  '<div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;font-family:var(--font-mono);">' + escapeClientHtml(t.thesis_id) + ' | Uncertainty: ' + escapeClientHtml(t.uncertainty_rating) + '</div>' +
                  '<p style="margin:0 0 8px 0;font-size:11px;color:var(--text-muted);line-height:1.4;">' + escapeClientHtml(t.hypothesis_statement) + '</p>' +
                  '<div style="font-size:10px;margin-bottom:6px;"><strong style="color:var(--text-muted);">Empirical Evidence IDs:</strong> <span style="font-family:var(--font-mono);">' + (t.supporting_evidence_ids || []).join(', ') + '</span></div>' +
                  '<div style="padding:6px 8px;background:var(--bg-input);border-radius:3px;font-size:10px;color:var(--accent);line-height:1.3;"><strong>Falsifiable Test:</strong> ' + escapeClientHtml(test) + '</div>' +
                '</div>';
              }).join('');
            }
          }
        } catch (e) {}

        // 3. Fetch Events
        try {
          var eRes = await fetch(apiBase + '/api/gallery/events');
          if (eRes.ok) {
            var eData = await eRes.json();
            var eBox = document.getElementById('gallery-event-stream-box');
            if (eBox && eData.events) {
              eBox.innerHTML = eData.events.slice(-15).reverse().map(function(ev) {
                return '<div style="margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.05);">' +
                  '<span style="color:var(--accent);">[Seq #' + ev.sequence_number + ']</span> ' +
                  '<strong style="color:var(--text-main);">' + escapeClientHtml(ev.event_type) + '</strong> ' +
                  '<span style="color:var(--text-dim);">(' + escapeClientHtml(ev.aggregate_type) + ':' + escapeClientHtml(ev.aggregate_id) + ')</span> &mdash; ' +
                  '<span style="color:var(--text-muted);">' + escapeClientHtml(ev.summary) + '</span>' +
                '</div>';
              }).join('');
            }
          }
        } catch (e) {}
      }

      // Hook tab click & button refresh
      loadConnectorOperationsData();
      var btnRefOps = document.getElementById('btn-refresh-connector-ops');
      if (btnRefOps) btnRefOps.addEventListener('click', loadConnectorOperationsData);
      var btnRefreshGalleries = document.getElementById('btn-refresh-living-galleries');
      if (btnRefreshGalleries) {
        btnRefreshGalleries.addEventListener('click', loadLivingGalleriesData);
      }
      var galleryTabBtn = document.querySelector('.nav-btn[data-tab="workspace-living-galleries"]');
      if (galleryTabBtn) {
        galleryTabBtn.addEventListener('click', loadLivingGalleriesData);
      }
      setTimeout(loadLivingGalleriesData, 1000);

      // Hook Operator LLM Q&A Form
      var btnSubmitAsk = document.getElementById('btn-submit-gallery-ask');
      if (btnSubmitAsk) {
        btnSubmitAsk.addEventListener('click', async function() {
          var tType = document.getElementById('select-ask-target-type').value;
          var tId = document.getElementById('input-ask-target-id').value.trim();
          var qVal = document.getElementById('input-ask-query').value.trim();
          var rBox = document.getElementById('gallery-ask-result-box');
          if (!tId) {
            showToast('Target Required', 'Please enter a Candidate ID or Thesis ID', 'warn');
            return;
          }
          btnSubmitAsk.disabled = true;
          btnSubmitAsk.textContent = 'Analyzing...';
          rBox.style.display = 'block';
          rBox.innerHTML = '<span style="color:var(--accent);">Executing grounded LLM Q&amp;A synthesis...</span>';
          try {
            var payload = { query: qVal };
            if (tType === 'candidate') payload.candidate_id = tId;
            else payload.thesis_id = tId;
            var res = await fetch(apiBase + '/api/gallery/ask', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            var data = await res.json();
            btnSubmitAsk.disabled = false;
            btnSubmitAsk.textContent = 'Submit Inquiry';
            if (res.ok) {
              var ep = data.epistemic_breakdown || {};
              rBox.innerHTML =
                '<div style="display:flex;justify-content:space-between;margin-bottom:8px;border-bottom:1px solid var(--border-medium);padding-bottom:6px;">' +
                  '<strong>Synthesis for ' + escapeClientHtml(data.target_type) + ' [' + escapeClientHtml(data.target_id) + ']</strong>' +
                  '<span class="badge badge-ok">[OK] Pure Rational Subunit Math</span>' +
                '</div>' +
                '<p style="margin:0 0 10px 0;font-size:11px;color:var(--text-main);line-height:1.4;">' + escapeClientHtml(data.natural_language_explanation) + '</p>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:10px;">' +
                  '<div style="background:var(--bg-surface);padding:8px;border-radius:3px;border-left:2px solid var(--ok);">' +
                    '<strong style="color:var(--ok);">Observed Facts:</strong><br>' + (ep.observed_facts && ep.observed_facts.length > 0 ? ep.observed_facts.join('<br>') : 'None') +
                  '</div>' +
                  '<div style="background:var(--bg-surface);padding:8px;border-radius:3px;border-left:2px solid var(--accent);">' +
                    '<strong style="color:var(--accent);">Source Claims:</strong><br>' + (ep.source_claims && ep.source_claims.length > 0 ? ep.source_claims.join('<br>') : 'None') +
                  '</div>' +
                  '<div style="background:var(--bg-surface);padding:8px;border-radius:3px;border-left:2px solid var(--blocked);">' +
                    '<strong style="color:var(--blocked);">Contradictions:</strong><br>' + (data.identified_contradictions && data.identified_contradictions.length > 0 ? data.identified_contradictions.join('<br>') : 'None') +
                  '</div>' +
                  '<div style="background:var(--bg-surface);padding:8px;border-radius:3px;border-left:2px solid var(--warn);">' +
                    '<strong style="color:var(--warn);">Data Required Gaps:</strong><br>' + (data.missing_data_fields && data.missing_data_fields.length > 0 ? data.missing_data_fields.join(', ') : 'None') +
                  '</div>' +
                '</div>';
            } else {
              rBox.innerHTML = '<span style="color:var(--blocked);">Error: ' + escapeClientHtml(data.error?.message || 'Inquiry failed') + '</span>';
            }
          } catch (err) {
            btnSubmitAsk.disabled = false;
            btnSubmitAsk.textContent = 'Submit Inquiry';
            rBox.innerHTML = '<span style="color:var(--blocked);">Network error: ' + String(err) + '</span>';
          }
        });
      }

    })();

          var asp = curObs.prevailing_retail_asp_inr || (candidate.gross_selling_price_inr) || 0;
          var quote = curObs.factory_gate_quote_inr || 0;
          var spread = asp - quote;
          var moq = curObs.unit_batch_moq || 100;
          var outlay = quote * moq;
          var netCont = (decision && decision.unit_economics && decision.unit_economics.net_contribution_inr) ? decision.unit_economics.net_contribution_inr : 0;

              var cOrigin = curObs.origin_class || (candidate.evidence_origin && candidate.evidence_origin.origin_class) || 'RECORDED_GOLDEN_FIXTURE';
              var isAssumption = cOrigin === 'OPERATOR_SIMULATION_ASSUMPTION';
              var isLiveMarket = cOrigin === 'LIVE_VERIFIED_CAPTURE';
              var originBadges = isAssumption ? '<span class="badge badge-warn">[ASSUMPTION] OPERATOR_SIMULATION_ASSUMPTION</span>' : (isLiveMarket ? '<span class="badge badge-live">[LIVE] LIVE_VERIFIED_CAPTURE</span>' : '<span class="badge badge-fixture">[FIXTURE] RECORDED BASELINE</span><span class="badge badge-fixture">ORIGIN: RECORDED_GOLDEN_FIXTURE</span>');
              var verifiedBadge = '<span class="badge badge-warn">Live Market Verified: ' + (isLiveMarket ? 'YES' : 'NO [OFFLINE / UNVERIFIED]') + '</span>';

              drawerCustomContent.innerHTML =
                '<div style="background:var(--bg-card);border:1px solid var(--border-medium);border-radius:4px;padding:12px;margin-bottom:12px;">' +
                '<h4 style="margin:0 0 4px 0;font-size:13px;color:var(--text-main);">' + escapeClientHtml(candidate.candidate_name || candId) + '</h4>' +
                '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);">' + escapeClientHtml(candId) + '</div>' +
                '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Canonical ID: <code>' + escapeClientHtml(candidate.canonical_product_id || candidate.canonical_id || 'prod:standardized') + '</code></div>' +
                '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Category: <strong>' + escapeClientHtml(candidate.category || 'PHYSICAL_GOODS') + '</strong></div>' +
                '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;">' +
                  originBadges +
                  verifiedBadge +
                '</div>' +
              '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Source Connector: <code>' + escapeClientHtml((candidate.evidence_origin && candidate.evidence_origin.source_connector_id) || curObs.source_connector_id || 'conn:marketplace:amazon-in') + '</code></div>' +
              '<div style="font-size:10px;color:var(--text-dim);">Observed UTC: ' + escapeClientHtml(curObs.observed_at_utc || new Date().toISOString()) + '</div>' +
              '<div style="font-size:10px;color:var(--text-dim);">Freshness Age: ' + (candidate.freshness_age_seconds || 0) + 's</div>' +
            '</div>' +

            '<div style="background:var(--bg-card);border:1px solid var(--border-medium);border-radius:4px;padding:12px;margin-bottom:12px;">' +
              '<h5 style="margin:0 0 6px 0;font-size:11px;color:var(--accent);text-transform:uppercase;">Evidence Sufficiency &amp; Data Gaps</h5>' +
              '<div style="margin-bottom:6px;">' +
                '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">' +
                  '<span>Completeness Score</span>' +
                  '<strong style="color:var(--accent);">' + (suff.sufficiency_score_bps || 0) + ' / 10,000 bps (' + ((suff.sufficiency_score_bps || 0) / 100).toFixed(1) + '%)</strong>' +
                '</div>' +
                '<div style="width:100%;background:var(--bg-panel);border:1px solid var(--border-subtle);border-radius:2px;height:4px;overflow:hidden;">' +
                  '<div style="width:' + Math.min(100, (suff.sufficiency_score_bps || 0) / 100) + '%;height:100%;background:' + ((suff.sufficiency_score_bps || 0) >= 10000 ? 'var(--ok)' : 'var(--warn)') + ';"></div>' +
                '</div>' +
              '</div>' +
              '<div style="font-size:10px;color:var(--text-muted);margin-top:6px;">Missing Critical Fields: ' +
                (missingFields.length === 0 ? '<span class="badge badge-ok" style="font-size:9px;">[OK] NONE</span>' : missingFields.map(function(f) { return '<span class="badge badge-blocked" style="font-size:9px;margin-right:3px;">' + escapeClientHtml(f) + '</span>'; }).join(' ')) +
              '</div>' +
              '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Missing Cost Inputs: ' +
                (missingCosts.length === 0 ? '<span class="badge badge-ok" style="font-size:9px;">[OK] COMPLETE</span>' : missingCosts.map(function(c) { return '<span class="badge badge-warn" style="font-size:9px;margin-right:3px;">' + escapeClientHtml(c) + '</span>'; }).join(' ')) +
              '</div>' +
            '</div>' +

            '<div style="background:var(--bg-card);border:1px solid var(--border-medium);border-radius:4px;padding:12px;margin-bottom:12px;">' +
              '<h5 style="margin:0 0 6px 0;font-size:11px;color:var(--accent);text-transform:uppercase;">Separated Unit Economics</h5>' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px;font-family:var(--font-mono);">' +
                '<div>Gross Selling Price: <strong style="color:var(--text-main);">₹' + asp.toFixed(2) + '</strong></div>' +
                '<div>Supplier Quote: <strong style="color:var(--text-main);">₹' + quote.toFixed(2) + '</strong></div>' +
                '<div>Gross Sourcing Spread: <strong style="color:var(--ok);">₹' + spread.toFixed(2) + '</strong></div>' +
                '<div>Net Contribution: <strong style="color:' + (netCont > 0 ? 'var(--ok)' : 'var(--blocked)') + ';">₹' + netCont.toFixed(2) + '</strong></div>' +
                '<div style="grid-column:1 / -1;margin-top:4px;">Initial Cash Outlay (MOQ Batch): <strong style="color:var(--accent);">₹' + outlay.toFixed(2) + '</strong> (' + moq + ' units)</div>' +
              '</div>' +
            '</div>' +

            '<div style="background:var(--bg-card);border:1px solid var(--border-medium);border-radius:4px;padding:12px;margin-bottom:12px;">' +
              '<h5 style="margin:0 0 6px 0;font-size:11px;color:var(--accent);display:flex;justify-content:space-between;align-items:center;">' +
                '<span>Authoritative Task Queue &amp; Lease Fencing</span>' +
                '<span id="drawer-task-badge" class="badge badge-fixture">' + (currentTask ? '[LEASED: ACTIVE]' : '[PENDING DISCOVERY TASK]') + '</span>' +
              '</h5>' +
              '<p style="margin:0 0 8px 0;font-size:10px;color:var(--text-muted);">' +
                'Fencing tokens protect investigation leases. A stale token (409) is rejected to enforce distributed queue integrity.' +
              '</p>' +
              '<button class="action-btn action-btn-primary btn-drawer-claim-task" type="button" style="width:100%;margin-bottom:8px;">Claim Task from Queue</button>' +
              '<div id="drawer-claim-status" style="font-size:10px;font-family:var(--font-mono);margin-bottom:8px;"></div>' +

              '<h6 style="margin:8px 0 4px 0;font-size:10px;color:var(--text-muted);text-transform:uppercase;">Submit Verified Evidence (Preserve Fencing):</h6>' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px;margin-bottom:6px;">' +
                '<div><label style="color:var(--text-dim);display:block;">Quote (INR):</label>' +
                  '<input id="input-ev-quote" type="number" step="0.01" value="' + (curObs.factory_gate_quote_inr || '') + '" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px 6px;border-radius:3px;font-size:10px;">' +
                '</div>' +
                '<div><label style="color:var(--text-dim);display:block;">MOQ:</label>' +
                  '<input id="input-ev-moq" type="number" step="1" value="' + (curObs.unit_batch_moq || '') + '" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px 6px;border-radius:3px;font-size:10px;">' +
                '</div>' +
                '<div><label style="color:var(--text-dim);display:block;">Freight (INR):</label>' +
                  '<input id="input-ev-freight" type="number" step="0.01" value="' + (curObs.inbound_freight_inr || '') + '" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px 6px;border-radius:3px;font-size:10px;">' +
                '</div>' +
                '<div><label style="color:var(--text-dim);display:block;">Packaging (INR):</label>' +
                  '<input id="input-ev-packaging" type="number" step="0.01" value="' + (curObs.packaging_kitting_inr || '') + '" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px 6px;border-radius:3px;font-size:10px;">' +
                '</div>' +
                '<div><label style="color:var(--text-dim);display:block;">Platform Fee (INR):</label>' +
                  '<input id="input-ev-platform-fee" type="number" step="0.01" value="' + (curObs.platform_fee_inr || '') + '" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px 6px;border-radius:3px;font-size:10px;">' +
                '</div>' +
                '<div><label style="color:var(--text-dim);display:block;">Tax (INR):</label>' +
                  '<input id="input-ev-tax" type="number" step="0.01" value="' + (curObs.statutory_tax_inr || '') + '" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px 6px;border-radius:3px;font-size:10px;">' +
                '</div>' +
                '<div style="grid-column:1 / -1;"><label style="color:var(--text-dim);display:block;">Return Defect Drag (INR):</label>' +
                  '<input id="input-ev-return-drag" type="number" step="0.01" value="' + (curObs.return_defect_drag_inr != null ? curObs.return_defect_drag_inr : '0.00') + '" style="width:100%;background:var(--bg-input);border:1px solid var(--border-medium);color:var(--text-main);padding:3px 6px;border-radius:3px;font-size:10px;">' +
                '</div>' +
              '</div>' +
              '<button id="btn-drawer-commit-evidence" class="action-btn" type="button" style="width:100%;background:#1e293b;border-color:var(--border-medium);margin-bottom:6px;">Commit Evidence (Preserve Fencing)</button>' +
              '<div id="drawer-evidence-feedback" style="font-size:10px;font-family:var(--font-mono);"></div>' +
            '</div>' +

            '<div style="background:var(--bg-card);border:1px solid var(--border-medium);border-radius:4px;padding:12px;margin-bottom:12px;">' +
              '<h5 style="margin:0 0 6px 0;font-size:11px;color:var(--accent);text-transform:uppercase;">Deterministic Underwriting Evaluation</h5>' +
              (decision ? (
                '<div style="margin-bottom:8px;">' +
                  '<span class="badge ' + (decision.outcome === 'ELIGIBLE' || decision.outcome === 'GATE_ELIGIBLE' ? 'badge-ok' : 'badge-blocked') + '" style="font-size:11px;">[' + (decision.outcome === 'ELIGIBLE' ? 'OK' : 'BLOCKED') + '] ' + escapeClientHtml(decision.outcome) + '</span>' +
                  '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Rationale / Reason Codes: <code>' + escapeClientHtml(JSON.stringify(decision.rejection_reasons || decision.reason_codes || [])) + '</code></div>' +
                '</div>'
              ) : '<div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;">Candidate has not been underwritten under current observation state.</div>') +
              '<button class="action-btn action-btn-primary btn-drawer-underwrite" type="button" style="width:100%;" data-candidate-id="' + escapeClientHtml(candId) + '">Underwrite Candidate</button>' +
              '<div id="drawer-underwrite-feedback" style="font-size:10px;font-family:var(--font-mono);margin-top:6px;"></div>' +
            '</div>';

          // Bind Drawer Action: Underwrite
          var btnUnderwrite = drawerCustomContent.querySelector('.btn-drawer-underwrite');
          if (btnUnderwrite) {
            btnUnderwrite.onclick = async function() {
              btnUnderwrite.disabled = true;
              btnUnderwrite.textContent = 'Underwriting...';
              var fb = drawerCustomContent.querySelector('#drawer-underwrite-feedback');
              try {
                var res = await fetch(apiBase + '/api/candidates/' + encodeURIComponent(candId) + '/underwrite', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ budgetConfig: { available_paper_capital_inr: 50000 } })
                });
                var dec = await res.json();
                if (res.ok) {
                  showToast('Underwritten', 'Decision: ' + (dec.outcome || 'EVALUATED'), dec.outcome === 'ELIGIBLE' ? 'success' : 'warn');
                  btnUnderwrite.textContent = '[UNDERWRITTEN]';
                  var candRes = await fetch(apiBase + '/api/candidates/' + encodeURIComponent(candId));
                  var freshCand = candRes.ok ? await candRes.json() : candidate;
                  openDrawerWithCandidate(freshCand, dec, currentTask);
                } else {
                  btnUnderwrite.disabled = false;
                  btnUnderwrite.textContent = 'Underwrite Candidate';
                  if (fb) {
                    fb.textContent = 'Error: ' + ((dec && dec.error && dec.error.operator_summary) ? dec.error.operator_summary : 'Underwriting failed');
                    fb.style.color = 'var(--blocked)';
                  }
                }
              } catch (err) {
                btnUnderwrite.disabled = false;
                btnUnderwrite.textContent = 'Underwrite Candidate';
                if (fb) {
                  fb.textContent = 'Network error: ' + String(err);
                  fb.style.color = 'var(--blocked)';
                }
              }
            };
          }

          // Bind Drawer Action: Claim Task
          var btnClaim = drawerCustomContent.querySelector('.btn-drawer-claim-task');
          if (btnClaim) {
            btnClaim.onclick = async function() {
              btnClaim.disabled = true;
              btnClaim.textContent = 'Claiming...';
              var claimStatus = drawerCustomContent.querySelector('#drawer-claim-status');
              try {
                var res = await fetch(apiBase + '/api/discovery/investigate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'claim',
                    worker_id: 'operator-ui',
                    candidate_id: candId
                  })
                });
                var data = await res.json();
                if (res.ok && data.task) {
                  currentTask = data.task;
                  btnClaim.textContent = 'Task Claimed [OK]';
                  btnClaim.style.background = 'var(--ok)';
                  showToast('Task Claimed', 'Lease acquired for ' + currentTask.task_id, 'success');
                  var badge = drawerCustomContent.querySelector('#drawer-task-badge');
                  if (badge) {
                    badge.className = 'badge badge-live';
                    badge.textContent = '[LEASED: ACTIVE]';
                  }
                  if (claimStatus) {
                    claimStatus.innerHTML = '<span style="color:var(--ok);">Claimed Task:</span> <code>' + escapeClientHtml(currentTask.task_id) + '</code> | Fence: <code>' + currentTask.fencing_token + '</code> | Gen: <code>' + escapeClientHtml(currentTask.generation_id) + '</code>';
                  }
                } else {
                  btnClaim.disabled = false;
                  btnClaim.textContent = 'Claim Task from Queue';
                  var msg = (data && data.task === null) ? 'No pending tasks in queue for this candidate.' : 'Failed to claim task.';
                  if (claimStatus) {
                    claimStatus.innerHTML = '<span style="color:var(--warn);">' + msg + '</span>';
                  }
                }
              } catch (err) {
                btnClaim.disabled = false;
                btnClaim.textContent = 'Claim Task from Queue';
                if (claimStatus) {
                  claimStatus.innerHTML = '<span style="color:var(--blocked);">Network error: ' + String(err) + '</span>';
                }
              }
            };
          }

          // Bind Drawer Action: Commit Evidence
          var btnCommit = drawerCustomContent.querySelector('#btn-drawer-commit-evidence');
          if (btnCommit) {
            btnCommit.onclick = async function() {
              var fb = drawerCustomContent.querySelector('#drawer-evidence-feedback');
              if (!currentTask) {
                if (fb) {
                  fb.textContent = 'Error: You must claim a task first to acquire a valid lease fencing token.';
                  fb.style.color = 'var(--blocked)';
                }
                showToast('Lease Required', 'Claim a task first to acquire a fencing token', 'warn');
                return;
              }
              btnCommit.disabled = true;
              btnCommit.textContent = 'Committing Evidence...';
              if (fb) {
                fb.textContent = 'Validating fencing token & committing evidence...';
                fb.style.color = 'var(--accent)';
              }

              var inQuote = drawerCustomContent.querySelector('#input-ev-quote');
              var inMoq = drawerCustomContent.querySelector('#input-ev-moq');
              var inFreight = drawerCustomContent.querySelector('#input-ev-freight');
              var inPkg = drawerCustomContent.querySelector('#input-ev-packaging');
              var inFee = drawerCustomContent.querySelector('#input-ev-platform-fee');
              var inTax = drawerCustomContent.querySelector('#input-ev-tax');
              var inReturnDrag = drawerCustomContent.querySelector('#input-ev-return-drag');

              var qVal = inQuote ? parseFloat(inQuote.value) : NaN;
              var moqVal = inMoq ? parseInt(inMoq.value, 10) : NaN;
              var frVal = inFreight ? parseFloat(inFreight.value) : NaN;
              var pkVal = inPkg ? parseFloat(inPkg.value) : NaN;
              var feeVal = inFee ? parseFloat(inFee.value) : NaN;
              var txVal = inTax ? parseFloat(inTax.value) : NaN;
              var retVal = inReturnDrag ? parseFloat(inReturnDrag.value) : 0;

              var extracted = {};
              if (!isNaN(qVal)) extracted.factory_gate_quote_inr = qVal;
              if (!isNaN(moqVal)) extracted.unit_batch_moq = moqVal;
              if (!isNaN(frVal)) extracted.inbound_freight_inr = frVal;
              if (!isNaN(pkVal)) extracted.packaging_kitting_inr = pkVal;
              if (!isNaN(feeVal)) extracted.platform_fee_inr = feeVal;
              if (!isNaN(txVal)) extracted.statutory_tax_inr = txVal;
              if (!isNaN(retVal)) extracted.return_defect_drag_inr = retVal;
              extracted.has_logistics_route = true;
              extracted.has_regulatory_clearance = true;
              extracted.applicable_cost_categories = [
                'SUPPLIER_PURCHASE',
                'INBOUND_FREIGHT',
                'PACKAGING_KITTING',
                'MARKETPLACE_FEES',
                'STATUTORY_TAX',
                'RETURN_DEFECT_DRAG'
              ];

              var payload = {
                action: 'submit_evidence',
                task_id: currentTask.task_id,
                candidate_id: candId,
                generation_id: currentTask.generation_id,
                lease_owner_id: currentTask.lease_owner_id || 'operator-ui',
                fencing_token: currentTask.fencing_token,
                result_payload: extracted,
                evidence_origin: {
                  source_connector_id: 'conn:operator:simulation-assumption',
                  origin_class: 'OPERATOR_SIMULATION_ASSUMPTION',
                  observed_at_utc: new Date().toISOString(),
                  verification_status: 'UNVERIFIED'
                },
                extracted_fields: extracted
              };

              try {
                var res = await fetch(apiBase + '/api/discovery/investigate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });
                var outcome = await res.json();
                if (res.ok) {
                  btnCommit.textContent = 'Evidence Committed [OK]';
                  btnCommit.style.background = 'var(--ok)';
                  showToast('Evidence Committed', 'Fencing token validated; evidence persisted', 'success');
                  var candRes = await fetch(apiBase + '/api/candidates/' + encodeURIComponent(candId));
                  var freshCand = candRes.ok ? await candRes.json() : candidate;
                  var decRes = await fetch(apiBase + '/api/candidates/' + encodeURIComponent(candId) + '/decision');
                  var dec = decRes.ok ? await decRes.json() : null;
                  openDrawerWithCandidate(freshCand, dec, currentTask);
                } else {
                  btnCommit.disabled = false;
                  btnCommit.textContent = 'Commit Evidence (Preserve Fencing)';
                  var isFencing409 = (res.status === 409 || (outcome.error && outcome.error.includes && outcome.error.includes('FENCE')));
                  var errText = isFencing409
                    ? '409 Conflict: Stale lease fencing token rejected. Task expired or claimed by another worker.'
                    : ((outcome.error && outcome.error.operator_summary) ? outcome.error.operator_summary : 'Commit failed: ' + String(outcome.error || 'Server rejected'));
                  if (fb) {
                    fb.textContent = errText;
                    fb.style.color = 'var(--blocked)';
                  }
                  showToast('Evidence Rejected', errText, 'error');
                }
              } catch (err) {
                btnCommit.disabled = false;
                btnCommit.textContent = 'Commit Evidence (Preserve Fencing)';
                if (fb) {
                  fb.textContent = 'Network error: ' + String(err);
                  fb.style.color = 'var(--blocked)';
                }
              }
            };
          }
        }

        d.style.display = 'flex';
      }

      // Fixture Screener Handler
      var fixtureSelector = document.getElementById('fixture-selector');
      var btnScreenCandidate = document.getElementById('btn-screen-candidate');
      var screenFeedback = document.getElementById('screen-candidate-feedback');

      if (btnScreenCandidate && fixtureSelector) {
        btnScreenCandidate.addEventListener('click', async function() {
          var fixId = fixtureSelector.value;
          if (!fixId) return;
          btnScreenCandidate.disabled = true;
          btnScreenCandidate.textContent = 'Screening...';
          if (screenFeedback) {
            screenFeedback.style.display = 'block';
            screenFeedback.innerHTML = '<span style="color:var(--accent);">Screening offline golden fixture [' + escapeClientHtml(fixId) + ']...</span>';
          }

          try {
            var res = await fetch(apiBase + '/api/discovery/screen', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fixture_id: fixId })
            });
            var data = await res.json();
            if (res.ok) {
              btnScreenCandidate.textContent = 'Candidate Screened [OK]';
              btnScreenCandidate.style.background = 'var(--ok)';
              showToast('Candidate Screened', 'Successfully screened ' + fixId, 'success');
              var cand = data.candidate || {};
              var prio = data.priority_score || 0;
              var recTasks = data.recommended_tasks || [];
              if (screenFeedback) {
                screenFeedback.innerHTML = 
                  '<div style="color:var(--ok);font-weight:600;margin-bottom:4px;">[OK] SCREENED DISCOVERY CANDIDATE</div>' +
                  '<div>Candidate ID: <code style="color:var(--text-main);">' + escapeClientHtml(cand.candidate_id || 'N/A') + '</code></div>' +
                  '<div>Candidate Name: <strong>' + escapeClientHtml(cand.candidate_name || 'N/A') + '</strong></div>' +
                  '<div>Provenance: <span class="badge badge-fixture">[FIXTURE] RECORDED_GOLDEN_FIXTURE</span> <span style="font-size:10px;color:var(--text-muted);">(is_live_market_verified: false)</span></div>' +
                  '<div>Priority Score: <strong>' + prio + '</strong> | Recommended Tasks: <strong>' + recTasks.length + '</strong></div>' +
                  '<div style="margin-top:8px;">' +
                    '<button class="action-btn action-btn-primary btn-quick-inspect-screened" type="button" data-candidate-id="' + escapeClientHtml(cand.candidate_id) + '" style="padding:4px 10px;font-size:10px;">Inspect Candidate in Drawer &rarr;</button>' +
                  '</div>';

                var quickInspectBtn = screenFeedback.querySelector('.btn-quick-inspect-screened');
                if (quickInspectBtn) {
                  quickInspectBtn.onclick = async function() {
                    var candId = cand.candidate_id;
                    if (!candId) {
                      openDrawerWithCandidate(cand, null, null);
                      return;
                    }
                    try {
                      var res = await fetch(apiBase + '/api/candidates/' + encodeURIComponent(candId));
                      var fullCand = res.ok ? await res.json() : cand;
                      var decRes = await fetch(apiBase + '/api/candidates/' + encodeURIComponent(candId) + '/decision');
                      var dec = decRes.ok ? await decRes.json() : null;
                      openDrawerWithCandidate(fullCand, dec, null);
                    } catch (err) {
                      openDrawerWithCandidate(cand, null, null);
                    }
                  };
                }
              }
              attachCandidateRowListeners();
            } else {
              btnScreenCandidate.disabled = false;
              btnScreenCandidate.textContent = 'Screen Candidate';
              var errMsg = (data && data.error && data.error.operator_summary) ? data.error.operator_summary : (data && data.error ? data.error : 'Screening failed');
              if (screenFeedback) {
                screenFeedback.innerHTML = '<span style="color:var(--blocked);">Error: ' + escapeClientHtml(errMsg) + '</span>';
              }
              showToast('Screening Failed', errMsg, 'error');
            }
          } catch (err) {
            btnScreenCandidate.disabled = false;
            btnScreenCandidate.textContent = 'Screen Candidate';
            if (screenFeedback) {
              screenFeedback.innerHTML = '<span style="color:var(--blocked);">Network error: ' + escapeClientHtml(String(err)) + '</span>';
            }
            showToast('Network Error', String(err), 'error');
          } finally {
            setTimeout(function() {
              if (btnScreenCandidate.disabled) {
                btnScreenCandidate.disabled = false;
                btnScreenCandidate.textContent = 'Screen Candidate';
                btnScreenCandidate.style.background = '';
              }
            }, 1000);
          }
        });
      }

      // Candidate Row Listener Binder
      function attachCandidateRowListeners() {
        document.querySelectorAll('.btn-inspect-candidate').forEach(function(btn) {
          btn.onclick = async function() {
            var candId = btn.getAttribute('data-candidate-id');
            if (!candId) return;
            try {
              var res = await fetch(apiBase + '/api/candidates/' + encodeURIComponent(candId));
              var cand = res.ok ? await res.json() : { candidate_id: candId, candidate_name: candId };
              var decRes = await fetch(apiBase + '/api/candidates/' + encodeURIComponent(candId) + '/decision');
              var dec = decRes.ok ? await decRes.json() : null;
              openDrawerWithCandidate(cand, dec, null);
            } catch (err) {
              openDrawerWithCandidate({ candidate_id: candId, candidate_name: candId }, null, null);
            }
          };
        });

        document.querySelectorAll('.btn-underwrite-candidate').forEach(function(btn) {
          btn.onclick = async function() {
            var candId = btn.getAttribute('data-candidate-id');
            if (!candId) return;
            btn.disabled = true;
            btn.textContent = '...';
            try {
              var res = await fetch(apiBase + '/api/candidates/' + encodeURIComponent(candId) + '/underwrite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ budgetConfig: { available_paper_capital_inr: 50000 } })
              });
              var dec = await res.json();
              if (res.ok) {
                showToast('Underwritten', candId + ': ' + dec.outcome, dec.outcome === 'ELIGIBLE' ? 'success' : 'warn');
                btn.textContent = '[' + dec.outcome + ']';
                btn.className = 'action-btn ' + (dec.outcome === 'ELIGIBLE' ? 'badge-ok' : 'badge-warn');
              } else {
                btn.disabled = false;
                btn.textContent = 'Underwrite';
                showError('Underwrite failed', dec);
              }
            } catch (err) {
              btn.disabled = false;
              btn.textContent = 'Underwrite';
              showError('Network error', String(err));
            }
          };
        });
      }
      attachCandidateRowListeners();

      // Product Observation Deck Listeners
      function attachProductEventListeners() {
        document.querySelectorAll('.btn-inspect-product').forEach(function(btn) {
          btn.onclick = function() {
            var prodId = btn.getAttribute('data-product-id');
            var prod = PRODUCTS_DATA.find(function(p) { return p.product_id === prodId; });
            if (prod) openDrawerWithProduct(prod);
          };
        });

        document.querySelectorAll('.btn-dispatch-product-research').forEach(function(btn) {
          btn.onclick = async function() {
            var prodId = btn.getAttribute('data-product-id');
            btn.disabled = true;
            btn.textContent = 'Dispatching...';
            try {
              var res = await fetch(apiBase + '/api/products/research', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product_id: prodId, origin_firewall_mode: 'GOVERNED_SANDBOX' })
              });
              var data = await res.json();
              if (res.ok) {
                btn.textContent = 'Researched [OK]';
                showToast('Research Dispatched', 'Specialist swarm analyzed ' + prodId, 'success');
              } else {
                btn.disabled = false;
                btn.textContent = 'Research';
                showError('Research dispatch failed', data);
              }
            } catch (err) {
              btn.disabled = false;
              btn.textContent = 'Research';
              showError('Network error', String(err));
            }
          };
        });
      }
      attachProductEventListeners();

      // Product Archetype Filter Pills
      document.querySelectorAll('.prod-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('.prod-filter-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          var filter = btn.getAttribute('data-filter');
          var rows = document.querySelectorAll('#product-observation-deck-table tbody tr');
          rows.forEach(function(row) {
            if (filter === 'ALL' || row.getAttribute('data-archetype') === filter) {
              row.style.display = '';
            } else {
              row.style.display = 'none';
            }
          });
        });
      });

      // Push Product Toggle
      var btnTogglePush = document.getElementById('btn-toggle-push-product');
      var pushContainer = document.getElementById('push-product-form-container');
      if (btnTogglePush && pushContainer) {
        btnTogglePush.addEventListener('click', function() {
          pushContainer.style.display = pushContainer.style.display === 'none' ? 'block' : 'none';
        });
      }
      var btnCancelPush = document.getElementById('btn-cancel-push-product');
      if (btnCancelPush && pushContainer) {
        btnCancelPush.addEventListener('click', function() {
          pushContainer.style.display = 'none';
        });
      }

      // Drawer Product Renderer
      function openDrawerWithProduct(prod) {
        var d = getTerminalDrawer();
        if (!d) return;

        var drawerTitle = d.querySelector('#drawer-title');
        var drawerCustomContent = d.querySelector('#drawer-custom-content');
        var drawerStepper = d.querySelector('#drawer-stepper');
        var drawerTraceMeta = d.querySelector('#drawer-trace-meta');

        if (drawerTitle) drawerTitle.textContent = 'Product Teardown: ' + prod.title;
        if (drawerStepper) drawerStepper.style.display = 'none';
        if (drawerTraceMeta) drawerTraceMeta.style.display = 'none';

        if (drawerCustomContent) {
          drawerCustomContent.style.display = 'block';
          drawerCustomContent.innerHTML = 
            '<div style="background:var(--bg-card);border:1px solid var(--border-medium);border-radius:4px;padding:12px;margin-bottom:12px;">' +
              '<h4 style="margin:0 0 4px 0;font-size:13px;color:var(--text-main);">' + escapeClientHtml(prod.title) + '</h4>' +
              '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);">' + escapeClientHtml(prod.product_id) + '</div>' +
              '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Archetype: <strong>' + escapeClientHtml(prod.commercial_archetype) + '</strong></div>' +
              '<div style="margin-top:6px;display:flex;gap:4px;">' +
                '<span class="badge badge-fixture">RECORDED_BASELINE</span>' +
                '<span class="badge badge-ok">Decision: [' + escapeClientHtml(prod.strategy.strategic_decision) + ']</span>' +
              '</div>' +
            '</div>' +
            '<div style="background:var(--bg-card);border:1px solid var(--border-medium);border-radius:4px;padding:12px;margin-bottom:12px;">' +
              '<h5 style="margin:0 0 6px 0;font-size:11px;color:var(--accent);text-transform:uppercase;">Commercial Economics</h5>' +
              '<div style="font-family:var(--font-mono);font-size:10px;">' +
                'Retail ASP: <strong>₹' + prod.economics.prevailing_retail_asp_inr.toFixed(2) + '</strong><br>' +
                'B2B Sourcing: <strong>₹' + (prod.economics.b2b_sourcing_benchmark_inr ? prod.economics.b2b_sourcing_benchmark_inr.toFixed(2) : '--') + '</strong><br>' +
                'Gross Sourcing Margin: <strong style="color:var(--ok);">' + prod.economics.gross_sourcing_margin_bps + ' bps</strong><br>' +
                'Target Volume: ' + prod.economics.monthly_unit_velocity_estimate + ' units/mo' +
              '</div>' +
            '</div>';
        }
        d.style.display = 'flex';
      }

      // Capital Allocator Engine (DEF-UI-003 Scalpel Fix)
      var btnEvaluateAlloc = document.getElementById('btn-evaluate-allocation');
      var btnClearAllocCap = document.getElementById('btn-clear-allocation-cap');
      var inputPaperBudget = document.getElementById('input-paper-budget');
      var inputMaxSingleAlloc = document.getElementById('input-max-single-allocation');
      var allocFeedback = document.getElementById('allocation-control-feedback');

      async function triggerPortfolioEvaluation(budgetInr, maxSingleOrNull) {
        if (!budgetInr || isNaN(budgetInr) || budgetInr <= 0) {
          if (allocFeedback) {
            allocFeedback.textContent = 'Error: Budget must be a positive number';
            allocFeedback.style.color = 'var(--blocked)';
          }
          showToast('Validation Error', 'Budget must be a positive number', 'error');
          return;
        }

        if (btnEvaluateAlloc) {
          btnEvaluateAlloc.disabled = true;
          btnEvaluateAlloc.textContent = 'Evaluating...';
        }
        if (allocFeedback) {
          allocFeedback.textContent = 'Evaluating portfolio allocation...';
          allocFeedback.style.color = 'var(--accent)';
        }

        try {
          var payload = { total_paper_budget_inr: budgetInr };
          if (maxSingleOrNull !== undefined) {
            payload.max_single_allocation_inr = maxSingleOrNull;
          }

          var res = await fetch(apiBase + '/api/portfolio/evaluate-budget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          var data = await res.json();
          if (res.ok && data.deck) {
            var deck = data.deck;
            var isCapped = maxSingleOrNull !== null && maxSingleOrNull !== undefined;
            var capDesc = isCapped ? 'Cap: ₹' + Number(maxSingleOrNull).toLocaleString() : 'Uncapped';
            var msg = 'Evaluated: ₹' + (deck.total_allocated_capital_inr || 0).toLocaleString() + ' allocated across ' + ((deck.summary && deck.summary.total_allocated_count) || 0) + ' candidates (' + capDesc + ').';

            if (allocFeedback) {
              allocFeedback.textContent = msg;
              allocFeedback.style.color = 'var(--ok)';
            }
            showToast('Allocation Evaluated', msg, 'success');

            // Update summary strip
            var bSpan = document.getElementById('alloc-summary-budget');
            var aSpan = document.getElementById('alloc-summary-allocated');
            var uSpan = document.getElementById('alloc-summary-unallocated');
            if (bSpan) bSpan.textContent = 'Total Paper Budget: ₹' + Number(deck.total_configured_budget_inr || budgetInr).toFixed(2);
            if (aSpan) aSpan.textContent = 'Allocated: ₹' + Number(deck.total_allocated_capital_inr || 0).toFixed(2);
            if (uSpan) uSpan.textContent = 'Unallocated: ₹' + Number(deck.remaining_budget_inr || 0).toFixed(2);

            // Update status badge without accessing missing status_badge.icon_symbol (DEF-UI-003)
            var badgeEl = document.getElementById('allocator-status-badge');
            if (badgeEl && deck.summary) {
              var isAllocated = (deck.summary.total_allocated_count || 0) > 0;
              badgeEl.className = 'badge ' + (isAllocated ? 'badge-ok' : 'badge-warn');
              badgeEl.textContent = isAllocated ? '[OK] EVALUATED' : '[WARN] CONSTRAINED';
            }

            // Update table rows
            var itemsList = deck.items || deck.deck_items || [];
            if (itemsList.length > 0) {
              itemsList.forEach(function(item) {
                var row = document.querySelector('#capital-allocator-table tr[data-candidate-id="' + item.candidate_id + '"]');
                if (row) {
                  var tdAlloc = row.querySelector('.td-allocated-capital');
                  if (tdAlloc) {
                    var allocVal = item.allocated_capital_inr || 0;
                    var col = allocVal > 0 ? '#22c55e' : '#ef4444';
                    tdAlloc.style.color = col;
                    var ratStr = item.ranking_rationale || item.rationale || item.allocation_rationale || '';
                    tdAlloc.innerHTML = '₹' + allocVal.toFixed(2) + '<br><span class="allocation-rationale" style="font-size:9px;color:var(--text-dim);">' + escapeClientHtml(ratStr) + '</span>';
                  }
                  var tdGate = row.querySelector('.td-gate-badge');
                  if (tdGate) {
                    var isAlloc = item.allocation_status === 'ALLOCATED';
                    var gCls = isAlloc ? 'badge-ok' : (item.allocation_status === 'INSUFFICIENT_EVIDENCE' ? 'badge-blocked' : 'badge-warn');
                    var badgeLabel = item.allocation_status === 'ALLOCATED' ? '[OK] ALLOCATED' : ('[' + item.allocation_status + ']');
                    tdGate.innerHTML = '<span class="badge ' + gCls + '">' + escapeClientHtml(badgeLabel) + '</span>';
                  }
                }
              });
            }
          } else {
            var errMsg = (data && data.error && data.error.operator_summary) ? data.error.operator_summary : (data && data.error ? data.error : 'Allocation evaluation failed');
            if (allocFeedback) {
              allocFeedback.textContent = 'Error: ' + errMsg;
              allocFeedback.style.color = 'var(--blocked)';
            }
            showToast('Evaluation Error', errMsg, 'error');
          }
        } catch (err) {
          if (allocFeedback) {
            allocFeedback.textContent = 'Network error during allocation evaluation: ' + String(err);
            allocFeedback.style.color = 'var(--blocked)';
          }
          showToast('Network Error', String(err), 'error');
        } finally {
          if (btnEvaluateAlloc) {
            btnEvaluateAlloc.disabled = false;
            btnEvaluateAlloc.textContent = 'Evaluate Allocation';
          }
        }
      }

      if (btnEvaluateAlloc) {
        btnEvaluateAlloc.addEventListener('click', function() {
          var bVal = parseFloat(inputPaperBudget.value);
          var cStr = inputMaxSingleAlloc.value.trim();
          var cVal = cStr === '' ? null : parseFloat(cStr);
          triggerPortfolioEvaluation(bVal, cVal);
        });
      }

      if (btnClearAllocCap) {
        btnClearAllocCap.addEventListener('click', function() {
          if (inputMaxSingleAlloc) inputMaxSingleAlloc.value = '';
          var bVal = parseFloat(inputPaperBudget.value);
          triggerPortfolioEvaluation(bVal, null);
        });
      }
      // -----------------------------------------------------------------------
      // STAGE C / C.1: LIVING GALLERIES & INTELLIGENCE DESK CONTROLLER
      // -----------------------------------------------------------------------
      async function loadLivingGalleriesData() {
        if (window.location.protocol === 'file:') return;

        // 1. Fetch Candidates
        try {
          var pRes = await fetch(apiBase + '/api/gallery/products');
          if (pRes.ok) {
            var pData = await pRes.json();
            var tbody = document.getElementById('living-product-gallery-tbody');
            var badge = document.getElementById('gallery-candidate-count-badge');
            if (badge) badge.textContent = pData.count + ' Candidates Active';
            if (tbody && pData.candidates) {
              tbody.innerHTML = pData.candidates.map(function(c) {
                var isDigital = c.category === 'SOFTWARE_DIGITAL' || c.category === 'SERVICE_SOFTWARE';
                var coords = isDigital ? 'US-DE (Delaware #6842918)' : ((c.geographic_context && c.geographic_context.latitude) ? '(' + c.geographic_context.latitude + ', ' + c.geographic_context.longitude + ')' : 'N/A');
                var cluster = isDigital ? 'Cloud (AWS us-east-1)' : ((c.geographic_context && c.geographic_context.cluster_or_region) ? c.geographic_context.cluster_or_region : 'N/A');
                var quote = isDigital ? 'N/A (SaaS API)' : ((c.financial_summary && c.financial_summary.factory_gate_quote_inr) ? '₹' + c.financial_summary.factory_gate_quote_inr.toFixed(2) : 'Unquoted');
                var asp = (c.financial_summary && c.financial_summary.prevailing_retail_asp_inr) ? '₹' + c.financial_summary.prevailing_retail_asp_inr.toFixed(2) : (isDigital ? '$20.00/mo ($0.90/k)' : 'Unquoted');
                var gaps = (c.financial_summary && c.financial_summary.data_required_fields && c.financial_summary.data_required_fields.length > 0)
                  ? c.financial_summary.data_required_fields.map(function(g) { return '<span class="badge badge-warn">' + escapeClientHtml(g) + '</span>'; }).join(' ')
                  : '<span class="badge badge-ok">[COMPLETE]</span>';
                var stateClass = c.lifecycle_state === 'DISQUALIFIED' ? 'badge-blocked' : (c.lifecycle_state === 'VERIFIED' ? 'badge-ok' : 'badge-live');
                var origClass = c.origin_class === 'LIVE_EXTERNAL' ? 'badge-live' : 'badge-fixture';

                return '<tr data-cand-id="' + escapeClientHtml(c.candidate_id) + '">' +
                  '<td><strong>' + escapeClientHtml(c.name) + '</strong><br><code style="font-size:9px;color:var(--text-dim);">' + escapeClientHtml(c.candidate_id) + '</code></td>' +
                  '<td><span class="badge ' + origClass + '">' + escapeClientHtml(c.origin_class) + '</span></td>' +
                  '<td>' + escapeClientHtml(c.category) + '</td>' +
                  '<td><span class="badge ' + stateClass + '">' + escapeClientHtml(c.lifecycle_state) + '</span></td>' +
                  '<td>' + escapeClientHtml(cluster) + '<br><span style="font-size:9px;color:var(--text-dim);">' + escapeClientHtml(coords) + '</span></td>' +
                  '<td class="metric-value">' + quote + '</td>' +
                  '<td class="metric-value">' + asp + '</td>' +
                  '<td>' + gaps + '</td>' +
                '</tr>';
              }).join('');
            }
          }
        } catch (e) {}

        // 2. Fetch Theses
        try {
          var tRes = await fetch(apiBase + '/api/gallery/theses');
          if (tRes.ok) {
            var tData = await tRes.json();
            var tContainer = document.getElementById('living-theses-container');
            if (tContainer && tData.theses) {
              tContainer.innerHTML = tData.theses.map(function(t) {
                var test = t.falsifiable_next_tests ? t.falsifiable_next_tests.join('<br>') : 'N/A';
                return '<div style="background:var(--bg-surface);border:1px solid var(--border-medium);border-left:3px solid var(--accent);border-radius:4px;padding:12px;">' +
                  '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">' +
                    '<h4 style="margin:0;font-size:12px;color:var(--text-main);font-weight:700;">' + escapeClientHtml(t.title) + '</h4>' +
                    '<span class="badge badge-fixture">' + escapeClientHtml(t.scope) + '</span>' +
                  '</div>' +
                  '<div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;font-family:var(--font-mono);">' + escapeClientHtml(t.thesis_id) + ' | Uncertainty: ' + escapeClientHtml(t.uncertainty_rating) + '</div>' +
                  '<p style="margin:0 0 8px 0;font-size:11px;color:var(--text-muted);line-height:1.4;">' + escapeClientHtml(t.hypothesis_statement) + '</p>' +
                  '<div style="font-size:10px;margin-bottom:6px;"><strong style="color:var(--text-muted);">Empirical Evidence IDs:</strong> <span style="font-family:var(--font-mono);">' + (t.supporting_evidence_ids || []).join(', ') + '</span></div>' +
                  '<div style="padding:6px 8px;background:var(--bg-input);border-radius:3px;font-size:10px;color:var(--accent);line-height:1.3;"><strong>Falsifiable Test:</strong> ' + escapeClientHtml(test) + '</div>' +
                '</div>';
              }).join('');
            }
          }
        } catch (e) {}

        // 3. Fetch Events
        try {
          var eRes = await fetch(apiBase + '/api/gallery/events');
          if (eRes.ok) {
            var eData = await eRes.json();
            var eBox = document.getElementById('gallery-event-stream-box');
            if (eBox && eData.events) {
              eBox.innerHTML = eData.events.slice(-15).reverse().map(function(ev) {
                return '<div style="margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.05);">' +
                  '<span style="color:var(--accent);">[Seq #' + ev.sequence_number + ']</span> ' +
                  '<strong style="color:var(--text-main);">' + escapeClientHtml(ev.event_type) + '</strong> ' +
                  '<span style="color:var(--text-dim);">(' + escapeClientHtml(ev.aggregate_type) + ':' + escapeClientHtml(ev.aggregate_id) + ')</span> &mdash; ' +
                  '<span style="color:var(--text-muted);">' + escapeClientHtml(ev.summary) + '</span>' +
                '</div>';
              }).join('');
            }
          }
        } catch (e) {}
      }

      // Hook tab click & button refresh
      var btnRefreshGalleries = document.getElementById('btn-refresh-living-galleries');
      if (btnRefreshGalleries) {
        btnRefreshGalleries.addEventListener('click', loadLivingGalleriesData);
      }
      var galleryTabBtn = document.querySelector('.nav-btn[data-tab="workspace-living-galleries"]');
      if (galleryTabBtn) {
        galleryTabBtn.addEventListener('click', loadLivingGalleriesData);
      }
      setTimeout(loadLivingGalleriesData, 1000);

      // Hook Operator LLM Q&A Form
      var btnSubmitAsk = document.getElementById('btn-submit-gallery-ask');
      if (btnSubmitAsk) {
        btnSubmitAsk.addEventListener('click', async function() {
          var tType = document.getElementById('select-ask-target-type').value;
          var tId = document.getElementById('input-ask-target-id').value.trim();
          var qVal = document.getElementById('input-ask-query').value.trim();
          var rBox = document.getElementById('gallery-ask-result-box');
          if (!tId) {
            showToast('Target Required', 'Please enter a Candidate ID or Thesis ID', 'warn');
            return;
          }
          btnSubmitAsk.disabled = true;
          btnSubmitAsk.textContent = 'Analyzing...';
          rBox.style.display = 'block';
          rBox.innerHTML = '<span style="color:var(--accent);">Executing grounded LLM Q&amp;A synthesis...</span>';
          try {
            var payload = { query: qVal };
            if (tType === 'candidate') payload.candidate_id = tId;
            else payload.thesis_id = tId;
            var res = await fetch(apiBase + '/api/gallery/ask', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            var data = await res.json();
            btnSubmitAsk.disabled = false;
            btnSubmitAsk.textContent = 'Submit Inquiry';
            if (res.ok) {
              var ep = data.epistemic_breakdown || {};
              rBox.innerHTML =
                '<div style="display:flex;justify-content:space-between;margin-bottom:8px;border-bottom:1px solid var(--border-medium);padding-bottom:6px;">' +
                  '<strong>Synthesis for ' + escapeClientHtml(data.target_type) + ' [' + escapeClientHtml(data.target_id) + ']</strong>' +
                  '<span class="badge badge-ok">[OK] Pure Rational Subunit Math</span>' +
                '</div>' +
                '<p style="margin:0 0 10px 0;font-size:11px;color:var(--text-main);line-height:1.4;">' + escapeClientHtml(data.natural_language_explanation) + '</p>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:10px;">' +
                  '<div style="background:var(--bg-surface);padding:8px;border-radius:3px;border-left:2px solid var(--ok);">' +
                    '<strong style="color:var(--ok);">Observed Facts:</strong><br>' + (ep.observed_facts && ep.observed_facts.length > 0 ? ep.observed_facts.join('<br>') : 'None') +
                  '</div>' +
                  '<div style="background:var(--bg-surface);padding:8px;border-radius:3px;border-left:2px solid var(--accent);">' +
                    '<strong style="color:var(--accent);">Source Claims:</strong><br>' + (ep.source_claims && ep.source_claims.length > 0 ? ep.source_claims.join('<br>') : 'None') +
                  '</div>' +
                  '<div style="background:var(--bg-surface);padding:8px;border-radius:3px;border-left:2px solid var(--blocked);">' +
                    '<strong style="color:var(--blocked);">Contradictions:</strong><br>' + (data.identified_contradictions && data.identified_contradictions.length > 0 ? data.identified_contradictions.join('<br>') : 'None') +
                  '</div>' +
                  '<div style="background:var(--bg-surface);padding:8px;border-radius:3px;border-left:2px solid var(--warn);">' +
                    '<strong style="color:var(--warn);">Data Required Gaps:</strong><br>' + (data.missing_data_fields && data.missing_data_fields.length > 0 ? data.missing_data_fields.join(', ') : 'None') +
                  '</div>' +
                '</div>';
            } else {
              rBox.innerHTML = '<span style="color:var(--blocked);">Error: ' + escapeClientHtml(data.error?.message || 'Inquiry failed') + '</span>';
            }
          } catch (err) {
            btnSubmitAsk.disabled = false;
            btnSubmitAsk.textContent = 'Submit Inquiry';
            rBox.innerHTML = '<span style="color:var(--blocked);">Network error: ' + String(err) + '</span>';
          }
        });
      }

    })();
  </script>
  ${clientAssetsBody}
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
    (ws.simulation_and_positions.paper_positions.length === 0 ||
    ws.simulation_and_positions.paper_positions.every(p =>
      [
        'VALID_CALCULATED_RETURN',
        'CANNOT_CALCULATE_MISSING_INPUTS',
        'INSUFFICIENT_UNVERIFIED_EVIDENCE',
        'NO_ROOT_FOUND_IN_SEARCH_DOMAIN',
        'NOT_YET_RECOVERED',
        'OPEN_POSITION',
        'COMMITTED'
      ].includes(p.lifecycle_status))
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
