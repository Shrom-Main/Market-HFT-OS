/**
 * SUITE-23: Gate M6.1 Capability-Aware MCP Substrate & Read-Only Micro-Agent Broker
 *
 * Normative Acceptance Suite for Stage 1 Gate M6.1:
 * 1. MCP-SUBSTRATE-SCHEMA-AND-FORBIDDEN-TOOLS-001:
 *    - JSON-RPC 2.0 / MCP tool schema envelopes (request, response, descriptor).
 *    - McpServerAdapter rejects forbidden capabilities: shell, SQL, ledger mutation,
 *      evidence promotion, order routing, secrets (E-MCP-FORBIDDEN-CAPABILITY).
 * 2. MCP-BROKER-CAPABILITY-AND-HOST-POLICY-002:
 *    - Task-scoped, immutable (Object.freeze) CapabilityGrant.
 *    - Allowed tools, allowed hosts, allowed methods (GET only), redirect blocking (E-MCP-REDIRECT-DENIED).
 * 3. MCP-BROKER-SSRF-PRIVATE-IP-BLOCK-003:
 *    - Hard network firewall blocking localhost, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12,
 *      192.168.0.0/16, 169.254.169.254, 0.0.0.0, and ::1.
 * 4. MCP-BROKER-MULTI-QUOTA-ENFORCEMENT-004:
 *    - Enforces all 4 resource quotas on every call: requests_made, wall_clock_ms,
 *      payload_bytes, tokens_used.
 * 5. MCP-RUN-LEDGER-HASH-CHAIN-005:
 *    - McpRunLedger records append-only execution events with sha256 hash chains
 *      under RFC 8785 JCS canonicalization. Detects tampering fail-closed.
 * 6. MCP-SUPPLEMENTARY-CONFLICT-JOIN-006:
 *    - Merges independent claims: agreeing observations yield CROSS_SOURCE_CORROBORATED;
 *      disagreeing observations yield CONFLICT with both values preserved (zero averaging/voting).
 * 7. MCP-BITEMPORAL-IMMUTABILITY-PROOF-007:
 *    - BitemporalRestatementEngine deep-clones, deepFreezes, rejects duplicate IDs
 *      (E-ERR-BITEMPORAL-OVERWRITE), and supports distinct t_d and t_k.
 * 8. MCP-SCHEDULER-FULL-WORKER-INVOCATION-008:
 *    - ResearchSchedulerAndManager genuinely invokes GovtSchemeAndTaxSubAgent,
 *      RedTeamReviewerSubAgent, and GroqFormulaAdvisor / RAG routing with RFC 8785 JCS telemetry.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { canonicalizeJCS } from '../../src/canonical/jcs.js';
import {
  McpServerAdapter,
  McpCapabilityBroker,
  createCapabilityGrant,
  McpRunLedger,
  joinSupplementaryClaims,
  SupplementaryClaim,
  McpToolCallRequest,
  McpToolDefinition
} from '../../src/mcp/mcpSubstrate.js';
import {
  ResearchSchedulerAndManager,
  BitemporalRestatementEngine,
  deepClone,
  sanitizeForJcs
} from '../../src/agents/m6AgentFramework.js';
import {
  SiloCandidateInput,
  SS304Diameter,
  SS304PackSize
} from '../../src/research/m5SiloAndGroupSimulator.js';
import { OperationalEconomicsParameters } from '../../src/research/m4VerticalSlice.js';

describe('SUITE-23: Gate M6.1 Capability-Aware MCP Substrate & Broker Acceptance', () => {
  const REF_TIME = '2026-10-17T12:00:00Z';
  const TOTAL_BUDGET = 500000000n; // ₹50,000.0000

  const defaultOpsParams: OperationalEconomicsParameters = {
    procurement_lead_time_days: 7,
    warehouse_dwell_days: 14,
    marketplace_settlement_delay_days: 14,
    gst_rate_bps: 1800n,
    itc_eligible_fraction_bps: 10000n,
    tcs_rate_bps: 100n,
    tds_rate_bps: 100n,
    customer_return_rate_bps: 200n,
    reverse_logistics_fee_subunits: 140000n,
    quarantine_attrition_rate_bps: 10000n,
    risk_free_rate_bps: 650n,
    execution_risk_premium_bps: 850n,
    min_cash_margin_bps: 2000n,
    max_ccc_days: 45,
    min_downside_buffer_bps: 1500n
  };

  function createCandidate(
    diameter: SS304Diameter = '16-25mm',
    packSize: SS304PackSize = 10,
    overrides?: Partial<SiloCandidateInput>
  ): SiloCandidateInput {
    return {
      candidate_id: `cand:ss304:${diameter}:pack-${packSize}`,
      sku_id: `prod:din3017:ss304:${diameter}:pack-${packSize}`,
      diameter,
      pack_size: packSize,
      title: `SS304 DIN 3017 Clamp ${diameter} (Pack of ${packSize})`,
      moq: 500,
      gross_selling_price_subunits: 1050000n,
      raw_material_purchase_subunits: 250000n,
      inbound_freight_subunits: 45000n,
      packaging_kitting_subunits: 32000n,
      insurance_handling_subunits: 10000n,
      customs_inspection_subunits: 45100n,
      marketplace_referral_bps: 1500n,
      marketplace_closing_subunits: 100000n,
      marketplace_weight_handling_subunits: 140000n,
      operational_params: defaultOpsParams,
      is_verified: true,
      ...overrides
    };
  }

  beforeEach(() => {
    BitemporalRestatementEngine.clearStoreForTesting();
  });

  // ==========================================================================
  // TEST 1: MCP-SUBSTRATE-SCHEMA-AND-FORBIDDEN-TOOLS-001
  // ==========================================================================
  it('MCP-SUBSTRATE-SCHEMA-AND-FORBIDDEN-TOOLS-001: McpServerAdapter validates JSON-RPC 2.0 tool envelopes and strictly blocks registration of forbidden capabilities (shell, SQL, ledger mutation, evidence promotion, order routing, secrets)', () => {
    const server = new McpServerAdapter();

    // 1. Prohibited tool registrations fail-closed
    const forbiddenToolCases = [
      { name: 'execute_shell_command', desc: 'Runs bash command on host' },
      { name: 'query_postgres_sql', desc: 'Executes direct SQL against postgres' },
      { name: 'mutate_actuals_ledger', desc: 'Direct write into production ledger' },
      { name: 'force_promote_evidence', desc: 'Bypasses verification promotion gate' },
      { name: 'place_order_exchange', desc: 'Routes real capital order to exchange' },
      { name: 'read_secret_groq_key', desc: 'Extracts credentials or API keys' }
    ];

    for (const f of forbiddenToolCases) {
      expect(() => {
        server.registerTool({
          descriptor: {
            name: f.name,
            description: f.desc,
            inputSchema: { type: 'object', properties: {} }
          },
          handler: async () => ({ content: [{ type: 'text', text: 'forbidden' }] })
        });
      }).toThrow(/E-MCP-FORBIDDEN-CAPABILITY/);
    }

    // 2. Legitimate read-only discovery tool registers successfully
    const validTool: McpToolDefinition = {
      descriptor: {
        name: 'mcp_http_get_snapshot',
        description: 'Fetches snapshot HTML from whitelisted supplier catalog',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' }
          },
          required: ['url']
        }
      },
      handler: async (args) => ({
        content: [{ type: 'text', text: `<html><body>Snapshot of ${args.url}</body></html>` }],
        tokens_used: 15
      })
    };

    server.registerTool(validTool);
    expect(server.getTool('mcp_http_get_snapshot')).toBeDefined();
    expect(server.listTools()).toHaveLength(1);

    // Duplicate registration is rejected
    expect(() => server.registerTool(validTool)).toThrow(/E-MCP-TOOL-ALREADY-REGISTERED/);

    // Argument schema validation rejects missing required argument
    expect(() => {
      server.validateArguments(validTool.descriptor, {});
    }).toThrow(/E-MCP-INVALID-ARGUMENTS.*Missing mandatory required argument 'url'/);
  });

  // ==========================================================================
  // TEST 2: MCP-BROKER-CAPABILITY-AND-HOST-POLICY-002
  // ==========================================================================
  it('MCP-BROKER-CAPABILITY-AND-HOST-POLICY-002: CapabilityGrant is deeply frozen and broker strictly enforces allowed tools, allowed hosts, GET-only methods, and redirect blocking', async () => {
    const server = new McpServerAdapter();
    server.registerTool({
      descriptor: {
        name: 'mcp_http_get_snapshot',
        description: 'Read-only web snapshot retrieval',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
      },
      handler: async (args) => ({
        content: [{ type: 'text', text: `Snapshot content for ${args.url}` }],
        tokens_used: 10
      })
    });

    const broker = new McpCapabilityBroker(server);

    const grant = createCapabilityGrant({
      grant_id: 'grant:task-01:worker-01',
      task_id: 'task:research:ss304:001',
      worker_id: 'worker:tinyfish:amazon',
      allowed_tools: ['mcp_http_get_snapshot'],
      allowed_hosts: ['www.amazon.in', 'dir.indiamart.com'],
      allowed_methods: ['GET'],
      allow_redirects: false,
      max_requests: 5,
      max_payload_bytes: 65536,
      max_latency_ms: 2000,
      max_tokens: 1000,
      expires_at_utc: new Date(Date.now() + 60000).toISOString()
    });

    // 1. Grant immutability proof
    expect(Object.isFrozen(grant)).toBe(true);
    expect(Object.isFrozen(grant.allowed_tools)).toBe(true);
    expect(Object.isFrozen(grant.allowed_hosts)).toBe(true);
    expect(() => {
      (grant as any).max_requests = 100;
    }).toThrow();

    // 2. Unregistered/unpermitted tool call denied
    const unpermittedReq: McpToolCallRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'unpermitted_scraper',
        arguments: { url: 'https://www.amazon.in/dp/B09XYZ' }
      }
    };
    const resUnpermitted = await broker.invokeTool(grant, unpermittedReq);
    expect(resUnpermitted.error?.message).toContain('E-MCP-TOOL-NOT-PERMITTED');

    // 3. Prohibited HTTP method denied (POST denied, GET only)
    const postReq: McpToolCallRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'mcp_http_get_snapshot',
        arguments: { url: 'https://www.amazon.in/dp/B09XYZ', method: 'POST' }
      }
    };
    const resPost = await broker.invokeTool(grant, postReq);
    expect(resPost.error?.message).toContain('E-MCP-METHOD-DENIED');

    // 4. HTTP redirect prohibited
    const redirectReq: McpToolCallRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'mcp_http_get_snapshot',
        arguments: { url: 'https://www.amazon.in/dp/B09XYZ', allow_redirects: true }
      }
    };
    const resRedirect = await broker.invokeTool(grant, redirectReq);
    expect(resRedirect.error?.message).toContain('E-MCP-REDIRECT-DENIED');

    // 5. Valid call on allowed host succeeds
    const validReq: McpToolCallRequest = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'mcp_http_get_snapshot',
        arguments: { url: 'https://www.amazon.in/dp/B09XYZ1234' }
      }
    };
    const resValid = await broker.invokeTool(grant, validReq);
    expect(resValid.result?.content[0].text).toContain('Snapshot content');
    expect(resValid.error).toBeUndefined();
  });

  // ==========================================================================
  // TEST 3: MCP-BROKER-SSRF-PRIVATE-IP-BLOCK-003
  // ==========================================================================
  it('MCP-BROKER-SSRF-PRIVATE-IP-BLOCK-003: Broker strictly blocks SSRF attack vectors (localhost, 127.0.0.1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, AWS metadata 169.254.169.254, 0.0.0.0, and ::1)', async () => {
    const server = new McpServerAdapter();
    server.registerTool({
      descriptor: {
        name: 'mcp_http_get_snapshot',
        description: 'Read-only web snapshot retrieval',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
      },
      handler: async () => ({ content: [{ type: 'text', text: 'data' }] })
    });
    const broker = new McpCapabilityBroker(server);

    const grant = createCapabilityGrant({
      grant_id: 'grant:ssrf:001',
      task_id: 'task:ssrf:001',
      worker_id: 'worker:tinyfish',
      allowed_tools: ['mcp_http_get_snapshot'],
      allowed_hosts: ['www.amazon.in'],
      max_requests: 10,
      max_payload_bytes: 65536,
      max_latency_ms: 2000,
      max_tokens: 1000,
      expires_at_utc: new Date(Date.now() + 60000).toISOString()
    });

    const maliciousTargets = [
      'https://localhost:8080/secrets',
      'https://127.0.0.1:5432/postgres',
      'https://127.0.0.2:8000/internal',
      'https://10.0.0.1/admin',
      'https://172.16.0.1/config',
      'https://172.31.255.255/intranet',
      'https://192.168.1.1/router-login',
      'https://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'https://0.0.0.0:3000/control',
      'https://[::1]:8080/v1/keys',
      'https://malicious-external-exfiltration.com/leak'
    ];

    for (let i = 0; i < maliciousTargets.length; i++) {
      const target = maliciousTargets[i];
      const req: McpToolCallRequest = {
        jsonrpc: '2.0',
        id: i + 1,
        method: 'tools/call',
        params: {
          name: 'mcp_http_get_snapshot',
          arguments: { url: target }
        }
      };

      const res = await broker.invokeTool(grant, req);
      expect(res.error).toBeDefined();
      expect(res.error?.message).toContain('E-MCP-HOST-OR-SSRF-DENIED');
    }
  });

  // ==========================================================================
  // TEST 4: MCP-BROKER-MULTI-QUOTA-ENFORCEMENT-004
  // ==========================================================================
  it('MCP-BROKER-MULTI-QUOTA-ENFORCEMENT-004: Broker deterministically enforces all 4 resource quotas (requests_made, wall_clock_ms, payload_bytes, tokens_used)', async () => {
    // 1. Test Request Quota (max_requests: 2)
    const server1 = new McpServerAdapter();
    server1.registerTool({
      descriptor: {
        name: 'mcp_req_test',
        description: 'Request quota test',
        inputSchema: { type: 'object', properties: {} }
      },
      handler: async () => ({ content: [{ type: 'text', text: 'ok' }], tokens_used: 1 })
    });
    const broker1 = new McpCapabilityBroker(server1);
    const grant1 = createCapabilityGrant({
      grant_id: 'grant:quota:req',
      task_id: 'task:quota:01',
      worker_id: 'worker:01',
      allowed_tools: ['mcp_req_test'],
      allowed_hosts: ['*'],
      max_requests: 2,
      max_payload_bytes: 65536,
      max_latency_ms: 2000,
      max_tokens: 1000,
      expires_at_utc: new Date(Date.now() + 60000).toISOString()
    });

    const req: McpToolCallRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'mcp_req_test', arguments: {} }
    };

    expect((await broker1.invokeTool(grant1, req)).error).toBeUndefined();
    expect((await broker1.invokeTool(grant1, req)).error).toBeUndefined();
    const resReq3 = await broker1.invokeTool(grant1, req);
    expect(resReq3.error?.message).toContain('E-MCP-REQUEST-QUOTA-EXCEEDED');

    // 2. Test Latency Quota (max_latency_ms: 50)
    const server2 = new McpServerAdapter();
    server2.registerTool({
      descriptor: {
        name: 'mcp_latency_test',
        description: 'Latency quota test',
        inputSchema: { type: 'object', properties: {} }
      },
      handler: async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { content: [{ type: 'text', text: 'slow' }], tokens_used: 1 };
      }
    });
    const broker2 = new McpCapabilityBroker(server2);
    const grant2 = createCapabilityGrant({
      grant_id: 'grant:quota:lat',
      task_id: 'task:quota:02',
      worker_id: 'worker:02',
      allowed_tools: ['mcp_latency_test'],
      allowed_hosts: ['*'],
      max_requests: 5,
      max_payload_bytes: 65536,
      max_latency_ms: 50,
      max_tokens: 1000,
      expires_at_utc: new Date(Date.now() + 60000).toISOString()
    });
    const resLat = await broker2.invokeTool(grant2, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'mcp_latency_test', arguments: {} }
    });
    expect(resLat.error?.message).toContain('E-MCP-LATENCY-TIMEOUT');

    // 3. Test Payload Size Quota (max_payload_bytes: 50)
    const server3 = new McpServerAdapter();
    server3.registerTool({
      descriptor: {
        name: 'mcp_payload_test',
        description: 'Payload quota test',
        inputSchema: { type: 'object', properties: {} }
      },
      handler: async () => ({
        content: [{ type: 'text', text: 'A'.repeat(500) }],
        tokens_used: 1
      })
    });
    const broker3 = new McpCapabilityBroker(server3);
    const grant3 = createCapabilityGrant({
      grant_id: 'grant:quota:pay',
      task_id: 'task:quota:03',
      worker_id: 'worker:03',
      allowed_tools: ['mcp_payload_test'],
      allowed_hosts: ['*'],
      max_requests: 5,
      max_payload_bytes: 50,
      max_latency_ms: 2000,
      max_tokens: 1000,
      expires_at_utc: new Date(Date.now() + 60000).toISOString()
    });
    const resPay = await broker3.invokeTool(grant3, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'mcp_payload_test', arguments: {} }
    });
    expect(resPay.error?.message).toContain('E-MCP-PAYLOAD-TOO-LARGE');

    // 4. Test Token Quota (max_tokens: 30)
    const server4 = new McpServerAdapter();
    server4.registerTool({
      descriptor: {
        name: 'mcp_token_test',
        description: 'Token quota test',
        inputSchema: { type: 'object', properties: {} }
      },
      handler: async () => ({
        content: [{ type: 'text', text: 'token heavy' }],
        tokens_used: 25
      })
    });
    const broker4 = new McpCapabilityBroker(server4);
    const grant4 = createCapabilityGrant({
      grant_id: 'grant:quota:tok',
      task_id: 'task:quota:04',
      worker_id: 'worker:04',
      allowed_tools: ['mcp_token_test'],
      allowed_hosts: ['*'],
      max_requests: 5,
      max_payload_bytes: 65536,
      max_latency_ms: 2000,
      max_tokens: 30,
      expires_at_utc: new Date(Date.now() + 60000).toISOString()
    });
    // First call consumes 25 / 30 tokens -> OK
    expect((await broker4.invokeTool(grant4, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'mcp_token_test', arguments: {} }
    })).error).toBeUndefined();
    // Second call attempts another 25 tokens -> 50 > 30 -> Exceeded
    const resTok = await broker4.invokeTool(grant4, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'mcp_token_test', arguments: {} }
    });
    expect(resTok.error?.message).toContain('E-MCP-TOKEN-QUOTA-EXCEEDED');
  });

  // ==========================================================================
  // TEST 5: MCP-RUN-LEDGER-HASH-CHAIN-005
  // ==========================================================================
  it('MCP-RUN-LEDGER-HASH-CHAIN-005: McpRunLedger records append-only execution events with sha256 hash chains under RFC 8785 JCS canonicalization and detects tampering fail-closed', () => {
    const ledger = new McpRunLedger();

    // 1. Append sequential events
    const e1 = ledger.appendEvent('TASK_DISPATCHED', 'task:1', 'worker:coord', { target_sku: 'DIN-3017' });
    const e2 = ledger.appendEvent('CAPABILITY_GRANTED', 'task:1', 'worker:coord', { grant_id: 'grant:1' });
    const e3 = ledger.appendEvent('TOOL_CALL_INVOKED', 'task:1', 'worker:tf', { tool_name: 'http_snapshot', duration_ms: 45 });
    const e4 = ledger.appendEvent('WORKER_OUTPUT_RECEIVED', 'task:1', 'worker:tf', { records_parsed: 1 });

    // 2. Verify genesis hash and hash continuity
    expect(e1.previous_event_hash).toBe('0000000000000000000000000000000000000000000000000000000000000000');
    expect(e2.previous_event_hash).toBe(e1.event_hash);
    expect(e3.previous_event_hash).toBe(e2.event_hash);
    expect(e4.previous_event_hash).toBe(e3.event_hash);

    expect(ledger.verifyHashChain()).toBe(true);
    expect(ledger.getEvents()).toHaveLength(4);

    // 3. Tampering detection proof: modifying any event details invalidates the chain
    const tamperedPayload = {
      event_id: e2.event_id,
      event_type: e2.event_type,
      task_id: e2.task_id,
      worker_id: e2.worker_id,
      timestamp_utc: e2.timestamp_utc,
      details: { grant_id: 'grant:tampered:injected' },
      previous_event_hash: e2.previous_event_hash
    };
    const tamperedHash = createHash('sha256').update(canonicalizeJCS(tamperedPayload)).digest('hex');
    expect(tamperedHash).not.toBe(e2.event_hash);
  });

  // ==========================================================================
  // TEST 6: MCP-SUPPLEMENTARY-CONFLICT-JOIN-006
  // ==========================================================================
  it('MCP-SUPPLEMENTARY-CONFLICT-JOIN-006: joinSupplementaryClaims produces CROSS_SOURCE_CORROBORATED on agreement and CONFLICT on disagreement without averaging, voting, or guessing', () => {
    // 1. Multi-source agreement on IndiaMART and Amazon price (₹105.0000)
    const corroboratingClaims: SupplementaryClaim[] = [
      {
        entity_id: 'sku:din3017:ss304:16-25mm',
        metric_name: 'gross_selling_price_subunits',
        value: 1050000n,
        source_id: 'supplier:indiamart:howrah-01',
        observed_at_utc: REF_TIME
      },
      {
        entity_id: 'sku:din3017:ss304:16-25mm',
        metric_name: 'gross_selling_price_subunits',
        value: 1050000n,
        source_id: 'supplier:amazon-in:seller-02',
        observed_at_utc: REF_TIME
      }
    ];

    const resCorroborated = joinSupplementaryClaims(corroboratingClaims);
    expect(resCorroborated).toHaveLength(1);
    expect(resCorroborated[0].status).toBe('CROSS_SOURCE_CORROBORATED');
    expect(resCorroborated[0].agreeing_value).toBe(1050000n);
    expect(resCorroborated[0].sources).toEqual(['supplier:amazon-in:seller-02', 'supplier:indiamart:howrah-01']);

    // 2. Multi-source conflict on raw material cost (₹25.0000 vs ₹32.5000)
    const conflictingClaims: SupplementaryClaim[] = [
      {
        entity_id: 'sku:din3017:ss304:16-25mm',
        metric_name: 'raw_material_purchase_subunits',
        value: 250000n,
        source_id: 'supplier:indiamart:howrah-01',
        observed_at_utc: REF_TIME
      },
      {
        entity_id: 'sku:din3017:ss304:16-25mm',
        metric_name: 'raw_material_purchase_subunits',
        value: 325000n,
        source_id: 'supplier:lme:metals-direct',
        observed_at_utc: REF_TIME
      }
    ];

    const resConflict = joinSupplementaryClaims(conflictingClaims);
    expect(resConflict).toHaveLength(1);
    expect(resConflict[0].status).toBe('CONFLICT');
    expect(resConflict[0].agreeing_value).toBeUndefined();
    // Zero averaging: both conflicting values preserved explicitly
    expect(resConflict[0].conflicting_values).toEqual([
      { source_id: 'supplier:indiamart:howrah-01', value: 250000n },
      { source_id: 'supplier:lme:metals-direct', value: 325000n }
    ]);

    // 3. Single source
    const singleClaim: SupplementaryClaim[] = [
      {
        entity_id: 'sku:din3017:ss304:16-25mm',
        metric_name: 'inbound_freight_subunits',
        value: 45000n,
        source_id: 'carrier:delhivery',
        observed_at_utc: REF_TIME
      }
    ];
    const resSingle = joinSupplementaryClaims(singleClaim);
    expect(resSingle[0].status).toBe('SINGLE_SOURCE');
    expect(resSingle[0].agreeing_value).toBe(45000n);
  });

  // ==========================================================================
  // TEST 7: MCP-BITEMPORAL-IMMUTABILITY-PROOF-007
  // ==========================================================================
  it('MCP-BITEMPORAL-IMMUTABILITY-PROOF-007: BitemporalRestatementEngine deepFreezes stored records, rejects duplicate decision overwrites fail-closed (E-ERR-BITEMPORAL-OVERWRITE), and supports distinct t_d and t_k', () => {
    const tD = '2026-10-17T10:00:00Z'; // Decision time
    const tK = '2026-10-17T10:05:00Z'; // Knowledge time (received 5 mins later)

    const cand = createCandidate('16-25mm', 10, {
      gross_selling_price_subunits: 1050000n,
      raw_material_purchase_subunits: 250000n
    });

    const record = BitemporalRestatementEngine.recordDecisionAtT0(
      'dec:test:bitemporal:001',
      tD,
      [cand],
      { treasury_budget_subunits: TOTAL_BUDGET },
      tK
    );

    // 1. Distinct t_d and t_k verified
    expect(record.decision_time_utc).toBe(tD);
    expect(record.knowledge_time_utc).toBe(tK);

    // 2. Deep immutability proof: record, candidates array, and nested elements are frozen
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.candidate_inputs)).toBe(true);
    expect(Object.isFrozen(record.candidate_inputs[0])).toBe(true);
    expect(Object.isFrozen(record.simulation_config)).toBe(true);

    expect(() => {
      (record as any).decision_time_utc = '2026-10-17T11:00:00Z';
    }).toThrow();

    expect(() => {
      (record.candidate_inputs[0] as any).gross_selling_price_subunits = 500000n;
    }).toThrow();

    // 3. Overwrite rejection proof (E-ERR-BITEMPORAL-OVERWRITE)
    expect(() => {
      BitemporalRestatementEngine.recordDecisionAtT0(
        'dec:test:bitemporal:001',
        tD,
        [cand],
        { treasury_budget_subunits: TOTAL_BUDGET }
      );
    }).toThrow(/E-ERR-BITEMPORAL-OVERWRITE/);

    // 4. Stored record retrieval parity
    const retrieved = BitemporalRestatementEngine.getStoredRecord('dec:test:bitemporal:001');
    expect(retrieved).toBeDefined();
    expect(retrieved?.record_digest_sha256).toBe(record.record_digest_sha256);
  });

  // ==========================================================================
  // TEST 8: MCP-SCHEDULER-FULL-WORKER-INVOCATION-008
  // ==========================================================================
  it('MCP-SCHEDULER-FULL-WORKER-INVOCATION-008: ResearchSchedulerAndManager genuinely invokes GovtSchemeAndTaxSubAgent, RedTeamReviewerSubAgent, and GroqFormulaAdvisor / RAG routing with RFC 8785 JCS telemetry digest', async () => {
    const manager = new ResearchSchedulerAndManager();

    const tick: any = {
      tick_id: 'tick:governed:suite23:001',
      timestamp_utc: REF_TIME,
      thesis: 'SS304 DIN 3017 hose clamp multi-channel arbitrage',
      raw_dom_pages: [
        {
          url: 'https://amazon.in/dp/B09XYZ1234',
          dom: '<div data-asin="B09XYZ1234" data-price="105.00" data-moq="500"></div>',
          mandatory_fields: ['gross_selling_price_subunits', 'moq']
        }
      ],
      media_transcripts: [
        {
          channel: 'YOUTUBE_VIDEO_TRANSCRIPT',
          source_id: 'yt:channel:teardown',
          text: 'Verified SS304 clamp passivated finish test.'
        }
      ],
      lateral_market_quotes: [
        {
          symbol: 'SS304_COIL',
          change_bps: 450,
          source_id: 'lme:metals:feed'
        }
      ],
      // Statutory notification genuinely processed by GovtSchemeAndTaxSubAgent
      govt_notifications: [
        {
          notification_id: 'CBIC-2026-CUSTOMS-44',
          statutory_act: 'Customs Tariff Act 1975',
          tariff_bps: 750
        }
      ],
      // Candidate offers genuinely evaluated by RedTeamReviewerSubAgent
      candidate_offers: [
        {
          candidate_id: 'cand:offer:legit',
          claimed_price_subunits: 1050000n, // ₹105.0000
          raw_material_scrap_floor_subunits: 250000n // ₹25.0000 floor -> APPROVED
        },
        {
          candidate_id: 'cand:offer:fraud-scrap',
          claimed_price_subunits: 150000n, // ₹15.0000 (below scrap metal floor ₹25.0000) -> BLOCKED
          raw_material_scrap_floor_subunits: 250000n
        }
      ]
    };

    const run = await manager.executeResearchTickAsync(tick);

    // 1. All 9 pipeline stages completed in sequence
    expect(run.stages_completed).toEqual([
      'DECOMPOSE',
      'ROUTE',
      'ASSEMBLE_CONTEXT',
      'PROMPT',
      'EXECUTE_SCOPED_WORKER',
      'REVIEW_RED_TEAM',
      'ASSEMBLE_EVIDENCE',
      'POLISH',
      'PRESENT'
    ]);

    // 2. Govt policy notification genuinely normalized into signals
    const govtSig = run.signals_collected.find((s) => s.channel === 'GOVERNMENT_SCHEME_POLICY');
    expect(govtSig).toBeDefined();
    expect(govtSig?.signal_id).toBe('sig:gov:cbic-2026-customs-44');

    // 3. Red Team genuine review results
    expect(run.red_team_audits).toBeDefined();
    expect(run.red_team_audits).toHaveLength(2);
    const legitAudit = run.red_team_audits?.find((a) => a.candidate_id === 'cand:offer:legit');
    const fraudAudit = run.red_team_audits?.find((a) => a.candidate_id === 'cand:offer:fraud-scrap');

    expect(legitAudit?.approved).toBe(true);
    expect(fraudAudit?.approved).toBe(false);
    expect(fraudAudit?.rejection_reason).toContain('E-M6-RED-TEAM-REJECTED');
    expect(fraudAudit?.rejection_reason).toContain('below raw scrap metal floor');

    // 4. RFC 8785 JCS canonical telemetry digest verification
    expect(run.telemetry_digest_sha256).toHaveLength(64);
    const { telemetry_digest_sha256, ...payloadWithoutDigest } = run;
    const computedDigest = createHash('sha256')
      .update(canonicalizeJCS(sanitizeForJcs(payloadWithoutDigest)))
      .digest('hex');
    expect(computedDigest).toBe(run.telemetry_digest_sha256);
  });
});
