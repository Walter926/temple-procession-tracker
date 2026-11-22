import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:temple_procession_tracker_app/features/notifications/notification_screen.dart';

void main() {
  test('notification screen compiles with its const constructor and state', () {
    const screen = NotificationScreen();
    expect(screen, isA<StatefulWidget>());
    expect(screen.createState(), isA<State<NotificationScreen>>());
  });
}
