import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_routes.dart';
import '../../core/services/auth_service.dart';
import '../../core/utils/auth_error_message.dart';
import '../../shared/widgets/app_button.dart';

class LoginScreen extends StatefulWidget {
  final AuthService authService;

  const LoginScreen({super.key, required this.authService});

  @override
  State<LoginScreen> createState() {
    return _LoginScreenState();
  }
}

class _LoginScreenState extends State<LoginScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();

  final TextEditingController _emailController = TextEditingController();

  final TextEditingController _passwordController = TextEditingController();

  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    final FormState? form = _formKey.currentState;

    if (form == null || !form.validate()) {
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      await widget.authService.signIn(email: _emailController.text, password: _passwordController.text);
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = AuthErrorMessage.fromException(error);
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign In')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              TextFormField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Email'),
                validator: (value) {
                  final String email = value ?.trim() ?? '';

                  if (email.isEmpty || !email.contains('@')) {
                    return 'Enter a valid email address.';
                  }

                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _passwordController,
                obscureText: true,
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (value) {
                  if (!_isLoading) {
                    _signIn();
                  }
                },
                decoration: const InputDecoration(labelText: 'Password'),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Enter your password.';
                  }

                  return null;
                },
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 16),
                Text(_errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              const SizedBox(height: 24),
              AppButton(label: 'Sign In', isLoading: _isLoading, onPressed: _isLoading ? null : _signIn),
              const SizedBox(height: 12),
              TextButton(
                onPressed: _isLoading ? null : () {
                            context.push(AppRoutes.forgotPasswordPath);
                          },
                child: const Text('Forgot Password?'),
              ),
              TextButton(
                onPressed: _isLoading ? null : () {
                            context.push(AppRoutes.registrationPath);
                          },
                child: const Text('Create Account'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _isLoading ? null : () {
                            context.push(AppRoutes.publicMapPath);
                          },
                icon: const Icon(Icons.public),
                label: const Text('View Public Map'),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: _isLoading ? null : () {
                            context.push(AppRoutes.joinCodePath);
                          },
                child: const Text('Join with Access Code'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}