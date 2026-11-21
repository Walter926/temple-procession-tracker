import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

/// An event-only membership has no group. Reading it never grants publishing rights.
class Membership {
  final String id, uid, eventId, groupId;
  const Membership({
    required this.id,
    required this.uid,
    required this.eventId,
    this.groupId = '',
  });

  factory Membership.fromDocument(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? {};
    return Membership(
      id: doc.id,
      uid: data['uid'] as String? ?? '',
      eventId: data['eventId'] as String? ?? '',
      groupId: data['groupId'] as String? ?? '',
    );
  }

  bool get isEventOnly => groupId.isEmpty;
  bool isSelected(String eventId, String groupId) =>
      this.eventId == eventId && this.groupId == groupId;
}

class MembershipService {
  final FirebaseFirestore _firestore;
  final FirebaseFunctions _functions;
  MembershipService({
    FirebaseFirestore? firestore,
    FirebaseFunctions? functions,
  }) : _firestore = firestore ?? FirebaseFirestore.instance,
       _functions =
           functions ?? FirebaseFunctions.instanceFor(region: 'us-central1');

  Stream<List<Membership>> watchOwn(String uid) => _firestore
      .collection('memberships')
      .where('uid', isEqualTo: uid)
      .limit(100)
      .snapshots()
      .map(
        (snapshot) => snapshot.docs
            .where(
              (doc) =>
                  doc.data()['isActive'] != false &&
                  !['removed', 'revoked'].contains(doc.data()['status']),
            )
            .map(Membership.fromDocument)
            .toList(),
      );

  /// The server verifies that the requested membership still belongs to this user.
  Future<void> select(Membership membership) async {
    await _functions.httpsCallable('setActiveMembership').call({
      'eventId': membership.eventId,
      'groupId': membership.groupId,
    });
  }
}
