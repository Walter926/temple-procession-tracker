enum GroupStatus {
  waiting,
  moving,
  stopped,
  delayed,
  completed,
  emergency,
  }

extension GroupStatusValue on GroupStatus{
  String get value => name;
}

class GroupStatusParser {
  static GroupStatus fromJson(Object? value) {
    final text = value?.toString();

    return GroupStatus.values.firstWhere(
      (status) => status.name == text,
      orElse: () => GroupStatus.waiting,
    );
  }

  static String toJson(GroupStatus status) {
    return status.name;
  }
}