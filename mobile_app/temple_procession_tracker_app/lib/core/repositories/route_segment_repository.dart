import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/route_segment.dart';

class RouteSegmentRepository {
  static const String collectionName = 'routeSegments';

  final FirebaseFirestore _firestore;

  RouteSegmentRepository({
    FirebaseFirestore? firestore,
  }) : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(RouteSegment routeSegment) async {
    await _collection.doc(routeSegment.id).set(routeSegment.toFirestore());
  }

  Future<RouteSegment?> read(String routeSegmentId) async {
    final document = await _collection.doc(routeSegmentId).get();

    if (!document.exists) {
      return null;
    }

    return RouteSegment.fromFirestore(document);
  }

  Future<void> update(RouteSegment routeSegment) async {
    await _collection
        .doc(routeSegment.id)
        .update(routeSegment.toFirestore());
  }

  Future<void> delete(String routeSegmentId) async {
    await _collection.doc(routeSegmentId).delete();
  }

  Stream<RouteSegment?> streamById(String routeSegmentId) {
    return _collection.doc(routeSegmentId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return RouteSegment.fromFirestore(document);
    });
  }

  Stream<List<RouteSegment>> streamByRouteId(String routeId) {
    return _collection
        .where('routeId', isEqualTo: routeId)
        .orderBy('order')
        .snapshots()
        .map((snapshot) {
      return snapshot.docs.map(RouteSegment.fromFirestore).toList();
    });
  }
}