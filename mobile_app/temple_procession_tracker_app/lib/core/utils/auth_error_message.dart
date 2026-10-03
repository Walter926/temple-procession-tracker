import 'package:firebase_auth/firebase_auth.dart';

class AuthErrorMessage {
  static String fromException(Object error) {
    if (error is FirebaseAuthException) {
      return fromFirebaseException(error);
    }

    if (error is StateError) {
      return error.message.toString();
    }

    return 'Something went wrong. Please try again.';
  }

  static String fromFirebaseException(FirebaseAuthException error) {
    switch (error.code) {
      case 'invalid-email':
        return 'Enter a valid email address.';
      case 'invalid-credential':
      case 'wrong-password':
      case 'user-not-found':
        return 'The email or password is incorrect.';
      case 'email-already-in-use':
        return 'An account already exists with this email address.';
      case 'weak-password':
        return 'Choose a stronger password with at least 6 characters.';
      case 'user-disabled':
        return 'This account has been disabled.';
      case 'too-many-requests':
        return 'Too many attempts. Please wait and try again.';
      case 'network-request-failed':
        return 'A network error occurred. Check your connection and try again.';
      case 'operation-not-allowed':
        return 'Email and password sign-in is not enabled for this project.';
      default:
        return 'Authentication failed. Please try again.';
    }
  }

  const AuthErrorMessage._();
}