import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:temple_procession_tracker_app/app/auth_state_notifier.dart';
import 'package:temple_procession_tracker_app/core/enums/user_role.dart';
import 'package:temple_procession_tracker_app/core/models/user_profile.dart';
import 'package:temple_procession_tracker_app/core/repositories/user_repository.dart';
import 'package:temple_procession_tracker_app/core/services/auth_service.dart';

class TestUser implements User {
  @override
  final String uid;
  TestUser(this.uid);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class TestAuth implements AuthService {
  final changes = StreamController<User?>.broadcast(sync: true);
  @override
  User? currentFirebaseUser = TestUser('alice');
  @override
  Stream<User?> authStateChanges() => changes.stream;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class TestUsers implements UserRepository {
  final profiles = <String, StreamController<UserProfile?>>{};
  @override
  Stream<UserProfile?> streamById(String id) => profiles
      .putIfAbsent(
        id,
        () => StreamController<UserProfile?>.broadcast(sync: true),
      )
      .stream;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

UserProfile profile(String uid, UserRole role, {bool active = true}) =>
    UserProfile(
      id: uid,
      email: '$uid@example.com',
      displayName: uid,
      role: role,
      isActive: active,
      createdAt: DateTime(2026),
    );

void main() {
  test(
    'deactivation immediately removes the effective role, and reactivation follows the live role',
    () async {
      final auth = TestAuth(), users = TestUsers();
      final state = AuthStateNotifier(authService: auth, userRepository: users);
      expect(state.isProfileLoading, isTrue);
      users.profiles['alice']!.add(profile('alice', UserRole.teamLeader));
      expect(state.effectiveRole, UserRole.teamLeader);
      users.profiles['alice']!.add(
        profile('alice', UserRole.teamLeader, active: false),
      );
      expect(state.isActive, isFalse);
      expect(state.effectiveRole, isNull);
      users.profiles['alice']!.add(profile('alice', UserRole.organizer));
      expect(state.isActive, isTrue);
      expect(state.effectiveRole, UserRole.organizer);
      state.dispose();
      await auth.changes.close();
      for (final stream in users.profiles.values) {
        await stream.close();
      }
    },
  );
  test(
    'account switch clears the previous profile and never retains its role',
    () async {
      final auth = TestAuth(), users = TestUsers();
      final state = AuthStateNotifier(authService: auth, userRepository: users);
      users.profiles['alice']!.add(profile('alice', UserRole.admin));
      auth.changes.add(TestUser('bob'));
      expect(state.isProfileLoading, isTrue);
      expect(state.userProfile, isNull);
      expect(state.effectiveRole, isNull);
      users.profiles['alice']!.add(profile('alice', UserRole.admin));
      expect(state.userProfile, isNull);
      users.profiles['bob']!.add(profile('bob', UserRole.teamMember));
      expect(state.effectiveRole, UserRole.teamMember);
      auth.changes.add(null);
      expect(state.userProfile, isNull);
      expect(state.isAuthenticated, isFalse);
      expect(state.effectiveRole, UserRole.publicVisitor);
      state.dispose();
      await auth.changes.close();
      for (final stream in users.profiles.values) {
        await stream.close();
      }
    },
  );
  test(
    'profile errors fail closed instead of retaining privileged navigation',
    () async {
      final auth = TestAuth(), users = TestUsers();
      final state = AuthStateNotifier(authService: auth, userRepository: users);
      users.profiles['alice']!.add(profile('alice', UserRole.admin));
      users.profiles['alice']!.addError(StateError('permission revoked'));
      expect(state.effectiveRole, isNull);
      expect(state.isProfileLoading, isFalse);
      state.dispose();
      await auth.changes.close();
      for (final stream in users.profiles.values) {
        await stream.close();
      }
    },
  );
}
