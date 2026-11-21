import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import '../../core/services/gps_permission_service.dart';

class GpsPermissionScreen extends StatefulWidget {
  final GpsPermissionService? service;
  const GpsPermissionScreen({super.key, this.service});
  @override
  State<GpsPermissionScreen> createState() => _GpsPermissionScreenState();
}

class _GpsPermissionScreenState extends State<GpsPermissionScreen> {
  late final _service = widget.service ?? GpsPermissionService();
  LocationPermission? _permission;
  Position? _position;
  bool _connected = true;
  bool? _locationEnabled;
  bool _busy = false;
  String? _error;

  Future<void> _check() async {
    setState(() {
      _busy = true;
      _error = null;
      _permission = null;
      _position = null;
      _locationEnabled = null;
    });
    try {
      final enabled = await _service.locationServicesEnabled();
      final permission = await _service.requestForeground();
      final connected = await _service.hasConnection();
      if (!mounted) return;
      setState(() {
        _locationEnabled = enabled;
        _permission = permission;
        _connected = connected;
      });
      if (enabled &&
          (permission == LocationPermission.always ||
              permission == LocationPermission.whileInUse)) {
        final position = await _service.readPosition();
        if (mounted) setState(() => _position = position);
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final granted =
        _permission == LocationPermission.whileInUse ||
        _permission == LocationPermission.always;
    final permanentlyDenied = _permission == LocationPermission.deniedForever;
    return Scaffold(
      appBar: AppBar(title: const Text('GPS Permission')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Text(
              'Your location is shared with authorized procession staff only while you explicitly run foreground tracking. The app does not request background tracking in this release.',
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _busy ? null : _check,
              child: Text(
                _busy ? 'Checking...' : 'Allow Location and Check GPS',
              ),
            ),
            if (_permission != null) Text('Permission: ${_permission!.name}'),
            if (_locationEnabled == false)
              const Text(
                'Device Location Services are off. Turn on location and check GPS again.',
              ),
            if (_permission == LocationPermission.denied)
              const Text(
                'Location permission is denied. Allow foreground location and try again.',
              ),
            if (permanentlyDenied)
              ElevatedButton(
                onPressed: () => _service.openAppSettings(),
                child: const Text('Open App Settings'),
              ),
            TextButton(
              onPressed: () => _service.openLocationSettings(),
              child: const Text('Open Location Settings'),
            ),
            if (_position != null)
              Text(
                'Latitude: ${_position!.latitude.toStringAsFixed(6)}\nLongitude: ${_position!.longitude.toStringAsFixed(6)}\nAccuracy: ${_position!.accuracy.toStringAsFixed(1)} m',
              ),
            if (!granted || _position == null || _locationEnabled != true)
              const Text(
                'GPS not ready. You cannot start tracking until permission and a position are available.',
              ),
            if (!_connected)
              const Text(
                'Network check failed. GPS works locally; tracking will check the actual live connection before uploading.',
              ),
            if (_error != null)
              Text(
                'GPS error: $_error',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed:
                  !_busy &&
                      granted &&
                      _position != null &&
                      _locationEnabled == true
                  ? () => Navigator.pop(context, true)
                  : null,
              child: const Text('Continue to Tracking'),
            ),
            const SizedBox(height: 16),
            const Text(
              'Future background mode will require separate explanation, platform permissions, persistent notification, battery testing and app-store review.',
            ),
          ],
        ),
      ),
    );
  }
}
