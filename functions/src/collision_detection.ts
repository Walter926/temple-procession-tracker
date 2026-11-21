import { getApp } from 'firebase-admin/app';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { getFirestore, FieldValue, FieldPath, Timestamp, type DocumentData, type Query } from 'firebase-admin/firestore';
import { onValueWritten } from 'firebase-functions/v2/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { findCollisions, type CollisionGroup, type CollisionStop } from './collision_engine';
import { usableSample, maximumSampleAgeMs } from './route_progress';
import { loadRouteConfiguration, routeConfigurationVersion } from './route_configuration';
import { boundedWork, checkpointWorker, claimWorker, digest, millis, type CursorBudget } from './notifications';
import { error as logError } from 'firebase-functions/logger';

const rtdbUrl = defineString('RTDB_URL');
const db = getFirestore;

export function incidentIdentity(alertId: string, generation: number): string { return digest('collision', alertId, String(generation)); }

/** Publish an event atomically. Only successfully published revisions fence older
 * scans: a newer failed scan must not prevent an older fresh scan from repairing. */
export async function recountCollisions(eventId: string): Promise<void> {
  const database = db(), scanRef = database.doc(`collisionScans/${eventId}`), eventRef = database.doc(`events/${eventId}`);
  const { revision, event: initialEvent } = await database.runTransaction(async tx => {
    const [scan, event] = await Promise.all([tx.get(scanRef), tx.get(eventRef)]);
    const revision = Number(scan.data()?.revision ?? 0) + 1;
    tx.set(scanRef, { revision, startedAt: Timestamp.now() }, { merge: true });
    return { revision, event: event.data() };
  });
  const groups: CollisionGroup[] = [];
  if (initialEvent?.status === 'active' && initialEvent.deleting !== true) {
    const [groupsQuery, positionsSnap] = await Promise.all([
      database.collection('groups').where('eventId', '==', eventId).limit(101).get(),
      getDatabaseWithUrl(rtdbUrl.value(), getApp()).ref(`liveLocations/${eventId}`).get(),
    ]);
    if (groupsQuery.size > 100) throw Error('Collision detection supports at most 100 groups per event.');
    const raw = positionsSnap.val() as Record<string, Record<string, unknown>> | null, now = Date.now();
    const candidates = groupsQuery.docs.flatMap(doc => {
      const group = doc.data(), position = raw?.[doc.id] ?? null;
      return typeof group.routeId === 'string' && group.routeId && group.deleting !== true && group.status !== 'completed' &&
        usableSample(position, now) && position.userId === group.leaderUserId ? [{ id: doc.id, group, position }] : [];
    });
    const leaderIds = [...new Set(candidates.map(c => c.position.userId))];
    const leaders = new Map((leaderIds.length ? await database.getAll(...leaderIds.map(id => database.doc(`users/${id}`))) : []).map(s => [s.id, s.data()]));
    for (const { id, group, position } of candidates) {
      const leader = leaders.get(position.userId);
      if (leader?.isActive !== true || leader.deleting === true || leader.role !== 'teamLeader' || leader.assignedGroupId !== id) continue;
      groups.push({ id, routeId: group.routeId, latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracyMeters, recordedAt: position.recordedAt });
    }
  }
  const routeCounts = new Map<string, number>();
  for (const group of groups) routeCounts.set(group.routeId, (routeCounts.get(group.routeId) ?? 0) + 1);
  // No valid stop can be crowded by fewer than two groups. Load each route once,
  // reusing the shared immutable, version-keyed stop configuration cache.
  const configurations = (await Promise.all([...routeCounts].filter(([, count]) => count > 1).map(([id]) => loadRouteConfiguration(id))))
    .filter(configuration => configuration.eventId === eventId);
  const stops: CollisionStop[] = [];
  for (const configuration of configurations) {
    for (const s of configuration.stops) {
      if (Number.isInteger(s.maxAllowedGroups) && s.maxAllowedGroups >= 1) stops.push({ id: s.id, routeId: configuration.routeId,
        latitude: s.latitude, longitude: s.longitude, radiusMeters: s.geofenceRadiusMeters, maxAllowedGroups: s.maxAllowedGroups });
    }
    if (stops.length > 400) throw Error('Collision detection supports at most 400 stops per event.');
  }
  await database.runTransaction(async tx => {
    const [scan, event, previousAlerts, routes] = await Promise.all([
      tx.get(scanRef), tx.get(eventRef),
      // Reading this query INSIDE publication prevents an overlapping scan from
      // creating an incident after our resolution target list was captured.
      tx.get(database.collection('collisionAlerts').where('eventId', '==', eventId).where('status', 'in', ['active', 'suppressed'])),
      configurations.length ? tx.getAll(...configurations.map(c => database.doc(`routes/${c.routeId}`))) : Promise.resolve([]),
    ]);
    if (Number(scan.data()?.completedRevision ?? 0) >= revision) return;
    const active = event.data()?.status === 'active' && event.data()?.deleting !== true;
    if (active && (initialEvent?.status !== 'active' || initialEvent?.deleting === true)) throw Error('Event became active during collision scan; retry.');
    if (active && configurations.some((c, i) => routeConfigurationVersion(routes[i]) !== c.version)) throw Error('Route configuration changed during collision scan; retry.');
    const now = Date.now();
    const validRoutes = new Set(routes.filter(s => s.data()?.eventId === eventId && s.data()?.deleting !== true).map(s => s.id));
    const fresh = groups.filter(g => now - g.recordedAt <= maximumSampleAgeMs && g.recordedAt <= now + 5000 && validRoutes.has(g.routeId));
    const collisions = new Map((active ? findCollisions(fresh, stops, now) : []).map(c => [`${eventId}_${c.stopPointId}`, c]));
    const previous = new Map<string, DocumentData | undefined>(previousAlerts.docs.map(s => [s.id, s.data()]));
    const missing = [...collisions.keys()].filter(id => !previous.has(id));
    if (missing.length) for (const snap of await tx.getAll(...missing.map(id => database.doc(`collisionAlerts/${id}`)))) previous.set(snap.id, snap.data());
    // Sparse: current collisions plus previously live incidents only. Configured
    // empty stops and resolved history incur no per-stop transactions or reads.
    for (const [alertId, old] of previous) {
      const ref = database.doc(`collisionAlerts/${alertId}`), found = collisions.get(alertId);
      if (found) {
        if (old?.status === 'suppressed') { tx.update(ref, { lastSeenAt: Timestamp.fromMillis(now), scanRevision: revision }); continue; }
        const recurring = !old || !['active', 'suppressed'].includes(String(old.status));
        const generation = recurring ? Number(old?.incidentGeneration ?? 0) + 1 : Number(old.incidentGeneration ?? 1);
        const fields = { eventId, stopPointId: found.stopPointId, affectedGroupIds: found.groupIds, count: found.count, maxAllowedGroups: found.maximum, severity: found.severity,
          status: 'active', incidentGeneration: generation, incidentId: recurring || !old?.incidentId ? incidentIdentity(alertId, revision) : old.incidentId,
          lastSeenAt: Timestamp.fromMillis(now), scanRevision: revision };
        if (recurring) tx.set(ref, { ...fields, createdAt: Timestamp.fromMillis(now), resolvedAt: null, lastInstructionId: null });
        else tx.update(ref, fields);
      } else if (old && ['active', 'suppressed'].includes(String(old.status))) tx.update(ref, { status: 'resolved', resolvedAt: FieldValue.serverTimestamp(), scanRevision: revision });
    }
    tx.set(scanRef, { completedRevision: revision, completedAt: Timestamp.fromMillis(now) }, { merge: true });
  });
}

/** Coalesce many phones updating together into at most one whole-event scan per three seconds. */
export async function claimCollisionScan(eventId: string, now = Date.now()): Promise<boolean> {
  return db().runTransaction(async tx => {
    const ref = db().doc(`collisionScanRequests/${eventId}`), previous = (await tx.get(ref)).data();
    const last = previous?.startedAt instanceof Timestamp ? previous.startedAt.toMillis() : 0;
    if (last && now - last < 3000) return false;
    tx.set(ref, { eventId, startedAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + 86400000) });
    return true;
  });
}
export const detectGroupCollision = onValueWritten({ ref: '/liveLocations/{eventId}/{groupId}', region: 'us-central1', maxInstances: 10, retry: true }, async event => {
  const eventId = event.params.eventId, startedAt = Date.now();
  if (!await claimCollisionScan(eventId, startedAt)) return;
  try { await recountCollisions(eventId); }
  catch (error) {
    // Retry must not be swallowed by the successful-claim throttle. Never release
    // a newer scan's claim if the failed scan ran longer than the window.
    await db().runTransaction(async tx => {
      const ref = db().doc(`collisionScanRequests/${eventId}`), claim = (await tx.get(ref)).data();
      if (claim?.startedAt instanceof Timestamp && claim.startedAt.toMillis() === startedAt) tx.delete(ref);
    });
    throw error;
  }
});

type CollisionReconciliationSources = { workerName?: string; events?: Query; alerts?: Query; scan?: (eventId: string) => Promise<void> };

/** Discovery and execution have independent rotating cursors. Enqueue/checkpoint
 * atomically before scanning, so crashes, poison events and deadlines cannot lose
 * work or pin later events behind the same first page. */
export async function processCollisionReconciliation(budget: CursorBudget = {}, sources: CollisionReconciliationSources = {}): Promise<void> {
  const database = db(), worker = await claimWorker(sources.workerName ?? 'collisionReconciliation');
  if (!worker) return;
  const queue = worker.ref.collection('events'), scan = sources.scan ?? recountCollisions;
  const bases = [sources.events ?? database.collection('events').where('status', '==', 'active'),
    sources.alerts ?? database.collection('collisionAlerts').where('status', 'in', ['active', 'suppressed']), queue];
  const keys = ['eventId', 'alertId', 'workId'] as const;
  const pageSize = Math.max(1, Math.min(100, budget.pageSize ?? 20)), maxPages = Math.max(1, Math.min(12, budget.maxPages ?? 6));
  const concurrency = Math.max(1, Math.min(8, budget.concurrency ?? 4)), deadline = Date.now() + Math.max(1, Math.min(90000, budget.maxRunMs ?? 35000));
  const cursor = { ...worker.cursor }, seen = new Set<string>();
  let nextSource = Math.max(0, Math.trunc(Number(cursor.nextSource) || 0)) % bases.length, processed = 0, failed = 0, infrastructureFailures = 0;
  try {
    for (let pageNumber = 0; pageNumber < maxPages && Date.now() < deadline; pageNumber++) {
      const source = nextSource, key = keys[source];
      nextSource = (source + 1) % bases.length;
      // Rotate even if this source's query fails or a slow scan times out.
      if (!await checkpointWorker(worker, { nextSource })) return;
      try {
        let query = bases[source].orderBy(FieldPath.documentId()).limit(pageSize);
        if (typeof cursor[key] === 'string' && cursor[key]) query = query.startAfter(cursor[key]);
        const page = await query.get(), id = page.size === pageSize ? page.docs[page.size - 1].id : '';
        const eventIds = source === 2 ? [] : [...new Set(page.docs.map(doc => source === 0 ? doc.id : doc.data().eventId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0))];
        const advanced = await database.runTransaction(async tx => {
          if ((await tx.get(worker.ref)).data()?.lease !== worker.lease) return false;
          const jobs = eventIds.length ? await tx.getAll(...eventIds.map(eventId => queue.doc(eventId))) : [];
          const now = Timestamp.now();
          for (const job of jobs) if (!job.exists) tx.create(job.ref, { eventId: job.id, attempts: 0, requestedAt: now, nextAttemptAt: now });
          tx.update(worker.ref, { [key]: id, updatedAt: now, leaseUntil: Timestamp.fromMillis(Date.now() + 120000) });
          return true;
        });
        if (!advanced) return;
        cursor[key] = id;
        if (source !== 2) continue;
        // Advance work cursor before starting. Unstarted/deferred jobs remain in
        // the durable queue and are revisited after wrap, not silently skipped.
        const result = await boundedWork(page.docs, concurrency, async job => {
          if (seen.has(job.id)) return;
          seen.add(job.id);
          const attempt = await database.runTransaction(async tx => {
            const [state, current] = await Promise.all([tx.get(worker.ref), tx.get(job.ref)]), now = Date.now();
            const value = current.data();
            if (state.data()?.lease !== worker.lease || !value || millis(value.nextAttemptAt) > now || millis(value.leaseUntil) > now) return 0;
            const attempt = Number(value.attempts ?? 0) + 1;
            tx.update(job.ref, { attempts: attempt, lease: worker.lease, leaseUntil: Timestamp.fromMillis(now + 120000) });
            return attempt;
          });
          if (!attempt) return;
          let failure: unknown;
          let succeeded = false;
          try { await scan(job.id); succeeded = true; }
          catch (error) { failure = error; failed++; logError('Collision reconciliation failed', { eventId: job.id, error }); }
          await database.runTransaction(async tx => {
            if ((await tx.get(job.ref)).data()?.lease !== worker.lease) return;
            if (succeeded) tx.delete(job.ref);
            else tx.update(job.ref, { lastError: String(failure).slice(0, 500), lastFailedAt: Timestamp.now(),
              nextAttemptAt: Timestamp.fromMillis(Date.now() + Math.min(3600000, 120000 * 2 ** Math.min(5, attempt - 1))),
              lease: FieldValue.delete(), leaseUntil: FieldValue.delete() });
          });
          processed++;
        }, deadline);
        infrastructureFailures += result.failed;
      } catch (error) {
        infrastructureFailures++; logError('Collision reconciliation page failed', { source, error });
      }
    }
  } finally {
    await checkpointWorker(worker, { nextSource, processed, failed, infrastructureFailures, lastRunAt: Timestamp.now() }, true);
  }
  // Event errors are durable retries, not invocation failures. Only storage/query
  // failures need scheduler retry; their cursors/jobs are already recoverable.
  if (infrastructureFailures) throw Error('Collision reconciliation checkpoint/query failed; retry.');
}

/** Active-event discovery and stale/completed-incident repair both get a turn. */
export const reconcileGroupCollisions = onSchedule({ schedule: 'every 2 minutes', timeZone: 'Etc/UTC', maxInstances: 1,
  concurrency: 1, timeoutSeconds: 120, retryCount: 3 }, async () => {
  await processCollisionReconciliation();
});
