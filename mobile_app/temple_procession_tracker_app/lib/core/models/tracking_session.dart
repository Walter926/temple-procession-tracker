// tracking_session.dart

import 'package:cloud_firestore/cloud_firestore.dart';

class TrackingSession {
  final String id;
  final String eventId;
  final String groupId;
  final String leaderUserId;
  final DateTime startedAt;
  final DateTime? endedAt;
  final bool isActive;
  final double totalDistanceMeters;
  final int totalUpdates;

  const TrackingSession({
    required this.id,
    required this.eventId,
    required this.groupId,
    required this.leaderUserId,
    required this.startedAt,
    this.endedAt,
    required this.isActive,
    required this.totalDistanceMeters,
    required this.totalUpdates,
  });

  factory TrackingSession.fromJson(Map<String, dynamic> json) {
    return TrackingSession(
      id: json['id'] as String? ?? '',
      eventId: json['eventId'] as String? ?? '',
      groupId: json['groupId'] as String? ?? '',
      leaderUserId: json['leaderUserId'] as String? ?? '',
      startedAt: _dateTimeFromJson(json['startedAt']) ?? DateTime.now(),
      endedAt: _dateTimeFromJson(json['endedAt']),
      isActive: json['isActive'] as bool? ?? false,
      totalDistanceMeters:
          (json['totalDistanceMeters'] as num?)?.toDouble() ?? 0,
      totalUpdates: (json['totalUpdates'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'eventId': eventId,
      'groupId': groupId,
      'leaderUserId': leaderUserId,
      'startedAt': startedAt.toIso8601String(),
      'endedAt': endedAt?.toIso8601String(),
      'isActive': isActive,
      'totalDistanceMeters': totalDistanceMeters,
      'totalUpdates': totalUpdates,
    };
  }

  factory TrackingSession.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return TrackingSession.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'eventId': eventId,
      'groupId': groupId,
      'leaderUserId': leaderUserId,
      'startedAt': Timestamp.fromDate(startedAt),
      'endedAt': endedAt == null ? null : Timestamp.fromDate(endedAt!),
      'isActive': isActive,
      'totalDistanceMeters': totalDistanceMeters,
      'totalUpdates': totalUpdates,
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