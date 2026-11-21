import { getApp } from 'firebase-admin/app';
import { getDatabaseWithUrl, ServerValue } from 'firebase-admin/database';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineString } from 'firebase-functions/params';
import { getFirestore, type DocumentData } from 'firebase-admin/firestore';
const rtdbUrl = defineString('RTDB_URL');

export function projectCollisionMirror(tree: DocumentData | null, eventId: string, stopId: string, version: number, summary: DocumentData | null): DocumentData | undefined {
  const next = { ...tree }, versions = { ...next._mirrorVersions }, eventVersions = { ...versions[eventId] };
  if (Number(eventVersions[stopId] ?? 0) >= version) return undefined;
  eventVersions[stopId] = version; versions[eventId] = eventVersions; next._mirrorVersions = versions;
  const summaries = { ...next[eventId] };
  if (summary) summaries[stopId] = summary;
  else delete summaries[stopId];
  if (Object.keys(summaries).length) next[eventId] = summaries;
  else delete next[eventId];
  return next;
}

/** Event-local clocks survive removal of the last summary. Clients already filter
 * entries without stopPointId/affectedGroupIds, so metadata is not an alert. */
export function projectCollisionEventMirror(tree: DocumentData | null, stopId: string, version: number, summary: DocumentData | null, legacyVersion = 0): DocumentData | undefined {
  const versions = { ...tree?._mirrorVersions };
  const previous = Math.max(Number(versions[stopId] ?? 0), Number(tree?.[stopId]?.sourceVersion ?? 0), legacyVersion);
  if (previous >= version) return undefined;
  const next: DocumentData = { ...tree, _mirrorVersions: { ...versions, [stopId]: version } };
  if (summary) next[stopId] = summary;
  else delete next[stopId];
  return next;
}
/** Only a server function can maintain RTDB collision summaries; clients have no write grant. */
export const mirrorCollisionAlert = onDocumentWritten({ document: 'collisionAlerts/{alertId}', maxInstances: 10, retry: true }, async event => {
  const payload = await getFirestore().runTransaction(async tx => {
    const clockRef = getFirestore().doc(`mirrorRevisions/collisionAlert_${event.params.alertId}`);
    const [current, clock] = await Promise.all([tx.get(getFirestore().doc(`collisionAlerts/${event.params.alertId}`)), tx.get(clockRef)]);
    const after = current.data(), before = event.data?.before.data(), version = Number(clock.data()?.revision ?? 0) + 1;
    const value = after ?? before ?? clock.data();
    tx.set(clockRef, { revision: version, path: `activeCollisionAlerts/${value?.eventId ?? ''}/${value?.stopPointId ?? ''}`, eventId: value?.eventId ?? '', stopPointId: value?.stopPointId ?? '' });
    return { after, value, version };
  });
  const { after, value, version } = payload;
  if (!value?.eventId || !value?.stopPointId) return;
  // Deletion and its tombstone are atomic within this event, never across all events.
  const summary = after?.status === 'active' ? { alertId: event.params.alertId, incidentId: after.incidentId ?? '', stopPointId: after.stopPointId, severity: after.severity,
    affectedGroupIds: after.affectedGroupIds, count: after.count, sourceVersion: version, updatedAt: ServerValue.TIMESTAMP } : null;
  const database = getDatabaseWithUrl(rtdbUrl.value(), getApp());
  // Keep legacy tombstones authoritative during migration; never read/transact
  // the global tree. Retain them until old function instances have drained.
  const legacy = await database.ref(`activeCollisionAlerts/_mirrorVersions/${value.eventId}/${value.stopPointId}`).get();
  await database.ref(`activeCollisionAlerts/${value.eventId}`).transaction(tree =>
    projectCollisionEventMirror(tree, value.stopPointId, version, summary, Number(legacy.val() ?? 0)));
});
