import { CanonicalMoney, validateIso8601UtcTimestamp } from '../canonical/domain.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256, ed25519Verify } from '../canonical/crypto.js';
import { AttesterRole, GATEWAY_AUTHORITY_REGISTRY } from '../verification/claims.js';

export type LedgerType = 'ACTUALS_LEDGER' | 'SIMULATION_LEDGER';

export interface ActualsMutationContent {
  transaction_id: string;
  position_id: string;
  debit_account: string;
  credit_account: string;
  amount: CanonicalMoney;
  description: string;
}

export interface LedgerTransaction {
  transaction_id: string;
  ledger_type: 'ACTUALS_LEDGER';
  position_id: string;
  entry_timestamp_utc: string;
  sequence_number: string;
  debit_account: string;
  credit_account: string;
  amount: CanonicalMoney;
  description: string;
  linked_event_id: string;
}

export interface ActualsAuthTicketPayload {
  domain_tag: 'POC-001-ACTUALS-MUTATION-TICKET-V1';
  schema_version: '1.0.0';
  ticket_id: string;
  ledger_type: 'ACTUALS_LEDGER';
  permitted_action: 'MUTATE_ACTUALS_LEDGER';
  operator_id: string;
  operator_role: AttesterRole;
  auth_gateway_id: string;
  position_id: string;
  tx_mutation_sha256: string;
  issued_at_utc: string;
  expires_at_utc: string;
  nonce: string;
}

export interface ActualsAuthTicketEnvelope {
  payload: ActualsAuthTicketPayload;
  gateway_signature: string;
}

export interface AuthenticatedSessionContext {
  readonly session_id: string;
  readonly operator_id: string;
  readonly verified_roles: readonly AttesterRole[];
  readonly authenticated_at_utc: string;
}

export interface ActualsLedgerContext {
  ledger_type: 'ACTUALS_LEDGER';
  session: AuthenticatedSessionContext;
  auth_ticket: ActualsAuthTicketEnvelope;
}

export interface SimulationLedgerContext {
  ledger_type: 'SIMULATION_LEDGER';
  simulation_run_id: string;
  scenario_parameters_hash: string;
}

export type LedgerContext = ActualsLedgerContext | SimulationLedgerContext;

export interface LedgerDatabaseSession {
  executeActualsMutationInTransaction(
    mutation: ActualsMutationContent,
    nonce: string,
    ticket_id: string,
    operator_id: string,
    current_time_utc: string,
    expires_at_utc: string
  ): Promise<LedgerTransaction>;
}

export async function enforceActualsLedgerWrite(
  mutation: ActualsMutationContent,
  ctx: LedgerContext,
  current_time_utc: string,
  ledger_db: LedgerDatabaseSession
): Promise<LedgerTransaction> {
  // 1. Bidirectional Ledger Type Match
  if (ctx.ledger_type !== 'ACTUALS_LEDGER') {
    throw new Error('E-ERR-020: ACTUALS_LEDGER_WRITE_VIOLATION: Context is not ACTUALS_LEDGER');
  }
  const actualsCtx = ctx as ActualsLedgerContext;
  if (!actualsCtx.auth_ticket || !actualsCtx.auth_ticket.gateway_signature) {
    throw new Error('E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Missing auth ticket or gateway signature');
  }
  const payload = actualsCtx.auth_ticket.payload;

  // 2. Runtime Structure & Domain Tag Verification
  if (payload.domain_tag !== 'POC-001-ACTUALS-MUTATION-TICKET-V1' ||
      payload.schema_version !== '1.0.0' ||
      payload.ledger_type !== 'ACTUALS_LEDGER' ||
      payload.permitted_action !== 'MUTATE_ACTUALS_LEDGER') {
    throw new Error('E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Invalid ticket schema or domain tag');
  }

  // 3. Live Session Identity & Role Verification
  if (payload.operator_id !== actualsCtx.session.operator_id) {
    throw new Error('E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Ticket operator does not match kernel authenticated session operator');
  }
  if (!actualsCtx.session.verified_roles.includes(payload.operator_role)) {
    throw new Error('E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Kernel session does not possess ticket operator role');
  }
  if (payload.position_id !== mutation.position_id) {
    throw new Error('E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Position mismatch');
  }

  // 4. Exact Mutation Content SHA-256 Verification
  const computed_mutation_sha256 = sha256(Buffer.from(canonicalizeJCS(mutation), 'utf8'));
  if (payload.tx_mutation_sha256 !== computed_mutation_sha256) {
    throw new Error('E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Mutation contents do not match ticket digest');
  }

  // 5. Strict Calendar & Timestamp Validation
  validateIso8601UtcTimestamp(payload.issued_at_utc);
  validateIso8601UtcTimestamp(payload.expires_at_utc);
  validateIso8601UtcTimestamp(current_time_utc);
  const current_ms = Date.parse(current_time_utc);
  const exp_ms = Date.parse(payload.expires_at_utc);
  const iss_ms = Date.parse(payload.issued_at_utc);
  if (exp_ms - iss_ms !== 300000) {
    throw new Error('E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Ticket validity window must be exactly 300000ms (5 minutes)');
  }
  if (current_ms > exp_ms || current_ms < iss_ms - 300000) {
    throw new Error('E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Ticket expired or clock skew exceeded');
  }

  // 6. Gateway Registration, Validity Window & Revocation/Compromise Check
  const gateway = GATEWAY_AUTHORITY_REGISTRY[payload.auth_gateway_id];
  if (!gateway || gateway.revoked || gateway.compromised) {
    throw new Error('E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Gateway revoked, compromised, or unregistered');
  }
  const gw_from_ms = Date.parse(gateway.valid_from_utc);
  const gw_until_ms = Date.parse(gateway.valid_until_utc);
  if (iss_ms < gw_from_ms || iss_ms > gw_until_ms) {
    throw new Error('E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Gateway validity window elapsed');
  }

  // 7. Ed25519 Cryptographic Signature Verification
  const ticket_bytes = Buffer.from(canonicalizeJCS(payload), 'utf8');
  if (!ed25519Verify(ticket_bytes, gateway.public_key_hex, actualsCtx.auth_ticket.gateway_signature)) {
    throw new Error('E-ERR-026: ACTUALS_LEDGER_UNAUTHORIZED_CONTEXT: Invalid gateway signature');
  }

  // 8. Atomic Nonce Insertion & Ledger Mutation in a Single ACID DB Transaction
  if (!/^[a-zA-Z0-9_-]{16,64}$/.test(payload.nonce)) {
    throw new Error('E-ERR-024: INVALID_NONCE_FORMAT');
  }
  try {
    const record = await ledger_db.executeActualsMutationInTransaction(
      mutation,
      payload.nonce,
      payload.ticket_id,
      payload.operator_id,
      current_time_utc,
      payload.expires_at_utc
    );
    return record;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('UNIQUE') || errorMsg.includes('duplicate') || errorMsg.includes('REPLAYED')) {
      throw new Error('E-ERR-023: GATEWAY_ENDORSEMENT_NONCE_REPLAYED: Endorsement nonce already consumed');
    }
    throw new Error(`E-ERR-026: ACTUALS_LEDGER_MUTATION_FAILED: ${errorMsg}`);
  }
}

/**
 * Reverse simulation guard: prevents live capital contexts or actuals contexts from mutating simulation state.
 */
export function enforceSimulationLedgerWrite(ctx: LedgerContext): void {
  if (ctx.ledger_type !== 'SIMULATION_LEDGER') {
    throw new Error('E-ERR-025: SIMULATION_LEDGER_WRITE_VIOLATION: Actuals ledger or non-simulation context cannot mutate simulation state');
  }
}

