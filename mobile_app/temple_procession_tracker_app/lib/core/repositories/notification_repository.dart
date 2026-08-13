import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/notification_message.dart';

class NotificationRepository {
  static const String collectionName = 'notifications';

  final FirebaseFirestore _firestore;

  NotificationRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(NotificationMessage notification) async {
    await _collection.doc(notification.id).set(notification.toFirestore());
  }

  Future<NotificationMessage?> read(String notificationId) async {
    final document = await _collection.doc(notificationId).get();

    if (!document.exists) {
      return null;
    }

    return NotificationMessage.fromFirestore(document);
  }

  Future<void> update(NotificationMessage notification) async {
    await _collection.doc(notification.id).update(notification.toFirestore());
  }

  Future<void> delete(String notificationId) async {
    await _collection.doc(notificationId).delete();
  }

  Stream<NotificationMessage?> streamById(String notificationId) {
    return _collection.doc(notificationId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return NotificationMessage.fromFirestore(document);
    });
  }

  Stream<List<NotificationMessage>> streamByEventId(String eventId) {
    return _collection
        .where('eventId', isEqualTo: eventId)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(NotificationMessage.fromFirestore).toList();
    });
  }

  Stream<List<NotificationMessage>> streamByTargetUserId(String userId) {
    return _collection
        .where('targetUserIds', arrayContains: userId)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(NotificationMessage.fromFirestore).toList();
    });
  }
}