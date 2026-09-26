import 'package:flutter_test/flutter_test.dart';
import 'package:temple_procession_tracker_app/app/temple_procession_tracker_app.dart';

void main() {
  testWidgets('App starts', (WidgetTester tester) async {
    await tester.pumpWidget(const TempleProcessionTrackerApp());
  });
}