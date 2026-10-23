import 'package:cloud_firestore/cloud_firestore.dart';

// Metadata only. Plaintext codes are returned once by a Cloud Function and are never stored in Firestore.
class AccessCode {
  final String id, eventId, groupId, code, scope, grantedRole;
  final bool isActive;
  final int maxUses, usedCount;
  final DateTime? expiresAt;
  final DateTime createdAt;

  const AccessCode({required this.id, required this.eventId, required this.groupId, this.code = '',
    required this.isActive, required this.maxUses, required this.usedCount, this.expiresAt,
    required this.createdAt, this.scope = 'event', this.grantedRole = 'teamMember'});

  factory AccessCode.fromJson(Map<String, dynamic> data) => AccessCode(
    id: data['id'] as String? ?? '', eventId: data['eventId'] as String? ?? '',
    groupId: data['groupId'] as String? ?? '', code: '', scope: data['scope'] as String? ?? 'event',
    grantedRole: data['grantedRole'] as String? ?? 'teamMember',
    isActive: data['enabled'] as bool? ?? data['isActive'] as bool? ?? false,
    maxUses: (data['maxUses'] as num?)?.toInt() ?? 0, usedCount: (data['usedCount'] as num?)?.toInt() ?? 0,
    expiresAt: _date(data['expiresAt']), createdAt: _date(data['createdAt']) ?? DateTime.now());

  factory AccessCode.fromFirestore(DocumentSnapshot<Map<String, dynamic>> document) => AccessCode.fromJson({...?document.data(), 'id': document.id});

  Map<String, dynamic> toJson() => { 'id': id, 'eventId': eventId, 'groupId': groupId, 'scope': scope,
    'grantedRole': grantedRole, 'enabled': isActive, 'maxUses': maxUses, 'usedCount': usedCount,
    'expiresAt': expiresAt?.toIso8601String(), 'createdAt': createdAt.toIso8601String() };

  Map<String, dynamic> toFirestore() => { 'eventId': eventId, 'groupId': groupId, 'scope': scope,
    'grantedRole': grantedRole, 'enabled': isActive, 'maxUses': maxUses, 'usedCount': usedCount,
    'expiresAt': expiresAt == null ? null : Timestamp.fromDate(expiresAt!), 'createdAt': Timestamp.fromDate(createdAt) };

  static DateTime? _date(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    return null;
  }
}