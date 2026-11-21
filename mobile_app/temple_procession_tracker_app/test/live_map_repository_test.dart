import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:temple_procession_tracker_app/core/models/map_view_records.dart';
import 'package:temple_procession_tracker_app/core/repositories/live_map_repository.dart';

class FakeLiveMapDriver implements LiveMapDriver {
  @override
  bool isSignedIn = true;
  final feeds = <String, StreamController<LiveMapChildChange>>{};
  final watched = <String>[];
  final cancelled = <String>[];

  @override
  Stream<LiveMapChildChange> children(String path) {
    watched.add(path);
    final controller = StreamController<LiveMapChildChange>(
      sync: true,
      onCancel: () => cancelled.add(path),
    );
    feeds[path] = controller;
    return controller.stream;
  }

  void emit(String path, String id, Object? value) =>
      feeds[path]!.add(LiveMapChildChange(id, value));

  Future<void> close() async {
    for (final controller in feeds.values) {
      await controller.close();
    }
  }
}

/// Deliberately retains callbacks after cancellation to model an in-flight
/// transport callback. A conforming Dart stream would already suppress these.
class LateCallbackStream extends Stream<LiveMapChildChange> {
  void Function(LiveMapChildChange)? onDataCallback;
  void Function(Object, StackTrace)? onErrorCallback;
  void Function()? onDoneCallback;
  int cancellations = 0;
  late final source = StreamController<LiveMapChildChange>(
    sync: true,
    onCancel: () => cancellations++,
  );

  @override
  StreamSubscription<LiveMapChildChange> listen(
    void Function(LiveMapChildChange)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    onDataCallback = onData;
    onErrorCallback = onError as void Function(Object, StackTrace)?;
    onDoneCallback = onDone;
    return source.stream.listen(
      onData,
      onError: onError,
      onDone: onDone,
      cancelOnError: cancelOnError,
    );
  }
}

class LateCallbackDriver implements LiveMapDriver {
  final changes = LateCallbackStream();
  @override
  bool get isSignedIn => true;
  @override
  Stream<LiveMapChildChange> children(String path) => changes;
}

Map<String, Object?> location({
  double latitude = 49,
  int recordedAt = 1000,
  double heading = 0,
  double accuracy = 8,
}) => {
  'userId': 'leader',
  'latitude': latitude,
  'longitude': -123,
  'recordedAt': recordedAt,
  'headingDegrees': heading,
  'accuracyMeters': accuracy,
};

Future<void> flush() async {
  await Future<void>.delayed(Duration.zero);
}

void main() {
  const livePath = 'liveLocations/event';
  const presencePath = 'trackingStatus/event';
  late FakeLiveMapDriver driver;
  late LiveMapRepository repo;
  setUp(() {
    driver = FakeLiveMapDriver();
    repo = LiveMapRepository(liveDriver: driver);
  });
  tearDown(() => driver.close());

  test('signed-out viewers do not subscribe to either private feed', () async {
    driver.isSignedIn = false;
    expect(await repo.live('event').first, isEmpty);
    expect(await repo.trackingStates('event').first, isEmpty);
    expect(driver.watched, isEmpty);
  });

  test(
    'empty event settles, child batches coalesce, unchanged groups retain identity',
    () async {
      final snapshots = <Map<String, LiveGroupPosition>>[];
      final subscription = repo.live('event').listen(snapshots.add);
      addTearDown(subscription.cancel);
      await flush();
      expect(snapshots.single, isEmpty);
      driver.emit(livePath, 'one', location());
      driver.emit(livePath, 'two', location(latitude: 48));
      await flush();
      expect(snapshots.length, 2);
      final original = snapshots.last;
      final two = original['two'];
      driver.emit(livePath, 'one', location(latitude: 50));
      await flush();
      expect(snapshots.last['two'], same(two));
      expect(snapshots.last['one']!.latitude, 50);
      expect(original['one']!.latitude, 49);
      expect(() => snapshots.last.clear(), throwsUnsupportedError);
      driver.emit(livePath, 'one', location(latitude: 50));
      await flush();
      expect(snapshots.length, 3);
      expect(driver.watched, [livePath]);
    },
  );

  test(
    'heartbeat/heading/accuracy changes publish without losing other cached groups',
    () async {
      final snapshots = <Map<String, LiveGroupPosition>>[];
      final subscription = repo.live('event').listen(snapshots.add);
      addTearDown(subscription.cancel);
      driver.emit(livePath, 'one', location());
      driver.emit(livePath, 'two', location(latitude: 48));
      await flush();
      final two = snapshots.last['two'];
      driver.emit(
        livePath,
        'one',
        location(recordedAt: 2000, heading: 90, accuracy: 20),
      );
      await flush();
      expect(snapshots.last['one']!.recordedAt!.millisecondsSinceEpoch, 2000);
      expect(snapshots.last['one']!.headingDegrees, 90);
      expect(snapshots.last['one']!.accuracyMeters, 20);
      expect(snapshots.last['two'], same(two));
    },
  );

  test(
    'invalid/deleted children are removed and valid replacements return',
    () async {
      final snapshots = <Map<String, LiveGroupPosition>>[];
      final subscription = repo.live('event').listen(snapshots.add);
      addTearDown(subscription.cancel);
      driver.emit(livePath, 'one', location());
      driver.emit(livePath, 'two', location(latitude: 48));
      await flush();
      driver.emit(livePath, 'one', location(latitude: double.nan));
      driver.emit(livePath, 'two', null);
      driver.emit(livePath, 'bad', 'not an object');
      await flush();
      expect(snapshots.last, isEmpty);
      driver.emit(livePath, 'one', location(latitude: 51));
      await flush();
      expect(snapshots.last.keys, ['one']);
      expect(snapshots.last['one']!.latitude, 51);
    },
  );

  test(
    'presence changes are incremental and continue to age without new writes',
    () async {
      final snapshots = <Map<String, TrackingPresence>>[];
      final subscription = repo.trackingStates('event').listen(snapshots.add);
      addTearDown(subscription.cancel);
      final now = DateTime.utc(2026, 11, 17);
      final active = {
        'state': 'active',
        'updatedAt': now.millisecondsSinceEpoch,
      };
      driver.emit(presencePath, 'one', active);
      driver.emit(presencePath, 'two', active);
      await flush();
      final one = snapshots.last['one']!;
      driver.emit(presencePath, 'two', {
        'state': 'paused',
        'updatedAt': now.millisecondsSinceEpoch,
      });
      await flush();
      expect(snapshots.last['one'], same(one));
      expect(
        one.effectiveState(now.add(const Duration(seconds: 46))),
        'disconnected',
      );
      expect(snapshots.last['two']!.effectiveState(now), 'paused');
      final count = snapshots.length;
      driver.emit(presencePath, 'one', active);
      await flush();
      expect(snapshots.length, count);
      driver.emit(presencePath, 'one', null);
      await flush();
      expect(snapshots.last.keys, ['two']);
    },
  );

  test(
    'permission error drops a pending child, clears private data and closes',
    () async {
      final snapshots = <Map<String, LiveGroupPosition>>[];
      final errors = <Object>[];
      final sequence = <String>[];
      final done = Completer<void>();
      final subscription = repo
          .live('event')
          .listen(
            (snapshot) {
              snapshots.add(snapshot);
              sequence.add(snapshot.isEmpty ? 'empty' : 'private data');
            },
            onError: (Object error) {
              errors.add(error);
              sequence.add('error');
            },
            onDone: () {
              sequence.add('done');
              done.complete();
            },
          );
      addTearDown(subscription.cancel);
      driver.emit(livePath, 'one', location());
      await flush();
      expect(snapshots.last['one']!.latitude, 49);
      final beforeError = snapshots.length;
      sequence.clear();
      // All three events happen before the pending cache microtask can run.
      driver.emit(livePath, 'one', location(latitude: 50));
      final error = StateError('Permission denied');
      driver.feeds[livePath]!.addError(error);
      driver.emit(livePath, 'late', location(latitude: 51));
      await done.future;
      expect(errors, [error]);
      expect(snapshots.skip(beforeError), [isEmpty]);
      expect(sequence, ['empty', 'error', 'done']);
      await flush();
      expect(snapshots.length, beforeError + 1);
      expect(driver.cancelled, [livePath]);
      expect(driver.feeds[livePath]!.hasListener, isFalse);
    },
  );

  for (final presence in [false, true]) {
    test(
      '${presence ? 'presence' : 'GPS'} terminal fence ignores late data/error/done callbacks',
      () async {
        final transport = LateCallbackDriver();
        addTearDown(transport.changes.source.close);
        final repository = LiveMapRepository(liveDriver: transport);
        final stream = presence
            ? repository.trackingStates('event')
            : repository.live('event');
        final snapshots = <Map<String, Object>>[];
        final errors = <Object>[];
        final stacks = <StackTrace>[];
        final done = Completer<void>();
        var completions = 0;
        final subscription = stream.listen(
          snapshots.add,
          onError: (Object error, StackTrace stack) {
            errors.add(error);
            stacks.add(stack);
          },
          onDone: () {
            completions++;
            done.complete();
          },
        );
        addTearDown(subscription.cancel);
        final callbacks = transport.changes;
        final payload = presence
            ? <String, Object?>{'state': 'active', 'updatedAt': 1000}
            : location();
        callbacks.onDataCallback!(LiveMapChildChange('one', payload));
        await flush();
        expect(snapshots.last.keys, ['one']);
        final beforeError = snapshots.length;
        callbacks.onDataCallback!(LiveMapChildChange('pending', payload));
        final error = StateError('Permission denied');
        final stack = StackTrace.current;
        callbacks.onErrorCallback!(error, stack);
        // Invoke callbacks even though the upstream subscription is cancelled.
        callbacks.onDataCallback!(LiveMapChildChange('late', payload));
        callbacks.onDoneCallback!();
        await done.future;
        expect(snapshots.skip(beforeError), [isEmpty]);
        callbacks.onErrorCallback!(
          StateError('Duplicate transport error'),
          stack,
        );
        callbacks.onDataCallback!(LiveMapChildChange('after close', payload));
        callbacks.onDoneCallback!();
        await flush();
        expect(snapshots.skip(beforeError), [isEmpty]);
        expect(errors, [same(error)]);
        expect(stacks, [same(stack)]);
        expect(completions, 1);
        expect(callbacks.cancellations, 1);
        expect(callbacks.source.hasListener, isFalse);
      },
    );
  }

  test('consumer cancellation suppresses a pending cache emission', () async {
    final snapshots = <Map<String, LiveGroupPosition>>[];
    final subscription = repo.live('event').listen(snapshots.add);
    await flush();
    driver.emit(livePath, 'one', location());
    await subscription.cancel();
    await flush();
    expect(snapshots, [isEmpty]);
    expect(driver.cancelled, [livePath]);
  });

  test(
    'source completion flushes the final child and closes the viewer stream',
    () async {
      final snapshots = <Map<String, LiveGroupPosition>>[];
      final done = Completer<void>();
      final subscription = repo
          .live('event')
          .listen(snapshots.add, onDone: done.complete);
      addTearDown(subscription.cancel);
      driver.emit(livePath, 'one', location());
      await driver.feeds[livePath]!.close();
      await done.future;
      expect(snapshots.last['one']!.latitude, 49);
      expect(driver.cancelled, [livePath]);
    },
  );
}
