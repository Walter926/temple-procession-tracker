import { DocumentData, FieldValue, getFirestore, Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertActiveUser, assertAvailableEvent, callableOptions, documentId, requireActiveUser, requireEventManager } from './authorization';

export function membershipId(eventId: string, uid: string): string { return `${eventId}_${uid}`; }
export function nextMemberCount(value: unknown, delta: number): number {
  const current = Number(value ?? 0);
  if (!Number.isSafeInteger(current) || current < 0 || current + delta < 0) throw new HttpsError('failed-precondition', 'Group member count needs reconciliation.');
  return current + delta;
}
/** All reads must precede this helper. */
export function writeMembership(tx: Transaction, uid: string, eventId: string, groupId: string,
  oldMembership: DocumentData | undefined, oldGroup: DocumentData | undefined, newGroup: DocumentData | undefined): void {
  const db = getFirestore(), oldGroupId = String(oldMembership?.groupId ?? '');
  if (oldGroupId !== groupId) {
    if (oldGroupId && oldGroup) tx.update(db.doc(`groups/${oldGroupId}`), { memberCount: nextMemberCount(oldGroup.memberCount, -1) });
    if (groupId && newGroup) tx.update(db.doc(`groups/${groupId}`), { memberCount: nextMemberCount(newGroup.memberCount, 1) });
  }
  tx.set(db.doc(`memberships/${membershipId(eventId, uid)}`), { uid, eventId, groupId, membershipRole: 'teamMember',
    joinedAt: oldMembership?.joinedAt ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
}
export const setActiveMembership = onCall(callableOptions, async request => {
  const eventId = documentId(request.data?.eventId, 'event ID'), uid = request.auth?.uid;
  return getFirestore().runTransaction(async tx => {
    await requireActiveUser(uid, tx);
    const db = getFirestore(), membership = (await tx.get(db.doc(`memberships/${membershipId(eventId, uid!)}`))).data();
    assertAvailableEvent((await tx.get(db.doc(`events/${eventId}`))).data());
    if (!membership || membership.uid !== uid || membership.eventId !== eventId || membership.isActive === false || ['removed','revoked'].includes(membership.status)) throw new HttpsError('permission-denied', 'Join this event before selecting it.');
    const groupId = String(membership.groupId ?? '');
    if (groupId) {
      const group = (await tx.get(db.doc(`groups/${documentId(groupId)}`))).data();
      if (!group || group.eventId !== eventId) throw new HttpsError('failed-precondition', 'Membership group is unavailable.');
    }
    if (request.data?.groupId !== undefined && request.data.groupId !== groupId) throw new HttpsError('failed-precondition', 'Membership changed. Refresh and select again.');
    tx.update(db.doc(`users/${uid}`), { joinedEventId: eventId, joinedGroupId: groupId, updatedAt: FieldValue.serverTimestamp() });
    return { eventId, groupId };
  });
});
async function changeMembership(actorUid: string | undefined, data: Record<string, unknown>, remove: boolean) {
  const eventId = documentId(data.eventId, 'event ID'), uid = documentId(data.uid ?? actorUid, 'user ID');
  const groupId = remove || data.groupId === '' ? '' : documentId(data.groupId, 'group ID');
  return getFirestore().runTransaction(async tx => {
    await requireActiveUser(actorUid, tx);
    if (!remove || uid !== actorUid) await requireEventManager(actorUid, eventId, tx);
    const db = getFirestore(), ref = db.doc(`memberships/${membershipId(eventId, uid)}`);
    const [memberSnap, userSnap, eventSnap] = await Promise.all([tx.get(ref), tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`events/${eventId}`))]);
    const member = memberSnap.data(), user = userSnap.data();
    if (!remove) { assertAvailableEvent(eventSnap.data()); assertActiveUser(user); }
    if (!member) {
      if (remove) return { eventId, groupId: '', removed: false };
      throw new HttpsError('not-found', 'Membership not found.');
    }
    if (member.uid !== uid || member.eventId !== eventId) throw new HttpsError('failed-precondition', 'Membership needs administrator reconciliation.');
    const oldGroupId = String(member.groupId ?? '');
    const oldGroup = oldGroupId ? (await tx.get(db.doc(`groups/${documentId(oldGroupId)}`))).data() : undefined;
    const newGroup = groupId ? (await tx.get(db.doc(`groups/${groupId}`))).data() : undefined;
    if (groupId && (!newGroup || newGroup.eventId !== eventId || newGroup.deleting === true)) throw new HttpsError('failed-precondition', 'Destination group does not belong to this event.');
    if (remove) {
      if (oldGroupId && oldGroup) tx.update(db.doc(`groups/${oldGroupId}`), { memberCount: nextMemberCount(oldGroup.memberCount, -1) });
      tx.delete(ref);
    } else writeMembership(tx, uid, eventId, groupId, member, oldGroup, newGroup);
    if (user && user.joinedEventId === eventId) tx.update(userSnap.ref, { joinedEventId: remove ? '' : eventId, joinedGroupId: groupId, updatedAt: FieldValue.serverTimestamp() });
    return { eventId, groupId, removed: remove };
  });
}
export const removeMembership = onCall(callableOptions, request => changeMembership(request.auth?.uid, request.data ?? {}, true));
export const transferMembership = onCall(callableOptions, request => changeMembership(request.auth?.uid, request.data ?? {}, false));
