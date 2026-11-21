import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../core/models/map_view_records.dart';
import 'group_marker_factory.dart';
import 'procession_map_cache.dart';

class ProcessionMap extends StatefulWidget {
  final MapRouteView? route;
  final List<MapRouteView> additionalRoutes;
  final List<LatLng> historyPath;
  final List<MapStopView> stops;
  final List<MapGroupView> groups;
  final Map<String, LiveGroupPosition> live;
  final ValueChanged<MapGroupView>? onGroupTap;
  const ProcessionMap({
    super.key,
    this.route,
    this.additionalRoutes = const [],
    this.historyPath = const [],
    this.stops = const [],
    this.groups = const [],
    this.live = const {},
    this.onGroupTap,
  });
  @override
  State<ProcessionMap> createState() => _ProcessionMapState();
}

class _ProcessionMapState extends State<ProcessionMap> {
  late final GroupMarkerAnimator animator;
  final _cache = ProcessionMapCache();
  final _groupMarkers = GroupMarkerCache();
  GoogleMapController? _controller;
  Timer? _staleClock;
  bool _fitted = false, _locating = false;
  Marker? _ownMarker;
  @override
  void initState() {
    super.initState();
    _updateStaticOverlays();
    animator = GroupMarkerAnimator()..update(widget.live);
    _staleClock = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void didUpdateWidget(covariant ProcessionMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    _updateStaticOverlays();
    animator.update(widget.live);
    if (oldWidget.route?.id != widget.route?.id) _fitted = false;
    if (!_fitted) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_fit(initial: true));
      });
    }
  }

  @override
  void dispose() {
    _staleClock?.cancel();
    _controller?.dispose();
    animator.dispose();
    _cache.clear();
    _groupMarkers.clear();
    super.dispose();
  }

  void _updateStaticOverlays() => _cache.update(
    route: widget.route,
    additionalRoutes: widget.additionalRoutes,
    historyPath: widget.historyPath,
    stops: widget.stops,
  );

  List<LatLng> _allPoints() => [
    ..._cache.path,
    ..._cache.additionalPoints,
    ..._cache.stopPoints,
    for (final point in widget.live.values)
      if (point.valid) LatLng(point.latitude, point.longitude),
  ];
  Future<void> _fit({bool initial = false}) async {
    final controller = _controller;
    final points = _allPoints();
    if (controller == null || points.isEmpty || (initial && _fitted)) return;
    _fitted =
        true; // Realtime updates never move a camera after the first dataset.
    try {
      if (points.length == 1) {
        await controller.animateCamera(
          CameraUpdate.newLatLngZoom(points.first, 15),
        );
        return;
      }
      var south = points.first.latitude,
          north = south,
          west = points.first.longitude,
          east = west;
      for (final point in points.skip(1)) {
        south = math.min(south, point.latitude);
        north = math.max(north, point.latitude);
        west = math.min(west, point.longitude);
        east = math.max(east, point.longitude);
      }
      if ((north - south).abs() < 0.00001 && (east - west).abs() < 0.00001) {
        await controller.animateCamera(
          CameraUpdate.newLatLngZoom(points.first, 15),
        );
      } else {
        await controller.animateCamera(
          CameraUpdate.newLatLngBounds(
            LatLngBounds(
              southwest: LatLng(south, west),
              northeast: LatLng(north, east),
            ),
            48,
          ),
        );
      }
    } catch (_) {
      /* A disposed or not-yet-laid-out map can still be fitted explicitly. */
    }
  }

  Future<void> _showOwnPosition() async {
    if (_locating) return;
    setState(() => _locating = true);
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        throw StateError('Turn on device location to show your position.');
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission != LocationPermission.whileInUse &&
          permission != LocationPermission.always) {
        throw StateError(
          'Location permission is required. You can enable it in app settings.',
        );
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      if (!mounted) return;
      setState(() {
        _ownMarker = Marker(
          markerId: const MarkerId('you'),
          position: LatLng(position.latitude, position.longitude),
          icon: BitmapDescriptor.defaultMarkerWithHue(
            BitmapDescriptor.hueMagenta,
          ),
          infoWindow: InfoWindow(
            title: 'You — device only',
            snippet: 'Not uploaded · ${position.timestamp.toLocal()}',
          ),
        );
      });
      await _controller?.animateCamera(
        CameraUpdate.newLatLngZoom(
          LatLng(position.latitude, position.longitude),
          16,
        ),
      );
    } catch (reason) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$reason')));
      }
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  void _detailById(String id) {
    final group = widget.groups.where((group) => group.id == id).firstOrNull;
    if (group != null) _detail(group);
  }

  void _detail(MapGroupView group) {
    if (widget.onGroupTap != null) {
      widget.onGroupTap!(group);
      return;
    }
    final p = widget.live[group.id];
    showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(group.name, style: Theme.of(context).textTheme.titleLarge),
              Text('Status: ${group.status}'),
              Text(
                'Last update: ${p?.recordedAt?.toLocal().toString() ?? 'Unknown'}',
              ),
              Text(
                'Accuracy: ${p?.accuracyMeters.toStringAsFixed(1) ?? '—'} m',
              ),
              if (p?.stale == true)
                const Text(
                  'STALE LOCATION',
                  style: TextStyle(color: Colors.orange),
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: animator,
    builder: (context, child) {
      final center = _cache.stopPoints.isNotEmpty
          ? _cache.stopPoints.first
          : _cache.path.isNotEmpty
          ? _cache.path.first
          : const LatLng(49.1664, -123.1376);
      final markers = <Marker>{
        ..._cache.stopMarkers,
        ..._groupMarkers.update(
          groups: widget.groups,
          live: widget.live,
          animator: animator,
          onTap: _detailById,
        ),
        ?_ownMarker,
      };
      return Stack(
        children: [
          Positioned.fill(
            child: GoogleMap(
              key: ValueKey(widget.route?.id ?? 'empty'),
              initialCameraPosition: CameraPosition(target: center, zoom: 13),
              markers: markers,
              onMapCreated: (controller) {
                _controller = controller;
                unawaited(_fit(initial: true));
              },
              padding: const EdgeInsets.only(top: 52),
              polylines: _cache.polylines,
              myLocationEnabled: false,
              myLocationButtonEnabled: false,
              zoomControlsEnabled: true,
            ),
          ),
          Positioned(
            top: 8,
            left: 8,
            right: 8,
            child: Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                FilledButton.tonalIcon(
                  onPressed: () => _fit(),
                  icon: const Icon(Icons.fit_screen),
                  label: Text(
                    widget.historyPath.isNotEmpty ? 'Fit Path' : 'Fit Route',
                  ),
                ),
                FilledButton.tonalIcon(
                  onPressed: _locating ? null : _showOwnPosition,
                  icon: const Icon(Icons.my_location),
                  label: Text(_locating ? 'Locating…' : 'Recenter on You'),
                ),
              ],
            ),
          ),
        ],
      );
    },
  );
}
