import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
const db = getFirestore;
export const routeSuggestionKinds = ['wait_at_current_stop', 'delay_departure', 'proceed_to_next_checkpoint', 'use_alternate_route', 'skip_optional_stop'] as const;
export type RouteSuggestionKind = typeof routeSuggestionKinds[number];

/** Automatic output is advice, not an instruction to reroute or skip a mandatory stop. */
export const suggestForCollision = onDocumentWritten({ document: 'collisionAlerts/{alertId}', maxInstances: 10 }, async event => {
  const alert = event.data?.after.data();
  if (!alert || alert.status !== 'active') return;
  const ref = db().doc(`routeSuggestions/collision_${event.params.alertId}`);
  await db().runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) return;
    tx.create(ref, { eventId: alert.eventId, groupIds: alert.affectedGroupIds ?? [], sourceType: 'collision', sourceId: event.params.alertId, kind: 'wait_at_current_stop', status: 'pending', rationale: 'Multiple active groups exceed the configured stop capacity. Hold and confirm with dispatch.', createdAt: FieldValue.serverTimestamp() });
  });
});

export const suggestForDelay = onDocumentWritten({ document: 'groups/{groupId}', maxInstances: 10 }, async event => {
  const after = event.data?.after.data(), before = event.data?.before.data();
  if (!after || after.status !== 'delayed' || before?.status === 'delayed') return;
  const ref = db().doc(`routeSuggestions/delay_${event.params.groupId}_${event.id.split('/').join('_')}`);
  await ref.create({ eventId: after.eventId, groupIds: [event.params.groupId], sourceType: 'delay', sourceId: event.params.groupId, kind: 'delay_departure', status: 'pending', rationale: 'Group status changed to delayed. Reconfirm its departure time before advancing.', createdAt: FieldValue.serverTimestamp() });
});

async function admin(uid?: string): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const profile = (await db().doc(`users/${uid}`).get()).data();
  if (profile?.role !== 'admin' || profile?.isActive !== true) throw new HttpsError('permission-denied', 'Admin approval required.');
}
export const decideRouteSuggestion = onCall({ maxInstances: 10 }, async request => {
  await admin(request.auth?.uid);
  const suggestionId = String(request.data?.suggestionId ?? ''), decision = String(request.data?.decision ?? '');
  const kind = String(request.data?.kind ?? ''), text = String(request.data?.instruction ?? '').trim();
  if (!/^[A-Za-z0-9_-]{3,240}$/.test(suggestionId) || !['approve', 'ignore'].includes(decision)) throw new HttpsError('invalid-argument', 'Invalid decision.');
  if (decision === 'approve' && (!routeSuggestionKinds.includes(kind as RouteSuggestionKind) || !text || text.length > 500)) throw new HttpsError('invalid-argument', 'Choose a supported suggestion and 1–500 character instruction.');
  const ref = db().doc(`routeSuggestions/${suggestionId}`);
  const suggestionSnap = await ref.get(), suggestion = suggestionSnap.data();
  if (!suggestion || suggestion.status !== 'pending') throw new HttpsError('failed-precondition', 'Suggestion is no longer pending.');
  const groupIds = Array.isArray(suggestion.groupIds) ? suggestion.groupIds.map(String).slice(0, 100) : [];
  const groupSnaps = await Promise.all(groupIds.map(id => db().doc(`groups/${id}`).get()));
  const leaders = [...new Set(groupSnaps.filter(s => s.data()?.eventId === suggestion.eventId).map(s => String(s.data()?.leaderUserId ?? '')).filter(Boolean))];
  const batch = db().batch();
  batch.update(ref, { status: decision === 'approve' ? 'approved' : 'ignored', kind: decision === 'approve' ? kind : suggestion.kind, instruction: decision === 'approve' ? text : '', decidedBy: request.auth!.uid, decidedAt: FieldValue.serverTimestamp() });
  if (decision === 'approve') for (const uid of leaders) batch.set(db().doc(`routeInstructions/${suggestionId}_${uid}`), { uid, suggestionId, eventId: suggestion.eventId, kind, message: text, state: 'unread', createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { ok: true, recipients: decision === 'approve' ? leaders.length : 0 };
});