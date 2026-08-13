import '../enums/event_status.dart';
import '../models/event.dart';
import '../repositories/event_repository.dart';

class EventService {
  final EventRepository _eventRepository;

  EventService({
    EventRepository? eventRepository,
  }) : _eventRepository = eventRepository ?? EventRepository();

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

  Future<void> updateEvent(Event event) async {
    await _eventRepository.update(
      _copyEvent(
        event,
        updatedAt: DateTime.now(),
      ),
    );
  }

  Future<void> activateEvent(Event event) async {
    await _eventRepository.update(
      _copyEvent(
        event,
        status: EventStatus.active,
        updatedAt: DateTime.now(),
      ),
    );
  }

  Future<void> pauseEvent(Event event) async {
    await _eventRepository.update(
      _copyEvent(
        event,
        status: EventStatus.paused,
        updatedAt: DateTime.now(),
      ),
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
    );
  }
}