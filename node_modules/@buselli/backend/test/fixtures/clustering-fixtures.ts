import type { ClusterPoint } from '../../src/clustering/bus-clustering-engine.js';

let _seq = 0;

export function makeClusterPoint(overrides: Partial<ClusterPoint> = {}): ClusterPoint {
  _seq++;
  return {
    sessionId: `session-${_seq.toString().padStart(4, '0')}`,
    routeId: '500D',
    lat: 12.9165,
    lng: 77.6101,
    speedKmh: 22,
    capturedAt: new Date('2024-08-15T06:59:50.000Z'),
    ...overrides,
  };
}
