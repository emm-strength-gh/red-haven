import * as THREE from 'three';
import { WorldEvents } from './snakes-events.js';

// ================================================================ constants
const N = 25;                       // arena is N x N cells
const HALF = (N - 1) / 2;
const wx = (x) => x - HALF;         // cell -> world coordinate (x and z)
const MID = Math.floor(N / 2);
const key = (x, y) => x + ',' + y;
const BEST_KEY = 'snakes-best-v1';

const POWERS = {
  zoom:   { emoji: '⚡', name: 'Zoom',    color: '#ffd23f', dur: 6,  tip: 'Zoom!' },
  shield: { emoji: '🛡️', name: 'Shield',  color: '#4d96ff', dur: 20, tip: 'Shield up!' },
  titan:  { emoji: '💪', name: 'Titan',   color: '#ff5f57', dur: 7,  tip: 'Titan: smash it all!' },
  ghost:  { emoji: '👻', name: 'Ghost',   color: '#b49bff', dur: 7,  tip: 'Ghost: pass through yourself' },
  double: { emoji: '✨', name: 'x2 Score', color: '#ff7eb6', dur: 10, tip: 'Double score!' },
  magnet: { emoji: '🧲', name: 'Magnet',  color: '#2ec4b6', dur: 9,  tip: 'Magnet: apples come to you' },
  blast:  { emoji: '💣', name: 'Blast',   color: '#ff8a3d', dur: 0,  tip: 'BOOM!' },
};
const POWER_IDS = Object.keys(POWERS);

const LEVELS = [
  {
    id: 'jungle', name: 'Jungle Run', art: '🌴🦜🌿', artBg: '#8ee04e',
    blurb: 'Dense trees, mushrooms and muddy ponds.',
    sky: 0x9be0c0, fogNear: 55, fogFar: 120, outside: '#3f8f45', rim: '#8a5a34', rimTop: '#6fbf4a',
    groundA: '#7fd45a', groundB: '#72c94e', line: 'rgba(20,70,20,0.16)', water: '#3fb6c9', waterAlt: '#5ed3e0',
    snakeA: '#ff9f1c', snakeB: '#ffc233', head: '#ff8a1c',
    seed: 11, obstacles: 44, lakes: 2, kinds: ['tree', 'tree', 'palm', 'bush', 'rock', 'mushroom'], ring: 'jungle', hemi: [0xffffff, 0x5a7a3a],
  },
  {
    id: 'desert', name: 'Dune Rush', art: '🌵☀️🏜️', artBg: '#ffd27a',
    blurb: 'Cacti, sandstone pillars and a lonely oasis.',
    sky: 0xffd9a0, fogNear: 55, fogFar: 125, outside: '#e0b062', rim: '#b9774a', rimTop: '#e8c27a',
    groundA: '#f4d890', groundB: '#eccd80', line: 'rgba(150,90,30,0.18)', water: '#34b6d6', waterAlt: '#6fd6ea',
    snakeA: '#2ec4b6', snakeB: '#4de0cf', head: '#22a89b',
    seed: 29, obstacles: 40, lakes: 1, kinds: ['cactus', 'cactus', 'cactus', 'rock', 'pillar', 'deadtree'], ring: 'desert', hemi: [0xfff3d0, 0xb8844a],
  },
  {
    id: 'mountain', name: 'Frost Peaks', art: '⛰️🌲❄️', artBg: '#bfe3ff',
    blurb: 'Pines, boulders and icy lakes — ringed by mountains.',
    sky: 0xa8d4f0, fogNear: 60, fogFar: 135, outside: '#aebfce', rim: '#6c7a8a', rimTop: '#dfe9f2',
    groundA: '#e9f2f8', groundB: '#dbe8f1', line: 'rgba(60,90,130,0.18)', water: '#7fc8f0', waterAlt: '#aee0fa',
    snakeA: '#4cc94a', snakeB: '#37b03f', head: '#2fa83a',
    seed: 47, obstacles: 46, lakes: 2, kinds: ['pine', 'pine', 'pine', 'boulder', 'boulder', 'crystal'], ring: 'mountain', hemi: [0xeaf4ff, 0x7a8aa0],
  },
];

// ================================================================ helpers
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
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---- cel shading: three-band toon ramp + inverted-hull outlines (same as Red Haven)
const gradient = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
gradient.minFilter = THREE.NearestFilter;
gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

const toonCache = new Map();
function toon(color, o = {}) {
  const k = `${color}|${o.emissive ?? ''}|${o.opacity ?? 1}`;
  let m = toonCache.get(k);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: gradient });
    if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 0.6; }
    if (o.opacity !== undefined && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
    toonCache.set(k, m);
  }
  return m;
}
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1d2433, side: THREE.BackSide });
function addOutline(mesh, scale = 1.08, mat = outlineMat) {
  const o = new THREE.Mesh(mesh.geometry, mat);
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
  oct: (r) => G(`o${r}`, () => new THREE.OctahedronGeometry(r, 0)),
  torus: (r, t) => G(`t${r},${t}`, () => new THREE.TorusGeometry(r, t, 6, 18)),
};
/** Add a toon mesh (with outline and shadow) to a parent. */
function mk(parent, g, color, pos = [0, 0, 0], o = {}) {
  const m = new THREE.Mesh(g, toon(color, o));
  m.position.set(pos[0], pos[1], pos[2]);
  if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
  if (o.scale) m.scale.set(o.scale[0], o.scale[1], o.scale[2]);
  m.castShadow = true;
  if (o.outline !== false) addOutline(m, o.outline || 1.08);
  parent.add(m);
  return m;
}

// ================================================================ scenery models
const jitter = (rng, c, amt = 0.06) => {
  const col = new THREE.Color(c);
  const hsl = {}; col.getHSL(hsl);
  col.setHSL(hsl.h + (rng() - 0.5) * amt, hsl.s, clamp(hsl.l + (rng() - 0.5) * amt * 2, 0, 1));
  return '#' + col.getHexString();
};

const BUILD = {
  tree(rng) {
    const g = new THREE.Group();
    mk(g, geo.cyl(0.13, 0.19, 0.7, 6), '#8a5a34', [0, 0.35, 0]);
    mk(g, geo.ico(0.62), jitter(rng, '#3f9a45'), [0, 1.0, 0], { rot: [0, rng() * 3, 0] });
    mk(g, geo.ico(0.42), jitter(rng, '#58b552'), [0.15, 1.45, 0.05], { rot: [0, rng() * 3, 0] });
    return g;
  },
  palm(rng) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) mk(g, geo.cyl(0.1 - i * 0.015, 0.14 - i * 0.015, 0.5, 6), '#b98a52', [i * 0.07, 0.25 + i * 0.45, 0], { rot: [0, 0, -0.14] });
    const top = new THREE.Group(); top.position.set(0.22, 1.4, 0); g.add(top);
    for (let i = 0; i < 6; i++) {
      const leaf = mk(top, geo.cone(0.14, 1.0, 4), jitter(rng, '#46b04a'), [0, 0, 0], { scale: [1, 1, 0.35] });
      const a = (i / 6) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.4, -0.04, Math.sin(a) * 0.4);
      leaf.rotation.set(0, -a, -Math.PI / 2 + 0.55);
    }
    mk(top, geo.sphere(0.12, 8, 6), '#7a4a2a', [0, -0.12, 0.08]);
    return g;
  },
  bush(rng) {
    const g = new THREE.Group();
    mk(g, geo.ico(0.38), jitter(rng, '#4aa84a'), [-0.12, 0.3, 0.05], { rot: [0, rng() * 3, 0] });
    mk(g, geo.ico(0.32), jitter(rng, '#5cc15a'), [0.18, 0.28, -0.08], { rot: [0, rng() * 3, 0] });
    mk(g, geo.sphere(0.07, 6, 5), '#ff5f8a', [0.0, 0.62, 0.22], { outline: 1.15 });
    return g;
  },
  mushroom() {
    const g = new THREE.Group();
    mk(g, geo.cyl(0.13, 0.17, 0.4, 7), '#fff1d6', [0, 0.2, 0]);
    mk(g, geo.sphere(0.4, 12, 8), '#a56bff', [0, 0.45, 0], { scale: [1, 0.65, 1] });
    for (const [x, z] of [[0.18, 0.12], [-0.15, 0.2], [0.02, -0.25]]) mk(g, geo.sphere(0.06, 6, 5), '#fffaf0', [x, 0.7, z], { outline: 1.2, scale: [1, 0.6, 1] });
    return g;
  },
  rock(rng, theme) {
    const g = new THREE.Group();
    const c = theme === 'desert' ? '#c99a62' : '#8d99a1';
    mk(g, geo.ico(0.46), jitter(rng, c), [0, 0.3, 0], { scale: [1.05, 0.75, 0.95], rot: [rng(), rng() * 3, rng()] });
    mk(g, geo.ico(0.24), jitter(rng, c, 0.1), [0.3, 0.14, 0.2], { rot: [rng(), rng() * 3, rng()] });
    return g;
  },
  boulder(rng) {
    const g = new THREE.Group();
    mk(g, geo.ico(0.5), jitter(rng, '#8493a3'), [0, 0.34, 0], { scale: [1, 0.85, 1], rot: [rng(), rng() * 3, rng()] });
    mk(g, geo.ico(0.3, 0), '#f3f8fc', [0.0, 0.62, 0], { scale: [1, 0.55, 1], outline: 1.1 });
    return g;
  },
  cactus(rng) {
    const g = new THREE.Group();
    const c = jitter(rng, '#4aa05a');
    mk(g, geo.cyl(0.2, 0.22, 1.0, 8), c, [0, 0.5, 0]);
    mk(g, geo.sphere(0.2, 8, 6), c, [0, 1.0, 0]);
    mk(g, geo.cyl(0.1, 0.1, 0.34, 6), c, [0.3, 0.55, 0], { rot: [0, 0, Math.PI / 2] });
    mk(g, geo.cyl(0.1, 0.1, 0.34, 6), c, [0.44, 0.74, 0]);
    mk(g, geo.sphere(0.1, 6, 5), c, [0.44, 0.92, 0]);
    if (rng() > 0.4) {
      mk(g, geo.cyl(0.09, 0.09, 0.3, 6), c, [-0.28, 0.4, 0], { rot: [0, 0, Math.PI / 2] });
      mk(g, geo.cyl(0.09, 0.09, 0.3, 6), c, [-0.42, 0.56, 0]);
      mk(g, geo.sphere(0.09, 6, 5), c, [-0.42, 0.72, 0]);
    }
    mk(g, geo.sphere(0.07, 6, 5), '#ff7eb6', [0.02, 1.2, 0], { outline: 1.15 });
    return g;
  },
  pillar(rng) {
    const g = new THREE.Group();
    const c = jitter(rng, '#d9a066');
    mk(g, geo.cyl(0.4, 0.46, 0.5, 7), c, [0, 0.25, 0]);
    mk(g, geo.cyl(0.32, 0.4, 0.5, 7), jitter(rng, '#e2ad72'), [0.03, 0.72, 0]);
    mk(g, geo.box(0.62, 0.2, 0.62), '#efc589', [0.03, 1.07, 0], { rot: [0, rng(), 0] });
    return g;
  },
  deadtree(rng) {
    const g = new THREE.Group();
    mk(g, geo.cyl(0.07, 0.13, 0.9, 5), '#7a5a3a', [0, 0.45, 0], { rot: [0, 0, 0.1] });
    mk(g, geo.cyl(0.04, 0.07, 0.5, 5), '#7a5a3a', [0.2, 0.75, 0], { rot: [0, 0, -0.9] });
    mk(g, geo.cyl(0.04, 0.06, 0.4, 5), '#7a5a3a', [-0.16, 0.62, 0.05], { rot: [0, 0, 0.9] });
    mk(g, geo.sphere(0.13, 6, 5), '#e8d9b8', [0.15, 0.1, 0.25], { scale: [1.3, 0.8, 1], outline: 1.12 }); // bone/skull
    return g;
  },
  pine(rng) {
    const g = new THREE.Group();
    mk(g, geo.cyl(0.1, 0.14, 0.4, 6), '#7a5230', [0, 0.2, 0]);
    const green = jitter(rng, '#2f7d5b');
    mk(g, geo.cone(0.62, 0.8, 7), green, [0, 0.7, 0]);
    mk(g, geo.cone(0.5, 0.75, 7), green, [0, 1.1, 0]);
    mk(g, geo.cone(0.36, 0.7, 7), green, [0, 1.5, 0]);
    mk(g, geo.cone(0.2, 0.34, 7), '#f6fbff', [0, 1.78, 0], { outline: 1.12 });
    return g;
  },
  crystal(rng) {
    const g = new THREE.Group();
    for (const [x, z, s] of [[0, 0, 1], [0.28, 0.1, 0.6], [-0.2, 0.2, 0.7]]) {
      mk(g, geo.oct(0.3), '#6fe0ff', [x, 0.45 * s + 0.1, z], { scale: [1, 1.9 * s, 1], rot: [0, rng() * 3, 0], emissive: '#2aa8e0', ei: 0.5 });
    }
    return g;
  },
};

// --- big scenery that rings the arena
function ringPiece(kind, rng, theme) {
  const g = new THREE.Group();
  if (kind === 'mountain') {
    const r = 2.2 + rng() * 2.4, h = 4 + rng() * 5.5;
    mk(g, geo.cone(r, h, 5), jitter(rng, '#7d8ea3', 0.05), [0, h / 2, 0], { rot: [0, rng() * 3, 0], outline: 1.04 });
    const ch = h * 0.42;
    mk(g, geo.cone(r * 0.44, ch, 5), '#f6fbff', [0, h - ch / 2 + 0.02, 0], { rot: [0, 0, 0], outline: 1.06 }).rotation.y = g.children[0].rotation.y;
  } else if (kind === 'dune') {
    const s = 1.3 + rng() * 1.6;
    mk(g, geo.sphere(1, 10, 6), jitter(rng, '#efcd85', 0.04), [0, -0.3, 0], { scale: [s * 1.5, s * 0.55, s], rot: [0, rng() * 3, 0], outline: 1.03 });
  } else if (kind === 'mesa') {
    const r = 1.4 + rng() * 1.4, h = 2.2 + rng() * 2.6;
    mk(g, geo.cyl(r * 0.85, r, h, 7), jitter(rng, '#c4784c', 0.04), [0, h / 2, 0], { rot: [0, rng() * 3, 0], outline: 1.04 });
    mk(g, geo.cyl(r * 0.9, r * 0.9, 0.3, 7), '#e0a56e', [0, h + 0.1, 0], { outline: 1.05 });
  } else if (kind === 'bigtree') {
    const s = 1.6 + rng() * 1.3;
    g.add(BUILD[rng() > 0.35 ? 'tree' : 'palm'](rng, theme));
    g.scale.setScalar(s);
  } else if (kind === 'pine') {
    g.add(BUILD.pine(rng)); g.scale.setScalar(1.3 + rng() * 1.2);
  } else if (kind === 'cactus') {
    g.add(BUILD.cactus(rng)); g.scale.setScalar(1.5 + rng());
  }
  return g;
}

// ================================================================ audio (synthesised)
class Sfx {
  constructor() {
    this.ctx = null;
    this.on = true;
    try { this.on = JSON.parse(localStorage.getItem('snakes-sound-v1')) !== false; } catch { /* blocked */ }
  }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('snakes-sound-v1', JSON.stringify(this.on)); } catch { /* blocked */ }
    return this.on;
  }
  tone(f0, f1, dur, type = 'square', vol = 0.3, delay = 0) {
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
  eat(combo = 1) { const b = 480 + Math.min(combo, 8) * 45; this.tone(b, b * 1.7, 0.1, 'square', 0.22); this.tone(b * 1.5, b * 2.4, 0.1, 'triangle', 0.18, 0.06); }
  gold() { [660, 880, 1100, 1320].forEach((f, i) => this.tone(f, f * 1.02, 0.12, 'triangle', 0.25, i * 0.07)); }
  power() { [440, 554, 659, 880].forEach((f, i) => this.tone(f, f * 1.01, 0.1, 'square', 0.2, i * 0.055)); }
  smash() { this.noise(0.18, 0.4, 1400); this.tone(150, 60, 0.15, 'sawtooth', 0.25); }
  boom() { this.noise(0.5, 0.6, 700); this.tone(110, 35, 0.4, 'sawtooth', 0.4); }
  bounce() { this.tone(300, 600, 0.12, 'sine', 0.3); this.tone(900, 400, 0.12, 'triangle', 0.2, 0.05); }
  die() { this.noise(0.4, 0.4, 600); this.tone(380, 70, 0.6, 'sawtooth', 0.3); }
  click() { this.tone(520, 700, 0.06, 'square', 0.15); }
}

// ================================================================ the game
class SnakesGame {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.sfx = new Sfx();
    this.best = this.loadBest();
    this.levelIndex = 0;
    this.state = 'menu';
    this.setupRenderer();
    this.gradient = gradient;
    this.swayK = 1;
    this.events = new WorldEvents(this);
    this.buildMenu();
    this.bindUI();
    this.bindInput();
    this.showScreen('menu');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    this.clock = 0;
    requestAnimationFrame((t) => this.frame(t));
    this.loadLevel(0, false); // a background scene behind the menu
  }

  // ---------------------------------------------------------- setup
  setupRenderer() {
    const stage = this.$('stage');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9be0c0);
    this.scene.fog = new THREE.Fog(0x9be0c0, 55, 120);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x5a7a3a, 1.5);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff3dc, 2.1);
    sun.position.set(-12, 28, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 80;
    sun.shadow.bias = -0.0015;
    this.scene.add(sun, sun.target);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 300);
    this.camBase = new THREE.Vector3(0, 40, 9);
    this.focus = new THREE.Vector3();
    this.zoom = 1;
    this.shake = 0;
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.fxGroup = new THREE.Group();
    this.scene.add(this.fxGroup);
    this.buildSnakeMeshes();
    this.particles = [];
    this.sway = [];
    this.emojiTex = new Map();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight, a = w / h;
    this.renderer.setSize(w, h);
    this.camera.aspect = a;
    const m = N + 3;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // leave a little room at the top for the HUD
    const dH = (m * 1.14) / 2 / t, dW = (m / 2) / (t * a);
    const d = Math.max(dH, dW);
    const tilt = THREE.MathUtils.degToRad(16);
    this.camBase.set(0, Math.cos(tilt) * d, Math.sin(tilt) * d + 0.8);
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------- level construction
  loadLevel(index, resetState = true) {
    this.levelIndex = index;
    const L = this.level = LEVELS[index];
    // clear previous world
    this.world.remove(...this.world.children);
    this.fxGroup.remove(...this.fxGroup.children);
    this.particles.length = 0;
    this.sway.length = 0;
    if (this.groundTex) this.groundTex.dispose();

    this.scene.background.setHex(L.sky);
    this.scene.fog.color.setHex(L.sky);
    this.scene.fog.near = L.fogNear; this.scene.fog.far = L.fogFar;
    this.hemi.color.setHex(L.hemi[0]); this.hemi.groundColor.setHex(L.hemi[1]);

    this.buildGround(L);
    this.buildLayout(L);
    this.buildRing(L);
    this.applySnakeColors();
    this.events.reset();
    if (resetState) this.resetRun();
    else this.resetRun(true);
    this.updateBestHUD();
  }

  buildGround(L) {
    const cs = 40, size = N * cs;
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const c = cv.getContext('2d');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      c.fillStyle = (x + y) % 2 ? L.groundA : L.groundB;
      c.fillRect(x * cs, y * cs, cs, cs);
    }
    // the faint grid
    c.strokeStyle = L.line; c.lineWidth = 2;
    for (let i = 0; i <= N; i++) {
      c.beginPath(); c.moveTo(i * cs, 0); c.lineTo(i * cs, size); c.stroke();
      c.beginPath(); c.moveTo(0, i * cs); c.lineTo(size, i * cs); c.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.groundTex = tex;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(N, N), new THREE.MeshToonMaterial({ map: tex, gradientMap: gradient }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.world.add(ground);

    const outside = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshToonMaterial({ color: L.outside, gradientMap: gradient }));
    outside.rotation.x = -Math.PI / 2; outside.position.y = -0.04;
    outside.receiveShadow = true;
    this.world.add(outside);

    // rim ledge around the arena
    const e = N / 2 + 0.4, len = N + 1.8;
    for (const [x, z, w, d] of [[0, -e, len, 0.8], [0, e, len, 0.8], [-e, 0, 0.8, len], [e, 0, 0.8, len]]) {
      const m = mk(this.world, geo.box(w, 0.5, d), L.rim, [x, 0.2, z], { outline: 1.04 });
      m.receiveShadow = true;
      mk(this.world, geo.box(w * (w > 1 ? 1 : 0.55), 0.08, d * (d > 1 ? 1 : 0.55)), L.rimTop, [x, 0.48, z], { outline: false });
    }
  }

  buildLayout(L) {
    const rng = rngFor(L.seed);
    this.obs = new Map();      // destroyable scenery: key -> {x,y,obj}
    this.water = new Map();    // deadly water: key -> mesh
    const blocked = new Set();
    const reserved = (x, y) => Math.abs(y - MID) <= 1 && x <= 11;

    // lakes
    this.waterMats = [];
    for (let i = 0; i < L.lakes; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const cx = 3 + Math.floor(rng() * (N - 6)), cy = 2 + Math.floor(rng() * (N - 4));
        const rx = 1.2 + rng() * 1.3, ry = 1 + rng() * 1.2;
        const cells = [];
        for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
          if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) continue;
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          if (dx * dx + dy * dy <= 1.05) cells.push([x, y]);
        }
        if (cells.length < 3 || cells.some(([x, y]) => reserved(x, y) || Math.abs(y - MID) <= 2 && x <= 12 || blocked.has(key(x, y)))) continue;
        for (const [x, y] of cells) {
          blocked.add(key(x, y));
          const mat = new THREE.MeshToonMaterial({ color: (x + y) % 2 ? L.water : L.waterAlt, gradientMap: gradient });
          const m = new THREE.Mesh(geo.box(0.98, 0.1, 0.98), mat);
          m.position.set(wx(x), 0.02, wx(y));
          m.receiveShadow = true;
          this.world.add(m);
          this.water.set(key(x, y), m);
          this.waterMats.push({ m, ph: rng() * 6 });
        }
        // little lake decoration
        const [lx, ly] = cells[Math.floor(cells.length / 2)];
        const deco = new THREE.Group();
        if (L.id === 'jungle') { mk(deco, geo.cyl(0.3, 0.3, 0.04, 10), '#58c25a', [0, 0.1, 0], { outline: 1.1 }); mk(deco, geo.sphere(0.1, 6, 5), '#ff7eb6', [0.05, 0.18, 0], { outline: 1.15 }); }
        else if (L.id === 'desert') { deco.add(BUILD.palm(rng)); deco.scale.setScalar(0.9); }
        else mk(deco, geo.ico(0.28), '#ffffff', [0, 0.14, 0], { scale: [1.3, 0.5, 1], outline: 1.1 });
        deco.position.set(wx(lx), 0.05, wx(ly));
        this.world.add(deco);
        break;
      }
    }

    // scattered obstacles, never clumped (max one blocked 4-neighbour)
    const neighbours = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => blocked.has(key(x + dx, y + dy))).length;
    let placed = 0, guard = 0;
    while (placed < L.obstacles && guard++ < 3000) {
      const x = Math.floor(rng() * N), y = Math.floor(rng() * N);
      if (blocked.has(key(x, y)) || reserved(x, y) || neighbours(x, y) > 1) continue;
      const kind = L.kinds[Math.floor(rng() * L.kinds.length)];
      this.placeObstacle(x, y, kind, rng, L.id);
      blocked.add(key(x, y));
      placed++;
    }

    // reachable cells from the start (so apples never spawn trapped)
    const seen = new Set([key(5, MID)]), stack = [[5, MID]];
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || seen.has(k) || this.water.has(k) || this.obs.has(k)) continue;
        seen.add(k); stack.push([nx, ny]);
      }
    }
    this.reachable = [...seen].map((k) => k.split(',').map(Number));
    this.layoutRng = rngFor(L.seed + 1000);
  }

  placeObstacle(x, y, kind, rng, theme) {
    const obj = BUILD[kind](rng, theme);
    obj.position.set(wx(x), 0, wx(y));
    obj.rotation.y = rng() * Math.PI * 2;
    const big = ['tree', 'palm', 'pine', 'cactus', 'pillar', 'deadtree'].includes(kind);
    obj.scale.setScalar((big ? 1.3 : 1.1) + rng() * 0.2);
    this.world.add(obj);
    if (['tree', 'palm', 'pine', 'cactus', 'bush'].includes(kind)) this.sway.push({ obj, ph: rng() * 6, amp: kind === 'bush' ? 0.02 : 0.045 });
    this.obs.set(key(x, y), { x, y, obj, kind });
  }

  buildRing(L) {
    const rng = rngFor(L.seed + 7);
    const kinds = L.ring === 'mountain' ? ['mountain', 'mountain', 'pine'] : L.ring === 'desert' ? ['dune', 'dune', 'mesa', 'cactus'] : ['bigtree', 'bigtree', 'bigtree'];
    const count = L.ring === 'mountain' ? 70 : L.ring === 'desert' ? 60 : 110;
    const inner = N / 2 + 1.2;
    for (let i = 0; i < count; i++) {
      const ang = rng() * Math.PI * 2;
      // squarish ring around the arena
      const rad = inner + 0.8 + Math.pow(rng(), 1.3) * 11;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const k = Math.max(Math.abs(dx), Math.abs(dz));
      const x = (dx / k) * rad, z = (dz / k) * rad;
      if (Math.abs(x) < inner && Math.abs(z) < inner) continue;
      let kind = kinds[Math.floor(rng() * kinds.length)];
      // keep the huge pieces away from the edge so they never block the view
      if ((kind === 'mountain' || kind === 'mesa' || kind === 'dune') && rad < inner + 2.8) kind = L.ring === 'mountain' ? 'pine' : 'cactus';
      const g = ringPiece(kind, rng, L.id);
      g.position.set(x, 0, z);
      if (!['mountain', 'dune', 'mesa'].includes(kind)) { g.rotation.y = rng() * 6; if (kind !== 'pine') this.sway.push({ obj: g, ph: rng() * 6, amp: 0.03 }); }
      this.world.add(g);
    }
  }

  // ---------------------------------------------------------- snake meshes
  buildSnakeMeshes() {
    this.snakeGroup = new THREE.Group();
    this.scene.add(this.snakeGroup);
    this.snakeOutline = new THREE.MeshBasicMaterial({ color: 0x1d2433, side: THREE.BackSide });
    this.matA = new THREE.MeshToonMaterial({ gradientMap: gradient, color: '#ff9f1c' });
    this.matB = new THREE.MeshToonMaterial({ gradientMap: gradient, color: '#ffc233' });
    this.matHead = new THREE.MeshToonMaterial({ gradientMap: gradient, color: '#ff8a1c' });
    this.segs = [];

    const head = new THREE.Group();
    const skull = new THREE.Mesh(geo.sphere(0.5, 16, 12), this.matHead);
    skull.scale.set(1.12, 0.92, 1);
    skull.castShadow = true;
    addOutline(skull, 1.08, this.snakeOutline);
    head.add(skull);
    for (const s of [-1, 1]) {
      const eye = mk(head, geo.sphere(0.17, 10, 8), '#ffffff', [0.26, 0.34, 0.22 * s], { outline: 1.12 });
      mk(eye, geo.sphere(0.085, 8, 6), '#1d2433', [0.1, 0.02, 0.0], { outline: false });
      mk(head, geo.sphere(0.07, 6, 5), '#ff7eb6', [0.3, 0.1, 0.4 * s], { outline: false, scale: [1, 0.5, 1] });
    }
    this.tongue = new THREE.Group();
    this.tongue.position.set(0.55, 0.08, 0);
    mk(this.tongue, geo.box(0.34, 0.04, 0.07), '#ff3b54', [0.17, 0, 0], { outline: false });
    mk(this.tongue, geo.box(0.14, 0.04, 0.05), '#ff3b54', [0.4, 0, 0.05], { outline: false, rot: [0, 0.5, 0] });
    mk(this.tongue, geo.box(0.14, 0.04, 0.05), '#ff3b54', [0.4, 0, -0.05], { outline: false, rot: [0, -0.5, 0] });
    head.add(this.tongue);
    this.head = head;
    this.headY = 0.5;
    this.snakeGroup.add(head);

    this.bubble = new THREE.Mesh(geo.sphere(0.95, 20, 14), new THREE.MeshBasicMaterial({ color: 0x6fb4ff, transparent: true, opacity: 0.32, depthWrite: false }));
    this.bubble.visible = false;
    this.snakeGroup.add(this.bubble);
    this.headAngle = 0;
  }

  applySnakeColors() {
    const L = this.level;
    this.matA.color.set(L.snakeA); this.matB.color.set(L.snakeB); this.matHead.color.set(L.head);
  }

  segMesh(i) {
    let m = this.segs[i];
    if (!m) {
      m = new THREE.Mesh(geo.sphere(1, 14, 10), this.matA);
      m.castShadow = true;
      addOutline(m, 1.1, this.snakeOutline);
      this.snakeGroup.add(m);
      this.segs[i] = m;
    }
    return m;
  }

  // ---------------------------------------------------------- run state
  resetRun(idle = false) {
    for (const f of this.foods || []) this.world.remove(f.obj);
    for (const p of this.pickups || []) this.world.remove(p.obj);
    this.snake = [{ x: 5, y: MID }, { x: 4, y: MID }, { x: 3, y: MID }];
    this.prevPos = this.snake.map((s) => ({ ...s }));
    this.dir = { x: 1, y: 0 };
    this.queue = [];
    this.grow = 0;
    this.score = 0;
    this.combo = 0;
    this.comboT = 0;
    this.acc = 0;
    this.foods = [];
    this.pickups = [];
    this.fx = {};
    this.fxMax = {};
    this.pickupT = 7;
    this.goldT = 16;
    this.chomp = 0;
    this.deadT = 0;
    this.headAngle = 0;
    this.spawnFood(false);
    this.updateHUD(true);
    this.renderChips(true);
    this.state = idle ? 'menu' : 'ready';
    this.$('hint').textContent = idle ? '' : 'Swipe or use arrow keys / WASD to start';
  }

  freeCell(minHeadDist = 0) {
    const head = this.snake[0];
    for (let i = 0; i < 120; i++) {
      const [x, y] = this.reachable[Math.floor(Math.random() * this.reachable.length)];
      const k = key(x, y);
      if (this.obs.has(k) || this.water.has(k)) continue;
      if (this.snake.some((s) => s.x === x && s.y === y)) continue;
      if (this.foods.some((f) => f.x === x && f.y === y) || this.pickups.some((p) => p.x === x && p.y === y)) continue;
      if (Math.abs(x - head.x) + Math.abs(y - head.y) < minHeadDist) continue;
      return { x, y };
    }
    return null;
  }

  spawnFood(gold) {
    const c = this.freeCell(gold ? 5 : 2);
    if (!c) return;
    const obj = new THREE.Group();
    const col = gold ? '#ffd23f' : '#ff4d4d';
    mk(obj, geo.sphere(0.3, 12, 10), col, [0, 0.35, 0], { scale: [1, 0.92, 1], emissive: gold ? '#ffb800' : undefined, ei: 0.6 });
    mk(obj, geo.cyl(0.025, 0.025, 0.16, 5), '#6b4226', [0, 0.68, 0], { outline: false });
    mk(obj, geo.sphere(0.1, 6, 5), '#4cc94a', [0.1, 0.72, 0.02], { outline: false, scale: [1.5, 0.4, 0.9] });
    if (gold) mk(obj, geo.torus(0.46, 0.035), '#fff3a0', [0, 0.4, 0], { outline: false, rot: [Math.PI / 2, 0, 0], emissive: '#ffd23f', ei: 1 });
    obj.position.set(wx(c.x), 0, wx(c.y));
    obj.scale.setScalar(0.01);
    this.world.add(obj);
    this.foods.push({ ...c, px: c.x, py: c.y, obj, gold, life: gold ? 10 : Infinity, born: 0 });
  }

  emojiSprite(emoji) {
    let tex = this.emojiTex.get(emoji);
    if (!tex) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const c = cv.getContext('2d');
      c.fillStyle = '#fffaf0'; c.strokeStyle = '#2a1f3d'; c.lineWidth = 8;
      c.beginPath(); c.arc(64, 64, 56, 0, Math.PI * 2); c.fill(); c.stroke();
      c.font = '70px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(emoji, 64, 70);
      tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      this.emojiTex.set(emoji, tex);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    s.scale.setScalar(1.25);
    return s;
  }

  spawnPickup() {
    const c = this.freeCell(4);
    if (!c) return;
    const type = POWER_IDS[Math.floor(Math.random() * POWER_IDS.length)];
    const P = POWERS[type];
    const obj = new THREE.Group();
    mk(obj, geo.oct(0.34), P.color, [0, 0.55, 0], { emissive: P.color, ei: 0.5, outline: 1.1 });
    const ring = mk(obj, geo.torus(0.5, 0.045), '#ffffff', [0, 0.06, 0], { outline: false, rot: [Math.PI / 2, 0, 0], emissive: P.color, ei: 0.8 });
    const spr = this.emojiSprite(P.emoji);
    spr.position.y = 1.35;
    obj.add(spr);
    obj.position.set(wx(c.x), 0, wx(c.y));
    obj.scale.setScalar(0.01);
    this.world.add(obj);
    this.pickups.push({ ...c, type, obj, spr, ring, life: 13, born: 0 });
  }

  // ---------------------------------------------------------- input
  setDir(d) {
    if (this.state === 'ready') { this.state = 'playing'; this.$('hint').textContent = ''; }
    if (this.state !== 'playing') return;
    const ref = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if ((d.x === ref.x && d.y === ref.y) || (d.x === -ref.x && d.y === -ref.y)) return;
    if (this.queue.length < 2) this.queue.push(d);
  }

  bindInput() {
    const DIRS = {
      ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
      ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
    };
    window.addEventListener('keydown', (e) => {
      this.sfx.unlock();
      const d = DIRS[e.code];
      if (d) { e.preventDefault(); this.setDir({ x: d[0], y: d[1] }); return; }
      if (e.code === 'Space' || e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        if (this.state === 'playing' || this.state === 'ready') this.pause();
        else if (this.state === 'paused') this.resume();
      } else if (e.code === 'Enter' && this.state === 'over') this.restart();
      else if (e.code === 'KeyM') this.toggleSound();
    });
    // swipe: fires as soon as the finger has moved far enough, then re-arms for chained swipes
    let sx = 0, sy = 0, down = false;
    const stage = this.$('stage');
    stage.addEventListener('pointerdown', (e) => { this.sfx.unlock(); down = true; sx = e.clientX; sy = e.clientY; });
    stage.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.hypot(dx, dy) < 26) return;
      this.setDir(Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) });
      sx = e.clientX; sy = e.clientY;
    });
    const up = () => { down = false; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    // on-screen direction pad
    document.querySelectorAll('.dpad button').forEach((b) => {
      const [x, y] = b.dataset.dir.split(',').map(Number);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.sfx.unlock(); this.setDir({ x, y }); });
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
  }

  bindUI() {
    this.$('btnPause').onclick = () => { this.sfx.unlock(); if (this.state === 'paused') this.resume(); else this.pause(); };
    this.$('btnSound').onclick = () => this.toggleSound();
    this.$('resume').onclick = () => this.resume();
    this.$('pRestart').onclick = () => this.restart();
    this.$('pMenu').onclick = () => this.toMenu();
    this.$('again').onclick = () => this.restart();
    this.$('oMenu').onclick = () => this.toMenu();
    this.$('btnSound').textContent = this.sfx.on ? '🔊' : '🔇';
  }

  buildMenu() {
    const box = this.$('levels');
    LEVELS.forEach((L, i) => {
      const b = document.createElement('button');
      b.className = 'level-card';
      b.innerHTML = `<div class="art" style="background:${L.artBg}">${L.art}</div><div class="info"><b>${L.name}</b><span>${L.blurb}</span><em>Best ${this.best[L.id] || 0}</em></div>`;
      b.onclick = () => this.start(i);
      box.appendChild(b);
    });
  }

  refreshMenu() {
    this.$('levels').querySelectorAll('.level-card em').forEach((em, i) => { em.textContent = `Best ${this.best[LEVELS[i].id] || 0}`; });
  }

  showScreen(name) {
    for (const id of ['menu', 'pause', 'over']) this.$(id).classList.toggle('hidden', id !== name);
    this.$('hud').classList.toggle('off', name === 'menu');
  }

  // ---------------------------------------------------------- flow
  start(i) {
    this.sfx.unlock(); this.sfx.click();
    this.loadLevel(i, true);
    this.$('levelName').textContent = this.level.name;
    this.showScreen(null);
  }
  restart() { this.sfx.unlock(); this.sfx.click(); this.loadLevel(this.levelIndex, true); this.showScreen(null); }
  toMenu() { this.sfx.click(); this.loadLevel(this.levelIndex, false); this.refreshMenu(); this.showScreen('menu'); }
  pause() { if (this.state === 'playing' || this.state === 'ready') { this.prevState = this.state; this.state = 'paused'; this.showScreen('pause'); } }
  resume() { if (this.state === 'paused') { this.state = this.prevState || 'playing'; this.showScreen(null); } }
  toggleSound() { this.sfx.unlock(); this.$('btnSound').textContent = this.sfx.toggle() ? '🔊' : '🔇'; }

  loadBest() { try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; } }
  saveBest() { try { localStorage.setItem(BEST_KEY, JSON.stringify(this.best)); } catch { /* blocked */ } }
  updateBestHUD() { this.$('best').textContent = this.best[this.level.id] || 0; }

  // ---------------------------------------------------------- simulation
  interval() {
    let t = Math.max(0.15, 0.38 - (this.snake.length - 3) * 0.003);
    if (this.fx.zoom > 0) t *= 0.62;
    return t;
  }

  tick() {
    if (this.queue.length) this.dir = this.queue.shift();
    const head = this.snake[0];
    const nx = head.x + this.dir.x, ny = head.y + this.dir.y;
    const k = key(nx, ny);
    const out = nx < 0 || ny < 0 || nx >= N || ny >= N;
    const foodIdx = this.foods.findIndex((f) => f.x === nx && f.y === ny);
    let hit = null;
    if (out) hit = 'You hit the edge of the arena';
    else if (this.water.has(k)) hit = 'You swam where snakes should not';
    else if (this.obs.has(k) && !(this.fx.titan > 0)) hit = 'You slithered into the scenery';
    if (!hit && !(this.fx.ghost > 0)) {
      const keepTail = this.grow > 0 || foodIdx >= 0;
      const len = keepTail ? this.snake.length : this.snake.length - 1;
      for (let i = 0; i < len; i++) if (this.snake[i].x === nx && this.snake[i].y === ny) { hit = 'You bit your own tail'; break; }
    }
    if (hit) {
      if (this.fx.shield > 0) { this.useShield(); return; }
      this.die(hit); return;
    }

    this.prevPos = this.snake.map((s) => ({ x: s.x, y: s.y }));
    this.snake.unshift({ x: nx, y: ny });

    // smash scenery with Titan
    const ob = this.obs.get(k);
    if (ob) { this.destroyObstacle(ob, true); this.addScore(5, nx, ny, '#ff8a3d', false); this.sfx.smash(); this.shake = Math.max(this.shake, 0.25); }

    if (foodIdx >= 0) this.eat(foodIdx);
    const pi = this.pickups.findIndex((p) => p.x === nx && p.y === ny);
    if (pi >= 0) this.collect(pi);

    if (this.grow > 0) this.grow--;
    else this.snake.pop();

    if (this.fx.magnet > 0) this.pullFood();
    if (this.fx.zoom > 0) this.burst(wx(this.snake[this.snake.length - 1].x), wx(this.snake[this.snake.length - 1].y), '#ffd23f', 2, 0.6);
    this.updateHUD();
  }

  useShield() {
    this.fx.shield = 0;
    this.sfx.bounce();
    this.shake = 0.5;
    const h = this.snake[0];
    this.burst(wx(h.x), wx(h.y), '#6fb4ff', 14, 1.4);
    this.popText(h.x, h.y, 'Saved!', '#9bd0ff');
    this.prevPos = this.snake.map((s) => ({ ...s }));
    // turn towards free space
    const side = Math.random() < 0.5 ? 1 : -1;
    const cands = [{ x: -this.dir.y * side, y: this.dir.x * side }, { x: this.dir.y * side, y: -this.dir.x * side }];
    const free = (d) => {
      const x = h.x + d.x, y = h.y + d.y, kk = key(x, y);
      return x >= 0 && y >= 0 && x < N && y < N && !this.water.has(kk) && !this.obs.has(kk) && !(this.snake[1] && this.snake[1].x === x && this.snake[1].y === y);
    };
    const pick = cands.find(free);
    if (pick) this.dir = pick;
    this.queue = [];
    this.renderChips(true);
  }

  eat(idx) {
    const f = this.foods[idx];
    this.foods.splice(idx, 1);
    this.world.remove(f.obj);
    this.comboT > 0 ? this.combo++ : (this.combo = 1);
    this.comboT = 4;
    const mult = Math.min(5, 1 + Math.floor((this.combo - 1) / 2));
    let pts = (f.gold ? 50 : 10) * mult;
    if (this.fx.double > 0) pts *= 2;
    this.grow += f.gold ? 2 : 1;
    this.addScore(pts, f.x, f.y, f.gold ? '#ffd23f' : '#ffffff', true);
    this.burst(wx(f.x), wx(f.y), f.gold ? '#ffd23f' : '#ff4d4d', f.gold ? 16 : 9, 1.2);
    f.gold ? this.sfx.gold() : this.sfx.eat(this.combo);
    this.chomp = 1;
    if (!this.foods.some((x) => !x.gold)) this.spawnFood(false);
  }

  collect(idx) {
    const p = this.pickups[idx];
    this.pickups.splice(idx, 1);
    this.world.remove(p.obj);
    const P = POWERS[p.type];
    this.popText(p.x, p.y, P.tip, P.color);
    this.burst(wx(p.x), wx(p.y), P.color, 14, 1.4);
    if (p.type === 'blast') {
      this.blast(p.x, p.y);
    } else {
      this.fx[p.type] = P.dur;
      this.fxMax[p.type] = P.dur;
      this.sfx.power();
      this.renderChips(true);
    }
  }

  blast(cx, cy) {
    this.sfx.boom();
    this.shake = 0.9;
    let n = 0;
    for (const ob of [...this.obs.values()]) {
      if (Math.max(Math.abs(ob.x - cx), Math.abs(ob.y - cy)) <= 3) { this.destroyObstacle(ob, true); n++; }
    }
    // shockwave ring
    const ring = new THREE.Mesh(geo.torus(1, 0.12), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9 }));
    ring.rotation.x = Math.PI / 2; ring.position.set(wx(cx), 0.3, wx(cy));
    this.fxGroup.add(ring);
    this.particles.push({ mesh: ring, ring: true, life: 0.5, max: 0.5 });
    if (n) this.addScore(n * 5, cx, cy, '#ff8a3d', false);
  }

  destroyObstacle(ob, withParticles) {
    this.obs.delete(key(ob.x, ob.y));
    this.world.remove(ob.obj);
    this.sway = this.sway.filter((s) => s.obj !== ob.obj);
    if (withParticles) this.burst(wx(ob.x), wx(ob.y), '#8a6a3a', 10, 1.5);
  }

  pullFood() {
    const h = this.snake[0];
    for (const f of this.foods) {
      if (Math.abs(f.x - h.x) + Math.abs(f.y - h.y) > 6) continue;
      const dx = Math.sign(h.x - f.x), dy = Math.sign(h.y - f.y);
      const opts = Math.abs(h.x - f.x) >= Math.abs(h.y - f.y) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
      for (const [ox, oy] of opts) {
        if (!ox && !oy) continue;
        const x = f.x + ox, y = f.y + oy, kk = key(x, y);
        if (x < 0 || y < 0 || x >= N || y >= N || this.obs.has(kk) || this.water.has(kk)) continue;
        if (this.snake.slice(1).some((s) => s.x === x && s.y === y)) continue;
        f.x = x; f.y = y;
        break;
      }
    }
  }

  die(reason) {
    this.state = 'dead';
    this.deadT = 0;
    this.sfx.die();
    this.shake = 1;
    const h = this.snake[0];
    this.burst(wx(h.x), wx(h.y), '#ff5f57', 22, 2);
    this.deathReason = reason;
    this.$('hint').textContent = '';
  }

  finishDeath() {
    this.state = 'over';
    const id = this.level.id;
    const isBest = this.score > (this.best[id] || 0);
    if (isBest) { this.best[id] = this.score; this.saveBest(); }
    this.$('overTitle').textContent = this.score >= 300 ? 'Slithering success!' : 'Game over';
    this.$('overWhy').textContent = this.deathReason;
    this.$('overScore').textContent = this.score;
    this.$('overBest').textContent = isBest && this.score > 0 ? '🏆 New best!' : '';
    this.updateBestHUD();
    this.showScreen('over');
  }

  addScore(pts, cx, cy, color, withCombo) {
    this.score += pts;
    const mult = Math.min(5, 1 + Math.floor((this.combo - 1) / 2));
    this.popText(cx, cy, '+' + pts + (withCombo && mult > 1 ? ` x${mult}` : ''), color);
    const s = this.$('score').parentElement;
    s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump');
  }

  // ---------------------------------------------------------- HUD
  updateHUD() {
    this.$('score').textContent = this.score;
    this.$('length').textContent = this.snake.length;
    const mult = this.combo > 0 && this.comboT > 0 ? Math.min(5, 1 + Math.floor((this.combo - 1) / 2)) : 1;
    this.$('combo').textContent = mult > 1 ? `x${mult}` : '';
  }

  renderChips(force) {
    const box = this.$('chips');
    const active = POWER_IDS.filter((id) => this.fx[id] > 0);
    const sig = active.join();
    if (force || sig !== this.chipSig) {
      this.chipSig = sig;
      box.innerHTML = '';
      this.chipBars = {};
      for (const id of active) {
        const P = POWERS[id];
        const c = document.createElement('div');
        c.className = 'chip';
        c.innerHTML = `<span class="e">${P.emoji}</span><span>${P.name}</span><div class="bar"><i style="--c:${P.color}"></i></div>`;
        box.appendChild(c);
        this.chipBars[id] = c.querySelector('i');
      }
    }
    for (const id of active) this.chipBars[id].style.transform = `scaleX(${clamp(this.fx[id] / this.fxMax[id], 0, 1)})`;
  }

  popText(cx, cy, text, color) {
    const v = new THREE.Vector3(wx(cx), 0.9, wx(cy)).project(this.camera);
    const el = document.createElement('div');
    el.className = 'pop';
    el.textContent = text;
    el.style.setProperty('--c', color);
    el.style.left = ((v.x + 1) / 2) * window.innerWidth + 'px';
    el.style.top = ((1 - v.y) / 2) * window.innerHeight + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  burst(x, z, color, n, power = 1) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo.ico(0.1), toon(color));
      m.position.set(x, 0.5, z);
      const a = Math.random() * Math.PI * 2, s = (1.5 + Math.random() * 2.5) * power;
      this.fxGroup.add(m);
      this.particles.push({ mesh: m, vx: Math.cos(a) * s, vy: 2.5 + Math.random() * 3 * power, vz: Math.sin(a) * s, life: 0.6 + Math.random() * 0.4, max: 1 });
    }
  }

  // ---------------------------------------------------------- hooks used by the background events
  showEventTag(text) { const e = this.$('eventTag'); e.textContent = text; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); }
  hideEventTag() { this.$('eventTag').classList.remove('show'); }
  setOverlay(dim, dimColor, tint, tintColor) {
    const d = this.$('fxDim'), t = this.$('fxTint');
    d.style.opacity = dim.toFixed(3); d.style.background = dimColor;
    t.style.opacity = tint.toFixed(3); t.style.background = tintColor;
  }

  // ---------------------------------------------------------- frame
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.update(dt);
    this.render(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    this.events.update(dt, this.state === 'playing');
    if (this.state === 'playing') {
      for (const id of POWER_IDS) if (this.fx[id] > 0) { this.fx[id] -= dt; if (this.fx[id] <= 0) { this.fx[id] = 0; this.renderChips(true); } }
      if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; this.updateHUD(); } }
      this.renderChips(false);
      // food & pickup lifetimes
      for (let i = this.foods.length - 1; i >= 0; i--) {
        const f = this.foods[i];
        if (f.gold) { f.life -= dt; if (f.life <= 0) { this.world.remove(f.obj); this.foods.splice(i, 1); } }
      }
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const p = this.pickups[i];
        p.life -= dt;
        if (p.life <= 0) { this.world.remove(p.obj); this.pickups.splice(i, 1); }
      }
      this.pickupT -= dt;
      if (this.pickupT <= 0) { if (this.pickups.length < 2) this.spawnPickup(); this.pickupT = 8 + Math.random() * 5; }
      this.goldT -= dt;
      if (this.goldT <= 0) { if (!this.foods.some((f) => f.gold)) this.spawnFood(true); this.goldT = 18 + Math.random() * 10; }

      this.acc += dt;
      let guard = 0;
      while (this.state === 'playing' && this.acc >= this.interval() && guard++ < 4) {
        this.acc -= this.interval();
        this.tick();
      }
    } else if (this.state === 'dead') {
      this.deadT += dt;
      if (this.deadT > 1.1) this.finishDeath();
    }
    // idle animation for the menu backdrop
    for (const p of this.particles) {
      p.life -= dt;
      if (p.ring) { const s = 1 + (1 - p.life / p.max) * 7; p.mesh.scale.setScalar(s); p.mesh.material.opacity = Math.max(0, p.life / p.max); }
      else { p.vy -= 12 * dt; p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt; p.mesh.scale.setScalar(Math.max(0.01, p.life / p.max * 1.4)); if (p.mesh.position.y < 0.08) { p.mesh.position.y = 0.08; p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; } }
    }
    this.particles = this.particles.filter((p) => { if (p.life > 0) return true; this.fxGroup.remove(p.mesh); return false; });
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  render(dt) {
    const t = this.clock;
    const playing = this.state === 'playing';
    const frac = playing ? clamp(this.acc / this.interval(), 0, 1) : (this.state === 'dead' || this.state === 'paused' || this.state === 'over' ? this.lastFrac ?? 1 : 1);
    this.lastFrac = frac;

    // ---- snake path (world coords), interpolated between ticks
    const n = this.snake.length;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const to = this.snake[i], from = this.prevPos[Math.min(i, this.prevPos.length - 1)] || to;
      pts.push({ x: wx(lerp(from.x, to.x, frac)), z: wx(lerp(from.y, to.y, frac)) });
    }
    const hp = pts[0];
    // head heading
    const target = Math.atan2(-this.dir.y, this.dir.x);
    let diff = target - this.headAngle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.headAngle += diff * Math.min(1, dt * 16);
    const chomp = this.chomp = Math.max(0, this.chomp - dt * 5);
    const sc = 1 + Math.sin(chomp * Math.PI) * 0.25;
    this.head.position.set(hp.x, this.headY, hp.z);
    this.head.rotation.y = this.headAngle;
    this.head.scale.setScalar(sc * (this.fx.titan > 0 ? 1.12 : 1));
    this.tongue.scale.x = 0.4 + Math.max(0, Math.sin(t * 9)) * 0.9;
    this.matHead.color.set(this.fx.titan > 0 ? '#ff5f57' : this.level.head);
    const ghost = this.fx.ghost > 0;
    for (const m of [this.matA, this.matB, this.matHead, this.snakeOutline]) {
      if (m.transparent !== ghost) { m.transparent = ghost; m.needsUpdate = true; }
      m.opacity = ghost ? 0.5 : 1;
    }
    this.bubble.visible = this.fx.shield > 0;
    this.bubble.position.set(hp.x, 0.55, hp.z);
    this.bubble.scale.setScalar(1 + Math.sin(t * 5) * 0.05);

    // body: two spheres per cell so turns stay smooth
    const total = Math.max(0, 2 * (n - 1));
    const dead = this.state === 'dead';
    for (let j = 1; j <= total; j++) {
      const i = Math.floor(j / 2), f = (j % 2) * 0.5;
      const a = pts[i], b = pts[Math.min(i + 1, n - 1)];
      const m = this.segMesh(j);
      const k = j / total;
      const r = 0.43 * (k > 0.55 ? lerp(1, 0.42, (k - 0.55) / 0.45) : 1);
      m.visible = !(dead && Math.floor(this.deadT * 10) % 2 === 0);
      m.material = Math.floor(j / 2) % 2 ? this.matB : this.matA;
      m.position.set(lerp(a.x, b.x, f), 0.43 * r / 0.43 + (ghost ? Math.sin(t * 4 + j) * 0.04 : 0), lerp(a.z, b.z, f));
      m.scale.setScalar(r);
    }
    for (let j = total + 1; j < this.segs.length; j++) if (this.segs[j]) this.segs[j].visible = false;
    if (dead) this.head.visible = Math.floor(this.deadT * 10) % 2 !== 0 || this.deadT > 1; else this.head.visible = true;

    // ---- food & pickups
    for (const f of this.foods) {
      f.px = lerp(f.px, f.x, Math.min(1, dt * 10)); f.py = lerp(f.py, f.y, Math.min(1, dt * 10));
      f.born = Math.min(1, f.born + dt * 4);
      const pop = f.born < 1 ? 1 - Math.pow(1 - f.born, 3) : 1;
      f.obj.position.set(wx(f.px), Math.sin(t * 3 + f.x) * 0.06, wx(f.py));
      f.obj.rotation.y = t * (f.gold ? 2 : 0.8);
      f.obj.scale.setScalar(1.35 * Math.max(0.01, pop * (f.gold && f.life < 3 && Math.floor(t * 8) % 2 ? 0.7 : 1)));
    }
    for (const p of this.pickups) {
      p.born = Math.min(1, p.born + dt * 4);
      p.obj.scale.setScalar(Math.max(0.01, 1 - Math.pow(1 - p.born, 3)));
      p.obj.visible = !(p.life < 3 && Math.floor(t * 8) % 2);
      p.obj.children[0].rotation.y = t * 2.5;
      p.obj.children[0].position.y = 0.6 + Math.sin(t * 3) * 0.1;
      p.spr.position.y = 1.35 + Math.sin(t * 3 + 1) * 0.08;
      p.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
    }

    // ---- ambience
    for (const s of this.sway) s.obj.rotation.z = Math.sin(t * 1.4 + s.ph) * s.amp * this.swayK;
    for (const w of this.waterMats || []) w.m.position.y = 0.02 + Math.sin(t * 2 + w.ph) * 0.012;

    // ---- camera
    const sh = this.shake * this.shake;
    // follow the head with a gentle ease, zoomed in while playing and pulled back on the menu
    const following = this.state !== 'menu';
    const hx = clamp(hp.x, -HALF - 1, HALF + 1), hz = clamp(hp.z, -HALF - 1, HALF + 1);
    const ease = 1 - Math.exp(-dt * 4);
    this.focus.x += ((following ? hx : 0) - this.focus.x) * ease;
    this.focus.z += ((following ? hz : 0) - this.focus.z) * ease;
    this.zoom += ((following ? 0.5 : 1) - this.zoom) * (1 - Math.exp(-dt * 2.5));
    this.camera.position.set(
      this.focus.x + this.camBase.x * this.zoom + (Math.random() - 0.5) * sh * 0.9,
      this.camBase.y * this.zoom + (Math.random() - 0.5) * sh * 0.5,
      this.focus.z + this.camBase.z * this.zoom + (Math.random() - 0.5) * sh * 0.9);
    this.camera.lookAt(this.focus.x, 0, this.focus.z);
    this.renderer.render(this.scene, this.camera);
  }
}

window.snakes = new SnakesGame();
