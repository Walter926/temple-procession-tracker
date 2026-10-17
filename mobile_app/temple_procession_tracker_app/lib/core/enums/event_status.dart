enum EventStatus { draft, scheduled, active, paused, completed, cancelled, archived }

extension EventStatusValue on EventStatus {
  String get value => name;
}

class EventStatusParser {
  static EventStatus fromJson(Object? value) {
    final String? text = value?.toString();
    return EventStatus.values.firstWhere((status) => status.name == text, orElse: () => EventStatus.draft);
  }

  static String toJson(EventStatus status) => status.name;

  const EventStatusParser._();
}