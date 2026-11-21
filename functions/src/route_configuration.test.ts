import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { RouteConfigurationCache, loadRouteConfiguration, routeConfigurationVersion, type RouteConfiguration } from './route_configuration';

const config = (routeId = 'r', version = '1'): RouteConfiguration => Object.freeze({ routeId, version, eventId: 'e', stops: Object.freeze([]), segments: Object.freeze([]) });

test('route cache coalesces simultaneous requests and never caches permissions', async () => {
  const cache = new RouteConfigurationCache();
  let loads = 0;
  const load = async () => { loads++; return config(); };
  const values = await Promise.all(Array.from({ length: 50 }, () => cache.get('r', '1', load)));
  assert.equal(loads, 1);
  assert.ok(values.every(value => value === values[0]));
  assert.equal(cache.size, 1);
  assert.deepEqual(Object.keys(values[0]).sort(), ['eventId', 'routeId', 'segments', 'stops', 'version']);
});

test('route cache invalidates versions and nanosecond metadata, expires and bounds memory by LRU', async () => {
  let now = 100, loads = 0;
  const cache = new RouteConfigurationCache(2, 50, () => now);
  const read = (id: string, version = '1') => cache.get(id, version, async () => { loads++; return config(id, version); });
  await read('a'); await read('b'); await read('a'); await read('c');
  assert.equal(cache.size, 2);
  await read('b'); assert.equal(loads, 4, 'least recently used entry was evicted');
  await read('b', '2'); assert.equal(loads, 5);
  now += 51; await read('b', '2'); assert.equal(loads, 6);
  assert.notEqual(routeConfigurationVersion({ updateTime: new Timestamp(1, 1) }), routeConfigurationVersion({ updateTime: new Timestamp(1, 2) }));
  cache.clear(); assert.equal(cache.size, 0);
  assert.throws(() => new RouteConfigurationCache(0));
});

test('failed and superseded route loads cannot poison a newer cache entry', async () => {
  const cache = new RouteConfigurationCache();
  let fail!: (reason: Error) => void;
  const old = cache.get('r', '1', () => new Promise<RouteConfiguration>((_resolve, reject) => { fail = reject; }));
  await Promise.resolve();
  const fresh = await cache.get('r', '2', async () => config('r', '2'));
  fail(new Error('old load failed'));
  await assert.rejects(old, /old load failed/);
  assert.equal(await cache.get('r', '2', async () => { throw new Error('must remain warm'); }), fresh);
  await assert.rejects(cache.get('other', '1', async () => { throw new Error('failed'); }));
  assert.equal((await cache.get('other', '1', async () => config('other'))).routeId, 'other');
});

const emulator = ['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
let ownedApp: App | undefined;
after(async () => {
  if (ownedApp) { await getFirestore(ownedApp).terminate(); await deleteApp(ownedApp); }
});
test('emulator: warm GPS route configuration avoids repeated stop/segment queries and refreshes after trusted edits', { skip: !emulator }, async t => {
  if (!getApps().length) ownedApp = initializeApp({ projectId: 'demo-temple-procession' });
  const db = getFirestore(), routeId = `route-cache-${randomUUID()}`, route = db.doc(`routes/${routeId}`);
  const batch = db.batch();
  batch.set(route, { eventId: 'e' });
  for (let i = 0; i < 50; i++) batch.set(db.doc(`stopPoints/${routeId}_${i}`), { routeId, order: i + 1, latitude: 12 + i / 10000, longitude: 79, geofenceRadiusMeters: 100, maxAllowedGroups: 1 });
  for (let i = 0; i < 49; i++) batch.set(db.doc(`routeSegments/${routeId}_${i}`), { routeId, order: i + 1, startLatitude: 12, startLongitude: 79, endLatitude: 12.001, endLongitude: 79 });
  await batch.commit();
  const original = db.collection.bind(db), queries = new Map<string, number>();
  t.mock.method(db, 'collection', ((path: string) => { queries.set(path, (queries.get(path) ?? 0) + 1); return original(path); }) as typeof db.collection);
  const first = await loadRouteConfiguration(routeId);
  for (let i = 0; i < 20; i++) assert.equal(await loadRouteConfiguration(routeId), first);
  assert.equal(queries.get('stopPoints'), 1);
  assert.equal(queries.get('routeSegments'), 1);
  assert.equal(first.stops.length, 50); assert.equal(first.segments.length, 49);
  assert.ok(Object.isFrozen(first.stops)); assert.ok(Object.isFrozen(first.stops[0]));
  const edit = db.batch();
  edit.update(db.doc(`stopPoints/${routeId}_0`), { geofenceRadiusMeters: 75 });
  edit.update(route, { updatedAt: Timestamp.now() });
  await edit.commit();
  const refreshed = await loadRouteConfiguration(routeId);
  assert.notEqual(refreshed.version, first.version);
  assert.equal(refreshed.stops[0].geofenceRadiusMeters, 75);
  assert.equal(queries.get('stopPoints'), 2);
});
