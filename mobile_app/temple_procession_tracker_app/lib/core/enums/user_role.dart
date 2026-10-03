enum UserRole {
  admin,
  organizer,
  teamLeader,
  teamMember,
  publicVisitor,
}

extension UserRoleValue on UserRole {
  String get value => name;

  String get displayName {
    switch (this) {
      case UserRole.admin:
        return 'Administrator';
      case UserRole.organizer:
        return 'Organizer';
      case UserRole.teamLeader:
        return 'Team Leader';
      case UserRole.teamMember:
        return 'Team Member';
      case UserRole.publicVisitor:
        return 'Public Visitor';
    }
  }
}

class UserRoleParser {
  static UserRole fromJson(Object? value) {
    final String? text = value?.toString();

    if (text == 'viewer') {
      return UserRole.teamMember;
    }

    for (final UserRole role in UserRole.values) {
      if (role.name == text) {
        return role;
      }
    }

    return UserRole.publicVisitor;
  }

  static String toJson(UserRole role) {
    return role.name;
  }

  const UserRoleParser._();
}