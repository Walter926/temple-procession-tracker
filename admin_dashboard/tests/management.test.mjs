import test from 'node:test';
import assert from 'node:assert/strict';
import { createResourceWriter, createSingleFlight } from '../src/lib/management_requests.ts';
import { managementError } from '../src/lib/management_errors.ts';
import { accessCodeRequest, accessCodeStatus, CODE_LIFETIME_MS, issuedCodeFormat } from '../src/lib/access_code_contract.ts';
import { eligibleLeader, leaderLabel, mergeProfiles } from '../src/lib/leader_profiles.ts';
import { dateTimeLocal, overdueEventNotice, parseLocalDateTime } from '../src/lib/event_dates.ts';
import { eventFieldErrors, routeFieldErrors, stopFieldErrors } from '../src/lib/validation.ts';
import { encodePolyline, pathDistanceMeters } from '../src/lib/polyline.ts';

test('seven-point route retries keep one ID, coalesce double submission, then update that same route', async () => {
  const path = Array.from({ length: 7 }, (_, i) => ({ lat: 49.28 + i / 1000, lng: -123.12 + i / 1000 }));
  const data = { name: 'Seven points', description: 'Draft fixture', color: '#475569', encodedPolyline: encodePolyline(path), totalDistanceMeters: pathDistanceMeters(path), estimatedDurationMinutes: 34 };
  const requests = [], stored = new Map();
  let attempts = 0;
  const write = createResourceWriter('route', 'draft-event', 'stable-route', false, async request => {
    requests.push(request); stored.set(request.id, request.data);
    if (++attempts === 1) throw Error('Response lost after write');
    return { id: request.id };
  });
  const first = write(data), duplicate = write(data);
  assert.equal(first, duplicate);
  await assert.rejects(first, /Response lost/);
  assert.equal(await write(data), 'stable-route');
  await write({ ...data, name: 'Edited', encodedPolyline: encodePolyline([...path, { lat: 49.29, lng: -123.1 }]) });
  assert.deepEqual(requests.map(r => [r.operation, r.resource, r.eventId, r.id]), [
    ['create', 'route', 'draft-event', 'stable-route'], ['create', 'route', 'draft-event', 'stable-route'], ['update', 'route', 'draft-event', 'stable-route'],
  ]);
  assert.equal(stored.size, 1);
  assert.equal(stored.get('stable-route').name, 'Edited');
  assert.equal(requests[0].data.estimatedDurationMinutes, 34);
  assert.ok(requests[0].data.totalDistanceMeters > 0);
});

test('event creates align eventId/id, existing records never create, and unexpected response IDs fail', async () => {
  const requests = [];
  const send = async request => { requests.push(request); return { id: request.id }; };
  await createResourceWriter('event', '', 'new-event', false, send)({ name: 'Draft', startTimeMs: 1234, endTimeMs: null });
  await createResourceWriter('route', 'event', 'existing', true, send)({ name: 'Edit' });
  assert.equal(requests[0].eventId, requests[0].id);
  assert.equal(requests[0].data.endTimeMs, null);
  assert.equal(requests[1].operation, 'update');
  await assert.rejects(createResourceWriter('route', 'event', 'expected', false, async () => ({ id: 'different' }))({}), /unexpected record ID/);
});

test('an ambiguous create replays its original fingerprint before applying changed fields as an update', async () => {
  const requests = [];
  const write = createResourceWriter('route', 'event', 'stable', false, async request => {
    requests.push(request);
    if (requests.length === 1) throw Object.assign(Error('Response lost'), { code: 'functions/internal' });
    return { id: request.id };
  });
  await assert.rejects(write({ name: 'Original' }), /Response lost/);
  await write({ name: 'Edited after failure' });
  assert.deepEqual(requests.map(r => [r.operation, r.id, r.data.name]), [['create', 'stable', 'Original'], ['create', 'stable', 'Original'], ['update', 'stable', 'Edited after failure']]);
});

test('an explicit server validation rejection permits corrected creation data under the same ID', async () => {
  const requests = [];
  const write = createResourceWriter('route', 'event', 'stable', false, async request => {
    requests.push(request);
    if (requests.length === 1) throw Error('Invalid name', { cause: { code: 'functions/invalid-argument' } });
    return { id: request.id };
  });
  await assert.rejects(write({ name: '' }), /Invalid name/);
  await write({ name: 'Corrected' });
  assert.equal(requests[1].data.name, 'Corrected'); assert.equal(requests[1].id, requests[0].id);
});

test('single-flight guard unlocks only after explicit completion', () => {
  const guard = createSingleFlight();
  assert.equal(guard.start(), true); assert.equal(guard.start(), false);
  guard.finish(); assert.equal(guard.start(), true);
});

test('code request uses numeric default 1000 and preserves membership scopes', () => {
  const started = Date.now(), request = accessCodeRequest('event');
  assert.deepEqual({ ...request, expiresAtMs: undefined }, { eventId: 'event', groupId: '', scope: 'event', grantedRole: 'teamMember', enabled: true, maxUses: 1000, expiresAtMs: undefined });
  assert.equal(CODE_LIFETIME_MS, 86400000);
  assert.ok(request.expiresAtMs >= started + CODE_LIFETIME_MS && request.expiresAtMs <= Date.now() + CODE_LIFETIME_MS);
  assert.equal(accessCodeRequest('event', 'group').scope, 'group');
  for (const bad of [0, -1, 1001, 1.5, NaN, '1000', null]) assert.throws(() => accessCodeRequest('event', '', bad), /Maximum uses/);
  assert.throws(() => accessCodeRequest(''), /Choose an event/);
});

test('new code responses require exactly six numeric digits and preserve leading zeros', () => {
  for (const code of ['513684', '000042', '000000']) assert.equal(issuedCodeFormat(code), 'current');
  for (const invalid of [undefined, null, 123456, '12345', '1234567', ' 123456', '123456 ', '123456\n', '１２３４５６', 'AB12CD', 'ABCD-1234-EFAB-5678-90CD', 'ABCD1234EFAB567890CD', '<script>']) assert.equal(issuedCodeFormat(invalid), undefined);
});

test('issued-code states distinguish exhausted, expired and revoked; legacy unlimited codes remain valid', () => {
  const code = { enabled: true, usedCount: 1000, maxUses: 1000, expiresAt: { toMillis: () => 2000 } };
  assert.equal(accessCodeStatus(code, 1000), 'Exhausted');
  assert.equal(accessCodeStatus({ ...code, maxUses: 0 }, 1000), 'Enabled');
  assert.equal(accessCodeStatus(code, 2000), 'Expired');
  assert.equal(accessCodeStatus({ ...code, enabled: false }, 1000), 'Revoked');
  assert.equal(accessCodeStatus({ ...code, expiresAt: undefined }, 1000), 'Expiry unavailable');
});

test('leader labels use display/full/email/fallback, never a raw UID; merged pages keep one profile per ID', () => {
  assert.equal(leaderLabel({ displayName: ' Display ', fullName: 'Full', email: 'email' }), 'Display');
  assert.equal(leaderLabel({ displayName: ' ', fullName: ' Full ', email: 'email' }), 'Full');
  assert.equal(leaderLabel({ email: ' leader@example.test ' }), 'leader@example.test');
  assert.equal(leaderLabel({ id: 'private-uid' }, true), 'Assigned leader (profile unavailable)');
  assert.equal(mergeProfiles([{ id: 'a', fullName: 'Old' }], [{ id: 'a', fullName: 'New' }])[0].fullName, 'New');
  const leader = { role: 'teamLeader', isActive: true };
  assert.equal(eligibleLeader(leader, 'group'), true);
  for (const patch of [{ isEligible: false }, { profileMissing: true }, { isActive: false }, { assignedGroupId: 'other' }]) assert.equal(eligibleLeader({ ...leader, ...patch }, 'group'), false);
});

test('callable failures surface server validation details and deployment guidance without CORS masking', () => {
  assert.equal(managementError({ code: 'functions/failed-precondition', message: 'Validation failed', details: { errors: ['Choose primary route.', 'Assign leader.'] } }, 'manageEvent'), 'Choose primary route. Assign leader.');
  for (const endpoint of ['validateEvent', 'listAssignableLeaders', 'assignGroupLeader']) {
    const message = managementError({ code: 'functions/internal', message: 'internal [0]' }, endpoint);
    assert.match(message, new RegExp(endpoint)); assert.match(message, /deployed.*region/); assert.doesNotMatch(message, /internal \[0\]|CORS/);
  }
  assert.match(managementError({ code: 'functions/invalid-argument', message: 'Duration must be 0–10080 minutes.' }), /Duration/);
});

test('route and event validation report individual fields, including blank numeric and invalid dates', () => {
  const path = encodePolyline([{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }]);
  assert.deepEqual(routeFieldErrors({ name: 'Route', description: '', color: '#123456', encoded: path, duration: '34' }), {});
  const errors = routeFieldErrors({ name: ' ', description: '', color: 'red', encoded: '', duration: '' });
  assert.deepEqual(Object.keys(errors).sort(), ['routeColor', 'routeDuration', 'routeGeometry', 'routeName']);
  const event = { name: 'Event', description: '', start: '2026-11-20T12:00', end: '2026-11-20T13:00', mainTempleName: 'Temple', cityRegion: 'City', organizerContact: '', emergencyContact: '', status: 'draft' };
  assert.deepEqual(eventFieldErrors(event), {});
  assert.ok(eventFieldErrors({ ...event, end: event.start }).endTime);
  assert.ok(eventFieldErrors({ ...event, start: '2026-02-31T12:00' }).startTime);
  assert.ok(eventFieldErrors({ ...event, status: 'active' }, 'completed').eventStatus);
});

test('stop fields reject empty coordinates and invalid timing while permitting real zero coordinates', () => {
  const stop = { name: 'Stop', description: '', latitude: '0', longitude: '0', order: '1', radius: '100', maxGroups: '1', arrival: '', departure: '' };
  assert.deepEqual(stopFieldErrors(stop, []), {});
  assert.ok(stopFieldErrors({ ...stop, latitude: '' }, []).stopLatitude);
  assert.ok(stopFieldErrors(stop, [1]).stopOrder);
  assert.ok(stopFieldErrors({ ...stop, arrival: '2026-11-20T13:00', departure: '2026-11-20T12:00' }, []).stopDeparture);
});

test('date parsing rejects rollovers/malformed input; overdue notice never changes the manual status', () => {
  for (const value of ['', 'not-a-date', '2026-02-30T12:00', '2026-13-01T12:00', '2026-01-01T24:00', '2026-01-01']) assert.ok(Number.isNaN(parseLocalDateTime(value)), value);
  assert.ok(Number.isFinite(parseLocalDateTime('2026-11-20T12:34')));
  assert.equal(dateTimeLocal({ toDate: () => new Date(NaN) }), '');
  const event = { status: 'active', endTime: { toMillis: () => 1000 } };
  assert.match(overdueEventNotice(event, 1001), /managed manually/);
  assert.equal(event.status, 'active');
  assert.equal(overdueEventNotice({ ...event, status: 'completed' }, 1001), '');
  assert.equal(overdueEventNotice({ status: 'active' }, 1001), '');
  assert.equal(overdueEventNotice({ ...event, endTime: { toMillis: () => NaN } }, 1001), '');
});
