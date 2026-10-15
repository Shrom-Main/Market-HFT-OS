import { describe, it, expect } from 'vitest';
import {
  M4ResearchAllocationEngine,
  M4VerticalSliceInputs,
  SupplierQuotePayload,
  InboundLogisticsPayload,
  PackagingKittingPayload,
  MarketplaceFeeSchedulePayload,
  OperationalEconomicsParameters,
  ProvenanceEnvelope
} from '../../src/research/m4VerticalSlice.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';

describe('SUITE-20: Gate M4 End-to-End SS304 Vertical Slice & Capital-Allocation Engine', () => {
  const engine = new M4ResearchAllocationEngine();
  const REF_TIME = '2026-10-15T12:00:00Z';

  const defaultOpsParams: OperationalEconomicsParameters = {
    procurement_lead_time_days: 7,
    warehouse_dwell_days: 14,
    marketplace_settlement_delay_days: 14,
    gst_rate_bps: 1800n, // 18.00%
    itc_eligible_fraction_bps: 10000n, // 100.00%
    tcs_rate_bps: 100n, // 1.00%
    tds_rate_bps: 100n, // 1.00%
    customer_return_rate_bps: 200n, // 2.00%
    reverse_logistics_fee_subunits: 140000n, // ₹14.0000
    quarantine_attrition_rate_bps: 10000n, // 100.00%
    risk_free_rate_bps: 650n, // 6.50%
    execution_risk_premium_bps: 850n, // 8.50% (Hurdle = 15.00%)
    min_cash_margin_bps: 2000n, // 20.00%
    max_ccc_days: 45,
    min_downside_buffer_bps: 1500n // 15.00%
  };

  function createValidInputs(): M4VerticalSliceInputs {
    const sq: ProvenanceEnvelope<SupplierQuotePayload> = {
      source_id: 'supp:in:mumbai:metalcraft-ltd',
      observed_at_utc: '2026-10-15T08:00:00Z', // 4h old
      ttl_seconds: 604800, // 7 days
      is_verified: true,
      payload: {
        product_id: 'prod:din3017:ss304:pack-10',
        raw_material_purchase_subunits: 250000n, // ₹25.0000
        moq: 500,
        payment_terms_days: 15,
        incoterms: 'EXW'
      }
    };

    const log: ProvenanceEnvelope<InboundLogisticsPayload> = {
      source_id: 'log:in:bluedart-surface',
      observed_at_utc: '2026-10-15T08:00:00Z',
      ttl_seconds: 604800,
      is_verified: true,
      payload: {
        inbound_freight_subunits: 45000n, // ₹4.5000
        insurance_handling_subunits: 10000n, // ₹1.0000
        customs_inspection_subunits: 45100n // ₹4.5100
      }
    };

    const pkg: ProvenanceEnvelope<PackagingKittingPayload> = {
      source_id: 'pkg:in:packpro-solutions',
      observed_at_utc: '2026-10-15T08:00:00Z',
      ttl_seconds: 604800,
      is_verified: true,
      payload: {
        packaging_kitting_subunits: 32000n // ₹3.2000
      }
    };

    const mkt: ProvenanceEnvelope<MarketplaceFeeSchedulePayload> = {
      source_id: 'mkt:amzn:in:asin:B09XYZ1234',
      observed_at_utc: '2026-10-15T10:00:00Z', // 2h old
      ttl_seconds: 86400, // 24 hours
      is_verified: true,
      payload: {
        asin: 'B09XYZ1234',
        gross_selling_price_subunits: 1050000n, // ₹105.0000
        referral_fee_bps: 1500n, // 15.00%
        closing_fee_subunits: 100000n, // ₹10.0000
        fba_weight_handling_subunits: 140000n, // ₹14.0000
        storage_fee_subunits: 0n
      }
    };

    return {
      supplier_quote: sq,
      inbound_logistics: log,
      packaging_kitting: pkg,
      marketplace_fees: mkt,
      operational_params: { ...defaultOpsParams },
      reference_time_utc: REF_TIME
    };
  }

  it('M4-SCENARIO-A-001: Viable opportunity generates ALLOCATE_CAPITAL in PAPER_SIMULATION mode with exact landed cost ₹38.2100', () => {
    const inputs = createValidInputs();
    const result = engine.evaluateOpportunity(inputs);

    expect(result.decision).toBe('ALLOCATE_CAPITAL');
    expect(result.execution_mode).toBe('PAPER_SIMULATION');
    expect(result.product_id).toBe('prod:din3017:ss304:pack-10');
    expect(result.quarantine_recommended).toBe(false);
    expect(result.edge_decay_detected).toBe(false);

    expect(result.constraint_evaluations.evidence_provenance_verified).toBe(true);
    expect(result.constraint_evaluations.landed_cost_exact_match).toBe(true);
    expect(result.constraint_evaluations.margin_above_hurdle).toBe(true);
    expect(result.constraint_evaluations.rowc_above_hurdle).toBe(true);
    expect(result.constraint_evaluations.cash_conversion_cycle_acceptable).toBe(true);

    expect(result.allocation_parameters).toBeDefined();
    if (result.allocation_parameters) {
      expect(result.allocation_parameters.recommended_batch_quantity).toBe(500);
      expect(result.allocation_parameters.unit_landed_cost_inr).toBe('38.2100');
      expect(result.allocation_parameters.cash_conversion_cycle_days).toBe(35);
      expect(result.allocation_parameters.annualized_rowc_bps).toBeGreaterThanOrEqual(1500); // Exceeds 15.00% hurdle
      expect(result.allocation_parameters.committed_capital_inr).toBe('19105.0000'); // 500 * ₹38.21
    }
  });

  it('M4-SCENARIO-B-002: Economic deterioration & fee creep triggers DO_NOT_ALLOCATE_CAPITAL with machine-readable reasons', () => {
    const inputs = createValidInputs();

    // Inject Scenario B deterioration
    // 1. Fee increases
    inputs.marketplace_fees!.payload.closing_fee_subunits = 250000n; // ₹25.0000 (hiked from ₹10)
    inputs.marketplace_fees!.payload.fba_weight_handling_subunits = 180000n; // ₹18.0000 (hiked from ₹14)
    // 2. Supplier cost creep
    inputs.supplier_quote!.payload.raw_material_purchase_subunits = 340000n; // ₹34.0000 (creeped from ₹25)
    // 3. Elevated customer return rate
    inputs.operational_params.customer_return_rate_bps = 1600n; // 16.00% (spiked from 2.00%)
    // 4. Competitive price compression
    inputs.marketplace_fees!.payload.gross_selling_price_subunits = 980000n; // ₹98.0000 (compressed from ₹105)

    const result = engine.evaluateOpportunity(inputs);

    expect(result.decision).toBe('DO_NOT_ALLOCATE_CAPITAL');
    expect(result.execution_mode).toBe('PAPER_SIMULATION');
    expect(result.quarantine_recommended).toBe(false);
    expect(result.edge_decay_detected).toBe(true);

    expect(result.rejection_reasons).toBeDefined();
    expect(result.rejection_reasons!.length).toBeGreaterThanOrEqual(3);

    // Verify machine-readable error codes
    const reasonsStr = result.rejection_reasons!.join('; ');
    expect(reasonsStr).toContain('E-M4-MARGIN-BELOW-HURDLE');
    expect(reasonsStr).toContain('E-M4-HURDLE-BREACHED');
    expect(reasonsStr).toContain('E-M4-RETURN-DRAG-EXCEEDED');
  });

  it('M4-SCENARIO-C1-003: Unverified cryptographic signature triggers fail-closed quarantine and rejection', () => {
    const inputs = createValidInputs();
    // Tampered or unauthenticated signature
    inputs.supplier_quote!.is_verified = false;

    const result = engine.evaluateOpportunity(inputs);

    expect(result.decision).toBe('DO_NOT_ALLOCATE_CAPITAL');
    expect(result.execution_mode).toBe('FAIL_CLOSED_REJECT');
    expect(result.quarantine_recommended).toBe(true);
    expect(result.edge_decay_detected).toBe(false);

    const reasonsStr = result.rejection_reasons!.join('; ');
    expect(reasonsStr).toContain('E-M4-UNVERIFIED-INPUT');
    expect(reasonsStr).toContain('supp:in:mumbai:metalcraft-ltd');
  });

  it('M4-SCENARIO-C2-004: Stale evidence exceeding allowable TTL triggers fail-closed quarantine and rejection', () => {
    const inputs = createValidInputs();
    // Freight quote is 75 days old, exceeding 7-day TTL (604800s)
    inputs.inbound_logistics!.observed_at_utc = '2026-08-01T00:00:00Z';

    const result = engine.evaluateOpportunity(inputs);

    expect(result.decision).toBe('DO_NOT_ALLOCATE_CAPITAL');
    expect(result.execution_mode).toBe('FAIL_CLOSED_REJECT');
    expect(result.quarantine_recommended).toBe(true);

    const reasonsStr = result.rejection_reasons!.join('; ');
    expect(reasonsStr).toContain('E-M4-STALE-EVIDENCE');
    expect(reasonsStr).toContain('log:in:bluedart-surface');
  });

  it('M4-SCENARIO-C3-005: Missing mandatory evidence envelope fails closed without default assumptions', () => {
    const inputs = createValidInputs();
    // Omit packaging claim entirely
    delete inputs.packaging_kitting;

    const result = engine.evaluateOpportunity(inputs);

    expect(result.decision).toBe('DO_NOT_ALLOCATE_CAPITAL');
    expect(result.execution_mode).toBe('FAIL_CLOSED_REJECT');
    expect(result.quarantine_recommended).toBe(true);

    const reasonsStr = result.rejection_reasons!.join('; ');
    expect(reasonsStr).toContain('E-M4-MANDATORY-EVIDENCE-INCOMPLETE');
    expect(reasonsStr).toContain('packaging_kitting_claim');
  });

  it('M4-SCENARIO-C4-006: Forward clock skew > 300s triggers E-ERR-007 CLOCK_SKEW_EXCEEDED (FUZZ-CLOCK-001 invariant)', () => {
    const inputs = createValidInputs();
    // Injects +600s forward clock skew
    inputs.marketplace_fees!.observed_at_utc = '2026-10-15T12:10:00Z'; // 600s in the future relative to REF_TIME

    const result = engine.evaluateOpportunity(inputs);

    expect(result.decision).toBe('DO_NOT_ALLOCATE_CAPITAL');
    expect(result.execution_mode).toBe('FAIL_CLOSED_REJECT');
    expect(result.quarantine_recommended).toBe(true);

    const reasonsStr = result.rejection_reasons!.join('; ');
    expect(reasonsStr).toContain('E-ERR-007: CLOCK_SKEW_EXCEEDED');
  });

  it('M4-INVENTORY-CONSERV-007: 7-bucket inventory transition audit preserves conservation bitwise', () => {
    const inputs = createValidInputs();
    const result = engine.evaluateOpportunity(inputs);

    expect(result.inventory_transition_audit).toBeDefined();
    if (result.inventory_transition_audit) {
      const audit = result.inventory_transition_audit;
      expect(audit.is_conserved).toBe(true);
      expect(audit.inbound_qty).toBe('500');
      // Conservation invariant: opening + inbound - outbound == closing
      expect(BigInt(audit.opening_total) + BigInt(audit.inbound_qty) - BigInt(audit.outbound_qty)).toBe(BigInt(audit.closing_total));
    }
  });

  it('M4-REPRODUCIBLE-JCS-008: Decision output is bit-for-bit deterministic under canonical JCS serialization', () => {
    const inputs1 = createValidInputs();
    const inputs2 = createValidInputs();

    const res1 = engine.evaluateOpportunity(inputs1);
    const res2 = engine.evaluateOpportunity(inputs2);

    const jcs1 = canonicalizeJCS(res1);
    const jcs2 = canonicalizeJCS(res2);

    expect(jcs1).toBe(jcs2);
    expect(res1.decision).toBe(res2.decision);
  });
});
