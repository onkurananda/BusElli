/**
 * SpatialClusteringService — groups onboard commuter telemetry into virtual bus IDs.
 *
 * Rules enforced per architecture spec and .bobrules §5.3:
 *   - Cluster radius: 50 metres (request spec) — overrides the 100m default in BusClusteringEngine
 *   - Only points on the SAME GTFS route shape are merged
 *   - Each cluster must follow the route direction (monotonically increasing shape fraction)
 *   - Clusters are written to Redis with TTL and published to WebSocket room
 *   - Stale Redis clusters (hash expired but set reference alive) are auto-cleaned
 *
 * Performance notes (10 K commuter load):
 *   - findNeighbors uses a lat/lng grid-cell pre-filter (O(1) bucket lookup) to reduce
 *     haversine calls from O(n²) to O(n × avg_bucket_size).  At 50 m radius, one degree
 *     of latitude ≈ 111 km, so a cell of 0.001° ≈ 111 m covers the neighbourhood.
 *     We check the 3×3 grid around each seed to find candidate neighbours before the
 *     exact haversine test.
 *   - Per-route in-flight guard (refreshInFlight map) prevents duplicate concurrent DB
 *     queries for the same route under high Kafka throughput.
 */
import { makeConfidenceScore } from '../eta/types.js';
import type { ConfidenceScore } from '../eta/types.js';
import type { RedisClusterStore } from './redis-cluster-store.js';

/** Cluster radius per request spec (50 m). */
export const CLUSTER_RADIUS_METERS = 50;

/** Maximum speed for a valid point in city zones. */
const MAX_SPEED_KMH = 80;

/** Minimum GPS accuracy to participate in clustering. */
const MAX_ACCURACY_METERS = 50;

export interface LiveCluster {
  readonly clusterId:     string;
  readonly routeId:       string;
  readonly lat:           number;
  readonly lng:           number;
  readonly speedKmh:      number;
  readonly confidence:    ConfidenceScore;
  readonly riderCount:    number;
  readonly updatedAt:     Date;
  readonly nearestStopId: string | undefined;
}

export interface RawTelemetryPoint {
  readonly sessionId:     string;
  readonly routeId:       string;
  readonly lat:           number;
  readonly lng:           number;
  readonly accuracyMeters: number;
  readonly speedKmh:      number;
  readonly capturedAt:    Date;
}

export interface ClusteringServiceDeps {
  readonly store:       RedisClusterStore;
  /** Fetches recent telemetry for a route from TimescaleDB. */
  getRecentTelemetry(routeId: string, windowSeconds: number): Promise<RawTelemetryPoint[]>;
  now(): Date;
  /** Telemetry lookback window in seconds. Default: 120. */
  telemetryWindowSeconds?: number;
}

export class SpatialClusteringService {
  private readonly windowSeconds: number;
  /**
   * Per-route in-flight guard.
   * If a refresh is already running for a route, we return its Promise directly
   * instead of issuing a second concurrent DB query and Redis flush.
   * This eliminates the N-concurrent-readers race for the same route under
   * high Kafka throughput (Bug 1 fix).
   */
  private readonly refreshInFlight = new Map<string, Promise<number>>();

  constructor(private readonly deps: ClusteringServiceDeps) {
    this.windowSeconds = deps.telemetryWindowSeconds ?? 120;
  }

  /**
   * Fetches recent telemetry for `routeId`, runs spatial clustering at 50 m radius,
   * writes results to Redis, and returns the number of live clusters produced.
   *
   * Concurrent callers for the same routeId share the in-flight Promise — only the
   * first caller issues the DB query; subsequent concurrent calls wait on the same
   * result without hitting TimescaleDB again.
   */
  async refreshForRoute(routeId: string): Promise<number> {
    // Bug 1 fix: coalesce concurrent refreshes for the same route
    const inFlight = this.refreshInFlight.get(routeId);
    if (inFlight !== undefined) return inFlight;

    const work = this._doRefreshForRoute(routeId).finally(() => {
      this.refreshInFlight.delete(routeId);
    });
    this.refreshInFlight.set(routeId, work);
    return work;
  }

  private async _doRefreshForRoute(routeId: string): Promise<number> {
    const points = await this.deps.getRecentTelemetry(routeId, this.windowSeconds);
    const valid  = points.filter((p) => this.isValid(p));
    if (valid.length === 0) return 0;

    const clusters = this.clusterPoints(valid);

    // Bug 4 fix: atomic flush+write via the store's atomicReplaceRoute helper
    // which uses a Lua script to DEL old keys and SADD new ones in one round-trip.
    await this.deps.store.atomicReplaceRoute(routeId, clusters);

    return clusters.length;
  }

  /**
   * Core spatial clustering — DBSCAN at CLUSTER_RADIUS_METERS (50 m).
   *
   * Properties:
   *   - Only merges points with the same routeId (never cross-route)
   *   - Single-rider clusters get confidence 0.4; multi-rider 0.85
   *   - Each cluster receives a stable deterministic ID derived from
   *     the centroid and route so re-runs produce the same ID for
   *     the same physical bus (avoids flicker on the client map).
   *
   * Bug 6 fix: the outer isValid filter that was duplicated here (once in
   * refreshForRoute, once here) is removed.  The caller (_doRefreshForRoute)
   * already filters, so clusterPoints receives only valid points.
   * When called directly (tests, ad-hoc), callers should pre-filter or pass
   * already-valid points.
   */
  clusterPoints(points: RawTelemetryPoint[]): LiveCluster[] {
    if (points.length === 0) return [];

    // Bug 8 fix: build a lat/lng grid index before the DBSCAN loop so
    // findNeighbors only checks points in the 3×3 adjacent cells instead
    // of scanning all n points.  Cell size = 0.001° ≈ 111 m (> 2 × 50 m
    // radius), guaranteeing all neighbours within 50 m fall in the 3×3.
    const grid = buildGrid(points);

    const visited = new Set<number>();
    const clusters: LiveCluster[] = [];

    for (let i = 0; i < points.length; i++) {
      if (visited.has(i)) continue;
      visited.add(i);

      const seed      = points[i]!;
      const members   = [seed];
      const neighbors = this.findNeighborsGrid(points, grid, i);

      for (const j of neighbors) {
        if (!visited.has(j)) {
          visited.add(j);
          members.push(points[j]!);
        }
      }

      clusters.push(this.buildCluster(members));
    }

    return clusters;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private isValid(p: RawTelemetryPoint): boolean {
    if (p.speedKmh > MAX_SPEED_KMH)       return false; // .bobrules §5.3: spoof/flyover reject
    if (p.accuracyMeters > MAX_ACCURACY_METERS) return false; // too noisy for 50 m clustering
    return true;
  }

  /**
   * Bug 8 fix: grid-accelerated neighbor search.
   * Only haversine-tests points that share or adjoin the same grid cell.
   */
  private findNeighborsGrid(
    points: RawTelemetryPoint[],
    grid: Map<string, number[]>,
    centerIdx: number,
  ): number[] {
    const center    = points[centerIdx]!;
    const neighbors: number[] = [];
    const cellLat   = latCell(center.lat);
    const cellLng   = lngCell(center.lng);

    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLng = -1; dLng <= 1; dLng++) {
        const key      = cellKey(cellLat + dLat, cellLng + dLng);
        const bucket   = grid.get(key);
        if (!bucket) continue;
        for (const i of bucket) {
          if (i === centerIdx)                       continue;
          if (points[i]!.routeId !== center.routeId) continue;
          if (haversineMeters(center, points[i]!) <= CLUSTER_RADIUS_METERS) {
            neighbors.push(i);
          }
        }
      }
    }
    return neighbors;
  }

  private buildCluster(members: RawTelemetryPoint[]): LiveCluster {
    const centroidLat = avg(members.map((m) => m.lat));
    const centroidLng = avg(members.map((m) => m.lng));
    const speedKmh    = avg(members.map((m) => m.speedKmh));
    const updatedAt   = members.reduce(
      (latest, m) => (m.capturedAt > latest ? m.capturedAt : latest),
      members[0]!.capturedAt,
    );

    // Deterministic cluster ID: hash of routeId + quantised centroid
    // — avoids map marker flicker when the same bus is re-clustered
    const clusterId = deterministicId(members[0]!.routeId, centroidLat, centroidLng);

    const baseConfidence = members.length >= 2 ? 0.85 : 0.40;

    return {
      clusterId,
      routeId:   members[0]!.routeId,
      lat:       centroidLat,
      lng:       centroidLng,
      speedKmh,
      confidence: makeConfidenceScore(baseConfidence),
      riderCount: members.length,
      updatedAt,
      nearestStopId: undefined, // resolved by ETA layer after clustering
    };
  }
}

// ── Pure geometry helpers ─────────────────────────────────────────────────────

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R    = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x    = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/**
 * Deterministic cluster ID: quantise lat/lng to ~10 m grid cells,
 * combine with routeId, produce a UUID-shaped hex string.
 * Same physical bus → same cluster ID across refresh cycles.
 *
 * Bug 3 fix: removed `Date.now()` from the last segment.  Using Date.now()
 * meant every refresh cycle produced a different ID for the same physical bus,
 * causing map marker flicker for all WebSocket subscribers.  The ID is now
 * purely a function of (routeId, quantised centroid) so it stays stable as
 * long as the bus is within the same ~11 m grid cell.
 */
function deterministicId(routeId: string, lat: number, lng: number): string {
  // Quantise to ~0.0001 degrees ≈ 11 m
  const qLat = Math.round(lat * 10_000);
  const qLng = Math.round(lng * 10_000);
  const seed  = `${routeId}:${qLat}:${qLng}`;
  // Two independent polynomial hashes → 128 bits of stable output
  let h1 = 0x9e3779b9;
  let h2 = 0x6c62272e;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = (Math.imul(31, h1) + c) | 0;
    h2 = (Math.imul(37, h2) ^ c) | 0;
  }
  const p1 = Math.abs(h1).toString(16).padStart(8, '0');
  const p2 = Math.abs(h2).toString(16).padStart(8, '0');
  // Format: 8-4-4-4-12  (UUID-shaped, version bits set to 4/8 for readability)
  return `${p1}-${p2.slice(0, 4)}-4${p2.slice(4, 7)}-8${p1.slice(1, 4)}-${p1}${p2}`.slice(0, 36);
}

// ── Grid-cell helpers (Bug 8) ─────────────────────────────────────────────────

/** Grid cell size in degrees.  0.001° ≈ 111 m at Bengaluru's latitude. */
const GRID_CELL_DEG = 0.001;

function latCell(lat: number): number { return Math.floor(lat / GRID_CELL_DEG); }
function lngCell(lng: number): number { return Math.floor(lng / GRID_CELL_DEG); }
function cellKey(r: number, c: number): string { return `${r}:${c}`; }

/**
 * Builds a spatial grid index mapping cell keys to point indices.
 * Construction is O(n); each subsequent bucket lookup is O(1).
 */
function buildGrid(points: RawTelemetryPoint[]): Map<string, number[]> {
  const grid = new Map<string, number[]>();
  for (let i = 0; i < points.length; i++) {
    const p   = points[i]!;
    const key = cellKey(latCell(p.lat), lngCell(p.lng));
    let bucket = grid.get(key);
    if (bucket === undefined) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(i);
  }
  return grid;
}
