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

  it('PROD-NORM-001: normalizeProductIdentityCore normalizes HSN, units, and preserves MPN casing', () => {
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

  it('PROD-NORM-002: normalizeProductIdentityCore rejects control characters and duplicate dimension keys', () => {
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

  it('PROD-CANON-003: generateCanonicalProductId generates deterministic prod: SHA-256', () => {
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

  it('INV-QTY-001: validateInventoryQuantity checks non-negative safe integer within 10^9', () => {
    expect(() => validateInventoryQuantity(500)).not.toThrow();
    expect(() => validateInventoryQuantity(0)).not.toThrow();
    expect(() => validateInventoryQuantity(-1)).toThrow(/E-ERR-034: INVALID_INVENTORY_QUANTITY/);
    expect(() => validateInventoryQuantity(1.5)).toThrow(/E-ERR-034: INVALID_INVENTORY_QUANTITY/);
    expect(() => validateInventoryQuantity(1000000001)).toThrow(/E-ERR-034: INVALID_INVENTORY_QUANTITY/);
  });

  it('FIN-METRIC-001: computeRoPF, computeCoC, and computeHPR evaluate correctly', () => {
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

  it('FIN-TWO-TIER-001: TwoTierGrossClearingLedger tracks clearing vs bank balances', () => {
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
});
