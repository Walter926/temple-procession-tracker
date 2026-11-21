import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:temple_procession_tracker_app/core/models/map_view_records.dart';
import 'package:temple_procession_tracker_app/features/map/widgets/group_marker_factory.dart';

LiveGroupPosition position(
  double latitude, {
  DateTime? recordedAt,
  double heading = 0,
}) => LiveGroupPosition(
  userId: 'leader',
  latitude: latitude,
  longitude: -123,
  headingDegrees: heading,
  speedMetersPerSecond: 1,
  accuracyMeters: 8,
  recordedAt: recordedAt,
);

MapGroupView group(String id, {String status = 'active'}) => MapGroupView(
  id: id,
  eventId: 'event',
  routeId: 'route',
  name: id,
  color: '#3169A6',
  status: status,
  startingStopPointId: '',
  endingStopPointId: '',
);

void main() {
  testWidgets(
    'initial and unchanged heartbeat data never start an idle timer',
    (tester) async {
      var now = DateTime.now();
      final animator = GroupMarkerAnimator(now: () => now);
      addTearDown(animator.dispose);
      var notifications = 0;
      animator.addListener(() => notifications++);
      animator.update({'one': position(49, recordedAt: now)});
      expect(animator.current('one'), const LatLng(49, -123));
      expect(animator.isAnimating, isFalse);
      expect(notifications, 1);
      now = now.add(const Duration(seconds: 5));
      animator.update({'one': position(49, recordedAt: now, heading: 90)});
      await tester.pump(const Duration(seconds: 1));
      expect(animator.isAnimating, isFalse);
      expect(notifications, 1);
    },
  );

  testWidgets(
    'only moving groups interpolate; completed heartbeats stay idle',
    (tester) async {
      var now = DateTime.now();
      final animator = GroupMarkerAnimator(now: () => now);
      addTearDown(animator.dispose);
      final cache = GroupMarkerCache();
      addTearDown(cache.clear);
      var live = {'one': position(49), 'two': position(48)};
      final groups = [group('one'), group('two')];
      Set<Marker> markers() => cache.update(
        groups: groups,
        live: live,
        animator: animator,
        onTap: (_) {},
      );

      animator.update(live);
      final stationary = markers().last;
      live = {'one': position(50), 'two': position(48)};
      animator.update(live);
      expect(animator.isAnimating, isTrue);
      now = now.add(const Duration(milliseconds: 450));
      await tester.pump(const Duration(milliseconds: 450));
      expect(animator.current('one')!.latitude, closeTo(49.5, 0.000001));
      expect(animator.current('two'), const LatLng(48, -123));
      expect(markers().last, same(stationary));
      final middle = markers().first;
      now = now.add(const Duration(milliseconds: 450));
      await tester.pump(const Duration(milliseconds: 450));
      expect(animator.current('one'), const LatLng(50, -123));
      expect(animator.isAnimating, isFalse);
      final finalMarkers = markers();
      expect(finalMarkers.first, isNot(same(middle)));
      expect(finalMarkers.last, same(stationary));
      var notifications = 0;
      animator.addListener(() => notifications++);
      animator.update({'one': position(50), 'two': position(48)});
      await tester.pump(const Duration(seconds: 2));
      expect(animator.isAnimating, isFalse);
      expect(notifications, 0);
      expect(markers(), same(finalMarkers));
    },
  );

  testWidgets('unchanged in-flight heartbeat does not reset motion start', (
    tester,
  ) async {
    var now = DateTime.now();
    final animator = GroupMarkerAnimator(now: () => now);
    addTearDown(animator.dispose);
    animator.update({'one': position(49)});
    animator.update({'one': position(50)});
    now = now.add(const Duration(milliseconds: 450));
    await tester.pump(const Duration(milliseconds: 450));
    animator.update({'one': position(50, recordedAt: now)});
    now = now.add(const Duration(milliseconds: 450));
    await tester.pump(const Duration(milliseconds: 450));
    expect(animator.current('one'), const LatLng(50, -123));
    expect(animator.isAnimating, isFalse);
  });

  testWidgets('retargeting begins at the interpolated point without jumping', (
    tester,
  ) async {
    var now = DateTime.now();
    final animator = GroupMarkerAnimator(now: () => now);
    addTearDown(animator.dispose);
    animator.update({'one': position(49)});
    animator.update({'one': position(50)});
    now = now.add(const Duration(milliseconds: 450));
    await tester.pump(const Duration(milliseconds: 450));
    animator.update({'one': position(51)});
    expect(animator.current('one')!.latitude, closeTo(49.5, 0.000001));
    now = now.add(const Duration(milliseconds: 450));
    await tester.pump(const Duration(milliseconds: 450));
    expect(animator.current('one')!.latitude, closeTo(50.25, 0.000001));
    now = now.add(const Duration(milliseconds: 450));
    await tester.pump(const Duration(milliseconds: 450));
    expect(animator.current('one'), const LatLng(51, -123));
    expect(animator.isAnimating, isFalse);
  });

  testWidgets(
    'invalid/removal data clears motion and dispose cancels callbacks',
    (tester) async {
      var now = DateTime.now();
      final animator = GroupMarkerAnimator(now: () => now);
      var notifications = 0;
      animator.addListener(() => notifications++);
      animator.update({'one': position(49), 'two': position(48)});
      animator.update({'one': position(50), 'two': position(48)});
      animator.update({'one': position(double.nan)});
      expect(animator.current('one'), isNull);
      expect(animator.current('two'), isNull);
      expect(animator.isAnimating, isFalse);
      animator.update({'one': position(49)});
      animator.update({'one': position(50)});
      expect(animator.isAnimating, isTrue);
      animator.dispose();
      final afterDispose = notifications;
      now = now.add(const Duration(seconds: 2));
      await tester.pump(const Duration(seconds: 2));
      animator.update({'one': position(51)});
      expect(animator.current('one'), isNull);
      expect(animator.isAnimating, isFalse);
      expect(notifications, afterDispose);
    },
  );

  test(
    'marker cache refreshes stale/heading/status without restarting motion',
    () {
      final now = DateTime.now();
      final animator = GroupMarkerAnimator();
      addTearDown(animator.dispose);
      final cache = GroupMarkerCache();
      addTearDown(cache.clear);
      var live = {'one': position(49, recordedAt: now, heading: 90)};
      var groups = [group('one')];
      var tapped = '';
      Marker marker() => cache
          .update(
            groups: groups,
            live: live,
            animator: animator,
            onTap: (id) => tapped = id,
          )
          .single;
      animator.update(live);
      final fresh = marker();
      expect(fresh.alpha, 1);
      expect(fresh.rotation, 90);
      expect(marker(), same(fresh));
      live = {
        'one': position(
          49,
          recordedAt: now.subtract(const Duration(seconds: 46)),
          heading: 90,
        ),
      };
      animator.update(live);
      final stale = marker();
      expect(stale.alpha, 0.55);
      expect(stale.rotation, 0);
      expect(stale.infoWindow.snippet, contains('GPS STALE'));
      groups = [group('one', status: 'completed')];
      expect(marker().infoWindow.snippet, contains('COMPLETED'));
      marker().onTap!();
      expect(tapped, 'one');
      expect(animator.isAnimating, isFalse);
      live = {};
      animator.update(live);
      expect(
        cache.update(
          groups: groups,
          live: live,
          animator: animator,
          onTap: (_) {},
        ),
        isEmpty,
      );
    },
  );
}
