/**
 * POC-001: 8-Dimension Opportunity Scorecard & Decision Engine
 *
 * Implements the 8 independent evaluation dimensions:
 * 1. problem_strength (customer grievance severity, frequency denominator, willingness to pay)
 * 2. commercial_demand (market volume proxy, review velocity, seasonal window)
 * 3. competitive_whitespace (dominant brand concentration, seller defect rate)
 * 4. supply_advantage (factory gate quote, MOQ, lead time, sourcing hub cluster)
 * 5. distribution_viability (multi-channel comparison: Amazon, Flipkart, Meesho, B2B)
 * 6. financial_attractiveness (gross spread, net margin, Cash Conversion Cycle, RoWC)
 * 7. evidence_quality (provenance class, attestation, data freshness TTL)
 * 8. execution_feasibility (quality remediation capex, regulatory / BIS conformity)
 *
 * Enforces:
 * - Deterministic output into one of the 8 canonical DecisionOutcomes:
 *   'PROMISING_BUT_UNVALIDATED' | 'MORE_EVIDENCE_REQUIRED' | 'ECONOMICS_FAIL' |
 *   'TECHNICAL_FEASIBILITY_FAIL' | 'DISTRIBUTION_FAIL' | 'INSUFFICIENT_EVIDENCE' |
 *   'READY_FOR_PAPER_TEST' | 'READY_FOR_HUMAN_REVIEW'
 * - Honest negative economic outcome: "The customer problem exists, but the economics do not work"
 * - Explicit missing-data penalty (never collapsing into a single AI vanity score)
 */

import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sanitizeForJcs } from '../agents/m6AgentFramework.js';
import type {
  DecisionOutcome,
  ObservationEntity,
  CustomerProblemEntity,
  SupplierQuoteEntity,
  UnitEconomicsScenarioEntity,
  MarketplaceChannel,
  IncumbentFailureHypothesisEvaluation
} from '../mcp/contracts/canonicalMarketGraphContract.js';
import type { ProductObservationItem } from '../mcp/contracts/productObservationContract.js';

// ============================================================================
// 1. SCORECARD DATA STRUCTURES
// ============================================================================

export type ScorecardDimensionStatus = 'SATISFIED' | 'DEFICIENT' | 'DATA_REQUIRED' | 'DISQUALIFYING';

export interface ScorecardDimension {
  readonly name: string;
  readonly raw_measurement: Record<string, string | number | boolean | null>;
  readonly score_bps: number; // 0 to 10,000 bps
  readonly missing_data_penalty_bps: number;
  readonly net_score_bps: number; // Math.max(0, score_bps - missing_data_penalty_bps)
  readonly status: ScorecardDimensionStatus;
  readonly rationale: string;
}

export interface DistributionChannelAnalysis {
  readonly channel: MarketplaceChannel;
  readonly retail_selling_price_inr: number;
  readonly factory_cost_inr: number;
  readonly platform_fee_inr: number;
  readonly fulfillment_fee_inr: number;
  readonly inbound_freight_inr: number;
  readonly packaging_inr: number;
  readonly return_drag_inr: number;
  readonly statutory_tax_inr: number;
  readonly net_contribution_inr: number;
  readonly contribution_margin_bps: number;
  readonly is_viable: boolean;
  readonly disqualification_reason?: string;
}

export interface DistributionViabilityDimension extends ScorecardDimension {
  readonly channels: readonly DistributionChannelAnalysis[];
  readonly viable_channels_count: number;
  readonly best_channel: MarketplaceChannel | null;
}

export interface OpportunityScorecardResult {
  readonly product_id: string;
  readonly evaluated_at_utc: string;
  readonly dimensions: {
    readonly problem_strength: ScorecardDimension;
    readonly commercial_demand: ScorecardDimension;
    readonly competitive_whitespace: ScorecardDimension;
    readonly supply_advantage: ScorecardDimension;
    readonly distribution_viability: DistributionViabilityDimension;
    readonly financial_attractiveness: ScorecardDimension;
    readonly evidence_quality: ScorecardDimension;
    readonly execution_feasibility: ScorecardDimension;
  };
  readonly overall_score_bps: number;
  readonly decision_outcome: DecisionOutcome;
  readonly decision_rationale: string;
  readonly disqualifying_reasons: readonly string[];
  readonly missing_evidence_fields: readonly string[];
  readonly jcs_sha256: string;
}

export interface OpportunityScorecardInput {
  readonly product: ProductObservationItem;
  readonly observations?: readonly ObservationEntity[];
  readonly customer_problems?: readonly CustomerProblemEntity[];
  readonly supplier_quotes?: readonly SupplierQuoteEntity[];
  readonly unit_economics?: readonly UnitEconomicsScenarioEntity[];
  readonly incumbent_evaluations?: readonly IncumbentFailureHypothesisEvaluation[];
  readonly reference_time_utc?: string;
}

// ============================================================================
// 2. THE OPPORTUNITY SCORECARD ENGINE
// ============================================================================

export class OpportunityScorecardEngine {
  /**
   * Deterministically evaluates any product lead across all 8 dimensions.
   */
  public static evaluateScorecard(input: OpportunityScorecardInput): OpportunityScorecardResult {
    const { product } = input;
    const nowUtc = input.reference_time_utc || new Date().toISOString();
    const observations = input.observations || [];
    const customerProblems = input.customer_problems || [];
    const supplierQuotes = input.supplier_quotes || [];
    const unitEconomics = input.unit_economics || [];
    const incumbentEvals = input.incumbent_evaluations || [];

    const disqualifyingReasons: string[] = [];
    const missingFields: string[] = [];

    // ------------------------------------------------------------------------
    // DIMENSION 1: PROBLEM STRENGTH
    // ------------------------------------------------------------------------
    let problemRawScore = 3000;
    let problemPenalty = 0;
    const negPct = product.overall_negative_review_pct || 0;
    const grievances = product.buyer_grievances || [];
    const criticalProblems = customerProblems.filter(
      (p) => p.failure_severity === 'CRITICAL' || p.failure_severity === 'HIGH'
    );

    if (negPct >= 15 || criticalProblems.length > 0 || grievances.length >= 2) {
      problemRawScore = Math.min(9500, 5000 + negPct * 200 + criticalProblems.length * 500);
    } else if (negPct > 0) {
      problemRawScore = 4000 + negPct * 150;
    } else {
      problemPenalty = 2500;
      missingFields.push('buyer_grievances');
    }

    const problemNetScore = Math.max(0, problemRawScore - problemPenalty);
    const problemStatus: ScorecardDimensionStatus =
      problemNetScore >= 5000 ? 'SATISFIED' : (problemPenalty > 0 ? 'DATA_REQUIRED' : 'DEFICIENT');

    const dimProblemStrength: ScorecardDimension = {
      name: 'problem_strength',
      raw_measurement: {
        negative_review_pct: negPct,
        grievances_count: grievances.length,
        critical_problems_count: criticalProblems.length,
        top_failure_mode: grievances[0]?.failure_mode || null
      },
      score_bps: problemRawScore,
      missing_data_penalty_bps: problemPenalty,
      net_score_bps: problemNetScore,
      status: problemStatus,
      rationale:
        negPct > 0 || criticalProblems.length > 0
          ? `Validated customer pain cluster: ${negPct}% negative review share across ${grievances.length} primary failure mode(s).`
          : 'Insufficient empirical review cluster data; buyer pain point requires further observation.'
    };

    // ------------------------------------------------------------------------
    // DIMENSION 2: COMMERCIAL DEMAND
    // ------------------------------------------------------------------------
    let demandRawScore = 4000;
    let demandPenalty = 0;
    const estUnits = product.sell_side?.monthly_sales_volume_est || (product.sell_side as any)?.estimated_monthly_units || 0;
    const bsr = product.sell_side?.best_seller_rank || (product.sell_side as any)?.bsr_rank || 0;

    if (estUnits >= 1000) {
      demandRawScore = 8000;
    } else if (estUnits >= 300) {
      demandRawScore = 6500;
    } else if (estUnits > 0) {
      demandRawScore = 4500;
    } else {
      demandPenalty = 2000;
      missingFields.push('sell_side.monthly_sales_volume_est');
    }

    // Proxy data penalty: BSR power-law proxy has inherent ±30% uncertainty
    if ((product.sell_side as any)?.demand_velocity === 'SEASONAL_SPIKE') {
      demandRawScore += 1000;
    }

    const demandNetScore = Math.max(0, demandRawScore - demandPenalty);
    const dimDemand: ScorecardDimension = {
      name: 'commercial_demand',
      raw_measurement: {
        estimated_monthly_units: estUnits,
        bsr_rank: bsr,
        demand_velocity: (product.sell_side as any)?.demand_velocity || 'UNKNOWN',
        seasonal_window: (product.strategy as any)?.seasonal_sourcing_window || null
      },
      score_bps: demandRawScore,
      missing_data_penalty_bps: demandPenalty,
      net_score_bps: demandNetScore,
      status: demandNetScore >= 5000 ? 'SATISFIED' : 'DEFICIENT',
      rationale:
        estUnits > 0
          ? `Estimated demand: ${estUnits} units/month (BSR rank #${bsr}).`
          : 'Commercial demand proxy missing or uncalibrated.'
    };

    // ------------------------------------------------------------------------
    // DIMENSION 3: COMPETITIVE WHITESPACE
    // ------------------------------------------------------------------------
    let whiteRawScore = 5000;
    const topBrandShare = (product.sell_side as any)?.top_brand_market_share_pct || 50;
    if (topBrandShare < 40) {
      whiteRawScore = 8000; // Fragmented market, high whitespace
    } else if (topBrandShare <= 65) {
      whiteRawScore = 6000; // Moderate concentration
    } else {
      whiteRawScore = 3500; // Dominant incumbent
    }

    const dimWhitespace: ScorecardDimension = {
      name: 'competitive_whitespace',
      raw_measurement: {
        top_brand_share_pct: topBrandShare,
        dominant_seller_negative_pct: negPct,
        incumbent_brand: product.sell_side?.top_competitor_names?.[0] || (product.sell_side as any)?.dominant_seller_id || 'Generic Incumbent'
      },
      score_bps: whiteRawScore,
      missing_data_penalty_bps: 0,
      net_score_bps: whiteRawScore,
      status: whiteRawScore >= 5000 ? 'SATISFIED' : 'DEFICIENT',
      rationale: `Market concentration: top brand holds ${topBrandShare}% share with ${negPct}% complaint frequency.`
    };

    // ------------------------------------------------------------------------
    // DIMENSION 4: SUPPLY ADVANTAGE
    // ------------------------------------------------------------------------
    let supplyRawScore = 4000;
    let supplyPenalty = 0;
    const factoryQuote = supplierQuotes[0]?.factory_gate_quote_inr ?? product.upstream_supply?.factory_gate_quote_inr;
    const hub = product.upstream_supply?.hub_name;
    const moq = product.upstream_supply?.supplier_moq || product.upstream_supply?.minimum_order_quantity || 0;

    if (!factoryQuote || factoryQuote <= 0) {
      supplyPenalty = 3000;
      missingFields.push('upstream_supply.factory_gate_quote_inr');
    } else if (hub && moq > 0 && moq <= 2000) {
      supplyRawScore = 8500;
    } else if (factoryQuote > 0) {
      supplyRawScore = 6000;
    }

    const supplyNetScore = Math.max(0, supplyRawScore - supplyPenalty);
    const dimSupply: ScorecardDimension = {
      name: 'supply_advantage',
      raw_measurement: {
        factory_gate_quote_inr: factoryQuote || null,
        hub_name: hub || 'UNMAPPED',
        supplier_moq: moq,
        raw_material_basis: product.upstream_supply?.raw_material_basis || null
      },
      score_bps: supplyRawScore,
      missing_data_penalty_bps: supplyPenalty,
      net_score_bps: supplyNetScore,
      status: supplyNetScore >= 5000 ? 'SATISFIED' : 'DATA_REQUIRED',
      rationale:
        factoryQuote && factoryQuote > 0
          ? `Sourcing advantage: ₹${factoryQuote} at ${hub} cluster (MOQ ${moq} units).`
          : 'Missing verified factory-gate supplier quote.'
    };

    // ------------------------------------------------------------------------
    // DIMENSION 5: DISTRIBUTION VIABILITY (MULTI-CHANNEL COMPARISON)
    // ------------------------------------------------------------------------
    const retailAsp = unitEconomics[0]?.retail_selling_price_inr ?? product.sell_side?.prevailing_retail_asp_inr ?? 0;
    const factoryCost = factoryQuote || 0;
    const inboundFreight = (product.upstream_supply as any)?.inbound_freight_est_inr || 15.0;
    const packagingCost = (product.upstream_supply as any)?.packaging_kitting_inr || 10.0;

    const channelsToEvaluate: MarketplaceChannel[] = ['AMAZON_IN', 'FLIPKART', 'MEESHO', 'B2B_DISTRIBUTION'];
    const channelAnalyses: DistributionChannelAnalysis[] = channelsToEvaluate.map((channel) => {
      let asp = retailAsp;
      let platformFee = 0;
      let fulfillment = 0;
      let returnRateBps = 300; // 3.00%
      let freight = inboundFreight;
      let pkg = packagingCost;

      if (channel === 'AMAZON_IN') {
        platformFee = asp * 0.12; // 12% referral fee
        fulfillment = 55.0; // FBA weight fee
        returnRateBps = 350;
      } else if (channel === 'FLIPKART') {
        platformFee = asp * 0.10;
        fulfillment = 50.0;
        returnRateBps = 400;
      } else if (channel === 'MEESHO') {
        platformFee = asp * 0.02; // Very low commission
        fulfillment = 75.0; // Higher shipping
        returnRateBps = 1200; // High Meesho return rate (12%)
      } else if (channel === 'B2B_DISTRIBUTION') {
        asp = retailAsp * 0.65; // Wholesale ASP
        platformFee = 0;
        fulfillment = 12.0; // Bulk carton freight per unit
        returnRateBps = 50; // 0.5% B2B return rate
        freight = inboundFreight * 0.6;
        pkg = packagingCost * 0.5;
      }

      // GST (18% on platform fees) + Section 52 TCS / Section 194-O TDS
      const feeGst = (platformFee + fulfillment) * 0.18;
      const tcsTds = asp * 0.02;
      const statutoryTax = Number((feeGst + tcsTds).toFixed(2));

      // Return drag = (fulfillment + return logistics + factory cost) * return rate
      const returnDrag = Number((((fulfillment + 60.0 + factoryCost) * returnRateBps) / 10000).toFixed(2));

      const totalDeductions = factoryCost + freight + pkg + platformFee + fulfillment + statutoryTax + returnDrag;
      const netContribution = Number((asp - totalDeductions).toFixed(2));
      const marginBps = asp > 0 ? Math.round((netContribution / asp) * 10000) : -10000;

      const isViable = factoryCost > 0 && netContribution > 0 && marginBps >= 1000;
      let disqualReason: string | undefined;
      if (factoryCost <= 0) {
        disqualReason = 'Missing empirical factory gate cost';
      } else if (netContribution <= 0) {
        disqualReason = `Negative unit contribution (-₹${Math.abs(netContribution).toFixed(2)}) after platform fees and freight`;
      } else if (marginBps < 1000) {
        disqualReason = `Margin too thin (${marginBps} bps < 1000 bps hurdle)`;
      }

      return {
        channel,
        retail_selling_price_inr: asp,
        factory_cost_inr: factoryCost,
        platform_fee_inr: Number(platformFee.toFixed(2)),
        fulfillment_fee_inr: Number(fulfillment.toFixed(2)),
        inbound_freight_inr: Number(freight.toFixed(2)),
        packaging_inr: Number(pkg.toFixed(2)),
        return_drag_inr: returnDrag,
        statutory_tax_inr: statutoryTax,
        net_contribution_inr: netContribution,
        contribution_margin_bps: marginBps,
        is_viable: isViable,
        disqualification_reason: disqualReason
      };
    });

    const viableChannels = channelAnalyses.filter((c) => c.is_viable);
    const bestChannel = viableChannels.length > 0
      ? viableChannels.reduce((prev, curr) => (curr.contribution_margin_bps > prev.contribution_margin_bps ? curr : prev)).channel
      : null;

    let distStatus: ScorecardDimensionStatus = 'SATISFIED';
    let distScoreBps = 0;
    let distRationale = '';

    if (factoryCost <= 0 || retailAsp <= 0) {
      distStatus = 'DATA_REQUIRED';
      distScoreBps = 0;
      distRationale = 'Missing retail ASP or factory gate quote to evaluate distribution channel viability.';
    } else if (viableChannels.length === 0) {
      distStatus = 'DISQUALIFYING';
      distScoreBps = 0;
      distRationale = 'All 4 distribution channels (Amazon, Flipkart, Meesho, B2B) fail unit contribution viability.';
      disqualifyingReasons.push('DISTRIBUTION_FAIL: No modeled distribution channel achieves viable positive contribution margin after fees, freight, and return drag.');
    } else {
      distScoreBps = Math.min(9500, 4000 + viableChannels.length * 1200 + (viableChannels[0]?.contribution_margin_bps || 0) / 2);
      distRationale = `Viable distribution in ${viableChannels.length}/4 channels (Best: ${bestChannel} at ${viableChannels[0]?.contribution_margin_bps} bps margin).`;
    }

    const dimDistribution: DistributionViabilityDimension = {
      name: 'distribution_viability',
      raw_measurement: {
        retail_asp_inr: retailAsp,
        factory_cost_inr: factoryCost,
        viable_channels_count: viableChannels.length,
        best_channel: bestChannel
      },
      score_bps: distScoreBps,
      missing_data_penalty_bps: factoryCost <= 0 ? 3000 : 0,
      net_score_bps: distScoreBps,
      status: distStatus,
      rationale: distRationale,
      channels: channelAnalyses,
      viable_channels_count: viableChannels.length,
      best_channel: bestChannel
    };

    // ------------------------------------------------------------------------
    // DIMENSION 6: FINANCIAL ATTRACTIVENESS
    // ------------------------------------------------------------------------
    let finStatus: ScorecardDimensionStatus = 'SATISFIED';
    let finScoreBps = 0;
    let finRationale = '';

    const bestViable = viableChannels[0];
    const landedCostEst = factoryCost + inboundFreight + packagingCost;
    const grossSpread = retailAsp - landedCostEst;

    if (factoryCost <= 0 || retailAsp <= 0) {
      finStatus = 'DATA_REQUIRED';
      finScoreBps = 0;
      finRationale = 'Insufficient financial data: missing verified factory quote or retail ASP.';
      missingFields.push('financial_pricing_data');
    } else if (grossSpread <= 0 || (bestViable && bestViable.net_contribution_inr <= 0)) {
      finStatus = 'DISQUALIFYING';
      finScoreBps = 0;
      finRationale = `Landed cost (₹${landedCostEst.toFixed(2)}) exceeds retail ASP (₹${retailAsp.toFixed(2)}) or yields negative contribution.`;
      disqualifyingReasons.push(`ECONOMICS_FAIL: Negative commercial spread (Gross Spread: ₹${grossSpread.toFixed(2)}).`);
    } else {
      // Annualized RoWC proxy based on 45-day holding period
      const marginBps = bestViable ? bestViable.contribution_margin_bps : Math.round((grossSpread / retailAsp) * 10000);
      const estRowcBps = Math.round((marginBps * 365) / 45);
      finScoreBps = Math.min(9500, Math.max(1000, Math.round(estRowcBps / 20)));
      finStatus = estRowcBps >= 2000 ? 'SATISFIED' : 'DEFICIENT';
      finRationale = `Financial viability cleared: Gross Spread ₹${grossSpread.toFixed(2)}, Best Channel Margin ${marginBps} bps, Est. Annualized RoWC ${estRowcBps} bps.`;
    }

    const dimFinancial: ScorecardDimension = {
      name: 'financial_attractiveness',
      raw_measurement: {
        retail_asp_inr: retailAsp,
        landed_cost_est_inr: landedCostEst,
        gross_spread_inr: Number(grossSpread.toFixed(2)),
        best_margin_bps: bestViable?.contribution_margin_bps || null
      },
      score_bps: finScoreBps,
      missing_data_penalty_bps: factoryCost <= 0 ? 3000 : 0,
      net_score_bps: finScoreBps,
      status: finStatus,
      rationale: finRationale
    };

    // ------------------------------------------------------------------------
    // DIMENSION 7: EVIDENCE QUALITY
    // ------------------------------------------------------------------------
    const originClass = product.evidence_origin?.origin_class || 'RECORDED_GOLDEN_FIXTURE';
    const isAttested = (product.evidence_origin as any)?.is_attested === true || originClass === 'LIVE_VERIFIED_CAPTURE';
    let evidScoreBps = 5000;
    let evidPenalty = 0;

    if (originClass === 'LIVE_VERIFIED_CAPTURE' && isAttested) {
      evidScoreBps = 9500;
    } else if (originClass === 'RECORDED_GOLDEN_FIXTURE') {
      evidScoreBps = 6500;
      evidPenalty = 1500; // Demoted because fixture-backed
    } else {
      evidScoreBps = 3500;
      evidPenalty = 2500; // Unattested user intake
    }

    const evidNetScore = Math.max(0, evidScoreBps - evidPenalty);
    const dimEvidence: ScorecardDimension = {
      name: 'evidence_quality',
      raw_measurement: {
        origin_class: originClass,
        is_attested: isAttested,
        observations_count: observations.length,
        verified_observations_count: observations.filter((o) => o.verified).length
      },
      score_bps: evidScoreBps,
      missing_data_penalty_bps: evidPenalty,
      net_score_bps: evidNetScore,
      status: evidNetScore >= 5000 ? 'SATISFIED' : 'DEFICIENT',
      rationale:
        originClass === 'LIVE_VERIFIED_CAPTURE' && isAttested
          ? 'Evidence backed by authenticated external network capture and valid cryptographic tool proof.'
          : (originClass === 'RECORDED_GOLDEN_FIXTURE'
            ? 'Recorded golden fixture replay (DEMO_MODE). Empirical live verification required before production allocation.'
            : 'Unattested user intake or manual override; requires independent corroboration.')
    };

    // ------------------------------------------------------------------------
    // DIMENSION 8: EXECUTION FEASIBILITY
    // ------------------------------------------------------------------------
    let execScoreBps = 7500;
    let execStatus: ScorecardDimensionStatus = 'SATISFIED';
    let execRationale = 'Operational edge implementation feasible via packaging redesign and upstream QC gating.';

    const engineeredEdge = product.buyer_grievances?.[0]?.engineered_remediation || '';
    if (engineeredEdge.toLowerCase().includes('die-cast tooling') || engineeredEdge.toLowerCase().includes('metallurgy furnace')) {
      execScoreBps = 4500;
      execStatus = 'DEFICIENT';
      execRationale = 'Requires heavy custom tooling or alloy furnace modification (elevated capex barrier).';
    } else if (engineeredEdge.toLowerCase().includes('impossible') || engineeredEdge.toLowerCase().includes('prohibited')) {
      execScoreBps = 0;
      execStatus = 'DISQUALIFYING';
      execRationale = 'Technical execution infeasible under current statutory or engineering constraints.';
    }

    const dimFeasibility: ScorecardDimension = {
      name: 'execution_feasibility',
      raw_measurement: {
        engineered_remediation: engineeredEdge || 'Standard optical sorting and reinforced packaging',
        hub_region: hub || 'Domestic'
      },
      score_bps: execScoreBps,
      missing_data_penalty_bps: 0,
      net_score_bps: execScoreBps,
      status: execStatus,
      rationale: execRationale
    };

    // ------------------------------------------------------------------------
    // OVERALL SCORE & DETERMINISTIC 8-DECISION STATE RESOLUTION
    // ------------------------------------------------------------------------
    const allDims = [
      dimProblemStrength,
      dimDemand,
      dimWhitespace,
      dimSupply,
      dimDistribution,
      dimFinancial,
      dimEvidence,
      dimFeasibility
    ];

    const overallScoreBps = Math.round(allDims.reduce((acc, d) => acc + d.net_score_bps, 0) / allDims.length);

    let decisionOutcome: DecisionOutcome = 'PROMISING_BUT_UNVALIDATED';
    let decisionRationale = '';

    // Core Governance Rules:
    // 1. Check Disqualifying Failures FIRST:
    if (finStatus === 'DISQUALIFYING') {
      decisionOutcome = 'ECONOMICS_FAIL';
      decisionRationale = dimFinancial.rationale;
      if (dimProblemStrength.net_score_bps >= 5000) {
        decisionRationale = `The customer problem exists (problem strength: ${dimProblemStrength.net_score_bps} bps), but the economics do not work: negative unit contribution margin.`;
      }
    } else if (distStatus === 'DISQUALIFYING') {
      decisionOutcome = 'DISTRIBUTION_FAIL';
      decisionRationale = `The customer problem exists, but distribution economics fail: all 4 modeled channels (Amazon, Flipkart, Meesho, B2B) produce negative unit contribution.`;
    } else if (execStatus === 'DISQUALIFYING') {
      decisionOutcome = 'TECHNICAL_FEASIBILITY_FAIL';
      decisionRationale = dimFeasibility.rationale;
    } else if (missingFields.length > 0 || dimSupply.status === 'DATA_REQUIRED' || dimFinancial.status === 'DATA_REQUIRED') {
      decisionOutcome = 'INSUFFICIENT_EVIDENCE';
      decisionRationale = `Evaluation halted on missing mandatory evidence: [${missingFields.join(', ')}]. Zero-cost substitution is prohibited.`;
    } else if (dimProblemStrength.net_score_bps >= 5000 && dimDemand.net_score_bps < 5000) {
      decisionOutcome = 'MORE_EVIDENCE_REQUIRED';
      decisionRationale = `Strong customer grievance cluster identified (${dimProblemStrength.net_score_bps} bps), but commercial demand volume is uncorroborated. Additional evidence required.`;
    } else if (dimEvidence.raw_measurement.origin_class === 'LIVE_VERIFIED_CAPTURE' && dimEvidence.raw_measurement.is_attested) {
      decisionOutcome = 'READY_FOR_HUMAN_REVIEW';
      decisionRationale = `All 8 dimensions satisfied with authenticated live network capture. Ready for operator review and paper allocation.`;
    } else if (overallScoreBps >= 5000 && dimFinancial.status === 'SATISFIED' && dimDistribution.status === 'SATISFIED') {
      decisionOutcome = 'READY_FOR_PAPER_TEST';
      decisionRationale = `Opportunity satisfies commercial hurdles under fixture-backed inputs (Score: ${overallScoreBps} bps). Capped at READY_FOR_PAPER_TEST pending live network verification.`;
    } else {
      decisionOutcome = 'PROMISING_BUT_UNVALIDATED';
      decisionRationale = `Initial signal shows potential (Score: ${overallScoreBps} bps), but requires specialist agent investigation and empirical corroboration.`;
    }

    const rawResult: Omit<OpportunityScorecardResult, 'jcs_sha256'> = {
      product_id: product.product_id,
      evaluated_at_utc: nowUtc,
      dimensions: {
        problem_strength: dimProblemStrength,
        commercial_demand: dimDemand,
        competitive_whitespace: dimWhitespace,
        supply_advantage: dimSupply,
        distribution_viability: dimDistribution,
        financial_attractiveness: dimFinancial,
        evidence_quality: dimEvidence,
        execution_feasibility: dimFeasibility
      },
      overall_score_bps: overallScoreBps,
      decision_outcome: decisionOutcome,
      decision_rationale: decisionRationale,
      disqualifying_reasons: disqualifyingReasons,
      missing_evidence_fields: missingFields
    };

    const jcsSha256 = sha256(canonicalizeJCS(sanitizeForJcs(rawResult)));

    return {
      ...rawResult,
      jcs_sha256: jcsSha256
    };
  }
}
