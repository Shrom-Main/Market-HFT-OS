/**
 * SUITE-30: Gate M6.8 Comprehensive MCP Protocol Hardening, Constrained Egress Connector,
 * First-Class Evidence Origin Firewall, Provider Certification & Plan-Driven DAG Execution
 * (Decision OD-18 / Charter DEC-018)
 *
 * Normative Acceptance Suite for Stage 8 / Gate M6.8:
 * 1. M6_8-MCP-WIRE-LIFECYCLE-001: McpCapabilityBroker wire protocol handles initialize (2025-11-25),
 *    notifications/initialized, ping, tools/list, resources/list, resources/read, notifications/cancelled,
 *    and tools/call.
 * 2. M6_8-POSITIVE-TOOL-MANIFEST-002: McpServerAdapter enforces positive tool manifests with
 *    additionalProperties: false (E-MCP-UNKNOWN-ARGUMENT-REJECTED) and verifies handler SHA-256 integrity (E-MCP-HANDLER-TAMPERED).
 * 3. M6_8-SIGNED-CAPABILITY-GRANT-003: McpCapabilityBroker verifies HMAC-SHA256 signed CapabilityGrant
 *    (E-MCP-GRANT-SIGNATURE-INVALID), calling worker/task identity (E-MCP-WORKER-IDENTITY-MISMATCH),
 *    and cumulative task wall-clock budget (E-MCP-TASK-WALL-CLOCK-EXCEEDED).
 * 4. M6_8-CONSTRAINED-HTTPS-CONNECTOR-004: ConstrainedHttpsConnector enforces port 443 only (E-MCP-PORT-DENIED),
 *    pre-resolves DNS rejecting private/loopback/metadata IPs (E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED),
 *    and aborts in-flight streams via ReadableStream reader when exceeding max_payload_bytes (E-MCP-STREAM-PAYLOAD-TOO-LARGE).
 * 5. M6_8-DURABLE-RUN-LEDGER-PERSISTENCE-005: McpRunLedger saves to JSONL file (saveLedgerToFile) and
 *    reloads (loadLedgerFromFile) with JCS hash chain tamper verification (E-MCP-LEDGER-TAMPERED).
 * 6. M6_8-EVIDENCE-ORIGIN-FIREWALL-006: EvidencePromotionEngine enforces Origin Promotion Firewall:
 *    rejects non-live origin promotion to VERIFIED_EXECUTABLE_OFFER (E-EV-NON-LIVE-ORIGIN-PROMOTION-FORBIDDEN),
 *    and RedTeam rule RT-08-NON-LIVE-EVIDENCE-ORIGIN blocks execution.
 * 7. M6_8-FAIL-CLOSED-WORKER-SOURCES-007: SourceCaptureWorker and MediaAndChatterWorker fail closed
 *    (E-WORKER-UNSUPPORTED-OR-UNMAPPED-SOURCE) on unmapped targets rather than falling back to default fixtures,
 *    preserving requested_url vs resolved_source_identity.
 * 8. M6_8-LOOKAHEAD-BIAS-FIREWALL-008: MacroAndLateralMarketWorker and GovtAndStatutoryWorker detect
 *    observation / citation timestamps ahead of reference time and reject with E-MLW-LOOKAHEAD-BIAS-REJECTED.
 * 9. M6_8-GROQ-ADVISOR-EGRESS-FIREWALL-009: GroqFormulaAdvisor locks network egress to
 *    https://api.groq.com/openai/v1/chat/completions (E-GROQ-UNAPPROVED-ENDPOINT), redacts secrets/keys
 *    (redactPromptSecrets), and tags proposals with LLM_MODEL_PROPOSAL.
 * 10. M6_8-GOLDEN-EXTRACTION-BENCH-AND-DAG-WAVES-010: GoldenExtractionBench evaluates SourceCaptureWorker
 *     achieving 10000n bps precision, recall, and exact match; executeCompiledDagPlan runs topological
 *     wave dispatching with activation_predicate filtering, bounded parallelism, and durable checkpointing.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sha256 } from '../../src/canonical/crypto.js';
import {
  McpServerAdapter,
  McpCapabilityBroker,
  createCapabilityGrant,
  signCapabilityGrant,
  verifyCapabilityGrantSignature,
  McpRunLedger,
  ConstrainedHttpsConnector,
  McpToolDescriptor,
  CapabilityGrant
} from '../../src/mcp/mcpSubstrate.js';
import {
  SourceCaptureWorker,
  registerSourceCaptureTool
} from '../../src/agents/workers/sourceCaptureWorker.js';
import {
  MacroAndLateralMarketWorker,
  registerMacroLateralTool
} from '../../src/agents/workers/macroLateralWorker.js';
import {
  GovtAndStatutoryWorker,
  registerGovtStatutoryTool
} from '../../src/agents/workers/govtStatutoryWorker.js';
import {
  MediaAndChatterWorker,
  registerMediaChatterTool
} from '../../src/agents/workers/mediaChatterWorker.js';
import {
  RedTeamAndConflictWorker,
  registerRedTeamTool
} from '../../src/agents/workers/redTeamWorker.js';
import {
  EvidencePromotionEngine,
  EvidenceEnvelope
} from '../../src/research/m5SignalAndEvidenceEngine.js';
import {
  GroqFormulaAdvisor,
  APPROVED_GROQ_ENDPOINT,
  redactPromptSecrets
} from '../../src/research/llmFormulaAdvisor.js';
import {
  GoldenExtractionBench
} from '../../src/agents/evaluation/goldenExtractionBench.js';
import {
  executeCompiledDagPlan,
  DagCheckpointStore,
  CompiledDagPlan,
  DagCheckpoint
} from '../../src/agents/scheduler/contextRoutingStateMachine.js';

describe('SUITE-30: Gate M6.8 MCP Protocol Hardening, Constrained Egress & Worker Certification', () => {
  let server: McpServerAdapter;
  let runLedger: McpRunLedger;
  let broker: McpCapabilityBroker;
  let scwGrant: CapabilityGrant;
  let mcwGrant: CapabilityGrant;
  let macroGrant: CapabilityGrant;
  let govtGrant: CapabilityGrant;

  const COMMON_HOSTS = [
    'www.amazon.in',
    'dir.indiamart.com',
    'www.indiamart.com',
    'catalog.howrah-industrial.com',
    'gem.gov.in',
    'www.rbi.org.in',
    'www.fbil.org.in',
    'www.lme.com',
    'www.nseindia.com',
    'mospi.gov.in',
    'msme.gov.in',
    'cbic.gov.in',
    'cbic-gst.gov.in',
    'dgft.gov.in',
    'financialservices.gov.in',
    'www.youtube.com',
    'sellercentral.amazon.in',
    'transcripts.approved-corpus.local'
  ];

  beforeEach(() => {
    server = new McpServerAdapter();
    registerSourceCaptureTool(server);
    registerMacroLateralTool(server);
    registerGovtStatutoryTool(server);
    registerMediaChatterTool(server);
    registerRedTeamTool(server);
    runLedger = new McpRunLedger();
    broker = new McpCapabilityBroker(server, runLedger);

    scwGrant = createCapabilityGrant({
      grant_id: 'grant:suite30:scw',
      task_id: 'task:suite30:verification',
      worker_id: SourceCaptureWorker.WORKER_ID,
      allowed_tools: ['mcp://source-capture/http_get_snapshot'],
      allowed_hosts: COMMON_HOSTS,
      allowed_methods: ['GET'],
      max_requests: 50,
      max_payload_bytes: 524288,
      max_latency_ms: 5000,
      max_tokens: 200000,
      expires_at_utc: '2026-12-31T23:59:59.000Z'
    });

    mcwGrant = createCapabilityGrant({
      grant_id: 'grant:suite30:mcw',
      task_id: 'task:suite30:verification',
      worker_id: MediaAndChatterWorker.WORKER_ID,
      allowed_tools: ['mcp://media-corpus/fetch_transcript'],
      allowed_hosts: COMMON_HOSTS,
      allowed_methods: ['GET'],
      max_requests: 50,
      max_payload_bytes: 524288,
      max_latency_ms: 5000,
      max_tokens: 200000,
      expires_at_utc: '2026-12-31T23:59:59.000Z'
    });

    macroGrant = createCapabilityGrant({
      grant_id: 'grant:suite30:macro',
      task_id: 'task:suite30:verification',
      worker_id: MacroAndLateralMarketWorker.WORKER_ID,
      allowed_tools: ['mcp://macro-feeds/query_series'],
      allowed_hosts: COMMON_HOSTS,
      allowed_methods: ['GET'],
      max_requests: 50,
      max_payload_bytes: 524288,
      max_latency_ms: 5000,
      max_tokens: 200000,
      expires_at_utc: '2026-12-31T23:59:59.000Z'
    });

    govtGrant = createCapabilityGrant({
      grant_id: 'grant:suite30:govt',
      task_id: 'task:suite30:verification',
      worker_id: GovtAndStatutoryWorker.WORKER_ID,
      allowed_tools: ['mcp://policy-bulletins/fetch_circular'],
      allowed_hosts: COMMON_HOSTS,
      allowed_methods: ['GET'],
      max_requests: 50,
      max_payload_bytes: 524288,
      max_latency_ms: 5000,
      max_tokens: 200000,
      expires_at_utc: '2026-12-31T23:59:59.000Z'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // TEST 1: MCP Wire Protocol Lifecycle Dispatcher
  // --------------------------------------------------------------------------
  it('M6_8-MCP-WIRE-LIFECYCLE-001: McpCapabilityBroker handles complete wire lifecycle methods', async () => {
    // 1. initialize negotiation
    const initRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' }
    });
    expect(initRes).not.toBeNull();
    expect(initRes?.error).toBeUndefined();
    expect((initRes?.result as Record<string, unknown>)?.protocolVersion).toBe('2025-11-25');
    expect((initRes?.result as Record<string, unknown>)?.serverInfo).toBeDefined();

    // 2. initialize with unsupported version
    const unsupportedInit = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'init-2',
      method: 'initialize',
      params: { protocolVersion: '2024-01-01' }
    });
    expect(unsupportedInit?.error).toBeDefined();
    expect(unsupportedInit?.error?.code).toBe(-32602);
    expect(unsupportedInit?.error?.message).toContain('E-MCP-UNSUPPORTED-PROTOCOL-VERSION');

    // 3. notifications/initialized
    expect(broker.isInitialized()).toBe(false);
    const notifRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });
    expect(notifRes).toBeNull();
    expect(broker.isInitialized()).toBe(true);

    // 4. ping
    const pingRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'ping-1',
      method: 'ping'
    });
    expect(pingRes?.result).toEqual({});

    // 5. tools/list
    const toolsRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'tools-list-1',
      method: 'tools/list'
    });
    const tools = (toolsRes?.result as { tools: readonly McpToolDescriptor[] })?.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.some((t) => t.name === 'mcp://source-capture/http_get_snapshot')).toBe(true);

    // 6. resources/list and resources/read
    server.registerResource({
      descriptor: {
        uri: 'resource://statutory/msme/interest-multiplier',
        name: 'MSMED Act Section 16 Multiplier',
        mimeType: 'application/json'
      },
      read: async () => ({
        uri: 'resource://statutory/msme/interest-multiplier',
        mimeType: 'application/json',
        text: JSON.stringify({ rbi_bank_rate_multiplier: 3, statutory_day_cap: 45 })
      })
    });

    const resList = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'res-list-1',
      method: 'resources/list'
    });
    const resources = (resList?.result as { resources: readonly { uri: string }[] })?.resources;
    expect(resources.some((r) => r.uri === 'resource://statutory/msme/interest-multiplier')).toBe(true);

    const resRead = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'res-read-1',
      method: 'resources/read',
      params: { uri: 'resource://statutory/msme/interest-multiplier' }
    });
    expect(resRead?.error).toBeUndefined();
    const contents = (resRead?.result as { contents: readonly { text: string }[] })?.contents;
    expect(contents[0]?.text).toContain('"rbi_bank_rate_multiplier":3');

    // Missing uri on resources/read
    const missingUriRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'res-read-missing',
      method: 'resources/read',
      params: {}
    });
    expect(missingUriRes?.error?.code).toBe(-32602);

    // Nonexistent uri on resources/read
    const notFoundRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'res-read-404',
      method: 'resources/read',
      params: { uri: 'resource://nonexistent/item' }
    });
    expect(notFoundRes?.error?.message).toContain('E-MCP-RESOURCE-NOT-FOUND');

    // 7. tools/call without grant fails closed
    const callWithoutGrant = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: { name: 'mcp://source-capture/http_get_snapshot', arguments: {} }
    });
    expect(callWithoutGrant?.error?.message).toContain('E-MCP-GRANT-REQUIRED');

    // 8. notifications/cancelled returns null
    const cancelRes = await broker.handleRpcMessage({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 'call-999' }
    });
    expect(cancelRes).toBeNull();
  });

  // --------------------------------------------------------------------------
  // TEST 2: Positive Tool Manifests & Handler Tamper Verification
  // --------------------------------------------------------------------------
  it('M6_8-POSITIVE-TOOL-MANIFEST-002: McpServerAdapter rejects unexpected args and verifies handler SHA-256', async () => {
    const customServer = new McpServerAdapter();

    const handler = async (_args: Record<string, unknown>) => ({
      content: [{ type: 'text' as const, text: 'ok' }]
    });

    const handlerStr = handler.toString();
    const correctSha = sha256(handlerStr);

    const manifestDescriptor: McpToolDescriptor = {
      name: 'mcp://custom/positive-manifest-tool',
      description: 'Tool with strict manifest and SHA-256 integrity',
      inputSchema: {
        type: 'object',
        properties: {
          field_a: { type: 'string' },
          field_b: { type: 'number' }
        },
        required: ['field_a'],
        additionalProperties: false
      },
      handlerSha256: correctSha
    };

    // Registration succeeds with valid handlerSha256
    expect(() => {
      customServer.registerTool({
        descriptor: manifestDescriptor,
        handler
      });
    }).not.toThrow();

    // Validation allows declared properties
    expect(() => {
      customServer.validateArguments(manifestDescriptor, {
        field_a: 'test',
        field_b: 42
      });
    }).not.toThrow();

    // Validation strictly rejects undeclared property due to additionalProperties: false
    expect(() => {
      customServer.validateArguments(manifestDescriptor, {
        field_a: 'test',
        undeclared_injected_field: 'malicious'
      });
    }).toThrow(/E-MCP-UNKNOWN-ARGUMENT-REJECTED/);

    // Registration with tampered handlerSha256 fails closed
    const tamperedDescriptor: McpToolDescriptor = {
      name: 'mcp://custom/tampered-tool',
      description: 'Tool with mismatched handler hash',
      inputSchema: {
        type: 'object',
        properties: { x: { type: 'string' } }
      },
      handlerSha256: '0000000000000000000000000000000000000000000000000000000000000000'
    };

    expect(() => {
      customServer.registerTool({
        descriptor: tamperedDescriptor,
        handler
      });
    }).toThrow(/E-MCP-HANDLER-TAMPERED/);
  });

  // --------------------------------------------------------------------------
  // TEST 3: HMAC-SHA256 Signed Capability Grant & Identity / Budget Enforcement
  // --------------------------------------------------------------------------
  it('M6_8-SIGNED-CAPABILITY-GRANT-003: McpCapabilityBroker validates HMAC signature, worker identity, and cumulative wall-clock budget', async () => {
    const hmacSecret = 'stage8-secret-audit-signing-key-2026';
    const secureBroker = new McpCapabilityBroker(server, runLedger, { hmacSecret });

    const baseGrant = createCapabilityGrant({
      grant_id: 'grant:sec:001',
      task_id: 'task:sec:001',
      worker_id: 'worker:source-capture:v1',
      allowed_tools: ['mcp://source-capture/http_get_snapshot'],
      allowed_hosts: ['catalog.howrah-industrial.com'],
      allowed_methods: ['GET'],
      max_requests: 5,
      max_payload_bytes: 262144,
      max_latency_ms: 2000,
      max_tokens: 10000,
      max_task_wall_clock_ms: 1500,
      expires_at_utc: '2026-10-19T00:00:00.000Z'
    });

    // 1. Unsigned grant is rejected by broker configured with hmacSecret
    const unsignedCall = await secureBroker.invokeTool(baseGrant, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'mcp://source-capture/http_get_snapshot',
        arguments: { target_url: 'https://catalog.howrah-industrial.com/item' }
      }
    });
    expect(unsignedCall.error?.message).toContain('E-MCP-GRANT-SIGNATURE-INVALID');

    // 2. Sign grant with secret
    const signedGrant = signCapabilityGrant(baseGrant, hmacSecret);
    expect(verifyCapabilityGrantSignature(signedGrant, hmacSecret)).toBe(true);
    expect(verifyCapabilityGrantSignature(signedGrant, 'wrong-secret')).toBe(false);

    // 3. Tampered grant fails signature verification
    const tamperedGrant = { ...signedGrant, max_requests: 999 };
    const tamperedCall = await secureBroker.invokeTool(tamperedGrant, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'mcp://source-capture/http_get_snapshot',
        arguments: { target_url: 'https://catalog.howrah-industrial.com/item' }
      }
    });
    expect(tamperedCall.error?.message).toContain('E-MCP-GRANT-SIGNATURE-INVALID');

    // 4. Calling Worker Identity Mismatch
    const imposterCall = await secureBroker.invokeTool(
      signedGrant,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'mcp://source-capture/http_get_snapshot',
          arguments: {
            target_url: 'https://catalog.howrah-industrial.com/item',
            raw_html_payload: '<div class="price">100</div>'
          }
        }
      },
      { callingWorkerId: 'worker:imposter:v1', callingTaskId: 'task:sec:001' }
    );
    expect(imposterCall.error?.message).toContain('E-MCP-WORKER-IDENTITY-MISMATCH');

    // 5. Calling Task Identity Mismatch
    const wrongTaskCall = await secureBroker.invokeTool(
      signedGrant,
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'mcp://source-capture/http_get_snapshot',
          arguments: {
            target_url: 'https://catalog.howrah-industrial.com/item',
            raw_html_payload: '<div class="price">100</div>'
          }
        }
      },
      { callingWorkerId: 'worker:source-capture:v1', callingTaskId: 'task:wrong:999' }
    );
    expect(wrongTaskCall.error?.message).toContain('E-MCP-WORKER-IDENTITY-MISMATCH');

    // 6. Cumulative task wall-clock budget
    const tightBudgetGrant = signCapabilityGrant(
      createCapabilityGrant({
        grant_id: 'grant:sec:002',
        task_id: 'task:sec:tight-budget',
        worker_id: 'worker:source-capture:v1',
        allowed_tools: ['mcp://source-capture/http_get_snapshot'],
        allowed_hosts: ['catalog.howrah-industrial.com'],
        max_requests: 5,
        max_payload_bytes: 262144,
        max_latency_ms: 2000,
        max_tokens: 10000,
        max_task_wall_clock_ms: 0, // 0ms pre-flight budget exhaustion
        expires_at_utc: '2026-10-19T00:00:00.000Z'
      }),
      hmacSecret
    );

    const budgetExceededCall = await secureBroker.invokeTool(
      tightBudgetGrant,
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'mcp://source-capture/http_get_snapshot',
          arguments: {
            target_url: 'https://catalog.howrah-industrial.com/item',
            raw_html_payload: '<div class="price">100</div>'
          }
        }
      },
      { callingWorkerId: 'worker:source-capture:v1', callingTaskId: 'task:sec:tight-budget' }
    );
    expect(budgetExceededCall.error?.message).toContain('E-MCP-TASK-WALL-CLOCK-EXCEEDED');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Constrained HTTPS Connector (SSRF, Port, Streaming Cutoff)
  // --------------------------------------------------------------------------
  it('M6_8-CONSTRAINED-HTTPS-CONNECTOR-004: ConstrainedHttpsConnector locks port 443, pre-resolves DNS, and cuts off streaming payloads', async () => {
    // 1. Port denied (only 443 permitted)
    await expect(
      ConstrainedHttpsConnector.fetch('https://dir.indiamart.com:8443/item', {
        max_payload_bytes: 1024,
        timeout_ms: 1000
      })
    ).rejects.toThrow(/E-MCP-PORT-DENIED/);

    // 2. Scheme denied
    await expect(
      ConstrainedHttpsConnector.fetch('http://dir.indiamart.com/item', {
        max_payload_bytes: 1024,
        timeout_ms: 1000
      })
    ).rejects.toThrow(/E-MCP-SCHEME-DENIED/);

    // 3. SSRF / DNS Rebinding to loopback / private IP
    await expect(
      ConstrainedHttpsConnector.fetch('https://127.0.0.1/item', {
        max_payload_bytes: 1024,
        timeout_ms: 1000
      })
    ).rejects.toThrow(/E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED/);

    await expect(
      ConstrainedHttpsConnector.fetch('https://localhost/item', {
        max_payload_bytes: 1024,
        timeout_ms: 1000
      })
    ).rejects.toThrow(/E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED/);

    // 4. In-flight streaming byte cutoff via ReadableStream reader
    const fakeChunk = new Uint8Array(64);
    fakeChunk.fill(65); // 'A'

    // Mock global fetch to return a streaming response
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(fakeChunk);
        controller.enqueue(fakeChunk);
        controller.enqueue(fakeChunk);
        controller.enqueue(fakeChunk); // 256 bytes total
        controller.close();
      }
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(mockStream, {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      });
    });

    await expect(
      ConstrainedHttpsConnector.fetch('https://www.google.com/test', {
        max_payload_bytes: 100,
        timeout_ms: 2000
      })
    ).rejects.toThrow(/E-MCP-STREAM-PAYLOAD-TOO-LARGE/);
  });

  // --------------------------------------------------------------------------
  // TEST 5: Durable Append-Only Run Ledger File Persistence & Tamper Detection
  // --------------------------------------------------------------------------
  it('M6_8-DURABLE-RUN-LEDGER-PERSISTENCE-005: McpRunLedger saves to JSONL and detects hash chain tampering', async () => {
    const testLedger = new McpRunLedger();
    testLedger.appendEvent('TASK_DISPATCHED', 'task:persist:001', 'worker:source-capture:v1', { action: 'start' });
    testLedger.appendEvent('TOOL_CALL_INVOKED', 'task:persist:001', 'worker:source-capture:v1', { tool: 'snapshot', duration_ms: 15 });
    testLedger.appendEvent('WORKER_OUTPUT_RECEIVED', 'task:persist:001', 'worker:source-capture:v1', { status: 'EXTRACTED' });

    expect(testLedger.getEvents().length).toBe(3);
    expect(testLedger.verifyHashChain()).toBe(true);

    const tempFile = path.join(os.tmpdir(), `mcp-ledger-persistence-test-${Date.now()}.jsonl`);

    try {
      await testLedger.saveLedgerToFile(tempFile);
      expect(fs.existsSync(tempFile)).toBe(true);

      const reloaded = await McpRunLedger.loadLedgerFromFile(tempFile);
      expect(reloaded.getEvents().length).toBe(3);
      expect(reloaded.verifyHashChain()).toBe(true);
      expect(reloaded.getEvents()[1].event_type).toBe('TOOL_CALL_INVOKED');

      // Tamper with the persisted file
      const rawLines = fs.readFileSync(tempFile, 'utf8').trim().split('\n');
      const tamperedFirstEvt = JSON.parse(rawLines[0]);
      tamperedFirstEvt.worker_id = 'worker:imposter:v1';
      rawLines[0] = JSON.stringify(tamperedFirstEvt);
      fs.writeFileSync(tempFile, rawLines.join('\n') + '\n', 'utf8');

      await expect(McpRunLedger.loadLedgerFromFile(tempFile)).rejects.toThrow(/E-MCP-LEDGER-TAMPERED/);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  // --------------------------------------------------------------------------
  // TEST 6: First-Class Evidence Origin Firewall & RedTeam RT-08 Rule
  // --------------------------------------------------------------------------
  it('M6_8-EVIDENCE-ORIGIN-FIREWALL-006: EvidencePromotionEngine and RedTeam rule RT-08 block non-live evidence from executable promotion', () => {
    // 1. EvidencePromotionEngine blocks CALLER_SUPPLIED_PAYLOAD from promotion to VERIFIED_EXECUTABLE_OFFER
    const syntheticEnvelope: EvidenceEnvelope<{ price: number }> = {
      evidence_id: 'ev:test:synth:001',
      kind: 'OBSERVED_FACT',
      verification_status: 'UNVERIFIED',
      commercial_status: 'ADVERTISED_LISTING',
      provenance: {
        source_id: 'https://test-supplier.com/item',
        channel: 'NEWS_TRADE_PRESS',
        observed_at_utc: '2026-10-18T00:00:00.000Z',
        ttl_seconds: 86400,
        evidence_origin_class: 'CALLER_SUPPLIED_PAYLOAD'
      },
      payload: { price: 125 },
      jcs_hash: 'deadbeef'
    };

    expect(() => {
      EvidencePromotionEngine.promoteCommercialStatus(
        syntheticEnvelope,
        'VERIFIED_EXECUTABLE_OFFER',
        { attestation_signature: 'valid-sig-123' }
      );
    }).toThrow(/E-EV-NON-LIVE-ORIGIN-PROMOTION-FORBIDDEN/);

    // 2. LIVE_VERIFIED_CAPTURE passes origin promotion firewall
    const liveEnvelope: EvidenceEnvelope<{ price: number }> = {
      ...syntheticEnvelope,
      provenance: {
        ...syntheticEnvelope.provenance,
        evidence_origin_class: 'LIVE_VERIFIED_CAPTURE'
      }
    };

    const promoted = EvidencePromotionEngine.promoteCommercialStatus(
      liveEnvelope,
      'VERIFIED_EXECUTABLE_OFFER',
      { attestation_signature: 'valid-sig-123' }
    );
    expect(promoted.commercial_status).toBe('VERIFIED_EXECUTABLE_OFFER');

    // 3. RedTeam Rule RT-08-NON-LIVE-EVIDENCE-ORIGIN
    const nonLiveFinding = RedTeamAndConflictWorker.evaluateEvidenceOrigin({
      evidence_origin_class: 'RECORDED_GOLDEN_FIXTURE',
      intended_commercial_status: 'VERIFIED_EXECUTABLE_OFFER',
      envelope_id: 'ev:fixture:001'
    });
    expect(nonLiveFinding).not.toBeNull();
    expect(nonLiveFinding?.rule_id).toBe('RT-08-NON-LIVE-EVIDENCE-ORIGIN');
    expect(nonLiveFinding?.severity).toBe('BLOCK_ALLOCATION_GATE');

    // Live evidence produces zero findings under RT-08
    const liveFinding = RedTeamAndConflictWorker.evaluateEvidenceOrigin({
      evidence_origin_class: 'LIVE_VERIFIED_CAPTURE',
      intended_commercial_status: 'VERIFIED_EXECUTABLE_OFFER',
      envelope_id: 'ev:live:001'
    });
    expect(liveFinding).toBeNull();
  });

  // --------------------------------------------------------------------------
  // TEST 7: Fail-Closed Worker Sources & Requested vs Resolved Identity
  // --------------------------------------------------------------------------
  it('M6_8-FAIL-CLOSED-WORKER-SOURCES-007: Workers fail closed on unmapped targets and preserve requested_url vs resolved_source_identity', async () => {
    const scwWorker = new SourceCaptureWorker(broker, scwGrant);
    const mcwWorker = new MediaAndChatterWorker(broker, mcwGrant);

    // SourceCaptureWorker fails closed on unmapped target
    await expect(
      scwWorker.captureAndExtract({
        task_id: 'task:fail-closed:001',
        worker_id: SourceCaptureWorker.WORKER_ID,
        target_url: 'https://dir.indiamart.com/unmapped-supplier/not-in-fixtures',
        source_profile: 'INDIAMART_SUPPLIER_LISTING',
        execution_mode: 'RECORDED_FIXTURE_REPLAY',
        requested_at_utc: '2026-10-18T00:00:00.000Z'
      })
    ).rejects.toThrow(/E-WORKER-UNSUPPORTED-OR-UNMAPPED-SOURCE/);

    // MediaAndChatterWorker fails closed on unmapped target
    await expect(
      mcwWorker.fetchAndExtract({
        task_id: 'task:fail-closed:002',
        worker_id: MediaAndChatterWorker.WORKER_ID,
        target_url: 'https://transcripts.approved-corpus.local/unmapped-source',
        media_type: 'YOUTUBE_UNBOXING_OR_REVIEW',
        requested_at_utc: '2026-10-18T00:00:00.000Z'
      })
    ).rejects.toThrow(/E-WORKER-UNSUPPORTED-OR-UNMAPPED-SOURCE/);

    // When caller-supplied payload is passed, requested_url is preserved and provenance records identity
    const customUrl = 'https://dir.indiamart.com/custom-supplier';
    const scwRes = await scwWorker.captureAndExtract({
      task_id: 'task:custom-payload:003',
      worker_id: SourceCaptureWorker.WORKER_ID,
      target_url: customUrl,
      source_profile: 'HOWRAH_B2B_DISTRIBUTOR_CATALOG',
      execution_mode: 'RECORDED_FIXTURE_REPLAY',
      raw_html_payload: '<span class="price">Rs 140 / pack</span>',
      requested_at_utc: '2026-10-18T00:00:00.000Z'
    });

    expect(scwRes.evidence_envelope.provenance_lineage.source_id).toBe(customUrl);
    expect(scwRes.evidence_envelope.provenance_lineage.requested_url).toBe(customUrl);
    expect(scwRes.evidence_envelope.provenance_lineage.resolved_source_identity).toBe('caller://raw_html_payload');
    expect(scwRes.evidence_envelope.provenance_lineage.evidence_origin_class).toBe('CALLER_SUPPLIED_PAYLOAD');
  });

  // --------------------------------------------------------------------------
  // TEST 8: Look-Ahead Bias Firewall in Macro & Statutory Workers
  // --------------------------------------------------------------------------
  it('M6_8-LOOKAHEAD-BIAS-FIREWALL-008: Macro and Statutory workers reject future timestamps with E-MLW-LOOKAHEAD-BIAS-REJECTED', async () => {
    const macroWorker = new MacroAndLateralMarketWorker(broker, macroGrant);
    const govtWorker = new GovtAndStatutoryWorker(broker, govtGrant);

    // Query macro series with a reference time in the past relative to the latest observation
    const macroRes = await macroWorker.querySeries({
      task_id: 'task:macro:lookahead:001',
      worker_id: MacroAndLateralMarketWorker.WORKER_ID,
      series_id: 'RBI_91D_TBILL_CUTOFF_YIELD_BPS',
      reference_time_utc: '2026-10-15T00:00:00.000Z' // fixture observation is 2026-10-18T00:00:00.000Z
    });

    expect(macroRes.status).toBe('DATA_REQUIRED');
    expect(macroRes.error_code).toBe('E-MLW-LOOKAHEAD-BIAS-REJECTED');
    expect(macroRes.error_reason).toContain('Look-ahead bias prohibited');

    // Query statutory circular with reference date before circular effective date (CBIC-TCS-SEC52 effective 2024-07-10)
    const govtRes = await govtWorker.fetchCircular({
      task_id: 'task:govt:lookahead:001',
      worker_id: GovtAndStatutoryWorker.WORKER_ID,
      circular_id: 'CBIC-TCS-SEC52',
      reference_time_utc: '2024-01-01T00:00:00.000Z'
    });

    expect(govtRes.status).toBe('DATA_REQUIRED');
    expect(govtRes.error_code).toBe('E-MLW-LOOKAHEAD-BIAS-REJECTED');
    expect(govtRes.error_reason).toContain('Look-ahead bias prohibited');
  });

  // --------------------------------------------------------------------------
  // TEST 9: Groq Formula Advisor Approved Egress, Prompt Scrubbing & Proposal Origin
  // --------------------------------------------------------------------------
  it('M6_8-GROQ-ADVISOR-EGRESS-FIREWALL-009: GroqFormulaAdvisor locks approved endpoint, redacts secrets, and stamps LLM_MODEL_PROPOSAL', async () => {
    // 1. Egress endpoint firewall
    expect(() => {
      new GroqFormulaAdvisor({ endpoint: 'https://malicious-proxy.io/v1/completions' });
    }).toThrow(/E-GROQ-UNAPPROVED-ENDPOINT/);

    expect(APPROVED_GROQ_ENDPOINT).toBe('https://api.groq.com/openai/v1/chat/completions');

    // 2. Prompt secret scrubbing
    const dirtyPrompt = 'System config: key=gsk_9999888877776666555544443333 and bearer token=secret_token_123456';
    const sanitized = redactPromptSecrets(dirtyPrompt);
    expect(sanitized).not.toContain('gsk_9999888877776666555544443333');
    expect(sanitized).not.toContain('secret_token_123456');
    expect(sanitized).toContain('[REDACTED_SECRET]');

    // 3. Candidate proposals carry LLM_MODEL_PROPOSAL evidence origin
    const advisor = new GroqFormulaAdvisor({ forceSimulated: true });
    const proposal = await advisor.proposeFormulaRefinement('Synthesize inventory shrinkage drag formula');
    expect(proposal).toBeDefined();
    expect(proposal.evidence_origin_class).toBe('LLM_MODEL_PROPOSAL');
  });

  // --------------------------------------------------------------------------
  // TEST 10: Golden Extraction Bench & Plan-Driven Topological Wave Dispatcher
  // --------------------------------------------------------------------------
  it('M6_8-GOLDEN-EXTRACTION-BENCH-AND-DAG-WAVES-010: GoldenExtractionBench certifies 10000n bps and executeCompiledDagPlan dispatches waves', async () => {
    // 1. Golden Extraction Bench certifies SourceCaptureWorker
    const scw = new SourceCaptureWorker(broker, scwGrant);
    const benchSummary = await GoldenExtractionBench.evaluateSourceCaptureWorker(scw);

    expect(benchSummary.certified_pass).toBe(true);
    expect(benchSummary.precision_bps).toBe(10000n);
    expect(benchSummary.recall_bps).toBe(10000n);
    expect(benchSummary.exact_match_rate_bps).toBe(10000n);
    expect(benchSummary.benchmark_digest_sha256).toHaveLength(64);

    // 2. Plan-Driven Topological Wave Dispatching
    const compiledPlan: CompiledDagPlan = {
      plan_id: 'plan:wave:stage8:001',
      max_parallel_workers: 2,
      max_wall_clock_budget_ms: 5000,
      nodes: [
        {
          node_id: 'node:w1:source',
          pass_number: 1,
          worker_id: 'worker:source-capture:v1',
          depends_on_node_ids: [],
          action: async (_ctx) => ({ source_captured: true, primary_quote: 125 })
        },
        {
          node_id: 'node:w1:macro',
          pass_number: 1,
          worker_id: 'worker:macro-lateral:v1',
          depends_on_node_ids: [],
          action: async (_ctx) => ({ macro_verified: true, tbill_rate: '6.45' })
        },
        {
          node_id: 'node:w2:audit',
          pass_number: 2,
          worker_id: 'worker:red-team:v1',
          depends_on_node_ids: ['node:w1:source'],
          action: async (_ctx) => ({ red_team_approved: true })
        },
        {
          node_id: 'node:w2:optional-gate',
          pass_number: 2,
          worker_id: 'worker:scheduler:capital-gate',
          depends_on_node_ids: ['node:w1:macro'],
          activation_predicate: (ctx) => Boolean(ctx.run_optional_gate),
          action: async (_ctx) => ({ gate_passed: true })
        }
      ]
    };

    const dagResult = await executeCompiledDagPlan(compiledPlan, { run_optional_gate: false });

    expect(dagResult.status).toBe('SUCCESS');
    expect(dagResult.waves_executed).toBe(2);
    expect(dagResult.completed_nodes).toContain('node:w1:source');
    expect(dagResult.completed_nodes).toContain('node:w1:macro');
    expect(dagResult.completed_nodes).toContain('node:w2:audit');
    expect(dagResult.skipped_nodes).toContain('node:w2:optional-gate');
    expect(dagResult.checkpoint_hash).toHaveLength(64);

    // 3. Durable Checkpoint Store & Tamper Detection
    const tempCheckpoint = path.join(os.tmpdir(), `dag-checkpoint-test-${Date.now()}.json`);
    try {
      await DagCheckpointStore.saveCheckpointToFile(dagResult.checkpoint, tempCheckpoint);
      expect(fs.existsSync(tempCheckpoint)).toBe(true);

      const loadedChk = await DagCheckpointStore.resumeFromCheckpoint(tempCheckpoint);
      expect(loadedChk.plan_id).toBe(dagResult.checkpoint.plan_id);
      expect(loadedChk.checkpoint_hash).toBe(dagResult.checkpoint.checkpoint_hash);

      // Tamper with checkpoint
      const rawChk = fs.readFileSync(tempCheckpoint, 'utf8');
      const tamperedChk = rawChk.replace(dagResult.plan_id, 'plan:tampered:malicious');
      fs.writeFileSync(tempCheckpoint, tamperedChk, 'utf8');

      await expect(DagCheckpointStore.resumeFromCheckpoint(tempCheckpoint)).rejects.toThrow(
        /E-DAG-CHECKPOINT-TAMPERED/
      );
    } finally {
      if (fs.existsSync(tempCheckpoint)) {
        fs.unlinkSync(tempCheckpoint);
      }
    }
  });
});
