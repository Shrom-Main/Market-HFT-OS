/**
 * SUITE-31: Gate M6.9 Comprehensive MCP Protocol Hardening, Constrained Egress Connector,
 * First-Class Evidence Origin Firewall, GoldenExtractionBench, Topological DAG Waves,
 * and Stage 9 Read-Only Operator Terminal Telemetry Upgrade (Decision OD-19 / Charter DEC-019)
 *
 * Normative Acceptance Suite for Stage 9 / Gate M6.9 (12 Tests):
 * 1.  MCP-M69-PROTOCOL-LIFECYCLE-AND-POSITIVE-MANIFEST-001: McpCapabilityBroker wire protocol
 *     handles initialize (2025-11-25), notifications/initialized, ping, tools/list, resources/list,
 *     resources/read, notifications/cancelled, requireInitializedSession check (E-MCP-SESSION-NOT-INITIALIZED),
 *     positive tool manifests (additionalProperties: false / E-MCP-UNKNOWN-ARGUMENT-REJECTED), and handler
 *     SHA-256 integrity (E-MCP-HANDLER-TAMPERED).
 * 2.  MCP-M69-HMAC-GRANT-SIGNATURE-AND-CUMULATIVE-WALLCLOCK-002: McpCapabilityBroker verifies HMAC-SHA256
 *     signed CapabilityGrant (E-MCP-GRANT-SIGNATURE-INVALID), calling worker/task identity
 *     (E-MCP-WORKER-IDENTITY-MISMATCH), and cumulative task wall-clock budget (E-MCP-TASK-WALL-CLOCK-EXCEEDED).
 * 3.  MCP-M69-CONSTRAINED-HTTPS-DNS-REBINDING-AND-PORT-003: ConstrainedHttpsConnector enforces port 443 only
 *     (E-MCP-PORT-DENIED), scheme https only (E-MCP-SCHEME-DENIED), pre-resolves DNS rejecting
 *     private/loopback/metadata IPs (E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED), and supports injectable dnsLookupFn.
 * 4.  MCP-M69-STREAMING-BYTE-CUTOFF-AND-ABORT-004: ConstrainedHttpsConnector streaming fetch cuts off in-flight
 *     streams via ReadableStream reader when exceeding max_payload_bytes cap (E-MCP-STREAM-PAYLOAD-TOO-LARGE)
 *     and enforces timeout cancellation (E-MCP-LATENCY-TIMEOUT).
 * 5.  MCP-M69-HONEST-EVIDENCE-ORIGIN-NO-SILENT-FALLBACK-005: SourceCaptureWorker and MediaAndChatterWorker
 *     fail closed (E-WORKER-UNSUPPORTED-OR-UNMAPPED-SOURCE) on unmapped targets rather than falling back
 *     to default fixtures, preserving requested_url vs resolved_source_identity and evidence_origin_class.
 * 6.  MCP-M69-ORIGIN-PROMOTION-AND-LOOKAHEAD-FIREWALL-006: EvidencePromotionEngine blocks non-live evidence from
 *     executable promotion (E-EV-NON-LIVE-ORIGIN-PROMOTION-FORBIDDEN), RedTeam rule RT-08 blocks non-live
 *     evidence from allocation, and Macro/Govt workers reject look-ahead bias (E-MLW-LOOKAHEAD-BIAS-REJECTED).
 * 7.  MCP-M69-BROKERED-GROQ-EGRESS-AND-REDACTION-007: GroqFormulaAdvisor locks egress to approved endpoint
 *     (E-GROQ-UNAPPROVED-ENDPOINT), scrubs API keys/secrets via redactPromptSecrets/redactPromptInputs, and
 *     tags proposals with LLM_MODEL_PROPOSAL evidence origin class.
 * 8.  MCP-M69-ADALA-GOLDEN-EXTRACTION-BENCH-008: GoldenExtractionBench certifies extraction workers
 *     achieving 10000n bps precision, recall, and exact match, and runAllWorkerBenchmarks evaluates all 4 workers.
 * 9.  MCP-M69-PLAN-DRIVEN-TOPOLOGICAL-DAG-WAVES-009: executeCompiledDagPlan executes multi-wave topological
 *     plans with dependency ordering, bounded parallelism, and activation_predicate filtering.
 * 10. MCP-M69-DURABLE-LEDGER-AND-DAG-CHECKPOINT-RESTART-010: McpRunLedger and DagCheckpointStore support
 *     durable file persistence (saveLedgerToFile / loadLedgerFromFile / saveDagCheckpointToFile /
 *     resumeDagFromCheckpoint) with tamper detection (E-MCP-LEDGER-TAMPERED, E-DAG-CHECKPOINT-TAMPERED).
 * 11. MCP-M69-TERMINAL-ORIGIN-HMAC-AND-BENCH-PROJECTION-011: OperatorTerminalController projects Origin Breakdown,
 *     HMAC & DNS egress telemetry, GoldenExtractionBench worker scores, dynamic 7-bucket conservation badge (OTC-01),
 *     and HTML sanitization (OTC-02).
 * 12. MCP-M69-END-TO-END-JCS-AND-CHARTER-DEC019-012: Full end-to-end integration proving RFC 8785 JCS
 *     canonicalization determinism, zero float math, and Charter DEC-019 governance invariants.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import {
  McpServerAdapter,
  McpCapabilityBroker,
  createCapabilityGrant,
  signCapabilityGrant,
  verifyCapabilityGrantSignature,
  McpRunLedger,
  ConstrainedHttpsConnector,
  McpToolDescriptor,
  CapabilityGrant
} from '../../src/mcp/mcpSubstrate.js';
import {
  SourceCaptureWorker,
  registerSourceCaptureTool
} from '../../src/agents/workers/sourceCaptureWorker.js';
import {
  MacroAndLateralMarketWorker,
  registerMacroLateralTool
} from '../../src/agents/workers/macroLateralWorker.js';
import {
  GovtAndStatutoryWorker,
  registerGovtStatutoryTool
} from '../../src/agents/workers/govtStatutoryWorker.js';
import {
  MediaAndChatterWorker,
  registerMediaChatterTool
} from '../../src/agents/workers/mediaChatterWorker.js';
import {
  RedTeamAndConflictWorker,
  registerRedTeamTool
} from '../../src/agents/workers/redTeamWorker.js';
import {
  EvidencePromotionEngine,
  EvidenceEnvelope
} from '../../src/research/m5SignalAndEvidenceEngine.js';
import {
  GroqFormulaAdvisor,
  APPROVED_GROQ_ENDPOINT,
  redactPromptSecrets,
  redactPromptInputs
} from '../../src/research/llmFormulaAdvisor.js';
import {
  GoldenExtractionBench
} from '../../src/agents/evaluation/goldenExtractionBench.js';
import {
  executeCompiledDagPlan,
  DagCheckpointStore,
  DagCheckpoint,
  CompiledDagPlan,
  saveDagCheckpointToFile,
  resumeDagFromCheckpoint
} from '../../src/agents/scheduler/contextRoutingStateMachine.js';
import {
  OperatorTerminalController,
  renderOperatorTerminalHtml,
  evaluateTwelvePointPlatformReadiness,
  createSemanticStatusBadge,
  createEvidenceOriginBadge,
  escapeHtml,
  TerminalProjectionParams
} from '../../src/terminal/operatorTerminalController.js';

function createMockSnapshotParams(overrides: Partial<TerminalProjectionParams> = {}): TerminalProjectionParams {
  const as_of_timestamp_utc = '2026-10-18T16:00:00.000Z';

  const liveBadge = createEvidenceOriginBadge(
    'LIVE_VERIFIED_CAPTURE',
    'https://www.indiamart.com/proddetail/ss304-hose-clamp-10pack.html',
    'https://www.indiamart.com/proddetail/ss304-hose-clamp-10pack.html'
  );

  const fixtureBadge = createEvidenceOriginBadge(
    'RECORDED_GOLDEN_FIXTURE',
    'https://www.amazon.in/dp/B01N47983X',
    'fixture://golden/amazon_ss304_clamp_march2026.html'
  );

  return {
    as_of_timestamp_utc,
    command_center: {
      available_treasury_capital_inr: {
        value: '50000.00',
        unit: 'INR',
        classification: 'ACTUAL',
        source_lineage_ref: 'ledger://bank_settlement/2026-10-18'
      },
      committed_paper_capital_inr: {
        value: '19105.00',
        unit: 'INR',
        classification: 'SIMULATED',
        source_lineage_ref: 'sim://allocations/run-001'
      },
      unrecovered_dwell_capital_inr: {
        value: '3821.00',
        unit: 'INR',
        classification: 'SIMULATED',
        source_lineage_ref: 'sim://positions/pos-001'
      },
      active_research_runs_count: {
        value: 3,
        unit: 'UNITS',
        classification: 'OBSERVED',
        source_lineage_ref: 'dag://scheduler/active_runs'
      },
      risk_alerts_count: {
        value: 0,
        unit: 'UNITS',
        classification: 'OBSERVED',
        source_lineage_ref: 'redteam://alerts/active'
      },
      ledger_reconciliation_status: createSemanticStatusBadge('RECON_OK', '[OK]', 'BALANCED'),
      active_kill_switch_scope: 'NORMAL_PAPER_OPERATION',
      cumulative_wall_clock_budget_utilization_bps: 1420
    },
    opportunity_radar: {
      total_active_opportunities: {
        value: 2,
        unit: 'UNITS',
        classification: 'OBSERVED',
        source_lineage_ref: 'radar://opportunities/active'
      },
      badge: createSemanticStatusBadge('RADAR_OK', '[OK]', 'ACTIVE'),
      opportunities: [
        {
          candidate_id: 'CAND-SS304-001',
          sku_id: 'SKU-CLAMP-SS304-10PK',
          source_freshness_age_seconds: {
            value: 45,
            unit: 'DAYS',
            classification: 'OBSERVED',
            source_lineage_ref: 'source://indiamart/snapshot-001'
          },
          edge_decay_regime: 'SUSTAINED_STRUCTURAL_SIGNAL',
          half_life_days: {
            value: 45,
            unit: 'DAYS',
            classification: 'ESTIMATED',
            source_lineage_ref: 'regime://classifier/half_life'
          },
          evidence_gap_status: 'DATA_COMPLETE',
          timers: [
            {
              timer_name: 'Supplier Quote Validity',
              deadline_or_duration: '2026-10-25T16:00:00.000Z',
              classification: 'MEASURED_DEADLINE'
            },
            {
              timer_name: 'Estimated Warehouse Dwell',
              deadline_or_duration: '14 days',
              classification: 'MODELLED_ESTIMATE'
            }
          ],
          evidence_origin: liveBadge,
          badge: createSemanticStatusBadge('OPP_VALID', '[OK]', 'QUALIFIED')
        },
        {
          candidate_id: 'CAND-SS304-FIXTURE-002',
          sku_id: 'SKU-CLAMP-SS304-AMZ-FIXTURE',
          source_freshness_age_seconds: {
            value: 120,
            unit: 'DAYS',
            classification: 'OBSERVED',
            source_lineage_ref: 'source://fixture/snapshot-002'
          },
          edge_decay_regime: 'FAST_TACTICAL_OPPORTUNITY',
          half_life_days: {
            value: 10,
            unit: 'DAYS',
            classification: 'ESTIMATED',
            source_lineage_ref: 'regime://classifier/half_life'
          },
          evidence_gap_status: 'DATA_COMPLETE',
          timers: [
            {
              timer_name: 'Fixture Stamp',
              deadline_or_duration: '2026-03-31T00:00:00.000Z',
              classification: 'MODELLED_ESTIMATE'
            }
          ],
          evidence_origin: fixtureBadge,
          badge: createSemanticStatusBadge('OPP_FIXTURE', '[WARN]', 'FIXTURE_ONLY')
        }
      ]
    },
    evidence_workbench: {
      conflict_holds_count: {
        value: 0,
        unit: 'UNITS',
        classification: 'OBSERVED',
        source_lineage_ref: 'evidence://conflicts'
      },
      badge: createSemanticStatusBadge('EVIDENCE_OK', '[OK]', 'VERIFIED'),
      records: [
        {
          claim_id: 'CLM-LIVE-001',
          entity_id: 'ENT-SUPPLIER-001',
          evidence_kind: 'OBSERVED',
          verification_status: 'VERIFIED',
          commercial_status: 'VERIFIED_EXECUTABLE_OFFER',
          requested_url: 'https://www.indiamart.com/proddetail/ss304-hose-clamp-10pack.html',
          resolved_source_identity: 'https://www.indiamart.com/proddetail/ss304-hose-clamp-10pack.html',
          evidence_origin: liveBadge,
          lookahead_bias_status: 'CLEAN_NO_LOOKAHEAD',
          dom_sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          provenance_lineage: 'sourceCaptureWorker:mcp://source-capture/http_get_snapshot',
          conflict_hold: false,
          origin_firewall_blocked: false,
          promoted_at_utc: '2026-10-18T16:00:00.000Z',
          badge: createSemanticStatusBadge('CLAIM_OK', '[OK]', 'PROMOTED')
        },
        {
          claim_id: 'CLM-FIXTURE-002',
          entity_id: 'ENT-AMAZON-002',
          evidence_kind: 'EXTERNALLY_PUBLISHED',
          verification_status: 'UNVERIFIED',
          commercial_status: 'ADVERTISED_LISTING',
          requested_url: 'https://www.amazon.in/dp/B01N47983X',
          resolved_source_identity: 'fixture://golden/amazon_ss304_clamp_march2026.html',
          evidence_origin: fixtureBadge,
          lookahead_bias_status: 'CLEAN_NO_LOOKAHEAD',
          transcript_sha256: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
          provenance_lineage: 'fixture://replay/golden_corpus',
          conflict_hold: false,
          origin_firewall_blocked: true,
          badge: createSemanticStatusBadge('CLAIM_FIXTURE', '[FIXTURE]', 'NON_PROMOTABLE')
        }
      ]
    },
    economics_lab: {
      sku_id: 'SKU-CLAMP-SS304-10PK',
      landed_cost_inr: {
        value: '38.21',
        unit: 'INR',
        classification: 'SIMULATED',
        source_lineage_ref: 'formula://FIN-LANDED-COST-001'
      },
      fee_gst_rate_bps: {
        value: 1800,
        unit: 'BPS',
        classification: 'OBSERVED',
        source_lineage_ref: 'circular://CBIC/GST/HSN-73269099'
      },
      sec_52_tcs_rate_bps: {
        value: 100,
        unit: 'BPS',
        classification: 'OBSERVED',
        source_lineage_ref: 'circular://CBIC/TCS/SEC-52'
      },
      sec_194_o_tds_rate_bps: {
        value: 100,
        unit: 'BPS',
        classification: 'OBSERVED',
        source_lineage_ref: 'circular://CBDT/TDS/SEC-194-O'
      },
      return_attrition_drag_bps: {
        value: 200,
        unit: 'BPS',
        classification: 'ESTIMATED',
        source_lineage_ref: 'formula://FIN-RETURN-ATTRITION-004'
      },
      tiered_moq_brackets: [
        { min_qty: 100, max_qty: 249, unit_price_inr: '31.00', selected: false },
        { min_qty: 250, max_qty: 499, unit_price_inr: '28.50', selected: false },
        { min_qty: 500, max_qty: 9999, unit_price_inr: '25.00', selected: true }
      ],
      spread_and_breakeven_bands: {
        upper_spread_bps: 4500,
        breakeven_price_inr: '52.14',
        lower_scrap_floor_inr: '25.89'
      },
      cash_flow_j_curve: [
        { day: 0, cumulative_cash_flow_inr: '-38.21' },
        { day: 15, cumulative_cash_flow_inr: '-38.21' },
        { day: 25, cumulative_cash_flow_inr: '0.00' },
        { day: 35, cumulative_cash_flow_inr: '23.45' }
      ],
      arbitrage_greeks: {
        delta_bps: 850,
        theta_bps: -12,
        vega_bps: 45
      },
      formula_registry_cards: [
        { card_id: 'FIN-LANDED-COST-001', title: 'SS304 Landed Cost EXW', status: 'PROMOTED_NORMATIVE' },
        { card_id: 'FIN-STATUTORY-TCS-TDS-003', title: 'Statutory Withholding TCS/TDS', status: 'PROMOTED_NORMATIVE' },
        { card_id: 'FIN-CANDIDATE-CUSTOMS-006', title: 'Customs Demurrage Drag Model', status: 'CANDIDATE_UI_MODEL' }
      ],
      groq_egress_audit: {
        endpoint_locked_to_groq_api: true,
        verified_endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        prompt_redaction_applied: true,
        evidence_origin_class: 'LLM_MODEL_PROPOSAL',
        badge: createSemanticStatusBadge('GROQ_OK', '[LIVE]', 'APPROVED_EGRESS')
      },
      badge: createSemanticStatusBadge('ECON_OK', '[OK]', 'STABLE')
    },
    capital_allocator: {
      total_paper_budget_inr: {
        value: '50000.00',
        unit: 'INR',
        classification: 'ACTUAL',
        source_lineage_ref: 'treasury://budget/cap'
      },
      allocated_paper_capital_inr: {
        value: '19105.00',
        unit: 'INR',
        classification: 'SIMULATED',
        source_lineage_ref: 'allocator://pareto/run-001'
      },
      unallocated_paper_capital_inr: {
        value: '30895.00',
        unit: 'INR',
        classification: 'SIMULATED',
        source_lineage_ref: 'allocator://unallocated/run-001'
      },
      badge: createSemanticStatusBadge('ALLOC_OK', '[OK]', 'OPTIMIZED'),
      opportunities: [
        {
          candidate_id: 'CAND-SS304-001',
          expected_return_bps: { value: 6138, unit: 'BPS', classification: 'ESTIMATED', source_lineage_ref: 'econ://expected_return' },
          return_after_costs_and_taxes_bps: { value: 3994, unit: 'BPS', classification: 'ESTIMATED', source_lineage_ref: 'econ://rowc' },
          risk_and_downside_buffer_bps: { value: 2500, unit: 'BPS', classification: 'ESTIMATED', source_lineage_ref: 'econ://buffer' },
          capital_requirement_inr: { value: '19105.00', unit: 'INR', classification: 'ESTIMATED', source_lineage_ref: 'econ://capital_req' },
          time_to_execution_days: { value: 3, unit: 'DAYS', classification: 'ESTIMATED', source_lineage_ref: 'logistics://exec_lead' },
          cash_recovery_ccc_days: { value: 35, unit: 'DAYS', classification: 'ESTIMATED', source_lineage_ref: 'econ://ccc' },
          liquidity_lockup_ratio_bps: { value: 3821, unit: 'BPS', classification: 'ESTIMATED', source_lineage_ref: 'treasury://lockup' },
          opportunity_cost_benchmark_bps: { value: 650, unit: 'BPS', classification: 'OBSERVED', source_lineage_ref: 'rbi://91d_tbill' },
          edge_decay_half_life_days: { value: 45, unit: 'DAYS', classification: 'ESTIMATED', source_lineage_ref: 'regime://half_life' },
          evidence_conviction_score_bps: { value: 10000, unit: 'BPS', classification: 'ESTIMATED', source_lineage_ref: 'evidence://conviction' },
          allocated_capital_inr: { value: '19105.00', unit: 'INR', classification: 'SIMULATED', source_lineage_ref: 'allocator://decision' },
          conviction_vs_allocation_rationale: 'Live verified supplier quote with corroborated catalog and statutory margin headroom.',
          evidence_origin: liveBadge,
          drilldown_lineage: {
            headline_return_ref: 'formula://FIN-CCC-ROWC-005',
            fee_tax_assumption_ref: 'circular://CBIC/GST/HSN-73269099',
            source_document_sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
          },
          gate_badge: createSemanticStatusBadge('GATE_PASS', '[OK]', 'ALLOCATED')
        },
        {
          candidate_id: 'CAND-SS304-FIXTURE-002',
          expected_return_bps: { value: 12500, unit: 'BPS', classification: 'ESTIMATED', source_lineage_ref: 'econ://expected_return' },
          return_after_costs_and_taxes_bps: { value: 8900, unit: 'BPS', classification: 'ESTIMATED', source_lineage_ref: 'econ://rowc' },
          risk_and_downside_buffer_bps: { value: 1200, unit: 'BPS', classification: 'ESTIMATED', source_lineage_ref: 'econ://buffer' },
          capital_requirement_inr: { value: '25000.00', unit: 'INR', classification: 'ESTIMATED', source_lineage_ref: 'econ://capital_req' },
          time_to_execution_days: { value: 5, unit: 'DAYS', classification: 'ESTIMATED', source_lineage_ref: 'logistics://exec_lead' },
          cash_recovery_ccc_days: { value: 45, unit: 'DAYS', classification: 'ESTIMATED', source_lineage_ref: 'econ://ccc' },
          liquidity_lockup_ratio_bps: { value: 5000, unit: 'BPS', classification: 'ESTIMATED', source_lineage_ref: 'treasury://lockup' },
          opportunity_cost_benchmark_bps: { value: 650, unit: 'BPS', classification: 'OBSERVED', source_lineage_ref: 'rbi://91d_tbill' },
          edge_decay_half_life_days: { value: 10, unit: 'DAYS', classification: 'ESTIMATED', source_lineage_ref: 'regime://half_life' },
          evidence_conviction_score_bps: { value: 2000, unit: 'BPS', classification: 'ESTIMATED', source_lineage_ref: 'evidence://conviction' },
          allocated_capital_inr: { value: '0.00', unit: 'INR', classification: 'SIMULATED', source_lineage_ref: 'allocator://decision' },
          conviction_vs_allocation_rationale: 'Unverified advertised listing and golden fixture origin; allocated capital capped strictly at ₹0.00.',
          evidence_origin: fixtureBadge,
          drilldown_lineage: {
            headline_return_ref: 'formula://FIN-CCC-ROWC-005',
            fee_tax_assumption_ref: 'circular://CBIC/GST/HSN-73269099',
            source_document_sha256: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3'
          },
          gate_badge: createSemanticStatusBadge('GATE_BLOCKED', '[BLOCKED]', 'ZERO_ALLOCATION')
        }
      ]
    },
    simulation_and_positions: {
      cash_ledger_balance_inr: {
        value: '50000.00',
        unit: 'INR',
        classification: 'ACTUAL',
        source_lineage_ref: 'ledger://paper/cash_head'
      },
      badge: createSemanticStatusBadge('SIM_OK', '[OK]', 'BALANCED'),
      seven_bucket_inventory: {
        raw_material: 0,
        work_in_progress: 0,
        finished_goods: 500,
        intransit_to_fba: 0,
        fba_available: 500,
        reserved_customer: 0,
        returned_quarantine: 0,
        total_conserved: 1000
      },
      paper_positions: [
        {
          position_id: 'POS-001',
          candidate_id: 'CAND-SS304-001',
          allocated_capital_inr: '19105.00',
          lifecycle_status: 'VALID_CALCULATED_RETURN',
          inventory_conservation_proven: true,
          badge: createSemanticStatusBadge('POS_VALID', '[OK]', 'ACTIVE')
        },
        {
          position_id: 'POS-002',
          candidate_id: 'CAND-SS304-FIXTURE-002',
          allocated_capital_inr: '0.00',
          lifecycle_status: 'INSUFFICIENT_UNVERIFIED_EVIDENCE',
          inventory_conservation_proven: true,
          badge: createSemanticStatusBadge('POS_UNVERIFIED', '[WARN]', 'EVIDENCE_INSUFFICIENT')
        }
      ]
    },
    reconciliation_and_performance: {
      factor_efficacy_ledger: [
        { factor_name: 'Plumbing Industrial Capex Index', observed_correlation_bps: 8200, regime_efficacy: 'EMPIRICALLY_VALIDATED_DRIVER' },
        { factor_name: 'Social Forum Buzz Spike', observed_correlation_bps: 120, regime_efficacy: 'EMPIRICALLY_REFUTED_NOISE' }
      ],
      bitemporal_restatements: [
        {
          record_id: 'BT-001',
          decision_time_utc: '2026-10-18T10:00:00.000Z',
          knowledge_time_utc: '2026-10-18T16:00:00.000Z',
          restatement_diff_summary: 'LME SS304 scrap floor updated from ₹25.20 to ₹25.89; thesis intact.'
        }
      ],
      cross_ledger_comparison: {
        paper_ledger_total_inr: '50000.00',
        actuals_ledger_total_inr: '0.00',
        direct_merge_blocked: true,
        actuals_write_blocked: true,
        cash_conservation_status: createSemanticStatusBadge('CASH_CONSERVED', '[OK]', 'CONSERVED'),
        inventory_conservation_status: createSemanticStatusBadge('INV_CONSERVED', '[OK]', 'CONSERVED')
      },
      reconciliation_exceptions: [],
      badge: createSemanticStatusBadge('RECON_OK', '[OK]', 'CLEAN')
    },
    risk_audit_and_system_health: {
      hmac_grant_telemetry: [
        {
          grant_id: 'grant-task-001-worker-scw',
          task_id: 'task-001',
          worker_id: 'worker:source-capture:v1',
          mcp_session_initialized: true,
          grant_signature_hmac: 'hmac_sha256_mock_signature_valid',
          hmac_signature_verified: true,
          positive_manifest_id: 'manifest:source-capture:v1',
          handler_code_sha256: 'handler_sha256_mock_valid_hash',
          requests_made: 1,
          max_requests: 4,
          cumulative_task_wall_clock_ms: 240,
          max_task_wall_clock_ms: 10000,
          last_call_latency_ms: 240,
          max_latency_ms: 5000,
          stream_bytes_read: 15420,
          max_payload_bytes: 524288,
          tokens_used: 120,
          max_tokens: 2000,
          egress_telemetry: {
            allow_network_egress: true,
            resolved_dns_ips: ['104.26.12.31'],
            verified_port: 443,
            stream_aborted_for_oversize: false,
            abort_signal_triggered: false
          }
        }
      ],
      golden_extraction_bench_scores: [
        {
          worker_id: 'worker:source-capture:v1',
          extractor_version: '1.0.0',
          golden_cases_evaluated: 4,
          precision_bps: 10000,
          recall_bps: 10000,
          exact_match_bps: 10000,
          certification_status: 'CERTIFIED_100_PCT',
          benchmark_corpus_sha256: 'bench_corpus_sha256_valid'
        },
        {
          worker_id: 'worker:media-chatter:v1',
          extractor_version: '1.0.0',
          golden_cases_evaluated: 3,
          precision_bps: 10000,
          recall_bps: 10000,
          exact_match_bps: 10000,
          certification_status: 'CERTIFIED_100_PCT',
          benchmark_corpus_sha256: 'bench_corpus_sha256_valid'
        },
        {
          worker_id: 'worker:macro-lateral:v1',
          extractor_version: '1.0.0',
          golden_cases_evaluated: 3,
          precision_bps: 10000,
          recall_bps: 10000,
          exact_match_bps: 10000,
          certification_status: 'CERTIFIED_100_PCT',
          benchmark_corpus_sha256: 'bench_corpus_sha256_valid'
        },
        {
          worker_id: 'worker:govt-statutory:v1',
          extractor_version: '1.0.0',
          golden_cases_evaluated: 4,
          precision_bps: 10000,
          recall_bps: 10000,
          exact_match_bps: 10000,
          certification_status: 'CERTIFIED_100_PCT',
          benchmark_corpus_sha256: 'bench_corpus_sha256_valid'
        }
      ],
      mcp_worker_dag_nodes: [
        { node_id: 'node-pass1-scw', pass: 1, status: 'COMPLETED', dependencies: [] },
        { node_id: 'node-pass1-macro', pass: 1, status: 'COMPLETED', dependencies: [] },
        { node_id: 'node-pass1-govt', pass: 1, status: 'COMPLETED', dependencies: [] },
        { node_id: 'node-pass2-chatter', pass: 2, status: 'COMPLETED', dependencies: ['node-pass1-scw', 'node-pass1-macro'] },
        { node_id: 'node-pass3-redteam', pass: 3, status: 'COMPLETED', dependencies: ['node-pass2-chatter', 'node-pass1-govt'] }
      ],
      dag_checkpoint_sha256: 'dag_cp_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      mcp_quotas: [
        {
          grant_id: 'grant-001',
          worker_id: 'worker:source-capture:v1',
          requests_made: 1,
          max_requests: 4,
          tokens_used: 120,
          max_tokens: 2000,
          payload_bytes: 15420,
          max_bytes: 524288,
          wall_clock_ms: 240,
          max_wall_clock_ms: 10000
        }
      ],
      denied_mcp_calls_count: 0,
      red_team_findings: [],
      kill_switch_state: {
        active_scope: 'NORMAL_PAPER_OPERATION'
      },
      hash_chain_integrity: {
        verified: true,
        chain_length: 5,
        root_hash: 'root_sha256_mock_hash'
      },
      system_health_alert: false,
      badge: createSemanticStatusBadge('SYSTEM_OK', '[OK]', 'HEALTHY')
    },
    ...overrides
  };
}

describe('SUITE-31: Gate M6.9 Comprehensive MCP Protocol Hardening & Terminal Certification', () => {
  let server: McpServerAdapter;
  let runLedger: McpRunLedger;
  let broker: McpCapabilityBroker;
  let scwGrant: CapabilityGrant;
  let mcwGrant: CapabilityGrant;
  let macroGrant: CapabilityGrant;
  let govtGrant: CapabilityGrant;

  const COMMON_HOSTS = [
    'www.amazon.in',
    'dir.indiamart.com',
    'www.indiamart.com',
    'catalog.howrah-industrial.com',
    'gem.gov.in',
    'www.rbi.org.in',
    'www.fbil.org.in',
    'www.lme.com',
    'www.nseindia.com',
    'mospi.gov.in',
    'msme.gov.in',
    'cbic.gov.in',
    'cbic-gst.gov.in',
    'dgft.gov.in',
    'financialservices.gov.in',
    'www.youtube.com',
    'sellercentral.amazon.in',
    'transcripts.approved-corpus.local'
  ];

  beforeEach(() => {
    server = new McpServerAdapter();
    registerSourceCaptureTool(server);
    registerMacroLateralTool(server);
    registerGovtStatutoryTool(server);
    registerMediaChatterTool(server);
    registerRedTeamTool(server);
    runLedger = new McpRunLedger();
    broker = new McpCapabilityBroker(server, runLedger);

    scwGrant = createCapabilityGrant({
      grant_id: 'grant:suite31:scw',
      task_id: 'task:suite31:verification',
      worker_id: SourceCaptureWorker.WORKER_ID,
      allowed_tools: ['mcp://source-capture/http_get_snapshot'],
      allowed_hosts: COMMON_HOSTS,
      allowed_methods: ['GET'],
      max_requests: 50,
      max_payload_bytes: 524288,
      max_latency_ms: 5000,
      max_tokens: 200000,
      expires_at_utc: '2026-12-31T23:59:59.000Z'
    });

    mcwGrant = createCapabilityGrant({
      grant_id: 'grant:suite31:mcw',
      task_id: 'task:suite31:verification',
      worker_id: MediaAndChatterWorker.WORKER_ID,
      allowed_tools: ['mcp://media-corpus/fetch_transcript'],
      allowed_hosts: COMMON_HOSTS,
      allowed_methods: ['GET'],
      max_requests: 50,
      max_payload_bytes: 524288,
      max_latency_ms: 5000,
      max_tokens: 200000,
      expires_at_utc: '2026-12-31T23:59:59.000Z'
    });

    macroGrant = createCapabilityGrant({
      grant_id: 'grant:suite31:macro',
      task_id: 'task:suite31:verification',
      worker_id: MacroAndLateralMarketWorker.WORKER_ID,
      allowed_tools: ['mcp://macro-feeds/query_series'],
      allowed_hosts: COMMON_HOSTS,
      allowed_methods: ['GET'],
      max_requests: 50,
      max_payload_bytes: 524288,
      max_latency_ms: 5000,
      max_tokens: 200000,
      expires_at_utc: '2026-12-31T23:59:59.000Z'
    });

    govtGrant = createCapabilityGrant({
      grant_id: 'grant:suite31:govt',
      task_id: 'task:suite31:verification',
      worker_id: GovtAndStatutoryWorker.WORKER_ID,
      allowed_tools: ['mcp://policy-bulletins/fetch_circular'],
      allowed_hosts: COMMON_HOSTS,
      allowed_methods: ['GET'],
      max_requests: 50,
      max_payload_bytes: 524288,
      max_latency_ms: 5000,
      max_tokens: 200000,
      expires_at_utc: '2026-12-31T23:59:59.000Z'
    });
  });

  // --------------------------------------------------------------------------
  // TEST 1: MCP Wire Protocol Lifecycle & Positive Tool Manifest Registry
  // --------------------------------------------------------------------------
  it('MCP-M69-PROTOCOL-LIFECYCLE-AND-POSITIVE-MANIFEST-001: McpCapabilityBroker wire protocol and positive manifest enforcement', async () => {
    // 1. initialize negotiation
    const initRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' }
    });
    expect(initRes).not.toBeNull();
    expect(initRes?.error).toBeUndefined();
    expect((initRes?.result as Record<string, unknown>)?.protocolVersion).toBe('2025-11-25');
    expect((initRes?.result as Record<string, unknown>)?.serverInfo).toBeDefined();

    // 2. initialize with unsupported version
    const unsupportedInit = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'init-2',
      method: 'initialize',
      params: { protocolVersion: '2024-01-01' }
    });
    expect(unsupportedInit?.error).toBeDefined();
    expect(unsupportedInit?.error?.code).toBe(-32602);
    expect(unsupportedInit?.error?.message).toContain('E-MCP-UNSUPPORTED-PROTOCOL-VERSION');

    // 3. requireInitializedSession check before notifications/initialized
    const strictBroker = new McpCapabilityBroker(server, runLedger, { requireInitializedSession: true });
    const prematureCall = await strictBroker.invokeTool(scwGrant, {
      jsonrpc: '2.0',
      id: 'premature-1',
      method: 'tools/call',
      params: {
        name: 'mcp://source-capture/http_get_snapshot',
        arguments: {
          url: 'https://catalog.howrah-industrial.com/item',
          target_url: 'https://catalog.howrah-industrial.com/item'
        }
      }
    });
    expect(prematureCall.error?.message).toContain('E-MCP-SESSION-NOT-INITIALIZED');

    // 4. notifications/initialized
    expect(broker.isInitialized()).toBe(false);
    const notifRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });
    expect(notifRes).toBeNull();
    expect(broker.isInitialized()).toBe(true);

    // 5. ping
    const pingRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'ping-1',
      method: 'ping'
    });
    expect(pingRes?.result).toEqual({});

    // 6. tools/list
    const toolsRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'tools-list-1',
      method: 'tools/list'
    });
    const tools = (toolsRes?.result as { tools: readonly McpToolDescriptor[] })?.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.some((t) => t.name === 'mcp://source-capture/http_get_snapshot')).toBe(true);

    // 7. resources/list and resources/read
    server.registerResource({
      descriptor: {
        uri: 'resource://statutory/msme/interest-multiplier',
        name: 'MSMED Act Section 16 Multiplier',
        mimeType: 'application/json'
      },
      read: async () => ({
        uri: 'resource://statutory/msme/interest-multiplier',
        mimeType: 'application/json',
        text: JSON.stringify({ rbi_bank_rate_multiplier: 3, statutory_day_cap: 45 })
      })
    });

    const resList = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'res-list-1',
      method: 'resources/list'
    });
    const resources = (resList?.result as { resources: readonly { uri: string }[] })?.resources;
    expect(resources.some((r) => r.uri === 'resource://statutory/msme/interest-multiplier')).toBe(true);

    const resRead = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'res-read-1',
      method: 'resources/read',
      params: { uri: 'resource://statutory/msme/interest-multiplier' }
    });
    expect(resRead?.error).toBeUndefined();
    const contents = (resRead?.result as { contents: readonly { text: string }[] })?.contents;
    expect(contents[0]?.text).toContain('"rbi_bank_rate_multiplier":3');

    // 8. Positive Tool Manifest & Handler SHA-256 integrity
    const customServer = new McpServerAdapter();
    const testHandler = async () => ({ content: [{ type: 'text' as const, text: 'ok' }] });
    const correctSha = sha256(testHandler.toString());

    const positiveManifest: McpToolDescriptor = {
      name: 'mcp://custom/test-manifest-tool',
      description: 'Strict manifest tool',
      inputSchema: {
        type: 'object',
        properties: { field_1: { type: 'string' } },
        required: ['field_1'],
        additionalProperties: false
      },
      handlerSha256: correctSha
    };

    customServer.registerTool({ descriptor: positiveManifest, handler: testHandler });

    expect(() => {
      customServer.validateArguments(positiveManifest, {
        field_1: 'valid_val',
        unexpected_extra_field: 'malicious'
      });
    }).toThrow(/E-MCP-UNKNOWN-ARGUMENT-REJECTED/);

    expect(() => {
      customServer.registerTool({
        descriptor: {
          ...positiveManifest,
          name: 'mcp://custom/tampered-tool',
          handlerSha256: '0000000000000000000000000000000000000000000000000000000000000000'
        },
        handler: testHandler
      });
    }).toThrow(/E-MCP-HANDLER-TAMPERED/);

    // 9. tools/call without grant fails closed
    const callWithoutGrant = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: { name: 'mcp://source-capture/http_get_snapshot', arguments: {} }
    });
    expect(callWithoutGrant?.error?.message).toContain('E-MCP-GRANT-REQUIRED');

    // 10. notifications/cancelled returns null
    const cancelRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 'call-999' }
    });
    expect(cancelRes).toBeNull();
  });

  // --------------------------------------------------------------------------
  // TEST 2: HMAC-SHA256 Signed Capability Grant & Cumulative Task Wall-Clock
  // --------------------------------------------------------------------------
  it('MCP-M69-HMAC-GRANT-SIGNATURE-AND-CUMULATIVE-WALLCLOCK-002: Capability grant HMAC signatures, identity binding and cumulative wall-clock quotas', async () => {
    const hmacSecret = 'stage9-m69-audit-signing-key-production';
    const secureBroker = new McpCapabilityBroker(server, runLedger, { hmacSecret });

    const baseGrant = createCapabilityGrant({
      grant_id: 'grant:sec:001',
      task_id: 'task:sec:001',
      worker_id: 'worker:source-capture:v1',
      allowed_tools: ['mcp://source-capture/http_get_snapshot'],
      allowed_hosts: ['catalog.howrah-industrial.com'],
      allowed_methods: ['GET'],
      max_requests: 5,
      max_payload_bytes: 262144,
      max_latency_ms: 2000,
      max_tokens: 10000,
      max_task_wall_clock_ms: 1500,
      expires_at_utc: '2026-12-31T23:59:59.000Z'
    });

    // 1. Unsigned grant is rejected by broker configured with hmacSecret
    const unsignedCall = await secureBroker.invokeTool(baseGrant, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'mcp://source-capture/http_get_snapshot',
        arguments: { target_url: 'https://catalog.howrah-industrial.com/item' }
      }
    });
    expect(unsignedCall.error?.message).toContain('E-MCP-GRANT-SIGNATURE-INVALID');

    // 2. Sign grant with secret
    const signedGrant = signCapabilityGrant(baseGrant, hmacSecret);
    expect(verifyCapabilityGrantSignature(signedGrant, hmacSecret)).toBe(true);
    expect(verifyCapabilityGrantSignature(signedGrant, 'wrong-secret')).toBe(false);

    // 3. Tampered grant fails signature verification
    const tamperedGrant = { ...signedGrant, max_requests: 999 };
    const tamperedCall = await secureBroker.invokeTool(tamperedGrant, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'mcp://source-capture/http_get_snapshot',
        arguments: { target_url: 'https://catalog.howrah-industrial.com/item' }
      }
    });
    expect(tamperedCall.error?.message).toContain('E-MCP-GRANT-SIGNATURE-INVALID');

    // 4. Calling Worker Identity Mismatch
    const imposterCall = await secureBroker.invokeTool(
      signedGrant,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'mcp://source-capture/http_get_snapshot',
          arguments: {
            target_url: 'https://catalog.howrah-industrial.com/item',
            raw_html_payload: '<div class="price">100</div>'
          }
        }
      },
      { callingWorkerId: 'worker:imposter:v1', callingTaskId: 'task:sec:001' }
    );
    expect(imposterCall.error?.message).toContain('E-MCP-WORKER-IDENTITY-MISMATCH');

    // 5. Calling Task Identity Mismatch
    const wrongTaskCall = await secureBroker.invokeTool(
      signedGrant,
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'mcp://source-capture/http_get_snapshot',
          arguments: {
            target_url: 'https://catalog.howrah-industrial.com/item',
            raw_html_payload: '<div class="price">100</div>'
          }
        }
      },
      { callingWorkerId: 'worker:source-capture:v1', callingTaskId: 'task:wrong:999' }
    );
    expect(wrongTaskCall.error?.message).toContain('E-MCP-WORKER-IDENTITY-MISMATCH');

    // 6. Cumulative task wall-clock budget
    const tightBudgetGrant = signCapabilityGrant(
      createCapabilityGrant({
        grant_id: 'grant:sec:002',
        task_id: 'task:sec:tight-budget',
        worker_id: 'worker:source-capture:v1',
        allowed_tools: ['mcp://source-capture/http_get_snapshot'],
        allowed_hosts: ['catalog.howrah-industrial.com'],
        max_requests: 5,
        max_payload_bytes: 262144,
        max_latency_ms: 2000,
        max_tokens: 10000,
        max_task_wall_clock_ms: 0,
        expires_at_utc: '2026-12-31T23:59:59.000Z'
      }),
      hmacSecret
    );

    const budgetExceededCall = await secureBroker.invokeTool(
      tightBudgetGrant,
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'mcp://source-capture/http_get_snapshot',
          arguments: {
            target_url: 'https://catalog.howrah-industrial.com/item',
            raw_html_payload: '<div class="price">100</div>'
          }
        }
      },
      { callingWorkerId: 'worker:source-capture:v1', callingTaskId: 'task:sec:tight-budget' }
    );
    expect(budgetExceededCall.error?.message).toContain('E-MCP-TASK-WALL-CLOCK-EXCEEDED');
  });

  // --------------------------------------------------------------------------
  // TEST 3: Constrained HTTPS Connector DNS Rebinding & Port Locking
  // --------------------------------------------------------------------------
  it('MCP-M69-CONSTRAINED-HTTPS-DNS-REBINDING-AND-PORT-003: ConstrainedHttpsConnector locks port 443, pre-resolves DNS, and denies private IPs', async () => {
    // 1. Port denied (only 443 permitted)
    await expect(
      ConstrainedHttpsConnector.fetch('https://dir.indiamart.com:8443/item', {
        max_payload_bytes: 1024,
        timeout_ms: 1000
      })
    ).rejects.toThrow(/E-MCP-PORT-DENIED/);

    // 2. Scheme denied (only https permitted)
    await expect(
      ConstrainedHttpsConnector.fetch('http://dir.indiamart.com/item', {
        max_payload_bytes: 1024,
        timeout_ms: 1000
      })
    ).rejects.toThrow(/E-MCP-SCHEME-DENIED/);

    // 3. SSRF / DNS Rebinding to loopback / private IP
    await expect(
      ConstrainedHttpsConnector.fetch('https://127.0.0.1/item', {
        max_payload_bytes: 1024,
        timeout_ms: 1000
      })
    ).rejects.toThrow(/E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED/);

    await expect(
      ConstrainedHttpsConnector.fetch('https://localhost/item', {
        max_payload_bytes: 1024,
        timeout_ms: 1000
      })
    ).rejects.toThrow(/E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED/);

    // 4. Injectable dnsLookupFn detecting DNS rebinding to private subnet (10.0.0.1)
    await expect(
      ConstrainedHttpsConnector.fetch('https://dir.indiamart.com/item', {
        max_payload_bytes: 1024,
        timeout_ms: 1000,
        dnsLookupFn: async () => [{ address: '10.0.0.1', family: 4 }]
      })
    ).rejects.toThrow(/E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED/);

    // 5. Injectable dnsLookupFn throwing error triggers E-MCP-DNS-RESOLUTION-FAILED
    await expect(
      ConstrainedHttpsConnector.fetch('https://dir.indiamart.com/item', {
        max_payload_bytes: 1024,
        timeout_ms: 1000,
        dnsLookupFn: async () => { throw new Error('DNS NXDOMAIN'); }
      })
    ).rejects.toThrow(/E-MCP-DNS-RESOLUTION-FAILED/);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Streaming Byte Cutoff & AbortController Latency Enforcer
  // --------------------------------------------------------------------------
  it('MCP-M69-STREAMING-BYTE-CUTOFF-AND-ABORT-004: In-flight streaming response cutoff and latency abort', async () => {
    const fakeChunk = new Uint8Array(64);
    fakeChunk.fill(65);

    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(fakeChunk);
        controller.enqueue(fakeChunk);
        controller.enqueue(fakeChunk);
        controller.enqueue(fakeChunk);
        controller.close();
      }
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(mockStream, {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      });
    });

    try {
      await expect(
        ConstrainedHttpsConnector.fetch('https://www.google.com/test', {
          max_payload_bytes: 100,
          timeout_ms: 2000,
          dnsLookupFn: async () => [{ address: '142.250.190.46', family: 4 }]
        })
      ).rejects.toThrow(/E-MCP-STREAM-PAYLOAD-TOO-LARGE/);
    } finally {
      vi.restoreAllMocks();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 5: Honest Evidence Origin Tracking & Fail-Closed Workers
  // --------------------------------------------------------------------------
  it('MCP-M69-HONEST-EVIDENCE-ORIGIN-NO-SILENT-FALLBACK-005: Workers fail closed on unmapped targets and preserve evidence origin lineage', async () => {
    const scwWorker = new SourceCaptureWorker(broker, scwGrant);
    const mcwWorker = new MediaAndChatterWorker(broker, mcwGrant);

    // SourceCaptureWorker fails closed on unmapped target
    await expect(
      scwWorker.captureAndExtract({
        task_id: 'task:fail-closed:001',
        worker_id: SourceCaptureWorker.WORKER_ID,
        target_url: 'https://dir.indiamart.com/unmapped-supplier/not-in-fixtures',
        source_profile: 'INDIAMART_SUPPLIER_LISTING',
        execution_mode: 'RECORDED_FIXTURE_REPLAY',
        requested_at_utc: '2026-10-18T00:00:00.000Z'
      })
    ).rejects.toThrow(/E-WORKER-UNSUPPORTED-OR-UNMAPPED-SOURCE/);

    // MediaAndChatterWorker fails closed on unmapped target
    await expect(
      mcwWorker.fetchAndExtract({
        task_id: 'task:fail-closed:002',
        worker_id: MediaAndChatterWorker.WORKER_ID,
        target_url: 'https://transcripts.approved-corpus.local/unmapped-source',
        media_type: 'YOUTUBE_UNBOXING_OR_REVIEW',
        requested_at_utc: '2026-10-18T00:00:00.000Z'
      })
    ).rejects.toThrow(/E-WORKER-UNSUPPORTED-OR-UNMAPPED-SOURCE/);

    // Preserves requested_url vs resolved_source_identity on caller-supplied payload
    const customUrl = 'https://dir.indiamart.com/custom-supplier';
    const scwRes = await scwWorker.captureAndExtract({
      task_id: 'task:custom-payload:003',
      worker_id: SourceCaptureWorker.WORKER_ID,
      target_url: customUrl,
      source_profile: 'HOWRAH_B2B_DISTRIBUTOR_CATALOG',
      execution_mode: 'RECORDED_FIXTURE_REPLAY',
      raw_html_payload: '<span class="price">Rs 140 / pack</span>',
      requested_at_utc: '2026-10-18T00:00:00.000Z'
    });

    expect(scwRes.evidence_envelope.provenance_lineage.source_id).toBe(customUrl);
    expect(scwRes.evidence_envelope.provenance_lineage.requested_url).toBe(customUrl);
    expect(scwRes.evidence_envelope.provenance_lineage.resolved_source_identity).toBe('caller://raw_html_payload');
    expect(scwRes.evidence_envelope.provenance_lineage.evidence_origin_class).toBe('CALLER_SUPPLIED_PAYLOAD');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Origin Promotion Firewall & Lookahead Bias Prevention
  // --------------------------------------------------------------------------
  it('MCP-M69-ORIGIN-PROMOTION-AND-LOOKAHEAD-FIREWALL-006: Origin promotion firewall, RT-08 rule, and look-ahead bias rejection', async () => {
    const syntheticEnvelope: EvidenceEnvelope<{ price: number }> = {
      evidence_id: 'ev:test:synth:001',
      kind: 'OBSERVED_FACT',
      verification_status: 'UNVERIFIED',
      commercial_status: 'ADVERTISED_LISTING',
      provenance: {
        source_id: 'https://test-supplier.com/item',
        channel: 'NEWS_TRADE_PRESS',
        observed_at_utc: '2026-10-18T00:00:00.000Z',
        ttl_seconds: 86400,
        evidence_origin_class: 'CALLER_SUPPLIED_PAYLOAD'
      },
      payload: { price: 125 },
      jcs_hash: 'deadbeef'
    };

    // 1. Origin Promotion Firewall blocks CALLER_SUPPLIED_PAYLOAD from VERIFIED_EXECUTABLE_OFFER
    expect(() => {
      EvidencePromotionEngine.promoteCommercialStatus(
        syntheticEnvelope,
        'VERIFIED_EXECUTABLE_OFFER',
        { attestation_signature: 'valid-sig-123' }
      );
    }).toThrow(/E-EV-NON-LIVE-ORIGIN-PROMOTION-FORBIDDEN/);

    // 2. LIVE_VERIFIED_CAPTURE passes origin promotion firewall
    const liveEnvelope: EvidenceEnvelope<{ price: number }> = {
      ...syntheticEnvelope,
      provenance: {
        ...syntheticEnvelope.provenance,
        evidence_origin_class: 'LIVE_VERIFIED_CAPTURE'
      }
    };
    const promoted = EvidencePromotionEngine.promoteCommercialStatus(
      liveEnvelope,
      'VERIFIED_EXECUTABLE_OFFER',
      { attestation_signature: 'valid-sig-123' }
    );
    expect(promoted.commercial_status).toBe('VERIFIED_EXECUTABLE_OFFER');

    // 3. RedTeam Rule RT-08-NON-LIVE-EVIDENCE-ORIGIN
    const nonLiveFinding = RedTeamAndConflictWorker.evaluateEvidenceOrigin({
      evidence_origin_class: 'RECORDED_GOLDEN_FIXTURE',
      intended_commercial_status: 'VERIFIED_EXECUTABLE_OFFER',
      envelope_id: 'ev:fixture:001'
    });
    expect(nonLiveFinding).not.toBeNull();
    expect(nonLiveFinding?.rule_id).toBe('RT-08-NON-LIVE-EVIDENCE-ORIGIN');
    expect(nonLiveFinding?.severity).toBe('BLOCK_ALLOCATION_GATE');

    // 4. Look-Ahead Bias Firewall in Macro and Statutory workers
    const macroWorker = new MacroAndLateralMarketWorker(broker, macroGrant);
    const govtWorker = new GovtAndStatutoryWorker(broker, govtGrant);

    const macroRes = await macroWorker.querySeries({
      task_id: 'task:macro:lookahead:001',
      worker_id: MacroAndLateralMarketWorker.WORKER_ID,
      series_id: 'RBI_91D_TBILL_CUTOFF_YIELD_BPS',
      reference_time_utc: '2026-10-15T00:00:00.000Z'
    });
    expect(macroRes.status).toBe('DATA_REQUIRED');
    expect(macroRes.error_code).toBe('E-MLW-LOOKAHEAD-BIAS-REJECTED');

    const govtRes = await govtWorker.fetchCircular({
      task_id: 'task:govt:lookahead:001',
      worker_id: GovtAndStatutoryWorker.WORKER_ID,
      circular_id: 'CBIC-TCS-SEC52',
      reference_time_utc: '2024-01-01T00:00:00.000Z'
    });
    expect(govtRes.status).toBe('DATA_REQUIRED');
    expect(govtRes.error_code).toBe('E-MLW-LOOKAHEAD-BIAS-REJECTED');
  });

  // --------------------------------------------------------------------------
  // TEST 7: Brokered Groq Egress, Prompt Scrubbing & Proposal Classification
  // --------------------------------------------------------------------------
  it('MCP-M69-BROKERED-GROQ-EGRESS-AND-REDACTION-007: GroqFormulaAdvisor endpoint locking, secret redaction, and proposal tagging', async () => {
    expect(() => {
      new GroqFormulaAdvisor({ endpoint: 'https://malicious-proxy.io/v1/completions' });
    }).toThrow(/E-GROQ-UNAPPROVED-ENDPOINT/);

    expect(APPROVED_GROQ_ENDPOINT).toBe('https://api.groq.com/openai/v1/chat/completions');

    const dirtyPrompt = 'System config: key=gsk_9999888877776666555544443333 and bearer token=secret_token_123456';
    const sanitized1 = redactPromptSecrets(dirtyPrompt);
    const sanitized2 = redactPromptInputs(dirtyPrompt);

    expect(sanitized1).not.toContain('gsk_9999888877776666555544443333');
    expect(sanitized1).not.toContain('secret_token_123456');
    expect(sanitized1).toContain('[REDACTED_SECRET]');
    expect(sanitized2).toEqual(sanitized1);

    const advisor = new GroqFormulaAdvisor({ forceSimulated: true });
    const proposal = await advisor.proposeFormulaRefinement('Synthesize inventory shrinkage drag formula');
    expect(proposal).toBeDefined();
    expect(proposal.evidence_origin_class).toBe('LLM_MODEL_PROPOSAL');
  });

  // --------------------------------------------------------------------------
  // TEST 8: Adala-Style Golden Extraction Bench Certification
  // --------------------------------------------------------------------------
  it('MCP-M69-ADALA-GOLDEN-EXTRACTION-BENCH-008: GoldenExtractionBench certifies 10000n bps across all 4 extraction workers', async () => {
    const scw = new SourceCaptureWorker(broker, scwGrant);
    const benchSummary = await GoldenExtractionBench.evaluateSourceCaptureWorker(scw);

    expect(benchSummary.certified_pass).toBe(true);
    expect(benchSummary.precision_bps).toBe(10000n);
    expect(benchSummary.recall_bps).toBe(10000n);
    expect(benchSummary.exact_match_rate_bps).toBe(10000n);
    expect(benchSummary.benchmark_digest_sha256).toHaveLength(64);

    const allScores = await GoldenExtractionBench.runAllWorkerBenchmarks(broker);
    expect(allScores.length).toBe(4);
    for (const score of allScores) {
      expect(score.precision_bps).toBe(10000);
      expect(score.recall_bps).toBe(10000);
      expect(score.exact_match_bps).toBe(10000);
      expect(score.certification_status).toBe('CERTIFIED_100_PCT');
      expect(score.benchmark_corpus_sha256).toHaveLength(64);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 9: Plan-Driven Topological DAG Waves & Predicate Skipping
  // --------------------------------------------------------------------------
  it('MCP-M69-PLAN-DRIVEN-TOPOLOGICAL-DAG-WAVES-009: executeCompiledDagPlan dispatches waves with activation predicates and bounded concurrency', async () => {
    const compiledPlan: CompiledDagPlan = {
      plan_id: 'plan:wave:m69:001',
      max_parallel_workers: 2,
      max_wall_clock_budget_ms: 5000,
      nodes: [
        {
          node_id: 'node:w1:source',
          pass_number: 1,
          worker_id: 'worker:source-capture:v1',
          depends_on_node_ids: [],
          action: async (_ctx) => ({ source_captured: true, primary_quote: 125 })
        },
        {
          node_id: 'node:w1:macro',
          pass_number: 1,
          worker_id: 'worker:macro-lateral:v1',
          depends_on_node_ids: [],
          action: async (_ctx) => ({ macro_verified: true, tbill_rate: '6.45' })
        },
        {
          node_id: 'node:w2:audit',
          pass_number: 2,
          worker_id: 'worker:red-team:v1',
          depends_on_node_ids: ['node:w1:source'],
          action: async (_ctx) => ({ red_team_approved: true })
        },
        {
          node_id: 'node:w2:optional-gate',
          pass_number: 2,
          worker_id: 'worker:scheduler:capital-gate',
          depends_on_node_ids: ['node:w1:macro'],
          activation_predicate: (ctx) => Boolean(ctx.run_optional_gate),
          action: async (_ctx) => ({ gate_passed: true })
        }
      ]
    };

    const dagResult = await executeCompiledDagPlan(compiledPlan, { run_optional_gate: false });

    expect(dagResult.status).toBe('SUCCESS');
    expect(dagResult.waves_executed).toBe(2);
    expect(dagResult.completed_nodes).toContain('node:w1:source');
    expect(dagResult.completed_nodes).toContain('node:w1:macro');
    expect(dagResult.completed_nodes).toContain('node:w2:audit');
    expect(dagResult.skipped_nodes).toContain('node:w2:optional-gate');
    expect(dagResult.checkpoint_hash).toHaveLength(64);
  });

  // --------------------------------------------------------------------------
  // TEST 10: Durable Append-Only Ledger & DAG Checkpoint Persistence
  // --------------------------------------------------------------------------
  it('MCP-M69-DURABLE-LEDGER-AND-DAG-CHECKPOINT-RESTART-010: Durable persistence and tamper detection for McpRunLedger and DAG checkpoints', async () => {
    // 1. Ledger persistence and tampering detection
    const testLedger = new McpRunLedger();
    testLedger.appendEvent('TASK_DISPATCHED', 'task:persist:001', 'worker:source-capture:v1', { action: 'start' });
    testLedger.appendEvent('TOOL_CALL_INVOKED', 'task:persist:001', 'worker:source-capture:v1', { tool: 'snapshot', duration_ms: 15 });
    testLedger.appendEvent('WORKER_OUTPUT_RECEIVED', 'task:persist:001', 'worker:source-capture:v1', { status: 'EXTRACTED' });

    expect(testLedger.getEvents().length).toBe(3);
    expect(testLedger.verifyHashChain()).toBe(true);

    const tempLedgerFile = path.join(os.tmpdir(), `mcp-ledger-persistence-m69-${Date.now()}.jsonl`);
    try {
      await testLedger.saveLedgerToFile(tempLedgerFile);
      expect(fs.existsSync(tempLedgerFile)).toBe(true);

      const reloaded = await McpRunLedger.loadLedgerFromFile(tempLedgerFile);
      expect(reloaded.getEvents().length).toBe(3);
      expect(reloaded.verifyHashChain()).toBe(true);

      // Tamper with ledger
      const rawLines = fs.readFileSync(tempLedgerFile, 'utf8').trim().split('\n');
      const tamperedFirstEvt = JSON.parse(rawLines[0]);
      tamperedFirstEvt.worker_id = 'worker:imposter:v1';
      rawLines[0] = JSON.stringify(tamperedFirstEvt);
      fs.writeFileSync(tempLedgerFile, rawLines.join('\n') + '\n', 'utf8');

      await expect(McpRunLedger.loadLedgerFromFile(tempLedgerFile)).rejects.toThrow(/E-MCP-LEDGER-TAMPERED/);
    } finally {
      if (fs.existsSync(tempLedgerFile)) fs.unlinkSync(tempLedgerFile);
    }

    // 2. DAG Checkpoint persistence and tampering detection
    const cpData = {
      plan_id: 'plan:checkpoint:m69',
      run_id: 'run:m69:001',
      timestamp_utc: '2026-10-18T16:00:00.000Z',
      completed_node_ids: ['node:w1:source'] as readonly string[],
      skipped_node_ids: [] as readonly string[],
      node_results: { 'node:w1:source': { quote: 125 } },
      context_snapshot: { initial_val: 1 }
    };
    const sampleCheckpoint: DagCheckpoint = {
      ...cpData,
      checkpoint_hash: DagCheckpointStore.computeCheckpointHash(cpData)
    };

    const tempCheckpoint = path.join(os.tmpdir(), `dag-checkpoint-m69-${Date.now()}.json`);
    try {
      await saveDagCheckpointToFile(tempCheckpoint, sampleCheckpoint);
      expect(fs.existsSync(tempCheckpoint)).toBe(true);

      const loadedChk = await resumeDagFromCheckpoint(tempCheckpoint);
      expect(loadedChk.plan_id).toBe(sampleCheckpoint.plan_id);
      expect(loadedChk.checkpoint_hash).toBe(sampleCheckpoint.checkpoint_hash);

      // Tamper with checkpoint
      const rawChk = fs.readFileSync(tempCheckpoint, 'utf8');
      const tamperedChk = rawChk.replace(sampleCheckpoint.plan_id, 'plan:tampered:m69');
      fs.writeFileSync(tempCheckpoint, tamperedChk, 'utf8');

      await expect(DagCheckpointStore.resumeFromCheckpoint(tempCheckpoint)).rejects.toThrow(
        /E-DAG-CHECKPOINT-TAMPERED/
      );
    } finally {
      if (fs.existsSync(tempCheckpoint)) fs.unlinkSync(tempCheckpoint);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 11: Stage 9 Operator Terminal Origin Badging, Telemetry & Sanitization
  // --------------------------------------------------------------------------
  it('MCP-M69-TERMINAL-ORIGIN-HMAC-AND-BENCH-PROJECTION-011: Operator terminal origin badges, HMAC egress telemetry, OTC-01 dynamic check, and OTC-02 HTML escaping', () => {
    const params = createMockSnapshotParams();
    const snapshot = OperatorTerminalController.projectTerminalSnapshot(params);

    // 1. Provenance Badging & Origin Classification
    const opp1 = snapshot.workspaces.opportunity_radar.opportunities[0];
    const opp2 = snapshot.workspaces.opportunity_radar.opportunities[1];
    expect(opp1.evidence_origin!.origin_class).toBe('LIVE_VERIFIED_CAPTURE');
    expect(opp1.edge_decay_regime).toBe('SUSTAINED_STRUCTURAL_SIGNAL');
    expect(opp2.evidence_origin!.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
    expect(opp2.edge_decay_regime).toBe('FAST_TACTICAL_OPPORTUNITY');

    // 2. Timers distinguish MEASURED_DEADLINE from MODELLED_ESTIMATE
    expect(opp1.timers[0].classification).toBe('MEASURED_DEADLINE');
    expect(opp1.timers[1].classification).toBe('MODELLED_ESTIMATE');

    // 3. Evidence Workbench requested_url vs resolved_source_identity
    const rec1 = snapshot.workspaces.evidence_workbench.records[0];
    const rec2 = snapshot.workspaces.evidence_workbench.records[1];
    expect(rec1.requested_url).toBe(rec1.resolved_source_identity);
    expect(rec1.origin_firewall_blocked).toBe(false);
    expect(rec2.requested_url).toContain('https://www.amazon.in');
    expect(rec2.resolved_source_identity).toContain('fixture://golden');
    expect(rec2.origin_firewall_blocked).toBe(true);

    // 4. HMAC Grant Telemetry & Golden Extraction Bench Scores in Workspace 8
    const risk = snapshot.workspaces.risk_audit_and_system_health;
    expect(risk.hmac_grant_telemetry.length).toBe(1);
    expect(risk.hmac_grant_telemetry[0].hmac_signature_verified).toBe(true);
    expect(risk.hmac_grant_telemetry[0].egress_telemetry.verified_port).toBe(443);
    expect(risk.hmac_grant_telemetry[0].egress_telemetry.resolved_dns_ips).toContain('104.26.12.31');
    expect(risk.golden_extraction_bench_scores.length).toBe(4);
    for (const score of risk.golden_extraction_bench_scores) {
      expect(score.certification_status).toBe('CERTIFIED_100_PCT');
      expect(score.precision_bps).toBe(10000);
    }

    // 5. Sub-threshold score triggers health hold
    const subParams = createMockSnapshotParams({
      risk_audit_and_system_health: {
        ...params.risk_audit_and_system_health,
        golden_extraction_bench_scores: [
          {
            worker_id: 'worker:source-capture:v1',
            extractor_version: '1.0.0',
            golden_cases_evaluated: 4,
            precision_bps: 8800,
            recall_bps: 10000,
            exact_match_bps: 8800,
            certification_status: 'HOLD_BELOW_THRESHOLD',
            benchmark_corpus_sha256: 'bench_sha'
          }
        ]
      }
    });
    const subSnap = OperatorTerminalController.projectTerminalSnapshot(subParams);
    expect(subSnap.workspaces.risk_audit_and_system_health.system_health_alert).toBe(true);
    expect(subSnap.workspaces.risk_audit_and_system_health.badge.icon_symbol).toBe('[BLOCKED]');

    // 6. OTC-01 Dynamic 7-bucket check in renderOperatorTerminalHtml
    const balancedHtml = renderOperatorTerminalHtml(snapshot);
    expect(balancedHtml).toContain('[OK]');
    expect(balancedHtml).not.toContain('[BLOCKED] MISMATCH');

    const mismatchedParams = createMockSnapshotParams({
      simulation_and_positions: {
        ...params.simulation_and_positions,
        seven_bucket_inventory: {
          raw_material: 0,
          work_in_progress: 0,
          finished_goods: 500,
          intransit_to_fba: 0,
          fba_available: 400, // 500 + 400 = 900 != 1000
          reserved_customer: 0,
          returned_quarantine: 0,
          total_conserved: 1000
        }
      }
    });

    // Without logged reconciliation exception, projection fails closed
    expect(() => {
      OperatorTerminalController.projectTerminalSnapshot(mismatchedParams);
    }).toThrow(/E-M8-RECONCILIATION-EXCEPTION/);

    // With explicit logged reconciliation exception, projection renders [BLOCKED] MISMATCH badge
    const mismatchedWithExceptionParams = createMockSnapshotParams({
      ...mismatchedParams,
      reconciliation_and_performance: {
        ...params.reconciliation_and_performance,
        reconciliation_exceptions: ['7-bucket inventory conservation mismatch']
      }
    });
    const mismatchedSnap = OperatorTerminalController.projectTerminalSnapshot(mismatchedWithExceptionParams);
    const mismatchedHtml = renderOperatorTerminalHtml(mismatchedSnap);
    expect(mismatchedHtml).toContain('[BLOCKED] MISMATCH');

    // 7. OTC-02 HTML escaping in renderOperatorTerminalHtml and standalone helper
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    const xssParams = createMockSnapshotParams({
      command_center: {
        ...params.command_center,
        active_kill_switch_scope: 'NORMAL_PAPER_OPERATION',
        ledger_reconciliation_status: createSemanticStatusBadge(
          'RECON_OK',
          '[OK]',
          'BALANCED <img src=x onerror=alert(1)>'
        )
      }
    });
    const xssSnap = OperatorTerminalController.projectTerminalSnapshot(xssParams);
    const xssHtml = renderOperatorTerminalHtml(xssSnap);
    expect(xssHtml).not.toContain('<img src=x onerror=alert(1)>');
    expect(xssHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  // --------------------------------------------------------------------------
  // TEST 12: End-to-End JCS Canonicalization & Charter DEC-019 Invariants
  // --------------------------------------------------------------------------
  it('MCP-M69-END-TO-END-JCS-AND-CHARTER-DEC019-012: RFC 8785 JCS canonicalization and full platform readiness capstone', async () => {
    // 1. Evaluate 12-point release gate
    const readinessParams = createMockSnapshotParams();
    const readinessSnapshot = OperatorTerminalController.projectTerminalSnapshot(readinessParams);
    const certificate = evaluateTwelvePointPlatformReadiness(readinessSnapshot);

    expect(certificate.all_twelve_passed).toBe(true);
    expect(certificate.criteria.length).toBe(12);
    expect(certificate.criteria.every(c => c.passed)).toBe(true);
    expect(certificate.operating_mode).toBe('DRY_RUN_PAPER_SIMULATION_ONLY');
    expect(certificate.real_money_execution_enabled).toBe(false);
    expect(certificate.certificate_jcs_sha256).toMatch(/^[0-9a-f]{64}$/);

    // 2. Canonicalize unified system state package with RFC 8785 JCS
    const statePackage = {
      governance_gate: 'GATE_M6_9_HARDENED_RELEASE',
      decision_id: 'OD-19',
      charter_version: 'v0.2.7',
      certificate_hash: certificate.certificate_jcs_sha256,
      all_twelve_passed: certificate.all_twelve_passed,
      mcp_protocol_version: '2025-11-25',
      egress_port_locked: 443,
      arithmetic_engine: 'PURE_BIGINT_10000N_SCALE',
      operator_terminal_mode: 'READ_ONLY_PROJECTION'
    };

    const canonicalState = canonicalizeJCS(statePackage);
    const digest = sha256(canonicalState);
    expect(digest).toHaveLength(64);

    // Verify determinism across multiple serializations
    const secondCanonical = canonicalizeJCS({ ...statePackage });
    expect(secondCanonical).toBe(canonicalState);
    expect(sha256(secondCanonical)).toBe(digest);
  });
});
