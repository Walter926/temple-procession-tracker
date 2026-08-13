import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/procession_group.dart';

class GroupRepository {
  static const String collectionName = 'groups';

  final FirebaseFirestore _firestore;

  GroupRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(ProcessionGroup group) async {
    await _collection.doc(group.id).set(group.toFirestore());
  }

  Future<ProcessionGroup?> read(String groupId) async {
    final document = await _collection.doc(groupId).get();

    if (!document.exists) {
      return null;
    }

    return ProcessionGroup.fromFirestore(document);
  }

  Future<void> update(ProcessionGroup group) async {
    await _collection.doc(group.id).update(group.toFirestore());
  }

  Future<void> delete(String groupId) async {
    await _collection.doc(groupId).delete();
  }

  Stream<ProcessionGroup?> streamById(String groupId) {
    return _collection.doc(groupId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return ProcessionGroup.fromFirestore(document);
    });
  }

  Stream<List<ProcessionGroup>> streamByEventId(String eventId) {
    return _collection
        .where('eventId', isEqualTo: eventId)
        .orderBy('name')
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(ProcessionGroup.fromFirestore).toList();
    });
  }
}