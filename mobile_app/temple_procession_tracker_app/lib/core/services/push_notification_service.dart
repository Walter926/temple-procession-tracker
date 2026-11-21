import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import '../models/user_profile.dart';

class PushMessage {
  final String notificationId, eventId, title, body;
  const PushMessage({
    required this.notificationId,
    required this.eventId,
    required this.title,
    required this.body,
  });
  factory PushMessage.fromRemote(RemoteMessage message) => PushMessage(
    notificationId: '${message.data['notificationId'] ?? ''}',
    eventId: '${message.data['eventId'] ?? ''}',
    title:
        message.notification?.title ??
        '${message.data['title'] ?? 'Procession update'}',
    body: message.notification?.body ?? '${message.data['body'] ?? ''}',
  );
}

abstract class PushDriver {
  String? get currentUid;
  Future<bool> requestPermission();
  Future<String?> token();
  Future<void> deleteToken();
  Stream<String> get tokenRefresh;
  Stream<PushMessage> get foreground;
  Stream<PushMessage> get taps;
  Future<PushMessage?> initialMessage();
  Future<bool> ownsNotification(String id, String uid);
  Future<void> call(String name, Map<String, dynamic> data);
}

class FirebasePushDriver implements PushDriver {
  final FirebaseMessaging messaging;
  final FirebaseAuth auth;
  final FirebaseFunctions functions;
  FirebasePushDriver({
    FirebaseMessaging? messaging,
    FirebaseAuth? auth,
    FirebaseFunctions? functions,
  }) : messaging = messaging ?? FirebaseMessaging.instance,
       auth = auth ?? FirebaseAuth.instance,
       functions =
           functions ?? FirebaseFunctions.instanceFor(region: 'us-central1');
  @override
  String? get currentUid => auth.currentUser?.uid;
  @override
  Future<bool> requestPermission() async {
    final settings = await messaging.requestPermission();
    // Foreground UI is owned by the app's foregroundMessages subscriber.
    await messaging.setForegroundNotificationPresentationOptions(
      alert: false,
      badge: true,
      sound: true,
    );
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  @override
  Future<String?> token() => messaging.getToken();
  @override
  Future<void> deleteToken() => messaging.deleteToken();
  @override
  Stream<String> get tokenRefresh => messaging.onTokenRefresh;
  @override
  Stream<PushMessage> get foreground =>
      FirebaseMessaging.onMessage.map(PushMessage.fromRemote);
  @override
  Stream<PushMessage> get taps =>
      FirebaseMessaging.onMessageOpenedApp.map(PushMessage.fromRemote);
  @override
  Future<PushMessage?> initialMessage() async {
    final m = await messaging.getInitialMessage();
    return m == null ? null : PushMessage.fromRemote(m);
  }

  @override
  Future<bool> ownsNotification(String id, String uid) async {
    if (id.isEmpty || id.contains('/')) return false;
    final record = await FirebaseFirestore.instance
        .doc('notifications/$id')
        .get(const GetOptions(source: Source.server));
    return record.data()?['uid'] == uid;
  }

  @override
  Future<void> call(String name, Map<String, dynamic> data) async {
    await functions.httpsCallable(name).call(data);
  }
}

/// Attach to the authenticated app lifecycle, not the Notifications screen.
/// Subscribe to both streams before attachProfile, including cold-start taps.
class PushNotificationService extends ChangeNotifier {
  final PushDriver _driver;
  PushNotificationService({PushDriver? driver})
    : _driver = driver ?? FirebasePushDriver();
  final _foreground = StreamController<PushMessage>.broadcast();
  final _taps = StreamController<PushMessage>.broadcast();
  Stream<PushMessage> get foregroundMessages => _foreground.stream;
  Stream<PushMessage> get notificationTaps => _taps.stream;
  StreamSubscription<String>? _refresh;
  StreamSubscription<PushMessage>? _message, _tap;
  Future<void> _operations = Future.value();
  Timer? _retry;
  String? _uid, _token, _deviceId;
  final Set<String> _seenForeground = {}, _seenTaps = {};
  int _revision = 0, _attempts = 0;
  bool _disposed = false, _initialChecked = false, _registered = false;
  String? lastError;
  bool get registered =>
      _uid != null && _token != null && _registered && lastError == null;
  Future<void> _serial(Future<void> Function() action) {
    final future = _operations.then((_) async {
      if (!_disposed) await action();
    });
    _operations = future.catchError((Object _) {});
    return future;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  bool _current(int revision, String uid) =>
      !_disposed &&
      revision == _revision &&
      _uid == uid &&
      _driver.currentUid == uid;
  Future<void> attachProfile(UserProfile? profile) {
    if (profile == null || !profile.isActive) return detach();
    if (_uid == profile.id && _refresh != null && lastError == null) {
      return Future.value();
    }
    final revision = ++_revision;
    return _serial(() async {
      if (revision != _revision) return;
      if (_uid != profile.id) await _cleanup();
      _uid = profile.id;
      lastError = null;
      if (_driver.currentUid != profile.id) return;
      _refresh ??= _driver.tokenRefresh.listen((value) {
        final uid = _uid, generation = _revision;
        if (uid != null) {
          unawaited(_serial(() => _register(value, uid, generation)));
        }
      }, onError: (Object e) => _failed(e));
      _message ??= _driver.foreground.listen(
        (m) => unawaited(_forward(m, tapped: false)),
      );
      _tap ??= _driver.taps.listen((m) => unawaited(_forward(m, tapped: true)));
      try {
        if (!await _driver.requestPermission()) {
          lastError =
              'Push permission is off. In-app notifications remain available.';
          _notify();
          return;
        }
        if (!_current(revision, profile.id)) return;
        final value = await _driver.token();
        if (value != null) await _register(value, profile.id, revision);
        if (!_initialChecked && _current(revision, profile.id)) {
          _initialChecked = true;
          final message = await _driver.initialMessage();
          if (message != null && _current(revision, profile.id)) {
            await _forward(message, tapped: true);
          }
        }
      } catch (e) {
        if (_current(revision, profile.id)) _failed(e);
      }
    });
  }

  Future<void> _forward(PushMessage message, {required bool tapped}) async {
    final uid = _uid, revision = _revision;
    if (uid == null ||
        !_current(revision, uid) ||
        message.notificationId.isEmpty) {
      return;
    }
    final seen = tapped ? _seenTaps : _seenForeground;
    if (seen.contains(message.notificationId)) return;
    try {
      // A delayed push from the previous account must not expose its title/body.
      if (!await _driver.ownsNotification(message.notificationId, uid) ||
          !_current(revision, uid)) {
        return;
      }
      if (!seen.add(message.notificationId)) return;
      if (seen.length > 200) seen.remove(seen.first);
      if (tapped) {
        _taps.add(message);
      } else {
        _foreground.add(message);
      }
    } catch (_) {
      /* The authenticated inbox remains the source of truth offline. */
    }
  }

  // Stable for a token across app launches; refresh retains the device identity.
  static String deviceIdForToken(String value) {
    var hash = BigInt.parse('14695981039346656037');
    final mask = (BigInt.one << 64) - BigInt.one;
    for (final unit in value.codeUnits) {
      hash = ((hash ^ BigInt.from(unit)) * BigInt.from(1099511628211)) & mask;
    }
    return 'push_${hash.toRadixString(16)}';
  }

  Future<void> _register(String token, String uid, int revision) async {
    if (!_current(revision, uid)) return;
    try {
      final previous = _token;
      // Remember an in-flight registration too, so detach can invalidate it.
      _token = token;
      _registered = false;
      _deviceId ??= deviceIdForToken(token);
      final platform = kIsWeb
          ? 'web'
          : defaultTargetPlatform == TargetPlatform.iOS
          ? 'ios'
          : 'android';
      await _driver.call('registerDeviceToken', {
        'token': token,
        'deviceId': _deviceId,
        'platform': platform,
      });
      if (!_current(revision, uid)) return;
      if (previous != null && previous != token) {
        await _driver.call('unregisterDeviceToken', {'token': previous});
      }
      if (!_current(revision, uid)) return;
      _attempts = 0;
      _retry?.cancel();
      _registered = true;
      lastError = null;
      _notify();
    } catch (e) {
      if (_current(revision, uid)) _failed(e);
    }
  }

  void _failed(Object error) {
    if (_disposed) return;
    lastError = 'Push registration unavailable: $error';
    _notify();
    _retry?.cancel();
    if (_uid == null || _attempts >= 5) return;
    final seconds = 2 << _attempts++;
    _retry = Timer(Duration(seconds: seconds), () {
      final uid = _uid, revision = _revision;
      if (uid == null) return;
      unawaited(
        _serial(() async {
          try {
            final token = await _driver.token();
            if (token != null) await _register(token, uid, revision);
          } catch (e) {
            if (_current(revision, uid)) _failed(e);
          }
        }),
      );
    });
  }

  Future<void> _cleanup() async {
    _retry?.cancel();
    await _refresh?.cancel();
    _refresh = null;
    await _message?.cancel();
    _message = null;
    await _tap?.cancel();
    _tap = null;
    final token = _token, uid = _uid;
    _token = _uid = _deviceId = null;
    _attempts = 0;
    _registered = false;
    _seenForeground.clear();
    _seenTaps.clear();
    if (token != null) {
      try {
        if (_driver.currentUid == uid) {
          await _driver.call('unregisterDeviceToken', {'token': token});
        }
      } catch (e) {
        lastError = 'Could not unregister push token: $e';
      }
      // Invalidate on this device even if logout already changed callable auth.
      try {
        await _driver.deleteToken();
      } catch (e) {
        lastError = 'Could not invalidate push token: $e';
      }
    }
    _notify();
  }

  Future<void> detach() {
    ++_revision;
    return _serial(_cleanup);
  }

  Future<void> markRead(String notificationId) =>
      _driver.call('markNotificationRead', {'notificationId': notificationId});
  Future<void> acknowledgeWarning(String warningId) =>
      _driver.call('acknowledgeCollisionWarning', {'warningId': warningId});
  Future<void> acknowledgeRouteInstruction(String instructionId) => _driver
      .call('acknowledgeRouteInstruction', {'instructionId': instructionId});

  /// Server-owned records, available regardless of push permission or delivery.
  Stream<QuerySnapshot<Map<String, dynamic>>> notifications(
    String uid, {
    int limit = 50,
  }) => FirebaseFirestore.instance
      .collection('notifications')
      .where('uid', isEqualTo: uid)
      .orderBy('createdAt', descending: true)
      .limit(limit.clamp(1, 1000))
      .snapshots();
  @override
  void dispose() {
    ++_revision;
    _disposed = true;
    _retry?.cancel();
    unawaited(_refresh?.cancel());
    unawaited(_message?.cancel());
    unawaited(_tap?.cancel());
    unawaited(_foreground.close());
    unawaited(_taps.close());
    super.dispose();
  }
}
