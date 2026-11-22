import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelemetryIngestService, type IngestDeps } from './telemetry-ingest-service.js';
import type { TelemetryRepository } from './telemetry-repository.js';
import type { SpatialClusteringService } from '../clustering/spatial-clustering-service.js';

const VALID_NOW = new Date('2024-08-15T07:00:00.000Z');

function makeValidRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: '123e4567-e89b-12d3-a456-426614174000',
    routeId: '500D',
    lat: 12.9165,
    lng: 77.6209,
    accuracyMeters: 15,
    speedKmh: 22,
    cellTowers: [],
    capturedAt: '2024-08-15T06:59:50.000Z',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<IngestDeps> = {}): IngestDeps {
  return {
    telemetryRepo: {
      insertBatch: vi.fn().mockResolvedValue(1),
      getRecentForRoute: vi.fn().mockResolvedValue([]),
    } as unknown as TelemetryRepository,
    clusteringService: {
      refreshForRoute: vi.fn().mockResolvedValue(2),
      clusterPoints: vi.fn().mockReturnValue([]),
    } as unknown as SpatialClusteringService,
    hasConsent: vi.fn().mockResolvedValue(true),
    now: vi.fn().mockReturnValue(VALID_NOW),
    ...overrides,
  };
}

describe('TelemetryIngestService.ingest', () => {
  it('returns ok result with cluster count on a valid payload', async () => {
    const deps = makeDeps();
    const svc = new TelemetryIngestService(deps);

    const result = await svc.ingest('user-001', makeValidRaw());

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.pointCount).toBe(1);
      expect(result.clustersRefreshed).toBe(2);
    }
    expect(deps.telemetryRepo.insertBatch).toHaveBeenCalledOnce();
    expect(deps.clusteringService.refreshForRoute).toHaveBeenCalledWith('500D');
  });

  it('returns validation_error when payload is malformed', async () => {
    const deps = makeDeps();
    const svc = new TelemetryIngestService(deps);

    const result = await svc.ingest('user-001', { bad: 'data' });

    expect(result.status).toBe('validation_error');
    expect(deps.telemetryRepo.insertBatch).not.toHaveBeenCalled();
  });

  it('returns consent_missing when user has no DPDP consent', async () => {
    const deps = makeDeps({ hasConsent: vi.fn().mockResolvedValue(false) });
    const svc = new TelemetryIngestService(deps);

    const result = await svc.ingest('user-no-consent', makeValidRaw());

    expect(result.status).toBe('consent_missing');
    expect(deps.telemetryRepo.insertBatch).not.toHaveBeenCalled();
  });

  it('returns error when DB insert throws', async () => {
    const deps = makeDeps({
      telemetryRepo: {
        insertBatch: vi.fn().mockRejectedValue(new Error('DB connection lost')),
        getRecentForRoute: vi.fn().mockResolvedValue([]),
      } as unknown as TelemetryRepository,
    });
    const svc = new TelemetryIngestService(deps);

    const result = await svc.ingest('user-001', makeValidRaw());

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.error).toContain('DB connection lost');
  });

  it('does not call refreshForRoute when persistence fails', async () => {
    const deps = makeDeps({
      telemetryRepo: {
        insertBatch: vi.fn().mockRejectedValue(new Error('timeout')),
        getRecentForRoute: vi.fn().mockResolvedValue([]),
      } as unknown as TelemetryRepository,
    });
    const svc = new TelemetryIngestService(deps);

    await svc.ingest('user-001', makeValidRaw());

    expect(deps.clusteringService.refreshForRoute).not.toHaveBeenCalled();
  });
});

describe('TelemetryIngestService.ingestBatch', () => {
  it('returns ok with correct point count for a batch of valid points', async () => {
    const deps = makeDeps();
    const svc = new TelemetryIngestService(deps);
    const batch = [makeValidRaw(), makeValidRaw({ routeId: '335E' })];

    const result = await svc.ingestBatch('user-001', batch);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.pointCount).toBe(2);
      // refreshForRoute called once per unique route
      expect(deps.clusteringService.refreshForRoute).toHaveBeenCalledWith('500D');
      expect(deps.clusteringService.refreshForRoute).toHaveBeenCalledWith('335E');
    }
  });

  it('filters invalid points from batch and processes remaining valid ones', async () => {
    const deps = makeDeps();
    const svc = new TelemetryIngestService(deps);
    const batch = [
      makeValidRaw(),           // valid
      { bad: 'payload' },       // invalid
      makeValidRaw(),           // valid
    ];

    const result = await svc.ingestBatch('user-001', batch);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.pointCount).toBe(2);
  });

  it('returns validation_error when ALL points in batch are invalid', async () => {
    const deps = makeDeps();
    const svc = new TelemetryIngestService(deps);

    const result = await svc.ingestBatch('user-001', [{ bad: 'a' }, { bad: 'b' }]);

    expect(result.status).toBe('validation_error');
  });

  it('returns consent_missing for batch if consent is not given', async () => {
    const deps = makeDeps({ hasConsent: vi.fn().mockResolvedValue(false) });
    const svc = new TelemetryIngestService(deps);

    const result = await svc.ingestBatch('user-no-consent', [makeValidRaw()]);

    expect(result.status).toBe('consent_missing');
  });
});
