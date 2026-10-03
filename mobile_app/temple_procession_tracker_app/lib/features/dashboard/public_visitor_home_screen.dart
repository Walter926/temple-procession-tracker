import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_routes.dart';
import '../../core/services/auth_service.dart';
import '../../shared/widgets/app_button.dart';

class PublicVisitorHomeScreen extends StatelessWidget {
  final AuthService authService;

  const PublicVisitorHomeScreen({super.key, required this.authService});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Temple Procession Tracker')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text('Public Visitor', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
          const SizedBox(height: 24),
          AppButton(
            label: 'View Public Map',
            icon: Icons.public,
            onPressed: () {
              context.push(AppRoutes.publicMapPath);
            },
          ),
          const SizedBox(height: 12),
          AppButton(
            label: 'Log Out',
            icon: Icons.logout,
            onPressed: () {
              authService.signOut();
            },
          ),
        ],
      ),
    );
  }
}