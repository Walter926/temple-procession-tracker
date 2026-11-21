import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/services/group_status_service.dart';
import '../../core/services/tracking_service.dart';
import 'gps_permission_screen.dart';
import '../notifications/collision_warnings_panel.dart';
import '../map/group_map_screen.dart';
import '../events/access_codes_panel.dart';
import '../notifications/announcement_composer.dart';

class TeamLeaderTrackingScreen extends StatefulWidget {
  const TeamLeaderTrackingScreen({super.key});
  @override
  State<TeamLeaderTrackingScreen> createState() =>
      _TeamLeaderTrackingScreenState();
}

class _TeamLeaderTrackingScreenState extends State<TeamLeaderTrackingScreen> {
  late final TrackingService tracker;
  String? actionError;
  bool _acting = false;
  @override
  void initState() {
    super.initState();
    tracker = context.read<TrackingService>();
    tracker.addListener(_changed);
    tracker.loadAssignment().catchError((Object reason) {
      if (mounted) setState(() => actionError = '$reason');
    });
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    tracker.removeListener(_changed);
    super.dispose();
  }

  Future<void> _start() async {
    final ready = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const GpsPermissionScreen()),
    );
    if (!mounted || ready != true) return;
    await tracker.start();
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_acting) return;
    try {
      setState(() {
        actionError = null;
        _acting = true;
      });
      await action();
    } catch (reason) {
      if (mounted) setState(() => actionError = '$reason');
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _status(String next) async {
    await tracker.updateGroupStatus(next);
  }

  @override
  Widget build(BuildContext context) {
    final isActive =
            tracker.state == 'active' || tracker.state == 'reconnecting',
        isPaused = tracker.state == 'paused';
    final loc = tracker.position;
    final color = tracker.state == 'error'
        ? Colors.red
        : tracker.state == 'active'
        ? Colors.green
        : isPaused
        ? Colors.orange
        : Colors.grey;
    return Scaffold(
      appBar: AppBar(title: const Text('Team Leader Tracking')),
      body: SafeArea(
        child: AbsorbPointer(
          absorbing: _acting || tracker.isTransitioning,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              if (tracker.groupId.isNotEmpty)
                SizedBox(
                  height: 420,
                  child: AssignedGroupMap(
                    key: ValueKey(tracker.groupId),
                    groupId: tracker.groupId,
                  ),
                ),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Event: ${tracker.eventName.isEmpty ? 'Unassigned' : tracker.eventName}',
                      ),
                      Text(
                        'Group: ${tracker.groupName.isEmpty ? 'Unassigned' : tracker.groupName}',
                      ),
                      Text(
                        'Group status: ${tracker.groupStatus.isEmpty ? 'not loaded' : tracker.groupStatus}',
                      ),
                    ],
                  ),
                ),
              ),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(Icons.circle, size: 14, color: color),
                          const SizedBox(width: 8),
                          Text('Tracking: ${tracker.state}'),
                        ],
                      ),
                      Text('Connection: ${tracker.connectionState}'),
                      Text('GPS: ${tracker.gpsState}'),
                      Text(
                        'Latitude: ${loc?.latitude.toStringAsFixed(6) ?? '—'}',
                      ),
                      Text(
                        'Longitude: ${loc?.longitude.toStringAsFixed(6) ?? '—'}',
                      ),
                      Text(
                        'Accuracy: ${loc?.accuracy.toStringAsFixed(1) ?? '—'} m',
                      ),
                      Text(
                        'Last sent: ${tracker.lastSentAt?.toLocal().toString() ?? 'Never'}',
                      ),
                    ],
                  ),
                ),
              ),
              if (tracker.warning != null)
                Text(
                  'Warning: ${tracker.warning}',
                  style: const TextStyle(color: Colors.orange),
                ),
              if (tracker.error != null)
                Text(
                  'Error: ${tracker.error}',
                  style: const TextStyle(color: Colors.red),
                ),
              if (actionError != null)
                Text(
                  'Error: $actionError',
                  style: const TextStyle(color: Colors.red),
                ),
              const SizedBox(height: 16),
              if (!isActive && !isPaused)
                ElevatedButton.icon(
                  onPressed: () => _run(_start),
                  icon: const Icon(Icons.play_arrow),
                  label: Text(
                    tracker.isTransitioning ? 'Starting…' : 'Start Tracking',
                  ),
                ),
              if (isActive)
                ElevatedButton.icon(
                  onPressed: () => _run(tracker.pause),
                  icon: const Icon(Icons.pause),
                  label: const Text('Pause Tracking'),
                ),
              if (isPaused)
                ElevatedButton.icon(
                  onPressed: () => _run(tracker.resume),
                  icon: const Icon(Icons.play_arrow),
                  label: const Text('Resume Tracking'),
                ),
              if (isActive || isPaused)
                ElevatedButton.icon(
                  onPressed: () => _run(tracker.stop),
                  icon: const Icon(Icons.stop),
                  label: const Text('Stop Tracking'),
                ),
              if (isActive)
                DropdownButtonFormField<String>(
                  decoration: const InputDecoration(
                    labelText: 'Update group status',
                  ),
                  items: GroupStatusService.allowed
                      .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                      .toList(),
                  onChanged: (value) {
                    if (value != null) _run(() => _status(value));
                  },
                ),
              if (tracker.eventId.isNotEmpty && tracker.groupId.isNotEmpty)
                CollisionWarningsPanel(
                  key: ValueKey(
                    'instructions-${tracker.eventId}-${tracker.groupId}',
                  ),
                  eventId: tracker.eventId,
                  groupId: tracker.groupId,
                ),
              if (tracker.eventId.isNotEmpty && tracker.groupId.isNotEmpty) ...[
                AccessCodesPanel(
                  key: ValueKey('codes-${tracker.groupId}'),
                  eventId: tracker.eventId,
                  groupId: tracker.groupId,
                ),
                AnnouncementComposer(
                  key: ValueKey('announce-${tracker.groupId}'),
                  eventId: tracker.eventId,
                  groupId: tracker.groupId,
                ),
              ],
              const Text(
                'Foreground-only GPS. Keep the app visible; no reliable background tracking is enabled.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
