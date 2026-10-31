import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onValueWritten } from 'firebase-functions/v2/database';
import { distanceMeters, insideGeofence } from './geo_math';

const db = getFirestore;
const minimumStayMs = 20000;
type Stop = { id: string; order: number; latitude: number; longitude: number; radius: number };

/** Server-side, idempotent arrival detection for authenticated primary leader GPS. */
export const detectStopArrival = onValueWritten({ ref: '/liveLocations/{eventId}/{groupId}', region: 'us-central1', maxInstances: 10 }, async event => {
  const data = event.data.after.val() as Record<string, unknown> | null;
  if (!data) return;
  const { eventId, groupId } = event.params;
  const latitude = Number(data.latitude), longitude = Number(data.longitude);
  const accuracy = Number(data.accuracyMeters), sampleAt = Number(data.recordedAt);
  const now = Date.now();
  if (![latitude, longitude, accuracy, sampleAt].every(Number.isFinite) || Math.abs(now - sampleAt) > 120000 || accuracy < 0 || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
  const [groupSnap, eventSnap] = await Promise.all([db().doc(`groups/${groupId}`).get(), db().doc(`events/${eventId}`).get()]);
  const group = groupSnap.data();
  if (!group || group.eventId !== eventId || eventSnap.data()?.status !== 'active' || !group.leaderUserId || group.leaderUserId !== data.userId) return;
  const [leader, stopQuery] = await Promise.all([db().doc(`users/${group.leaderUserId}`).get(), db().collection('stopPoints').where('routeId', '==', String(group.routeId)).get()]);
  if (leader.data()?.role !== 'teamLeader' || leader.data()?.isActive !== true || leader.data()?.assignedGroupId !== groupId) return;
  const ordered: Stop[] = stopQuery.docs.map(doc => ({ id: doc.id, order: Number(doc.data().order), latitude: Number(doc.data().latitude), longitude: Number(doc.data().longitude), radius: Number(doc.data().geofenceRadiusMeters ?? 100) })).filter(stop => Number.isFinite(stop.order)).sort((a, b) => a.order - b.order);
  const startIndex = ordered.findIndex(stop => stop.id === group.startingStopPointId);
  const endIndex = ordered.findIndex(stop => stop.id === group.endingStopPointId);
  if (startIndex < 0 || endIndex < startIndex) return;
  const assigned = ordered.slice(startIndex, endIndex + 1);
  const progressRef = db().doc(`groupProgress/${groupId}`);
  const presenceRef = db().doc(`stopPresence/${groupId}`);
  await db().runTransaction(async tx => {
    const [progressSnap, presenceSnap] = await Promise.all([tx.get(progressRef), tx.get(presenceRef)]);
    const completed = new Set<string>(Array.isArray(progressSnap.data()?.completedStopIds) ? progressSnap.data()!.completedStopIds : []);
    const next = assigned.find(stop => !completed.has(stop.id));
    if (!next) { if (presenceSnap.exists) tx.delete(presenceRef); return; }
    const distance = distanceMeters(latitude, longitude, next.latitude, next.longitude);
    if (!insideGeofence(distance, next.radius, accuracy)) { if (presenceSnap.exists) tx.delete(presenceRef); return; }
    const firstSeen = presenceSnap.data()?.stopId === next.id ? Number(presenceSnap.data()?.firstSeenAt ?? now) : now;
    if (now - firstSeen < minimumStayMs) {
      tx.set(presenceRef, { eventId, groupId, stopId: next.id, firstSeenAt: firstSeen, lastSeenAt: now, lastDistanceMeters: distance });
      return;
    }
    const arrivalRef = db().doc(`stopArrivals/${groupId}_${next.id}`);
    const arrivalSnap = await tx.get(arrivalRef);
    if (arrivalSnap.exists) { tx.delete(presenceRef); return; }
    completed.add(next.id);
    const following = assigned.find(stop => !completed.has(stop.id));
    const arrivedAt = Timestamp.fromMillis(now);
    tx.create(arrivalRef, { eventId, groupId, stopPointId: next.id, order: next.order, actualArrivalAt: arrivedAt, distanceMeters: distance, accuracyMeters: accuracy });
    tx.set(progressRef, { eventId, groupId, routeId: group.routeId, completedStopIds: [...completed], completedCount: completed.size, totalStops: assigned.length, progressPercent: 100 * completed.size / assigned.length, currentStopPointId: next.id, nextStopPointId: following?.id ?? '', actualArrivalAt: arrivedAt, suggestedStatus: 'arrived' }, { merge: true });
    tx.create(db().doc(`arrivalNotifications/${groupId}_${next.id}`), { eventId, groupId, stopPointId: next.id, message: `Group ${group.name ?? groupId} arrived at stop #${next.order}`, createdAt: arrivedAt });
    tx.delete(presenceRef);
  });
});