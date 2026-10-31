import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import '../models/map_view_records.dart';

class LiveMapRepository {
  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;
  final FirebaseDatabase _database;
  LiveMapRepository({FirebaseFirestore? firestore, FirebaseAuth? auth, FirebaseDatabase? database}) : _firestore = firestore ?? FirebaseFirestore.instance, _auth = auth ?? FirebaseAuth.instance, _database = database ?? FirebaseDatabase.instance;

  Stream<List<PublishedEventView>> publishedEvents() => _firestore.collection('publicEvents').snapshots().map((s) => s.docs.map(PublishedEventView.fromDoc).where((e) => e.routeId.isNotEmpty && ['scheduled', 'active'].contains(e.status)).toList()..sort((a, b) => a.name.compareTo(b.name)));
  Stream<MapRouteView?> route(String routeId) => _firestore.collection('routes').doc(routeId).snapshots().map((s) => s.exists ? MapRouteView.fromDoc(s) : null);
  Stream<List<MapStopView>> stops(String routeId) => _firestore.collection('stopPoints').where('routeId', isEqualTo: routeId).snapshots().map((s) => s.docs.map(MapStopView.fromDoc).toList()..sort((a, b) => a.order.compareTo(b.order)));
  Stream<List<MapGroupView>> groups(String eventId) => _auth.currentUser == null ? Stream.value([]) : _firestore.collection('groups').where('eventId', isEqualTo: eventId).snapshots().map((s) => s.docs.map(MapGroupView.fromDoc).toList());
  Stream<MapGroupView?> group(String groupId) => _firestore.collection('groups').doc(groupId).snapshots().map((s) => s.exists ? MapGroupView.fromDoc(s) : null);
  Stream<GroupProgressView?> progress(String groupId) => _firestore.collection('groupProgress').doc(groupId).snapshots().map((s) => s.exists ? GroupProgressView.fromDoc(s) : null);
  Stream<List<MapAnnouncementView>> announcements(String eventId) => _firestore.collection('publicAnnouncements').where('eventId', isEqualTo: eventId).where('isActive', isEqualTo: true).snapshots().map((s) => s.docs.map(MapAnnouncementView.fromDoc).toList()..sort((a, b) => (b.updatedAt ?? DateTime(0)).compareTo(a.updatedAt ?? DateTime(0))));

  Stream<Map<String, LiveGroupPosition>> live(String eventId) {
    if (_auth.currentUser == null) return Stream.value({});
    return _database.ref('liveLocations/$eventId').onValue.map((event) {
      final result = <String, LiveGroupPosition>{};
      final value = event.snapshot.value;
      if (value is! Map) return result;
      for (final entry in value.entries) {
        if (entry.value is! Map) continue;
        final item = LiveGroupPosition.fromData(Map<String, dynamic>.from((entry.value as Map).map((k, v) => MapEntry('$k', v))));
        if (item.valid) result['${entry.key}'] = item;
      }
      return result;
    });
  }

  Stream<String> assignedGroupId(String uid) => _firestore.collection('users').doc(uid).snapshots().map((s) {
    final d = s.data() ?? {};
    if (d['isActive'] != true) return '';
    return d['role'] == 'teamLeader' ? '${d['assignedGroupId'] ?? ''}' : '${d['joinedGroupId'] ?? ''}';
  });
}