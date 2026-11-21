import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { accessCodeMaxUses, CODE_LIFETIME_MS, DEFAULT_MAX_USES, generateCode, normalizeCode, validateCode } from './access_codes';
import { leaderDirectoryRecord } from './account_management';

test('new access-code limits default to 1000 and accept only integers in 1..1000', () => {
  assert.equal(DEFAULT_MAX_USES, 1000);
  assert.equal(accessCodeMaxUses(), 1000);
  assert.equal(accessCodeMaxUses(undefined), 1000);
  for (const value of [1, 2, 999, 1000]) assert.equal(accessCodeMaxUses(value), value);
  for (const value of [null, 0, -1, 1001, 1.5, NaN, Infinity, '1', '', true, false, [], {}]) {
    assert.throws(() => accessCodeMaxUses(value), { code: 'invalid-argument' });
  }
});

test('legacy stored unlimited and larger positive limits are not reinterpreted as new defaults', () => {
  const now = Date.now(), code = { enabled: true, scope: 'event', groupId: '', grantedRole: 'teamMember', expiresAt: Timestamp.fromMillis(now + 1000), usedCount: 1001 };
  assert.doesNotThrow(() => validateCode(code, now));
  assert.doesNotThrow(() => validateCode({ ...code, maxUses: undefined }, now));
  assert.doesNotThrow(() => validateCode({ ...code, maxUses: 0 }, now));
  assert.doesNotThrow(() => validateCode({ ...code, maxUses: 2000 }, now));
  assert.throws(() => validateCode({ ...code, maxUses: 1000 }, now), { code: 'resource-exhausted' });
});

test('corrupt stored usage limits fail closed instead of coercing into unlimited or numeric limits', () => {
  const now = Date.now(), code = { enabled: true, scope: 'event', groupId: '', grantedRole: 'teamMember', expiresAt: Timestamp.fromMillis(now + 1000), usedCount: 0 };
  for (const maxUses of [-1, NaN, Infinity, -Infinity, 1.5, '0', '1', 'bad', null, true, [], {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateCode({ ...code, maxUses }, now), { code: 'failed-precondition' });
  }
});

test('code generation retains six symbols, normalization and the fixed 24-hour contract', () => {
  assert.equal(CODE_LIFETIME_MS, 86400000);
  for (let index = 0; index < 30; index++) assert.ok(/^[A-Z0-9]{6}$/.test(generateCode()));
  assert.equal(normalizeCode(' ab12cd '), 'AB12CD');
  for (const value of ['', 'AB-CD1', 'ABCDEFG', 123456]) assert.throws(() => normalizeCode(value), { code: 'invalid-argument' });
});

test('leader labels prefer display name, full name, email, then a non-UID fallback', () => {
  const id = randomUUID(), groupId = randomUUID();
  const profile = { role: 'teamLeader', isActive: true, displayName: ' Display name ', fullName: ' Full name ', email: 'leader@example.test' };
  assert.equal(leaderDirectoryRecord(id, profile, groupId).displayName, 'Display name');
  assert.equal(leaderDirectoryRecord(id, { ...profile, displayName: ' ' }, groupId).displayName, 'Full name');
  assert.equal(leaderDirectoryRecord(id, { ...profile, displayName: null, fullName: {} }, groupId).displayName, 'leader@example.test');
  assert.equal(leaderDirectoryRecord(id, { ...profile, displayName: id, fullName: '', email: '' }, groupId).displayName, 'Team leader (name unavailable)');
  const missing = leaderDirectoryRecord(id, undefined, groupId);
  assert.equal(missing.displayName, 'Team leader (profile unavailable)');
  assert.equal(missing.profileMissing, true);
  assert.equal(missing.isActive, false);
  assert.equal(missing.isEligible, false);
});

test('directory records expose minimal metadata without granting inactive or mismatched assignments eligibility', () => {
  const id = randomUUID(), groupId = randomUUID();
  const profile = { role: 'teamLeader', isActive: true, fullName: 'Leader', privateNotes: 'private', phoneNumber: 'private' };
  const record = leaderDirectoryRecord(id, profile, groupId);
  assert.equal(record.isEligible, true);
  assert.equal(leaderDirectoryRecord(id, { ...profile, assignedGroupId: groupId }, groupId).isEligible, true);
  for (const patch of [{ isActive: false }, { deleting: true }, { role: 'teamMember' }, { assignedGroupId: randomUUID() }]) {
    assert.equal(leaderDirectoryRecord(id, { ...profile, ...patch }, groupId).isEligible, false);
  }
  assert.equal('privateNotes' in record, false);
  assert.equal('phoneNumber' in record, false);
});
