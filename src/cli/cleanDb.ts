import pg from 'pg';
import { ProductObservationDeckRegistry } from '../research/productObservationDeckRegistry.js';
import { sanitizeForJcs } from '../agents/m6AgentFramework.js';

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/market_hft_test'
  });

  const client = await pool.connect();
  try {
    // 1. Delete test artifacts
    await client.query(`
      DELETE FROM market_product_deck_state
      WHERE product_id LIKE 'prod:custom:%'
         OR product_id LIKE 'prod:titanium:%'
         OR product_id LIKE 'prod:test:%';

      DELETE FROM market_signal_traces
      WHERE trace_id LIKE 'TRACE-TEST-%'
         OR signal_id LIKE 'SIG-TEST-%'
         OR signal_id LIKE 'sig:test:%';

      DELETE FROM market_bitemporal_evidence
      WHERE evidence_id LIKE 'EVID-TEST-%';
    `);

    // 2. Ensure exactly the 8 canonical catalog products are in market_product_deck_state
    const goldenDeck = new ProductObservationDeckRegistry().getAllProducts();
    for (const prod of goldenDeck) {
      await client.query(
        `INSERT INTO market_product_deck_state
           (product_id, sku_id, name, category, archetype, deck_json, updated_at_utc)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (product_id) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           archetype = EXCLUDED.archetype,
           deck_json = EXCLUDED.deck_json,
           updated_at_utc = EXCLUDED.updated_at_utc`,
        [
          prod.product_id,
          prod.sku_id,
          prod.name,
          prod.category,
          prod.commercial_archetype,
          JSON.stringify(sanitizeForJcs(prod)),
          new Date().toISOString()
        ]
      );
    }

    // 3. Reset connector telemetry to clean IDLE_NEVER_RUN baseline
    const baseConnectors = [
      { connector_id: 'conn:marketplace:amazon-in', name: 'Amazon India Fasteners & Tools Ingestion Connector', channel: 'MARKETPLACE_OR_SUPPLIER_HTML', status: 'IDLE_NEVER_RUN', error_count: 0, ingested_count: 0, quarantined_count: 0 },
      { connector_id: 'conn:supplier:indiamart', name: 'IndiaMART B2B Sourcing Hub Collector', channel: 'MARKETPLACE_OR_SUPPLIER_HTML', status: 'IDLE_NEVER_RUN', error_count: 0, ingested_count: 0, quarantined_count: 0 },
      { connector_id: 'conn:media:youtube-reviews', name: 'YouTube Field Review & Workshop Transcripts Collector', channel: 'YOUTUBE_VIDEO_TRANSCRIPT', status: 'IDLE_NEVER_RUN', error_count: 0, ingested_count: 0, quarantined_count: 0 },
      { connector_id: 'conn:macro:rbi-fbil-lme', name: 'RBI Financial Benchmarks & LME Metal Rates Listener', channel: 'MACROECONOMIC_SERIES', status: 'IDLE_NEVER_RUN', error_count: 0, ingested_count: 0, quarantined_count: 0 },
      { connector_id: 'conn:statutory:cbic-msme', name: 'CBIC Customs & MSME Procurement Notifications Watcher', channel: 'GOVERNMENT_STATUTORY_CIRCULAR', status: 'IDLE_NEVER_RUN', error_count: 0, ingested_count: 0, quarantined_count: 0 }
    ];

    for (const c of baseConnectors) {
      await client.query(
        `INSERT INTO market_connector_telemetry
           (connector_id, name, channel, status, last_fetch_utc, error_count, telemetry_json)
         VALUES ($1, $2, $3, $4, null, $5, $6)
         ON CONFLICT (connector_id) DO UPDATE SET
           status = EXCLUDED.status,
           last_fetch_utc = null,
           error_count = EXCLUDED.error_count,
           telemetry_json = EXCLUDED.telemetry_json`,
        [c.connector_id, c.name, c.channel, c.status, c.error_count, JSON.stringify(c)]
      );
    }

    const pCount = await client.query('SELECT count(*) as count FROM market_product_deck_state');
    const cCount = await client.query('SELECT count(*) as count FROM market_connector_telemetry');
    console.log(`Database cleaned successfully. Products: ${pCount.rows[0].count}, Connectors: ${cCount.rows[0].count}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Clean DB error:', err);
  process.exit(1);
});
