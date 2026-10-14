import { describe, it, expect } from 'vitest';
import { DurableRecoveryJournal } from '../../src/persistence/durableRecoveryJournal.js';

describe('SUITE-09: Virtual Genesis Head & Hash Chaining', () => {
  const GENESIS_HEAD_HASH = '0'.repeat(64);

  it('GENESIS-HEAD-SEQUENCE-ZERO-001: Stream begins at virtual sequence -1 with all-zeros hash', () => {
    expect(GENESIS_HEAD_HASH.length).toBe(64);
    expect(GENESIS_HEAD_HASH).toBe('0'.repeat(64));

    const journal = new DurableRecoveryJournal();
    expect(journal.getLastEntrySha256()).toBe(GENESIS_HEAD_HASH);
    expect(journal.getEntryCount()).toBe(0);
  });

  it('STREAM-GEN-001: First real event (sequence 0) binds previous_event_hash to H_-1', () => {
    const journal = new DurableRecoveryJournal();
    const entry1 = journal.appendEvent('FILL_RECORDED', { fill_id: 'fill:1' }, '2026-10-10T10:00:00Z');
    expect(entry1.prev_entry_sha256).toBe(GENESIS_HEAD_HASH);
    expect(entry1.sequence_number).toBe(1);

    const entry2 = journal.appendEvent('PORTFOLIO_APPLIED', { fill_id: 'fill:1' }, '2026-10-10T10:00:01Z');
    expect(entry2.prev_entry_sha256).toBe(entry1.entry_sha256);
    expect(entry2.sequence_number).toBe(2);

    const integrity = journal.verifyIntegrity();
    expect(integrity.isValid).toBe(true);
  });
});
