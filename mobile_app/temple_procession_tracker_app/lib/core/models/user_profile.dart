import 'package:cloud_firestore/cloud_firestore.dart';
import '../enums/user_role.dart';

class UserProfile {
  final String id, email, displayName, assignedGroupId, joinedEventId, joinedGroupId;
  final UserRole role;
  final String? photoUrl, phoneNumber;
  final bool isActive;
  final DateTime createdAt;
  final DateTime? updatedAt;

  const UserProfile({required this.id, required this.email, required this.displayName, required this.role,
    this.photoUrl, this.phoneNumber, required this.isActive, required this.createdAt, this.updatedAt,
    this.assignedGroupId = '', this.joinedEventId = '', this.joinedGroupId = ''});

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
    id: json['id'] as String? ?? '', email: json['email'] as String? ?? '', displayName: json['displayName'] as String? ?? '',
    role: UserRoleParser.fromJson(json['role']), photoUrl: json['photoUrl'] as String?, phoneNumber: json['phoneNumber'] as String?,
    isActive: json['isActive'] as bool? ?? true, createdAt: _date(json['createdAt']) ?? DateTime.now(), updatedAt: _date(json['updatedAt']),
    assignedGroupId: json['assignedGroupId'] as String? ?? '', joinedEventId: json['joinedEventId'] as String? ?? '',
    joinedGroupId: json['joinedGroupId'] as String? ?? '');

  Map<String, dynamic> toJson() => { 'id': id, 'email': email, 'displayName': displayName, 'role': role.name, 'photoUrl': photoUrl,
    'phoneNumber': phoneNumber, 'isActive': isActive, 'createdAt': createdAt.toIso8601String(),
    'updatedAt': updatedAt?.toIso8601String(), 'assignedGroupId': assignedGroupId, 'joinedEventId': joinedEventId, 'joinedGroupId': joinedGroupId };

  factory UserProfile.fromFirestore(DocumentSnapshot<Map<String, dynamic>> document) => UserProfile.fromJson({...?document.data(), 'id': document.id});

  Map<String, dynamic> toFirestore() => { 'email': email, 'displayName': displayName, 'role': role.name, 'photoUrl': photoUrl,
    'phoneNumber': phoneNumber, 'isActive': isActive, 'createdAt': Timestamp.fromDate(createdAt),
    'updatedAt': updatedAt == null ? null : Timestamp.fromDate(updatedAt!), 'assignedGroupId': assignedGroupId,
    'joinedEventId': joinedEventId, 'joinedGroupId': joinedGroupId };

  static DateTime? _date(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    return null;
  }
}