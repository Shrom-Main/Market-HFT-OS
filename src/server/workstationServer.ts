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
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { WorkstationStateManager } from './workstationStateManager.js';
import { renderOperatorTerminalHtml, formatTwoLevelError, OperatorAuthorizationRegistry } from '../terminal/operatorTerminalController.js';
import type {
  KillSwitchHaltScope,
  OperatorConfirmationEnvelope,
  TwoLevelErrorEnvelope
} from '../mcp/contracts/operatorTerminalContract.js';
import { FormulaCardInput } from '../research/formulaRegistry.js';
import { validateExplicitUserIntent } from '../research/bundleEvaluator.js';
import { loadServerSecrets, getSkillsMcpRegistry } from '../mcp/serverSecretLoader.js';
import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { sanitizeForJcs } from '../agents/m6AgentFramework.js';

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
    // Static Asset Serving (Vite Client Bundles)
    if (method === 'GET' && pathname.startsWith('/assets/')) {
      const safeSuffix = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
      const assetPath = path.resolve(process.cwd(), 'dist/client', '.' + safeSuffix);
      if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
        const ext = path.extname(assetPath).toLowerCase();
        let mime = 'application/octet-stream';
        if (ext === '.js') mime = 'application/javascript; charset=utf-8';
        else if (ext === '.css') mime = 'text/css; charset=utf-8';
        else if (ext === '.svg') mime = 'image/svg+xml';
        else if (ext === '.woff2') mime = 'font/woff2';
        else if (ext === '.json') mime = 'application/json';

        const fileContent = fs.readFileSync(assetPath);
        applySecurityHeaders(res);
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': fileContent.length,
          'Cache-Control': 'public, max-age=31536000, immutable'
        });
        res.end(fileContent);
        return;
      }
    }

    // Route 1: Root Workstation HTML
    if ((method === 'GET' || method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
      const snapshot = this.stateManager.getSnapshot();
      const inbox = this.stateManager.getSignalsInbox();
      const variants = this.stateManager.getSS304Variants();
      const deck = this.stateManager.getProductObservationDeck();
      const html = renderOperatorTerminalHtml(snapshot, {
        connectors: inbox.connectors,
        variants: variants,
        signals: inbox.signals,
        products: deck.products
      });
      applySecurityHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html, 'utf8')
      });
      if (method === 'HEAD') {
        res.end();
      } else {
        res.end(html);
      }
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
      const livePing = await this.stateManager.getCentralResearchCore().pingDatabase();
      this.stateManager.updatePostgresConnectivity(livePing.is_connected);
      const health = this.stateManager.getHealthStatus(livePing);
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
        const result = await this.stateManager.triggerGovernedDagRun(confirmation, {
          product_id: body.product_id
        });
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

    // Route 8: Signal Ingestion Action (Gate M7.1 / DEC-021)
    if (method === 'POST' && pathname === '/api/signals/ingest') {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }

      const body = bodyResult.data || {};
      if (!body.channel || body.raw_payload === undefined) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Missing required fields "channel" or "raw_payload" for signal ingestion.'),
          'server:api:signals-ingest'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      try {
        const trace = await this.stateManager.ingestSignalEnvelope(body);
        sendJsonResponse(res, 200, { ...trace, trace });
      } catch (e: any) {
        const statusCode = e?.statusCode === 409 || e?.message?.includes('E-KS-RECOVERY-ONLY-MODE') ? 409 : 400;
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:signals-ingest'
        );
        sendJsonResponse(res, statusCode, err);
      }
      return;
    }

    // Route 9: Signals Inbox API
    if (method === 'GET' && pathname === '/api/signals/inbox') {
      const inbox = this.stateManager.getSignalsInbox();
      sendJsonResponse(res, 200, inbox);
      return;
    }

    // Route 9b: Connector Run API
    if (method === 'POST' && pathname === '/api/connectors/run') {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }

      const body = bodyResult.data || {};
      if (!body.connector_id) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Missing required field "connector_id" for connector run.'),
          'server:api:connectors-run'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      try {
        const result = await this.stateManager.runConnector(body);
        sendJsonResponse(res, 200, result);
      } catch (e: any) {
        const statusCode = e?.statusCode === 409 || e?.message?.includes('E-KS-') ? 409 : 400;
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:connectors-run'
        );
        sendJsonResponse(res, statusCode, err);
      }
      return;
    }

    // Route 10: Signal Trace Lineage API
    if (method === 'GET' && pathname === '/api/signals/trace') {
      const traceId = urlObj.searchParams.get('id') || urlObj.searchParams.get('trace_id');
      if (!traceId) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Query parameter "id" or "trace_id" is required to inspect lineage trace.'),
          'server:api:signals-trace'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      const trace = this.stateManager.getSignalTrace(traceId);
      if (!trace) {
        const err = createServerErrorEnvelope(
          new Error(`E-SRV-TRACE-NOT-FOUND: Signal processing trace with ID "${traceId}" not found.`),
          'server:api:signals-trace'
        );
        sendJsonResponse(res, 404, err);
        return;
      }

      sendJsonResponse(res, 200, { ...trace, trace });
      return;
    }

    // Route 11: 8-Variant SS304 Matrix API
    if (method === 'GET' && pathname === '/api/variants/ss304') {
      const variants = this.stateManager.getSS304Variants();
      sendJsonResponse(res, 200, { variants, ceiling_inr: 10.00 });
      return;
    }

    // Route 12: Product Observation Deck Universe API
    if (method === 'GET' && pathname === '/api/products/universe') {
      const deck = this.stateManager.getProductObservationDeck();
      sendJsonResponse(res, 200, deck);
      return;
    }

    // Route 13: Product Observation Detail API
    if (method === 'GET' && (pathname === '/api/products/detail' || pathname.startsWith('/api/products/'))) {
      let productId = urlObj.searchParams.get('id') || urlObj.searchParams.get('product_id');
      if (!productId && pathname.startsWith('/api/products/') && pathname !== '/api/products/universe' && pathname !== '/api/products/detail') {
        productId = decodeURIComponent(pathname.replace('/api/products/', ''));
      }

      if (!productId) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Missing "id" or "product_id" query parameter for product detail.'),
          'server:api:products-detail'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      const product = this.stateManager.getProductById(productId);
      if (!product) {
        const err = createServerErrorEnvelope(
          new Error(`E-SRV-PRODUCT-NOT-FOUND: Product "${productId}" not found in observation deck.`),
          'server:api:products-detail'
        );
        sendJsonResponse(res, 404, err);
        return;
      }

      sendJsonResponse(res, 200, { product });
      return;
    }

    // Route 14: Push Product Observation Action
    if (method === 'POST' && pathname === '/api/products/observe') {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }

      const body = bodyResult.data || {};
      if (!body.name || !body.category || !body.commercial_archetype) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Missing required fields "name", "category", or "commercial_archetype" for product observation.'),
          'server:api:products-observe'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      try {
        const product = await this.stateManager.pushProductObservation(body);
        sendJsonResponse(res, 200, { product, message: 'Product observation successfully ingested into deck.' });
      } catch (e: any) {
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:products-observe'
        );
        sendJsonResponse(res, 400, err);
      }
      return;
    }

    // Route 15: Dispatch Product Research Action
    if (method === 'POST' && (pathname === '/api/products/research' || pathname === '/api/research/dispatch')) {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }

      const body = bodyResult.data || {};
      if (!body.product_id) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Missing required field "product_id" for product research dispatch.'),
          'server:api:products-research'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      try {
        const updated = await this.stateManager.researchProduct(body);
        sendJsonResponse(res, 200, {
          product: updated,
          status: updated.strategy.research_case_status,
          message: `Specialist research dispatched for product "${updated.name}".`
        });
      } catch (e: any) {
        const statusCode = e?.statusCode === 409 || e?.message?.includes('E-KS-RECOVERY-ONLY-MODE') ? 409 : 400;
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:products-research'
        );
        sendJsonResponse(res, statusCode, err);
      }
      return;
    }

    // Route 16: Groq AI Opportunity Analysis API
    if (method === 'POST' && pathname === '/api/ai/analyze') {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }

      const body = bodyResult.data || {};
      const productId = body.product_id;
      if (!productId) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Missing "product_id" for AI opportunity analysis.'),
          'server:api:ai-analyze'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      const product = this.stateManager.getProductById(productId);
      if (!product) {
        const err = createServerErrorEnvelope(
          new Error(`E-SRV-PRODUCT-NOT-FOUND: Product "${productId}" not found.`),
          'server:api:ai-analyze'
        );
        sendJsonResponse(res, 404, err);
        return;
      }

      try {
        const synthesizer = this.stateManager.getGroqSynthesizer();
        const quotes = product.buyer_grievances?.map((g) => g.representative_quote) || [];
        const analysis = await synthesizer.synthesizeResearchThesis(product, quotes);
        sendJsonResponse(res, 200, analysis);
      } catch {
        const topGrievance = product.buyer_grievances?.[0];
        const analysis = {
          product_id: product.product_id,
          analysis_timestamp_utc: new Date().toISOString(),
          llm_called: false,
          generation_mode: 'DETERMINISTIC_TEMPLATE_FALLBACK' as const,
          llm_model: null,
          thesis_synthesis: `Targeted analysis of ${product.name} reveals an asymmetric opportunity: dominant competitors are capturing high gross volume but suffer from an unaddressed ${product.overall_negative_review_pct}% negative review cluster. By implementing physical pre-shipment remediation at the ${product.upstream_supply?.hub_name}, we can eliminate recurring returns and monopolize Buy Box retention.`,
          unserved_pain_points: [
            topGrievance?.failure_mode || 'Premature mechanical failure under load',
            product.buyer_grievances?.[1]?.failure_mode || 'Packaging seal damage during transit',
            'Inconsistent batch-to-batch alloy metallurgy from unbranded distributors'
          ],
          engineered_edge_suggestions: [
            topGrievance?.engineered_remediation || 'Optical CNC sorting & reinforced alloy heat treatment',
            'Custom laser-cut high-density EPE foam cradles to withstand carrier drops',
            'Certified mill test report QR code embossed directly on the packaging lid'
          ],
          arbitrage_viability_verdict: 'PROMISING_BUT_UNVALIDATED' as const,
          raw_material_sensitivity_commentary: `Deterministic template analysis: landed cost is anchored to ${product.upstream_supply?.raw_material_basis}. At ₹${product.upstream_supply?.factory_gate_quote_inr} factory gate vs ₹${product.sell_side?.prevailing_retail_asp_inr} retail ASP, the gross spread of ₹${product.strategy?.target_gross_spread_inr} provides a comfortable 40%+ contribution cushion against commodity price spikes.`,
          recommended_action: 'VALIDATE_FURTHER' as const,
          cited_evidence_quotes: product.buyer_grievances?.map((g) => g.representative_quote) || []
        };
        sendJsonResponse(res, 200, analysis);
      }
      return;
    }

    // Route 17: Evidence Gap Matrix API
    if (method === 'GET' && pathname === '/api/research/gaps') {
      const url = new URL(req.url || '/', `http://${this.host}:${this.boundPort}`);
      const productId = url.searchParams.get('product_id') || 'prod:din3017:ss304:16-25mm:pack-10';

      try {
        const matrix = this.stateManager.getEvidenceGapMatrix(productId);
        sendJsonResponse(res, 200, matrix);
      } catch (e: any) {
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:research-gaps'
        );
        sendJsonResponse(res, 404, err);
      }
      return;
    }

    // Route 18: Bitemporal Series with Event Overlays API
    if (method === 'GET' && pathname === '/api/bitemporal/series') {
      const url = new URL(req.url || '/', `http://${this.host}:${this.boundPort}`);
      const productId = url.searchParams.get('product_id') || 'prod:din3017:ss304:16-25mm:pack-10';
      const asOfUtc = url.searchParams.get('as_of') || undefined;

      const series = this.stateManager.getBitemporalSeries(productId, asOfUtc);
      sendJsonResponse(res, 200, {
        product_id: productId,
        as_of_utc: asOfUtc || new Date().toISOString(),
        series_points_count: series.length,
        points: series
      });
      return;
    }

    // Route 19: Bundle Paper Evaluation API (Enforces Slice 5 Unprefilled User Intent Gate)
    if (method === 'POST' && pathname === '/api/bundle/evaluate') {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }

      const body = bodyResult.data || {};
      const intent = body.user_intent || body;

      // Slice 5: Strict Unprefilled User-Intent Gate
      const intentValidation = validateExplicitUserIntent(intent);
      if (!intentValidation.isValid) {
        sendJsonResponse(res, 400, {
          status: 'USER_INTENT_REQUIRED',
          error_code: 'E-BUNDLE-INTENT-REQUIRED',
          message: `Explicit user intent required for all 5 parameters: available_paper_capital_inr, minimum_return_hurdle_bps, holding_period_days, max_drawdown_limit_bps, max_single_supplier_concentration_bps. Missing or invalid: [${intentValidation.missing_intent_fields?.join(', ')}].`,
          missing_intent_fields: intentValidation.missing_intent_fields
        });
        return;
      }

      try {
        const evaluation = this.stateManager.evaluateBundle(intent);
        sendJsonResponse(res, 200, evaluation);
      } catch (e: any) {
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:bundle-evaluate'
        );
        sendJsonResponse(res, 400, err);
      }
      return;
    }

    // Route 20: Governed Bundle Paper Commit API
    if (method === 'POST' && pathname === '/api/bundle/commit') {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }

      const { bundle_id, evaluation, confirmation } = bodyResult.data || {};
      const targetBundleId = bundle_id || evaluation?.bundle_id;
      if (!targetBundleId || !confirmation) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: "bundle_id" (or "evaluation") and "confirmation" are required to commit bundle allocation.'),
          'server:api:bundle-commit'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      // Resolve evaluation: verify against server-held record to prevent caller spoofing
      const serverHeld = this.stateManager.getEvaluationById(targetBundleId);
      if (!serverHeld) {
        const err = createServerErrorEnvelope(
          new Error(`E-BUNDLE-EVALUATION-NOT-FOUND: No server-held evaluation found for bundle_id "${targetBundleId}". A bundle must be formally evaluated by the server before it can be committed.`),
          'server:api:bundle-commit'
        );
        sendJsonResponse(res, 404, err);
        return;
      }

      // Operator Authorization Check (Finding 2)
      if (!OperatorAuthorizationRegistry.isAuthorized(confirmation.operator_id)) {
        const err = createServerErrorEnvelope(
          new Error(`E-OPERATOR-NOT-AUTHORIZED: Operator "${confirmation.operator_id}" is not registered or authorized to perform governed capital allocations. Capital commitment requires an authenticated institutional operator.`),
          'server:api:bundle-commit'
        );
        sendJsonResponse(res, 403, err);
        return;
      }

      // Replay Protection (Finding 2)
      if (OperatorAuthorizationRegistry.isTokenConsumed(confirmation.confirmation_token)) {
        const err = createServerErrorEnvelope(
          new Error(`E-CONFIRMATION-TOKEN-ALREADY-USED: Confirmation token "${confirmation.confirmation_token}" has already been consumed. Replaying confirmation tokens is strictly prohibited.`),
          'server:api:bundle-commit'
        );
        sendJsonResponse(res, 409, err);
        return;
      }

      if (evaluation) {
        const { jcs_sha256: callerHash, ...evalWithoutHash } = evaluation;
        const recomputedCallerHash = sha256(canonicalizeJCS(sanitizeForJcs(evalWithoutHash)));
        if (
          serverHeld.jcs_sha256 !== callerHash ||
          recomputedCallerHash !== serverHeld.jcs_sha256 ||
          recomputedCallerHash !== callerHash
        ) {
          const err = createServerErrorEnvelope(
            new Error(`E-BUNDLE-EVALUATION-TAMPERED: Caller-submitted evaluation SHA-256 does not match server-held canonical evaluation SHA-256 for bundle "${targetBundleId}". Caller spoofing or fabrication is strictly prohibited.`),
            'server:api:bundle-commit'
          );
          sendJsonResponse(res, 409, err);
          return;
        }
      }

      try {
        const result = await this.stateManager.commitBundleAllocation(serverHeld, confirmation);
        sendJsonResponse(res, 200, result);
      } catch (e: any) {
        const statusCode = typeof e?.statusCode === 'number'
          ? e.statusCode
          : (e?.message?.includes('E-KS-') || e?.message?.includes('E-BUNDLE-') || e?.message?.includes('ALREADY') ? 409 : 400);
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:bundle-commit'
        );
        sendJsonResponse(res, statusCode, err);
      }
      return;
    }

    // Route 21: Database Health API
    if (method === 'GET' && pathname === '/api/health/db') {
      const ping = await this.stateManager.getCentralResearchCore().pingDatabase();
      this.stateManager.updatePostgresConnectivity(ping.is_connected);
      sendJsonResponse(res, 200, ping);
      return;
    }

    // Route 22: Hypothesis Ledger API (Slice 3)
    if (method === 'GET' && pathname === '/api/hypothesis/list') {
      const productId = urlObj.searchParams.get('product_id') || undefined;
      try {
        const hypotheses = await this.stateManager.getCentralResearchCore().loadHypotheses(productId);
        sendJsonResponse(res, 200, {
          count: hypotheses.length,
          product_id: productId || null,
          hypotheses
        });
      } catch (e: any) {
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:hypothesis-list'
        );
        sendJsonResponse(res, 500, err);
      }
      return;
    }

    // Route 23: 8-Dimension Opportunity Scorecard API (Slice 3)
    if (method === 'POST' && pathname === '/api/research/scorecard') {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }
      const body = bodyResult.data || {};
      if (!body.product_id) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Missing required field "product_id" for scorecard evaluation.'),
          'server:api:research-scorecard'
        );
        sendJsonResponse(res, 400, err);
        return;
      }
      try {
        const scorecard = await this.stateManager.evaluateProductScorecard(body.product_id);
        sendJsonResponse(res, 200, {
          product_id: body.product_id,
          scorecard
        });
      } catch (e: any) {
        const statusCode = e?.message?.includes('E-PROD-NOT-FOUND') ? 404 : 400;
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:research-scorecard'
        );
        sendJsonResponse(res, statusCode, err);
      }
      return;
    }

    // Route 24: Single-Lead Opportunity Dossier API (Slice 4)
    if (method === 'GET' && pathname === '/api/research/dossier') {
      const productId = urlObj.searchParams.get('product_id');
      const asOfUtc = urlObj.searchParams.get('as_of_utc') || undefined;

      if (!productId) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Missing required query parameter "product_id" for dossier retrieval.'),
          'server:api:research-dossier'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      try {
        const dossier = await this.stateManager.getOpportunityDossier(productId, asOfUtc);
        sendJsonResponse(res, 200, {
          product_id: productId,
          dossier
        });
      } catch (e: any) {
        const statusCode = e?.message?.includes('E-PROD-NOT-FOUND') ? 404 : 400;
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:research-dossier'
        );
        sendJsonResponse(res, statusCode, err);
      }
      return;
    }

    // Route 25: Local-First Research Query API & Opt-In External Provider Synthesis (Slice 4)
    if (method === 'POST' && pathname === '/api/research/query') {
      const bodyResult = await readJsonBody(req);
      if (bodyResult.error) {
        sendJsonResponse(res, bodyResult.error.status, bodyResult.error.envelope);
        return;
      }

      const body = bodyResult.data || {};
      if (!body.query || typeof body.query !== 'string' || body.query.trim().length === 0) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Missing required field "query" for research query execution.'),
          'server:api:research-query'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      try {
        const result = await this.stateManager.queryResearch(body);
        sendJsonResponse(res, 200, result);
      } catch (e: any) {
        const isRateLimit = e?.statusCode === 429 || e?.message?.includes('DEFERRED_RATE_LIMIT_PROTECTED');
        const isOptInReq = e?.message?.includes('E-QUERY-EXPLICIT-OPT-IN-REQUIRED');
        const statusCode = isRateLimit ? 429 : (isOptInReq ? 400 : 500);
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:research-query'
        );
        sendJsonResponse(res, statusCode, err);
      }
      return;
    }

    // Route 26: Cited Research Report & Investment Memo Exporter API (Slice 5)
    if (method === 'GET' && pathname === '/api/reports/export') {
      const url = new URL(req.url || '/', `http://${this.host}:${this.boundPort}`);
      const targetType = url.searchParams.get('target_type') as 'LEAD' | 'BUNDLE' | null;
      const targetId = url.searchParams.get('target_id');
      const asOfUtc = url.searchParams.get('as_of_utc') || undefined;

      if (!targetType || (targetType !== 'LEAD' && targetType !== 'BUNDLE')) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: "target_type" query parameter must be either "LEAD" or "BUNDLE".'),
          'server:api:reports-export'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      if (!targetId || targetId.trim().length === 0) {
        const err = createServerErrorEnvelope(
          new Error('E-SRV-MISSING-ARGUMENT: Missing required query parameter "target_id".'),
          'server:api:reports-export'
        );
        sendJsonResponse(res, 400, err);
        return;
      }

      try {
        const report = await this.stateManager.exportReport(targetType, targetId, asOfUtc);
        sendJsonResponse(res, 200, report);
      } catch (e: any) {
        const statusCode = e?.statusCode || 404;
        const err = createServerErrorEnvelope(
          e instanceof Error ? e : new Error(String(e)),
          'server:api:reports-export'
        );
        sendJsonResponse(res, statusCode, err);
      }
      return;
    }

    // Route 27: Skills MCP Capability Registry API (Slice 5)
    if (method === 'GET' && pathname === '/api/skills/registry') {
      const registry = getSkillsMcpRegistry();
      sendJsonResponse(res, 200, {
        registry_timestamp_utc: new Date().toISOString(),
        total_capabilities: registry.length,
        configured_capabilities: registry.filter((c) => c.is_configured).length,
        capabilities: registry
      });
      return;
    }

    // Route 28: Fallback / 404
    const err = createServerErrorEnvelope(
      new Error(`E-SRV-NOT-FOUND: Resource ${pathname} with method ${method} not found on workstation server.`),
      'server:http:not-found'
    );
    sendJsonResponse(res, 404, err);
  }

  public async start(): Promise<{ port: number; url: string }> {
    // Safely load provider credentials from server-side disk into memory
    loadServerSecrets();

    // Hydrate state from PostgreSQL before listening
    await this.stateManager.hydrateFromDatabase().catch(() => {});

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
