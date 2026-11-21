import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:temple_procession_tracker_app/core/enums/event_status.dart';
import 'package:temple_procession_tracker_app/core/enums/group_status.dart';
import 'package:temple_procession_tracker_app/core/enums/stop_point_type.dart';
import 'package:temple_procession_tracker_app/core/models/event.dart';
import 'package:temple_procession_tracker_app/core/models/procession_group.dart';
import 'package:temple_procession_tracker_app/core/models/route_model.dart';
import 'package:temple_procession_tracker_app/core/models/stop_point.dart';
import 'package:temple_procession_tracker_app/core/services/event_management_service.dart';
import 'package:temple_procession_tracker_app/core/utils/polyline_decoder.dart';

StopPoint stop(
  String id,
  int order, {
  String routeId = 'route',
  double latitude = 13,
  double radius = 100,
}) => StopPoint(
  id: id,
  routeId: routeId,
  name: id,
  description: '',
  type: StopPointType.temple,
  latitude: latitude,
  longitude: 100,
  order: order,
  plannedStopMinutes: 1,
  geofenceRadiusMeters: radius,
);

void main() {
  final route = RouteModel(
    id: 'route',
    eventId: 'event',
    name: 'Path',
    description: '',
    totalDistanceMeters: 100,
    estimatedDurationMinutes: 10,
    segmentIds: [],
    stopPointIds: [],
    createdAt: DateTime(2026),
  );
  ProcessionGroup group({
    String eventId = 'event',
    String start = 'a',
    String end = 'b',
  }) => ProcessionGroup(
    id: 'group',
    eventId: eventId,
    name: 'Group',
    leaderUserId: '',
    status: GroupStatus.waiting,
    memberCount: 0,
    routeId: 'route',
    startingStopPointId: start,
    endingStopPointId: end,
  );
  test('route encoding matches standard known encoded polyline', () {
    const points = [
      LatLng(38.5, -120.2),
      LatLng(40.7, -120.95),
      LatLng(43.252, -126.453),
    ];
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    expect(EventManagementService.encodePoints(points), encoded);
    expect(PolylineDecoder.decode(encoded), points);
  });
  test('distance follows every segment, including a return leg', () {
    const a = LatLng(0, 0), b = LatLng(0, .001);
    expect(EventManagementService.distanceMeters([a, b]), closeTo(111.195, .1));
    expect(
      EventManagementService.distanceMeters([a, b, a]),
      closeTo(222.39, .1),
    );
    expect(EventManagementService.distanceMeters([a]), 0);
    expect(EventManagementService.distanceMeters([a, a]), 0);
  });
  test('distance handles the antimeridian as a short crossing', () {
    expect(
      EventManagementService.distanceMeters([
        const LatLng(0, 179.999),
        const LatLng(0, -179.999),
      ]),
      closeTo(222.39, .1),
    );
  });
  test(
    'duplicate stop order is rejected, editing its own order is allowed',
    () {
      expect(
        () =>
            EventManagementService.validateStop(stop('new', 1), [stop('a', 1)]),
        throwsArgumentError,
      );
      expect(
        () => EventManagementService.validateStop(stop('a', 1), [stop('a', 1)]),
        returnsNormally,
      );
    },
  );
  test('invalid coordinates and unsafe geofence sizes are rejected', () {
    for (final value in [
      stop('a', 0),
      stop('a', 1, latitude: double.nan),
      stop('a', 1, latitude: 91),
      stop('a', 1, radius: 0),
      stop('a', 1, radius: double.infinity),
      stop('a', 1, radius: 1001),
    ]) {
      expect(
        () => EventManagementService.validateStop(value, []),
        throwsArgumentError,
      );
    }
  });
  test('group start/end must be ordered and belong to its event route', () {
    expect(
      () => EventManagementService.validateGroup(group(), route, [
        stop('a', 1),
        stop('b', 2),
      ]),
      returnsNormally,
    );
    expect(
      () => EventManagementService.validateGroup(
        group(start: 'b', end: 'a'),
        route,
        [stop('a', 1), stop('b', 2)],
      ),
      throwsArgumentError,
    );
    expect(
      () => EventManagementService.validateGroup(
        group(eventId: 'other-event'),
        route,
        [stop('a', 1), stop('b', 2)],
      ),
      throwsArgumentError,
    );
    expect(
      () => EventManagementService.validateGroup(group(), route, [
        stop('a', 1, routeId: 'other'),
        stop('b', 2),
      ]),
      throwsArgumentError,
    );
    expect(
      () =>
          EventManagementService.validateGroup(group(), route, [stop('a', 1)]),
      throwsArgumentError,
    );
  });
  test('event end must follow its start', () {
    final event = Event(
      id: 'e',
      name: 'Procession',
      description: '',
      status: EventStatus.draft,
      startTime: DateTime(2026, 11, 17, 10),
      endTime: DateTime(2026, 11, 17, 9),
      organizerId: 'owner',
      isPublic: false,
      createdAt: DateTime(2026),
      mainTempleName: 'Temple',
      cityRegion: 'City',
    );
    expect(
      () => EventManagementService.validateEvent(event),
      throwsArgumentError,
    );
  });
}
