import { validateIso8601UtcTimestamp } from '../canonical/domain.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256, ed25519Verify } from '../canonical/crypto.js';

export interface TrustAnchorDefinition {
  anchor_id: string;
  algorithm: 'ED25519';
  public_key_hex: string;
  valid_from_utc: string;
  valid_until_utc: string;
  revoked: boolean;
  revoked_at_utc?: string;
  compromised?: boolean;
}

export const TEST_FIXTURE_ANCHOR_REGISTRY: Record<string, TrustAnchorDefinition> = {
  'anchor:ed25519:test-fixture-01': {
    anchor_id: 'anchor:ed25519:test-fixture-01',
    algorithm: 'ED25519',
    public_key_hex: 'a5c0b11a0d3f82054f0a28f804791e3e7f2c69b2d8e411b98c56d7732a39a67a',
    valid_from_utc: '2026-01-01T00:00:00Z',
    valid_until_utc: '2027-01-01T00:00:00Z',
    revoked: false
  }
};

export interface StreamCheckpointReceipt {
  checkpoint_id: string;
  stream_id: string;
  head_sequence_number: string;
  head_event_hash: string;
  checkpoint_timestamp_utc: string;
  prior_git_commit_sha: string;
  trust_anchor_id: string;
  anchor_signature: string;
  checkpoint_sha256: string;
}

export interface ExpectedStreamState {
  stream_id: string;
  head_sequence_number: string;
  head_event_hash: string;
}

export function verifyStreamCheckpointReceipt(
  checkpoint: StreamCheckpointReceipt,
  current_time_utc: string,
  trust_anchors: Record<string, TrustAnchorDefinition>,
  expected_stream: ExpectedStreamState,
  mode: 'CURRENT_OPERATIONAL' | 'HISTORICAL_AUDIT' = 'CURRENT_OPERATIONAL'
): boolean {
  validateIso8601UtcTimestamp(checkpoint.checkpoint_timestamp_utc);
  validateIso8601UtcTimestamp(current_time_utc);
  if (!/^[a-f0-9]{64}$/.test(checkpoint.head_event_hash) ||
      !/^[a-f0-9]{64}$/.test(checkpoint.checkpoint_sha256) ||
      !/^[a-f0-9]{128}$/.test(checkpoint.anchor_signature)) {
    throw new Error('E-ERR-024: INVALID_CHECKPOINT_FORMAT: Malformed hex hash or signature');
  }
  if (!/^(0|[1-9][0-9]*)$/.test(checkpoint.head_sequence_number)) {
    throw new Error('E-ERR-024: INVALID_CHECKPOINT_FORMAT: head_sequence_number must be string-encoded unsigned integer');
  }

  const chk_ms = Date.parse(checkpoint.checkpoint_timestamp_utc);
  const cur_ms = Date.parse(current_time_utc);
  if (chk_ms > cur_ms + 300000) {
    throw new Error('E-ERR-007: CLOCK_SKEW_EXCEEDED: Checkpoint timestamp exceeds future time tolerance (300s)');
  }

  const anchor = trust_anchors[checkpoint.trust_anchor_id];
  if (!anchor) throw new Error('E-ERR-011: TRUST_ANCHOR_INVALID_OR_REVOKED: Anchor not in registry');
  if (anchor.algorithm !== 'ED25519' || !/^[a-f0-9]{64}$/.test(anchor.public_key_hex)) {
    throw new Error('E-ERR-011: TRUST_ANCHOR_INVALID_OR_REVOKED: Malformed anchor key');
  }
  validateIso8601UtcTimestamp(anchor.valid_from_utc);
  validateIso8601UtcTimestamp(anchor.valid_until_utc);
  const from_ms = Date.parse(anchor.valid_from_utc);
  const until_ms = Date.parse(anchor.valid_until_utc);
  if (from_ms >= until_ms) {
    throw new Error('E-ERR-011: TRUST_ANCHOR_INVALID_OR_REVOKED: Malformed validity window (valid_from >= valid_until)');
  }

  if (anchor.compromised) {
    throw new Error('E-ERR-011: TRUST_ANCHOR_INVALID_OR_REVOKED: Trust anchor is compromised (all historical signatures invalidated)');
  }

  if (mode === 'CURRENT_OPERATIONAL') {
    if (cur_ms < from_ms || cur_ms > until_ms) {
      throw new Error('E-ERR-011: TRUST_ANCHOR_INVALID_OR_REVOKED: Anchor is expired or not yet valid at current time');
    }
    if (anchor.revoked) {
      throw new Error('E-ERR-011: TRUST_ANCHOR_INVALID_OR_REVOKED: Trust anchor is currently revoked');
    }
    if (chk_ms < from_ms || chk_ms > until_ms) {
      throw new Error('E-ERR-011: TRUST_ANCHOR_INVALID_OR_REVOKED: Checkpoint timestamp outside anchor signing window');
    }
  } else {
    if (chk_ms < from_ms || chk_ms > until_ms) {
      throw new Error('E-ERR-011: TRUST_ANCHOR_INVALID_OR_REVOKED: Checkpoint timestamp outside anchor validity window at signing time');
    }
    if (anchor.revoked) {
      if (!anchor.revoked_at_utc) throw new Error('E-ERR-011: TRUST_ANCHOR_INVALID_OR_REVOKED: Revoked anchor missing revoked_at_utc');
      validateIso8601UtcTimestamp(anchor.revoked_at_utc);
      const rev_ms = Date.parse(anchor.revoked_at_utc);
      if (chk_ms >= rev_ms) {
        throw new Error('E-ERR-011: TRUST_ANCHOR_INVALID_OR_REVOKED: Checkpoint signed at or after anchor revocation timestamp');
      }
    }
  }

  if (checkpoint.stream_id !== expected_stream.stream_id) throw new Error('E-ERR-015: CHECKPOINT_STREAM_ID_MISMATCH');
  if (checkpoint.head_sequence_number !== expected_stream.head_sequence_number) throw new Error('E-ERR-015: CHECKPOINT_SEQUENCE_MISMATCH');
  if (checkpoint.head_event_hash !== expected_stream.head_event_hash) throw new Error('E-ERR-015: CHECKPOINT_HEAD_HASH_MISMATCH');

  const { anchor_signature, checkpoint_sha256, ...unsigned_receipt } = checkpoint;
  const unsigned_bytes = Buffer.from(canonicalizeJCS(unsigned_receipt), 'utf8');
  if (checkpoint.checkpoint_sha256 !== sha256(unsigned_bytes)) {
    throw new Error('E-ERR-015: CHECKPOINT_SIGNATURE_VERIFICATION_FAILED: Canonical digest mismatch');
  }
  if (!ed25519Verify(unsigned_bytes, anchor.public_key_hex, anchor_signature)) {
    throw new Error('E-ERR-015: CHECKPOINT_SIGNATURE_VERIFICATION_FAILED: Ed25519 signature invalid');
  }

  return true;
}
