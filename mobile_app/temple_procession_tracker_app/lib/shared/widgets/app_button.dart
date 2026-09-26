import 'package:flutter/material.dart';

class AppButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool isLoading;

  const AppButton({super.key, required this.label, required this.onPressed, this.icon, this.isLoading = false});

  @override
  Widget build(BuildContext context) {
    final VoidCallback? effectiveOnPressed = isLoading ? null : onPressed;

    return FilledButton(
      onPressed: effectiveOnPressed,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (isLoading) ...[
            const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
            const SizedBox(width: 10),
          ] else if (icon != null) ...[
            Icon(icon),
            const SizedBox(width: 10),
          ],
          Text(label),
        ],
      ),
    );
  }
}