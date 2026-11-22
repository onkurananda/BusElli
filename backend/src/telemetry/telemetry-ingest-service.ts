/**
 * TelemetryIngestService — the main entry point for the telemetry pipeline.
 *
 * Flow:
 *   1. Validate the raw payload (TelemetryValidator)
 *   2. Check DPDP consent exists for this user (.bobrules §7)
 *   3. Persist to telemetry_raw (TelemetryRepository)
 *   4. Fire the clustering pipeline for the affected route
 *
 * This service is called by both the HTTP handler and the Kafka consumer.
 */
import type { ValidatedTelemetryPayload } from './telemetry-validator.js';
import { validateTelemetryPayload } from './telemetry-validator.js';
import type { TelemetryRepository } from './telemetry-repository.js';
import type { SpatialClusteringService } from '../clustering/spatial-clustering-service.js';

export interface IngestDeps {
  readonly telemetryRepo: TelemetryRepository;
  readonly clusteringService: SpatialClusteringService;
  /** Checks whether the user has given location consent (DPDP Act 2023). */
  hasConsent(userId: string): Promise<boolean>;
  now(): Date;
}

export type IngestResult =
  | { status: 'ok'; pointCount: number; clustersRefreshed: number }
  | { status: 'validation_error'; error: string }
  | { status: 'consent_missing' }
  | { status: 'error'; error: string };

export class TelemetryIngestService {
  constructor(private readonly deps: IngestDeps) {}

  async ingest(userId: string, raw: unknown): Promise<IngestResult> {
    // 1. Validate
    const validation = validateTelemetryPayload(raw, this.deps.now());
    if (!validation.ok) {
      return { status: 'validation_error', error: validation.error };
    }
    const payload: ValidatedTelemetryPayload = validation.payload;

    // 2. DPDP consent check — .bobrules §7
    const consentOk = await this.deps.hasConsent(userId);
    if (!consentOk) {
      return { status: 'consent_missing' };
    }

    // 3. Persist
    try {
      await this.deps.telemetryRepo.insertBatch(userId, [payload]);
    } catch (err: unknown) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 4. Refresh clusters for this route
    const refreshed = await this.deps.clusteringService.refreshForRoute(payload.routeId);

    return { status: 'ok', pointCount: 1, clustersRefreshed: refreshed };
  }

  /** Batch variant used by the Kafka consumer — processes many points at once. */
  async ingestBatch(
    userId: string,
    rawPoints: unknown[],
  ): Promise<IngestResult> {
    const validPayloads: ValidatedTelemetryPayload[] = [];
    let errorCount = 0;
    const now = this.deps.now();

    for (const raw of rawPoints) {
      const v = validateTelemetryPayload(raw, now);
      if (v.ok) {
        validPayloads.push(v.payload);
      } else {
        errorCount++;
      }
    }

    if (validPayloads.length === 0) {
      return { status: 'validation_error', error: `All ${errorCount} points failed validation` };
    }

    const consentOk = await this.deps.hasConsent(userId);
    if (!consentOk) return { status: 'consent_missing' };

    try {
      await this.deps.telemetryRepo.insertBatch(userId, validPayloads);
    } catch (err: unknown) {
      return { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }

    // Bug 5 fix: refresh clusters for all unique routes concurrently.
    // The former `for...of` with sequential `await` processed routes one at a time.
    // A batch touching 5 routes now fires all 5 refreshForRoute calls in parallel.
    // SpatialClusteringService.refreshForRoute already coalesces concurrent calls
    // for the same routeId via its in-flight guard, so there is no double-work risk.
    const routeIds = [...new Set(validPayloads.map((p) => p.routeId))];
    const refreshCounts = await Promise.all(
      routeIds.map((id) => this.deps.clusteringService.refreshForRoute(id)),
    );
    const totalRefreshed = refreshCounts.reduce((s, n) => s + n, 0);

    return { status: 'ok', pointCount: validPayloads.length, clustersRefreshed: totalRefreshed };
  }
}
