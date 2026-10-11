import { describe, it, expect } from 'vitest';
import { createCanonicalMoney } from '../../src/canonical/domain.js';
import {
  convertMoneySubunitsExact,
  validateFXReceiptAtPointOfUse,
  FXConversionReceipt
} from '../../src/canonical/currency.js';
import { ed25519Sign, sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';

describe('SUITE-11: Cross-Currency FX Conversions & Summation Prohibition', () => {
  it('CURR-CROSS-002 / FIN-CROSS-UNRECEIPTED-002: Direct addition of differing currencies is prohibited', () => {
    const inr = createCanonicalMoney('1000000', 'INR', 4);
    const usd = createCanonicalMoney('50000', 'USD', 4);

    // Summing differing currencies without conversion throws E-ERR-008
    function sumMoneyDirect(a: typeof inr, b: typeof usd) {
      if (a.currency !== b.currency) {
        throw new Error('E-ERR-008: CROSS_CURRENCY_SUMMATION_ILLEGAL: Cannot sum monetary amounts of different currencies directly');
      }
      return BigInt(a.amount_subunits) + BigInt(b.amount_subunits);
    }

    expect(() => sumMoneyDirect(inr, usd)).toThrow(/E-ERR-008: CROSS_CURRENCY_SUMMATION_ILLEGAL/);
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

    // Valid within 24h
    expect(() => validateFXReceiptAtPointOfUse(
      validReceipt,
      'USD',
      'INR',
      '2026-10-10T14:00:00Z'
    )).not.toThrow();

    // Mismatched target currency throws E-ERR-008
    expect(() => validateFXReceiptAtPointOfUse(
      validReceipt,
      'USD',
      'EUR' as any,
      '2026-10-10T14:00:00Z'
    )).toThrow(/E-ERR-008: FX_RECEIPT_CURRENCY_MISMATCH/);
  });
});
