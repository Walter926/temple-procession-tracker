import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../core/models/map_view_records.dart';

class GroupMarkerFactory {
  static Color parseColor(String hex) { try { return Color(int.parse(hex.replaceFirst('#', 'FF'), radix: 16)); } catch (_) { return Colors.blue; } }
  static Marker create(MapGroupView group, LiveGroupPosition position, LatLng point, VoidCallback onTap) {
    final status = group.status.toLowerCase();
    final stale = position.stale;
    final color = status == 'completed' ? Colors.grey : status == 'delayed' ? Colors.orange : stale ? Colors.blueGrey : parseColor(group.color);
    return Marker(markerId: MarkerId('group:${group.id}'), position: point, alpha: stale ? 0.55 : 1, flat: position.headingDegrees > 0 && !stale,
      rotation: position.headingDegrees > 0 && !stale ? position.headingDegrees : 0,
      icon: BitmapDescriptor.defaultMarkerWithHue(HSVColor.fromColor(color).hue),
      infoWindow: InfoWindow(title: group.name, snippet: '${group.status.toUpperCase()}${stale ? ' · GPS STALE' : ''}'), onTap: onTap);
  }
}

/// Smooths positions locally; it never changes the recorded coordinates or server timestamps.
class GroupMarkerAnimator extends ChangeNotifier {
  final Map<String, LatLng> _from = {}, _to = {};
  final Map<String, DateTime> _started = {};
  Timer? _timer;
  static const Duration duration = Duration(milliseconds: 900);
  bool _closed = false;

  void update(Map<String, LiveGroupPosition> data) {
    for (final entry in data.entries) {
      final item = entry.value;
      if (!item.valid) continue;
      final destination = LatLng(item.latitude, item.longitude);
      if (_to[entry.key] == destination) continue;
      _from[entry.key] = current(entry.key) ?? destination;
      _to[entry.key] = destination;
      _started[entry.key] = DateTime.now();
    }
    _from.removeWhere((key, value) => !data.containsKey(key));
    _to.removeWhere((key, value) => !data.containsKey(key));
    _started.removeWhere((key, value) => !data.containsKey(key));
    if (_to.isNotEmpty && _timer == null) {
      _timer = Timer.periodic(const Duration(milliseconds: 60), (timer) {
        if (_closed) { timer.cancel(); _timer = null; return; }
        notifyListeners();
        if (_started.values.every((start) => DateTime.now().difference(start) >= duration)) { timer.cancel(); _timer = null; }
      });
    }
    if (!_closed) notifyListeners();
  }

  LatLng? current(String key) {
    final destination = _to[key], origin = _from[key], started = _started[key];
    if (destination == null) return null;
    if (origin == null || started == null) return destination;
    final elapsed = DateTime.now().difference(started).inMilliseconds;
    final t = (elapsed / duration.inMilliseconds).clamp(0.0, 1.0);
    return LatLng(origin.latitude + (destination.latitude - origin.latitude) * t, origin.longitude + (destination.longitude - origin.longitude) * t);
  }

  @override
  void dispose() { _closed = true; _timer?.cancel(); super.dispose(); }
}