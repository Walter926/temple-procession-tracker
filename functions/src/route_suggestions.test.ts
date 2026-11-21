import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { decisionResult, relevantSuggestion, suggestionIdentity } from './route_suggestions';
import { incidentIdentity } from './collision_detection';

test('a recurring collision gets new suggestion identities without duplicating the same incident', () => {
  const first = incidentIdentity('event_stop', 1), second = incidentIdentity('event_stop', 2);
  assert.notEqual(first, second);
  assert.equal(suggestionIdentity(first, 'group'), suggestionIdentity(first, 'group'));
  assert.notEqual(suggestionIdentity(first, 'group'), suggestionIdentity(second, 'group'));
  assert.notEqual(suggestionIdentity(first, 'group'), suggestionIdentity(first, 'other'));
});

test('decisions are repeat-safe and opposite or terminal decisions conflict', () => {
  assert.equal(decisionResult('pending', 'approved'), 'new');
  assert.equal(decisionResult('approved', 'approved'), 'repeat');
  assert.equal(decisionResult('rejected', 'rejected'), 'repeat');
  for (const status of ['rejected', 'resolved', 'expired', 'superseded']) assert.equal(decisionResult(status, 'approved'), 'conflict');
  assert.equal(decisionResult('approved', 'rejected'), 'conflict');
});

test('approval relevance is bound to the active incident, affected group, event and expiry', () => {
  const now = Date.now(), suggestion = { status: 'pending', incidentId: 'incident', groupId: 'group', expiresAt: Timestamp.fromMillis(now + 60000) };
  const alert = { status: 'active', incidentId: 'incident', affectedGroupIds: ['group'], lastSeenAt: Timestamp.fromMillis(now) };
  assert.equal(relevantSuggestion(suggestion, alert, { status: 'active' }, now), true);
  for (const change of [{ status: 'resolved' }, { incidentId: 'next-incident' }, { affectedGroupIds: ['other'] }, { lastSeenAt: Timestamp.fromMillis(now - 90001) }]) assert.equal(relevantSuggestion(suggestion, { ...alert, ...change }, { status: 'active' }, now), false);
  assert.equal(relevantSuggestion(suggestion, alert, { status: 'completed' }, now), false);
  assert.equal(relevantSuggestion({ ...suggestion, expiresAt: Timestamp.fromMillis(now - 1) }, alert, { status: 'active' }, now), false);
});
