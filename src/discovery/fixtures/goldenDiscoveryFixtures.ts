/**
 * POC-001: Stage 0 Discovery Screener — Versioned Attributable Golden Fixtures (Slice 2A)
 *
 * Provides versioned, deterministic, provenance-backed golden capture fixtures
 * representing real-world commercial market data for the SS304 DIN 3017 hose-clamp thesis
 * and adjacent industrial hardware theses.
 *
 * All fixtures are 100% offline-evaluable and contain zero live secrets.
 */

import { RawSourceCapture, createRawSourceCapture } from '../sourceAdapterContract.js';

export interface VersionedGoldenFixtureSet {
  readonly version: string;
  readonly fixture_set_id: string;
  readonly description: string;
  readonly fixtures: readonly RawSourceCapture[];
}

export const GOLDEN_DISCOVERY_FIXTURE_SET_V1: VersionedGoldenFixtureSet = {
  version: '1.0.0',
  fixture_set_id: 'fixture-set:india-b2b:v1.0.0',
  description: 'Attributable golden fixtures for SS304 DIN 3017 clamps and secondary industrial hardware',
  fixtures: [
    // 1. SS304 Clamp — Amazon India Retail Listing (Primary ASP observation)
    createRawSourceCapture({
      capture_id: 'FIX-AMZ-SS304-001',
      source_connector_id: 'conn:marketplace:amazon-in',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://www.amazon.in/dp/B09XYZ1234',
      source_observed_at_utc: '2026-10-24T10:00:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T10:00:02.100Z',
      raw_payload: JSON.stringify({
        asin: 'B09XYZ1234',
        title: 'SS304 Stainless Steel Worm-Drive Hose Clamps (16-25mm, Pack of 10, DIN 3017)',
        brand: 'Apex Fasteners India',
        price_inr: 850.0,
        pack_quantity: 10,
        unit_price_inr: 85.0,
        seller_count: 6,
        in_stock: true,
        rating: 4.4,
        review_count: 38,
        sentiment_summary: 'Corrosion-resistant DIN 3017 W4 stainless steel clamps with smooth worm drive screw and deburred edges.',
        delivery_days: 2,
        category: 'Industrial Hardware & Fasteners'
      }),
      extracted_fields: {
        asin: 'B09XYZ1234',
        gross_price_inr: 85.0,
        pack_units: 10,
        observed_seller_count: 6,
        review_sentiment_summary: 'Corrosion-resistant DIN 3017 W4 stainless steel clamps with smooth worm drive screw and deburred edges.'
      },
      provenance_signature: 'sig:golden:amz:ss304:b09xyz1234:v1'
    }),

    // 2. SS304 Clamp — IndiaMART Factory Gate Supplier Quote (Howrah cluster)
    createRawSourceCapture({
      capture_id: 'FIX-IMART-SS304-001',
      source_connector_id: 'conn:b2b:indiamart',
      source_type: 'SUPPLIER_B2B_CATALOG',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://www.indiamart.com/proddetail/howrah-ss304-16-25.html',
      source_observed_at_utc: '2026-10-24T10:15:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T10:15:03.450Z',
      raw_payload: JSON.stringify({
        supplier_id: 'sup:howrah-precision-clamps-01',
        supplier_name: 'Howrah Precision Clamp Works Pvt Ltd',
        hub_region: 'HOWRAH_WEST_BENGAL',
        supplier_sku: 'HOWRAH-SS304-16-25',
        hsn_code: '73269099',
        description: 'SS304 Worm Drive Hose Clamps 16-25mm W4 Grade Ex-Works Factory Quote',
        factory_gate_quote_inr: 25.0,
        unit_batch_moq: 100,
        lead_time_days: 5,
        estimated_freight_inr: 3.5,
        gst_rate_percent: 18,
        certifications: ['ISO 9001:2015', 'RoHS Compliant']
      }),
      extracted_fields: {
        supplier_sku: 'HOWRAH-SS304-16-25',
        hsn_code: '73269099',
        hub_region: 'HOWRAH_WEST_BENGAL',
        factory_gate_quote_inr: 25.0,
        unit_batch_moq: 100,
        has_logistics_route: true,
        has_regulatory_clearance: true
      },
      provenance_signature: 'sig:golden:imart:howrah:ss304:v1'
    }),

    // 3. SS304 Clamp — GeM Procurement Benchmark Tender
    createRawSourceCapture({
      capture_id: 'FIX-GEM-SS304-001',
      source_connector_id: 'conn:procurement:gem',
      source_type: 'GOV_PROCUREMENT',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://gem.gov.in/bid/GEM-BID-SS304-CLAMP-2026',
      source_observed_at_utc: '2026-10-24T10:30:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T10:30:01.800Z',
      raw_payload: JSON.stringify({
        bid_number: 'GEM/2026/B/894120',
        item_category: 'Stainless Steel Hose Clamps DIN 3017',
        hsn_code: '73269099',
        benchmark_price_inr: 75.0,
        procuring_department: 'Ministry of Railways / Integral Coach Factory',
        quantity_required: 5000,
        delivery_location: 'Chennai, Tamil Nadu'
      }),
      extracted_fields: {
        hsn_code: '73269099',
        benchmark_price_inr: 75.0,
        procurement_moq: 5000
      },
      provenance_signature: 'sig:golden:gem:tender:ss304:v1'
    }),

    // 4. SS304 Clamp — Price Change Observation (Retail ASP drops ₹85 -> ₹72)
    createRawSourceCapture({
      capture_id: 'FIX-AMZ-SS304-PRICE-DROP-002',
      source_connector_id: 'conn:marketplace:amazon-in',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://www.amazon.in/dp/B09XYZ1234',
      source_observed_at_utc: '2026-10-24T11:00:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T11:00:02.300Z',
      raw_payload: JSON.stringify({
        asin: 'B09XYZ1234',
        title: 'SS304 Stainless Steel Worm-Drive Hose Clamps (16-25mm, Pack of 10, DIN 3017)',
        price_inr: 720.0,
        pack_quantity: 10,
        unit_price_inr: 72.0,
        seller_count: 7,
        in_stock: true,
        sentiment_summary: 'Corrosion-resistant DIN 3017 W4 stainless steel clamps with smooth worm drive screw and deburred edges.'
      }),
      extracted_fields: {
        asin: 'B09XYZ1234',
        gross_price_inr: 72.0,
        pack_units: 10,
        observed_seller_count: 7
      },
      provenance_signature: 'sig:golden:amz:ss304:b09xyz1234:v2-price-drop'
    }),

    // 5. SS304 Clamp — Supplier Quote Update (Quote increases ₹25 -> ₹29)
    createRawSourceCapture({
      capture_id: 'FIX-IMART-SS304-QUOTE-UPDATE-003',
      source_connector_id: 'conn:b2b:indiamart',
      source_type: 'SUPPLIER_B2B_CATALOG',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://www.indiamart.com/proddetail/howrah-ss304-16-25.html',
      source_observed_at_utc: '2026-10-24T11:30:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T11:30:04.100Z',
      raw_payload: JSON.stringify({
        supplier_id: 'sup:howrah-precision-clamps-01',
        supplier_sku: 'HOWRAH-SS304-16-25',
        hsn_code: '73269099',
        hub_region: 'HOWRAH_WEST_BENGAL',
        factory_gate_quote_inr: 29.0,
        unit_batch_moq: 100,
        reason: 'Raw nickel and 304 alloy coil spot price increase'
      }),
      extracted_fields: {
        supplier_sku: 'HOWRAH-SS304-16-25',
        hsn_code: '73269099',
        factory_gate_quote_inr: 29.0,
        unit_batch_moq: 100
      },
      provenance_signature: 'sig:golden:imart:howrah:ss304:v3-quote-up'
    }),

    // 6. SS304 Clamp — Grievance Surfaced Observation (Customer defect complaints)
    createRawSourceCapture({
      capture_id: 'FIX-AMZ-SS304-GRIEVANCE-004',
      source_connector_id: 'conn:marketplace:amazon-in',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://www.amazon.in/dp/B09XYZ1234',
      source_observed_at_utc: '2026-10-24T12:00:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T12:00:03.000Z',
      raw_payload: JSON.stringify({
        asin: 'B09XYZ1234',
        title: 'SS304 Stainless Steel Worm-Drive Hose Clamps (16-25mm, Pack of 10, DIN 3017)',
        unit_price_inr: 85.0,
        pack_quantity: 10,
        sentiment_summary: 'Defect complaint: clamp band stripped under torque and broke on 3 units, poor quality control'
      }),
      extracted_fields: {
        asin: 'B09XYZ1234',
        gross_price_inr: 85.0,
        review_sentiment_summary: 'Defect complaint: clamp band stripped under torque and broke on 3 units, poor quality control'
      },
      provenance_signature: 'sig:golden:amz:ss304:grievance:v4'
    }),

    // 7. SS304 Clamp — Missing Quote ("Contact Supplier", null price)
    createRawSourceCapture({
      capture_id: 'FIX-IMART-SS304-MISSING-QUOTE-005',
      source_connector_id: 'conn:b2b:indiamart',
      source_type: 'SUPPLIER_B2B_CATALOG',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://www.indiamart.com/proddetail/ss304-clamp-unquoted.html',
      source_observed_at_utc: '2026-10-24T12:30:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T12:30:02.500Z',
      raw_payload: JSON.stringify({
        supplier_id: 'sup:unquoted-metal-works',
        supplier_sku: 'HOWRAH-SS304-16-25',
        hsn_code: '73269099',
        factory_gate_quote_inr: null,
        quote_text: 'Contact Supplier for Latest Price',
        unit_batch_moq: 500
      }),
      extracted_fields: {
        supplier_sku: 'HOWRAH-SS304-16-25',
        hsn_code: '73269099',
        factory_gate_quote_inr: null,
        unit_batch_moq: 500
      },
      provenance_signature: 'sig:golden:imart:missing-quote:v5'
    }),

    // 8. Secondary Product — Forged Brass Ball Valve 1/2" PN20 (Amazon India)
    createRawSourceCapture({
      capture_id: 'FIX-AMZ-BRASS-001',
      source_connector_id: 'conn:marketplace:amazon-in',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://www.amazon.in/dp/B08BRASS12',
      source_observed_at_utc: '2026-10-24T13:00:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T13:00:02.000Z',
      raw_payload: JSON.stringify({
        asin: 'B08BRASS12',
        title: 'Forged Brass Ball Valve (1/2" PN20 Full Bore IS 9890)',
        unit_price_inr: 320.0,
        pack_quantity: 2,
        seller_count: 4,
        sentiment_summary: 'Heavy duty forged brass valve with virgin PTFE seals and blow-out proof stem.'
      }),
      extracted_fields: {
        asin: 'B08BRASS12',
        gross_price_inr: 320.0,
        pack_units: 2,
        observed_seller_count: 4,
        review_sentiment_summary: 'Heavy duty forged brass valve with virgin PTFE seals and blow-out proof stem.'
      },
      provenance_signature: 'sig:golden:amz:brass:b08brass12:v1'
    }),

    // 9. Secondary Product — Forged Brass Ball Valve 1/2" PN20 (Jamnagar Supplier)
    createRawSourceCapture({
      capture_id: 'FIX-IMART-BRASS-001',
      source_connector_id: 'conn:b2b:indiamart',
      source_type: 'SUPPLIER_B2B_CATALOG',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://www.indiamart.com/proddetail/jamnagar-brass-15mm.html',
      source_observed_at_utc: '2026-10-24T13:15:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T13:15:03.200Z',
      raw_payload: JSON.stringify({
        supplier_id: 'sup:jamnagar-brass-foundry',
        supplier_sku: 'JAMNAGAR-BRASS-15MM',
        hub_region: 'JAMNAGAR_GUJARAT',
        hsn_code: '84818020',
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50
      }),
      extracted_fields: {
        supplier_sku: 'JAMNAGAR-BRASS-15MM',
        hsn_code: '84818020',
        hub_region: 'JAMNAGAR_GUJARAT',
        factory_gate_quote_inr: 115.0,
        unit_batch_moq: 50,
        has_logistics_route: true,
        has_regulatory_clearance: true
      },
      provenance_signature: 'sig:golden:imart:jamnagar:brass:v1'
    }),

    // 10. Ambiguous / Unresolvable Hardware Capture (No matching ASIN, SKU, or HSN)
    createRawSourceCapture({
      capture_id: 'FIX-UNKNOWN-WIDGET-001',
      source_connector_id: 'conn:marketplace:generic-hardware',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://generic-tools.example.com/item/mystery-bracket-99',
      source_observed_at_utc: '2026-10-24T14:00:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T14:00:01.000Z',
      raw_payload: JSON.stringify({
        item_name: 'Universal Mystery Metal Mounting Bracket L-Shape',
        unmatched_id: 'UNMATCHED-BRACKET-99',
        price_inr: 45.0
      }),
      extracted_fields: {
        item_name: 'Universal Mystery Metal Mounting Bracket L-Shape',
        gross_price_inr: 45.0
      },
      provenance_signature: 'sig:golden:generic:unknown-widget:v1'
    }),

    // 11. Category-Agnostic Unrelated 1: SaaS Developer Tool (Software / Digital)
    createRawSourceCapture({
      capture_id: 'FIX-SAAS-DEVTOOL-001',
      source_connector_id: 'conn:marketplace:developer-saas',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://marketplace.example.com/apps/ebpf-tracer-agent',
      source_observed_at_utc: '2026-10-24T15:00:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T15:00:02.000Z',
      raw_payload: JSON.stringify({
        product_id: 'software:devtools:distributed-tracing-agent',
        category: 'SOFTWARE_DIGITAL',
        title: 'Low-Latency eBPF Distributed Tracing Agent (Team Tier)',
        gross_price_inr: 4999.0,
        review_sentiment_summary: 'Sub-millisecond overhead, automated kernel instrumentation, high satisfaction among SRE teams.',
        has_regulatory_clearance: true
      }),
      extracted_fields: {
        product_id: 'software:devtools:distributed-tracing-agent',
        category: 'SOFTWARE_DIGITAL',
        title: 'Low-Latency eBPF Distributed Tracing Agent (Team Tier)',
        gross_price_inr: 4999.0,
        review_sentiment_summary: 'Sub-millisecond overhead, automated kernel instrumentation, high satisfaction among SRE teams.',
        has_regulatory_clearance: true
      },
      provenance_signature: 'sig:golden:saas:ebpf-tracer:v1'
    }),

    // 12. Category-Agnostic Unrelated 2: Metallurgy Testing Lab Service (Service Contract)
    createRawSourceCapture({
      capture_id: 'FIX-SERVICE-METALLURGY-001',
      source_connector_id: 'conn:b2b:services-portal',
      source_type: 'TRADE_REGISTRY',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://lab-portal.example.com/services/tensile-testing',
      source_observed_at_utc: '2026-10-24T15:30:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T15:30:02.000Z',
      raw_payload: JSON.stringify({
        product_id: 'service:lab:tensile-spectrometry-testing',
        category: 'SERVICE_CONTRACT',
        title: 'NABL Accredited Destructive Tensile & Spectrometry Metal Testing',
        gross_price_inr: 12500.0,
        review_sentiment_summary: 'Certified lab test reports delivered within 48h SLA, ISO 17025 accredited.',
        has_regulatory_clearance: true
      }),
      extracted_fields: {
        product_id: 'service:lab:tensile-spectrometry-testing',
        category: 'SERVICE_CONTRACT',
        title: 'NABL Accredited Destructive Tensile & Spectrometry Metal Testing',
        gross_price_inr: 12500.0,
        review_sentiment_summary: 'Certified lab test reports delivered within 48h SLA, ISO 17025 accredited.',
        has_regulatory_clearance: true
      },
      provenance_signature: 'sig:golden:service:tensile-test:v1'
    }),

    // 13. Category-Agnostic Unrelated 3: Industrial Argon Cylinders (B2B Bulk Distribution)
    createRawSourceCapture({
      capture_id: 'FIX-B2B-ARGON-GAS-001',
      source_connector_id: 'conn:b2b:industrial-gases',
      source_type: 'SUPPLIER_B2B_CATALOG',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://gases.example.com/catalog/argon-47l',
      source_observed_at_utc: '2026-10-24T16:00:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T16:00:02.000Z',
      raw_payload: JSON.stringify({
        product_id: 'b2b:gas:argon-cylinders-47l',
        category: 'B2B_DISTRIBUTION',
        title: 'Industrial High-Purity Grade 5.0 Argon Gas Cylinders (47L)',
        gross_price_inr: 3200.0,
        factory_gate_quote_inr: 1850.0,
        unit_batch_moq: 20,
        review_sentiment_summary: 'High purity argon for TIG welding and inert purging, certified 99.999% purity.',
        has_logistics_route: true,
        has_regulatory_clearance: true
      }),
      extracted_fields: {
        product_id: 'b2b:gas:argon-cylinders-47l',
        category: 'B2B_DISTRIBUTION',
        title: 'Industrial High-Purity Grade 5.0 Argon Gas Cylinders (47L)',
        gross_price_inr: 3200.0,
        factory_gate_quote_inr: 1850.0,
        unit_batch_moq: 20,
        review_sentiment_summary: 'High purity argon for TIG welding and inert purging, certified 99.999% purity.',
        has_logistics_route: true,
        has_regulatory_clearance: true
      },
      provenance_signature: 'sig:golden:b2b:argon-gas:v1'
    }),

    // 14. Novel / Unseen Category: Mycelium Bio-Composite License
    createRawSourceCapture({
      capture_id: 'FIX-NOVEL-MYCELIUM-001',
      source_connector_id: 'conn:ip:tech-transfer',
      source_type: 'GOV_PROCUREMENT',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://techtransfer.example.edu/patents/mycelium-foam-composite',
      source_observed_at_utc: '2026-10-24T16:30:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T16:30:02.000Z',
      raw_payload: JSON.stringify({
        product_id: 'novel:biomaterial:mycelium-composite-patents',
        category: 'BIOMATERIAL_PACKAGING_IP',
        title: 'Exclusive Commercial License: Biodegradable Mycelium Packaging Composite',
        gross_price_inr: 1500000.0,
        review_sentiment_summary: 'Proprietary bio-composite technology replacing EPS foam packaging with 100% compostable mycelium.',
        has_regulatory_clearance: false
      }),
      extracted_fields: {
        product_id: 'novel:biomaterial:mycelium-composite-patents',
        category: 'BIOMATERIAL_PACKAGING_IP',
        title: 'Exclusive Commercial License: Biodegradable Mycelium Packaging Composite',
        gross_price_inr: 1500000.0,
        review_sentiment_summary: 'Proprietary bio-composite technology replacing EPS foam packaging with 100% compostable mycelium.',
        has_regulatory_clearance: false
      },
      provenance_signature: 'sig:golden:novel:mycelium-ip:v1'
    }),

    // 15. Missing Category-Specific Input: SaaS Developer Tool with missing subscription price
    createRawSourceCapture({
      capture_id: 'FIX-SAAS-DEVTOOL-MISSING-PRICE-002',
      source_connector_id: 'conn:marketplace:developer-saas',
      source_type: 'MARKETPLACE_RETAIL',
      origin_class: 'RECORDED_GOLDEN_FIXTURE',
      target_url: 'https://marketplace.example.com/apps/unpriced-saas-tool',
      source_observed_at_utc: '2026-10-24T17:00:00.000Z',
      retrieval_timestamp_utc: '2026-10-24T17:00:02.000Z',
      raw_payload: JSON.stringify({
        product_id: 'software:devtools:unpriced-metric-exporter',
        category: 'SOFTWARE_DIGITAL',
        title: 'Custom Metric Exporter SaaS (Enterprise Contact Sales)',
        gross_price_inr: null,
        review_sentiment_summary: 'Early beta testers report clean Prometheus metrics export.',
        has_regulatory_clearance: true
      }),
      extracted_fields: {
        product_id: 'software:devtools:unpriced-metric-exporter',
        category: 'SOFTWARE_DIGITAL',
        title: 'Custom Metric Exporter SaaS (Enterprise Contact Sales)',
        gross_price_inr: null,
        review_sentiment_summary: 'Early beta testers report clean Prometheus metrics export.',
        has_regulatory_clearance: true
      },
      provenance_signature: 'sig:golden:saas:unpriced:v2'
    })
  ]
};

/**
 * Registry mapping fixture set IDs to sets.
 */
export class GoldenDiscoveryFixtureRegistry {
  private static readonly sets = new Map<string, VersionedGoldenFixtureSet>([
    [GOLDEN_DISCOVERY_FIXTURE_SET_V1.fixture_set_id, GOLDEN_DISCOVERY_FIXTURE_SET_V1]
  ]);

  public static getFixtureSet(setId: string): VersionedGoldenFixtureSet | undefined {
    return this.sets.get(setId);
  }

  public static getDefaultFixtureSet(): VersionedGoldenFixtureSet {
    return GOLDEN_DISCOVERY_FIXTURE_SET_V1;
  }

  public static getFixtureById(captureId: string): RawSourceCapture | undefined {
    for (const set of this.sets.values()) {
      const match = set.fixtures.find((f) => f.capture_id === captureId);
      if (match) return match;
    }
    return undefined;
  }
}
