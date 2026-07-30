import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:temple_procession_tracker_app/main.dart';

void main() {
  testWidgets('App entry screen loads', (WidgetTester tester) async {
    await tester.pumpWidget(const TempleProcessionTrackerApp());

    expect(find.text('Temple Procession Tracker'), findsWidgets);
    expect(find.text('GPS-Based Temple Procession Tracking App'), findsOneWidget);
    expect(find.byIcon(Icons.temple_buddhist), findsOneWidget);
  });
}
