import type { GeoPoint } from '@buselli/shared';

/** Source of a position fix — drives confidence scoring. */
export type PositionSource =
  | { kind: 'gps'; accuracyMeters: number }
  | { kind: 'cell_tower'; accuracyMeters: number }
  | { kind: 'dead_reckoning' };

/** A single telemetry point received from a rider's device. */
export interface TelemetryPoint {
  readonly sessionId: string;
  readonly userId: string;
  readonly routeId: string;
  readonly position: GeoPoint;
  readonly source: PositionSource;
  readonly speedKmh: number | null;
  readonly capturedAt: Date;
}

/** Confidence score in [0, 1]. */
export type ConfidenceScore = number & { readonly _brand: 'ConfidenceScore' };

export function makeConfidenceScore(value: number): ConfidenceScore {
  if (value < 0 || value > 1) throw new RangeError(`Confidence must be in [0,1], got ${value}`);
  return value as ConfidenceScore;
}

/** An authoritative bus cluster derived from multiple telemetry points. */
export interface BusCluster {
  readonly clusterId: string;
  readonly routeId: string;
  readonly tripId: string | null;
  readonly position: GeoPoint;
  readonly speedKmh: number;
  readonly nearestStopId: string;
  readonly nearestStopSequence: number;
  readonly confidence: ConfidenceScore;
  readonly riderCount: number;
  readonly updatedAt: Date;
}

/** ETA result status indicates data quality to the caller. */
export type EtaStatus =
  | 'LIVE'           // fresh telemetry < TELEMETRY_STALE_SECONDS
  | 'DEGRADED'       // stale telemetry, using last known speed
  | 'HISTORICAL_FALLBACK' // no live telemetry; using historical speed profile
  | 'SCHEDULED'      // no telemetry at all; pure GTFS schedule
  | 'NO_SERVICE';    // bus not in operation today

export interface EtaResult {
  readonly clusterId: string | null;
  readonly routeId: string;
  readonly stopId: string;
  readonly etaSeconds: number;
  readonly status: EtaStatus;
  readonly confidence: ConfidenceScore;
  readonly computedAt: Date;
}
