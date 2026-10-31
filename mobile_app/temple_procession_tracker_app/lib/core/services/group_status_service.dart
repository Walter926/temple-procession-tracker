import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class GroupStatusService {
  final FirebaseFirestore db;
  final FirebaseAuth auth;
  GroupStatusService({FirebaseFirestore? firestore, FirebaseAuth? firebaseAuth}) : db = firestore ?? FirebaseFirestore.instance, auth = firebaseAuth ?? FirebaseAuth.instance;
  static const allowed = {'waiting', 'preparing', 'moving', 'stopped', 'delayed', 'arrived', 'completed', 'emergency'};

  Future<void> updateAsPrimary({required String status}) async {
    if (!allowed.contains(status)) throw ArgumentError('Unknown group status.');
    final uid = auth.currentUser?.uid;
    if (uid == null) throw StateError('Sign in first.');
    final user = await db.collection('users').doc(uid).get(const GetOptions(source: Source.server));
    final groupId = '${user.data()?['assignedGroupId'] ?? ''}';
    if (groupId.isEmpty) throw StateError('You have no assigned group.');
    final group = await db.collection('groups').doc(groupId).get(const GetOptions(source: Source.server));
    if (!user.exists || !group.exists || user.data()?['isActive'] != true || user.data()?['role'] != 'teamLeader' || user.data()?['assignedGroupId'] != groupId || group.data()?['leaderUserId'] != uid) throw StateError('Only the active assigned primary leader can update status.');
    final eventId = '${group.data()?['eventId'] ?? ''}';
    final event = await db.collection('events').doc(eventId).get(const GetOptions(source: Source.server));
    if (event.data()?['status'] != 'active') throw StateError('The event must be active.');
    await db.collection('groups').doc(groupId).update({'status': status, 'statusUpdatedAt': FieldValue.serverTimestamp()});
  }
}