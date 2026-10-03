import 'package:flutter/material.dart';

import '../../app/auth_state_notifier.dart';
import '../../core/enums/user_role.dart';
import '../../core/services/auth_service.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/app_loading.dart';

class ProfileScreen extends StatelessWidget {
  final AuthService authService;
  final AuthStateNotifier authStateNotifier;

  const ProfileScreen({super.key, required this.authService, required this.authStateNotifier});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: authStateNotifier,
      builder: (context, child) {
        if (authStateNotifier.isProfileLoading) {
          return Scaffold(appBar: AppBar(title: const Text('Profile')), body: const AppLoading(message: 'Loading profile...'));
        }

        final profile = authStateNotifier.userProfile;

        final UserRole? role = authStateNotifier.effectiveRole;

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
                    Text(profile ?.displayName ?? 'Not available'),
                    const SizedBox(height: 16),
                    const Text('Email', style: TextStyle(fontWeight: FontWeight.bold)),
                    Text(profile?.email ?? 'Not available'),
                    const SizedBox(height: 16),
                    const Text('Role', style: TextStyle(fontWeight: FontWeight.bold)),
                    Text(role ?.displayName ?? 'Unavailable'),
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
      },
    );
  }
}