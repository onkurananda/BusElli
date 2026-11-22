/// BusElli — Location Service
/// Implements battery-efficient location polling per .bobrules §4.
///
/// Polling strategy:
///   - Active session: GPS 30s interval, LocationAccuracy.balanced
///   - Passive monitoring: LocationAccuracy.low, distanceFilter 100m
///   - Idle: Suspended (significant location changes only)
///   - BANNED: LocationAccuracy.best / bestForNavigation

import 'package:geolocator/geolocator.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Maximum GPS accuracy (metres) accepted before switching to cell-tower fallback.
const int kMaxGpsAccuracyMeters = 50;

/// GPS interval for active telemetry sessions (seconds). Per .bobrules §4.1.
const Duration kActiveSessionInterval = Duration(seconds: 30);

/// Distance filter (metres) for passive monitoring. Per .bobrules §4.1.
const double kPassiveDistanceFilterMeters = 100.0;

enum LocationSessionMode {
  /// User is actively on a bus and reporting telemetry.
  activeTelemetry,
  /// App is open but no session active — minimal GPS.
  passiveMonitoring,
  /// App backgrounded with no session — GPS suspended.
  idle,
}

class LocationService {
  LocationSessionMode _mode = LocationSessionMode.idle;
  Stream<Position>? _positionStream;

  /// Starts the location stream for the given mode.
  /// Returns a [Stream<Position>] the caller can listen to.
  ///
  /// Per .bobrules §4.1: Never use [LocationAccuracy.best] or
  /// [LocationAccuracy.bestForNavigation].
  Stream<Position> startSession(LocationSessionMode mode) {
    _mode = mode;

    final settings = _buildSettings(mode);
    _positionStream = Geolocator.getPositionStream(locationSettings: settings);
    return _positionStream!;
  }

  /// Stops all location polling. Call when session ends or app goes idle.
  void stopSession() {
    _mode = LocationSessionMode.idle;
    _positionStream = null;
  }

  LocationSessionMode get currentMode => _mode;

  /// Whether the current fix should fall back to cell-tower LUT.
  /// Per .bobrules §4.2: trigger fallback if accuracy > 50m.
  static bool shouldUseCellTowerFallback(Position position) {
    return position.accuracy > kMaxGpsAccuracyMeters;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  LocationSettings _buildSettings(LocationSessionMode mode) {
    switch (mode) {
      case LocationSessionMode.activeTelemetry:
        // .bobrules §4.1: balanced accuracy, 30s interval
        return AndroidSettings(
          accuracy: LocationAccuracy.balanced, // ⚠️ NEVER use best/bestForNavigation
          intervalDuration: kActiveSessionInterval,
          foregroundNotificationConfig: const ForegroundNotificationConfig(
            notificationTitle: 'BusElli — Live Sharing',
            notificationText: 'Sharing your bus location to help fellow commuters',
            enableWakeLock: false, // .bobrules §4.1 — no wake-lock drain
          ),
        );

      case LocationSessionMode.passiveMonitoring:
        // .bobrules §4.1: low accuracy, trigger only on 100m movement
        return const LocationSettings(
          accuracy: LocationAccuracy.low,
          distanceFilter: kPassiveDistanceFilterMeters.toInt(),
        );

      case LocationSessionMode.idle:
        // Should not normally be called with idle — caller should call stopSession()
        return const LocationSettings(
          accuracy: LocationAccuracy.low,
          distanceFilter: 500,
        );
    }
  }
}

/// Riverpod provider for the LocationService singleton.
final locationServiceProvider = Provider<LocationService>((ref) => LocationService());
