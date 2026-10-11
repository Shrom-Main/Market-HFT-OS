/**
 * Canonical Domain Types for POC-001 Market HFT OS
 * Frozen under Gate M1 Specification v1.13 Final (Commit 77eff71)
 */

export type CommercialOfferStatus =
  | 'INDICATIVE_QUOTE'
  | 'VERIFIED_EXECUTABLE_OFFER'
  | 'COMMITTED_PROCUREMENT'
  | 'REJECTED_OFFER'
  | 'EXPIRED_OFFER'
  | 'NOT_APPLICABLE';

export type VerificationStatus =
  | 'UNVERIFIED'
  | 'PARTIALLY_VERIFIED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'STALE'
  | 'UNKNOWN';

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'SGD' | 'AED';

export interface CurrencyDefinition {
  code: CurrencyCode;
  name: string;
  iso4217_minor_unit_scale: number;
  internal_accounting_scale: number;
  settlement_scale: number;
  rounding_mode: 'HALF_EVEN';
}

export const CURRENCY_REGISTRY: Record<CurrencyCode, CurrencyDefinition> = {
  INR: { code: 'INR', name: 'Indian Rupee',     iso4217_minor_unit_scale: 2, internal_accounting_scale: 4, settlement_scale: 2, rounding_mode: 'HALF_EVEN' },
  USD: { code: 'USD', name: 'US Dollar',        iso4217_minor_unit_scale: 2, internal_accounting_scale: 4, settlement_scale: 2, rounding_mode: 'HALF_EVEN' },
  EUR: { code: 'EUR', name: 'Euro',             iso4217_minor_unit_scale: 2, internal_accounting_scale: 4, settlement_scale: 2, rounding_mode: 'HALF_EVEN' },
  GBP: { code: 'GBP', name: 'British Pound',    iso4217_minor_unit_scale: 2, internal_accounting_scale: 4, settlement_scale: 2, rounding_mode: 'HALF_EVEN' },
  JPY: { code: 'JPY', name: 'Japanese Yen',     iso4217_minor_unit_scale: 0, internal_accounting_scale: 2, settlement_scale: 0, rounding_mode: 'HALF_EVEN' },
  SGD: { code: 'SGD', name: 'Singapore Dollar', iso4217_minor_unit_scale: 2, internal_accounting_scale: 4, settlement_scale: 2, rounding_mode: 'HALF_EVEN' },
  AED: { code: 'AED', name: 'UAE Dirham',       iso4217_minor_unit_scale: 2, internal_accounting_scale: 4, settlement_scale: 2, rounding_mode: 'HALF_EVEN' }
};

export interface CanonicalMoney {
  amount_subunits: string;
  scale: number;
  currency: CurrencyCode;
}

export function createCanonicalMoney(amount_subunits: string, currency: CurrencyCode, scale: number): CanonicalMoney {
  const def = CURRENCY_REGISTRY[currency];
  if (!def) {
    throw new Error(`E-ERR-010: INVALID_CURRENCY: Unsupported currency code '${currency}'`);
  }
  if (scale !== def.internal_accounting_scale) {
    throw new Error(`E-ERR-010: INVALID_CURRENCY_SCALE: Scale ${scale} does not match internal accounting scale ${def.internal_accounting_scale} for ${currency}`);
  }
  if (!/^(0|-?[1-9][0-9]*)$/.test(amount_subunits)) {
    throw new Error(`E-ERR-010: CANONICAL_DECIMAL_FORMAT_ERROR: Subunits '${amount_subunits}' is not a valid non-empty canonical integer string`);
  }
  const val = BigInt(amount_subunits);
  const min128 = -(2n ** 127n);
  const max128 = (2n ** 127n) - 1n;
  if (val < min128 || val > max128) {
    throw new Error('E-ERR-014: ARITHMETIC_OVERFLOW: Subunit value exceeds signed 128-bit integer boundaries');
  }
  return { amount_subunits, scale, currency };
}

export type CanonicalStreamSequence = string & { readonly __brand?: unique symbol };

export function parseCanonicalStreamSequence(raw: string): CanonicalStreamSequence {
  if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`E-ERR-024: INVALID_SEQUENCE_FORMAT: Sequence must be a non-negative decimal string without leading zeros, got '${raw}'`);
  }
  const val = BigInt(raw);
  const maxUint64 = 18446744073709551615n;
  if (val > maxUint64) {
    throw new Error('E-ERR-014: ARITHMETIC_OVERFLOW: Sequence exceeds uint64 maximum boundary');
  }
  return raw as CanonicalStreamSequence;
}

export function validateIso8601UtcTimestamp(ts: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(ts);
  if (!match) {
    throw new Error(`E-ERR-025: MALFORMED_TIMESTAMP: Non-canonical UTC ISO-8601 string: '${ts}'`);
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);

  if (year < 2000 || year > 2099) throw new Error(`E-ERR-025: MALFORMED_TIMESTAMP: Year out of bounds: ${year}`);
  if (month < 1 || month > 12) throw new Error(`E-ERR-025: MALFORMED_TIMESTAMP: Invalid month ${month}`);
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`E-ERR-025: MALFORMED_TIMESTAMP: Invalid time ${hour}:${minute}:${second}`);

  const isLeap = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) {
    throw new Error(`E-ERR-025: MALFORMED_TIMESTAMP: Invalid calendar day ${day} for month ${month}/${year}`);
  }
}

export interface CanonicalOffer {
  offer_id: string;
  product_id: string;
  vendor_id?: string;
  supplier_id?: string;
  unit_price: CanonicalMoney;
  minimum_order_quantity: number;
  available_quantity?: number;
  payment_terms_days: number;
  incoterms: string;
  valid_until_utc: string;
  offer_status: CommercialOfferStatus;
  verification_status: VerificationStatus;
}

export interface OfferPromotionEventPayload {
  offer_id: string;
  expected_stream_sequence: CanonicalStreamSequence;
  resulting_stream_sequence: CanonicalStreamSequence;
  assessment_id: string;
  assessment_sha256: string;
  claims_evidence_summary: Record<string, unknown>;
  policy_version: string;
  evaluator_version: string;
  target_offer_status: CommercialOfferStatus;
  target_verification_status: VerificationStatus;
  rejection_reason?: string;
  consumed_nonces: string[];
  decision_timestamp_utc: string;
}
