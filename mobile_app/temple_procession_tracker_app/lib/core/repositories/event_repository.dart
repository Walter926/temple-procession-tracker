import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/event.dart';

class EventRepository {
  static const String collectionName = 'events';

  final FirebaseFirestore _firestore;

  EventRepository({FirebaseFirestore? firestore})
    : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(Event event) async {
    await _write('create', event);
  }

  Future<Event?> read(String eventId) async {
    final document = await _collection.doc(eventId).get();

    if (!document.exists) {
      return null;
    }

    return Event.fromFirestore(document);
  }

  Future<Event?> readByOrganizerId(String organizerId) async {
    final snapshot = await _collection
        .where('organizerId', isEqualTo: organizerId)
        .limit(1)
        .get();

    if (snapshot.docs.isEmpty) {
      return null;
    }

    return Event.fromFirestore(snapshot.docs.first);
  }

  Future<void> update(Event event) async {
    await _write('update', event);
  }

  Future<void> delete(String eventId) async {
    await FirebaseFunctions.instanceFor(
      region: 'us-central1',
    ).httpsCallable('manageEvent').call({
      'operation': 'delete',
      'resource': 'event',
      'eventId': eventId,
      'id': eventId,
    });
  }

  Future<void> _write(String operation, Event event) async {
    await FirebaseFunctions.instanceFor(
      region: 'us-central1',
    ).httpsCallable('manageEvent').call({
      'operation': operation,
      'resource': 'event',
      'eventId': operation == 'create' ? '' : event.id,
      'id': event.id,
      'data': {
        'name': event.name,
        'description': event.description,
        'status': event.status.name,
        'startTimeMs': event.startTime.millisecondsSinceEpoch,
        'endTimeMs': event.endTime?.millisecondsSinceEpoch,
        'routeId': event.routeId,
        'isPublic': event.isPublic,
        'mainTempleName': event.mainTempleName,
        'cityRegion': event.cityRegion,
      },
    });
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
    return _collection.orderBy('startTime').limit(100).snapshots().map((
      snapshot,
    ) {
      return snapshot.docs.map(Event.fromFirestore).toList();
    });
  }

  Stream<List<Event>> streamByOrganizer(String organizerId) => _collection
      .where('organizerId', isEqualTo: organizerId)
      .limit(100)
      .snapshots()
      .map(
        (snapshot) =>
            snapshot.docs.map(Event.fromFirestore).toList()
              ..sort((a, b) => a.startTime.compareTo(b.startTime)),
      );
}
