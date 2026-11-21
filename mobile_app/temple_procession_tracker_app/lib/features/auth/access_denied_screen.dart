
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_routes.dart';
import '../../core/services/auth_service.dart';
import '../../shared/widgets/app_button.dart';

class AccessDeniedScreen extends StatelessWidget {
  final AuthService authService;
  const AccessDeniedScreen({super.key, required this.authService});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Access Denied')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.lock_outline, size: 64),
              const SizedBox(height: 16),
              const Text('You do not have permission to access this area. If your profile is missing or inactive, contact an administrator.', textAlign: TextAlign.center),
              const SizedBox(height: 24),
              AppButton(label: 'View Public Map', icon: Icons.public, onPressed: () => context.go(AppRoutes.publicMapPath)),
              const SizedBox(height: 12),
              AppButton(label: 'Sign Out', icon: Icons.logout, onPressed: () async { await authService.signOut(); }),
            ],
          ),
        ),
      ),
    );
  }
}
