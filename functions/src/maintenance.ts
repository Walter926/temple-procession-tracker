import { getApp } from 'firebase-admin/app';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { getFirestore, FieldPath, FieldValue, Timestamp, type DocumentData, type Query } from 'firebase-admin/firestore';
import { defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onValueCreated } from 'firebase-functions/v2/database';
import { generateIncidentSuggestions } from './route_suggestions';
import { boundedWork, checkpointWorker, claimWorker, drainCursorQueue, millis, type CursorBudget } from './notifications';
import { maximumSampleAgeMs, usableSample } from './route_progress';

const db = getFirestore;
const rtdbUrl = defineString('RTDB_URL');
const day = 86400000;

export function reconciledTrackingState(status: DocumentData | null, authorized: boolean, now: number): string {
  if (!authorized) return 'stopped';
  if (!status) return 'disconnected';
  const state = String(status.state ?? 'disconnected');
  if (['stopped', 'paused', 'error'].includes(state)) return state;
  return state === 'active' && millis(status.updatedAt) > 0 && millis(status.updatedAt) <= now + 5000 && now - millis(status.updatedAt) <= maximumSampleAgeMs ? 'active' : 'disconnected';
}

/** No incoming GPS is needed to mark a vanished device disconnected or its position stale. */
export async function processTrackingHeartbeats(budget: CursorBudget = {}): Promise<void> {
  const database = getDatabaseWithUrl(rtdbUrl.value(), getApp());
  await drainCursorQueue('trackingHeartbeats', db().collection('groups'), async groupDoc => {
      const group = groupDoc.data(), eventId = String(group.eventId ?? '');
      if (!eventId) return;
      const statusRef = database.ref(`trackingStatus/${eventId}/${groupDoc.id}`);
      const [statusSnap, positionSnap] = await Promise.all([statusRef.get(), database.ref(`liveLocations/${eventId}/${groupDoc.id}`).get()]);
      const status = statusSnap.val() as DocumentData | null, position = positionSnap.val() as Record<string, unknown> | null, now = Date.now();
      const state = await db().runTransaction(async tx => {
        const progressRef = db().doc(`groupProgress/${groupDoc.id}`);
        const [currentGroup, eventSnap, userSnap, progressSnap] = await Promise.all([
          tx.get(groupDoc.ref), tx.get(db().doc(`events/${eventId}`)), group.leaderUserId ? tx.get(db().doc(`users/${group.leaderUserId}`)) : Promise.resolve(null), tx.get(progressRef),
        ]);
        const current = currentGroup.data(), event = eventSnap.data(), user = userSnap?.data(), progress = progressSnap.data();
        const authorized = Boolean(current && current.eventId === eventId && current.leaderUserId === group.leaderUserId && current.status !== 'completed' && current.deleting !== true &&
          event?.status === 'active' && event.deleting !== true && user?.isActive === true && user.deleting !== true && user.role === 'teamLeader' && user.assignedGroupId === groupDoc.id &&
          status?.userId === current.leaderUserId);
        const trackingState = reconciledTrackingState(status, authorized, now);
        const latestAt = Math.max(millis(progress?.lastLocationAt), typeof position?.recordedAt === 'number' ? position.recordedAt : 0);
        const stale = !authorized || !usableSample(position, now) || position.userId !== current?.leaderUserId;
        if (current && current.eventId === eventId && (progress?.isStale !== stale || progress?.trackingState !== trackingState || millis(progress?.lastHeartbeatAt) !== millis(status?.updatedAt))) {
          tx.set(progressRef, { eventId, groupId: groupDoc.id, trackingState, isStale: stale, lastHeartbeatAt: millis(status?.updatedAt) ? Timestamp.fromMillis(millis(status?.updatedAt)) : null,
            staleSince: stale ? progress?.staleSince ?? Timestamp.fromMillis(latestAt ? Math.min(now, latestAt + maximumSampleAgeMs) : now) : null, reconciledAt: Timestamp.fromMillis(now) }, { merge: true });
        }
        return trackingState;
      });
      if (status && state !== status.state) await statusRef.transaction(current => {
        // Never overwrite a newer heartbeat/session written during the Firestore checks.
        if (!current) return null; // Initial transaction cache may be empty; let the server retry.
        if (current.userId !== status.userId || current.updatedAt !== status.updatedAt || current.state !== status.state) return;
        return { ...current, state, reconciledAt: now, reason: state === 'disconnected' ? 'heartbeat-timeout' : 'authorization-ended' };
      });
  }, { maxPages: 8, ...budget });
}

export const reconcileTrackingHeartbeats = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Etc/UTC', maxInstances: 1, concurrency: 1, timeoutSeconds: 120 }, async () => {
  await processTrackingHeartbeats();
});

export async function processOperationalMessages(now = Date.now(), budget: CursorBudget = {}): Promise<void> {
  // Independent cursors/budgets give every collection and active-incident repair a turn.
  await Promise.all([
    ...['routeSuggestions', 'routeInstructions', 'collisionInstructions', 'collisionWarnings', 'notifications', 'announcements', 'publicAnnouncements'].map(collection =>
      drainCursorQueue(`lifecycle_${collection}`, db().collection(collection).where('lifecycleDueAt', '<=', Timestamp.fromMillis(now)), doc => db().runTransaction(async tx => {
        const record = (await tx.get(doc.ref)).data();
        if (!record || !millis(record.lifecycleDueAt) || millis(record.lifecycleDueAt) > Date.now()) return;
        const changes: DocumentData = { lifecycleDueAt: FieldValue.delete() };
        if (collection === 'routeSuggestions') {
          if (record.status === 'pending') changes.status = 'expired';
          if (record.lifecycleState === 'active') { changes.lifecycleState = 'expired'; changes.endedAt = Timestamp.now(); }
        } else if (['active', 'acknowledged'].includes(String(record.state)) || collection === 'publicAnnouncements') {
          changes.state = 'expired'; changes.endedAt = Timestamp.now();
          if (collection === 'announcements' || collection === 'publicAnnouncements') { changes.isActive = false; changes.updatedAt = Timestamp.now(); }
        }
        tx.update(doc.ref, changes);
      }), { pageSize: 200, concurrency: 4, ...budget }, 'lifecycleDueAt')),
    drainCursorQueue('activeIncidentRepair', db().collection('collisionAlerts').where('status', '==', 'active'), doc => generateIncidentSuggestions(doc.id), { concurrency: 4, ...budget }),
  ]);
}

export const expireOperationalMessages = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Etc/UTC', maxInstances: 1, concurrency: 1, timeoutSeconds: 120 }, async () => {
  await processOperationalMessages();
});

export const retentionPolicies = [
  { collection: 'collisionScanRequests', field: 'expiresAt', ageMs: 0 },
  { collection: 'locationHistory', field: 'recordedAt', ageMs: 7 * day },
  { collection: 'locationUpdates', field: 'recordedAt', ageMs: day },
  { collection: 'stopPresence', field: 'lastSeenAt', ageMs: day },
  { collection: 'notifications', field: 'createdAt', ageMs: 30 * day },
  { collection: 'notificationDeliveries', field: 'createdAt', ageMs: 30 * day },
  { collection: 'notificationFanouts', field: 'createdAt', ageMs: 30 * day },
  { collection: 'routeSuggestions', field: 'createdAt', ageMs: 30 * day },
  { collection: 'routeInstructions', field: 'createdAt', ageMs: 30 * day },
  { collection: 'collisionInstructions', field: 'createdAt', ageMs: 30 * day },
  { collection: 'collisionWarnings', field: 'createdAt', ageMs: 30 * day },
  { collection: 'collisionAlerts', field: 'resolvedAt', ageMs: 30 * day },
  { collection: 'announcements', field: 'createdAt', ageMs: 30 * day },
  { collection: 'publicAnnouncements', field: 'createdAt', ageMs: 30 * day },
  { collection: 'arrivalNotifications', field: 'createdAt', ageMs: 30 * day },
  { collection: 'deviceTokens', field: 'expiresAt', ageMs: 0 },
  { collection: 'deviceTokenOwners', field: 'expiresAt', ageMs: 0 },
  { collection: 'accessCodes', field: 'expiresAt', ageMs: 7 * day },
  { collection: 'operationLimits', field: 'expiresAt', ageMs: 0 },
] as const;

export type RetentionBudget = { pageSize?: number; historyPages?: number; otherPages?: number; maxPages?: number; maxRunMs?: number };

function retainedQuery(policy: typeof retentionPolicies[number], now: number): Query {
  let query: Query = db().collection(policy.collection).where(policy.field, '<=', Timestamp.fromMillis(now - policy.ageMs));
  if (policy.collection === 'collisionAlerts') query = query.where('status', '==', 'resolved');
  return query.orderBy(policy.field).orderBy(FieldPath.documentId());
}

/**
 * Indexed expired ranges only. Round-robin pages and a persisted dispatcher cursor
 * reserve service for small collections even during a sustained history backlog.
 * Default history capacity: 4,800/minute (6.912M/day), versus 576K/day ingestion.
 */
export async function cleanupRetainedRecords(now = Date.now(), budget: RetentionBudget = {}): Promise<number> {
  const worker = await claimWorker('retention');
  if (!worker) return 0;
  const pageSize = Math.max(1, Math.min(400, budget.pageSize ?? 400)), deadline = Date.now() + (budget.maxRunMs ?? 45000);
  const contexts = retentionPolicies.map(policy => ({ policy, pages: 0, removed: 0, failed: 0, exhausted: false,
    limit: policy.collection === 'locationHistory' ? budget.historyPages ?? 12 : budget.otherPages ?? 2 }));
  let nextPolicy = Number(worker.cursor.nextPolicy ?? 0) % contexts.length, pages = 0, removed = 0;
  try {
    while (pages < (budget.maxPages ?? 48) && Date.now() < deadline) {
      const turn: typeof contexts = [];
      for (let checked = 0; checked < contexts.length && turn.length < 4 && pages + turn.length < (budget.maxPages ?? 48); checked++) {
        const context = contexts[nextPolicy];
        nextPolicy = (nextPolicy + 1) % contexts.length;
        if (!context.exhausted && context.pages < context.limit) turn.push(context);
      }
      if (!turn.length) break;
      await Promise.all(turn.map(async context => {
        const { policy } = context, cursorRef = db().doc(`maintenanceCursors/retention_${policy.collection}`);
        context.pages++; pages++;
        try {
          const cursor = (await cursorRef.get()).data();
          let query = retainedQuery(policy, now).limit(pageSize);
          if (cursor?.value instanceof Timestamp && typeof cursor.id === 'string') query = query.startAfter(cursor.value, cursor.id);
          const page = await query.get(), last = page.docs[page.size - 1];
          const count = await db().runTransaction(async tx => {
            const owner = (await tx.get(worker.ref)).data();
            if (owner?.lease !== worker.lease || millis(owner.leaseUntil) <= Date.now()) throw new Error('retention-lease-lost');
            const fresh = page.empty ? [] : await tx.getAll(...page.docs.map(doc => doc.ref));
            let count = 0;
            for (const doc of fresh) {
              const record = doc.data();
              if (!record || !millis(record[policy.field]) || millis(record[policy.field]) > now - policy.ageMs || (policy.collection === 'collisionAlerts' && record.status !== 'resolved')) continue;
              tx.delete(doc.ref); count++;
            }
            // The deletion and its checkpoint commit together, including after a retry/crash.
            tx.set(cursorRef, { id: page.size === pageSize ? last.id : FieldValue.delete(), value: page.size === pageSize ? last.get(policy.field) : FieldValue.delete(), updatedAt: Timestamp.now() }, { merge: true });
            return count;
          });
          context.removed += count; removed += count;
          context.exhausted = page.size < pageSize;
        } catch { context.failed++; context.exhausted = true; }
      }));
      if (!await checkpointWorker(worker, { nextPolicy, pages, removed })) return removed;
    }
    await boundedWork(contexts.filter(context => context.pages > 0), 4, async context => {
      const { policy } = context;
      try {
        const oldest = (await retainedQuery(policy, now).limit(1).get()).docs[0], oldestAt = oldest ? millis(oldest.get(policy.field)) : 0;
        await db().doc(`maintenanceCursors/retention_${policy.collection}`).set({ lastRunAt: Timestamp.now(), pages: context.pages, removed: context.removed,
          failed: context.failed, hasMore: Boolean(oldest), oldestExpiredAt: oldest?.get(policy.field) ?? null,
          oldestRecordAgeMs: oldestAt ? Math.max(0, now - oldestAt) : 0, oldestBacklogAgeMs: oldestAt ? Math.max(0, now - policy.ageMs - oldestAt) : 0 }, { merge: true });
      } catch { context.failed++; }
    });
  } finally {
    const failed = contexts.reduce((sum, context) => sum + context.failed, 0);
    await checkpointWorker(worker, { nextPolicy, lastRunAt: Timestamp.now(), pages, removed, failed }, true);
    console.info('Indexed retention pass', { pages, removed, failed, historyCapacityPerMinute: 4800 });
  }
  return removed;
}

/** Directory registration happens once per new RTDB event branch, not on every GPS sample. */
export const registerLiveLocationRetention = onValueCreated({ ref: 'liveLocations/{eventId}', retry: true, maxInstances: 5 }, async event => {
  await db().doc(`liveLocationRetentionEvents/${event.params.eventId}`).set({ discoveredAt: Timestamp.now() }, { merge: true });
});

/** Keys-only bootstrap/repair also discovers orphan branches whose Firestore event was deleted. */
export async function discoverLiveLocationEvents(maxEvents = 500): Promise<void> {
  const worker = await claimWorker('liveLocationDiscovery');
  if (!worker) return;
  try {
    const database = getDatabaseWithUrl(rtdbUrl.value(), getApp()), url = new URL(database.ref('liveLocations').toString() + '.json');
    url.searchParams.set('shallow', 'true');
    const namespace = new URL(rtdbUrl.value()).searchParams.get('ns');
    if (namespace) url.searchParams.set('ns', namespace);
    const emulator = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    const headers: Record<string, string> = {};
    if (emulator) { url.host = emulator; url.protocol = 'http:'; headers.Authorization = 'Bearer owner'; }
    else {
      const token = await getApp().options.credential?.getAccessToken();
      if (!token) throw new Error('retention-discovery-credential-unavailable');
      headers.Authorization = `Bearer ${token.access_token}`;
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('retention-discovery-unavailable');
    const keys = Object.keys(await response.json() as Record<string, unknown> ?? {}).sort();
    const remaining = keys.filter(key => key > String(worker.cursor.id ?? '')), page = remaining.slice(0, maxEvents);
    const result = await boundedWork(page, 8, eventId => db().doc(`liveLocationRetentionEvents/${eventId}`).set({ discoveredAt: Timestamp.now() }, { merge: true }));
    if (result.failed) throw new Error('retention-discovery-retry');
    await checkpointWorker(worker, { id: remaining.length > page.length ? page[page.length - 1] : FieldValue.delete(), hasMore: remaining.length > page.length,
      discovered: page.length, lastRunAt: Timestamp.now(), failed: 0 }, true);
  } catch {
    await checkpointWorker(worker, { failed: 1, lastRunAt: Timestamp.now() }, true);
    throw new Error('retention-discovery-retry');
  }
}

export const discoverLiveLocationRetention = onSchedule({ schedule: 'every 60 minutes', timeZone: 'Etc/UTC', maxInstances: 1, concurrency: 1, timeoutSeconds: 120 }, async () => {
  await discoverLiveLocationEvents();
});

export type LiveRetentionBudget = CursorBudget & { discover?: boolean; groupPageSize?: number; groupPages?: number };
/** Indexed, per-event expired pages: no download of every active event's precise positions. */
export async function cleanupLiveLocations(now = Date.now(), budget: LiveRetentionBudget = {}): Promise<number> {
  if (budget.discover !== false) await discoverLiveLocationEvents(); // Preserve the direct test/operator API.
  const database = getDatabaseWithUrl(rtdbUrl.value(), getApp()), cutoff = now - 7 * day;
  let removed = 0;
  await drainCursorQueue('liveLocations', db().collection('liveLocationRetentionEvents'), async eventDoc => {
    const eventRef = database.ref(`liveLocations/${eventDoc.id}`), pageSize = Math.max(1, Math.min(400, budget.groupPageSize ?? 200));
    let cursor = eventDoc.data(), eventRemoved = 0, failed = 0;
    for (let pageNumber = 0; pageNumber < (budget.groupPages ?? 2); pageNumber++) {
      let query = eventRef.orderByChild('recordedAt').endAt(cutoff).limitToFirst(pageSize);
      if (cursor.groupId) query = query.startAfter(cursor.value ?? null, cursor.groupId);
      const page = await query.get(), samples: { id: string; value: number | null }[] = [];
      page.forEach(child => { samples.push({ id: child.key!, value: typeof child.val()?.recordedAt === 'number' ? child.val().recordedAt : null }); });
      const result = await boundedWork(samples, 8, async sample => {
        const result = await eventRef.child(sample.id).transaction(current => {
          if (!current) return null;
          if (typeof current.recordedAt === 'number' && current.recordedAt > cutoff) return;
          return null;
        });
        if (result.committed && result.snapshot.val() === null) { removed++; eventRemoved++; }
      });
      failed += result.failed;
      const last = samples[samples.length - 1];
      cursor = samples.length === pageSize ? { groupId: last.id, value: last.value } : {};
      await eventDoc.ref.set({ groupId: cursor.groupId ?? FieldValue.delete(), value: cursor.value ?? FieldValue.delete() }, { merge: true });
      if (samples.length < pageSize) break;
    }
    const oldest = await eventRef.orderByChild('recordedAt').endAt(cutoff).limitToFirst(1).get();
    let oldestAt: number | null = null;
    oldest.forEach(child => { oldestAt = typeof child.val()?.recordedAt === 'number' ? child.val().recordedAt : 0; });
    if (!oldest.exists() && !(await eventRef.orderByKey().limitToFirst(1).get()).exists()) { await eventDoc.ref.delete(); return; }
    await eventDoc.ref.set({ removed: eventRemoved, failed, lastRunAt: Timestamp.now(), hasMore: oldest.exists(), oldestExpiredAt: oldestAt,
      oldestBacklogAgeMs: oldestAt === null ? 0 : Math.max(0, cutoff - oldestAt) }, { merge: true });
  }, { pageSize: 25, concurrency: 4, ...budget });
  const oldestKnown = (await db().collection('liveLocationRetentionEvents').where('oldestExpiredAt', '>=', 0).orderBy('oldestExpiredAt').limit(1).get()).docs[0];
  await db().doc('maintenanceCursors/liveLocations').set({ removed, oldestKnownExpiredAt: oldestKnown?.get('oldestExpiredAt') ?? null,
    oldestBacklogAgeMs: oldestKnown ? Math.max(0, cutoff - Number(oldestKnown.get('oldestExpiredAt'))) : 0 }, { merge: true });
  return removed;
}

export const cleanupRetention = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Etc/UTC', maxInstances: 1, concurrency: 1, timeoutSeconds: 120 }, async () => {
  const results = await Promise.allSettled([cleanupRetainedRecords(), cleanupLiveLocations(Date.now(), { discover: false })]);
  const failed = results.filter(result => result.status === 'rejected').length;
  console.info('Retention cleanup completed', { removed: results[0].status === 'fulfilled' ? results[0].value : 0,
    removedLiveLocations: results[1].status === 'fulfilled' ? results[1].value : 0, failed });
  if (failed) throw new Error('retention-worker-retry');
});
