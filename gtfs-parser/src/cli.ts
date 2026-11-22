#!/usr/bin/env node
/**
 * BusElli GTFS CLI — ingest BMTC GTFS CSV files into PostgreSQL/PostGIS.
 *
 * Usage:
 *   buselli-gtfs --gtfs-dir ./data/bmtc-gtfs --database-url postgresql://...
 *   npx tsx src/cli.ts --gtfs-dir ./data/bmtc-gtfs --database-url postgresql://...
 */
import { parseArgs } from 'node:util';
import { createSql } from './db/postgres-client.js';
import { GtfsIngestionPipeline } from './ingestion-pipeline.js';

const { values } = parseArgs({
  options: {
    'gtfs-dir': { type: 'string' },
    'database-url': { type: 'string' },
    'agency-id': { type: 'string', default: 'BMTC' },
    'agency-name': { type: 'string', default: 'BMTC (Bengaluru Metropolitan Transport Corporation)' },
    'agency-url': { type: 'string', default: 'https://bmtcinfo.com' },
    'strict': { type: 'boolean', default: false },
  },
});

const gtfsDir = values['gtfs-dir'];
const databaseUrl = values['database-url'];

if (!gtfsDir || !databaseUrl) {
  console.error('Usage: buselli-gtfs --gtfs-dir <path> --database-url <pg connection string>');
  process.exit(1);
}

const sql = createSql(databaseUrl);

const pipeline = new GtfsIngestionPipeline(sql, {
  gtfsDir,
  defaultAgencyId:   values['agency-id'],
  defaultAgencyName: values['agency-name'],
  defaultAgencyUrl:  values['agency-url'],
  continueOnError:   !values['strict'],
  log: (msg) => console.log(msg),
});

pipeline
  .run()
  .then(async (summary) => {
    console.log('[gtfs] Summary:', JSON.stringify(summary, null, 2));
    await sql.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('[gtfs] Fatal error:', err);
    await sql.end();
    process.exit(1);
  });
