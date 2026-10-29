import * as THREE from 'three';
import { SIZE } from './game.js';

// ---------------------------------------------------------------- cel shading
// Three-band toon ramp + inverted-hull outlines (same look as Drift Haven).

const gradient = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
gradient.minFilter = THREE.NearestFilter;
gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

const toonCache = new Map();
function toon(color, opts = {}) {
  const key = `${color}|${opts.emissive ?? ''}|${opts.ei ?? 0}|${opts.opacity ?? 1}|${opts.double ? 1 : 0}`;
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: gradient });
    if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.ei ?? 1; }
    if (opts.opacity !== undefined && opts.opacity < 1) { m.transparent = true; m.opacity = opts.opacity; m.depthWrite = false; }
    if (opts.double) m.side = THREE.DoubleSide;
    toonCache.set(key, m);
  }
  return m;
}

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1d2433, side: THREE.BackSide });
function addOutline(mesh, scale = 1.08) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.setScalar(scale);
  o.raycast = () => {};
  mesh.add(o);
  return o;
}

const geoCache = new Map();
const cached = (key, make) => {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
};
const geo = {
  box: (w, h, d) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt, rb, h, s = 8) => cached(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s)),
  sphere: (r, w = 8, h = 6) => cached(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)),
  dome: (r) => cached(`h${r}`, () => new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
  cone: (r, h, s = 8) => cached(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s)),
  torus: (r, t) => cached(`t${r},${t}`, () => new THREE.TorusGeometry(r, t, 6, 14)),
  ico: (r, d = 0) => cached(`i${r},${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  dodec: (r) => cached(`d${r}`, () => new THREE.DodecahedronGeometry(r, 0))
};

/** Add a cel-shaded primitive to a group. */
function mk(parent, g, color, pos = [0, 0, 0], rot = [0, 0, 0], material) {
  const m = new THREE.Mesh(g, material ?? toon(color));
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const palette = {
  ground: [0xd77c52, 0xe38d55, 0xca7250, 0xe59660, 0xc56c4b],
  soil: 0x81745a, ridge: 0xb85f43, stone: 0xb48b72
};

// Models are authored on a 2-unit tile (like Drift Haven) and scaled to the 1-unit map grid.
const TILE_SCALE = 0.5;

// ---------------------------------------------------------------- characters

function person(opts) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const pants = opts.pants ?? '#3d4f6b';
  const legL = new THREE.Group(); legL.position.set(-0.11, 0.36, 0); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.11, 0.36, 0); body.add(legR);
  for (const leg of [legL, legR]) {
    mk(leg, geo.box(0.15, 0.3, 0.16), pants, [0, -0.17, 0]);
    mk(leg, geo.box(0.18, 0.1, 0.26), '#3b2a1e', [0, -0.31, 0.04]);
  }
  addOutline(mk(body, geo.box(0.42, 0.4, 0.28), opts.shirt, [0, 0.56, 0]), 1.07);
  mk(body, geo.box(0.44, 0.06, 0.3), '#3b2a1e', [0, 0.38, 0]);
  if (opts.raider) for (let i = 0; i < 2; i++) mk(body, geo.box(0.43, 0.05, 0.29), '#e8d6b0', [0, 0.5 + i * 0.13, 0]);
  const armL = new THREE.Group(); armL.position.set(-0.27, 0.73, 0); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.27, 0.73, 0); body.add(armR);
  for (const arm of [armL, armR]) {
    mk(arm, geo.box(0.12, 0.32, 0.13), opts.shirt, [0, -0.15, 0]);
    mk(arm, geo.sphere(0.09, 6, 5), opts.skin, [0, -0.34, 0]);
  }
  const tool = new THREE.Group();
  tool.position.set(0, -0.36, 0.05);
  armR.add(tool);
  const head = new THREE.Group(); head.position.set(0, 0.98, 0); body.add(head);
  addOutline(mk(head, geo.sphere(0.25, 10, 8), opts.skin), 1.07);
  mk(head, geo.sphere(0.255, 10, 8), opts.hair, [0, 0.07, -0.04]).scale.set(1, 0.75, 1);
  for (const ex of [-0.09, 0.09]) mk(head, geo.sphere(0.035, 5, 4), '#1d2433', [ex, 0, 0.23]);
  mk(head, geo.box(0.1, 0.025, 0.02), '#8a4a3a', [0, -0.1, 0.235]);
  switch (opts.hat) {
    case 'hardhat':
      mk(head, geo.dome(0.27), '#F4C75A', [0, 0.08, 0]);
      mk(head, geo.cyl(0.31, 0.31, 0.03, 12), '#F4C75A', [0, 0.08, 0.04]);
      break;
    case 'straw':
      mk(head, geo.cyl(0.38, 0.38, 0.04, 12), '#E7D6B0', [0, 0.17, 0]);
      mk(head, geo.cyl(0.2, 0.23, 0.17, 12), '#E7D6B0', [0, 0.27, 0]);
      mk(head, geo.cyl(0.235, 0.235, 0.05, 12), '#6AA850', [0, 0.21, 0]);
      break;
    case 'goggles':
      mk(head, geo.box(0.52, 0.06, 0.5), '#3f4548', [0, 0.1, 0]);
      for (const ex of [-0.1, 0.1]) mk(head, geo.cyl(0.07, 0.07, 0.06, 8), '#46B8DD', [ex, 0.1, 0.25], [Math.PI / 2, 0, 0], toon('#9ad4f5', { emissive: '#46B8DD', ei: 0.4 }));
      break;
    case 'helmet':
      mk(head, geo.dome(0.28), '#717B7D', [0, 0.06, 0]);
      mk(head, geo.box(0.08, 0.06, 0.06), '#E86A50', [0, 0.36, 0]);
      break;
    case 'bandana':
      mk(head, geo.sphere(0.265, 10, 6), '#c0392b', [0, 0.1, 0]).scale.set(1, 0.6, 1);
      mk(head, geo.box(0.12, 0.08, 0.03), '#111111', [0.09, 0.02, 0.24]);
      break;
  }
  return { root, body, armL, armR, legL, legR, head, tool };
}

function hammerTool() {
  const g = new THREE.Group();
  mk(g, geo.cyl(0.025, 0.025, 0.35, 5), '#8a5a36', [0, 0, 0.12], [Math.PI / 2, 0, 0]);
  mk(g, geo.box(0.16, 0.08, 0.08), '#717B7D', [0, 0, 0.3]);
  return g;
}
function spearTool() {
  const g = new THREE.Group();
  mk(g, geo.cyl(0.03, 0.03, 0.9, 5), '#6e4a2c', [0, 0, 0.2], [Math.PI / 2, 0, 0]);
  mk(g, geo.cone(0.06, 0.18, 5), '#cfd6d8', [0, 0, 0.7], [Math.PI / 2, 0, 0]);
  return g;
}
function blasterTool() {
  const g = new THREE.Group();
  mk(g, geo.box(0.1, 0.12, 0.42), '#3f4548', [0, 0.02, 0.18]);
  mk(g, geo.cyl(0.03, 0.03, 0.25, 6), '#717B7D', [0, 0.05, 0.48], [Math.PI / 2, 0, 0]);
  mk(g, geo.box(0.11, 0.04, 0.12), '#E86A50', [0, 0.1, 0.1]);
  return g;
}

const CREW_LOOKS = {
  Builder: { shirt: '#F4C75A', hat: 'hardhat', tool: 'hammer' },
  Farmer: { shirt: '#6AA850', hat: 'straw', tool: 'hammer' },
  Engineer: { shirt: '#46B8DD', hat: 'goggles', tool: 'hammer' },
  Guard: { shirt: '#E86A50', hat: 'helmet', tool: 'blaster' }
};
const SKINS = ['#f1c7a1', '#c98e62', '#8d5a3b', '#e6b58c'];
const HAIRS = ['#3b2a1e', '#d9a441', '#1d1d24', '#a0522d'];

function makeColonist(c) {
  const look = CREW_LOOKS[c.role] ?? CREW_LOOKS.Builder;
  const i = Number(String(c.id).replace(/\D/g, '')) || 0;
  const rig = person({ shirt: look.shirt, hat: look.hat, skin: SKINS[i % 4], hair: HAIRS[i % 4] });
  rig.tool.add(look.tool === 'blaster' ? blasterTool() : hammerTool());
  rig.alwaysArmed = look.tool === 'blaster';
  rig.root.scale.setScalar(0.55);
  rig.root.userData.rig = rig;
  return rig.root;
}

function makeEnemy() {
  const rig = person({ shirt: '#5b2a2a', pants: '#3a2a2a', hat: 'bandana', skin: '#c98e62', hair: '#1d1d24', raider: true });
  rig.tool.add(spearTool());
  rig.alwaysArmed = true;
  rig.root.scale.setScalar(0.55);
  rig.root.userData.rig = rig;
  return rig.root;
}

/** Pose a rig for this frame. `state` is walk | work | fight | cower | idle. */
function poseRig(r, state, t) {
  const sw = Math.sin(t * 9);
  r.body.rotation.set(0, 0, 0);
  r.body.position.set(0, 0, 0);
  r.armL.rotation.set(0, 0, 0);
  r.armR.rotation.set(0, 0, 0);
  r.legL.rotation.set(0, 0, 0);
  r.legR.rotation.set(0, 0, 0);
  r.head.rotation.set(0, 0, 0);
  r.tool.visible = r.alwaysArmed || state === 'work';
  if (state === 'walk') {
    r.legL.rotation.x = sw * 0.7;
    r.legR.rotation.x = -sw * 0.7;
    r.armL.rotation.x = -sw * 0.6;
    r.armR.rotation.x = r.alwaysArmed ? -0.5 : sw * 0.6;
    r.body.position.y = Math.abs(sw) * 0.05;
  } else if (state === 'work') {
    r.armR.rotation.x = -1.2 - Math.abs(Math.sin(t * 7)) * 1.1;
    r.armL.rotation.x = -0.5;
    r.body.rotation.x = 0.15;
  } else if (state === 'fight') {
    const k = (t * 1.4) % 1;
    r.armR.rotation.x = k < 0.25 ? -1.6 + k * 4 : -1.4;
    r.armL.rotation.x = -0.6;
    r.body.rotation.x = k < 0.25 ? 0.12 : 0.05;
  } else if (state === 'cower') {
    r.armL.rotation.x = -2.6; r.armR.rotation.x = -2.6;
    r.body.position.y = -0.05 + Math.abs(Math.sin(t * 20)) * 0.01;
  } else {
    r.body.position.y = Math.sin(t * 2) * 0.015;
    r.armL.rotation.z = 0.08; r.armR.rotation.z = -0.08;
    r.head.rotation.y = Math.sin(t * 0.7) * 0.35;
  }
}

// ---------------------------------------------------------------- buildings

function crate(g, s, pos, color = '#b98450', ry = 0) {
  const c = mk(g, geo.box(s, s, s), color, [pos[0], pos[1] + s / 2, pos[2]], [0, ry, 0]);
  mk(c, geo.box(s * 1.02, s * 0.12, s * 1.02), '#7a5230', [0, s * 0.3, 0]);
  mk(c, geo.box(s * 1.02, s * 0.12, s * 1.02), '#7a5230', [0, -s * 0.3, 0]);
}

function makeBuilding(building) {
  const outer = new THREE.Group();
  outer.position.set(building.x + 0.5, 0, building.z + 0.5);
  const g = new THREE.Group();
  g.scale.setScalar(TILE_SCALE);
  outer.add(g);
  const anim = {};
  switch (building.type) {
    case 'shelter': {
      mk(g, geo.box(1.9, 0.14, 1.9), '#cba783', [0, 0.07, 0]);
      addOutline(mk(g, geo.cyl(0.84, 0.88, 1.4, 12), '#E7D6B0', [0, 0.84, 0]), 1.05);
      mk(g, geo.cyl(0.9, 0.9, 0.12, 12), '#E86A50', [0, 0.32, 0]);
      mk(g, geo.cyl(1.02, 1.02, 0.1, 12), '#cba783', [0, 1.58, 0]);
      mk(g, geo.cone(1.02, 0.9, 12), '#E86A50', [0, 2.08, 0]);
      mk(g, geo.box(0.46, 0.85, 0.06), '#5b3a22', [0, 0.57, 0.86]);
      mk(g, geo.box(0.08, 0.08, 0.04), '#F4C75A', [0.14, 0.57, 0.9]);
      for (const a of [-0.9, 0.9]) mk(g, geo.box(0.32, 0.3, 0.04), '#9ad4f5', [Math.sin(a) * 0.85, 1.05, Math.cos(a) * 0.85], [0, a, 0], toon('#9ad4f5', { emissive: '#ffd27a', ei: 0.15 }));
      mk(g, geo.cyl(0.03, 0.04, 1.1, 5), '#5d6669', [-0.5, 2.4, -0.35]);
      anim.light = mk(g, geo.sphere(0.07, 6, 4), '#E86A50', [-0.5, 2.98, -0.35], undefined, toon('#E86A50', { emissive: '#ff2a1a', ei: 0.8 }));
      crate(g, 0.38, [0.7, 0.14, 0.62], '#b98450', 0.3);
      break;
    }
    case 'farm': {
      mk(g, geo.box(1.8, 0.35, 1.6), '#9a6a40', [0, 0.18, 0]);
      mk(g, geo.box(1.65, 0.05, 1.45), '#5a3b25', [0, 0.36, 0]);
      anim.plants = [];
      for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz += 2) {
        const p = new THREE.Group();
        p.position.set(ix * 0.5, 0.38, iz * 0.35);
        mk(p, geo.cone(0.16, 0.5, 6), '#6AA850', [0, 0.25, 0]);
        mk(p, geo.sphere(0.15, 6, 5), '#7cc35c', [0.08, 0.35, 0.05]);
        for (const tx of [-0.12, 0.13]) mk(p, geo.sphere(0.08, 6, 5), '#e8452f', [tx, 0.3, 0.12]);
        g.add(p);
        anim.plants.push(p);
      }
      for (const x of [-0.92, 0.92]) for (const z of [-0.82, 0.82]) mk(g, geo.box(0.08, 0.6, 0.08), '#8a5a36', [x, 0.3, z]);
      mk(g, geo.box(0.6, 0.28, 0.06), '#E7D6B0', [0.55, 0.52, 0.84]);
      break;
    }
    case 'solar': {
      mk(g, geo.box(1.7, 0.16, 1.7), '#5d6669', [0, 0.08, 0]);
      mk(g, geo.cyl(0.08, 0.1, 0.9, 6), '#b4bec2', [0, 0.6, 0]);
      const panel = new THREE.Group();
      panel.position.set(0, 1.08, 0);
      mk(panel, geo.box(1.9, 0.08, 1.4), '#2f5f8f', [0, 0, 0]);
      for (let i = -1; i <= 1; i++) mk(panel, geo.box(0.03, 0.02, 1.38), '#9ad4f5', [i * 0.48, 0.05, 0]);
      mk(panel, geo.box(1.88, 0.02, 0.03), '#9ad4f5', [0, 0.05, 0]);
      mk(panel, geo.box(1.96, 0.06, 0.06), '#cfd6d8', [0, 0, 0.72]);
      panel.rotation.x = -0.4;
      g.add(panel);
      anim.panel = panel;
      mk(g, geo.box(0.45, 0.35, 0.3), '#3f4548', [0.55, 0.33, 0.6]);
      anim.light = mk(g, geo.sphere(0.05, 6, 4), '#7dff7a', [0.55, 0.54, 0.76], undefined, toon('#7dff7a', { emissive: '#3aff3a', ei: 0.8 }));
      break;
    }
    case 'wall': {
      addOutline(mk(g, geo.box(1.9, 0.95, 0.9), '#b48b72', [0, 0.48, 0]), 1.03);
      mk(g, geo.box(1.96, 0.14, 0.96), '#cba783', [0, 1.0, 0]);
      for (const x of [-0.7, 0, 0.7]) mk(g, geo.box(0.42, 0.28, 0.9), '#cba783', [x, 1.2, 0]);
      for (const x of [-0.55, 0.55]) mk(g, geo.box(0.6, 0.4, 0.05), '#717B7D', [x, 0.5, 0.47], [0, 0, x * 0.1]);
      for (const x of [-0.75, -0.35, 0.35, 0.75]) mk(g, geo.sphere(0.04, 5, 4), '#3f4548', [x, 0.62, 0.5]);
      mk(g, geo.box(1.92, 0.1, 0.92), '#E86A50', [0, 0.18, 0]);
      break;
    }
    case 'turret': {
      mk(g, geo.box(1.6, 0.14, 1.6), '#5d6669', [0, 0.07, 0]);
      addOutline(mk(g, geo.cyl(0.5, 0.6, 0.5, 10), '#717B7D', [0, 0.38, 0]), 1.05);
      const turret = new THREE.Group();
      turret.position.set(0, 0.75, 0);
      mk(turret, geo.box(0.6, 0.38, 0.7), '#E7D6B0', [0, 0.05, 0]);
      mk(turret, geo.box(0.62, 0.08, 0.72), '#E86A50', [0, 0.18, 0]);
      for (const x of [-0.12, 0.12]) mk(turret, geo.cyl(0.06, 0.07, 1.0, 7), '#3f4548', [x, 0.08, 0.7], [Math.PI / 2, 0, 0]);
      mk(turret, geo.box(0.3, 0.12, 0.06), '#46B8DD', [0, 0.12, 0.36], undefined, toon('#46B8DD', { emissive: '#46B8DD', ei: 0.5 }));
      g.add(turret);
      anim.turret = turret;
      break;
    }
    case 'beacon': {
      mk(g, geo.cyl(0.85, 0.95, 0.25, 10), '#5d6669', [0, 0.12, 0]);
      for (const a of [0, 2.1, 4.2]) mk(g, geo.cyl(0.05, 0.05, 2.4, 5), '#b4bec2', [Math.cos(a) * 0.5, 1.15, Math.sin(a) * 0.5], [Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22]);
      addOutline(mk(g, geo.cyl(0.12, 0.16, 3.2, 6), '#E7D6B0', [0, 1.7, 0]), 1.1);
      mk(g, geo.cyl(0.42, 0.28, 0.35, 8), '#E86A50', [0, 3.35, 0]);
      const ring = new THREE.Group();
      ring.position.set(0, 2.3, 0);
      mk(ring, geo.torus(0.55, 0.04), '#46B8DD', [0, 0, 0], [Math.PI / 2, 0, 0], toon('#46B8DD', { emissive: '#46B8DD', ei: 0.6 }));
      mk(ring, geo.cyl(0.3, 0.05, 0.15, 10), '#cfd6d8', [0.55, 0.1, 0], [0, 0, -0.8]);
      g.add(ring);
      anim.ring = ring;
      anim.light = mk(g, geo.cone(0.3, 0.6, 7), '#ffb347', [0, 3.8, 0], undefined, toon('#ffb347', { emissive: '#ff7a00', ei: 1 }));
      break;
    }
  }
  outer.userData.anim = anim;
  outer.userData.type = building.type;
  return outer;
}

// ---------------------------------------------------------------- resource nodes

function makeNode(n) {
  const outer = new THREE.Group();
  outer.position.set(n.x + 0.5, 0, n.z + 0.5);
  outer.userData.marked = n.marked;
  const g = new THREE.Group();
  g.scale.setScalar(TILE_SCALE);
  g.rotation.y = ((n.x * 7 + n.z * 13) % 6) * 0.5;
  outer.add(g);
  const anim = {};
  if (n.type === 'rock') {
    const main = mk(g, geo.dodec(0.6), '#b48b72', [0, 0.38, 0]);
    main.scale.set(1, 0.8, 1);
    addOutline(main, 1.06);
    mk(g, geo.dodec(0.36), '#9a6a52', [0.55, 0.22, -0.35]);
    mk(g, geo.dodec(0.24), '#cba783', [-0.5, 0.15, 0.42]);
    for (const [x, y, z] of [[0.15, 0.82, 0.2], [-0.3, 0.66, -0.2], [0.55, 0.48, -0.2]]) {
      mk(g, geo.ico(0.12, 0), '#c4c0ac', [x, y, z], [x, y, z], toon('#d9e0e2', { emissive: '#7fd0d8', ei: 0.25 }));
    }
  } else {
    mk(g, geo.cyl(0.14, 0.2, 1.0, 6), '#7a5230', [0, 0.5, 0]);
    const crown = new THREE.Group();
    crown.position.set(0, 1.0, 0);
    addOutline(mk(crown, geo.ico(0.72, 0), '#4f8f45', [0, 0.38, 0]), 1.06);
    mk(crown, geo.ico(0.5, 0), '#5fa850', [0.12, 0.92, 0.05]);
    mk(crown, geo.ico(0.28, 0), '#7cc35c', [-0.05, 1.3, 0]);
    g.add(crown);
    anim.crown = crown;
  }
  if (n.marked) {
    anim.marker = mk(g, geo.torus(0.9, 0.05), '#51c9bc', [0, 0.06, 0], [Math.PI / 2, 0, 0], toon('#51c9bc', { emissive: '#51c9bc', ei: 0.7 }));
    anim.marker.castShadow = false;
  }
  outer.userData.anim = anim;
  outer.userData.phase = n.x * 0.7 + n.z * 1.3;
  return outer;
}

// ---------------------------------------------------------------- scene

const easeOutBack = (k) => 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class GameScene {
  constructor(container, game) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x72c5dc);
    this.scene.fog = new THREE.Fog(0x72c5dc, 48, 100);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8c5a46, 1.4);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff3dc, 2.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0015;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    this.camera = new THREE.OrthographicCamera(-12, 12, 8, -8, .1, 100);
    this.target = new THREE.Vector3(14, 0, 14);
    this.zoom = 1;
    this.camera.position.set(32, 27, 32);
    this.camera.lookAt(this.target);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.entities = new Map();
    this.nodes = new Map();
    this.units = new Map();
    this.raiders = new Map();
    this.selection = new THREE.Mesh(new THREE.BoxGeometry(1.02, .035, 1.02), new THREE.MeshBasicMaterial({ color: 0x8ff0df, transparent: true, opacity: .35, depthWrite: false }));
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const rainPositions = new Float32Array(100 * 6);
    const random = (i) => ((Math.sin(i * 91.37) * 43758.5453) % 1 + 1) % 1;
    for (let i = 0; i < 100; i++) {
      const x = (random(i + 2) - .5) * 31, z = (random(i + 201) - .5) * 31;
      const y = random(i + 442) * 8 + 1;
      rainPositions.set([x, y, z, x - .08, y - .55, z + .05], i * 6);
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xd4efff, transparent: true, opacity: .7 }));
    this.rain.visible = false;
    this.scene.add(this.rain);
    this.bolts = [];
    const boltMat = toon('#ffe066', { emissive: '#ffcc00', ei: 1.2 });
    for (let i = 0; i < 24; i++) {
      const b = new THREE.Mesh(geo.sphere(0.07, 6, 4), boltMat);
      b.visible = false;
      this.scene.add(b);
      this.bolts.push(b);
    }
    this.last = performance.now();
    this.time = 0;
    this.ready = false;
    this.makeGround(game);
    this.sync(game);
    this.ready = true;
    this.resize();
  }
  makeGround(game) {
    const mesh = new THREE.InstancedMesh(geo.box(1, 1, 1), toon('#ffffff'), SIZE * SIZE);
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    game.tiles.forEach((t, i) => {
      dummy.position.set(t.x + .5, -.16, t.z + .5);
      dummy.scale.set(1.005, .32 + (t.type === 'ridge' ? .08 : 0), 1.005);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const value = t.type === 'plain' ? palette.ground[Math.min(4, Math.floor(t.shade * 5))] : palette[t.type];
      mesh.setColorAt(i, new THREE.Color(value));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    this.world.add(mesh);
    const base = new THREE.Mesh(new THREE.BoxGeometry(SIZE + .5, .65, SIZE + .5), toon('#8e4a3c'));
    base.position.set(SIZE / 2, -.65, SIZE / 2);
    this.world.add(base);
    // scattered boulders along the ridge for a less flat border
    const ridge = game.tiles.filter(t => t.type === 'ridge' && t.shade > .55);
    const rocks = new THREE.InstancedMesh(geo.dodec(0.3), toon('#b85f43'), ridge.length);
    rocks.castShadow = true;
    ridge.forEach((t, i) => {
      dummy.position.set(t.x + .3 + t.shade * .4, .12, t.z + .7 - t.shade * .4);
      dummy.rotation.set(t.shade * 4, t.shade * 9, 0);
      dummy.scale.set(.6 + t.shade * .8, .45 + t.shade * .5, .6 + t.shade * .7);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    });
    rocks.instanceMatrix.needsUpdate = true;
    this.world.add(rocks);
  }
  sync(game) {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, .1);
    this.last = now;
    this.time += dt;
    const t = this.time;
    if (this.lastWeather !== game.weather) {
      this.lastWeather = game.weather;
      const rain = game.weather === 'Heavy rain';
      const storm = game.weather === 'Dust storm';
      const sky = rain ? 0x285471 : storm ? 0xc27b5f : game.weather === 'Heat wave' ? 0xe8b073 : 0x72c5dc;
      this.scene.background.setHex(sky);
      this.scene.fog.color.setHex(sky);
      this.sun.intensity = rain ? 1.0 : storm ? 1.3 : 2.0;
      this.hemi.intensity = rain ? 1.1 : 1.4;
      this.rain.visible = rain;
    }
    if (this.rain.visible) {
      this.rain.position.set(this.target.x, 0, this.target.z);
      const positions = this.rain.geometry.attributes.position;
      for (let i = 0; i < positions.count; i += 2) {
        let y = positions.getY(i) - .13;
        if (y < .4) y += 8;
        positions.setY(i, y); positions.setY(i + 1, y - .55);
      }
      positions.needsUpdate = true;
    }
    const updateMap = (items, map, maker) => {
      const ids = new Set(items.map(i => i.id));
      for (const [id, obj] of map) if (!ids.has(id)) { this.world.remove(obj); map.delete(id); }
      for (const item of items) if (!map.has(item.id)) {
        const obj = maker(item);
        obj.userData.born = this.ready ? t : -10;
        obj.userData.baseScale = obj.scale.x;
        this.world.add(obj);
        map.set(item.id, obj);
      }
    };
    updateMap(game.buildings, this.entities, makeBuilding);
    updateMap(game.nodes, this.nodes, makeNode);
    updateMap(game.colonists, this.units, makeColonist);
    updateMap(game.enemies, this.raiders, makeEnemy);
    for (const n of game.nodes) {
      const obj = this.nodes.get(n.id);
      if (obj.userData.marked !== n.marked) {
        this.world.remove(obj); this.nodes.delete(n.id);
        const next = makeNode(n);
        next.userData.born = -10;
        this.world.add(next); this.nodes.set(n.id, next);
      }
    }
    for (const c of game.colonists) {
      const state = c.task === 'Defending' ? 'fight' : c.task === 'Mining ore' || c.task === 'Gathering timber' ? 'work' : c.task === 'Taking cover' ? 'cower' : 'idle';
      this.animateUnit(this.units.get(c.id), c, state, dt, game);
    }
    for (const e of game.enemies) this.animateUnit(this.raiders.get(e.id), e, 'fight', dt, game);
    this.animateBuildings(game, t);
    this.animateNodes(t);
    this.animateBolts(game);
    this.popIn(this.entities, t);
    this.popIn(this.nodes, t);
  }
  /** Walk when moving, otherwise play the task pose; face the direction of travel. */
  animateUnit(obj, unit, state, dt, game) {
    const ud = obj.userData;
    const rig = ud.rig;
    const px = ud.px ?? unit.x, pz = ud.pz ?? unit.z;
    const dx = unit.x - px, dz = unit.z - pz;
    const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    ud.px = unit.x; ud.pz = unit.z;
    ud.moving = speed > .12 ? .25 : Math.max(0, (ud.moving ?? 0) - dt);
    let face = ud.face ?? 0;
    if (speed > .12) face = Math.atan2(dx, dz);
    else if (state === 'fight') {
      const foes = unit.role ? game.enemies : game.colonists;
      let best = null, bd = 6;
      for (const f of foes) { const d = Math.hypot(f.x - unit.x, f.z - unit.z); if (d < bd) { bd = d; best = f; } }
      if (best) face = Math.atan2(best.x - unit.x, best.z - unit.z);
      else if (unit.role) state = 'idle'; // raiders keep swinging at the building they walked into
    }
    ud.face = face;
    ud.heading = lerpAngle(ud.heading ?? face, face, Math.min(1, dt * 10));
    obj.rotation.y = ud.heading;
    obj.position.set(unit.x, .02, unit.z);
    ud.anim = (ud.anim ?? Math.random() * 5) + dt;
    poseRig(rig, ud.moving > 0 ? 'walk' : state, ud.anim);
  }
  animateBuildings(game, t) {
    for (const b of game.buildings) {
      const obj = this.entities.get(b.id);
      const a = obj?.userData.anim;
      if (!a) continue;
      if (a.turret) {
        const cx = b.x + .5, cz = b.z + .5;
        let best = null, bd = 7;
        for (const e of game.enemies) { const d = Math.hypot(e.x - cx, e.z - cz); if (d < bd) { bd = d; best = e; } }
        const aim = best ? Math.atan2(best.x - cx, best.z - cz) : Math.sin(t * .4 + b.x) * 1.2;
        a.turret.rotation.y = lerpAngle(a.turret.rotation.y, aim, best ? .2 : .03);
      }
      if (a.plants) a.plants.forEach((p, i) => { p.rotation.z = Math.sin(t * 1.8 + i) * .06; });
      if (a.panel) a.panel.rotation.z = Math.sin(t * .2 + b.z) * .12;
      if (a.ring) a.ring.rotation.y = t * 1.5;
      if (a.light) a.light.scale.setScalar(1 + Math.sin(t * 4 + b.x) * .15);
    }
  }
  animateNodes(t) {
    for (const obj of this.nodes.values()) {
      const a = obj.userData.anim;
      if (a.crown) a.crown.rotation.z = Math.sin(t * 1.3 + obj.userData.phase) * .04;
      if (a.marker) {
        a.marker.scale.setScalar(1 + Math.sin(t * 4) * .06);
        a.marker.rotation.z = t;
      }
    }
  }
  animateBolts(game) {
    let i = 0;
    for (const p of game.projectiles) {
      if (i >= this.bolts.length) break;
      const b = this.bolts[i++];
      const k = 1 - Math.max(0, p.ttl) / .18;
      b.visible = true;
      b.position.set(p.x + (p.tx - p.x) * k, .45 + Math.sin(k * Math.PI) * .2, p.z + (p.tz - p.z) * k);
    }
    for (; i < this.bolts.length; i++) this.bolts[i].visible = false;
  }
  popIn(map, t) {
    for (const obj of map.values()) {
      const k = (t - obj.userData.born) / .35;
      if (k >= 1) { if (obj.userData.popping) { obj.scale.setScalar(1); obj.userData.popping = false; } continue; }
      obj.userData.popping = true;
      obj.scale.setScalar(Math.max(.01, easeOutBack(Math.max(0, k))));
    }
  }
  tileFromClient(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height * 2 - 1));
    this.raycaster.setFromCamera(pointer, this.camera);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) return null;
    const x = Math.floor(point.x), z = Math.floor(point.z);
    return x >= 0 && z >= 0 && x < SIZE && z < SIZE ? { x, z } : null;
  }
  select(tile, valid = true) {
    this.selection.visible = !!tile;
    if (tile) {
      this.selection.position.set(tile.x + .5, .018, tile.z + .5);
      this.selection.material.color.set(valid ? 0x8ff0df : 0xff8e80);
    }
  }
  pan(dx, dy) {
    const scale = 18 / Math.min(this.container.clientWidth, this.container.clientHeight) / this.zoom;
    this.target.x = THREE.MathUtils.clamp(this.target.x + (-dx + dy) * scale, 3, SIZE - 3);
    this.target.z = THREE.MathUtils.clamp(this.target.z + (dx + dy) * scale, 3, SIZE - 3);
    this.updateCamera();
  }
  setZoom(value) { this.zoom = THREE.MathUtils.clamp(value, .65, 3); this.resize(); }
  updateCamera() {
    this.camera.position.copy(this.target).add(new THREE.Vector3(20, 24, 20));
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    // keep the shadow frustum centred on what the player is looking at
    this.sun.position.copy(this.target).add(new THREE.Vector3(-12, 26, 10));
    this.sun.target.position.copy(this.target);
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const span = 13 / this.zoom;
    this.camera.left = -span * aspect;
    this.camera.right = span * aspect;
    this.camera.top = span;
    this.camera.bottom = -span;
    this.updateCamera();
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
