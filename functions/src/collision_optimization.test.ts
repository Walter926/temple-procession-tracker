import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { deleteApp, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { FieldPath, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { projectCollisionEventMirror, mirrorCollisionAlert } from './collision_alert_mirror';
import { recountCollisions, detectGroupCollision, processCollisionReconciliation } from './collision_detection';

test('event-local mirror preserves tombstones and summary shape without mutating snapshots', () => {
  const summary = { stopPointId: 'stop', affectedGroupIds: ['a', 'b'], count: 2, sourceVersion: 1 };
  const active = projectCollisionEventMirror(null, 'stop', 1, summary)!;
  const resolved = projectCollisionEventMirror(active, 'stop', 3, null)!;
  assert.equal(resolved.stop, undefined);
  assert.equal(resolved._mirrorVersions.stop, 3);
  for (const revision of [1, 2, 3]) assert.equal(projectCollisionEventMirror(resolved, 'stop', revision, summary), undefined);
  const recurring = projectCollisionEventMirror(resolved, 'stop', 4, { ...summary, sourceVersion: 4 })!;
  assert.equal(recurring.stop.sourceVersion, 4);
  assert.equal(active.stop.sourceVersion, 1);
  assert.equal(active._mirrorVersions.stop, 1);
  // This is the existing dashboard's reader predicate: metadata is never a row.
  assert.equal(Object.values(recurring).filter(raw => raw && typeof raw === 'object' && 'stopPointId' in raw && Array.isArray(raw.affectedGroupIds)).length, 1);
});

test('event-local mirror honors legacy tombstones and existing source versions', () => {
  assert.equal(projectCollisionEventMirror(null, 'stop', 4, { stopPointId: 'stop' }, 5), undefined);
  assert.equal(projectCollisionEventMirror({ stop: { sourceVersion: 8 } }, 'stop', 7, null), undefined);
  assert.equal(projectCollisionEventMirror(null, 'stop', 6, { stopPointId: 'stop' }, 5)!.stop.stopPointId, 'stop');
});

test('one event or stop clock cannot fence another event or stop', () => {
  const a = projectCollisionEventMirror(null, 'stop', 100, null)!;
  const b = projectCollisionEventMirror(null, 'stop', 1, { stopPointId: 'stop' })!;
  assert.equal(b.stop.stopPointId, 'stop');
  assert.equal(projectCollisionEventMirror(a, 'other', 1, { stopPointId: 'other' })!.other.stopPointId, 'other');
});

const emulator = ['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '') &&
  ['127.0.0.1:9000', 'localhost:9000'].includes(process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '');
const databaseURL = 'http://127.0.0.1:9000?ns=demo-temple-procession-default-rtdb';
let ownedApp: App | undefined;
before(() => {
  if (!emulator) return;
  // Never initialize Admin against non-demo data or touch another suite's data.
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (process.env[key] && process.env[key] !== 'demo-temple-procession') throw Error(`Refusing non-demo ${key}.`);
  }
  process.env.RTDB_URL = databaseURL;
  if (!getApps().length) ownedApp = initializeApp({ projectId: 'demo-temple-procession', databaseURL });
});
after(async () => {
  if (ownedApp) { await getFirestore(ownedApp).terminate(); await deleteApp(ownedApp); }
});

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function fixture(stopCount = 1) {
  const id = `collision-opt-${randomUUID()}`, eventId = `${id}-event`, routeId = `${id}-route`, stopId = `${id}-stop-0`;
  const groupIds = [`${id}-a`, `${id}-b`], leaders = [`${id}-leader-a`, `${id}-leader-b`];
  const db = getFirestore(), database = getDatabaseWithUrl(databaseURL, getApp()), batch = db.batch();
  batch.set(db.doc(`events/${eventId}`), { status: 'active' });
  batch.set(db.doc(`routes/${routeId}`), { eventId });
  groupIds.forEach((groupId, i) => {
    batch.set(db.doc(`groups/${groupId}`), { eventId, routeId, leaderUserId: leaders[i], status: 'moving' });
    batch.set(db.doc(`users/${leaders[i]}`), { role: 'teamLeader', isActive: true, assignedGroupId: groupId });
  });
  for (let i = 0; i < stopCount; i++) batch.set(db.doc(`stopPoints/${id}-stop-${i}`), {
    eventId, routeId, order: i + 1, latitude: 49 + i * 0.002, longitude: -123, geofenceRadiusMeters: 50, maxAllowedGroups: 1,
  });
  await batch.commit();
  const positions = (crowded: boolean) => Object.fromEntries(groupIds.map((groupId, i) => [groupId, {
    userId: leaders[i], latitude: crowded ? 49 : 50, longitude: -123, accuracyMeters: 5, recordedAt: Date.now(),
  }]));
  const locate = (crowded: boolean) => database.ref(`liveLocations/${eventId}`).set(positions(crowded));
  await locate(true);
  return { eventId, routeId, stopId, groupIds, db, database, locate, alertRef: db.doc(`collisionAlerts/${eventId}_${stopId}`) };
}

test('emulator: 200 clean stops and resolved history produce zero per-stop transactions/reads', { skip: !emulator }, async t => {
  const f = await fixture(200);
  await f.locate(false);
  await f.db.doc(`collisionAlerts/${f.eventId}-history`).set({ eventId: f.eventId, stopPointId: 'removed', status: 'resolved' });
  const originalTransaction = f.db.runTransaction.bind(f.db), originalDoc = f.db.doc.bind(f.db);
  let transactions = 0;
  const alertPaths: string[] = [];
  t.mock.method(f.db, 'runTransaction', (...args: Parameters<typeof f.db.runTransaction>) => { transactions++; return originalTransaction(...args); });
  t.mock.method(f.db, 'doc', (path: string) => { if (path.startsWith('collisionAlerts/')) alertPaths.push(path); return originalDoc(path); });
  await recountCollisions(f.eventId);
  assert.equal(transactions, 2, 'one revision allocation plus one atomic sparse publication, independent of stop count');
  assert.deepEqual(alertPaths, [], 'neither clean stop documents nor resolved alert history are read individually');
  assert.equal((await f.db.collection('collisionAlerts').where('eventId', '==', f.eventId).get()).size, 1);
});

test('emulator: recurrence, suppression and removed-stop automatic resolution retain incident semantics', { skip: !emulator }, async () => {
  const f = await fixture();
  await recountCollisions(f.eventId);
  const first = (await f.alertRef.get()).data()!;
  await recountCollisions(f.eventId);
  assert.equal((await f.alertRef.get()).data()!.incidentId, first.incidentId);
  await f.alertRef.update({ status: 'suppressed' });
  await recountCollisions(f.eventId);
  assert.equal((await f.alertRef.get()).data()!.status, 'suppressed');
  await f.locate(false);
  await recountCollisions(f.eventId);
  assert.equal((await f.alertRef.get()).data()!.status, 'resolved');
  await f.locate(true);
  await recountCollisions(f.eventId);
  const next = (await f.alertRef.get()).data()!;
  assert.equal(next.incidentGeneration, 2);
  assert.notEqual(next.incidentId, first.incidentId);
  await f.db.doc(`groups/${f.groupIds[0]}`).update({ status: 'completed' });
  await recountCollisions(f.eventId);
  assert.equal((await f.alertRef.get()).data()!.status, 'resolved', 'routes with fewer than two eligible groups need no configuration to resolve');
});

test('emulator: simultaneous scans publish one generation and the latest successful revision', { skip: !emulator, timeout: 30000 }, async () => {
  const f = await fixture();
  await Promise.all(Array.from({ length: 5 }, () => recountCollisions(f.eventId)));
  const alert = (await f.alertRef.get()).data()!, scan = (await f.db.doc(`collisionScans/${f.eventId}`).get()).data()!;
  assert.equal(alert.incidentGeneration, 1);
  assert.equal(alert.scanRevision, 5);
  assert.equal(scan.completedRevision, 5);
  assert.equal((await f.db.collection('collisionAlerts').where('eventId', '==', f.eventId).get()).size, 1);
});

test('emulator: a GPS sample expiring during preparation cannot refresh a collision', { skip: !emulator, timeout: 30000 }, async t => {
  const f = await fixture();
  await recountCollisions(f.eventId);
  const recordedAt = Date.now() - 44000, positions = f.database.ref(`liveLocations/${f.eventId}`);
  await positions.update(Object.fromEntries(f.groupIds.map(id => [`${id}/recordedAt`, recordedAt])));
  const ready = deferred(), release = deferred(), original = f.db.getAll.bind(f.db);
  t.mock.method(f.db, 'getAll', async (...refs: Parameters<typeof f.db.getAll>) => {
    if (refs.some(ref => 'path' in ref && ref.path.startsWith('users/'))) { ready.release(); await release.promise; }
    return original(...refs);
  });
  const scan = recountCollisions(f.eventId);
  await ready.promise;
  try {
    await delay(Math.max(0, recordedAt + 45001 - Date.now()));
    release.release(); await scan;
    assert.equal((await f.alertRef.get()).data()!.status, 'resolved');
  } finally { release.release(); await Promise.allSettled([scan]); }
});

test('emulator: changed route versions abort stale planning without publishing partial incident state', { skip: !emulator }, async t => {
  const f = await fixture(), original = f.db.runTransaction.bind(f.db);
  let transactions = 0;
  t.mock.method(f.db, 'runTransaction', async (...args: Parameters<typeof f.db.runTransaction>) => {
    if (++transactions === 2) await f.db.doc(`routes/${f.routeId}`).update({ changedDuringScan: true });
    return original(...args);
  });
  await assert.rejects(recountCollisions(f.eventId), /Route configuration changed/);
  assert.equal((await f.alertRef.get()).exists, false);
  assert.equal((await f.db.doc(`collisionScans/${f.eventId}`).get()).data()!.completedRevision, undefined);
  await recountCollisions(f.eventId);
  assert.equal((await f.alertRef.get()).data()!.status, 'active');
});

test('emulator: newer clean scan resolves an incident published after the newer scan started', { skip: !emulator, timeout: 30000 }, async t => {
  const f = await fixture(), oldReady = deferred(), newReady = deferred(), releaseOld = deferred(), releaseNew = deferred();
  const original = f.db.getAll.bind(f.db);
  let reads = 0;
  t.mock.method(f.db, 'getAll', async (...refs: Parameters<typeof f.db.getAll>) => {
    if (refs.some(ref => 'path' in ref && ref.path.startsWith('users/'))) {
      if (++reads === 1) { oldReady.release(); await releaseOld.promise; }
      else if (reads === 2) { newReady.release(); await releaseNew.promise; }
    }
    return original(...refs);
  });
  const older = recountCollisions(f.eventId);
  await oldReady.promise;
  await f.locate(false);
  const newer = recountCollisions(f.eventId);
  await newReady.promise;
  try {
    releaseOld.release(); await older;
    assert.equal((await f.alertRef.get()).data()!.status, 'active');
    releaseNew.release(); await newer;
    const alert = (await f.alertRef.get()).data()!;
    assert.equal(alert.status, 'resolved');
    assert.equal(alert.scanRevision, 2);
  } finally { releaseOld.release(); releaseNew.release(); await Promise.allSettled([older, newer]); }
});

test('emulator: older crowded scan cannot resurrect after a newer successful clean scan', { skip: !emulator, timeout: 30000 }, async t => {
  const f = await fixture(), ready = deferred(), release = deferred(), original = f.db.getAll.bind(f.db);
  let held = false;
  t.mock.method(f.db, 'getAll', async (...refs: Parameters<typeof f.db.getAll>) => {
    if (!held && refs.some(ref => 'path' in ref && ref.path.startsWith('users/'))) { held = true; ready.release(); await release.promise; }
    return original(...refs);
  });
  const older = recountCollisions(f.eventId);
  await ready.promise;
  try {
    await f.locate(false); await recountCollisions(f.eventId);
    release.release(); await older;
    assert.equal((await f.alertRef.get()).exists, false);
    assert.equal((await f.db.doc(`collisionScans/${f.eventId}`).get()).data()!.completedRevision, 2);
  } finally { release.release(); await Promise.allSettled([older]); }
});

test('emulator: a failed newer scan does not fence an older fresh repair', { skip: !emulator, timeout: 30000 }, async t => {
  const f = await fixture(), ready = deferred(), release = deferred(), original = f.db.getAll.bind(f.db);
  let reads = 0;
  t.mock.method(f.db, 'getAll', async (...refs: Parameters<typeof f.db.getAll>) => {
    if (refs.some(ref => 'path' in ref && ref.path.startsWith('users/'))) {
      if (++reads === 1) { ready.release(); await release.promise; }
      else if (reads === 2) throw Error('Injected newer scan read failure');
    }
    return original(...refs);
  });
  const older = recountCollisions(f.eventId);
  await ready.promise;
  try {
    await assert.rejects(recountCollisions(f.eventId), /Injected/);
    release.release(); await older;
    assert.equal((await f.alertRef.get()).data()!.status, 'active');
    const scan = (await f.db.doc(`collisionScans/${f.eventId}`).get()).data()!;
    assert.equal(scan.revision, 2); assert.equal(scan.completedRevision, 1);
  } finally { release.release(); await Promise.allSettled([older]); }
});

test('emulator: trigger failure releases only its claim so immediate retry repairs', { skip: !emulator }, async t => {
  const f = await fixture(), original = f.db.getAll.bind(f.db);
  let fail = true;
  t.mock.method(f.db, 'getAll', async (...refs: Parameters<typeof f.db.getAll>) => {
    if (fail && refs.some(ref => 'path' in ref && ref.path.startsWith('users/'))) { fail = false; throw Error('Injected scan failure'); }
    return original(...refs);
  });
  const event = { params: { eventId: f.eventId, groupId: f.groupIds[0] } } as unknown as Parameters<typeof detectGroupCollision.run>[0];
  await assert.rejects(async () => { await detectGroupCollision.run(event); }, /Injected/);
  assert.equal((await f.db.doc(`collisionScanRequests/${f.eventId}`).get()).exists, false);
  await detectGroupCollision.run(event);
  assert.equal((await f.alertRef.get()).data()!.status, 'active');
});

test('emulator: actual mirror transactions are event-local and late writes cannot undo deletion', { skip: !emulator }, async t => {
  const a = await fixture(), b = await fixture();
  await Promise.all([recountCollisions(a.eventId), recountCollisions(b.eventId)]);
  const originalRef = a.database.ref.bind(a.database), paths: string[] = [];
  t.mock.method(a.database, 'ref', (path?: string) => {
    const ref = originalRef(path), originalTransaction = ref.transaction.bind(ref);
    t.mock.method(ref, 'transaction', (...args: Parameters<typeof ref.transaction>) => { paths.push(path ?? ''); return originalTransaction(...args); });
    return ref;
  });
  const mirror = (alertId: string) => mirrorCollisionAlert.run({ params: { alertId } } as unknown as Parameters<typeof mirrorCollisionAlert.run>[0]);
  await Promise.all([mirror(a.alertRef.id), mirror(b.alertRef.id)]);
  assert.deepEqual(new Set(paths), new Set([`activeCollisionAlerts/${a.eventId}`, `activeCollisionAlerts/${b.eventId}`]));
  const branch = a.database.ref(`activeCollisionAlerts/${a.eventId}`), old = (await branch.get()).val();
  await a.alertRef.delete(); await mirror(a.alertRef.id);
  await branch.transaction(value => projectCollisionEventMirror(value, a.stopId, old[a.stopId].sourceVersion, old[a.stopId]));
  const after = (await branch.get()).val();
  assert.equal(after[a.stopId], undefined);
  assert.equal(after._mirrorVersions[a.stopId], 2);
  assert.equal((await b.database.ref(`activeCollisionAlerts/${b.eventId}/${b.stopId}`).get()).val().count, 2);
});

test('emulator: bounded reconciliation rotates persistent cursors and retries poison events without blocking later pages', { skip: !emulator, timeout: 30000 }, async () => {
  const db = getFirestore(), name = `collision-worker-${randomUUID()}`, worker = db.doc(`maintenanceCursors/${name}`), queue = worker.collection('events');
  const ids = ['a', 'b', 'c', 'd', 'e'].map(suffix => `${name}-${suffix}`), orphan = `${name}-z`;
  const batch = db.batch();
  for (const id of ids) batch.set(db.doc(`events/${id}`), { status: 'active' });
  batch.set(db.doc(`collisionAlerts/${name}-alert`), { eventId: orphan, status: 'suppressed' });
  await batch.commit();
  const started = deferred(), release = deferred(), scanned: string[] = [];
  let running = 0, maximum = 0, poison = true;
  const sources = { workerName: name,
    events: db.collection('events').where(FieldPath.documentId(), 'in', ids),
    alerts: db.collection('collisionAlerts').where(FieldPath.documentId(), '==', `${name}-alert`),
    scan: async (id: string) => {
      if (id === ids[1]) await started.promise;
      running++; maximum = Math.max(maximum, running); scanned.push(id);
      try {
        if (id === ids[0] && poison) { started.release(); await release.promise; throw Error('Injected poison event'); }
      } finally { running--; }
    } };
  const budget = { maxPages: 3, pageSize: 2, concurrency: 2, maxRunMs: 10000 };
  const first = processCollisionReconciliation(budget, sources);
  await started.promise;
  try {
    // While a slow event owns one slot, a peer in the same bounded page runs.
    for (let i = 0; i < 100 && !scanned.includes(ids[1]); i++) await delay(10);
    assert.ok(scanned.includes(ids[1]));
  } finally { release.release(); await first; }
  assert.equal(maximum, 2);
  assert.equal(scanned.length, 2, 'bounded work page, not all discovered events');
  const state = (await worker.get()).data()!, retry = (await queue.doc(ids[0]).get()).data()!;
  assert.equal(state.eventId, ids[1]); assert.equal(state.workId, ids[1]); assert.equal(state.nextSource, 0);
  assert.equal(retry.attempts, 1); assert.match(retry.lastError, /Injected poison/);
  assert.ok(retry.nextAttemptAt.toMillis() > Date.now());
  assert.equal((await queue.doc(orphan).get()).exists, true, 'orphaned active/suppressed incidents have their own discovery source');
  await processCollisionReconciliation(budget, sources);
  assert.deepEqual(new Set(scanned.slice(2)), new Set([ids[2], ids[3]]), 'later events run despite a persistent failure before the cursor');
  assert.equal((await worker.get()).data()!.eventId, ids[3]);
  await processCollisionReconciliation(budget, sources);
  assert.ok(scanned.includes(ids[4])); assert.ok(scanned.includes(orphan));
  assert.equal((await worker.get()).data()!.eventId, '', 'discovery wraps at the end rather than pinning a finished cursor');
  // Make the persisted retry due without waiting for backoff, then start on the
  // retry source to verify rotation and successful removal of the failed job.
  poison = false;
  await queue.doc(ids[0]).update({ nextAttemptAt: Timestamp.fromMillis(0) });
  await worker.update({ nextSource: 2, workId: '' });
  await processCollisionReconciliation({ ...budget, maxPages: 1 }, sources);
  assert.equal((await queue.doc(ids[0]).get()).exists, false);
  assert.equal((await worker.get()).data()!.nextSource, 0);
  assert.equal((await worker.get()).data()!.lease, undefined);
});

test('emulator: reconciliation deadlines retain unstarted jobs after advancing the work cursor', { skip: !emulator, timeout: 30000 }, async () => {
  const db = getFirestore(), name = `collision-deadline-${randomUUID()}`, worker = db.doc(`maintenanceCursors/${name}`), queue = worker.collection('events');
  const ids = ['a', 'b', 'c'].map(id => `${name}-${id}`), batch = db.batch();
  batch.set(worker, { nextSource: 2 });
  for (const id of ids) batch.set(queue.doc(id), { eventId: id, attempts: 0, nextAttemptAt: Timestamp.fromMillis(0) });
  await batch.commit();
  const ready = deferred(), release = deferred(), scanned: string[] = [];
  const sources = { workerName: name,
    events: db.collection('events').where(FieldPath.documentId(), '==', name),
    alerts: db.collection('collisionAlerts').where(FieldPath.documentId(), '==', name),
    scan: async (id: string) => { scanned.push(id); ready.release(); await release.promise; } };
  const invocation = processCollisionReconciliation({ maxPages: 1, pageSize: 3, concurrency: 1, maxRunMs: 1000 }, sources);
  await ready.promise;
  try { await delay(1050); } finally { release.release(); await invocation; }
  assert.deepEqual(scanned, [ids[0]]);
  assert.equal((await worker.get()).data()!.workId, ids[2]);
  assert.equal((await queue.get()).size, 2, 'unstarted work survives the deadline');
  // Visit the exhausted suffix, wrap, then resume the retained jobs.
  await processCollisionReconciliation({ maxPages: 3, pageSize: 3 }, sources);
  await processCollisionReconciliation({ maxPages: 3, pageSize: 3 }, sources);
  assert.deepEqual(new Set(scanned), new Set(ids));
  assert.equal((await queue.get()).size, 0);
});

