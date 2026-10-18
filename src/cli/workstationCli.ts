#!/usr/bin/env node
/**
 * Gate M7.0 (Decision OD-20 / Charter DEC-020):
 * Local Loopback Workstation Server CLI Runner
 *
 * Launches the WorkstationServer bound strictly to the local loopback interface
 * (127.0.0.1:4310) with full DNS-rebinding protection, pure BigInt rational AST
 * What-If sandbox, and live WebSocket telemetry broadcasting.
 */

import { WorkstationServer } from '../server/workstationServer.js';

export async function runWorkstationCli(args: string[] = process.argv.slice(2)): Promise<WorkstationServer> {
  const portArgIndex = args.indexOf('--port');
  const port = portArgIndex !== -1 && args[portArgIndex + 1]
    ? parseInt(args[portArgIndex + 1], 10)
    : (process.env.PORT ? parseInt(process.env.PORT, 10) : 4310);

  const hostArgIndex = args.indexOf('--host');
  const host = hostArgIndex !== -1 && args[hostArgIndex + 1]
    ? args[hostArgIndex + 1]
    : (process.env.HOST || '127.0.0.1');

  const server = new WorkstationServer({ port, host });
  const { port: boundPort, url } = await server.start();

  console.log('================================================================================');
  console.log(' MARKET HFT OS — LOCAL LOOPBACK OPERATOR WORKSTATION (Gate M7.0 / DEC-020)');
  console.log('================================================================================');
  console.log(` Operating Mode:  DRY_RUN_PAPER_SIMULATION_ONLY (Real money execution disabled)`);
  console.log(` Loopback URL:    ${url}`);
  console.log(` WebSocket Feed:  ws://${host}:${boundPort}/ws`);
  console.log(` API Health:      ${url}/api/health`);
  console.log(` API Snapshot:    ${url}/api/snapshot`);
  console.log(` API Certificate: ${url}/api/certificate`);
  console.log(' Security Guard:  Host & Origin Firewalls Active (SRV-01)');
  console.log(' Arithmetic:      Pure BigInt Rational AST Evaluator on Backend (SRV-02)');
  console.log(' Kill Switch:     3-Tier Controller & Two-Level Error Presentation (SRV-03)');
  console.log('================================================================================');
  console.log(' Press Ctrl+C to terminate the local workstation server.');

  const shutdown = async () => {
    console.log('\n[Workstation] Shutting down loopback workstation server...');
    await server.stop();
    console.log('[Workstation] Server stopped cleanly.');
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return server;
}

// Auto-run when invoked directly from CLI
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('workstationCli.ts') ||
  process.argv[1].endsWith('workstationCli.js')
);

if (isDirectRun) {
  runWorkstationCli().catch((err) => {
    console.error('[Workstation] Fatal startup error:', err);
    process.exit(1);
  });
}
