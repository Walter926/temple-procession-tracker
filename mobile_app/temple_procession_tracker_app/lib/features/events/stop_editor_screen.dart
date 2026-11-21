import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:provider/provider.dart';
import '../../app/auth_state_notifier.dart';
import '../../core/enums/stop_point_type.dart';
import '../../core/models/route_model.dart';
import '../../core/models/stop_point.dart';
import '../../core/services/event_management_service.dart';
import '../../core/utils/polyline_decoder.dart';
import '../../shared/widgets/app_button.dart';
import 'management_feedback.dart';

class StopEditorScreen extends StatefulWidget {
  final RouteModel route;
  final List<StopPoint> existing;
  final StopPoint? initial;
  const StopEditorScreen({
    super.key,
    required this.route,
    required this.existing,
    this.initial,
  });
  @override
  State<StopEditorScreen> createState() => _StopEditorScreenState();
}

class _StopEditorScreenState extends State<StopEditorScreen> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.initial?.name);
  late final _description = TextEditingController(
    text: widget.initial?.description,
  );
  late final _latitude = TextEditingController(
    text: widget.initial?.latitude.toString(),
  );
  late final _longitude = TextEditingController(
    text: widget.initial?.longitude.toString(),
  );
  late final _order = TextEditingController(
    text:
        '${widget.initial?.order ?? (widget.existing.fold<int>(0, (max, stop) => stop.order > max ? stop.order : max) + 1)}',
  );
  late final _radius = TextEditingController(
    text: '${widget.initial?.geofenceRadiusMeters ?? 100}',
  );
  late final _capacity = TextEditingController(
    text: '${widget.initial?.maxAllowedGroups ?? 1}',
  );
  late final _dwell = TextEditingController(
    text: '${widget.initial?.plannedStopMinutes ?? 0}',
  );
  late StopPointType _type = widget.initial?.type ?? StopPointType.temple;
  late final List<LatLng> _routePoints = _decode();
  LatLng? _point;
  bool _busy = false;
  String? _error;

  List<LatLng> _decode() {
    try {
      return PolylineDecoder.decode(widget.route.encodedPolyline);
    } catch (_) {
      return [];
    }
  }

  @override
  void initState() {
    super.initState();
    if (widget.initial != null) {
      _point = LatLng(widget.initial!.latitude, widget.initial!.longitude);
    }
  }

  @override
  void dispose() {
    for (final c in [
      _name,
      _description,
      _latitude,
      _longitude,
      _order,
      _radius,
      _capacity,
      _dwell,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  void _place(LatLng point) => setState(() {
    _point = point;
    _latitude.text = point.latitude.toStringAsFixed(6);
    _longitude.text = point.longitude.toStringAsFixed(6);
  });

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    final profile = context.read<AuthStateNotifier>().userProfile;
    if (profile == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final service = EventManagementService(), old = widget.initial;
      final stop = StopPoint(
        id: old?.id ?? service.newId('stopPoints'),
        routeId: widget.route.id,
        name: _name.text.trim(),
        description: _description.text.trim(),
        type: _type,
        latitude: double.parse(_latitude.text),
        longitude: double.parse(_longitude.text),
        order: int.parse(_order.text),
        plannedStopMinutes: int.parse(_dwell.text),
        geofenceRadiusMeters: double.parse(_radius.text),
        maxAllowedGroups: int.parse(_capacity.text),
        expectedArrivalTime: old?.expectedArrivalTime,
        expectedDepartureTime: old?.expectedDepartureTime,
      );
      EventManagementService.validateStop(stop, widget.existing);
      await service.saveStop(
        widget.route.eventId,
        stop,
        profile,
        creating: old == null,
      );
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) setState(() => _error = managementError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _number(
    TextEditingController controller,
    String label, {
    bool integer = false,
  }) => Padding(
    padding: const EdgeInsets.only(top: 12),
    child: TextFormField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(
        decimal: true,
        signed: true,
      ),
      decoration: InputDecoration(labelText: label),
      validator: (text) =>
          (integer ? int.tryParse(text ?? '') : double.tryParse(text ?? '')) ==
              null
          ? 'Enter a number.'
          : null,
      onChanged: (_) {
        final lat = double.tryParse(_latitude.text),
            lng = double.tryParse(_longitude.text);
        if (lat != null &&
            lng != null &&
            lat.isFinite &&
            lng.isFinite &&
            lat.abs() <= 90 &&
            lng.abs() <= 180) {
          setState(() => _point = LatLng(lat, lng));
        }
      },
    ),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.initial == null ? 'Place stop' : 'Edit stop'),
    ),
    body: SafeArea(
      child: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const Text(
              'Tap the map to place this stop. Drag its marker to refine the position.',
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 300,
              child: GoogleMap(
                initialCameraPosition: CameraPosition(
                  target:
                      _point ??
                      (_routePoints.isEmpty
                          ? const LatLng(13.7563, 100.5018)
                          : _routePoints.first),
                  zoom: 15,
                ),
                onTap: _busy ? null : _place,
                polylines: {
                  if (_routePoints.isNotEmpty)
                    Polyline(
                      polylineId: const PolylineId('route'),
                      points: _routePoints,
                      width: 4,
                    ),
                },
                markers: {
                  for (final stop in widget.existing.where(
                    (s) => s.id != widget.initial?.id,
                  ))
                    Marker(
                      markerId: MarkerId(stop.id),
                      position: LatLng(stop.latitude, stop.longitude),
                      infoWindow: InfoWindow(
                        title: '${stop.order}. ${stop.name}',
                      ),
                    ),
                  if (_point != null)
                    Marker(
                      markerId: const MarkerId('selected'),
                      position: _point!,
                      draggable: !_busy,
                      onDragEnd: _place,
                      icon: BitmapDescriptor.defaultMarkerWithHue(
                        BitmapDescriptor.hueAzure,
                      ),
                    ),
                },
                circles: {
                  if (_point != null)
                    Circle(
                      circleId: const CircleId('geofence'),
                      center: _point!,
                      radius: (double.tryParse(_radius.text) ?? 100).clamp(
                        5,
                        1000,
                      ),
                      strokeWidth: 1,
                      fillColor: Colors.blue.withValues(alpha: .1),
                      strokeColor: Colors.blue,
                    ),
                },
                myLocationButtonEnabled: false,
                mapToolbarEnabled: false,
              ),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _name,
              maxLength: 120,
              decoration: const InputDecoration(labelText: 'Stop name'),
              validator: requiredText,
            ),
            TextFormField(
              controller: _description,
              maxLines: 3,
              maxLength: 4000,
              decoration: const InputDecoration(labelText: 'Description'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<StopPointType>(
              initialValue: _type,
              decoration: const InputDecoration(labelText: 'Stop type'),
              items: StopPointType.values
                  .map(
                    (type) =>
                        DropdownMenuItem(value: type, child: Text(type.name)),
                  )
                  .toList(),
              onChanged: (type) => setState(() => _type = type!),
            ),
            _number(_latitude, 'Latitude'),
            _number(_longitude, 'Longitude'),
            _number(_order, 'Order (unique within route)', integer: true),
            _number(_radius, 'Geofence radius (5–1000 m)'),
            _number(_capacity, 'Maximum groups at stop', integer: true),
            _number(_dwell, 'Planned stop (minutes)', integer: true),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            const SizedBox(height: 20),
            AppButton(
              label: 'Save stop',
              isLoading: _busy,
              onPressed: _busy ? null : _save,
            ),
          ],
        ),
      ),
    ),
  );
}
