import { makeConfidenceScore } from '../../src/eta/types.js';
import type { BusCluster } from '../../src/eta/types.js';
import type { StopTimeEntry } from '../../src/eta/eta-calculator.js';

/** Pre-built stop time fixtures for Route 500D (Silk Board → KR Puram). */
export const STOP_FIXTURES = {
  route500D: [
    { stopId: 'stop_silk_board',    stopSequence: 1, scheduledArrivalSeconds: 25200, shapeDistTraveled: 0 },
    { stopId: 'stop_forum_mall',    stopSequence: 2, scheduledArrivalSeconds: 25500, shapeDistTraveled: 1200 },
    { stopId: 'stop_koramangala',   stopSequence: 3, scheduledArrivalSeconds: 25800, shapeDistTraveled: 2500 },
    { stopId: 'stop_koramangala_bda', stopSequence: 4, scheduledArrivalSeconds: 26100, shapeDistTraveled: 3600 },
    { stopId: 'stop_sony_world',    stopSequence: 5, scheduledArrivalSeconds: 26400, shapeDistTraveled: 4800 },
    { stopId: 'stop_domlur',        stopSequence: 6, scheduledArrivalSeconds: 26700, shapeDistTraveled: 5900 },
    { stopId: 'stop_indiranagar',   stopSequence: 7, scheduledArrivalSeconds: 27000, shapeDistTraveled: 7100 },
    { stopId: 'stop_marathahalli',  stopSequence: 8, scheduledArrivalSeconds: 28200, shapeDistTraveled: 12000 },
    { stopId: 'stop_spice_garden',  stopSequence: 9, scheduledArrivalSeconds: 28800, shapeDistTraveled: 14500 },
    { stopId: 'stop_kr_puram',      stopSequence: 10, scheduledArrivalSeconds: 29400, shapeDistTraveled: 17000 },
  ] satisfies StopTimeEntry[],
};

export function makeTestCluster(overrides: Partial<BusCluster> = {}): BusCluster {
  return {
    clusterId: 'test-cluster-001',
    routeId: '500D',
    tripId: 'trip_500D_morning_01',
    position: { lat: 12.9168, lng: 77.6101 },
    speedKmh: 22,
    nearestStopId: 'stop_silk_board',
    nearestStopSequence: 1,
    confidence: makeConfidenceScore(0.9),
    riderCount: 3,
    updatedAt: new Date('2024-08-15T06:59:50.000Z'), // 10s before "now" in tests
    ...overrides,
  };
}
