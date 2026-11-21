import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/user_profile.dart';

class UserRepository {
  static const String collectionName = 'users';

  final FirebaseFirestore _firestore;

  UserRepository({FirebaseFirestore? firestore})
    : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(UserProfile userProfile) async {
    // Assignment/membership pointers are exclusively written by trusted operations.
    final data = userProfile.toFirestore()
      ..remove('assignedGroupId')
      ..remove('joinedEventId')
      ..remove('joinedGroupId');
    await _collection.doc(userProfile.id).set(data);
  }

  Future<UserProfile?> read(String userId) async {
    final document = await _collection.doc(userId).get();

    if (!document.exists) {
      return null;
    }

    return UserProfile.fromFirestore(document);
  }

  Future<void> update(UserProfile userProfile) async {
    await _collection.doc(userProfile.id).update({
      'displayName': userProfile.displayName,
      'photoUrl': userProfile.photoUrl,
      'phoneNumber': userProfile.phoneNumber,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> delete(String userId) async {
    await FirebaseFunctions.instanceFor(region: 'us-central1')
        .httpsCallable('manageAccount')
        .call({'operation': 'delete', 'uid': userId});
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
