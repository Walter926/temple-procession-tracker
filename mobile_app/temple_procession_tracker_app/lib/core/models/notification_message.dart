import 'package:cloud_firestore/cloud_firestore.dart';

import '../enums/alert_severity.dart';

class NotificationMessage {
  final String id;
  final String eventId;
  final String title;
  final String body;
  final AlertSeverity severity;
  final List<String> targetUserIds;
  final List<String> targetGroupIds;
  final DateTime createdAt;
  final List<String> readByUserIds;

  const NotificationMessage({
    required this.id,
    required this.eventId,
    required this.title,
    required this.body,
    required this.severity,
    required this.targetUserIds,
    required this.targetGroupIds,
    required this.createdAt,
    required this.readByUserIds,
  });

  factory NotificationMessage.fromJson(Map<String, dynamic> json) {
    return NotificationMessage(
      id: json['id'] as String? ?? '',
      eventId: json['eventId'] as String? ?? '',
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      severity: AlertSeverityParser.fromJson(json['severity']),
      targetUserIds:
          List<String>.from(json['targetUserIds'] as List? ?? const []),
      targetGroupIds:
          List<String>.from(json['targetGroupIds'] as List? ?? const []),
      createdAt: _dateTimeFromJson(json['createdAt']) ?? DateTime.now(),
      readByUserIds:
          List<String>.from(json['readByUserIds'] as List? ?? const []),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'eventId': eventId,
      'title': title,
      'body': body,
      'severity': severity.name,
      'targetUserIds': targetUserIds,
      'targetGroupIds': targetGroupIds,
      'createdAt': createdAt.toIso8601String(),
      'readByUserIds': readByUserIds,
    };
  }

  factory NotificationMessage.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return NotificationMessage.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'eventId': eventId,
      'title': title,
      'body': body,
      'severity': severity.name,
      'targetUserIds': targetUserIds,
      'targetGroupIds': targetGroupIds,
      'createdAt': Timestamp.fromDate(createdAt),
      'readByUserIds': readByUserIds,
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