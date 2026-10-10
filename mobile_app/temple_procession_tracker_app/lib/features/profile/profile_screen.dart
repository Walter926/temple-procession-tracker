import 'package:flutter/material.dart';

import '../../core/enums/user_role.dart';
import '../../core/models/profile_assignment.dart';
import '../../core/models/user_profile.dart';
import '../../core/services/auth_service.dart';
import '../../core/services/profile_assignment_service.dart';
import '../../core/services/profile_image_service.dart';
import '../../core/services/profile_service.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/app_card.dart';
import '../../shared/widgets/app_error.dart';
import '../../shared/widgets/app_loading.dart';
import '../../shared/widgets/user_avatar.dart';

class ProfileScreen extends StatefulWidget {
  final AuthService authService;
  final ProfileService profileService;
  final ProfileImageService profileImageService;
  final ProfileAssignmentService profileAssignmentService;

  ProfileScreen({
    super.key,
    required this.authService,
    ProfileService? profileService,
    ProfileImageService? profileImageService,
    ProfileAssignmentService? profileAssignmentService,
  }) : profileService = profileService ?? ProfileService(),
        profileImageService = profileImageService ?? ProfileImageService(),
        profileAssignmentService = profileAssignmentService ?? ProfileAssignmentService();

  @override
  State<ProfileScreen> createState() {
    return _ProfileScreenState();
  }
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final Stream<UserProfile?> _profileStream;

  bool _isUploadingPhoto = false;

  @override
  void initState() {
    super.initState();

    _profileStream = widget.profileService.watchProfile();
  }

  Future<void> _editDisplayName(UserProfile profile) async {
    final TextEditingController controller = TextEditingController(text: profile.displayName);

    final String? newName = await showDialog<String>(context: context,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          title: const Text('Edit Display Name'),
          content: TextField(controller: controller, autofocus: true, decoration: const InputDecoration(labelText: 'Display Name')),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final String value = controller.text.trim();

                if (value.isEmpty) {
                  return;
                }

                Navigator.of(dialogContext).pop(value);
              },
              child: const Text('Save'),
            ),
          ],
        );
      },
    );

    controller.dispose();

    if (newName == null) {
      return;
    }

    try {
      await widget.profileService.updateDisplayName(newName);
    } catch (error) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _changeProfilePicture(UserProfile profile) async {
    if (_isUploadingPhoto) {
      return;
    }

    setState(() {
      _isUploadingPhoto = true;
    });

    try {
      final String? photoUrl = await widget.profileImageService.pickAndUploadProfileImage(userId: profile.id);

      if (photoUrl == null) {
        return;
      }

      await widget.profileService.updatePhotoUrl(photoUrl);
    } catch (error) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) {
        setState(() {
          _isUploadingPhoto = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: StreamBuilder<UserProfile?>(
        stream: _profileStream,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const AppLoading(message: 'Loading profile...');
          }

          if (snapshot.hasError) {
            return const AppError(message: 'Unable to load your profile.');
          }

          final UserProfile? profile = snapshot.data;

          if (profile == null) {
            return const AppError(message: 'Your application profile was not found.');
          }

          return FutureBuilder<ProfileAssignment>(
            future: widget.profileAssignmentService.readForProfile(profile),
            builder: (context, assignmentSnapshot) {
              final ProfileAssignment? assignment = assignmentSnapshot.data;

              final String eventName = assignmentSnapshot.hasError ? 'Unable to load assignment' : assignment ?.event ?.name ?? 'Not assigned yet';

              final String groupName = assignmentSnapshot.hasError ? 'Unable to load assignment' : assignment ?.group ?.name ?? 'Not assigned yet';

              return ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  Center(child: UserAvatar(photoUrl: profile.photoUrl, radius: 52)),
                  const SizedBox(height: 16),
                  Text(profile.displayName, textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 4),
                  Text(profile.email, textAlign: TextAlign.center),
                  const SizedBox(height: 24),
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Account', style: Theme.of(context).textTheme.titleMedium),
                        const Divider(),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Display Name'),
                          subtitle: Text(profile.displayName),
                          trailing: IconButton(
                            onPressed: () {
                              _editDisplayName(profile);
                            },
                            icon: const Icon(Icons.edit),
                          ),
                        ),
                        ListTile(contentPadding: EdgeInsets.zero, title: const Text('Email'), subtitle: Text(profile.email)),
                        ListTile(contentPadding: EdgeInsets.zero, title: const Text('Role'), subtitle: Text(profile.role.displayName)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Procession Assignment', style: Theme.of(context).textTheme.titleMedium),
                        const Divider(),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Assigned Event'),
                          subtitle: Text(assignmentSnapshot.connectionState == ConnectionState.waiting ? 'Loading...' : eventName),
                        ),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Assigned Group'),
                          subtitle: Text(assignmentSnapshot.connectionState == ConnectionState.waiting ? 'Loading...' : groupName),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                  AppButton(
                    label: 'Change Profile Picture',
                    icon: Icons.photo_library,
                    isLoading: _isUploadingPhoto,
                    onPressed: _isUploadingPhoto ? null : () {
                                _changeProfilePicture(profile);
                              },
                  ),
                  const SizedBox(height: 12),
                  AppButton(
                    label: 'Sign Out',
                    icon: Icons.logout,
                    onPressed: () {
                      widget.authService.signOut();
                    },
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}