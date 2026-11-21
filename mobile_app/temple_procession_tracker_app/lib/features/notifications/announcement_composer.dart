import 'dart:math';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

/// Audience is explicit; the server independently checks ownership/assignment.
class AnnouncementComposer extends StatefulWidget {
  final String eventId, groupId;
  final Future<void> Function(Map<String, dynamic>)? submit;
  const AnnouncementComposer({
    super.key,
    required this.eventId,
    this.groupId = '',
    this.submit,
  });

  @override
  State<AnnouncementComposer> createState() => _AnnouncementComposerState();
}

class _AnnouncementComposerState extends State<AnnouncementComposer> {
  final _message = TextEditingController();
  bool _busy = false;
  String? _error, _notice, _requestId, _signature;

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_busy) return;
    final text = _message.text.trim();
    if (text.isEmpty || text.length > 500) {
      setState(() => _error = 'Enter a message of 1–500 characters.');
      return;
    }
    final signature = '${widget.eventId}|${widget.groupId}|$text';
    if (_signature != signature) {
      _signature = signature;
      _requestId =
          '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}_${Random.secure().nextInt(1 << 32).toRadixString(36)}';
    }
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final payload = <String, dynamic>{
        'eventId': widget.eventId,
        'groupId': widget.groupId,
        'audience': widget.groupId.isEmpty ? 'event' : 'group',
        'message': text,
        'requestId': _requestId,
      };
      if (widget.submit != null) {
        await widget.submit!(payload);
      } else {
        await FirebaseFunctions.instanceFor(
          region: 'us-central1',
        ).httpsCallable('sendAnnouncement').call(payload);
      }
      if (!mounted) return;
      _message.clear();
      _requestId = _signature = null;
      setState(
        () => _notice =
            'Announcement saved. Delivery to eligible members and leaders is queued.',
      );
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error is FirebaseFunctionsException
              ? error.message ?? 'Could not send announcement.'
              : '$error',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            widget.groupId.isEmpty
                ? 'Event announcement'
                : 'Group announcement',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            widget.groupId.isEmpty
                ? 'Private message to this event’s members and assigned leaders.'
                : 'Private message to this group’s current members and assigned leaders.',
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _message,
            enabled: !_busy,
            maxLength: 500,
            minLines: 2,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Announcement message',
              border: OutlineInputBorder(),
            ),
          ),
          if (_error != null)
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          if (_notice != null) Text(_notice!),
          FilledButton.icon(
            onPressed: _busy ? null : _send,
            icon: const Icon(Icons.campaign_outlined),
            label: Text(_busy ? 'Sending…' : 'Send announcement'),
          ),
        ],
      ),
    ),
  );
}
