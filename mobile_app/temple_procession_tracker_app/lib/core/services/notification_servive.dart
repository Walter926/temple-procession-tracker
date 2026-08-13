import 'package:firebase_messaging/firebase_messaging.dart';

import '../enums/alert_severity.dart';
import '../models/notification_message.dart';
import '../repositories/notification_repository.dart';

class NotificationService {
  final FirebaseMessaging _messaging;
  final NotificationRepository _notificationRepository;

  NotificationService({
    FirebaseMessaging? messaging,
    NotificationRepository? notificationRepository,
  })  : _messaging = messaging ?? FirebaseMessaging.instance,
        _notificationRepository =
            notificationRepository ?? NotificationRepository();

  Future<NotificationSettings> requestPushPermission() async {
    return _messaging.requestPermission();
  }

  Future<String?> getDeviceToken() async {
    return _messaging.getToken();
  }

  Future<void> saveNotification(NotificationMessage notification) async {
    await _notificationRepository.create(notification);
  }

  NotificationMessage buildNotification({
    required String eventId,
    required String title,
    required String body,
    AlertSeverity severity = AlertSeverity.info,
    List<String> targetUserIds = const [],
    List<String> targetGroupIds = const [],
  }) {
    final now = DateTime.now();

    return NotificationMessage(
      id: '${eventId}_${now.millisecondsSinceEpoch}',
      eventId: eventId,
      title: title,
      body: body,
      severity: severity,
      targetUserIds: targetUserIds,
      targetGroupIds: targetGroupIds,
      createdAt: now,
      readByUserIds: const [],
    );
  }

  Future<void> markAsRead({
    required NotificationMessage notification,
    required String userId,
  }) async {
    final readByUserIds = {...notification.readByUserIds, userId}.toList();

    final updatedNotification = NotificationMessage(
      id: notification.id,
      eventId: notification.eventId,
      title: notification.title,
      body: notification.body,
      severity: notification.severity,
      targetUserIds: notification.targetUserIds,
      targetGroupIds: notification.targetGroupIds,
      createdAt: notification.createdAt,
      readByUserIds: readByUserIds,
    );

    await _notificationRepository.update(updatedNotification);
  }

  Stream<List<NotificationMessage>> watchNotificationsForEvent(String eventId) {
    return _notificationRepository.streamByEventId(eventId);
  }

  Stream<List<NotificationMessage>> watchNotificationsForUser(String userId) {
    return _notificationRepository.streamByTargetUserId(userId);
  }
}