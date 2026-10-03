import '../enums/user_role.dart';

class RoleAccess {
  static bool isAdmin(UserRole? role) {
    return role == UserRole.admin;
  }

  static bool isOrganizer(UserRole? role) {
    return role == UserRole.organizer;
  }

  static bool isTeamLeader(UserRole? role) {
    return role == UserRole.teamLeader;
  }

  static bool isTeamMember(UserRole? role) {
    return role == UserRole.teamMember;
  }

  static bool isPublicVisitor(UserRole? role) {
    return role == UserRole.publicVisitor;
  }

  static bool canManageSystem(UserRole? role) {
    return isAdmin(role);
  }

  static bool canManageEvents(UserRole? role) {
    return isAdmin(role) || isOrganizer(role);
  }

  static bool canUseTeamLeaderTracking(UserRole? role) {
    return isAdmin(role) || isTeamLeader(role);
  }

  static bool canAccessMemberArea(UserRole? role) {
    return isAdmin(role) || isOrganizer(role) || isTeamLeader(role) || isTeamMember(role);
  }

  static bool canViewPublicMap(UserRole? role) {
    return role != null;
  }

  const RoleAccess._();
}