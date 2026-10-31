import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/app_routes.dart';
import '../../core/models/map_view_records.dart';
import '../../core/repositories/live_map_repository.dart';
import 'widgets/procession_map.dart';

class PublicMapScreen extends StatefulWidget {
  const PublicMapScreen({super.key});
  @override
  State<PublicMapScreen> createState() => _PublicMapScreenState();
}

class _PublicMapScreenState extends State<PublicMapScreen> {
  final LiveMapRepository repo = LiveMapRepository();
  String _eventId = '';
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Public Procession Map')), body: StreamBuilder<List<PublishedEventView>>(
    stream: repo.publishedEvents(), builder: (context, snapshot) {
      if (snapshot.hasError) return Center(child: Text('Unable to load published events: ${snapshot.error}'));
      if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
      final events = snapshot.data!;
      if (events.isEmpty) return const Center(child: Text('No published procession events yet.'));
      final selected = events.where((e) => e.id == _eventId).firstOrNull ?? events.first;
      return Column(children: [
        Padding(padding: const EdgeInsets.all(12), child: DropdownButtonFormField<String>(key: ValueKey(selected.id), initialValue: selected.id, decoration: const InputDecoration(labelText: 'Published event'), items: events.map((e) => DropdownMenuItem(value: e.id, child: Text(e.name))).toList(), onChanged: (id) => setState(() => _eventId = id ?? ''))),
        Expanded(child: _eventMap(selected)),
      ]);
    },
  ));

  Widget _eventMap(PublishedEventView event) => StreamBuilder<MapRouteView?>(stream: repo.route(event.routeId), builder: (context, routeSnap) {
    if (routeSnap.hasError) return Center(child: Text('Route unavailable: ${routeSnap.error}'));
    if (routeSnap.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
    final route = routeSnap.data;
    if (route == null || route.eventId != event.id) return const Center(child: Text('This event has no valid primary route.'));
    return StreamBuilder<List<MapStopView>>(stream: repo.stops(route.id), builder: (context, stopSnap) {
      if (stopSnap.hasError) return Center(child: Text('Stop points unavailable: ${stopSnap.error}'));
      final stops = stopSnap.data ?? [];
      return StreamBuilder<List<MapGroupView>>(stream: repo.groups(event.id), builder: (context, groupSnap) {
        final groups = groupSnap.data ?? [];
        return StreamBuilder<Map<String, LiveGroupPosition>>(stream: repo.live(event.id), builder: (context, liveSnap) {
          final live = liveSnap.data ?? {};
          return Column(children: [
            Expanded(child: ProcessionMap(route: route, stops: stops, groups: groups, live: live, onGroupTap: (group) {
              final location = live[group.id];
              showModalBottomSheet<void>(context: context, builder: (context) => Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [Text(group.name, style: Theme.of(context).textTheme.titleLarge), Text('Status: ${group.status}'), Text('Location: ${location?.recordedAt?.toLocal().toString() ?? 'Not reported'}'), if (location?.stale == true) const Text('Last GPS update is stale.', style: TextStyle(color: Colors.orange))])));
            })),
            SizedBox(height: 172, child: ListView(padding: const EdgeInsets.symmetric(horizontal: 12), children: [
              Text('${event.name} · ${event.status}', style: Theme.of(context).textTheme.titleMedium),
              Text('Stops: ${stops.length} · Groups: ${groups.length} · Live markers: ${live.length}'),
              if (groupSnap.hasError) Text('Group details unavailable: ${groupSnap.error}'),
              if (liveSnap.hasError) Text('Live GPS unavailable: ${liveSnap.error}'),
              const Text('Legend: blue = stop; group marker = group color; route line = route color.'),
              ...groups.map((group) => StreamBuilder<GroupProgressView?>(stream: repo.progress(group.id), builder: (context, item) => Text('${group.name}: ${item.data?.progressPercent.toStringAsFixed(1) ?? '0.0'}% complete${item.data?.isDelayed == true ? ' · DELAYED' : ''}'))),
              StreamBuilder<List<MapAnnouncementView>>(stream: repo.announcements(event.id), builder: (context, a) => Text(a.hasError ? 'Announcements unavailable.' : a.data?.isNotEmpty == true ? 'Announcement: ${a.data!.first.message}' : 'No public announcements.')),
              if (FirebaseAuth.instance.currentUser != null) StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(stream: FirebaseFirestore.instance.collection('users').doc(FirebaseAuth.instance.currentUser!.uid).snapshots(), builder: (context, profile) => profile.data?.data()?['role'] == 'teamMember'
                ? TextButton.icon(onPressed: () => context.push(AppRoutes.joinCodePath), icon: const Icon(Icons.key), label: const Text('Join with Event Access Code'))
                : const Text('Join codes require an active teamMember account.')),
            ])),
          ]);
        });
      });
    });
  });
}