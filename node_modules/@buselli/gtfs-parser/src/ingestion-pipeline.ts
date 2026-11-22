/**
 * GtfsIngestionPipeline — orchestrates the full BMTC GTFS CSV → PostGIS ingest.
 *
 * Ingestion order respects FK constraints:
 *   agency → routes → stops → calendar → trips → stop_times → shapes → shape_lines
 *
 * Re-entrant: re-running against the same DB is safe due to UPSERT everywhere.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvFile } from './csv-reader.js';
import { GtfsRepository } from './db/gtfs-repository.js';
import {
  GtfsRouteRowSchema,
  GtfsStopRowSchema,
  GtfsTripRowSchema,
  GtfsStopTimeRowSchema,
  GtfsShapeRowSchema,
} from './schemas.js';
import type { Sql } from './db/postgres-client.js';

export interface IngestionOptions {
  /** Directory containing the GTFS .txt files. */
  gtfsDir: string;
  /** Default agency_id to use when routes.txt omits the field. */
  defaultAgencyId?: string;
  defaultAgencyName?: string;
  defaultAgencyUrl?: string;
  /** If true, log warnings for validation errors but continue. Default: true. */
  continueOnError?: boolean;
  log?: (msg: string) => void;
}

export interface IngestionSummary {
  routes: number;
  stops: number;
  trips: number;
  stopTimes: number;
  shapePoints: number;
  parseErrors: number;
  durationMs: number;
}

export class GtfsIngestionPipeline {
  private readonly repo: GtfsRepository;
  private readonly log: (msg: string) => void;

  constructor(sql: Sql, private readonly opts: IngestionOptions) {
    this.repo = new GtfsRepository(sql);
    this.log = opts.log ?? ((m) => console.log(m)); // eslint-disable-line no-console
  }

  async run(): Promise<IngestionSummary> {
    const start = Date.now();
    const summary: IngestionSummary = {
      routes: 0, stops: 0, trips: 0,
      stopTimes: 0, shapePoints: 0,
      parseErrors: 0, durationMs: 0,
    };
    const continueOnError = this.opts.continueOnError ?? true;

    // 1. Agency — ensure at least the default BMTC agency exists
    const agencyId   = this.opts.defaultAgencyId   ?? 'BMTC';
    const agencyName = this.opts.defaultAgencyName  ?? 'BMTC (Bengaluru Metropolitan Transport Corporation)';
    const agencyUrl  = this.opts.defaultAgencyUrl   ?? 'https://bmtcinfo.com';
    await this.repo.upsertAgency(agencyId, agencyName, agencyUrl);
    this.log(`[gtfs] Agency upserted: ${agencyId}`);

    // 2. Routes
    const routesFile = this.resolve('routes.txt');
    if (existsSync(routesFile)) {
      const { valid, errors } = await parseCsvFile(routesFile, GtfsRouteRowSchema);
      summary.parseErrors += errors.length;
      if (errors.length > 0) this.warnErrors('routes.txt', errors, continueOnError);
      summary.routes = await this.repo.upsertRoutes(valid);
      this.log(`[gtfs] Routes: ${summary.routes} upserted, ${errors.length} parse errors`);
    } else {
      this.log('[gtfs] WARN: routes.txt not found — skipping');
    }

    // 3. Stops
    const stopsFile = this.resolve('stops.txt');
    if (existsSync(stopsFile)) {
      const { valid, errors } = await parseCsvFile(stopsFile, GtfsStopRowSchema);
      summary.parseErrors += errors.length;
      if (errors.length > 0) this.warnErrors('stops.txt', errors, continueOnError);
      summary.stops = await this.repo.upsertStops(valid);
      this.log(`[gtfs] Stops: ${summary.stops} upserted, ${errors.length} parse errors`);
    } else {
      this.log('[gtfs] WARN: stops.txt not found — skipping');
    }

    // 4. Trips (requires routes + calendar to exist for FK)
    const tripsFile = this.resolve('trips.txt');
    if (existsSync(tripsFile)) {
      const { valid, errors } = await parseCsvFile(tripsFile, GtfsTripRowSchema);
      summary.parseErrors += errors.length;
      if (errors.length > 0) this.warnErrors('trips.txt', errors, continueOnError);
      summary.trips = await this.repo.upsertTrips(valid);
      this.log(`[gtfs] Trips: ${summary.trips} upserted, ${errors.length} parse errors`);
    } else {
      this.log('[gtfs] WARN: trips.txt not found — skipping');
    }

    // 5. Stop times (largest file — batched in BATCH_SIZE chunks)
    const stopTimesFile = this.resolve('stop_times.txt');
    if (existsSync(stopTimesFile)) {
      const { valid, errors } = await parseCsvFile(stopTimesFile, GtfsStopTimeRowSchema);
      summary.parseErrors += errors.length;
      if (errors.length > 0) this.warnErrors('stop_times.txt', errors, continueOnError);
      summary.stopTimes = await this.repo.upsertStopTimes(valid);
      this.log(`[gtfs] StopTimes: ${summary.stopTimes} upserted, ${errors.length} parse errors`);
    } else {
      this.log('[gtfs] WARN: stop_times.txt not found — skipping');
    }

    // 6. Shapes + shape_lines rebuild
    const shapesFile = this.resolve('shapes.txt');
    if (existsSync(shapesFile)) {
      const { valid, errors } = await parseCsvFile(shapesFile, GtfsShapeRowSchema);
      summary.parseErrors += errors.length;
      if (errors.length > 0) this.warnErrors('shapes.txt', errors, continueOnError);
      summary.shapePoints = await this.repo.upsertShapes(valid);
      this.log(`[gtfs] Shapes: ${summary.shapePoints} points upserted, ${errors.length} parse errors`);
    } else {
      this.log('[gtfs] WARN: shapes.txt not found — skipping');
    }

    summary.durationMs = Date.now() - start;
    this.log(
      `[gtfs] ✓ Ingestion complete in ${summary.durationMs}ms — ` +
      `routes=${summary.routes} stops=${summary.stops} trips=${summary.trips} ` +
      `stopTimes=${summary.stopTimes} shapePoints=${summary.shapePoints} ` +
      `parseErrors=${summary.parseErrors}`,
    );
    return summary;
  }

  private resolve(filename: string): string {
    return join(this.opts.gtfsDir, filename);
  }

  private warnErrors(
    file: string,
    errors: Array<{ rowIndex: number; message: string }>,
    continueOnError: boolean,
  ): void {
    const preview = errors.slice(0, 3).map((e) => `  row ${e.rowIndex}: ${e.message}`).join('\n');
    const msg = `[gtfs] WARN: ${errors.length} parse error(s) in ${file}:\n${preview}${errors.length > 3 ? '\n  ...' : ''}`;
    this.log(msg);
    if (!continueOnError) throw new Error(msg);
  }
}
