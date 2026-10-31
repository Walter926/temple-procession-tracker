import { getApp } from 'firebase-admin/app';
import { getDatabaseWithUrl, ServerValue } from 'firebase-admin/database';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineString } from 'firebase-functions/params';

const rtdbUrl = defineString('RTDB_URL');
const database = () => getDatabaseWithUrl(rtdbUrl.value(), getApp());

export const mirrorGroupStatus = onDocumentWritten({ document: 'groups/{groupId}', maxInstances: 10 }, async (event) => {
  const id = event.params.groupId;
  const data = event.data?.after.data();
  if (!data) {
    await database().ref(`groupStatuses/${id}`).remove();
    return;
  }
  await database().ref(`groupStatuses/${id}`).set({
    eventId: String(data.eventId ?? ''),
    status: String(data.status ?? 'waiting'),
    updatedAt: ServerValue.TIMESTAMP
  });
});