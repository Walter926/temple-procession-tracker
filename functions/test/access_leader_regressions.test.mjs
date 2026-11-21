import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// This focused suite shares local emulators safely: UUID fixtures, no clearing,
// rule uploads, Auth changes, deployed functions or production endpoints.
const projectId = 'demo-temple-procession';
if (!['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST)) {
  throw new Error('Access/leader regressions require the local Firestore emulator on port 8080.');
}
for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
  if (process.env[name] && process.env[name] !== projectId) throw new Error(`Refusing non-demo ${name}.`);
  process.env[name] = projectId;
}
const require = createRequire(import.meta.url);
let app, db, codes, accounts;
before(() => {
  app = initializeApp({ projectId });
  db = getFirestore(app);
  codes = require('../lib/access_codes.js');
  accounts = require('../lib/account_management.js');
});
after(async () => {
  if (db) await db.terminate();
  if (app) await deleteApp(app);
});
const call = (handler, uid, data = {}) => handler.run({ data, auth: uid ? { uid, token: { sub: uid } } : undefined, rawRequest: {} });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const read = async path => (await db.doc(path).get()).data();
const byEvent = (collection, eventId) => db.collection(collection).where('eventId', '==', eventId).get();
const issue = (f, extra = {}, uid = f.owner) => call(codes.createAccessCode, uid, { eventId: f.event, groupId: f.group, ...extra });
const redeem = (uid, code) => call(codes.redeemAccessCode, uid, { code });
const directory = (f, extra = {}, uid = f.owner) => call(accounts.listAssignableLeaders, uid, { eventId: f.event, groupId: f.group, ...extra });
async function fixture() {
  const f = Object.fromEntries(['admin', 'owner', 'other', 'leader', 'backup', 'member', 'second', 'event', 'foreignEvent', 'group', 'foreignGroup'].map(name => [name, randomUUID()]));
  const batch = db.batch();
  for (const [key, role] of [['admin', 'admin'], ['owner', 'organizer'], ['other', 'organizer'], ['leader', 'teamLeader'], ['backup', 'teamLeader'], ['member', 'teamMember'], ['second', 'teamMember']]) {
    batch.set(db.doc(`users/${f[key]}`), { role, isActive: true, displayName: `Regression ${key}`, email: `${f[key]}@example.test`, assignedGroupId: '' });
  }
  for (const [eventId, organizerId] of [[f.event, f.owner], [f.foreignEvent, f.other]]) batch.set(db.doc(`events/${eventId}`), { organizerId, status: 'active', createdAt: Timestamp.now() });
  for (const [groupId, eventId] of [[f.group, f.event], [f.foreignGroup, f.foreignEvent]]) batch.set(db.doc(`groups/${groupId}`), { eventId, memberCount: 0, leaderUserId: '', backupLeaderUserId: '' });
  await batch.commit();
  return f;
}

test('authorized issuance supports both scopes, omitted limits, six symbols and a server-fixed 24-hour expiry', async () => {
  const f = await fixture();
  for (const [groupId, scope, maxUses] of [[f.group, 'group', undefined], ['', 'event', 1], ['', 'event', 1000]]) {
    const started = Date.now();
    const result = await issue(f, { groupId, scope, maxUses, expiresAtMs: started + 1, durationHours: 1, grantedRole: 'teamMember', enabled: true });
    const finished = Date.now(), stored = await read(`accessCodes/${result.id}`);
    assert.ok(/^[A-Z0-9]{6}$/.test(result.code), 'six alphanumeric symbols');
    assert.ok(result.id === codes.codeHash(result.code), 'only the hash identifies stored codes');
    assert.equal(stored.code, undefined);
    assert.equal(stored.scope, scope);
    assert.equal(stored.groupId, groupId);
    assert.equal(stored.maxUses, maxUses ?? 1000);
    assert.equal(result.maxUses, stored.maxUses);
    assert.equal(stored.usedCount, 0);
    assert.ok(result.expiresAtMs >= started + 86400000 && result.expiresAtMs <= finished + 86400000);
    assert.equal(stored.expiresAt.toMillis(), result.expiresAtMs);
  }
});

test('invalid maximum uses and inconsistent event/group scope never create code records', async () => {
  const f = await fixture();
  for (const maxUses of [null, 0, -1, 1001, 1.5, '1', true, [], {}]) await rejects(issue(f, { maxUses }), 'invalid-argument');
  for (const patch of [{ scope: 'event' }, { scope: 'group', groupId: '' }, { scope: 'admin' }, { grantedRole: 'admin' }]) await rejects(issue(f, patch), 'invalid-argument');
  await rejects(issue(f, { groupId: f.foreignGroup }), 'failed-precondition');
  assert.equal((await byEvent('accessCodes', f.event)).size, 0);
});

test('code issuance preserves active-owner/admin and assigned-primary-only authorization', async () => {
  const f = await fixture();
  await rejects(call(codes.createAccessCode, undefined, { eventId: f.event }), 'unauthenticated');
  for (const uid of [f.other, f.member, f.leader, f.backup]) await rejects(issue(f, {}, uid), 'permission-denied');
  await db.doc(`groups/${f.group}`).update({ leaderUserId: f.leader, backupLeaderUserId: f.backup });
  await db.doc(`users/${f.leader}`).update({ assignedGroupId: f.group });
  await db.doc(`users/${f.backup}`).update({ assignedGroupId: f.group });
  await issue(f, {}, f.leader);
  await rejects(issue(f, {}, f.backup), 'permission-denied');
  await rejects(issue(f, { groupId: '' }, f.leader), 'permission-denied');
  await issue(f, { eventId: f.foreignEvent, groupId: f.foreignGroup }, f.admin);
  await db.doc(`users/${f.owner}`).update({ isActive: false });
  await rejects(issue(f), 'permission-denied');
  await db.doc(`events/${f.event}`).update({ status: 'completed' });
  await rejects(issue(f, {}, f.admin), 'failed-precondition');
});

test('the final use is transactional: simultaneous new members cannot exceed a one-use code', { timeout: 60000 }, async () => {
  const f = await fixture(), result = await issue(f, { maxUses: 1 });
  const outcomes = await Promise.allSettled([redeem(f.member, result.code), redeem(f.second, result.code)]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(outcome => outcome.status === 'rejected' && outcome.reason.code === 'resource-exhausted').length, 1);
  assert.equal((await read(`accessCodes/${result.id}`)).usedCount, 1);
  assert.equal((await read(`groups/${f.group}`)).memberCount, 1);
  assert.equal((await byEvent('memberships', f.event)).size, 1);
  // Exhaustion remains a validity check even for an existing member.
  for (const uid of [f.member, f.second]) await rejects(redeem(uid, result.code), 'resource-exhausted');
});

test('retries while valid are idempotent and event-to-group joining preserves membership counts', async () => {
  const f = await fixture(), event = await issue(f, { groupId: '', maxUses: 3 });
  const joined = await redeem(f.member, ` ${event.code.toLowerCase()} `);
  assert.equal(joined.groupId, '');
  assert.equal((await redeem(f.member, event.code)).alreadyJoined, true);
  assert.equal((await read(`accessCodes/${event.id}`)).usedCount, 1);
  assert.equal((await read(`groups/${f.group}`)).memberCount, 0);
  const group = await issue(f, { maxUses: 3 });
  assert.equal((await redeem(f.member, group.code)).groupId, f.group);
  assert.equal((await redeem(f.member, group.code)).alreadyJoined, true);
  assert.equal((await read(`accessCodes/${group.id}`)).usedCount, 1);
  assert.equal((await read(`groups/${f.group}`)).memberCount, 1);
  assert.equal((await byEvent('memberships', f.event)).size, 1);
  const anotherGroup = randomUUID();
  await db.doc(`groups/${anotherGroup}`).set({ eventId: f.event, memberCount: 0 });
  const other = await issue(f, { groupId: anotherGroup });
  await rejects(redeem(f.member, other.code), 'already-exists');
  assert.equal((await read(`groups/${anotherGroup}`)).memberCount, 0);
});

test('invalid, expired, disabled, revoked and cross-event codes fail without granting membership', async () => {
  const f = await fixture(), result = await issue(f), ref = db.doc(`accessCodes/${result.id}`);
  const original = await read(ref.path);
  await rejects(redeem(f.member, 'bad/'), 'invalid-argument');
  let missing;
  do { missing = codes.generateCode(); } while ((await db.doc(`accessCodes/${codes.codeHash(missing)}`).get()).exists);
  await rejects(redeem(f.member, missing), 'not-found');
  for (const [patch, code] of [
    [{ expiresAt: Timestamp.fromMillis(Date.now() - 1) }, 'deadline-exceeded'],
    [{ enabled: false }, 'failed-precondition'],
    [{ revokedAt: Timestamp.now() }, 'failed-precondition'],
    [{ groupId: f.foreignGroup }, 'failed-precondition'],
    [{ scope: 'event' }, 'failed-precondition'],
  ]) {
    await ref.set({ ...original, ...patch });
    await rejects(redeem(f.member, result.code), code);
  }
  assert.equal((await byEvent('memberships', f.event)).size, 0);
  assert.equal((await read(`groups/${f.group}`)).memberCount, 0);
  assert.equal((await read(ref.path)).usedCount, 0);
});

test('new issuance leaves existing unlimited codes unchanged and redeemable beyond the new default', async () => {
  const f = await fixture(), legacy = await issue(f), ref = db.doc(`accessCodes/${legacy.id}`);
  await ref.update({ maxUses: 0, usedCount: 1001 });
  const original = await read(ref.path);
  await issue(f);
  assert.deepEqual(await read(ref.path), original);
  await redeem(f.member, legacy.code);
  const stored = await read(ref.path);
  assert.equal(stored.maxUses, 0);
  assert.equal(stored.usedCount, 1002);
  assert.equal(stored.expiresAt.toMillis(), original.expiresAt.toMillis());
});

test('a synthetic historical-repository 20-hex code remains redeemable without rewriting its hash, limit or expiry', async () => {
  const f = await fixture(), legacy = randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase();
  const id = codes.codeHash(legacy), expiresAt = Timestamp.fromMillis(Date.now() + 2 * 86400000);
  await db.doc(`accessCodes/${id}`).create({ eventId: f.event, groupId: '', scope: 'event', grantedRole: 'teamMember', enabled: true,
    maxUses: 7, usedCount: 0, expiresAt, createdBy: f.owner, createdAt: Timestamp.now() });
  const grouped = legacy.match(/.{4}/g).join('-').toLowerCase();
  assert.equal((await redeem(f.member, ` ${grouped} `)).eventId, f.event);
  assert.equal((await redeem(f.member, legacy)).alreadyJoined, true);
  const stored = await read(`accessCodes/${id}`);
  assert.equal(stored.usedCount, 1);
  assert.equal(stored.maxUses, 7);
  assert.equal(stored.expiresAt.toMillis(), expiresAt.toMillis());
  assert.equal((await byEvent('accessCodes', f.event)).size, 1);
});

test('the leader directory enforces ownership, group scope and active callers before exposing profiles', async () => {
  const f = await fixture();
  await rejects(directory(f, {}, f.other), 'permission-denied');
  await rejects(directory(f, {}, f.member), 'permission-denied');
  await rejects(call(accounts.listAssignableLeaders, undefined, { eventId: f.event, groupId: f.group }), 'unauthenticated');
  await rejects(directory(f, { groupId: f.foreignGroup }), 'invalid-argument');
  await rejects(directory(f, { cursor: '../users' }), 'invalid-argument');
  await directory(f, {}, f.admin);
  await db.doc(`users/${f.owner}`).update({ isActive: false });
  await rejects(directory(f), 'permission-denied');
  await db.doc(`groups/${f.group}`).update({ deleting: true });
  await rejects(directory(f, {}, f.admin), 'failed-precondition');
});

test('leader labels hydrate full names and current inactive/missing assignments without leaking private fields', async () => {
  const f = await fixture(), missingId = randomUUID();
  await db.doc(`users/${f.leader}`).update({ displayName: '', fullName: ' Full Name Leader ', privateNotes: 'not exposed', phoneNumber: 'not exposed' });
  await db.doc(`users/${f.backup}`).update({ isActive: false, displayName: '', fullName: 'Inactive Backup' });
  await db.doc(`groups/${f.group}`).update({ leaderUserId: f.leader, backupLeaderUserId: f.backup });
  const result = await directory(f), users = new Map(result.users.map(user => [user.id, user]));
  assert.equal(users.get(f.leader)?.displayName, 'Full Name Leader');
  assert.equal(users.get(f.leader)?.isEligible, true);
  assert.equal(users.get(f.backup)?.displayName, 'Inactive Backup');
  assert.equal(users.get(f.backup)?.isActive, false);
  assert.equal(users.get(f.backup)?.isEligible, false);
  await db.doc(`groups/${f.group}`).update({ leaderUserId: missingId });
  const missing = (await directory(f)).users.find(user => user.id === missingId);
  assert.equal(missing?.displayName, 'Team leader (profile unavailable)');
  assert.equal(missing?.profileMissing, true);
  assert.equal(missing?.isEligible, false);
  assert.equal(users.has(f.member), false);
  for (const user of result.users) {
    assert.equal('privateNotes' in user, false);
    assert.equal('phoneNumber' in user, false);
  }
  for (const leaderUserId of [f.backup, missingId]) await rejects(call(accounts.assignGroupLeader, f.owner, { groupId: f.group, leaderUserId }), 'failed-precondition');
});

test('cursor pages stay bounded while hydrating assigned leaders beyond the page and a missing backup', async () => {
  const f = await fixture(), ids = Array.from({ length: 201 }, () => randomUUID()).sort(), missingId = randomUUID();
  const batch = db.batch();
  for (const id of ids) batch.set(db.doc(`users/${id}`), { role: 'teamLeader', isActive: true, displayName: 'Paged leader' });
  batch.update(db.doc(`groups/${f.group}`), { leaderUserId: ids[200], backupLeaderUserId: missingId });
  await batch.commit();
  const first = await directory(f), current = new Set([ids[200], missingId]);
  assert.ok(first.nextCursor);
  assert.ok(first.nextCursor < ids[200], 'assigned leader must be hydrated beyond the page');
  assert.ok(first.users.length <= 202);
  for (const id of current) assert.ok(first.users.some(user => user.id === id));
  const seen = new Set(first.users.filter(user => !current.has(user.id)).map(user => user.id));
  const second = await directory(f, { cursor: first.nextCursor });
  assert.ok(second.users.length <= 202);
  assert.equal(second.users.some(user => !current.has(user.id) && seen.has(user.id)), false);
  for (const id of current) assert.ok(second.users.some(user => user.id === id));
});

test('directory query failures become actionable callable errors without exposing technical diagnostics', async t => {
  const f = await fixture(), prototype = Object.getPrototypeOf(db.collection('users').where('role', '==', 'teamLeader'));
  for (const [code, expected] of [[9, 'failed-precondition'], [14, 'unavailable']]) {
    const mocked = t.mock.method(prototype, 'get', async () => { throw Object.assign(new Error('Private database diagnostics'), { code }); });
    try {
      await assert.rejects(directory(f), error => error.code === expected && !error.message.includes('Private database diagnostics'));
    } finally { mocked.mock.restore(); }
  }
});
