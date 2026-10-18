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

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
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
    readonly additionalProperties?: boolean;
  };
  readonly handlerSha256?: string;
}

export type PositiveToolManifest = McpToolDescriptor;

export interface McpToolCallRequest {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly method: 'tools/call';
  readonly params: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
}

export interface McpRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: string | number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface McpRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id?: string | number;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export interface McpResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly description?: string;
}

export interface McpResourceContent {
  readonly uri: string;
  readonly mimeType: string;
  readonly text?: string;
  readonly blob?: string;
}

export interface McpResourceDefinition {
  readonly descriptor: McpResourceDescriptor;
  readonly read: () => Promise<McpResourceContent>;
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
  private readonly resources = new Map<string, McpResourceDefinition>();

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

    // Verify handler SHA-256 integrity if declared on descriptor
    if (tool.descriptor.handlerSha256) {
      const handlerStr = tool.handler.toString();
      const computedSha = sha256(handlerStr);
      if (computedSha !== tool.descriptor.handlerSha256) {
        throw new Error(
          `E-MCP-HANDLER-TAMPERED: Tool '${name}' handler SHA-256 integrity check failed. Declared ${tool.descriptor.handlerSha256}, computed ${computedSha}.`
        );
      }
    }

    this.tools.set(name, tool);
  }

  public getTool(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  public listTools(): readonly McpToolDescriptor[] {
    return Array.from(this.tools.values()).map((t) => t.descriptor);
  }

  public registerResource(resource: McpResourceDefinition): void {
    const uri = resource.descriptor.uri;
    if (this.resources.has(uri)) {
      throw new Error(`E-MCP-RESOURCE-ALREADY-REGISTERED: Resource '${uri}' is already registered.`);
    }
    this.resources.set(uri, resource);
  }

  public getResource(uri: string): McpResourceDefinition | undefined {
    return this.resources.get(uri);
  }

  public listResources(): readonly McpResourceDescriptor[] {
    return Array.from(this.resources.values()).map((r) => r.descriptor);
  }

  public async readResource(uri: string): Promise<McpResourceContent> {
    const res = this.resources.get(uri);
    if (!res) {
      throw new Error(`E-MCP-RESOURCE-NOT-FOUND: Resource '${uri}' is not registered on this server.`);
    }
    return res.read();
  }

  public validateArguments(descriptor: McpToolDescriptor, args: Record<string, unknown>): void {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error(`E-MCP-INVALID-ARGUMENTS: Tool arguments must be a non-null object.`);
    }

    // Strict positive manifest check: reject unknown arguments if additionalProperties is false
    if (descriptor.inputSchema.additionalProperties === false) {
      const allowedProps = new Set(Object.keys(descriptor.inputSchema.properties ?? {}));
      for (const argKey of Object.keys(args)) {
        if (!allowedProps.has(argKey)) {
          throw new Error(
            `E-MCP-UNKNOWN-ARGUMENT-REJECTED: Argument '${argKey}' is not permitted by positive manifest for tool '${descriptor.name}'.`
          );
        }
      }
    }

    const required = descriptor.inputSchema.required ?? [];
    for (const reqProp of required) {
      if (args[reqProp] === undefined || args[reqProp] === null) {
        throw new Error(`E-MCP-INVALID-ARGUMENTS: Missing mandatory required argument '${reqProp}'.`);
      }
    }

    const properties = descriptor.inputSchema.properties ?? {};
    for (const [propName, propDef] of Object.entries(properties)) {
      const val = args[propName];
      if (val === undefined || val === null) {
        continue;
      }
      const expectedType = (propDef as { type?: string })?.type;
      if (!expectedType) continue;

      if (expectedType === 'array') {
        if (!Array.isArray(val)) {
          throw new Error(
            `E-MCP-INVALID-ARGUMENTS: Property '${propName}' must be of type 'array', received '${typeof val}'.`
          );
        }
      } else if (expectedType === 'object') {
        if (typeof val !== 'object' || Array.isArray(val)) {
          throw new Error(
            `E-MCP-INVALID-ARGUMENTS: Property '${propName}' must be of type 'object', received '${Array.isArray(val) ? 'array' : typeof val}'.`
          );
        }
      } else if (expectedType === 'number' || expectedType === 'integer') {
        if (typeof val !== 'number' && typeof val !== 'bigint') {
          throw new Error(
            `E-MCP-INVALID-ARGUMENTS: Property '${propName}' must be of type 'number', received '${typeof val}'.`
          );
        }
      } else if (expectedType === 'string') {
        if (typeof val !== 'string') {
          throw new Error(
            `E-MCP-INVALID-ARGUMENTS: Property '${propName}' must be of type 'string', received '${typeof val}'.`
          );
        }
      } else if (expectedType === 'boolean') {
        if (typeof val !== 'boolean') {
          throw new Error(
            `E-MCP-INVALID-ARGUMENTS: Property '${propName}' must be of type 'boolean', received '${typeof val}'.`
          );
        }
      }
    }
  }
}

// ============================================================================
// 3. CAPABILITY GRANT & EGRESS / SSRF POLICY
// ============================================================================

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
  readonly max_task_wall_clock_ms?: number;
  readonly expires_at_utc: string;
  readonly grant_signature_hmac?: string;
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
  max_task_wall_clock_ms?: number;
  expires_at_utc: string;
  grant_signature_hmac?: string;
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
    ...(params.max_task_wall_clock_ms !== undefined ? { max_task_wall_clock_ms: params.max_task_wall_clock_ms } : {}),
    expires_at_utc: params.expires_at_utc,
    ...(params.grant_signature_hmac ? { grant_signature_hmac: params.grant_signature_hmac } : {})
  };
  return Object.freeze(grant);
}

export function signCapabilityGrant(
  grant: Omit<CapabilityGrant, 'grant_signature_hmac'>,
  hmacSecret: string
): CapabilityGrant {
  const { ...fieldsWithoutSig } = grant;
  const canonical = canonicalizeJCS(sanitizeForJcs(fieldsWithoutSig));
  const signature = crypto.createHmac('sha256', Buffer.from(hmacSecret, 'utf8')).update(canonical).digest('hex');
  return Object.freeze({
    ...fieldsWithoutSig,
    grant_signature_hmac: signature
  });
}

export function verifyCapabilityGrantSignature(
  grant: CapabilityGrant,
  hmacSecret: string
): boolean {
  if (!grant.grant_signature_hmac) return false;
  const { grant_signature_hmac, ...fieldsWithoutSig } = grant;
  const canonical = canonicalizeJCS(sanitizeForJcs(fieldsWithoutSig));
  const expected = crypto.createHmac('sha256', Buffer.from(hmacSecret, 'utf8')).update(canonical).digest('hex');
  return grant.grant_signature_hmac === expected;
}

export interface McpBrokerOptions {
  readonly hmacSecret?: string;
}

export class McpCapabilityBroker {
  private readonly server: McpServerAdapter;
  private readonly runLedger: McpRunLedger;
  private readonly options?: McpBrokerOptions;
  private readonly usageRecords = new Map<string, { requests_made: number; tokens_used: number }>();
  private readonly taskCumulativeWallClock = new Map<string, number>();
  private readonly activeAbortControllers = new Map<string | number, AbortController>();
  private initialized = false;

  constructor(server: McpServerAdapter, runLedger?: McpRunLedger, options?: McpBrokerOptions) {
    this.server = server;
    this.runLedger = runLedger ?? new McpRunLedger();
    this.options = options;
  }

  public getRunLedger(): McpRunLedger {
    return this.runLedger;
  }

  public getUsage(grantId: string): { requests_made: number; tokens_used: number } | undefined {
    const usage = this.usageRecords.get(grantId);
    return usage ? { ...usage } : undefined;
  }

  public getTaskWallClockMs(taskId: string): number {
    return this.taskCumulativeWallClock.get(taskId) ?? 0;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Deterministically validates target host against SSRF and private IP ranges.
   */
  public static validateHostAndSsrf(urlOrHost: string, grant: CapabilityGrant): void {
    let hostname: string;

    try {
      if (urlOrHost.includes('://')) {
        const parsed = new URL(urlOrHost);
        const protocol = parsed.protocol.toLowerCase();
        if (protocol !== 'https:' && protocol !== 'mcp:') {
          throw new Error(
            `E-MCP-SCHEME-DENIED: Protocol scheme '${parsed.protocol}' is denied. Only https: and mcp: are permitted.`
          );
        }
        hostname = parsed.hostname.toLowerCase();
      } else {
        // Strip port or path if provided as host string
        hostname = urlOrHost.split('/')[0].split(':')[0].toLowerCase();
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('E-MCP-SCHEME-DENIED')) {
        throw err;
      }
      throw new Error(`E-MCP-HOST-OR-SSRF-DENIED: Malformed URL or host '${urlOrHost}'.`);
    }

    // Strip IPv6 enclosing brackets if present
    const cleanHost = hostname.replace(/^\[|\]$/g, '').toLowerCase();

    // SSRF Filter: Private, loopback, link-local, cloud metadata ranges, IPv6 ULA/link-local/mapped
    const isLoopback =
      cleanHost === 'localhost' ||
      cleanHost === '127.0.0.1' ||
      cleanHost.startsWith('127.') ||
      cleanHost === '0.0.0.0' ||
      cleanHost === '::1' ||
      cleanHost === '::';

    const isPrivateIpv4 =
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanHost) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(cleanHost) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(cleanHost);

    const isLinkLocalOrMetadata =
      cleanHost === '169.254.169.254' ||
      cleanHost.startsWith('169.254.') ||
      cleanHost.includes('metadata.google.internal') ||
      cleanHost.includes('169.254');

    const isIpv6PrivateOrMapped =
      cleanHost.includes('::ffff:') ||
      /^f[cd][0-9a-f]{0,2}:/i.test(cleanHost) ||
      /^fe80:/i.test(cleanHost);

    if (isLoopback || isPrivateIpv4 || isLinkLocalOrMetadata || isIpv6PrivateOrMapped) {
      throw new Error(
        `E-MCP-HOST-OR-SSRF-DENIED: Target host '${cleanHost}' is a private, loopback, or metadata address. Network egress blocked.`
      );
    }

    // Raw IP literal check: IPv4 or IPv6 literals must be explicitly listed in allowed_hosts
    const isIpv4Literal = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanHost);
    const isIpv6Literal = cleanHost.includes(':');
    if (isIpv4Literal || isIpv6Literal) {
      const explicitIpAllowed = grant.allowed_hosts.some((allowed) => {
        const cleanAllowed = allowed.toLowerCase().replace(/^\[|\]$/g, '');
        return cleanAllowed === cleanHost;
      });
      if (!explicitIpAllowed) {
        throw new Error(
          `E-MCP-HOST-OR-SSRF-DENIED: Raw IP literal '${cleanHost}' is not explicitly permitted in allowed_hosts.`
        );
      }
    }

    // Allowed hosts check
    const matchesAllowed = grant.allowed_hosts.some((allowed) => {
      const cleanAllowed = allowed.toLowerCase().replace(/^\[|\]$/g, '');
      if (cleanAllowed === '*') return true;
      if (cleanAllowed.startsWith('*.')) {
        const root = cleanAllowed.slice(2);
        return cleanHost === root || cleanHost.endsWith('.' + root);
      }
      return cleanHost === cleanAllowed;
    });

    if (!matchesAllowed) {
      throw new Error(
        `E-MCP-HOST-OR-SSRF-DENIED: Target host '${cleanHost}' is not in allowed_hosts [${grant.allowed_hosts.join(', ')}].`
      );
    }
  }

  /**
   * Brokered tool execution with full 4-quota enforcement, identity checks, method validation, and ledger recording.
   */
  public async invokeTool(
    grant: CapabilityGrant,
    request: McpToolCallRequest,
    callingContext?: { callingWorkerId?: string; callingTaskId?: string }
  ): Promise<McpToolCallResponse> {
    const toolName = request.params?.name;
    const args = request.params?.arguments ?? {};

    let usage = this.usageRecords.get(grant.grant_id);
    if (!usage) {
      usage = { requests_made: 0, tokens_used: 0 };
      this.usageRecords.set(grant.grant_id, usage);
    }

    try {
      // 0a. HMAC Signature Verification if broker configured with secret
      if (this.options?.hmacSecret) {
        if (!grant.grant_signature_hmac || !verifyCapabilityGrantSignature(grant, this.options.hmacSecret)) {
          throw new Error('E-MCP-GRANT-SIGNATURE-INVALID: CapabilityGrant HMAC signature is invalid or missing.');
        }
      }

      // 0b. Calling Worker and Task Identity Verification
      if (callingContext?.callingWorkerId && callingContext.callingWorkerId !== grant.worker_id) {
        throw new Error(
          `E-MCP-WORKER-IDENTITY-MISMATCH: Calling worker '${callingContext.callingWorkerId}' does not match grant worker '${grant.worker_id}'.`
        );
      }
      if (callingContext?.callingTaskId && callingContext.callingTaskId !== grant.task_id) {
        throw new Error(
          `E-MCP-WORKER-IDENTITY-MISMATCH: Calling task '${callingContext.callingTaskId}' does not match grant task '${grant.task_id}'.`
        );
      }

      // 1. Expiration check
      if (Date.now() > Date.parse(grant.expires_at_utc)) {
        throw new Error(
          `E-MCP-GRANT-EXPIRED: CapabilityGrant '${grant.grant_id}' expired at ${grant.expires_at_utc}.`
        );
      }

      // 2. Cumulative task wall-clock quota check (pre-flight)
      const currentTaskElapsed = this.taskCumulativeWallClock.get(grant.task_id) ?? 0;
      if (grant.max_task_wall_clock_ms !== undefined && currentTaskElapsed >= grant.max_task_wall_clock_ms) {
        throw new Error(
          `E-MCP-TASK-WALL-CLOCK-EXCEEDED: Cumulative task wall-clock budget of ${grant.max_task_wall_clock_ms}ms exhausted (already spent ${currentTaskElapsed}ms).`
        );
      }

      // 3. Tool permission check
      if (!grant.allowed_tools.includes(toolName)) {
        throw new Error(
          `E-MCP-TOOL-NOT-PERMITTED: Worker '${grant.worker_id}' is not granted tool '${toolName}'. Allowed: [${grant.allowed_tools.join(', ')}].`
        );
      }

      // 4. Request count quota check
      if (usage.requests_made + 1 > grant.max_requests) {
        throw new Error(
          `E-MCP-REQUEST-QUOTA-EXCEEDED: Grant '${grant.grant_id}' exceeded max_requests quota (${grant.max_requests}).`
        );
      }

      // 5. Method check (GET only)
      if (args.method && String(args.method).toUpperCase() !== 'GET') {
        throw new Error(
          `E-MCP-METHOD-DENIED: Method '${args.method}' is denied. Only GET operations are permitted under read-only discovery.`
        );
      }

      // 6. Redirect check
      if (
        args.allow_redirects === true ||
        (args.max_redirects !== undefined && Number(args.max_redirects) > 0) ||
        args.redirect === 'follow' ||
        args.follow_redirects === true ||
        args.redirect_status === 302
      ) {
        if (!grant.allow_redirects) {
          throw new Error(
            `E-MCP-REDIRECT-DENIED: CapabilityGrant '${grant.grant_id}' strictly blocks cross-host HTTP redirects.`
          );
        }
      }

      // 7. SSRF & Host validation on any target URL/host argument
      const targetUrlOrHost = (args.url || args.target_url || args.host || args.target || args.endpoint) as string | undefined;
      if (targetUrlOrHost) {
        McpCapabilityBroker.validateHostAndSsrf(targetUrlOrHost, grant);
      }

      // 8. Verify tool exists & validate arguments
      const toolDef = this.server.getTool(toolName);
      if (!toolDef) {
        throw new Error(`E-MCP-TOOL-NOT-FOUND: Tool '${toolName}' is not registered on this server.`);
      }
      this.server.validateArguments(toolDef.descriptor, args);

      // Increment request count quota
      usage.requests_made++;

      // 9. Execute with latency quota (wall_clock_ms) and abort controller
      const abortController = new AbortController();
      if (request.id !== undefined) {
        this.activeAbortControllers.set(request.id, abortController);
      }

      const startMs = Date.now();
      let timerHandle: ReturnType<typeof setTimeout> | undefined;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timerHandle = setTimeout(() => {
          abortController.abort(new Error(`E-MCP-LATENCY-TIMEOUT: Execution latency exceeded grant max_latency_ms (${grant.max_latency_ms}ms).`));
          reject(
            new Error(
              `E-MCP-LATENCY-TIMEOUT: Execution latency exceeded grant max_latency_ms (${grant.max_latency_ms}ms).`
            )
          );
        }, grant.max_latency_ms);
      });

      const execPromise = toolDef.handler(args);
      let result: McpToolCallResponse['result'];
      try {
        result = await Promise.race([execPromise, timeoutPromise]);
      } finally {
        if (timerHandle) {
          clearTimeout(timerHandle);
        }
        if (request.id !== undefined) {
          this.activeAbortControllers.delete(request.id);
        }
      }
      const durationMs = Date.now() - startMs;

      // Check latency post-run
      if (durationMs > grant.max_latency_ms) {
        throw new Error(
          `E-MCP-LATENCY-TIMEOUT: Execution duration ${durationMs}ms exceeded max_latency_ms (${grant.max_latency_ms}ms).`
        );
      }

      // Tally cumulative task wall-clock
      const updatedTaskElapsed = currentTaskElapsed + durationMs;
      this.taskCumulativeWallClock.set(grant.task_id, updatedTaskElapsed);
      if (grant.max_task_wall_clock_ms !== undefined && updatedTaskElapsed > grant.max_task_wall_clock_ms) {
        throw new Error(
          `E-MCP-TASK-WALL-CLOCK-EXCEEDED: Cumulative task wall-clock budget of ${grant.max_task_wall_clock_ms}ms exceeded (${updatedTaskElapsed}ms spent).`
        );
      }

      // 10. Payload size quota check
      const payloadBytes = Buffer.byteLength(JSON.stringify(result));
      if (payloadBytes > grant.max_payload_bytes) {
        throw new Error(
          `E-MCP-PAYLOAD-TOO-LARGE: Response size ${payloadBytes} bytes exceeds grant max_payload_bytes cap (${grant.max_payload_bytes}).`
        );
      }

      // 11. Token quota check
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
        duration_ms: durationMs,
        cumulative_task_wall_clock_ms: updatedTaskElapsed
      });

      return {
        jsonrpc: '2.0',
        id: request.id,
        result
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // Append denied/quota event to Run Ledger
      const eventType = errMsg.includes('QUOTA') || errMsg.includes('TIMEOUT') || errMsg.includes('WALL-CLOCK')
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

  /**
   * Complete MCP Wire Protocol Lifecycle Dispatcher.
   * Handles initialize, notifications/initialized, ping, tools/list, resources/list,
   * resources/read, notifications/cancelled, and tools/call.
   */
  public async handleRpcMessage(
    message: McpRpcRequest,
    grant?: CapabilityGrant | null,
    callingContext?: { callingWorkerId?: string; callingTaskId?: string }
  ): Promise<McpRpcResponse | null> {
    const { jsonrpc, id, method, params } = message;

    if (jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0".' }
      };
    }

    switch (method) {
      case 'initialize': {
        const protocolVersion = (params?.protocolVersion as string | undefined) ?? '';
        if (protocolVersion !== '2025-11-25') {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `E-MCP-UNSUPPORTED-PROTOCOL-VERSION: Protocol version '${protocolVersion}' is not supported. Supported version is '2025-11-25'.`
            }
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              logging: {}
            },
            serverInfo: {
              name: 'market-hft-mcp-broker',
              version: '0.2.6'
            }
          }
        };
      }

      case 'notifications/initialized': {
        this.initialized = true;
        return null; // Notifications return no response per JSON-RPC
      }

      case 'ping': {
        return {
          jsonrpc: '2.0',
          id,
          result: {}
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.server.listTools()
          }
        };
      }

      case 'resources/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resources: this.server.listResources()
          }
        };
      }

      case 'resources/read': {
        const uri = params?.uri as string | undefined;
        if (!uri) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'E-MCP-INVALID-ARGUMENTS: Missing mandatory "uri" parameter for resources/read.' }
          };
        }
        try {
          const content = await this.server.readResource(uri);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [content]
            }
          };
        } catch (readErr: unknown) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32000,
              message: readErr instanceof Error ? readErr.message : String(readErr)
            }
          };
        }
      }

      case 'notifications/cancelled': {
        const reqId = (params?.requestId ?? params?.id) as string | number | undefined;
        if (reqId !== undefined) {
          const ctrl = this.activeAbortControllers.get(reqId);
          if (ctrl) {
            ctrl.abort(new Error(`E-MCP-CANCELLED: Request '${reqId}' cancelled by client notification.`));
            this.activeAbortControllers.delete(reqId);
          }
        }
        return null;
      }

      case 'tools/call': {
        if (!grant) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32600,
              message: 'E-MCP-GRANT-REQUIRED: A valid CapabilityGrant is required for tools/call invocation.'
            }
          };
        }
        const callReq: McpToolCallRequest = {
          jsonrpc: '2.0',
          id: id ?? 1,
          method: 'tools/call',
          params: {
            name: (params?.name as string) ?? '',
            arguments: (params?.arguments as Record<string, unknown>) ?? {}
          }
        };
        const response = await this.invokeTool(grant, callReq, callingContext);
        return {
          jsonrpc: '2.0',
          id,
          ...(response.result !== undefined ? { result: response.result } : {}),
          ...(response.error !== undefined ? { error: response.error } : {})
        };
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
      }
    }
  }
}

// ============================================================================
// 4. CONSTRAINED HTTPS CONNECTOR (SSRF, DNS REBINDING & STREAM CUTOFF)
// ============================================================================

export interface ConstrainedHttpsOptions {
  readonly method?: 'GET';
  readonly headers?: Record<string, string>;
  readonly max_payload_bytes: number;
  readonly timeout_ms: number;
  readonly allow_redirects?: boolean;
}

export interface ConstrainedHttpsResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly bodyText: string;
  readonly bytesRead: number;
}

export class ConstrainedHttpsConnector {
  public static async fetch(
    targetUrl: string,
    options: ConstrainedHttpsOptions
  ): Promise<ConstrainedHttpsResponse> {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      throw new Error(`E-MCP-HOST-OR-SSRF-DENIED: Malformed URL '${targetUrl}'.`);
    }

    if (parsed.protocol.toLowerCase() !== 'https:') {
      throw new Error(`E-MCP-SCHEME-DENIED: Scheme '${parsed.protocol}' is denied. Only https: is permitted for network egress.`);
    }
    if (parsed.port && parsed.port !== '' && parsed.port !== '443') {
      throw new Error(`E-MCP-PORT-DENIED: Port '${parsed.port}' is denied. Network egress is strictly locked to port 443.`);
    }

    // DNS Pre-Resolution Check
    const hostname = parsed.hostname.toLowerCase();
    let addresses: { address: string; family: number }[];
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch (dnsErr: unknown) {
      throw new Error(`E-MCP-DNS-RESOLUTION-FAILED: DNS lookup failed for '${hostname}': ${dnsErr instanceof Error ? dnsErr.message : String(dnsErr)}`);
    }

    if (!addresses || addresses.length === 0) {
      throw new Error(`E-MCP-DNS-RESOLUTION-FAILED: No IP addresses resolved for '${hostname}'.`);
    }

    for (const entry of addresses) {
      const addr = entry.address.toLowerCase().replace(/^\[|\]$/g, '');
      const isLoopback =
        addr === 'localhost' ||
        addr === '127.0.0.1' ||
        addr.startsWith('127.') ||
        addr === '0.0.0.0' ||
        addr === '::1' ||
        addr === '::';
      const isPrivateIpv4 =
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(addr) ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(addr);
      const isLinkLocalOrMetadata =
        addr === '169.254.169.254' ||
        addr.startsWith('169.254.') ||
        addr.includes('metadata.google.internal');
      const isIpv6PrivateOrMapped =
        addr.includes('::ffff:') ||
        /^f[cd][0-9a-f]{0,2}:/i.test(addr) ||
        /^fe80:/i.test(addr);

      if (isLoopback || isPrivateIpv4 || isLinkLocalOrMetadata || isIpv6PrivateOrMapped) {
        throw new Error(`E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED: Target host '${hostname}' resolved to private/loopback/metadata IP '${addr}'. Network egress blocked to prevent DNS rebinding.`);
      }
    }

    // Perform streaming fetch with abort controller
    const abortController = new AbortController();
    let timerHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timerHandle = setTimeout(() => {
        abortController.abort(new Error(`E-MCP-LATENCY-TIMEOUT: Network request exceeded timeout (${options.timeout_ms}ms).`));
        reject(new Error(`E-MCP-LATENCY-TIMEOUT: Network request exceeded timeout (${options.timeout_ms}ms).`));
      }, options.timeout_ms);
    });

    const fetchPromise = (async () => {
      try {
        const res = await fetch(targetUrl, {
          method: 'GET',
          headers: options.headers,
          redirect: options.allow_redirects ? 'follow' : 'manual',
          signal: abortController.signal
        });

        if (!options.allow_redirects && res.status >= 300 && res.status < 400) {
          throw new Error(`E-MCP-REDIRECT-DENIED: Server returned redirect status ${res.status} but redirects are disallowed.`);
        }

        if (!res.body) {
          return {
            status: res.status,
            headers: Object.fromEntries(res.headers.entries()),
            bodyText: '',
            bytesRead: 0
          };
        }

        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > options.max_payload_bytes) {
              abortController.abort(new Error(`E-MCP-STREAM-PAYLOAD-TOO-LARGE: Streamed response exceeded max_payload_bytes cap (${options.max_payload_bytes} bytes) in-flight. Connection terminated.`));
              throw new Error(`E-MCP-STREAM-PAYLOAD-TOO-LARGE: Streamed response exceeded max_payload_bytes cap (${options.max_payload_bytes} bytes) in-flight. Connection terminated.`);
            }
            chunks.push(value);
          }
        }

        const combined = Buffer.concat(chunks);
        const bodyText = combined.toString('utf8');
        return {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          bodyText,
          bytesRead: totalBytes
        };
      } catch (fetchErr: unknown) {
        if (abortController.signal.aborted && abortController.signal.reason instanceof Error) {
          throw abortController.signal.reason;
        }
        throw fetchErr;
      }
    })();

    try {
      return await Promise.race([fetchPromise, timeoutPromise]);
    } finally {
      if (timerHandle) clearTimeout(timerHandle);
    }
  }
}

// ============================================================================
// 5. APPEND-ONLY RUN LEDGER (POC.docx §15)
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

  public async saveLedgerToFile(filePath: string): Promise<void> {
    const jsonl = this.events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.writeFile(filePath, jsonl, 'utf8');
  }

  public static async loadLedgerFromFile(filePath: string): Promise<McpRunLedger> {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n').filter((l) => l.trim().length > 0);
    const ledger = new McpRunLedger();
    for (let i = 0; i < lines.length; i++) {
      const evt: McpRunEvent = JSON.parse(lines[i]);
      const expectedPrev = i === 0 ? McpRunLedger.GENESIS_HASH : ledger.events[i - 1].event_hash;
      if (evt.previous_event_hash !== expectedPrev) {
        throw new Error(
          `E-MCP-LEDGER-TAMPERED: Monotonic hash chain verification failed on event index ${i}. Expected prev hash ${expectedPrev}, found ${evt.previous_event_hash}.`
        );
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
      const computed = sha256(canonicalizeJCS(payload));
      if (computed !== evt.event_hash) {
        throw new Error(
          `E-MCP-LEDGER-TAMPERED: Monotonic hash chain verification failed on event index ${i}. Event hash tampered.`
        );
      }
      ledger.events.push(Object.freeze(evt));
    }
    return ledger;
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
  readonly conflicting_values?: readonly (Readonly<{ source_id: string; value: string | number | bigint }>)[];
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

  const sortedKeys = Array.from(groups.keys()).sort();
  const results: SupplementaryJoinResult[] = [];

  for (const key of sortedKeys) {
    const group = groups.get(key)!;
    const [entity_id, metric_name] = key.split('::');
    const sources = Array.from(new Set(group.map((g) => g.source_id))).sort();

    if (group.length === 1 || sources.length === 1) {
      const res: SupplementaryJoinResult = {
        entity_id,
        metric_name,
        status: 'SINGLE_SOURCE',
        agreeing_value: group[0].value,
        sources: Object.freeze(sources)
      };
      results.push(Object.freeze(res));
      continue;
    }

    // Check value equality across sources
    const canonicalValues = group.map((g) => g.value.toString());
    const firstVal = canonicalValues[0];
    const allAgree = canonicalValues.every((v) => v === firstVal);

    if (allAgree) {
      const res: SupplementaryJoinResult = {
        entity_id,
        metric_name,
        status: 'CROSS_SOURCE_CORROBORATED',
        agreeing_value: group[0].value,
        sources: Object.freeze(sources)
      };
      results.push(Object.freeze(res));
    } else {
      // Disagreement: strictly preserve conflict without averaging!
      const conflictingValues = group
        .map((g) => ({ source_id: g.source_id, value: g.value }))
        .sort((a, b) => {
          const cmp = a.source_id.localeCompare(b.source_id);
          if (cmp !== 0) return cmp;
          return a.value.toString().localeCompare(b.value.toString());
        })
        .map((cv) => Object.freeze(cv));

      const res: SupplementaryJoinResult = {
        entity_id,
        metric_name,
        status: 'CONFLICT',
        conflicting_values: Object.freeze(conflictingValues),
        sources: Object.freeze(sources)
      };
      results.push(Object.freeze(res));
    }
  }

  return Object.freeze(results) as unknown as SupplementaryJoinResult[];
}
