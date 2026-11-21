import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { cleanupLiveLocations, cleanupRetainedRecords, processOperationalMessages, retentionPolicies } from './maintenance';

const emulator = ['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
const liveEmulator = emulator && ['127.0.0.1:9000', 'localhost:9000'].includes(process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '');
const databaseURL = 'http://127.0.0.1:9000?ns=demo-temple-procession-default-rtdb';
if (liveEmulator) process.env.RTDB_URL = databaseURL;
const day = 86400000, paths = new Set<string>(), liveEvents = new Set<string>();
let ownsApp = false;
function database() {
  if (!getApps().length) { initializeApp({ projectId: 'demo-temple-procession', databaseURL }); ownsApp = true; }
  return getFirestore();
}
async function seed(records: [string, DocumentData][]) {
  const db = database();
  for (let offset = 0; offset < records.length; offset += 400) {
    const batch = db.batch();
    for (const [path, value] of records.slice(offset, offset + 400)) { paths.add(path); batch.set(db.doc(path), value); }
    await batch.commit();
  }
}
after(async () => {
  if (!ownsApp) return;
  const db = database(), owned = [...paths];
  for (let offset = 0; offset < owned.length; offset += 400) {
    const batch = db.batch();
    for (const path of owned.slice(offset, offset + 400)) batch.delete(db.doc(path));
    await batch.commit();
  }
  if (liveEmulator) for (const id of liveEvents) {
    await getDatabaseWithUrl(databaseURL).ref(`liveLocations/${id}`).remove();
    await db.doc(`liveLocationRetentionEvents/${id}`).delete();
  }
  await db.terminate(); await deleteApp(getApps()[0]);
});

test('emulator: history drains beyond 4,000 per pass, checkpoints ties, serves other collections and resumes the backlog', { skip: !emulator, timeout: 120000 }, async () => {
  const db = database(), prefix = `retention-opt-${randomUUID()}`, now = Date.now(), expired = Timestamp.fromMillis(now - 8 * day);
  const records: [string, DocumentData][] = [];
  for (let index = 0; index < 5205; index++) records.push([`locationHistory/${prefix}-${String(index).padStart(5, '0')}`, { eventId: prefix, recordedAt: expired }]);
  for (let index = 0; index < 501; index++) records.push([`deviceTokens/${prefix}-${index}`, { fixtureId: prefix, expiresAt: Timestamp.fromMillis(now - 1) }]);
  records.push([`locationHistory/${prefix}-recent`, { eventId: prefix, recordedAt: Timestamp.fromMillis(now - 6 * day) }],
    [`collisionAlerts/${prefix}-active`, { status: 'active', resolvedAt: Timestamp.fromMillis(now - 40 * day) }],
    [`collisionAlerts/${prefix}-resolved`, { status: 'resolved', resolvedAt: Timestamp.fromMillis(now - 40 * day) }]);
  await seed(records);
  const count = async () => (await db.collection('locationHistory').where('eventId', '==', prefix).count().get()).data().count - 1;
  await cleanupRetainedRecords(now, { maxRunMs: 90000 });
  const remaining = await count();
  assert.ok(5205 - remaining > 4000, `Expected >4,000 removals, remaining=${remaining}`);
  assert.ok(remaining > 0, 'A bounded history budget must leave a resumable checkpoint');
  assert.equal((await db.collection('deviceTokens').where('fixtureId', '==', prefix).count().get()).data().count, 0, 'A large history queue cannot starve token cleanup');
  const historyMetrics = (await db.doc('maintenanceCursors/retention_locationHistory').get()).data()!;
  assert.equal(historyMetrics.hasMore, true);
  assert.ok(historyMetrics.value instanceof Timestamp);
  assert.ok(historyMetrics.oldestExpiredAt instanceof Timestamp);
  assert.ok(historyMetrics.oldestBacklogAgeMs >= day);
  assert.ok(historyMetrics.removed > 4000);
  assert.equal((await db.doc(`collisionAlerts/${prefix}-active`).get()).exists, true);
  assert.equal((await db.doc(`collisionAlerts/${prefix}-resolved`).get()).exists, false);
  await cleanupRetainedRecords(now, { maxRunMs: 90000 });
  assert.equal(await count(), 0);
  assert.equal((await db.doc(`locationHistory/${prefix}-recent`).get()).exists, true);
  const complete = (await db.doc('maintenanceCursors/retention_locationHistory').get()).data()!;
  assert.equal(complete.hasMore, false);
  assert.equal(complete.oldestExpiredAt, null);
  assert.equal(complete.oldestBacklogAgeMs, 0);
  assert.equal(complete.id, undefined);
});

test('emulator: tiny global retention boundary rotates fairly and leases prevent overlapping runs', { skip: !emulator, timeout: 60000 }, async () => {
  const db = database(), prefix = `fair-retention-opt-${randomUUID()}`, now = Date.now();
  await seed([[`locationHistory/${prefix}`, { recordedAt: Timestamp.fromMillis(now - 8 * day) }],
    [`deviceTokens/${prefix}`, { expiresAt: Timestamp.fromMillis(now - 1) }]]);
  const ref = db.doc('maintenanceCursors/retention'), initial = (await ref.get()).data()!;
  // Expire the injected lease immediately after asserting the fence; never clear shared cursors.
  await ref.set({ lease: prefix, leaseUntil: Timestamp.fromMillis(Date.now() + 10000) }, { merge: true });
  assert.equal(await cleanupRetainedRecords(now), 0);
  assert.equal((await db.doc(`locationHistory/${prefix}`).get()).exists, true);
  await ref.update({ leaseUntil: Timestamp.fromMillis(Date.now() - 1) });
  const visited = new Set<number>();
  for (let turn = 0; turn < retentionPolicies.length; turn++) {
    await cleanupRetainedRecords(now, { maxPages: 1, pageSize: 20 });
    visited.add(Number((await ref.get()).data()!.nextPolicy));
  }
  assert.equal(visited.size, retentionPolicies.length);
  assert.equal((await db.doc(`locationHistory/${prefix}`).get()).exists, false);
  assert.equal((await db.doc(`deviceTokens/${prefix}`).get()).exists, false);
  assert.equal((await ref.get()).data()!.nextPolicy, initial.nextPolicy);
});

test('emulator: lifecycle queues each get a bounded page and independently resume', { skip: !emulator, timeout: 60000 }, async () => {
  const db = database(), prefix = `lifecycle-opt-${randomUUID()}`, due = Timestamp.fromMillis(Date.now() - 100 * day);
  for (const collection of ['announcements', 'publicAnnouncements']) {
    await seed(Array.from({ length: 5 }, (_, index) => [`${collection}/${prefix}-${index}`, { state: 'active', isActive: true, fixtureId: prefix, lifecycleDueAt: due }] as [string, DocumentData]));
  }
  await processOperationalMessages(Date.now(), { maxPages: 1, pageSize: 2 });
  for (const collection of ['announcements', 'publicAnnouncements']) {
    const docs = await db.collection(collection).where('fixtureId', '==', prefix).get();
    assert.equal(docs.docs.filter(doc => doc.data().state === 'expired').length, 2);
    assert.ok((await db.doc(`maintenanceCursors/lifecycle_${collection}`).get()).data()!.id);
  }
  await processOperationalMessages(Date.now(), { maxPages: 4, pageSize: 2 });
  for (const collection of ['announcements', 'publicAnnouncements']) {
    const docs = await db.collection(collection).where('fixtureId', '==', prefix).get();
    assert.equal(docs.docs.filter(doc => doc.data().state === 'expired').length, 5);
    assert.equal((await db.doc(`maintenanceCursors/lifecycle_${collection}`).get()).data()!.id, undefined);
  }
});

test('emulator: RTDB orphan retention pages within events, resumes, reports backlog and preserves fresh samples', { skip: !liveEmulator, timeout: 60000 }, async () => {
  const db = database(), eventId = `live-retention-opt-${randomUUID()}`, now = Date.now(), samples: DocumentData = {};
  liveEvents.add(eventId);
  for (let index = 0; index < 503; index++) samples[`group-${String(index).padStart(4, '0')}`] = { recordedAt: now - 8 * day, latitude: 12 };
  samples.recent = { recordedAt: now, latitude: 12 };
  const ref = getDatabaseWithUrl(databaseURL).ref(`liveLocations/${eventId}`);
  await ref.set(samples);
  await cleanupLiveLocations(now, { groupPageSize: 50, groupPages: 2 });
  assert.equal((await ref.get()).numChildren(), 404);
  const metrics = (await db.doc(`liveLocationRetentionEvents/${eventId}`).get()).data()!;
  assert.ok(metrics.groupId);
  assert.equal(metrics.hasMore, true);
  assert.ok(metrics.oldestBacklogAgeMs >= day);
  await cleanupLiveLocations(now, { discover: false, groupPageSize: 50, groupPages: 20 });
  assert.equal((await ref.get()).numChildren(), 1);
  assert.equal((await ref.child('recent').get()).exists(), true);
  const finished = (await db.doc(`liveLocationRetentionEvents/${eventId}`).get()).data()!;
  assert.equal(finished.hasMore, false);
  assert.equal(finished.groupId, undefined);
  assert.equal(finished.oldestBacklogAgeMs, 0);
});
