import 'package:go_router/go_router.dart';

import '../core/services/auth_service.dart';
import '../features/auth/forgot_password_screen.dart';
import '../features/auth/join_code_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/registration_screen.dart';
import '../features/auth/splash_screen.dart';
import '../features/dashboard/home_screen.dart';
import '../features/events/event_list_screen.dart';
import '../features/map/group_map_screen.dart';
import '../features/map/public_map_screen.dart';
import '../features/notifications/notification_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/tracking/team_leader_tracking_screen.dart';
import 'app_routes.dart';
import 'auth_state_notifier.dart';

class AppRouter {
  static GoRouter createRouter({required AuthService authService, required AuthStateNotifier authStateNotifier}) {
    return GoRouter(
      initialLocation: AppRoutes.splashPath,
      refreshListenable: authStateNotifier,
      redirect: (context, state) {
        final String path = state.uri.path;
        final bool isLoggedIn = authStateNotifier.isAuthenticated;

        final bool isAuthRoute =
            path == AppRoutes.loginPath ||
            path == AppRoutes.registrationPath ||
            path == AppRoutes.forgotPasswordPath;

        if (path == AppRoutes.splashPath) {
          return isLoggedIn ? AppRoutes.homePath : AppRoutes.loginPath;
        }

        if (!isLoggedIn && _isProtectedPath(path)) {
          return AppRoutes.loginPath;
        }

        if (isLoggedIn && isAuthRoute) {
          return AppRoutes.homePath;
        }

        return null;
      },
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
            return LoginScreen(authService: authService);
          },
        ),
        GoRoute(
          name: AppRoutes.registration,
          path: AppRoutes.registrationPath,
          builder: (context, state) {
            return RegistrationScreen(authService: authService);
          },
        ),
        GoRoute(
          name: AppRoutes.forgotPassword,
          path: AppRoutes.forgotPasswordPath,
          builder: (context, state) {
            return ForgotPasswordScreen(authService: authService);
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
            return ProfileScreen(authService: authService);
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

  static bool _isProtectedPath(String path) {
    return path == AppRoutes.homePath ||
        path == AppRoutes.eventsPath ||
        path == AppRoutes.groupMapPath ||
        path == AppRoutes.trackingPath ||
        path == AppRoutes.profilePath ||
        path == AppRoutes.notificationsPath;
  }

  const AppRouter._();
}