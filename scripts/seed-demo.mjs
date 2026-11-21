import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
for (const [name, port] of [['FIRESTORE_EMULATOR_HOST', 8080], ['FIREBASE_AUTH_EMULATOR_HOST', 9099], ['FIREBASE_DATABASE_EMULATOR_HOST', 9000]]) {
  if (process.env[name] !== `127.0.0.1:${port}`) throw new Error(`Demo seeding requires ${name}=127.0.0.1:${port}; production is never supported.`);
}
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== 'demo-temple-procession') throw new Error('Refusing non-demo project.');
process.env.GCLOUD_PROJECT = 'demo-temple-procession';
process.env.RTDB_URL = 'http://127.0.0.1:9000?ns=demo-temple-procession-default-rtdb';
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getDatabaseWithUrl } = require('firebase-admin/database');
const app = initializeApp({ projectId: 'demo-temple-procession', databaseURL: process.env.RTDB_URL });
const db = getFirestore(), auth = getAuth(), database = getDatabaseWithUrl(process.env.RTDB_URL, app);
const { manageEvent } = require('../functions/lib/event_management.js');
const { assignGroupLeader } = require('../functions/lib/account_management.js');
const { syncAccountState } = require('../functions/lib/tracking_mirrors.js');
const { recountCollisions } = require('../functions/lib/collision_detection.js');
const { generateIncidentSuggestions } = require('../functions/lib/route_suggestions.js');
const call = (handler, data) => handler.run({ auth: { uid: 'demo-owner' }, data });
try {
  for (const [uid, role, displayName] of [
    ['demo-admin', 'admin', 'Demo Administrator'], ['demo-owner', 'organizer', 'Temple Organizer'],
    ['demo-leader-a', 'teamLeader', 'North Group Leader'], ['demo-leader-b', 'teamLeader', 'South Group Leader'],
  ]) {
    try { await auth.getUser(uid); } catch { await auth.createUser({ uid }); }
    await auth.updateUser(uid, { email: `${uid}@example.test`, password: 'EmulatorOnly!2026', displayName, disabled: false });
    await db.doc(`users/${uid}`).set({ email: `${uid}@example.test`, displayName, role, isActive: true,
      assignedGroupId: '', joinedEventId: '', joinedGroupId: '', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await syncAccountState(uid);
  }
  async function save(resource, id, data) {
    const collection = { event: 'events', route: 'routes', stop: 'stopPoints', group: 'groups' }[resource];
    const exists = (await db.doc(`${collection}/${id}`).get()).exists;
    return call(manageEvent, { operation: exists ? 'update' : 'create', resource, id, eventId: resource === 'event' && !exists ? '' : 'demo-festival', data });
  }
  await save('event', 'demo-festival', { name: 'Temple Lantern Procession · Demo', description: 'Local emulator demonstration. Two procession groups share a temple stop.', mainTempleName: 'Temple of Peace', cityRegion: 'Demo district', startTimeMs: Date.now() + 3600000, endTimeMs: null, status: 'draft', isPublic: true });
  await save('route', 'demo-route', { name: 'Temple approach', description: 'Short demonstration route', color: '#51697d', encodedPolyline: '_p~iF~ps|UcB?', estimatedDurationMinutes: 15 });
  for (const [id, name, latitude, order] of [['demo-stop-a', 'Temple gate', 38.5, 1], ['demo-stop-b', 'Lantern courtyard', 38.5005, 2]]) {
    await save('stop', id, { routeId: 'demo-route', name, description: '', type: 'temple', latitude, longitude: -120.2, order,
      plannedStopMinutes: 2, geofenceRadiusMeters: 20, maxAllowedGroups: 1, expectedArrivalTimeMs: null, expectedDepartureTimeMs: null });
  }
  for (const [suffix, name, color] of [['a', 'North procession', '#51697d'], ['b', 'South procession', '#a17c3d']]) {
    const groupId = `demo-group-${suffix}`;
    await save('group', groupId, { name, color, routeId: 'demo-route', startingStopPointId: 'demo-stop-a', endingStopPointId: 'demo-stop-b', status: 'waiting' });
    await call(assignGroupLeader, { groupId, leaderUserId: `demo-leader-${suffix}`, backupLeaderUserId: '' });
  }
  await save('event', 'demo-festival', { routeId: 'demo-route', status: 'active' });
  for (const suffix of ['a', 'b']) {
    await database.ref(`liveLocations/demo-festival/demo-group-${suffix}`).set({ userId: `demo-leader-${suffix}`, latitude: 38.5, longitude: -120.2,
      accuracyMeters: 5, speedMetersPerSecond: 0, headingDegrees: 0, recordedAt: Date.now() });
    await database.ref(`trackingStatus/demo-festival/demo-group-${suffix}`).set({ userId: `demo-leader-${suffix}`, state: 'active', updatedAt: Date.now() });
  }
  await recountCollisions('demo-festival');
  const alerts = await db.collection('collisionAlerts').where('eventId', '==', 'demo-festival').get();
  for (const alert of alerts.docs) await generateIncidentSuggestions(alert.id);
  console.log('Demo fixtures ready. Organizer: demo-owner@example.test; administrator: demo-admin@example.test; password: EmulatorOnly!2026. These accounts exist only in the local demo emulators.');
} finally { await db.terminate(); await deleteApp(app); }
