import '../enums/user_role.dart';
import '../models/event.dart';
import '../models/procession_group.dart';
import '../models/profile_assignment.dart';
import '../models/user_profile.dart';
import '../repositories/event_repository.dart';
import '../repositories/group_repository.dart';

class ProfileAssignmentService {
  final EventRepository _eventRepository;

  final GroupRepository _groupRepository;

  ProfileAssignmentService({EventRepository? eventRepository, GroupRepository? groupRepository}) : _eventRepository = eventRepository ?? EventRepository(),
        _groupRepository = groupRepository ?? GroupRepository();

  Future<ProfileAssignment> readForProfile(UserProfile profile) async {
    switch (profile.role) {
      case UserRole.teamLeader:
        return _readTeamLeaderAssignment(profile.id);

      case UserRole.organizer:
        return _readOrganizerAssignment(profile.id);

      case UserRole.admin:
      case UserRole.teamMember:
      case UserRole.publicVisitor:
        return const ProfileAssignment();
    }
  }

  Future<ProfileAssignment> _readTeamLeaderAssignment(String userId) async {
    final ProcessionGroup? group = await _groupRepository.readByLeaderUserId(userId);

    if (group == null) {
      return const ProfileAssignment();
    }

    final Event? event = await _eventRepository.read(group.eventId);

    return ProfileAssignment(event: event, group: group);
  }

  Future<ProfileAssignment> _readOrganizerAssignment(String userId) async {
    final Event? event = await _eventRepository.readByOrganizerId(userId);

    return ProfileAssignment(event: event);
  }
}