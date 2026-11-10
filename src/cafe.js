// Little Cup Café — a cozy isometric café sim (three.js).
import * as THREE from 'three';
import * as L from './cafe-logic.js';
import {
  mat, glow, mesh, box, cyl, sph, cone, buildFurniture, buildPerson, posePerson, randomLook,
  buildEspressoMachine, buildRegister, buildPastryCase, buildCupStack, buildJar, buildTree
} from './cafe-models.js';

const $ = (id) => document.getElementById(id);
const rng = Math.random;
const clamp = L.clamp;
const money = (n) => { const r = Math.round(n * 100) / 100; return '$' + (Number.isInteger(r) ? r : r.toFixed(2)); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lerp = (a, b, t) => a + (b - a) * t;

// ================================================================ save data
const SAVE_KEY = 'little-cup-cafe-v1';
const freshProfile = (sandbox) => ({ coins: sandbox ? 3000 : 200, xp: sandbox ? L.REP_XP[5] : 0, sites: {}, regulars: [], progress: {}, rewards: {}, decor: [] });
let save = { sound: true, music: true, hints: true, campaign: freshProfile(false), sandbox: freshProfile(true) };
try {
  const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (raw && raw.campaign) save = { ...save, ...raw };
} catch { /* storage unavailable */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* ignore */ } };

let mode = 'campaign';
const prof = () => save[mode];
const sandbox = () => mode === 'sandbox';
const repLvl = () => L.repLevel(prof().xp);

function newSite(loc) {
  return {
    layout: loc.start.map(([type, x, z]) => ({ type, x, z })),
    expansions: [...(loc.startExpansions || [])],
    staff: [], equipment: [], candidates: [], nextId: 1, day: 0,
    stock: { beans: 14, milk: 12, tea: 6, ice: 8, cocoa: 5, matcha: 5, chai: 5, lemon: 5, syrup: 5, cups: 30, pastry: 0 },
    menu: loc.recipes.map((id) => ({ id, on: true, price: L.RECIPES[id].price }))
  };
}
function siteFor(loc) {
  const p = prof();
  if (!p.sites[loc.id]) p.sites[loc.id] = newSite(loc);
  const s = p.sites[loc.id];
  if (!s.candidates.length) refreshCandidates(s, loc);
  return s;
}
function refreshCandidates(site, loc) {
  const roles = ['barista', 'cashier', 'runner'];
  site.candidates = [0, 1, 2].map((i) => L.makeCandidate(rng, roles[(i + site.day) % 3], `c${site.nextId++}`));
  if (loc.id === 'roastery') site.candidates.push(L.makeCandidate(rng, 'barista', `c${site.nextId++}`));
}

// ================================================================ sound
class Sound {
  constructor() { this.ctx = null; this.musicT = 0; this.bar = 0; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.5;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
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
    const n = this.ctx.sampleRate * dur | 0, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), gn = this.ctx.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; gn.gain.value = vol;
    src.connect(f); f.connect(gn); gn.connect(this.master); src.start();
  }
  play(name) {
    switch (name) {
      case 'ding': this.tone(1318, 0.3, 'sine', 0.14); this.tone(1760, 0.45, 'sine', 0.1, 0.09); break;
      case 'coin': this.tone(988, 0.08, 'square', 0.05); this.tone(1319, 0.22, 'square', 0.05, 0.07); break;
      case 'pop': this.tone(480, 0.1, 'triangle', 0.18, 0, 900); break;
      case 'tap': this.tone(700, 0.05, 'triangle', 0.1); break;
      case 'bell': this.tone(1568, 0.6, 'sine', 0.08); this.tone(2093, 0.7, 'sine', 0.05, 0.13); break;
      case 'err': this.tone(196, 0.2, 'sawtooth', 0.05); break;
      case 'steam': this.noise(0.5, 2400, 0.08); break;
      case 'grind': this.noise(0.35, 700, 0.1); break;
      case 'sad': this.tone(440, 0.25, 'triangle', 0.08, 0, 300); break;
      case 'level': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.1, i * 0.09)); break;
      case 'sign': this.tone(330, 0.12, 'triangle', 0.12); this.tone(494, 0.18, 'triangle', 0.1, 0.1); this.tone(659, 0.3, 'triangle', 0.1, 0.2); break;
      case 'warn': this.tone(660, 0.15, 'square', 0.04); this.tone(520, 0.2, 'square', 0.04, 0.17); break;
      default: break;
    }
  }
  // soft generative lo-fi loop: a 4-chord progression with a lazy pentatonic melody
  updateMusic(dt) {
    if (!this.ctx || !save.sound || !save.music) return;
    this.musicT -= dt;
    if (this.musicT > 0) return;
    this.musicT = 3.2;
    const chords = [[349, 440, 523, 659], [330, 392, 494, 587], [294, 349, 440, 523], [262, 330, 392, 494]];
    const ch = chords[this.bar++ % 4];
    ch.forEach((f, i) => this.tone(f / 2, 3.1, 'triangle', 0.018, i * 0.04, 0, this.musicBus));
    const pent = [523, 587, 659, 784, 880, 1046];
    for (let b = 0; b < 4; b++) if (Math.random() < 0.55) this.tone(pent[Math.random() * 6 | 0], 0.6, 'sine', 0.03, b * 0.8 + (Math.random() < 0.3 ? 0.4 : 0), 0, this.musicBus);
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
renderer.toneMappingExposure = 1.08;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#ffd9a8');
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 300);
const hemi = new THREE.HemisphereLight('#fff1dc', '#8a6a52', 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffe2b8', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight('#b9d4ff', 0.35);
fill.position.set(-10, 8, -6);
scene.add(fill);

const siteGroup = new THREE.Group(), furnGroup = new THREE.Group(), peopleGroup = new THREE.Group(), fxGroup = new THREE.Group();
scene.add(siteGroup, furnGroup, peopleGroup, fxGroup);

const cam = { target: new THREE.Vector3(), base: new THREE.Vector3(), pan: new THREE.Vector3(), yaw: Math.PI / 4, pitch: 0.64, viewH: 12, zoom: 1, s: 0.02, orbit: false, orbitT: 0 };
function camDir() { return new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)); }
function applyCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  cam.target.copy(cam.base).add(cam.pan);
  camera.position.copy(cam.target).addScaledVector(camDir(), 60);
  camera.lookAt(cam.target);
  const h = cam.viewH / cam.zoom;
  camera.left = -h * aspect / 2; camera.right = h * aspect / 2; camera.top = h / 2; camera.bottom = -h / 2;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

// fit the café into the free screen area left between UI panels
function fitCamera(insets = currentInsets()) {
  if (!G.loc) return;
  const { w, d } = G.loc;
  cam.base.set(0, 0.6, 0); cam.pan.set(0, 0, 0); cam.zoom = 1;
  cam.viewH = 10; applyCamera();
  const pts = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const t of (G.grid?.tiles || new Map()).values()) { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x + 1); z0 = Math.min(z0, t.z); z1 = Math.max(z1, t.z + 1); }
  if (!Number.isFinite(x0)) { x0 = 0; x1 = w; z0 = 0; z1 = d; }
  for (const x of [x0 - w / 2 - 0.2, x1 - w / 2 + 0.2]) for (const z of [z0 - d / 2 - 0.2, z1 - d / 2 + 0.6]) for (const y of [0, 2.6]) pts.push(new THREE.Vector3(x, y, z));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    p.applyMatrix4(camera.matrixWorldInverse);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const W = window.innerWidth, H = window.innerHeight;
  const aw = Math.max(200, W - insets.l - insets.r), ah = Math.max(160, H - insets.t - insets.b);
  const s = Math.max((maxX - minX) / aw, (maxY - minY) / ah) * 1.04;
  cam.s = s;
  cam.viewH = s * H;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const ox = cx - (insets.l + aw / 2 - W / 2) * s, oy = cy + (insets.t + ah / 2 - H / 2) * s;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  cam.base.addScaledVector(right, ox).addScaledVector(up, oy);
  applyCamera();
}
function currentInsets() {
  const W = window.innerWidth, mobile = W < 760;
  if (G.screen === 'title') return mobile ? { l: 10, r: 10, t: 40, b: window.innerHeight * 0.55 } : { l: Math.min(520, W * 0.46), r: 20, t: 40, b: 40 };
  if (G.phase === 'prep' && !G.build) return mobile ? { l: 8, r: 8, t: 70, b: window.innerHeight * 0.5 } : { l: 20, r: Math.min(440, W * 0.4), t: 80, b: 30 };
  if (G.build) return mobile ? { l: 8, r: 8, t: 70, b: 190 } : { l: 30, r: 30, t: 80, b: 170 };
  if (G.phase === 'service') return mobile ? { l: 6, r: 6, t: 150, b: G.maker ? 250 : 120 } : { l: 230, r: 30, t: 140, b: G.maker ? 230 : 110 };
  return { l: 20, r: 20, t: 70, b: 40 };
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitCamera();
});

// ================================================================ game state
const G = {
  screen: 'title', phase: 'idle', loc: null, site: null, levelIdx: 0, level: null,
  grid: null, seats: [], seatOcc: new Map(), comfort: 0, tileMeshes: [],
  t: 0, shiftLen: 150, customers: [], queue: [], tickets: [], pickupOcc: [], spills: [],
  agents: [], me: null, stats: null, paused: false, speed: 1, maker: null, build: null,
  nextArrival: 3, burst: 0, burstT: 0, events: [], featured: null, troubles: [], machine: null,
  pausedRecipes: new Set(), oat: false, lateDelivery: null, nextId: 1, ended: false, hintStage: 0,
  lights: [], rain: null, hudT: 0
};

const tileWorld = (x, z) => new THREE.Vector3(x + 0.5 - G.loc.w / 2, G.grid ? G.grid.hAt(x, z) : 0, z + 0.5 - G.loc.d / 2);
const worldTile = (v) => ({ x: Math.floor(v.x + G.loc.w / 2), z: Math.floor(v.z + G.loc.d / 2) });

function availableRecipes() {
  const all = G.loc.recipes;
  if (sandbox() || !G.level) return all;
  return all.slice(0, G.level.recipes || all.length);
}
function activeMenu() {
  const avail = new Set(availableRecipes());
  return G.site.menu.filter((m) => avail.has(m.id) && m.on && !G.pausedRecipes.has(m.id));
}
const hasEq = (id) => G.site?.equipment.includes(id);
const machineDown = () => G.machine && G.machine.broken && !G.machine.backup;
const furnUnlocked = (type) => {
  const f = L.FURNITURE[type];
  if (sandbox()) return true;
  if (f.reward) return prof().decor.includes(type);
  return (f.rep || 0) <= repLvl();
};

// ================================================================ the café building
function clearGroup(gr) { while (gr.children.length) gr.remove(gr.children[0]); }

function buildSite() {
  clearGroup(siteGroup); clearGroup(fxGroup);
  for (const l of G.lights) scene.remove(l);
  G.lights = [];
  const { loc, site } = G;
  const pal = loc.palette;
  G.grid = L.buildGrid(loc, site.expansions, site.layout, G.spills.map((s) => `${s.x},${s.z}`));
  const { tiles, fixed, ent } = G.grid;
  const W = loc.w, D = loc.d;
  scene.background = new THREE.Color(pal.sky);
  hemi.color.set(loc.night ? '#8f88c9' : '#fff1dc');
  hemi.groundColor.set(loc.night ? '#2a2238' : '#8a6a52');

  // ground and surroundings
  const ground = mesh(new THREE.PlaneGeometry(90, 90), mat(pal.outside), 0, -0.06, 0, siteGroup);
  ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
  const walk = mesh(new THREE.PlaneGeometry(W + 3, D + 3), mat(loc.id === 'lodge' ? '#d9e1e6' : loc.id === 'seaside' ? '#ead7a6' : loc.night ? '#3a3046' : '#c9c1b4'), 0, -0.05, 0.6, siteGroup);
  walk.rotation.x = -Math.PI / 2; walk.castShadow = false;
  if (loc.id === 'seaside') {
    const sea = mesh(new THREE.PlaneGeometry(90, 30), mat('#4fb3c9', { roughness: 0.25 }), 0, -0.04, -D / 2 - 17, siteGroup);
    sea.rotation.x = -Math.PI / 2; sea.castShadow = false;
    const sea2 = mesh(new THREE.PlaneGeometry(30, 90), mat('#4fb3c9', { roughness: 0.25 }), -W / 2 - 17, -0.04, 0, siteGroup);
    sea2.rotation.x = -Math.PI / 2; sea2.castShadow = false;
  }
  decorateOutside(loc);

  G.tileMeshes = [];
  for (const t of tiles.values()) {
    const p = new THREE.Vector3(t.x + 0.5 - W / 2, 0, t.z + 0.5 - D / 2);
    let color, h = t.h;
    if (t.kind === 'patio') color = loc.id === 'seaside' ? ((t.x + t.z) % 2 ? '#c8a67c' : '#bf9d72') : ((t.x + t.z) % 2 ? '#d8cfc2' : '#cec4b5');
    else color = pal.floor[t.z % 2];
    if (t.kind === 'stairs') {
      for (let i = 0; i < 3; i++) mesh(box(0.34, 0.33 * (i + 1), 0.96), mat(i % 2 ? pal.floor[0] : pal.floor[1]), p.x - 0.33 + i * 0.33, 0.165 * (i + 1), p.z, siteGroup);
    }
    const tm = mesh(box(0.98, 0.1 + h, 0.98), mat(color), p.x, (h - 0.1) / 2, p.z, siteGroup);
    if (t.kind === 'stairs') tm.material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    tm.castShadow = false;
    tm.userData.tile = { x: t.x, z: t.z };
    G.tileMeshes.push(tm);
    if (t.kind === 'loft') mesh(box(1, h, 1), mat(pal.trim), p.x, h / 2 - 0.02, p.z, siteGroup).castShadow = false;
  }
  // counter base area under the counter (fixed blocked tiles)
  buildWalls(loc, tiles, ent);
  buildCounter(loc, pal, fixed);
  buildChalkboard(loc, pal);
  rebuildFurniture();
  // sun & shadow frustum
  const ext = Math.max(W, D) * 0.9;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 80 });
  sun.shadow.camera.updateProjectionMatrix();
  buildStaffAgents();
  if (G.events.includes('festival')) buildBunting(loc);
}

function decorateOutside(loc) {
  const r = L.mulberry32(loc.id.length * 977 + 13);
  const W = loc.w, D = loc.d;
  const kind = loc.id === 'seaside' ? 'palm' : loc.id === 'lodge' ? 'pine' : 'round';
  const spots = [];
  for (let i = 0; i < 16; i++) {
    const side = i % 4;
    let x, z;
    if (side === 0) { x = -W / 2 - 1.5 - r() * 3; z = -D / 2 + r() * D; }
    else if (side === 1) { x = -W / 2 + r() * W; z = -D / 2 - 1.5 - r() * 3; }
    else if (side === 2) { x = W / 2 + 1.6 + r() * 2.5; z = -D / 2 + r() * D * 0.6; }
    else { x = -W / 2 - 1 - r() * 2; z = D / 2 + 1.2 + r() * 2; }
    if (loc.id === 'seaside' && (side === 0 || side === 1)) continue;
    spots.push([x, z]);
  }
  if (loc.id === 'night') {
    // market stalls & string lights behind the stall
    for (let i = 0; i < 4; i++) {
      const sx = -W / 2 + 1 + i * 2.2, sz = -D / 2 - 2.4;
      mesh(box(1.8, 1, 1), mat(['#c2425e', '#3d7f99', '#e0a43a', '#6b4ca8'][i]), sx, 0.5, sz, siteGroup);
      mesh(box(2, 0.1, 1.3), mat('#f4efe6'), sx, 1.4, sz + 0.1, siteGroup).rotation.x = 0.2;
    }
    for (let i = 0; i < 14; i++) mesh(sph(0.07, 6), glow(['#ffb347', '#ff6b8b', '#9dff8a', '#6be0ff'][i % 4], 2), -W / 2 + i * (W / 13), 2.6 + Math.sin(i * 0.9) * 0.15, -D / 2 - 0.4, siteGroup);
    return;
  }
  for (const [x, z] of spots) {
    const t = buildTree(r, kind); t.position.set(x, 0, z); t.scale.setScalar(0.9 + r() * 0.5); siteGroup.add(t);
  }
  if (loc.id === 'roastery') {
    for (const x of [-W / 2 + 2, W / 2 - 2]) {
      mesh(cyl(0.05, 0.06, 2.6, 6), mat('#2b2d33'), x, 1.3, D / 2 + 1.6, siteGroup);
      mesh(sph(0.15, 8), glow('#ffe2a8', 1.5), x, 2.6, D / 2 + 1.6, siteGroup);
    }
  }
  if (loc.id === 'lodge') {
    for (let i = 0; i < 6; i++) { const m = mesh(cone(2.4 + r() * 1.5, 3 + r() * 2, 5), mat('#8d9aa8'), -W / 2 - 6 - r() * 6, 1.6, -D / 2 - 4 + i * 3.5, siteGroup); mesh(cone(1, 1.1, 5), mat('#ffffff'), m.position.x, m.position.y + 1.4, m.position.z, siteGroup); }
  }
}

function wallSegment(parent, x, z, alongX, h0, kind, pal, height = 2.3) {
  const len = 1.0, th = 0.14;
  const sx = alongX ? len + th : th, sz = alongX ? th : len + th;
  const piece = (y0, y1, color, opts) => {
    const m = mesh(box(sx, y1 - y0, sz), opts || mat(color), x, h0 + (y0 + y1) / 2, z, parent);
    return m;
  };
  if (kind === 'low') {
    piece(0, 0.55, pal.wallLow);
    const cap = mesh(box(sx + 0.04, 0.06, sz + 0.04), mat(pal.trim), x, h0 + 0.58, z, parent); cap.castShadow = true;
    return;
  }
  if (kind === 'fence') {
    const post = (px, pz) => mesh(box(0.08, 0.6, 0.08), mat(pal.trim), px, h0 + 0.3, pz, parent);
    post(x - (alongX ? 0.5 : 0), z - (alongX ? 0 : 0.5));
    for (const y of [0.25, 0.5]) mesh(box(alongX ? 1 : 0.05, 0.05, alongX ? 0.05 : 1), mat(pal.trim), x, h0 + y, z, parent);
    return;
  }
  if (kind === 'rail') {
    mesh(box(alongX ? 1 : 0.05, 0.05, alongX ? 0.05 : 1), mat(pal.trim), x, h0 + 0.55, z, parent);
    mesh(box(0.05, 0.55, 0.05), mat(pal.trim), x, h0 + 0.27, z, parent);
    return;
  }
  piece(0, 0.85, pal.wallLow);
  mesh(box(sx + 0.03, 0.05, sz + 0.03), mat(pal.trim), x, h0 + 0.87, z, parent);
  if (kind === 'window') {
    const g = mesh(box(alongX ? 0.86 : 0.04, 1.05, alongX ? 0.04 : 0.86), mat('#cfe9f2', { transparent: true, opacity: 0.32, roughness: 0.05, emissive: '#fff4d6', emissiveIntensity: 0.15 }), x, h0 + 1.43, z, parent);
    g.castShadow = false;
    for (const off of [-0.47, 0.47]) mesh(box(alongX ? 0.06 : th + 0.02, 1.1, alongX ? th + 0.02 : 0.06), mat(pal.trim), x + (alongX ? off : 0), h0 + 1.43, z + (alongX ? 0 : off), parent);
    mesh(box(alongX ? 0.04 : th, 1.05, alongX ? th : 0.04), mat(pal.trim), x, h0 + 1.43, z, parent);
    mesh(box(alongX ? 1 : th, 0.04, alongX ? th : 1), mat(pal.trim), x, h0 + 1.43, z, parent);
    piece(1.96, height, pal.wall);
    mesh(box(alongX ? 1 : 0.3, 0.05, alongX ? 0.3 : 1), mat(pal.trim), x + (alongX ? 0 : 0.12), h0 + 0.9, z + (alongX ? 0.12 : 0), parent);
  } else {
    piece(0.9, height, pal.wall);
  }
}

function buildWalls(loc, tiles, ent) {
  const pal = loc.palette, W = loc.w, D = loc.d;
  const has = (x, z) => tiles.has(`${x},${z}`);
  const t = (x, z) => tiles.get(`${x},${z}`);
  const wx = (x) => x + 0.5 - W / 2, wz = (z) => z + 0.5 - D / 2;
  const [c0, c1] = loc.cx;
  for (const tile of tiles.values()) {
    const { x, z, kind } = tile;
    const indoor = kind !== 'patio';
    const h0 = 0;
    // back
    if (!has(x, z - 1)) {
      if (indoor) wallSegment(siteGroup, wx(x), wz(z) - 0.5, true, h0, (x < c0 - 1 && x % 3 === 1) || (x > c1) ? 'window' : 'wall', pal, 2.3 + tile.h * 0.6);
      else wallSegment(siteGroup, wx(x), wz(z) - 0.5, true, tile.h, 'fence', pal);
    }
    // left
    if (!has(x - 1, z)) {
      if (indoor) wallSegment(siteGroup, wx(x) - 0.5, wz(z), false, h0, z % 2 === 1 || z === 2 ? 'window' : 'wall', pal, 2.3 + tile.h * 0.6);
      else wallSegment(siteGroup, wx(x) - 0.5, wz(z), false, tile.h, 'fence', pal);
    }
    // right
    if (!has(x + 1, z)) wallSegment(siteGroup, wx(x) + 0.5, wz(z), false, tile.h, indoor ? 'low' : 'fence', pal);
    else if (tile.h > 0.6 && t(x + 1, z).h < 0.4 && t(x + 1, z).kind !== 'stairs') wallSegment(siteGroup, wx(x) + 0.5, wz(z), false, tile.h, 'rail', pal);
    else if (tile.h < 0.4 && kind !== 'stairs' && t(x + 1, z).h > 0.6) { /* loft face, drawn by platform */ }
    // front
    const isEnt = x === ent.x && z === ent.z;
    if (!has(x, z + 1)) {
      if (isEnt) buildDoor(wx(x), wz(z) + 0.5, indoor, pal);
      else wallSegment(siteGroup, wx(x), wz(z) + 0.5, true, tile.h, indoor ? 'low' : 'fence', pal);
    } else if (tile.h > 0.6 && t(x, z + 1).h < 0.4 && t(x, z + 1).kind !== 'stairs') wallSegment(siteGroup, wx(x), wz(z) + 0.5, true, tile.h, 'rail', pal);
    else if (tile.h > 0.6 && z > 0 && t(x, z - 1) && t(x, z - 1).h < 0.4 && t(x, z - 1).kind !== 'stairs') wallSegment(siteGroup, wx(x), wz(z) - 0.5, true, tile.h, 'rail', pal);
    if (tile.h > 0.6 && has(x - 1, z) && t(x - 1, z).h < 0.4 && t(x - 1, z).kind !== 'stairs') wallSegment(siteGroup, wx(x) - 0.5, wz(z), false, tile.h, 'rail', pal);
  }
  // takeaway window hatch
  const win = loc.expansions.find((e) => e.kind === 'takeaway' && G.site.expansions.includes(e.id));
  if (win) {
    const x = wx(c1), z = wz(loc.base[3]) + 0.5;
    mesh(box(1.1, 0.06, 0.5), mat(pal.trim), x, 1.2, z + 0.15, siteGroup);
    for (let i = 0; i < 5; i++) {
      const s = mesh(box(0.22, 0.04, 0.55), mat(i % 2 ? '#ffffff' : pal.accent), x - 0.44 + i * 0.22, 1.55, z + 0.18, siteGroup); s.rotation.x = 0.45;
    }
    signBoard(x, 1.85, z + 0.05, 'TO GO', pal.accent);
  }
}

function signBoard(x, y, z, text, color, w = 0.9) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a3426'; ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.strokeRect(6, 6, 244, 84);
  ctx.fillStyle = '#fffaf0'; ctx.font = 'bold 52px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 52);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = mesh(new THREE.PlaneGeometry(w, w * 0.375), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), x, y, z, siteGroup);
  m.castShadow = false;
  return m;
}

function buildDoor(x, z, indoor, pal) {
  for (const s of [-0.48, 0.48]) mesh(box(0.1, indoor ? 2.0 : 1.2, 0.14), mat(pal.trim), x + s, indoor ? 1 : 0.6, z, siteGroup);
  if (indoor) {
    mesh(box(1.1, 0.12, 0.16), mat(pal.trim), x, 2.0, z, siteGroup);
    // open door swung outward
    const door = mesh(box(0.06, 1.85, 0.8), mat(pal.accent), x - 0.48, 0.95, z + 0.42, siteGroup);
    door.rotation.y = 0.15;
    mesh(box(0.07, 0.9, 0.5), mat('#cfe9f2', { transparent: true, opacity: 0.4 }), x - 0.48, 1.25, z + 0.42, siteGroup).castShadow = false;
    // awning
    for (let i = 0; i < 6; i++) {
      const s = mesh(box(0.22, 0.04, 0.62), mat(i % 2 ? '#ffffff' : (pal.awning || '#e0674f')), x - 0.55 + i * 0.22, 2.2, z + 0.3, siteGroup);
      s.rotation.x = 0.42;
    }
    const sg = signBoard(x + 0.62, 1.35, z + 0.12, 'OPEN', '#ffd34d', 0.6);
    sg.rotation.z = 0.06;
    G.openSign = sg;
  } else {
    mesh(box(1.1, 0.08, 0.1), mat(pal.trim), x, 1.2, z, siteGroup);
    for (let i = 0; i < 8; i++) mesh(sph(0.06, 6), glow(['#ffb347', '#ff6b8b', '#9dff8a', '#6be0ff'][i % 4], 1.6), x - 0.45 + i * 0.13, 1.28, z, siteGroup);
  }
  // planters by the door
  for (const s of [-1, 1]) {
    const p = buildFurniture('flowerbox', pal); p.scale.setScalar(0.5); p.position.set(x + s * 0.9, 0, z + 0.45); siteGroup.add(p);
  }
}

function buildCounter(loc, pal, fixed) {
  const [c0, c1] = loc.cx;
  const W = loc.w, D = loc.d;
  const wx = (x) => x + 0.5 - W / 2, wz = (z) => z + 0.5 - D / 2;
  const len = c1 - c0 + 1, cxm = (wx(c0) + wx(c1)) / 2;
  // front counter
  mesh(box(len, 0.88, 0.7, 0.03), mat(pal.wallLow), cxm, 0.44, wz(1) + 0.05, siteGroup);
  for (let i = 0; i < len * 3; i++) mesh(box(0.04, 0.7, 0.02), mat(pal.trim), wx(c0) - 0.45 + i * (len / (len * 3)) + 0.17, 0.42, wz(1) + 0.41, siteGroup);
  mesh(box(len + 0.06, 0.07, 0.8, 0.02), mat('#efe9e0', { roughness: 0.35 }), cxm, 0.92, wz(1) + 0.05, siteGroup);
  // back counter
  mesh(box(len, 0.85, 0.5), mat(pal.trim), cxm, 0.425, wz(0) - 0.2, siteGroup);
  mesh(box(len + 0.04, 0.06, 0.54), mat('#efe9e0', { roughness: 0.35 }), cxm, 0.88, wz(0) - 0.2, siteGroup);
  // shelves on the back wall
  for (let r = 0; r < 2; r++) {
    mesh(box(len - 0.4, 0.05, 0.28), mat('#7b4f31'), cxm, 1.55 + r * 0.42, wz(0) - 0.33, siteGroup);
    for (let i = 0; i < len * 2 - 1; i++) {
      const j = buildJar(['#6b3f22', '#e9b95a', '#8fbf5a', '#c9705b', '#3a2011'][(i + r) % 5]);
      j.position.set(wx(c0) - 0.25 + i * 0.5 + 0.2, 1.58 + r * 0.42, wz(0) - 0.33); j.scale.setScalar(0.9); siteGroup.add(j);
    }
  }
  const machine = buildEspressoMachine(pal.accent);
  machine.position.set(wx(c0 + 1), 0.91, wz(0) - 0.22); siteGroup.add(machine);
  G.machineMesh = machine;
  const grinder = new THREE.Group();
  mesh(box(0.2, 0.3, 0.22, 0.03), mat('#2b2d33'), 0, 0.15, 0, grinder);
  mesh(cone(0.12, 0.2, 10), mat('#cfe9f2', { transparent: true, opacity: 0.5 }), 0, 0.42, 0, grinder).rotation.x = Math.PI;
  mesh(cyl(0.1, 0.1, 0.06, 10), mat('#6b3f22'), 0, 0.37, 0, grinder);
  grinder.position.set(wx(c0 + 2), 0.91, wz(0) - 0.22); siteGroup.add(grinder);
  const reg = buildRegister(); reg.position.set(wx(c1), 0.95, wz(1)); reg.rotation.y = Math.PI; siteGroup.add(reg);
  if (hasEq('pastrycase')) { const pc = buildPastryCase(); pc.position.set(wx(c0) + 0.1, 0.95, wz(1) + 0.05); siteGroup.add(pc); }
  else { const cs = buildCupStack(); cs.position.set(wx(c0), 0.95, wz(1)); siteGroup.add(cs); }
  const cs2 = buildCupStack(); cs2.position.set(wx(c0 + 2), 0.95, wz(1) - 0.1); cs2.scale.setScalar(0.8); siteGroup.add(cs2);
  if (hasEq('tipjar')) { const tj = buildJar('#e9b95a'); tj.position.set(wx(c1) - 0.35, 0.95, wz(1) + 0.15); siteGroup.add(tj); }
  if (hasEq('backup')) {
    const b = new THREE.Group();
    mesh(box(0.3, 0.3, 0.3, 0.04), mat('#c9705b'), 0, 0.15, 0, b);
    mesh(cyl(0.07, 0.07, 0.12, 10), mat('#d6d8da', { metalness: 0.6 }), 0, 0.36, 0, b);
    b.position.set(wx(c1 - 1), 0.91, wz(0) - 0.22); siteGroup.add(b);
  }
  if (hasEq('speakers')) for (const x of [wx(c0) - 0.3, wx(c1) + 0.3]) mesh(box(0.22, 0.32, 0.18, 0.03), mat('#3c3f46'), x, 2.0, wz(0) - 0.4, siteGroup);
  // pendant lamps over the counter
  for (let i = 0; i < 2; i++) {
    const x = lerp(wx(c0), wx(c1), (i + 0.5) / 2), z = wz(1) + 0.05;
    mesh(cyl(0.008, 0.008, 1.1, 4), mat('#2b2d33'), x, 2.25, z, siteGroup);
    const shade = mesh(cone(0.2, 0.2, 14), mat(pal.accent, { side: THREE.DoubleSide }), x, 1.65, z, siteGroup); shade.castShadow = false;
    mesh(sph(0.07, 8), glow('#fff0c4', 2.4), x, 1.56, z, siteGroup).castShadow = false;
    const pl = new THREE.PointLight('#ffcf8a', loc.night ? 6 : 3, 5, 1.6); pl.position.set(x, 1.5, z); scene.add(pl); G.lights.push(pl);
  }
}

function buildChalkboard(loc, pal) {
  const [c0, c1] = loc.cx;
  const W = loc.w, D = loc.d;
  const x = (c0 + c1 + 1) / 2 - W / 2 + 0.6, z = -D / 2 + 0.08;
  const c = document.createElement('canvas'); c.width = 512; c.height = 300;
  G.chalk = { canvas: c, tex: new THREE.CanvasTexture(c) };
  G.chalk.tex.colorSpace = THREE.SRGBColorSpace;
  const frame = mesh(box(2.05, 1.25, 0.06), mat('#7b4f31'), x, 2.45, z, siteGroup); frame.castShadow = false;
  const board = mesh(new THREE.PlaneGeometry(1.92, 1.12), new THREE.MeshStandardMaterial({ map: G.chalk.tex, roughness: 0.95 }), x, 2.45, z + 0.035, siteGroup);
  board.castShadow = false;
  drawChalkboard();
}
function drawChalkboard() {
  if (!G.chalk) return;
  const { canvas: c, tex } = G.chalk, ctx = c.getContext('2d');
  ctx.fillStyle = '#2f3a35'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(255,255,255,.05)'; for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * 512, Math.random() * 300, 40, 2);
  ctx.fillStyle = '#fffaf0'; ctx.textBaseline = 'middle';
  ctx.font = '700 44px Caveat, cursive'; ctx.textAlign = 'center'; ctx.fillText(G.loc.name, 256, 34);
  const items = activeMenu().slice(0, 8);
  ctx.font = '600 32px Caveat, cursive';
  items.forEach((m, i) => {
    const col = i % 2, row = i >> 1, x0 = 30 + col * 245, y = 90 + row * 52;
    ctx.textAlign = 'left'; ctx.fillStyle = '#fffaf0'; ctx.fillText(L.RECIPES[m.id].name, x0, y);
    ctx.textAlign = 'right'; ctx.fillStyle = '#ffd98a'; ctx.fillText(money(m.price), x0 + 220, y);
  });
  tex.needsUpdate = true;
}

function buildBunting(loc) {
  const W = loc.w, D = loc.d;
  for (let i = 0; i < 18; i++) {
    const x = -W / 2 + 0.3 + i * (W / 17.5), y = 2.75 - Math.sin((i / 17) * Math.PI) * 0.35;
    const f = mesh(cone(0.12, 0.25, 3), mat(['#e0674f', '#f4cf6b', '#6f9a7a', '#5a86c5', '#e89ac2'][i % 5]), x, y, D / 2 + 0.2, fxGroup);
    f.rotation.x = Math.PI;
  }
}

// ---------------------------------------------------------------- furniture placement
function orientation(f, seatMap) {
  const s = seatMap.get(`${f.x},${f.z}`);
  if (s) return Math.atan2(s.facing[0], s.facing[1]);
  const tiles = G.grid.tiles;
  if (L.FURNITURE[f.type].seat) {
    for (const [dx, dz] of L.DIR4) { const n = G.grid.solid.get(`${f.x + dx},${f.z + dz}`); if (n && L.FURNITURE[n.type].table) return Math.atan2(dx, dz); }
  }
  if (!tiles.has(`${f.x - 1},${f.z}`)) return Math.PI / 2;
  if (!tiles.has(`${f.x},${f.z - 1}`)) return 0;
  if (!tiles.has(`${f.x + 1},${f.z}`)) return -Math.PI / 2;
  if (!tiles.has(`${f.x},${f.z + 1}`)) return Math.PI;
  return 0;
}

function rebuildFurniture() {
  clearGroup(furnGroup);
  for (const l of G.lights.filter((l) => l.userData.furn)) scene.remove(l);
  G.lights = G.lights.filter((l) => !l.userData.furn);
  G.grid = L.buildGrid(G.loc, G.site.expansions, G.site.layout, G.spills.map((s) => `${s.x},${s.z}`));
  G.seats = L.usableSeats(G.grid);
  const seatMap = new Map(G.seats.map((s) => [`${s.x},${s.z}`, s]));
  let lightCount = 0;
  for (const f of G.site.layout) {
    const m = buildFurniture(f.type, G.loc.palette);
    const p = tileWorld(f.x, f.z);
    m.position.copy(p);
    m.rotation.y = orientation(f, seatMap);
    m.traverse((o) => { o.userData.furn = f; });
    furnGroup.add(m);
    if (m.userData.light && lightCount < 4) {
      const li = m.userData.light;
      const pl = new THREE.PointLight(li.color, G.loc.night ? 3.5 : 1.6, 3.2, 1.8);
      pl.position.set(p.x, p.y + li.y, p.z + (li.z || 0));
      pl.userData.furn = true; scene.add(pl); G.lights.push(pl); lightCount++;
    }
  }
  updateComfort();
}
function updateComfort() {
  let bonus = hasEq('speakers') ? 8 : 0;
  bonus -= G.spills.length * 6;
  G.comfort = L.comfortScore(G.site.layout, bonus);
}

// ================================================================ people
const bubbles = $('bubbles');
function makeBubble(onTap) {
  const el = document.createElement('div');
  el.className = 'bub';
  el.innerHTML = '<i class="ring"></i><span class="ico"></span><em class="tag"></em>';
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); onTap?.(); });
  bubbles.appendChild(el);
  return el;
}
function popup(worldPos, html, cls = '') {
  const v = worldPos.clone().project(camera);
  const el = document.createElement('div');
  el.className = `pop ${cls}`;
  el.innerHTML = html;
  el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
  el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
  bubbles.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

const ME_LOOK = { skin: '#f1c7a6', hair: '#5a3a22', style: 'bun', shirt: '#f2f2ee', pants: '#3b4a6b', hat: '#e0674f', glasses: false, scale: 1 };
function buildStaffAgents() {
  for (const a of G.agents) peopleGroup.remove(a.p.root);
  if (G.me) peopleGroup.remove(G.me.p.root);
  G.agents = [];
  const [c0, c1] = G.loc.cx;
  const me = buildPerson(ME_LOOK, { apron: G.loc.palette.accent });
  const band = mesh(cyl(0.175, 0.175, 0.05, 16), mat('#e0674f'), 0, 0.06, 0, me.head); band.rotation.x = 0.1;
  const mp = tileWorld(c0 + 1, 0); me.root.position.set(mp.x, 0, mp.z + 0.25); me.root.rotation.y = Math.PI;
  peopleGroup.add(me.root);
  G.me = { p: me, home: me.root.position.clone() };
  const spots = [];
  for (let x = c0 + 2; x <= c1; x++) spots.push(x);
  let i = 0;
  const list = [...G.site.staff, ...(G.tempStaff || [])];
  for (const m of list) {
    if (G.sick === m.id) continue;
    const look = m.look || (m.look = randomLook(rng));
    const p = buildPerson(look, { apron: m.role === 'runner' ? '#5a86c5' : m.role === 'cashier' ? '#e9b95a' : G.loc.palette.accent });
    const sx = m.role === 'cashier' ? c1 : spots[i++ % spots.length];
    const pos = tileWorld(sx, 0);
    p.root.position.set(pos.x + (i > spots.length ? 0.25 : 0), 0, pos.z + 0.25);
    p.root.rotation.y = Math.PI;
    peopleGroup.add(p.root);
    const bub = makeBubble(null); bub.classList.add('staff');
    G.agents.push({ m, p, busy: null, t: 0, home: p.root.position.clone(), bub });
  }
  bubbles.querySelectorAll('.bub.staff').forEach((b) => { if (!G.agents.some((a) => a.bub === b)) b.remove(); });
}

function spawnCustomer(opts = {}) {
  const loc = G.loc;
  const regularPool = prof().regulars.filter((r) => r.loc === loc.id && !G.customers.some((c) => c.regularId === r.id));
  let reg = opts.regular || (!opts.type && regularPool.length && rng() < 0.22 ? regularPool[rng() * regularPool.length | 0] : null);
  const type = opts.type || reg?.type || L.weightedPick(rng, loc.types);
  const td = L.CUSTOMER_TYPES[type];
  const look = reg?.look || opts.look || randomLook(rng);
  if (type === 'critic') { look.style = 'cap'; look.hat = '#2b2d33'; look.shirt = '#3c3f46'; look.glasses = true; }
  const menu = activeMenu();
  if (!menu.length) return null;
  let item = null;
  if (opts.recipe) item = menu.find((m) => m.id === opts.recipe) || null;
  if (!item && reg && rng() < 0.7) item = menu.find((m) => m.id === reg.fav) || null;
  if (!item) item = L.pickOrder(rng, menu, type, G.featured);
  if (!item) return null;
  let mod = opts.mod || null;
  if (!mod && (td.custom || (loc.custom && rng() < 0.3)) && !['tea', 'lemonade'].includes(item.id)) mod = Object.keys(L.MODS)[rng() * 3 | 0];
  const rainy = G.events.includes('rain');
  const takeawayP = td.takeaway + (rainy ? 0.35 : 0) + G.site.expansions.reduce((a, id) => a + (loc.expansions.find((e) => e.id === id)?.takeaway || 0), 0);
  const takeaway = opts.takeaway ?? rng() < takeawayP;
  const runner = G.agents.some((a) => a.m.role === 'runner');
  const patienceMax = (opts.patience || 46) * td.patience * (reg ? 1.2 : 1) * (runner ? 1.15 : 1) * (G.level?.patience || 1);
  const base = L.RECIPES[item.id].price + (mod ? L.MODS[mod].price : 0);
  const budget = base * td.budget * (0.85 + rng() * 0.4) * (1 + G.comfort / 300);
  const p = buildPerson(look);
  if (type === 'critic') mesh(cyl(0.14, 0.14, 0.18, 14), mat('#1b1b22'), 0, 0.2, 0, p.head);
  if (td.laptop && !takeaway) p.laptop = true;
  const c = {
    id: G.nextId++, type, td, look, p, name: reg?.name || L.randomName(rng), regularId: reg?.id || null,
    order: { recipe: item.id, mod, pastry: hasEq('pastrycase') && rng() < 0.35 },
    budget, takeaway, wantSeat: !takeaway, patienceMax, patience: patienceMax, waited: 0,
    state: 'enter', path: [], pi: 0, slot: -1, ticket: null, seat: null, stay: 0, critic: type === 'critic', celebration: !!opts.celebration,
    t: rng() * 10, inside: false
  };
  c.bub = makeBubble(() => tapCustomer(c));
  p.root.traverse((o) => { o.userData.cust = c; });
  const ent = G.grid.ent, e = tileWorld(ent.x, ent.z);
  const sideX = e.x + (rng() < 0.5 ? -4 : 4);
  p.root.position.set(sideX, 0, e.z + 2.2);
  peopleGroup.add(p.root);
  if (G.queue.length >= G.grid.fixed.queue.length) {
    // too busy: they peek in and wander off
    c.state = 'leave'; G.stats.missed++;
    c.path = [new THREE.Vector3(e.x, 0, e.z + 2.2), new THREE.Vector3(sideX < e.x ? e.x + 5 : e.x - 5, 0, e.z + 2.2)];
    c.pi = 0; c.mood = '😩';
    G.customers.push(c);
    return c;
  }
  G.queue.push(c);
  c.slot = G.queue.length - 1;
  const spot = G.grid.fixed.queue[c.slot];
  const path = L.findPath(G.grid, ent, spot) || [ent, spot];
  c.path = [new THREE.Vector3(e.x, 0, e.z + 2.2), ...path.map((q) => tileWorld(q.x, q.z))];
  c.pi = 0;
  c.onArrive = () => { c.state = 'queue'; c.inside = true; };
  G.customers.push(c);
  sfx.play('bell');
  return c;
}

function walkTo(c, target, onArrive) {
  const from = worldTile(c.p.root.position);
  const path = L.findPath(G.grid, from, target);
  c.path = path ? path.map((q) => tileWorld(q.x, q.z)) : [tileWorld(target.x, target.z)];
  c.pi = 0;
  c.onArrive = onArrive;
}

function leave(c, mood) {
  if (c.state === 'leave') return;
  c.mood = mood || c.mood;
  removeFromQueue(c);
  if (c.pickup) { c.pickup.occ = null; c.pickup = null; }
  if (c.seat) { G.seatOcc.delete(`${c.seat.x},${c.seat.z}`); c.seat = null; }
  if (c.ticket) { dropTicket(c.ticket); c.ticket = null; }
  c.state = 'leave';
  const ent = G.grid.ent, e = tileWorld(ent.x, ent.z);
  const from = worldTile(c.p.root.position);
  const path = L.findPath(G.grid, from, ent) || [ent];
  const away = e.x + (rng() < 0.5 ? -5 : 5);
  c.path = [...path.map((q) => tileWorld(q.x, q.z)), new THREE.Vector3(e.x, 0, e.z + 2.2), new THREE.Vector3(away, 0, e.z + 2.2)];
  c.pi = 0;
  c.onArrive = () => { c.gone = true; };
}

function removeFromQueue(c) {
  const i = G.queue.indexOf(c);
  if (i < 0) return;
  G.queue.splice(i, 1);
  G.queue.forEach((q, j) => {
    if (q.slot !== j) {
      q.slot = j;
      const spot = G.grid.fixed.queue[j];
      const arrived = q.state === 'queue';
      walkTo(q, spot, () => { q.state = 'queue'; q.inside = true; });
      if (arrived) q.state = 'shuffle';
    }
  });
}

function freePickup() {
  return G.pickupOcc.find((p) => !p.occ && G.grid.tiles.has(`${p.x},${p.z}`)) || null;
}

function takeOrder(c, by = 'player') {
  if (c.state !== 'queue' || c.slot !== 0) return false;
  const spot = freePickup();
  if (!spot) { if (by === 'player') { toast('The pickup counter is full — finish some drinks first!'); sfx.play('err'); } return false; }
  const item = G.site.menu.find((m) => m.id === c.order.recipe);
  if (!item || !item.on || G.pausedRecipes.has(item.id)) {
    // their drink came off the menu: try something else
    const alt = L.pickOrder(rng, activeMenu(), c.type, G.featured);
    if (!alt) { recordSat(30); leave(c, '😕'); return true; }
    c.order.recipe = alt.id; c.order.mod = null;
  }
  const price = orderPrice(c.order);
  if (price > c.budget * 1.3) {
    G.stats.pricey++; recordSat(40);
    popup(headPos(c), 'Too pricey…', 'sad');
    leave(c, '💸'); sfx.play('sad');
    return true;
  }
  removeFromQueue(c);
  c.pickup = spot; spot.occ = c;
  c.patience = Math.max(c.patience, c.patienceMax * 0.75);
  c.state = 'walkPickup';
  walkTo(c, spot, () => { c.state = 'waitdrink'; });
  const tk = { id: G.nextId++, cust: c, recipe: c.order.recipe, mod: c.order.mod, maker: null, created: G.t };
  c.ticket = tk;
  G.tickets.push(tk);
  sfx.play('ding');
  if (G.level?.tutorial && G.hintStage === 1) { G.hintStage = 2; hint('Order in! Tap the ticket on the rail (or SERVE) to make it at the bar.'); }
  renderRail();
  return true;
}
const orderPrice = (o) => (G.site.menu.find((m) => m.id === o.recipe)?.price || L.RECIPES[o.recipe].price) + (o.mod ? L.MODS[o.mod].price : 0);

function dropTicket(tk) {
  const i = G.tickets.indexOf(tk);
  if (i >= 0) G.tickets.splice(i, 1);
  if (G.maker?.ticket === tk) closeMaker(true);
  for (const a of G.agents) if (a.busy?.ticket === tk) a.busy = null;
  renderRail();
}

function recordSat(s) { G.stats.satSum += s; G.stats.satCount++; }
const headPos = (c) => c.p.root.position.clone().add(new THREE.Vector3(0, 1.25, 0));

function freeSeat(c) {
  const kindPref = (s) => (s.kind === 'patio' && G.events.includes('rain') ? 1 : 0);
  const free = G.seats.filter((s) => !G.seatOcc.has(`${s.x},${s.z}`)).sort((a, b) => kindPref(a) - kindPref(b));
  if (!free.length) return null;
  const pos = c.p.root.position;
  free.sort((a, b) => kindPref(a) - kindPref(b) || tileWorld(a.x, a.z).distanceTo(pos) - tileWorld(b.x, b.z).distanceTo(pos) + (rng() - 0.5) * 2);
  return free[0];
}

function completeTicket(tk, made, quality, correctOverride) {
  const i = G.tickets.indexOf(tk);
  if (i >= 0) G.tickets.splice(i, 1);
  const c = tk.cust;
  renderRail();
  if (!c || c.state === 'leave' || c.gone) return;
  c.ticket = null;
  const correct = made ? L.drinkMatches(made, tk.recipe, tk.mod) : correctOverride;
  const st = G.stats;
  let seat = null;
  if (c.wantSeat) { seat = freeSeat(c); if (!seat) st.noSeat++; }
  const price = orderPrice(tk);
  const sat = L.customerSatisfaction({
    waitFrac: c.waited / c.patienceMax, correct, quality, comfort: G.comfort, price, budget: c.budget,
    seated: !!seat, wantedSeat: c.wantSeat, picky: c.td.picky, celebration: c.celebration
  });
  let tipMul = c.td.tip * (c.regularId ? 1.3 : 1) * (hasEq('tipjar') ? 1.15 : 1) * (G.featured === tk.recipe ? 1.5 : 1) * (G.events.includes('festival') ? 1.2 : 1);
  const tip = L.tipFor(sat, price, tipMul);
  let total = price;
  if (c.order.pastry) {
    if (G.site.stock.pastry > 0) { G.site.stock.pastry--; total += 3; st.pastry++; } else lowStock('pastry', true);
  }
  st.served++; st.drinks++; st.revenue += total; st.tips += tip; st.quality += quality; st.waitSum += c.waited / c.patienceMax;
  recordSat(sat);
  if (!correct) st.wrong++;
  if (correct && quality >= 0.8) st.featured[tk.recipe] = (st.featured[tk.recipe] || 0) + 1;
  if (c.takeaway || !seat) st.takeaway++;
  if (tk.mod && correct) st.custom++;
  prof().coins += total + tip;
  const xpGain = Math.round(sat / 20) + (c.regularId ? 1 : 0);
  addXp(xpGain);
  const mood = sat >= 85 ? '😍' : sat >= 65 ? '😊' : sat >= 40 ? '😐' : '😠';
  popup(headPos(c), `<b>+${money(total)}</b>${tip ? `<small>+${money(tip)} tip</small>` : ''}<span>${mood}</span>`, correct ? 'good' : 'bad');
  if (!correct) popup(headPos(c).add(new THREE.Vector3(0, 0.4, 0)), 'Not what I ordered…', 'sad');
  sfx.play('coin');
  if (c.critic) {
    if (correct && sat >= 85 && quality >= 0.8) { st.critic = true; addXp(60); banner('🎩 The critic loved it! Reputation soars.', 'good'); sfx.play('level'); }
    else banner('🎩 The critic left a lukewarm review. Next time!', 'warn');
  }
  if (c.celebration) {
    if (correct) { prof().coins += 25; addXp(25); st.celebration = true; banner(`🎉 ${esc(c.name)} is thrilled with their celebration order! +$25`, 'good'); confetti(c.p.root.position); }
    else banner(`🎉 ${esc(c.name)}'s celebration order was wrong…`, 'warn');
  }
  maybeRegular(c, sat);
  c.p.cup.visible = true;
  if (c.pickup) { c.pickup.occ = null; c.pickup = null; }
  c.mood = mood;
  if (seat) {
    c.seat = seat; G.seatOcc.set(`${seat.x},${seat.z}`, c.id);
    c.state = 'toSeat';
    c.stay = (14 + rng() * 12) * c.td.stay;
    walkTo(c, seat, () => { c.state = 'sit'; });
  } else {
    leave(c, mood);
  }
  if (G.level?.tutorial && G.hintStage === 3) { G.hintStage = 4; hint('Lovely! Happy guests tip more. Seated guests enjoy your décor — build more between shifts.'); }
  updateHud(true);
}

function maybeRegular(c, sat) {
  const regs = prof().regulars;
  if (c.regularId) { const r = regs.find((q) => q.id === c.regularId); if (r) r.visits++; return; }
  if (sat >= 85 && rng() < 0.35 && c.type !== 'critic') {
    const r = { id: `r${Date.now().toString(36)}${rng().toString(36).slice(2, 5)}`, name: c.name, look: c.look, type: c.type, fav: c.order.recipe, loc: G.loc.id, visits: 1 };
    regs.push(r);
    if (regs.length > 30) regs.shift();
    G.stats.newRegulars++;
    popup(headPos(c).add(new THREE.Vector3(0, 0.5, 0)), `★ ${esc(c.name)} is now a regular!`, 'reg');
  }
}

function addXp(n) {
  const before = repLvl();
  prof().xp += n;
  const after = repLvl();
  if (after > before) { banner(`★ Reputation ${after}! New décor and upgrades unlocked.`, 'good'); sfx.play('level'); }
}

function tapCustomer(c) {
  if (G.phase !== 'service') return;
  if (c.state === 'queue' && c.slot === 0) { takeOrder(c, 'player'); return; }
  if (c.ticket && !c.ticket.maker) { openMaker(c.ticket); return; }
  if (c.ticket && c.ticket.maker === 'player') return;
  if (c.state === 'queue') toast(`${c.name} is waiting in line.`);
}

function confetti(pos) {
  for (let i = 0; i < 26; i++) {
    const m = mesh(box(0.06, 0.06, 0.02), mat(['#e0674f', '#f4cf6b', '#6f9a7a', '#5a86c5', '#e89ac2'][i % 5]), pos.x, 1.4, pos.z, fxGroup);
    m.userData.vel = new THREE.Vector3((rng() - 0.5) * 3, 2 + rng() * 2, (rng() - 0.5) * 3);
    m.userData.life = 1.6;
  }
}

// ---------------------------------------------------------------- per-frame customer update
function updateCustomers(dt, rdt) {
  for (const c of G.customers) {
    c.t += rdt;
    // movement
    if (c.path.length && c.pi < c.path.length) {
      const pos = c.p.root.position, tgt = c.path[c.pi];
      const dx = tgt.x - pos.x, dz = tgt.z - pos.z, dist = Math.hypot(dx, dz);
      const sp = 2.4 * dt;
      if (dist <= sp) { pos.x = tgt.x; pos.z = tgt.z; pos.y = tgt.y; c.pi++; }
      else {
        pos.x += (dx / dist) * sp; pos.z += (dz / dist) * sp;
        pos.y = lerp(pos.y, tgt.y, clamp(sp / Math.max(dist, 0.01), 0, 1));
        c.p.root.rotation.y = Math.atan2(dx, dz);
      }
      posePerson(c.p, dt > 0 ? 'walk' : 'idle', c.t);
      if (c.pi >= c.path.length) { c.path = []; const f = c.onArrive; c.onArrive = null; f?.(); }
    } else if (c.state === 'sit' && c.seat) {
      const sp = tileWorld(c.seat.x, c.seat.z);
      c.p.root.position.set(sp.x - c.seat.facing[0] * 0.06, sp.y, sp.z - c.seat.facing[1] * 0.06);
      c.p.root.rotation.y = Math.atan2(c.seat.facing[0], c.seat.facing[1]);
      posePerson(c.p, 'sit', c.t);
    } else {
      posePerson(c.p, 'idle', c.t);
      if (c.state === 'queue' || c.state === 'waitdrink') c.p.root.rotation.y = lerp(c.p.root.rotation.y, Math.PI, 0.1);
    }
    if (G.phase !== 'service' || dt === 0) continue;
    // patience
    if (['queue', 'shuffle', 'waitdrink', 'walkPickup'].includes(c.state) || (c.state === 'enter' && c.inside)) {
      c.patience -= dt; c.waited += dt;
      if (c.patience <= 0) {
        G.stats.walkouts++; recordSat(8);
        popup(headPos(c), 'Took too long!', 'sad');
        sfx.play('sad');
        leave(c, '😠');
      }
    }
    if (c.state === 'sit') {
      c.stay -= dt;
      if (c.stay <= 0) leave(c, c.mood);
    }
  }
  for (let i = G.customers.length - 1; i >= 0; i--) {
    const c = G.customers[i];
    if (c.gone) { peopleGroup.remove(c.p.root); c.bub.remove(); G.customers.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- staff
function updateStaff(dt, rdt) {
  const t = performance.now() / 1000;
  const working = G.maker != null;
  posePerson(G.me.p, working ? 'work' : 'idle', t);
  for (const a of G.agents) {
    posePerson(a.p, a.busy ? 'work' : 'idle', t + a.home.x);
    if (G.phase !== 'service' || dt === 0) { a.bub.style.display = 'none'; continue; }
    const role = a.m.role;
    if (role === 'barista') {
      if (!a.busy) {
        const tk = G.tickets.find((q) => !q.maker && canStaffMake(q));
        if (tk) {
          const steps = L.stepsFor(tk.recipe, tk.mod);
          const use = L.ingredientUse(steps);
          for (const [ing, n] of Object.entries(use)) consume(ing, n);
          tk.maker = a.m.id;
          let dur = 9.5 / a.m.speed * (hasEq('dualboiler') ? 0.75 : 1);
          if (G.machine?.broken && steps.some((s) => L.STEPS[s].machine)) dur *= 1.35;
          a.busy = { ticket: tk, t: 0, dur };
          renderRail();
        }
      } else {
        a.busy.t += dt;
        if (a.busy.t >= a.busy.dur) {
          const tk = a.busy.ticket; a.busy = null;
          const q = clamp(a.m.skill * 0.92 + rng() * 0.1 + (hasEq('grinder') ? 0.03 : 0) + (hasEq('wand') ? 0.03 : 0), 0.3, 1);
          const correct = rng() < 0.88 + a.m.skill * 0.12;
          if (G.tickets.includes(tk)) completeTicket(tk, null, q, correct);
          staffXp(a);
        }
      }
    } else if (role === 'cashier') {
      const c = G.queue[0];
      if (c && c.state === 'queue' && freePickup()) {
        a.t += dt;
        a.busy = { t: a.t, dur: 1.8 / a.m.speed };
        if (a.t >= 1.8 / a.m.speed) { a.t = 0; a.busy = null; if (takeOrder(c, 'staff')) staffXp(a, 0.5); }
      } else { a.t = 0; a.busy = null; }
    } else if (role === 'runner') {
      if (!a.busy && G.spills.length) a.busy = { spill: G.spills[0], t: 0, dur: 4 / a.m.speed };
      if (a.busy) {
        a.busy.t += dt;
        if (a.busy.t >= a.busy.dur) { cleanSpill(a.busy.spill); a.busy = null; staffXp(a); }
      }
    }
    // bubble
    if (a.busy) {
      a.bub.style.display = '';
      const p = a.busy.ticket ? L.RECIPES[a.busy.ticket.recipe].icon : role === 'runner' ? '🧽' : '🧾';
      a.bub.querySelector('.ico').textContent = p;
      a.bub.style.setProperty('--p', clamp(a.busy.t / a.busy.dur, 0, 1));
      a.bub.querySelector('.tag').textContent = a.m.name;
    } else a.bub.style.display = 'none';
  }
}
function staffXp(a, n = 1) {
  if (a.m.temp) return;
  if (L.staffGainXp(a.m, n)) popup(a.p.root.position.clone().add(new THREE.Vector3(0, 1.4, 0)), `⬆ ${esc(a.m.name)} reached Lv ${a.m.level}!`, 'reg');
}
function canStaffMake(tk) {
  const steps = L.stepsFor(tk.recipe, tk.mod);
  if (machineDown() && steps.some((s) => L.STEPS[s].machine)) return false;
  const use = L.ingredientUse(steps);
  for (const [ing, n] of Object.entries(use)) {
    if (ing === 'milk' && G.oat) continue;
    if ((G.site.stock[ing] || 0) < n) { lowStock(ing, true); return false; }
  }
  return true;
}
function consume(ing, n = 1) {
  if (ing === 'milk' && G.oat) { prof().coins -= 0.5 * n; G.stats.extraCost += 0.5 * n; return true; }
  const s = G.site.stock;
  if ((s[ing] || 0) < n) { lowStock(ing, true); return false; }
  s[ing] -= n;
  if (s[ing] <= 0) lowStock(ing, true);
  else if (s[ing] <= 3) lowStock(ing, false);
  return true;
}
const warned = new Set();
function lowStock(ing, out) {
  if (G.phase !== 'service') return;
  if (out) {
    if (!G.stats.stockouts[ing]) {
      G.stats.stockouts[ing] = 1;
      banner(`${L.INGREDIENTS[ing].icon} Out of ${L.INGREDIENTS[ing].name.toLowerCase()}! Use 📦 Rush order or take drinks off the menu.`, 'warn');
      sfx.play('warn');
    }
  } else if (!warned.has(ing)) {
    warned.add(ing);
    toast(`${L.INGREDIENTS[ing].icon} ${L.INGREDIENTS[ing].name} running low (${G.site.stock[ing]} left)`);
  }
}

// ================================================================ the bar (player drink making)
const STEP_ORDER = ['drip', 'shot', 'kettle', 'leaves', 'chai', 'matcha', 'cocoa', 'lemon', 'coldbrew', 'milk', 'steam', 'foam', 'cream', 'ice', 'vanilla', 'caramel'];
function barSteps() {
  const set = new Set();
  for (const r of availableRecipes()) for (const s of L.RECIPES[r].steps) set.add(s);
  if (G.loc.custom) for (const m of Object.values(L.MODS)) set.add(m.step);
  return STEP_ORDER.filter((s) => set.has(s));
}

function openMaker(tk) {
  if (G.phase !== 'service') return;
  if (G.maker && G.maker.ticket !== tk) closeMaker(true);
  if (tk.maker && tk.maker !== 'player') { toast('A barista is already on that one.'); return; }
  tk.maker = 'player';
  G.maker = { ticket: tk, made: [], qual: [], gauge: null };
  renderMaker();
  $('bar').classList.remove('hidden');
  renderRail();
  fitCamera();
  if (G.level?.tutorial && G.hintStage === 2) { G.hintStage = 3; hint('Tap the steps shown on the recipe card. For ☕ and ♨️, stop the needle in the green zone. Then press SERVE.'); }
}
function closeMaker(cancel) {
  if (!G.maker) return;
  if (cancel && G.tickets.includes(G.maker.ticket)) G.maker.ticket.maker = null;
  G.maker = null;
  $('bar').classList.add('hidden');
  renderRail();
  fitCamera();
}

function renderMaker() {
  const m = G.maker;
  if (!m) return;
  const tk = m.ticket, r = L.RECIPES[tk.recipe];
  const want = L.stepsFor(tk.recipe, tk.mod);
  const made = [...m.made];
  const chips = want.map((s) => {
    const k = made.indexOf(s);
    if (k >= 0) made.splice(k, 1);
    return `<span class="chip ${k >= 0 ? 'done' : ''}">${L.STEPS[s].icon} ${L.STEPS[s].name}</span>`;
  }).join('<i>›</i>');
  $('barRecipe').innerHTML = `
    <div class="bar-title"><span class="big">${r.icon}</span><div><b>${r.name}${tk.mod ? ` <em>+ ${L.MODS[tk.mod].name}</em>` : ''}</b><small>for ${esc(tk.cust.name)}${tk.cust.regularId ? ' ★' : ''}</small></div></div>
    ${save.hints || G.level?.tutorial ? `<div class="chips">${chips}</div>` : '<div class="chips muted">Recipe hints are off</div>'}`;
  const down = machineDown();
  $('barSteps').innerHTML = barSteps().map((s, i) => {
    const st = L.STEPS[s];
    const out = st.ing && !(st.ing === 'milk' && G.oat) && (G.site.stock[st.ing] || 0) <= 0;
    const broken = st.machine && down;
    return `<button class="step ${out || broken ? 'off' : ''}" data-step="${s}"><span>${st.icon}</span><b>${st.name}</b>${st.ing ? `<small>${st.ing === 'milk' && G.oat ? 'oat' : G.site.stock[st.ing] || 0}</small>` : ''}${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}</button>`;
  }).join('');
  $('barCup').innerHTML = m.made.length
    ? m.made.map((s, i) => `<i style="--c:${stepColor(s)}" title="${L.STEPS[s].name}">${L.STEPS[s].icon}${m.qual[i] < 0.999 ? `<small>${Math.round(m.qual[i] * 100)}%</small>` : ''}</i>`).join('')
    : '<em>empty cup</em>';
}
const stepColor = (s) => ({ shot: '#3a2011', drip: '#6b3f22', steam: '#f4efe6', foam: '#fffaf0', milk: '#f4efe6', cream: '#fffaf0', ice: '#cfe9f2', kettle: '#d9eef5', leaves: '#b5873a', coldbrew: '#4a2a18', cocoa: '#6e3b24', matcha: '#8fbf5a', chai: '#c08850', lemon: '#f4dc6b', vanilla: '#f6e7b0', caramel: '#d08a3a' }[s] || '#ccc');

$('barSteps').addEventListener('click', (e) => {
  const b = e.target.closest('[data-step]');
  if (b) addStep(b.dataset.step);
});

function addStep(s) {
  const m = G.maker;
  if (!m || m.gauge || G.paused) return;
  const st = L.STEPS[s];
  if (st.machine && machineDown()) { toast('The espresso machine is down!'); sfx.play('err'); return; }
  if (m.made.length >= 6) { toast('The cup is full — serve or trash it.'); return; }
  if (st.ing && !consume(st.ing)) { sfx.play('err'); renderMaker(); return; }
  if (st.timed) {
    let half = 0.1;
    if (s === 'shot' && hasEq('grinder')) half += 0.05;
    if (s === 'steam' && hasEq('wand')) half += 0.05;
    if (G.machine?.broken) half -= 0.03;
    m.gauge = { step: s, pos: 0, dir: 1, speed: G.machine?.broken ? 0.8 : 1.05, center: 0.35 + rng() * 0.3, half };
    sfx.play(s === 'shot' ? 'grind' : 'steam');
    renderGauge();
    $('gauge').classList.remove('hidden');
  } else {
    m.made.push(s); m.qual.push(1);
    sfx.play('tap');
    renderMaker();
  }
}
function renderGauge() {
  const gz = G.maker?.gauge;
  if (!gz) return;
  $('gaugeZone').style.left = `${(gz.center - gz.half) * 100}%`;
  $('gaugeZone').style.width = `${gz.half * 200}%`;
  $('gaugeLabel').textContent = gz.step === 'shot' ? 'Pull the shot — tap in the green!' : 'Steam the milk — tap in the green!';
}
function stopGauge() {
  const m = G.maker, gz = m?.gauge;
  if (!gz) return;
  const acc = L.gaugeAccuracy(gz.pos, gz.center, gz.half);
  m.made.push(gz.step); m.qual.push(acc);
  m.gauge = null;
  $('gauge').classList.add('hidden');
  const word = acc >= 0.95 ? 'Perfect!' : acc >= 0.85 ? 'Nice!' : acc >= 0.6 ? 'Okay' : 'Oops…';
  $('gaugeFlash').textContent = word; $('gaugeFlash').className = `flash on ${acc >= 0.85 ? 'good' : 'meh'}`;
  setTimeout(() => { $('gaugeFlash').className = 'flash'; }, 700);
  sfx.play(acc >= 0.85 ? 'ding' : 'tap');
  renderMaker();
}
$('gauge').addEventListener('pointerdown', (e) => { e.preventDefault(); stopGauge(); });

function serveMade() {
  const m = G.maker;
  if (!m || m.gauge) return;
  if (!m.made.length) { toast('Add the recipe steps first.'); return; }
  if (!consume('cups')) { sfx.play('err'); return; }
  const q = m.qual.reduce((a, b) => a + b, 0) / m.qual.length + (hasEq('grinder') ? 0.02 : 0);
  const tk = m.ticket, made = m.made;
  closeMaker(false);
  completeTicket(tk, made, clamp(q, 0, 1));
}
$('barTrash').addEventListener('click', () => { if (G.maker && !G.maker.gauge) { G.maker.made = []; G.maker.qual = []; sfx.play('pop'); renderMaker(); } });
$('barClose').addEventListener('click', () => closeMaker(true));

// the big context button: take order → make next → serve
function serveAction() {
  if (G.phase !== 'service' || G.paused) return;
  if (G.maker?.gauge) { stopGauge(); return; }
  if (G.maker) { serveMade(); return; }
  const c = G.queue[0];
  if (c && c.state === 'queue' && freePickup() && !G.agents.some((a) => a.m.role === 'cashier' && a.busy)) { takeOrder(c); return; }
  const needsMachine = (q) => L.stepsFor(q.recipe, q.mod).some((s) => L.STEPS[s].machine);
  const tk = G.tickets.find((q) => !q.maker && !(machineDown() && needsMachine(q))) || G.tickets.find((q) => !q.maker);
  if (tk) { openMaker(tk); return; }
  if (c && c.state === 'queue' && freePickup()) { takeOrder(c); return; }
  toast(G.customers.length ? 'Nothing to do right now — enjoy the vibe ☕' : 'Waiting for customers…');
}
$('serveBtn').addEventListener('click', serveAction);
function serveLabel() {
  if (G.maker?.gauge) return ['⏹', 'Stop'];
  if (G.maker) return ['🛎️', 'Serve'];
  const c = G.queue[0];
  if (c && c.state === 'queue' && freePickup()) return ['🧾', 'Take order'];
  if (G.tickets.some((q) => !q.maker)) return ['☕', 'Make next'];
  return ['🛎️', 'Serve'];
}

// ---------------------------------------------------------------- ticket rail
function renderRail() {
  const rail = $('rail');
  if (G.phase !== 'service') { rail.innerHTML = ''; return; }
  if (!G.tickets.length) { rail.innerHTML = '<div class="rail-empty">No orders yet — the rail is quiet.</div>'; return; }
  rail.innerHTML = G.tickets.map((tk) => {
    const r = L.RECIPES[tk.recipe];
    const maker = tk.maker === 'player' ? 'you' : tk.maker ? G.agents.find((a) => a.m.id === tk.maker)?.m.name || 'staff' : '';
    return `<button class="ticket ${tk.maker ? 'taken' : ''} ${G.maker?.ticket === tk ? 'active' : ''} ${tk.cust.critic ? 'critic' : ''} ${tk.cust.celebration ? 'party' : ''}" data-tk="${tk.id}">
      <span class="pin"></span><span class="ic">${r.icon}</span><b>${r.name}</b>${tk.mod ? `<em>+${L.MODS[tk.mod].name}</em>` : ''}
      <small>${esc(tk.cust.name)}${tk.cust.regularId ? ' ★' : ''}${tk.cust.critic ? ' 🎩' : ''}${tk.cust.celebration ? ' 🎉' : ''}</small>
      ${maker ? `<i class="by">${esc(maker)}</i>` : ''}<span class="pat"><i style="width:${clamp(tk.cust.patience / tk.cust.patienceMax, 0, 1) * 100}%"></i></span></button>`;
  }).join('');
}
$('rail').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tk]');
  if (!b) return;
  const tk = G.tickets.find((q) => q.id === +b.dataset.tk);
  if (tk) openMaker(tk);
});

// ================================================================ troubles, events, spills
function cleanSpill(s) {
  const i = G.spills.indexOf(s);
  if (i < 0) return;
  G.spills.splice(i, 1);
  fxGroup.remove(s.mesh);
  rebuildFurniture();
  sfx.play('pop');
  toast('Spill cleaned ✨');
}
function addSpill() {
  const tiles = [...G.grid.tiles.values()].filter((t) => {
    const k = `${t.x},${t.z}`;
    return G.grid.walkable(t.x, t.z) && !G.grid.reserved.has(k) && L.canPlace(G.grid, 'plant', t.x, t.z).ok && t.kind !== 'stairs';
  });
  if (!tiles.length) return false;
  // prefer tiles near the queue / entrance where people walk
  tiles.sort((a, b) => Math.abs(a.x - G.grid.ent.x) + Math.abs(a.z - G.grid.ent.z) - (Math.abs(b.x - G.grid.ent.x) + Math.abs(b.z - G.grid.ent.z)));
  const t = tiles[Math.min(tiles.length - 1, 1 + (rng() * 4 | 0))];
  const p = tileWorld(t.x, t.z);
  const m = new THREE.Group();
  const a = mesh(cyl(0.38, 0.38, 0.015, 18), mat('#8a5a3a', { roughness: 0.1, transparent: true, opacity: 0.85 }), 0, 0.06, 0, m); a.scale.z = 0.7; a.castShadow = false;
  mesh(cyl(0.16, 0.16, 0.016, 12), mat('#8a5a3a', { roughness: 0.1, transparent: true, opacity: 0.85 }), 0.3, 0.06, 0.18, m).castShadow = false;
  const cupm = mesh(cyl(0.05, 0.04, 0.1, 10), mat('#fffaf0'), -0.15, 0.08, 0.1, m); cupm.rotation.z = Math.PI / 2;
  const sign = new THREE.Group();
  mesh(box(0.3, 0.4, 0.02), mat('#ffd34d'), 0, 0.2, 0.06, sign).rotation.x = -0.25;
  mesh(box(0.3, 0.4, 0.02), mat('#ffd34d'), 0, 0.2, -0.06, sign).rotation.x = 0.25;
  sign.position.set(0.25, 0.06, -0.2); m.add(sign);
  m.position.copy(p);
  m.traverse((o) => { o.userData.spill = true; });
  fxGroup.add(m);
  const s = { x: t.x, z: t.z, mesh: m };
  m.traverse((o) => { o.userData.spillRef = s; });
  G.spills.push(s);
  rebuildFurniture();
  return true;
}

function showCard({ icon, title, text, options }) {
  G.paused = true;
  const el = $('trouble');
  el.innerHTML = `<div class="card note">
    <div class="tape"></div><div class="card-icon">${icon}</div><h3>${title}</h3><p>${text}</p>
    <div class="choices">${options.map((o, i) => {
      const cant = o.cost && prof().coins < o.cost;
      return `<button data-i="${i}" ${cant ? 'disabled' : ''}><b>${o.label}</b><small>${o.sub || ''}${o.cost ? ` · ${money(o.cost)}` : ''}</small></button>`;
    }).join('')}</div></div>`;
  el.classList.remove('hidden');
  el.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (!b || b.disabled) return;
    const o = options[+b.dataset.i];
    if (o.cost) { prof().coins -= o.cost; G.stats.extraCost += o.cost; }
    el.classList.add('hidden'); el.onclick = null;
    G.paused = false;
    sfx.play('tap');
    o.act?.();
    updateHud(true);
    renderMaker();
  };
  sfx.play('warn');
}

function triggerTrouble(type) {
  const menu = activeMenu();
  switch (type) {
    case 'machine': {
      G.machine = { broken: true, backup: false, fixIn: 0 };
      if (G.machineMesh?.userData.lamp) G.machineMesh.userData.lamp.material = glow('#ff4d4d', 2);
      const opts = [
        { label: 'Call a technician', sub: 'Fixed in ~8 seconds', cost: 45, act: () => { G.machine.fixIn = 8; } },
        { label: 'Fix it yourself', sub: 'Free, but takes ~35 seconds', act: () => { G.machine.fixIn = 35; } }
      ];
      if (hasEq('backup')) opts.unshift({ label: 'Switch to the backup station', sub: 'Free · a little slower until fixed (~30s)', act: () => { G.machine.backup = true; G.machine.fixIn = 30; } });
      else opts.push({ label: 'Pause espresso drinks', sub: 'Take them off the menu until it’s fixed (~30s)', act: () => { G.machine.fixIn = 30; G.machine.paused = true; menu.filter((m) => L.RECIPES[m.id].steps.some((s) => L.STEPS[s].machine)).forEach((m) => G.pausedRecipes.add(m.id)); drawChalkboard(); } });
      showCard({ icon: '🔧', title: 'The espresso machine jammed!', text: 'Shots and steamed milk are unavailable until it’s sorted. How do you want to handle it?', options: opts });
      break;
    }
    case 'rush': {
      showCard({
        icon: '🏃', title: 'A crowd is heading this way!', text: 'A tour group will arrive in about 15 seconds. Expect a long line.',
        options: [
          { label: 'Call in a temp barista', sub: 'Extra helper for the rest of the shift', cost: 30, act: () => { addTemp('barista'); } },
          { label: 'Simplify the menu', sub: 'Hide the two slowest drinks during the rush', act: () => { simplifyMenu(); } },
          { label: 'We’ve got this', sub: 'Accept a busier line', act: () => {} }
        ]
      });
      G.burstIn = 15; G.burst = 6;
      break;
    }
    case 'sick': {
      const staff = G.site.staff;
      if (!staff.length) { triggerTrouble('spill'); return; }
      const who = staff[rng() * staff.length | 0];
      G.sick = who.id;
      buildStaffAgents();
      showCard({
        icon: '🤒', title: `${esc(who.name)} called in sick`, text: `Your ${L.ROLES[who.role].name.toLowerCase()} is out for today.`,
        options: [
          { label: `Hire a temp ${L.ROLES[who.role].name.toLowerCase()}`, sub: 'Covers the whole shift', cost: Math.round(who.wage * 1.4), act: () => addTemp(who.role) },
          { label: 'Reassign roles', sub: `Switch another team member to ${L.ROLES[who.role].name.toLowerCase()}`, act: () => { const o = staff.find((s) => s.id !== who.id); if (o) { o.tempRole = o.role; o.role = who.role; buildStaffAgents(); toast(`${o.name} is covering as ${L.ROLES[who.role].name}`); } else toast('No one else to reassign — you’ll manage solo.'); } },
          { label: 'Manage without them', sub: 'You’ll pick up the slack', act: () => {} }
        ]
      });
      break;
    }
    case 'spill': {
      if (!addSpill()) return;
      showCard({
        icon: '💧', title: 'Spill on the floor!', text: 'Someone dropped a coffee. The puddle blocks the walkway and makes the café feel less cozy until it’s cleaned.',
        options: [
          { label: 'Grab the mop', sub: 'Tap the puddle to clean it', act: () => hint('Tap the puddle to mop it up 🧽') },
          { label: 'Pay a cleaner', sub: 'Cleaned instantly', cost: 15, act: () => cleanSpill(G.spills[G.spills.length - 1]) }
        ]
      });
      break;
    }
    case 'shortage': {
      const used = new Set(menu.flatMap((m) => L.RECIPES[m.id].steps.map((s) => L.STEPS[s].ing).filter(Boolean)));
      const ing = used.has('milk') ? 'milk' : used.has('ice') ? 'ice' : [...used][0];
      if (!ing) return;
      G.site.stock[ing] = Math.min(G.site.stock[ing], 3);
      const def = L.INGREDIENTS[ing];
      const opts = [
        { label: `Emergency ${def.name.toLowerCase()} order`, sub: `+${def.pack} at triple price`, cost: def.cost * 3, act: () => { G.site.stock[ing] += def.pack; } },
        { label: `Take ${def.name.toLowerCase()} drinks off the menu`, sub: 'For the rest of this shift', act: () => { menu.filter((m) => L.RECIPES[m.id].steps.some((s) => L.STEPS[s].ing === ing)).forEach((m) => G.pausedRecipes.add(m.id)); drawChalkboard(); } }
      ];
      if (ing === 'milk') opts.splice(1, 0, { label: 'Switch to oat milk', sub: 'Recipes still work · +$0.50 per milk step', act: () => { G.oat = true; } });
      else opts.push({ label: 'Ride it out', sub: `Only ${G.site.stock[ing]} left`, act: () => {} });
      showCard({ icon: '📦', title: `${def.name} shortage!`, text: `Your supplier came up short — you only have ${G.site.stock[ing]} ${def.name.toLowerCase()} left for today.`, options: opts });
      break;
    }
    case 'delivery': {
      const used = new Set(menu.flatMap((m) => L.RECIPES[m.id].steps.map((s) => L.STEPS[s].ing).filter(Boolean)));
      const ing = used.has('milk') ? 'milk' : 'beans';
      const def = L.INGREDIENTS[ing];
      const held = Math.max(1, Math.ceil(G.site.stock[ing] * 0.6));
      G.site.stock[ing] = Math.max(0, G.site.stock[ing] - held);
      G.lateDelivery = { ing, n: held, at: G.shiftLen * 0.55 };
      showCard({
        icon: '🚚', title: 'The delivery truck is stuck!', text: `${held} ${def.name.toLowerCase()} won’t arrive until mid-shift. You have ${G.site.stock[ing]} on hand.`,
        options: [
          { label: 'Pay a rush courier', sub: 'Arrives in ~20 seconds', cost: 25, act: () => { G.lateDelivery.at = G.t + 20; } },
          { label: 'Adjust the menu', sub: `Pause ${def.name.toLowerCase()} drinks until it arrives`, act: () => { G.lateDelivery.pause = true; menu.filter((m) => L.RECIPES[m.id].steps.some((s) => L.STEPS[s].ing === ing)).forEach((m) => G.pausedRecipes.add(m.id)); drawChalkboard(); } },
          { label: 'Make it stretch', sub: 'Keep serving and hope it lasts', act: () => {} }
        ]
      });
      break;
    }
    default: break;
  }
}
function addTemp(role) {
  G.tempStaff = G.tempStaff || [];
  G.tempStaff.push({ id: `t${G.nextId++}`, name: L.randomName(rng), role, speed: 0.9, skill: 0.7, level: 1, xp: 0, wage: 0, temp: true });
  buildStaffAgents();
  toast(`A temp ${L.ROLES[role].name.toLowerCase()} joined the shift!`);
}
function simplifyMenu() {
  const menu = activeMenu().sort((a, b) => L.RECIPES[b.id].steps.length - L.RECIPES[a.id].steps.length);
  menu.slice(0, Math.min(2, menu.length - 1)).forEach((m) => G.pausedRecipes.add(m.id));
  G.rushPause = true;
  drawChalkboard();
}

// ================================================================ shift flow
function newStats() {
  return { served: 0, drinks: 0, revenue: 0, tips: 0, satSum: 0, satCount: 0, wrong: 0, pricey: 0, noSeat: 0, walkouts: 0, takeaway: 0, custom: 0, featured: {}, stockouts: {}, quality: 0, waitSum: 0, missed: 0, pastry: 0, extraCost: 0, supplies: 0, newRegulars: 0, critic: false, celebration: false };
}

function levelFor(loc, idx) {
  if (!sandbox()) return L.LEVELS[loc.id][idx];
  const r = rng;
  const ev = Object.keys(L.EVENTS);
  const tr = Object.keys(L.TROUBLES);
  return { name: `Day ${(G.site?.day || 0) + 1}`, goals: [], recipes: loc.recipes.length, events: r() < 0.5 ? [ev[r() * ev.length | 0]] : [], troubles: r() < 0.6 ? [tr[r() * tr.length | 0]] : [], arrival: 1 };
}

function enterLocation(loc, idx) {
  G.loc = loc; G.site = siteFor(loc); G.levelIdx = idx; G.level = levelFor(loc, idx);
  G.events = [...(G.level.events || [])];
  G.spills = []; G.tempStaff = []; G.sick = null; G.machine = null; G.pausedRecipes = new Set(); G.oat = false;
  G.featured = null;
  if (G.events.includes('promo') || G.events.includes('festival')) {
    const opts = availableRecipes();
    G.featured = opts[(G.levelIdx * 3 + G.site.day) % opts.length];
    if (G.level.goals.some((g) => g.type === 'featured')) G.featured = G.level.goals.find((g) => g.type === 'featured').recipe;
  }
  clearCustomers();
  buildSite();
  startPrep();
}

function clearCustomers() {
  for (const c of G.customers) { peopleGroup.remove(c.p.root); c.bub.remove(); }
  G.customers = []; G.queue = []; G.tickets = []; G.seatOcc = new Map();
  bubbles.querySelectorAll('.pop').forEach((p) => p.remove());
}

function startPrep() {
  G.phase = 'prep'; G.screen = 'game';
  G.stats = newStats();
  showScreen('game');
  $('planner').classList.remove('hidden');
  $('hud').classList.remove('hidden');
  ['rail', 'goalCard', 'bar', 'serveBtn', 'buildTray', 'stockBtn'].forEach((id) => $(id).classList.add('hidden'));
  if (G.openSign) G.openSign.rotation.y = Math.PI;
  plannerTab(G.level.tutorial && G.site.day === 0 ? 'today' : G.tab || 'today');
  updateHud(true);
  drawChalkboard();
  fitCamera();
  spawnIdleRegulars();
}

function spawnIdleRegulars() {
  // a couple of friendly faces lounge around while you plan
  const seats = G.seats.slice(0, 2);
  for (const s of seats) {
    const p = buildPerson(randomLook(rng));
    const c = { id: G.nextId++, p, path: [], state: 'sit', seat: s, t: rng() * 5, bub: document.createElement('div'), td: L.CUSTOMER_TYPES.local, decor: true };
    G.customers.push(c);
    peopleGroup.add(p.root);
  }
}

function openShop() {
  // clear prep-time loungers
  clearCustomers();
  G.phase = 'service';
  G.build = null; clearGhost();
  G.t = 0; G.shiftLen = G.level.shift || G.loc.shift; G.ended = false;
  G.stats = newStats();
  G.stats.supplies = G.suppliesToday || 0; G.suppliesToday = 0;
  G.nextArrival = 2.5; G.burst = 0; G.burstIn = null;
  warned.clear();
  G.pickupOcc = G.grid.fixed.pickup.map((p) => ({ ...p, occ: null }));
  // troubles: spaced through the shift, starting troubles first
  const list = [...(G.level.troubles || [])];
  const startOnes = list.filter((t) => t === 'sick' || t === 'delivery');
  const mid = list.filter((t) => !startOnes.includes(t));
  G.troubles = [
    ...startOnes.map((type, i) => ({ type, at: 0.03 + i * 0.04 })),
    ...mid.map((type, i) => ({ type, at: 0.25 + (i + rng() * 0.6) * (0.45 / Math.max(1, mid.length)) }))
  ];
  G.critic = G.events.includes('critic') ? { at: 0.42 } : null;
  G.celebrationAt = G.events.includes('celebration') ? 0.3 : null;
  $('planner').classList.add('hidden');
  $('buildTray').classList.add('hidden');
  ['rail', 'goalCard', 'serveBtn', 'stockBtn'].forEach((id) => $(id).classList.remove('hidden'));
  if (G.openSign) G.openSign.rotation.y = 0;
  G.site.day++;
  persist();
  sfx.play('sign');
  buildStaffAgents();
  setRain(G.events.includes('rain'));
  renderRail(); renderGoalCard(); updateHud(true);
  fitCamera();
  G.hintStage = 0;
  if (G.level.tutorial) { G.hintStage = 1; hint('Doors open! When a guest reaches the register, tap them (or press TAKE ORDER).'); }
  const evs = G.events.map((e) => `${L.EVENTS[e].icon} ${L.EVENTS[e].name}`).join(' · ');
  if (evs) banner(`Today: ${evs}`, 'info');
}

function updateService(dt) {
  G.t += dt;
  const frac = G.t / G.shiftLen;
  // arrivals
  if (frac < 0.9) {
    G.nextArrival -= dt;
    if (G.nextArrival <= 0) {
      spawnCustomer();
      const mul = (G.level.arrival || 1) * expansionArrival() * (hasEq('sign') ? 1.15 : 1) * (G.events.includes('festival') ? 1.5 : 1) * (G.events.includes('rain') ? 0.75 : 1);
      G.nextArrival = L.arrivalInterval({ repLevel: repLvl(), comfort: G.comfort, mul, seats: G.seats.length }) * (0.6 + rng() * 0.8);
    }
    if (G.burstIn != null) {
      G.burstIn -= dt;
      if (G.burstIn <= 0) { G.burstIn = null; G.burstT = 0; banner('🏃 Here comes the rush!', 'warn'); }
    } else if (G.burst > 0) {
      G.burstT -= dt;
      if (G.burstT <= 0) { spawnCustomer({ type: G.loc.types.tourist ? 'tourist' : undefined }); G.burst--; G.burstT = 1.6; if (!G.burst && G.rushPause) { G.rushPause = false; G.pausedRecipes.clear(); drawChalkboard(); toast('Rush is over — full menu is back.'); } }
    }
    if (G.critic && frac >= G.critic.at) { G.critic = null; spawnCustomer({ type: 'critic', takeaway: false, patience: 60 }); banner('🎩 The food critic just walked in. Make it perfect!', 'info'); }
    if (G.celebrationAt != null && frac >= G.celebrationAt) {
      G.celebrationAt = null;
      const reg = prof().regulars.find((r) => r.loc === G.loc.id);
      const menu = activeMenu();
      const recipe = menu[menu.length - 1]?.id;
      const c = spawnCustomer({ regular: reg, recipe, celebration: true, patience: 75, takeaway: false, mod: G.loc.custom ? 'caramel' : null });
      if (c) { c.name = reg?.name || c.name; banner(`🎉 ${esc(c.name)} is celebrating today — their order: ${L.RECIPES[c.order.recipe].name}${c.order.mod ? ' + ' + L.MODS[c.order.mod].name : ''}.`, 'info'); }
    }
  }
  // troubles
  for (const tr of G.troubles) if (!tr.done && frac >= tr.at && !G.paused) { tr.done = true; triggerTrouble(tr.type); break; }
  if (G.machine?.broken && G.machine.fixIn > 0) {
    G.machine.fixIn -= dt;
    if (G.machine.fixIn <= 0) {
      G.machine = null;
      if (G.machineMesh?.userData.lamp) G.machineMesh.userData.lamp.material = glow('#9dff8a', 1.6);
      if (!G.rushPause) { G.pausedRecipes.clear(); drawChalkboard(); }
      toast('🔧 The espresso machine is working again!');
      renderMaker();
    }
  }
  if (G.lateDelivery && G.t >= G.lateDelivery.at) {
    G.site.stock[G.lateDelivery.ing] += G.lateDelivery.n;
    if (G.lateDelivery.pause) { G.pausedRecipes.clear(); drawChalkboard(); }
    toast(`🚚 Delivery arrived: +${G.lateDelivery.n} ${L.INGREDIENTS[G.lateDelivery.ing].name.toLowerCase()}`);
    G.lateDelivery = null;
    renderMaker();
  }
  // gauge needle
  // closing
  if (frac >= 1 && !G.ended) {
    if (!G.closingNote) { G.closingNote = true; banner('🌙 Closing time! Finish up the last orders.', 'info'); }
    const waiting = G.customers.filter((c) => c.state !== 'leave' && c.state !== 'sit');
    if (!waiting.length || G.t > G.shiftLen + 35) {
      for (const c of G.customers) if (c.state !== 'leave') leave(c, c.mood);
      // let everyone stroll out the door before the receipt prints
      if (!G.customers.length || G.t > G.shiftLen + 50) endShift();
    }
  }
}
const expansionArrival = () => G.site.expansions.reduce((a, id) => a * (G.loc.expansions.find((e) => e.id === id)?.arrival || 1), 1);

function endShift() {
  G.ended = true; G.closingNote = false;
  closeMaker(true);
  clearCustomers();
  G.phase = 'summary';
  const st = G.stats;
  const wages = G.site.staff.filter((s) => s.id !== G.sick).reduce((a, s) => a + s.wage, 0);
  prof().coins = Math.max(0, prof().coins - wages);
  // undo temporary role swaps
  for (const s of G.site.staff) if (s.tempRole) { s.role = s.tempRole; delete s.tempRole; }
  G.tempStaff = []; G.sick = null; G.oat = false; G.pausedRecipes.clear(); G.machine = null;
  for (const s of [...G.spills]) { fxGroup.remove(s.mesh); }
  G.spills = [];
  rebuildFurniture();
  buildStaffAgents();
  setRain(false);
  refreshCandidates(G.site, G.loc);
  const ctx = { repLevel: repLvl(), seats: G.seats.length };
  let result = null, rewardsHtml = '', unlockHtml = '';
  if (!sandbox()) {
    result = L.levelResult(G.level, st, ctx);
    const p = prof().progress;
    p[G.loc.id] = p[G.loc.id] || [];
    const wasLocUnlocked = L.LOCATIONS.map((_, i) => L.locationUnlocked(i, p));
    if (result.passed) p[G.loc.id][G.levelIdx] = Math.max(p[G.loc.id][G.levelIdx] || 0, result.stars);
    const rkey = `${G.loc.id}:${G.levelIdx}`;
    for (const r of result.res) {
      if (r.goal.optional && r.done && r.goal.reward && !prof().rewards[rkey]) {
        if (r.goal.reward.coins) { prof().coins += r.goal.reward.coins; rewardsHtml += `<li>🪙 Bonus: ${money(r.goal.reward.coins)}</li>`; }
        if (r.goal.reward.decor) { if (!prof().decor.includes(r.goal.reward.decor)) prof().decor.push(r.goal.reward.decor); rewardsHtml += `<li>🎁 New décor: ${L.FURNITURE[r.goal.reward.decor].name}</li>`; }
        prof().rewards[rkey] = true;
      }
    }
    L.LOCATIONS.forEach((l, i) => { if (!wasLocUnlocked[i] && L.locationUnlocked(i, p)) unlockHtml += `<li>📍 New location unlocked: <b>${l.name}</b></li>`; });
  }
  persist();
  showReceipt(st, wages, result, rewardsHtml, unlockHtml);
  ['rail', 'goalCard', 'serveBtn', 'stockBtn'].forEach((id) => $(id).classList.add('hidden'));
}

// ================================================================ HUD
const PHASES_DAY = ['Early morning', 'Late morning', 'Noon', 'Afternoon', 'Late afternoon', 'Evening'];
const PHASES_NIGHT = ['Dusk', 'Evening', 'Late evening', 'Night', 'Midnight', 'Small hours'];
function clockText() {
  const night = G.loc.night;
  const start = night ? 19 : 7, span = night ? 6 : 10;
  const frac = G.phase === 'service' ? clamp(G.t / G.shiftLen, 0, 1) : 0;
  const mins = Math.round((start + frac * span) * 60);
  let h = Math.floor(mins / 60) % 24, m = Math.floor(mins % 60 / 10) * 10;
  const ampm = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12;
  const phases = night ? PHASES_NIGHT : PHASES_DAY;
  return { time: `${h12}:${String(m).padStart(2, '0')} ${ampm}`, phase: G.phase === 'service' ? phases[Math.min(phases.length - 1, Math.floor(frac * phases.length))] : 'Before opening', frac };
}
function updateHud(force) {
  if (!G.loc) return;
  const p = prof();
  $('hLoc').textContent = G.loc.name;
  $('hLevel').textContent = sandbox() ? `Sandbox · Day ${G.site.day + (G.phase === 'prep' ? 1 : 0)}` : `Shift ${G.levelIdx + 1} · ${G.level.name}`;
  const ck = clockText();
  $('hTime').textContent = ck.time; $('hPhase').textContent = ck.phase;
  $('hClockFill').style.setProperty('--f', ck.frac);
  $('hCoins').textContent = money(Math.floor(p.coins));
  const h = G.stats?.satCount ? Math.round(G.stats.satSum / G.stats.satCount) : 100;
  $('hHappy').textContent = `${h}%`;
  $('hHappyBar').style.width = `${h}%`;
  $('hHappyFace').textContent = h >= 80 ? '😊' : h >= 60 ? '🙂' : h >= 40 ? '😐' : '😟';
  $('hRep').textContent = repLvl();
  $('hRepBar').style.width = `${L.repProgress(p.xp) * 100}%`;
  if (G.phase === 'service') {
    const [ic, lbl] = serveLabel();
    $('serveBtn').innerHTML = `<span>${ic}</span><b>${lbl}</b>`;
    renderGoalCard();
    if (force || Math.random() < 0.3) renderRail();
  }
}

function renderGoalCard() {
  const gc = $('goalCard');
  if (sandbox()) {
    const st = G.stats;
    gc.innerHTML = `<h4>Today’s notes</h4><ul class="checks"><li>☕ ${st.drinks} drinks served</li><li>🪙 ${money(st.revenue + st.tips)} earned</li><li>🪑 ${G.seats.length} seats · comfort ${G.comfort}</li>${G.featured ? `<li>⭐ Featured: ${L.RECIPES[G.featured].name}</li>` : ''}</ul>`;
    return;
  }
  const ctx = { repLevel: repLvl(), seats: G.seats.length };
  gc.innerHTML = `<h4>Goals</h4><ul class="checks">${G.level.goals.map((g) => {
    const pr = L.goalProgress(g, G.stats, ctx);
    const val = g.type === 'nostockout' ? (pr.done ? 'ok' : 'ran out') : g.type === 'critic' ? '' : `${pr.value}${pr.pct ? '%' : ''}/${pr.target}${pr.pct ? '%' : ''}`;
    return `<li class="${pr.done ? 'done' : ''} ${g.optional ? 'opt' : ''}"><i></i><span>${L.goalLabel(g)}${g.optional ? ' <em>bonus</em>' : ''}<small>${val}</small></span></li>`;
  }).join('')}</ul>${G.featured ? `<p class="feat">⭐ Featured: ${L.RECIPES[G.featured].name} (+50% tips)</p>` : ''}`;
}

let toastT = null;
function toast(msg) {
  const t = $('toast');
  t.innerHTML = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400);
}
let bannerT = null;
function banner(msg, kind = 'info') {
  const b = $('banner');
  b.className = `banner ${kind}`; b.innerHTML = msg;
  clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.add('hidden'), 5200);
}
function hint(msg) { if (save.hints || G.level?.tutorial) banner(`💡 ${msg}`, 'hint'); }

// ================================================================ planner (prep phase)
const TABS = [
  { id: 'today', label: 'Today', icon: '📋', color: '#f4cf6b' },
  { id: 'menu', label: 'Menu', icon: '☕', color: '#f2a488' },
  { id: 'pantry', label: 'Pantry', icon: '🫘', color: '#a9d3a0' },
  { id: 'team', label: 'Team', icon: '🧑‍🍳', color: '#a8c8ea' },
  { id: 'build', label: 'Decorate', icon: '🪴', color: '#d9b8f0' },
  { id: 'expand', label: 'Expand', icon: '🏗️', color: '#f6c48b' },
  { id: 'gear', label: 'Gear', icon: '⚙️', color: '#c9c3b8' }
];
$('plannerTabs').innerHTML = TABS.map((t) => `<button data-tab="${t.id}" style="--c:${t.color}"><span>${t.icon}</span><b>${t.label}</b></button>`).join('');
$('plannerTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { sfx.play('tap'); plannerTab(b.dataset.tab); } });

function plannerTab(id) {
  if (id === 'build') { startBuild(); return; }
  G.tab = id;
  document.querySelectorAll('#plannerTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
  const body = $('plannerBody');
  body.innerHTML = ({ today: tabToday, menu: tabMenu, pantry: tabPantry, team: tabTeam, expand: tabExpand, gear: tabGear })[id]();
  body.scrollTop = 0;
}

const TROUBLE_HINTS = {
  machine: 'The espresso machine has been rattling. A backup station would keep shots flowing.',
  delivery: 'Mountain roads are icy — deliveries may run late. Stock up early.',
  rush: 'A tour group might stop by. Extra staff or a simpler menu could help.',
  sick: 'A cold is going around the team. Have a backup plan.',
  spill: 'Floors get slippery when it’s busy. A runner cleans spills on their own.',
  shortage: 'Suppliers warn of shortages. Extra milk and ice could be wise.'
};

function tabToday() {
  const st = { satCount: 0 };
  const ctx = { repLevel: repLvl(), seats: G.seats.length };
  const goals = sandbox() ? '<p class="hand">No goals here — decorate, expand and experiment freely.</p>' : `<ul class="checks big">${G.level.goals.map((g) => {
    const pr = L.goalProgress(g, st, ctx);
    const pre = g.type === 'seats' || g.type === 'rep';
    return `<li class="${pre && pr.done ? 'done' : ''} ${g.optional ? 'opt' : ''}"><i></i><span>${L.goalLabel(g)}${g.optional ? ` <em>bonus${g.reward?.coins ? ` · ${money(g.reward.coins)}` : g.reward?.decor ? ` · ${L.FURNITURE[g.reward.decor].name}` : ''}</em>` : ''}${pre ? `<small>now ${pr.value}</small>` : ''}</span></li>`;
  }).join('')}</ul>`;
  const evs = G.events.map((e) => `<div class="forecast"><span>${L.EVENTS[e].icon}</span><div><b>${L.EVENTS[e].name}</b><small>${L.EVENTS[e].desc}${e === 'promo' || e === 'festival' ? ` Today’s star: <b>${L.RECIPES[G.featured].name}</b>.` : ''}</small></div></div>`).join('');
  const trs = (G.level.troubles || []).map((t) => `<div class="forecast warn"><span>⚠️</span><div><b>Heads-up</b><small>${TROUBLE_HINTS[t]}</small></div></div>`).join('');
  const menu = activeMenu();
  const need = new Map();
  for (const m of menu) for (const [ing] of Object.entries(L.ingredientsForRecipe(m.id))) need.set(ing, true);
  const low = [...need.keys()].filter((ing) => (G.site.stock[ing] || 0) < 6);
  const tut = G.level.tutorial ? `<div class="howto-mini">
      <p><b>How a shift works</b></p>
      <ol><li>Guests line up at the register — tap them to take their order.</li>
      <li>Tickets clip onto the rail. Tap one to make the drink at the bar.</li>
      <li>Follow the recipe steps, stop the needle in the green, then <b>Serve</b>.</li>
      <li>Quick, accurate drinks earn tips. Cozy décor and seats keep guests happy.</li></ol></div>` : '';
  return `
    <h2 class="hand">${sandbox() ? 'Sandbox day' : esc(G.level.name)}</h2>
    <p class="muted">${esc(G.loc.blurb)}</p>
    ${tut}
    <h3>${sandbox() ? 'Notes' : 'Goals'}</h3>${goals}
    ${evs || trs ? `<h3>Forecast</h3>${evs}${trs}` : '<h3>Forecast</h3><p class="muted">Clear skies, a steady trickle of guests.</p>'}
    <h3>Café check</h3>
    <div class="stats-row">
      <div><b>${G.seats.length}</b><small>seats</small></div>
      <div><b>${G.comfort}</b><small>comfort</small></div>
      <div><b>${menu.length}</b><small>drinks</small></div>
      <div><b>${G.site.staff.length}</b><small>staff</small></div>
    </div>
    ${low.length ? `<p class="alert">Low stock: ${low.map((i) => `${L.INGREDIENTS[i].icon} ${L.INGREDIENTS[i].name} (${G.site.stock[i] || 0})`).join(', ')} — visit the Pantry.</p>` : '<p class="ok">Pantry looks well stocked.</p>'}`;
}

function tabMenu() {
  const avail = availableRecipes();
  const locked = G.loc.recipes.filter((r) => !avail.includes(r));
  return `<h2 class="hand">The menu board</h2><p class="muted">Turn drinks on or off and set prices. Higher prices earn more per cup, but fewer guests will order.</p>
    <div class="menu-list">${G.site.menu.filter((m) => avail.includes(m.id)).map((m) => {
      const r = L.RECIPES[m.id];
      const acc = L.priceAcceptance(m.price, r.price);
      return `<div class="menu-item ${m.on ? '' : 'off'}">
        <button class="tog" data-act="tog" data-id="${m.id}" aria-label="Toggle">${m.on ? '✔' : ''}</button>
        <span class="ic">${r.icon}</span>
        <div class="nm"><b>${r.name}</b><small>${r.steps.map((s) => L.STEPS[s].icon).join(' ')} · base ${money(r.price)}</small>
          <span class="demand" title="Demand"><i style="width:${acc * 100}%;background:${acc > 0.7 ? '#6f9a7a' : acc > 0.4 ? '#e9b95a' : '#e0674f'}"></i></span></div>
        <div class="price"><button data-act="price" data-id="${m.id}" data-d="-0.25">−</button><b>${money(m.price)}</b><button data-act="price" data-id="${m.id}" data-d="0.25">+</button></div>
      </div>`;
    }).join('')}</div>
    ${locked.length ? `<p class="muted">Coming in later shifts: ${locked.map((r) => `${L.RECIPES[r].icon} ${L.RECIPES[r].name}`).join(', ')}</p>` : ''}`;
}

function tabPantry() {
  const need = new Set(['cups']);
  for (const id of availableRecipes()) for (const s of L.RECIPES[id].steps) if (L.STEPS[s].ing) need.add(L.STEPS[s].ing);
  if (G.loc.custom) need.add('syrup');
  if (hasEq('pastrycase')) need.add('pastry');
  const menu = activeMenu();
  const usage = {};
  for (const m of menu) for (const [ing, n] of Object.entries(L.ingredientsForRecipe(m.id))) usage[ing] = (usage[ing] || 0) + n;
  return `<h2 class="hand">Pantry shelf</h2><p class="muted">Each drink uses a cup plus its ingredients. Running out mid-shift means unhappy guests.</p>
    <div class="pantry">${[...need].map((ing) => {
      const d = L.INGREDIENTS[ing], have = G.site.stock[ing] || 0;
      return `<div class="jar ${have < 6 ? 'low' : ''}"><span class="ic">${d.icon}</span><b>${d.name}</b><small>${have} in stock${usage[ing] ? ` · used by ${menu.filter((m) => L.ingredientsForRecipe(m.id)[ing]).length} drinks` : ''}</small>
        <div class="fill"><i style="width:${Math.min(100, have * 3)}%"></i></div>
        <div class="buy"><button data-act="buy" data-ing="${ing}" data-n="1">+${d.pack} · ${money(d.cost)}</button><button data-act="buy" data-ing="${ing}" data-n="3">+${d.pack * 3} · ${money(d.cost * 3 * 0.9)}</button></div></div>`;
    }).join('')}</div>`;
}

function tabTeam() {
  const s = G.site;
  const max = sandbox() ? 6 : G.loc.maxStaff;
  const member = (m, hired) => `<div class="staff-card ${hired ? 'hired' : ''}">
    <div class="face" style="background:${m.look?.shirt || '#e9dcc0'}">${L.ROLES[m.role].icon}</div>
    <div class="info"><b>${esc(m.name)}${hired ? ` <em>Lv ${m.level}</em>` : ''}</b>
      <small>Speed ${'●'.repeat(Math.round(m.speed * 4))}${'○'.repeat(Math.max(0, 6 - Math.round(m.speed * 4)))} · Skill ${Math.round(m.skill * 100)}</small>
      <small>${money(m.wage)}/shift</small></div>
    ${hired ? `<div class="acts"><select data-act="role" data-id="${m.id}">${Object.entries(L.ROLES).map(([k, r]) => `<option value="${k}" ${k === m.role ? 'selected' : ''}>${r.icon} ${r.name}</option>`).join('')}</select><button data-act="fire" data-id="${m.id}">Let go</button></div>`
    : `<div class="acts"><span class="role">${L.ROLES[m.role].icon} ${L.ROLES[m.role].name}</span><button data-act="hire" data-id="${m.id}" ${s.staff.length >= max ? 'disabled' : ''}>Hire</button></div>`}
  </div>`;
  return `<h2 class="hand">The team</h2><p class="muted">Baristas make drinks, cashiers take orders, runners clean spills and keep guests patient. Wages are paid at closing. Staff level up as they work.</p>
    <h3>On the roster (${s.staff.length}/${max})</h3>${s.staff.length ? s.staff.map((m) => member(m, true)).join('') : '<p class="muted hand">Just you behind the counter for now.</p>'}
    <h3>Looking for work</h3>${s.candidates.map((m) => member(m, false)).join('')}
    <div class="roles">${Object.values(L.ROLES).map((r) => `<span>${r.icon} <b>${r.name}</b> — ${r.desc}</span>`).join('')}</div>`;
}

function tabExpand() {
  const rep = repLvl();
  return `<h2 class="hand">Grow the café</h2><p class="muted">More space brings more customers — and more need for staff and supplies.</p>
    ${G.loc.expansions.map((e) => {
      const owned = G.site.expansions.includes(e.id);
      const locked = !sandbox() && rep < e.rep;
      return `<div class="expansion ${owned ? 'owned' : ''} ${locked ? 'locked' : ''}">
        <div class="ex-ic">${e.kind === 'patio' ? '☀️' : e.kind === 'loft' ? '🪜' : e.kind === 'takeaway' ? '🥡' : '🪟'}</div>
        <div class="info"><b>${e.name}</b><small>${e.desc}</small>
          <small>${e.rects.length ? `+${e.rects.reduce((a, r) => a + (r[2] - r[0] + 1) * (r[3] - r[1] + 1), 0)} tiles` : 'Service upgrade'}${e.arrival ? ` · +${Math.round((e.arrival - 1) * 100)}% guests` : ''}</small></div>
        ${owned ? '<span class="stamp">Built</span>' : locked ? `<span class="lock">🔒 ★${e.rep}</span>` : `<button data-act="expand" data-id="${e.id}" ${prof().coins < e.cost ? 'disabled' : ''}>Build · ${money(e.cost)}</button>`}
      </div>`;
    }).join('')}`;
}

function tabGear() {
  const rep = repLvl();
  return `<h2 class="hand">Equipment</h2><p class="muted">Better tools make better drinks and smoother shifts.</p>
    ${Object.entries(L.EQUIPMENT).map(([id, e]) => {
      const owned = hasEq(id), locked = !sandbox() && rep < (e.rep || 0);
      return `<div class="expansion ${owned ? 'owned' : ''} ${locked ? 'locked' : ''}"><div class="ex-ic">${e.icon}</div><div class="info"><b>${e.name}</b><small>${e.desc}</small></div>
      ${owned ? '<span class="stamp">Owned</span>' : locked ? `<span class="lock">🔒 ★${e.rep}</span>` : `<button data-act="gear" data-id="${id}" ${prof().coins < e.cost ? 'disabled' : ''}>Buy · ${money(e.cost)}</button>`}</div>`;
    }).join('')}`;
}

$('plannerBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const s = G.site, p = prof();
  const act = b.dataset.act;
  if (act === 'tog') {
    const m = s.menu.find((q) => q.id === b.dataset.id);
    if (m.on && activeMenu().length <= 1) { toast('Keep at least one drink on the menu!'); return; }
    m.on = !m.on;
  } else if (act === 'price') {
    const m = s.menu.find((q) => q.id === b.dataset.id);
    m.price = clamp(Math.round((m.price + +b.dataset.d) * 4) / 4, 1, 15);
  } else if (act === 'buy') {
    const d = L.INGREDIENTS[b.dataset.ing], n = +b.dataset.n, cost = d.cost * n * (n > 1 ? 0.9 : 1);
    if (p.coins < cost) { toast('Not enough coins.'); sfx.play('err'); return; }
    p.coins -= cost; s.stock[b.dataset.ing] = (s.stock[b.dataset.ing] || 0) + d.pack * n;
    G.suppliesToday = (G.suppliesToday || 0) + cost;
    sfx.play('coin');
  } else if (act === 'hire') {
    const c = s.candidates.find((q) => q.id === b.dataset.id);
    s.candidates = s.candidates.filter((q) => q !== c);
    c.look = randomLook(rng);
    s.staff.push(c);
    buildStaffAgents();
    sfx.play('ding'); toast(`${c.name} joined the team!`);
  } else if (act === 'fire') {
    s.staff = s.staff.filter((q) => q.id !== b.dataset.id);
    buildStaffAgents();
  } else if (act === 'expand') {
    const e = G.loc.expansions.find((q) => q.id === b.dataset.id);
    if (p.coins < e.cost) return;
    p.coins -= e.cost;
    s.expansions.push(e.id);
    buildSite(); fitCamera();
    sfx.play('level'); toast(`${e.name} is ready!`);
  } else if (act === 'gear') {
    const e = L.EQUIPMENT[b.dataset.id];
    if (p.coins < e.cost) return;
    p.coins -= e.cost; s.equipment.push(b.dataset.id);
    buildSite(); fitCamera();
    sfx.play('coin'); toast(`${e.name} installed!`);
  }
  persist();
  drawChalkboard();
  updateHud(true);
  plannerTab(G.tab);
});
$('plannerBody').addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-act="role"]');
  if (!sel) return;
  const m = G.site.staff.find((q) => q.id === sel.dataset.id);
  if (m) { m.role = sel.value; buildStaffAgents(); persist(); }
});
$('openBtn').addEventListener('click', () => {
  if (!activeMenu().length) { toast('Put at least one drink on the menu first!'); return; }
  $('openBtn').classList.add('flip');
  setTimeout(() => { $('openBtn').classList.remove('flip'); openShop(); }, 520);
});
$('plannerHome').addEventListener('click', () => { persist(); goJourney(); });

// ================================================================ build mode
const ghostMat = { ok: new THREE.MeshBasicMaterial({ color: '#7fe08a', transparent: true, opacity: 0.45, depthWrite: false }), bad: new THREE.MeshBasicMaterial({ color: '#ff6b6b', transparent: true, opacity: 0.45, depthWrite: false }) };
let ghost = null, ghostTile = null, hoverTiles = [];
function startBuild() {
  G.build = { cat: G.build?.cat || 'seat', tool: 'place', type: null, carry: null };
  $('planner').classList.add('hidden');
  $('buildTray').classList.remove('hidden');
  renderTray();
  fitCamera();
  showTileGrid(true);
}
function endBuild() {
  if (G.build?.carry) { G.site.layout.push(G.build.carry); rebuildFurniture(); }
  G.build = null;
  clearGhost();
  showTileGrid(false);
  $('buildTray').classList.add('hidden');
  $('planner').classList.remove('hidden');
  plannerTab('today');
  fitCamera();
  persist();
}
function showTileGrid(on) {
  for (const t of hoverTiles) siteGroup.remove(t);
  hoverTiles = [];
  if (!on) return;
  for (const t of G.grid.tiles.values()) {
    const k = `${t.x},${t.z}`;
    if (G.grid.fixed.blocked.has(k)) continue;
    const p = tileWorld(t.x, t.z);
    const reserved = G.grid.reserved.has(k);
    const m = new THREE.Mesh(box(0.9, 0.01, 0.9), new THREE.MeshBasicMaterial({ color: reserved ? '#e0674f' : '#fffaf0', transparent: true, opacity: reserved ? 0.25 : 0.14, depthWrite: false }));
    m.position.set(p.x, p.y + 0.012, p.z);
    siteGroup.add(m); hoverTiles.push(m);
  }
}
function clearGhost() { if (ghost) { scene.remove(ghost); ghost = null; } ghostTile = null; }

let thumbs = null;
function makeThumbs() {
  if (thumbs) return thumbs;
  thumbs = {};
  try {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(112, 112); r.outputColorSpace = THREE.SRGBColorSpace;
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight('#ffffff', '#b09070', 2.2));
    const dl = new THREE.DirectionalLight('#ffffff', 1.6); dl.position.set(3, 5, 4); sc.add(dl);
    const cm = new THREE.OrthographicCamera(-0.8, 0.8, 0.8, -0.8, 0.1, 20);
    cm.position.set(3, 2.6, 3); cm.lookAt(0, 0.45, 0);
    for (const type of Object.keys(L.FURNITURE)) {
      const m = buildFurniture(type, L.LOCATIONS[0].palette);
      const bb = new THREE.Box3().setFromObject(m), size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
      const sz = Math.max(size.x, size.y, size.z);
      m.position.sub(ctr).add(new THREE.Vector3(0, 0.45, 0));
      const k = 1.1 / sz; m.scale.setScalar(k); m.position.multiplyScalar(k); m.position.y += 0.45 * (1 - k);
      sc.add(m); r.render(sc, cm); thumbs[type] = r.domElement.toDataURL(); sc.remove(m);
    }
    r.dispose();
    r.forceContextLoss?.();
  } catch { /* thumbnails are optional */ }
  return thumbs;
}

function renderTray() {
  const b = G.build;
  const th = makeThumbs();
  const items = Object.entries(L.FURNITURE).filter(([, f]) => f.cat === b.cat);
  $('trayCats').innerHTML = L.FURNITURE_CATS.map((c) => `<button data-cat="${c.id}" class="${c.id === b.cat ? 'on' : ''}"><span>${c.icon}</span><b>${c.name}</b></button>`).join('')
    + `<span class="sep"></span><button data-tool="move" class="${b.tool === 'move' ? 'on' : ''}"><span>✋</span><b>Move</b></button><button data-tool="sell" class="${b.tool === 'sell' ? 'on' : ''}"><span>🗑️</span><b>Sell</b></button>`;
  $('trayItems').innerHTML = items.map(([id, f]) => {
    const unlocked = furnUnlocked(id);
    const sel = b.tool === 'place' && b.type === id;
    return `<button data-item="${id}" class="${sel ? 'on' : ''} ${unlocked ? '' : 'locked'}" ${unlocked ? '' : 'disabled'}>
      ${th[id] ? `<img src="${th[id]}" alt="">` : '<span class="ph">🪑</span>'}<b>${f.name}</b><small>${unlocked ? `${money(f.cost)} · +${f.comfort} comfy` : f.reward ? '🎁 bonus reward' : `🔒 ★${f.rep}`}</small></button>`;
  }).join('');
  $('trayInfo').innerHTML = `<div>🪑 <b>${G.seats.length}</b> seats · 🌿 comfort <b>${G.comfort}</b> · 🪙 ${money(Math.floor(prof().coins))}</div><span>${b.carry ? `Carrying: ${L.FURNITURE[b.carry.type].name} — tap a tile to drop it` : b.tool === 'sell' ? 'Tap furniture to sell it for half price' : b.tool === 'move' ? 'Tap furniture to pick it up' : b.type ? 'Tap a tile to place. Red tiles keep the line clear.' : 'Pick something to place'}</span>`;
}
$('buildTray').addEventListener('click', (e) => {
  const b = G.build; if (!b) return;
  const cat = e.target.closest('[data-cat]'), tool = e.target.closest('[data-tool]'), item = e.target.closest('[data-item]');
  if (cat) { b.cat = cat.dataset.cat; b.tool = 'place'; b.type = null; }
  if (tool) { b.tool = b.tool === tool.dataset.tool ? 'place' : tool.dataset.tool; b.type = null; clearGhost(); }
  if (item && !item.disabled) { b.tool = 'place'; b.type = item.dataset.item; clearGhost(); }
  if (e.target.closest('#trayDone')) { endBuild(); return; }
  sfx.play('tap');
  renderTray();
});

function buildHover(tile) {
  const b = G.build;
  if (!b) return;
  const type = b.carry ? b.carry.type : b.tool === 'place' ? b.type : null;
  if (!type || !tile) { clearGhost(); return; }
  if (ghostTile && ghostTile.x === tile.x && ghostTile.z === tile.z && ghost?.userData.type === type) return;
  clearGhost();
  ghostTile = tile;
  const ok = L.canPlace(G.grid, type, tile.x, tile.z).ok;
  ghost = buildFurniture(type, G.loc.palette);
  ghost.userData.type = type;
  ghost.traverse((o) => { if (o.isMesh) { o.material = ok ? ghostMat.ok : ghostMat.bad; o.castShadow = false; } });
  ghost.position.copy(tileWorld(tile.x, tile.z));
  const seatMap = new Map();
  ghost.rotation.y = orientation({ type, x: tile.x, z: tile.z }, seatMap);
  scene.add(ghost);
}

function buildTap(tile, furn) {
  const b = G.build, p = prof();
  if (b.carry) {
    if (!tile) return;
    const chk = L.canPlace(G.grid, b.carry.type, tile.x, tile.z);
    if (!chk.ok) { toast(chk.reason); sfx.play('err'); return; }
    b.carry.x = tile.x; b.carry.z = tile.z;
    G.site.layout.push(b.carry); b.carry = null;
    sfx.play('pop');
  } else if (b.tool === 'sell' || b.tool === 'move') {
    if (!furn) return;
    G.site.layout = G.site.layout.filter((f) => f !== furn);
    if (b.tool === 'sell') { p.coins += Math.floor(L.FURNITURE[furn.type].cost / 2); sfx.play('coin'); }
    else { b.carry = furn; sfx.play('pop'); }
  } else if (b.type) {
    if (!tile) return;
    const f = L.FURNITURE[b.type];
    if (p.coins < f.cost) { toast('Not enough coins.'); sfx.play('err'); return; }
    const chk = L.canPlace(G.grid, b.type, tile.x, tile.z);
    if (!chk.ok) { toast(chk.reason); sfx.play('err'); return; }
    p.coins -= f.cost;
    G.site.layout.push({ type: b.type, x: tile.x, z: tile.z });
    sfx.play('pop');
  }
  rebuildFurniture();
  showTileGrid(true);
  clearGhost();
  updateHud(true);
  renderTray();
  persist();
}

// ================================================================ input
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const pointers = new Map();
let drag = null;
function pick(cx, cy) {
  ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const res = { tile: null, furn: null, cust: null, spill: null };
  if (G.phase === 'service') {
    const hits = ray.intersectObjects([...peopleGroup.children, ...fxGroup.children], true);
    for (const h of hits) {
      if (h.object.userData.cust && !h.object.userData.cust.decor) { res.cust = h.object.userData.cust; break; }
      if (h.object.userData.spillRef) { res.spill = h.object.userData.spillRef; break; }
    }
  }
  if (G.build) {
    const fh = ray.intersectObjects(furnGroup.children, true);
    if (fh.length) res.furn = fh[0].object.userData.furn;
    const th = ray.intersectObjects(G.tileMeshes, false);
    if (th.length) res.tile = th[0].object.userData.tile;
    if (res.furn && !res.tile) res.tile = { x: res.furn.x, z: res.furn.z };
  }
  return res;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  renderer.domElement.setPointerCapture(e.pointerId);
  if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: false, pan: cam.pan.clone() };
  else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom, moved: true }; }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (drag && pointers.size === 2 && drag.pinch) {
    const [a, b] = [...pointers.values()];
    cam.zoom = clamp(drag.zoom * Math.hypot(a.x - b.x, a.y - b.y) / drag.pinch, 0.7, 2.6); applyCamera();
    return;
  }
  if (drag && pointers.size === 1 && !drag.pinch) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 8) drag.moved = true;
    if (drag.moved && G.screen === 'game') {
      const s = cam.s / cam.zoom;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      cam.pan.copy(drag.pan).addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
      const lim = Math.max(G.loc.w, G.loc.d) * 0.6;
      cam.pan.clampLength(0, lim);
      applyCamera();
    }
  }
  if (G.build && e.pointerType !== 'touch') { const r = pick(e.clientX, e.clientY); buildHover(r.tile); }
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (drag && !drag.moved && !drag.pinch && pointers.size === 0) {
    const r = pick(e.clientX, e.clientY);
    if (G.build) { if (e.pointerType === 'touch' && r.tile && !(ghostTile && ghostTile.x === r.tile.x && ghostTile.z === r.tile.z) && !G.build.carry && G.build.tool === 'place') buildHover(r.tile); else buildTap(r.tile, r.furn); }
    else if (r.spill) cleanSpill(r.spill);
    else if (r.cust) tapCustomer(r.cust);
  }
  if (pointers.size === 0) drag = null;
};
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; });
renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); cam.zoom = clamp(cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.7, 2.6); applyCamera(); }, { passive: false });

window.addEventListener('keydown', (e) => {
  if (G.phase !== 'service' || G.paused) {
    if (e.key === 'Escape' && G.build) endBuild();
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); serveAction(); return; }
  if (e.key === 'Escape') { if (G.maker) closeMaker(true); else openPause(); return; }
  const n = parseInt(e.key, 10);
  if (G.maker && n >= 1 && n <= 9) { const s = barSteps()[n - 1]; if (s) addStep(s); }
});

// ================================================================ rain
function setRain(on) {
  if (G.rain) { scene.remove(G.rain); G.rain = null; }
  if (!on) return;
  const n = 600, pos = new Float32Array(n * 6);
  const W = G.loc.w + 10, D = G.loc.d + 10;
  for (let i = 0; i < n; i++) {
    const x = (rng() - 0.5) * W, y = rng() * 6, z = (rng() - 0.5) * D;
    pos.set([x, y, z, x - 0.04, y - 0.3, z], i * 6);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  G.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#cfe3f2', transparent: true, opacity: 0.55 }));
  scene.add(G.rain);
}
function updateRain(dt) {
  if (!G.rain) return;
  const a = G.rain.geometry.attributes.position, arr = a.array;
  for (let i = 0; i < arr.length; i += 6) {
    arr[i + 1] -= dt * 9; arr[i + 4] -= dt * 9;
    // keep rain off the roofless interior: drops inside the café vanish at roof height
    if (arr[i + 4] < 0) { arr[i + 1] += 6; arr[i + 4] += 6; }
  }
  a.needsUpdate = true;
}

// ================================================================ lighting by time of day
function updateLighting() {
  if (!G.loc) return;
  const frac = G.phase === 'service' ? clamp(G.t / G.shiftLen, 0, 1) : 0.15;
  const night = G.loc.night;
  const ang = lerp(-0.9, 0.9, frac);
  const W = G.loc.w;
  sun.position.set(Math.sin(ang) * 10 + 8, night ? 12 : 16 - Math.abs(ang) * 4, 14);
  sun.target.position.set(0, 0, 0);
  const rainy = G.rain != null;
  if (night) { sun.color.set('#9aa8ff'); sun.intensity = 0.9; hemi.intensity = 0.7; }
  else {
    const warm = Math.abs(frac - 0.5) * 2;
    sun.color.setRGB(1, lerp(0.93, 0.78, warm), lerp(0.85, 0.6, warm));
    sun.intensity = rainy ? 1.2 : lerp(2.5, 1.9, warm);
    hemi.intensity = rainy ? 0.85 : 1.1;
  }
  scene.background.set(rainy ? '#b8c4cc' : G.loc.palette.sky);
  void W;
}

// ================================================================ bubbles over heads
const tmpV = new THREE.Vector3();
function updateBubbles() {
  const W = window.innerWidth, H = window.innerHeight;
  for (const c of G.customers) {
    if (c.decor) continue;
    const el = c.bub;
    let ico = '', tag = '', show = true, cls = '';
    if (c.state === 'leave') { ico = c.mood || ''; show = !!c.mood && c.inside !== false; cls = 'mood'; }
    else if (c.state === 'sit') { show = false; }
    else if (c.state === 'toSeat') { ico = c.mood; cls = 'mood'; }
    else if (c.state === 'queue' && c.slot === 0) { ico = '🧾'; tag = 'Order!'; cls = 'ready'; }
    else if (c.state === 'queue' || c.state === 'shuffle' || c.state === 'enter') { ico = L.RECIPES[c.order.recipe].icon; cls = 'dim'; }
    else if (c.ticket) { ico = L.RECIPES[c.order.recipe].icon; tag = c.order.mod ? `+${L.MODS[c.order.mod].name}` : ''; cls = c.ticket.maker ? 'making' : 'wait'; }
    if (c.critic) tag = '🎩 Critic';
    if (c.celebration && c.state !== 'leave') tag = '🎉';
    if (c.regularId && !tag) tag = `★ ${c.name}`;
    if (!show || G.phase !== 'service') { el.style.display = 'none'; continue; }
    el.style.display = '';
    tmpV.copy(c.p.root.position); tmpV.y += 1.22 * (c.look.scale || 1);
    tmpV.project(camera);
    el.style.transform = `translate(${(tmpV.x * 0.5 + 0.5) * W}px, ${(-tmpV.y * 0.5 + 0.5) * H}px) translate(-50%, -100%)`;
    if (el._ico !== ico) { el.querySelector('.ico').textContent = ico; el._ico = ico; }
    if (el._tag !== tag) { el.querySelector('.tag').textContent = tag; el._tag = tag; }
    const pf = clamp(c.patience / c.patienceMax, 0, 1);
    el.style.setProperty('--p', pf.toFixed(3));
    el.style.setProperty('--pc', pf > 0.5 ? '#6f9a7a' : pf > 0.25 ? '#e9b95a' : '#e0674f');
    const k = `bub ${cls}`;
    if (el._cls !== k) { el.className = k; el._cls = k; }
  }
  for (const a of G.agents) {
    if (a.bub.style.display === 'none') continue;
    tmpV.copy(a.p.root.position); tmpV.y += 1.3; tmpV.project(camera);
    a.bub.style.transform = `translate(${(tmpV.x * 0.5 + 0.5) * W}px, ${(-tmpV.y * 0.5 + 0.5) * H}px) translate(-50%, -100%)`;
  }
}

// ================================================================ screens: title, journey, how-to
function showScreen(name) {
  G.screen = name;
  for (const id of ['title', 'journey', 'howto']) $(id).classList.toggle('hidden', id !== name);
  if (name !== 'game') {
    ['hud', 'planner', 'rail', 'goalCard', 'bar', 'serveBtn', 'buildTray', 'stockBtn'].forEach((id) => $(id).classList.add('hidden'));
  }
}

function goTitle() {
  mode = 'campaign';
  G.phase = 'idle'; G.build = null; clearGhost(); showTileGrid(false);
  showScreen('title');
  const loc = L.LOCATIONS[0];
  G.loc = loc; G.site = siteFor(loc); G.level = L.LEVELS.corner[0]; G.events = []; G.spills = [];
  clearCustomers();
  buildSite();
  // a few guests enjoying the café in the background
  for (const s of G.seats) {
    const p = buildPerson(randomLook(rng)); p.cup.visible = rng() < 0.6;
    const c = { id: G.nextId++, p, path: [], state: 'sit', seat: s, t: rng() * 5, bub: document.createElement('div'), td: L.CUSTOMER_TYPES.local, decor: true, look: {} };
    G.customers.push(c); peopleGroup.add(p.root);
  }
  cam.orbit = true;
  fitCamera();
  const p = save.campaign;
  const done = L.LOCATIONS.reduce((a, l) => a + (p.progress[l.id] || []).filter((x) => x > 0).length, 0);
  $('titleWallet').innerHTML = `🪙 ${money(Math.floor(p.coins))} · ★ ${L.repLevel(p.xp)} · ${done}/15 shifts`;
  $('tSound').querySelector('b').textContent = `Sound: ${save.sound ? 'on' : 'off'}`;
}

$('tJourney').addEventListener('click', () => { sfx.play('tap'); mode = 'campaign'; goJourney(); });
$('tSandbox').addEventListener('click', () => { sfx.play('tap'); mode = 'sandbox'; goJourney(); });
$('tHow').addEventListener('click', () => { sfx.play('tap'); showScreen('howto'); });
$('howBack').addEventListener('click', () => { goTitle(); });
$('tSound').addEventListener('click', () => {
  save.sound = !save.sound; persist();
  $('tSound').querySelector('b').textContent = `Sound: ${save.sound ? 'on' : 'off'}`;
  sfx.play('tap');
});

const LOC_ART = { corner: '☕', seaside: '🏖️', night: '🏮', lodge: '🏔️', roastery: '🏙️' };
const LOC_COLORS = { corner: '#e9b48a', seaside: '#9fd6e4', night: '#8f6fb8', lodge: '#b9cbb0', roastery: '#d9a27a' };
function goJourney() {
  G.phase = 'idle'; G.build = null; clearGhost(); showTileGrid(false);
  clearCustomers();
  closeMaker(true);
  showScreen('journey');
  cam.orbit = true;
  $('journeyTitle').textContent = sandbox() ? 'Sandbox Café' : 'The Journey';
  $('journeySub').textContent = sandbox() ? 'Every location is open. Decorate, expand and run shifts with no goals — separate wallet from the journey.' : 'Five cafés, fifteen shifts. Finish every shift at a café to unlock the next stop.';
  renderJourney();
}
function renderJourney() {
  const p = prof();
  $('journeyWallet').innerHTML = `🪙 ${money(Math.floor(p.coins))} · ★ ${repLvl()}`;
  const stops = L.LOCATIONS.map((loc, i) => {
    const unlocked = sandbox() || L.locationUnlocked(i, p.progress);
    const stars = (p.progress[loc.id] || []).reduce((a, b) => a + (b || 0), 0);
    const site = p.sites[loc.id];
    return `<button class="postcard ${unlocked ? '' : 'locked'}" data-loc="${i}" style="--c:${LOC_COLORS[loc.id]};--r:${[-3, 2, -2, 3, -1][i]}deg">
      <span class="stamp-no">No. ${i + 1}</span>
      <span class="art">${unlocked ? LOC_ART[loc.id] : '🔒'}</span>
      <b>${loc.name}</b><small>${loc.blurb}</small>
      ${sandbox() ? `<em>${site ? `Day ${site.day} · ${site.layout.length} items` : 'Not visited yet'}</em>` : `<em>${unlocked ? `${'★'.repeat(Math.min(9, stars))}${'☆'.repeat(Math.max(0, 9 - stars))}` : `Finish ${L.LOCATIONS[i - 1].name} first`}</em>`}
    </button>`;
  }).join('');
  $('mapStops').innerHTML = stops;
  $('itinerary').classList.add('hidden');
}
$('mapStops').addEventListener('click', (e) => {
  const b = e.target.closest('[data-loc]');
  if (!b) return;
  const i = +b.dataset.loc, loc = L.LOCATIONS[i];
  if (b.classList.contains('locked')) { toast(`Finish every shift at ${L.LOCATIONS[i - 1].name} to travel here.`); sfx.play('err'); return; }
  sfx.play('tap');
  if (sandbox()) { enterLocation(loc, 0); return; }
  showItinerary(i);
});
function showItinerary(i) {
  const loc = L.LOCATIONS[i], p = prof();
  const prog = p.progress[loc.id] || [];
  const levels = L.LEVELS[loc.id];
  $('itinerary').innerHTML = `<button class="close" id="itinClose">✕</button>
    <div class="itin-head" style="--c:${LOC_COLORS[loc.id]}"><span>${LOC_ART[loc.id]}</span><div><h2>${loc.name}</h2><small>${loc.blurb}</small></div></div>
    ${levels.map((lv, j) => {
      const open = L.levelUnlocked(loc.id, j, p.progress);
      const st = prog[j] || 0;
      return `<div class="ticket-stub ${open ? '' : 'locked'}">
        <div class="stub-l"><small>SHIFT</small><b>${j + 1}</b><span class="stars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span></div>
        <div class="stub-r"><b>${lv.name}</b>
          <ul>${lv.goals.map((g) => `<li>${g.optional ? '✧' : '•'} ${L.goalLabel(g)}</li>`).join('')}</ul>
          <small>${(lv.events || []).map((e) => L.EVENTS[e].icon + ' ' + L.EVENTS[e].name).join(' · ') || 'A calm shift'}</small>
          ${open ? `<button data-play="${j}">${st ? 'Replay' : 'Play'} ▸</button>` : '<span class="lock">🔒 Finish the previous shift</span>'}
        </div></div>`;
    }).join('')}`;
  $('itinerary').classList.remove('hidden');
  $('itinerary').dataset.loc = i;
}
$('itinerary').addEventListener('click', (e) => {
  if (e.target.closest('#itinClose')) { $('itinerary').classList.add('hidden'); return; }
  const b = e.target.closest('[data-play]');
  if (!b) return;
  sfx.play('sign');
  enterLocation(L.LOCATIONS[+$('itinerary').dataset.loc], +b.dataset.play);
});
$('journeyBack').addEventListener('click', () => goTitle());

// ================================================================ receipt (end of shift)
function showReceipt(st, wages, result, rewardsHtml, unlockHtml) {
  const h = st.satCount ? Math.round(st.satSum / st.satCount) : 0;
  const profit = st.revenue + st.tips - wages - st.supplies - st.extraCost;
  const used = {};
  const lines = L.feedbackLines({ ...st, avgWait: st.served ? st.waitSum / st.served : 0 }, G.comfort);
  const p = prof();
  const passed = sandbox() || result?.passed;
  const hasNext = !sandbox() && result?.passed && G.levelIdx + 1 < L.LEVELS[G.loc.id].length;
  const locIdx = L.LOCATIONS.indexOf(G.loc);
  const nextLoc = !sandbox() && result?.passed && G.levelIdx + 1 >= L.LEVELS[G.loc.id].length && L.LOCATIONS[locIdx + 1] && L.locationUnlocked(locIdx + 1, p.progress) ? L.LOCATIONS[locIdx + 1] : null;
  void used;
  $('receipt').innerHTML = `<div class="receipt-paper">
    <div class="r-head"><b>${G.loc.name.toUpperCase()}</b><small>${sandbox() ? `SANDBOX · DAY ${G.site.day}` : `SHIFT ${G.levelIdx + 1} · ${G.level.name.toUpperCase()}`}</small><small>${'*'.repeat(28)}</small></div>
    <div class="r-row"><span>Guests served</span><b>${st.served}</b></div>
    <div class="r-row"><span>Drinks made</span><b>${st.drinks}</b></div>
    <div class="r-row"><span>Sales</span><b>${money(st.revenue)}</b></div>
    <div class="r-row"><span>Tips</span><b>${money(st.tips)}</b></div>
    <div class="r-row neg"><span>Wages</span><b>−${money(wages)}</b></div>
    <div class="r-row neg"><span>Supplies bought</span><b>−${money(st.supplies)}</b></div>
    ${st.extraCost ? `<div class="r-row neg"><span>Emergencies</span><b>−${money(st.extraCost)}</b></div>` : ''}
    <div class="r-row total"><span>Profit</span><b>${profit < 0 ? '−' : ''}${money(Math.abs(profit))}</b></div>
    <div class="r-row"><span>Happiness</span><b>${h}%</b></div>
    <div class="r-row"><span>Walk-outs · mix-ups</span><b>${st.walkouts} · ${st.wrong}</b></div>
    ${st.newRegulars ? `<div class="r-row"><span>New regulars</span><b>★ ${st.newRegulars}</b></div>` : ''}
    <div class="r-sep">${'- '.repeat(16)}</div>
    <div class="r-feedback">${lines.map((l) => `<p>${l}</p>`).join('')}</div>
    ${result ? `<div class="r-sep">${'- '.repeat(16)}</div><ul class="checks r-goals">${result.res.map((r) => `<li class="${r.done ? 'done' : ''} ${r.goal.optional ? 'opt' : ''}"><i></i><span>${L.goalLabel(r.goal)}${r.goal.optional ? ' <em>bonus</em>' : ''}</span></li>`).join('')}</ul>
      <div class="r-stamp ${result.passed ? 'pass' : 'fail'}">${result.passed ? `${'★'.repeat(result.stars)} SHIFT COMPLETE` : 'TRY AGAIN'}</div>` : ''}
    ${rewardsHtml || unlockHtml ? `<ul class="r-rewards">${rewardsHtml}${unlockHtml}</ul>` : ''}
    <div class="r-foot">Wallet ${money(Math.floor(p.coins))} · ★${repLvl()}<br>THANK YOU · COME AGAIN</div>
    <div class="r-btns">
      ${sandbox() ? '<button data-r="next" class="primary">Next day ▸</button>' : hasNext ? '<button data-r="next" class="primary">Next shift ▸</button>' : nextLoc ? `<button data-r="travel" class="primary">Travel to ${nextLoc.name} ▸</button>` : ''}
      ${!sandbox() ? `<button data-r="retry" class="${passed ? '' : 'primary'}">${passed ? 'Replay shift' : 'Try again'}</button>` : ''}
      <button data-r="map">${sandbox() ? 'Leave' : 'Journey map'}</button>
    </div></div>`;
  $('receipt').classList.remove('hidden');
  $('receipt').scrollTop = 0;
  sfx.play(passed ? 'level' : 'sad');
  $('receipt').onclick = (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    $('receipt').classList.add('hidden');
    const r = b.dataset.r;
    if (r === 'next') enterLocation(G.loc, sandbox() ? 0 : G.levelIdx + 1);
    else if (r === 'retry') enterLocation(G.loc, G.levelIdx);
    else if (r === 'travel') enterLocation(nextLoc, 0);
    else goJourney();
  };
}

// ================================================================ pause & rush stock
function openPause() {
  if (G.phase !== 'service') return;
  G.paused = true;
  $('pauseMenu').innerHTML = `<div class="card note"><div class="tape"></div><h3>Taking a breather</h3>
    <div class="choices">
      <button data-p="resume"><b>▶ Back to work</b></button>
      <button data-p="speed"><b>⏩ Speed: ×${G.speed}</b><small>Tap to change</small></button>
      <button data-p="sound"><b>${save.sound ? '🔊 Sound on' : '🔇 Sound off'}</b></button>
      <button data-p="music"><b>${save.music ? '🎵 Music on' : '🎵 Music off'}</b></button>
      <button data-p="hints"><b>${save.hints ? '💡 Recipe hints on' : '💡 Recipe hints off'}</b></button>
      <button data-p="restart"><b>⟲ Restart shift</b><small>Back to the planner (coins kept)</small></button>
      <button data-p="quit"><b>🗺️ Leave to the map</b><small>This shift won’t count</small></button>
    </div></div>`;
  $('pauseMenu').classList.remove('hidden');
}
$('pauseMenu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-p]');
  if (!b) return;
  const k = b.dataset.p;
  if (k === 'speed') { G.speed = G.speed === 1 ? 1.5 : G.speed === 1.5 ? 2 : 1; openPause(); return; }
  if (k === 'sound') { save.sound = !save.sound; persist(); openPause(); return; }
  if (k === 'music') { save.music = !save.music; persist(); openPause(); return; }
  if (k === 'hints') { save.hints = !save.hints; persist(); renderMaker(); openPause(); return; }
  $('pauseMenu').classList.add('hidden');
  G.paused = false;
  if (k === 'restart' || k === 'quit') {
    closeMaker(true); clearCustomers();
    G.phase = 'idle';
    for (const s of G.site.staff) if (s.tempRole) { s.role = s.tempRole; delete s.tempRole; }
    G.site.day = Math.max(0, G.site.day - 1);
    persist();
    if (k === 'restart') enterLocation(G.loc, G.levelIdx); else goJourney();
  }
});
$('hMenu').addEventListener('click', () => { if (G.phase === 'service') openPause(); else { persist(); goJourney(); } });

$('stockBtn').addEventListener('click', () => {
  if (G.phase !== 'service') return;
  const need = new Set(['cups']);
  for (const m of activeMenu()) for (const ing of Object.keys(L.ingredientsForRecipe(m.id))) need.add(ing);
  if (G.loc.custom) need.add('syrup');
  showCard({
    icon: '📦', title: 'Rush order', text: 'A courier brings supplies right now — at 1.5× the usual price.',
    options: [...need].map((ing) => {
      const d = L.INGREDIENTS[ing];
      return { label: `${d.icon} +${d.pack} ${d.name}`, sub: `have ${G.site.stock[ing] || 0}`, cost: Math.ceil(d.cost * 1.5), act: () => { G.site.stock[ing] = (G.site.stock[ing] || 0) + d.pack; toast(`${d.icon} Restocked!`); } };
    }).concat([{ label: 'Never mind', act: () => {} }])
  });
});

// ================================================================ main loop
let last = performance.now();
function frame(now) {
  const rdt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = G.paused ? 0 : rdt * (G.phase === 'service' ? G.speed : 1);
  if (G.phase === 'service') updateService(dt);
  if (G.loc) {
    updateCustomers(G.phase === 'service' || G.phase === 'prep' || G.screen !== 'game' ? dt : 0, rdt);
    if (G.me) updateStaff(G.phase === 'service' ? dt : 0, rdt);
  }
  // gauge needle
  const gz = G.maker?.gauge;
  if (gz && !G.paused) {
    gz.pos += gz.dir * gz.speed * rdt;
    if (gz.pos >= 1) { gz.pos = 1; gz.dir = -1; } else if (gz.pos <= 0) { gz.pos = 0; gz.dir = 1; }
    $('gaugeNeedle').style.left = `${gz.pos * 100}%`;
  }
  // confetti
  for (let i = fxGroup.children.length - 1; i >= 0; i--) {
    const m = fxGroup.children[i];
    if (!m.userData.vel) continue;
    m.userData.vel.y -= 6 * rdt;
    m.position.addScaledVector(m.userData.vel, rdt);
    m.rotation.x += rdt * 6; m.rotation.y += rdt * 4;
    m.userData.life -= rdt;
    if (m.userData.life <= 0) fxGroup.remove(m);
  }
  if (G.machine?.broken && G.machineMesh) G.machineMesh.position.x += Math.sin(now / 30) * 0.0015;
  // title / journey camera drift
  if (G.screen !== 'game') {
    cam.orbitT += rdt * 0.12;
    cam.yaw = Math.PI / 4 + Math.sin(cam.orbitT) * 0.22;
    applyCamera();
  } else if (Math.abs(cam.yaw - Math.PI / 4) > 0.001) { cam.yaw = Math.PI / 4; fitCamera(); }
  updateRain(rdt);
  updateLighting();
  G.hudT -= rdt;
  if (G.hudT <= 0 && G.screen === 'game') { G.hudT = 0.25; updateHud(); }
  sfx.updateMusic(rdt);
  renderer.render(scene, camera);
  updateBubbles();
  requestAnimationFrame(frame);
}

// ================================================================ boot
goTitle();
requestAnimationFrame(frame);
if (document.fonts?.ready) document.fonts.ready.then(() => drawChalkboard());

// handy for debugging in the console
function simulate(sec, step = 0.05) {
  for (let t = 0; t < sec; t += step) {
    if (G.paused) break;
    if (G.phase === 'service') updateService(step);
    updateCustomers(step, step);
    updateStaff(G.phase === 'service' ? step : 0, step);
  }
}
window.__cafe = { G, L, save: () => save, spawnCustomer, triggerTrouble, endShift, simulate, serveAction, addStep, stopGauge, plannerTab };
