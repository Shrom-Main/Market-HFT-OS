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
  protected entries: RecoveryJournalEntry[] = [];
  protected lastEntrySha256: string = '0'.repeat(64); // Genesis hash anchor

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

  public getLastEntrySha256(): string {
    return this.lastEntrySha256;
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

export type TornTailPolicy = 'TRUNCATE_TORN_TAIL' | 'FAIL_CLOSED';

export interface FileBackedJournalOptions {
  filePath: string;
  tornTailPolicy?: TornTailPolicy;
}

/**
 * Hardened File-Backed Durable Recovery Journal
 * - Appends entries to an NDJSON WAL file on disk with synchronous fsync flush semantics.
 * - Prevents live state divergence: in-memory state only advances AFTER disk write & fsync succeed.
 * - Live State Poisoning: any write or fsync failure immediately poisons the live journal fail-closed.
 * - Torn-Tail Recovery Policy: recovers unacknowledged trailing partial writes upon startup while
 *   strictly rejecting any mid-log corruption/tampering fail-closed.
 */
export class FileBackedDurableRecoveryJournal extends DurableRecoveryJournal {
  private readonly filePath: string;
  private readonly tornTailPolicy: TornTailPolicy;
  private fileDescriptor: number | null = null;
  private isPoisoned: boolean = false;
  private poisonError: string | null = null;
  private needsNormalization: boolean = false;

  constructor(optionsOrPath: string | FileBackedJournalOptions) {
    const options: FileBackedJournalOptions =
      typeof optionsOrPath === 'string'
        ? { filePath: optionsOrPath, tornTailPolicy: 'TRUNCATE_TORN_TAIL' }
        : { tornTailPolicy: 'TRUNCATE_TORN_TAIL', ...optionsOrPath };

    const filePath = options.filePath;
    const tornTailPolicy = options.tornTailPolicy ?? 'TRUNCATE_TORN_TAIL';

    let initialEntries: RecoveryJournalEntry[] = [];
    let needsNormalization = false;

    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      const endsWithNewline = fileBuffer.length === 0 || fileBuffer[fileBuffer.length - 1] === 0x0a;
      const content = fileBuffer.toString('utf8');
      const lines = content.split('\n');
      let validBytesLength = 0;
      let encounteredTornTail = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isTerminalLine = i === lines.length - 1;

        if (isTerminalLine && line.trim().length === 0) {
          continue; // Normal trailing blank line after final newline
        }
        if (line.trim().length === 0) continue;

        try {
          const parsed = JSON.parse(line) as RecoveryJournalEntry;
          initialEntries.push(parsed);

          // Byte accounting: if this is the final line and the physical file didn't end with a newline,
          // on-disk bytes for this record do not include a trailing delimiter.
          if (isTerminalLine && !endsWithNewline) {
            validBytesLength += Buffer.byteLength(line, 'utf8');
            needsNormalization = true;
          } else {
            validBytesLength += Buffer.byteLength(line, 'utf8') + 1; // line + \n
          }
        } catch (err: any) {
          const isLastNonEmptyLine =
            i === lines.length - 1 ||
            (i === lines.length - 2 && lines[lines.length - 1].trim().length === 0);

          if (isLastNonEmptyLine && tornTailPolicy === 'TRUNCATE_TORN_TAIL') {
            encounteredTornTail = true;
            needsNormalization = false;
            break;
          } else {
            throw new Error(`E-ERR-024: CORRUPT_JOURNAL: Malformed line at index ${i + 1}: ${err.message}`);
          }
        }
      }

      if (encounteredTornTail) {
        // Truncate file on disk to valid acknowledged bytes
        const fd = fs.openSync(filePath, 'r+');
        try {
          fs.ftruncateSync(fd, validBytesLength);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
    } else {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    super(initialEntries);
    this.filePath = filePath;
    this.tornTailPolicy = tornTailPolicy;
    this.needsNormalization = needsNormalization;
    this.fileDescriptor = fs.openSync(this.filePath, 'a+');

    if (this.needsNormalization) {
      try {
        this.normalizeTrailingNewline();
      } catch (err: any) {
        this.isPoisoned = true;
        this.poisonError = err.message || String(err);
      }
    }
  }

  private normalizeTrailingNewline(): void {
    if (!this.needsNormalization || this.fileDescriptor === null) return;
    try {
      const newlineBuf = Buffer.from('\n', 'utf8');
      let bytesWritten = 0;
      while (bytesWritten < newlineBuf.length) {
        const written = fs.writeSync(
          this.fileDescriptor,
          newlineBuf,
          bytesWritten,
          newlineBuf.length - bytesWritten
        );
        if (written <= 0) {
          throw new Error(`Short write while normalizing unterminated WAL record: ${written} bytes written`);
        }
        bytesWritten += written;
      }
      fs.fsyncSync(this.fileDescriptor);
      this.needsNormalization = false;
    } catch (err: any) {
      this.isPoisoned = true;
      this.poisonError = err.message || String(err);
      this.close();
      throw new Error(`E-ERR-024: WAL_FSYNC_FAILED: Normalization disk flush failed: ${this.poisonError}`);
    }
  }

  public override appendEvent(
    eventType: RecoveryEventType,
    payload: unknown,
    timestamp_utc: string
  ): RecoveryJournalEntry {
    if (this.isPoisoned) {
      throw new Error(
        `E-ERR-024: JOURNAL_POISONED: Live journal is poisoned following previous disk flush/write failure: ${this.poisonError}`
      );
    }

    if (this.needsNormalization) {
      this.normalizeTrailingNewline();
    }

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

    const line = JSON.stringify(entry) + '\n';

    // 1. Attempt physical disk write and fsync FIRST
    try {
      if (this.fileDescriptor === null) {
        throw new Error('File descriptor is closed');
      }
      const recordBuffer = Buffer.from(line, 'utf8');
      let bytesWritten = 0;
      while (bytesWritten < recordBuffer.length) {
        const written = fs.writeSync(
          this.fileDescriptor,
          recordBuffer,
          bytesWritten,
          recordBuffer.length - bytesWritten
        );
        if (written <= 0) {
          throw new Error(`Short write while appending WAL record: ${written} bytes written`);
        }
        bytesWritten += written;
      }
      fs.fsyncSync(this.fileDescriptor);
    } catch (err: any) {
      // Disk flush failure: poison live journal immediately, in-memory state NEVER advances!
      this.isPoisoned = true;
      this.poisonError = err.message || String(err);
      this.close();
      throw new Error(`E-ERR-024: WAL_FSYNC_FAILED: Disk flush failed for sequence ${seq}: ${this.poisonError}`);
    }

    // 2. Commit to in-memory state ONLY AFTER disk write and fsync succeed
    this.entries.push(entry);
    this.lastEntrySha256 = entrySha256;
    return deepFreeze({ ...entry });
  }

  public getIsPoisoned(): boolean {
    return this.isPoisoned;
  }

  public close(): void {
    if (this.fileDescriptor !== null) {
      try {
        fs.closeSync(this.fileDescriptor);
      } catch {}
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
 * Flushes temporary file, renames atomically, and attempts directory barrier flush where platform-supported.
 */
export class DurablePortfolioCheckpointStore {
  public static saveCheckpoint(checkpointPath: string, portfolio: SimulationPortfolio): void {
    const dir = path.dirname(checkpointPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const checkpoint = portfolio.exportCheckpoint();
    const jsonStr = canonicalizeJCS(checkpoint);
    const tmpPath = `${checkpointPath}.tmp.${Date.now()}.${process.pid}`;
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(fd, jsonStr);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, checkpointPath);

    // Attempt parent directory fsync where supported
    try {
      const dirFd = fs.openSync(dir, 'r');
      fs.fsyncSync(dirFd);
      fs.closeSync(dirFd);
    } catch {
      // Ignored where directory file descriptors are restricted (e.g. Win32 non-backup semantics)
    }
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
        const fillTime = (rec.fill as any).fill_timestamp_utc || (rec.fill as any).timestamp_utc || currentTimeUtc;
        portfolio.processFill(rec.fill, rec.order, fillTime);
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
        const fillTime = (fill as any).fill_timestamp_utc || (fill as any).timestamp_utc || currentTimeUtc;
        portfolio.processFill(fill, order, fillTime);
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
