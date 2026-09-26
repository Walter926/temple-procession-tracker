import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_routes.dart';
import '../../shared/widgets/app_button.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Temple Procession Tracker')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            AppButton(
              label: 'Events',
              icon: Icons.event,
              onPressed: () {
                context.push(AppRoutes.eventsPath);
              },
            ),
            const SizedBox(height: 12),
            AppButton(
              label: 'Public Map',
              icon: Icons.public,
              onPressed: () {
                context.push(AppRoutes.publicMapPath);
              },
            ),
            const SizedBox(height: 12),
            AppButton(
              label: 'Group Map',
              icon: Icons.groups,
              onPressed: () {
                context.push(AppRoutes.groupMapPath);
              },
            ),
            const SizedBox(height: 12),
            AppButton(
              label: 'Team Leader Tracking',
              icon: Icons.location_on,
              onPressed: () {
                context.push(AppRoutes.trackingPath);
              },
            ),
            const SizedBox(height: 12),
            AppButton(
              label: 'Notifications',
              icon: Icons.notifications,
              onPressed: () {
                context.push(AppRoutes.notificationsPath);
              },
            ),
            const SizedBox(height: 12),
            AppButton(
              label: 'Profile',
              icon: Icons.person,
              onPressed: () {
                context.push(AppRoutes.profilePath);
              },
            ),
          ],
        ),
      ),
    );
  }
}