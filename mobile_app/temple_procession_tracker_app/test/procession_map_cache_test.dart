import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:temple_procession_tracker_app/core/models/map_view_records.dart';
import 'package:temple_procession_tracker_app/features/map/widgets/procession_map_cache.dart';

MapRouteView route(String id, String geometry, {String color = '#3169A6'}) =>
    MapRouteView(
      id: id,
      eventId: 'event',
      name: id,
      color: color,
      encodedPolyline: geometry,
    );

MapStopView stop(
  String id, {
  double latitude = 49,
  String name = 'Temple',
  String description = 'Entrance',
  int order = 1,
}) => MapStopView(
  id: id,
  routeId: 'route',
  name: name,
  description: description,
  order: order,
  latitude: latitude,
  longitude: -123,
  radiusMeters: 100,
);

void main() {
  late ProcessionMapCache cache;
  late Map<String, int> decodes;
  setUp(() {
    decodes = {};
    cache = ProcessionMapCache(
      decode: (encoded) {
        decodes.update(encoded, (count) => count + 1, ifAbsent: () => 1);
        if (encoded == 'malformed') throw const FormatException('Bad geometry');
        final latitude = encoded == 'new' ? 50.0 : 49.0;
        return [LatLng(latitude, -123), LatLng(latitude + 0.01, -123.01)];
      },
    );
  });
  tearDown(() => cache.clear());

  test('primary/additional geometry decodes once across unchanged updates', () {
    cache.update(
      route: route('primary', 'first'),
      additionalRoutes: [route('extra', 'second'), route('primary', 'first')],
      stops: [stop('temple')],
    );
    final path = cache.path;
    final polylines = cache.polylines;
    final markers = cache.stopMarkers;
    final extras = cache.additionalPoints;
    for (var i = 0; i < 100; i++) {
      cache.update(
        route: route('primary', 'first'),
        additionalRoutes: [route('extra', 'second'), route('primary', 'first')],
        stops: [stop('temple')],
      );
      expect(cache.path, same(path));
      expect(cache.polylines, same(polylines));
      expect(cache.stopMarkers, same(markers));
      expect(cache.additionalPoints, same(extras));
    }
    expect(decodes, {'first': 1, 'second': 1});
    expect(cache.polylines.length, 2);
    expect(() => cache.path.add(const LatLng(0, 0)), throwsUnsupportedError);
  });

  test(
    'content, colors and additional route changes invalidate independently',
    () {
      cache.update(
        route: route('primary', 'first'),
        additionalRoutes: [route('extra', 'second')],
      );
      final originalPath = cache.path;
      final originalLines = cache.polylines;
      cache.update(
        route: route('primary', 'first', color: '#FF0000'),
        additionalRoutes: [route('extra', 'second', color: '#00FF00')],
      );
      expect(cache.path, same(originalPath));
      expect(cache.polylines, isNot(same(originalLines)));
      expect(cache.polylines.first.color, const Color(0xFFFF0000));
      expect(cache.polylines.last.color, const Color(0xFF00FF00));
      expect(decodes, {'first': 1, 'second': 1});

      cache.update(
        route: route('primary', 'new'),
        additionalRoutes: [route('extra', 'second'), route('shared', 'new')],
      );
      expect(cache.path.first.latitude, 50);
      expect(cache.path, same(cache.polylines.last.points));
      expect(decodes, {'first': 1, 'second': 1, 'new': 1});
      expect(cache.additionalPoints.length, 4);

      cache.update(route: route('replacement', 'new'));
      expect(cache.path.first.latitude, 50);
      expect(cache.polylines.length, 1);
      expect(cache.additionalPoints, isEmpty);
      expect(decodes['new'], 1);
      // Old, unused content is evicted rather than accumulating indefinitely.
      cache.update(route: route('primary', 'first'));
      expect(decodes['first'], 2);
    },
  );

  test('malformed geometry is cached and repaired content is decoded', () {
    for (var i = 0; i < 10; i++) {
      cache.update(
        route: route('primary', 'malformed'),
        additionalRoutes: [route('extra', 'malformed')],
      );
    }
    expect(decodes, {'malformed': 1});
    expect(cache.path, isEmpty);
    expect(cache.polylines, isEmpty);
    cache.update(route: route('primary', 'new'));
    expect(cache.path.length, 2);
    expect(cache.polylines.length, 1);
  });

  test(
    'history content changes are detected and route fallback stays cached',
    () {
      cache.update(route: route('primary', 'first'));
      final routePath = cache.path;
      final history = [const LatLng(51, -123), const LatLng(52, -123)];
      cache.update(route: route('primary', 'first'), historyPath: history);
      expect(cache.path, history);
      expect(cache.path, isNot(same(history)));
      history[1] = const LatLng(53, -123);
      cache.update(route: route('primary', 'first'), historyPath: history);
      expect(cache.path.last.latitude, 53);
      expect(cache.polylines.single.points.last.latitude, 53);
      cache.update(route: route('primary', 'first'));
      expect(cache.path, same(routePath));
      expect(decodes, {'first': 1});
    },
  );

  test(
    'only changed stops rebuild; additions, ordering and removal refresh fit data',
    () {
      cache.update(stops: [stop('first'), stop('second', order: 2)]);
      final first = cache.stopMarkers.first;
      final second = cache.stopMarkers.last;
      cache.update(
        route: route('primary', 'new'),
        stops: [
          stop(
            'first',
            latitude: 50,
            name: 'Updated',
            description: 'West',
            order: 3,
          ),
          stop('second', order: 2),
        ],
      );
      expect(cache.stopMarkers.first, isNot(same(first)));
      expect(cache.stopMarkers.last, same(second));
      expect(cache.stopMarkers.first.infoWindow.title, '3. Updated');
      expect(cache.stopMarkers.first.infoWindow.snippet, 'West');
      expect(cache.stopPoints.first.latitude, 50);
      cache.update(
        stops: [stop('second', order: 2), stop('third', latitude: 51)],
      );
      expect(cache.stopMarkers.first, same(second));
      expect(cache.stopMarkers.map((marker) => marker.markerId.value), [
        'stop:second',
        'stop:third',
      ]);
      expect(cache.stopPoints.last.latitude, 51);
      cache.update();
      expect(cache.stopMarkers, isEmpty);
      expect(cache.stopPoints, isEmpty);
      expect(cache.path, isEmpty);
      expect(cache.polylines, isEmpty);
    },
  );

  test('clear releases retained overlays and geometry', () {
    cache.update(route: route('primary', 'first'), stops: [stop('temple')]);
    cache.clear();
    expect(cache.path, isEmpty);
    expect(cache.polylines, isEmpty);
    expect(cache.stopMarkers, isEmpty);
    expect(cache.stopPoints, isEmpty);
    cache.update(route: route('primary', 'first'), stops: [stop('temple')]);
    expect(decodes['first'], 2);
    expect(cache.stopMarkers.length, 1);
  });
}
