import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, encodePolyline, pathDistanceMeters } from '../src/lib/polyline.ts';
import { validateRoute, validateStop, trackingLabel } from '../src/lib/validation.ts';

test('Google reference polyline decodes and re-encodes without changing legacy geometry', () => {
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
  const points = [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }];
  assert.deepEqual(decodePolyline(encoded), points);
  assert.equal(encodePolyline(points), encoded);
});
test('distance follows each leg, not the straight start-to-end shortcut', () => {
  assert.ok(Math.abs(pathDistanceMeters([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }]) - 222390) < 5);
});
test('malformed geometry, out-of-range coordinates, and zero-length paths are rejected', () => {
  assert.throws(() => decodePolyline('_'));
  assert.throws(() => encodePolyline([{ lat: 91, lng: 0 }]));
  assert.notEqual(validateRoute('??', 0), '');
  assert.notEqual(validateRoute('????', 0), '');
});
test('stops reject duplicate order, invalid coordinates, excessive geofences, fractional capacity', () => {
  const valid = { latitude: 49, longitude: -123, order: 1, radius: 100, maxGroups: 2 };
  assert.equal(validateStop(valid, [2]), '');
  for (const [value, orders] of [[valid, [1]], [{ ...valid, latitude: 91 }, []], [{ ...valid, radius: 1001 }, []], [{ ...valid, maxGroups: 1.5 }, []]]) assert.notEqual(validateStop(value, orders), '');
});
test('tracking ages without another GPS sample; paused/stopped states are not shown as active', () => {
  assert.equal(trackingLabel('active', 100000, 100000, 110000), 'active');
  assert.equal(trackingLabel('active', 150000, 100000, 150000), 'GPS stale');
  assert.equal(trackingLabel('active', 100000, 100000, 200000), 'Disconnected');
  assert.equal(trackingLabel('stopped', 100000, 100000, 200000), 'stopped');
  assert.equal(trackingLabel('paused', 100000, 100000, 200000), 'paused');
});
