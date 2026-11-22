/// BusElli — App router (go_router)

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../screens/home_screen.dart';
import '../screens/live_route_screen.dart';
import '../screens/alarms_screen.dart';

final appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    ShellRoute(
      builder: (context, state, child) => _Shell(child: child),
      routes: [
        GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
        GoRoute(path: '/alarms', builder: (_, __) => const AlarmsScreen()),
      ],
    ),
    GoRoute(
      path: '/route/:routeId',
      builder: (_, state) => LiveRouteScreen(routeId: state.pathParameters['routeId']!),
    ),
  ],
);

class _Shell extends StatefulWidget {
  final Widget child;
  const _Shell({required this.child});

  @override
  State<_Shell> createState() => _ShellState();
}

class _ShellState extends State<_Shell> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: widget.child,
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        backgroundColor: const Color(0xFF111827),
        selectedItemColor: const Color(0xFF3B82F6),
        unselectedItemColor: const Color(0xFF6B7280),
        onTap: (i) {
          setState(() => _currentIndex = i);
          switch (i) {
            case 0: context.go('/');
            case 1: context.go('/alarms');
            default: break;
          }
        },
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.home_outlined), activeIcon: Icon(Icons.home), label: 'Home'),
          BottomNavigationBarItem(icon: Icon(Icons.notifications_outlined), activeIcon: Icon(Icons.notifications), label: 'Alarms'),
          BottomNavigationBarItem(icon: Icon(Icons.star_outline), activeIcon: Icon(Icons.star), label: 'Karma'),
        ],
      ),
    );
  }
}
