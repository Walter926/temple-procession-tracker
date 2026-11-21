import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:provider/provider.dart';
import '../../app/auth_state_notifier.dart';
import '../../core/models/route_model.dart';
import '../../core/services/event_management_service.dart';
import '../../core/utils/polyline_decoder.dart';
import '../../shared/widgets/app_button.dart';
import 'management_feedback.dart';

class RouteEditorScreen extends StatefulWidget {
  final String eventId;
  final RouteModel? initial;
  const RouteEditorScreen({super.key, required this.eventId, this.initial});
  @override
  State<RouteEditorScreen> createState() => _RouteEditorScreenState();
}

class _RouteEditorScreenState extends State<RouteEditorScreen> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.initial?.name);
  late final _description = TextEditingController(
    text: widget.initial?.description,
  );
  late final _minutes = TextEditingController(
    text: '${widget.initial?.estimatedDurationMinutes ?? 60}',
  );
  late final _color = TextEditingController(
    text: widget.initial?.color ?? '#46575F',
  );
  List<LatLng> _points = [];
  bool _changed = false, _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    try {
      _points = PolylineDecoder.decode(widget.initial?.encodedPolyline ?? '');
    } catch (_) {
      _error =
          'The stored geometry is invalid. Draw a replacement before saving.';
    }
  }

  @override
  void dispose() {
    for (final controller in [_name, _description, _minutes, _color]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _edit(VoidCallback edit) => setState(() {
    edit();
    _changed = true;
  });

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    if (_points.length < 2 ||
        EventManagementService.distanceMeters(_points) <= 0) {
      setState(
        () => _error = 'Tap the map to draw at least two distinct points.',
      );
      return;
    }
    final profile = context.read<AuthStateNotifier>().userProfile;
    if (profile == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final service = EventManagementService(), old = widget.initial;
      await service.saveRoute(
        RouteModel(
          id: old?.id ?? service.newId('routes'),
          eventId: widget.eventId,
          name: _name.text.trim(),
          description: _description.text.trim(),
          color: _color.text.trim(),
          encodedPolyline: !_changed && old != null
              ? old.encodedPolyline
              : EventManagementService.encodePoints(_points),
          totalDistanceMeters: EventManagementService.distanceMeters(_points),
          estimatedDurationMinutes: int.parse(_minutes.text),
          segmentIds: old?.segmentIds ?? [],
          stopPointIds: old?.stopPointIds ?? [],
          createdAt: old?.createdAt ?? DateTime.now(),
        ),
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

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.initial == null ? 'Draw route' : 'Edit route'),
    ),
    body: SafeArea(
      child: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const Text(
              'Tap to add route points. Drag numbered points to edit. This is a drawn path, not turn-by-turn directions.',
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 320,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: GoogleMap(
                  initialCameraPosition: CameraPosition(
                    target: _points.isEmpty
                        ? const LatLng(13.7563, 100.5018)
                        : _points.first,
                    zoom: 14,
                  ),
                  onTap: _busy
                      ? null
                      : (point) => _edit(() => _points.add(point)),
                  polylines: {
                    if (_points.length > 1)
                      Polyline(
                        polylineId: const PolylineId('draft'),
                        points: _points,
                        width: 5,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                  },
                  markers: {
                    for (var index = 0; index < _points.length; index++)
                      Marker(
                        markerId: MarkerId('point-$index'),
                        position: _points[index],
                        draggable: !_busy,
                        infoWindow: InfoWindow(
                          title: 'Point ${index + 1}',
                          snippet: 'Drag to move',
                        ),
                        onDragEnd: (point) =>
                            _edit(() => _points[index] = point),
                      ),
                  },
                  myLocationButtonEnabled: false,
                  mapToolbarEnabled: false,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '${_points.length} points · ${(EventManagementService.distanceMeters(_points) / 1000).toStringAsFixed(2)} km along route',
            ),
            Wrap(
              spacing: 12,
              children: [
                TextButton.icon(
                  onPressed: _busy || _points.isEmpty
                      ? null
                      : () => _edit(() => _points.removeLast()),
                  icon: const Icon(Icons.undo),
                  label: const Text('Undo last point'),
                ),
                TextButton.icon(
                  onPressed: _busy || _points.isEmpty
                      ? null
                      : () => _edit(_points.clear),
                  icon: const Icon(Icons.clear),
                  label: const Text('Clear'),
                ),
              ],
            ),
            TextFormField(
              controller: _name,
              maxLength: 120,
              decoration: const InputDecoration(labelText: 'Route name'),
              validator: requiredText,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _description,
              maxLines: 3,
              maxLength: 4000,
              decoration: const InputDecoration(labelText: 'Description'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _minutes,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Estimated duration (minutes)',
              ),
              validator: (value) => (int.tryParse(value ?? '') ?? -1) < 0
                  ? 'Enter a nonnegative whole number.'
                  : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _color,
              decoration: const InputDecoration(
                labelText: 'Route color (#RRGGBB)',
              ),
              validator: (value) =>
                  RegExp(r'^#[a-fA-F0-9]{6}$').hasMatch(value ?? '')
                  ? null
                  : 'Use #RRGGBB.',
            ),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            const SizedBox(height: 20),
            AppButton(
              label: 'Save route',
              isLoading: _busy,
              onPressed: _busy ? null : _save,
            ),
          ],
        ),
      ),
    ),
  );
}
