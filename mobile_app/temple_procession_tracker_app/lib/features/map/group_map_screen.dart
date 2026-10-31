
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/app_routes.dart';
import '../../core/models/map_view_records.dart';
import '../../core/repositories/live_map_repository.dart';
import 'widgets/procession_map.dart';

class GroupMapScreen extends StatelessWidget {
  const GroupMapScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return const Scaffold(body: Center(child: Text('Sign in to view your assigned group.')));

    final repo = LiveMapRepository();

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Group Map'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'Back to Home',
          onPressed: () => context.go(AppRoutes.homePath),
        ),
      ),
      body: StreamBuilder<String>(
        stream: repo.assignedGroupId(uid),
        builder: (context, assignment) {
          if (assignment.hasError) return Center(child: Text('Assignment unavailable: ${assignment.error}'));
          if (!assignment.hasData) return const Center(child: CircularProgressIndicator());

          final id = assignment.data!;
          if (id.isEmpty) return const Center(child: Text('You have not joined or been assigned to a group. Use a group-level access code.'));

          return StreamBuilder<MapGroupView?>(
            stream: repo.group(id),
            builder: (context, groupSnap) {
              if (groupSnap.hasError) return Center(child: Text('Cannot load group: ${groupSnap.error}'));
              final group = groupSnap.data;
              if (groupSnap.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
              if (group == null) return const Center(child: Text('Assigned group does not exist.'));

              return StreamBuilder<MapRouteView?>(
                stream: repo.route(group.routeId),
                builder: (context, routeSnap) {
                  if (routeSnap.hasError) return Center(child: Text('Cannot load route: ${routeSnap.error}'));
                  final route = routeSnap.data;
                  if (routeSnap.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
                  if (route == null) return const Center(child: Text('Assigned route does not exist.'));
                  if (route.eventId != group.eventId) return const Center(child: Text('Group/route event mismatch.'));

                  return StreamBuilder<List<MapStopView>>(
                    stream: repo.stops(route.id),
                    builder: (context, stopSnap) {
                      if (stopSnap.hasError) return Center(child: Text('Cannot load stops: ${stopSnap.error}'));
                      final stops = stopSnap.data ?? [];

                      return StreamBuilder<Map<String, LiveGroupPosition>>(
                        stream: repo.live(group.eventId),
                        builder: (context, liveSnap) {
                          final live = liveSnap.data ?? {};

                          return StreamBuilder<GroupProgressView?>(
                            stream: repo.progress(group.id),
                            builder: (context, progressSnap) {
                              final progress = progressSnap.data;

                              MapStopView? named(String? stopId) {
                                for (final stop in stops) {
                                  if (stop.id == stopId) return stop;
                                }
                                return null;
                              }

                              final current = named(progress?.currentStopPointId);
                              final next = named(progress?.nextStopPointId.isNotEmpty == true ? progress!.nextStopPointId : group.startingStopPointId);
                              final location = live[group.id];

                              return Column(
                                children: [
                                  Expanded(child: ProcessionMap(route: route, stops: stops, groups: [group], live: {if (location != null) group.id: location})),
                                  SizedBox(
                                    height: 218,
                                    child: ListView(
                                      padding: const EdgeInsets.all(12),
                                      children: [
                                        Text(group.name, style: Theme.of(context).textTheme.titleLarge),
                                        Text('Status: ${group.status} · Progress: ${progress?.progressPercent.toStringAsFixed(1) ?? '0.0'}%'),
                                        Text('Status updated: ${group.statusUpdatedAt?.toLocal().toString() ?? 'Not recorded'}'),
                                        Text('Current stop: ${current?.name ?? 'Not confirmed'}'),
                                        Text('Next stop: ${next?.name ?? 'Not available'}'),
                                        Text('GPS updated: ${location?.recordedAt?.toLocal().toString() ?? 'Not reported'}${location?.stale == true ? ' (stale)' : ''}'),
                                        if (liveSnap.hasError) Text('Live GPS unavailable: ${liveSnap.error}'),
                                        if (progressSnap.hasError) Text('Progress unavailable: ${progressSnap.error}'),
                                        if (progress?.isDelayed == true) const Text('This group is running behind its planned schedule.', style: TextStyle(color: Colors.orange)),
                                        StreamBuilder<List<MapAnnouncementView>>(
                                          stream: repo.announcements(group.eventId),
                                          builder: (context, notices) => Text(
                                            notices.hasError ? 'Announcements unavailable.' : notices.data?.isNotEmpty == true ? 'Organizer: ${notices.data!.first.message}' : 'No organizer announcements.',
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              );
                            },
                          );
                        },
                      );
                    },
                  );
                },
              );
            },
          );
        },
      ),
    );
  }
}
