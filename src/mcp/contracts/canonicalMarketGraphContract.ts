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
// 9. HYPOTHESIS & LIFECYCLE
// ============================================================================

export type HypothesisStage =
  | 'DETECTED'
  | 'EVIDENCE_GATHERING'
  | 'UNDER_CHALLENGE'
  | 'VALIDATION_REQUIRED'
  | 'PAPER_TEST'
  | 'HUMAN_REVIEW'
  | 'FORMULATED'
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
  readonly explanation_type?: IncumbentFailureHypothesisType;
  readonly hypothesis_statement?: string;
  readonly validation_method?: string;
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

export const INCUMBENT_FAILURE_HYPOTHESIS_STATEMENTS: Record<IncumbentFailureHypothesisType, string> = {
  ECONOMICS_UNVIABLE: 'Quality improvement costs more than buyer willingness to pay',
  DEMAND_FRAGMENTATION: 'Need exists, but too few buyers share the same specification',
  MANUFACTURING_CONSTRAINTS: 'Consistent material, tolerances, or finishing require specialized capex or expertise',
  DISTRIBUTION_CONSTRAINTS: 'Marketplace fees, returns, or dispersed freight consume the margin',
  INFORMATION_ASYMMETRY: 'Buyers cannot verify material grade or quality before purchase',
  PROCUREMENT_FRICTION: 'B2B buyers require certifications, traceability, vendor approval, or credit terms',
  WEAK_INCENTIVES: 'Buyer bears failure cost while incumbent seller receives little penalty',
  FALSE_OPPORTUNITY: 'Complaints are rare, unrepresentative, or already solved by substitutes'
};

export interface IncumbentFailureHypothesisEvaluation {
  readonly explanation_type: IncumbentFailureHypothesisType;
  readonly hypothesis: IncumbentFailureHypothesisType; // backward compatibility
  readonly hypothesis_statement: string;
  readonly evaluated_product_id: string;
  readonly supporting_evidence_ids: readonly string[];
  readonly disconfirming_evidence_ids: readonly string[];
  readonly validation_method: string;
  readonly status: 'SUPPORTED' | 'DISCONFIRMED' | 'VALIDATION_REQUIRED';
  readonly verdict: 'SUPPORTED' | 'REFUTED' | 'INSUFFICIENT_DATA'; // backward compatibility
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

  // Helper to construct aligned evaluation object
  const buildEval = (
    type: IncumbentFailureHypothesisType,
    supporting: string[],
    disconfirming: string[],
    validationMethod: string,
    status: 'SUPPORTED' | 'DISCONFIRMED' | 'VALIDATION_REQUIRED',
    rationale: string
  ): IncumbentFailureHypothesisEvaluation => {
    const verdictMap: Record<string, 'SUPPORTED' | 'REFUTED' | 'INSUFFICIENT_DATA'> = {
      SUPPORTED: 'SUPPORTED',
      DISCONFIRMED: 'REFUTED',
      VALIDATION_REQUIRED: 'INSUFFICIENT_DATA'
    };
    return {
      explanation_type: type,
      hypothesis: type,
      hypothesis_statement: INCUMBENT_FAILURE_HYPOTHESIS_STATEMENTS[type],
      evaluated_product_id: product_id,
      supporting_evidence_ids: supporting,
      disconfirming_evidence_ids: disconfirming,
      validation_method: validationMethod,
      status,
      verdict: verdictMap[status],
      rationale
    };
  };

  // 1. ECONOMICS_UNVIABLE (Quality improvement costs more than buyer willingness to pay)
  const unprofitableScenarios = unit_economics.filter((u) => !u.is_profitable || u.contribution_margin_bps < 1000);
  const profitableScenarios = unit_economics.filter((u) => u.is_profitable && u.contribution_margin_bps >= 1500);
  const econStatus: 'SUPPORTED' | 'DISCONFIRMED' | 'VALIDATION_REQUIRED' =
    unit_economics.length === 0
      ? 'VALIDATION_REQUIRED'
      : (unprofitableScenarios.length > 0 ? 'SUPPORTED' : 'DISCONFIRMED');
  results.push(
    buildEval(
      'ECONOMICS_UNVIABLE',
      unprofitableScenarios.map((u) => u.scenario_id),
      profitableScenarios.map((u) => u.scenario_id),
      'Pure BigInt Unit Economics Scenario Matrix',
      econStatus,
      unprofitableScenarios.length > 0
        ? `Economics unviable in ${unprofitableScenarios.length} channel scenario(s) due to margin compression (<1000 bps).`
        : (unit_economics.length === 0
          ? 'Missing unit economics scenarios; empirical pricing inputs required to evaluate economic viability.'
          : 'Unit economics demonstrate viable commercial spread across modeled channels.')
    )
  );

  // 2. DEMAND_FRAGMENTATION (Need exists, but too few buyers share the same specification)
  const highVarianceProblems = customer_problems.filter((p) => p.failure_frequency_pct < 15);
  const dominantProblems = customer_problems.filter((p) => p.failure_frequency_pct >= 25);
  const fragStatus: 'SUPPORTED' | 'DISCONFIRMED' | 'VALIDATION_REQUIRED' =
    customer_problems.length === 0
      ? 'VALIDATION_REQUIRED'
      : (highVarianceProblems.length > 3 ? 'SUPPORTED' : 'DISCONFIRMED');
  results.push(
    buildEval(
      'DEMAND_FRAGMENTATION',
      highVarianceProblems.map((p) => p.problem_id),
      dominantProblems.map((p) => p.problem_id),
      'Grievance Frequency Cluster Analysis',
      fragStatus,
      highVarianceProblems.length > 3
        ? 'Customer complaints are fragmented across low-frequency edge cases with no dominant cluster.'
        : (customer_problems.length === 0
          ? 'No customer complaint observations registered; customer pain clustering required.'
          : 'Dominant cluster identified; demand is cohesive around core mechanical/packaging pain point.')
    )
  );

  // 3. MANUFACTURING_CONSTRAINTS (Consistent material, tolerances, or finishing require specialized capex or expertise)
  const unverifiedQuotes = supplier_quotes.filter((q) => q.verification_status === 'UNVERIFIED');
  const verifiedQuotes = supplier_quotes.filter((q) => q.verification_status !== 'UNVERIFIED');
  const hasHighMoqOrLead = supplier_quotes.some((q) => q.moq_units > 10000 || q.lead_time_days > 30);
  const mfgStatus: 'SUPPORTED' | 'DISCONFIRMED' | 'VALIDATION_REQUIRED' =
    supplier_quotes.length === 0
      ? 'VALIDATION_REQUIRED'
      : (hasHighMoqOrLead ? 'SUPPORTED' : 'DISCONFIRMED');
  results.push(
    buildEval(
      'MANUFACTURING_CONSTRAINTS',
      unverifiedQuotes.map((q) => q.quote_id),
      verifiedQuotes.map((q) => q.quote_id),
      'Supplier MOQ & Lead Time Constraint Audit',
      mfgStatus,
      hasHighMoqOrLead
        ? 'High MOQ (>10,000 units) or long lead time (>30 days) creates manufacturing working capital constraint.'
        : (supplier_quotes.length === 0
          ? 'No empirical supplier quotes available; manufacturing capability audit required.'
          : 'Supplier manufacturing terms and batch sizes are within acceptable working capital limits.')
    )
  );

  // 4. DISTRIBUTION_CONSTRAINTS (Marketplace fees, returns, or dispersed freight consume the margin)
  const highFeeChannels = unit_economics.filter((u) => {
    const feeRatio = (u.platform_referral_fee_inr + u.platform_fulfillment_fee_inr) / (u.retail_selling_price_inr || 1);
    return feeRatio > 0.40;
  });
  const distStatus: 'SUPPORTED' | 'DISCONFIRMED' | 'VALIDATION_REQUIRED' =
    unit_economics.length === 0
      ? 'VALIDATION_REQUIRED'
      : (highFeeChannels.length === unit_economics.length ? 'SUPPORTED' : 'DISCONFIRMED');
  results.push(
    buildEval(
      'DISTRIBUTION_CONSTRAINTS',
      highFeeChannels.map((u) => u.scenario_id),
      unit_economics.filter((u) => !highFeeChannels.includes(u)).map((u) => u.scenario_id),
      'Marketplace Logistics Fee & Weight Threshold Verification',
      distStatus,
      highFeeChannels.length === unit_economics.length && unit_economics.length > 0
        ? 'High marketplace referral and fulfillment fees (>40% of ASP) consume viable commercial spread across all channels.'
        : (unit_economics.length === 0
          ? 'Carrier routes and dimensional weight handling require empirical fulfillment rate verification.'
          : 'At least one distribution channel maintains viable logistics and platform fee burden.')
    )
  );

  // 5. INFORMATION_ASYMMETRY (Buyers cannot verify material grade or quality before purchase)
  const marketingClaims = observations.filter((o) => o.kind === 'MARKETING_CLAIM');
  const allegations = observations.filter((o) => o.kind === 'CUSTOMER_ALLEGATION');
  const measuredFindings = observations.filter((o) => o.kind === 'MEASURED_RESULT' || o.kind === 'VERIFIED_TECHNICAL_FINDING');
  const asymStatus: 'SUPPORTED' | 'DISCONFIRMED' | 'VALIDATION_REQUIRED' =
    allegations.length > 0 && marketingClaims.length > 0
      ? 'SUPPORTED'
      : (observations.length === 0 ? 'VALIDATION_REQUIRED' : (measuredFindings.length >= 2 ? 'DISCONFIRMED' : 'VALIDATION_REQUIRED'));
  results.push(
    buildEval(
      'INFORMATION_ASYMMETRY',
      allegations.map((o) => o.observation_id),
      measuredFindings.map((o) => o.observation_id),
      'Marketing Claim vs Laboratory / Physical Measurement Comparison',
      asymStatus,
      allegations.length > 0 && marketingClaims.length > 0
        ? 'Competitors market premium specifications (MARKETING_CLAIM) but customer allegations reveal unverified metallurgy/durability defects.'
        : (measuredFindings.length >= 2
          ? 'Physical lab measurements (MEASURED_RESULT / VERIFIED_TECHNICAL_FINDING) transparently verify technical specifications.'
          : 'Insufficient paired marketing claims and measured findings to assess information asymmetry.')
    )
  );

  // 6. PROCUREMENT_FRICTION (B2B buyers require certifications, traceability, vendor approval, or credit terms)
  const attestedQuotes = supplier_quotes.filter((q) => q.verification_status === 'CRYPTOGRAPHICALLY_ATTESTED');
  const procStatus: 'SUPPORTED' | 'DISCONFIRMED' | 'VALIDATION_REQUIRED' =
    supplier_quotes.length === 0
      ? 'VALIDATION_REQUIRED'
      : (unverifiedQuotes.length > 0 ? 'SUPPORTED' : 'DISCONFIRMED');
  results.push(
    buildEval(
      'PROCUREMENT_FRICTION',
      unverifiedQuotes.map((q) => q.quote_id),
      attestedQuotes.map((q) => q.quote_id),
      'Supplier Onboarding & Payment Term Friction Assessment',
      procStatus,
      unverifiedQuotes.length > 0
        ? 'Suppliers lack cryptographic attestation; commercial procurement terms require direct contract validation.'
        : (supplier_quotes.length === 0
          ? 'No supplier quotes recorded; procurement friction cannot be established.'
          : 'Verified supplier channels accessible with standard commercial procurement terms.')
    )
  );

  // 7. WEAK_INCENTIVES (Buyer bears failure cost while incumbent seller receives little penalty)
  const criticalProblems = customer_problems.filter((p) => p.failure_severity === 'CRITICAL' || p.failure_severity === 'HIGH');
  const incStatus: 'SUPPORTED' | 'DISCONFIRMED' | 'VALIDATION_REQUIRED' =
    customer_problems.length === 0
      ? 'VALIDATION_REQUIRED'
      : (criticalProblems.length > 0 ? 'SUPPORTED' : 'DISCONFIRMED');
  results.push(
    buildEval(
      'WEAK_INCENTIVES',
      criticalProblems.map((p) => p.problem_id),
      customer_problems.filter((p) => !criticalProblems.includes(p)).map((p) => p.problem_id),
      'Incumbent Brand Incentive & Margin Cannibalization Analysis',
      incStatus,
      criticalProblems.length > 0
        ? 'Dominant sellers prioritize high gross transaction volume over fixing recurring high-severity defects due to lack of direct brand liability.'
        : (customer_problems.length === 0
          ? 'No customer grievance data available to assess seller incentive alignment.'
          : 'Defect rates are minor; incumbent sellers maintain active quality control feedback loops.')
    )
  );

  // 8. FALSE_OPPORTUNITY (Complaints are rare, unrepresentative, or already solved by substitutes)
  const verifiedObs = observations.filter((o) => o.verified);
  const falseStatus: 'SUPPORTED' | 'DISCONFIRMED' | 'VALIDATION_REQUIRED' =
    verifiedObs.length >= 2
      ? 'DISCONFIRMED'
      : (observations.length === 0 ? 'VALIDATION_REQUIRED' : 'SUPPORTED');
  results.push(
    buildEval(
      'FALSE_OPPORTUNITY',
      observations.filter((o) => !o.verified).map((o) => o.observation_id),
      verifiedObs.map((o) => o.observation_id),
      'Adversarial Red-Team Stress Test & Empirical Corroboration',
      falseStatus,
      verifiedObs.length >= 2
        ? 'Opportunity is corroborated by verified empirical observations across multiple independent channels.'
        : (observations.length === 0
          ? 'No observations recorded to test opportunity validity.'
          : 'Observations lack independent verification or cross-channel corroboration; high risk of false positive opportunity.')
    )
  );

  return results;
}
