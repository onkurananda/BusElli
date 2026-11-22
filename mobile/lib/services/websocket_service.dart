/// BusElli — WebSocket service
/// Maintains a persistent WebSocket connection to the backend and broadcasts
/// bus position updates as typed Dart streams.

import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../models/models.dart';

class WebSocketService {
  static const _reconnectDelay = Duration(seconds: 5);

  WebSocketChannel? _channel;
  Timer? _reconnectTimer;
  bool _disposed = false;

  /// Per-route bus update streams. Listeners subscribe by route ID.
  final Map<String, StreamController<List<LiveBus>>> _routeControllers = {};

  /// Current live bus state keyed by clusterId.
  final Map<String, LiveBus> _busState = {};

  /// Connects to the backend WebSocket hub.
  /// Call once at app startup.
  void connect(String wsUrl) {
    if (_disposed) return;
    _channel = WebSocketChannel.connect(Uri.parse(wsUrl));
    _channel!.stream.listen(
      _handleMessage,
      onError: (_) => _scheduleReconnect(wsUrl),
      onDone:  () => _scheduleReconnect(wsUrl),
    );
  }

  /// Returns a stream of live buses for `routeId`.
  /// The stream is kept alive across reconnections.
  Stream<List<LiveBus>> busUpdatesForRoute(String routeId) {
    _routeControllers.putIfAbsent(
      routeId,
      () => StreamController<List<LiveBus>>.broadcast(),
    );
    // Emit current state immediately on subscribe
    final existing = _currentBusesForRoute(routeId);
    if (existing.isNotEmpty) {
      Future.microtask(() => _routeControllers[routeId]?.add(existing));
    }
    return _routeControllers[routeId]!.stream;
  }

  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    for (final ctrl in _routeControllers.values) {
      ctrl.close();
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  void _handleMessage(dynamic raw) {
    final Map<String, dynamic> msg;
    try {
      msg = jsonDecode(raw as String) as Map<String, dynamic>;
    } catch (_) {
      return;
    }

    final type = msg['type'] as String?;

    if (type == 'BUS_POSITION_UPDATE') {
      final bus = LiveBus.fromJson(msg);
      _busState[bus.clusterId] = bus;
      _emit(bus.routeId);
    } else if (type == 'CROWD_TAG_UPDATE') {
      final clusterId = msg['clusterId'] as String?;
      final routeId   = msg['routeId']   as String?;
      if (clusterId != null && _busState.containsKey(clusterId)) {
        // Patch crowd/AC onto the existing bus entry
        final existing = _busState[clusterId]!;
        _busState[clusterId] = LiveBus(
          clusterId:    existing.clusterId,
          routeId:      existing.routeId,
          lat:          existing.lat,
          lng:          existing.lng,
          speedKmh:     existing.speedKmh,
          confidence:   existing.confidence,
          riderCount:   existing.riderCount,
          crowdLevel:   CrowdLevel.fromString(msg['crowdLevel'] as String?),
          acStatus:     existing.acStatus,
          updatedAt:    existing.updatedAt,
          nearestStopId: existing.nearestStopId,
        );
        if (routeId != null) _emit(routeId);
      }
    }
  }

  void _emit(String routeId) {
    final buses = _currentBusesForRoute(routeId);
    _routeControllers[routeId]?.add(buses);
  }

  List<LiveBus> _currentBusesForRoute(String routeId) =>
      _busState.values.where((b) => b.routeId == routeId && !b.isStale).toList();

  void _scheduleReconnect(String wsUrl) {
    if (_disposed) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(_reconnectDelay, () => connect(wsUrl));
  }
}
