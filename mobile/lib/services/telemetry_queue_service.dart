/// BusElli — Telemetry Queue Service
/// Implements batched offline-first telemetry per .bobrules §4.3.
///
/// Rules enforced:
///   - Never flush on every GPS fix (banned per .bobrules §4.3)
///   - Flush when: batch >= 10 points, OR >= 5 min since last flush, OR app foregrounds
///   - Use WorkManager for background flush — not isolates or timers

import 'dart:convert';
import 'package:drift/drift.dart';
import 'package:workmanager/workmanager.dart';

/// Minimum batch size before a flush is triggered. Per .bobrules §4.3.
const int kFlushBatchSize = 10;

/// Maximum age (minutes) before a pending batch is force-flushed. Per .bobrules §4.3.
const Duration kMaxFlushInterval = Duration(minutes: 5);

const String kBackgroundFlushTaskName = 'buselli.telemetry.flush';

/// A single telemetry point pending upload.
class TelemetryQueueEntry {
  final String sessionId;
  final String routeId;
  final double lat;
  final double lng;
  final double accuracyMeters;
  final double? speedKmh;
  final List<Map<String, dynamic>> cellTowers;
  final DateTime capturedAt;

  const TelemetryQueueEntry({
    required this.sessionId,
    required this.routeId,
    required this.lat,
    required this.lng,
    required this.accuracyMeters,
    this.speedKmh,
    required this.cellTowers,
    required this.capturedAt,
  });

  Map<String, dynamic> toJson() => {
    'sessionId': sessionId,
    'routeId': routeId,
    'lat': lat,
    'lng': lng,
    'accuracyMeters': accuracyMeters,
    if (speedKmh != null) 'speedKmh': speedKmh,
    'cellTowers': cellTowers,
    'capturedAt': capturedAt.toIso8601String(),
  };
}

abstract class TelemetryQueueService {
  /// Enqueues a telemetry point. Does NOT flush immediately.
  /// Per .bobrules §4.3: flushing on every fix is BANNED.
  Future<void> enqueue(TelemetryQueueEntry entry);

  /// Checks flush conditions and uploads if met.
  /// Called by WorkManager background task and on app foreground.
  Future<void> maybeFlush();

  /// Force-flush all pending points. Used when app terminates.
  Future<void> flushAll();

  /// Returns the count of pending (unsynced) entries.
  Future<int> pendingCount();
}

/// Registers the WorkManager background flush task.
/// Must be called once at app startup. Per .bobrules §4.3.
Future<void> registerBackgroundFlushTask() async {
  await Workmanager().registerPeriodicTask(
    kBackgroundFlushTaskName,
    kBackgroundFlushTaskName,
    frequency: kMaxFlushInterval,
    constraints: Constraints(
      networkType: NetworkType.connected,
      requiresBatteryNotLow: false, // flush even on low battery — data is valuable
    ),
  );
}
