import fs from 'fs';
import path from 'path';
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
import {
  FormulaRegistry,
  computeFormulaJcsHash,
  evaluateSymbolicExpression,
  FormulaCardInput
} from '../../src/research/formulaRegistry.js';
import { GroqFormulaAdvisor, loadGroqKeyFromEnv } from '../../src/research/llmFormulaAdvisor.js';
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
        payment_terms_days: 0, // Advance EXW payment on MOQ procurement -> CCC = 35 days (MATH-04)
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
      expect(result.allocation_parameters.annualized_rowc_bps).toBe(39941); // 399.41% exact (MATH-04)
      expect(result.allocation_parameters.expected_net_margin_bps).toBe(3830); // 38.30%
      expect(result.allocation_parameters.unit_net_contribution_inr).toBe('14.6377');
      expect(result.allocation_parameters.break_even_price_inr).toBe('88.5827');
      expect(result.allocation_parameters.committed_capital_inr).toBe('19105.0000'); // 500 * ₹38.21
      expect(result.allocation_parameters.marketplace_fee_gst_inr).toBe('7.1550'); // 18% fee GST (MATH-01)
      expect(result.allocation_parameters.net_statutory_settlement_inr).toBe('2.1435'); // Net GSTR-3B settlement (MATH-03)
      expect(result.allocation_parameters.income_tax_tds_holdback_inr).toBe('0.8898'); // Sec 194-O TDS on ex-GST base (MATH-02)
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

  it('M4-STATUTORY-MATH-009: Verified statutory and cash-conversion cycle sensitivity (MATH-01 to MATH-04)', () => {
    const inputs = createValidInputs();

    // Baseline: payment_terms_days = 0 (Advance EXW)
    const baseResult = engine.evaluateOpportunity(inputs);
    expect(baseResult.allocation_parameters?.cash_conversion_cycle_days).toBe(35);
    expect(baseResult.allocation_parameters?.annualized_rowc_bps).toBe(39941); // 399.41%

    // MATH-04 Sensitivity: 15-day supplier credit terms (DPO = 15)
    // CCC = 7 + 14 + 14 - 15 = 20 days -> RoWC = (3830 * 365) / 20 = 69897 bps (698.97%)
    inputs.supplier_quote!.payload.payment_terms_days = 15;
    const creditResult = engine.evaluateOpportunity(inputs);
    expect(creditResult.allocation_parameters?.cash_conversion_cycle_days).toBe(20);
    expect(creditResult.allocation_parameters?.annualized_rowc_bps).toBe(69897);
    expect(creditResult.allocation_parameters!.annualized_rowc_bps).toBeGreaterThan(
      baseResult.allocation_parameters!.annualized_rowc_bps
    );

    // MATH-01 & MATH-02: Ex-GST tax base and 18% fee GST verification
    expect(creditResult.allocation_parameters?.marketplace_fee_gst_inr).toBe('7.1550');
    expect(creditResult.allocation_parameters?.income_tax_tds_holdback_inr).toBe('0.8898');
    expect(creditResult.allocation_parameters?.net_statutory_settlement_inr).toBe('2.1435');
  });

  it('M4-FORMULA-REGISTRY-RAG-010: Formula Registry BM25 retrieval, JCS cryptographic integrity, and test vector execution', () => {
    const registry = new FormulaRegistry();

    // 1. Verify JCS cryptographic integrity of all 5 canonical formulas
    const canonicalIds = [
      'FIN-LANDED-COST-001',
      'FIN-MKT-FEES-GST-002',
      'FIN-STATUTORY-TCS-TDS-003',
      'FIN-RETURN-ATTRITION-004',
      'FIN-CCC-ROWC-005'
    ];

    for (const id of canonicalIds) {
      expect(registry.verifyFormulaIntegrity(id)).toBe(true);
      const card = registry.getFormula(id);
      expect(card).toBeDefined();
      expect(card!.tier).toBe('PROMOTED_NORMATIVE');

      // 2. Execute canonical test vector
      const vector = card!.canonical_test_vector;
      const computed = registry.evaluateFormula(id, vector.inputs as Record<string, number>);
      expect(computed).toBe(BigInt(vector.expected_output));
    }

    // 3. RAG BM25 retrieval accuracy
    const matches = registry.retrieveFormulas('Section 194-O TDS GST offset');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].formula.formula_id).toBe('FIN-STATUTORY-TCS-TDS-003');
    expect(matches[0].relevance_score).toBeGreaterThan(0);
    expect(matches[0].matched_terms).toContain('194-o');
    expect(matches[0].matched_terms).toContain('tds');
  });

  it('M4-FORMULA-GOVERNANCE-ISOLATION-011: CANDIDATE_UI_MODEL sandboxing prevents unpromoted execution in production', () => {
    const registry = new FormulaRegistry();

    // 1. Register sandboxed candidate formula proposed via UI / intelligence
    const candidateCard = registry.registerCandidateFormula({
      formula_id: 'FIN-CANDIDATE-CUSTOMS-SURCHARGE-001',
      title: 'Imported SS304 Strip Anti-Dumping & Customs Surcharge Model',
      domain: 'TAX_STATUTORY',
      statutory_or_economic_citations: ['Customs Tariff Act 1975 Sec 9A'],
      symbolic_expression: 'Surcharge = BasicCustomsDuty + AntiDumpingDuty',
      input_variables: [
        { name: 'basic_customs_duty_subunits', unit: 'SUBUNITS_INR', description: 'Basic customs duty' },
        { name: 'anti_dumping_duty_subunits', unit: 'SUBUNITS_INR', description: 'Anti-dumping duty' }
      ],
      output_variable: { name: 'surcharge_subunits', unit: 'SUBUNITS_INR' },
      rationale_and_invariants: 'Sandboxed formula for testing imported strip duty impacts.',
      canonical_test_vector: {
        inputs: { basic_customs_duty_subunits: 10000, anti_dumping_duty_subunits: 15000 },
        expected_output: 25000
      }
    });

    expect(candidateCard.tier).toBe('CANDIDATE_UI_MODEL');
    expect(registry.verifyFormulaIntegrity('FIN-CANDIDATE-CUSTOMS-SURCHARGE-001')).toBe(true);

    // 2. Candidate formula is retrievable via BM25
    const retrieved = registry.retrieveFormulas('Customs Surcharge Anti-Dumping');
    expect(retrieved.some((r) => r.formula.formula_id === 'FIN-CANDIDATE-CUSTOMS-SURCHARGE-001')).toBe(true);

    // 3. Candidate formula fails closed if attempted to execute in production mode without promotion
    expect(() => {
      registry.evaluateFormula('FIN-CANDIDATE-CUSTOMS-SURCHARGE-001', {
        basic_customs_duty_subunits: 10000,
        anti_dumping_duty_subunits: 15000
      });
    }).toThrow('E-ERR-GOV-001: CANDIDATE_UI_MODEL formulas cannot execute in production without owner promotion');

    // 4. Prohibit candidate registration from overwriting PROMOTED_NORMATIVE formula
    expect(() => {
      registry.registerCandidateFormula({
        formula_id: 'FIN-LANDED-COST-001',
        title: 'Tampered Landed Cost',
        domain: 'PHYSICAL_ARBITRAGE',
        statutory_or_economic_citations: [],
        symbolic_expression: 'LandedCost = 0',
        input_variables: [],
        output_variable: { name: 'landed_cost_subunits', unit: 'SUBUNITS_INR' },
        rationale_and_invariants: 'Tampered',
        canonical_test_vector: { inputs: {}, expected_output: 0 }
      });
    }).toThrow('E-ERR-GOV-002: CANNOT_OVERWRITE_NORMATIVE_FORMULA');

    // 5. Authorized owner promotion promotes formula to PROMOTED_NORMATIVE
    const promoted = registry.promoteCandidateFormula(
      'FIN-CANDIDATE-CUSTOMS-SURCHARGE-001',
      'GOVERNED_RATIFICATION_OD-06'
    );
    expect(promoted.tier).toBe('PROMOTED_NORMATIVE');
    expect(registry.getFormula('FIN-CANDIDATE-CUSTOMS-SURCHARGE-001')?.tier).toBe('PROMOTED_NORMATIVE');
  });

  it('M4-GROQ-CREDENTIALS-012: Groq API credentials loaded and verified from Groq_Key.env with fallback support', () => {
    // 1. Verify key loading from environment or default Groq_Key.env path
    const key = loadGroqKeyFromEnv();
    expect(key).not.toBeNull();
    expect(typeof key).toBe('string');
    expect(key!.length).toBeGreaterThanOrEqual(20);
    expect(key!.startsWith('gsk_')).toBe(true);

    // 2. Non-existent path returns null safely
    const nullKey = loadGroqKeyFromEnv('D:/non_existent_key.env');
    expect(nullKey).toBeNull();

    // 3. GroqFormulaAdvisor initializes with key and configured or default model
    const advisor = new GroqFormulaAdvisor();
    expect(advisor.getApiKey()).toBe(key);
    expect(advisor.getModel()).toBeDefined();
  });

  it(
    'M4-GROQ-ADVISOR-PROPOSAL-013: LLM candidate proposal generation produces schema-compliant FormulaCard with deterministic fallback',
    async () => {
      // 1. Verify offline/deterministic simulated proposal generator
      const simAdvisor = new GroqFormulaAdvisor({ forceSimulated: true });
      const simShrinkage = await simAdvisor.proposeFormulaRefinement(
        'Warehouse inventory shrinkage drag for SS304 clamps'
      );
      expect(simShrinkage.formula_id).toBe('FIN-CANDIDATE-SHRINKAGE-001');
      expect(simShrinkage.domain).toBe('PHYSICAL_ARBITRAGE');
      expect(simShrinkage.symbolic_expression).toContain('Unit_Cost');
      expect(simShrinkage.canonical_test_vector.expected_output).toBe(10000);

      const simCustoms = await simAdvisor.proposeFormulaRefinement(
        'Customs anti-dumping duty surcharge on imported SS304 strip'
      );
      expect(simCustoms.formula_id).toBe('FIN-CANDIDATE-CUSTOMS-ADD-001');
      expect(simCustoms.domain).toBe('TAX_STATUTORY');
      expect(simCustoms.symbolic_expression).toContain('AntiDumpingDuty');

      const registry = new FormulaRegistry();
      const existing = registry.getFormula('FIN-LANDED-COST-001')!;
      const simRefined = await simAdvisor.proposeFormulaRefinement(
        'Refine landed cost with safety margin buffer',
        existing
      );
      expect(simRefined.formula_id).toContain('FIN-LANDED-COST-001');

      // 2. Verify live or fallback advisor produces valid schema-compliant proposal
      const liveAdvisor = new GroqFormulaAdvisor({ offlineFallback: true });
      const proposal = await liveAdvisor.proposeFormulaRefinement(
        'Warehouse inventory shrinkage drag for SS304 clamps'
      );
      expect(proposal.formula_id).toMatch(/^FIN-CANDIDATE-/);
      expect(proposal.symbolic_expression).toBeDefined();
      expect(proposal.input_variables.length).toBeGreaterThanOrEqual(2);
      expect(proposal.canonical_test_vector.inputs).toBeDefined();
      expect(proposal.canonical_test_vector.expected_output).toBeDefined();
    },
    25000
  );

  it(
    'M4-GROQ-ADVISOR-EVAL-ISOLATION-014: LLM candidate evaluation registers card, validates test vector, and governance firewall prohibits unpromoted execution in production',
    async () => {
      const registry = new FormulaRegistry();
      const advisor = new GroqFormulaAdvisor({ offlineFallback: true });

      // 1. Propose and evaluate LLM candidate
      const candidateInput = await advisor.proposeFormulaRefinement(
        'Warehouse inventory shrinkage drag for SS304 clamps'
      );
      const evalResult = await advisor.evaluateLlmCandidate(candidateInput, registry);

      // 2. Verify registration tier is sandboxed CANDIDATE_UI_MODEL
      expect(evalResult.registered_card.tier).toBe('CANDIDATE_UI_MODEL');
      expect(evalResult.registered_card.formula_id).toBe(candidateInput.formula_id);
      expect(registry.verifyFormulaIntegrity(evalResult.registered_card.formula_id)).toBe(true);

      // 3. Verify deterministic test vector execution passed
      expect(evalResult.test_vector_passed).toBe(true);
      expect(evalResult.computed_output).toBe(BigInt(candidateInput.canonical_test_vector.expected_output));

      // 4. Verify candidate is indexed and retrievable via BM25 RAG
      const ragMatches = registry.retrieveFormulas('Warehouse inventory shrinkage drag');
      expect(ragMatches.length).toBeGreaterThanOrEqual(1);
      expect(ragMatches.some((m) => m.formula.formula_id === candidateInput.formula_id)).toBe(true);

      // 5. Governance Firewall: candidate formula CANNOT execute in production without owner promotion
      expect(() => {
        registry.evaluateFormula(
          evalResult.registered_card.formula_id,
          candidateInput.canonical_test_vector.inputs as Record<string, number>
        );
      }).toThrow('E-ERR-GOV-001: CANDIDATE_UI_MODEL formulas cannot execute in production without owner promotion');

      // 6. Owner promotion promotes formula to PROMOTED_NORMATIVE
      const promoted = registry.promoteCandidateFormula(
        evalResult.registered_card.formula_id,
        'GOVERNED_RATIFICATION_OD-07'
      );
      expect(promoted.tier).toBe('PROMOTED_NORMATIVE');

      // 7. After promotion, execution succeeds in production mode
      const prodResult = registry.evaluateFormula(
        evalResult.registered_card.formula_id,
        candidateInput.canonical_test_vector.inputs as Record<string, number>
      );
      expect(prodResult).toBe(BigInt(candidateInput.canonical_test_vector.expected_output));
    },
    25000
  );

  it('M4-PURE-BIGINT-RATIONAL-AST-015: evaluateSymbolicExpression computes fractional bps expressions in pure BigInt rational arithmetic without IEEE-754 precision loss on large subunit values', () => {
    // 1. Large subunit value exceeding Number.MAX_SAFE_INTEGER (9007199254740991n)
    const largeInventoryValue = 9007199254740993500n;
    expect(largeInventoryValue).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));

    // Confirm that converting this value to IEEE-754 Number loses integer precision
    const floatCoerced = BigInt(Number(largeInventoryValue));
    expect(floatCoerced).not.toBe(largeInventoryValue);

    // 2. Expression with fractional basis points: (Shrinkage_Rate / 10000)
    // In naive BigInt integer division: 200n / 10000n = 0n (premature truncation).
    // In IEEE-754 double: loses precision on largeInventoryValue.
    // In pure BigInt Rational AST: exact rational calculation (largeInventoryValue * 200) / 10000.
    const expr1 = 'Loss = Inventory_Value * (Shrinkage_Rate / 10000)';
    const inputs1 = {
      Inventory_Value: largeInventoryValue,
      Shrinkage_Rate: 200n // 200 bps = 2.00%
    };

    const computedLoss1 = evaluateSymbolicExpression(expr1, inputs1);
    const expectedLoss1 = (largeInventoryValue * 200n) / 10000n;
    expect(computedLoss1).toBe(180143985094819870n);
    expect(computedLoss1).toBe(expectedLoss1);

    // 3. Complex multi-step fractional AST expression with average and unit cost
    // ((Opening + Closing) / 2) * (Shrinkage_Rate / 10000) * Unit_Cost
    const expr2 =
      'Shrinkage_Drag = ((Opening_Inventory + Closing_Inventory) / 2) * (Shrinkage_Rate / 10000) * Unit_Cost';
    const inputs2 = {
      Opening_Inventory: 1000n,
      Closing_Inventory: 950n,
      Shrinkage_Rate: 50n, // 50 bps = 0.50%
      Unit_Cost: 500n // ₹0.0500 per unit in subunits
    };
    // Average inventory = 975. Shrinkage = 975 * 0.005 = 4.875 units. Loss = 4.875 * 500 = 2437.5.
    // Half-up rounding at root: 2438n.
    const computedLoss2 = evaluateSymbolicExpression(expr2, inputs2);
    expect(computedLoss2).toBe(2438n);

    // 4. Zero division deterministic failure
    expect(() => {
      evaluateSymbolicExpression('Bad = A / Zero', { A: 1000n, Zero: 0n });
    }).toThrow('E-ERR-MATH-001: DIVISION_BY_ZERO: Division by zero in symbolic expression');
  });

  it('M4-RAG-FIRST-SUFFICIENCY-GATE-016: Local RAG sufficiency gate resolves existing statutory/economic concepts via RAG_CACHE_HIT and deterministic rules via DETERMINISTIC_APPEND with zero LLM calls', async () => {
    const registry = new FormulaRegistry();
    const advisor = new GroqFormulaAdvisor({ forceSimulated: true });
    advisor.resetTelemetry();

    // 1. Query existing statutory TCS/TDS concept
    const res1 = await advisor.resolveOrSynthesizeFormula(
      { query: 'Section 194-O TDS and Section 52 TCS on ex-GST revenue' },
      registry
    );
    expect(res1.resolution_path).toBe('RAG_CACHE_HIT');
    expect(res1.llm_called).toBe(false);
    expect(res1.card.formula_id).toBe('FIN-STATUTORY-TCS-TDS-003');
    expect(res1.rag_context_cards_used).toContain('FIN-STATUTORY-TCS-TDS-003');

    // 2. Query existing SS304 EXW landed cost concept
    const res2 = await advisor.resolveOrSynthesizeFormula(
      { query: 'SS304 landed cost EXW' },
      registry
    );
    expect(res2.resolution_path).toBe('RAG_CACHE_HIT');
    expect(res2.llm_called).toBe(false);
    expect(res2.card.formula_id).toBe('FIN-LANDED-COST-001');

    // 3. Deterministic rule addition resolves via DETERMINISTIC_APPEND with zero LLM calls
    const deterministicInput: FormulaCardInput = {
      formula_id: 'FIN-DETERMINISTIC-PACK-SURCHARGE-001',
      title: 'Warehouse SS304 Clamping Pack Surcharge Rule',
      domain: 'PHYSICAL_ARBITRAGE',
      statutory_or_economic_citations: ['Packaging Operational Policy 2026'],
      symbolic_expression: 'PackSurcharge = BaseCost + BulkHandlingFee',
      input_variables: [
        { name: 'BaseCost', unit: 'SUBUNITS_INR', description: 'Base pack landed cost' },
        { name: 'BulkHandlingFee', unit: 'SUBUNITS_INR', description: 'Fixed handling surcharge' }
      ],
      output_variable: { name: 'PackSurcharge', unit: 'SUBUNITS_INR' },
      rationale_and_invariants: 'Deterministic linear fee surcharge addition',
      canonical_test_vector: {
        inputs: { BaseCost: 382100, BulkHandlingFee: 15000 },
        expected_output: 397100
      }
    };

    const res3 = await advisor.resolveOrSynthesizeFormula(
      {
        query: 'Warehouse SS304 Clamping Pack Surcharge Rule',
        deterministic_card_input: deterministicInput
      },
      registry
    );
    expect(res3.resolution_path).toBe('DETERMINISTIC_APPEND');
    expect(res3.llm_called).toBe(false);
    expect(res3.card.formula_id).toBe('FIN-DETERMINISTIC-PACK-SURCHARGE-001');
    expect(registry.getFormula('FIN-DETERMINISTIC-PACK-SURCHARGE-001')).toBeDefined();

    // 4. Verify telemetry: 3 total requests, 2 RAG hits, 1 deterministic append, ZERO LLM calls
    const tel = advisor.getTelemetry();
    expect(tel.total_requests).toBe(3);
    expect(tel.rag_cache_hits).toBe(2);
    expect(tel.deterministic_appends).toBe(1);
    expect(tel.llm_calls_invoked).toBe(0);
    expect(tel.llm_dependency_ratio_bps).toBe(0);
  });

  it('M4-ASYMPTOTIC-LLM-DECAY-FLYWHEEL-017: Multi-step lifecycle proves asymptotic LLM decay flywheel, RAG-refined prompt injection, and persistent corpus reload', async () => {
    const registry = new FormulaRegistry();
    const advisor = new GroqFormulaAdvisor({ forceSimulated: true });
    advisor.resetTelemetry();

    // Step 1: Request novel metric missing from RAG corpus
    // Tier 1 misses -> triggers Tier 3 (LLM_RAG_REFINED_SYNTHESIS, llm_called === true)
    const step1Result = await advisor.resolveOrSynthesizeFormula(
      {
        query: 'Customs anti-dumping duty and port demurrage drag',
        required_variables: ['AntiDumpingDuty']
      },
      registry
    );

    expect(step1Result.resolution_path).toBe('LLM_RAG_REFINED_SYNTHESIS');
    expect(step1Result.llm_called).toBe(true);
    expect(step1Result.card.formula_id).toBe('FIN-CANDIDATE-CUSTOMS-ADD-001');
    expect(step1Result.rag_context_cards_used).toContain('FIN-LANDED-COST-001');
    expect(step1Result.refined_prompt_preview).toBeDefined();
    expect(step1Result.refined_prompt_preview).toContain('FIN-LANDED-COST-001');
    expect(step1Result.refined_prompt_preview).toContain('Customs Tariff Act 1975');
    expect(registry.getFormula('FIN-CANDIDATE-CUSTOMS-ADD-001')).toBeDefined();

    const t1 = advisor.getTelemetry();
    expect(t1.total_requests).toBe(1);
    expect(t1.llm_calls_invoked).toBe(1);
    expect(t1.llm_dependency_ratio_bps).toBe(10000); // 100.00% initial dependency

    // Step 2: Re-query "Customs anti-dumping duty and port demurrage drag" (and variations) 5 times
    // All 5 resolve via Tier 1 (RAG_CACHE_HIT, llm_called === false)
    const variations = [
      { query: 'Customs anti-dumping duty and port demurrage drag', required_variables: ['AntiDumpingDuty'] },
      { query: 'Customs anti-dumping duty import surcharge', required_variables: ['AntiDumpingDuty'] },
      { query: 'Anti-Dumping Duty Customs Surcharge SS304', required_variables: ['AntiDumpingDuty'] },
      { query: 'Imported SS304 Raw Strip Anti-Dumping & Surcharge Synthesis' },
      { query: 'Customs ADD duty strip surcharge' }
    ];

    let lastRatio = t1.llm_dependency_ratio_bps;
    for (const v of variations) {
      const hit = await advisor.resolveOrSynthesizeFormula(v, registry);
      expect(hit.resolution_path).toBe('RAG_CACHE_HIT');
      expect(hit.llm_called).toBe(false);
      expect(hit.card.formula_id).toBe('FIN-CANDIDATE-CUSTOMS-ADD-001');

      const currentRatio = advisor.getTelemetry().llm_dependency_ratio_bps;
      expect(currentRatio).toBeLessThan(lastRatio);
      lastRatio = currentRatio;
    }

    const t2 = advisor.getTelemetry();
    expect(t2.total_requests).toBe(6);
    expect(t2.llm_calls_invoked).toBe(1); // Frozen at 1!
    expect(t2.rag_cache_hits).toBe(5);
    expect(t2.llm_dependency_ratio_bps).toBe(1667); // Decayed from 10,000 bps down to 1,667 bps!

    // Step 3: Persist the grown corpus to disk and reload into a fresh FormulaRegistry instance
    const testCorpusPath = path.resolve(process.cwd(), 'data/formulas/governed_formula_corpus_test.json');
    registry.saveCorpusToFile(testCorpusPath);
    expect(fs.existsSync(testCorpusPath)).toBe(true);

    const freshRegistry = new FormulaRegistry();
    const countLoaded = freshRegistry.loadCorpusFromFile(testCorpusPath);
    expect(countLoaded).toBeGreaterThanOrEqual(6);
    expect(freshRegistry.verifyFormulaIntegrity('FIN-CANDIDATE-CUSTOMS-ADD-001')).toBe(true);

    // Verify fresh registry immediately serves the anti-dumping formula as a RAG_CACHE_HIT with 0 LLM calls
    const freshAdvisor = new GroqFormulaAdvisor({ forceSimulated: true });
    freshAdvisor.resetTelemetry();

    const freshHit = await freshAdvisor.resolveOrSynthesizeFormula(
      {
        query: 'Customs anti-dumping duty and port demurrage drag',
        required_variables: ['AntiDumpingDuty']
      },
      freshRegistry
    );
    expect(freshHit.resolution_path).toBe('RAG_CACHE_HIT');
    expect(freshHit.llm_called).toBe(false);
    expect(freshHit.card.formula_id).toBe('FIN-CANDIDATE-CUSTOMS-ADD-001');
    expect(freshAdvisor.getTelemetry().llm_calls_invoked).toBe(0);

    // Clean up temporary corpus file
    if (fs.existsSync(testCorpusPath)) {
      fs.unlinkSync(testCorpusPath);
    }
  });
});

