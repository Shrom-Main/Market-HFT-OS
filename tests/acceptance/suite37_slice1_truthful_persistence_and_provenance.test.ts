/**
 * Gate Slice 1 (Decision OD-25 / Charter DEC-025):
 * Truthful Persistence, Provenance Hardening & Attribution Baseline Suite
 *
 * Normative Acceptance Test Suite verifying:
 * 1. SLICE1-PERSIST-001: PostgreSQL table creation and live query health check returning SELECT 1, row counts across 5 tables, and latency_ms.
 * 2. SLICE1-RESTART-002: Cross-restart state persistence proves state manager hydrates products and signal traces 100% across instances.
 * 3. SLICE1-CONN-IDLE-003: Truthful connector idle state at boot transitioning to ACTIVE only upon verified signal ingestion.
 * 4. SLICE1-SPOOF-004: Caller origin spoofing rejection blocks unverified caller self-attestations without phantom ledger events.
 * 5. SLICE1-ECONOMICS-005: Pure BigInt rational economics eliminates hardcoded 38.21 -> 37.85 and calculates product-specific delta or returns DATA_REQUIRED.
 * 6. SLICE1-GROQ-ATTR-006: Truthful Groq attribution returns deterministic template fallback without fake model name.
 * 7. SLICE1-REST-ENDPOINTS-007: Live REST endpoints return truthful persistence, connector, and attribution telemetry.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  CentralResearchCore,
  DurableEvidenceStore,
  EvidenceProvenanceVerifier,
  McpToolProof
} from '../../src/research/centralResearchCore.js';
import { GroqResearchSynthesizer } from '../../src/research/groqResearchSynthesizer.js';
import { BundleEvaluator } from '../../src/research/bundleEvaluator.js';
import { KillSwitchController } from '../../src/terminal/operatorTerminalController.js';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import { ProductObservationItem } from '../../src/mcp/contracts/productObservationContract.js';
import { sha256 } from '../../src/canonical/crypto.js';

describe('Suite 37: Gate Slice 1 Truthful Persistence, Provenance & Attribution Baseline', () => {
  let server: WorkstationServer;
  let serverPort: number;

  function httpRequest(options: {
    port: number;
    path: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json: any }> {
    return new Promise((resolve, reject) => {
      const defaultHeaders: Record<string, string> = {
        Host: `127.0.0.1:${options.port}`,
        Origin: `http://127.0.0.1:${options.port}`,
        ...(options.headers || {})
      };

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: options.port,
          path: options.path,
          method: options.method || 'GET',
          headers: defaultHeaders
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            let parsedJson: any = null;
            try {
              parsedJson = JSON.parse(data);
            } catch {
              // Non-JSON response
            }
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: data,
              json: parsedJson
            });
          });
        }
      );

      req.on('error', (err) => reject(err));

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  beforeAll(async () => {
    // Launch WorkstationServer on ephemeral port (SRV-04 isolation)
    server = new WorkstationServer({ port: 0 });
    const started = await server.start();
    serverPort = started.port;
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  // --------------------------------------------------------------------------
  // 1. PostgreSQL Schema & Health Check
  // --------------------------------------------------------------------------
  it('SLICE1-PERSIST-001: PostgreSQL table creation and live query health check returning SELECT 1, row counts across 5 tables, and latency_ms', async () => {
    const core = new CentralResearchCore();
    await core.initialize();

    const ping = await core.pingDatabase();
    expect(ping.is_connected).toBe(true);
    expect(typeof ping.latency_ms).toBe('number');
    expect(ping.latency_ms).toBeGreaterThanOrEqual(0);

    // Verify all 5 Slice 1 tables are tracked with row counts
    const counts = ping.table_row_counts;
    expect(counts).toBeDefined();
    expect(typeof counts?.market_bitemporal_evidence).toBe('number');
    expect(typeof counts?.market_event_overlays).toBe('number');
    expect(typeof counts?.market_signal_traces).toBe('number');
    expect(typeof counts?.market_product_deck_state).toBe('number');
    expect(typeof counts?.market_connector_telemetry).toBe('number');

    expect(counts!.market_product_deck_state).toBeGreaterThanOrEqual(8);

    await core.getEvidenceStore().close();
  });

  // --------------------------------------------------------------------------
  // 2. Cross-Restart State Persistence
  // --------------------------------------------------------------------------
  it('SLICE1-RESTART-002: Cross-restart state persistence proves state manager hydrates products and signal traces 100% across instances', async () => {
    const smA = new WorkstationStateManager();
    await smA.hydrateFromDatabase();

    const testNonce = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const customProductId = `prod:titanium:hex-bolt-${testNonce}`;

    // 1. Push a custom observation through smA
    const customProduct = await smA.pushProductObservation({
      product_id: customProductId,
      sku_id: `SKU-TI-M8-${testNonce}`,
      name: 'Titanium Grade 5 Hex Bolt M8x40 (Aero Spec)',
      category: 'Aerospace Fasteners',
      commercial_archetype: 'MRO_INDUSTRIAL',
      observed_grievance: 'Thread galling during torque-up without anti-seize',
      upstream_hub_name: 'Bangalore Precision Aerospace Cluster',
      upstream_factory_quote_inr: 165.0,
      retail_asp_inr: 395.0,
      strategic_decision: 'PURSUE'
    });

    expect(customProduct.product_id).toBe(customProductId);

    // 2. Ingest a signal trace through smA
    const signalTrace = await smA.ingestSignalEnvelope({
      channel: 'MARKETPLACE_OR_SUPPLIER_HTML',
      source_id: 'conn:marketplace:amazon-in',
      target_url: `https://www.amazon.in/dp/B0TI${testNonce}`,
      raw_payload: {
        product_id: customProductId,
        unit_price_subunits: '16500000',
        raw_quote_inr: 165.0,
        freight_cost_inr: 8.5,
        packaging_cost_inr: 4.0,
        gst_rate_bps: 1800
      }
    });

    expect(signalTrace.final_status).toBe('PROCESSED');
    const traceId = signalTrace.trace_id;

    // 3. Simulate process restart: instantiate clean smB without memory of smA
    const smB = new WorkstationStateManager();
    expect(smB.getProductById(customProductId)).toBeUndefined();
    expect(smB.getSignalTrace(traceId)).toBeUndefined();

    // 4. Hydrate smB from PostgreSQL
    await smB.hydrateFromDatabase();

    // 5. Verify product, signal trace, and deduplication survived restart
    const restoredProduct = smB.getProductById(customProductId);
    expect(restoredProduct).toBeDefined();
    expect(restoredProduct?.name).toBe('Titanium Grade 5 Hex Bolt M8x40 (Aero Spec)');
    expect(restoredProduct?.upstream_supply.hub_name).toBe('Bangalore Precision Aerospace Cluster');
    expect(restoredProduct?.strategy.strategic_decision).toBe('PURSUE');

    const restoredTrace = smB.getSignalTrace(traceId);
    expect(restoredTrace).toBeDefined();
    expect(restoredTrace?.trace_id).toBe(traceId);
    expect(restoredTrace?.final_status).toBe('PROCESSED');

    // Deduplication must also survive across restarts: re-ingesting identical raw payload is ignored
    const dupTrace = await smB.ingestSignalEnvelope({
      channel: 'MARKETPLACE_OR_SUPPLIER_HTML',
      source_id: 'conn:marketplace:amazon-in',
      target_url: `https://www.amazon.in/dp/B0TI${testNonce}`,
      raw_payload: {
        product_id: customProductId,
        unit_price_subunits: '16500000',
        raw_quote_inr: 165.0,
        freight_cost_inr: 8.5,
        packaging_cost_inr: 4.0,
        gst_rate_bps: 1800
      }
    });
    expect(dupTrace.final_status).toBe('DUPLICATE_IGNORED');
  });

  // --------------------------------------------------------------------------
  // 3. Truthful Connector Idle State
  // --------------------------------------------------------------------------
  it('SLICE1-CONN-IDLE-003: Truthful connector idle state at boot transitioning to ACTIVE only upon verified signal ingestion', async () => {
    const sm = new WorkstationStateManager();
    const bootConnectors = sm.getSourceConnectors();

    expect(bootConnectors.length).toBe(5);
    for (const conn of bootConnectors) {
      expect(conn.status).toBe('IDLE_NEVER_RUN');
      expect(conn.ingested_count).toBe(0);
      expect(conn.last_heartbeat_utc).toBeNull();
      expect(conn.last_successful_fetch_utc).toBeNull();
      expect(conn.freshness_age_seconds).toBeNull();
    }

    // Ingest a signal targeting IndiaMART connector
    const testNonce = `${Date.now()}-${Math.random()}`;
    await sm.ingestSignalEnvelope({
      channel: 'MARKETPLACE_OR_SUPPLIER_HTML',
      source_id: 'conn:supplier:indiamart',
      target_url: `https://www.indiamart.com/proddetail/test-${testNonce}.html`,
      raw_payload: {
        supplier_id: `SUP-${testNonce}`,
        sku_id: 'SKU-SS304-16-25MM-P10',
        raw_quote_inr: 3.45,
        freight_cost_inr: 0.12,
        packaging_cost_inr: 0.08
      }
    });

    const activeConnectors = sm.getSourceConnectors();
    const indiamartConn = activeConnectors.find((c) => c.connector_id === 'conn:supplier:indiamart')!;
    expect(indiamartConn.status).toBe('ACTIVE');
    expect(indiamartConn.ingested_count).toBe(1);
    expect(indiamartConn.last_successful_fetch_utc).not.toBeNull();
    expect(indiamartConn.freshness_age_seconds).not.toBeNull();

    // Untouched connectors must remain IDLE_NEVER_RUN
    const macroConn = activeConnectors.find((c) => c.connector_id === 'conn:macro:rbi-fbil-lme')!;
    expect(macroConn.status).toBe('IDLE_NEVER_RUN');
    expect(macroConn.ingested_count).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 4. Caller Origin Spoofing Rejection
  // --------------------------------------------------------------------------
  it('SLICE1-SPOOF-004: Caller origin spoofing rejection blocks unverified caller self-attestations without phantom ledger events', async () => {
    const sm = new WorkstationStateManager();
    const testNonce = `${Date.now()}-${Math.random()}`;

    // Caller maliciously claims LIVE_VERIFIED_CAPTURE without cryptographic proof
    const trace = await sm.ingestSignalEnvelope({
      channel: 'MARKETPLACE_OR_SUPPLIER_HTML',
      source_id: 'conn:marketplace:amazon-in',
      target_url: `https://www.amazon.in/dp/B0SPOOF${testNonce}`,
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      raw_payload: {
        supplier_id: `SUP-SPOOF-${testNonce}`,
        sku_id: 'SKU-SS304-16-25MM-P10',
        raw_quote_inr: 3.50,
        freight_cost_inr: 0.15,
        packaging_cost_inr: 0.10
      }
    });

    // Verification must fail-closed: demote caller's unverified self-attestation and overwrite stored origin_class
    expect(trace.raw_input_stage.origin_class).toBe('UNATTESTED_USER_INTAKE');
    expect(trace.raw_input_stage.claimed_origin_rejected).toBe('LIVE_VERIFIED_CAPTURE');
    expect(trace.evidence_record_stage?.verification_status).toBe('UNVERIFIED');
    expect(trace.evidence_record_stage?.provenance_lineage).toContain('UNATTESTED_USER_INTAKE');
    expect(trace.evidence_record_stage?.provenance_lineage).not.toContain('LIVE_VERIFIED_CAPTURE');

    // McpRunLedger must contain 0 phantom tool-call executions for this signal
    const ledger = sm.getMcpRunLedger();
    const events = ledger.getEvents();
    const phantomEvents = events.filter(
      (e) => (e.details as any)?.signal_id === trace.signal_id && e.event_type === 'TOOL_CALL_INVOKED'
    );
    expect(phantomEvents.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 5. Pure BigInt Rational Economics
  // --------------------------------------------------------------------------
  it('SLICE1-ECONOMICS-005: Pure BigInt rational economics eliminates hardcoded 38.21 -> 37.85 and calculates product-specific delta or returns DATA_REQUIRED', async () => {
    const sm = new WorkstationStateManager();
    const testNonce = `${Date.now()}-${Math.random()}`;

    // 5A: Missing financial fields returns DATA_REQUIRED and null after-economics
    const missingTrace = await sm.ingestSignalEnvelope({
      channel: 'YOUTUBE_VIDEO_TRANSCRIPT',
      source_id: 'conn:media:youtube-reviews',
      target_url: `https://www.youtube.com/watch?v=review-${testNonce}`,
      raw_payload: {
        video_id: `vid-${testNonce}`,
        commentary: 'High quality finish but pricing not mentioned.'
      }
    });

    expect(missingTrace.economic_and_gate_impact_stage?.economic_impact_status).toBe('DATA_REQUIRED');
    expect(missingTrace.economic_and_gate_impact_stage?.landed_cost_after_inr).toBeNull();
    expect(missingTrace.economic_and_gate_impact_stage?.rowc_after_bps).toBeNull();
    expect(missingTrace.economic_and_gate_impact_stage?.allocation_gate_status).toBe('HOLD_DATA_REQUIRED');

    // Ensure legacy hardcoded numbers never leak
    expect(missingTrace.economic_and_gate_impact_stage?.landed_cost_before_inr).not.toBe(38.21);
    expect(missingTrace.economic_and_gate_impact_stage?.landed_cost_after_inr).not.toBe(37.85);

    // 5B: Full quote for SS304 computes deterministic BigInt economics
    const fullTrace = await sm.ingestSignalEnvelope({
      channel: 'MARKETPLACE_OR_SUPPLIER_HTML',
      source_id: 'conn:supplier:indiamart',
      target_url: `https://www.indiamart.com/proddetail/ss304-exact-${testNonce}.html`,
      raw_payload: {
        product_id: 'prod:din3017:ss304:16-25mm:pack-10',
        raw_quote_inr: 3.20,
        freight_cost_inr: 0.12,
        packaging_cost_inr: 0.08,
        gst_rate_bps: 1800
      }
    });

    expect(fullTrace.economic_and_gate_impact_stage?.economic_impact_status).toBe('CALCULATED');
    expect(fullTrace.economic_and_gate_impact_stage?.landed_cost_before_inr).not.toBeNull();
    expect(fullTrace.economic_and_gate_impact_stage?.landed_cost_after_inr).not.toBeNull();
    expect(fullTrace.economic_and_gate_impact_stage?.rowc_after_bps).not.toBeNull();

    // Landed cost before is ₹14.78 (SS304 pack-10 baseline from factory quote ₹13.20 * 1.12)
    expect(fullTrace.economic_and_gate_impact_stage?.landed_cost_before_inr).toBe(14.78);
    // Landed cost after: (3.20 + 0.12 + 0.08) * 1.18 = 4.012
    expect(fullTrace.economic_and_gate_impact_stage?.landed_cost_after_inr).toBe(4.012);
    // ROWC after must be calculated and positive
    expect(fullTrace.economic_and_gate_impact_stage?.rowc_after_bps).toBeGreaterThan(0);
    // Ensure old hardcoded 37.85 and 4120 are eliminated
    expect(fullTrace.economic_and_gate_impact_stage?.landed_cost_after_inr).not.toBe(37.85);
    expect(fullTrace.economic_and_gate_impact_stage?.rowc_after_bps).not.toBe(4120);
  });

  // --------------------------------------------------------------------------
  // 6. Truthful Groq Attribution
  // --------------------------------------------------------------------------
  it('SLICE1-GROQ-ATTR-006: Truthful Groq attribution returns deterministic template fallback without fake model name', async () => {
    // Instantiate synthesizer without live API key to test offline fallback
    const synthesizer = new GroqResearchSynthesizer({ apiKey: 'invalid-test-key' });
    const sm = new WorkstationStateManager();
    const product = sm.getProductById('prod:din3017:ss304:16-25mm:pack-10')!;

    const thesis = await synthesizer.synthesizeResearchThesis(product, [
      'Clamps snapped under torque'
    ]);

    expect(thesis.llm_called).toBe(false);
    expect(thesis.generation_mode).toBe('DETERMINISTIC_TEMPLATE_FALLBACK');
    expect(thesis.llm_model).toBeNull();
    expect(thesis.thesis_synthesis.length).toBeGreaterThan(20);
    expect(thesis.unserved_pain_points.length).toBeGreaterThan(0);
    expect(thesis.engineered_edge_suggestions.length).toBeGreaterThan(0);
    expect(thesis.cited_evidence_quotes).toEqual(['Clamps snapped under torque']);
  });

  // --------------------------------------------------------------------------
  // 7. Live REST Endpoints Health, DB, Inbox & AI Attribution
  // --------------------------------------------------------------------------
  it('SLICE1-REST-ENDPOINTS-007: Live REST endpoints return truthful persistence, connector, and attribution telemetry', async () => {
    // 7A: GET /api/health
    const healthRes = await httpRequest({
      port: serverPort,
      path: '/api/health'
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json.status).toBe('HEALTHY');
    expect(healthRes.json.postgres_connected).toBe(true);
    expect(typeof healthRes.json.postgres_latency_ms).toBe('number');
    expect(healthRes.json.postgres_latency_ms).toBeGreaterThanOrEqual(0);
    expect(healthRes.json.postgres_row_counts).toBeDefined();

    // 7B: GET /api/health/db
    const dbRes = await httpRequest({
      port: serverPort,
      path: '/api/health/db'
    });
    expect(dbRes.statusCode).toBe(200);
    expect(dbRes.json.is_connected).toBe(true);
    expect(dbRes.json.latency_ms).toBeGreaterThanOrEqual(0);
    expect(dbRes.json.table_row_counts.market_signal_traces).toBeGreaterThanOrEqual(0);
    expect(dbRes.json.table_row_counts.market_product_deck_state).toBeGreaterThanOrEqual(8);
    expect(dbRes.json.table_row_counts.market_connector_telemetry).toBeGreaterThanOrEqual(5);

    // 7C: GET /api/signals/inbox
    const inboxRes = await httpRequest({
      port: serverPort,
      path: '/api/signals/inbox'
    });
    expect(inboxRes.statusCode).toBe(200);
    expect(inboxRes.json.connectors.length).toBe(5);
    const connStatuses = inboxRes.json.connectors.map((c: any) => c.status);
    expect(connStatuses.some((s: string) => s === 'IDLE_NEVER_RUN' || s === 'ACTIVE')).toBe(true);

    // 7D: POST /api/ai/analyze returns truthful fallback attribution
    const aiRes = await httpRequest({
      port: serverPort,
      path: '/api/ai/analyze',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: 'prod:din3017:ss304:16-25mm:pack-10'
      })
    });
    expect(aiRes.statusCode).toBe(200);
    expect(aiRes.json.llm_called).toBe(false);
    expect(aiRes.json.generation_mode).toBe('DETERMINISTIC_TEMPLATE_FALLBACK');
    expect(aiRes.json.llm_model).toBeNull();
    expect(aiRes.json.thesis_synthesis).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 8. Cryptographic HMAC-SHA256 & Payload Binding Verification
  // --------------------------------------------------------------------------
  it('SLICE1-CRYPTO-HMAC-008: Genuine HMAC-SHA256 signature verification and payload binding fail closed on tampering', () => {
    const rawPayload = JSON.stringify({ catalog_id: 'IND-991', quote_inr: 45.0 });
    const payloadHash = sha256(rawPayload);

    // Valid proof
    const validProof = EvidenceProvenanceVerifier.signProof({
      tool_run_id: 'task-test-run-001',
      worker_id: 'worker:source-capture:v1',
      dns_pre_resolution_ip: '157.240.22.35', // Valid public IP
      http_status: 200,
      wall_clock_ms: 85,
      raw_payload_sha256: payloadHash
    });

    const legitVerification = EvidenceProvenanceVerifier.verifyAndNormalizeOrigin(
      'LIVE_VERIFIED_CAPTURE',
      validProof,
      'https://indiamart.com/proddetail/item.html',
      rawPayload
    );
    expect(legitVerification.origin_class).toBe('LIVE_VERIFIED_CAPTURE');
    expect(legitVerification.is_attested).toBe(true);

    // Tampered payload: payload content altered after signing
    const tamperedPayload = JSON.stringify({ catalog_id: 'IND-991', quote_inr: 35.0 });
    const tamperedVerification = EvidenceProvenanceVerifier.verifyAndNormalizeOrigin(
      'LIVE_VERIFIED_CAPTURE',
      validProof,
      'https://indiamart.com/proddetail/item.html',
      tamperedPayload
    );
    expect(tamperedVerification.origin_class).toBe('UNATTESTED_USER_INTAKE');
    expect(tamperedVerification.is_attested).toBe(false);
    expect(tamperedVerification.verification_notes).toContain('Payload SHA-256 mismatch');

    // Tampered HMAC signature
    const badSigProof: McpToolProof = {
      ...validProof,
      hmac_signature: 'deadbeef'.repeat(8)
    };
    const badSigVerification = EvidenceProvenanceVerifier.verifyAndNormalizeOrigin(
      'LIVE_VERIFIED_CAPTURE',
      badSigProof,
      'https://indiamart.com/proddetail/item.html',
      rawPayload
    );
    expect(badSigVerification.origin_class).toBe('UNATTESTED_USER_INTAKE');
    expect(badSigVerification.is_attested).toBe(false);
    expect(badSigVerification.verification_notes).toContain('HMAC-SHA256 signature mismatch');
  });

  // --------------------------------------------------------------------------
  // 9. Disallowed DNS IP Rejection (Placeholder, Loopback, Private RFC 1918)
  // --------------------------------------------------------------------------
  it('SLICE1-DNS-IP-009: Disallowed DNS IP rejection blocks placeholder 104.26.12.34, loopback, and RFC 1918 addresses', () => {
    const rawPayload = '{"status": "ok"}';
    const payloadHash = sha256(rawPayload);

    const disallowedIps = [
      '104.26.12.34',     // Synthetic placeholder
      '127.0.0.1',        // IPv4 Loopback
      'localhost',        // Named loopback
      '::1',              // IPv6 Loopback
      '10.0.0.1',         // Class A RFC 1918
      '192.168.1.1',      // Class C RFC 1918
      '172.16.0.1',       // Class B RFC 1918 lower bound
      '172.31.255.255',   // Class B RFC 1918 upper bound
      '169.254.169.254'   // Link-local / metadata endpoint
    ];

    for (const ip of disallowedIps) {
      const proofWithBadIp = EvidenceProvenanceVerifier.signProof({
        tool_run_id: `task-ip-test-${Date.now()}`,
        worker_id: 'worker:source-capture:v1',
        dns_pre_resolution_ip: ip,
        http_status: 200,
        wall_clock_ms: 50,
        raw_payload_sha256: payloadHash
      });

      const verification = EvidenceProvenanceVerifier.verifyAndNormalizeOrigin(
        'LIVE_VERIFIED_CAPTURE',
        proofWithBadIp,
        'https://indiamart.com/proddetail/item.html',
        rawPayload
      );

      expect(verification.origin_class).toBe('UNATTESTED_USER_INTAKE');
      expect(verification.is_attested).toBe(false);
      expect(verification.verification_notes).toContain('Disallowed DNS pre-resolution IP');
    }
  });

  // --------------------------------------------------------------------------
  // 10. Bundle Evaluator Unsafe Defaults & Commit Gate Elimination
  // --------------------------------------------------------------------------
  it('SLICE1-BUNDLE-DEFAULTS-010: Bundle evaluator rejects missing capital and missing products, and blocks unqualified commits', () => {
    const evaluator = new BundleEvaluator();
    const ksController = new KillSwitchController();
    const stateManager = new WorkstationStateManager();
    const products = stateManager.getProductObservationDeck().products;

    // 10A: Missing or non-positive capital throws E-BUNDLE-NO-CAPITAL
    expect(() => {
      evaluator.evaluateBundle({ target_capital_inr: 0, selected_product_ids: ['prod:din3017:ss304:16-25mm:pack-10'] }, products);
    }).toThrow(/E-BUNDLE-NO-CAPITAL/);

    expect(() => {
      evaluator.evaluateBundle({ selected_product_ids: ['prod:din3017:ss304:16-25mm:pack-10'] }, products);
    }).toThrow(/E-BUNDLE-NO-CAPITAL/);

    // 10B: Missing or empty products throws E-BUNDLE-NO-PRODUCTS
    expect(() => {
      evaluator.evaluateBundle({ target_capital_inr: 250000, selected_product_ids: [] }, products);
    }).toThrow(/E-BUNDLE-NO-PRODUCTS/);

    expect(() => {
      evaluator.evaluateBundle({ target_capital_inr: 250000 }, products);
    }).toThrow(/E-BUNDLE-NO-PRODUCTS/);

    // 10C: Product with missing pricing yields DATA_REQUIRED_HOLD and blocks commit
    const incompleteProduct: ProductObservationItem = {
      ...products[0],
      product_id: 'prod:incomplete:pricing',
      upstream_supply: {
        ...products[0].upstream_supply,
        factory_gate_quote_inr: 0 // Missing quote
      }
    };

    const incompleteEval = evaluator.evaluateBundle(
      {
        intent_id: 'INTENT-INCOMPLETE',
        operator_id: 'operator:audit',
        target_capital_inr: 100000,
        selected_product_ids: ['prod:incomplete:pricing']
      },
      [incompleteProduct]
    );

    expect(incompleteEval.recommended_disposition).toBe('DATA_REQUIRED_HOLD');
    expect(incompleteEval.mathematical_rationale).toContain('DATA_REQUIRED');

    // Attempting to commit an unqualified bundle throws E-BUNDLE-UNQUALIFIED-COMMIT-BLOCKED
    expect(() => {
      evaluator.commitBundleToPaperSimulation(
        incompleteEval,
        {
          operator_id: 'operator:audit',
          action_type: 'APPROVE_PAPER_ALLOCATION',
          target_entity_id: incompleteEval.bundle_id,
          explicit_rationale: 'Attempting to commit unqualified bundle with missing pricing',
          confirmation_token: 'tok-unqualified',
          confirmed_at_utc: new Date().toISOString()
        },
        ksController
      );
    }).toThrow(/E-BUNDLE-UNQUALIFIED-COMMIT-BLOCKED/);
  });

  // --------------------------------------------------------------------------
  // 11. Truthful Research Fixture Origin Stamping (Zero False LIVE_VERIFIED_CAPTURE)
  // --------------------------------------------------------------------------
  it('SLICE1-RESEARCH-PROVENANCE-011: executeTargetedProductResearch produces RECORDED_GOLDEN_FIXTURE and ESTIMATED_PROXY', async () => {
    const stateManager = new WorkstationStateManager();
    const core = stateManager.getCentralResearchCore();

    const outcome = await stateManager.researchProduct({
      product_id: 'prod:brass:ball-valve:1-2in-pn20'
    });

    expect(outcome.product_id).toBe('prod:brass:ball-valve:1-2in-pn20');
    expect(outcome.strategy.research_case_status).toBe('ADVERSARIAL_REVIEW');

    const promoted = core.queryEvidence('prod:brass:ball-valve:1-2in-pn20');
    expect(promoted.length).toBeGreaterThan(0);

    for (const ev of promoted) {
      expect(ev.origin.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');
      expect(ev.origin.is_attested).toBe(false);
      expect(ev.epistemic_class).toBe('ESTIMATED_PROXY');
      expect(ev.origin.dns_pre_resolution_ip).toBeUndefined();
      expect(ev.origin.verification_notes).toContain('Locally executed research fixture');
    }
  });

  // --------------------------------------------------------------------------
  // 12. Fail-Closed PostgreSQL Persistence
  // --------------------------------------------------------------------------
  it('SLICE1-DB-FAIL-CLOSED-012: Durable store write operations throw E-DB-PERSISTENCE-FAILED when database is unavailable', async () => {
    // DurableEvidenceStore pointed to invalid connection string / offline port
    const offlineStore = new DurableEvidenceStore('postgresql://postgres@localhost:54399/market_hft_offline');

    const sampleEvidence: any = {
      evidence_id: 'EVID-OFFLINE-TEST',
      product_id: 'prod:test',
      channel: 'SOURCING_COSTS',
      observed_at_utc: new Date().toISOString(),
      as_of_utc: new Date().toISOString(),
      payload_sha256: 'hash123',
      raw_payload: '{}',
      extracted_claims: {},
      origin: {
        origin_class: 'RECORDED_GOLDEN_FIXTURE',
        source_url: 'fixture://test',
        captured_at_utc: new Date().toISOString(),
        cryptographic_hash: 'hash123',
        is_attested: false
      },
      epistemic_class: 'ESTIMATED_PROXY',
      jcs_sha256: 'jcs123'
    };

    await expect(offlineStore.storeEvidence(sampleEvidence)).rejects.toThrow(/E-DB-PERSISTENCE-FAILED/);

    const sampleOverlay: any = {
      event_id: 'EVT-OFFLINE-TEST',
      product_id: 'prod:test',
      event_type: 'GRIEVANCE_SPIKE',
      event_timestamp_utc: new Date().toISOString(),
      as_of_utc: new Date().toISOString(),
      severity: 'INFO',
      title: 'Offline Event',
      summary: 'Offline Event Summary',
      source_citation: 'Test'
    };
    await expect(offlineStore.storeEventOverlay(sampleOverlay)).rejects.toThrow(/E-DB-PERSISTENCE-FAILED/);

    const sampleTrace: any = {
      trace_id: 'TRACE-OFFLINE',
      signal_id: 'SIG-OFFLINE',
      channel: 'MARKETPLACE_OR_SUPPLIER_HTML',
      created_at_utc: new Date().toISOString(),
      final_status: 'PROCESSED',
      jcs_sha256: 'hash'
    };
    await expect(offlineStore.storeSignalTrace(sampleTrace)).rejects.toThrow(/E-DB-PERSISTENCE-FAILED/);

    const sampleProduct: any = {
      product_id: 'prod:offline',
      sku_id: 'SKU-OFFLINE',
      name: 'Offline Product',
      category: 'TEST',
      commercial_archetype: 'COMMODITY_ARBITRAGE'
    };
    await expect(offlineStore.storeProductDeckItem(sampleProduct)).rejects.toThrow(/E-DB-PERSISTENCE-FAILED/);

    const sampleBundle: any = {
      bundle_id: 'BNDL-OFFLINE',
      committed_at_utc: new Date().toISOString(),
      allocated_capital_inr: 100000,
      status: 'COMMITTED_TO_PAPER_SIMULATION',
      evaluation: {
        bundle_id: 'BNDL-OFFLINE',
        intent: { intent_id: 'INTENT-OFFLINE' },
        scenarios: {
          base: { annualized_rowc_bps: 2500 }
        }
      },
      jcs_sha256: 'bundlehash'
    };
    await expect(offlineStore.storeCommittedBundle(sampleBundle)).rejects.toThrow(/E-DB-PERSISTENCE-FAILED/);

    await offlineStore.close();
  });

  afterAll(async () => {
    const store = new DurableEvidenceStore();
    await store.initializeTables().catch(() => {});
    const pool = store.getPgPool();
    if (pool) {
      await pool.query(`
        DELETE FROM market_product_deck_state WHERE product_id LIKE 'prod:titanium:%' OR product_id LIKE 'prod:test:%';
        DELETE FROM market_signal_traces WHERE signal_id LIKE 'sig:test:%' OR trace_id LIKE 'TRACE-TEST-%';
      `).catch(() => {});
      await store.close().catch(() => {});
    }
  });
});
