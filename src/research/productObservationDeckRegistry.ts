/**
 * POC-001: Product Observation Deck & Grievance Mining Registry
 * Gate M7.2 / Decision OD-22: Category-Agnostic Multi-Product Universe,
 * Marketplace Sell-Side Intelligence, Buyer Feedback Teardowns & Strategic Arbitrage Formulations.
 */

import type {
  ProductObservationItem,
  ProductObservationDeckResponse,
  PushProductObservationRequest,
  BuyerGrievanceCluster,
  CommercialArchetype,
  StrategicDecision,
  ResearchCaseStatus
} from '../mcp/contracts/productObservationContract.js';
import {
  createEvidenceOriginBadge,
  createSemanticStatusBadge
} from '../terminal/operatorTerminalController.js';
import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';

export class ProductObservationDeckRegistry {
  private products: Map<string, ProductObservationItem> = new Map();

  constructor() {
    this.seedCanonicalProducts();
  }

  private seedCanonicalProducts(): void {
    const nowUtc = new Date().toISOString();

    const ss304Origin = createEvidenceOriginBadge(
      'RECORDED_GOLDEN_FIXTURE',
      'https://www.indiamart.com/proddetail/ss304-clamp-16-25mm.html',
      'fixture://golden/indiamart_ss304_quote.html'
    );

    const brassOrigin = createEvidenceOriginBadge(
      'RECORDED_GOLDEN_FIXTURE',
      'https://dir.indiamart.com/jamnagar/brass-valves.html',
      'fixture://golden/jamnagar_brass_valve_quote.html'
    );

    const mcbOrigin = createEvidenceOriginBadge(
      'RECORDED_GOLDEN_FIXTURE',
      'https://www.amazon.in/dp/B08MCB16A0',
      'fixture://golden/amazon_mcb_16a_listing.html'
    );

    const diyaOrigin = createEvidenceOriginBadge(
      'RECORDED_GOLDEN_FIXTURE',
      'https://dir.indiamart.com/kolkata/terracotta-diya.html',
      'fixture://golden/kumartuli_terracotta_diya_quote.html'
    );

    const candleOrigin = createEvidenceOriginBadge(
      'RECORDED_GOLDEN_FIXTURE',
      'https://www.amazon.in/dp/B07SOYCANDLE',
      'fixture://golden/amazon_soy_candle_listing.html'
    );

    const lightsOrigin = createEvidenceOriginBadge(
      'RECORDED_GOLDEN_FIXTURE',
      'https://www.amazon.in/dp/B08FAIRY10M',
      'fixture://golden/amazon_fairy_lights_listing.html'
    );

    const boltsOrigin = createEvidenceOriginBadge(
      'RECORDED_GOLDEN_FIXTURE',
      'https://dir.indiamart.com/ludhiana/grade-8-8-bolts.html',
      'fixture://golden/ludhiana_hex_bolt_quote.html'
    );

    const oringOrigin = createEvidenceOriginBadge(
      'RECORDED_GOLDEN_FIXTURE',
      'https://www.amazon.in/dp/B09ORING225',
      'fixture://golden/amazon_silicone_oring_listing.html'
    );

    const initialCatalog: ProductObservationItem[] = [
      {
        product_id: 'prod:din3017:ss304:16-25mm:pack-10',
        sku_id: 'SKU-SS304-16-25MM-P10',
        name: 'SS304 Worm-Drive Hose Clamps (DIN 3017 W4)',
        category: 'Industrial Fasteners & Hardware',
        commercial_archetype: 'CLUSTER_MRO_STANDARDIZED',
        is_guiding_reference: true,
        sell_side: {
          primary_marketplace: 'Amazon India',
          listing_url: 'https://www.amazon.in/dp/B09XYZ1234',
          asin_or_item_code: 'B09XYZ1234',
          best_seller_rank: 12,
          monthly_sales_volume_est: 5400,
          monthly_gross_revenue_inr_est: 2694600,
          prevailing_retail_asp_inr: 499,
          competitor_count: 8,
          top_competitor_names: ['Generic Stainless Clamps', 'Jain Fasteners', 'Indo-Tool Co.'],
          dominant_pack_formats: ['10-Pack', '20-Pack', 'Assortment Box']
        },
        buyer_grievances: [
          {
            grievance_id: 'GRIEV-SS304-01',
            category: 'QUALITY_DEFECT',
            frequency_pct: 38,
            summary: 'Screws strip when tightened past 2.5 Nm; casing shears',
            representative_quote: 'The screw head stripped immediately with normal screwdriver, had to cut it off with a hacksaw.',
            severity: 'HIGH',
            engineered_remediation: 'Cold-rolled stamped threads + 100% W4 cold-formed worm housing with precision hex slotted screw.'
          },
          {
            grievance_id: 'GRIEV-SS304-02',
            category: 'SPECIFICATION_MISMATCH',
            frequency_pct: 28,
            summary: 'Rusted after 3 weeks on outdoor plumbing — NOT true 304',
            representative_quote: 'Magnets stick firmly to the screw; fake stainless steel, rusted orange in 20 days.',
            severity: 'CRITICAL',
            engineered_remediation: '100% austenitic W4 certified steel with XRF PMI lab test report QR code on blister packaging.'
          },
          {
            grievance_id: 'GRIEV-SS304-03',
            category: 'SAFETY_HAZARD',
            frequency_pct: 19,
            summary: 'Sharp band edges cut into silicone hose during installation',
            representative_quote: 'Sharp burred edges sliced my silicone turbo hose, causing a ₹1,200 replacement.',
            severity: 'MEDIUM',
            engineered_remediation: 'Safety deburred rolled band edges preventing hose jacket abrasion and cutting.'
          }
        ],
        overall_negative_review_pct: 18.5,
        upstream_supply: {
          hub_name: 'Baltikuri / Howrah, West Bengal',
          manufacturing_method: 'Progressive High-Speed Stamping',
          factory_gate_quote_inr: 13.20,
          supplier_moq: 5000,
          lead_time_days: 7,
          raw_material_basis: 'Jindal Stainless SS304 Coil benchmark'
        },
        strategy: {
          thesis_id: 'THESIS-SS304-HOWRAH-01',
          proposed_strategy: 'Bundled W4 Precision Clamps with Custom Hex Driver & Anti-Strip Guarantee',
          target_gross_spread_inr: 13.75,
          target_contribution_margin_bps: 3830,
          estimated_annualized_rowc_bps: 39941,
          working_capital_req_inr: 66000,
          cash_conversion_cycle_days: 21,
          bull_case_rationale: 'Dominates Buy Box by pairing true W4 corrosion proofing with installation hex tool, completely eliminating negative review strip defects.',
          bear_case_risk: 'Raw nickel MCX volatility exceeding +25% within 30-day replenishment window.',
          strategic_decision: 'PURSUE',
          research_case_status: 'READY_FOR_ALLOCATION'
        },
        evidence_origin: ss304Origin,
        badge: createSemanticStatusBadge('PROD_GUIDE', '[OK]', 'GUIDING_REFERENCE'),
        updated_at_utc: nowUtc
      },
      {
        product_id: 'prod:brass:ball-valve:1-2in-pn20',
        sku_id: 'SKU-VALVE-BRASS-12IN-PN20',
        name: 'Forged Brass Ball Valve (1/2" PN20 Full Bore IS 9890)',
        category: 'Plumbing & Fluid Control',
        commercial_archetype: 'CLUSTER_MRO_STANDARDIZED',
        is_guiding_reference: false,
        sell_side: {
          primary_marketplace: 'Amazon India',
          listing_url: 'https://www.amazon.in/dp/B08VALVE12IN',
          asin_or_item_code: 'B08VALVE12IN',
          best_seller_rank: 8,
          monthly_sales_volume_est: 3800,
          monthly_gross_revenue_inr_est: 1326200,
          prevailing_retail_asp_inr: 349,
          competitor_count: 6,
          top_competitor_names: ['Zoloto Clone Valves', 'PlumbSafe Hardware', 'Kisan Agri Valves'],
          dominant_pack_formats: ['Single Unit', '2-Pack', '4-Pack Contractor Pack']
        },
        buyer_grievances: [
          {
            grievance_id: 'GRIEV-VALVE-01',
            category: 'DURABILITY_FAILURE',
            frequency_pct: 42,
            summary: 'Handle snapped off on second turn; brittle cast iron handle',
            representative_quote: 'Handle broke clean off when trying to shut off main water line, had to use vice grips.',
            severity: 'CRITICAL',
            engineered_remediation: 'Heavy-duty 2.5mm stamped stainless steel handle with anti-slip thick vinyl dipped insulation sleeve.'
          },
          {
            grievance_id: 'GRIEV-VALVE-02',
            category: 'QUALITY_DEFECT',
            frequency_pct: 31,
            summary: 'Slow weep leak around the stem packing nut under 6 bar water pressure',
            representative_quote: 'Started dripping from stem after 2 days; tightened nut and it leaked worse.',
            severity: 'HIGH',
            engineered_remediation: 'Dual PTFE stem O-rings with blowout-proof stem design and 100% factory helium pressure testing.'
          },
          {
            grievance_id: 'GRIEV-VALVE-03',
            category: 'SPECIFICATION_MISMATCH',
            frequency_pct: 16,
            summary: 'Threads are rough and stripped brass nipple fitting',
            representative_quote: 'Thread pitch was poorly cut; stripped my inlet pipe threads upon installation.',
            severity: 'MEDIUM',
            engineered_remediation: 'CNC precision-machined BSPT threads with burr-free chamfered lead-in.'
          }
        ],
        overall_negative_review_pct: 22.0,
        upstream_supply: {
          hub_name: 'Jamnagar Brass Parts Cluster (Gujarat)',
          manufacturing_method: 'Hot Forging & CNC Machining',
          factory_gate_quote_inr: 115.00,
          supplier_moq: 500,
          lead_time_days: 10,
          raw_material_basis: 'IS 319 Grade 1 / CW617N Extruded Brass Rod'
        },
        strategy: {
          thesis_id: 'THESIS-VALVE-JAMNAGAR-01',
          proposed_strategy: 'Industrial Full-Bore Brass Valve with Unbreakable SS Handle & 5-Year No-Drip Warranty',
          target_gross_spread_inr: 234.00,
          target_contribution_margin_bps: 3420,
          estimated_annualized_rowc_bps: 31000,
          working_capital_req_inr: 57500,
          cash_conversion_cycle_days: 28,
          bull_case_rationale: 'Contractor 2-packs displace brittle cast-handle competitors, capturing plumber brand loyalty.',
          bear_case_risk: 'Copper/zinc commodity spike on LME lifting billet costs before batch delivery.',
          strategic_decision: 'PURSUE',
          research_case_status: 'STRATEGY_FORMULATED'
        },
        evidence_origin: brassOrigin,
        badge: createSemanticStatusBadge('PROD_PURSUE', '[OK]', 'PURSUE'),
        updated_at_utc: nowUtc
      },
      {
        product_id: 'prod:electrical:mcb:16a-c-curve',
        sku_id: 'SKU-ELEC-MCB-16A-C1P',
        name: '16A C-Curve Miniature Circuit Breaker (BIS / IS 60898)',
        category: 'Electrical Switchgear & Safety',
        commercial_archetype: 'TECHNICAL_COMPLIANCE',
        is_guiding_reference: false,
        sell_side: {
          primary_marketplace: 'Amazon India',
          listing_url: 'https://www.amazon.in/dp/B08MCB16A0',
          asin_or_item_code: 'B08MCB16A0',
          best_seller_rank: 19,
          monthly_sales_volume_est: 6200,
          monthly_gross_revenue_inr_est: 1178000,
          prevailing_retail_asp_inr: 190,
          competitor_count: 11,
          top_competitor_names: ['Havells Resellers', 'Schneider Electric Sub-Dealers', 'Standard Switchgear'],
          dominant_pack_formats: ['Single', '3-Pack Residential', '6-Pack Builder Box']
        },
        buyer_grievances: [
          {
            grievance_id: 'GRIEV-MCB-01',
            category: 'SAFETY_HAZARD',
            frequency_pct: 45,
            summary: 'Failed to trip during motor surge — fried mixer appliance',
            representative_quote: 'Dead short circuit in appliance, MCB never tripped, wall socket melted and smoked.',
            severity: 'CRITICAL',
            engineered_remediation: 'Independently verified 10kA rupture capacity with silver-graphite contacts and calibration certificate.'
          },
          {
            grievance_id: 'GRIEV-MCB-02',
            category: 'QUALITY_DEFECT',
            frequency_pct: 26,
            summary: 'Loose cage clamp screws strip easily with standard electrician screwdriver',
            representative_quote: 'Terminal screw stripped while tightening 4 sq mm copper wire, completely useless.',
            severity: 'HIGH',
            engineered_remediation: 'Hardened carbon steel dual-slot Pozidriv/flat cage terminal clamps rated for 3.5 Nm torque.'
          },
          {
            grievance_id: 'GRIEV-MCB-03',
            category: 'SPECIFICATION_MISMATCH',
            frequency_pct: 18,
            summary: 'Suspicious lack of holographic ISI certification sticker',
            representative_quote: 'Looks like a cheap counterfeit clone; no serial number or genuine ISI mark.',
            severity: 'HIGH',
            engineered_remediation: 'Laser-etched QR code on breaker sidewall linking directly to National Accreditation Board test report.'
          }
        ],
        overall_negative_review_pct: 15.2,
        upstream_supply: {
          hub_name: 'Faridabad / Haridwar Electrical Cluster',
          manufacturing_method: 'Automated Stamping & Thermoset Moulding',
          factory_gate_quote_inr: 68.00,
          supplier_moq: 1000,
          lead_time_days: 14,
          raw_material_basis: 'Electrolytic Copper & Flame-Retardant Polyamide PA66'
        },
        strategy: {
          thesis_id: 'THESIS-MCB-FARIDABAD-01',
          proposed_strategy: 'Certified High-Rupture Builder 6-Pack with Lab QR Traceability & Anti-Strip Terminals',
          target_gross_spread_inr: 122.00,
          target_contribution_margin_bps: 2850,
          estimated_annualized_rowc_bps: 24500,
          working_capital_req_inr: 68000,
          cash_conversion_cycle_days: 35,
          bull_case_rationale: 'Captures local residential electrical contractors seeking verified safety compliance at wholesale pricing.',
          bear_case_risk: 'Strict statutory enforcement delays on BIS laboratory recertification audits.',
          strategic_decision: 'VALIDATE_FURTHER',
          research_case_status: 'ADVERSARIAL_REVIEW'
        },
        evidence_origin: mcbOrigin,
        badge: createSemanticStatusBadge('PROD_VALIDATE', '[WARN]', 'VALIDATE_FURTHER'),
        updated_at_utc: nowUtc
      },
      {
        product_id: 'prod:festive:diya:terracotta-12p',
        sku_id: 'SKU-FEST-DIYA-CLAY-12P',
        name: 'Handcrafted Terracotta Clay Diya (12-Pack Festive)',
        category: 'Home & Festive Handicrafts',
        commercial_archetype: 'SEASONAL_D2C_VISUAL',
        is_guiding_reference: false,
        sell_side: {
          primary_marketplace: 'Amazon India',
          listing_url: 'https://www.amazon.in/dp/B07DIYA12PK',
          asin_or_item_code: 'B07DIYA12PK',
          best_seller_rank: 4,
          monthly_sales_volume_est: 14000,
          monthly_gross_revenue_inr_est: 3486000,
          prevailing_retail_asp_inr: 249,
          competitor_count: 14,
          top_competitor_names: ['Artisan Pottery Co.', 'Festival Lights Direct', 'CraftVillage India'],
          dominant_pack_formats: ['12-Pack', '24-Pack Gift Box', '50-Pack Community Pack']
        },
        buyer_grievances: [
          {
            grievance_id: 'GRIEV-DIYA-01',
            category: 'PACKAGING_DAMAGE',
            frequency_pct: 62,
            summary: 'Arrived completely shattered into powder due to flimsy bubble wrap',
            representative_quote: 'Opened box to find 8 out of 12 diyas in pieces, terrible packaging, ruined Diwali eve.',
            severity: 'CRITICAL',
            engineered_remediation: 'Custom molded biodegradable egg-crate paper pulp protective clamshell (zero breakage 1.5m drop-test certified).'
          },
          {
            grievance_id: 'GRIEV-DIYA-02',
            category: 'QUALITY_DEFECT',
            frequency_pct: 24,
            summary: 'Porous unsealed clay sucked up entire oil reservoir in 10 minutes',
            representative_quote: 'Clay is so porous it drinks all the oil before wick can even burn, leaving oily stains on floor.',
            severity: 'HIGH',
            engineered_remediation: 'Inner cavity micro-thin organic beeswax dip sealing porosity, extending burn time to 4+ hours.'
          },
          {
            grievance_id: 'GRIEV-DIYA-03',
            category: 'SAFETY_HAZARD',
            frequency_pct: 10,
            summary: 'Wobbly uneven bottom tipped over on rangoli and spilled burning oil',
            representative_quote: 'Bottom is not flat, wobbled and tipped burning oil onto my tablecloth.',
            severity: 'MEDIUM',
            engineered_remediation: 'Precision diamond-ground flat base ensuring 100% horizontal stability on flat surfaces.'
          }
        ],
        overall_negative_review_pct: 31.0,
        upstream_supply: {
          hub_name: 'Kumartuli / Bankura Clay Artisan Cluster (West Bengal)',
          manufacturing_method: 'Hand-Thrown Clay & Kiln Fired',
          factory_gate_quote_inr: 38.00,
          supplier_moq: 2000,
          lead_time_days: 12,
          raw_material_basis: 'Ganges Alluvial Clay & Natural Terracotta Mineral Slurry'
        },
        strategy: {
          thesis_id: 'THESIS-DIYA-KUMARTULI-01',
          proposed_strategy: 'Zero-Breakage Clamshell Packaging Guarantee + 4-Hour Extended Burn Diya Gift Box',
          target_gross_spread_inr: 211.00,
          target_contribution_margin_bps: 4400,
          estimated_annualized_rowc_bps: 58000,
          working_capital_req_inr: 76000,
          cash_conversion_cycle_days: 18,
          bull_case_rationale: 'Zero-breakage guarantee conquers holiday gift market where broken diyas cause 30%+ returns for competitors.',
          bear_case_risk: 'Post-festive demand cliff requiring strict zero-inventory liquidation by Diwali Day -2.',
          strategic_decision: 'PURSUE',
          research_case_status: 'STRATEGY_FORMULATED'
        },
        evidence_origin: diyaOrigin,
        badge: createSemanticStatusBadge('PROD_PURSUE', '[OK]', 'PURSUE'),
        updated_at_utc: nowUtc
      },
      {
        product_id: 'prod:wellness:candle:soy-lavender',
        sku_id: 'SKU-WELL-CANDLE-SOY-200G',
        name: 'Aromatherapy Hand-Poured Soy Wax Candle (Lavender & Cedar)',
        category: 'Wellness & Home Fragrance',
        commercial_archetype: 'D2C_CONSUMABLE',
        is_guiding_reference: false,
        sell_side: {
          primary_marketplace: 'Amazon India',
          listing_url: 'https://www.amazon.in/dp/B07SOYCANDLE',
          asin_or_item_code: 'B07SOYCANDLE',
          best_seller_rank: 27,
          monthly_sales_volume_est: 2900,
          monthly_gross_revenue_inr_est: 1447100,
          prevailing_retail_asp_inr: 499,
          competitor_count: 9,
          top_competitor_names: ['SoulScents', 'AromaBliss India', 'EarthyVibes Home'],
          dominant_pack_formats: ['Single 200g Jar', 'Twin Aromatherapy Set', '3-Mini Sampler Box']
        },
        buyer_grievances: [
          {
            grievance_id: 'GRIEV-CANDLE-01',
            category: 'QUALITY_DEFECT',
            frequency_pct: 51,
            summary: 'Zero scent throw — smells like plain wax when lit',
            representative_quote: 'Smelled pleasant in the jar, but after burning for 2 hours in bedroom there is zero fragrance.',
            severity: 'HIGH',
            engineered_remediation: '10% IFRA-compliant therapeutic-grade essential oil fragrance load with specialized soy wax binding esters.'
          },
          {
            grievance_id: 'GRIEV-CANDLE-02',
            category: 'DURABILITY_FAILURE',
            frequency_pct: 33,
            summary: 'Tunneling: wick burned straight down the middle leaving 60% wax behind',
            representative_quote: 'Wick drowned in a deep hole, could not relight it after day 2, half the candle wasted.',
            severity: 'MEDIUM',
            engineered_remediation: 'Dual lead-free ring-spun braided cotton wicks calculated for exact 75mm diameter full-melt pool.'
          },
          {
            grievance_id: 'GRIEV-CANDLE-03',
            category: 'SAFETY_HAZARD',
            frequency_pct: 12,
            summary: 'Thin glass jar cracked from flame heat',
            representative_quote: 'Jar cracked from side heat and leaked hot wax all over my wooden nightstand.',
            severity: 'HIGH',
            engineered_remediation: '3.5mm thick thermal shock-resistant borosilicate glass with heat-insulating wooden bamboo coaster lid.'
          }
        ],
        overall_negative_review_pct: 24.0,
        upstream_supply: {
          hub_name: 'Silvassa / Daman Chemical & Fragrance Hub',
          manufacturing_method: 'Semi-Automated Temperature-Controlled Pouring',
          factory_gate_quote_inr: 140.00,
          supplier_moq: 500,
          lead_time_days: 10,
          raw_material_basis: '100% Hydrogenated Non-GMO Soy Wax & Essential Oils'
        },
        strategy: {
          thesis_id: 'THESIS-CANDLE-SILVASSA-01',
          proposed_strategy: '10% True-Throw Essential Oil Candle with Zero-Tunneling Dual Wick & Borosilicate Safety Jar',
          target_gross_spread_inr: 359.00,
          target_contribution_margin_bps: 3950,
          estimated_annualized_rowc_bps: 28000,
          working_capital_req_inr: 70000,
          cash_conversion_cycle_days: 30,
          bull_case_rationale: 'Solves the #1 complaint in Indian candle reviews (scentlessness) to drive high repeat subscription orders.',
          bear_case_risk: 'Summer heat transit melting risk if ambient courier van exceeds 48°C without insulated packing.',
          strategic_decision: 'VALIDATE_FURTHER',
          research_case_status: 'ACTIVE_OBSERVATION'
        },
        evidence_origin: candleOrigin,
        badge: createSemanticStatusBadge('PROD_VALIDATE', '[WARN]', 'VALIDATE_FURTHER'),
        updated_at_utc: nowUtc
      },
      {
        product_id: 'prod:lighting:fairy-lights:10m-usb',
        sku_id: 'SKU-DECOR-FAIRY-10M-USB',
        name: 'Warm White LED Copper Wire Fairy Lights (10m USB)',
        category: 'Seasonal Home Decor',
        commercial_archetype: 'SEASONAL_D2C_VISUAL',
        is_guiding_reference: false,
        sell_side: {
          primary_marketplace: 'Amazon India',
          listing_url: 'https://www.amazon.in/dp/B08FAIRY10M',
          asin_or_item_code: 'B08FAIRY10M',
          best_seller_rank: 5,
          monthly_sales_volume_est: 18500,
          monthly_gross_revenue_inr_est: 2756500,
          prevailing_retail_asp_inr: 149,
          competitor_count: 21,
          top_competitor_names: ['StarGlow Lights', 'BrightFest India', 'DesiFestive Decor'],
          dominant_pack_formats: ['Single 10m', '2-Pack 10m', '4-Pack Multi-Room Bundle']
        },
        buyer_grievances: [
          {
            grievance_id: 'GRIEV-LIGHT-01',
            category: 'SAFETY_HAZARD',
            frequency_pct: 44,
            summary: 'USB connector overheated and melted plastic casing',
            representative_quote: 'USB plug got scarily hot within 20 minutes, smelled like burning plastic, fire hazard.',
            severity: 'CRITICAL',
            engineered_remediation: 'UL/CE certified 5V step-down regulator with internal current limiting resistor and flame-retardant plug.'
          },
          {
            grievance_id: 'GRIEV-LIGHT-02',
            category: 'DURABILITY_FAILURE',
            frequency_pct: 38,
            summary: 'Ultra-thin copper wire snapped into pieces when uncoiling',
            representative_quote: 'Tangled mess out of the box; wire broke in two places while gently unraveling.',
            severity: 'HIGH',
            engineered_remediation: '3-strand twisted 0.4mm enameled copper wire core with flexible spool packaging spooler.'
          },
          {
            grievance_id: 'GRIEV-LIGHT-03',
            category: 'QUALITY_DEFECT',
            frequency_pct: 14,
            summary: 'Half the string stopped working after rain despite IP65 waterproof claim',
            representative_quote: 'Put them on balcony, drizzled rain, half the lights went dead permanently.',
            severity: 'MEDIUM',
            engineered_remediation: 'Dual UV-cured micro-epoxy dip potting on all 100 SMD-0603 LED diodes.'
          }
        ],
        overall_negative_review_pct: 28.5,
        upstream_supply: {
          hub_name: 'Surat / Delhi Electronics Assembling Hub',
          manufacturing_method: 'SMT Surface Mount & Automated Wire Twisting',
          factory_gate_quote_inr: 42.00,
          supplier_moq: 3000,
          lead_time_days: 14,
          raw_material_basis: 'Enameled Pure Copper Wire & Warm-White 2700K Micro LEDs'
        },
        strategy: {
          thesis_id: 'THESIS-LIGHTS-SURAT-01',
          proposed_strategy: 'Tangle-Free Spooled Fairy Lights with Overheat-Safe USB Regulator & 3-Strand Wire',
          target_gross_spread_inr: 107.00,
          target_contribution_margin_bps: 2600,
          estimated_annualized_rowc_bps: 21000,
          working_capital_req_inr: 126000,
          cash_conversion_cycle_days: 25,
          bull_case_rationale: 'Low ASP high volume mover during Q3/Q4 festival season with spooled tangle-free design.',
          bear_case_risk: 'Extreme price competition from unbranded grey-market Chinese imports on Meesho.',
          strategic_decision: 'MONITOR',
          research_case_status: 'RESEARCHING'
        },
        evidence_origin: lightsOrigin,
        badge: createSemanticStatusBadge('PROD_MONITOR', '[WARN]', 'MONITOR'),
        updated_at_utc: nowUtc
      },
      {
        product_id: 'prod:fasteners:hex-bolt:m10-grade-8-8',
        sku_id: 'SKU-FAST-BOLT-M10X50-88-50P',
        name: 'High-Tensile Grade 8.8 Hex Bolts & Nuts (M10 x 50mm, 50-Pack)',
        category: 'Industrial Fasteners & Hardware',
        commercial_archetype: 'MRO_INDUSTRIAL',
        is_guiding_reference: false,
        sell_side: {
          primary_marketplace: 'Amazon India',
          listing_url: 'https://www.amazon.in/dp/B07BOLTM10',
          asin_or_item_code: 'B07BOLTM10',
          best_seller_rank: 22,
          monthly_sales_volume_est: 2100,
          monthly_gross_revenue_inr_est: 1677900,
          prevailing_retail_asp_inr: 799,
          competitor_count: 7,
          top_competitor_names: ['Unbrako Distributors', 'TVS Fastener Resellers', 'Ludhiana Bolt House'],
          dominant_pack_formats: ['25-Pack', '50-Pack Contractor Tub', '100-Pack Shop Box']
        },
        buyer_grievances: [
          {
            grievance_id: 'GRIEV-BOLT-01',
            category: 'SPECIFICATION_MISMATCH',
            frequency_pct: 48,
            summary: 'Black oxide finish rubs off like soot and rusts after one rain',
            representative_quote: 'Turned rusty orange within 48 hours outside, dirty soot on hands, definitely not treated.',
            severity: 'HIGH',
            engineered_remediation: 'Geomet 500 / Hot-Dip Galvanized anti-corrosion coating (1,000-hour salt spray tested).'
          },
          {
            grievance_id: 'GRIEV-BOLT-02',
            category: 'QUALITY_DEFECT',
            frequency_pct: 32,
            summary: 'Nut threads jammed at 3rd turn due to metal burrs',
            representative_quote: 'Every second bolt seized before tightening, stripped nut threads due to rough stamping.',
            severity: 'HIGH',
            engineered_remediation: '100% optical sorting with Class 6g/6H CNC rolled threads and ultrasonic degreasing.'
          },
          {
            grievance_id: 'GRIEV-BOLT-03',
            category: 'DURABILITY_FAILURE',
            frequency_pct: 16,
            summary: 'Sheared bolt head under impact wrench — definitely not genuine 8.8 tensile',
            representative_quote: 'Bolt snapped in half under 45 Nm torque, low quality mild steel stamped as 8.8.',
            severity: 'CRITICAL',
            engineered_remediation: 'Certified quenched and tempered medium carbon boron steel with embossed 8.8 mill test cert.'
          }
        ],
        overall_negative_review_pct: 16.8,
        upstream_supply: {
          hub_name: 'Ludhiana Fasteners Cluster (Punjab)',
          manufacturing_method: 'Cold Forging & Continuous Heat Treatment',
          factory_gate_quote_inr: 280.00,
          supplier_moq: 400,
          lead_time_days: 10,
          raw_material_basis: 'SAE 10B21 Boron Steel Wire Rod'
        },
        strategy: {
          thesis_id: 'THESIS-BOLT-LUDHIANA-01',
          proposed_strategy: '1000-Hour Anti-Corrosion Heavy Contractor Tub with Guaranteed 6g Precision Thread Fit',
          target_gross_spread_inr: 519.00,
          target_contribution_margin_bps: 3250,
          estimated_annualized_rowc_bps: 29000,
          working_capital_req_inr: 112000,
          cash_conversion_cycle_days: 30,
          bull_case_rationale: 'Captures agricultural equipment repair shops and structural fabricators sick of burred unbranded bolts.',
          bear_case_risk: 'Heavy package weight (>3.5 kg/tub) triggering marketplace weight fee cliff penalties.',
          strategic_decision: 'PURSUE',
          research_case_status: 'STRATEGY_FORMULATED'
        },
        evidence_origin: boltsOrigin,
        badge: createSemanticStatusBadge('PROD_PURSUE', '[OK]', 'PURSUE'),
        updated_at_utc: nowUtc
      },
      {
        product_id: 'prod:sealing:o-ring-kit:silicone-225p',
        sku_id: 'SKU-SEAL-ORING-SIL-225P',
        name: 'Food-Grade Silicone O-Ring Assortment Kits (225 pcs, 18 Sizes)',
        category: 'Sealing, Gaskets & Fluid Lines',
        commercial_archetype: 'REPLACEMENT_PARTS',
        is_guiding_reference: false,
        sell_side: {
          primary_marketplace: 'Amazon India',
          listing_url: 'https://www.amazon.in/dp/B09ORING225',
          asin_or_item_code: 'B09ORING225',
          best_seller_rank: 16,
          monthly_sales_volume_est: 3400,
          monthly_gross_revenue_inr_est: 1356600,
          prevailing_retail_asp_inr: 399,
          competitor_count: 10,
          top_competitor_names: ['Universal Seal Store', 'AutoPlumb Spares', 'GasketMaster India'],
          dominant_pack_formats: ['225-Piece Kit', '419-Piece Master Kit', 'Refill Packs']
        },
        buyer_grievances: [
          {
            grievance_id: 'GRIEV-ORING-01',
            category: 'SAFETY_HAZARD',
            frequency_pct: 52,
            summary: 'Smells like toxic burning rubber / kerosene — NOT food-grade',
            representative_quote: 'Pungent chemical kerosene smell, was supposed to fix my espresso machine, ruined the taste completely.',
            severity: 'CRITICAL',
            engineered_remediation: '100% Platinum-cured VMQ silicone (FDA 21 CFR 177.2600 & LFGB certified, 100% odor-free post-cured at 200°C).'
          },
          {
            grievance_id: 'GRIEV-ORING-02',
            category: 'PACKAGING_DAMAGE',
            frequency_pct: 29,
            summary: 'Compartment latch broke in shipping; all 225 tiny rings mixed into a jumbled mess',
            representative_quote: 'Case arrived popped open, 225 rings mixed together, took 3 hours to sort with calipers.',
            severity: 'HIGH',
            engineered_remediation: 'Heavy-duty impact-resistant polypropylene organizer case with double snap-locks and laser-engraved lid size chart.'
          },
          {
            grievance_id: 'GRIEV-ORING-03',
            category: 'DURABILITY_FAILURE',
            frequency_pct: 15,
            summary: 'Too soft, tore under oil filter compression',
            representative_quote: 'Tore like cheap gelatin when squeezed into groove, oil leaked immediately.',
            severity: 'HIGH',
            engineered_remediation: '70 Shore A durometer hardness with high-tear strength formulation (-50°C to +200°C rating).'
          }
        ],
        overall_negative_review_pct: 26.2,
        upstream_supply: {
          hub_name: 'Vasai / Pune Precision Rubber Moulding Hub (Maharashtra)',
          manufacturing_method: 'Vacuum Compression Moulding',
          factory_gate_quote_inr: 105.00,
          supplier_moq: 500,
          lead_time_days: 10,
          raw_material_basis: 'Wacker / Shin-Etsu Medical-Grade Solid Silicone Rubber'
        },
        strategy: {
          thesis_id: 'THESIS-ORING-PUNE-01',
          proposed_strategy: 'Certified Odor-Free Food-Safe Silicone Kit with Heavy Snap-Lock Sizing Case',
          target_gross_spread_inr: 294.00,
          target_contribution_margin_bps: 3700,
          estimated_annualized_rowc_bps: 34000,
          working_capital_req_inr: 52500,
          cash_conversion_cycle_days: 22,
          bull_case_rationale: 'Captures coffee machine, RO water purifier, and home brewing maintenance enthusiasts seeking verified food safety.',
          bear_case_risk: 'Silicone raw gum price fluctuations dependent on global polymer export tariffs.',
          strategic_decision: 'PURSUE',
          research_case_status: 'STRATEGY_FORMULATED'
        },
        evidence_origin: oringOrigin,
        badge: createSemanticStatusBadge('PROD_PURSUE', '[OK]', 'PURSUE'),
        updated_at_utc: nowUtc
      }
    ];

    for (const item of initialCatalog) {
      const enhanced: ProductObservationItem = {
        ...item,
        sell_side: {
          ...item.sell_side,
          top_competitor_brands: item.sell_side.top_competitor_names
        },
        upstream_supply: {
          ...item.upstream_supply,
          minimum_order_quantity: item.upstream_supply.supplier_moq,
          per_unit_landed_cost_est_inr: Math.round(item.upstream_supply.factory_gate_quote_inr * 1.12 * 100) / 100
        },
        strategy: {
          ...item.strategy,
          min_capital_requirement_inr: item.strategy.working_capital_req_inr,
          bull_case_thesis: item.strategy.bull_case_rationale,
          bear_case_thesis: item.strategy.bear_case_risk
        },
        buyer_grievances: item.buyer_grievances.map(g => ({
          ...g,
          failure_mode: g.failure_mode || g.summary
        }))
      };

      const itemWithoutHash = { ...enhanced };
      const itemWithHash: ProductObservationItem = {
        ...enhanced,
        jcs_sha256: sha256(canonicalizeJCS(itemWithoutHash))
      };
      this.products.set(item.product_id, itemWithHash);
    }
  }

  public getAllProducts(): readonly ProductObservationItem[] {
    return Array.from(this.products.values());
  }

  public getProductById(productId: string): ProductObservationItem | undefined {
    return this.products.get(productId);
  }

  public getDeckResponse(): ProductObservationDeckResponse {
    const products = this.getAllProducts();
    const categories = Array.from(new Set(products.map((p) => p.category)));
    const archetypes = Array.from(new Set(products.map((p) => p.commercial_archetype)));
    const activeInvestigations = products.filter(
      (p) => p.strategy.research_case_status !== 'DISCOVERED' && p.strategy.research_case_status !== 'READY_FOR_ALLOCATION'
    ).length;
    const pursueCount = products.filter((p) => p.strategy.strategic_decision === 'PURSUE').length;

    return {
      products,
      categories,
      archetypes,
      total_products_count: products.length,
      active_investigations_count: activeInvestigations,
      pursue_count: pursueCount,
      timestamp_utc: new Date().toISOString()
    };
  }

  public pushProductObservation(request: PushProductObservationRequest): ProductObservationItem {
    const nowUtc = new Date().toISOString();
    const hashDigest = sha256(`${request.name}:${request.category}:${nowUtc}`);
    const productId = `prod:custom:${hashDigest.slice(0, 10)}`;
    const skuId = `SKU-CUST-${hashDigest.slice(0, 8).toUpperCase()}`;

    const retailAsp = request.sell_side?.prevailing_retail_asp_inr ?? request.retail_asp_inr ?? 250;
    const factoryQuote = request.upstream_supply?.factory_gate_quote_inr ?? request.upstream_factory_quote_inr ?? 100;
    const hubName = request.upstream_supply?.hub_name ?? request.upstream_hub_name ?? 'Domestic Manufacturing Cluster';
    const decision = request.strategy?.strategic_decision ?? request.strategic_decision ?? 'PURSUE';
    const cccDays = request.strategy?.cash_conversion_cycle_days ?? 30;
    const workingCap = request.strategy?.working_capital_req_inr ?? (factoryQuote * 1000);

    const grossSpread = retailAsp - factoryQuote;
    const marginBps = Math.round(
      (grossSpread / (retailAsp || 1)) * 10000
    );
    const rowcBps = Math.round(
      (grossSpread / (factoryQuote || 1)) * (365 / (cccDays || 30)) * 100
    );

    const originBadge = createEvidenceOriginBadge(
      'RECORDED_GOLDEN_FIXTURE',
      request.sell_side?.listing_url || 'https://www.amazon.in',
      `fixture://observation/${hashDigest.slice(0, 12)}.html`
    );

    const grievances: BuyerGrievanceCluster[] = (request.buyer_grievances && request.buyer_grievances.length > 0)
      ? request.buyer_grievances.map((g, idx) => ({
          grievance_id: `GRIEV-CUST-${hashDigest.slice(0, 4)}-${idx + 1}`,
          category: g.category || 'QUALITY_DEFECT',
          frequency_pct: g.frequency_pct ?? 25,
          summary: g.summary || 'Customer reported material defect under load',
          representative_quote: g.representative_quote || request.observed_grievance || 'Part failed under normal operational conditions',
          severity: g.severity || 'HIGH',
          engineered_remediation: g.engineered_remediation || 'Precision hot forging with certified raw material metallurgical compliance.',
          failure_mode: g.failure_mode || g.summary || 'Customer reported material defect under load'
        }))
      : [
          {
            grievance_id: `GRIEV-CUST-${hashDigest.slice(0, 4)}-1`,
            category: 'QUALITY_DEFECT',
            frequency_pct: 35,
            summary: request.observed_grievance || 'Part failed under operating stress',
            representative_quote: request.observed_grievance || 'Part failed under normal operational conditions',
            severity: 'HIGH',
            engineered_remediation: 'Reinforced material structure and rigorous metallurgical quality control.',
            failure_mode: request.observed_grievance || 'Part failed under operating stress'
          }
        ];

    const topCompetitors = request.sell_side?.top_competitor_names || ['Market Competitor Alpha', 'National Hardware'];

    const itemWithoutHash = {
      product_id: productId,
      sku_id: skuId,
      name: request.name,
      category: request.category,
      commercial_archetype: request.commercial_archetype,
      is_guiding_reference: false,
      sell_side: {
        primary_marketplace: request.sell_side?.primary_marketplace || 'Amazon India',
        listing_url: request.sell_side?.listing_url,
        asin_or_item_code: `ASIN-${hashDigest.slice(0, 6).toUpperCase()}`,
        best_seller_rank: request.sell_side?.best_seller_rank || 45,
        monthly_sales_volume_est: request.sell_side?.monthly_sales_volume_est || 1200,
        monthly_gross_revenue_inr_est: request.sell_side?.monthly_gross_revenue_inr_est || (retailAsp * 1200),
        prevailing_retail_asp_inr: retailAsp,
        competitor_count: request.sell_side?.competitor_count || 5,
        top_competitor_names: topCompetitors,
        top_competitor_brands: topCompetitors,
        dominant_pack_formats: request.sell_side?.dominant_pack_formats || ['Single Unit', 'Pack of 5']
      },
      buyer_grievances: grievances,
      overall_negative_review_pct: request.overall_negative_review_pct || 14.5,
      upstream_supply: {
        hub_name: hubName,
        manufacturing_method: request.upstream_supply?.manufacturing_method || 'Precision Hot Forging & Stamping',
        factory_gate_quote_inr: factoryQuote,
        supplier_moq: request.upstream_supply?.supplier_moq || 500,
        minimum_order_quantity: request.upstream_supply?.supplier_moq || 500,
        lead_time_days: request.upstream_supply?.lead_time_days || 14,
        raw_material_basis: request.upstream_supply?.raw_material_basis || 'Standard domestic industrial feed',
        per_unit_landed_cost_est_inr: Math.round(factoryQuote * 1.12 * 100) / 100
      },
      strategy: {
        thesis_id: `THESIS-CUST-${hashDigest.slice(0, 8)}`,
        proposed_strategy: request.strategy?.proposed_strategy || 'Direct factory sourcing with quality remediation to capture Buy Box.',
        target_gross_spread_inr: grossSpread,
        target_contribution_margin_bps: marginBps,
        estimated_annualized_rowc_bps: rowcBps,
        working_capital_req_inr: workingCap,
        min_capital_requirement_inr: workingCap,
        cash_conversion_cycle_days: cccDays,
        bull_case_rationale: request.strategy?.bull_case_rationale || 'High margin spread and unmet buyer demand for reliable quality.',
        bull_case_thesis: request.strategy?.bull_case_rationale || 'High margin spread and unmet buyer demand for reliable quality.',
        bear_case_risk: request.strategy?.bear_case_risk || 'Competitor price discounting on low quality alternatives.',
        bear_case_thesis: request.strategy?.bear_case_risk || 'Competitor price discounting on low quality alternatives.',
        strategic_decision: decision,
        research_case_status: 'ACTIVE_OBSERVATION' as ResearchCaseStatus
      },
      evidence_origin: originBadge,
      badge: createSemanticStatusBadge(
        decision === 'PURSUE' ? 'PROD_PURSUE' : 'PROD_OBSERVE',
        decision === 'PURSUE' ? '[OK]' : '[WARN]',
        decision
      ),
      updated_at_utc: nowUtc
    };

    const newItem: ProductObservationItem = {
      ...itemWithoutHash,
      jcs_sha256: sha256(canonicalizeJCS(itemWithoutHash))
    };

    this.products.set(productId, newItem);
    return newItem;
  }

  public updateProductResearchStatus(
    productId: string,
    newStatus: ResearchCaseStatus,
    newDecision?: StrategicDecision
  ): ProductObservationItem {
    const existing = this.products.get(productId);
    if (!existing) {
      throw new Error(`E-PROD-NOT-FOUND: Product ${productId} not found in observation deck.`);
    }

    const updatedStrategy = {
      ...existing.strategy,
      research_case_status: newStatus,
      strategic_decision: newDecision || existing.strategy.strategic_decision
    };

    const updated: ProductObservationItem = {
      ...existing,
      strategy: updatedStrategy,
      badge: createSemanticStatusBadge(
        updatedStrategy.strategic_decision === 'PURSUE' ? 'PROD_PURSUE' : 'PROD_OBSERVE',
        updatedStrategy.strategic_decision === 'PURSUE' ? '[OK]' : '[WARN]',
        updatedStrategy.strategic_decision
      ),
      updated_at_utc: new Date().toISOString()
    };

    this.products.set(productId, updated);
    return updated;
  }

  public promoteToLiveOrigin(productId: string, liveUrl: string): ProductObservationItem {
    const existing = this.products.get(productId);
    if (!existing) {
      throw new Error(`E-PROD-NOT-FOUND: Product ${productId} not found in observation deck.`);
    }

    const liveBadge = createEvidenceOriginBadge(
      'LIVE_VERIFIED_CAPTURE',
      liveUrl,
      liveUrl
    );

    const updated: ProductObservationItem = {
      ...existing,
      evidence_origin: liveBadge,
      updated_at_utc: new Date().toISOString()
    };

    this.products.set(productId, updated);
    return updated;
  }
}
