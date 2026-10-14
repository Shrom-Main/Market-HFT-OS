import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import {
  enforceActualsLedgerWrite,
  enforceSimulationLedgerWrite,
  ActualsMutationContent,
  ActualsAuthTicketPayload,
  ActualsAuthTicketEnvelope,
  ActualsLedgerContext,
  LedgerDatabaseSession,
  LedgerTransaction
} from '../../src/ledger/actualsGuard.js';
import { createCanonicalMoney } from '../../src/canonical/domain.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import { sha256, ed25519Sign } from '../../src/canonical/crypto.js';
import { GATEWAY_AUTHORITY_REGISTRY, RegisteredGateway } from '../../src/verification/claims.js';

describe('SUITE-06: Dual-Ledger Isolation & ActualsGuard Authorization (Normative Spec §8.1)', () => {
  const TEST_GATEWAY_ID = 'gw:auth:test-dual-ledger-01';
  let testKeySeedHex: string;
  let testPubKeyHex: string;

  beforeAll(() => {
    // Generate an authentic 32-byte Ed25519 seed for test gateway signing
    const keyPair = crypto.generateKeyPairSync('ed25519');
    const exportedPkcs8 = keyPair.privateKey.export({ format: 'der', type: 'pkcs8' });
    testKeySeedHex = exportedPkcs8.subarray(exportedPkcs8.length - 32).toString('hex');

    const exportedSpki = keyPair.publicKey.export({ format: 'der', type: 'spki' });
    testPubKeyHex = exportedSpki.subarray(exportedSpki.length - 32).toString('hex');

    const testGateway: RegisteredGateway = {
      gateway_id: TEST_GATEWAY_ID,
      public_key_hex: testPubKeyHex,
      valid_from_utc: '2026-01-01T00:00:00Z',
      valid_until_utc: '2027-01-01T00:00:00Z',
      revoked: false
    };

    GATEWAY_AUTHORITY_REGISTRY[TEST_GATEWAY_ID] = testGateway;
  });

  afterAll(() => {
    delete GATEWAY_AUTHORITY_REGISTRY[TEST_GATEWAY_ID];
  });

  function createValidMutation(): ActualsMutationContent {
    return {
      transaction_id: 'tx:act:001',
      position_id: 'pos:din3017:in-01',
      debit_account: 'acc:bank:hdfc-primary',
      credit_account: 'acc:vendor:bhiwadi-supplier',
      amount: createCanonicalMoney('1550000', 'INR', 4),
      description: 'Procurement outlay for DIN3017 W4 batch #001'
    };
  }

  function createValidTicketAndEnvelope(
    mutation: ActualsMutationContent,
    overrides?: Partial<ActualsAuthTicketPayload>
  ): { payload: ActualsAuthTicketPayload; envelope: ActualsAuthTicketEnvelope } {
    const mutationDigest = sha256(Buffer.from(canonicalizeJCS(mutation), 'utf8'));
    const payload: ActualsAuthTicketPayload = {
      domain_tag: 'POC-001-ACTUALS-MUTATION-TICKET-V1',
      schema_version: '1.0.0',
      ticket_id: 'tkt:act:2026-0001',
      ledger_type: 'ACTUALS_LEDGER',
      permitted_action: 'MUTATE_ACTUALS_LEDGER',
      operator_id: 'op:sec:shrom-principal-01',
      operator_role: 'PORTFOLIO_MANAGER',
      auth_gateway_id: TEST_GATEWAY_ID,
      position_id: mutation.position_id,
      tx_mutation_sha256: mutationDigest,
      issued_at_utc: '2026-10-10T12:00:00Z',
      expires_at_utc: '2026-10-10T12:05:00Z', // Exactly 300,000ms
      nonce: 'nonce_act_unique_001_xyz',
      ...overrides
    };

    const signatureBytes = Buffer.from(canonicalizeJCS(payload), 'utf8');
    const gateway_signature = ed25519Sign(signatureBytes, testKeySeedHex);

    return {
      payload,
      envelope: {
        payload,
        gateway_signature
      }
    };
  }

  function createMockLedgerDb(consumedNonces: Set<string>): LedgerDatabaseSession {
    return {
      executeActualsMutationInTransaction: async (
        mutation,
        nonce,
        ticket_id,
        operator_id,
        current_time_utc
      ): Promise<LedgerTransaction> => {
        if (consumedNonces.has(nonce)) {
          throw new Error('UNIQUE constraint violation: nonce already consumed in actuals_ledger_nonces');
        }
        consumedNonces.add(nonce);

        return {
          transaction_id: mutation.transaction_id,
          ledger_type: 'ACTUALS_LEDGER',
          position_id: mutation.position_id,
          entry_timestamp_utc: current_time_utc,
          sequence_number: '1',
          debit_account: mutation.debit_account,
          credit_account: mutation.credit_account,
          amount: mutation.amount,
          description: mutation.description,
          linked_event_id: ticket_id
        };
      }
    };
  }

  it('ACTUALS-GUARD-001: Direct write to actuals ledger from simulation context blocked fail-closed', async () => {
    const mutation = createValidMutation();
    const consumedNonces = new Set<string>();
    const mockDb = createMockLedgerDb(consumedNonces);

    const simulationCtx = {
      ledger_type: 'SIMULATION_LEDGER' as const,
      simulation_run_id: 'sim:run:001',
      scenario_parameters_hash: 'a'.repeat(64)
    };

    await expect(
      enforceActualsLedgerWrite(mutation, simulationCtx as any, '2026-10-10T12:01:00Z', mockDb)
    ).rejects.toThrow(/E-ERR-020: ACTUALS_LEDGER_WRITE_VIOLATION/);

    expect(consumedNonces.size).toBe(0);
  });

  it('SIM-GUARD-002: Direct write to simulation ledger from actuals context blocked fail-closed', () => {
    const actualsCtx = {
      ledger_type: 'ACTUALS_LEDGER' as const,
      session: {
        session_id: 'sess:01',
        operator_id: 'op:sec:shrom-principal-01',
        verified_roles: ['PORTFOLIO_MANAGER'],
        authenticated_at_utc: '2026-10-10T12:00:00Z'
      }
    };

    expect(() => enforceSimulationLedgerWrite(actualsCtx as any)).toThrow(
      /E-ERR-025: SIMULATION_LEDGER_WRITE_VIOLATION/
    );
  });

  it('ACTUALS-AUTH-003: Valid Ed25519 ActualsAuthTicketEnvelope passes authentication and executes transaction', async () => {
    const mutation = createValidMutation();
    const { envelope } = createValidTicketAndEnvelope(mutation);
    const consumedNonces = new Set<string>();
    const mockDb = createMockLedgerDb(consumedNonces);

    const actualsCtx: ActualsLedgerContext = {
      ledger_type: 'ACTUALS_LEDGER',
      session: {
        session_id: 'sess:live:001',
        operator_id: 'op:sec:shrom-principal-01',
        verified_roles: ['PORTFOLIO_MANAGER'],
        authenticated_at_utc: '2026-10-10T12:00:00Z'
      },
      auth_ticket: envelope
    };

    const record = await enforceActualsLedgerWrite(
      mutation,
      actualsCtx,
      '2026-10-10T12:02:00Z',
      mockDb
    );

    expect(record.transaction_id).toBe(mutation.transaction_id);
    expect(record.ledger_type).toBe('ACTUALS_LEDGER');
    expect(record.position_id).toBe(mutation.position_id);
    expect(consumedNonces.has(envelope.payload.nonce)).toBe(true);
  });

  it('ACTUALS-AUTH-EXACT-004: Ticket expired, future-issued, or invalid duration != 300,000ms fails with E-ERR-026', async () => {
    const mutation = createValidMutation();
    const consumedNonces = new Set<string>();
    const mockDb = createMockLedgerDb(consumedNonces);

    // Case 1: Duration 300,001ms instead of exact 300,000ms
    const { envelope: envBadDuration } = createValidTicketAndEnvelope(mutation, {
      expires_at_utc: '2026-10-10T12:05:01Z'
    });

    const ctxBadDuration: ActualsLedgerContext = {
      ledger_type: 'ACTUALS_LEDGER',
      session: {
        session_id: 'sess:live:001',
        operator_id: 'op:sec:shrom-principal-01',
        verified_roles: ['PORTFOLIO_MANAGER'],
        authenticated_at_utc: '2026-10-10T12:00:00Z'
      },
      auth_ticket: envBadDuration
    };

    await expect(
      enforceActualsLedgerWrite(mutation, ctxBadDuration, '2026-10-10T12:01:00Z', mockDb)
    ).rejects.toThrow(/E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Ticket validity window must be exactly 300000ms/);

    // Case 2: Ticket expired at point of use
    const { envelope: envExpired } = createValidTicketAndEnvelope(mutation);
    const ctxExpired: ActualsLedgerContext = {
      ledger_type: 'ACTUALS_LEDGER',
      session: {
        session_id: 'sess:live:001',
        operator_id: 'op:sec:shrom-principal-01',
        verified_roles: ['PORTFOLIO_MANAGER'],
        authenticated_at_utc: '2026-10-10T12:00:00Z'
      },
      auth_ticket: envExpired
    };

    await expect(
      enforceActualsLedgerWrite(mutation, ctxExpired, '2026-10-10T12:05:01Z', mockDb)
    ).rejects.toThrow(/E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Ticket expired or clock skew exceeded/);
  });

  it('ACTUALS-TX-ATOMIC-005: Atomic rollback if any step fails in actuals transaction', async () => {
    const mutation = createValidMutation();
    const { envelope } = createValidTicketAndEnvelope(mutation);

    const failingDb: LedgerDatabaseSession = {
      executeActualsMutationInTransaction: async () => {
        throw new Error('Database serialization deadlock during actuals write');
      }
    };

    const actualsCtx: ActualsLedgerContext = {
      ledger_type: 'ACTUALS_LEDGER',
      session: {
        session_id: 'sess:live:001',
        operator_id: 'op:sec:shrom-principal-01',
        verified_roles: ['PORTFOLIO_MANAGER'],
        authenticated_at_utc: '2026-10-10T12:00:00Z'
      },
      auth_ticket: envelope
    };

    await expect(
      enforceActualsLedgerWrite(mutation, actualsCtx, '2026-10-10T12:02:00Z', failingDb)
    ).rejects.toThrow(/E-ERR-026: ACTUALS_LEDGER_MUTATION_FAILED: Database serialization deadlock/);
  });

  it('TEST-CONCURRENCY-NONCE-01: Replay of single-use ticket nonce rejected with E-ERR-023', async () => {
    const mutation = createValidMutation();
    const { envelope } = createValidTicketAndEnvelope(mutation);
    const consumedNonces = new Set<string>();
    const mockDb = createMockLedgerDb(consumedNonces);

    const actualsCtx: ActualsLedgerContext = {
      ledger_type: 'ACTUALS_LEDGER',
      session: {
        session_id: 'sess:live:001',
        operator_id: 'op:sec:shrom-principal-01',
        verified_roles: ['PORTFOLIO_MANAGER'],
        authenticated_at_utc: '2026-10-10T12:00:00Z'
      },
      auth_ticket: envelope
    };

    // First attempt succeeds
    const rec = await enforceActualsLedgerWrite(mutation, actualsCtx, '2026-10-10T12:02:00Z', mockDb);
    expect(rec.transaction_id).toBe(mutation.transaction_id);

    // Replay with identical nonce fails with E-ERR-023
    await expect(
      enforceActualsLedgerWrite(mutation, actualsCtx, '2026-10-10T12:03:00Z', mockDb)
    ).rejects.toThrow(/E-ERR-023: GATEWAY_ENDORSEMENT_NONCE_REPLAYED/);
  });
});
