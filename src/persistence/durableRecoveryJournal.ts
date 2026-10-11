import {
  CanonicalMoney,
  validateIso8601UtcTimestamp
} from '../canonical/domain.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256 } from '../canonical/crypto.js';
import { deepFreeze } from '../verification/gate.js';
import {
  SimulatedOrderRecord,
  SimulatedFillEvent
} from '../execution/simulatedGateway.js';
import {
  SimulationPortfolio,
  PortfolioSnapshot,
  computeFillFingerprint
} from '../portfolio/simulationPortfolio.js';
import { DeterministicClock } from '../canonical/deterministic.js';

export type RecoveryEventType =
  | 'INTENT_RECORDED'
  | 'ORDER_SUBMITTED'
  | 'FILL_RECORDED'
  | 'PORTFOLIO_APPLIED'
  | 'CHECKPOINT';

export interface RecoveryJournalEntry {
  entry_id: string;
  sequence_number: number;
  timestamp_utc: string;
  event_type: RecoveryEventType;
  payload: any;
  payload_sha256: string;
  prev_entry_sha256: string;
  entry_sha256: string;
}

export interface CrashRecoveryResult {
  recovered_fills_count: number;
  skipped_duplicate_fills_count: number;
  replayed_entries_count: number;
  final_portfolio_snapshot: PortfolioSnapshot;
  recovery_completed_utc: string;
}

/**
 * Durable Cryptographically-Chained Recovery Journal (Gate M3)
 * Provides tamper-evident, append-only persistence log for crash recovery
 * and restart verification with zero external database dependencies.
 */
export class DurableRecoveryJournal {
  private entries: RecoveryJournalEntry[] = [];
  private lastEntrySha256: string = '0'.repeat(64); // Genesis hash anchor

  constructor(initialEntries?: readonly RecoveryJournalEntry[]) {
    if (initialEntries && initialEntries.length > 0) {
      for (const entry of initialEntries) {
        this.entries.push({ ...entry });
      }
      this.lastEntrySha256 = this.entries[this.entries.length - 1].entry_sha256;
      const integrity = this.verifyIntegrity();
      if (!integrity.isValid) {
        throw new Error(`E-ERR-024: CORRUPT_JOURNAL: Hash chain broken at sequence ${integrity.brokenSequence}`);
      }
    }
  }

  public appendEvent(
    eventType: RecoveryEventType,
    payload: unknown,
    timestamp_utc: string
  ): RecoveryJournalEntry {
    validateIso8601UtcTimestamp(timestamp_utc);

    const seq = this.entries.length + 1;
    const entryId = `rec:ent:${seq}`;
    const payloadJson = canonicalizeJCS(payload);
    const payloadSha256 = sha256(Buffer.from(payloadJson, 'utf8'));

    const rawHeader = {
      entry_id: entryId,
      event_type: eventType,
      payload_sha256: payloadSha256,
      prev_entry_sha256: this.lastEntrySha256,
      sequence_number: seq,
      timestamp_utc
    };

    const headerJson = canonicalizeJCS(rawHeader);
    const entrySha256 = sha256(Buffer.from(headerJson, 'utf8'));

    const entry: RecoveryJournalEntry = {
      entry_id: entryId,
      sequence_number: seq,
      timestamp_utc,
      event_type: eventType,
      payload: JSON.parse(payloadJson),
      payload_sha256: payloadSha256,
      prev_entry_sha256: this.lastEntrySha256,
      entry_sha256: entrySha256
    };

    this.entries.push(entry);
    this.lastEntrySha256 = entrySha256;
    return deepFreeze({ ...entry });
  }

  public getEntries(): readonly RecoveryJournalEntry[] {
    return deepFreeze(this.entries.map(e => ({ ...e })));
  }

  public getEntryCount(): number {
    return this.entries.length;
  }

  public verifyIntegrity(): { isValid: boolean; brokenSequence?: number } {
    let prevHash = '0'.repeat(64);
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (entry.sequence_number !== i + 1) {
        return { isValid: false, brokenSequence: i + 1 };
      }
      if (entry.prev_entry_sha256 !== prevHash) {
        return { isValid: false, brokenSequence: entry.sequence_number };
      }

      // Verify payload hash
      const payloadJson = canonicalizeJCS(entry.payload);
      const computedPayloadSha256 = sha256(Buffer.from(payloadJson, 'utf8'));
      if (computedPayloadSha256 !== entry.payload_sha256) {
        return { isValid: false, brokenSequence: entry.sequence_number };
      }

      // Verify entry header hash
      const rawHeader = {
        entry_id: entry.entry_id,
        event_type: entry.event_type,
        payload_sha256: entry.payload_sha256,
        prev_entry_sha256: entry.prev_entry_sha256,
        sequence_number: entry.sequence_number,
        timestamp_utc: entry.timestamp_utc
      };
      const headerJson = canonicalizeJCS(rawHeader);
      const computedEntrySha256 = sha256(Buffer.from(headerJson, 'utf8'));
      if (computedEntrySha256 !== entry.entry_sha256) {
        return { isValid: false, brokenSequence: entry.sequence_number };
      }

      prevHash = entry.entry_sha256;
    }
    return { isValid: true };
  }

  public exportJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  public static importJson(jsonStr: string): DurableRecoveryJournal {
    const parsed = JSON.parse(jsonStr) as RecoveryJournalEntry[];
    return new DurableRecoveryJournal(parsed);
  }
}

/**
 * Crash Recovery Engine
 * Reads durable recovery journal, reconciles orphaned fills against portfolio,
 * and recovers exactly-once state without missing or duplicate accounting.
 */
export class CrashRecoveryEngine {
  /**
   * Replays unapplied fills from durable journal into portfolio.
   * Detects pending fills that were durably recorded but lack a PORTFOLIO_APPLIED record.
   */
  public static recover(
    journal: DurableRecoveryJournal,
    portfolio: SimulationPortfolio,
    currentTimeUtc: string
  ): CrashRecoveryResult {
    validateIso8601UtcTimestamp(currentTimeUtc);

    const integrity = journal.verifyIntegrity();
    if (!integrity.isValid) {
      throw new Error(`E-ERR-024: CORRUPT_JOURNAL_ON_RECOVERY: Integrity check failed at sequence ${integrity.brokenSequence}`);
    }

    const entries = journal.getEntries();
    const recordedFills = new Map<string, { fill: SimulatedFillEvent; order: SimulatedOrderRecord }>();
    const appliedFillIds = new Set<string>();

    for (const entry of entries) {
      if (entry.event_type === 'FILL_RECORDED') {
        const { fill, order } = entry.payload as { fill: SimulatedFillEvent; order: SimulatedOrderRecord };
        recordedFills.set(fill.fill_id, { fill, order });
      } else if (entry.event_type === 'PORTFOLIO_APPLIED') {
        const { fill_id } = entry.payload as { fill_id: string };
        appliedFillIds.add(fill_id);
      }
    }

    let recoveredCount = 0;
    let skippedDuplicateCount = 0;

    for (const [fillId, { fill, order }] of recordedFills.entries()) {
      if (portfolio.isFillProcessed(fillId)) {
        skippedDuplicateCount++;
        continue;
      }

      // Replay fill into portfolio
      portfolio.processFill(fill, order, currentTimeUtc);
      recoveredCount++;

      // Append PORTFOLIO_APPLIED to seal recovery in journal
      journal.appendEvent('PORTFOLIO_APPLIED', {
        fill_id: fill.fill_id,
        order_id: fill.order_id,
        recovered: true
      }, currentTimeUtc);
    }

    return {
      recovered_fills_count: recoveredCount,
      skipped_duplicate_fills_count: skippedDuplicateCount,
      replayed_entries_count: entries.length,
      final_portfolio_snapshot: portfolio.getSnapshot(),
      recovery_completed_utc: currentTimeUtc
    };
  }
}
