enum GroupStatus { waiting, preparing, moving, stopped, delayed, arrived, completed, emergency }
extension GroupStatusValue on GroupStatus { String get value => name; }
class GroupStatusParser {
  static GroupStatus fromJson(Object? value) => GroupStatus.values.firstWhere((status) => status.name == value?.toString(), orElse: () => GroupStatus.waiting);
  static String toJson(GroupStatus status) => status.name;
}