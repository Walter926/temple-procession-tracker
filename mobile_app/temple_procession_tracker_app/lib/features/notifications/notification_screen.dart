import 'package:flutter/material.dart';

import '../../shared/widgets/app_card.dart';

class NotificationScreen extends StatelessWidget {
  const NotificationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: const Padding(
        padding: EdgeInsets.all(24),
        child: AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('No Notifications Yet', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              SizedBox(height: 16),
              Text('Collision warnings, route changes, organizer announcements, and group delays will appear here later.'),
            ],
          ),
        ),
      ),
    );
  }
}