/// BusElli — Live Route Screen
/// Vertical stop timeline with live bus markers and crowd-density badges.
/// Inspired by "Where Is My Train" linear route view.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/models.dart';
import '../providers/providers.dart';
import '../widgets/crowd_badge.dart';
import '../widgets/bus_marker.dart';
import 'beacon_drawer.dart';

class LiveRouteScreen extends ConsumerWidget {
  final String routeId;
  const LiveRouteScreen({super.key, required this.routeId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final routeAsync  = ref.watch(routeSearchProvider(routeId));
    final liveBuses   = ref.watch(liveBusesProvider(routeId));
    final db          = ref.watch(databaseProvider);

    return Scaffold(
      backgroundColor: const Color(0xFF111827),
      body: SafeArea(
        child: Column(
          children: [
            routeAsync.when(
              data: (routes) {
                final route = routes.isNotEmpty ? routes.first : null;
                return _RouteHeader(routeId: routeId, route: route, liveBuses: liveBuses);
              },
              loading: () => _RouteHeader(routeId: routeId, route: null, liveBuses: liveBuses),
              error: (_, __) => _RouteHeader(routeId: routeId, route: null, liveBuses: liveBuses),
            ),
            Expanded(
              child: db.when(
                data: (database) => _StopTimeline(
                  routeId: routeId,
                  database: database,
                  liveBuses: liveBuses.valueOrNull ?? [],
                ),
                loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF3B82F6))),
                error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Colors.red))),
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: _BeaconFab(routeId: routeId),
    );
  }
}

// ── Route header ──────────────────────────────────────────────────────────────

class _RouteHeader extends StatelessWidget {
  final String routeId;
  final BusRoute? route;
  final AsyncValue<List<LiveBus>> liveBuses;

  const _RouteHeader({required this.routeId, required this.route, required this.liveBuses});

  @override
  Widget build(BuildContext context) {
    final busCount = liveBuses.valueOrNull?.length ?? 0;

    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF064E3B), Color(0xFF065F46)],
        ),
      ),
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              GestureDetector(
                onTap: () => Navigator.of(context).pop(),
                child: const Icon(Icons.arrow_back, color: Color(0xFFA7F3D0), size: 20),
              ),
              const SizedBox(width: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(color: const Color(0xFF059669), borderRadius: BorderRadius.circular(8)),
                child: Text(routeId, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 16)),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(route?.longName ?? '—',
                        style: const TextStyle(color: Color(0xFFA7F3D0), fontSize: 13, fontWeight: FontWeight.w600),
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                    Text('${route?.longName != null ? '' : 'Loading…'}',
                        style: const TextStyle(color: Color(0xFF6EE7B7), fontSize: 10)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            children: [
              _InfoChip(busCount > 0 ? '🟢 $busCount Live Bus${busCount > 1 ? 'es' : ''}' : '📅 Schedule mode'),
              const _InfoChip('⬇️ Offline OK'),
              if (liveBuses.isLoading) const _InfoChip('🔄 Updating…'),
            ],
          ),
        ],
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final String label;
  const _InfoChip(this.label);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(label, style: const TextStyle(color: Color(0xFFD1FAE5), fontSize: 10, fontWeight: FontWeight.w600)),
    );
  }
}

// ── Stop timeline ─────────────────────────────────────────────────────────────

class _StopTimeline extends ConsumerWidget {
  final String routeId;
  final AppDatabase database;
  final List<LiveBus> liveBuses;

  const _StopTimeline({
    required this.routeId,
    required this.database,
    required this.liveBuses,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder<List<_StopEntry>>(
      future: _buildStopEntries(),
      builder: (context, snap) {
        if (!snap.hasData) {
          return const Center(child: CircularProgressIndicator(color: Color(0xFF3B82F6)));
        }
        final entries = snap.data!;
        return ListView.builder(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
          itemCount: entries.length,
          itemBuilder: (ctx, i) {
            final entry = entries[i];
            final isFirst = i == 0;
            final isLast  = i == entries.length - 1;
            final busHere = _busNearStop(entry.stop, liveBuses);

            return _StopRow(
              entry:   entry,
              busHere: busHere,
              isPassed: false, // TODO: derive from user location
              isFirst:  isFirst,
              isLast:   isLast,
              onAlarm: () => _showAlarmOption(context, ref, entry.stop),
            );
          },
        );
      },
    );
  }

  Future<List<_StopEntry>> _buildStopEntries() async {
    final trips = await database.tripsForRoute(routeId);
    if (trips.isEmpty) return [];
    final tripId   = trips.first.tripId;
    final stopTimes = await database.stopTimesForTrip(tripId);
    if (stopTimes.isEmpty) return [];

    // Fetch stop names in one go
    final stopIds  = stopTimes.map((s) => s.stopId).toSet();
    final allStops = await database.searchStops('', limit: 9999);
    final stopMap  = {for (final s in allStops) s.stopId: s};

    return stopTimes.map((st) {
      final stop = stopMap[st.stopId];
      return _StopEntry(
        stop: stop != null
            ? BusStop(stopId: stop.stopId, stopName: stop.stopName, lat: stop.lat, lng: stop.lng)
            : BusStop(stopId: st.stopId, stopName: st.stopId, lat: 0, lng: 0),
        sequence: st.stopSequence,
        arrivalSeconds: st.arrivalTimeSeconds,
        shapeDistMeters: st.shapeDistTraveled ?? 0,
      );
    }).toList();
  }

  LiveBus? _busNearStop(BusStop stop, List<LiveBus> buses) {
    for (final bus in buses) {
      if (bus.nearestStopId == stop.stopId) return bus;
    }
    return null;
  }

  void _showAlarmOption(BuildContext context, WidgetRef ref, BusStop stop) {
    final alarmSvc = ref.read(geofenceAlarmServiceProvider);
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1A2035),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _AlarmSheet(stop: stop, routeId: routeId, alarmService: alarmSvc),
    );
  }
}

class _StopEntry {
  final BusStop stop;
  final int sequence;
  final int arrivalSeconds;
  final double shapeDistMeters;
  const _StopEntry({
    required this.stop, required this.sequence,
    required this.arrivalSeconds, required this.shapeDistMeters,
  });
}

// ── Stop row ──────────────────────────────────────────────────────────────────

class _StopRow extends StatelessWidget {
  final _StopEntry entry;
  final LiveBus? busHere;
  final bool isPassed;
  final bool isFirst;
  final bool isLast;
  final VoidCallback onAlarm;

  const _StopRow({
    required this.entry, required this.busHere, required this.isPassed,
    required this.isFirst, required this.isLast, required this.onAlarm,
  });

  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Timeline column
          SizedBox(
            width: 36,
            child: Column(
              children: [
                // Top line
                if (!isFirst)
                  Expanded(
                    child: Container(
                      width: 2,
                      color: isPassed ? const Color(0xFF059669) : const Color(0xFF1F2937),
                    ),
                  ),
                // Node dot
                Container(
                  width: isFirst || isLast ? 14 : 12,
                  height: isFirst || isLast ? 14 : 12,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isFirst || isLast
                        ? const Color(0xFF1D4ED8)
                        : isPassed
                            ? const Color(0xFF059669)
                            : const Color(0xFF111827),
                    border: Border.all(
                      color: isPassed ? const Color(0xFF059669) : const Color(0xFF4B5563),
                      width: 2,
                    ),
                    boxShadow: busHere != null
                        ? [BoxShadow(color: const Color(0xFF3B82F6).withOpacity(0.5), blurRadius: 6)]
                        : null,
                  ),
                ),
                // Bottom line
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 2,
                      color: isPassed ? const Color(0xFF059669) : const Color(0xFF1F2937),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          // Stop content
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          entry.stop.stopName,
                          style: TextStyle(
                            color: isPassed ? const Color(0xFF4B5563) : const Color(0xFFE2E8F0),
                            fontWeight: FontWeight.w600,
                            fontSize: 12,
                          ),
                        ),
                      ),
                      GestureDetector(
                        onTap: onAlarm,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFF312E81),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Text('🔔', style: TextStyle(fontSize: 10)),
                        ),
                      ),
                    ],
                  ),
                  if (busHere != null) ...[
                    const SizedBox(height: 4),
                    BusMarker(bus: busHere!),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Alarm sheet ───────────────────────────────────────────────────────────────

class _AlarmSheet extends ConsumerWidget {
  final BusStop stop;
  final String routeId;
  final GeofenceAlarmService alarmService;

  const _AlarmSheet({required this.stop, required this.routeId, required this.alarmService});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(width: 36, height: 4, decoration: BoxDecoration(color: const Color(0xFF374151), borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 16),
          const Text('Set Wake-Up Alarm', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 4),
          Text('Alert 2 stops before ${stop.stopName}', style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF0D1117),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFF2A3550)),
            ),
            child: const Row(
              children: [
                Icon(Icons.phone_android, color: Color(0xFFFBBF24), size: 18),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Works offline via cell-tower geofencing — no data needed at alert time.',
                    style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1D4ED8),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              onPressed: () async {
                await alarmService.setAlarm(StopAlarm(
                  stopId: stop.stopId, stopName: stop.stopName,
                  lat: stop.lat, lng: stop.lng, routeId: routeId,
                ));
                // Also persist to DB
                final db = await ref.read(databaseProvider.future);
                await db.upsertAlarm(SavedAlarmsCompanion(
                  alarmId:  Value(stop.stopId),
                  stopId:   Value(stop.stopId),
                  stopName: Value(stop.stopName),
                  routeId:  Value(routeId),
                  stopLat:  Value(stop.lat),
                  stopLng:  Value(stop.lng),
                  createdAt: Value(DateTime.now()),
                ));
                if (context.mounted) Navigator.pop(context);
              },
              child: const Text('🔔 Set Alarm', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 14)),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Beacon FAB ────────────────────────────────────────────────────────────────

class _BeaconFab extends ConsumerWidget {
  final String routeId;
  const _BeaconFab({required this.routeId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(activeSessionProvider);
    return FloatingActionButton(
      backgroundColor: session != null ? const Color(0xFF059669) : const Color(0xFF1D4ED8),
      onPressed: () => _openBeaconDrawer(context, ref),
      child: const Text('📍', style: TextStyle(fontSize: 22)),
    );
  }

  void _openBeaconDrawer(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF1A2035),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => BeaconDrawer(routeId: routeId),
    );
  }
}
