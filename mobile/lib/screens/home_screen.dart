/// BusElli — Home Screen
/// Route/stop search + nearby stops + recent routes.
/// Offline indicator always visible in header.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../models/models.dart';
import '../providers/providers.dart';
import '../widgets/offline_badge.dart';
import '../widgets/crowd_badge.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF111827),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHeader(),
            _buildSearchBar(),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF1E3A8A), Color(0xFF1D4ED8)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
      child: Row(
        children: [
          Container(
            width: 32, height: 32,
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8)),
            child: const Center(child: Text('🚌', style: TextStyle(fontSize: 18))),
          ),
          const SizedBox(width: 10),
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('BusElli', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 20)),
              Text('Bengaluru Live Transit', style: TextStyle(color: Color(0xFF93C5FD), fontSize: 11)),
            ],
          ),
          const Spacer(),
          const OfflineBadge(),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(colors: [Color(0xFF1E3A8A), Color(0xFF1D4ED8)]),
      ),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.95),
          borderRadius: BorderRadius.circular(14),
        ),
        child: TextField(
          controller: _searchController,
          onChanged: (v) => setState(() => _query = v.trim()),
          decoration: InputDecoration(
            hintText: 'Search bus no. or stop (e.g. 500D, Silk Board)…',
            hintStyle: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 13),
            prefixIcon: const Icon(Icons.search, color: Color(0xFF6B7280)),
            suffixIcon: _query.isNotEmpty
                ? IconButton(
                    icon: const Icon(Icons.clear, color: Color(0xFF6B7280)),
                    onPressed: () {
                      _searchController.clear();
                      setState(() => _query = '');
                    },
                  )
                : null,
            border: InputBorder.none,
            contentPadding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_query.length >= 2) {
      return _buildSearchResults();
    }
    return _buildDefaultContent();
  }

  Widget _buildSearchResults() {
    final routeResults = ref.watch(routeSearchProvider(_query));
    final stopResults  = ref.watch(stopSearchProvider(_query));

    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: [
        routeResults.when(
          data: (routes) {
            if (routes.isEmpty) return const SizedBox.shrink();
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _sectionLabel('ROUTES'),
                ...routes.map((r) => _RouteResultTile(route: r)),
              ],
            );
          },
          loading: () => const SizedBox.shrink(),
          error: (_, __) => const SizedBox.shrink(),
        ),
        stopResults.when(
          data: (stops) {
            if (stops.isEmpty) return const SizedBox.shrink();
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _sectionLabel('STOPS'),
                ...stops.map((s) => _StopResultTile(stop: s)),
              ],
            );
          },
          loading: () => const Center(child: Padding(
            padding: EdgeInsets.all(24),
            child: CircularProgressIndicator(color: Color(0xFF3B82F6)),
          )),
          error: (_, __) => const SizedBox.shrink(),
        ),
      ],
    );
  }

  Widget _buildDefaultContent() {
    return ListView(
      padding: const EdgeInsets.only(top: 14),
      children: [
        _sectionLabel('NEARBY STOPS'),
        _NearbyStopsRow(),
        _sectionLabel('RECENT ROUTES'),
        _RecentRoutesList(),
        const SizedBox(height: 20),
      ],
    );
  }

  Widget _sectionLabel(String text) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
    child: Text(text, style: const TextStyle(color: Color(0xFF64748B), fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
  );
}

// ── Route result tile ─────────────────────────────────────────────────────────

class _RouteResultTile extends StatelessWidget {
  final BusRoute route;
  const _RouteResultTile({required this.route});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => context.push('/route/${route.routeId}'),
      child: Container(
        margin: const EdgeInsets.fromLTRB(20, 0, 20, 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFF1F2937),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFF374151)),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: const Color(0xFF1D4ED8),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(route.shortName,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(route.longName, style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 13, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: Color(0xFF6B7280)),
          ],
        ),
      ),
    );
  }
}

// ── Stop result tile ──────────────────────────────────────────────────────────

class _StopResultTile extends StatelessWidget {
  final BusStop stop;
  const _StopResultTile({required this.stop});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => context.push('/stop/${stop.stopId}'),
      child: Container(
        margin: const EdgeInsets.fromLTRB(20, 0, 20, 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: const Color(0xFF1F2937),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFF374151)),
        ),
        child: Row(
          children: [
            const Icon(Icons.location_on, color: Color(0xFF60A5FA), size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Text(stop.stopName, style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 13, fontWeight: FontWeight.w600)),
            ),
            const Icon(Icons.chevron_right, color: Color(0xFF6B7280)),
          ],
        ),
      ),
    );
  }
}

// ── Nearby stops row ──────────────────────────────────────────────────────────

class _NearbyStopsRow extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Placeholder — in production, wire to current GPS location
    const demoLoc = (lat: 12.9165, lng: 77.6101);
    final nearby = ref.watch(nearbyStopsProvider(demoLoc));

    return SizedBox(
      height: 130,
      child: nearby.when(
        data: (stops) {
          if (stops.isEmpty) {
            return const Center(child: Text('No nearby stops', style: TextStyle(color: Color(0xFF64748B))));
          }
          return ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
            itemCount: stops.length,
            separatorBuilder: (_, __) => const SizedBox(width: 10),
            itemBuilder: (_, i) => _NearbyStopCard(stop: stops[i]),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF3B82F6))),
        error: (_, __) => const SizedBox.shrink(),
      ),
    );
  }
}

class _NearbyStopCard extends StatelessWidget {
  final BusStop stop;
  const _NearbyStopCard({required this.stop});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => context.push('/stop/${stop.stopId}'),
      child: Container(
        width: 170,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFF1F2937),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFF374151)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(stop.stopName,
                style: const TextStyle(color: Color(0xFFF1F5F9), fontWeight: FontWeight.w700, fontSize: 12),
                maxLines: 2, overflow: TextOverflow.ellipsis),
            const Text('🚶 ~180m away', style: TextStyle(color: Color(0xFF6B7280), fontSize: 10)),
            const SizedBox(height: 6),
            const CrowdBadge(level: CrowdLevel.seatsAvailable, busNumber: '500D', eta: '3 min'),
            const SizedBox(height: 4),
            const CrowdBadge(level: CrowdLevel.packed, busNumber: '335E', eta: '7 min'),
          ],
        ),
      ),
    );
  }
}

// ── Recent routes list ────────────────────────────────────────────────────────

class _RecentRoutesList extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recent = ref.watch(recentRoutesProvider);
    return recent.when(
      data: (routes) {
        if (routes.isEmpty) {
          return const Padding(
            padding: EdgeInsets.fromLTRB(20, 8, 20, 8),
            child: Text('Search for a route above to get started',
                style: TextStyle(color: Color(0xFF64748B), fontSize: 13)),
          );
        }
        return Column(children: routes.map((r) => _RouteResultTile(route: r)).toList());
      },
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
    );
  }
}
