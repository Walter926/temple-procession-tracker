enum StopPointType {
  temple,
  ritual,
  rest,
  checkpoint,
  food,
  medical,
  roadControl,
  other,
  }

extension StopPointTypeValue on StopPointType {
  String get value => name;
}

class StopPointTypeParser {
  static StopPointType fromJson(Object? value) {
    final text = value?.toString();

    return StopPointType.values.firstWhere(
      (type) => type.name == text,
      orElse: () => StopPointType.other,
    );
  }

  static String toJson(StopPointType type) {
    return type.name;
  }
}