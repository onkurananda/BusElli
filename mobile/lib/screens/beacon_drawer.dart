/// BusElli — Beacon Drawer
/// "I'm on this bus" bottom sheet with crowd/AC tag selection and karma display.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/models.dart';
import '../providers/providers.dart';

class BeaconDrawer extends ConsumerStatefulWidget {
  final String routeId;
  const BeaconDrawer({super.key, required this.routeId});

  @override
  ConsumerState<BeaconDrawer> createState() => _BeaconDrawerState();
}

class _BeaconDrawerState extends ConsumerState<BeaconDrawer> {
  CrowdLevel _crowdTag = CrowdLevel.unknown;
  AcStatus   _acTag   = AcStatus.unknown;
  bool _submitted = false;

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(activeSessionProvider);
    final isActive = session != null && session.routeId == widget.routeId;

    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Handle bar
          Center(
            child: Container(
              width: 36, height: 4,
              decoration: BoxDecoration(color: const Color(0xFF374151), borderRadius: BorderRadius.circular(2)),
            ),
          ),
          const SizedBox(height: 16),

          Text(
            isActive ? '✅ Live on Bus ${widget.routeId}' : "I'm on Bus ${widget.routeId}",
            style: const TextStyle(color: Color(0xFFF1F5F9), fontWeight: FontWeight.w700, fontSize: 15),
          ),
          const SizedBox(height: 4),
          const Text(
            'Share your live location + status · Earns karma ⭐',
            style: TextStyle(color: Color(0xFF6B7280), fontSize: 11),
          ),
          const SizedBox(height: 16),

          // Crowd tag grid
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
            childAspectRatio: 2.6,
            children: [
              _TagButton(
                icon: '💺', label: 'Seats Free', sub: 'Lots of space',
                selected: _crowdTag == CrowdLevel.seatsAvailable,
                onTap: () => setState(() => _crowdTag = CrowdLevel.seatsAvailable),
              ),
              _TagButton(
                icon: '👥', label: 'Crowded', sub: 'Standing only',
                selected: _crowdTag == CrowdLevel.standingOnly,
                onTap: () => setState(() => _crowdTag = CrowdLevel.standingOnly),
              ),
              _TagButton(
                icon: '🚨', label: 'Packed', sub: "Can't board",
                selected: _crowdTag == CrowdLevel.packed,
                onTap: () => setState(() => _crowdTag = CrowdLevel.packed),
              ),
              _TagButton(
                icon: '❄️', label: 'AC Working', sub: 'Cool & running',
                selected: _acTag == AcStatus.ok,
                onTap: () => setState(() => _acTag = _acTag == AcStatus.ok ? AcStatus.unknown : AcStatus.ok),
              ),
            ],
          ),
          const SizedBox(height: 14),

          // Karma row
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: const Color(0xFF0F172A),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Row(
              children: [
                Text('⭐', style: TextStyle(fontSize: 20)),
                SizedBox(width: 10),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('+5 Karma Points', style: TextStyle(color: Color(0xFFFBBF24), fontWeight: FontWeight.w600, fontSize: 12)),
                    Text('Your total: 234 pts · Rank #47 on ORR Corridor',
                        style: TextStyle(color: Color(0xFF6B7280), fontSize: 10)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Start / Submit button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: _submitted
                    ? const Color(0xFF059669)
                    : const Color(0xFF1D4ED8),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              onPressed: _submitted ? null : () => _onSubmit(isActive),
              child: Text(
                _submitted
                    ? '✅ Status Shared! +5 ⭐'
                    : isActive
                        ? '📡 Update Live Status'
                        : '📍 Start Sharing Location',
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 14),
              ),
            ),
          ),
          if (isActive) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: TextButton(
                onPressed: () async {
                  await ref.read(activeSessionProvider.notifier).endSession();
                  if (context.mounted) Navigator.pop(context);
                },
                child: const Text('Stop Sharing', style: TextStyle(color: Color(0xFF6B7280), fontSize: 13)),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _onSubmit(bool isActive) async {
    setState(() => _submitted = true);

    if (!isActive) {
      // Start a new session
      final db = await ref.read(databaseProvider.future);
      final routes = await db.searchRoutes(widget.routeId, limit: 1);
      final shortName = routes.isNotEmpty ? routes.first.shortName : widget.routeId;
      await ref.read(activeSessionProvider.notifier).startSession(widget.routeId, shortName);
    }

    // Submit tags if selected
    if (_crowdTag != CrowdLevel.unknown || _acTag != AcStatus.unknown) {
      await ref.read(activeSessionProvider.notifier).updateTags(
        crowd: _crowdTag != CrowdLevel.unknown ? _crowdTag : null,
        ac: _acTag != AcStatus.unknown ? _acTag : null,
      );
    }

    await Future.delayed(const Duration(seconds: 2));
    if (mounted) Navigator.pop(context);
  }
}

// ── Tag button ────────────────────────────────────────────────────────────────

class _TagButton extends StatelessWidget {
  final String icon;
  final String label;
  final String sub;
  final bool selected;
  final VoidCallback onTap;

  const _TagButton({
    required this.icon, required this.label, required this.sub,
    required this.selected, required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFF1E3A5F) : const Color(0xFF0F172A),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? const Color(0xFF3B82F6) : const Color(0xFF374151),
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Text(icon, style: const TextStyle(fontSize: 18)),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(label, style: const TextStyle(color: Color(0xFFE2E8F0), fontWeight: FontWeight.w600, fontSize: 11)),
                Text(sub, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 9)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
