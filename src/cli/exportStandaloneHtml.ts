#!/usr/bin/env node
/**
 * Gate M7.0 (Decision OD-20 / Charter DEC-020):
 * Standalone Offline Operator Workstation HTML Snapshot Generator
 *
 * Exports a completely self-contained, offline-runnable HTML5/SVG snapshot of the
 * 8-Workspace Governed Research & Trading Workstation directly from authoritative
 * backend state (WorkstationStateManager / OperatorTerminalController).
 *
 * Invariants Enforced:
 * 1. Zero external CDN dependencies (zero external fonts, zero third-party JS/CSS).
 * 2. Embedded tabs operate 100% offline via pure DOM tab-switching logic.
 * 3. Shows standalone offline mode banner linking to http://127.0.0.1:4310 when opened via file:///.
 * 4. RFC 8785 JCS SHA-256 cryptographic attestation embedded in snapshot banner.
 */

import fs from 'node:fs';
import path from 'node:path';
import { WorkstationStateManager } from '../server/workstationStateManager.js';
import { renderOperatorTerminalHtml } from '../terminal/operatorTerminalController.js';

export function exportStandaloneHtml(targetPath?: string): { filePath: string; byteLength: number; snapshotSha256: string } {
  const outputPath = targetPath || path.resolve(process.cwd(), 'dist', 'POC-001_Standalone_Workstation.html');
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const stateManager = new WorkstationStateManager();
  const snapshot = stateManager.getSnapshot();
  const html = renderOperatorTerminalHtml(snapshot);

  fs.writeFileSync(outputPath, html, 'utf8');
  const byteLength = Buffer.byteLength(html, 'utf8');

  console.log('================================================================================');
  console.log(' MARKET HFT OS — STANDALONE OFFLINE WORKSTATION EXPORT (Gate M7.0)');
  console.log('================================================================================');
  console.log(` Output File:     ${outputPath}`);
  console.log(` File Size:       ${byteLength.toLocaleString()} bytes`);
  console.log(` Snapshot SHA:    ${snapshot.snapshot_jcs_sha256}`);
  console.log(` Workspaces:      8 Fully Projected (All Workspaces tab + Individual tabs)`);
  console.log(` Offline Support: Pure DOM tab switching, SVG visualizations, BigInt AST UI`);
  console.log(` Direct Link:     file:///${outputPath.replace(/\\/g, '/')}`);
  console.log('================================================================================');

  return { filePath: outputPath, byteLength, snapshotSha256: snapshot.snapshot_jcs_sha256 };
}

// Auto-run when executed directly from CLI
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('exportStandaloneHtml.ts') ||
  process.argv[1].endsWith('exportStandaloneHtml.js')
);

if (isDirectRun) {
  try {
    const customPathArg = process.argv[2];
    exportStandaloneHtml(customPathArg);
  } catch (err) {
    console.error('[Standalone Workstation] Export failed:', err);
    process.exit(1);
  }
}
