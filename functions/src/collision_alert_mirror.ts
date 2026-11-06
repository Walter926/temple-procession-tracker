import { getApp } from 'firebase-admin/app';
import { getDatabaseWithUrl, ServerValue } from 'firebase-admin/database';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineString } from 'firebase-functions/params';
const rtdbUrl = defineString('RTDB_URL');
/** Only a server function can maintain RTDB collision summaries; clients have no write grant. */
export const mirrorCollisionAlert = onDocumentWritten({ document: 'collisionAlerts/{alertId}', maxInstances: 10 }, async event => {
  const after = event.data?.after.data(), before = event.data?.before.data();
  const value = after ?? before;
  if (!value?.eventId || !value?.stopPointId) return;
  const ref = getDatabaseWithUrl(rtdbUrl.value(), getApp()).ref(`activeCollisionAlerts/${value.eventId}/${value.stopPointId}`);
  if (!after || after.status !== 'active') { await ref.remove(); return; }
  await ref.set({ alertId: event.params.alertId, stopPointId: after.stopPointId, severity: after.severity, affectedGroupIds: after.affectedGroupIds, count: after.count, updatedAt: ServerValue.TIMESTAMP });
});