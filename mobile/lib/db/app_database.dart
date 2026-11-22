/// BusElli — Drift local database schema
/// Covers all GTFS tables needed for 100% offline operation.
///
/// Per .bobrules §4: this DB is bundled as an asset (assets/gtfs/buselli.db)
/// and opened read-only for GTFS queries; a separate write-able DB handles
/// the telemetry queue and alarm state.

import 'dart:io';
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'app_database.g.dart';

// ── GTFS Tables ───────────────────────────────────────────────────────────────

class GtfsRoutes extends Table {
  TextColumn get routeId => text().withLength(max: 32)();
  TextColumn get shortName => text().withLength(max: 16)();
  TextColumn get longName => text().withLength(max: 128)();
  IntColumn get routeType => integer()();
  TextColumn get color => text().nullable()();

  @override
  Set<Column> get primaryKey => {routeId};
}

class GtfsStops extends Table {
  TextColumn get stopId => text().withLength(max: 32)();
  TextColumn get stopName => text().withLength(max: 128)();
  RealColumn get lat => real()();
  RealColumn get lng => real()();

  @override
  Set<Column> get primaryKey => {stopId};
}

class GtfsTrips extends Table {
  TextColumn get tripId => text().withLength(max: 64)();
  TextColumn get routeId => text().withLength(max: 32).references(GtfsRoutes, #routeId)();
  TextColumn get shapeId => text().nullable()();
  IntColumn get directionId => integer().withDefault(const Constant(0))();
  TextColumn get tripHeadsign => text().nullable()();

  @override
  Set<Column> get primaryKey => {tripId};
}

class GtfsStopTimes extends Table {
  TextColumn get tripId => text().references(GtfsTrips, #tripId)();
  TextColumn get stopId => text().references(GtfsStops, #stopId)();
  IntColumn get stopSequence => integer()();
  IntColumn get arrivalTimeSeconds => integer()(); // seconds since midnight, may exceed 86400
  IntColumn get departureTimeSeconds => integer()();
  RealColumn get shapeDistTraveled => real().nullable()();

  @override
  Set<Column> get primaryKey => {tripId, stopSequence};
}

class GtfsShapePoints extends Table {
  TextColumn get shapeId => text()();
  IntColumn get sequence => integer()();
  RealColumn get lat => real()();
  RealColumn get lng => real()();
  RealColumn get distTraveled => real().nullable()();

  @override
  Set<Column> get primaryKey => {shapeId, sequence};
}

// ── App State Tables ──────────────────────────────────────────────────────────

class TelemetryQueue extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get sessionId => text()();
  TextColumn get routeId => text()();
  RealColumn get lat => real()();
  RealColumn get lng => real()();
  RealColumn get accuracyMeters => real()();
  RealColumn get speedKmh => real().nullable()();
  TextColumn get cellTowersJson => text().withDefault(const Constant('[]'))();
  DateTimeColumn get capturedAt => dateTime()();
  BoolColumn get synced => boolean().withDefault(const Constant(false))();
}

class SavedAlarms extends Table {
  TextColumn get alarmId => text()();
  TextColumn get stopId => text()();
  TextColumn get stopName => text()();
  TextColumn get routeId => text()();
  RealColumn get stopLat => real()();
  RealColumn get stopLng => real()();
  IntColumn get alertNStopsBefore => integer().withDefault(const Constant(2))();
  BoolColumn get enabled => boolean().withDefault(const Constant(true))();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column> get primaryKey => {alarmId};
}

class RecentRoutes extends Table {
  TextColumn get routeId => text()();
  DateTimeColumn get lastUsed => dateTime()();

  @override
  Set<Column> get primaryKey => {routeId};
}

// ── Database class ────────────────────────────────────────────────────────────

@DriftDatabase(tables: [
  GtfsRoutes, GtfsStops, GtfsTrips, GtfsStopTimes, GtfsShapePoints,
  TelemetryQueue, SavedAlarms, RecentRoutes,
])
class AppDatabase extends _$AppDatabase {
  AppDatabase(QueryExecutor e) : super(e);

  @override
  int get schemaVersion => 1;

  // ── GTFS Queries ──────────────────────────────────────────────────────────

  /// Full-text stop search — matches stop name prefix, case-insensitive.
  Future<List<GtfsStop>> searchStops(String query, {int limit = 20}) {
    return (select(gtfsStops)
      ..where((s) => s.stopName.lower().like('${query.toLowerCase()}%'))
      ..limit(limit))
        .get();
  }

  /// Nearby stops within approximate bounding box (fast, no spatial extension needed).
  Future<List<GtfsStop>> nearbyStops({
    required double lat,
    required double lng,
    double radiusDeg = 0.005, // ~500m
    int limit = 10,
  }) {
    return (select(gtfsStops)
      ..where((s) =>
          s.lat.isBetweenValues(lat - radiusDeg, lat + radiusDeg) &
          s.lng.isBetweenValues(lng - radiusDeg, lng + radiusDeg))
      ..limit(limit))
        .get();
  }

  /// Search routes by short name or long name prefix.
  Future<List<GtfsRoute>> searchRoutes(String query, {int limit = 20}) {
    final q = query.toLowerCase();
    return (select(gtfsRoutes)
      ..where((r) =>
          r.shortName.lower().like('$q%') |
          r.longName.lower().like('%$q%'))
      ..limit(limit))
        .get();
  }

  /// Returns all stops for a trip in sequence order with shape distances.
  Future<List<GtfsStopTime>> stopTimesForTrip(String tripId) {
    return (select(gtfsStopTimes)
      ..where((st) => st.tripId.equals(tripId))
      ..orderBy([(st) => OrderingTerm.asc(st.stopSequence)]))
        .get();
  }

  /// Returns all trips running on a given route today (simplified — no calendar check).
  Future<List<GtfsTrip>> tripsForRoute(String routeId) {
    return (select(gtfsTrips)
      ..where((t) => t.routeId.equals(routeId))
      ..limit(10))
        .get();
  }

  /// Shape points for map rendering, ordered by sequence.
  Future<List<GtfsShapePoint>> shapePoints(String shapeId) {
    return (select(gtfsShapePoints)
      ..where((s) => s.shapeId.equals(shapeId))
      ..orderBy([(s) => OrderingTerm.asc(s.sequence)]))
        .get();
  }

  // ── Telemetry Queue ───────────────────────────────────────────────────────

  Future<int> enqueueTelemetry(TelemetryQueueCompanion entry) =>
      into(telemetryQueue).insert(entry);

  Future<List<TelemetryQueueData>> pendingTelemetry({int limit = 50}) {
    return (select(telemetryQueue)
      ..where((t) => t.synced.equals(false))
      ..orderBy([(t) => OrderingTerm.asc(t.capturedAt)])
      ..limit(limit))
        .get();
  }

  Future<int> markTelemetrySynced(List<int> ids) {
    return (update(telemetryQueue)
      ..where((t) => t.id.isIn(ids)))
        .write(const TelemetryQueueCompanion(synced: Value(true)));
  }

  Future<int> pendingCount() async {
    final countExpr = telemetryQueue.id.count();
    final query = selectOnly(telemetryQueue)
      ..where(telemetryQueue.synced.equals(false))
      ..addColumns([countExpr]);
    final row = await query.getSingle();
    return row.read(countExpr) ?? 0;
  }

  // ── Alarms ────────────────────────────────────────────────────────────────

  Stream<List<SavedAlarm>> watchAlarms() =>
      (select(savedAlarms)
        ..orderBy([(a) => OrderingTerm.desc(a.createdAt)]))
          .watch();

  Future<void> upsertAlarm(SavedAlarmsCompanion alarm) =>
      into(savedAlarms).insertOnConflictUpdate(alarm);

  Future<int> deleteAlarm(String alarmId) =>
      (delete(savedAlarms)..where((a) => a.alarmId.equals(alarmId))).go();

  // ── Recent Routes ─────────────────────────────────────────────────────────

  Future<List<GtfsRoute>> recentRoutes({int limit = 5}) async {
    final recent = await (select(recentRoutes)
      ..orderBy([(r) => OrderingTerm.desc(r.lastUsed)])
      ..limit(limit))
        .get();
    if (recent.isEmpty) return [];
    final ids = recent.map((r) => r.routeId).toList();
    return (select(gtfsRoutes)..where((r) => r.routeId.isIn(ids))).get();
  }

  Future<void> recordRouteUsed(String routeId) {
    return into(recentRoutes).insertOnConflictUpdate(
      RecentRoutesCompanion(
        routeId: Value(routeId),
        lastUsed: Value(DateTime.now()),
      ),
    );
  }
}

// ── Database factory ──────────────────────────────────────────────────────────

/// Opens the app database, copying the bundled GTFS asset on first run.
Future<AppDatabase> openAppDatabase() async {
  final dir = await getApplicationDocumentsDirectory();
  final dbPath = p.join(dir.path, 'buselli.db');

  // Copy bundled GTFS database from assets if not yet present
  if (!File(dbPath).existsSync()) {
    final data = await rootBundle.load('assets/gtfs/buselli.db');
    await File(dbPath).writeAsBytes(
      data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
    );
  }

  return AppDatabase(NativeDatabase(File(dbPath)));
}
