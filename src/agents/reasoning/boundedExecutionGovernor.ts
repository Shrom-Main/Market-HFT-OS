/**
/**
 * POC-001: Bounded Execution & Resource Governor
 *
 * Implements strict, multi-dimensional execution guardrails:
 * - Reasoning iteration caps
 * - Tool call quotas and token budgets
 * - Circuit breakers for failing tools / external connectors
 * - Wall-clock timeout enforcement
 * - Early termination when marginal research value drops to zero
 * - Human escalation when authority or risk boundaries are breached
 */

import {
  InvestigationBudgetConfig,
  ResourceLedger,
  DEFAULT_INVESTIGATION_BUDGET
} from './reasoningTypes.js';

export class CircuitBreakerOpenError extends Error {
  constructor(public readonly toolName: string, public readonly failureCount: number) {
    super(`E-AGENT-CIRCUIT-BREAKER-OPEN: Tool '${toolName}' is disabled after ${failureCount} consecutive failures.`);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class BudgetExhaustedError extends Error {
  constructor(public readonly limitType: string, public readonly current: number, public readonly max: number) {
    super(`E-AGENT-BUDGET-EXHAUSTED: ${limitType} limit reached (${current} >= ${max}).`);
    this.name = 'BudgetExhaustedError';
  }
}

export class BoundedExecutionGovernor {
  private readonly config: InvestigationBudgetConfig;
  private readonly consecutiveFailures: Map<string, number> = new Map();
  private readonly circuitOpenTools: Set<string> = new Set();

  constructor(config?: Partial<InvestigationBudgetConfig>) {
    this.config = { ...DEFAULT_INVESTIGATION_BUDGET, ...config };
  }

  public getBudgetConfig(): InvestigationBudgetConfig {
    return { ...this.config };
  }

  /**
   * Initializes a fresh resource ledger.
   */
  public initializeLedger(): ResourceLedger {
    return {
      iterations_count: 0,
      tool_calls_count: 0,
      delegations_count: 0,
      retries_count: 0,
      tokens_consumed: 0,
      wall_clock_start_utc: new Date().toISOString(),
      wall_clock_elapsed_ms: 0,
      circuit_breaker_trips: {}
    };
  }

  /**
   * Checks if an iteration step can proceed, asserting iteration and timeout limits.
   */
  public assertIterationAllowed(ledger: ResourceLedger): void {
    const elapsed = Date.now() - new Date(ledger.wall_clock_start_utc).getTime();
    ledger.wall_clock_elapsed_ms = elapsed;

    if (elapsed > this.config.wall_clock_timeout_ms) {
      throw new BudgetExhaustedError('Wall-clock timeout', elapsed, this.config.wall_clock_timeout_ms);
    }

    if (ledger.iterations_count >= this.config.max_reasoning_iterations) {
      throw new BudgetExhaustedError('Iteration', ledger.iterations_count, this.config.max_reasoning_iterations);
    }

    ledger.iterations_count++;
  }

  /**
   * Checks if a tool call can proceed, asserting quotas and circuit breaker state.
   */
  public assertToolCallAllowed(toolName: string, ledger: ResourceLedger, estimatedTokens: number = 0): void {
    if (this.circuitOpenTools.has(toolName)) {
      const failures = this.consecutiveFailures.get(toolName) ?? this.config.circuit_breaker_threshold;
      throw new CircuitBreakerOpenError(toolName, failures);
    }

    if (ledger.tool_calls_count >= this.config.max_tool_calls) {
      throw new BudgetExhaustedError('Tool calls', ledger.tool_calls_count, this.config.max_tool_calls);
    }

    if (this.config.token_quota && ledger.tokens_consumed + estimatedTokens > this.config.token_quota) {
      throw new BudgetExhaustedError(
        'Token quota',
        ledger.tokens_consumed + estimatedTokens,
        this.config.token_quota
      );
    }

    ledger.tool_calls_count++;
    ledger.tokens_consumed += estimatedTokens;
  }

  /**
   * Records the outcome of a tool execution for circuit breaking.
   */
  public recordToolOutcome(toolName: string, success: boolean, ledger: ResourceLedger): void {
    if (success) {
      this.consecutiveFailures.set(toolName, 0);
      this.circuitOpenTools.delete(toolName);
    } else {
      const count = (this.consecutiveFailures.get(toolName) ?? 0) + 1;
      this.consecutiveFailures.set(toolName, count);

      if (count >= this.config.circuit_breaker_threshold) {
        this.circuitOpenTools.add(toolName);
        ledger.circuit_breaker_trips[toolName] = (ledger.circuit_breaker_trips[toolName] ?? 0) + 1;
      }
    }
  }

  /**
   * Checks if delegation depth and concurrency limits permit sub-agent spawning.
   */
  public assertDelegationAllowed(currentDepth: number, currentConcurrent: number, ledger: ResourceLedger): void {
    if (currentDepth > this.config.max_delegation_depth) {
      throw new BudgetExhaustedError('Delegation depth', currentDepth, this.config.max_delegation_depth);
    }
    if (currentConcurrent > this.config.max_concurrent_specialists) {
      throw new BudgetExhaustedError('Concurrent specialists', currentConcurrent, this.config.max_concurrent_specialists);
    }
    ledger.delegations_count++;
  }

  /**
   * Evaluates whether an investigation can terminate early.
   * Returns true if all critical information gaps are resolved and no active conflicts remain.
   */
  public shouldTerminateEarly(params: {
    unresolvedHighPriorityGapsCount: number;
    activeConflictsCount: number;
    iterationsCount: number;
  }): boolean {
    // If there are zero high priority gaps and zero active conflicts, further tool calls have negligible marginal value
    if (params.unresolvedHighPriorityGapsCount === 0 && params.activeConflictsCount === 0) {
      return true;
    }
    return false;
  }

  public isCircuitOpen(toolName: string): boolean {
    return this.circuitOpenTools.has(toolName);
  }

  public resetCircuit(toolName: string): void {
    this.circuitOpenTools.delete(toolName);
    this.consecutiveFailures.set(toolName, 0);
  }
}
