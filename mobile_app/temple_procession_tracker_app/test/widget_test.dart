import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:temple_procession_tracker_app/core/enums/user_role.dart';
import 'package:temple_procession_tracker_app/core/models/user_profile.dart';
import 'package:temple_procession_tracker_app/core/services/auth_service.dart';
import 'package:temple_procession_tracker_app/features/auth/registration_screen.dart';
import 'package:temple_procession_tracker_app/shared/theme/app_theme.dart';

class RegistrationAuth implements AuthService {
  UserRole? submittedRole;
  @override
  Future<UserProfile> signUp({
    required String email,
    required String password,
    required String displayName,
    UserRole role = UserRole.teamMember,
  }) async {
    submittedRole = role;
    return UserProfile(
      id: 'new',
      email: email,
      displayName: displayName,
      role: role,
      isActive: true,
      createdAt: DateTime(2026),
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets(
    'registration excludes admin and submits the explicitly selected role',
    (tester) async {
      final auth = RegistrationAuth();
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          home: RegistrationScreen(authService: auth),
        ),
      );
      await tester.tap(find.byType(DropdownButtonFormField<UserRole>));
      await tester.pumpAndSettle();
      expect(find.text('Administrator'), findsNothing);
      expect(find.text('Public Visitor'), findsNothing);
      expect(find.text('Organizer'), findsOneWidget);
      expect(find.text('Team Leader'), findsOneWidget);
      await tester.tap(find.text('Organizer'));
      await tester.pumpAndSettle();
      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'Temple Organizer');
      await tester.enterText(fields.at(1), 'organizer@example.com');
      await tester.enterText(fields.at(2), 'valid-password');
      await tester.enterText(fields.at(3), 'valid-password');
      await tester.ensureVisible(
        find.widgetWithText(FilledButton, 'Create Account'),
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Create Account'));
      await tester.pumpAndSettle();
      expect(auth.submittedRole, UserRole.organizer);
      expect(tester.takeException(), isNull);
    },
  );
}
