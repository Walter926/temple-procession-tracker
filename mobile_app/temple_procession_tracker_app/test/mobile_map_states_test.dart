import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
// Use the already-resolved plugin testing boundary without changing dependencies.
// ignore: depend_on_referenced_packages
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';
import 'package:temple_procession_tracker_app/core/models/map_view_records.dart';
import 'package:temple_procession_tracker_app/core/repositories/live_map_repository.dart';
import 'package:temple_procession_tracker_app/features/map/event_map_screen.dart';
import 'package:temple_procession_tracker_app/features/map/widgets/group_tracking_summary.dart';

class MapRepository implements LiveMapRepository {
  @override
  bool isSignedIn = true;
  final events = StreamController<PublishedEventView?>.broadcast();
  final routeIds = <String>[];
  int routeLists = 0;
  List<MapRouteView> availableRoutes = [];
  Object? groupError;
  MapRouteView? selectedRoute;
  @override
  Stream<PublishedEventView?> event(String id) => events.stream;
  @override
  Stream<List<MapGroupView>> groups(String id) =>
      groupError == null ? Stream.value([]) : Stream.error(groupError!);
  @override
  Stream<List<MapRouteView>> routes(String eventId) {
    routeLists++;
    return Stream.value(availableRoutes);
  }

  @override
  Stream<MapRouteView?> route(String id) {
    routeIds.add(id);
    return Stream.value(selectedRoute);
  }

  @override
  Stream<List<MapStopView>> stops(String id) => Stream.value([]);
  @override
  Stream<Map<String, LiveGroupPosition>> live(String id) => Stream.value({});
  @override
  Stream<Map<String, TrackingPresence>> trackingStates(String id) =>
      Stream.value({});
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Only native drawing is stubbed: widget, camera and location flows stay real.
class MapTransport extends MethodChannelGoogleMapsFlutter {
  final calls = <MethodCall>[];
  final channels = <MethodChannel>[];
  @override
  Future<void> updateGroundOverlays(
    GroundOverlayUpdates updates, {
    required int mapId,
  }) async {}
  @override
  Widget buildViewWithConfiguration(
    int creationId,
    PlatformViewCreatedCallback onPlatformViewCreated, {
    required MapWidgetConfiguration widgetConfiguration,
    MapObjects mapObjects = const MapObjects(),
    MapConfiguration mapConfiguration = const MapConfiguration(),
  }) {
    if (channels.isEmpty) {
      final channel = MethodChannel(
        'plugins.flutter.io/google_maps_$creationId',
      );
      channels.add(channel);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            calls.add(call);
            return null;
          });
      onPlatformViewCreated(creationId);
    }
    return const SizedBox.expand();
  }
}

PublishedEventView event([String routeId = '']) => PublishedEventView(
  id: 'event',
  name: 'Procession',
  status: 'active',
  routeId: routeId,
  cityRegion: 'City',
);
const group = MapGroupView(
  id: 'group',
  eventId: 'event',
  routeId: 'primary',
  name: 'Team',
  color: '#3169A6',
  status: 'waiting',
  startingStopPointId: '',
  endingStopPointId: '',
);

void main() {
  testWidgets(
    'anonymous public map fits the route and recenters device-only You after permission',
    (tester) async {
      final original = GoogleMapsFlutterPlatform.instance;
      final maps = MapTransport();
      GoogleMapsFlutterPlatform.instance = maps;
      const gpsChannel = MethodChannel('flutter.baseflow.com/geolocator');
      final gpsCalls = <String>[];
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(gpsChannel, (call) async {
        gpsCalls.add(call.method);
        return switch (call.method) {
          'isLocationServiceEnabled' => true,
          'checkPermission' => LocationPermission.denied.index,
          'requestPermission' => LocationPermission.whileInUse.index,
          'getCurrentPosition' => {
            'latitude': 49.123,
            'longitude': -123.123,
            'accuracy': 8.0,
            'timestamp': DateTime.now().millisecondsSinceEpoch,
          },
          _ => throw StateError('Unexpected location action: ${call.method}'),
        };
      });
      addTearDown(() {
        GoogleMapsFlutterPlatform.instance = original;
        messenger.setMockMethodCallHandler(gpsChannel, null);
        for (final channel in maps.channels) {
          messenger.setMockMethodCallHandler(channel, null);
        }
      });
      final repo = MapRepository()
        ..isSignedIn = false
        ..selectedRoute = const MapRouteView(
          id: 'primary',
          eventId: 'event',
          name: 'Primary',
          color: '#3169A6',
          encodedPolyline: '_p~iF~ps|U_ulLnnqC',
        );
      addTearDown(repo.events.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: EventMapView(
              eventId: 'event',
              publishedEvent: event('primary'),
              repository: repo,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        gpsCalls,
        isEmpty,
        reason: 'Viewing a public route never requests GPS automatically.',
      );
      maps.calls.clear();
      await tester.tap(find.text('Fit Route'));
      await tester.pumpAndSettle();
      expect(
        maps.calls.where((call) => call.method == 'camera#animate'),
        hasLength(1),
      );
      await tester.tap(find.text('Recenter on You'));
      await tester.pumpAndSettle();
      expect(gpsCalls, [
        'isLocationServiceEnabled',
        'checkPermission',
        'requestPermission',
        'getCurrentPosition',
      ]);
      final map = tester.widget<GoogleMap>(find.byType(GoogleMap));
      final you = map.markers.single;
      expect(you.markerId.value, 'you');
      expect(you.position, const LatLng(49.123, -123.123));
      expect(you.infoWindow.snippet, startsWith('Not uploaded'));
      expect(map.myLocationEnabled, isFalse);
      expect(repo.routeLists, 0);
      expect(
        maps.calls.where((call) => call.method == 'camera#animate'),
        hasLength(2),
      );
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
  testWidgets('empty and legacy-unsynchronized primary states are distinct', (
    tester,
  ) async {
    final repo = MapRepository();
    addTearDown(repo.events.close);
    await tester.pumpWidget(
      MaterialApp(
        home: EventMapView(eventId: 'event', repository: repo),
      ),
    );
    repo.events.add(event());
    await tester.pumpAndSettle();
    expect(find.textContaining('No routes have been created'), findsOneWidget);
    expect(repo.routeIds, isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
    repo.availableRoutes = [
      const MapRouteView(
        id: 'existing',
        eventId: 'event',
        name: 'Existing',
        color: '',
        encodedPolyline: '',
      ),
    ];
    await tester.pumpWidget(
      MaterialApp(
        home: EventMapView(eventId: 'event', repository: repo),
      ),
    );
    repo.events.add(event());
    await tester.pumpAndSettle();
    expect(
      find.textContaining('primary route is still synchronizing'),
      findsOneWidget,
    );
    expect(
      repo.routeIds,
      isEmpty,
      reason: 'Never guess a local primary from route order.',
    );
  });
  testWidgets(
    'a repaired reference updates in-place and manual selections remain authoritative',
    (tester) async {
      final repo = MapRepository();
      addTearDown(repo.events.close);
      await tester.pumpWidget(
        MaterialApp(
          home: EventMapView(eventId: 'event', repository: repo),
        ),
      );
      repo.events.add(event());
      await tester.pumpAndSettle();
      repo.events.add(event('repaired'));
      await tester.pumpAndSettle();
      expect(repo.routeIds, ['repaired']);
      repo.events.add(event('manual-older-route'));
      await tester.pumpAndSettle();
      expect(repo.routeIds, ['repaired', 'manual-older-route']);
      expect(
        find.textContaining('selected route is unavailable'),
        findsOneWidget,
      );
    },
  );
  testWidgets('public missing-primary preview never lists private routes', (
    tester,
  ) async {
    final repo = MapRepository()..isSignedIn = false;
    addTearDown(repo.events.close);
    await tester.pumpWidget(
      MaterialApp(
        home: EventMapView(
          eventId: 'event',
          publishedEvent: event(),
          repository: repo,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(repo.routeLists, 0);
    expect(repo.routeIds, isEmpty);
    expect(
      find.textContaining('Routes are selected automatically'),
      findsOneWidget,
    );
  });
  testWidgets('group access failure does not fall back to the event primary', (
    tester,
  ) async {
    final repo = MapRepository()
      ..groupError = FirebaseException(
        plugin: 'cloud_firestore',
        code: 'permission-denied',
      );
    addTearDown(repo.events.close);
    await tester.pumpWidget(
      MaterialApp(
        home: EventMapView(
          eventId: 'event',
          groupId: 'group',
          repository: repo,
        ),
      ),
    );
    repo.events.add(event('event-primary'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Check your sign-in and event access'),
      findsOneWidget,
    );
    expect(repo.routeIds, isEmpty);
  });
  testWidgets('normal waiting is not unknown or a failed GPS read', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(home: GroupTrackingSummary(group: group)),
    );
    expect(
      find.textContaining(
        'Tracking not started · GPS waiting for the primary leader',
      ),
      findsOneWidget,
    );
    await tester.pumpWidget(
      const MaterialApp(
        home: GroupTrackingSummary(
          group: group,
          trackingError: true,
          gpsError: true,
        ),
      ),
    );
    expect(
      find.textContaining('Tracking unavailable · GPS unavailable'),
      findsOneWidget,
    );
    expect(find.textContaining('waiting for the primary leader'), findsNothing);
  });
  testWidgets(
    'loading and disconnected heartbeat are not a never-started group',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: GroupTrackingSummary(
            group: group,
            trackingLoading: true,
            gpsLoading: true,
          ),
        ),
      );
      expect(
        find.textContaining('Tracking loading · GPS loading'),
        findsOneWidget,
      );
      await tester.pumpWidget(
        MaterialApp(
          home: GroupTrackingSummary(
            group: group,
            presence: TrackingPresence(
              'active',
              DateTime.now().subtract(const Duration(minutes: 2)),
            ),
          ),
        ),
      );
      expect(find.textContaining('Tracking disconnected'), findsOneWidget);
    },
  );
}
