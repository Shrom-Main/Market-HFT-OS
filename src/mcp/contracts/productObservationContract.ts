/**
 * POC-001: Product Observation Deck & Grievance Mining Contract
 * Gate M7.2 / Decision OD-22: Category-Agnostic Multi-Product Universe,
 * Marketplace Sell-Side Intelligence, Buyer Feedback Teardowns & Strategic Arbitrage Formulations.
 *
 * Strict Epistemic Invariants:
 * 1. Category is metadata. Products span Industrial Fasteners, Plumbing, Electrical, Home & Seasonal, Wellness, and Gaskets.
 * 2. SS304 DIN 3017 is the guiding reference opportunity (is_guiding_reference: true).
 * 3. Sell-side intelligence measures what competitors sell (volume, revenue, ASP, BSR).
 * 4. Buyer grievances isolate exact customer defect modes, quotes, and dissatisfaction percentages.
 * 5. Engineered remediations formulate the operational edge required to win the Buy Box and eliminate returns.
 * 6. Evidence origin is strictly preserved (RECORDED_GOLDEN_FIXTURE vs LIVE_VERIFIED_CAPTURE).
 */

import type { EvidenceOriginBadge, SemanticStatusBadge, OperatorConfirmationEnvelope } from './operatorTerminalContract.js';

export type CommercialArchetype =
  | 'CLUSTER_MRO_STANDARDIZED'
  | 'TECHNICAL_COMPLIANCE'
  | 'SEASONAL_D2C_VISUAL'
  | 'D2C_CONSUMABLE'
  | 'MRO_INDUSTRIAL'
  | 'REPLACEMENT_PARTS';

export type StrategicDecision =
  | 'PURSUE'
  | 'VALIDATE_FURTHER'
  | 'MONITOR'
  | 'REJECT';

export type ResearchCaseStatus =
  | 'DISCOVERED'
  | 'RESEARCHING'
  | 'ACTIVE_OBSERVATION'
  | 'ADVERSARIAL_REVIEW'
  | 'STRATEGY_FORMULATED'
  | 'READY_FOR_ALLOCATION';

export type GrievanceCategory =
  | 'QUALITY_DEFECT'
  | 'SPECIFICATION_MISMATCH'
  | 'PACKAGING_DAMAGE'
  | 'DURABILITY_FAILURE'
  | 'SAFETY_HAZARD';

export interface BuyerGrievanceCluster {
  readonly grievance_id: string;
  readonly category: GrievanceCategory;
  readonly frequency_pct: number; // e.g. 38 = 38% of complaints
  readonly summary: string; // e.g. "Stripping screws under modest torque"
  readonly representative_quote: string; // e.g. "Screw sheared off during radiator hose tightening"
  readonly severity: 'HIGH' | 'MEDIUM' | 'CRITICAL';
  readonly engineered_remediation: string; // How we fix it to win the market
  readonly failure_mode?: string;
}

export interface ProductSellSideAnalysis {
  readonly primary_marketplace: 'Amazon India' | 'IndiaMART' | 'Meesho' | 'IndustryBuying' | 'GeM';
  readonly listing_url?: string;
  readonly asin_or_item_code?: string;
  readonly best_seller_rank: number; // e.g. #12
  readonly monthly_sales_volume_est: number; // units/month
  readonly monthly_gross_revenue_inr_est: number; // INR/month
  readonly prevailing_retail_asp_inr: number; // INR
  readonly competitor_count: number;
  readonly top_competitor_names: readonly string[];
  readonly top_competitor_brands?: readonly string[];
  readonly dominant_pack_formats: readonly string[]; // e.g. ["10-Pack", "20-Pack"]
}

export interface UpstreamSupplyCluster {
  readonly hub_name: string; // e.g. "Baltikuri / Howrah, West Bengal"
  readonly manufacturing_method: string; // e.g. "Progressive High-Speed Stamping"
  readonly factory_gate_quote_inr: number; // INR per unit ex-factory
  readonly supplier_moq: number; // units
  readonly minimum_order_quantity?: number;
  readonly lead_time_days: number; // days
  readonly raw_material_basis: string; // e.g. "Jindal Stainless SS304 Coil benchmark"
  readonly per_unit_landed_cost_est_inr?: number;
}

export interface StrategicArbitrageThesis {
  readonly thesis_id: string;
  readonly proposed_strategy: string; // Operational strategy
  readonly target_gross_spread_inr: number; // Retail ASP - Sourcing Cost
  readonly target_contribution_margin_bps: number; // e.g. 3830 = 38.30%
  readonly estimated_annualized_rowc_bps: number; // e.g. 39941 = 399.41%
  readonly working_capital_req_inr: number; // INR initial batch
  readonly min_capital_requirement_inr?: number;
  readonly cash_conversion_cycle_days: number; // days
  readonly bull_case_rationale: string;
  readonly bull_case_thesis?: string;
  readonly bear_case_risk: string;
  readonly bear_case_thesis?: string;
  readonly strategic_decision: StrategicDecision;
  readonly research_case_status: ResearchCaseStatus;
}

export interface ProductObservationItem {
  readonly product_id: string;
  readonly sku_id: string;
  readonly name: string;
  readonly category: string;
  readonly commercial_archetype: CommercialArchetype;
  readonly is_guiding_reference: boolean;
  readonly sell_side: ProductSellSideAnalysis;
  readonly buyer_grievances: readonly BuyerGrievanceCluster[];
  readonly overall_negative_review_pct: number; // e.g. 18.5 = 18.5%
  readonly upstream_supply: UpstreamSupplyCluster;
  readonly strategy: StrategicArbitrageThesis;
  readonly evidence_origin: EvidenceOriginBadge;
  readonly badge: SemanticStatusBadge;
  readonly jcs_sha256?: string;
  readonly updated_at_utc: string;
}

export interface ProductObservationDeckResponse {
  readonly products: readonly ProductObservationItem[];
  readonly categories: readonly string[];
  readonly archetypes: readonly CommercialArchetype[];
  readonly total_products_count: number;
  readonly active_investigations_count: number;
  readonly pursue_count: number;
  readonly timestamp_utc: string;
}

export interface PushProductObservationRequest {
  readonly product_id?: string;
  readonly sku_id?: string;
  readonly name: string;
  readonly category: string;
  readonly commercial_archetype: CommercialArchetype;
  readonly retail_asp_inr?: number;
  readonly upstream_factory_quote_inr?: number;
  readonly upstream_hub_name?: string;
  readonly observed_grievance?: string;
  readonly strategic_decision?: StrategicDecision;
  readonly sell_side?: {
    readonly primary_marketplace: 'Amazon India' | 'IndiaMART' | 'Meesho' | 'IndustryBuying' | 'GeM';
    readonly listing_url?: string;
    readonly best_seller_rank?: number;
    readonly monthly_sales_volume_est?: number;
    readonly monthly_gross_revenue_inr_est?: number;
    readonly prevailing_retail_asp_inr?: number;
    readonly competitor_count?: number;
    readonly top_competitor_names?: readonly string[];
    readonly dominant_pack_formats?: readonly string[];
  };
  readonly buyer_grievances?: readonly {
    readonly category?: GrievanceCategory;
    readonly frequency_pct?: number;
    readonly summary?: string;
    readonly representative_quote?: string;
    readonly severity?: 'HIGH' | 'MEDIUM' | 'CRITICAL';
    readonly engineered_remediation?: string;
    readonly failure_mode?: string;
  }[];
  readonly overall_negative_review_pct?: number;
  readonly upstream_supply?: {
    readonly hub_name?: string;
    readonly manufacturing_method?: string;
    readonly factory_gate_quote_inr?: number;
    readonly supplier_moq?: number;
    readonly lead_time_days?: number;
    readonly raw_material_basis?: string;
  };
  readonly strategy?: {
    readonly proposed_strategy?: string;
    readonly working_capital_req_inr?: number;
    readonly cash_conversion_cycle_days?: number;
    readonly bull_case_rationale?: string;
    readonly bear_case_risk?: string;
    readonly strategic_decision?: StrategicDecision;
  };
}

export interface ResearchProductRequest {
  readonly product_id: string;
  readonly confirmation?: OperatorConfirmationEnvelope;
  readonly target_specialist_workers?: readonly string[];
}
