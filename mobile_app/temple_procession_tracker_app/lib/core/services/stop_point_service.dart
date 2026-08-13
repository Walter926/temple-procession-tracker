import '../models/stop_point.dart';
import '../repositories/stop_point_repository.dart';

class StopPointService {
  final StopPointRepository _stopPointRepository;

  StopPointService({
    StopPointRepository? stopPointRepository,
  }) : _stopPointRepository = stopPointRepository ?? StopPointRepository();

  Future<void> createStopPoint(StopPoint stopPoint) async {
    await _stopPointRepository.create(stopPoint);
  }

  Future<StopPoint?> getStopPoint(String stopPointId) async {
    return _stopPointRepository.read(stopPointId);
  }

  Stream<StopPoint?> watchStopPoint(String stopPointId) {
    return _stopPointRepository.streamById(stopPointId);
  }

  Stream<List<StopPoint>> watchStopPointsForRoute(String routeId) {
    return _stopPointRepository.streamByRouteId(routeId);
  }

  Future<void> updateStopPoint(StopPoint stopPoint) async {
    await _stopPointRepository.update(stopPoint);
  }

  Future<void> updateStopPointOrder({
    required StopPoint stopPoint,
    required int newOrder,
  }) async {
    final updatedStopPoint = StopPoint(
      id: stopPoint.id,
      routeId: stopPoint.routeId,
      name: stopPoint.name,
      description: stopPoint.description,
      type: stopPoint.type,
      latitude: stopPoint.latitude,
      longitude: stopPoint.longitude,
      order: newOrder,
      expectedArrivalTime: stopPoint.expectedArrivalTime,
      plannedStopMinutes: stopPoint.plannedStopMinutes,
    );

    await _stopPointRepository.update(updatedStopPoint);
  }

  List<StopPoint> sortByOrder(List<StopPoint> stopPoints) {
    final sorted = [...stopPoints];
    sorted.sort((a, b) => a.order.compareTo(b.order));
    return sorted;
  }

  StopPoint? firstStopPoint(List<StopPoint> stopPoints) {
    final sorted = sortByOrder(stopPoints);

    if (sorted.isEmpty) {
      return null;
    }

    return sorted.first;
  }
}