import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:temple_procession_tracker_app/features/notifications/announcement_composer.dart';

void main() {
  testWidgets(
    'leader announcement uses only its group audience and retries preserve request identity',
    (tester) async {
      final requests = <Map<String, dynamic>>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AnnouncementComposer(
              eventId: 'event',
              groupId: 'group',
              submit: (data) async {
                requests.add(data);
                if (requests.length == 1) throw StateError('offline');
              },
            ),
          ),
        ),
      );
      await tester.enterText(find.byType(TextField), 'Meet at the next stop');
      await tester.tap(find.text('Send announcement'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Send announcement'));
      await tester.pumpAndSettle();
      expect(requests, hasLength(2));
      expect(requests.first['audience'], 'group');
      expect(requests.first['groupId'], 'group');
      expect(requests.last['requestId'], requests.first['requestId']);
      expect(find.textContaining('Announcement saved.'), findsOneWidget);
    },
  );

  testWidgets('event announcement is private and empty messages never submit', (
    tester,
  ) async {
    final requests = <Map<String, dynamic>>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AnnouncementComposer(
            eventId: 'event',
            submit: (data) async {
              requests.add(data);
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('Send announcement'));
    await tester.pumpAndSettle();
    expect(requests, isEmpty);
    await tester.enterText(find.byType(TextField), 'Event update');
    await tester.tap(find.text('Send announcement'));
    await tester.pumpAndSettle();
    expect(requests.single['audience'], 'event');
    expect(requests.single['groupId'], isEmpty);
  });
}
