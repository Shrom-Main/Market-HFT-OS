#!/usr/bin/env tsx
import fs from 'node:fs';
import {
  FileBackedDurableRecoveryJournal,
  DurablePortfolioCheckpointStore,
  CrashRecoveryEngine
} from '../src/persistence/durableRecoveryJournal.js';
import { SimulationPortfolio } from '../src/portfolio/simulationPortfolio.js';
import { CanonicalMoney } from '../src/canonical/domain.js';
import { SimulatedFillEvent, SimulatedOrderRecord } from '../src/execution/simulatedGateway.js';

interface WorkerArgs {
  mode: 'BENCHMARK' | 'CRASH_BEFORE_FILL2_APPLY' | 'RECOVER';
  journalPath: string;
  checkpointPath: string;
  outputPath?: string;
  currency: 'EUR';
  scale: 4;
}

const args = JSON.parse(process.argv[2]) as WorkerArgs;

const initialCash: CanonicalMoney = {
  currency: 'EUR',
  amount_subunits: '1000000000', // 100,000.0000 EUR
  scale: 4
};

const fill1: SimulatedFillEvent = {
  fill_id: 'fill:worker:001',
  order_id: 'ord:001',
  fill_timestamp_utc: '2026-10-12T10:00:01.000Z',
  fill_price: { currency: 'EUR', amount_subunits: '100000', scale: 4 }, // 10.0000 EUR
  fill_quantity: 100,
  cumulative_quantity: 100,
  remaining_quantity: 0
};

const order1: SimulatedOrderRecord = {
  order_id: 'ord:001',
  intent_id: 'intent:001',
  offer_id: 'off:001',
  product_id: 'DIN3017-W4-CLAMP-001',
  venue_id: 'SIMULATED-LOCAL',
  side: 'BUY',
  order_price: { currency: 'EUR', amount_subunits: '100000', scale: 4 },
  total_quantity: 100,
  filled_quantity: 100,
  remaining_quantity: 0,
  status: 'FILLED',
  created_at_utc: '2026-10-12T10:00:00.000Z',
  updated_at_utc: '2026-10-12T10:00:01.000Z',
  fills: [fill1],
  events: [],
  intent_sha256: '0'.repeat(64)
};

const fill2: SimulatedFillEvent = {
  fill_id: 'fill:worker:002',
  order_id: 'ord:002',
  fill_timestamp_utc: '2026-10-12T10:00:02.000Z',
  fill_price: { currency: 'EUR', amount_subunits: '110000', scale: 4 }, // 11.0000 EUR
  fill_quantity: 50,
  cumulative_quantity: 50,
  remaining_quantity: 0
};

const order2: SimulatedOrderRecord = {
  order_id: 'ord:002',
  intent_id: 'intent:002',
  offer_id: 'off:002',
  product_id: 'DIN3017-W4-CLAMP-001',
  venue_id: 'SIMULATED-LOCAL',
  side: 'BUY',
  order_price: { currency: 'EUR', amount_subunits: '110000', scale: 4 },
  total_quantity: 50,
  filled_quantity: 50,
  remaining_quantity: 0,
  status: 'FILLED',
  created_at_utc: '2026-10-12T10:00:01.500Z',
  updated_at_utc: '2026-10-12T10:00:02.000Z',
  fills: [fill2],
  events: [],
  intent_sha256: '0'.repeat(64)
};

if (args.mode === 'BENCHMARK') {
  // Clean uninterrupted benchmark
  const journal = new FileBackedDurableRecoveryJournal(args.journalPath);
  const portfolio = new SimulationPortfolio({ initialCash, allowShort: false });

  // Fill 1
  journal.appendEvent('FILL_RECORDED', { fill: fill1, order: order1 }, '2026-10-12T10:00:01.000Z');
  portfolio.processFill(fill1, order1, '2026-10-12T10:00:01.000Z');
  journal.appendEvent('PORTFOLIO_APPLIED', { fill_id: fill1.fill_id, order_id: fill1.order_id }, '2026-10-12T10:00:01.000Z');

  // Fill 2
  journal.appendEvent('FILL_RECORDED', { fill: fill2, order: order2 }, '2026-10-12T10:00:02.000Z');
  portfolio.processFill(fill2, order2, '2026-10-12T10:00:02.000Z');
  journal.appendEvent('PORTFOLIO_APPLIED', { fill_id: fill2.fill_id, order_id: fill2.order_id }, '2026-10-12T10:00:02.000Z');

  const benchEntries = journal.getEntries();
  const benchLastEntrySha256 = journal.getLastEntrySha256();
  DurablePortfolioCheckpointStore.saveCheckpoint(args.checkpointPath, portfolio, journal);
  journal.close();

  if (args.outputPath) {
    fs.writeFileSync(args.outputPath, JSON.stringify({
      snapshot: portfolio.getSnapshot(),
      checkpoint: portfolio.exportCheckpoint(),
      journalEntries: benchEntries,
      lastEntrySha256: benchLastEntrySha256
    }, null, 2), 'utf8');
  }
  process.exit(0);

} else if (args.mode === 'CRASH_BEFORE_FILL2_APPLY') {
  // Step 1: Initialize journal and portfolio, process Fill 1, checkpoint
  const journal = new FileBackedDurableRecoveryJournal(args.journalPath);
  const portfolio = new SimulationPortfolio({ initialCash, allowShort: false });

  // Fill 1
  journal.appendEvent('FILL_RECORDED', { fill: fill1, order: order1 }, '2026-10-12T10:00:01.000Z');
  portfolio.processFill(fill1, order1, '2026-10-12T10:00:01.000Z');
  journal.appendEvent('PORTFOLIO_APPLIED', { fill_id: fill1.fill_id, order_id: fill1.order_id }, '2026-10-12T10:00:01.000Z');

  // Save checkpoint at Fill 1
  DurablePortfolioCheckpointStore.saveCheckpoint(args.checkpointPath, portfolio, journal);

  // Step 2: Gateway emits and durably records Fill 2 in WAL
  journal.appendEvent('FILL_RECORDED', { fill: fill2, order: order2 }, '2026-10-12T10:00:02.000Z');

  // SIMULATE A HARD PROCESS CRASH: Terminate immediately with non-zero exit code!
  // In-memory portfolio and objects are completely obliterated by the operating system!
  process.exit(99);

} else if (args.mode === 'RECOVER') {
  // Step 3: Fresh process starts up from durable files
  const journal = new FileBackedDurableRecoveryJournal(args.journalPath);
  const portfolio = DurablePortfolioCheckpointStore.loadCheckpoint(args.checkpointPath, journal);

  const recoveryResult = CrashRecoveryEngine.recoverDurable(journal, portfolio, '2026-10-12T10:00:05.000Z');

  const recoveredEntries = journal.getEntries();
  const recoveredLastEntrySha256 = journal.getLastEntrySha256();

  // Save recovered checkpoint
  DurablePortfolioCheckpointStore.saveCheckpoint(args.checkpointPath, portfolio, journal);
  journal.close();

  if (args.outputPath) {
    fs.writeFileSync(args.outputPath, JSON.stringify({
      snapshot: portfolio.getSnapshot(),
      recoveryResult,
      checkpoint: portfolio.exportCheckpoint(),
      journalEntries: recoveredEntries,
      lastEntrySha256: recoveredLastEntrySha256
    }, null, 2), 'utf8');
  }
  process.exit(0);
}
