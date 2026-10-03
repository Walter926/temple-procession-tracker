import 'package:firebase_auth/firebase_auth.dart';

import '../enums/user_role.dart';
import '../models/user_profile.dart';
import '../repositories/user_repository.dart';

class AuthService {
  final FirebaseAuth _auth;
  final UserRepository _userRepository;

  AuthService({FirebaseAuth? firebaseAuth, UserRepository? userRepository}) : _auth = firebaseAuth ?? FirebaseAuth.instance,
        _userRepository = userRepository ?? UserRepository();

  User? get currentFirebaseUser {
    return _auth.currentUser;
  }

  Stream<User?> authStateChanges() {
    return _auth.authStateChanges();
  }

  Future<UserProfile?> getCurrentUserProfile() async {
    final User? firebaseUser = _auth.currentUser;

    if (firebaseUser == null) {
      return null;
    }

    return _userRepository.read(firebaseUser.uid);
  }

  Future<UserProfile> signUp({required String email, required String password, required String displayName, UserRole role = UserRole.viewer}) async {
    final UserCredential credential = await _auth.createUserWithEmailAndPassword(email: email.trim(), password: password);

    final User? firebaseUser = credential.user;

    if (firebaseUser == null) {
      throw StateError('Firebase user was not created.');
    }

    await firebaseUser.updateDisplayName(displayName.trim());

    final UserProfile userProfile = UserProfile(id: firebaseUser.uid,
      email: email.trim(),
      displayName: displayName.trim(),
      role: role,
      photoUrl: firebaseUser.photoURL,
      phoneNumber: firebaseUser.phoneNumber,
      isActive: true,
      createdAt: DateTime.now(),
    );

    try {
      await _userRepository.create(userProfile);
    } catch (_) {
      await firebaseUser.delete();
      rethrow;
    }

    return userProfile;
  }

  Future<UserProfile> signIn({required String email, required String password}) async {
    final UserCredential credential = await _auth.signInWithEmailAndPassword(email: email.trim(), password: password);

    final User? firebaseUser = credential.user;

    if (firebaseUser == null) {
      throw StateError('Firebase user was not returned after sign in.');
    }

    final UserProfile? userProfile = await _userRepository.read(firebaseUser.uid);

    if (userProfile == null) {
      await _auth.signOut();

      throw StateError('The account does not have an application profile.');
    }

    return userProfile;
  }

  Future<void> sendPasswordResetEmail({required String email}) async {
    await _auth.sendPasswordResetEmail(email: email.trim());
  }

  Future<void> signOut() async {
    await _auth.signOut();
  }
}