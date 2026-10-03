import '../core/enums/user_role.dart';
import '../core/utils/role_access.dart';

class RoleRouteGuard {
  static bool canAccessAdmin(UserRole? role) {
    return RoleAccess.isAdmin(role);
  }

  static bool canAccessTeamLeader(UserRole? role) {
    return RoleAccess.canUseTeamLeaderTracking(role);
  }

  static bool canAccessMember(UserRole? role) {
    return RoleAccess.canAccessMemberArea(role);
  }

  static bool canAccessPublic(UserRole? role) {
    return RoleAccess.canViewPublicMap(role);
  }

  const RoleRouteGuard._();
}