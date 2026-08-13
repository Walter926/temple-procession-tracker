import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../models/procession_group.dart';
import '../models/route_segment.dart';
import '../models/stop_point.dart';

class MapService {
  LatLng toLatLng({
    required double latitude,
    required double longitude,
  }) {
    return LatLng(latitude, longitude);
  }

  LatLng? groupLatLng(ProcessionGroup group) {
    final latitude = group.currentLatitude;
    final longitude = group.currentLongitude;

    if (latitude == null || longitude == null) {
      return null;
    }

    return LatLng(latitude, longitude);
  }

  LatLng stopPointLatLng(StopPoint stopPoint) {
    return LatLng(stopPoint.latitude, stopPoint.longitude);
  }

  List<LatLng> routeSegmentsToPolylinePoints(List<RouteSegment> segments) {
    final sortedSegments = [...segments];
    sortedSegments.sort((a, b) => a.order.compareTo(b.order));

    final points = <LatLng>[];

    for (final segment in sortedSegments) {
      if (points.isEmpty) {
        points.add(
          LatLng(segment.startLatitude, segment.startLongitude),
        );
      }

      points.add(
        LatLng(segment.endLatitude, segment.endLongitude),
      );
    }

    return points;
  }

  String groupMarkerId(ProcessionGroup group) {
    return 'group_${group.id}';
  }

  String stopPointMarkerId(StopPoint stopPoint) {
    return 'stop_point_${stopPoint.id}';
  }
}