import '../../core/models/map_view_records.dart';

/// Current server-owned schema. Read is separate from instruction acknowledgement.
class NotificationRecord {
  final String id, title, body, eventId, sourceCollection, sourceId, state;
  final DateTime? createdAt, expiresAt, readAt;
  const NotificationRecord({
    required this.id,
    required this.title,
    required this.body,
    required this.eventId,
    required this.sourceCollection,
    required this.sourceId,
    required this.state,
    this.createdAt,
    this.expiresAt,
    this.readAt,
  });
  factory NotificationRecord.fromData(String id, Map<String, dynamic> d) =>
      NotificationRecord(
        id: id,
        title: '${d['title'] ?? 'Procession update'}',
        body: '${d['body'] ?? d['message'] ?? ''}',
        eventId: '${d['eventId'] ?? ''}',
        sourceCollection: '${d['sourceCollection'] ?? ''}',
        sourceId: '${d['sourceId'] ?? ''}',
        state: '${d['state'] ?? 'active'}',
        createdAt: mapDate(d['createdAt']),
        expiresAt: mapDate(d['expiresAt']),
        readAt: mapDate(d['readAt']),
      );
  String effectiveState(DateTime now) {
    if ([
      'resolved',
      'expired',
      'superseded',
      'acknowledged',
      'revoked',
    ].contains(state)) {
      return state;
    }
    if (expiresAt != null && !now.isBefore(expiresAt!)) return 'expired';
    return state;
  }

  bool canAcknowledge(DateTime now) =>
      ['collisionWarnings', 'routeInstructions'].contains(sourceCollection) &&
      sourceId.isNotEmpty &&
      expiresAt != null &&
      ['active', 'unread'].contains(effectiveState(now));
}
