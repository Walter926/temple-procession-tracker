import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onValueWritten } from 'firebase-functions/v2/database';
import { distanceMeters } from './geo_math';
import { loadRouteConfiguration, routeConfigurationVersion } from './route_configuration';

const db = getFirestore;
export const maximumSampleAgeMs = 45000;
export const maximumSampleGapMs = 45000;
export const historySampleIntervalMs = 15000;
export type GpsSample = { latitude: number; longitude: number; accuracyMeters: number; recordedAt: number; userId: string; speedMetersPerSecond?: number };

/** Delayed uploads must never become fresh observations. No numeric coercion. */
export function usableSample(value: Record<string, unknown> | null, now: number): value is GpsSample {
  if (!value || typeof value.userId !== 'string' || !value.userId) return false;
  const { latitude, longitude, accuracyMeters, recordedAt } = value;
  return [latitude, longitude, accuracyMeters, recordedAt].every(v => typeof v === 'number' && Number.isFinite(v)) &&
    Math.abs(latitude as number) <= 90 && Math.abs(longitude as number) <= 180 &&
    (accuracyMeters as number) >= 0 && (accuracyMeters as number) <= 100 &&
    (recordedAt as number) <= now + 5000 && now - (recordedAt as number) <= maximumSampleAgeMs;
}

export function newerSample(sampleAt: number, previous: unknown): boolean {
  return sampleAt > (typeof previous === 'number' && Number.isFinite(previous) ? previous : 0);
}

type Segment = { id: string; order: number; startLatitude: number; startLongitude: number; endLatitude: number; endLongitude: number };
export function nearestSegment(lat: number, lng: number, segments: readonly Segment[]): Segment | undefined {
  let best: Segment | undefined, bestDistance = Infinity;
  for (const s of segments) {
    if (![s.startLatitude, s.startLongitude, s.endLatitude, s.endLongitude].every(Number.isFinite) ||
      Math.abs(s.startLatitude) > 90 || Math.abs(s.endLatitude) > 90 || Math.abs(s.startLongitude) > 180 || Math.abs(s.endLongitude) > 180) continue;
    const scale = Math.cos((s.startLatitude + s.endLatitude) / 2 * Math.PI / 180);
    if (Math.abs(scale) < 1e-8) continue;
    const x1 = s.startLongitude * scale, x2 = s.endLongitude * scale;
    const dx = x2 - x1, dy = s.endLatitude - s.startLatitude;
    const t = dx * dx + dy * dy ? Math.max(0, Math.min(1, ((lng * scale - x1) * dx + (lat - s.startLatitude) * dy) / (dx * dx + dy * dy))) : 0;
    const distance = distanceMeters(lat, lng, s.startLatitude + t * dy, (x1 + t * dx) / scale);
    if (distance < bestDistance && distance <= 250) { bestDistance = distance; best = s; }
  }
  return best;
}

/** Transactional sample watermark prevents duplicate/out-of-order trigger updates. */
export const updateRouteProgress = onValueWritten({ ref: '/liveLocations/{eventId}/{groupId}', region: 'us-central1', maxInstances: 10, retry: true }, async event => {
  const location = event.data.after.val() as Record<string, unknown> | null;
  const now = Date.now();
  if (!usableSample(location, now)) return;
  const { eventId, groupId } = event.params;
  const groupRef = db().doc(`groups/${groupId}`);
  const initial = (await groupRef.get()).data();
  if (!initial?.routeId || initial.eventId !== eventId) return;
  const routeId = String(initial.routeId);
  const configuration = await loadRouteConfiguration(routeId);
  if (configuration.eventId !== eventId) return;
  const { stops, segments } = configuration;
  await db().runTransaction(async tx => {
    const progressRef = db().doc(`groupProgress/${groupId}`);
    const [progress, groupSnap, eventSnap, leaderSnap, routeSnap] = await Promise.all([
      tx.get(progressRef), tx.get(groupRef), tx.get(db().doc(`events/${eventId}`)), tx.get(db().doc(`users/${location.userId}`)), tx.get(db().doc(`routes/${routeId}`)),
    ]);
    const group = groupSnap.data(), leader = leaderSnap.data(), previous = progress.data();
    if (!group || group.deleting === true || group.eventId !== eventId || group.routeId !== routeId || group.status === 'completed' ||
      eventSnap.data()?.status !== 'active' || eventSnap.data()?.deleting === true || routeSnap.data()?.eventId !== eventId || routeSnap.data()?.deleting === true || group.leaderUserId !== location.userId ||
      leader?.isActive !== true || leader.deleting === true || leader.role !== 'teamLeader' || leader.assignedGroupId !== groupId ||
      routeConfigurationVersion(routeSnap) !== configuration.version ||
      !newerSample(location.recordedAt, previous?.lastProgressSampleAt) || !usableSample(location, Date.now())) return;
    const start = stops.findIndex(s => s.id === group.startingStopPointId), end = stops.findIndex(s => s.id === group.endingStopPointId);
    if (start < 0 || end < start) return;
    const assigned = stops.slice(start, end + 1);
    const completed = new Set<string>(Array.isArray(previous?.completedStopIds) ? previous.completedStopIds : []);
    const next = assigned.find(stop => !completed.has(stop.id));
    const count = assigned.filter(stop => completed.has(stop.id)).length;
    const speed = location.speedMetersPerSecond;
    const seconds = next && typeof speed === 'number' && Number.isFinite(speed) && speed >= 0.8 && speed <= 15 ? distanceMeters(location.latitude, location.longitude, next.latitude, next.longitude) / speed : null;
    const eta = seconds !== null && seconds < 86400 ? Timestamp.fromMillis(location.recordedAt + Math.round(seconds * 1000)) : null;
    const expected = next?.expectedArrivalTime;
    const late = expected instanceof Timestamp && now - expected.toMillis() > 300000;
    const segment = nearestSegment(location.latitude, location.longitude, segments);
    const recordHistory = location.recordedAt - Number(previous?.lastHistorySampleAt ?? 0) >= historySampleIntervalMs;
    if (recordHistory) {
      // The progress transaction owns the sampling watermark. Duplicate and late
      // database triggers cannot multiply precise-location records or regress it.
      const historyId = `${groupId}_${location.recordedAt}`;
      tx.set(db().doc(`locationHistory/${historyId}`), {
        eventId, groupId, routeId, userId: location.userId, locationUpdateId: historyId,
        latitude: location.latitude, longitude: location.longitude, accuracyMeters: location.accuracyMeters,
        recordedAt: Timestamp.fromMillis(location.recordedAt), createdAt: Timestamp.fromMillis(now),
      });
    }
    tx.set(progressRef, { eventId, groupId, routeId, totalStops: assigned.length, completedCount: count, progressPercent: 100 * count / assigned.length,
      nextStopPointId: next?.id ?? '', currentSegmentId: segment?.id ?? '', estimatedArrivalAt: eta, lastComputedAt: Timestamp.fromMillis(now),
      lastProgressSampleAt: location.recordedAt, lastLocationAt: Timestamp.fromMillis(location.recordedAt), isStale: false, isDelayed: late,
      ...(recordHistory ? { lastHistorySampleAt: location.recordedAt } : {}),
      suggestedStatus: late ? 'delayed' : String(previous?.suggestedStatus ?? '') }, { merge: true });
    if (late && ['waiting', 'preparing', 'moving'].includes(String(group.status))) tx.update(groupRef, { status: 'delayed', statusUpdatedAt: FieldValue.serverTimestamp() });
  });
});
