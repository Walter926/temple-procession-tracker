import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/collision_alert.dart';

class AlertRepository {
  static const String collectionName = 'collisionAlerts';

  final FirebaseFirestore _firestore;

  AlertRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(CollisionAlert alert) async {
    await _collection.doc(alert.id).set(alert.toFirestore());
  }

  Future<CollisionAlert?> read(String alertId) async {
    final document = await _collection.doc(alertId).get();

    if (!document.exists) {
      return null;
    }

    return CollisionAlert.fromFirestore(document);
  }

  Future<void> update(CollisionAlert alert) async {
    await _collection.doc(alert.id).update(alert.toFirestore());
  }

  Future<void> delete(String alertId) async {
    await _collection.doc(alertId).delete();
  }

  Stream<CollisionAlert?> streamById(String alertId) {
    return _collection.doc(alertId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return CollisionAlert.fromFirestore(document);
    });
  }

  Stream<List<CollisionAlert>> streamByEventId(String eventId) {
    return _collection
        .where('eventId', isEqualTo: eventId)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(CollisionAlert.fromFirestore).toList();
    });
  }
}
