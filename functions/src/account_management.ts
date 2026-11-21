import { getAuth } from 'firebase-admin/auth';
import { getApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { DocumentData, FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { assertAvailableEvent, callableOptions, CLOSED_EVENT_STATUSES, consumeAttempt, documentId, requireAdmin, requireEventManager } from './authorization';
import { nextMemberCount } from './memberships';
import { syncAccountState, syncEventAccess, syncGroupAssignment, synchronizeAuthStatus, trackingDatabase } from './tracking_mirrors';

const roles = ['admin', 'organizer', 'teamLeader', 'teamMember'];
const LEADER_FIELDS = ['displayName', 'fullName', 'email', 'role', 'isActive', 'deleting', 'assignedGroupId'];
export function leaderDirectoryRecord(id: string, profile: DocumentData | undefined, groupId: string) {
  const label = (value: unknown) => typeof value === 'string' && value.trim() !== id ? value.trim() : '';
  const fullName = label(profile?.fullName), email = label(profile?.email);
  const displayName = label(profile?.displayName) || fullName || email || (profile ? 'Team leader (name unavailable)' : 'Team leader (profile unavailable)');
  const role = typeof profile?.role === 'string' ? profile.role : 'teamLeader';
  const isActive = profile?.isActive === true && !profile.deleting;
  const assignedGroupId = typeof profile?.assignedGroupId === 'string' ? profile.assignedGroupId : '';
  return { id, displayName, fullName, email, role, isActive, assignedGroupId, profileMissing: !profile,
    isEligible: role === 'teamLeader' && isActive && (!assignedGroupId || assignedGroupId === groupId) };
}
function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpsError('invalid-argument', `Invalid ${name}.`);
  return value.trim();
}
export const assignGroupLeader = onCall(callableOptions, async request => {
  const groupId = documentId(request.data?.groupId), primary = request.data?.leaderUserId === '' ? '' : documentId(request.data?.leaderUserId);
  const backup = !request.data?.backupLeaderUserId ? '' : documentId(request.data.backupLeaderUserId);
  if (primary && primary === backup) throw new HttpsError('invalid-argument', 'Primary and backup leaders must differ.');
  const affected = await getFirestore().runTransaction(async tx => {
    const db = getFirestore(), ref = db.doc(`groups/${groupId}`), group = (await tx.get(ref)).data();
    if (!group) throw new HttpsError('not-found', 'Group not found.');
    const { event } = await requireEventManager(request.auth?.uid, group.eventId, tx);
    if (group.deleting) throw new HttpsError('failed-precondition', 'This group is being deleted.');
    const closed = CLOSED_EVENT_STATUSES.includes(event.status);
    if (closed) {
      // Closing an event must not strand its leaders. Allow revocation without
      // reopening the event, promoting a backup or granting a new assignment.
      if ((primary && primary !== group.leaderUserId) || (backup && backup !== group.backupLeaderUserId)) {
        throw new HttpsError('failed-precondition', 'This event is closed. Release existing leaders; new assignments and promotions are not allowed.');
      }
    } else assertAvailableEvent(event);
    const ids = [...new Set([group.leaderUserId, group.backupLeaderUserId, primary, backup].filter(Boolean))] as string[];
    const users = new Map<string, DocumentData | undefined>();
    for (const uid of ids) users.set(uid, (await tx.get(db.doc(`users/${documentId(uid)}`))).data());
    for (const uid of (closed ? [] : [primary, backup]).filter(Boolean)) {
      const user = users.get(uid);
      if (!user || user.isActive !== true || user.role !== 'teamLeader' || user.deleting) throw new HttpsError('failed-precondition', 'Select active team leaders.');
      if (user.assignedGroupId && user.assignedGroupId !== groupId) throw new HttpsError('already-exists', 'This leader already has another assignment.');
    }
    tx.update(ref, { leaderUserId: primary, backupLeaderUserId: backup,
      ...(closed ? {} : { status: 'stopped', statusUpdatedAt: FieldValue.serverTimestamp() }) });
    for (const uid of ids) {
      const user = users.get(uid);
      if (!user) continue;
      if ([primary, backup].includes(uid) && (!closed || user.assignedGroupId === groupId)) tx.update(db.doc(`users/${uid}`), { assignedGroupId: groupId, updatedAt: FieldValue.serverTimestamp() });
      else if (user.assignedGroupId === groupId) tx.update(db.doc(`users/${uid}`), { assignedGroupId: '', updatedAt: FieldValue.serverTimestamp() });
    }
    tx.create(db.collection('auditRecords').doc(), { action: 'assignGroupLeader', actorUid: request.auth!.uid, eventId: group.eventId, groupId, leaderUserId: primary, backupLeaderUserId: backup, createdAt: FieldValue.serverTimestamp() });
    return { ids, eventId: String(group.eventId) };
  });
  await syncGroupAssignment(groupId);
  for (const uid of affected.ids) { await syncAccountState(uid); await syncEventAccess(affected.eventId, uid); }
  return { groupId, leaderUserId: primary, backupLeaderUserId: backup };
});
export const listAssignableLeaders = onCall(callableOptions, async request => {
  const eventId = documentId(request.data?.eventId), groupId = documentId(request.data?.groupId);
  await requireEventManager(request.auth?.uid, eventId);
  await consumeAttempt(request.auth!.uid, 'leaderDirectory', 60);
  const group = (await getFirestore().doc(`groups/${groupId}`).get()).data();
  if (!group || group.eventId !== eventId) throw new HttpsError('invalid-argument', 'Group does not belong to this event.');
  if (group.deleting) throw new HttpsError('failed-precondition', 'This group is being deleted.');
  const db = getFirestore();
  let query = db.collection('users').where('role', '==', 'teamLeader').orderBy(FieldPath.documentId()).select(...LEADER_FIELDS).limit(200);
  if (request.data?.cursor) query = query.startAfter(documentId(request.data.cursor, 'directory cursor'));
  try {
    const page = await query.get();
    // Only the current group's two assigned IDs may bypass the eligibility filter.
    const assignedIds = [...new Set([group.leaderUserId, group.backupLeaderUserId].filter(Boolean))] as string[];
    const users = new Map<string, ReturnType<typeof leaderDirectoryRecord>>();
    for (const doc of page.docs) {
      const user = leaderDirectoryRecord(doc.id, doc.data(), groupId);
      if (user.isEligible || assignedIds.includes(doc.id)) users.set(doc.id, user);
    }
    const missingIds = assignedIds.filter(id => !users.has(id));
    if (missingIds.length) {
      const profiles = await db.getAll(...missingIds.map(id => db.doc(`users/${documentId(id, 'assigned leader ID')}`)), { fieldMask: LEADER_FIELDS });
      for (const profile of profiles) users.set(profile.id, leaderDirectoryRecord(profile.id, profile.data(), groupId));
    }
    return { users: [...users.values()], nextCursor: page.size === 200 ? page.docs[page.size - 1].id : null };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    const code = (error as { code?: unknown })?.code;
    logger.error('Leader directory lookup failed.', { code: typeof code === 'number' || typeof code === 'string' ? code : 'unknown' });
    if (code === 9 || code === 'failed-precondition') throw new HttpsError('failed-precondition', 'The leader directory is not ready. Ask an administrator to check Firestore indexes.');
    throw new HttpsError('unavailable', 'Unable to load team leaders. Please retry.');
  }
});
export const manageAccount = onCall(callableOptions, async request => {
  await requireAdmin(request.auth?.uid);
  await consumeAttempt(request.auth!.uid, 'manageAccount', 60, 3_600_000);
  const data = request.data ?? {}, action = data.action ?? data.operation;
  if (!['create','update','delete'].includes(action)) throw new HttpsError('invalid-argument', 'Invalid account action.');
  if (Object.keys(data).some(key => !['action','operation','uid','email','password','displayName','role','isActive'].includes(key))) throw new HttpsError('invalid-argument', 'Unsupported account field.');
  if (data.role !== undefined && !roles.includes(data.role)) throw new HttpsError('invalid-argument', 'Invalid account role.');
  if (data.isActive !== undefined && typeof data.isActive !== 'boolean') throw new HttpsError('invalid-argument', 'isActive must be boolean.');
  const email = data.email === undefined ? undefined : text(data.email, 'email', 254);
  const displayName = data.displayName === undefined ? undefined : text(data.displayName, 'display name', 120);
  const password = data.password;
  if (password !== undefined && (typeof password !== 'string' || password.length < 8 || password.length > 128)) throw new HttpsError('invalid-argument', 'Password must contain 8–128 characters.');
  if (action === 'create') {
    if (!email || !password || !displayName || !data.role) throw new HttpsError('invalid-argument', 'Email, password, displayName and role are required.');
    if (data.uid && (await getFirestore().doc(`accountDeletionJobs/${documentId(data.uid)}`).get()).exists) throw new HttpsError('failed-precondition', 'Deleted account IDs cannot be reused.');
    const authUser = await getAuth().createUser({ uid: data.uid ? documentId(data.uid) : undefined, email, password, displayName, disabled: data.isActive === false });
    try {
      await getFirestore().runTransaction(async tx => {
        await requireAdmin(request.auth?.uid, tx);
        tx.create(getFirestore().doc(`users/${authUser.uid}`), { email: authUser.email, displayName, role: data.role, isActive: data.isActive !== false,
          assignedGroupId: '', joinedEventId: '', joinedGroupId: '', photoUrl: null, phoneNumber: null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        tx.create(getFirestore().collection('auditRecords').doc(), { action, targetUid: authUser.uid, actorUid: request.auth!.uid, createdAt: FieldValue.serverTimestamp() });
      });
    } catch (error) { await getAuth().deleteUser(authUser.uid); throw error; }
    await syncAccountState(authUser.uid);
    return { uid: authUser.uid, action };
  }
  const uid = documentId(data.uid, 'user ID');
  if (uid === request.auth!.uid && (action === 'delete' || data.isActive === false || (data.role && data.role !== 'admin'))) throw new HttpsError('failed-precondition', 'An admin cannot remove their own administrative access.');
  if (action === 'update' && (email !== undefined || displayName !== undefined)) {
    // Durable intent, not canonical profile attributes: Auth must accept metadata first.
    await getFirestore().runTransaction(async tx => {
      await requireAdmin(request.auth?.uid, tx);
      const ref = getFirestore().doc(`users/${uid}`), user = (await tx.get(ref)).data();
      if (!user || user.deleting) throw new HttpsError('not-found', 'Account not found.');
      if (user.authMetadataPending) throw new HttpsError('aborted', 'An account metadata update is already pending. Retry shortly.');
      tx.update(ref, { authMetadataPending: { id: getFirestore().collection('auditRecords').doc().id,
        email: email ?? user.email, displayName: displayName ?? user.displayName } });
    });
    await synchronizeAuthStatus(uid);
  }
  const cleanup = await getFirestore().runTransaction(async tx => {
    await requireAdmin(request.auth?.uid, tx);
    const db = getFirestore(), userRef = db.doc(`users/${uid}`), user = (await tx.get(userRef)).data();
    if (!user) throw new HttpsError('not-found', 'Account not found.');
    const clearing = action === 'delete' || data.isActive === false || (data.role !== undefined && data.role !== user.role);
    const [primary, backup, memberships, codes, tokens] = clearing ? await Promise.all([
      tx.get(db.collection('groups').where('leaderUserId','==',uid)), tx.get(db.collection('groups').where('backupLeaderUserId','==',uid)),
      tx.get(db.collection('memberships').where('uid','==',uid)), tx.get(db.collection('accessCodes').where('createdBy','==',uid)),
      tx.get(db.collection('deviceTokens').where('uid','==',uid)),
    ]) : [undefined,undefined,undefined,undefined,undefined];
    const groups = new Map([...(primary?.docs ?? []), ...(backup?.docs ?? [])].map(doc => [doc.id, doc]));
    const countGroups = new Map<string, { data: DocumentData; delta: number }>();
    for (const member of memberships?.docs ?? []) {
      const groupId = member.data().groupId;
      if (groupId) {
        const existing = countGroups.get(groupId);
        if (existing) existing.delta--;
        else {
          const group = (await tx.get(db.doc(`groups/${documentId(groupId)}`))).data();
          if (group) countGroups.set(groupId, { data: group, delta: -1 });
        }
      }
    }
    if (groups.size + countGroups.size + (memberships?.size ?? 0) + (codes?.size ?? 0) + (tokens?.size ?? 0) > 440) throw new HttpsError('resource-exhausted', 'Account has too many related records for atomic cleanup; a maintenance migration is required.');
    for (const doc of groups.values()) tx.update(doc.ref, { leaderUserId: doc.data().leaderUserId === uid ? '' : doc.data().leaderUserId,
      backupLeaderUserId: doc.data().backupLeaderUserId === uid ? '' : (doc.data().backupLeaderUserId ?? ''), status: 'stopped', statusUpdatedAt: FieldValue.serverTimestamp() });
    for (const [id, count] of countGroups) tx.update(db.doc(`groups/${id}`), { memberCount: nextMemberCount(count.data.memberCount, count.delta) });
    for (const member of memberships?.docs ?? []) tx.delete(member.ref);
    for (const code of codes?.docs ?? []) tx.update(code.ref, { enabled: false, revokedAt: FieldValue.serverTimestamp() });
    for (const token of tokens?.docs ?? []) tx.delete(token.ref);
    const patch: DocumentData = { updatedAt: FieldValue.serverTimestamp() };
    for (const key of ['role','isActive']) if (data[key] !== undefined) patch[key] = data[key];
    if (clearing) Object.assign(patch, { assignedGroupId: '', joinedEventId: '', joinedGroupId: '' });
    if (action === 'delete') Object.assign(patch, { isActive: false, deleting: true });
    tx.update(userRef, patch);
    if (action === 'delete') tx.set(db.doc(`accountDeletionJobs/${uid}`), { uid, state: 'pending',
      groupAssignments: [...groups.values()].map(doc => ({groupId:doc.id,eventId:String(doc.data().eventId)})),
      createdAt: FieldValue.serverTimestamp() }, {merge:true});
    tx.create(db.collection('auditRecords').doc(), { action, targetUid: uid, actorUid: request.auth!.uid, createdAt: FieldValue.serverTimestamp() });
    return { groupIds: [...groups.keys()], eventIds: [...new Set([
      ...(memberships?.docs ?? []).map(doc => String(doc.data().eventId)), ...[...groups.values()].map(doc => String(doc.data().eventId)),
    ])] };
  });
  // Revoke the live RTDB capability before touching Auth, and await all affected assignments.
  await syncAccountState(uid);
  for (const id of cleanup.groupIds) await syncGroupAssignment(id);
  for (const eventId of cleanup.eventIds) await syncEventAccess(eventId, uid);
  if (action === 'delete') {
    await processAccountDeletion(uid);
  } else {
    if (password !== undefined) await getAuth().updateUser(uid, { password });
    await synchronizeAuthStatus(uid);
    if (data.role !== undefined || data.isActive === false || password !== undefined) await getAuth().revokeRefreshTokens(uid);
  }
  return { uid, action };
});

/** Retryable deletion saga: revoke first, then remove personal records in draining pages. */
export async function processAccountDeletion(uid: string): Promise<void> {
  documentId(uid);
  const db = getFirestore(), jobRef = db.doc(`accountDeletionJobs/${uid}`), job = (await jobRef.get()).data();
  if (!job || job.state === 'complete') return;
  const profile = (await db.doc(`users/${uid}`).get()).data();
  if (profile && profile.deleting !== true) throw new Error('Deletion job targets an account which is not marked deleting.');
  await syncAccountState(uid);
  try { await getAuth().deleteUser(uid); } catch (error) { if ((error as {code?:string}).code !== 'auth/user-not-found') throw error; }
  const selectors: [string,string][] = [
    ['notifications','uid'], ['notificationDeliveries','uid'], ['deviceTokens','uid'], ['deviceTokenOwners','uid'],
    ['collisionWarnings','uid'], ['routeInstructions','uid'], ['locationHistory','userId'], ['locationHistory','uid'],
    ['locationUpdates','userId'], ['locationUpdates','uid'], ['operationLimits','uid'],
  ];
  for (const [collection,field] of selectors) {
    for (let pageNumber=0;pageNumber<10;pageNumber++) {
      const records=await db.collection(collection).where(field,'==',uid).limit(200).get();
      if (records.empty) break;
      const batch=db.batch(); records.docs.forEach(doc=>batch.delete(doc.ref)); await batch.commit();
      if (records.size===200 && pageNumber===9) {
        await jobRef.set({state:'pending',updatedAt:FieldValue.serverTimestamp()},{merge:true});
        return;
      }
    }
  }
  for (const assignment of job.groupAssignments ?? []) {
    for (const path of ['liveLocations','trackingStatus']) {
      await trackingDatabase().ref(`${path}/${assignment.eventId}/${assignment.groupId}`).transaction(current => !current || current.userId===uid ? null : undefined);
    }
  }
  const bucket=getApp().options.storageBucket;
  if (bucket) await getStorage().bucket(bucket).deleteFiles({prefix:`profile_images/${uid}/`,force:true});
  await db.doc(`users/${uid}`).delete();
  await syncAccountState(uid);
  await jobRef.set({state:bucket ? 'complete' : 'storage-pending',imageCleanup:bucket ? 'complete' : 'bucket-not-configured',updatedAt:FieldValue.serverTimestamp()},{merge:true});
}
export const cleanupDeletedAccounts=onSchedule({schedule:'every 15 minutes',maxInstances:1},async()=>{
  const jobs=await getFirestore().collection('accountDeletionJobs').where('state','in',['pending','storage-pending']).limit(20).get();
  for (const job of jobs.docs) await processAccountDeletion(job.id);
});
