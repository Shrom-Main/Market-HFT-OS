import fs from 'node:fs';
import path from 'node:path';
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
  PortfolioCheckpoint,
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
 * File-Backed Durable Recovery Journal
 * Appends entries to an NDJSON WAL file on disk with explicit fsync flush semantics.
 * Survives hard process termination and verifies tamper integrity across restart.
 */
export class FileBackedDurableRecoveryJournal extends DurableRecoveryJournal {
  private readonly filePath: string;
  private fileDescriptor: number | null = null;

  constructor(filePath: string) {
    let initialEntries: RecoveryJournalEntry[] = [];
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim().length > 0);
      for (const line of lines) {
        initialEntries.push(JSON.parse(line));
      }
    } else {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    super(initialEntries);
    this.filePath = filePath;
    this.fileDescriptor = fs.openSync(this.filePath, 'a+');
  }

  public override appendEvent(
    eventType: RecoveryEventType,
    payload: unknown,
    timestamp_utc: string
  ): RecoveryJournalEntry {
    const entry = super.appendEvent(eventType, payload, timestamp_utc);
    const line = JSON.stringify(entry) + '\n';
    if (this.fileDescriptor !== null) {
      fs.writeSync(this.fileDescriptor, line);
      fs.fsyncSync(this.fileDescriptor);
    }
    return entry;
  }

  public close(): void {
    if (this.fileDescriptor !== null) {
      fs.closeSync(this.fileDescriptor);
      this.fileDescriptor = null;
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }
}

/**
 * Durable Portfolio Checkpoint Store
 * Persists and restores SimulationPortfolio state to/from disk atomically.
 */
export class DurablePortfolioCheckpointStore {
  public static saveCheckpoint(checkpointPath: string, portfolio: SimulationPortfolio): void {
    const dir = path.dirname(checkpointPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const checkpoint = portfolio.exportCheckpoint();
    const jsonStr = canonicalizeJCS(checkpoint);
    const tmpPath = `${checkpointPath}.tmp.${Date.now()}`;
    const fd = fs.openSync(tmpPath, 'w');
    fs.writeSync(fd, jsonStr);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmpPath, checkpointPath);
  }

  public static loadCheckpoint(checkpointPath: string): SimulationPortfolio {
    if (!fs.existsSync(checkpointPath)) {
      throw new Error(`E-ERR-024: CHECKPOINT_NOT_FOUND: Checkpoint file not found at ${checkpointPath}`);
    }
    const content = fs.readFileSync(checkpointPath, 'utf8');
    const checkpoint = JSON.parse(content) as PortfolioCheckpoint;
    return SimulationPortfolio.restoreFromCheckpoint(checkpoint);
  }
}

export interface DurableCrashRecoveryResult {
  recovered_fills_count: number;
  reconciled_unmarked_fills_count: number;
  skipped_duplicate_fills_count: number;
  replayed_entries_count: number;
  final_portfolio_snapshot: PortfolioSnapshot;
  recovery_completed_utc: string;
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

  /**
   * Reconciles durable journal and durable portfolio state across process restart.
   * Adheres strictly to the Gate M3 failure boundary contract:
   * 1. Fill recorded, portfolio not updated => Replay fill exactly once, append PORTFOLIO_APPLIED marker
   * 2. Portfolio updated, marker not recorded => Reconcile without applying economic effect twice, append PORTFOLIO_APPLIED marker
   * 3. Marker recorded, state restoration incomplete => Replay fill if payload present; if missing, fail closed with E-ERR-047
   * 4. Same fill ID, altered content => Reject with E-ERR-046: FILL_IDEMPOTENCY_CONFLICT
   * 5. Journal integrity failure => Reject fail closed with E-ERR-024: CORRUPT_JOURNAL_ON_RECOVERY
   */
  public static recoverDurable(
    journal: DurableRecoveryJournal,
    portfolio: SimulationPortfolio,
    currentTimeUtc: string
  ): DurableCrashRecoveryResult {
    validateIso8601UtcTimestamp(currentTimeUtc);

    // 5. Journal integrity check
    const integrity = journal.verifyIntegrity();
    if (!integrity.isValid) {
      throw new Error(`E-ERR-024: CORRUPT_JOURNAL_ON_RECOVERY: Integrity check failed at sequence ${integrity.brokenSequence}`);
    }

    const entries = journal.getEntries();
    const recordedFills = new Map<string, { fill: SimulatedFillEvent; order: SimulatedOrderRecord; fingerprint: string }>();
    const appliedFillIds = new Set<string>();

    for (const entry of entries) {
      if (entry.event_type === 'FILL_RECORDED') {
        const { fill, order } = entry.payload as { fill: SimulatedFillEvent; order: SimulatedOrderRecord };
        const fp = computeFillFingerprint(fill, order);
        const existing = recordedFills.get(fill.fill_id);
        if (existing && existing.fingerprint !== fp) {
          // 4. Same fill ID, altered content in journal entries
          throw new Error(
            `E-ERR-046: FILL_IDEMPOTENCY_CONFLICT: Conflicting journal entries recorded for fill ID '${fill.fill_id}'`
          );
        }
        recordedFills.set(fill.fill_id, { fill, order, fingerprint: fp });
      } else if (entry.event_type === 'PORTFOLIO_APPLIED') {
        const { fill_id } = entry.payload as { fill_id: string };
        appliedFillIds.add(fill_id);
      }
    }

    let recoveredCount = 0;
    let reconciledUnmarkedCount = 0;
    let skippedDuplicateCount = 0;

    // Check boundary 3: Marker recorded, state restoration incomplete
    for (const appliedFillId of appliedFillIds) {
      if (!portfolio.isFillProcessed(appliedFillId)) {
        const rec = recordedFills.get(appliedFillId);
        if (!rec) {
          throw new Error(
            `E-ERR-047: RECOVERY_STATE_INCONSISTENCY: PORTFOLIO_APPLIED marker recorded for '${appliedFillId}' but fill payload is missing from journal`
          );
        }
        // Incomplete state restoration: replay the recorded fill to bring portfolio up to state
        portfolio.processFill(rec.fill, rec.order, currentTimeUtc);
        recoveredCount++;
      }
    }

    // Process all recorded fills
    for (const [fillId, { fill, order, fingerprint }] of recordedFills.entries()) {
      const isAppliedInJournal = appliedFillIds.has(fillId);
      const isProcessedInPortfolio = portfolio.isFillProcessed(fillId);

      if (isProcessedInPortfolio) {
        // Verify fingerprint matches
        const existingFp = portfolio.getFillFingerprint(fillId);
        if (existingFp && existingFp !== fingerprint) {
          // 4. Same fill ID, altered content
          throw new Error(
            `E-ERR-046: FILL_IDEMPOTENCY_CONFLICT: Fill '${fillId}' in journal conflicts with portfolio fingerprint`
          );
        }

        if (!isAppliedInJournal) {
          // 2. Portfolio updated, marker not recorded => Reconcile without applying economic effect twice
          journal.appendEvent('PORTFOLIO_APPLIED', {
            fill_id: fill.fill_id,
            order_id: fill.order_id,
            reconciled_unmarked: true
          }, currentTimeUtc);
          reconciledUnmarkedCount++;
        } else {
          skippedDuplicateCount++;
        }
      } else {
        // 1. Fill recorded, portfolio not updated => Replay fill exactly once
        portfolio.processFill(fill, order, currentTimeUtc);
        recoveredCount++;

        journal.appendEvent('PORTFOLIO_APPLIED', {
          fill_id: fill.fill_id,
          order_id: fill.order_id,
          recovered: true
        }, currentTimeUtc);
      }
    }

    return {
      recovered_fills_count: recoveredCount,
      reconciled_unmarked_fills_count: reconciledUnmarkedCount,
      skipped_duplicate_fills_count: skippedDuplicateCount,
      replayed_entries_count: entries.length,
      final_portfolio_snapshot: portfolio.getSnapshot(),
      recovery_completed_utc: currentTimeUtc
    };
  }
}
