import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/location_update.dart';

class LocationRepository {
  static const String collectionName = 'locationUpdates';

  final FirebaseFirestore _firestore;

  LocationRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(LocationUpdate locationUpdate) async {
    await _collection.doc(locationUpdate.id).set(locationUpdate.toFirestore());
  }

  Future<LocationUpdate?> read(String locationUpdateId) async {
    final document = await _collection.doc(locationUpdateId).get();

    if (!document.exists) {
      return null;
    }

    return LocationUpdate.fromFirestore(document);
  }

  Future<void> update(LocationUpdate locationUpdate) async {
    await _collection
        .doc(locationUpdate.id)
        .update(locationUpdate.toFirestore());
  }

  Future<void> delete(String locationUpdateId) async {
    await _collection.doc(locationUpdateId).delete();
  }

  Stream<LocationUpdate?> streamById(String locationUpdateId) {
    return _collection.doc(locationUpdateId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return LocationUpdate.fromFirestore(document);
    });
  }

  Stream<List<LocationUpdate>> streamByGroupId(String groupId) {
    return _collection
        .where('groupId', isEqualTo: groupId)
        .orderBy('recordedAt', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(LocationUpdate.fromFirestore).toList();
    });
  }

  Stream<List<LocationUpdate>> streamByEventId(String eventId) {
    return _collection
        .where('eventId', isEqualTo: eventId)
        .orderBy('recordedAt', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(LocationUpdate.fromFirestore).toList();
    });
  }
}