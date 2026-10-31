import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onValueWritten } from 'firebase-functions/v2/database';
import { distanceMeters } from './geo_math';

const db = getFirestore;
const throttleMs = 30000;

type Segment = { id: string; order: number; startLatitude: number; startLongitude: number; endLatitude: number; endLongitude: number };
function nearestSegment(lat: number, lng: number, segments: Segment[]): Segment | undefined {
  let best: Segment | undefined, bestDistance = Infinity;
  for (const segment of segments) {
    if (![segment.startLatitude, segment.startLongitude, segment.endLatitude, segment.endLongitude].every(Number.isFinite)) continue;
    const midLat = (segment.startLatitude + segment.endLatitude) / 2 * Math.PI / 180;
    const x1 = segment.startLongitude * Math.cos(midLat), y1 = segment.startLatitude;
    const x2 = segment.endLongitude * Math.cos(midLat), y2 = segment.endLatitude;
    const x = lng * Math.cos(midLat), y = lat;
    const dx = x2 - x1, dy = y2 - y1;
    const t = dx * dx + dy * dy > 0 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
    const metres = distanceMeters(lat, lng, y1 + t * dy, (x1 + t * dx) / Math.cos(midLat));
    if (metres < bestDistance) { bestDistance = metres; best = segment; }
  }
  return best;
}

/** Computes progress from trusted stop arrivals and approximate latest GPS position. */
export const updateRouteProgress = onValueWritten({ ref: '/liveLocations/{eventId}/{groupId}', region: 'us-central1', maxInstances: 10 }, async event => {
  const location = event.data.after.val() as Record<string, unknown> | null;
  if (!location) return;
  const { eventId, groupId } = event.params;
  const lat = Number(location.latitude), lng = Number(location.longitude), speed = Number(location.speedMetersPerSecond);
  const now = Date.now();
  if (![lat, lng].every(Number.isFinite) || Math.abs(now - Number(location.recordedAt)) > 120000 || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  const [groupSnap, eventSnap, progressSnap] = await Promise.all([db().doc(`groups/${groupId}`).get(), db().doc(`events/${eventId}`).get(), db().doc(`groupProgress/${groupId}`).get()]);
  const group = groupSnap.data();
  if (!group || group.eventId !== eventId || eventSnap.data()?.status !== 'active' || group.leaderUserId !== location.userId) return;
  const last = progressSnap.data()?.lastComputedAt;
  if (last instanceof Timestamp && now - last.toMillis() < throttleMs) return;
  const [stopQuery, segmentQuery] = await Promise.all([
    db().collection('stopPoints').where('routeId', '==', String(group.routeId)).get(),
    db().collection('routeSegments').where('routeId', '==', String(group.routeId)).get(),
  ]);
  const stops = stopQuery.docs.map(doc => ({ id: doc.id, order: Number(doc.data().order), latitude: Number(doc.data().latitude), longitude: Number(doc.data().longitude), expectedArrivalTime: doc.data().expectedArrivalTime as Timestamp | null })).sort((a, b) => a.order - b.order);
  const start = stops.findIndex(s => s.id === group.startingStopPointId), end = stops.findIndex(s => s.id === group.endingStopPointId);
  if (start < 0 || end < start) return;
  const assigned = stops.slice(start, end + 1);
  const segments: Segment[] = segmentQuery.docs.map(doc => ({ id: doc.id, order: Number(doc.data().order), startLatitude: Number(doc.data().startLatitude), startLongitude: Number(doc.data().startLongitude), endLatitude: Number(doc.data().endLatitude), endLongitude: Number(doc.data().endLongitude) }));
  const nearest = nearestSegment(lat, lng, segments);
  const progressRef = db().doc(`groupProgress/${groupId}`);
  await db().runTransaction(async tx => {
    const [fresh, currentGroup] = await Promise.all([tx.get(progressRef), tx.get(db().doc(`groups/${groupId}`))]);
    const freshLast = fresh.data()?.lastComputedAt;
    if (freshLast instanceof Timestamp && now - freshLast.toMillis() < throttleMs) return;
    const completed = new Set<string>(Array.isArray(fresh.data()?.completedStopIds) ? fresh.data()!.completedStopIds : []);
    const next = assigned.find(stop => !completed.has(stop.id));
    const count = assigned.filter(stop => completed.has(stop.id)).length;
    const etaSeconds = next && speed >= 0.8 ? distanceMeters(lat, lng, next.latitude, next.longitude) / Math.max(speed, 0.8) : null;
    const eta = etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds < 86400 ? Timestamp.fromMillis(now + Math.round(etaSeconds * 1000)) : null;
    const late = next?.expectedArrivalTime instanceof Timestamp && now - next.expectedArrivalTime.toMillis() > 5 * 60000;
    const status = String(currentGroup.data()?.status ?? 'waiting');
    tx.set(progressRef, { eventId, groupId, routeId: group.routeId, totalStops: assigned.length, completedCount: count, progressPercent: assigned.length > 0 ? 100 * count / assigned.length : 0,
      nextStopPointId: next?.id ?? '', currentSegmentId: nearest?.id ?? '', estimatedArrivalAt: eta, lastComputedAt: Timestamp.fromMillis(now), isDelayed: late === true,
      suggestedStatus: late === true ? 'delayed' : String(fresh.data()?.suggestedStatus ?? '') }, { merge: true });
    if (late === true && ['waiting', 'preparing', 'moving'].includes(status)) tx.update(currentGroup.ref, { status: 'delayed', statusUpdatedAt: FieldValue.serverTimestamp() });
  });
});