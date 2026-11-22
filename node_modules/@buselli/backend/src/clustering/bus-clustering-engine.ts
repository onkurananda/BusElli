import type { TelemetryPoint, BusCluster, ConfidenceScore } from '../eta/types.js';
import { makeConfidenceScore } from '../eta/types.js';

/** Maximum distance (metres) for two telemetry points to be in the same cluster. */
const MAX_CLUSTER_RADIUS_METERS = 100;

/** Minimum speed (km/h) above which a point is considered valid in city zones. */
const MAX_VALID_SPEED_KMH = 80;

/** Minimum stationary duration (ms) before a point is considered a parked outlier. */
const STATIONARY_OUTLIER_MS = 5 * 60 * 1000;

export interface ClusteringDeps {
  /** Wall-clock now — injected for testability. */
  now(): Date;
  /** Bus cluster TTL in seconds — evict clusters not updated within this window. */
  clusterTtlSeconds: number;
}

export interface ClusterPoint {
  readonly sessionId: string;
  readonly routeId: string;
  readonly lat: number;
  readonly lng: number;
  readonly speedKmh: number;
  readonly capturedAt: Date;
}

export interface ClusterResult {
  readonly clusterId: string;
  readonly routeId: string;
  readonly centroidLat: number;
  readonly centroidLng: number;
  readonly averageSpeedKmh: number;
  readonly riderCount: number;
  readonly confidence: ConfidenceScore;
  readonly lastUpdated: Date;
}

export class BusClusteringEngine {
  constructor(private readonly deps: ClusteringDeps) {}

  /**
   * Runs DBSCAN-style spatial clustering on a set of telemetry points
   * for a single route. Returns one ClusterResult per distinct bus detected.
   *
   * Rules enforced:
   *  - Points with speed > 80 km/h are rejected (GPS spoofing / flyover drift).
   *  - Points within MAX_CLUSTER_RADIUS_METERS are merged.
   *  - Single-rider results are returned with reduced confidence (< 0.5).
   *  - Points from different routes are never merged (guarded by routeId).
   */
  clusterPoints(points: ClusterPoint[]): ClusterResult[] {
    const valid = points.filter((p) => this.isValidPoint(p));
    if (valid.length === 0) return [];

    const visited = new Set<number>();
    const results: ClusterResult[] = [];

    for (let i = 0; i < valid.length; i++) {
      if (visited.has(i)) continue;

      const neighbors = this.findNeighbors(valid, i);
      visited.add(i);

      const clusterMembers: ClusterPoint[] = [valid[i]!];
      for (const j of neighbors) {
        if (!visited.has(j)) {
          visited.add(j);
          clusterMembers.push(valid[j]!);
        }
      }

      results.push(this.buildClusterResult(clusterMembers));
    }

    return results;
  }

  /**
   * Evicts clusters whose last-updated timestamp is older than clusterTtlSeconds.
   */
  evictStale(clusters: ClusterResult[]): ClusterResult[] {
    const now = this.deps.now();
    return clusters.filter((c) => {
      const ageSeconds = (now.getTime() - c.lastUpdated.getTime()) / 1000;
      return ageSeconds < this.deps.clusterTtlSeconds;
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private isValidPoint(point: ClusterPoint): boolean {
    // Reject GPS spoofing / flyover drift
    if (point.speedKmh > MAX_VALID_SPEED_KMH) return false;
    return true;
  }

  private findNeighbors(points: ClusterPoint[], centerIdx: number): number[] {
    const center = points[centerIdx]!;
    const neighbors: number[] = [];
    for (let i = 0; i < points.length; i++) {
      if (i === centerIdx) continue;
      if (points[i]!.routeId !== center.routeId) continue; // never merge across routes
      const dist = this.haversineMeters(center, points[i]!);
      if (dist <= MAX_CLUSTER_RADIUS_METERS) neighbors.push(i);
    }
    return neighbors;
  }

  private buildClusterResult(members: ClusterPoint[]): ClusterResult {
    const centroidLat = members.reduce((s, p) => s + p.lat, 0) / members.length;
    const centroidLng = members.reduce((s, p) => s + p.lng, 0) / members.length;
    const averageSpeedKmh =
      members.reduce((s, p) => s + p.speedKmh, 0) / members.length;
    const lastUpdated = members.reduce(
      (latest, p) => (p.capturedAt > latest ? p.capturedAt : latest),
      members[0]!.capturedAt,
    );

    // Confidence: multi-rider clusters earn higher base confidence
    const baseConfidence = members.length >= 2 ? 0.85 : 0.45;

    return {
      clusterId: crypto.randomUUID(),
      routeId: members[0]!.routeId,
      centroidLat,
      centroidLng,
      averageSpeedKmh,
      riderCount: members.length,
      confidence: makeConfidenceScore(baseConfidence),
      lastUpdated,
    };
  }

  /** Haversine distance in metres between two lat/lng points. */
  private haversineMeters(a: ClusterPoint, b: ClusterPoint): number {
    const R = 6_371_000;
    const dLat = this.toRad(b.lat - a.lat);
    const dLng = this.toRad(b.lng - a.lng);
    const lat1 = this.toRad(a.lat);
    const lat2 = this.toRad(b.lat);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  private toRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}
