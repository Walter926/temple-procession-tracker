import '../enums/user_role.dart';
import '../models/user_profile.dart';
import '../repositories/user_repository.dart';
import '../utils/role_access.dart';

class UserRoleService {
  final UserRepository _userRepository;

  UserRoleService({UserRepository? userRepository}) : _userRepository = userRepository ?? UserRepository();

  Future<UserRole> getRoleForUser(String userId) async {
    final UserProfile? userProfile = await _userRepository.read(userId);

    return userProfile?.role ?? UserRole.publicVisitor;
  }

  bool canManageSystem(UserRole? role) {
    return RoleAccess.canManageSystem(role);
  }

  bool canManageEvents(UserRole? role) {
    return RoleAccess.canManageEvents(role);
  }

  bool canShareLocation(UserRole? role) {
    return RoleAccess.canUseTeamLeaderTracking(role);
  }

  bool canViewPublicMap(UserRole? role) {
    return RoleAccess.canViewPublicMap(role);
  }

  String homeScreenForRole(UserRole role) {
    switch (role) {
      case UserRole.admin:
      case UserRole.organizer:
      case UserRole.teamLeader:
      case UserRole.teamMember:
        return '/home';
      case UserRole.publicVisitor:
        return '/public-map';
    }
  }

  Future<bool> userCanManageEvents(String userId) async {
    final UserRole role = await getRoleForUser(userId);

    return canManageEvents(role);
  }

  Future<void> updateUserRole({required UserProfile userProfile, required UserRole newRole}) async {
    final UserProfile updatedProfile = UserProfile(id: userProfile.id,
      email: userProfile.email,
      displayName: userProfile.displayName,
      role: newRole,
      photoUrl: userProfile.photoUrl,
      phoneNumber: userProfile.phoneNumber,
      isActive: userProfile.isActive,
      createdAt: userProfile.createdAt,
      updatedAt: DateTime.now(),
    );

    await _userRepository.update(updatedProfile);
  }
}