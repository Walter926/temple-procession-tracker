
import { getApp } from 'firebase-admin/app';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineString } from 'firebase-functions/params';

const rtdbUrl = defineString('RTDB_URL');
const database = () => getDatabaseWithUrl(rtdbUrl.value(), getApp());

export const mirrorGroupAssignment = onDocumentWritten({ document: 'groups/{groupId}', maxInstances: 10 }, async (event) => {
  const groupId = event.params.groupId;
  const data = event.data?.after.data();
  if (!data) {
    await database().ref(`trackingAssignments/${groupId}`).remove();
    return;
  }
  await database().ref(`trackingAssignments/${groupId}`).set({
    eventId: String(data.eventId ?? ''),
    leaderUserId: String(data.leaderUserId ?? '')
  });
});

export const mirrorEventState = onDocumentWritten({ document: 'events/{eventId}', maxInstances: 10 }, async (event) => {
  const eventId = event.params.eventId;
  const data = event.data?.after.data();
  if (!data) {
    await database().ref(`eventStates/${eventId}`).remove();
    return;
  }
  await database().ref(`eventStates/${eventId}`).set({ status: String(data.status ?? 'draft') });
});
