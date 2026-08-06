//  route_suggestion.dart

import 'package:cloud_firestore/cloud_firestore.dart';

class RouteSuggestion {
  final String id;
  final String eventId;
  final String groupId;
  final String reason;
  final List<String> suggestedRouteSegmentIds;
  final DateTime createdAt;
  final bool isAccepted;
  final String? acceptedByUserId;

  const RouteSuggestion({
    required this.id,
    required this.eventId,
    required this.groupId,
    required this.reason,
    required this.suggestedRouteSegmentIds,
    required this.createdAt,
    required this.isAccepted,
    this.acceptedByUserId,
  });

  factory RouteSuggestion.fromJson(Map<String, dynamic> json) {
    return RouteSuggestion(
      id: json['id'] as String? ?? '',
      eventId: json['eventId'] as String? ?? '',
      groupId: json['groupId'] as String? ?? '',
      reason: json['reason'] as String? ?? '',
      suggestedRouteSegmentIds: List<String>.from(
        json['suggestedRouteSegmentIds'] as List? ?? const [],
      ),
      createdAt: _dateTimeFromJson(json['createdAt']) ?? DateTime.now(),
      isAccepted: json['isAccepted'] as bool? ?? false,
      acceptedByUserId: json['acceptedByUserId'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'eventId': eventId,
      'groupId': groupId,
      'reason': reason,
      'suggestedRouteSegmentIds': suggestedRouteSegmentIds,
      'createdAt': createdAt.toIso8601String(),
      'isAccepted': isAccepted,
      'acceptedByUserId': acceptedByUserId,
    };
  }

  factory RouteSuggestion.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return RouteSuggestion.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'eventId': eventId,
      'groupId': groupId,
      'reason': reason,
      'suggestedRouteSegmentIds': suggestedRouteSegmentIds,
      'createdAt': Timestamp.fromDate(createdAt),
      'isAccepted': isAccepted,
      'acceptedByUserId': acceptedByUserId,
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