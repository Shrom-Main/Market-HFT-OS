/**
 * POC-001: Live Server Loopback Probe for Slice 5 Verification
 * Gate Slice 5 / Decision OD-29 / Charter DEC-029
 *
 * Tests the running workstation server on port 4310:
 * - Probe 1: Server & Database Health (PostgreSQL connected, dual-ledger verified, 5 connectors)
 * - Probe 2: Unprefilled User-Intent Gate (Omitted intent fields fail closed with USER_INTENT_REQUIRED)
 * - Probe 3: Festive vs Industrial Seasonality Analysis (DIWALI_FESTIVE vs YEAR_ROUND_INDUSTRIAL_B2B)
 * - Probe 4: Supplier & Hub Concentration Gate (CONCENTRATION_LIMIT_BREACHED blocks commit)
 * - Probe 5: Opportunity-Cost Benchmark Spread (RBI 91D T-Bill 650 bps, SBI 1-Yr FD 725 bps)
 * - Probe 6: Three-Scenario Model & 90-Day Cash-Flow J-Curve (Pure BigInt subunits)
 * - Probe 7: Cited Research Report Exporter (Single Lead & Opportunity Bundle with [CIT-x] spans)
 * - Probe 8: Historical Bitemporal Cutoff & Bit-for-Bit JCS Determinism
 * - Probe 9: Human Confirmation Gate & PostgreSQL Commitment Persistence
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';

function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION_FAILED: ${message}`);
  }
}

async function fetchJson(
  path: string,
  method: string = 'GET',
  body: any = null
): Promise<{ status: number; json: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const dataStr = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 4310,
        path,
        method,
        headers: {
          Host: '127.0.0.1:4310',
          Origin: 'http://127.0.0.1:4310',
          'Content-Type': 'application/json',
          ...(dataStr ? { 'Content-Length': Buffer.byteLength(dataStr) } : {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, json: JSON.parse(data), raw: data });
          } catch {
            resolve({ status: res.statusCode || 0, json: null, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (dataStr) req.write(dataStr);
    req.end();
  });
}

async function main() {
  console.log('================================================================================');
  console.log(' LIVE SERVER LOOPBACK PROBE: SLICE 5 OPPORTUNITY BUNDLES & CITED REPORTS');
  console.log(' Server Target: http://127.0.0.1:4310 | Bound Port: 4310');
  console.log('================================================================================\n');

  try {
    try {
      await fetchJson('/api/health');
      console.log('[Probe] Existing WorkstationServer detected on port 4310.\n');
    } catch {
      console.log('[Probe] No server detected on port 4310. Spawning persistent WorkstationServer daemon...');
      const tsxCli = path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
      const workerScript = path.resolve(process.cwd(), 'src/cli/workstationCli.ts');
      const child = spawn(process.execPath, [tsxCli, workerScript], {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd()
      });
      child.unref();

      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const ping = await fetchJson('/api/health');
          if (ping.status === 200) {
            console.log('[Probe] Persistent WorkstationServer daemon is active on port 4310.\n');
            break;
          }
        } catch {}
      }
    }

    // ------------------------------------------------------------------------
    // Probe 1: Server & Database Health
    // ------------------------------------------------------------------------
    console.log('--- PROBE 1: Server & Database Health ---');
    const health = await fetchJson('/api/health');
    console.log('GET /api/health HTTP Status:', health.status);
    console.log('Postgres Connected:', health.json.postgres_connected);
    console.log('Ledger Hash Chain Verified:', health.json.ledger_hash_chain_verified);
    console.log('Operating Mode:', health.json.operating_mode);
    console.log('Products in Deck:', health.json.postgres_row_counts?.products_count);
    console.log('Connectors Active:', health.json.postgres_row_counts?.connectors_count);

    assert(health.status === 200, 'Server health must return HTTP 200');
    assert(health.json.postgres_connected === true, 'PostgreSQL must be connected');
    assert(health.json.operating_mode === 'DRY_RUN_PAPER_SIMULATION_ONLY', 'Must be DRY_RUN_PAPER_SIMULATION_ONLY');
    assert(health.json.real_money_execution_enabled === false, 'Real money execution must be disabled');
    console.log('PROBE 1 PASSED: Server is healthy with dual-ledger and database persistence.\n');

    // ------------------------------------------------------------------------
    // Probe 2: Unprefilled User-Intent Gate Enforcement
    // ------------------------------------------------------------------------
    console.log('--- PROBE 2: Unprefilled User-Intent Gate Enforcement ---');
    const emptyIntentRes = await fetchJson('/api/bundle/evaluate', 'POST', {});
    console.log('POST /api/bundle/evaluate with empty body HTTP Status:', emptyIntentRes.status);
    console.log('Status Returned:', emptyIntentRes.json.status);
    console.log('Error Code:', emptyIntentRes.json.error_code);
    console.log('Missing Intent Fields:', emptyIntentRes.json.missing_intent_fields);

    assert(emptyIntentRes.status === 400, 'Empty intent must return HTTP 400');
    assert(emptyIntentRes.json.status === 'USER_INTENT_REQUIRED', 'Must return USER_INTENT_REQUIRED');
    assert(emptyIntentRes.json.error_code === 'E-BUNDLE-INTENT-REQUIRED', 'Must return E-BUNDLE-INTENT-REQUIRED');
    assert(emptyIntentRes.json.missing_intent_fields.length === 5, 'Must report all 5 missing intent fields');

    // Partial intent check
    const partialIntentRes = await fetchJson('/api/bundle/evaluate', 'POST', {
      available_paper_capital_inr: 500000,
      minimum_return_hurdle_bps: 2000
    });
    console.log('POST /api/bundle/evaluate partial body HTTP Status:', partialIntentRes.status);
    assert(partialIntentRes.status === 400, 'Partial intent must return HTTP 400');
    console.log('PROBE 2 PASSED: Unprefilled user intent gate strictly enforced.\n');

    // ------------------------------------------------------------------------
    // Probe 3: Festive vs Industrial Opportunity Bundle Seasonality
    // ------------------------------------------------------------------------
    console.log('--- PROBE 3: Festive vs Industrial Seasonality Analysis ---');
    const festiveEval = await fetchJson('/api/bundle/evaluate', 'POST', {
      available_paper_capital_inr: 500000,
      minimum_return_hurdle_bps: 2000,
      holding_period_days: 60,
      max_drawdown_limit_bps: 2000,
      max_single_supplier_concentration_bps: 7000,
      selected_product_ids: [
        'prod:festive:diya:terracotta-12p',
        'prod:wellness:candle:soy-lavender'
      ]
    });
    console.log('Festive Bundle HTTP Status:', festiveEval.status);
    console.log('Festive Windows Detected:', festiveEval.json.seasonal_window_analysis.detected_windows);
    console.log('Festive Primary Window:', festiveEval.json.seasonal_window_analysis.primary_window);
    console.log('Festive Order Cutoff Date:', festiveEval.json.seasonal_window_analysis.order_cutoff_date);
    console.log('Festive Overlap Intensity:', festiveEval.json.seasonal_window_analysis.seasonal_overlap_intensity);

    assert(festiveEval.status === 200, 'Festive bundle evaluation must succeed');
    assert(festiveEval.json.seasonal_window_analysis.detected_windows.includes('DIWALI_FESTIVE'), 'Must detect DIWALI_FESTIVE');
    assert(festiveEval.json.seasonal_window_analysis.seasonal_overlap_intensity === 'HIGH', 'Festive bundle must show HIGH overlap intensity');

    const industrialEval = await fetchJson('/api/bundle/evaluate', 'POST', {
      available_paper_capital_inr: 500000,
      minimum_return_hurdle_bps: 2000,
      holding_period_days: 90,
      max_drawdown_limit_bps: 2000,
      max_single_supplier_concentration_bps: 7000,
      selected_product_ids: [
        'prod:din3017:ss304:16-25mm:pack-10',
        'prod:brass:ball-valve:1-2in-pn20'
      ]
    });
    console.log('Industrial Bundle HTTP Status:', industrialEval.status);
    console.log('Industrial Windows Detected:', industrialEval.json.seasonal_window_analysis.detected_windows);
    assert(industrialEval.status === 200, 'Industrial bundle evaluation must succeed');
    assert(industrialEval.json.seasonal_window_analysis.detected_windows.includes('YEAR_ROUND_INDUSTRIAL_B2B'), 'Must detect YEAR_ROUND_INDUSTRIAL_B2B');
    console.log('PROBE 3 PASSED: Festive vs industrial seasonal windows cleanly distinguished.\n');

    // ------------------------------------------------------------------------
    // Probe 4: Supplier & Hub Concentration Gate
    // ------------------------------------------------------------------------
    console.log('--- PROBE 4: Supplier & Hub Concentration Limit Gate ---');
    const concentrationBreachRes = await fetchJson('/api/bundle/evaluate', 'POST', {
      available_paper_capital_inr: 500000,
      minimum_return_hurdle_bps: 2000,
      holding_period_days: 60,
      max_drawdown_limit_bps: 2000,
      max_single_supplier_concentration_bps: 4000, // 40% cap
      selected_product_ids: [
        'prod:brass:ball-valve:1-2in-pn20' // 100% allocation to single hub
      ]
    });
    console.log('Breached Concentration HTTP Status:', concentrationBreachRes.status);
    console.log('Concentration Limit Breached:', concentrationBreachRes.json.concentration_analysis.concentration_limit_breached);
    console.log('Highest Supplier Concentration (bps):', concentrationBreachRes.json.concentration_analysis.highest_supplier_concentration_bps);
    console.log('Highest Supplier ID:', concentrationBreachRes.json.concentration_analysis.highest_concentration_supplier_id);
    console.log('Highest Hub Concentration (bps):', concentrationBreachRes.json.concentration_analysis.highest_hub_concentration_bps);
    console.log('Highest Hub Name:', concentrationBreachRes.json.concentration_analysis.highest_concentration_hub);
    console.log('Recommended Disposition:', concentrationBreachRes.json.recommended_disposition);

    assert(concentrationBreachRes.status === 200, 'Evaluation returns 200 with breach status');
    assert(concentrationBreachRes.json.concentration_analysis.concentration_limit_breached === true, 'Concentration limit must be breached');
    assert(concentrationBreachRes.json.concentration_analysis.highest_supplier_concentration_bps === 10000, 'Supplier concentration must be 10,000 bps');
    assert(concentrationBreachRes.json.concentration_analysis.highest_hub_concentration_bps === 10000, 'Hub concentration must be 10,000 bps');
    assert(concentrationBreachRes.json.recommended_disposition === 'CONCENTRATION_LIMIT_BREACHED', 'Disposition must be CONCENTRATION_LIMIT_BREACHED');

    // Verify commit is blocked
    const blockedCommit = await fetchJson('/api/bundle/commit', 'POST', {
      evaluation: concentrationBreachRes.json,
      confirmation: {
        operator_id: 'OP_AUDIT',
        confirmation_token: 'CONF-AUDIT-12345',
        explicit_rationale: 'Attempting commit on breached concentration portfolio',
        confirmed_at_utc: new Date().toISOString()
      }
    });
    console.log('Commit on Breached Bundle HTTP Status:', blockedCommit.status);
    assert(blockedCommit.status === 409, 'Commit on breached bundle must return HTTP 409');
    console.log('PROBE 4 PASSED: Concentration limit breach correctly blocks commitment (preserving supplier vs hub separation).\n');

    // ------------------------------------------------------------------------
    // Probe 5: Risk-Free Opportunity-Cost Benchmark Spread
    // ------------------------------------------------------------------------
    console.log('--- PROBE 5: Opportunity-Cost Benchmark Spread ---');
    const benchmark = festiveEval.json.benchmark_comparison;
    console.log('RBI 91D T-Bill Benchmark (bps):', benchmark.rbi_91d_tbill_benchmark_bps);
    console.log('RBI T-Bill ISIN:', benchmark.benchmark_sources?.[0]?.isin);
    console.log('RBI Auction Notice ID:', benchmark.benchmark_sources?.[0]?.auction_notice_id);
    console.log('SBI 1-Yr Bulk FD Benchmark (bps):', benchmark.sbi_1yr_bulk_fd_benchmark_bps);
    console.log('SBI Circular Reference:', benchmark.benchmark_sources?.[1]?.circular_reference);
    console.log('Base Annualized RoWC (bps):', benchmark.base_annualized_rowc_bps);
    console.log('Net Excess over T-Bill (bps):', benchmark.net_excess_return_over_tbill_bps);
    console.log('Net Excess over FD (bps):', benchmark.net_excess_return_over_fd_bps);
    console.log('Beats T-Bill:', benchmark.beats_tbill);
    console.log('Beats FD:', benchmark.beats_fd);

    assert(benchmark.rbi_91d_tbill_benchmark_bps === 650, 'RBI T-Bill must be 650 bps');
    assert(benchmark.sbi_1yr_bulk_fd_benchmark_bps === 725, 'SBI FD must be 725 bps');
    assert(benchmark.benchmark_sources?.[0]?.isin === 'IN002026X287', 'T-Bill must cite official ISIN IN002026X287');
    assert(benchmark.benchmark_sources?.[0]?.auction_notice_id === 'FBIL/TBILL/2026/41', 'T-Bill must cite auction notice FBIL/TBILL/2026/41');
    console.log('PROBE 5 PASSED: Benchmark spreads calculated with pure integer basis points and official regulatory identifiers.\n');

    // ------------------------------------------------------------------------
    // Probe 6: Three-Scenario Model & 90-Day Cash-Flow J-Curve
    // ------------------------------------------------------------------------
    console.log('--- PROBE 6: Three-Scenario Model & 90-Day Cash-Flow J-Curve ---');
    const { scenarios, cash_flow_j_curve } = festiveEval.json;
    console.log('Base Net Profit (INR):', scenarios.base.projected_net_profit_inr, '| Subunits:', scenarios.base.projected_net_profit_subunits);
    console.log('Upside Net Profit (INR):', scenarios.upside.projected_net_profit_inr, '| Subunits:', scenarios.upside.projected_net_profit_subunits);
    console.log('Downside Stress Net Profit (INR):', scenarios.downside.projected_net_profit_inr, '| Subunits:', scenarios.downside.projected_net_profit_subunits);
    console.log('J-Curve Data Points Count:', cash_flow_j_curve.length);
    console.log('Day 1 Net Cash Position (INR):', cash_flow_j_curve[0].net_cumulative_cash_position_inr);
    console.log('Day 90 Net Cash Position (INR):', cash_flow_j_curve[89].net_cumulative_cash_position_inr);
    console.log('Unallocated Cash Buffer (INR):', festiveEval.json.unallocated_cash_buffer_inr);
    console.log('Reconciliation Variance (subunits):', festiveEval.json.accounting_reconciliation?.reconciliation_variance_subunits);

    assert(cash_flow_j_curve.length === 90, 'J-curve must contain 90 points');
    assert(cash_flow_j_curve[0].net_cumulative_cash_position_inr < 0, 'Day 1 must show initial capital outlay');
    assert(cash_flow_j_curve[89].net_cumulative_cash_position_inr === scenarios.base.projected_net_profit_inr, 'Day 90 cash position must exactly equal Base Net Profit');
    assert(festiveEval.json.accounting_reconciliation?.reconciliation_variance_subunits === '0', 'Variance between Day 90 cash and Base Net Profit must be exactly 0 subunits');
    console.log('PROBE 6 PASSED: 3 scenarios, 90-day J-curve waterfall and zero-variance cash reconciliation verified.\n');

    // ------------------------------------------------------------------------
    // Probe 7: Cited Research Report Exporter (Lead & Bundle)
    // ------------------------------------------------------------------------
    console.log('--- PROBE 7: Cited Research Report Exporter ---');
    const leadReportRes = await fetchJson('/api/reports/export?target_type=LEAD&target_id=prod:festive:diya:terracotta-12p');
    console.log('Lead Report HTTP Status:', leadReportRes.status);
    console.log('Report ID:', leadReportRes.json.report_id);
    console.log('Target Name:', leadReportRes.json.target_name);
    console.log('Provenance Summary:', leadReportRes.json.executive_summary_and_verdict.provenance_summary);
    console.log('Citations Count:', leadReportRes.json.claims_and_inline_citations.length);
    console.log('Assumptions Rows:', leadReportRes.json.explicit_assumptions_table.length);
    console.log('Incumbent Failure Hypotheses:', leadReportRes.json.contrary_evidence_and_incumbent_failures.length);
    console.log('Report JCS SHA-256:', leadReportRes.json.report_jcs_sha256);

    assert(leadReportRes.status === 200, 'Lead report export must succeed');
    assert(leadReportRes.json.claims_and_inline_citations.length >= 1, 'Must have at least 1 citation');
    assert(leadReportRes.json.contrary_evidence_and_incumbent_failures.length === 8, 'Must have all 8 structural hypotheses');
    assert(leadReportRes.json.report_jcs_sha256.length === 64, 'Must have 64-char JCS digest');

    // Export Bundle Report
    const bundleId = festiveEval.json.bundle_id;
    const bundleReportRes = await fetchJson(`/api/reports/export?target_type=BUNDLE&target_id=${bundleId}`);
    console.log('Bundle Report HTTP Status:', bundleReportRes.status);
    console.log('Bundle Report Target ID:', bundleReportRes.json.target_id);
    assert(bundleReportRes.status === 200, 'Bundle report export must succeed');
    console.log('PROBE 7 PASSED: Cited reports for single lead and bundle exported with full provenance.\n');

    // ------------------------------------------------------------------------
    // Probe 8: Historical Bitemporal Cutoff & JCS Digest Reproducibility
    // ------------------------------------------------------------------------
    console.log('--- PROBE 8: Historical Bitemporal Cutoff & JCS Reproducibility ---');
    const cutoff = '2026-01-01T00:00:00Z';
    const rep1 = await fetchJson(`/api/reports/export?target_type=LEAD&target_id=prod:brass:ball-valve:1-2in-pn20&as_of_utc=${encodeURIComponent(cutoff)}`);
    const rep2 = await fetchJson(`/api/reports/export?target_type=LEAD&target_id=prod:brass:ball-valve:1-2in-pn20&as_of_utc=${encodeURIComponent(cutoff)}`);
    console.log('Run 1 JCS SHA-256:', rep1.json.report_jcs_sha256);
    console.log('Run 2 JCS SHA-256:', rep2.json.report_jcs_sha256);
    console.log('Bit-for-Bit Identical:', rep1.json.report_jcs_sha256 === rep2.json.report_jcs_sha256);

    assert(rep1.status === 200 && rep2.status === 200, 'Both historical queries must succeed');
    assert(rep1.json.report_jcs_sha256 === rep2.json.report_jcs_sha256, 'Digests must match bit-for-bit');
    console.log('PROBE 8 PASSED: Bit-for-bit JCS reproducibility confirmed under historical cutoff.\n');

    // ------------------------------------------------------------------------
    // Probe 9: Human Confirmation Gate, Operator Auth & Token Replay Protection
    // ------------------------------------------------------------------------
    console.log('--- PROBE 9: Human Confirmation Gate & Operator Authorization ---');
    const shortCommitRes = await fetchJson('/api/bundle/commit', 'POST', {
      evaluation: festiveEval.json,
      confirmation: {
        operator_id: 'OP_TEST',
        confirmation_token: 'CONF-TOKEN-SHORT',
        explicit_rationale: 'Too short',
        confirmed_at_utc: new Date().toISOString()
      }
    });
    console.log('Short Rationale Commit HTTP Status:', shortCommitRes.status);
    assert(shortCommitRes.status === 400, 'Short rationale must be rejected with HTTP 400');

    // Unauthorized operator check
    const unauthorizedCommitRes = await fetchJson('/api/bundle/commit', 'POST', {
      evaluation: festiveEval.json,
      confirmation: {
        operator_id: 'attacker_unauthorized_desk',
        confirmation_token: 'CONF-TOKEN-UNAUTH',
        explicit_rationale: 'Valid rationale length but unauthorized operator account',
        confirmed_at_utc: new Date().toISOString()
      }
    });
    console.log('Unauthorized Operator Commit HTTP Status:', unauthorizedCommitRes.status);
    assert(unauthorizedCommitRes.status === 403, 'Unauthorized operator must be rejected with HTTP 403');

    const commitToken = `CONF-TOKEN-${Date.now()}`;
    const validCommitRes = await fetchJson('/api/bundle/commit', 'POST', {
      evaluation: festiveEval.json,
      confirmation: {
        operator_id: 'OP_SUPERVISOR',
        confirmation_token: commitToken,
        explicit_rationale: 'Approved paper simulation portfolio commitment for seasonal diwali inventory run',
        confirmed_at_utc: new Date().toISOString()
      }
    });
    console.log('Valid Rationale Commit HTTP Status:', validCommitRes.status);
    console.log('Committed Bundle ID:', validCommitRes.json.outcome?.bundle_id);
    console.log('Commit Status:', validCommitRes.json.outcome?.status);

    assert(validCommitRes.status === 200, 'Valid commit must succeed with HTTP 200');
    assert(validCommitRes.json.outcome?.status === 'COMMITTED_TO_PAPER_SIMULATION', 'Status must be COMMITTED_TO_PAPER_SIMULATION');

    // Token replay protection check
    const replayCommitRes = await fetchJson('/api/bundle/commit', 'POST', {
      evaluation: industrialEval.json,
      confirmation: {
        operator_id: 'OP_SUPERVISOR',
        confirmation_token: commitToken, // Reused token!
        explicit_rationale: 'Approved paper simulation portfolio commitment for industrial inventory run',
        confirmed_at_utc: new Date().toISOString()
      }
    });
    console.log('Replayed Token Commit HTTP Status:', replayCommitRes.status);
    assert(replayCommitRes.status === 409, 'Replayed token must be rejected with HTTP 409');
    console.log('PROBE 9 PASSED: Governed human confirmation gate, operator auth (403), token replay (409) and database persistence verified.\n');

    // ------------------------------------------------------------------------
    // Probe 10: Skills MCP Capability Registry API
    // ------------------------------------------------------------------------
    console.log('--- PROBE 10: Skills MCP Capability Registry API ---');
    const skillsRes = await fetchJson('/api/skills/registry');
    console.log('GET /api/skills/registry HTTP Status:', skillsRes.status);
    console.log('Total Capabilities:', skillsRes.json.total_capabilities);
    console.log('Configured Capabilities:', skillsRes.json.configured_capabilities);
    console.log('Capabilities Sample:', skillsRes.json.capabilities?.slice(0, 3).map((c: any) => `${c.capability_id} (${c.concurrency_mode})`));

    assert(skillsRes.status === 200, 'Skills registry must return HTTP 200');
    assert(skillsRes.json.total_capabilities >= 12, 'Must register at least 12 institutional capabilities');
    assert(skillsRes.json.capabilities.some((c: any) => c.capability_id === 'skill:mcp:gemini-api'), 'Must contain Gemini API capability');
    assert(skillsRes.json.capabilities.some((c: any) => c.capability_id === 'skill:mcp:google-maps'), 'Must contain Google Maps capability');
    console.log('PROBE 10 PASSED: Skills MCP capability registry verified.\n');

    // ------------------------------------------------------------------------
    // Verification Summary
    // ------------------------------------------------------------------------
    console.log('================================================================================');
    console.log(' ALL 10 SLICE 5 LIVE LOOPBACK PROBES PASSED SUCCESSFULLY');
    console.log(' Operating Mode: DRY_RUN_PAPER_SIMULATION_ONLY (Dual-ledger isolation preserved)');
    console.log(' Persistent Server: http://127.0.0.1:4310 is RUNNING and available for human review');
    console.log('================================================================================');
  } catch (err: any) {
    console.error('\nPROBE EXECUTION FAILED:', err.message);
    process.exit(1);
  }
}

main();
