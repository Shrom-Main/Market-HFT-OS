export type CommercialArchetype =
  | 'CLUSTER_MRO_STANDARDIZED'
  | 'TECHNICAL_COMPLIANCE'
  | 'SEASONAL_D2C_VISUAL'
  | 'D2C_CONSUMABLE'
  | 'MRO_INDUSTRIAL'
  | 'REPLACEMENT_PARTS';

export type StrategicDecision =
  | 'PURSUE'
  | 'INVESTIGATING'
  | 'MONITOR_ONLY'
  | 'REJECT';

export type ResearchCaseStatus =
  | 'UNINITIALIZED'
  | 'IN_RESEARCH'
  | 'STRATEGY_FORMULATED'
  | 'HUMAN_SIGNOFF_PENDING'
  | 'APPROVED'
  | 'ARCHIVED';

export type GrievanceCategory =
  | 'QUALITY_DEFECT'
  | 'DURABILITY_FAILURE'
  | 'SAFETY_HAZARD'
  | 'PACKAGING_DAMAGE'
  | 'REGULATORY_NON_COMPLIANCE'
  | 'SPEC_MISMATCH'
  | 'OTHER';

export interface BuyerGrievanceCluster {
  grievance_id: string;
  category: GrievanceCategory;
  frequency_pct: number;
  summary: string;
  failure_mode: string;
  representative_quote: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  engineered_remediation: string;
}

export interface ProductSellSideAnalysis {
  primary_marketplace: string;
  listing_url: string;
  asin_or_item_code: string;
  best_seller_rank: number;
  monthly_sales_volume_est: number;
  monthly_gross_revenue_inr_est: number;
  prevailing_retail_asp_inr: number;
  competitor_count: number;
  top_competitor_names: string[];
  top_competitor_brands?: string[];
  dominant_pack_formats: string[];
}

export interface UpstreamSupplyCluster {
  hub_name: string;
  manufacturing_method: string;
  factory_gate_quote_inr: number;
  supplier_moq: number;
  minimum_order_quantity?: number;
  lead_time_days: number;
  raw_material_basis: string;
  per_unit_landed_cost_est_inr: number;
}

export interface StrategicArbitrageThesis {
  thesis_id: string;
  strategic_decision: StrategicDecision;
  research_case_status: ResearchCaseStatus;
  proposed_strategy: string;
  target_gross_spread_inr: number;
  target_contribution_margin_bps: number;
  estimated_annualized_rowc_bps: number;
  working_capital_req_inr: number;
  min_capital_requirement_inr?: number;
  cash_conversion_cycle_days: number;
  bull_case_rationale: string;
  bull_case_thesis?: string;
  bear_case_risk: string;
  bear_case_thesis?: string;
}

export interface EvidenceOriginMetadata {
  origin_class: 'LIVE_VERIFIED_CAPTURE' | 'RECORDED_GOLDEN_FIXTURE';
  requested_url: string;
  resolved_source_identity: string;
  is_eligible_for_executable_offer_promotion: boolean;
  semantic_badge: {
    status_code: string;
    icon_symbol: string;
    label: string;
    aria_description: string;
  };
}

export interface ProductObservationItem {
  product_id: string;
  sku_id: string;
  name: string;
  category: string;
  commercial_archetype: CommercialArchetype;
  is_guiding_reference: boolean;
  sell_side: ProductSellSideAnalysis;
  buyer_grievances: BuyerGrievanceCluster[];
  overall_negative_review_pct: number;
  upstream_supply: UpstreamSupplyCluster;
  strategy: StrategicArbitrageThesis;
  evidence_origin: EvidenceOriginMetadata;
  badge: {
    status_code: string;
    icon_symbol: string;
    label: string;
    aria_description: string;
  };
  updated_at_utc: string;
  jcs_sha256: string;
}

export interface ProductObservationDeckResponse {
  categories: string[];
  archetypes: CommercialArchetype[];
  total_products_count: number;
  active_investigations_count: number;
  pursue_count: number;
  timestamp_utc: string;
  products: ProductObservationItem[];
}
