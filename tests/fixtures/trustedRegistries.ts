import type { PrincipalAuthorityRegistry } from '../../src/verification/claims.js';

// Test-only principal and public key. The corresponding signing seed remains in test files.
export const TEST_PRINCIPAL_AUTHORITY_REGISTRY: PrincipalAuthorityRegistry = Object.freeze({
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
