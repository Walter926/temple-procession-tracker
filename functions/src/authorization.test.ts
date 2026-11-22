import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { assertActiveUser, assertEventManager, assertPrimaryLeader, documentId } from './authorization';
import { CODE_LIFETIME_MS, generateCode, normalizeCode, validateCode } from './access_codes';
import { nextMemberCount } from './memberships';
import { acceptMirrorRevision } from './tracking_mirrors';
import { decodeRoute, publicProjection, validateEventGraph } from './event_management';

test('ownership requires active profiles and an explicit owning organizer; admins retain global management', () => {
  assert.throws(() => assertActiveUser({ role:'admin',isActive:false }));
  assert.throws(() => assertActiveUser({ role:'admin',isActive:true,deleting:true }));
  assert.throws(() => assertEventManager({role:'organizer',isActive:true},'other',{organizerId:'owner'}));
  assert.doesNotThrow(() => assertEventManager({role:'organizer',isActive:true},'owner',{organizerId:'owner'}));
  assert.doesNotThrow(() => assertEventManager({role:'admin',isActive:true},'admin',{organizerId:'owner'}));
  assert.throws(() => assertEventManager({role:'organizer',isActive:true},'owner',{organizerId:'owner',deleting:true}));
});
test('leader registration, backup assignment, and forged profile pointers do not confer primary capabilities', () => {
  const group={leaderUserId:'primary',backupLeaderUserId:'backup'};
  assert.throws(() => assertPrimaryLeader({role:'teamLeader',isActive:true},'primary','group',group));
  assert.throws(() => assertPrimaryLeader({role:'teamLeader',isActive:true,assignedGroupId:'group'},'backup','group',group));
  assert.doesNotThrow(() => assertPrimaryLeader({role:'teamLeader',isActive:true,assignedGroupId:'group'},'primary','group',group));
});
test('document IDs reject path and RTDB metacharacters and control characters without altering valid IDs', () => {
  for(const id of ['', '../users/a', 'a#b','a.b','a[b','a\n']) assert.throws(()=>documentId(id));
  assert.equal(documentId('event-A_1'),'event-A_1');
});
test('new codes are six unbiased digits with a fixed 24h lifetime; redemption retains legacy input', () => {
  for(let i=0;i<100;i++) assert.match(generateCode(),/^[0-9]{6}$/);
  assert.equal(CODE_LIFETIME_MS,86_400_000);
  assert.equal(normalizeCode(' 000123 '),'000123');
  assert.equal(normalizeCode(' ab12cd '),'AB12CD');
  for(const code of ['AB-CD1','ABCDEF0','ABC/12',123456]) assert.throws(()=>normalizeCode(code));
});
test('code status/expiry/schema validation never treats an existing membership as a validity exemption', () => {
  const now=Date.now(),code={enabled:true,scope:'group',groupId:'g',grantedRole:'teamMember',expiresAt:Timestamp.fromMillis(now+1),maxUses:0,usedCount:100000};
  assert.doesNotThrow(()=>validateCode(code,now));
  for(const patch of [{enabled:false},{revokedAt:Timestamp.now()},{expiresAt:Timestamp.fromMillis(now)},{expiresAt:now+1},{scope:'event'},{grantedRole:'admin'},{maxUses:1,usedCount:1}]) {
    assert.throws(()=>validateCode({...code,...patch},now));
  }
});
test('membership deltas reject corrupt counts and underflow instead of hiding inconsistent state', () => {
  assert.equal(nextMemberCount(1,-1),0);assert.equal(nextMemberCount(0,1),1);
  for(const count of [-1,0.5,NaN]) assert.throws(()=>nextMemberCount(count,1));
  assert.throws(()=>nextMemberCount(0,-1));
});
test('revision gates ignore duplicate and out-of-order assignment/account mirrors, including tombstones', () => {
  assert.equal(acceptMirrorRevision({revision:8,isActive:false},{revision:7,isActive:true}),undefined);
  assert.equal(acceptMirrorRevision({revision:8},{revision:8}),undefined);
  assert.deepEqual(acceptMirrorRevision({revision:8},{revision:9,isActive:false}),{revision:9,isActive:false});
});
test('route decoder preserves legacy geometry and bounds truncated or oversized coordinate encodings', () => {
  const points=decodeRoute('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(points.length,3);assert.deepEqual(points[0],{latitude:38.5,longitude:-120.2});
  for(const encoded of ['','_p~iF','~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~','??']) assert.throws(()=>decodeRoute(encoded));
});
test('publication excludes private events, closed/paused states and missing routes; contacts never leak', () => {
  const event={name:'Temple',cityRegion:'City',mainTempleName:'Temple',startTime:Timestamp.now(),status:'active',isPublic:true,routeId:'r',organizerContact:'private'};
  assert.equal(publicProjection({...event,isPublic:false},{}),null);
  assert.equal(publicProjection({...event,status:'paused'},{}),null);
  assert.equal(publicProjection(event,undefined),null);
  assert.equal(publicProjection(event,{})?.organizerContact,undefined);
  assert.equal(publicProjection(event,{})?.routeId,'r');
});
test('activation rejects cross-route group stops, duplicate ordering and stale leader relationships', () => {
  const event={routeId:'r'},routes=[{id:'r',encodedPolyline:'_p~iF~ps|U_ulLnnqC_mqNvxq`@'}];
  const stop={routeId:'r',name:'Stop',type:'temple',latitude:49,longitude:-123,geofenceRadiusMeters:100,maxAllowedGroups:1,plannedStopMinutes:0};
  const stops=[{...stop,id:'a',order:1},{...stop,id:'b',order:2}];
  const groups=[{id:'g',routeId:'r',startingStopPointId:'a',endingStopPointId:'b',leaderUserId:'u'}];
  const users=new Map([['u',{isActive:true,role:'teamLeader',assignedGroupId:'g'}]]);
  assert.deepEqual(validateEventGraph(event,routes,stops,groups,users),[]);
  assert.ok(validateEventGraph(event,routes,[stops[0],{...stops[1],order:1}],groups,users).length);
  assert.ok(validateEventGraph(event,routes,stops,[{...groups[0],routeId:'foreign'}],users).length);
  assert.ok(validateEventGraph(event,routes,stops,groups,new Map()).length);
});
