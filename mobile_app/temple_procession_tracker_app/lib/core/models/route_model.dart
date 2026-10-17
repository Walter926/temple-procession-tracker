import 'package:cloud_firestore/cloud_firestore.dart';

class RouteModel {
  final String id, eventId, name, description, color, encodedPolyline;
  final double totalDistanceMeters;
  final int estimatedDurationMinutes;
  final List<String> segmentIds, stopPointIds;
  final DateTime createdAt;
  final DateTime? updatedAt;

  const RouteModel({required this.id, required this.eventId, required this.name, required this.description,
    this.color = '#a33b3b', this.encodedPolyline = '', required this.totalDistanceMeters,
    required this.estimatedDurationMinutes, required this.segmentIds, required this.stopPointIds,
    required this.createdAt, this.updatedAt});

  factory RouteModel.fromJson(Map<String, dynamic> json) => RouteModel(
    id: json['id'] as String? ?? '', eventId: json['eventId'] as String? ?? '', name: json['name'] as String? ?? '',
    description: json['description'] as String? ?? '', color: json['color'] as String? ?? '#a33b3b',
    encodedPolyline: json['encodedPolyline'] as String? ?? '', totalDistanceMeters: (json['totalDistanceMeters'] as num?)?.toDouble() ?? 0,
    estimatedDurationMinutes: (json['estimatedDurationMinutes'] as num?)?.toInt() ?? 0,
    segmentIds: List<String>.from(json['segmentIds'] as List? ?? const []), stopPointIds: List<String>.from(json['stopPointIds'] as List? ?? const []),
    createdAt: _date(json['createdAt']) ?? DateTime.now(), updatedAt: _date(json['updatedAt']),
  );

  Map<String, dynamic> toJson() => {
    'id': id, 'eventId': eventId, 'name': name, 'description': description, 'color': color,
    'encodedPolyline': encodedPolyline, 'totalDistanceMeters': totalDistanceMeters,
    'estimatedDurationMinutes': estimatedDurationMinutes, 'segmentIds': segmentIds, 'stopPointIds': stopPointIds,
    'createdAt': createdAt.toIso8601String(), 'updatedAt': updatedAt?.toIso8601String(),
  };

  factory RouteModel.fromFirestore(DocumentSnapshot<Map<String, dynamic>> doc) => RouteModel.fromJson({...?doc.data(), 'id': doc.id});

  Map<String, dynamic> toFirestore() => {
    'eventId': eventId, 'name': name, 'description': description, 'color': color, 'encodedPolyline': encodedPolyline,
    'totalDistanceMeters': totalDistanceMeters, 'estimatedDurationMinutes': estimatedDurationMinutes,
    'segmentIds': segmentIds, 'stopPointIds': stopPointIds,
    'createdAt': Timestamp.fromDate(createdAt), 'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
  };

  static DateTime? _date(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    return null;
  }
}