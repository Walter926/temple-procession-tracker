import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../app/app_routes.dart';
import '../../core/models/user_profile.dart';
import '../../core/services/membership_service.dart';
import '../../shared/widgets/app_card.dart';

class MembershipsPanel extends StatefulWidget {
  final UserProfile profile;
  const MembershipsPanel({super.key, required this.profile});
  @override
  State<MembershipsPanel> createState() => _MembershipsPanelState();
}

class _MembershipsPanelState extends State<MembershipsPanel> {
  late final MembershipService _service = MembershipService();
  late final Stream<List<Membership>> _stream = _service.watchOwn(
    widget.profile.id,
  );
  String? _selecting;
  String? _error;

  Future<void> _select(Membership membership) async {
    setState(() {
      _selecting = membership.id;
      _error = null;
    });
    try {
      await _service.select(membership);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Could not select this membership. Check your connection and try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _selecting = null);
    }
  }

  @override
  Widget build(BuildContext context) => AppCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Joined events & groups',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const Text(
          'Choose which joined event/group your maps use. This does not change your leader assignment.',
        ),
        StreamBuilder<List<Membership>>(
          stream: _stream,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return const Text(
                'Unable to load memberships. Reopen this page to retry.',
              );
            }
            if (!snapshot.hasData) return const LinearProgressIndicator();
            if (snapshot.data!.isEmpty) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text('No memberships yet. Join using an access code.'),
              );
            }
            return Column(
              children: snapshot.data!.map((membership) {
                final selected = membership.isSelected(
                  widget.profile.joinedEventId,
                  widget.profile.joinedGroupId,
                );
                return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                  stream: FirebaseFirestore.instance
                      .doc('events/${membership.eventId}')
                      .snapshots(),
                  builder: (context, event) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      selected ? Icons.check_circle : Icons.event_outlined,
                    ),
                    title: Text(
                      event.hasError
                          ? 'Event unavailable'
                          : event.data?.data()?['name'] as String? ??
                                membership.eventId,
                    ),
                    subtitle: membership.isEventOnly
                        ? const Text('Event only · no group membership')
                        : _GroupName(groupId: membership.groupId),
                    trailing: _selecting == membership.id
                        ? const SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : TextButton(
                            onPressed: _selecting != null || selected
                                ? null
                                : () => _select(membership),
                            child: Text(selected ? 'Active' : 'Select'),
                          ),
                  ),
                );
              }).toList(),
            );
          },
        ),
        if (_error != null)
          Text(
            _error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        TextButton.icon(
          onPressed: () => context.push(AppRoutes.joinCodePath),
          icon: const Icon(Icons.key),
          label: const Text('Join with access code'),
        ),
      ],
    ),
  );
}

class _GroupName extends StatelessWidget {
  final String groupId;
  const _GroupName({required this.groupId});
  @override
  Widget build(
    BuildContext context,
  ) => StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
    stream: FirebaseFirestore.instance.doc('groups/$groupId').snapshots(),
    builder: (context, snapshot) => Text(
      'Group: ${snapshot.hasError ? 'unavailable' : snapshot.data?.data()?['name'] ?? groupId}',
    ),
  );
}
