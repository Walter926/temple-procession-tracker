import { getApp } from 'firebase-admin/app';
import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { DocumentData, FieldValue, getFirestore, Timestamp, Transaction } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';

const rtdbUrl = defineString('RTDB_URL');
export const trackingDatabase = () => getDatabaseWithUrl(rtdbUrl.value(), getApp());
export function acceptMirrorRevision(current: DocumentData | null, next: DocumentData): DocumentData | undefined {
  return Number(current?.revision ?? -1) < next.revision ? next : undefined;
}
/** Source reads and revision allocation share a Firestore transaction. RTDB rejects late deliveries. */
export function mirrorPayloadHash(data: DocumentData): string {
  return createHash('sha256').update(JSON.stringify(Object.keys(data).sort().map(key => [key, data[key]]))).digest('hex');
}
export function mirrorFieldsChanged(before: DocumentData | undefined, after: DocumentData | undefined, fields: readonly string[]): boolean {
  return !before || !after || fields.some(field => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
}
async function mirror(path: string, read: (tx: Transaction) => Promise<DocumentData>, forceRevision = false) {
  const db = getFirestore();
  const payload = await db.runTransaction(async tx => {
    const ref = db.doc(`mirrorRevisions/${createHash('sha256').update(path).digest('hex')}`);
    const clock = await tx.get(ref), data = await read(tx);
    const hash = mirrorPayloadHash(data), previous = clock.data();
    const changed = forceRevision || previous?.payloadHash !== hash || !Number.isInteger(previous?.revision);
    const revision = Number(previous?.revision ?? 0) + (changed ? 1 : 0);
    if (changed) tx.set(ref, { revision, path, payloadHash: hash, updatedAt: FieldValue.serverTimestamp() });
    return { ...data, revision };
  });
  await trackingDatabase().ref(path).transaction(current => acceptMirrorRevision(current, payload));
}
export async function syncAccountState(uid: string, forceRevision = false): Promise<void> {
  await mirror(`accountStates/${uid}`, async tx => {
    const user = (await tx.get(getFirestore().doc(`users/${uid}`))).data();
    return { isActive: user?.isActive === true && !user?.deleting, role: String(user?.role ?? ''),
      assignedGroupId: String(user?.assignedGroupId ?? '') };
  }, forceRevision);
}
export async function syncEventAccess(eventId: string, uid: string, forceRevision = false): Promise<void> {
  if (!eventId || !uid) return;
  await mirror(`eventAccess/${eventId}/${uid}`, async tx => {
    const db = getFirestore();
    const [member, user, event] = await Promise.all([tx.get(db.doc(`memberships/${eventId}_${uid}`)),
      tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`events/${eventId}`))]);
    const groupId = user.data()?.assignedGroupId;
    const group = groupId ? (await tx.get(db.doc(`groups/${groupId}`))).data() : undefined;
    const assigned = group?.eventId === eventId && [group?.leaderUserId, group?.backupLeaderUserId].includes(uid);
    return { allowed: event.exists && !event.data()?.deleting && user.data()?.isActive === true
      && ((member.exists && member.data()?.uid === uid && member.data()?.eventId === eventId
        && member.data()?.isActive !== false && !['removed','revoked'].includes(member.data()?.status))
        || (user.data()?.role === 'teamLeader' && assigned)) };
  }, forceRevision);
}
export async function syncGroupAssignment(groupId: string, forceRevision = false): Promise<void> {
  await mirror(`trackingAssignments/${groupId}`, async tx => {
    const group = (await tx.get(getFirestore().doc(`groups/${groupId}`))).data();
    return { eventId: String(group?.eventId ?? ''), leaderUserId: String(group?.leaderUserId ?? ''),
      backupLeaderUserId: String(group?.backupLeaderUserId ?? '') };
  }, forceRevision);
}
export async function syncEventState(eventId: string, forceRevision = false): Promise<void> {
  await mirror(`eventStates/${eventId}`, async tx => {
    const data = (await tx.get(getFirestore().doc(`events/${eventId}`))).data();
    return { status: data?.deleting ? 'archived' : String(data?.status ?? 'deleted'), isPublic: data?.isPublic === true,
      organizerId: String(data?.organizerId ?? '') };
  }, forceRevision);
}
export async function synchronizeAuthStatus(uid: string): Promise<void> {
  // Auth and Firestore cannot commit atomically. Re-read after the Auth write; retries and the
  // scheduled reconciler converge on the current profile rather than trigger snapshot payloads.
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = (await getFirestore().doc(`users/${uid}`).get()).data(), disabled = user?.isActive !== true || user?.deleting === true;
    try {
      const auth = getAuth(), current = await auth.getUser(uid);
      const metadata = user?.authMetadataPending ?? user;
      const email = typeof metadata?.email === 'string' ? metadata.email : undefined;
      const displayName = typeof metadata?.displayName === 'string' ? metadata.displayName : undefined;
      if (current.disabled !== disabled || (email !== undefined && current.email !== email)
        || (displayName !== undefined && current.displayName !== displayName)) {
        try { await auth.updateUser(uid, { disabled, ...(email === undefined ? {} : { email }), ...(displayName === undefined ? {} : { displayName }) }); }
        catch (error) {
          const code = (error as {code?: string}).code;
          if (user?.authMetadataPending && ['auth/email-already-exists','auth/invalid-email','auth/invalid-display-name'].includes(code ?? '')) {
            await getFirestore().runTransaction(async tx => {
              const ref = getFirestore().doc(`users/${uid}`), fresh = (await tx.get(ref)).data();
              if (fresh?.authMetadataPending?.id === user.authMetadataPending.id) tx.update(ref, { authMetadataPending: FieldValue.delete() });
            });
          }
          throw error;
        }
      }
      if (user?.authMetadataPending) await getFirestore().runTransaction(async tx => {
        const ref = getFirestore().doc(`users/${uid}`), fresh = (await tx.get(ref)).data();
        if (fresh?.authMetadataPending?.id === user.authMetadataPending.id) tx.update(ref, {
          ...(email === undefined ? {} : { email }), ...(displayName === undefined ? {} : { displayName }),
          authMetadataPending: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
        });
      });
      if (disabled) await auth.revokeRefreshTokens(uid);
    } catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
      return;
    }
    const fresh = (await getFirestore().doc(`users/${uid}`).get()).data();
    if ((fresh?.isActive !== true || fresh?.deleting === true) === disabled && !fresh?.authMetadataPending
      && fresh?.email === (user?.authMetadataPending?.email ?? user?.email)
      && fresh?.displayName === (user?.authMetadataPending?.displayName ?? user?.displayName)) return;
  }
  throw new Error('Account status changed repeatedly; retry Auth synchronization.');
}
export const mirrorGroupAssignment = onDocumentWritten({ document: 'groups/{groupId}', maxInstances: 10, retry: true }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  if (!mirrorFieldsChanged(before, after, ['eventId', 'leaderUserId', 'backupLeaderUserId', 'deleting'])) return;
  await syncGroupAssignment(event.params.groupId);
  const grants = new Set<string>();
  for (const group of [before, after]) {
    if (!group?.eventId) continue;
    for (const uid of [group.leaderUserId, group.backupLeaderUserId].filter(Boolean)) grants.add(`${group.eventId}/${uid}`);
  }
  await Promise.all([...grants].map(value => { const [eventId, uid] = value.split('/'); return syncEventAccess(eventId, uid); }));
});
export const mirrorEventState = onDocumentWritten({ document: 'events/{eventId}', maxInstances: 10, retry: true }, async event => {
  if (mirrorFieldsChanged(event.data?.before.data(), event.data?.after.data(), ['status', 'isPublic', 'organizerId', 'deleting'])) await syncEventState(event.params.eventId);
});
export const mirrorAccountState = onDocumentWritten({ document: 'users/{uid}', maxInstances: 10, retry: true }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  const permissionsChanged = mirrorFieldsChanged(before, after, ['isActive', 'role', 'assignedGroupId', 'deleting']);
  if (permissionsChanged) await syncAccountState(event.params.uid);
  if (mirrorFieldsChanged(before, after, ['isActive', 'email', 'displayName', 'deleting', 'authMetadataPending'])) await synchronizeAuthStatus(event.params.uid);
  if (!permissionsChanged) return;
  const ids = new Set<string>();
  for (const data of [before, after]) {
    if (data?.assignedGroupId) {
      const group = (await getFirestore().doc(`groups/${data.assignedGroupId}`).get()).data();
      if (group?.eventId) ids.add(String(group.eventId));
    }
  }
  await Promise.all([...ids].map(id => syncEventAccess(id, event.params.uid)));
});
export const mirrorMembershipAccess = onDocumentWritten({ document: 'memberships/{membershipId}', maxInstances: 10, retry: true }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  if (!mirrorFieldsChanged(before, after, ['eventId', 'uid', 'groupId', 'isActive', 'status'])) return;
  const grants = new Set<string>();
  for (const data of [before, after]) if (data?.eventId && data?.uid) grants.add(`${data.eventId}/${data.uid}`);
  await Promise.all([...grants].map(value => { const [eventId, uid] = value.split('/'); return syncEventAccess(eventId, uid); }));
});
const mirrorCollections = ['users', 'events', 'groups', 'memberships', 'mirrorRevisions'] as const;
type MirrorCollection = typeof mirrorCollections[number];
export function mirrorRotationOrder(start: number): MirrorCollection[] {
  const index = Number.isInteger(start) && start >= 0 ? start % mirrorCollections.length : 0;
  return [...mirrorCollections.slice(index), ...mirrorCollections.slice(0, index)];
}
async function repairMirrorRecord(collection: MirrorCollection, id: string, data?: DocumentData) {
  if (collection === 'users') { await syncAccountState(id); await synchronizeAuthStatus(id); }
  if (collection === 'events') await syncEventState(id);
  if (collection === 'groups') {
    await syncGroupAssignment(id);
    for (const uid of new Set([data?.leaderUserId, data?.backupLeaderUserId].filter(Boolean))) await syncEventAccess(data!.eventId, uid);
  }
  if (collection === 'memberships' && data?.eventId && data?.uid) await syncEventAccess(data.eventId, data.uid);
  if (collection === 'mirrorRevisions') {
    const [kind, sourceId, uid] = String(data?.path ?? '').split('/');
    if (kind === 'accountStates') await syncAccountState(sourceId, true);
    if (kind === 'eventStates') await syncEventState(sourceId, true);
    if (kind === 'trackingAssignments') await syncGroupAssignment(sourceId, true);
    if (kind === 'eventAccess') await syncEventAccess(sourceId, uid, true);
  }
}

/** Fixed-size pages and persisted cursors prevent old accounts or one broken
 * record from starving the remainder of a scheduled reconciliation. */
export async function reconcileMirrorPages(now = Date.now()): Promise<{ processed: number; failed: number }> {
  const db = getFirestore();
  let processed = 0, failed = 0;
  const started = Date.now();
  const rotationRef = db.doc('maintenanceCursors/mirror_rotation');
  const rotation = Number((await rotationRef.get()).data()?.index ?? 0);
  const collections = mirrorRotationOrder(rotation);
  await rotationRef.set({ index: (rotation + 1) % mirrorCollections.length, updatedAt: Timestamp.fromMillis(now) });
  async function process(collection: MirrorCollection, id: string, data?: DocumentData, retryId?: string) {
    try {
      await repairMirrorRecord(collection, id, data);
      if (retryId) await db.doc(`mirrorRepairJobs/${retryId}`).delete();
      processed++;
    } catch (error) {
      failed++;
      const code = typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code) : 'unknown';
      const jobId = retryId ?? createHash('sha256').update(`${collection}/${id}`).digest('hex');
      await db.doc(`mirrorRepairJobs/${jobId}`).set({ collection, id, attempts: FieldValue.increment(1), nextAttemptAt: Timestamp.fromMillis(now + 300000), lastErrorCode: code }, { merge: true });
    }
  }
  const retryPage = await db.collection('mirrorRepairJobs').where('nextAttemptAt', '<=', Timestamp.fromMillis(now)).orderBy('nextAttemptAt').limit(50).get();
  for (let offset = 0; offset < retryPage.size && Date.now() - started < 20000; offset += 8) await Promise.all(retryPage.docs.slice(offset, offset + 8).map(async job => {
    const value = job.data();
    if (!mirrorCollections.includes(value.collection) || typeof value.id !== 'string') { await job.ref.delete(); return; }
    const data = (await db.doc(`${value.collection}/${value.id}`).get()).data();
    await process(value.collection, value.id, data, job.id);
  }));
  for (const collection of collections) {
    const cursorRef = db.doc(`maintenanceCursors/mirrors_${collection}`);
    let cursor = String((await cursorRef.get()).data()?.id ?? '');
    for (let pageNumber = 0; pageNumber < 2 && Date.now() - started < 90000; pageNumber++) {
      let query = db.collection(collection).orderBy('__name__').limit(100);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (let offset = 0; offset < page.size; offset += 8) {
        await Promise.all(page.docs.slice(offset, offset + 8).map(doc => process(collection, doc.id, doc.data())));
      }
      if (page.size < 100) { await cursorRef.delete(); break; }
      cursor = page.docs[page.size - 1].id;
      await cursorRef.set({ id: cursor, updatedAt: Timestamp.fromMillis(now) });
    }
  }
  return { processed, failed };
}
export const reconcileTrackingMirrors = onSchedule({ schedule: 'every 5 minutes', maxInstances: 1, concurrency: 1, timeoutSeconds: 180 }, async () => {
  console.info('Tracking mirror repair page completed', await reconcileMirrorPages());
});
