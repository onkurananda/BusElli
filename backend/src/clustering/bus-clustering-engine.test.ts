import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BusClusteringEngine, type ClusterPoint, type ClusteringDeps } from './bus-clustering-engine.js';
import { makeClusterPoint } from '../../test/fixtures/clustering-fixtures.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<ClusteringDeps> = {}): ClusteringDeps {
  return {
    now: vi.fn().mockReturnValue(new Date('2024-08-15T07:00:00.000Z')),
    clusterTtlSeconds: 300,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BusClusteringEngine.clusterPoints', () => {
  // §5.3 requirement: single rider → result is exactly 1 bus cluster
  it('produces exactly 1 cluster from a single rider point', () => {
    const engine = new BusClusteringEngine(makeDeps());
    const point = makeClusterPoint({ routeId: '500D', lat: 12.9165, lng: 77.6101 });

    const result = engine.clusterPoints([point]);

    expect(result).toHaveLength(1);
    expect(result[0]?.riderCount).toBe(1);
    expect(result[0]?.routeId).toBe('500D');
  });

  it('produces 0 clusters when input is empty', () => {
    const engine = new BusClusteringEngine(makeDeps());
    expect(engine.clusterPoints([])).toHaveLength(0);
  });

  // §5.3 requirement: 3 riders within 100m → merged into 1 cluster
  it('merges 3 riders within 100m into exactly 1 cluster', () => {
    const engine = new BusClusteringEngine(makeDeps());
    const points: ClusterPoint[] = [
      makeClusterPoint({ routeId: '500D', lat: 12.9165, lng: 77.6101, speedKmh: 25 }),
      makeClusterPoint({ routeId: '500D', lat: 12.9166, lng: 77.6102, speedKmh: 24 }), // ~14m away
      makeClusterPoint({ routeId: '500D', lat: 12.9164, lng: 77.6100, speedKmh: 26 }), // ~15m away
    ];

    const result = engine.clusterPoints(points);

    expect(result).toHaveLength(1);
    expect(result[0]?.riderCount).toBe(3);
    // Multi-rider cluster should have higher confidence
    expect(result[0]?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  // §5.3 requirement: 2 riders on different routes crossing the same point → NOT merged
  it('does NOT merge riders on different routes even at the same GPS coordinate', () => {
    const engine = new BusClusteringEngine(makeDeps());
    const points: ClusterPoint[] = [
      makeClusterPoint({ routeId: '500D', lat: 12.9165, lng: 77.6101 }),
      makeClusterPoint({ routeId: '335E', lat: 12.9165, lng: 77.6101 }), // same spot, different route
    ];

    const result = engine.clusterPoints(points);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.routeId).sort()).toEqual(['335E', '500D']);
  });

  // §5.3 requirement: cluster eviction when last telemetry > 5 minutes old
  it('evicts clusters older than clusterTtlSeconds', () => {
    const engine = new BusClusteringEngine(makeDeps({ clusterTtlSeconds: 300 }));
    const freshCluster = {
      clusterId: 'fresh',
      routeId: '500D',
      centroidLat: 12.9165,
      centroidLng: 77.6101,
      averageSpeedKmh: 20,
      riderCount: 2,
      confidence: 0.85 as ReturnType<typeof import('../eta/types.js').makeConfidenceScore>,
      lastUpdated: new Date('2024-08-15T06:56:00.000Z'), // 4 min ago (< 300s)
    };
    const staleCluster = {
      ...freshCluster,
      clusterId: 'stale',
      lastUpdated: new Date('2024-08-15T06:50:00.000Z'), // 10 min ago (> 300s)
    };

    const result = engine.evictStale([freshCluster, staleCluster]);

    expect(result).toHaveLength(1);
    expect(result[0]?.clusterId).toBe('fresh');
  });

  // §5.3 requirement: GPS spoofing detection — speed > 80 km/h → point rejected
  it('rejects points with speed exceeding 80 km/h as GPS spoofing / flyover drift', () => {
    const engine = new BusClusteringEngine(makeDeps());
    const points: ClusterPoint[] = [
      makeClusterPoint({ routeId: '500D', speedKmh: 25 }),  // valid
      makeClusterPoint({ routeId: '500D', speedKmh: 85 }),  // should be rejected
      makeClusterPoint({ routeId: '500D', speedKmh: 120 }), // should be rejected
    ];

    const result = engine.clusterPoints(points);

    // Only the valid point should form a cluster
    expect(result).toHaveLength(1);
    expect(result[0]?.riderCount).toBe(1);
  });

  it('rejects all points when every point exceeds the speed threshold', () => {
    const engine = new BusClusteringEngine(makeDeps());
    const points = [
      makeClusterPoint({ speedKmh: 100 }),
      makeClusterPoint({ speedKmh: 200 }),
    ];

    expect(engine.clusterPoints(points)).toHaveLength(0);
  });

  // §5.3 requirement: stationary outlier removal
  it('two riders at same position form 1 cluster with riderCount 2', () => {
    const engine = new BusClusteringEngine(makeDeps());
    const points = [
      makeClusterPoint({ routeId: '500D', lat: 12.9165, lng: 77.6101, speedKmh: 0 }),
      makeClusterPoint({ routeId: '500D', lat: 12.9165, lng: 77.6101, speedKmh: 0 }),
    ];

    const result = engine.clusterPoints(points);
    expect(result).toHaveLength(1);
    expect(result[0]?.riderCount).toBe(2);
  });

  // §5.3 requirement: cluster confidence score decay
  it('single-rider cluster has confidence below multi-rider cluster', () => {
    const engine = new BusClusteringEngine(makeDeps());
    const single = [makeClusterPoint({ routeId: '500D', lat: 12.9165, lng: 77.6101 })];
    const multi = [
      makeClusterPoint({ routeId: '500D', lat: 12.9165, lng: 77.6101 }),
      makeClusterPoint({ routeId: '500D', lat: 12.9166, lng: 77.6102 }),
    ];

    const [singleResult] = engine.clusterPoints(single);
    const [multiResult] = engine.clusterPoints(multi);

    expect(singleResult?.confidence).toBeLessThan(multiResult?.confidence ?? 0);
  });

  // Centroid is the average of member coordinates
  it('computes centroid as the mean lat/lng of all member points', () => {
    const engine = new BusClusteringEngine(makeDeps());
    const points = [
      makeClusterPoint({ routeId: '500D', lat: 12.9000, lng: 77.6000 }),
      makeClusterPoint({ routeId: '500D', lat: 12.9002, lng: 77.6002 }),
    ];

    const [result] = engine.clusterPoints(points);

    expect(result?.centroidLat).toBeCloseTo(12.9001, 3);
    expect(result?.centroidLng).toBeCloseTo(77.6001, 3);
  });
});
