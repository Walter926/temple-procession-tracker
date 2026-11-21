import 'dart:math' as math;
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../enums/event_status.dart';
import '../models/event.dart';
import '../models/procession_group.dart';
import '../models/route_model.dart';
import '../models/stop_point.dart';
import '../models/user_profile.dart';
import '../utils/role_access.dart';

/// Mobile management uses the same records/rules as the dashboard. Sensitive
/// assignment/deletion operations are callable-only; no client membership writes.
class AssignableLeaderPage {
  final List<UserProfile> users;
  final String? nextCursor;
  const AssignableLeaderPage(this.users, this.nextCursor);
}

class EventManagementService {
  final FirebaseFirestore _db;
  final FirebaseFunctions _functions;
  EventManagementService({
    FirebaseFirestore? firestore,
    FirebaseFunctions? functions,
  }) : _db = firestore ?? FirebaseFirestore.instance,
       _functions =
           functions ?? FirebaseFunctions.instanceFor(region: 'us-central1');

  String newId(String collection) => _db.collection(collection).doc().id;
  Stream<List<RouteModel>> watchRoutes(String eventId) => _db
      .collection('routes')
      .where('eventId', isEqualTo: eventId)
      .limit(100)
      .snapshots()
      .map((s) => s.docs.map(RouteModel.fromFirestore).toList());
  Stream<List<StopPoint>> watchStops(String routeId) => _db
      .collection('stopPoints')
      .where('routeId', isEqualTo: routeId)
      .limit(400)
      .snapshots()
      .map(
        (s) =>
            s.docs.map(StopPoint.fromFirestore).toList()
              ..sort((a, b) => a.order.compareTo(b.order)),
      );
  Stream<List<ProcessionGroup>> watchGroups(String eventId) => _db
      .collection('groups')
      .where('eventId', isEqualTo: eventId)
      .limit(100)
      .snapshots()
      .map((s) => s.docs.map(ProcessionGroup.fromFirestore).toList());

  static void validateEvent(Event event) {
    if (event.name.trim().isEmpty ||
        event.name.length > 120 ||
        event.description.length > 4000 ||
        event.mainTempleName.trim().isEmpty ||
        event.cityRegion.trim().isEmpty) {
      throw ArgumentError(
        'Enter a name (up to 120 characters), temple, and city/region.',
      );
    }
    if (event.endTime != null && !event.endTime!.isAfter(event.startTime)) {
      throw ArgumentError('End time must be after start time.');
    }
  }

  static void validateStop(StopPoint stop, Iterable<StopPoint> others) {
    if (stop.name.trim().isEmpty ||
        !stop.latitude.isFinite ||
        !stop.longitude.isFinite ||
        stop.latitude.abs() > 90 ||
        stop.longitude.abs() > 180 ||
        stop.order < 1 ||
        !stop.geofenceRadiusMeters.isFinite ||
        stop.geofenceRadiusMeters < 5 ||
        stop.geofenceRadiusMeters > 1000 ||
        stop.maxAllowedGroups < 1 ||
        stop.plannedStopMinutes < 0) {
      throw ArgumentError(
        'Enter valid coordinates, order, group capacity, dwell time, and a geofence of 5–1000 m.',
      );
    }
    if (others.any((s) => s.id != stop.id && s.order == stop.order)) {
      throw ArgumentError('Stop order must be unique.');
    }
    if (stop.expectedArrivalTime != null &&
        stop.expectedDepartureTime != null &&
        stop.expectedDepartureTime!.isBefore(stop.expectedArrivalTime!)) {
      throw ArgumentError('Departure must follow arrival.');
    }
  }

  static void validateGroup(
    ProcessionGroup group,
    RouteModel route,
    Iterable<StopPoint> stops,
  ) {
    final byId = {for (final stop in stops) stop.id: stop};
    final start = byId[group.startingStopPointId],
        end = byId[group.endingStopPointId];
    if (group.name.trim().isEmpty ||
        group.eventId != route.eventId ||
        group.routeId != route.id ||
        start == null ||
        end == null ||
        start.routeId != route.id ||
        end.routeId != route.id ||
        start.order >= end.order) {
      throw ArgumentError(
        'Choose a name, route in this event, and ordered start/end stops on that route.',
      );
    }
  }

  Future<String> _mutate(
    String operation,
    String resource,
    String eventId, {
    String? id,
    Map<String, dynamic>? data,
  }) async {
    final result = await _functions
        .httpsCallable('manageEvent')
        .call<Map<String, dynamic>>({
          'operation': operation,
          'resource': resource,
          'eventId': eventId,
          'id': ?id,
          'data': ?data,
        });
    return result.data['id'] as String? ?? id ?? eventId;
  }

  Future<void> saveEvent(
    Event event,
    UserProfile profile, {
    required bool creating,
  }) async {
    validateEvent(event);
    if (!profile.isActive ||
        !RoleAccess.canManageEvent(
          profile.role,
          profile.id,
          event.organizerId,
        )) {
      throw StateError('You cannot manage this event.');
    }
    await _mutate(
      creating ? 'create' : 'update',
      'event',
      creating ? '' : event.id,
      id: event.id,
      data: {
        'name': event.name.trim(),
        'description': event.description.trim(),
        'mainTempleName': event.mainTempleName.trim(),
        'cityRegion': event.cityRegion.trim(),
        'isPublic': event.isPublic,
        'startTimeMs': event.startTime.millisecondsSinceEpoch,
        'endTimeMs': event.endTime?.millisecondsSinceEpoch,
        if (creating) 'status': EventStatus.draft.name,
      },
    );
  }

  Future<void> setStatus(
    String eventId,
    EventStatus status,
    UserProfile profile,
  ) async {
    await _mutate(
      'update',
      'event',
      eventId,
      id: eventId,
      data: {'status': status.name},
    );
  }

  Future<void> setPrimaryRoute(
    String eventId,
    String routeId,
    UserProfile profile,
  ) async {
    await _mutate(
      'update',
      'event',
      eventId,
      id: eventId,
      data: {'routeId': routeId},
    );
  }

  Future<void> saveRoute(
    RouteModel route,
    UserProfile profile, {
    required bool creating,
  }) async {
    if (route.name.trim().isEmpty ||
        route.encodedPolyline.isEmpty ||
        !route.totalDistanceMeters.isFinite ||
        route.totalDistanceMeters <= 0 ||
        route.estimatedDurationMinutes < 0) {
      throw ArgumentError(
        'Name the route and draw at least two distinct points.',
      );
    }
    await _mutate(
      creating ? 'create' : 'update',
      'route',
      route.eventId,
      id: route.id,
      data: {
        'name': route.name.trim(),
        'description': route.description.trim(),
        'color': route.color,
        'encodedPolyline': route.encodedPolyline,
        'totalDistanceMeters': route.totalDistanceMeters,
        'estimatedDurationMinutes': route.estimatedDurationMinutes,
      },
    );
  }

  Future<void> saveStop(
    String eventId,
    StopPoint stop,
    UserProfile profile, {
    required bool creating,
  }) async {
    validateStop(stop, const []);
    await _mutate(
      creating ? 'create' : 'update',
      'stop',
      eventId,
      id: stop.id,
      data: {
        'routeId': stop.routeId,
        'name': stop.name.trim(),
        'description': stop.description.trim(),
        'type': stop.type.name,
        'latitude': stop.latitude,
        'longitude': stop.longitude,
        'order': stop.order,
        'plannedStopMinutes': stop.plannedStopMinutes,
        'geofenceRadiusMeters': stop.geofenceRadiusMeters,
        'maxAllowedGroups': stop.maxAllowedGroups,
        'expectedArrivalTimeMs':
            stop.expectedArrivalTime?.millisecondsSinceEpoch,
        'expectedDepartureTimeMs':
            stop.expectedDepartureTime?.millisecondsSinceEpoch,
      },
    );
  }

  Future<void> saveGroup(
    ProcessionGroup group,
    UserProfile profile, {
    required bool creating,
  }) async {
    await _mutate(
      creating ? 'create' : 'update',
      'group',
      group.eventId,
      id: group.id,
      data: {
        'name': group.name.trim(),
        'color': group.color,
        'routeId': group.routeId,
        'startingStopPointId': group.startingStopPointId,
        'endingStopPointId': group.endingStopPointId,
        if (creating) 'status': 'waiting',
      },
    );
  }

  Future<AssignableLeaderPage> listAssignableLeaders(
    String eventId,
    String groupId, {
    String? cursor,
  }) async {
    final result = await _functions
        .httpsCallable('listAssignableLeaders')
        .call<Map<String, dynamic>>({
          'eventId': eventId,
          'groupId': groupId,
          'cursor': ?cursor,
        });
    final users = (result.data['users'] as List? ?? [])
        .map(
          (data) =>
              UserProfile.fromJson(Map<String, dynamic>.from(data as Map)),
        )
        .toList();
    return AssignableLeaderPage(users, result.data['nextCursor'] as String?);
  }

  Future<void> assignLeaders(
    String groupId,
    String primaryId,
    String backupId,
  ) async {
    await _functions.httpsCallable('assignGroupLeader').call({
      'groupId': groupId,
      'leaderUserId': primaryId.trim(),
      'backupLeaderUserId': backupId.trim(),
    });
  }

  Future<void> deleteRecord(
    String collection,
    String id,
    String eventId,
  ) async {
    const resources = {
      'events': 'event',
      'routes': 'route',
      'stopPoints': 'stop',
      'groups': 'group',
      'routeSegments': 'segment',
    };
    final resource = resources[collection];
    if (resource == null) throw ArgumentError('Unsupported management record.');
    await _mutate('delete', resource, eventId, id: id);
  }

  static String encodePoints(List<LatLng> points) {
    var previousLat = 0, previousLng = 0;
    final out = StringBuffer();
    void delta(int value) {
      var encoded = value < 0 ? ~(value << 1) : value << 1;
      while (encoded >= 32) {
        out.writeCharCode((32 | (encoded & 31)) + 63);
        encoded >>= 5;
      }
      out.writeCharCode(encoded + 63);
    }

    for (final point in points) {
      final lat = (point.latitude * 1e5).round(),
          lng = (point.longitude * 1e5).round();
      delta(lat - previousLat);
      delta(lng - previousLng);
      previousLat = lat;
      previousLng = lng;
    }
    return out.toString();
  }

  static double distanceMeters(List<LatLng> points) {
    const radians = math.pi / 180;
    var total = 0.0;
    for (var index = 1; index < points.length; index++) {
      final a = points[index - 1], b = points[index];
      final x =
          math.pow(math.sin((b.latitude - a.latitude) * radians / 2), 2) +
          math.cos(a.latitude * radians) *
              math.cos(b.latitude * radians) *
              math.pow(math.sin((b.longitude - a.longitude) * radians / 2), 2);
      total +=
          6371000 *
          2 *
          math.atan2(math.sqrt(x.clamp(0, 1)), math.sqrt(1 - x.clamp(0, 1)));
    }
    return total;
  }
}
