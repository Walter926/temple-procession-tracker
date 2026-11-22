import { randomInt, createHash } from 'node:crypto';
import { getFirestore, Timestamp, FieldValue, DocumentData } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { assertAvailableEvent, assertEventManager, assertPrimaryLeader, callableOptions, consumeAttempt, documentId, requireActiveUser } from './authorization';
import { membershipId, writeMembership } from './memberships';

export const CODE_LIFETIME_MS = 86_400_000;
export const DEFAULT_MAX_USES = 1000;
/** Both clients may omit the limit; only newly issued codes use this default. */
export function accessCodeMaxUses(value: unknown = DEFAULT_MAX_USES): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1000) throw new HttpsError('invalid-argument', 'Maximum uses must be an integer from 1 to 1000.');
  return value;
}
export function generateCode(): string { return randomInt(1_000_000).toString().padStart(6, '0'); }
export function codeHash(code: string): string { return createHash('sha256').update(code).digest('hex'); }
export function normalizeCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9]{6}$/.test(value.trim().toUpperCase())) throw new HttpsError('invalid-argument', 'Enter a six-digit code or an unexpired legacy code.');
  return value.trim().toUpperCase();
}
function redemptionCode(value: unknown): string {
  // Historical repository code used 20 hexadecimal symbols in hyphenated groups;
  // this compatibility path does not imply those codes exist in production.
  // Accept legacy codes only on redemption, without shortening or reissuing them.
  const legacy = typeof value === 'string' ? value.replace(/[-\s]/g, '').toUpperCase() : '';
  return /^[A-F0-9]{20}$/.test(legacy) ? legacy : normalizeCode(value);
}
export function validateCode(data: DocumentData | undefined, now: number): void {
  if (!data) throw new HttpsError('not-found', 'Invalid access code.');
  if (data.enabled !== true || data.revokedAt) throw new HttpsError('failed-precondition', 'This code is revoked or disabled.');
  if (!(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= now) throw new HttpsError('deadline-exceeded', 'This code has expired.');
  if (data.grantedRole !== 'teamMember' || !['event','group'].includes(data.scope) || (data.scope === 'group') !== Boolean(data.groupId)) throw new HttpsError('failed-precondition', 'Invalid membership code.');
  // Missing/zero limits retain the previous local unlimited semantics; do not
  // apply the new-issuance default or range to existing stored records.
  const maxUses = data.maxUses === undefined ? 0 : data.maxUses;
  if (typeof maxUses !== 'number' || !Number.isSafeInteger(maxUses) || maxUses < 0) throw new HttpsError('failed-precondition', 'This code has an invalid usage limit. Ask the organizer to issue a new code.');
  if (maxUses > 0 && data.usedCount >= maxUses) throw new HttpsError('resource-exhausted', 'Code usage limit reached.');
}
export const createAccessCode = onCall(callableOptions, async request => {
  await requireActiveUser(request.auth?.uid);
  await consumeAttempt(request.auth!.uid, 'createCode', 20, 3_600_000);
  const eventId = documentId(request.data?.eventId), groupId = request.data?.groupId ? documentId(request.data.groupId) : '';
  const scope = request.data?.scope ?? (groupId ? 'group' : 'event');
  const maxUses = accessCodeMaxUses(request.data?.maxUses);
  if (!['event','group'].includes(scope) || (scope === 'group') !== Boolean(groupId) || (request.data?.grantedRole && request.data.grantedRole !== 'teamMember')) throw new HttpsError('invalid-argument', 'Invalid code scope or role.');
  for (let n = 0; n < 10; n++) {
    const code = generateCode(), id = codeHash(code), expiresAtMs = Date.now() + CODE_LIFETIME_MS;
    const created = await getFirestore().runTransaction(async tx => {
      const db = getFirestore(), user = await requireActiveUser(request.auth?.uid, tx);
      const event = (await tx.get(db.doc(`events/${eventId}`))).data();
      const group = groupId ? (await tx.get(db.doc(`groups/${groupId}`))).data() : undefined;
      const ref = db.doc(`accessCodes/${id}`), existing = await tx.get(ref);
      assertAvailableEvent(event);
      if (groupId && (!group || group.eventId !== eventId || group.deleting)) throw new HttpsError('failed-precondition', 'Group unavailable.');
      if (user.role === 'teamLeader' && group) assertPrimaryLeader(user, request.auth!.uid, groupId, group);
      else assertEventManager(user, request.auth!.uid, event);
      if (existing.exists) return false;
      tx.create(ref, { eventId, groupId, scope, grantedRole: 'teamMember', enabled: true, maxUses, usedCount: 0,
        expiresAt: Timestamp.fromMillis(expiresAtMs), createdAt: FieldValue.serverTimestamp(), createdBy: request.auth!.uid });
      return true;
    });
    if (created) return { id, code, expiresAtMs, maxUses };
  }
  throw new HttpsError('resource-exhausted', 'Unable to allocate a unique code. Try again.');
});
export const revokeAccessCode = onCall(callableOptions, async request => {
  const id = String(request.data?.id ?? '');
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpsError('invalid-argument', 'Invalid code ID.');
  await getFirestore().runTransaction(async tx => {
    const db = getFirestore(), user = await requireActiveUser(request.auth?.uid, tx), ref = db.doc(`accessCodes/${id}`);
    const code = (await tx.get(ref)).data();
    if (!code) throw new HttpsError('not-found', 'Code not found.');
    const event = (await tx.get(db.doc(`events/${documentId(code.eventId)}`))).data();
    const group = code.groupId ? (await tx.get(db.doc(`groups/${documentId(code.groupId)}`))).data() : undefined;
    if (user.role === 'teamLeader' && group) assertPrimaryLeader(user, request.auth!.uid, code.groupId, group);
    else assertEventManager(user, request.auth!.uid, event);
    tx.update(ref, { enabled: false, revokedAt: FieldValue.serverTimestamp() });
  });
  return { revoked: true };
});
export const redeemAccessCode = onCall(callableOptions, async request => {
  await requireActiveUser(request.auth?.uid);
  await consumeAttempt(request.auth!.uid, 'redeemCodeMinute', 10);
  await consumeAttempt(request.auth!.uid, 'redeemCodeHour', 60, 3_600_000);
  const id = codeHash(redemptionCode(request.data?.code)), uid = request.auth!.uid;
  return getFirestore().runTransaction(async tx => {
    const db = getFirestore(), user = await requireActiveUser(uid, tx), codeRef = db.doc(`accessCodes/${id}`);
    if (!['teamMember','teamLeader'].includes(user.role)) throw new HttpsError('permission-denied', 'Membership codes are for team members and leaders.');
    const data = (await tx.get(codeRef)).data();
    // Validate before checking duplicates, including revoked and expired codes.
    validateCode(data, Date.now());
    const eventId = documentId(data!.eventId), groupId = data!.groupId ? documentId(data!.groupId) : '';
    const [memberSnap, eventSnap, groupSnap] = await Promise.all([tx.get(db.doc(`memberships/${membershipId(eventId, uid)}`)),
      tx.get(db.doc(`events/${eventId}`)), groupId ? tx.get(db.doc(`groups/${groupId}`)) : Promise.resolve(undefined)]);
    assertAvailableEvent(eventSnap.data());
    const group = groupSnap?.data(), member = memberSnap.data(), oldGroupId = String(member?.groupId ?? '');
    if (member && (member.uid !== uid || member.eventId !== eventId || member.isActive === false || ['removed','revoked'].includes(member.status))) throw new HttpsError('failed-precondition', 'Membership needs administrator reconciliation.');
    if (groupId && (!group || group.eventId !== eventId || group.deleting)) throw new HttpsError('failed-precondition', 'Group unavailable.');
    if (oldGroupId && groupId && oldGroupId !== groupId) throw new HttpsError('already-exists', 'Ask the organizer to transfer your existing group membership.');
    const alreadyJoined = Boolean(member) && (!groupId || oldGroupId === groupId), selectedGroup = alreadyJoined ? oldGroupId : groupId;
    if (!alreadyJoined) {
      writeMembership(tx, uid, eventId, groupId, member, undefined, group);
      tx.update(codeRef, { usedCount: FieldValue.increment(1), lastRedeemedAt: FieldValue.serverTimestamp() });
    }
    tx.update(db.doc(`users/${uid}`), { joinedEventId: eventId, joinedGroupId: selectedGroup, updatedAt: FieldValue.serverTimestamp() });
    return { eventId, groupId: selectedGroup, alreadyJoined };
  });
});
export const cleanupExpiredAccessCodes = onSchedule({ schedule: 'every 15 minutes', maxInstances: 1 }, async () => {
  for (let page = 0; page < 10; page++) {
    const expired = await getFirestore().collection('accessCodes').where('expiresAt', '<=', Timestamp.now()).limit(400).get();
    if (expired.empty) break;
    const batch = getFirestore().batch();
    expired.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    if (expired.size < 400) break;
  }
});
