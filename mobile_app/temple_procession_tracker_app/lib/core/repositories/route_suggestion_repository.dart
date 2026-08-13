import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/route_suggestion.dart';

class RouteSuggestionRepository {
  static const String collectionName = 'routeSuggestions';

  final FirebaseFirestore _firestore;

  RouteSuggestionRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(RouteSuggestion routeSuggestion) async {
    await _collection
        .doc(routeSuggestion.id)
        .set(routeSuggestion.toFirestore());
  }

  Future<RouteSuggestion?> read(String routeSuggestionId) async {
    final document = await _collection.doc(routeSuggestionId).get();

    if (!document.exists) {
      return null;
    }

    return RouteSuggestion.fromFirestore(document);
  }

  Future<void> update(RouteSuggestion routeSuggestion) async {
    await _collection
        .doc(routeSuggestion.id)
        .update(routeSuggestion.toFirestore());
  }

  Future<void> delete(String routeSuggestionId) async {
    await _collection.doc(routeSuggestionId).delete();
  }

  Stream<RouteSuggestion?> streamById(String routeSuggestionId) {
    return _collection.doc(routeSuggestionId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return RouteSuggestion.fromFirestore(document);
    });
  }

  Stream<List<RouteSuggestion>> streamByEventId(String eventId) {
    return _collection
        .where('eventId', isEqualTo: eventId)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(RouteSuggestion.fromFirestore).toList();
    });
  }

  Stream<List<RouteSuggestion>> streamByGroupId(String groupId) {
    return _collection
        .where('groupId', isEqualTo: groupId)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(RouteSuggestion.fromFirestore).toList();
    });
  }
}