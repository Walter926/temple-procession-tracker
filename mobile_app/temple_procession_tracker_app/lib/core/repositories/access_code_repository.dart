import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/access_code.dart';

class AccessCodeRepository {
  static const String collectionName = 'accessCodes';

  final FirebaseFirestore _firestore;

  AccessCodeRepository({FirebaseFirestore? firestore})
    : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<AccessCode?> read(String accessCodeId) async {
    final document = await _collection.doc(accessCodeId).get();

    if (!document.exists) {
      return null;
    }

    return AccessCode.fromFirestore(document);
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
        .limit(100)
        .snapshots()
        .map((snapshot) {
          return snapshot.docs.map(AccessCode.fromFirestore).toList();
        });
  }

  Stream<List<AccessCode>> streamByGroupId(String groupId) => _collection
      .where('groupId', isEqualTo: groupId)
      .limit(100)
      .snapshots()
      .map((snapshot) => snapshot.docs.map(AccessCode.fromFirestore).toList());
}
