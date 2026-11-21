import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_routes.dart';
import '../../core/services/access_code_service.dart';

class JoinCodeScreen extends StatefulWidget {
  const JoinCodeScreen({super.key});

  @override
  State<JoinCodeScreen> createState() => _JoinCodeScreenState();
}

class _JoinCodeScreenState extends State<JoinCodeScreen> {
  final TextEditingController _controller = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _join() async {
    final code = _controller.text.trim();

    if (FirebaseAuth.instance.currentUser == null) {
      setState(() => _error = 'Please sign in before using an access code.');
      return;
    }
    if (!AccessCodeService.isValidFormat(code)) {
      setState(
        () => _error =
            'Enter six letters or numbers, or a legacy 20-character hexadecimal code.',
      );
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final result = await AccessCodeService().redeem(code);
      if (!mounted) return;
      final groupId = result['groupId']?.toString() ?? '';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            groupId.isEmpty
                ? 'Joined event. No group has been joined.'
                : 'Joined group. Your profile is updating.',
          ),
        ),
      );
      context.go(AppRoutes.profilePath);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      final message = switch (error.code) {
        'unauthenticated' => 'Please sign in first.',
        'not-found' => 'Invalid access code.',
        'deadline-exceeded' => 'This access code has expired.',
        'resource-exhausted' =>
          error.message ??
              'This code is exhausted or too many attempts were made. Ask for a new code or retry later.',
        'already-exists' =>
          'You already belong to another group in this event.',
        'failed-precondition' =>
          error.message ?? 'The code is disabled or the event is unavailable.',
        'permission-denied' =>
          error.message ?? 'You do not have permission to join.',
        _ => error.message ?? 'Unable to redeem access code.',
      };
      setState(() => _error = message);
    } catch (error) {
      if (mounted) {
        setState(() => _error = 'Could not complete the request: $error');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Join with Access Code')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Text(
              'Enter the six-character code from your organizer or assigned leader. Legacy 20-character hexadecimal codes are also accepted until their server-recorded expiry. New codes expire after 24 hours. An event code joins only the event, not a group.',
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _controller,
              enabled: !_busy,
              textCapitalization: TextCapitalization.characters,
              maxLength: 24,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp('[a-zA-Z0-9-]')),
              ],
              onSubmitted: (_) {
                if (!_busy) _join();
              },
              decoration: const InputDecoration(
                labelText: 'Access Code',
                hintText: 'A7K2P9',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _busy ? null : _join,
              icon: const Icon(Icons.login),
              label: Text(_busy ? 'Validating...' : 'Join Event or Group'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
