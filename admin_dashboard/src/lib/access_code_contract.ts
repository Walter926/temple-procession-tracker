export const DEFAULT_MAX_USES = 1000;
export const CODE_LIFETIME_MS = 86_400_000;
export function accessCodeRequest(eventId: string, groupId = '', maxUses = DEFAULT_MAX_USES) {
  if (!eventId) throw Error('Choose an event.');
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) throw Error('Maximum uses must be an integer from 1–1000.');
  // Older deployed callables require this field. The current server ignores it
  // and independently enforces exactly 24 hours, so the client cannot extend it.
  return { eventId, groupId, scope: groupId ? 'group' as const : 'event' as const, grantedRole: 'teamMember' as const, enabled: true, maxUses, expiresAtMs: Date.now() + CODE_LIFETIME_MS };
}

export function issuedCodeFormat(code: unknown): 'current' | undefined {
  if (typeof code !== 'string') return;
  if (code.length === 6 && /^[0-9]{6}$/.test(code)) return 'current';
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
