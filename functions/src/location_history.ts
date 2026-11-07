import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onValueWritten } from 'firebase-functions/v2/database';
const db = getFirestore;
const intervalMs = 30000;
/** One immutable history point per UTC 30-second bucket; the `locationUpdateId` remains compatible with the existing ZIP `LocationHistoryRecord` model; duplicate trigger delivery is idempotent. */
export const recordLocationHistory = onValueWritten({ ref: '/liveLocations/{eventId}/{groupId}', region: 'us-central1', maxInstances: 10 }, async event => {
  const d = event.data.after.val() as Record<string, unknown> | null;
  if (!d) return;
  const { eventId, groupId } = event.params;
  const at = Number(d.recordedAt), latitude = Number(d.latitude), longitude = Number(d.longitude), accuracy = Number(d.accuracyMeters);
  if (![at, latitude, longitude, accuracy].every(Number.isFinite) || Math.abs(Date.now() - at) > 120000 || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) return;
  const [eventSnap, groupSnap] = await Promise.all([db().doc(`events/${eventId}`).get(), db().doc(`groups/${groupId}`).get()]);
  const group = groupSnap.data();
  if (eventSnap.data()?.status !== 'active' || !group || group.eventId !== eventId || group.leaderUserId !== d.userId) return;
  const bucket = Math.floor(at / intervalMs);
  const doc = db().doc(`locationHistory/${eventId}_${groupId}_${bucket}`);
  try { await doc.create({ eventId, groupId, locationUpdateId: `${eventId}_${groupId}_${bucket}`, userId: d.userId, latitude, longitude, accuracyMeters: accuracy,
    speedMetersPerSecond: Number.isFinite(Number(d.speedMetersPerSecond)) ? Number(d.speedMetersPerSecond) : 0,
    headingDegrees: Number.isFinite(Number(d.headingDegrees)) ? Number(d.headingDegrees) : 0,
    recordedAt: Timestamp.fromMillis(at), bucket }); }
  catch (error: unknown) { if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 6) return; throw error; }
});