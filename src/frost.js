import * as THREE from 'three';
import * as D from './frost-data.js';

const { CELL, DAY_LEN, NIGHT_LEN, WORLD_R, RES, RES_INFO, BUILDINGS, BUILD_ORDER, TECH, ENEMIES, NODES } = D;
const CYCLE = DAY_LEN + NIGHT_LEN;
const SAVE_KEY = 'frostfall-save-v1', BEST_KEY = 'frostfall-best-v1', SOUND_KEY = 'frostfall-sound-v1';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const fmt = (n) => (n >= 10000 ? `${Math.floor(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.floor(n)));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};
function rngFor(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- cel shading: three-band toon ramp + inverted-hull outlines (same look as the other Red Haven games)
const gradient = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
gradient.minFilter = THREE.NearestFilter;
gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

const toonCache = new Map();
function toon(color, o = {}) {
  const k = `${color}|${o.emissive ?? ''}|${o.ei ?? ''}`;
  let m = toonCache.get(k);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: gradient });
    if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 0.5; }
    toonCache.set(k, m);
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
const G = (k, make) => { let g = geoCache.get(k); if (!g) { g = make(); geoCache.set(k, g); } return g; };
const geo = {
  box: (w, h, d) => G(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (a, b, h, s = 8) => G(`c${a},${b},${h},${s}`, () => new THREE.CylinderGeometry(a, b, h, s)),
  cone: (r, h, s = 6) => G(`n${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s)),
  ico: (r, d = 0) => G(`i${r},${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  sphere: (r, w = 14, h = 10) => G(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)),
  dome: (r) => G(`d${r}`, () => new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
  torus: (r, t) => G(`t${r},${t}`, () => new THREE.TorusGeometry(r, t, 6, 18)),
  plane: (w, h) => G(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h)),
};
function mk(parent, g, color, pos = [0, 0, 0], o = {}) {
  const m = new THREE.Mesh(g, toon(color, o));
  m.position.set(pos[0], pos[1], pos[2]);
  if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
  if (o.scale) m.scale.set(o.scale[0], o.scale[1], o.scale[2]);
  m.castShadow = o.shadow !== false;
  m.receiveShadow = !!o.receive;
  if (o.outline !== false) addOutline(m, o.outline || 1.08);
  parent.add(m);
  return m;
}
const basicCache = new Map();
function basic(color, op = 1) {
  const k = `${color}|${op}`;
  let m = basicCache.get(k);
  if (!m) { m = new THREE.MeshBasicMaterial({ color, transparent: op < 1, opacity: op, depthWrite: op >= 1 }); basicCache.set(k, m); }
  return m;
}
const backOut = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// ================================================================ models
const C = { steel: '#9aa9c4', dark: '#5b6680', deep: '#46506a', orange: '#ff8a3d', red: '#ff5f57', yellow: '#ffd23f', white: '#f6f2ff', teal: '#2ec4b6', cyan: '#7fe3ff', purple: '#8c5bd6' };
const HEIGHT = { core: 6.6, hab: 3.4, pump: 3.0, drill: 4.1, still: 3.8, workshop: 3.4, turret: 2.8, tesla: 5.0, wall: 3.0 };

function pad(g, w = 3.2) { mk(g, geo.box(w, 0.35, w), C.dark, [0, 0.17, 0], { receive: true }); }
const MODELS = {
  core(g, p) {
    mk(g, geo.cyl(3.1, 3.4, 0.7, 8), C.deep, [0, 0.35, 0], { receive: true });
    mk(g, geo.cyl(2.3, 2.7, 1.4, 8), C.steel, [0, 1.4, 0]);
    p.glow = mk(g, geo.cyl(1.15, 1.15, 2.2, 8), '#ffa94d', [0, 3.2, 0], { emissive: '#ff6a1a', ei: 0.9 });
    p.ring = mk(g, geo.torus(1.75, 0.2), C.yellow, [0, 3.2, 0], { rot: [Math.PI / 2, 0, 0] });
    mk(g, geo.cyl(1.7, 1.45, 0.55, 8), C.dark, [0, 4.55, 0]);
    mk(g, geo.cone(1.25, 1.1, 8), C.red, [0, 5.35, 0]);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4, x = Math.cos(a) * 2.55, z = Math.sin(a) * 2.55;
      mk(g, geo.cyl(0.32, 0.32, 2.6, 6), C.orange, [x, 1.3, z]);
      mk(g, geo.cyl(0.45, 0.45, 0.3, 6), C.dark, [x, 2.7, z]);
    }
  },
  hab(g, p) {
    pad(g);
    mk(g, geo.cyl(1.55, 1.6, 0.5, 10), C.steel, [0, 0.6, 0]);
    mk(g, geo.dome(1.45), C.white, [0, 0.85, 0]);
    mk(g, geo.cyl(1.47, 1.47, 0.22, 10), C.cyan, [0, 1.12, 0], { emissive: '#3ad0ff', ei: 0.5, outline: false });
    mk(g, geo.box(0.8, 0.95, 0.5), C.orange, [0, 0.9, 1.35]);
    mk(g, geo.cyl(0.05, 0.05, 1, 4), C.dark, [0.6, 2.5, 0], { outline: false });
    p.blink = mk(g, geo.sphere(0.13, 8, 6), C.red, [0.6, 3.0, 0], { emissive: '#ff2a2a', ei: 0.8 });
  },
  pump(g, p) {
    pad(g);
    mk(g, geo.cyl(0.95, 0.95, 1.9, 8), C.cyan, [-0.5, 1.3, -0.3]);
    mk(g, geo.cyl(1.0, 1.0, 0.25, 8), C.white, [-0.5, 2.35, -0.3]);
    p.piston = mk(g, geo.cyl(0.22, 0.22, 1.6, 6), C.steel, [0.9, 1.2, 0.7]);
    mk(g, geo.box(0.9, 0.5, 0.9), C.yellow, [0.9, 0.6, 0.7]);
    mk(g, geo.box(1.2, 0.22, 0.22), C.steel, [0.25, 1.6, 0.25], { rot: [0, Math.PI / 4, 0] });
  },
  drill(g, p) {
    pad(g);
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3;
      mk(g, geo.box(0.22, 3.0, 0.22), C.yellow, [Math.cos(a) * 0.85, 1.7, Math.sin(a) * 0.85], { rot: [-Math.sin(a) * 0.32, 0, Math.cos(a) * 0.32] });
    }
    mk(g, geo.box(1.0, 0.7, 1.0), C.orange, [0, 3.2, 0]);
    p.bit = mk(g, geo.cone(0.45, 1.6, 6), C.steel, [0, 1.15, 0], { rot: [Math.PI, 0, 0] });
  },
  still(g, p) {
    pad(g);
    mk(g, geo.box(1.7, 1.5, 1.5), C.purple, [-0.3, 1.1, 0.1]);
    mk(g, geo.box(1.9, 0.25, 1.7), C.dark, [-0.3, 1.95, 0.1]);
    mk(g, geo.cyl(0.35, 0.42, 2.4, 6), C.steel, [0.95, 1.55, -0.7]);
    mk(g, geo.cyl(0.48, 0.48, 0.25, 6), C.dark, [0.95, 2.8, -0.7]);
    p.flame = mk(g, geo.cone(0.25, 0.6, 5), '#ffb347', [0.95, 3.15, -0.7], { emissive: '#ff6a1a', ei: 1, outline: false });
    mk(g, geo.cyl(0.32, 0.32, 0.7, 8), C.orange, [0.85, 0.75, 0.85], { rot: [Math.PI / 2, 0, 0] });
    p.smokeAt = new THREE.Vector3(0.95, 3.4, -0.7);
  },
  workshop(g, p) {
    pad(g);
    mk(g, geo.box(2.4, 1.4, 2.0), '#ffb35c', [0, 1.05, 0]);
    mk(g, geo.cone(1.95, 1.1, 4), C.red, [0, 2.3, 0], { rot: [0, Math.PI / 4, 0] });
    mk(g, geo.box(0.9, 0.9, 0.12), C.dark, [-0.4, 0.8, 1.02]);
    p.gear = mk(g, geo.cyl(0.5, 0.5, 0.22, 8), C.yellow, [0.75, 1.3, 1.1], { rot: [Math.PI / 2, 0, 0] });
  },
  turret(g, p) {
    pad(g, 2.8);
    mk(g, geo.cyl(1.0, 1.25, 0.7, 8), C.steel, [0, 0.7, 0]);
    const head = new THREE.Group();
    head.position.y = 1.55;
    g.add(head);
    p.head = head;
    mk(head, geo.box(1.25, 0.8, 1.25), C.orange, [0, 0, 0]);
    p.barrels = [
      mk(head, geo.cyl(0.18, 0.18, 1.5, 6), C.dark, [0.28, 0.05, 0.95], { rot: [Math.PI / 2, 0, 0] }),
      mk(head, geo.cyl(0.18, 0.18, 1.5, 6), C.dark, [-0.28, 0.05, 0.95], { rot: [Math.PI / 2, 0, 0] }),
    ];
    mk(head, geo.box(0.5, 0.3, 0.5), C.yellow, [0, 0.55, -0.2]);
  },
  tesla(g, p) {
    pad(g, 2.8);
    mk(g, geo.cyl(0.9, 1.15, 0.5, 8), C.dark, [0, 0.55, 0]);
    mk(g, geo.cyl(0.32, 0.7, 2.8, 6), C.steel, [0, 2.2, 0]);
    mk(g, geo.torus(0.65, 0.14), '#d98a4e', [0, 1.6, 0], { rot: [Math.PI / 2, 0, 0] });
    mk(g, geo.torus(0.5, 0.12), '#d98a4e', [0, 2.6, 0], { rot: [Math.PI / 2, 0, 0] });
    p.orb = mk(g, geo.ico(0.55, 1), C.cyan, [0, 3.9, 0], { emissive: '#3ad0ff', ei: 0.8 });
  },
  wall(g) {
    mk(g, geo.box(3.5, 1.7, 3.5), '#cfeeff', [0, 0.85, 0], { receive: true });
    mk(g, geo.box(3.0, 0.4, 3.0), '#eaf8ff', [0, 1.9, 0]);
    mk(g, geo.box(0.9, 0.5, 0.9), '#a9dcf5', [-1.0, 2.3, 0.8]);
    mk(g, geo.box(0.7, 0.4, 0.7), '#a9dcf5', [0.9, 2.25, -0.7]);
  },
};

function makePlayer() {
  const g = new THREE.Group(), p = {};
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(0.2 * s, 0.62, 0);
    mk(leg, geo.box(0.26, 0.6, 0.3), C.white, [0, -0.3, 0]);
    g.add(leg);
    p[s < 0 ? 'legL' : 'legR'] = leg;
  }
  mk(g, geo.cyl(0.42, 0.46, 0.85, 8), C.orange, [0, 1.05, 0]);
  mk(g, geo.box(0.62, 0.7, 0.32), C.steel, [0, 1.1, -0.42]);
  mk(g, geo.box(0.2, 0.3, 0.1), C.yellow, [0, 1.25, -0.6], { outline: false });
  mk(g, geo.sphere(0.46, 12, 10), C.white, [0, 1.85, 0]);
  mk(g, geo.sphere(0.3, 10, 8), C.teal, [0, 1.88, 0.24], { emissive: '#2ec4b6', ei: 0.35, scale: [1.15, 0.8, 0.7] });
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(0.53 * s, 1.38, 0);
    mk(arm, geo.box(0.22, 0.65, 0.24), C.orange, [0, -0.3, 0]);
    g.add(arm);
    p[s < 0 ? 'armL' : 'armR'] = arm;
  }
  const tool = new THREE.Group();
  tool.position.set(0, -0.6, 0.05);
  mk(tool, geo.box(0.08, 0.08, 0.9), '#8a5a3a', [0, 0, 0.35]);
  mk(tool, geo.box(0.6, 0.12, 0.12), C.steel, [0, 0, 0.78]);
  p.armR.add(tool);
  p.tool = tool;
  return { g, p };
}

function makeHelper() {
  const g = new THREE.Group(), p = {};
  mk(g, geo.box(0.75, 0.28, 0.6), C.deep, [0, 0.18, 0]);
  p.body = mk(g, geo.sphere(0.45, 12, 9), C.yellow, [0, 0.72, 0]);
  mk(g, geo.sphere(0.15, 8, 6), '#1d2433', [0, 0.8, 0.38], { emissive: '#3ad0ff', ei: 0.9, outline: false });
  mk(g, geo.cyl(0.04, 0.04, 0.45, 4), C.dark, [0, 1.3, 0], { outline: false });
  mk(g, geo.sphere(0.09, 6, 5), C.red, [0, 1.55, 0], { emissive: '#ff2a2a', ei: 0.6, outline: false });
  p.cargo = mk(g, geo.box(0.42, 0.42, 0.42), C.cyan, [0, 1.0, -0.42]);
  p.cargo.visible = false;
  return { g, p };
}

function makeEnemy(type) {
  const d = ENEMIES[type], g = new THREE.Group(), p = { legs: [] };
  const body = new THREE.Group();
  g.add(body);
  p.body = body;
  mk(body, geo.ico(0.75, 0), d.color, [0, 0.6, 0], { scale: [1, 0.62, 1.2] });
  for (let k = 0; k < 3; k++) mk(body, geo.cone(0.18, 0.55, 4), d.spike, [0, 0.98, -0.4 + k * 0.38], { rot: [-0.35, 0, 0] });
  for (const s of [-1, 1]) mk(body, geo.sphere(0.11, 6, 5), '#ff3b3b', [0.25 * s, 0.74, 0.78], { emissive: '#ff2020', ei: 1, outline: false });
  if (type === 'brute') for (const s of [-1, 1]) mk(body, geo.cone(0.14, 0.6, 4), '#fff1d6', [0.42 * s, 0.95, 0.65], { rot: [1.0, 0, -0.5 * s] });
  for (let k = 0; k < 4; k++) {
    const leg = mk(g, geo.box(0.5, 0.12, 0.14), '#4b5a7a', [k % 2 ? 0.62 : -0.62, 0.25, k < 2 ? 0.38 : -0.38], { outline: false });
    p.legs.push(leg);
  }
  g.scale.setScalar(d.r / 0.75);
  return { g, p };
}

function makeNode(type, rng) {
  const g = new THREE.Group();
  if (type === 'ice') {
    for (let k = 0; k < 3; k++) {
      const h = 1.1 + rng() * 1.3, a = k * 2.1 + rng(), r = k ? 0.5 : 0;
      mk(g, geo.cone(0.42, 1, 5), k ? '#bdf0ff' : '#8fe4ff', [Math.cos(a) * r, h / 2, Math.sin(a) * r], { scale: [1, h, 1], rot: [(rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5], emissive: '#5fd8ff', ei: 0.15 });
    }
  } else if (type === 'metal') {
    mk(g, geo.ico(0.9, 0), '#9a7b6b', [0, 0.55, 0], { scale: [1.2, 0.8, 1] });
    mk(g, geo.ico(0.3, 0), '#ffc14d', [0.45, 0.95, 0.3], { emissive: '#ff9a1a', ei: 0.3 });
    mk(g, geo.ico(0.25, 0), '#ffc14d', [-0.5, 0.75, -0.2], { emissive: '#ff9a1a', ei: 0.3 });
  } else {
    mk(g, geo.ico(0.85, 0), '#3f3652', [0, 0.55, 0], { scale: [1.1, 0.85, 1.1] });
    mk(g, geo.ico(0.32, 0), '#ff8a3d', [0.4, 1.0, 0.2], { emissive: '#ff5a1a', ei: 0.8 });
    mk(g, geo.ico(0.26, 0), '#ff8a3d', [-0.45, 0.7, 0.35], { emissive: '#ff5a1a', ei: 0.8 });
  }
  return g;
}

// ================================================================ audio (synthesised)
class Sfx {
  constructor() { this.ctx = null; this.on = true; this.last = {}; }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.3;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  gate(k, gap) { const n = performance.now(); if (n - (this.last[k] || 0) < gap * 1000) return false; this.last[k] = n; return true; }
  tone(f0, f1, dur, type = 'sine', vol = 0.25, delay = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol = 0.3, cutoff = 900) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(f).connect(g).connect(this.master); s.start();
  }
  gather(type) {
    if (type === 'ice') { this.tone(1300, 1700, 0.08, 'triangle', 0.14); this.tone(2100, 2000, 0.1, 'sine', 0.06, 0.03); }
    else if (type === 'metal') { this.tone(320, 260, 0.08, 'square', 0.1); this.noise(0.06, 0.12, 2500); }
    else { this.noise(0.12, 0.16, 700); this.tone(220, 160, 0.1, 'triangle', 0.12); }
  }
  shoot(turret) { if (this.gate(turret ? 'st' : 'sp', 0.06)) this.tone(turret ? 620 : 1100, turret ? 180 : 380, 0.1, 'square', turret ? 0.05 : 0.06); }
  zap() { if (!this.gate('z', 0.1)) return; this.noise(0.2, 0.14, 3200); this.tone(1500, 300, 0.2, 'sawtooth', 0.07); }
  hit() { if (this.gate('h', 0.08)) this.tone(160, 90, 0.1, 'square', 0.1); }
  splat() { if (!this.gate('sp2', 0.05)) return; this.noise(0.18, 0.22, 900); this.tone(420, 120, 0.15, 'triangle', 0.14); }
  build() { this.noise(0.15, 0.2, 500); [392, 523, 659].forEach((f, i) => this.tone(f, f, 0.12, 'triangle', 0.22, i * 0.07)); }
  upgrade() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.14, 'triangle', 0.22, i * 0.08)); }
  coin() { this.tone(988, 988, 0.08, 'square', 0.1); this.tone(1319, 1319, 0.2, 'square', 0.1, 0.08); }
  alarm() { [0, 0.35].forEach((d) => this.tone(660, 440, 0.3, 'sawtooth', 0.09, d)); }
  dawn() { [392, 494, 587, 784].forEach((f, i) => this.tone(f, f, 0.32, 'sine', 0.2, i * 0.12)); }
  hurt() { if (this.gate('hu', 0.2)) this.tone(220, 110, 0.18, 'sawtooth', 0.14); }
  click() { this.tone(520, 700, 0.06, 'square', 0.1); }
  wind() { this.noise(1.8, 0.25, 500); }
  boom() { this.noise(0.6, 0.45, 700); this.tone(120, 40, 0.5, 'sine', 0.35); }
  error() { this.tone(200, 150, 0.15, 'square', 0.1); }
}

const TUTORIAL = [
  { text: 'Walk next to ice, ore or carbon rocks to gather', done: (g) => g.gathered >= 15 },
  { text: 'Tap 🔨 Build and place a Blaster Turret', done: (g) => g.count('turret') > 0 },
  { text: 'Build an Ice Pump or a Metal Drill', done: (g) => g.count('pump') + g.count('drill') > 0 },
  { text: 'Tap 🤖 and recruit a helper bot', done: (g) => g.helpers.length >= 2 },
  { text: 'Tap the Heat Core and upgrade it to level 2', done: (g) => g.core.lvl >= 2 },
];

// ================================================================ the game
class Frostfall {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.sfx = new Sfx();
    this.sfx.on = store.get(SOUND_KEY) ?? true;
    this.state = 'menu';
    this.t = 0;
    this.zoom = 1; this.zoomTarget = 1;
    this.keys = new Set(); this.pointers = new Map(); this.joy = null; this.joyVec = { x: 0, y: 0 }; this.pinch = null;
    this.buildings = []; this.cells = new Map(); this.nodes = []; this.helpers = []; this.enemies = []; this.spawnQueue = [];
    this.bolts = []; this.boltPool = []; this.parts = []; this.partPool = []; this.beams = []; this.floaters = [];
    this.rates = { ice: 0, metal: 0, fuel: 0 };
    this.focus = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.res = { ...D.START_RES };
    this.tech = { tools: 0, blaster: 0, helpers: 0 };
    this.day = 1; this.clock = 20; this.phase = 'day'; this.bliz = 0; this.blizzard = 0; this.coreOut = false;
    this.initRenderer();
    this.initWorld();
    this.initUI();
    this.bindInput();
    this.newWorld(Math.floor(Math.random() * 1e9));
    this.showMenu();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------ renderer & world
  initRenderer() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.$('stage').appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.dayBg = new THREE.Color('#ffd9cc'); this.nightBg = new THREE.Color('#1c2150'); this.blizBg = new THREE.Color('#e6f0ff');
    this.bg = this.dayBg.clone();
    this.scene.background = this.bg;
    this.scene.fog = new THREE.Fog(this.bg.getHex(), 70, 160);
    this.hemiDay = new THREE.Color(0xfff1e6); this.hemiNight = new THREE.Color(0x8f9cff);
    this.hemi = new THREE.HemisphereLight(0xfff1e6, 0x9a5a5a, 1.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun, this.sun.target);
    this.coreLight = new THREE.PointLight(0xff8a3d, 2, 55, 1);
    this.coreLight.position.set(0, 6.5, 0);
    this.scene.add(this.coreLight);
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
    this.camDir = new THREE.Vector3(1, 1.45, 1).normalize();
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (!(w > 0 && h > 0)) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.aspectMul = w / h < 0.8 ? 1.3 : 1;
  }

  initWorld() {
    const rng = rngFor(7);
    // ---- ground: pale polar ice with red regolith peeking through
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1024;
    const c = cv.getContext('2d');
    c.fillStyle = '#f4e4e6'; c.fillRect(0, 0, 1024, 1024);
    const blob = (x, y, r, col) => { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, r, r * (0.6 + rng() * 0.4), rng() * 3, 0, Math.PI * 2); c.fill(); };
    for (let i = 0; i < 160; i++) blob(rng() * 1024, rng() * 1024, 10 + rng() * 40, rng() < 0.5 ? '#fbf1f3' : '#ecd6d8');
    for (let i = 0; i < 70; i++) blob(rng() * 1024, rng() * 1024, 6 + rng() * 22, '#e6b9ae');
    for (let i = 0; i < 50; i++) blob(rng() * 1024, rng() * 1024, 8 + rng() * 26, '#dcebf5');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshToonMaterial({ color: 0xffffff, map: tex, gradientMap: gradient }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // ---- instanced decor (rocks, snow mounds, ice spikes, mountains around the edge)
    const dummy = new THREE.Object3D();
    const inst = (g, color, list, shadow = true) => {
      const m = new THREE.InstancedMesh(g, toon(color), list.length);
      const og = g.clone(); og.scale(1.07, 1.07, 1.07);
      const o = new THREE.InstancedMesh(og, outlineMat, list.length);
      list.forEach((s, i) => {
        dummy.position.set(s[0], s[1], s[2]); dummy.rotation.set(0, s[6] ?? 0, 0); dummy.scale.set(s[3], s[4], s[5]); dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix); o.setMatrixAt(i, dummy.matrix);
      });
      m.castShadow = shadow; m.receiveShadow = true;
      this.scene.add(m, o);
    };
    const ringPos = (r0, r1) => { const a = rng() * Math.PI * 2, r = r0 + rng() * (r1 - r0); return [Math.cos(a) * r, Math.sin(a) * r]; };
    const mounds = [], rocks = [], spikes = [], mtn = [], caps = [];
    for (let i = 0; i < 46; i++) { const [x, z] = ringPos(46, 70); const s = 1.4 + rng() * 2; mounds.push([x, 0, z, s * 1.4, s * 0.45, s, rng() * 3]); }
    for (let i = 0; i < 40; i++) { const [x, z] = ringPos(45, 72); const s = 0.5 + rng() * 0.9; rocks.push([x, s * 0.4, z, s * 1.2, s * 0.8, s, rng() * 3]); }
    for (let i = 0; i < 30; i++) {
      const [x, z] = ringPos(46, 70);
      for (let k = 0; k < 3; k++) { const h = 1.4 + rng() * 2; spikes.push([x + (rng() - 0.5) * 2, h / 2, z + (rng() - 0.5) * 2, 0.8, h, 0.8, rng() * 3]); }
    }
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * Math.PI * 2 + rng() * 0.08, r = 76 + rng() * 16, R = 7 + rng() * 7, H = 9 + rng() * 14;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      mtn.push([x, H / 2, z, R, H, R, rng() * 3]);
      caps.push([x, H - H * 0.21, z, R * 0.47, H * 0.42, R * 0.47, mtn[i][6]]);
    }
    inst(geo.sphere(1, 9, 6), '#fbf4f6', mounds);
    inst(geo.ico(1, 0), '#c9735a', rocks);
    inst(geo.cone(0.5, 1, 5), '#bfeaff', spikes);
    inst(geo.cone(1, 1, 7), '#d98a74', mtn, false);
    inst(geo.cone(1, 1, 7), '#fbf4f6', caps, false);

    // ---- warm zone disc + ring
    const wc = document.createElement('canvas');
    wc.width = wc.height = 256;
    const w = wc.getContext('2d');
    const gr = w.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,170,90,0.18)'); gr.addColorStop(0.75, 'rgba(255,170,90,0.08)'); gr.addColorStop(0.97, 'rgba(255,140,60,0.28)'); gr.addColorStop(1, 'rgba(255,140,60,0)');
    w.fillStyle = gr; w.fillRect(0, 0, 256, 256);
    const wt = new THREE.CanvasTexture(wc); wt.colorSpace = THREE.SRGBColorSpace;
    this.warmDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ map: wt, transparent: true, depthWrite: false }));
    this.warmDisc.rotation.x = -Math.PI / 2; this.warmDisc.position.y = 0.03;
    this.warmRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128), new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.7, depthWrite: false }));
    this.warmRing.rotation.x = -Math.PI / 2; this.warmRing.position.y = 0.05;
    this.scene.add(this.warmDisc, this.warmRing);
    this.warmVis = D.warmRadius(1);

    // ---- build grid (redrawn when the warm zone grows)
    this.gridCanvas = document.createElement('canvas');
    this.gridCanvas.width = this.gridCanvas.height = 1024;
    this.gridTex = new THREE.CanvasTexture(this.gridCanvas);
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.gridTex, transparent: true, opacity: 0.25, depthWrite: false }));
    this.grid.rotation.x = -Math.PI / 2; this.grid.position.y = 0.045;
    this.scene.add(this.grid);
    this.gridFor = 0;

    // ---- build ghost tile
    this.ghostTile = new THREE.Mesh(geo.plane(CELL - 0.3, CELL - 0.3), new THREE.MeshBasicMaterial({ color: 0x8ee04e, transparent: true, opacity: 0.5, depthWrite: false }));
    this.ghostTile.rotation.x = -Math.PI / 2; this.ghostTile.position.y = 0.07; this.ghostTile.visible = false;
    this.scene.add(this.ghostTile);
    this.ghostOk = new THREE.MeshBasicMaterial({ color: 0x8ee04e, transparent: true, opacity: 0.55, depthWrite: false });
    this.ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5f57, transparent: true, opacity: 0.55, depthWrite: false });

    // ---- tap marker
    this.tapRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.tapRing.rotation.x = -Math.PI / 2; this.tapRing.position.y = 0.08;
    this.scene.add(this.tapRing);

    // ---- falling snow
    const N = 900, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = rand(-32, 32); pos[i * 3 + 1] = rand(0, 26); pos[i * 3 + 2] = rand(-32, 32); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dc = document.createElement('canvas'); dc.width = dc.height = 32;
    const dx = dc.getContext('2d'), dg = dx.createRadialGradient(16, 16, 0, 16, 16, 16);
    dg.addColorStop(0, 'rgba(255,255,255,1)'); dg.addColorStop(1, 'rgba(255,255,255,0)');
    dx.fillStyle = dg; dx.fillRect(0, 0, 32, 32);
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.35, map: new THREE.CanvasTexture(dc), transparent: true, opacity: 0.6, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
    this.snowSpeed = Float32Array.from({ length: N }, () => rand(0.7, 1.3));

    // ---- shared bits
    this.partGeo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
    this.boltGeo = new THREE.SphereGeometry(0.2, 8, 6);
    this.beamGeo = new THREE.BoxGeometry(0.14, 0.14, 1);
    this.barBgMat = new THREE.MeshBasicMaterial({ color: 0x2a1f3d, depthTest: false, transparent: true });
    this.barMats = ['#8ee04e', '#ffd23f', '#ff5f57'].map((c2) => new THREE.MeshBasicMaterial({ color: c2, depthTest: false, transparent: true }));
    this.badgeTex = new Map();
  }

  drawGrid(R) {
    const size = 2 * (R + CELL), px = 1024 / size, c = this.gridCanvas.getContext('2d');
    c.clearRect(0, 0, 1024, 1024);
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 3;
    const n = Math.ceil(R / CELL) + 1;
    for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
      const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
      if (Math.hypot(x, z) + 1.8 > R) continue;
      if (i >= -1 && i <= 0 && j >= -1 && j <= 0) continue;
      const sx = (x - CELL / 2 + R + CELL) * px + 4, sz = (z - CELL / 2 + R + CELL) * px + 4, s = CELL * px - 8;
      c.beginPath(); c.roundRect(sx, sz, s, s, 8); c.stroke();
    }
    this.gridTex.needsUpdate = true;
    this.grid.scale.set(size, size, 1);
    this.gridFor = R;
  }

  // ------------------------------------------------------------ world state
  clearWorld() {
    for (const b of this.buildings) this.disposeBuilding(b);
    for (const n of this.nodes) this.scene.remove(n.g);
    for (const h of this.helpers) this.scene.remove(h.g);
    for (const e of this.enemies) { this.scene.remove(e.g); if (e.bar) this.scene.remove(e.bar); }
    for (const b of this.bolts) this.scene.remove(b.m);
    for (const b of this.beams) this.scene.remove(b.m);
    if (this.crate) this.scene.remove(this.crate.g);
    if (this.player) this.scene.remove(this.player.g);
    if (this.ghost) this.scene.remove(this.ghost);
    this.buildings = []; this.cells.clear(); this.nodes = []; this.helpers = []; this.enemies = []; this.spawnQueue = [];
    this.bolts = []; this.beams = []; this.crate = null; this.ghost = null; this.buildType = null; this.core = null;
  }

  newWorld(seed) {
    this.clearWorld();
    this.seed = seed;
    this.rng = rngFor(seed);
    this.placeBuilding('core', -1, -1, 1);
    for (const type of RES) {
      const total = NODES[type].count;
      let placed = 0;
      while (placed < total) {
        const a = this.rng() * Math.PI * 2, r = 12 + Math.sqrt(this.rng()) * (WORLD_R - 15);
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
        const k = Math.min(total - placed, 2 + Math.floor(this.rng() * 2));
        for (let q = 0; q < k; q++) {
          const x = cx + (this.rng() - 0.5) * 5, z = cz + (this.rng() - 0.5) * 5;
          this.spawnNode(type, x, z);
          placed++;
        }
      }
    }
    const { g, p } = makePlayer();
    this.player = { g, p, x: 0, z: 6, vx: 0, vz: 0, r: 0.5, face: 0, walk: 0, swing: 0, gatherT: 0, fireT: 0, harvesting: false, dead: false };
    g.position.set(0, 0, 6);
    this.scene.add(g);
    this.drawGrid(D.warmRadius(1));
  }

  spawnNode(type, x, z) {
    const g = makeNode(type, this.rng);
    g.position.set(x, 0, z);
    g.rotation.y = this.rng() * Math.PI * 2;
    this.scene.add(g);
    const n = { type, x, z, g, amount: NODES[type].amount, max: NODES[type].amount, alive: true, r: 1.0, respawn: 0, shake: 0, pop: 1 };
    this.nodes.push(n);
    return n;
  }

  relocateNode(n) {
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2, r = 14 + Math.sqrt(Math.random()) * (WORLD_R - 17);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.buildings.some((b) => dist2(x, z, b.x, b.z) < (b.r + 2.6) ** 2)) continue;
      if (dist2(x, z, this.player.x, this.player.z) < 64) continue;
      if (this.nodes.some((o) => o !== n && o.alive && dist2(x, z, o.x, o.z) < 6)) continue;
      n.x = x; n.z = z; n.g.position.set(x, 0, z);
      n.alive = true; n.amount = n.max; n.g.visible = true; n.pop = 0;
      return;
    }
    n.respawn = 10;
  }

  clearNodesNear(x, z, r) {
    for (const n of this.nodes) if (n.alive && dist2(x, z, n.x, n.z) < (r + n.r) ** 2) { n.alive = false; n.g.visible = false; n.respawn = 40 + Math.random() * 30; }
  }

  placeBuilding(type, i, j, lvl = 1, hp) {
    const isCore = type === 'core';
    const x = isCore ? 0 : (i + 0.5) * CELL, z = isCore ? 0 : (j + 0.5) * CELL;
    const g = new THREE.Group(), parts = {};
    MODELS[type](g, parts);
    g.position.set(x, 0, z);
    this.scene.add(g);
    const b = {
      type, i, j, lvl, x, z, g, parts, r: isCore ? 3.3 : type === 'wall' ? 1.9 : 1.7,
      maxHp: D.buildingHp(type, lvl), hp: 0, cool: Math.random() * 0.5, pop: 0, bump: 0, hitT: 0, dead: false, working: true, bar: null, badge: null, smokeT: Math.random(),
    };
    b.hp = hp != null ? Math.min(hp, b.maxHp) : b.maxHp;
    b.cellKeys = (isCore ? [[-1, -1], [0, -1], [-1, 0], [0, 0]] : [[i, j]]).map(([a, c]) => `${a},${c}`);
    b.cellKeys.forEach((k) => this.cells.set(k, b));
    this.buildings.push(b);
    if (isCore) this.core = b;
    this.updateBadge(b);
    this.clearNodesNear(x, z, b.r + 1.2);
    return b;
  }

  disposeBuilding(b) {
    this.scene.remove(b.g);
    if (b.bar) this.scene.remove(b.bar);
    if (b.badge) this.scene.remove(b.badge);
  }

  destroyBuilding(b) {
    b.dead = true;
    this.disposeBuilding(b);
    b.cellKeys.forEach((k) => this.cells.delete(k));
    this.buildings.splice(this.buildings.indexOf(b), 1);
    this.burst(b.x, 1.2, b.z, '#9aa9c4', 18, 7);
    this.burst(b.x, 1.2, b.z, '#ff8a3d', 10, 6);
    this.sfx.boom();
    if (this.sheetRef === b) this.closeSheet();
  }

  badgeTexture(lvl) {
    let t = this.badgeTex.get(lvl);
    if (!t) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const c = cv.getContext('2d');
      c.fillStyle = '#ffd23f'; c.strokeStyle = '#2a1f3d'; c.lineWidth = 6;
      c.beginPath(); c.arc(32, 32, 26, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#2a1f3d'; c.font = '700 32px "Lilita One", "Fredoka", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(lvl), 32, 35);
      t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      this.badgeTex.set(lvl, t);
    }
    return t;
  }
  updateBadge(b) {
    if (!b.badge) {
      b.badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.badgeTexture(b.lvl), depthWrite: false }));
      b.badge.scale.set(1.1, 1.1, 1);
      b.badge.renderOrder = 5;
      this.scene.add(b.badge);
    }
    b.badge.material.map = this.badgeTexture(b.lvl);
    b.badge.position.set(b.x, HEIGHT[b.type] + 0.4, b.z);
  }

  spawnHelper() {
    const { g, p } = makeHelper();
    const a = Math.random() * Math.PI * 2;
    const h = { g, p, x: Math.cos(a) * 4.5, z: Math.sin(a) * 4.5, face: a, state: 'idle', node: null, carry: { type: null, n: 0 }, t: 0, bob: Math.random() * 6, idx: this.helpers.length, wait: 0 };
    g.position.set(h.x, 0, h.z);
    this.scene.add(g);
    this.helpers.push(h);
    this.burst(h.x, 0.8, h.z, '#ffd23f', 10, 4);
    return h;
  }

  count(type) { let n = 0; for (const b of this.buildings) if (b.type === type) n++; return n; }
  helperCap() { return D.helperCap(this.buildings.filter((b) => b.type === 'hab').map((b) => b.lvl)); }
  warmR() { return this.coreOut ? 5 : D.warmRadius(this.core.lvl); }
  workshopLvl() { const w = this.buildings.find((b) => b.type === 'workshop'); return w ? w.lvl : 0; }

  // ------------------------------------------------------------ game flow
  showMenu() {
    this.state = 'menu';
    this.$('hud').classList.add('off');
    this.$('menu').classList.remove('hidden');
    this.$('pause').classList.add('hidden');
    this.$('over').classList.add('hidden');
    const save = store.get(SAVE_KEY), best = store.get(BEST_KEY) || 0;
    const cont = this.$('continue');
    cont.classList.toggle('hidden', !save);
    if (save) cont.textContent = `▶ Continue · Day ${save.day}`;
    this.$('newGame').textContent = save ? '✨ New outpost' : '▶ Play';
    this.$('bestLine').textContent = best ? `Best: survived to day ${best}` : '';
  }

  startGame(save) {
    this.sfx.unlock();
    try {
      this.newWorld(save?.seed ?? Math.floor(Math.random() * 1e9));
      this.res = { ...D.START_RES, ...(save?.res || {}) };
      this.day = save?.day ?? 1;
      this.clock = clamp(save?.clock ?? 0, 0, DAY_LEN - 1);
      this.tech = { tools: 0, blaster: 0, helpers: 0, ...(save?.tech || {}) };
      this.tut = save?.tut ?? 0;
      if (save) {
        this.core.lvl = clamp(save.core?.l ?? 1, 1, BUILDINGS.core.maxLvl);
        this.core.maxHp = D.buildingHp('core', this.core.lvl);
        this.core.hp = Math.min(save.core?.hp ?? this.core.maxHp, this.core.maxHp);
        this.updateBadge(this.core);
        for (const s of save.buildings || []) if (BUILDINGS[s.t] && s.t !== 'core' && !this.cells.has(`${s.i},${s.j}`)) this.placeBuilding(s.t, s.i, s.j, s.l, s.hp);
        this.player.x = save.px ?? 0; this.player.z = save.pz ?? 6;
      }
    } catch (err) {
      console.warn('Frostfall: could not load the save, starting fresh', err);
      store.del(SAVE_KEY);
      return this.startGame(null);
    }
    const helpers = clamp(save?.helpers ?? 1, 0, this.helperCap());
    for (let k = 0; k < helpers; k++) this.spawnHelper();
    for (const b of this.buildings) b.pop = 1;
    this.phase = 'day';
    this.hp = 100; this.warmth = 100; this.dead = 0;
    this.coreOut = false; this.blizzard = 0; this.bliz = 0; this.lowFuelWarned = false;
    this.gathered = 0; this.moveTarget = null;
    this.hudT = 0; this.saveT = 20; this.sheetT = 0;
    this.scheduleDay();
    this.drawGrid(D.warmRadius(this.core.lvl));
    this.focus.set(this.player.x, 0, this.player.z);
    this.state = 'play';
    this.$('menu').classList.add('hidden');
    this.$('over').classList.add('hidden');
    this.$('hud').classList.remove('off');
    this.closeSheet(); this.closeTray();
    this.banner(`☀️ Day ${this.day}`);
    this.updateHUD();
  }

  scheduleDay() {
    this.blizzardAt = this.day >= 2 && Math.random() < 0.55 ? rand(14, DAY_LEN - 30) : -1;
    this.crateAt = Math.max(this.clock + 5, rand(12, DAY_LEN - 25));
  }

  pause(on) {
    if (on && this.state === 'play') { this.state = 'pause'; this.$('pause').classList.remove('hidden'); this.save(); }
    else if (!on && this.state === 'pause') { this.state = 'play'; this.$('pause').classList.add('hidden'); this.last = performance.now(); }
  }

  save() {
    if (this.state !== 'play' && this.state !== 'pause') return;
    const night = this.phase === 'night';
    store.set(SAVE_KEY, {
      v: 1, seed: this.seed, day: this.day, clock: night ? DAY_LEN - 10 : this.clock,
      res: { ice: Math.floor(this.res.ice), metal: Math.floor(this.res.metal), fuel: Math.floor(this.res.fuel) },
      core: { l: this.core.lvl, hp: Math.round(this.core.hp) },
      buildings: this.buildings.filter((b) => b.type !== 'core').map((b) => ({ t: b.type, i: b.i, j: b.j, l: b.lvl, hp: Math.round(b.hp) })),
      helpers: this.helpers.length, tech: this.tech, tut: this.tut, px: +this.player.x.toFixed(1), pz: +this.player.z.toFixed(1),
    });
  }

  startNight() {
    this.phase = 'night';
    this.nightT = 0;
    const w = D.waveFor(this.day), base = Math.random() * Math.PI * 2, dirs = [];
    for (let k = 0; k < w.dirs; k++) dirs.push(base + k * (Math.PI * 2 / w.dirs) + rand(-0.4, 0.4));
    this.spawnQueue = [];
    for (const type of ['crawler', 'skitter', 'brute']) {
      for (let k = 0; k < w[type]; k++) this.spawnQueue.push({ type, at: rand(0, 16), a: dirs[k % dirs.length] + rand(-0.22, 0.22), hpMul: w.hpMul });
    }
    this.spawnQueue.sort((a, b) => a.at - b.at);
    this.banner(`🌙 Night ${this.day}`);
    this.toast(`👾 ${this.spawnQueue.length} crawlers are coming — defend the Heat Core!`);
    this.sfx.alarm();
    if (this.crate && !this.crate.landed) { this.scene.remove(this.crate.g); this.crate = null; }
  }

  dawn() {
    this.phase = 'day';
    this.day++;
    for (const e of [...this.enemies]) this.killEnemy(e, false);
    this.spawnQueue = [];
    for (const b of this.buildings) b.hp = b.maxHp;
    this.banner(`☀️ Day ${this.day}`);
    this.toast('The sun scares off the crawlers. Buildings repaired!');
    this.sfx.dawn();
    const best = store.get(BEST_KEY) || 0;
    if (this.day > best) store.set(BEST_KEY, this.day);
    this.scheduleDay();
    this.save();
  }

  gameOver() {
    if (this.state !== 'play') return;
    this.state = 'over';
    this.burst(0, 3, 0, '#ff8a3d', 40, 10);
    this.burst(0, 3, 0, '#7fe3ff', 30, 9);
    this.sfx.boom();
    store.del(SAVE_KEY);
    const best = Math.max(store.get(BEST_KEY) || 0, this.day);
    store.set(BEST_KEY, best);
    this.closeSheet(); this.closeTray(); this.cancelBuild();
    this.$('overText').textContent = `The crawlers froze the Heat Core on night ${this.day}.`;
    this.$('overBest').textContent = `Best: day ${best}`;
    setTimeout(() => { this.$('hud').classList.add('off'); this.$('over').classList.remove('hidden'); }, 1400);
  }

  // ------------------------------------------------------------ simulation
  simulate(dt) {
    const prev = this.clock;
    this.clock += dt;
    if (this.phase === 'day' && prev < DAY_LEN - 12 && this.clock >= DAY_LEN - 12) { this.toast('🌙 Night is coming — get ready!'); this.sfx.alarm(); }
    if (this.phase === 'day' && this.clock >= DAY_LEN) this.startNight();
    if (this.clock >= CYCLE) { this.clock -= CYCLE; this.dawn(); }
    if (this.state !== 'play') return;

    if (this.phase === 'day') {
      if (this.blizzardAt > 0 && this.clock >= this.blizzardAt) { this.blizzardAt = -1; this.blizzard = 24; this.banner('❄️ Blizzard!'); this.toast('It is freezing out there — stay near the warm zone!'); this.sfx.wind(); }
      if (this.crateAt > 0 && this.clock >= this.crateAt) { this.crateAt = -1; this.dropCrate(); }
    }
    if (this.blizzard > 0) this.blizzard -= dt;

    this.updateEconomy(dt);
    this.updatePlayer(dt);
    this.updateHelpers(dt);
    if (this.phase === 'night') {
      this.nightT += dt;
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.nightT) { const s = this.spawnQueue.shift(); this.spawnEnemy(s.type, s.a, s.hpMul); }
    }
    this.updateEnemies(dt);
    this.updateDefenses(dt);
    this.updateBolts(dt);
    this.updateNodes(dt);
    this.updateCrate(dt);
    this.updateTutorial();

    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.15; this.updateHUD(); }
    this.sheetT -= dt;
    if (this.sheetT <= 0) { this.sheetT = 0.3; this.refreshSheet(); if (this.trayOpen) this.renderTray(); }
    this.saveT -= dt;
    if (this.saveT <= 0 && this.phase === 'day') { this.saveT = 20; this.save(); }
  }

  updateEconomy(dt) {
    const night = this.phase === 'night', burn = D.fuelBurn(this.core.lvl, night);
    this.res.fuel -= burn * dt;
    if (this.res.fuel <= 0) {
      this.res.fuel = 0;
      if (!this.coreOut) { this.coreOut = true; this.banner('🥶 Out of fuel!'); this.toast('The Heat Core went cold — gather carbon rocks for fuel!'); this.sfx.alarm(); }
    } else if (this.coreOut && this.res.fuel >= 1) { this.coreOut = false; this.toast('🔥 Heat Core relit!'); this.sfx.coin(); }
    if (this.coreOut) this.damageBuilding(this.core, 4 * dt, true);
    if (this.res.fuel < 15 && !this.coreOut && !this.lowFuelWarned) { this.lowFuelWarned = true; this.toast('⚠️ Fuel is low! Gather carbon rocks or build a Fuel Still'); }
    if (this.res.fuel > 40) this.lowFuelWarned = false;
    const R = this.warmR(), rates = this.rates;
    rates.ice = 0; rates.metal = 0; rates.fuel = -burn;
    for (const b of this.buildings) {
      const pr = D.prodRate(b.type, b.lvl);
      if (!pr) continue;
      b.working = Math.hypot(b.x, b.z) + 1 <= R;
      if (!b.working) continue;
      for (const k in pr) { this.res[k] += pr[k] * dt; rates[k] += pr[k]; }
    }
  }

  pushOut(ent, r) {
    for (const b of this.buildings) {
      const dx = ent.x - b.x, dz = ent.z - b.z, m = b.r + r, d2 = dx * dx + dz * dz;
      if (d2 < m * m) { const d = Math.sqrt(d2) || 0.001; ent.x = b.x + (d2 ? dx / d : 1) * m; ent.z = b.z + (d2 ? dz / d : 0) * m; }
    }
    const d = Math.hypot(ent.x, ent.z);
    if (d > WORLD_R) { ent.x *= WORLD_R / d; ent.z *= WORLD_R / d; }
  }

  updatePlayer(dt) {
    const pl = this.player, night = this.phase === 'night';
    if (this.dead > 0) { this.dead -= dt; if (this.dead <= 0) this.respawn(); return; }
    let ix = 0, iy = 0;
    if (this.keys.has('left')) ix -= 1;
    if (this.keys.has('right')) ix += 1;
    if (this.keys.has('up')) iy -= 1;
    if (this.keys.has('down')) iy += 1;
    ix += this.joyVec.x; iy += this.joyVec.y;
    let mx = 0, mz = 0;
    const len = Math.hypot(ix, iy);
    if (len > 0.05) {
      const k = Math.min(1, len) / len;
      ix *= k; iy *= k;
      mx = (ix + iy) / Math.SQRT2; mz = (iy - ix) / Math.SQRT2;
      this.moveTarget = null;
    } else if (this.moveTarget) {
      const dx = this.moveTarget.x - pl.x, dz = this.moveTarget.z - pl.z, d = Math.hypot(dx, dz);
      if (d < 0.35) this.moveTarget = null;
      else { const s = Math.min(1, d / 1.2); mx = dx / d * s; mz = dz / d * s; }
    }
    const speed = 7 * (this.warmth <= 0 ? 0.7 : 1), k2 = 1 - Math.exp(-dt * 12);
    pl.vx = lerp(pl.vx, mx * speed, k2); pl.vz = lerp(pl.vz, mz * speed, k2);
    pl.x += pl.vx * dt; pl.z += pl.vz * dt;
    this.pushOut(pl, pl.r);
    const spd = Math.hypot(pl.vx, pl.vz);
    if (spd > 0.4) pl.face = Math.atan2(pl.vx, pl.vz);

    // gather from the nearest node in reach
    pl.gatherT -= dt;
    let node = null, best = Infinity;
    for (const n of this.nodes) {
      if (!n.alive) continue;
      const d2 = dist2(pl.x, pl.z, n.x, n.z), reach = n.r + 1.5;
      if (d2 < reach * reach && d2 < best) { best = d2; node = n; }
    }
    pl.harvesting = !!node;
    if (node) {
      if (spd < 1) pl.face = Math.atan2(node.x - pl.x, node.z - pl.z);
      if (pl.gatherT <= 0) { pl.gatherT = 0.45; this.harvest(node, NODES[node.type].yield + this.tech.tools, true); }
    }

    // cold
    pl.inWarm = Math.hypot(pl.x, pl.z) < this.warmR();
    if (pl.inWarm) this.warmth = Math.min(100, this.warmth + 30 * dt);
    else this.warmth = Math.max(0, this.warmth - (this.blizzard > 0 ? 6.5 : 3) * (night ? 1.4 : 1) * dt);
    if (this.warmth <= 0) this.hurtPlayer(6 * dt, true);
    else if (pl.inWarm && this.hp < 100) this.hp = Math.min(100, this.hp + 5 * dt);

    // auto blaster
    pl.fireT -= dt;
    if (pl.fireT <= 0) {
      const e = this.nearestEnemy(pl.x, pl.z, 10.5);
      if (e) {
        pl.fireT = 0.42;
        if (spd < 1 && !node) pl.face = Math.atan2(e.x - pl.x, e.z - pl.z);
        this.fireBolt(pl.x + Math.sin(pl.face) * 0.6, 1.2, pl.z + Math.cos(pl.face) * 0.6, e, 10 + 6 * this.tech.blaster, '#fff27a');
        this.sfx.shoot(false);
      }
    }
  }

  harvest(node, amt, byPlayer) {
    const take = Math.min(amt, Math.ceil(node.amount));
    node.amount -= take;
    node.shake = 0.15;
    this.burst(node.x, 1, node.z, RES_INFO[node.type].color, 4, 4);
    if (byPlayer) {
      this.res[node.type] += take;
      this.gathered += take;
      this.float(node.x, 2.4, node.z, `+${take} ${RES_INFO[node.type].emoji}`);
      this.sfx.gather(node.type);
    }
    if (node.amount <= 0) { node.alive = false; node.g.visible = false; node.respawn = 45 + Math.random() * 30; this.burst(node.x, 0.8, node.z, RES_INFO[node.type].color, 12, 6); }
    return take;
  }

  hurtPlayer(dmg, silent) {
    if (this.dead > 0) return;
    this.hp -= dmg;
    if (!silent) { this.sfx.hurt(); this.flashHurt(); }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = 4;
      this.player.dead = true;
      this.player.g.visible = false;
      this.moveTarget = null;
      this.burst(this.player.x, 1, this.player.z, '#ff8a3d', 16, 6);
      this.banner('😵 Knocked out!');
      this.toast('Respawning at the Heat Core…');
    }
  }
  respawn() {
    const pl = this.player;
    pl.x = 0; pl.z = 5.5; pl.vx = pl.vz = 0; pl.dead = false; pl.g.visible = true;
    this.hp = 60; this.warmth = 100;
    this.burst(pl.x, 1, pl.z, '#7fe3ff', 12, 5);
  }

  updateHelpers(dt) {
    const shelter = this.phase === 'night' || this.coreOut;
    const spd = 4.2 * (1 + 0.15 * this.tech.helpers), carryMax = 6 + 3 * this.tech.helpers;
    for (const h of this.helpers) {
      let tx = null, tz = null;
      if (shelter) {
        if (h.carry.n > 0 && dist2(h.x, h.z, 0, 0) < 4.6 * 4.6) this.deposit(h);
        h.state = 'shelter'; h.node = null;
        const a = (h.idx / Math.max(1, this.helpers.length)) * Math.PI * 2 + 0.4;
        tx = Math.cos(a) * 4.4; tz = Math.sin(a) * 4.4;
      } else {
        if (h.state === 'shelter') h.state = h.carry.n > 0 ? 'toCore' : 'idle';
        if (h.state === 'idle') {
          h.wait -= dt;
          if (h.wait <= 0) { h.node = this.pickNodeFor(h); h.state = h.node ? 'toNode' : 'idle'; h.wait = 1.5; }
        }
        if (h.state === 'toNode') {
          const n = h.node;
          if (!n || !n.alive) { h.state = h.carry.n > 0 ? 'toCore' : 'idle'; h.node = null; }
          else if (dist2(h.x, h.z, n.x, n.z) < (n.r + 0.8) ** 2) { h.state = 'harvest'; h.t = 0; }
          else { tx = n.x; tz = n.z; }
        }
        if (h.state === 'harvest') {
          const n = h.node;
          h.t += dt;
          if (n?.alive) h.face = Math.atan2(n.x - h.x, n.z - h.z);
          if (!n || !n.alive) h.state = h.carry.n > 0 ? 'toCore' : 'idle';
          else if (h.t >= 1.2) {
            h.t = 0;
            const take = this.harvest(n, Math.min(3 + this.tech.helpers, carryMax - h.carry.n), false);
            h.carry.type = n.type; h.carry.n += take;
            if (h.carry.n >= carryMax || !n.alive) h.state = 'toCore';
          }
        }
        if (h.state === 'toCore') {
          if (dist2(h.x, h.z, 0, 0) < (this.core.r + 1.1) ** 2) { this.deposit(h); h.state = 'idle'; h.wait = 0.3; }
          else { tx = 0; tz = 0; }
        }
      }
      let moving = false;
      if (tx != null) {
        const dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz);
        if (d > 0.3) { const s = Math.min(spd * dt, d); h.x += dx / d * s; h.z += dz / d * s; h.face = Math.atan2(dx, dz); moving = true; }
      }
      this.pushOut(h, 0.45);
      h.bob += dt * (moving ? 10 : 3);
      h.g.position.set(h.x, Math.abs(Math.sin(h.bob)) * (moving ? 0.12 : 0.04), h.z);
      h.g.rotation.y = lerpAngle(h.g.rotation.y, h.face, 1 - Math.exp(-dt * 10));
      h.p.cargo.visible = h.carry.n > 0;
      if (h.carry.n > 0) h.p.cargo.material = toon(RES_INFO[h.carry.type].color);
      h.p.body.rotation.z = h.state === 'harvest' ? Math.sin(h.t * 18) * 0.2 : 0;
    }
  }

  pickNodeFor(h) {
    const want = RES.map((r) => ({ r, w: 1 / (this.res[r] + 20) * (r === 'fuel' && this.rates.fuel < 0 ? 1.6 : 1) })).sort((a, b) => b.w - a.w);
    const claimed = new Map();
    for (const o of this.helpers) if (o !== h && o.node) claimed.set(o.node, (claimed.get(o.node) || 0) + 1);
    for (const { r } of want) {
      let best = null, bd = Infinity;
      for (const n of this.nodes) {
        if (!n.alive || n.type !== r || (claimed.get(n) || 0) >= 2) continue;
        const dc = n.x * n.x + n.z * n.z;
        if (dc > 52 * 52) continue;
        const d = dist2(h.x, h.z, n.x, n.z);
        if (d < bd) { bd = d; best = n; }
      }
      if (best) return best;
    }
    return null;
  }

  deposit(h) {
    if (!h.carry.n) return;
    this.res[h.carry.type] += h.carry.n;
    this.float(h.x, 2, h.z, `+${h.carry.n} ${RES_INFO[h.carry.type].emoji}`, 'small');
    h.carry.n = 0;
  }

  // ------------------------------------------------------------ crawlers & defence
  spawnEnemy(type, a, hpMul) {
    const d = ENEMIES[type], { g, p } = makeEnemy(type), R = WORLD_R - 1;
    const e = { type, d, g, p, x: Math.cos(a) * R, z: Math.sin(a) * R, hp: d.hp * hpMul, maxHp: d.hp * hpMul, r: d.r, speed: d.speed * rand(0.9, 1.1), target: null, retarget: 0, atkT: 0.5, phase: rand(0, 6), flash: 0, lunge: 0, face: a + Math.PI, moving: true, dead: false, bar: null };
    g.position.set(e.x, 0, e.z);
    g.rotation.y = e.face;
    this.scene.add(g);
    this.enemies.push(e);
  }

  pickTarget(e) {
    const pl = this.player;
    if (this.dead <= 0 && dist2(e.x, e.z, pl.x, pl.z) < 81) return pl;
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      const d = Math.hypot(b.x - e.x, b.z - e.z) - b.r - (b.type === 'core' ? 4 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  updateEnemies(dt) {
    for (const e of this.enemies) {
      e.retarget -= dt;
      if (!e.target || e.target.dead || e.retarget <= 0) { e.retarget = 0.6; e.target = this.pickTarget(e); }
      const t = e.target;
      if (!t) continue;
      const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz) || 0.001;
      const reach = e.r + t.r + 0.35;
      e.face = Math.atan2(dx, dz);
      if (d > reach) {
        const s = e.speed * dt;
        let nx = e.x + dx / d * s, nz = e.z + dz / d * s;
        for (const o of this.enemies) {
          if (o === e) continue;
          const ox = nx - o.x, oz = nz - o.z, od2 = ox * ox + oz * oz, m = (e.r + o.r) * 0.9;
          if (od2 < m * m && od2 > 1e-6) { const od = Math.sqrt(od2), k = (m - od) * 0.5 / od; nx += ox * k; nz += oz * k; }
        }
        for (const b of this.buildings) {
          if (b === t) continue;
          const bx = nx - b.x, bz = nz - b.z, bd = Math.hypot(bx, bz) || 0.001, m = b.r + e.r;
          if (bd < m) { e.target = b; e.retarget = 2.5; nx = b.x + bx / bd * m; nz = b.z + bz / bd * m; }
        }
        e.x = nx; e.z = nz; e.moving = true;
      } else {
        e.moving = false;
        e.atkT -= dt;
        if (e.atkT <= 0) {
          e.atkT = 1.0; e.lunge = 0.25;
          if (t === this.player) this.hurtPlayer(e.d.dmg);
          else this.damageBuilding(t, e.d.dmg);
          if (this.state !== 'play') return;
        }
      }
    }
  }

  damageBuilding(b, dmg, silent) {
    if (b.dead) return;
    b.hp -= dmg;
    if (!silent) { b.hitT = 0.15; this.sfx.hit(); }
    if (b.hp <= 0) {
      b.hp = 0;
      if (b.type === 'core') { this.gameOver(); return; }
      this.toast(`💥 Your ${BUILDINGS[b.type].name} was destroyed!`);
      this.destroyBuilding(b);
    }
  }

  nearestEnemy(x, z, range) {
    let best = null, bd = range * range;
    for (const e of this.enemies) { const d = dist2(x, z, e.x, e.z); if (d < bd) { bd = d; best = e; } }
    return best;
  }

  damageEnemy(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.12;
    if (e.hp <= 0) this.killEnemy(e, true);
  }

  killEnemy(e, reward) {
    e.dead = true;
    this.scene.remove(e.g);
    if (e.bar) this.scene.remove(e.bar);
    this.enemies.splice(this.enemies.indexOf(e), 1);
    this.burst(e.x, 0.8, e.z, e.d.color, 12, 6);
    if (reward) {
      const parts = [];
      for (const r in e.d.reward) { this.res[r] += e.d.reward[r]; parts.push(`+${e.d.reward[r]} ${RES_INFO[r].emoji}`); }
      this.float(e.x, 1.8, e.z, parts.join(' '), 'small');
      this.sfx.splat();
    }
  }

  updateDefenses(dt) {
    for (const b of this.buildings) {
      if (b.type === 'turret') {
        const s = D.turretStats(b.lvl), head = b.parts.head;
        b.cool -= dt;
        const e = this.nearestEnemy(b.x, b.z, s.range);
        if (e) {
          const yaw = Math.atan2(e.x - b.x, e.z - b.z);
          head.rotation.y = lerpAngle(head.rotation.y, yaw, 1 - Math.exp(-dt * 12));
          if (b.cool <= 0) {
            b.cool = 1 / s.rate; b.recoil = 0.12;
            const y = head.rotation.y;
            this.fireBolt(b.x + Math.sin(y) * 1.7, 1.6, b.z + Math.cos(y) * 1.7, e, s.dmg, '#ffb347');
            this.sfx.shoot(true);
          }
        } else head.rotation.y += dt * 0.4;
      } else if (b.type === 'tesla') {
        const s = D.teslaStats(b.lvl);
        b.cool -= dt;
        if (b.cool > 0) continue;
        const list = this.enemies.filter((e) => dist2(b.x, b.z, e.x, e.z) < s.range * s.range)
          .sort((a, c) => dist2(b.x, b.z, a.x, a.z) - dist2(b.x, b.z, c.x, c.z)).slice(0, s.targets);
        if (!list.length) { b.cool = 0.2; continue; }
        b.cool = s.period;
        const top = new THREE.Vector3(b.x, 3.9, b.z);
        for (const e of list) { this.zap(top, new THREE.Vector3(e.x, 0.7, e.z)); this.damageEnemy(e, s.dmg); }
        this.sfx.zap();
      }
    }
  }

  fireBolt(x, y, z, target, dmg, color) {
    let m = this.boltPool.pop();
    if (!m) m = new THREE.Mesh(this.boltGeo, basic(color));
    m.material = basic(color);
    m.position.set(x, y, z);
    this.scene.add(m);
    this.bolts.push({ m, target, tx: target.x, tz: target.z, dmg, color, speed: 30, life: 1.2 });
  }

  updateBolts(dt) {
    for (let k = this.bolts.length - 1; k >= 0; k--) {
      const b = this.bolts[k], t = b.target, p = b.m.position;
      b.life -= dt;
      if (t && !t.dead) { b.tx = t.x; b.tz = t.z; }
      const dx = b.tx - p.x, dy = 0.8 - p.y, dz = b.tz - p.z, d = Math.hypot(dx, dy, dz), step = b.speed * dt;
      if (d <= Math.max(step, 0.5)) {
        if (t && !t.dead) { this.damageEnemy(t, b.dmg); this.burst(p.x, p.y, p.z, b.color, 3, 3); }
        this.removeBolt(k);
        continue;
      }
      p.x += dx / d * step; p.y += dy / d * step; p.z += dz / d * step;
      if (b.life <= 0) this.removeBolt(k);
    }
  }
  removeBolt(k) { const b = this.bolts[k]; this.scene.remove(b.m); this.boltPool.push(b.m); this.bolts.splice(k, 1); }

  zap(a, b) {
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(rand(-0.8, 0.8), rand(-0.3, 0.5), rand(-0.8, 0.8)));
    for (const [p, q] of [[a, mid], [mid, b]]) {
      const m = new THREE.Mesh(this.beamGeo, basic('#c9f6ff'));
      m.position.copy(p).add(q).multiplyScalar(0.5);
      m.scale.set(1, 1, p.distanceTo(q));
      m.lookAt(q);
      this.scene.add(m);
      this.beams.push({ m, life: 0.14 });
    }
  }

  updateNodes(dt) {
    for (const n of this.nodes) {
      if (!n.alive) { n.respawn -= dt; if (n.respawn <= 0) this.relocateNode(n); continue; }
      if (n.pop < 1) n.pop = Math.min(1, n.pop + dt * 2.5);
      const s = (0.55 + 0.45 * n.amount / n.max) * backOut(n.pop);
      n.g.scale.setScalar(Math.max(0.01, s));
      if (n.shake > 0) { n.shake -= dt; n.g.position.x = n.x + Math.sin(n.shake * 90) * 0.08; } else n.g.position.x = n.x;
    }
  }

  dropCrate() {
    let x = 0, z = 0;
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2, r = rand(14, 40);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      if (!this.buildings.some((b) => dist2(x, z, b.x, b.z) < (b.r + 2) ** 2)) break;
    }
    const g = new THREE.Group();
    mk(g, geo.box(1.2, 1.0, 1.2), C.orange, [0, 0.5, 0]);
    mk(g, geo.box(1.25, 0.2, 0.3), C.white, [0, 0.55, 0], { outline: false });
    mk(g, geo.box(0.3, 0.2, 1.25), C.white, [0, 0.56, 0], { outline: false });
    const chute = new THREE.Group();
    mk(chute, geo.dome(1.5), '#ff7eb6', [0, 2.6, 0]);
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) mk(chute, geo.box(0.04, 1.9, 0.04), C.white, [sx * 0.55, 1.75, sz * 0.55], { outline: false, rot: [sz * 0.32, 0, -sx * 0.32] });
    g.add(chute);
    const beacon = mk(g, geo.sphere(0.18, 8, 6), C.yellow, [0, 1.25, 0], { emissive: '#ffd23f', ei: 1, outline: false });
    g.position.set(x, 26, z);
    this.scene.add(g);
    this.crate = { g, chute, beacon, x, z, r: 0.8, landed: false, y: 26, t: 0 };
    this.toast('📦 A supply drop is falling! Grab it before night');
    this.sfx.coin();
  }

  updateCrate(dt) {
    const c = this.crate;
    if (!c) return;
    c.t += dt;
    if (!c.landed) {
      c.y = Math.max(0, c.y - 4.5 * dt);
      c.g.rotation.z = Math.sin(c.t * 2) * 0.08;
      if (c.y <= 0) { c.landed = true; c.g.rotation.z = 0; c.g.remove(c.chute); this.burst(c.x, 0.4, c.z, '#ffffff', 10, 4); }
    }
    c.g.position.set(c.x, c.y, c.z);
    c.beacon.scale.setScalar(1 + Math.sin(c.t * 6) * 0.3);
    const pl = this.player;
    if (c.landed && this.dead <= 0 && dist2(pl.x, pl.z, c.x, c.z) < 2.2 * 2.2) {
      const gain = { ice: 25 + this.day * 10, metal: 25 + this.day * 10, fuel: 20 + this.day * 8 };
      for (const r in gain) this.res[r] += gain[r];
      this.float(c.x, 2.2, c.z, `+${gain.ice}🧊 +${gain.metal}⚙️ +${gain.fuel}🔥`);
      this.burst(c.x, 0.8, c.z, '#ffd23f', 20, 7);
      this.sfx.upgrade();
      this.scene.remove(c.g);
      this.crate = null;
    }
  }

  updateTutorial() {
    if (this.tut >= TUTORIAL.length) return;
    if (TUTORIAL[this.tut].done(this)) {
      this.tut++;
      this.sfx.coin();
      this.toast(this.tut >= TUTORIAL.length ? '🎉 You know the basics — now survive as many nights as you can!' : '✅ Goal complete!');
    }
  }

  // ------------------------------------------------------------ building actions
  placeError(type, i, j) {
    if (this.cells.has(`${i},${j}`)) return 'That tile is taken';
    const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
    if (Math.hypot(x, z) + 1.8 > D.warmRadius(this.core.lvl)) return 'Build inside the warm zone';
    if (this.count(type) >= D.maxCount(type, this.core.lvl)) return 'Limit reached — upgrade the Heat Core';
    if (!D.canAfford(this.res, D.costFor(type, 1))) return 'Not enough resources';
    return null;
  }

  tryPlace(i, j) {
    const type = this.buildType, err = this.placeError(type, i, j);
    if (err) { this.toast(err); this.sfx.error(); return; }
    D.pay(this.res, D.costFor(type, 1));
    const b = this.placeBuilding(type, i, j, 1);
    this.burst(b.x, 0.5, b.z, '#fff1d6', 14, 5);
    this.sfx.build();
    this.updateHUD();
    // walls are usually placed in a row, so stay in build mode while more can be afforded
    const again = type === 'wall' && this.count('wall') < D.maxCount('wall', this.core.lvl) && D.canAfford(this.res, D.costFor('wall', 1));
    if (!again) this.cancelBuild();
    else this.updateGhost();
  }

  upgrade(b) {
    const max = D.maxLevel(b.type, this.core.lvl);
    if (b.lvl >= max) { this.toast(b.type === 'core' ? 'The Heat Core is at max level!' : 'Upgrade the Heat Core to raise this cap'); this.sfx.error(); return; }
    const cost = D.costFor(b.type, b.lvl + 1);
    if (!D.canAfford(this.res, cost)) { this.toast('Not enough resources'); this.sfx.error(); return; }
    D.pay(this.res, cost);
    b.lvl++;
    b.maxHp = D.buildingHp(b.type, b.lvl);
    b.hp = b.maxHp;
    b.bump = 1;
    this.updateBadge(b);
    this.burst(b.x, HEIGHT[b.type] * 0.6, b.z, '#ffd23f', 18, 6);
    this.sfx.upgrade();
    if (b.type === 'core') {
      this.drawGrid(D.warmRadius(b.lvl));
      this.banner(`🔥 Heat Core Lv ${b.lvl}!`);
      const un = D.unlocksAt(b.lvl).map((t) => `${BUILDINGS[t].emoji} ${BUILDINGS[t].name}`);
      this.toast(un.length ? `Unlocked: ${un.join(', ')}` : 'The warm zone grew and you can build more!');
    }
    this.updateHUD();
    this.refreshSheet(true);
  }

  removeBuilding(b) {
    const refund = D.costFor(b.type, b.lvl);
    for (const r in refund) this.res[r] += Math.floor(refund[r] / 2);
    this.destroyBuilding(b);
    this.toast('Removed — you got half the cost back');
  }

  recruit() {
    const cap = this.helperCap();
    if (this.helpers.length >= cap) { this.toast('No free helper slots — build or upgrade a Habitat'); this.sfx.error(); return; }
    const cost = D.recruitCost(this.helpers.length);
    if (!D.canAfford(this.res, cost)) { this.toast('Not enough resources'); this.sfx.error(); return; }
    D.pay(this.res, cost);
    this.spawnHelper();
    this.sfx.build();
    this.toast('🤖 A new helper joined the outpost!');
    this.updateHUD();
    this.refreshSheet(true);
  }

  research(key) {
    const cap = Math.min(TECH[key].max, D.techCap(this.workshopLvl())), lvl = this.tech[key];
    if (lvl >= cap) { this.toast(lvl >= TECH[key].max ? 'Fully researched!' : 'Upgrade the Workshop to research further'); this.sfx.error(); return; }
    const cost = D.techCost(key, lvl + 1);
    if (!D.canAfford(this.res, cost)) { this.toast('Not enough resources'); this.sfx.error(); return; }
    D.pay(this.res, cost);
    this.tech[key]++;
    this.sfx.upgrade();
    this.toast(`${TECH[key].emoji} ${TECH[key].name} ${this.tech[key]}!`);
    this.updateHUD();
    this.refreshSheet(true);
  }

  enterBuild(type) {
    const err = this.count(type) >= D.maxCount(type, this.core.lvl) ? (this.core.lvl < (BUILDINGS[type].unlock ?? 1) ? `Needs Heat Core level ${BUILDINGS[type].unlock}` : 'Limit reached — upgrade the Heat Core') : !D.canAfford(this.res, D.costFor(type, 1)) ? 'Not enough resources' : null;
    if (err) { this.toast(err); this.sfx.error(); return; }
    this.closeTray(); this.closeSheet();
    this.buildType = type;
    if (this.ghost) this.scene.remove(this.ghost);
    const g = new THREE.Group();
    MODELS[type](g, {});
    g.traverse((o) => { if (o.isMesh) { if (o.material === outlineMat) o.visible = false; else { o.material = this.ghostOk; o.castShadow = false; } } });
    this.ghost = g;
    this.scene.add(g);
    this.ghostCell = this.defaultCell(type);
    this.updateGhost();
    this.$('buildHintText').textContent = `Tap a tile in the warm zone to place the ${BUILDINGS[type].emoji} ${BUILDINGS[type].name}`;
    this.$('buildHint').classList.remove('hidden');
    this.sfx.click();
  }
  cancelBuild() {
    this.buildType = null;
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    this.ghostTile.visible = false;
    this.$('buildHint').classList.add('hidden');
  }
  defaultCell(type) {
    const pi = Math.floor(this.player.x / CELL), pj = Math.floor(this.player.z / CELL);
    let best = null, bd = Infinity;
    for (let di = -7; di <= 7; di++) for (let dj = -7; dj <= 7; dj++) {
      const i = pi + di, j = pj + dj;
      if (this.placeError(type, i, j)) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = { i, j }; }
    }
    return best || { i: pi, j: pj };
  }
  updateGhost() {
    if (!this.buildType || !this.ghostCell) return;
    const { i, j } = this.ghostCell, x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
    const ok = !this.placeError(this.buildType, i, j);
    this.ghost.position.set(x, 0, z);
    this.ghost.traverse((o) => { if (o.isMesh && o.visible) o.material = ok ? this.ghostOk : this.ghostBad; });
    this.ghostTile.position.set(x, 0.07, z);
    this.ghostTile.material = ok ? this.ghostOk : this.ghostBad;
    this.ghostTile.visible = true;
  }

  // ------------------------------------------------------------ effects
  burst(x, y, z, color, n = 10, speed = 5, grav = 14) {
    for (let k = 0; k < n; k++) {
      let p = this.partPool.pop();
      if (!p) p = { m: new THREE.Mesh(this.partGeo, basic(color)) };
      p.m.material = basic(color);
      p.m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, s = speed * rand(0.4, 1);
      p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = rand(0.4, 1) * speed * 0.9;
      p.life = p.max = rand(0.45, 0.85); p.g = grav;
      p.m.scale.setScalar(1);
      this.scene.add(p.m);
      this.parts.push(p);
    }
  }
  smoke(x, y, z) {
    let p = this.partPool.pop();
    if (!p) p = { m: new THREE.Mesh(this.partGeo, basic('#c9c2d6')) };
    p.m.material = basic('#c9c2d6');
    p.m.position.set(x, y, z);
    p.vx = rand(-0.3, 0.3); p.vz = rand(-0.3, 0.3); p.vy = 1.4; p.g = -0.4;
    p.life = p.max = 1.6;
    this.scene.add(p.m);
    this.parts.push(p);
  }
  updateParticles(dt) {
    for (let k = this.parts.length - 1; k >= 0; k--) {
      const p = this.parts[k], m = p.m.position;
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.m); this.partPool.push(p); this.parts.splice(k, 1); continue; }
      p.vy -= p.g * dt;
      m.x += p.vx * dt; m.y += p.vy * dt; m.z += p.vz * dt;
      if (m.y < 0.12) { m.y = 0.12; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      const s = p.g < 0 ? 1 + (1 - p.life / p.max) * 2 : p.life / p.max;
      p.m.scale.setScalar(Math.max(0.01, s));
      p.m.rotation.x += dt * 5; p.m.rotation.y += dt * 4;
    }
    for (let k = this.beams.length - 1; k >= 0; k--) {
      const b = this.beams[k];
      b.life -= dt;
      if (b.life <= 0) { this.scene.remove(b.m); this.beams.splice(k, 1); }
    }
  }

  float(x, y, z, text, cls = '') {
    if (this.floaters.length > 30) this.floaters.shift().el.remove();
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.$('floaters').appendChild(el);
    this.floaters.push({ el, p: new THREE.Vector3(x, y, z), t: 0 });
  }
  updateFloaters(dt) {
    const w = window.innerWidth, h = window.innerHeight;
    for (let k = this.floaters.length - 1; k >= 0; k--) {
      const f = this.floaters[k];
      f.t += dt;
      if (f.t > 1.1) { f.el.remove(); this.floaters.splice(k, 1); continue; }
      this.v.copy(f.p); this.v.y += f.t * 1.8;
      this.v.project(this.camera);
      if (this.v.z > 1) { f.el.style.opacity = 0; continue; }
      f.el.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * w}px, ${(-this.v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      f.el.style.opacity = f.t < 0.75 ? 1 : 1 - (f.t - 0.75) / 0.35;
    }
  }

  updateArrows() {
    const els = this.arrowEls, w = window.innerWidth, h = window.innerHeight;
    const list = [];
    if (this.state === 'play') {
      if (this.crate) list.push({ x: this.crate.x, z: this.crate.z, kind: 'crate', d: 0 });
      for (const e of this.enemies) list.push({ x: e.x, z: e.z, kind: 'enemy', d: dist2(e.x, e.z, this.player.x, this.player.z) });
    }
    list.sort((a, b) => a.d - b.d);
    let used = 0;
    for (const it of list) {
      if (used >= els.length) break;
      this.v.set(it.x, 0.5, it.z).project(this.camera);
      const behind = this.v.z > 1;   // points behind the camera project mirrored
      if (behind) { this.v.x = -this.v.x; this.v.y = -this.v.y; }
      if (!behind && Math.abs(this.v.x) < 1 && Math.abs(this.v.y) < 1) continue;
      const m = Math.max(Math.abs(this.v.x), Math.abs(this.v.y)) || 1;
      const x = this.v.x / m * 0.9;
      let y = this.v.y / m * 0.84;
      if (x > 0.5 && y < -0.62) y = -0.62;   // keep clear of the build button
      const el = els[used++];
      el.className = `edge-arrow ${it.kind}`;
      el.style.transform = `translate(${(x * 0.5 + 0.5) * w}px, ${(-y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      el.firstChild.style.transform = `rotate(${Math.atan2(-y * h, x * w) + Math.PI / 2}rad)`;
    }
    for (let k = used; k < els.length; k++) els[k].className = 'edge-arrow hidden';
  }

  makeBar(w) {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(geo.plane(1, 1), this.barBgMat);
    bg.scale.set(w + 0.14, 0.34, 1);
    bg.renderOrder = 20;
    const fill = new THREE.Mesh(geo.plane(1, 1), this.barMats[0]);
    fill.scale.set(w, 0.2, 1);
    fill.position.z = 0.01;
    fill.renderOrder = 21;
    g.add(bg, fill);
    g.userData = { fill, w };
    this.scene.add(g);
    return g;
  }
  setBar(ent, y, w) {
    const ratio = clamp(ent.hp / ent.maxHp, 0, 1);
    if (ratio >= 0.999) { if (ent.bar) ent.bar.visible = false; return; }
    if (!ent.bar) ent.bar = this.makeBar(w);
    const bar = ent.bar, f = bar.userData.fill;
    bar.visible = true;
    bar.position.set(ent.x, y, ent.z);
    bar.quaternion.copy(this.camera.quaternion);
    f.scale.x = Math.max(0.001, w * ratio);
    f.position.x = -w * (1 - ratio) / 2;
    f.material = this.barMats[ratio > 0.5 ? 0 : ratio > 0.25 ? 1 : 2];
  }

  flashHurt() {
    const el = this.$('hurt');
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }

  // ------------------------------------------------------------ per-frame visuals
  nightness() {
    if (this.state === 'menu') return 0.45;
    const c = this.clock;
    if (c < 4) return this.day > 1 ? 1 - c / 4 : 0;
    if (c < DAY_LEN - 6) return 0;
    if (c < DAY_LEN) return (c - (DAY_LEN - 6)) / 6;
    return 1;
  }

  animate(dt) {
    const t = this.t, n = this.nightness();
    this.bliz = lerp(this.bliz, this.blizzard > 0 && this.state !== 'menu' ? 1 : 0, 1 - Math.exp(-dt * 1.5));
    // lighting
    this.bg.copy(this.dayBg).lerp(this.nightBg, n).lerp(this.blizBg, this.bliz * 0.55);
    this.scene.fog.color.copy(this.bg);
    this.scene.fog.near = lerp(70, 24, this.bliz); this.scene.fog.far = lerp(165, 85, this.bliz);
    this.sun.intensity = lerp(2.2, 0.55, n) * (1 - 0.35 * this.bliz);
    this.sun.color.setHex(n > 0.5 ? 0xaab8ff : 0xfff0d8);
    this.hemi.intensity = lerp(1.5, 0.95, n);
    this.hemi.color.copy(this.hemiDay).lerp(this.hemiNight, n);
    this.coreLight.intensity = this.coreOut ? 0.3 : lerp(1.5, 5, n) * (0.92 + Math.sin(t * 3) * 0.08);
    const f = this.focus;
    this.sun.position.set(f.x - 16, 40, f.z + 22);
    this.sun.target.position.set(f.x, 0, f.z);

    // warm zone
    const R = this.core ? this.warmR() : D.warmRadius(1);
    this.warmVis = lerp(this.warmVis, R, 1 - Math.exp(-dt * 3));
    this.warmDisc.scale.setScalar(this.warmVis);
    this.warmRing.scale.setScalar(this.warmVis);
    this.warmDisc.material.opacity = lerp(0.75, 1, n);
    this.warmRing.material.opacity = 0.55 + Math.sin(t * 2.5) * 0.15;
    this.grid.material.opacity = this.buildType ? 0.85 : 0.22;
    this.grid.visible = !this.coreOut;

    // buildings
    for (const b of this.buildings) {
      if (b.pop < 1) b.pop = Math.min(1, b.pop + dt * 2.6);
      let s = backOut(b.pop);
      if (b.bump > 0) { b.bump = Math.max(0, b.bump - dt * 2.5); s *= 1 + Math.sin(b.bump * Math.PI) * 0.14; }
      b.g.scale.setScalar(Math.max(0.01, s));
      if (b.hitT > 0) { b.hitT -= dt; b.g.position.x = b.x + (Math.random() - 0.5) * 0.18; } else b.g.position.x = b.x;
      const p = b.parts, on = b.type === 'core' ? !this.coreOut : b.working;
      switch (b.type) {
        case 'core':
          p.ring.rotation.z += dt * (on ? 1.3 : 0.1);
          p.glow.material.emissiveIntensity = on ? 0.85 + Math.sin(t * 3) * 0.15 : 0.05;
          if (on && Math.random() < dt * 3) this.smoke(rand(-0.6, 0.6), 6, rand(-0.6, 0.6));
          break;
        case 'hab': p.blink.visible = Math.sin(t * 3 + b.x) > -0.3; break;
        case 'pump': if (on) p.piston.position.y = 1.2 + Math.sin(t * 3 + b.x) * 0.25; break;
        case 'drill': if (on) p.bit.rotation.y += dt * 9; break;
        case 'still':
          p.flame.scale.set(1, on ? 1 + Math.sin(t * 9) * 0.25 : 0.3, 1);
          b.smokeT -= dt;
          if (on && b.smokeT <= 0) { b.smokeT = 0.5; this.smoke(b.x + p.smokeAt.x, p.smokeAt.y, b.z + p.smokeAt.z); }
          break;
        case 'workshop': p.gear.rotation.y += dt * 2; break;
        case 'tesla': p.orb.rotation.y += dt * 1.5; p.orb.scale.setScalar(b.cool > D.teslaStats(b.lvl).period - 0.15 ? 1.3 : 1); break;
        case 'turret':
          if (b.recoil > 0) b.recoil -= dt;
          for (const br of p.barrels) br.position.z = 0.95 - Math.max(0, b.recoil || 0) * 2;
          break;
        default: break;
      }
      this.setBar(b, HEIGHT[b.type] + 1.2, b.type === 'core' ? 3.2 : 2);
    }

    // player
    const pl = this.player;
    if (pl) {
      pl.g.position.x = pl.x; pl.g.position.z = pl.z;
      pl.g.rotation.y = lerpAngle(pl.g.rotation.y, pl.face, 1 - Math.exp(-dt * 14));
      const spd = Math.hypot(pl.vx, pl.vz), mv = Math.min(1, spd / 4);
      pl.walk += dt * spd * 1.7;
      const sw = Math.sin(pl.walk) * mv * 0.75;
      pl.p.legL.rotation.x = sw; pl.p.legR.rotation.x = -sw; pl.p.armL.rotation.x = -sw * 0.8;
      if (pl.harvesting && this.state === 'play') { pl.swing += dt * 13; pl.p.armR.rotation.x = -1.5 + Math.sin(pl.swing) * 0.9; }
      else pl.p.armR.rotation.x = lerp(pl.p.armR.rotation.x, sw * 0.8, 1 - Math.exp(-dt * 10));
      pl.g.position.y = Math.abs(Math.sin(pl.walk)) * 0.08 * mv;
    }

    // crawlers
    for (const e of this.enemies) {
      e.phase += dt * (e.moving ? e.speed * 3 : 2);
      e.g.position.set(e.x, 0, e.z);
      e.g.rotation.y = lerpAngle(e.g.rotation.y, e.face, 1 - Math.exp(-dt * 10));
      e.p.legs.forEach((l, k) => { l.rotation.y = Math.sin(e.phase + k * 1.6) * 0.5; });
      if (e.lunge > 0) e.lunge -= dt;
      e.p.body.position.z = e.lunge > 0 ? Math.sin(e.lunge / 0.25 * Math.PI) * 0.5 : 0;
      if (e.flash > 0) e.flash -= dt;
      e.p.body.scale.setScalar(e.flash > 0 ? 1.18 : 1);
      this.setBar(e, 1.9 * e.r / 0.75 + 0.4, 1.3 * Math.max(1, e.r / 0.75));
    }

    // tap marker
    if (this.tapRing.material.opacity > 0) {
      this.tapRing.material.opacity = Math.max(0, this.tapRing.material.opacity - dt * 1.8);
      this.tapRing.scale.setScalar(1 + (0.8 - this.tapRing.material.opacity) * 0.8);
    }

    // snow
    const sp = this.snow.geometry.attributes.position, a = sp.array, cx = f.x, cz = f.z, fall = 2.2 + this.bliz * 7, drift = 1 + this.bliz * 9;
    for (let i = 0; i < a.length; i += 3) {
      const k = this.snowSpeed[i / 3];
      a[i + 1] -= fall * k * dt;
      a[i] += drift * dt;
      a[i + 2] -= drift * 0.4 * dt;
      if (a[i + 1] < 0 || Math.abs(a[i] - cx) > 34 || Math.abs(a[i + 2] - cz) > 34) {
        a[i] = cx + rand(-32, 32); a[i + 2] = cz + rand(-32, 32); a[i + 1] = a[i + 1] < 0 ? 26 : rand(0, 26);
      }
    }
    sp.needsUpdate = true;
    this.snow.material.opacity = 0.45 + this.bliz * 0.5;
    this.snow.material.size = 0.32 + this.bliz * 0.25;

    // overlays
    this.$('bliz').style.opacity = (this.bliz * 0.55).toFixed(3);
    const cold = this.state === 'play' && this.player && !this.player.inWarm ? 1 - this.warmth / 100 : 0;
    this.$('coldVig').style.opacity = (cold * 0.9).toFixed(3);
  }

  updateCamera(dt) {
    this.zoom = lerp(this.zoom, this.zoomTarget, 1 - Math.exp(-dt * 8));
    const target = this.v;
    if (this.state === 'menu') {
      target.set(0, 0, 0);
      this.focus.lerp(target, 1 - Math.exp(-dt * 2));
      const a = this.t * 0.07;
      this.camera.position.set(this.focus.x + Math.cos(a) * 42, 34, this.focus.z + Math.sin(a) * 42);
    } else {
      target.set(this.player.x, 0, this.player.z);
      this.focus.lerp(target, 1 - Math.exp(-dt * 6));
      const d = 40 * this.zoom * this.aspectMul;
      this.camera.position.copy(this.focus).addScaledVector(this.camDir, d);
    }
    this.camera.lookAt(this.focus.x, 0.8, this.focus.z);
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.step(dt);
  }
  step(dt) {
    this.t += dt;
    if (this.state === 'play') this.simulate(dt);
    this.updateCamera(dt);
    this.animate(dt);
    this.updateParticles(dt);
    this.updateFloaters(dt);
    this.updateArrows();
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ input
  groundAt(x, y) {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }
  cellAt(p) { return { i: Math.floor(p.x / CELL), j: Math.floor(p.z / CELL) }; }

  tap(x, y) {
    if (this.state !== 'play') return;
    const p = this.groundAt(x, y);
    if (!p) return;
    const cell = this.cellAt(p);
    if (this.buildType) { this.ghostCell = cell; this.updateGhost(); this.tryPlace(cell.i, cell.j); return; }
    let b = this.cells.get(`${cell.i},${cell.j}`);
    if (!b) for (const o of this.buildings) if (dist2(p.x, p.z, o.x, o.z) < (o.r + 0.3) ** 2) { b = o; break; }
    if (b) { this.openBuilding(b); this.sfx.click(); return; }
    if (this.dead > 0) return;
    this.moveTarget = { x: p.x, z: p.z };
    this.tapRing.position.set(p.x, 0.08, p.z);
    this.tapRing.material.opacity = 0.8;
    this.tapRing.scale.setScalar(1);
  }

  bindInput() {
    const el = this.renderer.domElement;
    const joyEl = this.$('joy'), knob = joyEl.firstElementChild;
    el.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoomTarget };
        this.joy = null; this.joyVec.x = this.joyVec.y = 0; joyEl.classList.add('hidden');
      } else if (this.pointers.size === 1) this.joy = { id: e.pointerId, sx: e.clientX, sy: e.clientY, active: false };
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse' && this.buildType) { const g = this.groundAt(e.clientX, e.clientY); if (g) { const c = this.cellAt(g); if (!this.ghostCell || c.i !== this.ghostCell.i || c.j !== this.ghostCell.j) { this.ghostCell = c; this.updateGhost(); } } }
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        this.zoomTarget = clamp(this.pinch.zoom * this.pinch.dist / (Math.hypot(a.x - b.x, a.y - b.y) || 1), 0.55, 1.6);
        return;
      }
      const j = this.joy;
      if (!j || j.id !== e.pointerId) return;
      const dx = e.clientX - j.sx, dy = e.clientY - j.sy, d = Math.hypot(dx, dy);
      if (!j.active && d > 14 && !this.buildType) {
        j.active = true;
        joyEl.classList.remove('hidden');
        joyEl.style.transform = `translate(${j.sx}px, ${j.sy}px) translate(-50%, -50%)`;
      }
      if (j.active) {
        const k = Math.min(1, d / 55);
        this.joyVec.x = d ? dx / d * k : 0; this.joyVec.y = d ? dy / d * k : 0;
        knob.style.transform = `translate(${this.joyVec.x * 38}px, ${this.joyVec.y * 38}px)`;
      } else if (this.buildType) {
        const g = this.groundAt(e.clientX, e.clientY);
        if (g) { this.ghostCell = this.cellAt(g); this.updateGhost(); }
      }
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      const j = this.joy;
      if (j && j.id === e.pointerId) {
        if (!j.active && e.type === 'pointerup' && !this.pinch && performance.now() - p.t < 600) this.tap(e.clientX, e.clientY);
        this.joy = null; this.joyVec.x = this.joyVec.y = 0;
        joyEl.classList.add('hidden');
      }
      if (this.pointers.size < 2) this.pinch = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomTarget = clamp(this.zoomTarget * Math.exp(e.deltaY * 0.001), 0.55, 1.6); }, { passive: false });
    const allowNative = (e) => e.target.closest?.('input, textarea');
    document.addEventListener('contextmenu', (e) => { if (!allowNative(e)) e.preventDefault(); });
    document.addEventListener('selectstart', (e) => { if (!allowNative(e)) e.preventDefault(); });
    document.addEventListener('dblclick', (e) => e.preventDefault());
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());

    const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea')) return;
      const k = KEYMAP[e.code];
      if (k) { this.keys.add(k); e.preventDefault(); return; }
      if (e.code === 'Escape') {
        if (this.buildType) this.cancelBuild();
        else if (this.sheetOpen) this.closeSheet();
        else if (this.trayOpen) this.closeTray();
        else if (this.state === 'play') this.pause(true);
        else if (this.state === 'pause') this.pause(false);
      } else if (e.code === 'KeyB' && this.state === 'play') { if (this.trayOpen) this.closeTray(); else this.openTray(); }
      else if (e.code === 'KeyP') { if (this.state === 'play') this.pause(true); else if (this.state === 'pause') this.pause(false); }
    });
    window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) this.keys.delete(k); });
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(true); });
  }

  // ------------------------------------------------------------ UI
  initUI() {
    const resRow = this.$('resRow');
    this.resEls = {};
    for (const r of RES) {
      const el = document.createElement('div');
      el.className = `res res-${r}`;
      el.innerHTML = `<span class="e">${RES_INFO[r].emoji}</span><b>0</b><small></small>`;
      resRow.appendChild(el);
      this.resEls[r] = { el, v: el.querySelector('b'), rate: el.querySelector('small') };
    }
    this.arrowEls = [];
    for (let k = 0; k < 6; k++) {
      const el = document.createElement('div');
      el.className = 'edge-arrow hidden';
      el.innerHTML = '<i>▲</i>';
      this.$('arrows').appendChild(el);
      this.arrowEls.push(el);
    }
    const on = (id, fn) => this.$(id).addEventListener('click', (e) => { this.sfx.unlock(); fn(e); });
    on('newGame', () => { this.sfx.click(); this.startGame(null); });
    on('continue', () => { this.sfx.click(); this.startGame(store.get(SAVE_KEY)); });
    on('btnPause', () => { this.sfx.click(); this.pause(true); });
    on('resume', () => { this.sfx.click(); this.pause(false); });
    on('quit', () => { this.sfx.click(); this.save(); this.closeSheet(); this.closeTray(); this.cancelBuild(); this.newWorld(Math.floor(Math.random() * 1e9)); this.showMenu(); });
    on('again', () => { this.sfx.click(); this.startGame(null); });
    on('overMenu', () => { this.sfx.click(); this.newWorld(Math.floor(Math.random() * 1e9)); this.showMenu(); });
    on('btnSound', () => { this.sfx.on = !this.sfx.on; store.set(SOUND_KEY, this.sfx.on); this.$('btnSound').textContent = this.sfx.on ? '🔊' : '🔇'; this.sfx.click(); });
    this.$('btnSound').textContent = this.sfx.on ? '🔊' : '🔇';
    on('btnBuild', () => { this.sfx.click(); if (this.trayOpen) this.closeTray(); else this.openTray(); });
    on('btnHelpers', () => { this.sfx.click(); this.openSheet({ kind: 'helpers' }); });
    on('cancelBuild', () => { this.sfx.click(); this.cancelBuild(); });
    on('closeTray', () => { this.sfx.click(); this.closeTray(); });
    this.$('cards').addEventListener('click', (e) => { const c = e.target.closest('[data-type]'); if (c) this.enterBuild(c.dataset.type); });
    this.$('sheet').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      this.sfx.unlock();
      const act = btn.dataset.act, b = this.sheetRef;
      if (act === 'close') { this.sfx.click(); this.closeSheet(); }
      else if (act === 'upgrade' && b) this.upgrade(b);
      else if (act === 'recruit') this.recruit();
      else if (act === 'tech') this.research(btn.dataset.k);
      else if (act === 'remove' && b) {
        if (this.removeArmed !== b) { this.removeArmed = b; this.refreshSheet(true); this.sfx.click(); }
        else { this.removeArmed = null; this.removeBuilding(b); this.closeSheet(); }
      }
    });
  }

  banner(text) {
    const el = this.$('banner');
    el.textContent = text;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  toast(text) {
    const el = this.$('toast');
    el.textContent = text;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  updateHUD() {
    for (const r of RES) {
      const e = this.resEls[r], rate = this.rates[r];
      e.v.textContent = fmt(this.res[r]);
      e.rate.textContent = Math.abs(rate) >= 0.05 ? `${rate > 0 ? '+' : ''}${rate.toFixed(1)}/s` : '';
      e.rate.classList.toggle('neg', rate < 0);
    }
    this.resEls.fuel.el.classList.toggle('warn', this.res.fuel < 15);
    this.$('hpFill').style.width = `${clamp(this.hp, 0, 100)}%`;
    this.$('warmFill').style.width = `${clamp(this.warmth, 0, 100)}%`;
    this.$('warmBar').classList.toggle('cold', !this.player.inWarm);
    const night = this.phase === 'night';
    this.$('dayPill').classList.toggle('night', night);
    this.$('dayIcon').textContent = night ? '🌙' : this.blizzard > 0 ? '❄️' : '☀️';
    this.$('dayText').textContent = `${night ? 'Night' : 'Day'} ${this.day}`;
    this.$('dayFill').style.width = `${(night ? (this.clock - DAY_LEN) / NIGHT_LEN : this.clock / DAY_LEN) * 100}%`;
    const left = this.enemies.length + this.spawnQueue.length;
    this.$('enemyCount').textContent = night ? `👾 ${left}` : '';
    this.$('helperCount').textContent = `${this.helpers.length}/${this.helperCap()}`;
    const goal = this.$('goal');
    if (this.tut < TUTORIAL.length) { goal.classList.remove('hidden'); this.$('goalText').textContent = TUTORIAL[this.tut].text; }
    else goal.classList.add('hidden');
  }

  costHtml(cost) {
    return Object.keys(cost).map((r) => `<span class="cost ${this.res[r] >= cost[r] ? '' : 'no'}">${RES_INFO[r].emoji}${fmt(cost[r])}</span>`).join('');
  }

  openTray() {
    this.cancelBuild(); this.closeSheet();
    this.trayOpen = true;
    this.renderTray();
    this.$('tray').classList.remove('hidden');
    this.syncPanels();
  }
  closeTray() { this.trayOpen = false; this.$('tray').classList.add('hidden'); this.syncPanels(); }
  syncPanels() { this.$('hud').classList.toggle('panel-open', !!(this.trayOpen || this.sheetOpen)); }
  renderTray() {
    const L = this.core.lvl;
    const html = BUILD_ORDER.map((t) => {
      const def = BUILDINGS[t], max = D.maxCount(t, L), n = this.count(t), cost = D.costFor(t, 1);
      const locked = L < (def.unlock ?? 1), full = !locked && n >= max, afford = D.canAfford(this.res, cost);
      const foot = locked ? `<em class="lock">🔒 Core Lv ${def.unlock}</em>` : full ? `<em class="lock">${n}/${max} built</em>` : `<div class="costs">${this.costHtml(cost)}</div>`;
      return `<button class="card ${locked || full ? 'locked' : afford ? '' : 'poor'}" data-type="${t}"><span class="ce">${def.emoji}</span><b>${def.name}</b><small>${locked ? '&nbsp;' : `${n}/${max}`}</small>${foot}</button>`;
    }).join('');
    if (html !== this.trayHtml) { this.$('cards').innerHTML = html; this.trayHtml = html; }
  }

  openBuilding(b) { this.openSheet({ kind: 'building', b }); }
  openSheet(ref) {
    this.closeTray(); this.cancelBuild();
    this.sheetOpen = ref;
    this.sheetRef = ref.b || null;
    this.removeArmed = null;
    this.refreshSheet(true);
    this.$('sheet').classList.remove('hidden');
    this.syncPanels();
  }
  closeSheet() { this.sheetOpen = null; this.sheetRef = null; this.$('sheet').classList.add('hidden'); this.syncPanels(); }

  statsFor(type, l) {
    const n = l + 1, arrow = (a, b2) => (b2 != null && b2 !== a ? `${a} → <i>${b2}</i>` : `${a}`);
    const up = (fn) => arrow(fn(l), l < D.maxLevel(type, this.core.lvl) || type === 'core' && l < BUILDINGS.core.maxLvl ? fn(n) : null);
    switch (type) {
      case 'core': return [['Warm zone', up((x) => D.warmRadius(x))], ['Fuel use', up((x) => `${D.fuelBurn(x, false).toFixed(2)}/s`)], ['Max HP', up((x) => D.buildingHp('core', x))]];
      case 'hab': return [['Helper slots', up((x) => 2 * x)], ['Max HP', up((x) => D.buildingHp(type, x))]];
      case 'pump': case 'drill': case 'still': {
        const r = Object.keys(BUILDINGS[type].prod)[0];
        return [[`${RES_INFO[r].emoji} per second`, up((x) => D.prodRate(type, x)[r])], ['Max HP', up((x) => D.buildingHp(type, x))]];
      }
      case 'turret': return [['Damage', up((x) => D.turretStats(x).dmg)], ['Range', up((x) => D.turretStats(x).range)], ['Shots / s', up((x) => D.turretStats(x).rate.toFixed(2))]];
      case 'tesla': return [['Damage', up((x) => D.teslaStats(x).dmg)], ['Range', up((x) => D.teslaStats(x).range)], ['Targets', up((x) => D.teslaStats(x).targets)]];
      case 'wall': return [['Max HP', up((x) => D.buildingHp(type, x))]];
      case 'workshop': return [['Research cap', up((x) => D.techCap(x))]];
      default: return [];
    }
  }

  refreshSheet(force) {
    if (!this.sheetOpen) return;
    let html = '';
    if (this.sheetOpen.kind === 'helpers') html = this.helpersHtml(true);
    else {
      const b = this.sheetRef;
      if (!b || b.dead) { this.closeSheet(); return; }
      const def = BUILDINGS[b.type], max = D.maxLevel(b.type, this.core.lvl), atMax = b.lvl >= max;
      const cost = D.costFor(b.type, b.lvl + 1), afford = D.canAfford(this.res, cost);
      const stats = this.statsFor(b.type, b.lvl).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
      const hpPct = Math.round(100 * b.hp / b.maxHp);
      let extra = '';
      if (b.type === 'core') {
        const next = D.unlocksAt(b.lvl + 1);
        if (next.length && !atMax) extra += `<p class="sh-note">Next level unlocks: ${next.map((t) => `${BUILDINGS[t].emoji} ${BUILDINGS[t].name}`).join(', ')}</p>`;
        if (this.coreOut) extra += '<p class="sh-note bad">Out of fuel! Gather 🔥 from carbon rocks to relight it.</p>';
      }
      if (b.type === 'hab') extra += this.helpersHtml(false);
      if (b.type === 'workshop') {
        const cap = D.techCap(b.lvl);
        extra += `<div class="techs">${Object.keys(TECH).map((k) => {
          const tdef = TECH[k], lvl = this.tech[k], c = Math.min(tdef.max, cap), done = lvl >= c, tc = D.techCost(k, lvl + 1);
          return `<div class="tech"><span class="te">${tdef.emoji}</span><div><b>${tdef.name} <i>${lvl}/${tdef.max}</i></b><small>${tdef.desc}</small></div>
            <button class="btn sm ${done || !D.canAfford(this.res, tc) ? 'dim' : 'green'}" data-act="tech" data-k="${k}">${lvl >= tdef.max ? 'Max' : done ? '🔒 Upgrade Workshop' : this.costHtml(tc)}</button></div>`;
        }).join('')}</div>`;
      }
      if (b.type !== 'core' && b.working === false && def.prod) extra += '<p class="sh-note bad">❄️ Frozen — it is outside the warm zone.</p>';
      const upBtn = atMax
        ? `<button class="btn dim" data-act="upgrade">${b.type === 'core' ? '⭐ Max level' : `🔒 Needs Heat Core Lv ${b.lvl + 1}`}</button>`
        : `<button class="btn ${afford ? 'green' : 'dim'}" data-act="upgrade">⬆ Upgrade to Lv ${b.lvl + 1}<span class="costs">${this.costHtml(cost)}</span></button>`;
      const rmBtn = b.type === 'core' ? '' : `<button class="btn sm ${this.removeArmed === b ? 'red' : ''}" data-act="remove">${this.removeArmed === b ? 'Tap again to remove' : '🗑 Remove'}</button>`;
      html = `<div class="sheet-head"><span class="sh-em">${def.emoji}</span><div class="sh-title"><b>${def.name}</b><small>Level ${b.lvl}${b.type === 'core' ? ` / ${BUILDINGS.core.maxLvl}` : ` · cap ${max}`}</small></div><button class="round sm" data-act="close" aria-label="Close">✕</button></div>
        <p class="sh-desc">${def.desc}</p>
        <div class="sh-stats">${stats}</div>
        <div class="sh-hp"><i style="width:${hpPct}%"></i><span>❤️ ${Math.ceil(b.hp)} / ${b.maxHp}</span></div>
        ${extra}
        <div class="sh-actions">${upBtn}${rmBtn}</div>`;
    }
    if (force || html !== this.sheetHtml) { this.$('sheet').innerHTML = html; this.sheetHtml = html; }
  }

  helpersHtml(full) {
    const n = this.helpers.length, cap = this.helperCap(), cost = D.recruitCost(n), canSlot = n < cap;
    const btn = `<button class="btn ${canSlot && D.canAfford(this.res, cost) ? 'green' : 'dim'}" data-act="recruit">${canSlot ? `🤖 Recruit helper<span class="costs">${this.costHtml(cost)}</span>` : '🔒 No free slots'}</button>`;
    const body = `<div class="sh-stats"><div><span>Helpers</span><b>${n} / ${cap}</b></div><div><span>Carry</span><b>${6 + 3 * this.tech.helpers}</b></div><div><span>Speed</span><b>${Math.round(100 * (1 + 0.15 * this.tech.helpers))}%</b></div></div>
      ${canSlot ? '' : '<p class="sh-note">Build or upgrade a 🏠 Habitat for more helper slots.</p>'}`;
    if (!full) return `<h4>Helper bots</h4>${body}<div class="sh-actions">${btn}</div>`;
    return `<div class="sheet-head"><span class="sh-em">🤖</span><div class="sh-title"><b>Helper bots</b><small>${n} working</small></div><button class="round sm" data-act="close" aria-label="Close">✕</button></div>
      <p class="sh-desc">Helpers gather ice, metal and fuel on their own and carry it back to the Heat Core. At night they hide in the warm zone.</p>
      ${body}<div class="sh-actions">${btn}</div>`;
  }
}

window.__frost = new Frostfall();
