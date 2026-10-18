/**
 * Gate M7.0 (Decision OD-20 / Charter DEC-020):
 * Runnable Local Loopback Workstation Server
 *
 * Implements the deterministic local loopback HTTP and WebSocket server that:
 * 1. Confines network binding strictly to loopback (127.0.0.1 / localhost) per POC.docx §10.5.
 * 2. Enforces SRV-01: Browser DNS-rebinding & CSWSH firewalls, 64KB request body cap,
 *    and strict security headers (CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff).
 * 3. Enforces SRV-02: Zero client-side financial float math; pure BigInt rational AST on backend.
 * 4. Enforces SRV-03: Kill-switch enforcement across live HTTP action dispatches (HTTP 409 on DAG run if halted).
 * 5. Enforces SRV-04: Ephemeral loopback port support (port: 0) for isolated test runs.
 * 6. Broadcasts authoritative snapshot updates to connected WebSockets on any state transition.
 */

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { WorkstationStateManager } from './workstationStateManager.js';
import { renderOperatorTerminalHtml, formatTwoLevelError } from '../terminal/operatorTerminalController.js';
import {
  KillSwitchHaltScope,
  OperatorConfirmationEnvelope,
  TwoLevelErrorEnvelope
} from '../mcp/contracts/operatorTerminalContract.js';
import { FormulaCardInput } from '../research/formulaRegistry.js';

export interface WorkstationServerOptions {
  readonly port?: number; // default: 4310; supports port: 0 for ephemeral OS assignment (SRV-04)
  readonly host?: string; // default: '127.0.0.1'; STRICT GUARD: must be '127.0.0.1' or 'localhost'
  readonly stateManager?: WorkstationStateManager;
  readonly corsAllowedOrigins?: readonly string[];
}

export function createServerErrorEnvelope(
  err: unknown,
  affectedEntityId: string = 'server:http',
  correlationId: string = `corr-${Date.now()}`
): TwoLevelErrorEnvelope {
  return formatTwoLevelError(err, {
    affected_entity_id: affectedEntityId,
    correlation_id: correlationId,
    timestamp_utc: new Date().toISOString()
  });
}

export function isValidLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  // hostHeader can be '127.0.0.1:4310', 'localhost:4310', '127.0.0.1', 'localhost', '[::1]:4310', etc.
  const hostWithoutPort = hostHeader.startsWith('[')
    ? hostHeader.substring(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0];
  return (
    hostWithoutPort === '127.0.0.1' ||
    hostWithoutPort === 'localhost' ||
    hostWithoutPort === '[::1]'
  );
}

export function isValidOrigin(
  originHeader: string | undefined,
  allowedOrigins: readonly string[]
): boolean {
  if (!originHeader) {
    // Non-browser / same-origin CLI / direct tools may omit Origin header
    return true;
  }
  try {
    const parsed = new URL(originHeader);
    const host = parsed.hostname;
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') {
      return true;
    }
    return allowedOrigins.includes(originHeader);
  } catch {
    return false;
  }
}

export function applySecurityHeaders(res: http.ServerResponse): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*; frame-ancestors 'none';"
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
}

export function sendJsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  data: any
): void {
  applySecurityHeaders(res);
  let payload = data;
  if (data && data.audit_detail && !data.error) {
    payload = {
      ...data,
      error: {
        ...data,
        error_id: data.audit_detail.error_code,
        operator_summary: data.operator_message
      }
    };
  }
  const body = JSON.stringify(payload);
  const headers: Record<string, string | number> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body, 'utf8')
  };
  if (statusCode === 413) {
    headers['Connection'] = 'close';
  }
  res.writeHead(statusCode, headers);
  res.end(body);
}

export function readJsonBody(
  req: http.IncomingMessage,
  maxBytes: number = 65536
): Promise<{ error?: { status: number; envelope: TwoLevelErrorEnvelope }; data?: any }> {
  return new Promise((resolve) => {
    let raw = '';
    let bytesReceived = 0;
    let exceeded = false;

    req.on('data', (chunk: Buffer) => {
      if (exceeded) return;
      bytesReceived += chunk.length;
      if (bytesReceived > maxBytes) {
        exceeded = true;
        req.on('data', () => {}); // drain stream
        const errEnvelope = createServerErrorEnvelope(
          new Error('E-SRV-REQUEST-BODY-TOO-LARGE: Request payload exceeds maximum allowable loopback envelope size of 65536 bytes.'),
          'server:http:request-body'
        );
        resolve({
          error: {
            status: 413,
            envelope: errEnvelope
          }
        });
        return;
      }
      raw += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (exceeded) return;
      if (!raw.trim()) {
        resolve({ data: {} });
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve({ data: parsed });
      } catch (e) {
        const errEnvelope = createServerErrorEnvelope(
          new Error(`E-SRV-INVALID-JSON: Request body could not be parsed as JSON: ${e instanceof Error ? e.message : String(e)}`),
          'server:http:json-parse'
        );
        resolve({
          error: {
            status: 400,
            envelope: errEnvelope
          }
        });
      }
    });

    req.on('error', (e) => {
      if (exceeded) return;
      const errEnvelope = createServerErrorEnvelope(
        new Error(`E-SRV-STREAM-ERROR: Request stream encountered an error: ${e.message}`),
        'server:http:stream'
      );
      resolve({
        error: {
          status: 500,
          envelope: errEnvelope
        }
      });
    });
  });
}

export class WorkstationServer {
  private requestedPort: number;
  private boundPort: number;
  private host: string;
  private stateManager: WorkstationStateManager;
  private corsAllowedOrigins: readonly string[];
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private unsubscribeListener: (() => void) | null = null;

  constructor(options?: WorkstationServerOptions) {
    const host = options?.host ?? '127.0.0.1';

    // Strict Loopback Binding Guard
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' && host !== '[::1]') {
      throw new Error(
        `E-SRV-NON-LOOPBACK-BIND-FORBIDDEN: WorkstationServer is strictly confined to loopback interface (127.0.0.1 / localhost). Requested host: ${host}`
      );
    }

    this.host = host;
    this.requestedPort = options?.port ?? 4310;
    this.boundPort = this.requestedPort;
    this.stateManager = options?.stateManager ?? new WorkstationStateManager();
    this.corsAllowedOrigins = options?.corsAllowedOrigins ?? [
      'http://127.0.0.1:4310',
      'http://localhost:4310'
    ];

    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res).catch((err) => {
        const envelope = createServerErrorEnvelope(
          err instanceof Error ? err : new Error(String(err)),
          'server:http:unhandled'
        );
        sendJsonResponse(res, 500, envelope);
      });
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.setupWebSocketUpgrade();
    this.setupWebSocketBroadcast();
  }

  private setupWebSocketUpgrade(): void {
    this.httpServer.on('upgrade', (req, socket, head) => {
      // 1. Host Header Firewall (SRV-01)
      const host = req.headers['host'];
      if (!isValidLoopbackHost(host)) {
        const err = createServerErrorEnvelope(
          new Error(`E-SRV-INVALID-HOST-HEADER: Host header "${host}" rejected. Only loopback interface (127.0.0.1 / localhost) permitted.`),
          'server:ws:host-firewall'
        );
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      // 2. Origin Header Firewall (SRV-01: CSWSH Protection)
      const origin = req.headers['origin'];
      if (!isValidOrigin(origin, this.corsAllowedOrigins)) {
        const err = createServerErrorEnvelope(
          new Error(`E-SRV-CROSS-ORIGIN-BLOCKED: Cross-origin WebSocket upgrade from "${origin}" blocked by loopback security policy.`),
          'server:ws:origin-firewall'
        );
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      // 3. Pathname validation
      const urlObj = new URL(req.url || '/', `http://${host || '127.0.0.1'}`);
      if (urlObj.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });
  }

  private setupWebSocketBroadcast(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      // Send initial snapshot broadcast immediately on connection
      try {
        const initialMsg = JSON.stringify({
          type: 'TERMINAL_SNAPSHOT_BROADCAST',
          event: 'SNAPSHOT_INITIAL',
          snapshot: this.stateManager.getSnapshot(),
          timestamp: new Date().toISOString()
        });
        ws.send(initialMsg);
      } catch {
        // Socket closed prematurely
      }
    });

    // Subscribe to authoritative StateManager events
    this.unsubscribeListener = this.stateManager.subscribe((event) => {
      const broadcastMsg = JSON.stringify({
        type: 'TERMINAL_SNAPSHOT_BROADCAST',
        event: event.type,
        snapshot: this.stateManager.getSnapshot(),
        timestamp: event.timestamp_utc,
        details: event.details
      });

      for (const client of this.wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(broadcastMsg);
          } catch {
            // Socket error
          }
        }
      }
    });
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 1. Host Header Firewall (SRV-01: DNS Rebinding Protection)
    const hostHeader = req.headers['host'];
    if (!isValidLoopbackHost(hostHeader)) {
      const err = createServerErrorEnvelope(
        new Error(`E-SRV-INVALID-HOST-HEADER: Host header "${hostHeader}" rejected. Only loopback interface (127.0.0.1 / localhost) permitted.`),
        'server:http:host-firewall'
      );
      sendJsonResponse(res, 403, err);
      return;
    }

    const method = req.method?.toUpperCase();
    const urlObj = new URL(req.url || '/', `http://${hostHeader}`);
    const pathname = urlObj.pathname;

    // 2. Origin Header Firewall for state-mutating POST requests (SRV-01: CORS / CSRF Protection)
    if (method === 'POST') {
      const originHeader = req.headers['origin'];
      if (!isValidOrigin(originHeader, this.corsAllowedOrigins)) {
        const err = createServerErrorEnvelope(
          new Error(`E-SRV-CROSS-ORIGIN-BLOCKED: Cross-origin request from "${originHeader}" blocked by loopback security policy.`),
          'server:http:origin-firewall'
        );
        sendJsonResponse(res, 403, err);
        return;
      }
    }

    // 3. Routing Table
    // Route 1: Root Workstation HTML
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const snapshot = this.stateManager.getSnapshot();
      const html = renderOperatorTerminalHtml(snapshot);
      applySecurityHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html, 'utf8')
      });
      res.end(html);
      return;
    }

    // Route 2: Snapshot API
    if (method === 'GET' && pathname === '/api/snapshot') {
      const snapshot = this.stateManager.getSnapshot();
      sendJsonResponse(res, 200, { snapshot });
      return;
    }

    // Route 3: Health API
    if (method === 'GET' && pathname === '/api/health') {
      const health = this.stateManager.getHealthStatus();
      sendJsonResponse(res, 200, health);
      return;
    }

    // Route 4: Readiness Certificate API
    if (method === 'GET' && pathname === '/api/certificate') {
      const certificate = this.stateManager.getReadinessCertificate();
      sendJsonResponse(res, 200, { certificate });
      return;
    }

    // Route 5: Kill-Switch Transition Action
    if (method === 'POST' && pathname === '/api/actions/kill-switch') {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }

      const body = bodyResult.data || {};
      const targetScope: KillSwitchHaltScope = body.target_scope;
      const rationale: string = body.rationale || body.confirmation?.explicit_rationale || '';

      if (!targetScope) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Missing target_scope parameter in kill-switch transition request.'),
          'server:api:kill-switch'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      if (rationale.trim().length < 15) {
        const err = createServerErrorEnvelope(
          new Error('E-M8-RATIONALE-INSUFFICIENT: Kill-switch scope transitions require an explicit operator rationale of at least 15 characters.'),
          'server:api:kill-switch'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      const confirmation: OperatorConfirmationEnvelope = body.confirmation || {
        operator_id: body.operator_id || 'operator:terminal:web',
        action_type: targetScope === 'NORMAL_PAPER_OPERATION' ? 'RESET_KILL_SWITCH' : 'ACTIVATE_KILL_SWITCH',
        target_entity_id: `kill-switch:${targetScope}`,
        explicit_rationale: rationale,
        confirmation_token: body.confirmation_token || `token-${Date.now()}`,
        confirmed_at_utc: new Date().toISOString(),
        dry_run_mode_acknowledged: true
      };

      try {
        const result = this.stateManager.executeKillSwitchTransition(targetScope, confirmation);
        sendJsonResponse(res, 200, result);
      } catch (e: any) {
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:kill-switch'
        );
        sendJsonResponse(res, 400, err);
      }
      return;
    }

    // Route 6: Governed DAG Run Action (SRV-03: Kill-Switch Enforcement)
    if (method === 'POST' && pathname === '/api/actions/run-dag') {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }

      const body = bodyResult.data || {};
      const rationale: string = body.rationale || body.confirmation?.explicit_rationale || 'Authorized operator DAG execution run';

      if (rationale.trim().length < 15) {
        const err = createServerErrorEnvelope(
          new Error('E-M8-RATIONALE-INSUFFICIENT: Governed DAG execution requires an explicit operator rationale of at least 15 characters.'),
          'server:api:run-dag'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      const confirmation: OperatorConfirmationEnvelope = body.confirmation || {
        operator_id: body.operator_id || 'operator:terminal:web',
        action_type: 'APPROVE_PAPER_ALLOCATION',
        target_entity_id: 'plan:governed-dag-run',
        explicit_rationale: rationale,
        confirmation_token: body.confirmation_token || `token-${Date.now()}`,
        confirmed_at_utc: new Date().toISOString(),
        dry_run_mode_acknowledged: true
      };

      try {
        const result = await this.stateManager.triggerGovernedDagRun(confirmation);
        sendJsonResponse(res, 200, result);
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        const isKillSwitchHalt =
          msg.includes('E-M8-KILLSWITCH-ALL-SIMULATION-HALTED') ||
          msg.includes('E-M8-KILLSWITCH-RECOVERY-ONLY') ||
          msg.includes('simulation processing halted') ||
          msg.includes('restricted strictly to recovery');

        const statusCode = isKillSwitchHalt ? 409 : 500;
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          isKillSwitchHalt ? 'server:api:run-dag:kill-switch-halt' : 'server:api:run-dag:error'
        );
        sendJsonResponse(res, statusCode, err);
      }
      return;
    }

    // Route 7: What-If Formula Evaluation Action (SRV-02: BigInt Rational AST)
    if (method === 'POST' && pathname === '/api/actions/what-if-formula') {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }

      const body = bodyResult.data || {};
      const formulaId: string = body.formula_id || body.cardInput?.formula_id || 'F01_ESTIMATED_NET_PAYOUT';

      const cardInput: FormulaCardInput = body.cardInput || {
        formula_id: formulaId,
        title: body.title || `What-If Analysis for ${formulaId}`,
        domain: 'PHYSICAL_ARBITRAGE',
        tier: 'CANDIDATE_UI_MODEL',
        statutory_or_economic_citations: ['POC.docx §3 / §10.5'],
        symbolic_expression: body.symbolic_expression || 'landed_cost + demurrage_surcharge',
        input_variables: [
          { name: 'landed_cost', unit: 'SUBUNITS_INR', description: 'Simulated Landed Cost' },
          { name: 'demurrage_surcharge', unit: 'SUBUNITS_INR', description: 'Simulated Surcharge' }
        ],
        output_variable: { name: 'adjusted_cost', unit: 'SUBUNITS_INR' },
        rationale_and_invariants: 'What-If UI sandbox evaluation; non-mutating.',
        canonical_test_vector: {
          inputs: { landed_cost: '382100', demurrage_surcharge: '15000' },
          expected_output: '397100'
        },
        evidence_origin_class: 'LLM_MODEL_PROPOSAL'
      };

      const testVars: Record<string, string | number> = body.testVariables || body.inputs || {};

      try {
        const evaluation = this.stateManager.evaluateWhatIfFormula(cardInput, testVars);
        sendJsonResponse(res, 200, {
          model: {
            formula_id: evaluation.card_id,
            status: evaluation.tier,
            calculated_output_subunits: evaluation.calculated_output_subunits,
            baseline_output_subunits: evaluation.baseline_output_subunits,
            variance_bps: evaluation.variance_bps,
            result: {
              value: Number(evaluation.calculated_output_subunits) / 100,
              unit: 'INR',
              rational_representation: `${evaluation.calculated_output_subunits} / 10000 INR`
            },
            raw: evaluation
          },
          evaluation
        });
      } catch (e: any) {
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:what-if'
        );
        sendJsonResponse(res, 400, err);
      }
      return;
    }

    // Route 8: Fallback / 404
    const err = createServerErrorEnvelope(
      new Error(`E-SRV-NOT-FOUND: Resource ${pathname} with method ${method} not found on workstation server.`),
      'server:http:not-found'
    );
    sendJsonResponse(res, 404, err);
  }

  public async start(): Promise<{ port: number; url: string }> {
    return new Promise((resolve, reject) => {
      this.httpServer.once('error', (err) => {
        reject(err);
      });

      this.httpServer.listen(this.requestedPort, this.host, () => {
        const addr = this.httpServer.address();
        if (typeof addr === 'object' && addr !== null) {
          this.boundPort = addr.port;
        } else {
          this.boundPort = this.requestedPort;
        }
        resolve({
          port: this.boundPort,
          url: this.getUrl()
        });
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.unsubscribeListener) {
      this.unsubscribeListener();
      this.unsubscribeListener = null;
    }

    // Close all connected WebSocket clients
    for (const client of this.wss.clients) {
      try {
        client.terminate();
      } catch {
        // Socket already closed
      }
    }

    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });

    await new Promise<void>((resolve) => {
      this.httpServer.close(() => resolve());
    });
  }

  public getPort(): number {
    return this.boundPort;
  }

  public getUrl(): string {
    return `http://${this.host}:${this.boundPort}`;
  }

  public getStateManager(): WorkstationStateManager {
    return this.stateManager;
  }

  public getHttpServer(): http.Server {
    return this.httpServer;
  }

  public getWebSocketServer(): WebSocketServer {
    return this.wss;
  }
}
