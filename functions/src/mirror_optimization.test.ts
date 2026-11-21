import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mirrorFieldsChanged, mirrorPayloadHash, mirrorRotationOrder, syncAccountState, trackingDatabase } from './tracking_mirrors';

test('mirror trigger filtering ignores counters, photos and timestamps but never permission transitions', () => {
  const before = { eventId: 'e', leaderUserId: 'u', backupLeaderUserId: '', status: 'moving', memberCount: 1 };
  const fields = ['eventId', 'leaderUserId', 'backupLeaderUserId', 'deleting'];
  assert.equal(mirrorFieldsChanged(before, { ...before, memberCount: 2, status: 'delayed' }, fields), false);
  for (const patch of [{ eventId: 'other' }, { leaderUserId: 'other' }, { backupLeaderUserId: 'other' }, { deleting: true }]) {
    assert.equal(mirrorFieldsChanged(before, { ...before, ...patch }, fields), true);
  }
  assert.equal(mirrorFieldsChanged(undefined, before, fields), true);
  assert.equal(mirrorFieldsChanged(before, undefined, fields), true);
  assert.equal(mirrorPayloadHash({ role: 'teamLeader', isActive: true }), mirrorPayloadHash({ isActive: true, role: 'teamLeader' }));
  assert.notEqual(mirrorPayloadHash({ isActive: true }), mirrorPayloadHash({ isActive: false }));
});

test('mirror reconciliation rotates collection priority so a time budget cannot starve later sources', () => {
  assert.deepEqual(mirrorRotationOrder(0), ['users', 'events', 'groups', 'memberships', 'mirrorRevisions']);
  assert.equal(mirrorRotationOrder(3)[0], 'memberships');
  assert.equal(mirrorRotationOrder(4)[0], 'mirrorRevisions');
  assert.equal(mirrorRotationOrder(5)[0], 'users');
  assert.equal(new Set(mirrorRotationOrder(2)).size, 5);
});

const emulator = ['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '') &&
  ['127.0.0.1:9000', 'localhost:9000'].includes(process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '');
let ownedApp: App | undefined;
after(async () => {
  if (ownedApp) { await getFirestore(ownedApp).terminate(); await deleteApp(ownedApp); }
});
test('emulator: unchanged mirrors reuse revisions but retry a missing RTDB write; revocation still increments', { skip: !emulator }, async () => {
  if (!getApps().length) ownedApp = initializeApp({ projectId: 'demo-temple-procession' });
  const uid = `mirror-cache-${randomUUID()}`, ref = getFirestore().doc(`users/${uid}`);
  await ref.set({ isActive: true, role: 'teamLeader', assignedGroupId: 'g' });
  await syncAccountState(uid);
  const remote = trackingDatabase().ref(`accountStates/${uid}`), first = (await remote.get()).val();
  await syncAccountState(uid);
  assert.equal((await remote.get()).val().revision, first.revision);
  await remote.remove();
  await syncAccountState(uid);
  assert.equal((await remote.get()).val().revision, first.revision, 'a failed RTDB application is safely replayed without allocating again');
  await ref.update({ isActive: false });
  await syncAccountState(uid);
  const revoked = (await remote.get()).val();
  assert.equal(revoked.isActive, false); assert.ok(revoked.revision > first.revision);
});
