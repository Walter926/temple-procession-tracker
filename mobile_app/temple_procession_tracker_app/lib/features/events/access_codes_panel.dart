import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/models/access_code.dart';
import '../../core/services/access_code_service.dart';
import '../../shared/widgets/app_card.dart';
import 'management_feedback.dart';

class AccessCodesPanel extends StatefulWidget {
  final String eventId, groupId;
  const AccessCodesPanel({super.key, required this.eventId, this.groupId = ''});
  @override
  State<AccessCodesPanel> createState() => _AccessCodesPanelState();
}

class _AccessCodesPanelState extends State<AccessCodesPanel> {
  late final _service = AccessCodeService();
  late final _codes = widget.groupId.isEmpty
      ? _service.watchCodesForEvent(widget.eventId)
      : _service.watchCodesForGroup(widget.groupId);
  IssuedAccessCode? _issued;
  bool _busy = false;
  String? _error;

  Future<void> _generate() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final code = await _service.generate(
        eventId: widget.eventId,
        groupId: widget.groupId,
      );
      if (mounted) setState(() => _issued = code);
    } catch (error) {
      if (mounted) setState(() => _error = managementError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _revoke(String id) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _service.revoke(id);
      if (mounted && _issued?.id == id) setState(() => _issued = null);
    } catch (error) {
      if (mounted) setState(() => _error = managementError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AppCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          widget.groupId.isEmpty ? 'Event access codes' : 'Group access codes',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const Text(
          'Six digits · up to 1000 uses · expires after 24 hours. Copy the new code and share it with intended participants.',
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _busy ? null : _generate,
          icon: const Icon(Icons.key),
          label: Text(_busy ? 'Please wait…' : 'Generate code'),
        ),
        if (_issued != null) ...[
          const SizedBox(height: 12),
          SelectableText(
            _issued!.code,
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          Text(
            _issued!.expiresAt == null
                ? 'Valid for 24 hours from creation'
                : 'Expires ${formatDate(_issued!.expiresAt!)}',
          ),
          TextButton.icon(
            onPressed: () async {
              await Clipboard.setData(
                ClipboardData(
                  text:
                      'Join ${widget.groupId.isEmpty ? 'our event' : 'our group'} in Temple Procession Tracker with code ${_issued!.code}. Valid for 24 hours.',
                ),
              );
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'Invitation copied. Paste it into your preferred sharing app.',
                    ),
                  ),
                );
              }
            },
            icon: const Icon(Icons.copy),
            label: const Text('Copy invitation to share'),
          ),
        ],
        if (_error != null)
          Text(
            _error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        StreamBuilder<List<AccessCode>>(
          stream: _codes,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return const Text(
                'Unable to load code history. Reopen this page to retry.',
              );
            }
            if (!snapshot.hasData) return const LinearProgressIndicator();
            final codes = snapshot.data!.toList()
              ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
            if (codes.isEmpty) {
              return const Padding(
                padding: EdgeInsets.only(top: 12),
                child: Text('No codes created yet.'),
              );
            }
            return Column(
              children: codes.map((code) {
                final status = code.statusAt(DateTime.now());
                final revocable =
                    code.isActive &&
                    code.expiresAt != null &&
                    code.expiresAt!.isAfter(DateTime.now());
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    '${code.scope == 'group' ? 'Group' : 'Event'} · $status',
                  ),
                  subtitle: Text(
                    '${code.usedCount} members joined${code.maxUses > 0 ? ' / ${code.maxUses} uses' : ''} · ${code.expiresAt == null ? 'No expiry recorded' : 'expires ${formatDate(code.expiresAt!)}'}',
                  ),
                  trailing: revocable
                      ? TextButton(
                          onPressed: _busy ? null : () => _revoke(code.id),
                          child: const Text('Revoke'),
                        )
                      : null,
                );
              }).toList(),
            );
          },
        ),
      ],
    ),
  );
}
