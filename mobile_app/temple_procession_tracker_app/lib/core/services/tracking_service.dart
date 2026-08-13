import '../models/location_update.dart';
import '../models/procession_group.dart';
import '../models/tracking_session.dart';
import 'group_service.dart';
import 'location_service.dart';

class TrackingService {
  final LocationService _locationService;
  final GroupService _groupService;

  TrackingService({
    LocationService? locationService,
    GroupService? groupService,
  })  : _locationService = locationService ?? LocationService(),
        _groupService = groupService ?? GroupService();

  TrackingSession startSession({
    required String eventId,
    required String groupId,
    required String leaderUserId,
  }) {
    final now = DateTime.now();

    return TrackingSession(
      id: '${groupId}_${now.millisecondsSinceEpoch}',
      eventId: eventId,
      groupId: groupId,
      leaderUserId: leaderUserId,
      startedAt: now,
      isActive: true,
      totalDistanceMeters: 0,
      totalUpdates: 0,
    );
  }

  TrackingSession endSession({
    required TrackingSession session,
    required double totalDistanceMeters,
    required int totalUpdates,
  }) {
    return TrackingSession(
      id: session.id,
      eventId: session.eventId,
      groupId: session.groupId,
      leaderUserId: session.leaderUserId,
      startedAt: session.startedAt,
      endedAt: DateTime.now(),
      isActive: false,
      totalDistanceMeters: totalDistanceMeters,
      totalUpdates: totalUpdates,
    );
  }

  Future<LocationUpdate> recordTrackingPoint({
    required ProcessionGroup group,
    required String userId,
    int? batteryLevel,
  }) async {
    final position = await _locationService.getCurrentPosition();

    final locationUpdate = _locationService.buildLocationUpdate(
      eventId: group.eventId,
      groupId: group.id,
      userId: userId,
      position: position,
      batteryLevel: batteryLevel,
    );

    await _locationService.saveLocationUpdate(locationUpdate);

    await _groupService.updateCurrentLocation(
      group: group,
      latitude: locationUpdate.latitude,
      longitude: locationUpdate.longitude,
    );

    return locationUpdate;
  }

  bool shouldSendLocationUpdate({
    required DateTime? lastSentAt,
    Duration minimumInterval = const Duration(seconds: 10),
  }) {
    if (lastSentAt == null) {
      return true;
    }

    return DateTime.now().difference(lastSentAt) >= minimumInterval;
  }
}
