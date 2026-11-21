import 'package:flutter_test/flutter_test.dart';
import 'package:temple_procession_tracker_app/core/enums/user_role.dart';
import 'package:temple_procession_tracker_app/core/models/user_profile.dart';
import 'package:temple_procession_tracker_app/core/services/access_code_service.dart';
import 'package:temple_procession_tracker_app/core/services/membership_service.dart';
import 'package:temple_procession_tracker_app/core/utils/role_access.dart';

void main() {
  test('self registration has exactly the three permitted roles', () {
    expect(RoleAccess.registrationRoles.toSet(), {
      UserRole.organizer,
      UserRole.teamLeader,
      UserRole.teamMember,
    });
    expect(RoleAccess.registrationRoles, isNot(contains(UserRole.admin)));
    expect(
      RoleAccess.registrationRoles,
      isNot(contains(UserRole.publicVisitor)),
    );
  });
  test('management roles cannot use leader tracking navigation', () {
    for (final role in UserRole.values) {
      expect(
        RoleAccess.canUseTeamLeaderTracking(role),
        role == UserRole.teamLeader,
        reason: role.name,
      );
    }
  });
  test('organizer ownership is enforced by the mobile permission policy', () {
    expect(
      RoleAccess.canManageEvent(UserRole.organizer, 'alice', 'alice'),
      isTrue,
    );
    expect(
      RoleAccess.canManageEvent(UserRole.organizer, 'alice', 'bob'),
      isFalse,
    );
    expect(RoleAccess.canManageEvent(UserRole.admin, 'alice', 'bob'), isTrue);
    expect(
      RoleAccess.canManageEvent(UserRole.teamLeader, 'alice', 'alice'),
      isFalse,
    );
    expect(RoleAccess.canManageEvent(null, 'alice', 'alice'), isFalse);
  });
  test('missing account eligibility fails closed', () {
    expect(
      UserProfile.fromJson({'id': 'user', 'role': 'teamLeader'}).isActive,
      isFalse,
    );
    expect(
      UserProfile.fromJson({
        'id': 'user',
        'role': 'teamLeader',
        'isActive': false,
      }).isActive,
      isFalse,
    );
    expect(
      UserProfile.fromJson({
        'id': 'user',
        'role': 'teamLeader',
        'isActive': true,
      }).isActive,
      isTrue,
    );
  });
  test(
    'code validation accepts only six alphanumeric or normalized legacy 20 hex symbols',
    () {
      expect(AccessCodeService.normalize(' a7k2p9 '), 'A7K2P9');
      expect(AccessCodeService.isValidFormat(' a7k2p9 '), isTrue);
      expect(
        AccessCodeService.normalize('abcd-ef12-1234-5678-9012'),
        'ABCDEF12123456789012',
      );
      expect(
        AccessCodeService.isValidFormat('ABCD-EF12-1234-5678-9012'),
        isTrue,
      );
      for (final code in [
        '',
        'ABC12',
        'ABC1234',
        'AB-123',
        'ABC 12',
        'GBCD-EF12-1234-5678-9012',
        'ABCDEF1212345678901',
        'ABCDEF121234567890123',
        'AB12-C3',
      ]) {
        expect(AccessCodeService.isValidFormat(code), isFalse, reason: code);
      }
    },
  );
  test(
    'event-only membership never implies group membership or matches another selection',
    () {
      const event = Membership(id: 'e_u', uid: 'u', eventId: 'e');
      const group = Membership(id: 'f_u', uid: 'u', eventId: 'f', groupId: 'g');
      expect(event.isEventOnly, isTrue);
      expect(event.isSelected('e', ''), isTrue);
      expect(event.isSelected('e', 'g'), isFalse);
      expect(group.isEventOnly, isFalse);
      expect(group.isSelected('f', ''), isFalse);
      expect(group.isSelected('f', 'g'), isTrue);
    },
  );
  test('profile parsing keeps assignment and selected membership separate', () {
    final profile = UserProfile.fromJson({
      'id': 'u',
      'role': 'teamLeader',
      'isActive': true,
      'assignedGroupId': 'leader-group',
      'joinedEventId': 'joined-event',
      'joinedGroupId': 'member-group',
    });
    expect(profile.assignedGroupId, 'leader-group');
    expect(profile.joinedEventId, 'joined-event');
    expect(profile.joinedGroupId, 'member-group');
  });
}
