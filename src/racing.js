import * as THREE from 'three';
import { TRACKS, CARS, AI_NAMES, AI_COLORS } from './racing-tracks.js';
import {
  buildTrack, setupRace, stepWorld, respawn, pathPoint, nearestOnPath, gapAt, rampHeight,
  insideOther, formatTime, mulberry32, makeAI, SPEED_TO_KMH
} from './racing-sim.js';
import { createAudio } from './racing-audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const SAVE_KEY = 'toy-cars-racing-v1';
const DT = 1 / 120;
const CAMS = ['chase', 'driver', 'top'];
const CAM_LABEL = { chase: '3rd person', driver: 'Driver POV', top: "Bird's eye" };
const PAINTS = ['#ff3b2f', '#ff8a00', '#ffd400', '#4fd34a', '#16d1c2', '#2f6bff', '#b04dff', '#ff5fa8', '#f4f4f8', '#2a2a33'];

// ------------------------------------------------------------------ save
const save = loadSave();
function loadSave() {
  const base = { paceVersion: 3, car: 0, paint: {}, records: {}, settings: { sound: true, touch: 'auto', autoGas: false, cam: 'chase', ghost: true, quality: 'high' }, diff: 'normal' };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s) {
      if (s.paceVersion !== base.paceVersion) {
        for (const r of Object.values(s.records || {})) {
          if (r && typeof r === 'object') { r.bestLap = null; r.bestTotal = null; r.ghost = null; }
        }
        s.paceVersion = base.paceVersion;
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
      }
      return { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
    }
  } catch { /* ignore */ }
  return base;
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* quota or private mode */ } }
function rec(id) { return (save.records[id] ||= { bestLap: null, bestTotal: null, place: {}, ghost: null }); }

const audio = createAudio();
audio.setEnabled(save.settings.sound);

// ------------------------------------------------------------------ renderer
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);
function applyQuality() {
  const hi = save.settings.quality === 'high';
  renderer.setPixelRatio(Math.min(hi ? 2 : 1.25, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = hi;
}
applyQuality();

const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 2400); // near 0.3 (not 0.1): ~3x more depth precision for the stacked road layers
let scene = new THREE.Scene();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  garageCam.aspect = w / h; garageCam.updateProjectionMatrix();
  const portrait = h > w && Math.min(w, h) < 700;
  $('rotate').classList.toggle('hidden', !(portrait && state === 'race'));
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ textures
const texCache = new Map();
function canvasTex(key, w, h, draw, { rx = 1, ry = 1, clampS = false } = {}) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = clampS ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}
const rnd = mulberry32(12345);
function speckle(g, w, h, n, cols, size = 2) {
  for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(rnd() * w, rnd() * h, size, size); }
}

function roadTexture(kind, col) {
  return canvasTex('road-' + kind + col, 128, 256, (g, w, h) => {
    if (kind === 'plastic') {
      const c = new THREE.Color(col);
      const lite = '#' + c.clone().offsetHSL(0, 0, 0.08).getHexString(), dark = '#' + c.clone().offsetHSL(0, 0.02, -0.1).getHexString();
      g.fillStyle = col; g.fillRect(0, 0, w, h);
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, 'rgba(0,0,0,.18)'); gr.addColorStop(0.2, 'rgba(255,255,255,.08)'); gr.addColorStop(0.5, 'rgba(255,255,255,.14)'); gr.addColorStop(0.8, 'rgba(255,255,255,.08)'); gr.addColorStop(1, 'rgba(0,0,0,.18)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = dark;
      for (const x of [0.14, 0.86]) g.fillRect(x * w - 3, 0, 6, h);
      g.fillStyle = lite; g.fillRect(w / 2 - 2, 0, 4, h);
      // piece joints
      g.fillStyle = dark; g.fillRect(0, 0, w, 4);
      g.fillStyle = 'rgba(255,255,255,.35)';
      for (const x of [0.3, 0.7]) for (let y = 30; y < h; y += 64) { g.beginPath(); g.arc(x * w, y, 3, 0, TAU); g.fill(); }
    } else if (kind === 'dirt') {
      g.fillStyle = '#9a6a3e'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 1400, ['#87582f', '#b07d4c', '#6e4524', '#c49260'], 3);
      g.fillStyle = 'rgba(60,35,15,.35)'; for (const x of [0.32, 0.68]) g.fillRect(x * w - 7, 0, 14, h);
    } else if (kind === 'ice') {
      g.fillStyle = '#bfe8ff'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2;
      for (let i = 0; i < 26; i++) { g.beginPath(); const x = rnd() * w, y = rnd() * h; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 60, y + rnd() * 50); g.stroke(); }
      g.fillStyle = 'rgba(120,190,240,.4)'; for (let i = 0; i < 12; i++) g.fillRect(rnd() * w, rnd() * h, 20, 3);
    } else {
      // asphalt variants
      const base = { city: '#3a3c4a', desert: '#4b4744', snowroad: '#4a505c' }[kind] || '#333';
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 2600, ['rgba(255,255,255,.06)', 'rgba(0,0,0,.25)', 'rgba(255,255,255,.1)'], 2);
      const edge = kind === 'desert' ? '#f4f0e6' : '#e8ecf4';
      g.fillStyle = edge; g.fillRect(6, 0, 5, h); g.fillRect(w - 11, 0, 5, h);
      if (kind === 'desert') { g.fillStyle = '#ffc21a'; g.fillRect(w / 2 - 6, 0, 4, h); g.fillRect(w / 2 + 2, 0, 4, h); }
      else { g.fillStyle = kind === 'city' ? '#ffd23a' : '#ffffff'; g.fillRect(w / 2 - 2.5, 0, 5, h * 0.5); }
      if (kind === 'snowroad') { g.fillStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 120; i++) g.fillRect(rnd() < 0.5 ? rnd() * 16 : w - rnd() * 16, rnd() * h, 4, 4); }
      if (kind === 'city') { g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(w * 0.25 - 1.5, 0, 3, h * 0.35); g.fillRect(w * 0.75 - 1.5, 0, 3, h * 0.35); }
    }
  }, { clampS: true });
}

function groundTexture(kind) {
  return canvasTex('ground-' + kind, 512, 512, (g, w, h) => {
    if (kind === 'wood') {
      const cols = ['#c98d52', '#be8248', '#d39a5e', '#b87a42', '#c4894f'];
      for (let i = 0; i < 8; i++) {
        g.fillStyle = cols[i % cols.length]; g.fillRect(0, i * 64, w, 64);
        g.strokeStyle = 'rgba(90,50,20,.25)'; g.lineWidth = 1.5;
        for (let k = 0; k < 7; k++) { g.beginPath(); const y = i * 64 + 6 + k * 8 + rnd() * 3; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 4, w * 0.6, y - 4, w, y + 1); g.stroke(); }
        g.fillStyle = 'rgba(60,30,10,.55)'; g.fillRect(0, i * 64, w, 2);
        g.fillRect(((i * 197) % w), i * 64, 2, 64);
      }
    } else if (kind === 'concrete') {
      g.fillStyle = '#2a2b33'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 4000, ['rgba(255,255,255,.05)', 'rgba(0,0,0,.2)'], 2);
      g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, h); g.moveTo(0, i * 128); g.lineTo(w, i * 128); g.stroke(); }
    } else if (kind === 'sand') {
      g.fillStyle = '#e3b57c'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 5000, ['#d9a86c', '#efc690', '#c99458', '#f3d2a3'], 2);
      g.strokeStyle = 'rgba(170,110,60,.18)'; g.lineWidth = 3;
      for (let i = 0; i < 14; i++) { g.beginPath(); const y = i * 38 + rnd() * 10; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 14, w * 0.7, y - 14, w, y); g.stroke(); }
    } else if (kind === 'snow') {
      g.fillStyle = '#f2f7ff'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 3000, ['#dfeaff', '#ffffff', '#cddcf5'], 3);
    } else if (kind === 'turf') {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#3fae4a' : '#48bb52'; g.fillRect(0, i * 64, w, 64); }
      speckle(g, w, h, 3000, ['rgba(0,60,0,.15)', 'rgba(255,255,255,.06)'], 2);
    } else if (kind === 'grass') {
      g.fillStyle = '#4fa83a'; g.fillRect(0, 0, w, h);
      g.lineWidth = 2;
      for (let i = 0; i < 2600; i++) { g.strokeStyle = ['#3f9a2e', '#5cbc45', '#67c94f', '#357f26'][i % 4]; const x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 4, y - 6 - rnd() * 6); g.stroke(); }
    }
  }, { rx: 1, ry: 1 });
}

function skyTexture(top, bottom, stars) {
  return canvasTex('sky' + top + bottom, 4, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, top); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    if (stars) { g.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 30; i++) g.fillRect(rnd() * w, rnd() * h * 0.6, 1, 1); }
  });
}

const chevronTex = (col) => canvasTex('chev' + col, 64, 128, (g, w, h) => {
  g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, w, h);
  g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 12; g.lineCap = 'round';
  for (let k = 0; k < 2; k++) { g.beginPath(); const y = 24 + k * 64; g.moveTo(8, y + 26); g.lineTo(w / 2, y); g.lineTo(w - 8, y + 26); g.stroke(); }
});
const stripeTex = canvasTex('stripes', 64, 64, (g, w, h) => {
  g.fillStyle = '#ffd000'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1a1a1a';
  for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 48, h); g.lineTo(i * 32 + 32, h); g.fill(); }
});
const checkerTex = canvasTex('checker', 64, 16, (g, w, h) => {
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); }
});
const windowTex = canvasTex('windows', 64, 128, (g, w, h) => {
  g.fillStyle = '#1b1c2a'; g.fillRect(0, 0, w, h);
  for (let y = 4; y < h; y += 10) for (let x = 4; x < w; x += 10) {
    const r = rnd();
    g.fillStyle = r < 0.45 ? '#ffd77a' : r < 0.6 ? '#7fd8ff' : r < 0.68 ? '#ff7ad9' : '#262838';
    g.fillRect(x, y, 6, 6);
  }
});
const bannerTex = canvasTex('banner', 512, 96, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#ff2d00'); gr.addColorStop(0.5, '#ff9a00'); gr.addColorStop(1, '#ff2d00');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) { g.fillStyle = (x / 16) % 2 ? '#111' : '#fff'; g.fillRect(x, 0, 16, 10); g.fillStyle = (x / 16) % 2 ? '#fff' : '#111'; g.fillRect(x, h - 10, 16, 10); }
  g.font = '900 52px Bungee, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#120726'; g.strokeText('TOY CARS RACING', w / 2, h / 2 + 2);
  g.fillStyle = '#fff'; g.fillText('TOY CARS RACING', w / 2, h / 2 + 2);
});

// ------------------------------------------------------------------ themes
const THEMES = {
  bedroom: { sky: ['#ffd9a8', '#fff1d8'], fog: ['#ffe8c8', 260, 900], ground: 'wood', groundRep: 26, hemi: ['#fff5e6', '#a0703c', 1.15], sun: ['#fff0d0', 2.2], road: 'plastic', roadCol: '#ff7a1a', rail: { color: '#ff8f2e', h: 0.9, t: 0.35 }, pillar: '#c3cad8', offroad: 'floor' },
  city: { sky: ['#06081f', '#2b1650'], stars: true, fog: ['#191538', 140, 560], ground: 'concrete', groundRep: 40, hemi: ['#8f98f0', '#2a2346', 1.15], sun: ['#b8c6ff', 1.2], road: 'city', rail: { color: '#b6b9c6', h: 1.1, t: 0.6, stripe: '#ff2d95' }, night: true },
  canyon: { sky: ['#4ea6ff', '#ffe2b0'], fog: ['#f7d2a0', 260, 900], ground: 'sand', groundRep: 40, hemi: ['#cfe8ff', '#c08a52', 1.0], sun: ['#fff1d0', 2.4], road: 'desert', embank: '#d9a466' },
  snow: { sky: ['#6aa7ff', '#eaf4ff'], fog: ['#e6f0ff', 200, 760], ground: 'snow', groundRep: 30, hemi: ['#eaf3ff', '#8aa0c0', 1.1], sun: ['#ffffff', 2.0], road: 'snowroad', rail: { color: '#f4f8ff', h: 1.3, t: 1.4 }, embank: '#eef4ff' },
  stadium: { sky: ['#2f7dff', '#c4e9ff'], fog: ['#cfe8ff', 300, 1000], ground: 'turf', groundRep: 30, hemi: ['#ffffff', '#4a8a4a', 1.1], sun: ['#fffaf0', 2.3], road: 'plastic', roadCol: '#ff7a1a', rail: { color: '#1f6bff', h: 0.9, t: 0.35 }, pillar: '#ffd000' },
  backyard: { sky: ['#57b8ff', '#dcf5ff'], fog: ['#d6f0ff', 220, 800], ground: 'grass', groundRep: 34, hemi: ['#f0fff0', '#3f7a2a', 1.1], sun: ['#fff6dc', 2.3], road: 'plastic', roadCol: '#2f9bff', rail: { color: '#ffd000', h: 0.9, t: 0.35 }, pillar: '#ff5d6a' }
};

// ------------------------------------------------------------------ materials
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0, emissive: opts.emissive || '#000', emissiveIntensity: opts.ei ?? 1, flatShading: opts.flat || false, transparent: !!opts.opacity, opacity: opts.opacity ?? 1 });
  matCache.set(key, m);
  return m;
}
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone: new THREE.ConeGeometry(1, 1, 10),
  cone6: new THREE.ConeGeometry(1, 1, 6),
  sph: new THREE.SphereGeometry(1, 16, 12),
  ico: new THREE.IcosahedronGeometry(1, 0),
  dode: new THREE.DodecahedronGeometry(1, 0),
  wheel: new THREE.CylinderGeometry(1, 1, 1, 18).rotateZ(Math.PI / 2),
  torus: new THREE.TorusGeometry(1, 0.12, 8, 20)
};
function part(geo, material, [x, y, z] = [0, 0, 0], [sx, sy, sz] = [1, 1, 1], rot = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  return m;
}

// ------------------------------------------------------------------ car meshes
function makeCarMesh(color, accent, style, { shadows = true, ghost = false } = {}) {
  const root = new THREE.Group();
  const tilt = new THREE.Group(); root.add(tilt);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.35 });
  const acc = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.2 });
  const glass = mat('#162544', { rough: 0.1, metal: 0.6 });
  const chrome = mat('#dfe5ee', { rough: 0.15, metal: 1 });
  const black = mat('#18181d', { rough: 0.85 });
  const head = mat('#ffffff', { emissive: '#fff8d0', ei: 1.5 });
  const tail = new THREE.MeshStandardMaterial({ color: '#ff2030', emissive: '#ff1020', emissiveIntensity: 0.6 });
  const povHide = [];
  const wheels = [];
  const add = (m, hide) => { tilt.add(m); if (hide) povHide.push(m); return m; };
  let eye = [0, 1.4, -0.2], exhaust = [[0.45, 0.62, -2.2], [-0.45, 0.62, -2.2]];
  let wf = { r: 0.5, w: 0.45, x: 1.0, z: 1.35 }, wr = { r: 0.62, w: 0.6, x: 1.0, z: -1.35 };
  if (style === 'racer') {
    add(part(GEO.box, paint, [0, 0.62, 0], [2.0, 0.45, 4.2]));
    add(part(GEO.box, paint, [0, 0.55, 2.05], [1.8, 0.3, 0.9], [-0.18, 0, 0]));
    add(part(GEO.box, glass, [0, 1.07, -0.35], [1.45, 0.5, 1.5]), true);
    add(part(GEO.box, acc, [0, 0.76, 0], [2.04, 0.12, 3.4]));
    add(part(GEO.box, acc, [0, 1.42, -1.9], [2.15, 0.1, 0.62]));
    for (const x of [-0.7, 0.7]) add(part(GEO.box, black, [x, 1.15, -1.9], [0.1, 0.45, 0.2]));
    add(part(GEO.box, chrome, [0, 0.98, 1.0], [0.9, 0.34, 0.9]), true);
    for (const x of [-0.25, 0.25]) add(part(GEO.cyl, chrome, [x, 1.25, 1.0], [0.11, 0.35, 0.11]), true);
  } else if (style === 'muscle') {
    eye = [0, 1.45, -0.35];
    add(part(GEO.box, paint, [0, 0.72, 0], [2.1, 0.62, 4.3]));
    add(part(GEO.box, glass, [0, 1.3, -0.45], [1.75, 0.55, 1.9]), true);
    add(part(GEO.box, paint, [0, 1.6, -0.45], [1.7, 0.06, 1.7]), true);
    add(part(GEO.box, black, [0, 1.12, 1.15], [0.7, 0.24, 0.9]), true);
    for (const x of [-0.28, 0.28]) add(part(GEO.box, acc, [x, 1.04, 0.2], [0.24, 0.03, 4.32]));
    for (const z of [2.18, -2.18]) add(part(GEO.box, chrome, [0, 0.5, z], [2.15, 0.18, 0.14]));
    wf = { r: 0.55, w: 0.5, x: 1.05, z: 1.4 }; wr = { r: 0.66, w: 0.66, x: 1.05, z: -1.4 };
  } else if (style === 'buggy') {
    eye = [0, 1.85, -0.35];
    add(part(GEO.box, paint, [0, 1.0, 0], [1.6, 0.42, 3.0]));
    add(part(GEO.box, paint, [0, 0.95, 1.65], [1.3, 0.3, 0.6], [-0.3, 0, 0]));
    add(part(GEO.box, black, [0, 1.3, -0.4], [0.9, 0.35, 0.8]));
    const cage = mat('#2a2a30', { rough: 0.4, metal: 0.8 });
    for (const x of [-0.7, 0.7]) for (const z of [-0.9, 0.5]) add(part(GEO.cyl8, cage, [x, 1.75, z], [0.06, 1.05, 0.06]));
    for (const z of [-0.9, 0.5]) add(part(GEO.cyl8, cage, [0, 2.27, z], [0.06, 1.4, 0.06], [0, 0, Math.PI / 2]), true);
    add(part(GEO.box, acc, [0, 2.3, -0.2], [1.5, 0.06, 1.55]), true);
    add(part(GEO.box, chrome, [0, 1.35, -1.25], [0.8, 0.45, 0.6]));
    exhaust = [[0.3, 1.5, -1.6], [-0.3, 1.5, -1.6]];
    wf = { r: 0.78, w: 0.6, x: 1.15, z: 1.25 }; wr = { r: 0.82, w: 0.7, x: 1.15, z: -1.2 };
  } else {
    // rocket
    eye = [0, 1.2, -0.3];
    add(part(GEO.box, paint, [0, 0.58, -0.1], [1.9, 0.36, 4.5]));
    add(part(GEO.box, paint, [0, 0.5, 2.3], [1.6, 0.2, 1.0], [-0.12, 0, 0]));
    add(part(GEO.sph, glass, [0, 0.82, -0.2], [0.62, 0.42, 1.15]), true);
    for (const x of [-0.85, 0.85]) add(part(GEO.box, acc, [x, 1.0, -1.9], [0.08, 0.8, 0.8]));
    add(part(GEO.cyl, chrome, [0, 0.62, -2.4], [0.38, 0.4, 0.38], [Math.PI / 2, 0, 0]));
    add(part(GEO.box, acc, [0, 0.78, 0.4], [1.94, 0.08, 2.6]));
    exhaust = [[0, 0.62, -2.6]];
    wf = { r: 0.46, w: 0.4, x: 0.98, z: 1.5 }; wr = { r: 0.56, w: 0.55, x: 1.0, z: -1.45 };
  }
  // lights
  for (const x of [-0.62, 0.62]) {
    add(part(GEO.box, head, [x, 0.66, style === 'buggy' ? 1.95 : 2.12], [0.42, 0.16, 0.06]));
    add(part(GEO.box, tail, [x, 0.7, style === 'buggy' ? -1.52 : -2.12], [0.42, 0.14, 0.06]));
  }
  // wheels
  const tire = black, rim = style === 'buggy' ? acc : chrome;
  const mk = (cfg, front) => {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(cfg.x * s, cfg.r, cfg.z);
      const spin = new THREE.Group(); pivot.add(spin);
      spin.add(part(GEO.wheel, tire, [0, 0, 0], [cfg.w, cfg.r, cfg.r]));
      spin.add(part(GEO.wheel, rim, [s * 0.03, 0, 0], [cfg.w + 0.02, cfg.r * 0.55, cfg.r * 0.55]));
      spin.add(part(GEO.box, tire, [s * 0.04, 0, 0], [cfg.w + 0.04, cfg.r * 0.18, cfg.r * 1.1]));
      tilt.add(pivot);
      wheels.push({ pivot, spin, front });
    }
  };
  mk(wf, true); mk(wr, false);
  // nitro flames
  const flameMat = new THREE.MeshBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = exhaust.map(([x, y, z]) => { const f = part(GEO.cone, flameMat, [x, y, z - 0.6], [0.22, 1.2, 0.22], [-Math.PI / 2, 0, 0]); f.visible = false; tilt.add(f); return f; });
  // driver's steering wheel (visible only in driver POV)
  const sw = part(GEO.torus, mat('#22222a', { rough: 0.5 }), [eye[0], eye[1] - 0.38, eye[2] + 0.62], [0.24, 0.24, 0.24], [-0.5, 0, 0]);
  sw.visible = false; tilt.add(sw);
  const dash = part(GEO.box, mat('#1b1b24'), [0, eye[1] - 0.45, eye[2] + 0.95], [1.5, 0.2, 0.5]);
  dash.visible = false; tilt.add(dash);
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (ghost) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.32; o.material.depthWrite = false; }
    else if (shadows && o !== sw) o.castShadow = true;
  });
  return { root, tilt, wheels, povHide, flames, eye, steerWheel: sw, dash, tail, paint };
}

function makeTrafficMesh(i) {
  const cols = ['#ffd21a', '#f4f4f8', '#5ac8fa', '#ff6b4a', '#7d7f8a', '#3ecf8e', '#b77cff'];
  const g = new THREE.Group();
  const c = cols[i % cols.length];
  const body = mat(c, { rough: 0.4, metal: 0.2 });
  const isVan = i % 4 === 3;
  g.add(part(GEO.box, body, [0, 0.8, 0], [2.1, isVan ? 1.6 : 0.8, isVan ? 4.6 : 4.3]));
  if (!isVan) g.add(part(GEO.box, mat('#1a2236', { rough: 0.15, metal: 0.5 }), [0, 1.45, -0.3], [1.8, 0.6, 2.1]));
  if (i % 7 === 0) g.add(part(GEO.box, mat('#111'), [0, 1.85, -0.3], [0.7, 0.2, 0.3]));
  for (const x of [-0.65, 0.65]) {
    g.add(part(GEO.box, mat('#ffffff', { emissive: '#fff6c0', ei: 2 }), [x, 0.75, 2.17], [0.4, 0.18, 0.05]));
    g.add(part(GEO.box, mat('#ff2030', { emissive: '#ff1020', ei: 1.5 }), [x, 0.8, -2.17], [0.4, 0.16, 0.05]));
  }
  const wheels = [];
  for (const x of [-1, 1]) for (const z of [1.4, -1.4]) { const w = part(GEO.wheel, mat('#18181d'), [x, 0.45, z], [0.4, 0.45, 0.45]); g.add(w); wheels.push(w); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root: g, wheels };
}

// ------------------------------------------------------------------ track scene
let world = null, track = null, trackIndex = 0, mode = 'race', theme = null;
let carViews = [], obsViews = [], boostMats = [], ghostView = null, envLight = null, sunLight = null;
const builtTracks = new Map();
function getTrack(i) { if (!builtTracks.has(i)) builtTracks.set(i, buildTrack(TRACKS[i])); return builtTracks.get(i); }

function disposeScene(s) {
  s.traverse((o) => {
    if (o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose();
  });
}

function stripGeometry(track, path, s0, s1, dOf, wOf, yOf, stepLen = 1) {
  const pos = [], uv = [], idx = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / stepLen));
  for (let k = 0; k <= n; k++) {
    const s = s0 + (s1 - s0) * (k / n);
    const p = pathPoint(path, s);
    const d = dOf(s), hw = wOf(s) / 2, y = yOf(s, p);
    pos.push(p.x + p.rx * (d - hw), y, p.z + p.rz * (d - hw), p.x + p.rx * (d + hw), y, p.z + p.rz * (d + hw));
    uv.push(0, (s - s0) / 8, 1, (s - s0) / 8);
    if (k < n) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function buildPathMeshes(group, T, pi, th) {
  const p = T.paths[pi], isMain = pi === 0;
  const n = p.n, segs = p.closed ? n : n - 1;
  const gapI = (i) => isMain && !!gapAt(T, (i % n) * p.step);
  // ---- surface
  const kind = p.surface === 'dirt' ? 'dirt' : p.surface === 'ice' ? 'ice' : th.road;
  const tex = roadTexture(kind, th.roadCol || '#ff7a1a');
  const pos = [], uv = [], idx = [];
  const vRep = 14;
  for (let i = 0; i <= segs; i++) {
    const k = i % n;
    const hw = p.w[k] / 2, y = p.y[k] + 0.02 + (isMain ? 0 : 0.012);
    const rx = -p.tz[k], rz = p.tx[k];
    pos.push(p.x[k] - rx * hw, y, p.z[k] - rz * hw, p.x[k] + rx * hw, y, p.z[k] + rz * hw);
    const v = (i * p.step) / vRep;
    uv.push(0, v, 1, v);
  }
  for (let i = 0; i < segs; i++) {
    if (gapI(i) || gapI(i + 1)) continue;
    const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const roadMat = new THREE.MeshStandardMaterial({ map: tex, roughness: th.road === 'plastic' ? 0.42 : p.surface === 'ice' ? 0.15 : 0.85, metalness: th.road === 'plastic' ? 0.05 : 0, polygonOffset: true, polygonOffsetFactor: isMain ? -2 : -3, polygonOffsetUnits: isMain ? -4 : -6 });
  const road = new THREE.Mesh(g, roadMat);
  road.receiveShadow = true;
  group.add(road);

  // ---- edges: rails/walls, skirts, embankments
  const rail = th.rail, railMat = rail ? mat(rail.color, { rough: th.road === 'plastic' ? 0.4 : 0.8 }) : null;
  const skirtMat = mat(th.road === 'plastic' ? new THREE.Color(th.roadCol).offsetHSL(0, 0, -0.15).getStyle() : '#555a66', { rough: 0.6 });
  const embMat = th.embank ? mat(th.embank, { rough: 1, flat: true }) : null;
  const walls = p.walls && rail;
  for (const side of [-1, 1]) {
    const wp = [], sp = [], ep = [];
    const ok = [];
    for (let i = 0; i <= segs; i++) {
      const k = i % n;
      const hw = p.w[k] / 2;
      const rx = -p.tz[k] * side, rz = p.tx[k] * side;
      const ex = p.x[k] + rx * hw, ez = p.z[k] + rz * hw;
      ok.push(!gapI(i) && !insideOther(T, ex, ez, p.y[k], pi, 0.4) && !(!p.closed && (i < 3 || i > segs - 3) && false));
    }
    for (let i = 0; i < segs; i++) {
      if (!ok[i] || !ok[i + 1]) continue;
      const quad = (arr, a0, a1, b0, b1) => arr.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      const pt = (k, off, dy) => {
        k %= n; const hw = p.w[k] / 2 + off;
        return [p.x[k] + -p.tz[k] * side * hw, p.y[k] + dy, p.z[k] + p.tx[k] * side * hw];
      };
      const fix = (arr, a0, a1, b0, b1) => (side > 0 ? quad(arr, a0, a1, b0, b1) : quad(arr, b0, b1, a0, a1));
      const y0 = 0.02;
      if (walls) {
        const h = rail.h, t = rail.t;
        fix(wp, pt(i, 0, y0), pt(i, 0, h), pt(i + 1, 0, y0), pt(i + 1, 0, h));
        fix(wp, pt(i, 0, h), pt(i, t, h), pt(i + 1, 0, h), pt(i + 1, t, h));
        fix(wp, pt(i, t, h), pt(i, t, -0.45), pt(i + 1, t, h), pt(i + 1, t, -0.45));
      } else if (!th.embank) {
        fix(sp, pt(i, 0, y0), pt(i, 0, -0.45), pt(i + 1, 0, y0), pt(i + 1, 0, -0.45));
      }
      if (th.embank) {
        const k0 = i % n, k1 = (i + 1) % n;
        const off0 = (walls ? rail.t : 0), w0 = p.y[k0] * 1.6 + 1.2, w1 = p.y[k1] * 1.6 + 1.2;
        const a = pt(i, off0, walls ? -0.3 : y0), b = pt(i + 1, off0, walls ? -0.3 : y0);
        const a2 = pt(i, off0 + w0, -p.y[k0] - 0.05), b2 = pt(i + 1, off0 + w1, -p.y[k1] - 0.05);
        fix(ep, a, a2, b, b2);
      } else if (th.road === 'plastic' || walls) {
        // underside of raised track
        if (p.y[i % n] > 0.6) fix(sp, pt(i, walls ? rail.t : 0, -0.45), pt(i, -p.w[i % n] / 2, -0.45), pt(i + 1, walls ? rail.t : 0, -0.45), pt(i + 1, -p.w[(i + 1) % n] / 2, -0.45));
      }
    }
    const addGeo = (arr, m, shadow) => {
      if (!arr.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, m);
      mesh.receiveShadow = true; mesh.castShadow = !!shadow;
      group.add(mesh);
    };
    addGeo(wp, railMat, true);
    addGeo(sp, skirtMat);
    if (embMat) addGeo(ep, embMat);
  }
  // neon stripe on city barriers
  if (walls && rail.stripe) {
    for (const side of [-1, 1]) {
      const arr = [];
      for (let i = 0; i < segs; i++) {
        const k0 = i % n, k1 = (i + 1) % n;
        const e = (k) => { const hw = p.w[k] / 2 - 0.01; return [p.x[k] - p.tz[k] * side * hw, p.y[k] + rail.h * 0.6, p.z[k] + p.tx[k] * side * hw]; };
        const ex0 = p.x[k0] - p.tz[k0] * side * p.w[k0] / 2, ez0 = p.z[k0] + p.tx[k0] * side * p.w[k0] / 2;
        if (gapI(i) || insideOther(T, ex0, ez0, p.y[k0], pi, 0.4)) continue;
        const a = e(k0), b = e(k1);
        arr.push(...a, a[0], a[1] + 0.18, a[2], ...b, ...b, a[0], a[1] + 0.18, a[2], b[0], b[1] + 0.18, b[2]);
      }
      if (!arr.length) continue;
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: side > 0 ? rail.stripe : '#2de2ff', side: THREE.DoubleSide })));
    }
  }
  // ---- support pillars for raised plastic track
  if (th.road === 'plastic' && th.pillar) {
    const spots = [];
    for (let i = 0; i < n; i += 9) {
      if (p.y[i] < 1.4 || gapI(i)) continue;
      for (const side of [-1, 1]) {
        const off = p.w[i] / 2 * 0.72 * side;
        const x = p.x[i] - p.tz[i] * off, z = p.z[i] + p.tx[i] * off;
        let blocked = false;
        for (const q of T.paths) {
          const c = nearestOnPath(q, x, z, 0.5);
          if (c.y < p.y[i] - 3 && Math.abs(c.d) < c.hw + 1.5) { blocked = true; break; }
        }
        if (!blocked) spots.push([x, z, p.y[i] - 0.45]);
      }
    }
    if (spots.length) {
      const im = new THREE.InstancedMesh(GEO.cyl8, mat(th.pillar, { rough: 0.5 }), spots.length);
      const m4 = new THREE.Matrix4();
      spots.forEach(([x, z, h], i) => { m4.compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(0.45, h, 0.45)); im.setMatrixAt(i, m4); });
      im.castShadow = true;
      group.add(im);
    }
  }
}

// Flat layers stacked on the road (road < pad base < ice/start line < chevrons) are only
// centimetres apart; phones with 16-bit depth can't separate them at overhead-camera
// distances, so each layer also gets a polygon offset that always wins the depth test.
function decal(m, layer) {
  m.polygonOffset = true; m.polygonOffsetFactor = -2 - layer * 2; m.polygonOffsetUnits = -4 - layer * 4; // road = layer 0
  return m;
}
function buildFeatures(group, T, th) {
  const M = T.main;
  boostMats = [];
  for (const f of T.features) {
    const p0 = pathPoint(M, f.s);
    if (f.type === 'boost') {
      const tex = chevronTex('#ffffff').clone(); tex.needsUpdate = true; tex.repeat.set(1, f.len / 8);
      const m = new THREE.MeshBasicMaterial({ map: tex, color: th.night ? '#2de2ff' : '#00c8ff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
      decal(m, 3);
      boostMats.push(tex);
      const g = stripGeometry(T, M, f.s, f.s + f.len, () => f.d || 0, () => f.w || M.w[0] - 2, (s, p) => p.y + 0.06, 1);
      group.add(new THREE.Mesh(g, m));
      const base = new THREE.Mesh(stripGeometry(T, M, f.s - 0.5, f.s + f.len + 0.5, () => f.d || 0, () => (f.w || M.w[0] - 2) + 1, (s, p) => p.y + 0.045, 1), decal(mat('#13204a', { rough: 0.4 }).clone(), 1));
      group.add(base);
    } else if (f.type === 'ice') {
      const m = decal(new THREE.MeshStandardMaterial({ color: '#cdeeff', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.75, depthWrite: false }), 2);
      group.add(new THREE.Mesh(stripGeometry(T, M, f.s, f.s + f.len, () => 0, () => M.w[0] - 0.5, (s, p) => p.y + 0.05, 1), m));
    } else if (f.type === 'kicker' || f.type === 'hump') {
      const w = f.w || M.w[0] - 0.6, d = f.d || 0;
      const top = stripGeometry(T, M, f.s, f.s + f.len, () => d, () => w, (s, p) => p.y + rampHeight(T, s, d) + 0.04, 0.5);
      const tm = decal(f.type === 'kicker' ? new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5 }) : new THREE.MeshStandardMaterial({ map: roadTexture(th.road, th.roadCol || '#ff7a1a'), roughness: 0.6 }), 1);
      const mesh = new THREE.Mesh(top, tm); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
      if (f.type === 'kicker') {
        // sides + back face
        const pts = [];
        const N = Math.ceil(f.len / 0.5);
        for (const side of [-1, 1]) {
          for (let k = 0; k < N; k++) {
            const s0 = f.s + f.len * k / N, s1 = f.s + f.len * (k + 1) / N;
            const a = pathPoint(M, s0), b = pathPoint(M, s1);
            const off = d + side * w / 2;
            const ax = a.x + a.rx * off, az = a.z + a.rz * off, bx = b.x + b.rx * off, bz = b.z + b.rz * off;
            const ah = a.y + rampHeight(T, s0, d) + 0.04, bh = b.y + rampHeight(T, s1, d) + 0.04;
            pts.push(ax, a.y, az, bx, b.y, bz, ax, ah, az, ax, ah, az, bx, b.y, bz, bx, bh, bz);
          }
        }
        const e = pathPoint(M, f.s + f.len - 0.01), eh = e.y + rampHeight(T, f.s + f.len - 0.01, d);
        const l = [e.x + e.rx * (d - w / 2), e.z + e.rz * (d - w / 2)], r = [e.x + e.rx * (d + w / 2), e.z + e.rz * (d + w / 2)];
        pts.push(l[0], e.y, l[1], r[0], e.y, r[1], l[0], eh, l[1], l[0], eh, l[1], r[0], e.y, r[1], r[0], eh, r[1]);
        const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); sg.computeVertexNormals();
        const sm = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: '#3a3a44', side: THREE.DoubleSide, roughness: 0.7 }));
        sm.castShadow = true; group.add(sm);
      }
    } else if (f.type === 'loop') {
      buildLoop(group, T, f, th);
    } else if (f.type === 'gap') {
      const mid = pathPoint(M, f.s + f.len / 2);
      const raised = mid.y > 1.5;
      const color = raised ? (th.ground === 'grass' ? '#3aa0ff' : '#5b6cff') : '#2a1608';
      const g = stripGeometry(T, M, f.s - 3, f.s + f.len + 3, () => 0, () => M.w[0] + 26, () => 0.03, 1);
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: raised ? 0.85 : 0.92 });
      group.add(new THREE.Mesh(g, m));
      if (!raised) {
        const g2 = stripGeometry(T, M, f.s - 1, f.s + f.len + 1, () => 0, () => M.w[0] + 18, () => 0.05, 1);
        group.add(new THREE.Mesh(g2, new THREE.MeshBasicMaterial({ color: '#000000' })));
        // cliff lips
        for (const s of [f.s - 2.5, f.s + f.len + 2.5]) {
          const q = pathPoint(M, s);
          const lip = part(GEO.box, mat(th.embank || '#b07a44', { flat: true }), [q.x, 0.5, q.z], [M.w[0] + 26, 1.2, 1.6]);
          lip.rotation.y = Math.atan2(q.tx, q.tz); group.add(lip);
        }
      }
    } else if (f.type === 'tunnel') {
      buildTunnel(group, T, M, f.s, f.s + f.len, mat('#9fb7cf', { rough: 0.9, flat: true }), mat('#7aa4d6', { rough: 0.3 }));
    }
  }
  T.paths.forEach((p, pi) => { if (pi && p.def.tunnel) buildTunnel(group, T, p, 6, p.len - 6, mat('#ff5fa8', { rough: 0.5 }), mat('#ffd000', { rough: 0.5 })); });
  // start line + gantry
  const p = pathPoint(M, 0);
  const line = new THREE.Mesh(stripGeometry(T, M, -1.2, 1.2, () => 0, () => M.w[0], (s, q) => q.y + 0.05, 2.4), new THREE.MeshBasicMaterial({ map: (() => { const t = checkerTex.clone(); t.needsUpdate = true; t.repeat.set(M.w[0] / 4, 1); t.rotation = Math.PI / 2; return t; })() }));
  decal(line.material, 2);
  group.add(line);
  const hw = M.w[0] / 2 + 1.4;
  const gantry = new THREE.Group();
  const postM = mat('#22222a', { rough: 0.4, metal: 0.6 });
  for (const s of [-1, 1]) gantry.add(part(GEO.box, postM, [s * hw, 4.5, 0], [0.7, 9, 0.7]));
  const ban = part(GEO.box, new THREE.MeshStandardMaterial({ map: bannerTex, emissive: '#ffffff', emissiveMap: bannerTex, emissiveIntensity: th.night ? 0.6 : 0.15 }), [0, 8.6, 0], [hw * 2 + 0.7, 2.2, 0.4]);
  gantry.add(ban);
  const lampM = [0, 1, 2].map(() => new THREE.MeshStandardMaterial({ color: '#ff2020', emissive: '#ff2020', emissiveIntensity: 0.3 }));
  lampM.forEach((m, i) => gantry.add(part(GEO.sph, m, [(i - 1) * 1.6, 7.0, -0.25], [0.5, 0.5, 0.25])));
  gantry.userData.lamps = lampM;
  gantry.position.set(p.x, p.y, p.z); gantry.rotation.y = Math.atan2(p.tx, p.tz);
  gantry.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.add(gantry);
  startLamps = lampM;
}
let startLamps = [], tunnelMeshes = [];

function buildLoop(group, T, f, th) {
  const M = T.main;
  const p = pathPoint(M, f.s);
  const R = f.r, hw = M.w[0] / 2, N = 72;
  const pos = [], uv = [], idx = [], rail = [];
  const t = new THREE.Vector3(p.tx, 0, p.tz), r = new THREE.Vector3(p.rx, 0, p.rz), up = new THREE.Vector3(0, 1, 0);
  const base = new THREE.Vector3(p.x, p.y + 0.06, p.z);
  for (let k = 0; k <= N; k++) {
    const th0 = TAU * k / N;
    const c = base.clone().addScaledVector(t, R * Math.sin(th0)).addScaledVector(up, R * (1 - Math.cos(th0)));
    const inward = up.clone().multiplyScalar(Math.cos(th0)).addScaledVector(t, -Math.sin(th0));
    for (const s of [-1, 1]) { const q = c.clone().addScaledVector(r, s * hw); pos.push(q.x, q.y, q.z); }
    uv.push(0, k / 3, 1, k / 3);
    if (k < N) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    rail.push({ c, inward });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ map: roadTexture('plastic', th.roadCol || '#ff7a1a'), side: THREE.DoubleSide, roughness: 0.45 });
  const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; group.add(mesh);
  // side rails (skip the bottom so cars can drive in and out)
  const rm = mat(th.rail ? th.rail.color : '#1f6bff', { rough: 0.4 });
  const arr = [];
  for (let k = 0; k < N; k++) {
    if (k < 4 || k > N - 4) continue;
    for (const s of [-1, 1]) {
      const a = rail[k], b = rail[k + 1];
      const a0 = a.c.clone().addScaledVector(r, s * hw), b0 = b.c.clone().addScaledVector(r, s * hw);
      const a1 = a0.clone().addScaledVector(a.inward, 1.0), b1 = b0.clone().addScaledVector(b.inward, 1.0);
      arr.push(...a0.toArray(), ...b0.toArray(), ...a1.toArray(), ...a1.toArray(), ...b0.toArray(), ...b1.toArray());
    }
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); rg.computeVertexNormals();
  const rmesh = new THREE.Mesh(rg, rm.clone()); rmesh.material.side = THREE.DoubleSide; group.add(rmesh);
  // stand legs
  for (const s of [-1, 1]) {
    const leg = part(GEO.cyl8, mat(th.pillar || '#c3cad8'), [0, 0, 0], [0.4, R, 0.4]);
    leg.position.copy(base).addScaledVector(r, s * (hw + 0.6)).addScaledVector(up, R / 2);
    group.add(leg);
  }
}

function buildTunnel(group, T, path, s0, s1, wallM, trimM) {
  const N = Math.ceil((s1 - s0) / 2), SEG = 10;
  const pos = [], idx = [];
  for (let k = 0; k <= N; k++) {
    const s = s0 + (s1 - s0) * k / N;
    const p = pathPoint(path, s);
    const R = p.w / 2 + 1.2;
    for (let j = 0; j <= SEG; j++) {
      const a = Math.PI * j / SEG;
      const lat = Math.cos(a) * R, h = Math.sin(a) * R * 0.75 + 0.2;
      pos.push(p.x + p.rx * lat, p.y + h, p.z + p.rz * lat);
    }
    if (k < N) for (let j = 0; j < SEG; j++) { const a = k * (SEG + 1) + j, b = a + SEG + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = wallM.clone(); m.side = THREE.DoubleSide;
  const tm = new THREE.Mesh(g, m); group.add(tm); tunnelMeshes.push(tm);
  for (const s of [s0, s1]) {
    const p = pathPoint(path, s);
    const ring = part(GEO.torus, trimM, [p.x, p.y + 0.2, p.z], [p.w / 2 + 1.4, (p.w / 2 + 1.4) * 0.75, 4]);
    ring.rotation.y = Math.atan2(p.tx, p.tz);
    group.add(ring);
  }
}

// --- props (instanced)
const PROP_PARTS = {
  toyblock: () => [{ geo: GEO.box, m: mat('#ffffff', { rough: 0.5 }), p: [0, 1, 0], s: [2, 2, 2], palette: ['#ff3b30', '#ffcc00', '#34c759', '#007aff', '#ff9500', '#af52de'] }],
  crayon: () => [{ geo: GEO.cyl8, m: mat('#ffffff', { rough: 0.6 }), p: [0, 0.6, 0], s: [0.6, 5, 0.6], rot: [0, 0, Math.PI / 2], palette: ['#ff3b30', '#ffcc00', '#34c759', '#007aff', '#af52de', '#ff2d95'] }, { geo: GEO.cone6, m: mat('#ffffff', { rough: 0.6 }), p: [3.1, 0.6, 0], s: [0.6, 1.3, 0.6], rot: [0, 0, -Math.PI / 2], palette: ['#ff3b30', '#ffcc00', '#34c759', '#007aff', '#af52de', '#ff2d95'] }],
  book: () => [{ geo: GEO.box, m: mat('#ffffff', { rough: 0.7 }), p: [0, 0.5, 0], s: [6, 1, 4.5], palette: ['#c0392b', '#2471a3', '#1e8449', '#7d3c98', '#d68910'] }, { geo: GEO.box, m: mat('#fbf6e8'), p: [0.15, 0.5, 0], s: [5.8, 0.8, 4.3] }],
  marble: () => [{ geo: GEO.sph, m: mat('#ffffff', { rough: 0.05, metal: 0.1 }), p: [0, 0.6, 0], s: [0.6, 0.6, 0.6], palette: ['#2de2ff', '#ff2d95', '#ffd000', '#5dff7a', '#ffffff'] }],
  lamp: () => [{ geo: GEO.cyl8, m: mat('#3a3d48', { metal: 0.6, rough: 0.4 }), p: [0, 4, 0], s: [0.15, 8, 0.15] }, { geo: GEO.box, m: mat('#3a3d48'), p: [0, 8, 1], s: [0.2, 0.2, 2] }, { geo: GEO.box, m: mat('#ffffff', { emissive: '#ffe7a8', ei: 2.5 }), p: [0, 7.85, 1.8], s: [0.6, 0.15, 0.8] }],
  building: () => [{ geo: GEO.box, m: new THREE.MeshStandardMaterial({ map: windowTex, emissive: '#ffffff', emissiveMap: windowTex, emissiveIntensity: 0.9, roughness: 0.8 }), p: [0, 0.5, 0], s: [12, 1, 12], tall: true }, { geo: GEO.box, m: mat('#15161f'), p: [0, 1, 0], s: [12.6, 0.4, 12.6], top: true }],
  hydrant: () => [{ geo: GEO.cyl8, m: mat('#e0262b'), p: [0, 0.45, 0], s: [0.25, 0.9, 0.25] }, { geo: GEO.sph, m: mat('#e0262b'), p: [0, 0.9, 0], s: [0.26, 0.2, 0.26] }],
  cactus: () => [{ geo: GEO.cyl8, m: mat('#3f9a3f', { flat: true }), p: [0, 2.2, 0], s: [0.55, 4.4, 0.55] }, { geo: GEO.cyl8, m: mat('#3f9a3f', { flat: true }), p: [0.9, 2.6, 0], s: [0.35, 1.8, 0.35] }, { geo: GEO.cyl8, m: mat('#3f9a3f', { flat: true }), p: [-0.8, 3.0, 0], s: [0.32, 1.5, 0.32] }],
  mesa: () => [{ geo: GEO.cyl8, m: mat('#c2643a', { flat: true, rough: 1 }), p: [0, 9, 0], s: [14, 18, 14], palette: ['#c2643a', '#b65530', '#d07a48'] }, { geo: GEO.cyl8, m: mat('#e09a62', { flat: true }), p: [0, 18.2, 0], s: [14.3, 0.6, 14.3] }],
  rock: () => [{ geo: GEO.dode, m: mat('#9a8a78', { flat: true, rough: 1 }), p: [0, 0.6, 0], s: [1.5, 1.1, 1.3], palette: ['#9a8a78', '#8a6d55', '#a8937a'] }],
  pine: () => [{ geo: GEO.cyl8, m: mat('#6b4a2e'), p: [0, 0.8, 0], s: [0.35, 1.6, 0.35] }, { geo: GEO.cone, m: mat('#2e6b3e', { flat: true }), p: [0, 3.4, 0], s: [2.2, 4, 2.2] }, { geo: GEO.cone, m: mat('#357a46', { flat: true }), p: [0, 5.4, 0], s: [1.6, 3, 1.6] }, { geo: GEO.cone, m: mat('#f4f8ff', { flat: true }), p: [0, 6.6, 0], s: [0.9, 1.3, 0.9] }],
  snowrock: () => [{ geo: GEO.dode, m: mat('#e9f0fa', { flat: true }), p: [0, 0.7, 0], s: [1.6, 1.2, 1.4] }],
  peak: () => [{ geo: GEO.cone6, m: mat('#8696ae', { flat: true }), p: [0, 18, 0], s: [24, 36, 24] }, { geo: GEO.cone6, m: mat('#ffffff', { flat: true }), p: [0, 29, 0], s: [11.2, 14.5, 11.2] }],
  grass: () => [{ geo: GEO.cone6, m: mat('#4caf3a', { flat: true }), p: [0, 3, 0], s: [0.45, 6, 0.2], palette: ['#4caf3a', '#5cc046', '#3b8f2c', '#6bcf52'] }, { geo: GEO.cone6, m: mat('#4caf3a', { flat: true }), p: [0.4, 2.2, 0.2], s: [0.35, 4.4, 0.18], rot: [0.2, 0, -0.25], palette: ['#4caf3a', '#5cc046', '#3b8f2c'] }],
  flower: () => [{ geo: GEO.cyl8, m: mat('#3f9a2e'), p: [0, 2.5, 0], s: [0.18, 5, 0.18] }, { geo: GEO.cyl, m: mat('#ffffff', { rough: 0.5 }), p: [0, 5.1, 0], s: [1.6, 0.25, 1.6], palette: ['#ff5fa8', '#ffd000', '#ff6b4a', '#b77cff', '#ffffff'] }, { geo: GEO.sph, m: mat('#ffb300'), p: [0, 5.3, 0], s: [0.55, 0.35, 0.55] }],
  mushroom: () => [{ geo: GEO.cyl8, m: mat('#f7efe0'), p: [0, 0.9, 0], s: [0.5, 1.8, 0.5] }, { geo: GEO.sph, m: mat('#e0262b', { rough: 0.4 }), p: [0, 1.8, 0], s: [1.5, 0.9, 1.5], palette: ['#e0262b', '#ff8a00', '#b77cff'] }],
  pebble: () => [{ geo: GEO.dode, m: mat('#9aa0a8', { flat: true }), p: [0, 0.35, 0], s: [0.9, 0.6, 0.8], palette: ['#9aa0a8', '#b8b2a6', '#7d838c'] }],
  cone: () => [{ geo: GEO.cone, m: mat('#ff6a00'), p: [0, 0.5, 0], s: [0.45, 1, 0.45] }, { geo: GEO.box, m: mat('#222'), p: [0, 0.03, 0], s: [1, 0.06, 1] }],
  flag: () => [{ geo: GEO.cyl8, m: mat('#dddddd', { metal: 0.6 }), p: [0, 3, 0], s: [0.08, 6, 0.08] }, { geo: GEO.box, m: mat('#ffffff'), p: [0.8, 5.3, 0], s: [1.6, 1, 0.05], palette: ['#ff3b30', '#ffcc00', '#1f6bff', '#5dff7a', '#ff5fa8'] }]
};

function buildProps(group, T) {
  const byKind = {};
  for (const p of T.props) (byKind[p.kind] ||= []).push(p);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  for (const [kind, list] of Object.entries(byKind)) {
    const parts = PROP_PARTS[kind] ? PROP_PARTS[kind]() : null;
    if (!parts) continue;
    for (const pt of parts) {
      const im = new THREE.InstancedMesh(pt.geo, pt.m, list.length);
      list.forEach((pr, i) => {
        const sc = pr.scale;
        const base = new THREE.Matrix4().compose(new THREE.Vector3(pr.x, propY(T, pr.x, pr.z), pr.z), q.setFromEuler(e.set(0, pr.rot, 0)), new THREE.Vector3(sc, sc, sc));
        let sx = pt.s[0], sy = pt.s[1], sz = pt.s[2], py = pt.p[1];
        if (pt.tall) { const h = 16 + pr.seed * 44; sy = h; py = h / 2; sx = sz = 10 + (pr.seed * 7 % 1) * 6; }
        if (pt.top) { const h = 16 + pr.seed * 44; py = h + 0.2; sx = sz = 10.6 + (pr.seed * 7 % 1) * 6; }
        const local = new THREE.Matrix4().compose(new THREE.Vector3(pt.p[0], py, pt.p[2]), pt.rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...pt.rot)) : new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
        m4.multiplyMatrices(base, local);
        im.setMatrixAt(i, m4);
        if (pt.palette) im.setColorAt(i, col.set(pt.palette[Math.floor(pr.seed * 997) % pt.palette.length]));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.receiveShadow = false;
      im.castShadow = kind === 'toyblock' || kind === 'pine' || kind === 'cactus';
      group.add(im);
    }
  }
}

function propY(T, x, z) {
  if (!T.def.embank) return 0;
  let y = 0;
  for (const p of T.paths) {
    const c = nearestOnPath(p, x, z);
    const ex = Math.abs(c.d) - c.hw;
    if (ex >= 0 && c.y > 0) y = Math.max(y, c.y - ex / 1.6);
  }
  return y;
}

function buildLandmarks(group, T) {
  for (const l of T.def.landmarks || []) {
    const g = new THREE.Group();
    const k = l.kind;
    if (k === 'bed') {
      g.add(part(GEO.box, mat('#8a5a34'), [0, 6, 0], [120, 12, 70]));
      g.add(part(GEO.box, mat('#f4f4ff'), [0, 15, 0], [116, 6, 66]));
      g.add(part(GEO.box, mat('#4f7cff'), [10, 18.5, 0], [96, 2, 68]));
      g.add(part(GEO.box, mat('#ffffff'), [-45, 20, 0], [18, 6, 40]));
      g.add(part(GEO.box, mat('#6b4428'), [-62, 22, 0], [4, 44, 72]));
    } else if (k === 'teddy') {
      const fur = mat('#b5793f', { rough: 1 });
      g.add(part(GEO.sph, fur, [0, 12, 0], [12, 13, 10]));
      g.add(part(GEO.sph, fur, [0, 30, 0], [9, 9, 9]));
      for (const s of [-1, 1]) { g.add(part(GEO.sph, fur, [s * 7, 37, 0], [3, 3, 2])); g.add(part(GEO.sph, fur, [s * 11, 16, 4], [4, 9, 4])); g.add(part(GEO.sph, fur, [s * 7, 3, 6], [5, 4, 7])); g.add(part(GEO.sph, mat('#111'), [s * 3, 32, 8.2], [1, 1, 1])); }
      g.add(part(GEO.sph, mat('#e6c197'), [0, 28, 7.5], [3.5, 3, 2.5]));
      g.add(part(GEO.sph, mat('#ff3b7a'), [0, 21, 6], [4, 2, 2]));
    } else if (k === 'bookbridge') {
      ['#c0392b', '#2471a3', '#1e8449', '#7d3c98'].forEach((c, i) => g.add(part(GEO.box, mat(c), [(i % 2) * 2, 0.75 + i * 1.3, 0], [20 - i * 2, 1.3, 30 - i * 3])));
    } else if (k === 'tower') {
      g.add(part(GEO.box, new THREE.MeshStandardMaterial({ map: windowTex, emissive: '#fff', emissiveMap: windowTex, emissiveIntensity: 1 }), [0, 50, 0], [26, 100, 26]));
      g.add(part(GEO.cyl8, mat('#ccc', { metal: 0.8 }), [0, 112, 0], [0.6, 24, 0.6]));
      g.add(part(GEO.sph, new THREE.MeshBasicMaterial({ color: '#ff2d55' }), [0, 124, 0], [1.2, 1.2, 1.2]));
      g.add(part(GEO.box, new THREE.MeshBasicMaterial({ color: '#ff2d95' }), [0, 100.5, 0], [27, 1, 27]));
    } else if (k === 'billboard') {
      for (const s of [-1, 1]) g.add(part(GEO.box, mat('#333'), [s * 10, 6, 0], [0.8, 12, 0.8]));
      g.add(part(GEO.box, new THREE.MeshStandardMaterial({ map: bannerTex, emissive: '#fff', emissiveMap: bannerTex, emissiveIntensity: 1 }), [0, 14, 0], [30, 7, 0.6]));
    } else if (k === 'arch') {
      const rock = mat('#b9643c', { flat: true, rough: 1 });
      g.add(part(GEO.box, rock, [-13, 7, 0], [6, 14, 8]));
      g.add(part(GEO.box, rock, [13, 7, 0], [6, 14, 8]));
      g.add(part(GEO.box, rock, [0, 16, 0], [34, 5, 9]));
      g.rotation.y = Math.atan2(pathPoint(T.main, nearestOnPath(T.main, l.at[0], l.at[1]).s).tx, pathPoint(T.main, nearestOnPath(T.main, l.at[0], l.at[1]).s).tz) + Math.PI / 2;
    } else if (k === 'gasstation') {
      g.add(part(GEO.box, mat('#f4f4f4'), [0, 6.5, 0], [20, 1, 12]));
      for (const x of [-8, 8]) for (const z of [-4, 4]) g.add(part(GEO.cyl8, mat('#e0262b'), [x, 3, z], [0.4, 6, 0.4]));
      for (const x of [-4, 4]) g.add(part(GEO.box, mat('#e0262b'), [x, 1.2, 0], [1.2, 2.4, 1]));
      g.add(part(GEO.box, mat('#ffd000'), [0, 7.3, 0], [20.2, 0.8, 12.2]));
      g.add(part(GEO.box, mat('#c9b48e'), [0, 3, -14], [16, 6, 8]));
    } else if (k === 'cabin') {
      g.add(part(GEO.box, mat('#7a4a2a', { flat: true }), [0, 3, 0], [12, 6, 9]));
      const roof = part(GEO.cone, mat('#f4f8ff', { flat: true }), [0, 8, 0], [9.5, 4, 7.5]); roof.rotation.y = Math.PI / 4; roof.geometry = new THREE.ConeGeometry(1, 1, 4); g.add(roof);
      g.add(part(GEO.box, mat('#ffd77a', { emissive: '#ffb000', ei: 0.6 }), [0, 3, 4.55], [2, 2, 0.1]));
      g.add(part(GEO.box, mat('#555'), [3.5, 9, 0], [1.2, 4, 1.2]));
    } else if (k === 'lake') {
      const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: '#a8dcff', roughness: 0.05, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
      lake.rotation.x = -Math.PI / 2; lake.scale.set(22, 60, 1); lake.position.y = 0.008; // under the ice road that crosses it g.add(lake);
    } else if (k === 'stands') {
      for (let i = 0; i < 5; i++) g.add(part(GEO.box, mat(i % 2 ? '#2d1d78' : '#3b2a8c'), [0, 1.5 + i * 3, -i * 4], [160, 3, 4]));
      const crowd = new THREE.InstancedMesh(GEO.box, mat('#ffffff'), 300);
      const m4 = new THREE.Matrix4(), c = new THREE.Color(), r = mulberry32(7);
      for (let i = 0; i < 300; i++) {
        const row = i % 5, x = (r() - 0.5) * 150;
        m4.makeTranslation(x, 4 + row * 3, -row * 4); crowd.setMatrixAt(i, m4);
        crowd.setColorAt(i, c.set(['#ff3b30', '#ffcc00', '#34c759', '#007aff', '#ff9500', '#af52de', '#ffffff'][i % 7]));
      }
      crowd.scale.set(1, 1, 1); g.add(crowd);
      g.add(part(GEO.box, mat('#ffffff', { emissive: '#ffffff', ei: 0.3 }), [0, 22, -20], [60, 8, 1]));
    } else if (k === 'trophy') {
      const gold = mat('#ffcc33', { metal: 1, rough: 0.2 });
      g.add(part(GEO.cyl, mat('#2d1d78'), [0, 2, 0], [5, 4, 5]));
      g.add(part(GEO.cyl, gold, [0, 6, 0], [1, 5, 1]));
      g.add(part(GEO.cyl, gold, [0, 13, 0], [5, 8, 3.5]).translateY(0));
      for (const s of [-1, 1]) g.add(part(GEO.torus, gold, [s * 5.5, 13, 0], [2.5, 2.5, 2.5], [0, Math.PI / 2, 0]));
    } else if (k === 'hose') {
      const curve = new THREE.CatmullRomCurve3([[-60, 0, 30], [-30, 0, -10], [0, 0, 20], [30, 0, -20], [60, 0, 10]].map((p) => new THREE.Vector3(...p)));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 1.4, 8), mat('#2fbf4a', { rough: 0.4 })));
      g.add(part(GEO.cyl, mat('#ffd000'), [62, 1.4, 10], [2, 4, 2], [0, 0, Math.PI / 2]));
    } else if (k === 'gnome') {
      g.add(part(GEO.cyl, mat('#2f6bff'), [0, 5, 0], [4, 10, 4]));
      g.add(part(GEO.sph, mat('#f2c9a0'), [0, 12, 0], [3.4, 3.4, 3.4]));
      g.add(part(GEO.cone, mat('#e0262b'), [0, 19, 0], [3.8, 10, 3.8]));
      g.add(part(GEO.cone, mat('#ffffff'), [0, 8.5, 2.4], [3, 6, 1.5], [Math.PI, 0, 0]));
    } else if (k === 'flowerpot') {
      g.add(part(GEO.cyl, mat('#c8643c'), [0, 7, 0], [12, 14, 12]));
      g.add(part(GEO.cyl, mat('#5a3a22'), [0, 14.1, 0], [11, 0.3, 11]));
      for (let i = 0; i < 5; i++) { const a = i * 1.3; g.add(part(GEO.cyl8, mat('#3f9a2e'), [Math.cos(a) * 5, 22, Math.sin(a) * 5], [0.4, 16, 0.4])); g.add(part(GEO.cyl, mat(['#ff5fa8', '#ffd000', '#ff6b4a', '#b77cff', '#ffffff'][i]), [Math.cos(a) * 5, 30, Math.sin(a) * 5], [3.5, 0.6, 3.5])); }
    }
    g.position.set(l.at[0], 0, l.at[1]);
    if (k !== 'arch') g.rotation.y = l.rot || 0;
    g.scale.setScalar(l.scale || 1);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = k !== 'lake'; o.receiveShadow = true; } });
    group.add(g);
  }
}

function makeObstacleView(o) {
  let g;
  if (o.type === 'traffic') { const t = makeTrafficMesh(o.color); return { o, root: t.root, wheels: t.wheels }; }
  const k = o.kind;
  g = new THREE.Group();
  if (k === 'cone') { g.add(part(GEO.cone, mat('#ff6a00'), [0, 0.6, 0], [0.5, 1.2, 0.5])); g.add(part(GEO.cyl, mat('#ffffff'), [0, 0.6, 0], [0.33, 0.18, 0.33])); g.add(part(GEO.box, mat('#222'), [0, 0.04, 0], [1, 0.08, 1])); }
  else if (k === 'barrel') { g.add(part(GEO.cyl, mat('#ff4d1a'), [0, 0.65, 0], [0.75, 1.3, 0.75])); for (const y of [0.35, 0.95]) g.add(part(GEO.cyl, mat('#ffffff'), [0, y, 0], [0.77, 0.16, 0.77])); }
  else if (k === 'crate') { g.add(part(GEO.box, mat('#b0773f', { rough: 0.9 }), [0, 0.9, 0], [1.8, 1.8, 1.8])); g.add(part(GEO.box, mat('#8a5a2c'), [0, 0.9, 0], [1.85, 0.3, 1.85])); }
  else if (k === 'block') { g.add(part(GEO.box, mat(['#ff3b30', '#ffcc00', '#34c759', '#007aff'][Math.floor(o.s) % 4], { rough: 0.5 }), [0, o.r, 0], [o.r * 1.7, o.r * 2, o.r * 1.7])); }
  else if (k === 'barrier') { g.add(part(GEO.box, mat('#ffffff'), [0, 0.6, 0], [2.4, 1.2, 0.8])); g.add(part(GEO.box, mat('#ff2d00'), [0, 0.6, 0], [2.42, 0.35, 0.82])); }
  else if (k === 'rock' || k === 'pebble') g.add(part(GEO.dode, mat(k === 'rock' ? '#8a6d55' : '#9aa0a8', { flat: true }), [0, o.r * 0.6, 0], [o.r, o.r * 0.8, o.r]));
  else if (k === 'snowman') { g.add(part(GEO.sph, mat('#ffffff'), [0, 1.2, 0], [1.4, 1.3, 1.4])); g.add(part(GEO.sph, mat('#ffffff'), [0, 3.0, 0], [1.0, 1.0, 1.0])); g.add(part(GEO.sph, mat('#ffffff'), [0, 4.3, 0], [0.7, 0.7, 0.7])); g.add(part(GEO.cone, mat('#ff8a00'), [0, 4.3, 0.75], [0.15, 0.6, 0.15], [Math.PI / 2, 0, 0])); g.add(part(GEO.cyl, mat('#111'), [0, 5.1, 0], [0.55, 0.8, 0.55])); }
  else if (o.moving) {
    const r = o.r;
    if (k === 'tumbleweed') { const m = new THREE.MeshStandardMaterial({ color: '#a37a45', wireframe: true }); g.add(part(new THREE.IcosahedronGeometry(1, 1), m, [0, r, 0], [r, r, r])); g.add(part(GEO.ico, mat('#7d5a30', { flat: true }), [0, r, 0], [r * 0.6, r * 0.6, r * 0.6])); }
    else if (k === 'snowball') g.add(part(GEO.ico.clone(), mat('#f4f8ff', { flat: true }), [0, r, 0], [r, r, r]));
    else if (k === 'ladybug') { g.add(part(GEO.sph, mat('#e0262b', { rough: 0.3 }), [0, r * 0.5, 0], [r, r * 0.7, r * 1.2])); g.add(part(GEO.sph, mat('#111'), [0, r * 0.4, r * 1.05], [r * 0.5, r * 0.45, r * 0.4])); for (let i = 0; i < 6; i++) g.add(part(GEO.sph, mat('#111'), [(i % 2 ? 1 : -1) * r * 0.45, r * 0.95, (Math.floor(i / 2) - 1) * r * 0.55], [r * 0.18, r * 0.1, r * 0.18])); }
    else { // beach ball
      const ball = new THREE.Group(); ball.position.y = r;
      ['#ff3b30', '#ffffff', '#ffcc00', '#ffffff', '#1f6bff', '#ffffff'].forEach((c, i) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10, i * Math.PI / 3, Math.PI / 3), mat(c, { rough: 0.35 })); ball.add(s); });
      g.add(ball);
    }
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { o, root: g };
}

function buildTrackScene(T) {
  disposeScene(scene);
  scene = new THREE.Scene();
  theme = THEMES[T.def.theme];
  const th = theme;
  scene.background = skyTexture(th.sky[0], th.sky[1], th.stars);
  scene.fog = new THREE.Fog(th.fog[0], th.fog[1], th.fog[2]);
  envLight = new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]);
  scene.add(envLight);
  sunLight = new THREE.DirectionalLight(th.sun[0], th.sun[1]);
  sunLight.position.set(60, 110, 40);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  const sc = sunLight.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 300;
  sunLight.shadow.bias = -0.0006;
  scene.add(sunLight); scene.add(sunLight.target);
  // ground
  const gt = groundTexture(th.ground).clone(); gt.needsUpdate = true; gt.repeat.set(th.groundRep * 2, th.groundRep * 2);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: gt, roughness: th.ground === 'snow' ? 0.9 : 0.85 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  ground.position.y = -0.05; // keep clear of the road (y≈0.02) so low-precision depth buffers never let it poke through
  scene.add(ground);
  if (th.ground === 'wood') {
    // a big rug under the track and room walls
    const rugM = mat('#5b7cff', { rough: 1 }).clone(); rugM.polygonOffset = true; rugM.polygonOffsetFactor = -1; rugM.polygonOffsetUnits = -1;
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 48), rugM);
    rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.006, -90); rug.scale.set(250, 170, 1); rug.receiveShadow = true; scene.add(rug);
    const rug2M = mat('#ffd000', { rough: 1 }).clone(); rug2M.polygonOffset = true; rug2M.polygonOffsetFactor = -1.5; rug2M.polygonOffsetUnits = -2;
    const rug2 = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.96, 48), rug2M);
    rug2.rotation.x = -Math.PI / 2; rug2.position.set(0, 0.01, -90); rug2.scale.set(250, 170, 1); scene.add(rug2);
    const wallM = mat('#9fd3ff', { rough: 1 });
    for (const [x, z, ry] of [[0, -420, 0], [420, -90, -Math.PI / 2], [-420, -90, Math.PI / 2], [0, 260, Math.PI]]) {
      const w = part(GEO.box, wallM, [x, 90, z], [900, 180, 4]); w.rotation.y = ry; scene.add(w);
      const sk = part(GEO.box, mat('#ffffff'), [x, 4, z], [900, 8, 6]); sk.rotation.y = ry; scene.add(sk);
    }
    const win = part(GEO.box, new THREE.MeshBasicMaterial({ color: '#fff7d6' }), [140, 110, -417], [120, 80, 1]); scene.add(win);
  }
  if (th.night) {
    // moon
    scene.add(part(GEO.sph, new THREE.MeshBasicMaterial({ color: '#fff4d8', fog: false }), [-500, 380, -900], [40, 40, 40]));
  }
  tunnelMeshes = [];
  const group = new THREE.Group();
  T.paths.forEach((_, pi) => buildPathMeshes(group, T, pi, th));
  buildFeatures(group, T, th);
  buildProps(group, T);
  buildLandmarks(group, T);
  scene.add(group);
  obsViews = world.obstacles.map((o) => { const v = makeObstacleView(o); scene.add(v.root); return v; });
  initParticles();
}

// ------------------------------------------------------------------ particles
let smoke = null, sparks = null;
function makePoints(count, size, color, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3).fill(-9999), cols = new Float32Array(count * 3).fill(1);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: additive ? 1 : 0.55, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, map: dotTex, alphaTest: 0.01 });
  const pts = new THREE.Points(geo, m); pts.frustumCulled = false;
  scene.add(pts);
  return { pts, pos, cols, n: count, life: new Float32Array(count), vel: new Float32Array(count * 3), i: 0, color: new THREE.Color(color) };
}
const dotTex = canvasTex('dot', 64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
function initParticles() { smoke = makePoints(240, 2.4, '#ffffff', false); sparks = makePoints(160, 0.6, '#ffb000', true); }
function emit(sys, x, y, z, vx, vy, vz, life, color) {
  const i = sys.i; sys.i = (sys.i + 1) % sys.n;
  sys.pos[i * 3] = x; sys.pos[i * 3 + 1] = y; sys.pos[i * 3 + 2] = z;
  sys.vel[i * 3] = vx; sys.vel[i * 3 + 1] = vy; sys.vel[i * 3 + 2] = vz;
  sys.life[i] = life;
  const c = color || sys.color; sys.cols[i * 3] = c.r; sys.cols[i * 3 + 1] = c.g; sys.cols[i * 3 + 2] = c.b;
}
function stepParticles(sys, dt, grav) {
  if (!sys) return;
  for (let i = 0; i < sys.n; i++) {
    if (sys.life[i] <= 0) continue;
    sys.life[i] -= dt;
    if (sys.life[i] <= 0) { sys.pos[i * 3 + 1] = -9999; continue; }
    sys.vel[i * 3 + 1] -= grav * dt;
    sys.pos[i * 3] += sys.vel[i * 3] * dt; sys.pos[i * 3 + 1] += sys.vel[i * 3 + 1] * dt; sys.pos[i * 3 + 2] += sys.vel[i * 3 + 2] * dt;
  }
  sys.pts.geometry.attributes.position.needsUpdate = true;
  sys.pts.geometry.attributes.color.needsUpdate = true;
}
const SMOKE_COLORS = { floor: new THREE.Color('#e8d2b0'), sand: new THREE.Color('#e3b57c'), snow: new THREE.Color('#ffffff'), grass: new THREE.Color('#8fcf6a'), dirt: new THREE.Color('#b0814e') };

// ------------------------------------------------------------------ garage scene
const garageScene = new THREE.Scene();
const garageCam = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
let garageCar = null;
{
  garageScene.background = skyTexture('#1a0b4a', '#4a1a6a');
  garageScene.add(new THREE.HemisphereLight('#c8c0ff', '#2a1050', 1.2));
  const key = new THREE.DirectionalLight('#fff0dd', 2.6); key.position.set(6, 10, 8); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  garageScene.add(key);
  const rim = new THREE.DirectionalLight('#5be1ff', 1.6); rim.position.set(-8, 4, -6); garageScene.add(rim);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.8, 0.5, 48), mat('#ff6a00', { rough: 0.4 }));
  disc.position.y = -0.25; disc.receiveShadow = true; garageScene.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.12, 8, 64), new THREE.MeshBasicMaterial({ color: '#ffd000' }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; garageScene.add(ring);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), mat('#22104e', { rough: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.5; floor.receiveShadow = true; garageScene.add(floor);
  garageCam.position.set(7.5, 3.6, 7.5); garageCam.lookAt(0, 0.8, 0);
}
function carPaint(i) { return save.paint[CARS[i].id] || CARS[i].color; }
function refreshGarageCar() {
  if (garageCar) garageScene.remove(garageCar.root);
  const c = CARS[garageIndex];
  garageCar = makeCarMesh(carPaint(garageIndex), c.accent, c.style);
  garageScene.add(garageCar.root);
}

// ------------------------------------------------------------------ UI state
let state = 'menu', screen = 'title', camMode = save.settings.cam, garageIndex = save.car;
const screens = ['title', 'tracks', 'garage', 'settings', 'pause', 'results'];
function show(id) {
  screen = id;
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
  if (id === 'garage') { refreshGarageCar(); renderGarage(); }
}
const back = { tracks: 'title', garage: 'title', settings: 'title' };
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { audio.click(); show(back[screen] || 'title'); }));

$('mRace').onclick = () => { audio.unlock(); audio.click(); mode = 'race'; openTracks(); };
$('mTrial').onclick = () => { audio.unlock(); audio.click(); mode = 'trial'; openTracks(); };
$('mGarage').onclick = () => { audio.unlock(); audio.click(); garageIndex = save.car; show('garage'); };
$('mSettings').onclick = () => { audio.unlock(); audio.click(); renderSettings(); show('settings'); };

function openTracks() {
  $('tracksTitle').textContent = mode === 'race' ? 'Race · Pick a Track' : 'Time Trial · Pick a Track';
  $('diffSeg').classList.toggle('hidden', mode !== 'race');
  renderDiff();
  renderTrackGrid();
  show('tracks');
}
function renderDiff() { $('diffSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.diff === save.diff)); }
$('diffSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { save.diff = b.dataset.diff; persist(); renderDiff(); renderTrackGrid(); audio.click(); }));

const THEME_ART = { bedroom: ['#ffcf8a', '#ff7a1a', '🧸'], city: ['#2b1650', '#ff2d95', '🌃'], canyon: ['#ffb36b', '#c2643a', '🏜️'], snow: ['#cfe6ff', '#6aa7ff', '🏔️'], stadium: ['#2f7dff', '#ffd000', '🏟️'], backyard: ['#7fd36a', '#2f9bff', '🌻'] };
function renderTrackGrid() {
  const grid = $('trackGrid'); grid.innerHTML = '';
  TRACKS.forEach((def, i) => {
    const r = rec(def.id);
    const [c1, c2, emo] = THEME_ART[def.theme];
    const b = document.createElement('button');
    b.className = 'tcard';
    const place = r.place[save.diff];
    const medal = place ? (place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : `#${place}`) : '';
    b.innerHTML = `<div class="art" style="background:linear-gradient(135deg,${c1},${c2})"><canvas width="260" height="96"></canvas><span class="num">${i + 1}</span></div>
      <div class="body"><h3>${emo} ${def.name}</h3><p>${def.blurb}</p>
      <div class="tags">${def.tags.map((t) => `<span>${t}</span>`).join('')}<span>${'★'.repeat(def.difficulty)}${'☆'.repeat(3 - def.difficulty)}</span></div>
      <div class="rec"><span>Best lap: ${formatTime(r.bestLap)}</span><span>${mode === 'race' ? (medal ? `${medal} ${save.diff}` : '') : (r.ghost ? '👻 ghost saved' : '')}</span></div></div>`;
    b.onclick = () => { audio.click(); startRace(i); };
    grid.appendChild(b);
    drawTrackArt(b.querySelector('canvas'), getTrack(i));
  });
}
function drawTrackArt(cv, T) {
  const g = cv.getContext('2d');
  const M = T.main;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of T.paths) for (let i = 0; i < p.n; i++) { x0 = Math.min(x0, p.x[i]); x1 = Math.max(x1, p.x[i]); z0 = Math.min(z0, p.z[i]); z1 = Math.max(z1, p.z[i]); }
  const s = Math.min((cv.width - 30) / (x1 - x0), (cv.height - 20) / (z1 - z0));
  const ox = cv.width / 2 - (x0 + x1) / 2 * s, oz = cv.height / 2 - (z0 + z1) / 2 * s;
  const line = (p, w, c) => { g.beginPath(); for (let i = 0; i < p.n; i++) g[i ? 'lineTo' : 'moveTo'](ox + p.x[i] * s, oz + p.z[i] * s); if (p.closed) g.closePath(); g.lineWidth = w; g.strokeStyle = c; g.lineJoin = 'round'; g.stroke(); };
  for (const p of T.paths.slice(1)) { line(p, 7, 'rgba(18,7,38,.8)'); line(p, 3, '#5dff7a'); }
  line(M, 9, 'rgba(18,7,38,.85)'); line(M, 4.5, '#ffffff');
  const p0 = pathPoint(M, 0); g.fillStyle = '#ffd000'; g.beginPath(); g.arc(ox + p0.x * s, oz + p0.z * s, 5, 0, TAU); g.fill();
}

// --- garage
function renderGarage() {
  const c = CARS[garageIndex];
  $('carName').textContent = c.name + (garageIndex === save.car ? ' ✔' : '');
  const stat = (label, v) => `<span>${label}</span><i><b style="width:${Math.round(clamp(v, 0.05, 1) * 100)}%"></b></i>`;
  $('carStats').innerHTML = stat('SPEED', (c.top - 38) / 17) + stat('ACCEL', (c.accel - 18) / 12) + stat('GRIP', (c.grip - 6) / 5) + stat('TURN', (c.turn - 1.7) / 1.0) + stat('OFF-ROAD', (c.offroad - 0.4) / 0.45) + stat('NITRO', (c.nitroPower - 0.8) / 0.55);
  const pc = $('carPaint'); pc.innerHTML = '';
  const cur = carPaint(garageIndex);
  PAINTS.forEach((p) => {
    const b = document.createElement('button'); b.style.background = p; b.className = p === cur ? 'on' : '';
    b.setAttribute('aria-label', 'Paint ' + p);
    b.onclick = () => { save.paint[c.id] = p; persist(); refreshGarageCar(); renderGarage(); audio.click(); };
    pc.appendChild(b);
  });
}
$('carPrev').onclick = () => { garageIndex = (garageIndex + CARS.length - 1) % CARS.length; refreshGarageCar(); renderGarage(); audio.click(); };
$('carNext').onclick = () => { garageIndex = (garageIndex + 1) % CARS.length; refreshGarageCar(); renderGarage(); audio.click(); };
$('carSelect').onclick = () => { save.car = garageIndex; persist(); $('mCarName').textContent = CARS[save.car].name; audio.lap(); show('title'); };
$('mCarName').textContent = CARS[save.car].name;

// --- settings
function renderSettings() {
  const S = save.settings;
  $('setSound').textContent = S.sound ? 'On' : 'Off';
  $('setTouch').textContent = { auto: 'Auto', on: 'Always', off: 'Hidden' }[S.touch];
  $('setAutoGas').textContent = S.autoGas ? 'On' : 'Off';
  $('setCam').textContent = CAM_LABEL[S.cam];
  $('setGhost').textContent = S.ghost ? 'On' : 'Off';
  $('setQuality').textContent = S.quality === 'high' ? 'High' : 'Fast';
}
$('setSound').onclick = () => { save.settings.sound = !save.settings.sound; audio.setEnabled(save.settings.sound); persist(); renderSettings(); audio.click(); };
$('setTouch').onclick = () => { const o = ['auto', 'on', 'off']; save.settings.touch = o[(o.indexOf(save.settings.touch) + 1) % 3]; persist(); renderSettings(); applyTouchVisibility(); };
$('setAutoGas').onclick = () => { save.settings.autoGas = !save.settings.autoGas; persist(); renderSettings(); };
$('setCam').onclick = () => { save.settings.cam = CAMS[(CAMS.indexOf(save.settings.cam) + 1) % CAMS.length]; camMode = save.settings.cam; persist(); renderSettings(); };
$('setGhost').onclick = () => { save.settings.ghost = !save.settings.ghost; persist(); renderSettings(); };
$('setQuality').onclick = () => { save.settings.quality = save.settings.quality === 'high' ? 'fast' : 'high'; persist(); applyQuality(); resize(); renderSettings(); };
$('resetRecords').onclick = () => { if (confirm('Erase all best laps, ghosts and trophies?')) { save.records = {}; persist(); audio.click(); } };

// ------------------------------------------------------------------ race flow
let player = null, ghostRec = [], ghostPlay = null, ghostT = 0, lastGhostSample = 0, finishTimer = 0, msgTimer = 0, subTimer = 0;
let lastPlace = 0, lastLapShown = 0, bestLapThisRace = null, newPB = false, raceSeed = 1;

function startRace(i) {
  trackIndex = i;
  track = getTrack(i);
  const spec = { ...CARS[save.car] };
  const rng = mulberry32(Date.now() & 0xffff);
  raceSeed = Math.floor(rng() * 1e6);
  const opponents = mode === 'race' ? [0, 1, 2, 3, 4].map((k) => {
    const s = CARS[(k + 1 + Math.floor(rng() * 4)) % CARS.length];
    return { spec: s, name: AI_NAMES[(k + raceSeed) % AI_NAMES.length], color: AI_COLORS[(k + raceSeed) % AI_COLORS.length] };
  }) : [];
  world = setupRace(track, { playerSpec: spec, opponents, mode, difficulty: save.diff, seed: raceSeed });
  player = world.player;
  buildTrackScene(track);
  carViews = world.cars.map((c) => {
    const isP = c === player;
    const v = makeCarMesh(isP ? carPaint(save.car) : c.color, c.spec.accent, c.spec.style);
    scene.add(v.root);
    return { car: c, v, smokeT: 0 };
  });
  // ghost
  ghostView = null; ghostPlay = null;
  const r = rec(track.def.id);
  if (mode === 'trial' && save.settings.ghost && r.ghost && r.ghost.length > 8) {
    ghostPlay = r.ghost;
    ghostView = makeCarMesh('#9fe8ff', '#ffffff', CARS[save.car].style, { ghost: true, shadows: false });
    scene.add(ghostView.root);
  }
  ghostRec = []; ghostT = 0; lastGhostSample = -1;
  finishTimer = 0; lastPlace = 0; lastLapShown = 0; bestLapThisRace = null; newPB = false;
  camState.init = false;
  for (const m of startLamps) { m.color.set('#ff2020'); m.emissive.set('#ff2020'); m.emissiveIntensity = 0.3; }
  state = 'race';
  show('none');
  $('hud').classList.remove('hidden');
  $('posPill').classList.toggle('hidden', mode !== 'race');
  $('hudPosOf').textContent = '/' + world.cars.length;
  $('hudBest').textContent = formatTime(r.bestLap);
  $('hudDelta').textContent = '';
  applyTouchVisibility();
  drawMinimapBase();
  showCamName();
  flash('READY', 1.2);
  resize();
}

function flash(text, t = 1.2, cls = '') {
  const m = $('msg'); m.textContent = text; m.className = 'msg on ' + cls; msgTimer = t;
}
function subFlash(text, t = 1.6) { const s = $('sub'); s.textContent = text; s.classList.add('on'); subTimer = t; }
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

function handleEvents() {
  for (const e of world.events) {
    const mine = e.car === player;
    switch (e.type) {
      case 'count': flash(String(e.n), 0.9); audio.beep(false); if (startLamps[3 - e.n]) startLamps[3 - e.n].emissiveIntensity = 3.5; break;
      case 'go': flash('GO!', 1.0, 'go'); audio.beep(true); startLamps.forEach((m) => { m.color.set('#20ff40'); m.emissive.set('#20ff40'); m.emissiveIntensity = 3.5; }); break;
      case 'lap':
        if (!mine) break;
        if (!bestLapThisRace || e.time < bestLapThisRace) bestLapThisRace = e.time;
        onPlayerLap(e);
        break;
      case 'finish': if (mine) onPlayerFinish(e); break;
      case 'boost': if (mine) { audio.boost(); subFlash('BOOST!', 0.8); } break;
      case 'loop': if (mine) { audio.whoosh(); subFlash('LOOP THE LOOP!', 1.4); } break;
      case 'bigair': if (mine) subFlash(e.t > 1.1 ? 'MEGA AIR! +NITRO' : 'BIG AIR! +NITRO', 1.2); break;
      case 'land': if (mine) audio.land(); break;
      case 'shortcut': if (mine) subFlash('SHORTCUT: ' + e.name.toUpperCase(), 1.6); break;
      case 'wall': case 'hit': case 'bump':
        if (mine) { audio.hit(e.v); shake = Math.min(1, shake + (e.v || 8) / 25); }
        if (e.car) for (let k = 0; k < 8; k++) emit(sparks, e.car.x, e.car.y + 0.6, e.car.z, (Math.random() - 0.5) * 10, Math.random() * 6, (Math.random() - 0.5) * 10, 0.4 + Math.random() * 0.3);
        break;
      case 'knock': if (mine) audio.knock(); break;
      case 'respawn': if (mine) { subFlash(e.why === 'fall' ? 'SPLASH! BACK ON TRACK' : 'BACK ON TRACK', 1.4); camState.init = false; } break;
    }
  }
  world.events.length = 0;
}

function onPlayerLap(e) {
  const r = rec(track.def.id);
  audio.lap();
  let pb = false;
  if (r.bestLap == null || e.time < r.bestLap) {
    if (r.bestLap != null) pb = true;
    r.bestLap = e.time; newPB = true;
    if (mode === 'trial' && ghostRec.length > 8) r.ghost = ghostRec.map((v) => Math.round(v * 100) / 100);
    persist();
    $('hudBest').textContent = formatTime(r.bestLap);
  }
  // ghost: start a fresh recording, replay the best ghost again
  const prevGhost = mode === 'trial' && save.settings.ghost ? r.ghost : null;
  if (prevGhost) { ghostPlay = prevGhost; if (!ghostView) { ghostView = makeCarMesh('#9fe8ff', '#ffffff', CARS[save.car].style, { ghost: true, shadows: false }); scene.add(ghostView.root); } }
  ghostRec = []; lastGhostSample = -1;
  const d = $('hudDelta');
  if (pb) { d.textContent = 'NEW BEST!'; d.className = 'sub delta good'; audio.best(); }
  else if (r.bestLap != null) { const diff = e.time - r.bestLap; d.textContent = (diff <= 0 ? '−' : '+') + Math.abs(diff).toFixed(2); d.className = 'sub delta ' + (diff <= 0 ? 'good' : 'bad'); }
  if (e.lap < world.laps) {
    flash(e.lap === world.laps - 1 ? 'FINAL LAP!' : `LAP ${e.lap + 1}`, 1.3);
    subFlash((pb ? 'NEW BEST LAP ' : 'Lap ') + formatTime(e.time), 1.8);
  }
}

function onPlayerFinish(e) {
  const r = rec(track.def.id);
  const place = mode === 'race' ? e.place : 1;
  flash(mode === 'race' ? (place === 1 ? 'YOU WIN!' : `${ord(place).toUpperCase()}!`) : 'FINISH!', 2.5, place <= 3 ? 'go' : '');
  audio.finish(place <= 3);
  if (r.bestTotal == null || e.time < r.bestTotal) r.bestTotal = e.time;
  if (mode === 'race' && (!r.place[save.diff] || place < r.place[save.diff])) r.place[save.diff] = place;
  persist();
  finishTimer = 4;
}

function showResults() {
  state = 'results';
  const T = track;
  const P = player;
  const rows = [];
  if (mode === 'race') {
    const avg = (c) => (c.dist > 0 && world.raceT > 0 ? c.dist / world.raceT : 30);
    const total = world.laps * T.L;
    const list = world.cars.map((c) => ({ c, t: c.finished ? c.finishT : world.raceT + Math.max(0, total - c.dist) / Math.max(10, avg(c)) }));
    list.sort((a, b) => a.t - b.t);
    const place = list.findIndex((x) => x.c === P) + 1;
    $('resBadge').textContent = place === 1 ? '🏆' : place === 2 ? '🥈' : place === 3 ? '🥉' : '🏁';
    $('resTitle').textContent = place === 1 ? '1st Place!' : `${ord(place)} Place`;
    $('resSub').textContent = `${T.def.name} · ${save.diff} · best lap ${formatTime(bestLapThisRace)}${newPB ? ' · NEW RECORD!' : ''}`;
    list.forEach((x, i) => {
      const best = x.c.laps.length ? Math.min(...x.c.laps) : null;
      rows.push(`<tr class="${x.c === P ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${x.c === P ? carPaint(save.car) : x.c.color}"></span>${x.c === P ? 'You' : x.c.name}</td><td>${best ? formatTime(best) : ''}</td><td>${x.c.finished ? formatTime(x.t) : '~' + formatTime(x.t)}</td></tr>`);
    });
    $('resTable').innerHTML = `<tr><td></td><td><small>Racer</small></td><td><small>Best lap</small></td><td><small>Time</small></td></tr>` + rows.join('');
    $('rRetry').textContent = '⟲ Race again';
  } else {
    const r = rec(T.def.id);
    $('resBadge').textContent = newPB ? '⭐' : '⏱';
    $('resTitle').textContent = newPB ? 'New Personal Best!' : 'Time Trial Done';
    $('resSub').textContent = `${T.def.name} · total ${formatTime(P.finishT)} · record ${formatTime(r.bestLap)}`;
    const best = Math.min(...P.laps);
    P.laps.forEach((t, i) => rows.push(`<tr class="${t === best ? 'me' : ''}"><td>L${i + 1}</td><td>${t === best ? 'Best lap' : ''}${t === r.bestLap ? '<span class="pb">RECORD</span>' : ''}</td><td></td><td>${formatTime(t)}</td></tr>`));
    $('resTable').innerHTML = rows.join('');
    $('rRetry').textContent = '⟲ Go again';
  }
  $('hud').classList.add('hidden');
  show('results');
}

$('rRetry').onclick = () => { audio.click(); startRace(trackIndex); };
$('rNext').onclick = () => { audio.click(); startRace((trackIndex + 1) % TRACKS.length); };
$('rMenu').onclick = () => { audio.click(); quitToMenu(); };
function quitToMenu() { state = 'menu'; $('hud').classList.add('hidden'); world = null; show('title'); resize(); }

function pause() {
  if (state !== 'race') return;
  state = 'paused';
  $('pCamName').textContent = CAM_LABEL[camMode];
  $('pSoundName').textContent = save.settings.sound ? 'On' : 'Off';
  show('pause');
}
function resume() { if (state !== 'paused') return; state = 'race'; show('none'); last = performance.now(); }
// HUD buttons fire on touch-down: mobile browsers drop 'click' while another finger
// is holding gas/steer, which made the camera and pause buttons miss mid-race.
function hudTap(el, fn) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
  el.addEventListener('click', (e) => { if (e.detail === 0) fn(); }); // keyboard activation
}
hudTap($('pauseBtn'), () => { if (state !== 'race') return; audio.click(); pause(); });
$('pResume').onclick = () => { audio.click(); resume(); };
$('pRestart').onclick = () => { audio.click(); startRace(trackIndex); };
$('pReset').onclick = () => { audio.click(); if (world && !player.loop) respawn(world, player, 'reset'); resume(); };
$('pCam').onclick = () => { cycleCam(); $('pCamName').textContent = CAM_LABEL[camMode]; };
$('pSound').onclick = () => { save.settings.sound = !save.settings.sound; audio.setEnabled(save.settings.sound); persist(); $('pSoundName').textContent = save.settings.sound ? 'On' : 'Off'; };
$('pQuit').onclick = () => { audio.click(); quitToMenu(); };
hudTap($('camBtn'), () => { audio.click(); cycleCam(); });
function cycleCam() { camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length]; camState.init = false; save.settings.cam = camMode; persist(); showCamName(); }
let camNameT = 0;
function showCamName() { $('camName').textContent = '🎥 ' + CAM_LABEL[camMode]; $('camName').classList.add('on'); camNameT = 1.4; }
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ------------------------------------------------------------------ input
const keys = new Set();
const touch = { left: false, right: false, gas: false, brake: false, hand: false, nitro: false };
window.addEventListener('keydown', (e) => {
  if (e.repeat && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
  keys.add(e.code);
  if (state === 'race') {
    if (e.code === 'KeyC') cycleCam();
    if (e.code === 'Escape' || e.code === 'KeyP') pause();
    if (e.code === 'KeyR' && world && !player.loop) respawn(world, player, 'reset');
  } else if (state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) resume();
  if (state === 'race' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  audio.unlock();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); for (const k in touch) touch[k] = false; });

function bindHold(el, key) {
  const ids = new Set();
  const set = () => { touch[key] = ids.size > 0; el.classList.toggle('on', touch[key]); };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); audio.unlock(); ids.add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch { /* ok */ } set(); });
  const up = (e) => { ids.delete(e.pointerId); set(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindHold($('btnGas'), 'gas'); bindHold($('btnBrake'), 'brake'); bindHold($('btnHand'), 'hand'); bindHold($('btnNitro'), 'nitro');
{
  // steering pad: slide your thumb between ◀ and ▶
  const pad = $('steerPad'), L = pad.querySelector('.left'), R = pad.querySelector('.right');
  const ptrs = new Map();
  const update = () => {
    let l = false, r = false;
    const rect = pad.getBoundingClientRect(), mid = rect.left + rect.width / 2;
    for (const x of ptrs.values()) { if (x < mid) l = true; else r = true; }
    touch.left = l; touch.right = r;
    L.classList.toggle('on', l); R.classList.toggle('on', r);
  };
  pad.addEventListener('pointerdown', (e) => { e.preventDefault(); audio.unlock(); ptrs.set(e.pointerId, e.clientX); try { pad.setPointerCapture(e.pointerId); } catch { /* ok */ } update(); });
  pad.addEventListener('pointermove', (e) => { if (ptrs.has(e.pointerId)) { ptrs.set(e.pointerId, e.clientX); update(); } });
  const up = (e) => { ptrs.delete(e.pointerId); update(); };
  pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up); pad.addEventListener('lostpointercapture', up);
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
}
document.addEventListener('touchmove', (e) => { if (state === 'race') e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
function applyTouchVisibility() {
  const s = save.settings.touch;
  $('touch').classList.toggle('hidden', s === 'off' || (s === 'auto' && !isTouchDevice()));
}

function readInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  let steer = 0;
  if (k('ArrowLeft', 'KeyA') || touch.left) steer -= 1;
  if (k('ArrowRight', 'KeyD') || touch.right) steer += 1;
  let throttle = k('ArrowUp', 'KeyW') || touch.gas ? 1 : 0;
  let brake = k('ArrowDown', 'KeyS') || touch.brake ? 1 : 0;
  let handbrake = k('Space') || touch.hand;
  let nitro = k('ShiftLeft', 'ShiftRight', 'KeyN', 'KeyX') || touch.nitro;
  // gamepad
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const ax = gp.axes[0] || 0;
    if (Math.abs(ax) > 0.15) steer = clamp(steer + ax, -1, 1);
    if (gp.buttons[14]?.pressed) steer = -1;
    if (gp.buttons[15]?.pressed) steer = 1;
    const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
    throttle = Math.max(throttle, rt, gp.buttons[0]?.pressed ? 1 : 0);
    brake = Math.max(brake, lt, gp.buttons[1]?.pressed ? 1 : 0);
    if (gp.buttons[2]?.pressed || gp.buttons[5]?.pressed) handbrake = true;
    if (gp.buttons[3]?.pressed || gp.buttons[4]?.pressed) nitro = true;
    if (gp.buttons[9]?.pressed && !padStartHeld && state === 'race') pause();
    padStartHeld = !!gp.buttons[9]?.pressed;
  }
  if (save.settings.autoGas && !brake) throttle = 1;
  return { steer, throttle, brake, handbrake, nitro };
}
let padStartHeld = false;

// ------------------------------------------------------------------ HUD
const mm = $('minimap'), mmg = mm.getContext('2d');
let mmBase = null, mmTf = null;
function drawMinimapBase() {
  const T = track;
  const c = document.createElement('canvas'); c.width = mm.width; c.height = mm.height;
  const g = c.getContext('2d');
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of T.paths) for (let i = 0; i < p.n; i++) { x0 = Math.min(x0, p.x[i]); x1 = Math.max(x1, p.x[i]); z0 = Math.min(z0, p.z[i]); z1 = Math.max(z1, p.z[i]); }
  const s = (c.width - 20) / Math.max(x1 - x0, z1 - z0);
  const ox = c.width / 2 - (x0 + x1) / 2 * s, oz = c.height / 2 - (z0 + z1) / 2 * s;
  mmTf = { s, ox, oz };
  const line = (p, w, col) => { g.beginPath(); for (let i = 0; i < p.n; i++) g[i ? 'lineTo' : 'moveTo'](ox + p.x[i] * s, oz + p.z[i] * s); if (p.closed) g.closePath(); g.lineWidth = w; g.strokeStyle = col; g.lineJoin = 'round'; g.stroke(); };
  for (const p of T.paths.slice(1)) line(p, 4, 'rgba(93,255,122,.8)');
  line(T.main, 6, 'rgba(255,255,255,.9)');
  const p0 = pathPoint(T.main, 0);
  g.fillStyle = '#ffd000'; g.fillRect(ox + p0.x * s - 4, oz + p0.z * s - 4, 8, 8);
  mmBase = c;
}
function drawMinimap() {
  mmg.clearRect(0, 0, mm.width, mm.height);
  if (!mmBase) return;
  mmg.drawImage(mmBase, 0, 0);
  const { s, ox, oz } = mmTf;
  for (const c of world.cars) {
    if (c === player) continue;
    mmg.fillStyle = c.color; mmg.beginPath(); mmg.arc(ox + c.x * s, oz + c.z * s, 4, 0, TAU); mmg.fill();
  }
  if (ghostView && ghostView.root.visible) { mmg.fillStyle = 'rgba(159,232,255,.8)'; mmg.beginPath(); mmg.arc(ox + ghostView.root.position.x * s, oz + ghostView.root.position.z * s, 4, 0, TAU); mmg.fill(); }
  mmg.save();
  mmg.translate(ox + player.x * s, oz + player.z * s); mmg.rotate(-player.h + Math.PI);
  mmg.fillStyle = '#ffd000'; mmg.strokeStyle = '#120726'; mmg.lineWidth = 2;
  mmg.beginPath(); mmg.moveTo(0, 7); mmg.lineTo(5, -5); mmg.lineTo(-5, -5); mmg.closePath(); mmg.fill(); mmg.stroke();
  mmg.restore();
}
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHUD() {
  const P = player;
  setText('hudPos', String(P.place));
  setText('hudLap', `${Math.min(world.laps, Math.max(1, P.maxLap + 1))}/${world.laps}`);
  const t = world.phase === 'race' ? (P.finished ? P.finishT : world.raceT) : 0;
  setText('hudTime', formatTime(t));
  setText('hudLapTime', formatTime(world.phase === 'race' && !P.finished ? world.raceT - P.lapStart : (P.laps[P.laps.length - 1] || 0)));
  setText('hudSpeed', String(Math.round(Math.abs(P.speed) * SPEED_TO_KMH)));
  $('nitroFill').style.width = Math.round(P.nitro * 100) + '%';
  $('nitroFill').parentElement.classList.toggle('full', P.nitro > 0.98);
  $('btnNitro').classList.toggle('ready', P.nitro > 0.3);
  $('nitroFx').classList.toggle('on', P.nitroOn || P.boostT > 0);
  $('wrongWay').classList.toggle('hidden', !(P.wrongT > 1 && !P.finished));
  if (mode === 'race' && P.place !== lastPlace) {
    const pill = $('posPill'); pill.animate([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 300 });
    lastPlace = P.place;
  }
  drawMinimap();
}

// ------------------------------------------------------------------ camera
const camState = { init: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, fov: 62 };
let shake = 0;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function updateCamera(dt) {
  const P = player, view = carViews.find((c) => c.car === P).v;
  const pov = camMode === 'driver';
  for (const m of tunnelMeshes) m.visible = camMode !== 'top';
  for (const m of view.povHide) m.visible = !pov;
  view.steerWheel.visible = pov; view.dash.visible = pov;
  if (!camState.init) { camState.yaw = P.h; }
  // follow heading, but look along the track while flipping through a loop
  const yawT = P.loop ? Math.atan2(P.loop.tx, P.loop.tz) : P.h;
  let dy = yawT - camState.yaw; while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
  camState.yaw += dy * Math.min(1, dt * (camMode === 'top' ? 3 : 5.5));
  const fx = Math.sin(camState.yaw), fz = Math.cos(camState.yaw);
  const sp = Math.abs(P.speed) / P.spec.top;
  const fovT = (pov ? 70 : 60) + sp * 12 + (P.nitroOn || P.boostT > 0 ? 8 : 0);
  camState.fov = lerp(camState.fov, fovT, Math.min(1, dt * 3));
  camera.fov = camState.fov; camera.updateProjectionMatrix();
  camera.up.set(0, 1, 0);
  const sx = (Math.random() - 0.5) * shake * 0.5, sy = (Math.random() - 0.5) * shake * 0.5;
  shake = Math.max(0, shake - dt * 3);
  if (pov) {
    view.root.updateMatrixWorld(true);
    tmpV.set(view.eye[0], view.eye[1], view.eye[2]);
    view.tilt.localToWorld(tmpV);
    camera.position.copy(tmpV).add(tmpV2.set(sx * 0.3, sy * 0.3, 0));
    view.tilt.getWorldQuaternion(tmpQ);
    camera.quaternion.copy(tmpQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, Math.PI, 0)));
    camState.init = true;
    return;
  }
  let pos, look;
  if (camMode === 'chase') {
    const dist = 9 + sp * 1.5, height = 3.8 + sp * 0.4;
    pos = tmpV.set(P.x - fx * dist, P.y + height, P.z - fz * dist);
    look = tmpV2.set(P.x + fx * 4, P.y + 1.3, P.z + fz * 4);
    if (P.loop) {
      // swing out to the side so the whole loop is in view
      const L = P.loop, R = L.R;
      pos.set(L.bx - L.rx * R * 2.7 - L.tx * R * 0.4, L.by + R * 1.0, L.bz - L.rz * R * 2.7 - L.tz * R * 0.4);
      look.set(L.bx + L.tx * R * 0.1, L.by + R * 0.95, L.bz + L.tz * R * 0.1);
    }
  } else {
    pos = tmpV.set(P.x - fx * 10, P.y + 52, P.z - fz * 10);
    if (P.loop) pos.y = P.loop.by + 52;
    look = tmpV2.set(P.x + fx * 9, P.y, P.z + fz * 9);
  }
  if (!camState.init) { camState.pos.copy(pos); camState.look.copy(look); camState.init = true; }
  const k = camMode === 'top' ? 6 : P.loop ? 5 : 9;
  camState.pos.lerp(pos, Math.min(1, dt * k));
  camState.look.lerp(look, Math.min(1, dt * 12));
  // keep the chase cam above the track surface
  if (camMode === 'chase' && !P.loop) camState.pos.y = Math.max(camState.pos.y, P.y + 1.8);
  camera.position.copy(camState.pos).add(tmpV.set(sx, sy, 0));
  camera.lookAt(camState.look);
}

// ------------------------------------------------------------------ syncing meshes
const qa = new THREE.Quaternion(), ma = new THREE.Matrix4(), va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
function syncCar(cv, dt) {
  const c = cv.car, v = cv.v;
  v.root.position.set(c.x, c.y, c.z);
  if (c.loop) {
    const L = c.loop, th = Math.min(L.th, TAU);
    const fwd = va.set(L.tx * Math.cos(th), Math.sin(th), L.tz * Math.cos(th)).normalize();
    const up = vb.set(-L.tx * Math.sin(th), Math.cos(th), -L.tz * Math.sin(th)).normalize();
    const right = vc.crossVectors(up, fwd).normalize();
    ma.makeBasis(right, up, fwd);
    v.root.quaternion.setFromRotationMatrix(ma);
    v.tilt.rotation.set(0, 0, 0);
    c.pitch = 0; c.roll = 0;
  } else {
    v.root.quaternion.setFromAxisAngle(va.set(0, 1, 0), c.h);
    const sp = Math.max(4, Math.abs(c.speed));
    const pitchT = c.air ? clamp(Math.atan2(c.vy, sp) * 0.8, -0.6, 0.5) : clamp(Math.atan2(c.vy, sp), -0.5, 0.5);
    c.pitch = lerp(c.pitch, pitchT, Math.min(1, dt * 10));
    const rollT = c.air ? 0 : clamp(c.steer * Math.abs(c.speed) / c.spec.top * 0.09 + (c.drift > 3 ? Math.sign(c.steer) * 0.04 : 0), -0.14, 0.14);
    c.roll = lerp(c.roll, rollT, Math.min(1, dt * 6));
    v.tilt.rotation.set(-c.pitch, 0, c.roll, 'YXZ');
  }
  for (const w of v.wheels) {
    w.spin.rotation.x = c.wheelRot;
    if (w.front) w.pivot.rotation.y = -c.steer * 0.42;
  }
  v.steerWheel.rotation.z = c.steer * 1.5;
  const fl = c.nitroOn || c.boostT > 0;
  for (const f of v.flames) { f.visible = fl; if (fl) { f.scale.y = 1 + Math.random() * 0.9; f.material.color.set(c.nitroOn ? '#7fe8ff' : '#ffb000'); } }
  v.tail.emissiveIntensity = c.input && c.input.brake && c === player ? 2.5 : 0.6;
  v.root.visible = !(c.ghostT > 0 && Math.floor(c.ghostT * 10) % 2 === 0);
  // smoke: drifting, offroad dust
  cv.smokeT -= dt;
  if (cv.smokeT <= 0 && !c.loop && !c.air && Math.abs(c.speed) > 6) {
    const off = c.q && !c.q.inside;
    const drifting = c.drift > 3.5;
    const dirt = c.q && c.q.inside && track.paths[c.q.pi].surface === 'dirt';
    if (drifting || off || dirt) {
      const col = off ? SMOKE_COLORS[track.offroad] || SMOKE_COLORS.floor : dirt ? SMOKE_COLORS.dirt : null;
      const bx = c.x - Math.sin(c.h) * 1.8, bz = c.z - Math.cos(c.h) * 1.8;
      for (const s of [-1, 1]) emit(smoke, bx + Math.cos(c.h) * s, c.y + 0.4, bz - Math.sin(c.h) * s, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0.7 + Math.random() * 0.4, col);
      cv.smokeT = 0.04;
    }
  }
}

function syncObstacles() {
  for (const ov of obsViews) {
    const o = ov.o;
    ov.root.position.set(o.x, o.y, o.z);
    if (o.type === 'traffic') { ov.root.rotation.y = o.h; for (const w of ov.wheels) w.rotation.x = o.wheel || 0; }
    else if (o.knock) { ov.root.rotation.set(o.rx || 0, 0, o.rz || 0); if (o.down && !o.flying) ov.root.rotation.z = Math.PI / 2; }
    else if (o.moving) { ov.root.rotation.y = o.h; const inner = ov.root.children[0]; if (inner) inner.rotation.z = -(o.roll || 0); }
  }
}

function syncGhost() {
  if (!ghostView || !ghostPlay) return;
  const t = world.raceT - player.lapStart;
  const i = Math.floor(t * 20);
  const g = ghostPlay;
  if (world.phase !== 'race' || player.finished || i * 4 + 7 >= g.length) { ghostView.root.visible = false; return; }
  ghostView.root.visible = true;
  const f = t * 20 - i, a = i * 4, b = a + 4;
  ghostView.root.position.set(lerp(g[a], g[b], f), lerp(g[a + 1], g[b + 1], f), lerp(g[a + 2], g[b + 2], f));
  let dh = g[b + 3] - g[a + 3]; while (dh > Math.PI) dh -= TAU; while (dh < -Math.PI) dh += TAU;
  ghostView.root.rotation.set(0, g[a + 3] + dh * f, 0);
}

function recordGhost() {
  if (mode !== 'trial' || world.phase !== 'race' || player.finished) return;
  const t = world.raceT - player.lapStart;
  const i = Math.floor(t * 20);
  if (i > lastGhostSample) {
    lastGhostSample = i;
    ghostRec.push(player.x, player.y, player.z, player.h);
    if (ghostRec.length > 4 * 20 * 240) ghostRec.length = 0; // runaway guard
  }
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), acc = 0, gTime = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  gTime += dt;
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').classList.remove('on'); }
  if (subTimer > 0) { subTimer -= dt; if (subTimer <= 0) $('sub').classList.remove('on'); }
  if (camNameT > 0) { camNameT -= dt; if (camNameT <= 0) $('camName').classList.remove('on'); }

  if (state === 'race' || state === 'paused' || state === 'results') {
    if (state === 'race') {
      player.input = player.finished ? player.input : readInput();
      acc += dt;
      while (acc >= DT) { stepWorld(world, DT); recordGhost(); acc -= DT; }
      handleEvents();
      if (finishTimer > 0) { finishTimer -= dt; if (finishTimer <= 0) showResults(); }
      const P = player;
      audio.engine(Math.abs(P.speed) / P.spec.top, P.finished ? 0.5 : P.input.throttle, P.air ? 0 : clamp((P.drift - 2.5) / 6, 0, 1), P.nitroOn, true);
    } else {
      audio.engine(0, 0, 0, false, false);
    }
    for (const cv of carViews) syncCar(cv, dt);
    syncObstacles();
    syncGhost();
    for (const t of boostMats) t.offset.y -= dt * 1.6;
    stepParticles(smoke, dt, -1.5);
    stepParticles(sparks, dt, 18);
    if (sunLight) {
      sunLight.position.set(player.x + 50, player.y + 100, player.z + 35);
      sunLight.target.position.set(player.x, player.y, player.z);
    }
    updateCamera(dt);
    if (state === 'race') updateHUD();
    renderer.render(scene, camera);
  } else {
    audio.engine(0, 0, 0, false, false);
    // menu: spinning car on the turntable
    if (!garageCar) refreshGarageCar();
    garageCar.root.rotation.y = gTime * 0.6;
    for (const w of garageCar.wheels) w.spin.rotation.x = gTime * 2;
    const r = screen === 'garage' ? 8.4 : 10.5;
    garageCam.position.set(Math.sin(gTime * 0.1) * r * 0.7 + 4, screen === 'garage' ? 3.2 : 4.2, Math.cos(gTime * 0.1) * r * 0.7 + 5);
    garageCam.lookAt(0, screen === 'garage' ? 1.4 : -2.6, 0);
    renderer.render(garageScene, garageCam);
  }
}

garageIndex = save.car;
show('title');
resize();
requestAnimationFrame(frame);
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// dev-only hook so automated checks can advance frames while the tab is hidden
if (import.meta.env && import.meta.env.DEV) {
  window.__tcr = {
    tick(n = 1, ms = 16.7) { for (let i = 0; i < n; i++) { last -= ms; frame(performance.now()); } },
    get world() { return world; }, get player() { return player; }, camera, scene,
    setCam(m) { camMode = m; camState.init = false; },
    autopilot() { player.ai = makeAI(mulberry32(1), 'hard', 0); }
  };
}
