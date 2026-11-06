// Pure data and pose maths for Body Mechanics (no three.js, so it can be unit tested).
//
// Joint values are stored in anatomical degrees that read the same on both sides:
// e.g. `leftHip.x = 90` and `rightHip.x = 90` both mean "thigh raised forward 90°".
// `SIGNS` converts those anatomical values into the actual Euler rotation of each
// pivot. The doll faces +Z, its left side is at +X and limbs hang along -Y.

export const STORE_KEY = 'body-mechanics-pose-library-v2';
export const LEGACY_STORE_KEY = 'body-mechanics-pose-library-v1';
export const AXES = ['x', 'y', 'z'];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export const BASE = {
  torso: 1.85, neck: 0.28, head: 0.72, upperArm: 1.25, forearm: 1.1,
  femur: 1.68, shin: 1.55, shoulderWidth: 1.82, hipWidth: 0.82, hand: 0.52, foot: 0.72,
};
export const DEFAULT_PROPORTIONS = Object.fromEntries(Object.keys(BASE).map((k) => [k, 1]));
export const PROPORTION_LABELS = {
  torso: 'Torso length', neck: 'Neck length', head: 'Head size', shoulderWidth: 'Shoulder width',
  hipWidth: 'Hip width', upperArm: 'Upper arms', forearm: 'Forearms', hand: 'Hands',
  femur: 'Thighs', shin: 'Lower legs', foot: 'Feet',
};

export const HAND_STYLES = { fist: 'Fist', open: 'Open' };

// axis: [key, label, min, max, word at min end, word at max end]
const ax = (axis, label, min, max, neg, pos) => ({ axis, label, min, max, neg, pos });

// Euler orders: head and spine turn first, then nod/tilt within the turned frame.
// Limbs flex outermost, then abduct, and twist innermost so "Rotate" always spins
// the limb about its own length whatever the swing.
const centre = (label, group, axes, signs, drag) => ({ label, group, axes, signs, drag, order: 'YXZ' });

function pair(name, group, axes, leftSigns, drag) {
  // The right side mirrors the left across the YZ plane: x keeps its sign, y and z flip.
  const rightSigns = { ...leftSigns };
  for (const k of ['y', 'z']) if (k in rightSigns) rightSigns[k] = -leftSigns[k];
  return {
    [`left${name}`]: { label: `Left ${name.toLowerCase()}`, group, side: 'left', axes, signs: leftSigns, drag, order: 'XZY' },
    [`right${name}`]: { label: `Right ${name.toLowerCase()}`, group, side: 'right', axes, signs: rightSigns, drag, order: 'XZY' },
  };
}

export const JOINT_SPECS = {
  neck: centre('Neck', 'Head & core', [
    ax('x', 'Nod', -45, 60, 'Up', 'Down'),
    ax('y', 'Turn', -75, 75, 'Right', 'Left'),
    ax('z', 'Tilt', -35, 35, 'Right', 'Left'),
  ], { x: 1, y: 1, z: -1 }, ['x', 'y']),
  spine: centre('Spine', 'Head & core', [
    ax('x', 'Bend', -30, 60, 'Back', 'Forward'),
    ax('y', 'Twist', -45, 45, 'Right', 'Left'),
    ax('z', 'Side bend', -35, 35, 'Right', 'Left'),
  ], { x: 1, y: 1, z: -1 }, ['x', 'z']),
  ...pair('Shoulder', 'Arms', [
    ax('x', 'Raise forward', -60, 180, 'Back', 'Forward'),
    ax('z', 'Raise sideways', -20, 180, 'In', 'Out'),
    ax('y', 'Rotate', -90, 90, 'Out', 'In'),
  ], { x: -1, y: -1, z: 1 }, ['x', 'z']),
  ...pair('Elbow', 'Arms', [
    ax('x', 'Bend', 0, 150, 'Straight', 'Bent'),
    ax('y', 'Forearm roll', -80, 80, 'Out', 'In'),
  ], { x: -1, y: -1 }, ['x']),
  ...pair('Wrist', 'Arms', [
    ax('z', 'Flex', -70, 80, 'Back', 'Palm'),
    ax('x', 'Tilt', -25, 30, 'Pinky', 'Thumb'),
  ], { x: -1, z: -1 }, ['z', 'x']),
  ...pair('Hip', 'Legs', [
    ax('x', 'Raise forward', -30, 125, 'Back', 'Forward'),
    ax('z', 'Raise sideways', -30, 50, 'In', 'Out'),
    ax('y', 'Rotate', -45, 45, 'Out', 'In'),
  ], { x: -1, y: -1, z: 1 }, ['x', 'z']),
  ...pair('Knee', 'Legs', [
    ax('x', 'Bend', 0, 150, 'Straight', 'Bent'),
    ax('y', 'Rotate', -15, 15, 'Out', 'In'),
  ], { x: 1, y: -1 }, ['x']),
  ...pair('Ankle', 'Legs', [
    ax('x', 'Flex', -45, 30, 'Point', 'Lift toes'),
    ax('z', 'Roll', -25, 25, 'Out', 'In'),
  ], { x: -1, z: -1 }, ['x', 'z']),
};
export const JOINT_IDS = Object.keys(JOINT_SPECS);

export const zeroJoints = () => Object.fromEntries(JOINT_IDS.map((id) => [id, { x: 0, y: 0, z: 0 }]));

/** Actual pivot rotation in radians for one joint's anatomical values. */
export function jointEuler(id, value) {
  const s = JOINT_SPECS[id].signs;
  const r = Math.PI / 180;
  return { x: (value.x || 0) * (s.x ?? 1) * r, y: (value.y || 0) * (s.y ?? 1) * r, z: (value.z || 0) * (s.z ?? 1) * r };
}

export function clampJoint(id, axis, value) {
  const def = JOINT_SPECS[id]?.axes.find((a) => a.axis === axis);
  return def ? clamp(+value || 0, def.min, def.max) : 0;
}

/** Full joint table from a sparse one, with every value clamped to its human range. */
export function normalizeJoints(sparse = {}) {
  const out = zeroJoints();
  for (const id of JOINT_IDS) for (const { axis } of JOINT_SPECS[id].axes) {
    if (sparse[id]?.[axis] != null) out[id][axis] = clampJoint(id, axis, sparse[id][axis]);
  }
  return out;
}

const otherSide = (id) => id.startsWith('left') ? id.replace('left', 'right') : id.startsWith('right') ? id.replace('right', 'left') : id;

/** Swap left/right so the doll strikes the mirror-image pose. */
export function mirrorPose({ joints, body }) {
  const out = zeroJoints();
  for (const id of JOINT_IDS) {
    const src = joints[otherSide(id)] || {};
    out[id] = { x: src.x || 0, y: src.y || 0, z: src.z || 0 };
    if (!JOINT_SPECS[id].side) { out[id].y = 0 - out[id].y; out[id].z = 0 - out[id].z; } // 0 - v avoids -0
  }
  return { joints: out, body: { x: body.x || 0, y: 0 - (body.y || 0), z: 0 - (body.z || 0) } };
}

// v1 stored raw rotations, its "left" limbs sat on the doll's right (-X) and only
// the elbow had a sign flip. Convert so old saved poses keep their look (single-axis
// moves match exactly; v1 used one Euler order everywhere, so combined limb angles
// can differ slightly).
const V1_SIGNS = { leftElbow: { x: -1 }, rightElbow: { x: -1 } };
export function migrateV1Joints(old = {}) {
  const out = {};
  for (const [oldId, val] of Object.entries(old)) {
    const id = otherSide(oldId);
    if (!JOINT_SPECS[id]) continue;
    out[id] = {};
    for (const axis of AXES) {
      const actual = (val?.[axis] || 0) * (V1_SIGNS[oldId]?.[axis] ?? 1);
      out[id][axis] = actual / (JOINT_SPECS[id].signs[axis] ?? 1);
    }
  }
  return normalizeJoints(out);
}

export function migrateV1Library(lib) {
  const poses = (Array.isArray(lib?.poses) ? lib.poses : []).map((p) => ({
    id: p.id, name: p.name,
    data: {
      joints: migrateV1Joints(p.data?.joints),
      body: { x: 0, y: 0, z: 0, ...p.data?.body },
      proportions: { ...DEFAULT_PROPORTIONS, ...p.data?.proportions },
      hands: 'fist',
    },
  }));
  return { poses, duration: lib?.duration, loop: lib?.loop };
}

/** Shortest-path angle target so yaw tweens never spin the long way round. */
export const shortestTarget = (a, b) => a + ((((b - a) + 540) % 360) - 180);

export function blendSnapshots(from, to, t) {
  const joints = zeroJoints();
  for (const id of JOINT_IDS) for (const axis of AXES) joints[id][axis] = lerp(from.joints[id]?.[axis] || 0, to.joints[id]?.[axis] || 0, t);
  const body = {};
  for (const axis of AXES) body[axis] = lerp(from.body?.[axis] || 0, shortestTarget(from.body?.[axis] || 0, to.body?.[axis] || 0), t);
  return { joints, body };
}

// Presets are written in anatomical degrees, so left and right read the same.
const both = (name, v) => ({ [`left${name}`]: v, [`right${name}`]: v });
export const PRESETS = {
  neutral: { name: 'Neutral', body: [0, 0, 0], joints: {
    ...both('Shoulder', { z: 8 }), ...both('Elbow', { x: 10 }),
  } },
  relaxed: { name: 'Relaxed', body: [0, -10, 0], joints: {
    spine: { y: 8, z: -4 }, neck: { x: 6, y: 18, z: 6 },
    leftShoulder: { x: 30, z: 18 }, leftElbow: { x: 115, y: -40 }, leftWrist: { z: -20 },
    rightShoulder: { x: 4, z: 10 }, rightElbow: { x: 18 },
    leftHip: { x: 4, z: 6, y: -10 }, rightHip: { x: 16, z: 4, y: -12 }, rightKnee: { x: 22 }, rightAnkle: { x: -14 },
  } },
  squat: { name: 'Back squat', body: [32, 0, 0], joints: {
    spine: { x: 6 }, neck: { x: -24 },
    ...both('Shoulder', { x: 10, z: 72, y: -80 }), ...both('Elbow', { x: 120 }),
    ...both('Hip', { x: 112, z: 18, y: -12 }), ...both('Knee', { x: 112 }), ...both('Ankle', { x: 26 }),
  } },
  deadlift: { name: 'Deadlift setup', body: [48, 0, 0], joints: {
    neck: { x: -30 },
    ...both('Shoulder', { x: 48, z: 6 }), ...both('Elbow', { x: 0 }),
    ...both('Hip', { x: 92, z: 8 }), ...both('Knee', { x: 62 }), ...both('Ankle', { x: 18 }),
  } },
  bench: { name: 'Bench press', body: [-90, 0, 0], joints: {
    neck: { x: 10 },
    ...both('Shoulder', { x: 84, z: 12 }), ...both('Elbow', { x: 12 }), ...both('Wrist', { z: -15 }),
    ...both('Hip', { x: -12, z: 22 }), ...both('Knee', { x: 92 }), ...both('Ankle', { x: 6 }),
  } },
  overhead: { name: 'Overhead lockout', body: [0, 0, 0], joints: {
    spine: { x: -6 }, neck: { x: -8 },
    ...both('Shoulder', { x: 172, z: 12 }), ...both('Elbow', { x: 4 }), ...both('Wrist', { z: -20 }),
  } },
  runner: { name: 'Runner', body: [10, 0, 0], joints: {
    spine: { x: 6, y: -8 }, neck: { x: -6 },
    leftShoulder: { x: -40, z: 8 }, leftElbow: { x: 95 },
    rightShoulder: { x: 52, z: 8 }, rightElbow: { x: 88 },
    rightHip: { x: 62 }, rightKnee: { x: 70 }, rightAnkle: { x: 10 },
    leftHip: { x: -22 }, leftKnee: { x: 95 }, leftAnkle: { x: -30 },
  } },
};
