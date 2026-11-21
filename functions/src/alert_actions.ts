import { randomUUID } from 'node:crypto';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { activeAccount, digest, documentId, eventManager, millis, queueNotification } from './notifications';
import { maximumSampleAgeMs } from './route_progress';

const db = getFirestore;
const options = { maxInstances: 10, enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true' };

export const resolveCollisionAlert = onCall(options, async request => {
  const alertId = documentId(request.data?.alertId, 'alert ID');
  await db().runTransaction(async tx => {
    const ref = db().doc(`collisionAlerts/${alertId}`), snap = await tx.get(ref), alert = snap.data();
    if (!alert) throw new HttpsError('not-found', 'Alert not found.');
    await eventManager(tx, request.auth?.uid, documentId(alert.eventId));
    if (alert.status === 'suppressed' || alert.status === 'resolved') return;
    if (alert.status !== 'active') throw new HttpsError('failed-precondition', 'Active alert required.');
    // Suppression applies to this generation only; a cleared and recurring incident is fresh.
    tx.update(ref, { status: 'suppressed', acknowledgedByAdmin: request.auth!.uid, resolvedAt: Timestamp.now() });
  });
  return { ok: true };
});

export const sendCollisionInstruction = onCall(options, async request => {
  const alertId = documentId(request.data?.alertId, 'alert ID'), message = typeof request.data?.message === 'string' ? request.data.message.trim() : '';
  if (!message || message.length > 500) throw new HttpsError('invalid-argument', 'A 1–500 character message is required.');
  const requestId = request.data?.requestId ? documentId(request.data.requestId, 'request ID') : randomUUID();
  const result = await db().runTransaction(async tx => {
    const alertRef = db().doc(`collisionAlerts/${alertId}`), alert = (await tx.get(alertRef)).data();
    if (!alert) throw new HttpsError('not-found', 'Alert not found.');
    const event = await eventManager(tx, request.auth?.uid, documentId(alert.eventId));
    if (alert.status !== 'active' || !alert.incidentId || event.status !== 'active' || Date.now() - millis(alert.lastSeenAt) > maximumSampleAgeMs || !Array.isArray(alert.affectedGroupIds)) throw new HttpsError('failed-precondition', 'A current, active incident is required.');
    const ids = [...new Set<string>(alert.affectedGroupIds.map(id => documentId(id)))];
    if (ids.length > 100) throw new HttpsError('resource-exhausted', 'At most 100 groups may receive one instruction.');
    const instructionId = digest('collision-instruction', alert.incidentId, request.auth!.uid, requestId);
    const [previousSnap, existing, groupSnaps] = await Promise.all([
      alert.lastInstructionId ? tx.get(db().doc(`collisionInstructions/${documentId(alert.lastInstructionId)}`)) : Promise.resolve(null),
      tx.get(db().doc(`collisionInstructions/${instructionId}`)), Promise.all(ids.map(id => tx.get(db().doc(`groups/${id}`)))),
    ]);
    if (existing.exists) {
      if (existing.data()?.message !== message) throw new HttpsError('already-exists', 'Request ID already used with a different message.');
      return { instructionId, recipients: Number(existing.data()?.leaderUids?.length ?? 0) };
    }
    const previous = previousSnap?.data();
    if (previous && previous.message === message && previous.state === 'active' && previous.incidentId === alert.incidentId && millis(previous.expiresAt) > Date.now()) return { instructionId: previousSnap!.id, recipients: previous.leaderUids.length };
    const candidateGroups = groupSnaps.filter(s => s.data()?.eventId === alert.eventId && s.data()?.status !== 'completed' && typeof s.data()?.leaderUserId === 'string' && s.data()?.leaderUserId);
    const userSnaps = await Promise.all(candidateGroups.map(s => tx.get(db().doc(`users/${s.data()!.leaderUserId}`))));
    const recipients = candidateGroups.flatMap((group, i) => {
      const user = userSnaps[i].data();
      return user?.isActive === true && user.role === 'teamLeader' && user.assignedGroupId === group.id ? [{ uid: userSnaps[i].id, groupId: group.id }] : [];
    });
    if (!recipients.length) throw new HttpsError('failed-precondition', 'No active assigned leaders are available.');
    const previousWarnings = previousSnap ? await tx.get(db().collection('collisionWarnings').where('instructionId', '==', previousSnap.id).limit(101)) : null;
    const now = Timestamp.now(), expiresAt = Timestamp.fromMillis(Date.now() + 15 * 60000), retentionAt = Timestamp.fromMillis(Date.now() + 30 * 86400000);
    if (previousSnap && ['active', 'acknowledged'].includes(String(previous?.state))) tx.update(previousSnap.ref, { state: 'superseded', supersededBy: instructionId, endedAt: now });
    for (const warning of previousWarnings?.docs ?? []) if (['active', 'acknowledged'].includes(String(warning.data().state))) tx.update(warning.ref, { state: 'superseded', supersededBy: instructionId, endedAt: now });
    tx.create(existing.ref, { alertId, incidentId: alert.incidentId, eventId: alert.eventId, message, leaderUids: recipients.map(r => r.uid), state: 'active', createdBy: request.auth!.uid,
      createdAt: now, expiresAt, lifecycleDueAt: expiresAt, retentionAt });
    tx.update(alertRef, { lastInstructionId: instructionId });
    for (const { uid, groupId } of recipients) {
      const warningId = digest(instructionId, uid);
      tx.create(db().doc(`collisionWarnings/${warningId}`), { uid, groupId, alertId, incidentId: alert.incidentId, instructionId, eventId: alert.eventId, message, type: 'instruction',
        state: 'active', createdAt: now, expiresAt, lifecycleDueAt: expiresAt, retentionAt, acknowledgedAt: null });
      queueNotification(tx, warningId, { uid, eventId: alert.eventId, groupId, title: 'Dispatch instruction', body: message, type: 'collision-instruction',
        sourceCollection: 'collisionWarnings', sourceId: warningId, leaderOnly: true, expiresAt });
    }
    return { instructionId, recipients: recipients.length };
  });
  return { ok: true, ...result };
});

export async function acknowledgeMessage(uid: string | undefined, collection: 'collisionWarnings' | 'routeInstructions', id: string): Promise<{ ok: true }> {
  await db().runTransaction(async tx => {
    const user = await activeAccount(tx, uid), ref = db().doc(`${collection}/${id}`), snap = await tx.get(ref), message = snap.data();
    if (!message || message.uid !== uid) throw new HttpsError('permission-denied', 'Message does not belong to this account.');
    const [groupSnap, eventSnap, alertSnap, head] = await Promise.all([
      tx.get(db().doc(`groups/${documentId(message.groupId)}`)), tx.get(db().doc(`events/${documentId(message.eventId)}`)), tx.get(db().doc(`collisionAlerts/${documentId(message.alertId)}`)),
      collection === 'routeInstructions' ? tx.get(db().doc(`routeInstructionHeads/${message.groupId}`)) : Promise.resolve(null),
    ]);
    const group = groupSnap.data(), alert = alertSnap.data();
    if (!group || user.role !== 'teamLeader' || user.assignedGroupId !== message.groupId || group.leaderUserId !== uid || group.eventId !== message.eventId) throw new HttpsError('permission-denied', 'Current leader assignment required.');
    if (message.state === 'acknowledged') return;
    if (message.state !== 'active' || millis(message.expiresAt) <= Date.now() || eventSnap.data()?.status !== 'active' || alert?.status !== 'active' || alert.incidentId !== message.incidentId || !alert.affectedGroupIds?.includes(message.groupId) ||
      (message.instructionId && alert.lastInstructionId !== message.instructionId) || (collection === 'routeInstructions' && head?.data()?.instructionId !== id)) throw new HttpsError('failed-precondition', 'This message is no longer current.');
    tx.update(ref, { state: 'acknowledged', acknowledgedAt: Timestamp.now() });
  });
  return { ok: true };
}

export const acknowledgeCollisionWarning = onCall(options, async request => acknowledgeMessage(request.auth?.uid, 'collisionWarnings', documentId(request.data?.warningId, 'warning ID')));
