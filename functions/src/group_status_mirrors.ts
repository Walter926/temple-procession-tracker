import { getApp } from 'firebase-admin/app';
import { getDatabaseWithUrl, ServerValue } from 'firebase-admin/database';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineString } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { mirrorFieldsChanged } from './tracking_mirrors';

const rtdbUrl = defineString('RTDB_URL');
const database = () => getDatabaseWithUrl(rtdbUrl.value(), getApp());

export const mirrorGroupStatus = onDocumentWritten({ document: 'groups/{groupId}', maxInstances: 10, retry: true }, async (event) => {
  if (!mirrorFieldsChanged(event.data?.before.data(), event.data?.after.data(), ['eventId', 'status'])) return;
  const id = event.params.groupId;
  const payload = await getFirestore().runTransaction(async tx => {
    const clockRef = getFirestore().doc(`mirrorRevisions/groupStatuses_${id}`);
    const [current, clock] = await Promise.all([tx.get(getFirestore().doc(`groups/${id}`)), tx.get(clockRef)]);
    const data = current.data(), version = Number(clock.data()?.revision ?? 0) + 1;
    tx.set(clockRef, { revision: version, path: `groupStatuses/${id}` });
    return { eventId: String(data?.eventId ?? ''), status: String(data?.status ?? 'removed'), sourceVersion: version, updatedAt: ServerValue.TIMESTAMP };
  });
  await database().ref(`groupStatuses/${id}`).transaction(old => {
    if (old && Number(old.sourceVersion ?? 0) >= payload.sourceVersion) return;
    return payload;
  });
});
