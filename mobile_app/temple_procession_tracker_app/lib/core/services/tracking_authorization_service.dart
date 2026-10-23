import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Checks the current user, assignment, and event against fresh server data.
/// RTDB Security Rules remain the final authority for each location write.
class TrackingAuthorizationService {
  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;

  TrackingAuthorizationService({FirebaseAuth? auth, FirebaseFirestore? firestore})
      : _auth = auth ?? FirebaseAuth.instance,
        _firestore = firestore ?? FirebaseFirestore.instance;

  Future<void> verifyPrimary({required String groupId, required String eventId}) async {
    final String? uid = _auth.currentUser?.uid;
    if (uid == null || groupId.isEmpty || eventId.isEmpty) throw StateError('Sign in as an assigned team leader.');

    final docs = await Future.wait([
      _firestore.doc('users/$uid').get(const GetOptions(source: Source.server)),
      _firestore.doc('groups/$groupId').get(const GetOptions(source: Source.server)),
      _firestore.doc('events/$eventId').get(const GetOptions(source: Source.server)),
    ]);

    final user = docs[0].data();
    final group = docs[1].data();
    final event = docs[2].data();
    if (user?['isActive'] != true || user?['role'] != 'teamLeader' || user?['assignedGroupId'] != groupId ||
        group?['leaderUserId'] != uid || group?['eventId'] != eventId || event?['status'] != 'active') {
      throw StateError('Tracking requires an active event and its assigned PRIMARY team leader.');
    }
  }
}