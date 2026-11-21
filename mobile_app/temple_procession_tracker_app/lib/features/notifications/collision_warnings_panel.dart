import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/services/instruction_service.dart';
import '../../core/utils/feed_error_message.dart';

class CollisionWarningsPanel extends StatefulWidget {
  final InstructionService? service;
  final String? eventId, groupId;
  const CollisionWarningsPanel({
    super.key,
    this.service,
    this.eventId,
    this.groupId,
  });
  @override
  State<CollisionWarningsPanel> createState() => _CollisionWarningsPanelState();
}

class _CollisionWarningsPanelState extends State<CollisionWarningsPanel> {
  late final _service = widget.service ?? InstructionService();
  Stream<List<InstructionRecord>>? _warnings, _routes;
  int _attempt = 0;
  final _pending = <String>{};
  Timer? _clock;
  @override
  void initState() {
    super.initState();
    _subscribe();
    _clock = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted) setState(() {});
    });
  }

  void _subscribe() {
    if (_service.currentUid == null) return;
    _warnings = _service.watch('collisionWarnings');
    _routes = _service.watch('routeInstructions');
    _attempt++;
  }

  @override
  void dispose() {
    _clock?.cancel();
    super.dispose();
  }

  Future<void> _ack(InstructionRecord doc) async {
    final key = '${doc.collection}/${doc.id}';
    if (_pending.contains(key)) return;
    setState(() => _pending.add(key));
    try {
      await _service.acknowledge(doc);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Instruction could not be acknowledged: $error'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _pending.remove(key));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_warnings == null) return const SizedBox.shrink();
    return StreamBuilder<List<InstructionRecord>>(
      key: ValueKey(_attempt),
      stream: _warnings,
      builder: (context, warnings) => StreamBuilder<List<InstructionRecord>>(
        stream: _routes,
        builder: (context, routes) {
          final now = DateTime.now();
          final items =
              [
                    if (!warnings.hasError) ...?warnings.data,
                    if (!routes.hasError) ...?routes.data,
                  ]
                  .where(
                    (d) => d.visibleAt(
                      now,
                      eventId: widget.eventId,
                      groupId: widget.groupId,
                    ),
                  )
                  .toList()
                ..sort(
                  (a, b) => (b.createdAt ?? DateTime(0)).compareTo(
                    a.createdAt ?? DateTime(0),
                  ),
                );
          return ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 190),
            child: ListView(
              shrinkWrap: true,
              children: [
                if (warnings.connectionState == ConnectionState.waiting ||
                    routes.connectionState == ConnectionState.waiting)
                  const LinearProgressIndicator(),
                if (warnings.hasError)
                  Text(feedErrorMessage(warnings.error!, 'Crowding warnings')),
                if (routes.hasError)
                  Text(feedErrorMessage(routes.error!, 'Route instructions')),
                if (warnings.hasError || routes.hasError)
                  TextButton(
                    onPressed: () => setState(_subscribe),
                    child: const Text('Retry instructions'),
                  ),
                ...items.map(
                  (doc) => Card(
                    key: ValueKey('${doc.collection}/${doc.id}'),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            doc.collection == 'routeInstructions'
                                ? 'Route instruction'
                                : doc.data['type'] == 'instruction'
                                ? 'Dispatch instruction'
                                : 'Crowding warning',
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          Text('${doc.data['message'] ?? ''}'),
                          TextButton(
                            onPressed:
                                _pending.contains('${doc.collection}/${doc.id}')
                                ? null
                                : () => _ack(doc),
                            child: Text(
                              _pending.contains('${doc.collection}/${doc.id}')
                                  ? 'Saving…'
                                  : 'Acknowledge',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
