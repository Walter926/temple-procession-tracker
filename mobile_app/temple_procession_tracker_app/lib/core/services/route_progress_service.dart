import '../models/location_update.dart';
import '../models/stop_point.dart';
import 'arrival_detection_service.dart';

class RouteProgressService {
  final ArrivalDetectionService _arrivalDetectionService;

  RouteProgressService({
    ArrivalDetectionService? arrivalDetectionService,
  }) : _arrivalDetectionService =
            arrivalDetectionService ?? ArrivalDetectionService();

  int countArrivedStopPoints({
    required LocationUpdate locationUpdate,
    required List<StopPoint> stopPoints,
    double arrivalRadiusMeters = 50,
  }) {
    return _arrivalDetectionService
        .arrivedStopPoints(
          locationUpdate: locationUpdate,
          stopPoints: stopPoints,
          arrivalRadiusMeters: arrivalRadiusMeters,
        )
        .length;
  }

  double progressByStopPoints({
    required LocationUpdate locationUpdate,
    required List<StopPoint> stopPoints,
    double arrivalRadiusMeters = 50,
  }) {
    if (stopPoints.isEmpty) {
      return 0;
    }

    final arrivedCount = countArrivedStopPoints(
      locationUpdate: locationUpdate,
      stopPoints: stopPoints,
      arrivalRadiusMeters: arrivalRadiusMeters,
    );

    return arrivedCount / stopPoints.length;
  }

  StopPoint? nearestStopPoint({
    required LocationUpdate locationUpdate,
    required List<StopPoint> stopPoints,
  }) {
    return _arrivalDetectionService.nearestStopPoint(
      locationUpdate: locationUpdate,
      stopPoints: stopPoints,
    );
  }

  StopPoint? nextStopPointByOrder({
    required int currentOrder,
    required List<StopPoint> stopPoints,
  }) {
    final futureStops = stopPoints
        .where((stopPoint) => stopPoint.order > currentOrder)
        .toList();

    futureStops.sort((a, b) => a.order.compareTo(b.order));

    if (futureStops.isEmpty) {
      return null;
    }

    return futureStops.first;
  }
}