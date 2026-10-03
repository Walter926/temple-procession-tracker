import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_routes.dart';
import '../../shared/widgets/app_button.dart';

class AccessDeniedScreen extends StatelessWidget {
  const AccessDeniedScreen({super.key});

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
              const Text('You do not have permission to access this area.', textAlign: TextAlign.center),
              const SizedBox(height: 24),
              AppButton(
                label: 'Return Home',
                onPressed: () {
                  context.go(AppRoutes.homePath);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}