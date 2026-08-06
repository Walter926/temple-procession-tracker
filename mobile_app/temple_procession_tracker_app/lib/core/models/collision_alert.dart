import 'package:cloud_firestore/cloud_firestore.dart';

import '../enums/alert_severity.dart';

class CollisionAlert {
  final String id;
  final String eventId;
  final String sourceGroupId;
  final String targetGroupId;
  final AlertSeverity severity;
  final String message;
  final double distanceMeters;
  final DateTime createdAt;
  final bool isResolved;
  final DateTime? resolvedAt;

  const CollisionAlert({
    required this.id,
    required this.eventId,
    required this.sourceGroupId,
    required this.targetGroupId,
    required this.severity,
    required this.message,
    required this.distanceMeters,
    required this.createdAt,
    required this.isResolved,
    this.resolvedAt,
  });

  factory CollisionAlert.fromJson(Map<String, dynamic> json) {
    return CollisionAlert(
      id: json['id'] as String? ?? '',
      eventId: json['eventId'] as String? ?? '',
      sourceGroupId: json['sourceGroupId'] as String? ?? '',
      targetGroupId: json['targetGroupId'] as String? ?? '',
      severity: AlertSeverityParser.fromJson(json['severity']),
      message: json['message'] as String? ?? '',
      distanceMeters: (json['distanceMeters'] as num?)?.toDouble() ?? 0,
      createdAt: _dateTimeFromJson(json['createdAt']) ?? DateTime.now(),
      isResolved: json['isResolved'] as bool? ?? false,
      resolvedAt: _dateTimeFromJson(json['resolvedAt']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'eventId': eventId,
      'sourceGroupId': sourceGroupId,
      'targetGroupId': targetGroupId,
      'severity': severity.name,
      'message': message,
      'distanceMeters': distanceMeters,
      'createdAt': createdAt.toIso8601String(),
      'isResolved': isResolved,
      'resolvedAt': resolvedAt?.toIso8601String(),
    };
  }

  factory CollisionAlert.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return CollisionAlert.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'eventId': eventId,
      'sourceGroupId': sourceGroupId,
      'targetGroupId': targetGroupId,
      'severity': severity.name,
      'message': message,
      'distanceMeters': distanceMeters,
      'createdAt': Timestamp.fromDate(createdAt),
      'isResolved': isResolved,
      'resolvedAt': resolvedAt == null ? null : Timestamp.fromDate(resolvedAt!),
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