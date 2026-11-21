import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../app/auth_state_notifier.dart';
import '../../core/enums/group_status.dart';
import '../../core/models/procession_group.dart';
import '../../core/models/route_model.dart';
import '../../core/models/stop_point.dart';
import '../../core/models/user_profile.dart';
import '../../core/services/event_management_service.dart';
import '../../shared/widgets/app_button.dart';
import 'management_feedback.dart';

class GroupEditorScreen extends StatefulWidget {
  final String eventId;
  final ProcessionGroup? initial;
  const GroupEditorScreen({super.key, required this.eventId, this.initial});
  @override
  State<GroupEditorScreen> createState() => _GroupEditorScreenState();
}

class _GroupEditorScreenState extends State<GroupEditorScreen> {
  final _form = GlobalKey<FormState>();
  late final _service = EventManagementService();
  late final _routesStream = _service.watchRoutes(widget.eventId);
  late final _name = TextEditingController(text: widget.initial?.name);
  late final _color = TextEditingController(
    text: widget.initial?.color ?? '#46575F',
  );
  late String _routeId = widget.initial?.routeId ?? '';
  late String _startId = widget.initial?.startingStopPointId ?? '';
  late String _endId = widget.initial?.endingStopPointId ?? '';
  late Stream<List<StopPoint>> _stopsStream = _routeId.isEmpty
      ? Stream.value([])
      : _service.watchStops(_routeId);
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _color.dispose();
    super.dispose();
  }

  Future<void> _save(List<RouteModel> routes, List<StopPoint> stops) async {
    if (!_form.currentState!.validate()) return;
    final profile = context.read<AuthStateNotifier>().userProfile;
    if (profile == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final old = widget.initial;
      final group = ProcessionGroup(
        id: old?.id ?? _service.newId('groups'),
        eventId: widget.eventId,
        name: _name.text.trim(),
        leaderUserId: old?.leaderUserId ?? '',
        backupLeaderUserId: old?.backupLeaderUserId ?? '',
        status: old?.status ?? GroupStatus.waiting,
        memberCount: old?.memberCount ?? 0,
        color: _color.text.trim(),
        routeId: _routeId,
        startingStopPointId: _startId,
        endingStopPointId: _endId,
      );
      final route = routes.where((r) => r.id == _routeId).firstOrNull;
      if (route == null) throw StateError('Choose an available route.');
      EventManagementService.validateGroup(group, route, stops);
      await _service.saveGroup(group, profile, creating: old == null);
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) setState(() => _error = managementError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.initial == null ? 'Create group' : 'Edit group'),
    ),
    body: SafeArea(
      child: StreamBuilder<List<RouteModel>>(
        stream: _routesStream,
        builder: (context, routes) {
          if (routes.hasError) {
            return const Center(
              child: Text('Unable to load routes. Reopen this page to retry.'),
            );
          }
          if (!routes.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          if (routes.data!.isEmpty) {
            return const Center(
              child: Text(
                'Create a route and its stops before creating a group.',
              ),
            );
          }
          return StreamBuilder<List<StopPoint>>(
            stream: _stopsStream,
            builder: (context, stops) => Form(
              key: _form,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  TextFormField(
                    controller: _name,
                    maxLength: 120,
                    decoration: const InputDecoration(labelText: 'Group name'),
                    validator: requiredText,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _color,
                    decoration: const InputDecoration(
                      labelText: 'Group color (#RRGGBB)',
                    ),
                    validator: (value) =>
                        RegExp(r'^#[a-fA-F0-9]{6}$').hasMatch(value ?? '')
                        ? null
                        : 'Use #RRGGBB.',
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    key: ValueKey('route-$_routeId'),
                    initialValue: routes.data!.any((r) => r.id == _routeId)
                        ? _routeId
                        : null,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Assigned route',
                    ),
                    items: routes.data!
                        .map(
                          (route) => DropdownMenuItem(
                            value: route.id,
                            child: Text(
                              route.name,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    validator: requiredText,
                    onChanged: _busy
                        ? null
                        : (id) => setState(() {
                            _routeId = id!;
                            _startId = '';
                            _endId = '';
                            _stopsStream = _service.watchStops(id);
                          }),
                  ),
                  const SizedBox(height: 12),
                  if (stops.hasError)
                    const Text(
                      'Unable to load stops. Reopen this page to retry.',
                    )
                  else if (!stops.hasData)
                    const LinearProgressIndicator()
                  else ...[
                    if (_routeId.isNotEmpty && stops.data!.isEmpty)
                      const Text('This route has no stops. Add stops first.'),
                    _stopDropdown(
                      'Starting stop',
                      _startId,
                      stops.data!,
                      (id) => setState(() => _startId = id),
                    ),
                    const SizedBox(height: 12),
                    _stopDropdown(
                      'Ending stop',
                      _endId,
                      stops.data!,
                      (id) => setState(() => _endId = id),
                    ),
                  ],
                  const SizedBox(height: 12),
                  const Text(
                    'Leaders are assigned separately after saving. Member counts and assignments are maintained by the server.',
                  ),
                  if (_error != null)
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  const SizedBox(height: 20),
                  AppButton(
                    label: 'Save group',
                    isLoading: _busy,
                    onPressed: _busy || !stops.hasData || stops.hasError
                        ? null
                        : () => _save(routes.data!, stops.data!),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    ),
  );

  Widget _stopDropdown(
    String label,
    String value,
    List<StopPoint> stops,
    ValueChanged<String> change,
  ) => DropdownButtonFormField<String>(
    key: ValueKey('$label-$_routeId-$value'),
    initialValue: stops.any((s) => s.id == value) ? value : null,
    isExpanded: true,
    decoration: InputDecoration(labelText: label),
    validator: requiredText,
    items: stops
        .map(
          (stop) => DropdownMenuItem(
            value: stop.id,
            child: Text(
              '${stop.order}. ${stop.name}',
              overflow: TextOverflow.ellipsis,
            ),
          ),
        )
        .toList(),
    onChanged: _busy ? null : (id) => change(id!),
  );
}

class LeaderAssignmentScreen extends StatefulWidget {
  final ProcessionGroup group;
  const LeaderAssignmentScreen({super.key, required this.group});
  @override
  State<LeaderAssignmentScreen> createState() => _LeaderAssignmentScreenState();
}

class _LeaderAssignmentScreenState extends State<LeaderAssignmentScreen> {
  late final _service = EventManagementService();
  final _loaded = <String, UserProfile>{};
  String? _nextCursor;
  Future<List<UserProfile>> _load([String? cursor]) async {
    final page = await _service.listAssignableLeaders(
      widget.group.eventId,
      widget.group.id,
      cursor: cursor,
    );
    if (cursor == null) _loaded.clear();
    for (final user in page.users) {
      _loaded[user.id] = user;
    }
    _nextCursor = page.nextCursor;
    return _loaded.values.toList();
  }

  late Future<List<UserProfile>> _leaders = _load();
  late String _primary = widget.group.leaderUserId;
  late String _backup = widget.group.backupLeaderUserId;
  bool _busy = false;
  String? _error;

  Future<void> _save() async {
    if (_primary.isNotEmpty && _primary == _backup) {
      setState(() => _error = 'Primary and backup must be different people.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _service.assignLeaders(widget.group.id, _primary, _backup);
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) setState(() => _error = managementError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text('Leaders · ${widget.group.name}')),
    body: SafeArea(
      child: FutureBuilder<List<UserProfile>>(
        future: _leaders,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(
              child: TextButton(
                onPressed: () => setState(() => _leaders = _load()),
                child: const Text('Unable to load leaders. Retry'),
              ),
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final users = snapshot.data!;
          Widget picker(
            String label,
            String current,
            ValueChanged<String> onChanged,
          ) => DropdownButtonFormField<String>(
            initialValue: current,
            isExpanded: true,
            decoration: InputDecoration(labelText: label),
            items: [
              const DropdownMenuItem(value: '', child: Text('Unassigned')),
              if (current.isNotEmpty && !users.any((u) => u.id == current))
                DropdownMenuItem(
                  value: current,
                  child: Text('Current: $current'),
                ),
              ...users.map(
                (user) => DropdownMenuItem(
                  value: user.id,
                  child: Text(
                    '${user.displayName} · ${user.email}',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ],
            onChanged: _busy ? null : (value) => onChanged(value!),
          );
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              const Text(
                'Only the assigned primary leader of an active event can publish GPS. A backup waits for promotion. Changing assignments stops the old session.',
              ),
              if (users.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    'No active, available leaders found. An administrator can create or activate a team-leader account.',
                  ),
                ),
              const SizedBox(height: 16),
              if (_nextCursor != null)
                TextButton(
                  onPressed: () =>
                      setState(() => _leaders = _load(_nextCursor)),
                  child: const Text('Load more leader accounts'),
                ),
              picker(
                'Primary leader',
                _primary,
                (id) => setState(() => _primary = id),
              ),
              const SizedBox(height: 16),
              picker(
                'Backup leader',
                _backup,
                (id) => setState(() => _backup = id),
              ),
              if (_error != null)
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              const SizedBox(height: 20),
              AppButton(
                label: 'Save assignments',
                isLoading: _busy,
                onPressed: _busy ? null : _save,
              ),
            ],
          );
        },
      ),
    ),
  );
}
