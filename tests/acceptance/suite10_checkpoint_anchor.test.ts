import { describe, it, expect } from 'vitest';
import {
  TEST_FIXTURE_ANCHOR_REGISTRY,
  verifyStreamCheckpointReceipt,
  StreamCheckpointReceipt,
  ExpectedStreamState
} from '../../src/checkpoint/trustAnchor.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import { ed25519Sign, sha256 } from '../../src/canonical/crypto.js';

describe('SUITE-10: Checkpoint Anchoring', () => {
  // Let's create a test keypair for trust anchor
  const anchorSeed = '05060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f2021222324';
  const anchorPubHex = '9b28b7e7c99d0eb6ef45df5e23c72b152d0fa58d4a974dfef729a888d30e0600'; // Computed from seed
  // Or we can sign directly with anchorSeed
  const testAnchor = {
    anchor_id: 'anchor:test-01',
    algorithm: 'ED25519' as const,
    public_key_hex: '',
    valid_from_utc: '2026-01-01T00:00:00Z',
    valid_until_utc: '2027-01-01T00:00:00Z',
    revoked: false
  };

  // Obtain actual public key hex from Node crypto to ensure perfect signature verification
  const crypto = require('node:crypto');
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(anchorSeed, 'hex')]),
    format: 'der',
    type: 'pkcs8'
  });
  const pubDer = crypto.createPublicKey(privKey).export({ format: 'der', type: 'spki' });
  testAnchor.public_key_hex = pubDer.subarray(12).toString('hex');

  const registry = {
    [testAnchor.anchor_id]: testAnchor
  };

  const expectedStream: ExpectedStreamState = {
    stream_id: 'stream:offer:123',
    head_sequence_number: '10',
    head_event_hash: sha256('head-event')
  };

  function createValidCheckpoint(): StreamCheckpointReceipt {
    const unsignedReceipt = {
      checkpoint_id: 'chk:10',
      stream_id: expectedStream.stream_id,
      head_sequence_number: expectedStream.head_sequence_number,
      head_event_hash: expectedStream.head_event_hash,
      checkpoint_timestamp_utc: '2026-10-10T12:00:00Z',
      prior_git_commit_sha: '77eff71c3807c8852b49355f50e814bd75eb90ad',
      trust_anchor_id: testAnchor.anchor_id
    };

    const unsignedBytes = Buffer.from(canonicalizeJCS(unsignedReceipt), 'utf8');
    const chkSha256 = sha256(unsignedBytes);
    const signature = ed25519Sign(unsignedBytes, anchorSeed);

    return {
      ...unsignedReceipt,
      anchor_signature: signature,
      checkpoint_sha256: chkSha256
    };
  }

  it('CHECK-VERIFY-EXEC-003: Valid checkpoint verified against trust anchor', () => {
    const chk = createValidCheckpoint();
    const result = verifyStreamCheckpointReceipt(
      chk,
      '2026-10-10T12:00:00Z',
      registry,
      expectedStream,
      'CURRENT_OPERATIONAL'
    );
    expect(result).toBe(true);
  });

  it('CHECK-SIG-FAIL-001: Tampered checkpoint digest throws E-ERR-015', () => {
    const chk = createValidCheckpoint();
    const tampered = { ...chk, checkpoint_sha256: '00'.repeat(32) };
    expect(() => verifyStreamCheckpointReceipt(
      tampered,
      '2026-10-10T12:00:00Z',
      registry,
      expectedStream
    )).toThrow(/E-ERR-015: CHECKPOINT_SIGNATURE_VERIFICATION_FAILED/);
  });

  it('CHECK-COMPROMISE-FAIL-004: Compromised anchor key rejects in all modes', () => {
    const compromisedRegistry = {
      [testAnchor.anchor_id]: { ...testAnchor, compromised: true }
    };
    const chk = createValidCheckpoint();
    expect(() => verifyStreamCheckpointReceipt(
      chk,
      '2026-10-10T12:00:00Z',
      compromisedRegistry,
      expectedStream,
      'HISTORICAL_AUDIT'
    )).toThrow(/E-ERR-011: TRUST_ANCHOR_INVALID_OR_REVOKED/);
  });
});
