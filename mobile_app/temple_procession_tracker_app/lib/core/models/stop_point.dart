import 'package:cloud_firestore/cloud_firestore.dart';

import '../enums/stop_point_type.dart';

class StopPoint {
  final String id;
  final String routeId;
  final String name;
  final String description;
  final StopPointType type;
  final double latitude;
  final double longitude;
  final int order;
  final DateTime? expectedArrivalTime;
  final int plannedStopMinutes;

  const StopPoint({
    required this.id,
    required this.routeId,
    required this.name,
    required this.description,
    required this.type,
    required this.latitude,
    required this.longitude,
    required this.order,
    this.expectedArrivalTime,
    required this.plannedStopMinutes,
  });

  factory StopPoint.fromJson(Map<String, dynamic> json) {
    return StopPoint(
      id: json['id'] as String? ?? '',
      routeId: json['routeId'] as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      type: StopPointTypeParser.fromJson(json['type']),
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      order: (json['order'] as num?)?.toInt() ?? 0,
      expectedArrivalTime: _dateTimeFromJson(json['expectedArrivalTime']),
      plannedStopMinutes: (json['plannedStopMinutes'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'routeId': routeId,
      'name': name,
      'description': description,
      'type': type.name,
      'latitude': latitude,
      'longitude': longitude,
      'order': order,
      'expectedArrivalTime': expectedArrivalTime?.toIso8601String(),
      'plannedStopMinutes': plannedStopMinutes,
    };
  }

  factory StopPoint.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return StopPoint.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'routeId': routeId,
      'name': name,
      'description': description,
      'type': type.name,
      'latitude': latitude,
      'longitude': longitude,
      'order': order,
      'expectedArrivalTime': expectedArrivalTime == null
          ? null
          : Timestamp.fromDate(expectedArrivalTime!),
      'plannedStopMinutes': plannedStopMinutes,
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