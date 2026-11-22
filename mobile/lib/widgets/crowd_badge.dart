/// BusElli — CrowdBadge widget
/// Renders a colour-coded crowd-level pill with bus number and ETA.

import 'package:flutter/material.dart';
import '../models/models.dart';

class CrowdBadge extends StatelessWidget {
  final CrowdLevel level;
  final String busNumber;
  final String eta;

  const CrowdBadge({
    super.key,
    required this.level,
    required this.busNumber,
    required this.eta,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: BorderRadius.circular(7),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7, height: 7,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: level.color,
            ),
          ),
          const SizedBox(width: 5),
          Text(
            busNumber,
            style: const TextStyle(
              color: Color(0xFF60A5FA),
              fontWeight: FontWeight.w700,
              fontSize: 11,
            ),
          ),
          const SizedBox(width: 5),
          Text(
            eta,
            style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 10),
          ),
        ],
      ),
    );
  }
}

/// Full crowd status tag used on the route timeline.
class CrowdStatusTag extends StatelessWidget {
  final CrowdLevel level;

  const CrowdStatusTag({super.key, required this.level});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: level.color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: level.color.withOpacity(0.4)),
      ),
      child: Text(
        level.label,
        style: TextStyle(
          color: level.color,
          fontWeight: FontWeight.w700,
          fontSize: 10,
        ),
      ),
    );
  }
}
