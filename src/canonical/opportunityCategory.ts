/**
 * POC-001: Category-Agnostic Opportunity Classification & Verification Contracts (OD-27)
 *
 * Implements category-agnostic discovery and category-aware verification contracts:
 * 1. Category Classification: Extensible taxonomy covering Physical Goods, Software/Digital,
 *    Services, B2B Distribution, and Unresolved Novel categories.
 * 2. Novel Category Preservation: Unseen or ambiguous categories enter discovery with state
 *    UNRESOLVED_NOVEL instead of being rejected by a restrictive allowlist.
 * 3. Tailored Verification Profiles: Category-specific verification requirements (e.g. software
 *    checks SLA and infra costs; physical checks freight corridors and HSN tariff schedules).
 */

export type OpportunityCategory =
  | 'PHYSICAL_GOODS'
  | 'SOFTWARE_DIGITAL'
  | 'SERVICE_CONTRACT'
  | 'B2B_DISTRIBUTION'
  | 'UNRESOLVED_NOVEL'
  | string;

export interface CategoryVerificationRequirements {
  readonly category: OpportunityCategory;
  readonly requires_upstream_quote: boolean;
  readonly requires_prevailing_price: boolean;
  readonly requires_verbatim_reviews: boolean;
  readonly requires_logistics_route: boolean;
  readonly requires_regulatory_clearance: boolean;
  readonly category_specific_critical_fields: readonly string[];
  readonly description: string;
}

export const CATEGORY_VERIFICATION_REQUIREMENTS: Record<string, CategoryVerificationRequirements> = {
  PHYSICAL_GOODS: {
    category: 'PHYSICAL_GOODS',
    requires_upstream_quote: true,
    requires_prevailing_price: true,
    requires_verbatim_reviews: true,
    requires_logistics_route: true,
    requires_regulatory_clearance: true,
    category_specific_critical_fields: [
      'factory_gate_quote_inr',
      'prevailing_retail_asp_inr',
      'review_sentiment_summary',
      'logistics_freight_corridor',
      'statutory_hsn_gst_rate'
    ],
    description: 'Physical commodities, manufactured hardware, components, and consumer goods requiring freight & HSN clearance.'
  },
  SOFTWARE_DIGITAL: {
    category: 'SOFTWARE_DIGITAL',
    requires_upstream_quote: false, // Software pricing is direct subscription/license, no factory quote
    requires_prevailing_price: true, // Subscription / license price
    requires_verbatim_reviews: true, // User satisfaction / bug reports
    requires_logistics_route: false, // Digital distribution, no physical freight
    requires_regulatory_clearance: true, // Licensing, SLA, terms of service
    category_specific_critical_fields: [
      'prevailing_retail_asp_inr',
      'review_sentiment_summary',
      'statutory_regulatory_clearance'
    ],
    description: 'SaaS utilities, developer APIs, digital assets, and downloadable software products.'
  },
  SERVICE_CONTRACT: {
    category: 'SERVICE_CONTRACT',
    requires_upstream_quote: false, // Labor / expert delivery rate, no factory gate quote
    requires_prevailing_price: true, // Contract billing rate
    requires_verbatim_reviews: true, // Client testimonials / service quality records
    requires_logistics_route: false, // Service SLA / remote or local delivery
    requires_regulatory_clearance: true, // Professional accreditation, GST service code
    category_specific_critical_fields: [
      'prevailing_retail_asp_inr',
      'review_sentiment_summary',
      'statutory_regulatory_clearance'
    ],
    description: 'Specialized lab testing, industrial calibration, professional engineering, or operational maintenance SLAs.'
  },
  B2B_DISTRIBUTION: {
    category: 'B2B_DISTRIBUTION',
    requires_upstream_quote: true,
    requires_prevailing_price: true,
    requires_verbatim_reviews: true,
    requires_logistics_route: true,
    requires_regulatory_clearance: true,
    category_specific_critical_fields: [
      'factory_gate_quote_inr',
      'prevailing_retail_asp_inr',
      'review_sentiment_summary',
      'logistics_freight_corridor',
      'statutory_hsn_gst_rate'
    ],
    description: 'Wholesale institutional supply, bulk industrial consumables, and distributor contracts.'
  },
  UNRESOLVED_NOVEL: {
    category: 'UNRESOLVED_NOVEL',
    requires_upstream_quote: false,
    requires_prevailing_price: false,
    requires_verbatim_reviews: false,
    requires_logistics_route: false,
    requires_regulatory_clearance: false,
    category_specific_critical_fields: [
      'category_classification_required',
      'commercial_market_boundary_definition'
    ],
    description: 'Novel or unclassified commercial opportunity requiring human or dynamic category triage.'
  }
};

/**
 * Returns verification requirements tailored to a candidate's category.
 * Defaults to UNRESOLVED_NOVEL if unseen or novel, ensuring zero allowlist rejections.
 */
export function getCategoryVerificationRequirements(category?: string | null): CategoryVerificationRequirements {
  const normCategory = (category || 'UNRESOLVED_NOVEL').toUpperCase();
  if (normCategory in CATEGORY_VERIFICATION_REQUIREMENTS) {
    return CATEGORY_VERIFICATION_REQUIREMENTS[normCategory];
  }

  // Extensible fallback: treat any unseen category as a novel category preserving candidate discovery
  return {
    category: category || 'UNRESOLVED_NOVEL',
    requires_upstream_quote: false,
    requires_prevailing_price: false,
    requires_verbatim_reviews: false,
    requires_logistics_route: false,
    requires_regulatory_clearance: false,
    category_specific_critical_fields: [
      'category_classification_required',
      'commercial_market_boundary_definition'
    ],
    description: `Extensible novel category [${category}] preserved in discovery funnel without allowlist rejection.`
  };
}

/**
 * Infers category from a canonical entity ID or metadata hint.
 */
export function inferCategoryFromEntityId(entityId: string, hintCategory?: string): OpportunityCategory {
  if (hintCategory && hintCategory.trim().length > 0) {
    const norm = hintCategory.trim().toUpperCase();
    if (['PHYSICAL_GOODS', 'SOFTWARE_DIGITAL', 'SERVICE_CONTRACT', 'B2B_DISTRIBUTION'].includes(norm)) {
      return norm as OpportunityCategory;
    }
    return hintCategory.trim();
  }

  const lower = entityId.toLowerCase();
  if (lower.startsWith('noncanonical:')) {
    const parts = lower.split(':');
    if (parts.length >= 2 && parts[1]) {
      const rawCat = parts[1].toUpperCase();
      if (['PHYSICAL_GOODS', 'SOFTWARE_DIGITAL', 'SERVICE_CONTRACT', 'B2B_DISTRIBUTION'].includes(rawCat)) {
        return rawCat as OpportunityCategory;
      }
      return parts[1];
    }
  }
  if (lower.startsWith('software:') || lower.startsWith('saas:') || lower.startsWith('api:') || lower.startsWith('app:')) {
    return 'SOFTWARE_DIGITAL';
  }
  if (lower.startsWith('service:') || lower.startsWith('sla:') || lower.startsWith('lab:') || lower.startsWith('consult:')) {
    return 'SERVICE_CONTRACT';
  }
  if (lower.startsWith('b2b:') || lower.startsWith('dist:') || lower.startsWith('bulk:')) {
    return 'B2B_DISTRIBUTION';
  }
  if (lower.startsWith('prod:') || lower.startsWith('sku:') || lower.startsWith('asin:')) {
    return 'PHYSICAL_GOODS';
  }
  if (lower.startsWith('novel:') || lower.startsWith('unseen:') || lower.startsWith('unknown:')) {
    return 'UNRESOLVED_NOVEL';
  }

  return 'UNRESOLVED_NOVEL';
}
