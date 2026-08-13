import '../enums/user_role.dart';
import '../models/user_profile.dart';
import '../repositories/user_repository.dart';

class UserRoleService {
  final UserRepository _userRepository;

  UserRoleService({
    UserRepository? userRepository,
  }) : _userRepository = userRepository ?? UserRepository();

  Future<UserRole> getRoleForUser(String userId) async {
    final userProfile = await _userRepository.read(userId);

    return userProfile?.role ?? UserRole.viewer;
  }

  bool canManageSystem(UserRole role) {
    return role == UserRole.admin;
  }

  bool canManageEvents(UserRole role) {
    return role == UserRole.admin || role == UserRole.organizer;
  }

  bool canShareLocation(UserRole role) {
    return role == UserRole.admin ||
        role == UserRole.organizer ||
        role == UserRole.teamLeader;
  }

  bool canViewPublicMap(UserRole role) {
    return role == UserRole.admin ||
        role == UserRole.organizer ||
        role == UserRole.teamLeader ||
        role == UserRole.viewer;
  }

  String homeScreenForRole(UserRole role) {
    switch (role) {
      case UserRole.admin:
      case UserRole.organizer:
        return '/dashboard';
      case UserRole.teamLeader:
        return '/tracking';
      case UserRole.viewer:
        return '/map';
    }
  }

  Future<bool> userCanManageEvents(String userId) async {
    final role = await getRoleForUser(userId);

    return canManageEvents(role);
  }

  Future<void> updateUserRole({
    required UserProfile userProfile,
    required UserRole newRole,
  }) async {
    final updatedProfile = UserProfile(
      id: userProfile.id,
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