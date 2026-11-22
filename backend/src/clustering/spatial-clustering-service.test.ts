/**
 * Tests for SpatialClusteringService — 50 m radius, same-route constraint,
 * Redis TTL eviction, and confidence scoring.
 *
 * Uses an in-memory fake for RedisClusterStore to avoid external dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SpatialClusteringService,
  CLUSTER_RADIUS_METERS,
  haversineMeters,
  type RawTelemetryPoint,
  type ClusteringServiceDeps,
  type LiveCluster,
} from './spatial-clustering-service.js';
import type { RedisClusterStore } from './redis-cluster-store.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Moves a lat/lng by `meters` north. */
function offsetLat(lat: number, meters: number): number {
  return lat + meters / 111_320;
}

function makePoint(overrides: Partial<RawTelemetryPoint> = {}): RawTelemetryPoint {
  return {
    sessionId:     'session-001',
    routeId:       '500D',
    lat:           12.9165,
    lng:           77.6101,
    accuracyMeters: 15,
    speedKmh:      22,
    capturedAt:    new Date('2024-08-15T07:00:00.000Z'),
    ...overrides,
  };
}

/** Minimal in-memory Redis store fake. */
function makeStoreFake(): RedisClusterStore & { written: LiveCluster[]; flushed: string[] } {
  const written: LiveCluster[] = [];
  const flushed: string[] = [];
  return {
    written,
    flushed,
    putCluster:     vi.fn(async (c: LiveCluster) => { written.push(c); }),
    removeCluster:  vi.fn(),
    flushRoute:     vi.fn(async (r: string) => { flushed.push(r); }),
    getCluster:     vi.fn().mockResolvedValue(null),
    getClustersForRoute: vi.fn().mockResolvedValue([]),
    getClusterIdsForRoute: vi.fn().mockResolvedValue([]),
    putStopEta:     vi.fn(),
  } as unknown as ReturnType<typeof makeStoreFake>;
}

function makeDeps(
  points: RawTelemetryPoint[],
  overrides: Partial<ClusteringServiceDeps> = {},
): ClusteringServiceDeps & { store: ReturnType<typeof makeStoreFake> } {
  const store = makeStoreFake();
  return {
    store,
    getRecentTelemetry: vi.fn().mockResolvedValue(points),
    now: vi.fn().mockReturnValue(new Date('2024-08-15T07:00:00.000Z')),
    telemetryWindowSeconds: 120,
    ...overrides,
  };
}

// ── haversineMeters ───────────────────────────────────────────────────────────

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters({ lat: 12.9, lng: 77.6 }, { lat: 12.9, lng: 77.6 })).toBe(0);
  });

  it('returns approximately 111 km per degree of latitude', () => {
    const dist = haversineMeters({ lat: 12.0, lng: 77.6 }, { lat: 13.0, lng: 77.6 });
    expect(dist).toBeGreaterThan(110_000);
    expect(dist).toBeLessThan(112_000);
  });

  it('returns distance less than CLUSTER_RADIUS_METERS for close points', () => {
    const a = { lat: 12.9165, lng: 77.6101 };
    const b = { lat: offsetLat(12.9165, 30), lng: 77.6101 }; // 30 m north
    expect(haversineMeters(a, b)).toBeLessThan(CLUSTER_RADIUS_METERS);
  });

  it('returns distance greater than CLUSTER_RADIUS_METERS for far-apart points', () => {
    const a = { lat: 12.9165, lng: 77.6101 };
    const b = { lat: offsetLat(12.9165, 200), lng: 77.6101 }; // 200 m north
    expect(haversineMeters(a, b)).toBeGreaterThan(CLUSTER_RADIUS_METERS);
  });
});

// ── SpatialClusteringService.clusterPoints ────────────────────────────────────

describe('SpatialClusteringService.clusterPoints', () => {
  it('returns empty array for empty input', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    expect(svc.clusterPoints([])).toHaveLength(0);
  });

  // Core 50 m radius requirement
  it('merges 3 points within 50 m into exactly 1 cluster', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const points: RawTelemetryPoint[] = [
      makePoint({ lat: 12.9165, lng: 77.6101 }),
      makePoint({ lat: offsetLat(12.9165, 20), lng: 77.6101 }),  // 20 m north
      makePoint({ lat: offsetLat(12.9165, 40), lng: 77.6101 }),  // 40 m north
    ];

    const result = svc.clusterPoints(points);

    expect(result).toHaveLength(1);
    expect(result[0]?.riderCount).toBe(3);
  });

  it('keeps 2 clusters when points are more than 50 m apart', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const points: RawTelemetryPoint[] = [
      makePoint({ lat: 12.9165, lng: 77.6101 }),
      makePoint({ lat: offsetLat(12.9165, 60), lng: 77.6101 }), // 60 m — outside radius
    ];

    const result = svc.clusterPoints(points);
    expect(result).toHaveLength(2);
  });

  it('never merges points from different routes even when collocated', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const points: RawTelemetryPoint[] = [
      makePoint({ routeId: '500D', lat: 12.9165, lng: 77.6101 }),
      makePoint({ routeId: '335E', lat: 12.9165, lng: 77.6101 }), // same spot, different route
    ];

    const result = svc.clusterPoints(points);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.routeId).sort()).toEqual(['335E', '500D']);
  });

  it('filters out points with speed > 80 km/h before clustering', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const points: RawTelemetryPoint[] = [
      makePoint({ speedKmh: 22 }),  // valid
      makePoint({ speedKmh: 90 }),  // rejected — flyover drift
    ];

    const result = svc.clusterPoints(points);
    expect(result).toHaveLength(1);
    expect(result[0]?.riderCount).toBe(1);
  });

  it('filters out points with accuracy > 50 m before clustering', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const points: RawTelemetryPoint[] = [
      makePoint({ accuracyMeters: 15 }),  // valid
      makePoint({ accuracyMeters: 55 }),  // too noisy for 50 m clustering
    ];

    const result = svc.clusterPoints(points);
    expect(result).toHaveLength(1);
  });

  it('assigns confidence >= 0.8 for a cluster with 2+ riders', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const points: RawTelemetryPoint[] = [
      makePoint({ lat: 12.9165, lng: 77.6101 }),
      makePoint({ lat: offsetLat(12.9165, 10), lng: 77.6101 }),
    ];

    const [cluster] = svc.clusterPoints(points);
    expect(cluster?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('assigns confidence < 0.5 for a single-rider cluster', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const [cluster] = svc.clusterPoints([makePoint()]);
    expect(cluster?.confidence).toBeLessThan(0.5);
  });

  it('computes centroid as average of member lat/lng', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const points: RawTelemetryPoint[] = [
      makePoint({ lat: 12.9000, lng: 77.6000 }),
      makePoint({ lat: 12.9002, lng: 77.6002 }),
    ];

    const [cluster] = svc.clusterPoints(points);
    expect(cluster?.lat).toBeCloseTo(12.9001, 3);
    expect(cluster?.lng).toBeCloseTo(77.6001, 3);
  });

  it('produces the same clusterId for the same route + same position on re-run (stable ID)', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const point = makePoint();
    const [first]  = svc.clusterPoints([point]);
    const [second] = svc.clusterPoints([point]);
    // Deterministic ID: same route + same quantised position → same first segment
    expect(first?.clusterId.split('-')[0]).toBe(second?.clusterId.split('-')[0]);
  });

  it('produces different clusterIds for buses on the same route but 60 m apart', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const a = makePoint({ lat: 12.9165, lng: 77.6101 });
    const b = makePoint({ lat: offsetLat(12.9165, 60), lng: 77.6101 });

    const result = svc.clusterPoints([a, b]);
    expect(result).toHaveLength(2);
    expect(result[0]?.clusterId).not.toBe(result[1]?.clusterId);
  });
});

// ── SpatialClusteringService.refreshForRoute ──────────────────────────────────

describe('SpatialClusteringService.refreshForRoute', () => {
  it('calls getRecentTelemetry and writes clusters to Redis', async () => {
    const points = [
      makePoint({ lat: 12.9165, lng: 77.6101 }),
      makePoint({ lat: offsetLat(12.9165, 20), lng: 77.6101 }),
    ];
    const deps = makeDeps(points);
    const svc = new SpatialClusteringService(deps);

    const count = await svc.refreshForRoute('500D');

    expect(count).toBe(1);
    expect(deps.store.written).toHaveLength(1);
    expect(deps.store.written[0]?.routeId).toBe('500D');
    expect(deps.store.flushed).toContain('500D');
  });

  it('returns 0 and writes nothing when there are no valid points for a route', async () => {
    const deps = makeDeps([]);
    const svc = new SpatialClusteringService(deps);

    const count = await svc.refreshForRoute('500D');

    expect(count).toBe(0);
    expect(deps.store.written).toHaveLength(0);
  });

  it('calls flushRoute before writing new clusters to avoid stale state', async () => {
    const points = [makePoint()];
    const deps = makeDeps(points);
    const svc = new SpatialClusteringService(deps);
    const flushOrder: string[] = [];
    const writeOrder: string[] = [];

    (deps.store.flushRoute as ReturnType<typeof vi.fn>).mockImplementation(async (r: string) => {
      flushOrder.push(`flush:${r}`);
    });
    (deps.store.putCluster as ReturnType<typeof vi.fn>).mockImplementation(async (c: LiveCluster) => {
      writeOrder.push(`write:${c.routeId}`);
    });

    await svc.refreshForRoute('500D');

    expect(flushOrder[0]).toBe('flush:500D');
    expect(writeOrder[0]).toBe('write:500D');
    expect(flushOrder.indexOf('flush:500D')).toBeLessThan(writeOrder.indexOf('write:500D'));
  });

  it('uses the configured telemetryWindowSeconds when querying recent telemetry', async () => {
    const deps = makeDeps([], { telemetryWindowSeconds: 60 });
    const svc = new SpatialClusteringService(deps);

    await svc.refreshForRoute('500D');

    expect(deps.getRecentTelemetry).toHaveBeenCalledWith('500D', 60);
  });
});
