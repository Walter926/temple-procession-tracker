import 'package:flutter/material.dart';

class UserAvatar extends StatelessWidget {
  final String? photoUrl;
  final double radius;

  const UserAvatar({super.key, required this.photoUrl, this.radius = 24});

  @override
  Widget build(BuildContext context) {
    final String? url = photoUrl?.trim();
    final double size = radius * 2;

    if (url == null || url.isEmpty) {
      return _fallback(context, size);
    }

    return SizedBox(
      width: size,
      height: size,
      child: ClipOval(
        child: Image.network(
          url,
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) {
            return _fallback(context, size);
          },
        ),
      ),
    );
  }

  Widget _fallback(BuildContext context, double size) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
      ),
      alignment: Alignment.center,
      child: Icon(Icons.person, size: radius),
    );
  }
}