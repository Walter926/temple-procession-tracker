import 'package:cloud_firestore/cloud_firestore.dart';

class RouteSegment {
  final String id;
  final String routeId;
  final int order;
  final double startLatitude;
  final double startLongitude;
  final double endLatitude;
  final double endLongitude;
  final double distanceMeters;
  final String instruction;

  const RouteSegment({
    required this.id,
    required this.routeId,
    required this.order,
    required this.startLatitude,
    required this.startLongitude,
    required this.endLatitude,
    required this.endLongitude,
    required this.distanceMeters,
    required this.instruction,
  });

  factory RouteSegment.fromJson(Map<String, dynamic> json) {
    return RouteSegment(
      id: json['id'] as String? ?? '',
      routeId: json['routeId'] as String? ?? '',
      order: (json['order'] as num?)?.toInt() ?? 0,
      startLatitude: (json['startLatitude'] as num?)?.toDouble() ?? 0,
      startLongitude: (json['startLongitude'] as num?)?.toDouble() ?? 0,
      endLatitude: (json['endLatitude'] as num?)?.toDouble() ?? 0,
      endLongitude: (json['endLongitude'] as num?)?.toDouble() ?? 0,
      distanceMeters: (json['distanceMeters'] as num?)?.toDouble() ?? 0,
      instruction: json['instruction'] as String? ?? '',
          
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'routeId': routeId,
      'order': order,
      'startLatitude': startLatitude,
      'startLongitude': startLongitude,
      'endLatitude': endLatitude,
      'endLongitude': endLongitude,
      'distanceMeters': distanceMeters,
      'instruction': instruction,
    };
  }

  factory RouteSegment.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> document,
  ) {
    final data = document.data() ?? <String, dynamic>{};

    return RouteSegment.fromJson({
      ...data,
      'id': document.id,
    });
  }

  Map<String, dynamic> toFirestore() {
    return {
      'routeId': routeId,
      'order': order,
      'startLatitude': startLatitude,
      'startLongitude': startLongitude,
      'endLatitude': endLatitude,
      'endLongitude': endLongitude,
      'distanceMeters': distanceMeters,
      'instruction': instruction,
    };
  }
}