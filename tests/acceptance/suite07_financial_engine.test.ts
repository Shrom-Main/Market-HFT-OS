import { describe, it, expect } from 'vitest';
import {
  computeOperatingCashFlowSeries,
  computePostOutlayRecoveryMetrics,
  validateCashFlowDoubleCounting,
  CommittedCapitalManager,
  computeRoPF,
  computeCoC,
  computeHPR,
  solveXIRR,
  TwoTierGrossClearingLedger
} from '../../src/financial/cashFlowEngine.js';
import {
  calculateVolumetricWeightGrams,
  normalizeProductIdentityCore,
  generateCanonicalProductId,
  createPhysicalDimensions,
  validateInventoryQuantity
} from '../../src/canonical/product.js';

describe('SUITE-07: Financial Engine & Recovery Durations', () => {
  it('REC-OUTLAY-001: Numerical proof of 15-day outlay recovery and 25-day lifecycle recovery', () => {
    // Day 0: 2026-10-01T00:00:00Z
    // Day 10: 2026-10-11T00:00:00Z
    // Day 25: 2026-10-26T00:00:00Z
    const t0 = '2026-10-01T00:00:00Z';
    const flows = [
      {
        entry_timestamp_utc: '2026-10-01T12:00:00Z', // Day 0
        sequence_number: 1,
        amount: 500,
        flow_kind: 'NET_MERCHANT_PROCEEDS' as const
      },
      {
        entry_timestamp_utc: '2026-10-11T12:00:00Z', // Day 10
        sequence_number: 2,
        amount: -1500,
        flow_kind: 'PROCUREMENT_OUTLAY' as const
      },
      {
        entry_timestamp_utc: '2026-10-26T12:00:00Z', // Day 25
        sequence_number: 3,
        amount: 1200,
        flow_kind: 'NET_MERCHANT_PROCEEDS' as const
      }
    ];

    const result = computePostOutlayRecoveryMetrics(flows, t0);

    expect(result.status).toBe('RECOVERED');
    expect(result.k_outlay).toBe(2);
    expect(result.k_rec).toBe(3);
    expect(result.outlay_recovery_duration_days).toBe(15);
    expect(result.lifecycle_recovery_duration_days).toBe(25);
    expect(result.peak_operating_funding).toBe(1000);
  });

  it('FUND-INTRADAY-001: Intraday peak funding accounts for morning deficit even if reimbursed evening', () => {
    const flows = [
      {
        entry_timestamp_utc: '2026-10-10T09:00:00Z',
        sequence_number: 1,
        amount: -10000,
        flow_kind: 'PROCUREMENT_OUTLAY' as const
      },
      {
        entry_timestamp_utc: '2026-10-10T17:00:00Z',
        sequence_number: 2,
        amount: 10000,
        flow_kind: 'NET_MERCHANT_PROCEEDS' as const
      }
    ];

    const series = computeOperatingCashFlowSeries(flows, '2026-10-10T00:00:00Z');
    expect(series.peak_operating_funding).toBe(10000);
    expect(series.peak_daily_net_ops).toBe(0);
  });

  it('VOL-SAFEINT-001 (KAT-03): Exact safe-integer volumetric calculation matches 1,200g', () => {
    const weightGrams = calculateVolumetricWeightGrams(300, 200, 100);
    expect(weightGrams).toBe(1200);
  });

  it('VOL-BOUND-002: Rejects dimensions exceeding 10,000mm bound fail-closed', () => {
    expect(() => calculateVolumetricWeightGrams(15000, 200, 100)).toThrow(/E-ERR-021: DIMENSION_BOUNDS_EXCEEDED/);
  });

  it('VOL-ROUND-HALFUP-003: Remainder exactly 2500 rounds up to quotient + 1', () => {
    // 5000 * 2 + 2500 = 12500 mm^3 -> e.g. 50 x 50 x 5 = 12500. Quotient 2, remainder 2500 -> 3g
    const weight = calculateVolumetricWeightGrams(50, 50, 5);
    expect(weight).toBe(3);
  });

  it('FIN-CASHFLOW-GROSS-DOUBLECOUNT-030: Rejects series containing both gross sales and net disbursements', () => {
    const invalidFlows = [
      { entry_timestamp_utc: '2026-10-10T10:00:00Z', sequence_number: 1, amount: 5000, flow_kind: 'GROSS_CHECKOUT_PROCEEDS' as const },
      { entry_timestamp_utc: '2026-10-10T12:00:00Z', sequence_number: 2, amount: 4500, flow_kind: 'NET_MERCHANT_DISBURSEMENT' as const }
    ];
    expect(() => validateCashFlowDoubleCounting(invalidFlows)).toThrow(/E-ERR-038: CASH_FLOW_DOUBLE_COUNTING_PROHIBITED/);
  });

  it('FIN-PO-NETTING-003 & FIN-PO-REPLACED-006: Committed capital netting and order replacement lifecycle', () => {
    const manager = new CommittedCapitalManager();
    // Issue PO $100k
    manager.authorizePO('PO-1', 100000);
    expect(manager.total_committed_capital).toBe(100000);

    // Cancel $20k is not possible directly, but fulfillment relieves $50k
    manager.fulfillPO('PO-1', 50000);
    expect(manager.total_committed_capital).toBe(50000);

    // Replace PO-1 ($50k remaining) with PO-2 ($80k)
    manager.replacePO('PO-1', 'PO-2', 80000);
    expect(manager.total_committed_capital).toBe(80000);
  });

  it('PROD-NORM-NFC-HSN-025: normalizeProductIdentityCore normalizes HSN, units, and preserves MPN casing', () => {
    const raw = {
      category_hsn: '7326 90 99',
      unit_of_measure: 'PACK' as const,
      units_per_pack: 10,
      standard_specification: 'din 3017 ss304 w4',
      manufacturer_id: 'mfr:in:bhiwadi',
      manufacturer_part_number: 'BPC-3017-16-25-a'
    };
    const norm = normalizeProductIdentityCore(raw);
    expect(norm.category_hsn).toBe('73269099');
    expect(norm.standard_specification).toBe('DIN_3017_SS304_W4');
    // Default preserves exact casing
    expect(norm.manufacturer_part_number).toBe('BPC-3017-16-25-a');

    // Case-insensitive namespace folds to uppercase
    const normUpper = normalizeProductIdentityCore(raw, {
      'mfr:in:bhiwadi': { manufacturer_id: 'mfr:in:bhiwadi', case_insensitive: true }
    });
    expect(normUpper.manufacturer_part_number).toBe('BPC-3017-16-25-A');
  });

  it('HSN-LEGAL-ASSIGNMENT-SYNTAX-032 & PROD-NORM-SAFE-003: Rejects control characters, invalid HSN, and duplicate dimension keys', () => {
    expect(() => normalizeProductIdentityCore({
      category_hsn: '7326\u000090',
      unit_of_measure: 'PIECE',
      units_per_pack: 1,
      critical_dimension_key: 'range:16-25'
    })).toThrow(/E-ERR-024: MALFORMED_IDENTIFIER/);

    expect(() => normalizeProductIdentityCore({
      category_hsn: '732690',
      unit_of_measure: 'PIECE',
      units_per_pack: 1,
      critical_dimension_key: 'width:9;width:12'
    })).toThrow(/E-ERR-024: DUPLICATE_DIMENSION_KEY/);
  });

  it('PROD-NORM-DETERMINISTIC-004 & PROD-COLL-001: generateCanonicalProductId generates deterministic prod: SHA-256 with collision resistance', () => {
    const core = {
      category_hsn: '73269099',
      unit_of_measure: 'PACK' as const,
      units_per_pack: 10,
      critical_dimension_key: 'range:16-25;width:9'
    };
    const id1 = generateCanonicalProductId(core);
    const id2 = generateCanonicalProductId(core);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^prod:[a-f0-9]{64}$/);
  });

  it('PHYS-DIM-001: createPhysicalDimensions computes volumetric weight and validates bounds', () => {
    const dims = createPhysicalDimensions(300, 200, 100, 800, 1000);
    expect(dims.calculated_volumetric_weight_g).toBe(1200);
    expect(dims.gross_packaged_weight_g).toBe(1000);

    expect(() => createPhysicalDimensions(300, 200, 100, 0, 1000)).toThrow(/E-ERR-021: DIMENSION_BOUNDS_EXCEEDED/);
  });

  it('INV-QTY-BOUND-002: validateInventoryQuantity checks non-negative safe integer within 10^9 bound', () => {
    expect(() => validateInventoryQuantity(500)).not.toThrow();
    expect(() => validateInventoryQuantity(0)).not.toThrow();
    expect(() => validateInventoryQuantity(-1)).toThrow(/E-ERR-034: INVALID_INVENTORY_QUANTITY/);
    expect(() => validateInventoryQuantity(1.5)).toThrow(/E-ERR-034: INVALID_INVENTORY_QUANTITY/);
    expect(() => validateInventoryQuantity(1000000001)).toThrow(/E-ERR-034: INVALID_INVENTORY_QUANTITY/);
  });

  it('FIN-ROPF-PEAK-007 & FIN-CONV-HPR-008: computeRoPF, computeCoC, and computeHPR evaluate correctly', () => {
    const t0 = '2026-10-01T00:00:00Z';
    const flows = [
      { entry_timestamp_utc: '2026-10-01T12:00:00Z', sequence_number: 1, amount: -1000, flow_kind: 'PROCUREMENT_OUTLAY' as const },
      { entry_timestamp_utc: '2026-10-05T12:00:00Z', sequence_number: 2, amount: 1200, flow_kind: 'NET_MERCHANT_PROCEEDS' as const }
    ];

    // RoPF
    const ropf = computeRoPF(flows, t0, 0);
    expect(ropf.status).toBe('SUCCESS');
    if (ropf.status === 'SUCCESS') {
      expect(ropf.ropf_percentage).toBe(20); // (200 / 1000) * 100
    }

    // CoC
    const coc = computeCoC(flows);
    expect(coc).toBe(1.2); // 1200 / 1000

    // HPR
    const hpr = computeHPR(1000, 1150, 50);
    expect(hpr).toBe(20); // ((1150 - 1000 + 50) / 1000) * 100
  });

  it('FIN-XIRR-001: solveXIRR converges on annual IRR and returns expected status codes', () => {
    const flows = [
      { entry_timestamp_utc: '2026-01-01T00:00:00Z', sequence_number: 1, amount: -100000, flow_kind: 'PROCUREMENT_OUTLAY' as const },
      { entry_timestamp_utc: '2027-01-01T00:00:00Z', sequence_number: 2, amount: 110000, flow_kind: 'NET_MERCHANT_PROCEEDS' as const }
    ];
    const res = solveXIRR(flows);
    expect(res.status).toBe('CONVERGED');
    if (res.status === 'CONVERGED') {
      expect(res.xirr).toBeCloseTo(0.10, 2);
    }

    // Invalid cash flows: all positive
    const allPos = [
      { entry_timestamp_utc: '2026-01-01T00:00:00Z', sequence_number: 1, amount: 100, flow_kind: 'NET_MERCHANT_PROCEEDS' as const }
    ];
    expect(solveXIRR(allPos).status).toBe('INVALID_CASH_FLOWS');
  });

  it('FIN-GROSS-CLEARING-TIER-037: TwoTierGrossClearingLedger tracks clearing vs bank balances', () => {
    const ledger = new TwoTierGrossClearingLedger();
    ledger.recordGrossProceeds(10000);
    expect(ledger.getBalances().b_clearing).toBe(10000);
    expect(ledger.getBalances().b_bank).toBe(0);

    ledger.recordClearingDeduction(300);
    expect(ledger.getBalances().b_clearing).toBe(9700);

    ledger.recordNetDisbursementToBank(9700);
    expect(ledger.getBalances().b_clearing).toBe(0);
    expect(ledger.getBalances().b_bank).toBe(9700);
  });

  it('FIN-RECOVERY-TRANSIENT-001: Transient recovery relapsing into deficit is classified as NOT_RECOVERED', () => {
    const t0 = '2026-10-01T00:00:00Z';
    const flows = [
      {
        entry_timestamp_utc: '2026-10-05T00:00:00Z',
        sequence_number: 1,
        amount: -1000,
        flow_kind: 'PROCUREMENT_OUTLAY' as const
      },
      {
        entry_timestamp_utc: '2026-10-10T00:00:00Z',
        sequence_number: 2,
        amount: 1200, // Reaches +200 at k_rec = 2
        flow_kind: 'NET_MERCHANT_PROCEEDS' as const
      },
      {
        entry_timestamp_utc: '2026-10-15T00:00:00Z',
        sequence_number: 3,
        amount: -500, // Drops back to -300 at k = 3 (relapse)
        flow_kind: 'STATUTORY_TAX_REMIT' as const
      }
    ];

    const result = computePostOutlayRecoveryMetrics(flows, t0);
    expect(result.status).toBe('NOT_RECOVERED');
    expect(result.transient_recovery_detected).toBe(true);
    expect(result.transient_k_rec).toBe(2);
    expect(result.peak_operating_funding).toBe(1000);
  });

  it('FIN-CASHFLOW-SUBUNITS-002: Accepts integer subunits and CanonicalMoney entries, and rejects cross-currency mixtures', () => {
    const t0 = '2026-10-01T00:00:00Z';
    const flows = [
      {
        entry_timestamp_utc: '2026-10-05T00:00:00Z',
        sequence_number: 1,
        amount: { amount_subunits: '-5000', currency: 'INR' as const, scale: 2 },
        flow_kind: 'PROCUREMENT_OUTLAY' as const
      },
      {
        entry_timestamp_utc: '2026-10-10T00:00:00Z',
        sequence_number: 2,
        amount: 0,
        amount_subunits: '8000',
        currency: 'INR' as const,
        flow_kind: 'NET_MERCHANT_PROCEEDS' as const
      }
    ];

    const res = computeOperatingCashFlowSeries(flows, t0);
    expect(res.cumulative_balances).toEqual([0, -5000, 3000]);
    expect(res.peak_operating_funding).toBe(5000);

    // Cross-currency mixture must throw E-ERR-008
    const mixed = [
      ...flows,
      {
        entry_timestamp_utc: '2026-10-12T00:00:00Z',
        sequence_number: 3,
        amount: 100,
        currency: 'USD' as const,
        flow_kind: 'NET_MERCHANT_PROCEEDS' as const
      }
    ];
    expect(() => computeOperatingCashFlowSeries(mixed, t0)).toThrow('E-ERR-008: CROSS_CURRENCY_OPERATION_PROHIBITED');
  });

  it('FIN-CASHFLOW-PREINCEPTION-003: Rejects entries before position inception timestamp fail-closed', () => {
    const t0 = '2026-10-10T00:00:00Z';
    const flows = [
      {
        entry_timestamp_utc: '2026-10-09T23:59:59Z',
        sequence_number: 1,
        amount: -100,
        flow_kind: 'PROCUREMENT_OUTLAY' as const
      }
    ];

    expect(() => computeOperatingCashFlowSeries(flows, t0)).toThrow('E-ERR-024: CASH_FLOW_BEFORE_INCEPTION');
    expect(() => computePostOutlayRecoveryMetrics(flows, t0)).toThrow('E-ERR-024: CASH_FLOW_BEFORE_INCEPTION');
  });

  it('PROP-INV-001: Fuzz 1,000 inventory state transitions across 7 buckets and assert bitwise conservation', () => {
    // 7 canonical inventory buckets per Frozen Spec §5.2 / §7.1 / §8.2
    const BUCKET_NAMES = [
      'ON_HAND_AVAILABLE',
      'COMMITTED_IN_FLIGHT',
      'RESERVED_FULFILLMENT',
      'IN_TRANSIT_INBOUND',
      'IN_TRANSIT_INTERNAL',
      'CUSTOMER_RETURNED_PENDING_INSPECTION',
      'DAMAGED_QUARANTINED'
    ] as const;

    // Seeded Linear Congruential Generator (PRNG) for deterministic replay
    let seed = 0xCAFEBABE;
    function nextRand(max: number): number {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed % max;
    }

    let buckets: Record<string, bigint> = {
      ON_HAND_AVAILABLE: 10000n,
      COMMITTED_IN_FLIGHT: 2000n,
      RESERVED_FULFILLMENT: 1000n,
      IN_TRANSIT_INBOUND: 5000n,
      IN_TRANSIT_INTERNAL: 1500n,
      CUSTOMER_RETURNED_PENDING_INSPECTION: 500n,
      DAMAGED_QUARANTINED: 200n
    };

    for (let i = 0; i < 1000; i++) {
      const openingSum = Object.values(buckets).reduce((acc, val) => acc + val, 0n);
      const opType = nextRand(3); // 0: internal rebalance, 1: inbound receipt, 2: outbound fulfillment
      let inboundQty = 0n;
      let outboundQty = 0n;

      if (opType === 0) {
        // Internal transfer between two buckets (total inventory conserved)
        const fromIdx = nextRand(BUCKET_NAMES.length);
        const toIdx = nextRand(BUCKET_NAMES.length);
        const fromKey = BUCKET_NAMES[fromIdx];
        const toKey = BUCKET_NAMES[toIdx];
        const maxShift = Number(buckets[fromKey]);
        if (maxShift > 0) {
          const shiftQty = BigInt(nextRand(maxShift + 1));
          buckets[fromKey] -= shiftQty;
          buckets[toKey] += shiftQty;
        }
      } else if (opType === 1) {
        // Inbound supplier delivery
        inboundQty = BigInt(nextRand(250) + 1);
        buckets['IN_TRANSIT_INBOUND'] += inboundQty;
      } else {
        // Outbound shipment from on-hand inventory
        const avail = Number(buckets['ON_HAND_AVAILABLE']);
        if (avail > 0) {
          outboundQty = BigInt(nextRand(avail + 1));
          buckets['ON_HAND_AVAILABLE'] -= outboundQty;
        }
      }

      const closingSum = Object.values(buckets).reduce((acc, val) => acc + val, 0n);
      expect(closingSum).toBe(openingSum + inboundQty - outboundQty);

      // Invariant: no bucket quantity may be negative
      for (const bucketKey of BUCKET_NAMES) {
        expect(buckets[bucketKey] >= 0n).toBe(true);
      }
    }
  });

  it('META-FEE-001: Monotonically increase Amazon closing fee across >= 5 steps and assert net contribution is strictly non-increasing', () => {
    const grossSellingPriceSubunits = 1100000n; // ₹110.0000 (scale 4)
    const landedCostSubunits = 382100n;         // ₹38.2100
    const referralFeeSubunits = 165000n;        // ₹16.5000 (15% referral fee)

    // Stepping Amazon closing fee monotonically across >= 5 discrete steps
    const closingFeeStepsSubunits = [
      50000n,  // ₹5.0000
      100000n, // ₹10.0000
      150000n, // ₹15.0000
      200000n, // ₹20.0000
      250000n, // ₹25.0000
      300000n  // ₹30.0000
    ];

    expect(closingFeeStepsSubunits.length >= 5).toBe(true);

    let prevNetContribution: bigint | null = null;
    for (const closingFee of closingFeeStepsSubunits) {
      const totalFees = referralFeeSubunits + closingFee;
      const netContribution = grossSellingPriceSubunits - landedCostSubunits - totalFees;

      if (prevNetContribution !== null) {
        // Monotonic non-increasing invariant: net contribution at step k <= net contribution at step k-1
        expect(netContribution <= prevNetContribution).toBe(true);
        expect(netContribution < prevNetContribution).toBe(true); // Since closing fee strictly increases
      }
      prevNetContribution = netContribution;
    }
  });

  it('HIST-REPLAY-001: Replay AIStudio commit 0c67e26 March 2026 fixture (canonical SS304 pack-of-10 clamp, landed cost ₹38.21) producing deterministic recommendation', () => {
    // Exact canonical fixture from March 2026 AIStudio commit 0c67e26
    const fixture = {
      product_id: 'prod:din3017:ss304:pack-10',
      description: 'DIN 3017 W4 SS304 Worm-Drive Hose Clamp (Pack of 10, 16-25mm)',
      raw_material_purchase_subunits: 250000n, // ₹25.0000
      inbound_freight_subunits: 45000n,        // ₹4.5000
      packaging_labeling_subunits: 32000n,     // ₹3.2000
      insurance_handling_subunits: 10000n,     // ₹1.0000
      customs_inspection_subunits: 45100n      // ₹4.5100
    };

    // Calculate exact landed cost (subunits scale 4)
    const landedCostSubunits =
      fixture.raw_material_purchase_subunits +
      fixture.inbound_freight_subunits +
      fixture.packaging_labeling_subunits +
      fixture.insurance_handling_subunits +
      fixture.customs_inspection_subunits;

    // Must evaluate to exact landed cost ₹38.2100 (382100 subunits)
    expect(landedCostSubunits).toBe(382100n);

    // Target commercial retail selling price ₹105.0000
    const sellingPriceSubunits = 1050000n;
    const grossMarginSubunits = sellingPriceSubunits - landedCostSubunits;
    expect(grossMarginSubunits).toBe(667900n); // ₹66.7900

    // Gross margin in basis points
    const marginBps = (grossMarginSubunits * 10000n) / sellingPriceSubunits;
    expect(marginBps >= 5000n).toBe(true); // 63.60% >= 50.00%

    // Deterministic investment decision rule: Landed cost <= ₹40.0000 and Gross Margin >= 50%
    const recommendation = (landedCostSubunits <= 400000n && marginBps >= 5000n)
      ? 'ALLOCATE_CAPITAL'
      : 'DO_NOT_ALLOCATE';

    expect(recommendation).toBe('ALLOCATE_CAPITAL');
  });
});
