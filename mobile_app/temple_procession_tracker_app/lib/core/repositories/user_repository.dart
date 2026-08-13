import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/user_profile.dart';

class UserRepository {
  static const String collectionName = 'users';

  final FirebaseFirestore _firestore;

  UserRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(UserProfile userProfile) async {
    await _collection.doc(userProfile.id).set(userProfile.toFirestore());
  }

  Future<UserProfile?> read(String userId) async {
    final document = await _collection.doc(userId).get();

    if (!document.exists) {
      return null;
    }

    return UserProfile.fromFirestore(document);
  }

  Future<void> update(UserProfile userProfile) async {
    await _collection.doc(userProfile.id).update(userProfile.toFirestore());
  }

  Future<void> delete(String userId) async {
    await _collection.doc(userId).delete();
  }

  Stream<UserProfile?> streamById(String userId) {
    return _collection.doc(userId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return UserProfile.fromFirestore(document);
    });
  }

  Stream<List<UserProfile>> streamAll() {
    return _collection.snapshots().map((snapshot) {
      return snapshot.docs.map(UserProfile.fromFirestore).toList();
    });
  }
}