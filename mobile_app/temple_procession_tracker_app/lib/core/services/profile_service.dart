import 'package:firebase_auth/firebase_auth.dart';

import '../models/user_profile.dart';
import '../repositories/user_repository.dart';

class ProfileService {
  final FirebaseAuth _auth;
  final UserRepository _userRepository;

  ProfileService({FirebaseAuth? firebaseAuth, UserRepository? userRepository}) : _auth = firebaseAuth ?? FirebaseAuth.instance,
        _userRepository = userRepository ?? UserRepository();

  Stream<UserProfile?> watchProfile() {
    final User? user = _auth.currentUser;

    if (user == null) {
      return Stream<UserProfile?>.value(null);
    }

    return _userRepository.streamById(user.uid);
  }

  Future<void> updateDisplayName(String displayName) async {
    final String trimmedName = displayName.trim();

    if (trimmedName.isEmpty) {
      throw ArgumentError('Display name cannot be empty.');
    }

    final User user = _requireFirebaseUser();

    final UserProfile profile = await _requireProfile(user.uid);

    final UserProfile updatedProfile = UserProfile(id: profile.id,
      email: profile.email,
      displayName: trimmedName,
      role: profile.role,
      photoUrl: profile.photoUrl,
      phoneNumber: profile.phoneNumber,
      isActive: profile.isActive,
      createdAt: profile.createdAt,
      updatedAt: DateTime.now(),
    );

    await _userRepository.update(updatedProfile);

    await user.updateDisplayName(trimmedName);
  }

  Future<void> updatePhotoUrl(String photoUrl) async {
    final User user = _requireFirebaseUser();

    final UserProfile profile = await _requireProfile(user.uid);

    final UserProfile updatedProfile = UserProfile(id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      role: profile.role,
      photoUrl: photoUrl,
      phoneNumber: profile.phoneNumber,
      isActive: profile.isActive,
      createdAt: profile.createdAt,
      updatedAt: DateTime.now(),
    );

    await _userRepository.update(updatedProfile);

    await user.updatePhotoURL(photoUrl);
  }

  User _requireFirebaseUser() {
    final User? user = _auth.currentUser;

    if (user == null) {
      throw StateError('No signed-in user is available.');
    }

    return user;
  }

  Future<UserProfile> _requireProfile(String userId) async {
    final UserProfile? profile = await _userRepository.read(userId);

    if (profile == null) {
      throw StateError('The signed-in user does not have an application profile.');
    }

    return profile;
  }
}