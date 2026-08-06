import 'package:cloud_firestore/cloud_firestore.dart';

class RouteModel {
  final String id;
  final String eventId;
  final String name;
  final String description;
  final double totalDistanceMeters;
  final int estimatedDurationMinutes;
  final List<String> segmentIds;
  final List<String> stopPointIds;
  final DateTime createdAt;
  final DateTime? updatedAt;

  const RouteModel({
    required this.id,
    required this.eventId,
    required this.name,
    required this.description,
    required this.totalDistanceMeters,
    required this.estimatedDurationMinutes,
    required this.segmentIds,
    required this.stopPointIds,
    required this.createdAt,
    this.updatedAt,
  });

  factory RouteModel.fromJson(Map<String, dynamic> json) {
    return RouteModel(
      id: json['id'] as String? ?? '',
      eventId: json['eventId'] as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      totalDistanceMeters:
          (json['totalDistanceMeters'] as num?)?.toDouble() ?? 0,
      estimatedDurationMinutes:
          (json['estimatedDurationMinutes'] as num?)?.toInt() ?? 0,
      segmentIds: List<String>.from(json['segmentIds'] as List? ?? const []),
      stopPointIds:
          List<String>.from(json['stopPointIds'] as List? ?? const []),
      createdAt: _dateTimeFromJson(json['createdAt']) ?? DateTime.now(),
      updatedAt: _dateTimeFromJson(json['updatedAt']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'eventId': eventId,
      'name': name,
      'description': description,
      'totalDistanceMeters': totalDistanceMeters,
      'estimatedDurationMinutes': estimatedDurationMinutes,
      'segmentIds': segmentIds,
      'stopPointIds': stopPointIds,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt?.toIso8601String(),
    };
  }

  factory RouteModel.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return RouteModel.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'eventId': eventId,
      'name': name,
      'description': description,
      'totalDistanceMeters': totalDistanceMeters,
      'estimatedDurationMinutes': estimatedDurationMinutes,
      'segmentIds': segmentIds,
      'stopPointIds': stopPointIds,
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