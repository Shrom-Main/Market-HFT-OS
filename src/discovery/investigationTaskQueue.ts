/**
 * POC-001: Stage 0 Discovery — Fenced Investigation Task Queue (Slice 2C)
 *
 * Implements a durable, concurrency-bounded, fenced investigation task queue
 * following the normative architecture specification in DEC-030.
 *
 * Invariants Enforced:
 * 1. Global & Per-Candidate Concurrency Ceilings:
 *    - Max 4 global active leases across the entire platform.
 *    - Max 2 active leases per candidate.
 * 2. Monotonic Lease Fencing & Stale Commit Rejection:
 *    - Every lease assignment generates a strictly incrementing fencing token.
 *    - Expired or superseded workers attempting completion fail closed with
 *      E-QUEUE-STALE-LEASE-FENCE-REJECTED or E-QUEUE-LEASE-EXPIRED-AT-COMMIT.
 *    - Newer worker leases are strictly immune to being overwritten by zombie workers.
 * 3. Bounded Retries & Terminal Dead-Letter Quarantine:
 *    - Max 3 execution attempts per task.
 *    - 3 consecutive failures transition the task to DEAD_LETTER_QUARANTINE.
 * 4. Idempotent Replay Protocol:
 *    - Replaying identical completion parameters on an already-succeeded task
 *      returns IDEMPOTENT_REPLAY_ACK without duplicate execution.
 *    - Conflicting parameters throw E-QUEUE-COMMIT-ENVELOPE-MISMATCH.
 * 5. Anti-Scaffolding Law:
 *    - The task queue operates strictly on investigation tasks and observation results.
 *    - It has zero authority to promote candidates to PAPER_ELIGIBLE or mutate capital ledgers.
 */

import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import {
  InvestigationTask,
  InvestigationAgentRole,
  InvestigationTaskType,
  TaskState
} from './investigationPlanner.js';

export const MAX_GLOBAL_CONCURRENT_LEASES = 4;
export const MAX_PER_CANDIDATE_CONCURRENT_LEASES = 2;
export const DEFAULT_LEASE_DURATION_MS = 30_000; // 30 seconds
export const MAX_TASK_ATTEMPTS = 3;

export interface InvestigationTaskRecord {
  readonly task_id: string;
  readonly candidate_id: string;
  readonly generation_id: string;
  readonly task_type: InvestigationTaskType;
  readonly target_role: InvestigationAgentRole;
  readonly target_field: string;
  readonly priority: number;
  readonly description: string;
  readonly payload: Record<string, unknown>;
  state: TaskState;
  attempts: number;
  fencing_token: number;
  lease_owner_id: string | null;
  leased_until_utc: string | null;
  result_payload_sha256?: string;
  result_envelope?: Record<string, unknown>;
  committed_envelope_json?: string;
  last_error_message?: string;
  readonly created_at_utc: string;
  updated_at_utc: string;
  completed_at_utc?: string;
}

export interface CommitTaskParams {
  readonly task_id: string;
  readonly candidate_id: string;
  readonly generation_id: string;
  readonly task_type: InvestigationTaskType;
  readonly lease_owner_id: string;
  readonly fencing_token: number;
  readonly result_payload: Record<string, unknown>;
  readonly observation?: {
    readonly observation_id: string;
    readonly target_field: string;
    readonly extracted_subunits?: string;
  };
}

export interface CommitResult {
  readonly status: 'COMMITTED' | 'IDEMPOTENT_REPLAY_ACK';
  readonly task_id: string;
  readonly result_payload_sha256: string;
}

export class InvestigationTaskQueue {
  private readonly tasks: Map<string, InvestigationTaskRecord> = new Map();

  /**
   * Enqueues tasks into the durable queue.
   * Duplicate task IDs are safely ignored (idempotent submission).
   */
  public async enqueueTasks(tasks: readonly InvestigationTask[]): Promise<number> {
    let enqueuedCount = 0;
    const nowUtc = new Date().toISOString();

    for (const t of tasks) {
      if (!this.tasks.has(t.task_id)) {
        const record: InvestigationTaskRecord = {
          task_id: t.task_id,
          candidate_id: t.candidate_id,
          generation_id: t.generation_id,
          task_type: t.task_type,
          target_role: t.target_role,
          target_field: t.target_field,
          priority: t.priority,
          description: t.description,
          payload: { ...t.payload },
          state: 'QUEUED',
          attempts: 0,
          fencing_token: 0,
          lease_owner_id: null,
          leased_until_utc: null,
          created_at_utc: t.created_at_utc || nowUtc,
          updated_at_utc: nowUtc
        };
        this.tasks.set(t.task_id, record);
        enqueuedCount++;
      }
    }

    return enqueuedCount;
  }

  /**
   * Returns current active lease counts across the platform and per-candidate.
   * Only unexpired leases in 'LEASED' state are counted.
   */
  public getActiveLeaseCounts(nowMs: number = Date.now()): {
    globalActive: number;
    perCandidateActive: Map<string, number>;
  } {
    let globalActive = 0;
    const perCandidateActive = new Map<string, number>();

    for (const task of this.tasks.values()) {
      if (task.state === 'LEASED' && task.leased_until_utc) {
        const expiryMs = new Date(task.leased_until_utc).getTime();
        if (expiryMs > nowMs) {
          globalActive++;
          const currentCand = perCandidateActive.get(task.candidate_id) ?? 0;
          perCandidateActive.set(task.candidate_id, currentCand + 1);
        }
      }
    }

    return { globalActive, perCandidateActive };
  }

  /**
   * Claims the next available task for execution by a worker.
   * Enforces global and per-candidate concurrency ceilings, increments fencing token,
   * and binds the task to the worker lease.
   */
  public async claimNextTask(
    workerId: string,
    options: {
      candidateId?: string;
      targetRole?: InvestigationAgentRole;
      leaseDurationMs?: number;
    } = {}
  ): Promise<InvestigationTaskRecord | null> {
    if (!workerId || workerId.trim().length === 0) {
      throw new Error('E-QUEUE-INVALID-WORKER-ID: Worker ID must be a non-empty string');
    }

    const nowMs = Date.now();
    const leaseDuration = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;

    // First, sweep any expired leases to ensure fresh state
    this.sweepExpiredLeases(nowMs);

    // 1. Verify global concurrency ceiling (max 4 active leases)
    const { globalActive, perCandidateActive } = this.getActiveLeaseCounts(nowMs);
    if (globalActive >= MAX_GLOBAL_CONCURRENT_LEASES) {
      throw new Error(
        `E-QUEUE-GLOBAL-CONCURRENCY-LIMIT: Global active lease limit (${MAX_GLOBAL_CONCURRENT_LEASES}) reached. Currently active: ${globalActive}`
      );
    }

    // 2. Filter candidate tasks in QUEUED state, sorted by priority (1 = highest first)
    const eligibleTasks = Array.from(this.tasks.values())
      .filter((t) => t.state === 'QUEUED')
      .filter((t) => (options.candidateId ? t.candidate_id === options.candidateId : true))
      .filter((t) => (options.targetRole ? t.target_role === options.targetRole : true))
      .sort((a, b) => a.priority - b.priority);

    for (const task of eligibleTasks) {
      // 3. Verify per-candidate concurrency ceiling (max 2 active leases per candidate)
      const candActive = perCandidateActive.get(task.candidate_id) ?? 0;
      if (candActive >= MAX_PER_CANDIDATE_CONCURRENT_LEASES) {
        if (options.candidateId) {
          throw new Error(
            `E-QUEUE-CANDIDATE-CONCURRENCY-LIMIT: Per-candidate active lease limit (${MAX_PER_CANDIDATE_CONCURRENT_LEASES}) reached for candidate '${task.candidate_id}'. Currently active: ${candActive}`
          );
        }
        // If not filtering by a specific candidate, skip to next eligible candidate task
        continue;
      }

      // 4. Check terminal dead-letter quarantine barrier
      if (task.attempts >= MAX_TASK_ATTEMPTS) {
        task.state = 'DEAD_LETTER_QUARANTINE';
        task.updated_at_utc = new Date(nowMs).toISOString();
        continue;
      }

      // 5. Grant lease: atomically increment fence token, assign worker, set expiry
      task.fencing_token += 1;
      task.attempts += 1;
      task.state = 'LEASED';
      task.lease_owner_id = workerId;
      task.leased_until_utc = new Date(nowMs + leaseDuration).toISOString();
      task.updated_at_utc = new Date(nowMs).toISOString();

      return { ...task };
    }

    return null;
  }

  /**
   * Commits task execution result under atomic lease fencing rules.
   * Rejects stale fencing tokens, expired leases, or mismatched owners.
   * Supports idempotent completion replay.
   */
  public async commitTaskResult(params: CommitTaskParams): Promise<CommitResult> {
    const task = this.tasks.get(params.task_id);
    if (!task) {
      throw new Error(`E-QUEUE-TASK-NOT-FOUND: Task '${params.task_id}' does not exist in queue`);
    }

    const payloadSha256 = sha256(canonicalizeJCS(params.result_payload));
    const nowMs = Date.now();

    // =========================================================================
    // BRANCH 1: ALREADY SUCCEEDED (IDEMPOTENT REPLAY PATH)
    // Handled BEFORE checking lease expiry or generation!
    // Survives lease expiration and candidate generation supersession.
    // =========================================================================
    if (task.state === 'SUCCEEDED') {
      if (!task.committed_envelope_json) {
        throw new Error(
          `E-QUEUE-INCONSISTENT-STATE: Task '${params.task_id}' marked SUCCEEDED but missing committed envelope`
        );
      }

      const stored = JSON.parse(task.committed_envelope_json);
      const matchesAllFields =
        params.task_id === stored.task_id &&
        params.candidate_id === stored.candidate_id &&
        params.generation_id === stored.generation_id &&
        params.task_type === stored.task_type &&
        params.lease_owner_id === stored.lease_owner_id &&
        params.fencing_token === stored.fencing_token &&
        payloadSha256 === stored.result_payload_sha256;

      if (matchesAllFields) {
        return {
          status: 'IDEMPOTENT_REPLAY_ACK',
          task_id: task.task_id,
          result_payload_sha256: payloadSha256
        };
      }

      throw new Error(
        `E-QUEUE-COMMIT-ENVELOPE-MISMATCH: Task '${params.task_id}' was completed under differing parameters`
      );
    }

    // =========================================================================
    // BRANCH 2: FIRST COMMIT PATH (REQUIRES ACTIVE UNEXPIRED FENCE)
    // =========================================================================
    if (
      task.state !== 'LEASED' ||
      task.lease_owner_id !== params.lease_owner_id ||
      task.fencing_token !== params.fencing_token
    ) {
      throw new Error(
        `E-QUEUE-STALE-LEASE-FENCE-REJECTED: Worker '${params.lease_owner_id}' with fence token ${params.fencing_token} does not hold active fence on task '${params.task_id}' (current owner: '${task.lease_owner_id}', token: ${task.fencing_token}, state: '${task.state}')`
      );
    }

    // Strict future wall-clock expiration check
    if (!task.leased_until_utc || new Date(task.leased_until_utc).getTime() <= nowMs) {
      throw new Error(
        `E-QUEUE-LEASE-EXPIRED-AT-COMMIT: Lease on task '${params.task_id}' expired at ${task.leased_until_utc} (current time: ${new Date(nowMs).toISOString()})`
      );
    }

    // Construct Canonical Committed Envelope
    const committedEnvelope = {
      task_id: params.task_id,
      candidate_id: params.candidate_id,
      generation_id: params.generation_id,
      task_type: params.task_type,
      lease_owner_id: params.lease_owner_id,
      fencing_token: params.fencing_token,
      result_payload_sha256: payloadSha256,
      observation_id: params.observation?.observation_id ?? `OBS-${params.task_id}`
    };

    // Transition task atomically to terminal SUCCEEDED
    task.state = 'SUCCEEDED';
    task.result_payload_sha256 = payloadSha256;
    task.result_envelope = { ...params.result_payload };
    task.committed_envelope_json = JSON.stringify(committedEnvelope);
    task.completed_at_utc = new Date(nowMs).toISOString();
    task.updated_at_utc = new Date(nowMs).toISOString();

    return {
      status: 'COMMITTED',
      task_id: task.task_id,
      result_payload_sha256: payloadSha256
    };
  }

  /**
   * Records a task execution failure.
   * If attempts >= 3, transitions atomically to DEAD_LETTER_QUARANTINE.
   * Otherwise transitions to RETRYING for subsequent backoff sweep.
   */
  public async recordTaskFailure(params: {
    task_id: string;
    lease_owner_id: string;
    fencing_token: number;
    error_message: string;
  }): Promise<{ state: TaskState; attempts: number }> {
    const task = this.tasks.get(params.task_id);
    if (!task) {
      throw new Error(`E-QUEUE-TASK-NOT-FOUND: Task '${params.task_id}' does not exist in queue`);
    }

    if (
      task.state !== 'LEASED' ||
      task.lease_owner_id !== params.lease_owner_id ||
      task.fencing_token !== params.fencing_token
    ) {
      throw new Error(
        `E-QUEUE-STALE-LEASE-FENCE-REJECTED: Worker '${params.lease_owner_id}' with fence token ${params.fencing_token} does not hold active fence on task '${params.task_id}'`
      );
    }

    const nowUtc = new Date().toISOString();
    task.last_error_message = params.error_message;
    task.updated_at_utc = nowUtc;

    // Terminal Dead-Letter Quarantine after MAX_TASK_ATTEMPTS (3)
    if (task.attempts >= MAX_TASK_ATTEMPTS) {
      task.state = 'DEAD_LETTER_QUARANTINE';
      task.lease_owner_id = null;
      task.leased_until_utc = null;
      return { state: 'DEAD_LETTER_QUARANTINE', attempts: task.attempts };
    }

    // Otherwise transition to RETRYING
    task.state = 'RETRYING';
    task.lease_owner_id = null;
    task.leased_until_utc = null;
    return { state: 'RETRYING', attempts: task.attempts };
  }

  /**
   * Sweeper pass: recovers expired leases and resets RETRYING tasks to QUEUED.
   * If an expired lease has reached MAX_TASK_ATTEMPTS, escalates to DEAD_LETTER_QUARANTINE.
   */
  public sweepExpiredLeases(nowMs: number = Date.now()): {
    sweptToQueued: number;
    movedToDlq: number;
  } {
    let sweptToQueued = 0;
    let movedToDlq = 0;
    const nowUtc = new Date(nowMs).toISOString();

    for (const task of this.tasks.values()) {
      // 1. Recover expired LEASED tasks
      if (task.state === 'LEASED' && task.leased_until_utc) {
        const expiryMs = new Date(task.leased_until_utc).getTime();
        if (expiryMs <= nowMs) {
          if (task.attempts >= MAX_TASK_ATTEMPTS) {
            task.state = 'DEAD_LETTER_QUARANTINE';
            task.lease_owner_id = null;
            task.leased_until_utc = null;
            task.updated_at_utc = nowUtc;
            movedToDlq++;
          } else {
            task.state = 'QUEUED';
            task.lease_owner_id = null;
            task.leased_until_utc = null;
            task.updated_at_utc = nowUtc;
            sweptToQueued++;
          }
        }
      }

      // 2. Recover RETRYING tasks back to QUEUED
      if (task.state === 'RETRYING') {
        task.state = 'QUEUED';
        task.updated_at_utc = nowUtc;
        sweptToQueued++;
      }
    }

    return { sweptToQueued, movedToDlq };
  }

  /**
   * Returns a task record by ID.
   */
  public async getTask(taskId: string): Promise<InvestigationTaskRecord | null> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  /**
   * Lists all tasks for a specific candidate.
   */
  public async listTasksForCandidate(candidateId: string): Promise<InvestigationTaskRecord[]> {
    return Array.from(this.tasks.values())
      .filter((t) => t.candidate_id === candidateId)
      .map((t) => ({ ...t }));
  }

  /**
   * Returns queue size.
   */
  public size(): number {
    return this.tasks.size;
  }
}
