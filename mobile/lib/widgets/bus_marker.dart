/// BusElli — BusMarker widget
/// Rendered on the route timeline between stops.
/// Shows the bus icon, crowd badge, AC status, confidence, and stale indicator.

import 'package:flutter/material.dart';
import '../models/models.dart';
import 'crowd_badge.dart';

class BusMarker extends StatelessWidget {
  final LiveBus bus;

  const BusMarker({super.key, required this.bus});

  @override
  Widget build(BuildContext context) {
    return AnimatedOpacity(
      opacity: bus.isStale ? 0.4 : 1.0,
      duration: const Duration(milliseconds: 400),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '🚌',
            style: TextStyle(
              fontSize: 18,
              color: bus.isStale ? Colors.grey : Colors.white,
            ),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Wrap(
              spacing: 5,
              runSpacing: 4,
              children: [
                CrowdStatusTag(level: bus.crowdLevel),
                if (bus.acStatus != AcStatus.unknown)
                  _AcTag(status: bus.acStatus),
                _ConfidenceChip(confidence: bus.fadedConfidence, stale: bus.isStale),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AcTag extends StatelessWidget {
  final AcStatus status;
  const _AcTag({required this.status});

  @override
  Widget build(BuildContext context) {
    final ok = status == AcStatus.ok;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: ok ? const Color(0xFF1E3A5F) : const Color(0xFF7F1D1D),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        ok ? '❄️ AC OK' : '🌡️ AC Off',
        style: TextStyle(
          color: ok ? const Color(0xFF93C5FD) : const Color(0xFFF87171),
          fontSize: 9,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _ConfidenceChip extends StatelessWidget {
  final double confidence;
  final bool stale;
  const _ConfidenceChip({required this.confidence, required this.stale});

  @override
  Widget build(BuildContext context) {
    return Text(
      stale ? '⚫ Stale' : 'Conf. ${(confidence * 100).toStringAsFixed(0)}%',
      style: const TextStyle(color: Color(0xFF6B7280), fontSize: 9),
    );
  }
}
