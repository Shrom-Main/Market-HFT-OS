import { describe, it, expect } from 'vitest';
import {
  CanonicalOffer,
  createCanonicalMoney
} from '../../src/canonical/domain.js';
import { reconcileOfferClaims } from '../../src/verification/gate.js';
import { sha256 } from '../../src/canonical/crypto.js';

describe('SUITE-06: Commercial Term Reconciliation', () => {
  const baseOffer: CanonicalOffer = {
    offer_id: 'off:din3017:sup-01:2026-q4',
    product_id: 'prod:din3017:16-25mm',
    unit_price: createCanonicalMoney('1100000', 'INR', 4), // ₹110.0000
    minimum_order_quantity: 10,
    payment_terms_days: 60,
    incoterms: 'FOB',
    valid_until_utc: '2026-12-31T00:00:00Z',
    offer_status: 'INDICATIVE_QUOTE',
    verification_status: 'UNVERIFIED'
  };

  const nowUtc = '2026-10-10T12:00:00Z';

  function mockResolvedEvidence(id: string) {
    return {
      [id]: {
        evidence_id: id,
        event_sha256: sha256(id),
        provenance: {
          observed_at_utc: nowUtc,
          is_authenticated_source_feed: true
        }
      }
    };
  }

  it('PROMO-MISMATCH-PRICE-006: Throws E-ERR-028 on unit price mismatch', () => {
    const assessment: any = {
      claim_source_authenticity: { attestation: { evidence_id: 'ev1' } },
      claim_price_confirmation: {
        claim_parameters: { confirmed_unit_price: createCanonicalMoney('1050000', 'INR', 4) }, // ₹105 vs ₹110
        attestation: { evidence_id: 'ev1' }
      },
      claim_stock_availability: {
        claim_parameters: { confirmed_quantity_available: 50 },
        attestation: { evidence_id: 'ev1' }
      },
      claim_commercial_terms: {
        claim_parameters: {
          minimum_order_quantity: 10,
          payment_terms_days: 60,
          incoterms: 'FOB',
          valid_until_utc: '2026-12-31T00:00:00Z'
        },
        attestation: { evidence_id: 'ev1' }
      }
    };

    expect(() => reconcileOfferClaims(baseOffer, assessment, mockResolvedEvidence('ev1'), nowUtc))
      .toThrow(/E-ERR-028: OFFER_PRICE_CLAIM_MISMATCH/);
  });

  it('PROMO-MISMATCH-MOQ-007: Throws E-ERR-029 on MOQ mismatch', () => {
    const assessment: any = {
      claim_source_authenticity: { attestation: { evidence_id: 'ev1' } },
      claim_price_confirmation: {
        claim_parameters: { confirmed_unit_price: baseOffer.unit_price },
        attestation: { evidence_id: 'ev1' }
      },
      claim_stock_availability: {
        claim_parameters: { confirmed_quantity_available: 50 },
        attestation: { evidence_id: 'ev1' }
      },
      claim_commercial_terms: {
        claim_parameters: {
          minimum_order_quantity: 100, // 100 vs 10
          payment_terms_days: 60,
          incoterms: 'FOB',
          valid_until_utc: '2026-12-31T00:00:00Z'
        },
        attestation: { evidence_id: 'ev1' }
      }
    };

    expect(() => reconcileOfferClaims(baseOffer, assessment, mockResolvedEvidence('ev1'), nowUtc))
      .toThrow(/E-ERR-029: OFFER_MOQ_CLAIM_MISMATCH/);
  });

  it('PROMO-MISMATCH-PAY-008: Throws E-ERR-030 on payment terms mismatch', () => {
    const assessment: any = {
      claim_source_authenticity: { attestation: { evidence_id: 'ev1' } },
      claim_price_confirmation: {
        claim_parameters: { confirmed_unit_price: baseOffer.unit_price },
        attestation: { evidence_id: 'ev1' }
      },
      claim_stock_availability: {
        claim_parameters: { confirmed_quantity_available: 50 },
        attestation: { evidence_id: 'ev1' }
      },
      claim_commercial_terms: {
        claim_parameters: {
          minimum_order_quantity: 10,
          payment_terms_days: 30, // 30 vs 60
          incoterms: 'FOB',
          valid_until_utc: '2026-12-31T00:00:00Z'
        },
        attestation: { evidence_id: 'ev1' }
      }
    };

    expect(() => reconcileOfferClaims(baseOffer, assessment, mockResolvedEvidence('ev1'), nowUtc))
      .toThrow(/E-ERR-030: OFFER_PAYMENT_TERMS_MISMATCH/);
  });

  it('PROMO-MISMATCH-INCO-009: Throws E-ERR-031 on Incoterms mismatch', () => {
    const assessment: any = {
      claim_source_authenticity: { attestation: { evidence_id: 'ev1' } },
      claim_price_confirmation: {
        claim_parameters: { confirmed_unit_price: baseOffer.unit_price },
        attestation: { evidence_id: 'ev1' }
      },
      claim_stock_availability: {
        claim_parameters: { confirmed_quantity_available: 50 },
        attestation: { evidence_id: 'ev1' }
      },
      claim_commercial_terms: {
        claim_parameters: {
          minimum_order_quantity: 10,
          payment_terms_days: 60,
          incoterms: 'EXW', // EXW vs FOB
          valid_until_utc: '2026-12-31T00:00:00Z'
        },
        attestation: { evidence_id: 'ev1' }
      }
    };

    expect(() => reconcileOfferClaims(baseOffer, assessment, mockResolvedEvidence('ev1'), nowUtc))
      .toThrow(/E-ERR-031: OFFER_INCOTERMS_MISMATCH/);
  });
});
