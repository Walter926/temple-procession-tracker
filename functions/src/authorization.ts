import { DocumentData, getFirestore, Timestamp, Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export type UserProfile = DocumentData & { role: string; isActive: boolean };
export const callableOptions = { maxInstances: 10, enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true' };
export const CLOSED_EVENT_STATUSES = ['completed', 'cancelled', 'archived'];
export function documentId(value: unknown, name = 'ID'): string {
  if (typeof value !== 'string' || !value || value.length > 200 || [...value].some(ch => '/.#$[]'.includes(ch) || ch.charCodeAt(0) < 32)) throw new HttpsError('invalid-argument', `Invalid ${name}.`);
  return value;
}
export function assertActiveUser(user: DocumentData | undefined): asserts user is UserProfile {
  if (!user || user.isActive !== true || user.deleting === true) throw new HttpsError('permission-denied', 'Your account is inactive or missing.');
}
export async function requireActiveUser(uid?: string, tx?: Transaction): Promise<UserProfile> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const ref = getFirestore().doc(`users/${documentId(uid, 'user ID')}`);
  const user = (tx ? await tx.get(ref) : await ref.get()).data();
  assertActiveUser(user);
  return user;
}
export function assertEventManager(user: UserProfile, uid: string, event: DocumentData | undefined): void {
  if (!event) throw new HttpsError('not-found', 'Event not found.');
  if (event.deleting === true) throw new HttpsError('failed-precondition', 'This event is being deleted.');
  if (user.role !== 'admin' && !(user.role === 'organizer' && event.organizerId === uid)) throw new HttpsError('permission-denied', 'Only an admin or this event’s owning organizer may manage it.');
}
export async function requireEventManager(uid: string | undefined, eventId: string, tx?: Transaction) {
  const user = await requireActiveUser(uid, tx);
  const ref = getFirestore().doc(`events/${documentId(eventId, 'event ID')}`);
  const event = (tx ? await tx.get(ref) : await ref.get()).data();
  assertEventManager(user, uid!, event);
  return { user, event: event! };
}
export async function requireAdmin(uid?: string, tx?: Transaction): Promise<UserProfile> {
  const user = await requireActiveUser(uid, tx);
  if (user.role !== 'admin') throw new HttpsError('permission-denied', 'An active admin account is required.');
  return user;
}
export function assertAvailableEvent(event: DocumentData | undefined): void {
  if (!event || event.deleting === true || CLOSED_EVENT_STATUSES.includes(event.status)) throw new HttpsError('failed-precondition', 'This event is unavailable.');
}
export function assertPrimaryLeader(user: UserProfile, uid: string, groupId: string, group: DocumentData): void {
  if (user.role !== 'teamLeader' || user.assignedGroupId !== groupId || group.leaderUserId !== uid) throw new HttpsError('permission-denied', 'Only the active assigned primary leader may perform this action.');
}
/** Rejected attempts still consume quota: this transaction is separate from the action. */
export async function consumeAttempt(uid: string, action: string, limit = 10, windowMs = 60_000): Promise<void> {
  const ref = getFirestore().doc(`operationLimits/${action}_${uid}`);
  await getFirestore().runTransaction(async tx => {
    const data = (await tx.get(ref)).data(), now = Date.now();
    const fresh = !data || now - Number(data.windowStart) >= windowMs;
    const attempts = fresh ? 0 : Number(data.attempts ?? 0);
    if (attempts >= limit) throw new HttpsError('resource-exhausted', 'Too many attempts. Try again later.');
    tx.set(ref, { uid, windowStart: fresh ? now : data!.windowStart, attempts: attempts + 1, expiresAt: Timestamp.fromMillis(now + windowMs * 2) });
  });
}
