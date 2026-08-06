import 'package:cloud_firestore/cloud_firestore.dart';

class AccessCode {
  final String id;
  final String eventId;
  final String groupId;
  final String code;
  final bool isActive;
  final int maxUses;
  final int usedCount;
  final DateTime? expiresAt;
  final DateTime createdAt;

  const AccessCode({
    required this.id,
    required this.eventId,
    required this.groupId,
    required this.code,
    required this.isActive,
    required this.maxUses,
    required this.usedCount,
    this.expiresAt,
    required this.createdAt,
  });

  factory AccessCode.fromJson(Map<String, dynamic> json) {
    return AccessCode(
      id: json['id'] as String? ?? '',
      eventId: json['eventId'] as String? ?? '',
      groupId: json['groupId'] as String? ?? '',
      code: json['code'] as String? ?? '',
      isActive: json['isActive'] as bool? ?? true,
      maxUses: (json['maxUses'] as num?)?.toInt() ?? 1,
      usedCount: (json['usedCount'] as num?)?.toInt() ?? 0,
      expiresAt: _dateTimeFromJson(json['expiresAt']),
      createdAt: _dateTimeFromJson(json['createdAt']) ?? DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'eventId': eventId,
      'groupId': groupId,
      'code': code,
      'isActive': isActive,
      'maxUses': maxUses,
      'usedCount': usedCount,
      'expiresAt': expiresAt?.toIso8601String(),
      'createdAt': createdAt.toIso8601String(),
    };
  }

  factory AccessCode.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return AccessCode.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'eventId': eventId,
      'groupId': groupId,
      'code': code,
      'isActive': isActive,
      'maxUses': maxUses,
      'usedCount': usedCount,
      'expiresAt': expiresAt == null ? null : Timestamp.fromDate(expiresAt!),
      'createdAt': Timestamp.fromDate(createdAt),
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