import { getFirestore, FieldPath, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { digest, documentId, eventManager, millis, queueNotification } from './notifications';
import { acknowledgeMessage } from './alert_actions';
import { maximumSampleAgeMs } from './route_progress';

const db = getFirestore;
const options = { maxInstances: 10, enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true' };
export const routeSuggestionKinds = ['wait_at_current_stop', 'delay_departure', 'proceed_to_next_checkpoint', 'use_alternate_route', 'skip_optional_stop'] as const;
export type RouteSuggestionKind = typeof routeSuggestionKinds[number];
type SelectedInstruction = { kind?: RouteSuggestionKind; instruction?: string };
export const suggestionIdentity = (incidentId: string, groupId: string): string => digest('suggestion', incidentId, groupId);
export function decisionResult(current: unknown, requested: 'approved' | 'rejected'): 'new' | 'repeat' | 'conflict' {
  return current === requested ? 'repeat' : current === 'pending' ? 'new' : 'conflict';
}
export function relevantSuggestion(suggestion: DocumentData, alert: DocumentData | undefined, event: DocumentData, now: number): boolean {
  return suggestion.status === 'pending' && millis(suggestion.expiresAt) > now && event.status === 'active' && alert?.status === 'active' &&
    alert.incidentId === suggestion.incidentId && Array.isArray(alert.affectedGroupIds) && alert.affectedGroupIds.includes(suggestion.groupId) && millis(alert.lastSeenAt) <= now + 5000 && now - millis(alert.lastSeenAt) <= maximumSampleAgeMs;
}

/** Operator decisions and the single leader instruction are committed together. */
export async function decideSuggestion(uid: string | undefined, suggestionId: string, decision: 'approved' | 'rejected', selected: SelectedInstruction = {}): Promise<{ ok: true; status: string; instructionId?: string }> {
  return db().runTransaction(async tx => {
    const ref = db().doc(`routeSuggestions/${suggestionId}`), snap = await tx.get(ref), suggestion = snap.data();
    if (!suggestion) throw new HttpsError('not-found', 'Suggestion not found.');
    const event = await eventManager(tx, uid, documentId(suggestion.eventId));
    const outcome = decisionResult(suggestion.status ?? (suggestion.isAccepted ? 'approved' : 'pending'), decision);
    if (outcome === 'repeat') return { ok: true, status: decision, ...(suggestion.instructionId ? { instructionId: suggestion.instructionId } : {}) };
    if (outcome === 'conflict') throw new HttpsError('failed-precondition', 'This suggestion has already been decided or is no longer current.');
    const [alertSnap, groupSnap, headSnap] = await Promise.all([
      tx.get(db().doc(`collisionAlerts/${documentId(suggestion.alertId)}`)), tx.get(db().doc(`groups/${documentId(suggestion.groupId)}`)),
      tx.get(db().doc(`routeInstructionHeads/${suggestion.groupId}`)),
    ]);
    const group = groupSnap.data(), head = headSnap.data(), alert = alertSnap.data();
    if (!group || !relevantSuggestion(suggestion, alert, event, Date.now()) || group.eventId !== suggestion.eventId || group.routeId !== suggestion.routeId || group.status === 'completed') throw new HttpsError('failed-precondition', 'Advice is stale or no longer relevant.');
    const decidedAt = Timestamp.now();
    if (decision === 'rejected') {
      tx.update(ref, { status: 'rejected', isAccepted: false, decidedBy: uid, decidedAt });
      return { ok: true, status: 'rejected' };
    }
    const leaderUid = typeof group.leaderUserId === 'string' && group.leaderUserId ? group.leaderUserId : '';
    if (!leaderUid) throw new HttpsError('failed-precondition', 'Group has no assigned leader.');
    const instructionId = suggestionId, notificationId = digest('route-instruction', instructionId, leaderUid);
    const [leaderSnap, previous, existing, notice] = await Promise.all([
      tx.get(db().doc(`users/${leaderUid}`)), head?.instructionId ? tx.get(db().doc(`routeInstructions/${documentId(head.instructionId)}`)) : Promise.resolve(null),
      tx.get(db().doc(`routeInstructions/${instructionId}`)), tx.get(db().doc(`notifications/${notificationId}`)),
    ]);
    const leader = leaderSnap.data();
    if (leader?.isActive !== true || leader.role !== 'teamLeader' || leader.assignedGroupId !== suggestion.groupId) throw new HttpsError('failed-precondition', 'Assigned leader is unavailable.');
    if (existing.exists || notice.exists) throw new HttpsError('failed-precondition', 'Suggestion delivery already exists; reconcile this record.');
    const message = selected.instruction ?? suggestion.message ?? suggestion.reason ?? suggestion.rationale;
    const kind = selected.kind ?? (routeSuggestionKinds.includes(suggestion.kind) ? suggestion.kind : 'wait_at_current_stop');
    const expiresAt = Timestamp.fromMillis(Math.min(millis(suggestion.expiresAt), Date.now() + 15 * 60000));
    if (previous?.data()?.state === 'active') tx.update(previous.ref, { state: 'superseded', supersededBy: instructionId, endedAt: decidedAt });
    tx.create(db().doc(`routeInstructions/${instructionId}`), { uid: leaderUid, eventId: suggestion.eventId, groupId: suggestion.groupId, routeId: suggestion.routeId,
      alertId: suggestion.alertId, incidentId: suggestion.incidentId, suggestionId, message, kind,
      suggestedRouteSegmentIds: suggestion.suggestedRouteSegmentIds ?? [], state: 'active', createdBy: uid, createdAt: decidedAt, expiresAt,
      acknowledgedAt: null, lifecycleDueAt: expiresAt, retentionAt: Timestamp.fromMillis(Date.now() + 30 * 86400000) });
    tx.set(db().doc(`routeInstructionHeads/${suggestion.groupId}`), { instructionId, incidentId: suggestion.incidentId, uid: leaderUid, updatedAt: decidedAt });
    tx.update(ref, { status: 'approved', isAccepted: true, acceptedByUserId: uid, decidedBy: uid, decidedAt, instructionId, kind, instruction: message });
    queueNotification(tx, notificationId, { uid: leaderUid, eventId: suggestion.eventId, groupId: suggestion.groupId, title: 'Route instruction', body: message,
      type: 'route-instruction', sourceCollection: 'routeInstructions', sourceId: instructionId, leaderOnly: true, expiresAt });
    return { ok: true, status: 'approved', instructionId };
  });
}

export const approveRouteSuggestion = onCall(options, async request => decideSuggestion(request.auth?.uid, documentId(request.data?.suggestionId), 'approved'));
export const rejectRouteSuggestion = onCall(options, async request => decideSuggestion(request.auth?.uid, documentId(request.data?.suggestionId), 'rejected'));
export const decideRouteSuggestion = onCall(options, async request => {
  const decision = request.data?.decision === 'approve' ? 'approved' : request.data?.decision === 'ignore' ? 'rejected' : request.data?.decision;
  if (!['approved', 'rejected'].includes(decision)) throw new HttpsError('invalid-argument', 'Decision must be approved or rejected.');
  const selected: SelectedInstruction = {};
  if (decision === 'approved') {
    if (request.data?.kind !== undefined) {
      if (!routeSuggestionKinds.includes(request.data.kind)) throw new HttpsError('invalid-argument', 'Choose a supported suggestion action.');
      selected.kind = request.data.kind;
    }
    if (request.data?.instruction !== undefined) {
      if (typeof request.data.instruction !== 'string' || !request.data.instruction.trim() || request.data.instruction.trim().length > 500) throw new HttpsError('invalid-argument', 'Enter a 1–500 character instruction.');
      selected.instruction = request.data.instruction.trim();
    }
  }
  return decideSuggestion(request.auth?.uid, documentId(request.data?.suggestionId), decision, selected);
});

/** Close old incident records with fresh source reads; duplicated/unordered triggers cannot revive them. */
export async function reconcileIncidentMessages(alertId: string): Promise<void> {
  for (const collection of ['routeSuggestions', 'routeInstructions', 'collisionWarnings', 'collisionInstructions']) {
    let cursor = '';
    for (;;) {
      let query = db().collection(collection).where('alertId', '==', alertId).orderBy(FieldPath.documentId()).limit(100);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const doc of page.docs) await db().runTransaction(async tx => {
        const [source, current] = await Promise.all([tx.get(db().doc(`collisionAlerts/${alertId}`)), tx.get(doc.ref)]);
        const alert = source.data(), record = current.data();
        if (!record) return;
        const state = record.state ?? record.lifecycleState ?? (record.status === 'pending' ? 'active' : 'decided');
        if (!['active', 'acknowledged', 'decided'].includes(String(state))) return;
        let ended = '';
        if (!alert || alert.status !== 'active') ended = 'resolved';
        else if (alert.incidentId !== record.incidentId) ended = 'superseded';
        else if (record.groupId && !alert.affectedGroupIds?.includes(record.groupId)) ended = 'resolved';
        else if (collection === 'collisionWarnings' && record.instructionId && alert.lastInstructionId !== record.instructionId) ended = 'superseded';
        else if (collection === 'collisionInstructions' && alert.lastInstructionId !== doc.id) ended = 'superseded';
        else if (millis(record.expiresAt) <= Date.now()) ended = 'expired';
        if (ended) tx.update(doc.ref, collection === 'routeSuggestions' ? { lifecycleState: ended, ...(record.status === 'pending' ? { status: ended } : {}), endedAt: Timestamp.now() } : { state: ended, endedAt: Timestamp.now() });
      });
      if (page.size < 100) break;
      cursor = page.docs[page.size - 1].id;
    }
  }
}

/** New incident warnings are automatic; actionable instructions always require an operator decision. */
export async function generateIncidentSuggestions(alertId: string): Promise<void> {
  await reconcileIncidentMessages(alertId);
  const alert = (await db().doc(`collisionAlerts/${alertId}`).get()).data();
  if (alert?.status !== 'active' || typeof alert.incidentId !== 'string' || Date.now() - millis(alert.lastSeenAt) > maximumSampleAgeMs || !Array.isArray(alert.affectedGroupIds)) return;
  if (alert.affectedGroupIds.length > 100) throw Error('An incident supports at most 100 groups.');
  for (const groupId of [...new Set<string>(alert.affectedGroupIds)]) {
    const id = suggestionIdentity(alert.incidentId, documentId(groupId));
    await db().runTransaction(async tx => {
      const [freshSnap, groupSnap, suggestionSnap, eventSnap] = await Promise.all([
        tx.get(db().doc(`collisionAlerts/${alertId}`)), tx.get(db().doc(`groups/${groupId}`)), tx.get(db().doc(`routeSuggestions/${id}`)), tx.get(db().doc(`events/${alert.eventId}`)),
      ]);
      const fresh = freshSnap.data(), group = groupSnap.data();
      if (fresh?.status !== 'active' || fresh.incidentId !== alert.incidentId || !fresh.affectedGroupIds?.includes(groupId) || Date.now() - millis(fresh.lastSeenAt) > maximumSampleAgeMs ||
        !group || group.eventId !== alert.eventId || group.status === 'completed' || eventSnap.data()?.status !== 'active') return;
      const leaderUid = typeof group.leaderUserId === 'string' && group.leaderUserId ? group.leaderUserId : '';
      const warningId = leaderUid ? digest('collision-warning', alert.incidentId, groupId, leaderUid) : '';
      const [leaderSnap, warningSnap, noticeSnap] = await Promise.all([
        leaderUid ? tx.get(db().doc(`users/${leaderUid}`)) : Promise.resolve(null),
        warningId ? tx.get(db().doc(`collisionWarnings/${warningId}`)) : Promise.resolve(null),
        warningId ? tx.get(db().doc(`notifications/${warningId}`)) : Promise.resolve(null),
      ]);
      const now = Timestamp.now(), expiresAt = Timestamp.fromMillis(Date.now() + 15 * 60000), retentionAt = Timestamp.fromMillis(Date.now() + 30 * 86400000);
      const reason = 'Stop capacity exceeded. Hold clear of the crowded stop and contact event dispatch before proceeding.';
      if (!suggestionSnap.exists) tx.create(suggestionSnap.ref, { eventId: alert.eventId, groupId, routeId: group.routeId, alertId, incidentId: alert.incidentId,
        reason, rationale: reason, message: reason, kind: 'wait_at_current_stop', sourceType: 'collision', sourceId: alertId, groupIds: [groupId],
        recommendationType: 'hold', suggestedRouteSegmentIds: [], status: 'pending', lifecycleState: 'active', isAccepted: false,
        acceptedByUserId: null, createdAt: now, expiresAt, lifecycleDueAt: expiresAt, retentionAt });
      const leader = leaderSnap?.data();
      if (leader?.isActive !== true || leader.role !== 'teamLeader' || leader.assignedGroupId !== groupId || !warningSnap || !noticeSnap) return;
      if (!warningSnap.exists) tx.create(warningSnap.ref, { uid: leaderUid, groupId, eventId: alert.eventId, alertId, incidentId: alert.incidentId, type: 'collision',
        message: 'Crowding detected near your route. Await dispatch instructions.', state: 'active', createdAt: now, expiresAt, lifecycleDueAt: expiresAt, acknowledgedAt: null, retentionAt });
      if (!noticeSnap.exists) queueNotification(tx, warningId, { uid: leaderUid, eventId: alert.eventId, groupId, title: 'Crowding warning', body: 'Crowding detected near your route. Await dispatch instructions.',
        type: 'collision', sourceCollection: 'collisionWarnings', sourceId: warningId, leaderOnly: true, expiresAt });
    });
  }
}

export const generateRouteSuggestions = onDocumentWritten({ document: 'collisionAlerts/{alertId}', retry: true, maxInstances: 10 }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  if (before && after && before.status === after.status && before.incidentId === after.incidentId && before.lastInstructionId === after.lastInstructionId &&
    JSON.stringify(before.affectedGroupIds) === JSON.stringify(after.affectedGroupIds)) return;
  await generateIncidentSuggestions(event.params.alertId);
});

export const acknowledgeRouteInstruction = onCall(options, async request => {
  return acknowledgeMessage(request.auth?.uid, 'routeInstructions', documentId(request.data?.instructionId));
});
