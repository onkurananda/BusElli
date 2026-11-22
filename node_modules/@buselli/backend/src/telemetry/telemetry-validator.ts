/**
 * TelemetryValidator — validates incoming telemetry payloads before they enter
 * the pipeline.  All rules from .bobrules §4 are applied here server-side.
 */
import { z } from 'zod';

export const CellTowerSchema = z.object({
  mcc: z.number().int().min(1).max(999),
  mnc: z.number().int().min(0).max(999),
  lac: z.number().int().min(0),
  cellId: z.number().int().min(0),
  signalStrength: z.number().optional(),
});

export const TelemetryPayloadSchema = z.object({
  sessionId: z.string().uuid(),
  routeId: z.string().min(1).max(32),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(5000),
  speedKmh: z.number().min(0).max(200).nullable(),
  cellTowers: z.array(CellTowerSchema).max(8),
  capturedAt: z.string().datetime({ offset: true }),
});

export type ValidatedTelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;

export type ValidationResult =
  | { ok: true; payload: ValidatedTelemetryPayload }
  | { ok: false; error: string };

/** Maximum allowed age of a telemetry point before it is rejected. */
const MAX_POINT_AGE_SECONDS = 300;

export function validateTelemetryPayload(
  raw: unknown,
  now: Date = new Date(),
): ValidationResult {
  const parsed = TelemetryPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }

  const payload = parsed.data;

  // Reject if capturedAt is from the future (clock skew > 30s)
  const capturedAt = new Date(payload.capturedAt);
  if (capturedAt.getTime() > now.getTime() + 30_000) {
    return { ok: false, error: 'capturedAt is in the future' };
  }

  // Reject stale points — mobile queued too long without network
  const ageSeconds = (now.getTime() - capturedAt.getTime()) / 1000;
  if (ageSeconds > MAX_POINT_AGE_SECONDS) {
    return { ok: false, error: `telemetry point is too old (${Math.round(ageSeconds)}s)` };
  }

  // Server-side re-check of .bobrules §4.1 speed limit
  if (payload.speedKmh !== null && payload.speedKmh > 80) {
    return { ok: false, error: `speedKmh ${payload.speedKmh} exceeds city zone limit of 80 km/h` };
  }

  return { ok: true, payload };
}
