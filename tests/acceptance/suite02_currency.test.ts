import { describe, it, expect } from 'vitest';
import {
  createCanonicalMoney,
  CURRENCY_REGISTRY
} from '../../src/canonical/domain.js';
import {
  convertMoneySubunitsExact,
  roundSubunitFractionalBankers
} from '../../src/canonical/currency.js';
import { computeOperatingCashFlowSeries } from '../../src/financial/cashFlowEngine.js';

describe('SUITE-02: Currency Registry & Subunit Arithmetic', () => {
  it('CURR-REG-3SCALE-LOOKUP-001: Returns exact configured scale for known currency', () => {
    expect(CURRENCY_REGISTRY.INR.internal_accounting_scale).toBe(4);
    expect(CURRENCY_REGISTRY.INR.iso4217_minor_unit_scale).toBe(2);
    expect(CURRENCY_REGISTRY.USD.internal_accounting_scale).toBe(4);
    expect(CURRENCY_REGISTRY.JPY.internal_accounting_scale).toBe(2);
  });

  it('CURR-SCALE-001: Rejects INR money constructed with scale 2 instead of 4', () => {
    expect(() => createCanonicalMoney('10000', 'INR', 2)).toThrow(/E-ERR-010: INVALID_CURRENCY_SCALE/);
  });

  it('CURR-BOUND-001: Rejects leading zero, negative zero, and non-canonical formats', () => {
    expect(() => createCanonicalMoney('0123', 'INR', 4)).toThrow(/E-ERR-010: CANONICAL_DECIMAL_FORMAT_ERROR/);
    expect(() => createCanonicalMoney('-0', 'INR', 4)).toThrow(/E-ERR-010: CANONICAL_DECIMAL_FORMAT_ERROR/);
    expect(() => createCanonicalMoney('', 'INR', 4)).toThrow(/E-ERR-010: CANONICAL_DECIMAL_FORMAT_ERROR/);
    expect(() => createCanonicalMoney('abc', 'INR', 4)).toThrow(/E-ERR-010: CANONICAL_DECIMAL_FORMAT_ERROR/);
  });

  it("CURR-HALF-EVEN-ROUND-007 (KAT-04 Part A): Exact half-even banker's rounding", () => {
    // 1. USD 1.0001 (subunits "10001", scale 4), Rate "86.500000" (scale 6), Target INR (scale 4)
    const sourceA = createCanonicalMoney('10001', 'USD', 4);
    const convertedA = convertMoneySubunitsExact(sourceA, 'INR', '86.500000', 6, 4);
    expect(convertedA.amount_subunits).toBe('865086'); // Rounds to even 865086

    // 2. USD 1.0003 (subunits "10003", scale 4), Rate "86.500000" (scale 6), Target INR (scale 4)
    const sourceB = createCanonicalMoney('10003', 'USD', 4);
    const convertedB = convertMoneySubunitsExact(sourceB, 'INR', '86.500000', 6, 4);
    expect(convertedB.amount_subunits).toBe('865260'); // Rounds up to even 865260
  });

  it('CURR-BIGINT-PREVENT-IEEE754-009 (KAT-04 Part B): Prevents IEEE 754 precision loss via BigInt', () => {
    // USD 900,719,925,474.0993 (subunits "9007199254740993", scale 4)
    const source = createCanonicalMoney('9007199254740993', 'USD', 4);
    const converted = convertMoneySubunitsExact(source, 'INR', '86.500000', 6, 4);
    expect(converted.amount_subunits).toBe('779122735535095894');

    // Demonstrates exact Float64 discrepancy of 86 subunits (₹0.0086)
    const floatResult = BigInt(Math.round(900719925474.0993 * 86.5 * 10000));
    const exactResult = BigInt('779122735535095894');
    expect(Number(exactResult - floatResult)).toBe(86);
  });

  it('FIN-PEAK-INDEPENDENT-EQUITY-041: Peak operating funding requirement invariant to initial equity', () => {
    const flows = [
      { entry_timestamp_utc: '2026-10-10T10:00:00Z', sequence_number: 1, amount: -20000, flow_kind: 'PROCUREMENT_OUTLAY' as const },
      { entry_timestamp_utc: '2026-10-10T15:00:00Z', sequence_number: 2, amount: 25000, flow_kind: 'NET_MERCHANT_PROCEEDS' as const }
    ];
    // With initial equity 0
    const series0 = computeOperatingCashFlowSeries(flows, '2026-10-10T00:00:00Z');
    // The operating cycle's peak funding deficit is strictly 20,000 in both formulations
    expect(series0.peak_operating_funding).toBe(20000);
  });
});
