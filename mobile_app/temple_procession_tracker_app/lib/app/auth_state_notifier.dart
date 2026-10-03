import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../core/enums/user_role.dart';
import '../core/models/user_profile.dart';
import '../core/repositories/user_repository.dart';
import '../core/services/auth_service.dart';

class AuthStateNotifier extends ChangeNotifier {
  final AuthService authService;
  final UserRepository _userRepository;

  StreamSubscription<User?>? _authSubscription;

  StreamSubscription<UserProfile?>? _profileSubscription;

  User? _firebaseUser;
  UserProfile? _userProfile;
  bool _profileLoading = false;

  AuthStateNotifier({required this.authService, UserRepository? userRepository}) : _userRepository = userRepository ?? UserRepository() {
    _firebaseUser = authService.currentFirebaseUser;

    if (_firebaseUser != null) {
      _watchProfile(_firebaseUser!.uid);
    }

    _authSubscription = authService.authStateChanges().listen(_handleAuthStateChanged);
  }

  User? get firebaseUser {
    return _firebaseUser;
  }

  UserProfile? get userProfile {
    return _userProfile;
  }

  bool get isAuthenticated {
    return _firebaseUser != null;
  }

  bool get isProfileLoading {
    return _profileLoading;
  }

  UserRole? get effectiveRole {
    if (!isAuthenticated) {
      return UserRole.publicVisitor;
    }

    return _userProfile?.role;
  }

  void _handleAuthStateChanged(User? user) {
    _firebaseUser = user;

    _profileSubscription?.cancel();
    _profileSubscription = null;

    if (user == null) {
      _userProfile = null;
      _profileLoading = false;
      notifyListeners();
      return;
    }

    _userProfile = null;
    _profileLoading = true;
    notifyListeners();

    _watchProfile(user.uid);
  }

  void _watchProfile(String userId) {
    _profileLoading = true;

    _profileSubscription = _userRepository.streamById(userId).listen(
      (UserProfile? profile) {
        _userProfile = profile;
        _profileLoading = false;
        notifyListeners();
      },
      onError: (Object error, StackTrace stackTrace) {
        _userProfile = null;
        _profileLoading = false;
        notifyListeners();
      },
    );
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    _profileSubscription?.cancel();
    super.dispose();
  }
}