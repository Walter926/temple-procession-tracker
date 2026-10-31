import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../core/models/map_view_records.dart';
import '../../../core/utils/polyline_decoder.dart';
import 'group_marker_factory.dart';

class ProcessionMap extends StatefulWidget {
  final MapRouteView? route;
  final List<MapStopView> stops;
  final List<MapGroupView> groups;
  final Map<String, LiveGroupPosition> live;
  final ValueChanged<MapGroupView>? onGroupTap;
  const ProcessionMap({super.key, this.route, this.stops = const [], this.groups = const [], this.live = const {}, this.onGroupTap});
  @override
  State<ProcessionMap> createState() => _ProcessionMapState();
}

class _ProcessionMapState extends State<ProcessionMap> {
  late final GroupMarkerAnimator animator;
  @override
  void initState() { super.initState(); animator = GroupMarkerAnimator()..update(widget.live); }
  @override
  void didUpdateWidget(covariant ProcessionMap oldWidget) { super.didUpdateWidget(oldWidget); animator.update(widget.live); }
  @override
  void dispose() { animator.dispose(); super.dispose(); }
  Color _color(String value) => GroupMarkerFactory.parseColor(value);
  List<LatLng> _path() { try { return PolylineDecoder.decode(widget.route?.encodedPolyline ?? ''); } catch (_) { return []; } }
  void _detail(MapGroupView group) {
    if (widget.onGroupTap != null) { widget.onGroupTap!(group); return; }
    final p = widget.live[group.id];
    showModalBottomSheet<void>(context: context, builder: (context) => Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [Text(group.name, style: Theme.of(context).textTheme.titleLarge), Text('Status: ${group.status}'), Text('Last update: ${p?.recordedAt?.toLocal().toString() ?? 'Unknown'}'), Text('Accuracy: ${p?.accuracyMeters.toStringAsFixed(1) ?? '—'} m'), if (p?.stale == true) const Text('STALE LOCATION', style: TextStyle(color: Colors.orange))])));
  }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: animator, builder: (context, child) {
    final path = _path();
    final center = widget.stops.isNotEmpty ? LatLng(widget.stops.first.latitude, widget.stops.first.longitude) : path.isNotEmpty ? path.first : const LatLng(49.1664, -123.1376);
    final markers = <Marker>{};
    for (final stop in widget.stops) { markers.add(Marker(markerId: MarkerId('stop:${stop.id}'), position: LatLng(stop.latitude, stop.longitude), icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure), infoWindow: InfoWindow(title: '${stop.order}. ${stop.name}', snippet: stop.description))); }
    for (final group in widget.groups) {
      final position = widget.live[group.id], point = animator.current(group.id);
      if (position == null || point == null || !position.valid) continue;
      markers.add(GroupMarkerFactory.create(group, position, point, () => _detail(group)));
    }
    return GoogleMap(key: ValueKey(widget.route?.id ?? 'empty'), initialCameraPosition: CameraPosition(target: center, zoom: 13), markers: markers,
      polylines: path.length < 2 ? {} : {Polyline(polylineId: PolylineId(widget.route!.id), points: path, color: _color(widget.route!.color), width: 5)}, myLocationEnabled: false, zoomControlsEnabled: true);
  });
}