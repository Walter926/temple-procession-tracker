import 'package:flutter/material.dart';

import '../../core/services/auth_service.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';

class ProfileScreen extends StatelessWidget {
  final AuthService authService;

  const ProfileScreen({super.key, required this.authService});

  @override
  Widget build(BuildContext context) {
    final user = authService.currentFirebaseUser;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const CircleAvatar(radius: 44, child: Icon(Icons.person, size: 44)),
          const SizedBox(height: 24),
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Display Name', style: TextStyle(fontWeight: FontWeight.bold)),
                Text(user?.displayName ?? 'Not set'),
                const SizedBox(height: 16),
                const Text('Email', style: TextStyle(fontWeight: FontWeight.bold)),
                Text(user?.email ?? 'Not available'),
                const SizedBox(height: 16),
                const Text('Role', style: TextStyle(fontWeight: FontWeight.bold)),
                const Text('Role data will be connected in Phase 14.'),
              ],
            ),
          ),
          const SizedBox(height: 24),
          AppButton(
            label: 'Sign Out',
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