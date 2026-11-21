import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import type { Message } from 'firebase-admin/messaging';
import { boundedWork, continueAnnouncementFanout, deliverNotification, digest, drainCursorQueue, fanoutContinuationRequested, processAnnouncementFanout, sendAnnouncement } from './notifications';

const emulator = ['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
const paths = new Set<string>();
let ownsApp = false;
function database() {
  if (!getApps().length) { initializeApp({ projectId: 'demo-temple-procession' }); ownsApp = true; }
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
  await db.terminate(); await deleteApp(getApps()[0]);
});

test('bounded work isolates failures and allows peers past a slow first item', async () => {
  let unblock!: () => void, active = 0, peak = 0;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const completed: number[] = [];
  const result = await boundedWork([0, 1, 2, 3, 4, 5], 3, async item => {
    active++; peak = Math.max(peak, active);
    try {
      if (item === 0) await blocked;
      if (item === 1) throw new Error('isolated-test-failure');
      if (item === 5) unblock();
      completed.push(item);
    } finally { active--; }
  });
  assert.deepEqual(result, { started: 6, failed: 1 });
  assert.ok(peak <= 3 && peak > 1);
  assert.ok(completed.indexOf(5) < completed.indexOf(0));
  assert.deepEqual(await boundedWork([1, 2], 2, async () => assert.fail(), Date.now() - 1), { started: 0, failed: 0 });
});

test('only explicit pending continuation generations wake fan-out, not leases/checkpoints/no-ops', () => {
  assert.equal(fanoutContinuationRequested({ continuationGeneration: 0 }, { state: 'pending', continuationGeneration: 1 }), true);
  for (const after of [
    { state: 'processing', continuationGeneration: 1, cursor: 'page-end' },
    { state: 'pending', continuationGeneration: 1, nextAttemptAt: Timestamp.now() },
    { state: 'completed', continuationGeneration: 2 },
    { state: 'pending' },
  ]) assert.equal(fanoutContinuationRequested({ continuationGeneration: 1 }, after), false);
});

async function fixture(count: number, groupAudience = false) {
  const prefix = `fanout-opt-${randomUUID()}`, eventId = `${prefix}-event`, groupId = `${prefix}-group`, owner = `${prefix}-owner`, leader = `${prefix}-leader`, backup = `${prefix}-backup`;
  const records: [string, DocumentData][] = [
    [`events/${eventId}`, { organizerId: owner, isPublic: false, status: 'active' }],
    [`groups/${groupId}`, { eventId, leaderUserId: leader, backupLeaderUserId: backup }],
    [`users/${owner}`, { role: 'organizer', isActive: true }],
    ...[leader, backup].map(uid => [`users/${uid}`, { role: 'teamLeader', assignedGroupId: groupId, isActive: true }] as [string, DocumentData]),
  ];
  const members: string[] = [];
  for (let index = 0; index < count; index++) {
    const uid = `${prefix}-member-${String(index).padStart(4, '0')}`;
    members.push(uid);
    records.push([`users/${uid}`, { role: 'teamMember', isActive: true }], [`memberships/${eventId}_${uid}`, { eventId, uid, groupId: groupAudience ? groupId : '' }]);
  }
  await seed(records);
  const result = await sendAnnouncement.run({ auth: { uid: owner }, data: { eventId, groupId: groupAudience ? groupId : '', audience: groupAudience ? 'group' : 'event', message: 'Bounded fan-out fixture', requestId: prefix } } as unknown as Parameters<typeof sendAnnouncement.run>[0]);
  paths.add(`announcements/${result.id}`); paths.add(`notificationFanouts/${result.id}`); paths.add(`operationLimits/announcement_${owner}`);
  for (const uid of [...members, leader, backup]) {
    const id = digest('announcement', result.id, uid);
    paths.add(`notifications/${id}`); paths.add(`notificationDeliveries/${id}`);
  }
  return { prefix, eventId, groupId, owner, leader, backup, members, id: result.id };
}

test('emulator: one invocation drains 1,005 members plus leaders; concurrent and repeated invocations are idempotent', { skip: !emulator, timeout: 120000 }, async () => {
  const f = await fixture(1005), db = database();
  await Promise.all([processAnnouncementFanout(f.id), processAnnouncementFanout(f.id)]);
  assert.equal((await db.doc(`notificationFanouts/${f.id}`).get()).data()!.state, 'completed');
  let notices = await db.collection('notifications').where('eventId', '==', f.eventId).get();
  assert.equal(notices.size, 1007);
  assert.ok(notices.docs.some(doc => doc.data().uid === f.backup));
  await processAnnouncementFanout(f.id); await processAnnouncementFanout(f.id);
  notices = await db.collection('notifications').where('eventId', '==', f.eventId).get();
  assert.equal(notices.size, 1007);
});

test('emulator: bounded continuation trigger resumes immediately, fences a live lease, and rechecks revoked members', { skip: !emulator, timeout: 60000 }, async () => {
  const f = await fixture(105, true), db = database(), ref = db.doc(`notificationFanouts/${f.id}`), before = await ref.get();
  await processAnnouncementFanout(f.id, { maxPages: 1 });
  const boundary = await ref.get();
  assert.equal(boundary.data()!.state, 'pending');
  assert.equal(boundary.data()!.stage, 'members');
  assert.equal(boundary.data()!.continuationGeneration, 1);
  assert.equal((await db.doc(`notifications/${digest('announcement', f.id, f.leader)}`).get()).exists, true, 'leaders are reached before member pages');
  await ref.update({ state: 'processing', lease: 'test-live-lease', leaseUntil: Timestamp.fromMillis(Date.now() + 60000) });
  await processAnnouncementFanout(f.id);
  assert.equal((await ref.get()).data()!.lease, 'test-live-lease');
  await ref.update({ state: 'pending', leaseUntil: Timestamp.fromMillis(Date.now() - 1) });
  await db.doc(`memberships/${f.eventId}_${f.members[0]}`).update({ isActive: false, status: 'revoked' });
  const unrelated = `${f.prefix}-unrelated`;
  await seed([[`users/${unrelated}`, { isActive: true, role: 'teamMember', joinedEventId: f.eventId, joinedGroupId: f.groupId }],
    [`memberships/${f.eventId}_${unrelated}`, { eventId: f.eventId, groupId: `${f.groupId}-other`, uid: unrelated }]]);
  await continueAnnouncementFanout.run({ params: { fanoutId: f.id }, data: { before, after: boundary } } as unknown as Parameters<typeof continueAnnouncementFanout.run>[0]);
  assert.equal((await ref.get()).data()!.state, 'completed');
  const notices = await db.collection('notifications').where('eventId', '==', f.eventId).get();
  assert.equal(notices.size, 106);
  assert.equal(notices.docs.some(doc => doc.data().uid === f.members[0] || doc.data().uid === unrelated), false);
});

test('emulator: due cursor resumes beyond failures with a bounded page and wraps for retries', { skip: !emulator }, async () => {
  const db = database(), prefix = `queue-opt-${randomUUID()}`, collection = `optimizationQueue_${prefix}`, name = `queue_${prefix}`;
  const due = Timestamp.fromMillis(Date.now() - 60000);
  await seed(Array.from({ length: 7 }, (_, index) => [`${collection}/${index}`, { due }] as [string, DocumentData]));
  paths.add(`maintenanceCursors/${name}`);
  const seen: string[] = [];
  const visit = async (doc: { id: string }) => { seen.push(doc.id); if (doc.id === '0') throw new Error('test-poison'); };
  const query = db.collection(collection).where('due', '<=', Timestamp.now());
  await drainCursorQueue(name, query, visit, { maxPages: 1, pageSize: 3, concurrency: 2 }, 'due');
  assert.equal((await db.doc(`maintenanceCursors/${name}`).get()).data()!.id, '2');
  await drainCursorQueue(name, query, visit, { maxPages: 2, pageSize: 3, concurrency: 2 }, 'due');
  assert.deepEqual(seen, ['0', '1', '2', '3', '4', '5', '6']);
  assert.equal((await db.doc(`maintenanceCursors/${name}`).get()).data()!.id, undefined);
  await drainCursorQueue(name, query, visit, { maxPages: 1, pageSize: 1 }, 'due');
  assert.equal(seen[seen.length - 1], '0');
});

test('emulator: device concurrency is bounded and retries preserve successful-device checkpoints', { skip: !emulator, timeout: 60000 }, async t => {
  const f = await fixture(0), db = database();
  await processAnnouncementFanout(f.id);
  const id = digest('announcement', f.id, f.leader), deliveryRef = db.doc(`notificationDeliveries/${id}`), calls = new Map<string, number>();
  const records: [string, DocumentData][] = [];
  for (let index = 0; index < 8; index++) {
    const deviceId = `${f.prefix}-device-${index}`, token = `${deviceId}-token`, tokenId = digest(token);
    records.push([`deviceTokens/${tokenId}`, { uid: f.leader, deviceId, token, updatedAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 86400000) }],
      [`deviceTokenOwners/${digest(deviceId)}`, { uid: f.leader, tokenId }]);
  }
  await seed(records);
  let active = 0, peak = 0;
  t.mock.method(getMessaging(), 'send', async (message: Message) => {
    const token = 'token' in message ? message.token : '', count = (calls.get(token) ?? 0) + 1;
    calls.set(token, count); active++; peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (token.endsWith('device-0-token') && count === 1) throw Object.assign(new Error('transient'), { code: 'messaging/server-unavailable' });
      return 'emulator-message';
    } finally { active--; }
  });
  await Promise.all([deliverNotification(id), deliverNotification(id)]);
  const retry = (await deliveryRef.get()).data()!;
  assert.equal(retry.state, 'retry');
  assert.equal(retry.deliveredTokenIds.length, 7);
  assert.ok(peak <= 3 && peak > 1);
  await deliveryRef.update({ nextAttemptAt: Timestamp.fromMillis(Date.now() - 1) });
  await deliverNotification(id);
  assert.equal((await deliveryRef.get()).data()!.state, 'delivered');
  assert.equal([...calls.values()].reduce((sum, count) => sum + count, 0), 9);
});
