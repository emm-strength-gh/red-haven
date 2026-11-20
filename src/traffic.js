// Commute City — game shell: menus, camera, input, HUD, ride-along camera and the render loop.
import * as THREE from 'three';
import * as T from './traffic-sim.js';
import { CITY_MAPS, PUZZLES, SIGNAL_LEVELS } from './traffic-maps.js';
import { createWorld } from './traffic-world.js';
import { createAudio } from './traffic-audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const SAVE_KEY = 'commute-city-v1';
const BUILD_TOOLS = ['road', 'motorway', 'tram', 'rail'];
const isBuild = (t) => BUILD_TOOLS.includes(t);
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

// ------------------------------------------------------------------ save
const save = loadSave();
function loadSave() {
  const base = { cities: {}, sandbox: {}, best: {}, puzzles: {}, signals: {}, settings: { sound: true, quality: 'high' }, helped: false };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s && typeof s === 'object') return { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
  } catch { /* ignore a broken save */ }
  return base;
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* storage full or blocked */ } }

const audio = createAudio();
audio.setEnabled(save.settings.sound);

// ------------------------------------------------------------------ renderer & scene
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const SKY = new THREE.Color('#9fdcff');
scene.background = SKY.clone();
scene.fog = new THREE.Fog(SKY.clone(), 40, 120);
const camera = new THREE.PerspectiveCamera(32, 1, 0.3, 300);
const hemi = new THREE.HemisphereLight('#ffffff', '#a8d978', 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e2', 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const world = createWorld(scene);

function applyQuality() {
  const hi = save.settings.quality === 'high';
  renderer.setPixelRatio(Math.min(hi ? 2 : 1, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = hi;
  sun.castShadow = hi;
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
}
applyQuality();
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ game state
const G = {
  S: null, mode: null, def: null, level: null, speed: 1, started: true,
  tool: 'pan', layer: 'ground', color: 0, ride: null, drag: null, plan: null,
  lineDraft: null, linesOpen: false, inspect: null, saveT: 0, overT: 0, mouse: { x: 0, y: 0 },
};
const cam = { tx: 0, tz: 0, yaw: 0, pitch: 1.0, dist: 20, top: false, fly: null, keys: new Set() };

// ------------------------------------------------------------------ camera
function fitBox(S) {
  if (S.mode === 'signal') return { x0: 1.6, y0: 1, x1: S.W - 2.6, y1: S.H - 2 };
  if (S.mode !== 'city') return { x0: 0, y0: 0, x1: S.W - 1, y1: S.H - 1 };
  return S.bounds;
}
// phones held upright: turn wide maps so their long side runs down the screen
function baseYaw(S) {
  const b = fitBox(S);
  return camera.aspect < 0.85 && b.x1 - b.x0 > (b.y1 - b.y0) * 1.1 ? Math.PI / 2 : 0;
}
function fitCamera(S, instant = true) {
  const b = fitBox(S);
  const w = b.x1 - b.x0 + 2, h = b.y1 - b.y0 + 2;
  const turned = Math.abs(Math.sin(cam.yaw)) > 0.7;
  const sw = turned ? h : w, sh = turned ? w : h; // extents across / up the screen
  const off = cam.top ? 0 : 0.6;
  const tx = (b.x0 + b.x1) / 2 + Math.sin(cam.yaw) * off, tz = (b.y0 + b.y1) / 2 + Math.cos(cam.yaw) * off;
  const span = Math.max(sh * Math.sin(cam.pitch) + 1.2, (sw / camera.aspect) * 0.98);
  const dist = clamp((span / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.08, 4, 90);
  if (instant) { cam.tx = tx; cam.tz = tz; cam.dist = dist; cam.fly = null; }
  else cam.fly = { tx, tz, dist, yaw: cam.yaw, t: 0 };
}
function flyTo(x, z, dist = cam.dist) { cam.fly = { tx: x, tz: z, dist, yaw: cam.yaw, t: 0 }; }
function setupSun(S) {
  const cx = S.W / 2, cz = S.H / 2, r = Math.max(S.W, S.H) * 0.62 + 4;
  sun.position.set(cx - 12, 22, cz - 8);
  sun.target.position.set(cx, 0, cz);
  const sc = sun.shadow.camera;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 1; sc.far = 70;
  sc.updateProjectionMatrix();
}
function updateCamera(dt) {
  if (G.ride) return rideCamera(dt);
  const S = G.S;
  // keyboard pan / rotate
  const k = cam.keys;
  const pan = cam.dist * 0.9 * dt;
  let px = 0, pz = 0;
  if (k.has('w') || k.has('arrowup')) pz -= 1;
  if (k.has('s') || k.has('arrowdown')) pz += 1;
  if (k.has('a') || k.has('arrowleft')) px -= 1;
  if (k.has('d') || k.has('arrowright')) px += 1;
  if (px || pz) {
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    cam.tx += (px * c + pz * s) * pan; cam.tz += (-px * s + pz * c) * pan;
    cam.fly = null;
  }
  if (k.has('q')) cam.yaw += dt * 1.6;
  if (k.has('e')) cam.yaw -= dt * 1.6;
  if (G.mode === 'demo') cam.yaw += dt * 0.06;
  if (cam.fly) {
    const f = cam.fly;
    f.t = Math.min(1, f.t + dt * 1.6);
    const e = 1 - Math.pow(1 - f.t, 3);
    cam.tx = lerp(cam.tx, f.tx, e * 0.25 + 0.05); cam.tz = lerp(cam.tz, f.tz, e * 0.25 + 0.05); cam.dist = lerp(cam.dist, f.dist, e * 0.25 + 0.05);
    if (f.t >= 1 && Math.abs(cam.tx - f.tx) < 0.02 && Math.abs(cam.dist - f.dist) < 0.05) cam.fly = null;
  }
  const wantPitch = cam.top ? 1.52 : cam.pitchUser ?? 1.0;
  cam.pitch = lerp(cam.pitch, wantPitch, Math.min(1, dt * 6));
  if (S) {
    cam.tx = clamp(cam.tx, -3, S.W + 2);
    cam.tz = clamp(cam.tz, -3, S.H + 2);
  }
  cam.dist = clamp(cam.dist, 2.5, 95);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  camera.position.set(cam.tx + Math.sin(cam.yaw) * cp * cam.dist, sp * cam.dist, cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(cam.tx, 0, cam.tz);
  setLens(32, Math.max(0.2, cam.dist * 0.04), cam.dist * 5 + 60);
  scene.fog.near = cam.dist * 1.25;
  scene.fog.far = cam.dist * 3.4 + 30;
}
function setLens(fov, near, far) {
  if (camera.fov !== fov || Math.abs(camera.near - near) > 1e-3 || Math.abs(camera.far - far) > 0.5) {
    camera.fov = fov; camera.near = near; camera.far = far;
    camera.updateProjectionMatrix();
  }
}

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitV = new THREE.Vector3();
function groundHit(cx, cy, h = 0) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  if (Math.abs(d.y) < 1e-5) return null;
  const t = (h - o.y) / d.y;
  if (t <= 0) return null;
  return hitV.copy(o).addScaledVector(d, t).clone();
}
function tileAt(cx, cy, h = 0) {
  const p = groundHit(cx, cy, h);
  if (!p) return null;
  const x = Math.round(p.x), y = Math.round(p.z);
  if (!G.S || x < 0 || y < 0 || x >= G.S.W || y >= G.S.H) return null;
  return { x, y };
}
const layerH = () => (G.layer === 'up' && (isBuild(G.tool) || G.tool === 'erase') ? T.LEVEL_H[2] : 0);

const pv = new THREE.Vector3();
function project(x, y, z) {
  pv.set(x, y, z).project(camera);
  return { x: (pv.x * 0.5 + 0.5) * innerWidth, y: (-pv.y * 0.5 + 0.5) * innerHeight, on: pv.z > -1 && pv.z < 1 };
}

// ------------------------------------------------------------------ demo city behind the menus
function applySolution(S, P) {
  for (const st of P.solution) {
    const [kind] = st;
    if (kind === 'stop') { T.placeStop(S, st[1], st[2]); continue; }
    if (kind === 'round' || kind === 'lights') { T.setControl(S, st[1], st[2], kind); continue; }
    if (kind === 'line') { T.createLine(S, st[1], st[2].map(([x, y]) => T.nkey(S, x, y, 0))); continue; }
    const plan = T.planBuild(S, st[2].map(([x, y]) => ({ x, y })), kind, st[1]);
    T.commitBuild(S, plan);
  }
}
function startDemo() {
  const P = PUZZLES.find((p) => p.id === 'p10');
  const S = T.createPuzzle(P);
  S.sandbox = true;
  applySolution(S, P);
  S.goal = Infinity; S.fail = false;
  T.simulate(S, 25);
  S.events.length = 0;
  setState(S, 'demo');
  cam.yaw = 0.5; cam.pitchUser = 0.95; cam.pitch = 0.95; cam.top = false;
  fitCamera(S);
  cam.dist *= 0.82;
}

// ------------------------------------------------------------------ starting modes
function setState(S, mode, extra = {}) {
  endRide(true);
  G.S = S; G.mode = mode; G.def = extra.def || null; G.level = extra.level || null;
  G.speed = mode === 'demo' ? 1 : extra.paused ? 0 : 1;
  G.started = !extra.paused;
  G.drag = null; G.plan = null; G.lineDraft = null; G.inspect = null; G.overT = 0; G.saveT = 0;
  G.tool = 'pan'; G.layer = 'ground';
  world.setState(S);
  world.clearPreview(); world.setHover(null); world.setXray(false); world.setGrid(false); world.setLines(false);
  setupSun(S);
  clearOverlays();
  if (mode !== 'demo') {
    buildToolbar();
    buildSigButtons();
  }
}

function startCity(def, data, sandbox = false, opts = {}) {
  let S;
  if (data) S = T.loadCity(def, data);
  else S = T.createCity(def, { sandbox, seed: (Math.random() * 1e9) | 0, open: sandbox, empty: !!opts.empty, grow: opts.grow !== false });
  if (sandbox && !data && opts.empty) S.grow = false;
  enterGame();
  setState(S, 'city', { def, paused: !sandbox && !data });
  cam.top = false; cam.pitchUser = 1.0; cam.pitch = 1.0; cam.yaw = baseYaw(S);
  fitCamera(S);
  updateHudLayout();
  if (!sandbox && !data) {
    banner(def.name, 'Drag roads from each house to the workplace of the same colour. Every trip pays. If a workplace waits too long, the city is lost.', '▶ Start the day');
  } else hideBanner();
  if (sandbox) toast('Sandbox: unlimited money and no game over. Place houses and workplaces too!', 'good', 4500);
}
function startPuzzle(P) {
  const S = T.createPuzzle(P);
  enterGame();
  setState(S, 'puzzle', { level: P, paused: true });
  cam.top = false; cam.pitchUser = 1.05; cam.pitch = 1.05; cam.yaw = baseYaw(S);
  fitCamera(S);
  updateHudLayout();
  banner(`${PUZZLES.indexOf(P) + 1}. ${P.name}`, `${P.hint} Deliver ${P.goal} trips. Spend ${money(P.par)} or less for three stars.`, '▶ Start traffic');
}
function startSignal(L) {
  const S = T.createSignalLevel(L);
  enterGame();
  setState(S, 'signal', { level: L, paused: true });
  cam.top = false; cam.pitchUser = 1.12; cam.pitch = 1.12; cam.yaw = baseYaw(S);
  fitCamera(S);
  updateHudLayout();
  banner(`${SIGNAL_LEVELS.indexOf(L) + 1}. ${L.name}`, `${L.hint} Get ${L.goal} vehicles through. Three crashes or angry drivers and it is over.`, '▶ Go!');
}
function enterGame() {
  hideScreens();
  $('hud').classList.remove('hidden');
  closeModal();
}

// ------------------------------------------------------------------ HUD
function updateHudLayout() {
  const m = G.mode, S = G.S;
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  show('chipMoney', m === 'city' || m === 'puzzle');
  show('chipClock', m === 'city');
  show('chipTrips', m === 'city');
  show('chipGoal', m === 'puzzle' || m === 'signal');
  show('chipPar', m === 'puzzle');
  show('chipStrikes', m === 'signal');
  show('linesBtn', m !== 'signal' && hasTransitTools());
  show('rideBtn', true);
  for (const b of $('speedBox').children) b.classList.toggle('hidden', m === 'signal' && +b.dataset.sp > 1);
  $('hudGoalLabel').textContent = m === 'signal' ? 'Through' : 'Trips';
  $('linesPanel').classList.add('hidden');
  G.linesOpen = false;
  $('linesBtn').classList.remove('on');
  hideInspector();
  $('lineDraft').classList.add('hidden');
  if (S) $('chipMoney').querySelector('small').textContent = m === 'puzzle' ? 'Budget' : 'Money';
}
function hasTransitTools() {
  if (G.mode !== 'puzzle') return true;
  const t = G.level.tools || [];
  return t.includes('line');
}
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud() {
  const S = G.S;
  if (!S || G.mode === 'demo') return;
  if (G.mode === 'city' || G.mode === 'puzzle') {
    setText('hudMoney', S.sandbox ? '∞' : money(S.money));
    $('chipMoney').classList.toggle('money-low', !S.sandbox && S.money < 20);
  }
  if (G.mode === 'city') {
    const h = T.hourOf(S);
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60 / 10) * 10;
    setText('hudTime', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    setText('hudDay', `Day ${T.dayOf(S) - Math.floor(S.t0 / T.DAY) + 1}`);
    setText('hudSun', h >= 6 && h < 18 ? '☀️' : h >= 18 && h < 21 ? '🌇' : '🌙');
    const rush = (h >= 7 && h < 9.5) || (h >= 16 && h < 18.5);
    $('hudRush').classList.toggle('hidden', !rush);
    setText('hudTrips', String(S.trips));
  }
  if (G.mode === 'puzzle') {
    setText('hudGoal', `${Math.min(S.trips, S.goal)} / ${S.goal}`);
    $('hudGoalBar').style.width = `${Math.min(100, (S.trips / S.goal) * 100)}%`;
    setText('hudPar', `${money(G.level.budget - S.money)} · ${money(G.level.par)}`);
  }
  if (G.mode === 'signal') {
    const L = G.level;
    setText('hudGoal', `${Math.min(S.passed, L.goal)} / ${L.goal}`);
    $('hudGoalBar').style.width = `${Math.min(100, (S.passed / L.goal) * 100)}%`;
    const lives = Math.max(0, (L.strikes || 3) - S.strikes);
    setText('hudStrikes', '❤️'.repeat(lives) + '🖤'.repeat((L.strikes || 3) - lives));
  }
  for (const b of $('speedBox').children) b.classList.toggle('on', +b.dataset.sp === G.speed);
}

// ------------------------------------------------------------------ toolbar
const ICON = {
  road: '<svg viewBox="0 0 32 32"><rect x="8" y="1" width="16" height="30" rx="3" fill="#aab0ba"/><rect x="8" y="1" width="2.4" height="30" fill="#fff"/><rect x="21.6" y="1" width="2.4" height="30" fill="#fff"/><rect x="15" y="3" width="2" height="6" rx="1" fill="#fff"/><rect x="15" y="13" width="2" height="6" rx="1" fill="#fff"/><rect x="15" y="23" width="2" height="6" rx="1" fill="#fff"/></svg>',
  motorway: '<svg viewBox="0 0 32 32"><rect x="3" y="1" width="26" height="30" rx="3" fill="#959ca7"/><rect x="14.6" y="1" width="1.2" height="30" fill="#ffcf3a"/><rect x="16.2" y="1" width="1.2" height="30" fill="#ffcf3a"/><rect x="9" y="3" width="1.6" height="6" fill="#fff"/><rect x="9" y="13" width="1.6" height="6" fill="#fff"/><rect x="9" y="23" width="1.6" height="6" fill="#fff"/><rect x="21.4" y="3" width="1.6" height="6" fill="#fff"/><rect x="21.4" y="13" width="1.6" height="6" fill="#fff"/><rect x="21.4" y="23" width="1.6" height="6" fill="#fff"/></svg>',
  round: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#aab0ba"/><circle cx="16" cy="16" r="5.5" fill="#6fcf4a" stroke="#fff" stroke-width="2"/><path d="M16 4.5a11.5 11.5 0 0 1 11 8" stroke="#fff" stroke-width="2" fill="none" stroke-dasharray="3 3"/></svg>',
  line: '<svg viewBox="0 0 32 32"><path d="M4 24 L12 12 L20 20 L28 7" stroke="#ff6b3d" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4" cy="24" r="3.6" fill="#fff" stroke="#23324a" stroke-width="2"/><circle cx="12" cy="12" r="3.6" fill="#fff" stroke="#23324a" stroke-width="2"/><circle cx="28" cy="7" r="3.6" fill="#fff" stroke="#23324a" stroke-width="2"/></svg>',
};
const TOOLS = {
  pan: { ic: '✋', name: 'Look', tip: 'Drag to move · click a car to ride along' },
  road: { ic: ICON.road, name: 'Road', cost: '$10', tip: 'Drag across tiles to build a road' },
  motorway: { ic: ICON.motorway, name: 'Motorway', cost: '$40', tip: 'Fast two-lane motorway. A road joining it mid-way is an entrance/exit (+$80)' },
  tram: { ic: '🚋', name: 'Tram', cost: '$25', tip: 'Lay tram track, or drag over a road to add street track' },
  rail: { ic: '🛤️', name: 'Railway', cost: '$30', tip: 'Railways cross roads straight on with a level crossing' },
  lights: { ic: '🚦', name: 'Lights', cost: '$60', tip: 'Tap a junction to add traffic lights (tap again to remove)' },
  round: { ic: ICON.round, name: 'Roundabout', cost: '$90', tip: 'Tap a junction to make a roundabout' },
  stop: { ic: '🚏', name: 'Stop', cost: '$60+', tip: 'Tap tram track for a stop ($60) or a railway for a station ($150)' },
  line: { ic: ICON.line, name: 'Line', cost: '$200+', tip: 'Tap stops in order, then Open line. Tap the first stop again for a loop' },
  erase: { ic: '🧽', name: 'Erase', cost: '½ back', tip: 'Drag over things to remove them' },
  house: { ic: '🏠', name: 'House', tip: 'Tap grass to place a house of the chosen colour' },
  dest: { ic: '🏢', name: 'Workplace', tip: 'Tap to place a 2×2 workplace of the chosen colour' },
};
function toolsFor() {
  const m = G.mode;
  if (m === 'signal' || m === 'demo') return [];
  if (m === 'puzzle') {
    const t = G.level.tools || [];
    const out = ['pan'];
    for (const k of ['road', 'motorway', 'tram', 'rail', 'lights', 'round', 'stop', 'line', 'erase']) {
      if (k === 'stop' ? t.includes('stop') || t.includes('station') : t.includes(k)) out.push(k);
    }
    return out;
  }
  const out = ['pan', 'road', 'motorway', 'tram', 'rail', 'lights', 'round', 'stop', 'line', 'erase'];
  if (G.S.sandbox) out.push('house', 'dest');
  return out;
}
function layersFor() {
  if (G.mode === 'puzzle') {
    const t = G.level.tools || [];
    return ['ground', ...(t.includes('flyover') ? ['up'] : []), ...(t.includes('tunnel') ? ['down'] : [])];
  }
  return ['ground', 'up', 'down'];
}
function buildToolbar() {
  const bar = $('toolbar');
  bar.innerHTML = '';
  toolsFor().forEach((k, i) => {
    const d = TOOLS[k];
    const b = document.createElement('button');
    b.className = 'tool'; b.dataset.tool = k;
    b.innerHTML = `<span class="ic">${d.ic}</span><b>${d.name}</b>${d.cost ? `<small>${d.cost}</small>` : ''}${i < 10 ? `<kbd>${(i + 1) % 10}</kbd>` : ''}`;
    b.title = d.tip;
    b.addEventListener('click', () => { audio.click(); setTool(G.tool === k && k !== 'pan' ? 'pan' : k); });
    bar.appendChild(b);
  });
  setTool('pan');
}
const LAYER_LABEL = { ground: '⬛ Ground', up: '🌉 Flyover', down: '🚇 Tunnel' };
function buildSubBar() {
  const sb = $('subBar');
  sb.innerHTML = '';
  const t = G.tool;
  if ((isBuild(t) || t === 'erase') && layersFor().length > 1) {
    for (const l of layersFor()) {
      const b = document.createElement('button');
      b.className = 'seg' + (G.layer === l ? ' on' : '');
      b.textContent = LAYER_LABEL[l];
      b.title = l === 'up' ? 'Build raised over other roads (Tab)' : l === 'down' ? 'Build underground, through mountains (Tab)' : 'Build on the ground (Tab)';
      b.addEventListener('click', () => { audio.click(); setLayer(l); });
      sb.appendChild(b);
    }
  } else if ((t === 'house' || t === 'dest') && G.S && G.S.sandbox) {
    T.DISTRICTS.forEach((d, i) => {
      const b = document.createElement('button');
      b.className = 'seg dot' + (G.color === i ? ' on' : '');
      b.style.setProperty('--c', d.hex);
      b.innerHTML = '<i></i>';
      b.title = `${d.name} ${d.place}`;
      b.addEventListener('click', () => { audio.click(); G.color = i; buildSubBar(); });
      sb.appendChild(b);
    });
    const g = document.createElement('button');
    g.className = 'seg' + (G.S.grow ? ' on' : '');
    g.textContent = G.S.grow ? '🌱 Growth on' : '🌱 Growth off';
    g.addEventListener('click', () => { G.S.grow = !G.S.grow; buildSubBar(); });
    sb.appendChild(g);
  }
}
function setTool(t) {
  if (!toolsFor().includes(t)) t = 'pan';
  if (G.tool === 'line' && t !== 'line') cancelLineDraft();
  G.tool = t;
  G.drag = null; G.plan = null;
  world.clearPreview();
  hideCost();
  for (const b of $('toolbar').children) b.classList.toggle('on', b.dataset.tool === t);
  if (!layersFor().includes(G.layer)) G.layer = 'ground';
  buildSubBar();
  world.setGrid(isBuild(t) || t === 'erase' || t === 'house' || t === 'dest');
  world.setXray(G.layer === 'down' && (isBuild(t) || t === 'erase'));
  world.setLines(t === 'line' || t === 'stop' || G.linesOpen);
  if (t !== 'pan') hideInspector();
  if (t === 'line') { G.lineDraft = { kind: null, stops: [] }; renderLineDraft(); }
  if (t !== 'pan' && TOOLS[t]) toast(TOOLS[t].tip, '', 2200, 'tip');
}
function setLayer(l) {
  if (!layersFor().includes(l)) return;
  G.layer = l;
  buildSubBar();
  world.setXray(l === 'down' && (isBuild(G.tool) || G.tool === 'erase'));
  if (G.drag && G.drag.type === 'build') updatePlan();
}

// ------------------------------------------------------------------ building
function extendPath(tiles, t) {
  let guard = 0;
  for (;;) {
    const last = tiles[tiles.length - 1];
    if (last.x === t.x && last.y === t.y) return;
    if (guard++ > 80) return;
    const dx = t.x - last.x, dy = t.y - last.y;
    const n = Math.abs(dx) >= Math.abs(dy) ? { x: last.x + Math.sign(dx), y: last.y } : { x: last.x, y: last.y + Math.sign(dy) };
    const prev = tiles[tiles.length - 2];
    if (prev && prev.x === n.x && prev.y === n.y) tiles.pop();
    else if (tiles.length < 70) tiles.push(n);
    else return;
  }
}
function updatePlan() {
  const d = G.drag;
  G.plan = T.planBuild(G.S, d.tiles, G.tool, G.layer);
  world.setPreview(G.S, G.plan, d.tiles, G.tool);
  if (d.tiles.length < 2) showCost('Drag to build', false);
  else if (G.plan.err) showCost(G.plan.err, true);
  else showCost(G.plan.links.length ? `${money(G.plan.cost)}${G.plan.interchanges ? ' · exit ramp' : ''}` : 'Already built', false);
}
function commitPlan() {
  const S = G.S, d = G.drag, plan = G.plan;
  world.clearPreview();
  hideCost();
  if (!plan || d.tiles.length < 2) return;
  if (plan.err) { toast(plan.err, 'bad'); audio.error(); return; }
  if (!plan.links.length) return;
  const cost = plan.cost;
  if (T.commitBuild(S, plan)) {
    audio.build();
    const last = d.tiles[d.tiles.length - 1];
    if (!S.sandbox && cost) popWorld(last.x, layerH() + 0.4, last.y, `-${money(cost)}`, 'cost');
    if (plan.interchanges) toast('Motorway entrance & exit built', 'good', 1800);
  }
}
function eraseAt(t) {
  if (!t) return;
  const key = t.x + ',' + t.y;
  if (G.drag.done.has(key)) return;
  G.drag.done.add(key);
  const r = T.eraseTile(G.S, t.x, t.y, G.layer);
  if (r === -1) { toast('Roads that came with the puzzle stay put', 'bad', 1600); audio.error(); }
  else if (r > 0) {
    audio.erase();
    if (r > 1 && !G.S.sandbox) popWorld(t.x, 0.4, t.y, `+${money(r)}`, 'money');
  }
}
function toolTap(t) {
  const S = G.S;
  if (!t) return;
  const { x, y } = t;
  switch (G.tool) {
    case 'lights': case 'round': {
      const r = T.setControl(S, x, y, G.tool);
      if (r.err) { toast(r.err, 'bad'); audio.error(); }
      else if (r.same) { T.setControl(S, x, y, 'none'); audio.erase(); toast(G.tool === 'lights' ? 'Lights removed' : 'Roundabout removed', '', 1400); }
      else { audio.build(); if (!S.sandbox) popWorld(x, 0.5, y, `-${money(G.tool === 'lights' ? T.COST.lights : T.COST.round)}`, 'cost'); }
      break;
    }
    case 'stop': {
      const r = T.placeStop(S, x, y);
      if (r.err) { toast(r.err, 'bad'); audio.error(); }
      else {
        audio.build();
        if (!S.sandbox) popWorld(x, 0.5, y, `-${money(r.stop.value)}`, 'cost');
        toast(r.stop.type === 'station' ? 'Station built. Now use the Line tool to run a train.' : 'Tram stop built. Now use the Line tool to run a tram.', 'good', 2600);
      }
      break;
    }
    case 'line': lineTap(x, y); break;
    case 'house': {
      if (!T.tileFree(S, x, y)) { toast('Pick an empty grass tile', 'bad'); audio.error(); break; }
      T.addHouse(S, x, y, G.color);
      if (!S.colors.includes(G.color)) S.colors.push(G.color);
      audio.build();
      break;
    }
    case 'dest': {
      const lot = T.destSpotOk(S, x, y);
      if (!lot) { toast('A workplace needs a free 2×2 space with a way in', 'bad'); audio.error(); break; }
      T.addDest(S, x, y, lot, G.color);
      if (!S.colors.includes(G.color)) S.colors.push(G.color);
      audio.build();
      break;
    }
    default: break;
  }
}

// ------------------------------------------------------------------ transit lines
function stopAt(x, y) {
  const S = G.S;
  for (const l of [0, 1, -1]) {
    const st = S.stops.get(T.nkey(S, x, y, l));
    if (st) return st;
  }
  return null;
}
function lineTap(x, y) {
  const S = G.S, D = G.lineDraft;
  const st = stopAt(x, y);
  if (!st) { toast('Tap a tram stop or a station (build them with the Stop tool)', 'bad'); audio.error(); return; }
  const kind = st.type === 'station' ? 'train' : 'tram';
  if (D.kind && D.kind !== kind) { toast(D.kind === 'tram' ? 'This line is for trams: pick tram stops' : 'This line is for trains: pick stations', 'bad'); audio.error(); return; }
  if (D.stops.length >= 2 && st.key === D.stops[0]) { D.stops.push(st.key); finishLine(); return; }
  if (D.stops.includes(st.key)) { toast('That stop is already on the line', 'bad'); return; }
  if (D.stops.length && !T.findTrackPath(S, [D.stops[D.stops.length - 1], st.key], kind === 'tram' ? 'tram' : 'rail')) {
    toast('No track joins this stop to the last one', 'bad'); audio.error(); return;
  }
  D.kind = kind;
  D.stops.push(st.key);
  audio.click();
  renderLineDraft();
}
function renderLineDraft() {
  const D = G.lineDraft, el = $('lineDraft');
  if (!D || G.tool !== 'line') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const cost = D.kind === 'train' ? T.COST.trainVeh : T.COST.tramVeh;
  if (!D.stops.length) { el.innerHTML = '<b>🚏 Tap the first stop of a new line</b>'; return; }
  el.innerHTML = `<b>${D.kind === 'train' ? '🚆 Train' : '🚋 Tram'} line · ${D.stops.length} stop${D.stops.length > 1 ? 's' : ''}</b>
    <button class="pbtn green" id="ldGo" ${D.stops.length < 2 ? 'disabled' : ''}>Open line ${money(cost)}</button>
    <button class="pbtn gray" id="ldX">✕</button>`;
  $('ldGo').onclick = () => finishLine();
  $('ldX').onclick = () => { cancelLineDraft(); G.lineDraft = { kind: null, stops: [] }; renderLineDraft(); };
}
function finishLine() {
  const S = G.S, D = G.lineDraft;
  if (!D || D.stops.length < 2) return;
  const r = T.createLine(S, D.kind, D.stops);
  if (r.err) { toast(r.err, 'bad'); audio.error(); }
  else {
    audio.chime();
    toast(`${D.kind === 'train' ? 'Train' : 'Tram'} line ${r.line.id} is running${r.line.loop ? ' (loop)' : ''}!`, 'good');
    if (r.line.pending) toast('Waiting for space on the track to start the vehicle…', '', 2500);
  }
  G.lineDraft = { kind: null, stops: [] };
  renderLineDraft();
  renderLines();
}
function cancelLineDraft() { G.lineDraft = null; $('lineDraft').classList.add('hidden'); }
function renderLines() {
  const el = $('linesPanel');
  if (!G.linesOpen) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const S = G.S;
  let html = '<h3>🚋 Transit lines</h3>';
  if (!S.lines.length) html += '<p>No lines yet. Lay tram track or railway, add stops with the Stop tool, then join them with the Line tool. People near a stop ride instead of driving.</p>';
  for (const L of S.lines) {
    const pax = L.veh.reduce((a, v) => a + (v.pax ? v.pax.length : 0), 0);
    let wait = 0;
    for (const k of L.stopSet) { const st = S.stops.get(k); if (st) wait += st.wait.filter((p) => p.line === L).length; }
    const cost = L.kind === 'train' ? T.COST.trainVeh : T.COST.tramVeh;
    html += `<div class="line-row" style="--c:${L.color}"><span class="sw"></span>
      <div class="info"><b>${L.kind === 'train' ? '🚆' : '🚋'} Line ${L.id}${L.loop ? ' ⟳' : ''}</b>${L.stops.length - (L.loop ? 1 : 0)} stops · ${L.veh.length + L.pending} ${L.kind === 'train' ? 'trains' : 'trams'} · ${pax} riding · ${wait} waiting</div>
      <button class="pbtn" data-add="${L.id}">+1 ${money(cost)}</button><button class="pbtn red" data-del="${L.id}">🗑</button></div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const L = S.lines.find((l) => l.id === +b.dataset.add);
    const r = L && T.addLineVehicle(S, L);
    if (r && r.err) { toast(r.err, 'bad'); audio.error(); } else { audio.build(); renderLines(); }
  }));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const L = S.lines.find((l) => l.id === +b.dataset.del);
    if (L) { T.deleteLine(S, L); audio.erase(); renderLines(); }
  }));
}

// ------------------------------------------------------------------ inspecting & riding
function pickVehicle(cx, cy) {
  const S = G.S;
  let best = null, bd = 30;
  const o = {};
  for (const v of S.vehicles) {
    if (!v.active) continue;
    const n = v.kind === 'train' ? 4 : v.kind === 'tram' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      T.vehPose(S, v, (v.len * (i + 0.5)) / n, o);
      const p = project(o.x, o.y + 0.08, o.z);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bd) { bd = d; best = v; }
    }
  }
  return best;
}
function vehLabel(v) {
  const S = G.S;
  if (v.kind === 'car') {
    const D = T.DISTRICTS[v.color % 6];
    let sub = 'Driving through town';
    if (G.mode === 'signal') sub = 'Just passing through';
    else if (v.state === 'out' && v.dest) sub = `Off to the ${T.DISTRICTS[v.dest.color].place.toLowerCase()} ${T.DISTRICTS[v.dest.color].icon}`;
    else if (v.state === 'back') sub = 'Heading home 🏠';
    if (v.wait > 3) sub += ' · stuck in traffic';
    return { icon: '🚗', title: `${D.name} car`, sub, c: D.hex };
  }
  const tr = v.kind === 'tram';
  const line = v.line && S.lines.includes(v.line) ? v.line : null;
  const pax = v.pax ? v.pax.length : 0;
  return {
    icon: tr ? '🚋' : '🚆', title: line ? `${tr ? 'Tram' : 'Train'} · line ${line.id}` : tr ? 'Tram' : 'Express train',
    sub: line ? `${pax} passenger${pax === 1 ? '' : 's'}${v.dwell > 0 ? ' · at the stop' : ''}` : 'Passing through', c: line ? line.color : tr ? '#ffc93c' : '#ef4f3a',
  };
}
function inspectAt(cx, cy) {
  const S = G.S;
  const v = pickVehicle(cx, cy);
  if (v) { showVehicle(v); return; }
  const t = tileAt(cx, cy) || tileAt(cx, cy, T.LEVEL_H[2]);
  if (!t) { hideInspector(); return; }
  const n = T.junctionAt(S, t.x, t.y);
  const b = S.bld[t.y * S.W + t.x] >= 0 ? S.bmap.get(S.bld[t.y * S.W + t.x]) : null;
  const st = stopAt(t.x, t.y);
  if (b && b.type === 'dest') {
    const D = T.DISTRICTS[b.color];
    showInspector({ icon: D.icon, c: D.hex, title: `${D.name} ${D.place}`, sub: `${b.pins} waiting · ${b.enroute} on the way · ${b.served} served${b.over > 1 ? ' · ⚠️ getting impatient!' : ''}` });
  } else if (b && b.type === 'house') {
    const D = T.DISTRICTS[b.color];
    const home = b.cars.filter((c) => c.state === 'home').length;
    showInspector({ icon: '🏠', c: D.hex, title: `${D.name} house`, sub: `${home} of ${b.cars.length} cars at home. They drive to ${D.name.toLowerCase()} workplaces.` });
  } else if (st) {
    showInspector({ icon: st.type === 'station' ? '🚉' : '🚏', title: st.type === 'station' ? 'Station' : 'Tram stop', sub: `${st.wait.length} people waiting` });
  } else if (n) {
    const kind = n.cross ? 'Level crossing' : n.ctrl === 'lights' ? 'Traffic lights' : n.ctrl === 'round' ? 'Roundabout' : 'Junction';
    const sub = n.cross ? 'Barriers drop when a train comes' : n.ctrl === 'lights' ? (n.lights && n.lights.manual ? 'Manual control: you switch the lights' : 'Automatic: switches to the busier side') : n.ctrl === 'round' ? 'Cars give way to the ring' : 'First come, first served. Add lights or a roundabout if it jams.';
    const btns = [];
    if (n.lights && G.mode !== 'signal') {
      btns.push({ label: '🔁 Switch lights', cls: '', fn: () => { T.toggleLights(S, n); audio.tap('g'); inspectAt(cx, cy); } });
      if (n.lights.manual) btns.push({ label: '🤖 Back to auto', cls: 'gray', fn: () => { T.autoLights(S, n); inspectAt(cx, cy); } });
    }
    showInspector({ icon: n.cross ? '🚧' : n.ctrl === 'lights' ? '🚦' : n.ctrl === 'round' ? '⭕' : '✳️', title: kind, sub, btns });
  } else hideInspector();
}
function showVehicle(v) {
  const L = vehLabel(v);
  showInspector({ ...L, btns: [{ label: '🎥 Ride along', cls: 'green', fn: () => startRide(v) }], veh: v });
}
function showInspector(o) {
  const el = $('inspector');
  G.inspect = o;
  el.classList.remove('hidden');
  el.innerHTML = `<button class="x" aria-label="Close">✕</button><div class="ins-head"><div class="ins-ic" style="--c:${o.c ? o.c + '33' : '#f1f5fa'}">${o.icon}</div><div><b>${o.title}</b><small>${o.sub}</small></div></div>${o.btns && o.btns.length ? '<div class="ins-btns"></div>' : ''}`;
  el.querySelector('.x').onclick = hideInspector;
  const box = el.querySelector('.ins-btns');
  for (const b of o.btns || []) {
    const btn = document.createElement('button');
    btn.className = 'pbtn ' + (b.cls || '');
    btn.textContent = b.label;
    btn.onclick = () => { audio.click(); b.fn(); };
    box.appendChild(btn);
  }
}
function hideInspector() { G.inspect = null; $('inspector').classList.add('hidden'); }

function startRide(v, hop = false) {
  if (!v || !v.active) return;
  hideInspector();
  const o = T.vehPose(G.S, v, 0, {});
  G.ride = { v, id: v.id, view: 'chase', pos: camera.position.clone(), look: new THREE.Vector3(o.x, o.y, o.z), hx: o.hx, hz: o.hz };
  $('hud').classList.add('hidden');
  $('rideHud').classList.remove('hidden');
  $('rideView').textContent = '🎥 Driver view';
  world.setGrid(false); world.clearPreview(); world.setHover(null);
  if (!hop) audio.whoosh();
}
function endRide(silent = false, msg = '') {
  if (!G.ride) return;
  const v = G.ride.v;
  const o = T.vehPose(G.S, v, 0, {});
  G.ride = null;
  $('rideHud').classList.add('hidden');
  if (G.mode && G.mode !== 'demo') $('hud').classList.remove('hidden');
  if (!silent) {
    cam.tx = o.x; cam.tz = o.z; cam.dist = Math.min(cam.dist, 12);
    if (msg) toast(msg, 'good', 2600);
    setTool(G.tool);
  }
}
function randomVehicle(kindPref) {
  const vs = G.S.vehicles.filter((v) => v.active && !v.crashed && (!kindPref || v.kind === kindPref));
  const moving = vs.filter((v) => v.v > 0.2);
  // prefer a vehicle with a good stretch of road still ahead of it
  const long = moving.filter((v) => !v.path || v.loop || v.path.length - (v.pi || 0) >= 5);
  const pool = long.length ? long : moving.length ? moving : vs;
  return pool.length ? pool[(Math.random() * pool.length) | 0] : null;
}
const rv = new THREE.Vector3(), rl = new THREE.Vector3();
function rideCamera(dt) {
  const R = G.ride, S = G.S, v = R.v;
  if (!v.active) {
    let msg = 'Ride over';
    if (v.kind === 'car' && v.state === 'parked' && v.dest) msg = `Arrived at the ${T.DISTRICTS[v.dest.color].place.toLowerCase()} ${T.DISTRICTS[v.dest.color].icon}`;
    else if (v.kind === 'car' && v.state === 'home') msg = 'Home sweet home 🏠';
    else if (G.mode === 'signal') msg = 'Made it through! 👋';
    // keep riding: hop into another vehicle with the same camera
    const next = randomVehicle(v.kind === 'car' ? null : v.kind) || randomVehicle();
    if (next) {
      const view = R.view;
      startRide(next, true);
      G.ride.view = view;
      $('rideView').textContent = view === 'driver' ? '🎥 Chase view' : '🎥 Driver view';
      toast(`${msg} · now riding the ${vehLabel(next).title.toLowerCase()}`, 'good', 2400);
      return rideCamera(dt);
    }
    endRide(false, msg);
    return updateCamera(dt);
  }
  const o = T.vehPose(S, v, 0, {});
  const k = 1 - Math.exp(-dt * 6);
  R.hx = lerp(R.hx, o.hx, k); R.hz = lerp(R.hz, o.hz, k);
  const hl = Math.hypot(R.hx, R.hz) || 1;
  const hx = R.hx / hl, hz = R.hz / hl;
  const driver = R.view === 'driver';
  const eye = v.kind === 'car' ? 0.1 : v.kind === 'tram' ? 0.15 : 0.18;
  if (driver) {
    rv.set(o.x - hx * 0.03, o.y + eye, o.z - hz * 0.03);
    rl.set(o.x + hx * 1.4, o.y + eye * 0.75, o.z + hz * 1.4);
  } else {
    const back = v.kind === 'train' ? 1.25 : v.kind === 'tram' ? 1.05 : 0.85;
    rv.set(o.x - hx * back, o.y + 0.42 + (v.kind === 'train' ? 0.1 : 0), o.z - hz * back);
    rl.set(o.x + hx * 0.9, o.y + 0.04, o.z + hz * 0.9);
  }
  const kp = 1 - Math.exp(-dt * (driver ? 30 : 7));
  R.pos.lerp(rv, kp);
  R.look.lerp(rl, 1 - Math.exp(-dt * (driver ? 30 : 10)));
  camera.position.copy(R.pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(R.look);
  setLens(driver ? 70 : 58, 0.02, 90);
  scene.fog.near = 6; scene.fog.far = 40;
  const L = vehLabel(v);
  setText('rideTitle', L.title);
  setText('rideSub', L.sub);
  setText('rideIcon', L.icon);
  $('rideIcon').style.setProperty('--c', L.c + '44');
  setText('rideSpeed', String(Math.round(v.v * 60)));
}

// ------------------------------------------------------------------ world labels
const popEls = [];
const pinEls = new Map();
const tagEls = new Map();
let sigEls = [];
const marks = [];
function clearOverlays() {
  for (const p of popEls) p.el.remove();
  popEls.length = 0;
  for (const [, el] of pinEls) el.remove();
  pinEls.clear();
  for (const [, el] of tagEls) el.remove();
  tagEls.clear();
  for (const m of marks) m.el.remove();
  marks.length = 0;
  $('sigBtns').innerHTML = '';
  sigEls = [];
}
function popWorld(x, y, z, text, cls = '') {
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.textContent = text;
  $('pops').appendChild(el);
  popEls.push({ el, x, y, z, t: 0 });
  if (popEls.length > 40) popEls.shift().el.remove();
}
function markWorld(x, z, color, life = 6) {
  const el = document.createElement('div');
  el.className = 'ping';
  el.style.setProperty('--c', color);
  $('marks').appendChild(el);
  marks.push({ el, x, z, t: 0, life });
}
function buildSigButtons() {
  const S = G.S;
  $('sigBtns').innerHTML = '';
  sigEls = [];
  if (G.mode !== 'signal') return;
  for (const L of world.lamps) {
    if (L.type !== 'sig') continue;
    const N = S.nodes[L.key];
    const el = document.createElement('button');
    el.className = 'sig-btn';
    el.setAttribute('aria-label', 'Traffic light');
    const [dx, dz] = T.DIRS[L.side];
    const [tx, tz] = T.DIRS[T.opp(L.side)];
    const wx = N.x + dx * (N.R + 0.95) + -tz * 0.5, wz = N.y + dz * (N.R + 0.95) + tx * 0.5;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      audio.unlock();
      if (!G.started) return;
      const st = T.tapSignal(S, L.key, L.side);
      audio.tap(st);
    });
    $('sigBtns').appendChild(el);
    sigEls.push({ el, key: L.key, side: L.side, x: wx, z: wz, st: '' });
  }
}
function updateOverlays(dt) {
  const S = G.S;
  if (!S) return;
  const hideAll = !!G.ride || G.mode === 'demo';
  $('worldUi').style.display = hideAll ? 'none' : '';
  if (hideAll) return;
  const sc = clamp(16 / cam.dist, 0.55, 1.15);
  // destination pins
  const live = new Set();
  for (const d of S.dests) {
    live.add(d.id);
    let el = pinEls.get(d.id);
    if (!el) {
      const D = T.DISTRICTS[d.color];
      el = document.createElement('div');
      el.className = 'pin';
      el.style.setProperty('--c', D.hex);
      el.innerHTML = `<div class="badge">${D.icon}<i class="ring"></i></div><div class="dots"></div>`;
      $('pins').appendChild(el);
      el._dots = el.querySelector('.dots'); el._n = -1;
      pinEls.set(d.id, el);
    }
    const tall = [0.46, 1.18, 0.5, 0.6, 0.62, 0.92][d.color] + 0.5;
    const p = project(d.x + 0.5, tall, d.lot.y === d.y ? d.y + 1 : d.y);
    el.style.display = p.on ? '' : 'none';
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
    const n = Math.min(T.PIN_CAP, d.pins);
    if (n !== el._n) { el._n = n; el._dots.innerHTML = '<i></i>'.repeat(n); el.classList.toggle('busy', n >= T.PIN_CAP - 2); }
    const ov = d.over / T.OVER_T;
    el.style.setProperty('--p', ov.toFixed(3));
    el.classList.toggle('over', ov > 0.02);
  }
  for (const [id, el] of pinEls) if (!live.has(id)) { el.remove(); pinEls.delete(id); }
  // people waiting at stops
  const liveS = new Set();
  for (const st of S.stops.values()) {
    if (!st.wait.length) continue;
    liveS.add(st.key);
    let el = tagEls.get(st.key);
    if (!el) { el = document.createElement('div'); el.className = 'stop-tag'; $('stopTags').appendChild(el); tagEls.set(st.key, el); }
    const p = project(st.x, T.LEVEL_H[st.lvl + 1] + 0.45, st.y);
    el.style.display = p.on ? '' : 'none';
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${sc.toFixed(3)}) translate(-50%, -50%)`;
    const txt = `🧍 ${st.wait.length}`;
    if (el.textContent !== txt) el.textContent = txt;
  }
  for (const [k, el] of tagEls) if (!liveS.has(k)) { el.remove(); tagEls.delete(k); }
  // line draft markers
  const D = G.tool === 'line' && G.lineDraft;
  const want = D ? D.stops : [];
  const mk = $('marks');
  mk.querySelectorAll('.mark').forEach((e, i) => { if (i >= want.length) e.remove(); });
  want.forEach((k, i) => {
    let e = mk.querySelectorAll('.mark')[i];
    if (!e) { e = document.createElement('div'); e.className = 'mark'; mk.appendChild(e); }
    const info = T.keyInfo(S, k);
    const p = project(info.x, T.LEVEL_H[info.lvl + 1] + 0.3, info.y);
    e.style.transform = `translate(${p.x}px, ${p.y}px)`;
    e.textContent = i === want.length - 1 && i > 0 && k === want[0] ? '⟳' : String(i + 1);
  });
  // pings
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    m.t += dt;
    if (m.t > m.life) { m.el.remove(); marks.splice(i, 1); continue; }
    const p = project(m.x, 0.3, m.z);
    m.el.style.left = p.x + 'px'; m.el.style.top = p.y + 'px';
  }
  // floating numbers
  for (let i = popEls.length - 1; i >= 0; i--) {
    const P = popEls[i];
    P.t += dt;
    if (P.t > 1.3) { P.el.remove(); popEls.splice(i, 1); continue; }
    const p = project(P.x, P.y + P.t * 0.5, P.z);
    const a = P.t < 1 ? 1 : 1 - (P.t - 1) / 0.3;
    const s = P.t < 0.15 ? 0.6 + P.t * 2.6 : 1;
    P.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(2)})`;
    P.el.style.opacity = a.toFixed(2);
  }
  // traffic light buttons (signal levels)
  for (const b of sigEls) {
    const N = S.nodes[b.key];
    const st = N && N.sig ? N.sig[b.side] : 'r';
    if (st !== b.st) { b.st = st; b.el.className = 'sig-btn ' + st; }
    const p = project(b.x, 0.05, b.z);
    // size the button to the road: about 2/3 of a tile on screen
    const q = project(b.x + 1, 0.05, b.z);
    const k = clamp((Math.hypot(q.x - p.x, q.y - p.y) * 0.66) / 46, 0.58, 1.1);
    b.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${k.toFixed(3)})`;
  }
}

// ------------------------------------------------------------------ events from the sim
function handleEvents(S) {
  if (G.mode === 'demo') { S.events.length = 0; return; }
  for (const e of S.events) {
    switch (e.t) {
      case 'trip':
        audio.coin(e.transit);
        if (e.pay && !S.sandbox) popWorld(e.x, 0.6, e.y, `+${money(e.pay)}`, 'money');
        else popWorld(e.x, 0.6, e.y, e.transit ? '🚋✓' : '✓', 'money');
        break;
      case 'bell': audio.bell(); break;
      case 'horn': audio.horn(); if (G.mode === 'signal') toast('🚆 Train coming! Keep the crossing clear', 'bad', 1800); break;
      case 'tow': if (performance.now() - (G.towT || 0) > 20000) { G.towT = performance.now(); toast('🛻 A stuck car was towed home. Check for jams!', '', 2600); } break;
      case 'msg': toast(e.msg, 'bad'); break;
      case 'day':
        toast(`☀️ Day ${e.day}${e.upkeep ? ` · road upkeep ${money(-e.upkeep)}` : ''}`, '', 3000);
        autosave();
        break;
      case 'newColor': {
        const D = T.DISTRICTS[e.color];
        audio.chime();
        toast(`New district: ${D.icon} ${D.name} ${D.place}!`, 'good', 3500);
        if (e.x != null) { markWorld(e.x + 0.5, e.y + 0.5, D.hex); }
        break;
      }
      case 'newDest': {
        const D = T.DISTRICTS[e.color];
        markWorld(e.x + 0.5, e.y + 0.5, D.hex, 4);
        toast(`A new ${D.place.toLowerCase()} ${D.icon} opened`, '', 2200);
        break;
      }
      case 'expand': audio.whoosh(); toast('🗺️ The town grew: new land to build on!', 'good', 3000); break;
      case 'pass': audio.pass(); break;
      case 'crash':
        audio.crash();
        popWorld(e.x, 0.4, e.y, '💥', 'big');
        G.shake = 0.35;
        break;
      case 'gaveup': audio.angry(); popWorld(e.x, 0.4, e.y, '😡', 'big'); break;
      case 'over': audio.lose(); setTimeout(() => cityOver(), 900); break;
      case 'win': audio.win(); setTimeout(() => levelDone(true), 700); break;
      case 'lose': audio.lose(); setTimeout(() => levelDone(false), 900); break;
      default: break;
    }
  }
  S.events.length = 0;
}

// ------------------------------------------------------------------ results
function starsHtml(n) { return `<div class="big-stars">${[0, 1, 2].map((i) => (i < n ? '<span class="s">★</span>' : '<span>★</span>')).join('')}</div>`; }
function levelDone(win) {
  const S = G.S;
  if (!S || (G.mode !== 'puzzle' && G.mode !== 'signal')) return;
  const list = G.mode === 'puzzle' ? PUZZLES : SIGNAL_LEVELS;
  const L = G.level, idx = list.indexOf(L);
  const store = G.mode === 'puzzle' ? save.puzzles : save.signals;
  let html;
  if (win) {
    const stars = G.mode === 'puzzle' ? T.puzzleStars(S) : T.signalStars(S);
    store[L.id] = Math.max(store[L.id] || 0, stars);
    persist();
    const stat = G.mode === 'puzzle'
      ? `<div class="stats"><div><small>Spent</small><b>${money(L.budget - S.money)}</b></div><div><small>Par</small><b>${money(L.par)}</b></div><div><small>Trips</small><b>${S.trips}</b></div></div>`
      : `<div class="stats"><div><small>Through</small><b>${S.passed}</b></div><div><small>Strikes</small><b>${S.strikes}</b></div><div><small>Time</small><b>${Math.round(S.elapsed)}s</b></div></div>`;
    html = `<h2>${G.mode === 'puzzle' ? 'Puzzle solved!' : 'Traffic tamed!'}</h2>${starsHtml(stars)}${stat}
      ${G.mode === 'puzzle' && stars < 3 ? `<p>Spend ${money(L.par)} or less for three stars.</p>` : ''}
      <div class="btns">${idx < list.length - 1 ? '<button class="pbtn green" id="rNext">Next level ▶</button>' : ''}<button class="pbtn gray" id="rRetry">↻ Retry</button><button class="pbtn gray" id="rLevels">Levels</button></div>`;
  } else {
    const why = G.mode === 'puzzle' ? (S.gameOver ? S.gameOver.reason : 'Out of time') : 'Too many crashes and angry drivers';
    html = `<h2>${G.mode === 'puzzle' ? 'Gridlock!' : 'Oh no!'}</h2><p>${why}.</p>
      ${G.mode === 'puzzle' ? '<p>Tip: every house has two cars. Short, direct routes and fewer junctions help.</p>' : '<p>Tip: only let one direction go at a time, and give turning cars a gap.</p>'}
      <div class="btns"><button class="pbtn green" id="rRetry">↻ Try again</button><button class="pbtn gray" id="rLevels">Levels</button></div>`;
  }
  openModal(html);
  const go = (fn) => () => { audio.click(); closeModal(); fn(); };
  if ($('rNext')) $('rNext').onclick = go(() => (G.mode === 'puzzle' ? startPuzzle(list[idx + 1]) : startSignal(list[idx + 1])));
  $('rRetry').onclick = go(() => (G.mode === 'puzzle' ? startPuzzle(L) : startSignal(L)));
  $('rLevels').onclick = go(() => (G.mode === 'puzzle' ? showPuzzles() : showSignals()));
}
function cityOver() {
  const S = G.S;
  if (!S || G.mode !== 'city' || !S.gameOver) return;
  const def = G.def;
  const days = T.dayOf(S) - Math.floor(S.t0 / T.DAY) + 1;
  const best = Math.max(save.best[def.id] || 0, S.trips);
  const isBest = S.trips > (save.best[def.id] || 0);
  save.best[def.id] = best;
  delete save.cities[def.id];
  persist();
  const d = S.dests.find((x) => x.id === S.gameOver.dest);
  if (d) flyTo(d.x + 0.5, d.y + 0.5, 10);
  openModal(`<h2>City jammed!</h2><p>${S.gameOver.reason}.</p>
    <div class="stats"><div><small>Trips</small><b>${S.trips}</b></div><div><small>Days</small><b>${days}</b></div><div><small>Best</small><b>${best}</b></div></div>
    ${isBest ? '<p>🏆 New best for this map!</p>' : ''}
    <div class="btns"><button class="pbtn green" id="oAgain">↻ New city</button><button class="pbtn gray" id="oMenu">Menu</button></div>`);
  $('oAgain').onclick = () => { audio.click(); startCity(def, null); };
  $('oMenu').onclick = () => { audio.click(); quitToMenu(); };
}
function autosave() {
  const S = G.S;
  if (!S || G.mode !== 'city' || S.gameOver || !G.def) return;
  try {
    const data = T.saveCity(S);
    if (S.sandbox) save.sandbox[G.def.id] = data; else save.cities[G.def.id] = data;
    save.best[G.def.id] = Math.max(save.best[G.def.id] || 0, S.sandbox ? 0 : S.trips);
    persist();
  } catch { /* never let saving break the game */ }
}

// ------------------------------------------------------------------ menus
function hideScreens() { for (const id of ['title', 'pick']) $(id).classList.add('hidden'); }
function showTitle() {
  hideScreens();
  closeModal();
  $('title').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('rideHud').classList.add('hidden');
  const ps = Object.values(save.puzzles).reduce((a, b) => a + b, 0), ss = Object.values(save.signals).reduce((a, b) => a + b, 0);
  $('mPuzStars').textContent = `★ ${ps}/${PUZZLES.length * 3}`;
  $('mSigStars').textContent = `★ ${ss}/${SIGNAL_LEVELS.length * 3}`;
  const anyCity = Object.keys(save.cities).length;
  $('mCityBest').textContent = anyCity ? '▶ Continue' : '';
  $('mSound').textContent = save.settings.sound ? '🔊 Sound on' : '🔇 Sound off';
  $('mQuality').textContent = save.settings.quality === 'high' ? '✨ High detail' : '⚡ Fast mode';
  if (G.mode !== 'demo') startDemo();
}
function quitToMenu() {
  autosave();
  closeModal();
  hideBanner();
  showTitle();
}
function showPick(title, sub, cards) {
  hideScreens();
  $('pick').classList.remove('hidden');
  $('pickTitle').textContent = title;
  $('pickSub').textContent = sub;
  const grid = $('pickGrid');
  grid.innerHTML = '';
  for (const c of cards) grid.appendChild(c);
}
function card(html, onClick) {
  const b = document.createElement(onClick ? 'button' : 'div');
  b.className = 'pcard';
  b.innerHTML = html;
  if (onClick) b.addEventListener('click', () => { audio.unlock(); audio.click(); onClick(); });
  return b;
}
function mapThumb(def) {
  const c = document.createElement('canvas');
  c.width = def.W; c.height = def.H;
  const g = c.getContext('2d');
  const { terrain, trees } = def.gen();
  for (let y = 0; y < def.H; y++) for (let x = 0; x < def.W; x++) {
    const t = terrain[y * def.W + x];
    g.fillStyle = t === 1 ? '#4cc6f5' : t === 2 ? '#b9aec9' : trees[y * def.W + x] ? '#7cc243' : (x + y) & 1 ? '#8edb5c' : '#86d455';
    g.fillRect(x, y, 1, 1);
  }
  c.style.imageRendering = 'pixelated';
  return c;
}
function showCities(sandbox = false) {
  const cards = CITY_MAPS.map((def) => {
    const data = sandbox ? save.sandbox[def.id] : save.cities[def.id];
    const best = save.best[def.id];
    const el = card(`<div class="thumb"></div><b>${def.name}</b><small>${def.blurb}</small>
      ${!sandbox && best ? `<small>🏆 Best: ${best} trips</small>` : ''}
      <div class="row"></div>`);
    el.querySelector('.thumb').appendChild(mapThumb(def));
    const row = el.querySelector('.row');
    const btn = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'pbtn ' + cls; b.textContent = label; b.onclick = () => { audio.unlock(); audio.click(); fn(); }; row.appendChild(b); };
    if (data) {
      const day = Math.floor(data.time / T.DAY) - Math.floor(data.t0 / T.DAY) + 1;
      btn(`▶ Continue (day ${day})`, 'green', () => startCity(def, data, sandbox));
    }
    if (sandbox) {
      btn(data ? 'New town' : '🏘️ Start a town', data ? 'gray' : '', () => startCity(def, null, true));
      btn('🌾 Empty land', 'gray', () => startCity(def, null, true, { empty: true }));
    } else btn(data ? 'New city' : '▶ Play', data ? 'gray' : '', () => startCity(def, null, false));
    return el;
  });
  showPick(sandbox ? 'Sandbox' : 'City', sandbox ? 'Unlimited money, the whole map open, and nothing can go wrong. Build anything.' : 'Connect homes to workplaces of the same colour. The town keeps growing; keep it from jamming.', cards);
}
function showPuzzles() {
  const cards = PUZZLES.map((P, i) => {
    const s = save.puzzles[P.id] || 0;
    const tools = (P.tools || []).filter((t) => t !== 'erase').map((t) => `<span>${t}</span>`).join('');
    return card(`<span class="num">${i + 1}</span><b>${P.name}</b><div class="stars">${[0, 1, 2].map((k) => (k < s ? '<span class="s">★</span>' : '★')).join('')}</div>
      <small>${P.hint}</small><div class="tags"><span>💰 ${money(P.budget)}</span><span>🎯 ${P.goal} trips</span>${tools}</div>`, () => startPuzzle(P));
  });
  showPick('Road Puzzles', 'Fixed budget, set tools. Deliver the trips without overflowing. Spend at par or less for ★★★.', cards);
}
function showSignals() {
  const cards = SIGNAL_LEVELS.map((L, i) => {
    const s = save.signals[L.id] || 0;
    const extra = [L.trams ? '<span>🚋 trams</span>' : '', L.rails ? '<span>🚆 trains</span>' : ''].join('');
    return card(`<span class="num">${i + 1}</span><b>${L.name}</b><div class="stars">${[0, 1, 2].map((k) => (k < s ? '<span class="s">★</span>' : '★')).join('')}</div>
      <small>${L.hint}</small><div class="tags"><span>🎯 ${L.goal} through</span>${extra}</div>`, () => startSignal(L));
  });
  showPick('Signal Levels', 'You are the traffic lights. Tap: red → yellow (one car) → green → red. Crashes and angry drivers cost a life.', cards);
}
function showHelp() {
  openModal(`<div class="help"><h2>How to play</h2>
    <h3>🏙️ City</h3><ul><li>Houses have two cars each. They drive to the workplace of the same colour.</li><li>Waiting dots pile up on each workplace. If one stays full too long, the city is lost.</li><li>Every trip earns money. Roads cost a little upkeep each day.</li></ul>
    <h3>🛣️ Building</h3><ul><li>Drag with a road tool across tiles. Pick <b>Flyover</b> to build raised over other roads, or <b>Tunnel</b> to go underground and through mountains.</li><li>Motorways are twice as fast. Joining a road to one mid-way makes an entrance &amp; exit.</li><li>Junctions form where roads meet. Add lights or roundabouts when they jam.</li><li>Lay tram track or railway, add stops, then join them with the Line tool. People near a stop take the tram or train.</li></ul>
    <h3>🎥 Ride along</h3><ul><li>With the Look tool, click any car, tram or train, then press Ride along. Switch to driver view for the POV.</li></ul>
    <h3>⌨️ Controls</h3><ul><li>Drag / right-drag / WASD to move and rotate · wheel or pinch to zoom · Q/E rotate · V top view</li><li>1–9 tools · Tab layer · Space pause · Esc cancel</li></ul>
    <div class="btns"><button class="pbtn green" id="hOk">Got it</button></div></div>`);
  $('hOk').onclick = () => { audio.click(); closeModal(); };
  save.helped = true; persist();
}
function openModal(html) { $('modalCard').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }
function pauseMenu() {
  if (!G.S || G.mode === 'demo') return;
  const prev = G.speed;
  G.speed = 0;
  const lvl = G.mode === 'puzzle' || G.mode === 'signal';
  openModal(`<h2>Paused</h2>
    <div class="btns" style="flex-direction:column;align-items:stretch">
      <button class="pbtn green" id="pResume">▶ Resume</button>
      ${lvl ? '<button class="pbtn" id="pRestart">↻ Restart level</button>' : ''}
      <button class="pbtn gray" id="pHelp">❓ How to play</button>
      <button class="pbtn gray" id="pSound">${save.settings.sound ? '🔊 Sound on' : '🔇 Sound off'}</button>
      <button class="pbtn red" id="pQuit">${G.mode === 'city' ? '💾 Save & quit' : '⏏ Quit'}</button>
    </div>`);
  $('pResume').onclick = () => { audio.click(); closeModal(); G.speed = G.started ? prev || 1 : 0; };
  if ($('pRestart')) $('pRestart').onclick = () => { audio.click(); closeModal(); G.mode === 'puzzle' ? startPuzzle(G.level) : startSignal(G.level); };
  $('pHelp').onclick = () => { showHelp(); };
  $('pSound').onclick = () => { toggleSound(); $('pSound').textContent = save.settings.sound ? '🔊 Sound on' : '🔇 Sound off'; };
  $('pQuit').onclick = () => { audio.click(); quitToMenu(); };
}
function toggleSound() {
  save.settings.sound = !save.settings.sound;
  audio.setEnabled(save.settings.sound);
  persist();
}
function banner(title, text, go) {
  $('bannerTitle').textContent = title;
  $('bannerText').textContent = text;
  $('bannerGo').textContent = go;
  $('banner').classList.remove('hidden');
}
function hideBanner() { $('banner').classList.add('hidden'); }

// toasts
function toast(msg, cls = '', ms = 2400, tag = '') {
  const box = $('toasts');
  if (tag) box.querySelectorAll(`[data-tag="${tag}"]`).forEach((e) => e.remove());
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  if (tag) el.dataset.tag = tag;
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}
function showCost(text, bad) {
  const el = $('costTag');
  el.classList.remove('hidden');
  el.classList.toggle('bad', !!bad);
  el.textContent = text;
  el.style.left = G.mouse.x + 'px';
  el.style.top = G.mouse.y + 'px';
}
function hideCost() { $('costTag').classList.add('hidden'); }

// ------------------------------------------------------------------ input
const ptrs = new Map();
let gesture = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (!G.S || G.mode === 'demo') return;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or stale pointer */ }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  G.mouse.x = e.clientX; G.mouse.y = e.clientY;
  if (G.ride) return;
  if (ptrs.size === 2) {
    // second finger: cancel any tool drag and switch to pan/zoom/twist
    if (G.drag && G.drag.type === 'build') { world.clearPreview(); hideCost(); }
    G.drag = null;
    gesture = gestureState();
    return;
  }
  if (ptrs.size > 2) return;
  const x = e.clientX, y = e.clientY;
  if (e.button === 2 || (e.button === 0 && e.altKey)) { G.drag = { type: 'rotate', x, y, yaw: cam.yaw, pitch: cam.pitch }; return; }
  if (e.button === 1) { G.drag = { type: 'pan', x, y, sx: x, sy: y, moved: true }; return; }
  if (e.button !== 0) return;
  const tool = G.tool;
  if (tool === 'pan' || G.mode === 'signal') { G.drag = { type: 'pan', x, y, sx: x, sy: y, moved: false }; return; }
  if (isBuild(tool)) {
    const t = tileAt(x, y, layerH());
    if (!t) { G.drag = { type: 'pan', x, y, sx: x, sy: y, moved: false }; return; }
    G.drag = { type: 'build', tiles: [t] };
    updatePlan();
    return;
  }
  if (tool === 'erase') { G.drag = { type: 'erase', done: new Set() }; eraseAt(tileAt(x, y, layerH())); return; }
  G.drag = { type: 'tap', sx: x, sy: y, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  const x = e.clientX, y = e.clientY;
  G.mouse.x = x; G.mouse.y = y;
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x, y });
  if (!G.S || G.mode === 'demo' || G.ride) return;
  if (gesture && ptrs.size >= 2) { applyGesture(); return; }
  const d = G.drag;
  if (!d) { hover(x, y); return; }
  if (d.type === 'pan') {
    if (!d.moved && Math.hypot(x - d.sx, y - d.sy) > 6) d.moved = true;
    if (d.moved) panBy(d.x, d.y, x, y);
    d.x = x; d.y = y;
  } else if (d.type === 'rotate') {
    cam.yaw = d.yaw - (x - d.x) * 0.006;
    cam.pitchUser = clamp(d.pitch + (y - d.y) * 0.004, 0.5, 1.5);
    cam.top = false;
  } else if (d.type === 'build') {
    const t = tileAt(x, y, layerH());
    if (t) {
      const n = d.tiles.length, last = d.tiles[n - 1];
      if (t.x !== last.x || t.y !== last.y) { extendPath(d.tiles, t); updatePlan(); }
      else showCost($('costTag').textContent, $('costTag').classList.contains('bad'));
    }
  } else if (d.type === 'erase') {
    eraseAt(tileAt(x, y, layerH()));
    hover(x, y);
  } else if (d.type === 'tap') {
    if (Math.hypot(x - d.sx, y - d.sy) > 8) { d.moved = true; G.drag = { type: 'pan', x, y, sx: d.sx, sy: d.sy, moved: true }; }
  }
});
function endPointer(e) {
  ptrs.delete(e.pointerId);
  if (gesture) { if (ptrs.size < 2) gesture = null; G.drag = null; return; }
  const d = G.drag;
  G.drag = null;
  if (!d || !G.S) return;
  if (d.type === 'pan' && !d.moved) inspectAt(e.clientX, e.clientY);
  else if (d.type === 'build') { G.drag = d; commitPlan(); G.drag = null; G.plan = null; }
  else if (d.type === 'tap' && !d.moved) toolTap(tileAt(e.clientX, e.clientY));
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); gesture = null; if (G.drag && G.drag.type === 'build') { world.clearPreview(); hideCost(); } G.drag = null; });
canvas.addEventListener('pointerleave', () => { if (!G.drag) world.setHover(null); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!G.S || G.mode === 'demo' || G.ride) return;
  const before = groundHit(e.clientX, e.clientY);
  cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0012), 2.5, 95);
  cam.fly = null;
  updateCamera(0);
  const after = groundHit(e.clientX, e.clientY);
  if (before && after) { cam.tx += before.x - after.x; cam.tz += before.z - after.z; }
}, { passive: false });

function panBy(x0, y0, x1, y1) {
  const a = groundHit(x0, y0), b = groundHit(x1, y1);
  if (!a || !b) return;
  cam.tx += a.x - b.x; cam.tz += a.z - b.z;
  cam.fly = null;
}
function gestureState() {
  const [p, q] = [...ptrs.values()];
  return { mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2, d: Math.hypot(p.x - q.x, p.y - q.y) || 1, a: Math.atan2(q.y - p.y, q.x - p.x) };
}
function applyGesture() {
  const g = gestureState();
  panBy(gesture.mx, gesture.my, g.mx, g.my);
  cam.dist = clamp(cam.dist * (gesture.d / g.d), 2.5, 95);
  let da = g.a - gesture.a;
  if (da > Math.PI) da -= Math.PI * 2;
  if (da < -Math.PI) da += Math.PI * 2;
  cam.yaw += da;
  gesture = g;
}
function hover(x, y) {
  const t = G.tool;
  if (t === 'pan' || G.mode === 'signal') { world.setHover(null); canvas.style.cursor = pickVehicle(x, y) ? 'pointer' : 'grab'; return; }
  canvas.style.cursor = 'crosshair';
  const tile = tileAt(x, y, layerH());
  if (!tile) { world.setHover(null); return; }
  const col = t === 'erase' ? '#ff6b6b' : t === 'lights' || t === 'round' ? (T.junctionAt(G.S, tile.x, tile.y) ? '#45f07f' : '#ffffff') : '#ffffff';
  world.setHover(tile.x, tile.y, layerH(), t === 'dest' ? 2 : 1, col);
}

addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  audio.unlock();
  const k = e.key.toLowerCase();
  if (!G.S || G.mode === 'demo') return;
  if (!$('modal').classList.contains('hidden')) { if (k === 'escape') closeModal(); return; }
  if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { cam.keys.add(k); if (k.startsWith('arrow')) e.preventDefault(); return; }
  if (k === 'escape') {
    if (G.ride) { endRide(false); return; }
    if (G.drag) { G.drag = null; world.clearPreview(); hideCost(); return; }
    if (G.tool !== 'pan') { setTool('pan'); return; }
    pauseMenu();
    return;
  }
  if (k === ' ') { e.preventDefault(); if (!G.started) { startTraffic(); return; } setSpeed(G.speed ? 0 : 1); return; }
  if (k === 'v') { cam.top = !cam.top; $('viewBtn').classList.toggle('on', cam.top); return; }
  if (k === 'c') { if (G.ride) G.ride.view = G.ride.view === 'chase' ? 'driver' : 'chase'; else startRide(randomVehicle()); return; }
  if (k === 'tab') { e.preventDefault(); const ls = layersFor(); setLayer(ls[(ls.indexOf(G.layer) + 1) % ls.length]); return; }
  if (k === '+' || k === '=') { cam.dist = clamp(cam.dist / 1.2, 2.5, 95); return; }
  if (k === '-') { cam.dist = clamp(cam.dist * 1.2, 2.5, 95); return; }
  if (/^[0-9]$/.test(k)) {
    const list = toolsFor();
    const i = k === '0' ? 9 : +k - 1;
    if (list[i]) { audio.click(); setTool(list[i]); }
  }
});
addEventListener('keyup', (e) => cam.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => cam.keys.clear());

function setSpeed(sp) {
  if (!G.started) return;
  G.speed = sp;
}
function startTraffic() {
  G.started = true;
  G.speed = 1;
  hideBanner();
  audio.click();
}

// ------------------------------------------------------------------ buttons
$('bannerGo').addEventListener('click', () => { audio.unlock(); startTraffic(); });
for (const b of $('speedBox').children) b.addEventListener('click', () => {
  audio.click();
  if (!G.started) { startTraffic(); return; }
  setSpeed(+b.dataset.sp);
});
$('menuBtn').addEventListener('click', () => { audio.click(); pauseMenu(); });
$('viewBtn').addEventListener('click', () => { audio.click(); cam.top = !cam.top; $('viewBtn').classList.toggle('on', cam.top); });
$('rideBtn').addEventListener('click', () => {
  audio.click();
  const v = randomVehicle();
  if (v) startRide(v); else toast('No vehicles on the move yet', '', 1800);
});
$('linesBtn').addEventListener('click', () => {
  audio.click();
  G.linesOpen = !G.linesOpen;
  $('linesBtn').classList.toggle('on', G.linesOpen);
  world.setLines(G.linesOpen || G.tool === 'line' || G.tool === 'stop');
  renderLines();
});
$('rideView').addEventListener('click', () => {
  audio.click();
  if (!G.ride) return;
  G.ride.view = G.ride.view === 'chase' ? 'driver' : 'chase';
  $('rideView').textContent = G.ride.view === 'chase' ? '🎥 Driver view' : '🎥 Chase view';
});
$('rideNext').addEventListener('click', () => {
  audio.click();
  if (!G.ride) return;
  const view = G.ride.view;
  const v = randomVehicle();
  if (v && v !== G.ride.v) { endRide(true); startRide(v); G.ride.view = view; $('rideView').textContent = view === 'chase' ? '🎥 Driver view' : '🎥 Chase view'; }
});
$('rideExit').addEventListener('click', () => { audio.click(); endRide(false); });
$('mCity').addEventListener('click', () => { audio.unlock(); audio.click(); showCities(false); });
$('mPuz').addEventListener('click', () => { audio.unlock(); audio.click(); showPuzzles(); });
$('mSig').addEventListener('click', () => { audio.unlock(); audio.click(); showSignals(); });
$('mSand').addEventListener('click', () => { audio.unlock(); audio.click(); showCities(true); });
$('mSound').addEventListener('click', () => { audio.unlock(); toggleSound(); audio.click(); showTitle(); });
$('mQuality').addEventListener('click', () => { audio.click(); save.settings.quality = save.settings.quality === 'high' ? 'low' : 'high'; persist(); applyQuality(); showTitle(); });
$('mHelp').addEventListener('click', () => { audio.unlock(); audio.click(); showHelp(); });
$('pickBack').addEventListener('click', () => { audio.click(); showTitle(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
addEventListener('pagehide', autosave);

// ------------------------------------------------------------------ lighting through the day (city)
const DUSK = new THREE.Color('#ffb27a'), NIGHT = new THREE.Color('#8fa6ff'), DAYC = new THREE.Color('#fff4e2');
const SKY_N = new THREE.Color('#6f86c4'), SKY_D = new THREE.Color('#ffc9a3');
const tmpC = new THREE.Color();
function lighting() {
  const S = G.S;
  let night = 0, dusk = 0;
  if (S && G.mode === 'city') {
    const h = T.hourOf(S);
    if (h >= 18 && h < 21) dusk = 1 - Math.abs(h - 19.2) / 1.8;
    if (h >= 5 && h < 7.5) dusk = Math.max(dusk, 1 - Math.abs(h - 6.2) / 1.3);
    night = h >= 20.5 || h < 5 ? 1 : h >= 19 && h < 20.5 ? (h - 19) / 1.5 : h >= 5 && h < 6.5 ? 1 - (h - 5) / 1.5 : 0;
    dusk = clamp(dusk, 0, 1) * (1 - night * 0.6);
  }
  tmpC.copy(DAYC).lerp(DUSK, dusk * 0.8).lerp(NIGHT, night * 0.85);
  sun.color.copy(tmpC);
  sun.intensity = 2.1 - night * 1.15 - dusk * 0.3;
  hemi.intensity = 1.35 - night * 0.55;
  tmpC.copy(SKY).lerp(SKY_D, dusk * 0.6).lerp(SKY_N, night * 0.8);
  scene.background.copy(tmpC);
  scene.fog.color.copy(tmpC);
}

// ------------------------------------------------------------------ main loop
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  tick(now);
}
function tick(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  const S = G.S;
  if (S) {
    const sp = G.mode === 'demo' ? 1 : G.speed;
    if (sp > 0 && !S.gameOver && !S.result && $('modal').classList.contains('hidden')) {
      const total = dt * sp;
      const n = Math.max(1, Math.ceil(total / (1 / 40)));
      for (let i = 0; i < n; i++) T.step(S, total / n);
    }
    if (G.mode === 'demo' && (S.result || S.gameOver)) startDemo();
    handleEvents(S);
    world.update(S, dt, { hideId: G.ride && G.ride.view === 'driver' ? G.ride.id : -1 });
    if (G.mode === 'city' && !S.sandbox) {
      G.saveT += dt;
      if (G.saveT > 25) { G.saveT = 0; autosave(); }
      if (S.dests.some((d) => d.over > 8)) audio.warn();
    }
    if (G.linesOpen && ((G.linesT = (G.linesT || 0) + dt) > 1)) { G.linesT = 0; renderLines(); }
    audio.traffic(G.mode === 'demo' ? 0 : S.vehicles.length);
  }
  updateCamera(dt);
  if (G.shake > 0) {
    G.shake -= dt;
    const a = G.shake * 0.25;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
  }
  updateOverlays(dt);
  updateHud();
  lighting();
  renderer.render(scene, camera);
}

showTitle();
requestAnimationFrame(frame);
if (!save.helped) setTimeout(() => { if (!$('title').classList.contains('hidden')) $('mHelp').classList.add('pulse'); }, 1500);
// handle for poking at the game from the dev tools console (dev server only)
if (import.meta.env && import.meta.env.DEV) window.__cc = { G, T, cam, camera, project, world, frame: (ms = 16) => { lastT = performance.now() - ms; tick(performance.now()); }, startPuzzle, startSignal, startCity, startRide, PUZZLES, SIGNAL_LEVELS, CITY_MAPS };
