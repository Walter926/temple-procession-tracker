import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_routes.dart';
import '../../shared/widgets/app_button.dart';

class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign In')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const TextField(keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: 'Email')),
            const SizedBox(height: 16),
            const TextField(obscureText: true, decoration: InputDecoration(labelText: 'Password')),
            const SizedBox(height: 24),
            AppButton(
              label: 'Sign In',
              onPressed: () {
                context.go(AppRoutes.homePath);
              },
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () {
                context.push(AppRoutes.joinCodePath);
              },
              child: const Text('Join with Access Code'),
            ),
          ],
        ),
      ),
    );
  }
}