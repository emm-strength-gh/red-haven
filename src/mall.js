// Little Cup Plaza — grow a little café into a whole shopping mall (three.js).
import * as THREE from 'three';
import * as L from './mall-logic.js';
import { buildUnit, buildDecor, Crowd, Traffic, LitterLayer, mat, glow, box, cyl, mesh, WALL_H, STAFF_SHIRT, buildTree } from './mall-models.js';
import { createUI } from './mall-ui.js';

const $ = (id) => document.getElementById(id);
const rng = Math.random;
const { W, D, T, idx, clamp } = L;
const tx = (i) => i % W, tz = (i) => (i / W) | 0;
export const money = (n) => (n === Infinity ? '∞' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'));

// ================================================================ save data
const SAVE_KEY = 'little-cup-plaza-v1';
let save = { sound: true, music: true, hints: true, slots: {} };
try {
  const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (raw && raw.slots) save = { ...save, ...raw };
} catch { /* storage unavailable */ }
const persist = () => {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save, (k, v) => (k[0] === '_' ? undefined : v))); } catch { /* ignore */ }
};

const freshToday = () => ({ visitors: 0, revenue: 0, rent: 0, costs: { stock: 0, wages: 0, upkeep: 0, interest: 0, marketing: 0, build: 0, events: 0 }, satSum: 0, satCount: 0, units: {}, complaints: {}, wishes: {}, lost: 0, caught: 0, stolen: 0, cars: 0, events: 0 });
function newState(diff) {
  const sandbox = diff === 'sandbox';
  return {
    v: 1, diff, sandbox, cash: sandbox ? 0 : L.DIFFICULTY[diff].cash, loan: 0,
    day: 1, time: 8 * 60 + 30, phase: 'night',
    world: L.starterWorld(),
    research: { done: sandbox ? Object.keys(L.RESEARCH) : [], current: null, progress: 0 },
    staff: { janitor: 1, security: 0, technician: 0 },
    score: 36, avgSat: 66, marketing: 0, wageMul: 1, mods: [],
    goalsDone: [], stats: { bestDayVisitors: 0, bestProfit: null, cleanDay: false, totalVisitors: 0 },
    history: [], today: freshToday(), tips: [], started: Date.now()
  };
}
let S = null; // current mall state (lives inside save.slots[diff])

// ================================================================ sound: bright mall chimes + soft elevator jazz
class Sound {
  constructor() { this.ctx = null; this.musicT = 0; this.bar = 0; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.45;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    this.musicBus.connect(lp); lp.connect(this.master);
  }
  tone(freq, dur, type = 'sine', vol = 0.15, when = 0, slide = 0, bus = null) {
    if (!this.ctx || !save.sound) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), gn = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(bus || this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, freq, vol = 0.05) {
    if (!this.ctx || !save.sound) return;
    const n = (this.ctx.sampleRate * dur) | 0, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), gn = this.ctx.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; gn.gain.value = vol;
    src.connect(f); f.connect(gn); gn.connect(this.master); src.start();
  }
  play(name) {
    switch (name) {
      case 'chime': [784, 988, 1175].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.09, i * 0.12)); break;
      case 'coin': this.tone(988, 0.08, 'square', 0.04); this.tone(1319, 0.2, 'square', 0.04, 0.07); break;
      case 'build': this.noise(0.18, 500, 0.12); this.tone(220, 0.12, 'triangle', 0.1, 0.02); break;
      case 'place': this.tone(392, 0.1, 'triangle', 0.14); this.tone(587, 0.18, 'triangle', 0.12, 0.08); break;
      case 'tap': this.tone(700, 0.05, 'triangle', 0.08); break;
      case 'err': this.tone(196, 0.2, 'sawtooth', 0.05); break;
      case 'alert': this.tone(880, 0.14, 'square', 0.05); this.tone(660, 0.2, 'square', 0.05, 0.16); break;
      case 'good': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.09, i * 0.08)); break;
      case 'demolish': this.noise(0.4, 300, 0.16); break;
      case 'research': [659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.35, 'sine', 0.08, i * 0.07)); break;
      default: break;
    }
  }
  // gentle ii–V–I elevator jazz with a lazy vibraphone line
  updateMusic(dt) {
    if (!this.ctx || !save.sound || !save.music) return;
    this.musicT -= dt;
    if (this.musicT > 0) return;
    this.musicT = 2.6;
    const prog = [[293.7, 349.2, 440, 523.3], [196, 246.9, 349.2, 440], [261.6, 329.6, 392, 493.9], [220, 277.2, 329.6, 392]];
    const ch = prog[this.bar++ % 4];
    this.tone(ch[0] / 2, 1.2, 'sine', 0.05, 0, 0, this.musicBus);
    this.tone(ch[0] / 2 * 1.5, 1.0, 'sine', 0.035, 1.3, 0, this.musicBus);
    ch.slice(1).forEach((f, i) => this.tone(f, 2.4, 'triangle', 0.014, 0.02 * i, 0, this.musicBus));
    const scale = [523.3, 587.3, 659.3, 784, 880, 987.8];
    for (let b = 0; b < 4; b++) if (Math.random() < 0.5) this.tone(scale[(Math.random() * 6) | 0], 0.5, 'sine', 0.028, b * 0.65 + (Math.random() < 0.4 ? 0.32 : 0), 0, this.musicBus);
  }
}
const sfx = new Sound();
window.addEventListener('pointerdown', () => sfx.unlock(), { passive: true });
window.addEventListener('keydown', () => sfx.unlock());

// ================================================================ three.js setup
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY_DAY = new THREE.Color('#bfe0d8'), SKY_DUSK = new THREE.Color('#f2b38a'), SKY_NIGHT = new THREE.Color('#25304a');
scene.background = SKY_DAY.clone();
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
const hemi = new THREE.HemisphereLight('#fff6e6', '#6f8a6a', 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0d6', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 120;
scene.add(sun, sun.target);

const worldGroup = new THREE.Group(), wallGroup = new THREE.Group(), unitGroup = new THREE.Group(), decorGroup = new THREE.Group(), fxGroup = new THREE.Group(), sceneryGroup = new THREE.Group();
scene.add(worldGroup, wallGroup, unitGroup, decorGroup, fxGroup, sceneryGroup);
const crowd = new Crowd(scene, 1800);
const traffic = new Traffic(scene, 400);
const litterLayer = new LitterLayer(scene, 900);

// camera: orthographic isometric with 90° view rotation
const cam = { target: new THREE.Vector3(W / 2, 0, D / 2), yawIdx: 0, yaw: Math.PI / 4, yawGoal: Math.PI / 4, pitch: 0.66, viewH: 26 };
function applyCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const dir = new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
  camera.position.copy(cam.target).addScaledVector(dir, 100);
  camera.lookAt(cam.target);
  const h = cam.viewH;
  camera.left = (-h * aspect) / 2; camera.right = (h * aspect) / 2; camera.top = h / 2; camera.bottom = -h / 2;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  sun.position.copy(cam.target).add(new THREE.Vector3(-14, 30, 10));
  sun.target.position.copy(cam.target);
}
function fitCamera() {
  // frame the built area (or the whole plot) in the free space between panels
  let x0 = W, x1 = 0, z0 = D, z1 = 0;
  S.world.kind.forEach((k, i) => { if (k === T.FLOOR || k === T.PARKING || k === T.PATH) { x0 = Math.min(x0, tx(i)); x1 = Math.max(x1, tx(i) + 1); z0 = Math.min(z0, tz(i)); z1 = Math.max(z1, tz(i) + 1); } });
  if (x1 <= x0) { x0 = 0; x1 = W; z0 = 0; z1 = D; }
  x0 -= 3; x1 += 3; z0 -= 3; z1 = Math.min(D, z1 + 3);
  cam.target.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const span = Math.max(x1 - x0, z1 - z0);
  const mobile = window.innerWidth < 760;
  cam.viewH = clamp(span * (mobile ? 1.15 : 0.8), 8, 44);
  applyCamera();
}
window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); applyCamera(); });

// ================================================================ runtime (not saved)
const R = {
  screen: 'title', speed: 1, modal: false, tool: null, toolArg: null, rot: 0, hover: -1,
  nav: null, navV: 0, fields: new Map(), reach: new Map(), parking: [], parkParent: null, spaces: new Set(), access: [],
  shoppers: [], cars: [], staffAgents: [], litter: [], litterCount: new Uint16Array(W * D), comfortMap: new Float32Array(W * D), binMap: new Uint8Array(W * D),
  puddles: new Map(), spawnAcc: 0, busT: 20, trafficT: 0, nextAgent: 1, eventsToday: 0, selected: null, unitMeshes: new Map(), decorMeshes: new Map(), walls: [],
  attraction: 0, closingFor: 0, saveT: 0
};

const ui = createUI({
  get S() { return S; }, get R() { return R; }, L, money, save, persist, sfx,
  act: {}
});
const A = ui.api.act; // actions are attached below

// ================================================================ helpers
const def = (u) => L.UNITS[u.type];
const nowAbs = () => S.day * 1440 + S.time;
const done = (id) => S.research.done.includes(id);
const costMul = () => L.DIFFICULTY[S.diff].costMul;
const pick = () => L.DIFFICULTY[S.diff].pickiness;
const stars = () => L.ratingStars(S.score);
const canAfford = (c) => S.sandbox || S.cash >= c;
function spend(c, cat = 'build') {
  if (S.sandbox) return true;
  if (S.cash < c) { ui.toast(`Not enough money — need ${money(c)}.`, 'bad'); sfx.play('err'); return false; }
  S.cash -= c;
  S.today.costs[cat] = (S.today.costs[cat] || 0) + c;
  return true;
}
function earn(n) { if (!S.sandbox) S.cash += n; }
const unitById = (id) => S.world.units.find((u) => u.id === id);
const tileCenter = (i) => ({ x: tx(i) + 0.5, z: tz(i) + 0.5 });
function modMul(type) { let m = 1; const t = nowAbs(); for (const md of S.mods) if (md.type === type && md.until > t) m *= md.mul; return m; }
const modActive = (type) => S.mods.some((m) => m.type === type && m.until > nowAbs());
function addMod(type, mul, minutes, extra = {}) { S.mods.push({ type, mul, until: nowAbs() + minutes, ...extra }); }
const NAMES = ['Ava', 'Ben', 'Cleo', 'Dev', 'Ezra', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sami', 'Tess', 'Uma', 'Vic', 'Wren', 'Yara', 'Zed', 'Ari', 'Bea', 'Cal', 'Dot', 'Eli'];

// ================================================================ nav & derived maps
function rebuildNav() {
  R.navV++;
  R.fields.clear();
  R.nav = L.makeNav(S.world, new Set(R.puddles.keys()));
  R.reach = L.reachability(S.world, R.nav);
  // parking network + parent pointers toward the sidewalk access tiles
  R.parking = L.parkingNetwork(S.world);
  const pset = new Set(R.parking);
  R.parkParent = new Int32Array(W * D).fill(-2);
  R.access = [];
  const q = [];
  for (const i of R.parking) if (tz(i) === L.SIDEWALK_Z - 1) { R.parkParent[i] = -1; q.push(i); R.access.push(i); }
  for (let h = 0; h < q.length; h++) for (const n of L.neighbors(q[h])) if (pset.has(n) && R.parkParent[n] === -2) { R.parkParent[n] = q[h]; q.push(n); }
  for (const s of [...R.spaces]) if (!pset.has(s)) R.spaces.delete(s);
  // comfort & bin coverage
  R.comfortMap.fill(0); R.binMap.fill(0);
  for (const d of S.world.decor) {
    const dd = L.DECOR[d.type];
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const x = d.x + dx, z = d.z + dz;
      if (!L.inBounds(x, z)) continue;
      const m = Math.abs(dx) + Math.abs(dz);
      if (dd.comfort && m <= 3) R.comfortMap[idx(x, z)] += dd.comfort * (1 - m / 4);
      if (dd.bin && Math.max(Math.abs(dx), Math.abs(dz)) <= 4) R.binMap[idx(x, z)] = 1;
    }
  }
  // relocate anything standing on a tile that is no longer walkable
  for (const a of [...R.shoppers, ...R.staffAgents]) {
    if (a.hidden || R.nav.walk[a.tile]) continue;
    const n = nearestWalkable(a.tile);
    if (n < 0) { a.dead = true; continue; }
    a.tile = n; a.next = -1; const c = tileCenter(n); a.x = c.x + a.ox; a.z = c.z + a.oz;
  }
  // drop litter that got built over
  R.litter = R.litter.filter((l) => R.nav.walk[l.tile]);
  recountLitter();
  computeAttraction();
}
function nearestWalkable(start) {
  const seen = new Set([start]); const q = [start];
  for (let h = 0; h < q.length && h < 400; h++) {
    if (R.nav.walk[q[h]]) return q[h];
    for (const n of L.neighbors(q[h])) if (!seen.has(n)) { seen.add(n); q.push(n); }
  }
  return -1;
}
function getField(key, goals) {
  let f = R.fields.get(key);
  if (!f) {
    if (R.fields.size > 260) for (const k of [...R.fields.keys()].slice(0, 120)) R.fields.delete(k);
    f = L.flowField(R.nav, goals);
    R.fields.set(key, f);
  }
  return f;
}
const exitField = () => getField('exit', L.spawnTiles());
const frontTile = (u) => { const { front } = L.doorOf(u); return idx(front.x, front.z); };
const unitField = (u) => getField('u' + u.id, [frontTile(u)]);
function benchGoals() {
  const out = [];
  for (const d of S.world.decor) if (L.DECOR[d.type].seat) for (const n of L.neighbors(idx(d.x, d.z))) if (R.nav.walk[n] && R.nav.indoor(n) === (S.world.kind[idx(d.x, d.z)] === T.FLOOR)) out.push(n);
  return out;
}
function recountLitter() { R.litterCount.fill(0); for (const l of R.litter) R.litterCount[l.tile]++; }

const isShop = (u) => !def(u).service;
function capacity(u) {
  const d = def(u);
  if (d.service) return d.cap * u.level;
  if (u.lease) return d.cap * d.staff * (1 + (u.level - 1) * 0.35);
  return L.unitCapacity(u, d, done('fasttills'));
}
function unitOpenState(u) {
  const d = def(u);
  if (!R.reach.get(u.id)) return { ok: false, why: 'unreachable', icon: '🚫', text: 'No way in for shoppers' };
  if (u.broken) return { ok: false, why: 'broken', icon: '🔧', text: 'Out of order' };
  if (!u.open) return { ok: false, why: 'closed', icon: '⛔', text: 'Closed by you' };
  if (!d.service && modActive('power')) return { ok: false, why: 'power', icon: '⚡', text: 'No power' };
  if (!d.service && !u.lease && u.staff <= 0) return { ok: false, why: 'staff', icon: '😴', text: 'No staff' };
  if (!d.service && !u.lease && u.stock <= 0) return { ok: true, warn: 'stock', icon: '📦', text: 'Sold out' };
  return { ok: true };
}
function computeAttraction() {
  let a = 0;
  for (const u of S.world.units) if (isShop(u) && unitOpenState(u).ok) a += def(u).attract * (1 + (u.level - 1) * 0.25);
  let comfort = 0;
  for (const d of S.world.decor) comfort += L.DECOR[d.type].comfort;
  R.attraction = a + comfort / 25;
  return R.attraction;
}

// ================================================================ ground texture & scenery
const PX = 32;
const groundCanvas = document.createElement('canvas');
groundCanvas.width = W * PX; groundCanvas.height = D * PX;
const gctx = groundCanvas.getContext('2d');
const groundTex = new THREE.CanvasTexture(groundCanvas);
groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = 8;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, D / 2); ground.receiveShadow = true;
worldGroup.add(ground);
const far = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#86b873', roughness: 1 }));
far.rotation.x = -Math.PI / 2; far.position.set(W / 2, -0.02, D / 2); far.receiveShadow = true;
worldGroup.add(far);
// road continues off-plot both ways, plus the far sidewalk
for (const [w, z, c] of [[400, D - 1, '#5b6168'], [400, D + 0.6, '#d9d4cc']]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, z === D - 1 ? 2 : 1.2), new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
  m.rotation.x = -Math.PI / 2; m.position.set(W / 2, -0.01, z); m.receiveShadow = true; worldGroup.add(m);
}
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function drawGround() {
  const k = S.world.kind, g = gctx;
  const ent = new Set(S.world.entrances);
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const i = idx(x, z), px = x * PX, pz = z * PX, t = k[i];
    switch (t) {
      case T.GRASS: {
        g.fillStyle = hash(x, z) > 0.5 ? '#8cc078' : '#88bb73'; g.fillRect(px, pz, PX, PX);
        g.fillStyle = 'rgba(60,110,50,.25)';
        for (let s = 0; s < 3; s++) g.fillRect(px + hash(x + s, z) * 28, pz + hash(x, z + s) * 28, 3, 2);
        break;
      }
      case T.ROAD: {
        g.fillStyle = '#5b6168'; g.fillRect(px, pz, PX, PX);
        if (z === L.ROAD_Z[0]) { g.fillStyle = '#f4cf6b'; if (x % 2 === 0) g.fillRect(px + 4, pz + PX - 2, PX - 8, 3); }
        break;
      }
      case T.SIDEWALK: {
        g.fillStyle = '#dcd6cc'; g.fillRect(px, pz, PX, PX);
        g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 1; g.strokeRect(px + 0.5, pz + 0.5, PX - 1, PX - 1);
        g.fillStyle = '#b9b2a6'; g.fillRect(px, pz + PX - 3, PX, 3);
        break;
      }
      case T.PATH: {
        g.fillStyle = '#dcbf95'; g.fillRect(px, pz, PX, PX);
        g.strokeStyle = 'rgba(120,80,40,.18)'; g.lineWidth = 1;
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) g.strokeRect(px + a * 16 + 0.5 + (b % 2) * 4, pz + b * 16 + 0.5, 15, 15);
        break;
      }
      case T.PARKING: {
        g.fillStyle = '#737c82'; g.fillRect(px, pz, PX, PX);
        g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(px, pz + 4, 2, PX - 8);
        if (x === W - 1 || k[i + 1] !== T.PARKING) g.fillRect(px + PX - 2, pz + 4, 2, PX - 8);
        g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(px + 8, pz + 10, 16, 12);
        break;
      }
      case T.FLOOR: {
        const chk = (x + z) % 2 === 0;
        g.fillStyle = chk ? '#f5efe4' : '#ebe2d3'; g.fillRect(px, pz, PX, PX);
        g.strokeStyle = 'rgba(120,100,80,.12)'; g.lineWidth = 1; g.strokeRect(px + 0.5, pz + 0.5, PX - 1, PX - 1);
        if (ent.has(i)) { g.fillStyle = '#c9705b'; g.fillRect(px + 3, pz + 3, PX - 6, PX - 6); g.fillStyle = 'rgba(255,255,255,.25)'; for (let s = 0; s < 4; s++) g.fillRect(px + 6, pz + 7 + s * 5, PX - 12, 2); }
        break;
      }
      default: break;
    }
  }
  groundTex.needsUpdate = true;
}
function buildScenery() {
  // far side of the road: a row of trees, lamps and a bus shelter
  sceneryGroup.clear();
  for (let x = -20; x < W + 20; x += 3) {
    const t = buildTree(() => hash(x, 3), hash(x, 9) > 0.7 ? 'pine' : 'round'); t.scale.setScalar(0.85); t.position.set(x + 0.5, 0, D + 2.2); sceneryGroup.add(t);
  }
  for (let x = -18; x < W + 18; x += 6) {
    const lamp = buildDecor('lamp'); lamp.position.set(x, 0, D + 0.8); sceneryGroup.add(lamp);
  }
  // bus stop sign on our sidewalk
  const stop = new THREE.Group(); stop.position.set(W / 2 + 0.5, 0, L.SIDEWALK_Z + 0.85);
  mesh(cyl(0.03, 0.03, 1.3, 6), mat('#3c3f46'), 0, 0.65, 0, stop);
  mesh(box(0.34, 0.34, 0.04), mat('#5a86c5'), 0, 1.3, 0, stop);
  mesh(box(0.2, 0.1, 0.045), mat('#fffaf0'), 0, 1.32, 0, stop);
  stop.visible = false; R.busStop = stop;
  sceneryGroup.add(stop);
}

// ================================================================ walls & units & décor meshes
const wallMat = mat('#f1e3cf', { roughness: 0.85 }), wallTop = mat('#c9705b', { roughness: 0.6 }), glassMat = mat('#cfeeff', { transparent: true, opacity: 0.3, roughness: 0.05 });
function rebuildWalls() {
  wallGroup.clear(); R.walls = [];
  const k = S.world.kind, ent = new Set(S.world.entrances);
  const outdoorWalk = (i) => [T.PATH, T.PARKING, T.SIDEWALK].includes(k[i]);
  for (let i = 0; i < W * D; i++) {
    if (k[i] !== T.FLOOR) continue;
    const x = tx(i), z = tz(i);
    for (const [dx, dz] of L.DIR4) {
      const nx = x + dx, nz = z + dz;
      const n = L.inBounds(nx, nz) ? idx(nx, nz) : -1;
      if (n >= 0 && k[n] === T.FLOOR) continue;
      const along = dx === 0; // wall runs along x when the neighbour is in z
      const cx = x + 0.5 + dx * 0.5, cz = z + 0.5 + dz * 0.5;
      const seg = new THREE.Group(); seg.position.set(cx, 0, cz);
      if (ent.has(i) && n >= 0 && outdoorWalk(n)) {
        // entrance: frame + glass doors + canopy
        for (const s of [-0.46, 0.46]) mesh(box(along ? 0.08 : 0.14, WALL_H, along ? 0.14 : 0.08), wallTop, along ? s : 0, WALL_H / 2, along ? 0 : s, seg);
        mesh(box(along ? 1 : 0.16, 0.22, along ? 0.16 : 1), wallTop, 0, WALL_H - 0.11, 0, seg);
        const dl = mesh(box(along ? 0.4 : 0.03, WALL_H - 0.3, along ? 0.03 : 0.4), glassMat, along ? -0.22 : 0, (WALL_H - 0.3) / 2, along ? 0 : -0.22, seg); dl.castShadow = false;
        const dr = mesh(box(along ? 0.4 : 0.03, WALL_H - 0.3, along ? 0.03 : 0.4), glassMat, along ? 0.22 : 0, (WALL_H - 0.3) / 2, along ? 0 : 0.22, seg); dr.castShadow = false;
        const can = mesh(box(along ? 1.1 : 0.6, 0.06, along ? 0.6 : 1.1), mat('#c9705b'), dx * 0.3, WALL_H + 0.02, dz * 0.3, seg);
        seg.userData = { door: true, dl, dr, along, open: 0 };
        R.walls.push({ g: seg, nx: dx, nz: dz, door: true, tile: i });
      } else {
        const wm = mesh(box(along ? 1.02 : 0.14, WALL_H, along ? 0.14 : 1.02), wallMat, 0, WALL_H / 2, 0, seg);
        const top = mesh(box(along ? 1.04 : 0.18, 0.08, along ? 0.18 : 1.04), wallTop, 0, WALL_H, 0, seg);
        // a band of windows on the outer face
        const win = mesh(box(along ? 0.7 : 0.02, 0.32, along ? 0.02 : 0.7), mat('#9fd0e6', { roughness: 0.2, emissive: '#2a4a5a', emissiveIntensity: 0.15 }), dx * 0.08, WALL_H * 0.62, dz * 0.08, seg); win.castShadow = false;
        R.walls.push({ g: seg, nx: dx, nz: dz, wm, top, win });
      }
      wallGroup.add(seg);
    }
  }
  applyCutaway();
}
// walls whose outside faces the camera drop to a low kerb so you can see in
function applyCutaway() {
  const cx = Math.sin(cam.yaw), cz = Math.cos(cam.yaw);
  for (const w of R.walls) {
    if (w.door) continue;
    const facing = w.nx * cx + w.nz * cz > 0.2;
    const h = facing ? 0.22 : 1;
    w.wm.scale.y = h; w.wm.position.y = (WALL_H * h) / 2;
    w.top.position.y = WALL_H * h; w.win.visible = !facing;
  }
  for (const [, g] of R.unitMeshes) {
    const { back, left, right } = g.userData;
    const ry = g.children[0].rotation.y;
    for (const [m, lx, lz] of [[back, 0, -1], [left, -1, 0], [right, 1, 0]]) {
      const nx = lx * Math.cos(ry) + lz * Math.sin(ry), nz = -lx * Math.sin(ry) + lz * Math.cos(ry);
      const facing = nx * cx + nz * cz > 0.2;
      m.scale.y = facing ? 0.2 : 1; m.position.y = (WALL_H * m.scale.y) / 2;
    }
  }
}
function syncUnits() {
  const ids = new Set(S.world.units.map((u) => u.id));
  for (const [id, g] of R.unitMeshes) if (!ids.has(id) || g.userData.level !== unitById(id).level) { unitGroup.remove(g); R.unitMeshes.delete(id); }
  for (const u of S.world.units) {
    if (R.unitMeshes.has(u.id)) continue;
    const g = buildUnit(u);
    g.userData.level = u.level;
    if (u.level > 1) { const star = mesh(box(0.3, 0.06, 0.3), glow('#ffd34d', 0.8), 0, WALL_H + 0.62, 0, g); star.rotation.y = Math.PI / 4; }
    unitGroup.add(g); R.unitMeshes.set(u.id, g);
  }
  applyCutaway();
}
function syncDecor() {
  const ids = new Set(S.world.decor.map((d) => d.id));
  for (const [id, g] of R.decorMeshes) if (!ids.has(id)) { decorGroup.remove(g); R.decorMeshes.delete(id); }
  for (const d of S.world.decor) {
    if (R.decorMeshes.has(d.id)) continue;
    const g = buildDecor(d.type);
    g.position.set(d.x + 0.5, 0, d.z + 0.5);
    g.rotation.y = (d.rot || 0) * (Math.PI / 2);
    g.traverse((o) => { o.userData.decorId = d.id; });
    decorGroup.add(g); R.decorMeshes.set(d.id, g);
  }
}
const puddleMat = mat('#7fc4e8', { transparent: true, opacity: 0.75, roughness: 0.05 });
function syncPuddles() {
  for (const [i, p] of R.puddles) if (!p.mesh) {
    const g = new THREE.Group(); g.position.set(tx(i) + 0.5, 0.02, tz(i) + 0.5);
    const m = mesh(cyl(0.42, 0.42, 0.02, 16), puddleMat, 0, 0, 0, g); m.scale.z = 0.7; m.castShadow = false;
    const cone = new THREE.Group(); mesh(box(0.2, 0.3, 0.02), mat('#ffd34d'), 0, 0.15, 0, cone); cone.rotation.x = -0.25; cone.position.set(0.25, 0, -0.2); g.add(cone);
    fxGroup.add(g); p.mesh = g;
  }
}
function removePuddle(i) {
  const p = R.puddles.get(i);
  if (!p) return;
  if (p.mesh) fxGroup.remove(p.mesh);
  R.puddles.delete(i);
  rebuildNav();
}
function worldChanged({ ground: g = true, walls = true } = {}) {
  rebuildNav();
  if (g) drawGround();
  if (walls) rebuildWalls();
  syncUnits(); syncDecor(); syncPuddles();
  ui.refresh();
  queueSave();
}
function queueSave() { R.saveT = 2; }

// ================================================================ arrivals
function existingShopTypes() { const s = new Set(); for (const u of S.world.units) if (isShop(u)) s.add(u.type); return s; }
function newShopper(tile, mode, car = null) {
  const c = tileCenter(tile);
  const ox = (rng() - 0.5) * 0.5, oz = (rng() - 0.5) * 0.5;
  const thiefRate = 0.035 * modMul('thief') * (done('cctv') ? 0.5 : 1);
  const sh = {
    kind: 'shopper', id: R.nextAgent++, name: NAMES[(rng() * NAMES.length) | 0], look: crowd.look(rng), tile, next: -1, x: c.x + ox, z: c.z + oz, ox, oz, face: 0, bob: rng() * 6,
    state: 'decide', field: null, target: null, t: 0, mood: 62 + rng() * 16, budget: Math.round((25 + rng() * 110) * (1 + stars() * 0.08)), spent: 0,
    needs: { bladder: rng() * 45, hunger: rng() * 55, energy: 65 + rng() * 35 }, wishes: L.pickWishes(rng, existingShopTypes(), 2 + ((rng() * 3) | 0)),
    visited: [], thoughts: [], mode, car, thief: rng() < thiefRate, food: 0, arrived: S.time, recorded: false, stuck: 0
  };
  if (done('info') && S.world.decor.some((d) => d.type === 'info')) sh.mood += 3;
  R.shoppers.push(sh);
  S.today.visitors++; S.stats.totalVisitors++;
  return sh;
}
function spawnArrivals(gmin) {
  if (S.phase !== 'open' || S.time >= L.LAST_ENTRY * 60) return;
  const mk = [1, 1.15, 1.35, 1.6][S.marketing] * (done('marketing') ? 1.2 : 1);
  const rate = L.visitorsPerHour({ attraction: R.attraction, rating: stars(), marketing: mk, event: modMul('visitors'), curve: L.hourCurve(S.time / 60) });
  R.spawnAcc += (rate / 60) * gmin;
  while (R.spawnAcc >= 1) {
    if (R.shoppers.length > 1500) { R.spawnAcc = 0; break; }
    const party = 1 + (rng() < 0.4 ? 1 : 0) + (rng() < 0.15 ? 1 : 0);
    R.spawnAcc -= party;
    const wantsCar = R.parking.length > 0 && rng() < 0.68;
    if (wantsCar) {
      if (modActive('parking')) { S.today.lost += party; S.today.complaints.parking = (S.today.complaints.parking || 0) + 1; passingCar(); continue; }
      const space = pickSpace();
      if (space < 0) { S.today.lost += party; S.today.complaints.parking = (S.today.complaints.parking || 0) + 1; passingCar(); continue; }
      arriveByCar(space, party);
    } else {
      const sp = L.spawnTiles()[(rng() * 2) | 0];
      for (let p = 0; p < party; p++) newShopper(sp, 'foot');
    }
  }
}
function pickSpace() {
  const ef = getField('ent', S.world.entrances.length ? S.world.entrances : L.spawnTiles());
  let best = -1, bd = Infinity;
  for (const s of R.parking) {
    if (R.spaces.has(s) || R.parkParent[s] === -2) continue;
    const d = (ef[s] < 0 ? 999 : ef[s]) + rng() * 4;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// ================================================================ cars
const LANE_A = L.ROAD_Z[0] + 0.5, LANE_B = L.ROAD_Z[1] + 0.5;
function carTiles(space) { const out = []; let t = space; while (t >= 0) { out.push(t); t = R.parkParent[t]; } return out.reverse(); }
function arriveByCar(space, riders) {
  const tiles = carTiles(space);
  const ax = tx(tiles[0]) + 0.5;
  const fromLeft = rng() < 0.5;
  const pts = [{ x: fromLeft ? -3 : W + 3, z: fromLeft ? LANE_A : LANE_B }, { x: ax, z: fromLeft ? LANE_A : LANE_B }, { x: ax, z: L.SIDEWALK_Z + 0.5 }, ...tiles.map(tileCenter)];
  R.spaces.add(space);
  R.cars.push({ x: pts[0].x, z: pts[0].z, face: fromLeft ? Math.PI / 2 : -Math.PI / 2, color: traffic.color(rng), pts, pi: 1, state: 'arrive', space, riders, back: 0, wait: 0 });
  S.today.cars++;
  if (done('smartparking')) earn(2), (S.today.revenue += 2);
}
function passingCar(bus = false) {
  const right = rng() < 0.5;
  const z = right ? LANE_A : LANE_B;
  const pts = right ? [{ x: -3, z }, { x: W + 3, z }] : [{ x: W + 3, z }, { x: -3, z }];
  const car = { x: pts[0].x, z, face: right ? Math.PI / 2 : -Math.PI / 2, color: bus ? '#f4cf6b' : traffic.color(rng), pts, pi: 1, state: 'through', bus };
  R.cars.push(car);
  return car;
}
function sendBus() {
  const z = LANE_A;
  const stopX = W / 2 + 0.5;
  R.cars.push({ x: -4, z, face: Math.PI / 2, color: '#f4cf6b', pts: [{ x: -4, z }, { x: stopX, z }, { x: W + 4, z }], pi: 1, state: 'bus', bus: true, wait: 0, stopAt: 1 });
}
function departCar(c) {
  const tiles = carTiles(c.space).reverse();
  const ax = tx(tiles[tiles.length - 1]) + 0.5;
  const toRight = rng() < 0.5;
  const lane = toRight ? LANE_A : LANE_B;
  c.pts = [...tiles.map(tileCenter), { x: ax, z: L.SIDEWALK_Z + 0.5 }, { x: ax, z: lane }, { x: toRight ? W + 3 : -3, z: lane }];
  c.pi = 1; c.state = 'depart';
  R.spaces.delete(c.space);
}
function updateCars(sdt, gmin) {
  const speed = 3.2 * sdt;
  // ambient traffic + buses
  R.trafficT -= gmin;
  if (R.trafficT <= 0) { R.trafficT = 4 + rng() * 10; if (R.cars.length < 300) passingCar(); }
  if (done('bus') && S.phase === 'open' && S.time < L.LAST_ENTRY * 60) {
    R.busT -= gmin;
    if (R.busT <= 0) { R.busT = 40 + rng() * 15; sendBus(); }
  }
  for (const c of R.cars) {
    if (c.state === 'parked') {
      if (c.back >= c.riders) departCar(c);
      continue;
    }
    if (c.state === 'bus' && c.wait > 0) { c.wait -= gmin; if (c.wait <= 0) c.pi++; continue; }
    let dist = speed * (c.bus ? 0.8 : 1);
    while (dist > 0 && c.pi < c.pts.length) {
      const p = c.pts[c.pi], dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
      if (d > 1e-4) c.face = Math.atan2(dx, dz);
      if (d <= dist) {
        c.x = p.x; c.z = p.z; dist -= d;
        if (c.state === 'bus' && c.pi === c.stopAt) { c.wait = 6; c.stopAt = -1; busDropOff(); break; }
        c.pi++;
      } else { c.x += (dx / d) * dist; c.z += (dz / d) * dist; dist = 0; }
    }
    if (c.pi >= c.pts.length) {
      if (c.state === 'arrive') {
        c.state = 'parked';
        for (let r = 0; r < c.riders; r++) newShopper(c.space, 'car', c);
      } else c.dead = true;
    }
  }
  if (R.cars.some((c) => c.dead)) R.cars = R.cars.filter((c) => !c.dead);
}
function busDropOff() {
  if (S.phase !== 'open') return;
  const n = 3 + ((rng() * 6) | 0);
  const t = idx(Math.floor(W / 2), L.SIDEWALK_Z);
  for (let i = 0; i < n; i++) newShopper(t, 'bus');
}

// ================================================================ shoppers
function think(sh, text, moodDelta = 0, key = null) {
  if (text && sh.thoughts[0] !== text) { sh.thoughts.unshift(text); if (sh.thoughts.length > 5) sh.thoughts.pop(); }
  sh.mood = clamp(sh.mood + (moodDelta < 0 ? moodDelta * pick() : moodDelta), 0, 100);
  if (key) S.today.complaints[key] = (S.today.complaints[key] || 0) + 1;
}
function walkTo(a, field, target) { a.field = field; a.target = target; a.state = 'walk'; a.next = -1; a.stuck = 0; }
function nearestUnit(sh, list) {
  let best = null, bd = Infinity;
  for (const u of list) { const f = unitField(u); const d = f[sh.tile]; if (d >= 0 && d < bd) { bd = d; best = u; } }
  return best;
}
function decide(sh) {
  for (let guard = 0; guard < 6; guard++) {
    const late = S.phase !== 'open' || S.time - sh.arrived > 300;
    if (late || sh.mood < 15) return leave(sh, late ? null : 'I’ve had enough of this place.');
    const n = sh.needs;
    if (n.bladder > 72) {
      const t = S.world.units.filter((u) => def(u).service === 'toilet' && unitOpenState(u).ok);
      const u = nearestUnit(sh, t);
      if (u) return walkTo(sh, unitField(u), { kind: 'unit', id: u.id, need: 'bladder' });
      think(sh, L.THOUGHTS.toilet, -14, 'toilet'); n.bladder = 35; continue;
    }
    if (n.hunger > 78) {
      const f = S.world.units.filter((u) => def(u).cat === 'food' && unitOpenState(u).ok);
      const u = nearestUnit(sh, f);
      if (u) return walkTo(sh, unitField(u), { kind: 'unit', id: u.id, need: 'hunger' });
      think(sh, 'I’m starving and there’s nowhere to eat!', -8, 'food'); n.hunger = 45; continue;
    }
    if (n.energy < 22) {
      const goals = benchGoals();
      if (goals.length) { const f = getField('bench', goals); if (f[sh.tile] >= 0) return walkTo(sh, f, { kind: 'bench' }); }
      think(sh, L.THOUGHTS.tired, -7, 'seats'); n.energy = 50; continue;
    }
    if (sh.budget < 4) return leave(sh, 'Spent up — time to go home!');
    if (sh.wishes.length) {
      const w = sh.wishes.shift();
      const all = S.world.units.filter((u) => u.type === w);
      const name = L.UNITS[w].name;
      if (!all.length) { S.today.wishes[w] = (S.today.wishes[w] || 0) + 1; think(sh, L.THOUGHTS.noShop(name), -3); continue; }
      const open = all.filter((u) => unitOpenState(u).ok);
      if (!open.length) {
        const st = unitOpenState(all[0]);
        think(sh, st.why === 'broken' ? L.THOUGHTS.broken(name) : L.THOUGHTS.closed(name), -6, st.why === 'broken' ? 'broken' : 'closed');
        continue;
      }
      const u = nearestUnit(sh, open);
      if (!u) { think(sh, `I can’t find my way to the ${name}.`, -5, 'lost'); continue; }
      const pl = L.PRICE_LEVELS.find((p) => p.id === u.price);
      if (!u.lease && rng() > pl.demand) { think(sh, L.THOUGHTS.pricey(name), -2, 'pricey'); continue; }
      return walkTo(sh, unitField(u), { kind: 'unit', id: u.id });
    }
    // impulse browse
    if (sh.visited.length < 4 && rng() < 0.35) {
      const opts = S.world.units.filter((u) => isShop(u) && !sh.visited.includes(u.id) && unitOpenState(u).ok);
      if (opts.length) { const u = opts[(rng() * opts.length) | 0]; if (unitField(u)[sh.tile] >= 0) return walkTo(sh, unitField(u), { kind: 'unit', id: u.id }); }
    }
    return leave(sh, sh.visited.length ? null : 'There was nothing for me here.');
  }
  return leave(sh);
}
function recordSat(sh) {
  if (sh.recorded) return;
  sh.recorded = true;
  const s = L.satisfactionSample({ mood: sh.mood, pickiness: pick() });
  S.today.satSum += s; S.today.satCount++;
  S.avgSat = S.avgSat * 0.985 + s * 0.015;
}
function leave(sh, thought) {
  if (thought) think(sh, thought, 0);
  recordSat(sh);
  if (sh.car && !sh.car.dead) walkTo(sh, getField('space' + sh.car.space, [sh.car.space]), { kind: 'exit' });
  else walkTo(sh, exitField(), { kind: 'exit' });
  sh.leaving = true;
}
function tryEnter(sh, u) {
  const st = unitOpenState(u);
  const name = def(u).name;
  if (!st.ok) { think(sh, st.why === 'broken' ? L.THOUGHTS.broken(name) : L.THOUGHTS.closed(name), -6, st.why === 'broken' ? 'broken' : 'closed'); return decide(sh); }
  if ((u._in || 0) < capacity(u)) return enterUnit(sh, u);
  u._q = u._q || [];
  if (u._q.length < 8) { sh.state = 'queue'; sh.t = 0; sh.target = { kind: 'unit', id: u.id }; u._q.push(sh); return; }
  think(sh, L.THOUGHTS.crowded(name), -6, 'crowded');
  decide(sh);
}
function enterUnit(sh, u) {
  const d = def(u);
  u._in = (u._in || 0) + 1;
  sh.state = 'inside'; sh.hidden = true; sh.unit = u.id;
  sh.t = (d.service ? d.time : L.unitVisitMinutes(d, u, done('fasttills'))) * (0.7 + rng() * 0.6) * (modActive('slow') ? 1.4 : 1);
}
function finishUnit(sh, u) {
  u._in = Math.max(0, (u._in || 1) - 1);
  sh.hidden = false; sh.state = 'decide';
  const d = def(u);
  sh.visited.push(u.id);
  const ut = (S.today.units[u.id] = S.today.units[u.id] || { rev: 0, visits: 0, stolen: 0 });
  ut.visits++;
  u.cond = Math.max(0, (u.cond ?? 100) - (d.service ? 0.3 : 0.16));
  if (u.cond < 40 && rng() < (40 - u.cond) / 600) breakUnit(u);
  if (d.service === 'toilet') { sh.needs.bladder = 0; think(sh, null, 2); return; }
  sh.needs.energy -= 6;
  if (sh.thief && !u.lease) return shoplift(sh, u, ut);
  if (!u.lease && u.stock <= 0) { think(sh, L.THOUGHTS.stock(d.name), -9, 'stock'); return; }
  const pl = L.PRICE_LEVELS.find((p) => p.id === (u.lease ? 'standard' : u.price));
  let amt = L.purchase(rng, d, pl.mult * (1 + (u.level - 1) * 0.1), done('loyalty'), sh.mood);
  if (amt > sh.budget) amt = Math.max(0, Math.round(sh.budget * 0.8));
  if (amt <= 0) { think(sh, L.THOUGHTS.pricey(d.name), -3, 'pricey'); return; }
  sh.budget -= amt; sh.spent += amt;
  ut.rev += amt;
  if (!u.lease) {
    u.stock--;
    earn(amt);
    const cogs = amt * L.stockCostRatio * modMul('cogs');
    if (!S.sandbox) S.cash -= cogs;
    S.today.revenue += amt; S.today.costs.stock += cogs;
    if (rng() < 0.25) popup(frontTile(u), '+' + money(amt));
  }
  if (d.cat === 'food') { sh.needs.hunger = 0; sh.needs.bladder += 22; sh.food = 30; }
  const moodUp = 6 + (u.level - 1) * 2 + (u.lease ? 0 : pl.mood);
  think(sh, moodUp > 6 && rng() < 0.4 ? L.THOUGHTS.great(d.name) : null, moodUp);
}
function shoplift(sh, u, ut) {
  const d = def(u);
  const loss = Math.round(d.spend * 2);
  u.stock = Math.max(0, u.stock - 2);
  // guards nearby?
  const f = tileCenter(frontTile(u));
  const guards = R.staffAgents.filter((g) => g.kind === 'security' && Math.hypot(g.x - f.x, g.z - f.z) < 7).length;
  const chance = clamp(guards * 0.55 + (done('cctv') ? 0.25 : 0), 0, 0.92);
  if (rng() < chance) {
    S.today.caught++;
    popup(frontTile(u), '🛡️ Shoplifter caught!', 'big');
    sh.mood = 0; sh.thoughts.unshift('Busted…');
    leave(sh);
  } else {
    S.today.stolen += loss; ut.stolen += loss;
    if (!S.sandbox) S.cash -= loss * L.stockCostRatio;
    S.today.costs.stock += loss * L.stockCostRatio;
    think(sh, L.THOUGHTS.thief, 0);
    if (rng() < 0.4) popup(frontTile(u), '🦹 -' + money(loss), 'bad');
  }
}
function updateShoppers(sdt, gmin) {
  const dist = sdt * 2.1;
  for (const sh of R.shoppers) {
    if (sh.dead) continue;
    sh.needs.bladder += 0.3 * gmin; sh.needs.hunger += 0.26 * gmin; sh.needs.energy -= 0.2 * gmin;
    switch (sh.state) {
      case 'decide': decide(sh); break;
      case 'inside': {
        sh.t -= gmin;
        if (sh.t <= 0) { const u = unitById(sh.unit); if (u) finishUnit(sh, u); else { sh.hidden = false; sh.state = 'decide'; } }
        break;
      }
      case 'queue': {
        sh.t += gmin; sh.bob += sdt * 2;
        if (sh.t > 28) {
          const u = unitById(sh.target.id);
          if (u && u._q) u._q = u._q.filter((q) => q !== sh);
          think(sh, L.THOUGHTS.crowded(u ? def(u).name : 'That shop'), -7, 'crowded');
          sh.state = 'decide';
        }
        break;
      }
      case 'sit': {
        sh.t -= gmin; sh.needs.energy += gmin * 4;
        if (sh.t <= 0) { const c = tileCenter(sh.tile); sh.x = c.x + sh.ox; sh.z = c.z + sh.oz; sh.y = 0; sh.state = 'decide'; }
        break;
      }
      case 'walk': {
        const r = moveAgent(sh, dist, true);
        if (r === 'arrived') arrive(sh);
        else if (r === 'stuck') {
          if (sh.target.kind === 'exit') sh.dead = true;
          else { think(sh, 'I can’t get there from here!', -6, 'lost'); sh.state = 'decide'; }
        }
        break;
      }
      default: break;
    }
  }
  if (R.shoppers.some((s) => s.dead)) {
    for (const s of R.shoppers) if (s.dead && s.unit && s.state === 'inside') { const u = unitById(s.unit); if (u) u._in = Math.max(0, (u._in || 1) - 1); }
    R.shoppers = R.shoppers.filter((s) => !s.dead);
  }
}
function arrive(sh) {
  const t = sh.target;
  if (t.kind === 'unit') { const u = unitById(t.id); if (!u) return decide(sh); return tryEnter(sh, u); }
  if (t.kind === 'bench') {
    // sit on the adjacent bench
    const b = S.world.decor.find((d) => L.DECOR[d.type].seat && Math.abs(d.x - tx(sh.tile)) + Math.abs(d.z - tz(sh.tile)) === 1);
    if (b) { sh.x = b.x + 0.5 + (rng() - 0.5) * 0.4; sh.z = b.z + 0.5; sh.y = 0.12; sh.face = (b.rot || 0) * (Math.PI / 2); }
    sh.state = 'sit'; sh.t = 8 + rng() * 10;
    think(sh, rng() < 0.3 ? 'Nice to sit for a minute.' : null, 3);
    return;
  }
  if (t.kind === 'exit') {
    sh.dead = true;
    if (sh.car) sh.car.back++;
  }
}
// shared tile-walking for shoppers and staff
function moveAgent(a, dist, isShopper) {
  let guard = 0;
  while (dist > 0 && guard++ < 6) {
    if (a.next < 0) {
      if (a.field[a.tile] === 0) return 'arrived';
      const n = L.stepDown(R.nav, a.field, a.tile, rng);
      if (n < 0) { a.stuck++; return a.stuck > 2 ? 'stuck' : 'wait'; }
      a.next = n;
    }
    const nx = tx(a.next) + 0.5 + a.ox, nz = tz(a.next) + 0.5 + a.oz;
    const dx = nx - a.x, dz = nz - a.z, d = Math.hypot(dx, dz);
    if (d > 1e-4) a.face = Math.atan2(dx, dz);
    if (d <= dist) {
      a.x = nx; a.z = nz; a.tile = a.next; a.next = -1; dist -= d;
      if (isShopper) onShopperStep(a);
      if (a.field[a.tile] === 0) return 'arrived';
    } else { a.x += (dx / d) * dist; a.z += (dz / d) * dist; dist = 0; }
    a.bob += 0.5;
  }
  return 'moving';
}
function onShopperStep(sh) {
  const i = sh.tile;
  // comfort & litter shape the mood as they walk
  sh.mood = clamp(sh.mood + R.comfortMap[i] * 0.05 - 0.06, 0, 100);
  let lit = 0;
  for (const n of [i, ...L.neighbors(i)]) lit += R.litterCount[n];
  if (lit) { sh.mood = clamp(sh.mood - lit * 0.35 * pick(), 0, 100); if (lit > 2 && rng() < 0.08) think(sh, L.THOUGHTS.litter, -1, 'litter'); }
  if (R.comfortMap[i] > 6 && rng() < 0.01) think(sh, L.THOUGHTS.pretty, 2);
  // litter
  let p = 0.006 * (sh.food > 0 ? 3 : 1) * (done('bins') ? 0.6 : 1) * (R.binMap[i] ? 0.15 : 1);
  if (sh.food > 0) sh.food--;
  if (rng() < p && R.litter.length < 880) {
    R.litter.push({ tile: i, x: sh.x + (rng() - 0.5) * 0.3, z: sh.z + (rng() - 0.5) * 0.3, r: rng() * 6, c: ['#ffffff', '#e86f5f', '#f2c14e', '#8fd4ff', '#c9a27a'][(rng() * 5) | 0] });
    R.litterCount[i]++;
  }
}

// ================================================================ units over time
function breakUnit(u) {
  if (u.broken) return;
  u.broken = true;
  if (u._q) { for (const q of u._q) { q.state = 'decide'; think(q, L.THOUGHTS.broken(def(u).name), -5, 'broken'); } u._q = []; }
  popup(frontTile(u), '🔧 Breakdown!', 'bad');
  if (!R.staffAgents.some((s) => s.kind === 'technician')) ui.toast(`${def(u).name} broke down — hire a technician or call a contractor.`, 'bad');
  computeAttraction();
}
function repairUnit(u) { u.broken = false; u.cond = 100; u.contractorAt = null; computeAttraction(); }
function updateUnits(gmin) {
  for (const u of S.world.units) {
    const d = def(u);
    if (u.contractorAt && nowAbs() >= u.contractorAt) { repairUnit(u); popup(frontTile(u), '✅ Repaired'); }
    // queue → inside
    if (u._q && u._q.length) {
      if (!unitOpenState(u).ok) { for (const q of u._q) q.state = 'decide'; u._q = []; }
      while (u._q.length && (u._in || 0) < capacity(u)) { const q = u._q.shift(); if (!q.dead && q.state === 'queue') enterUnit(q, u); }
    }
    // staff restock during the day
    if (!d.service && !u.lease && S.phase === 'open') {
      const max = L.stockMax(d, u);
      u.stock = Math.min(max, u.stock + max * 0.11 * (u.staff / d.staff) * (gmin / 60));
    }
  }
}

// ================================================================ mall staff
function staffSpawnTile() {
  if (S.world.entrances.length) return S.world.entrances[(rng() * S.world.entrances.length) | 0];
  return L.spawnTiles()[0];
}
function syncStaffAgents() {
  for (const kind of Object.keys(L.STAFF)) {
    const want = S.staff[kind] || 0;
    const have = R.staffAgents.filter((a) => a.kind === kind);
    for (let i = have.length; i < want; i++) {
      const t = staffSpawnTile(), c = tileCenter(t);
      const ox = (rng() - 0.5) * 0.3, oz = (rng() - 0.5) * 0.3;
      R.staffAgents.push({ kind, id: R.nextAgent++, name: NAMES[(rng() * NAMES.length) | 0], tile: t, next: -1, x: c.x + ox, z: c.z + oz, ox, oz, face: 0, bob: 0, state: 'idle', t: 0, job: null, field: null,
        look: { shirt: STAFF_SHIRT[kind], pants: '#2e2e36', skin: ['#f6d3b3', '#c98d66', '#9c6644', '#e8b48f'][(rng() * 4) | 0], hair: ['#2b1d16', '#5a3a22', '#e2b25e'][(rng() * 3) | 0], h: 1.05, bald: false }, done: 0 });
    }
    if (have.length > want) {
      const drop = new Set(have.slice(want));
      for (const a of drop) releaseJob(a);
      R.staffAgents = R.staffAgents.filter((a) => !drop.has(a));
    }
  }
}
function releaseJob(a) { if (a.job?.litter) a.job.litter.claim = null; if (a.job?.unit) a.job.unit._claim = null; if (a.job?.puddle != null) { const p = R.puddles.get(a.job.puddle); if (p) p.claim = null; } a.job = null; }
function randomWalkTile(indoorPref = true) {
  const k = S.world.kind;
  for (let t = 0; t < 40; t++) {
    const i = (rng() * W * D) | 0;
    if (R.nav.walk[i] && (!indoorPref || k[i] === T.FLOOR) && k[i] !== T.SIDEWALK) return i;
  }
  return -1;
}
function staffFindJob(a) {
  const strike = modActive('strike');
  if (!strike) {
    if (a.kind === 'janitor') {
      let best = null, bd = Infinity;
      const ax = tx(a.tile), az = tz(a.tile);
      for (const l of R.litter) { if (l.claim) continue; const d = Math.abs(tx(l.tile) - ax) + Math.abs(tz(l.tile) - az); if (d < bd) { bd = d; best = l; } }
      if (best) { const f = getField('t' + best.tile, [best.tile]); if (f[a.tile] >= 0) { best.claim = a; a.job = { litter: best }; return walkTo(a, f, { kind: 'litter' }); } }
    }
    if (a.kind === 'technician') {
      const u = S.world.units.find((x) => x.broken && !x._claim && R.reach.get(x.id));
      if (u) { u._claim = a; a.job = { unit: u }; return walkTo(a, unitField(u), { kind: 'repair' }); }
      for (const [i, p] of R.puddles) {
        if (p.claim) continue;
        const goals = L.neighbors(i).filter((n) => R.nav.walk[n]);
        if (!goals.length) continue;
        const f = getField('p' + i, goals);
        if (f[a.tile] >= 0) { p.claim = a; a.job = { puddle: i }; return walkTo(a, f, { kind: 'mop' }); }
      }
    }
  }
  // patrol / wander
  const t = randomWalkTile(a.kind !== 'janitor' || rng() < 0.7);
  if (t < 0) { a.state = 'idle'; a.t = 3; return; }
  const f = getField('t' + t, [t]);
  if (f[a.tile] < 0) { a.state = 'idle'; a.t = 2; return; }
  walkTo(a, f, { kind: 'wander' });
}
function updateStaff(sdt, gmin) {
  const strike = modActive('strike');
  for (const a of R.staffAgents) {
    a.bob += sdt * 4;
    if (a.state === 'idle') { a.t -= gmin; if (a.t <= 0) staffFindJob(a); continue; }
    if (a.state === 'work') {
      a.t -= gmin;
      if (a.t <= 0) {
        const j = a.job;
        if (j?.litter) { R.litter = R.litter.filter((l) => !(Math.abs(l.x - a.x) < 1.3 && Math.abs(l.z - a.z) < 1.3) || (l.claim && l.claim !== a && l !== j.litter)); recountLitter(); }
        if (j?.unit) { repairUnit(j.unit); j.unit._claim = null; popup(frontTile(j.unit), '✅ Fixed'); }
        if (j?.puddle != null) removePuddle(j.puddle);
        a.job = null; a.done++;
        staffFindJob(a);
      }
      continue;
    }
    if (a.state === 'walk') {
      const r = moveAgent(a, sdt * (a.kind === 'janitor' ? 2.3 : 2.0) * (strike ? 0.4 : 1), false);
      if (r === 'arrived') {
        const k = a.target.kind;
        if (k === 'litter') { a.state = 'work'; a.t = 1.2; }
        else if (k === 'repair') { a.state = 'work'; a.t = 9; }
        else if (k === 'mop') { a.state = 'work'; a.t = 6; }
        else { a.state = 'idle'; a.t = a.kind === 'security' ? 2 + rng() * 4 : 1 + rng() * 2; }
      } else if (r === 'stuck') { releaseJob(a); a.state = 'idle'; a.t = 1; }
      // janitors grab stray litter right underfoot
      if (a.kind === 'janitor' && R.litterCount[a.tile] && !strike) { R.litter = R.litter.filter((l) => l.tile !== a.tile || (l.claim && l.claim !== a)); recountLitter(); }
    }
  }
}

// ================================================================ clock, hours, days
function advanceClock(gmin) {
  const before = S.time;
  S.time += gmin;
  if (Math.floor(before / 60) !== Math.floor(S.time / 60)) onHour(Math.floor(S.time / 60));
  if (S.phase === 'open' && S.time >= L.CLOSE_HOUR * 60) {
    S.phase = 'closing';
    for (const sh of R.shoppers) if (sh.state !== 'inside' && !sh.leaving) { if (sh.state === 'queue') { const u = unitById(sh.target.id); if (u?._q) u._q = u._q.filter((q) => q !== sh); } leave(sh); }
    ui.toast('🔔 Closing time — the last shoppers are heading out.');
    sfx.play('chime');
  }
  if (S.phase === 'closing') {
    for (const sh of R.shoppers) if (sh.state === 'inside' && sh.t > 3) sh.t = 3;
    const parked = R.cars.some((c) => c.state === 'parked' || c.state === 'arrive');
    if ((!R.shoppers.length && !parked) || S.time >= L.CLOSE_HOUR * 60 + 120) endDay();
  }
}
function onHour(h) {
  // research
  if (!S.sandbox && S.research.current) {
    const offices = S.world.units.filter((u) => def(u).service === 'research' && unitOpenState(u).ok).length;
    S.research.progress += 0.7 + offices * 2.6;
    const r = L.RESEARCH[S.research.current];
    if (S.research.progress >= r.cost) {
      S.research.done.push(S.research.current);
      ui.toast(`🔬 Research complete: ${r.name}!`, 'good');
      sfx.play('research');
      S.research.current = null; S.research.progress = 0;
      ui.refresh();
    }
  }
  updateScore();
  checkGoals();
  S.mods = S.mods.filter((m) => m.until > nowAbs());
  computeAttraction();
  // events
  const diff = L.DIFFICULTY[S.diff];
  if (S.phase === 'open' && h >= 10 && h <= 18 && !R.modal && R.eventsToday < 2 && (S.day >= 2 || S.sandbox) && rng() < 0.075 * diff.events) triggerEvent();
}
function updateScore() {
  const shops = S.world.units.filter((u) => isShop(u) && unitOpenState(u).ok);
  const cats = new Set(shops.map((u) => def(u).cat)).size;
  const types = new Set(shops.map((u) => u.type)).size;
  let comfort = 0;
  for (const d of S.world.decor) if (S.world.kind[idx(d.x, d.z)] === T.FLOOR) comfort += L.DECOR[d.type].comfort;
  const floorTiles = S.world.kind.filter((k) => k === T.FLOOR).length;
  const has = (svc) => S.world.units.some((u) => def(u).service === svc);
  const services = (has('toilet') ? 35 : 0) + (S.staff.janitor > 0 ? 20 : 0) + (has('security') && S.staff.security > 0 ? 15 : 0) + (S.world.decor.some((d) => d.type === 'info') ? 15 : 0) + (S.staff.technician > 0 ? 15 : 0);
  const target = L.mallScore({ avgSat: S.avgSat, cleanliness: cleanliness(), cats, types, comfort, floorTiles, services });
  S.score += (target - S.score) * 0.22;
}
function cleanliness() {
  const walkTiles = Math.max(30, R.nav ? R.nav.walk.reduce((a, b) => a + b, 0) : 30);
  return clamp(100 - (R.litter.length / walkTiles) * 320 - R.puddles.size * 4, 0, 100);
}
function goalStats() {
  const shops = S.world.units.filter((u) => isShop(u) && R.reach.get(u.id) && (u.lease || u.staff > 0));
  return {
    shopsOpen: shops.length, parking: R.parking.length,
    unitLicences: S.research.done.filter((id) => L.RESEARCH[id].kind === 'unit').length,
    bestDayVisitors: S.stats.bestDayVisitors, stars: stars(), cleanDay: S.stats.cleanDay, bestProfit: S.stats.bestProfit ?? -Infinity,
    funOpen: shops.filter((u) => def(u).cat === 'fun').length, anchorOpen: shops.filter((u) => u.type === 'cinema' || u.type === 'bowling').length
  };
}
function checkGoals() {
  const st = goalStats();
  for (const g of L.GOALS) {
    if (S.goalsDone.includes(g.id) || !g.test(st)) continue;
    S.goalsDone.push(g.id);
    if (!S.sandbox) S.cash += g.reward;
    ui.toast(`🎯 Goal complete: ${g.text}${S.sandbox ? '' : ` · +${money(g.reward)}`}`, 'good');
    sfx.play('good');
    ui.refresh();
  }
}
function openDay() {
  if (S.phase !== 'night') return;
  S.phase = 'open'; S.time = L.OPEN_HOUR * 60;
  S.today = freshToday();
  R.eventsToday = 0; R.spawnAcc = 0.6; R.busT = 15;
  for (const u of S.world.units) { u._q = []; u._in = 0; if (!def(u).service) u.stock = L.stockMax(def(u), u); }
  if (R.speed === 0) setSpeed(1);
  sfx.play('chime');
  ui.toast(`☀️ Day ${S.day} — the doors are open!`);
  tip('open', 'Shoppers are arriving. Click any shop, shopper or staff member to see what’s going on.');
  ui.refresh();
}
function endDay() {
  const t = S.today;
  // wages, upkeep, rent, interest, marketing
  let wages = 0, upkeep = 0, rent = 0;
  for (const u of S.world.units) {
    const d = def(u);
    if (d.service) upkeep += d.upkeep || 0;
    else if (u.lease) rent += Math.round(L.leaseRent(d, stars()) * modMul('rent' + u.id));
    else wages += u.staff * d.wage;
  }
  for (const [k, n] of Object.entries(S.staff)) wages += n * L.STAFF[k].wage * S.wageMul;
  const floorTiles = S.world.kind.filter((k) => k === T.FLOOR).length;
  upkeep += floorTiles * 1 + R.parking.length * 0.15 + S.world.decor.length * 0.8;
  if (done('led')) upkeep *= 0.7;
  upkeep = Math.round(upkeep);
  const interest = L.loanInterest(S.loan);
  const marketing = [0, 150, 400, 900][S.marketing];
  t.costs.wages = Math.round(wages); t.costs.upkeep = upkeep; t.costs.interest = interest; t.costs.marketing = marketing;
  t.rent = rent;
  if (!S.sandbox) S.cash += rent - t.costs.wages - upkeep - interest - marketing;
  const operating = t.revenue + rent - t.costs.stock - t.costs.wages - upkeep - interest - marketing - (t.costs.events || 0);
  const sat = t.satCount ? t.satSum / t.satCount : S.avgSat;
  const clean = cleanliness();
  // stats
  S.stats.bestDayVisitors = Math.max(S.stats.bestDayVisitors, t.visitors);
  S.stats.bestProfit = Math.max(S.stats.bestProfit ?? -Infinity, operating);
  if (clean >= 85 && t.visitors >= 60) S.stats.cleanDay = true;
  updateScore();
  checkGoals();
  const rep = { day: S.day, visitors: t.visitors, lost: t.lost, revenue: t.revenue, rent, costs: { ...t.costs }, profit: operating, sat, clean, stars: stars(), cash: S.cash,
    units: Object.entries(t.units).map(([id, v]) => ({ u: unitById(+id), ...v })).filter((x) => x.u).sort((a, b) => b.rev - a.rev),
    complaints: Object.entries(t.complaints).sort((a, b) => b[1] - a[1]), wishes: Object.entries(t.wishes).sort((a, b) => b[1] - a[1]), caught: t.caught, stolen: t.stolen, cars: t.cars };
  S.history.push({ day: S.day, visitors: t.visitors, revenue: Math.round(t.revenue + rent), profit: Math.round(operating), stars: +stars().toFixed(2) });
  if (S.history.length > 30) S.history.shift();
  S.lastReport = { ...rep, units: rep.units.map((x) => ({ id: x.u.id, rev: x.rev, visits: x.visits })) };
  // overnight: cleaners sweep, mood of the bank
  const sweep = S.staff.janitor * 60;
  R.litter.splice(0, sweep); recountLitter();
  R.shoppers = []; R.cars = R.cars.filter((c) => c.state === 'through'); R.spaces.clear();
  for (const u of S.world.units) { u._q = []; u._in = 0; }
  S.phase = 'night'; S.day++; S.time = 8 * 60 + 30;
  const limit = { normal: 3000, challenge: 2000, expert: 1000 }[S.diff] || Infinity;
  persistNow();
  if (!S.sandbox && S.cash < -limit) { ui.gameOver(rep); return; }
  ui.report(rep);
  if (!S.sandbox && S.cash < 0) ui.toast('⚠️ You’re in the red. Cut costs or take a loan before the bank steps in.', 'bad');
}
function persistNow() { save.slots[S.diff] = S; save.last = S.diff; persist(); R.saveT = 0; }

// ================================================================ events & problems
function triggerEvent() {
  const cats = new Set(S.world.units.filter(isShop).map((u) => def(u).cat));
  const id = L.pickEvent(rng, { cats, staff: Object.values(S.staff).reduce((a, b) => a + b, 0), leased: S.world.units.filter((u) => u.lease).length });
  const card = EVENT_CARDS[id]?.();
  if (!card) return;
  R.eventsToday++; S.today.events++;
  sfx.play(L.EVENTS[id].good ? 'good' : 'alert');
  ui.card({ ...card, good: L.EVENTS[id].good, kind: id });
}
function makePuddle() {
  const tiles = [];
  for (let i = 0; i < W * D; i++) if (S.world.kind[i] === T.FLOOR && R.nav.walk[i] && !S.world.entrances.includes(i)) tiles.push(i);
  if (!tiles.length) return -1;
  const t = tiles[(rng() * tiles.length) | 0];
  R.puddles.set(t, { claim: null });
  rebuildNav(); syncPuddles();
  return t;
}
const EVENT_CARDS = {
  power: () => ({ icon: '⚡', title: 'Power cut!', text: 'A fault at the substation has plunged the shops into darkness. Tills, lights and escalators are down.', options: [
    { label: 'Run the backup generator', sub: 'Everyone keeps trading', cost: 450 },
    { label: 'Wait for the grid', sub: 'Shops close for about 2 hours', act: () => { addMod('power', 1, 120); computeAttraction(); } }
  ] }),
  leak: () => {
    const t = makePuddle();
    const tech = S.staff.technician > 0;
    return { icon: '💧', title: 'Burst pipe', text: 'Water is pouring through a ceiling tile onto the concourse. Shoppers have to step around it.', options: [
      { label: 'Call an emergency plumber', sub: 'Fixed within 30 minutes', cost: 300, act: () => { setTimeoutGame(30, () => removePuddle(t)); } },
      { label: tech ? 'Leave it to your technicians' : 'Put out a wet-floor sign', sub: tech ? 'Free — they’ll mop up on their rounds' : 'Stays until someone fixes it', act: () => { if (!tech) S.today.complaints.leak = (S.today.complaints.leak || 0) + 1; } }
    ] };
  },
  thieves: () => ({ icon: '🦹', title: 'Shoplifting ring', text: 'Shop managers report a gang lifting stock across the mall today.', options: [
    { label: 'Bring in extra security', sub: 'Thieves stay away today', cost: 500 },
    { label: 'Tell staff to keep an eye out', sub: 'Four times as many thieves until closing', act: () => addMod('thief', 4, L.CLOSE_HOUR * 60 - S.time) }
  ] }),
  inspection: () => {
    const c = cleanliness();
    return { icon: '📋', title: 'Health inspection', text: `An inspector has arrived to check the food outlets. The mall is ${Math.round(c)}% clean right now.`, options: [
      { label: 'Deep clean before they look', sub: 'Clears litter and passes for sure', cost: 250, act: () => { R.litter = []; recountLitter(); S.score += 2; ui.toast('📋 Spotless! The inspector was impressed.', 'good'); } },
      { label: 'Show them round as it is', sub: 'Pass if cleanliness is 75% or more', act: () => {
        if (c >= 75) { S.score += 3; ui.toast('📋 Passed with flying colours! Rating up.', 'good'); }
        else { const fine = Math.round(300 * costMul()); if (!S.sandbox) S.cash -= fine; S.today.costs.events += fine; S.score -= 4; ui.toast(`📋 Failed. Fined ${money(fine)} and the news got out.`, 'bad'); }
      } }
    ] };
  },
  supplier: () => ({ icon: '📦', title: 'Supplier price hike', text: 'Your wholesale supplier is raising prices by 25% for the next three days.', options: [
    { label: 'Accept it', sub: 'Stock costs +25% for 3 days', act: () => addMod('cogs', 1.25, 3 * 1440) },
    { label: 'Switch suppliers', sub: 'No price rise', cost: 600 },
    { label: 'Haggle', sub: '50/50: no rise, or +40%', act: () => { if (rng() < 0.5) ui.toast('🤝 They blinked first. No price rise!', 'good'); else { addMod('cogs', 1.4, 3 * 1440); ui.toast('😬 Haggling backfired: +40% for 3 days.', 'bad'); } } }
  ] }),
  strike: () => {
    const wages = Object.entries(S.staff).reduce((a, [k, n]) => a + n * L.STAFF[k].wage, 0);
    return { icon: '✊', title: 'Staff want a raise', text: 'Your janitors, guards and technicians say they’re underpaid and are threatening to walk out.', options: [
      { label: 'Give a 10% raise', sub: `About +${money(wages * 0.1)} a day from now on`, act: () => { S.wageMul *= 1.1; ui.toast('Staff are happy again.', 'good'); } },
      { label: 'One-off bonus', sub: 'Keeps them sweet for now', cost: Math.round(wages * 1.5) },
      { label: 'Refuse', sub: 'They go slow for 3 hours', act: () => addMod('strike', 1, 180) }
    ] };
  },
  celebrity: () => ({ icon: '🌟', title: 'Celebrity visit', text: 'A famous TV chef wants to film a segment in your mall this afternoon!', options: [
    { label: 'Roll out the red carpet', sub: 'Crowds ×1.8 for 3 hours, rating boost', cost: 500, act: () => { addMod('visitors', 1.8, 180); S.score += 3; } },
    { label: 'Keep it low-key', sub: 'Crowds ×1.3 for 2 hours', act: () => addMod('visitors', 1.3, 120) }
  ] }),
  holiday: () => ({ icon: '🎉', title: 'Holiday rush', text: 'It’s a bank holiday and families are out shopping in force.', options: [
    { label: 'Run a holiday promotion', sub: 'Crowds ×1.8 until closing', cost: 700, act: () => addMod('visitors', 1.8, L.CLOSE_HOUR * 60 - S.time) },
    { label: 'Just enjoy it', sub: 'Crowds ×1.35 until closing', act: () => addMod('visitors', 1.35, L.CLOSE_HOUR * 60 - S.time) }
  ] }),
  tenant: () => {
    const leased = S.world.units.filter((u) => u.lease);
    const u = leased[(rng() * leased.length) | 0];
    const d = def(u);
    return { icon: '📝', title: 'Tenant request', text: `The tenant of your ${d.name} says trade is slow and asks for 30% off the rent for a week.`, options: [
      { label: 'Agree to the discount', sub: '-30% rent for 7 days, tenant stays happy', act: () => addMod('rent' + u.id, 0.7, 7 * 1440) },
      { label: 'Refuse', sub: '35% chance they leave and the unit goes back to you', act: () => { if (rng() < 0.35) { u.lease = false; u.staff = 0; ui.toast(`The ${d.name} tenant moved out. Staff it or find a new tenant.`, 'bad'); computeAttraction(); } else ui.toast('The tenant grumbled but stayed.'); } }
    ] };
  },
  lostchild: () => {
    const info = S.world.decor.some((d) => d.type === 'info');
    const guards = S.staff.security > 0;
    return { icon: '🧒', title: 'Lost child', text: 'A worried parent can’t find their little one anywhere in the mall.', options: [
      { label: 'Announce it from the info desk', sub: info ? 'Found in minutes, rating up' : 'Needs an Info Desk', disabled: !info, act: () => { S.score += 2; ui.toast('🧒 Reunited! Shoppers loved the quick response.', 'good'); } },
      { label: 'Send security to search', sub: guards ? 'Likely found quickly' : 'Needs a security guard', disabled: !guards, act: () => { S.score += 1; ui.toast('🧒 Security found them by the fountain.', 'good'); } },
      { label: 'Ask shop staff to look', sub: 'Shops serve slower for an hour', act: () => { addMod('slow', 1, 60); if (rng() < 0.7) ui.toast('🧒 Found in the toy aisle.'); else { S.score -= 2; ui.toast('🧒 It took ages. The parent was not impressed.', 'bad'); } } }
    ] };
  },
  viral: () => ({ icon: '📱', title: 'Gone viral!', text: 'A shopper’s video of your mall is blowing up online.', options: [
    { label: 'Boost it with ads', sub: 'Crowds ×1.5 for 2 days', cost: 400, act: () => addMod('visitors', 1.5, 2 * 1440) },
    { label: 'Ride the wave', sub: 'Crowds ×1.4 until closing', act: () => addMod('visitors', 1.4, L.CLOSE_HOUR * 60 - S.time) }
  ] }),
  storm: () => ({ icon: '⛈️', title: 'Storm warning', text: 'Heavy rain is forecast. The car park could flood and fewer people will come out.', options: [
    { label: 'Sandbags and drain crews', sub: 'Car park stays open', cost: 350, act: () => addMod('visitors', 0.85, 180) },
    { label: 'Hope for the best', sub: 'Car park may close for 3 hours', act: () => { addMod('visitors', 0.8, 180); if (rng() < 0.6) { addMod('parking', 1, 180); ui.toast('🌊 The car park flooded. No parking for 3 hours.', 'bad'); } } }
  ] })
};
const gameTimers = [];
function setTimeoutGame(minutes, fn) { gameTimers.push({ at: nowAbs() + minutes, fn }); }
function runGameTimers() { const t = nowAbs(); for (let i = gameTimers.length - 1; i >= 0; i--) if (gameTimers[i].at <= t) { const g = gameTimers.splice(i, 1)[0]; g.fn(); } }

// ================================================================ build actions
function rectTiles(a, b) {
  const x0 = Math.min(tx(a), tx(b)), x1 = Math.max(tx(a), tx(b)), z0 = Math.min(tz(a), tz(b)), z1 = Math.max(tz(a), tz(b));
  const out = [];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push(idx(x, z));
  return out;
}
function paintPlan(tool, a, b) {
  const tiles = rectTiles(a, b), ok = [];
  let cost = 0;
  if (tool === 'demolish') {
    let refund = 0;
    const units = new Set(), decor = new Set();
    for (const i of tiles) {
      const x = tx(i), z = tz(i);
      if (z > L.BUILD_MAX_Z) continue;
      if (R.nav.unitAt[i] >= 0) { units.add(R.nav.unitAt[i]); continue; }
      if (R.nav.decorAt[i] >= 0) { decor.add(R.nav.decorAt[i]); continue; }
      if (S.world.entrances.includes(i)) { ok.push(i); refund += L.GROUND.entrance.cost * 0.5; continue; }
      const k = S.world.kind[i];
      if (k === T.GRASS) continue;
      const g = Object.values(L.GROUND).find((gg) => gg.kind === k);
      ok.push(i); refund += (g?.cost || 0) * 0.5 * costMul();
      void x;
    }
    for (const id of units) refund += L.UNITS[unitById(id).type].cost * 0.5 * costMul();
    for (const id of decor) refund += L.DECOR[S.world.decor.find((d) => d.id === id).type].cost * 0.5;
    return { tiles: ok, units: [...units], decor: [...decor], cost: -Math.round(refund) };
  }
  const per = L.GROUND[tool].cost * costMul();
  for (const i of tiles) if (L.canPaint(S.world, R.nav, tool, tx(i), tz(i)).ok) { ok.push(i); cost += per; }
  return { tiles: ok, cost: Math.round(cost), per };
}
function applyPaint(tool, a, b) {
  const plan = paintPlan(tool, a, b);
  if (tool === 'demolish') {
    if (!plan.tiles.length && !plan.units.length && !plan.decor.length) return;
    for (const id of plan.units) removeUnit(id, true);
    S.world.decor = S.world.decor.filter((d) => !plan.decor.includes(d.id));
    for (const i of plan.tiles) {
      if (S.world.entrances.includes(i)) S.world.entrances = S.world.entrances.filter((e) => e !== i);
      else S.world.kind[i] = T.GRASS;
    }
    S.world.entrances = S.world.entrances.filter((e) => S.world.kind[e] === T.FLOOR);
    earn(-plan.cost);
    sfx.play('demolish');
    worldChanged();
    return;
  }
  if (!plan.tiles.length) { sfx.play('err'); return; }
  let tiles = plan.tiles;
  if (!S.sandbox && S.cash < plan.cost) {
    const n = Math.floor(S.cash / plan.per);
    if (n <= 0) { ui.toast(`Not enough money — ${L.GROUND[tool].name} costs ${money(plan.per)} a tile.`, 'bad'); sfx.play('err'); return; }
    tiles = tiles.slice(0, n);
    ui.toast(`Only enough money for ${n} tiles.`, 'bad');
  }
  const cost = Math.round(tiles.length * plan.per);
  spend(cost);
  for (const i of tiles) {
    S.world.kind[i] = L.GROUND[tool].kind;
    if (tool !== 'floor') S.world.entrances = S.world.entrances.filter((e) => e !== i);
  }
  sfx.play('build');
  popupAt(tiles[tiles.length - 1], '-' + money(cost), 'bad');
  worldChanged();
  if (tool === 'floor') tip('floor', 'Walls rise around new floor automatically. Use the Entrance tool on an outer edge so shoppers can get in.');
  if (tool === 'parking') tip('parking', 'Car parks must connect to the sidewalk along the road. Each tile is one space.');
}
function placeUnit(type, x, z, rot) {
  const d = L.UNITS[type];
  if (!L.unitUnlocked(type, S.research.done)) { ui.toast('Research this licence first.', 'bad'); return false; }
  const ok = L.canPlaceUnit(S.world, R.nav, type, x, z, rot);
  if (!ok.ok) { ui.toast(ok.reason, 'bad'); sfx.play('err'); return false; }
  const cost = Math.round(d.cost * costMul());
  if (!spend(cost)) return false;
  const u = { id: S.world.nextId++, type, x, z, rot, staff: d.staff ? Math.min(2, d.staff) : 0, price: 'standard', lease: false, level: 1, stock: 0, open: true, cond: 100 };
  u.stock = d.service ? 0 : L.stockMax(d, u);
  S.world.units.push(u);
  sfx.play('place');
  popupAt(frontTile(u), `${d.icon} ${d.name} built!`, 'big');
  worldChanged({ ground: false });
  if (!d.service) tip('unit', 'New shop! Click it to set staff and prices, or lease it to a tenant for steady rent.');
  if (d.service === 'research') tip('office', 'The Management Office speeds up research. Open the Research panel to pick a project.');
  return true;
}
function removeUnit(id, silent = false) {
  const u = unitById(id);
  if (!u) return;
  for (const sh of R.shoppers) {
    if (sh.unit === id && sh.state === 'inside') { sh.hidden = false; sh.state = 'decide'; const c = tileCenter(frontTile(u)); sh.tile = frontTile(u); sh.x = c.x; sh.z = c.z; }
    if (sh.state === 'queue' && sh.target?.id === id) sh.state = 'decide';
    if (sh.target?.id === id && sh.state === 'walk') sh.state = 'decide';
  }
  for (const a of R.staffAgents) if (a.job?.unit === u) { releaseJob(a); a.state = 'idle'; }
  S.world.units = S.world.units.filter((x) => x.id !== id);
  earn(Math.round(L.UNITS[u.type].cost * 0.5 * costMul()) * (silent ? 0 : 1));
  if (R.selected?.kind === 'unit' && R.selected.id === id) ui.inspect(null);
}
function placeDecor(type, x, z) {
  const d = L.DECOR[type];
  if (!L.decorUnlocked(type, S.research.done)) { ui.toast('Research this first.', 'bad'); return false; }
  const ok = L.canPlaceDecor(S.world, R.nav, type, x, z);
  if (!ok.ok) { ui.toast(ok.reason, 'bad'); sfx.play('err'); return false; }
  if (!spend(d.cost)) return false;
  S.world.decor.push({ id: S.world.nextId++, type, x, z, rot: R.rot });
  sfx.play('place');
  worldChanged({ ground: false, walls: false });
  if (d.bin) tip('bin', 'Shoppers near a bin drop far less litter.');
  return true;
}
function placeEntrance(x, z) {
  const ok = L.canPlaceEntrance(S.world, R.nav, x, z);
  if (!ok.ok) { ui.toast(ok.reason, 'bad'); sfx.play('err'); return false; }
  if (!spend(Math.round(L.GROUND.entrance.cost * costMul()))) return false;
  S.world.entrances.push(idx(x, z));
  sfx.play('place');
  worldChanged();
  return true;
}

// ================================================================ actions for the UI
Object.assign(A, {
  newGame(diff) { S = newState(diff); save.slots[diff] = S; save.last = diff; persist(); startGame(); },
  continueGame(diff) { S = save.slots[diff]; if (!S) return; migrate(S); save.last = diff; startGame(); },
  toTitle() { persistNow(); R.screen = 'title'; clearRuntime(); ui.showTitle(); },
  restart() { const d = S.diff; A.newGame(d); },
  setTool(tool, arg = null) { R.tool = tool; R.toolArg = arg; updateGhost(); ui.toolHint(); },
  rotate() { R.rot = (R.rot + 1) % 4; updateGhost(); ui.toolHint(); },
  setSpeed, openDay,
  camRotate(dir) { cam.yawIdx = (cam.yawIdx + dir + 4) % 4; cam.yawGoal += dir * (Math.PI / 2); },
  focus(i) { const c = tileCenter(i); cam.target.set(c.x, 0, c.z); applyCamera(); },
  hire(kind, delta) {
    const def2 = L.STAFF[kind];
    if (delta > 0 && def2.needs && !S.world.units.some((u) => def(u).service === def2.needs)) { ui.toast(`Build a ${L.UNITS[def2.needs].name} first.`, 'bad'); return; }
    S.staff[kind] = clamp((S.staff[kind] || 0) + delta, 0, 30);
    syncStaffAgents(); sfx.play('tap'); ui.refresh(); queueSave();
  },
  unitStaff(id, delta) { const u = unitById(id); const d = def(u); u.staff = clamp(u.staff + delta, 0, d.staff + 3); computeAttraction(); sfx.play('tap'); ui.refresh(); queueSave(); },
  unitPrice(id, p) { unitById(id).price = p; sfx.play('tap'); ui.refresh(); queueSave(); },
  unitLease(id) {
    const u = unitById(id); u.lease = !u.lease;
    if (u.lease) { u.staff = 0; ui.toast(`Leased! The tenant pays ${money(L.leaseRent(def(u), stars()))} a day.`, 'good'); }
    else { u.staff = Math.min(2, def(u).staff); u.stock = L.stockMax(def(u), u); ui.toast('You run this shop yourself again.'); }
    computeAttraction(); sfx.play('coin'); ui.refresh(); queueSave();
  },
  unitUpgrade(id) {
    const u = unitById(id); if (u.level >= 3) return;
    const c = Math.round(L.upgradeCost(def(u), u.level) * costMul());
    if (!spend(c)) return;
    u.level++; sfx.play('good'); syncUnits(); computeAttraction(); ui.refresh(); queueSave();
  },
  unitRestock(id) { const u = unitById(id); if (!spend(60, 'stock')) return; u.stock = L.stockMax(def(u), u); sfx.play('coin'); ui.refresh(); },
  unitToggle(id) { const u = unitById(id); u.open = !u.open; computeAttraction(); sfx.play('tap'); ui.refresh(); queueSave(); },
  unitContractor(id) { const u = unitById(id); const c = Math.round(def(u).cost * 0.08 + 80); if (!spend(c, 'events')) return; u.contractorAt = nowAbs() + 30; ui.toast('🔧 A contractor is on the way (30 min).'); ui.refresh(); },
  unitDemolish(id) { const u = unitById(id); removeUnit(id); sfx.play('demolish'); worldChanged({ ground: false }); void u; },
  decorRemove(id) { const d = S.world.decor.find((x) => x.id === id); if (!d) return; S.world.decor = S.world.decor.filter((x) => x.id !== id); earn(Math.round(L.DECOR[d.type].cost * 0.5)); sfx.play('demolish'); ui.inspect(null); worldChanged({ ground: false, walls: false }); },
  research(id) { if (!L.researchAvailable(id, S.research.done)) return; if (S.research.current && S.research.current !== id) S.research.progress *= 0.5; S.research.current = id; sfx.play('tap'); ui.refresh(); queueSave(); },
  loan(a) {
    const cap = { normal: 30000, challenge: 20000, expert: 12000 }[S.diff] || 0;
    if (S.loan + a > cap) { ui.toast(`The bank caps your loans at ${money(cap)}.`, 'bad'); return; }
    S.loan += a; S.cash += a; sfx.play('coin'); ui.refresh(); queueSave();
  },
  repay(a) { const n = Math.min(a, S.loan, Math.max(0, S.cash)); if (n <= 0) return; S.loan -= n; S.cash -= n; sfx.play('coin'); ui.refresh(); queueSave(); },
  marketing(level) { S.marketing = level; sfx.play('tap'); ui.refresh(); queueSave(); },
  chooseOption(opt) {
    if (opt.cost && !spend(opt.cost, 'events')) return false;
    opt.act?.();
    ui.refresh();
    return true;
  },
  setModal(on) { R.modal = on; },
  goalStats, unitOpenState, capacity, cleanliness, stars, nowAbs, unitById, frontTile,
  attraction: () => R.attraction,
  paintPlan,
  simulate(sec, step = 0.05) { for (let t = 0; t < sec; t += step) gameStep(step); render(0); ui.hud(); }
});

function setSpeed(n) { R.speed = n; ui.hud(); }
function tip(id, text) {
  if (!save.hints || S.tips.includes(id)) return;
  S.tips.push(id);
  setTimeout(() => ui.toast('💡 ' + text, 'tip', 6500), 600);
}
function migrate(s) {
  s.tips = s.tips || []; s.mods = s.mods || []; s.wageMul = s.wageMul || 1;
  if (s.sandbox) s.research.done = Object.keys(L.RESEARCH);
  for (const u of s.world.units) { u.cond = u.cond ?? 100; u._q = []; u._in = 0; }
  if (s.phase !== 'night') {
    // a mid-day save restarts that day; short-lived event effects are dropped
    const t = s.day * 1440 + s.time;
    s.mods = s.mods.filter((m) => m.until - t > 600);
    s.phase = 'night'; s.time = 8 * 60 + 30; s.today = freshToday();
  }
}
function clearRuntime() {
  R.shoppers = []; R.cars = []; R.staffAgents = []; R.litter = []; R.spaces.clear(); R.puddles.clear(); fxGroup.clear(); gameTimers.length = 0;
  R.tool = null; R.selected = null; ghost.visible = false; rectMesh.visible = false;
  for (const [, g] of R.unitMeshes) unitGroup.remove(g);
  for (const [, g] of R.decorMeshes) decorGroup.remove(g);
  R.unitMeshes.clear(); R.decorMeshes.clear();
  overlay.innerHTML = ''; R.badges.clear();
}
function startGame() {
  clearRuntime();
  R.screen = 'game';
  R.speed = 1;
  rebuildNav(); drawGround(); rebuildWalls(); syncUnits(); syncDecor(); syncStaffAgents();
  fitCamera();
  ui.showGame();
  tip('welcome', 'Welcome to your mall! Plan your first build, then press “Open the doors”.');
}

// ================================================================ ghost previews & picking
const ghostMat = new THREE.MeshBasicMaterial({ color: '#6f9a7a', transparent: true, opacity: 0.45, depthWrite: false });
const ghost = new THREE.Group(); ghost.visible = false; scene.add(ghost);
const ghostBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat); ghost.add(ghostBox);
const ghostArrow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 4), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false })); ghost.add(ghostArrow);
const rectMat = new THREE.MeshBasicMaterial({ color: '#6f9a7a', transparent: true, opacity: 0.35, depthWrite: false });
const rectMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), rectMat); rectMesh.rotation.x = -Math.PI / 2; rectMesh.visible = false; scene.add(rectMesh);
const hoverMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false })); hoverMesh.rotation.x = -Math.PI / 2; hoverMesh.visible = false; scene.add(hoverMesh);
const costTag = document.createElement('div'); costTag.className = 'cost-tag'; costTag.hidden = true; document.body.appendChild(costTag);

function updateGhost() {
  ghost.visible = false; rectMesh.visible = false; costTag.hidden = true;
  const i = R.hover;
  if (R.screen !== 'game' || i < 0) { hoverMesh.visible = false; return; }
  hoverMesh.visible = !R.tool || R.tool === 'select';
  const c = tileCenter(i); hoverMesh.position.set(c.x, 0.02, c.z);
  if (!R.tool) return;
  const x = tx(i), z = tz(i);
  if (R.tool === 'unit') {
    const type = R.toolArg, { w, d } = L.footprint(type, R.rot);
    const ok = L.canPlaceUnit(S.world, R.nav, type, x, z, R.rot).ok && L.unitUnlocked(type, S.research.done) && canAfford(L.UNITS[type].cost * costMul());
    ghostMat.color.set(ok ? '#6f9a7a' : '#e0674f');
    ghostBox.scale.set(w - 0.1, 1.1, d - 0.1); ghostBox.position.set(0, 0.55, 0);
    ghost.position.set(x + w / 2, 0, z + d / 2);
    const { dir } = L.doorOf({ type, x, z, rot: R.rot });
    ghostArrow.position.set(dir[0] * (w / 2 + 0.3), 0.3, dir[1] * (d / 2 + 0.3));
    ghostArrow.rotation.order = 'YXZ'; ghostArrow.rotation.set(Math.PI / 2, Math.atan2(dir[0], dir[1]), 0);
    ghost.visible = true;
    costTag.textContent = `${L.UNITS[type].icon} ${money(L.UNITS[type].cost * costMul())}`; costTag.classList.toggle('bad', !ok); costTag.hidden = false;
  } else if (R.tool === 'decor' || R.tool === 'entrance') {
    const ok = R.tool === 'decor' ? L.canPlaceDecor(S.world, R.nav, R.toolArg, x, z).ok : L.canPlaceEntrance(S.world, R.nav, x, z).ok;
    ghostMat.color.set(ok ? '#6f9a7a' : '#e0674f');
    ghostBox.scale.set(0.8, 0.6, 0.8); ghostBox.position.set(0, 0.3, 0);
    ghostArrow.position.set(0, -10, 0);
    ghost.position.set(c.x, 0, c.z); ghost.visible = true;
    const cost = R.tool === 'decor' ? L.DECOR[R.toolArg].cost : L.GROUND.entrance.cost * costMul();
    costTag.textContent = money(cost); costTag.classList.toggle('bad', !ok); costTag.hidden = false;
  } else if (L.GROUND[R.tool]) {
    const a = R.drag?.start ?? i;
    const plan = paintPlan(R.tool, a, i);
    const x0 = Math.min(tx(a), x), x1 = Math.max(tx(a), x), z0 = Math.min(tz(a), z), z1 = Math.max(tz(a), z);
    rectMesh.scale.set(x1 - x0 + 1, z1 - z0 + 1, 1);
    rectMesh.position.set((x0 + x1 + 1) / 2, 0.03, (z0 + z1 + 1) / 2);
    const bad = R.tool !== 'demolish' && (!plan.tiles.length || !canAfford(plan.cost));
    rectMat.color.set(R.tool === 'demolish' ? '#e0674f' : bad ? '#e0674f' : '#6f9a7a');
    rectMesh.visible = true;
    costTag.textContent = R.tool === 'demolish' ? `Refund ${money(-plan.cost)}` : `${plan.tiles.length} tiles · ${money(plan.cost)}`;
    costTag.classList.toggle('bad', bad); costTag.hidden = false;
  }
}

const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function groundAt(cx, cy) {
  ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, p)) return null;
  return p;
}
function tileAt(cx, cy) {
  const p = groundAt(cx, cy);
  if (!p) return -1;
  const x = Math.floor(p.x), z = Math.floor(p.z);
  return L.inBounds(x, z) ? idx(x, z) : -1;
}
function pickAt(cx, cy) {
  const p = groundAt(cx, cy);
  // agents first (closest to the click on the ground)
  if (p) {
    let best = null, bd = 0.45;
    for (const a of [...R.staffAgents, ...R.shoppers]) {
      if (a.hidden) continue;
      const d = Math.hypot(a.x - p.x, a.z - p.z - 0.15);
      if (d < bd) { bd = d; best = a; }
    }
    if (best) return best.kind === 'shopper' ? { kind: 'shopper', id: best.id } : { kind: 'staff', id: best.id };
  }
  ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([unitGroup, decorGroup], true);
  for (const h of hits) {
    if (h.object.userData.unitId) return { kind: 'unit', id: h.object.userData.unitId };
    if (h.object.userData.decorId) return { kind: 'decor', id: h.object.userData.decorId };
  }
  const i = tileAt(cx, cy);
  if (i >= 0) {
    if (R.nav.unitAt[i] >= 0) return { kind: 'unit', id: R.nav.unitAt[i] };
    if (R.nav.decorAt[i] >= 0) return { kind: 'decor', id: R.nav.decorAt[i] };
  }
  return null;
}

// ================================================================ input
const pointers = new Map();
let pan = null, pinch = null, downAt = null;
const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (R.screen !== 'game') return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), viewH: cam.viewH, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    R.drag = null; pan = null; updateGhost();
    return;
  }
  downAt = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
  if (e.button === 2 && R.tool) { A.setTool(null); ui.refresh(); return; }
  const painting = R.tool && L.GROUND[R.tool] && e.button === 0;
  if (painting) { const i = tileAt(e.clientX, e.clientY); if (i >= 0) R.drag = { start: i }; }
  else pan = { x: e.clientX, y: e.clientY, target: cam.target.clone() };
});
canvas.addEventListener('pointermove', (e) => {
  if (R.screen !== 'game') return;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  costTag.style.left = e.clientX + 'px'; costTag.style.top = e.clientY + 'px';
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    cam.viewH = clamp(pinch.viewH * (pinch.d / d), 6, 50);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    panBy(cx - pinch.cx, cy - pinch.cy); pinch.cx = cx; pinch.cy = cy;
    applyCamera();
    return;
  }
  if (pan) {
    panBy(e.clientX - pan.x, e.clientY - pan.y);
    pan.x = e.clientX; pan.y = e.clientY;
    applyCamera();
  }
  const i = tileAt(e.clientX, e.clientY);
  if (i !== R.hover) { R.hover = i; updateGhost(); }
});
function panBy(dx, dy) {
  const s = cam.viewH / window.innerHeight;
  const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  const fwd = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  cam.target.addScaledVector(right, -dx * s).addScaledVector(fwd, (dy * s) / Math.sin(cam.pitch));
  cam.target.x = clamp(cam.target.x, -4, W + 4); cam.target.z = clamp(cam.target.z, -4, D + 4);
}
canvas.addEventListener('pointerup', (e) => {
  if (R.screen !== 'game') return;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : 99;
  const i = tileAt(e.clientX, e.clientY);
  if (R.drag) {
    if (i >= 0) applyPaint(R.tool, R.drag.start, i);
    R.drag = null; updateGhost();
  } else if (moved < 8 && downAt && downAt.button === 0) {
    if (R.tool === 'unit' && i >= 0) { if (placeUnit(R.toolArg, tx(i), tz(i), R.rot) && !e.shiftKey) { /* keep tool for repeated placing */ } }
    else if (R.tool === 'decor' && i >= 0) placeDecor(R.toolArg, tx(i), tz(i));
    else if (R.tool === 'entrance' && i >= 0) placeEntrance(tx(i), tz(i));
    else if (!R.tool) { const p = pickAt(e.clientX, e.clientY); R.selected = p; ui.inspect(p); if (p) sfx.play('tap'); }
    updateGhost();
  }
  pan = null; downAt = null;
});
canvas.addEventListener('pointerleave', () => { R.hover = -1; updateGhost(); });
canvas.addEventListener('wheel', (e) => {
  if (R.screen !== 'game') return;
  e.preventDefault();
  cam.viewH = clamp(cam.viewH * (1 + Math.sign(e.deltaY) * 0.1), 6, 50);
  applyCamera();
}, { passive: false });
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (R.screen !== 'game' || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (R.modal && k !== 'escape') return;
  keys.add(k);
  if (k === ' ') { e.preventDefault(); setSpeed(R.speed ? 0 : 1); }
  else if (k === '1') setSpeed(1);
  else if (k === '2') setSpeed(2);
  else if (k === '3') setSpeed(4);
  else if (k === 'r') A.rotate();
  else if (k === 'q') A.camRotate(-1);
  else if (k === 'e') A.camRotate(1);
  else if (k === 'escape') { if (R.tool) { A.setTool(null); ui.refresh(); } else ui.escape(); }
  else if (k === 'delete' && R.selected?.kind === 'decor') A.decorRemove(R.selected.id);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// ================================================================ overlays: popups & unit badges
const overlay = $('overlay');
R.badges = new Map();
const tmpV = new THREE.Vector3();
function project(x, y, z) { tmpV.set(x, y, z).project(camera); return { x: (tmpV.x + 1) / 2 * window.innerWidth, y: (1 - tmpV.y) / 2 * window.innerHeight, vis: tmpV.z < 1 }; }
let popCount = 0;
function popup(tile, text, cls = '') {
  if (popCount > 18) return;
  const c = tileCenter(tile);
  const p = project(c.x, 1.2, c.z);
  const el = document.createElement('div');
  el.className = 'pop ' + cls; el.textContent = text;
  el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
  overlay.appendChild(el); popCount++;
  setTimeout(() => { el.remove(); popCount--; }, 1400);
}
const popupAt = popup;
function updateBadges() {
  const seen = new Set();
  for (const u of S.world.units) {
    const st = unitOpenState(u);
    let icon = st.ok ? (st.warn ? st.icon : null) : st.icon;
    if (!icon && u._q && u._q.length >= 5) icon = '😤';
    if (!icon) continue;
    seen.add(u.id);
    let el = R.badges.get(u.id);
    if (!el) { el = document.createElement('div'); el.className = 'badge'; overlay.appendChild(el); R.badges.set(u.id, el); }
    el.textContent = icon; el.classList.toggle('bad', !st.ok);
    const { w, d } = L.footprint(u.type, u.rot);
    const p = project(u.x + w / 2, WALL_H + 0.9, u.z + d / 2);
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
  }
  for (const [id, el] of R.badges) if (!seen.has(id)) { el.remove(); R.badges.delete(id); }
}

// ================================================================ lighting by time of day
const nightMat = new Set();
function updateLighting() {
  const h = S.time / 60;
  let day;
  if (S.phase === 'night') day = 0.28; // planning: a soft evening light so you can still build
  else day = clamp(1 - (h - 17.5) / 3.5, 0.12, 1);
  const sky = SKY_NIGHT.clone().lerp(SKY_DUSK, clamp(day * 2, 0, 1)).lerp(SKY_DAY, clamp(day * 2 - 1, 0, 1));
  scene.background.copy(sky);
  sun.intensity = 0.35 + day * 1.9;
  sun.color.set(day > 0.6 ? '#fff0d6' : '#ffb07a');
  hemi.intensity = 0.55 + day * 0.6;
  hemi.color.set(day > 0.3 ? '#fff6e6' : '#8fa4d9');
  const lampsOn = day < 0.6;
  for (const [, g] of R.decorMeshes) if (g.userData.bulb) g.userData.bulb.material.emissiveIntensity = lampsOn ? 2.2 : 0.4;
  for (const c of sceneryGroup.children) if (c.userData.bulb) c.userData.bulb.material.emissiveIntensity = lampsOn ? 2.2 : 0.4;
  void nightMat;
}

// ================================================================ main loop
function gameStep(sdt) {
  if (!S) return;
  const running = !R.modal && S.phase !== 'night';
  if (!running) return;
  const gmin = (sdt * 60) / L.SEC_PER_HOUR;
  advanceClock(gmin);
  if (S.phase === 'night') return;
  runGameTimers();
  spawnArrivals(gmin);
  updateShoppers(sdt, gmin);
  updateUnits(gmin);
  updateStaff(sdt, gmin);
  updateCars(sdt, gmin);
}
let hudT = 0, badgeT = 0;
function render(rdt) {
  // camera rotation easing
  if (Math.abs(cam.yaw - cam.yawGoal) > 1e-3) {
    cam.yaw += (cam.yawGoal - cam.yaw) * Math.min(1, rdt * 10);
    if (Math.abs(cam.yaw - cam.yawGoal) < 0.002) cam.yaw = cam.yawGoal;
    applyCamera(); applyCutaway();
  }
  if (R.screen === 'game' && S) {
    // keyboard pan
    const kp = 600 * rdt;
    if (keys.has('w') || keys.has('arrowup')) { panBy(0, kp); applyCamera(); }
    if (keys.has('s') || keys.has('arrowdown')) { panBy(0, -kp); applyCamera(); }
    if (keys.has('a') || keys.has('arrowleft')) { panBy(kp, 0); applyCamera(); }
    if (keys.has('d') || keys.has('arrowright')) { panBy(-kp, 0); applyCamera(); }
    const agents = [];
    for (const s of R.shoppers) if (!s.hidden) { s.tilt = 0; agents.push(s); }
    for (const a of R.staffAgents) agents.push(a);
    crowd.update(agents);
    traffic.update(R.cars);
    litterLayer.update(R.litter);
    // entrance doors slide open when someone is close
    for (const w of R.walls) if (w.door) {
      const c = tileCenter(w.tile);
      const near = R.shoppers.some((s) => !s.hidden && Math.abs(s.x - c.x) < 1.1 && Math.abs(s.z - c.z) < 1.1);
      const ud = w.g.userData;
      ud.open += ((near ? 1 : 0) - ud.open) * Math.min(1, rdt * 6);
      const o = 0.22 + ud.open * 0.3;
      if (ud.along) { ud.dl.position.x = -o; ud.dr.position.x = o; } else { ud.dl.position.z = -o; ud.dr.position.z = o; }
    }
    for (const [, g] of R.decorMeshes) if (g.userData.jet) g.userData.jet.scale.y = 0.85 + Math.sin(performance.now() / 180) * 0.15;
    // status lamps on units
    for (const u of S.world.units) {
      const g = R.unitMeshes.get(u.id); if (!g) continue;
      const st = unitOpenState(u);
      const col = !st.ok ? '#ff6b5a' : u.lease ? '#ffd34d' : '#9dff8a';
      if (g.userData.lampCol !== col) { g.userData.lamp.material = glow(col, 1.5); g.userData.lampCol = col; }
    }
    R.busStop.visible = done('bus');
    badgeT -= rdt; if (badgeT <= 0) { badgeT = 0.1; updateBadges(); }
    hudT -= rdt; if (hudT <= 0) { hudT = 0.25; ui.hud(); updateLighting(); }
    if (R.saveT > 0) { R.saveT -= rdt; if (R.saveT <= 0) persistNow(); }
    sfx.updateMusic(rdt);
  }
  renderer.render(scene, camera);
}
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (R.screen === 'game' && S) {
    const sdt = rdt * R.speed;
    // sub-step at high speed so walking stays smooth and nobody skips a tile
    const n = Math.ceil(sdt / 0.05);
    for (let k = 0; k < n; k++) gameStep(sdt / n);
  }
  render(rdt);
}

// title backdrop: a slowly turning view of a demo mall
function titleBackdrop() {
  S = newState('normal');
  S.world = L.starterWorld();
  S.phase = 'open'; S.time = 11 * 60;
  rebuildNav(); drawGround(); rebuildWalls(); syncUnits(); syncDecor();
  cam.viewH = 20; cam.target.set(16, 0, 17); applyCamera();
  updateLighting();
}
buildScenery();
titleBackdrop();
ui.showTitle();
applyCamera();
requestAnimationFrame(frame);
window.addEventListener('visibilitychange', () => { if (document.hidden && R.screen === 'game' && S) persistNow(); });

// debugging & automated testing hook
window.__plaza = { get S() { return S; }, R, L, A, gameStep, simulate: (sec) => A.simulate(sec), triggerEvent, EVENT_CARDS, endDay, openDay, placeUnit, placeDecor, placeEntrance, applyPaint, cam, fitCamera, screenOf: (x, z) => project(x, 0, z) };
