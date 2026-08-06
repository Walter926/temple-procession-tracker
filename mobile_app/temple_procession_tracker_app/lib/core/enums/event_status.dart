enum EventStatus {
  draft,
  scheduled,
  active,
  paused,
  completed,
  cancelled,
  }

extension EventStatusalue on EventStatus{
  String get value => name;
}

class EventStatusParser {
  static EventStatus fromJson(Object? value) {
    final text = value?.toString();

    return EventStatus.values.firstWhere(
      (status) => status.name == text,
      orElse: () => EventStatus.draft,
    );
  }

  static String toJson(EventStatus status) {
    return status.name;
  }
}