import 'package:flutter_test/flutter_test.dart';
import 'package:temple_procession_tracker_app/core/models/location_update.dart';
import 'package:temple_procession_tracker_app/core/repositories/live_map_repository.dart';
import 'package:temple_procession_tracker_app/features/notifications/notification_record.dart';

void main() {
  final now = DateTime.utc(2026, 11, 17);
  test('heartbeat becomes disconnected without any new database record', () {
    final presence = TrackingPresence('active', now);
    expect(
      presence.effectiveState(now.add(const Duration(seconds: 45))),
      'active',
    );
    expect(
      presence.effectiveState(now.add(const Duration(seconds: 46))),
      'disconnected',
    );
    expect(
      TrackingPresence(
        'paused',
        now,
      ).effectiveState(now.add(const Duration(minutes: 1))),
      'paused',
    );
    expect(
      const TrackingPresence('stopped', null).effectiveState(now),
      'stopped',
    );
  });
  test('missing timestamps are never manufactured as fresh GPS', () {
    final item = LocationUpdate.fromJson({});
    expect(item.recordedAt, DateTime.fromMillisecondsSinceEpoch(0));
    expect(item.toRealtimeDatabase(123)['recordedAt'], 0);
  });
  test(
    'read does not acknowledge, and expired/superseded instructions cannot be acknowledged',
    () {
      NotificationRecord notice({
        String state = 'active',
        DateTime? readAt,
        DateTime? expires,
      }) => NotificationRecord(
        id: 'notice',
        title: 'Instruction',
        body: 'Wait',
        eventId: 'event',
        sourceCollection: 'routeInstructions',
        sourceId: 'instruction',
        state: state,
        readAt: readAt,
        expiresAt: expires ?? now.add(const Duration(minutes: 1)),
      );
      final read = notice(readAt: now);
      expect(read.effectiveState(now), 'active');
      expect(read.canAcknowledge(now), isTrue);
      expect(read.canAcknowledge(now.add(const Duration(minutes: 2))), isFalse);
      expect(notice(state: 'superseded').canAcknowledge(now), isFalse);
      expect(notice(state: 'acknowledged').canAcknowledge(now), isFalse);
      expect(notice(expires: now).effectiveState(now), 'expired');
    },
  );
}
