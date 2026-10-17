import 'package:cloud_firestore/cloud_firestore.dart';
import '../enums/stop_point_type.dart';

class StopPoint {
  final String id, routeId, name, description;
  final StopPointType type;
  final double latitude, longitude, geofenceRadiusMeters;
  final int order, plannedStopMinutes, maxAllowedGroups;
  final DateTime? expectedArrivalTime, expectedDepartureTime;

  const StopPoint({required this.id, required this.routeId, required this.name, required this.description,
    required this.type, required this.latitude, required this.longitude, required this.order,
    this.expectedArrivalTime, this.expectedDepartureTime, required this.plannedStopMinutes,
    this.geofenceRadiusMeters = 100, this.maxAllowedGroups = 1});

  factory StopPoint.fromJson(Map<String, dynamic> json) => StopPoint(
    id: json['id'] as String? ?? '', routeId: json['routeId'] as String? ?? '', name: json['name'] as String? ?? '',
    description: json['description'] as String? ?? '', type: StopPointTypeParser.fromJson(json['type']),
    latitude: (json['latitude'] as num?)?.toDouble() ?? 0, longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
    order: (json['order'] as num?)?.toInt() ?? 0, expectedArrivalTime: _date(json['expectedArrivalTime']),
    expectedDepartureTime: _date(json['expectedDepartureTime']), plannedStopMinutes: (json['plannedStopMinutes'] as num?)?.toInt() ?? 0,
    geofenceRadiusMeters: (json['geofenceRadiusMeters'] as num?)?.toDouble() ?? 100,
    maxAllowedGroups: (json['maxAllowedGroups'] as num?)?.toInt() ?? 1,
  );

  Map<String, dynamic> toJson() => {
    'id': id, 'routeId': routeId, 'name': name, 'description': description, 'type': type.name,
    'latitude': latitude, 'longitude': longitude, 'order': order,
    'expectedArrivalTime': expectedArrivalTime?.toIso8601String(),
    'expectedDepartureTime': expectedDepartureTime?.toIso8601String(),
    'plannedStopMinutes': plannedStopMinutes, 'geofenceRadiusMeters': geofenceRadiusMeters, 'maxAllowedGroups': maxAllowedGroups,
  };

  factory StopPoint.fromFirestore(DocumentSnapshot<Map<String, dynamic>> doc) => StopPoint.fromJson({...?doc.data(), 'id': doc.id});

  Map<String, dynamic> toFirestore() => {
    'routeId': routeId, 'name': name, 'description': description, 'type': type.name,
    'latitude': latitude, 'longitude': longitude, 'order': order,
    'expectedArrivalTime': expectedArrivalTime == null ? null : Timestamp.fromDate(expectedArrivalTime!),
    'expectedDepartureTime': expectedDepartureTime == null ? null : Timestamp.fromDate(expectedDepartureTime!),
    'plannedStopMinutes': plannedStopMinutes, 'geofenceRadiusMeters': geofenceRadiusMeters, 'maxAllowedGroups': maxAllowedGroups,
  };

  static DateTime? _date(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    return null;
  }
}