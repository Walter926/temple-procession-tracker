import { callManagement } from './management';
export async function assignGroupLeaders(groupId: string, primaryId: string, backupId: string) {
  if (primaryId && primaryId === backupId) throw Error('Primary and backup leaders must differ.');
  await callManagement('assignGroupLeader', { groupId, leaderUserId: primaryId, backupLeaderUserId: backupId });
}
