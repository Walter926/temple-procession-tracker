import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../core/models/map_view_records.dart';
import '../../core/repositories/live_map_repository.dart';
import '../notifications/collision_warnings_panel.dart';
import 'event_map_screen.dart';
import '../notifications/announcement_composer.dart';

class GroupMapScreen extends StatefulWidget {
  const GroupMapScreen({super.key});
  @override
  State<GroupMapScreen> createState() => _GroupMapScreenState();
}

class _GroupMapScreenState extends State<GroupMapScreen> {
  final _repo = LiveMapRepository();
  late final _uid = FirebaseAuth.instance.currentUser?.uid;
  late final _profile = _uid == null
      ? Stream<Map<String, dynamic>?>.value(null)
      : _repo.profile(_uid);
  Stream<List<PublishedEventView>>? _managed;
  String? _managedRole, _selected;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('My Event Map')),
    body: SafeArea(
      child: StreamBuilder<Map<String, dynamic>?>(
        stream: _profile,
        builder: (context, profileSnap) {
          if (profileSnap.hasError) {
            return const Center(
              child: Text(
                'Unable to load your event access. Try signing in again.',
              ),
            );
          }
          if (profileSnap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final profile = profileSnap.data;
          if (_uid == null || profile?['isActive'] != true) {
            return const Center(
              child: Text(
                'Sign in with an active account to view your assigned event.',
              ),
            );
          }
          final role = '${profile!['role']}';
          if (role == 'organizer' || role == 'admin') {
            if (_managedRole != role) {
              _managedRole = role;
              _managed = _repo.managedEvents(_uid, admin: role == 'admin');
            }
            return StreamBuilder<List<PublishedEventView>>(
              stream: _managed,
              builder: (context, eventsSnap) {
                if (eventsSnap.hasError) {
                  return Center(
                    child: Text(
                      'Unable to load your events: ${eventsSnap.error}',
                    ),
                  );
                }
                if (!eventsSnap.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final events = eventsSnap.data!;
                if (events.isEmpty) {
                  return const Center(
                    child: Text(
                      'No managed events yet. Create an event to view its groups here.',
                    ),
                  );
                }
                final selected =
                    events.where((e) => e.id == _selected).firstOrNull ??
                    events.first;
                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: DropdownButtonFormField<String>(
                        isExpanded: true,
                        key: ValueKey(selected.id),
                        initialValue: selected.id,
                        decoration: const InputDecoration(
                          labelText: 'Managed event — all groups, read-only',
                        ),
                        items: events
                            .map(
                              (e) => DropdownMenuItem(
                                value: e.id,
                                child: Text(
                                  e.name,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: (id) => setState(() => _selected = id),
                      ),
                    ),
                    TextButton.icon(
                      onPressed:
                          [
                            'scheduled',
                            'active',
                            'paused',
                          ].contains(selected.status)
                          ? () => showModalBottomSheet<void>(
                              context: context,
                              isScrollControlled: true,
                              useSafeArea: true,
                              builder: (context) => SingleChildScrollView(
                                padding: EdgeInsets.only(
                                  bottom: MediaQuery.viewInsetsOf(
                                    context,
                                  ).bottom,
                                ),
                                child: AnnouncementComposer(
                                  eventId: selected.id,
                                ),
                              ),
                            )
                          : null,
                      icon: const Icon(Icons.campaign_outlined),
                      label: const Text('Send event announcement'),
                    ),
                    Expanded(
                      child: EventMapView(
                        key: ValueKey(selected.id),
                        eventId: selected.id,
                      ),
                    ),
                  ],
                );
              },
            );
          }
          final groupId =
              '${profile[role == 'teamLeader' ? 'assignedGroupId' : 'joinedGroupId'] ?? ''}';
          final eventId = '${profile['joinedEventId'] ?? ''}';
          if (groupId.isEmpty) {
            if (eventId.isNotEmpty) {
              return EventMapView(key: ValueKey(eventId), eventId: eventId);
            }
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Text(
                  'No active event selected. Join an event or group using an access code, then select that membership. Event-only membership does not require a group.',
                ),
              ),
            );
          }
          return Column(
            children: [
              CollisionWarningsPanel(groupId: groupId),
              Expanded(
                child: AssignedGroupMap(
                  key: ValueKey(groupId),
                  groupId: groupId,
                ),
              ),
            ],
          );
        },
      ),
    ),
  );
}

/// Also embedded by the leader screen without creating any tracking service.
class AssignedGroupMap extends StatefulWidget {
  final String groupId;
  const AssignedGroupMap({super.key, required this.groupId});
  @override
  State<AssignedGroupMap> createState() => _AssignedGroupMapState();
}

class _AssignedGroupMapState extends State<AssignedGroupMap> {
  late final _group = LiveMapRepository().group(widget.groupId);
  @override
  Widget build(BuildContext context) => StreamBuilder<MapGroupView?>(
    stream: _group,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return const Center(
          child: Text(
            'Assigned group unavailable. Your membership may have changed.',
          ),
        );
      }
      if (snapshot.connectionState == ConnectionState.waiting) {
        return const Center(child: CircularProgressIndicator());
      }
      final group = snapshot.data;
      if (group == null) {
        return const Center(
          child: Text(
            'The assigned group no longer exists. Contact the organizer.',
          ),
        );
      }
      return EventMapView(
        key: ValueKey('${group.eventId}:${group.id}'),
        eventId: group.eventId,
        groupId: group.id,
      );
    },
  );
}
