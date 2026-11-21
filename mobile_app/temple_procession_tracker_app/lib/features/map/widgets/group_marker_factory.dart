import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../../core/models/map_view_records.dart';

class GroupMarkerFactory {
  static Color parseColor(String hex) {
    try {
      return Color(int.parse(hex.replaceFirst('#', 'FF'), radix: 16));
    } catch (_) {
      return Colors.blue;
    }
  }

  static Marker create(
    MapGroupView group,
    LiveGroupPosition position,
    LatLng point,
    VoidCallback onTap, {
    bool? isStale,
  }) {
    final status = group.status.toLowerCase();
    final stale = isStale ?? position.stale;
    final color = status == 'completed'
        ? Colors.grey
        : status == 'delayed'
        ? Colors.orange
        : stale
        ? Colors.blueGrey
        : parseColor(group.color);
    return Marker(
      markerId: MarkerId('group:${group.id}'),
      position: point,
      alpha: stale ? 0.55 : 1,
      flat: position.headingDegrees > 0 && !stale,
      rotation: position.headingDegrees > 0 && !stale
          ? position.headingDegrees
          : 0,
      icon: BitmapDescriptor.defaultMarkerWithHue(
        HSVColor.fromColor(color).hue,
      ),
      infoWindow: InfoWindow(
        title: group.name,
        snippet: '${group.status.toUpperCase()}${stale ? ' · GPS STALE' : ''}',
      ),
      onTap: onTap,
    );
  }
}

typedef _GroupMarkerVersion = ({
  String name,
  String color,
  String status,
  LatLng point,
  double heading,
  bool stale,
});

/// Reuses stationary markers while other groups move. Freshness is checked on
/// every build so the map's independent stale clock still updates quiet groups.
class GroupMarkerCache {
  final Map<String, (_GroupMarkerVersion, Marker)> _entries = {};
  Set<Marker> _markers = const {};
  ValueChanged<String>? _onTap;

  Set<Marker> update({
    required List<MapGroupView> groups,
    required Map<String, LiveGroupPosition> live,
    required GroupMarkerAnimator animator,
    required ValueChanged<String> onTap,
  }) {
    _onTap = onTap;
    final retained = <String>{};
    var changed = false;
    for (final group in groups) {
      final position = live[group.id];
      if (position == null || !position.valid) continue;
      final point = animator.current(group.id);
      if (point == null) continue;
      retained.add(group.id);
      final stale = position.stale;
      final version = (
        name: group.name,
        color: group.color,
        status: group.status,
        point: point,
        heading: stale ? 0.0 : position.headingDegrees,
        stale: stale,
      );
      if (_entries[group.id]?.$1 == version) continue;
      changed = true;
      _entries[group.id] = (
        version,
        GroupMarkerFactory.create(
          group,
          position,
          point,
          () => _onTap?.call(group.id),
          isStale: stale,
        ),
      );
    }
    _entries.removeWhere((id, _) {
      if (retained.contains(id)) return false;
      changed = true;
      return true;
    });
    if (changed) {
      _markers = Set<Marker>.unmodifiable(
        _entries.values.map((entry) => entry.$2),
      );
    }
    return _markers;
  }

  void clear() {
    _entries.clear();
    _markers = const {};
    _onTap = null;
  }
}

class _MarkerMotion {
  final LatLng origin, destination;
  final DateTime started;
  const _MarkerMotion(this.origin, this.destination, this.started);

  LatLng at(DateTime now) {
    final elapsed = now.difference(started).inMicroseconds;
    final t = (elapsed / GroupMarkerAnimator.duration.inMicroseconds).clamp(
      0.0,
      1.0,
    );
    return LatLng(
      origin.latitude + (destination.latitude - origin.latitude) * t,
      origin.longitude + (destination.longitude - origin.longitude) * t,
    );
  }
}

/// Smooths positions locally; it never changes the recorded coordinates or server timestamps.
class GroupMarkerAnimator extends ChangeNotifier {
  GroupMarkerAnimator({DateTime Function()? now}) : _now = now ?? DateTime.now;

  final DateTime Function() _now;
  final Map<String, LatLng> _positions = {};
  final Map<String, _MarkerMotion> _moving = {};
  Timer? _timer;
  static const Duration duration = Duration(milliseconds: 900);
  bool _closed = false;

  bool get isAnimating => _timer?.isActive ?? false;

  void update(Map<String, LiveGroupPosition> data) {
    if (_closed) return;
    final now = _now();
    var changed = false;
    _positions.removeWhere((key, _) {
      if (data[key]?.valid == true) return false;
      _moving.remove(key);
      changed = true;
      return true;
    });
    for (final entry in data.entries) {
      final item = entry.value;
      if (!item.valid) continue;
      final destination = LatLng(item.latitude, item.longitude);
      if (_positions[entry.key] == destination) continue;
      final origin = _current(entry.key, now);
      _positions[entry.key] = destination;
      changed = true;
      if (origin == null || origin == destination) {
        _moving.remove(entry.key);
      } else {
        _moving[entry.key] = _MarkerMotion(origin, destination, now);
      }
    }
    _stopIfIdle();
    if (_moving.isNotEmpty && _timer == null) {
      _timer = Timer.periodic(const Duration(milliseconds: 60), (_) => _tick());
    }
    if (changed) notifyListeners();
  }

  LatLng? current(String key) {
    final motion = _moving[key];
    return motion == null ? _positions[key] : motion.at(_now());
  }

  LatLng? _current(String key, DateTime now) =>
      _moving[key]?.at(now) ?? _positions[key];

  void _tick() {
    if (_closed) return;
    final now = _now();
    _moving.removeWhere(
      (_, motion) => now.difference(motion.started) >= duration,
    );
    _stopIfIdle();
    notifyListeners();
  }

  void _stopIfIdle() {
    if (_moving.isNotEmpty) return;
    _timer?.cancel();
    _timer = null;
  }

  @override
  void dispose() {
    _closed = true;
    _timer?.cancel();
    _timer = null;
    _positions.clear();
    _moving.clear();
    super.dispose();
  }
}
