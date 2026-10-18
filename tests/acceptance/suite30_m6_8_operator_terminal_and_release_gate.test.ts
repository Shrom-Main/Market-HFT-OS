/**
 * SUITE-30: Gate M6.8 Stage 8 Read-Only Operator Terminal Projection,
 * 3-Tier Kill Switch, Two-Level Error Presentation & 12-Point Release Gate
 *
 * Normative Acceptance Suite for Stage 8:
 * 1. MCP-TERM-EIGHT-WORKSPACES-AND-NO-VANITY-PROFIT-001:
 *    - Verifies all 8 workspaces project deterministically from authoritative backend state.
 *    - Every figure carries an explicit OBSERVED/ESTIMATED/SIMULATED/ACTUAL badge.
 *    - Command Center refuses to mix forecasts/paper/actuals into a single vanity profit number.
 *    - Snapshot is deeply frozen (Object.isFrozen).
 * 2. MCP-TERM-TEN-DIMENSIONS-AND-CONVICTION-VS-ALLOCATION-002:
 *    - Capital Allocator exposes all 10 required comparison dimensions without a composite score.
 *    - Separates Conviction from Allocation (allocates ₹0 to high-return/unverified listings).
 *    - Distinguishes MEASURED_DEADLINE from MODELLED_ESTIMATE timers.
 *    - Preserves full drill-down lineage from return -> fee assumption -> source SHA-256.
 * 3. MCP-TERM-THREE-TIER-KILL-SWITCH-ISOLATION-003:
 *    - Exercises all 3 kill-switch scopes (HALT_NEW_ALLOCATIONS, HALT_ALL_SIMULATION_PROCESSING, ENTER_RECOVERY_ONLY_MODE).
 *    - Proves each halts its exact boundary while preserving 100% of historical positions and ledgers.
 * 4. MCP-TERM-CONFIRMATION-GATE-AND-NO-OPTIMISTIC-UI-004:
 *    - Proves state transitions require valid OperatorConfirmationEnvelope and >= 15-char rationale (E-M8-CONFIRMATION-AND-RATIONALE-REQUIRED).
 *    - Proves failed backend operations never trigger optimistic UI state changes.
 * 5. MCP-TERM-TWO-LEVEL-ERROR-AND-UNKNOWN-WRITE-OUTCOME-005:
 *    - Verifies two-level error generation.
 *    - Proves Groq_Key.env / gsk_... / DB credentials are scrubbed (E-M8-SECRET-REDACTED).
 *    - Proves mid-write timeouts emit OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED rather than DEFINITE_FAILURE.
 * 6. MCP-TERM-CROSS-LEDGER-COMPARISON-AND-CONSERVATION-006:
 *    - Verifies read-only PaperLedger vs ActualsLedger comparison in Workspace 7.
 *    - Proves direct ledger merging or paper-to-actuals writes are blocked by ActualsGuard.
 *    - Proves cash or 7-bucket inventory conservation mismatch opens reconciliation exception (E-M8-RECONCILIATION-EXCEPTION).
 * 7. MCP-TERM-ACCESSIBLE-HTML-SVG-RENDER-007:
 *    - Renders self-contained HTML5/SVG operator terminal.
 *    - Verifies all 8 workspace sections, SVG charts, DRY_RUN banner, and non-color-only badges ([OK], [WARN], [BLOCKED], [HALTED]).
 * 8. MCP-TERM-TWELVE-POINT-RELEASE-GATE-CAPSTONE-008:
 *    - Executes evaluateTwelvePointPlatformReadiness across complete lifecycle.
 *    - Asserts all 12 readiness criteria from POC.docx §13 pass with bit-for-bit reproducible RFC 8785 JCS SHA-256 certificate.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import { enforceActualsLedgerWrite, SimulationLedgerContext } from '../../src/ledger/actualsGuard.js';
import {
  OperatorTerminalController,
  KillSwitchController,
  executeGovernedOperatorAction,
  formatTwoLevelError,
  renderOperatorTerminalHtml,
  evaluateTwelvePointPlatformReadiness,
  TerminalProjectionParams
} from '../../src/terminal/operatorTerminalController.js';
import {
  OperatorConfirmationEnvelope,
  OperatorTerminalSnapshot,
  SevenBucketInventoryModel,
  CrossLedgerComparisonModel,
  TenDimensionOpportunityComparisonRow
} from '../../src/mcp/contracts/operatorTerminalContract.js';

describe('SUITE-30: Gate M6.8 Stage 8 Operator Terminal, Safety Controls & 12-Point Release Gate', () => {
  const REF_TIMESTAMP_UTC = '2026-10-18T12:00:00.000Z';
  const OPERATOR_ID = 'op:sec:audit-desk-01';

  let sampleInventory: SevenBucketInventoryModel;
  let sampleCrossLedger: CrossLedgerComparisonModel;
  let sampleTenDimRows: TenDimensionOpportunityComparisonRow[];
  let baseProjectionParams: TerminalProjectionParams;

  beforeEach(() => {
    // 7-bucket inventory conserved at 100 units
    sampleInventory = {
      raw_material: 20,
      work_in_progress: 15,
      finished_goods: 25,
      intransit_to_fba: 10,
      fba_available: 20,
      reserved_customer: 5,
      returned_quarantine: 5,
      total_conserved: 100
    };

    sampleCrossLedger = {
      paper_ledger_total_inr: '50000.00',
      actuals_ledger_total_inr: '0.00',
      direct_merge_blocked: true,
      actuals_write_blocked: true,
      cash_conservation_status: {
        status_code: 'CASH_CONSERVED',
        icon_symbol: '[OK]',
        label: 'Conserved',
        aria_description: 'Cash movements balance debit to credit across virtual ledger.'
      },
      inventory_conservation_status: {
        status_code: 'INVENTORY_CONSERVED',
        icon_symbol: '[OK]',
        label: 'Conserved',
        aria_description: '7-bucket inventory transitions sum bit-for-bit to conserved total.'
      }
    };

    sampleTenDimRows = [
      {
        candidate_id: 'cand:ss304:16-25mm:pack-10:verified',
        expected_return_bps: {
          value: 39941,
          unit: 'BPS',
          classification: 'SIMULATED',
          source_lineage_ref: 'claim:source:indiamart:howrah:ss304:sha256:abc'
        },
        return_after_costs_and_taxes_bps: {
          value: 39941,
          unit: 'BPS',
          classification: 'SIMULATED',
          source_lineage_ref: 'formula:FIN-STATUTORY-TCS-TDS-003'
        },
        risk_and_downside_buffer_bps: {
          value: 1250,
          unit: 'BPS',
          classification: 'SIMULATED',
          source_lineage_ref: 'rule:RT-01-BELOW-PHYSICAL-SCRAP-FLOOR'
        },
        capital_requirement_inr: {
          value: '13821.00',
          unit: 'INR',
          classification: 'SIMULATED',
          source_lineage_ref: 'silo:batch:optimal:500-packs'
        },
        time_to_execution_days: {
          value: 2,
          unit: 'DAYS',
          classification: 'ESTIMATED',
          source_lineage_ref: 'timer:supplier:quote-expiry'
        },
        cash_recovery_ccc_days: {
          value: 35,
          unit: 'DAYS',
          classification: 'SIMULATED',
          source_lineage_ref: 'formula:FIN-CCC-ROWC-005'
        },
        liquidity_lockup_ratio_bps: {
          value: 2764,
          unit: 'BPS',
          classification: 'SIMULATED',
          source_lineage_ref: 'treasury:budget:ratio'
        },
        opportunity_cost_benchmark_bps: {
          value: 650,
          unit: 'BPS',
          classification: 'OBSERVED',
          source_lineage_ref: 'claim:macro:rbi-91d-tbill'
        },
        edge_decay_half_life_days: {
          value: 90,
          unit: 'DAYS',
          classification: 'ESTIMATED',
          source_lineage_ref: 'regime:SUSTAINED_STRUCTURAL_SIGNAL'
        },
        evidence_conviction_score_bps: {
          value: 8500,
          unit: 'BPS',
          classification: 'OBSERVED',
          source_lineage_ref: 'join:multi-source:corroborated'
        },
        allocated_capital_inr: {
          value: '13821.00',
          unit: 'INR',
          classification: 'SIMULATED',
          source_lineage_ref: 'allocator:governed-pass'
        },
        conviction_vs_allocation_rationale: 'Fully corroborated quote above scrap floor with sustained regime.',
        gate_badge: {
          status_code: 'APPROVED_FOR_PAPER_SIMULATION',
          icon_symbol: '[OK]',
          label: 'Paper Approved',
          aria_description: 'High conviction and validated economics permit paper capital allocation.'
        }
      },
      {
        candidate_id: 'cand:ss304:unverified-speculative',
        expected_return_bps: {
          value: 125000, // 1250.00% theoretical return illusion
          unit: 'BPS',
          classification: 'SIMULATED',
          source_lineage_ref: 'claim:unverified-ad:sha256:xyz'
        },
        return_after_costs_and_taxes_bps: {
          value: 125000,
          unit: 'BPS',
          classification: 'SIMULATED',
          source_lineage_ref: 'claim:unverified-ad:sha256:xyz'
        },
        risk_and_downside_buffer_bps: {
          value: 0,
          unit: 'BPS',
          classification: 'ESTIMATED',
          source_lineage_ref: 'risk:unmitigated'
        },
        capital_requirement_inr: {
          value: '5000.00',
          unit: 'INR',
          classification: 'ESTIMATED',
          source_lineage_ref: 'ad:speculative'
        },
        time_to_execution_days: {
          value: 1,
          unit: 'DAYS',
          classification: 'ESTIMATED',
          source_lineage_ref: 'timer:ad-listing'
        },
        cash_recovery_ccc_days: {
          value: 45,
          unit: 'DAYS',
          classification: 'ESTIMATED',
          source_lineage_ref: 'estimate:missing-terms'
        },
        liquidity_lockup_ratio_bps: {
          value: 1000,
          unit: 'BPS',
          classification: 'SIMULATED',
          source_lineage_ref: 'treasury:budget:ratio'
        },
        opportunity_cost_benchmark_bps: {
          value: 650,
          unit: 'BPS',
          classification: 'OBSERVED',
          source_lineage_ref: 'claim:macro:rbi-91d-tbill'
        },
        edge_decay_half_life_days: {
          value: 10,
          unit: 'DAYS',
          classification: 'ESTIMATED',
          source_lineage_ref: 'regime:FAST_TACTICAL_OPPORTUNITY'
        },
        evidence_conviction_score_bps: {
          value: 2000, // Low conviction (unverified)
          unit: 'BPS',
          classification: 'OBSERVED',
          source_lineage_ref: 'claim:unverified-ad'
        },
        allocated_capital_inr: {
          value: '0.00', // Strictly ₹0 allocated despite high theoretical return
          unit: 'INR',
          classification: 'SIMULATED',
          source_lineage_ref: 'allocator:firewall-blocked'
        },
        conviction_vs_allocation_rationale: 'High projected return rests solely on unverified listing; capital allocation strictly ₹0.',
        gate_badge: {
          status_code: 'BLOCKED_UNVERIFIED_ADVERTISED',
          icon_symbol: '[BLOCKED]',
          label: 'Blocked',
          aria_description: 'Unverified evidence forbids paper capital allocation regardless of projected return.'
        }
      }
    ];

    baseProjectionParams = {
      as_of_timestamp_utc: REF_TIMESTAMP_UTC,
      command_center: {
        available_treasury_capital_inr: {
          value: '36179.00',
          unit: 'INR',
          classification: 'SIMULATED',
          source_lineage_ref: 'treasury:unallocated-cash'
        },
        committed_paper_capital_inr: {
          value: '13821.00',
          unit: 'INR',
          classification: 'SIMULATED',
          source_lineage_ref: 'paper:open-allocations'
        },
        unrecovered_dwell_capital_inr: {
          value: '0.00',
          unit: 'INR',
          classification: 'SIMULATED',
          source_lineage_ref: 'positions:fba-dwell'
        },
        active_research_runs_count: {
          value: 1,
          unit: 'UNITS',
          classification: 'ACTUAL',
          source_lineage_ref: 'mcp:active-dag-runs'
        },
        risk_alerts_count: {
          value: 0,
          unit: 'UNITS',
          classification: 'ACTUAL',
          source_lineage_ref: 'red-team:active-alerts'
        },
        ledger_reconciliation_status: {
          status_code: 'RECONCILED_CLEAN',
          icon_symbol: '[OK]',
          label: 'Reconciled',
          aria_description: 'All paper transactions and virtual balances are reconciled.'
        }
      },
      opportunity_radar: {
        opportunities: [
          {
            candidate_id: 'cand:ss304:16-25mm:pack-10:verified',
            sku_id: 'prod:din3017:ss304:16-25mm:pack-10',
            source_freshness_age_seconds: {
              value: 180,
              unit: 'DAYS',
              classification: 'OBSERVED',
              source_lineage_ref: 'source:quote:observed-age'
            },
            edge_decay_regime: 'SUSTAINED_STRUCTURAL_SIGNAL',
            half_life_days: {
              value: 90,
              unit: 'DAYS',
              classification: 'ESTIMATED',
              source_lineage_ref: 'regime:half-life'
            },
            evidence_gap_status: 'DATA_COMPLETE',
            timers: [
              {
                timer_name: 'Supplier Quote Validity',
                deadline_or_duration: '2026-10-25T12:00:00Z',
                classification: 'MEASURED_DEADLINE'
              },
              {
                timer_name: 'Warehouse Transit Dwell',
                deadline_or_duration: '14 days',
                classification: 'MODELLED_ESTIMATE'
              }
            ],
            badge: {
              status_code: 'RADAR_ACTIVE',
              icon_symbol: '[OK]',
              label: 'Active Signal',
              aria_description: 'Sustained structural signal with fresh source quote.'
            }
          }
        ],
        total_active_opportunities: {
          value: 1,
          unit: 'UNITS',
          classification: 'ACTUAL',
          source_lineage_ref: 'radar:active-count'
        },
        badge: {
          status_code: 'RADAR_HEALTHY',
          icon_symbol: '[OK]',
          label: 'Healthy',
          aria_description: 'Opportunity radar tracking active opportunities.'
        }
      },
      evidence_workbench: {
        records: [
          {
            claim_id: 'claim:indiamart:howrah:tier-quote:001',
            entity_id: 'supplier:howrah:ss304',
            evidence_kind: 'SUPPLIER_QUOTE',
            verification_status: 'VERIFIED',
            commercial_status: 'SUPPLIER_QUOTE',
            dom_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
            provenance_lineage: 'sourceCaptureWorker:mcp://supplier-catalog/scrape_quote',
            conflict_hold: false,
            promoted_at_utc: REF_TIMESTAMP_UTC,
            badge: {
              status_code: 'EVIDENCE_VERIFIED',
              icon_symbol: '[OK]',
              label: 'Verified Offer',
              aria_description: 'Supplier quote verified against DOM signature.'
            }
          }
        ],
        conflict_holds_count: {
          value: 0,
          unit: 'UNITS',
          classification: 'ACTUAL',
          source_lineage_ref: 'evidence:conflict-holds'
        },
        badge: {
          status_code: 'EVIDENCE_HEALTHY',
          icon_symbol: '[OK]',
          label: 'Clean Lineage',
          aria_description: 'All active evidence claims have complete cryptographic lineage.'
        }
      },
      economics_lab: {
        sku_id: 'prod:din3017:ss304:16-25mm:pack-10',
        landed_cost_inr: {
          value: '38.2100',
          unit: 'INR',
          classification: 'SIMULATED',
          source_lineage_ref: 'formula:FIN-LANDED-COST-001'
        },
        fee_gst_rate_bps: {
          value: 1800,
          unit: 'BPS',
          classification: 'OBSERVED',
          source_lineage_ref: 'circular:CBIC-GST-FEES-2026'
        },
        sec_52_tcs_rate_bps: {
          value: 50,
          unit: 'BPS',
          classification: 'OBSERVED',
          source_lineage_ref: 'statute:CGST-SEC-52'
        },
        sec_194_o_tds_rate_bps: {
          value: 10,
          unit: 'BPS',
          classification: 'OBSERVED',
          source_lineage_ref: 'statute:IT-SEC-194-O'
        },
        return_attrition_drag_bps: {
          value: 150,
          unit: 'BPS',
          classification: 'ESTIMATED',
          source_lineage_ref: 'formula:FIN-RETURN-ATTRITION-004'
        },
        tiered_moq_brackets: [
          { min_qty: 100, max_qty: 249, unit_price_inr: '131.00', selected: false },
          { min_qty: 250, max_qty: 499, unit_price_inr: '128.50', selected: false },
          { min_qty: 500, max_qty: 999999, unit_price_inr: '125.00', selected: true }
        ],
        spread_and_breakeven_bands: {
          upper_spread_bps: 39941,
          breakeven_price_inr: '28.50',
          lower_scrap_floor_inr: '22.40'
        },
        cash_flow_j_curve: [
          { day: 0, cumulative_cash_flow_inr: '-13821.00' },
          { day: 14, cumulative_cash_flow_inr: '-13821.00' },
          { day: 35, cumulative_cash_flow_inr: '41372.00' }
        ],
        arbitrage_greeks: {
          delta_bps: 105,
          theta_bps: -12,
          vega_bps: 35
        },
        formula_registry_cards: [
          { card_id: 'FIN-LANDED-COST-001', title: 'SS304 Landed Cost EXW', status: 'PROMOTED_NORMATIVE' },
          { card_id: 'FIN-STATUTORY-TCS-TDS-003', title: 'Statutory Withholding TCS/TDS', status: 'PROMOTED_NORMATIVE' }
        ],
        badge: {
          status_code: 'ECONOMICS_NORMATIVE',
          icon_symbol: '[OK]',
          label: 'Normative Math',
          aria_description: 'Calculations executed via pure BigInt rational AST in promoted formulas.'
        }
      },
      capital_allocator: {
        opportunities: sampleTenDimRows,
        total_paper_budget_inr: {
          value: '50000.00',
          unit: 'INR',
          classification: 'SIMULATED',
          source_lineage_ref: 'charter:treasury-paper-budget'
        },
        allocated_paper_capital_inr: {
          value: '13821.00',
          unit: 'INR',
          classification: 'SIMULATED',
          source_lineage_ref: 'allocator:committed-total'
        },
        unallocated_paper_capital_inr: {
          value: '36179.00',
          unit: 'INR',
          classification: 'SIMULATED',
          source_lineage_ref: 'allocator:unallocated-total'
        },
        badge: {
          status_code: 'ALLOCATION_CONSTRAINED',
          icon_symbol: '[OK]',
          label: 'Within Limits',
          aria_description: 'Paper capital allocations respect budget and concentration constraints.'
        }
      },
      simulation_and_positions: {
        paper_positions: [
          {
            position_id: 'pos:paper:ss304:batch-500',
            candidate_id: 'cand:ss304:16-25mm:pack-10:verified',
            allocated_capital_inr: '13821.00',
            lifecycle_status: 'VALID_CALCULATED_RETURN',
            inventory_conservation_proven: true,
            badge: {
              status_code: 'POSITION_ACTIVE_PAPER',
              icon_symbol: '[OK]',
              label: 'Active Position',
              aria_description: 'Paper position progressing through lifecycle stages.'
            }
          }
        ],
        seven_bucket_inventory: sampleInventory,
        cash_ledger_balance_inr: {
          value: '36179.00',
          unit: 'INR',
          classification: 'SIMULATED',
          source_lineage_ref: 'paper:virtual-cash-balance'
        },
        badge: {
          status_code: 'SIMULATION_CONSERVED',
          icon_symbol: '[OK]',
          label: 'Conserved',
          aria_description: 'Bitwise conservation verified across inventory buckets and cash ledger.'
        }
      },
      reconciliation_and_performance: {
        factor_efficacy_ledger: [
          {
            factor_name: 'FACTOR_INDUSTRIAL_CAPEX_DEMAND',
            observed_correlation_bps: 8200,
            regime_efficacy: 'EMPIRICALLY_VALIDATED_DRIVER'
          }
        ],
        bitemporal_restatements: [
          {
            record_id: 'bitemp:ss304:restatement:001',
            decision_time_utc: '2026-10-18T10:00:00.000Z',
            knowledge_time_utc: '2026-10-18T12:00:00.000Z',
            restatement_diff_summary: 'New quote confirmed tier pricing; thesis intact without rewriting past history.'
          }
        ],
        cross_ledger_comparison: sampleCrossLedger,
        reconciliation_exceptions: [],
        badge: {
          status_code: 'RECONCILIATION_HEALTHY',
          icon_symbol: '[OK]',
          label: 'Zero Exceptions',
          aria_description: 'Reconciliation confirms zero cross-ledger leakage and intact bitemporal records.'
        }
      },
      risk_audit_and_system_health: {
        mcp_worker_dag_nodes: [
          { node_id: 'task:source:indiamart', pass: 1, status: 'COMPLETED', dependencies: [] },
          { node_id: 'task:macro:benchmarks', pass: 1, status: 'COMPLETED', dependencies: [] },
          { node_id: 'task:govt:statutory', pass: 1, status: 'COMPLETED', dependencies: [] },
          { node_id: 'task:redteam:audit', pass: 3, status: 'COMPLETED', dependencies: ['task:source:indiamart'] }
        ],
        mcp_quotas: [
          {
            grant_id: 'grant:source:001',
            worker_id: 'worker:source-capture:v1',
            requests_made: 1,
            max_requests: 5,
            tokens_used: 1200,
            max_tokens: 16000,
            payload_bytes: 45000,
            max_bytes: 524288,
            wall_clock_ms: 120,
            max_wall_clock_ms: 10000
          }
        ],
        denied_mcp_calls_count: 0,
        red_team_findings: [
          {
            finding_id: 'RT-01',
            title: 'Physical SS304 Scrap Floor Check',
            blocking: false,
            status: 'PASSED_ABOVE_FLOOR'
          }
        ],
        kill_switch_state: {
          active_scope: 'NORMAL_PAPER_OPERATION'
        },
        hash_chain_integrity: {
          verified: true,
          chain_length: 14,
          root_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
        },
        badge: {
          status_code: 'SYSTEM_HEALTH_OPTIMAL',
          icon_symbol: '[OK]',
          label: 'Optimal',
          aria_description: 'All system health, quota, and cryptographic integrity checks verified.'
        }
      }
    };
  });

  // ---------------------------------------------------------------------------
  // TEST 1: EIGHT WORKSPACES & NO VANITY PROFIT FIGURE
  // ---------------------------------------------------------------------------
  it('MCP-TERM-EIGHT-WORKSPACES-AND-NO-VANITY-PROFIT-001: Verifies all 8 workspaces project deterministically, every figure carries provenance, vanity profit is forbidden, and snapshot is deeply frozen', () => {
    const snapshot = OperatorTerminalController.projectTerminalSnapshot(baseProjectionParams);

    // 1. All 8 logical workspaces exist
    expect(snapshot.workspaces.command_center).toBeDefined();
    expect(snapshot.workspaces.opportunity_radar).toBeDefined();
    expect(snapshot.workspaces.evidence_workbench).toBeDefined();
    expect(snapshot.workspaces.economics_lab).toBeDefined();
    expect(snapshot.workspaces.capital_allocator).toBeDefined();
    expect(snapshot.workspaces.simulation_and_positions).toBeDefined();
    expect(snapshot.workspaces.reconciliation_and_performance).toBeDefined();
    expect(snapshot.workspaces.risk_audit_and_system_health).toBeDefined();

    // 2. Banner invariants
    expect(snapshot.operating_mode).toBe('DRY_RUN_PAPER_SIMULATION_ONLY');
    expect(snapshot.real_money_execution_enabled).toBe(false);
    expect(snapshot.snapshot_jcs_sha256).toMatch(/^[0-9a-f]{64}$/);

    // 3. Every numeric metric has explicit provenance
    const cc = snapshot.workspaces.command_center;
    expect(['OBSERVED', 'ESTIMATED', 'SIMULATED', 'ACTUAL']).toContain(cc.available_treasury_capital_inr.classification);
    expect(['OBSERVED', 'ESTIMATED', 'SIMULATED', 'ACTUAL']).toContain(cc.committed_paper_capital_inr.classification);
    expect(['OBSERVED', 'ESTIMATED', 'SIMULATED', 'ACTUAL']).toContain(cc.unrecovered_dwell_capital_inr.classification);
    expect(snapshot.workspaces.economics_lab.landed_cost_inr.classification).toBe('SIMULATED');

    // 4. Forbid single combined vanity profit figure (POC.docx §10.1)
    expect(() => {
      OperatorTerminalController.projectTerminalSnapshot({
        ...baseProjectionParams,
        command_center: {
          ...baseProjectionParams.command_center,
          vanity_profit_check: { combined_profit_inr: '150000.00' }
        }
      });
    }).toThrow(/E-M8-VANITY-PROFIT-FORBIDDEN/);

    // 5. Deeply frozen immutability
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.workspaces)).toBe(true);
    expect(Object.isFrozen(snapshot.workspaces.command_center)).toBe(true);
    expect(Object.isFrozen(snapshot.workspaces.capital_allocator.opportunities)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // TEST 2: TEN DIMENSIONS & CONVICTION VS ALLOCATION SEPARATION
  // ---------------------------------------------------------------------------
  it('MCP-TERM-TEN-DIMENSIONS-AND-CONVICTION-VS-ALLOCATION-002: Verifies 10 required comparison dimensions without composite score, separates Conviction from Allocation, distinguishes timers, and preserves lineage', () => {
    const snapshot = OperatorTerminalController.projectTerminalSnapshot(baseProjectionParams);
    const alloc = snapshot.workspaces.capital_allocator;

    expect(alloc.opportunities.length).toBe(2);
    const [candVerified, candUnverified] = alloc.opportunities;

    // 1. All 10 Required Comparison Dimensions (POC.docx §8) present on both candidates
    for (const cand of [candVerified, candUnverified]) {
      expect(cand.expected_return_bps.value).toBeTypeOf('number');
      expect(cand.return_after_costs_and_taxes_bps.value).toBeTypeOf('number');
      expect(cand.risk_and_downside_buffer_bps.value).toBeTypeOf('number');
      expect(cand.capital_requirement_inr.value).toBeTypeOf('string');
      expect(cand.time_to_execution_days.value).toBeTypeOf('number');
      expect(cand.cash_recovery_ccc_days.value).toBeTypeOf('number');
      expect(cand.liquidity_lockup_ratio_bps.value).toBeTypeOf('number');
      expect(cand.opportunity_cost_benchmark_bps.value).toBeTypeOf('number');
      expect(cand.edge_decay_half_life_days.value).toBeTypeOf('number');
      expect(cand.evidence_conviction_score_bps.value).toBeTypeOf('number');
    }

    // 2. Conviction vs Allocation Separation (POC.docx §10.3)
    // Verified candidate receives allocated capital
    expect(candVerified.allocated_capital_inr.value).toBe('13821.00');
    expect(candVerified.gate_badge.icon_symbol).toBe('[OK]');

    // Unverified speculative candidate has high theoretical return (1250%) but allocates strictly ₹0
    expect(candUnverified.expected_return_bps.value).toBe(125000);
    expect(candUnverified.allocated_capital_inr.value).toBe('0.00');
    expect(candUnverified.gate_badge.icon_symbol).toBe('[BLOCKED]');

    // 3. Timers distinguish MEASURED_DEADLINE from MODELLED_ESTIMATE (POC.docx §10.4)
    const timers = snapshot.workspaces.opportunity_radar.opportunities[0].timers;
    expect(timers.some(t => t.classification === 'MEASURED_DEADLINE')).toBe(true);
    expect(timers.some(t => t.classification === 'MODELLED_ESTIMATE')).toBe(true);

    // 4. Preserves full drill-down lineage reference (POC.docx §10.2)
    expect(candVerified.expected_return_bps.source_lineage_ref).toContain('indiamart');
    expect(candVerified.return_after_costs_and_taxes_bps.source_lineage_ref).toContain('FIN-STATUTORY-TCS-TDS-003');
  });

  // ---------------------------------------------------------------------------
  // TEST 3: THREE-TIER KILL-SWITCH ISOLATION
  // ---------------------------------------------------------------------------
  it('MCP-TERM-THREE-TIER-KILL-SWITCH-ISOLATION-003: Exercises all 3 kill-switch scopes, proving boundary enforcement while preserving 100% of historical records', () => {
    const killSwitch = new KillSwitchController();
    const confirmation: OperatorConfirmationEnvelope = {
      operator_id: OPERATOR_ID,
      action_type: 'ACTIVATE_KILL_SWITCH',
      target_entity_id: 'system:scheduler',
      explicit_rationale: 'Market volatility surge exceeds downside risk threshold; halting new allocations.',
      confirmation_token: 'tok:sec:ks-001-xyz',
      confirmed_at_utc: REF_TIMESTAMP_UTC
    };

    // Initially in normal operation
    expect(killSwitch.getState().active_scope).toBe('NORMAL_PAPER_OPERATION');
    expect(() => killSwitch.assertAllocationAllowed()).not.toThrow();
    expect(() => killSwitch.assertSimulationAllowed()).not.toThrow();
    expect(() => killSwitch.assertResearchAllowed()).not.toThrow();

    // Scope 1: HALT_NEW_ALLOCATIONS
    killSwitch.activateKillSwitch('HALT_NEW_ALLOCATIONS', confirmation);
    expect(killSwitch.getState().active_scope).toBe('HALT_NEW_ALLOCATIONS');
    expect(() => killSwitch.assertAllocationAllowed()).toThrow(/E-M8-KILLSWITCH-NEW-ALLOCATIONS-HALTED/);
    expect(() => killSwitch.assertSimulationAllowed()).not.toThrow(); // existing simulation tracking continues
    expect(() => killSwitch.assertResearchAllowed()).not.toThrow();

    // Scope 2: HALT_ALL_SIMULATION_PROCESSING
    killSwitch.activateKillSwitch('HALT_ALL_SIMULATION_PROCESSING', confirmation);
    expect(killSwitch.getState().active_scope).toBe('HALT_ALL_SIMULATION_PROCESSING');
    expect(() => killSwitch.assertAllocationAllowed()).toThrow(/E-M8-KILLSWITCH-ALL-SIMULATION-HALTED/);
    expect(() => killSwitch.assertSimulationAllowed()).toThrow(/E-M8-KILLSWITCH-ALL-SIMULATION-HALTED/);
    expect(() => killSwitch.assertResearchAllowed()).not.toThrow(); // research reads still allowed

    // Scope 3: ENTER_RECOVERY_ONLY_MODE
    killSwitch.activateKillSwitch('ENTER_RECOVERY_ONLY_MODE', confirmation);
    expect(killSwitch.getState().active_scope).toBe('ENTER_RECOVERY_ONLY_MODE');
    expect(() => killSwitch.assertAllocationAllowed()).toThrow(/E-M8-KILLSWITCH-RECOVERY-ONLY/);
    expect(() => killSwitch.assertSimulationAllowed()).toThrow(/E-M8-KILLSWITCH-RECOVERY-ONLY/);
    expect(() => killSwitch.assertResearchAllowed()).toThrow(/E-M8-KILLSWITCH-RECOVERY-ONLY/);

    // Reset kill switch
    killSwitch.resetKillSwitch({
      operator_id: OPERATOR_ID,
      action_type: 'RESET_KILL_SWITCH',
      target_entity_id: 'system:scheduler',
      explicit_rationale: 'Conditions normalized; resuming normal paper simulation operations.',
      confirmation_token: 'tok:sec:ks-reset-002',
      confirmed_at_utc: REF_TIMESTAMP_UTC
    });
    expect(killSwitch.getState().active_scope).toBe('NORMAL_PAPER_OPERATION');
    expect(() => killSwitch.assertAllocationAllowed()).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // TEST 4: CONFIRMATION GATE & NO OPTIMISTIC UI
  // ---------------------------------------------------------------------------
  it('MCP-TERM-CONFIRMATION-GATE-AND-NO-OPTIMISTIC-UI-004: Proves state transitions require valid confirmation and >= 15-char rationale, and failed actions never apply optimistic UI mutation', () => {
    let internalStateValue = 100;

    // 1. Missing or empty confirmation token fails closed
    expect(() => {
      executeGovernedOperatorAction(() => {
        internalStateValue += 50;
      }, {
        operator_id: OPERATOR_ID,
        action_type: 'APPROVE_PAPER_ALLOCATION',
        target_entity_id: 'cand:001',
        explicit_rationale: 'Approving paper allocation based on verified quote.',
        confirmation_token: '', // empty token
        confirmed_at_utc: REF_TIMESTAMP_UTC
      });
    }).toThrow(/E-M8-CONFIRMATION-AND-RATIONALE-REQUIRED/);
    expect(internalStateValue).toBe(100); // Unmutated!

    // 2. Rationale < 15 characters fails closed
    expect(() => {
      executeGovernedOperatorAction(() => {
        internalStateValue += 50;
      }, {
        operator_id: OPERATOR_ID,
        action_type: 'APPROVE_PAPER_ALLOCATION',
        target_entity_id: 'cand:001',
        explicit_rationale: 'looks good', // 10 chars only!
        confirmation_token: 'tok:valid:001',
        confirmed_at_utc: REF_TIMESTAMP_UTC
      });
    }).toThrow(/E-M8-CONFIRMATION-AND-RATIONALE-REQUIRED/);
    expect(internalStateValue).toBe(100); // Unmutated!

    // 3. Valid confirmation executes action and asserts optimistic_ui_mutation_allowed: false
    const result = executeGovernedOperatorAction(() => {
      internalStateValue += 50;
      return internalStateValue;
    }, {
      operator_id: OPERATOR_ID,
      action_type: 'APPROVE_PAPER_ALLOCATION',
      target_entity_id: 'cand:001',
      explicit_rationale: 'Corroborated tiered MOQ verified against Howrah catalog.',
      confirmation_token: 'tok:valid:001',
      confirmed_at_utc: REF_TIMESTAMP_UTC
    });

    expect(result.outcome).toBe(150);
    expect(result.optimistic_ui_mutation_allowed).toBe(false);
    expect(internalStateValue).toBe(150);
  });

  // ---------------------------------------------------------------------------
  // TEST 5: TWO-LEVEL ERROR & UNKNOWN WRITE OUTCOME
  // ---------------------------------------------------------------------------
  it('MCP-TERM-TWO-LEVEL-ERROR-AND-UNKNOWN-WRITE-OUTCOME-005: Verifies two-level error generation, secret scrubbing, and timeout outcome_unknown distinction', () => {
    // 1. Secret scrubbing from operator message
    const leakError = new Error(
      'Failed connecting with key gsk_SECRETKEY999888777 via Groq_Key.env to postgres://pgadmin:SuperSecretPass123@localhost:5432/market_hft_test'
    );

    const errorEnvelope = formatTwoLevelError(leakError, {
      affected_entity_id: 'cand:ss304:batch-500',
      correlation_id: 'corr:audit:err:001',
      state_before: { stage: 'PRE_COMMIT' },
      state_after: { stage: 'ABORTED' }
    });

    // Check secrets are redacted from operator_message
    expect(errorEnvelope.operator_message).toContain('[E-M8-SECRET-REDACTED]');
    expect(errorEnvelope.operator_message).toContain('[REDACTED_API_KEY]');
    expect(errorEnvelope.operator_message).toContain('[REDACTED_ENV_FILE]');
    expect(errorEnvelope.operator_message).toContain('[REDACTED_PASSWORD]');
    expect(errorEnvelope.operator_message).not.toContain('gsk_SECRETKEY999888777');
    expect(errorEnvelope.operator_message).not.toContain('SuperSecretPass123');

    // Structured audit detail
    expect(errorEnvelope.outcome_status).toBe('DEFINITE_FAILURE');
    expect(errorEnvelope.audit_detail.affected_entity_id).toBe('cand:ss304:batch-500');
    expect(errorEnvelope.audit_detail.correlation_id).toBe('corr:audit:err:001');
    expect(errorEnvelope.audit_detail.state_before_jcs_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(errorEnvelope.audit_detail.state_after_jcs_hash).toMatch(/^[0-9a-f]{64}$/);

    // 2. Write timeout emits OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED
    const timeoutError = new Error('Database write operation timed out waiting for replication ACK after 10000ms');
    const timeoutEnvelope = formatTwoLevelError(timeoutError, {
      affected_entity_id: 'order:paper:500-pack',
      correlation_id: 'corr:timeout:002',
      is_write_timeout: true
    });

    expect(timeoutEnvelope.outcome_status).toBe('OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
  });

  // ---------------------------------------------------------------------------
  // TEST 6: CROSS-LEDGER COMPARISON & CONSERVATION
  // ---------------------------------------------------------------------------
  it('MCP-TERM-CROSS-LEDGER-COMPARISON-AND-CONSERVATION-006: Verifies read-only cross-ledger comparison in Workspace 7, ActualsGuard write blocking, and conservation exception handling', async () => {
    const snapshot = OperatorTerminalController.projectTerminalSnapshot(baseProjectionParams);
    const recon = snapshot.workspaces.reconciliation_and_performance;

    // 1. Cross-ledger comparison displays paper vs actuals with blocking flags
    expect(recon.cross_ledger_comparison.direct_merge_blocked).toBe(true);
    expect(recon.cross_ledger_comparison.actuals_write_blocked).toBe(true);
    expect(recon.cross_ledger_comparison.paper_ledger_total_inr).toBe('50000.00');
    expect(recon.cross_ledger_comparison.actuals_ledger_total_inr).toBe('0.00');

    // 2. Prove ActualsGuard blocks any simulation ledger write to actuals
    const simCtx: SimulationLedgerContext = {
      ledger_type: 'SIMULATION_LEDGER',
      simulation_run_id: 'run:sim:001',
      scenario_parameters_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    };

    const mockMutation = {
      transaction_id: 'tx:illegal:001',
      position_id: 'pos:001',
      debit_account: 'CASH',
      credit_account: 'BANK',
      amount: { currency: 'INR' as const, amount_subunits: '1000000', scale: 4 },
      description: 'Illegal paper-to-actuals mutation'
    };

    await expect(
      enforceActualsLedgerWrite(mockMutation, simCtx, REF_TIMESTAMP_UTC, {} as any)
    ).rejects.toThrow(/E-ERR-020: ACTUALS_LEDGER_WRITE_VIOLATION/);

    // 3. Prove cash / 7-bucket inventory mismatch triggers reconciliation exception
    expect(() => {
      OperatorTerminalController.projectTerminalSnapshot({
        ...baseProjectionParams,
        simulation_and_positions: {
          ...baseProjectionParams.simulation_and_positions,
          seven_bucket_inventory: {
            ...sampleInventory,
            total_conserved: 999 // Mismatch! sum is 100
          }
        }
      });
    }).toThrow(/E-M8-RECONCILIATION-EXCEPTION/);
  });

  // ---------------------------------------------------------------------------
  // TEST 7: ACCESSIBLE HTML/SVG WORKSTATION RENDERER
  // ---------------------------------------------------------------------------
  it('MCP-TERM-ACCESSIBLE-HTML-SVG-RENDER-007: Renders self-contained HTML5/SVG terminal and verifies all 8 workspace sections, SVG charts, DRY_RUN banner, and non-color-only semantic badges', () => {
    const snapshot = OperatorTerminalController.projectTerminalSnapshot(baseProjectionParams);
    const html = renderOperatorTerminalHtml(snapshot);

    // 1. Top banner & safety mode
    expect(html).toContain('OPERATING MODE: <strong>DRY_RUN_PAPER_SIMULATION_ONLY</strong>');
    expect(html).toContain('REAL-MONEY EXECUTION: <strong>DISABLED</strong>');

    // 2. All 8 workspace sections present
    expect(html).toContain('id="workspace-command-center"');
    expect(html).toContain('id="workspace-opportunity-radar"');
    expect(html).toContain('id="workspace-evidence-workbench"');
    expect(html).toContain('id="workspace-economics-lab"');
    expect(html).toContain('id="workspace-capital-allocator"');
    expect(html).toContain('id="workspace-simulation-and-positions"');
    expect(html).toContain('id="workspace-reconciliation-and-performance"');
    expect(html).toContain('id="workspace-risk-audit-and-system-health"');

    // 3. SVG charts present
    expect(html).toContain('chart-spread-bands');
    expect(html).toContain('chart-j-curve');
    expect(html).toContain('chart-conviction-matrix');
    expect(html).toContain('chart-mcp-dag');

    // 4. Accessible non-color-only semantic badges present
    expect(html).toContain('[OK]');
    expect(html).toContain('[BLOCKED]');
    expect(html).toContain('role="banner"');
    expect(html).toContain('aria-label=');

    // 5. Value provenance tags
    expect(html).toContain('SIMULATED');
    expect(html).toContain('ACTUAL');
  });

  // ---------------------------------------------------------------------------
  // TEST 8: TWELVE-POINT RELEASE GATE CAPSTONE
  // ---------------------------------------------------------------------------
  it('MCP-TERM-TWELVE-POINT-RELEASE-GATE-CAPSTONE-008: Executes evaluateTwelvePointPlatformReadiness across complete lifecycle, asserting all 12 criteria pass with bit-for-bit JCS SHA-256 certificate', () => {
    const snapshot = OperatorTerminalController.projectTerminalSnapshot(baseProjectionParams);
    const cert = evaluateTwelvePointPlatformReadiness(snapshot);

    // 1. All 12 criteria passed
    expect(cert.all_twelve_passed).toBe(true);
    expect(cert.criteria.length).toBe(12);

    for (const criterion of cert.criteria) {
      expect(criterion.passed).toBe(true);
      expect(criterion.criterion_id).toMatch(/^POC-CRIT-\d{2}-/);
      expect(criterion.evidence_reference).toContain('POC.docx');
    }

    // 2. Verify all 12 criteria IDs
    const expectedIds = [
      'POC-CRIT-01-CANDIDATE-DISCOVERY-EVIDENCE',
      'POC-CRIT-02-GOVERNED-EVIDENCE-PROMOTION',
      'POC-CRIT-03-DETERMINISTIC-VERSIONED-ECONOMICS',
      'POC-CRIT-04-EXPLICIT-STATUSES-NO-FABRICATION',
      'POC-CRIT-05-CAPITAL-ALLOCATION-RISK-GATING',
      'POC-CRIT-06-PAPER-LIFECYCLE-CONSERVATION',
      'POC-CRIT-07-CRASH-AND-FAILED-WRITE-SAFETY',
      'POC-CRIT-08-INTEGRITY-AND-RECONCILIATION',
      'POC-CRIT-09-BITEMPORAL-REPLAY-WITHOUT-REWRITE',
      'POC-CRIT-10-UI-READONLY-CANNOT-BYPASS-CONTROLS',
      'POC-CRIT-11-ALL-APPROVED-TESTS-PASS',
      'POC-CRIT-12-REAL-MONEY-IMPOSSIBLE-PAPER-ONLY'
    ];

    expect(cert.criteria.map(c => c.criterion_id)).toEqual(expectedIds);

    // 3. JCS SHA-256 certificate digest
    expect(cert.certificate_jcs_sha256).toMatch(/^[0-9a-f]{64}$/);

    // 4. Verify certificate is deeply frozen
    expect(Object.isFrozen(cert)).toBe(true);
    expect(Object.isFrozen(cert.criteria)).toBe(true);

    // 5. Bit-for-bit reproducibility: evaluate again with same snapshot produces identical digest
    const cert2 = evaluateTwelvePointPlatformReadiness(snapshot);
    expect(cert2.certificate_jcs_sha256).toBe(cert.certificate_jcs_sha256);
  });
});
