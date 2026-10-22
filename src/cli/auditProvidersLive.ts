/**
 * POC-001: Step 1 Live Provider Capability Audit CLI Runner
 *
 * Executes the 4-Stage Provider Capability Audit across all 7 external providers:
 * 1. Gemini
 * 2. Groq
 * 3. Google Maps Places & Routes
 * 4. Mistral
 * 5. OpenRouter
 * 6. Alpaca
 * 7. Eulerpool
 *
 * Security Invariant: Zero raw key leakage. Only sha256(key).slice(0, 8) is printed.
 */

import pg from 'pg';
import { loadServerSecrets } from '../mcp/serverSecretLoader.js';
import { ProviderCapabilityAuditor } from '../mcp/providerCapabilityAuditor.js';
import { CentralResearchCore } from '../research/centralResearchCore.js';

async function main() {
  console.log('================================================================');
  console.log('POC-001: STEP 1 RUNTIME & PROVIDER CAPABILITY AUDIT');
  console.log('================================================================');
  console.log(`Audit Timestamp: ${new Date().toISOString()}`);

  // Stage 1: Load secrets safely into memory
  console.log('\n[Stage 1] Loading secrets via serverSecretLoader...');
  const secretSummary = loadServerSecrets();
  console.log(`Secrets Loaded: allConfiguredCount=${secretSummary.allConfiguredCount}`);

  // Initialize PostgreSQL connection
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/market_hft_test';
  const pool = new pg.Pool({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });

  let dbConnected = false;
  try {
    const ping = await pool.query('SELECT NOW() AS now');
    dbConnected = true;
    console.log(`[Database] PostgreSQL connected at ${ping.rows[0].now}`);

    // Ensure database tables are initialized
    const core = new CentralResearchCore(dbUrl);
    await core.initialize();
    await core.close();
  } catch (err: any) {
    console.warn(`[Database] PostgreSQL connection failed (${err.message}). Proceeding with in-memory quota tracking.`);
  }

  // Stage 2 & 3: Run Live Probes & Codebase Audit
  console.log('\n[Stage 2 & 3] Executing Minimal-Quota Live HTTPS Probes & Codebase Integration Audit...');
  const auditor = new ProviderCapabilityAuditor({ pgPool: dbConnected ? pool : null });
  const report = await auditor.executeAudit();

  console.log('\n================================================================');
  console.log('4-STAGE PROVIDER CAPABILITY AUDIT MATRIX');
  console.log('================================================================');

  for (const item of report.providers) {
    const liveIcon = item.live_auth_status === 'AUTHENTICATED_LIVE' ? '✅' : '❌';
    const codeIcon = item.codebase_status === 'WORKING_E2E' ? '🟢' : item.codebase_status === 'PARTIAL_DISCONNECTED' ? '🟡' : '🔴';

    console.log(`\nProvider: ${item.display_name} (${item.provider_id.toUpperCase()})`);
    console.log(`  Category               : ${item.category}`);
    console.log(`  Env Files              : ${item.env_files.join(', ')}`);
    console.log(`  Key Configured         : ${item.key_configured ? 'YES' : 'NO'}`);
    console.log(`  SHA-256 Fingerprint(s) : primary=${item.key_sha256_prefix8 ?? 'N/A'}${item.secondary_key_sha256_prefix8 ? `, secret=${item.secondary_key_sha256_prefix8}` : ''}`);
    console.log(`  Live Handshake Status  : ${liveIcon} ${item.live_auth_status} (HTTP ${item.http_status ?? 'N/A'}, ${item.latency_ms ?? 'N/A'}ms)`);
    console.log(`  Probe Endpoint         : ${item.probe_endpoint}`);
    console.log(`  Codebase Status        : ${codeIcon} ${item.codebase_status}`);
    console.log(`  Underwriting Role      : ${item.downstream_underwriting_role}`);
    console.log(`  Active Consumers       : [${item.downstream_consumers.join(', ')}]`);
    console.log(`  Auditor Notes          : ${item.notes}`);
    if (item.failure_reason) {
      console.log(`  Failure Reason         : ${item.failure_reason}`);
    }
  }

  console.log('\n================================================================');
  console.log('AUDIT SUMMARY & INVENTORY METRICS');
  console.log('================================================================');
  console.log(`Audit ID                       : ${report.audit_id}`);
  console.log(`Provider Count                 : ${report.provider_count}`);
  console.log(`Credential File Count          : ${report.credential_file_count}`);
  console.log(`Credential Count               : ${report.credential_count}`);
  console.log(`Active Adapters (Working E2E)  : ${report.active_adapter_count} / ${report.provider_count}`);
  console.log(`Disconnected Adapters          : ${report.disconnected_adapter_count} / ${report.provider_count}`);
  console.log(`Live Network Authenticated     : ${report.authenticated_live_count} / ${report.provider_count}`);
  console.log(`Merkle Parent (prev_audit_hash): ${report.prev_audit_hash}`);
  console.log(`RFC 8785 JCS SHA-256 Digest    : ${report.jcs_sha256}`);

  // Verify DB persistence
  if (dbConnected) {
    try {
      const dbCheck = await pool.query('SELECT audit_id, executed_at_utc, jcs_sha256 FROM market_provider_audit_log WHERE audit_id = $1', [report.audit_id]);
      if (dbCheck.rows.length > 0) {
        console.log(`Database Audit Persistence     : ✅ PERSISTED (table: market_provider_audit_log)`);
      } else {
        console.warn(`Database Audit Persistence     : ⚠️ Row not found in market_provider_audit_log`);
      }
    } catch (err: any) {
      console.warn(`Database Audit Verification error: ${err.message}`);
    }
    await pool.end();
  }

  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Fatal Provider Capability Audit Error:', err);
  process.exit(1);
});
