/**
 * Market HFT OS — Capability-Aware MCP Substrate & Read-Only Micro-Agent Broker
 *
 * Implements:
 * 1. Standardized MCP Tool Schema & Read-Only Server Registry:
 *    - JSON-RPC 2.0 / MCP envelopes (McpToolCallRequest, McpToolCallResponse, McpToolDescriptor)
 *    - Strict runtime argument schema validation
 *    - Forbidden capability firewall (rejects shell, SQL, ledger mutations, promotion, order routing, secrets)
 * 2. Capability-Aware MCP Broker (McpCapabilityBroker):
 *    - Short-lived, immutable, per-task CapabilityGrant (Object.freeze)
 *    - Scoped tools, hosts, allowed methods (GET only), and redirect blocking
 *    - Strict SSRF & private IP / loopback / metadata blocking (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.169.254, localhost)
 *    - Full 4-quota enforcement on every call (requests_made, wall_clock_ms, payload_bytes, tokens_used)
 * 3. Append-Only Run Ledger (McpRunLedger):
 *    - Monotonically hash-chained execution events with RFC 8785 JCS verification
 * 4. Conflict-Preserving Evidence Join:
 *    - joinSupplementaryClaims: CROSS_SOURCE_CORROBORATED on agreement, CONFLICT on disagreement
 *    - Zero averaging, zero voting, fail-closed reconciliation
 */

import { canonicalizeJCS } from '../canonical/jcs.js';
import { sha256 } from '../canonical/crypto.js';
import { sanitizeForJcs } from '../agents/m6AgentFramework.js';

// ============================================================================
// 1. STANDARDIZED MCP TOOL SCHEMA & ENVELOPES
// ============================================================================

export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
  };
}

export interface McpToolCallRequest {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly method: 'tools/call';
  readonly params: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
}

export interface McpContentItem {
  readonly type: 'text' | 'resource';
  readonly text?: string;
  readonly resource?: unknown;
}

export interface McpToolCallResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly result?: {
    readonly content: readonly McpContentItem[];
    readonly isError?: boolean;
    readonly tokens_used?: number;
  };
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export interface McpToolDefinition {
  readonly descriptor: McpToolDescriptor;
  readonly handler: (args: Record<string, unknown>) => Promise<McpToolCallResponse['result']>;
}

// ============================================================================
// 2. FORBIDDEN CAPABILITY FIREWALL & SERVER ADAPTER
// ============================================================================

export class McpServerAdapter {
  private readonly tools = new Map<string, McpToolDefinition>();

  private static readonly FORBIDDEN_CAPABILITY_PATTERNS = [
    /(?:^|[^a-z0-9])(shell|bash|sh|cmd|powershell|exec|spawn|eval)(?:$|[^a-z0-9])/i,
    /(?:^|[^a-z0-9])(sql|query_db|postgres|database|drop_table|truncate|alter_table|delete_from)(?:$|[^a-z0-9])/i,
    /(?:^|[^a-z0-9])(ledger|mutate_ledger|actuals_ledger|paper_ledger|write_ledger|debit|credit)(?:$|[^a-z0-9])/i,
    /(?:^|[^a-z0-9])(promote_evidence|force_promote|promote_offer|bypass_gate)(?:$|[^a-z0-9])/i,
    /(?:^|[^a-z0-9])(route_order|place_order|execute_trade|exchange_api|broker_api)(?:$|[^a-z0-9])/i,
    /(?:^|[^a-z0-9])(secret|read_env|groq_key|api_key|credential|token_store|password)(?:$|[^a-z0-9])/i
  ];


  public registerTool(tool: McpToolDefinition): void {
    const name = tool.descriptor.name;
    const desc = tool.descriptor.description;

    // Strict validation against forbidden capabilities
    for (const pattern of McpServerAdapter.FORBIDDEN_CAPABILITY_PATTERNS) {
      if (pattern.test(name) || pattern.test(desc)) {
        throw new Error(
          `E-MCP-FORBIDDEN-CAPABILITY: Tool '${name}' requests forbidden capability matching pattern ${pattern.toString()}. Write, shell, SQL, promotion, trading, and secret access are prohibited.`
        );
      }
    }

    if (this.tools.has(name)) {
      throw new Error(`E-MCP-TOOL-ALREADY-REGISTERED: Tool '${name}' is already registered.`);
    }

    this.tools.set(name, tool);
  }

  public getTool(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  public listTools(): readonly McpToolDescriptor[] {
    return Array.from(this.tools.values()).map((t) => t.descriptor);
  }

  public validateArguments(descriptor: McpToolDescriptor, args: Record<string, unknown>): void {
    if (!args || typeof args !== 'object') {
      throw new Error(`E-MCP-INVALID-ARGUMENTS: Tool arguments must be a non-null object.`);
    }
    const required = descriptor.inputSchema.required ?? [];
    for (const reqProp of required) {
      if (args[reqProp] === undefined || args[reqProp] === null) {
        throw new Error(`E-MCP-INVALID-ARGUMENTS: Missing mandatory required argument '${reqProp}'.`);
      }
    }
  }
}

// ============================================================================
// 3. CAPABILITY GRANT & EGRESS / SSRF POLICY
// ============================================================================

export interface CapabilityGrant {
  readonly grant_id: string;
  readonly task_id: string;
  readonly worker_id: string;
  readonly allowed_tools: readonly string[];
  readonly allowed_hosts: readonly string[];
  readonly allowed_methods: readonly ('GET')[];
  readonly allow_redirects: boolean;
  readonly max_requests: number;
  readonly max_payload_bytes: number;
  readonly max_latency_ms: number;
  readonly max_tokens: number;
  readonly expires_at_utc: string;
}

export function createCapabilityGrant(params: {
  grant_id: string;
  task_id: string;
  worker_id: string;
  allowed_tools: string[];
  allowed_hosts: string[];
  allowed_methods?: ('GET')[];
  allow_redirects?: boolean;
  max_requests: number;
  max_payload_bytes: number;
  max_latency_ms: number;
  max_tokens: number;
  expires_at_utc: string;
}): CapabilityGrant {
  const grant: CapabilityGrant = {
    grant_id: params.grant_id,
    task_id: params.task_id,
    worker_id: params.worker_id,
    allowed_tools: Object.freeze([...params.allowed_tools]),
    allowed_hosts: Object.freeze(params.allowed_hosts.map((h) => h.toLowerCase())),
    allowed_methods: Object.freeze(params.allowed_methods ?? ['GET']),
    allow_redirects: params.allow_redirects ?? false,
    max_requests: params.max_requests,
    max_payload_bytes: params.max_payload_bytes,
    max_latency_ms: params.max_latency_ms,
    max_tokens: params.max_tokens,
    expires_at_utc: params.expires_at_utc
  };
  return Object.freeze(grant);
}

export class McpCapabilityBroker {
  private readonly server: McpServerAdapter;
  private readonly runLedger: McpRunLedger;
  private readonly usageRecords = new Map<string, { requests_made: number; tokens_used: number }>();

  constructor(server: McpServerAdapter, runLedger?: McpRunLedger) {
    this.server = server;
    this.runLedger = runLedger ?? new McpRunLedger();
  }

  public getRunLedger(): McpRunLedger {
    return this.runLedger;
  }

  /**
   * Deterministically validates target host against SSRF and private IP ranges.
   */
  public static validateHostAndSsrf(urlOrHost: string, grant: CapabilityGrant): void {
    let hostname: string;

    try {
      if (urlOrHost.includes('://')) {
        const parsed = new URL(urlOrHost);
        hostname = parsed.hostname.toLowerCase();
      } else {
        // Strip port or path if provided as host string
        hostname = urlOrHost.split('/')[0].split(':')[0].toLowerCase();
      }
    } catch {
      throw new Error(`E-MCP-HOST-OR-SSRF-DENIED: Malformed URL or host '${urlOrHost}'.`);
    }

    // SSRF Filter: Private, loopback, link-local, cloud metadata ranges
    const isLoopback =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('127.') ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]';

    const isPrivateIp =
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname);

    const isLinkLocalOrMetadata =
      hostname === '169.254.169.254' ||
      hostname.startsWith('169.254.') ||
      hostname.includes('metadata.google.internal') ||
      hostname.includes('169.254');

    if (isLoopback || isPrivateIp || isLinkLocalOrMetadata) {
      throw new Error(
        `E-MCP-HOST-OR-SSRF-DENIED: Target host '${hostname}' is a private, loopback, or metadata address. Network egress blocked.`
      );
    }

    // Allowed hosts check
    const matchesAllowed = grant.allowed_hosts.some((allowed) => {
      if (allowed.startsWith('*.')) {
        const root = allowed.slice(2);
        return hostname === root || hostname.endsWith('.' + root);
      }
      return hostname === allowed;
    });

    if (!matchesAllowed) {
      throw new Error(
        `E-MCP-HOST-OR-SSRF-DENIED: Target host '${hostname}' is not in allowed_hosts [${grant.allowed_hosts.join(', ')}].`
      );
    }
  }

  /**
   * Brokered tool execution with full 4-quota enforcement, method validation, and ledger recording.
   */
  public async invokeTool(
    grant: CapabilityGrant,
    request: McpToolCallRequest
  ): Promise<McpToolCallResponse> {
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};

    let usage = this.usageRecords.get(grant.grant_id);
    if (!usage) {
      usage = { requests_made: 0, tokens_used: 0 };
      this.usageRecords.set(grant.grant_id, usage);
    }

    try {
      // 1. Expiration check
      if (Date.now() > Date.parse(grant.expires_at_utc)) {
        throw new Error(
          `E-MCP-GRANT-EXPIRED: CapabilityGrant '${grant.grant_id}' expired at ${grant.expires_at_utc}.`
        );
      }

      // 2. Tool permission check
      if (!grant.allowed_tools.includes(toolName)) {
        throw new Error(
          `E-MCP-TOOL-NOT-PERMITTED: Worker '${grant.worker_id}' is not granted tool '${toolName}'. Allowed: [${grant.allowed_tools.join(', ')}].`
        );
      }

      // 3. Request count quota check
      if (usage.requests_made + 1 > grant.max_requests) {
        throw new Error(
          `E-MCP-REQUEST-QUOTA-EXCEEDED: Grant '${grant.grant_id}' exceeded max_requests quota (${grant.max_requests}).`
        );
      }

      // 4. Method check (GET only)
      if (args.method && String(args.method).toUpperCase() !== 'GET') {
        throw new Error(
          `E-MCP-METHOD-DENIED: Method '${args.method}' is denied. Only GET operations are permitted under read-only discovery.`
        );
      }

      // 5. Redirect check
      if (args.allow_redirects === true || (args.max_redirects !== undefined && Number(args.max_redirects) > 0)) {
        if (!grant.allow_redirects) {
          throw new Error(
            `E-MCP-REDIRECT-DENIED: CapabilityGrant '${grant.grant_id}' strictly blocks cross-host HTTP redirects.`
          );
        }
      }

      // 6. SSRF & Host validation on any target URL/host argument
      const targetUrlOrHost = (args.url || args.host || args.target || args.endpoint) as string | undefined;
      if (targetUrlOrHost) {
        McpCapabilityBroker.validateHostAndSsrf(targetUrlOrHost, grant);
      }

      // 7. Verify tool exists & validate arguments
      const toolDef = this.server.getTool(toolName);
      if (!toolDef) {
        throw new Error(`E-MCP-TOOL-NOT-FOUND: Tool '${toolName}' is not registered on this server.`);
      }
      this.server.validateArguments(toolDef.descriptor, args);

      // Increment request count quota
      usage.requests_made++;

      // 8. Execute with latency quota (wall_clock_ms)
      const startMs = Date.now();

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `E-MCP-LATENCY-TIMEOUT: Execution latency exceeded grant max_latency_ms (${grant.max_latency_ms}ms).`
            )
          );
        }, grant.max_latency_ms);
      });

      const execPromise = toolDef.handler(args);
      const result = await Promise.race([execPromise, timeoutPromise]);
      const durationMs = Date.now() - startMs;

      // Check latency post-run
      if (durationMs > grant.max_latency_ms) {
        throw new Error(
          `E-MCP-LATENCY-TIMEOUT: Execution duration ${durationMs}ms exceeded max_latency_ms (${grant.max_latency_ms}ms).`
        );
      }

      // 9. Payload size quota check
      const payloadBytes = Buffer.byteLength(JSON.stringify(result));
      if (payloadBytes > grant.max_payload_bytes) {
        throw new Error(
          `E-MCP-PAYLOAD-TOO-LARGE: Response size ${payloadBytes} bytes exceeds grant max_payload_bytes cap (${grant.max_payload_bytes}).`
        );
      }

      // 10. Token quota check
      const tokensConsumed = result?.tokens_used ?? Math.ceil(payloadBytes / 4);
      if (usage.tokens_used + tokensConsumed > grant.max_tokens) {
        throw new Error(
          `E-MCP-TOKEN-QUOTA-EXCEEDED: Consumed ${usage.tokens_used + tokensConsumed} tokens, exceeding max_tokens quota (${grant.max_tokens}).`
        );
      }
      usage.tokens_used += tokensConsumed;

      // Append success event to Run Ledger
      this.runLedger.appendEvent('TOOL_CALL_INVOKED', grant.task_id, grant.worker_id, {
        grant_id: grant.grant_id,
        tool_name: toolName,
        payload_bytes: payloadBytes,
        tokens_consumed: tokensConsumed,
        duration_ms: durationMs
      });

      return {
        jsonrpc: '2.0',
        id: request.id,
        result
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // Append denied/quota event to Run Ledger
      const eventType = errMsg.includes('QUOTA') || errMsg.includes('TIMEOUT')
        ? 'QUOTA_EXCEEDED'
        : 'TOOL_CALL_DENIED';

      this.runLedger.appendEvent(eventType, grant.task_id, grant.worker_id, {
        grant_id: grant.grant_id,
        tool_name: toolName,
        error: errMsg
      });

      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: errMsg
        }
      };
    }
  }
}

// ============================================================================
// 4. APPEND-ONLY RUN LEDGER (POC.docx §15)
// ============================================================================

export type McpRunEventType =
  | 'TASK_DISPATCHED'
  | 'CAPABILITY_GRANTED'
  | 'TOOL_CALL_INVOKED'
  | 'TOOL_CALL_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'WORKER_OUTPUT_RECEIVED';

export interface McpRunEvent {
  readonly event_id: string;
  readonly event_type: McpRunEventType;
  readonly task_id: string;
  readonly worker_id: string;
  readonly timestamp_utc: string;
  readonly details: Record<string, unknown>;
  readonly previous_event_hash: string;
  readonly event_hash: string;
}

export class McpRunLedger {
  private readonly events: McpRunEvent[] = [];
  private static readonly GENESIS_HASH =
    '0000000000000000000000000000000000000000000000000000000000000000';

  public appendEvent(
    eventType: McpRunEventType,
    taskId: string,
    workerId: string,
    details: Record<string, unknown>,
    timestampUtc?: string
  ): McpRunEvent {
    const prevHash =
      this.events.length === 0
        ? McpRunLedger.GENESIS_HASH
        : this.events[this.events.length - 1].event_hash;

    const payload = {
      event_id: `mcp-evt-${this.events.length + 1}-${Date.now()}`,
      event_type: eventType,
      task_id: taskId,
      worker_id: workerId,
      timestamp_utc: timestampUtc ?? new Date().toISOString(),
      details: sanitizeForJcs(details),
      previous_event_hash: prevHash
    };

    const eventHash = sha256(canonicalizeJCS(payload));
    const fullEvent: McpRunEvent = {
      ...payload,
      event_hash: eventHash
    };

    this.events.push(Object.freeze(fullEvent));
    return fullEvent;
  }

  public getEvents(): readonly McpRunEvent[] {
    return [...this.events];
  }

  public verifyHashChain(): boolean {
    for (let i = 0; i < this.events.length; i++) {
      const evt = this.events[i];
      const expectedPrevHash =
        i === 0 ? McpRunLedger.GENESIS_HASH : this.events[i - 1].event_hash;

      if (evt.previous_event_hash !== expectedPrevHash) {
        return false;
      }

      const payload = {
        event_id: evt.event_id,
        event_type: evt.event_type,
        task_id: evt.task_id,
        worker_id: evt.worker_id,
        timestamp_utc: evt.timestamp_utc,
        details: sanitizeForJcs(evt.details),
        previous_event_hash: evt.previous_event_hash
      };

      const computedHash = sha256(canonicalizeJCS(payload));
      if (computedHash !== evt.event_hash) {
        return false;
      }
    }
    return true;
  }
}

// ============================================================================
// 5. CONFLICT-PRESERVING SUPPLEMENTARY CLAIM JOIN (POC.docx §5)
// ============================================================================

export interface SupplementaryClaim {
  readonly entity_id: string;
  readonly metric_name: string;
  readonly value: string | number | bigint;
  readonly source_id: string;
  readonly observed_at_utc: string;
}

export type SupplementaryJoinStatus =
  | 'CROSS_SOURCE_CORROBORATED'
  | 'CONFLICT'
  | 'SINGLE_SOURCE';

export interface SupplementaryJoinResult {
  readonly entity_id: string;
  readonly metric_name: string;
  readonly status: SupplementaryJoinStatus;
  readonly agreeing_value?: string | number | bigint;
  readonly conflicting_values?: Array<{ source_id: string; value: string | number | bigint }>;
  readonly sources: readonly string[];
}

/**
 * Merges independent supplementary claims without averaging, voting, or guessing.
 * Disagreeing observations yield CONFLICT; identical observations across independent sources yield CORROBORATED.
 */
export function joinSupplementaryClaims(
  claims: readonly SupplementaryClaim[]
): SupplementaryJoinResult[] {
  const groups = new Map<string, SupplementaryClaim[]>();

  for (const c of claims) {
    const key = `${c.entity_id}::${c.metric_name}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(c);
  }

  const results: SupplementaryJoinResult[] = [];

  for (const [key, group] of groups.entries()) {
    const [entity_id, metric_name] = key.split('::');
    const sources = Array.from(new Set(group.map((g) => g.source_id)));

    if (group.length === 1 || sources.length === 1) {
      results.push({
        entity_id,
        metric_name,
        status: 'SINGLE_SOURCE',
        agreeing_value: group[0].value,
        sources
      });
      continue;
    }

    // Check value equality across sources
    const canonicalValues = group.map((g) => g.value.toString());
    const firstVal = canonicalValues[0];
    const allAgree = canonicalValues.every((v) => v === firstVal);

    if (allAgree) {
      results.push({
        entity_id,
        metric_name,
        status: 'CROSS_SOURCE_CORROBORATED',
        agreeing_value: group[0].value,
        sources
      });
    } else {
      // Disagreement: strictly preserve conflict without averaging!
      results.push({
        entity_id,
        metric_name,
        status: 'CONFLICT',
        conflicting_values: group.map((g) => ({ source_id: g.source_id, value: g.value })),
        sources
      });
    }
  }

  return results;
}
