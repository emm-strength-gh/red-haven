// Cube Lab: a glossy 3D twisty cube with levels, patterns and a free sandbox.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { cwQ, invert, simplify, pathBetween, fullScrambleLength, starsFor } from './cube-logic.js';
import { CHAPTERS, LEVELS, levelsIn, puzzleFor } from './cube-levels.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const HALF_PI = Math.PI / 2;
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const fmtTime = (ms, tenths = false) => {
  const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60), r = s - m * 60;
  return tenths ? `${m}:${r.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(r)).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- save
const SAVE_KEY = 'cube-lab-v1';
let save = { stars: {}, best: {}, theme: 'classic', speed: 'normal', sound: true, timer: true, sandboxN: 3 };
try { save = { ...save, ...JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') }; } catch { /* storage blocked */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* ignore */ } };

const THEMES = {
  classic: { label: 'Classic', body: 0x131319, colors: [0xf7f7f2, 0xffd21f, 0x12a650, 0x1f5fe6, 0xe3233b, 0xff7414], glow: 0, rough: 0.2 },
  neon: { label: 'Neon', body: 0x06060c, colors: [0xf2f0ff, 0xf3ff3a, 0x3dff86, 0x22d8ff, 0xff2e7e, 0xff9b1f], glow: 0.6, rough: 0.3 },
  pastel: { label: 'Pastel', body: 0xf1edf8, colors: [0xffffff, 0xffe58f, 0x94e3b2, 0x96bfff, 0xff99ad, 0xffbd80], glow: 0, rough: 0.35 }
};
const SPEEDS = { snappy: { label: 'Snappy', ms: 110 }, normal: { label: 'Normal', ms: 170 }, smooth: { label: 'Smooth', ms: 260 } };
const SIZE_NAMES = { 2: 'Pocket', 3: 'Classic', 4: 'Big', 5: 'Bigger', 6: 'Huge', 7: 'Monster' };

// ---------------------------------------------------------------- sound
class Sound {
  constructor() { this.ctx = null; this.last = 0; }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain(); this.out.gain.value = 0.6; this.out.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.25);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  get ok() { return save.sound && this.ctx && this.ctx.state === 'running'; }
  tone(freq, dur, { type = 'sine', vol = 0.2, delay = 0, slide = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }
  burst(dur, freq, vol, delay = 0) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay, src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.4;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out); src.start(t, Math.random() * 0.1); src.stop(t + dur + 0.02);
  }
  click(soft = false) {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    if (now - this.last < 0.035) return;
    this.last = now;
    this.burst(0.05, 2000 + Math.random() * 1200, soft ? 0.12 : 0.28);
    this.tone(150 + Math.random() * 40, 0.05, { type: 'triangle', vol: soft ? 0.05 : 0.12 });
  }
  lock() { this.tone(120, 0.14, { type: 'square', vol: 0.07, slide: -50 }); this.burst(0.07, 500, 0.18); }
  hint() { this.tone(660, 0.14, { vol: 0.12 }); this.tone(990, 0.2, { vol: 0.1, delay: 0.08 }); }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.4, { type: 'triangle', vol: 0.16, delay: i * 0.09 }));
    this.tone(1568, 0.7, { vol: 0.07, delay: 0.4 });
  }
  star(i) { this.tone(880 * 1.26 ** i, 0.28, { type: 'triangle', vol: 0.14 }); }
  fail() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.32, { type: 'sawtooth', vol: 0.06, delay: i * 0.15 })); }
  tick() { this.tone(1250, 0.04, { type: 'square', vol: 0.04 }); }
}
const sound = new Sound();

// ---------------------------------------------------------------- renderer & scene
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping;
stage.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex;
scene.environmentIntensity = 0.9;
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
camera.position.set(0, 0, 12);
scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a1a50, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 7, 6); scene.add(key);
const rim = new THREE.DirectionalLight(0x9a7dff, 1.0); rim.position.set(-6, -2, -5); scene.add(rim);

const root = new THREE.Group(); scene.add(root);
const cubeGroup = new THREE.Group(); root.add(cubeGroup);
const pivot = new THREE.Group(); cubeGroup.add(pivot);
const hintGroup = new THREE.Group(); cubeGroup.add(hintGroup);
const labelGroup = new THREE.Group(); cubeGroup.add(labelGroup);
const HOME_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.52, -0.72, 0, 'XYZ'));
cubeGroup.quaternion.copy(HOME_Q);

function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// pedestal: soft shadow and two glowing rings
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({
  map: radialTexture([[0, 'rgba(0,0,0,.55)'], [0.5, 'rgba(0,0,0,.2)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false
}));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = -2.75; root.add(shadow);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x6af0c8, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.035, 8, 96), ringMat);
ring.rotation.x = Math.PI / 2; ring.position.y = -2.7; root.add(ring);
const ring2Mat = ringMat.clone(); ring2Mat.opacity = 0.3;
const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.02, 8, 96, Math.PI * 1.4), ring2Mat);
ring2.rotation.x = Math.PI / 2; ring2.position.y = -2.72; root.add(ring2);

// drifting sparkles
const dotTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']], 64);
const sparkGeo = new THREE.BufferGeometry();
{
  const N = 260, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 6 + Math.random() * 12, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
    pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7, r * Math.sin(ph) * Math.sin(th) - 6], i * 3);
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
  size: 0.09, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xcfc4ff, sizeAttenuation: true
}));
scene.add(sparks);

// confetti
const CONF_N = 180;
const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONF_N);
confetti.frustumCulled = false; confetti.visible = false; scene.add(confetti);
const confParts = Array.from({ length: CONF_N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), rv: new THREE.Vector3(), life: 0 }));
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function burstConfetti() {
  const cols = THEMES[save.theme].colors;
  confParts.forEach((c, i) => {
    c.p.set((Math.random() - 0.5) * 1.5, (Math.random() - 0.3) * 1.5, (Math.random() - 0.5) * 1.5).add(root.position);
    const th = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 5;
    c.v.set(Math.cos(th) * sp, 4 + Math.random() * 6, Math.sin(th) * sp * 0.6 + 1.5);
    c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    c.rv.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    c.life = 2.2 + Math.random() * 1.2;
    confetti.setColorAt(i, new THREE.Color(cols[i % 6]));
  });
  confetti.instanceColor.needsUpdate = true;
  confetti.visible = true;
}
function updateConfetti(dt) {
  if (!confetti.visible) return;
  let alive = 0;
  confParts.forEach((c, i) => {
    c.life -= dt;
    if (c.life > 0) {
      alive++;
      c.v.y -= 7 * dt; c.v.multiplyScalar(1 - 0.9 * dt);
      c.p.addScaledVector(c.v, dt);
      c.r.x += c.rv.x * dt; c.r.y += c.rv.y * dt; c.r.z += c.rv.z * dt;
    }
    _q.setFromEuler(c.r); _s.setScalar(c.life > 0 ? Math.min(1, c.life * 2) : 0);
    confetti.setMatrixAt(i, _m4.compose(c.p, _q, _s));
  });
  confetti.instanceMatrix.needsUpdate = true;
  if (!alive) confetti.visible = false;
}

// ---------------------------------------------------------------- cube meshes
function roundedSquare(size, r) {
  const s = size / 2, sh = new THREE.Shape();
  sh.moveTo(-s + r, -s); sh.lineTo(s - r, -s); sh.quadraticCurveTo(s, -s, s, -s + r);
  sh.lineTo(s, s - r); sh.quadraticCurveTo(s, s, s - r, s); sh.lineTo(-s + r, s);
  sh.quadraticCurveTo(-s, s, -s, s - r); sh.lineTo(-s, -s + r); sh.quadraticCurveTo(-s, -s, -s + r, -s);
  return new THREE.ShapeGeometry(sh, 5);
}
const stickerGeo = roundedSquare(0.84, 0.15);
const bodyGeo = new RoundedBoxGeometry(0.98, 0.98, 0.98, 3, 0.12);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x131319, roughness: 0.4, metalness: 0.05 });
const stickerMats = Array.from({ length: 6 }, () => new THREE.MeshPhysicalMaterial({
  roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
}));
function applyTheme() {
  const th = THEMES[save.theme] || THEMES.classic;
  bodyMat.color.setHex(th.body);
  bodyMat.roughness = save.theme === 'pastel' ? 0.55 : 0.4;
  stickerMats.forEach((m, i) => {
    m.color.setHex(th.colors[i]); m.emissive.setHex(th.colors[i]); m.emissiveIntensity = th.glow; m.roughness = th.rough;
  });
}
applyTheme();

const _z = new THREE.Vector3(0, 0, 1);
/** Build cubie meshes for a puzzle; colours come from `colorOf(slot)`. */
function buildCubies(puzzle, parent, colorOf) {
  const byPos = new Map();
  puzzle.slots.forEach((s, i) => { const k = s.p.join(','); if (!byPos.has(k)) byPos.set(k, []); byPos.get(k).push(i); });
  const cubies = [], stickers = [];
  for (const slots of byPos.values()) {
    const p = puzzle.slots[slots[0]].p;
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(p[0] / 2, p[1] / 2, p[2] / 2);
    body.userData.home = p;
    for (const i of slots) {
      const nr = puzzle.slots[i].n;
      const st = new THREE.Mesh(stickerGeo, stickerMats[colorOf(i)]);
      const nv = new THREE.Vector3(nr[0], nr[1], nr[2]);
      st.position.copy(nv).multiplyScalar(0.497);
      st.quaternion.setFromUnitVectors(_z, nv);
      st.userData.slot = i; st.userData.cubie = body;
      body.add(st); stickers.push(st);
    }
    parent.add(body); cubies.push(body);
  }
  return { cubies, stickers };
}

let puzzle = puzzleFor(3), state = puzzle.solved();
let cubies = [], stickers = [], pickables = [];
function buildCube(n) {
  dropAnim();
  for (const c of cubies) cubeGroup.remove(c);
  puzzle = puzzleFor(n); state = puzzle.solved();
  ({ cubies, stickers } = buildCubies(puzzle, cubeGroup, (i) => state[i]));
  pickables = [...cubies, ...stickers];
  cubeGroup.scale.setScalar(3 / n);
  clearHint(); labelGroup.clear();
}
/** Build the cube if the size changed; returns true when it was rebuilt. */
const ensureCube = (n) => { if (puzzle.n === n && cubies.length) return false; buildCube(n); return true; };
const recolor = () => { for (const st of stickers) st.material = stickerMats[state[st.userData.slot]]; };

// ---------------------------------------------------------------- target preview (second scene in a scissor box)
const pScene = new THREE.Scene();
pScene.environment = envTex;
pScene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a1a50, 1.0));
{ const l = new THREE.DirectionalLight(0xffffff, 1.4); l.position.set(3, 6, 5); pScene.add(l); }
const pCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 50); pCamera.position.set(0, 0, 11.5);
const pGroup = new THREE.Group(); pScene.add(pGroup);
const pSpin = new THREE.Group(); pGroup.add(pSpin);
let previewOn = false, previewFlip = 0, previewSpin = 0, pAngle = 0;
function showPreview(target) {
  pSpin.clear();
  if (!target) { previewOn = false; $('preview').classList.add('hidden'); return; }
  buildCubies(puzzle, pSpin, (i) => target[i]);
  pSpin.scale.setScalar(3 / puzzle.n);
  pGroup.rotation.set(0.5, 0, 0);
  previewFlip = 0; previewSpin = -0.7; pAngle = -0.7;
  previewOn = true; $('preview').classList.remove('hidden', 'match');
}
$('preview').addEventListener('pointerdown', (e) => { e.stopPropagation(); previewFlip += Math.PI; sound.click(true); });

// ---------------------------------------------------------------- hint arrow & face labels
const hintMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.95, depthWrite: false });
const slabMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
const slabLineMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
let hintArc = null, hintMove = null;
function clearHint() {
  for (const o of hintGroup.children) o.traverse((c) => { if (c.geometry) c.geometry.dispose(); });
  hintGroup.clear(); hintArc = null; hintMove = null;
}
function showHint(move) {
  clearHint();
  hintMove = move;
  const n = puzzle.n, along = move.layers.reduce((a, b) => a + b, 0) / move.layers.length / 2;
  const thick = move.layers.length + 0.08, full = n + 0.1;
  const dims = [full, full, full]; dims[move.axis] = thick;
  const box = new THREE.BoxGeometry(...dims);
  const slab = new THREE.Mesh(box, slabMat);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), slabLineMat);
  const pos = new THREE.Vector3(); pos.setComponent(move.axis, along);
  slab.position.copy(pos); edges.position.copy(pos);
  hintGroup.add(slab, edges);
  // curved arrow in a plane perpendicular to the axis
  const R = n * 0.74 + 0.25, arc = move.q === 2 ? Math.PI * 1.25 : Math.PI * 0.62;
  const holder = new THREE.Group();
  const dir = AXES[move.axis].clone().multiplyScalar(move.q === 3 ? -1 : 1);
  holder.quaternion.setFromUnitVectors(_z, dir);
  holder.position.copy(pos);
  const spin = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.TorusGeometry(R, 0.09 * n / 3 + 0.03, 10, 64, arc), hintMat);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34 * n / 3 + 0.1, 0.8 * n / 3 + 0.2, 20), hintMat);
  cone.position.set(R * Math.cos(arc), R * Math.sin(arc), 0); cone.rotation.z = arc;
  spin.add(tube, cone); holder.add(spin); hintGroup.add(holder);
  hintArc = { holder, spin, arc };
}
function updateHint(t) {
  if (!hintArc) return;
  const cam = hintArc.holder.worldToLocal(camera.position.clone());
  hintArc.spin.rotation.z = Math.atan2(cam.y, cam.x) - hintArc.arc / 2;
  const k = 0.5 + 0.5 * Math.sin(t * 6);
  hintMat.opacity = 0.65 + 0.35 * k; slabMat.opacity = 0.1 + 0.12 * k;
}
function textSprite(text, bg, fg = '#0d0a22') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.beginPath(); g.roundRect(10, 10, 108, 108, 30); g.fill();
  g.fillStyle = fg; g.font = '78px "Lilita One", "Fredoka", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  return sp;
}
function showFaceLabels(faces) {
  labelGroup.traverse((c) => { if (c.material?.map) { c.material.map.dispose(); c.material.dispose(); } });
  labelGroup.clear();
  if (!faces) return;
  const n = puzzle.n;
  for (const f of ['U', 'D', 'F', 'B', 'R', 'L']) {
    const on = faces.includes(f);
    const sp = on ? textSprite(f, '#6af0c8') : textSprite('🔒', 'rgba(20,14,52,.75)', '#fff');
    const idx = { U: [1, 1], D: [1, -1], F: [2, 1], B: [2, -1], R: [0, 1], L: [0, -1] }[f];
    const v = new THREE.Vector3(); v.setComponent(idx[0], idx[1] * (n / 2 + 1.2 * n / 3));
    sp.position.copy(v); sp.scale.setScalar(on ? 0.85 * n / 3 : 0.6 * n / 3);
    sp.material.opacity = on ? 1 : 0.75;
    labelGroup.add(sp);
  }
}

// ---------------------------------------------------------------- session state
const S = {
  mode: 'title', level: null, history: [], redo: [], trail: [], hintUsed: false,
  busy: false, won: false, failed: false, paused: false, assisted: false, armed: false, variants: null,
  timer: { acc: 0, at: 0, running: false }
};
const elapsed = () => S.timer.acc + (S.timer.running ? performance.now() - S.timer.at : 0);
const timerStart = () => { if (!S.timer.running) { S.timer.at = performance.now(); S.timer.running = true; } };
const timerStop = () => { if (S.timer.running) { S.timer.acc += performance.now() - S.timer.at; S.timer.running = false; } };
const timerReset = () => { S.timer = { acc: 0, at: 0, running: false }; };
/** The clock runs from the first twist (levels always, sandbox once shuffled). */
const startClock = () => { if (S.mode === 'level' || (S.mode === 'sandbox' && S.armed)) timerStart(); };
const playing = () => (S.mode === 'level' || S.mode === 'sandbox') && !S.won && !S.failed && !S.paused;

// ---------------------------------------------------------------- turn animation queue
const queue = [];
let anim = null;
function grab(axis, layers) {
  pivot.quaternion.identity();
  for (const c of cubies) if (layers.includes(c.userData.home[axis])) pivot.add(c);
}
function releasePivot() {
  for (const c of pivot.children.slice()) {
    const h = c.userData.home;
    cubeGroup.add(c); c.position.set(h[0] / 2, h[1] / 2, h[2] / 2); c.quaternion.identity();
  }
  pivot.quaternion.identity();
}
const angleFor = (q) => (q === 3 ? -HALF_PI : q * HALF_PI);
function enqueue(move, source, dur = SPEEDS[save.speed].ms, ease = easeOut) { queue.push({ move, source, dur, ease }); }
function startNext() {
  const it = queue.shift();
  grab(it.move.axis, it.move.layers);
  anim = { ...it, axis: it.move.axis, from: 0, to: angleFor(it.move.q), t: 0 };
}
function finishAnim() {
  const a = anim; anim = null;
  releasePivot();
  if (a.move) commit(a.move, a.source);
}
function flushAnim() {
  if (anim) finishAnim();
  while (queue.length) { const it = queue.shift(); commit(it.move, it.source); }
}
/** Throw away pending turns without applying them (state is about to be reset anyway). */
function dropAnim() {
  if (anim) { releasePivot(); anim = null; }
  if (drag.turn) { releasePivot(); drag.turn = null; drag.kind = null; }
  queue.length = 0;
}
function updateAnim(dt) {
  let budget = dt * 1000;
  while (budget > 0 && !drag.turn) {
    if (!anim) { if (!queue.length) break; startNext(); }
    const need = anim.dur - anim.t;
    if (budget >= need) { budget -= need; anim.t = anim.dur; finishAnim(); continue; }
    anim.t += budget; budget = 0;
    const k = anim.ease(anim.t / anim.dur);
    pivot.quaternion.setFromAxisAngle(AXES[anim.axis], anim.from + (anim.to - anim.from) * k);
  }
}
const idle = () => !anim && !queue.length;

function commit(move, source) {
  state = puzzle.apply(state, move);
  recolor();
  if (source !== 'unwind') S.trail.push(move);
  if (S.trail.length > 400) S.trail = simplify(S.trail);
  if (hintMove) clearHint();
  if (source === 'player' || source === 'redo') {
    if (source === 'player') { S.history.push(move); S.redo = []; } else S.history.push(move);
    sound.click();
    startClock();
    updateHud();
    checkWin();
  } else if (source === 'undo') {
    sound.click(true); updateHud();
  } else if (source === 'shuffle' || source === 'setup' || source === 'auto') {
    sound.click(true);
    if (idle()) onSequenceDone(source);
  } else if (source === 'attract' || source === 'unwind') {
    sound.click(true);
  }
  if (S.mode === 'level' && S.level.kind === 'pattern') $('preview').classList.toggle('match', puzzle.matches(state, S.variants));
}

function onSequenceDone(source) {
  S.busy = false;
  if (source === 'setup') {
    S.trail = simplify(S.trail);
    toast(S.level.tip || (S.level.kind === 'pattern' ? 'Match the target cube!' : 'Your turn — solve it!'), S.level.tip ? 5200 : 2400);
    updateTools();
  } else if (source === 'shuffle') {
    S.trail = simplify(S.trail);
    S.armed = true; timerReset();
    toast(save.timer ? 'Shuffled! The timer starts on your first twist.' : 'Shuffled! Good luck.');
    updateTools(); updateHud();
  } else if (source === 'auto') {
    S.trail = []; S.history = []; S.redo = []; S.armed = false;
    toast('✨ Auto-solved');
    burstConfetti();
    updateTools(); updateHud();
  }
}

// ---------------------------------------------------------------- input
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointers = new Map();
const drag = { kind: null, turn: null };
let orbitVel = { x: 0, y: 0 }, zoom = 1, zoomTarget = 1;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

function toScreen(vWorld) {
  const p = vWorld.clone().project(camera), r = canvas.getBoundingClientRect();
  return new THREE.Vector2((p.x + 1) / 2 * r.width, (1 - p.y) / 2 * r.height);
}
function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  scene.updateMatrixWorld();
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  if (!hit) return null;
  const cubie = hit.object.userData.cubie || hit.object;
  let nrm;
  if (hit.object.userData.slot !== undefined) nrm = puzzle.slots[hit.object.userData.slot].n.slice();
  else {
    const f = hit.face.normal, a = [Math.abs(f.x), Math.abs(f.y), Math.abs(f.z)];
    const home = cubie.userData.home;
    // choose the dominant face direction that is actually on the outside of the cube
    const order = [0, 1, 2].sort((i, j) => a[j] - a[i]);
    const ax = order.find((i) => Math.abs(home[i]) === puzzle.m && Math.sign(f.getComponent(i)) === Math.sign(home[i])) ?? order.find((i) => Math.abs(home[i]) === puzzle.m);
    if (ax === undefined) return null;
    nrm = [0, 0, 0]; nrm[ax] = Math.sign(home[ax]);
  }
  return { cubie, nrm, point: hit.point.clone() };
}
const canTurn = () => playing() && !S.busy;
const allowed = (move) => {
  if (S.mode !== 'level' || !S.level.faces) return true;
  if (move.layers.length !== 1) return false;
  const f = puzzle.faceName(move.axis, move.layers[0]);
  return !!f && S.level.faces.includes(f);
};

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or stale pointer */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  orbitVel = { x: 0, y: 0 };
  if (pointers.size === 2) {
    if (drag.turn) cancelTurn();
    const [a, b] = [...pointers.values()];
    drag.kind = 'multi'; drag.dist = Math.hypot(a.x - b.x, a.y - b.y); drag.zoom0 = zoomTarget;
    drag.cx = (a.x + b.x) / 2; drag.cy = (a.y + b.y) / 2;
    return;
  }
  if (pointers.size > 2) return;
  const hit = canTurn() ? pick(e) : null;
  if (hit) {
    if (!idle()) flushAnim();
    drag.kind = 'pending'; drag.hit = hit; drag.x0 = e.clientX; drag.y0 = e.clientY; drag.id = e.pointerId;
  } else {
    drag.kind = 'orbit'; drag.lx = e.clientX; drag.ly = e.clientY; drag.id = e.pointerId; drag.lt = performance.now();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (drag.kind === 'multi' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    rotateView(cx - drag.cx, cy - drag.cy);
    drag.cx = cx; drag.cy = cy;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (drag.dist > 20) zoomTarget = clamp(drag.zoom0 * drag.dist / d, 0.7, 1.7);
    return;
  }
  if (e.pointerId !== drag.id) return;
  if (drag.kind === 'orbit') {
    const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly, now = performance.now();
    rotateView(dx, dy);
    const dt = Math.max(1, now - drag.lt);
    orbitVel = { x: dx / dt * 16, y: dy / dt * 16 };
    drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = now;
  } else if (drag.kind === 'pending') {
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (Math.hypot(dx, dy) > 9) beginTurn(dx, dy);
  } else if (drag.kind === 'turn') {
    moveTurn(e.clientX - drag.x0, e.clientY - drag.y0);
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (drag.kind === 'multi') {
    if (pointers.size === 1) {
      const [id, p] = [...pointers.entries()][0];
      drag.kind = 'orbit'; drag.id = id; drag.lx = p.x; drag.ly = p.y; drag.lt = performance.now();
    } else if (!pointers.size) drag.kind = null;
    return;
  }
  if (e.pointerId !== drag.id) return;
  if (drag.kind === 'turn') releaseTurn();
  drag.kind = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomTarget = clamp(zoomTarget * (1 + Math.sign(e.deltaY) * 0.08), 0.7, 1.7); }, { passive: false });
window.addEventListener('blur', () => { for (const id of [...pointers.keys()]) endPointer({ pointerId: id }); });

function rotateView(dx, dy) {
  const k = 0.0085;
  cubeGroup.quaternion.premultiply(_q.setFromAxisAngle(AXES[1], dx * k)).premultiply(_q.setFromAxisAngle(AXES[0], dy * k));
}

function beginTurn(dx, dy) {
  if (!idle()) flushAnim();
  const { hit } = drag;
  const nv = new THREE.Vector3(...hit.nrm);
  const gq = cubeGroup.getWorldQuaternion(new THREE.Quaternion());
  const p0 = toScreen(hit.point);
  const dragDir = new THREE.Vector2(dx, dy).normalize();
  let best = null;
  for (let a = 0; a < 3; a++) {
    if (hit.nrm[a] !== 0) continue;
    const t = _v.copy(AXES[a]).cross(nv).applyQuaternion(gq);
    const p1 = toScreen(_w.copy(hit.point).addScaledVector(t, 0.3));
    const sv = p1.sub(p0);
    const len = sv.length();
    if (len < 1e-3) continue;
    const score = Math.abs(sv.clone().divideScalar(len).dot(dragDir));
    if (!best || score > best.score) best = { a, score, dir: sv.clone().divideScalar(len), pxPerUnit: len / 0.3 };
  }
  if (!best) { drag.kind = 'orbit'; drag.lx = drag.x0 + dx; drag.ly = drag.y0 + dy; return; }
  const local = cubeGroup.worldToLocal(hit.point.clone());
  const comps = [local.x, local.y, local.z]; comps[best.a] = 0;
  const rWorld = Math.max(0.7, Math.hypot(...comps) * cubeGroup.scale.x);
  const layer = hit.cubie.userData.home[best.a];
  const move = { axis: best.a, layers: [layer], q: 1 };
  drag.kind = 'turn';
  drag.turn = { axis: best.a, layers: [layer], dir: best.dir, pxPerRad: best.pxPerUnit * rWorld, angle: 0, vel: 0, t: performance.now(), locked: !allowed(move) };
  grab(best.a, [layer]);
  if (!drag.turn.locked) startClock();
  moveTurn(dx, dy);
}
function moveTurn(dx, dy) {
  const T = drag.turn;
  let ang = (dx * T.dir.x + dy * T.dir.y) / T.pxPerRad;
  if (T.locked) ang = clamp(ang, -0.14, 0.14) * (1 - Math.min(1, Math.abs(ang)) * 0.3);
  const now = performance.now(), dt = Math.max(1, now - T.t) / 1000;
  T.vel = T.vel * 0.6 + ((ang - T.angle) / dt) * 0.4;
  T.angle = ang; T.t = now;
  pivot.quaternion.setFromAxisAngle(AXES[T.axis], ang);
}
function releaseTurn() {
  const T = drag.turn; drag.turn = null;
  let q = Math.round(T.angle / HALF_PI);
  const proj = T.angle + clamp(T.vel, -20, 20) * 0.1;
  if (q === 0 && Math.abs(proj) > HALF_PI * 0.5) q = Math.sign(proj);
  q = clamp(q, -2, 2);
  if (T.locked) {
    q = 0; sound.lock();
    toast(`🔒 Locked! Only <b>${S.level.faces.join(' ')}</b> can turn.`);
  }
  const to = q * HALF_PI;
  const dur = clamp(Math.abs(to - T.angle) / HALF_PI * SPEEDS[save.speed].ms * 1.1, 60, 320);
  const qq = ((q % 4) + 4) % 4;
  anim = { move: qq ? { axis: T.axis, layers: T.layers, q: qq } : null, source: 'player', axis: T.axis, from: T.angle, to, t: 0, dur, ease: easeOut };
}
function cancelTurn() {
  const T = drag.turn; drag.turn = null;
  anim = { move: null, source: 'player', axis: T.axis, from: T.angle, to: 0, t: 0, dur: 140, ease: easeOut };
}

// view-relative face mapping (which cube axis is "front", "up", "right" right now)
function viewFrame() {
  const inv = cubeGroup.quaternion.clone().invert();
  const dirs = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)].map((v) => v.applyQuaternion(inv));
  const used = new Set(), out = {};
  ['F', 'U', 'R'].forEach((name, k) => {
    const v = [dirs[k].x, dirs[k].y, dirs[k].z];
    let best = -1;
    for (let a = 0; a < 3; a++) if (!used.has(a) && (best < 0 || Math.abs(v[a]) > Math.abs(v[best]))) best = a;
    used.add(best);
    out[name] = [best, Math.sign(v[best]) || 1];
  });
  out.B = [out.F[0], -out.F[1]]; out.D = [out.U[0], -out.U[1]]; out.L = [out.R[0], -out.R[1]];
  return out;
}
function viewMove(letter, prime, double, quiet = false) {
  const fr = viewFrame();
  let axis, s, layer;
  if ('MES'.includes(letter)) {
    if (puzzle.n % 2 === 0) { if (!quiet) toast('Slice moves need an odd-sized cube.'); return null; }
    [axis, s] = fr[{ M: 'L', E: 'D', S: 'F' }[letter]]; layer = 0;
  } else { [axis, s] = fr[letter]; layer = s * puzzle.m; }
  let q = cwQ(s);
  if (double) q = 2; else if (prime) q = (4 - q) % 4;
  return { axis, layers: [layer], q };
}
/** Name a move the way the keys/pad see it from the current view (falls back to cube notation). */
function viewName(move) {
  const same = (m) => m && m.axis === move.axis && m.q === move.q && m.layers.length === move.layers.length && m.layers.every((v, i) => v === move.layers[i]);
  const letters = puzzle.n % 2 ? 'UDLRFBMES' : 'UDLRFB';
  for (const l of letters) {
    if (same(viewMove(l, false, false, true))) return l;
    if (same(viewMove(l, true, false, true))) return `${l}′`;
    if (same(viewMove(l, false, true, true))) return `${l}2`;
  }
  return puzzle.format(move).replace("'", '′');
}
function playerMove(move) {
  if (!move || !canTurn()) return;
  if (!allowed(move)) { sound.lock(); toast(`🔒 Locked! Only <b>${S.level.faces.join(' ')}</b> can turn.`); return; }
  if (queue.length > 3) return;
  startClock();
  enqueue(move, 'player');
}
let viewAnim = null;
function spinView(letter, prime) {
  const axis = 'XYZ'.indexOf(letter);
  const to = new THREE.Quaternion().setFromAxisAngle(AXES[axis], prime ? HALF_PI : -HALF_PI).multiply(cubeGroup.quaternion);
  viewAnim = { from: cubeGroup.quaternion.clone(), to, t: 0 };
  sound.click(true);
}

window.addEventListener('keydown', (e) => {
  if (e.repeat && !['z', 'Z', 'y', 'Y'].includes(e.key)) return;
  const k = e.key;
  if (k === 'Escape') { if (S.paused) resume(); else if (S.mode !== 'title' && openScreen() === null) pauseGame(); return; }
  if (openScreen() !== null) return;
  if (S.mode === 'title') return;
  if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const up = k.toUpperCase();
  if ('UDLRFBMES'.includes(up) && up.length === 1) { sound.unlock(); playerMove(viewMove(up, e.shiftKey, false)); e.preventDefault(); return; }
  if ('XYZ'.includes(up) && up.length === 1) { spinView(up, e.shiftKey); return; }
  if (up === 'H' && S.mode === 'level') hint();
  if (k === ' ' && S.mode === 'sandbox') { e.preventDefault(); shuffle(); }
});

// ---------------------------------------------------------------- HUD
let toastTimer = 0;
function toast(html, ms = 2600) {
  const t = $('toast'); t.innerHTML = html; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}
function setAccent(h1, h2) {
  document.documentElement.style.setProperty('--a1', h1);
  document.documentElement.style.setProperty('--a2', h2);
  ringMat.color.set(h1); ring2Mat.color.set(h2);
}
function updateHud() {
  $('moveCount').textContent = S.history.length;
  if (S.mode === 'level') {
    $('parWrap').classList.remove('hidden'); $('parCount').textContent = S.level.par;
  } else $('parWrap').classList.add('hidden');
  updateTools();
}
function updateTools() {
  const lvl = S.mode === 'level';
  for (const b of $('tools').querySelectorAll('[data-mode]')) b.classList.toggle('hidden', b.dataset.mode !== S.mode);
  $('undoBtn').disabled = !S.history.length || S.busy;
  $('redoBtn').disabled = !S.redo.length || S.busy;
  $('hintBtn').disabled = S.busy || !lvl;
  $('shuffleBtn').disabled = S.busy;
  $('solveBtn').disabled = S.busy;
  $('resetBtn').disabled = S.busy;
  $('restartBtn').disabled = S.busy && lvl;
  $('sizeIcon').textContent = `${puzzle.n}×${puzzle.n}`;
}
let lastTick = -1;
function updateTimer() {
  if (S.mode !== 'level' && S.mode !== 'sandbox') return;
  const pill = $('timePill');
  if (S.mode === 'level' && S.level.time) {
    const left = S.level.time * 1000 - elapsed();
    $('timeLabel').textContent = 'Left';
    $('timeText').textContent = fmtTime(Math.ceil(left / 1000) * 1000);
    pill.classList.toggle('warn', left < 10000 && S.timer.running);
    const sec = Math.ceil(left / 1000);
    if (S.timer.running && sec <= 5 && sec !== lastTick && sec > 0) { lastTick = sec; sound.tick(); }
    if (left <= 0 && playing()) fail('time');
  } else {
    pill.classList.remove('warn');
    pill.classList.toggle('hidden', S.mode === 'sandbox' && !save.timer);
    $('timeLabel').textContent = 'Time';
    $('timeText').textContent = fmtTime(elapsed(), S.mode === 'sandbox');
  }
}

$('menuBtn').addEventListener('click', () => pauseGame());
$('undoBtn').addEventListener('click', () => undo());
$('redoBtn').addEventListener('click', () => redo());
$('hintBtn').addEventListener('click', () => hint());
$('restartBtn').addEventListener('click', () => { if (S.mode === 'level') startLevel(S.level, false); });
$('shuffleBtn').addEventListener('click', () => shuffle());
$('solveBtn').addEventListener('click', () => autoSolve());
$('resetBtn').addEventListener('click', () => resetSandbox());
$('sizeBtn').addEventListener('click', () => openSizes());
let padOpen = false;
$('padBtn').addEventListener('click', () => {
  padOpen = !padOpen;
  $('pad').classList.toggle('hidden', !padOpen); $('padBtn').classList.toggle('on', padOpen);
});

function buildPad() {
  const pad = $('pad'); pad.innerHTML = '';
  const rows = [['U', "U'", 'D', "D'", 'x', "x'"], ['L', "L'", 'R', "R'", 'y', "y'"], ['F', "F'", 'B', "B'", 'z', "z'"]];
  if (puzzle.n % 2 === 1) rows.push(['M', "M'", 'E', "E'", 'S', "S'"]);
  for (const r of rows) for (const label of r) {
    const b = document.createElement('button');
    b.textContent = label.replace("'", '′');
    const letter = label[0], prime = label.includes("'");
    if ('xyz'.includes(letter)) b.classList.add('rot');
    b.addEventListener('click', () => {
      sound.unlock();
      if ('xyz'.includes(letter)) spinView(letter.toUpperCase(), prime);
      else playerMove(viewMove(letter, prime, false));
    });
    pad.appendChild(b);
  }
}

// ---------------------------------------------------------------- actions
function undo() {
  if (!canTurn() || !S.history.length) return;
  flushAnim();
  if (!S.history.length) return;
  const m = S.history.pop();
  S.redo.push(m);
  enqueue({ axis: m.axis, layers: m.layers, q: (4 - m.q) % 4 }, 'undo');
  updateTools();
}
function redo() {
  if (!canTurn() || !S.redo.length) return;
  flushAnim();
  enqueue(S.redo.pop(), 'redo');
  updateTools();
}
function hint() {
  if (S.mode !== 'level' || !canTurn()) return;
  flushAnim();
  const path = pathBetween(S.trail, S.level.target);
  if (!path.length) return;
  S.hintUsed = true;
  showHint(path[0]);
  sound.hint();
  toast(`💡 Turn the glowing layer the way the arrow points <b>${viewName(path[0])}</b>`, 3600);
}
function shuffle() {
  if (S.mode !== 'sandbox' || S.busy || S.paused) return;
  flushAnim();
  const n = puzzle.n, len = fullScrambleLength(n);
  const moves = puzzle.scramble(Math.random, len, { inner: n > 3 });
  S.busy = true; S.won = false; S.assisted = false; S.armed = false;
  S.history = []; S.redo = []; timerReset();
  const dur = clamp(2400 / len, 28, 90);
  for (const m of moves) enqueue(m, 'shuffle', dur, easeInOut);
  clearHint(); updateHud();
}
function autoSolve() {
  if (S.mode !== 'sandbox' || S.busy || S.paused) return;
  flushAnim();
  const path = invert(simplify(S.trail));
  if (!path.length) { toast('Already solved! Tap 🔀 Shuffle to mix it up.'); return; }
  S.busy = true; S.assisted = true; timerStop();
  const dur = clamp(3200 / path.length, 35, 200);
  for (const m of path) enqueue(m, 'auto', dur, easeInOut);
  updateTools();
}
function resetSandbox() {
  if (S.mode !== 'sandbox' || S.busy) return;
  flushAnim();
  state = puzzle.solved(); recolor();
  S.trail = []; S.history = []; S.redo = []; S.armed = false; S.won = false; timerReset();
  clearHint(); updateHud();
  sound.click(true);
}

function checkWin() {
  if (S.mode === 'level') {
    const ok = S.level.kind === 'pattern' ? puzzle.matches(state, S.variants) : puzzle.isSolved(state);
    if (ok) winLevel();
  } else if (S.mode === 'sandbox' && S.armed && !S.assisted && puzzle.isSolved(state)) winSandbox();
}

let spinBoost = 0;
function celebrate() {
  S.won = true; timerStop();
  sound.win(); burstConfetti(); spinBoost = 9;
  const f = $('flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 40);
}

function winLevel() {
  celebrate();
  const L = S.level, moves = S.history.length, time = elapsed();
  const stars = starsFor(moves, L.par, S.hintUsed);
  const prev = save.stars[L.id] || 0;
  if (stars > prev) save.stars[L.id] = stars;
  persist();
  const next = LEVELS[L.id + 1];
  setTimeout(() => {
    showResult({
      icon: stars === 3 ? '🏆' : '🎉', title: L.kind === 'pattern' ? 'Pattern matched!' : 'Solved!', stars,
      text: S.hintUsed ? 'Hints used — try it hint-free for all three stars.' : moves <= L.par ? 'Perfect — right on par!' : `Par is ${L.par}. Can you do it in fewer moves?`,
      stats: [['Moves', moves], ['Par', L.par], ['Time', fmtTime(time, true)]],
      primary: next && isUnlocked(next) ? { label: 'Next level →', fn: () => openIntro(next) } : { label: '🧩 Levels', fn: () => openLevels() },
      secondary: [{ label: '⟲ Retry', fn: () => startLevel(L, false) }, { label: '🧩 Levels', fn: () => openLevels() }]
    });
  }, 1300);
}
function winSandbox() {
  celebrate();
  const n = puzzle.n, time = elapsed(), moves = S.history.length;
  const prev = save.best[n];
  const record = save.timer && (!prev || time < prev);
  if (record) save.best[n] = Math.round(time);
  persist();
  S.armed = false;
  S.trail = simplify(S.trail);
  if (S.trail.length && puzzle.isSolved(state) && state.every((v, i) => v === puzzle.slots[i].face)) S.trail = [];
  setTimeout(() => {
    const stats = [['Moves', moves]];
    if (save.timer) stats.unshift(['Time', fmtTime(time, true)]), stats.push(['Best', fmtTime(save.best[n], true), record]);
    showResult({
      icon: record && prev ? '🏆' : '🎉', title: record && prev ? 'New record!' : `${n}×${n} solved!`, stars: 0,
      text: 'You did it — no help, all you.',
      stats,
      primary: { label: '🔀 Shuffle again', fn: () => { closeScreens(); S.won = false; shuffle(); } },
      secondary: [{ label: 'Keep playing', fn: () => { closeScreens(); S.won = false; } }, { label: 'Change size', fn: () => { S.won = false; openSizes(); } }]
    });
  }, 1300);
}
function fail(why) {
  S.failed = true; timerStop(); sound.fail();
  showResult({
    icon: '⏰', title: "Time's up!", stars: 0,
    text: 'So close! Restart and try a faster route — the hint button is always there.',
    stats: [['Moves', S.history.length], ['Limit', `${S.level.time}s`]],
    primary: { label: '⟲ Try again', fn: () => startLevel(S.level, false) },
    secondary: [{ label: '🧩 Levels', fn: () => openLevels() }]
  });
}

// ---------------------------------------------------------------- screens
const SCREENS = ['title', 'levels', 'sizes', 'intro', 'pause', 'settings', 'result'];
const openScreen = () => SCREENS.find((s) => !$(s).classList.contains('hidden') && s !== 'title') ?? null;
function showScreen(id) { for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id); }
function closeScreens() { for (const s of SCREENS) $(s).classList.add('hidden'); }

function showResult({ icon, title, stars, text, stats, primary, secondary }) {
  $('resIcon').textContent = icon; $('resTitle').textContent = title; $('resText').textContent = text;
  const st = $('resStars');
  st.innerHTML = '';
  if (stars) {
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('span');
      s.innerHTML = i < stars ? '★' : '<i>★</i>';
      s.style.animationDelay = `${0.15 + i * 0.18}s`;
      st.appendChild(s);
      if (i < stars) setTimeout(() => sound.star(i), 250 + i * 180);
    }
  }
  st.classList.toggle('hidden', !stars);
  $('resStats').innerHTML = stats.map(([k, v, hi]) => `<div><small>${k}</small><b class="${hi ? 'best' : ''}">${v}</b></div>`).join('');
  const nb = $('resNext'); nb.textContent = primary.label; nb.onclick = primary.fn;
  const [a, b] = [$('resRetry'), $('resMenu')];
  [a, b].forEach((btn, i) => {
    const s = secondary[i];
    btn.classList.toggle('hidden', !s);
    if (s) { btn.textContent = s.label; btn.onclick = s.fn; }
  });
  showScreen('result');
}

// chapter / level unlocking
const doneIn = (ch) => levelsIn(ch).filter((l) => save.stars[l.id]).length;
const chapterOpen = (ch) => ch === 0 || doneIn(ch - 1) >= 3;
const isUnlocked = (l) => chapterOpen(l.ch) && (l.num === 1 || !!save.stars[l.id - 1]);
const totalStars = () => Object.values(save.stars).reduce((a, b) => a + b, 0);

function openLevels() {
  dropAnim();
  enterTitleLook(false);
  S.mode = 'menu';
  $('hud').classList.add('hidden');
  const list = $('chapterList'); list.innerHTML = '';
  $('starTotal').textContent = `★ ${totalStars()} / ${LEVELS.length * 3}`;
  let current = LEVELS.find((l) => isUnlocked(l) && !save.stars[l.id]);
  CHAPTERS.forEach((c, ch) => {
    const open = chapterOpen(ch);
    const lv = levelsIn(ch);
    const el = document.createElement('div');
    el.className = `chapter${open ? '' : ' locked'}`;
    el.style.setProperty('--h1', c.hue[0]); el.style.setProperty('--h2', c.hue[1]);
    const stars = lv.reduce((a, l) => a + (save.stars[l.id] || 0), 0);
    el.innerHTML = `<header><span class="ic">${c.icon}</span><span><b>${c.name}</b><small>${c.sub}</small></span><span class="cs">${open ? `★ ${stars}/${lv.length * 3}` : '🔒'}</span></header>`
      + (open ? '' : `<p class="lock-note">Finish 3 levels of “${CHAPTERS[ch - 1].name}” to unlock</p>`);
    const grid = document.createElement('div'); grid.className = 'lv-grid';
    for (const l of lv) {
      const b = document.createElement('button');
      const s = save.stars[l.id] || 0;
      b.className = `lv${s ? ' done' : ''}${l === current ? ' current' : ''}`;
      b.disabled = !isUnlocked(l);
      b.innerHTML = `${l.num}<small>${s ? '★'.repeat(s) + '☆'.repeat(3 - s) : b.disabled ? '🔒' : '☆☆☆'}</small>${l.n !== 3 ? `<span class="sz">${l.n}×${l.n}</span>` : ''}`;
      b.title = l.name;
      b.addEventListener('click', () => { sound.unlock(); sound.click(true); openIntro(l); });
      grid.appendChild(b);
    }
    el.appendChild(grid);
    list.appendChild(el);
  });
  showScreen('levels');
  const cur = list.querySelector('.current');
  if (cur) cur.scrollIntoView({ block: 'center' });
}

function openIntro(l) {
  S.mode = 'menu';
  $('hud').classList.add('hidden');
  const c = CHAPTERS[l.ch];
  setAccent(...c.hue);
  if (!ensureCube(l.n)) { dropAnim(); state = puzzle.solved(); recolor(); }
  showFaceLabels(null); showPreview(null);
  enterTitleLook(false, true);
  $('introKicker').textContent = `${c.name} · Level ${l.num}`;
  $('introName').textContent = l.name;
  $('introGoal').textContent = l.kind === 'pattern' ? '🎨 Twist the cube to match the target pattern.' : l.full ? '🎯 Solve a fully scrambled cube.' : `🎯 Watch the ${l.setup.length}-move scramble, then undo it.`;
  const rules = [`⭐ Par ${l.par} move${l.par === 1 ? '' : 's'}`, `🧊 ${l.n}×${l.n}`];
  if (l.time) rules.push(`⏱️ ${l.time} seconds`);
  if (l.faces) rules.push(`🔒 Only ${l.faces.join(', ')} turn`);
  $('introRules').innerHTML = rules.map((r) => `<span>${r}</span>`).join('');
  $('introTip').textContent = l.tip;
  $('introGo').onclick = () => { sound.unlock(); startLevel(l, true); };
  showScreen('intro');
}

let startToken = 0;
function startLevel(l, fromIntro) {
  closeScreens();
  dropAnim();
  const token = ++startToken;
  ensureCube(l.n);
  setAccent(...CHAPTERS[l.ch].hue);
  enterTitleLook(false);
  Object.assign(S, {
    mode: 'level', level: l, history: [], redo: [], trail: [], hintUsed: false, busy: false, won: false, failed: false,
    paused: false, assisted: false, armed: false, variants: null
  });
  timerReset(); lastTick = -1;
  state = puzzle.solved(); recolor(); clearHint();
  viewAnim = { from: cubeGroup.quaternion.clone(), to: HOME_Q.clone(), t: 0 };
  S.variants = l.kind === 'pattern' ? puzzle.variants(puzzle.applyAll(puzzle.solved(), l.target)) : null;
  showPreview(l.kind === 'pattern' ? puzzle.applyAll(puzzle.solved(), l.target) : null);
  showFaceLabels(l.faces);
  if (l.faces) {
    $('lockInfo').innerHTML = `Only ${l.faces.map((f) => `<b>${f}</b>`).join('')} turn`;
    $('lockInfo').classList.remove('hidden');
  } else $('lockInfo').classList.add('hidden');
  $('hudSub').textContent = `${CHAPTERS[l.ch].name} · ${l.num}`;
  $('hudName').textContent = l.name;
  $('timePill').classList.remove('hidden');
  $('hud').classList.remove('hidden');
  buildPad();
  if (l.setup.length) {
    S.busy = true;
    const watch = l.setup.length <= 8 && !l.full;
    const dur = watch ? 420 : clamp(2400 / l.setup.length, 30, 90);
    setTimeout(() => {
      if (token !== startToken || S.mode !== 'level') return;
      for (const m of l.setup) enqueue(m, 'setup', dur, watch ? easeInOut : easeInOut);
    }, watch ? 500 : 250);
    if (watch) toast('👀 Watch the scramble…', 1800);
  } else {
    toast(l.tip || 'Match the target cube!', l.tip ? 5200 : 2400);
  }
  updateHud(); updateTimer();
}

function openSizes() {
  if (S.mode === 'sandbox' || S.mode === 'level') { S.paused = true; timerStop(); }
  const grid = $('sizeGrid'); grid.innerHTML = '';
  const cols = THEMES[save.theme].colors.map((c) => `#${c.toString(16).padStart(6, '0')}`);
  for (let n = 2; n <= 7; n++) {
    const b = document.createElement('button');
    b.className = n === (S.mode === 'sandbox' ? puzzle.n : save.sandboxN) ? 'on' : '';
    const cells = Array.from({ length: n * n }, (_, i) => `<i style="background:${cols[[2, 2, 2, 4, 0][(i * 7 + n) % 5]]}"></i>`).join('');
    b.innerHTML = `<span class="mini-grid" style="grid-template-columns:repeat(${n},1fr)">${cells}</span><b>${n}×${n}</b><small>${save.best[n] ? `Best ${fmtTime(save.best[n], true)}` : SIZE_NAMES[n]}</small>`;
    b.addEventListener('click', () => { sound.unlock(); enterSandbox(n); });
    grid.appendChild(b);
  }
  showScreen('sizes');
}
$('sizesBack').addEventListener('click', () => {
  if (S.mode === 'sandbox' || S.mode === 'level') resume(); else showTitle();
});

function enterSandbox(n) {
  if (S.mode === 'sandbox' && puzzle.n === n) { resume(); return; }
  closeScreens();
  dropAnim();
  save.sandboxN = n; persist();
  ensureCube(n);
  setAccent('#6af0c8', '#2a8cff');
  enterTitleLook(false);
  Object.assign(S, {
    mode: 'sandbox', level: null, history: [], redo: [], trail: [], hintUsed: false, busy: false, won: false, failed: false,
    paused: false, assisted: false, armed: false, variants: null
  });
  timerReset();
  state = puzzle.solved(); recolor();
  showPreview(null); showFaceLabels(null); $('lockInfo').classList.add('hidden');
  $('hudSub').textContent = 'Free sandbox';
  $('hudName').textContent = `${n}×${n} ${SIZE_NAMES[n]}`;
  $('hud').classList.remove('hidden');
  buildPad();
  updateHud(); updateTimer();
  toast('Tap <b>🔀 Shuffle</b> to mix it up — or just twist away.', 3200);
}

function pauseGame() {
  if (S.mode !== 'level' && S.mode !== 'sandbox') return;
  if (S.won || S.failed) return;
  S.paused = true; timerStop();
  $('pauseSandbox').textContent = S.mode === 'sandbox' ? '🧊 Change cube size' : '🔀 Sandbox';
  showScreen('pause');
}
function resume() {
  closeScreens();
  S.paused = false;
  if ((S.mode === 'level' && S.level.time && S.history.length) || (S.mode === 'sandbox' && S.armed && S.history.length)) timerStart();
}
$('resumeBtn').addEventListener('click', resume);
$('pauseLevels').addEventListener('click', () => openLevels());
$('pauseSandbox').addEventListener('click', () => openSizes());
$('pauseSettings').addEventListener('click', () => openSettings('pause'));
$('pauseTitle').addEventListener('click', () => showTitle());
$('levelsBack').addEventListener('click', () => showTitle());
$('introBack').addEventListener('click', () => openLevels());
$('levelsBtn').addEventListener('click', () => { sound.unlock(); sound.click(true); openLevels(); });
$('sandboxBtn').addEventListener('click', () => { sound.unlock(); sound.click(true); openSizes(); });
$('settingsBtn').addEventListener('click', () => { sound.unlock(); openSettings('title'); });

let settingsReturn = 'title';
function seg(id, options, current, onPick) {
  const el = $(id); el.innerHTML = '';
  for (const [val, label] of options) {
    const b = document.createElement('button');
    b.textContent = label; b.className = val === current ? 'on' : '';
    b.addEventListener('click', () => { onPick(val); for (const x of el.children) x.classList.toggle('on', x === b); sound.click(true); });
    el.appendChild(b);
  }
}
function openSettings(from) {
  settingsReturn = from;
  seg('segTheme', Object.entries(THEMES).map(([k, v]) => [k, v.label]), save.theme, (v) => { save.theme = v; applyTheme(); persist(); });
  seg('segSpeed', Object.entries(SPEEDS).map(([k, v]) => [k, v.label]), save.speed, (v) => { save.speed = v; persist(); });
  seg('segSound', [[true, 'On'], [false, 'Off']], save.sound, (v) => { save.sound = v; persist(); });
  seg('segTimer', [[true, 'On'], [false, 'Off']], save.timer, (v) => { save.timer = v; persist(); updateTimer(); });
  showScreen('settings');
}
$('settingsDone').addEventListener('click', () => { if (settingsReturn === 'pause') showScreen('pause'); else showTitle(); });

// ---------------------------------------------------------------- title / attract mode
let titleLook = true, attractTimer = 0;
function enterTitleLook(on, keepCube = false) {
  titleLook = on;
  if (!on && !keepCube) zoomTarget = 1;
}
function showTitle() {
  dropAnim();
  S.mode = 'title'; S.paused = false; S.won = false;
  if (!ensureCube(3)) { state = puzzle.solved(); recolor(); }
  S.trail = [];
  showPreview(null); showFaceLabels(null); clearHint();
  $('hud').classList.add('hidden');
  setAccent('#6af0c8', '#2a8cff');
  enterTitleLook(true);
  const best = save.best[3];
  $('titleStats').textContent = `★ ${totalStars()} / ${LEVELS.length * 3} stars${best ? ` · Best 3×3 ${fmtTime(best, true)}` : ''}`;
  showScreen('title');
}

document.addEventListener('visibilitychange', () => { if (document.hidden && playing()) pauseGame(); });

// ---------------------------------------------------------------- layout & loop
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function cameraDistance() {
  const fit = (camera.aspect < 1 ? 2.95 : 3.75) / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 1));
  return fit * zoom;
}

const titleCard = document.querySelector('.title-card');
const clock = new THREE.Clock();
let time = 0, firstFrame = true;
function frame() {
  requestAnimationFrame(frame);
  tick(Math.min(clock.getDelta(), 0.05));
  render();
}
function tick(dt) {
  time += dt;

  updateAnim(dt);

  // orbit inertia, title spin, celebration spin
  if (drag.kind !== 'orbit' && drag.kind !== 'multi' && (Math.abs(orbitVel.x) > 0.01 || Math.abs(orbitVel.y) > 0.01)) {
    rotateView(orbitVel.x, orbitVel.y);
    orbitVel.x *= 0.92; orbitVel.y *= 0.92;
  }
  if ((titleLook || S.mode === 'menu') && drag.kind !== 'orbit' && !viewAnim) cubeGroup.quaternion.premultiply(_q.setFromAxisAngle(AXES[1], dt * 0.35));
  if (spinBoost > 0.01) { cubeGroup.quaternion.premultiply(_q.setFromAxisAngle(AXES[1], dt * spinBoost)); spinBoost *= 1 - 2.2 * dt; }
  if (viewAnim) {
    viewAnim.t = Math.min(1, viewAnim.t + dt / 0.28);
    cubeGroup.quaternion.slerpQuaternions(viewAnim.from, viewAnim.to, easeOut(viewAnim.t));
    if (viewAnim.t >= 1) viewAnim = null;
  }

  // attract mode: random twists on the title screen
  if (S.mode === 'title' && openScreen() === null) {
    attractTimer -= dt;
    if (attractTimer <= 0 && idle()) {
      attractTimer = 0.9;
      if (S.trail.length >= 10) {
        for (const m of invert(simplify(S.trail))) enqueue(m, 'unwind', 140, easeInOut);
        S.trail = [];
        attractTimer = 3.2;
      } else {
        const m = puzzle.scramble(Math.random, 1)[0];
        enqueue(m, 'attract', 380, easeInOut);
      }
    }
  }

  // camera & float
  zoom += (zoomTarget - zoom) * Math.min(1, dt * 8);
  const dist = cameraDistance();
  camera.position.set(0, 0, firstFrame ? dist : camera.position.z + (dist - camera.position.z) * Math.min(1, dt * 5));
  let yTarget = S.mode === 'menu' ? 0 : -0.1, sTarget = 1;
  if (padOpen && camera.aspect < 1 && (S.mode === 'level' || S.mode === 'sandbox')) {
    // keep the cube clear of the turn pad on phones
    yTarget = camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.22;
    sTarget = 0.84;
  }
  if (titleLook) {
    // fit the cube into the free space above the title card
    const card = titleCard.getBoundingClientRect();
    const free = clamp((card.top - 8) / window.innerHeight, 0.22, 1);
    const halfH = camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    yTarget = (1 - free) * halfH;
    sTarget = Math.min(1, (free * halfH * 0.86) / 3.1);
  }
  const ease = firstFrame ? 1 : Math.min(1, dt * 4);
  firstFrame = false;
  root.position.y += (yTarget + Math.sin(time * 1.3) * 0.07 * sTarget - root.position.y) * ease;
  root.scale.setScalar(root.scale.x + (sTarget - root.scale.x) * ease);
  ring.rotation.z += dt * 0.25; ring2.rotation.z -= dt * 0.4;
  ringMat.opacity = 0.55 + 0.2 * Math.sin(time * 2);
  sparks.rotation.y += dt * 0.02;

  if (previewOn) { previewSpin += dt * 0.45; pAngle += (previewFlip + previewSpin - pAngle) * Math.min(1, dt * 6); }
  updateHint(time);
  updateConfetti(dt);
  updateTimer();
}

function render() {
  // render main scene, then the target preview inside its frame
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  if (previewOn && S.mode === 'level' && !openScreen()) {
    const r = $('preview').getBoundingClientRect();
    pGroup.rotation.y = pAngle;
    pCamera.aspect = r.width / r.height; pCamera.updateProjectionMatrix();
    const y = window.innerHeight - r.bottom;
    renderer.setScissorTest(true);
    renderer.setScissor(r.left, y, r.width, r.height);
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setClearColor(0x0d0a22, 0.45);
    renderer.render(pScene, pCamera);
    renderer.setScissorTest(false);
  }
}

showTitle();
frame();

// debug/test hook
window.cubeLab = { get state() { return state; }, get puzzle() { return puzzle; }, S, root, camera, cubeGroup, LEVELS, startLevel, enterSandbox, flushAnim,
  step(sec = 1) { for (let i = 0; i < sec * 60; i++) tick(1 / 60); render(); } };
