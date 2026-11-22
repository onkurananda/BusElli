/// BusElli — Geofence Alarm Service
/// Implements 2-stop wake-up alarm per .bobrules §4.5.
///
/// Rules enforced:
///   - Use GeofencingClient (Android) / CLLocationManager (iOS) — NOT continuous GPS polling
///   - Geofence radius: 300m per .bobrules §4.5
///   - Maximum 2 active geofences per session per .bobrules §4.5

import 'package:geofence_service/geofence_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Radius (metres) for the wake-up alarm geofence. Per .bobrules §4.5.
const double kAlarmGeofenceRadiusMeters = 300.0;

/// Maximum geofences active simultaneously per session. Per .bobrules §4.5.
const int kMaxActiveGeofences = 2;

class StopAlarm {
  final String stopId;
  final String stopName;
  final double lat;
  final double lng;
  final String routeId;

  const StopAlarm({
    required this.stopId,
    required this.stopName,
    required this.lat,
    required this.lng,
    required this.routeId,
  });
}

class GeofenceAlarmService {
  final _geofenceService = GeofenceService.instance;
  final _notifications = FlutterLocalNotificationsPlugin();

  final List<StopAlarm> _activeAlarms = [];

  /// Sets up a wake-up alarm for a stop, triggering 2 stops before the target.
  /// Accepts the trigger stop (not the destination stop).
  /// Per .bobrules §4.5: max 2 geofences active at once.
  Future<void> setAlarm(StopAlarm triggerStop) async {
    if (_activeAlarms.length >= kMaxActiveGeofences) {
      // Remove the oldest alarm to stay within the 2-geofence limit
      await _removeAlarm(_activeAlarms.first.stopId);
    }

    final geofence = Geofence(
      id: triggerStop.stopId,
      latitude: triggerStop.lat,
      longitude: triggerStop.lng,
      radius: [
        GeofenceRadius(
          id: 'radius_${triggerStop.stopId}',
          length: kAlarmGeofenceRadiusMeters,
        ),
      ],
    );

    await _geofenceService.addGeofence(geofence);
    _activeAlarms.add(triggerStop);
  }

  /// Clears all active geofences for the current session.
  Future<void> clearAllAlarms() async {
    for (final alarm in _activeAlarms) {
      await _geofenceService.removeGeofence(alarm.stopId);
    }
    _activeAlarms.clear();
  }

  /// Called by GeofenceService when a geofence is entered.
  Future<void> onGeofenceEntered(String stopId) async {
    final alarm = _activeAlarms.where((a) => a.stopId == stopId).firstOrNull;
    if (alarm == null) return;

    await _fireNotification(alarm);
    await _removeAlarm(stopId);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  Future<void> _removeAlarm(String stopId) async {
    await _geofenceService.removeGeofence(stopId);
    _activeAlarms.removeWhere((a) => a.stopId == stopId);
  }

  Future<void> _fireNotification(StopAlarm alarm) async {
    const androidDetails = AndroidNotificationDetails(
      'buselli_alarm',
      'BusElli Stop Alarms',
      channelDescription: '2-stop wake-up alerts',
      importance: Importance.max,
      priority: Priority.high,
      playSound: true,
      enableVibration: true,
    );
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentSound: true,
    );
    await _notifications.show(
      alarm.stopId.hashCode,
      '🔔 Get ready — ${alarm.stopName} is 2 stops away!',
      'Route ${alarm.routeId} · Tap to open BusElli',
      const NotificationDetails(android: androidDetails, iOS: iosDetails),
    );
  }
}
