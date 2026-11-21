import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

String managementError(Object error) {
  if (error is FirebaseFunctionsException) {
    return error.message ??
        'The server could not complete this action. Try again.';
  }
  if (error is ArgumentError) {
    return error.message?.toString() ?? 'Check your entries.';
  }
  if (error is StateError) return error.message;
  return 'Could not complete the action. Check your connection and try again.';
}

String? requiredText(String? value) =>
    value == null || value.trim().isEmpty ? 'Required' : null;
String formatDate(DateTime date) => date.toLocal().toString().substring(0, 16);

Future<bool> confirmDelete(BuildContext context, String label) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete $label?'),
        content: const Text(
          'This cannot be undone. The server will refuse deletion if the record is in use.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    ) ??
    false;
