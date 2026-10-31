import 'package:cloud_firestore/cloud_firestore.dart';

class LocationUpdate {
  final String id, eventId, groupId, userId;
  final double latitude, longitude, accuracyMeters, speedMetersPerSecond, headingDegrees;
  final DateTime recordedAt;
  final int? batteryLevel;

  const LocationUpdate({required this.id, required this.eventId, required this.groupId, required this.userId,
    required this.latitude, required this.longitude, required this.accuracyMeters, required this.speedMetersPerSecond,
    required this.headingDegrees, required this.recordedAt, this.batteryLevel});

  factory LocationUpdate.fromJson(Map<String, dynamic> json) => LocationUpdate(
    id: json['id'] as String? ?? '', eventId: json['eventId'] as String? ?? '',
    groupId: json['groupId'] as String? ?? '', userId: json['userId'] as String? ?? '',
    latitude: (json['latitude'] as num?)?.toDouble() ?? 0, longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
    accuracyMeters: (json['accuracyMeters'] as num?)?.toDouble() ?? 0,
    speedMetersPerSecond: (json['speedMetersPerSecond'] as num?)?.toDouble() ?? 0,
    headingDegrees: (json['headingDegrees'] as num?)?.toDouble() ?? 0,
    recordedAt: _date(json['recordedAt']) ?? DateTime.now(), batteryLevel: (json['batteryLevel'] as num?)?.toInt());

  Map<String, dynamic> toJson() => { 'id': id, 'eventId': eventId, 'groupId': groupId, 'userId': userId,
    'latitude': latitude, 'longitude': longitude, 'accuracyMeters': accuracyMeters,
    'speedMetersPerSecond': speedMetersPerSecond, 'headingDegrees': headingDegrees,
    'recordedAt': recordedAt.toIso8601String(), 'batteryLevel': batteryLevel };

  factory LocationUpdate.fromFirestore(DocumentSnapshot<Map<String, dynamic>> doc) => LocationUpdate.fromJson({...?doc.data(), 'id': doc.id});

  Map<String, dynamic> toFirestore() => { 'eventId': eventId, 'groupId': groupId, 'userId': userId,
    'latitude': latitude, 'longitude': longitude, 'accuracyMeters': accuracyMeters,
    'speedMetersPerSecond': speedMetersPerSecond, 'headingDegrees': headingDegrees,
    'recordedAt': Timestamp.fromDate(recordedAt), 'batteryLevel': batteryLevel };

  Map<String, Object?> toRealtimeDatabase(Object serverTimestamp) => { 'userId': userId, 'latitude': latitude,
    'longitude': longitude, 'accuracyMeters': accuracyMeters,
    'speedMetersPerSecond': speedMetersPerSecond, 'headingDegrees': headingDegrees,
    'recordedAt': serverTimestamp };

  static DateTime? _date(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
    return null;
  }
}