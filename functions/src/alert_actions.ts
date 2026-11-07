import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
const db = getFirestore;
async function management(uid?: string): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const user = (await db().doc(`users/${uid}`).get()).data();
  if (user?.isActive !== true || !['admin', 'organizer'].includes(user.role)) throw new HttpsError('permission-denied', 'Management role required.');
}
export const resolveCollisionAlert = onCall({ maxInstances: 10 }, async request => {
  await management(request.auth?.uid);
  const alertId = String(request.data?.alertId ?? '');
  if (!/^[A-Za-z0-9_-]{2,240}$/.test(alertId)) throw new HttpsError('invalid-argument', 'Invalid alert ID.');
  const ref = db().doc(`collisionAlerts/${alertId}`);
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Alert not found.');
    // Suppressed means an operator accepted the risk; detector will clear suppression when density drops.
    tx.update(ref, { status: 'suppressed', acknowledgedByAdmin: request.auth!.uid, resolvedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

export const sendCollisionInstruction = onCall({ maxInstances: 10 }, async request => {
  await management(request.auth?.uid);
  const alertId = String(request.data?.alertId ?? ''), message = String(request.data?.message ?? '').trim();
  if (!/^[A-Za-z0-9_-]{2,240}$/.test(alertId) || message.length < 1 || message.length > 500) throw new HttpsError('invalid-argument', 'Alert ID and 1–500 character message required.');
  const alert = (await db().doc(`collisionAlerts/${alertId}`).get()).data();
  if (!alert || alert.status !== 'active' || !Array.isArray(alert.affectedGroupIds)) throw new HttpsError('failed-precondition', 'Active alert required.');
  const ids = [...new Set(alert.affectedGroupIds.map(String))].slice(0, 100);
  const groupSnaps = await Promise.all(ids.map(id => db().doc(`groups/${id}`).get()));
  const leaders = [...new Set(groupSnaps.map(s => String(s.data()?.leaderUserId ?? '')).filter(Boolean))];
  const batch = db().batch();
  const instructionId = db().collection('collisionInstructions').doc().id;
  batch.create(db().doc(`collisionInstructions/${instructionId}`), { alertId, eventId: alert.eventId, message, leaderUids: leaders, createdBy: request.auth!.uid, createdAt: FieldValue.serverTimestamp() });
  for (const uid of leaders) batch.set(db().doc(`collisionWarnings/${instructionId}_${uid}`), { uid, alertId, instructionId, eventId: alert.eventId, message, state: 'unread', createdAt: FieldValue.serverTimestamp(), acknowledgedAt: null });
  await batch.commit();
  return { ok: true, recipients: leaders.length };
});

export const acknowledgeCollisionWarning = onCall({ maxInstances: 10 }, async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const warningId = String(request.data?.warningId ?? '');
  if (!/^[A-Za-z0-9_-]{3,240}$/.test(warningId)) throw new HttpsError('invalid-argument', 'Invalid warning ID.');
  const ref = db().doc(`collisionWarnings/${warningId}`);
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.uid !== uid) throw new HttpsError('permission-denied', 'Warning does not belong to this account.');
    if (snap.data()?.state !== 'acknowledged') tx.update(ref, { state: 'acknowledged', acknowledgedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});
