/// BusElli — Alarms Screen
/// Manage active 2-stop wake-up alarms with offline cell-tower geofencing.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:drift/drift.dart' show Value;
import '../db/app_database.dart';
import '../models/models.dart';
import '../providers/providers.dart';
import '../services/geofence_alarm_service.dart';

class AlarmsScreen extends ConsumerWidget {
  const AlarmsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alarmsAsync = ref.watch(savedAlarmsProvider);

    return Scaffold(
      backgroundColor: const Color(0xFF111827),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHeader(),
            Expanded(
              child: alarmsAsync.when(
                data:    (alarms) => alarms.isEmpty ? _EmptyState() : _AlarmList(alarms: alarms),
                loading: () => const Center(child: CircularProgressIndicator(color: Color(0xFF3B82F6))),
                error:   (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: Colors.red))),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(colors: [Color(0xFF312E81), Color(0xFF4C1D95)]),
      ),
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: const [
          Text('Stop Wake-Up Alarms', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 18)),
          SizedBox(height: 2),
          Text('Cell-tower geofencing · Works offline', style: TextStyle(color: Color(0xFF818CF8), fontSize: 12)),
        ],
      ),
    );
  }
}

// ── Empty state ────────────────────────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('🔔', style: TextStyle(fontSize: 48)),
          SizedBox(height: 16),
          Text('No alarms set', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 16, fontWeight: FontWeight.w700)),
          SizedBox(height: 8),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 40),
            child: Text(
              'Open a route, tap the 🔔 on any stop, and your alarm will fire 2 stops before — even with no data.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xFF64748B), fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Alarm list ─────────────────────────────────────────────────────────────────

class _AlarmList extends ConsumerWidget {
  final List<SavedAlarm> alarms;
  const _AlarmList({required this.alarms});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        _OfflineNotice(),
        const SizedBox(height: 16),
        ...alarms.map((a) => _AlarmCard(alarm: a)),
      ],
    );
  }
}

class _OfflineNotice extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2035),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF2A3550)),
      ),
      child: const Row(
        children: [
          Text('📵', style: TextStyle(fontSize: 20)),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Offline Mode Active', style: TextStyle(color: Color(0xFFFBBF24), fontWeight: FontWeight.w700, fontSize: 12)),
                SizedBox(height: 3),
                Text(
                  'Alarms use cell-tower geofencing and trigger even with mobile data disabled.',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Alarm card ────────────────────────────────────────────────────────────────

class _AlarmCard extends ConsumerWidget {
  final SavedAlarm alarm;
  const _AlarmCard({required this.alarm});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF1F2937),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: alarm.enabled ? const Color(0xFF4338CA) : const Color(0xFF374151),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(alarm.stopName,
                    style: TextStyle(
                      color: alarm.enabled ? const Color(0xFFA5B4FC) : const Color(0xFF6B7280),
                      fontWeight: FontWeight.w700, fontSize: 13,
                    )),
                const SizedBox(height: 2),
                Text('Route ${alarm.routeId} · 2 stops before alert',
                    style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
              ],
            ),
          ),
          Switch(
            value: alarm.enabled,
            activeColor: const Color(0xFF3B82F6),
            onChanged: (val) => _toggleAlarm(context, ref, val),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline, color: Color(0xFF6B7280), size: 20),
            onPressed: () => _deleteAlarm(context, ref),
          ),
        ],
      ),
    );
  }

  Future<void> _toggleAlarm(BuildContext context, WidgetRef ref, bool enabled) async {
    final db = await ref.read(databaseProvider.future);
    await db.upsertAlarm(SavedAlarmsCompanion(
      alarmId:  Value(alarm.alarmId),
      stopId:   Value(alarm.stopId),
      stopName: Value(alarm.stopName),
      routeId:  Value(alarm.routeId),
      stopLat:  Value(alarm.stopLat),
      stopLng:  Value(alarm.stopLng),
      enabled:  Value(enabled),
      createdAt: Value(alarm.createdAt),
    ));
    final alarmSvc = ref.read(geofenceAlarmServiceProvider);
    if (enabled) {
      await alarmSvc.setAlarm(StopAlarm(
        stopId: alarm.stopId, stopName: alarm.stopName,
        lat: alarm.stopLat, lng: alarm.stopLng, routeId: alarm.routeId,
      ));
    } else {
      await alarmSvc.clearAllAlarms();
    }
  }

  Future<void> _deleteAlarm(BuildContext context, WidgetRef ref) async {
    final db = await ref.read(databaseProvider.future);
    await db.deleteAlarm(alarm.alarmId);
    final alarmSvc = ref.read(geofenceAlarmServiceProvider);
    await alarmSvc.clearAllAlarms();
  }
}
