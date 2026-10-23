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

  ProfileAssignmentService({EventRepository? eventRepository, GroupRepository? groupRepository})
      : _eventRepository = eventRepository ?? EventRepository(), _groupRepository = groupRepository ?? GroupRepository();

  Future<ProfileAssignment> readForProfile(UserProfile profile) async {
    if (!profile.isActive) return const ProfileAssignment();
    if (profile.role == UserRole.teamLeader) {
      ProcessionGroup? group;
      if (profile.assignedGroupId.isNotEmpty) group = await _groupRepository.read(profile.assignedGroupId);
      group ??= await _groupRepository.readByLeaderUserId(profile.id);
      if (group == null || (group.leaderUserId != profile.id && group.backupLeaderUserId != profile.id)) return const ProfileAssignment();
      final Event? event = await _eventRepository.read(group.eventId);
      return ProfileAssignment(event: event, group: group);
    }
    if (profile.role == UserRole.organizer) {
      return ProfileAssignment(event: await _eventRepository.readByOrganizerId(profile.id));
    }
    return const ProfileAssignment();
  }
}