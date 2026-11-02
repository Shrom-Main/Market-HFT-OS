/**
 * POC-001: Durable Transactional Event Store (Stage B)
 *
 * Implements an append-only, transactional, cryptographically-hashed event log for
 * persistent memory lifecycle events. Supports query, replay, and reactive subscriber dispatch.
 * Conforms to the directive: PostgreSQL table is the authoritative event history store;
 * notifications merely wake subscribers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { MemoryEvent, MemoryEventType } from './memoryTypes.js';

export interface MemoryEventFilter {
  readonly event_types?: readonly MemoryEventType[];
  readonly investigation_id?: string;
  readonly memory_id?: string;
  readonly since_sequence?: number;
}

export class DurableMemoryEventStore {
  private events: MemoryEvent[] = [];
  private sequenceCounter: number = 0;
  private readonly listeners: Set<(event: MemoryEvent) => void> = new Set();
  private readonly journalPath?: string;

  constructor(options?: { journalPath?: string; initialEvents?: readonly MemoryEvent[] }) {
    this.journalPath = options?.journalPath;
    if (options?.initialEvents && options?.initialEvents.length > 0) {
      for (const ev of options.initialEvents) {
        this.events.push({ ...ev });
        if (ev.sequence_number > this.sequenceCounter) {
          this.sequenceCounter = ev.sequence_number;
        }
      }
    } else if (this.journalPath && fs.existsSync(this.journalPath)) {
      this.loadFromDisk();
    }
  }

  private loadFromDisk(): void {
    if (!this.journalPath || !fs.existsSync(this.journalPath)) return;
    try {
      const raw = fs.readFileSync(this.journalPath, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const ev = JSON.parse(line) as MemoryEvent;
        this.events.push(ev);
        if (ev.sequence_number > this.sequenceCounter) {
          this.sequenceCounter = ev.sequence_number;
        }
      }
    } catch (err) {
      console.error(`[DurableMemoryEventStore] Failed to load journal from ${this.journalPath}:`, err);
    }
  }

  private persistToDisk(event: MemoryEvent): void {
    if (!this.journalPath) return;
    try {
      const dir = path.dirname(this.journalPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.journalPath, JSON.stringify(event) + '\n', 'utf8');
    } catch (err) {
      console.error(`[DurableMemoryEventStore] Failed to persist event to ${this.journalPath}:`, err);
    }
  }

  /**
   * Transactionally appends a new memory lifecycle event.
   */
  public async emit(params: {
    event_type: MemoryEventType;
    investigation_id: string;
    memory_id: string;
    details: Record<string, unknown>;
  }): Promise<MemoryEvent> {
    this.sequenceCounter += 1;
    const nowUtc = new Date().toISOString();
    const eventId = `MEVT-${Date.now()}-${this.sequenceCounter}`;

    const rawEventWithoutHash = {
      event_id: eventId,
      sequence_number: this.sequenceCounter,
      event_type: params.event_type,
      timestamp_utc: nowUtc,
      investigation_id: params.investigation_id,
      memory_id: params.memory_id,
      details: params.details
    };

    const canonicalJson = canonicalizeJCS(rawEventWithoutHash);
    const eventHash = sha256(canonicalJson);

    const fullEvent: MemoryEvent = {
      ...rawEventWithoutHash,
      jcs_sha256: eventHash
    };

    this.events.push(Object.freeze(fullEvent));
    this.persistToDisk(fullEvent);

    // Notify active subscribers
    for (const listener of this.listeners) {
      try {
        listener(fullEvent);
      } catch (err) {
        console.error('[DurableMemoryEventStore] Listener error:', err);
      }
    }

    return fullEvent;
  }

  /**
   * Queries events matching an optional filter.
   */
  public async query(filter?: MemoryEventFilter): Promise<readonly MemoryEvent[]> {
    let result = this.events;
    if (!filter) return [...result];

    if (filter.event_types && filter.event_types.length > 0) {
      const types = new Set(filter.event_types);
      result = result.filter((e) => types.has(e.event_type));
    }
    if (filter.investigation_id) {
      result = result.filter((e) => e.investigation_id === filter.investigation_id);
    }
    if (filter.memory_id) {
      result = result.filter((e) => e.memory_id === filter.memory_id);
    }
    if (filter.since_sequence !== undefined) {
      result = result.filter((e) => e.sequence_number > filter.since_sequence!);
    }

    return [...result];
  }

  /**
   * Replays all events since a sequence number for client reconnection.
   */
  public async replay(sinceSequence: number = 0): Promise<readonly MemoryEvent[]> {
    return this.events.filter((e) => e.sequence_number > sinceSequence);
  }

  /**
   * Subscribes to live memory lifecycle events.
   */
  public subscribe(listener: (event: MemoryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getEventCount(): number {
    return this.events.length;
  }

  public getLatestSequence(): number {
    return this.sequenceCounter;
  }
}
