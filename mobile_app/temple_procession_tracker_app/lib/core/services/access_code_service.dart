import 'package:cloud_functions/cloud_functions.dart';
import '../models/access_code.dart';
import '../repositories/access_code_repository.dart';

class IssuedAccessCode {
  final String id, code;
  final DateTime? expiresAt;
  const IssuedAccessCode({
    required this.id,
    required this.code,
    this.expiresAt,
  });
}

/// Codes, redemption counts, and membership records are owned by the server.
class AccessCodeService {
  static const int defaultMaxUses = 1000;
  final FirebaseFunctions _functions;
  final AccessCodeRepository _repository;
  AccessCodeService({
    FirebaseFunctions? functions,
    AccessCodeRepository? accessCodeRepository,
  }) : _functions =
           functions ?? FirebaseFunctions.instanceFor(region: 'us-central1'),
       _repository = accessCodeRepository ?? AccessCodeRepository();

  static String normalize(String code) {
    final value = code.trim().toUpperCase();
    // Old invitations grouped 20 hex symbols with hyphens. Match the server's
    // legacy normalization without accepting separators in new six-symbol codes.
    final legacy = value.replaceAll(RegExp(r'[-\s]'), '');
    return RegExp(r'^[A-F0-9]{20}$').hasMatch(legacy) ? legacy : value;
  }

  static bool isValidFormat(String code) =>
      RegExp(r'^(?:[A-Z0-9]{6}|[A-F0-9]{20})$').hasMatch(normalize(code));

  Future<IssuedAccessCode> generate({
    required String eventId,
    String groupId = '',
    int maxUses = defaultMaxUses,
  }) async {
    if (maxUses < 1 || maxUses > 1000) {
      throw ArgumentError('Maximum uses must be 1–1000.');
    }
    final result = await _functions
        .httpsCallable('createAccessCode')
        .call<Map<String, dynamic>>({
          'eventId': eventId,
          'groupId': groupId,
          'scope': groupId.isEmpty ? 'event' : 'group',
          'grantedRole': 'teamMember',
          'enabled': true,
          'maxUses': maxUses,
          // Older deployed functions require this; current functions own expiry.
          'expiresAtMs': DateTime.now()
              .add(const Duration(hours: 24))
              .millisecondsSinceEpoch,
        });
    final id = result.data['id'];
    final code = result.data['code'];
    final expiresAtMs = result.data['expiresAtMs'];
    if (id is! String ||
        id.trim().isEmpty ||
        code is! String ||
        !isValidFormat(code) ||
        (expiresAtMs != null &&
            (expiresAtMs is! num ||
                !expiresAtMs.isFinite ||
                expiresAtMs <= 0 ||
                expiresAtMs > 8640000000000000 ||
                expiresAtMs % 1 != 0))) {
      throw StateError('The server returned an invalid access code.');
    }
    return IssuedAccessCode(
      id: id,
      code: code,
      expiresAt: expiresAtMs is num
          ? DateTime.fromMillisecondsSinceEpoch(expiresAtMs.toInt())
          : null,
    );
  }

  Future<Map<String, dynamic>> redeem(String code) async {
    if (!isValidFormat(code)) {
      throw ArgumentError(
        'Enter six letters or numbers, or a legacy 20-character hexadecimal code.',
      );
    }
    final result = await _functions
        .httpsCallable('redeemAccessCode')
        .call<Map<String, dynamic>>({'code': normalize(code)});
    return result.data;
  }

  Future<void> revoke(String id) async {
    await _functions.httpsCallable('revokeAccessCode').call({'id': id});
  }

  Future<AccessCode?> getAccessCode(String id) => _repository.read(id);
  Stream<List<AccessCode>> watchCodesForEvent(String eventId) =>
      _repository.streamByEventId(eventId);
  Stream<List<AccessCode>> watchCodesForGroup(String groupId) =>
      _repository.streamByGroupId(groupId);
}
