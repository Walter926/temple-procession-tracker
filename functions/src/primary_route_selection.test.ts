
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { choosePrimaryRoute } from './event_management';

function route(id: string, createdMs: number): QueryDocumentSnapshot {
  return { id, createTime: Timestamp.fromMillis(createdMs), data: () => ({ eventId: 'event1', createdAt: Timestamp.fromMillis(createdMs) }) } as unknown as QueryDocumentSnapshot;
}
const first = route('first',1000), second = route('second',2000), third = route('third',3000);

test('first route automatically becomes primary', () => {
  assert.deepEqual(choosePrimaryRoute({ routeId:null },[], 'first'),{ routeId:'first',mode:'auto' });
  assert.deepEqual(choosePrimaryRoute({ routeId:null },[first]),{ routeId:'first',mode:'auto' });
});
test('newest route replaces auto-selected primary, but editing an old route does not', () => {
  assert.deepEqual(choosePrimaryRoute({ routeId:'first',primaryRouteMode:'auto' },[first], 'second'),{ routeId:'second',mode:'auto' });
  assert.deepEqual(choosePrimaryRoute({ routeId:'first',primaryRouteMode:'auto' },[first,second,third]),{ routeId:'third',mode:'auto' });
});
test('manual selection survives new route creation and automatic reconciliation', () => {
  const event = { routeId:'first',primaryRouteMode:'manual' };
  assert.deepEqual(choosePrimaryRoute(event,[first,second],'third'),{ routeId:'first',mode:'manual' });
  assert.deepEqual(choosePrimaryRoute(event,[first,second,third]),{ routeId:'first',mode:'manual' });
});
test('legacy older primary is preserved; legacy missing primary is repaired to newest', () => {
  assert.deepEqual(choosePrimaryRoute({ routeId:'first' },[first,second]),{ routeId:'first',mode:'manual' });
  assert.deepEqual(choosePrimaryRoute({ routeId:null },[first,second]),{ routeId:'second',mode:'auto' });
});
test('deleting a manually selected route falls back to newest remaining; no routes clears primary', () => {
  assert.deepEqual(choosePrimaryRoute({ routeId:'first',primaryRouteMode:'manual' },[second,third]),{ routeId:'third',mode:'auto' });
  assert.deepEqual(choosePrimaryRoute({ routeId:'first',primaryRouteMode:'manual' },[]),{ routeId:null,mode:'auto' });
});

test('creation timestamps retain nanosecond precision and ignore updatedAt', () => {
  const older = route('z-older',1000), newer = route('a-newer',1000);
  older.data = () => ({ createdAt:new Timestamp(1,100000),updatedAt:new Timestamp(9,0) });
  newer.data = () => ({ createdAt:new Timestamp(1,200000),updatedAt:new Timestamp(2,0) });
  assert.deepEqual(choosePrimaryRoute({ primaryRouteMode:'auto' },[older,newer]),{ routeId:'a-newer',mode:'auto' });
});

test('equal creation times use descending document IDs regardless of query order', () => {
  const a = route('A',1000), z = route('Z',1000), lower = route('a',1000);
  for (const routes of [[a,z,lower],[lower,z,a],[z,a,lower]]) {
    assert.deepEqual(choosePrimaryRoute({},routes),{ routeId:'a',mode:'auto' });
  }
});

test('legacy routes without createdAt use document createTime, never edit time', () => {
  const older = route('older',1000), newer = route('newer',2000);
  older.data = () => ({ updatedAt:Timestamp.fromMillis(9000) });
  newer.data = () => ({ updatedAt:Timestamp.fromMillis(3000) });
  assert.deepEqual(choosePrimaryRoute({},[older,newer]),{ routeId:'newer',mode:'auto' });
});
