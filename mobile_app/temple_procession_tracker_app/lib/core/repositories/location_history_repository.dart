import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/location_history_record.dart';

class LocationHistoryRepository {
  static const String collectionName = 'locationHistory';

  final FirebaseFirestore _firestore;

  LocationHistoryRepository({FirebaseFirestore? firestore})
    : _firestore = firestore ?? FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _collection {
    return _firestore.collection(collectionName);
  }

  Future<void> create(LocationHistoryRecord historyRecord) async {
    throw UnsupportedError(
      'Location history is written by the trusted backend.',
    );
  }

  Future<LocationHistoryRecord?> read(String historyRecordId) async {
    final document = await _collection.doc(historyRecordId).get();

    if (!document.exists) {
      return null;
    }

    return LocationHistoryRecord.fromFirestore(document);
  }

  Future<void> update(LocationHistoryRecord historyRecord) async {
    throw UnsupportedError(
      'Location history is written by the trusted backend.',
    );
  }

  Future<void> delete(String historyRecordId) async {
    throw UnsupportedError(
      'Location history retention is managed by the backend.',
    );
  }

  Stream<LocationHistoryRecord?> streamById(String historyRecordId) {
    return _collection.doc(historyRecordId).snapshots().map((document) {
      if (!document.exists) {
        return null;
      }

      return LocationHistoryRecord.fromFirestore(document);
    });
  }

  Stream<List<LocationHistoryRecord>> streamByGroupId(
    String groupId, {
    String? eventId,
    DateTime? from,
    DateTime? to,
    int limit = 1000,
  }) {
    Query<Map<String, dynamic>> query = _collection.where(
      'groupId',
      isEqualTo: groupId,
    );
    if (eventId != null) query = query.where('eventId', isEqualTo: eventId);
    return _history(query, from: from, to: to, limit: limit);
  }

  Stream<List<LocationHistoryRecord>> streamByEventId(
    String eventId, {
    DateTime? from,
    DateTime? to,
    int limit = 1000,
  }) {
    return _history(
      _collection.where('eventId', isEqualTo: eventId),
      from: from,
      to: to,
      limit: limit,
    );
  }

  Stream<List<LocationHistoryRecord>> _history(
    Query<Map<String, dynamic>> query, {
    DateTime? from,
    DateTime? to,
    required int limit,
  }) {
    if (from != null) {
      query = query.where(
        'recordedAt',
        isGreaterThanOrEqualTo: Timestamp.fromDate(from),
      );
    }
    if (to != null) {
      query = query.where(
        'recordedAt',
        isLessThanOrEqualTo: Timestamp.fromDate(to),
      );
    }
    return query
        .orderBy('recordedAt', descending: true)
        .limit(limit.clamp(1, 2000))
        .snapshots()
        .map(
          (snapshot) =>
              snapshot.docs.map(LocationHistoryRecord.fromFirestore).toList()
                ..sort((a, b) => a.recordedAt.compareTo(b.recordedAt)),
        );
  }
}
