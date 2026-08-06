enum AlertSeverity {
  info,
  warning,
  critical,
  }

extension AlertServerityValue on AlertSeverity{
  String get value => name;
}

class AlertSeverityParser {
  static AlertSeverity fromJson(Object? value) {
    final text = value?.toString();

    return AlertSeverity.values.firstWhere(
      (severity) => severity.name == text,
      orElse: () => AlertSeverity.info,
    );
  }

  static String toJson(AlertSeverity severity) {
    return severity.name;
  }
}