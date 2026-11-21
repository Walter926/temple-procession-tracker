import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/models/map_view_records.dart';
import '../../core/repositories/live_map_repository.dart';
import '../../core/utils/feed_error_message.dart';
import 'widgets/group_tracking_summary.dart';
import 'widgets/primary_route_notice.dart';
import 'widgets/procession_map.dart';

/// Read-only for organizers, members, and visitors; this never starts TrackingService.
class EventMapScreen extends StatelessWidget {
  final String eventId;
  const EventMapScreen({super.key, required this.eventId});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Event Map')),
    body: SafeArea(child: EventMapView(eventId: eventId)),
  );
}

class EventMapView extends StatefulWidget {
  final String eventId;
  final String? groupId;
  final PublishedEventView? publishedEvent;
  final LiveMapRepository? repository;
  const EventMapView({
    super.key,
    required this.eventId,
    this.groupId,
    this.publishedEvent,
    this.repository,
  });
  @override
  State<EventMapView> createState() => _EventMapViewState();
}

class _EventMapViewState extends State<EventMapView> {
  late final _repo = widget.repository ?? LiveMapRepository();
  late Stream<PublishedEventView?> _event;
  late Stream<List<MapGroupView>> _groups;
  late Stream<List<MapRouteView>> _routes;
  late Stream<Map<String, LiveGroupPosition>> _live;
  late Stream<Map<String, TrackingPresence>> _states;
  Timer? _clock;
  @override
  void initState() {
    super.initState();
    _subscribe();
    _clock = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted) setState(() {});
    });
  }

  void _subscribe() {
    _event = widget.publishedEvent == null
        ? _repo.event(widget.eventId)
        : Stream.value(widget.publishedEvent);
    _groups = _repo.groups(widget.eventId);
    _routes = widget.publishedEvent == null
        ? _repo.routes(widget.eventId)
        : Stream.value(const []);
    _live = _repo.live(widget.eventId);
    _states = _repo.trackingStates(widget.eventId);
  }

  @override
  void didUpdateWidget(covariant EventMapView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.eventId != widget.eventId ||
        oldWidget.publishedEvent != widget.publishedEvent) {
      _subscribe();
    }
  }

  @override
  void dispose() {
    _clock?.cancel();
    super.dispose();
  }

  Widget _message(String message) => Center(
    child: Padding(padding: const EdgeInsets.all(20), child: Text(message)),
  );
  @override
  Widget build(BuildContext context) => StreamBuilder<PublishedEventView?>(
    stream: _event,
    builder: (context, eventSnap) {
      if (eventSnap.hasError) {
        return _message(feedErrorMessage(eventSnap.error!, 'Event details'));
      }
      if (!eventSnap.hasData) {
        return eventSnap.connectionState == ConnectionState.waiting
            ? const Center(child: CircularProgressIndicator())
            : _message('This event is no longer available.');
      }
      final event = eventSnap.data!;
      return StreamBuilder<List<MapGroupView>>(
        stream: _groups,
        builder: (context, groupSnap) {
          if (widget.groupId != null) {
            if (groupSnap.hasError) {
              return _message(
                feedErrorMessage(groupSnap.error!, 'Group details'),
              );
            }
            if (!groupSnap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
          }
          final allGroups = groupSnap.hasError
              ? const <MapGroupView>[]
              : groupSnap.data ?? const <MapGroupView>[];
          final groups = widget.groupId == null
              ? allGroups
              : allGroups.where((g) => g.id == widget.groupId).toList();
          final routeId = groups.length == 1 && widget.groupId != null
              ? groups.first.routeId
              : event.routeId;
          if (widget.groupId != null && groups.isEmpty) {
            return _message(
              'Your assigned group is unavailable. Check your membership with the organizer.',
            );
          }
          if (routeId.isEmpty) {
            if (widget.groupId != null) {
              return _message(
                'Your group has no assigned route. Ask the organizer to finish group setup.',
              );
            }
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: widget.publishedEvent != null
                    ? const PrimaryRouteNotice()
                    : StreamBuilder<List<MapRouteView>>(
                        stream: _routes,
                        builder: (context, routes) {
                          if (routes.hasError) {
                            return Text(
                              feedErrorMessage(routes.error!, 'Routes'),
                            );
                          }
                          if (!routes.hasData) {
                            return const CircularProgressIndicator();
                          }
                          return PrimaryRouteNotice(
                            hasRoutes: routes.data!.isNotEmpty,
                          );
                        },
                      ),
              ),
            );
          }
          return _RouteMap(
            key: ValueKey('${widget.eventId}:$routeId:${widget.groupId}'),
            repo: _repo,
            event: event,
            routeId: routeId,
            routes: _routes,
            groups: groups,
            live: _live,
            states: _states,
            groupsLoading: groupSnap.connectionState == ConnectionState.waiting,
            groupError: groupSnap.hasError
                ? feedErrorMessage(groupSnap.error!, 'Group details')
                : null,
          );
        },
      );
    },
  );
}

class _RouteMap extends StatefulWidget {
  final LiveMapRepository repo;
  final PublishedEventView event;
  final String routeId;
  final Stream<List<MapRouteView>> routes;
  final List<MapGroupView> groups;
  final Stream<Map<String, LiveGroupPosition>> live;
  final Stream<Map<String, TrackingPresence>> states;
  final String? groupError;
  final bool groupsLoading;
  const _RouteMap({
    super.key,
    required this.repo,
    required this.event,
    required this.routeId,
    required this.routes,
    required this.groups,
    required this.live,
    required this.states,
    this.groupError,
    this.groupsLoading = false,
  });
  @override
  State<_RouteMap> createState() => _RouteMapState();
}

class _RouteMapState extends State<_RouteMap> {
  late final _route = widget.repo.route(widget.routeId);
  late final _stops = widget.repo.stops(widget.routeId);
  @override
  Widget build(BuildContext context) => StreamBuilder<MapRouteView?>(
    stream: _route,
    builder: (context, routeSnap) {
      if (routeSnap.hasError) {
        return Center(
          child: Text(feedErrorMessage(routeSnap.error!, 'Route details')),
        );
      }
      if (routeSnap.connectionState == ConnectionState.waiting) {
        return const Center(child: CircularProgressIndicator());
      }
      final route = routeSnap.data;
      if (route == null || route.eventId != widget.event.id) {
        return const Center(
          child: Text(
            'The selected route is unavailable or belongs to another event. Ask the organizer to check route synchronization.',
          ),
        );
      }
      return StreamBuilder<List<MapStopView>>(
        stream: _stops,
        builder: (context, stopSnap) => StreamBuilder<Map<String, LiveGroupPosition>>(
          stream: widget.live,
          builder: (context, liveSnap) => StreamBuilder<Map<String, TrackingPresence>>(
            stream: widget.states,
            builder: (context, statusSnap) => StreamBuilder<List<MapRouteView>>(
              stream: widget.routes,
              builder: (context, routesSnap) {
                final live = liveSnap.hasError
                    ? const <String, LiveGroupPosition>{}
                    : liveSnap.data ?? const <String, LiveGroupPosition>{};
                final selectedLive = {
                  for (final group in widget.groups)
                    if (live.containsKey(group.id)) group.id: live[group.id]!,
                };
                return Column(
                  children: [
                    Expanded(
                      child: ProcessionMap(
                        route: route,
                        additionalRoutes: routesSnap.hasError
                            ? const []
                            : routesSnap.data ?? const [],
                        stops: stopSnap.hasError
                            ? const []
                            : stopSnap.data ?? const [],
                        groups: widget.groups,
                        live: selectedLive,
                      ),
                    ),
                    SizedBox(
                      height: 150,
                      child: ListView(
                        padding: const EdgeInsets.all(12),
                        children: [
                          Text(
                            '${widget.event.name} · ${widget.event.status}',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          if (route.encodedPolyline.isEmpty)
                            const Text(
                              'Route geometry has not been drawn yet; available stops and groups are shown.',
                            ),
                          if (!widget.repo.isSignedIn)
                            const Text(
                              'Sign in with an active account to view live groups. This public preview shows the route and stops only.',
                            ),
                          if (widget.repo.isSignedIn &&
                              widget.groups.isEmpty &&
                              !widget.groupsLoading &&
                              widget.groupError == null)
                            const Text(
                              'No groups are available for this event.',
                            ),
                          if (widget.groupError != null)
                            Text(widget.groupError!),
                          if (widget.groupsLoading)
                            const Text('Loading groups…'),
                          if (liveSnap.hasError)
                            Text(
                              feedErrorMessage(
                                liveSnap.error!,
                                'Live positions',
                              ),
                            ),
                          if (stopSnap.hasError)
                            Text(
                              feedErrorMessage(stopSnap.error!, 'Stop points'),
                            ),
                          if (statusSnap.hasError)
                            Text(
                              feedErrorMessage(
                                statusSnap.error!,
                                'Tracking states',
                              ),
                            ),
                          if (routesSnap.hasError)
                            Text(
                              feedErrorMessage(
                                routesSnap.error!,
                                'Additional routes',
                              ),
                            ),
                          for (final group in widget.groups)
                            GroupTrackingSummary(
                              group: group,
                              presence: statusSnap.data?[group.id],
                              position: live[group.id],
                              trackingLoading:
                                  statusSnap.connectionState ==
                                  ConnectionState.waiting,
                              gpsLoading:
                                  liveSnap.connectionState ==
                                  ConnectionState.waiting,
                              trackingError: statusSnap.hasError,
                              gpsError: liveSnap.hasError,
                            ),
                          const Text(
                            'Blue stops · colored group markers · “You” is device-only and is never uploaded.',
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      );
    },
  );
}
