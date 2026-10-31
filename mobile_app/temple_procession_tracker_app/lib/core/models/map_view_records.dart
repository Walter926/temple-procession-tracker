import 'package:cloud_firestore/cloud_firestore.dart';

DateTime? mapDate(Object? value) => value is Timestamp ? value.toDate() : value is DateTime ? value : value is int ? DateTime.fromMillisecondsSinceEpoch(value) : null;
double mapNumber(Object? value, [double fallback = 0]) => value is num ? value.toDouble() : fallback;

class PublishedEventView {
  final String id, name, status, routeId, cityRegion;
  final DateTime? startTime;
  const PublishedEventView({required this.id, required this.name, required this.status, required this.routeId, required this.cityRegion, this.startTime});
  factory PublishedEventView.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? {};
    return PublishedEventView(id: doc.id, name: '${d['name'] ?? ''}', status: '${d['status'] ?? ''}', routeId: '${d['routeId'] ?? ''}', cityRegion: '${d['cityRegion'] ?? ''}', startTime: mapDate(d['startTime']));
  }
}

class MapRouteView {
  final String id, eventId, name, color, encodedPolyline;
  const MapRouteView({required this.id, required this.eventId, required this.name, required this.color, required this.encodedPolyline});
  factory MapRouteView.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? {};
    return MapRouteView(id: doc.id, eventId: '${d['eventId'] ?? ''}', name: '${d['name'] ?? ''}', color: '${d['color'] ?? '#3169A6'}', encodedPolyline: '${d['encodedPolyline'] ?? ''}');
  }
}

class MapStopView {
  final String id, routeId, name, description;
  final int order;
  final double latitude, longitude, radiusMeters;
  final DateTime? expectedArrivalTime;
  const MapStopView({required this.id, required this.routeId, required this.name, required this.description, required this.order, required this.latitude, required this.longitude, required this.radiusMeters, this.expectedArrivalTime});
  factory MapStopView.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? {};
    return MapStopView(id: doc.id, routeId: '${d['routeId'] ?? ''}', name: '${d['name'] ?? ''}', description: '${d['description'] ?? ''}', order: (d['order'] as num?)?.toInt() ?? 0, latitude: mapNumber(d['latitude']), longitude: mapNumber(d['longitude']), radiusMeters: mapNumber(d['geofenceRadiusMeters'], 100), expectedArrivalTime: mapDate(d['expectedArrivalTime']));
  }
}

class MapGroupView {
  final String id, eventId, routeId, name, color, status, startingStopPointId, endingStopPointId;
  const MapGroupView({required this.id, required this.eventId, required this.routeId, required this.name, required this.color, required this.status, required this.startingStopPointId, required this.endingStopPointId});
  factory MapGroupView.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? {};
    return MapGroupView(id: doc.id, eventId: '${d['eventId'] ?? ''}', routeId: '${d['routeId'] ?? ''}', name: '${d['name'] ?? ''}', color: '${d['color'] ?? '#3169A6'}', status: '${d['status'] ?? 'waiting'}', startingStopPointId: '${d['startingStopPointId'] ?? ''}', endingStopPointId: '${d['endingStopPointId'] ?? ''}');
  }
}

class LiveGroupPosition {
  final String userId;
  final double latitude, longitude, headingDegrees, speedMetersPerSecond, accuracyMeters;
  final DateTime? recordedAt;
  const LiveGroupPosition({required this.userId, required this.latitude, required this.longitude, required this.headingDegrees, required this.speedMetersPerSecond, required this.accuracyMeters, this.recordedAt});
  factory LiveGroupPosition.fromData(Map<String, dynamic> d) => LiveGroupPosition(userId: '${d['userId'] ?? ''}', latitude: mapNumber(d['latitude'], double.nan), longitude: mapNumber(d['longitude'], double.nan), headingDegrees: mapNumber(d['headingDegrees']), speedMetersPerSecond: mapNumber(d['speedMetersPerSecond']), accuracyMeters: mapNumber(d['accuracyMeters']), recordedAt: mapDate(d['recordedAt']));
  bool get valid => latitude.isFinite && longitude.isFinite && latitude.abs() <= 90 && longitude.abs() <= 180;
  bool get stale => recordedAt == null || DateTime.now().difference(recordedAt!).inSeconds > 60;
}

class MapAnnouncementView {
  final String id, message;
  final DateTime? updatedAt;
  const MapAnnouncementView({required this.id, required this.message, this.updatedAt});
  factory MapAnnouncementView.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? {};
    return MapAnnouncementView(id: doc.id, message: '${d['message'] ?? ''}', updatedAt: mapDate(d['updatedAt']));
  }
}

class GroupProgressView {
  final String groupId, currentStopPointId, nextStopPointId, currentSegmentId, suggestedStatus;
  final List<String> completedStopIds;
  final int completedCount, totalStops;
  final double progressPercent;
  final bool isDelayed;
  final DateTime? actualArrivalAt, estimatedArrivalAt, lastComputedAt;
  const GroupProgressView({required this.groupId, required this.currentStopPointId, required this.nextStopPointId, required this.currentSegmentId, required this.suggestedStatus, required this.completedStopIds, required this.completedCount, required this.totalStops, required this.progressPercent, required this.isDelayed, this.actualArrivalAt, this.estimatedArrivalAt, this.lastComputedAt});
  factory GroupProgressView.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? {};
    return GroupProgressView(groupId: doc.id, currentStopPointId: '${d['currentStopPointId'] ?? ''}', nextStopPointId: '${d['nextStopPointId'] ?? ''}', currentSegmentId: '${d['currentSegmentId'] ?? ''}', suggestedStatus: '${d['suggestedStatus'] ?? ''}', completedStopIds: List<String>.from(d['completedStopIds'] as List? ?? const []), completedCount: (d['completedCount'] as num?)?.toInt() ?? 0, totalStops: (d['totalStops'] as num?)?.toInt() ?? 0, progressPercent: mapNumber(d['progressPercent']), isDelayed: d['isDelayed'] == true, actualArrivalAt: mapDate(d['actualArrivalAt']), estimatedArrivalAt: mapDate(d['estimatedArrivalAt']), lastComputedAt: mapDate(d['lastComputedAt']));
  }
}