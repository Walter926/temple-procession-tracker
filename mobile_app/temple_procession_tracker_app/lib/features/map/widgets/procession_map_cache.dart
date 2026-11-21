import 'package:flutter/foundation.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../core/models/map_view_records.dart';
import '../../../core/utils/polyline_decoder.dart';
import 'group_marker_factory.dart';

typedef _RouteVersion = ({String id, String encoded, String color});
typedef _StopVersion = ({
  double latitude,
  double longitude,
  int order,
  String name,
  String description,
});

/// Static overlays are refreshed when their content changes, never by a frame.
/// Geometry is shared by encoded content and limited to the current route set.
class ProcessionMapCache {
  ProcessionMapCache({List<LatLng> Function(String)? decode})
    : _decode = decode ?? PolylineDecoder.decode;

  final List<LatLng> Function(String) _decode;
  final Map<String, List<LatLng>> _geometry = {};
  final Map<String, (_StopVersion, Marker)> _stops = {};
  _RouteVersion? _primaryVersion;
  List<_RouteVersion> _additionalVersions = const [];
  List<LatLng> _history = const [];
  List<String> _stopOrder = const [];

  List<LatLng> path = const [];
  List<LatLng> stopPoints = const [];
  List<LatLng> additionalPoints = const [];
  Set<Polyline> polylines = const {};
  Set<Marker> stopMarkers = const {};

  static _RouteVersion _version(MapRouteView route) =>
      (id: route.id, encoded: route.encodedPolyline, color: route.color);

  List<LatLng> _points(String encoded) => _geometry.putIfAbsent(encoded, () {
    try {
      return List<LatLng>.unmodifiable(_decode(encoded));
    } catch (_) {
      // Cache malformed geometry too, rather than retrying it every heartbeat.
      return const <LatLng>[];
    }
  });

  void update({
    MapRouteView? route,
    List<MapRouteView> additionalRoutes = const [],
    List<LatLng> historyPath = const [],
    List<MapStopView> stops = const [],
  }) {
    final primary = route == null ? null : _version(route);
    final additional = additionalRoutes
        .where((item) => item.id != route?.id)
        .map(_version)
        .toList();
    if (primary != _primaryVersion ||
        !listEquals(additional, _additionalVersions) ||
        !listEquals(historyPath, _history)) {
      _primaryVersion = primary;
      _additionalVersions = additional;
      _history = List<LatLng>.unmodifiable(historyPath);
      path = _history.isNotEmpty
          ? _history
          : primary == null
          ? const []
          : _points(primary.encoded);
      additionalPoints = List<LatLng>.unmodifiable([
        for (final item in additional) ..._points(item.encoded),
      ]);
      polylines = Set<Polyline>.unmodifiable({
        if (path.length >= 2)
          Polyline(
            polylineId: const PolylineId('primary'),
            points: path,
            color: GroupMarkerFactory.parseColor(route?.color ?? '#3169A6'),
            width: 5,
          ),
        for (final item in additional)
          if (_points(item.encoded).length >= 2)
            Polyline(
              polylineId: PolylineId(item.id),
              points: _points(item.encoded),
              color: GroupMarkerFactory.parseColor(item.color),
              width: 4,
            ),
      });
      final retained = {
        if (primary != null) primary.encoded,
        for (final item in additional) item.encoded,
      };
      _geometry.removeWhere((encoded, _) => !retained.contains(encoded));
    }

    final order = [for (final stop in stops) stop.id];
    final ids = order.toSet();
    var stopsChanged = !listEquals(order, _stopOrder);
    _stops.removeWhere((id, _) => !ids.contains(id));
    for (final stop in stops) {
      final version = (
        latitude: stop.latitude,
        longitude: stop.longitude,
        order: stop.order,
        name: stop.name,
        description: stop.description,
      );
      if (_stops[stop.id]?.$1 == version) continue;
      stopsChanged = true;
      _stops[stop.id] = (
        version,
        Marker(
          markerId: MarkerId('stop:${stop.id}'),
          position: LatLng(stop.latitude, stop.longitude),
          icon: BitmapDescriptor.defaultMarkerWithHue(
            BitmapDescriptor.hueAzure,
          ),
          infoWindow: InfoWindow(
            title: '${stop.order}. ${stop.name}',
            snippet: stop.description,
          ),
        ),
      );
    }
    if (stopsChanged) {
      _stopOrder = order;
      stopMarkers = Set<Marker>.unmodifiable([
        for (final id in order) _stops[id]!.$2,
      ]);
      stopPoints = List<LatLng>.unmodifiable([
        for (final id in order) _stops[id]!.$2.position,
      ]);
    }
  }

  void clear() {
    _geometry.clear();
    _stops.clear();
    _primaryVersion = null;
    _additionalVersions = const [];
    _history = const [];
    _stopOrder = const [];
    path = stopPoints = additionalPoints = const [];
    polylines = const {};
    stopMarkers = const {};
  }
}
