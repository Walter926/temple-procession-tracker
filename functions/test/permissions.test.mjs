import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, orderBy, documentId, limit, Timestamp } from 'firebase/firestore';

let environment;
const projectId = 'demo-temple-procession';
const profile = (role, extra = {}) => ({ email: `${role}@example.test`, displayName: role, role, isActive: true, createdAt: Timestamp.now(), ...extra });
const event = (organizerId, extra = {}) => ({ organizerId, name: 'Test procession', description: '', mainTempleName: 'Temple', cityRegion: 'Test city', status: 'active', isPublic: false, routeId: 'route-a', startTime: Timestamp.now(), endTime: null, createdAt: Timestamp.now(), ...extra });
const client = (uid) => environment.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();

before(async () => {
  for (const [name, port] of [['FIRESTORE_EMULATOR_HOST', 8080], ['FIREBASE_DATABASE_EMULATOR_HOST', 9000]]) {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(process.env[name])) throw new Error(`Run npm run test:rules: ${name} must point to the local demo emulator.`);
  }
  if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) throw new Error('Refusing to clear a non-demo project.');
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../../firebase_rules/firestore.rules', import.meta.url), 'utf8') },
    database: { rules: await readFile(new URL('../../firebase_rules/database.rules.json', import.meta.url), 'utf8') },
  });
  await environment.clearFirestore();
  await environment.clearDatabase();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const fixtures = {
      'users/admin': profile('admin'),
      'users/owner': profile('organizer'),
      'users/other': profile('organizer'),
      'users/leader': profile('teamLeader', { assignedGroupId: 'group-a' }),
      'users/unassigned': profile('teamLeader'),
      'users/member': profile('teamMember', { joinedEventId: 'event-a', joinedGroupId: 'group-a' }),
      'users/inactive': profile('organizer', { isActive: false }),
      'events/event-a': event('owner'),
      'events/event-b': event('other', { routeId: 'route-b' }),
      'events/public': event('other', { routeId: 'route-public', isPublic: true, status: 'scheduled' }),
      'publicEvents/public': { name: 'Public procession', cityRegion: 'City', mainTempleName: 'Temple', startTime: Timestamp.now(), status: 'scheduled', routeId: 'route-public', isPublic: true },
      'routes/route-a': { eventId: 'event-a', name: 'Private route', color: '#334455', encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', totalDistanceMeters: 1000, stopPointIds: ['stop-a'], segmentIds: [] },
      'routes/route-b': { eventId: 'event-b', name: 'Other route' },
      'routes/route-public': { eventId: 'public', name: 'Published route' },
      'stopPoints/stop-a': { routeId: 'route-a', eventId: 'event-a', name: 'First stop', latitude: 49, longitude: -123, order: 1 },
      'groups/group-a': { eventId: 'event-a', routeId: 'route-a', leaderUserId: 'leader', backupLeaderUserId: '', memberCount: 1, status: 'moving' },
      'memberships/event-a_member': { uid: 'member', eventId: 'event-a', groupId: 'group-a', membershipRole: 'teamMember', status: 'active', isActive: true },
      'notifications/member-notice': { uid: 'member', eventId: 'event-a', state: 'active' },
      'accessCodes/code-a': { eventId: 'event-a', groupId: 'group-a', createdBy: 'owner', enabled: true },
    };
    for (const [path, data] of Object.entries(fixtures)) await setDoc(doc(db, path), data);
    await context.database().ref().set({
      accountStates: {
        admin: { isActive: true, role: 'admin' },
        owner: { isActive: true, role: 'organizer' },
        other: { isActive: true, role: 'organizer' },
        leader: { isActive: true, role: 'teamLeader', assignedGroupId: 'group-a' },
        unassigned: { isActive: true, role: 'teamLeader', assignedGroupId: '' },
        member: { isActive: true, role: 'teamMember' },
      },
      eventStates: {
        'event-a': { organizerId: 'owner', status: 'active', isPublic: false },
        'event-b': { organizerId: 'other', status: 'active', isPublic: false },
        public: { organizerId: 'other', status: 'scheduled', isPublic: true },
      },
      eventAccess: { 'event-a': { member: { allowed: true }, leader: { allowed: true } } },
      trackingAssignments: { 'group-a': { eventId: 'event-a', leaderUserId: 'leader', backupLeaderUserId: '' } },
      liveLocations: { 'event-a': { 'group-a': { userId: 'leader', latitude: 49, longitude: -123, accuracyMeters: 5, speedMetersPerSecond: 1, headingDegrees: 90, recordedAt: Date.now() - 1000 } } },
    });
  });
});

after(async () => { await environment?.cleanup(); });

test('admin has global private event access', async () => {
  await assertSucceeds(getDoc(doc(client('admin'), 'events/event-a')));
  await assertSucceeds(getDoc(doc(client('admin'), 'events/event-b')));
});

test('organizer reads own private event but not another organizer event or route', async () => {
  await assertSucceeds(getDoc(doc(client('owner'), 'events/event-a')));
  await assertFails(getDoc(doc(client('owner'), 'events/event-b')));
  await assertFails(getDoc(doc(client('owner'), 'routes/route-b')));
});

test('organizer event list is server filtered by ownership', async () => {
  await assertSucceeds(getDocs(query(collection(client('owner'), 'events'), where('organizerId', '==', 'owner'))));
  await assertFails(getDocs(collection(client('owner'), 'events')));
});

test('active member can read joined private event and own membership only', async () => {
  await assertSucceeds(getDoc(doc(client('member'), 'events/event-a')));
  await assertSucceeds(getDoc(doc(client('member'), 'memberships/event-a_member')));
  await assertFails(getDoc(doc(client('unassigned'), 'memberships/event-a_member')));
  await assertFails(getDoc(doc(client('member'), 'events/event-b')));
});

test('leader registration alone does not grant private event access', async () => {
  await assertSucceeds(getDoc(doc(client('leader'), 'events/event-a')));
  await assertFails(getDoc(doc(client('unassigned'), 'events/event-a')));
});

test('code history admits admins, owning organizers and assigned primary leaders only, including index-free group pages', async () => {
  for (const uid of ['admin', 'owner']) await assertSucceeds(getDocs(query(collection(client(uid), 'accessCodes'), where('eventId', '==', 'event-a'), orderBy(documentId()), limit(200))));
  await assertSucceeds(getDoc(doc(client('leader'), 'groups/group-a')));
  await assertSucceeds(getDocs(query(collection(client('leader'), 'accessCodes'), where('groupId', '==', 'group-a'), orderBy(documentId()), limit(200))));
  await assertFails(getDocs(query(collection(client('leader'), 'accessCodes'), where('eventId', '==', 'event-a'))));
  for (const uid of ['other', 'unassigned', 'member', 'inactive']) await assertFails(getDocs(query(collection(client(uid), 'accessCodes'), where('groupId', '==', 'group-a'), orderBy(documentId()), limit(200))));
  await assertFails(setDoc(doc(client('leader'), 'accessCodes/forged-leader'), { eventId: 'event-a', groupId: 'group-a', grantedRole: 'teamMember' }));
});

test('inactive account cannot access private events even with organizer role', async () => {
  await assertFails(getDoc(doc(client('inactive'), 'events/event-a')));
});

test('visitor sees published projection and route but no private event', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'publicEvents/public')));
  await assertSucceeds(getDoc(doc(db, 'routes/route-public')));
  await assertFails(getDoc(doc(db, 'events/event-a')));
  await assertFails(getDoc(doc(db, 'routes/route-a')));
});

for (const role of ['organizer', 'teamLeader', 'teamMember']) {
  test(`registration accepts ${role} without assignment fields`, async () => {
    const uid = `register-${role}`;
    await assertSucceeds(setDoc(doc(client(uid), `users/${uid}`), profile(role, { email: `${uid}@example.test`, photoUrl: null, phoneNumber: null, updatedAt: null })));
  });
}

test('registration rejects admin role and forged publishing or membership assignments', async () => {
  for (const [index, fields] of [{ role: 'admin' }, { assignedGroupId: 'group-a' }, { joinedEventId: 'event-a' }, { joinedGroupId: 'group-a' }, { unexpectedPermission: true }].entries()) {
    const uid = `forged-${index}`;
    await assertFails(setDoc(doc(client(uid), `users/${uid}`), profile('teamLeader', { email: `${uid}@example.test`, ...fields })));
  }
});

test('profile edits cannot self-promote or set membership pointers', async () => {
  await assertFails(updateDoc(doc(client('member'), 'users/member'), { role: 'admin' }));
  await assertFails(updateDoc(doc(client('member'), 'users/member'), { assignedGroupId: 'group-a' }));
  await assertFails(updateDoc(doc(client('member'), 'users/member'), { joinedEventId: 'event-b' }));
});

test('notification reads are recipient-scoped and writes are server-only', async () => {
  await assertSucceeds(getDoc(doc(client('member'), 'notifications/member-notice')));
  await assertFails(getDoc(doc(client('unassigned'), 'notifications/member-notice')));
  await assertFails(updateDoc(doc(client('member'), 'notifications/member-notice'), { readAt: Timestamp.now() }));
});

test('access codes and membership counts cannot be forged by a client', async () => {
  await assertFails(setDoc(doc(client('member'), 'accessCodes/forged'), { eventId: 'event-a' }));
  await assertFails(setDoc(doc(client('member'), 'memberships/event-b_member'), { uid: 'member', eventId: 'event-b' }));
  await assertFails(updateDoc(doc(client('owner'), 'groups/group-a'), { memberCount: 100 }));
});

test('event activation and public publication must use trusted backend validation', async () => {
  await assertFails(updateDoc(doc(client('owner'), 'events/event-a'), { status: 'active', routeId: 'route-b' }));
  await assertFails(setDoc(doc(client('owner'), 'publicEvents/event-a'), { ...event('owner'), isPublic: true }));
});

const realtime = (uid) => environment.authenticatedContext(uid).database();
const sample = (extra = {}) => ({ userId: 'leader', latitude: 49, longitude: -123, accuracyMeters: 5, speedMetersPerSecond: 1, headingDegrees: 90, recordedAt: Date.now(), ...extra });

test('RTDB private live map reads are restricted to owner, admin, assigned leader, or member', async () => {
  for (const uid of ['admin', 'owner', 'leader', 'member']) await assertSucceeds(realtime(uid).ref('liveLocations/event-a').get());
  for (const uid of ['other', 'unassigned']) await assertFails(realtime(uid).ref('liveLocations/event-a').get());
  await assertFails(environment.unauthenticatedContext().database().ref('liveLocations/event-a').get());
  await assertFails(realtime('admin').ref('liveLocations').get());
});

test('only the active assigned primary leader publishes GPS, not organizers, members, or a leader role alone', async () => {
  for (const uid of ['admin', 'owner', 'member', 'unassigned']) await assertFails(realtime(uid).ref('liveLocations/event-a/group-a').set(sample({ userId: uid })));
  await assertSucceeds(realtime('leader').ref('liveLocations/event-a/group-a').set(sample()));
});

test('RTDB rejects stale, future, inaccurate, invalid, and replayed GPS readings', async () => {
  const ref = realtime('leader').ref('liveLocations/event-a/group-a');
  for (const extra of [{ recordedAt: Date.now() - 120000 }, { recordedAt: Date.now() + 120000 }, { accuracyMeters: 200 }, { latitude: 100 }, { speedMetersPerSecond: -1 }, { headingDegrees: 500 }, { unexpectedField: true }]) {
    await assertFails(ref.set(sample(extra)));
  }
  const current = (await ref.get()).val();
  await assertFails(ref.set(current));
});

test('RTDB active/paused/error heartbeat writes require the same current leader capability', async () => {
  const ref = realtime('leader').ref('trackingStatus/event-a/group-a');
  for (const state of ['active', 'paused', 'error', 'stopped']) await assertSucceeds(ref.set({ userId: 'leader', state, updatedAt: Date.now() }));
  await assertFails(realtime('owner').ref('trackingStatus/event-a/group-a').set({ userId: 'owner', state: 'active', updatedAt: Date.now() }));
  await assertFails(ref.set({ userId: 'leader', state: 'invented', updatedAt: Date.now() }));
});

test('deactivation immediately revokes live reads and publishing with an existing authenticated session', async () => {
  await environment.withSecurityRulesDisabled(async context => { await context.database().ref('accountStates/leader/isActive').set(false); });
  try {
    await assertFails(realtime('leader').ref('liveLocations/event-a').get());
    await assertFails(realtime('leader').ref('liveLocations/event-a/group-a').set(sample()));
    await assertFails(realtime('leader').ref('trackingStatus/event-a/group-a').set({ userId: 'leader', state: 'active', updatedAt: Date.now() }));
  } finally {
    await environment.withSecurityRulesDisabled(async context => { await context.database().ref('accountStates/leader/isActive').set(true); });
  }
});

test('clients cannot forge account, event, or publishing authorization mirrors', async () => {
  for (const path of ['accountStates/leader', 'eventStates/event-a', 'trackingAssignments/group-a', 'eventAccess/event-a/leader']) {
    await assertFails(realtime('leader').ref(path).set({ isActive: true, role: 'admin', allowed: true }));
  }
});
