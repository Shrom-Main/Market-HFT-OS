/**
 * POC-001: Stage 0 Discovery Screener — Source Adapter Contract & Normalization Types (Slice 2A)
 *
 * Defines the normative interface and data contracts for data source adapters in the
 * Stage 0 Discovery Screener pipeline.
 *
 * Invariants:
 * 1. Attributable Provenance: Every observation carries source connector ID, capture timestamp ($T_{ingest}$),
 *    source observation timestamp ($T_{source}$), and origin classification.
 * 2. Strict Permission Scoping: Adapters declare read-only capabilities and permission scopes.
 * 3. Zero Fabrication: Missing data is strictly marked null/undefined; zero-cost substitutions are banned.
 * 4. Zero Credential Exposure: Adapters never expose or log API keys, tokens, or credentials.
 */

import { sha256 } from '../canonical/crypto.js';

export type SourceType =
  | 'MARKETPLACE_RETAIL'
  | 'SUPPLIER_B2B_CATALOG'
  | 'GOV_PROCUREMENT'
  | 'IMPORT_EXPORT_MANIFEST'
  | 'TRADE_REGISTRY'
  | 'FIXTURE_REPLAY';

export type PermissionScope =
  | 'READ_PUBLIC_LISTINGS'
  | 'READ_SUPPLIER_QUOTES'
  | 'READ_PUBLIC_TENDERS'
  | 'FIXTURE_REPLAY_ONLY';

export type CaptureOriginClass =
  | 'RECORDED_GOLDEN_FIXTURE'
  | 'LIVE_VERIFIED_CAPTURE'
  | 'UNATTESTED_USER_INTAKE'
  | 'ESTIMATED_PROXY';

export interface RawSourceCapture {
  readonly capture_id: string;
  readonly source_connector_id: string;
  readonly source_type: SourceType;
  readonly origin_class: CaptureOriginClass;
  readonly target_url?: string;
  readonly raw_payload: string;
  readonly payload_sha256: string;
  readonly source_observed_at_utc: string; // T_source
  readonly retrieval_timestamp_utc: string; // T_ingest
  readonly extracted_fields?: Record<string, unknown>;
  readonly provenance_signature?: string;
}

export interface NormalizedDiscoveryObservation {
  readonly observation_id: string;
  readonly capture_id: string;
  readonly strategy_id: string;
  readonly canonical_product_id: string;
  readonly candidate_name: string;
  readonly source_connector_id: string;
  readonly source_type: SourceType;
  readonly origin_class: CaptureOriginClass;
  readonly prevailing_retail_asp_inr: number | null;
  readonly factory_gate_quote_inr: number | null;
  readonly unit_batch_moq: number | null;
  readonly observed_seller_count: number | null;
  readonly review_sentiment_summary: string | null;
  readonly raw_payload_snippet: string;
  readonly payload_sha256: string;
  readonly source_observed_at_utc: string;
  readonly ingestion_timestamp_utc: string;
  readonly has_logistics_route: boolean;
  readonly has_regulatory_clearance: boolean;
  readonly normalization_notes: string;
}

export interface SourceAdapterTelemetry {
  readonly connector_id: string;
  readonly source_type: SourceType;
  readonly permission_scope: PermissionScope;
  readonly total_captures_fetched: number;
  readonly last_fetch_timestamp_utc: string | null;
  readonly error_count: number;
  readonly last_error_message: string | null;
  readonly is_healthy: boolean;
}

/**
 * Normative contract that every discovery source adapter must implement.
 */
export interface SourceAdapterContract {
  readonly connector_id: string;
  readonly source_type: SourceType;
  readonly permission_scope: PermissionScope;

  /**
   * Returns current health and operational telemetry.
   */
  getTelemetry(): SourceAdapterTelemetry;

  /**
   * Fetches or replays available raw captures from the source.
   */
  fetchCaptures(options?: {
    limit?: number;
    since_utc?: string;
  }): Promise<readonly RawSourceCapture[]>;
}

/**
 * Helper to compute an immutable payload SHA-256 digest.
 */
export function computePayloadSha256(content: string): string {
  return sha256(content);
}

/**
 * Helper to construct an attributable RawSourceCapture envelope with automatic digest computation.
 */
export function createRawSourceCapture(params: {
  capture_id: string;
  source_connector_id: string;
  source_type: SourceType;
  origin_class: CaptureOriginClass;
  raw_payload: string;
  source_observed_at_utc: string;
  retrieval_timestamp_utc?: string;
  target_url?: string;
  extracted_fields?: Record<string, unknown>;
  provenance_signature?: string;
}): RawSourceCapture {
  return {
    capture_id: params.capture_id,
    source_connector_id: params.source_connector_id,
    source_type: params.source_type,
    origin_class: params.origin_class,
    target_url: params.target_url,
    raw_payload: params.raw_payload,
    payload_sha256: computePayloadSha256(params.raw_payload),
    source_observed_at_utc: params.source_observed_at_utc,
    retrieval_timestamp_utc: params.retrieval_timestamp_utc ?? new Date().toISOString(),
    extracted_fields: params.extracted_fields,
    provenance_signature: params.provenance_signature
  };
}
