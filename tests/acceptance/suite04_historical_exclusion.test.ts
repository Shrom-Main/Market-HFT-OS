import { describe, it, expect } from 'vitest';
import {
  CanonicalOffer,
  createCanonicalMoney
} from '../../src/canonical/domain.js';
import { validateEvidenceAllowlistEligibility } from '../../src/canonical/allowlist.js';
import {
  registerStreamEvidence
} from '../../src/verification/claims.js';
import { reconcileOfferClaims } from '../../src/verification/gate.js';
import { sha256 } from '../../src/canonical/crypto.js';

describe('SUITE-04: Historical Evidence Exclusion & Epistemic Boundaries', () => {
  const offer: CanonicalOffer = {
    offer_id: 'off:din3017:sup-01:2026-q4',
    product_id: 'prod:din3017:16-25mm',
    unit_price: createCanonicalMoney('105000', 'INR', 4),
    minimum_order_quantity: 10,
    payment_terms_days: 30,
    incoterms: 'EXW',
    valid_until_utc: '2026-12-31T00:00:00Z',
    offer_status: 'INDICATIVE_QUOTE',
    verification_status: 'UNVERIFIED'
  };

  it('HIST-EXCL-OFFER-PROMOTE-001 / PROMO-HISTORICAL-ERR-005: Historical backfilled evidence throws E-ERR-032 fail-closed', () => {
    const historicalEvId = 'ev:hist:import-001';
    const evSha = sha256('historical-doc');

    const historicalEvidence = {
      evidence_id: historicalEvId,
      event_sha256: evSha,
      provenance: {
        observed_at_utc: '2026-10-10T12:00:00Z',
        is_historical_import: true // Marked as historical import!
      }
    };

    const mockAssessment: any = {
      claim_source_authenticity: {
        claim_type: 'SOURCE_AUTHENTICITY',
        claim_parameters: { verification_mechanism: 'BUSINESS_REGISTRY_GSTIN_LOOKUP' },
        attestation: { evidence_id: historicalEvId }
      },
      claim_price_confirmation: {
        claim_type: 'PRICE_CONFIRMATION',
        claim_parameters: { confirmed_unit_price: offer.unit_price, price_evidence_kind: 'PROFORMA_INVOICE' },
        attestation: { evidence_id: historicalEvId }
      },
      claim_stock_availability: {
        claim_type: 'STOCK_AVAILABILITY',
        claim_parameters: { confirmed_quantity_available: 100 },
        attestation: { evidence_id: historicalEvId }
      },
      claim_commercial_terms: {
        claim_type: 'COMMERCIAL_TERMS',
        claim_parameters: {
          incoterms: 'EXW',
          minimum_order_quantity: 10,
          payment_terms_days: 30,
          valid_until_utc: '2026-12-31T00:00:00Z'
        },
        attestation: { evidence_id: historicalEvId }
      }
    };

    expect(() => reconcileOfferClaims(
      offer,
      mockAssessment,
      { [historicalEvId]: historicalEvidence },
      '2026-10-10T12:00:00Z'
    )).toThrow(/E-ERR-032: HISTORICAL_EVIDENCE_NOT_EXECUTABLE/);
  });

  it('EPISTEMIC-OBSERVED-STRICT-006 / ALLOW-FAIL-001: Disallowed allowlist tuples fail-closed with E-ERR-001', () => {
    // Attempt unlisted tuple (SYNTHETIC_TEST, VERIFIED, INDICATIVE_QUOTE)
    expect(() => validateEvidenceAllowlistEligibility(
      'SYNTHETIC_TEST',
      'VERIFIED',
      'INDICATIVE_QUOTE',
      'PRICE_CONFIRMATION',
      'PROFORMA_INVOICE'
    )).toThrow(/E-ERR-001: FAIL_CLOSED_DISALLOWED_TUPLE/);
  });
});
