import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { usableSample, newerSample, nearestSegment, updateRouteProgress } from './route_progress';
import { detectStopArrival, dwellStart } from './stop_arrival';
import { reconciledTrackingState } from './maintenance';
import { projectCollisionMirror } from './collision_alert_mirror';

const now = 1800000000000;
const sample = { userId: 'leader', latitude: 12, longitude: 79, accuracyMeters: 10, recordedAt: now };

test('GPS rejects delayed, future, nonnumeric, inaccurate and invalid-coordinate samples', () => {
  assert.equal(usableSample(sample, now), true);
  for (const change of [{ recordedAt: now - 45001 }, { recordedAt: now + 5001 }, { recordedAt: String(now) }, { recordedAt: NaN },
    { accuracyMeters: 101 }, { accuracyMeters: -1 }, { accuracyMeters: Infinity }, { latitude: 91 }, { longitude: -181 }, { userId: '' }]) {
    assert.equal(usableSample({ ...sample, ...change }, now), false, JSON.stringify(change));
  }
  assert.equal(usableSample({ ...sample, recordedAt: now - 45000 }, now), true);
  assert.equal(newerSample(now, now), false);
  assert.equal(newerSample(now - 1, now), false);
  assert.equal(newerSample(now + 1, now), true);
});

test('dwell requires ordered observations at the same stop with no long GPS gap', () => {
  const previous = { stopId: 'stop', firstSeenAt: now - 25000, lastSampleAt: now - 10000 };
  assert.equal(dwellStart('stop', now, previous), now - 25000);
  assert.equal(dwellStart('other', now, previous), now);
  assert.equal(dwellStart('stop', now, { ...previous, lastSampleAt: now - 45001 }), now);
  assert.equal(dwellStart('stop', now - 20000, previous), now - 20000);
});

test('progress never chooses distant or malformed route segments', () => {
  const segment = { id: 'near', order: 1, startLatitude: 12, endLatitude: 12.001, startLongitude: 79, endLongitude: 79 };
  assert.equal(nearestSegment(12, 79, [segment])?.id, 'near');
  assert.equal(nearestSegment(13, 79, [segment]), undefined);
  assert.equal(nearestSegment(12, 79, [{ ...segment, endLatitude: 100 }]), undefined);
});

test('heartbeat expires active devices without converting pause/error to active', () => {
  assert.equal(reconciledTrackingState({ state: 'active', updatedAt: now - 45001 }, true, now), 'disconnected');
  assert.equal(reconciledTrackingState({ state: 'active', updatedAt: now }, true, now), 'active');
  assert.equal(reconciledTrackingState({ state: 'active', updatedAt: now + 60000 }, true, now), 'disconnected');
  for (const state of ['paused', 'stopped', 'error']) assert.equal(reconciledTrackingState({ state, updatedAt: now - 999999 }, true, now), state);
  assert.equal(reconciledTrackingState({ state: 'active', updatedAt: now }, false, now), 'stopped');
});

test('collision mirror tombstone atomically rejects a late active projection', () => {
  const active = projectCollisionMirror(null, 'event', 'stop', 1, { stopPointId: 'stop', count: 2 })!;
  const cleared = projectCollisionMirror(active, 'event', 'stop', 3, null)!;
  assert.equal(cleared.event, undefined);
  assert.equal(projectCollisionMirror(cleared, 'event', 'stop', 2, { stopPointId: 'stop' }), undefined);
  assert.equal(projectCollisionMirror(cleared, 'event', 'stop', 3, { stopPointId: 'stop' }), undefined);
  const recurring = projectCollisionMirror(cleared, 'event', 'stop', 4, { stopPointId: 'stop', incidentId: 'new' })!;
  assert.equal(recurring.event.stop.incidentId, 'new');
  assert.equal(active.event.stop.count, 2, 'projection does not mutate the input snapshot');
});

const emulator = ['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
test('emulator: repeated/out-of-order GPS cannot create arrivals or regress progress', { skip: !emulator }, async () => {
  if (!getApps().length) initializeApp({ projectId: 'demo-temple-procession' });
  const db = getFirestore(), id = `gps-${randomUUID()}`, eventId = `${id}-event`, groupId = `${id}-group`, uid = `${id}-leader`, routeId = `${id}-route`;
  const start = `${id}-start`, end = `${id}-end`, current = Date.now();
  const batch = db.batch();
  batch.set(db.doc(`events/${eventId}`), { status: 'active' });
  batch.set(db.doc(`routes/${routeId}`), { eventId });
  batch.set(db.doc(`users/${uid}`), { role: 'teamLeader', isActive: true, assignedGroupId: groupId });
  batch.set(db.doc(`groups/${groupId}`), { eventId, routeId, leaderUserId: uid, status: 'moving', startingStopPointId: start, endingStopPointId: end });
  for (const [stopId, order, latitude] of [[start, 1, 12], [end, 2, 12.01]] as const) batch.set(db.doc(`stopPoints/${stopId}`), { routeId, order, latitude, longitude: 79, geofenceRadiusMeters: 100 });
  await batch.commit();
  const trigger = (recordedAt: number, latitude = 12) => ({ params: { eventId, groupId }, data: { after: { val: () => ({ ...sample, userId: uid, recordedAt, latitude }) } } });
  await detectStopArrival.run(trigger(current - 40000) as unknown as Parameters<typeof detectStopArrival.run>[0]);
  await detectStopArrival.run(trigger(current - 20000) as unknown as Parameters<typeof detectStopArrival.run>[0]);
  await Promise.all([
    detectStopArrival.run(trigger(current - 20000) as unknown as Parameters<typeof detectStopArrival.run>[0]),
    detectStopArrival.run(trigger(current - 30000, 12.01) as unknown as Parameters<typeof detectStopArrival.run>[0]),
  ]);
  const progress = (await db.doc(`groupProgress/${groupId}`).get()).data()!;
  assert.deepEqual(progress.completedStopIds, [start]);
  assert.equal(progress.completedCount, 1);
  assert.equal(progress.nextStopPointId, end);
  assert.equal((await db.collection('stopArrivals').where('eventId', '==', eventId).get()).size, 1);
  await updateRouteProgress.run(trigger(current - 10000) as unknown as Parameters<typeof updateRouteProgress.run>[0]);
  await updateRouteProgress.run(trigger(current - 30000, 12.01) as unknown as Parameters<typeof updateRouteProgress.run>[0]);
  assert.equal((await db.doc(`groupProgress/${groupId}`).get()).data()!.lastProgressSampleAt, current - 10000);
  await updateRouteProgress.run(trigger(current - 5000) as unknown as Parameters<typeof updateRouteProgress.run>[0]);
  const history = await db.collection('locationHistory').where('groupId', '==', groupId).get();
  assert.equal(history.size, 1, 'history is sampled, not saved on every upload');
  assert.equal(history.docs[0].data().recordedAt.toMillis(), current - 10000, 'preserve observation time');
  assert.equal(history.docs[0].data().userId, uid, 'account deletion can find precise samples');
  assert.equal((await db.doc(`groupProgress/${groupId}`).get()).data()!.lastHistorySampleAt, current - 10000);
  await db.doc(`users/${uid}`).update({ isActive: false });
  await updateRouteProgress.run(trigger(current) as unknown as Parameters<typeof updateRouteProgress.run>[0]);
  assert.equal((await db.doc(`groupProgress/${groupId}`).get()).data()!.lastProgressSampleAt, current - 5000);
  assert.equal((await db.collection('locationHistory').where('groupId', '==', groupId).get()).size, 1);
});
