import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/services/auth_service.dart';
import '../shared/theme/app_theme.dart';
import 'app_router.dart';
import 'auth_state_notifier.dart';

class TempleProcessionTrackerApp extends StatefulWidget {
  const TempleProcessionTrackerApp({super.key});

  @override
  State<TempleProcessionTrackerApp> createState() {
    return _TempleProcessionTrackerAppState();
  }
}

class _TempleProcessionTrackerAppState extends State<TempleProcessionTrackerApp> {
  late final AuthService _authService;
  late final AuthStateNotifier _authStateNotifier;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();

    _authService = AuthService();
    _authStateNotifier = AuthStateNotifier(authService: _authService);
    _router = AppRouter.createRouter(authService: _authService, authStateNotifier: _authStateNotifier);
  }

  @override
  void dispose() {
    _router.dispose();
    _authStateNotifier.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Temple Procession Tracker',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: _router,
    );
  }
}