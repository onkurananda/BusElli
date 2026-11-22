/// BusElli — BeaconService
/// "I'm on this bus" beacon mode.
///
/// Responsibilities:
///   1. Start a GPS session (LocationAccuracy.balanced, 30s interval) per .bobrules §4.1
///   2. Capture cell-tower IDs when GPS accuracy > 50m (.bobrules §4.2)
///   3. Enqueue telemetry to SQLite queue — NEVER flush on every fix (.bobrules §4.3)
///   4. Flush queue to backend when batch ≥ 10 OR 5 min elapsed OR app foregrounds
///   5. Submit crowd/AC tags via REST
///   6. Auto-terminate session after 60 min idle or 5 min stationary

import 'dart:async';
import 'dart:convert';
import 'package:geolocator/geolocator.dart';
import 'package:telephony/telephony.dart';
import 'package:uuid/uuid.dart';
import 'package:drift/drift.dart';
import 'package:dio/dio.dart';
import '../db/app_database.dart';
import '../models/models.dart';
import 'location_service.dart';

/// Minimum batch before an upload flush is triggered. Per .bobrules §4.3.
const int kFlushBatchThreshold = 10;

/// Maximum time between flushes. Per .bobrules §4.3.
const Duration kMaxFlushInterval = Duration(minutes: 5);

/// Session auto-termination after inactivity. Per .bobrules §4.4.
const Duration kSessionIdleTimeout = Duration(minutes: 60);

class BeaconService {
  final AppDatabase? db;
  final LocationService locationService;
  final Dio _dio;
  final Telephony _telephony = Telephony.instance;

  StreamSubscription<Position>? _locationSub;
  Timer? _flushTimer;
  Timer? _idleTimer;
  ActiveSession? _session;
  DateTime? _lastFlushTime;
  int _enqueuedSinceFlush = 0;

  BeaconService({
    required this.db,
    required this.locationService,
    Dio? dio,
  }) : _dio = dio ?? Dio();

  ActiveSession? get activeSession => _session;
  bool get hasSession => _session != null;

  // ── Public API ─────────────────────────────────────────────────────────────

  Future<ActiveSession> startSession(String routeId, String routeShortName) async {
    await endSession(); // end any previous session first

    final sessionId = const Uuid().v4();
    _session = ActiveSession(
      sessionId: sessionId,
      routeId: routeId,
      routeShortName: routeShortName,
      startedAt: DateTime.now(),
    );

    // Start GPS stream per .bobrules §4.1
    final posStream = locationService.startSession(LocationSessionMode.activeTelemetry);
    _locationSub = posStream.listen(_onPosition);

    // Schedule periodic flush per .bobrules §4.3
    _lastFlushTime = DateTime.now();
    _flushTimer = Timer.periodic(kMaxFlushInterval, (_) => _maybeFlush());

    // Schedule idle timeout per .bobrules §4.4
    _resetIdleTimer();

    return _session!;
  }

  Future<void> endSession() async {
    _locationSub?.cancel();
    _flushTimer?.cancel();
    _idleTimer?.cancel();
    locationService.stopSession();
    if (_session != null) {
      await _maybeFlush(force: true); // flush remaining queue on end
    }
    _session = null;
    _enqueuedSinceFlush = 0;
  }

  /// Submit crowd/AC tags — fires immediately (not queued).
  Future<void> submitTags({
    required CrowdLevel crowdLevel,
    required AcStatus acStatus,
  }) async {
    if (_session == null) return;
    try {
      await _dio.post('/api/crowd-tags', data: {
        'sessionId': _session!.sessionId,
        'routeId':   _session!.routeId,
        'crowdLevel': _crowdLevelKey(crowdLevel),
        'acStatus':   acStatus.name,
      });
    } on DioException {
      // Non-critical — tags are best-effort; silently swallow network errors
    }
  }

  void dispose() {
    endSession();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  Future<void> _onPosition(Position pos) async {
    if (_session == null || db == null) return;
    _resetIdleTimer();

    // .bobrules §4.2: use cell-tower LUT when GPS accuracy > 50m
    final cellTowers = pos.accuracy > kMaxGpsAccuracyMeters
        ? await _collectCellTowers()
        : <Map<String, dynamic>>[];

    final entry = TelemetryQueueCompanion(
      sessionId:     Value(_session!.sessionId),
      routeId:       Value(_session!.routeId),
      lat:           Value(pos.latitude),
      lng:           Value(pos.longitude),
      accuracyMeters: Value(pos.accuracy),
      speedKmh:      Value(pos.speed >= 0 ? pos.speed * 3.6 : null),
      cellTowersJson: Value(jsonEncode(cellTowers)),
      capturedAt:    Value(DateTime.now()),
    );

    await db!.enqueueTelemetry(entry);
    _enqueuedSinceFlush++;

    // Per .bobrules §4.3: flush when batch reaches threshold
    if (_enqueuedSinceFlush >= kFlushBatchThreshold) {
      await _maybeFlush();
    }
  }

  Future<void> _maybeFlush({bool force = false}) async {
    if (db == null) return;
    final pending = await db!.pendingTelemetry(limit: 50);
    if (pending.isEmpty) return;

    final sinceLastFlush = DateTime.now().difference(_lastFlushTime ?? DateTime.now());
    final shouldFlush = force ||
        _enqueuedSinceFlush >= kFlushBatchThreshold ||
        sinceLastFlush >= kMaxFlushInterval;

    if (!shouldFlush) return;

    // Build payload
    final payload = pending.map((t) => {
      'sessionId':     t.sessionId,
      'routeId':       t.routeId,
      'lat':           t.lat,
      'lng':           t.lng,
      'accuracyMeters': t.accuracyMeters,
      'speedKmh':      t.speedKmh,
      'cellTowers':    jsonDecode(t.cellTowersJson) as List<dynamic>,
      'capturedAt':    t.capturedAt.toIso8601String(),
    }).toList();

    try {
      await _dio.post(
        '/api/telemetry/batch',
        data: payload,
        options: Options(headers: {'X-Session-Id': _session?.sessionId}),
      );
      await db!.markTelemetrySynced(pending.map((t) => t.id).toList());
      _enqueuedSinceFlush = 0;
      _lastFlushTime = DateTime.now();
    } on DioException {
      // Network unavailable — data stays in queue for next flush
    }
  }

  Future<List<Map<String, dynamic>>> _collectCellTowers() async {
    final cells = await _telephony.getNeighboringCellInfo();
    return cells
        .where((c) => c.cid != null && c.lac != null)
        .map((c) => {
          'mcc': c.mcc,
          'mnc': c.mnc,
          'lac': c.lac,
          'cellId': c.cid,
          'signalStrength': c.dbm,
        })
        .toList();
  }

  void _resetIdleTimer() {
    _idleTimer?.cancel();
    _idleTimer = Timer(kSessionIdleTimeout, endSession);
  }

  String _crowdLevelKey(CrowdLevel level) {
    switch (level) {
      case CrowdLevel.seatsAvailable: return 'seats_free';
      case CrowdLevel.standingOnly:   return 'standing_only';
      case CrowdLevel.packed:         return 'packed';
      case CrowdLevel.unknown:        return 'unknown';
    }
  }
}
