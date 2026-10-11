import { validateIso8601UtcTimestamp } from './domain.js';

/**
 * Deterministic Clock Interface
 * Decouples system execution from non-deterministic host wall-clock time.
 */
export interface DeterministicClock {
  /** Returns the current ISO-8601 UTC timestamp. */
  nowUtc(): string;
  /** Explicitly advances the virtual clock by the given milliseconds and returns the new timestamp. */
  advanceMs(ms: number): string;
  /** Sets the clock to an explicit ISO-8601 UTC timestamp. */
  setUtc(isoString: string): void;
  /** Returns the current epoch millisecond timestamp. */
  nowEpochMs(): number;
}

export interface MonotonicVirtualClockOptions {
  /** Initial timestamp in ISO-8601 UTC (default: '2026-10-12T00:00:00.000Z'). */
  startUtc?: string;
  /** Auto-advance step in milliseconds applied on each nowUtc() invocation (default: 0 = manual advance only). */
  autoAdvanceStepMs?: number;
}

/**
 * Monotonic Virtual Clock implementation for deterministic replay and restart verification.
 */
export class MonotonicVirtualClock implements DeterministicClock {
  private currentEpochMs: number;
  private readonly autoAdvanceStepMs: number;

  constructor(options?: MonotonicVirtualClockOptions) {
    const startStr = options?.startUtc ?? '2026-10-12T00:00:00.000Z';
    validateIso8601UtcTimestamp(startStr);
    this.currentEpochMs = new Date(startStr).getTime();
    this.autoAdvanceStepMs = options?.autoAdvanceStepMs ?? 0;
  }

  public nowEpochMs(): number {
    return this.currentEpochMs;
  }

  public nowUtc(): string {
    const ts = new Date(this.currentEpochMs).toISOString();
    if (this.autoAdvanceStepMs > 0) {
      this.currentEpochMs += this.autoAdvanceStepMs;
    }
    return ts;
  }

  public advanceMs(ms: number): string {
    if (!Number.isSafeInteger(ms) || ms < 0) {
      throw new Error(`E-ERR-024: INVALID_CLOCK_ADVANCE: Advance milliseconds must be non-negative safe integer, got ${ms}`);
    }
    this.currentEpochMs += ms;
    return new Date(this.currentEpochMs).toISOString();
  }

  public setUtc(isoString: string): void {
    validateIso8601UtcTimestamp(isoString);
    const nextMs = new Date(isoString).getTime();
    if (nextMs < this.currentEpochMs) {
      throw new Error(`E-ERR-007: MONOTONIC_CLOCK_VIOLATION: Cannot move virtual clock backward from ${new Date(this.currentEpochMs).toISOString()} to ${isoString}`);
    }
    this.currentEpochMs = nextMs;
  }
}

/**
 * Deterministic ID Generator Interface
 * Decouples ID generation from random UUIDs to ensure bit-identical state digests across replays.
 */
export interface DeterministicIdGenerator {
  /** Generates the next sequential ID, optionally formatted with prefix. */
  nextId(prefix?: string): string;
  /** Peeks at the next ID without incrementing counter. */
  peekNextId(prefix?: string): string;
  /** Resets counter to an initial sequence number. */
  reset(startSeq?: number): void;
}

/**
 * Monotonically incrementing counter-based deterministic ID generator.
 */
export class DeterministicCounterIdGenerator implements DeterministicIdGenerator {
  private counter: number;

  constructor(startSeq: number = 1) {
    if (!Number.isSafeInteger(startSeq) || startSeq <= 0) {
      throw new Error(`E-ERR-024: INVALID_START_SEQUENCE: startSeq must be positive safe integer, got ${startSeq}`);
    }
    this.counter = startSeq;
  }

  public nextId(prefix?: string): string {
    const idNum = this.counter++;
    return prefix ? `${prefix}:${idNum}` : `${idNum}`;
  }

  public peekNextId(prefix?: string): string {
    return prefix ? `${prefix}:${this.counter}` : `${this.counter}`;
  }

  public reset(startSeq: number = 1): void {
    if (!Number.isSafeInteger(startSeq) || startSeq <= 0) {
      throw new Error(`E-ERR-024: INVALID_START_SEQUENCE: startSeq must be positive safe integer, got ${startSeq}`);
    }
    this.counter = startSeq;
  }
}
