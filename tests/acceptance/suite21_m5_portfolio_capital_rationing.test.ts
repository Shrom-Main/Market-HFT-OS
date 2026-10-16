/**
 * SUITE-21: Gate M5 Multi-Opportunity Portfolio Capital Rationing,
 * Formula RAG Integration & Shadow What-If Sandbox Acceptance Suite
 *
 * Normative Acceptance Suite for Stage 3 Gate M5:
 * 1. M5-PORTFOLIO-RATIONING-001: Budget conservation, discrete MOQ sizing, concentration cap.
 * 2. M5-OPPORTUNITY-REJECTION-RIGOR-002: Rejection of viable candidate due to budget exhaustion.
 * 3. M5-SHADOW-SANDBOX-FORMULA-DELTA-003: Formula RAG bridge & shadow sandbox isolation.
 * 4. M5-PORTFOLIO-JCS-DETERMINISM-004: Bit-for-bit RFC 8785 JCS canonical determinism.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  M5PortfolioCapitalAllocator,
  CandidateOpportunityInput,
  PortfolioAllocationDecision
} from '../../src/research/m5PortfolioAllocator.js';
import {
  FormulaRegistry,
  FormulaCard,
  computeFormulaJcsHash
} from '../../src/research/formulaRegistry.js';
import { GroqFormulaAdvisor } from '../../src/research/llmFormulaAdvisor.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import {
  ProvenanceEnvelope,
  SupplierQuotePayload,
  InboundLogisticsPayload,
  PackagingKittingPayload,
  MarketplaceFeeSchedulePayload,
  OperationalEconomicsParameters,
  M4VerticalSliceInputs
} from '../../src/research/m4VerticalSlice.js';

describe('SUITE-21: Gate M5 Multi-Opportunity Portfolio Capital Rationing & Sandbox Acceptance', () => {
  const REF_TIME = '2026-10-16T12:00:00Z';
  const TOTAL_BUDGET = 500000000n; // ₹50,000.0000 (500,000,000 integer subunits)

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

  /**
   * Builds the 4-candidate industrial procurement pool fixture
   */
  function createFourCandidatePool(): CandidateOpportunityInput[] {
    // -----------------------------------------------------------------------
    // Candidate 1: DIN 3017 W4 Stainless Steel SS304 Worm-Drive Hose Clamp (Pack of 10)
    // Landed Cost: ₹38.2100 | MOQ: 500 | Batch Outlay: ₹19,105.0000 | RoWC: ~399%
    // -----------------------------------------------------------------------
    const cand1Inputs: M4VerticalSliceInputs = {
      supplier_quote: {
        source_id: 'supp:in:mumbai:metalcraft-ltd',
        observed_at_utc: '2026-10-16T08:00:00Z',
        ttl_seconds: 604800,
        is_verified: true,
        payload: {
          product_id: 'prod:din3017:ss304:pack-10',
          raw_material_purchase_subunits: 250000n, // ₹25.0000
          moq: 500,
          payment_terms_days: 0,
          incoterms: 'EXW'
        }
      },
      inbound_logistics: {
        source_id: 'log:in:bluedart-surface',
        observed_at_utc: '2026-10-16T08:00:00Z',
        ttl_seconds: 604800,
        is_verified: true,
        payload: {
          inbound_freight_subunits: 45000n, // ₹4.5000
          insurance_handling_subunits: 10000n, // ₹1.0000
          customs_inspection_subunits: 45100n // ₹4.5100
        }
      },
      packaging_kitting: {
        source_id: 'pkg:in:packpro-solutions',
        observed_at_utc: '2026-10-16T08:00:00Z',
        ttl_seconds: 604800,
        is_verified: true,
        payload: {
          packaging_kitting_subunits: 32000n // ₹3.2000
        }
      },
      marketplace_fees: {
        source_id: 'mkt:amzn:in:asin:B09XYZ1234',
        observed_at_utc: '2026-10-16T10:00:00Z',
        ttl_seconds: 86400,
        is_verified: true,
        payload: {
          asin: 'B09XYZ1234',
          gross_selling_price_subunits: 1050000n, // ₹105.0000
          referral_fee_bps: 1500n,
          closing_fee_subunits: 100000n,
          fba_weight_handling_subunits: 140000n,
          storage_fee_subunits: 0n
        }
      },
      operational_params: { ...defaultOpsParams },
      reference_time_utc: REF_TIME
    };

    // -----------------------------------------------------------------------
    // Candidate 2: DIN 3017 Marine Grade SS316 Worm-Drive Hose Clamp (Pack of 5)
    // Landed Cost: ₹80.0000 | MOQ: 250 | Batch Outlay: ₹20,000.0000 | RoWC: ~210%
    // -----------------------------------------------------------------------
    const cand2Inputs: M4VerticalSliceInputs = {
      supplier_quote: {
        source_id: 'supp:in:gujarat:marinetech-alloy',
        observed_at_utc: '2026-10-16T09:00:00Z',
        ttl_seconds: 604800,
        is_verified: true,
        payload: {
          product_id: 'prod:din3017:ss316:marine-pack-5',
          raw_material_purchase_subunits: 550000n, // ₹55.0000
          moq: 250,
          payment_terms_days: 0,
          incoterms: 'EXW'
        }
      },
      inbound_logistics: {
        source_id: 'log:in:bluedart-surface',
        observed_at_utc: '2026-10-16T09:00:00Z',
        ttl_seconds: 604800,
        is_verified: true,
        payload: {
          inbound_freight_subunits: 100000n, // ₹10.0000
          insurance_handling_subunits: 20000n, // ₹2.0000
          customs_inspection_subunits: 80000n // ₹8.0000
        }
      },
      packaging_kitting: {
        source_id: 'pkg:in:packpro-solutions',
        observed_at_utc: '2026-10-16T09:00:00Z',
        ttl_seconds: 604800,
        is_verified: true,
        payload: {
          packaging_kitting_subunits: 50000n // ₹5.0000
        }
      },
      marketplace_fees: {
        source_id: 'mkt:amzn:in:asin:B09MARIN316',
        observed_at_utc: '2026-10-16T10:00:00Z',
        ttl_seconds: 86400,
        is_verified: true,
        payload: {
          asin: 'B09MARIN316',
          gross_selling_price_subunits: 1900000n, // ₹190.0000
          referral_fee_bps: 1500n,
          closing_fee_subunits: 150000n, // ₹15.0000
          fba_weight_handling_subunits: 180000n, // ₹18.0000
          storage_fee_subunits: 0n
        }
      },
      operational_params: {
        ...defaultOpsParams,
        procurement_lead_time_days: 10,
        warehouse_dwell_days: 10,
        marketplace_settlement_delay_days: 14 // CCC = 10 + 10 + 14 = 34 days -> RoWC ~374%
      },
      reference_time_utc: REF_TIME
    };

    // -----------------------------------------------------------------------
    // Candidate 3: Galvanized Carbon Steel Clamp (Pack of 20)
    // Landed Cost: ₹15.0000 | MOQ: 1,000 | Batch Outlay: ₹15,000.0000 | RoWC: ~337%
    // Clears all M4 hurdles in isolation, but will be REJECTED in portfolio due to budget exhaustion!
    // -----------------------------------------------------------------------
    const cand3Inputs: M4VerticalSliceInputs = {
      supplier_quote: {
        source_id: 'supp:in:punjab:carbongalv-ind',
        observed_at_utc: '2026-10-16T09:30:00Z',
        ttl_seconds: 604800,
        is_verified: true,
        payload: {
          product_id: 'prod:carbon:galv:clamp-pack-20',
          raw_material_purchase_subunits: 110000n, // ₹11.0000
          moq: 1000,
          payment_terms_days: 0,
          incoterms: 'EXW'
        }
      },
      inbound_logistics: {
        source_id: 'log:in:bluedart-surface',
        observed_at_utc: '2026-10-16T09:30:00Z',
        ttl_seconds: 604800,
        is_verified: true,
        payload: {
          inbound_freight_subunits: 20000n, // ₹2.0000
          insurance_handling_subunits: 5000n, // ₹0.5000
          customs_inspection_subunits: 5000n // ₹0.5000
        }
      },
      packaging_kitting: {
        source_id: 'pkg:in:packpro-solutions',
        observed_at_utc: '2026-10-16T09:30:00Z',
        ttl_seconds: 604800,
        is_verified: true,
        payload: {
          packaging_kitting_subunits: 10000n // ₹1.0000
        }
      },
      marketplace_fees: {
        source_id: 'mkt:amzn:in:asin:B09CARB20P',
        observed_at_utc: '2026-10-16T10:00:00Z',
        ttl_seconds: 86400,
        is_verified: true,
        payload: {
          asin: 'B09CARB20P',
          gross_selling_price_subunits: 460000n, // ₹46.0000
          referral_fee_bps: 1500n,
          closing_fee_subunits: 40000n, // ₹4.0000
          fba_weight_handling_subunits: 80000n, // ₹8.0000
          storage_fee_subunits: 0n
        }
      },
      operational_params: {
        ...defaultOpsParams,
        procurement_lead_time_days: 10,
        warehouse_dwell_days: 21,
        marketplace_settlement_delay_days: 14 // CCC = 45 days -> RoWC ~337%
      },
      reference_time_utc: REF_TIME
    };

    // -----------------------------------------------------------------------
    // Candidate 4: Solid Brass Hose Barb Fitting 10mm
    // Landed Cost: ₹45.0000 | MOQ: 100 | Stale & Unverified Provenance -> QUARANTINED
    // -----------------------------------------------------------------------
    const cand4Inputs: M4VerticalSliceInputs = {
      supplier_quote: {
        source_id: 'supp:in:unverified:brass-craft',
        observed_at_utc: '2026-09-01T00:00:00Z', // 45 days old -> Stale!
        ttl_seconds: 604800, // 7 days TTL
        is_verified: false, // Unverified signature!
        payload: {
          product_id: 'prod:brass:barb:10mm',
          raw_material_purchase_subunits: 300000n,
          moq: 100,
          payment_terms_days: 0,
          incoterms: 'EXW'
        }
      },
      inbound_logistics: {
        source_id: 'log:in:bluedart-surface',
        observed_at_utc: '2026-10-16T09:30:00Z',
        ttl_seconds: 604800,
        is_verified: true,
        payload: {
          inbound_freight_subunits: 50000n,
          insurance_handling_subunits: 20000n,
          customs_inspection_subunits: 30000n
        }
      },
      packaging_kitting: {
        source_id: 'pkg:in:packpro-solutions',
        observed_at_utc: '2026-10-16T09:30:00Z',
        ttl_seconds: 604800,
        is_verified: true,
        payload: {
          packaging_kitting_subunits: 50000n
        }
      },
      marketplace_fees: {
        source_id: 'mkt:amzn:in:asin:B09BRASS10',
        observed_at_utc: '2026-10-16T10:00:00Z',
        ttl_seconds: 86400,
        is_verified: true,
        payload: {
          asin: 'B09BRASS10',
          gross_selling_price_subunits: 1200000n,
          referral_fee_bps: 1500n,
          closing_fee_subunits: 100000n,
          fba_weight_handling_subunits: 140000n,
          storage_fee_subunits: 0n
        }
      },
      operational_params: { ...defaultOpsParams },
      reference_time_utc: REF_TIME
    };

    return [
      {
        candidate_id: 'cand:01:ss304',
        product_id: 'prod:din3017:ss304:pack-10',
        title: 'DIN 3017 W4 Stainless Steel SS304 Worm-Drive Hose Clamp (Pack of 10)',
        vertical_slice_inputs: cand1Inputs,
        moq: 500
      },
      {
        candidate_id: 'cand:02:ss316',
        product_id: 'prod:din3017:ss316:marine-pack-5',
        title: 'DIN 3017 Marine Grade SS316 Worm-Drive Hose Clamp (Pack of 5)',
        vertical_slice_inputs: cand2Inputs,
        moq: 250
      },
      {
        candidate_id: 'cand:03:carbon',
        product_id: 'prod:carbon:galv:clamp-pack-20',
        title: 'Galvanized Carbon Steel Clamp (Pack of 20)',
        vertical_slice_inputs: cand3Inputs,
        moq: 1000
      },
      {
        candidate_id: 'cand:04:brass',
        product_id: 'prod:brass:barb:10mm',
        title: 'Solid Brass Hose Barb Fitting 10mm',
        vertical_slice_inputs: cand4Inputs,
        moq: 100
      }
    ];
  }

  // =========================================================================
  // TEST 1: M5-PORTFOLIO-RATIONING-001
  // =========================================================================
  it('M5-PORTFOLIO-RATIONING-001: Enforces budget conservation, discrete MOQ sizing, concentration cap, and T-Bill sweep', () => {
    const registry = new FormulaRegistry();
    const allocator = new M5PortfolioCapitalAllocator({
      total_treasury_budget_subunits: TOTAL_BUDGET, // ₹50,000.0000
      max_single_candidate_concentration_bps: 5000n, // 50.00% cap = ₹25,000.0000
      risk_free_rate_bps: 650n, // 6.50% p.a.
      default_hurdle_rate_bps: 1500n, // 15.00% p.a.
      formula_registry: registry
    });

    const candidates = createFourCandidatePool();
    const decision = allocator.allocatePortfolio(candidates, {
      decision_id: 'dec:m5:test:001',
      timestamp_utc: REF_TIME
    });

    // 1. Budget Conservation: committed + sweep === total_budget
    expect(decision.conservation_verified).toBe(true);
    const committed = BigInt(decision.committed_capital_subunits);
    const sweep = BigInt(decision.unallocated_tbill_sweep_subunits);
    expect(committed + sweep).toBe(TOTAL_BUDGET);

    // 2. Allocations must be sorted by rank
    expect(decision.allocations.length).toBe(2);

    // Candidate 1 (SS304) is Ranked #1
    const alloc1 = decision.allocations[0];
    expect(alloc1.candidate_id).toBe('cand:01:ss304');
    expect(alloc1.rank).toBe(1);
    expect(alloc1.allocated_lots).toBe(1);
    expect(alloc1.allocated_quantity).toBe(500);
    expect(alloc1.unit_landed_cost_subunits).toBe('382100'); // ₹38.2100
    expect(alloc1.allocated_capital_subunits).toBe('191050000'); // ₹19,105.0000
    expect(BigInt(alloc1.annualized_rowc_bps)).toBeGreaterThan(30000n); // ~399%

    // Candidate 2 (SS316 Marine) is Ranked #2
    const alloc2 = decision.allocations[1];
    expect(alloc2.candidate_id).toBe('cand:02:ss316');
    expect(alloc2.rank).toBe(2);
    expect(alloc2.allocated_lots).toBe(1);
    expect(alloc2.allocated_quantity).toBe(250);
    expect(alloc2.unit_landed_cost_subunits).toBe('800000'); // ₹80.0000
    expect(alloc2.allocated_capital_subunits).toBe('200000000'); // ₹20,000.0000
    expect(BigInt(alloc2.annualized_rowc_bps)).toBeGreaterThan(15000n); // ~210%

    // Total committed = 191,050,000 + 200,000,000 = 391,050,000 (₹39,105.0000)
    expect(decision.committed_capital_subunits).toBe('391050000');

    // Residual T-Bill Sweep = 500,000,000 - 391,050,000 = 108,950,000 (₹10,895.0000)
    expect(decision.unallocated_tbill_sweep_subunits).toBe('108950000');
    expect(decision.tbill_annualized_yield_bps).toBe('650');

    // Single-candidate concentration cap: no candidate exceeded 50% (₹25,000.0000)
    const cap = 250000000n;
    expect(BigInt(alloc1.allocated_capital_subunits)).toBeLessThanOrEqual(cap);
    expect(BigInt(alloc2.allocated_capital_subunits)).toBeLessThanOrEqual(cap);

    // Effective portfolio RoWC is positive and higher than risk-free rate
    expect(BigInt(decision.effective_portfolio_rowc_bps)).toBeGreaterThan(650n);
  });

  // =========================================================================
  // TEST 2: M5-OPPORTUNITY-REJECTION-RIGOR-002
  // =========================================================================
  it('M5-OPPORTUNITY-REJECTION-RIGOR-002: Proves viable candidate is rejected when budget is exhausted, and unverified candidate is quarantined fail-closed', () => {
    const allocator = new M5PortfolioCapitalAllocator({
      total_treasury_budget_subunits: TOTAL_BUDGET,
      max_single_candidate_concentration_bps: 5000n,
      formula_registry: new FormulaRegistry()
    });

    const candidates = createFourCandidatePool();
    const decision = allocator.allocatePortfolio(candidates, {
      decision_id: 'dec:m5:test:002',
      timestamp_utc: REF_TIME
    });

    expect(decision.rejections.length).toBe(2);

    // Candidate 3 (Carbon Steel) was viable in isolation, but rejected due to budget exhaustion!
    const rejCarbon = decision.rejections.find((r) => r.candidate_id === 'cand:03:carbon');
    expect(rejCarbon).toBeDefined();
    expect(rejCarbon?.status).toBe('REJECTED');
    expect(rejCarbon?.isolated_viable).toBe(true);
    expect(rejCarbon?.rejection_reasons[0]).toContain('E-M5-BUDGET-EXHAUSTED');
    expect(rejCarbon?.batch_outlay_subunits).toBe('150000000'); // ₹15,000.0000 > ₹10,895.0000 remaining

    // Candidate 4 (Brass Barb) has unverified signature and expired TTL -> QUARANTINED fail-closed
    const rejBrass = decision.rejections.find((r) => r.candidate_id === 'cand:04:brass');
    expect(rejBrass).toBeDefined();
    expect(rejBrass?.status).toBe('QUARANTINED');
    expect(rejBrass?.isolated_viable).toBe(false);
    expect(
      rejBrass?.rejection_reasons.some((r) => r.includes('UNVERIFIED') || r.includes('STALE'))
    ).toBe(true);
  });

  // =========================================================================
  // TEST 3: M5-SHADOW-SANDBOX-FORMULA-DELTA-003
  // =========================================================================
  it('M5-SHADOW-SANDBOX-FORMULA-DELTA-003: Bridges FormulaRegistry + GroqFormulaAdvisor, quantifying rank & decision flips without mutating authoritative allocation', async () => {
    const registry = new FormulaRegistry();
    const advisor = new GroqFormulaAdvisor({ offlineFallback: true });

    // Register a candidate what-if stress formula in the sandboxed CANDIDATE_UI_MODEL tier
    // Models warehouse inventory shrinkage and maritime anti-dumping tariff drag
    const stressFormulaCardInput = {
      formula_id: 'CAND-SHRINKAGE-DUTY-DRAG-006',
      title: 'Warehouse Inventory Shrinkage & Anti-Dumping Duty Surcharge Drag',
      domain: 'PHYSICAL_ARBITRAGE' as const,
      tier: 'CANDIDATE_UI_MODEL' as const,
      statutory_or_economic_citations: [
        'Customs Anti-Dumping Notification No. 12/2026',
        'FBA Inventory Reimbursement & Lost/Damaged Policy 2026'
      ],
      symbolic_expression: 'Drag = \\lfloor (landed_cost_subunits \\times shrinkage_bps) / 10000 \\rfloor',
      input_variables: [
        {
          name: 'landed_cost_subunits',
          unit: 'SUBUNITS_INR' as const,
          description: 'Unit landed inventory cost'
        },
        {
          name: 'shrinkage_bps',
          unit: 'BPS' as const,
          description: 'Simulated shrinkage & regulatory duty drag in basis points'
        }
      ],
      output_variable: {
        name: 'stress_drag_subunits',
        unit: 'SUBUNITS_INR' as const
      },
      rationale_and_invariants:
        'Stress-tests candidate margins by applying warehouse shrinkage and anti-dumping duty drag in sandbox what-if mode.',
      canonical_test_vector: {
        inputs: {
          landed_cost_subunits: 800000,
          shrinkage_bps: 2000
        },
        expected_output: 160000
      }
    };

    const registeredCard = registry.registerCandidateFormula(stressFormulaCardInput);
    expect(registeredCard.tier).toBe('CANDIDATE_UI_MODEL');

    // Proves governance firewall: candidate formula cannot execute in production without owner promotion
    expect(() =>
      registry.evaluateFormula(registeredCard.formula_id, {
        landed_cost_subunits: 800000n,
        shrinkage_bps: 2000n
      })
    ).toThrow(/E-ERR-GOV-001/);

    const allocator = new M5PortfolioCapitalAllocator({
      total_treasury_budget_subunits: TOTAL_BUDGET,
      max_single_candidate_concentration_bps: 5000n,
      formula_registry: registry
    });

    const candidates = createFourCandidatePool();

    // Run dual-pass allocation:
    // Apply 3500 bps (35%) stress drag on Candidate 2 (SS316 Marine) in the shadow pass
    const decision = allocator.allocatePortfolio(candidates, {
      decision_id: 'dec:m5:test:003:shadow',
      timestamp_utc: REF_TIME,
      shadow_stress: {
        stress_formula: registeredCard,
        candidate_parameter_overrides: {
          'cand:02:ss316': {
            shrinkage_bps: 3500 // 35% drag -> net contribution becomes negative
          }
        }
      }
    });

    // 1. Authoritative allocation remains completely isolated and intact!
    expect(decision.allocations.length).toBe(2);
    expect(decision.allocations[0].candidate_id).toBe('cand:01:ss304');
    expect(decision.allocations[1].candidate_id).toBe('cand:02:ss316');
    expect(decision.committed_capital_subunits).toBe('391050000');

    // 2. Shadow Sandbox Comparison is generated
    expect(decision.shadow_sandbox_comparison).toBeDefined();
    const shadow = decision.shadow_sandbox_comparison!;
    expect(shadow.stress_formulas_applied).toContain('CAND-SHRINKAGE-DUTY-DRAG-006');
    expect(shadow.has_decision_flips).toBe(true);

    // Candidate 2 (SS316) suffered heavy drag: flipped from APPROVED -> REJECTED
    const cand2Delta = shadow.candidate_deltas.find((d) => d.candidate_id === 'cand:02:ss316')!;
    expect(cand2Delta.original_decision).toBe('APPROVED');
    expect(cand2Delta.shadow_decision).toBe('REJECTED');
    expect(cand2Delta.decision_flipped).toBe(true);
    expect(BigInt(cand2Delta.rowc_delta_bps)).toBeLessThan(0n); // negative RoWC drag

    // Because Candidate 2 was rejected in the shadow pass, capital freed up (₹30,895 available)
    // allowing Candidate 3 (Carbon Steel, needing ₹15,000) to flip from REJECTED -> APPROVED!
    const cand3Delta = shadow.candidate_deltas.find((d) => d.candidate_id === 'cand:03:carbon')!;
    expect(cand3Delta.original_decision).toBe('REJECTED');
    expect(cand3Delta.shadow_decision).toBe('APPROVED');
    expect(cand3Delta.decision_flipped).toBe(true);
    expect(cand3Delta.shadow_rank).toBe(2);
  });

  // =========================================================================
  // TEST 4: M5-PORTFOLIO-JCS-DETERMINISM-004
  // =========================================================================
  it('M5-PORTFOLIO-JCS-DETERMINISM-004: Proves bit-for-bit RFC 8785 JCS canonical serialization and SHA-256 reproducibility', () => {
    const allocator = new M5PortfolioCapitalAllocator({
      total_treasury_budget_subunits: TOTAL_BUDGET,
      formula_registry: new FormulaRegistry()
    });

    const candidates = createFourCandidatePool();

    // Run 1
    const decision1 = allocator.allocatePortfolio(candidates, {
      decision_id: 'dec:m5:deterministic:fixed-id',
      timestamp_utc: '2026-10-16T12:00:00.000Z'
    });

    // Run 2 (identically configured)
    const decision2 = allocator.allocatePortfolio(candidates, {
      decision_id: 'dec:m5:deterministic:fixed-id',
      timestamp_utc: '2026-10-16T12:00:00.000Z'
    });

    // Verify bit-for-bit identical SHA-256 digest
    expect(decision1.portfolio_decision_sha256).toBeDefined();
    expect(decision1.portfolio_decision_sha256.length).toBe(64);
    expect(decision1.portfolio_decision_sha256).toBe(decision2.portfolio_decision_sha256);

    // Verify JCS serialization independently matches
    const { portfolio_decision_sha256: _, ...clean1 } = decision1;
    const jcs1 = canonicalizeJCS(clean1);
    const expectedHash = createHash('sha256').update(jcs1).digest('hex');
    expect(decision1.portfolio_decision_sha256).toBe(expectedHash);
  });
});
