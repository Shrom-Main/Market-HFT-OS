/**
 * POC-001: Canonical Entity & Identity Resolver (Slice 2)
 *
 * Implements deterministic resolution of market signals, supplier quotes,
 * and web captures to canonical institutional entities:
 * 1. Product & SKU Resolution (matching ASIN, supplier SKU, HSN + spec, or explicit mapping)
 * 2. Unambiguous Entity Hold: Rejects ambiguous/unknown listings to UNRESOLVED_ENTITY_HOLD
 * 3. Immutable digests: raw_capture_sha256 + normalized_observation_sha256 (RFC 8785 JCS)
 * 4. Cross-Source Conflict Detection: Preserves conflicting quotes without averaging
 */

import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sanitizeForJcs } from '../agents/m6AgentFramework.js';
import { OpportunityCategory, inferCategoryFromEntityId } from '../canonical/opportunityCategory.js';

export type EntityResolutionStatus =
  | 'RESOLVED'
  | 'RESOLVED_NOVEL_CATEGORY'
  | 'UNRESOLVED_ENTITY_HOLD'
  | 'CONFLICT_DETECTED';

export interface CanonicalProductDefinition {
  product_id: string;
  sku_id: string;
  name: string;
  asins: string[];
  supplier_skus: string[];
  hsn_code: string;
  default_sourcing_hub: string;
  default_marketplace: string;
  pack_units: number;
  keywords: string[];
  category?: OpportunityCategory;
}

export interface RawObservationEnvelope {
  source_id: string;
  target_url?: string;
  raw_payload: string | Record<string, unknown>;
  event_time_utc?: string;
  receipt_time_utc?: string;
  origin_class?: string;
  extracted_fields?: Record<string, unknown>;
  target_sku_id?: string;
  product_id?: string;
  category?: OpportunityCategory;
  custom_parameters?: Record<string, unknown>;
}

export interface ResolvedCanonicalIdentity {
  product_id: string;
  sku_id: string;
  category?: OpportunityCategory;
  supplier_id?: string;
  seller_id?: string;
  marketplace_id: string;
  sourcing_hub_region?: string;
  hsn_code: string;
  pack_units: number;
  resolution_status: EntityResolutionStatus;
  resolution_notes: string;
  raw_capture_sha256: string;
  normalized_observation_sha256: string;
  extracted_metrics: Record<string, unknown>;
}

export interface CrossSourceConflictRecord {
  product_id: string;
  metric_name: string;
  source_a_id: string;
  source_a_value: unknown;
  source_b_id: string;
  source_b_value: unknown;
  detected_at_utc: string;
  verification_status: 'CONFLICT_DETECTED';
  conflict_notes: string;
  has_conflict?: boolean;
  all_observations?: readonly { readonly source_id: string; readonly value: unknown; readonly observed_at_utc: string }[];
  jcs_sha256: string;
}

export class EntityIdentityResolver {
  private static readonly CANONICAL_CATALOG: CanonicalProductDefinition[] = [
    {
      product_id: 'prod:din3017:ss304:16-25mm:pack-10',
      sku_id: 'SKU-SS304-16-25MM-P10',
      name: 'SS304 Worm-Drive Hose Clamps (DIN 3017 W4)',
      asins: ['B09XYZ1234', 'B09XYZ'],
      supplier_skus: ['HOWRAH-SS304-16-25', 'DIN3017-SS304-16-25-P10', 'SS304-16-25MM-P10', 'SS304-CLAMP-16-25'],
      hsn_code: '73269099',
      default_sourcing_hub: 'HOWRAH_WEST_BENGAL',
      default_marketplace: 'AMAZON_IN',
      pack_units: 10,
      keywords: ['hose clamp', 'worm drive', 'din 3017', 'ss304 clamp']
    },
    {
      product_id: 'prod:brass:ball-valve:1-2in-pn20',
      sku_id: 'SKU-VALVE-BRASS-15MM-PN20',
      name: 'Forged Brass Ball Valve (1/2" PN20 Full Bore IS 9890)',
      asins: ['B08BRASS12', 'B08BRASS'],
      supplier_skus: ['JAMNAGAR-BRASS-15MM', 'BRASS-VALVE-15MM', 'BRASS-BALL-VALVE'],
      hsn_code: '84818020',
      default_sourcing_hub: 'JAMNAGAR_GUJARAT',
      default_marketplace: 'INDIAMART',
      pack_units: 2,
      keywords: ['ball valve', 'brass valve', 'pn20', 'is 9890']
    },
    {
      product_id: 'prod:electrical:mcb:16a-c-curve',
      sku_id: 'SKU-MCB-16A-1P-C-CURVE',
      name: '16A C-Curve Miniature Circuit Breaker (BIS / IS 60898)',
      asins: ['B08MCB16A0', 'B08MCB'],
      supplier_skus: ['HAVELLS-MCB-C16', 'MCB-16A-1P', 'MCB-C16'],
      hsn_code: '85362030',
      default_sourcing_hub: 'HARIDWAR_UTTARAKHAND',
      default_marketplace: 'AMAZON_IN',
      pack_units: 6,
      keywords: ['mcb', 'circuit breaker', 'c-curve', '16a mcb']
    },
    {
      product_id: 'prod:festive:diya:terracotta-12p',
      sku_id: 'SKU-DIYA-CLAY-TRAD-12P',
      name: 'Handcrafted Terracotta Clay Diya (12-Pack Festive)',
      asins: ['B09DIYA12P', 'B09DIYA'],
      supplier_skus: ['KUMARTULI-DIYA-12P', 'CLAY-DIYA-12', 'DIYA-PACK-12'],
      hsn_code: '69120090',
      default_sourcing_hub: 'KOLKATA_WEST_BENGAL',
      default_marketplace: 'INDIAMART',
      pack_units: 12,
      keywords: ['diya', 'terracotta', 'clay diya']
    },
    {
      product_id: 'prod:wellness:candle:soy-lavender',
      sku_id: 'SKU-CANDLE-SOY-LAV-8OZ',
      name: 'Aromatherapy Hand-Poured Soy Wax Candle (Lavender & Cedar)',
      asins: ['B07SOYCANDLE', 'B07CANDLE'],
      supplier_skus: ['AHMEDABAD-CANDLE-SOY', 'SOY-CANDLE-LAV', 'CANDLE-SOY-8OZ'],
      hsn_code: '34060010',
      default_sourcing_hub: 'AHMEDABAD_GUJARAT',
      default_marketplace: 'AMAZON_IN',
      pack_units: 4,
      keywords: ['soy candle', 'lavender candle', 'scented candle']
    },
    {
      product_id: 'prod:lighting:fairy-lights:10m-usb',
      sku_id: 'SKU-LIGHT-FAIRY-10M-USB',
      name: 'Warm White LED Copper Wire Fairy Lights (10m USB)',
      asins: ['B08FAIRY10M', 'B08FAIRY'],
      supplier_skus: ['DELHI-LIGHTS-10M', 'FAIRY-LIGHTS-USB', 'LED-FAIRY-10M'],
      hsn_code: '94054090',
      default_sourcing_hub: 'DELHI_NCR',
      default_marketplace: 'AMAZON_IN',
      pack_units: 5,
      keywords: ['fairy lights', 'copper wire lights', 'led lights 10m']
    },
    {
      product_id: 'prod:fasteners:hex-bolt:m10-grade-8-8',
      sku_id: 'SKU-BOLT-HEX-M10-G88-50P',
      name: 'High-Tensile Grade 8.8 Hex Bolts & Nuts (M10 x 50mm, 50-Pack)',
      asins: ['B07HEXBOLTM10', 'B07HEXBOLT'],
      supplier_skus: ['LUDHIANA-HEX-BOLT-M10', 'HEX-BOLT-M10-88', 'BOLT-GRADE-8-8'],
      hsn_code: '73181500',
      default_sourcing_hub: 'LUDHIANA_PUNJAB',
      default_marketplace: 'INDIAMART',
      pack_units: 50,
      keywords: ['hex bolt', 'grade 8.8', 'm10 bolt']
    },
    {
      product_id: 'prod:sealing:o-ring-kit:silicone-225p',
      sku_id: 'SKU-SEAL-ORING-SIL-225K',
      name: 'Food-Grade Silicone O-Ring Assortment Kits (225 pcs, 18 Sizes)',
      asins: ['B09ORING225', 'B09ORING'],
      supplier_skus: ['PUNE-ORING-225', 'SILICONE-ORING-KIT', 'ORING-KIT-225'],
      hsn_code: '40169320',
      default_sourcing_hub: 'PUNE_MAHARASHTRA',
      default_marketplace: 'AMAZON_IN',
      pack_units: 1,
      keywords: ['o-ring', 'silicone o-ring', 'o-ring kit 225']
    }
  ];

  private metricObservations: Map<string, { source_id: string; value: unknown; observed_at_utc: string }[]> = new Map();
  private conflictLedger: CrossSourceConflictRecord[] = [];

  /**
   * Resolves incoming capture envelope to canonical entity or UNRESOLVED_ENTITY_HOLD.
   */
  public resolveIdentity(envelope: RawObservationEnvelope): ResolvedCanonicalIdentity {
    const rawStr = typeof envelope.raw_payload === 'string'
      ? envelope.raw_payload
      : JSON.stringify(envelope.raw_payload);
    const rawCaptureSha256 = sha256(rawStr);

    let extracted: Record<string, unknown> = {};
    if (typeof envelope.raw_payload === 'object' && envelope.raw_payload !== null) {
      extracted = { ...envelope.raw_payload };
    } else {
      try {
        extracted = JSON.parse(rawStr);
      } catch {
        // Text / HTML extraction
        const priceM = rawStr.match(/data-price=["']?(\d+(?:\.\d+)?)["']?/i) || rawStr.match(/₹\s*(\d+(?:\.\d+)?)/i);
        const moqM = rawStr.match(/data-moq=["']?(\d+)["']?/i) || rawStr.match(/MOQ:\s*(\d+)/i);
        const freightM = rawStr.match(/data-freight=["']?(\d+(?:\.\d+)?)["']?/i) || rawStr.match(/freight[:\s]+(\d+(?:\.\d+)?)/i);
        const skuM = rawStr.match(/data-sku=["']?([^"'\s>]+)["']?/i);
        const asinM = rawStr.match(/data-asin=["']?([A-Z0-9]{10})["']?/i);
        const hsnM = rawStr.match(/data-hsn=["']?(\d{4,8})["']?/i) || rawStr.match(/HSN[:\s]+(\d{4,8})/i);

        if (priceM) extracted.gross_price_inr = parseFloat(priceM[1]);
        if (moqM) extracted.moq_units = parseInt(moqM[1], 10);
        if (freightM) extracted.inbound_freight_inr = parseFloat(freightM[1]);
        if (skuM) extracted.sku_id = skuM[1];
        if (asinM) extracted.asin = asinM[1];
        if (hsnM) extracted.hsn_code = hsnM[1];
      }
    }

    if (envelope.extracted_fields) {
      extracted = { ...extracted, ...envelope.extracted_fields };
    }

    // 1. Explicit ID Resolution
    const candidateId: string | undefined =
      typeof envelope.product_id === 'string'
        ? envelope.product_id
        : typeof envelope.custom_parameters?.product_id === 'string'
          ? (envelope.custom_parameters.product_id as string)
          : undefined;
    let matchedProd: CanonicalProductDefinition | undefined;

    if (candidateId) {
      matchedProd = EntityIdentityResolver.CANONICAL_CATALOG.find(
        (p) => p.product_id === candidateId || p.sku_id === candidateId
      );
    }

    // 2. Target SKU Resolution
    if (!matchedProd && (envelope.target_sku_id || extracted.sku_id || extracted.supplier_sku)) {
      const rawSku = envelope.target_sku_id || extracted.sku_id || extracted.supplier_sku;
      const skuQuery = String(rawSku).trim().toUpperCase();
      matchedProd = EntityIdentityResolver.CANONICAL_CATALOG.find((p) =>
        p.sku_id.toUpperCase() === skuQuery ||
        p.supplier_skus.some((s) => s.toUpperCase() === skuQuery)
      );
    }

    // 3. ASIN Resolution
    if (!matchedProd && (extracted.asin || envelope.target_url)) {
      const asinQuery = (extracted.asin as string || '').trim().toUpperCase();
      const url = envelope.target_url || '';
      matchedProd = EntityIdentityResolver.CANONICAL_CATALOG.find((p) =>
        (asinQuery && p.asins.some((a) => a.toUpperCase() === asinQuery)) ||
        (url && p.asins.some((a) => url.includes(a)))
      );
    }

    // 4. HSN Code + Spec Keyword Resolution
    if (!matchedProd && extracted.hsn_code) {
      const hsnQuery = String(extracted.hsn_code).trim();
      const candidates = EntityIdentityResolver.CANONICAL_CATALOG.filter((p) => p.hsn_code === hsnQuery);
      if (candidates.length === 1) {
        matchedProd = candidates[0];
      } else if (candidates.length > 1) {
        const textToSearch = (rawStr + ' ' + (envelope.target_url || '')).toLowerCase();
        matchedProd = candidates.find((c) => c.keywords.some((kw) => textToSearch.includes(kw)));
      }
    }

    // 5. Keyword heuristic fallback
    if (!matchedProd) {
      const lower = rawStr.toLowerCase();
      matchedProd = EntityIdentityResolver.CANONICAL_CATALOG.find((p) =>
        p.keywords.some((kw) => lower.includes(kw))
      );
    }

    // Fail closed if ambiguous or unresolvable
    if (!matchedProd) {
      const explicitCategory = envelope.category || (extracted.category as OpportunityCategory | undefined);
      const hasCategoryHint = Boolean(explicitCategory);

      // Distinguish explicit canonical identifiers with recognized URI schemes from raw, source-scoped SKUs
      const CANONICAL_SCHEMES = ['prod:', 'software:', 'service:', 'b2b:', 'novel:', 'saas:', 'api:', 'sla:', 'dist:', 'lab:'];
      const rawCandidateId = candidateId || (typeof extracted.product_id === 'string' ? (extracted.product_id as string) : undefined);
      const explicitCanonicalId = rawCandidateId && CANONICAL_SCHEMES.some((sch) => rawCandidateId.startsWith(sch))
        ? rawCandidateId
        : undefined;

      const rawSku = (
        typeof envelope.target_sku_id === 'string' && envelope.target_sku_id.trim().length > 0
          ? envelope.target_sku_id.trim()
          : typeof extracted.sku_id === 'string' && String(extracted.sku_id).trim().length > 0
            ? String(extracted.sku_id).trim()
            : typeof extracted.supplier_sku === 'string' && String(extracted.supplier_sku).trim().length > 0
              ? String(extracted.supplier_sku).trim()
              : undefined
      );

      const isExplicitNonHardware = Boolean(
        explicitCanonicalId && (
          explicitCanonicalId.startsWith('software:') ||
          explicitCanonicalId.startsWith('service:') ||
          explicitCanonicalId.startsWith('b2b:') ||
          explicitCanonicalId.startsWith('novel:') ||
          explicitCanonicalId.startsWith('saas:') ||
          explicitCanonicalId.startsWith('api:') ||
          explicitCanonicalId.startsWith('sla:') ||
          explicitCanonicalId.startsWith('dist:') ||
          explicitCanonicalId.startsWith('lab:')
        )
      );

      if (hasCategoryHint || isExplicitNonHardware || explicitCanonicalId) {
        let entityId: string;
        let skuId: string;
        const inferredCat = inferCategoryFromEntityId(explicitCanonicalId || rawSku || 'unclassified', explicitCategory);

        if (explicitCanonicalId) {
          // Explicit canonical identity: cross-source observations converge
          entityId = explicitCanonicalId;
          skuId = rawSku || `SKU-${entityId.toUpperCase().replace(/[^A-Z0-9_-]/g, '-')}`;
        } else {
          // Composite non-canonical identity: scopes raw SKUs to category and source connector
          // to prevent false merges of unrelated products sharing generic labels
          const catNamespace = (inferredCat || 'unclassified').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          const sourceScope = envelope.source_id.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          const skuSlug = rawSku ? rawSku.toLowerCase().trim() : sha256(rawStr).slice(0, 12);
          entityId = `noncanonical:${catNamespace}:${sourceScope}:${skuSlug}`;
          skuId = rawSku || `SKU-${skuSlug.toUpperCase()}`;
        }

        const isNovel = inferredCat === 'UNRESOLVED_NOVEL' || !['PHYSICAL_GOODS', 'SOFTWARE_DIGITAL', 'SERVICE_CONTRACT', 'B2B_DISTRIBUTION'].includes(inferredCat);
        const resStatus: EntityResolutionStatus = isNovel ? 'RESOLVED_NOVEL_CATEGORY' : 'RESOLVED';
        const marketplace = envelope.source_id.includes('amazon') ? 'AMAZON_IN'
          : envelope.source_id.includes('indiamart') ? 'INDIAMART'
          : envelope.source_id.includes('saas') ? 'SAAS_MARKETPLACE'
          : envelope.source_id.includes('services') ? 'SERVICE_PORTAL'
          : envelope.source_id.includes('ip') || envelope.source_id.includes('licensing') ? 'LICENSING_PORTAL'
          : 'COMMERCIAL_EXCHANGE';

        const normClaims = {
          product_id: entityId,
          sku_id: skuId,
          category: inferredCat,
          hsn_code: String(extracted.hsn_code || '00000000'),
          marketplace_id: marketplace,
          pack_units: typeof extracted.pack_units === 'number' ? extracted.pack_units : 1,
          metrics: extracted
        };

        return {
          product_id: entityId,
          sku_id: skuId,
          category: inferredCat,
          supplier_id: extracted.supplier_id as string || undefined,
          seller_id: extracted.seller_id as string || undefined,
          marketplace_id: marketplace,
          hsn_code: String(extracted.hsn_code || '00000000'),
          pack_units: typeof extracted.pack_units === 'number' ? extracted.pack_units : 1,
          resolution_status: resStatus,
          resolution_notes: isNovel
            ? `Preserved novel or unclassified commercial category [${inferredCat}] in discovery funnel without allowlist rejection.`
            : `Resolved category-agnostic opportunity [${inferredCat}] for entity ${entityId}.`,
          raw_capture_sha256: rawCaptureSha256,
          normalized_observation_sha256: sha256(canonicalizeJCS(sanitizeForJcs(normClaims))),
          extracted_metrics: extracted
        };
      }

      const unresIdentity: ResolvedCanonicalIdentity = {
        product_id: 'prod:unresolved',
        sku_id: 'SKU-UNRESOLVED',
        category: 'UNRESOLVED_NOVEL',
        marketplace_id: envelope.source_id.includes('amazon') ? 'AMAZON_IN' : 'UNKNOWN_MARKETPLACE',
        hsn_code: String(extracted.hsn_code || '00000000'),
        pack_units: 1,
        resolution_status: 'UNRESOLVED_ENTITY_HOLD',
        resolution_notes: `E-SCW-UNRESOLVED-ENTITY: Incoming capture from '${envelope.source_id}' cannot be unambiguously mapped to canonical catalog. Held in quarantine review.`,
        raw_capture_sha256: rawCaptureSha256,
        normalized_observation_sha256: sha256(canonicalizeJCS(sanitizeForJcs(extracted))),
        extracted_metrics: extracted
      };
      return unresIdentity;
    }

    // Determine marketplace and sourcing hub
    let marketplaceId = matchedProd.default_marketplace;
    if (envelope.source_id.includes('amazon')) marketplaceId = 'AMAZON_IN';
    else if (envelope.source_id.includes('indiamart')) marketplaceId = 'INDIAMART';
    else if (envelope.source_id.includes('gem')) marketplaceId = 'GEM_GOV_IN';

    let sourcingHub = matchedProd.default_sourcing_hub;
    if (extracted.hub_region) sourcingHub = String(extracted.hub_region);

    const normClaims = {
      product_id: matchedProd.product_id,
      sku_id: matchedProd.sku_id,
      category: matchedProd.category || 'PHYSICAL_GOODS',
      hsn_code: matchedProd.hsn_code,
      marketplace_id: marketplaceId,
      sourcing_hub_region: sourcingHub,
      pack_units: matchedProd.pack_units,
      metrics: extracted
    };

    const normSha256 = sha256(canonicalizeJCS(sanitizeForJcs(normClaims)));

    return {
      product_id: matchedProd.product_id,
      sku_id: matchedProd.sku_id,
      category: matchedProd.category || 'PHYSICAL_GOODS',
      supplier_id: extracted.supplier_id as string || undefined,
      seller_id: extracted.seller_id as string || undefined,
      marketplace_id: marketplaceId,
      sourcing_hub_region: sourcingHub,
      hsn_code: matchedProd.hsn_code,
      pack_units: matchedProd.pack_units,
      resolution_status: 'RESOLVED',
      resolution_notes: `Successfully resolved to ${matchedProd.product_id} (${matchedProd.sku_id}) via canonical catalog index.`,
      raw_capture_sha256: rawCaptureSha256,
      normalized_observation_sha256: normSha256,
      extracted_metrics: extracted
    };
  }

  /**
   * Registers a field metric and checks for cross-source disagreements.
   * If two independent sources report conflicting values for the same (product_id, metric_name),
   * records a CrossSourceConflictRecord and flags CONFLICT_DETECTED without averaging.
   */
  public registerMetricAndDetectConflicts(
    productId: string,
    metricName: string,
    sourceId: string,
    metricValue: unknown,
    toleranceFraction: number = 0.05
  ): { has_conflict: boolean; conflict_record?: CrossSourceConflictRecord } {
    const key = `${productId}:${metricName}`;
    const nowUtc = new Date().toISOString();

    if (!this.metricObservations.has(key)) {
      this.metricObservations.set(key, [{ source_id: sourceId, value: metricValue, observed_at_utc: nowUtc }]);
      return { has_conflict: false };
    }

    const history = this.metricObservations.get(key)!;
    // Check against prior observations from different sources
    for (const prior of history) {
      if (prior.source_id !== sourceId) {
        let isDiscrepancy = false;
        if (typeof metricValue === 'number' && typeof prior.value === 'number') {
          const diff = Math.abs(metricValue - prior.value);
          const avg = (metricValue + prior.value) / 2;
          if (avg > 0 && diff / avg > toleranceFraction) {
            isDiscrepancy = true;
          }
        } else if (metricValue !== prior.value) {
          isDiscrepancy = true;
        }

        if (isDiscrepancy) {
          const conflict: CrossSourceConflictRecord = {
            product_id: productId,
            metric_name: metricName,
            source_a_id: prior.source_id,
            source_a_value: prior.value,
            source_b_id: sourceId,
            source_b_value: metricValue,
            detected_at_utc: nowUtc,
            verification_status: 'CONFLICT_DETECTED',
            conflict_notes: `Cross-source conflict on '${metricName}': Source '${prior.source_id}' reported '${prior.value}', whereas Source '${sourceId}' reported '${metricValue}'. Values preserved independently without synthetic averaging.`,
            has_conflict: true,
            all_observations: [...history, { source_id: sourceId, value: metricValue, observed_at_utc: nowUtc }],
            jcs_sha256: ''
          };
          conflict.jcs_sha256 = sha256(canonicalizeJCS(sanitizeForJcs(conflict)));
          this.conflictLedger.push(conflict);
          history.push({ source_id: sourceId, value: metricValue, observed_at_utc: nowUtc });
          return { has_conflict: true, conflict_record: conflict };
        }
      }
    }

    history.push({ source_id: sourceId, value: metricValue, observed_at_utc: nowUtc });
    return { has_conflict: false };
  }

  public getConflicts(): CrossSourceConflictRecord[] {
    return [...this.conflictLedger];
  }
}
