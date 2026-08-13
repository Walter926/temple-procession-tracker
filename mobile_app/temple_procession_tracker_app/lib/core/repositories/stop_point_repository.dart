import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/stop_point.dart';

class StopPointRepository {
  static const String collectionName = 'stopPoints';

  final FirebaseFirestore _firestore;

  StopPointRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(StopPoint stopPoint) async {
    await _collection.doc(stopPoint.id).set(stopPoint.toFirestore());
  }

  Future<StopPoint?> read(String stopPointId) async {
    final document = await _collection.doc(stopPointId).get();

    if (!document.exists) {
      return null;
    }

    return StopPoint.fromFirestore(document);
  }

  Future<void> update(StopPoint stopPoint) async {
    await _collection.doc(stopPoint.id).update(stopPoint.toFirestore());
  }

  Future<void> delete(String stopPointId) async {
    await _collection.doc(stopPointId).delete();
  }

  Stream<StopPoint?> streamById(String stopPointId) {
    return _collection.doc(stopPointId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return StopPoint.fromFirestore(document);
    });
  }

  Stream<List<StopPoint>> streamByRouteId(String routeId) {
    return _collection
        .where('routeId', isEqualTo: routeId)
        .orderBy('order')
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(StopPoint.fromFirestore).toList();
    });
  }
}