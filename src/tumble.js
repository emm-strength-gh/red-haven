import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  DIRS, STAND, LIE_X, GOAL, GLASS, CRACK, SOFT, HEAVY, BRIDGE, VOID,
  parseLevel, initialState, step, covered, solidAt
} from './tumble-logic.js';
import { LEVELS } from './tumble-levels.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'tumble-temple-v1';
const PER_TEMPLE = 22;
const ROMAN = ['I', 'II', 'III'];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const hash = (x, z, s = 0) => { const n = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };

// ---------------------------------------------------------------- temples
const TEMPLES = [
  {
    name: 'Crypt of Ashes', sub: 'Moonlit catacombs',
    sky: ['#070a1c', '#18213f', '#3c5272'], fog: '#1b2640', stone: '#9aa1b3', stoneDark: '#4c5266', trim: '#262a3c',
    accent: '#ffc864', glass: ['#7fd6ff', '#b98cff', '#ffe08a'], light: '#cfdcff', ground: '#3b4566', moon: 'full', ember: '#ffd27a',
    groups: ['#ffc864', '#79e6ff', '#ff86d6']
  },
  {
    name: 'Cathedral of Thorns', sub: 'Rose-glass nave',
    sky: ['#12040b', '#3d0d1d', '#93314a'], fog: '#33101d', stone: '#a7968e', stoneDark: '#5a4448', trim: '#2a171e',
    accent: '#ff5d73', glass: ['#ff3d5e', '#36cdbd', '#ffd24a', '#7a5cff'], light: '#ffd6c8', ground: '#5a2338', moon: 'blood', ember: '#ff7b6b',
    groups: ['#ffd24a', '#36e0ff', '#ff86d6']
  },
  {
    name: 'Abyssal Sanctum', sub: 'Eclipse altar',
    sky: ['#04020a', '#140b2a', '#33195a'], fog: '#130b26', stone: '#6f6888', stoneDark: '#2e2842', trim: '#15111f',
    accent: '#a77bff', glass: ['#a77bff', '#5cf2c8', '#ff7ae0'], light: '#d9ccff', ground: '#2e1f52', moon: 'eclipse', ember: '#9dff8a',
    groups: ['#9dff8a', '#ffc864', '#ff7ae0']
  }
];

const HINTS = {
  first: 'Swipe or use the arrow keys to tumble the block. Stand it upright in the glowing pit.',
  crack: 'Cracked flagstones crumble away once the block rolls off them.',
  glass: 'Stained glass holds a lying block — stand on it upright and it shatters!',
  soft: 'Round sigils raise bridges when any part of the block touches them.',
  heavy: 'Cross sigils are heavy — only an upright block can press them.'
};

// ---------------------------------------------------------------- save data
let save = { done: {}, sound: true };
try { save = { ...save, ...JSON.parse(localStorage.getItem(SAVE_KEY)) }; } catch { /* storage blocked */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* ignore */ } };
const unlockedUpTo = () => { let n = 0; while (n < LEVELS.length && save.done[n]) n++; return Math.min(n, LEVELS.length - 1); };
const starsFor = (moves, par) => (moves <= par ? 3 : moves <= Math.ceil(par * 1.5) ? 2 : 1);

// ---------------------------------------------------------------- audio
class Sound {
  constructor() { this.ctx = null; this.on = save.sound !== false; }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain(); this.out.gain.value = 0.5; this.out.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, len);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  tone(f0, f1, dur, { type = 'sine', vol = 0.2, delay = 0, filter = 0 } = {}) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; node.connect(f); node = f; }
    node.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, { vol = 0.2, freq = 1200, q = 0.8, delay = 0, type = 'bandpass' } = {}) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay, src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  thud() { this.tone(150, 55, 0.18, { vol: 0.35 }); this.noise(0.08, { vol: 0.12, freq: 500 }); }
  crumble() { this.noise(0.5, { vol: 0.25, freq: 300, q: 0.5 }); this.noise(0.25, { vol: 0.12, freq: 900, delay: 0.12 }); }
  click() { this.tone(900, 420, 0.12, { type: 'square', vol: 0.08, filter: 2500 }); this.tone(1400, 1300, 0.25, { type: 'triangle', vol: 0.06, delay: 0.04 }); }
  bridge() { for (let i = 0; i < 5; i++) this.noise(0.05, { vol: 0.1, freq: 2600 + i * 200, q: 4, delay: i * 0.05 }); this.tone(180, 120, 0.3, { type: 'sawtooth', vol: 0.05, filter: 600, delay: 0.2 }); }
  fall() { this.tone(520, 70, 0.9, { type: 'triangle', vol: 0.16 }); this.noise(0.9, { vol: 0.08, freq: 700, q: 0.3 }); }
  shatter() { this.noise(0.4, { vol: 0.3, freq: 4200, q: 0.6 }); [2600, 3300, 3900, 2900].forEach((f, i) => this.tone(f, f * 0.9, 0.3, { type: 'triangle', vol: 0.05, delay: 0.03 * i })); }
  win() {
    // a short pipe-organ cadence: minor to major
    const chord = (notes, delay, dur) => notes.forEach((f) => { this.tone(f, f, dur, { type: 'sawtooth', vol: 0.05, delay, filter: 1800 }); this.tone(f / 2, f / 2, dur, { type: 'sine', vol: 0.07, delay }); });
    chord([220, 261.6, 329.6], 0, 0.5); chord([196, 246.9, 293.7], 0.35, 0.5); chord([220, 277.2, 329.6, 440], 0.7, 1.4);
  }
  drop() { this.tone(300, 40, 0.5, { vol: 0.3 }); }
}
const sound = new Sound();

// ---------------------------------------------------------------- renderer
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);

const ramp = new THREE.DataTexture(new Uint8Array([60, 140, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
const toon = (opts) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...opts });
const inkMat = new THREE.MeshBasicMaterial({ color: '#0a0610', side: THREE.BackSide });
function outline(mesh, s = 1.05) {
  const hull = new THREE.Mesh(mesh.geometry, inkMat);
  hull.scale.setScalar(s); hull.raycast = () => {};
  mesh.add(hull); return hull;
}
function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const hemi = new THREE.HemisphereLight('#ffffff', '#333333', 1.4);
const sun = new THREE.DirectionalLight('#ffffff', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.bias = -0.0015;
sun.shadow.normalBias = 0.02;
scene.add(hemi, sun, sun.target);

const world = new THREE.Group(); scene.add(world);
const envRoot = new THREE.Group(); scene.add(envRoot);
const fx = new THREE.Group(); scene.add(fx);

// ---------------------------------------------------------------- textures per temple
const texCache = new Map();
function themeTextures(ti) {
  if (texCache.has(ti)) return texCache.get(ti);
  const th = TEMPLES[ti];
  const flag = (ctx, w, h, base, seed, cracks) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${hash(i, seed) > 0.5 ? '255,255,255' : '0,0,0'},${0.04 + hash(seed, i) * 0.07})`;
      const s = 2 + hash(i, i + seed) * 6; ctx.fillRect(hash(i, 3 + seed) * w, hash(7 + seed, i) * h, s, s);
    }
    // bevelled border
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.moveTo(6, h - 6); ctx.lineTo(6, 6); ctx.lineTo(w - 6, 6); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.moveTo(w - 6, 6); ctx.lineTo(w - 6, h - 6); ctx.lineTo(6, h - 6); ctx.stroke();
    // carved inner panel
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.strokeRect(22, 22, w - 44, h - 44);
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.strokeRect(25, 25, w - 50, h - 50);
    if (cracks) {
      ctx.strokeStyle = 'rgba(10,6,16,.85)'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
      for (let c = 0; c < 3; c++) {
        ctx.beginPath(); let x = w * (0.2 + hash(c, seed) * 0.6), y = c === 1 ? 0 : h * hash(seed, c);
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (hash(c, k + seed) - 0.5) * 50; y += h / 6 + (hash(k, c) - 0.3) * 20; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,220,180,.18)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  };
  const stone = canvasTex(128, 128, (c, w, h) => flag(c, w, h, th.stone, 1, false));
  const crack = canvasTex(128, 128, (c, w, h) => flag(c, w, h, th.stone, 2, true));
  const rock = canvasTex(64, 64, (c, w, h) => flag(c, w, h, th.stoneDark, 3, false));
  const glass = canvasTex(128, 128, (c, w, h) => {
    // stained glass: leaded diamond panes
    const cols = th.glass;
    c.fillStyle = '#120a18'; c.fillRect(0, 0, w, h);
    const n = 4, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      c.fillStyle = cols[(i * 3 + j * 5) % cols.length];
      c.beginPath(); c.moveTo(i * s + s / 2, j * s + 3); c.lineTo(i * s + s - 3, j * s + s / 2); c.lineTo(i * s + s / 2, j * s + s - 3); c.lineTo(i * s + 3, j * s + s / 2); c.closePath(); c.fill();
      c.fillStyle = cols[(i + j * 2 + 1) % cols.length];
      c.globalAlpha = 0.85;
      for (const [cx, cy] of [[i * s, j * s], [i * s + s, j * s], [i * s, j * s + s], [i * s + s, j * s + s]]) { c.beginPath(); c.arc(cx, cy, s * 0.32, 0, 7); c.fill(); }
      c.globalAlpha = 1;
    }
    c.strokeStyle = '#120a18'; c.lineWidth = 4;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) { c.beginPath(); c.arc(i * s, j * s, s * 0.32, 0, 7); c.stroke(); }
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(10, 10, 30, 6);
    c.lineWidth = 8; c.strokeRect(0, 0, w, h);
  });
  const wood = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#5a3a26'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i % 2 ? '#6b452c' : '#4f3220'; c.fillRect(0, i * 32 + 2, w, 28);
      c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 2;
      for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(0, i * 32 + 8 + k * 7); c.bezierCurveTo(40, i * 32 + 4 + k * 8, 80, i * 32 + 12 + k * 6, w, i * 32 + 8 + k * 7); c.stroke(); }
    }
    c.fillStyle = '#2b2733'; c.fillRect(18, 0, 14, h); c.fillRect(w - 32, 0, 14, h);
    c.fillStyle = '#8a8496'; for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(25, i * 32 + 16, 3, 0, 7); c.arc(w - 25, i * 32 + 16, 3, 0, 7); c.fill(); }
  });
  const block = canvasTex(128, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#3d3450'); g.addColorStop(1, '#241d33');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e9b95a'; c.lineWidth = 7; c.strokeRect(8, 8, w - 16, h - 16);
    c.lineWidth = 3; c.strokeRect(18, 18, w - 36, h - 36);
    // pointed gothic arch window
    c.beginPath(); c.moveTo(34, h - 40); c.lineTo(34, 110); c.quadraticCurveTo(34, 60, w / 2, 44); c.quadraticCurveTo(w - 34, 60, w - 34, 110); c.lineTo(w - 34, h - 40); c.closePath();
    c.fillStyle = '#181224'; c.fill(); c.lineWidth = 5; c.stroke();
    c.beginPath(); c.moveTo(w / 2, 60); c.lineTo(w / 2, h - 40); c.moveTo(34, 150); c.lineTo(w - 34, 150); c.lineWidth = 3; c.stroke();
    // corner studs
    c.fillStyle = '#ffd98a'; for (const [x, y] of [[18, 18], [w - 18, 18], [18, h - 18], [w - 18, h - 18]]) { c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); }
  });
  const blockGlow = canvasTex(128, 256, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    const g = c.createRadialGradient(w / 2, 112, 2, w / 2, 112, 26); g.addColorStop(0, th.accent); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = th.accent; c.lineWidth = 4;
    c.beginPath(); c.ellipse(w / 2, 112, 20, 11, 0, 0, 7); c.stroke();
    c.fillStyle = th.accent; c.beginPath(); c.arc(w / 2, 112, 6, 0, 7); c.fill();
    c.globalAlpha = 0.6; c.beginPath(); c.moveTo(w / 2 - 14, 190); c.lineTo(w / 2, 172); c.lineTo(w / 2 + 14, 190); c.lineTo(w / 2, 208); c.closePath(); c.stroke();
  });
  const beam = canvasTex(8, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,.9)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  const rune = canvasTex(128, 128, (c, w, h) => {
    c.strokeStyle = '#fff'; c.lineWidth = 5; c.beginPath(); c.arc(w / 2, h / 2, 56, 0, 7); c.stroke();
    c.lineWidth = 2; c.beginPath(); c.arc(w / 2, h / 2, 46, 0, 7); c.stroke();
    c.font = 'bold 16px serif'; c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.save(); c.translate(w / 2 + Math.cos(a) * 51, h / 2 + Math.sin(a) * 51); c.rotate(a + Math.PI / 2); c.fillText(glyphs[i], 0, 1); c.restore(); }
  });
  const ghost = canvasTex(64, 64, (c, w, h) => {
    c.strokeStyle = '#fff'; c.lineWidth = 4; c.setLineDash([9, 6]); c.strokeRect(4, 4, w - 8, h - 8);
    c.setLineDash([]); c.globalAlpha = 0.5; c.beginPath(); c.arc(w / 2, h / 2, 6, 0, 7); c.fillStyle = '#fff'; c.fill();
  });
  const set = { ghost, stone, crack, rock, glass, wood, block, blockGlow, beam, rune };
  texCache.set(ti, set);
  return set;
}

// ---------------------------------------------------------------- shared geometry
const G = {
  slab: new RoundedBoxGeometry(0.95, 0.34, 0.95, 2, 0.05),
  thinSlab: new RoundedBoxGeometry(0.94, 0.12, 0.94, 2, 0.03),
  plank: new RoundedBoxGeometry(0.95, 0.22, 0.95, 2, 0.04),
  chunk: new THREE.ConeGeometry(0.66, 1, 4, 1),
  block: new RoundedBoxGeometry(1, 2, 1, 3, 0.07),
  disc: new THREE.CylinderGeometry(0.3, 0.34, 0.08, 20),
  bar: new THREE.BoxGeometry(0.72, 0.07, 0.16),
  frame: new THREE.BoxGeometry(0.98, 0.08, 0.12),
  pit: new THREE.PlaneGeometry(0.76, 0.76),
  beam: new THREE.CylinderGeometry(0.42, 0.42, 4, 20, 1, true),
  ring: new THREE.PlaneGeometry(1.25, 1.25),
  shard: new THREE.TetrahedronGeometry(0.14),
  dust: new THREE.IcosahedronGeometry(0.1, 0)
};
G.chunk.rotateY(Math.PI / 4); G.chunk.rotateX(Math.PI);

// ---------------------------------------------------------------- environment
let envTemple = -1;
const animated = []; // update(t, dt) hooks for the environment
const levelAnim = []; // update hooks for the current level's props
function gothicArchShape(w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(-w / 2, h * 0.6);
  s.quadraticCurveTo(-w / 2, h * 0.92, 0, h); s.quadraticCurveTo(w / 2, h * 0.92, w / 2, h * 0.6);
  s.lineTo(w / 2, 0); s.closePath();
  return s;
}
function buildFacade(th, ti, rand) {
  const g = new THREE.Group();
  const mat = toon({ color: th.trim });
  const glow = new THREE.MeshBasicMaterial({ color: th.glass[0], transparent: true, opacity: 0.85 });
  const W = 8 + rand() * 6, H = 7 + rand() * 6;
  const wall = new THREE.Shape(); wall.moveTo(-W / 2, 0); wall.lineTo(W / 2, 0); wall.lineTo(W / 2, H); wall.lineTo(0, H + W * 0.45); wall.lineTo(-W / 2, H); wall.closePath();
  const n = 3;
  for (let i = 0; i < n; i++) {
    const hole = gothicArchShape(W / (n + 1.5), H * 0.55);
    const off = (i - (n - 1) / 2) * (W / n);
    const path = new THREE.Path(hole.getPoints(14).map((p) => new THREE.Vector2(p.x + off, p.y + H * 0.12)));
    wall.holes.push(path);
  }
  const wallGeo = new THREE.ExtrudeGeometry(wall, { depth: 0.8, bevelEnabled: false });
  g.add(new THREE.Mesh(wallGeo, mat));
  // rose window
  const rose = new THREE.Mesh(new THREE.CircleGeometry(W * 0.16, 16), glow);
  rose.position.set(0, H + W * 0.12, 0.85); g.add(rose);
  const roseRim = new THREE.Mesh(new THREE.RingGeometry(W * 0.16, W * 0.2, 16), mat);
  roseRim.position.copy(rose.position); roseRim.position.z += 0.01; g.add(roseRim);
  // glowing backing for the arches
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, H * 0.7), new THREE.MeshBasicMaterial({ color: th.glass[ti === 1 ? 0 : 1], transparent: true, opacity: 0.35 }));
  back.position.set(0, H * 0.45, 0.2); g.add(back);
  // spires
  for (const sx of [-1, 1]) {
    const tw = new THREE.Mesh(new THREE.BoxGeometry(1.4, H * 1.2, 1.4), mat); tw.position.set(sx * (W / 2 + 0.4), H * 0.6, 0.4); g.add(tw);
    const sp = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4 + rand() * 3, 4), mat); sp.rotation.y = Math.PI / 4; sp.position.set(sx * (W / 2 + 0.4), H * 1.2 + 2.5, 0.4); g.add(sp);
  }
  const base = new THREE.Mesh(new THREE.ConeGeometry(W * 0.6, 6, 6), toon({ color: th.stoneDark }));
  base.rotation.x = Math.PI; base.position.y = -3; g.add(base);
  return g;
}
function buildCandle(th, hooks) {
  const g = new THREE.Group();
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 2.4, 8), toon({ color: th.stone }));
  col.position.y = -1.2; col.castShadow = true; outline(col, 1.06); g.add(col);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.9), toon({ color: th.stoneDark })); cap.position.y = 0.05; outline(cap, 1.08); g.add(cap);
  const under = new THREE.Mesh(G.chunk, toon({ color: th.stoneDark })); under.scale.set(0.8, 2.2, 0.8); under.position.y = -3.5; g.add(under);
  const flames = [];
  for (const [x, z, h] of [[-0.2, 0.1, 0.5], [0.18, -0.12, 0.7], [0.05, 0.22, 0.35]]) {
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, h, 8), toon({ color: '#f1e6cf' }));
    wax.position.set(x, 0.15 + h / 2, z); outline(wax, 1.15); g.add(wax);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 8), new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
    fl.position.set(x, 0.15 + h + 0.12, z); g.add(fl); flames.push(fl);
  }
  const light = new THREE.PointLight(th.ember, 6, 7, 1.6); light.position.y = 0.9; g.add(light);
  hooks.push((t) => {
    flames.forEach((f, i) => { const k = 1 + Math.sin(t * 13 + i * 2) * 0.12 + Math.sin(t * 29 + i) * 0.08; f.scale.set(1, k, 1); });
    light.intensity = 6 + Math.sin(t * 11) * 0.8 + Math.sin(t * 23) * 0.5;
  });
  return g;
}
function buildBat() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#07040c', side: THREE.DoubleSide });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.9, 0.1, -0.25, 0.6, 0, 0.2, 0, 0, 0, 0.6, 0, 0.2, 0.2, 0, 0.3], 3));
  const l = new THREE.Mesh(wingGeo, mat), r = new THREE.Mesh(wingGeo, mat); r.scale.x = -1;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), mat);
  g.add(l, r, body);
  g.userData.wings = [l, r];
  return g;
}

// The sky is painted at the screen's aspect: gradient, moon and two layers of
// gothic skyline with lit windows, so the silhouettes always sit behind the level.
let backdropAspect = 0;
function paintBackdrop(th) {
  const aspect = (window.innerWidth || 1) / (window.innerHeight || 1);
  backdropAspect = aspect;
  const W = 1024, H = clamp(Math.round(W / aspect), 400, 2200);
  const old = scene.background;
  scene.background = canvasTex(W, H, (c) => {
    const rnd = (() => { let s = 7 + th.name.length * 131; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.sky[0]); g.addColorStop(0.45, th.sky[1]); g.addColorStop(1, th.sky[2]);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // moon
    const u = Math.min(W, H), mx = W * 0.2, my = H * 0.13, mr = u * 0.07;
    const col = th.moon === 'blood' ? '255,110,110' : th.moon === 'eclipse' ? '190,150,255' : '220,230,255';
    const halo = c.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3.2);
    halo.addColorStop(0, `rgba(${col},.45)`); halo.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = halo; c.fillRect(0, 0, W, H);
    if (th.moon === 'eclipse') {
      c.fillStyle = '#e3d6ff'; c.beginPath(); c.arc(mx, my, mr * 1.06, 0, 7); c.fill();
      c.fillStyle = '#06030c'; c.beginPath(); c.arc(mx + mr * 0.05, my - mr * 0.03, mr, 0, 7); c.fill();
    } else {
      c.fillStyle = th.moon === 'blood' ? '#ff8f7d' : '#f4f0d8'; c.beginPath(); c.arc(mx, my, mr, 0, 7); c.fill();
      c.fillStyle = 'rgba(0,0,0,.12)';
      for (const [x, y, r] of [[-0.3, -0.25, 0.25], [0.3, 0.15, 0.18], [-0.1, 0.4, 0.12], [0.35, -0.35, 0.1]]) { c.beginPath(); c.arc(mx + x * mr, my + y * mr, r * mr, 0, 7); c.fill(); }
    }
    // stars
    for (let i = 0; i < 140; i++) { c.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.6})`; const r = rnd() * 1.6 + 0.4; c.beginPath(); c.arc(rnd() * W, rnd() * H * 0.35, r, 0, 7); c.fill(); }
    // skyline layers
    const skyline = (base, scale, fill, windows) => {
      c.fillStyle = fill;
      let x = -20;
      const lit = [];
      while (x < W + 20) {
        const bw = (40 + rnd() * 70) * scale, bh = (50 + rnd() * 120) * scale, kind = rnd();
        c.beginPath();
        c.moveTo(x, H); c.lineTo(x, base - bh);
        if (kind < 0.45) { c.lineTo(x + bw / 2, base - bh - bw * (1 + rnd())); } // spire
        else if (kind < 0.75) { c.quadraticCurveTo(x, base - bh - bw * 0.5, x + bw / 2, base - bh - bw * 0.7); c.quadraticCurveTo(x + bw, base - bh - bw * 0.5, x + bw, base - bh); } // pointed gable
        else { const t = bw * 0.28; c.lineTo(x + t, base - bh); c.lineTo(x + t / 2, base - bh - t * 3); c.lineTo(x + t, base - bh); c.lineTo(x + bw - t, base - bh); c.lineTo(x + bw - t / 2, base - bh - t * 3); }
        c.lineTo(x + bw, base - bh); c.lineTo(x + bw, H); c.closePath(); c.fill();
        if (windows) for (let k = 0; k < 3; k++) if (rnd() < 0.5) lit.push([x + bw * (0.25 + rnd() * 0.5), base - bh * (0.2 + rnd() * 0.6), 4 * scale]);
        x += bw * (0.7 + rnd() * 0.5);
      }
      for (const [wx, wy, s] of lit) {
        c.fillStyle = windows; c.beginPath(); c.moveTo(wx - s, wy + s * 2); c.lineTo(wx - s, wy); c.quadraticCurveTo(wx - s, wy - s * 1.4, wx, wy - s * 2); c.quadraticCurveTo(wx + s, wy - s * 1.4, wx + s, wy); c.lineTo(wx + s, wy + s * 2); c.fill();
      }
    };
    const fog = (y0, y1, a) => { const m = c.createLinearGradient(0, y0, 0, y1); m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(1, th.sky[2] + a); c.fillStyle = m; c.fillRect(0, y0, W, y1 - y0); };
    skyline(H * 0.3, 0.8, th.sky[1], null);
    fog(H * 0.12, H * 0.32, '99');
    skyline(H * 0.36, 1.1, th.trim, th.accent);
    fog(H * 0.28, H * 0.62, 'ff');
    c.fillStyle = th.sky[2]; c.fillRect(0, H * 0.62, W, H);
  });
  old?.dispose?.();
}

function buildEnvironment(ti) {
  if (envTemple === ti) return;
  envTemple = ti;
  envRoot.clear(); animated.length = 0;
  const th = TEMPLES[ti];
  const rand = (() => { let s = 99 + ti * 1013; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  paintBackdrop(th);
  scene.fog = new THREE.Fog(th.fog, 30, 95);
  hemi.color.set(th.light); hemi.groundColor.set(th.ground);
  sun.color.set(th.light);
  document.querySelector('meta[name=theme-color]').setAttribute('content', th.sky[0]);


  // stars
  const starPos = [];
  for (let i = 0; i < 500; i++) {
    const a = rand() * Math.PI * 2, e = 0.12 + rand() * 1.3, r = 150;
    starPos.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
  }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  envRoot.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.1, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));

  // distant cathedral ruins, floating on rock
  for (let i = 0; i < 7; i++) {
    const f = buildFacade(th, ti, rand);
    const a = -Math.PI * 0.95 + (i / 6) * Math.PI * 0.9 + (rand() - 0.5) * 0.2;
    const r = 44 + rand() * 20;
    f.position.set(Math.cos(a) * r, -r * 0.9 + rand() * 6, Math.sin(a) * r - 8);
    f.lookAt(0, f.position.y, 0);
    f.scale.setScalar(1.3 + rand() * 0.7);
    const y0 = f.position.y, ph = rand() * 6;
    animated.push((t) => { f.position.y = y0 + Math.sin(t * 0.3 + ph) * 0.6; });
    envRoot.add(f);
  }
  // broken columns drifting nearer
  for (let i = 0; i < 10; i++) {
    const g = new THREE.Group();
    const h = 2 + rand() * 5;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, h, 8), toon({ color: th.stoneDark }));
    col.rotation.z = (rand() - 0.5) * 0.5; outline(col, 1.04); g.add(col);
    const chunk = new THREE.Mesh(G.chunk, toon({ color: th.trim })); chunk.scale.set(2, 3, 2); chunk.position.y = -h / 2 - 1.4; g.add(chunk);
    const a = rand() * Math.PI * 2, r = 18 + rand() * 16;
    g.position.set(Math.cos(a) * r, -6 - rand() * 10, Math.sin(a) * r);
    const y0 = g.position.y, ph = rand() * 6, sp = 0.2 + rand() * 0.3;
    animated.push((t) => { g.position.y = y0 + Math.sin(t * sp + ph) * 0.8; g.rotation.y = t * 0.03 + ph; });
    envRoot.add(g);
  }
  // mist layers
  const mistTex = canvasTex(256, 256, (c, w) => {
    for (let i = 0; i < 26; i++) {
      const x = hash(i, 1) * w, y = hash(i, 2) * w, r = 20 + hash(i, 3) * 50;
      const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, w);
    }
  }, true);
  for (let i = 0; i < 2; i++) {
    const tex = mistTex.clone(); tex.needsUpdate = true; tex.repeat.set(3, 3);
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshBasicMaterial({ map: tex, color: th.sky[2], transparent: true, opacity: 0.32 - i * 0.1, depthWrite: false }));
    mist.rotation.x = -Math.PI / 2; mist.position.y = -5 - i * 5;
    animated.push((t) => { tex.offset.set(t * 0.004 * (i ? -1 : 1), t * 0.003); });
    envRoot.add(mist);
  }
  // bats
  for (let i = 0; i < 5; i++) {
    const bat = buildBat(); envRoot.add(bat);
    const r = 14 + rand() * 14, sp = 0.15 + rand() * 0.2, ph = rand() * 6, hgt = 5 + rand() * 8;
    animated.push((t) => {
      const a = t * sp + ph;
      bat.position.set(Math.cos(a) * r, hgt + Math.sin(t * 0.7 + ph) * 1.5, Math.sin(a) * r - 6);
      bat.rotation.y = -a;
      const flap = Math.sin(t * 16 + ph) * 0.8;
      bat.userData.wings[0].rotation.z = flap; bat.userData.wings[1].rotation.z = -flap;
    });
  }
  // embers / dust motes
  const emberPos = new Float32Array(120 * 3);
  for (let i = 0; i < 120; i++) { emberPos[i * 3] = (rand() - 0.5) * 30; emberPos[i * 3 + 1] = rand() * 12 - 4; emberPos[i * 3 + 2] = (rand() - 0.5) * 30; }
  const emberGeo = new THREE.BufferGeometry(); emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const embers = new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: th.ember, size: 0.09, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  envRoot.add(embers);
  animated.push((t, dt) => {
    for (let i = 0; i < 120; i++) {
      emberPos[i * 3 + 1] += dt * (0.25 + (i % 5) * 0.06);
      emberPos[i * 3] += Math.sin(t + i) * dt * 0.15;
      if (emberPos[i * 3 + 1] > 9) emberPos[i * 3 + 1] = -4;
    }
    emberGeo.attributes.position.needsUpdate = true;
  });
}

// ---------------------------------------------------------------- level build
let L = null; // parsed level
let levelIndex = 0;
let state = null;
let tiles = new Map(); // cell index -> tile record
let block = null;
let moves = 0, inputLocked = true, queued = null, mode = 'menu';
let levelCenter = new THREE.Vector3(), levelRadius = 5;
const tweens = [];
const tween = (dur, fn, done, delay = 0) => { tweens.push({ t: -delay, dur, fn, done }); };

function makeTile(ti, x, z) {
  const th = TEMPLES[ti], tx = themeTextures(ti);
  const t = L.type[z * L.w + x];
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const rec = { g, type: t, x, z, shown: true, group: L.group[z * L.w + x] };
  const add = (geo, mat, y, sOut = 1.035) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; m.receiveShadow = true; if (sOut) outline(m, sOut); g.add(m); return m; };
  const chunkH = 0.7 + hash(x, z, ti) * 1.1;
  const chunk = () => {
    const c = new THREE.Mesh(G.chunk, toon({ map: tx.rock, color: '#ffffff' }));
    c.scale.set(0.95 + hash(z, x) * 0.2, chunkH, 0.95 + hash(x + 3, z) * 0.2); c.position.y = -0.34 - chunkH / 2; c.rotation.y = (hash(x, z, 9) - 0.5) * 0.4;
    g.add(c); return c;
  };
  const groupColor = rec.group >= 0 ? th.groups[rec.group] : th.accent;
  if (t === GLASS) {
    rec.top = add(G.thinSlab, toon({ map: tx.glass, emissive: '#ffffff', emissiveMap: tx.glass, emissiveIntensity: 0.35, transparent: true, opacity: 0.92 }), -0.06, 1.04);
    const frameMat = toon({ color: '#2b2733' });
    for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(G.frame, frameMat); f.rotation.y = (k * Math.PI) / 2; f.position.set(k === 1 ? 0.43 : k === 3 ? -0.43 : 0, -0.08, k === 0 ? 0.43 : k === 2 ? -0.43 : 0); g.add(f); }
  } else if (t === BRIDGE) {
    rec.top = add(G.plank, toon({ map: tx.wood }), -0.11);
    const gem = new THREE.Mesh(G.disc, new THREE.MeshBasicMaterial({ color: groupColor })); gem.scale.set(0.3, 0.6, 0.3); gem.position.y = 0.02; g.add(gem);
    rec.gem = gem;
    // a faint marker shows where the bridge will appear
    const ghost = new THREE.Mesh(G.pit, new THREE.MeshBasicMaterial({ map: tx.ghost, color: groupColor, transparent: true, opacity: 0.55, depthWrite: false }));
    ghost.rotation.x = -Math.PI / 2; ghost.position.set(x, -0.25, z); ghost.scale.setScalar(1.2);
    world.add(ghost);
  } else {
    rec.top = add(G.slab, toon({ map: t === CRACK ? tx.crack : tx.stone, color: t === CRACK ? '#d9cfc8' : '#ffffff' }), -0.17);
    rec.chunk = chunk();
    if (t === CRACK) rec.chunk.scale.y *= 0.6;
  }
  if (t === SOFT) {
    const plate = add(G.disc, toon({ color: '#3a3346', emissive: groupColor, emissiveIntensity: 0.25 }), 0.03, 1.08);
    const gem = new THREE.Mesh(G.disc, new THREE.MeshBasicMaterial({ color: groupColor })); gem.scale.set(0.45, 0.4, 0.45); gem.position.y = 0.05; plate.add(gem);
    rec.plate = plate;
  }
  if (t === HEAVY) {
    const plate = new THREE.Group(); plate.position.y = 0.03; g.add(plate);
    const m = toon({ color: '#3a3346', emissive: groupColor, emissiveIntensity: 0.35 });
    for (const a of [Math.PI / 4, -Math.PI / 4]) { const b = new THREE.Mesh(G.bar, m); b.rotation.y = a; b.castShadow = true; outline(b, 1.12); plate.add(b); }
    rec.plate = plate;
  }
  if (t === GOAL) {
    const pit = new THREE.Mesh(G.pit, new THREE.MeshBasicMaterial({ color: '#030106' }));
    pit.rotation.x = -Math.PI / 2; pit.position.y = 0.005; g.add(pit);
    const ring = new THREE.Mesh(G.ring, new THREE.MeshBasicMaterial({ map: tx.rune, color: th.accent, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
    const beam = new THREE.Mesh(G.beam, new THREE.MeshBasicMaterial({ map: tx.beam, color: th.accent, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 2; g.add(beam);
    const light = new THREE.PointLight(th.accent, 4, 4, 1.5); light.position.y = 0.6; g.add(light);
    rec.ring = ring; rec.beam = beam; rec.light = light;
  }
  world.add(g);
  return rec;
}

function makeBlock(ti) {
  const tx = themeTextures(ti);
  const mesh = new THREE.Mesh(G.block, toon({ map: tx.block, emissive: '#ffffff', emissiveMap: tx.blockGlow, emissiveIntensity: 1 }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  outline(mesh, 1.045);
  world.add(mesh);
  return mesh;
}

function poseOf(s) {
  if (s.o === STAND) return new THREE.Vector3(s.x, 1, s.z);
  return s.o === LIE_X ? new THREE.Vector3(s.x + 0.5, 0.5, s.z) : new THREE.Vector3(s.x, 0.5, s.z + 0.5);
}

function loadLevel(n, { instant = false } = {}) {
  levelIndex = n;
  const ti = Math.floor(n / PER_TEMPLE);
  buildEnvironment(ti);
  for (const c of [...world.children]) world.remove(c);
  for (const c of [...fx.children]) fx.remove(c);
  tweens.length = 0;
  L = parseLevel(LEVELS[n].map);
  state = initialState(L);
  moves = 0; queued = null; inputLocked = true; mode = 'intro';
  tiles = new Map();
  for (let z = 0; z < L.h; z++) for (let x = 0; x < L.w; x++) {
    if (L.type[z * L.w + x] === VOID) continue;
    tiles.set(z * L.w + x, makeTile(ti, x, z));
  }
  block = makeBlock(ti);
  levelAnim.length = 0;
  for (const [cx, cz] of [[-1.7, -1.3], [L.w + 0.7, -1.3], [-1.7, L.h + 0.2]]) {
    const c = buildCandle(TEMPLES[ti], levelAnim);
    c.position.set(cx, 0, cz);
    world.add(c);
  }
  levelCenter.set((L.w - 1) / 2, 0, (L.h - 1) / 2);
  levelRadius = Math.hypot(L.w, L.h) / 2 + 0.5;
  sun.position.set(levelCenter.x - 6, 14, levelCenter.z + 7);
  sun.target.position.copy(levelCenter);
  const sc = sun.shadow.camera; sc.left = sc.bottom = -levelRadius - 2; sc.right = sc.top = levelRadius + 2; sc.near = 1; sc.far = 40; sc.updateProjectionMatrix();
  fitCamera(true);
  updateHud();

  // intro: tiles rise up, then the block drops in
  const start = L.start;
  let last = 0;
  for (const rec of tiles.values()) {
    const solid = solidAt(L, rec.x, rec.z, 0, 0);
    if (rec.type === BRIDGE && !solid) { rec.shown = false; rec.g.visible = false; continue; }
    if (instant) continue;
    const d = Math.hypot(rec.x - start.x, rec.z - start.z) * 0.04 + hash(rec.x, rec.z) * 0.1;
    last = Math.max(last, d);
    rec.g.position.y = -8;
    tween(0.55, (k) => { rec.g.position.y = -8 * (1 - easeOutBack(k)); }, null, d);
  }
  block.position.copy(poseOf(state)); block.quaternion.identity();
  if (instant) { block.visible = true; inputLocked = false; mode = 'play'; return; }
  block.visible = false;
  const target = poseOf(state);
  tween(0.45, (k) => {
    block.visible = true;
    block.position.set(target.x, target.y + 7 * (1 - k * k), target.z);
  }, () => {
    block.position.copy(target);
    sound.thud(); dustAt(target.x, target.z, 10); shake(0.15);
    inputLocked = false; mode = 'play';
    showLevelHint();
  }, last + 0.45);
}

function showLevelHint() {
  const kinds = (n) => { const m = LEVELS[n].map.join(''); return { crack: /c/.test(m), glass: /o/.test(m), soft: /[123]/.test(m), heavy: /[456]/.test(m) }; };
  let text = levelIndex === 0 ? HINTS.first : '';
  const now = kinds(levelIndex);
  for (const k of ['heavy', 'soft', 'glass', 'crack']) {
    if (!now[k]) continue;
    let firstUse = true;
    for (let i = 0; i < levelIndex; i++) if (kinds(i)[k]) { firstUse = false; break; }
    if (firstUse) { text = HINTS[k]; break; }
  }
  if (text) hint(text, 6);
}

// ---------------------------------------------------------------- effects
const particles = [];
const dustMat = toon({ color: '#c9c0b8' });
function dustAt(x, z, count = 6, color) {
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(G.dust, color ? toon({ color }) : dustMat);
    const a = Math.random() * Math.PI * 2;
    m.position.set(x + Math.cos(a) * 0.5, 0.05, z + Math.sin(a) * 0.5);
    fx.add(m);
    particles.push({ m, v: new THREE.Vector3(Math.cos(a) * 1.4, 0.8 + Math.random(), Math.sin(a) * 1.4), life: 0.5 + Math.random() * 0.3, max: 0.8, g: 2, spin: 4 });
  }
}
function burst(pos, colorList, count, speed = 4, gravity = 9, geo = G.shard) {
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colorList[i % colorList.length], transparent: true }));
    m.position.copy(pos);
    fx.add(m);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
    particles.push({ m, v, life: 1 + Math.random() * 0.6, max: 1.6, g: gravity, spin: 8, fade: true });
  }
}
let shakeAmt = 0;
const shake = (a) => { shakeAmt = Math.max(shakeAmt, a); };

let hintTimer = 0;
function hint(text, seconds = 3.5) {
  const el = $('hint'); el.textContent = text; el.classList.add('on'); hintTimer = seconds;
}

// ---------------------------------------------------------------- moves
function rollBlock(dirKey) {
  if (inputLocked) { if (mode === 'anim') queued = dirKey; return; }
  const [dx, dz] = DIRS[dirKey];
  const before = state;
  const { state: next, ev } = step(L, state, dx, dz);
  state = next;
  moves++;
  updateHud();
  inputLocked = true; mode = 'anim';
  const cells = covered(before);
  const minX = Math.min(...cells.map((c) => c[0])) - 0.5, maxX = Math.max(...cells.map((c) => c[0])) + 0.5;
  const minZ = Math.min(...cells.map((c) => c[1])) - 0.5, maxZ = Math.max(...cells.map((c) => c[1])) + 0.5;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  let pivot, axis, angle;
  if (dx > 0) { pivot = new THREE.Vector3(maxX, 0, cz); axis = new THREE.Vector3(0, 0, 1); angle = -Math.PI / 2; }
  else if (dx < 0) { pivot = new THREE.Vector3(minX, 0, cz); axis = new THREE.Vector3(0, 0, 1); angle = Math.PI / 2; }
  else if (dz > 0) { pivot = new THREE.Vector3(cx, 0, maxZ); axis = new THREE.Vector3(1, 0, 0); angle = Math.PI / 2; }
  else { pivot = new THREE.Vector3(cx, 0, minZ); axis = new THREE.Vector3(1, 0, 0); angle = -Math.PI / 2; }
  const p0 = block.position.clone(), q0 = block.quaternion.clone();
  const q = new THREE.Quaternion();
  const dur = ev.result === 'fall' && ev.unsupported.length === covered(next).length ? 0.2 : 0.17;
  tween(dur, (k) => {
    q.setFromAxisAngle(axis, angle * easeInOut(k));
    block.position.copy(p0).sub(pivot).applyQuaternion(q).add(pivot);
    block.quaternion.copy(q).multiply(q0);
  }, () => {
    q.setFromAxisAngle(axis, angle);
    block.quaternion.copy(q).multiply(q0);
    snapQuaternion(block.quaternion);
    block.position.copy(poseOf(next));
    afterRoll(before, next, ev, [dx, dz]);
  });
}

function snapQuaternion(qt) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(qt);
  const e = m.elements;
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) e[i] = Math.round(e[i]);
  qt.setFromRotationMatrix(m);
}

function afterRoll(before, next, ev, dir) {
  // crumble the tiles left behind
  for (const [x, z] of ev.cracked) {
    const rec = tiles.get(z * L.w + x);
    if (!rec) continue;
    sound.crumble();
    const g = rec.g, rx = (Math.random() - 0.5) * 2, rz = (Math.random() - 0.5) * 2;
    tween(1.3, (k) => {
      if (k < 0.15) { g.position.x = x + Math.sin(k * 200) * 0.04; return; }
      const f = (k - 0.15) / 0.85;
      g.position.set(x, -f * f * 14, z); g.rotation.set(rx * f * 2, 0, rz * f * 2);
    }, () => { g.visible = false; });
    dustAt(x, z, 8, TEMPLES[envTemple].stoneDark);
  }
  if (ev.result === 'fall') return fallOff(next, ev, dir);
  sound.thud();
  for (const [x, z] of covered(next)) {
    dustAt(x, z, 3);
    const rec = tiles.get(z * L.w + x);
    if (rec) { const y0 = 0; tween(0.18, (k) => { rec.g.position.y = y0 - Math.sin(k * Math.PI) * 0.05; }); }
  }
  if (ev.toggled.length) {
    sound.click();
    for (const tg of ev.toggled) {
      const rec = tiles.get(tg.z * L.w + tg.x);
      if (rec?.plate) tween(0.3, (k) => { rec.plate.position.y = 0.03 - Math.sin(k * Math.PI) * 0.05; });
    }
    syncBridges();
  }
  if (ev.result === 'win') return winLevel();
  inputLocked = false; mode = 'play';
  if (queued) { const d = queued; queued = null; rollBlock(d); }
}

function syncBridges() {
  let any = false;
  for (const rec of tiles.values()) {
    if (rec.type !== BRIDGE) continue;
    const solid = solidAt(L, rec.x, rec.z, state.bridges, state.cracked);
    if (solid === rec.shown) continue;
    rec.shown = solid; any = true;
    const g = rec.g;
    g.visible = true;
    // hinge from the side nearest the switch-free edge: swing up from below
    tween(0.4, (k) => {
      const e = solid ? easeOutBack(k) : 1 - easeInOut(k);
      g.position.y = -1.2 * (1 - e);
      g.rotation.x = (1 - e) * 1.4;
      g.scale.setScalar(0.4 + 0.6 * e);
    }, () => { if (!solid) g.visible = false; });
    burst(new THREE.Vector3(rec.x, 0.1, rec.z), [TEMPLES[envTemple].groups[rec.group]], 6, 2.5, 3, G.dust);
  }
  if (any) sound.bridge();
}

function fallOff(next, ev, dir) {
  mode = 'fall';
  sound.fall();
  if (ev.broke) {
    sound.shatter();
    const rec = tiles.get(ev.broke[1] * L.w + ev.broke[0]);
    if (rec) { rec.g.visible = false; burst(new THREE.Vector3(ev.broke[0], 0, ev.broke[1]), TEMPLES[envTemple].glass, 24, 3, 9); }
  }
  const cells = covered(next);
  const vel = new THREE.Vector3(dir[0] * 1.2, 0, dir[1] * 1.2);
  let axis = new THREE.Vector3(dir[1], 0, -dir[0]).normalize(); // spin like the roll continued
  let pivot = null, tipped = 0;
  // half on, half off: tip over the edge of the supported cell first
  if (cells.length === 2 && ev.unsupported.length === 1 && !ev.broke) {
    const [ux, uz] = ev.unsupported[0];
    const [sx, sz] = cells.find(([x, z]) => x !== ux || z !== uz);
    const tdx = ux - sx, tdz = uz - sz;
    pivot = new THREE.Vector3((ux + sx) / 2, 0, (uz + sz) / 2);
    axis = new THREE.Vector3(tdz, 0, -tdx);
    vel.set(tdx * 1.5, 0, tdz * 1.5);
  }
  let angVel = pivot ? 2 : 4;
  const q = new THREE.Quaternion();
  let t = 0;
  const physics = { update(dt) {
    t += dt;
    if (pivot && tipped < Math.PI / 2) {
      angVel += 16 * dt;
      const da = angVel * dt; tipped += da;
      q.setFromAxisAngle(axis, da);
      block.position.sub(pivot).applyQuaternion(q).add(pivot);
      block.quaternion.premultiply(q);
      return;
    }
    vel.y -= 24 * dt;
    block.position.addScaledVector(vel, dt);
    q.setFromAxisAngle(axis, angVel * dt);
    block.quaternion.premultiply(q);
  } };
  fallers.push(physics);
  shake(0.12);
  setTimeout(() => {
    fallers.length = 0;
    restartLevel('The block tumbled into the abyss…');
  }, 1300);
}
const fallers = [];

function winLevel() {
  mode = 'win';
  const rec = tiles.get(L.goal.z * L.w + L.goal.x);
  const th = TEMPLES[envTemple];
  sound.drop();
  const y0 = block.position.y;
  tween(1.0, (k) => {
    block.position.y = y0 - easeInOut(k) * 2.2;
    block.rotation.y += 0.04 * k;
    if (rec) { rec.beam.material.opacity = 0.45 + k * 0.5; rec.beam.scale.set(1 + k * 0.6, 1 + k, 1 + k * 0.6); rec.light.intensity = 4 + k * 10; }
  }, () => {
    block.visible = false;
    sound.win();
    burst(new THREE.Vector3(L.goal.x, 0.3, L.goal.z), [th.accent, '#ffffff', th.glass[1]], 40, 6, 5, G.dust);
    shake(0.2);
    const par = LEVELS[levelIndex].par;
    const stars = starsFor(moves, par);
    const prev = save.done[levelIndex];
    save.done[levelIndex] = { moves: prev ? Math.min(prev.moves, moves) : moves, stars: Math.max(prev?.stars || 0, stars) };
    persist();
    setTimeout(() => showWin(stars, par), 700);
  });
}

function restartLevel(msg) {
  const fade = $('fade');
  fade.classList.add('on');
  inputLocked = true;
  setTimeout(() => {
    loadLevel(levelIndex, { instant: true });
    fade.classList.remove('on');
    if (msg) hint(msg, 2);
  }, 300);
}

// ---------------------------------------------------------------- camera & input
const CAM_DIR = new THREE.Vector3(0.42, 1.1, 1).normalize();
let camDist = 20;
function fitCamera() {
  const w = stage.clientWidth || window.innerWidth, h = stage.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  camDist = (levelRadius * 0.92) / Math.sin(Math.min(vfov, hfov) / 2);
  camDist = clamp(camDist, 9, 60);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => {
  fitCamera();
  const a = window.innerWidth / window.innerHeight;
  if (envTemple >= 0 && Math.abs(a - backdropAspect) > 0.15) paintBackdrop(TEMPLES[envTemple]);
});

// pick the world direction whose on-screen projection best matches a screen vector
function worldDirForScreen(sx, sy) {
  const origin = levelCenter.clone().project(camera);
  let best = null, bestDot = -Infinity;
  for (const [key, [dx, dz]] of Object.entries(DIRS)) {
    const p = levelCenter.clone().add(new THREE.Vector3(dx, 0, dz)).project(camera);
    const vx = p.x - origin.x, vy = -(p.y - origin.y);
    const len = Math.hypot(vx * camera.aspect, vy) || 1;
    const dot = (vx * camera.aspect * sx + vy * sy) / len;
    if (dot > bestDot) { bestDot = dot; best = key; }
  }
  return best;
}
const SCREEN = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const press = (name) => { sound.unlock(); if (mode === 'play' || mode === 'anim') rollBlock(worldDirForScreen(...SCREEN[name])); };

window.addEventListener('keydown', (e) => {
  const map = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  if (map[e.code]) { e.preventDefault(); if (!e.repeat || mode === 'play') press(map[e.code]); }
  else if (e.code === 'KeyR' && (mode === 'play' || mode === 'anim')) restartLevel();
  else if ((e.code === 'Enter' || e.code === 'Space') && !$('win').classList.contains('hidden')) $('nextButton').click();
});
let swipe = null;
renderer.domElement.addEventListener('pointerdown', (e) => { sound.unlock(); swipe = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!swipe || swipe.id !== e.pointerId) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (Math.hypot(dx, dy) > 28) {
    swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
    if (mode === 'play' || mode === 'anim') rollBlock(worldDirForScreen(dx / Math.hypot(dx, dy), dy / Math.hypot(dx, dy)));
    swipe = null;
  }
});
window.addEventListener('pointerup', () => { swipe = null; });
document.querySelectorAll('.pad button').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); press(b.dataset.dir); }));

// ---------------------------------------------------------------- UI
const screens = ['menu', 'levels', 'win'];
function show(id) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
  $('hud').classList.toggle('hidden', !!id);
}
function updateHud() {
  const ti = Math.floor(levelIndex / PER_TEMPLE);
  $('templeName').textContent = TEMPLES[ti].name;
  $('levelName').textContent = `${ROMAN[ti]} · ${(levelIndex % PER_TEMPLE) + 1}`;
  $('moveCount').textContent = moves;
  $('parCount').textContent = LEVELS[levelIndex].par;
  $('soundButton').textContent = sound.on ? '🔊' : '🔇';
}
function totalStars() { return Object.values(save.done).reduce((a, d) => a + (d.stars || 0), 0); }
function renderLevels() {
  const list = $('templeList'); list.innerHTML = '';
  const open = unlockedUpTo();
  $('starTotal').textContent = `✦ ${totalStars()} / ${LEVELS.length * 3}`;
  TEMPLES.forEach((th, ti) => {
    const sec = document.createElement('section');
    const first = ti * PER_TEMPLE;
    const doneCount = Array.from({ length: PER_TEMPLE }, (_, i) => save.done[first + i]).filter(Boolean).length;
    sec.className = 'temple' + (first > open ? ' locked' : '');
    sec.style.background = `linear-gradient(160deg, ${th.sky[2]}cc, ${th.sky[0]}ee)`;
    sec.innerHTML = `<header><b>${ROMAN[ti]}. ${th.name}</b><small>${th.sub}</small><span>${doneCount}/${PER_TEMPLE}</span></header>`;
    const grid = document.createElement('div'); grid.className = 'grid';
    for (let i = 0; i < PER_TEMPLE; i++) {
      const n = first + i, d = save.done[n];
      const b = document.createElement('button');
      b.className = 'lv' + (d ? ' done' : '') + (n === open && !d ? ' current' : '');
      b.disabled = n > open;
      b.innerHTML = `${i + 1}<small>${d ? '✦'.repeat(d.stars) : n > open ? '🔒' : ''}</small>`;
      b.setAttribute('aria-label', `Level ${i + 1} of ${th.name}${d ? `, ${d.stars} stars` : n > open ? ', locked' : ''}`);
      b.addEventListener('click', () => startLevel(n));
      grid.appendChild(b);
    }
    sec.appendChild(grid); list.appendChild(sec);
  });
  requestAnimationFrame(() => list.querySelector('.current, .lv:not(:disabled):last-of-type')?.scrollIntoView({ block: 'center' }));
}
function showWin(stars, par) {
  const last = levelIndex === LEVELS.length - 1;
  const endOfTemple = (levelIndex + 1) % PER_TEMPLE === 0;
  $('winTitle').textContent = last ? 'All temples conquered!' : endOfTemple ? `${TEMPLES[Math.floor(levelIndex / PER_TEMPLE)].name} cleansed` : ['The pit is sealed', 'Into the dark', 'Well tumbled', 'The relic rests'][levelIndex % 4];
  $('winStars').innerHTML = '✦'.repeat(stars) + '<i>' + '✦'.repeat(3 - stars) + '</i>';
  $('winSummary').textContent = `${moves} moves · par ${par}${moves <= par ? ' — perfect!' : ''}${endOfTemple && !last ? ` · ${TEMPLES[Math.floor(levelIndex / PER_TEMPLE) + 1].name} awaits.` : ''}`;
  $('nextButton').classList.toggle('hidden', last);
  show('win');
}
function startLevel(n) {
  sound.unlock();
  show(null);
  $('hint').classList.remove('on');
  loadLevel(n);
}
$('playButton').addEventListener('click', () => startLevel(unlockedUpTo()));
$('levelsButton').addEventListener('click', () => { renderLevels(); show('levels'); });
$('levelsBack').addEventListener('click', () => show(mode === 'menu' ? 'menu' : mode === 'win' ? 'win' : null));
$('hudLevels').addEventListener('click', () => { renderLevels(); show('levels'); });
$('nextButton').addEventListener('click', () => startLevel(Math.min(LEVELS.length - 1, levelIndex + 1)));
$('replayButton').addEventListener('click', () => startLevel(levelIndex));
$('winLevels').addEventListener('click', () => { renderLevels(); show('levels'); });
$('restartButton').addEventListener('click', () => { if (mode === 'play' || mode === 'anim') restartLevel(); });
$('soundButton').addEventListener('click', () => { sound.on = !sound.on; save.sound = sound.on; persist(); updateHud(); sound.unlock(); sound.click(); });
if (save.done[0]) $('playButton').textContent = `▶ Continue · ${ROMAN[Math.floor(unlockedUpTo() / PER_TEMPLE)]}-${(unlockedUpTo() % PER_TEMPLE) + 1}`;

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let elapsed = 0;
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    if (tw.t < 0) continue;
    const k = clamp(tw.t / tw.dur, 0, 1);
    tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.done?.(); }
  }
  for (const f of fallers) f.update(dt);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.v.y -= p.g * dt;
    p.m.position.addScaledVector(p.v, dt);
    p.m.rotation.x += p.spin * dt; p.m.rotation.y += p.spin * dt;
    const s = clamp(p.life / p.max, 0, 1);
    if (p.fade) p.m.material.opacity = s; else p.m.scale.setScalar(s);
    if (p.life <= 0) { fx.remove(p.m); particles.splice(i, 1); }
  }
  for (const a of animated) a(elapsed, dt);
  for (const a of levelAnim) a(elapsed, dt);
  for (const rec of tiles.values()) {
    if (rec.ring) { rec.ring.rotation.z = elapsed * 0.6; if (mode !== 'win') rec.beam.material.opacity = 0.38 + Math.sin(elapsed * 2.4) * 0.1; }
  }
  if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) $('hint').classList.remove('on'); }
  // camera: gentle drift around the level, with a little shake
  const sway = Math.sin(elapsed * 0.25) * 0.04;
  const dir = CAM_DIR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), mode === 'menu' ? elapsed * 0.08 : sway);
  camera.position.copy(levelCenter).addScaledVector(dir, camDist);
  if (shakeAmt > 0) { camera.position.x += (Math.random() - 0.5) * shakeAmt; camera.position.y += (Math.random() - 0.5) * shakeAmt; shakeAmt = Math.max(0, shakeAmt - dt * 0.8); }
  camera.lookAt(levelCenter.x, -0.3, levelCenter.z);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// read-only peek used when testing in the browser
window.__tumble = { get mode() { return mode; }, get moves() { return moves; }, get level() { return levelIndex; }, get state() { return state; } };

// a level sits behind the title screen as a backdrop
loadLevel(unlockedUpTo(), { instant: true });
mode = 'menu'; inputLocked = true;
show('menu');
frame();
