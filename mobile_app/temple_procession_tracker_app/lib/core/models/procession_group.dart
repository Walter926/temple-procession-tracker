import 'package:cloud_firestore/cloud_firestore.dart';
import '../enums/group_status.dart';

class ProcessionGroup {
  final String id, eventId, name, leaderUserId, backupLeaderUserId, color, routeId, startingStopPointId, endingStopPointId;
  final GroupStatus status;
  final double? currentLatitude, currentLongitude;
  final DateTime? lastLocationUpdateAt;
  final String? accessCodeId;
  final int memberCount;

  const ProcessionGroup({required this.id, required this.eventId, required this.name, required this.leaderUserId,
    required this.status, this.currentLatitude, this.currentLongitude, this.lastLocationUpdateAt, this.accessCodeId,
    required this.memberCount, this.backupLeaderUserId = '', this.color = '#3169a6', this.routeId = '',
    this.startingStopPointId = '', this.endingStopPointId = ''});

  factory ProcessionGroup.fromJson(Map<String, dynamic> json) => ProcessionGroup(
    id: json['id'] as String? ?? '', eventId: json['eventId'] as String? ?? '', name: json['name'] as String? ?? '',
    leaderUserId: json['leaderUserId'] as String? ?? '', backupLeaderUserId: json['backupLeaderUserId'] as String? ?? '',
    status: GroupStatusParser.fromJson(json['status']), color: json['color'] as String? ?? '#3169a6',
    routeId: json['routeId'] as String? ?? '', startingStopPointId: json['startingStopPointId'] as String? ?? '',
    endingStopPointId: json['endingStopPointId'] as String? ?? '',
    currentLatitude: (json['currentLatitude'] as num?)?.toDouble(), currentLongitude: (json['currentLongitude'] as num?)?.toDouble(),
    lastLocationUpdateAt: _date(json['lastLocationUpdateAt']), accessCodeId: json['accessCodeId'] as String?,
    memberCount: (json['memberCount'] as num?)?.toInt() ?? 0);

  Map<String, dynamic> toJson() => { 'id': id, 'eventId': eventId, 'name': name, 'leaderUserId': leaderUserId,
    'backupLeaderUserId': backupLeaderUserId, 'status': status.name, 'color': color, 'routeId': routeId,
    'startingStopPointId': startingStopPointId, 'endingStopPointId': endingStopPointId,
    'currentLatitude': currentLatitude, 'currentLongitude': currentLongitude,
    'lastLocationUpdateAt': lastLocationUpdateAt?.toIso8601String(), 'accessCodeId': accessCodeId, 'memberCount': memberCount };

  factory ProcessionGroup.fromFirestore(DocumentSnapshot<Map<String, dynamic>> doc) => ProcessionGroup.fromJson({...?doc.data(), 'id': doc.id});

  Map<String, dynamic> toFirestore() => { 'eventId': eventId, 'name': name, 'leaderUserId': leaderUserId,
    'backupLeaderUserId': backupLeaderUserId, 'status': status.name, 'color': color, 'routeId': routeId,
    'startingStopPointId': startingStopPointId, 'endingStopPointId': endingStopPointId,
    'currentLatitude': currentLatitude, 'currentLongitude': currentLongitude,
    'lastLocationUpdateAt': lastLocationUpdateAt == null ? null : Timestamp.fromDate(lastLocationUpdateAt!),
    'accessCodeId': accessCodeId, 'memberCount': memberCount };

  static DateTime? _date(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    return null;
  }
}