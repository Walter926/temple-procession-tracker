import 'package:flutter/material.dart';
import '../../../core/models/map_view_records.dart';
import '../../../core/repositories/live_map_repository.dart';

class GroupTrackingSummary extends StatelessWidget {
  final MapGroupView group;
  final TrackingPresence? presence;
  final LiveGroupPosition? position;
  final bool trackingLoading, gpsLoading, trackingError, gpsError;
  const GroupTrackingSummary({
    super.key,
    required this.group,
    this.presence,
    this.position,
    this.trackingLoading = false,
    this.gpsLoading = false,
    this.trackingError = false,
    this.gpsError = false,
  });
  @override
  Widget build(BuildContext context) {
    final tracking = trackingError
        ? 'unavailable'
        : trackingLoading
        ? 'loading'
        : presence?.effectiveState(DateTime.now()) ?? 'not started';
    final gps = gpsError
        ? 'unavailable'
        : gpsLoading
        ? 'loading'
        : position == null
        ? 'waiting for the primary leader'
        : position!.stale
        ? 'stale'
        : 'current';
    return Text(
      '${group.name}: ${group.status} · Tracking $tracking · GPS $gps',
    );
  }
}
