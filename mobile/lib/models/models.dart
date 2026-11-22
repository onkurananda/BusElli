/// BusElli — domain models
/// Immutable value objects shared across features.

import 'package:flutter/material.dart';

// ── Crowd status ──────────────────────────────────────────────────────────────

enum CrowdLevel {
  seatsAvailable,
  standingOnly,
  packed,
  unknown;

  String get label {
    switch (this) {
      case CrowdLevel.seatsAvailable: return 'Seats Free';
      case CrowdLevel.standingOnly:   return 'Standing';
      case CrowdLevel.packed:         return 'Packed';
      case CrowdLevel.unknown:        return '—';
    }
  }

  Color get color {
    switch (this) {
      case CrowdLevel.seatsAvailable: return const Color(0xFF22C55E);
      case CrowdLevel.standingOnly:   return const Color(0xFFF59E0B);
      case CrowdLevel.packed:         return const Color(0xFFEF4444);
      case CrowdLevel.unknown:        return const Color(0xFF6B7280);
    }
  }

  static CrowdLevel fromString(String? value) {
    switch (value) {
      case 'seats_free':    return CrowdLevel.seatsAvailable;
      case 'standing_only': return CrowdLevel.standingOnly;
      case 'packed':        return CrowdLevel.packed;
      default:              return CrowdLevel.unknown;
    }
  }
}

enum AcStatus { ok, broken, unknown }

// ── Live bus ──────────────────────────────────────────────────────────────────

class LiveBus {
  final String clusterId;
  final String routeId;
  final double lat;
  final double lng;
  final double speedKmh;
  final double confidence;
  final int riderCount;
  final CrowdLevel crowdLevel;
  final AcStatus acStatus;
  final DateTime updatedAt;
  final String? nearestStopId;

  const LiveBus({
    required this.clusterId,
    required this.routeId,
    required this.lat,
    required this.lng,
    required this.speedKmh,
    required this.confidence,
    required this.riderCount,
    required this.crowdLevel,
    required this.acStatus,
    required this.updatedAt,
    this.nearestStopId,
  });

  factory LiveBus.fromJson(Map<String, dynamic> json) => LiveBus(
    clusterId:    json['clusterId'] as String,
    routeId:      json['routeId'] as String,
    lat:          (json['lat'] as num).toDouble(),
    lng:          (json['lng'] as num).toDouble(),
    speedKmh:     (json['speedKmh'] as num? ?? 0).toDouble(),
    confidence:   (json['confidence'] as num? ?? 0).toDouble(),
    riderCount:   json['riderCount'] as int? ?? 1,
    crowdLevel:   CrowdLevel.fromString(json['crowdLevel'] as String?),
    acStatus:     _parseAc(json['acStatus'] as String?),
    updatedAt:    DateTime.parse(json['updatedAt'] as String),
    nearestStopId: json['nearestStopId'] as String?,
  );

  static AcStatus _parseAc(String? v) {
    if (v == 'ok')     return AcStatus.ok;
    if (v == 'broken') return AcStatus.broken;
    return AcStatus.unknown;
  }

  /// Age in seconds since last telemetry update.
  int get ageSeconds =>
      DateTime.now().difference(updatedAt).inSeconds.clamp(0, 999999);

  /// Confidence faded by age — 15% decay per 90 seconds.
  double get fadedConfidence {
    const decayPerSecond = 0.0017;
    final faded = confidence * (1 - decayPerSecond * ageSeconds);
    return faded.clamp(0.0, 1.0);
  }

  bool get isStale => ageSeconds > 180;
}

// ── Stop ──────────────────────────────────────────────────────────────────────

class BusStop {
  final String stopId;
  final String stopName;
  final double lat;
  final double lng;

  const BusStop({
    required this.stopId,
    required this.stopName,
    required this.lat,
    required this.lng,
  });
}

// ── Route ─────────────────────────────────────────────────────────────────────

class BusRoute {
  final String routeId;
  final String shortName;
  final String longName;
  final String? color;

  const BusRoute({
    required this.routeId,
    required this.shortName,
    required this.longName,
    this.color,
  });
}

// ── ETA ───────────────────────────────────────────────────────────────────────

enum EtaStatus { live, degraded, historicalFallback, scheduled, noService }

class EtaResult {
  final String routeId;
  final String stopId;
  final int etaSeconds;
  final EtaStatus status;
  final double confidence;

  const EtaResult({
    required this.routeId,
    required this.stopId,
    required this.etaSeconds,
    required this.status,
    required this.confidence,
  });

  String get etaLabel {
    if (etaSeconds <= 0) return 'Due';
    final mins = (etaSeconds / 60).ceil();
    return '$mins min';
  }
}

// ── Telemetry session ─────────────────────────────────────────────────────────

class ActiveSession {
  final String sessionId;
  final String routeId;
  final String routeShortName;
  final DateTime startedAt;
  CrowdLevel crowdTag;
  AcStatus acTag;

  ActiveSession({
    required this.sessionId,
    required this.routeId,
    required this.routeShortName,
    required this.startedAt,
    this.crowdTag = CrowdLevel.unknown,
    this.acTag = AcStatus.unknown,
  });
}
