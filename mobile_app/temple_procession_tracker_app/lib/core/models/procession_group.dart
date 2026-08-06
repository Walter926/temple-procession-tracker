import 'package:cloud_firestore/cloud_firestore.dart';

import '../enums/group_status.dart';

class ProcessionGroup {
  final String id;
  final String eventId;
  final String name;
  final String leaderUserId;
  final GroupStatus status;
  final double? currentLatitude;
  final double? currentLongitude;
  final DateTime? lastLocationUpdateAt;
  final String? accessCodeId;
  final int memberCount;

  const ProcessionGroup({
    required this.id,
    required this.eventId,
    required this.name,
    required this.leaderUserId,
    required this.status,
    this.currentLatitude,
    this.currentLongitude,
    this.lastLocationUpdateAt,
    this.accessCodeId,
    required this.memberCount,
  });

  factory ProcessionGroup.fromJson(Map<String, dynamic> json) {
    return ProcessionGroup(
      id: json['id'] as String? ?? '',
      eventId: json['eventId'] as String? ?? '',
      name: json['name'] as String? ?? '',
      leaderUserId: json['leaderUserId'] as String? ?? '',
      status: GroupStatusParser.fromJson(json['status']),
      currentLatitude: (json['currentLatitude'] as num?)?.toDouble(),
      currentLongitude: (json['currentLongitude'] as num?)?.toDouble(),
      lastLocationUpdateAt: _dateTimeFromJson(json['lastLocationUpdateAt']),
      accessCodeId: json['accessCodeId'] as String?,
      memberCount: (json['memberCount'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'eventId': eventId,
      'name': name,
      'leaderUserId': leaderUserId,
      'status': status.name,
      'currentLatitude': currentLatitude,
      'currentLongitude': currentLongitude,
      'lastLocationUpdateAt': lastLocationUpdateAt?.toIso8601String(),
      'accessCodeId': accessCodeId,
      'memberCount': memberCount,
    };
  }

  factory ProcessionGroup.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return ProcessionGroup.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'eventId': eventId,
      'name': name,
      'leaderUserId': leaderUserId,
      'status': status.name,
      'currentLatitude': currentLatitude,
      'currentLongitude': currentLongitude,
      'lastLocationUpdateAt': lastLocationUpdateAt == null
          ? null
          : Timestamp.fromDate(lastLocationUpdateAt!),
      'accessCodeId': accessCodeId,
      'memberCount': memberCount,
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