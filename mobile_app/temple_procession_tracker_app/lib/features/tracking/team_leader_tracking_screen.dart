import 'package:flutter/material.dart';
import '../../core/services/tracking_service.dart';
import 'gps_permission_screen.dart';

class TeamLeaderTrackingScreen extends StatefulWidget {
  const TeamLeaderTrackingScreen({super.key});
  @override
  State<TeamLeaderTrackingScreen> createState() => _TeamLeaderTrackingScreenState();
}

class _TeamLeaderTrackingScreenState extends State<TeamLeaderTrackingScreen> {
  late final TrackingService tracker;
  String? actionError;
  @override
  void initState() { super.initState(); tracker = TrackingService(); tracker.addListener(_changed); tracker.loadAssignment().catchError((Object reason) { if (mounted) setState(() => actionError = '$reason'); }); }
  void _changed() { if (mounted) setState(() {}); }
  @override
  void dispose() { tracker.removeListener(_changed); tracker.dispose(); super.dispose(); }

  Future<void> _start() async {
    final ready = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const GpsPermissionScreen()));
    if (!mounted || ready != true) return;
    await tracker.start();
  }
  Future<void> _run(Future<void> Function() action) async {
    try { setState(() => actionError = null); await action(); }
    catch (reason) { if (mounted) setState(() => actionError = '$reason'); }
  }

  @override
  Widget build(BuildContext context) {
    final isActive = tracker.state == 'active';
    final isPaused = tracker.state == 'paused';
    final location = tracker.position;
    final color = tracker.state == 'error' ? Colors.red : isActive ? Colors.green : isPaused ? Colors.orange : Colors.grey;
    return Scaffold(appBar: AppBar(title: const Text('Team Leader Tracking')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Event: ${tracker.eventName.isEmpty ? 'Unassigned' : tracker.eventName}'),
          Text('Group: ${tracker.groupName.isEmpty ? 'Unassigned' : tracker.groupName}'),
          Text('Group status: ${tracker.groupStatus.isEmpty ? 'Unknown' : tracker.groupStatus}'),
        ]))),
        Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Icon(Icons.circle, size: 14, color: color), const SizedBox(width: 8), Text('Tracking: ${tracker.state}')]),
          Text('Latitude: ${location?.latitude.toStringAsFixed(6) ?? '—'}'),
          Text('Longitude: ${location?.longitude.toStringAsFixed(6) ?? '—'}'),
          Text('Accuracy: ${location?.accuracy.toStringAsFixed(1) ?? '—'} m'),
          Text('Last sent: ${tracker.lastSentAt?.toLocal().toString() ?? 'Never'}'),
        ]))),
        if (tracker.warning != null) Text('Warning: ${tracker.warning}', style: const TextStyle(color: Colors.orange)),
        if (tracker.error != null) Text('Error: ${tracker.error}', style: const TextStyle(color: Colors.red)),
        if (actionError != null) Text('Error: $actionError', style: const TextStyle(color: Colors.red)),
        const SizedBox(height: 16),
        if (!isActive && !isPaused) ElevatedButton.icon(onPressed: _start, icon: const Icon(Icons.play_arrow), label: const Text('Start Tracking')),
        if (isActive) ElevatedButton.icon(onPressed: () => _run(tracker.pause), icon: const Icon(Icons.pause), label: const Text('Pause Tracking')),
        if (isPaused) ElevatedButton.icon(onPressed: () => _run(tracker.resume), icon: const Icon(Icons.play_arrow), label: const Text('Resume Tracking')),
        if (isActive || isPaused) ElevatedButton.icon(onPressed: () => _run(tracker.stop), icon: const Icon(Icons.stop), label: const Text('Stop Tracking')),
        if (isActive) Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: DropdownButtonFormField<String>(
          decoration: const InputDecoration(labelText: 'Manually update group status'),
          items: const ['waiting', 'moving', 'stopped', 'delayed', 'emergency'].map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
          onChanged: (value) { if (value != null) _run(() => tracker.updateGroupStatus(value)); },
        )),
        const Text('Foreground-only GPS. Keep the app visible while testing. Closing the app does not provide reliable background tracking.'),
      ]));
  }
}