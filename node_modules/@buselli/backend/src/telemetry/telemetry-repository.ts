/**
 * TelemetryRepository — persists validated telemetry to PostgreSQL TimescaleDB.
 *
 * Writes to `telemetry_raw` (hypertable) using batched INSERTs.
 * user_id is encrypted with pgcrypto per .bobrules §7.
 */
import type postgres from 'postgres';
import type { ValidatedTelemetryPayload } from './telemetry-validator.js';

type Sql = ReturnType<typeof postgres>;

/** Symmetric encryption key for pgcrypto — loaded from env, never committed. */
export interface TelemetryRepoDeps {
  readonly sql: Sql;
  /** Symmetric key for pgcrypto.pgp_sym_encrypt — from env.JWT_SECRET or dedicated key. */
  readonly encryptionKey: string;
}

export interface StoredTelemetryPoint {
  readonly id: string;
  readonly sessionId: string;
  readonly routeId: string;
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number;
  readonly speedKmh: number | null;
  readonly capturedAt: Date;
}

export class TelemetryRepository {
  constructor(private readonly deps: TelemetryRepoDeps) {}

  /**
   * Persists a batch of validated telemetry points.
   * user_id is encrypted before storage per .bobrules §7.
   * Returns the count of successfully inserted rows.
   */
  async insertBatch(
    userId: string,
    points: ValidatedTelemetryPayload[],
  ): Promise<number> {
    if (points.length === 0) return 0;

    // Build values as individual inserts with pgcrypto encryption for user_id
    // postgres.js does not support per-row SQL fragments in bulk, so we use a
    // parameterised multi-row INSERT using UNNEST arrays for efficiency.
    const sessionIds  = points.map((p) => p.sessionId);
    const routeIds    = points.map((p) => p.routeId);
    const lats        = points.map((p) => p.lat);
    const lngs        = points.map((p) => p.lng);
    const accuracies  = points.map((p) => p.accuracyMeters);
    const speeds      = points.map((p) => p.speedKmh);
    const cellTowers  = points.map((p) => JSON.stringify(p.cellTowers));
    const capturedAts = points.map((p) => new Date(p.capturedAt));
    const key         = this.deps.encryptionKey;

    await this.deps.sql`
      INSERT INTO telemetry_raw
        (session_id, user_id_enc, route_id, lat, lng, accuracy_m, speed_kmh, cell_towers, captured_at)
      SELECT
        unnest(${sessionIds}::uuid[]),
        pgp_sym_encrypt(${userId}, ${key}),
        unnest(${routeIds}::text[]),
        unnest(${lats}::float8[]),
        unnest(${lngs}::float8[]),
        unnest(${accuracies}::float8[]),
        unnest(${speeds}::float8[]),
        unnest(${cellTowers}::jsonb[]),
        unnest(${capturedAts}::timestamptz[])
    `;

    return points.length;
  }

  /**
   * Fetches recent telemetry points for a route within the last `windowSeconds`.
   * Used by the clustering engine to gather live positions.
   * Per .bobrules §3.5: always includes a time-range predicate.
   */
  async getRecentForRoute(
    routeId: string,
    windowSeconds: number,
  ): Promise<StoredTelemetryPoint[]> {
    const rows = await this.deps.sql<StoredTelemetryPoint[]>`
      SELECT
        id::text,
        session_id::text AS "sessionId",
        route_id         AS "routeId",
        lat,
        lng,
        accuracy_m       AS "accuracyM",
        speed_kmh        AS "speedKmh",
        captured_at      AS "capturedAt"
      FROM telemetry_raw
      WHERE route_id = ${routeId}
        AND captured_at > NOW() - (${windowSeconds} * INTERVAL '1 second')
      ORDER BY captured_at DESC
    `;
    return rows;
  }
}
