import 'package:geolocator/geolocator.dart';

import '../models/location_update.dart';
import '../repositories/location_repository.dart';

class LocationService {
  final LocationRepository _locationRepository;

  LocationService({
    LocationRepository? locationRepository,
  }) : _locationRepository = locationRepository ?? LocationRepository();

  Future<bool> isLocationServiceEnabled() async {
    return Geolocator.isLocationServiceEnabled();
  }

  Future<Position> getCurrentPosition() async {
    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
      ),
    );
  }

  LocationUpdate buildLocationUpdate({
    required String eventId,
    required String groupId,
    required String userId,
    required Position position,
    int? batteryLevel,
  }) {
    final now = DateTime.now();

    return LocationUpdate(
      id: '${groupId}_${now.millisecondsSinceEpoch}',
      eventId: eventId,
      groupId: groupId,
      userId: userId,
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyMeters: position.accuracy,
      speedMetersPerSecond: position.speed,
      headingDegrees: position.heading,
      recordedAt: now,
      batteryLevel: batteryLevel,
    );
  }

  Future<void> saveLocationUpdate(LocationUpdate locationUpdate) async {
    await _locationRepository.create(locationUpdate);
  }

  Stream<List<LocationUpdate>> watchLocationsForGroup(String groupId) {
    return _locationRepository.streamByGroupId(groupId);
  }

  Stream<List<LocationUpdate>> watchLocationsForEvent(String eventId) {
    return _locationRepository.streamByEventId(eventId);
  }

  double distanceBetweenMeters({
    required double startLatitude,
    required double startLongitude,
    required double endLatitude,
    required double endLongitude,
  }) {
    return Geolocator.distanceBetween(
      startLatitude,
      startLongitude,
      endLatitude,
      endLongitude,
    );
  }
}