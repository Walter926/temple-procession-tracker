import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onValueWritten } from 'firebase-functions/v2/database';
import { distanceMeters, insideGeofence } from './geo_math';
import { maximumSampleGapMs, newerSample, usableSample } from './route_progress';
import { loadRouteConfiguration, routeConfigurationVersion } from './route_configuration';

const db = getFirestore;

/** Dwell is measured in accepted GPS sample time, never trigger processing time. */
export function dwellStart(stopId: string, sampleAt: number, previous: Record<string, unknown> | undefined): number {
  const last = previous?.lastSampleAt, first = previous?.firstSeenAt;
  return previous?.stopId === stopId && typeof last === 'number' && typeof first === 'number' &&
    sampleAt > last && sampleAt - last <= maximumSampleGapMs && first <= last ? first : sampleAt;
}

export const detectStopArrival = onValueWritten({ ref: '/liveLocations/{eventId}/{groupId}', region: 'us-central1', maxInstances: 10, retry: true }, async event => {
  const sample = event.data.after.val() as Record<string, unknown> | null;
  if (!usableSample(sample, Date.now())) return;
  const { eventId, groupId } = event.params;
  const groupRef = db().doc(`groups/${groupId}`);
  const initial = (await groupRef.get()).data();
  if (!initial?.routeId || initial.eventId !== eventId) return;
  const routeId = String(initial.routeId);
  const configuration = await loadRouteConfiguration(routeId);
  if (configuration.eventId !== eventId) return;
  const ordered = configuration.stops;
  await db().runTransaction(async tx => {
    const progressRef = db().doc(`groupProgress/${groupId}`), presenceRef = db().doc(`stopPresence/${groupId}`);
    const [progressSnap, presenceSnap, groupSnap, eventSnap, leaderSnap, routeSnap] = await Promise.all([
      tx.get(progressRef), tx.get(presenceRef), tx.get(groupRef), tx.get(db().doc(`events/${eventId}`)), tx.get(db().doc(`users/${sample.userId}`)), tx.get(db().doc(`routes/${routeId}`)),
    ]);
    const group = groupSnap.data(), leader = leaderSnap.data(), progress = progressSnap.data(), presence = presenceSnap.data();
    if (!group || group.deleting === true || group.eventId !== eventId || group.routeId !== routeId || group.status === 'completed' || eventSnap.data()?.status !== 'active' || eventSnap.data()?.deleting === true ||
      routeSnap.data()?.eventId !== eventId || routeSnap.data()?.deleting === true || group.leaderUserId !== sample.userId || leader?.role !== 'teamLeader' || leader.isActive !== true || leader.deleting === true || leader.assignedGroupId !== groupId ||
      routeConfigurationVersion(routeSnap) !== configuration.version ||
      !newerSample(sample.recordedAt, presence?.lastSampleAt) || !newerSample(sample.recordedAt, progress?.lastArrivalSampleAt) || !usableSample(sample, Date.now())) return;
    const start = ordered.findIndex(s => s.id === group.startingStopPointId), end = ordered.findIndex(s => s.id === group.endingStopPointId);
    if (start < 0 || end < start) return;
    const assigned = ordered.slice(start, end + 1);
    const completed = new Set<string>(Array.isArray(progress?.completedStopIds) ? progress.completedStopIds : []);
    const next = assigned.find(stop => !completed.has(stop.id));
    const distance = next ? distanceMeters(sample.latitude, sample.longitude, next.latitude, next.longitude) : Infinity;
    const inside = next && insideGeofence(distance, next.geofenceRadiusMeters, sample.accuracyMeters);
    const firstSeenAt = inside ? dwellStart(next.id, sample.recordedAt, presence?.routeId === routeId ? presence : undefined) : sample.recordedAt;
    // Keep an outside watermark: an older delayed sample cannot recreate presence.
    const presenceValue = { eventId, groupId, routeId, stopId: inside ? next.id : '', firstSeenAt, lastSampleAt: sample.recordedAt, lastSeenAt: Timestamp.now() };
    if (!inside || sample.recordedAt - firstSeenAt < 20000) { tx.set(presenceRef, presenceValue); return; }
    const arrivalRef = db().doc(`stopArrivals/${groupId}_${next.id}`), noticeRef = db().doc(`arrivalNotifications/${groupId}_${next.id}`);
    const [arrival, notice] = await Promise.all([tx.get(arrivalRef), tx.get(noticeRef)]);
    completed.add(next.id);
    const following = assigned.find(stop => !completed.has(stop.id));
    const arrivedAt = Timestamp.fromMillis(sample.recordedAt);
    if (!arrival.exists) tx.create(arrivalRef, { eventId, groupId, stopPointId: next.id, order: next.order, actualArrivalAt: arrivedAt, distanceMeters: distance, accuracyMeters: sample.accuracyMeters });
    const count = assigned.filter(s => completed.has(s.id)).length;
    tx.set(progressRef, { eventId, groupId, routeId, completedStopIds: [...completed], completedCount: count, totalStops: assigned.length, progressPercent: 100 * count / assigned.length,
      currentStopPointId: next.id, nextStopPointId: following?.id ?? '', actualArrivalAt: arrivedAt, suggestedStatus: 'arrived', lastArrivalSampleAt: sample.recordedAt }, { merge: true });
    if (!notice.exists) tx.create(noticeRef, { eventId, groupId, stopPointId: next.id, message: `Group ${group.name ?? groupId} arrived at stop #${next.order}`, createdAt: arrivedAt });
    tx.set(presenceRef, { ...presenceValue, stopId: '' });
  });
});
