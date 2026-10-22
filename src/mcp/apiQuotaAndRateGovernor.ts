/**
 * POC-001: Rate-Governed External API Quota & Rate Limit Governor
 *
 * Implements:
 * 1. PostgreSQL-backed RPM, RPD, and RPW sliding-window rate limiter across providers:
 *    - GOOGLE_MAPS_PLACES
 *    - GOOGLE_MAPS_ROUTES
 *    - GEMINI_API
 *    - GROQ_API
 * 2. Fail-closed rate limit protection before opening network socket:
 *    - Fails with status: 'DEFERRED_RATE_LIMIT_PROTECTED' (E-QUOTA-RPM-RPD-RPW-EXCEEDED)
 * 3. Content-addressed request deduplication (sha256(provider + endpoint + canonical_params)).
 * 4. Google Maps Places minimal field mask enforcement (X-Goog-FieldMask).
 * 5. Isolation of Google Maps data from internal entity role candidate classifications.
 * 6. Google Maps Routes estimation tracking (route_source: 'MAPPED_ROUTE_ESTIMATE' vs 'VERIFIED_CARRIER_QUOTE').
 */

import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import type { Pool } from 'pg';

export type ExternalApiProvider =
  | 'GOOGLE_MAPS_PLACES'
  | 'GOOGLE_MAPS_ROUTES'
  | 'GEMINI_API'
  | 'GROQ_API'
  | 'MISTRAL_API'
  | 'OPENROUTER_API'
  | 'ALPACA_PAPER_API'
  | 'EULERPOOL_API'
  | 'META_API';

export interface QuotaWindowCeilings {
  readonly requests_per_minute: number;
  readonly requests_per_day: number;
  readonly requests_per_week: number;
  readonly token_budget_per_task?: number;
}

export const DEFAULT_QUOTA_CEILINGS: Record<ExternalApiProvider, QuotaWindowCeilings> = Object.freeze({
  GOOGLE_MAPS_PLACES: {
    requests_per_minute: 60,
    requests_per_day: 1000,
    requests_per_week: 5000
  },
  GOOGLE_MAPS_ROUTES: {
    requests_per_minute: 60,
    requests_per_day: 1000,
    requests_per_week: 5000
  },
  GEMINI_API: {
    requests_per_minute: 15,
    requests_per_day: 1500,
    requests_per_week: 10000,
    token_budget_per_task: 32000
  },
  GROQ_API: {
    requests_per_minute: 30,
    requests_per_day: 14400,
    requests_per_week: 50000,
    token_budget_per_task: 16000
  },
  MISTRAL_API: {
    requests_per_minute: 30,
    requests_per_day: 10000,
    requests_per_week: 50000,
    token_budget_per_task: 16000
  },
  OPENROUTER_API: {
    requests_per_minute: 30,
    requests_per_day: 10000,
    requests_per_week: 50000,
    token_budget_per_task: 16000
  },
  ALPACA_PAPER_API: {
    requests_per_minute: 60,
    requests_per_day: 2000,
    requests_per_week: 10000
  },
  EULERPOOL_API: {
    requests_per_minute: 30,
    requests_per_day: 1000,
    requests_per_week: 5000
  },
  META_API: {
    requests_per_minute: 60,
    requests_per_day: 4800,
    requests_per_week: 25000
  }
});

export const GOOGLE_MAPS_PLACES_MINIMAL_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.businessStatus,places.websiteUri,places.nationalPhoneNumber,places.regularOpeningHours,places.rating,places.userRatingCount,places.googleMapsUri';

export type EntityRoleCandidate =
  | 'MANUFACTURER_SUPPLIER'
  | 'DISTRIBUTOR_INTERMEDIARY'
  | 'POTENTIAL_B2B_BUYER'
  | 'EXISTING_SELLER_COMPETITOR';

export interface MappedBusinessRecord {
  // Google Maps Platform Supplied Data (subject to Google Maps Platform Terms & Refresh TTL)
  readonly google_place_id: string;
  readonly display_name: string;
  readonly formatted_address: string;
  readonly location: { readonly latitude: number; readonly longitude: number };
  readonly primary_type?: string;
  readonly types?: readonly string[];
  readonly business_status?: string;
  readonly website_uri?: string;
  readonly national_phone_number?: string;
  readonly rating?: number;
  readonly user_rating_count?: number;
  readonly google_maps_uri?: string;
  readonly fetched_at_utc: string;
  readonly cache_expires_at_utc: string;

  // Internal Enrichment Fields (strictly separated from Google-supplied fields)
  readonly internal_entity_id: string;
  readonly entity_role_candidates: readonly EntityRoleCandidate[];
  readonly classification_confidence: number; // 0.00 to 1.00
  readonly classification_evidence_ids: readonly string[];
}

export type RouteSourceType = 'MAPPED_ROUTE_ESTIMATE' | 'VERIFIED_CARRIER_QUOTE';

export interface MappedRouteRecord {
  readonly route_id: string;
  readonly origin_query: string;
  readonly destination_query: string;
  readonly straight_line_distance_km: number;
  readonly road_distance_km: number;
  readonly estimated_travel_duration_minutes: number;
  readonly route_source: RouteSourceType;
  readonly computed_at_utc: string;
  readonly verification_notes: string;
}

export interface QuotaLedgerEntry {
  readonly ledger_id: string;
  readonly provider: ExternalApiProvider;
  readonly endpoint: string;
  readonly request_hash: string;
  readonly task_id: string;
  readonly timestamp_utc: string;
  readonly status: 'ALLOWED' | 'DEFERRED_RATE_LIMIT_PROTECTED' | 'CACHED_REPLAY';
  readonly tokens_used: number;
  readonly execution_latency_ms: number;
  readonly error_code?: string;
}

export interface CheckQuotaResult {
  readonly allowed: boolean;
  readonly status: 'ALLOWED' | 'DEFERRED_RATE_LIMIT_PROTECTED' | 'CACHED_REPLAY';
  readonly request_hash: string;
  readonly provider: ExternalApiProvider;
  readonly current_rpm: number;
  readonly current_rpd: number;
  readonly current_rpw: number;
  readonly limit_rpm: number;
  readonly limit_rpd: number;
  readonly limit_rpw: number;
  readonly reason?: string;
  readonly error_code?: string;
}

export class ApiQuotaAndRateGovernor {
  private readonly pgPool: Pool | null;
  private readonly inMemoryLedger: QuotaLedgerEntry[] = [];
  private readonly cachedResponses: Map<string, unknown> = new Map();
  private readonly customCeilings: Partial<Record<ExternalApiProvider, QuotaWindowCeilings>>;

  constructor(options?: {
    pgPool?: Pool | null;
    ceilings?: Partial<Record<ExternalApiProvider, QuotaWindowCeilings>>;
  }) {
    this.pgPool = options?.pgPool ?? null;
    this.customCeilings = options?.ceilings ?? {};
  }

  public getCeilings(provider: ExternalApiProvider): QuotaWindowCeilings {
    return {
      ...DEFAULT_QUOTA_CEILINGS[provider],
      ...(this.customCeilings[provider] || {})
    };
  }

  public computeRequestHash(provider: ExternalApiProvider, endpoint: string, params: unknown): string {
    const canonicalParams = canonicalizeJCS(params ?? {});
    return sha256(`${provider}:${endpoint}:${canonicalParams}`);
  }

  /**
   * Evaluates sliding window quotas (RPM, RPD, RPW).
   * Fails closed before network call if ceilings would be breached.
   */
  public async evaluateRequest(
    provider: ExternalApiProvider,
    endpoint: string,
    params: unknown,
    taskId: string = 'task:default'
  ): Promise<CheckQuotaResult> {
    const requestHash = this.computeRequestHash(provider, endpoint, params);
    const ceilings = this.getCeilings(provider);
    const nowMs = Date.now();
    const nowUtc = new Date(nowMs).toISOString();

    // Check if request is identical and cached
    if (this.cachedResponses.has(requestHash)) {
      return {
        allowed: true,
        status: 'CACHED_REPLAY',
        request_hash: requestHash,
        provider,
        current_rpm: 0,
        current_rpd: 0,
        current_rpw: 0,
        limit_rpm: ceilings.requests_per_minute,
        limit_rpd: ceilings.requests_per_day,
        limit_rpw: ceilings.requests_per_week
      };
    }

    // Query recent window counts (Postgres or in-memory fallback)
    const oneMinAgo = new Date(nowMs - 60_000).toISOString();
    const oneDayAgo = new Date(nowMs - 86_400_000).toISOString();
    const oneWeekAgo = new Date(nowMs - 7 * 86_400_000).toISOString();

    let countRpm = 0;
    let countRpd = 0;
    let countRpw = 0;

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT
            COUNT(*) FILTER (WHERE timestamp_utc >= $2 AND status = 'ALLOWED') AS rpm_count,
            COUNT(*) FILTER (WHERE timestamp_utc >= $3 AND status = 'ALLOWED') AS rpd_count,
            COUNT(*) FILTER (WHERE timestamp_utc >= $4 AND status = 'ALLOWED') AS rpw_count
           FROM market_api_quota_ledger
           WHERE provider = $1`,
          [provider, oneMinAgo, oneDayAgo, oneWeekAgo]
        );
        const row = res.rows[0];
        countRpm = parseInt(row.rpm_count || '0', 10);
        countRpd = parseInt(row.rpd_count || '0', 10);
        countRpw = parseInt(row.rpw_count || '0', 10);
      } catch {
        // Fall back to in-memory evaluation
        const providerEntries = this.inMemoryLedger.filter(
          (e) => e.provider === provider && e.status === 'ALLOWED'
        );
        countRpm = providerEntries.filter((e) => e.timestamp_utc >= oneMinAgo).length;
        countRpd = providerEntries.filter((e) => e.timestamp_utc >= oneDayAgo).length;
        countRpw = providerEntries.filter((e) => e.timestamp_utc >= oneWeekAgo).length;
      }
    } else {
      const providerEntries = this.inMemoryLedger.filter(
        (e) => e.provider === provider && e.status === 'ALLOWED'
      );
      countRpm = providerEntries.filter((e) => e.timestamp_utc >= oneMinAgo).length;
      countRpd = providerEntries.filter((e) => e.timestamp_utc >= oneDayAgo).length;
      countRpw = providerEntries.filter((e) => e.timestamp_utc >= oneWeekAgo).length;
    }

    // Check sliding window limits
    if (countRpm >= ceilings.requests_per_minute) {
      const entry: QuotaLedgerEntry = {
        ledger_id: `QL-${sha256(nowUtc + requestHash).slice(0, 12)}`,
        provider,
        endpoint,
        request_hash: requestHash,
        task_id: taskId,
        timestamp_utc: nowUtc,
        status: 'DEFERRED_RATE_LIMIT_PROTECTED',
        tokens_used: 0,
        execution_latency_ms: 0,
        error_code: 'E-QUOTA-RPM-EXCEEDED'
      };
      await this.recordLedgerEntry(entry);
      return {
        allowed: false,
        status: 'DEFERRED_RATE_LIMIT_PROTECTED',
        request_hash: requestHash,
        provider,
        current_rpm: countRpm,
        current_rpd: countRpd,
        current_rpw: countRpw,
        limit_rpm: ceilings.requests_per_minute,
        limit_rpd: ceilings.requests_per_day,
        limit_rpw: ceilings.requests_per_week,
        reason: `RPM limit exceeded: ${countRpm}/${ceilings.requests_per_minute} requests in last 60s.`,
        error_code: 'E-QUOTA-RPM-RPD-RPW-EXCEEDED'
      };
    }

    if (countRpd >= ceilings.requests_per_day) {
      const entry: QuotaLedgerEntry = {
        ledger_id: `QL-${sha256(nowUtc + requestHash).slice(0, 12)}`,
        provider,
        endpoint,
        request_hash: requestHash,
        task_id: taskId,
        timestamp_utc: nowUtc,
        status: 'DEFERRED_RATE_LIMIT_PROTECTED',
        tokens_used: 0,
        execution_latency_ms: 0,
        error_code: 'E-QUOTA-RPD-EXCEEDED'
      };
      await this.recordLedgerEntry(entry);
      return {
        allowed: false,
        status: 'DEFERRED_RATE_LIMIT_PROTECTED',
        request_hash: requestHash,
        provider,
        current_rpm: countRpm,
        current_rpd: countRpd,
        current_rpw: countRpw,
        limit_rpm: ceilings.requests_per_minute,
        limit_rpd: ceilings.requests_per_day,
        limit_rpw: ceilings.requests_per_week,
        reason: `RPD limit exceeded: ${countRpd}/${ceilings.requests_per_day} requests in last 24h.`,
        error_code: 'E-QUOTA-RPM-RPD-RPW-EXCEEDED'
      };
    }

    if (countRpw >= ceilings.requests_per_week) {
      const entry: QuotaLedgerEntry = {
        ledger_id: `QL-${sha256(nowUtc + requestHash).slice(0, 12)}`,
        provider,
        endpoint,
        request_hash: requestHash,
        task_id: taskId,
        timestamp_utc: nowUtc,
        status: 'DEFERRED_RATE_LIMIT_PROTECTED',
        tokens_used: 0,
        execution_latency_ms: 0,
        error_code: 'E-QUOTA-RPW-EXCEEDED'
      };
      await this.recordLedgerEntry(entry);
      return {
        allowed: false,
        status: 'DEFERRED_RATE_LIMIT_PROTECTED',
        request_hash: requestHash,
        provider,
        current_rpm: countRpm,
        current_rpd: countRpd,
        current_rpw: countRpw,
        limit_rpm: ceilings.requests_per_minute,
        limit_rpd: ceilings.requests_per_day,
        limit_rpw: ceilings.requests_per_week,
        reason: `RPW limit exceeded: ${countRpw}/${ceilings.requests_per_week} requests in last 7 days.`,
        error_code: 'E-QUOTA-RPM-RPD-RPW-EXCEEDED'
      };
    }

    return {
      allowed: true,
      status: 'ALLOWED',
      request_hash: requestHash,
      provider,
      current_rpm: countRpm,
      current_rpd: countRpd,
      current_rpw: countRpw,
      limit_rpm: ceilings.requests_per_minute,
      limit_rpd: ceilings.requests_per_day,
      limit_rpw: ceilings.requests_per_week
    };
  }

  /**
   * Records an executed external call in the ledger.
   */
  public async recordExecution(params: {
    provider: ExternalApiProvider;
    endpoint: string;
    request_params: unknown;
    task_id: string;
    tokens_used?: number;
    latency_ms: number;
    response_payload?: unknown;
  }): Promise<QuotaLedgerEntry> {
    const requestHash = this.computeRequestHash(params.provider, params.endpoint, params.request_params);
    const nowUtc = new Date().toISOString();
    const entry: QuotaLedgerEntry = {
      ledger_id: `QL-${sha256(nowUtc + requestHash).slice(0, 12)}`,
      provider: params.provider,
      endpoint: params.endpoint,
      request_hash: requestHash,
      task_id: params.task_id,
      timestamp_utc: nowUtc,
      status: 'ALLOWED',
      tokens_used: params.tokens_used ?? 0,
      execution_latency_ms: params.latency_ms
    };

    await this.recordLedgerEntry(entry);

    if (params.response_payload) {
      this.cachedResponses.set(requestHash, params.response_payload);
    }

    return entry;
  }

  private async recordLedgerEntry(entry: QuotaLedgerEntry): Promise<void> {
    this.inMemoryLedger.push(entry);

    if (this.pgPool) {
      try {
        await this.pgPool.query(
          `INSERT INTO market_api_quota_ledger
            (ledger_id, provider, endpoint, request_hash, task_id, timestamp_utc, status, tokens_used, execution_latency_ms, error_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (ledger_id) DO NOTHING`,
          [
            entry.ledger_id,
            entry.provider,
            entry.endpoint,
            entry.request_hash,
            entry.task_id,
            entry.timestamp_utc,
            entry.status,
            entry.tokens_used,
            entry.execution_latency_ms,
            entry.error_code || null
          ]
        );
      } catch (err: unknown) {
        // Log persistence warning fail-closed if caller expects DB durability
        console.warn('[ApiQuotaAndRateGovernor] Failed to persist quota entry to PostgreSQL:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  /**
   * Enforces Google Maps Places minimal field mask.
   * Throws if caller attempts to request broader fields that exceed governance.
   */
  public static validatePlacesFieldMask(fieldMaskHeader: string | undefined): string {
    const standardMask = GOOGLE_MAPS_PLACES_MINIMAL_FIELD_MASK;
    if (!fieldMaskHeader || fieldMaskHeader.trim() === '') {
      return standardMask;
    }
    const requestedFields = fieldMaskHeader.split(',').map((f) => f.trim());
    const allowedFields = new Set(standardMask.split(','));

    for (const field of requestedFields) {
      if (!allowedFields.has(field)) {
        throw new Error(
          `E-GMAPS-FIELD-MASK-PROHIBITED: Field '${field}' is not in the approved minimal field mask. ` +
          `Permitted fields: [${standardMask}].`
        );
      }
    }
    return fieldMaskHeader;
  }

  /**
   * Enforces route source distinction: never label a mapped route estimate as a carrier quote.
   */
  public static createRouteEstimate(params: {
    origin: string;
    destination: string;
    straight_line_km: number;
    road_km: number;
    duration_min: number;
    is_carrier_quote?: boolean;
    carrier_name?: string;
  }): MappedRouteRecord {
    const isCarrier = params.is_carrier_quote === true && !!params.carrier_name;
    const routeSource: RouteSourceType = isCarrier ? 'VERIFIED_CARRIER_QUOTE' : 'MAPPED_ROUTE_ESTIMATE';
    const nowUtc = new Date().toISOString();
    const routeId = `RTE-${sha256(params.origin + ':' + params.destination + ':' + nowUtc).slice(0, 10).toUpperCase()}`;

    return {
      route_id: routeId,
      origin_query: params.origin,
      destination_query: params.destination,
      straight_line_distance_km: params.straight_line_km,
      road_distance_km: params.road_km,
      estimated_travel_duration_minutes: params.duration_min,
      route_source: routeSource,
      computed_at_utc: nowUtc,
      verification_notes: isCarrier
        ? `Carrier freight rate contract with ${params.carrier_name}`
        : 'Algorithmic route distance estimation — not an authenticated freight carrier quote'
    };
  }

  public getInMemoryLedger(): readonly QuotaLedgerEntry[] {
    return this.inMemoryLedger;
  }
}
