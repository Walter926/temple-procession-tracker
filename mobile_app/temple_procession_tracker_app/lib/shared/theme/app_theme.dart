import 'package:flutter/material.dart';

class AppTheme {
  static const Color _seedColor = Color(0xFF46575F);

  static const Color _backgroundColor = Color(0xFFE8EBED);

  static ThemeData get light {
    final ColorScheme colorScheme = ColorScheme.fromSeed(seedColor: _seedColor);

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: _backgroundColor,
      appBarTheme: const AppBarTheme(
        centerTitle: false,
        backgroundColor: Color(0xE8F2F4F5),
        scrolledUnderElevation: 0,
      ),
      cardTheme: CardThemeData(
        color: const Color(0xDBFFFFFF),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(color: Color(0xCCFFFFFF)),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xBFFFFFFF),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  const AppTheme._();
}
