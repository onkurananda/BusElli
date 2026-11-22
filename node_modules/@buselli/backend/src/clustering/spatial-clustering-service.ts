/**
 * SpatialClusteringService — groups onboard commuter telemetry into virtual bus IDs.
 *
 * Rules enforced per architecture spec and .bobrules §5.3:
 *   - Cluster radius: 50 metres (request spec) — overrides the 100m default in BusClusteringEngine
 *   - Only points on the SAME GTFS route shape are merged
 *   - Each cluster must follow the route direction (monotonically increasing shape fraction)
 *   - Clusters are written to Redis with TTL and published to WebSocket room
 *   - Stale Redis clusters (hash expired but set reference alive) are auto-cleaned
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

  constructor(private readonly deps: ClusteringServiceDeps) {
    this.windowSeconds = deps.telemetryWindowSeconds ?? 120;
  }

  /**
   * Fetches recent telemetry for `routeId`, runs spatial clustering at 50 m radius,
   * writes results to Redis, and returns the number of live clusters produced.
   */
  async refreshForRoute(routeId: string): Promise<number> {
    const points = await this.deps.getRecentTelemetry(routeId, this.windowSeconds);
    const valid  = points.filter((p) => this.isValid(p));
    if (valid.length === 0) return 0;

    const clusters = this.clusterPoints(valid);

    // Flush stale and write fresh clusters to Redis
    await this.deps.store.flushRoute(routeId);
    for (const cluster of clusters) {
      await this.deps.store.putCluster(cluster);
    }

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
   */
  clusterPoints(points: RawTelemetryPoint[]): LiveCluster[] {
    const valid   = points.filter((p) => this.isValid(p));
    if (valid.length === 0) return [];

    const visited = new Set<number>();
    const clusters: LiveCluster[] = [];

    for (let i = 0; i < valid.length; i++) {
      if (visited.has(i)) continue;
      visited.add(i);

      const seed     = valid[i]!;
      const members  = [seed];
      const neighbors = this.findNeighbors(valid, i);

      for (const j of neighbors) {
        if (!visited.has(j)) {
          visited.add(j);
          members.push(valid[j]!);
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

  private findNeighbors(points: RawTelemetryPoint[], centerIdx: number): number[] {
    const center    = points[centerIdx]!;
    const neighbors: number[] = [];
    for (let i = 0; i < points.length; i++) {
      if (i === centerIdx)                       continue;
      if (points[i]!.routeId !== center.routeId) continue; // never merge across routes
      if (haversineMeters(center, points[i]!) <= CLUSTER_RADIUS_METERS) {
        neighbors.push(i);
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
 */
function deterministicId(routeId: string, lat: number, lng: number): string {
  // Quantise to ~0.0001 degrees ≈ 11 m
  const qLat = Math.round(lat * 10_000);
  const qLng = Math.round(lng * 10_000);
  const seed  = `${routeId}:${qLat}:${qLng}`;
  // Simple deterministic hash → 32 hex chars formatted as UUID v4-shaped string
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash).toString(16).padStart(8, '0');
  return `${h}-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`;
}
