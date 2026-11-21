import 'dart:async';
import '../enums/event_status.dart';
import '../models/event.dart';
import '../repositories/event_repository.dart';
import '../enums/user_role.dart';
import '../models/user_profile.dart';
import 'membership_service.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class EventService {
  final EventRepository _eventRepository;

  EventService({EventRepository? eventRepository})
    : _eventRepository = eventRepository ?? EventRepository();

  Future<void> createEvent(Event event) async {
    await _eventRepository.create(event);
  }

  Future<Event?> getEvent(String eventId) async {
    return _eventRepository.read(eventId);
  }

  Stream<Event?> watchEvent(String eventId) {
    return _eventRepository.streamById(eventId);
  }

  Stream<List<Event>> watchAllEvents() {
    return _eventRepository.streamAll();
  }

  Stream<List<Event>> watchForProfile(UserProfile profile) {
    if (!profile.isActive) return Stream.value([]);
    if (profile.role == UserRole.admin) return _eventRepository.streamAll();
    if (profile.role == UserRole.organizer) {
      return _eventRepository.streamByOrganizer(profile.id);
    }
    late final StreamController<List<Event>> output;
    StreamSubscription<List<Membership>>? memberships;
    StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? assignment;
    final subscriptions = <String, StreamSubscription<Event?>>{};
    final events = <String, Event>{};
    final loaded = <String>{};
    var joinedIds = <String>{};
    String? assignedEventId;
    var membershipReady = false;
    final hasAssignment =
        profile.role == UserRole.teamLeader &&
        profile.assignedGroupId.isNotEmpty;
    var assignmentReady = !hasAssignment;
    var cancelled = false;
    void publish() {
      if (!cancelled &&
          membershipReady &&
          assignmentReady &&
          loaded.containsAll(subscriptions.keys)) {
        output.add(
          events.values.toList()
            ..sort((a, b) => a.startTime.compareTo(b.startTime)),
        );
      }
    }

    void reconcile() {
      if (cancelled || !membershipReady || !assignmentReady) return;
      final wanted = {
        ...joinedIds,
        if (assignedEventId != null) assignedEventId!,
      };
      for (final id
          in subscriptions.keys.where((id) => !wanted.contains(id)).toList()) {
        unawaited(subscriptions.remove(id)!.cancel());
        events.remove(id);
        loaded.remove(id);
      }
      for (final id in wanted.where((id) => !subscriptions.containsKey(id))) {
        subscriptions[id] = _eventRepository
            .streamById(id)
            .listen(
              (event) {
                if (cancelled || !subscriptions.containsKey(id)) return;
                loaded.add(id);
                if (event == null) {
                  events.remove(id);
                } else {
                  events[id] = event;
                }
                publish();
              },
              onError: (Object error, StackTrace stack) {
                if (!cancelled) output.addError(error, stack);
              },
            );
      }
      publish();
    }

    output = StreamController<List<Event>>(
      onListen: () {
        memberships = MembershipService().watchOwn(profile.id).listen((items) {
          joinedIds = items
              .map((m) => m.eventId)
              .where((id) => id.isNotEmpty)
              .toSet();
          membershipReady = true;
          reconcile();
        }, onError: output.addError);
        if (hasAssignment) {
          assignment = FirebaseFirestore.instance
              .doc('groups/${profile.assignedGroupId}')
              .snapshots()
              .listen((group) {
                final data = group.data();
                assignedEventId =
                    data?['leaderUserId'] == profile.id ||
                        data?['backupLeaderUserId'] == profile.id
                    ? (data?['eventId'] as String?)
                    : null;
                assignmentReady = true;
                reconcile();
              }, onError: output.addError);
        }
      },
      onCancel: () async {
        cancelled = true;
        await memberships?.cancel();
        await assignment?.cancel();
        await Future.wait(subscriptions.values.map((s) => s.cancel()));
      },
    );
    return output.stream;
  }

  Future<void> updateEvent(Event event) async {
    await _eventRepository.update(_copyEvent(event, updatedAt: DateTime.now()));
  }

  Future<void> activateEvent(Event event) async {
    await _eventRepository.update(
      _copyEvent(event, status: EventStatus.active, updatedAt: DateTime.now()),
    );
  }

  Future<void> pauseEvent(Event event) async {
    await _eventRepository.update(
      _copyEvent(event, status: EventStatus.paused, updatedAt: DateTime.now()),
    );
  }

  Future<void> completeEvent(Event event) async {
    await _eventRepository.update(
      _copyEvent(
        event,
        status: EventStatus.completed,
        endTime: DateTime.now(),
        updatedAt: DateTime.now(),
      ),
    );
  }

  Future<void> cancelEvent(Event event) async {
    await _eventRepository.update(
      _copyEvent(
        event,
        status: EventStatus.cancelled,
        updatedAt: DateTime.now(),
      ),
    );
  }

  bool isLive(Event event) {
    return event.status == EventStatus.active;
  }

  Event _copyEvent(
    Event event, {
    EventStatus? status,
    DateTime? endTime,
    DateTime? updatedAt,
  }) {
    return Event(
      id: event.id,
      name: event.name,
      description: event.description,
      status: status ?? event.status,
      startTime: event.startTime,
      endTime: endTime ?? event.endTime,
      organizerId: event.organizerId,
      routeId: event.routeId,
      isPublic: event.isPublic,
      createdAt: event.createdAt,
      updatedAt: updatedAt ?? event.updatedAt,
      mainTempleName: event.mainTempleName,
      cityRegion: event.cityRegion,
    );
  }
}
