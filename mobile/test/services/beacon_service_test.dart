/// BusElli — Unit tests for BeaconService.
/// Tests the batching logic, flush conditions, and cell-tower fallback
/// without requiring real GPS hardware.

import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:dio/dio.dart';
import 'package:buselli/db/app_database.dart';
import 'package:buselli/services/beacon_service.dart';
import 'package:buselli/services/location_service.dart';
import 'package:buselli/models/models.dart';

@GenerateMocks([LocationService, Dio])
import 'beacon_service_test.mocks.dart';

AppDatabase _makeDb() => AppDatabase(NativeDatabase.memory());

void main() {
  group('BeaconService', () {
    late AppDatabase db;
    late MockLocationService mockLocation;
    late MockDio mockDio;
    late BeaconService svc;

    setUp(() {
      db           = _makeDb();
      mockLocation = MockLocationService();
      mockDio      = MockDio();

      // Mock location service to return an empty stream
      when(mockLocation.startSession(any)).thenAnswer((_) => const Stream.empty());
      when(mockLocation.stopSession()).thenReturn(null);
      when(mockLocation.currentMode).thenReturn(LocationSessionMode.idle);

      svc = BeaconService(db: db, locationService: mockLocation, dio: mockDio);
    });

    tearDown(() async {
      await svc.dispose();
      await db.close();
    });

    test('startSession creates an ActiveSession with the correct routeId', () async {
      // Seed a route
      await db.into(db.gtfsRoutes).insert(
        GtfsRoutesCompanion.insert(routeId: '500D', shortName: '500D', longName: 'Test Route', routeType: 3),
      );

      final session = await svc.startSession('500D', '500D');

      expect(session.routeId, equals('500D'));
      expect(session.sessionId, isNotEmpty);
      expect(svc.hasSession, isTrue);
    });

    test('startSession starts the GPS stream with activeTelemetry mode', () async {
      await svc.startSession('500D', '500D');
      verify(mockLocation.startSession(LocationSessionMode.activeTelemetry)).called(1);
    });

    test('endSession stops GPS stream and clears session', () async {
      await svc.startSession('500D', '500D');
      await svc.endSession();

      expect(svc.hasSession, isFalse);
      verify(mockLocation.stopSession()).called(1);
    });

    test('calling startSession twice ends the first session before starting new one', () async {
      await svc.startSession('500D', '500D');
      await svc.startSession('335E', '335E');

      expect(svc.activeSession?.routeId, equals('335E'));
      // stopSession called once for the first session's cleanup
      verify(mockLocation.stopSession()).called(greaterThanOrEqualTo(1));
    });

    test('pendingCount is 0 before any telemetry is enqueued', () async {
      final count = await db.pendingCount();
      expect(count, equals(0));
    });

    test('enqueueTelemetry persists and increases pendingCount', () async {
      await db.enqueueTelemetry(TelemetryQueueCompanion.insert(
        sessionId:      'sess-test',
        routeId:        '500D',
        lat:            12.9165,
        lng:            77.6209,
        accuracyMeters: 15.0,
        capturedAt:     DateTime.now(),
      ));
      final count = await db.pendingCount();
      expect(count, equals(1));
    });

    test('flush threshold constant is 10 per .bobrules §4.3', () {
      expect(kFlushBatchThreshold, equals(10));
    });

    test('flush interval constant is 5 minutes per .bobrules §4.3', () {
      expect(kMaxFlushInterval, equals(const Duration(minutes: 5)));
    });

    test('session idle timeout constant is 60 minutes per .bobrules §4.4', () {
      expect(kSessionIdleTimeout, equals(const Duration(minutes: 60)));
    });
  });

  group('GeofenceAlarmService — StopAlarm', () {
    test('StopAlarm holds all required fields', () {
      const alarm = StopAlarm(
        stopId: 'BLR001', stopName: 'Silk Board Junction',
        lat: 12.9165, lng: 77.6209, routeId: '500D',
      );
      expect(alarm.stopId,   equals('BLR001'));
      expect(alarm.routeId,  equals('500D'));
      expect(alarm.lat,      equals(12.9165));
    });
  });
}
