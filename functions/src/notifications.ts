import { createHash, randomUUID } from 'node:crypto';
import { getFirestore, FieldPath, FieldValue, Timestamp, type DocumentData, type DocumentReference, type Query, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { documentId, requireActiveUser, requireEventManager } from './authorization';
export { documentId } from './authorization';

const db = getFirestore;
const callableOptions = { maxInstances: 10, enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true' };
const day = 86400000;
export const digest = (...parts: string[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export function millis(value: unknown): number {
  return value instanceof Timestamp ? value.toMillis() : typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** A slow item occupies one slot, not the entire queue; failures never stop its peers. */
export async function boundedWork<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<unknown>, deadline = Infinity): Promise<{ started: number; failed: number }> {
  let started = 0, failed = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (started < items.length && Date.now() < deadline) {
      const item = items[started++];
      try { await work(item); } catch { failed++; }
    }
  }));
  return { started, failed };
}

export type WorkerLease = { ref: DocumentReference; lease: string; cursor: DocumentData };
/** Persisted cursor and lease fence overlapping scheduler invocations, including retries. */
export async function claimWorker(name: string): Promise<WorkerLease | null> {
  const ref = db().doc(`maintenanceCursors/${name}`), lease = randomUUID();
  return db().runTransaction(async tx => {
    const cursor = (await tx.get(ref)).data() ?? {};
    if (millis(cursor.leaseUntil) > Date.now()) return null;
    tx.set(ref, { lease, leaseUntil: Timestamp.fromMillis(Date.now() + 120000) }, { merge: true });
    return { ref, lease, cursor };
  });
}

export async function checkpointWorker(worker: WorkerLease, changes: DocumentData, release = false): Promise<boolean> {
  return db().runTransaction(async tx => {
    if ((await tx.get(worker.ref)).data()?.lease !== worker.lease) return false;
    tx.update(worker.ref, { ...changes, updatedAt: Timestamp.now(),
      lease: release ? FieldValue.delete() : worker.lease,
      leaseUntil: release ? FieldValue.delete() : Timestamp.fromMillis(Date.now() + 120000) });
    return true;
  });
}

export type CursorBudget = { maxPages?: number; pageSize?: number; concurrency?: number; maxRunMs?: number };
/** Failed items are revisited after wrap, rather than pinning every run to a poison first page. */
export async function drainCursorQueue(name: string, base: Query, work: (doc: QueryDocumentSnapshot) => Promise<unknown>, budget: CursorBudget = {}, orderField?: string): Promise<void> {
  const worker = await claimWorker(name);
  if (!worker) return;
  const pageSize = Math.max(1, Math.min(400, budget.pageSize ?? 100)), deadline = Date.now() + (budget.maxRunMs ?? 35000);
  const ordered = orderField ? base.orderBy(orderField).orderBy(FieldPath.documentId()) : base.orderBy(FieldPath.documentId());
  let cursor = worker.cursor, processed = 0, failed = 0, hasMore = true;
  try {
    for (let pageNumber = 0; pageNumber < (budget.maxPages ?? 4) && Date.now() < deadline; pageNumber++) {
      let query = ordered.limit(pageSize);
      if (typeof cursor.id === 'string' && cursor.id) query = orderField && cursor.value !== undefined ? query.startAfter(cursor.value, cursor.id) : query.startAfter(cursor.id);
      const page = await query.get();
      const result = await boundedWork(page.docs, budget.concurrency ?? 8, work, deadline);
      processed += result.started; failed += result.failed;
      hasMore = result.started < page.size || page.size === pageSize;
      const last = page.docs[result.started - 1];
      cursor = hasMore ? last ? { id: last.id, ...(orderField ? { value: last.get(orderField) } : {}) } : cursor : {};
      if (!await checkpointWorker(worker, { id: cursor.id ?? FieldValue.delete(), value: cursor.value ?? FieldValue.delete(), processed, failed, hasMore })) return;
      if (!hasMore || result.started < page.size) break;
    }
  } catch { failed++; }
  const metrics: DocumentData = { lastRunAt: Timestamp.now(), processed, failed, hasMore };
  if (orderField) {
    try {
      const oldest = (await ordered.limit(1).get()).docs[0];
      metrics.oldestDueAt = oldest?.get(orderField) ?? null;
      metrics.oldestBacklogAgeMs = oldest ? Math.max(0, Date.now() - millis(oldest.get(orderField))) : 0;
    } catch { metrics.failed = ++failed; }
  }
  await checkpointWorker(worker, metrics, true);
  if (failed) console.warn('Bounded worker will revisit failed items', { worker: name, failed, processed });
}

// Transaction-aware local policy; no client assignment/profile field authorizes membership.
export async function activeAccount(tx: Transaction, uid?: string): Promise<DocumentData> {
  return requireActiveUser(uid, tx);
}
export async function eventManager(tx: Transaction, uid: string | undefined, eventId: string): Promise<DocumentData> {
  return (await requireEventManager(uid, eventId, tx)).event;
}

export type Notice = {
  uid: string; eventId: string; groupId?: string; title: string; body: string; type: string;
  sourceCollection: 'announcements' | 'collisionWarnings' | 'routeInstructions'; sourceId: string;
  expiresAt: Timestamp; leaderOnly?: boolean;
};

/** Call only after all reads, with a deterministic ID. Persistence and outbox are atomic. */
export function queueNotification(tx: Transaction, id: string, notice: Notice): void {
  const createdAt = Timestamp.now();
  tx.create(db().doc(`notifications/${id}`), { ...notice, groupId: notice.groupId ?? '', leaderOnly: notice.leaderOnly === true,
    state: 'active', isRead: false, readAt: null, createdAt, lifecycleDueAt: notice.expiresAt, retentionAt: Timestamp.fromMillis(createdAt.toMillis() + 30 * day),
    targetUserIds: [notice.uid], targetGroupIds: notice.groupId ? [notice.groupId] : [], readByUserIds: [], severity: notice.type === 'collision' ? 'high' : 'low' });
  tx.create(db().doc(`notificationDeliveries/${id}`), { uid: notice.uid, notificationId: id, state: 'pending', attempts: 0,
    deliveredTokenIds: [], nextAttemptAt: createdAt, createdAt, retentionAt: Timestamp.fromMillis(createdAt.toMillis() + 30 * day) });
}

/** Rechecked both before fan-out and before every push attempt, including private events. */
export async function eligibleRecipient(tx: Transaction, uid: string, eventId: string, groupId = '', leaderOnly = false): Promise<boolean> {
  const [userSnap, eventSnap, memberSnap, groupSnap] = await Promise.all([
    tx.get(db().doc(`users/${uid}`)), tx.get(db().doc(`events/${eventId}`)),
    tx.get(db().doc(`memberships/${eventId}_${uid}`)), groupId ? tx.get(db().doc(`groups/${groupId}`)) : Promise.resolve(null),
  ]);
  const user = userSnap.data(), event = eventSnap.data(), member = memberSnap.data(), group = groupSnap?.data();
  if (user?.isActive !== true || user.deleting === true || !event || event.deleting === true || ['completed', 'cancelled', 'archived'].includes(String(event.status))) return false;
  const assigned = group?.eventId === eventId && group.deleting !== true && [group.leaderUserId, group.backupLeaderUserId].includes(uid) && user.role === 'teamLeader' && user.assignedGroupId === groupId;
  if (leaderOnly) return assigned && group?.leaderUserId === uid;
  if (groupId) return assigned || (group?.eventId === eventId && member?.uid === uid && member.eventId === eventId && member.groupId === groupId && member.isActive !== false && !['removed', 'revoked'].includes(String(member.status)));
  if (user.role === 'admin' || (user.role === 'organizer' && event.organizerId === uid)) return true;
  if (member?.uid === uid && member.eventId === eventId && member.isActive !== false && !['removed', 'revoked'].includes(String(member.status))) return true;
  if (user.role === 'teamLeader' && typeof user.assignedGroupId === 'string' && user.assignedGroupId) {
    const assignedGroup = (await tx.get(db().doc(`groups/${user.assignedGroupId}`))).data();
    return assignedGroup?.eventId === eventId && assignedGroup.deleting !== true && [assignedGroup.leaderUserId, assignedGroup.backupLeaderUserId].includes(uid);
  }
  return false;
}

const invalidTokenCodes = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
export const isInvalidToken = (code: string): boolean => invalidTokenCodes.has(code);
export function retryDelayMs(attempt: number): number { return Math.min(3600000, 30000 * 2 ** Math.max(0, Math.min(7, attempt - 1))); }
export function canClaimDelivery(value: DocumentData, now: number): boolean {
  return ['pending', 'retry', 'delivering'].includes(String(value.state)) && Number(value.attempts ?? 0) < 8 && millis(value.nextAttemptAt) <= now &&
    (value.state !== 'delivering' || millis(value.leaseUntil) <= now);
}

export const registerDeviceToken = onCall(callableOptions, async request => {
  const token = request.data?.token, deviceId = documentId(request.data?.deviceId, 'device ID'), platform = request.data?.platform;
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096 || /\s/.test(token) || !['android', 'ios', 'web'].includes(platform)) throw new HttpsError('invalid-argument', 'Valid push token and platform required.');
  const id = digest(token), uid = request.auth?.uid;
  await db().runTransaction(async tx => {
    await activeAccount(tx, uid);
    const [existing, deviceOwner] = await Promise.all([tx.get(db().collection('deviceTokens').where('uid', '==', uid!).limit(21)), tx.get(db().doc(`deviceTokenOwners/${digest(deviceId)}`))]);
    const previousId = deviceOwner.data()?.tokenId;
    const previousToken = typeof previousId === 'string' && previousId !== id ? await tx.get(db().doc(`deviceTokens/${documentId(previousId)}`)) : null;
    const retained = existing.docs.filter(s => s.id !== id && s.data().deviceId !== deviceId);
    if (retained.length >= 20) throw new HttpsError('resource-exhausted', 'Unregister an old device first (20 devices maximum).');
    // A token is globally owned by exactly one account, and refresh replaces this device's previous token.
    for (const old of existing.docs) if (old.id !== id && old.data().deviceId === deviceId) tx.delete(old.ref);
    if (previousToken?.exists && previousToken.data()?.deviceId === deviceId) tx.delete(previousToken.ref);
    tx.set(db().doc(`deviceTokens/${id}`), { uid, token, deviceId, platform, updatedAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 90 * day) });
    tx.set(db().doc(`deviceTokenOwners/${digest(deviceId)}`), { uid, tokenId: id, expiresAt: Timestamp.fromMillis(Date.now() + 90 * day) });
  });
  return { ok: true, id };
});

export const unregisterDeviceToken = onCall(callableOptions, async request => {
  const uid = request.auth?.uid, token = request.data?.token;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw new HttpsError('invalid-argument', 'Valid token required.');
  // Cleanup remains permitted after deactivation; never remove a token moved to another account.
  await db().runTransaction(async tx => {
    const ref = db().doc(`deviceTokens/${digest(token)}`), snap = await tx.get(ref), deviceId = snap.data()?.deviceId;
    const ownerRef = typeof deviceId === 'string' ? db().doc(`deviceTokenOwners/${digest(deviceId)}`) : null;
    const owner = ownerRef ? (await tx.get(ownerRef)).data() : null;
    if (snap.data()?.uid === uid) tx.delete(ref);
    if (ownerRef && owner?.uid === uid && owner?.tokenId === ref.id) tx.delete(ownerRef);
  });
  return { ok: true };
});

export const markNotificationRead = onCall(callableOptions, async request => {
  const id = documentId(request.data?.notificationId, 'notification ID'), uid = request.auth?.uid;
  await db().runTransaction(async tx => {
    await activeAccount(tx, uid);
    const ref = db().doc(`notifications/${id}`), snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.uid !== uid) throw new HttpsError('permission-denied', 'Notification does not belong to this account.');
    if (!snap.data()?.readAt || snap.data()?.isRead !== true) tx.update(ref, { isRead: true, readAt: snap.data()?.readAt ?? Timestamp.now(), readByUserIds: [uid] });
  });
  return { ok: true };
});

export const sendAnnouncement = onCall(callableOptions, async request => {
  const uid = request.auth?.uid, eventId = documentId(request.data?.eventId, 'event ID');
  const audience = request.data?.audience ?? 'event', groupId = request.data?.groupId ? documentId(request.data.groupId, 'group ID') : '';
  const message = typeof request.data?.message === 'string' ? request.data.message.trim() : '';
  if (!['event', 'group', 'public'].includes(audience) || (audience === 'group') !== Boolean(groupId) || !message || message.length > 500) throw new HttpsError('invalid-argument', 'Select an audience and a 1–500 character message.');
  const requestId = request.data?.requestId ? documentId(request.data.requestId, 'request ID') : randomUUID();
  const id = digest(uid ?? '', eventId, requestId);
  await db().runTransaction(async tx => {
    const user = await activeAccount(tx, uid);
    const [eventSnap, existing, limit, groupSnap] = await Promise.all([
      tx.get(db().doc(`events/${eventId}`)), tx.get(db().doc(`announcements/${id}`)), tx.get(db().doc(`operationLimits/announcement_${uid}`)),
      groupId ? tx.get(db().doc(`groups/${groupId}`)) : Promise.resolve(null),
    ]);
    const event = eventSnap.data(), group = groupSnap?.data();
    if (!event || event.deleting === true || !['scheduled', 'active', 'paused'].includes(String(event.status))) throw new HttpsError('failed-precondition', 'Event unavailable.');
    const manager = user.role === 'admin' || (user.role === 'organizer' && event.organizerId === uid);
    const leader = audience === 'group' && user.role === 'teamLeader' && user.assignedGroupId === groupId && group?.leaderUserId === uid;
    if ((!manager && !leader) || (groupId && (group?.eventId !== eventId || group.deleting === true))) throw new HttpsError('permission-denied', 'Use your own event or assigned group.');
    if (audience === 'public' && (event.isPublic !== true || !['scheduled', 'active'].includes(String(event.status)))) throw new HttpsError('failed-precondition', 'Only published events can have public announcements.');
    if (existing.exists) {
      if (existing.data()?.message !== message || existing.data()?.audience !== audience || existing.data()?.groupId !== groupId) throw new HttpsError('already-exists', 'Request ID already used for different content.');
      return;
    }
    if (Date.now() - millis(limit.data()?.lastAt) < 5000) throw new HttpsError('resource-exhausted', 'Please wait a few seconds between announcements.');
    const now = Timestamp.now(), expiresAt = Timestamp.fromMillis(Date.now() + day);
    tx.create(db().doc(`announcements/${id}`), { eventId, groupId, audience, message, isActive: true, state: 'active', createdBy: uid, createdAt: now, updatedAt: now, expiresAt, lifecycleDueAt: expiresAt, retentionAt: Timestamp.fromMillis(Date.now() + 30 * day) });
    if (audience === 'public') tx.create(db().doc(`publicAnnouncements/${id}`), { eventId, message, isActive: true, createdAt: now, updatedAt: now, expiresAt, lifecycleDueAt: expiresAt, retentionAt: Timestamp.fromMillis(Date.now() + 30 * day) });
    else tx.create(db().doc(`notificationFanouts/${id}`), { announcementId: id, eventId, groupId, stage: 'leaders', leadersFirst: true, cursor: '', continuationGeneration: 0, state: 'pending', nextAttemptAt: now, createdAt: now, retentionAt: Timestamp.fromMillis(Date.now() + 30 * day) });
    tx.set(db().doc(`operationLimits/announcement_${uid}`), { lastAt: now, expiresAt: Timestamp.fromMillis(Date.now() + day) });
  });
  return { ok: true, id, announcementId: id };
});

export type FanoutBudget = { maxPages?: number; maxRunMs?: number; recipientConcurrency?: number };

/** Drain immediately, checkpoint every page, and explicitly wake another invocation at the boundary. */
export async function processAnnouncementFanout(id: string, budget: FanoutBudget = {}): Promise<void> {
  const ref = db().doc(`notificationFanouts/${id}`), lease = randomUUID();
  const claimedJob = await db().runTransaction(async tx => {
    const current = (await tx.get(ref)).data(), now = Date.now();
    if (!current || !['pending', 'processing'].includes(current.state) || millis(current.nextAttemptAt) > now || millis(current.leaseUntil) > now) return null;
    tx.update(ref, { state: 'processing', lease, leaseUntil: Timestamp.fromMillis(now + 120000), nextAttemptAt: Timestamp.fromMillis(now + 120000) });
    return current;
  });
  if (!claimedJob) return;
  let job: DocumentData = claimedJob;
  const deadline = Date.now() + Math.max(1, budget.maxRunMs ?? 40000);
  try {
    for (let pageNumber = 0; pageNumber < Math.max(1, budget.maxPages ?? 20) && Date.now() < deadline; pageNumber++) {
      const source = (await db().doc(`announcements/${id}`).get()).data();
      if (!source || source.state !== 'active' || source.isActive !== true || millis(source.expiresAt) <= Date.now()) {
        await db().runTransaction(async tx => {
          if ((await tx.get(ref)).data()?.lease === lease) tx.update(ref, { state: 'cancelled', lease: FieldValue.delete(), leaseUntil: FieldValue.delete(), nextAttemptAt: FieldValue.delete() });
        });
        return;
      }
      let query: Query = db().collection(job.stage === 'members' ? 'memberships' : 'groups').where('eventId', '==', job.eventId);
      // A group audience must never scan the other event members/groups.
      if (job.groupId) query = query.where(job.stage === 'members' ? 'groupId' : FieldPath.documentId(), '==', job.groupId);
      query = query.orderBy(FieldPath.documentId()).limit(100);
      if (job.cursor) query = query.startAfter(job.cursor);
      const page = await query.get();
      const recipients = [...new Set(page.docs.flatMap(doc => job.stage === 'members' ? [doc.data().uid] : [doc.data().leaderUserId, doc.data().backupLeaderUserId]))]
        .filter((uid): uid is string => typeof uid === 'string' && Boolean(uid));
      const currentJob = job;
      const result = await boundedWork(recipients, budget.recipientConcurrency ?? 8, async uid => {
        const notificationId = digest('announcement', id, uid);
        await db().runTransaction(async tx => {
          const [existing, currentSource, currentFanout, eligible] = await Promise.all([
            tx.get(db().doc(`notifications/${notificationId}`)), tx.get(db().doc(`announcements/${id}`)), tx.get(ref),
            eligibleRecipient(tx, uid, currentJob.eventId, String(currentJob.groupId ?? '')),
          ]);
          const current = currentSource.data(), owner = currentFanout.data();
          if (owner?.lease !== lease || millis(owner.leaseUntil) <= Date.now()) throw new Error('fanout-lease-lost');
          if (existing.exists || !eligible || current?.isActive !== true || current.state !== 'active' || millis(current.expiresAt) <= Date.now()) return;
          queueNotification(tx, notificationId, { uid, eventId: currentJob.eventId, groupId: currentJob.groupId ?? '', title: 'Procession announcement', body: current.message,
            type: 'announcement', sourceCollection: 'announcements', sourceId: id, expiresAt: current.expiresAt });
        });
      }, deadline);
      if (result.failed) throw new Error('fanout-page-retry');
      if (result.started < recipients.length) break; // Repeat this page; deterministic IDs preserve completed recipients.
      const nextStage: string | null = job.stage === 'members' ? job.leadersFirst ? null : 'leaders' : job.leadersFirst ? 'members' : null;
      const changes: DocumentData = page.size === 100 ? { cursor: page.docs[page.size - 1].id } : nextStage ? { stage: nextStage, cursor: '' } : { state: 'completed' };
      const updated = await db().runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (current?.lease !== lease || millis(current.leaseUntil) <= Date.now()) return false;
        tx.update(ref, { ...changes, leaseUntil: Timestamp.fromMillis(Date.now() + 120000), nextAttemptAt: Timestamp.fromMillis(Date.now() + 120000),
          ...(changes.state === 'completed' ? { completedAt: Timestamp.now(), nextAttemptAt: FieldValue.delete(), lease: FieldValue.delete(), leaseUntil: FieldValue.delete() } : {}) });
        return true;
      });
      if (!updated || changes.state === 'completed') return;
      job = { ...job, ...changes };
    }
    await db().runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.lease !== lease) return;
      tx.update(ref, { state: 'pending', lease: FieldValue.delete(), leaseUntil: FieldValue.delete(), nextAttemptAt: Timestamp.now(),
        continuationGeneration: Number(current.continuationGeneration ?? 0) + 1 });
    });
  } catch (error) {
    await db().runTransaction(async tx => {
      if ((await tx.get(ref)).data()?.lease === lease) tx.update(ref, { state: 'pending', lease: FieldValue.delete(), leaseUntil: FieldValue.delete(), nextAttemptAt: Timestamp.fromMillis(Date.now() + 30000) });
    });
    throw error;
  }
}

const fanoutOptions = { document: 'notificationFanouts/{fanoutId}', retry: true, maxInstances: 10, concurrency: 4, timeoutSeconds: 120 };
export const fanoutAnnouncement = onDocumentCreated(fanoutOptions, async event => { await processAnnouncementFanout(event.params.fanoutId); });
export function fanoutContinuationRequested(before: DocumentData, after: DocumentData): boolean {
  return after.state === 'pending' && Number(after.continuationGeneration ?? 0) > Number(before.continuationGeneration ?? 0);
}
export const continueAnnouncementFanout = onDocumentUpdated(fanoutOptions, async event => {
  if (event.data && fanoutContinuationRequested(event.data.before.data(), event.data.after.data())) await processAnnouncementFanout(event.params.fanoutId);
});

async function noticeCurrent(tx: Transaction, notice: DocumentData): Promise<boolean> {
  if (notice.state !== 'active' || millis(notice.expiresAt) <= Date.now() || !await eligibleRecipient(tx, notice.uid, notice.eventId, notice.groupId, notice.leaderOnly === true)) return false;
  if (!['announcements', 'collisionWarnings', 'routeInstructions'].includes(notice.sourceCollection)) return false;
  const source = (await tx.get(db().doc(`${notice.sourceCollection}/${notice.sourceId}`))).data();
  if (!source || source.state !== 'active' || millis(source.expiresAt) <= Date.now() || source.isActive === false) return false;
  if (source.alertId) {
    const alert = (await tx.get(db().doc(`collisionAlerts/${source.alertId}`))).data();
    if (alert?.status !== 'active' || alert.incidentId !== source.incidentId || !Array.isArray(alert.affectedGroupIds) || !alert.affectedGroupIds.includes(source.groupId)) return false;
    if (source.instructionId && alert.lastInstructionId !== source.instructionId) return false;
    if (notice.sourceCollection === 'routeInstructions') {
      const head = (await tx.get(db().doc(`routeInstructionHeads/${source.groupId}`))).data();
      if (head?.instructionId !== notice.sourceId) return false;
    }
  }
  return true;
}

/** Durable lease + per-device successful sends. FCM is at-least-once; clients dedupe notificationId. */
export async function deliverNotification(id: string): Promise<void> {
  const ref = db().doc(`notificationDeliveries/${id}`), lease = randomUUID();
  const claimed = await db().runTransaction(async tx => {
    const [deliverySnap, noticeSnap] = await Promise.all([tx.get(ref), tx.get(db().doc(`notifications/${id}`))]);
    const delivery = deliverySnap.data(), notice = noticeSnap.data(), now = Date.now();
    if (!delivery) return null;
    if (['pending', 'retry', 'delivering'].includes(String(delivery.state)) && Number(delivery.attempts ?? 0) >= 8 && millis(delivery.nextAttemptAt) <= now && millis(delivery.leaseUntil) <= now) {
      tx.update(ref, { state: 'failed', nextAttemptAt: FieldValue.delete(), completedAt: Timestamp.now(), lastErrorCode: 'attempt-limit' }); return null;
    }
    if (!canClaimDelivery(delivery, now)) return null;
    if (!notice || !await noticeCurrent(tx, notice)) {
      tx.update(ref, { state: 'cancelled', nextAttemptAt: FieldValue.delete(), completedAt: Timestamp.now() }); return null;
    }
    tx.update(ref, { state: 'delivering', lease, leaseUntil: Timestamp.fromMillis(now + 120000), nextAttemptAt: Timestamp.fromMillis(now + 120000), attempts: Number(delivery.attempts ?? 0) + 1 });
    return { delivery, notice };
  });
  if (!claimed) return;
  const delivered = new Set<string>(Array.isArray(claimed.delivery.deliveredTokenIds) ? claimed.delivery.deliveredTokenIds : []);
  const tokens = await db().collection('deviceTokens').where('uid', '==', claimed.notice.uid).limit(21).get();
  let retry = false, failure = '';
  const tokenWork = await boundedWork(tokens.docs, 3, async tokenSnap => {
    if (delivered.has(tokenSnap.id)) return;
    const tokenData = tokenSnap.data();
    if (millis(tokenData.expiresAt) <= Date.now()) return;
    // Recheck current token owner after the delivery lease and immediately before send.
    const allowed = await db().runTransaction(async tx => {
      const [currentToken, currentNotice, currentDelivery, deviceOwner] = await Promise.all([tx.get(tokenSnap.ref), tx.get(db().doc(`notifications/${id}`)), tx.get(ref),
        tx.get(db().doc(`deviceTokenOwners/${digest(String(tokenData.deviceId))}`))]);
      return currentToken.data()?.uid === claimed.notice.uid && currentToken.data()?.token === tokenData.token && currentDelivery.data()?.lease === lease &&
        millis(currentDelivery.data()?.leaseUntil) > Date.now() && !currentDelivery.data()?.deliveredTokenIds?.includes(tokenSnap.id) &&
        millis(currentToken.data()?.expiresAt) > Date.now() && deviceOwner.data()?.uid === claimed.notice.uid && deviceOwner.data()?.tokenId === tokenSnap.id &&
        currentNotice.exists && await noticeCurrent(tx, currentNotice.data()!);
    });
    if (!allowed) return;
    try {
      await getMessaging().send({ token: tokenData.token, notification: { title: claimed.notice.title, body: claimed.notice.body },
        data: { notificationId: id, eventId: claimed.notice.eventId, groupId: claimed.notice.groupId ?? '', type: claimed.notice.type, sourceId: claimed.notice.sourceId },
        android: { collapseKey: id, ttl: Math.max(0, millis(claimed.notice.expiresAt) - Date.now()), notification: { tag: id } },
      });
      delivered.add(tokenSnap.id);
      await db().runTransaction(async tx => { const current = (await tx.get(ref)).data(); if (current?.lease === lease) tx.update(ref, { deliveredTokenIds: FieldValue.arrayUnion(tokenSnap.id) }); });
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
      failure = code; // Never log/persist raw tokens or payload exceptions.
      if (isInvalidToken(code)) {
        await db().runTransaction(async tx => {
          const current = (await tx.get(tokenSnap.ref)).data();
          if (current && current.uid === claimed.notice.uid && current.token === tokenData.token && millis(current.updatedAt) === millis(tokenData.updatedAt)) tx.delete(tokenSnap.ref);
        });
      } else retry = true;
    }
  });
  if (tokenWork.failed) { retry = true; failure ||= 'device-work-retry'; }
  await db().runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.lease !== lease) return;
    const attempts = Number(current.attempts);
    tx.update(ref, { state: retry ? attempts >= 8 ? 'failed' : 'retry' : delivered.size ? 'delivered' : 'no-device',
      deliveredTokenIds: [...delivered], lastErrorCode: failure || null, lease: FieldValue.delete(), leaseUntil: FieldValue.delete(),
      nextAttemptAt: retry && attempts < 8 ? Timestamp.fromMillis(Date.now() + retryDelayMs(attempts)) : FieldValue.delete(), completedAt: retry ? null : Timestamp.now() });
  });
}

export const deliverNotificationOnCreate = onDocumentCreated({ document: 'notificationDeliveries/{deliveryId}', retry: true, maxInstances: 10 }, async event => { await deliverNotification(event.params.deliveryId); });

export async function processDueNotificationWork(now = Date.now(), budget: CursorBudget = {}): Promise<void> {
  await Promise.all([
    drainCursorQueue('due_notificationDeliveries', db().collection('notificationDeliveries').where('nextAttemptAt', '<=', Timestamp.fromMillis(now)),
      doc => deliverNotification(doc.id), { pageSize: 200, ...budget }, 'nextAttemptAt'),
    drainCursorQueue('due_notificationFanouts', db().collection('notificationFanouts').where('nextAttemptAt', '<=', Timestamp.fromMillis(now)),
      doc => processAnnouncementFanout(doc.id, { maxRunMs: budget.maxRunMs ?? 35000 }), { pageSize: 20, ...budget, concurrency: 2 }, 'nextAttemptAt'),
  ]);
}

export const retryNotificationDeliveries = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Etc/UTC', maxInstances: 1, concurrency: 1, timeoutSeconds: 120 }, async () => {
  await processDueNotificationWork();
});
