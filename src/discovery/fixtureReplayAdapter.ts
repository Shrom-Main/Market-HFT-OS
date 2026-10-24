/**
 * POC-001: Stage 0 Discovery Screener — Fixture Replay Adapter (Slice 2A)
 *
 * Implements SourceAdapterContract to replay versioned, attributable golden fixtures
 * in offline testing, simulation, and backtesting environments with zero network access.
 *
 * Guarantees:
 * 1. 100% Offline: Never initiates any network socket, HTTP call, or RPC.
 * 2. Strict Provenance: Retains golden fixture signatures, source timestamps, and origin classification.
 * 3. Idempotent Sequencing: Replays fixtures deterministically in chronological or specified order.
 */

import {
  SourceAdapterContract,
  SourceAdapterTelemetry,
  RawSourceCapture,
  SourceType,
  PermissionScope
} from './sourceAdapterContract.js';
import {
  GoldenDiscoveryFixtureRegistry,
  VersionedGoldenFixtureSet
} from './fixtures/goldenDiscoveryFixtures.js';

export interface FixtureReplayAdapterOptions {
  readonly connector_id?: string;
  readonly fixture_set_id?: string;
  readonly custom_fixtures?: readonly RawSourceCapture[];
}

export class FixtureReplayAdapter implements SourceAdapterContract {
  public readonly connector_id: string;
  public readonly source_type: SourceType = 'FIXTURE_REPLAY';
  public readonly permission_scope: PermissionScope = 'FIXTURE_REPLAY_ONLY';

  private readonly fixtureSet: VersionedGoldenFixtureSet;
  private readonly fixtures: readonly RawSourceCapture[];
  private fetchCount: number = 0;
  private lastFetchTime: string | null = null;
  private errorCount: number = 0;
  private lastError: string | null = null;

  constructor(options?: FixtureReplayAdapterOptions) {
    this.connector_id = options?.connector_id ?? 'conn:replay:golden-fixtures';
    const setId = options?.fixture_set_id ?? GoldenDiscoveryFixtureRegistry.getDefaultFixtureSet().fixture_set_id;
    const foundSet = GoldenDiscoveryFixtureRegistry.getFixtureSet(setId);
    this.fixtureSet = foundSet ?? GoldenDiscoveryFixtureRegistry.getDefaultFixtureSet();

    if (options?.custom_fixtures && options.custom_fixtures.length > 0) {
      this.fixtures = [...options.custom_fixtures];
    } else {
      this.fixtures = this.fixtureSet.fixtures;
    }
  }

  public getTelemetry(): SourceAdapterTelemetry {
    return {
      connector_id: this.connector_id,
      source_type: this.source_type,
      permission_scope: this.permission_scope,
      total_captures_fetched: this.fetchCount,
      last_fetch_timestamp_utc: this.lastFetchTime,
      error_count: this.errorCount,
      last_error_message: this.lastError,
      is_healthy: this.errorCount === 0
    };
  }

  /**
   * Returns all available golden fixtures matching optional criteria.
   */
  public async fetchCaptures(options?: {
    limit?: number;
    since_utc?: string;
    source_connector_id?: string;
    source_type?: SourceType;
  }): Promise<readonly RawSourceCapture[]> {
    try {
      let filtered = [...this.fixtures];

      if (options?.source_connector_id) {
        filtered = filtered.filter((f) => f.source_connector_id === options.source_connector_id);
      }

      if (options?.source_type) {
        filtered = filtered.filter((f) => f.source_type === options.source_type);
      }

      if (options?.since_utc) {
        const sinceEpoch = new Date(options.since_utc).getTime();
        filtered = filtered.filter((f) => new Date(f.source_observed_at_utc).getTime() >= sinceEpoch);
      }

      // Sort deterministically by source_observed_at_utc
      filtered.sort((a, b) => new Date(a.source_observed_at_utc).getTime() - new Date(b.source_observed_at_utc).getTime());

      if (typeof options?.limit === 'number' && options.limit > 0) {
        filtered = filtered.slice(0, options.limit);
      }

      this.fetchCount += filtered.length;
      this.lastFetchTime = new Date().toISOString();

      return Object.freeze(filtered);
    } catch (err: any) {
      this.errorCount++;
      this.lastError = err?.message ?? String(err);
      throw err;
    }
  }

  /**
   * Fetches a specific fixture by capture ID.
   */
  public getFixtureById(captureId: string): RawSourceCapture | undefined {
    return this.fixtures.find((f) => f.capture_id === captureId);
  }

  /**
   * Returns the version of the underlying fixture set.
   */
  public getFixtureVersion(): string {
    return this.fixtureSet.version;
  }
}
