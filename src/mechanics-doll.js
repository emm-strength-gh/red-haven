// Builds the artist's-mannequin doll: smooth off-white shell pieces with orange
// joints between them. The doll faces +Z, its left side is at +X.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { JOINT_SPECS } from './mechanics-data.js';

const RADIAL = 20;

/**
 * Closed, rounded, tapered lathe profile from y=0 (radius rBot) to y=len (radius rTop).
 * `bulge` swells the middle (calf, thigh, chest).
 */
function shellGeometry(len, rBot, rTop, { bulge = 0, capBot = rBot, capTop = rTop, peak = 0.5 } = {}) {
  const pts = [], n = 26;
  for (let i = 0; i <= n; i++) {
    const u = i / n, t = (1 - Math.cos(Math.PI * u)) / 2; // denser samples at the rounded ends
    const y = t * len;
    const swell = 1 + bulge * Math.sin(Math.PI * Math.pow(t, Math.log(0.5) / Math.log(peak)));
    let r = (rBot + (rTop - rBot) * t) * swell;
    const db = y / Math.max(1e-3, capBot), dt = (len - y) / Math.max(1e-3, capTop);
    if (db < 1) r *= Math.sqrt(1 - (1 - db) ** 2);
    if (dt < 1) r *= Math.sqrt(1 - (1 - dt) ** 2);
    pts.push(new THREE.Vector2(Math.max(r, i === 0 || i === n ? 0 : 1e-3), y));
  }
  return new THREE.LatheGeometry(pts, RADIAL);
}

const box = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
const ball = (r) => new THREE.SphereGeometry(r, 20, 14);

/**
 * @param d       scaled body dimensions (see BASE in mechanics-data.js)
 * @param mats    (jointId|null, 'shell'|'joint') => material
 * @param hands   'fist' | 'open'
 */
export function buildDoll(d, mats, hands = 'fist') {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const pivots = {}, tips = {}, parts = [];

  const add = (geo, joint, kind, parent, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) => {
    const m = new THREE.Mesh(geo, mats(joint, kind));
    m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...scale);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.joint = joint;
    parent.add(m); parts.push(m);
    return m;
  };
  const pivot = (id, parent, pos, ballRadius) => {
    const g = new THREE.Group(); g.position.set(...pos); g.rotation.order = JOINT_SPECS[id].order; parent.add(g);
    pivots[id] = g;
    if (ballRadius) add(ball(ballRadius), id, 'joint', g);
    return g;
  };
  // A limb shell hanging down from a pivot with small gaps at both ends for the joints.
  const limb = (id, parent, len, rTop, rBot, gapTop, gapBot, opts) =>
    add(shellGeometry(len - gapTop - gapBot, rBot, rTop, opts), id, 'shell', parent, [0, -(len - gapBot), 0]);

  const hipK = d.hipWidth / 0.82, shK = d.shoulderWidth / 1.82;

  // ---- Pelvis (root, not posable directly: dragging it orbits the camera) ----
  const pelvis = new THREE.Group(); root.add(pelvis);
  add(shellGeometry(0.62, 0.3, 0.47, { bulge: 0.12, capBot: 0.26, capTop: 0.16, peak: 0.6 }), null, 'shell', pelvis, [0, -0.4, 0], [0, 0, 0], [1.08 * hipK, 1, 0.68]);
  add(new THREE.CylinderGeometry(0.4, 0.43, 0.08, RADIAL), null, 'joint', pelvis, [0, 0.235, 0], [0, 0, 0], [1.05 * hipK, 1, 0.68]);

  // ---- Spine, abdomen band and chest ----
  const spine = pivot('spine', pelvis, [0, 0.26, 0]);
  add(shellGeometry(0.62, 0.4, 0.4, { bulge: -0.08, capBot: 0.08, capTop: 0.08 }), 'spine', 'joint', spine, [0, -0.06, 0], [0, 0, 0], [1.0, 1, 0.66]);
  const chestLen = d.torso - 0.5;
  add(shellGeometry(chestLen, 0.4, 0.56, { bulge: 0.2, capBot: 0.12, capTop: 0.26, peak: 0.7 }), 'spine', 'shell', spine, [0, 0.46, 0], [0, 0, 0], [1.16 * shK, 1, 0.6]);
  for (const s of [-1, 1]) { // pectorals
    add(ball(0.3), 'spine', 'shell', spine, [s * 0.25 * shK, 0.46 + chestLen * 0.68, 0.16], [0, 0, s * 0.15], [1.1, 0.62, 0.42]);
  }
  tips.spine = new THREE.Vector3(0, d.torso, 0);

  // ---- Neck and head ----
  const neck = pivot('neck', spine, [0, d.torso, 0]);
  add(new THREE.CylinderGeometry(0.15, 0.19, d.neck + 0.24, RADIAL), 'neck', 'joint', neck, [0, d.neck / 2 - 0.02, 0.01]);
  const headH = d.head * 1.18;
  const head = add(shellGeometry(headH, 0.19, 0.31, { bulge: 0.12, capBot: 0.2, capTop: 0.32, peak: 0.62 }), 'neck', 'shell', neck,
    [0, d.neck - 0.06, 0.05], [-0.16, 0, 0], [0.92, 1, 1.02]);
  head.userData.head = true;
  tips.neck = new THREE.Vector3(0, d.neck + headH * 0.55, 0.25);

  // ---- Arms ----
  const shoulderY = d.torso - 0.42;
  for (const [side, s] of [['left', 1], ['right', -1]]) {
    const sh = pivot(`${side}Shoulder`, spine, [s * d.shoulderWidth / 2 * 0.8, shoulderY, -0.02], 0.17);
    add(ball(0.25), `${side}Shoulder`, 'shell', sh, [s * 0.03, 0.02, 0], [0, 0, 0], [1, 0.95, 1.05]); // deltoid cap
    limb(`${side}Shoulder`, sh, d.upperArm, 0.2, 0.15, 0.22, 0.14, { bulge: 0.06, peak: 0.4 });
    tips[`${side}Shoulder`] = new THREE.Vector3(0, -d.upperArm, 0);

    const el = pivot(`${side}Elbow`, sh, [0, -d.upperArm, 0], 0.125);
    limb(`${side}Elbow`, el, d.forearm, 0.16, 0.11, 0.13, 0.09, { bulge: 0.1, peak: 0.3 });
    tips[`${side}Elbow`] = new THREE.Vector3(0, -d.forearm, 0);

    const wr = pivot(`${side}Wrist`, el, [0, -d.forearm, 0], 0.085);
    buildHand(add, wr, `${side}Wrist`, s, d.hand, hands);
    tips[`${side}Wrist`] = new THREE.Vector3(0, -d.hand, 0);
  }

  // ---- Legs ----
  for (const [side, s] of [['left', 1], ['right', -1]]) {
    const hip = pivot(`${side}Hip`, pelvis, [s * d.hipWidth / 2 * 0.92, -0.16, 0.02], 0.2);
    limb(`${side}Hip`, hip, d.femur, 0.31, 0.18, 0.1, 0.15, { bulge: 0.07, capTop: 0.3, peak: 0.35 });
    tips[`${side}Hip`] = new THREE.Vector3(0, -d.femur, 0);

    const kn = pivot(`${side}Knee`, hip, [0, -d.femur, 0], 0.175);
    limb(`${side}Knee`, kn, d.shin, 0.19, 0.115, 0.15, 0.11, { bulge: 0.14, peak: 0.3 });
    tips[`${side}Knee`] = new THREE.Vector3(0, -d.shin, 0);

    const an = pivot(`${side}Ankle`, kn, [0, -d.shin, 0], 0.11);
    buildFoot(add, an, `${side}Ankle`, d.foot);
    tips[`${side}Ankle`] = new THREE.Vector3(0, -0.15, d.foot * 0.85);
  }

  for (const id of Object.keys(JOINT_SPECS)) if (!pivots[id]) throw new Error(`Doll is missing joint ${id}`);
  return { root, pivots, tips, parts };
}

// Simple mitten hand: palm, finger block and thumb. Palm faces the body (medial).
function buildHand(add, wrist, id, s, len, style) {
  const k = len / 0.52;
  const palmH = 0.28 * k, top = -0.07, knuckleY = top - palmH;
  add(box(0.14, palmH, 0.27, 0.06), id, 'shell', wrist, [0, top - palmH / 2, 0]);
  add(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 16), id, 'joint', wrist, [0, top + 0.01, 0], [0, 0, 0], [1, 1, 1.6]);
  if (style === 'open') {
    add(box(0.1, 0.25 * k, 0.25, 0.045), id, 'shell', wrist, [0, knuckleY - 0.125 * k - 0.015, -0.01]);
    add(box(0.07, 0.17 * k, 0.08, 0.035), id, 'shell', wrist, [s * -0.03, top - 0.17 * k, 0.16], [-0.45, 0, 0]);
  } else {
    // Fingers curled into the palm: a rounded block tucked under and toward the body,
    // with the thumb folded across its front.
    add(box(0.21, 0.17 * k, 0.27, 0.07), id, 'shell', wrist, [s * -0.04, knuckleY - 0.06 * k, 0]);
    add(box(0.08, 0.16 * k, 0.08, 0.035), id, 'shell', wrist, [s * -0.07, knuckleY + 0.01, 0.15], [0, 0, s * 0.5]);
  }
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 8), id, 'joint', wrist, [0, knuckleY - 0.005, 0], [Math.PI / 2, 0, 0], [style === 'open' ? 2.6 : 3.5, 1, 1]);
}

// Wedge-like foot with a separate toe block and an orange toe line, toes along +Z.
function buildFoot(add, ankle, id, len) {
  const k = len / 0.72;
  const soleY = -0.24;
  const footL = 0.6 * k, toeL = 0.2 * k, footZ0 = -0.17;
  add(box(0.3, 0.22, footL, 0.09), id, 'shell', ankle, [0, soleY + 0.11, footZ0 + footL / 2]);
  add(box(0.24, 0.2, 0.32, 0.09), id, 'shell', ankle, [0, -0.06, 0.04], [0.45, 0, 0]); // instep
  add(box(0.28, 0.08, 0.06, 0.03), id, 'joint', ankle, [0, soleY + 0.06, footZ0 + footL + 0.01]);
  add(box(0.29, 0.13, toeL, 0.06), id, 'shell', ankle, [0, soleY + 0.065, footZ0 + footL + 0.035 + toeL / 2]);
}
