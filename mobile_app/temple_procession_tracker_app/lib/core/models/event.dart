import 'package:cloud_firestore/cloud_firestore.dart';

import '../enums/event_status.dart';

class Event {
  final String id;
  final String name;
  final String description;
  final EventStatus status;
  final DateTime startTime;
  final DateTime? endTime;
  final String organizerId;
  final String? routeId;
  final bool isPublic;
  final DateTime createdAt;
  final DateTime? updatedAt;

  const Event({
    required this.id,
    required this.name,
    required this.description,
    required this.status,
    required this.startTime,
    this.endTime,
    required this.organizerId,
    this.routeId,
    required this.isPublic,
    required this.createdAt,
    this.updatedAt,
  });

  factory Event.fromJson(Map<String, dynamic> json) {
    return Event(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      status: EventStatusParser.fromJson(json['status']),
      startTime: _dateTimeFromJson(json['startTime']) ?? DateTime.now(),
      endTime: _dateTimeFromJson(json['endTime']),
      organizerId: json['organizerId'] as String? ?? '',
      routeId: json['routeId'] as String?,
      isPublic: json['isPublic'] as bool? ?? true,
      createdAt: _dateTimeFromJson(json['createdAt']) ?? DateTime.now(),
      updatedAt: _dateTimeFromJson(json['updatedAt']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'status': status.name,
      'startTime': startTime.toIso8601String(),
      'endTime': endTime?.toIso8601String(),
      'organizerId': organizerId,
      'routeId': routeId,
      'isPublic': isPublic,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt?.toIso8601String(),
    };
  }

  factory Event.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return Event.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      'description': description,
      'status': status.name,
      'startTime': Timestamp.fromDate(startTime),
      'endTime': endTime == null ? null : Timestamp.fromDate(endTime!),
      'organizerId': organizerId,
      'routeId': routeId,
      'isPublic': isPublic,
      'createdAt': Timestamp.fromDate(createdAt),
      'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
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