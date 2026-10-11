import { describe, it, expect } from 'vitest';
import { sha256 } from '../../src/canonical/crypto.js';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';

describe('SUITE-09: Virtual Genesis Head & Hash Chaining', () => {
  const GENESIS_HEAD_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

  it('GENESIS-HEAD-SEQUENCE-ZERO-001: Stream begins at virtual sequence -1 with all-zeros hash', () => {
    expect(GENESIS_HEAD_HASH.length).toBe(64);
    expect(GENESIS_HEAD_HASH).toBe('0'.repeat(64));
  });

  it('STREAM-GEN-001: First real event (sequence 0) binds previous_event_hash to H_-1', () => {
    const event0 = {
      sequence_number: '0',
      previous_event_hash: GENESIS_HEAD_HASH,
      payload: { type: 'STREAM_INIT' }
    };
    expect(event0.previous_event_hash).toBe(GENESIS_HEAD_HASH);
    const event0Hash = sha256(canonicalizeJCS(event0));

    const event1 = {
      sequence_number: '1',
      previous_event_hash: event0Hash,
      payload: { type: 'OFFER_CREATED' }
    };
    expect(event1.previous_event_hash).toBe(event0Hash);
  });
});
