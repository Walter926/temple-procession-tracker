import 'package:cloud_firestore/cloud_firestore.dart';
import '../enums/event_status.dart';

class Event {
  final String id, name, description, organizerId, mainTempleName, cityRegion;
  final EventStatus status;
  final DateTime startTime, createdAt;
  final DateTime? endTime, updatedAt;
  final String? routeId;
  final bool isPublic;

  const Event({required this.id, required this.name, required this.description, required this.status, required this.startTime, this.endTime,
    required this.organizerId, this.routeId, required this.isPublic, required this.createdAt, this.updatedAt,
    this.mainTempleName = '', this.cityRegion = ''});

  factory Event.fromJson(Map<String, dynamic> json) => Event(
    id: json['id'] as String? ?? '', name: json['name'] as String? ?? '', description: json['description'] as String? ?? '',
    status: EventStatusParser.fromJson(json['status']), startTime: _date(json['startTime']) ?? DateTime.now(), endTime: _date(json['endTime']),
    organizerId: json['organizerId'] as String? ?? '', routeId: json['routeId'] as String?, isPublic: json['isPublic'] as bool? ?? false,
    mainTempleName: json['mainTempleName'] as String? ?? '', cityRegion: json['cityRegion'] as String? ?? '',
    createdAt: _date(json['createdAt']) ?? DateTime.now(), updatedAt: _date(json['updatedAt']),
  );

  Map<String, dynamic> toJson() => {
    'id': id, 'name': name, 'description': description, 'status': status.name,
    'startTime': startTime.toIso8601String(), 'endTime': endTime?.toIso8601String(),
    'organizerId': organizerId, 'routeId': routeId, 'isPublic': isPublic,
    'mainTempleName': mainTempleName, 'cityRegion': cityRegion,
    'createdAt': createdAt.toIso8601String(), 'updatedAt': updatedAt?.toIso8601String(),
  };

  factory Event.fromFirestore(DocumentSnapshot<Map<String, dynamic>> doc) => Event.fromJson({...?doc.data(), 'id': doc.id});

  Map<String, dynamic> toFirestore() => {
    'name': name, 'description': description, 'status': status.name,
    'startTime': Timestamp.fromDate(startTime), 'endTime': endTime == null ? null : Timestamp.fromDate(endTime!),
    'organizerId': organizerId, 'routeId': routeId, 'isPublic': isPublic,
    'mainTempleName': mainTempleName, 'cityRegion': cityRegion,
    'createdAt': Timestamp.fromDate(createdAt), 'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!),
  };

  static DateTime? _date(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    return null;
  }
}