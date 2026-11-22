/** Shared GeoJSON-compatible coordinate type used across backend and mobile bridge. */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** GTFS route types relevant to BusElli (buses only). */
export const ROUTE_TYPE_BUS = 3 as const;

/** Confidence score brand type — prevents passing raw numbers as confidence. */
export type ConfidenceScore = number & { readonly _brand: 'ConfidenceScore' };

/** Crowd tag types — single source of truth used by mobile + backend. */
export type CrowdTagType = 'seats_free' | 'standing_only' | 'packed' | 'ac_ok' | 'ac_broken';

/** WebSocket message discriminated union — all messages between backend and mobile client. */
export type WsMessage =
  | WsBusPositionUpdate
  | WsCrowdTagUpdate
  | WsEtaUpdate
  | WsConnectionAck;

export interface WsBusPositionUpdate {
  readonly type: 'BUS_POSITION_UPDATE';
  readonly clusterId: string;
  readonly routeId: string;
  readonly lat: number;
  readonly lng: number;
  readonly speedKmh: number;
  readonly confidence: number;
  readonly riderCount: number;
  readonly updatedAt: string; // ISO-8601
}

export interface WsCrowdTagUpdate {
  readonly type: 'CROWD_TAG_UPDATE';
  readonly clusterId: string;
  readonly routeId: string;
  readonly crowdLevel: 'seats_free' | 'standing_only' | 'packed';
  readonly acStatus: 'ok' | 'broken' | 'unknown';
  readonly expiresAt: string; // ISO-8601
}

export interface WsEtaUpdate {
  readonly type: 'ETA_UPDATE';
  readonly routeId: string;
  readonly stopId: string;
  readonly etaSeconds: number;
  readonly status: 'LIVE' | 'DEGRADED' | 'HISTORICAL_FALLBACK' | 'SCHEDULED' | 'NO_SERVICE';
  readonly confidence: number;
}

export interface WsConnectionAck {
  readonly type: 'CONNECTION_ACK';
  readonly sessionId: string;
  readonly serverTime: string;
}

/** Telemetry payload submitted by mobile client. */
export interface TelemetryPayload {
  readonly sessionId: string;
  readonly routeId: string;
  readonly lat: number;
  readonly lng: number;
  readonly accuracyMeters: number;
  readonly speedKmh: number | null;
  /** Cell tower identifiers for offline position fallback. */
  readonly cellTowers: CellTowerIdentifier[];
  readonly capturedAt: string; // ISO-8601
}

export interface CellTowerIdentifier {
  readonly mcc: number;
  readonly mnc: number;
  readonly lac: number;
  readonly cellId: number;
  readonly signalStrength?: number; // dBm
}

/** GTFS stop as served to mobile for offline search. */
export interface GtfsStop {
  readonly stopId: string;
  readonly stopName: string;
  readonly lat: number;
  readonly lng: number;
}

/** GTFS route summary for mobile search results. */
export interface GtfsRoute {
  readonly routeId: string;
  readonly shortName: string;
  readonly longName: string;
}
