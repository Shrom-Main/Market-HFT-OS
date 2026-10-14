import crypto from 'node:crypto';
import {
  CommercialOfferStatus,
  CanonicalOffer,
  CanonicalStreamSequence,
  OfferPromotionEventPayload,
  parseCanonicalStreamSequence,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256 } from '../canonical/crypto.js';
import {
  PromotionEvaluationDraft,
  EvaluatorTokenVerifier,
  validateEvaluationDraftIntegrity
} from '../verification/gate.js';
import {
  validateAttesterAuthority,
  validateGatewayEndorsementReceipt,
  validateAndBuildClaimSigningPayload,
  resolveStreamEvidence,
  GATEWAY_AUTHORITY_REGISTRY,
  PRINCIPAL_AUTHORITY_REGISTRY,
  PrincipalAuthorityRegistry
} from '../verification/claims.js';
import {
  validateEvidenceAllowlistEligibility,
  CLAIM_PERMITTED_DOCUMENT_TYPES
} from '../canonical/allowlist.js';

export interface TrustedClock {
  nowUtc(): string;
}

export const MAX_EVALUATION_DRAFT_AGE_MS = 300000;

export class SystemTrustedClock implements TrustedClock {
  private last_ts: number = 0;
  private max_clock_skew_ms: number = 5000;
  private is_available: boolean = true;

  constructor(opts?: { is_available?: boolean; max_clock_skew_ms?: number }) {
    if (opts?.is_available !== undefined) this.is_available = opts.is_available;
    if (opts?.max_clock_skew_ms !== undefined) this.max_clock_skew_ms = opts.max_clock_skew_ms;
  }

  public setAvailable(available: boolean): void {
    this.is_available = available;
  }

  public nowUtc(): string {
    if (!this.is_available) {
      throw new Error('E-ERR-007: TRUSTED_CLOCK_UNAVAILABLE: Clock source is unreachable or disabled');
    }
    const now = Date.now();
    if (now < this.last_ts) {
      throw new Error('E-ERR-007: TRUSTED_CLOCK_UNAVAILABLE: Monotonic clock violation');
    }
    this.last_ts = now;
    return new Date(now).toISOString();
  }
}

export interface OfferPersistenceDatabaseTransaction {
  getOfferStreamHeadForUpdate(offer_id: string): Promise<{ sequence_number: CanonicalStreamSequence; offer_status: CommercialOfferStatus }>;
  insertNonceIfUnused(nonce: string, gateway_id: string, expires_at_utc: string, consumed_at_utc: string): Promise<boolean>;
  putAssessment(assessment_sha256: string, canonical_bytes: Buffer, created_at_utc: string): Promise<void>;
  getAssessment(assessment_sha256: string): Promise<Buffer | null>;
  appendOfferStreamEvent(event: {
    stream_id: string;
    sequence_number: CanonicalStreamSequence;
    payload_kind: string;
    payload: OfferPromotionEventPayload;
    event_sha256: string;
  }): Promise<void>;
  updateOfferStreamHead(offer_id: string, resulting_sequence_number: CanonicalStreamSequence, resulting_status: CommercialOfferStatus, updated_at_utc: string): Promise<void>;
  getOfferStreamEvent(stream_id: string, sequence_number: CanonicalStreamSequence): Promise<{
    stream_id: string;
    sequence_number: CanonicalStreamSequence;
    payload_kind: string;
    payload: OfferPromotionEventPayload;
    event_sha256: string;
    created_at_utc: string;
  } | null>;
}

export interface OfferPersistenceDatabaseSession {
  executeTransaction<T>(fn: (tx: OfferPersistenceDatabaseTransaction) => Promise<T>): Promise<T>;
  getAssessment(assessment_sha256: string): Promise<Buffer | null>;
}

export interface AmbiguousCommitReconciliationResult {
  outcome: 'COMMITTED' | 'ROLLED_BACK' | 'STREAM_ADVANCED_UNRELATED' | 'OUTCOME_UNKNOWN';
  stream_sequence: string | null;
  promotion_event?: OfferPromotionEventPayload;
  event_sha256?: string;
  reason: string;
}

/**
 * In-memory transactional database session mock for testing and isolation
 */
export class InMemoryOfferPersistenceDatabaseSession implements OfferPersistenceDatabaseSession {
  public heads: Map<string, { sequence_number: CanonicalStreamSequence; offer_status: CommercialOfferStatus }> = new Map();
  public nonces: Map<string, { gateway_id: string; expires_at_utc: string; consumed_at_utc: string }> = new Map();
  public assessments: Map<string, { bytes: Buffer; created_at_utc: string }> = new Map();
  public events: Map<string, {
    stream_id: string;
    sequence_number: CanonicalStreamSequence;
    payload_kind: string;
    payload: OfferPromotionEventPayload;
    event_sha256: string;
    created_at_utc: string;
  }> = new Map();

  private transactionQueue: Promise<void> = Promise.resolve();
  public simulate_connection_failure: boolean = false;
  public simulate_lock_timeout: boolean = false;

  public async getAssessment(assessment_sha256: string): Promise<Buffer | null> {
    const record = this.assessments.get(assessment_sha256);
    return record ? record.bytes : null;
  }

  public async executeTransaction<T>(fn: (tx: OfferPersistenceDatabaseTransaction) => Promise<T>): Promise<T> {
    if (this.simulate_lock_timeout || this.simulate_connection_failure) {
      throw new Error('E-ERR-037: DATABASE_UNREACHABLE_OR_LOCK_TIMEOUT');
    }

    // Serialize in-memory transactions to model database row-lock queueing
    const previousQueue = this.transactionQueue;
    let releaseQueue: () => void = () => {};
    this.transactionQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previousQueue;

    try {
      if (this.simulate_lock_timeout || this.simulate_connection_failure) {
        throw new Error('E-ERR-037: DATABASE_UNREACHABLE_OR_LOCK_TIMEOUT');
      }

      // Clone state for ACID rollback support
      const clonedHeads = new Map(this.heads);
      const clonedNonces = new Map(this.nonces);
      const clonedAssessments = new Map(this.assessments);
      const clonedEvents = new Map(this.events);

      const tx: OfferPersistenceDatabaseTransaction = {
        getOfferStreamHeadForUpdate: async (offer_id: string) => {
          if (this.simulate_lock_timeout) {
            throw new Error('E-ERR-037: LOCK_TIMEOUT');
          }
          const existing = clonedHeads.get(offer_id);
          if (!existing) {
            const initHead = { sequence_number: parseCanonicalStreamSequence('0'), offer_status: 'INDICATIVE_QUOTE' as CommercialOfferStatus };
            clonedHeads.set(offer_id, initHead);
            return initHead;
          }
          return existing;
        },
        insertNonceIfUnused: async (nonce: string, gateway_id: string, expires_at_utc: string, consumed_at_utc: string) => {
          if (clonedNonces.has(nonce)) {
            return false;
          }
          clonedNonces.set(nonce, { gateway_id, expires_at_utc, consumed_at_utc });
          return true;
        },
        putAssessment: async (assessment_sha256: string, canonical_bytes: Buffer, created_at_utc: string) => {
          clonedAssessments.set(assessment_sha256, { bytes: canonical_bytes, created_at_utc });
        },
        getAssessment: async (assessment_sha256: string) => {
          const item = clonedAssessments.get(assessment_sha256);
          return item ? item.bytes : null;
        },
        appendOfferStreamEvent: async (ev) => {
          const key = `${ev.stream_id}:${ev.sequence_number}`;
          clonedEvents.set(key, {
            ...ev,
            created_at_utc: new Date().toISOString()
          });
        },
        updateOfferStreamHead: async (offer_id: string, resulting_sequence_number: CanonicalStreamSequence, resulting_status: CommercialOfferStatus) => {
          clonedHeads.set(offer_id, {
            sequence_number: resulting_sequence_number,
            offer_status: resulting_status
          });
        },
        getOfferStreamEvent: async (stream_id: string, sequence_number: CanonicalStreamSequence) => {
          const key = `${stream_id}:${sequence_number}`;
          const item = clonedEvents.get(key);
          return item || null;
        }
      };

      try {
        const result = await fn(tx);
        // Transaction succeeded, commit mutations
        this.heads = clonedHeads;
        this.nonces = clonedNonces;
        this.assessments = clonedAssessments;
        this.events = clonedEvents;
        return result;
      } catch (err) {
        // Transaction failed, rollback (discard cloned modifications)
        throw err;
      }
    } finally {
      releaseQueue();
    }
  }
}

export async function commitPromotionIfVersionAndConsumeNonces(
  db: OfferPersistenceDatabaseSession,
  clock: TrustedClock,
  offer: CanonicalOffer,
  expected_stream_sequence: string,
  evaluation: PromotionEvaluationDraft,
  raw_assessment: unknown,
  token_verifier: EvaluatorTokenVerifier,
  principal_registry: PrincipalAuthorityRegistry = PRINCIPAL_AUTHORITY_REGISTRY
): Promise<OfferPromotionEventPayload> {
  const pre_tx_time_utc = clock.nowUtc();
  const validated = validateEvaluationDraftIntegrity(
    evaluation,
    offer,
    expected_stream_sequence,
    raw_assessment,
    token_verifier,
    pre_tx_time_utc
  );

  return await db.executeTransaction(async (tx) => {
    const streamHead = await tx.getOfferStreamHeadForUpdate(offer.offer_id);
    if (['REJECTED_OFFER', 'EXPIRED_OFFER'].includes(streamHead.offer_status)) {
      throw new Error(`E-ERR-036: OFFER_ALREADY_TERMINAL: Offer is in terminal status '${streamHead.offer_status}'`);
    }

    const tx_auth_time_utc = clock.nowUtc();
    validateIso8601UtcTimestamp(tx_auth_time_utc);
    const tx_auth_ms = Date.parse(tx_auth_time_utc);

    const evaluation_age_ms = tx_auth_ms - Date.parse(validated.draft.evaluated_at_utc);
    if (!Number.isFinite(evaluation_age_ms) || evaluation_age_ms < 0 || evaluation_age_ms > MAX_EVALUATION_DRAFT_AGE_MS) {
      throw new Error('E-ERR-036: STALE_EVALUATION_DRAFT');
    }
    validateIso8601UtcTimestamp(offer.valid_until_utc);
    if (tx_auth_ms > Date.parse(offer.valid_until_utc)) {
      throw new Error('E-ERR-036: OFFER_TERMS_EXPIRED_AT_COMMIT');
    }

    if (BigInt(streamHead.sequence_number) !== BigInt(validated.draft.expected_stream_sequence)) {
      throw new Error('E-ERR-037: CONCURRENCY_CONFLICT: Offer stream has advanced since evaluation started');
    }

    for (const [claimType, claim] of Object.entries(validated.raw_claims)) {
      validateAttesterAuthority(
        claim.attestation.attester_id,
        claim.attestation.claimed_role,
        claim.claim_type,
        claim.attestation.attested_at_utc,
        tx_auth_time_utc,
        principal_registry
      );

      if (claim.attestation.auth.auth_mechanism === 'GATEWAY_CLAIM_ENDORSEMENT') {
        const rcpt = claim.attestation.auth.endorsement_receipt;
        validateGatewayEndorsementReceipt(rcpt, tx_auth_time_utc, GATEWAY_AUTHORITY_REGISTRY);

        const expectedPayload = validateAndBuildClaimSigningPayload(offer.offer_id, offer.product_id, claim);
        const expected_digest = sha256(Buffer.from(canonicalizeJCS(expectedPayload), 'utf8'));
        if (rcpt.claim_signing_payload_sha256 !== expected_digest) {
          throw new Error(`E-ERR-017: DIGEST_BINDING_MISMATCH: Endorsement receipt digest does not match claim signing payload for '${claimType}'`);
        }
        if (rcpt.operator_id !== claim.attestation.attester_id || rcpt.operator_role !== claim.attestation.claimed_role) {
          throw new Error(`E-ERR-017: GATEWAY_OPERATOR_ROLE_MISMATCH: Gateway receipt operator does not match claim attester for '${claimType}'`);
        }
      }

      const ev = resolveStreamEvidence(claim.attestation.evidence_id);
      if (ev) {
        const defaultDoc = CLAIM_PERMITTED_DOCUMENT_TYPES[claim.claim_type]?.[0] || 'PROFORMA_INVOICE';
        validateEvidenceAllowlistEligibility(
          ev.evidence_kind || 'OBSERVED',
          ev.verification_status || 'VERIFIED',
          ev.offer_status || 'VERIFIED_EXECUTABLE_OFFER',
          claim.claim_type,
          ev.document_type || defaultDoc
        );
      }
    }

    const consumed_nonces: string[] = [];
    if (validated.draft.promoted && validated.draft.nonces_to_consume.length > 0) {
      const nonceSet = new Set(validated.draft.nonces_to_consume.map(n => n.nonce));
      if (nonceSet.size !== validated.draft.nonces_to_consume.length) {
        throw new Error('E-ERR-024: DUPLICATE_NONCE_IN_BATCH: Evaluation contains duplicate nonces');
      }
      for (const item of validated.draft.nonces_to_consume) {
        const exp_ms = Date.parse(item.expires_at_utc);
        if (tx_auth_ms > exp_ms) {
          throw new Error(`E-ERR-027: GATEWAY_RECEIPT_EXPIRED: Gateway nonce '${item.nonce}' has expired at post-lock authorization instant (T_auth > T_expires)`);
        }
        const inserted = await tx.insertNonceIfUnused(item.nonce, item.gateway_id, item.expires_at_utc, tx_auth_time_utc);
        if (!inserted) {
          throw new Error('E-ERR-023: GATEWAY_ENDORSEMENT_NONCE_REPLAYED: Endorsement nonce already consumed');
        }
        consumed_nonces.push(item.nonce);
      }
    }

    const priorSeqBigInt = BigInt(validated.draft.expected_stream_sequence);
    const resulting_stream_sequence = parseCanonicalStreamSequence((priorSeqBigInt + 1n).toString());

    await tx.putAssessment(validated.draft.assessment_sha256, validated.canonical_assessment_bytes, tx_auth_time_utc);

    const eventPayload: OfferPromotionEventPayload = {
      offer_id: offer.offer_id,
      expected_stream_sequence: validated.draft.expected_stream_sequence,
      resulting_stream_sequence,
      assessment_id: validated.draft.assessment_id,
      assessment_sha256: validated.draft.assessment_sha256,
      claims_evidence_summary: validated.draft.claims_evidence_summary,
      policy_version: validated.draft.policy_version,
      evaluator_version: validated.draft.evaluator_version,
      target_offer_status: validated.draft.assigned_offer_status,
      target_verification_status: validated.draft.assigned_verification_status,
      rejection_reason: validated.draft.rejection_reason,
      consumed_nonces,
      decision_timestamp_utc: tx_auth_time_utc
    };

    const event_bytes = Buffer.from(canonicalizeJCS(eventPayload), 'utf8');
    const event_sha256 = sha256(event_bytes);

    await tx.appendOfferStreamEvent({
      stream_id: `stream:offer:${offer.offer_id}`,
      sequence_number: resulting_stream_sequence,
      payload_kind: 'OFFER_STATUS_TRANSITION',
      payload: eventPayload,
      event_sha256
    });

    await tx.updateOfferStreamHead(
      offer.offer_id,
      resulting_stream_sequence,
      validated.draft.assigned_offer_status,
      tx_auth_time_utc
    );

    return eventPayload;
  });
}

export async function reconcileAmbiguousPromotionCommit(
  db: OfferPersistenceDatabaseSession,
  offer_id: string,
  expected_prior_sequence: string,
  attempted_resulting_sequence: string,
  attempted_assessment_sha256: string,
  expected_event_sha256?: string
): Promise<AmbiguousCommitReconciliationResult> {
  try {
    return await db.executeTransaction(async (tx) => {
      const head = await tx.getOfferStreamHeadForUpdate(offer_id);
      const stream_id = `stream:offer:${offer_id}`;
      const attemptedSeq = parseCanonicalStreamSequence(attempted_resulting_sequence);
      const eventRecord = await tx.getOfferStreamEvent(stream_id, attemptedSeq);

      if (eventRecord && eventRecord.payload) {
        const payload = eventRecord.payload;
        const matchesOffer = payload.offer_id === offer_id;
        const matchesAssessmentId = payload.assessment_sha256 === attempted_assessment_sha256;

        const canonicalEventJson = canonicalizeJCS(payload);
        const recomputedEventSha256 = sha256(Buffer.from(canonicalEventJson, 'utf8'));

        const storedMatchesRecomputed = (eventRecord.event_sha256.length === 64) && crypto.timingSafeEqual(
          Buffer.from(eventRecord.event_sha256, 'hex'),
          Buffer.from(recomputedEventSha256, 'hex')
        );

        const callerHashMatches = !expected_event_sha256 || (
          expected_event_sha256.length === 64 && crypto.timingSafeEqual(
            Buffer.from(expected_event_sha256, 'hex'),
            Buffer.from(recomputedEventSha256, 'hex')
          )
        );

        const eventHashValid = storedMatchesRecomputed && callerHashMatches;

        const assessmentBytes = await tx.getAssessment(attempted_assessment_sha256);
        let assessmentHashValid = false;
        if (assessmentBytes && assessmentBytes.length > 0) {
          const recomputedAssessmentSha256 = sha256(assessmentBytes);
          assessmentHashValid = crypto.timingSafeEqual(
            Buffer.from(recomputedAssessmentSha256, 'hex'),
            Buffer.from(attempted_assessment_sha256, 'hex')
          );
        }

        if (matchesOffer && matchesAssessmentId && eventHashValid && assessmentHashValid) {
          return {
            outcome: 'COMMITTED',
            stream_sequence: head.sequence_number,
            promotion_event: payload,
            event_sha256: recomputedEventSha256,
            reason: 'Original promotion transaction committed successfully; independently recomputed and verified event digest and durable assessment digest on disk (regardless of subsequent stream advance).'
          };
        } else {
          return {
            outcome: 'STREAM_ADVANCED_UNRELATED',
            stream_sequence: head.sequence_number,
            reason: `Event at sequence ${attempted_resulting_sequence} failed cryptographic integrity verification (offer_match=${matchesOffer}, assessment_id_match=${matchesAssessmentId}, event_hash_valid=${eventHashValid}, assessment_hash_valid=${assessmentHashValid}). Stale draft must be discarded.`
          };
        }
      }

      if (head.sequence_number === expected_prior_sequence) {
        return {
          outcome: 'ROLLED_BACK',
          stream_sequence: head.sequence_number,
          reason: 'Stream head unchanged after row-lock acquisition and attempted event absent; original transaction resolved via rollback. Safe to retry with unconsumed nonces.'
        };
      }

      return {
        outcome: 'STREAM_ADVANCED_UNRELATED',
        stream_sequence: head.sequence_number,
        reason: `Stream head advanced to ${head.sequence_number} without the attempted promotion event at sequence ${attempted_resulting_sequence}. Prior draft is permanently stale and must be re-evaluated.`
      };
    });
  } catch (err) {
    return {
      outcome: 'OUTCOME_UNKNOWN',
      stream_sequence: null,
      reason: `Reconciliation lock acquisition failed or timed out: ${err instanceof Error ? err.message : String(err)}. State preserved as unknown (no stream head observed); retry prohibited until authoritative resolution.`
    };
  }
}
