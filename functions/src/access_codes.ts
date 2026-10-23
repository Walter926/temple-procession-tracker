import { randomBytes, createHash } from 'node:crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

type CreateRequest = { eventId?: string; groupId?: string; scope?: string; grantedRole?: string; expiresAtMs?: number; maxUses?: number; enabled?: boolean };
const db = getFirestore;
const invalid = (message: string): never => { throw new HttpsError('invalid-argument', message); };
async function requireManagement(uid?: string) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const snap = await db().doc(`users/${uid}`).get();
  if (!snap.exists || snap.data()?.isActive !== true || !['admin', 'organizer'].includes(snap.data()?.role)) {
    throw new HttpsError('permission-denied', 'An active management account is required.');
  }
}

export const createAccessCode = onCall({ maxInstances: 10 }, async (request) => {
  await requireManagement(request.auth?.uid);
  const value = request.data as CreateRequest;
  const eventId = String(value.eventId ?? '').trim();
  const groupId = String(value.groupId ?? '').trim();
  const scope = value.scope;
  const maxUses = Number(value.maxUses);
  const expiresAtMs = Number(value.expiresAtMs);
  if (!eventId || (scope !== 'event' && scope !== 'group') || (scope === 'group') !== Boolean(groupId)) invalid('Select a valid event and scope.');
  if (value.grantedRole !== 'teamMember') invalid('Codes may grant teamMember membership only.');
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) invalid('Maximum uses must be 1–1000.');
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || expiresAtMs > Date.now() + 366 * 86400000) invalid('Expiration must be within one year.');
  const event = await db().doc(`events/${eventId}`).get();
  if (!event.exists || ['completed', 'cancelled', 'archived'].includes(event.data()?.status)) invalid('Select an available event.');
  if (groupId) {
    const group = await db().doc(`groups/${groupId}`).get();
    if (!group.exists || group.data()?.eventId !== eventId) invalid('Group does not belong to this event.');
  }
  // 80 bits of cryptographic randomness; plaintext is returned once and never stored in Firestore.
  const token = randomBytes(10).toString('hex').toUpperCase();
  const id = createHash('sha256').update(token).digest('hex');
  await db().doc(`accessCodes/${id}`).create({ eventId, groupId, scope, grantedRole: 'teamMember', enabled: value.enabled === true,
    maxUses, usedCount: 0, expiresAt: Timestamp.fromMillis(expiresAtMs), createdAt: Timestamp.now(), createdBy: request.auth!.uid });
  return { id, code: token.match(/.{1,4}/g)!.join('-') };
});

export const revokeAccessCode = onCall({ maxInstances: 10 }, async (request) => {
  await requireManagement(request.auth?.uid);
  const id = String((request.data as { id?: string })?.id ?? '');
  if (!/^[a-f0-9]{64}$/.test(id)) invalid('Invalid access code ID.');
  await db().doc(`accessCodes/${id}`).update({ enabled: false });
  return { revoked: true };
});

export const redeemAccessCode = onCall({ maxInstances: 10 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in before joining.');
  const token = String((request.data as { code?: string })?.code ?? '').replace(/[-\s]/g, '').toUpperCase();
  if (!/^[A-F0-9]{20}$/.test(token)) invalid('Code must contain 20 hexadecimal characters.');
  const id = createHash('sha256').update(token).digest('hex');
  return db().runTransaction(async (tx) => {
    const codeRef = db().doc(`accessCodes/${id}`);
    const userRef = db().doc(`users/${uid}`);
    const code = await tx.get(codeRef);
    if (!code.exists) throw new HttpsError('not-found', 'Invalid access code.');
    const data = code.data()!;
    const eventId = String(data.eventId);
    const groupId = String(data.groupId ?? '');
    const memberRef = db().doc(`memberships/${eventId}_${uid}`);
    const eventRef = db().doc(`events/${eventId}`);
    const groupRef = groupId ? db().doc(`groups/${groupId}`) : null;
    const [user, member, event, group] = await Promise.all([tx.get(userRef), tx.get(memberRef), tx.get(eventRef), groupRef ? tx.get(groupRef) : Promise.resolve(null)]);
    if (!user.exists || user.data()?.isActive !== true) throw new HttpsError('permission-denied', 'Your account is inactive or missing.');
    if (!event.exists || ['completed', 'cancelled', 'archived'].includes(String(event.data()?.status))) {
      throw new HttpsError('failed-precondition', 'This event is not open for joining.');
    }
    if (groupRef && (!group?.exists || group.data()?.eventId !== eventId)) throw new HttpsError('failed-precondition', 'Group unavailable.');
    if (member.exists) {
      const oldGroup = String(member.data()?.groupId ?? '');
      if (oldGroup && oldGroup !== groupId) throw new HttpsError('already-exists', 'You already belong to a different group for this event.');
      if (oldGroup === groupId || !groupId) return { eventId, groupId: oldGroup, alreadyJoined: true };
    }
    if (data.enabled !== true) throw new HttpsError('failed-precondition', 'This code is disabled or revoked.');
    if (!(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= Date.now()) throw new HttpsError('deadline-exceeded', 'This code has expired.');
    if (data.grantedRole !== 'teamMember') throw new HttpsError('permission-denied', 'Unsupported role grant.');
    if (data.usedCount >= data.maxUses) throw new HttpsError('resource-exhausted', 'Maximum number of code uses reached.');
    tx.update(codeRef, { usedCount: data.usedCount + 1 });
    tx.set(memberRef, { uid, eventId, groupId, membershipRole: 'teamMember', joinedAt: Timestamp.now() });
    tx.update(userRef, { joinedEventId: eventId, joinedGroupId: groupId });
    if (groupRef) tx.update(groupRef, { memberCount: Number(group!.data()?.memberCount ?? 0) + 1 });
    return { eventId, groupId, alreadyJoined: false };
  });
});