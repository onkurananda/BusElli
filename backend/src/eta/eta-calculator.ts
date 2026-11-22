import type { BusCluster, EtaResult, EtaStatus, ConfidenceScore } from './types.js';
import { makeConfidenceScore } from './types.js';

export interface StopTimeEntry {
  readonly stopId: string;
  readonly stopSequence: number;
  /** Seconds since midnight — GTFS allows >86400 for post-midnight trips. */
  readonly scheduledArrivalSeconds: number;
  /** Metres along the shape from the trip start. */
  readonly shapeDistTraveled: number;
}

export interface EtaCalculatorDeps {
  readonly telemetryStaleSeconds: number;
  readonly confidenceDecayPerSecond: number;
  /** Returns average observed speed (km/h) for a given route/hour bucket. Returns null if no data. */
  getHistoricalSpeedKmh(routeId: string, hourOfDay: number): Promise<number | null>;
  /** Returns scheduled stop times for a trip. */
  getScheduledStopTimes(tripId: string): Promise<StopTimeEntry[]>;
  /** Wall-clock now — injected for testability. */
  now(): Date;
}

export class EtaCalculator {
  constructor(private readonly deps: EtaCalculatorDeps) {}

  /**
   * Computes ETA in seconds for `targetStopId` given the current bus cluster state.
   * Falls back through LIVE → DEGRADED → HISTORICAL_FALLBACK → SCHEDULED → NO_SERVICE.
   */
  async computeEta(
    cluster: BusCluster,
    targetStopId: string,
    targetStopSequence: number,
  ): Promise<EtaResult> {
    const now = this.deps.now();
    const ageSeconds = (now.getTime() - cluster.updatedAt.getTime()) / 1000;

    if (cluster.nearestStopSequence >= targetStopSequence) {
      // Bus has already passed the target stop
      return this.buildResult(cluster, targetStopId, 0, 'NO_SERVICE', 0);
    }

    const stopsAhead = targetStopSequence - cluster.nearestStopSequence;

    // --- Attempt LIVE / DEGRADED path ---
    if (cluster.tripId !== null) {
      const stopTimes = await this.deps.getScheduledStopTimes(cluster.tripId);
      // Use sequence-based lookup to handle loop routes (same stopId appears twice).
      // Target: find the entry at or after targetStopSequence.
      // Current: find the entry closest to (and not exceeding) nearestStopSequence.
      const targetEntry = stopTimes
        .filter((s) => s.stopId === targetStopId && s.stopSequence >= targetStopSequence)
        .sort((a, b) => a.stopSequence - b.stopSequence)[0];
      const currentEntry = stopTimes
        .filter((s) => s.stopId === cluster.nearestStopId && s.stopSequence <= cluster.nearestStopSequence)
        .sort((a, b) => b.stopSequence - a.stopSequence)[0];

      if (targetEntry !== undefined && currentEntry !== undefined) {
        const distanceMeters = targetEntry.shapeDistTraveled - currentEntry.shapeDistTraveled;
        if (distanceMeters < 0) {
          return this.buildResult(cluster, targetStopId, 0, 'NO_SERVICE', 0);
        }

        const speedKmh = this.resolveSpeed(cluster, ageSeconds);
        if (speedKmh !== null) {
          const etaSeconds = this.distanceToSeconds(distanceMeters, speedKmh);
          const status: EtaStatus = ageSeconds <= this.deps.telemetryStaleSeconds ? 'LIVE' : 'DEGRADED';
          const confidence = this.decayedConfidence(cluster.confidence, ageSeconds);
          return this.buildResult(cluster, targetStopId, etaSeconds, status, confidence);
        }
      }
    }

    // --- HISTORICAL_FALLBACK: use average observed speed for this hour ---
    const hourOfDay = now.getUTCHours();
    const historicalSpeed = await this.deps.getHistoricalSpeedKmh(cluster.routeId, hourOfDay);
    if (historicalSpeed !== null) {
      // Rough estimate: average stop spacing ~600m on BMTC urban routes
      const AVG_STOP_SPACING_METERS = 600;
      const etaSeconds = this.distanceToSeconds(stopsAhead * AVG_STOP_SPACING_METERS, historicalSpeed);
      return this.buildResult(cluster, targetStopId, etaSeconds, 'HISTORICAL_FALLBACK', 0.3);
    }

    // --- SCHEDULED: pure GTFS schedule ---
    if (cluster.tripId !== null) {
      const stopTimes = await this.deps.getScheduledStopTimes(cluster.tripId);
      const targetEntry = stopTimes.find((s) => s.stopId === targetStopId);
      if (targetEntry !== undefined) {
        const nowSeconds = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
        const etaSeconds = Math.max(0, targetEntry.scheduledArrivalSeconds - nowSeconds);
        return this.buildResult(cluster, targetStopId, etaSeconds, 'SCHEDULED', 0.1);
      }
    }

    return this.buildResult(cluster, targetStopId, 0, 'NO_SERVICE', 0);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Returns the effective speed to use.
   * Returns null when no reliable speed is available (triggers historical fallback).
   */
  private resolveSpeed(cluster: BusCluster, ageSeconds: number): number | null {
    if (cluster.speedKmh > 0) return cluster.speedKmh;
    // If bus is stopped, use a default crawl speed if telemetry is fresh
    if (ageSeconds <= this.deps.telemetryStaleSeconds) return 12; // conservative 12 km/h
    return null;
  }

  private distanceToSeconds(distanceMeters: number, speedKmh: number): number {
    if (speedKmh <= 0) return 0;
    return Math.round((distanceMeters / 1000 / speedKmh) * 3600);
  }

  private decayedConfidence(base: ConfidenceScore, ageSeconds: number): ConfidenceScore {
    const decayed = base * Math.pow(1 - this.deps.confidenceDecayPerSecond, ageSeconds);
    return makeConfidenceScore(Math.max(0, Math.min(1, decayed)));
  }

  private buildResult(
    cluster: BusCluster,
    stopId: string,
    etaSeconds: number,
    status: EtaStatus,
    confidence: number,
  ): EtaResult {
    return {
      clusterId: cluster.clusterId,
      routeId: cluster.routeId,
      stopId,
      etaSeconds,
      status,
      confidence: makeConfidenceScore(confidence),
      computedAt: this.deps.now(),
    };
  }
}
