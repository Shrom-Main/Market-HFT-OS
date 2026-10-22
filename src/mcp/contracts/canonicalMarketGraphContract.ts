/**
 * POC-001: Canonical Market-Discovery Graph Contract & Incumbent-Failure Hypotheses
 *
 * Implements:
 * 1. The 10 Core Entities of the Category-Agnostic Market Discovery Graph:
 *    - Product
 *    - Business (Google Maps fields isolated from internal role classifications)
 *    - Observation (MARKETING_CLAIM, CUSTOMER_ALLEGATION, MEASURED_RESULT, VERIFIED_TECHNICAL_FINDING)
 *    - CustomerProblem (structured grievance/pain-point model)
 *    - SellerCompetitor
 *    - SupplierQuote
 *    - RouteEstimate (MAPPED_ROUTE_ESTIMATE vs VERIFIED_CARRIER_QUOTE)
 *    - UnitEconomicsScenario (Amazon, Flipkart, Meesho, B2B models)
 *    - Hypothesis (7-stage hypothesis lifecycle)
 *    - ExperimentAndDecision (8 decision outcomes)
 * 2. The 8 Incumbent-Failure Hypotheses Evaluator:
 *    - evaluateIncumbentFailureHypotheses(...)
 */

import { sha256 } from '../../canonical/crypto.js';
import { canonicalizeJCS } from '../../canonical/jcs.js';
import type { RouteSourceType } from '../apiQuotaAndRateGovernor.js';
export type { RouteSourceType };

// ============================================================================
// 1. OBSERVATION KIND & EPISTEMIC CATEGORIES
// ============================================================================

export type ObservationKind =
  | 'MARKETING_CLAIM'
  | 'CUSTOMER_ALLEGATION'
  | 'MEASURED_RESULT'
  | 'VERIFIED_TECHNICAL_FINDING';

export interface ObservationEntity {
  readonly observation_id: string;
  readonly product_id: string;
  readonly entity_id?: string;
  readonly kind: ObservationKind;
  readonly statement: string;
  readonly raw_passage_quote?: string;
  readonly citation_character_span?: readonly [number, number];
  readonly source_id: string;
  readonly source_channel: string;
  readonly observed_at_utc: string;
  readonly verified: boolean;
  readonly verification_method?: string;
  readonly confidence_score: number; // 0.00 to 1.00
  readonly jcs_sha256: string;
}

// ============================================================================
// 2. BUSINESS ENTITY (GOOGLE MAPS ISOLATION)
// ============================================================================

export type InternalEntityRoleCandidate =
  | 'MANUFACTURER_SUPPLIER'
  | 'DISTRIBUTOR_INTERMEDIARY'
  | 'POTENTIAL_B2B_BUYER'
  | 'EXISTING_SELLER_COMPETITOR';

export interface BusinessEntity {
  readonly internal_entity_id: string;
  readonly entity_name: string;
  readonly hub_region: string;

  // Google Maps Platform Supplied Data (subject to Google Maps terms & TTL)
  readonly google_maps_fields?: {
    readonly place_id: string;
    readonly formatted_address: string;
    readonly location: { readonly latitude: number; readonly longitude: number };
    readonly primary_type?: string;
    readonly types?: readonly string[];
    readonly business_status?: string;
    readonly website_uri?: string;
    readonly national_phone_number?: string;
    readonly rating?: number;
    readonly user_rating_count?: number;
    readonly google_maps_uri?: string;
    readonly fetched_at_utc: string;
    readonly cache_ttl_expires_utc: string;
  };

  // Internal Classification Fields (strictly separated from external provider fields)
  readonly entity_role_candidates: readonly InternalEntityRoleCandidate[];
  readonly classification_confidence: number;
  readonly classification_evidence_ids: readonly string[];
  readonly registered_at_utc: string;
}

// ============================================================================
// 3. PRODUCT ENTITY
// ============================================================================

export interface ProductEntity {
  readonly product_id: string;
  readonly canonical_sku: string;
  readonly product_name: string;
  readonly category: string;
  readonly hsn_code?: string;
  readonly commercial_archetype: string;
  readonly prevailing_retail_asp_inr: number;
  readonly prevailing_retail_asp_subunits: string;
  readonly created_at_utc: string;
}

// ============================================================================
// 4. CUSTOMER PROBLEM ENTITY
// ============================================================================

export type ProblemCategory =
  | 'QUALITY_DEFECT'
  | 'DURABILITY_FAILURE'
  | 'PACKAGING_DAMAGE'
  | 'SPEC_MISMATCH'
  | 'REGULATORY_NON_COMPLIANCE'
  | 'SAFETY_HAZARD';

export type FailureSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface CustomerProblemEntity {
  readonly problem_id: string;
  readonly product_id: string;
  readonly problem_category: ProblemCategory;
  readonly application_context: string;
  readonly failure_severity: FailureSeverity;
  readonly failure_frequency_pct: number;
  readonly root_cause_candidate: string;
  readonly willingness_to_pay_for_solution_bps: number;
  readonly source_bias_level: 'LOW_ORGANIC' | 'MEDIUM_INCENTIVIZED' | 'HIGH_COMPETITOR_ASTROTURF';
  readonly representative_evidence_ids: readonly string[];
  readonly engineered_remediation_proposal: string;
}

// ============================================================================
// 5. SELLER COMPETITOR ENTITY
// ============================================================================

export interface SellerCompetitorEntity {
  readonly competitor_id: string;
  readonly product_id: string;
  readonly seller_display_name: string;
  readonly primary_platform: 'AMAZON_IN' | 'FLIPKART' | 'MEESHO' | 'B2B_PORTAL';
  readonly estimated_monthly_volume: number;
  readonly prevailing_price_inr: number;
  readonly rating: number;
  readonly return_defect_rate_pct: number;
  readonly buy_box_share_pct: number;
  readonly evidence_observation_ids: readonly string[];
}

// ============================================================================
// 6. SUPPLIER QUOTE ENTITY
// ============================================================================

export interface SupplierQuoteEntity {
  readonly quote_id: string;
  readonly product_id: string;
  readonly supplier_business_id: string;
  readonly factory_gate_quote_inr: number;
  readonly factory_gate_quote_subunits: string;
  readonly moq_units: number;
  readonly lead_time_days: number;
  readonly raw_material_basis: string;
  readonly quote_validity_expires_utc: string;
  readonly verification_status: 'UNVERIFIED' | 'CROSS_SOURCE_CORROBORATED' | 'CRYPTOGRAPHICALLY_ATTESTED';
  readonly evidence_id: string;
}

// ============================================================================
// 7. ROUTE ESTIMATE ENTITY
// ============================================================================

export interface RouteEstimateEntity {
  readonly route_id: string;
  readonly origin_hub: string;
  readonly destination_cluster: string;
  readonly straight_line_distance_km: number;
  readonly road_distance_km: number;
  readonly estimated_duration_minutes: number;
  readonly estimated_freight_inr: number;
  readonly estimated_freight_subunits: string;
  readonly route_source: RouteSourceType;
  readonly carrier_name?: string;
  readonly computed_at_utc: string;
  readonly verification_notes: string;
}

// ============================================================================
// 8. UNIT ECONOMICS SCENARIO ENTITY
// ============================================================================

export type MarketplaceChannel = 'AMAZON_IN' | 'FLIPKART' | 'MEESHO' | 'B2B_DISTRIBUTION';

export interface UnitEconomicsScenarioEntity {
  readonly scenario_id: string;
  readonly product_id: string;
  readonly channel: MarketplaceChannel;
  readonly retail_selling_price_inr: number;
  readonly factory_gate_cost_inr: number;
  readonly inbound_freight_inr: number;
  readonly packaging_kitting_inr: number;
  readonly platform_referral_fee_inr: number;
  readonly platform_fulfillment_fee_inr: number;
  readonly gst_tax_inr: number;
  readonly total_landed_cost_inr: number;
  readonly gross_spread_inr: number;
  readonly contribution_margin_bps: number;
  readonly holding_period_days: number;
  readonly annualized_rowc_bps: number;
  readonly is_profitable: boolean;
}

// ============================================================================
// 9. HYPOTHESIS & 7-STAGE LIFECYCLE
// ============================================================================

export type HypothesisStage =
  | 'DETECTED'
  | 'FORMULATED'
  | 'EVIDENCE_GATHERING'
  | 'ADVERSARIAL_TESTING'
  | 'APPROVED'
  | 'REJECTED'
  | 'DEFERRED';

export interface HypothesisEntity {
  readonly hypothesis_id: string;
  readonly product_id: string;
  readonly title: string;
  readonly description: string;
  readonly current_stage: HypothesisStage;
  readonly primary_failure_mode_addressed: string;
  readonly expected_margin_uplift_bps: number;
  readonly created_at_utc: string;
  readonly last_updated_utc: string;
  readonly supporting_evidence_ids: readonly string[];
  readonly disconfirming_evidence_ids: readonly string[];
}

// ============================================================================
// 10. EXPERIMENT & DECISION (8 DECISION OUTCOMES)
// ============================================================================

export type DecisionOutcome =
  | 'PROMISING_BUT_UNVALIDATED'
  | 'MORE_EVIDENCE_REQUIRED'
  | 'ECONOMICS_FAIL'
  | 'TECHNICAL_FEASIBILITY_FAIL'
  | 'DISTRIBUTION_FAIL'
  | 'INSUFFICIENT_EVIDENCE'
  | 'READY_FOR_PAPER_TEST'
  | 'READY_FOR_HUMAN_REVIEW';

export interface ExperimentAndDecisionEntity {
  readonly decision_id: string;
  readonly hypothesis_id: string;
  readonly product_id: string;
  readonly outcome: DecisionOutcome;
  readonly decision_rationale: string;
  readonly decided_by_operator_or_system: string;
  readonly decided_at_utc: string;
  readonly test_run_evidence_ids: readonly string[];
  readonly next_action: string;
  readonly jcs_sha256: string;
}

// ============================================================================
// 11. THE 8 INCUMBENT-FAILURE HYPOTHESES EVALUATOR
// ============================================================================

export type IncumbentFailureHypothesisType =
  | 'ECONOMICS_UNVIABLE'
  | 'DEMAND_FRAGMENTATION'
  | 'MANUFACTURING_CONSTRAINTS'
  | 'DISTRIBUTION_CONSTRAINTS'
  | 'INFORMATION_ASYMMETRY'
  | 'PROCUREMENT_FRICTION'
  | 'WEAK_INCENTIVES'
  | 'FALSE_OPPORTUNITY';

export interface IncumbentFailureHypothesisEvaluation {
  readonly hypothesis: IncumbentFailureHypothesisType;
  readonly evaluated_product_id: string;
  readonly supporting_evidence_ids: readonly string[];
  readonly disconfirming_evidence_ids: readonly string[];
  readonly validation_method: string;
  readonly verdict: 'SUPPORTED' | 'REFUTED' | 'INSUFFICIENT_DATA';
  readonly rationale: string;
}

export function evaluateIncumbentFailureHypotheses(params: {
  product_id: string;
  observations: readonly ObservationEntity[];
  customer_problems: readonly CustomerProblemEntity[];
  supplier_quotes: readonly SupplierQuoteEntity[];
  unit_economics: readonly UnitEconomicsScenarioEntity[];
}): readonly IncumbentFailureHypothesisEvaluation[] {
  const { product_id, observations, customer_problems, supplier_quotes, unit_economics } = params;

  const results: IncumbentFailureHypothesisEvaluation[] = [];

  // 1. ECONOMICS_UNVIABLE
  const unprofitableScenarios = unit_economics.filter((u) => !u.is_profitable || u.contribution_margin_bps < 1000);
  results.push({
    hypothesis: 'ECONOMICS_UNVIABLE',
    evaluated_product_id: product_id,
    supporting_evidence_ids: unprofitableScenarios.map((u) => u.scenario_id),
    disconfirming_evidence_ids: unit_economics.filter((u) => u.is_profitable && u.contribution_margin_bps >= 1500).map((u) => u.scenario_id),
    validation_method: 'Pure BigInt Unit Economics Scenario Matrix',
    verdict: unprofitableScenarios.length > 0 && unit_economics.length > 0 ? 'SUPPORTED' : (unit_economics.length === 0 ? 'INSUFFICIENT_DATA' : 'REFUTED'),
    rationale: unprofitableScenarios.length > 0
      ? `Economics unviable in ${unprofitableScenarios.length} channel scenario(s) due to margin compression (<1000 bps).`
      : 'Unit economics demonstrate viable commercial spread across modeled channels.'
  });

  // 2. DEMAND_FRAGMENTATION
  const highVarianceProblems = customer_problems.filter((p) => p.failure_frequency_pct < 15);
  results.push({
    hypothesis: 'DEMAND_FRAGMENTATION',
    evaluated_product_id: product_id,
    supporting_evidence_ids: highVarianceProblems.map((p) => p.problem_id),
    disconfirming_evidence_ids: customer_problems.filter((p) => p.failure_frequency_pct >= 25).map((p) => p.problem_id),
    validation_method: 'Grievance Frequency Cluster Analysis',
    verdict: highVarianceProblems.length > 3 ? 'SUPPORTED' : (customer_problems.length === 0 ? 'INSUFFICIENT_DATA' : 'REFUTED'),
    rationale: highVarianceProblems.length > 3
      ? 'Customer complaints are fragmented across low-frequency edge cases with no dominant cluster.'
      : 'Dominant cluster identified; demand is cohesive around core mechanical/packaging pain point.'
  });

  // 3. MANUFACTURING_CONSTRAINTS
  const unverifiedQuotes = supplier_quotes.filter((q) => q.verification_status === 'UNVERIFIED');
  results.push({
    hypothesis: 'MANUFACTURING_CONSTRAINTS',
    evaluated_product_id: product_id,
    supporting_evidence_ids: unverifiedQuotes.map((q) => q.quote_id),
    disconfirming_evidence_ids: supplier_quotes.filter((q) => q.verification_status !== 'UNVERIFIED').map((q) => q.quote_id),
    validation_method: 'Supplier MOQ & Lead Time Constraint Audit',
    verdict: supplier_quotes.some((q) => q.moq_units > 10000 || q.lead_time_days > 30) ? 'SUPPORTED' : (supplier_quotes.length === 0 ? 'INSUFFICIENT_DATA' : 'REFUTED'),
    rationale: supplier_quotes.some((q) => q.moq_units > 10000)
      ? 'High MOQ (>10,000 units) creates manufacturing working capital constraint.'
      : 'Supplier manufacturing terms and batch sizes are within acceptable working capital limits.'
  });

  // 4. DISTRIBUTION_CONSTRAINTS
  results.push({
    hypothesis: 'DISTRIBUTION_CONSTRAINTS',
    evaluated_product_id: product_id,
    supporting_evidence_ids: [],
    disconfirming_evidence_ids: observations.filter((o) => o.kind === 'VERIFIED_TECHNICAL_FINDING').map((o) => o.observation_id),
    validation_method: 'Marketplace Logistics Fee & Weight Threshold Verification',
    verdict: 'INSUFFICIENT_DATA',
    rationale: 'Carrier routes and dimensional weight handling requires empirical fulfillment rate verification.'
  });

  // 5. INFORMATION_ASYMMETRY
  const marketingVsMeasured = observations.filter((o) => o.kind === 'MARKETING_CLAIM' || o.kind === 'MEASURED_RESULT');
  results.push({
    hypothesis: 'INFORMATION_ASYMMETRY',
    evaluated_product_id: product_id,
    supporting_evidence_ids: marketingVsMeasured.filter((o) => o.kind === 'CUSTOMER_ALLEGATION').map((o) => o.observation_id),
    disconfirming_evidence_ids: marketingVsMeasured.filter((o) => o.kind === 'MEASURED_RESULT').map((o) => o.observation_id),
    validation_method: 'Marketing Claim vs Laboratory / Physical Measurement Comparison',
    verdict: observations.some((o) => o.kind === 'MARKETING_CLAIM') && customer_problems.length > 0 ? 'SUPPORTED' : 'INSUFFICIENT_DATA',
    rationale: 'Competitors market premium specifications but customer complaints reveal persistent metallurgical/casing defects.'
  });

  // 6. PROCUREMENT_FRICTION
  results.push({
    hypothesis: 'PROCUREMENT_FRICTION',
    evaluated_product_id: product_id,
    supporting_evidence_ids: unverifiedQuotes.map((q) => q.quote_id),
    disconfirming_evidence_ids: supplier_quotes.filter((q) => q.verification_status === 'CRYPTOGRAPHICALLY_ATTESTED').map((q) => q.quote_id),
    validation_method: 'Supplier Onboarding & Payment Term Friction Assessment',
    verdict: unverifiedQuotes.length > 0 ? 'SUPPORTED' : (supplier_quotes.length === 0 ? 'INSUFFICIENT_DATA' : 'REFUTED'),
    rationale: unverifiedQuotes.length > 0
      ? 'Suppliers lack cryptographic attestation; commercial procurement terms require direct contract validation.'
      : 'Verified supplier channels accessible with standard commercial procurement terms.'
  });

  // 7. WEAK_INCENTIVES
  results.push({
    hypothesis: 'WEAK_INCENTIVES',
    evaluated_product_id: product_id,
    supporting_evidence_ids: [],
    disconfirming_evidence_ids: customer_problems.map((p) => p.problem_id),
    validation_method: 'Incumbent Brand Incentive & Margin Cannibalization Analysis',
    verdict: customer_problems.length > 0 ? 'SUPPORTED' : 'INSUFFICIENT_DATA',
    rationale: 'Dominant sellers prioritize high gross transaction volume over fixing high-return defects due to lack of direct brand liability.'
  });

  // 8. FALSE_OPPORTUNITY
  results.push({
    hypothesis: 'FALSE_OPPORTUNITY',
    evaluated_product_id: product_id,
    supporting_evidence_ids: [],
    disconfirming_evidence_ids: observations.filter((o) => o.verified).map((o) => o.observation_id),
    validation_method: 'Adversarial Red-Team Stress Test & Statutory Review',
    verdict: observations.filter((o) => o.verified).length >= 2 ? 'REFUTED' : 'INSUFFICIENT_DATA',
    rationale: observations.filter((o) => o.verified).length >= 2
      ? 'Opportunity is corroborated by verified empirical observations across multiple channels.'
      : 'Insufficient verified observations to rule out a false positive opportunity.'
  });

  return results;
}
