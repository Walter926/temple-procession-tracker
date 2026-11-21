import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../app/auth_state_notifier.dart';
import '../../core/enums/event_status.dart';
import '../../core/models/event.dart';
import '../../core/services/event_management_service.dart';
import '../../shared/widgets/app_button.dart';
import 'management_feedback.dart';

class EventEditorScreen extends StatefulWidget {
  final Event? initial;
  const EventEditorScreen({super.key, this.initial});
  @override
  State<EventEditorScreen> createState() => _EventEditorScreenState();
}

class _EventEditorScreenState extends State<EventEditorScreen> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.initial?.name);
  late final _description = TextEditingController(
    text: widget.initial?.description,
  );
  late final _temple = TextEditingController(
    text: widget.initial?.mainTempleName,
  );
  late final _city = TextEditingController(text: widget.initial?.cityRegion);
  late DateTime _start =
      widget.initial?.startTime ?? DateTime.now().add(const Duration(days: 1));
  late DateTime? _end = widget.initial?.endTime;
  late bool _public = widget.initial?.isPublic ?? false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final controller in [_name, _description, _temple, _city]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _pick(bool end) async {
    final current = (end ? _end : _start) ?? _start;
    final date = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(current),
    );
    if (time == null || !mounted) return;
    setState(() {
      final selected = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
      if (end) {
        _end = selected;
      } else {
        _start = selected;
      }
    });
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    final profile = context.read<AuthStateNotifier>().userProfile;
    if (profile == null || !profile.isActive) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final service = EventManagementService();
      final old = widget.initial;
      final event = Event(
        id: old?.id ?? service.newId('events'),
        name: _name.text.trim(),
        description: _description.text.trim(),
        status: old?.status ?? EventStatus.draft,
        startTime: _start,
        endTime: _end,
        organizerId: old?.organizerId ?? profile.id,
        routeId: old?.routeId,
        isPublic: _public,
        createdAt: old?.createdAt ?? DateTime.now(),
        mainTempleName: _temple.text.trim(),
        cityRegion: _city.text.trim(),
      );
      await service.saveEvent(event, profile, creating: old == null);
      if (mounted) Navigator.pop(context, event.id);
    } catch (error) {
      if (mounted) setState(() => _error = managementError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.initial == null ? 'Create event' : 'Edit event'),
    ),
    body: SafeArea(
      child: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            TextFormField(
              controller: _name,
              maxLength: 120,
              decoration: const InputDecoration(labelText: 'Event name'),
              validator: requiredText,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _description,
              minLines: 2,
              maxLines: 5,
              maxLength: 4000,
              decoration: const InputDecoration(labelText: 'Description'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _temple,
              maxLength: 120,
              decoration: const InputDecoration(labelText: 'Main temple'),
              validator: requiredText,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _city,
              maxLength: 120,
              decoration: const InputDecoration(labelText: 'City / region'),
              validator: requiredText,
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Start time'),
              subtitle: Text(formatDate(_start)),
              trailing: IconButton(
                onPressed: _busy ? null : () => _pick(false),
                icon: const Icon(Icons.calendar_month),
              ),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Estimated end time'),
              subtitle: Text(_end == null ? 'Not set' : formatDate(_end!)),
              trailing: Wrap(
                children: [
                  if (_end != null)
                    IconButton(
                      onPressed: _busy
                          ? null
                          : () => setState(() => _end = null),
                      icon: const Icon(Icons.clear),
                    ),
                  IconButton(
                    onPressed: _busy ? null : () => _pick(true),
                    icon: const Icon(Icons.calendar_month),
                  ),
                ],
              ),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Public event'),
              subtitle: const Text(
                'Published on the public map only when scheduled or active. Membership never changes this setting.',
              ),
              value: _public,
              onChanged: _busy
                  ? null
                  : (value) => setState(() => _public = value),
            ),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            const SizedBox(height: 16),
            AppButton(
              label: 'Save event',
              isLoading: _busy,
              onPressed: _busy ? null : _save,
            ),
          ],
        ),
      ),
    ),
  );
}
