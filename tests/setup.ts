import { beforeAll, beforeEach } from 'vitest';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { ClusterAutonomyGovernor } from '../src/agents/reasoning/clusterAutonomyGovernor.js';

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/market_hft_test';

export async function truncateTestDatabase(): Promise<void> {
  const wal = path.join(process.cwd(), 'scratch', 'autonomy_budget_wal.jsonl');
  if (fs.existsSync(wal)) {
    try {
      fs.unlinkSync(wal);
    } catch {}
  }
  ClusterAutonomyGovernor.resetInstanceForTesting();

  const pool = new pg.Pool({ connectionString: dbUrl });
  try {
    await pool.query(`
      TRUNCATE TABLE
        market_opportunity_candidates,
        market_candidate_lifecycle_events,
        market_investigation_tasks,
        market_paper_positions,
        market_paper_cash_ledger,
        market_committed_bundles,
        market_hypothesis_ledger,
        market_bitemporal_evidence,
        market_event_overlays,
        market_signal_traces,
        market_product_deck_state
      CASCADE;
    `);
  } catch {
    // Ignore if tables do not exist yet on fresh setup
  } finally {
    await pool.end().catch(() => {});
  }
}

beforeAll(async () => {
  await truncateTestDatabase();
});

beforeEach(async () => {
  ClusterAutonomyGovernor.resetInstanceForTesting();
});
