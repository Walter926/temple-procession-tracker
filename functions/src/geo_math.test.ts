import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, insideGeofence } from './geo_math';

test('same coordinates are 0 m apart', () => assert.equal(distanceMeters(49.1664, -123.1376, 49.1664, -123.1376), 0));
test('short distance approximates ground truth', () => assert.ok(Math.abs(distanceMeters(49.1664, -123.1376, 49.1674, -123.1376) - 111) < 2));
test('reject malformed coordinates', () => assert.throws(() => distanceMeters(99, 0, 0, 0)));
test('inside requires reliable accuracy', () => { assert.equal(insideGeofence(40, 100, 10), true); assert.equal(insideGeofence(120, 100, 10), false); assert.equal(insideGeofence(40, 100, 120), false); });