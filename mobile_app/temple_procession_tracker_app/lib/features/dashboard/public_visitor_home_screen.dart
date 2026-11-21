
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
    final bool signedIn = authService.currentFirebaseUser != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Temple Procession Tracker')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text('Public Visitor', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          const Text('Browse public procession events without signing in.'),
          const SizedBox(height: 24),
          AppButton(label: 'View Public Map', icon: Icons.public, onPressed: () => context.push(AppRoutes.publicMapPath)),
          const SizedBox(height: 12),
          if (signedIn)
            AppButton(label: 'Log Out', icon: Icons.logout, onPressed: () async { await authService.signOut(); })
          else ...[
            AppButton(label: 'Sign In', icon: Icons.login, onPressed: () => context.push(AppRoutes.loginPath)),
            const SizedBox(height: 12),
            AppButton(label: 'Create Account', icon: Icons.person_add, onPressed: () => context.push(AppRoutes.registrationPath)),
          ],
        ],
      ),
    );
  }
}
