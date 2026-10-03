import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../core/services/auth_service.dart';

class AuthStateNotifier extends ChangeNotifier {
  final AuthService authService;
  StreamSubscription<User?>? _authSubscription;
  User? _firebaseUser;

  AuthStateNotifier({required this.authService}) {
    _firebaseUser = authService.currentFirebaseUser;
    _authSubscription = authService.authStateChanges().listen(_handleAuthStateChanged);
  }

  User? get firebaseUser {
    return _firebaseUser;
  }

  bool get isAuthenticated {
    return _firebaseUser != null;
  }

  void _handleAuthStateChanged(User? user) {
    _firebaseUser = user;
    notifyListeners();
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    super.dispose();
  }
}