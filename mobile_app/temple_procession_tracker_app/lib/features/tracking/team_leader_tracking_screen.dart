import 'package:flutter/material.dart';

import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';

class TeamLeaderTrackingScreen extends StatelessWidget {
  const TeamLeaderTrackingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Team Leader Tracking')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Assigned Group', style: TextStyle(fontWeight: FontWeight.bold)),
                SizedBox(height: 8),
                Text('No group assigned yet'),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('GPS Status', style: TextStyle(fontWeight: FontWeight.bold)),
                SizedBox(height: 8),
                Text('Tracking inactive'),
              ],
            ),
          ),
          const SizedBox(height: 24),
          const AppButton(label: 'Start Tracking', icon: Icons.play_arrow, onPressed: null),
        ],
      ),
    );
  }
}