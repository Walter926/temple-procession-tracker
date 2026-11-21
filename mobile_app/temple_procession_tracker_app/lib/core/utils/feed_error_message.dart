import 'package:firebase_core/firebase_core.dart';

String feedErrorMessage(Object error, String subject) {
  if (error is FirebaseException) {
    if (error.code == 'failed-precondition' &&
        (error.message ?? '').toLowerCase().contains('index')) {
      return '$subject need a database index. Ask the organizer to complete database setup, then retry.';
    }
    if (['permission-denied', 'unauthenticated'].contains(error.code)) {
      return '$subject are unavailable for this account. Check your sign-in and event access, then retry.';
    }
    if ([
      'unavailable',
      'deadline-exceeded',
      'network-request-failed',
    ].contains(error.code)) {
      return '$subject are temporarily unavailable. Check your connection, then retry.';
    }
  }
  return '$subject could not be loaded. Retry, or contact the organizer if this continues.';
}
