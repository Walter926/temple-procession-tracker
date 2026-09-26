import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../shared/theme/app_theme.dart';
import 'app_router.dart';

class TempleProcessionTrackerApp extends StatefulWidget {
  const TempleProcessionTrackerApp({super.key});

  @override
  State<TempleProcessionTrackerApp> createState() {
    return _TempleProcessionTrackerAppState();
  }
}

class _TempleProcessionTrackerAppState extends State<TempleProcessionTrackerApp> {
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();

    _router = AppRouter.createRouter();
  }

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(title: 'Temple Procession Tracker', debugShowCheckedModeBanner: false, theme: AppTheme.light, routerConfig: _router);
  }
}