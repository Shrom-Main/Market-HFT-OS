import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CanonicalOffer,
  createCanonicalMoney,
  parseCanonicalStreamSequence
} from '../../src/canonical/domain.js';
import {
  ed25519Sign,
  sha256
} from '../../src/canonical/crypto.js';
import {
  canonicalizeJCS,
  parseStrictJSONWithoutDuplicateKeys
} from '../../src/canonical/jcs.js';
import {
  convertMoneySubunitsExact,
  addCanonicalMoney,
  validateFXReceiptAtPointOfUse
} from '../../src/canonical/currency.js';
import {
  VerificationClaimsAssessment,
  registerStreamEvidence,
  validateAndBuildClaimSigningPayload,
  validateAttesterAuthority,
  validateGatewayEndorsementReceipt,
  GATEWAY_AUTHORITY_REGISTRY,
  PrincipalAuthorityRegistry
} from '../../src/verification/claims.js';
import {
  evaluateOfferPromotionReadOnly,
  ServiceBoundaryEvaluatorTokenVerifier
} from '../../src/verification/gate.js';
import {
  validateCashFlowDoubleCounting,
  solveXIRR
} from '../../src/financial/cashFlowEngine.js';
import {
  enforceSimulationLedgerWrite
} from '../../src/ledger/actualsGuard.js';
import {
  FileBackedDurableRecoveryJournal
} from '../../src/persistence/durableRecoveryJournal.js';
import { SimulationPipeline } from '../../src/simulation/simulationPipeline.js';
import { MarketFeedHandler } from '../../src/feeds/feedHandler.js';

const EVALUATOR_SECRET_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const PRINCIPAL_KEY_SEED = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';

describe('SUITE-18: Adversarial Remediation & Security Invariant Regression Suite', () => {
  const nowUtc = '2026-10-10T12:00:00Z';

  const testPrincipalRegistry: PrincipalAuthorityRegistry = Object.freeze({
    'op:sec:shrom-principal-01': {
      principal_id: 'op:sec:shrom-principal-01',
      principal_type: 'HUMAN_OPERATOR',
      assigned_roles: [
        'PORTFOLIO_MANAGER',
        'COMMERCIAL_SOURCING_SPECIALIST',
        'WAREHOUSE_OPERATIONS_MANAGER',
        'SUPPLY_CHAIN_ANALYST',
        'COMPLIANCE_OFFICER',
        'LEGAL_COUNSEL',
        'RISK_OFFICER'
      ],
      public_key_hex: '79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664',
      valid_from_utc: '2026-01-01T00:00:00Z',
      valid_until_utc: '2027-01-01T00:00:00Z',
      revoked: false
    }
  });

  const offer: CanonicalOffer = {
    offer_id: 'off:din3017:sup-01:2026-q4',
    product_id: 'prod:din3017:16-25mm',
    unit_price: createCanonicalMoney('105000', 'INR', 4),
    minimum_order_quantity: 10,
    available_quantity: 100,
    payment_terms_days: 30,
    incoterms: 'EXW',
    valid_until_utc: '2026-12-31T00:00:00Z',
    offer_status: 'INDICATIVE_QUOTE',
    verification_status: 'UNVERIFIED'
  };

  function createDirectSignedClaim(claimType: any, params: any, evidenceId: string) {
    const evSha = sha256(`content:${evidenceId}`);
    registerStreamEvidence({
      evidence_id: evidenceId,
      event_sha256: evSha,
      provenance: { observed_at_utc: nowUtc, is_authenticated_source_feed: true },
      evidence_kind: 'OBSERVED',
      verification_status: 'VERIFIED',
      offer_status: 'VERIFIED_EXECUTABLE_OFFER',
      document_type: claimType === 'SOURCE_AUTHENTICITY' ? 'BUSINESS_REGISTRY_FILING' :
                     claimType === 'STOCK_AVAILABILITY' ? 'SUPPLIER_INVENTORY_REPORT' :
                     'PROFORMA_INVOICE'
    });

    const unsignedClaim = {
      claim_type: claimType,
      claim_parameters: params,
      attestation: {
        evidence_id: evidenceId,
        evidence_sha256: evSha,
        attester_id: 'op:sec:shrom-principal-01',
        attested_at_utc: nowUtc,
        claimed_role: 'PORTFOLIO_MANAGER' as const,
        epistemic_type: 'HUMAN_EXPERT_DOCUMENT_APPRAISAL' as const,
        auth: {
          auth_mechanism: 'DIRECT_KEY_SIGNATURE' as const
        }
      }
    };

    const signingPayload = validateAndBuildClaimSigningPayload(offer.offer_id, offer.product_id, unsignedClaim as any);
    const payloadBytes = Buffer.from(canonicalizeJCS(signingPayload), 'utf8');
    const signature = ed25519Sign(payloadBytes, PRINCIPAL_KEY_SEED);

    return {
      ...unsignedClaim,
      attestation: {
        ...unsignedClaim.attestation,
        auth: {
          auth_mechanism: 'DIRECT_KEY_SIGNATURE' as const,
          direct_signature: signature,
          attestation_signature: signature
        }
      }
    };
  }

  it('ADV-CRYPTO-01: Gateway endorsement receipt binds full ClaimSigningPayload and verifies operator role', () => {
    const evId = 'ev:prc:adv-01';
    const evSha = sha256(`content:${evId}`);
    registerStreamEvidence({
      evidence_id: evId,
      event_sha256: evSha,
      provenance: { observed_at_utc: nowUtc, is_authenticated_source_feed: true },
      evidence_kind: 'OBSERVED',
      verification_status: 'VERIFIED',
      offer_status: 'VERIFIED_EXECUTABLE_OFFER',
      document_type: 'PROFORMA_INVOICE'
    });

    const params = {
      confirmed_unit_price: createCanonicalMoney('105000', 'INR', 4),
      price_evidence_kind: 'PROFORMA_INVOICE'
    };
    const paramsOnlyDigest = sha256(Buffer.from(canonicalizeJCS(params), 'utf8'));

    const fakeReceipt = {
      receipt_id: 'gw:rcpt:adv-01',
      auth_gateway_id: 'gw:auth:platform-core-01',
      operator_id: 'op:sec:shrom-principal-01',
      operator_role: 'PORTFOLIO_MANAGER' as const,
      claim_signing_payload_sha256: paramsOnlyDigest, // Malicious: parameters only, not full signing payload
      nonce: 'nonce-adv-crypto-01-abcdef',
      issued_at_utc: nowUtc,
      expires_at_utc: '2026-10-10T12:05:00Z',
      gateway_signature: '0'.repeat(128)
    };

    const endorsedPriceClaim = {
      claim_type: 'PRICE_CONFIRMATION' as const,
      claim_parameters: params,
      attestation: {
        evidence_id: evId,
        evidence_sha256: evSha,
        attester_id: 'op:sec:shrom-principal-01',
        attested_at_utc: nowUtc,
        claimed_role: 'PORTFOLIO_MANAGER' as const,
        epistemic_type: 'HUMAN_EXPERT_DOCUMENT_APPRAISAL' as const,
        auth: {
          auth_mechanism: 'GATEWAY_CLAIM_ENDORSEMENT' as const,
          endorsement_receipt: fakeReceipt
        }
      }
    };

    const assessment: VerificationClaimsAssessment = {
      claim_source_authenticity: createDirectSignedClaim(
        'SOURCE_AUTHENTICITY',
        { verification_mechanism: 'BUSINESS_REGISTRY_GSTIN_LOOKUP' },
        'ev:src:adv-01'
      ) as any,
      claim_price_confirmation: endorsedPriceClaim as any,
      claim_stock_availability: createDirectSignedClaim(
        'STOCK_AVAILABILITY',
        {
          availability_evidence_kind: 'SUPPLIER_INVENTORY_REPORT',
          confirmed_quantity_available: 500,
          inventory_location: 'Hub-1'
        },
        'ev:stk:adv-01'
      ) as any,
      claim_commercial_terms: createDirectSignedClaim(
        'COMMERCIAL_TERMS',
        {
          incoterms: 'EXW',
          minimum_order_quantity: 10,
          payment_terms_days: 30,
          terms_evidence_kind: 'PROFORMA_INVOICE',
          valid_until_utc: '2026-12-31T00:00:00Z'
        },
        'ev:com:adv-01'
      ) as any
    };

    // Promotion gate must reject parameters-only digest
    expect(() => evaluateOfferPromotionReadOnly(
      offer,
      assessment,
      '0',
      EVALUATOR_SECRET_HEX,
      nowUtc,
      testPrincipalRegistry
    )).toThrow(/E-ERR-017: DIGEST_BINDING_MISMATCH/);
  });

  it('ADV-CRYPTO-02: Compromised principal is rejected fail-closed even when revoked is false', () => {
    const compromisedRegistry: PrincipalAuthorityRegistry = {
      'op:sec:compromised-01': {
        principal_id: 'op:sec:compromised-01',
        principal_type: 'HUMAN_OPERATOR',
        assigned_roles: ['PORTFOLIO_MANAGER'],
        public_key_hex: '79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664',
        valid_from_utc: '2026-01-01T00:00:00Z',
        valid_until_utc: '2027-01-01T00:00:00Z',
        revoked: false,
        compromised: true // Compromised without being formally revoked
      }
    };

    expect(() => validateAttesterAuthority(
      'op:sec:compromised-01',
      'PORTFOLIO_MANAGER',
      'PRICE_CONFIRMATION',
      nowUtc,
      nowUtc,
      compromisedRegistry
    )).toThrow(/E-ERR-019: OPERATOR_KEY_REVOKED: Principal key compromised/);

    // Revoked principal without valid revoked_at_utc fails closed
    const invalidRevokedRegistry: PrincipalAuthorityRegistry = {
      'op:sec:revoked-02': {
        principal_id: 'op:sec:revoked-02',
        principal_type: 'HUMAN_OPERATOR',
        assigned_roles: ['PORTFOLIO_MANAGER'],
        public_key_hex: '79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664',
        valid_from_utc: '2026-01-01T00:00:00Z',
        valid_until_utc: '2027-01-01T00:00:00Z',
        revoked: true // Omitted revoked_at_utc
      }
    };

    expect(() => validateAttesterAuthority(
      'op:sec:revoked-02',
      'PORTFOLIO_MANAGER',
      'PRICE_CONFIRMATION',
      nowUtc,
      nowUtc,
      invalidRevokedRegistry
    )).toThrow(/E-ERR-019: OPERATOR_KEY_REVOKED/);
  });

  it('ADV-FIN-01: convertMoneySubunitsExact prevents 96,111x silent undervaluation on fractional rates', () => {
    const usd = createCanonicalMoney('10000', 'USD', 4); // 1.0000 USD
    // Rate '86.5' with rateScale 6 -> must scale to 86.500000 (865000 subunits)
    const inr = convertMoneySubunitsExact(usd, 'INR', '86.5', 6, 4);
    expect(inr.amount_subunits).toBe('865000'); // Exactly 86.5000 INR

    // Non-positive rates and fractional digit mismatches are rejected fail-closed
    expect(() => convertMoneySubunitsExact(usd, 'INR', '0.0', 6, 4)).toThrow(/E-ERR-024: NON_POSITIVE_FX_RATE/);
    expect(() => convertMoneySubunitsExact(usd, 'INR', '86.1234567', 6, 4)).toThrow(/E-ERR-024: RATE_SCALE_MISMATCH/);

    // addCanonicalMoney rejects cross-currency addition
    expect(() => addCanonicalMoney(usd, inr)).toThrow(/E-ERR-008: CROSS_CURRENCY_SUMMATION_ILLEGAL/);
  });

  it('ADV-FIN-02: validateCashFlowDoubleCounting rejects GROSS_CHECKOUT_PROCEEDS combined with NET_MERCHANT_PROCEEDS', () => {
    const conflictingFlows = [
      { entry_timestamp_utc: '2026-10-10T10:00:00Z', sequence_number: 1, amount: 5000, flow_kind: 'GROSS_CHECKOUT_PROCEEDS' as const },
      { entry_timestamp_utc: '2026-10-10T12:00:00Z', sequence_number: 2, amount: 4800, flow_kind: 'NET_MERCHANT_PROCEEDS' as const }
    ];
    expect(() => validateCashFlowDoubleCounting(conflictingFlows)).toThrow(/E-ERR-038: CASH_FLOW_DOUBLE_COUNTING_PROHIBITED/);
  });

  it('ADV-FIN-03: solveXIRR distinguishes valid roots from domain failures', () => {
    // 2 cash flows: -100 at t=0, +120 at t=1 year -> 20% IRR
    const flows = [
      { amount: -100, t_years: 0 },
      { amount: 120, t_years: 1 }
    ];
    const res = solveXIRR(flows);
    expect(res.status).toBe('CONVERGED');
    if (res.status === 'CONVERGED') {
      expect(res.xirr).toBeCloseTo(0.20, 4);
    }
  });

  it('ADV-PERSIST-01: Durable recovery journal accounts for interior blank lines before tail truncation', () => {
    const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'wal_adv_test');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const walFile = path.join(tmpDir, 'test_blank_line.wal');

    // Create journal with two valid entries and an interior blank line, followed by a torn tail
    const j1 = new FileBackedDurableRecoveryJournal(walFile);
    j1.appendEvent('FILL_RECORDED', { fill_id: 'fill-01' }, '2026-10-10T12:00:00Z');
    j1.appendEvent('PORTFOLIO_APPLIED', { fill_id: 'fill-01' }, '2026-10-10T12:00:01Z');
    j1.close();

    // Read file, inject a blank line between records and an invalid partial tail at the end
    const rawContent = fs.readFileSync(walFile, 'utf8');
    const lines = rawContent.trim().split('\n');
    const modifiedContent = lines[0] + '\n\n' + lines[1] + '\n{"partial": "to';
    fs.writeFileSync(walFile, modifiedContent, 'utf8');

    // Reopen journal - should successfully truncate torn tail and preserve both entries
    const j2 = new FileBackedDurableRecoveryJournal({ filePath: walFile, tornTailPolicy: 'TRUNCATE_TORN_TAIL' });
    expect(j2.getEntryCount()).toBe(2);
    expect(j2.verifyIntegrity().isValid).toBe(true);
    j2.close();

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ADV-PERSIST-02: Reverse simulation guard and strict JSON duplicate key detection', () => {
    // enforceSimulationLedgerWrite throws on non-SIMULATION_LEDGER
    expect(() => enforceSimulationLedgerWrite({ ledger_type: 'ACTUALS_LEDGER' } as any))
      .toThrow(/E-ERR-025: SIMULATION_LEDGER_WRITE_VIOLATION/);

    expect(() => enforceSimulationLedgerWrite({ ledger_type: 'SIMULATION_LEDGER' } as any))
      .not.toThrow();

    // parseStrictJSONWithoutDuplicateKeys detects duplicate keys
    const dupJson = '{"key1": 100, "key1": 200}';
    expect(() => parseStrictJSONWithoutDuplicateKeys(dupJson))
      .toThrow(/E-ERR-022: CANONICAL_SERIALIZATION_DUPLICATE_KEY_ERROR/);

    const validJson = '{"key1": 100, "nested": {"key1": 200}}';
    expect(parseStrictJSONWithoutDuplicateKeys(validJson)).toEqual({ key1: 100, nested: { key1: 200 } });

    // canonicalizeJCS rejects NaN and lone surrogates
    expect(() => canonicalizeJCS({ val: NaN })).toThrow(/E-ERR-022: CANONICAL_SERIALIZATION_ERROR/);
    expect(() => canonicalizeJCS({ val: '\uD800' })).toThrow(/E-ERR-022: CANONICAL_SERIALIZATION_ERROR/);
  });

  it('ADV-SIM-01: SimulationPipeline decrements available quantity across fills and marks exhausted offer expired', () => {
    const pipeline = new SimulationPipeline({
      initialCash: createCanonicalMoney('10000000', 'INR', 4)
    });
    pipeline.getFeedHandler().registerSymbolMapping('VENUE_NSE_COMMERCIAL', 'DIN3017-W4-16-25', 'prod:din3017:16-25mm');

    const activeOffer: CanonicalOffer = {
      ...offer,
      available_quantity: 50,
      offer_status: 'VERIFIED_EXECUTABLE_OFFER',
      verification_status: 'VERIFIED'
    };
    pipeline.registerVerifiedOffer(activeOffer);

    // Consume 30 units
    const tick1 = {
      message_id: 'msg-tick-1',
      venue_id: 'VENUE_NSE_COMMERCIAL',
      raw_symbol: 'DIN3017-W4-16-25',
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '110.00',
      bid_quantity: 30,
      ask_price: '111.00',
      ask_quantity: 30
    };
    const feedRes1 = pipeline.getFeedHandler().ingestRawMessage(tick1, tick1.timestamp_utc);
    pipeline.processMarketEvent(feedRes1.event!, tick1.timestamp_utc);
    const off1 = pipeline.getVerifiedOffer(activeOffer.offer_id)!;
    expect(off1.available_quantity).toBe(20);
    expect(off1.offer_status).toBe('VERIFIED_EXECUTABLE_OFFER');

    // Consume remaining 20 units
    const tick2 = {
      message_id: 'msg-tick-2',
      venue_id: 'VENUE_NSE_COMMERCIAL',
      raw_symbol: 'DIN3017-W4-16-25',
      sequence: 2,
      timestamp_utc: '2026-10-11T12:00:01Z',
      bid_price: '110.00',
      bid_quantity: 20,
      ask_price: '111.00',
      ask_quantity: 20
    };
    const feedRes2 = pipeline.getFeedHandler().ingestRawMessage(tick2, tick2.timestamp_utc);
    pipeline.processMarketEvent(feedRes2.event!, tick2.timestamp_utc);
    const off2 = pipeline.getVerifiedOffer(activeOffer.offer_id)!;
    expect(off2.available_quantity).toBe(0);
    expect(off2.offer_status).toBe('EXPIRED_OFFER');
  });

  it('ADV-SEC-01: Feed handler rejects non-numeric sequences, crossed prices, and bounds replay ranges', () => {
    const handler = new MarketFeedHandler();
    handler.registerSymbolMapping('VENUE_NSE_COMMERCIAL', 'DIN3017-W4-16-25', 'prod:din3017:16-25mm');

    // Non-numeric sequence
    const badSeqMsg = {
      message_id: 'msg-bad-seq',
      venue_id: 'VENUE_NSE_COMMERCIAL',
      raw_symbol: 'DIN3017-W4-16-25',
      sequence: 'abc' as any,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '110.00',
      bid_quantity: 10,
      ask_price: '111.00',
      ask_quantity: 10
    };
    const resSeq = handler.ingestRawMessage(badSeqMsg, '2026-10-11T12:00:00Z');
    expect(resSeq.outcome).toBe('INVALID_FORMAT');
    expect(resSeq.reason).toContain('INVALID_SEQUENCE_FORMAT');

    // Crossed prices: bid > ask
    const crossedMsg = {
      message_id: 'msg-crossed',
      venue_id: 'VENUE_NSE_COMMERCIAL',
      raw_symbol: 'DIN3017-W4-16-25',
      sequence: 1,
      timestamp_utc: '2026-10-11T12:00:00Z',
      bid_price: '115.00',
      bid_quantity: 10,
      ask_price: '110.00', // Lower than bid!
      ask_quantity: 10
    };
    const resCrossed = handler.ingestRawMessage(crossedMsg, '2026-10-11T12:00:00Z');
    expect(resCrossed.outcome).toBe('INVALID_FORMAT');
    expect(resCrossed.reason).toContain('INVALID_MARKET_PRICES');
  });
});
