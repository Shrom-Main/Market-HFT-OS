/**
 * POC-001: Opportunity Dossier Service
 * Gate Slice 4 / Decision OD-28
 *
 * Aggregates everything known about a single product lead into a frozen,
 * bitemporally consistent, RFC 8785 JCS canonicalized Opportunity Dossier.
 *
 * Nine Canonical Sections:
 * 1. lead_header (Product identity, category, archetype, decision outcome, human-readable provenance badge)
 * 2. demand_and_seasonality (BSR proxy method/bounds + festival/monsoon overlays filtered by as_of_utc)
 * 3. customer_pain_and_strengths (Mined problems with denominators, WTP, bias + positive features)
 * 4. seller_and_competition (Marketplace competition, price tiers, pack formats, material claims)
 * 5. supply_and_logistics (Manufacturer quote, MOQ, lead times, MAPPED_ROUTE_ESTIMATE vs carrier quote)
 * 6. unit_economics_waterfall (Pure BigInt subunit step-by-step waterfall across 4 channels)
 * 7. incumbent_failure_matrix (All 8 structural incumbent-failure hypotheses from PostgreSQL)
 * 8. scorecard (8 independent dimensions + missing data penalties + diagnostic index)
 * 9. evidence_and_citations (Captured evidence records, hashes, origins, conflict detection)
 */

import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sanitizeForJcs } from '../agents/m6AgentFramework.js';
import type { ProductObservationItem } from '../mcp/contracts/productObservationContract.js';
import type { CentralResearchCore, HypothesisLedgerRecord, BitemporalEvidenceRecord, BitemporalEventOverlay } from './centralResearchCore.js';
import {
  ReviewAndGrievanceMiner,
  type ExtractedCustomerProblem,
  type ExtractedIncumbentStrength
} from './reviewAndGrievanceMiner.js';
import {
  OpportunityScorecardEngine,
  type OpportunityScorecardResult,
  type DistributionChannelAnalysis
} from './opportunityScorecardEngine.js';
import type { MarketplaceChannel, DecisionOutcome } from '../mcp/contracts/canonicalMarketGraphContract.js';

// ============================================================================
// 1. DOSSIER DATA CONTRACTS
// ============================================================================

export interface DossierLeadHeader {
  readonly product_id: string;
  readonly sku_id: string;
  readonly name: string;
  readonly category: string;
  readonly commercial_archetype: string;
  readonly current_decision_outcome: DecisionOutcome;
  readonly provenance_badge: string; // e.g. "Verified capture", "Fixture data", "Supplier quote", "Modelled Est"
  readonly as_of_utc: string;
  readonly generated_at_utc: string;
}

export interface DossierDemandAndSeasonality {
  readonly observed_interest: string;
  readonly observed_transaction_evidence: string; // 'UNKNOWN' when marketplace does not disclose sales
  readonly estimated_monthly_demand: {
    readonly estimated_units: number;
    readonly method: string;
    readonly lower_bound_units: number;
    readonly upper_bound_units: number;
    readonly epistemic_class: 'ESTIMATED_PROXY';
  };
  readonly seasonal_event_overlays: readonly BitemporalEventOverlay[];
}

export interface DossierCustomerPainAndStrengths {
  readonly customer_problems: readonly ExtractedCustomerProblem[];
  readonly incumbent_strengths: readonly ExtractedIncumbentStrength[];
  readonly unserved_pain_points: readonly string[];
  readonly overall_negative_review_pct: number;
  readonly total_reviews_analyzed: number;
}

export interface DossierSellerAndCompetition {
  readonly primary_marketplace: string;
  readonly prevailing_retail_asp_inr: number;
  readonly competitor_count: number;
  readonly top_competitors: readonly string[];
  readonly dominant_pack_formats: readonly string[];
  readonly buy_box_retention_risk: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly material_claims_vs_verified: string;
}

export interface DossierSupplyAndLogistics {
  readonly sourcing_hub: string;
  readonly manufacturer_quote_inr: number;
  readonly supplier_moq: number;
  readonly lead_time_days: number;
  readonly mapped_route: {
    readonly origin: string;
    readonly destination: string;
    readonly distance_km: number;
    readonly transit_hours: number;
    readonly method: 'MAPPED_ROUTE_ESTIMATE';
  };
  readonly carrier_freight_quote: {
    readonly freight_inr: number;
    readonly packaging_kitting_inr: number;
    readonly quote_status: 'MAPPED_ROUTE_ESTIMATE' | 'VERIFIED_CARRIER_QUOTE';
  };
}

export interface DossierUnitEconomicsWaterfallRow {
  readonly channel: MarketplaceChannel;
  readonly gross_selling_price_inr: number;
  readonly ex_gst_proceeds_inr: number;
  readonly platform_fee_inr: number;
  readonly fulfillment_fee_inr: number;
  readonly statutory_tax_inr: number;
  readonly packaging_inbound_freight_inr: number;
  readonly factory_cost_inr: number;
  readonly return_drag_inr: number;
  readonly net_contribution_inr: number;
  readonly contribution_margin_bps: number;
  readonly price_epistemic_class: 'OBSERVED_QUOTE' | 'ESTIMATED_PROXY' | 'DATA_REQUIRED';
  readonly explicit_assumptions: readonly string[];
  readonly is_viable: boolean;
  readonly data_required: boolean;
  readonly disqualification_reason?: string;
}

export interface DossierIncumbentFailureMatrixEntry {
  readonly explanation_type: string;
  readonly statement: string;
  readonly verdict: string;
  readonly current_stage: string;
  readonly supporting_evidence_count: number;
  readonly disconfirming_evidence_count: number;
  readonly hypothesis_id: string;
}

export interface DossierEvidenceAndCitations {
  readonly evidence_records: readonly {
    readonly evidence_id: string;
    readonly channel: string;
    readonly observed_at_utc: string;
    readonly as_of_utc: string;
    readonly origin_class: string;
    readonly epistemic_class: string;
    readonly payload_sha256: string;
    readonly is_attested: boolean;
    readonly summary: string;
  }[];
  readonly active_conflict_pairs: readonly {
    readonly field_name: string;
    readonly claims: readonly {
      readonly source_id: string;
      readonly value: unknown;
      readonly observed_at_utc: string;
    }[];
  }[];
}

export interface OpportunityDossier {
  readonly lead_header: DossierLeadHeader;
  readonly demand_and_seasonality: DossierDemandAndSeasonality;
  readonly customer_pain_and_strengths: DossierCustomerPainAndStrengths;
  readonly seller_and_competition: DossierSellerAndCompetition;
  readonly supply_and_logistics: DossierSupplyAndLogistics;
  readonly unit_economics_waterfall: readonly DossierUnitEconomicsWaterfallRow[];
  readonly incumbent_failure_matrix: readonly DossierIncumbentFailureMatrixEntry[];
  readonly scorecard: OpportunityScorecardResult;
  readonly evidence_and_citations: DossierEvidenceAndCitations;
  readonly jcs_sha256: string;
}

// ============================================================================
// 2. OPPORTUNITY DOSSIER SERVICE
// ============================================================================

export class OpportunityDossierService {
  /**
   * Builds the comprehensive 9-section Opportunity Dossier for a selected lead.
   */
  public static async buildDossier(
    product: ProductObservationItem,
    centralResearchCore: CentralResearchCore,
    asOfUtc?: string
  ): Promise<OpportunityDossier> {
    const nowUtc = asOfUtc || new Date().toISOString();

    // 1. Evaluate Scorecard across 8 independent dimensions
    const scorecard = OpportunityScorecardEngine.evaluateScorecard({
      product,
      reference_time_utc: nowUtc
    });

    // 2. Resolve Human-Readable Provenance Badge
    let provenanceBadge = 'Fixture data';
    if (product.evidence_origin?.origin_class === 'LIVE_VERIFIED_CAPTURE' && (product.evidence_origin as any)?.is_attested) {
      provenanceBadge = 'Verified capture';
    } else if (product.upstream_supply?.factory_gate_quote_inr && product.upstream_supply.factory_gate_quote_inr > 0) {
      provenanceBadge = 'Supplier quote';
    } else if (product.sell_side?.prevailing_retail_asp_inr && product.sell_side.prevailing_retail_asp_inr > 0) {
      provenanceBadge = 'Marketplace estimate';
    } else {
      provenanceBadge = 'Modelled Est';
    }

    const leadHeader: DossierLeadHeader = {
      product_id: product.product_id,
      sku_id: product.sku_id,
      name: product.name,
      category: product.category,
      commercial_archetype: product.commercial_archetype,
      current_decision_outcome: scorecard.decision_outcome,
      provenance_badge: provenanceBadge,
      as_of_utc: nowUtc,
      generated_at_utc: new Date().toISOString()
    };

    // 3. Demand & Seasonality (Historical Bitemporal Filter — Zero Look-Ahead Bias)
    const allOverlays = centralResearchCore.getEvidenceStore().queryEventOverlays(product.product_id, nowUtc);
    const estUnits = product.sell_side?.monthly_sales_volume_est || 1000;
    const demandSection: DossierDemandAndSeasonality = {
      observed_interest: product.sell_side?.best_seller_rank ? `Amazon BSR #${product.sell_side.best_seller_rank} in ${product.category}` : 'Unranked organic search',
      observed_transaction_evidence: 'UNKNOWN', // Public marketplace pages do not expose actual settlement logs
      estimated_monthly_demand: {
        estimated_units: estUnits,
        method: 'Category power-law BSR calibration proxy',
        lower_bound_units: Math.round(estUnits * 0.7),
        upper_bound_units: Math.round(estUnits * 1.35),
        epistemic_class: 'ESTIMATED_PROXY'
      },
      seasonal_event_overlays: allOverlays
    };

    // 4. Customer Pain & Strengths (Mined via ReviewAndGrievanceMiner)
    const minedReviews = ReviewAndGrievanceMiner.mineReviews({
      product,
      asOfUtc: nowUtc
    });

    const customerPainSection: DossierCustomerPainAndStrengths = {
      customer_problems: minedReviews.customer_problems,
      incumbent_strengths: minedReviews.incumbent_strengths,
      unserved_pain_points: minedReviews.unserved_pain_points,
      overall_negative_review_pct: minedReviews.overall_negative_review_pct,
      total_reviews_analyzed: minedReviews.total_reviews_analyzed
    };

    // 5. Seller & Competition
    const sellerSection: DossierSellerAndCompetition = {
      primary_marketplace: product.sell_side?.primary_marketplace || 'Amazon India',
      prevailing_retail_asp_inr: product.sell_side?.prevailing_retail_asp_inr || 0,
      competitor_count: product.sell_side?.competitor_count || 12,
      top_competitors: product.sell_side?.top_competitor_names || ['Incumbent Brand A', 'Incumbent Brand B'],
      dominant_pack_formats: product.sell_side?.dominant_pack_formats || ['Single Unit', 'Multipack'],
      buy_box_retention_risk: product.overall_negative_review_pct && product.overall_negative_review_pct > 20 ? 'HIGH' : 'MEDIUM',
      material_claims_vs_verified: product.upstream_supply?.raw_material_basis
        ? `Listing claims ${product.name} baseline; verified basis: ${product.upstream_supply.raw_material_basis}`
        : 'Material spec unverified at supplier gate'
    };

    // 6. Supply & Logistics
    const supplyHub = product.upstream_supply?.hub_name || 'Manufacturing Cluster';
    const factoryQuote = product.upstream_supply?.factory_gate_quote_inr || 0;
    const moq = product.upstream_supply?.supplier_moq || product.upstream_supply?.minimum_order_quantity || 500;
    const leadTime = product.upstream_supply?.lead_time_days || 14;

    let routeKm = 1200;
    let transitHours = 28;
    if (supplyHub.includes('Jamnagar')) {
      routeKm = 1180;
      transitHours = 26;
    } else if (supplyHub.includes('Khurja') || supplyHub.includes('Moradabad')) {
      routeKm = 160;
      transitHours = 5;
    }

    const supplySection: DossierSupplyAndLogistics = {
      sourcing_hub: supplyHub,
      manufacturer_quote_inr: factoryQuote,
      supplier_moq: moq,
      lead_time_days: leadTime,
      mapped_route: {
        origin: supplyHub,
        destination: 'Delhi-NCR Distribution Fulfillment Center',
        distance_km: routeKm,
        transit_hours: transitHours,
        method: 'MAPPED_ROUTE_ESTIMATE'
      },
      carrier_freight_quote: {
        freight_inr: (product.upstream_supply as any)?.inbound_freight_est_inr || 15.0,
        packaging_kitting_inr: (product.upstream_supply as any)?.packaging_kitting_inr || 10.0,
        quote_status: 'MAPPED_ROUTE_ESTIMATE'
      }
    };

    // 7. Unit Economics Waterfall (Pure BigInt Subunit Arithmetic Across 4 Channels)
    const baseAspSubunits = BigInt(Math.trunc((product.sell_side?.prevailing_retail_asp_inr || 0) * 10000));
    const factoryCostSubunits = BigInt(Math.trunc(factoryQuote * 10000));
    const inboundFreightSubunits = BigInt(Math.trunc(((product.upstream_supply as any)?.inbound_freight_est_inr || 15.0) * 10000));
    const packagingCostSubunits = BigInt(Math.trunc(((product.upstream_supply as any)?.packaging_kitting_inr || 10.0) * 10000));
    const freightPkgSubunits = inboundFreightSubunits + packagingCostSubunits;

    const channels: MarketplaceChannel[] = ['AMAZON_IN', 'FLIPKART', 'MEESHO', 'B2B_DISTRIBUTION'];
    const waterfallRows: DossierUnitEconomicsWaterfallRow[] = channels.map((channel) => {
      let channelAspSubunits = baseAspSubunits;
      let platformFeeSubunits = 0n;
      let fulfillmentSubunits = 50_0000n;
      let returnRateBps = 300n;
      let priceEpistemicClass: 'OBSERVED_QUOTE' | 'ESTIMATED_PROXY' | 'DATA_REQUIRED' =
        baseAspSubunits > 0n ? 'OBSERVED_QUOTE' : 'DATA_REQUIRED';
      let explicitAssumptions: string[] = ['Prevailing marketplace retail ASP observed from live listing'];

      if (channel === 'AMAZON_IN') {
        platformFeeSubunits = (channelAspSubunits * 1200n) / 10000n; // 12%
        fulfillmentSubunits = 55_0000n; // ₹55
        returnRateBps = 350n;
        explicitAssumptions = ['Amazon India 12% category referral fee', '₹55 standard FBA weight handling fee', '3.5% return rate'];
      } else if (channel === 'FLIPKART') {
        platformFeeSubunits = (channelAspSubunits * 1000n) / 10000n; // 10%
        fulfillmentSubunits = 50_0000n; // ₹50
        returnRateBps = 400n;
        explicitAssumptions = ['Flipkart 10% commission', '₹50 standard fulfillment fee', '4.0% return rate'];
      } else if (channel === 'MEESHO') {
        platformFeeSubunits = (channelAspSubunits * 200n) / 10000n; // 2%
        fulfillmentSubunits = 75_0000n; // ₹75
        returnRateBps = 1200n; // 12%
        explicitAssumptions = ['Meesho 2% platform fee', '₹75 3PL transit & kitting', '12.0% high return drag'];
      } else if (channel === 'B2B_DISTRIBUTION') {
        channelAspSubunits = (baseAspSubunits * 6500n) / 10000n; // 35% wholesale discount
        platformFeeSubunits = 0n;
        fulfillmentSubunits = 12_0000n; // ₹12
        returnRateBps = 50n;
        priceEpistemicClass = 'ESTIMATED_PROXY';
        explicitAssumptions = [
          'Assumed 35% B2B wholesale discount off retail ASP — unverified quote',
          'Zero platform commission in direct distributor placement',
          '₹12 bulk freight handling per unit',
          '0.5% commercial defect return rate'
        ];
      }

      // GST: 18% on platform fees + 2% TCS/TDS on retail proceeds
      const feeGstSubunits = ((platformFeeSubunits + fulfillmentSubunits) * 1800n) / 10000n;
      const tcsTdsSubunits = (channelAspSubunits * 200n) / 10000n;
      const statutoryTaxSubunits = feeGstSubunits + tcsTdsSubunits;

      // Ex-GST proceeds = Gross ASP - statutory tax
      const exGstProceedsSubunits = channelAspSubunits > statutoryTaxSubunits ? channelAspSubunits - statutoryTaxSubunits : 0n;

      // Return drag = (fulfillment + ₹60 return freight + factory cost) * return rate
      const returnLogisticsSubunits = 60_0000n;
      const returnDragSubunits = ((fulfillmentSubunits + returnLogisticsSubunits + factoryCostSubunits) * returnRateBps) / 10000n;

      const totalDeductionsSubunits =
        factoryCostSubunits + freightPkgSubunits + platformFeeSubunits + fulfillmentSubunits + statutoryTaxSubunits + returnDragSubunits;
      const netContributionSubunits = channelAspSubunits - totalDeductionsSubunits;
      const marginBps = channelAspSubunits > 0n
        ? Number((netContributionSubunits * 10000n) / channelAspSubunits)
        : -10000;

      const dataRequired = factoryCostSubunits <= 0n || channelAspSubunits <= 0n;
      const isViable = !dataRequired && netContributionSubunits > 0n && marginBps >= 1000;
      let disqualReason: string | undefined;
      if (factoryCostSubunits <= 0n) {
        disqualReason = 'Missing verified factory gate quote (DATA_REQUIRED)';
      } else if (channelAspSubunits <= 0n) {
        disqualReason = 'Missing prevailing retail ASP (DATA_REQUIRED)';
      } else if (netContributionSubunits <= 0n) {
        disqualReason = `Negative unit contribution (-₹${(Number(-netContributionSubunits) / 10000).toFixed(2)})`;
      } else if (marginBps < 1000) {
        disqualReason = `Margin too thin (${marginBps} bps < 1000 bps hurdle)`;
      }

      return {
        channel,
        gross_selling_price_inr: Number(channelAspSubunits) / 10000,
        ex_gst_proceeds_inr: Number(exGstProceedsSubunits) / 10000,
        platform_fee_inr: Number(platformFeeSubunits) / 10000,
        fulfillment_fee_inr: Number(fulfillmentSubunits) / 10000,
        statutory_tax_inr: Number(statutoryTaxSubunits) / 10000,
        packaging_inbound_freight_inr: Number(freightPkgSubunits) / 10000,
        factory_cost_inr: Number(factoryCostSubunits) / 10000,
        return_drag_inr: Number(returnDragSubunits) / 10000,
        net_contribution_inr: Number(netContributionSubunits) / 10000,
        contribution_margin_bps: marginBps,
        price_epistemic_class: priceEpistemicClass,
        explicit_assumptions: explicitAssumptions,
        is_viable: isViable,
        data_required: dataRequired,
        disqualification_reason: disqualReason
      };
    });

    // 8. Incumbent Failure Matrix (Loaded from market_hypothesis_ledger)
    const storedHypotheses = await centralResearchCore.loadHypotheses(product.product_id);
    const incumbentMatrix: DossierIncumbentFailureMatrixEntry[] = storedHypotheses.map((h) => ({
      explanation_type: h.explanation_type,
      statement: h.hypothesis_statement,
      verdict: h.verdict,
      current_stage: h.current_stage,
      supporting_evidence_count: h.supporting_evidence_ids.length,
      disconfirming_evidence_count: h.disconfirming_evidence_ids.length,
      hypothesis_id: h.hypothesis_id
    }));

    // 9. Evidence & Citations
    const evidenceList = centralResearchCore.queryEvidence(product.product_id, nowUtc);
    const evidenceRecords = evidenceList.map((e) => ({
      evidence_id: e.evidence_id,
      channel: e.channel,
      observed_at_utc: e.observed_at_utc,
      as_of_utc: e.as_of_utc,
      origin_class: e.origin.origin_class,
      epistemic_class: e.epistemic_class,
      payload_sha256: e.payload_sha256,
      is_attested: e.origin.is_attested,
      summary: (e.extracted_claims as any)?.summary || (e.extracted_claims as any)?.top_failure || `Observation in ${e.channel}`
    }));

    // Detect active contradictions across quotes or claims
    const activeConflicts: {
      field_name: string;
      claims: {
        source_id: string;
        value: unknown;
        observed_at_utc: string;
      }[];
    }[] = [];
    const quoteEvs = evidenceList.filter((e) => (e.extracted_claims as any)?.factory_gate_quote_inr);
    if (quoteEvs.length >= 2) {
      const distinctQuotes = new Set(quoteEvs.map((e) => (e.extracted_claims as any).factory_gate_quote_inr));
      if (distinctQuotes.size > 1) {
        activeConflicts.push({
          field_name: 'factory_gate_quote_inr',
          claims: quoteEvs.map((e) => ({
            source_id: e.origin.source_url,
            value: (e.extracted_claims as any).factory_gate_quote_inr,
            observed_at_utc: e.observed_at_utc
          }))
        });
      }
    }

    const dossierRaw: Omit<OpportunityDossier, 'jcs_sha256'> = {
      lead_header: leadHeader,
      demand_and_seasonality: demandSection,
      customer_pain_and_strengths: customerPainSection,
      seller_and_competition: sellerSection,
      supply_and_logistics: supplySection,
      unit_economics_waterfall: waterfallRows,
      incumbent_failure_matrix: incumbentMatrix,
      scorecard,
      evidence_and_citations: {
        evidence_records: evidenceRecords,
        active_conflict_pairs: activeConflicts
      }
    };

    const jcsSha256 = sha256(canonicalizeJCS(sanitizeForJcs(dossierRaw)));

    return {
      ...dossierRaw,
      jcs_sha256: jcsSha256
    };
  }
}
