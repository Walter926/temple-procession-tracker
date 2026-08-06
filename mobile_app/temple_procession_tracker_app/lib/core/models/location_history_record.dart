import 'package:cloud_firestore/cloud_firestore.dart';

class LocationHistoryRecord {
  final String id;
  final String eventId;
  final String groupId;
  final String locationUpdateId;
  final double latitude;
  final double longitude;
  final DateTime recordedAt;

  const LocationHistoryRecord({
    required this.id,
    required this.eventId,
    required this.groupId,
    required this.locationUpdateId,
    required this.latitude,
    required this.longitude,
    required this.recordedAt,
  });

  factory LocationHistoryRecord.fromJson(Map<String, dynamic> json) {
    return LocationHistoryRecord(
      id: json['id'] as String? ?? '',
      eventId: json['eventId'] as String? ?? '',
      groupId: json['groupId'] as String? ?? '',
      locationUpdateId: json['locationUpdateId'] as String? ?? '',
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      recordedAt: _dateTimeFromJson(json['recordedAt']) ?? DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'eventId': eventId,
      'groupId': groupId,
      'locationUpdateId': locationUpdateId,
      'latitude': latitude,
      'longitude': longitude,
      'recordedAt': recordedAt.toIso8601String(),
    };
  }

  factory LocationHistoryRecord.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return LocationHistoryRecord.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'eventId': eventId,
      'groupId': groupId,
      'locationUpdateId': locationUpdateId,
      'latitude': latitude,
      'longitude': longitude,
      'recordedAt': Timestamp.fromDate(recordedAt),
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