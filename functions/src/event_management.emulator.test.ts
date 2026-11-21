import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { manageEvent, deleteRoute, validateEvent, mirrorPublicEvent, mirrorPublicRoute, syncPublicEvent } from './event_management';

// Actual callable/trigger handlers, local demo data only. Never clear a shared emulator.
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_DATABASE_EMULATOR_HOST;
let app: App, db: Firestore;
before(() => {
  if (!emulator) return;
  for (const [name,port] of [['FIRESTORE_EMULATOR_HOST',8080],['FIREBASE_DATABASE_EMULATOR_HOST',9000]] as const) {
    assert.ok([`127.0.0.1:${port}`,`localhost:${port}`].includes(process.env[name] ?? ''),`Refusing nonlocal ${name}`);
  }
  for (const name of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT']) {
    assert.ok(!process.env[name] || process.env[name] === 'demo-temple-procession',`Refusing non-demo ${name}`);
  }
  process.env.RTDB_URL = 'http://127.0.0.1:9000?ns=demo-temple-procession-default-rtdb';
  app = initializeApp({ projectId:'demo-temple-procession',databaseURL:process.env.RTDB_URL });
  db = getFirestore(app);
});
after(async () => {
  if (db) await db.terminate();
  if (app) await deleteApp(app);
});
const call = <T>(handler: { run:(request:never) => T }, uid: string | undefined, data: DocumentData): T => handler.run({ data,auth:uid ? { uid,token:{ sub:uid } } : undefined } as never);
const read = async (path: string) => (await db.doc(path).get()).data()!;
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise,(error: { code?: string }) => error.code === code);
function encode(points: number[][]): string {
  let latitude = 0, longitude = 0, result = '';
  for (const point of points) for (const [index,value] of point.entries()) {
    const scaled = Math.round(value * 1e5), previous = index ? longitude : latitude;
    let delta = scaled - previous;
    delta = delta < 0 ? ~(delta << 1) : delta << 1;
    while (delta >= 32) { result += String.fromCharCode((delta & 31 | 32) + 63); delta >>>= 5; }
    result += String.fromCharCode(delta + 63);
    if (index) longitude = scaled; else latitude = scaled;
  }
  return result;
}
const geometry = encode(Array.from({ length:7 },(_,index) => [49 + index / 1000,-123 + index / 2000]));
const routeData = { name:'Seven point route',description:'Ritual route',color:'#336699',encodedPolyline:geometry,totalDistanceMeters:0,estimatedDurationMinutes:34 };
async function fixture() {
  const prefix = `event-regression-${randomUUID()}`, owner = `${prefix}-owner`, eventId = `${prefix}-event`;
  await db.doc(`users/${owner}`).set({ role:'organizer',isActive:true });
  await call(manageEvent,owner,{ operation:'create',resource:'event',id:eventId,data:{ name:'Procession',description:'',mainTempleName:'Temple',cityRegion:'Test city',status:'draft',isPublic:true,startTimeMs:1000,endTimeMs:2000 } });
  return { prefix,owner,eventId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
test('event handler: stable event-create retries preserve later edits and cannot be claimed by another actor', { skip:!emulator }, async () => {
  const id = `event-replay-${randomUUID()}`, owner = `${id}-owner`, other = `${id}-other`;
  for (const uid of [owner,other]) await db.doc(`users/${uid}`).set({ role:'organizer',isActive:true });
  const request = { operation:'create',resource:'event',eventId:id,id,data:{ name:'Original',description:'',mainTempleName:'Temple',cityRegion:'City',status:'draft',isPublic:false,startTimeMs:1000,endTimeMs:2000 } };
  await call(manageEvent,owner,request);
  const first = await db.doc(`events/${id}`).get();
  await call(manageEvent,owner,request);
  assert.ok((await db.doc(`events/${id}`).get()).updateTime!.isEqual(first.updateTime!));
  await call(manageEvent,owner,{ operation:'update',resource:'event',eventId:id,id,data:{ name:'Later edit' } });
  await call(manageEvent,owner,request);
  assert.equal((await read(`events/${id}`)).name,'Later edit');
  await rejects(call(manageEvent,other,request),'already-exists');
  await rejects(call(manageEvent,owner,{ ...request,data:{ ...request.data,name:'Different request' } }),'already-exists');
  await db.doc(`users/${owner}`).update({ isActive:false });
  await rejects(call(manageEvent,owner,request),'permission-denied');
});
const create = (f: Fixture, id: string) => call(manageEvent,f.owner,{ operation:'create',resource:'route',eventId:f.eventId,id,data:routeData });
const updateEvent = (f: Fixture, data: DocumentData) => call(manageEvent,f.owner,{ operation:'update',resource:'event',eventId:f.eventId,id:f.eventId,data });
async function primary(f: Fixture, routeId: string | null, mode: string) {
  const event = await read(`events/${f.eventId}`);
  assert.equal(event.routeId,routeId); assert.equal(event.primaryRouteMode,mode);
}
async function ready(f: Fixture, routeId: string) {
  const start = `${routeId}-start`, end = `${routeId}-end`, group = `${routeId}-group`, leader = `${routeId}-leader`;
  const batch = db.batch();
  for (const [id,order] of [[start,1],[end,2]] as const) batch.set(db.doc(`stopPoints/${id}`),{ routeId,eventId:f.eventId,name:id,type:'checkpoint',latitude:49,longitude:-123,order,plannedStopMinutes:0,geofenceRadiusMeters:100,maxAllowedGroups:1 });
  batch.set(db.doc(`users/${leader}`),{ role:'teamLeader',isActive:true,assignedGroupId:group });
  batch.set(db.doc(`groups/${group}`),{ eventId:f.eventId,routeId,startingStopPointId:start,endingStopPointId:end,leaderUserId:leader,backupLeaderUserId:'' });
  await batch.commit();
  return { start,end,group,leader };
}

test('event handler: seven-point create/edit persists one route and preserves creation time', { skip:!emulator }, async () => {
  const f = await fixture(), id = `${f.prefix}-route`;
  assert.deepEqual(await create(f,id),{ id });
  const original = await read(`routes/${id}`);
  for (const key of ['name','description','color','encodedPolyline','estimatedDurationMinutes']) assert.equal(original[key],routeData[key as keyof typeof routeData]);
  assert.ok(original.totalDistanceMeters > 0);
  await primary(f,id,'auto');
  const editedGeometry = encode([[49,-123],[49.02,-123.02],[49.03,-123.01]]);
  await call(manageEvent,f.owner,{ operation:'update',resource:'route',eventId:f.eventId,id,data:{ name:'Edited',encodedPolyline:editedGeometry } });
  const edited = await read(`routes/${id}`);
  assert.equal(edited.name,'Edited'); assert.equal(edited.encodedPolyline,editedGeometry);
  assert.ok(edited.createdAt.isEqual(original.createdAt));
  assert.equal((await db.collection('routes').where('eventId','==',f.eventId).get()).size,1);
  await primary(f,id,'auto');
});

test('event handler: stable-ID create retries are no-ops, even after editing/activation; collisions still fail', { skip:!emulator }, async () => {
  const f = await fixture(), id = `${f.prefix}-route`;
  await create(f,id);
  const original = await db.doc(`routes/${id}`).get();
  assert.deepEqual(await create(f,id),{ id });
  assert.ok((await db.doc(`routes/${id}`).get()).updateTime!.isEqual(original.updateTime!));
  await call(manageEvent,f.owner,{ operation:'update',resource:'route',eventId:f.eventId,id,data:{ name:'Later edit' } });
  await ready(f,id);
  await updateEvent(f,{ status:'active' });
  assert.deepEqual(await create(f,id),{ id });
  assert.equal((await read(`routes/${id}`)).name,'Later edit');
  assert.equal((await read(`events/${f.eventId}`)).status,'active');
  assert.equal((await read(`publicEvents/${f.eventId}`)).routeId,id);
  const audits = await db.collection('auditRecords').where('eventId','==',f.eventId).get();
  assert.equal(audits.docs.filter(doc => doc.data().action === 'create:route').length,1);
  await rejects(call(manageEvent,f.owner,{ operation:'create',resource:'route',eventId:f.eventId,id,data:{ ...routeData,name:'Different request' } }),'already-exists');
  await rejects(create({ ...f,owner:`${f.prefix}-stranger` },id),'permission-denied');
});

test('event handler: route retry keys are bounded, actor/event scoped and optional for older clients', { skip:!emulator }, async () => {
  const f = await fixture(), foreign = await fixture(), id = `${f.prefix}-route`, admin = `${f.prefix}-admin`;
  await create(f,id);
  await rejects(create(f,'x'.repeat(201)),'invalid-argument');
  await rejects(create(foreign,id),'permission-denied');
  await db.doc(`users/${admin}`).set({ role:'admin',isActive:true });
  await rejects(create({ ...f,owner:admin },id),'already-exists');
  await rejects(call(manageEvent,undefined,{ operation:'create',resource:'route',eventId:f.eventId,id,data:routeData }),'unauthenticated');
  const legacy = await call(manageEvent,f.owner,{ operation:'create',resource:'route',eventId:f.eventId,data:routeData });
  assert.ok(legacy.id && legacy.id !== id);
  await primary(f,legacy.id,'auto');
  await rejects(call(manageEvent,f.owner,{ operation:'update',resource:'route',eventId:f.eventId,id,data:{ creationRequestHash:'forged' } }),'invalid-argument');
});

test('event handler: A -> B -> C, manual A, create D, edit B, delete A, then last route', { skip:!emulator }, async () => {
  const f = await fixture(), [a,b,c,d] = ['A','B','C','D'].map(name => `${f.prefix}-${name}`);
  for (const id of [a,b,c]) { await create(f,id); await primary(f,id,'auto'); }
  await call(manageEvent,f.owner,{ operation:'update',resource:'route',eventId:f.eventId,id:a,data:{ name:'Recently edited A' } });
  await syncPublicEvent(f.eventId); await primary(f,c,'auto');
  await updateEvent(f,{ routeId:a }); await primary(f,a,'manual');
  await create(f,d); await primary(f,a,'manual');
  await call(manageEvent,f.owner,{ operation:'update',resource:'route',eventId:f.eventId,id:b,data:{ name:'Recently edited B' } });
  await primary(f,a,'manual');
  await call(deleteRoute,f.owner,{ eventId:f.eventId,routeId:a }); await primary(f,d,'auto');
  for (const [id,expected] of [[d,c],[c,b],[b,null]]) {
    await call(deleteRoute,f.owner,{ eventId:f.eventId,routeId:id }); await primary(f,expected,'auto');
    assert.equal((await db.doc(`publicEvents/${f.eventId}`).get()).exists,false);
  }
  await call(deleteRoute,f.owner,{ eventId:f.eventId,routeId:b }); await primary(f,null,'auto');
});

test('event handler: concurrent creates/retries and selection keep newest-created/manual policy', { skip:!emulator }, async () => {
  const f = await fixture(), a = `${f.prefix}-A`, b = `${f.prefix}-B`, c = `${f.prefix}-C`;
  await create(f,a);
  await Promise.all([create(f,b),create(f,b)]);
  await primary(f,b,'auto');
  await Promise.all([create(f,c),updateEvent(f,{ routeId:a })]);
  await primary(f,a,'manual');
  await updateEvent(f,{ routeId:null });
  const routes = (await db.collection('routes').where('eventId','==',f.eventId).get()).docs;
  const newest = [...routes].sort((x,y) => y.data().createdAt.seconds - x.data().createdAt.seconds || y.data().createdAt.nanoseconds - x.data().createdAt.nanoseconds || (x.id < y.id ? 1 : -1))[0];
  await primary(f,newest.id,'auto');
  await Promise.all([call(deleteRoute,f.owner,{ eventId:f.eventId,routeId:newest.id }),syncPublicEvent(f.eventId)]);
  const selected = (await read(`events/${f.eventId}`)).routeId;
  assert.ok(selected && selected !== newest.id && (await db.doc(`routes/${selected}`).get()).exists);
});

test('event triggers: legacy repair/publication is idempotent, source-reading and creation-ordered', { skip:!emulator }, async () => {
  const f = await fixture(), older = `${f.prefix}-z-older`, newer = `${f.prefix}-a-newer`;
  await create(f,older); await create(f,newer);
  await db.doc(`routes/${older}`).update({ createdAt:new Timestamp(1,100000),updatedAt:Timestamp.now() });
  await db.doc(`routes/${newer}`).update({ createdAt:new Timestamp(1,200000) });
  await db.doc(`events/${f.eventId}`).update({ status:'scheduled',routeId:null,primaryRouteMode:null });
  await mirrorPublicEvent.run({ params:{ eventId:f.eventId } } as never);
  await primary(f,newer,'auto');
  const published = await db.doc(`publicEvents/${f.eventId}`).get(), event = await db.doc(`events/${f.eventId}`).get();
  assert.equal(published.data()!.routeId,newer);
  await syncPublicEvent(f.eventId); await syncPublicEvent(f.eventId);
  assert.ok((await db.doc(`events/${f.eventId}`).get()).updateTime!.isEqual(event.updateTime!));
  assert.ok((await db.doc(`publicEvents/${f.eventId}`).get()).updateTime!.isEqual(published.updateTime!));
  await db.doc(`events/${f.eventId}`).update({ routeId:older,primaryRouteMode:null });
  await mirrorPublicRoute.run({ data:{ before:{ data:() => ({ eventId:f.eventId }) },after:{ data:() => ({ eventId:f.eventId }) } } } as never);
  await primary(f,older,'manual');
  assert.equal((await read(`publicEvents/${f.eventId}`)).routeId,older);
  await db.doc(`routes/${older}`).update({ createdAt:new Timestamp(1,200000) });
  await db.doc(`events/${f.eventId}`).update({ routeId:null,primaryRouteMode:'auto' });
  await syncPublicEvent(f.eventId); await primary(f,older,'auto');
  assert.equal((await read(`publicEvents/${f.eventId}`)).routeId,older);
  await db.doc(`events/${f.eventId}`).update({ isPublic:false });
  await mirrorPublicEvent.run({ params:{ eventId:f.eventId } } as never);
  assert.equal((await db.doc(`publicEvents/${f.eventId}`).get()).exists,false);
});

test('event handler: validation provides field errors and preserves scheduling/publication/status policy', { skip:!emulator }, async () => {
  const f = await fixture(), id = `${f.prefix}-route`;
  await create(f,id);
  const graph = await ready(f,id);
  assert.deepEqual(await call(validateEvent,f.owner,{ eventId:f.eventId }),{ valid:true,errors:[] });
  // A date in the past alone never automatically closes a manually controlled event.
  await updateEvent(f,{ status:'scheduled' });
  assert.equal((await read(`publicEvents/${f.eventId}`)).routeId,id);
  await call(manageEvent,f.owner,{ operation:'update',resource:'route',eventId:f.eventId,id,data:{ color:'#112233' } });
  assert.equal((await read(`events/${f.eventId}`)).status,'draft');
  assert.equal((await db.doc(`publicEvents/${f.eventId}`).get()).exists,false);
  await db.doc(`stopPoints/${graph.start}`).update({ geofenceRadiusMeters:0 });
  const invalid = await call(validateEvent,f.owner,{ eventId:f.eventId });
  assert.equal(invalid.valid,false); assert.ok(invalid.errors.some((error: string) => /geofence radius/i.test(error)));
  await rejects(updateEvent(f,{ status:'scheduled' }),'failed-precondition');
  await db.doc(`stopPoints/${graph.start}`).update({ geofenceRadiusMeters:100 });
  await updateEvent(f,{ status:'active' });
  assert.equal((await read(`events/${f.eventId}`)).status,'active');
  await assert.rejects(create(f,`${f.prefix}-locked-active`),(error: { code:string;message:string }) => error.code === 'failed-precondition' && /active.*draft.*scheduled/.test(error.message));
  await rejects(call(manageEvent,f.owner,{ operation:'update',resource:'route',eventId:f.eventId,id,data:{ name:'Forbidden active edit' } }),'failed-precondition');
  await updateEvent(f,{ status:'paused' });
  await assert.rejects(create(f,`${f.prefix}-locked-paused`),(error: { code:string;message:string }) => error.code === 'failed-precondition' && /paused.*draft.*scheduled/.test(error.message));
  assert.equal((await db.doc(`publicEvents/${f.eventId}`).get()).exists,false);
  await updateEvent(f,{ status:'completed' });
  await rejects(updateEvent(f,{ status:'active' }),'invalid-argument');
  await rejects(call(validateEvent,undefined,{ eventId:f.eventId }),'unauthenticated');
});

test('event reconcile: active legacy event with one route/null primary repairs event and public projection without expiring it', { skip:!emulator }, async () => {
  const f = await fixture(), id = `${f.prefix}-only-route`;
  await create(f,id);
  await db.doc(`events/${f.eventId}`).update({ status:'active',routeId:null,primaryRouteMode:FieldValue.delete() });
  const event = await read(`events/${f.eventId}`);
  await db.doc(`publicEvents/${f.eventId}`).set({ name:event.name,cityRegion:event.cityRegion,mainTempleName:event.mainTempleName,startTime:event.startTime,status:'active',routeId:null,isPublic:true });
  await syncPublicEvent(f.eventId);
  await primary(f,id,'auto');
  assert.equal((await read(`events/${f.eventId}`)).status,'active');
  assert.equal((await read(`publicEvents/${f.eventId}`)).routeId,id);
  const repaired = await db.doc(`events/${f.eventId}`).get();
  await mirrorPublicEvent.run({ params:{ eventId:f.eventId } } as never);
  assert.ok((await db.doc(`events/${f.eventId}`).get()).updateTime!.isEqual(repaired.updateTime!));
});

test('event handler: invalid metadata/date and missing mutation IDs fail clearly', { skip:!emulator }, async () => {
  const f = await fixture(), id = `${f.prefix}-route`;
  await create(f,id); await ready(f,id);
  await db.doc(`events/${f.eventId}`).update({ name:'',endTime:Timestamp.fromMillis(500) });
  const validation = await call(validateEvent,f.owner,{ eventId:f.eventId });
  assert.equal(validation.valid,false);
  assert.ok(validation.errors.some((error: string) => /name/i.test(error)));
  assert.ok(validation.errors.some((error: string) => /end/i.test(error)));
  await rejects(call(manageEvent,f.owner,{ operation:'update',resource:'route',eventId:f.eventId,data:{ name:'Missing ID' } }),'invalid-argument');
  await rejects(call(manageEvent,f.owner,{ operation:'delete',resource:'route',eventId:f.eventId }),'invalid-argument');
  await rejects(updateEvent(f,{ startTimeMs:8_640_000_000_000_000 }),'invalid-argument');
});

test('event handler: deleting selected/last routes does not reopen completed, cancelled or archived events', { skip:!emulator }, async () => {
  for (const status of ['completed','cancelled','archived']) {
    const f = await fixture(), a = `${f.prefix}-A`, b = `${f.prefix}-B`;
    await create(f,a); await create(f,b); await updateEvent(f,{ routeId:a });
    await updateEvent(f,{ status });
    await call(deleteRoute,f.owner,{ eventId:f.eventId,routeId:a });
    await primary(f,b,'auto'); assert.equal((await read(`events/${f.eventId}`)).status,status);
    await call(deleteRoute,f.owner,{ eventId:f.eventId,routeId:b });
    await primary(f,null,'auto'); assert.equal((await read(`events/${f.eventId}`)).status,status);
  }
});
