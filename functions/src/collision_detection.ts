import { getApp } from 'firebase-admin/app';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onValueWritten } from 'firebase-functions/v2/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { findCollisions, type CollisionGroup, type CollisionStop } from './collision_engine';

const rtdbUrl = defineString('RTDB_URL');
const db = getFirestore;

/** Event-level recount makes two simultaneous leader updates converge on the same stable alert ID. */
async function recount(eventId: string): Promise<void> {
  const eventDoc = await db().doc(`events/${eventId}`).get();
  if (eventDoc.data()?.status !== 'active') {
    const outstanding = await db().collection('collisionAlerts').where('eventId', '==', eventId).get();
    const batch = db().batch(); let changed = false;
    for (const alert of outstanding.docs) if (['active', 'suppressed'].includes(String(alert.data().status))) { batch.update(alert.ref, { status: 'resolved', resolvedAt: FieldValue.serverTimestamp() }); changed = true; }
    if (changed) await batch.commit();
    return;
  }
  const [groupsQuery, positionsSnap] = await Promise.all([
    db().collection('groups').where('eventId', '==', eventId).get(),
    getDatabaseWithUrl(rtdbUrl.value(), getApp()).ref(`liveLocations/${eventId}`).get()
  ]);
  const raw = positionsSnap.val() as Record<string, Record<string, unknown>> | null;
  if (groupsQuery.size > 100) throw Error('Collision scan is limited to 100 groups per event; use a paginated design for larger events.');
  const now = Date.now(), groups: CollisionGroup[] = [];
  const routes = new Set<string>();
  for (const doc of groupsQuery.docs) {
    const data = doc.data(), position = raw?.[doc.id];
    if (data.routeId) routes.add(String(data.routeId));
    if (!position || !data.routeId || data.status === 'completed') continue;
    if (position.userId !== data.leaderUserId) continue;
    const recordedAt = Number(position.recordedAt), latitude = Number(position.latitude), longitude = Number(position.longitude), accuracy = Number(position.accuracyMeters);
    if (![recordedAt, latitude, longitude, accuracy].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) continue;
    groups.push({ id: doc.id, routeId: String(data.routeId), latitude, longitude, accuracy, recordedAt });
    routes.add(String(data.routeId));
  }
  const stopDocs = await Promise.all([...routes].map(routeId => db().collection('stopPoints').where('routeId', '==', routeId).get()));
  const stops: CollisionStop[] = stopDocs.flatMap(s => s.docs.map(doc => ({ id: doc.id, routeId: String(doc.data().routeId ?? ''), latitude: Number(doc.data().latitude), longitude: Number(doc.data().longitude), radiusMeters: Number(doc.data().geofenceRadiusMeters ?? 100), maxAllowedGroups: Number(doc.data().maxAllowedGroups ?? 1) }))).filter(stop => [stop.latitude, stop.longitude, stop.radiusMeters, stop.maxAllowedGroups].every(Number.isFinite) && Math.abs(stop.latitude) <= 90 && Math.abs(stop.longitude) <= 180);
  if (stops.length > 400) throw Error('Collision scan is limited to 400 stop points per event.');
  const collisions = findCollisions(groups, stops, now);
  const collisionByStop = new Map(collisions.map(c => [c.stopPointId, c]));
  // A stable alert document ID prevents duplicate concurrent alerts for the same event/stop.
  for (const stop of stops) {
    const ref = db().doc(`collisionAlerts/${eventId}_${stop.id}`), found = collisionByStop.get(stop.id);
    await db().runTransaction(async tx => {
      const snap = await tx.get(ref), old = snap.data();
      if (found) {
        if (old?.status === 'suppressed') return; // An admin suppressed this incident until crowding clears.
        const fields = { eventId, stopPointId: stop.id, affectedGroupIds: found.groupIds, count: found.count, maxAllowedGroups: found.maximum, severity: found.severity, status: 'active', lastSeenAt: FieldValue.serverTimestamp() };
        if (!snap.exists || old?.status === 'resolved') tx.set(ref, { ...fields, createdAt: FieldValue.serverTimestamp(), resolvedAt: null });
        else tx.update(ref, fields);
      } else if (snap.exists && ['active', 'suppressed'].includes(String(old?.status))) {
        tx.update(ref, { status: 'resolved', resolvedAt: FieldValue.serverTimestamp(), lastSeenAt: FieldValue.serverTimestamp() });
      }
    });
  }
}

export const detectGroupCollision = onValueWritten({ ref: '/liveLocations/{eventId}/{groupId}', region: 'us-central1', maxInstances: 10 }, async event => { await recount(event.params.eventId); });

/** Scheduled expiry resolves incidents even when the last device goes offline. */
export const reconcileGroupCollisions = onSchedule({ schedule: 'every 2 minutes', timeZone: 'Etc/UTC', maxInstances: 1 }, async () => {
  const active = await db().collection('collisionAlerts').where('status', 'in', ['active', 'suppressed']).limit(400).get();
  const eventIds = [...new Set(active.docs.map(s => String(s.data().eventId ?? '')).filter(Boolean))];
  for (const id of eventIds) await recount(id);
});