import 'package:flutter/material.dart';

class AppTheme {
  static const Color _seedColor = Color(0xFF8B2F2F);

  static const Color _backgroundColor = Color(0xFFF8F6F2);

  static ThemeData get light {
    final ColorScheme colorScheme = ColorScheme.fromSeed(seedColor: _seedColor);

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: _backgroundColor,
      appBarTheme: const AppBarTheme(centerTitle: false),
      filledButtonTheme:
          FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)))),
      inputDecorationTheme: InputDecorationTheme(border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
    );
  }

  const AppTheme._();
}