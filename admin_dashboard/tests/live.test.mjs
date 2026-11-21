import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeLiveEvent } from '../src/lib/live_data.ts';

function stream(eventId = 'a') {
  const sources = new Map(), snapshots = [], frames = new Set(), stopped = [];
  const dispose = subscribeLiveEvent(eventId, (path, upsert, remove, failed) => {
    sources.set(path, { upsert, remove, failed }); return () => stopped.push(path);
  }, snapshot => snapshots.push(snapshot), publish => { frames.add(publish); return () => frames.delete(publish); });
  return { sources, snapshots, frames, stopped, dispose, branch: name => sources.get(`${name}/${eventId}`),
    flush: () => { const pending = [...frames]; frames.clear(); pending.forEach(publish => publish()); } };
}
const point = (i = 0) => ({ latitude: 49 + i / 100000, longitude: -123, recordedAt: 1000, accuracyMeters: 5 });

test('child events batch initial trees and parse only the changed child, retaining unchanged object references', () => {
  const s = stream();
  let parsed = 0;
  const raw = i => ({ ...point(i), get accuracyMeters() { parsed++; return 5; } });
  for (let i = 0; i < 500; i++) s.branch('liveLocations').upsert(`group-${i}`, raw(i));
  s.branch('trackingStatus').upsert('group-0', { state: 'active', userId: 'leader', updatedAt: 1000 });
  s.branch('activeCollisionAlerts').upsert('incident', { stopPointId: 'stop', severity: 'high', affectedGroupIds: ['group-0'] });
  assert.equal(s.frames.size, 1);
  assert.equal(s.snapshots.length, 0);
  s.flush();
  assert.equal(s.snapshots.length, 1);
  const previous = s.snapshots[0], before = parsed;
  s.branch('liveLocations').upsert('group-0', { ...raw(1), recordedAt: 2000 });
  s.flush();
  const current = s.snapshots.at(-1);
  assert.equal(parsed - before, 1);
  assert.equal(Object.keys(current.live).length, 500);
  assert.notEqual(current.live['group-0'], previous.live['group-0']);
  assert.equal(current.live['group-499'], previous.live['group-499']);
  assert.equal(current.tracking, previous.tracking);
  assert.equal(current.collisions, previous.collisions);
  assert.equal(previous.live['group-0'].recordedAt, 1000);
  s.dispose();
});

test('identical child changes do not trigger renders; independent collisions with the same stop remain keyed', () => {
  const s = stream();
  const location = point(), tracking = { state: 'active', userId: 'leader', updatedAt: 1000 };
  const collision = { stopPointId: 'stop', severity: 'high', affectedGroupIds: ['g'] };
  s.branch('liveLocations').upsert('g', location);
  s.branch('trackingStatus').upsert('g', tracking);
  s.branch('activeCollisionAlerts').upsert('incident-a', collision);
  s.branch('activeCollisionAlerts').upsert('incident-b', collision);
  s.flush();
  s.branch('liveLocations').upsert('g', { ...location });
  s.branch('trackingStatus').upsert('g', { ...tracking });
  s.branch('activeCollisionAlerts').upsert('incident-a', { ...collision, affectedGroupIds: ['g'] });
  assert.equal(s.frames.size, 0);
  s.branch('activeCollisionAlerts').remove('incident-a'); s.flush();
  assert.equal(s.snapshots.at(-1).collisions.length, 1);
  s.dispose();
});

test('child removal and malformed replacement clear only the affected records', () => {
  const s = stream();
  const branch = s.branch('liveLocations');
  branch.upsert('a', point()); branch.upsert('b', point(1)); s.flush();
  for (const raw of [null, [], 2, { ...point(), latitude: null }, { ...point(), longitude: Infinity }, { ...point(), recordedAt: '1000' }]) {
    branch.upsert('a', point()); s.flush();
    branch.upsert('a', raw); s.flush();
    assert.equal(s.snapshots.at(-1).live.a, undefined);
    assert.ok(s.snapshots.at(-1).live.b);
  }
  branch.remove('b'); s.flush();
  assert.deepEqual(s.snapshots.at(-1).live, {});
  s.branch('trackingStatus').upsert('bad', { state: 'active', updatedAt: NaN });
  s.branch('activeCollisionAlerts').upsert('bad', { stopPointId: 'stop', affectedGroupIds: [2], severity: 'high' });
  assert.equal(s.frames.size, 0);
  s.dispose();
});

test('event cleanup cancels pending publications, unsubscribes every tree and ignores late callbacks', () => {
  const old = stream('old');
  old.branch('liveLocations').upsert('g', point());
  assert.equal(old.frames.size, 1);
  old.dispose(); old.flush(); old.branch('liveLocations').upsert('late', point());
  old.branch('trackingStatus').failed(Error('late failure'));
  assert.equal(old.snapshots.length, 0);
  assert.equal(old.stopped.length, 3);
  const next = stream('new');
  next.branch('liveLocations').upsert('new-group', point()); next.flush();
  assert.deepEqual(Object.keys(next.snapshots[0].live), ['new-group']);
  assert.equal(next.snapshots[0].eventId, 'new');
  next.dispose();
});

test('permission cancellation clears data and prevents other branches from publishing stale state', () => {
  const s = stream();
  s.branch('liveLocations').upsert('g', point()); s.flush();
  s.branch('liveLocations').upsert('g', { ...point(), recordedAt: 2000 });
  s.branch('trackingStatus').failed(Error('Permission denied'));
  s.flush(); s.branch('activeCollisionAlerts').upsert('late', { stopPointId: 's', severity: 'high', affectedGroupIds: ['g'] });
  assert.equal(s.snapshots.length, 2);
  assert.deepEqual(s.snapshots.at(-1).live, {});
  assert.deepEqual(s.snapshots.at(-1).tracking, {});
  assert.deepEqual(s.snapshots.at(-1).collisions, []);
  assert.match(s.snapshots.at(-1).error, /Permission/);
  s.dispose();
});
