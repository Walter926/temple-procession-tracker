  import 'package:flutter/material.dart';

import '../../core/services/auth_service.dart';
import '../../core/utils/auth_error_message.dart';
import '../../shared/widgets/app_button.dart';

class ForgotPasswordScreen extends StatefulWidget {
  final AuthService authService;

  const ForgotPasswordScreen({super.key, required this.authService});

  @override
  State<ForgotPasswordScreen> createState() {
    return _ForgotPasswordScreenState();
  }
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();

  final TextEditingController _emailController = TextEditingController();

  bool _isLoading = false;
  String? _errorMessage;
  String? _successMessage;

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _sendReset() async {
    final FormState? form = _formKey.currentState;

    if (form == null || !form.validate()) {
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      await widget.authService.sendPasswordResetEmail(email: _emailController.text);

      if (!mounted) {
        return;
      }

      setState(() {
        _successMessage = 'Password reset email sent.';
      });
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
      appBar: AppBar(title: const Text('Forgot Password')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              TextFormField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(labelText: 'Email'),
                validator: (value) {
                  final String email = value ?.trim() ?? '';

                  if (email.isEmpty || !email.contains('@')) {
                    return 'Enter a valid email address.';
                  }

                  return null;
                },
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 16),
                Text(_errorMessage!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              if (_successMessage != null) ...[
                const SizedBox(height: 16),
                Text(_successMessage!),
              ],
              const SizedBox(height: 24),
              AppButton(label: 'Send Reset Email', isLoading: _isLoading, onPressed: _isLoading ? null : _sendReset),
            ],
          ),
        ),
      ),
    );
  }
}