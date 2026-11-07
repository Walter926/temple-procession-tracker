import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'collision_warnings_panel.dart';
import 'route_instructions_panel.dart';

class NotificationScreen extends StatefulWidget {
  const NotificationScreen({super.key});

  @override
  State<NotificationScreen> createState() => _NotificationScreenState();
}

class _NotificationScreenState extends State<NotificationScreen> {
  String? error;

  @override
  void initState() {
    super.initState();
    _register();
  }

  Future<void> _register() async {
    try {
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid == null) return;
      final settings = await FirebaseMessaging.instance.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null)
        await FirebaseFunctions.instanceFor(region: 'us-central1')
            .httpsCallable('registerDeviceToken')
            .call(<String, dynamic>{'token': token});
    } catch (e) {
      if (mounted) setState(() => error = 'Push registration: $e');
    }
  }

  Future<void> _read(String id) async {
    try {
      await FirebaseFunctions.instanceFor(region: 'us-central1')
          .httpsCallable('markNotificationRead')
          .call(<String, dynamic>{'notificationId': id});
    } catch (e) {
      if (mounted) setState(() => error = 'Unable to mark read: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser?.uid;

    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: uid == null
          ? const Center(child: Text('Sign in to view notifications.'))
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (error != null)
                  Text(error!, style: const TextStyle(color: Colors.red)),
                const CollisionWarningsPanel(),
                const RouteInstructionsPanel(),
                StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                  stream: FirebaseFirestore.instance
                      .collection('notifications')
                      .where('uid', isEqualTo: uid)
                      .snapshots(),
                  builder: (context, snap) {
                    if (snap.hasError)
                      return Text('Notifications unavailable: ${snap.error}');
                    if (!snap.hasData)
                      return const Center(child: CircularProgressIndicator());

                    final docs = snap.data!.docs.toList()
                      ..sort((a, b) {
                        final aTime =
                            (a.data()['createdAt'] as Timestamp?)
                                ?.millisecondsSinceEpoch ??
                            0;
                        final bTime =
                            (b.data()['createdAt'] as Timestamp?)
                                ?.millisecondsSinceEpoch ??
                            0;
                        return bTime.compareTo(aTime);
                      });

                    final unread = docs
                        .where((d) => d.data()['isRead'] != true)
                        .length;

                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Unread: $unread',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        ...docs.map((doc) {
                          final data = doc.data();
                          final isRead = data['isRead'] == true;
                          final title = '${data['title'] ?? 'Notification'}';
                          final body = '${data['body'] ?? ''}';

                          return Card(
                            child: ListTile(
                              leading: Icon(
                                isRead
                                    ? Icons.notifications_none
                                    : Icons.notifications_active,
                              ),
                              title: Text(title),
                              subtitle: Text(body),
                              trailing: isRead
                                  ? null
                                  : TextButton(
                                      onPressed: () => _read(doc.id),
                                      child: const Text('Mark read'),
                                    ),
                              onTap: () => showDialog<void>(
                                context: context,
                                builder: (dialogContext) => AlertDialog(
                                  title: Text(title),
                                  content: Text(body),
                                  actions: [
                                    TextButton(
                                      onPressed: () {
                                        Navigator.of(dialogContext).pop();
                                        _read(doc.id);
                                      },
                                      child: const Text('Close and mark read'),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          );
                        }),
                      ],
                    );
                  },
                ),
              ],
            ),
    );
  }
}
