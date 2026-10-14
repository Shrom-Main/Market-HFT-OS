import { describe, it, expect } from 'vitest';
import { createCanonicalMoney } from '../../src/canonical/domain.js';
import {
  convertMoneySubunitsExact,
  validateFXReceiptAtPointOfUse,
  addCanonicalMoney,
  FXConversionReceipt,
  FXOracleRegistry
} from '../../src/canonical/currency.js';
import { ed25519Sign, sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';

describe('SUITE-11: Cross-Currency FX Conversions & Summation Prohibition', () => {
  it('CURR-CROSS-002 / FIN-CROSS-UNRECEIPTED-002: Direct addition of differing currencies is prohibited', () => {
    const inr = createCanonicalMoney('1000000', 'INR', 4);
    const usd = createCanonicalMoney('50000', 'USD', 4);

    expect(() => addCanonicalMoney(inr, usd)).toThrow(/E-ERR-008: CROSS_CURRENCY_SUMMATION_ILLEGAL/);

    const inr2 = createCanonicalMoney('500000', 'INR', 4);
    const summed = addCanonicalMoney(inr, inr2);
    expect(summed.amount_subunits).toBe('1500000');
    expect(summed.currency).toBe('INR');
  });

  it('FX-RECEIPT-VALID-001: Point-of-use FX receipt validation with signed oracle', () => {
    const crypto = require('node:crypto');
    const oracleSeed = '101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f';
    const privKey = crypto.createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(oracleSeed, 'hex')]),
      format: 'der',
      type: 'pkcs8'
    });
    const pubDer = crypto.createPublicKey(privKey).export({ format: 'der', type: 'spki' });
    const oraclePubHex = pubDer.subarray(12).toString('hex');

    const unsignedReceipt = {
      receipt_id: 'fx:usd-inr:2026-10-10',
      source_currency: 'USD' as const,
      target_currency: 'INR' as const,
      quote_convention: 'UNITS_TARGET_PER_ONE_SOURCE' as const,
      exchange_rate: '86.500000',
      rate_publication_date: '2026-10-10',
      effective_timestamp_utc: '2026-10-10T12:00:00Z',
      rate_source: 'RBI_OFFICIAL_REFERENCE' as const,
      rounding_stage: 'STAGE1_INTERNAL_HALF_EVEN' as const,
      oracle_public_key_hex: oraclePubHex
    };

    const unsignedBytes = Buffer.from(canonicalizeJCS(unsignedReceipt), 'utf8');
    const signature = ed25519Sign(unsignedBytes, oracleSeed);

    const validReceipt: FXConversionReceipt = {
      ...unsignedReceipt,
      oracle_signature: signature
    };
    const testOracleRegistry: FXOracleRegistry = {
      RBI_OFFICIAL_REFERENCE: oraclePubHex
    };

    // Valid within 24h
    expect(() => validateFXReceiptAtPointOfUse(
      validReceipt,
      'USD',
      'INR',
      '2026-10-10T14:00:00Z',
      testOracleRegistry
    )).not.toThrow();

    // Mismatched target currency throws E-ERR-008
    expect(() => validateFXReceiptAtPointOfUse(
      validReceipt,
      'USD',
      'EUR' as any,
      '2026-10-10T14:00:00Z',
      testOracleRegistry
    )).toThrow(/E-ERR-008: FX_RECEIPT_CURRENCY_MISMATCH/);
  });
});
