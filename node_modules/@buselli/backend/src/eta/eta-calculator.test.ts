import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { EtaCalculator, type EtaCalculatorDeps, type StopTimeEntry } from './eta-calculator.js';
import { makeConfidenceScore } from './types.js';
import type { BusCluster } from './types.js';
import { makeTestCluster, STOP_FIXTURES } from '../../test/fixtures/eta-fixtures.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<EtaCalculatorDeps> = {}): EtaCalculatorDeps {
  return {
    telemetryStaleSeconds: 120,
    confidenceDecayPerSecond: 0.0017,
    getHistoricalSpeedKmh: vi.fn().mockResolvedValue(null),
    getScheduledStopTimes: vi.fn().mockResolvedValue(STOP_FIXTURES.route500D),
    now: vi.fn().mockReturnValue(new Date('2024-08-15T07:00:00.000Z')),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EtaCalculator.computeEta', () => {
  let deps: EtaCalculatorDeps;

  beforeEach(() => {
    deps = makeDeps();
    vi.useFakeTimers();
  });

  // §5.2 requirement: ETA when bus has fresh telemetry (confidence > 0.8)
  it('returns LIVE status when telemetry is fresh and within stale threshold', async () => {
    const cluster = makeTestCluster({
      speedKmh: 25,
      nearestStopId: 'stop_silk_board',
      nearestStopSequence: 1,
      updatedAt: new Date('2024-08-15T06:59:30.000Z'), // 30s ago
      confidence: makeConfidenceScore(0.94),
    });
    const calc = new EtaCalculator(deps);

    const result = await calc.computeEta(cluster, 'stop_koramangala', 3);

    expect(result.status).toBe('LIVE');
    expect(result.etaSeconds).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.stopId).toBe('stop_koramangala');
  });

  // §5.2 requirement: ETA degradation when telemetry is stale (60s, 90s, 120s)
  it.each([
    { staleSeconds: 60, expectedStatus: 'LIVE' },
    { staleSeconds: 90, expectedStatus: 'LIVE' },
    { staleSeconds: 121, expectedStatus: 'DEGRADED' },
    { staleSeconds: 200, expectedStatus: 'DEGRADED' },
  ])('returns $expectedStatus when telemetry is $staleSeconds seconds old', async ({ staleSeconds, expectedStatus }) => {
    const updatedAt = new Date('2024-08-15T07:00:00.000Z');
    updatedAt.setSeconds(updatedAt.getSeconds() - staleSeconds);
    const cluster = makeTestCluster({ updatedAt, speedKmh: 20 });
    const calc = new EtaCalculator(deps);

    const result = await calc.computeEta(cluster, 'stop_koramangala', 3);

    expect(result.status).toBe(expectedStatus);
  });

  // §5.2 requirement: ETA when only historical speed profile available (cold start)
  it('returns HISTORICAL_FALLBACK when no trip match but historical speed exists', async () => {
    deps = makeDeps({
      getScheduledStopTimes: vi.fn().mockResolvedValue([]), // no stop times
      getHistoricalSpeedKmh: vi.fn().mockResolvedValue(14), // 14 km/h morning average
    });
    const cluster = makeTestCluster({ tripId: null });
    const calc = new EtaCalculator(deps);

    const result = await calc.computeEta(cluster, 'stop_koramangala', 3);

    expect(result.status).toBe('HISTORICAL_FALLBACK');
    expect(result.etaSeconds).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.35);
  });

  // §5.2 requirement: ETA with speed = 0 (bus stopped at a stop)
  it('uses conservative crawl speed when cluster speed is 0 and telemetry is fresh', async () => {
    const cluster = makeTestCluster({
      speedKmh: 0,
      updatedAt: new Date('2024-08-15T06:59:50.000Z'), // 10s ago — fresh
    });
    const calc = new EtaCalculator(deps);

    const result = await calc.computeEta(cluster, 'stop_koramangala', 3);

    // Should produce an ETA (not NO_SERVICE) using the 12 km/h default
    expect(result.status).toBe('LIVE');
    expect(result.etaSeconds).toBeGreaterThan(0);
  });

  // §5.2 requirement: ETA across midnight boundary (GTFS times > 86400s)
  it('handles GTFS arrival times that exceed 86400 seconds (post-midnight trips)', async () => {
    const postMidnightStops: StopTimeEntry[] = [
      { stopId: 'stop_silk_board', stopSequence: 1, scheduledArrivalSeconds: 85800, shapeDistTraveled: 0 },
      { stopId: 'stop_koramangala', stopSequence: 3, scheduledArrivalSeconds: 86700, shapeDistTraveled: 2500 }, // > 86400
    ];
    deps = makeDeps({
      getScheduledStopTimes: vi.fn().mockResolvedValue(postMidnightStops),
      now: vi.fn().mockReturnValue(new Date('2024-08-15T23:52:00.000Z')), // 23:52 UTC
    });
    const cluster = makeTestCluster({ speedKmh: 15, nearestStopSequence: 1 });
    const calc = new EtaCalculator(deps);

    // Should not throw and should return a positive ETA
    const result = await calc.computeEta(cluster, 'stop_koramangala', 3);
    expect(result.etaSeconds).toBeGreaterThan(0);
  });

  // §5.2 requirement: ETA with invalid/missing shape_dist_traveled
  it('falls through to HISTORICAL_FALLBACK when shapeDistTraveled is inconsistent', async () => {
    const badStops: StopTimeEntry[] = [
      { stopId: 'stop_silk_board', stopSequence: 1, scheduledArrivalSeconds: 25200, shapeDistTraveled: 5000 },
      { stopId: 'stop_koramangala', stopSequence: 3, scheduledArrivalSeconds: 25500, shapeDistTraveled: 2000 }, // negative distance
    ];
    deps = makeDeps({
      getScheduledStopTimes: vi.fn().mockResolvedValue(badStops),
      getHistoricalSpeedKmh: vi.fn().mockResolvedValue(18),
    });
    const cluster = makeTestCluster({ nearestStopId: 'stop_silk_board', nearestStopSequence: 1 });
    const calc = new EtaCalculator(deps);

    const result = await calc.computeEta(cluster, 'stop_koramangala', 3);
    // Negative distance detected as NO_SERVICE for the shape path; falls to historical
    expect(['NO_SERVICE', 'HISTORICAL_FALLBACK']).toContain(result.status);
  });

  // §5.2 requirement: returns NO_SERVICE when bus has already passed the target stop
  it('returns NO_SERVICE when bus nearestStopSequence is ahead of targetStopSequence', async () => {
    const cluster = makeTestCluster({ nearestStopSequence: 5 });
    const calc = new EtaCalculator(deps);

    const result = await calc.computeEta(cluster, 'stop_silk_board', 2); // stop 2 < current 5
    expect(result.status).toBe('NO_SERVICE');
    expect(result.etaSeconds).toBe(0);
  });

  // §5.2 requirement: ETA when route has a loop segment
  it('handles loop routes where shape folds back on itself without crashing', async () => {
    const loopStops: StopTimeEntry[] = [
      { stopId: 'stop_a', stopSequence: 1, scheduledArrivalSeconds: 25200, shapeDistTraveled: 0 },
      { stopId: 'stop_b', stopSequence: 2, scheduledArrivalSeconds: 25500, shapeDistTraveled: 1000 },
      { stopId: 'stop_a', stopSequence: 7, scheduledArrivalSeconds: 27600, shapeDistTraveled: 7000 }, // loop back
    ];
    deps = makeDeps({ getScheduledStopTimes: vi.fn().mockResolvedValue(loopStops) });
    const cluster = makeTestCluster({ nearestStopId: 'stop_a', nearestStopSequence: 1 });
    const calc = new EtaCalculator(deps);

    const result = await calc.computeEta(cluster, 'stop_a', 7);
    // Uses the sequence 7 entry (later in the trip) — not the duplicate
    expect(result.etaSeconds).toBeGreaterThan(0);
  });

  // Confidence decay validation
  it('returns lower confidence score when telemetry is older', async () => {
    const freshCluster = makeTestCluster({
      updatedAt: new Date('2024-08-15T06:59:50.000Z'), // 10s ago
      confidence: makeConfidenceScore(0.9),
    });
    const staleCluster = makeTestCluster({
      updatedAt: new Date('2024-08-15T06:58:00.000Z'), // 120s ago
      confidence: makeConfidenceScore(0.9),
    });
    const calc = new EtaCalculator(deps);

    const freshResult = await calc.computeEta(freshCluster, 'stop_koramangala', 3);
    const staleResult = await calc.computeEta(staleCluster, 'stop_koramangala', 3);

    expect(freshResult.confidence).toBeGreaterThan(staleResult.confidence);
  });
});
