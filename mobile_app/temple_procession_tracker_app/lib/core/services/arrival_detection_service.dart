import '../models/location_update.dart';
import '../models/stop_point.dart';
import 'location_service.dart';

class ArrivalDetectionService {
  final LocationService _locationService;

  ArrivalDetectionService({
    LocationService? locationService,
  }) : _locationService = locationService ?? LocationService();

  bool isArrivedAtStopPoint({
    required LocationUpdate locationUpdate,
    required StopPoint stopPoint,
    double arrivalRadiusMeters = 50,
  }) {
    final distance = _locationService.distanceBetweenMeters(
      startLatitude: locationUpdate.latitude,
      startLongitude: locationUpdate.longitude,
      endLatitude: stopPoint.latitude,
      endLongitude: stopPoint.longitude,
    );

    return distance <= arrivalRadiusMeters;
  }

  StopPoint? nearestStopPoint({
    required LocationUpdate locationUpdate,
    required List<StopPoint> stopPoints,
  }) {
    if (stopPoints.isEmpty) {
      return null;
    }

    StopPoint? nearest;
    double? nearestDistance;

    for (final stopPoint in stopPoints) {
      final distance = _locationService.distanceBetweenMeters(
        startLatitude: locationUpdate.latitude,
        startLongitude: locationUpdate.longitude,
        endLatitude: stopPoint.latitude,
        endLongitude: stopPoint.longitude,
      );

      if (nearestDistance == null || distance < nearestDistance) {
        nearest = stopPoint;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  List<StopPoint> arrivedStopPoints({
    required LocationUpdate locationUpdate,
    required List<StopPoint> stopPoints,
    double arrivalRadiusMeters = 50,
  }) {
    return stopPoints.where((stopPoint) {
      return isArrivedAtStopPoint(
        locationUpdate: locationUpdate,
        stopPoint: stopPoint,
        arrivalRadiusMeters: arrivalRadiusMeters,
      );
    }).toList();
  }
}