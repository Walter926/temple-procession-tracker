import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:temple_procession_tracker_app/core/services/instruction_service.dart';
import 'package:temple_procession_tracker_app/features/notifications/collision_warnings_panel.dart';

class Instructions extends InstructionService {
  @override
  String? currentUid = 'leader';
  final feeds = <String, StreamController<List<InstructionRecord>>>{};
  final controllers = <StreamController<List<InstructionRecord>>>[];
  final acknowledged = <String>[];
  final watches = <String>[];
  @override
  Stream<List<InstructionRecord>> watch(String collection) {
    watches.add(collection);
    final controller = StreamController<List<InstructionRecord>>.broadcast();
    feeds[collection] = controller;
    controllers.add(controller);
    return controller.stream;
  }

  @override
  Future<void> acknowledge(InstructionRecord record) async =>
      acknowledged.add('${record.collection}/${record.id}');
  Future<void> close() async {
    for (final controller in controllers) {
      await controller.close();
    }
  }
}

InstructionRecord record(
  String collection, {
  String state = 'active',
  String group = 'group',
  DateTime? expiry,
}) => InstructionRecord('same-id', collection, {
  'message': collection == 'routeInstructions'
      ? 'Take the next turn'
      : 'Wait here',
  'eventId': 'event',
  'groupId': group,
  'state': state,
  'createdAt': DateTime.now(),
  'expiresAt': expiry ?? DateTime.now().add(const Duration(hours: 1)),
});

void main() {
  late Instructions service;
  setUp(() => service = Instructions());
  tearDown(() => service.close());
  Future<void> show(WidgetTester tester) => tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: CollisionWarningsPanel(
          service: service,
          eventId: 'event',
          groupId: 'group',
        ),
      ),
    ),
  );
  testWidgets(
    'normal empty instructions are not an error and signed-out users never subscribe',
    (tester) async {
      await show(tester);
      service.feeds['collisionWarnings']!.add([]);
      service.feeds['routeInstructions']!.add([]);
      await tester.pumpAndSettle();
      expect(find.text('Retry instructions'), findsNothing);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      service.currentUid = null;
      final before = service.watches.length;
      await show(tester);
      expect(service.watches.length, before);
    },
  );
  testWidgets(
    'missing index is actionable, preserves the working feed and retries in-place',
    (tester) async {
      await show(tester);
      service.feeds['collisionWarnings']!.add([record('collisionWarnings')]);
      service.feeds['routeInstructions']!.addError(
        FirebaseException(
          plugin: 'cloud_firestore',
          code: 'failed-precondition',
          message: 'The query requires an index.',
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Route instructions need a database index'),
        findsOneWidget,
      );
      expect(find.text('Wait here'), findsOneWidget);
      await tester.tap(find.text('Retry instructions'));
      await tester.pump();
      expect(service.watches, hasLength(4));
      service.feeds['collisionWarnings']!.add([]);
      service.feeds['routeInstructions']!.add([record('routeInstructions')]);
      await tester.pumpAndSettle();
      expect(find.text('Take the next turn'), findsOneWidget);
      expect(find.text('Retry instructions'), findsNothing);
      await tester.tap(find.text('Acknowledge'));
      await tester.pumpAndSettle();
      expect(service.acknowledged, ['routeInstructions/same-id']);
    },
  );
  for (final code in ['permission-denied', 'unavailable']) {
    testWidgets('$code is a failure, not a normal empty instruction list', (
      tester,
    ) async {
      await show(tester);
      service.feeds['collisionWarnings']!.addError(
        FirebaseException(plugin: 'cloud_firestore', code: code),
      );
      service.feeds['routeInstructions']!.add([]);
      await tester.pumpAndSettle();
      expect(
        find.textContaining(
          code == 'permission-denied'
              ? 'Check your sign-in and event access'
              : 'Check your connection',
        ),
        findsOneWidget,
      );
      expect(find.text('Retry instructions'), findsOneWidget);
    });
  }
  testWidgets(
    'only current-group unexpired instructions are displayed and collection IDs do not collide',
    (tester) async {
      await show(tester);
      service.feeds['collisionWarnings']!.add([record('collisionWarnings')]);
      service.feeds['routeInstructions']!.add([
        record('routeInstructions', state: 'superseded'),
        record('routeInstructions', group: 'another-group'),
        record(
          'routeInstructions',
          expiry: DateTime.now().subtract(const Duration(seconds: 1)),
        ),
      ]);
      await tester.pumpAndSettle();
      expect(find.text('Take the next turn'), findsNothing);
      service.feeds['routeInstructions']!.add([record('routeInstructions')]);
      await tester.pumpAndSettle();
      expect(find.text('Take the next turn'), findsOneWidget);
      expect(find.text('Wait here'), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(find.text('Acknowledge'), findsNWidgets(2));
    },
  );
}
