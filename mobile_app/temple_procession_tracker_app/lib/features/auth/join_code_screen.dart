import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_routes.dart';

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
    if (code.isEmpty) {
      setState(() => _error = 'Enter an access code.');
      return;
    }

    setState(() { _busy = true; _error = null; });

    try {
      final result = await FirebaseFunctions.instanceFor(region: 'us-central1')
          .httpsCallable('redeemAccessCode')
          .call<Map<String, dynamic>>({'code': code});

      final groupId = result.data['groupId']?.toString() ?? '';
      if (!mounted) return;
      context.go(groupId.isNotEmpty ? AppRoutes.groupMapPath : AppRoutes.publicMapPath);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      final message = switch (error.code) {
        'unauthenticated' => 'Please sign in first.',
        'not-found' => 'Invalid access code.',
        'deadline-exceeded' => 'This access code has expired.',
        'resource-exhausted' => 'This access code has reached its maximum uses.',
        'already-exists' => 'You already belong to another group in this event.',
        'failed-precondition' => error.message ?? 'The code is disabled or the event is unavailable.',
        'permission-denied' => error.message ?? 'You do not have permission to join.',
        _ => error.message ?? 'Unable to redeem access code.',
      };
      setState(() => _error = message);
    } catch (error) {
      if (mounted) setState(() => _error = 'Could not complete the request: $error');
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
            const Text('Enter the access code provided by your event organizer. You must be signed in.'),
            const SizedBox(height: 20),
            TextField(
              controller: _controller,
              enabled: !_busy,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(labelText: 'Access Code', hintText: 'XXXX-XXXX-XXXX-XXXX-XXXX', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _busy ? null : _join,
              icon: const Icon(Icons.login),
              label: Text(_busy ? 'Validating...' : 'Join Event or Group'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ],
        ),
      ),
    );
  }
}