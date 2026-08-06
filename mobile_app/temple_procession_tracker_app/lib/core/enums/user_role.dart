enum UserRole {
  admin,
  organizer,
  teamLeader,
  viewer,
}

extension UserRoleValue on UserRole {
  String get value => name;
}

class UserRoleParser {
  static UserRole fromJson(Object? value) {
    final text = value?.toString();

    return UserRole.values.firstWhere(
      (role) => role.name == text,
      orElse: () => UserRole.viewer,
    );
  }

  static String toJson(UserRole role) {
    return role.name;
  }
}