import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Shared-emulator fixtures only: never clear databases, upload rules, use Auth,
// start emulators, invoke deployed functions or contact a production endpoint.
const projectId = 'demo-temple-procession';
for (const [name, port] of [['FIRESTORE_EMULATOR_HOST', 8080], ['FIREBASE_DATABASE_EMULATOR_HOST', 9000]]) {
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(process.env[name])) {
    throw new Error(`Deletion/leader regressions require local ${name} on port ${port}.`);
  }
}
for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
  if (process.env[name] && process.env[name] !== projectId) throw new Error(`Refusing non-demo ${name}.`);
  process.env[name] = projectId;
}
const databaseURL = 'http://localhost:9000?ns=demo-temple-procession-default-rtdb';
if (process.env.RTDB_URL) {
  const configured = new URL(process.env.RTDB_URL);
  if (configured.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(configured.hostname)
    || configured.port !== '9000' || configured.searchParams.get('ns') !== `${projectId}-default-rtdb`) {
    throw new Error('Refusing a nonlocal or non-demo RTDB_URL.');
  }
}
process.env.RTDB_URL = databaseURL;
const require = createRequire(import.meta.url);
let app, db, rtdb, accounts, events;
before(() => {
  app = initializeApp({ projectId, databaseURL });
  db = getFirestore(app);
  rtdb = getDatabaseWithUrl(databaseURL, app);
  accounts = require('../lib/account_management.js');
  events = require('../lib/event_management.js');
});
after(async () => {
  if (db) await db.terminate();
  if (app) await deleteApp(app);
});
const call = (handler, uid, data = {}) => handler.run({ data, auth: uid ? { uid, token: { sub: uid } } : undefined, rawRequest: {} });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const read = async path => (await db.doc(path).get()).data();
const live = async path => (await rtdb.ref(path).get()).val();
const memberPath = (eventId, uid) => `memberships/${eventId}_${uid}`;
const assign = (f, leaderUserId, backupLeaderUserId, uid = f.owner) => call(accounts.assignGroupLeader, uid, { groupId: f.group, leaderUserId, backupLeaderUserId });
const remove = (f, resource, uid = f.owner) => resource === 'group'
  ? call(events.deleteGroup, uid, { eventId: f.event, groupId: f.group })
  : call(events.deleteEvent, uid, { eventId: f.event });
const snapshot = async paths => Object.fromEntries((await db.getAll(...paths.map(path => db.doc(path)))).map(doc => [doc.ref.path, doc.data()]));
const liveSnapshot = async paths => Object.fromEntries(await Promise.all(paths.map(async path => [path, await live(path)])));
const audits = async f => (await db.collection('auditRecords').where('eventId', '==', f.event).get()).docs.map(doc => [doc.id, doc.data()]);

async function fixture(status = 'completed') {
  const f = Object.fromEntries(['admin', 'owner', 'other', 'leader', 'backup', 'replacement', 'member', 'second', 'eventOnly',
    'foreignLeader', 'foreignBackup', 'foreignMember', 'event', 'foreignEvent', 'group', 'foreignGroup', 'route', 'foreignRoute',
    'history', 'foreignHistory', 'groupCode', 'eventCode', 'foreignCode'].map(name => [name, randomUUID()]));
  const createdAt = Timestamp.fromMillis(1700000000123), statusUpdatedAt = Timestamp.fromMillis(1700000000456);
  const records = {};
  for (const [key, role] of [['admin', 'admin'], ['owner', 'organizer'], ['other', 'organizer'], ['leader', 'teamLeader'],
    ['backup', 'teamLeader'], ['replacement', 'teamLeader'], ['member', 'teamMember'], ['second', 'teamMember'],
    ['eventOnly', 'teamMember'], ['foreignLeader', 'teamLeader'], ['foreignBackup', 'teamLeader'], ['foreignMember', 'teamMember']]) {
    records[`users/${f[key]}`] = { role, isActive: true, displayName: `Regression ${key}`, assignedGroupId: '', joinedEventId: '', joinedGroupId: '', createdAt };
  }
  for (const key of ['leader', 'backup']) records[`users/${f[key]}`].assignedGroupId = f.group;
  for (const key of ['foreignLeader', 'foreignBackup']) records[`users/${f[key]}`].assignedGroupId = f.foreignGroup;
  Object.assign(records[`users/${f.member}`], { joinedEventId: f.event, joinedGroupId: f.group });
  Object.assign(records[`users/${f.second}`], { joinedEventId: f.foreignEvent, joinedGroupId: f.foreignGroup });
  Object.assign(records[`users/${f.eventOnly}`], { joinedEventId: f.event });
  Object.assign(records[`users/${f.foreignMember}`], { joinedEventId: f.foreignEvent, joinedGroupId: f.foreignGroup });
  for (const [eventId, organizerId, routeId, eventStatus] of [[f.event, f.owner, f.route, status], [f.foreignEvent, f.other, f.foreignRoute, 'active']]) {
    records[`events/${eventId}`] = { organizerId, routeId, name: 'Regression procession', mainTempleName: 'Temple', cityRegion: 'Test city', description: 'Historical event', status: eventStatus, isPublic: false, startTime: createdAt, endTime: null, createdAt };
    records[`routes/${routeId}`] = { eventId, name: 'Historical route', createdAt };
  }
  for (const [groupId, eventId, routeId, leaderUserId, backupLeaderUserId] of [
    [f.group, f.event, f.route, f.leader, f.backup], [f.foreignGroup, f.foreignEvent, f.foreignRoute, f.foreignLeader, f.foreignBackup],
  ]) {
    records[`groups/${groupId}`] = { eventId, routeId, leaderUserId, backupLeaderUserId, name: 'Historical group', status: 'arrived', statusUpdatedAt, memberCount: groupId === f.group ? 2 : 3, currentLatitude: 49, currentLongitude: -123, createdAt };
  }
  for (const [eventId, uid, groupId] of [[f.event, f.member, f.group], [f.event, f.second, f.group], [f.event, f.eventOnly, ''],
    [f.foreignEvent, f.member, f.foreignGroup], [f.foreignEvent, f.second, f.foreignGroup], [f.foreignEvent, f.foreignMember, f.foreignGroup]]) {
    records[memberPath(eventId, uid)] = { eventId, uid, groupId, membershipRole: 'teamMember', joinedAt: createdAt, updatedAt: createdAt };
  }
  for (const [id, eventId, groupId] of [[f.history, f.event, f.group], [f.foreignHistory, f.foreignEvent, f.foreignGroup]]) {
    records[`locationHistory/${id}`] = { eventId, groupId, recordedAt: createdAt, latitude: 49, longitude: -123 };
  }
  for (const [id, eventId, groupId] of [[f.groupCode, f.event, f.group], [f.eventCode, f.event, ''], [f.foreignCode, f.foreignEvent, f.foreignGroup]]) {
    records[`accessCodes/${id}`] = { eventId, groupId, scope: groupId ? 'group' : 'event', enabled: true, usedCount: 2, createdAt };
  }
  records[`groupProgress/${f.group}`] = { eventId: f.event, lastStopIndex: 3, updatedAt: createdAt };
  records[`stopPresence/${f.group}`] = { eventId: f.event, arrivedAt: createdAt };
  const batch = db.batch();
  for (const [path, data] of Object.entries(records)) batch.create(db.doc(path), data);
  await batch.commit();
  const mirrors = {};
  for (const [path, data] of Object.entries(records)) {
    const [collection, id] = path.split('/');
    if (collection === 'users') mirrors[`accountStates/${id}`] = { isActive: data.isActive, role: data.role, assignedGroupId: data.assignedGroupId, revision: 0 };
    if (collection === 'groups') mirrors[`trackingAssignments/${id}`] = { eventId: data.eventId, leaderUserId: data.leaderUserId, backupLeaderUserId: data.backupLeaderUserId, revision: 0 };
    if (collection === 'events') mirrors[`eventStates/${id}`] = { status: data.status, organizerId: data.organizerId, isPublic: false, revision: 0 };
  }
  for (const [eventId, uids] of [[f.event, [f.leader, f.backup, f.member, f.second, f.eventOnly]],
    [f.foreignEvent, [f.foreignLeader, f.foreignBackup, f.member, f.second, f.foreignMember]]]) {
    for (const uid of uids) mirrors[`eventAccess/${eventId}/${uid}`] = { allowed: true, revision: 0 };
  }
  await Promise.all(Object.entries(mirrors).map(([path, value]) => rtdb.ref(path).set(value)));
  f.paths = Object.keys(records);
  f.mirrorPaths = Object.keys(mirrors);
  f.foreignPaths = [f.foreignEvent, f.foreignGroup, f.foreignRoute, f.foreignHistory, f.foreignCode, f.foreignLeader, f.foreignBackup, f.foreignMember]
    .flatMap(id => f.paths.filter(path => path.endsWith(`/${id}`)));
  f.foreignPaths.push(...[f.member, f.second, f.foreignMember].map(uid => memberPath(f.foreignEvent, uid)));
  f.foreignMirrors = f.mirrorPaths.filter(path => path.includes(f.foreignEvent) || path.includes(f.foreignGroup)
    || [f.foreignLeader, f.foreignBackup, f.foreignMember].some(uid => path.endsWith(`/${uid}`)));
  return f;
}

async function assertAssignment(f, primary, backup) {
  const group = await read(`groups/${f.group}`), mirrored = await live(`trackingAssignments/${f.group}`);
  assert.equal(group.leaderUserId, primary);
  assert.equal(group.backupLeaderUserId, backup);
  assert.equal(mirrored.eventId, f.event);
  assert.equal(mirrored.leaderUserId, primary);
  assert.equal(mirrored.backupLeaderUserId, backup);
}
async function assertReleased(f, uid) {
  assert.equal((await read(`users/${uid}`)).assignedGroupId, '');
  assert.equal((await live(`accountStates/${uid}`)).assignedGroupId, '');
  assert.equal((await live(`eventAccess/${f.event}/${uid}`)).allowed, false);
}

for (const status of ['completed', 'cancelled', 'archived']) {
  test(`${status}: retain same slots, release primary without promoting backup, then release both without rewriting history`, async () => {
    const f = await fixture(status), original = await snapshot(f.paths);
    await assign(f, f.leader, f.backup);
    await assertAssignment(f, f.leader, f.backup);
    await assign(f, '', f.backup);
    await assertAssignment(f, '', f.backup);
    await assertReleased(f, f.leader);
    assert.equal((await read(`users/${f.backup}`)).assignedGroupId, f.group);
    await assign(f, '', '', f.admin);
    await assertAssignment(f, '', '');
    await assertReleased(f, f.backup);
    const group = await read(`groups/${f.group}`);
    assert.deepEqual(group, { ...original[`groups/${f.group}`], leaderUserId: '', backupLeaderUserId: '' });
    const untouched = f.paths.filter(path => ![`groups/${f.group}`, `users/${f.leader}`, `users/${f.backup}`].includes(path));
    assert.deepEqual(await snapshot(untouched), Object.fromEntries(untouched.map(path => [path, original[path]])));
    assert.equal((await audits(f)).length, 3);
  });

  test(`${status}: reject new primary/backup, backup promotion and slot swapping atomically`, async () => {
    const f = await fixture(status), original = await snapshot(f.paths), originalMirrors = await liveSnapshot(f.mirrorPaths);
    for (const [primary, backup] of [[f.replacement, f.backup], [f.leader, f.replacement], [f.backup, ''], ['', f.leader], [f.backup, f.leader]]) {
      await rejects(assign(f, primary, backup), 'failed-precondition');
    }
    assert.deepEqual(await snapshot(f.paths), original);
    assert.deepEqual(await liveSnapshot(f.mirrorPaths), originalMirrors);
    assert.equal((await audits(f)).length, 0);
  });
}

test('closed release still requires authentication, an active admin or the owning active organizer', async () => {
  const f = await fixture(), original = await snapshot(f.paths), originalMirrors = await liveSnapshot(f.mirrorPaths);
  await rejects(call(accounts.assignGroupLeader, undefined, { groupId: f.group, leaderUserId: '', backupLeaderUserId: '' }), 'unauthenticated');
  for (const uid of [f.other, f.member, f.leader, f.backup, randomUUID()]) await rejects(assign(f, '', '', uid), 'permission-denied');
  assert.deepEqual(await snapshot(f.paths), original);
  for (const uid of [f.owner, f.admin]) {
    await db.doc(`users/${uid}`).update({ isActive: false });
    await rejects(assign(f, '', '', uid), 'permission-denied');
  }
  assert.deepEqual(await read(`groups/${f.group}`), original[`groups/${f.group}`]);
  assert.deepEqual(await liveSnapshot(f.mirrorPaths), originalMirrors);
  assert.equal((await audits(f)).length, 0);
});

test('closed release rejects a group already being deleted', async () => {
  const f = await fixture();
  await db.doc(`groups/${f.group}`).update({ deleting: true });
  const original = await snapshot(f.paths);
  await rejects(assign(f, '', ''), 'failed-precondition');
  assert.deepEqual(await snapshot(f.paths), original);
  assert.equal((await audits(f)).length, 0);
});

for (const missing of ['leader', 'backup']) {
  test(`closed release tolerates a missing ${missing} profile and an inactive other leader`, async () => {
    const f = await fixture('archived'), inactive = missing === 'leader' ? 'backup' : 'leader';
    await db.doc(`users/${f[missing]}`).delete();
    await db.doc(`users/${f[inactive]}`).update({ isActive: false, deleting: true });
    const group = await read(`groups/${f.group}`);
    await assign(f, f.leader, f.backup);
    await assign(f, '', '');
    await assertAssignment(f, '', '');
    assert.equal(await read(`users/${f[missing]}`), undefined, 'release never recreates missing profiles');
    await assertReleased(f, f[inactive]);
    assert.equal((await live(`accountStates/${f[missing]}`)).isActive, false);
    assert.equal((await live(`eventAccess/${f.event}/${f[missing]}`)).allowed, false);
    assert.deepEqual(await read(`groups/${f.group}`), { ...group, leaderUserId: '', backupLeaderUserId: '' });
  });
}

test('closed backup-only release retains the primary and never clears a pointer to another group', async () => {
  const f = await fixture('cancelled');
  await db.doc(`users/${f.leader}`).update({ assignedGroupId: f.foreignGroup });
  const user = await read(`users/${f.leader}`), foreign = await snapshot(f.foreignPaths);
  await assign(f, f.leader, '');
  await assertAssignment(f, f.leader, '');
  await assertReleased(f, f.backup);
  assert.deepEqual(await read(`users/${f.leader}`), user, 'same-slot retention must not steal a different assignment');
  await assign(f, '', '');
  assert.deepEqual(await read(`users/${f.leader}`), user, 'release must not clear a different assignment');
  assert.equal((await live(`accountStates/${f.leader}`)).assignedGroupId, f.foreignGroup);
  assert.deepEqual(await snapshot(f.foreignPaths), foreign);
});

for (const resource of ['group', 'event']) {
  test(`${resource} deletion frees both leaders, updates mirrors and preserves other-event scopes`, async () => {
    const f = await fixture(), foreign = await snapshot(f.foreignPaths), foreignMirrors = await liveSnapshot(f.foreignMirrors);
    const member = await read(memberPath(f.event, f.member)), second = await read(`users/${f.second}`);
    await remove(f, resource);
    assert.equal(await read(`groups/${f.group}`), undefined);
    await assertReleased(f, f.leader);
    await assertReleased(f, f.backup);
    const assignment = await live(`trackingAssignments/${f.group}`);
    assert.equal(assignment.eventId, '');
    assert.equal(assignment.leaderUserId, '');
    assert.equal(assignment.backupLeaderUserId, '');
    assert.equal(await read(`accessCodes/${f.groupCode}`), undefined);
    assert.equal(await read(`groupProgress/${f.group}`), undefined);
    assert.equal(await read(`stopPresence/${f.group}`), undefined);
    assert.deepEqual(await read(`users/${f.second}`), second, 'another active event selection is not cleared');
    for (const uid of [f.member, f.second, f.eventOnly]) {
      assert.equal((await live(`eventAccess/${f.event}/${uid}`)).allowed, resource === 'group');
      const membership = await read(memberPath(f.event, uid));
      if (resource === 'event') assert.equal(membership, undefined);
      else {
        assert.equal(membership.groupId, '');
        assert.equal(membership.eventId, f.event);
        assert.ok(membership.joinedAt.isEqual(member.joinedAt));
        assert.equal(membership.membershipRole, 'teamMember');
      }
    }
    if (resource === 'group') {
      assert.equal((await read(`events/${f.event}`)).status, 'completed');
      assert.equal((await read(`users/${f.member}`)).joinedEventId, f.event);
      assert.equal((await read(`users/${f.member}`)).joinedGroupId, '');
      assert.ok(await read(`accessCodes/${f.eventCode}`));
      assert.ok(await read(`locationHistory/${f.history}`));
    } else {
      for (const path of [`events/${f.event}`, `routes/${f.route}`, `accessCodes/${f.eventCode}`, `locationHistory/${f.history}`]) assert.equal(await read(path), undefined);
      for (const uid of [f.member, f.eventOnly]) {
        assert.equal((await read(`users/${uid}`)).joinedEventId, '');
        assert.equal((await read(`users/${uid}`)).joinedGroupId, '');
      }
      assert.equal((await live(`eventStates/${f.event}`)).status, 'deleted');
    }
    assert.deepEqual(await snapshot(f.foreignPaths), foreign);
    assert.deepEqual(await liveSnapshot(f.foreignMirrors), foreignMirrors);
  });

  test(`${resource} deletion rejects unauthorized callers without writes`, async () => {
    const f = await fixture(), original = await snapshot(f.paths), originalMirrors = await liveSnapshot(f.mirrorPaths);
    // Pass undefined directly: the convenience wrapper defaults to the owner.
    const data = resource === 'group' ? { eventId: f.event, groupId: f.group } : { eventId: f.event };
    const handler = resource === 'group' ? events.deleteGroup : events.deleteEvent;
    await rejects(call(handler, undefined, data), 'unauthenticated');
    for (const uid of [f.other, f.member, f.leader, f.backup]) await rejects(remove(f, resource, uid), 'permission-denied');
    assert.deepEqual(await snapshot(f.paths), original);
    assert.deepEqual(await liveSnapshot(f.mirrorPaths), originalMirrors);
    assert.equal((await audits(f)).length, 0);
  });
}

for (const status of ['active', 'paused']) {
  for (const resource of ['group', 'event']) {
    test(`${status}: ${resource} deletion remains denied for owner/admin until the event is closed`, async () => {
      const f = await fixture(status), original = await snapshot(f.paths), originalMirrors = await liveSnapshot(f.mirrorPaths);
      for (const uid of [f.owner, f.admin]) await rejects(remove(f, resource, uid), 'failed-precondition');
      await rejects(call(events.manageEvent, f.owner, { operation: 'delete', resource, eventId: f.event, id: resource === 'group' ? f.group : f.event }), 'failed-precondition');
      assert.deepEqual(await snapshot(f.paths), original);
      assert.deepEqual(await liveSnapshot(f.mirrorPaths), originalMirrors);
      assert.equal((await audits(f)).length, 0);
    });
  }
}

for (const [initial, closed, resource] of [['active', 'completed', 'group'], ['active', 'cancelled', 'event'], ['paused', 'completed', 'event'], ['paused', 'cancelled', 'group']]) {
  test(`${initial} -> owner marks ${closed} -> ${resource} deletion succeeds without reopening`, async () => {
    const f = await fixture(initial);
    await rejects(remove(f, resource), 'failed-precondition');
    const request = { operation: 'update', resource: 'event', eventId: f.event, id: f.event, data: { status: closed } };
    await rejects(call(events.manageEvent, f.other, request), 'permission-denied');
    await call(events.manageEvent, f.owner, request);
    assert.equal((await read(`events/${f.event}`)).status, closed);
    assert.equal((await live(`eventStates/${f.event}`)).status, closed);
    await remove(f, resource);
    await assertReleased(f, f.leader);
    await assertReleased(f, f.backup);
    assert.equal(await read(`groups/${f.group}`), undefined);
    if (resource === 'group') assert.equal((await read(`events/${f.event}`)).status, closed);
    else assert.equal(await read(`events/${f.event}`), undefined);
  });
}
