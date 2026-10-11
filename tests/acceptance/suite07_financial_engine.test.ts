import { describe, it, expect } from 'vitest';
import {
  computeOperatingCashFlowSeries,
  computePostOutlayRecoveryMetrics,
  validateCashFlowDoubleCounting,
  CommittedCapitalManager
} from '../../src/financial/cashFlowEngine.js';
import { calculateVolumetricWeightGrams } from '../../src/canonical/product.js';

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
});
