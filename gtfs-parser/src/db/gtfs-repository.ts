/**
 * GtfsRepository — handles all PostGIS writes for the gtfs-parser pipeline.
 *
 * Uses UPSERT (ON CONFLICT DO UPDATE) so the ingestion is re-runnable
 * without double-inserting rows.  Every geometry column gets the mandatory
 * GIST index declared in migration 0001; this layer never creates indexes.
 */
import type { Sql } from './postgres-client.js';
import type {
  GtfsRouteRow,
  GtfsStopRow,
  GtfsTripRow,
  GtfsStopTimeRow,
  GtfsShapeRow,
} from '../schemas.js';
import { gtfsTimeToSeconds } from '../schemas.js';

/** How many rows to send in a single COPY/INSERT batch. */
const BATCH_SIZE = 500;

export class GtfsRepository {
  constructor(private readonly sql: Sql) {}

  // ── Agency ─────────────────────────────────────────────────────────────────

  async upsertAgency(agencyId: string, agencyName: string, agencyUrl: string): Promise<void> {
    await this.sql`
      INSERT INTO agency (agency_id, agency_name, agency_url, agency_timezone)
      VALUES (${agencyId}, ${agencyName}, ${agencyUrl}, 'Asia/Kolkata')
      ON CONFLICT (agency_id) DO UPDATE
        SET agency_name = EXCLUDED.agency_name,
            agency_url  = EXCLUDED.agency_url
    `;
  }

  // ── Routes ─────────────────────────────────────────────────────────────────

  async upsertRoutes(rows: GtfsRouteRow[]): Promise<number> {
    let count = 0;
    for (const batch of chunk(rows, BATCH_SIZE)) {
      const values = batch.map((r) => ({
        route_id:   r.route_id,
        agency_id:  r.agency_id ?? 'BMTC',
        short_name: r.route_short_name,
        long_name:  r.route_long_name,
        route_type: r.route_type,
        color:      r.route_color ?? null,
      }));
      await this.sql`
        INSERT INTO routes ${this.sql(values, 'route_id', 'agency_id', 'short_name', 'long_name', 'route_type', 'color')}
        ON CONFLICT (route_id) DO UPDATE
          SET short_name = EXCLUDED.short_name,
              long_name  = EXCLUDED.long_name,
              route_type = EXCLUDED.route_type,
              color      = EXCLUDED.color
      `;
      count += batch.length;
    }
    return count;
  }

  // ── Stops ──────────────────────────────────────────────────────────────────

  /**
   * Upserts stops into the `stops` table.
   * The `location` column is a GENERATED ALWAYS AS STORED PostGIS Point,
   * so we only provide stop_lat / stop_lon — the DB builds the geometry.
   */
  async upsertStops(rows: GtfsStopRow[]): Promise<number> {
    let count = 0;
    for (const batch of chunk(rows, BATCH_SIZE)) {
      const values = batch.map((r) => ({
        stop_id:   r.stop_id,
        stop_name: r.stop_name,
        stop_lat:  r.stop_lat,
        stop_lon:  r.stop_lon,
      }));
      await this.sql`
        INSERT INTO stops ${this.sql(values, 'stop_id', 'stop_name', 'stop_lat', 'stop_lon')}
        ON CONFLICT (stop_id) DO UPDATE
          SET stop_name = EXCLUDED.stop_name,
              stop_lat  = EXCLUDED.stop_lat,
              stop_lon  = EXCLUDED.stop_lon
      `;
      count += batch.length;
    }
    return count;
  }

  // ── Trips ──────────────────────────────────────────────────────────────────

  async upsertTrips(rows: GtfsTripRow[]): Promise<number> {
    let count = 0;
    for (const batch of chunk(rows, BATCH_SIZE)) {
      const values = batch.map((r) => ({
        trip_id:      r.trip_id,
        route_id:     r.route_id,
        service_id:   r.service_id,
        shape_id:     r.shape_id ?? null,
        direction_id: r.direction_id ?? 0,
        trip_headsign: r.trip_headsign ?? null,
      }));
      await this.sql`
        INSERT INTO trips ${this.sql(values, 'trip_id', 'route_id', 'service_id', 'shape_id', 'direction_id', 'trip_headsign')}
        ON CONFLICT (trip_id) DO UPDATE
          SET route_id     = EXCLUDED.route_id,
              service_id   = EXCLUDED.service_id,
              shape_id     = EXCLUDED.shape_id,
              direction_id = EXCLUDED.direction_id,
              trip_headsign = EXCLUDED.trip_headsign
      `;
      count += batch.length;
    }
    return count;
  }

  // ── Stop Times ─────────────────────────────────────────────────────────────

  async upsertStopTimes(rows: GtfsStopTimeRow[]): Promise<number> {
    let count = 0;
    for (const batch of chunk(rows, BATCH_SIZE)) {
      const values = batch.map((r) => ({
        trip_id:               r.trip_id,
        stop_id:               r.stop_id,
        stop_sequence:         r.stop_sequence,
        arrival_time_seconds:  gtfsTimeToSeconds(r.arrival_time),
        departure_time_seconds: gtfsTimeToSeconds(r.departure_time),
        shape_dist_traveled:   r.shape_dist_traveled ?? null,
      }));
      await this.sql`
        INSERT INTO stop_times ${this.sql(values, 'trip_id', 'stop_id', 'stop_sequence', 'arrival_time_seconds', 'departure_time_seconds', 'shape_dist_traveled')}
        ON CONFLICT (trip_id, stop_sequence) DO UPDATE
          SET stop_id                = EXCLUDED.stop_id,
              arrival_time_seconds   = EXCLUDED.arrival_time_seconds,
              departure_time_seconds = EXCLUDED.departure_time_seconds,
              shape_dist_traveled    = EXCLUDED.shape_dist_traveled
      `;
      count += batch.length;
    }
    return count;
  }

  // ── Shapes ─────────────────────────────────────────────────────────────────

  /**
   * Upserts raw shape points AND rebuilds `shape_lines` (the pre-aggregated
   * PostGIS LineString used by the map-matching engine).
   *
   * The shape_lines row is built with ST_MakeLine ordered by shape_pt_sequence.
   * The GIST index on shape_lines.geom is declared in migration 0001.
   */
  async upsertShapes(rows: GtfsShapeRow[]): Promise<number> {
    let count = 0;
    // Insert raw shape points
    for (const batch of chunk(rows, BATCH_SIZE)) {
      const values = batch.map((r) => ({
        shape_id:            r.shape_id,
        shape_pt_sequence:   r.shape_pt_sequence,
        shape_pt_lat:        r.shape_pt_lat,
        shape_pt_lon:        r.shape_pt_lon,
        shape_dist_traveled: r.shape_dist_traveled ?? null,
      }));
      await this.sql`
        INSERT INTO shapes ${this.sql(values, 'shape_id', 'shape_pt_sequence', 'shape_pt_lat', 'shape_pt_lon', 'shape_dist_traveled')}
        ON CONFLICT (shape_id, shape_pt_sequence) DO UPDATE
          SET shape_pt_lat        = EXCLUDED.shape_pt_lat,
              shape_pt_lon        = EXCLUDED.shape_pt_lon,
              shape_dist_traveled = EXCLUDED.shape_dist_traveled
      `;
      count += batch.length;
    }

    // Rebuild shape_lines for all shapes touched in this batch
    const shapeIds = [...new Set(rows.map((r) => r.shape_id))];
    for (const batch of chunk(shapeIds, 50)) {
      await this.sql`
        INSERT INTO shape_lines (shape_id, geom)
        SELECT
          shape_id,
          ST_MakeLine(
            ST_SetSRID(ST_MakePoint(shape_pt_lon, shape_pt_lat), 4326)
            ORDER BY shape_pt_sequence
          ) AS geom
        FROM shapes
        WHERE shape_id = ANY(${batch})
        GROUP BY shape_id
        ON CONFLICT (shape_id) DO UPDATE
          SET geom = EXCLUDED.geom
      `;
    }

    return count;
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  async getRouteCount(): Promise<number> {
    const [row] = await this.sql<[{ count: string }]>`SELECT COUNT(*)::text AS count FROM routes`;
    return parseInt(row?.count ?? '0', 10);
  }

  async getStopCount(): Promise<number> {
    const [row] = await this.sql<[{ count: string }]>`SELECT COUNT(*)::text AS count FROM stops`;
    return parseInt(row?.count ?? '0', 10);
  }
}

// ── Pure helper ───────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
