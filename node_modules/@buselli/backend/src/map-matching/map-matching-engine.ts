import type { GeoPoint } from '@buselli/shared';

/** GPS accuracy threshold above which map-matching is not attempted. */
const MAX_GPS_ACCURACY_FOR_MATCHING_METERS = 50;

export interface RouteShape {
  readonly shapeId: string;
  readonly points: GeoPoint[];
}

export type MapMatchResult =
  | { matched: true; snappedPoint: GeoPoint; fractionAlongShape: number; distanceToShapeMeters: number }
  | { matched: false; reason: 'accuracy_too_low' | 'no_shape_found' | 'distance_exceeds_threshold' };

export interface MapMatchingDeps {
  /** Returns route shape from DB for a given shape_id. Returns null if not found. */
  getRouteShape(shapeId: string): Promise<RouteShape | null>;
  /** Maximum allowed perpendicular distance (metres) from the shape to accept a match. */
  maxSnapDistanceMeters: number;
}

export class MapMatchingEngine {
  constructor(private readonly deps: MapMatchingDeps) {}

  /**
   * Snaps a GPS point to the nearest point on the route shape.
   * Rejects points with accuracy > MAX_GPS_ACCURACY_FOR_MATCHING_METERS.
   */
  async snapToShape(
    point: GeoPoint,
    accuracyMeters: number,
    shapeId: string,
  ): Promise<MapMatchResult> {
    if (accuracyMeters > MAX_GPS_ACCURACY_FOR_MATCHING_METERS) {
      return { matched: false, reason: 'accuracy_too_low' };
    }

    const shape = await this.deps.getRouteShape(shapeId);
    if (shape === null || shape.points.length < 2) {
      return { matched: false, reason: 'no_shape_found' };
    }

    let minDist = Infinity;
    let bestSnapped: GeoPoint | null = null;
    let bestFraction = 0;
    let totalLength = 0;
    let distToSnap = 0;

    for (let i = 0; i < shape.points.length - 1; i++) {
      const segStart = shape.points[i]!;
      const segEnd = shape.points[i + 1]!;
      const segLen = haversineMeters(segStart, segEnd);
      const { snapped, t, dist } = closestPointOnSegment(point, segStart, segEnd);

      if (dist < minDist) {
        minDist = dist;
        bestSnapped = snapped;
        bestFraction = (totalLength + t * segLen) / (totalLength + segLen);
        distToSnap = totalLength + t * segLen;
      }
      totalLength += segLen;
    }
    // Recalculate fraction as distance along full shape
    bestFraction = totalLength > 0 ? distToSnap / totalLength : 0;

    if (minDist > this.deps.maxSnapDistanceMeters) {
      return { matched: false, reason: 'distance_exceeds_threshold' };
    }

    return {
      matched: true,
      snappedPoint: bestSnapped!,
      fractionAlongShape: bestFraction,
      distanceToShapeMeters: minDist,
    };
  }
}

// ── Pure geometry helpers ─────────────────────────────────────────────────────

function closestPointOnSegment(
  p: GeoPoint,
  a: GeoPoint,
  b: GeoPoint,
): { snapped: GeoPoint; t: number; dist: number } {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const lenSq = dx * dx + dy * dy;

  let t = 0;
  if (lenSq > 0) {
    t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }

  const snapped: GeoPoint = { lat: a.lat + t * dy, lng: a.lng + t * dx };
  const dist = haversineMeters(p, snapped);
  return { snapped, t, dist };
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
