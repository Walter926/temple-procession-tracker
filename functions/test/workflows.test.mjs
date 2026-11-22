import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp as ClientTimestamp } from 'firebase/firestore';

// These are integration tests, not production probes. Validate every endpoint before
// initializing Admin or importing a module which may obtain a default Admin service.
const projectId = 'demo-temple-procession';
for (const [name, port] of [
  ['FIRESTORE_EMULATOR_HOST', 8080],
  ['FIREBASE_DATABASE_EMULATOR_HOST', 9000],
  ['FIREBASE_AUTH_EMULATOR_HOST', 9099],
]) {
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(process.env[name])) {
    throw new Error(`Refusing to run backend workflows: ${name} must point to the local demo emulator on port ${port}. Run npm run test:rules.`);
  }
}
for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
  if (process.env[name] && process.env[name] !== projectId) throw new Error(`Refusing non-demo ${name}.`);
  process.env[name] = projectId;
}
const databaseURL = 'http://127.0.0.1:9000?ns=demo-temple-procession-default-rtdb';
if (process.env.RTDB_URL) {
  const configured = new URL(process.env.RTDB_URL);
  const demoRemote = configured.hostname === `${projectId}-default-rtdb.firebaseio.com`;
  const demoLocal = ['127.0.0.1', 'localhost'].includes(configured.hostname)
    && configured.port === '9000' && configured.searchParams.get('ns') === `${projectId}-default-rtdb`;
  if (!demoRemote && !demoLocal) throw new Error('Refusing a non-demo RTDB_URL.');
}
process.env.RTDB_URL = databaseURL;

const require = createRequire(import.meta.url);
const runId = `wf-${randomUUID().slice(0, 12)}`;
const password = 'Emulator-only-password-2026';
let sequence = 0;
let app, db, auth, rtdb, environment;
let codes, accounts, memberships, mirrors, suggestions, notices, collisions, events;
let maintenance;

before(async () => {
  app = initializeApp({ projectId, databaseURL });
  db = getFirestore(app);
  auth = getAuth(app);
  rtdb = getDatabaseWithUrl(databaseURL, app);
  // Import compiled modules directly, after initialization; importing index.js
  // would initialize a second default app. npm run test:rules builds these first.
  codes = require('../lib/access_codes.js');
  accounts = require('../lib/account_management.js');
  memberships = require('../lib/memberships.js');
  mirrors = require('../lib/tracking_mirrors.js');
  suggestions = require('../lib/route_suggestions.js');
  notices = require('../lib/notifications.js');
  collisions = require('../lib/collision_detection.js');
  events = require('../lib/event_management.js');
  maintenance = require('../lib/maintenance.js');
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../../firebase_rules/firestore.rules', import.meta.url), 'utf8') },
    database: { rules: await readFile(new URL('../../firebase_rules/database.rules.json', import.meta.url), 'utf8') },
  });
  // Deliberately never clear Firestore, RTDB, or Auth: other suites share them.
});

after(async () => {
  await environment?.cleanup();
  if (db) await db.terminate();
  if (app) await deleteApp(app);
});

const call = (handler, uid, data = {}) => handler.run({
  data,
  auth: uid ? { uid, token: { sub: uid, email: `${uid}@example.test` } } : undefined,
  rawRequest: {},
});
const rejects = (promise, code) => assert.rejects(promise, error => {
  assert.equal(error.code, code, `Expected ${code}, received ${error.code}: ${error.message}`);
  return true;
});
const read = async path => (await db.doc(path).get()).data();
const byEvent = (collection, eventId) => db.collection(collection).where('eventId', '==', eventId).get();
const profile = (uid, role, extra = {}) => ({
  email: `${uid}@example.test`, displayName: uid, role, isActive: true,
  assignedGroupId: '', joinedEventId: '', joinedGroupId: '',
  createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...extra,
});
const location = uid => ({
  userId: uid, latitude: 49, longitude: -123, accuracyMeters: 5,
  speedMetersPerSecond: 1, headingDegrees: 0, recordedAt: Date.now(),
});

async function user(uid, role, extra = {}) {
  await auth.createUser({ uid, email: `${uid}@example.test`, password });
  await db.doc(`users/${uid}`).set(profile(uid, role, extra));
  return uid;
}

async function fixture() {
  const prefix = `${runId}-${++sequence}`;
  const f = Object.fromEntries(['admin', 'owner', 'other', 'leader', 'member', 'second',
    'event', 'foreignEvent', 'route', 'foreignRoute', 'group', 'foreignGroup', 'start', 'end']
    .map(name => [name, `${prefix}-${name}`]));
  await Promise.all([
    user(f.admin, 'admin'), user(f.owner, 'organizer'), user(f.other, 'organizer'),
    user(f.leader, 'teamLeader'), user(f.member, 'teamMember'), user(f.second, 'teamMember'),
  ]);
  const batch = db.batch();
  const event = organizerId => ({
    name: 'Emulator procession', organizerId, description: '', mainTempleName: 'Temple',
    cityRegion: 'Emulator city', status: 'active', isPublic: false, startTime: Timestamp.now(),
    endTime: null, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
  const route = eventId => ({ eventId, name: 'Route', color: '#334455', encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', totalDistanceMeters: 1000, estimatedDurationMinutes: 30, stopPointIds: [f.start, f.end], segmentIds: [] });
  const group = (eventId, routeId) => ({
    eventId, routeId, name: 'Group', leaderUserId: '', backupLeaderUserId: '',
    memberCount: 0, status: 'stopped', startingStopPointId: f.start, endingStopPointId: f.end,
    accessCodeId: null, createdAt: Timestamp.now(),
  });
  for (const [path, data] of Object.entries({
    [`events/${f.event}`]: { ...event(f.owner), routeId: f.route },
    [`events/${f.foreignEvent}`]: { ...event(f.other), routeId: f.foreignRoute },
    [`routes/${f.route}`]: route(f.event),
    [`routes/${f.foreignRoute}`]: route(f.foreignEvent),
    [`groups/${f.group}`]: group(f.event, f.route),
    [`groups/${f.foreignGroup}`]: group(f.foreignEvent, f.foreignRoute),
    [`stopPoints/${f.start}`]: { eventId: f.event, routeId: f.route, name: 'Start', type: 'checkpoint', latitude: 49, longitude: -123, order: 1, geofenceRadiusMeters: 100, maxAllowedGroups: 1, plannedStopMinutes: 0 },
    [`stopPoints/${f.end}`]: { eventId: f.event, routeId: f.route, name: 'Finish', type: 'checkpoint', latitude: 49.01, longitude: -123, order: 2, geofenceRadiusMeters: 100, maxAllowedGroups: 1, plannedStopMinutes: 0 },
  })) batch.set(db.doc(path), data);
  await batch.commit();
  return f;
}

async function createCode(f, extra = {}, uid = f.owner) {
  return call(codes.createAccessCode, uid, { eventId: f.event, groupId: f.group, ...extra });
}

async function assignedFixture() {
  const f = await fixture();
  await call(accounts.assignGroupLeader, f.owner, { groupId: f.group, leaderUserId: f.leader });
  await mirrors.syncEventState(f.event);
  return f;
}

async function pendingSuggestion(f, suffix = 'suggestion') {
  const alertId = `${f.event}-alert`, suggestionId = `${f.event}-${suffix}`, incidentId = `${f.event}-incident`;
  await db.doc(`collisionAlerts/${alertId}`).set({
    eventId: f.event, stopPointId: f.start, status: 'active', incidentId,
    affectedGroupIds: [f.group], lastSeenAt: Timestamp.now(), incidentGeneration: 1,
  });
  await db.doc(`routeSuggestions/${suggestionId}`).set({
    eventId: f.event, routeId: f.route, groupId: f.group, alertId, incidentId,
    status: 'pending', isAccepted: false, message: 'Hold clear of the crowded stop.',
    expiresAt: Timestamp.fromMillis(Date.now() + 900000), createdAt: Timestamp.now(),
  });
  return { alertId, suggestionId, incidentId };
}

test('callables reject missing/inactive accounts and cross-owner code management, while admin remains global', async () => {
  const f = await fixture();
  await rejects(call(codes.createAccessCode, undefined, { eventId: f.event }), 'unauthenticated');
  await rejects(createCode(f, {}, f.other), 'permission-denied');
  await rejects(createCode(f, {}, f.member), 'permission-denied');
  await db.doc(`users/${f.owner}`).update({ isActive: false });
  await rejects(createCode(f), 'permission-denied');
  await db.doc(`users/${f.owner}`).update({ isActive: true });
  const code = await createCode(f);
  await rejects(call(codes.revokeAccessCode, f.other, { id: code.id }), 'permission-denied');
  assert.equal((await read(`accessCodes/${code.id}`)).enabled, true);
  await call(codes.revokeAccessCode, f.admin, { id: code.id });
  assert.equal((await read(`accessCodes/${code.id}`)).enabled, false);
  const global = await createCode(f, { eventId: f.foreignEvent, groupId: f.foreignGroup }, f.admin);
  assert.match(global.code, /^[0-9]{6}$/);
});

test('leader registration grants neither publishing nor code creation until a real assignment', async () => {
  const f = await fixture();
  await mirrors.syncAccountState(f.leader);
  await mirrors.syncEventState(f.event);
  await mirrors.syncGroupAssignment(f.group);
  const context = environment.authenticatedContext(f.leader, { email: `${f.leader}@example.test` });
  const live = context.database(databaseURL).ref(`liveLocations/${f.event}/${f.group}`);
  await assertFails(live.set(location(f.leader)));
  await rejects(createCode(f, {}, f.leader), 'permission-denied');
  await rejects(call(accounts.assignGroupLeader, f.other, { groupId: f.group, leaderUserId: f.leader }), 'permission-denied');
  assert.equal((await read(`users/${f.leader}`)).assignedGroupId, '');
  await call(accounts.assignGroupLeader, f.owner, { groupId: f.group, leaderUserId: f.leader });
  assert.equal((await read(`users/${f.leader}`)).assignedGroupId, f.group);
  assert.equal((await rtdb.ref(`trackingAssignments/${f.group}/leaderUserId`).get()).val(), f.leader);
  await assertSucceeds(live.set(location(f.leader)));
  await createCode(f, {}, f.leader);
  await rejects(createCode(f, { groupId: '' }, f.leader), 'permission-denied');
  await rejects(createCode(f, { eventId: f.foreignEvent, groupId: f.foreignGroup }, f.leader), 'permission-denied');
});

test('registration uses permitted client fields, not caller-forged assignments', async () => {
  const f = await fixture(), uid = `${f.event}-registered`;
  await auth.createUser({ uid, email: `${uid}@example.test`, password });
  const client = environment.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();
  const registration = { ...profile(uid, 'teamLeader'), createdAt: ClientTimestamp.now(), updatedAt: ClientTimestamp.now() };
  delete registration.assignedGroupId;
  delete registration.joinedEventId;
  delete registration.joinedGroupId;
  await assertSucceeds(setDoc(doc(client, `users/${uid}`), registration));
  await mirrors.syncAccountState(uid);
  const state = (await rtdb.ref(`accountStates/${uid}`).get()).val();
  assert.equal(state.role, 'teamLeader');
  assert.equal(state.assignedGroupId, '');
  await rejects(createCode(f, {}, uid), 'permission-denied');
  const forgedUid = `${uid}-forged`;
  const forged = environment.authenticatedContext(forgedUid, { email: `${forgedUid}@example.test` }).firestore();
  await assertFails(setDoc(doc(forged, `users/${forgedUid}`), {
    ...registration, email: `${forgedUid}@example.test`, assignedGroupId: f.group,
  }));
});

test('codes are six numeric digits, hashed, reusable within maxUses and fixed at 24 hours despite caller expiry', async () => {
  const f = await fixture(), started = Date.now();
  const result = await createCode(f, { expiresAtMs: Date.now() + 1000, durationHours: 1, maxUses: 2 });
  const finished = Date.now(), stored = await read(`accessCodes/${result.id}`);
  assert.equal(typeof result.code, 'string');
  assert.match(result.code, /^[0-9]{6}$/);
  assert.match(result.id, /^[a-f0-9]{64}$/);
  assert.equal(result.id, codes.codeHash(result.code));
  assert.equal(stored.code, undefined);
  assert.equal(stored.grantedRole, 'teamMember');
  assert.equal(stored.maxUses, 2);
  assert.equal(stored.usedCount, 0);
  assert.ok(result.expiresAtMs >= started + 86400000 && result.expiresAtMs <= finished + 86400000);
  assert.equal(stored.expiresAt.toMillis(), result.expiresAtMs);
  await call(codes.redeemAccessCode, f.member, { code: ` ${result.code.toLowerCase()} ` });
  await call(codes.redeemAccessCode, f.second, { code: result.code });
  assert.equal((await read(`accessCodes/${result.id}`)).usedCount, 2);
  assert.equal((await read(`groups/${f.group}`)).memberCount, 2);
  assert.equal((await byEvent('memberships', f.event)).size, 2);
});

test('code allocation retries a real storage collision and preserves a leading zero without overwriting the existing code', async t => {
  const f = await fixture(), existing = await createCode(f);
  const original = await read(`accessCodes/${existing.id}`);
  let freshNumber = 41, fresh;
  do {
    fresh = String(++freshNumber).padStart(6, '0');
  } while ((await db.doc(`accessCodes/${codes.codeHash(fresh)}`).get()).exists);
  assert.ok(freshNumber < 100000, 'fixture must retain a leading zero');
  const values = [Number(existing.code), freshNumber];
  let index = 0;
  // Control only entropy, not generateCode or the allocator under test.
  const random = t.mock.method(require('node:crypto'), 'randomInt', maximum => {
    assert.equal(maximum, 1_000_000);
    assert.ok(index < values.length, 'allocator should retry once then succeed');
    return values[index++];
  });
  const allocated = await createCode(f);
  assert.equal(allocated.code, fresh);
  assert.match(allocated.code, /^0[0-9]{5}$/);
  assert.equal(allocated.id, codes.codeHash(fresh));
  assert.notEqual(allocated.id, existing.id);
  assert.equal(random.mock.callCount(), 2);
  assert.deepEqual(await read(`accessCodes/${existing.id}`), original);
  assert.equal((await byEvent('accessCodes', f.event)).size, 2);
  await call(codes.redeemAccessCode, f.member, { code: allocated.code });
  assert.equal((await read(`accessCodes/${allocated.id}`)).usedCount, 1);
});

test('simultaneous duplicate redemptions and different members preserve one membership and exact group/code counts', { timeout: 60000 }, async () => {
  const f = await fixture(), code = await createCode(f);
  const results = await Promise.all([
    call(codes.redeemAccessCode, f.member, { code: code.code }),
    call(codes.redeemAccessCode, f.member, { code: code.code }),
    call(codes.redeemAccessCode, f.second, { code: code.code }),
    call(codes.redeemAccessCode, f.second, { code: code.code }),
  ]);
  assert.equal(results.filter(result => result.alreadyJoined === false).length, 2);
  assert.equal(results.filter(result => result.alreadyJoined === true).length, 2);
  assert.equal((await read(`groups/${f.group}`)).memberCount, 2);
  assert.equal((await read(`accessCodes/${code.id}`)).usedCount, 2);
  const records = await byEvent('memberships', f.event);
  assert.equal(records.size, 2);
  assert.deepEqual(records.docs.map(record => record.data().uid).sort(), [f.member, f.second].sort());
  for (const uid of [f.member, f.second]) {
    assert.equal((await read(`memberships/${memberships.membershipId(f.event, uid)}`)).groupId, f.group);
    assert.equal((await read(`users/${uid}`)).joinedGroupId, f.group);
  }
});

test('existing membership never bypasses invalid, revoked, disabled, expired or malformed code validation', async () => {
  const f = await fixture(), code = await createCode(f);
  await call(codes.redeemAccessCode, f.member, { code: code.code });
  const ref = db.doc(`accessCodes/${code.id}`), original = await read(ref.path);
  await rejects(call(codes.redeemAccessCode, f.member, { code: 'bad/' }), 'invalid-argument');
  let missing;
  do { missing = codes.generateCode(); } while ((await db.doc(`accessCodes/${codes.codeHash(missing)}`).get()).exists);
  await rejects(call(codes.redeemAccessCode, f.member, { code: missing }), 'not-found');
  for (const [patch, expected] of [
    [{ enabled: false }, 'failed-precondition'],
    [{ revokedAt: Timestamp.now() }, 'failed-precondition'],
    [{ expiresAt: Timestamp.fromMillis(Date.now() - 1) }, 'deadline-exceeded'],
    [{ expiresAt: Date.now() + 86400000 }, 'deadline-exceeded'],
    [{ grantedRole: 'admin' }, 'failed-precondition'],
    [{ scope: 'event', groupId: f.group }, 'failed-precondition'],
  ]) {
    await ref.set({ ...original, ...patch });
    await rejects(call(codes.redeemAccessCode, f.member, { code: code.code }), expected);
  }
  assert.equal((await read(`groups/${f.group}`)).memberCount, 1);
  assert.equal((await read(ref.path)).usedCount, 1);
  assert.equal((await byEvent('memberships', f.event)).size, 1);
});

test('redemption revalidates event/group availability and account eligibility even for existing members', async () => {
  const f = await fixture(), code = await createCode(f);
  await call(codes.redeemAccessCode, f.member, { code: code.code });
  await db.doc(`events/${f.event}`).update({ status: 'completed' });
  await rejects(call(codes.redeemAccessCode, f.member, { code: code.code }), 'failed-precondition');
  await db.doc(`events/${f.event}`).update({ status: 'active' });
  await db.doc(`groups/${f.group}`).update({ eventId: f.foreignEvent });
  await rejects(call(codes.redeemAccessCode, f.member, { code: code.code }), 'failed-precondition');
  await db.doc(`groups/${f.group}`).update({ eventId: f.event, deleting: true });
  await rejects(call(codes.redeemAccessCode, f.member, { code: code.code }), 'failed-precondition');
  await db.doc(`groups/${f.group}`).update({ deleting: false });
  await db.doc(`users/${f.member}`).update({ isActive: false });
  await rejects(call(codes.redeemAccessCode, f.member, { code: code.code }), 'permission-denied');
  await rejects(call(codes.redeemAccessCode, f.owner, { code: code.code }), 'permission-denied');
  assert.equal((await read(`groups/${f.group}`)).memberCount, 1);
  assert.equal((await read(`accessCodes/${code.id}`)).usedCount, 1);
});

test('redemption attempt limits persist across invalid attempts without creating memberships', async () => {
  const f = await fixture();
  for (let index = 0; index < 10; index++) await rejects(call(codes.redeemAccessCode, f.member, { code: '!' }), 'invalid-argument');
  await rejects(call(codes.redeemAccessCode, f.member, { code: '!' }), 'resource-exhausted');
  assert.equal((await byEvent('memberships', f.event)).size, 0);
  assert.equal((await read(`operationLimits/redeemCodeMinute_${f.member}`)).attempts, 10);
});

test('event-only membership upgrades to a group without duplicates and active selection is explicit across events', async () => {
  const f = await fixture(), eventCode = await createCode(f, { groupId: '', scope: 'event' });
  const first = await call(codes.redeemAccessCode, f.member, { code: eventCode.code });
  assert.equal(first.groupId, '');
  const memberPath = `memberships/${memberships.membershipId(f.event, f.member)}`;
  const joinedAt = (await read(memberPath)).joinedAt.toMillis();
  assert.equal((await read(`groups/${f.group}`)).memberCount, 0);
  const groupCode = await createCode(f);
  await call(codes.redeemAccessCode, f.member, { code: groupCode.code });
  assert.equal((await read(memberPath)).joinedAt.toMillis(), joinedAt);
  assert.equal((await read(memberPath)).groupId, f.group);
  assert.equal((await read(`groups/${f.group}`)).memberCount, 1);
  const repeat = await call(codes.redeemAccessCode, f.member, { code: eventCode.code });
  assert.equal(repeat.alreadyJoined, true);
  assert.equal(repeat.groupId, f.group, 'event-only code must not downgrade a group membership');
  const foreignCode = await createCode(f, { eventId: f.foreignEvent, groupId: '' }, f.other);
  await call(codes.redeemAccessCode, f.member, { code: foreignCode.code });
  assert.equal((await read(`users/${f.member}`)).joinedEventId, f.foreignEvent);
  await rejects(call(memberships.setActiveMembership, f.second, { eventId: f.event }), 'permission-denied');
  await rejects(call(memberships.setActiveMembership, f.member, { eventId: f.event, groupId: '' }), 'failed-precondition');
  await call(memberships.setActiveMembership, f.member, { eventId: f.event, groupId: f.group });
  const selected = await read(`users/${f.member}`);
  assert.equal(selected.joinedEventId, f.event);
  assert.equal(selected.joinedGroupId, f.group);
  assert.equal((await byEvent('memberships', f.event)).size, 1);
  assert.equal((await byEvent('memberships', f.foreignEvent)).size, 1);
});

test('group transfers require owning management, preserve counts, and removal is repeat-safe', async () => {
  const f = await fixture(), code = await createCode(f), nextGroup = `${f.group}-next`;
  await db.doc(`groups/${nextGroup}`).set({ ...await read(`groups/${f.group}`), name: 'Next group' });
  await call(codes.redeemAccessCode, f.member, { code: code.code });
  const nextCode = await createCode(f, { groupId: nextGroup });
  await rejects(call(codes.redeemAccessCode, f.member, { code: nextCode.code }), 'already-exists');
  const transfer = { eventId: f.event, uid: f.member, groupId: nextGroup };
  await rejects(call(memberships.transferMembership, f.member, transfer), 'permission-denied');
  await rejects(call(memberships.transferMembership, f.other, transfer), 'permission-denied');
  await rejects(call(memberships.transferMembership, f.owner, { ...transfer, groupId: f.foreignGroup }), 'failed-precondition');
  await call(memberships.transferMembership, f.owner, transfer);
  await call(memberships.transferMembership, f.owner, transfer);
  assert.equal((await read(`groups/${f.group}`)).memberCount, 0);
  assert.equal((await read(`groups/${nextGroup}`)).memberCount, 1);
  assert.equal((await read(`users/${f.member}`)).joinedGroupId, nextGroup);
  await rejects(call(memberships.removeMembership, f.other, { eventId: f.event, uid: f.member }), 'permission-denied');
  assert.equal((await call(memberships.removeMembership, f.member, { eventId: f.event })).removed, true);
  assert.equal((await call(memberships.removeMembership, f.member, { eventId: f.event })).removed, false);
  assert.equal((await read(`groups/${nextGroup}`)).memberCount, 0);
  assert.equal((await read(`users/${f.member}`)).joinedEventId, '');
  assert.equal((await byEvent('memberships', f.event)).size, 0);
});

test('event management enforces ownership of both the requested event and the actual related record', async () => {
  const f = await fixture();
  await db.doc(`events/${f.event}`).update({ status: 'draft' });
  const rename = { operation: 'update', resource: 'event', id: f.event, eventId: f.event, data: { name: 'Updated event' } };
  await rejects(call(events.manageEvent, f.other, rename), 'permission-denied');
  await rejects(call(events.validateEvent, f.other, { eventId: f.event }), 'permission-denied');
  await rejects(call(events.manageEvent, f.owner, {
    operation: 'update', resource: 'route', id: f.foreignRoute, eventId: f.event, data: { name: 'Forged cross-event edit' },
  }), 'permission-denied');
  assert.equal((await read(`routes/${f.foreignRoute}`)).name, 'Route');
  await call(events.manageEvent, f.owner, rename);
  assert.equal((await read(`events/${f.event}`)).name, 'Updated event');
  await call(events.manageEvent, f.admin, { ...rename, data: { name: 'Admin update' } });
  assert.equal((await read(`events/${f.event}`)).name, 'Admin update');
});

test('activation validates route ownership, ordered stops, coordinates, geofences and live leader relationships atomically', async () => {
  const f = await assignedFixture();
  await db.doc(`events/${f.event}`).update({ status: 'draft' });
  const activate = { operation: 'update', resource: 'event', id: f.event, eventId: f.event, data: { status: 'active', isPublic: true } };
  assert.equal((await call(events.validateEvent, f.owner, { eventId: f.event })).valid, true);
  await rejects(call(events.manageEvent, f.owner, { ...activate, data: { ...activate.data, routeId: f.foreignRoute } }), 'invalid-argument');
  for (const [path, patch] of [
    [`groups/${f.group}`, { routeId: f.foreignRoute }],
    [`groups/${f.group}`, { endingStopPointId: f.start }],
    [`stopPoints/${f.end}`, { order: 1 }],
    [`stopPoints/${f.start}`, { latitude: 91 }],
    [`stopPoints/${f.start}`, { geofenceRadiusMeters: 0 }],
    [`users/${f.leader}`, { assignedGroupId: f.foreignGroup }],
  ]) {
    const original = await read(path);
    await db.doc(path).update(patch);
    const validation = await call(events.validateEvent, f.owner, { eventId: f.event });
    assert.equal(validation.valid, false, `Malformed ${path} must fail event graph validation`);
    assert.ok(validation.errors.length > 0);
    await rejects(call(events.manageEvent, f.owner, activate), 'failed-precondition');
    assert.equal((await read(`events/${f.event}`)).status, 'draft');
    assert.equal((await db.doc(`publicEvents/${f.event}`).get()).exists, false);
    await db.doc(path).set(original);
  }
  await call(events.manageEvent, f.owner, activate);
  assert.equal((await read(`events/${f.event}`)).status, 'active');
  assert.equal((await read(`publicEvents/${f.event}`)).routeId, f.route);
  assert.equal((await rtdb.ref(`eventStates/${f.event}/status`).get()).val(), 'active');
});

test('private assignments never publish an event and publication follows visibility, status and current route ownership', async () => {
  const f = await assignedFixture();
  await events.syncPublicEvent(f.event);
  assert.equal((await db.doc(`publicEvents/${f.event}`).get()).exists, false);
  const update = data => call(events.manageEvent, f.owner, {
    operation: 'update', resource: 'event', id: f.event, eventId: f.event, data,
  });
  await update({ isPublic: true });
  const projection = await read(`publicEvents/${f.event}`);
  assert.equal(projection.isPublic, true);
  assert.equal(projection.routeId, f.route);
  assert.equal(projection.organizerId, undefined, 'public projection omits private management fields');
  await update({ isPublic: false });
  assert.equal((await db.doc(`publicEvents/${f.event}`).get()).exists, false);
  await update({ isPublic: true });
  await update({ status: 'paused' });
  assert.equal((await db.doc(`publicEvents/${f.event}`).get()).exists, false);
  await update({ status: 'active' });
  assert.equal((await db.doc(`publicEvents/${f.event}`).get()).exists, true);
  await db.doc(`routes/${f.route}`).update({ eventId: f.foreignEvent });
  await events.syncPublicEvent(f.event);
  assert.equal((await db.doc(`publicEvents/${f.event}`).get()).exists, false, 'stale publication must not survive a mismatched primary route');
});

for (const [label, patch] of [['deactivation', { isActive: false }], ['role downgrade', { role: 'teamMember' }]]) {
  test(`admin ${label} revokes existing leader GPS capability, assignment, codes, memberships and tokens`, async () => {
    const f = await assignedFixture(), code = await createCode(f, {}, f.leader);
    await call(codes.redeemAccessCode, f.leader, { code: code.code });
    const token = `${f.leader}-emulator-device-token`;
    const registered = await call(notices.registerDeviceToken, f.leader, { token, deviceId: `${f.leader}-device`, platform: 'android' });
    const client = environment.authenticatedContext(f.leader, { email: `${f.leader}@example.test` });
    const live = client.database(databaseURL).ref(`liveLocations/${f.event}/${f.group}`);
    await assertSucceeds(live.set(location(f.leader)));
    await rejects(call(accounts.manageAccount, f.owner, { action: 'update', uid: f.leader, ...patch }), 'permission-denied');
    await call(accounts.manageAccount, f.admin, { action: 'update', uid: f.leader, ...patch });
    const target = await read(`users/${f.leader}`), group = await read(`groups/${f.group}`);
    assert.equal(target.assignedGroupId, '');
    assert.equal(target.joinedEventId, '');
    assert.equal(group.leaderUserId, '');
    assert.equal(group.memberCount, 0);
    assert.equal(group.status, 'stopped');
    assert.equal((await read(`accessCodes/${code.id}`)).enabled, false);
    assert.equal((await db.doc(`deviceTokens/${registered.id}`).get()).exists, false);
    assert.equal((await byEvent('memberships', f.event)).size, 0);
    const accountState = (await rtdb.ref(`accountStates/${f.leader}`).get()).val();
    assert.equal(accountState.assignedGroupId, '');
    assert.equal(accountState.isActive, patch.isActive !== false);
    assert.equal((await auth.getUser(f.leader)).disabled, patch.isActive === false);
    assert.equal((await rtdb.ref(`trackingAssignments/${f.group}/leaderUserId`).get()).val(), '');
    assert.equal((await rtdb.ref(`eventAccess/${f.event}/${f.leader}/allowed`).get()).val(), false);
    await assertFails(live.set(location(f.leader)));
    await rejects(createCode(f, {}, f.leader), 'permission-denied');
  });
}

test('concurrent approvals commit exactly one instruction, notification and durable delivery and are repeat-safe', { timeout: 60000 }, async () => {
  const f = await assignedFixture(), { suggestionId } = await pendingSuggestion(f);
  await rejects(call(suggestions.approveRouteSuggestion, f.other, { suggestionId }), 'permission-denied');
  const results = await Promise.all([
    call(suggestions.approveRouteSuggestion, f.owner, { suggestionId }),
    call(suggestions.approveRouteSuggestion, f.admin, { suggestionId }),
    call(suggestions.approveRouteSuggestion, f.owner, { suggestionId }),
  ]);
  assert.ok(results.every(result => result.status === 'approved' && result.instructionId === suggestionId));
  const instruction = await read(`routeInstructions/${suggestionId}`);
  assert.equal(instruction.uid, f.leader);
  assert.equal(instruction.state, 'active');
  assert.equal((await byEvent('routeInstructions', f.event)).size, 1);
  const notifications = await byEvent('notifications', f.event);
  assert.equal(notifications.size, 1);
  const delivery = await read(`notificationDeliveries/${notifications.docs[0].id}`);
  assert.equal(delivery.state, 'pending');
  assert.equal(delivery.attempts, 0);
  assert.equal((await read(`routeInstructionHeads/${f.group}`)).instructionId, suggestionId);
  await rejects(call(suggestions.rejectRouteSuggestion, f.owner, { suggestionId }), 'failed-precondition');
});

test('concurrent approval/rejection has exactly one decision and never delivers a rejected instruction', { timeout: 60000 }, async () => {
  const f = await assignedFixture(), { suggestionId } = await pendingSuggestion(f);
  const results = await Promise.allSettled([
    call(suggestions.approveRouteSuggestion, f.owner, { suggestionId }),
    call(suggestions.rejectRouteSuggestion, f.admin, { suggestionId }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected');
  assert.equal(failed.reason.code, 'failed-precondition');
  const final = await read(`routeSuggestions/${suggestionId}`);
  assert.ok(['approved', 'rejected'].includes(final.status));
  assert.equal((await byEvent('routeInstructions', f.event)).size, final.status === 'approved' ? 1 : 0);
  assert.equal((await byEvent('notifications', f.event)).size, final.status === 'approved' ? 1 : 0);
  const handler = final.status === 'approved' ? suggestions.approveRouteSuggestion : suggestions.rejectRouteSuggestion;
  assert.equal((await call(handler, f.owner, { suggestionId })).status, final.status);
});

test('stale suggestion relationships, incidents and expired advice cannot produce leader instructions', async () => {
  const f = await assignedFixture();
  for (const [index, change] of [
    async ({ suggestionId }) => db.doc(`routeSuggestions/${suggestionId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) }),
    async ({ alertId }) => db.doc(`collisionAlerts/${alertId}`).update({ incidentId: 'different-incident' }),
    async ({ suggestionId }) => db.doc(`routeSuggestions/${suggestionId}`).update({ routeId: f.foreignRoute }),
    async ({ alertId }) => db.doc(`collisionAlerts/${alertId}`).update({ lastSeenAt: Timestamp.fromMillis(Date.now() - 100000) }),
  ].entries()) {
    const advice = await pendingSuggestion(f, `stale-${index}`);
    await change(advice);
    await rejects(call(suggestions.approveRouteSuggestion, f.owner, { suggestionId: advice.suggestionId }), 'failed-precondition');
  }
  assert.equal((await byEvent('routeInstructions', f.event)).size, 0);
  assert.equal((await byEvent('notifications', f.event)).size, 0);
});

test('a collision returning at the same stop gets a fresh incident, suggestions and notices without duplicate replay', { timeout: 60000 }, async () => {
  const f = await assignedFixture(), secondGroup = `${f.group}-second`, secondLeader = `${f.leader}-second`;
  await user(secondLeader, 'teamLeader', { assignedGroupId: secondGroup });
  await db.doc(`groups/${secondGroup}`).set({ ...await read(`groups/${f.group}`), leaderUserId: secondLeader });
  await rtdb.ref(`liveLocations/${f.event}`).set({ [f.group]: location(f.leader), [secondGroup]: location(secondLeader) });
  await collisions.recountCollisions(f.event);
  const alertId = `${f.event}_${f.start}`, first = await read(`collisionAlerts/${alertId}`);
  assert.equal(first.status, 'active');
  assert.equal(first.incidentGeneration, 1);
  await suggestions.generateIncidentSuggestions(alertId);
  await suggestions.generateIncidentSuggestions(alertId);
  const firstSuggestions = await byEvent('routeSuggestions', f.event);
  assert.equal(firstSuggestions.size, 2);
  assert.equal((await byEvent('collisionWarnings', f.event)).size, 2);
  assert.equal((await byEvent('notifications', f.event)).size, 2);
  await rtdb.ref(`liveLocations/${f.event}/${secondGroup}`).set({ ...location(secondLeader), latitude: 49.02 });
  await collisions.recountCollisions(f.event);
  assert.equal((await read(`collisionAlerts/${alertId}`)).status, 'resolved');
  await suggestions.generateIncidentSuggestions(alertId);
  for (const previous of firstSuggestions.docs) assert.equal((await read(previous.ref.path)).status, 'resolved');
  await rtdb.ref(`liveLocations/${f.event}`).set({ [f.group]: location(f.leader), [secondGroup]: location(secondLeader) });
  await collisions.recountCollisions(f.event);
  const returning = await read(`collisionAlerts/${alertId}`);
  assert.equal(returning.status, 'active');
  assert.equal(returning.incidentGeneration, 2);
  assert.notEqual(returning.incidentId, first.incidentId);
  await suggestions.generateIncidentSuggestions(alertId);
  await suggestions.generateIncidentSuggestions(alertId);
  const allSuggestions = await byEvent('routeSuggestions', f.event);
  assert.equal(allSuggestions.size, 4);
  assert.equal(allSuggestions.docs.filter(record => record.data().status === 'pending').length, 2);
  assert.equal((await byEvent('collisionWarnings', f.event)).size, 4);
  assert.equal((await byEvent('notifications', f.event)).size, 4);
});

test('private announcements fan out only to current event members and assigned leaders and retries do not duplicate notices', async () => {
  const f = await assignedFixture(), code = await createCode(f);
  await call(codes.redeemAccessCode, f.member, { code: code.code });
  const input = { eventId: f.event, audience: 'event', message: 'Meet at the next stop.', requestId: `${f.event}-announcement` };
  await rejects(call(notices.sendAnnouncement, f.other, input), 'permission-denied');
  await rejects(call(notices.sendAnnouncement, f.leader, input), 'permission-denied');
  const created = await call(notices.sendAnnouncement, f.owner, input);
  const repeated = await call(notices.sendAnnouncement, f.owner, input);
  assert.equal(repeated.id, created.id);
  await notices.processAnnouncementFanout(created.id);
  await notices.processAnnouncementFanout(created.id);
  await notices.processAnnouncementFanout(created.id);
  const notifications = await byEvent('notifications', f.event);
  assert.equal(notifications.size, 2);
  assert.deepEqual(notifications.docs.map(record => record.data().uid).sort(), [f.member, f.leader].sort());
  assert.equal((await read(`notificationFanouts/${created.id}`)).state, 'completed');
  assert.equal((await db.doc(`publicAnnouncements/${created.id}`).get()).exists, false);
  for (const notice of notifications.docs) assert.equal((await read(`notificationDeliveries/${notice.id}`)).state, 'pending');
});

test('outbox persists failed FCM sends, backs off, retries once due and never resends completed delivery', async t => {
  const f = await assignedFixture(), { suggestionId } = await pendingSuggestion(f);
  const token = `${f.leader}-fake-fcm-token`;
  const device = await call(notices.registerDeviceToken, f.leader, { token, deviceId: 'emulator-device', platform: 'android' });
  await call(suggestions.approveRouteSuggestion, f.owner, { suggestionId });
  const notification = (await byEvent('notifications', f.event)).docs[0], deliveryRef = db.doc(`notificationDeliveries/${notification.id}`);
  let attempts = 0;
  // There is no FCM emulator. Only the external transport is mocked; eligibility,
  // transaction leases, persistence, backoff and token ownership use real handlers.
  t.mock.method(getMessaging(app), 'send', async message => {
    assert.equal(message.token, token);
    assert.equal(message.data.notificationId, notification.id);
    if (++attempts === 1) throw Object.assign(new Error('Emulated transient FCM outage'), { code: 'messaging/server-unavailable' });
    return 'emulated-message-id';
  });
  await notices.deliverNotification(notification.id);
  let delivery = (await deliveryRef.get()).data();
  assert.equal(delivery.state, 'retry');
  assert.equal(delivery.attempts, 1);
  assert.equal(delivery.lastErrorCode, 'messaging/server-unavailable');
  assert.equal(notices.canClaimDelivery(delivery, Date.now()), false);
  assert.ok(delivery.nextAttemptAt.toMillis() > Date.now());
  assert.equal((await notification.ref.get()).exists, true);
  await notices.deliverNotification(notification.id);
  assert.equal(attempts, 1, 'a persisted notice must not bypass backoff');
  await deliveryRef.update({ nextAttemptAt: Timestamp.fromMillis(Date.now() - 1) });
  await notices.deliverNotification(notification.id);
  delivery = (await deliveryRef.get()).data();
  assert.equal(delivery.state, 'delivered');
  assert.equal(delivery.attempts, 2);
  assert.deepEqual(delivery.deliveredTokenIds, [device.id]);
  assert.equal(delivery.nextAttemptAt, undefined);
  assert.equal(delivery.lease, undefined);
  await notices.deliverNotification(notification.id);
  assert.equal(attempts, 2, 'terminal deliveries must not send again');
});

test('outbox rechecks deactivated recipients and cancels before any push attempt', async t => {
  const f = await assignedFixture(), { suggestionId } = await pendingSuggestion(f);
  await call(suggestions.approveRouteSuggestion, f.owner, { suggestionId });
  const notification = (await byEvent('notifications', f.event)).docs[0];
  await db.doc(`users/${f.leader}`).update({ isActive: false });
  t.mock.method(getMessaging(app), 'send', async () => assert.fail('Revoked recipients must never reach FCM'));
  await notices.deliverNotification(notification.id);
  const delivery = await read(`notificationDeliveries/${notification.id}`);
  assert.equal(delivery.state, 'cancelled');
  assert.equal(delivery.attempts, 0);
  assert.equal(delivery.nextAttemptAt, undefined);
  assert.equal((await notification.ref.get()).exists, true, 'the in-app notice is retained independently of push delivery');
});

test('outbox retry helper fences live leases, permits expired leases, and caps attempts/backoff', () => {
  const now = Date.now(), past = Timestamp.fromMillis(now - 1), future = Timestamp.fromMillis(now + 120000);
  assert.equal(notices.canClaimDelivery({ state: 'delivering', attempts: 1, nextAttemptAt: past, leaseUntil: future }, now), false);
  assert.equal(notices.canClaimDelivery({ state: 'delivering', attempts: 1, nextAttemptAt: past, leaseUntil: past }, now), true);
  assert.equal(notices.canClaimDelivery({ state: 'retry', attempts: 8, nextAttemptAt: past }, now), false);
  assert.equal(notices.canClaimDelivery({ state: 'delivered', attempts: 1, nextAttemptAt: past }, now), false);
  assert.equal(notices.retryDelayMs(1), 30000);
  assert.equal(notices.retryDelayMs(2), 60000);
  assert.equal(notices.retryDelayMs(100), 3600000);
});

test('simultaneous phone updates claim only one whole-event collision scan per throttle window', async () => {
  const eventId = `${runId}-scan-budget`, now = Date.now();
  const claimed = await Promise.all(Array.from({ length: 10 }, () => collisions.claimCollisionScan(eventId, now)));
  assert.equal(claimed.filter(Boolean).length, 1);
  assert.equal(await collisions.claimCollisionScan(eventId, now + 2999), false);
  assert.equal(await collisions.claimCollisionScan(eventId, now + 3000), true);
});

test('leader directory uses bounded cursor pages and enforces event ownership', async () => {
  const f = await fixture(), batch = db.batch();
  for (let index = 0; index < 201; index++) {
    const uid = `aa-${runId}-${String(index).padStart(3, '0')}`;
    batch.set(db.doc(`users/${uid}`), profile(uid, 'teamLeader'));
  }
  await batch.commit();
  const input = { eventId: f.event, groupId: f.group };
  await rejects(call(accounts.listAssignableLeaders, f.other, input), 'permission-denied');
  const first = await call(accounts.listAssignableLeaders, f.owner, input);
  assert.ok(first.nextCursor);
  assert.ok(first.users.length <= 200);
  const second = await call(accounts.listAssignableLeaders, f.owner, { ...input, cursor: first.nextCursor });
  assert.ok(second.users.length > 0);
  assert.equal(second.users.some(user => first.users.some(previous => previous.id === user.id)), false);
});

test('admin account creation, Auth metadata edits and repeat-safe deletion keep personal records consistent', async () => {
  const f = await fixture(), uid = `${f.event}-managed`, email = `${uid}@example.test`;
  await rejects(call(accounts.manageAccount, f.owner, { action: 'create', email, password, displayName: 'Managed', role: 'teamMember' }), 'permission-denied');
  await call(accounts.manageAccount, f.admin, { action: 'create', uid, email, password, displayName: 'Managed', role: 'teamMember' });
  assert.equal((await auth.getUser(uid)).email, email);
  assert.equal((await read(`users/${uid}`)).role, 'teamMember');
  const updatedEmail = `updated-${email}`;
  await call(accounts.manageAccount, f.admin, { action: 'update', uid, email: updatedEmail, displayName: 'Renamed' });
  assert.equal((await auth.getUser(uid)).email, updatedEmail);
  assert.equal((await read(`users/${uid}`)).displayName, 'Renamed');
  assert.equal((await read(`users/${uid}`)).authMetadataPending, undefined);
  await db.doc(`locationHistory/${uid}`).set({ userId: uid, eventId: f.event, recordedAt: Timestamp.now() });
  await db.doc(`notifications/${uid}`).set({ uid, eventId: f.event, createdAt: Timestamp.now() });
  await call(accounts.manageAccount, f.admin, { action: 'delete', uid });
  await accounts.processAccountDeletion(uid);
  await assert.rejects(auth.getUser(uid), error => error.code === 'auth/user-not-found');
  for (const path of [`users/${uid}`, `locationHistory/${uid}`, `notifications/${uid}`]) assert.equal((await db.doc(path).get()).exists, false);
  assert.equal((await rtdb.ref(`accountStates/${uid}/isActive`).get()).val(), false);
  // No Storage emulator is used: leave image cleanup durably pending, never claim it succeeded.
  assert.equal((await read(`accountDeletionJobs/${uid}`)).state, 'storage-pending');
});

test('retention deletes expired precise samples and tokens but preserves recent samples and unresolved incidents', async () => {
  const id = `${runId}-retention`, now = Date.now(), day = 86400000;
  const values = [
    [`locationHistory/${id}-old`, { recordedAt: Timestamp.fromMillis(now - 8 * day) }],
    [`locationHistory/${id}-recent`, { recordedAt: Timestamp.fromMillis(now - 6 * day) }],
    [`deviceTokens/${id}`, { expiresAt: Timestamp.fromMillis(now - 1) }],
    [`collisionAlerts/${id}`, { status: 'active', resolvedAt: Timestamp.fromMillis(now - 31 * day) }],
  ];
  for (const [path, data] of values) await db.doc(path).set(data);
  await maintenance.cleanupRetainedRecords(now);
  assert.equal((await db.doc(values[0][0]).get()).exists, false);
  assert.equal((await db.doc(values[1][0]).get()).exists, true);
  assert.equal((await db.doc(values[2][0]).get()).exists, false);
  assert.equal((await db.doc(values[3][0]).get()).exists, true);
  await rtdb.ref(`liveLocations/${id}`).set({ old: { recordedAt: now - 8 * day, latitude: 12 }, recent: { recordedAt: now, latitude: 12 } });
  await maintenance.cleanupLiveLocations(now);
  assert.equal((await rtdb.ref(`liveLocations/${id}/old`).get()).exists(), false);
  assert.equal((await rtdb.ref(`liveLocations/${id}/recent`).get()).exists(), true);
});
