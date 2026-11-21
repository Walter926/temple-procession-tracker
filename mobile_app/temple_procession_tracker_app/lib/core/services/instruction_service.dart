import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/map_view_records.dart';

class InstructionRecord {
  final String id, collection;
  final Map<String, dynamic> data;
  const InstructionRecord(this.id, this.collection, this.data);
  DateTime? get createdAt => mapDate(data['createdAt']);
  bool visibleAt(DateTime now, {String? eventId, String? groupId}) {
    final expires = mapDate(data['expiresAt']);
    return expires != null &&
        expires.isAfter(now) &&
        ['active', 'unread'].contains(data['state']) &&
        (eventId == null || data['eventId'] == eventId) &&
        (groupId == null || data['groupId'] == groupId);
  }
}

/// Recipient-only queries retain server-side filtering and the existing indexes.
class InstructionService {
  final FirebaseFirestore? firestore;
  final FirebaseAuth? auth;
  final FirebaseFunctions? functions;
  InstructionService({this.firestore, this.auth, this.functions});
  String? get currentUid => (auth ?? FirebaseAuth.instance).currentUser?.uid;
  Stream<List<InstructionRecord>> watch(String collection) {
    final uid = currentUid;
    if (uid == null) return Stream.value(const []);
    return (firestore ?? FirebaseFirestore.instance)
        .collection(collection)
        .where('uid', isEqualTo: uid)
        .where('state', whereIn: ['active', 'unread'])
        .orderBy('createdAt', descending: true)
        .limit(20)
        .snapshots()
        .map(
          (s) => s.docs
              .map((d) => InstructionRecord(d.id, collection, d.data()))
              .toList(),
        );
  }

  Future<void> acknowledge(InstructionRecord record) async {
    final route = record.collection == 'routeInstructions';
    await (functions ?? FirebaseFunctions.instanceFor(region: 'us-central1'))
        .httpsCallable(
          route ? 'acknowledgeRouteInstruction' : 'acknowledgeCollisionWarning',
        )
        .call(<String, dynamic>{
          route ? 'instructionId' : 'warningId': record.id,
        });
  }
}
