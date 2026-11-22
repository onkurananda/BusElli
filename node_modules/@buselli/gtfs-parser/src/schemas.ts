import { z } from 'zod';

/** Zod schema for a single GTFS stops.txt row. */
export const GtfsStopRowSchema = z.object({
  stop_id: z.string().min(1),
  stop_name: z.string().min(1),
  stop_lat: z.coerce.number().min(-90).max(90),
  stop_lon: z.coerce.number().min(-180).max(180),
  stop_desc: z.string().optional(),
  stop_code: z.string().optional(),
});

export type GtfsStopRow = z.infer<typeof GtfsStopRowSchema>;

/** Zod schema for a single GTFS routes.txt row. */
export const GtfsRouteRowSchema = z.object({
  route_id: z.string().min(1),
  agency_id: z.string().optional(),
  route_short_name: z.string().min(1),
  route_long_name: z.string().min(1),
  route_type: z.coerce.number().int(),
  route_color: z.string().optional(),
});

export type GtfsRouteRow = z.infer<typeof GtfsRouteRowSchema>;

/** Zod schema for a single GTFS trips.txt row. */
export const GtfsTripRowSchema = z.object({
  trip_id: z.string().min(1),
  route_id: z.string().min(1),
  service_id: z.string().min(1),
  shape_id: z.string().optional(),
  direction_id: z.coerce.number().int().min(0).max(1).optional(),
  trip_headsign: z.string().optional(),
});

export type GtfsTripRow = z.infer<typeof GtfsTripRowSchema>;

/** Zod schema for a single GTFS stop_times.txt row. */
export const GtfsStopTimeRowSchema = z.object({
  trip_id: z.string().min(1),
  stop_id: z.string().min(1),
  stop_sequence: z.coerce.number().int().min(0),
  arrival_time: z.string().regex(/^\d{1,2}:\d{2}:\d{2}$/), // HH:MM:SS (hours may exceed 23)
  departure_time: z.string().regex(/^\d{1,2}:\d{2}:\d{2}$/),
  shape_dist_traveled: z.coerce.number().optional(),
});

export type GtfsStopTimeRow = z.infer<typeof GtfsStopTimeRowSchema>;

/** Zod schema for shapes.txt row. */
export const GtfsShapeRowSchema = z.object({
  shape_id: z.string().min(1),
  shape_pt_lat: z.coerce.number().min(-90).max(90),
  shape_pt_lon: z.coerce.number().min(-180).max(180),
  shape_pt_sequence: z.coerce.number().int().min(0),
  shape_dist_traveled: z.coerce.number().optional(),
});

export type GtfsShapeRow = z.infer<typeof GtfsShapeRowSchema>;

/**
 * Converts a GTFS time string (HH:MM:SS, may exceed 24h for post-midnight) to
 * seconds since midnight. Valid per GTFS spec.
 */
export function gtfsTimeToSeconds(time: string): number {
  const parts = time.split(':');
  if (parts.length !== 3) throw new Error(`Invalid GTFS time: ${time}`);
  const [hStr, mStr, sStr] = parts;
  const h = parseInt(hStr ?? '0', 10);
  const m = parseInt(mStr ?? '0', 10);
  const s = parseInt(sStr ?? '0', 10);
  if (isNaN(h) || isNaN(m) || isNaN(s)) throw new Error(`Non-numeric GTFS time: ${time}`);
  if (m >= 60 || s >= 60) throw new Error(`Invalid minutes/seconds in GTFS time: ${time}`);
  return h * 3600 + m * 60 + s;
}
