import * as THREE from 'three';
import { SkyEvents } from './tetris-sky.js';

// ================================================================ constants
const W = 10;            // well width
const H = 18;            // well height: the "sky line" is at row H
const ROWS = H + 5;      // board rows, including the sky above the line
const BEST_KEY = 'tetris-best-v1';

const COLORS = { I: '#4fd6f5', O: '#ffd23f', T: '#b36bff', S: '#7ee04e', Z: '#ff5f57', J: '#4d96ff', L: '#ff8a3d' };
const SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};
const TYPES = Object.keys(SHAPES);
const KICKS = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, 1], [-1, 1], [1, 1]];
const LINE_POINTS = [0, 100, 300, 500, 800];
const LINE_NAMES = ['', 'Nice!', 'Double!', 'Triple!', 'TETRIS!'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const cx = (x) => x + 0.5 - W / 2;   // board column -> world x
const cy = (y) => y + 0.5;           // board row -> world y

const rotateCW = (m) => m.map((_, r) => m.map((__, c) => m[m.length - 1 - c][r]));
const rotateCCW = (m) => m.map((_, r) => m.map((__, c) => m[c][m.length - 1 - r]));

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
    if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei ?? 0.5; }
    if (o.opacity !== undefined && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
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
};
function mk(parent, g, color, pos = [0, 0, 0], o = {}) {
  const m = new THREE.Mesh(g, toon(color, o));
  m.position.set(pos[0], pos[1], pos[2]);
  if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
  if (o.scale) m.scale.set(o.scale[0], o.scale[1], o.scale[2]);
  m.castShadow = true;
  m.receiveShadow = !!o.receive;
  if (o.outline !== false) addOutline(m, o.outline || 1.08);
  parent.add(m);
  return m;
}
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

// ================================================================ audio (synthesised)
class Sfx {
  constructor() {
    this.ctx = null;
    this.on = true;
    try { this.on = JSON.parse(localStorage.getItem('tetris-sound-v1')) !== false; } catch { /* blocked */ }
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
    try { localStorage.setItem('tetris-sound-v1', JSON.stringify(this.on)); } catch { /* blocked */ }
    return this.on;
  }
  tone(f0, f1, dur, type = 'square', vol = 0.25, delay = 0) {
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
  move() { this.tone(300, 260, 0.04, 'square', 0.08); }
  rotate() { this.tone(420, 640, 0.07, 'square', 0.12); }
  hold() { this.tone(500, 350, 0.1, 'triangle', 0.2); }
  lock() { this.tone(140, 70, 0.1, 'sine', 0.35); this.noise(0.08, 0.15, 500); }
  drop() { this.tone(260, 50, 0.16, 'sawtooth', 0.25); this.noise(0.15, 0.3, 700); }
  clear(n) {
    this.noise(0.45, 0.5, 1200); this.tone(110, 40, 0.4, 'sawtooth', 0.3);
    [523, 659, 784, 1047].slice(0, 2 + n).forEach((f, i) => this.tone(f, f * 1.01, 0.14, 'square', 0.18, 0.05 + i * 0.07));
  }
  level() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, f, 0.1, 'triangle', 0.22, i * 0.06)); }
  over() { this.noise(0.6, 0.4, 500); [400, 330, 260, 190].forEach((f, i) => this.tone(f, f * 0.9, 0.3, 'sawtooth', 0.22, i * 0.18)); }
  click() { this.tone(520, 700, 0.06, 'square', 0.12); }
  boom() { this.noise(0.7, 0.35, 380); this.tone(90, 30, 0.6, 'sawtooth', 0.3); }
}

// ================================================================ the game
class Tetris {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.sfx = new Sfx();
    this.best = this.loadBest();
    this.guide = true;   // the ghost outline showing where the piece will land; off = hard mode
    try { this.guide = JSON.parse(localStorage.getItem('tetris-guide-v1')) !== false; } catch { /* blocked */ }
    this.state = 'menu';
    this.clock = 0;
    this.shake = 0;
    this.bits = [];
    this.flashes = [];
    this.setupScene();
    this.gradient = gradient;
    this.buildWorld();
    this.buildWell();
    this.sky = new SkyEvents(this);
    this.bindUI();
    this.bindInput();
    this.resetGame();
    this.state = 'menu';
    this.showScreen('menu');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------- scene
  setupScene() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.$('stage').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // vertical sky gradient: the horizon sits exactly mid-screen because the camera looks level
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 512;
    const c = cv.getContext('2d');
    const grad = c.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#241545'); grad.addColorStop(0.2, '#4a2a6e'); grad.addColorStop(0.38, '#b95a86');
    grad.addColorStop(0.5, '#ffb98a'); grad.addColorStop(1, '#ffb98a');
    c.fillStyle = grad; c.fillRect(0, 0, 4, 512);
    const sky = new THREE.CanvasTexture(cv); sky.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(0xffb98a, 50, 260);

    this.scene.add(new THREE.HemisphereLight(0xffe4cc, 0x8a3d33, 1.5));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(-16, 26, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 30; sc.bottom = -14; sc.near = 1; sc.far = 100;
    sun.shadow.bias = -0.0015;
    this.scene.add(sun, sun.target);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);
    this.camY = H / 2;
    this.camDist = 40;
    this.camX = 0;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight, a = w / h;
    this.renderer.setSize(w, h);
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const extentH = H + 10;
    const targetW = a < 1 ? 19 : 15;
    this.camDist = Math.max(extentH / 2 / t, targetW / 2 / (t * a));
    this.visAz = THREE.MathUtils.radToDeg(Math.atan(t * a));   // half the horizontal field of view
  }

  buildWorld() {
    const world = new THREE.Group();
    this.scene.add(world);
    this.world = world;
    const rng = rngFor(77);

    // Mars ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshToonMaterial({ color: '#c9573a', gradientMap: gradient }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    world.add(ground);

    // craters
    for (let i = 0; i < 38; i++) {
      const r = 1.5 + rng() * 6;
      const x = (rng() - 0.5) * 150, z = -rng() * 110 + 12;
      if (Math.abs(x) < r + 8 && z > -r - 4 && z < r + 6) continue;
      const d = new THREE.Mesh(geo.cyl(r, r, 0.02, 18), toon('#b2452e'));
      d.position.set(x, 0.01, z); d.receiveShadow = true;
      world.add(d);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.18, 5, 22), toon('#e07a56'));
      rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.05, z); rim.scale.set(1, 1, 0.5);
      world.add(rim);
    }
    // rocks
    for (let i = 0; i < 90; i++) {
      const x = (rng() - 0.5) * 140, z = 22 - rng() * 100;
      if (Math.abs(x) < 9 && z > -40) continue;
      const s = 0.3 + Math.pow(rng(), 2) * 2.2;
      mk(world, geo.ico(s), ['#a8472f', '#b9553a', '#8f3b2c'][i % 3], [x, s * 0.35, z], { scale: [1.2, 0.7, 1], rot: [rng(), rng() * 3, rng()], outline: 1.06, receive: true });
    }
    // distant mesas and mountains (fogged into the horizon)
    for (let i = 0; i < 26; i++) {
      const x = (i / 25 - 0.5) * 380 + (rng() - 0.5) * 20, z = -95 - rng() * 70;
      const r = 12 + rng() * 22, h = 8 + rng() * 22;
      if (rng() > 0.45) mk(world, geo.cone(r, h, 5), '#9a4430', [x, h / 2, z], { rot: [0, rng() * 3, 0], outline: 1.03 });
      else {
        mk(world, geo.cyl(r * 0.7, r, h * 0.7, 7), '#a54e36', [x, h * 0.35, z], { outline: 1.03 });
        mk(world, geo.cyl(r * 0.72, r * 0.72, 1.2, 7), '#c46a48', [x, h * 0.7 + 0.5, z], { outline: 1.04 });
      }
    }
    // habitat domes and antennas
    this.beacons = [];
    for (const [x, z, r] of [[-24, -14, 4], [30, -22, 5.5], [-46, -34, 6], [48, -8, 3.2]]) {
      const base = mk(world, geo.cyl(r * 1.05, r * 1.15, 0.8, 14), '#f4efe6', [x, 0.4, z], { receive: true });
      const dome = new THREE.Mesh(geo.dome(r), new THREE.MeshToonMaterial({ color: '#8fe9ff', gradientMap: gradient, transparent: true, opacity: 0.78 }));
      dome.position.set(x, 0.8, z); dome.castShadow = true; addOutline(dome, 1.03);
      world.add(dome);
      mk(world, geo.cyl(r * 0.15, r * 0.15, r * 0.5, 6), '#f4efe6', [x + r * 0.3, 0.8 + r * 0.25, z], { outline: 1.1 });
      base.receiveShadow = true;
    }
    for (const [x, z] of [[-14, -6], [17, -11], [-34, -16]]) {
      mk(world, geo.cyl(0.08, 0.14, 7, 5), '#e9e4da', [x, 3.5, z], { outline: 1.15 });
      const lamp = mk(world, geo.sphere(0.22, 8, 6), '#ff5f57', [x, 7.1, z], { emissive: '#ff2d2d', ei: 1, outline: 1.2 });
      this.beacons.push(lamp);
    }
    // a tiny rover patrolling the foreground
    const rover = new THREE.Group();
    mk(rover, geo.box(2.2, 0.7, 1.3), '#f4efe6', [0, 0.95, 0]);
    mk(rover, geo.box(1.0, 0.5, 0.9), '#4d96ff', [-0.3, 1.5, 0]);
    mk(rover, geo.cyl(0.05, 0.05, 0.9, 5), '#2a1f3d', [0.7, 1.9, 0.3], { outline: 1.2 });
    for (const x of [-0.8, 0, 0.8]) for (const z of [-0.75, 0.75]) mk(rover, geo.cyl(0.38, 0.38, 0.25, 10), '#3a2f4f', [x, 0.4, z], { rot: [Math.PI / 2, 0, 0] });
    world.add(rover);
    this.rover = rover;

    // sun, moons and stars live far away and ignore the fog
    const basic = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, fog: false, transparent: opacity < 1, opacity, depthWrite: false });
    const sunGlow = new THREE.Mesh(geo.sphere(34, 20, 14), basic('#ffd9a0', 0.28)); sunGlow.position.set(-90, 22, -300);
    const sunDisk = new THREE.Mesh(geo.sphere(17, 20, 14), basic('#fff3c4')); sunDisk.position.set(-90, 22, -299);
    const phobos = new THREE.Mesh(geo.ico(7, 0), new THREE.MeshToonMaterial({ color: '#b9a8b8', gradientMap: gradient, fog: false })); phobos.position.set(60, 85, -280);
    const deimos = new THREE.Mesh(geo.ico(3.6, 0), new THREE.MeshToonMaterial({ color: '#d8c8c0', gradientMap: gradient, fog: false })); deimos.position.set(-30, 120, -300);
    world.add(sunGlow, sunDisk, phobos, deimos);
    this.sunGlow = sunGlow; this.sunDisk = sunDisk;
    this.moons = [phobos, deimos];
    const sp = [];
    for (let i = 0; i < 260; i++) {
      const a = rng() * Math.PI * 2, e = 0.12 + rng() * 0.6; // above the horizon
      sp.push(Math.cos(a) * Math.cos(e) * 500, Math.sin(e) * 500, -Math.abs(Math.sin(a)) * Math.cos(e) * 500 - 40);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 });
    world.add(new THREE.Points(sg, this.starMat));
  }

  buildWell() {
    const g = new THREE.Group();
    this.scene.add(g);
    // floor slab + two towers
    mk(g, geo.box(W + 2, 0.6, 2.4), '#d9d3ca', [0, -0.3, 0], { receive: true, outline: 1.04 });
    mk(g, geo.box(W + 1.4, 0.12, 2.0), '#8a7f94', [0, 0.04, 0], { outline: false });
    this.towerLamps = [];
    for (const s of [-1, 1]) {
      const x = s * (W / 2 + 0.55);
      mk(g, geo.box(0.9, H + 1.2, 2.2), '#e9e4da', [x, (H + 1.2) / 2, 0], { outline: 1.03, receive: true });
      for (let i = 1; i < H; i += 3) mk(g, geo.box(0.95, 0.35, 2.25), i % 2 ? '#ff5f57' : '#ffd23f', [x, i + 0.5, 0], { outline: false });
      this.towerLamps.push(mk(g, geo.sphere(0.32, 10, 8), '#ff5f57', [x, H + 1.5, 0], { emissive: '#ff2d2d', ei: 1, outline: 1.15 }));
    }
    // translucent back wall with a faint grid
    const cv = document.createElement('canvas'); cv.width = W * 48; cv.height = ROWS * 48;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(40,25,70,0.30)'; c.fillRect(0, 0, cv.width, cv.height);
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 2;
    for (let i = 0; i <= W; i++) { c.beginPath(); c.moveTo(i * 48, 0); c.lineTo(i * 48, cv.height); c.stroke(); }
    for (let i = 0; i <= ROWS; i++) { c.beginPath(); c.moveTo(0, i * 48); c.lineTo(cv.width, i * 48); c.stroke(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, ROWS), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    back.position.set(0, ROWS / 2, -0.55);
    g.add(back);
    // the sky line: blocks above this line mean the stack has touched the sky
    for (let i = 0; i < W; i++) mk(g, geo.box(0.9, 0.12, 0.2), i % 2 ? '#ffffff' : '#ff5f57', [cx(i), H, 0.55], { outline: false });

    // active piece, ghost and preview pools
    this.pieceGroup = new THREE.Group();
    this.scene.add(this.pieceGroup);
    this.pieceMeshes = [];
    this.ghostGroup = new THREE.Group();
    this.scene.add(this.ghostGroup);
    this.ghostMeshes = [];
    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);
  }

  cube(type) {
    const m = new THREE.Mesh(geo.box(0.94, 0.94, 0.94), toon(COLORS[type], { emissive: COLORS[type], ei: 0.14 }));
    m.castShadow = true;
    addOutline(m, 1.07);
    return m;
  }

  // ---------------------------------------------------------- game state
  resetGame() {
    this.boardGroup.clear();
    this.pieceGroup.clear();
    this.ghostGroup.clear();
    this.board = Array.from({ length: ROWS }, () => Array(W).fill(null));
    this.score = 0; this.lines = 0; this.level = 1;
    this.queue = [];
    this.refillQueue();
    this.hold = null;
    this.canHold = true;
    this.cur = null;
    this.dropAcc = 0; this.lockT = 0; this.resets = 0;
    this.clearT = 0;
    this.updateHUD();
    this.drawPreviews();
    this.spawn();
  }

  refillQueue() {
    while (this.queue.length < 6) {
      const bag = [...TYPES];
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      this.queue.push(...bag);
    }
  }

  spawn(type) {
    type = type || this.queue.shift();
    this.refillQueue();
    const m = SHAPES[type].map((r) => [...r]);
    const n = m.length;
    this.cur = { type, m, x: Math.floor((W - n) / 2), y: H + 2 };
    this.vis = { x: this.cur.x, y: this.cur.y + 3 };   // enters from higher up in the sky
    this.dropAcc = 0; this.lockT = 0; this.resets = 0;
    this.buildPieceMeshes();
    this.drawPreviews();
    if (this.collide(this.cur.m, this.cur.x, this.cur.y)) this.gameOver('The stack blocked the spawn point');
  }

  buildPieceMeshes() {
    this.pieceGroup.clear(); this.ghostGroup.clear();
    this.pieceMeshes = []; this.ghostMeshes = [];
    for (let i = 0; i < 4; i++) {
      const m = this.cube(this.cur.type);
      this.pieceGroup.add(m); this.pieceMeshes.push(m);
      const gm = new THREE.Mesh(geo.box(0.94, 0.94, 0.94), new THREE.MeshBasicMaterial({ color: COLORS[this.cur.type], transparent: true, opacity: 0.22, depthWrite: false }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo.box(0.94, 0.94, 0.94)), new THREE.LineBasicMaterial({ color: COLORS[this.cur.type] }));
      gm.add(edges);
      this.ghostGroup.add(gm); this.ghostMeshes.push(gm);
    }
  }

  cells(m, px, py) {
    const out = [];
    for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) if (m[r][c]) out.push([px + c, py - r]);
    return out;
  }

  collide(m, px, py) {
    for (const [x, y] of this.cells(m, px, py)) {
      if (x < 0 || x >= W || y < 0 || y >= ROWS) return true;
      if (this.board[y][x]) return true;
    }
    return false;
  }

  ghostY() {
    let y = this.cur.y;
    while (!this.collide(this.cur.m, this.cur.x, y - 1)) y--;
    return y;
  }

  // ---------------------------------------------------------- player actions
  playing() { return this.state === 'playing' && this.cur; }

  touched() {
    // any successful move on the ground restarts the lock timer (a few times)
    if (this.collide(this.cur.m, this.cur.x, this.cur.y - 1) && this.resets < 12) { this.lockT = 0; this.resets++; }
  }

  move(dx) {
    if (!this.playing()) return;
    if (!this.collide(this.cur.m, this.cur.x + dx, this.cur.y)) { this.cur.x += dx; this.touched(); this.sfx.move(); }
  }

  rotate(dir) {
    if (!this.playing() || this.cur.type === 'O') return;
    const m = dir > 0 ? rotateCW(this.cur.m) : rotateCCW(this.cur.m);
    for (const [kx, ky] of KICKS) {
      if (!this.collide(m, this.cur.x + kx, this.cur.y + ky)) {
        this.cur.m = m; this.cur.x += kx; this.cur.y += ky; this.touched(); this.sfx.rotate();
        return;
      }
    }
  }

  softDrop() {
    if (!this.playing()) return;
    if (!this.collide(this.cur.m, this.cur.x, this.cur.y - 1)) { this.cur.y--; this.score += 1; this.dropAcc = 0; this.updateHUD(); }
  }

  hardDrop() {
    if (!this.playing()) return;
    const gy = this.ghostY();
    const dist = this.cur.y - gy;
    this.score += dist * 2;
    // speed streaks through the columns the piece passed through
    for (const [x, y] of this.cells(this.cur.m, this.cur.x, this.cur.y)) {
      const s = new THREE.Mesh(geo.box(0.7, dist + 0.2, 0.2), new THREE.MeshBasicMaterial({ color: COLORS[this.cur.type], transparent: true, opacity: 0.45, depthWrite: false }));
      s.position.set(cx(x), cy(y) - dist / 2, 0);
      this.scene.add(s);
      this.flashes.push({ mesh: s, life: 0.22, max: 0.22, kind: 'streak' });
    }
    this.cur.y = gy;
    this.vis.y = Math.min(this.vis.y, this.cur.y + 1.2);
    this.shake = Math.max(this.shake, 0.25);
    this.sfx.drop();
    this.lockPiece(true);
  }

  holdPiece() {
    if (!this.playing() || !this.canHold) return;
    const t = this.cur.type;
    const next = this.hold;
    this.hold = t;
    this.canHold = false;
    this.sfx.hold();
    this.spawn(next || undefined);
    this.canHold = false;
    this.drawPreviews();
  }

  // ---------------------------------------------------------- locking & clearing
  lockPiece(hard = false) {
    const { type, m, x, y } = this.cur;
    let sky = false;
    for (const [bx, by] of this.cells(m, x, y)) {
      const mesh = this.cube(type);
      mesh.position.set(cx(bx), cy(by), 0);
      mesh.userData.gy = by;
      this.boardGroup.add(mesh);
      this.board[by][bx] = mesh;
      if (by >= H) sky = true;
    }
    this.pieceGroup.clear(); this.ghostGroup.clear();
    this.cur = null;
    if (!hard) this.sfx.lock();
    this.dust(x + m.length / 2, y - m.length / 2, type);
    this.canHold = true;
    if (sky) { this.gameOver('The stack touched the sky'); return; }

    const full = [];
    for (let r = 0; r < ROWS; r++) if (this.board[r].every(Boolean)) full.push(r);
    if (full.length) this.clearRows(full);
    else this.spawn();
    this.updateHUD();
  }

  clearRows(rows) {
    this.state = 'clearing';
    this.clearT = 0.5;
    const n = rows.length;
    this.sfx.clear(n);
    this.shake = Math.max(this.shake, 0.3 + n * 0.22);
    for (const r of rows) {
      // blast flash across the row
      const f = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.6, 1.1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
      f.position.set(0, cy(r), 0.75);
      this.scene.add(f);
      this.flashes.push({ mesh: f, life: 0.45, max: 0.45, kind: 'flash' });
      for (let c = 0; c < W; c++) {
        const mesh = this.board[r][c];
        this.board[r][c] = null;
        // each block flies apart under Mars gravity
        const a = Math.random() * Math.PI * 2;
        this.bits.push({
          mesh, life: 1.1 + Math.random() * 0.5, max: 1.4,
          v: new THREE.Vector3((c - W / 2 + 0.5) * 0.9 + Math.cos(a) * 1.5, 3 + Math.random() * 5 + n, 3 + Math.random() * 6),
          spin: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
        });
        this.spark(cx(c), cy(r), COLORS[TYPES[Math.floor(Math.random() * 7)]], 3);
      }
    }
    // collapse: rows above fall down
    const keep = this.board.filter((_, r) => !rows.includes(r));
    while (keep.length < ROWS) keep.push(Array(W).fill(null));
    this.board = keep;
    this.board.forEach((row, r) => row.forEach((mesh) => { if (mesh) mesh.userData.gy = r; }));

    const pts = LINE_POINTS[n] * this.level;
    this.score += pts;
    this.lines += n;
    const newLevel = 1 + Math.floor(this.lines / 10);
    this.showBanner(LINE_NAMES[n] + `  +${pts}`);
    if (newLevel > this.level) { this.level = newLevel; setTimeout(() => { this.sfx.level(); this.showBanner(`Level ${this.level}!`); }, 700); }
    this.updateHUD();
  }

  gameOver(reason) {
    this.state = 'over';
    this.overT = 0;
    this.sfx.over();
    this.shake = 1;
    this.overReason = reason;
    this.cur = null;
    this.pieceGroup.clear(); this.ghostGroup.clear();
  }

  finishOver() {
    this.overT = -1;
    const isBest = this.score > this.best;
    if (isBest) { this.best = this.score; this.saveBest(); }
    this.$('overScore').textContent = this.score;
    this.$('overWhy').textContent = this.overReason;
    this.$('overBest').textContent = isBest && this.score > 0 ? '🏆 New best!' : '';
    this.updateHUD();
    this.showScreen('over');
  }

  // ---------------------------------------------------------- effects
  dust(x, y, type) {
    for (let i = 0; i < 5; i++) this.spark(x - W / 2 + (Math.random() - 0.5) * 2, Math.max(0.3, y), COLORS[type], 1);
  }

  spark(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo.ico(0.12), toon(color, { emissive: color, ei: 0.5 }));
      m.position.set(x, y, 0.3);
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3;
      this.scene.add(m);
      this.bits.push({ mesh: m, life: 0.5 + Math.random() * 0.5, max: 1, small: true, v: new THREE.Vector3(Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s + 1), spin: new THREE.Vector3(3, 3, 3) });
    }
  }

  // ---- hooks used by the sky events
  showSkyTag(text) { const e = this.$('skyTag'); e.textContent = text; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); }
  hideSkyTag() { this.$('skyTag').classList.remove('show'); }
  setOverlay(dim, tint, tintColor) {
    this.$('skyDim').style.opacity = dim.toFixed(3);
    const t = this.$('skyTint'); t.style.opacity = tint.toFixed(3); t.style.background = tintColor;
  }
  boom(power = 0.5) { this.shake = Math.max(this.shake, power); this.sfx.boom(); }

  showBanner(text) {
    const b = this.$('banner');
    b.textContent = text;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  // ---------------------------------------------------------- HUD & previews
  updateHUD() {
    this.$('score').textContent = this.score;
    this.$('best').textContent = Math.max(this.best, this.score);
    this.$('lines').textContent = this.lines;
    this.$('level').textContent = this.level;
    const s = this.$('score').parentElement;
    if (this.lastShown !== this.score) { s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); this.lastShown = this.score; }
  }

  drawMini(canvas, type, dim) {
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (!type) return;
    const m = SHAPES[type];
    const cells = [];
    m.forEach((row, r) => row.forEach((v, cI) => { if (v) cells.push([cI, r]); }));
    const minC = Math.min(...cells.map((p) => p[0])), maxC = Math.max(...cells.map((p) => p[0]));
    const minR = Math.min(...cells.map((p) => p[1])), maxR = Math.max(...cells.map((p) => p[1]));
    const s = 15, ox = (canvas.width - (maxC - minC + 1) * s) / 2, oy = (canvas.height - (maxR - minR + 1) * s) / 2;
    c.lineWidth = 2.5; c.strokeStyle = '#2a1f3d'; c.fillStyle = COLORS[type];
    for (const [cI, r] of cells) {
      const x = ox + (cI - minC) * s, y = oy + (r - minR) * s;
      c.beginPath(); c.roundRect(x + 1, y + 1, s - 2, s - 2, 4); c.fill(); c.stroke();
    }
  }

  drawPreviews() {
    this.drawMini(this.$('holdC'), this.hold);
    for (let i = 0; i < 3; i++) this.drawMini(this.$('nextC' + i), this.queue[i]);
  }

  // ---------------------------------------------------------- input
  bindInput() {
    window.addEventListener('keydown', (e) => {
      this.sfx.unlock();
      const k = e.code;
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space'].includes(k)) e.preventDefault();
      if (k === 'ArrowLeft' || k === 'KeyA') this.move(-1);
      else if (k === 'ArrowRight' || k === 'KeyD') this.move(1);
      else if (k === 'ArrowDown' || k === 'KeyS') this.softDrop();
      else if (e.repeat) return;
      else if (k === 'ArrowUp' || k === 'KeyX' || k === 'KeyW') this.rotate(1);
      else if (k === 'KeyZ') this.rotate(-1);
      else if (k === 'Space') this.hardDrop();
      else if (k === 'KeyC' || k === 'ShiftLeft' || k === 'ShiftRight') this.holdPiece();
      else if (k === 'KeyP' || k === 'Escape') { this.state === 'paused' ? this.resume() : this.pause(); }
      else if (k === 'KeyM') this.toggleSound();
      else if (k === 'Enter' && this.state === 'over') this.restart();
    });

    // touch buttons, with auto-repeat for the movement ones
    const actions = {
      left: () => this.move(-1), right: () => this.move(1), down: () => this.softDrop(),
      rotate: () => this.rotate(1), drop: () => this.hardDrop(), hold: () => this.holdPiece(),
    };
    document.querySelectorAll('[data-act]').forEach((b) => {
      const act = actions[b.dataset.act];
      const repeats = ['left', 'right', 'down'].includes(b.dataset.act);
      let t1 = 0, t2 = 0;
      const stop = () => { clearTimeout(t1); clearInterval(t2); };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); this.sfx.unlock(); act();
        if (repeats) { stop(); t1 = setTimeout(() => { t2 = setInterval(act, 70); }, 170); }
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
    });

    // gestures on the scene: swipe sideways to slide, swipe DOWN to drop fast, tap to rotate
    const stage = this.$('stage');
    let sx = 0, sy = 0, down = false, moved = false, t0 = 0;
    stage.addEventListener('pointerdown', (e) => { this.sfx.unlock(); down = true; moved = false; sx = e.clientX; sy = e.clientY; t0 = performance.now(); });
    stage.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) { this.move(Math.sign(dx)); sx = e.clientX; sy = e.clientY; moved = true; }
      else if (dy > 48 && dy > Math.abs(dx)) { this.hardDrop(); down = false; moved = true; }   // swipe down: fast drop
    });
    stage.addEventListener('pointerup', (e) => {
      if (down && !moved && performance.now() - t0 < 250 && Math.hypot(e.clientX - sx, e.clientY - sy) < 12) this.rotate(1);
      down = false;
    });
    stage.addEventListener('pointercancel', () => { down = false; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
  }

  bindUI() {
    this.$('play').onclick = () => this.restart();
    this.setGuide(this.guide);
    this.$('guideBtn').onclick = () => { this.sfx.unlock(); this.sfx.click(); this.setGuide(!this.guide); };
    this.$('btnPause').onclick = () => { this.sfx.unlock(); this.state === 'paused' ? this.resume() : this.pause(); };
    this.$('btnSound').onclick = () => this.toggleSound();
    this.$('btnSound').textContent = this.sfx.on ? '🔊' : '🔇';
    this.$('resume').onclick = () => this.resume();
    this.$('pRestart').onclick = () => this.restart();
    this.$('pMenu').onclick = () => this.toMenu();
    this.$('again').onclick = () => this.restart();
    this.$('oMenu').onclick = () => this.toMenu();
  }

  showScreen(name) {
    for (const id of ['menu', 'pause', 'over']) this.$(id).classList.toggle('hidden', id !== name);
    this.$('hud').classList.toggle('off', name === 'menu');
  }

  setGuide(on) {
    this.guide = on;
    try { localStorage.setItem('tetris-guide-v1', JSON.stringify(on)); } catch { /* blocked */ }
    const b = this.$('guideBtn');
    b.textContent = on ? 'Landing guide: ON' : 'Landing guide: OFF (hard mode)';
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('off', !on);
  }

  restart() { this.sfx.unlock(); this.sfx.click(); this.bits.forEach((b) => b.mesh.parent?.remove(b.mesh)); this.bits = []; this.sky.reset(); this.resetGame(); this.state = 'playing'; this.showScreen(null); }
  toMenu() { this.sfx.click(); this.bits.forEach((b) => b.mesh.parent?.remove(b.mesh)); this.bits = []; this.sky.reset(); this.resetGame(); this.state = 'menu'; this.showScreen('menu'); }
  pause() { if (this.state === 'playing') { this.state = 'paused'; this.showScreen('pause'); } }
  resume() { if (this.state === 'paused') { this.state = 'playing'; this.showScreen(null); } }
  toggleSound() { this.sfx.unlock(); this.$('btnSound').textContent = this.sfx.toggle() ? '🔊' : '🔇'; }
  loadBest() { try { return JSON.parse(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } }
  saveBest() { try { localStorage.setItem(BEST_KEY, JSON.stringify(this.best)); } catch { /* blocked */ } }

  // ---------------------------------------------------------- loop
  /** Starts slow and gets quicker with every level (one level per 10 lines). */
  gravity() { return Math.max(0.07, 1.1 * Math.pow(0.85, this.level - 1)); }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.update(dt);
    this.render(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    if (this.state === 'playing' && this.cur) {
      const grounded = this.collide(this.cur.m, this.cur.x, this.cur.y - 1);
      if (grounded) {
        this.lockT += dt;
        if (this.lockT >= 0.5) this.lockPiece();
      } else {
        this.lockT = 0;
        this.dropAcc += dt;
        const iv = this.gravity();
        while (this.dropAcc >= iv && this.cur && !this.collide(this.cur.m, this.cur.x, this.cur.y - 1)) { this.cur.y--; this.dropAcc -= iv; }
      }
    } else if (this.state === 'clearing') {
      this.clearT -= dt;
      if (this.clearT <= 0) { this.state = 'playing'; this.spawn(); }
    } else if (this.state === 'over' && this.overT >= 0) {
      this.overT += dt;
      if (this.overT > 1) this.finishOver();
    }

    this.sky.update(dt, this.state === 'playing' || this.state === 'clearing');

    // flying bits under (weak) Martian gravity
    const bits = [];
    for (const b of this.bits) {
      b.life -= dt;
      if (b.life <= 0) { b.mesh.parent?.remove(b.mesh); continue; }
      b.v.y -= 7 * dt;
      b.mesh.position.addScaledVector(b.v, dt);
      if (b.mesh.position.y < 0.25) { b.mesh.position.y = 0.25; b.v.y *= -0.35; b.v.x *= 0.8; b.v.z *= 0.8; }
      b.mesh.rotation.x += b.spin.x * dt; b.mesh.rotation.y += b.spin.y * dt; b.mesh.rotation.z += b.spin.z * dt;
      b.mesh.scale.setScalar(clamp(b.life / 0.4, 0.01, 1));
      bits.push(b);
    }
    this.bits = bits;
    this.flashes = this.flashes.filter((f) => {
      f.life -= dt;
      if (f.life <= 0) { this.scene.remove(f.mesh); return false; }
      const p = f.life / f.max;
      f.mesh.material.opacity = (f.kind === 'flash' ? 0.95 : 0.45) * p;
      if (f.kind === 'flash') f.mesh.scale.set(1 + (1 - p) * 0.15, 1 + (1 - p) * 1.6, 1);
      else f.mesh.scale.x = p;
      return true;
    });
    this.shake = Math.max(0, this.shake - dt * 2.4);
  }

  render(dt) {
    const t = this.clock;
    // active piece eases towards its logical cell so falling looks smooth
    if (this.cur) {
      const k = 1 - Math.exp(-dt * 26);
      this.vis.x = lerp(this.vis.x, this.cur.x, k);
      this.vis.y = lerp(this.vis.y, this.cur.y, 1 - Math.exp(-dt * 18));
      const cells = this.cells(this.cur.m, 0, 0);
      const gy = this.ghostY();
      cells.forEach(([c, r], i) => {
        this.pieceMeshes[i].position.set(this.vis.x + c + 0.5 - W / 2, this.vis.y + r + 0.5, 0);
        this.ghostMeshes[i].position.set(cx(this.cur.x + c), cy(gy + r), 0);
      });
      this.ghostGroup.visible = this.guide && gy < this.cur.y;
    }
    // settled blocks glide down after a line clear
    const kb = 1 - Math.exp(-dt * 12);
    for (const m of this.boardGroup.children) m.position.y = lerp(m.position.y, cy(m.userData.gy), kb);

    // ambience
    this.rover.position.set(Math.sin(t * 0.08) * 38, 0, 11);
    this.rover.rotation.y = Math.cos(t * 0.08) > 0 ? 0 : Math.PI;
    const blink = Math.sin(t * 4) > 0 ? 1 : 0.15;
    for (const l of [...this.beacons, ...this.towerLamps]) l.material.emissiveIntensity = blink;
    this.moons[0].rotation.y = t * 0.05; this.moons[1].rotation.y = -t * 0.04;

    // camera: level with the horizon, a gentle sideways parallax following the piece
    const targetX = this.cur ? (this.vis.x - W / 2) * 0.2 : 0;
    this.camX = lerp(this.camX, targetX, 1 - Math.exp(-dt * 2.5));
    const sh = this.shake * this.shake;
    this.camera.position.set(this.camX + (Math.random() - 0.5) * sh * 0.8, this.camY + (Math.random() - 0.5) * sh * 0.8, this.camDist);
    this.camera.lookAt(this.camX * 0.3, this.camY, 0);
    this.renderer.render(this.scene, this.camera);
  }
}

window.tetris = new Tetris();
