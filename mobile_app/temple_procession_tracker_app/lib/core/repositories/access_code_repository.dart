import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/access_code.dart';

class AccessCodeRepository {
  static const String collectionName = 'accessCodes';

  final FirebaseFirestore _firestore;

  AccessCodeRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(AccessCode accessCode) async {
    await _collection.doc(accessCode.id).set(accessCode.toFirestore());
  }

  Future<AccessCode?> read(String accessCodeId) async {
    final document = await _collection.doc(accessCodeId).get();

    if (!document.exists) {
      return null;
    }

    return AccessCode.fromFirestore(document);
  }

  Future<AccessCode?> readByCode(String code) async {
    final snapshot = await _collection
        .where('code', isEqualTo: code)
        .where('isActive', isEqualTo: true)
        .limit(1)
        .get();

    if (snapshot.docs.isEmpty) {
      return null;
    }

    return AccessCode.fromFirestore(snapshot.docs.first);
  }

  Future<void> update(AccessCode accessCode) async {
    await _collection.doc(accessCode.id).update(accessCode.toFirestore());
  }

  Future<void> delete(String accessCodeId) async {
    await _collection.doc(accessCodeId).delete();
  }

  Stream<AccessCode?> streamById(String accessCodeId) {
    return _collection.doc(accessCodeId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return AccessCode.fromFirestore(document);
    });
  }

  Stream<List<AccessCode>> streamByEventId(String eventId) {
    return _collection
        .where('eventId', isEqualTo: eventId)
        .orderBy('createdAt')
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(AccessCode.fromFirestore).toList();
    });
  }
}