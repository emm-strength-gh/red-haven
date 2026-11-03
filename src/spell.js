import * as THREE from 'three';
import { SkyEvents } from './tetris-sky.js';

// ================================================================ content
const SETTINGS_KEY = 'spell-settings-v1';
const STARS_KEY = 'spell-stars-v1';

const DEFAULT_WORDS = [
  { w: 'APPLE', e: '🍎' }, { w: 'BANANA', e: '🍌' }, { w: 'PEAR', e: '🍐' }, { w: 'LEMON', e: '🍋' }, { w: 'GRAPES', e: '🍇' },
  { w: 'CARROT', e: '🥕' }, { w: 'CORN', e: '🌽' }, { w: 'TOMATO', e: '🍅' },
  { w: 'CAT', e: '🐱' }, { w: 'DOG', e: '🐶' }, { w: 'PIG', e: '🐷' }, { w: 'COW', e: '🐮' }, { w: 'FISH', e: '🐟' }, { w: 'FROG', e: '🐸' }, { w: 'DUCK', e: '🦆' },
  { w: 'TRAIN', e: '🚂' }, { w: 'CAR', e: '🚗' }, { w: 'BUS', e: '🚌' },
  { w: 'STAR', e: '⭐' }, { w: 'MOON', e: '🌙' },
];
const EMOJI_CHOICES = [
  '🍎', '🍌', '🍓', '🍉', '🍒', '🍑', '🍍', '🥝', '🥦', '🥔', '🍄', '🌶️', '🥒', '🍞', '🧀', '🍕', '🍪', '🍦',
  '🐱', '🐶', '🐭', '🐰', '🦊', '🐻', '🐼', '🦁', '🐯', '🐵', '🐔', '🐧', '🐢', '🐙', '🦋', '🐝', '🐞', '🐘', '🦒', '🐴',
  '🚀', '✈️', '🚁', '🚲', '⛵', '🚒', '🏠', '⚽', '🎈', '🎁', '🌈', '🌸', '🌳', '🔔', '👑', '🧸', '🎸', '📚', '⏰', '🔑',
];
const LETTER_COLORS = ['#ff7eb6', '#ffd23f', '#5ed3f3', '#8ee04e', '#ff8a3d', '#b36bff', '#4d96ff', '#ff6a5f'];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const SHELF_Z = -12.5, BOARD_Z = -18;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

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

// ---- cel shading: three-band toon ramp + inverted-hull outlines (same as the other games)
const gradient = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
gradient.minFilter = THREE.NearestFilter;
gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

const toonCache = new Map();
function toon(color, o = {}) {
  const k = `${color}|${o.emissive ?? ''}`;
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

// ================================================================ audio (synthesised)
class Sfx {
  constructor() { this.ctx = null; this.on = true; }
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
  blip(i) { const f = 523 * Math.pow(2, [0, 2, 4, 5, 7, 9, 11, 12, 14, 16][i % 10] / 12); this.tone(f, f * 1.02, 0.18, 'triangle', 0.3); this.tone(f * 2, f * 2, 0.12, 'sine', 0.1, 0.03); }
  roll() { this.tone(180, 320, 0.5, 'triangle', 0.1); }
  thud() { this.tone(160, 80, 0.12, 'sine', 0.3); }
  explode() { this.noise(0.4, 0.4, 1100); this.tone(300, 60, 0.35, 'sawtooth', 0.18); this.tone(900, 200, 0.15, 'square', 0.1); }
  pop() { this.tone(500, 900, 0.07, 'sine', 0.2); }
  hint() { this.tone(880, 880, 0.15, 'sine', 0.25); this.tone(1320, 1320, 0.2, 'sine', 0.2, 0.12); }
  cheer() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, f, 0.16, 'triangle', 0.28, i * 0.09)); }
  click() { this.tone(520, 700, 0.06, 'square', 0.12); }
  soft() { this.noise(0.4, 0.15, 400); this.tone(120, 50, 0.4, 'sine', 0.18); }
}

// ================================================================ the game
class SpellGame {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.settings = this.loadSettings();
    this.stars = this.loadStars();
    this.sfx = new Sfx();
    this.sfx.on = this.settings.sound;
    this.gradient = gradient;
    this.state = 'menu';
    this.clock = 0;
    this.blocks = [];
    this.bits = [];
    this.timers = [];
    this.bag = [];
    this.lastWord = '';
    this.fx = 8;
    this.zMax = 3;
    this.camY = 7;
    this.camZ = 16;
    this.zoom = 1; this.zoomTarget = 1;
    this.pitch = 15; this.pitchTarget = 15; this.skyPitch = 15;
    this.pointers = new Map();
    this.letterMats = new Map();
    this.emojiTexCache = new Map();
    this.setupScene();
    this.buildWorld();
    this.buildStage();
    this.sky = new SkyEvents(this, {
      elBias: -6,
      skip: ['Satellite collision', 'Meteor impact'],
      extra: [['Alien says hi', '👽', (S) => this.alienEvent(S)], ['Rover drive-by', '🚙', (S) => this.roverEvent(S)]],
    });
    this.bindUI();
    this.bindInput();
    this.renderSettings();
    this.updateStars(false);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------- settings
  loadSettings() {
    const d = { sound: true, voice: true, autoHint: true, ghost: false, extra: 4, disabled: [], custom: [] };
    try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; } catch { return d; }
  }
  saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* blocked */ } }
  loadStars() { try { return Number(localStorage.getItem(STARS_KEY)) || 0; } catch { return 0; } }
  allWords() { return [...DEFAULT_WORDS, ...this.settings.custom]; }
  enabledWords() { const off = new Set(this.settings.disabled); return this.allWords().filter((x) => !off.has(x.w)); }

  // ---------------------------------------------------------- scene
  setupScene() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.$('stage').appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xffb98a, 50, 260);
    this.scene.add(new THREE.HemisphereLight(0xffe4cc, 0x8a3d33, 1.55));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(-14, 26, 18);
    sun.target.position.set(0, 0, -8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0015;
    this.scene.add(sun, sun.target);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 600);
    this.raycaster = new THREE.Raycaster();
  }

  drawSky(hf) {
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 512;
    const c = cv.getContext('2d');
    const grad = c.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#241545'); grad.addColorStop(Math.max(0.01, hf * 0.4), '#4a2a6e'); grad.addColorStop(Math.max(0.02, hf * 0.78), '#b95a86');
    grad.addColorStop(Math.min(0.98, hf), '#ffb98a'); grad.addColorStop(1, '#ffb98a');
    c.fillStyle = grad; c.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    if (this.scene.background?.dispose) this.scene.background.dispose();
    this.scene.background = tex;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight, a = w / h;
    if (!(w > 0 && h > 0)) return;     // hidden pane: nothing to lay out yet
    this.renderer.setSize(w, h);
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.fx = a < 0.8 ? 5.4 : a < 1.2 ? 7.4 : 9.4;                  // half width of the play area
    this.camZ = Math.max(15, (this.fx + 1.5) / (t * a));
    this.zMax = clamp(this.camZ - 11, 3, 11);                       // how close to the camera blocks may sit
    this.lookTarget = new THREE.Vector3(0, 2.4, -10);
    // the camera orbits the look target; its distance is what puts the whole play area in view at the default 15 degree look-down
    this.baseDist = (this.camZ - this.lookTarget.z) / Math.cos(THREE.MathUtils.degToRad(15));
    this.camY = this.lookTarget.y + Math.sin(THREE.MathUtils.degToRad(15)) * this.baseDist;
    this.camera.position.set(0, this.camY, this.camZ);
    this.camera.lookAt(this.lookTarget);
    this.visAz = THREE.MathUtils.radToDeg(Math.atan(t * a));
    this.tanHalf = t;
    this.applyPitchSky(true);
  }

  /** the sky gradient and sky-event heights follow the horizon as the camera tilts */
  applyPitchSky(force = false) {
    if (!force && Math.abs(this.pitch - this.skyPitch) < 0.4) return;
    this.skyPitch = this.pitch;
    const pr = THREE.MathUtils.degToRad(this.pitch), t = this.tanHalf;
    this.drawSky(clamp(0.5 - Math.tan(pr) / (2 * t), 0.02, 0.85));
    if (this.sky) this.sky.elBias = (THREE.MathUtils.radToDeg(Math.atan(t)) - this.pitch) - 23;   // keep sky events above the horizon, inside the view
  }

  buildWorld() {
    const world = new THREE.Group();
    this.scene.add(world);
    const rng = rngFor(1234);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshToonMaterial({ color: '#c9573a', gradientMap: gradient }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    world.add(ground);
    for (let i = 0; i < 40; i++) {
      const r = 1.5 + rng() * 6, x = (rng() - 0.5) * 150, z = -rng() * 120 + 14;
      if (Math.abs(x) < r + 14 && z > -28 - r && z < 8 + r) continue;
      const d = new THREE.Mesh(geo.cyl(r, r, 0.02, 18), toon('#b2452e')); d.position.set(x, 0.01, z); d.receiveShadow = true; world.add(d);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.18, 5, 22), toon('#e07a56')); rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.05, z); rim.scale.set(1, 1, 0.5); world.add(rim);
    }
    for (let i = 0; i < 90; i++) {
      const x = (rng() - 0.5) * 150, z = 24 - rng() * 110;
      if (Math.abs(x) < 15 && z > -27 && z < 10) continue;
      const s = 0.3 + Math.pow(rng(), 2) * 2.2;
      mk(world, geo.ico(s), ['#a8472f', '#b9553a', '#8f3b2c'][i % 3], [x, s * 0.35, z], { scale: [1.2, 0.7, 1], rot: [rng(), rng() * 3, rng()], outline: 1.06, receive: true });
    }
    for (let i = 0; i < 26; i++) {
      const x = (i / 25 - 0.5) * 380 + (rng() - 0.5) * 20, z = -100 - rng() * 70, r = 12 + rng() * 22, h = 8 + rng() * 22;
      if (rng() > 0.45) mk(world, geo.cone(r, h, 5), '#9a4430', [x, h / 2, z], { rot: [0, rng() * 3, 0], outline: 1.03 });
      else { mk(world, geo.cyl(r * 0.7, r, h * 0.7, 7), '#a54e36', [x, h * 0.35, z], { outline: 1.03 }); mk(world, geo.cyl(r * 0.72, r * 0.72, 1.2, 7), '#c46a48', [x, h * 0.7 + 0.5, z], { outline: 1.04 }); }
    }
    this.beacons = [];
    for (const [x, z, r] of [[-26, -36, 4], [32, -40, 5.5], [-50, -52, 6], [52, -30, 3.4]]) {
      mk(world, geo.cyl(r * 1.05, r * 1.15, 0.8, 14), '#f4efe6', [x, 0.4, z], { receive: true });
      const dome = new THREE.Mesh(geo.dome(r), new THREE.MeshToonMaterial({ color: '#8fe9ff', gradientMap: gradient, transparent: true, opacity: 0.78 }));
      dome.position.set(x, 0.8, z); dome.castShadow = true; addOutline(dome, 1.03); world.add(dome);
    }
    for (const [x, z] of [[-17, -30], [19, -33], [-36, -40]]) {
      mk(world, geo.cyl(0.08, 0.14, 7, 5), '#e9e4da', [x, 3.5, z], { outline: 1.15 });
      this.beacons.push(mk(world, geo.sphere(0.22, 8, 6), '#ff5f57', [x, 7.1, z], { emissive: '#ff2d2d', ei: 1, outline: 1.2 }));
    }
    const basic = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, fog: false, transparent: opacity < 1, opacity, depthWrite: false });
    const sunGlow = new THREE.Mesh(geo.sphere(34, 20, 14), basic('#ffd9a0', 0.28)); sunGlow.position.set(-64, 24, -300);
    const sunDisk = new THREE.Mesh(geo.sphere(17, 20, 14), basic('#fff3c4')); sunDisk.position.set(-64, 24, -299);
    const phobos = new THREE.Mesh(geo.ico(7, 0), new THREE.MeshToonMaterial({ color: '#b9a8b8', gradientMap: gradient, fog: false })); phobos.position.set(62, 78, -280);
    const deimos = new THREE.Mesh(geo.ico(3.6, 0), new THREE.MeshToonMaterial({ color: '#d8c8c0', gradientMap: gradient, fog: false })); deimos.position.set(-36, 92, -300);
    world.add(sunGlow, sunDisk, phobos, deimos);
    this.sunGlow = sunGlow; this.sunDisk = sunDisk; this.moons = [phobos, deimos];
    const sp = [];
    for (let i = 0; i < 260; i++) {
      const a = rng() * Math.PI * 2, e = 0.1 + rng() * 0.6;
      sp.push(Math.cos(a) * Math.cos(e) * 500, Math.sin(e) * 500, -Math.abs(Math.sin(a)) * Math.cos(e) * 500 - 40);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 });
    world.add(new THREE.Points(sg, this.starMat));
  }

  // ---------------------------------------------------------- billboard & shelf
  buildStage() {
    const g = new THREE.Group();
    g.position.set(0, 0, BOARD_Z);
    this.scene.add(g);
    for (const s of [-1, 1]) mk(g, geo.cyl(0.35, 0.45, 5, 8), '#8a7f94', [s * 3.8, 2.5, 0]);
    mk(g, geo.box(11.4, 7, 0.7), '#e9e4da', [0, 7.4, 0], { outline: 1.03 });
    for (let i = 0; i < 9; i++) mk(g, geo.sphere(0.2, 8, 6), i % 2 ? '#ffd23f' : '#ff5f57', [-5.2 + i * 1.3, 11.1, 0.35], { emissive: i % 2 ? '#ffd23f' : '#ff5f57', ei: 0.7, outline: false });
    this.billLights = g.children.filter((c) => c.geometry?.parameters?.radius === 0.2);

    this.billCanvas = document.createElement('canvas'); this.billCanvas.width = 512; this.billCanvas.height = 320;
    const bc = this.billCanvas.getContext('2d');
    const grd = bc.createLinearGradient(0, 0, 0, 320); grd.addColorStop(0, '#bfe9ff'); grd.addColorStop(1, '#fff6d8');
    bc.fillStyle = grd; bc.fillRect(0, 0, 512, 320);
    bc.fillStyle = 'rgba(255,255,255,0.8)';
    for (const [x, y, r] of [[90, 70, 34], [140, 78, 26], [410, 60, 30], [450, 70, 22]]) { bc.beginPath(); bc.arc(x, y, r, 0, 7); bc.fill(); }
    const bgTex = new THREE.CanvasTexture(this.billCanvas); bgTex.colorSpace = THREE.SRGBColorSpace;
    this.billFace = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 6.5), new THREE.MeshBasicMaterial({ map: bgTex, fog: false }));
    this.billFace.position.set(0, 7.4, 0.4); g.add(this.billFace);
    this.emojiCanvas = document.createElement('canvas'); this.emojiCanvas.width = this.emojiCanvas.height = 256;
    this.emojiTex = new THREE.CanvasTexture(this.emojiCanvas); this.emojiTex.colorSpace = THREE.SRGBColorSpace;
    this.emojiPlane = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), new THREE.MeshBasicMaterial({ map: this.emojiTex, transparent: true, fog: false, depthWrite: false }));
    this.emojiPlane.position.set(0, 7.4, 0.5); this.emojiPlane.renderOrder = 2; g.add(this.emojiPlane);
    this.board = g;

    this.shelf = new THREE.Group();
    this.shelf.position.set(0, 0, SHELF_Z);
    this.scene.add(this.shelf);
    this.shelfLamps = [];
  }

  setPicture(emoji) {
    const c = this.emojiCanvas.getContext('2d');
    c.clearRect(0, 0, 256, 256);
    c.font = '190px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(emoji, 128, 140);
    this.emojiTex.needsUpdate = true;
    this.pictureT = 0;
  }

  buildShelf(n) {
    this.shelf.clear();
    this.shelfLamps = [];
    const sh = this.shelf, w = n * this.slot + 1.4;
    mk(sh, geo.box(w, 0.5, 2.4), '#a8703c', [0, 0.25, 0], { receive: true, outline: 1.03 });
    mk(sh, geo.box(w + 0.3, 0.12, 2.6), '#d9a066', [0, 0.52, 0], { outline: 1.03 });
    for (const s of [-1, 1]) {
      this.shelfLamps.push(mk(sh, geo.sphere(0.28, 10, 8), '#ffd23f', [s * (w / 2 + 0.2), 0.9, 0.8], { emissive: '#ffd23f', ei: 0.6, outline: 1.15 }));
    }
    for (let i = 0; i < n; i++) {
      const p = this.slotPos(i);
      const slot = new THREE.Mesh(geo.box(this.slot * 0.88, 0.04, this.slot * 0.88), toon('#8a5a34')); slot.position.set(p.x, 0.6, 0); slot.receiveShadow = true; sh.add(slot);
      if (this.settings.ghost) {
        const gm = new THREE.Mesh(new THREE.PlaneGeometry(this.bs * 0.8, this.bs * 0.8), new THREE.MeshBasicMaterial({ map: this.ghostTex(this.word[i]), transparent: true, depthWrite: false }));
        gm.position.set(p.x, 0.66 + this.bs * 0.4, 0.2); sh.add(gm);
      }
    }
  }
  slotPos(i) { return new THREE.Vector3((i - (this.word.length - 1) / 2) * this.slot, 0.6 + this.bs / 2 + 0.02, SHELF_Z); }

  ghostTex(letter) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    c.font = '96px "Lilita One","Fredoka",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(42,31,61,0.28)'; c.fillText(letter, 64, 70);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // ---------------------------------------------------------- letter blocks
  letterMat(letter, color) {
    const k = letter + color;
    let m = this.letterMats.get(k);
    if (!m) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 160;
      const c = cv.getContext('2d');
      c.fillStyle = color; c.fillRect(0, 0, 160, 160);
      c.fillStyle = 'rgba(255,255,255,0.32)'; c.beginPath(); c.roundRect(14, 14, 132, 132, 26); c.fill();
      c.lineWidth = 6; c.strokeStyle = 'rgba(42,31,61,0.55)'; c.beginPath(); c.roundRect(6, 6, 148, 148, 22); c.stroke();
      c.font = '112px "Lilita One","Fredoka",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 9; c.strokeStyle = '#fff'; c.strokeText(letter, 80, 90);
      c.fillStyle = '#2a1f3d'; c.fillText(letter, 80, 90);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      m = new THREE.MeshToonMaterial({ map: tex, gradientMap: gradient });
      this.letterMats.set(k, m);
    }
    return m;
  }

  spawnBlock(letter, delay = 0) {
    const spot = this.freeSpot();
    const color = LETTER_COLORS[Math.floor(Math.random() * LETTER_COLORS.length)];
    const mesh = new THREE.Mesh(geo.box(this.bs, this.bs, this.bs), this.letterMat(letter, color));
    mesh.castShadow = true; addOutline(mesh, 1.06);
    mesh.position.set(spot.x, this.bs / 2, spot.z);
    mesh.rotation.y = rand(-0.28, 0.28);
    mesh.scale.setScalar(0.001);
    this.scene.add(mesh);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(this.bs * 0.62, 18), new THREE.MeshBasicMaterial({ color: 0x1d2433, transparent: true, opacity: 0.22, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(spot.x, 0.06, spot.z); shadow.visible = false;
    this.scene.add(shadow);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(this.bs * 0.75, 0.07, 6, 24), new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0.9 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -this.bs / 2 + 0.08; ring.visible = false; ring.raycast = () => {};
    mesh.add(ring);
    const b = { letter, mesh, shadow, ring, x: spot.x, z: spot.z, state: 'wait', delay, t: 0, ph: rand(0, 6), hint: 0, baseRot: mesh.rotation.y };
    mesh.userData.block = b;
    this.blocks.push(b);
    return b;
  }

  freeSpot() {
    const minD = this.bs * 1.5, xr = this.fx - this.bs * 0.8;
    for (let i = 0; i < 160; i++) {
      const x = rand(-xr, xr), z = rand(-5, this.zMax);
      if (this.blocks.every((b) => b.state === 'placed' || b.state === 'roll' || Math.hypot(b.x - x, b.z - z) > minD)) return { x, z };
    }
    return { x: rand(-xr, xr), z: rand(-5, this.zMax) };
  }

  removeBlock(b) {
    this.scene.remove(b.mesh); this.scene.remove(b.shadow);
    this.blocks = this.blocks.filter((x) => x !== b);
  }

  // ---------------------------------------------------------- rounds
  pickWord() {
    if (!this.bag.length) {
      const pool = this.enabledWords();
      this.bag = shuffle([...pool]);
      if (this.bag.length > 1 && this.bag[this.bag.length - 1].w === this.lastWord) this.bag.unshift(this.bag.pop());
    }
    return this.bag.pop();
  }

  async startRound() {
    try { await Promise.race([document.fonts.load('90px "Lilita One"'), new Promise((r) => setTimeout(r, 900))]); } catch { /* keep going */ }
    for (const b of [...this.blocks]) this.removeBlock(b);
    const item = this.pickWord();
    this.lastWord = item.w;
    this.word = item.w.split('');
    this.item = item;
    const n = this.word.length;
    this.slot = Math.min(2.0, (2 * this.fx + 1.2) / n);
    this.bs = clamp(this.slot * 0.92, 1.3, 1.8);
    this.buildShelf(n);
    this.setPicture(item.e);
    this.filled = 0; this.placed = 0; this.wrong = 0; this.streak = 0; this.idle = 0;
    const pool = shuffle(ALPHABET.filter((l) => !this.word.includes(l)));
    const letters = shuffle([...this.word, ...pool.slice(0, this.settings.extra)]);
    letters.forEach((l, i) => this.spawnBlock(l, 0.25 + i * 0.07));
    this.state = 'playing';
    this.$('hud').classList.remove('off');
    this.showBanner('What is it?');
  }

  onTap(b) {
    if (this.state !== 'playing' || b.state !== 'idle') return;
    this.sfx.unlock();
    this.idle = 0;
    if (b.letter === this.word[this.filled]) {
      b.state = 'roll'; b.slot = this.filled++; b.t = 0;
      b.from = b.mesh.position.clone(); b.to = this.slotPos(b.slot);
      b.dist = Math.hypot(b.to.x - b.from.x, b.to.z - b.from.z);
      b.dur = 0.8 + b.dist * 0.045;
      b.q0 = b.mesh.quaternion.clone();
      b.ring.visible = false; b.hint = 0;
      this.streak = 0;
      this.sfx.blip(b.slot); this.sfx.roll();
    } else {
      this.explode(b);
    }
  }

  explode(b) {
    this.wrong++; this.streak++;
    const col = b.mesh.material.map ? LETTER_COLORS[Math.floor(Math.random() * LETTER_COLORS.length)] : '#ffffff';
    this.burst(b.mesh.position, [col, '#ffd23f', '#ffffff', '#ff8a3d'], 22, 1.1);
    this.sfx.explode();
    const letter = b.letter;
    this.removeBlock(b);
    this.showBanner(this.streak >= 2 ? 'Look for a bouncing letter!' : 'Oops! Try again');
    if (this.streak >= 2) this.hint();
    // the letter comes back so nothing is ever lost
    this.timers.push({ t: 1.1, fn: () => { if (this.state === 'playing' || this.state === 'celebrate') this.spawnBlock(letter, 0); } });
  }

  hint() {
    const next = this.word[this.filled];
    if (next === undefined) return;
    const cands = this.blocks.filter((b) => b.state === 'idle' && b.letter === next);
    for (const b of cands) b.hint = 3.2;
    if (cands.length) this.sfx.hint();
  }

  complete() {
    this.state = 'celebrate'; this.celT = 0;
    this.stars++;
    try { localStorage.setItem(STARS_KEY, String(this.stars)); } catch { /* blocked */ }
    this.updateStars(true);
    this.sfx.cheer();
    this.showBanner(this.item.w + '!');
    for (let i = 0; i < 3; i++) this.timers.push({ t: i * 0.35, fn: () => this.burst(new THREE.Vector3(rand(-4, 4), 8 + rand(-1, 2), BOARD_Z + 1), ['#ff7eb6', '#ffd23f', '#5ed3f3', '#8ee04e', '#b36bff'], 26, 1.6, true) });
    this.speak(`${this.item.w.toLowerCase()}. ${this.word.join('. ')}. ${this.item.w.toLowerCase()}!`);
    for (const b of this.blocks) if (b.state === 'idle') { b.state = 'leave'; b.t = -rand(0, 0.5); }
    this.timers.push({ t: 4.6, fn: () => { if (this.state === 'celebrate') this.startRound(); } });
  }

  // ---------------------------------------------------------- effects
  burst(pos, colors, n, power = 1, confetti = false) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(confetti ? geo.box(0.22, 0.22, 0.06) : geo.ico(0.16), toon(colors[i % colors.length], { emissive: colors[i % colors.length], ei: 0.35 }));
      m.position.copy(pos);
      const a = Math.random() * Math.PI * 2, s = (2 + Math.random() * 4) * power;
      this.scene.add(m);
      this.bits.push({ mesh: m, life: 1 + Math.random() * 0.9, v: new THREE.Vector3(Math.cos(a) * s, 3 + Math.random() * 5 * power, Math.sin(a) * s * 0.7 + 1), spin: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)) });
    }
  }

  showBanner(text) {
    const b = this.$('banner');
    b.textContent = text;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }
  showSkyTag(text) { const e = this.$('skyTag'); e.textContent = text; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); }
  hideSkyTag() { this.$('skyTag').classList.remove('show'); }
  setOverlay(dim, tint, tintColor) {
    this.$('skyDim').style.opacity = dim.toFixed(3);
    const t = this.$('skyTint'); t.style.opacity = tint.toFixed(3); t.style.background = tintColor;
  }
  boom() { this.sfx.soft(); }          // sky events stay gentle for little ones
  updateStars(bump) {
    this.$('stars').textContent = this.stars;
    if (bump) { const p = this.$('stars').parentElement; p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
  }

  speak(text) {
    if (!this.settings.voice || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.82; u.pitch = 1.25; u.lang = 'en-US';
      speechSynthesis.speak(u);
    } catch { /* speech unavailable */ }
  }

  emojiSprite(emoji, size = 1.6) {
    let tex = this.emojiTexCache.get(emoji);
    if (!tex) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const c = cv.getContext('2d');
      c.fillStyle = '#fffaf0'; c.strokeStyle = '#2a1f3d'; c.lineWidth = 8; c.beginPath(); c.arc(64, 64, 56, 0, 7); c.fill(); c.stroke();
      c.font = '70px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(emoji, 64, 70);
      tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; this.emojiTexCache.set(emoji, tex);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: false }));
    s.scale.setScalar(size);
    return s;
  }

  // ---------------------------------------------------------- extra (ground) background events
  alienEvent(S) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const base = new THREE.Vector3(side * (this.fx - 1.2), 0, -10).sub(this.camera.position);
    const alien = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 10), S.toonMat('#7be86a')); body.position.y = 0.6; alien.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), S.toonMat('#8ff27c')); head.position.y = 1.45; head.scale.set(1.1, 0.95, 1); alien.add(head);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), S.toonMat('#ffffff')); eye.position.set(s * 0.25, 1.55, 0.42); alien.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: '#1d2433', fog: false })); pupil.position.set(s * 0.25, 1.55, 0.6); alien.add(pupil);
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 5), S.toonMat('#5bc84e')); stalk.position.set(s * 0.25, 2.1, 0); stalk.rotation.z = -s * 0.3; alien.add(stalk);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd23f', fog: false })); tip.position.set(s * 0.36, 2.4, 0); alien.add(tip);
    }
    const arm = new THREE.Group(); arm.position.set(0.55 * side, 0.9, 0.1);
    const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6), S.toonMat('#7be86a')); armMesh.position.y = 0.4; arm.add(armMesh); alien.add(arm);
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 0), S.toonMat('#a8472f')); rock.scale.set(1.4, 0.9, 1); rock.position.set(0, 0.3, 0.9);
    const bubble = this.emojiSprite('👋', 1.5); bubble.position.set(0, 3.3, 0);
    const root = new THREE.Group(); root.add(alien, rock, bubble); root.position.copy(base);
    S.add(root);
    return { dur: 7, update: (p) => {
      const up = smooth(0, 0.18, p) * (1 - smooth(0.82, 1, p));
      alien.position.y = -1.9 + up * 1.9; bubble.visible = up > 0.9;
      arm.rotation.z = (2.3 + Math.sin(S.cur.t * 10) * 0.5) * -side;
      alien.rotation.y = Math.sin(S.cur.t * 2) * 0.3;
    } };
  }

  roverEvent(S) {
    const g = new THREE.Group();
    const m = (geom, color, x, y, z) => { const o = new THREE.Mesh(geom, S.toonMat(color)); o.position.set(x, y, z); g.add(o); return o; };
    m(new THREE.BoxGeometry(2.4, 0.8, 1.4), '#f4efe6', 0, 1.0, 0);
    m(new THREE.BoxGeometry(1.1, 0.6, 1), '#4d96ff', -0.3, 1.65, 0);
    m(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), '#2a1f3d', 0.8, 2.0, 0.3);
    m(new THREE.SphereGeometry(0.16, 8, 6), '#ff5f57', 0.8, 2.55, 0.3);
    const wheels = [];
    for (const x of [-0.85, 0, 0.85]) for (const z of [-0.8, 0.8]) { const w = m(new THREE.CylinderGeometry(0.4, 0.4, 0.28, 10), '#3a2f4f', x, 0.42, z); w.rotation.x = Math.PI / 2; wheels.push(w); }
    const from = new THREE.Vector3(-this.fx - 8, 0, -15.6).sub(this.camera.position), to = new THREE.Vector3(this.fx + 8, 0, -15.6).sub(this.camera.position);
    S.add(g);
    let honked = false;
    return { dur: 12, update: (p) => {
      g.position.lerpVectors(from, to, p); g.position.y += Math.abs(Math.sin(S.cur.t * 6)) * 0.05;
      wheels.forEach((w) => { w.rotation.y -= 0.2; });
      if (!honked && p > 0.45) { honked = true; this.sfx.tone(440, 440, 0.12, 'square', 0.15); this.sfx.tone(554, 554, 0.18, 'square', 0.15, 0.14); }
    } };
  }

  // ---------------------------------------------------------- input & UI
  bindInput() {
    const stage = this.$('stage');
    const pick = (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    };
    const hitBlock = () => this.raycaster.intersectObjects(this.blocks.filter((b) => b.state === 'idle').map((b) => b.mesh), false)[0];
    const setZoom = (z) => { this.zoomTarget = clamp(z, 0.55, 1.4); };
    let tap = null, pinch = null;

    // a tap is judged on release, so a second finger landing (pinch) never taps a block by accident
    stage.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic or unsupported pointer */ }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, ly: e.clientY });
      if (this.pointers.size === 1) tap = { id: e.pointerId, x: e.clientX, y: e.clientY };
      else {
        tap = null;
        const [a, b] = [...this.pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoomTarget };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p) {
        const dy = e.clientY - p.ly;
        p.x = e.clientX; p.y = e.clientY; p.ly = e.clientY;
        // one-finger swipe tilts the camera: swipe down = look more top-down, swipe up = look towards the horizon
        if (this.pointers.size === 1 && (!tap || tap.id !== e.pointerId)) this.pitchTarget = clamp(this.pitchTarget + dy * 0.22, 5, 58);
        if (this.pointers.size === 2 && pinch) {
          const [a, b] = [...this.pointers.values()];
          setZoom(pinch.zoom * pinch.dist / (Math.hypot(a.x - b.x, a.y - b.y) || 1));   // fingers apart = zoom in
        }
        if (tap && tap.id === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 14) tap = null;
      }
      if (e.pointerType === 'mouse' && this.state === 'playing') {
        pick(e);
        const hit = hitBlock();
        this.hover = hit ? hit.object.userData.block : null;
        stage.style.cursor = hit ? 'pointer' : 'default';
      }
    });
    const release = (e, cancelled) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) pinch = null;
      if (!tap || tap.id !== e.pointerId) return;
      const t = tap; tap = null;
      if (cancelled || this.state !== 'playing') return;
      pick({ clientX: t.x, clientY: t.y });
      const hit = hitBlock();
      if (hit) { this.onTap(hit.object.userData.block); return; }
      if (this.raycaster.intersectObjects([this.billFace, this.emojiPlane], false).length) this.hear();
    };
    stage.addEventListener('pointerup', (e) => release(e, false));
    stage.addEventListener('pointercancel', (e) => release(e, true));
    stage.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(this.zoomTarget * Math.exp(e.deltaY * 0.0012)); }, { passive: false });

    // no right-click menu, no select-all on double tap, no browser page-zoom gestures (inputs keep normal behaviour)
    const inField = (e) => e.target.closest && e.target.closest('input, textarea');
    document.addEventListener('contextmenu', (e) => { if (!inField(e)) e.preventDefault(); });
    document.addEventListener('selectstart', (e) => { if (!inField(e)) e.preventDefault(); });
    document.addEventListener('dblclick', (e) => { if (!inField(e)) e.preventDefault(); });
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(g, (e) => e.preventDefault());
  }

  hear() { if (this.item) this.speak(this.item.w.toLowerCase()); }

  bindUI() {
    const $ = this.$;
    $('play').onclick = () => { this.sfx.unlock(); this.sfx.click(); this.showScreen(null); this.startRound(); };
    $('openSettings').onclick = () => { this.sfx.unlock(); this.sfx.click(); this.showScreen('settings'); };
    $('closeSettings').onclick = () => { this.sfx.click(); this.showScreen('menu'); };
    $('btnHome').onclick = () => { this.sfx.click(); this.state = 'menu'; this.sky.reset(); this.timers = []; for (const b of [...this.blocks]) this.removeBlock(b); this.showScreen('menu'); try { speechSynthesis.cancel(); } catch { /* none */ } };
    $('btnHear').onclick = () => { this.sfx.unlock(); this.hear(); };
    $('btnHint').onclick = () => { this.sfx.unlock(); if (this.state === 'playing') this.hint(); };
    $('btnSound').onclick = () => { this.sfx.unlock(); this.settings.sound = !this.settings.sound; this.sfx.on = this.settings.sound; this.saveSettings(); this.renderSettings(); };
    $('addWord').onclick = () => this.addWord();
    $('newWord').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.addWord(); });
    document.querySelectorAll('.toggle').forEach((b) => { b.onclick = () => { const k = b.dataset.opt; this.settings[k] = !this.settings[k]; if (k === 'sound') this.sfx.on = this.settings.sound; this.saveSettings(); this.renderSettings(); this.sfx.click(); }; });
    $('extraSeg').querySelectorAll('button').forEach((b) => { b.onclick = () => { this.settings.extra = Number(b.dataset.n); this.saveSettings(); this.renderSettings(); }; });
    this.emojiPick = '⭐';
    const grid = $('emojiGrid');
    EMOJI_CHOICES.forEach((e) => {
      const b = document.createElement('button'); b.textContent = e;
      b.onclick = () => { this.emojiPick = e; this.renderSettings(); };
      grid.appendChild(b);
    });
  }

  showScreen(name) {
    for (const id of ['menu', 'settings']) this.$(id).classList.toggle('hidden', id !== name);
    if (name) this.$('hud').classList.add('off');
  }

  renderSettings() {
    const s = this.settings;
    const labels = { sound: ['🔊 Sound effects', '🔇 Sound effects'], voice: ['🗣️ Say the words', '🤐 Say the words'], autoHint: ['💡 Helpful hints', '💡 Helpful hints'], ghost: ['👀 Faint letters on shelf', '👀 Faint letters on shelf'] };
    document.querySelectorAll('.toggle').forEach((b) => { const on = s[b.dataset.opt]; b.textContent = `${labels[b.dataset.opt][on ? 0 : 1]}: ${on ? 'ON' : 'OFF'}`; b.classList.toggle('off', !on); });
    this.$('extraSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === s.extra));
    this.$('btnSound').textContent = s.sound ? '🔊' : '🔇';
    const off = new Set(s.disabled), list = this.$('wordList');
    list.innerHTML = '';
    const customSet = new Set(s.custom.map((c) => c.w));
    for (const item of this.allWords()) {
      const chip = document.createElement('button');
      chip.className = 'word-chip' + (off.has(item.w) ? ' off' : '');
      chip.innerHTML = `<span class="e">${item.e}</span><span>${item.w}</span>`;
      chip.onclick = () => {
        const nowOff = new Set(this.settings.disabled);
        if (nowOff.has(item.w)) nowOff.delete(item.w);
        else if (this.allWords().length - nowOff.size > 1) nowOff.add(item.w);
        else return this.msg('Keep at least one word on!');
        this.settings.disabled = [...nowOff]; this.bag = []; this.saveSettings(); this.renderSettings();
      };
      if (customSet.has(item.w)) {
        const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Delete ' + item.w);
        x.onclick = (ev) => { ev.stopPropagation(); this.settings.custom = this.settings.custom.filter((c) => c.w !== item.w); this.settings.disabled = this.settings.disabled.filter((w) => w !== item.w); this.bag = []; this.saveSettings(); this.renderSettings(); };
        chip.appendChild(x);
      }
      list.appendChild(chip);
    }
    this.$('wordCount').textContent = `(${this.enabledWords().length} on)`;
    this.$('emojiGrid').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === this.emojiPick));
  }

  msg(text, ok = false) { const m = this.$('addMsg'); m.textContent = text; m.classList.toggle('ok', ok); }

  addWord() {
    const w = this.$('newWord').value.toUpperCase().replace(/[^A-Z]/g, '');
    if (w.length < 2) return this.msg('Type a word with at least 2 letters (A–Z).');
    if (w.length > 10) return this.msg('That word is too long — 10 letters at most.');
    if (this.allWords().some((x) => x.w === w)) return this.msg('That word is already in the list!');
    this.settings.custom.push({ w, e: this.emojiPick });
    this.saveSettings(); this.bag = [];
    this.$('newWord').value = '';
    this.msg(`Added ${w} ${this.emojiPick}`, true);
    this.renderSettings();
  }

  // ---------------------------------------------------------- loop
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.update(dt);
    this.render(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    this.sky.update(dt, this.state === 'playing' || this.state === 'celebrate');
    this.timers = this.timers.filter((tm) => { tm.t -= dt; if (tm.t <= 0) { tm.fn(); return false; } return true; });

    if (this.state === 'playing') {
      this.idle += dt;
      if (this.settings.autoHint && this.idle > 10) { this.idle = 0; this.hint(); }
    }
    for (const b of [...this.blocks]) {
      b.t += dt;
      const m = b.mesh;
      if (b.state === 'wait') {
        if (b.t >= b.delay) { b.state = 'pop'; b.t = 0; b.shadow.visible = true; this.sfx.pop(); }
      } else if (b.state === 'pop') {
        const u = clamp(b.t / 0.45, 0, 1);
        m.scale.setScalar(Math.max(0.001, u < 1 ? 1 + Math.sin(u * Math.PI) * 0.25 - (1 - u) * (1 - u) : 1));
        m.position.y = this.bs / 2 + (1 - u) * (1 - u) * 6;
        if (u >= 1) b.state = 'idle';
      } else if (b.state === 'idle') {
        const bounce = b.hint > 0 ? Math.abs(Math.sin(this.clock * 7 + b.ph)) * 0.7 : 0;
        m.position.y = this.bs / 2 + Math.sin(this.clock * 2 + b.ph) * 0.05 + bounce;
        m.rotation.y = b.baseRot + Math.sin(this.clock * 1.3 + b.ph) * 0.05;
        const target = this.hover === b ? 1.12 : 1;
        m.scale.setScalar(lerp(m.scale.x, target, 0.25));
        if (b.hint > 0) { b.hint -= dt; b.ring.visible = b.hint > 0; b.ring.scale.setScalar(1 + Math.sin(this.clock * 8) * 0.1); b.ring.position.y = -m.position.y + 0.1; }
        else b.ring.visible = false;
        b.shadow.scale.setScalar(1 - bounce * 0.2);
      } else if (b.state === 'roll') {
        const u = clamp(b.t / b.dur, 0, 1), e = 1 - Math.pow(1 - u, 1.6);
        m.position.x = lerp(b.from.x, b.to.x, e); m.position.z = lerp(b.from.z, b.to.z, e);
        const climb = smooth(0.55, 1, u);
        m.position.y = lerp(this.bs / 2, b.to.y, climb) + Math.sin(Math.PI * smooth(0.45, 1, u)) * 0.9;
        const dx = b.to.x - b.from.x, dz = b.to.z - b.from.z, len = Math.max(0.001, Math.hypot(dx, dz));
        const axis = new THREE.Vector3(dz / len, 0, -dx / len);
        const q = new THREE.Quaternion().setFromAxisAngle(axis, (b.dist * e) / (this.bs / 2)).multiply(b.q0);
        q.slerp(new THREE.Quaternion(), smooth(0.7, 1, u));
        m.quaternion.copy(q);
        b.shadow.position.set(m.position.x, 0.06, m.position.z); b.shadow.visible = climb < 0.5;
        if (Math.random() < 0.5 && u < 0.85) this.burst(new THREE.Vector3(m.position.x, 0.2, m.position.z), ['#e0a070', '#ffffff'], 1, 0.3);
        if (u >= 1) {
          b.state = 'placed'; b.t = 0; b.shadow.visible = false;
          this.sfx.thud(); this.burst(new THREE.Vector3(b.to.x, b.to.y, b.to.z + 0.5), ['#ffd23f', '#ffffff'], 8, 0.7);
          this.placed++;
          if (this.placed === this.word.length) this.complete();
        }
      } else if (b.state === 'placed') {
        // settle with a little squash, then (during the celebration) hop in order
        const sq = Math.max(0, 1 - b.t * 4);
        const hopT = this.state === 'celebrate' ? this.celT - 0.5 - b.slot * 0.13 : -1;
        const hop = hopT > 0 && hopT < 0.5 ? Math.sin((hopT / 0.5) * Math.PI) * 0.7 : 0;
        m.scale.set(1 + sq * 0.12, 1 - sq * 0.15, 1 + sq * 0.12);
        m.position.y = b.to.y + hop;
      } else if (b.state === 'leave') {
        if (b.t > 0) { const u = clamp(b.t / 0.35, 0, 1); m.scale.setScalar(Math.max(0.001, 1 - u)); b.shadow.scale.setScalar(Math.max(0.001, 1 - u)); if (u >= 1) this.removeBlock(b); }
      }
    }
    if (this.state === 'celebrate') this.celT += dt;

    const bits = [];
    for (const p of this.bits) {
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.mesh); continue; }
      p.v.y -= 7 * dt;
      p.mesh.position.addScaledVector(p.v, dt);
      if (p.mesh.position.y < 0.15) { p.mesh.position.y = 0.15; p.v.y *= -0.35; p.v.x *= 0.8; p.v.z *= 0.8; }
      p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt; p.mesh.rotation.z += p.spin.z * dt;
      p.mesh.scale.setScalar(clamp(p.life / 0.35, 0.01, 1));
      bits.push(p);
    }
    this.bits = bits;
  }

  render(dt) {
    const t = this.clock;
    // billboard picture pops in, bobs, and spins a little when the word is finished
    this.pictureT = (this.pictureT ?? 1) + dt;
    const pop = clamp(this.pictureT / 0.5, 0, 1);
    const bob = 1 + Math.sin(t * 2) * 0.03 + (this.state === 'celebrate' ? Math.sin(t * 12) * 0.06 : 0);
    this.emojiPlane.scale.setScalar(Math.max(0.001, (pop < 1 ? 1 + Math.sin(pop * Math.PI) * 0.3 - (1 - pop) * (1 - pop) : 1) * bob));
    this.emojiPlane.visible = !!this.item;
    this.billFace.material.color.setScalar(1);
    this.billLights.forEach((l, i) => { l.material.emissiveIntensity = this.state === 'celebrate' ? (Math.sin(t * 10 + i) > 0 ? 1.2 : 0.2) : 0.7; });
    for (const l of this.shelfLamps) l.material.emissiveIntensity = this.state === 'celebrate' ? (Math.sin(t * 10) > 0 ? 1.4 : 0.2) : 0.6;
    const blink = Math.sin(t * 4) > 0 ? 1 : 0.15;
    for (const l of this.beacons) l.material.emissiveIntensity = blink;
    this.moons[0].rotation.y = t * 0.05; this.moons[1].rotation.y = -t * 0.04;
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-dt * 10));
    this.pitch += (this.pitchTarget - this.pitch) * (1 - Math.exp(-dt * 10));
    const pr = THREE.MathUtils.degToRad(this.pitch), d = this.baseDist * this.zoom;
    this.camera.position.set(Math.sin(t * 0.25) * 0.18, this.lookTarget.y + Math.sin(pr) * d + Math.sin(t * 0.2) * 0.08, this.lookTarget.z + Math.cos(pr) * d);
    this.camY = this.camera.position.y;
    this.applyPitchSky();
    this.camera.lookAt(this.lookTarget);
    this.renderer.render(this.scene, this.camera);
  }
}

window.spell = new SpellGame();
