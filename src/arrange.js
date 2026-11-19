import * as THREE from 'three';
import { ArrangeAudio } from './arrange-audio.js';
import { MarsAmbience } from './arrange-world.js';
import { numberToWords, capitalize } from './arrange-words.js';

// Match Tetris's three-step toon ramp and dark inverted-hull outlines.
const ramp = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;

const colors = ['#4fd6f5', '#ffd23f', '#b36bff', '#7ee04e', '#ff5f57', '#4d96ff', '#ff8a3d'];
const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x1d2433, side: THREE.BackSide });
const materialCache = new Map();
const boxGeometry = new THREE.BoxGeometry(1.16, 0.9, 1.16);
const labelGeometry = new THREE.PlaneGeometry(0.9, 0.7);
const topLabelGeometry = new THREE.PlaneGeometry(0.9, 0.9);
const shardGeometry = new THREE.BoxGeometry(0.23, 0.23, 0.23);

function toon(color) {
  if (!materialCache.has(color)) materialCache.set(color, new THREE.MeshToonMaterial({ color, gradientMap: ramp }));
  return materialCache.get(color);
}

function mesh(parent, geometry, color, x = 0, y = 0, z = 0, outlined = true) {
  const item = new THREE.Mesh(geometry, toon(color));
  item.position.set(x, y, z);
  item.castShadow = true;
  item.receiveShadow = true;
  if (outlined) {
    const outline = new THREE.Mesh(geometry, outlineMaterial);
    outline.scale.setScalar(1.055);
    outline.raycast = () => {};
    item.add(outline);
  }
  parent.add(item);
  return item;
}

function labelTexture(number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.roundRect(18, 18, 220, 220, 32);
  ctx.fill();
  ctx.strokeStyle = '#2a1f3d';
  ctx.lineWidth = 11;
  ctx.stroke();
  const digits = String(number).length;
  ctx.font = `900 ${digits >= 4 ? 95 : digits === 3 ? 121 : digits === 2 ? 154 : 188}px Fredoka, Arial, sans-serif`;
  ctx.fillStyle = '#2a1f3d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 128, 135);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// Word cards: a cream slab with the spelled number on the front half and a dashed drop spot behind it.
const CARD = { width: 2.6, depth: 2.05, height: .14, gapX: 2.95, gapZ: 2.45, rowZ: -2.15 };
const cardGeometry = new THREE.BoxGeometry(CARD.width, CARD.height, CARD.depth);
const cardTextGeometry = new THREE.PlaneGeometry(2.44, .94);
const dropSpotGeometry = new THREE.PlaneGeometry(1.08, 1.08);
const MATCH_LIMIT = 20;
const CARD_COLORS = { idle: '#fff1d6', hover: '#ffd23f', wrong: '#ff8f80', matched: '#8ee04e' };

function wordTexture(word) {
  const canvas = document.createElement('canvas');
  canvas.width = 520;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.roundRect(8, 8, 504, 184, 26);
  ctx.fill();
  ctx.strokeStyle = '#2a1f3d';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#2a1f3d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Shrink the font until the word fits in at most three lines. Lines may squeeze up to 20%
  // horizontally first, so long words like "Seventeen" stay about as tall as short ones.
  const maxWidth = 470, squeeze = .8;
  const tokens = word.split(' ');
  let size = 136, lines = [word];
  for (; size >= 34; size -= 4) {
    ctx.font = `800 ${size}px Fredoka, Arial, sans-serif`;
    lines = [];
    let line = '';
    for (const token of tokens) {
      const next = line ? `${line} ${token}` : token;
      if (line && ctx.measureText(next).width > maxWidth / squeeze) { lines.push(line); line = token; }
      else line = next;
    }
    lines.push(line);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= maxWidth / squeeze && lines.length * size * 1.05 <= 176) break;
  }
  const lineHeight = size * 1.05;
  lines.forEach((l, i) => {
    ctx.save();
    ctx.translate(260, 104 + (i - (lines.length - 1) / 2) * lineHeight);
    ctx.scale(Math.min(1, maxWidth / ctx.measureText(l).width), 1);
    ctx.fillText(l, 0, 0);
    ctx.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

let dropSpotTexture = null;
function dropSpotMaterial() {
  if (!dropSpotTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = 'rgba(42, 31, 61, .55)';
    ctx.lineWidth = 7;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.roundRect(8, 8, 112, 112, 18);
    ctx.stroke();
    dropSpotTexture = new THREE.CanvasTexture(canvas);
    dropSpotTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshBasicMaterial({ map: dropSpotTexture, transparent: true, depthWrite: false });
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

class ArrangeNumbers {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#ffbc8d');
    this.scene.fog = new THREE.Fog('#ffbc8d', 36, 85);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.$('stage').appendChild(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 160);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);
    this.audio = new ArrangeAudio();
    this.ambience = new MarsAmbience(this.scene, mesh, this.audio, (name) => this.showEvent(name));
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.15);
    this.cardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CARD.height);
    this.mode = 'order';
    this.cards = [];
    this.cardPickables = [];
    this.selected = null;
    this.dragging = null;
    this.clock = 0;
    this.decor = [];
    this.panOffset = new THREE.Vector3();
    this.baseCameraPosition = new THREE.Vector3();
    this.pointers = new Map();
    this.gestureUsed = false;
    this.lastTap = null;
    this.blocks = new Map();
    this.pickables = [];
    this.textures = [];
    this.labelMaterials = [];
    this.moves = [];
    this.bursts = [];
    this.particles = [];
    this.zoom = 1;
    this.active = false;
    this.lastTime = 0;
    this.setupWorld();
    this.bindEvents();
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  setupWorld() {
    this.scene.add(new THREE.HemisphereLight(0xfff5df, 0xb45850, 2.2));
    const sun = new THREE.DirectionalLight(0xfff1d7, 2.6);
    sun.position.set(-12, 22, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -25; sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 25; sun.shadow.camera.bottom = -25;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.001;
    this.scene.add(sun);

    const ground = mesh(this.scene, new THREE.PlaneGeometry(120, 120), '#c95b3f', 0, -0.04, 0, false);
    ground.rotation.x = -Math.PI / 2;
    ground.castShadow = false;
    ground.receiveShadow = true;

    const rockGeometry = new THREE.IcosahedronGeometry(0.6, 0);
    const bumpGeometry = new THREE.IcosahedronGeometry(0.9, 0);
    const random = (() => { let n = 4187; return () => ((n = (1664525 * n + 1013904223) >>> 0) / 4294967296); })();
    for (let i = 0; i < 65; i++) {
      const x = (random() - .5) * 38;
      const z = (random() - .5) * 45;
      if (Math.abs(x) < 10 && z > -10 && z < 18) continue;
      const size = .35 + random() * 1.1;
      const rock = mesh(this.scene, random() < .7 ? rockGeometry : bumpGeometry, random() < .5 ? '#a94839' : '#e98758', x, size * .25, z, true);
      this.decor.push(rock);
      rock.scale.set(size, size * .55, size * .8);
      rock.rotation.y = random() * Math.PI;
    }
    for (let i = 0; i < 22; i++) {
      const x = (random() - .5) * 43;
      const z = (random() - .5) * 46;
      if (Math.abs(x) < 10 && z > -10 && z < 18) continue;
      const dome = mesh(this.scene, new THREE.ConeGeometry(.25, .9, 5), '#83b75e', x, .43, z, true);
      this.decor.push(dome);
      dome.rotation.z = (random() - .5) * .4;
    }
  }

  bindEvents() {
    this.$('rangeForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const startInput = this.$('rangeStart').value.trim();
      const endInput = this.$('rangeEnd').value.trim();
      const start = Number(startInput);
      const end = Number(endInput);
      const mode = this.selectedMode();
      const limit = mode === 'match' ? MATCH_LIMIT : 60;
      const error = !startInput || !endInput || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end > 9999 || end < start
        ? 'Enter a whole-number range from 0 to 9999, with the end after the start.'
        : end - start + 1 > limit
          ? mode === 'match'
            ? `Choose ${limit} numbers or fewer so the word cards stay easy to read.`
            : `Choose ${limit} numbers or fewer so the blocks stay easy to tap on phones.`
          : '';
      this.$('validation').textContent = error;
      if (!error) this.start(start, end, mode);
    });
    for (const radio of document.querySelectorAll('input[name="mode"]')) {
      radio.addEventListener('change', () => this.updateModeText());
    }
    this.$('newRange').addEventListener('click', () => this.showMenu());
    this.$('chooseRange').addEventListener('click', () => this.showMenu());
    this.$('playAgain').addEventListener('click', () => this.start(this.startNumber, this.endNumber, this.mode));
    this.$('zoomIn').addEventListener('click', () => this.setZoom(this.zoom * 1.2));
    this.$('zoomOut').addEventListener('click', () => this.setZoom(this.zoom / 1.2));
    this.$('centerView').addEventListener('click', () => {
      this.panOffset.set(0, 0, 0);
      this.applyPan();
      this.setZoom(1);
    });
    this.$('eventBtn').addEventListener('click', () => this.ambience.next());
    this.$('soundBtn').addEventListener('click', () => {
      this.audio.toggle();
      this.updateSoundButton();
    });
    this.renderer.domElement.addEventListener('wheel', (event) => {
      if (!this.active) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) this.setZoom(this.zoom * (event.deltaY < 0 ? 1.1 : .9));
      else this.panByPixels(-event.deltaX * .5, -event.deltaY * .5);
    }, { passive: false });
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
    canvas.addEventListener('pointercancel', (event) => this.pointerCancel(event));
    document.addEventListener('contextmenu', (event) => {
      if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    });
    document.addEventListener('dblclick', (event) => {
      if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    });
    document.addEventListener('selectstart', (event) => {
      if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    });
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !(event.target instanceof HTMLInputElement)) event.preventDefault();
    });
    window.addEventListener('resize', () => this.resize());
  }

  selectedMode() {
    return document.querySelector('input[name="mode"]:checked')?.value === 'match' ? 'match' : 'order';
  }

  updateModeText() {
    const match = this.selectedMode() === 'match';
    this.$('modeSub').textContent = match
      ? 'Pick a range, then drag each number cube onto the card that spells it — or tap a cube, then tap its card!'
      : 'Pick a range, then tap the colorful blocks from smallest to largest. Each correct block rolls into the number wall!';
    this.$('startBtn').textContent = match ? 'Start matching' : 'Start arranging';
    this.$('modeTip').textContent = match ? `Try 1–10 or 11–20 · up to ${MATCH_LIMIT} cards` : 'Try 1–10 or 51–90 · up to 60 blocks';
    this.$('validation').textContent = '';
  }

  speak(text) {
    if (!this.audio.enabled || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = .85;
      utterance.pitch = 1.2;
      utterance.lang = 'en-US';
      speechSynthesis.speak(utterance);
    } catch { /* speech unavailable */ }
  }

  updateSoundButton() {
    const button = this.$('soundBtn');
    button.textContent = this.audio.enabled ? '🔊' : '🔇';
    button.setAttribute('aria-label', this.audio.enabled ? 'Mute sound' : 'Unmute sound');
    button.setAttribute('aria-pressed', String(this.audio.enabled));
  }

  showEvent(name) {
    const node = this.$('eventTag');
    node.textContent = name;
    node.classList.remove('hidden');
    clearTimeout(this.eventTimer);
    this.eventTimer = setTimeout(() => node.classList.add('hidden'), 3500);
  }

  pointerDown(event) {
    if (!this.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.audio.unlock();
    this.renderer.domElement.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, grab: null };
    // In match mode a press that starts on a cube can drag it; a press on empty ground still pans.
    if (this.mode === 'match' && this.pointers.size === 0 && !this.dragging) point.grab = this.fieldBlockAt(event.clientX, event.clientY);
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size > 1) {
      this.gestureUsed = true;
      this.cancelDrag();
    }
  }

  pointerMove(event) {
    const point = this.pointers.get(event.pointerId);
    if (!point || !this.active) return;
    const oldX = point.x, oldY = point.y;
    const oldCenter = this.pointerCenter();
    const oldDistance = this.pointerDistance();
    point.x = event.clientX;
    point.y = event.clientY;
    if (this.pointers.size > 1) {
      this.gestureUsed = true;
      const nextDistance = this.pointerDistance();
      const before = this.groundAt(oldCenter.x, oldCenter.y);
      if (oldDistance > 0) this.setZoom(this.zoom * nextDistance / oldDistance);
      const center = this.pointerCenter();
      const after = this.groundAt(center.x, center.y);
      if (before && after) this.shiftPan(before.sub(after));
      for (const item of this.pointers.values()) item.moved = true;
    } else if (point.moved || Math.hypot(point.x - point.startX, point.y - point.startY) > 7) {
      point.moved = true;
      if (point.grab && !this.dragging && point.grab.state === 'field') this.beginDrag(point.grab, event.pointerId);
      if (this.dragging?.pointerId === event.pointerId) this.dragTo(point.x, point.y);
      else if (!this.dragging) this.panBetween(oldX, oldY, point.x, point.y);
    }
  }

  pointerUp(event) {
    const point = this.pointers.get(event.pointerId);
    if (!point) return;
    if (this.dragging?.pointerId === event.pointerId) {
      this.pointers.delete(event.pointerId);
      if (this.pointers.size === 0) this.gestureUsed = false;
      this.drop();
      return;
    }
    const tapped = this.active && !this.gestureUsed && !point.moved &&
      Math.hypot(event.clientX - point.startX, event.clientY - point.startY) < 8;
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) this.gestureUsed = false;
    if (tapped) {
      const now = performance.now();
      const repeated = this.lastTap && now - this.lastTap.time < 330 &&
        Math.hypot(event.clientX - this.lastTap.x, event.clientY - this.lastTap.y) < 28;
      this.lastTap = { x: event.clientX, y: event.clientY, time: now };
      if (!repeated) this.pick(event.clientX, event.clientY);
    }
  }

  pointerCancel(event) {
    if (this.dragging?.pointerId === event.pointerId) this.cancelDrag();
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) this.gestureUsed = false;
  }

  pointerCenter() {
    const points = [...this.pointers.values()];
    return { x: points.reduce((n, p) => n + p.x, 0) / points.length, y: points.reduce((n, p) => n + p.y, 0) / points.length };
  }

  pointerDistance() {
    const points = [...this.pointers.values()];
    return points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  groundAt(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
  }

  panBetween(fromX, fromY, toX, toY) {
    const before = this.groundAt(fromX, fromY);
    const after = this.groundAt(toX, toY);
    if (before && after) this.shiftPan(before.sub(after));
  }

  panByPixels(dx, dy) {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    this.panBetween(cx, cy, cx + dx, cy + dy);
  }

  shiftPan(delta) {
    this.panOffset.add(delta);
    const maxX = this.layout ? Math.max(7, this.layout.halfWidth ? this.layout.halfWidth * 2 : this.layout.cols * this.layout.spacing) : 10;
    const maxZ = this.layout ? Math.max(8, this.layout.panZ ?? this.layout.rows * this.layout.spacing) : 10;
    this.panOffset.x = THREE.MathUtils.clamp(this.panOffset.x, -maxX, maxX);
    this.panOffset.y = 0;
    this.panOffset.z = THREE.MathUtils.clamp(this.panOffset.z, -maxZ, maxZ);
    this.applyPan();
  }

  applyPan() {
    this.camera.position.copy(this.baseCameraPosition).add(this.panOffset);
    this.camera.updateMatrixWorld();
  }

  clearGame() {
    this.active = false;
    this.dynamic.clear();
    for (const texture of this.textures) texture.dispose();
    for (const material of this.labelMaterials) material.dispose();
    this.textures = [];
    this.labelMaterials = [];
    this.blocks.clear();
    this.pickables = [];
    this.cards = [];
    this.cardPickables = [];
    this.selected = null;
    this.dragging = null;
    this.moves = [];
    for (const particle of this.particles) this.scene.remove(particle.mesh);
    this.particles = [];
    this.bursts = [];
    this.layout = null;
    this.ambience.reset(null);
    this.pointers.clear();
    this.gestureUsed = false;
    this.lastTap = null;
  }

  showMenu() {
    this.clearGame();
    this.$('complete').classList.add('hidden');
    this.$('hud').classList.add('hidden');
    this.$('zoomControls').classList.add('hidden');
    this.$('worldActions').classList.add('hidden');
    this.$('eventTag').classList.add('hidden');
    this.$('menu').classList.remove('hidden');
    this.$('validation').textContent = '';
    this.hideToast();
    this.resize();
  }

  start(start, end, mode = 'order') {
    this.audio.unlock();
    this.clearGame();
    this.mode = mode;
    this.startNumber = start;
    this.endNumber = end;
    this.nextNumber = start;
    this.misses = 0;
    this.stacked = 0;
    this.total = end - start + 1;
    const cols = Math.min(10, Math.max(4, Math.ceil(this.total / 6)));
    const slotCount = this.total + Math.max(6, Math.ceil(this.total * .2));
    const rows = Math.ceil(slotCount / cols);
    const wallRows = Math.ceil(this.total / cols);
    this.layout = { cols, rows, wallRows, wallZ: -5.5, spacing: 1.62, slots: [], occupied: new Map() };
    if (mode === 'match') {
      const cardCols = Math.min(this.total, window.innerWidth < 650 ? 2 : this.total <= 8 ? 4 : 5);
      const cardRows = Math.ceil(this.total / cardCols);
      Object.assign(this.layout, {
        cardCols,
        cardRows,
        halfWidth: Math.max(cols * 1.62, cardCols * CARD.gapX) / 2,
        zMin: CARD.rowZ - (cardRows - 1) * CARD.gapZ - CARD.depth / 2 - .5,
        yMax: 1.3,
        panZ: rows * 1.62 + cardRows * CARD.gapZ,
      });
    }
    this.ambience.reset(this.layout);
    // Keep background rocks off the play area (tall word-card grids reach past the cleared zone).
    const clearX = (this.layout.halfWidth ?? cols * 1.62 / 2) + 1;
    const clearZMin = (this.layout.zMin ?? -7) - .5;
    const clearZMax = .8 + rows * 1.62 + 1;
    for (const item of this.decor) {
      item.visible = !(Math.abs(item.position.x) < clearX && item.position.z > clearZMin && item.position.z < clearZMax);
    }
    for (let i = 0; i < rows * cols; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      this.layout.slots.push(new THREE.Vector3((c - (cols - 1) / 2) * 1.62, .5, .8 + r * 1.62));
    }

    if (mode === 'match') this.buildCards(start);
    else {
      const backingWidth = cols * 1.35 + .32;
      const backingHeight = wallRows * 1.02 + .8;
      mesh(this.dynamic, new THREE.BoxGeometry(backingWidth, backingHeight, .42), '#f4d5ac', 0, backingHeight / 2, -6.37);
      mesh(this.dynamic, new THREE.BoxGeometry(backingWidth + .5, .34, 1.35), '#a84437', 0, .1, -5.9);
      mesh(this.dynamic, new THREE.BoxGeometry(.3, backingHeight + .35, .58), '#57384b', -backingWidth / 2, backingHeight / 2, -6.12);
      mesh(this.dynamic, new THREE.BoxGeometry(.3, backingHeight + .35, .58), '#57384b', backingWidth / 2, backingHeight / 2, -6.12);
    }

    const slots = shuffle(Array.from({ length: this.layout.slots.length }, (_, i) => i));
    const numbers = shuffle(Array.from({ length: this.total }, (_, i) => start + i));
    numbers.forEach((number, i) => {
      const color = colors[(number - start) % colors.length];
      const root = new THREE.Group();
      const body = mesh(root, boxGeometry, color);
      const texture = labelTexture(number);
      this.textures.push(texture);
      const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      this.labelMaterials.push(labelMaterial);
      const top = new THREE.Mesh(topLabelGeometry, labelMaterial);
      top.position.y = .457;
      top.rotation.x = -Math.PI / 2;
      root.add(top);
      const front = new THREE.Mesh(labelGeometry, labelMaterial);
      front.position.set(0, 0, .589);
      root.add(front);
      for (const clickable of [body, top, front]) {
        clickable.userData.number = number;
        this.pickables.push(clickable);
      }
      const slot = slots[i];
      root.position.copy(this.layout.slots[slot]);
      this.layout.occupied.set(slot, number);
      this.dynamic.add(root);
      this.blocks.set(number, { number, color, root, slot, state: 'field' });
    });

    this.zoom = 1;
    this.panOffset.set(0, 0, 0);
    this.active = true;
    this.$('menu').classList.add('hidden');
    this.$('complete').classList.add('hidden');
    this.$('hud').classList.remove('hidden');
    this.$('zoomControls').classList.remove('hidden');
    this.$('worldActions').classList.remove('hidden');
    this.$('eventTag').classList.add('hidden');
    this.updateSoundButton();
    this.hideToast();
    this.$('targetLabel').textContent = mode === 'match' ? 'Picked' : 'Tap next';
    this.$('progressLabel').textContent = mode === 'match' ? 'Matched' : 'Stacked';
    this.updateHud();
    this.resize();
    this.toast(mode === 'match' ? 'Drag each number onto its word card!' : `Find ${start} to begin!`);
  }

  buildCards(start) {
    const { cardCols } = this.layout;
    const order = shuffle(Array.from({ length: this.total }, (_, i) => start + i));
    order.forEach((number, i) => {
      const c = i % cardCols;
      const r = Math.floor(i / cardCols);
      const rowCount = Math.min(cardCols, this.total - r * cardCols);
      const root = new THREE.Group();
      root.position.set((c - (rowCount - 1) / 2) * CARD.gapX, 0, CARD.rowZ - r * CARD.gapZ);
      const slab = mesh(root, cardGeometry, CARD_COLORS.idle, 0, CARD.height / 2, 0);
      const word = capitalize(numberToWords(number));
      const texture = wordTexture(word);
      this.textures.push(texture);
      const textMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
      this.labelMaterials.push(textMaterial);
      const text = new THREE.Mesh(cardTextGeometry, textMaterial);
      text.rotation.x = -Math.PI / 2;
      text.position.set(0, CARD.height + .006, .5);
      root.add(text);
      const spotMaterial = dropSpotMaterial();
      this.labelMaterials.push(spotMaterial);
      const spot = new THREE.Mesh(dropSpotGeometry, spotMaterial);
      spot.rotation.x = -Math.PI / 2;
      spot.position.set(0, CARD.height + .006, -.47);
      root.add(spot);
      const card = { number, word, root, slab, spot, state: 'open', flash: 0 };
      for (const clickable of [slab, text, spot]) {
        clickable.userData.card = card;
        this.cardPickables.push(clickable);
      }
      this.dynamic.add(root);
      this.cards.push(card);
    });
  }

  updateHud() {
    if (this.mode === 'match') {
      const picked = this.dragging?.block ?? this.selected;
      this.$('nextNumber').textContent = this.stacked === this.total ? '✓' : picked ? picked.number : '?';
    } else {
      this.$('nextNumber').textContent = this.nextNumber <= this.endNumber ? this.nextNumber : '✓';
    }
    this.$('progress').textContent = `${this.stacked} / ${this.total}`;
    this.$('misses').textContent = this.misses;
  }

  setRay(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  fieldBlockAt(clientX, clientY) {
    this.setRay(clientX, clientY);
    const hit = this.raycaster.intersectObjects(this.pickables, false)
      .find(({ object }) => this.blocks.get(object.userData.number)?.state === 'field');
    return hit ? this.blocks.get(hit.object.userData.number) : null;
  }

  pick(clientX, clientY) {
    if (this.mode === 'match') return this.pickMatch(clientX, clientY);
    const block = this.fieldBlockAt(clientX, clientY);
    if (!block) return;
    if (block.number === this.nextNumber) this.correct(block);
    else this.wrong(block);
  }

  // ---- Match words mode ----

  pickMatch(clientX, clientY) {
    this.setRay(clientX, clientY);
    const hit = this.raycaster.intersectObjects([...this.pickables, ...this.cardPickables], false).find(({ object }) =>
      object.userData.card ? object.userData.card.state === 'open' : this.blocks.get(object.userData.number)?.state === 'field');
    if (!hit) return;
    const card = hit.object.userData.card;
    if (card) {
      if (this.selected) this.tryMatch(this.selected, card);
      else {
        this.flashCard(card, false);
        this.toast('Pick a number cube first!');
      }
      return;
    }
    const block = this.blocks.get(hit.object.userData.number);
    if (this.selected === block) {
      this.deselect();
      this.audio.drop();
    } else {
      this.deselect();
      this.selected = block;
      block.root.scale.setScalar(1.08);
      this.audio.pick();
      this.toast(`Now tap the card that spells ${block.number}`);
    }
    this.updateHud();
  }

  deselect() {
    if (!this.selected) return;
    const block = this.selected;
    this.selected = null;
    if (block.state === 'field') {
      block.root.position.copy(this.layout.slots[block.slot]);
      block.root.scale.setScalar(1);
    }
  }

  beginDrag(block, pointerId) {
    if (this.selected !== block) this.deselect();
    this.selected = null;
    block.state = 'dragging';
    block.root.scale.setScalar(1.08);
    this.dragging = { block, pointerId, hover: null };
    this.audio.pick();
    this.updateHud();
  }

  dragTo(clientX, clientY) {
    this.setRay(clientX, clientY);
    const point = this.raycaster.ray.intersectPlane(this.dragPlane, new THREE.Vector3());
    if (!point) return;
    const { block } = this.dragging;
    block.root.position.set(point.x, -this.dragPlane.constant, point.z);
    // The lifted cube floats above the cards, so target whichever card is visually under the finger.
    const onCards = this.raycaster.ray.intersectPlane(this.cardPlane, new THREE.Vector3());
    const hover = onCards ? this.cardUnder(onCards.x, onCards.z) : null;
    if (hover !== this.dragging.hover) {
      const previous = this.dragging.hover;
      this.dragging.hover = hover;
      if (previous) this.tintCard(previous);
      if (hover) this.tintCard(hover);
    }
  }

  cardUnder(x, z) {
    let best = null, bestDistance = Infinity;
    for (const card of this.cards) {
      if (card.state !== 'open') continue;
      const dx = Math.abs(x - card.root.position.x);
      const dz = Math.abs(z - card.root.position.z);
      if (dx > CARD.width / 2 + .25 || dz > CARD.depth / 2 + .25) continue;
      const distance = Math.hypot(dx, dz);
      if (distance < bestDistance) { best = card; bestDistance = distance; }
    }
    return best;
  }

  drop() {
    const { block, hover } = this.dragging;
    this.dragging = null;
    if (hover) this.tintCard(hover);
    if (hover) this.tryMatch(block, hover);
    else {
      this.audio.drop();
      this.returnToSlot(block);
    }
    this.updateHud();
  }

  cancelDrag() {
    if (!this.dragging) return;
    const { block, hover } = this.dragging;
    this.dragging = null;
    if (hover) this.tintCard(hover);
    this.returnToSlot(block);
    this.updateHud();
  }

  returnToSlot(block) {
    block.state = 'moving';
    const from = block.root.position.clone();
    this.moves.push({
      block, from, target: this.layout.slots[block.slot].clone(), elapsed: 0, duration: .34, arc: .45,
      scaleFrom: block.root.scale.x, scaleTo: 1,
      onDone: () => { block.state = 'field'; },
    });
  }

  tryMatch(block, card) {
    if (block === this.selected) this.selected = null;
    if (block.number === card.number) {
      this.audio.correct();
      this.speak(card.word);
      card.state = 'claimed';
      card.spot.visible = false;
      block.state = 'moving';
      this.layout.occupied.delete(block.slot);
      const scale = .85;
      const target = card.root.position.clone().add(new THREE.Vector3(0, CARD.height + .45 * scale, -.47));
      this.moves.push({
        block, from: block.root.position.clone(), target, elapsed: 0,
        duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? .22 : .62, arc: 1.1, spin: true,
        scaleFrom: block.root.scale.x, scaleTo: scale,
        onDone: () => {
          block.state = 'stacked';
          card.state = 'matched';
          this.tintCard(card);
          this.stacked++;
          this.audio.land();
          this.updateHud();
          if (this.stacked === this.total) this.finish();
        },
      });
      const claimed = this.cards.filter((c) => c.state !== 'open').length;
      this.toast(claimed === this.total ? 'Last one — you did it!' : `Yes! ${block.number} is “${card.word}”`);
    } else {
      this.audio.wrong();
      this.misses++;
      this.flashCard(card, true);
      this.returnToSlot(block);
      this.toast(`Oops! ${block.number} isn't “${card.word}” — try again`);
    }
    this.updateHud();
  }

  flashCard(card, wrong) {
    card.flash = wrong ? .55 : .3;
    card.flashColor = wrong ? CARD_COLORS.wrong : CARD_COLORS.hover;
    this.tintCard(card);
  }

  tintCard(card) {
    const color = card.state === 'matched' ? CARD_COLORS.matched
      : card.flash > 0 ? card.flashColor
        : this.dragging?.hover === card ? CARD_COLORS.hover
          : CARD_COLORS.idle;
    card.slab.material = toon(color);
  }

  correct(block) {
    this.audio.correct();
    block.state = 'moving';
    this.layout.occupied.delete(block.slot);
    const index = block.number - this.startNumber;
    const c = index % this.layout.cols;
    const r = Math.floor(index / this.layout.cols);
    const target = new THREE.Vector3((c - (this.layout.cols - 1) / 2) * 1.35, .53 + r * 1.02, this.layout.wallZ);
    this.moves.push({
      block, from: block.root.position.clone(), target, elapsed: 0, arc: 1.4, spin: true,
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? .22 : .72,
      onDone: () => {
        block.state = 'stacked';
        this.stacked++;
        this.audio.land();
        this.updateHud();
        if (this.stacked === this.total) this.finish();
      },
    });
    this.nextNumber++;
    this.updateHud();
    if (this.nextNumber <= this.endNumber) this.toast(`Nice! Find ${this.nextNumber}`);
    else this.toast('Last block rolling into place!');
  }

  wrong(block) {
    this.audio.wrong();
    block.state = 'burst';
    this.layout.occupied.delete(block.slot);
    block.root.visible = false;
    this.misses++;
    this.updateHud();
    this.toast(`${block.number} popped! Find ${this.nextNumber}`);
    const origin = block.root.position.clone();
    for (let i = 0; i < 10; i++) {
      const shard = new THREE.Mesh(shardGeometry, toon(block.color));
      shard.position.copy(origin);
      shard.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.scene.add(shard);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.8 + Math.random() * 3;
      this.particles.push({ mesh: shard, velocity: new THREE.Vector3(Math.cos(angle) * speed, 2.4 + Math.random() * 3, Math.sin(angle) * speed), age: 0 });
    }
    this.bursts.push({ block, oldSlot: block.slot, remaining: .68 });
  }

  freeSlot(exclude) {
    const free = [];
    for (let i = 0; i < this.layout.slots.length; i++) {
      if (!this.layout.occupied.has(i) && i !== exclude) free.push(i);
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : exclude;
  }

  finish() {
    this.audio.win();
    this.active = false;
    this.$('hud').classList.add('hidden');
    this.$('zoomControls').classList.add('hidden');
    this.$('worldActions').classList.add('hidden');
    const match = this.mode === 'match';
    this.$('finishText').textContent = match
      ? `Every number from ${this.startNumber} to ${this.endNumber} found its word card.`
      : `Every number from ${this.startNumber} to ${this.endNumber} is stacked on the Mars wall.`;
    const [one, many] = match ? ['match', 'matches'] : ['tap', 'taps'];
    this.$('finishMisses').textContent = this.misses === 0 ? `Flawless — no wrong ${many}!` : `${this.misses} wrong ${this.misses === 1 ? one : many} along the way.`;
    this.$('complete').classList.remove('hidden');
    this.hideToast();
  }

  toast(message) {
    const node = this.$('toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => node.classList.remove('show'), 1700);
  }

  hideToast() {
    clearTimeout(this.toastTimer);
    this.$('toast').classList.remove('show');
  }

  setZoom(value) {
    this.zoom = THREE.MathUtils.clamp(value, .7, 2.2);
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    const aspect = width / height;
    const layout = this.layout;
    const xHalf = layout ? (layout.halfWidth ?? layout.cols * layout.spacing / 2) + .7 : 5;
    const zMin = layout ? layout.zMin ?? layout.wallZ - 1.7 : -7;
    const zMax = layout ? .8 + (layout.rows - 1) * layout.spacing + 1 : 8;
    const yMax = layout ? layout.yMax ?? layout.wallRows * 1.02 + 1 : 3;
    const target = new THREE.Vector3(0, yMax * .35, (zMin + zMax) / 2);
    const direction = new THREE.Vector3(width < 650 ? 5.5 : 10, 19, 22);
    this.camera.position.copy(target).add(direction);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    const xs = [-xHalf, xHalf], ys = [0, yMax], zs = [zMin, zMax];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of xs) for (const y of ys) for (const z of zs) {
      const point = this.camera.worldToLocal(new THREE.Vector3(x, y, z));
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const shift = right.multiplyScalar((minX + maxX) / 2).add(up.multiplyScalar((minY + maxY) / 2));
    this.camera.position.add(shift);
    this.baseCameraPosition.copy(this.camera.position);
    this.camera.position.add(this.panOffset);
    const frameHeight = Math.max(maxY - minY + (width < 650 ? 6 : 5), (maxX - minX + 3.2) / aspect);
    this.camera.left = -frameHeight * aspect / 2;
    this.camera.right = frameHeight * aspect / 2;
    this.camera.top = frameHeight / 2;
    this.camera.bottom = -frameHeight / 2;
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  frame(time) {
    const delta = this.lastTime ? Math.min(.05, (time - this.lastTime) / 1000) : 0;
    this.lastTime = time;
    for (let i = this.moves.length - 1; i >= 0; i--) {
      const move = this.moves[i];
      move.elapsed += delta;
      const t = Math.min(1, move.elapsed / move.duration);
      const eased = t * t * (3 - 2 * t);
      const root = move.block.root;
      root.position.lerpVectors(move.from, move.target, eased);
      root.position.y += Math.sin(Math.PI * t) * move.arc;
      if (move.spin) root.rotation.x = Math.PI * 2 * eased;
      if (move.scaleTo !== undefined) root.scale.setScalar(THREE.MathUtils.lerp(move.scaleFrom, move.scaleTo, eased));
      if (t >= 1) {
        root.position.copy(move.target);
        root.rotation.set(0, 0, 0);
        this.moves.splice(i, 1);
        move.onDone();
      }
    }
    this.clock += delta;
    if (this.selected?.state === 'field') {
      const slot = this.layout.slots[this.selected.slot];
      this.selected.root.position.set(slot.x, slot.y + .38 + Math.sin(this.clock * 6) * .07, slot.z);
    }
    for (const card of this.cards) {
      if (card.flash <= 0) continue;
      card.flash -= delta;
      if (card.flash <= 0) this.tintCard(card);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.remaining -= delta;
      if (burst.remaining <= 0) {
        const slot = this.freeSlot(burst.oldSlot);
        burst.block.slot = slot;
        burst.block.root.position.copy(this.layout.slots[slot]);
        burst.block.root.visible = true;
        burst.block.state = 'field';
        this.layout.occupied.set(slot, burst.block.number);
        this.bursts.splice(i, 1);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.age += delta;
      particle.velocity.y -= 13 * delta;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      particle.mesh.rotation.x += delta * 7;
      particle.mesh.rotation.y += delta * 9;
      particle.mesh.scale.setScalar(Math.max(0, 1 - particle.age / .65));
      if (particle.age >= .65) {
        this.scene.remove(particle.mesh);
        this.particles.splice(i, 1);
      }
    }
    this.ambience.update(delta, this.active);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((next) => this.frame(next));
  }
}

new ArrangeNumbers();
