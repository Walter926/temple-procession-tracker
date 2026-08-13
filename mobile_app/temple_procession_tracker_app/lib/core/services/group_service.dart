import '../enums/group_status.dart';
import '../models/procession_group.dart';
import '../repositories/group_repository.dart';

class GroupService {
  final GroupRepository _groupRepository;

  GroupService({
    GroupRepository? groupRepository,
  }) : _groupRepository = groupRepository ?? GroupRepository();

  Future<void> createGroup(ProcessionGroup group) async {
    await _groupRepository.create(group);
  }

  Future<ProcessionGroup?> getGroup(String groupId) async {
    return _groupRepository.read(groupId);
  }

  Stream<ProcessionGroup?> watchGroup(String groupId) {
    return _groupRepository.streamById(groupId);
  }

  Stream<List<ProcessionGroup>> watchGroupsForEvent(String eventId) {
    return _groupRepository.streamByEventId(eventId);
  }

  Future<void> updateGroup(ProcessionGroup group) async {
    await _groupRepository.update(group);
  }

  Future<void> updateStatus({
    required ProcessionGroup group,
    required GroupStatus status,
  }) async {
    final updatedGroup = ProcessionGroup(
      id: group.id,
      eventId: group.eventId,
      name: group.name,
      leaderUserId: group.leaderUserId,
      status: status,
      currentLatitude: group.currentLatitude,
      currentLongitude: group.currentLongitude,
      lastLocationUpdateAt: group.lastLocationUpdateAt,
      accessCodeId: group.accessCodeId,
      memberCount: group.memberCount,
    );

    await _groupRepository.update(updatedGroup);
  }

  Future<void> updateCurrentLocation({
    required ProcessionGroup group,
    required double latitude,
    required double longitude,
  }) async {
    final updatedGroup = ProcessionGroup(
      id: group.id,
      eventId: group.eventId,
      name: group.name,
      leaderUserId: group.leaderUserId,
      status: group.status,
      currentLatitude: latitude,
      currentLongitude: longitude,
      lastLocationUpdateAt: DateTime.now(),
      accessCodeId: group.accessCodeId,
      memberCount: group.memberCount,
    );

    await _groupRepository.update(updatedGroup);
  }

  List<ProcessionGroup> delayedGroups(List<ProcessionGroup> groups) {
    return groups.where((group) => group.status == GroupStatus.delayed).toList();
  }

  List<ProcessionGroup> activeGroups(List<ProcessionGroup> groups) {
    return groups
        .where(
          (group) =>
              group.status == GroupStatus.moving ||
              group.status == GroupStatus.stopped ||
              group.status == GroupStatus.delayed,
        )
        .toList();
  }
}