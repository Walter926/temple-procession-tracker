import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:temple_procession_tracker_app/core/models/location_update.dart';
import 'package:temple_procession_tracker_app/core/services/tracking_service.dart';

Future<void> flush() async {
  for (var i = 0; i < 8; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

Position sample(
  DateTime time, {
  double speed = 0,
  double accuracy = 8,
  double latitude = 49,
}) => Position(
  latitude: latitude,
  longitude: -123,
  timestamp: time,
  accuracy: accuracy,
  altitude: 0,
  altitudeAccuracy: 0,
  heading: 0,
  headingAccuracy: 0,
  speed: speed,
  speedAccuracy: 1,
);

class FakeTrackingDriver implements TrackingDriver {
  final gps = StreamController<Position>.broadcast(sync: true);
  final connections = StreamController<bool>.broadcast(sync: true);
  final revoked = StreamController<String>.broadcast(sync: true);
  final published = <LocationUpdate>[];
  final statuses = <String>[];
  late Position current;
  int assignments = 0, purges = 0, arms = 0, positionReads = 0;
  Completer<void>? assignmentGate, publishGate;
  Object? publishError, verifyError;
  bool online = true;
  @override
  String? currentUid = 'leader';
  static const assigned = TrackingAssignment(
    uid: 'leader',
    eventId: 'event',
    groupId: 'group',
  );
  @override
  Future<TrackingAssignment> assignment() async {
    assignments++;
    await assignmentGate?.future;
    return assigned;
  }

  @override
  Future<void> verify(TrackingAssignment a) async {
    if (verifyError != null) throw verifyError!;
  }

  @override
  Future<Position> currentPosition() async {
    positionReads++;
    return current;
  }

  @override
  Stream<Position> get positions => gps.stream;
  @override
  Stream<bool> get connection async* {
    yield online;
    yield* connections.stream;
  }

  @override
  Stream<String> revocations(TrackingAssignment a) => revoked.stream;
  @override
  Future<void> publish(LocationUpdate item) async {
    if (publishError != null) throw publishError!;
    await publishGate?.future;
    published.add(item);
  }

  @override
  Future<void> status(TrackingAssignment a, String state) async {
    statuses.add(state);
  }

  @override
  Future<void> armDisconnect(TrackingAssignment a) async {
    arms++;
  }

  @override
  Future<void> cancelPendingWrites() async {
    purges++;
  }

  @override
  Future<void> updateGroupStatus(TrackingAssignment a, String status) async {}
  Future<void> close() async {
    await gps.close();
    await connections.close();
    await revoked.close();
  }
}

void main() {
  late DateTime now;
  late FakeTrackingDriver driver;
  late TrackingService tracker;
  setUp(() {
    now = DateTime.utc(2026, 11, 17, 12);
    driver = FakeTrackingDriver()..current = sample(now);
    tracker = TrackingService(
      driver: driver,
      now: () => now,
      automaticTicks: false,
    );
  });
  tearDown(() async {
    await tracker.stop();
    tracker.dispose();
    await driver.close();
  });
  Future<void> start() async {
    await tracker.start();
    await flush();
  }

  Future<void> advance(int seconds, {double speed = 0}) async {
    now = now.add(Duration(seconds: seconds));
    driver.current = sample(now, speed: speed);
    driver.gps.add(driver.current);
    await tracker.tick();
    await flush();
  }

  test(
    'parallel starts create one assignment and GPS subscription; stop cleans up',
    () async {
      await Future.wait([tracker.start(), tracker.start(), tracker.start()]);
      await flush();
      expect(driver.assignments, 1);
      expect(driver.positionReads, 1);
      expect(driver.gps.hasListener, isTrue);
      expect(tracker.state, 'active');
      expect(driver.published.length, 1);
      await tracker.stop();
      expect(driver.gps.hasListener, isFalse);
      expect(driver.statuses.last, 'stopped');
    },
  );
  test('stop wins over a start waiting for server assignment', () async {
    driver.assignmentGate = Completer<void>();
    final starting = tracker.start();
    await flush();
    final stopping = tracker.stop(reason: 'Logged out');
    driver.assignmentGate!.complete();
    await Future.wait([starting, stopping]);
    await flush();
    expect(tracker.state, 'inactive');
    expect(driver.positionReads, 0);
    expect(driver.published, isEmpty);
    expect(driver.gps.hasListener, isFalse);
  });
  test('stop before the start microtask prevents all GPS work', () async {
    final starting = tracker.start();
    final stopping = tracker.stop();
    await Future.wait([starting, stopping]);
    expect(driver.assignments, 0);
    expect(tracker.state, 'inactive');
  });
  test(
    'stationary dwell gets distinct samples at ten seconds, moving at five',
    () async {
      await start();
      await advance(5);
      expect(driver.published.length, 1);
      await advance(5);
      expect(driver.published.length, 2);
      expect(driver.published.last.recordedAt, now);
      await advance(5, speed: 1);
      expect(driver.published.length, 3);
      expect(
        driver.published.last.toRealtimeDatabase(999)['recordedAt'],
        now.millisecondsSinceEpoch,
      );
      await tracker.tick();
      expect(
        driver.published.length,
        3,
        reason: 'A repeated sensor sample cannot create artificial dwell.',
      );
    },
  );
  test(
    'heartbeat continues without new GPS but stale samples are never resent',
    () async {
      await start();
      now = now.add(const Duration(seconds: 31));
      await tracker.tick();
      expect(driver.published.length, 1);
      expect(driver.statuses.where((s) => s == 'active').length, 2);
      expect(tracker.warning, contains('stale'));
    },
  );
  test(
    'quality, future clocks and implausible jumps do not replace accepted GPS',
    () async {
      await start();
      final accepted = tracker.position;
      now = now.add(const Duration(seconds: 10));
      driver.gps.add(sample(now, accuracy: 120));
      expect(tracker.position, same(accepted));
      driver.gps.add(sample(now.add(const Duration(minutes: 5))));
      expect(tracker.position, same(accepted));
      driver.gps.add(sample(now, latitude: 50));
      expect(tracker.position, same(accepted));
      await tracker.tick();
      expect(driver.published.length, 1);
    },
  );
  test(
    'pause stops GPS, keeps a paused heartbeat and parallel resume starts once',
    () async {
      await start();
      await tracker.pause();
      await flush();
      expect(tracker.state, 'paused');
      expect(driver.gps.hasListener, isFalse);
      expect(driver.statuses.last, 'paused');
      final count = driver.published.length;
      now = now.add(const Duration(seconds: 10));
      await tracker.tick();
      expect(driver.published.length, count);
      driver.current = sample(now);
      await Future.wait([tracker.resume(), tracker.resume()]);
      await flush();
      expect(tracker.state, 'active');
      expect(driver.positionReads, 2);
      expect(driver.gps.hasListener, isTrue);
    },
  );
  test(
    'disconnect purges pending writes and old samples are not fresh on reconnect',
    () async {
      await start();
      final count = driver.published.length, purges = driver.purges;
      driver.online = false;
      driver.connections.add(false);
      await flush();
      expect(tracker.state, 'reconnecting');
      expect(driver.purges, greaterThan(purges));
      now = now.add(const Duration(minutes: 1));
      driver.online = true;
      driver.connections.add(true);
      await flush();
      expect(driver.published.length, count);
      expect(tracker.warning, contains('stale'));
      driver.gps.add(sample(now));
      await tracker.tick();
      expect(driver.published.length, count + 1);
    },
  );
  test(
    'recoverable upload failures back off and do not stop after three failures',
    () async {
      await start();
      driver.publishError = Exception('network');
      now = now.add(const Duration(seconds: 10));
      driver.gps.add(sample(now));
      await tracker.tick();
      expect(tracker.state, 'reconnecting');
      expect(tracker.warning, contains('2 seconds'));
      now = now.add(const Duration(seconds: 2));
      await tracker.tick();
      expect(tracker.warning, contains('4 seconds'));
      now = now.add(const Duration(seconds: 4));
      await tracker.tick();
      expect(tracker.warning, contains('8 seconds'));
      driver.publishError = null;
      now = now.add(const Duration(seconds: 8));
      driver.gps.add(sample(now));
      await tracker.tick();
      expect(tracker.state, 'active');
      expect(driver.published.length, 2);
    },
  );
  test(
    'reassignment and account switching revoke publishing without screen disposal',
    () async {
      await start();
      driver.revoked.add('Reassigned');
      await flush();
      expect(tracker.state, 'inactive');
      expect(driver.gps.hasListener, isFalse);
      await start();
      driver.currentUid = 'other';
      now = now.add(const Duration(seconds: 10));
      await tracker.tick();
      expect(tracker.state, 'error');
      expect(driver.gps.hasListener, isFalse);
    },
  );
  test(
    'idle, offline and connected states are independent from GPS readiness',
    () async {
      expect(tracker.connectionState, 'not started');
      expect(tracker.gpsState, 'not requested');
      driver.online = false;
      await start();
      expect(tracker.connectionState, 'offline');
      expect(tracker.gpsState, 'current');
      expect(driver.published, isEmpty);
      driver.connections.add(true);
      await flush();
      expect(tracker.connectionState, 'connected');
      expect(driver.published, hasLength(1));
      await tracker.stop();
      expect(tracker.connectionState, 'not started');
    },
  );
  test(
    'connection listener failure leaves active mode and purges queued GPS',
    () async {
      await start();
      final purges = driver.purges, count = driver.published.length;
      driver.connections.addError(Exception('transport failed'));
      await flush();
      expect(tracker.connectionState, 'unavailable');
      expect(tracker.state, 'reconnecting');
      expect(driver.purges, greaterThan(purges));
      now = now.add(const Duration(seconds: 10));
      driver.gps.add(sample(now));
      await tracker.tick();
      expect(driver.published.length, count);
      driver.connections.add(true);
      await flush();
      expect(tracker.connectionState, 'connected');
      expect(tracker.state, 'active');
    },
  );
  test(
    'GPS stream failure prevents old-position publishing until a valid fix returns',
    () async {
      await start();
      final count = driver.published.length;
      driver.gps.addError(
        Exception('permission or location service unavailable'),
      );
      await flush();
      expect(tracker.position, isNull);
      expect(tracker.gpsState, 'unavailable');
      expect(tracker.connectionState, 'connected');
      now = now.add(const Duration(seconds: 10));
      await tracker.tick();
      expect(driver.published.length, count);
      expect(tracker.warning, contains('GPS unavailable'));
      driver.gps.add(sample(now));
      await tracker.tick();
      expect(tracker.gpsState, 'current');
      expect(driver.published.length, count + 1);
    },
  );
  test(
    'failed primary verification never requests GPS or subscribes to a feed',
    () async {
      driver.verifyError = StateError('Backup leader is not the primary');
      await start();
      expect(tracker.state, 'error');
      expect(driver.positionReads, 0);
      expect(driver.gps.hasListener, isFalse);
      expect(driver.connections.hasListener, isFalse);
      expect(driver.published, isEmpty);
    },
  );
}
