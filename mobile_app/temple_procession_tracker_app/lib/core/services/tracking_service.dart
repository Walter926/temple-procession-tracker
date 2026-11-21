import 'dart:async';
import 'dart:math' as math;
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import '../models/location_update.dart';
import 'tracking_authorization_service.dart';

class TrackingAssignment {
  final String uid, eventId, groupId, eventName, groupName, groupStatus;
  const TrackingAssignment({
    required this.uid,
    required this.eventId,
    required this.groupId,
    this.eventName = '',
    this.groupName = '',
    this.groupStatus = '',
  });
}

/// Injectable boundary: tests do not require Firebase, a map, or real GPS.
abstract class TrackingDriver {
  String? get currentUid;
  Future<TrackingAssignment> assignment();
  Future<void> verify(TrackingAssignment assignment);
  Future<Position> currentPosition();
  Stream<Position> get positions;
  Stream<bool> get connection;
  Stream<String> revocations(TrackingAssignment assignment);
  Future<void> publish(LocationUpdate sample);
  Future<void> status(TrackingAssignment assignment, String state);
  Future<void> armDisconnect(TrackingAssignment assignment);
  Future<void> cancelPendingWrites();
  Future<void> updateGroupStatus(TrackingAssignment assignment, String status);
}

class FirebaseTrackingDriver implements TrackingDriver {
  final FirebaseAuth auth;
  final FirebaseFirestore firestore;
  final FirebaseDatabase database;
  FirebaseTrackingDriver({
    FirebaseAuth? auth,
    FirebaseFirestore? firestore,
    FirebaseDatabase? database,
  }) : auth = auth ?? FirebaseAuth.instance,
       firestore = firestore ?? FirebaseFirestore.instance,
       database = database ?? FirebaseDatabase.instance;
  @override
  String? get currentUid => auth.currentUser?.uid;
  @override
  Future<TrackingAssignment> assignment() async {
    final uid = currentUid;
    if (uid == null) throw StateError('Sign in first.');
    const options = GetOptions(source: Source.server);
    final user = (await firestore.doc('users/$uid').get(options)).data();
    final groupId = '${user?['assignedGroupId'] ?? ''}';
    if (groupId.isEmpty) throw StateError('No primary group assigned.');
    final group = (await firestore.doc('groups/$groupId').get(options)).data();
    final eventId = '${group?['eventId'] ?? ''}';
    if (group == null || eventId.isEmpty) {
      throw StateError('Assigned group is unavailable.');
    }
    final event = (await firestore.doc('events/$eventId').get(options)).data();
    if (event == null) throw StateError('Assigned event is unavailable.');
    return TrackingAssignment(
      uid: uid,
      eventId: eventId,
      groupId: groupId,
      eventName: '${event['name'] ?? ''}',
      groupName: '${group['name'] ?? ''}',
      groupStatus: '${group['status'] ?? ''}',
    );
  }

  @override
  Future<void> verify(TrackingAssignment a) => TrackingAuthorizationService(
    auth: auth,
    firestore: firestore,
  ).verifyPrimary(groupId: a.groupId, eventId: a.eventId);
  @override
  Future<Position> currentPosition() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw StateError(
        'Device Location Services are off. Turn on location before tracking.',
      );
    }
    final permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.deniedForever) {
      throw StateError(
        'Location permission is blocked. Enable it in app settings before tracking.',
      );
    }
    if (permission != LocationPermission.whileInUse &&
        permission != LocationPermission.always) {
      throw StateError('Grant foreground GPS permission before tracking.');
    }
    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 15),
      ),
    );
  }

  @override
  Stream<Position> get positions => Geolocator.getPositionStream(
    locationSettings: const LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 0,
    ),
  );
  @override
  Stream<bool> get connection => database
      .ref('.info/connected')
      .onValue
      .map((e) => e.snapshot.value == true);
  @override
  Stream<String> revocations(TrackingAssignment a) {
    late StreamController<String> controller;
    final subscriptions = <StreamSubscription<dynamic>>[];
    controller = StreamController<String>(
      onListen: () {
        void watch(
          String path,
          bool Function(Map<String, dynamic>?) valid,
          String reason,
        ) {
          subscriptions.add(
            firestore.doc(path).snapshots().listen(
              (s) {
                if (!valid(s.data())) controller.add(reason);
              },
              onError: (Object error) =>
                  controller.add('Cannot verify tracking access: $error'),
            ),
          );
        }

        watch(
          'users/${a.uid}',
          (d) =>
              d?['isActive'] == true &&
              d?['role'] == 'teamLeader' &&
              d?['assignedGroupId'] == a.groupId,
          'Leader permission changed.',
        );
        watch(
          'groups/${a.groupId}',
          (d) => d?['leaderUserId'] == a.uid && d?['eventId'] == a.eventId,
          'Primary assignment changed.',
        );
        watch(
          'events/${a.eventId}',
          (d) => d?['status'] == 'active',
          'Event is no longer active.',
        );
        subscriptions.add(
          auth.authStateChanges().listen((user) {
            if (user?.uid != a.uid) {
              controller.add('Signed-in account changed.');
            }
          }),
        );
      },
      onCancel: () async {
        for (final s in subscriptions) {
          await s.cancel();
        }
      },
    );
    return controller.stream;
  }

  @override
  Future<void> publish(LocationUpdate sample) => database
      .ref('liveLocations/${sample.eventId}/${sample.groupId}')
      .set(sample.toRealtimeDatabase(ServerValue.timestamp));
  @override
  Future<void> status(TrackingAssignment a, String state) =>
      database.ref('trackingStatus/${a.eventId}/${a.groupId}').set({
        'userId': a.uid,
        'state': state,
        'updatedAt': ServerValue.timestamp,
      });
  @override
  Future<void> armDisconnect(TrackingAssignment a) => database
      .ref('trackingStatus/${a.eventId}/${a.groupId}')
      .onDisconnect()
      .set({
        'userId': a.uid,
        'state': 'stopped',
        'updatedAt': ServerValue.timestamp,
      });
  // Tracking is the sole RTDB writer in the mobile app. Never retain an offline GPS queue.
  @override
  Future<void> cancelPendingWrites() => database.purgeOutstandingWrites();
  @override
  Future<void> updateGroupStatus(TrackingAssignment a, String status) =>
      firestore.doc('groups/${a.groupId}').update({
        'status': status,
        'statusUpdatedAt': FieldValue.serverTimestamp(),
      });
}

/// App-owned singleton via Provider. Screens observe it and must not dispose it.
class TrackingService extends ChangeNotifier {
  final TrackingDriver _driver;
  final DateTime Function() _now;
  final bool automaticTicks;
  TrackingService({
    TrackingDriver? driver,
    DateTime Function()? now,
    this.automaticTicks = true,
  }) : _driver = driver ?? FirebaseTrackingDriver(),
       _now = now ?? DateTime.now;
  TrackingAssignment? _assignment;
  StreamSubscription<Position>? _gps;
  StreamSubscription<bool>? _connection;
  StreamSubscription<String>? _access;
  Timer? _timer;
  Future<void> _operations = Future.value();
  Future<void>? _startRequest;
  bool _closed = false, _connected = false, _sending = false;
  int _epoch = 0, _failures = 0;
  DateTime? _verifiedAt, _heartbeatAt, _retryAt, _lastSampleAt;
  Position? _accepted;
  DateTime? lastSentAt;
  Position? position;
  String state = 'inactive';
  String connectionState = 'not started';
  String? gpsError;
  String? error, warning;
  String eventName = '', groupName = '', groupStatus = '';
  String get eventId => _assignment?.eventId ?? '';
  String get groupId => _assignment?.groupId ?? '';
  bool get isRunning =>
      ['active', 'reconnecting', 'paused', 'starting'].contains(state);
  bool get isTransitioning => state == 'starting';
  String get gpsState => gpsError != null
      ? 'unavailable'
      : state == 'paused'
      ? 'paused'
      : position == null
      ? (isRunning ? 'waiting for a fix' : 'not requested')
      : _now().difference(position!.timestamp) > const Duration(seconds: 20)
      ? 'stale'
      : 'current';
  void _notify() {
    if (!_closed) notifyListeners();
  }

  bool _current(int epoch) => !_closed && epoch == _epoch;
  Future<void> _serial(Future<void> Function() operation) {
    final result = _operations.then((_) async {
      if (!_closed) await operation();
    });
    _operations = result.catchError((Object _) {});
    return result;
  }

  Future<void> loadAssignment() => _serial(() async {
    if (isRunning) return;
    try {
      _setAssignment(await _driver.assignment());
      error = null;
    } catch (reason) {
      _assignment = null;
      eventName = groupName = groupStatus = '';
      error = '$reason';
    }
    _notify();
  });
  void _setAssignment(TrackingAssignment a) {
    _assignment = a;
    eventName = a.eventName;
    groupName = a.groupName;
    groupStatus = a.groupStatus;
  }

  Future<void> start() {
    if (_startRequest != null) return _startRequest!;
    if (isRunning) return Future.value();
    final epoch = ++_epoch;
    final request = _serial(() => _start(epoch));
    _startRequest = request;
    return request.whenComplete(() => _startRequest = null);
  }

  Future<void> _start(int epoch) async {
    if (!_current(epoch)) return;
    state = 'starting';
    connectionState = 'connecting';
    gpsError = null;
    error = warning = null;
    position = _accepted = null;
    lastSentAt = _lastSampleAt = _verifiedAt = _heartbeatAt = _retryAt = null;
    _failures = 0;
    _connected = false;
    _notify();
    try {
      await _cancelLocal();
      await _driver.cancelPendingWrites();
      final assignment = await _driver.assignment();
      if (!_current(epoch)) return;
      _setAssignment(assignment);
      await _driver.verify(assignment);
      if (!_current(epoch)) return;
      _verifiedAt = _now();
      final sample = await _driver.currentPosition();
      if (!_current(epoch)) return;
      _accept(sample);
      _access = _driver.revocations(assignment).listen(
        (reason) {
          if (_assignment == assignment && isRunning) {
            unawaited(stop(reason: reason));
          }
        },
        onError: (Object e) =>
            unawaited(stop(reason: 'Tracking access unavailable: $e')),
      );
      _watchConnection(assignment);
      _subscribeGps(epoch);
      state = 'reconnecting';
      if (automaticTicks) {
        _timer = Timer.periodic(
          const Duration(seconds: 1),
          (_) => unawaited(tick()),
        );
      }
      _notify();
      await tick();
    } catch (reason) {
      if (_current(epoch)) {
        state = 'error';
        connectionState = 'not connected';
        error = '$reason';
        await _cancelLocal();
        _notify();
      }
    }
  }

  void _watchConnection(TrackingAssignment assignment) {
    _connection = _driver.connection.listen(
      (connected) {
        if (_closed || _assignment != assignment || !isRunning) return;
        _connected = connected;
        connectionState = connected ? 'connected' : 'offline';
        _heartbeatAt = null;
        _verifiedAt = null;
        if (!connected) {
          if (state != 'paused') state = 'reconnecting';
          warning =
              'Offline. Old GPS samples are discarded; waiting to reconnect.';
          unawaited(_discardPending());
        } else {
          if (gpsError == null) warning = null;
          _retryAt = null;
          unawaited(tick());
        }
        _notify();
      },
      onError: (Object e) {
        if (_closed || _assignment != assignment || !isRunning) return;
        _connected = false;
        connectionState = 'unavailable';
        if (state != 'paused') state = 'reconnecting';
        warning = 'Connection unavailable: $e';
        unawaited(_discardPending());
        _notify();
      },
    );
  }

  void _subscribeGps(int epoch) {
    _gps = _driver.positions.listen(
      (sample) {
        if (_current(epoch)) _accept(sample);
      },
      onError: (Object reason) {
        if (!_current(epoch)) return;
        position = null;
        gpsError = '$reason';
        warning = 'GPS unavailable: $reason';
        _notify();
      },
    );
  }

  /// Samples are never re-timestamped, duplicated, or replayed on reconnect.
  void _accept(Position sample) {
    final age = _now().difference(sample.timestamp);
    String? rejection;
    if (!sample.latitude.isFinite ||
        !sample.longitude.isFinite ||
        sample.latitude.abs() > 90 ||
        sample.longitude.abs() > 180 ||
        !sample.accuracy.isFinite ||
        sample.accuracy <= 0 ||
        sample.accuracy > 50) {
      rejection = 'GPS quality is insufficient (accuracy must be within 50 m).';
    } else if (age > const Duration(seconds: 20) ||
        age < const Duration(seconds: -5)) {
      rejection = 'GPS sample is stale or its clock is invalid.';
    } else if (_accepted != null &&
        !sample.timestamp.isAfter(_accepted!.timestamp)) {
      return;
    } else if (_accepted != null) {
      final seconds =
          sample.timestamp.difference(_accepted!.timestamp).inMilliseconds /
          1000;
      final distance = Geolocator.distanceBetween(
        _accepted!.latitude,
        _accepted!.longitude,
        sample.latitude,
        sample.longitude,
      );
      if (seconds > 0 &&
          distance > sample.accuracy + _accepted!.accuracy + 45 * seconds) {
        rejection = 'GPS jump rejected; waiting for a reliable reading.';
      }
    }
    if (rejection != null) {
      warning = rejection;
      _notify();
      return;
    }
    position = _accepted = sample;
    gpsError = null;
    warning = null;
    _notify();
  }

  @visibleForTesting
  Future<void> tick() async {
    if (_closed ||
        !['active', 'reconnecting', 'paused'].contains(state) ||
        _sending ||
        !_connected) {
      return;
    }
    if (_retryAt != null && _now().isBefore(_retryAt!)) return;
    final a = _assignment;
    if (a == null) return;
    final epoch = _epoch;
    _sending = true;
    try {
      if (_driver.currentUid != a.uid) {
        throw StateError('Signed-in account changed.');
      }
      if (_verifiedAt == null ||
          _now().difference(_verifiedAt!) >= const Duration(seconds: 30)) {
        await _driver.verify(a).timeout(const Duration(seconds: 8));
        if (!_current(epoch)) return;
        _verifiedAt = _now();
      }
      if (_heartbeatAt == null ||
          _now().difference(_heartbeatAt!) >= const Duration(seconds: 10)) {
        await _driver.armDisconnect(a).timeout(const Duration(seconds: 8));
        if (!_current(epoch) || !_connected) return;
        await _driver
            .status(a, state == 'paused' ? 'paused' : 'active')
            .timeout(const Duration(seconds: 8));
        if (!_current(epoch) || !_connected) return;
        _heartbeatAt = _now();
      }
      if (state == 'paused') return;
      state = 'active';
      final sample = position;
      if (sample == null ||
          _now().difference(sample.timestamp) > const Duration(seconds: 20)) {
        warning = gpsError != null
            ? 'GPS unavailable: $gpsError'
            : sample == null
            ? 'Waiting for a reliable GPS fix; no position is uploaded.'
            : 'GPS is stale; no position is uploaded.';
        _notify();
        return;
      }
      final interval = Duration(
        seconds: sample.speed.isFinite && sample.speed >= 0.8 ? 5 : 10,
      );
      if ((lastSentAt != null && _now().difference(lastSentAt!) < interval) ||
          (_lastSampleAt != null &&
              !sample.timestamp.isAfter(_lastSampleAt!))) {
        _notify();
        return;
      }
      if (!_current(epoch) || !_connected) return;
      final item = LocationUpdate(
        id: '',
        eventId: a.eventId,
        groupId: a.groupId,
        userId: a.uid,
        latitude: sample.latitude,
        longitude: sample.longitude,
        accuracyMeters: sample.accuracy,
        speedMetersPerSecond: sample.speed.isFinite && sample.speed > 0
            ? sample.speed
            : 0,
        headingDegrees:
            sample.heading.isFinite &&
                sample.heading >= 0 &&
                sample.heading < 360
            ? sample.heading
            : 0,
        recordedAt: sample.timestamp,
      );
      await _driver.publish(item).timeout(const Duration(seconds: 8));
      if (!_current(epoch) || !_connected) return;
      lastSentAt = _now();
      _lastSampleAt = sample.timestamp;
      _failures = 0;
      _retryAt = null;
      warning = null;
      _notify();
    } catch (reason) {
      await _discardPending();
      if (!_current(epoch)) return;
      if (reason is StateError ||
          (reason is FirebaseException &&
              ['permission-denied', 'unauthenticated'].contains(reason.code))) {
        ++_epoch;
        state = 'error';
        connectionState = 'not connected';
        error = 'Tracking stopped: $reason';
        await _cancelLocal();
      } else {
        final seconds = math.min(30, 1 << math.min(++_failures, 5));
        _retryAt = _now().add(Duration(seconds: seconds));
        if (state != 'paused') state = 'reconnecting';
        warning =
            'Reconnecting in $seconds seconds. No offline GPS queue is retained.';
      }
      _notify();
    } finally {
      _sending = false;
    }
  }

  Future<void> pause() {
    if (!['active', 'reconnecting'].contains(state)) return Future.value();
    ++_epoch;
    state = 'paused';
    _notify();
    return _serial(() async {
      await _gps?.cancel();
      _gps = null;
      await _discardPending();
      _heartbeatAt = null;
      await tick();
    });
  }

  Future<void> resume() => _serial(() async {
    if (state != 'paused') return;
    final epoch = ++_epoch;
    try {
      await _driver.verify(_assignment!);
      if (!_current(epoch)) return;
      _verifiedAt = _now();
      final sample = await _driver.currentPosition();
      if (!_current(epoch)) return;
      _accept(sample);
      _subscribeGps(epoch);
      state = 'reconnecting';
      lastSentAt = null;
      _heartbeatAt = null;
      _notify();
      await tick();
    } catch (reason) {
      if (_current(epoch)) {
        state = 'error';
        connectionState = 'not connected';
        error = '$reason';
        await _cancelLocal();
        _notify();
      }
    }
  });
  Future<void> updateGroupStatus(String next) => _serial(() async {
    if (![
      'waiting',
      'preparing',
      'moving',
      'stopped',
      'delayed',
      'arrived',
      'completed',
      'emergency',
    ].contains(next)) {
      throw ArgumentError('Invalid group status.');
    }
    if (state != 'active') {
      throw StateError('Start tracking before changing group status.');
    }
    await _driver.verify(_assignment!);
    await _driver.updateGroupStatus(_assignment!, next);
    groupStatus = next;
    _notify();
  });
  Future<void> _discardPending() async {
    try {
      await _driver.cancelPendingWrites();
    } catch (_) {
      /* Best effort at platform shutdown. */
    }
  }

  Future<void> _cancelLocal() async {
    _timer?.cancel();
    _timer = null;
    await _gps?.cancel();
    _gps = null;
    await _connection?.cancel();
    _connection = null;
    await _access?.cancel();
    _access = null;
  }

  Future<void> stop({String? reason}) {
    ++_epoch;
    state = 'inactive';
    if (reason != null) warning = reason;
    _notify();
    unawaited(_discardPending());
    return _serial(() async {
      state = 'inactive';
      await _cancelLocal();
      await _discardPending();
      final a = _assignment;
      if (a != null && _connected && _driver.currentUid == a.uid) {
        try {
          await _driver
              .status(a, 'stopped')
              .timeout(const Duration(seconds: 3));
        } catch (_) {
          await _discardPending(); /* Revocation may already prevent writes. */
        }
      }
      _connected = false;
      connectionState = 'not started';
      _notify();
    });
  }

  @override
  void dispose() {
    _closed = true;
    ++_epoch;
    _timer?.cancel();
    unawaited(_cancelLocal());
    unawaited(_discardPending());
    super.dispose();
  }
}
