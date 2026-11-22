/**
 * Tests for SpatialClusteringService — 50 m radius, same-route constraint,
 * Redis TTL eviction, confidence scoring, deterministic IDs, and performance fixes.
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
    sessionId:      'session-001',
    routeId:        '500D',
    lat:            12.9165,
    lng:            77.6101,
    accuracyMeters: 15,
    speedKmh:       22,
    capturedAt:     new Date('2024-08-15T07:00:00.000Z'),
    ...overrides,
  };
}

/** Minimal in-memory Redis store fake — now tracks atomicReplaceRoute calls. */
function makeStoreFake(): RedisClusterStore & {
  replaced: Array<{ routeId: string; clusters: readonly LiveCluster[] }>;
  flushed:  string[];
} {
  const replaced: Array<{ routeId: string; clusters: readonly LiveCluster[] }> = [];
  const flushed: string[] = [];
  return {
    replaced,
    flushed,
    atomicReplaceRoute: vi.fn(async (routeId: string, clusters: readonly LiveCluster[]) => {
      replaced.push({ routeId, clusters });
    }),
    putCluster:            vi.fn(),
    removeCluster:         vi.fn(),
    flushRoute:            vi.fn(async (r: string) => { flushed.push(r); }),
    getCluster:            vi.fn().mockResolvedValue(null),
    getClustersForRoute:   vi.fn().mockResolvedValue([]),
    getClusterIdsForRoute: vi.fn().mockResolvedValue([]),
    putStopEta:            vi.fn(),
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

  /**
   * Bug 6 regression: clusterPoints no longer runs isValid internally.
   * The caller (_doRefreshForRoute) pre-filters.  When called directly
   * with invalid points they pass through — this is intentional (caller
   * responsibility).  Verify the old duplicate filter is GONE by checking
   * that clusterPoints does NOT silently drop invalid points.
   */
  it('does not silently filter invalid points when called directly (caller responsibility)', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const points: RawTelemetryPoint[] = [
      makePoint({ speedKmh: 90 }),  // would be filtered by isValid — but clusterPoints no longer does it
    ];

    // clusterPoints should return 1 cluster (the invalid point is clustered as-is)
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

  /**
   * Bug 3 regression: deterministicId must NOT embed Date.now().
   * The same route + same quantised position must produce the identical
   * full cluster ID on every call, not just the first segment.
   */
  it('produces the identical full clusterId on re-run for the same position (Bug 3 fix)', () => {
    const svc   = new SpatialClusteringService(makeDeps([]));
    const point = makePoint();
    const [first]  = svc.clusterPoints([point]);
    const [second] = svc.clusterPoints([point]);
    // Full ID must be stable — not just the first segment
    expect(first?.clusterId).toBe(second?.clusterId);
  });

  it('produces different clusterIds for buses on the same route but 60 m apart', () => {
    const svc = new SpatialClusteringService(makeDeps([]));
    const a = makePoint({ lat: 12.9165, lng: 77.6101 });
    const b = makePoint({ lat: offsetLat(12.9165, 60), lng: 77.6101 });

    const result = svc.clusterPoints([a, b]);
    expect(result).toHaveLength(2);
    expect(result[0]?.clusterId).not.toBe(result[1]?.clusterId);
  });

  /**
   * Bug 8 regression: grid-cell pre-filter must still produce correct clustering
   * results for a large set of densely packed points (500 points in 3 clusters).
   */
  it('correctly clusters 500 points across 3 known bus positions (grid-cell pre-filter correctness)', () => {
    const svc = new SpatialClusteringService(makeDeps([]));

    // Bus A at stop 1 — 200 riders within 40 m
    const busA = Array.from({ length: 200 }, (_, i) =>
      makePoint({ lat: 12.9165 + (i % 10) * 0.00001, lng: 77.6101 }),
    );
    // Bus B at stop 2, 500 m north — 200 riders within 40 m
    const busB = Array.from({ length: 200 }, (_, i) =>
      makePoint({ lat: 12.9210 + (i % 10) * 0.00001, lng: 77.6101 }),
    );
    // Bus C at stop 3, further north — 100 riders
    const busC = Array.from({ length: 100 }, (_, i) =>
      makePoint({ lat: 12.9300 + (i % 5) * 0.00001, lng: 77.6101 }),
    );

    const result = svc.clusterPoints([...busA, ...busB, ...busC]);

    // Should produce exactly 3 clusters — one per bus location
    expect(result).toHaveLength(3);
    const totalRiders = result.reduce((s, c) => s + c.riderCount, 0);
    expect(totalRiders).toBe(500);
  });
});

// ── SpatialClusteringService.refreshForRoute ──────────────────────────────────

describe('SpatialClusteringService.refreshForRoute', () => {
  it('calls getRecentTelemetry and writes clusters via atomicReplaceRoute', async () => {
    const points = [
      makePoint({ lat: 12.9165, lng: 77.6101 }),
      makePoint({ lat: offsetLat(12.9165, 20), lng: 77.6101 }),
    ];
    const deps = makeDeps(points);
    const svc  = new SpatialClusteringService(deps);

    const count = await svc.refreshForRoute('500D');

    expect(count).toBe(1);
    expect(deps.store.atomicReplaceRoute).toHaveBeenCalledOnce();
    expect(deps.store.atomicReplaceRoute).toHaveBeenCalledWith(
      '500D',
      expect.arrayContaining([expect.objectContaining({ routeId: '500D' })]),
    );
    // Legacy flushRoute + putCluster should NOT be called by the new code path
    expect(deps.store.flushRoute).not.toHaveBeenCalled();
    expect(deps.store.putCluster).not.toHaveBeenCalled();
  });

  it('returns 0 and writes nothing when there are no valid points for a route', async () => {
    const deps = makeDeps([]);
    const svc  = new SpatialClusteringService(deps);

    const count = await svc.refreshForRoute('500D');

    expect(count).toBe(0);
    expect(deps.store.atomicReplaceRoute).not.toHaveBeenCalled();
  });

  /**
   * refreshForRoute must still filter via isValid before clustering —
   * it pre-filters, then passes only valid points to clusterPoints.
   */
  it('pre-filters invalid points (speed, accuracy) before calling clusterPoints', async () => {
    const points = [
      makePoint({ speedKmh: 22 }),   // valid
      makePoint({ speedKmh: 90 }),   // rejected — flyover
      makePoint({ accuracyMeters: 55 }), // rejected — too noisy
    ];
    const deps = makeDeps(points);
    const svc  = new SpatialClusteringService(deps);

    const count = await svc.refreshForRoute('500D');

    // Only 1 valid point → 1 single-rider cluster
    expect(count).toBe(1);
    const replaced = (deps.store.replaced as Array<{ routeId: string; clusters: readonly LiveCluster[] }>);
    expect(replaced[0]?.clusters).toHaveLength(1);
    expect(replaced[0]?.clusters[0]?.riderCount).toBe(1);
  });

  it('uses the configured telemetryWindowSeconds when querying recent telemetry', async () => {
    const deps = makeDeps([], { telemetryWindowSeconds: 60 });
    const svc  = new SpatialClusteringService(deps);

    await svc.refreshForRoute('500D');

    expect(deps.getRecentTelemetry).toHaveBeenCalledWith('500D', 60);
  });

  /**
   * Bug 1 regression: concurrent calls for the same routeId must share the
   * in-flight Promise — getRecentTelemetry should be called only ONCE even
   * when 10 concurrent callers all hit refreshForRoute('500D') simultaneously.
   */
  it('coalesces concurrent refreshForRoute calls for the same route (Bug 1 fix)', async () => {
    const points = [makePoint()];
    const deps   = makeDeps(points);
    const svc    = new SpatialClusteringService(deps);

    // Fire 10 concurrent calls for the same route
    const results = await Promise.all(
      Array.from({ length: 10 }, () => svc.refreshForRoute('500D')),
    );

    // All 10 callers receive the same result
    expect(results.every((r) => r === results[0])).toBe(true);
    // But getRecentTelemetry was only called once (in-flight guard coalesced the rest)
    expect(deps.getRecentTelemetry).toHaveBeenCalledOnce();
    // atomicReplaceRoute also called only once
    expect(deps.store.atomicReplaceRoute).toHaveBeenCalledOnce();
  });

  it('allows a fresh refresh after the in-flight guard clears', async () => {
    const points = [makePoint()];
    const deps   = makeDeps(points);
    const svc    = new SpatialClusteringService(deps);

    await svc.refreshForRoute('500D');
    await svc.refreshForRoute('500D'); // second independent call after first completes

    expect(deps.getRecentTelemetry).toHaveBeenCalledTimes(2);
  });

  it('runs concurrent refreshes for different routes independently', async () => {
    const deps500D = makeDeps([makePoint({ routeId: '500D' })]);
    const deps335E = makeDeps([makePoint({ routeId: '335E' })]);

    // Shared store mock
    const store = makeStoreFake();
    deps500D.store = store as unknown as typeof deps500D.store;
    deps335E.store = store as unknown as typeof deps335E.store;

    const svc500D = new SpatialClusteringService(deps500D);
    const svc335E = new SpatialClusteringService(deps335E);

    const [r1, r2] = await Promise.all([
      svc500D.refreshForRoute('500D'),
      svc335E.refreshForRoute('335E'),
    ]);

    expect(r1).toBe(1);
    expect(r2).toBe(1);
    expect(store.atomicReplaceRoute).toHaveBeenCalledTimes(2);
  });
});
