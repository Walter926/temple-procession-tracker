import '../models/route_model.dart';
import '../models/route_segment.dart';
import '../models/stop_point.dart';
import '../repositories/route_repository.dart';
import '../repositories/route_segment_repository.dart';
import '../repositories/stop_point_repository.dart';

class RouteService {
  final RouteRepository _routeRepository;
  final RouteSegmentRepository _routeSegmentRepository;
  final StopPointRepository _stopPointRepository;

  RouteService({
    RouteRepository? routeRepository,
    RouteSegmentRepository? routeSegmentRepository,
    StopPointRepository? stopPointRepository,
  })  : _routeRepository = routeRepository ?? RouteRepository(),
        _routeSegmentRepository =
            routeSegmentRepository ?? RouteSegmentRepository(),
        _stopPointRepository = stopPointRepository ?? StopPointRepository();

  Future<void> createRoute(RouteModel route) async {
    await _routeRepository.create(route);
  }

  Future<RouteModel?> getRoute(String routeId) async {
    return _routeRepository.read(routeId);
  }

  Stream<RouteModel?> watchRoute(String routeId) {
    return _routeRepository.streamById(routeId);
  }

  Stream<List<RouteModel>> watchRoutesForEvent(String eventId) {
    return _routeRepository.streamByEventId(eventId);
  }

  Stream<List<RouteSegment>> watchSegmentsForRoute(String routeId) {
    return _routeSegmentRepository.streamByRouteId(routeId);
  }

  Stream<List<StopPoint>> watchStopPointsForRoute(String routeId) {
    return _stopPointRepository.streamByRouteId(routeId);
  }

  Future<void> updateRoute(RouteModel route) async {
    final updatedRoute = RouteModel(
      id: route.id,
      eventId: route.eventId,
      name: route.name,
      description: route.description,
      totalDistanceMeters: route.totalDistanceMeters,
      estimatedDurationMinutes: route.estimatedDurationMinutes,
      segmentIds: route.segmentIds,
      stopPointIds: route.stopPointIds,
      createdAt: route.createdAt,
      updatedAt: DateTime.now(),
    );

    await _routeRepository.update(updatedRoute);
  }

  double calculateTotalSegmentDistance(List<RouteSegment> segments) {
    return segments.fold<double>(
      0,
      (total, segment) => total + segment.distanceMeters,
    );
  }
}