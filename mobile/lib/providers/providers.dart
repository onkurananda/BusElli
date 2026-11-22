/// BusElli — Riverpod providers
/// Central wiring for DB, services, and live state notifiers.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../db/app_database.dart';
import '../models/models.dart';
import '../services/location_service.dart';
import '../services/beacon_service.dart';
import '../services/websocket_service.dart';
import '../services/geofence_alarm_service.dart';

// ── Database ──────────────────────────────────────────────────────────────────

final databaseProvider = FutureProvider<AppDatabase>((ref) async {
  final db = await openAppDatabase();
  ref.onDispose(db.close);
  return db;
});

// ── GTFS search ──────────────────────────────────────────────────────────────

final stopSearchProvider = FutureProvider.family<List<BusStop>, String>((ref, query) async {
  if (query.length < 2) return [];
  final db = await ref.watch(databaseProvider.future);
  final rows = await db.searchStops(query);
  return rows.map((r) => BusStop(stopId: r.stopId, stopName: r.stopName, lat: r.lat, lng: r.lng)).toList();
});

final routeSearchProvider = FutureProvider.family<List<BusRoute>, String>((ref, query) async {
  if (query.isEmpty) return [];
  final db = await ref.watch(databaseProvider.future);
  final rows = await db.searchRoutes(query);
  return rows.map((r) => BusRoute(routeId: r.routeId, shortName: r.shortName, longName: r.longName, color: r.color)).toList();
});

final nearbyStopsProvider = FutureProvider.family<List<BusStop>, ({double lat, double lng})>((ref, loc) async {
  final db = await ref.watch(databaseProvider.future);
  final rows = await db.nearbyStops(lat: loc.lat, lng: loc.lng);
  return rows.map((r) => BusStop(stopId: r.stopId, stopName: r.stopName, lat: r.lat, lng: r.lng)).toList();
});

final recentRoutesProvider = FutureProvider<List<BusRoute>>((ref) async {
  final db = await ref.watch(databaseProvider.future);
  final rows = await db.recentRoutes();
  return rows.map((r) => BusRoute(routeId: r.routeId, shortName: r.shortName, longName: r.longName, color: r.color)).toList();
});

// ── Live buses (WebSocket) ────────────────────────────────────────────────────

final webSocketServiceProvider = Provider<WebSocketService>((ref) {
  final svc = WebSocketService();
  ref.onDispose(svc.dispose);
  return svc;
});

final liveBusesProvider = StreamProvider.family<List<LiveBus>, String>((ref, routeId) {
  final ws = ref.watch(webSocketServiceProvider);
  return ws.busUpdatesForRoute(routeId);
});

// ── Beacon / "I'm on this bus" ────────────────────────────────────────────────

final beaconServiceProvider = Provider<BeaconService>((ref) {
  final db = ref.watch(databaseProvider).value;
  final locationSvc = ref.watch(locationServiceProvider);
  final svc = BeaconService(db: db, locationService: locationSvc);
  ref.onDispose(svc.dispose);
  return svc;
});

final activeSessionProvider = StateNotifierProvider<ActiveSessionNotifier, ActiveSession?>((ref) {
  final beacon = ref.watch(beaconServiceProvider);
  return ActiveSessionNotifier(beacon);
});

// ── Alarms ────────────────────────────────────────────────────────────────────

final geofenceAlarmServiceProvider = Provider<GeofenceAlarmService>((ref) {
  final svc = GeofenceAlarmService();
  ref.onDispose(svc.clearAllAlarms);
  return svc;
});

final savedAlarmsProvider = StreamProvider<List<SavedAlarm>>((ref) async* {
  final db = await ref.watch(databaseProvider.future);
  yield* db.watchAlarms();
});

// ── Active session notifier ───────────────────────────────────────────────────

class ActiveSessionNotifier extends StateNotifier<ActiveSession?> {
  ActiveSessionNotifier(this._beacon) : super(null);

  final BeaconService _beacon;

  Future<void> startSession(String routeId, String routeShortName) async {
    final session = await _beacon.startSession(routeId, routeShortName);
    state = session;
  }

  Future<void> updateTags({CrowdLevel? crowd, AcStatus? ac}) async {
    if (state == null) return;
    if (crowd != null) state!.crowdTag = crowd;
    if (ac != null)    state!.acTag    = ac;
    await _beacon.submitTags(crowdLevel: crowd ?? state!.crowdTag, acStatus: ac ?? state!.acTag);
    state = state; // trigger rebuild
  }

  Future<void> endSession() async {
    await _beacon.endSession();
    state = null;
  }
}
