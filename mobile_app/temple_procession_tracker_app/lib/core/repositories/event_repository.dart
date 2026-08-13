import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/event.dart';

class EventRepository {
  static const String collectionName = 'events';

  final FirebaseFirestore _firestore;

  EventRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(Event event) async {
    await _collection.doc(event.id).set(event.toFirestore());
  }

  Future<Event?> read(String eventId) async {
    final document = await _collection.doc(eventId).get();

    if (!document.exists) {
      return null;
    }

    return Event.fromFirestore(document);
  }

  Future<void> update(Event event) async {
    await _collection.doc(event.id).update(event.toFirestore());
  }

  Future<void> delete(String eventId) async {
    await _collection.doc(eventId).delete();
  }

  Stream<Event?> streamById(String eventId) {
    return _collection.doc(eventId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return Event.fromFirestore(document);
    });
  }

  Stream<List<Event>> streamAll() {
    return _collection.orderBy('startTime').snapshots().map((snapshot) {
      return snapshot.docs.map(Event.fromFirestore).toList();
    });
  }
}