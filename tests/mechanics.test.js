import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOINT_IDS, JOINT_SPECS, PRESETS, blendSnapshots, clampJoint, jointEuler, migrateV1Joints, mirrorPose, normalizeJoints,
} from '../src/mechanics-data.js';

test('left and right joints mirror each other: same anatomical value, mirrored y/z rotation', () => {
  for (const id of JOINT_IDS.filter((id) => id.startsWith('left'))) {
    const other = id.replace('left', 'right');
    const v = { x: 20, y: 15, z: 10 };
    const l = jointEuler(id, v), r = jointEuler(other, v);
    for (const { axis } of JOINT_SPECS[id].axes) {
      assert.equal(l[axis], axis === 'x' ? r[axis] : -r[axis], `${id} ${axis}`);
    }
  }
});

test('flexion means forward for hips and shoulders, backward for knees', () => {
  // Limbs hang along -Y and the doll faces +Z. Rotating -Y about X by θ gives z = -sin θ.
  const forward = (id) => -Math.sin(jointEuler(id, { x: 45 }).x) > 0;
  assert.ok(forward('leftHip'));
  assert.ok(forward('rightShoulder'));
  assert.ok(forward('leftElbow'));
  assert.ok(!forward('leftKnee'));
});

test('clamping keeps every axis inside its human range', () => {
  assert.equal(clampJoint('leftKnee', 'x', -20), 0);
  assert.equal(clampJoint('leftKnee', 'x', 400), 150);
  assert.equal(clampJoint('leftKnee', 'z', 30), 0); // the knee has no z axis
  const n = normalizeJoints({ leftElbow: { x: 999 } });
  assert.equal(n.leftElbow.x, 150);
  assert.deepEqual(n.rightElbow, { x: 0, y: 0, z: 0 });
});

test('every preset only uses real joints and stays within limits', () => {
  for (const [key, p] of Object.entries(PRESETS)) {
    for (const [id, v] of Object.entries(p.joints)) {
      assert.ok(JOINT_SPECS[id], `${key}: unknown joint ${id}`);
      for (const [axis, value] of Object.entries(v)) assert.equal(clampJoint(id, axis, value), value, `${key}.${id}.${axis}`);
    }
  }
});

test('mirroring twice returns the original pose', () => {
  const joints = normalizeJoints({ leftShoulder: { x: 40, z: 20 }, rightKnee: { x: 90 }, spine: { y: 12, z: -8 } });
  const body = { x: 5, y: 30, z: -10 };
  const once = mirrorPose({ joints, body });
  assert.equal(once.joints.rightShoulder.x, 40);
  assert.equal(once.joints.leftKnee.x, 90);
  assert.equal(once.joints.spine.y, -12);
  assert.deepEqual(mirrorPose(once), { joints, body });
});

test('v1 saved poses keep their actual rotation after migration', () => {
  // v1 "leftHip" sat on the doll's right side; raw x -70 swung it forward.
  const migrated = migrateV1Joints({ leftHip: { x: -70 }, rightElbow: { x: 110 } });
  assert.equal(migrated.rightHip.x, 70);
  assert.equal(migrated.leftElbow.x, 110);
  assert.equal(jointEuler('rightHip', migrated.rightHip).x, -70 * Math.PI / 180);
});

test('blending eases joints linearly and turns the short way round', () => {
  const a = { joints: normalizeJoints({ leftKnee: { x: 0 } }), body: { x: 0, y: 170, z: 0 } };
  const b = { joints: normalizeJoints({ leftKnee: { x: 100 } }), body: { x: 0, y: -170, z: 0 } };
  const mid = blendSnapshots(a, b, 0.5);
  assert.equal(mid.joints.leftKnee.x, 50);
  assert.equal(mid.body.y, 180);
});
