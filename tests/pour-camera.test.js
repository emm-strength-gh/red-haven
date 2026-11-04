import test from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, orbitRadians, pinchZoom } from '../src/pour-camera.js';

test('pinching changes zoom proportionally and keeps it in a usable range', () => {
  assert.equal(pinchZoom(1, 100, 150), 1.5);
  assert.equal(pinchZoom(1.5, 100, 50), .75);
  assert.equal(pinchZoom(1, 100, 500), 2.4);
  assert.equal(clampZoom(.1), .75);
});

test('horizontal swipes orbit in opposite directions', () => {
  assert.ok(Math.abs(orbitRadians(100) + .9) < 1e-10);
  assert.ok(Math.abs(orbitRadians(-100) - .9) < 1e-10);
  assert.ok(Math.abs(orbitRadians(0)) === 0);
});
