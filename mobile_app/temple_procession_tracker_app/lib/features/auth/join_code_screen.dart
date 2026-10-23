import 'package:cloud_functions/cloud_functions.dart';
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
  void dispose() { _controller.dispose(); super.dispose(); }

  Future<void> _join() async {
    final code = _controller.text.trim();
    if (code.isEmpty) { setState(() => _error = 'Enter a code.'); return; }
    setState(() { _busy = true; _error = null; });
    try {
      final result = await FirebaseFunctions.instance.httpsCallable('redeemAccessCode').call<Map<String, dynamic>>({'code': code});
      final groupId = result.data['groupId']?.toString() ?? '';
      if (!mounted) return;
      context.go(groupId.isNotEmpty ? AppRoutes.groupMapPath : AppRoutes.publicMapPath);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      final message = switch (error.code) {
        'deadline-exceeded' => 'This code has expired.',
        'resource-exhausted' => 'The code has reached its maximum uses.',
        'failed-precondition' => error.message ?? 'This code is disabled or the event is closed.',
        'already-exists' => 'You already belong to another group in this event.',
        'not-found' => 'Invalid code.',
        _ => error.message ?? 'Unable to join with this code.',
      };
      setState(() => _error = message);
    } catch (_) { if (mounted) setState(() => _error = 'Could not connect. Try again.'); }
    finally { if (mounted) setState(() => _busy = false); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Join with Access Code')),
    body: Padding(padding: const EdgeInsets.all(24), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('Sign in first, then enter the access code provided by an organizer.'),
      const SizedBox(height: 16),
      TextField(controller: _controller, textCapitalization: TextCapitalization.characters,
        decoration: const InputDecoration(labelText: 'Access code', hintText: 'ABCD-EF12-3456-7890-ABCD')),
      const SizedBox(height: 12),
      ElevatedButton(onPressed: _busy ? null : _join, child: Text(_busy ? 'Validating...' : 'Join Event or Group')),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
    ])),
  );
}