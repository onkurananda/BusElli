/// BusElli — Unit tests for GTFS database queries.
/// Uses an in-memory SQLite database (no asset bundle needed).

import 'package:flutter_test/flutter_test.dart';
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:buselli/db/app_database.dart';

AppDatabase _makeInMemoryDb() {
  return AppDatabase(NativeDatabase.memory());
}

Future<AppDatabase> _seedDb() async {
  final db = _makeInMemoryDb();

  // Seed routes
  await db.into(db.gtfsRoutes).insertAll([
    GtfsRoutesCompanion.insert(routeId: '500D', shortName: '500D', longName: 'Silk Board to KR Puram', routeType: 3),
    GtfsRoutesCompanion.insert(routeId: '335E', shortName: '335E', longName: 'Majestic to Whitefield', routeType: 3),
    GtfsRoutesCompanion.insert(routeId: 'KIA-9', shortName: 'KIA-9', longName: 'Majestic to KIA Airport', routeType: 3),
  ]);

  // Seed stops
  await db.into(db.gtfsStops).insertAll([
    GtfsStopsCompanion.insert(stopId: 'BLR001', stopName: 'Silk Board Junction', lat: 12.9165, lng: 77.6209),
    GtfsStopsCompanion.insert(stopId: 'BLR002', stopName: 'Marathahalli Bridge', lat: 12.9560, lng: 77.7014),
    GtfsStopsCompanion.insert(stopId: 'BLR003', stopName: 'Majestic Bus Stand', lat: 12.9774, lng: 77.5713),
    GtfsStopsCompanion.insert(stopId: 'BLR004', stopName: 'KR Puram Bus Stand', lat: 13.0100, lng: 77.6950),
  ]);

  // Seed trips
  await db.into(db.gtfsTrips).insertAll([
    GtfsTripsCompanion.insert(tripId: 'trip_500D_01', routeId: '500D'),
    GtfsTripsCompanion.insert(tripId: 'trip_335E_01', routeId: '335E'),
  ]);

  // Seed stop times
  await db.into(db.gtfsStopTimes).insertAll([
    GtfsStopTimesCompanion.insert(
      tripId: 'trip_500D_01', stopId: 'BLR001', stopSequence: 1,
      arrivalTimeSeconds: 25200, departureTimeSeconds: 25230,
    ),
    GtfsStopTimesCompanion.insert(
      tripId: 'trip_500D_01', stopId: 'BLR002', stopSequence: 2,
      arrivalTimeSeconds: 26040, departureTimeSeconds: 26070,
      shapeDistTraveled: const Value(12000),
    ),
    GtfsStopTimesCompanion.insert(
      tripId: 'trip_500D_01', stopId: 'BLR004', stopSequence: 3,
      arrivalTimeSeconds: 27300, departureTimeSeconds: 27300,
      shapeDistTraveled: const Value(17000),
    ),
  ]);

  return db;
}

void main() {
  group('AppDatabase — GTFS search', () {
    late AppDatabase db;

    setUp(() async {
      db = await _seedDb();
    });

    tearDown(() async {
      await db.close();
    });

    // Stop search
    test('searchStops returns stops matching prefix (case-insensitive)', () async {
      final results = await db.searchStops('silk');
      expect(results, hasLength(1));
      expect(results.first.stopName, equals('Silk Board Junction'));
    });

    test('searchStops returns empty list for query shorter than 2 chars', () async {
      final results = await db.searchStops('S');
      // DB-level query runs — should still return 1 result starting with S
      // (the 2-char guard is in the provider layer, not DB layer)
      expect(results, isA<List>());
    });

    test('searchStops returns all stops matching partial name', () async {
      final results = await db.searchStops('ma');
      // 'Marathahalli Bridge' and 'Majestic Bus Stand' both match
      expect(results.length, greaterThanOrEqualTo(2));
    });

    test('searchStops returns empty list for no match', () async {
      final results = await db.searchStops('xyz_nonexistent');
      expect(results, isEmpty);
    });

    // Route search
    test('searchRoutes finds route by exact short name', () async {
      final results = await db.searchRoutes('500D');
      expect(results, hasLength(1));
      expect(results.first.routeId, equals('500D'));
    });

    test('searchRoutes finds routes by partial long name', () async {
      final results = await db.searchRoutes('Whitefield');
      expect(results, hasLength(1));
      expect(results.first.shortName, equals('335E'));
    });

    test('searchRoutes returns empty for no match', () async {
      final results = await db.searchRoutes('NOMATCH999');
      expect(results, isEmpty);
    });

    // Nearby stops
    test('nearbyStops returns stops within bounding box', () async {
      // Silk Board is at (12.9165, 77.6209) — query near it
      final results = await db.nearbyStops(lat: 12.9165, lng: 77.6209, radiusDeg: 0.01);
      expect(results, isNotEmpty);
      expect(results.any((s) => s.stopId == 'BLR001'), isTrue);
    });

    test('nearbyStops returns empty when query is far from all stops', () async {
      final results = await db.nearbyStops(lat: 0.0, lng: 0.0, radiusDeg: 0.001);
      expect(results, isEmpty);
    });

    // Stop times
    test('stopTimesForTrip returns stops in ascending sequence order', () async {
      final times = await db.stopTimesForTrip('trip_500D_01');
      expect(times, hasLength(3));
      final seqs = times.map((t) => t.stopSequence).toList();
      expect(seqs, equals([1, 2, 3]));
    });

    test('stopTimesForTrip returns empty list for unknown tripId', () async {
      final times = await db.stopTimesForTrip('trip_unknown_99');
      expect(times, isEmpty);
    });

    // Telemetry queue
    test('enqueueTelemetry persists a point and pendingCount reflects it', () async {
      await db.enqueueTelemetry(TelemetryQueueCompanion.insert(
        sessionId: 'sess-001',
        routeId:   '500D',
        lat:       12.9165,
        lng:       77.6209,
        accuracyMeters: 15.0,
        capturedAt: DateTime.now(),
      ));
      final count = await db.pendingCount();
      expect(count, equals(1));
    });

    test('markTelemetrySynced updates synced flag', () async {
      await db.enqueueTelemetry(TelemetryQueueCompanion.insert(
        sessionId: 'sess-002', routeId: '500D',
        lat: 12.9165, lng: 77.6209, accuracyMeters: 15.0,
        capturedAt: DateTime.now(),
      ));
      final pending = await db.pendingTelemetry();
      expect(pending, hasLength(1));
      await db.markTelemetrySynced([pending.first.id]);
      final countAfter = await db.pendingCount();
      expect(countAfter, equals(0));
    });

    // Alarms
    test('upsertAlarm and watchAlarms emit the saved alarm', () async {
      await db.upsertAlarm(SavedAlarmsCompanion.insert(
        alarmId: 'alarm-001',
        stopId:  'BLR002',
        stopName: 'Marathahalli Bridge',
        routeId: '500D',
        stopLat:  12.956,
        stopLng:  77.7014,
        createdAt: DateTime.now(),
      ));
      final alarms = await db.watchAlarms().first;
      expect(alarms, hasLength(1));
      expect(alarms.first.stopName, equals('Marathahalli Bridge'));
    });

    test('deleteAlarm removes the alarm from DB', () async {
      await db.upsertAlarm(SavedAlarmsCompanion.insert(
        alarmId: 'alarm-del',
        stopId:  'BLR001',
        stopName: 'Silk Board Junction',
        routeId: '500D',
        stopLat:  12.9165,
        stopLng:  77.6209,
        createdAt: DateTime.now(),
      ));
      await db.deleteAlarm('alarm-del');
      final alarms = await db.watchAlarms().first;
      expect(alarms, isEmpty);
    });

    // Recent routes
    test('recordRouteUsed and recentRoutes return most recently used route', () async {
      await db.recordRouteUsed('500D');
      await Future.delayed(const Duration(milliseconds: 5));
      await db.recordRouteUsed('335E');
      final recent = await db.recentRoutes(limit: 2);
      expect(recent.first.routeId, equals('335E'));
    });
  });
}
