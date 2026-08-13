import '../enums/alert_severity.dart';
import '../models/collision_alert.dart';
import '../models/procession_group.dart';
import '../repositories/alert_repository.dart';
import 'location_service.dart';

class CollisionRisk {
  final ProcessionGroup sourceGroup;
  final ProcessionGroup targetGroup;
  final double distanceMeters;

  const CollisionRisk({
    required this.sourceGroup,
    required this.targetGroup,
    required this.distanceMeters,
  });
}

class CollisionDetectionService {
  final LocationService _locationService;
  final AlertRepository _alertRepository;

  CollisionDetectionService({
    LocationService? locationService,
    AlertRepository? alertRepository,
  })  : _locationService = locationService ?? LocationService(),
        _alertRepository = alertRepository ?? AlertRepository();

  List<CollisionRisk> findCloseGroups({
    required List<ProcessionGroup> groups,
    double warningDistanceMeters = 75,
  }) {
    final risks = <CollisionRisk>[];

    for (var i = 0; i < groups.length; i++) {
      for (var j = i + 1; j < groups.length; j++) {
        final sourceGroup = groups[i];
        final targetGroup = groups[j];

        final sourceLatitude = sourceGroup.currentLatitude;
        final sourceLongitude = sourceGroup.currentLongitude;
        final targetLatitude = targetGroup.currentLatitude;
        final targetLongitude = targetGroup.currentLongitude;

        if (sourceLatitude == null ||
            sourceLongitude == null ||
            targetLatitude == null ||
            targetLongitude == null) {
          continue;
        }

        final distance = _locationService.distanceBetweenMeters(
          startLatitude: sourceLatitude,
          startLongitude: sourceLongitude,
          endLatitude: targetLatitude,
          endLongitude: targetLongitude,
        );

        if (distance <= warningDistanceMeters) {
          risks.add(
            CollisionRisk(
              sourceGroup: sourceGroup,
              targetGroup: targetGroup,
              distanceMeters: distance,
            ),
          );
        }
      }
    }

    return risks;
  }

  CollisionAlert buildCollisionAlert({
    required String eventId,
    required CollisionRisk risk,
  }) {
    final now = DateTime.now();

    final severity = risk.distanceMeters <= 30
        ? AlertSeverity.critical
        : AlertSeverity.warning;

    return CollisionAlert(
      id: '${risk.sourceGroup.id}_${risk.targetGroup.id}_${now.millisecondsSinceEpoch}',
      eventId: eventId,
      sourceGroupId: risk.sourceGroup.id,
      targetGroupId: risk.targetGroup.id,
      severity: severity,
      message:
          '${risk.sourceGroup.name} and ${risk.targetGroup.name} are close to each other.',
      distanceMeters: risk.distanceMeters,
      createdAt: now,
      isResolved: false,
    );
  }

  Future<void> saveAlert(CollisionAlert alert) async {
    await _alertRepository.create(alert);
  }

  Stream<List<CollisionAlert>> watchAlertsForEvent(String eventId) {
    return _alertRepository.streamByEventId(eventId);
  }
}