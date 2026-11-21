import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../app/app_routes.dart';
import '../../app/auth_state_notifier.dart';
import '../../core/enums/event_status.dart';
import '../../core/enums/user_role.dart';
import '../../core/models/event.dart';
import '../../core/models/procession_group.dart';
import '../../core/models/route_model.dart';
import '../../core/models/stop_point.dart';
import '../../core/services/event_management_service.dart';
import '../../core/services/event_service.dart';
import '../../core/utils/role_access.dart';
import '../../shared/widgets/app_card.dart';
import 'access_codes_panel.dart';
import 'event_editor_screen.dart';
import 'group_editor_screen.dart';
import 'management_feedback.dart';
import 'route_editor_screen.dart';
import 'stop_editor_screen.dart';
import '../notifications/announcement_composer.dart';
import '../map/history_map_screen.dart';
import '../map/widgets/primary_route_notice.dart';

class EventDetailScreen extends StatefulWidget {
  final String eventId;
  const EventDetailScreen({super.key, required this.eventId});
  @override
  State<EventDetailScreen> createState() => _EventDetailScreenState();
}

class _EventDetailScreenState extends State<EventDetailScreen> {
  late final _service = EventManagementService();
  late final _event = EventService().watchEvent(widget.eventId);
  late final _routes = _service.watchRoutes(widget.eventId);
  late final _groups = _service.watchGroups(widget.eventId);
  bool _busy = false;
  String? _error;

  void _open(Widget page) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => page));
  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = managementError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(String collection, String id, String label) async {
    if (!await confirmDelete(context, label) || !mounted) return;
    await _run(() async {
      await _service.deleteRecord(collection, id, widget.eventId);
      if (collection == 'events' && mounted) Navigator.pop(context);
    });
  }

  @override
  Widget build(BuildContext context) {
    final profile = context.watch<AuthStateNotifier>().userProfile;
    if (profile == null || !profile.isActive) {
      return const Scaffold(
        body: Center(child: Text('An active account is required.')),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Event details')),
      body: SafeArea(
        child: StreamBuilder<Event?>(
          stream: _event,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return const Center(
                child: Text(
                  'This event is unavailable or you no longer have access.',
                ),
              );
            }
            if (!snapshot.hasData &&
                snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            final event = snapshot.data;
            if (event == null) {
              return const Center(child: Text('This event no longer exists.'));
            }
            final manage = RoleAccess.canManageEvent(
              profile.role,
              profile.id,
              event.organizerId,
            );
            final planning = [
              EventStatus.draft,
              EventStatus.scheduled,
            ].contains(event.status);
            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  event.name,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                Text(
                  '${event.status.name} · ${event.isPublic ? 'Public' : 'Private'}',
                ),
                const SizedBox(height: 12),
                Text(event.description),
                Text('${event.mainTempleName} · ${event.cityRegion}'),
                Text('Starts ${formatDate(event.startTime)}'),
                if (event.endTime != null)
                  Text('Ends ${formatDate(event.endTime!)}'),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: () =>
                      context.push(AppRoutes.eventMapLocation(event.id)),
                  icon: const Icon(Icons.map_outlined),
                  label: Text(
                    manage
                        ? 'View all groups on event map'
                        : 'View assigned event map',
                  ),
                ),
                if (event.routeId == null || event.routeId!.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: PrimaryRouteNotice(),
                  ),
                if (_busy) const LinearProgressIndicator(),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                if (manage) ...[
                  OutlinedButton.icon(
                    onPressed: () => _open(HistoryMapScreen(eventId: event.id)),
                    icon: const Icon(Icons.history),
                    label: const Text('View recorded paths'),
                  ),
                  if ([
                    EventStatus.scheduled,
                    EventStatus.active,
                    EventStatus.paused,
                  ].contains(event.status))
                    AnnouncementComposer(
                      key: ValueKey('announcement-${event.id}'),
                      eventId: event.id,
                    ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      OutlinedButton.icon(
                        onPressed: _busy
                            ? null
                            : () => _open(EventEditorScreen(initial: event)),
                        icon: const Icon(Icons.edit),
                        label: const Text('Edit event'),
                      ),
                      if (planning)
                        OutlinedButton.icon(
                          onPressed: _busy
                              ? null
                              : () =>
                                    _open(RouteEditorScreen(eventId: event.id)),
                          icon: const Icon(Icons.route),
                          label: const Text('Draw route'),
                        ),
                      if (planning)
                        OutlinedButton.icon(
                          onPressed: _busy
                              ? null
                              : () =>
                                    _open(GroupEditorScreen(eventId: event.id)),
                          icon: const Icon(Icons.group_add),
                          label: const Text('Add group'),
                        ),
                      if (event.status == EventStatus.draft)
                        TextButton.icon(
                          onPressed: _busy
                              ? null
                              : () => _delete('events', event.id, 'event'),
                          icon: const Icon(Icons.delete_outline),
                          label: const Text('Delete draft'),
                        ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<EventStatus>(
                    key: ValueKey('status-${event.status.name}'),
                    initialValue: event.status,
                    decoration: const InputDecoration(
                      labelText: 'Event status',
                    ),
                    items: EventStatus.values
                        .map(
                          (status) => DropdownMenuItem(
                            value: status,
                            child: Text(status.name),
                          ),
                        )
                        .toList(),
                    onChanged: _busy
                        ? null
                        : (status) async {
                            if (status != null && status != event.status) {
                              await _run(
                                () => _service.setStatus(
                                  event.id,
                                  status,
                                  profile,
                                ),
                              );
                              if (mounted) setState(() {});
                            }
                          },
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Scheduling and activation validate route geometry, stops, groups, and leader assignments on the server.',
                  ),
                ],
                const SizedBox(height: 24),
                Text(
                  'Routes & stops',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                StreamBuilder<List<RouteModel>>(
                  stream: _routes,
                  builder: (context, routes) {
                    if (routes.hasError) {
                      return const Text(
                        'Unable to load routes. Check event access and reopen this page.',
                      );
                    }
                    if (!routes.hasData) return const LinearProgressIndicator();
                    if (routes.data!.isEmpty) {
                      return const Text('No routes yet.');
                    }
                    return Column(
                      children: routes.data!
                          .map(
                            (route) => _RouteTile(
                              key: ValueKey(route.id),
                              route: route,
                              primary: route.id == event.routeId,
                              editable: manage && planning,
                              canDelete:
                                  manage && event.status == EventStatus.draft,
                              busy: _busy,
                              service: _service,
                              open: _open,
                              onPrimary: () => _run(
                                () => _service.setPrimaryRoute(
                                  event.id,
                                  route.id,
                                  profile,
                                ),
                              ),
                              onDelete: () =>
                                  _delete('routes', route.id, 'route'),
                              onDeleteStop: (stop) =>
                                  _delete('stopPoints', stop.id, 'stop'),
                            ),
                          )
                          .toList(),
                    );
                  },
                ),
                if (manage) ...[
                  const SizedBox(height: 24),
                  Text('Groups', style: Theme.of(context).textTheme.titleLarge),
                  StreamBuilder<List<ProcessionGroup>>(
                    stream: _groups,
                    builder: (context, groups) {
                      if (groups.hasError) {
                        return const Text(
                          'Unable to load groups. Reopen this page to retry.',
                        );
                      }
                      if (!groups.hasData) {
                        return const LinearProgressIndicator();
                      }
                      if (groups.data!.isEmpty) {
                        return const Text(
                          'No groups yet. Create route stops, then add a group.',
                        );
                      }
                      return Column(
                        children: groups.data!
                            .map(
                              (group) => AppCard(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      group.name,
                                      style: Theme.of(
                                        context,
                                      ).textTheme.titleMedium,
                                    ),
                                    Text(
                                      '${group.status.name} · ${group.memberCount} members',
                                    ),
                                    Text(
                                      'Primary: ${group.leaderUserId.isEmpty ? 'Unassigned' : group.leaderUserId}',
                                    ),
                                    Text(
                                      'Backup: ${group.backupLeaderUserId.isEmpty ? 'Unassigned' : group.backupLeaderUserId}',
                                    ),
                                    Wrap(
                                      spacing: 8,
                                      children: [
                                        if (planning)
                                          TextButton(
                                            onPressed: _busy
                                                ? null
                                                : () => _open(
                                                    GroupEditorScreen(
                                                      eventId: event.id,
                                                      initial: group,
                                                    ),
                                                  ),
                                            child: const Text('Edit'),
                                          ),
                                        TextButton(
                                          onPressed: _busy
                                              ? null
                                              : () => _open(
                                                  LeaderAssignmentScreen(
                                                    group: group,
                                                  ),
                                                ),
                                          child: const Text('Assign leaders'),
                                        ),
                                        if (event.status == EventStatus.draft)
                                          TextButton(
                                            onPressed: _busy
                                                ? null
                                                : () => _delete(
                                                    'groups',
                                                    group.id,
                                                    'group',
                                                  ),
                                            child: const Text('Delete'),
                                          ),
                                      ],
                                    ),
                                    AccessCodesPanel(
                                      key: ValueKey('codes-${group.id}'),
                                      eventId: event.id,
                                      groupId: group.id,
                                    ),
                                  ],
                                ),
                              ),
                            )
                            .toList(),
                      );
                    },
                  ),
                  const SizedBox(height: 20),
                  AccessCodesPanel(
                    key: ValueKey('event-codes-${event.id}'),
                    eventId: event.id,
                  ),
                ] else if (profile.role == UserRole.teamLeader &&
                    profile.assignedGroupId.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                    stream: FirebaseFirestore.instance
                        .doc('groups/${profile.assignedGroupId}')
                        .snapshots(),
                    builder: (context, group) {
                      final data = group.data?.data();
                      if (data == null ||
                          data['eventId'] != event.id ||
                          data['leaderUserId'] != profile.id) {
                        return const SizedBox.shrink();
                      }
                      return AccessCodesPanel(
                        key: ValueKey(
                          'leader-codes-${profile.assignedGroupId}',
                        ),
                        eventId: event.id,
                        groupId: profile.assignedGroupId,
                      );
                    },
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _RouteTile extends StatefulWidget {
  final RouteModel route;
  final bool primary, editable, canDelete, busy;
  final EventManagementService service;
  final void Function(Widget) open;
  final VoidCallback onPrimary, onDelete;
  final void Function(StopPoint) onDeleteStop;
  const _RouteTile({
    super.key,
    required this.route,
    required this.primary,
    required this.editable,
    required this.canDelete,
    required this.busy,
    required this.service,
    required this.open,
    required this.onPrimary,
    required this.onDelete,
    required this.onDeleteStop,
  });
  @override
  State<_RouteTile> createState() => _RouteTileState();
}

class _RouteTileState extends State<_RouteTile> {
  late final _stops = widget.service.watchStops(widget.route.id);
  @override
  Widget build(BuildContext context) => AppCard(
    child: ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: Text('${widget.route.name}${widget.primary ? ' · Primary' : ''}'),
      subtitle: Text(
        '${(widget.route.totalDistanceMeters / 1000).toStringAsFixed(2)} km · ${widget.route.estimatedDurationMinutes} min',
      ),
      children: [
        if (widget.editable)
          Wrap(
            spacing: 8,
            children: [
              TextButton(
                onPressed: widget.busy
                    ? null
                    : () => widget.open(
                        RouteEditorScreen(
                          eventId: widget.route.eventId,
                          initial: widget.route,
                        ),
                      ),
                child: const Text('Edit route'),
              ),
              if (!widget.primary)
                TextButton(
                  onPressed: widget.busy ? null : widget.onPrimary,
                  child: const Text('Make primary'),
                ),
            ],
          ),
        if (widget.canDelete)
          TextButton(
            onPressed: widget.busy ? null : widget.onDelete,
            child: const Text('Delete route'),
          ),
        StreamBuilder<List<StopPoint>>(
          stream: _stops,
          builder: (context, stops) {
            if (stops.hasError) return const Text('Unable to load stops.');
            if (!stops.hasData) return const LinearProgressIndicator();
            return Column(
              children: [
                if (stops.data!.isEmpty) const Text('No stops on this route.'),
                ...stops.data!.map(
                  (stop) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${stop.order}. ${stop.name}'),
                    subtitle: Text(
                      '${stop.type.name} · ${stop.geofenceRadiusMeters.round()} m geofence',
                    ),
                    trailing: Wrap(
                      children: [
                        if (widget.editable)
                          IconButton(
                            tooltip: 'Edit stop',
                            onPressed: widget.busy
                                ? null
                                : () => widget.open(
                                    StopEditorScreen(
                                      route: widget.route,
                                      existing: stops.data!,
                                      initial: stop,
                                    ),
                                  ),
                            icon: const Icon(Icons.edit_outlined),
                          ),
                        if (widget.canDelete)
                          IconButton(
                            tooltip: 'Delete stop',
                            onPressed: widget.busy
                                ? null
                                : () => widget.onDeleteStop(stop),
                            icon: const Icon(Icons.delete_outline),
                          ),
                      ],
                    ),
                  ),
                ),
                if (widget.editable)
                  TextButton.icon(
                    onPressed: widget.busy
                        ? null
                        : () => widget.open(
                            StopEditorScreen(
                              route: widget.route,
                              existing: stops.data!,
                            ),
                          ),
                    icon: const Icon(Icons.add_location_alt),
                    label: const Text('Place stop'),
                  ),
              ],
            );
          },
        ),
      ],
    ),
  );
}
