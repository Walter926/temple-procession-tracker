import 'package:go_router/go_router.dart';

import '../core/enums/user_role.dart';
import '../core/services/auth_service.dart';
import '../core/utils/role_access.dart';
import '../features/auth/access_denied_screen.dart';
import '../features/auth/forgot_password_screen.dart';
import '../features/auth/join_code_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/registration_screen.dart';
import '../features/auth/splash_screen.dart';
import '../features/dashboard/home_screen.dart';
import '../features/dashboard/public_visitor_home_screen.dart';
import '../features/events/admin_event_management_screen.dart';
import '../features/events/event_list_screen.dart';
import '../features/map/group_map_screen.dart';
import '../features/map/public_map_screen.dart';
import '../features/notifications/notification_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/tracking/team_leader_tracking_screen.dart';
import 'app_routes.dart';
import 'auth_state_notifier.dart';
import 'role_route_guard.dart';

class AppRouter {
  static GoRouter createRouter({required AuthService authService, required AuthStateNotifier authStateNotifier}) {
    return GoRouter(
      initialLocation: AppRoutes.splashPath,
      refreshListenable: authStateNotifier,
      redirect: (context, state) {
        final String path = state.uri.path;
        final bool isLoggedIn = authStateNotifier.isAuthenticated;
        final UserRole? role = authStateNotifier.effectiveRole;
        final bool isAuthRoute = path == AppRoutes.loginPath || path == AppRoutes.registrationPath || path == AppRoutes.forgotPasswordPath;

        if (path == AppRoutes.splashPath) {
          if (!isLoggedIn) {
            return AppRoutes.loginPath;
          }

          if (authStateNotifier.isProfileLoading) {
            return null;
          }

          if (role == UserRole.publicVisitor) {
            return AppRoutes.publicVisitorHomePath;
          }

          if (!RoleAccess.canAccessMemberArea(role)) {
            return AppRoutes.accessDeniedPath;
          }

          return AppRoutes.homePath;
        }

        if (!isLoggedIn) {
          if (_isProtectedPath(path) || path == AppRoutes.accessDeniedPath) {
            return AppRoutes.loginPath;
          }

          return null;
        }

        if (authStateNotifier.isProfileLoading) {
          return null;
        }

        if (role == UserRole.publicVisitor) {
          if (path == AppRoutes.publicVisitorHomePath || path == AppRoutes.publicMapPath) {
            return null;
          }

          return AppRoutes.publicVisitorHomePath;
        }

        if (!RoleAccess.canAccessMemberArea(role)) {
          if (path == AppRoutes.publicMapPath || path == AppRoutes.accessDeniedPath) {
            return null;
          }

          return AppRoutes.accessDeniedPath;
        }

        if (isAuthRoute) {
          return AppRoutes.homePath;
        }

        if (path == AppRoutes.adminEventsPath && !RoleRouteGuard.canAccessAdmin(role)) {
          return AppRoutes.accessDeniedPath;
        }

        if (path == AppRoutes.trackingPath && !RoleRouteGuard.canAccessTeamLeader(role)) {
          return AppRoutes.accessDeniedPath;
        }

        if (_isMemberPath(path) && !RoleRouteGuard.canAccessMember(role)) {
          return AppRoutes.accessDeniedPath;
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
            return HomeScreen(authStateNotifier: authStateNotifier);
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
          name: AppRoutes.publicVisitorHome,
          path: AppRoutes.publicVisitorHomePath,
          builder: (context, state) {
            return PublicVisitorHomeScreen(authService: authService);
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
            return ProfileScreen(authService: authService, authStateNotifier: authStateNotifier);
          },
        ),
        GoRoute(
          name: AppRoutes.notifications,
          path: AppRoutes.notificationsPath,
          builder: (context, state) {
            return const NotificationScreen();
          },
        ),
        GoRoute(
          name: AppRoutes.adminEvents,
          path: AppRoutes.adminEventsPath,
          builder: (context, state) {
            return const AdminEventManagementScreen();
          },
        ),
        GoRoute(
          name: AppRoutes.accessDenied,
          path: AppRoutes.accessDeniedPath,
          builder: (context, state) {
            return const AccessDeniedScreen();
          },
        ),
      ],
    );
  }

  static bool _isProtectedPath(String path) {
    return _isMemberPath(path) || path == AppRoutes.trackingPath || path == AppRoutes.adminEventsPath || path == AppRoutes.publicVisitorHomePath;
  }

  static bool _isMemberPath(String path) {
    return path == AppRoutes.homePath || path == AppRoutes.eventsPath || path == AppRoutes.groupMapPath || path == AppRoutes.profilePath || path == AppRoutes.notificationsPath;
  }

  const AppRouter._();
}
