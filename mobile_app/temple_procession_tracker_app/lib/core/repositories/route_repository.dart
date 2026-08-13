import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/route_model.dart';

class RouteRepository {
  static const String collectionName = 'routes';

  final FirebaseFirestore _firestore;

  RouteRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(RouteModel route) async {
    await _collection.doc(route.id).set(route.toFirestore());
  }

  Future<RouteModel?> read(String routeId) async {
    final document = await _collection.doc(routeId).get();

    if (!document.exists) {
      return null;
    }

    return RouteModel.fromFirestore(document);
  }

  Future<void> update(RouteModel route) async {
    await _collection.doc(route.id).update(route.toFirestore());
  }

  Future<void> delete(String routeId) async {
    await _collection.doc(routeId).delete();
  }

  Stream<RouteModel?> streamById(String routeId) {
    return _collection.doc(routeId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return RouteModel.fromFirestore(document);
    });
  }

  Stream<List<RouteModel>> streamByEventId(String eventId) {
    return _collection
        .where('eventId', isEqualTo: eventId)
        .orderBy('createdAt')
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(RouteModel.fromFirestore).toList();
    });
  }
}