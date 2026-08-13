import 'package:firebase_auth/firebase_auth.dart';

import '../enums/user_role.dart';
import '../models/user_profile.dart';
import '../repositories/user_repository.dart';

class AuthService {
  final FirebaseAuth _auth;
  final UserRepository _userRepository;

  AuthService({
    FirebaseAuth? firebaseAuth,
    UserRepository? userRepository,
  })  : _auth = firebaseAuth ?? FirebaseAuth.instance,
        _userRepository = userRepository ?? UserRepository();

  User? get currentFirebaseUser {
    return _auth.currentUser;
  }

  Stream<User?> authStateChanges() {
    return _auth.authStateChanges();
  }

  Future<UserProfile?> getCurrentUserProfile() async {
    final firebaseUser = _auth.currentUser;

    if (firebaseUser == null) {
      return null;
    }

    return _userRepository.read(firebaseUser.uid);
  }

  Future<UserProfile> signUp({
    required String email,
    required String password,
    required String displayName,
    UserRole role = UserRole.viewer,
  }) async {
    final credential = await _auth.createUserWithEmailAndPassword(
      email: email,
      password: password,
    );

    final firebaseUser = credential.user;

    if (firebaseUser == null) {
      throw StateError('Firebase user was not created.');
    }

    await firebaseUser.updateDisplayName(displayName);

    final userProfile = UserProfile(
      id: firebaseUser.uid,
      email: email,
      displayName: displayName,
      role: role,
      photoUrl: firebaseUser.photoURL,
      phoneNumber: firebaseUser.phoneNumber,
      isActive: true,
      createdAt: DateTime.now(),
    );

    await _userRepository.create(userProfile);

    return userProfile;
  }

  Future<UserProfile?> signIn({
    required String email,
    required String password,
  }) async {
    final credential = await _auth.signInWithEmailAndPassword(
      email: email,
      password: password,
    );

    final firebaseUser = credential.user;

    if (firebaseUser == null) {
      return null;
    }

    return _userRepository.read(firebaseUser.uid);
  }

  Future<void> signOut() async {
    await _auth.signOut();
  }
}