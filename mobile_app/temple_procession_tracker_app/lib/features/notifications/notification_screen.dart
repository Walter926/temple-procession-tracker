import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/services/push_notification_service.dart';
import '../map/event_map_screen.dart';
import 'notification_record.dart';

class NotificationScreen extends StatefulWidget {
class NotificationScreen extends StatefulWidget {
  const NotificationScreen({super.key});
  @override
  State<NotificationScreen> createState() => _NotificationScreenState();
}

class _NotificationScreenState extends State<NotificationScreen> {
  late final PushNotificationService _push;
  Stream<QuerySnapshot<Map<String, dynamic>>>? _records;
  String? _uid;
  int _limit = 50;
  final _busy = <String>{};
  Timer? _clock;
  @override
  void initState() {
    super.initState();
    _push = context.read<PushNotificationService>();
    _uid = FirebaseAuth.instance.currentUser?.uid;
    if (_uid != null) _records = _push.notifications(_uid!, limit: _limit);
    _clock = Timer.periodic(const Duration(seconds: 10), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _clock?.cancel();
    super.dispose();
  }

  Future<void> _act(
    NotificationRecord item,
    Future<void> Function() action,
  ) async {
    if (_busy.contains(item.id)) return;
    setState(() => _busy.add(item.id));
    try {
      await action();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Action could not be saved: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  Future<void> _open(NotificationRecord item) async {
    if (item.readAt == null) await _push.markRead(item.id);
    if (!mounted) return;
    final acknowledged = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            20,
            20,
            20,
            20 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.title, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(item.body),
              const SizedBox(height: 12),
              Text('Status: ${item.effectiveState(DateTime.now())}'),
              if (item.eventId.isNotEmpty)
                TextButton.icon(
                  onPressed: () {
                    Navigator.pop(context);
                    Navigator.of(this.context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => EventMapScreen(eventId: item.eventId),
                      ),
                    );
                  },
                  icon: const Icon(Icons.map_outlined),
                  label: const Text('View event map'),
                ),
              if (item.canAcknowledge(DateTime.now()))
                FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: const Text('Acknowledge instruction'),
                ),
            ],
          ),
        ),
      ),
    );
    if (acknowledged == true) {
      if (item.sourceCollection == 'routeInstructions') {
        await _push.acknowledgeRouteInstruction(item.sourceId);
      } else {
        await _push.acknowledgeWarning(item.sourceId);
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Notifications')),
    body: SafeArea(
      child: _records == null
          ? const Center(child: Text('Sign in to view your notifications.'))
          : StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              stream: _records,
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        'Notifications unavailable: ${snapshot.error}',
                      ),
                    ),
                  );
                }
                if (!snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final items = snapshot.data!.docs
                    .map((d) => NotificationRecord.fromData(d.id, d.data()))
                    .toList();
                if (items.isEmpty) {
                  return const Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'No notifications yet. Announcements and instructions addressed to you will appear here even when push delivery is unavailable.',
                      ),
                    ),
                  );
                }
                return ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: items.length + 1,
                  itemBuilder: (context, index) {
                    if (index == items.length) {
                      return Padding(
                        padding: EdgeInsets.all(12),
                        child: Column(
                          children: [
                            Text(
                              'Showing ${items.length} notices. Read status does not acknowledge an instruction.',
                            ),
                            if (items.length >= _limit && _limit < 1000)
                              TextButton(
                                onPressed: () => setState(() {
                                  _limit += 50;
                                  _records = _push.notifications(
                                    _uid!,
                                    limit: _limit,
                                  );
                                }),
                                child: const Text('Load older notices'),
                              ),
                            if (_limit == 1000 && items.length >= _limit)
                              const Text(
                                'The latest 1,000 notices are available here. Older notices expire under the retention policy.',
                              ),
                          ],
                        ),
                      );
                    }
                    final item = items[index],
                        state = item.effectiveState(DateTime.now());
                    final current = ['active', 'unread'].contains(state);
                    return Card(
                      child: ListTile(
                        enabled: !_busy.contains(item.id),
                        leading: Icon(
                          item.readAt == null
                              ? Icons.mark_email_unread_outlined
                              : Icons.drafts_outlined,
                          color: current
                              ? Theme.of(context).colorScheme.primary
                              : Colors.grey,
                        ),
                        title: Text(
                          item.title,
                          style: TextStyle(
                            fontWeight: item.readAt == null
                                ? FontWeight.bold
                                : FontWeight.normal,
                          ),
                        ),
                        subtitle: Text(
                          '${item.body}\n${current
                              ? item.readAt == null
                                    ? 'Unread'
                                    : 'Read'
                              : state.toUpperCase()} · ${item.createdAt?.toLocal().toString() ?? 'Time unavailable'}',
                        ),
                        isThreeLine: true,
                        onTap: () => _act(item, () => _open(item)),
                      ),
                    );
                  },
                );
              },
            ),
    ),
  );
}
