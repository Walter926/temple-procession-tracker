import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { canClaimDelivery, retryDelayMs, isInvalidToken, sendAnnouncement, processAnnouncementFanout, registerDeviceToken, unregisterDeviceToken, deliverNotification } from './notifications';

test('delivery leases fence concurrent attempts and crash recovery observes backoff and limits', () => {
  const now = Date.now(), due = Timestamp.fromMillis(now - 1), later = Timestamp.fromMillis(now + 1000);
  assert.equal(canClaimDelivery({ state: 'pending', attempts: 0, nextAttemptAt: due }, now), true);
  assert.equal(canClaimDelivery({ state: 'retry', attempts: 1, nextAttemptAt: later }, now), false);
  assert.equal(canClaimDelivery({ state: 'delivering', attempts: 1, nextAttemptAt: due, leaseUntil: later }, now), false);
  assert.equal(canClaimDelivery({ state: 'delivering', attempts: 1, nextAttemptAt: due, leaseUntil: due }, now), true);
  assert.equal(canClaimDelivery({ state: 'retry', attempts: 8, nextAttemptAt: due }, now), false);
  assert.equal(canClaimDelivery({ state: 'delivered', attempts: 1, nextAttemptAt: due }, now), false);
  assert.equal(retryDelayMs(1), 30000);
  assert.equal(retryDelayMs(2), 60000);
  assert.equal(retryDelayMs(100), 3600000);
});

test('only explicitly invalid FCM token errors permit deleting a device token', () => {
  assert.equal(isInvalidToken('messaging/registration-token-not-registered'), true);
  assert.equal(isInvalidToken('messaging/invalid-registration-token'), true);
  assert.equal(isInvalidToken('messaging/invalid-argument'), false);
  assert.equal(isInvalidToken('messaging/server-unavailable'), false);
  assert.equal(isInvalidToken('messaging/invalid-apns-credentials'), false);
});

const emulator = ['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
function emulatorDb() {
  if (!getApps().length) initializeApp({ projectId: 'demo-temple-procession' });
  return getFirestore();
}
const request = (uid: string, data: Record<string, unknown>) => ({ auth: { uid }, data }) as unknown as Parameters<typeof sendAnnouncement.run>[0];

test('emulator: private event fan-out pages beyond 100 members, includes backup leaders and excludes profile-forged joins', { skip: !emulator, timeout: 60000 }, async () => {
  const db = emulatorDb(), id = `fanout-${randomUUID()}`, eventId = `${id}-event`, groupId = `${id}-group`, owner = `${id}-owner`, leader = `${id}-leader`, backup = `${id}-backup`;
  const batch = db.batch();
  batch.set(db.doc(`users/${owner}`), { role: 'organizer', isActive: true });
  batch.set(db.doc(`users/${leader}`), { role: 'teamLeader', isActive: true, assignedGroupId: groupId });
  batch.set(db.doc(`users/${backup}`), { role: 'teamLeader', isActive: true, assignedGroupId: groupId });
  batch.set(db.doc(`events/${eventId}`), { organizerId: owner, isPublic: false, status: 'active' });
  batch.set(db.doc(`groups/${groupId}`), { eventId, leaderUserId: leader, backupLeaderUserId: backup });
  batch.set(db.doc(`users/${id}-unrelated`), { role: 'teamMember', isActive: true, joinedEventId: eventId, joinedGroupId: groupId });
  for (let i = 0; i < 105; i++) {
    const uid = `${id}-member-${i.toString().padStart(3, '0')}`;
    batch.set(db.doc(`users/${uid}`), { role: 'teamMember', isActive: true });
    batch.set(db.doc(`memberships/${eventId}_${uid}`), { uid, eventId, groupId: '' });
  }
  await batch.commit();
  const data = { eventId, audience: 'event', message: 'Private event instructions', requestId: 'same-request' };
  const result = await sendAnnouncement.run(request(owner, data));
  const repeated = await sendAnnouncement.run(request(owner, data));
  assert.equal(result.id, result.announcementId);
  assert.equal(repeated.id, result.id);
  for (let i = 0; i < 5; i++) await processAnnouncementFanout(result.id);
  const notices = await db.collection('notifications').where('eventId', '==', eventId).get();
  assert.equal(notices.size, 107);
  assert.ok(notices.docs.some(doc => doc.data().uid === backup));
  assert.ok(!notices.docs.some(doc => doc.data().uid === `${id}-unrelated`));
  assert.equal((await db.doc(`publicAnnouncements/${result.id}`).get()).exists, false);
  assert.equal((await db.doc(`notificationFanouts/${result.id}`).get()).data()!.state, 'completed');
});

test('emulator: token refresh/account switching removes former device owner and stale logout cannot unregister the new account', { skip: !emulator }, async () => {
  const db = emulatorDb(), id = `device-${randomUUID()}`, first = `${id}-first`, second = `${id}-second`;
  await Promise.all([db.doc(`users/${first}`).set({ isActive: true }), db.doc(`users/${second}`).set({ isActive: true })]);
  const firstToken = `${id}-old-push-token`, secondToken = `${id}-new-push-token`;
  const a = await registerDeviceToken.run(request(first, { token: firstToken, deviceId: id, platform: 'android' }));
  const b = await registerDeviceToken.run(request(second, { token: secondToken, deviceId: id, platform: 'android' }));
  assert.equal((await db.doc(`deviceTokens/${a.id}`).get()).exists, false);
  await unregisterDeviceToken.run(request(first, { token: firstToken }));
  assert.equal((await db.doc(`deviceTokens/${b.id}`).get()).data()!.uid, second);
});

test('emulator: invalid FCM token is removed but persisted in-app notice survives', { skip: !emulator }, async t => {
  const db = emulatorDb(), id = `invalid-${randomUUID()}`, eventId = `${id}-event`, groupId = `${id}-group`, uid = `${id}-leader`, owner = `${id}-owner`;
  const batch = db.batch();
  batch.set(db.doc(`users/${uid}`), { role: 'teamLeader', isActive: true, assignedGroupId: groupId });
  batch.set(db.doc(`users/${owner}`), { role: 'organizer', isActive: true });
  batch.set(db.doc(`events/${eventId}`), { organizerId: owner, status: 'active', isPublic: false });
  batch.set(db.doc(`groups/${groupId}`), { eventId, leaderUserId: uid });
  await batch.commit();
  const device = await registerDeviceToken.run(request(uid, { token: `${id}-fake-push-token`, deviceId: id, platform: 'android' }));
  const announcement = await sendAnnouncement.run(request(owner, { eventId, audience: 'event', message: 'Private message' }));
  await processAnnouncementFanout(announcement.id);
  await processAnnouncementFanout(announcement.id);
  const notice = (await db.collection('notifications').where('eventId', '==', eventId).get()).docs[0];
  t.mock.method(getMessaging(), 'send', async () => { throw Object.assign(new Error('Invalid test token'), { code: 'messaging/registration-token-not-registered' }); });
  await deliverNotification(notice.id);
  assert.equal((await db.doc(`deviceTokens/${device.id}`).get()).exists, false);
  assert.equal((await notice.ref.get()).exists, true);
  assert.equal((await db.doc(`notificationDeliveries/${notice.id}`).get()).data()!.state, 'no-device');
});
