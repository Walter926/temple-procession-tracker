import 'package:flutter/material.dart';
import '../../core/models/map_view_records.dart';
import '../../core/repositories/live_map_repository.dart';
import 'event_map_screen.dart';

class PublicMapScreen extends StatefulWidget {
  const PublicMapScreen({super.key});
  @override
  State<PublicMapScreen> createState() => _PublicMapScreenState();
}

class _PublicMapScreenState extends State<PublicMapScreen> {
  late final _events = LiveMapRepository().publishedEvents();
  String? _selected;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Public Procession Map')),
    body: SafeArea(
      child: StreamBuilder<List<PublishedEventView>>(
        stream: _events,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Text(
                  'Unable to load published events: ${snapshot.error}',
                ),
              ),
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final events = snapshot.data!;
          if (events.isEmpty) {
            return const Center(
              child: Text(
                'No published scheduled or active procession events yet. Private events are available from My Event Map after joining.',
              ),
            );
          }
          final selected =
              events.where((e) => e.id == _selected).firstOrNull ??
              events.first;
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(12),
                child: DropdownButtonFormField<String>(
                  isExpanded: true,
                  key: ValueKey(selected.id),
                  initialValue: selected.id,
                  decoration: const InputDecoration(
                    labelText: 'Published event',
                  ),
                  items: events
                      .map(
                        (e) => DropdownMenuItem(
                          value: e.id,
                          child: Text(e.name, overflow: TextOverflow.ellipsis),
                        ),
                      )
                      .toList(),
                  onChanged: (id) => setState(() => _selected = id),
                ),
              ),
              Expanded(
                child: EventMapView(
                  key: ValueKey(selected.id),
                  eventId: selected.id,
                  publishedEvent: selected,
                ),
              ),
            ],
          );
        },
      ),
    ),
  );
}
