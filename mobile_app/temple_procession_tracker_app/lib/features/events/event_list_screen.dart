import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../app/app_routes.dart';
import '../../app/auth_state_notifier.dart';
import '../../core/models/event.dart';
import '../../core/services/event_service.dart';
import '../../core/utils/role_access.dart';
import '../../shared/widgets/app_card.dart';
import 'event_detail_screen.dart';
import 'event_editor_screen.dart';
import 'management_feedback.dart';

class EventListScreen extends StatefulWidget {
  final bool management;
  const EventListScreen({super.key, this.management = false});
  @override
  State<EventListScreen> createState() => _EventListScreenState();
}

class _EventListScreenState extends State<EventListScreen> {
  String? _profileKey;
  Stream<List<Event>>? _events;

  Future<void> _create() async {
    final id = await Navigator.push<String>(
      context,
      MaterialPageRoute(builder: (_) => const EventEditorScreen()),
    );
    if (id != null && mounted) {
      Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => EventDetailScreen(eventId: id)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = context.watch<AuthStateNotifier>().userProfile;
    if (profile == null || !profile.isActive) {
      return const Scaffold(
        body: SafeArea(
          child: Center(child: Text('An active account is required.')),
        ),
      );
    }
    final key = '${profile.id}:${profile.role.name}:${profile.assignedGroupId}';
    if (_profileKey != key) {
      _profileKey = key;
      _events = EventService().watchForProfile(profile);
    }
    final manage = RoleAccess.canManageEvents(profile.role);
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.management ? 'Manage events' : 'My events'),
      ),
      floatingActionButton: manage
          ? FloatingActionButton.extended(
              onPressed: _create,
              icon: const Icon(Icons.add),
              label: const Text('Create event'),
            )
          : null,
      body: SafeArea(
        child: StreamBuilder<List<Event>>(
          key: ValueKey(key),
          stream: _events,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'Unable to load your events. Check your connection and permissions.',
                      ),
                      TextButton(
                        onPressed: () => setState(
                          () =>
                              _events = EventService().watchForProfile(profile),
                        ),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              );
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final events = snapshot.data!;
            if (events.isEmpty) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        manage
                            ? 'You have no events yet.'
                            : 'No joined or assigned events yet.',
                      ),
                      const SizedBox(height: 12),
                      if (manage)
                        FilledButton(
                          onPressed: _create,
                          child: const Text('Create event'),
                        )
                      else
                        FilledButton(
                          onPressed: () => context.push(AppRoutes.joinCodePath),
                          child: const Text('Join with access code'),
                        ),
                      TextButton(
                        onPressed: () => context.push(AppRoutes.publicMapPath),
                        child: const Text('Browse published events'),
                      ),
                    ],
                  ),
                ),
              );
            }
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
              children: [
                Text(
                  manage
                      ? 'Events you can manage (up to 100)'
                      : 'Your memberships and leader assignment',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                ...events.map(
                  (event) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: AppCard(
                      onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => EventDetailScreen(eventId: event.id),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            event.name,
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            '${event.status.name} · ${event.isPublic ? 'Public' : 'Private'}',
                          ),
                          Text('${event.mainTempleName} · ${event.cityRegion}'),
                          Text(formatDate(event.startTime)),
                          const SizedBox(height: 8),
                          const Text('View details →'),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
