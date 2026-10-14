import { describe, it, expect } from 'vitest';
import { ed25519Verify } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import {
  validateAttesterAuthority,
  validateGatewayEndorsementReceipt,
  GATEWAY_AUTHORITY_REGISTRY
} from '../../src/verification/claims.js';
import { TEST_PRINCIPAL_AUTHORITY_REGISTRY } from '../fixtures/trustedRegistries.js';

describe('SUITE-05: Claim Derivation, Authority Validation & KAT-05 Vectors', () => {
  it('CLAIM-SIG-VALID-001 (KAT-05A): Valid direct Ed25519 claim signature verified bitwise', () => {
    const pubKeyHex = '79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664';
    const sigHex = '7ff10297c25b650b464d8e8a409c8b87ce0d51381caa665c40c622037d638e85cea0a7bac8783f4c41a401adfc7bfd9d0aa10bd018266d4f12ec9e32421ac006';
    const jcsPayload = '{"attested_at_utc":"2026-10-10T12:00:00Z","attester_id":"op:sec:shrom-principal-01","claim_parameters":{"confirmed_unit_price":{"amount_subunits":"105000","currency":"INR","scale":4},"price_evidence_kind":"PROFORMA_INVOICE"},"claim_type":"PRICE_CONFIRMATION","claimed_role":"PORTFOLIO_MANAGER","domain_tag":"CLAIM_ATTESTATION","evidence_id":"ev:doc:pi-2026-0042","evidence_sha256":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08","offer_id":"off:din3017:sup-01:2026-q4","product_id":"prod:din3017:16-25mm","schema_version":"POC-001/CLAIM_ATTESTATION/v1"}';

    const isValid = ed25519Verify(Buffer.from(jcsPayload, 'utf8'), pubKeyHex, sigHex);
    expect(isValid).toBe(true);
  });

  it('GATEWAY-VERIFY-KAT-002 (KAT-05B): Valid gateway claim endorsement verified bitwise', () => {
    const gatewayPubKeyHex = '43cdc023d22d5f9e107d1a0693457d35d1d10eb7d21c721192f56f5de40665d3';
    const gatewaySigHex = 'ab67747ddbb5430d8318316dbe943f3dfab81d6dc4100ac4d2be4887534ef132b76cae58fb2e793eb604bd9dbdd8aa921e05cb2f0ed29f9ba15a14b02aae160e';
    const jcsEndorsement = '{"auth_gateway_id":"gw:auth:platform-core-01","claim_signing_payload_sha256":"d602df8714f7112c689b077b93e73432bc1ce81e95931fe6beb4fb7c1de5a397","domain_tag":"GATEWAY_CLAIM_ENDORSEMENT","expires_at_utc":"2026-10-10T12:05:05Z","issued_at_utc":"2026-10-10T12:00:05Z","nonce":"e4b9d07f-71b5-4b07-9b22-8d76e4895a12","operator_id":"op:sec:shrom-principal-01","operator_role":"PORTFOLIO_MANAGER","schema_version":"POC-001/GATEWAY_ENDORSEMENT/v1"}';

    const isValid = ed25519Verify(Buffer.from(jcsEndorsement, 'utf8'), gatewayPubKeyHex, gatewaySigHex);
    expect(isValid).toBe(true);
  });

  it('AUTH-ROLE-002 & AUTH-CLAIM-ROLE-004: Role authorization fail-closed enforcement', () => {
    // Human operator asserting VERIFIED_EXTERNAL_ORACLE throws E-ERR-018
    expect(() => validateAttesterAuthority(
      'op:sec:shrom-principal-01',
      'VERIFIED_EXTERNAL_ORACLE' as any,
      'PRICE_CONFIRMATION',
      '2026-10-10T12:00:00Z',
      '2026-10-10T12:00:00Z',
      TEST_PRINCIPAL_AUTHORITY_REGISTRY
    )).toThrow(/E-ERR-018: INSUFFICIENT_ATTESTER_ROLE/);
  });
});
