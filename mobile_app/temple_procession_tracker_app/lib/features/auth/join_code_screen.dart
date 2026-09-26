import 'package:flutter/material.dart';

import '../../shared/widgets/app_button.dart';

class JoinCodeScreen extends StatefulWidget {
  const JoinCodeScreen({super.key});

  @override
  State<JoinCodeScreen> createState() {
    return _JoinCodeScreenState();
  }
}

class _JoinCodeScreenState extends State<JoinCodeScreen> {
  final TextEditingController _codeController = TextEditingController();

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  void _showPlaceholderMessage() {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Access-code validation will be added in Phase 22.')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Join with Access Code')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            TextField(controller: _codeController, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Enter Access Code')),
            const SizedBox(height: 24),
            AppButton(label: 'Join Group', onPressed: _showPlaceholderMessage),
          ],
        ),
      ),
    );
  }
}