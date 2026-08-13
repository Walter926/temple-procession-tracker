import '../models/access_code.dart';
import '../repositories/access_code_repository.dart';

class AccessCodeService {
  final AccessCodeRepository _accessCodeRepository;

  AccessCodeService({
    AccessCodeRepository? accessCodeRepository,
  }) : _accessCodeRepository =
            accessCodeRepository ?? AccessCodeRepository();

  Future<void> createAccessCode(AccessCode accessCode) async {
    await _accessCodeRepository.create(accessCode);
  }

  Future<AccessCode?> getAccessCode(String accessCodeId) async {
    return _accessCodeRepository.read(accessCodeId);
  }

  Future<AccessCode?> findActiveCode(String code) async {
    final accessCode = await _accessCodeRepository.readByCode(code);

    if (accessCode == null) {
      return null;
    }

    if (!isUsable(accessCode)) {
      return null;
    }

    return accessCode;
  }

  bool isExpired(AccessCode accessCode) {
    final expiresAt = accessCode.expiresAt;

    if (expiresAt == null) {
      return false;
    }

    return DateTime.now().isAfter(expiresAt);
  }

  bool hasRemainingUses(AccessCode accessCode) {
    return accessCode.usedCount < accessCode.maxUses;
  }

  bool isUsable(AccessCode accessCode) {
    return accessCode.isActive &&
        !isExpired(accessCode) &&
        hasRemainingUses(accessCode);
  }

  Future<void> markCodeUsed(AccessCode accessCode) async {
    final updatedAccessCode = AccessCode(
      id: accessCode.id,
      eventId: accessCode.eventId,
      groupId: accessCode.groupId,
      code: accessCode.code,
      isActive: accessCode.isActive,
      maxUses: accessCode.maxUses,
      usedCount: accessCode.usedCount + 1,
      expiresAt: accessCode.expiresAt,
      createdAt: accessCode.createdAt,
    );

    await _accessCodeRepository.update(updatedAccessCode);
  }

  Stream<List<AccessCode>> watchCodesForEvent(String eventId) {
    return _accessCodeRepository.streamByEventId(eventId);
  }
}