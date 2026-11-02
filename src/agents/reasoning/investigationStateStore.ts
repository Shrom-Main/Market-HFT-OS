/**
/**
 * POC-001: Persistent Investigation State Store
 *
 * Implements disk-backed, append-only checkpointing for interrupted investigations.
 * Enables zero-data-loss resumption after process crashes or worker restarts:
 * 1. Monotonic Fencing: Every checkpoint increments fencing_token; stale workers cannot
 *    corrupt or overwrite newer state checkpoints.
 * 2. Complete State Serialization: Checkpoints capture objective, plan version, step states,
 *    evidence ledger, conflicts, specialist artifacts, and resource consumption.
 * 3. Fast Rehydration: Deserializes the latest valid checkpoint for any investigation_id.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CheckpointableInvestigationState } from './reasoningTypes.js';

export interface StateStoreOptions {
  readonly checkpointFilePath?: string;
}

export class InvestigationStateStore {
  private readonly filePath: string;
  private readonly memoryCache: Map<string, CheckpointableInvestigationState> = new Map();

  constructor(options?: StateStoreOptions) {
    this.filePath =
      options?.checkpointFilePath ??
      path.join(process.cwd(), 'scratch', 'investigation_checkpoints.jsonl');

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.rehydrateFromDisk();
  }

  /**
   * Persists an updated state checkpoint to disk and memory cache.
   * Increments the state's fencing_token monotonically.
   */
  public async saveCheckpoint(
    state: CheckpointableInvestigationState
  ): Promise<CheckpointableInvestigationState> {
    const existing = this.memoryCache.get(state.investigation_id);

    if (existing && state.fencing_token > 0 && existing.fencing_token > state.fencing_token) {
      throw new Error(
        `E-AGENT-STALE-CHECKPOINT-FENCE: Cannot overwrite investigation '${state.investigation_id}' token ${existing.fencing_token} with stale token ${state.fencing_token}`
      );
    }

    state.fencing_token = (state.fencing_token ?? 0) + 1;
    state.updated_at_utc = new Date().toISOString();

    const serialized = JSON.stringify(state);
    fs.appendFileSync(this.filePath, serialized + '\n', 'utf8');

    // Store a deep clone in memory
    const cloned = JSON.parse(serialized) as CheckpointableInvestigationState;
    this.memoryCache.set(state.investigation_id, cloned);

    return cloned;
  }

  /**
   * Loads the most recent checkpoint for an investigation.
   */
  public loadCheckpoint(investigationId: string): CheckpointableInvestigationState | null {
    const cached = this.memoryCache.get(investigationId);
    if (!cached) return null;
    return JSON.parse(JSON.stringify(cached)) as CheckpointableInvestigationState;
  }

  /**
   * Rehydrates all checkpoints from the disk journal into memory cache.
   */
  public rehydrateFromDisk(): number {
    if (!fs.existsSync(this.filePath)) return 0;

    const content = fs.readFileSync(this.filePath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);

    let rehydratedCount = 0;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as CheckpointableInvestigationState;
        const current = this.memoryCache.get(parsed.investigation_id);

        if (!current || parsed.fencing_token >= current.fencing_token) {
          this.memoryCache.set(parsed.investigation_id, parsed);
          rehydratedCount++;
        }
      } catch {
        // Skip corrupted lines
      }
    }

    return rehydratedCount;
  }

  public getAllActiveInvestigations(): CheckpointableInvestigationState[] {
    return Array.from(this.memoryCache.values());
  }
}
