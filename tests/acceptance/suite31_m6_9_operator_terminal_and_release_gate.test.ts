/**
 * Suite 31: Gate M6.9 (Decision OD-19 / Charter DEC-019)
 * 8-Workspace Read-Only Operator Terminal, Safety Controls,
 * HMAC & Egress Telemetry, Worker Certification & 12-Point Release Gate
 *
 * Normative acceptance tests verifying POC.docx §7, §8, §9.5, §10, and §13.
 */

import { describe, it, expect } from 'vitest';
import {
  KillSwitchController,
  executeGovernedOperatorAction,
  formatTwoLevelError,
  OperatorTerminalController,
  renderOperatorTerminalHtml,
  evaluateTwelvePointPlatformReadiness,
  createSemanticStatusBadge,
  createEvidenceOriginBadge,
  TerminalProjectionParams,
  OperatorConfirmationEnvelope
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

describe('SUITE-31: Gate M6.9 — Operator Terminal Projection, Egress Telemetry & Release Gate', () => {
  // Test 1: Eight Workspaces, Value Provenance Classifications & Origin Badges
  it('MCP-TERM-EIGHT-WORKSPACES-AND-ORIGIN-BADGES-001: Verifies all 8 workspaces project deterministically, every figure carries provenance classification, origin badges separate live vs fixture, and vanity profit is blocked', () => {
    const params = createMockSnapshotParams();
    const snapshot = OperatorTerminalController.projectTerminalSnapshot(params);

    // Verify top-level invariants
    expect(snapshot.operating_mode).toBe('DRY_RUN_PAPER_SIMULATION_ONLY');
    expect(snapshot.real_money_execution_enabled).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(typeof snapshot.snapshot_jcs_sha256).toBe('string');
    expect(snapshot.snapshot_jcs_sha256.length).toBe(64);

    // Verify all 8 workspaces exist
    const ws = snapshot.workspaces;
    expect(ws.command_center).toBeDefined();
    expect(ws.opportunity_radar).toBeDefined();
    expect(ws.evidence_workbench).toBeDefined();
    expect(ws.economics_lab).toBeDefined();
    expect(ws.capital_allocator).toBeDefined();
    expect(ws.simulation_and_positions).toBeDefined();
    expect(ws.reconciliation_and_performance).toBeDefined();
    expect(ws.risk_audit_and_system_health).toBeDefined();

    // Verify value provenance classification on command center metrics
    expect(ws.command_center.available_treasury_capital_inr.classification).toBe('ACTUAL');
    expect(ws.command_center.committed_paper_capital_inr.classification).toBe('SIMULATED');
    expect(ws.command_center.unrecovered_dwell_capital_inr.classification).toBe('SIMULATED');
    expect(ws.command_center.active_research_runs_count.classification).toBe('OBSERVED');

    // Verify EvidenceOriginBadge in evidence workbench
    const liveRecord = ws.evidence_workbench.records[0];
    expect(liveRecord.requested_url).toBe('https://www.indiamart.com/proddetail/ss304-hose-clamp-10pack.html');
    expect(liveRecord.resolved_source_identity).toBe('https://www.indiamart.com/proddetail/ss304-hose-clamp-10pack.html');
    expect(liveRecord.evidence_origin?.origin_class).toBe('LIVE_VERIFIED_CAPTURE');
    expect(liveRecord.evidence_origin?.is_eligible_for_executable_offer_promotion).toBe(true);
    expect(liveRecord.evidence_origin?.semantic_badge.icon_symbol).toBe('[LIVE]');

    const fixtureRecord = ws.evidence_workbench.records[1];
    expect(fixtureRecord.requested_url).toBe('https://www.amazon.in/dp/B01N47983X');
    expect(fixtureRecord.resolved_source_identity).toBe('fixture://golden/amazon_ss304_clamp_march2026.html');
    expect(fixtureRecord.evidence_origin?.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
    expect(fixtureRecord.evidence_origin?.is_eligible_for_executable_offer_promotion).toBe(false);
    expect(fixtureRecord.evidence_origin?.semantic_badge.icon_symbol).toBe('[FIXTURE]');

    // Verify origin breakdown in command center
    expect(ws.command_center.evidence_origin_breakdown.live_capture_claim_count).toBe(1);
    expect(ws.command_center.evidence_origin_breakdown.golden_fixture_claim_count).toBe(1);

    // Verify anti-vanity profit firewall (POC.docx §10.1)
    const vanityParams = createMockSnapshotParams();
    (vanityParams.command_center as any).vanity_profit_check = { combined_paper_actuals_profit: '4500.00' };
    expect(() => OperatorTerminalController.projectTerminalSnapshot(vanityParams)).toThrow(
      /E-M9-VANITY-PROFIT-FORBIDDEN/
    );
  });

  // Test 2: HMAC Capability Grant & Golden Extraction Bench Telemetry
  it('MCP-TERM-HMAC-EGRESS-AND-GOLDEN-BENCH-TELEMETRY-002: Verifies Workspace 8 accurately projects HMAC signatures, wall-clock telemetry, DNS IPs, and sub-threshold benchmark scores trigger system health hold', () => {
    const params = createMockSnapshotParams();
    const snapshot = OperatorTerminalController.projectTerminalSnapshot(params);
    const risk = snapshot.workspaces.risk_audit_and_system_health;

    // Verify HMAC grant telemetry
    expect(risk.hmac_grant_telemetry.length).toBe(1);
    const grant = risk.hmac_grant_telemetry[0];
    expect(grant.grant_id).toBe('grant-task-001-worker-scw');
    expect(grant.worker_id).toBe('worker:source-capture:v1');
    expect(grant.hmac_signature_verified).toBe(true);
    expect(grant.cumulative_task_wall_clock_ms).toBe(240);
    expect(grant.egress_telemetry.verified_port).toBe(443);
    expect(grant.egress_telemetry.resolved_dns_ips).toContain('104.26.12.31');
    expect(grant.egress_telemetry.stream_aborted_for_oversize).toBe(false);

    // Verify GoldenExtractionBench scores (4 certified workers at 100.00%)
    expect(risk.golden_extraction_bench_scores.length).toBe(4);
    for (const score of risk.golden_extraction_bench_scores) {
      expect(score.precision_bps).toBe(10000);
      expect(score.recall_bps).toBe(10000);
      expect(score.exact_match_bps).toBe(10000);
      expect(score.certification_status).toBe('CERTIFIED_100_PCT');
    }
    expect(risk.system_health_alert).toBe(false);

    // Sub-threshold benchmark score triggers HOLD_BELOW_THRESHOLD
    const subthresholdParams = createMockSnapshotParams({
      risk_audit_and_system_health: {
        ...params.risk_audit_and_system_health,
        golden_extraction_bench_scores: [
          {
            worker_id: 'worker:source-capture:v1',
            extractor_version: '1.0.0',
            golden_cases_evaluated: 4,
            precision_bps: 9200, // 92% < 100%
            recall_bps: 10000,
            exact_match_bps: 9200,
            certification_status: 'HOLD_BELOW_THRESHOLD',
            benchmark_corpus_sha256: 'bench_sha'
          }
        ]
      }
    });

    const subSnapshot = OperatorTerminalController.projectTerminalSnapshot(subthresholdParams);
    const subRisk = subSnapshot.workspaces.risk_audit_and_system_health;
    expect(subRisk.system_health_alert).toBe(true);
    expect(subRisk.system_health_alert_reason).toContain('HOLD_BELOW_THRESHOLD');
    expect(subRisk.badge.icon_symbol).toBe('[BLOCKED]');
  });

  // Test 3: Ten Required Dimensions & Conviction vs. Allocation Separation
  it('MCP-TERM-TEN-DIMENSIONS-AND-CONVICTION-VS-ALLOCATION-003: Verifies Workspace 5 exposes all 10 comparison dimensions without composite score, separates conviction from allocation, and provides drilldown lineage', () => {
    const params = createMockSnapshotParams();
    const snapshot = OperatorTerminalController.projectTerminalSnapshot(params);
    const alloc = snapshot.workspaces.capital_allocator;

    expect(alloc.opportunities.length).toBe(2);
    const liveCandidate = alloc.opportunities[0];

    // Assert all 10 comparison dimensions exist (POC.docx §8)
    expect(liveCandidate.expected_return_bps.value).toBe(6138);
    expect(liveCandidate.return_after_costs_and_taxes_bps.value).toBe(3994);
    expect(liveCandidate.risk_and_downside_buffer_bps.value).toBe(2500);
    expect(liveCandidate.capital_requirement_inr.value).toBe('19105.00');
    expect(liveCandidate.time_to_execution_days.value).toBe(3);
    expect(liveCandidate.cash_recovery_ccc_days.value).toBe(35);
    expect(liveCandidate.liquidity_lockup_ratio_bps.value).toBe(3821);
    expect(liveCandidate.opportunity_cost_benchmark_bps.value).toBe(650);
    expect(liveCandidate.edge_decay_half_life_days.value).toBe(45);
    expect(liveCandidate.evidence_conviction_score_bps.value).toBe(10000);

    // Live verified candidate gets allocated paper capital
    expect(liveCandidate.allocated_capital_inr.value).toBe('19105.00');
    expect(liveCandidate.gate_badge.icon_symbol).toBe('[OK]');

    // Fixture / Advertised listing candidate gets strictly ₹0.00 allocated capital
    const fixtureCandidate = alloc.opportunities[1];
    expect(fixtureCandidate.expected_return_bps.value).toBe(12500); // 125.00% high theoretical return
    expect(fixtureCandidate.allocated_capital_inr.value).toBe('0.00'); // Conviction vs. Allocation separation
    expect(fixtureCandidate.gate_badge.icon_symbol).toBe('[BLOCKED]');
    expect(fixtureCandidate.conviction_vs_allocation_rationale).toContain('₹0.00');

    // Drilldown lineage pointers (POC.docx §10.2)
    expect(liveCandidate.drilldown_lineage).toBeDefined();
    expect(liveCandidate.drilldown_lineage?.headline_return_ref).toBe('formula://FIN-CCC-ROWC-005');
    expect(liveCandidate.drilldown_lineage?.fee_tax_assumption_ref).toBe('circular://CBIC/GST/HSN-73269099');
    expect(liveCandidate.drilldown_lineage?.source_document_sha256.length).toBe(64);
  });

  // Test 4: Three-Tier Kill Switch Isolation
  it('MCP-TERM-THREE-TIER-KILL-SWITCH-ISOLATION-004: Exercises HALT_NEW_ALLOCATIONS, HALT_ALL_SIMULATION_PROCESSING, and ENTER_RECOVERY_ONLY_MODE, proving scope boundaries while preserving ledger state', () => {
    const controller = new KillSwitchController();
    const confirmation: OperatorConfirmationEnvelope = {
      operator_id: 'OP-CHIEF-RISK-OFFICER',
      action_type: 'ACTIVATE_KILL_SWITCH',
      target_entity_id: 'GLOBAL_PORTFOLIO',
      explicit_rationale: 'Volatility spike on LME SS304 commodity market exceeding risk tolerance threshold.',
      confirmation_token: 'CONF-TOKEN-12345678',
      confirmed_at_utc: '2026-10-18T16:05:00.000Z'
    };

    // Tier 1: HALT_NEW_ALLOCATIONS
    controller.activateKillSwitch('HALT_NEW_ALLOCATIONS', confirmation);
    expect(controller.getState().active_scope).toBe('HALT_NEW_ALLOCATIONS');
    expect(() => controller.assertAllocationAllowed()).toThrow(/E-M9-KILLSWITCH-NEW-ALLOCATIONS-HALTED/);
    expect(() => controller.assertSimulationAllowed()).not.toThrow();
    expect(() => controller.assertResearchAllowed()).not.toThrow();

    // Tier 2: HALT_ALL_SIMULATION_PROCESSING
    controller.activateKillSwitch('HALT_ALL_SIMULATION_PROCESSING', confirmation);
    expect(controller.getState().active_scope).toBe('HALT_ALL_SIMULATION_PROCESSING');
    expect(() => controller.assertAllocationAllowed()).toThrow(/E-M9-KILLSWITCH-ALL-SIMULATION-HALTED/);
    expect(() => controller.assertSimulationAllowed()).toThrow(/E-M9-KILLSWITCH-ALL-SIMULATION-HALTED/);
    expect(() => controller.assertResearchAllowed()).not.toThrow();

    // Tier 3: ENTER_RECOVERY_ONLY_MODE
    controller.activateKillSwitch('ENTER_RECOVERY_ONLY_MODE', confirmation);
    expect(controller.getState().active_scope).toBe('ENTER_RECOVERY_ONLY_MODE');
    expect(() => controller.assertAllocationAllowed()).toThrow(/E-M9-KILLSWITCH-RECOVERY-ONLY/);
    expect(() => controller.assertSimulationAllowed()).toThrow(/E-M9-KILLSWITCH-RECOVERY-ONLY/);
    expect(() => controller.assertResearchAllowed()).toThrow(/E-M9-KILLSWITCH-RECOVERY-ONLY/);

    // Reset Kill Switch
    const resetConfirmation: OperatorConfirmationEnvelope = {
      operator_id: 'OP-CHIEF-RISK-OFFICER',
      action_type: 'RESET_KILL_SWITCH',
      target_entity_id: 'GLOBAL_PORTFOLIO',
      explicit_rationale: 'Market volatility stabilized and all margin buffers re-verified.',
      confirmation_token: 'CONF-TOKEN-87654321',
      confirmed_at_utc: '2026-10-18T16:10:00.000Z'
    };
    controller.resetKillSwitch(resetConfirmation);
    expect(controller.getState().active_scope).toBe('NORMAL_PAPER_OPERATION');
    expect(() => controller.assertAllocationAllowed()).not.toThrow();
    expect(() => controller.assertSimulationAllowed()).not.toThrow();
    expect(() => controller.assertResearchAllowed()).not.toThrow();
  });

  // Test 5: Governed Confirmation Gate & No Optimistic UI Mutation
  it('MCP-TERM-CONFIRMATION-GATE-AND-NO-OPTIMISTIC-UI-005: Proves state transitions without valid confirmation token and >= 15-char rationale fail closed, and failed backend operations never mutate UI', () => {
    let internalState = 100;

    // Reject missing confirmation
    expect(() => executeGovernedOperatorAction(() => { internalState = 200; }, null as any)).toThrow(
      /E-M9-CONFIRMATION-AND-RATIONALE-REQUIRED/
    );
    expect(internalState).toBe(100);

    // Reject short rationale (< 15 characters)
    const shortRationaleEnvelope: OperatorConfirmationEnvelope = {
      operator_id: 'OP-01',
      action_type: 'APPROVE_PAPER_ALLOCATION',
      target_entity_id: 'CAND-001',
      explicit_rationale: 'Too short', // 9 chars
      confirmation_token: 'TOK-1234',
      confirmed_at_utc: '2026-10-18T16:00:00.000Z'
    };
    expect(() => executeGovernedOperatorAction(() => { internalState = 200; }, shortRationaleEnvelope)).toThrow(
      /E-M9-CONFIRMATION-AND-RATIONALE-REQUIRED/
    );
    expect(internalState).toBe(100);

    // Success on valid confirmation
    const validEnvelope: OperatorConfirmationEnvelope = {
      operator_id: 'OP-01',
      action_type: 'APPROVE_PAPER_ALLOCATION',
      target_entity_id: 'CAND-001',
      explicit_rationale: 'Verified supplier catalog and positive margin clearance confirmed.',
      confirmation_token: 'TOK-12345678',
      confirmed_at_utc: '2026-10-18T16:00:00.000Z'
    };
    const result = executeGovernedOperatorAction(() => { internalState = 200; return 'MUTATION_SUCCESS'; }, validEnvelope);
    expect(result.outcome).toBe('MUTATION_SUCCESS');
    expect(result.optimistic_ui_mutation_allowed).toBe(false);
    expect(internalState).toBe(200);
  });

  // Test 6: Two-Level Error Presentation & Write Timeout Distinction
  it('MCP-TERM-TWO-LEVEL-ERROR-AND-UNKNOWN-WRITE-OUTCOME-006: Proves secret scrubbing in operator_message and distinguishes DEFINITE_FAILURE from OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED on write timeouts', () => {
    // Secret scrubbing test
    const secretError = new Error('Failed to connect to Groq with key gsk_abc1234567890def1234567890 and config Groq_Key.env at postgres://admin:supersecret@localhost:5432/db');
    const envelope = formatTwoLevelError(secretError, {
      affected_entity_id: 'ENTITY-001',
      correlation_id: 'CORR-001',
      state_before: { counter: 1 },
      state_after: { counter: 2 }
    });

    expect(envelope.operator_message).toContain('[E-M9-SECRET-REDACTED]');
    expect(envelope.operator_message).toContain('[REDACTED_API_KEY]');
    expect(envelope.operator_message).toContain('[REDACTED_ENV_FILE]');
    expect(envelope.operator_message).toContain('postgres://admin:[REDACTED_PASSWORD]@localhost:5432/db');
    expect(envelope.operator_message).not.toContain('gsk_abc');
    expect(envelope.operator_message).not.toContain('supersecret');
    expect(envelope.outcome_status).toBe('DEFINITE_FAILURE');
    expect(envelope.audit_detail.state_before_jcs_hash.length).toBe(64);

    // Mid-write timeout distinction (POC.docx §9.5)
    const timeoutError = new Error('Database write operation timed out waiting for WAL sync lock');
    const timeoutEnvelope = formatTwoLevelError(timeoutError, {
      affected_entity_id: 'ENTITY-002',
      correlation_id: 'CORR-002',
      is_write_timeout: true
    });

    expect(timeoutEnvelope.outcome_status).toBe('OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
  });

  // Test 7: Cross-Ledger Read-Only Comparison & Accessible HTML/SVG Renderer
  it('MCP-TERM-CROSS-LEDGER-AND-ACCESSIBLE-HTML-RENDER-007: Verifies PaperLedger vs ActualsLedger separation, detects inventory mismatch alerts, and renders accessible dark-mode HTML workstation', () => {
    const params = createMockSnapshotParams();
    const snapshot = OperatorTerminalController.projectTerminalSnapshot(params);

    // Cross-ledger isolation
    const cross = snapshot.workspaces.reconciliation_and_performance.cross_ledger_comparison;
    expect(cross.paper_ledger_total_inr).toBe('50000.00');
    expect(cross.actuals_ledger_total_inr).toBe('0.00');
    expect(cross.direct_merge_blocked).toBe(true);
    expect(cross.actuals_write_blocked).toBe(true);

    // 7-bucket inventory mismatch detection
    const corruptInvParams = createMockSnapshotParams();
    (corruptInvParams.simulation_and_positions.seven_bucket_inventory as any).total_conserved = 999; // 1000 != 999
    expect(() => OperatorTerminalController.projectTerminalSnapshot(corruptInvParams)).toThrow(
      /E-M9-RECONCILIATION-EXCEPTION/
    );

    // HTML5/SVG Workstation Renderer
    const html = renderOperatorTerminalHtml(snapshot);
    expect(typeof html).toBe('string');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Market HFT OS — Governed Research & Trading Workstation');
    expect(html).toContain('OPERATING MODE: <strong>DRY_RUN_PAPER_SIMULATION_ONLY</strong>');
    expect(html).toContain('REAL-MONEY EXECUTION: <strong>DISABLED</strong>');
    expect(html).toContain('id="workspace-command-center"');
    expect(html).toContain('id="workspace-opportunity-radar"');
    expect(html).toContain('id="workspace-evidence-workbench"');
    expect(html).toContain('id="workspace-economics-lab"');
    expect(html).toContain('id="workspace-capital-allocator"');
    expect(html).toContain('id="workspace-simulation-and-positions"');
    expect(html).toContain('id="workspace-reconciliation-and-performance"');
    expect(html).toContain('id="workspace-risk-audit-and-system-health"');

    // Verify SVG charts and badges exist
    expect(html).toContain('class="chart chart-spread-bands"');
    expect(html).toContain('class="chart chart-j-curve"');
    expect(html).toContain('class="chart chart-conviction-matrix"');
    expect(html).toContain('class="chart chart-mcp-dag"');
    expect(html).toContain('badge-live');
    expect(html).toContain('badge-fixture');
    expect(html).toContain('Golden Extraction Bench Worker Certification');
    expect(html).toContain('HMAC Capability Grant & Constrained HTTPS Egress Telemetry');
  });

  // Test 8: 12-Point Release Gate Capstone Evaluator
  it('MCP-TERM-TWELVE-POINT-RELEASE-GATE-CAPSTONE-008: Runs evaluateTwelvePointPlatformReadiness asserting all 12 criteria pass with bit-for-bit JCS SHA-256 certificate', () => {
    const params = createMockSnapshotParams();
    const snapshot = OperatorTerminalController.projectTerminalSnapshot(params);

    const certificate = evaluateTwelvePointPlatformReadiness(snapshot);

    expect(certificate.operating_mode).toBe('DRY_RUN_PAPER_SIMULATION_ONLY');
    expect(certificate.real_money_execution_enabled).toBe(false);
    expect(certificate.all_twelve_passed).toBe(true);
    expect(certificate.criteria.length).toBe(12);

    // Verify each criterion ID specifically
    const criterionIds = certificate.criteria.map(c => c.criterion_id);
    expect(criterionIds).toContain('POC-CRIT-01-CANDIDATE-DISCOVERY-EVIDENCE');
    expect(criterionIds).toContain('POC-CRIT-02-GOVERNED-EVIDENCE-PROMOTION');
    expect(criterionIds).toContain('POC-CRIT-03-DETERMINISTIC-VERSIONED-ECONOMICS');
    expect(criterionIds).toContain('POC-CRIT-04-EXPLICIT-STATUSES-NO-FABRICATION');
    expect(criterionIds).toContain('POC-CRIT-05-CAPITAL-ALLOCATION-RISK-GATING');
    expect(criterionIds).toContain('POC-CRIT-06-PAPER-LIFECYCLE-CONSERVATION');
    expect(criterionIds).toContain('POC-CRIT-07-CRASH-AND-FAILED-WRITE-SAFETY');
    expect(criterionIds).toContain('POC-CRIT-08-INTEGRITY-AND-RECONCILIATION');
    expect(criterionIds).toContain('POC-CRIT-09-BITEMPORAL-REPLAY-WITHOUT-REWRITE');
    expect(criterionIds).toContain('POC-CRIT-10-UI-READONLY-CANNOT-BYPASS-CONTROLS');
    expect(criterionIds).toContain('POC-CRIT-11-ALL-APPROVED-TESTS-PASS');
    expect(criterionIds).toContain('POC-CRIT-12-REAL-MONEY-IMPOSSIBLE-PAPER-ONLY');

    // Verify JCS SHA-256 determinism (running twice produces bit-for-bit identical hash)
    const cert2 = evaluateTwelvePointPlatformReadiness(snapshot);
    expect(cert2.certificate_jcs_sha256).toBe(certificate.certificate_jcs_sha256);
    expect(certificate.certificate_jcs_sha256.length).toBe(64);
  });
});
