import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_routes.dart';
import '../../app/auth_state_notifier.dart';
import '../../core/enums/user_role.dart';
import '../../core/utils/role_access.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/app_error.dart';
import '../../shared/widgets/app_loading.dart';

class HomeScreen extends StatelessWidget {
  final AuthStateNotifier authStateNotifier;

  const HomeScreen({super.key, required this.authStateNotifier});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: authStateNotifier,
      builder: (context, child) {
        if (authStateNotifier.isProfileLoading) {
          return Scaffold(appBar: AppBar(title: const Text('Temple Procession Tracker')), body: const AppLoading(message: 'Loading profile...'));
        }

        final UserRole? role = authStateNotifier.effectiveRole;

        if (role == null || !RoleAccess.canAccessMemberArea(role)) {
          return Scaffold(appBar: AppBar(title: const Text('Temple Procession Tracker')), body: const AppError(message: 'Your application profile is unavailable.'));
        }

        return Scaffold(
          appBar: AppBar(title: const Text('Temple Procession Tracker')),
          body: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Role', style: TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text(role.displayName),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              if (RoleAccess.canManageSystem(role)) ...[
                AppButton(
                  label: 'Admin Event Management',
                  icon: Icons.admin_panel_settings,
                  onPressed: () {
                    context.push(AppRoutes.adminEventsPath);
                  },
                ),
                const SizedBox(height: 12),
              ],
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
              if (RoleAccess.canUseTeamLeaderTracking(role)) ...[
                const SizedBox(height: 12),
                AppButton(
                  label: 'Team Leader Tracking',
                  icon: Icons.location_on,
                  onPressed: () {
                    context.push(AppRoutes.trackingPath);
                  },
                ),
              ],
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
        );
      },
    );
  }
}