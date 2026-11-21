import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart' hide Query;
import '../models/map_view_records.dart';

class LiveMapRepository {
  bool get isSignedIn => _liveDriver.isSignedIn;
  final FirebaseFirestore? _firestoreInstance;
  final FirebaseAuth? _authInstance;
  final LiveMapDriver _liveDriver;
  FirebaseFirestore get _firestore =>
      _firestoreInstance ?? FirebaseFirestore.instance;
  FirebaseAuth get _auth => _authInstance ?? FirebaseAuth.instance;
  LiveMapRepository({
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
    FirebaseDatabase? database,
    LiveMapDriver? liveDriver,
  }) : _firestoreInstance = firestore,
       _authInstance = auth,
       _liveDriver = liveDriver ?? _FirebaseLiveMapDriver(auth, database);

  // Do not hide published events with a missing route: the map explains that state.
  Stream<List<PublishedEventView>> publishedEvents() => _firestore
      .collection('publicEvents')
      .where('isPublic', isEqualTo: true)
      .where('status', whereIn: ['scheduled', 'active'])
      .limit(100)
      .snapshots()
      .map(
        (s) =>
            s.docs.map(PublishedEventView.fromDoc).toList()
              ..sort((a, b) => a.name.compareTo(b.name)),
      );
  Stream<PublishedEventView?> event(String id) => _firestore
      .doc('events/$id')
      .snapshots()
      .map((s) => s.exists ? PublishedEventView.fromDoc(s) : null);
  Stream<List<PublishedEventView>> managedEvents(
    String uid, {
    bool admin = false,
  }) {
    Query<Map<String, dynamic>> query = _firestore.collection('events');
    if (!admin) query = query.where('organizerId', isEqualTo: uid);
    return query
        .limit(100)
        .snapshots()
        .map(
          (s) =>
              s.docs.map(PublishedEventView.fromDoc).toList()
                ..sort((a, b) => a.name.compareTo(b.name)),
        );
  }

  Stream<List<MapRouteView>> routes(String eventId) => _firestore
      .collection('routes')
      .where('eventId', isEqualTo: eventId)
      .limit(100)
      .snapshots()
      .map((s) => s.docs.map(MapRouteView.fromDoc).toList());
  Stream<Map<String, dynamic>?> profile(String uid) =>
      _firestore.doc('users/$uid').snapshots().map((s) => s.data());
  Stream<MapRouteView?> route(String routeId) => _firestore
      .collection('routes')
      .doc(routeId)
      .snapshots()
      .map((s) => s.exists ? MapRouteView.fromDoc(s) : null);
  Stream<List<MapStopView>> stops(String routeId) => _firestore
      .collection('stopPoints')
      .where('routeId', isEqualTo: routeId)
      .snapshots()
      .map(
        (s) =>
            s.docs.map(MapStopView.fromDoc).toList()
              ..sort((a, b) => a.order.compareTo(b.order)),
      );
  Stream<List<MapGroupView>> groups(String eventId) => _auth.currentUser == null
      ? Stream.value([])
      : _firestore
            .collection('groups')
            .where('eventId', isEqualTo: eventId)
            .snapshots()
            .map((s) => s.docs.map(MapGroupView.fromDoc).toList());
  Stream<MapGroupView?> group(String groupId) => _firestore
      .collection('groups')
      .doc(groupId)
      .snapshots()
      .map((s) => s.exists ? MapGroupView.fromDoc(s) : null);
  Stream<GroupProgressView?> progress(String groupId) => _firestore
      .collection('groupProgress')
      .doc(groupId)
      .snapshots()
      .map((s) => s.exists ? GroupProgressView.fromDoc(s) : null);
  Stream<List<MapAnnouncementView>> announcements(String eventId) => _firestore
      .collection('publicAnnouncements')
      .where('eventId', isEqualTo: eventId)
      .where('isActive', isEqualTo: true)
      .snapshots()
      .map(
        (s) => s.docs.map(MapAnnouncementView.fromDoc).toList()
          ..sort(
            (a, b) => (b.updatedAt ?? DateTime(0)).compareTo(
              a.updatedAt ?? DateTime(0),
            ),
          ),
      );

  Stream<Map<String, LiveGroupPosition>> live(String eventId) {
    if (!isSignedIn) return Stream.value(const {});
    return _watchChildren<LiveGroupPosition>(
      _liveDriver.children('liveLocations/$eventId'),
      (data) {
        final position = LiveGroupPosition.fromData(data);
        return position.valid ? position : null;
      },
      (a, b) =>
          (
            a.userId,
            a.latitude,
            a.longitude,
            a.headingDegrees,
            a.speedMetersPerSecond,
            a.accuracyMeters,
            a.recordedAt,
          ) ==
          (
            b.userId,
            b.latitude,
            b.longitude,
            b.headingDegrees,
            b.speedMetersPerSecond,
            b.accuracyMeters,
            b.recordedAt,
          ),
    );
  }

  Stream<Map<String, TrackingPresence>> trackingStates(String eventId) =>
      !isSignedIn
      ? Stream.value(const {})
      : _watchChildren<TrackingPresence>(
          _liveDriver.children('trackingStatus/$eventId'),
          TrackingPresence.fromData,
          (a, b) => a.state == b.state && a.updatedAt == b.updatedAt,
        );

  Stream<String> assignedGroupId(String uid) =>
      _firestore.collection('users').doc(uid).snapshots().map((s) {
        final d = s.data() ?? {};
        if (d['isActive'] != true) return '';
        return d['role'] == 'teamLeader'
            ? '${d['assignedGroupId'] ?? ''}'
            : '${d['joinedGroupId'] ?? ''}';
      });
}

/// A child addition, replacement, or deletion (null value) from a live feed.
class LiveMapChildChange {
  final String id;
  final Object? value;
  const LiveMapChildChange(this.id, this.value);
}

/// Keeps Firebase transport separate from the incremental viewer cache.
abstract interface class LiveMapDriver {
  bool get isSignedIn;
  Stream<LiveMapChildChange> children(String path);
}

class _FirebaseLiveMapDriver implements LiveMapDriver {
  final FirebaseAuth? _auth;
  final FirebaseDatabase? _database;
  _FirebaseLiveMapDriver(this._auth, this._database);

  @override
  bool get isSignedIn => (_auth ?? FirebaseAuth.instance).currentUser != null;

  @override
  Stream<LiveMapChildChange> children(String path) {
    late StreamController<LiveMapChildChange> controller;
    final subscriptions = <StreamSubscription<DatabaseEvent>>[];
    void add(DatabaseEvent event, {bool removed = false}) {
      final key = event.snapshot.key;
      if (key == null || controller.isClosed) return;
      controller.add(
        LiveMapChildChange(key, removed ? null : event.snapshot.value),
      );
    }

    controller = StreamController<LiveMapChildChange>(
      onListen: () {
        final ref = (_database ?? FirebaseDatabase.instance).ref(path);
        // Child-added supplies the initial data and subsequent additions. No
        // persistent onValue listener downloads/reparses the whole event.
        void listen(Stream<DatabaseEvent> stream, {bool removed = false}) {
          subscriptions.add(
            stream.listen(
              (event) => add(event, removed: removed),
              onError: (Object error, StackTrace stack) {
                if (controller.isClosed) return;
                controller.addError(error, stack);
                unawaited(controller.close());
              },
            ),
          );
        }

        listen(ref.onChildAdded);
        listen(ref.onChildChanged);
        listen(ref.onChildRemoved, removed: true);
      },
      onPause: () {
        for (final subscription in subscriptions) {
          subscription.pause();
        }
      },
      onResume: () {
        for (final subscription in subscriptions) {
          subscription.resume();
        }
      },
      onCancel: () async {
        await Future.wait(
          subscriptions.map((subscription) => subscription.cancel()),
        );
      },
    );
    return controller.stream;
  }
}

Stream<Map<String, T>> _watchChildren<T>(
  Stream<LiveMapChildChange> changes,
  T? Function(Map<String, dynamic>) parse,
  bool Function(T, T) same,
) {
  late StreamController<Map<String, T>> controller;
  StreamSubscription<LiveMapChildChange>? subscription;
  Future<void>? cancellation;
  final cache = <String, T>{};
  var scheduled = false, terminated = false;

  Future<void> cancelUpstream() async {
    final upstream = subscription;
    if (upstream != null) await (cancellation ??= upstream.cancel());
  }

  void emit() {
    if (!scheduled || terminated || controller.isClosed) return;
    scheduled = false;
    controller.add(Map<String, T>.unmodifiable(cache));
  }

  Future<void> closeAfterError() async {
    try {
      await cancelUpstream();
    } catch (_) {
      // Preserve the original transport error even if upstream cleanup fails.
    } finally {
      await controller.close();
    }
  }

  void fail(Object error, StackTrace stack) {
    if (terminated || controller.isClosed) return;
    // Fence synchronously, before cancellation can yield or invoke onDone.
    // Already queued microtasks and late transport callbacks must not publish.
    terminated = true;
    scheduled = false;
    cache.clear();
    // Clear previously displayed private data before delivering the error.
    controller.add(Map<String, T>.unmodifiable(cache));
    controller.addError(error, stack);
    unawaited(closeAfterError());
  }

  controller = StreamController<Map<String, T>>(
    onListen: () {
      // Empty events must settle too: child streams have no initial empty event.
      controller.add(Map<String, T>.unmodifiable(cache));
      subscription = changes.listen(
        (change) {
          if (terminated) return;
          final raw = change.value;
          final value = raw is Map
              ? parse(raw.map((key, value) => MapEntry('$key', value)))
              : null;
          final previous = cache[change.id];
          if (value == null) {
            if (!cache.containsKey(change.id)) return;
            cache.remove(change.id);
          } else {
            if (previous != null && same(previous, value)) return;
            cache[change.id] = value;
          }
          // Coalesce an initial batch of child-added events into one snapshot.
          if (!scheduled) {
            scheduled = true;
            scheduleMicrotask(emit);
          }
        },
        onError: fail,
        onDone: () {
          if (terminated) return;
          if (scheduled) emit();
          terminated = true;
          cache.clear();
          unawaited(controller.close());
        },
      );
      // Also handle a transport that invokes callbacks during listen itself.
      if (terminated) unawaited(cancelUpstream());
    },
    onPause: () => subscription?.pause(),
    onResume: () => subscription?.resume(),
    onCancel: () async {
      terminated = true;
      scheduled = false;
      cache.clear();
      await cancelUpstream();
    },
  );
  return controller.stream;
}

/// The heartbeat has the same updatedAt schema as existing trackingStatus records.
class TrackingPresence {
  final String state;
  final DateTime? updatedAt;
  const TrackingPresence(this.state, this.updatedAt);
  factory TrackingPresence.fromData(Map<String, dynamic> data) =>
      TrackingPresence(
        '${data['state'] ?? 'stopped'}',
        mapDate(data['updatedAt']),
      );
  String effectiveState(DateTime now) {
    if (['stopped', 'paused', 'error'].contains(state)) return state;
    if (updatedAt == null ||
        now.difference(updatedAt!) > const Duration(seconds: 45) ||
        updatedAt!.difference(now) > const Duration(seconds: 5)) {
      return 'disconnected';
    }
    return state;
  }
}
