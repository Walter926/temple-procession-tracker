import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../core/models/location_history_record.dart';
import '../../core/models/procession_group.dart';
import '../../core/repositories/location_history_repository.dart';
import '../../core/services/event_management_service.dart';
import 'widgets/procession_map.dart';

class HistoryMapScreen extends StatefulWidget {
  final String eventId;
  final String? groupId;
  const HistoryMapScreen({super.key, required this.eventId, this.groupId});
  @override
  State<HistoryMapScreen> createState() => _HistoryMapScreenState();
}

class _HistoryMapScreenState extends State<HistoryMapScreen> {
  late final _groups = EventManagementService().watchGroups(widget.eventId);
  late String? _selected = widget.groupId;
  DateTime _end = DateTime.now();
  void _move(int hours) => setState(() {
    final next = _end.add(Duration(hours: hours));
    _end = next.isAfter(DateTime.now()) ? DateTime.now() : next;
  });
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Location history')),
    body: SafeArea(
      child: StreamBuilder<List<ProcessionGroup>>(
        stream: _groups,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return const Center(
              child: Text(
                'History unavailable. Only active event managers can view precise paths.',
              ),
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final groups = snapshot.data!;
          if (groups.isEmpty) {
            return const Center(
              child: Text('No groups available for this event.'),
            );
          }
          final groupId = groups.any((g) => g.id == _selected)
              ? _selected!
              : groups.first.id;
          final start = _end.subtract(const Duration(hours: 1));
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    DropdownButtonFormField<String>(
                      key: ValueKey(groupId),
                      initialValue: groupId,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'History group',
                      ),
                      items: groups
                          .map(
                            (g) => DropdownMenuItem(
                              value: g.id,
                              child: Text(
                                g.name,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: (id) => setState(() => _selected = id),
                    ),
                    Wrap(
                      spacing: 8,
                      children: [
                        TextButton(
                          onPressed:
                              start.isBefore(
                                DateTime.now().subtract(
                                  const Duration(days: 7),
                                ),
                              )
                              ? null
                              : () => _move(-1),
                          child: const Text('Previous hour'),
                        ),
                        TextButton(
                          onPressed: _end.isBefore(DateTime.now())
                              ? () => _move(1)
                              : null,
                          child: const Text('Next hour'),
                        ),
                        TextButton(
                          onPressed: () =>
                              setState(() => _end = DateTime.now()),
                          child: const Text('Latest hour'),
                        ),
                      ],
                    ),
                    Text(
                      '${start.toLocal().toString().substring(0, 16)} – ${_end.toLocal().toString().substring(0, 16)}',
                    ),
                    const Text(
                      'Seven-day retention. Pan freely; Fit Path recenters explicitly.',
                    ),
                  ],
                ),
              ),
              Expanded(
                child: _HistoryWindow(
                  key: ValueKey('$groupId:$_end'),
                  eventId: widget.eventId,
                  groupId: groupId,
                  from: start,
                  to: _end,
                ),
              ),
            ],
          );
        },
      ),
    ),
  );
}

class _HistoryWindow extends StatefulWidget {
  final String eventId, groupId;
  final DateTime from, to;
  const _HistoryWindow({
    super.key,
    required this.eventId,
    required this.groupId,
    required this.from,
    required this.to,
  });
  @override
  State<_HistoryWindow> createState() => _HistoryWindowState();
}

class _HistoryWindowState extends State<_HistoryWindow> {
  late final _records = LocationHistoryRepository().streamByGroupId(
    widget.groupId,
    eventId: widget.eventId,
    from: widget.from,
    to: widget.to,
  );
  @override
  Widget build(
    BuildContext context,
  ) => StreamBuilder<List<LocationHistoryRecord>>(
    stream: _records,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return const Center(
          child: Text(
            'Unable to load this history window. Reopen it to retry.',
          ),
        );
      }
      if (!snapshot.hasData) {
        return const Center(child: CircularProgressIndicator());
      }
      final records = snapshot.data!
          .where(
            (r) =>
                r.latitude.isFinite &&
                r.longitude.isFinite &&
                r.latitude.abs() <= 90 &&
                r.longitude.abs() <= 180,
          )
          .toList();
      if (records.isEmpty) {
        return const Center(child: Text('No recorded path in this window.'));
      }
      return Column(
        children: [
          Text(
            '${records.length} samples${records.length == 1000 ? ' (latest 1,000; legacy data may be truncated)' : ''}',
          ),
          Expanded(
            child: ProcessionMap(
              historyPath: records
                  .map((r) => LatLng(r.latitude, r.longitude))
                  .toList(),
            ),
          ),
        ],
      );
    },
  );
}
