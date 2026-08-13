import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/location_history_record.dart';

class LocationHistoryRepository {
  static const String collectionName = 'locationHistory';

  final FirebaseFirestore _firestore;

  LocationHistoryRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(LocationHistoryRecord historyRecord) async {
    await _collection.doc(historyRecord.id).set(historyRecord.toFirestore());
  }

  Future<LocationHistoryRecord?> read(String historyRecordId) async {
    final document = await _collection.doc(historyRecordId).get();

    if (!document.exists) {
      return null;
    }

    return LocationHistoryRecord.fromFirestore(document);
  }

  Future<void> update(LocationHistoryRecord historyRecord) async {
    await _collection
        .doc(historyRecord.id)
        .update(historyRecord.toFirestore());
  }

  Future<void> delete(String historyRecordId) async {
    await _collection.doc(historyRecordId).delete();
  }

  Stream<LocationHistoryRecord?> streamById(String historyRecordId) {
    return _collection.doc(historyRecordId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return LocationHistoryRecord.fromFirestore(document);
    });
  }

  Stream<List<LocationHistoryRecord>> streamByGroupId(String groupId) {
    return _collection
        .where('groupId', isEqualTo: groupId)
        .orderBy('recordedAt')
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(LocationHistoryRecord.fromFirestore).toList();
    });
  }

  Stream<List<LocationHistoryRecord>> streamByEventId(String eventId) {
    return _collection
        .where('eventId', isEqualTo: eventId)
        .orderBy('recordedAt')
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(LocationHistoryRecord.fromFirestore).toList();
    });
  }
}