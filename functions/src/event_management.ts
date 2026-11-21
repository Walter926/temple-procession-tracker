
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DocumentData, DocumentReference, FieldValue, getFirestore, Timestamp, Transaction } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { callableOptions, documentId, requireActiveUser, requireEventManager } from './authorization';
import { distanceMeters } from './geo_math';
import { syncEventState, syncGroupAssignment, syncAccountState, syncEventAccess } from './tracking_mirrors';

type RecordWithId = DocumentData & { id: string };
const collections: Record<string,string> = { event: 'events', route: 'routes', stop: 'stopPoints', group: 'groups', segment: 'routeSegments' };
const statuses = ['draft','scheduled','active','paused','completed','cancelled','archived'];
const groupStatuses = ['waiting','preparing','moving','stopped','delayed','arrived','completed','emergency'];
const bad = (message: string): never => { throw new HttpsError('invalid-argument', message); };
function number(value: unknown, min: number, max: number, name: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) bad(`Invalid ${name}.`);
  return value as number;
}
function string(value: unknown, max: number, name: string, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) bad(`Invalid ${name}.`);
  return (value as string).trim();
}
function time(value: unknown, nullable = false, name = 'date'): Timestamp | null {
  if (nullable && value === null) return null;
  return Timestamp.fromMillis(number(value, 0, 253_402_300_799_999, name));
}
export function decodeRoute(encoded: string): { latitude: number; longitude: number }[] {
  if (typeof encoded !== 'string' || encoded.length > 24000) bad('Route geometry is too large.');
  let index = 0, latitude = 0, longitude = 0;
  const points: { latitude: number; longitude: number }[] = [];
  function delta() {
    let result = 0, shift = 0, byte: number;
    do {
      if (index >= encoded.length || shift > 30) bad('Malformed route geometry.');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) bad('Malformed route geometry.');
      result += (byte & 31) * 2 ** shift;
      shift += 5;
    } while (byte >= 32);
    return result % 2 ? -(result + 1) / 2 : result / 2;
  }
  while (index < encoded.length) {
    latitude += delta(); longitude += delta();
    number(latitude / 1e5, -90, 90, 'latitude'); number(longitude / 1e5, -180, 180, 'longitude');
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
    if (points.length > 2000) bad('Routes support at most 2000 points.');
  }
  if (points.length < 2) bad('Draw at least two route points.');
  return points;
}
function geometryDistance(encoded: string): number {
  const points = decodeRoute(encoded);
  const distance = points.slice(1).reduce((sum, point, index) => sum + distanceMeters(points[index].latitude, points[index].longitude, point.latitude, point.longitude), 0);
  if (distance <= 0) bad('Draw at least two distinct points.');
  return distance;
}
function validateStop(stop: DocumentData): void {
  string(stop.name, 120, 'stop name', true);
  number(stop.latitude,-90,90,'latitude'); number(stop.longitude,-180,180,'longitude');
  number(stop.order,1,10000,'stop order',true); number(stop.geofenceRadiusMeters,5,1000,'geofence radius');
  number(stop.maxAllowedGroups,1,100,'stop capacity',true); number(stop.plannedStopMinutes,0,10080,'dwell time');
  if (!['temple','ritual','rest','checkpoint','food','medical','roadControl','other'].includes(stop.type)) bad('Invalid stop type.');
  if (stop.expectedArrivalTime && stop.expectedDepartureTime && stop.expectedDepartureTime.toMillis() < stop.expectedArrivalTime.toMillis()) bad('Stop departure must follow arrival.');
}
function eventFieldErrors(event: DocumentData): string[] {
  const errors: string[] = [];
  for (const [key,max,label,required] of [['name',120,'event name',true],['description',4000,'description',false],['mainTempleName',120,'temple',true],['cityRegion',120,'city',true]] as const) {
    try { string(event[key],max,label,required); } catch (error) { errors.push((error as Error).message); }
  }
  if (!(event.startTime instanceof Timestamp)) errors.push('Invalid event start time.');
  if (event.endTime != null && (!(event.endTime instanceof Timestamp) || (event.startTime instanceof Timestamp && event.endTime.toMillis() <= event.startTime.toMillis()))) errors.push('Event end time must follow its start time.');
  if (typeof event.isPublic !== 'boolean') errors.push('Invalid event visibility.');
  if (!statuses.includes(event.status)) errors.push('Invalid event status.');
  return errors;
}
export function validateEventGraph(event: DocumentData, routes: RecordWithId[], stops: RecordWithId[], groups: RecordWithId[], users: Map<string, DocumentData> = new Map()): string[] {
  const errors: string[] = [], routeById = new Map(routes.map(r => [r.id,r])), stopById = new Map(stops.map(s => [s.id,s]));
  if (!event.routeId || !routeById.has(event.routeId)) errors.push('Select a primary route belonging to this event.');
  if (!groups.length) errors.push('Add at least one procession group.');
  if (groups.length > 100 || routes.length > 20 || stops.length > 400) errors.push('Supported event size is 100 groups, 20 routes and 400 stops.');
  for (const route of routes) {
    try { geometryDistance(route.encodedPolyline); } catch (error) { errors.push(`Route ${route.id}: ${(error as Error).message}`); }
    const routeStops = stops.filter(s => s.routeId === route.id);
    if (routeStops.length < 2) errors.push(`Route ${route.id} needs at least two stops.`);
    if (new Set(routeStops.map(s => s.order)).size !== routeStops.length) errors.push(`Route ${route.id} has duplicate stop ordering.`);
    for (const stop of routeStops) { try { validateStop(stop); } catch (error) { errors.push(`Stop ${stop.id}: ${(error as Error).message}`); } }
  }
  for (const group of groups) {
    const start = stopById.get(group.startingStopPointId), end = stopById.get(group.endingStopPointId);
    if (!routeById.has(group.routeId) || !start || !end || start.routeId !== group.routeId || end.routeId !== group.routeId || start.order >= end.order) errors.push(`Group ${group.id} needs ordered start/end stops on its route.`);
    const leader = users.get(group.leaderUserId);
    if (!leader || leader.role !== 'teamLeader' || leader.isActive !== true || leader.assignedGroupId !== group.id) errors.push(`Group ${group.id} needs an active assigned primary leader.`);
    if (group.backupLeaderUserId) {
      const backup = users.get(group.backupLeaderUserId);
      if (!backup || backup.isActive !== true || backup.role !== 'teamLeader' || backup.assignedGroupId !== group.id || group.backupLeaderUserId === group.leaderUserId) errors.push(`Group ${group.id} has an invalid backup leader.`);
    }
  }
  return errors;
}
async function readGraph(tx: Transaction, eventId: string) {
  const db = getFirestore();
  const [routeSnaps, groupSnaps] = await Promise.all([tx.get(db.collection('routes').where('eventId','==',eventId)), tx.get(db.collection('groups').where('eventId','==',eventId))]);
  if (routeSnaps.size > 20 || groupSnaps.size > 100) throw new HttpsError('resource-exhausted','Event exceeds supported route/group limits.');
  const stops: RecordWithId[] = [];
  for (const route of routeSnaps.docs) {
    const found = await tx.get(db.collection('stopPoints').where('routeId','==',route.id));
    stops.push(...found.docs.map(doc => ({ ...doc.data(), id: doc.id })));
  }
  const groups = groupSnaps.docs.map(doc => ({ ...doc.data(), id: doc.id })) as RecordWithId[];
  const users = new Map<string, DocumentData>();
  for (const uid of new Set(groups.flatMap(g => [g.leaderUserId,g.backupLeaderUserId]).filter(Boolean))) {
    const user = (await tx.get(db.doc(`users/${documentId(uid)}`))).data();
    if (user) users.set(uid,user);
  }
  return { routes: routeSnaps.docs.map(doc => ({ ...doc.data(), id: doc.id })) as RecordWithId[], stops, groups, users };
}
export function publicProjection(event: DocumentData | undefined, route: DocumentData | undefined): DocumentData | null {
  if (!event || event.deleting || event.isPublic !== true || !['scheduled','active'].includes(event.status) || !event.routeId || !route) return null;
  return { name: event.name, cityRegion: event.cityRegion, mainTempleName: event.mainTempleName, startTime: event.startTime, status: event.status, routeId: event.routeId, isPublic: true };
}
function writePublication(tx: Transaction, eventId: string, event: DocumentData | undefined, route: DocumentData | undefined) {
  const ref = getFirestore().doc(`publicEvents/${eventId}`), projection = publicProjection(event,route);
  if (projection) tx.set(ref,projection); else tx.delete(ref);
}
/** Newest is based on creation time, never on edits. Sort IDs for stable tie-breaking. */
function newestRoute(routes: FirebaseFirestore.QueryDocumentSnapshot[]): FirebaseFirestore.QueryDocumentSnapshot | undefined {
  return [...routes].sort((a,b) => {
    const createdA = a.data().createdAt instanceof Timestamp ? a.data().createdAt as Timestamp : a.createTime;
    const createdB = b.data().createdAt instanceof Timestamp ? b.data().createdAt as Timestamp : b.createTime;
    return (createdB?.seconds ?? 0) - (createdA?.seconds ?? 0) || (createdB?.nanoseconds ?? 0) - (createdA?.nanoseconds ?? 0) || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0);
  })[0];
}
/** A new route is the default unless the organizer has explicitly chosen another. */
export function choosePrimaryRoute(event: DocumentData, routes: FirebaseFirestore.QueryDocumentSnapshot[], newlyCreatedId?: string): { routeId: string | null; mode: 'auto' | 'manual' } {
  const newest = newestRoute(routes), selected = routes.find(route => route.id === event.routeId);
  // Legacy records lack a mode: an older selected primary is likely a manual choice.
  const legacyManual = !event.primaryRouteMode && selected && newest && selected.id !== newest.id;
  const manual = (event.primaryRouteMode === 'manual' || legacyManual) && !!selected;
  return { routeId: manual ? selected.id : (newlyCreatedId ?? newest?.id ?? null), mode: manual ? 'manual' : 'auto' };
}
/** Repair existing records, while keeping an organizer's explicit primary choice. */
async function resolvePrimaryRoute(tx: Transaction, eventId: string, event: DocumentData): Promise<{ event: DocumentData; route: DocumentData | undefined }> {
  const db = getFirestore(), routes = (await tx.get(db.collection('routes').where('eventId','==',eventId).limit(21))).docs;
  if (routes.length > 20) throw new HttpsError('resource-exhausted','Event exceeds 20 routes.');
  const choice = choosePrimaryRoute(event,routes), route = routes.find(item => item.id === choice.routeId);
  if (event.routeId !== choice.routeId || event.primaryRouteMode !== choice.mode) tx.update(db.doc(`events/${eventId}`), { routeId: choice.routeId, primaryRouteMode: choice.mode, updatedAt: FieldValue.serverTimestamp() });
  return { event: { ...event, routeId: choice.routeId, primaryRouteMode: choice.mode }, route: route?.data() };
}
export async function syncPublicEvent(eventId: string): Promise<void> {
  await getFirestore().runTransaction(async tx => {
    const db = getFirestore();
    const [source,published] = await Promise.all([tx.get(db.doc(`events/${eventId}`)),tx.get(db.doc(`publicEvents/${eventId}`))]);
    const original = source.data();
    if (!original) { if (published.exists) writePublication(tx,eventId,undefined,undefined); return; }
    const { event,route } = await resolvePrimaryRoute(tx,eventId,original);
    if (!isDeepStrictEqual(published.data() ?? null,publicProjection(event,route))) writePublication(tx,eventId,event,route);
  });
}
export const mirrorPublicEvent = onDocumentWritten({ document: 'events/{eventId}', maxInstances: 10, retry: true }, event => syncPublicEvent(event.params.eventId));
export const mirrorPublicRoute = onDocumentWritten({ document: 'routes/{routeId}', maxInstances: 10, retry: true }, async event => {
  const ids = new Set([event.data?.before.data()?.eventId,event.data?.after.data()?.eventId].filter(Boolean));
  for (const id of ids) await syncPublicEvent(documentId(id));
});
export const reconcilePublicEvents = onSchedule({ schedule: 'every 30 minutes', maxInstances: 1 }, async () => {
  for (const collection of ['events','publicEvents']) {
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      let query = getFirestore().collection(collection).orderBy('__name__').limit(100);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const event of page.docs) await syncPublicEvent(event.id);
      if (page.size < 100) break;
      cursor = page.docs[page.size - 1];
    }
  }
});
export const validateEvent = onCall(callableOptions, async request => {
  const eventId = documentId(request.data?.eventId);
  return getFirestore().runTransaction(async tx => {
    const { event } = await requireEventManager(request.auth?.uid,eventId,tx), graph = await readGraph(tx,eventId);
    const errors = [...eventFieldErrors(event),...validateEventGraph(event,graph.routes,graph.stops,graph.groups,graph.users)];
    return { valid: !errors.length, errors };
  });
});
const fields: Record<string,string[]> = {
  event: ['name','description','status','startTimeMs','endTimeMs','isPublic','mainTempleName','cityRegion','routeId','organizerContact','emergencyContact'],
  route: ['name','description','color','encodedPolyline','totalDistanceMeters','estimatedDurationMinutes'],
  stop: ['routeId','name','description','type','latitude','longitude','order','plannedStopMinutes','geofenceRadiusMeters','maxAllowedGroups','expectedArrivalTimeMs','expectedDepartureTimeMs'],
  group: ['name','color','routeId','startingStopPointId','endingStopPointId','status'],
  segment: ['routeId','order','startLatitude','startLongitude','endLatitude','endLongitude','distanceMeters','instruction'],
};
function sanitize(resource: string, input: unknown): DocumentData {
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad('data must be an object.');
  const data = { ...(input as DocumentData) };
  if (Object.keys(data).some(key => !fields[resource].includes(key))) bad('Unsupported or server-owned field.');
  for (const key of ['name','description','color','mainTempleName','cityRegion','instruction','organizerContact','emergencyContact']) {
    if (data[key] !== undefined) data[key] = string(data[key], ['description','instruction'].includes(key) ? 4000 : (key.endsWith('Contact') ? 200 : 120), key, ['name','mainTempleName','cityRegion'].includes(key));
  }
  for (const key of ['startTime','endTime','expectedArrivalTime','expectedDepartureTime']) {
    if (Object.prototype.hasOwnProperty.call(data,`${key}Ms`)) { data[key] = time(data[`${key}Ms`],key !== 'startTime',`${key}Ms`); delete data[`${key}Ms`]; }
  }
  if (data.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(data.color)) bad('Color must be a six-digit hex color.');
  return data;
}
async function mutate(uid: string | undefined, request: DocumentData): Promise<{ id: string }> {
  const { operation,resource } = request;
  if (!Object.prototype.hasOwnProperty.call(collections,resource) || !['create','update','delete'].includes(operation)) bad('Invalid resource or operation.');
  const hasId = request.id !== undefined;
  if (!hasId && operation !== 'create' && resource !== 'event') bad('A record ID is required to update or delete this resource.');
  const db = getFirestore(), id = hasId ? documentId(request.id) : (resource === 'event' && operation !== 'create' ? documentId(request.eventId) : db.collection(collections[resource]).doc().id);
  const eventId = resource === 'event' && operation === 'create' ? id : documentId(request.eventId);
  if (resource === 'event' && id !== eventId) bad('Event ID and record ID must match.');
  if (operation === 'delete') { await deleteResource(uid,resource,eventId,id); return { id }; }
  const patch = sanitize(resource,request.data);
  // A stable client-generated event/route ID is an idempotency key, not an upsert.
  // Keep the original request fingerprint so late retries cannot undo later edits.
  const creationRequestHash = ['event','route'].includes(resource) && operation === 'create'
    ? createHash('sha256').update(JSON.stringify([uid,eventId,Object.keys(patch).sort().map(key => [key,patch[key]])])).digest('hex') : undefined;
  await db.runTransaction(async tx => {
    const actor = await requireActiveUser(uid,tx);
    let event: DocumentData;
    if (resource === 'event' && operation === 'create') {
      if (!['admin','organizer'].includes(actor.role)) throw new HttpsError('permission-denied','Management account required.');
      event = { organizerId: uid, status: 'draft', routeId: null, createdAt: FieldValue.serverTimestamp(), creationRequestHash, ...patch };
      if (event.status !== 'draft') bad('Create a draft event before activating it.');
    } else event = (await requireEventManager(uid,eventId,tx)).event;
    const ref = db.doc(`${collections[resource]}/${id}`), existing = (await tx.get(ref)).data();
    if (operation === 'update' && !existing) throw new HttpsError('not-found','Record not found.');
    if (resource !== 'event' && existing) {
      const oldEventId = existing.eventId ?? (await tx.get(db.doc(`routes/${documentId(existing.routeId)}`))).data()?.eventId;
      if (oldEventId !== eventId) throw new HttpsError('permission-denied','Record belongs to another event.');
    }
    if (operation === 'create' && existing) {
      if (creationRequestHash && existing.creationRequestHash === creationRequestHash) return;
      throw new HttpsError('already-exists','Record ID already exists.');
    }
    const data: DocumentData = { ...(existing ?? {}), ...patch, updatedAt: FieldValue.serverTimestamp() };
    let relatedRoute: DocumentData | undefined, routeRef: DocumentReference | undefined;
    let childIds: string[] | undefined;
    let existingRoutes: FirebaseFirestore.QueryDocumentSnapshot[] | undefined;
    if (resource === 'event') {
      Object.assign(data, { ...event, ...data });
      const fieldErrors = eventFieldErrors(data);
      if (fieldErrors.length) throw new HttpsError('invalid-argument',fieldErrors.join(' '),{ errors:fieldErrors });
      if (['completed','cancelled','archived'].includes(event.status) && data.status !== event.status && data.status !== 'archived') bad('Closed events cannot be reactivated.');
      if (Object.prototype.hasOwnProperty.call(patch,'routeId')) {
        // An explicit route selection is a persistent manual override.
        if (patch.routeId) data.primaryRouteMode = 'manual';
        else {
          // Clearing the choice returns to automatic newest-route selection.
          const routeDocs = (await tx.get(db.collection('routes').where('eventId','==',eventId).limit(21))).docs;
          data.routeId = newestRoute(routeDocs)?.id ?? null;
          data.primaryRouteMode = 'auto';
        }
      }
      if (data.routeId) {
        relatedRoute = (await tx.get(db.doc(`routes/${documentId(data.routeId)}`))).data();
        if (!relatedRoute || relatedRoute.eventId !== eventId) bad('Primary route must belong to this event.');
      }
      if (['scheduled','active'].includes(data.status)) {
        const graph = await readGraph(tx,eventId), errors = validateEventGraph(data,graph.routes,graph.stops,graph.groups,graph.users);
        if (errors.length) throw new HttpsError('failed-precondition',errors.join(' '), { errors });
      }
    } else {
      const onlyGroupStatus = resource === 'group' && Object.keys(patch).every(key => key === 'status');
      if (!['draft','scheduled'].includes(event.status) && !onlyGroupStatus) throw new HttpsError('failed-precondition',`Geometry and groups are locked while this event is ${event.status}. Edit only a draft or scheduled event.`);
      if (['completed','cancelled','archived'].includes(event.status)) throw new HttpsError('failed-precondition','Event is closed.');
      if (resource === 'route' || resource === 'group') data.eventId = eventId;
      if (resource === 'route') {
        data.totalDistanceMeters = geometryDistance(data.encodedPolyline);
        string(data.name,120,'route name',true); number(data.estimatedDurationMinutes,0,10080,'duration');
        if (!existing) Object.assign(data,{ createdAt: FieldValue.serverTimestamp(), stopPointIds: [],segmentIds: [],creationRequestHash });
        const routes = await tx.get(db.collection('routes').where('eventId','==',eventId));
        existingRoutes = routes.docs;
        if (!existing && routes.size >= 20) bad('At most 20 routes are supported per event.');
      }
      if (['stop','segment','group'].includes(resource)) {
        const routeId = documentId(data.routeId); routeRef = db.doc(`routes/${routeId}`);
        relatedRoute = (await tx.get(routeRef)).data();
        if (!relatedRoute || relatedRoute.eventId !== eventId) bad('Route does not belong to this event.');
        if (existing && existing.routeId !== routeId) bad('Record route cannot change. Create a replacement instead.');
      }
      if (resource === 'stop' || resource === 'segment') {
        const siblings = await tx.get(db.collection(collections[resource]).where('routeId','==',data.routeId));
        if (siblings.docs.some(doc => doc.id !== id && doc.data().order === data.order)) bad('Order must be unique within the route.');
        if (!existing && siblings.size >= 200) bad('At most 200 stops or segments are supported per route.');
        childIds = [...siblings.docs.filter(doc => doc.id !== id).map(doc => ({ id: doc.id, order: doc.data().order })),{id,order:data.order}].sort((a,b)=>a.order-b.order).map(doc=>doc.id);
      }
      if (resource === 'stop') validateStop(data);
      if (resource === 'segment') {
        number(data.order,1,10000,'segment order',true);
        for (const prefix of ['start','end']) { number(data[`${prefix}Latitude`],-90,90,'latitude'); number(data[`${prefix}Longitude`],-180,180,'longitude'); }
        data.distanceMeters = distanceMeters(data.startLatitude,data.startLongitude,data.endLatitude,data.endLongitude);
        string(data.instruction,4000,'instruction');
      }
      if (resource === 'group') {
        string(data.name,120,'group name',true);
        if (!groupStatuses.includes(data.status)) bad('Invalid group status.');
        const [start,end] = await Promise.all([tx.get(db.doc(`stopPoints/${documentId(data.startingStopPointId)}`)),tx.get(db.doc(`stopPoints/${documentId(data.endingStopPointId)}`))]);
        if (start.data()?.routeId !== data.routeId || end.data()?.routeId !== data.routeId || start.data()!.order >= end.data()!.order) bad('Choose ordered start/end stops on this route.');
        const groups = await tx.get(db.collection('groups').where('eventId','==',eventId));
        if (!existing && groups.size >= 100) bad('At most 100 groups are supported per event.');
        if (!existing) {
          if (!['waiting','stopped'].includes(data.status)) bad('New groups must be waiting or stopped.');
          Object.assign(data,{ leaderUserId:'',backupLeaderUserId:'',memberCount:0,accessCodeId:null,currentLatitude:null,currentLongitude:null,lastLocationUpdateAt:null });
        }
        if (patch.status !== undefined) data.statusUpdatedAt = FieldValue.serverTimestamp();
      }
    }
    const contacts: DocumentData = {};
    for (const key of ['organizerContact','emergencyContact']) { if (data[key] !== undefined) { contacts[key] = data[key]; delete data[key]; } }
    if (operation === 'create') tx.create(ref,data); else tx.set(ref,data);
    if (Object.keys(contacts).length) tx.set(db.doc(`eventContacts/${eventId}`),{ ...contacts,updatedAt:FieldValue.serverTimestamp() },{ merge:true });
    const eventPatch: DocumentData = {};
    if (resource === 'route' && operation === 'create') {
      const choice = choosePrimaryRoute(event,existingRoutes ?? [],id);
      Object.assign(eventPatch,{ routeId:choice.routeId,primaryRouteMode:choice.mode });
    }
    if (routeRef && childIds) tx.update(routeRef,{ [resource === 'stop' ? 'stopPointIds' : 'segmentIds']: childIds, updatedAt:FieldValue.serverTimestamp() });
    if (resource !== 'event' && event.status === 'scheduled' && (resource !== 'group' || operation === 'create'
      || ['routeId','startingStopPointId','endingStopPointId'].some(key => patch[key] !== undefined && patch[key] !== existing?.[key]))) {
      eventPatch.status = 'draft';
      tx.delete(db.doc(`publicEvents/${eventId}`));
    }
    if (Object.keys(eventPatch).length) tx.update(db.doc(`events/${eventId}`),{ ...eventPatch, updatedAt:FieldValue.serverTimestamp() });
    if (resource === 'event') writePublication(tx,eventId,data,relatedRoute);
    tx.create(db.collection('auditRecords').doc(),{ action:`${operation}:${resource}`,eventId,id,actorUid:uid,createdAt:FieldValue.serverTimestamp() });
  });
  await syncEventState(eventId);
  if (resource === 'group') await syncGroupAssignment(id);
  return { id };
}
export const manageEvent = onCall(callableOptions, request => mutate(request.auth?.uid,request.data ?? {}));
async function deleteResource(uid: string | undefined, resource: string, eventId: string, id: string): Promise<void> {
  const affected = await getFirestore().runTransaction(async tx => {
    const db = getFirestore(), { event } = await requireEventManager(uid,eventId,tx);
    if (!['draft','scheduled','completed','cancelled','archived'].includes(event.status)) throw new HttpsError('failed-precondition','Stop or complete the event before deleting records.');
    const ref = db.doc(`${collections[resource]}/${id}`), target = (await tx.get(ref)).data();
    if (!target) return { groups: [] as string[], users: [] as string[], accessUsers: [] as string[] };
    const targetEvent = resource === 'event' ? id : (target.eventId ?? (await tx.get(db.doc(`routes/${documentId(target.routeId)}`))).data()?.eventId);
    if (targetEvent !== eventId) throw new HttpsError('permission-denied','Record belongs to another event.');
    const deletes = new Map<string,DocumentReference>([[ref.path,ref]]);
    const updates = new Map<string,{ref:DocumentReference;data:DocumentData}>();
    const addDelete = (doc: {ref:DocumentReference}) => deletes.set(doc.ref.path,doc.ref);
    const groups = resource === 'event' ? (await tx.get(db.collection('groups').where('eventId','==',eventId))).docs
      : resource === 'group' ? [await tx.get(ref)] : [];
    const allGroups = (await tx.get(db.collection('groups').where('eventId','==',eventId))).docs;
    const routes = resource === 'event' ? (await tx.get(db.collection('routes').where('eventId','==',eventId))).docs
      : resource === 'route' ? [await tx.get(ref)] : [];
    const remainingRoutes = resource === 'route' ? (await tx.get(db.collection('routes').where('eventId','==',eventId))).docs.filter(route => route.id !== id) : [];
    if (resource === 'route' && allGroups.some(doc => doc.data().routeId === id)) throw new HttpsError('failed-precondition','Remove or move groups from this route first.');
    if (resource === 'stop' && allGroups.some(doc => [doc.data().startingStopPointId,doc.data().endingStopPointId].includes(id))) throw new HttpsError('failed-precondition','A group still references this stop.');
    for (const route of routes) {
      addDelete(route);
      for (const collection of ['stopPoints','routeSegments']) (await tx.get(db.collection(collection).where('routeId','==',route.id))).docs.forEach(addDelete);
    }
    if (resource === 'stop' || resource === 'segment') {
      const routeRef = db.doc(`routes/${documentId(target.routeId)}`), route = (await tx.get(routeRef)).data();
      const key = resource === 'stop' ? 'stopPointIds' : 'segmentIds';
      if (route) updates.set(routeRef.path,{ref:routeRef,data:{[key]:(route[key] ?? []).filter((child:string)=>child!==id)}});
    }
    const users = new Map<string,DocumentData>(), accessUsers = new Set<string>();
    async function patchUser(userId: string, patch: DocumentData) {
      if (!users.has(userId)) {
        const user = (await tx.get(db.doc(`users/${documentId(userId)}`))).data();
        if (user) users.set(userId,user);
      }
      const user = users.get(userId);
      if (user) {
        const userRef = db.doc(`users/${userId}`);
        updates.set(userRef.path,{ref:userRef,data:{...updates.get(userRef.path)?.data,...patch,updatedAt:FieldValue.serverTimestamp()}});
      }
    }
    for (const group of groups) {
      const data = group.data()!; addDelete(group);
      for (const userId of [data.leaderUserId,data.backupLeaderUserId].filter(Boolean)) {
        accessUsers.add(documentId(userId));
        const user = (await tx.get(db.doc(`users/${documentId(userId)}`))).data();
        if (user?.assignedGroupId === group.id) await patchUser(userId,{assignedGroupId:''});
      }
      for (const collection of ['groupProgress','stopPresence']) deletes.set(`${collection}/${group.id}`,db.doc(`${collection}/${group.id}`));
      for (const collection of ['memberships','accessCodes','stopArrivals','arrivalNotifications']) {
        const records = await tx.get(db.collection(collection).where('groupId','==',group.id));
        for (const doc of records.docs) {
          if (collection === 'memberships') accessUsers.add(documentId(doc.data().uid, 'membership user ID'));
          if (collection === 'memberships' && resource !== 'event') {
            updates.set(doc.ref.path,{ref:doc.ref,data:{groupId:'',updatedAt:FieldValue.serverTimestamp()}});
            const user = (await tx.get(db.doc(`users/${documentId(doc.data().uid)}`))).data();
            if (user?.joinedGroupId === group.id) await patchUser(doc.data().uid,{joinedGroupId:''});
          } else addDelete(doc);
        }
      }
    }
    if (resource === 'event') {
      for (const collection of ['memberships','accessCodes','publicAnnouncements','announcements','collisionAlerts','collisionWarnings','collisionInstructions','routeSuggestions','routeInstructions','locationUpdates','locationHistory','stopArrivals','arrivalNotifications','notifications']) {
        const records = await tx.get(db.collection(collection).where('eventId','==',eventId));
        for (const doc of records.docs) {
          addDelete(doc);
          if (collection === 'memberships') {
            accessUsers.add(documentId(doc.data().uid, 'membership user ID'));
            const user = (await tx.get(db.doc(`users/${documentId(doc.data().uid)}`))).data();
            if (user?.joinedEventId === eventId) await patchUser(doc.data().uid,{joinedEventId:'',joinedGroupId:''});
          }
        }
      }
      for (const collection of ['eventContacts','publicEvents']) deletes.set(`${collection}/${eventId}`,db.doc(`${collection}/${eventId}`));
    } else if (resource === 'route') {
      const choice = choosePrimaryRoute(event,remainingRoutes);
      if (event.routeId !== choice.routeId || event.primaryRouteMode !== choice.mode) {
        updates.set(`events/${eventId}`,{ref:db.doc(`events/${eventId}`),data:{routeId:choice.routeId,primaryRouteMode:choice.mode,updatedAt:FieldValue.serverTimestamp()}});
        deletes.set(`publicEvents/${eventId}`,db.doc(`publicEvents/${eventId}`));
      }
    }
    if (resource !== 'event' && event.status === 'scheduled') {
      updates.set(`events/${eventId}`,{ref:db.doc(`events/${eventId}`),data:{...updates.get(`events/${eventId}`)?.data,status:'draft',updatedAt:FieldValue.serverTimestamp()}});
      deletes.set(`publicEvents/${eventId}`,db.doc(`publicEvents/${eventId}`));
    }
    if (deletes.size + updates.size > 440) throw new HttpsError('resource-exhausted','Deletion exceeds the atomic cleanup limit. A maintenance migration is required.');
    for (const [path,patch] of updates) if (!deletes.has(path)) tx.update(patch.ref,patch.data);
    for (const reference of deletes.values()) tx.delete(reference);
    tx.create(db.collection('auditRecords').doc(),{action:`delete:${resource}`,eventId,id,actorUid:uid,createdAt:FieldValue.serverTimestamp()});
    return {groups:groups.map(doc=>doc.id),users:[...users.keys()],accessUsers:[...new Set([...users.keys(),...accessUsers])]};
  });
  await syncEventState(eventId);
  for (const groupId of affected.groups) await syncGroupAssignment(groupId);
  for (const userId of affected.users) await syncAccountState(userId);
  // Membership revocation must be mirrored even when the user's active event
  // points elsewhere and no canonical profile field needed to change.
  for (const userId of affected.accessUsers) await syncEventAccess(eventId,userId);
}
function deletion(resource:string,key:string) {
  return onCall(callableOptions, async request => {
    const id=documentId(request.data?.[key]);
    let eventId = resource==='event' ? id : request.data?.eventId;
    if (!eventId) {
      const target=(await getFirestore().doc(`${collections[resource]}/${id}`).get()).data();
      if (!target) throw new HttpsError('not-found','Record not found.');
      eventId=target.eventId;
      if (!eventId && target.routeId) eventId=(await getFirestore().doc(`routes/${documentId(target.routeId)}`).get()).data()?.eventId;
    }
    await deleteResource(request.auth?.uid,resource,documentId(eventId),id);
    return {id};
  });
}
export const deleteEvent=deletion('event','eventId');
export const deleteGroup=deletion('group','groupId');
export const deleteRoute=deletion('route','routeId');
export const deleteStopPoint=deletion('stop','stopPointId');
