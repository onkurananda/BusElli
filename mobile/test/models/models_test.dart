/// BusElli — Unit tests for LiveBus model and CrowdLevel helpers.

import 'package:flutter_test/flutter_test.dart';
import 'package:buselli/models/models.dart';

void main() {
  group('CrowdLevel', () {
    test('fromString maps known values correctly', () {
      expect(CrowdLevel.fromString('seats_free'),    equals(CrowdLevel.seatsAvailable));
      expect(CrowdLevel.fromString('standing_only'), equals(CrowdLevel.standingOnly));
      expect(CrowdLevel.fromString('packed'),        equals(CrowdLevel.packed));
    });

    test('fromString returns unknown for null and unrecognised values', () {
      expect(CrowdLevel.fromString(null),    equals(CrowdLevel.unknown));
      expect(CrowdLevel.fromString('bogus'), equals(CrowdLevel.unknown));
    });

    test('label returns human-readable string for each level', () {
      expect(CrowdLevel.seatsAvailable.label, equals('Seats Free'));
      expect(CrowdLevel.standingOnly.label,   equals('Standing'));
      expect(CrowdLevel.packed.label,         equals('Packed'));
      expect(CrowdLevel.unknown.label,        equals('—'));
    });
  });

  group('LiveBus', () {
    LiveBus makeBus({
      DateTime? updatedAt,
      double confidence = 0.9,
      CrowdLevel crowdLevel = CrowdLevel.seatsAvailable,
    }) {
      return LiveBus(
        clusterId:  'cluster-001',
        routeId:    '500D',
        lat:        12.9165,
        lng:        77.6209,
        speedKmh:   22,
        confidence: confidence,
        riderCount: 3,
        crowdLevel: crowdLevel,
        acStatus:   AcStatus.ok,
        updatedAt:  updatedAt ?? DateTime.now(),
      );
    }

    test('fromJson parses a valid JSON payload', () {
      final json = {
        'clusterId':  'c-001',
        'routeId':    '500D',
        'lat':        12.9165,
        'lng':        77.6209,
        'speedKmh':   22,
        'confidence': 0.85,
        'riderCount': 3,
        'crowdLevel': 'seats_free',
        'acStatus':   'ok',
        'updatedAt':  '2024-08-15T07:00:00.000Z',
      };
      final bus = LiveBus.fromJson(json);
      expect(bus.clusterId,    equals('c-001'));
      expect(bus.routeId,      equals('500D'));
      expect(bus.crowdLevel,   equals(CrowdLevel.seatsAvailable));
      expect(bus.acStatus,     equals(AcStatus.ok));
      expect(bus.confidence,   closeTo(0.85, 0.001));
    });

    test('ageSeconds is 0 for a bus updated right now', () {
      final bus = makeBus(updatedAt: DateTime.now());
      expect(bus.ageSeconds, lessThanOrEqualTo(1));
    });

    test('isStale is false for a bus updated 60 seconds ago', () {
      final bus = makeBus(updatedAt: DateTime.now().subtract(const Duration(seconds: 60)));
      expect(bus.isStale, isFalse);
    });

    test('isStale is true for a bus updated 200 seconds ago', () {
      final bus = makeBus(updatedAt: DateTime.now().subtract(const Duration(seconds: 200)));
      expect(bus.isStale, isTrue);
    });

    test('fadedConfidence decreases with age', () {
      final fresh = makeBus(updatedAt: DateTime.now(), confidence: 0.9);
      final stale = makeBus(
        updatedAt: DateTime.now().subtract(const Duration(seconds: 180)),
        confidence: 0.9,
      );
      expect(fresh.fadedConfidence, greaterThan(stale.fadedConfidence));
    });

    test('fadedConfidence never goes below 0', () {
      final ancient = makeBus(
        updatedAt: DateTime.now().subtract(const Duration(hours: 2)),
        confidence: 0.5,
      );
      expect(ancient.fadedConfidence, greaterThanOrEqualTo(0));
    });

    test('etaLabel shows "Due" for 0 or negative eta', () {
      const result = EtaResult(
        routeId: '500D', stopId: 'BLR001',
        etaSeconds: 0, status: EtaStatus.live, confidence: 0.9,
      );
      expect(result.etaLabel, equals('Due'));
    });

    test('etaLabel shows minutes for positive eta', () {
      const result = EtaResult(
        routeId: '500D', stopId: 'BLR001',
        etaSeconds: 180, status: EtaStatus.live, confidence: 0.9,
      );
      expect(result.etaLabel, equals('3 min'));
    });

    test('etaLabel rounds up to nearest minute', () {
      const result = EtaResult(
        routeId: '500D', stopId: 'BLR001',
        etaSeconds: 61, status: EtaStatus.live, confidence: 0.9,
      );
      expect(result.etaLabel, equals('2 min'));
    });
  });

  group('WebSocketService message parsing', () {
    test('LiveBus.fromJson handles missing optional fields gracefully', () {
      final json = {
        'clusterId':  'c-002',
        'routeId':    '335E',
        'lat':        12.9,
        'lng':        77.6,
        'updatedAt':  '2024-08-15T07:00:00.000Z',
      };
      final bus = LiveBus.fromJson(json);
      expect(bus.crowdLevel,   equals(CrowdLevel.unknown));
      expect(bus.acStatus,     equals(AcStatus.unknown));
      expect(bus.riderCount,   equals(1));
      expect(bus.speedKmh,     equals(0));
    });
  });
}
