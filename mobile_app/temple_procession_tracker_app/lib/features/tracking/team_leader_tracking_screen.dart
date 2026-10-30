import 'package:flutter/material.dart';
import 'gps_permission_screen.dart';

// Temporary Phase 23 screen. Replace with the final Phase 24 tracking screen.
class TeamLeaderTrackingScreen extends StatelessWidget {
  const TeamLeaderTrackingScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Team Leader Tracking')),
    body: Padding(padding: const EdgeInsets.all(24), child: Column(children: [
      const Text('First confirm GPS access. Live tracking is not enabled yet.'),
      ElevatedButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const GpsPermissionScreen())),
        child: const Text('Check GPS Permission')),
    ])),
  );
}