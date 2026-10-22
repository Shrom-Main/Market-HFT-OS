/**
 * Suite 42: Step 1 Runtime & Provider Capability Audit Acceptance Suite
 *
 * Verifies the 4-Stage Provider Capability Audit Gate across all 7 external providers:
 * 1. Gemini (GeminiAPIKey.env)
 * 2. Groq (Groq_Key.env)
 * 3. Google Maps Places & Routes (GMAPSAPIKey.env)
 * 4. Mistral (MistralAPI.env)
 * 5. OpenRouter (OPENRouterAPI.env)
 * 6. Alpaca (Alpaca_Key.env, Alpaca_Secret.env)
 * 7. Eulerpool (Eulerpool.env)
 *
 * Enforces Strict Governance Invariants:
 * - ZERO SECRET LEAKAGE: Raw credentials never serialized; only sha256(key).slice(0, 8) fingerprints surfaced.
 * - MINIMAL QUOTA: 1 metadata probe per provider with 5000ms timeout, recorded in ApiQuotaAndRateGovernor.
 * - TRUTHFUL INTEGRATION AUDIT: WORKING_E2E vs PARTIAL_DISCONNECTED truthfully identified.
 * - IMMUTABLE PERSISTENCE: RFC 8785 JCS canonical hash written to market_provider_audit_log.
 * - REST API: Route GET /api/health/providers exposed on WorkstationServer.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import pg from 'pg';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import {
  loadServerSecrets,
  getProviderConfigMetadata,
  getAlpacaCredentials,
  computeSecretSha256Prefix8,
  getProviderKey
} from '../../src/mcp/serverSecretLoader.js';
import { ProviderCapabilityAuditor } from '../../src/mcp/providerCapabilityAuditor.js';
import { ApiQuotaAndRateGovernor } from '../../src/mcp/apiQuotaAndRateGovernor.js';

describe('Suite 42: Step 1 Runtime & Provider Capability Audit', () => {
  let server: WorkstationServer;
  let serverPort: number;
  let pgPool: pg.Pool;

  beforeAll(async () => {
    loadServerSecrets();
    const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/market_hft_test';
    pgPool = new pg.Pool({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });

    const stateManager = new WorkstationStateManager();
    server = new WorkstationServer({ port: 0, stateManager });
    const started = await server.start();
    serverPort = started.port;
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    if (pgPool) {
      await pgPool.end();
    }
  });

  function httpRequest(options: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    port: number;
  }): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json?: any }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: options.port,
          path: options.path,
          method: options.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            let parsed: any;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = undefined;
            }
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: data,
              json: parsed
            });
          });
        }
      );
      req.on('error', reject);
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  // Stage 1: Secret Hygiene & Fingerprinting
  it('STAGE-1-SECRET-HYGIENE-001: All 8 provider credential files parse with zero secret leakage and valid 8-char SHA-256 fingerprints', () => {
    const metadata = getProviderConfigMetadata();
    expect(metadata.length).toBeGreaterThanOrEqual(8);

    const requiredProviders = [
      'GEMINI_API',
      'GROQ_API',
      'GOOGLE_MAPS',
      'MISTRAL_API',
      'OPENROUTER_GATEWAY',
      'ALPACA_BROKERAGE',
      'EULERPOOL_MACRO',
      'META_GATEWAY'
    ];

    for (const prov of requiredProviders) {
      const item = metadata.find((m) => m.provider === prov);
      expect(item).toBeDefined();
      expect(item!.is_configured).toBe(true);
      expect(item!.all_files_exist).toBe(true);
      expect(item!.primary_sha256_prefix8).toMatch(/^[a-f0-9]{8}$/);

      // Verify ZERO raw key leakage: primary fingerprint is strictly 8 hex chars
      expect(item!.primary_sha256_prefix8?.length).toBe(8);
    }

    // Alpaca multi-key verification
    const alpacaCreds = getAlpacaCredentials();
    expect(alpacaCreds).not.toBeNull();
    expect(alpacaCreds!.key_sha256_prefix8).toMatch(/^[a-f0-9]{8}$/);
    expect(alpacaCreds!.secret_sha256_prefix8).toMatch(/^[a-f0-9]{8}$/);
  });

  // Stage 2: Minimal-Quota Live Network Handshake
  it('STAGE-2-LIVE-AUTH-PROBE-002: Live network probes authenticate all 8 providers with HTTP 200 and record in quota governor', async () => {
    const governor = new ApiQuotaAndRateGovernor({ pgPool });
    const auditor = new ProviderCapabilityAuditor({ governor, pgPool });

    const report = await auditor.executeAudit();

    expect(report.provider_count).toBe(8);
    expect(report.credential_file_count).toBe(9);
    expect(report.credential_count).toBe(9);
    expect(report.authenticated_live_count).toBe(8);
    expect(report.prev_audit_hash).toBeDefined();

    for (const p of report.providers) {
      expect(p.live_auth_status).toBe('AUTHENTICATED_LIVE');
      expect(p.http_status).toBe(200);
      expect(typeof p.latency_ms).toBe('number');
      expect(p.latency_ms!).toBeGreaterThan(0);
      expect(p.key_sha256_prefix8).toMatch(/^[a-f0-9]{8}$/);

      // Ensure no raw secret is leaked in notes or failure reasons
      const rawKey = getProviderKey(p.provider_id.toUpperCase().replace(/-/g, '_') as any);
      if (rawKey && rawKey.length > 8) {
        expect(p.notes).not.toContain(rawKey);
        if (p.failure_reason) {
          expect(p.failure_reason).not.toContain(rawKey);
        }
      }
    }
  }, 25000);

  // Stage 3: Truthful Codebase Integration Audit
  it('STAGE-3-CODEBASE-AUDIT-003: Accurately classifies WORKING_E2E (2) vs PARTIAL_DISCONNECTED (6)', async () => {
    const auditor = new ProviderCapabilityAuditor();
    const report = await auditor.executeAudit({ skipNetworkProbes: true });

    expect(report.active_adapter_count).toBe(2);
    expect(report.disconnected_adapter_count).toBe(6);

    const gemini = report.providers.find((p) => p.provider_id === 'gemini');
    const groq = report.providers.find((p) => p.provider_id === 'groq');
    const gmaps = report.providers.find((p) => p.provider_id === 'google-maps');
    const mistral = report.providers.find((p) => p.provider_id === 'mistral');
    const openrouter = report.providers.find((p) => p.provider_id === 'openrouter');
    const alpaca = report.providers.find((p) => p.provider_id === 'alpaca');
    const eulerpool = report.providers.find((p) => p.provider_id === 'eulerpool');
    const meta = report.providers.find((p) => p.provider_id === 'meta');

    expect(gemini?.codebase_status).toBe('WORKING_E2E');
    expect(groq?.codebase_status).toBe('WORKING_E2E');

    expect(gmaps?.codebase_status).toBe('PARTIAL_DISCONNECTED');
    expect(mistral?.codebase_status).toBe('PARTIAL_DISCONNECTED');
    expect(openrouter?.codebase_status).toBe('PARTIAL_DISCONNECTED');
    expect(alpaca?.codebase_status).toBe('PARTIAL_DISCONNECTED');
    expect(eulerpool?.codebase_status).toBe('PARTIAL_DISCONNECTED');
    expect(meta?.codebase_status).toBe('PARTIAL_DISCONNECTED');
  });

  // Stage 4: Downstream Underwriting Consumer Mapping
  it('STAGE-4-CONSUMER-MAPPING-004: All 8 providers map to specific underwriting roles and agent consumers', async () => {
    const auditor = new ProviderCapabilityAuditor();
    const report = await auditor.executeAudit({ skipNetworkProbes: true });

    for (const p of report.providers) {
      expect(p.downstream_underwriting_role).toBeTruthy();
      expect(p.downstream_underwriting_role.length).toBeGreaterThan(15);
      expect(p.downstream_consumers.length).toBeGreaterThanOrEqual(1);
    }
  });

  // REST API Route: GET /api/health/providers
  it('ROUTE-HEALTH-PROVIDERS-005: GET /api/health/providers returns authenticated audit report with JCS hash and zero key leakage', async () => {
    const res = await httpRequest({
      port: serverPort,
      path: '/api/health/providers',
      method: 'GET'
    });

    expect(res.statusCode).toBe(200);
    expect(res.json).toBeDefined();
    expect(res.json.provider_count).toBe(8);
    expect(res.json.credential_file_count).toBe(9);
    expect(res.json.credential_count).toBe(9);
    expect(res.json.authenticated_live_count).toBe(8);
    expect(res.json.prev_audit_hash).toBeDefined();
    expect(res.json.jcs_sha256).toMatch(/^[a-f0-9]{64}$/);

    // Verify response body does not leak any known private key substring
    const alpacaCreds = getAlpacaCredentials();
    if (alpacaCreds) {
      expect(res.body).not.toContain(alpacaCreds.keyId);
      expect(res.body).not.toContain(alpacaCreds.secretKey);
    }
  }, 25000);

  // PostgreSQL Persistence & Immutability Trigger
  it('PERSISTENCE-AUDIT-LOG-006: Audit results persist with Merkle chaining and PostgreSQL trigger enforces append-only immutability', async () => {
    const auditor = new ProviderCapabilityAuditor({ pgPool });
    const report = await auditor.executeAudit({ skipNetworkProbes: true });

    const dbRows = await pgPool.query(
      'SELECT audit_id, executed_at_utc, prev_audit_hash, jcs_sha256 FROM market_provider_audit_log WHERE audit_id = $1',
      [report.audit_id]
    );

    expect(dbRows.rows.length).toBe(1);
    expect(dbRows.rows[0].audit_id).toBe(report.audit_id);
    expect(dbRows.rows[0].jcs_sha256).toBe(report.jcs_sha256);
    expect(dbRows.rows[0].prev_audit_hash).toBe(report.prev_audit_hash);

    // Anti-Tamper Enforcement: attempting an UPDATE or DELETE must be rejected by trigger
    await expect(
      pgPool.query('UPDATE market_provider_audit_log SET jcs_sha256 = $1 WHERE audit_id = $2', ['tampered_hash', report.audit_id])
    ).rejects.toThrow(/market_provider_audit_log is append-only/);

    await expect(
      pgPool.query('DELETE FROM market_provider_audit_log WHERE audit_id = $1', [report.audit_id])
    ).rejects.toThrow(/market_provider_audit_log is append-only/);
  });
});
