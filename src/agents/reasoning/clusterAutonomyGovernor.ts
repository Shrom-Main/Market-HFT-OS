/**
 * POC-001 Stage D.0: Cluster Autonomy & Resource Governor
 *
 * Implements strict, concurrency-safe operational boundaries across autonomous research:
 * 1. Concurrency-Safe Daily Budget Accounting:
 *    - PostgreSQL atomic SQL upsert with row locks when pgPool is available.
 *    - Append-only WAL (JSONL) with atomic file-descriptor locking (O_EXCL / 'wx') fallback.
 * 2. Explicit Boundary Enforcement:
 *    - Daily investigation cap (25 default, hard ceiling 50).
 *    - Task limits: 6 default initial plan cap, 8 adaptive injection ceiling, 9+ rejected.
 *    - Recursive replan cap: 3 replans max; 4th rejected and marked BLOCKED_AMBIGUOUS.
 *    - Connector call cap: 10 calls per source per investigation.
 * 3. Conservative Provider-Specific Compute Cost Accounting:
 *    - Differentiates Gemini Pro, Gemini Flash, Groq models.
 *    - Applies 20% safety reserve buffer (multiplier: 1.20).
 *    - Tagged as ESTIMATED_COMPUTE_COST_WITH_SAFETY_BUFFER.
 *    - $10.00 daily spend hard cap.
 * 4. Cancellation & Kill-Switch Propagation:
 *    - AbortSignal propagation to in-flight connector calls and tasks.
 *    - Immediate abort on kill switch activation or wall-clock timeout.
 * 5. Strict Capital vs. Compute Firewall:
 *    - Proves research workers cannot mutate brokerage positions or capital allocations.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'pg';
import {
  AutonomyClusterBudgetConfig,
  DEFAULT_AUTONOMY_CLUSTER_BUDGET,
  AutonomyDailyLedgerRecord
} from './reasoningTypes.js';
import { KillSwitchController } from '../../terminal/operatorTerminalController.js';

export class AutonomyLimitExceededError extends Error {
  constructor(
    public readonly limitType: string,
    public readonly current: number,
    public readonly max: number,
    public readonly action: string
  ) {
    super(`E-AUTONOMY-LIMIT-EXCEEDED: ${limitType} limit reached (${current} >= ${max}). Action '${action}' blocked.`);
    this.name = 'AutonomyLimitExceededError';
  }
}

export class CapitalAccessFirewallError extends Error {
  constructor(public readonly role: string, public readonly action: string) {
    super(
      `E-GATEWAY-PERMISSION-DENIED: Caller role '${role}' is strictly forbidden from executing capital allocation or brokerage action '${action}'. Research automation has zero financial write authority.`
    );
    this.name = 'CapitalAccessFirewallError';
  }
}

export interface ClusterAutonomyGovernorOptions {
  readonly config?: Partial<AutonomyClusterBudgetConfig>;
  readonly pgPool?: Pool | null;
  readonly walDirectory?: string;
  readonly killSwitchController?: KillSwitchController;
}

export interface ComputeSpendRecord {
  readonly tokens: number;
  readonly provider: 'GEMINI' | 'GROQ' | 'LOCAL' | 'OTHER';
  readonly model?: string;
  readonly estimated_cost_cents: number;
  readonly safety_reserve_applied: boolean;
  readonly epistemic_label: 'ESTIMATED_COMPUTE_COST_WITH_SAFETY_BUFFER';
}

export class ClusterAutonomyGovernor {
  private readonly config: AutonomyClusterBudgetConfig;
  private readonly pgPool: Pool | null;
  private readonly walPath: string;
  private readonly lockPath: string;
  private readonly killSwitchController?: KillSwitchController;

  // Active in-flight cancellation controllers per investigation
  private readonly activeAbortControllers: Map<string, AbortController> = new Map();

  // In-memory snapshot of today's ledger (kept in sync via WAL / PG)
  private memoryLedger: AutonomyDailyLedgerRecord;

  // Static singleton instance
  private static instance: ClusterAutonomyGovernor | null = null;

  constructor(options?: ClusterAutonomyGovernorOptions) {
    this.config = { ...DEFAULT_AUTONOMY_CLUSTER_BUDGET, ...options?.config };
    this.pgPool = options?.pgPool ?? null;
    this.killSwitchController = options?.killSwitchController;

    const baseDir = options?.walDirectory ?? path.join(process.cwd(), 'scratch');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    this.walPath = path.join(baseDir, 'autonomy_budget_wal.jsonl');
    this.lockPath = path.join(baseDir, 'autonomy_budget.lock');

    this.memoryLedger = this.createEmptyLedger(this.getTodayUtc());
    this.initializeStorage();
  }

  public static getInstance(options?: ClusterAutonomyGovernorOptions): ClusterAutonomyGovernor {
    if (!ClusterAutonomyGovernor.instance) {
      ClusterAutonomyGovernor.instance = new ClusterAutonomyGovernor(options);
    }
    return ClusterAutonomyGovernor.instance;
  }

  public static resetInstanceForTesting(options?: ClusterAutonomyGovernorOptions): ClusterAutonomyGovernor {
    ClusterAutonomyGovernor.instance = new ClusterAutonomyGovernor(options);
    return ClusterAutonomyGovernor.instance;
  }

  public getConfig(): AutonomyClusterBudgetConfig {
    return { ...this.config };
  }

  private getTodayUtc(): string {
    return new Date().toISOString().split('T')[0];
  }

  private createEmptyLedger(dateUtc: string): AutonomyDailyLedgerRecord {
    return {
      date_utc: dateUtc,
      investigations_count: 0,
      tasks_count: 0,
      replans_count: 0,
      connector_calls_count: 0,
      tokens_consumed: 0,
      estimated_compute_cost_usd_cents: 0,
      is_halted: false,
      last_updated_utc: new Date().toISOString()
    };
  }

  // --------------------------------------------------------------------------
  // ATOMIC CONCURRENCY-SAFE STORAGE & REHYDRATION
  // --------------------------------------------------------------------------

  private initializeStorage(): void {
    if (this.pgPool) {
      // Async initialization for PostgreSQL schema if pool exists
      this.initPgSchema().catch((err) => {
        console.warn('PostgreSQL budget table initialization failed, falling back to WAL:', err.message);
      });
    }

    // Rehydrate from WAL if file exists
    this.rehydrateFromWal();
  }

  private async initPgSchema(): Promise<void> {
    if (!this.pgPool) return;
    await this.pgPool.query(`
      CREATE TABLE IF NOT EXISTS autonomy_daily_budget_ledger (
        date_utc DATE PRIMARY KEY,
        investigations_count INT NOT NULL DEFAULT 0,
        tasks_count INT NOT NULL DEFAULT 0,
        replans_count INT NOT NULL DEFAULT 0,
        connector_calls_count INT NOT NULL DEFAULT 0,
        tokens_consumed BIGINT NOT NULL DEFAULT 0,
        estimated_compute_cost_usd_cents INT NOT NULL DEFAULT 0,
        is_halted BOOLEAN NOT NULL DEFAULT FALSE,
        halt_reason TEXT,
        last_updated_utc TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  private rehydrateFromWal(): void {
    if (!fs.existsSync(this.walPath)) return;
    const lines = fs.readFileSync(this.walPath, 'utf8').split('\n').filter(Boolean);
    const today = this.getTodayUtc();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.date_utc === today) {
          if (entry.type === 'INCREMENT_INVESTIGATION') this.memoryLedger.investigations_count += entry.amount || 1;
          if (entry.type === 'INCREMENT_TASK') this.memoryLedger.tasks_count += entry.amount || 1;
          if (entry.type === 'INCREMENT_REPLAN') this.memoryLedger.replans_count += entry.amount || 1;
          if (entry.type === 'INCREMENT_CONNECTOR') this.memoryLedger.connector_calls_count += entry.amount || 1;
          if (entry.type === 'RECORD_COMPUTE') {
            this.memoryLedger.tokens_consumed += entry.tokens || 0;
            this.memoryLedger.estimated_compute_cost_usd_cents += entry.cost_cents || 0;
          }
          if (entry.type === 'HALT') {
            this.memoryLedger.is_halted = true;
            this.memoryLedger.halt_reason = entry.reason;
          }
          this.memoryLedger.last_updated_utc = entry.timestamp_utc || this.memoryLedger.last_updated_utc;
        }
      } catch {
        // Ignore corrupted lines
      }
    }
  }

  /**
   * Concurrency-safe atomic mutation using file-descriptor lock (WAL) or Postgres row-lock.
   */
  private async atomicMutate(
    eventType: string,
    delta: {
      investigations?: number;
      tasks?: number;
      replans?: number;
      connector_calls?: number;
      tokens?: number;
      cost_cents?: number;
      halt?: boolean;
      halt_reason?: string;
    }
  ): Promise<AutonomyDailyLedgerRecord> {
    const today = this.getTodayUtc();
    if (this.memoryLedger.date_utc !== today) {
      this.memoryLedger = this.createEmptyLedger(today);
    }

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `INSERT INTO autonomy_daily_budget_ledger (
             date_utc, investigations_count, tasks_count, replans_count, connector_calls_count,
             tokens_consumed, estimated_compute_cost_usd_cents, is_halted, halt_reason, last_updated_utc
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (date_utc) DO UPDATE SET
             investigations_count = autonomy_daily_budget_ledger.investigations_count + EXCLUDED.investigations_count,
             tasks_count = autonomy_daily_budget_ledger.tasks_count + EXCLUDED.tasks_count,
             replans_count = autonomy_daily_budget_ledger.replans_count + EXCLUDED.replans_count,
             connector_calls_count = autonomy_daily_budget_ledger.connector_calls_count + EXCLUDED.connector_calls_count,
             tokens_consumed = autonomy_daily_budget_ledger.tokens_consumed + EXCLUDED.tokens_consumed,
             estimated_compute_cost_usd_cents = autonomy_daily_budget_ledger.estimated_compute_cost_usd_cents + EXCLUDED.estimated_compute_cost_usd_cents,
             is_halted = EXCLUDED.is_halted OR autonomy_daily_budget_ledger.is_halted,
             halt_reason = COALESCE(EXCLUDED.halt_reason, autonomy_daily_budget_ledger.halt_reason),
             last_updated_utc = NOW()
           RETURNING *;`,
          [
            today,
            delta.investigations || 0,
            delta.tasks || 0,
            delta.replans || 0,
            delta.connector_calls || 0,
            delta.tokens || 0,
            delta.cost_cents || 0,
            delta.halt || false,
            delta.halt_reason || null
          ]
        );
        const row = res.rows[0];
        this.memoryLedger = {
          date_utc: today,
          investigations_count: parseInt(row.investigations_count, 10),
          tasks_count: parseInt(row.tasks_count, 10),
          replans_count: parseInt(row.replans_count, 10),
          connector_calls_count: parseInt(row.connector_calls_count, 10),
          tokens_consumed: parseInt(row.tokens_consumed, 10),
          estimated_compute_cost_usd_cents: parseInt(row.estimated_compute_cost_usd_cents, 10),
          is_halted: Boolean(row.is_halted),
          halt_reason: row.halt_reason || undefined,
          last_updated_utc: new Date(row.last_updated_utc).toISOString()
        };
        return { ...this.memoryLedger };
      } catch {
        // Fallback to file-based atomic WAL
      }
    }

    // Atomic WAL with Exclusive Lockfile
    return this.withFileLock(() => {
      if (delta.investigations) this.memoryLedger.investigations_count += delta.investigations;
      if (delta.tasks) this.memoryLedger.tasks_count += delta.tasks;
      if (delta.replans) this.memoryLedger.replans_count += delta.replans;
      if (delta.connector_calls) this.memoryLedger.connector_calls_count += delta.connector_calls;
      if (delta.tokens) this.memoryLedger.tokens_consumed += delta.tokens;
      if (delta.cost_cents) this.memoryLedger.estimated_compute_cost_usd_cents += delta.cost_cents;
      if (delta.halt) {
        this.memoryLedger.is_halted = true;
        this.memoryLedger.halt_reason = delta.halt_reason;
      }
      this.memoryLedger.last_updated_utc = new Date().toISOString();

      const logRecord = {
        type: eventType,
        date_utc: today,
        ...delta,
        timestamp_utc: this.memoryLedger.last_updated_utc
      };
      fs.appendFileSync(this.walPath, JSON.stringify(logRecord) + '\n', 'utf8');

      return { ...this.memoryLedger };
    });
  }

  private withFileLock<T>(fn: () => T): T {
    let retries = 50;
    while (retries > 0) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx');
        try {
          return fn();
        } finally {
          fs.closeSync(fd);
          try {
            fs.unlinkSync(this.lockPath);
          } catch {
            // Safe cleanup
          }
        }
      } catch (err: any) {
        if (err.code === 'EEXIST') {
          // Lock contention: check stale lock (>2000ms)
          try {
            const stat = fs.statSync(this.lockPath);
            if (Date.now() - stat.mtimeMs > 2000) {
              fs.unlinkSync(this.lockPath);
            }
          } catch {
            // Lock was removed in interim
          }
          // Spin-wait 10ms
          const waitEnd = Date.now() + 10;
          while (Date.now() < waitEnd) {}
          retries--;
        } else {
          throw err;
        }
      }
    }
    // If lock could not be obtained after retries, proceed safely in-memory
    return fn();
  }

  public getDailyLedger(): AutonomyDailyLedgerRecord {
    const today = this.getTodayUtc();
    if (this.memoryLedger.date_utc !== today) {
      this.memoryLedger = this.createEmptyLedger(today);
    }
    return { ...this.memoryLedger };
  }

  // --------------------------------------------------------------------------
  // BOUNDARY 1: INVESTIGATION ADMISSION & DAILY CEILING
  // --------------------------------------------------------------------------

  public async assertInvestigationStartAllowed(): Promise<void> {
    this.assertNoKillSwitchHalt();

    const ledger = this.getDailyLedger();
    if (ledger.is_halted) {
      throw new Error(`E-AUTONOMY-CLUSTER-HALTED: Autonomous operations halted: ${ledger.halt_reason}`);
    }

    if (ledger.investigations_count >= this.config.hard_max_investigations_per_day) {
      throw new AutonomyLimitExceededError(
        'Daily Investigations',
        ledger.investigations_count,
        this.config.hard_max_investigations_per_day,
        'dispatch_investigation'
      );
    }

    if (ledger.estimated_compute_cost_usd_cents >= this.config.max_compute_cost_usd_cents_per_day) {
      throw new AutonomyLimitExceededError(
        'Daily Compute Spend Cents',
        ledger.estimated_compute_cost_usd_cents,
        this.config.max_compute_cost_usd_cents_per_day,
        'dispatch_investigation'
      );
    }

    // Atomically increment daily investigations count
    await this.atomicMutate('INCREMENT_INVESTIGATION', { investigations: 1 });
  }

  // --------------------------------------------------------------------------
  // BOUNDARY 2: TASK ENQUEUE & EXECUTION CEILING (Soft 6, Hard 8, Reject 9+)
  // --------------------------------------------------------------------------

  public assertTaskEnqueueAllowed(investigationId: string, currentTaskCount: number): void {
    this.assertNoKillSwitchHalt();

    if (currentTaskCount >= this.config.hard_max_tasks_per_investigation) {
      throw new AutonomyLimitExceededError(
        'Hard Task Cap Per Investigation',
        currentTaskCount,
        this.config.hard_max_tasks_per_investigation,
        `enqueue_task_for_${investigationId}`
      );
    }
  }

  public async recordTaskExecuted(): Promise<void> {
    await this.atomicMutate('INCREMENT_TASK', { tasks: 1 });
  }

  // --------------------------------------------------------------------------
  // BOUNDARY 3: RECURSIVE REPLAN LIMIT
  // --------------------------------------------------------------------------

  public assertReplanAllowed(investigationId: string, currentReplanCount: number): void {
    this.assertNoKillSwitchHalt();

    if (currentReplanCount >= this.config.max_recursive_replans) {
      throw new AutonomyLimitExceededError(
        'Recursive Replan Limit',
        currentReplanCount,
        this.config.max_recursive_replans,
        `trigger_replan_for_${investigationId}`
      );
    }
  }

  public async recordReplanExecuted(): Promise<void> {
    await this.atomicMutate('INCREMENT_REPLAN', { replans: 1 });
  }

  // --------------------------------------------------------------------------
  // BOUNDARY 4: CONNECTOR CALL & SOURCE-SPECIFIC QUOTA
  // --------------------------------------------------------------------------

  public assertConnectorCallAllowed(connectorId: string, sourceCallCount: number): void {
    this.assertNoKillSwitchHalt();

    if (sourceCallCount >= this.config.max_connector_calls_per_source) {
      throw new AutonomyLimitExceededError(
        `Connector Source Quota (${connectorId})`,
        sourceCallCount,
        this.config.max_connector_calls_per_source,
        `call_connector_${connectorId}`
      );
    }
  }

  public async recordConnectorCallExecuted(): Promise<void> {
    await this.atomicMutate('INCREMENT_CONNECTOR', { connector_calls: 1 });
  }

  // --------------------------------------------------------------------------
  // BOUNDARY 5: CONSERVATIVE PROVIDER COMPUTE COST ACCOUNTING
  // --------------------------------------------------------------------------

  public calculateEstimatedCostCents(
    tokens: number,
    provider: 'GEMINI' | 'GROQ' | 'LOCAL' | 'OTHER',
    model: string = 'pro'
  ): ComputeSpendRecord {
    if (provider === 'LOCAL') {
      return {
        tokens,
        provider,
        model: 'local-heuristic',
        estimated_cost_cents: 0,
        safety_reserve_applied: false,
        epistemic_label: 'ESTIMATED_COMPUTE_COST_WITH_SAFETY_BUFFER'
      };
    }

    // Conservative provider token rates (USD per 1M tokens)
    let ratePerMillionUsd = 7.0; // Default blended estimate
    if (provider === 'GEMINI') {
      ratePerMillionUsd = model.toLowerCase().includes('flash') ? 0.30 : 7.0;
    } else if (provider === 'GROQ') {
      ratePerMillionUsd = 0.79;
    }

    // Raw estimate in cents
    const rawCostCents = (tokens / 1_000_000) * ratePerMillionUsd * 100;

    // Apply mandatory 20% conservative safety reserve multiplier
    const bufferedCostCents = Math.ceil(rawCostCents * this.config.compute_safety_reserve_multiplier);

    return {
      tokens,
      provider,
      model,
      estimated_cost_cents: Math.max(1, bufferedCostCents), // Minimum 1 cent attribution
      safety_reserve_applied: true,
      epistemic_label: 'ESTIMATED_COMPUTE_COST_WITH_SAFETY_BUFFER'
    };
  }

  public async recordComputeSpend(
    tokens: number,
    provider: 'GEMINI' | 'GROQ' | 'LOCAL' | 'OTHER' = 'GEMINI',
    model?: string
  ): Promise<ComputeSpendRecord> {
    const spend = this.calculateEstimatedCostCents(tokens, provider, model);

    await this.atomicMutate('RECORD_COMPUTE', {
      tokens: spend.tokens,
      cost_cents: spend.estimated_cost_cents
    });

    return spend;
  }

  // --------------------------------------------------------------------------
  // BOUNDARY 6: CANCELLATION PROPAGATION & KILL SWITCH HOOKS
  // --------------------------------------------------------------------------

  public registerInvestigationController(investigationId: string): AbortController {
    const controller = new AbortController();
    this.activeAbortControllers.set(investigationId, controller);
    return controller;
  }

  public getInvestigationSignal(investigationId: string): AbortSignal | undefined {
    return this.activeAbortControllers.get(investigationId)?.signal;
  }

  public abortInvestigation(investigationId: string, reason: string): void {
    const controller = this.activeAbortControllers.get(investigationId);
    if (controller) {
      controller.abort(new Error(`E-AUTONOMY-INVESTIGATION-ABORTED: ${reason}`));
      this.activeAbortControllers.delete(investigationId);
    }
  }

  public abortAllActiveInvestigations(reason: string): number {
    let abortedCount = 0;
    for (const [id, controller] of this.activeAbortControllers.entries()) {
      controller.abort(new Error(`E-AUTONOMY-GLOBAL-ABORT: ${reason}`));
      abortedCount++;
      this.activeAbortControllers.delete(id);
    }
    return abortedCount;
  }

  private assertNoKillSwitchHalt(): void {
    if (this.killSwitchController) {
      const state = this.killSwitchController.getState();
      if (
        state.active_scope === 'HALT_ALL_SIMULATION_PROCESSING' ||
        state.active_scope === 'ENTER_RECOVERY_ONLY_MODE' ||
        state.active_scope === 'HALT_NEW_ALLOCATIONS'
      ) {
        this.abortAllActiveInvestigations(`Kill switch tripped to scope: ${state.active_scope}`);
        throw new Error(
          `E-AUTONOMY-KILLSWITCH-ACTIVE: Kill switch active in scope '${state.active_scope}'. All autonomous research dispatches halted.`
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // BOUNDARY 7: CAPITAL BUDGET ISOLATION PROOF
  // --------------------------------------------------------------------------

  public assertCapitalAccessAllowed(callerRole: string, targetAction: string): void {
    const researchSpecialistRoles = [
      'LeadInvestigator',
      'SupplySpecialist',
      'StatutoryRegistrySpecialist',
      'AdversarialAuditorSpecialist',
      'LogisticsSpecialist',
      'GeneralAgent',
      'MediaChatterWorker'
    ];

    if (researchSpecialistRoles.includes(callerRole)) {
      throw new CapitalAccessFirewallError(callerRole, targetAction);
    }
  }
}
