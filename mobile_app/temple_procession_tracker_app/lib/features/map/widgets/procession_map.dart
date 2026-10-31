import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../core/models/map_view_records.dart';
import '../../../core/utils/polyline_decoder.dart';

class ProcessionMap extends StatelessWidget {
  final MapRouteView? route;
  final List<MapStopView> stops;
  final List<MapGroupView> groups;
  final Map<String, LiveGroupPosition> live;
  final ValueChanged<MapGroupView>? onGroupTap;
  const ProcessionMap({super.key, this.route, this.stops = const [], this.groups = const [], this.live = const {}, this.onGroupTap});

  Color _color(String value) { try { return Color(int.parse(value.replaceFirst('#', 'FF'), radix: 16)); } catch (_) { return Colors.blue; } }
  double _hue(String value) => HSVColor.fromColor(_color(value)).hue;
  List<LatLng> _path() { try { return PolylineDecoder.decode(route?.encodedPolyline ?? ''); } catch (_) { return []; } }

  @override
  Widget build(BuildContext context) {
    final path = _path();
    final center = stops.isNotEmpty ? LatLng(stops.first.latitude, stops.first.longitude) : path.isNotEmpty ? path.first : const LatLng(49.1664, -123.1376);
    final markers = <Marker>{};
    for (final stop in stops) { markers.add(Marker(markerId: MarkerId('stop:${stop.id}'), position: LatLng(stop.latitude, stop.longitude), icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure), infoWindow: InfoWindow(title: '${stop.order}. ${stop.name}', snippet: stop.description))); }
    for (final group in groups) {
      final position = live[group.id];
      if (position == null || !position.valid) continue;
      markers.add(Marker(markerId: MarkerId('group:${group.id}'), position: LatLng(position.latitude, position.longitude), icon: BitmapDescriptor.defaultMarkerWithHue(_hue(group.color)), infoWindow: InfoWindow(title: group.name, snippet: '${group.status}${position.stale ? ' · STALE' : ''}'), onTap: () => onGroupTap?.call(group)));
    }
    return GoogleMap(key: ValueKey(route?.id ?? 'empty'), initialCameraPosition: CameraPosition(target: center, zoom: 13), markers: markers,
      polylines: path.length < 2 ? {} : {Polyline(polylineId: PolylineId(route!.id), points: path, color: _color(route!.color), width: 5)}, myLocationEnabled: false, compassEnabled: true, zoomControlsEnabled: true);
  }
}