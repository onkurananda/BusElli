import { describe, it, expect } from 'vitest';
import { validateTelemetryPayload } from './telemetry-validator.js';

const VALID_NOW = new Date('2024-08-15T07:00:00.000Z');

function makeValidPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: '123e4567-e89b-12d3-a456-426614174000',
    routeId: '500D',
    lat: 12.9165,
    lng: 77.6209,
    accuracyMeters: 15,
    speedKmh: 22,
    cellTowers: [{ mcc: 404, mnc: 20, lac: 12345, cellId: 67890 }],
    capturedAt: '2024-08-15T06:59:50.000Z', // 10s before VALID_NOW
    ...overrides,
  };
}

describe('validateTelemetryPayload', () => {
  it('accepts a fully valid payload', () => {
    const result = validateTelemetryPayload(makeValidPayload(), VALID_NOW);
    expect(result.ok).toBe(true);
  });

  it('accepts null speedKmh (cell-tower only point)', () => {
    const result = validateTelemetryPayload(makeValidPayload({ speedKmh: null }), VALID_NOW);
    expect(result.ok).toBe(true);
  });

  it('accepts empty cellTowers array', () => {
    const result = validateTelemetryPayload(makeValidPayload({ cellTowers: [] }), VALID_NOW);
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid sessionId (not a UUID)', () => {
    const result = validateTelemetryPayload(makeValidPayload({ sessionId: 'not-a-uuid' }), VALID_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('sessionId');
  });

  it('rejects lat outside [-90, 90]', () => {
    const result = validateTelemetryPayload(makeValidPayload({ lat: 95 }), VALID_NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects lng outside [-180, 180]', () => {
    const result = validateTelemetryPayload(makeValidPayload({ lng: 200 }), VALID_NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects capturedAt from the future (> 30s ahead)', () => {
    const future = new Date(VALID_NOW.getTime() + 60_000).toISOString();
    const result = validateTelemetryPayload(makeValidPayload({ capturedAt: future }), VALID_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('future');
  });

  it('allows capturedAt up to 30s in the future (clock skew tolerance)', () => {
    const nearFuture = new Date(VALID_NOW.getTime() + 25_000).toISOString();
    const result = validateTelemetryPayload(makeValidPayload({ capturedAt: nearFuture }), VALID_NOW);
    expect(result.ok).toBe(true);
  });

  it('rejects telemetry older than 300 seconds', () => {
    const stale = new Date(VALID_NOW.getTime() - 301_000).toISOString();
    const result = validateTelemetryPayload(makeValidPayload({ capturedAt: stale }), VALID_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('old');
  });

  it('rejects speedKmh exceeding 80 km/h (server-side .bobrules §4.1 check)', () => {
    const result = validateTelemetryPayload(makeValidPayload({ speedKmh: 85 }), VALID_NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('80');
  });

  it('accepts speedKmh exactly at the 80 km/h boundary', () => {
    const result = validateTelemetryPayload(makeValidPayload({ speedKmh: 80 }), VALID_NOW);
    expect(result.ok).toBe(true);
  });

  it('rejects a missing required field (routeId)', () => {
    const { routeId: _, ...noRoute } = makeValidPayload();
    const result = validateTelemetryPayload(noRoute, VALID_NOW);
    expect(result.ok).toBe(false);
  });

  it('rejects a cell tower with an out-of-range MCC', () => {
    const result = validateTelemetryPayload(
      makeValidPayload({ cellTowers: [{ mcc: 1000, mnc: 20, lac: 1, cellId: 1 }] }),
      VALID_NOW,
    );
    expect(result.ok).toBe(false);
  });
});
