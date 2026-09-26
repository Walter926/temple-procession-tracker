import 'package:go_router/go_router.dart';

import '../features/auth/join_code_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/splash_screen.dart';
import '../features/dashboard/home_screen.dart';
import '../features/events/event_list_screen.dart';
import '../features/map/group_map_screen.dart';
import '../features/map/public_map_screen.dart';
import '../features/notifications/notification_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/tracking/team_leader_tracking_screen.dart';
import 'app_routes.dart';

class AppRouter {
  static GoRouter createRouter() {
    return GoRouter(
      initialLocation: AppRoutes.splashPath,
      routes: [
        GoRoute(
          name: AppRoutes.splash,
          path: AppRoutes.splashPath,
          builder: (context, state) {
            return const SplashScreen();
          },
        ),
        GoRoute(
          name: AppRoutes.login,
          path: AppRoutes.loginPath,
          builder: (context, state) {
            return const LoginScreen();
          },
        ),
        GoRoute(
          name: AppRoutes.joinCode,
          path: AppRoutes.joinCodePath,
          builder: (context, state) {
            return const JoinCodeScreen();
          },
        ),
        GoRoute(
          name: AppRoutes.home,
          path: AppRoutes.homePath,
          builder: (context, state) {
            return const HomeScreen();
          },
        ),
        GoRoute(
          name: AppRoutes.events,
          path: AppRoutes.eventsPath,
          builder: (context, state) {
            return const EventListScreen();
          },
        ),
        GoRoute(
          name: AppRoutes.publicMap,
          path: AppRoutes.publicMapPath,
          builder: (context, state) {
            return const PublicMapScreen();
          },
        ),
        GoRoute(
          name: AppRoutes.groupMap,
          path: AppRoutes.groupMapPath,
          builder: (context, state) {
            return const GroupMapScreen();
          },
        ),
        GoRoute(
          name: AppRoutes.tracking,
          path: AppRoutes.trackingPath,
          builder: (context, state) {
            return const TeamLeaderTrackingScreen();
          },
        ),
        GoRoute(
          name: AppRoutes.profile,
          path: AppRoutes.profilePath,
          builder: (context, state) {
            return const ProfileScreen();
          },
        ),
        GoRoute(
          name: AppRoutes.notifications,
          path: AppRoutes.notificationsPath,
          builder: (context, state) {
            return const NotificationScreen();
          },
        ),
      ],
    );
  }

  const AppRouter._();
}