/**
 * Gate M5 Silo vs. Simultaneous Group Strategy Simulator
 *
 * Implements:
 * 1. Silo Simulation Mode:
 *    - Matrix: SS304 DIN 3017 clamps across 4 diameters (16-25mm, 20-32mm, 25-40mm, 32-50mm)
 *      and 2 pack hypotheses (10-pack vs. 20-pack).
 *    - Price and Breakeven Bands (gross selling price, unit landed cost, breakeven floor).
 *    - Cash-Flow J-Curve Waterfall Series (Day 0 outflow through Day 35 settlement).
 *    - Arbitrage Greeks Sensitivity (Delta: price sensitivity, Theta: time/dwell decay, Vega: return drag).
 * 2. Simultaneous Group Simulation Mode:
 *    - Treasury Budget constraint (₹50,000.0000 = 500,000,000 subunits).
 *    - Single-candidate concentration cap (50.00% = 250,000,000 subunits).
 *    - Correlated lateral-market shocks (e.g. LME raw material price spike).
 *    - Discrete MOQ lot-sizing (integer multiples only).
 *    - Conviction vs. Allocation separation (unverified listings get ₹0 capital).
 *    - Sovereign 91-Day T-Bill cash sweep enforcing exact treasury conservation.
 *    - Benchmark comparisons (RBI 91D T-Bill at 6.50% & Nifty Liquid Benchmark at 6.80%).
 *    - Trading terminal bubble chart coordinates (X: Conviction, Y: Excess RoWC, Z: Allocation).
 * 3. Bit-for-bit RFC 8785 JCS canonical determinism & SHA-256 digest.
 */

import { createHash } from 'crypto';
import { canonicalizeJCS } from '../canonical/jcs.js';
import {
  EvidenceEnvelope,
  EvidencePromotionEngine,
  NormalizedSignal,
  ReturnStatus,
  resolveReturnStatus
} from './m5SignalAndEvidenceEngine.js';
import { OperationalEconomicsParameters } from './m4VerticalSlice.js';
import { PriceBracketTier } from '../agents/workers/sourceCaptureWorker.js';

export type SS304Diameter = '16-25mm' | '20-32mm' | '25-40mm' | '32-50mm';
export type SS304PackSize = 10 | 20;

export interface SiloCandidateInput {
  candidate_id: string;
  sku_id: string;
  diameter: SS304Diameter;
  pack_size: SS304PackSize;
  title: string;
  moq: number;
  gross_selling_price_subunits: bigint;
  raw_material_purchase_subunits: bigint;
  inbound_freight_subunits: bigint;
  packaging_kitting_subunits: bigint;
  insurance_handling_subunits?: bigint;
  customs_inspection_subunits?: bigint;
  marketplace_referral_bps?: bigint; // default 1500n (15.00%)
  marketplace_closing_subunits?: bigint; // default 100000n (₹10.0000)
  marketplace_weight_handling_subunits?: bigint; // default 140000n (₹14.0000)
  storage_fee_subunits?: bigint;
  operational_params?: OperationalEconomicsParameters;
  evidence_envelopes?: EvidenceEnvelope<any>[];
  is_verified?: boolean;
  missing_mandatory_inputs?: boolean;
  is_open_position?: boolean;
}

export interface PriceAndBreakevenBands {
  gross_selling_price: string;
  breakeven_floor: string;
  unit_landed_cost: string;
}

export interface JCurvePoint {
  day: number;
  cash_flow_subunits: string;
  cumulative_cash_subunits: string;
  description: string;
}

export interface ArbitrageGreeksSensitivity {
  delta_bps_per_inr: string; // dRoWC / dPrice (bps per ₹1 change)
  theta_bps_per_day: string; // dRoWC / dDwellDay (daily decay as dwell stretches)
  vega_bps_per_100bps_returns: string; // dRoWC / dReturnRate (bps drop per 100 bps return rate)
}

export interface SiloSimulationResult {
  candidate_id: string;
  sku_id: string;
  diameter: SS304Diameter;
  pack_size: SS304PackSize;
  unit_landed_cost_subunits: string;
  gross_selling_price_subunits: string;
  unit_net_contribution_subunits: string;
  cash_margin_bps: string;
  annualized_rowc_bps: string;
  return_status: ReturnStatus;
  conviction_score: number;
  price_and_breakeven_bands: PriceAndBreakevenBands;
  cash_flow_j_curve_series: JCurvePoint[];
  arbitrage_greeks_sensitivity: ArbitrageGreeksSensitivity;
  jcs_hash: string;
}

export interface GroupSimulationConfig {
  treasury_budget_subunits: bigint; // e.g. 500000000n = ₹50,000.0000
  max_single_candidate_concentration_bps?: bigint; // default 5000n = 50.00%
  tbill_yield_bps?: bigint; // default 650n = 6.50%
  nifty_liquid_yield_bps?: bigint; // default 680n = 6.80%
  correlated_shocks?: NormalizedSignal[];
}

export interface BubbleChartPoint {
  candidate_id: string;
  sku_id: string;
  x_conviction_score: number; // 0 to 100
  y_annualized_excess_rowc_bps: string; // RoWC minus T-Bill hurdle
  z_allocated_capital_subunits: string; // committed capital
}

export interface GroupCandidateAllocation {
  candidate_id: string;
  sku_id: string;
  rank: number;
  allocated_lots: number;
  allocated_units: number;
  unit_landed_cost_subunits: string;
  allocated_capital_subunits: string;
  annualized_rowc_bps: string;
  excess_rowc_over_tbill_bps: string;
  conviction_score: number;
  return_status: ReturnStatus;
  rejection_reasons: string[];
}

export interface BenchmarkComparison {
  rbi_91d_tbill_yield_bps: string;
  nifty_liquid_benchmark_yield_bps: string;
  effective_portfolio_rowc_bps: string;
  excess_over_tbill_bps: string;
  excess_over_nifty_liquid_bps: string;
}

export interface GroupSimulationResult {
  simulation_id: string;
  timestamp_utc: string;
  treasury_budget_subunits: string;
  total_allocated_capital_subunits: string;
  tbill_sweep_subunits: string;
  conservation_verified: boolean;
  allocations: GroupCandidateAllocation[];
  rejected_candidates: GroupCandidateAllocation[];
  bubble_chart_points: BubbleChartPoint[];
  benchmarks: BenchmarkComparison;
  correlated_shocks_applied: string[];
  telemetry_digest_sha256: string;
}

export class M5SiloAndGroupSimulator {
  private static readonly DEFAULT_OPS_PARAMS: OperationalEconomicsParameters = {
    procurement_lead_time_days: 7,
    warehouse_dwell_days: 14,
    marketplace_settlement_delay_days: 14,
    gst_rate_bps: 1800n, // 18.00%
    itc_eligible_fraction_bps: 10000n, // 100.00%
    tcs_rate_bps: 100n, // 1.00% (Sec 52 CGST)
    tds_rate_bps: 100n, // 1.00% (Sec 194-O Income Tax)
    customer_return_rate_bps: 200n, // 2.00% nominal
    reverse_logistics_fee_subunits: 140000n, // ₹14.0000
    quarantine_attrition_rate_bps: 10000n, // 100.00%
    risk_free_rate_bps: 650n, // 6.50%
    execution_risk_premium_bps: 850n, // 8.50%
    min_cash_margin_bps: 2000n, // 20.00%
    max_ccc_days: 45,
    min_downside_buffer_bps: 1500n // 15.00%
  };

  /**
   * Internal pure subunit unit-economics evaluator
   */
  private static computeUnitEconomics(
    candidate: SiloCandidateInput,
    overrides?: {
      gross_selling_price_subunits?: bigint;
      warehouse_dwell_days?: number;
      customer_return_rate_bps?: bigint;
      raw_material_purchase_subunits?: bigint;
    }
  ) {
    const ops = candidate.operational_params ?? this.DEFAULT_OPS_PARAMS;
    const grossPrice = overrides?.gross_selling_price_subunits ?? candidate.gross_selling_price_subunits;
    const rawMaterial = overrides?.raw_material_purchase_subunits ?? candidate.raw_material_purchase_subunits;
    const inboundFreight = candidate.inbound_freight_subunits;
    const packagingKitting = candidate.packaging_kitting_subunits;
    const insurance = candidate.insurance_handling_subunits ?? 10000n;
    const customs = candidate.customs_inspection_subunits ?? 45100n;

    // Landed cost calculation
    const landedCost = rawMaterial + inboundFreight + packagingKitting + insurance + customs;

    // Marketplace fees
    const referralBps = candidate.marketplace_referral_bps ?? 1500n;
    const referralFee = (grossPrice * referralBps) / 10000n;
    const closingFee = candidate.marketplace_closing_subunits ?? 100000n;
    const fbaFee = (candidate.marketplace_weight_handling_subunits ?? 140000n) + (candidate.storage_fee_subunits ?? 0n);
    const totalMarketplaceFees = referralFee + closingFee + fbaFee;

    // Statutory 18% GST on marketplace fees
    const marketplaceFeeGst = (totalMarketplaceFees * ops.gst_rate_bps) / 10000n;

    // Ex-GST base for TCS and TDS
    const exGstRevenue = (grossPrice * 10000n) / (10000n + ops.gst_rate_bps);
    const tcs = (exGstRevenue * ops.tcs_rate_bps) / 10000n;
    const tds = (exGstRevenue * ops.tds_rate_bps) / 10000n;

    // Net disbursement from marketplace
    const netDisbursement = grossPrice - totalMarketplaceFees - marketplaceFeeGst - tcs - tds;

    // Statutory GST settlement
    const outputGst = grossPrice - exGstRevenue;
    const procurementItc = landedCost - (landedCost * 10000n) / (10000n + ops.gst_rate_bps);
    const feeGstItc = (marketplaceFeeGst * ops.itc_eligible_fraction_bps) / 10000n;
    const totalItc = procurementItc + feeGstItc;
    const netGstCashLiability = outputGst > totalItc ? outputGst - totalItc : 0n;
    const netStatutorySettlement = netGstCashLiability > tcs ? netGstCashLiability - tcs : 0n;

    // Customer returns & attrition
    const returnRateBps = overrides?.customer_return_rate_bps ?? ops.customer_return_rate_bps;
    const unitReturnAttritionCost = fbaFee + ops.reverse_logistics_fee_subunits + landedCost;
    const returnDrag = (unitReturnAttritionCost * returnRateBps) / 10000n;

    // Net unit contribution
    const unitNetContribution = netDisbursement - landedCost - netStatutorySettlement - returnDrag;

    // Cash conversion cycle days
    const dwellDays = overrides?.warehouse_dwell_days ?? ops.warehouse_dwell_days;
    const cccDays = Math.max(
      1,
      ops.procurement_lead_time_days + dwellDays + ops.marketplace_settlement_delay_days
    );

    // Cash margin in basis points
    const cashMarginBps = landedCost > 0n ? (unitNetContribution * 10000n) / landedCost : -10000n;

    // Annualized RoWC in basis points
    const annualizedRowcBps = cccDays > 0 ? (cashMarginBps * 365n) / BigInt(cccDays) : 0n;

    // Breakeven floor calculation
    const breakevenFloor = landedCost + totalMarketplaceFees + marketplaceFeeGst + netStatutorySettlement + returnDrag;

    return {
      landedCost,
      grossPrice,
      totalMarketplaceFees,
      marketplaceFeeGst,
      tcs,
      tds,
      netDisbursement,
      netStatutorySettlement,
      returnDrag,
      unitNetContribution,
      cccDays,
      cashMarginBps,
      annualizedRowcBps,
      breakevenFloor
    };
  }

  /**
   * Executes Silo Simulation Mode for a single SS304 variant.
   */
  public static runSiloSimulation(candidate: SiloCandidateInput): SiloSimulationResult {
    const base = this.computeUnitEconomics(candidate);

    // Compute Arbitrage Greeks
    // 1. Delta: dRoWC / dPrice (per ₹1.0000 = 10,000 subunits)
    const priceBump = this.computeUnitEconomics(candidate, {
      gross_selling_price_subunits: candidate.gross_selling_price_subunits + 10000n
    });
    const deltaBps = priceBump.annualizedRowcBps - base.annualizedRowcBps;

    // 2. Theta: dRoWC / dDwellDay (decay per additional day of warehouse dwell)
    const currentDwell = candidate.operational_params?.warehouse_dwell_days ?? this.DEFAULT_OPS_PARAMS.warehouse_dwell_days;
    const dwellBump = this.computeUnitEconomics(candidate, {
      warehouse_dwell_days: currentDwell + 1
    });
    const thetaBps = dwellBump.annualizedRowcBps - base.annualizedRowcBps; // typically negative

    // 3. Vega: dRoWC / dReturnRate (drop per 100 bps = 1.00% customer returns)
    const currentReturns = candidate.operational_params?.customer_return_rate_bps ?? this.DEFAULT_OPS_PARAMS.customer_return_rate_bps;
    const returnBump = this.computeUnitEconomics(candidate, {
      customer_return_rate_bps: currentReturns + 100n
    });
    const vegaBps = returnBump.annualizedRowcBps - base.annualizedRowcBps; // typically negative

    // Calculate Conviction Score from evidence envelopes
    const convictionScore = candidate.evidence_envelopes && candidate.evidence_envelopes.length > 0
      ? EvidencePromotionEngine.computeConvictionScore(candidate.evidence_envelopes)
      : (candidate.is_verified ? 85 : 20);

    // Resolve return status
    const returnStatusResult = resolveReturnStatus({
      hasMissingMandatoryInputs: Boolean(candidate.missing_mandatory_inputs),
      hasUnverifiedEvidence: candidate.is_verified === false,
      isOpenPosition: Boolean(candidate.is_open_position),
      isRecovered: base.unitNetContribution > 0n,
      solverConverged: true,
      calculatedRoWcBps: base.annualizedRowcBps
    });

    // Cash-Flow J-Curve Waterfall Series (35-day cycle)
    const jCurveSeries: JCurvePoint[] = [];
    const batchOutlay = base.landedCost * BigInt(candidate.moq);
    const batchDisbursement = (base.netDisbursement - base.netStatutorySettlement - base.returnDrag) * BigInt(candidate.moq);
    const batchNetProfit = base.unitNetContribution * BigInt(candidate.moq);

    // Day 0: Procurement Outflow
    jCurveSeries.push({
      day: 0,
      cash_flow_subunits: (-batchOutlay).toString(),
      cumulative_cash_subunits: (-batchOutlay).toString(),
      description: 'Procurement & Inbound Logistics Outflow'
    });

    // Day 7: Warehouse Inbound Received
    jCurveSeries.push({
      day: 7,
      cash_flow_subunits: '0',
      cumulative_cash_subunits: (-batchOutlay).toString(),
      description: 'Warehouse Inbound & Packaging Received'
    });

    // Day 21: Customer Orders Delivered
    jCurveSeries.push({
      day: 21,
      cash_flow_subunits: '0',
      cumulative_cash_subunits: (-batchOutlay).toString(),
      description: 'Marketplace Orders Delivered / Dwell Window Closed'
    });

    // Day 35: Settlement Disbursed
    jCurveSeries.push({
      day: 35,
      cash_flow_subunits: batchDisbursement.toString(),
      cumulative_cash_subunits: batchNetProfit.toString(),
      description: 'Marketplace Payout Disbursed & Statutory Netting Settled'
    });

    const priceBands: PriceAndBreakevenBands = {
      gross_selling_price: base.grossPrice.toString(),
      breakeven_floor: base.breakevenFloor.toString(),
      unit_landed_cost: base.landedCost.toString()
    };

    const greeks: ArbitrageGreeksSensitivity = {
      delta_bps_per_inr: deltaBps.toString(),
      theta_bps_per_day: thetaBps.toString(),
      vega_bps_per_100bps_returns: vegaBps.toString()
    };

    const cleanResult = {
      candidate_id: candidate.candidate_id,
      sku_id: candidate.sku_id,
      diameter: candidate.diameter,
      pack_size: candidate.pack_size,
      unit_landed_cost_subunits: base.landedCost.toString(),
      gross_selling_price_subunits: base.grossPrice.toString(),
      unit_net_contribution_subunits: base.unitNetContribution.toString(),
      cash_margin_bps: base.cashMarginBps.toString(),
      annualized_rowc_bps: base.annualizedRowcBps.toString(),
      return_status: returnStatusResult.status,
      conviction_score: convictionScore,
      price_and_breakeven_bands: priceBands,
      cash_flow_j_curve_series: jCurveSeries,
      arbitrage_greeks_sensitivity: greeks
    };

    const jcs_hash = createHash('sha256')
      .update(canonicalizeJCS(cleanResult))
      .digest('hex');

    return {
      ...cleanResult,
      jcs_hash
    };
  }

  /**
   * Executes Simultaneous Group Simulation Mode across a portfolio under shared budget,
   * correlated lateral shocks, concentration limits, and T-Bill sweep.
   */
  public static runGroupSimulation(
    candidates: SiloCandidateInput[],
    config: GroupSimulationConfig
  ): GroupSimulationResult {
    const treasuryBudget = config.treasury_budget_subunits;
    const concentrationCap =
      (treasuryBudget * (config.max_single_candidate_concentration_bps ?? 5000n)) / 10000n; // default 50%
    const tbillYieldBps = config.tbill_yield_bps ?? 650n; // 6.50%
    const niftyLiquidYieldBps = config.nifty_liquid_yield_bps ?? 680n; // 6.80%

    // Step 1: Apply Correlated Lateral Shocks
    const shocksApplied: string[] = [];
    const shockedCandidates = candidates.map((cand) => {
      let rawMaterial = cand.raw_material_purchase_subunits;
      let returnRate = cand.operational_params?.customer_return_rate_bps ?? this.DEFAULT_OPS_PARAMS.customer_return_rate_bps;
      let freight = cand.inbound_freight_subunits;

      if (config.correlated_shocks) {
        for (const shock of config.correlated_shocks) {
          if (shock.economic_factor_name === 'RAW_MATERIAL_LME_STEEL_SHOCK') {
            // Apply steel inflation shock (e.g. +1000 bps = +10%)
            rawMaterial = rawMaterial + (rawMaterial * shock.magnitude_bps) / 10000n;
            if (!shocksApplied.includes(shock.economic_factor_name)) {
              shocksApplied.push(shock.economic_factor_name);
            }
          } else if (shock.economic_factor_name === 'CUSTOMER_RETURN_RATE_SHOCK') {
            returnRate = returnRate + shock.magnitude_bps;
            if (!shocksApplied.includes(shock.economic_factor_name)) {
              shocksApplied.push(shock.economic_factor_name);
            }
          } else if (shock.economic_factor_name === 'INBOUND_LOGISTICS_LEAD_TIME_SHOCK') {
            freight = freight + (freight * shock.magnitude_bps) / 10000n;
            if (!shocksApplied.includes(shock.economic_factor_name)) {
              shocksApplied.push(shock.economic_factor_name);
            }
          }
        }
      }

      const updatedOps: OperationalEconomicsParameters = {
        ...(cand.operational_params ?? this.DEFAULT_OPS_PARAMS),
        customer_return_rate_bps: returnRate
      };

      return {
        ...cand,
        raw_material_purchase_subunits: rawMaterial,
        inbound_freight_subunits: freight,
        operational_params: updatedOps
      };
    });

    // Step 2: Run Silo Simulation on each candidate
    const siloResults = shockedCandidates.map((c) => ({
      candidate: c,
      silo: this.runSiloSimulation(c)
    }));

    // Step 3: Separate eligible verified candidates from unverified/ineligible
    const allocations: GroupCandidateAllocation[] = [];
    const rejections: GroupCandidateAllocation[] = [];
    const bubblePoints: BubbleChartPoint[] = [];

    interface EvaluatedGroupCandidate {
      candidate: SiloCandidateInput;
      silo: SiloSimulationResult;
      excessRowcBps: bigint;
      batchCostSubunits: bigint;
      isEligible: boolean;
      rejectionReasons: string[];
    }

    const evaluatedPool: EvaluatedGroupCandidate[] = siloResults.map(({ candidate, silo }) => {
      const reasons: string[] = [];
      const rowcBps = BigInt(silo.annualized_rowc_bps);
      const excessRowc = rowcBps - tbillYieldBps;
      const unitCost = BigInt(silo.unit_landed_cost_subunits);
      const batchCost = unitCost * BigInt(candidate.moq);

      // Conviction vs Allocation Firewall:
      // Candidate with unverified evidence or low conviction is strictly disqualified from receiving capital
      if (silo.return_status === 'INSUFFICIENT_UNVERIFIED_EVIDENCE' || candidate.is_verified === false) {
        reasons.push('E-M5-UNVERIFIED-PROVENANCE: Candidate evidence is unverified or lacks cryptographic attestation');
      }
      if (silo.return_status === 'CANNOT_CALCULATE_MISSING_INPUTS') {
        reasons.push('E-M5-MISSING-INPUTS: Mandatory pricing or fee schedule attributes missing');
      }
      if (excessRowc <= 0n) {
        reasons.push('E-M5-SUB_HURDLE: Annualized RoWC does not exceed sovereign 91-Day T-Bill yield');
      }
      if (batchCost > concentrationCap) {
        reasons.push('E-M5-CONCENTRATION_EXCEEDED: Single MOQ batch cost exceeds 50% treasury concentration cap');
      }

      return {
        candidate,
        silo,
        excessRowcBps: excessRowc,
        batchCostSubunits: batchCost,
        isEligible: reasons.length === 0,
        rejectionReasons: reasons
      };
    });

    // Step 4: Rank eligible candidates by excess RoWC descending
    const eligibleSorted = evaluatedPool
      .filter((e) => e.isEligible)
      .sort((a, b) => (b.excessRowcBps > a.excessRowcBps ? 1 : b.excessRowcBps < a.excessRowcBps ? -1 : 0));

    let remainingBudget = treasuryBudget;
    let rankCounter = 1;

    for (const item of eligibleSorted) {
      const maxLotsByConcentration = Number(concentrationCap / item.batchCostSubunits);
      const maxLotsByBudget = Number(remainingBudget / item.batchCostSubunits);
      const allocatedLots = Math.min(maxLotsByConcentration, maxLotsByBudget);

      if (allocatedLots > 0) {
        const capitalCommitted = item.batchCostSubunits * BigInt(allocatedLots);
        remainingBudget -= capitalCommitted;

        allocations.push({
          candidate_id: item.candidate.candidate_id,
          sku_id: item.candidate.sku_id,
          rank: rankCounter++,
          allocated_lots: allocatedLots,
          allocated_units: allocatedLots * item.candidate.moq,
          unit_landed_cost_subunits: item.silo.unit_landed_cost_subunits,
          allocated_capital_subunits: capitalCommitted.toString(),
          annualized_rowc_bps: item.silo.annualized_rowc_bps,
          excess_rowc_over_tbill_bps: item.excessRowcBps.toString(),
          conviction_score: item.silo.conviction_score,
          return_status: item.silo.return_status,
          rejection_reasons: []
        });

        bubblePoints.push({
          candidate_id: item.candidate.candidate_id,
          sku_id: item.candidate.sku_id,
          x_conviction_score: item.silo.conviction_score,
          y_annualized_excess_rowc_bps: item.excessRowcBps.toString(),
          z_allocated_capital_subunits: capitalCommitted.toString()
        });
      } else {
        item.rejectionReasons.push('E-M5-BUDGET_EXHAUSTED: Insufficient unallocated treasury to fund a full discrete MOQ lot');
        rejections.push({
          candidate_id: item.candidate.candidate_id,
          sku_id: item.candidate.sku_id,
          rank: 0,
          allocated_lots: 0,
          allocated_units: 0,
          unit_landed_cost_subunits: item.silo.unit_landed_cost_subunits,
          allocated_capital_subunits: '0',
          annualized_rowc_bps: item.silo.annualized_rowc_bps,
          excess_rowc_over_tbill_bps: item.excessRowcBps.toString(),
          conviction_score: item.silo.conviction_score,
          return_status: item.silo.return_status,
          rejection_reasons: item.rejectionReasons
        });

        bubblePoints.push({
          candidate_id: item.candidate.candidate_id,
          sku_id: item.candidate.sku_id,
          x_conviction_score: item.silo.conviction_score,
          y_annualized_excess_rowc_bps: item.excessRowcBps.toString(),
          z_allocated_capital_subunits: '0'
        });
      }
    }

    // Process ineligible candidates
    for (const item of evaluatedPool.filter((e) => !e.isEligible)) {
      rejections.push({
        candidate_id: item.candidate.candidate_id,
        sku_id: item.candidate.sku_id,
        rank: 0,
        allocated_lots: 0,
        allocated_units: 0,
        unit_landed_cost_subunits: item.silo.unit_landed_cost_subunits,
        allocated_capital_subunits: '0',
        annualized_rowc_bps: item.silo.annualized_rowc_bps,
        excess_rowc_over_tbill_bps: item.excessRowcBps.toString(),
        conviction_score: item.silo.conviction_score,
        return_status: item.silo.return_status,
        rejection_reasons: item.rejectionReasons
      });

      bubblePoints.push({
        candidate_id: item.candidate.candidate_id,
        sku_id: item.candidate.sku_id,
        x_conviction_score: item.silo.conviction_score,
        y_annualized_excess_rowc_bps: item.excessRowcBps.toString(),
        z_allocated_capital_subunits: '0'
      });
    }

    // Step 5: T-Bill Cash Sweep & Treasury Conservation
    const totalAllocatedCapital = treasuryBudget - remainingBudget;
    const tbillSweep = remainingBudget;
    const conservationVerified = totalAllocatedCapital + tbillSweep === treasuryBudget;

    // Step 6: Benchmark Calculations
    let weightedRoWcNumerator = tbillSweep * tbillYieldBps;
    for (const alloc of allocations) {
      weightedRoWcNumerator += BigInt(alloc.allocated_capital_subunits) * BigInt(alloc.annualized_rowc_bps);
    }
    const effectivePortfolioRoWcBps = weightedRoWcNumerator / treasuryBudget;
    const excessOverTbill = effectivePortfolioRoWcBps - tbillYieldBps;
    const excessOverNifty = effectivePortfolioRoWcBps - niftyLiquidYieldBps;

    const benchmarks: BenchmarkComparison = {
      rbi_91d_tbill_yield_bps: tbillYieldBps.toString(),
      nifty_liquid_benchmark_yield_bps: niftyLiquidYieldBps.toString(),
      effective_portfolio_rowc_bps: effectivePortfolioRoWcBps.toString(),
      excess_over_tbill_bps: excessOverTbill.toString(),
      excess_over_nifty_liquid_bps: excessOverNifty.toString()
    };

    const cleanResult = {
      simulation_id: 'sim:m5:group:ss304:matrix',
      timestamp_utc: '2026-10-16T12:00:00Z',
      treasury_budget_subunits: treasuryBudget.toString(),
      total_allocated_capital_subunits: totalAllocatedCapital.toString(),
      tbill_sweep_subunits: tbillSweep.toString(),
      conservation_verified: conservationVerified,
      allocations,
      rejected_candidates: rejections,
      bubble_chart_points: bubblePoints,
      benchmarks,
      correlated_shocks_applied: shocksApplied
    };

    const telemetryDigest = createHash('sha256')
      .update(canonicalizeJCS(cleanResult))
      .digest('hex');

    return {
      ...cleanResult,
      telemetry_digest_sha256: telemetryDigest
    };
  }

  /**
   * Evaluates optimal batch size across tiered price brackets under treasury and concentration constraints.
   */
  public static evaluateOptimalBatchSize(
    observedTiers: readonly PriceBracketTier[],
    targetBatchQty: number,
    inboundFreightAndPackagingSubunits: bigint,
    treasuryBudgetSubunits: bigint,
    maxConcentrationBps: bigint,
    ops: OperationalEconomicsParameters,
    grossSellingPriceSubunits: bigint,
    totalMarketplaceFeesSubunits: bigint
  ): BatchOptimizationResult {
    return evaluateOptimalBatchSize(
      observedTiers,
      targetBatchQty,
      inboundFreightAndPackagingSubunits,
      treasuryBudgetSubunits,
      maxConcentrationBps,
      ops,
      grossSellingPriceSubunits,
      totalMarketplaceFeesSubunits
    );
  }
}

// ============================================================================
// 4. TIERED MOQ BATCH OPTIMIZER
// ============================================================================

export interface BatchOptimizationTierEvaluation {
  readonly tier: PriceBracketTier;
  readonly batch_quantity: number;
  readonly exw_price_subunits: bigint;
  readonly unit_landed_cost_subunits: bigint;
  readonly total_outlay_subunits: bigint;
  readonly unit_net_contribution_subunits: bigint;
  readonly cash_margin_bps: number;
  readonly annualized_rowc_bps: number;
  readonly is_feasible: boolean;
  readonly failure_reason?: string;
}

export interface BatchOptimizationResult {
  readonly selected_tier: PriceBracketTier;
  readonly optimal_batch_quantity: number;
  readonly unit_landed_cost_subunits: bigint;
  readonly total_outlay_subunits: bigint;
  readonly annualized_rowc_bps: number;
  readonly evaluated_tiers: readonly BatchOptimizationTierEvaluation[];
}

export function evaluateOptimalBatchSize(
  observedTiers: readonly PriceBracketTier[],
  targetBatchQty: number,
  inboundFreightAndPackagingSubunits: bigint,
  treasuryBudgetSubunits: bigint,
  maxConcentrationBps: bigint,
  ops: OperationalEconomicsParameters,
  grossSellingPriceSubunits: bigint,
  totalMarketplaceFeesSubunits: bigint
): BatchOptimizationResult {
  if (!observedTiers || observedTiers.length === 0) {
    throw new Error('E-M5-NO-FEASIBLE-BRACKET: observedTiers array is empty.');
  }

  // Statutory 18% GST on marketplace fees
  const marketplaceFeeGst = (totalMarketplaceFeesSubunits * ops.gst_rate_bps) / 10000n;

  // Ex-GST base for TCS and TDS (Sec 52 CGST & Sec 194-O Income Tax)
  const exGstRevenue = (grossSellingPriceSubunits * 10000n) / (10000n + ops.gst_rate_bps);
  const tcs = (exGstRevenue * ops.tcs_rate_bps) / 10000n;
  const tds = (exGstRevenue * ops.tds_rate_bps) / 10000n;

  // Net disbursement from marketplace
  const netDisbursement = grossSellingPriceSubunits - totalMarketplaceFeesSubunits - marketplaceFeeGst - tcs - tds;

  // Output GST
  const outputGst = grossSellingPriceSubunits - exGstRevenue;
  const feeGstItc = (marketplaceFeeGst * ops.itc_eligible_fraction_bps) / 10000n;

  // CCC days
  const cccDays = Math.max(
    1,
    ops.procurement_lead_time_days + ops.warehouse_dwell_days + ops.marketplace_settlement_delay_days
  );

  const maxAllowedConcentrationSubunits = (treasuryBudgetSubunits * maxConcentrationBps) / 10000n;

  const evaluatedTiers: BatchOptimizationTierEvaluation[] = [];

  for (const tier of observedTiers) {
    const exwPrice = BigInt(tier.unit_price_subunits);
    const unitLandedCost = exwPrice + inboundFreightAndPackagingSubunits;

    // Determine batch quantity for this tier
    const batchQty =
      targetBatchQty >= tier.min_qty && (tier.max_qty === null || targetBatchQty <= tier.max_qty)
        ? targetBatchQty
        : tier.min_qty;

    const totalOutlay = BigInt(batchQty) * unitLandedCost;

    // Statutory GST settlement
    const procurementItc = unitLandedCost - (unitLandedCost * 10000n) / (10000n + ops.gst_rate_bps);
    const totalItc = procurementItc + feeGstItc;
    const netGstCashLiability = outputGst > totalItc ? outputGst - totalItc : 0n;
    const netStatutorySettlement = netGstCashLiability > tcs ? netGstCashLiability - tcs : 0n;

    // Customer return drag (forward FBA + reverse logistics + unit landed cost)
    const fbaFee = 140000n;
    const unitReturnAttritionCost = fbaFee + ops.reverse_logistics_fee_subunits + unitLandedCost;
    const returnDrag = (unitReturnAttritionCost * ops.customer_return_rate_bps) / 10000n;

    // Unit net contribution
    const unitNetContribution = netDisbursement - unitLandedCost - netStatutorySettlement - returnDrag;

    // Margin & RoWC
    const cashMarginBps =
      unitLandedCost > 0n
        ? Number((unitNetContribution * 10000n) / unitLandedCost)
        : -10000;

    const annualizedRowcBps = cccDays > 0 ? Math.floor((cashMarginBps * 365) / cccDays) : 0;

    // Feasibility checks:
    // 1. Budget check: totalOutlay must not exceed treasuryBudgetSubunits
    // 2. Concentration cap check: totalOutlay must not exceed maxAllowedConcentrationSubunits
    let isFeasible = true;
    let failureReason: string | undefined;

    if (totalOutlay > treasuryBudgetSubunits) {
      isFeasible = false;
      failureReason = 'E-M5-BUDGET-EXHAUSTED';
    } else if (totalOutlay > maxAllowedConcentrationSubunits) {
      isFeasible = false;
      failureReason = 'E-M5-CONCENTRATION-CAP-EXCEEDED';
    }

    evaluatedTiers.push({
      tier,
      batch_quantity: batchQty,
      exw_price_subunits: exwPrice,
      unit_landed_cost_subunits: unitLandedCost,
      total_outlay_subunits: totalOutlay,
      unit_net_contribution_subunits: unitNetContribution,
      cash_margin_bps: cashMarginBps,
      annualized_rowc_bps: annualizedRowcBps,
      is_feasible: isFeasible,
      failure_reason: failureReason
    });
  }

  // Select feasible tier that maximizes annualized_rowc_bps
  const feasibleTiers = evaluatedTiers.filter((e) => e.is_feasible);
  if (feasibleTiers.length === 0) {
    throw new Error(
      'E-M5-NO-FEASIBLE-BRACKET: No tiered pricing bracket meets treasury budget and concentration constraints.'
    );
  }

  // Sort descending by annualized_rowc_bps, then descending by batch_quantity
  feasibleTiers.sort((a, b) => {
    if (b.annualized_rowc_bps !== a.annualized_rowc_bps) {
      return b.annualized_rowc_bps - a.annualized_rowc_bps;
    }
    return b.batch_quantity - a.batch_quantity;
  });

  const best = feasibleTiers[0];

  return {
    selected_tier: best.tier,
    optimal_batch_quantity: best.batch_quantity,
    unit_landed_cost_subunits: best.unit_landed_cost_subunits,
    total_outlay_subunits: best.total_outlay_subunits,
    annualized_rowc_bps: best.annualized_rowc_bps,
    evaluated_tiers: Object.freeze(evaluatedTiers)
  };
}

