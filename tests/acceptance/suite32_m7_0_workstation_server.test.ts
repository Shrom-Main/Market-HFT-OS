/**
 * Gate M7.0 (Decision OD-20 / Charter DEC-020):
 * Suite 32: Runnable Local Loopback Workstation Server, Authoritative State Manager,
 * Interactive 8-Workspace Client & Zero-Trust Security Acceptance Suite
 *
 * Verifies all 10 normative workstation runtime specifications:
 * 1.  MCP-WRK-NON-LOOPBACK-BIND-REJECT-001: Strict loopback confinement (127.0.0.1 / localhost only)
 * 2.  MCP-WRK-DNS-REBINDING-HOST-FIREWALL-002: Host header DNS-rebinding rejection (HTTP 403 / E-SRV-INVALID-HOST-HEADER)
 * 3.  MCP-WRK-CSWSH-ORIGIN-FIREWALL-003: Cross-site POST & WebSocket upgrade rejection (HTTP 403 / E-SRV-CROSS-ORIGIN-BLOCKED)
 * 4.  MCP-WRK-REQUEST-BODY-CAP-004: 64 KB request envelope cap rejection (HTTP 413 / E-SRV-REQUEST-BODY-TOO-LARGE)
 * 5.  MCP-WRK-SECURITY-HEADERS-ENFORCED-005: Strict security headers on all HTTP responses (CSP, XFO, nosniff, no-store)
 * 6.  MCP-WRK-READ-ONLY-PROJECTION-ROOT-006: Self-contained HTML5/SVG terminal rendering with all 8 workspaces
 * 7.  MCP-WRK-READ-ONLY-API-ENDPOINTS-007: Frozen snapshot, health, and 12-point platform readiness certificate APIs
 * 8.  MCP-WRK-KILL-SWITCH-GOVERNED-ACTION-008: 3-tier kill-switch transition requiring >= 15-char rationale
 * 9.  MCP-WRK-KILL-SWITCH-DAG-HALT-ENFORCEMENT-009: DAG execution fail-closed (HTTP 409) under halt scopes (SRV-03)
 * 10. MCP-WRK-WEBSOCKET-LIVE-BROADCAST-010: Live WebSocket broadcast of snapshot transitions (TERMINAL_SNAPSHOT_BROADCAST)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import { KillSwitchHaltScope } from '../../src/mcp/contracts/operatorTerminalContract.js';

function httpRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json?: any }> {
  return new Promise((resolve, reject) => {
    const defaultHeaders: Record<string, string> = {
      Host: `127.0.0.1:${options.port}`,
      ...options.headers
    };

    if (options.body && !defaultHeaders['Content-Length'] && !defaultHeaders['content-length']) {
      defaultHeaders['Content-Length'] = String(Buffer.byteLength(options.body, 'utf8'));
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method || 'GET',
        headers: defaultHeaders
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json: any;
          try {
            json = JSON.parse(raw);
          } catch {
            // non-json response (e.g. html)
          }
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: raw,
            json
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

describe('Suite 32: Gate M7.0 Local Loopback Workstation Server & Security Governance', () => {
  let server: WorkstationServer;
  let serverPort: number;

  beforeAll(async () => {
    // SRV-04: Ephemeral loopback port assignment for test isolation
    server = new WorkstationServer({ port: 0 });
    const started = await server.start();
    serverPort = started.port;
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 1: STRICT LOOPBACK CONFINEMENT
  // ---------------------------------------------------------------------------
  it('MCP-WRK-NON-LOOPBACK-BIND-REJECT-001: Confines network binding strictly to loopback interface and rejects non-loopback addresses', () => {
    expect(() => new WorkstationServer({ host: '0.0.0.0' })).toThrow(/E-SRV-NON-LOOPBACK-BIND-FORBIDDEN/);
    expect(() => new WorkstationServer({ host: '192.168.1.50' })).toThrow(/E-SRV-NON-LOOPBACK-BIND-FORBIDDEN/);
    expect(() => new WorkstationServer({ host: '10.0.0.1' })).toThrow(/E-SRV-NON-LOOPBACK-BIND-FORBIDDEN/);

    // Permitted loopback bindings
    expect(() => new WorkstationServer({ host: '127.0.0.1', port: 0 })).not.toThrow();
    expect(() => new WorkstationServer({ host: 'localhost', port: 0 })).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // TEST 2: DNS-REBINDING HOST HEADER FIREWALL (SRV-01)
  // ---------------------------------------------------------------------------
  it('MCP-WRK-DNS-REBINDING-HOST-FIREWALL-002: Rejects non-loopback Host headers with HTTP 403 Forbidden and E-SRV-INVALID-HOST-HEADER', async () => {
    const res = await httpRequest({
      port: serverPort,
      path: '/api/health',
      headers: {
        Host: 'attacker.evil.corp:4310'
      }
    });

    expect(res.statusCode).toBe(403);
    expect(res.json).toBeDefined();
    expect(res.json.error.error_id).toContain('E-SRV-INVALID-HOST-HEADER');
    expect(res.json.error.operator_summary).toContain('Host header');
  });

  // ---------------------------------------------------------------------------
  // TEST 3: CSWSH & CORS ORIGIN HEADER FIREWALL (SRV-01)
  // ---------------------------------------------------------------------------
  it('MCP-WRK-CSWSH-ORIGIN-FIREWALL-003: Rejects cross-origin state-mutating POST requests and unauthorized WebSocket upgrades with HTTP 403', async () => {
    // 1. Cross-Origin POST rejection
    const postRes = await httpRequest({
      port: serverPort,
      path: '/api/actions/kill-switch',
      method: 'POST',
      headers: {
        Origin: 'https://malicious-tracker.xyz',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        target_scope: 'HALT_NEW_ALLOCATIONS',
        rationale: 'Malicious attempt to alter system state'
      })
    });

    expect(postRes.statusCode).toBe(403);
    expect(postRes.json.error.error_id).toContain('E-SRV-CROSS-ORIGIN-BLOCKED');

    // 2. Cross-Origin WebSocket Upgrade rejection
    const wsRejected = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`, {
        headers: {
          Origin: 'https://malicious-tracker.xyz'
        }
      });

      ws.on('unexpected-response', (_req, incoming) => {
        resolve(incoming.statusCode === 403);
      });

      ws.on('error', () => {
        resolve(true);
      });

      ws.on('open', () => {
        ws.close();
        resolve(false);
      });
    });

    expect(wsRejected).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // TEST 4: REQUEST BODY ENVELOPE CAP (SRV-01)
  // ---------------------------------------------------------------------------
  it('MCP-WRK-REQUEST-BODY-CAP-004: Rejects oversized request payloads exceeding 65,536 bytes with HTTP 413 Payload Too Large', async () => {
    const oversizedPadding = 'X'.repeat(70000);
    const res = await httpRequest({
      port: serverPort,
      path: '/api/actions/what-if-formula',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        formula_id: 'F01_ESTIMATED_NET_PAYOUT',
        padding: oversizedPadding
      })
    });

    expect(res.statusCode).toBe(413);
    expect(res.json.error.error_id).toContain('E-SRV-REQUEST-BODY-TOO-LARGE');
  });

  // ---------------------------------------------------------------------------
  // TEST 5: SECURITY HEADERS ENFORCED (SRV-01)
  // ---------------------------------------------------------------------------
  it('MCP-WRK-SECURITY-HEADERS-ENFORCED-005: Enforces CSP, X-Frame-Options, X-Content-Type-Options, and Cache-Control headers on responses', async () => {
    const res = await httpRequest({
      port: serverPort,
      path: '/api/health'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'self' 'unsafe-inline'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  // ---------------------------------------------------------------------------
  // TEST 6: READ-ONLY HTML5/SVG WORKSTATION RENDER (POC.docx §10.5)
  // ---------------------------------------------------------------------------
  it('MCP-WRK-READ-ONLY-PROJECTION-ROOT-006: Serves self-contained HTML5/SVG workstation with all 8 workspaces, navigation tabs, action bar, and modal', async () => {
    const res = await httpRequest({
      port: serverPort,
      path: '/'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');

    const html = res.body;

    // Banner & mode check
    expect(html).toContain('OPERATING MODE: <strong>DRY_RUN_PAPER_SIMULATION_ONLY</strong>');
    expect(html).toContain('REAL-MONEY EXECUTION: <strong>DISABLED</strong>');

    // All 8 workspaces present
    expect(html).toContain('id="workspace-command-center"');
    expect(html).toContain('id="workspace-opportunity-radar"');
    expect(html).toContain('id="workspace-evidence-workbench"');
    expect(html).toContain('id="workspace-economics-lab"');
    expect(html).toContain('id="workspace-capital-allocator"');
    expect(html).toContain('id="workspace-simulation-and-positions"');
    expect(html).toContain('id="workspace-reconciliation-and-performance"');
    expect(html).toContain('id="workspace-risk-audit-and-system-health"');

    // Interactive controls & navigation
    expect(html).toContain('class="nav-bar"');
    expect(html).toContain('class="action-bar"');
    expect(html).toContain('id="btn-run-dag"');
    expect(html).toContain('id="btn-ks-halt-allocations"');
    expect(html).toContain('id="action-modal"');
    expect(html).toContain('id="what-if-form"');
    expect(html).toContain('<script>');
  });

  // ---------------------------------------------------------------------------
  // TEST 7: READ-ONLY AUTHORITATIVE API ENDPOINTS
  // ---------------------------------------------------------------------------
  it('MCP-WRK-READ-ONLY-API-ENDPOINTS-007: Exposes authoritative snapshot, health, and 12-point release gate certificate endpoints', async () => {
    // 1. Snapshot API
    const snapRes = await httpRequest({
      port: serverPort,
      path: '/api/snapshot'
    });
    expect(snapRes.statusCode).toBe(200);
    expect(snapRes.json.snapshot).toBeDefined();
    expect(snapRes.json.snapshot.operating_mode).toBe('DRY_RUN_PAPER_SIMULATION_ONLY');
    expect(snapRes.json.snapshot.real_money_execution_enabled).toBe(false);
    expect(snapRes.json.snapshot.snapshot_jcs_sha256).toHaveLength(64);

    // 2. Health API
    const healthRes = await httpRequest({
      port: serverPort,
      path: '/api/health'
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json.status).toBe('HEALTHY');
    expect(healthRes.json.postgres_connected).toBe(true);
    expect(healthRes.json.kill_switch_scope).toBe('NORMAL_PAPER_OPERATION');

    // 3. Certificate API
    const certRes = await httpRequest({
      port: serverPort,
      path: '/api/certificate'
    });
    expect(certRes.statusCode).toBe(200);
    expect(certRes.json.certificate).toBeDefined();
    expect(certRes.json.certificate.all_twelve_passed).toBe(true);
    expect(certRes.json.certificate.criteria).toHaveLength(12);
    expect(certRes.json.certificate.certificate_jcs_sha256).toHaveLength(64);
  });

  // ---------------------------------------------------------------------------
  // TEST 8: 3-TIER KILL-SWITCH GOVERNED ACTION (POC.docx §8)
  // ---------------------------------------------------------------------------
  it('MCP-WRK-KILL-SWITCH-GOVERNED-ACTION-008: Enforces minimum 15-character operator rationale on kill-switch transitions and updates state', async () => {
    // 1. Rationale < 15 chars rejected
    const badRes = await httpRequest({
      port: serverPort,
      path: '/api/actions/kill-switch',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_scope: 'HALT_NEW_ALLOCATIONS',
        rationale: 'short'
      })
    });
    expect(badRes.statusCode).toBe(400);
    expect(badRes.json.error.error_id).toContain('E-M8-RATIONALE-INSUFFICIENT');

    // 2. Valid transition to HALT_NEW_ALLOCATIONS
    const goodRes = await httpRequest({
      port: serverPort,
      path: '/api/actions/kill-switch',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_scope: 'HALT_NEW_ALLOCATIONS',
        rationale: 'Authorized routine risk threshold test transition'
      })
    });
    expect(goodRes.statusCode).toBe(200);
    expect(goodRes.json.outcome.new_scope).toBe('HALT_NEW_ALLOCATIONS');

    // Verify snapshot reflects change
    const checkSnap = await httpRequest({ port: serverPort, path: '/api/snapshot' });
    expect(checkSnap.json.snapshot.workspaces.command_center.active_kill_switch_scope).toBe('HALT_NEW_ALLOCATIONS');

    // 3. Reset back to NORMAL_PAPER_OPERATION
    const resetRes = await httpRequest({
      port: serverPort,
      path: '/api/actions/kill-switch',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_scope: 'NORMAL_PAPER_OPERATION',
        rationale: 'Restoring normal paper operation after test verification'
      })
    });
    expect(resetRes.statusCode).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // TEST 9: KILL-SWITCH FAIL-CLOSED ENFORCEMENT ON DAG RUNS (SRV-03)
  // ---------------------------------------------------------------------------
  it('MCP-WRK-KILL-SWITCH-DAG-HALT-ENFORCEMENT-009: Blocks DAG execution with HTTP 409 Conflict under halt scopes while read-only APIs remain available', async () => {
    // 1. Transition to HALT_ALL_SIMULATION_PROCESSING
    await httpRequest({
      port: serverPort,
      path: '/api/actions/kill-switch',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_scope: 'HALT_ALL_SIMULATION_PROCESSING',
        rationale: 'Emergency halt of all simulation processing for invariant check'
      })
    });

    // 2. Attempt DAG Run -> Fails closed with 409 Conflict
    const haltRunRes = await httpRequest({
      port: serverPort,
      path: '/api/actions/run-dag',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rationale: 'Operator attempting DAG run during full simulation halt'
      })
    });
    expect(haltRunRes.statusCode).toBe(409);
    expect(haltRunRes.json.error.error_id).toContain('E-M8-KILLSWITCH-ALL-SIMULATION-HALTED');

    // 3. Read-only endpoints remain 100% available and responsive under halt
    const snapRes = await httpRequest({ port: serverPort, path: '/api/snapshot' });
    expect(snapRes.statusCode).toBe(200);

    const healthRes = await httpRequest({ port: serverPort, path: '/api/health' });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json.status).toBe('HALTED');

    // 4. Reset kill switch to NORMAL_PAPER_OPERATION
    await httpRequest({
      port: serverPort,
      path: '/api/actions/kill-switch',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_scope: 'NORMAL_PAPER_OPERATION',
        rationale: 'Restoring normal paper operations following audit test'
      })
    });

    // 5. Successful DAG execution in normal mode
    const dagRes = await httpRequest({
      port: serverPort,
      path: '/api/actions/run-dag',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rationale: 'Authorized post-halt governed DAG verification execution'
      })
    });
    expect(dagRes.statusCode).toBe(200);
    expect(dagRes.json.outcome.waves_executed).toBeGreaterThanOrEqual(1);
    expect(dagRes.json.outcome.checkpoint_sha256).toHaveLength(64);
  });

  // ---------------------------------------------------------------------------
  // TEST 10: WEBSOCKET LIVE TELEMETRY BROADCAST
  // ---------------------------------------------------------------------------
  it('MCP-WRK-WEBSOCKET-LIVE-BROADCAST-010: Broadcasts snapshot telemetry updates over WebSocket on state transitions', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
    const receivedMessages: any[] = [];

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString('utf8'));
        receivedMessages.push(parsed);
      } catch {
        // ignore non-json
      }
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        resolve();
      });
      ws.on('error', reject);
    });

    // Wait for initial broadcast
    await new Promise((r) => setTimeout(r, 100));
    expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
    expect(receivedMessages[0].type).toBe('TERMINAL_SNAPSHOT_BROADCAST');
    expect(receivedMessages[0].event).toBe('SNAPSHOT_INITIAL');

    // Mutate state via kill switch
    await httpRequest({
      port: serverPort,
      path: '/api/actions/kill-switch',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_scope: 'HALT_NEW_ALLOCATIONS',
        rationale: 'Live WebSocket broadcast telemetry verification'
      })
    });

    // Wait for broadcast
    await new Promise((r) => setTimeout(r, 150));

    const killSwitchBroadcast = receivedMessages.find(
      (m) => m.event === 'KILL_SWITCH_CHANGED'
    );
    expect(killSwitchBroadcast).toBeDefined();
    expect(killSwitchBroadcast.snapshot.workspaces.command_center.active_kill_switch_scope).toBe('HALT_NEW_ALLOCATIONS');

    // Clean up: reset kill switch and close websocket
    await httpRequest({
      port: serverPort,
      path: '/api/actions/kill-switch',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_scope: 'NORMAL_PAPER_OPERATION',
        rationale: 'Restoring normal paper operation after WebSocket broadcast test'
      })
    });

    ws.close();
  });
});
