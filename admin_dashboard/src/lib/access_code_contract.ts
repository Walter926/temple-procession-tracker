export const DEFAULT_MAX_USES = 1000;
export function accessCodeRequest(eventId: string, groupId = '', maxUses = DEFAULT_MAX_USES) {
  if (!eventId) throw Error('Choose an event.');
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) throw Error('Maximum uses must be an integer from 1–1000.');
  return { eventId, groupId, scope: groupId ? 'group' as const : 'event' as const, grantedRole: 'teamMember' as const, enabled: true, maxUses };
}

export function accessCodeStatus(code: { enabled: boolean; expiresAt?: { toMillis: () => number }; maxUses?: number; usedCount?: number }, now: number) {
  if (!code.enabled) return 'Revoked';
  const expiry = code.expiresAt?.toMillis();
  if (!Number.isFinite(expiry)) return 'Expiry unavailable';
  if (expiry! <= now) return 'Expired';
  // Legacy maxUses: 0 means unlimited; do not label those records exhausted.
  if ((code.maxUses ?? 0) > 0 && (code.usedCount ?? 0) >= code.maxUses!) return 'Exhausted';
  return 'Enabled';
}
