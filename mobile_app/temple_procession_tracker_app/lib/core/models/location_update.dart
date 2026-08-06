import 'package:cloud_firestore/cloud_firestore.dart';

class LocationUpdate {
  final String id;
  final String eventId;
  final String groupId;
  final String userId;
  final double latitude;
  final double longitude;
  final double accuracyMeters;
  final double speedMetersPerSecond;
  final double headingDegrees;
  final DateTime recordedAt;
  final int? batteryLevel;

  const LocationUpdate({
    required this.id,
    required this.eventId,
    required this.groupId,
    required this.userId,
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
    required this.speedMetersPerSecond,
    required this.headingDegrees,
    required this.recordedAt,
    this.batteryLevel,
  });

  factory LocationUpdate.fromJson(Map<String, dynamic> json) {
    return LocationUpdate(
      id: json['id'] as String? ?? '',
      eventId: json['eventId'] as String? ?? '',
      groupId: json['groupId'] as String? ?? '',
      userId: json['userId'] as String? ?? '',
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      accuracyMeters: (json['accuracyMeters'] as num?)?.toDouble() ?? 0,
      speedMetersPerSecond:
          (json['speedMetersPerSecond'] as num?)?.toDouble() ?? 0,
      headingDegrees: (json['headingDegrees'] as num?)?.toDouble() ?? 0,
      recordedAt: _dateTimeFromJson(json['recordedAt']) ?? DateTime.now(),
      batteryLevel: (json['batteryLevel'] as num?)?.toInt(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'eventId': eventId,
      'groupId': groupId,
      'userId': userId,
      'latitude': latitude,
      'longitude': longitude,
      'accuracyMeters': accuracyMeters,
      'speedMetersPerSecond': speedMetersPerSecond,
      'headingDegrees': headingDegrees,
      'recordedAt': recordedAt.toIso8601String(),
      'batteryLevel': batteryLevel,
    };
  }

  factory LocationUpdate.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return LocationUpdate.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'eventId': eventId,
      'groupId': groupId,
      'userId': userId,
      'latitude': latitude,
      'longitude': longitude,
      'accuracyMeters': accuracyMeters,
      'speedMetersPerSecond': speedMetersPerSecond,
      'headingDegrees': headingDegrees,
      'recordedAt': Timestamp.fromDate(recordedAt),
      'batteryLevel': batteryLevel,
    };
  }

  static DateTime? _dateTimeFromJson(Object? value) {
    if (value == null) return null;
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    return null;
  }
}