import { doc, runTransaction } from 'firebase/firestore';
import { db } from './firebase';

export async function assignGroupLeaders(groupId: string, primaryId: string, backupId: string) {
  if (primaryId && primaryId === backupId) throw Error('Primary and backup leaders must differ.');
  await runTransaction(db, async (tx) => {
    const groupRef = doc(db, 'groups', groupId);
    const groupSnap = await tx.get(groupRef);
    if (!groupSnap.exists()) throw Error('Group not found.');
    const group = groupSnap.data();
    const eventSnap = await tx.get(doc(db, 'events', String(group.eventId)));
    if (!eventSnap.exists() || ['completed', 'cancelled', 'archived'].includes(String(eventSnap.data().status))) {
      throw Error('Leaders cannot be changed after an event ends.');
    }
    const ids = [...new Set([String(group.leaderUserId ?? ''), String(group.backupLeaderUserId ?? ''), primaryId, backupId].filter(Boolean))];
    const snapshots = await Promise.all(ids.map((uid) => tx.get(doc(db, 'users', uid))));
    const users = new Map(snapshots.map((snap) => [snap.id, snap]));
    for (const id of [primaryId, backupId].filter(Boolean)) {
      const candidate = users.get(id);
      const profile = candidate?.data();
      if (!candidate?.exists() || !profile || profile.role !== 'teamLeader' || profile.isActive !== true) {
        throw Error('Only active users with the teamLeader role may be assigned.');
      }
      if (profile.assignedGroupId && profile.assignedGroupId !== groupId) throw Error('Selected leader already belongs to another group.');
    }
    tx.update(groupRef, { leaderUserId: primaryId, backupLeaderUserId: backupId });
    for (const uid of ids) {
      const wasAssigned = uid === group.leaderUserId || uid === group.backupLeaderUserId;
      const nowAssigned = uid === primaryId || uid === backupId;
      if (nowAssigned) tx.update(doc(db, 'users', uid), { assignedGroupId: groupId });
      else if (wasAssigned && users.get(uid)?.data()?.assignedGroupId === groupId) {
        tx.update(doc(db, 'users', uid), { assignedGroupId: '' });
      }
    }
  });
}