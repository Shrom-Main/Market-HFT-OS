import http from 'node:http';

async function fetchJson(path: string, method: string = 'GET', body: any = null): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const dataStr = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 4310,
        path,
        method,
        headers: {
          'Host': '127.0.0.1:4310',
          'Origin': 'http://127.0.0.1:4310',
          'Content-Type': 'application/json',
          ...(dataStr ? { 'Content-Length': Buffer.byteLength(dataStr) } : {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, json: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 0, json: data });
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
  console.log('=== PROBING WORKSTATION SERVER (http://127.0.0.1:4310) ===\n');

  console.log('1. Probing GET /api/health ...');
  const health = await fetchJson('/api/health');
  console.log('HTTP Status:', health.status);
  console.log('Postgres Connected:', health.json.postgres_connected);
  console.log('Postgres Latency (ms):', health.json.postgres_latency_ms);
  console.log('Postgres Row Counts:', health.json.postgres_row_counts);

  console.log('\n2. Probing GET /api/health/db ...');
  const dbHealth = await fetchJson('/api/health/db');
  console.log('HTTP Status:', dbHealth.status);
  console.log('DB Connected:', dbHealth.json.is_connected);
  console.log('Backend:', dbHealth.json.backend);
  console.log('Latency (ms):', dbHealth.json.latency_ms);
  console.log('Table Counts:', dbHealth.json.table_row_counts);

  console.log('\n3. Probing GET /api/signals/inbox ...');
  const inbox = await fetchJson('/api/signals/inbox');
  console.log('HTTP Status:', inbox.status);
  console.log('Connectors Count:', inbox.json.connectors?.length);
  console.log('Connector 0 Status:', inbox.json.connectors?.[0]?.status);
  console.log('Connector 0 Ingested Count:', inbox.json.connectors?.[0]?.ingested_count);

  console.log('\n4. Probing GET /api/products/universe ...');
  const universe = await fetchJson('/api/products/universe');
  console.log('HTTP Status:', universe.status);
  console.log('Total Products in Deck:', universe.json.products?.length);

  console.log('\n5. Probing POST /api/ai/analyze ...');
  const ai = await fetchJson('/api/ai/analyze', 'POST', { product_id: 'prod:din3017:ss304:16-25mm:pack-10' });
  console.log('HTTP Status:', ai.status);
  console.log('LLM Called:', ai.json.llm_called);
  console.log('Generation Mode:', ai.json.generation_mode);
  console.log('LLM Model:', ai.json.llm_model);
  console.log('Verdict:', ai.json.arbitrage_viability_verdict);

  console.log('\n6. Probing POST /api/signals/ingest (Caller Origin Spoofing Attempt) ...');
  const spoof = await fetchJson('/api/signals/ingest', 'POST', {
    channel: 'MARKETPLACE_OR_SUPPLIER_HTML',
    source_id: 'conn:marketplace:amazon-in',
    target_url: 'https://www.amazon.in/dp/B0PROBE',
    origin_class: 'LIVE_VERIFIED_CAPTURE',
    raw_payload: {
      supplier_id: 'SUP-PROBE-' + Date.now(),
      sku_id: 'SKU-SS304-16-25MM-P10',
      raw_quote_inr: 3.50,
      freight_cost_inr: 0.15,
      packaging_cost_inr: 0.10
    }
  });
  console.log('HTTP Status:', spoof.status);
  console.log('Final Status:', spoof.json.final_status);
  console.log('Origin Claimed:', spoof.json.raw_input_stage?.origin_class);
  console.log('Verification Status (Demoted):', spoof.json.evidence_record_stage?.verification_status);
  console.log('\n7. Probing POST /api/bundle/evaluate (Missing Capital Safe Rejection) ...');
  const bundleNoCap = await fetchJson('/api/bundle/evaluate', 'POST', {
    selected_product_ids: ['prod:din3017:ss304:16-25mm:pack-10']
  });
  console.log('HTTP Status:', bundleNoCap.status);
  console.log('Error Message:', bundleNoCap.json.technical_error?.message || bundleNoCap.json.operator_summary || JSON.stringify(bundleNoCap.json));

  console.log('\n8. Probing POST /api/bundle/evaluate (Valid Input with Safe Disposition Default) ...');
  const bundleEval = await fetchJson('/api/bundle/evaluate', 'POST', {
    operator_id: 'OP-PROBE',
    target_capital_inr: 500000,
    min_return_hurdle_bps: 2000,
    target_holding_period_days: 90,
    max_risk_tolerance: 'MEDIUM',
    max_drawdown_pct: 15,
    selected_product_ids: ['prod:din3017:ss304:16-25mm:pack-10']
  });
  console.log('HTTP Status:', bundleEval.status);
  console.log('Recommended Disposition:', bundleEval.json.recommended_disposition);
  console.log('Mathematical Rationale:', bundleEval.json.mathematical_rationale);
  console.log('Base Target RoWC (bps):', bundleEval.json.scenarios?.base?.annualized_rowc_bps);

  console.log('\n9. Probing POST /api/bundle/commit (Unqualified Bundle Commit Block) ...');
  const unqualifiedCommit = await fetchJson('/api/bundle/commit', 'POST', {
    evaluation: {
      ...bundleEval.json,
      recommended_disposition: 'DATA_REQUIRED_HOLD'
    },
    confirmation: {
      action_id: 'ACT-COMMIT-BUNDLE',
      operator_id: 'OP-PROBE',
      confirmation_token: 'CONFIRM-TOKEN-PROBE',
      rationale: 'Governed operator explicit verification rationale for simulation',
      confirmed_at_utc: new Date().toISOString()
    }
  });
  console.log('HTTP Status:', unqualifiedCommit.status);
  console.log('Block Message:', unqualifiedCommit.json.technical_error?.message || unqualifiedCommit.json.operator_summary || JSON.stringify(unqualifiedCommit.json));

  console.log('\n10. Probing GET /api/bitemporal/series ...');
  const bitemporal = await fetchJson('/api/bitemporal/series?product_id=prod:din3017:ss304:16-25mm:pack-10');
  console.log('HTTP Status:', bitemporal.status);
  console.log('Series Points Count:', bitemporal.json.series_points_count);

  console.log('\n11. Probing GET /api/research/gaps ...');
  const gaps = await fetchJson('/api/research/gaps?product_id=prod:din3017:ss304:16-25mm:pack-10');
  console.log('HTTP Status:', gaps.status);
  console.log('Coverage Score (bps):', gaps.json.coverage_score_bps);
  console.log('Pending Tasks Count:', gaps.json.pending_tasks?.length);

  console.log('\n=== ALL PROBES COMPLETED SUCCESSFULLY ===');
}

main().catch((err) => {
  console.error('Probe error:', err);
  process.exit(1);
});
