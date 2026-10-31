
import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import '../models/location_update.dart';
import 'tracking_authorization_service.dart';

class TrackingService extends ChangeNotifier {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseDatabase _database = FirebaseDatabase.instance;
  final TrackingAuthorizationService _authorization = TrackingAuthorizationService();
  StreamSubscription<Position>? _positionSubscription;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _eventSubscription;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _groupSubscription;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _userSubscription;
  Timer? _timer;
  bool _busy = false;
  int _consecutiveFailures = 0;
  bool _closed = false;
  String _eventId = '';
  String _groupId = '';
  String _uid = '';
  DateTime? _verifiedAt;
  DateTime? _lastFirestoreUpdateAt;
  DateTime? lastSentAt;
  Position? position;
  String state = 'inactive';
  String? error;
  String? warning;
  String eventName = '';
  String groupName = '';
  String groupStatus = '';

  void _notify() { if (!_closed) notifyListeners(); }

  Future<void> loadAssignment() async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) { error = 'Sign in first.'; _notify(); return; }
    final user = await _firestore.doc('users/$uid').get(const GetOptions(source: Source.server));
    final groupId = (user.data()?['assignedGroupId'] ?? '').toString();
    if (groupId.isEmpty) { error = 'No group assigned.'; _notify(); return; }
    final group = await _firestore.doc('groups/$groupId').get(const GetOptions(source: Source.server));
    if (!group.exists) { error = 'Assigned group not found.'; _notify(); return; }
    final event = await _firestore.doc('events/${group.data()?['eventId']}').get(const GetOptions(source: Source.server));
    _groupId = groupId;
    _eventId = (group.data()?['eventId'] ?? '').toString();
    _uid = uid;
    groupName = (group.data()?['name'] ?? '').toString();
    eventName = (event.data()?['name'] ?? '').toString();
    groupStatus = (group.data()?['status'] ?? '').toString();
    warning = group.data()?['backupLeaderUserId'] == uid ? 'Backup leader: wait for admin promotion to primary.' : null;
    error = null;
    _notify();
  }

  Future<void> _verifyPrimary() async {
    if (_uid != _auth.currentUser?.uid) throw StateError('Signed-in user changed during tracking.');
    await _authorization.verifyPrimary(groupId: _groupId, eventId: _eventId);
    _verifiedAt = DateTime.now();
  }

  Future<void> start() async {
    if (state == 'active') return;
    error = null; warning = null; _notify();
    try {
      await loadAssignment();
      await _verifyPrimary();
      final permission = await Geolocator.checkPermission();
      if (!await Geolocator.isLocationServiceEnabled() ||
          (permission != LocationPermission.whileInUse && permission != LocationPermission.always)) {
        throw StateError('Grant foreground GPS permission before tracking.');
      }
      position = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high));
      state = 'active';
      _watchAccess();
      _subscribePosition();
      _timer = Timer.periodic(const Duration(seconds: 5), (_) => unawaited(_tick()));
      await _publishStatus('active');
      await _tick();
      _notify();
    } catch (reason) {
      state = 'error'; error = reason.toString(); _notify();
      await _cancelLocal();
    }
  }

  void _subscribePosition() {
    _positionSubscription = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 0))
        .listen((value) { position = value; warning = null; _notify(); }, onError: (Object reason) { warning = 'GPS unavailable: $reason'; _notify(); });
  }

  void _watchAccess() {
    _groupSubscription = _firestore.doc('groups/$_groupId').snapshots().listen((snapshot) {
      if (snapshot.data()?['leaderUserId'] != _uid) unawaited(stop(reason: 'Primary assignment was changed.'));
      groupStatus = (snapshot.data()?['status'] ?? groupStatus).toString(); _notify();
    });
    _eventSubscription = _firestore.doc('events/$_eventId').snapshots().listen((snapshot) {
      if (snapshot.data()?['status'] != 'active') unawaited(stop(reason: 'Event is no longer active.'));
    });
    _userSubscription = _firestore.doc('users/$_uid').snapshots().listen((snapshot) {
      final data = snapshot.data();
      if (data?['isActive'] != true || data?['role'] != 'teamLeader' || data?['assignedGroupId'] != _groupId) {
        unawaited(stop(reason: 'Your leader permission changed.'));
      }
    });
  }

  Future<void> _tick() async {
    if (state != 'active' || _busy) return;
    final sample = position;
    if (sample == null || DateTime.now().difference(sample.timestamp) > const Duration(seconds: 30)) {
      warning = 'GPS location is stale (>30 seconds); no position was sent.'; _notify(); return;
    }
    final moving = sample.speed.isFinite && sample.speed >= 0.8;
    final interval = moving ? const Duration(seconds: 5) : const Duration(seconds: 60);
    if (lastSentAt != null && DateTime.now().difference(lastSentAt!) < interval) return;
    _busy = true;
    try {
      if (_verifiedAt == null || DateTime.now().difference(_verifiedAt!) >= const Duration(seconds: 60)) await _verifyPrimary();
      final item = LocationUpdate(id: '', eventId: _eventId, groupId: _groupId, userId: _uid,
        latitude: sample.latitude, longitude: sample.longitude, accuracyMeters: sample.accuracy,
        speedMetersPerSecond: sample.speed.isFinite && sample.speed > 0 ? sample.speed : 0,
        headingDegrees: sample.heading.isFinite && sample.heading >= 0 ? sample.heading : 0, recordedAt: DateTime.now());
      await _database.ref('liveLocations/$_eventId/$_groupId').set(item.toRealtimeDatabase(ServerValue.timestamp));
      lastSentAt = DateTime.now(); _consecutiveFailures = 0; warning = null; _notify();
      if (_lastFirestoreUpdateAt == null || DateTime.now().difference(_lastFirestoreUpdateAt!) >= const Duration(seconds: 55)) {
        await _firestore.doc('groups/$_groupId').update({'lastLocationUpdateAt': FieldValue.serverTimestamp()});
        _lastFirestoreUpdateAt = DateTime.now();
      }
    } catch (reason) {
      _consecutiveFailures++;
      final fatal = reason is StateError || (reason is FirebaseException && reason.code == 'permission-denied');
      if (fatal || _consecutiveFailures >= 3) {
        state = 'error'; error = 'Upload stopped after $_consecutiveFailures failure(s): $reason'; _notify(); await _cancelLocal();
      } else { warning = 'Temporary upload error ($_consecutiveFailures/3); retrying in 5 seconds: $reason'; _notify(); }
    } finally { _busy = false; }
  }

  Future<void> _publishStatus(String next) async {
    await _database.ref('trackingStatus/$_eventId/$_groupId').set({'userId': _uid, 'state': next, 'updatedAt': ServerValue.timestamp});
  }

  Future<void> pause() async {
    if (state != 'active') return;
    state = 'paused'; _notify();
    await _positionSubscription?.cancel(); _positionSubscription = null;
    try { await _publishStatus('paused'); } catch (reason) { warning = 'Could not publish pause: $reason'; _notify(); }
  }

  Future<void> resume() async {
    if (state != 'paused') return;
    try {
      await _verifyPrimary();
      position = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high));
      _subscribePosition(); state = 'active'; lastSentAt = null;
      await _publishStatus('active'); await _tick(); _notify();
    } catch (reason) { state = 'error'; error = reason.toString(); _notify(); await _cancelLocal(); }
  }

  Future<void> updateGroupStatus(String next) async {
    if (state != 'active') throw StateError('Start tracking before changing group status.');
    if (!['waiting', 'moving', 'stopped', 'delayed', 'emergency'].contains(next)) throw ArgumentError('Invalid group status.');
    await _verifyPrimary();
    await _firestore.doc('groups/$_groupId').update({'status': next, 'lastLocationUpdateAt': FieldValue.serverTimestamp()});
    groupStatus = next; _notify();
  }

  Future<void> _cancelLocal() async {
    _timer?.cancel(); _timer = null;
    await _positionSubscription?.cancel(); _positionSubscription = null;
    await _eventSubscription?.cancel(); _eventSubscription = null;
    await _groupSubscription?.cancel(); _groupSubscription = null;
    await _userSubscription?.cancel(); _userSubscription = null;
  }

  Future<void> stop({String? reason}) async {
    if (state == 'inactive' && _timer == null) return;
    state = 'inactive'; if (reason != null) warning = reason; _notify();
    await _cancelLocal();
    if (_groupId.isNotEmpty) {
      try { await _publishStatus('stopped'); } catch (_) { /* Server rules may reject this write after event completion. */ }
    }
  }

  @override
  void dispose() { _closed = true; _timer?.cancel(); unawaited(_cancelLocal()); super.dispose(); }
}
