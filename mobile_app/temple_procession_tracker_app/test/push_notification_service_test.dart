import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:temple_procession_tracker_app/core/enums/user_role.dart';
import 'package:temple_procession_tracker_app/core/models/user_profile.dart';
import 'package:temple_procession_tracker_app/core/services/push_notification_service.dart';

Future<void> flush() async {
  for (var i = 0; i < 8; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

UserProfile profile(String uid, {bool active = true}) => UserProfile(
  id: uid,
  email: '$uid@example.com',
  displayName: uid,
  role: UserRole.teamMember,
  isActive: active,
  createdAt: DateTime.utc(2026),
);
const message = PushMessage(
  notificationId: 'notice',
  eventId: 'event',
  title: 'Update',
  body: 'Message',
);

class FakePushDriver implements PushDriver {
  @override
  String? currentUid = 'first';
  final refresh = StreamController<String>.broadcast(sync: true);
  final messages = StreamController<PushMessage>.broadcast(sync: true);
  final opened = StreamController<PushMessage>.broadcast(sync: true);
  final calls = <({String name, Map<String, dynamic> data, String? uid})>[];
  bool permission = true, owned = true;
  String? value = 'initial-token';
  PushMessage? initial;
  int deletions = 0;
  Completer<void>? registerGate;
  @override
  Future<bool> requestPermission() async => permission;
  @override
  Future<String?> token() async => value;
  @override
  Future<void> deleteToken() async {
    deletions++;
  }

  @override
  Stream<String> get tokenRefresh => refresh.stream;
  @override
  Stream<PushMessage> get foreground => messages.stream;
  @override
  Stream<PushMessage> get taps => opened.stream;
  @override
  Future<PushMessage?> initialMessage() async => initial;
  @override
  Future<bool> ownsNotification(String id, String uid) async => owned;
  @override
  Future<void> call(String name, Map<String, dynamic> data) async {
    calls.add((name: name, data: data, uid: currentUid));
    if (name == 'registerDeviceToken') await registerGate?.future;
  }

  Future<void> close() async {
    await refresh.close();
    await messages.close();
    await opened.close();
  }
}

void main() {
  late FakePushDriver driver;
  late PushNotificationService push;
  setUp(() {
    driver = FakePushDriver();
    push = PushNotificationService(driver: driver);
  });
  tearDown(() async {
    await push.detach();
    push.dispose();
    await driver.close();
  });
  test(
    'app attach registers once and token refresh replaces the same device',
    () async {
      await push.attachProfile(profile('first'));
      await push.attachProfile(profile('first'));
      expect(push.registered, isTrue);
      expect(
        driver.calls.where((c) => c.name == 'registerDeviceToken').length,
        1,
      );
      final device = driver.calls.first.data['deviceId'];
      driver.refresh.add('refreshed-token');
      await flush();
      final registrations = driver.calls
          .where((c) => c.name == 'registerDeviceToken')
          .toList();
      expect(registrations.length, 2);
      expect(registrations.last.data['deviceId'], device);
      expect(driver.calls.last.name, 'unregisterDeviceToken');
      expect(driver.calls.last.data['token'], 'initial-token');
    },
  );
  test(
    'deactivation unregisters and invalidates the local token and subscriptions',
    () async {
      await push.attachProfile(profile('first'));
      await push.attachProfile(profile('first', active: false));
      expect(push.registered, isFalse);
      expect(driver.deletions, 1);
      expect(driver.refresh.hasListener, isFalse);
      expect(driver.calls.last.name, 'unregisterDeviceToken');
    },
  );
  test(
    'account switching after auth changes does not unregister the new owner',
    () async {
      await push.attachProfile(profile('first'));
      driver.currentUid = 'second';
      await push.attachProfile(profile('second'));
      expect(driver.deletions, 1);
      expect(
        driver.calls.where((c) => c.name == 'unregisterDeviceToken'),
        isEmpty,
      );
      expect(driver.calls.last.uid, 'second');
      expect(push.registered, isTrue);
    },
  );
  test(
    'detach while registration is in flight still cleans up that token',
    () async {
      driver.registerGate = Completer<void>();
      final attaching = push.attachProfile(profile('first'));
      await flush();
      final detaching = push.detach();
      driver.registerGate!.complete();
      await Future.wait([attaching, detaching]);
      expect(push.registered, isFalse);
      expect(driver.deletions, 1);
      expect(driver.calls.last.name, 'unregisterDeviceToken');
    },
  );
  test(
    'foreground and taps dedupe independently, including cold-start tap',
    () async {
      driver.initial = message;
      final foreground = <PushMessage>[], taps = <PushMessage>[];
      final sub1 = push.foregroundMessages.listen(foreground.add),
          sub2 = push.notificationTaps.listen(taps.add);
      await push.attachProfile(profile('first'));
      await flush();
      expect(taps.length, 1);
      driver.messages.add(message);
      driver.messages.add(message);
      driver.opened.add(message);
      await flush();
      expect(foreground.length, 1);
      expect(taps.length, 1);
      await sub1.cancel();
      await sub2.cancel();
    },
  );
  test(
    'queued pushes belonging to a previous account are not presented',
    () async {
      final items = <PushMessage>[];
      final subscription = push.foregroundMessages.listen(items.add);
      await push.attachProfile(profile('first'));
      driver.owned = false;
      driver.messages.add(message);
      await flush();
      expect(items, isEmpty);
      await subscription.cancel();
    },
  );
  test(
    'denied push permission leaves the inbox usable and avoids registration',
    () async {
      driver.permission = false;
      await push.attachProfile(profile('first'));
      expect(driver.calls, isEmpty);
      expect(push.registered, isFalse);
      expect(push.lastError, contains('In-app notifications'));
      await push.markRead('notice');
      expect(driver.calls.last.name, 'markNotificationRead');
      await push.acknowledgeWarning('warning');
      expect(driver.calls.last.name, 'acknowledgeCollisionWarning');
      await push.acknowledgeRouteInstruction('instruction');
      expect(driver.calls.last.data, {'instructionId': 'instruction'});
    },
  );
}
