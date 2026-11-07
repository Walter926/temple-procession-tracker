import { createHash } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onValueWritten } from 'firebase-functions/v2/database';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
const db = getFirestore;

/** Persist in-app notices before attempting best-effort FCM delivery. */
async function notify(uid: string, sourceId: string, type: string, eventId: string, title: string, body: string): Promise<void> {
  if (!uid) return;
  const ref = db().doc(`notifications/${uid}_${createHash('sha256').update(sourceId).digest('hex').slice(0, 32)}`);
  try { await ref.create({ uid, sourceId, type, eventId, title, body, isRead: false, createdAt: FieldValue.serverTimestamp() }); }
  catch (e: unknown) { if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 6) return; throw e; }
  const devices = await db().collection('deviceTokens').where('uid', '==', uid).get();
  const tokens = [...new Set(devices.docs.map(d => String(d.data().token ?? '')).filter(Boolean))].slice(0, 500);
  if (!tokens.length) return;
  const response = await getMessaging().sendEachForMulticast({ tokens, notification: { title, body }, data: { type, eventId, sourceId } });
  const bad = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
  const batch = db().batch(); let dirty = false;
  response.responses.forEach((item, index) => { if (!item.success && item.error && bad.has(item.error.code)) { for (const snap of devices.docs) if (snap.data().token === tokens[index]) { batch.delete(snap.ref); dirty = true; } } });
  if (dirty) await batch.commit();
}
export const registerDeviceToken = onCall({ maxInstances: 10 }, async request => {
  const uid = request.auth?.uid, token = String(request.data?.token ?? '');
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (token.length < 20 || token.length > 4096) throw new HttpsError('invalid-argument', 'Invalid FCM token.');
  const profile = (await db().doc(`users/${uid}`).get()).data();
  if (profile?.isActive !== true) throw new HttpsError('permission-denied', 'Inactive account.');
  const hash = createHash('sha256').update(token).digest('hex');
  await db().doc(`deviceTokens/${uid}_${hash}`).set({ uid, token, platform: 'android', updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
export const markNotificationRead = onCall({ maxInstances: 10 }, async request => {
  const uid = request.auth?.uid, id = String(request.data?.notificationId ?? '');
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (!/^[A-Za-z0-9_-]{3,240}$/.test(id)) throw new HttpsError('invalid-argument', 'Invalid notification ID.');
  const ref = db().doc(`notifications/${id}`), snap = await ref.get();
  if (!snap.exists || snap.data()?.uid !== uid) throw new HttpsError('permission-denied', 'Not your notification.');
  await ref.update({ isRead: true, readAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
export const notificationFromCollision = onDocumentCreated({ document: 'collisionWarnings/{id}', maxInstances: 10 }, async event => {
  const d = event.data?.data(); if (!d) return;
  await notify(String(d.uid), `collisionWarning_${event.params.id}`, 'collision', String(d.eventId ?? ''), 'Collision warning', String(d.message ?? 'Follow dispatch instructions.'));
});
export const notificationFromRoute = onDocumentCreated({ document: 'routeInstructions/{id}', maxInstances: 10 }, async event => {
  const d = event.data?.data(); if (!d) return;
  await notify(String(d.uid), `routeInstruction_${event.params.id}`, 'route', String(d.eventId ?? ''), 'Approved route instruction', String(d.message ?? ''));
});
export const notificationFromArrival = onDocumentCreated({ document: 'arrivalNotifications/{id}', maxInstances: 10 }, async event => {
  const d = event.data?.data(); if (!d) return;
  const group = (await db().doc(`groups/${d.groupId}`).get()).data();
  if (group?.leaderUserId) await notify(String(group.leaderUserId), `arrival_${event.params.id}`, 'arrival', String(d.eventId), 'Stop arrival recorded', String(d.message ?? 'Arrival confirmed.'));
});
export const notificationFromDelay = onDocumentWritten({ document: 'groups/{id}', maxInstances: 10 }, async event => {
  const d = event.data?.after.data(), before = event.data?.before.data();
  if (!d || d.status !== 'delayed' || before?.status === 'delayed' || !d.leaderUserId) return;
  await notify(String(d.leaderUserId), `delay_${event.id}`, 'delay', String(d.eventId ?? ''), 'Group delayed', 'Your group is now marked delayed.');
});
export const notificationFromStoppedGps = onValueWritten({ ref: '/trackingStatus/{eventId}/{groupId}', region: 'us-central1', maxInstances: 10 }, async event => {
  const d = event.data.after.val() as Record<string, unknown> | null;
  const before = event.data.before.val() as Record<string, unknown> | null;
  if (d?.state !== 'stopped' || before?.state === 'stopped') return;
  const group = (await db().doc(`groups/${event.params.groupId}`).get()).data();
  if (!group?.leaderUserId || group.eventId !== event.params.eventId) return;
  await notify(String(group.leaderUserId), `gpsStopped_${event.id}`, 'gps_stopped', String(event.params.eventId), 'GPS tracking stopped', 'Your GPS session has stopped. Restart when safe.');
});
export const notificationFromAnnouncement = onDocumentCreated({ document: 'publicAnnouncements/{id}', maxInstances: 10 }, async event => {
  const d = event.data?.data(); if (!d || d.isActive !== true) return;
  const eventId = String(d.eventId ?? '');
  const [memberships, leaders] = await Promise.all([db().collection('memberships').where('eventId', '==', eventId).get(), db().collection('groups').where('eventId', '==', eventId).get()]);
  const uids = [...new Set([...memberships.docs.map(s => String(s.data().uid ?? '')), ...leaders.docs.map(s => String(s.data().leaderUserId ?? ''))].filter(Boolean))];
  if (uids.length > 400) throw Error('Announcement fan-out is limited to 400 recipients; use Pub/Sub batches for larger events.');
  await Promise.all(uids.map(uid => notify(uid, `announcement_${event.params.id}`, 'announcement', eventId, 'Organizer announcement', String(d.message ?? ''))));
});