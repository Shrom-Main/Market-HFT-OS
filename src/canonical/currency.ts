import {
  CurrencyCode,
  CanonicalMoney,
  CURRENCY_REGISTRY,
  validateIso8601UtcTimestamp,
  createCanonicalMoney
} from './domain.js';
import { canonicalizeJCS } from './jcs.js';
import { ed25519Verify } from './crypto.js';

export { CURRENCY_REGISTRY, createCanonicalMoney };

/**
 * Exact Bankers' Rounding (HALF_EVEN) for BigInt rational arithmetic
 */
export function roundSubunitFractionalBankers(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error('E-ERR-024: DIVISION_BY_ZERO');
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const doubleRemainder = absRemainder * 2n;

  if (doubleRemainder < absDenominator) {
    return quotient;
  } else if (doubleRemainder > absDenominator) {
    return remainder > 0n ? quotient + 1n : quotient - 1n;
  } else {
    // Exactly halfway: round to nearest even quotient
    const isEven = quotient % 2n === 0n;
    if (isEven) {
      return quotient;
    } else {
      return remainder > 0n ? quotient + 1n : quotient - 1n;
    }
  }
}

/**
 * Rational Point-of-Use FX Conversion (KAT-04)
 * Strict rational BigInt integer algorithm:
 * Exchange rate decimal strings (e.g. "86.500000") are parsed into exact integer numerator and rate scale.
 * Let S_src and S_tgt be the respective internal accounting scales, and Delta S = S_tgt - S_src.
 * If Delta S >= 0: Numerator = A_src * 10^(Delta S) * R_num, Denominator = 10^(S_rate)
 * If Delta S < 0:  Numerator = A_src * R_num, Denominator = 10^(-Delta S) * 10^(S_rate)
 */
export function convertMoneySubunitsExact(
  source: CanonicalMoney,
  targetCurrency: CurrencyCode,
  rateDecimal: string,
  rateScale: number,
  targetScale?: number
): CanonicalMoney {
  const targetDef = CURRENCY_REGISTRY[targetCurrency];
  if (!targetDef) {
    throw new Error(`E-ERR-010: INVALID_CURRENCY: Unsupported currency code '${targetCurrency}'`);
  }
  const effectiveTargetScale = targetScale !== undefined ? targetScale : targetDef.internal_accounting_scale;

  createCanonicalMoney(source.amount_subunits, source.currency, source.scale);
  if (typeof rateScale !== 'number' || !Number.isSafeInteger(rateScale) || rateScale < 0 || rateScale > 18) {
    throw new Error('E-ERR-024: INVALID_RATE_SCALE: Rate scale must be an integer between 0 and 18');
  }
  if (typeof rateDecimal !== 'string' || !/^\d+(\.\d+)?$/.test(rateDecimal)) {
    throw new Error('E-ERR-024: INVALID_RATE_DECIMAL_FORMAT: Rate must be a non-negative decimal string');
  }
  const parts = rateDecimal.split('.');
  const intPart = parts[0];
  const fracPart = parts[1] || '';
  if (fracPart.length > rateScale) {
    throw new Error(`E-ERR-024: RATE_SCALE_MISMATCH: Fractional part length ${fracPart.length} exceeds rateScale ${rateScale}`);
  }
  const paddedFrac = fracPart.padEnd(rateScale, '0');
  const rateNumerator = BigInt(intPart + paddedFrac);
  if (rateNumerator <= 0n) {
    throw new Error('E-ERR-024: NON_POSITIVE_FX_RATE: FX exchange rate must be strictly positive');
  }

  const sourceAmount = BigInt(source.amount_subunits);

  const deltaScale = effectiveTargetScale - source.scale;
  let numerator: bigint;
  let denominator: bigint;

  if (deltaScale >= 0) {
    numerator = sourceAmount * (10n ** BigInt(deltaScale)) * rateNumerator;
    denominator = 10n ** BigInt(rateScale);
  } else {
    numerator = sourceAmount * rateNumerator;
    denominator = (10n ** BigInt(-deltaScale)) * (10n ** BigInt(rateScale));
  }

  const targetSubunits = roundSubunitFractionalBankers(numerator, denominator);

  const min128 = -(2n ** 127n);
  const max128 = (2n ** 127n) - 1n;
  if (targetSubunits < min128 || targetSubunits > max128) {
    throw new Error('E-ERR-014: ARITHMETIC_OVERFLOW: Target subunit value exceeds signed 128-bit integer boundaries');
  }

  return {
    currency: targetCurrency,
    amount_subunits: targetSubunits.toString(),
    scale: effectiveTargetScale
  };
}

export interface FXConversionReceipt {
  receipt_id: string;
  source_currency: CurrencyCode;
  target_currency: CurrencyCode;
  quote_convention: 'UNITS_TARGET_PER_ONE_SOURCE';
  exchange_rate: string;                          // Decimal string with scale=6 (e.g. "86.500000")
  rate_publication_date: string;                  // YYYY-MM-DD
  effective_timestamp_utc: string;                // ISO-8601 UTC
  rate_source: FXRateSource;
  rounding_stage: 'STAGE1_INTERNAL_HALF_EVEN';    // Rounded to target internal accounting scale
  oracle_public_key_hex: string;                  // 64-character lowercase hex Ed25519 key
  oracle_signature: string;                       // 128-char hex Ed25519 signature over canonical receipt bytes
}

export type FXRateSource = 'RBI_OFFICIAL_REFERENCE' | 'ECB_REFERENCE' | 'FED_H10';
export type FXOracleRegistry = Readonly<Partial<Record<FXRateSource, string>>>;

// No production oracle keys are pinned in this simulation repository. Callers must
// supply a deployment-controlled registry; tests pass their fixture keys explicitly.
export const FX_ORACLE_REGISTRY: FXOracleRegistry = Object.freeze({});

export function validateFXReceiptAtPointOfUse(
  receipt: FXConversionReceipt,
  source_currency: CurrencyCode,
  target_currency: CurrencyCode,
  transaction_time_utc: string,
  oracle_registry: FXOracleRegistry = FX_ORACLE_REGISTRY
): void {
  if (receipt.source_currency !== source_currency || receipt.target_currency !== target_currency) {
    throw new Error('E-ERR-008: FX_RECEIPT_CURRENCY_MISMATCH');
  }
  if (receipt.quote_convention !== 'UNITS_TARGET_PER_ONE_SOURCE') {
    throw new Error('E-ERR-008: INVALID_FX_QUOTE_CONVENTION');
  }
  validateIso8601UtcTimestamp(receipt.effective_timestamp_utc);
  validateIso8601UtcTimestamp(transaction_time_utc);
  const tx_ms = Date.parse(transaction_time_utc);
  const fx_ms = Date.parse(receipt.effective_timestamp_utc);
  if (Math.abs(tx_ms - fx_ms) > 86400000) {
    throw new Error('E-ERR-008: FX_RECEIPT_STALE: Receipt effective date deviates by more than 24 hours from transaction time');
  }
  const trusted_oracle_key = oracle_registry[receipt.rate_source];
  if (!trusted_oracle_key || !/^[0-9a-f]{64}$/.test(trusted_oracle_key) ||
      receipt.oracle_public_key_hex !== trusted_oracle_key) {
    throw new Error('E-ERR-008: UNTRUSTED_FX_ORACLE_KEY');
  }
  const { oracle_signature, ...unsigned_receipt } = receipt;
  const unsigned_bytes = Buffer.from(canonicalizeJCS(unsigned_receipt), 'utf8');
  if (!ed25519Verify(unsigned_bytes, trusted_oracle_key, oracle_signature)) {
    throw new Error('E-ERR-008: FX_RECEIPT_SIGNATURE_INVALID');
  }
}

/**
 * Safe canonical money addition. Prohibits cross-currency summation fail-closed.
 */
export function addCanonicalMoney(a: CanonicalMoney, b: CanonicalMoney): CanonicalMoney {
  createCanonicalMoney(a.amount_subunits, a.currency, a.scale);
  createCanonicalMoney(b.amount_subunits, b.currency, b.scale);
  if (a.currency !== b.currency) {
    throw new Error('E-ERR-008: CROSS_CURRENCY_SUMMATION_ILLEGAL: Cannot sum monetary amounts of different currencies directly');
  }
  if (a.scale !== b.scale) {
    throw new Error('E-ERR-010: SCALE_MISMATCH: Cannot sum monetary amounts with differing scales');
  }
  const sum = BigInt(a.amount_subunits) + BigInt(b.amount_subunits);
  return {
    currency: a.currency,
    amount_subunits: sum.toString(),
    scale: a.scale
  };
}
