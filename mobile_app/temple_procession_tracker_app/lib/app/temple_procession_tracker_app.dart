import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../core/services/auth_service.dart';
import '../core/services/tracking_service.dart';
import '../core/services/push_notification_service.dart';
import '../shared/theme/app_theme.dart';
import 'app_router.dart';
import 'app_routes.dart';
import 'auth_state_notifier.dart';

class TempleProcessionTrackerApp extends StatefulWidget {
  const TempleProcessionTrackerApp({super.key});

  @override
  State<TempleProcessionTrackerApp> createState() {
    return _TempleProcessionTrackerAppState();
  }
}

class _TempleProcessionTrackerAppState
    extends State<TempleProcessionTrackerApp> {
  late final AuthService _authService;
  late final AuthStateNotifier _authStateNotifier;
  late final GoRouter _router;
  late final TrackingService _trackingService;
  late final PushNotificationService _pushService;
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();
  StreamSubscription<PushMessage>? _foregroundSubscription, _tapSubscription;
  bool _closed = false;
  String? _sessionKey;
  Future<void> _sessionWork = Future.value();

  @override
  void initState() {
    super.initState();

    _authService = AuthService();
    _trackingService = TrackingService();
    _pushService = PushNotificationService();
    _authService.onBeforeSignOut = () async {
      _sessionKey = '';
      await _cleanupSession();
    };
    _authStateNotifier = AuthStateNotifier(authService: _authService);
    _authStateNotifier.addListener(_syncSession);
    _router = AppRouter.createRouter(
      authService: _authService,
      authStateNotifier: _authStateNotifier,
    );
    _foregroundSubscription = _pushService.foregroundMessages.listen((message) {
      if (_closed || !_authStateNotifier.isActive) return;
      _messengerKey.currentState?.showSnackBar(
        SnackBar(
          content: Text('${message.title}\n${message.body}'),
          action: SnackBarAction(
            label: 'View',
            onPressed: () => _router.push(AppRoutes.notificationsPath),
          ),
        ),
      );
    });
    _tapSubscription = _pushService.notificationTaps.listen((message) {
      if (!_closed && _authStateNotifier.isActive) {
        _router.go(AppRoutes.notificationsPath);
      }
    });
    _syncSession();
  }

  Future<void> _cleanupSession() async {
    await _trackingService.stop(
      reason: 'Signed out or account permissions changed.',
    );
    try {
      await _pushService.detach();
    } catch (error) {
      debugPrint('Push detach failed: $error');
    }
  }

  void _syncSession() {
    final profile = _authStateNotifier.userProfile;
    final eligible = profile?.isActive == true;
    final key = eligible
        ? '${profile!.id}:${profile.role.name}:${profile.assignedGroupId}'
        : '';
    if (_sessionKey == key) return;
    _sessionKey = key;
    // Serialize transitions to avoid attaching a previous user's token after a switch.
    _sessionWork = _sessionWork
        .then((_) async {
          if (_closed || _sessionKey != key) return;
          await _cleanupSession();
          if (!_closed && _sessionKey == key && eligible) {
            await _pushService.attachProfile(profile);
          }
        })
        .catchError((Object error) {
          debugPrint('Session lifecycle failed: $error');
        });
  }

  @override
  void dispose() {
    _closed = true;
    _foregroundSubscription?.cancel();
    _tapSubscription?.cancel();
    _router.dispose();
    _authStateNotifier.removeListener(_syncSession);
    _authStateNotifier.dispose();
    _trackingService.dispose();
    _pushService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<TrackingService>.value(value: _trackingService),
        ChangeNotifierProvider<PushNotificationService>.value(
          value: _pushService,
        ),
        ChangeNotifierProvider<AuthStateNotifier>.value(
          value: _authStateNotifier,
        ),
      ],
      child: MaterialApp.router(
        title: 'Temple Procession Tracker',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light,
        routerConfig: _router,
        scaffoldMessengerKey: _messengerKey,
        builder: (context, child) =>
            SafeArea(top: false, child: child ?? const SizedBox.shrink()),
      ),
    );
  }
}
