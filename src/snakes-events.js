import * as THREE from 'three';

// Random background events for Snakes. They never touch the snake or the grid: they are weather,
// critters and sky spectacle happening around (and above) the arena. Flying things cast a shadow on
// the ground so the top-down camera reads their height.

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const sinp = (p) => Math.sin(clamp(p, 0, 1) * Math.PI);
const X_AXIS = new THREE.Vector3(1, 0, 0);

export class WorldEvents {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.objs = [];
    this.cur = null;
    this.timer = 9;
    this.last = '';
    this.dim = 0; this.dimTarget = 0; this.dimColor = '#0a0620';
    this.tint = 0; this.tintTarget = 0; this.tintColor = '#ffffff';
    this.fogK = 1; this.fogKTarget = 1;
    this.weather = { mode: null, k: 0, target: 0, parts: [] };
    this.canvas = game.$('weather');
    this.ctx = this.canvas.getContext('2d');
    this.rainbow = game.$('rainbow');

    const tex = (w, h, draw) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; };
    this.glowTex = tex(64, 64, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    this.auroraTex = tex(4, 128, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(180,90,255,0)'); g.addColorStop(0.35, 'rgba(120,120,255,0.55)'); g.addColorStop(0.7, 'rgba(70,255,170,0.9)'); g.addColorStop(1, 'rgba(70,255,170,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });

    // [label, icon, levels it can happen in (null = any), factory]
    this.events = [
      ['Cloud shadows', '☁️', null, () => this.cloudShadows()],
      ['Bird flock', '🐦', null, () => this.birds()],
      ['Hot-air balloon', '🎈', null, () => this.balloon()],
      ['UFO flyover', '🛸', null, () => this.ufo()],
      ['Meteor shower', '🌠', null, () => this.meteors()],
      ['Thunderstorm', '⛈️', ['jungle', 'mountain'], () => this.storm()],
      ['Solar eclipse', '🌘', null, () => this.eclipse()],
      ['Rainbow', '🌈', ['jungle', 'mountain'], () => this.rainbowEv()],
      ['Earthquake rumble', '🌋', null, () => this.quake()],
      ['Fireflies', '✨', ['jungle'], () => this.fireflies()],
      ['Butterfly swarm', '🦋', ['jungle'], () => this.butterflies()],
      ['Sandstorm', '🏜️', ['desert'], () => this.sandstorm()],
      ['Tumbleweeds', '🌾', ['desert'], () => this.tumbleweeds()],
      ['Snowfall', '❄️', ['mountain'], () => this.snowfall()],
      ['Polar lights', '🌌', ['mountain'], () => this.aurora()],
    ];
  }

  // ---------------------------------------------------------- helpers
  add(o) { this.group.add(o); this.objs.push(o); return o; }
  F() { return this.g.focus; }
  rel(dx, y, dz) { return new THREE.Vector3(this.F().x + dx, y, this.F().z + dz); }
  toonMat(color, extra = {}) { return new THREE.MeshToonMaterial({ color, gradientMap: this.g.gradient, ...extra }); }
  spr(color, size, op = 1, additive = true) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, opacity: op, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.scale.setScalar(size);
    return this.add(s);
  }
  shadow(size, op = 0.28) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0x1d2433, transparent: true, opacity: op, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.07; m.scale.set(size, size, 1);
    return this.add(m);
  }
  streak(color) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    return this.add(m);
  }
  setSeg(m, a, b, w) {
    const d = b.clone().sub(a), len = Math.max(0.001, d.length());
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(X_AXIS, d.normalize());
    m.scale.set(len, w, w);
  }
  /** a pass across the view: random axis and side, ends well outside the screen */
  lane(y, reach = 17, spread = 4) {
    const alongX = Math.random() < 0.5, sign = Math.random() < 0.5 ? -1 : 1, off = rnd(-spread, spread);
    const a = alongX ? this.rel(-reach * sign, y, off) : this.rel(off, y, -reach * sign);
    const b = alongX ? this.rel(reach * sign, y, off + rnd(-2, 2)) : this.rel(off + rnd(-2, 2), y, reach * sign);
    return [a, b];
  }
  outline(mesh, s = 1.08) {
    const o = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x1d2433, side: THREE.BackSide }));
    o.scale.setScalar(s); mesh.add(o);
  }
  bird(color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), this.toonMat(color)); body.scale.set(1.4, 0.8, 0.9); this.outline(body, 1.12); g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.toonMat(color)); head.position.set(0.36, 0.05, 0); this.outline(head, 1.15); g.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 5), this.toonMat('#ffb020')); beak.rotation.z = -Math.PI / 2; beak.position.set(0.55, 0.03, 0); g.add(beak);
    const wings = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(0, 0.05, s * 0.2);
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.8), this.toonMat(color)); w.position.z = s * 0.4; this.outline(w, 1.1); pivot.add(w);
      g.add(pivot); wings.push([pivot, s]);
    }
    g.userData.wings = wings;
    return this.add(g);
  }
  flap(g, t, speed = 14) { for (const [p, s] of g.userData.wings) p.rotation.x = s * Math.sin(t * speed) * 0.7; }
  face(obj, a, b) { obj.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x); }

  // ---------------------------------------------------------- scheduling
  reset() {
    this.end();
    this.timer = 9;
    this.dim = this.tint = 0; this.fogK = 1; this.weather.k = 0; this.weather.target = 0;
    this.g.swayK = 1;
    this.apply(0);
  }

  end() {
    if (!this.cur) return;
    for (const o of this.objs) { this.group.remove(o); o.traverse((c) => { c.geometry?.dispose(); if (c.material) { (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose()); } }); }
    this.objs = [];
    this.cur = null;
    this.rainbow.classList.remove('on');
    this.g.hideEventTag();
  }

  update(dt, running) {
    if (running) {
      if (this.cur) {
        this.cur.t += dt;
        const p = this.cur.t / this.cur.dur;
        if (p >= 1) { this.end(); this.timer = rnd(14, 26); } else this.cur.update(p, dt);
      } else {
        this.timer -= dt;
        if (this.timer <= 0) {
          const id = this.g.level.id;
          const pool = this.events.filter((e) => (!e[2] || e[2].includes(id)) && e[0] !== this.last);
          const [name, icon, , make] = pick(pool);
          this.last = name;
          this.cur = { name, t: 0, ...make() };
          this.g.showEventTag(`${icon} ${name}`);
        }
      }
    }
    if (!this.cur) { this.dimTarget = 0; this.tintTarget = 0; this.fogKTarget = 1; this.weather.target = 0; this.g.swayK += (1 - this.g.swayK) * 0.05; }
    this.apply(dt);
  }

  apply(dt) {
    const k = 1 - Math.exp(-dt * 3);
    this.dim += (this.dimTarget - this.dim) * k;
    this.tint += (this.tintTarget - this.tint) * Math.min(1, k * 2);
    this.fogK += (this.fogKTarget - this.fogK) * k;
    const L = this.g.level;
    this.g.scene.fog.near = L.fogNear * this.fogK * 0.6; this.g.scene.fog.far = L.fogFar * this.fogK;
    this.g.setOverlay(this.dim, this.dimColor, this.tint, this.tintColor);
    this.drawWeather(dt);
  }

  // ---------------------------------------------------------- weather particles (2D canvas)
  setWeather(mode, target) {
    const w = this.weather;
    if (w.mode !== mode) { w.mode = mode; w.parts = []; }
    w.target = target;
  }

  drawWeather(dt) {
    const w = this.weather, c = this.ctx, cv = this.canvas;
    if (cv.width !== window.innerWidth || cv.height !== window.innerHeight) { cv.width = window.innerWidth; cv.height = window.innerHeight; }
    w.k += (w.target - w.k) * Math.min(1, dt * 2.5);
    c.clearRect(0, 0, cv.width, cv.height);
    if (w.k < 0.02 || !w.mode) { if (w.k < 0.02) w.mode = w.target ? w.mode : null; return; }
    const want = Math.floor((w.mode === 'sand' ? 120 : 260) * w.k);
    while (w.parts.length < want) w.parts.push({ x: Math.random() * cv.width, y: Math.random() * cv.height, s: Math.random() });
    w.parts.length = Math.min(w.parts.length, want);
    const W = cv.width, H = cv.height;
    c.lineCap = 'round';
    for (const p of w.parts) {
      if (w.mode === 'rain') {
        const vy = 900 + p.s * 500, vx = -160;
        p.x += vx * dt; p.y += vy * dt;
        c.strokeStyle = `rgba(205,228,255,${0.35 + p.s * 0.3})`; c.lineWidth = 1.5 + p.s;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - vx * 0.02, p.y - vy * 0.02); c.stroke();
      } else if (w.mode === 'snow') {
        p.y += (50 + p.s * 90) * dt; p.x += Math.sin(p.y * 0.012 + p.s * 9) * 28 * dt;
        c.fillStyle = `rgba(255,255,255,${0.55 + p.s * 0.4})`;
        c.beginPath(); c.arc(p.x, p.y, 1.5 + p.s * 3.2, 0, 7); c.fill();
      } else if (w.mode === 'sand') {
        const vx = 1100 + p.s * 900;
        p.x += vx * dt; p.y += 70 * dt;
        c.strokeStyle = `rgba(235,185,115,${0.3 + p.s * 0.35})`; c.lineWidth = 2 + p.s * 4;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - vx * 0.05, p.y - 3); c.stroke();
      }
      if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W; }
      if (p.x > W + 60) { p.x = -60; p.y = Math.random() * H; }
      if (p.x < -60) p.x = W + 40;
    }
  }

  // ---------------------------------------------------------- 1. cloud shadows
  cloudShadows() {
    const list = [];
    for (let i = 0; i < 5; i++) {
      const s = this.shadow(rnd(4, 7), 0.2); s.scale.y = s.scale.x * rnd(0.6, 0.9);
      list.push({ s, a: rnd(-16, 4), z: rnd(-9, 9), v: rnd(0.8, 1.2) });
    }
    return { dur: 14, update: (p) => {
      list.forEach((c) => { c.s.position.set(this.F().x + lerp(-22, 22, (p * c.v + (c.a + 16) / 40) % 1), 0.07, this.F().z + c.z); });
      this.dimTarget = 0.04; this.dimColor = '#101830';
    } };
  }

  // ---------------------------------------------------------- 2. bird flock
  birds() {
    const colors = { jungle: ['#ff5f57', '#4d96ff', '#ffd23f', '#4cc94a'], desert: ['#3a2f3d', '#4a3a35'], mountain: ['#8a5a34', '#f4efe6'] }[this.g.level.id];
    const [a, b] = this.lane(8, 18, 3);
    const offs = [[0, 0], [-1.3, 1.1], [-1.3, -1.1], [-2.6, 2.2], [-2.6, -2.2], [-3.9, 3.3], [-3.9, -3.3]];
    const flock = offs.map(([x, z]) => ({ b: this.bird(pick(colors)), sh: this.shadow(0.55, 0.25), x, z, ph: rnd(0, 6) }));
    const dirv = b.clone().sub(a).normalize(), side = new THREE.Vector3(-dirv.z, 0, dirv.x);
    return { dur: 8, update: (p) => {
      const base = a.clone().lerp(b, p), t = this.cur.t;
      for (const f of flock) {
        const pos = base.clone().addScaledVector(dirv, f.x).addScaledVector(side, f.z); pos.y += Math.sin(t * 2 + f.ph) * 0.25;
        f.b.position.copy(pos); this.face(f.b, a, b); this.flap(f.b, t + f.ph);
        f.sh.position.set(pos.x + 0.6, 0.07, pos.z + 0.6);
      }
    } };
  }

  // ---------------------------------------------------------- 3. hot-air balloon
  balloon() {
    const g = new THREE.Group();
    const env = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), this.toonMat(pick(['#ff5f57', '#ffd23f', '#4d96ff']))); env.scale.y = 1.15; this.outline(env, 1.05); g.add(env);
    for (const [y, r, c] of [[0.6, 1.42, '#fffaf0'], [-0.5, 1.4, '#fffaf0']]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 6, 20), this.toonMat(c)); band.rotation.x = Math.PI / 2; band.position.y = y; g.add(band);
    }
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), this.toonMat('#a8703c')); basket.position.y = -2.4; this.outline(basket, 1.1); g.add(basket);
    for (const [x, z] of [[-0.35, -0.35], [0.35, 0.35], [-0.35, 0.35], [0.35, -0.35]]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8, 4), this.toonMat('#6b4226')); rope.position.set(x * 0.8, -1.5, z * 0.8); g.add(rope);
    }
    this.add(g);
    const sh = this.shadow(1.7, 0.25);
    const [a, b] = this.lane(9, 18, 3);
    return { dur: 14, update: (p) => {
      const pos = a.clone().lerp(b, p); pos.y += Math.sin(this.cur.t * 1.2) * 0.3;
      g.position.copy(pos); g.rotation.y = this.cur.t * 0.2; g.rotation.z = Math.sin(this.cur.t * 0.9) * 0.05;
      sh.position.set(pos.x + 1.2, 0.07, pos.z + 1.2);
    } };
  }

  // ---------------------------------------------------------- 4. UFO
  ufo() {
    const g = new THREE.Group();
    const saucer = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), this.toonMat('#c7ccd8')); saucer.scale.set(2.2, 0.55, 2.2); this.outline(saucer, 1.05); g.add(saucer);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.toonMat('#7be8a8', { transparent: true, opacity: 0.9 })); dome.position.y = 0.3; g.add(dome);
    const lights = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
      const a = (i / 8) * Math.PI * 2; l.position.set(Math.cos(a) * 2, -0.05, Math.sin(a) * 2); g.add(l); lights.push(l);
    }
    this.add(g);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.6, 9, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#b9ffd0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.geometry.translate(0, -4.5, 0); this.add(beam);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), new THREE.MeshBasicMaterial({ color: '#b9ffd0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    spot.rotation.x = -Math.PI / 2; this.add(spot);
    const sh = this.shadow(2, 0.25);
    const [a, b] = this.lane(9, 17, 2);
    return { dur: 11, update: (p) => {
      const t = this.cur.t;
      const e = smooth(0, 0.4, p) * 0.4 + smooth(0.6, 1, p) * 0.6;           // hovers in the middle of the pass
      const pos = a.clone().lerp(b, e); pos.y += Math.sin(t * 3) * 0.15;
      g.position.copy(pos); g.rotation.y = t * 2; g.rotation.z = Math.sin(t * 3) * 0.1;
      lights.forEach((l, j) => { l.visible = Math.sin(t * 9 + j) > -0.3; });
      const on = p > 0.4 && p < 0.6;
      beam.material.opacity += ((on ? 0.4 : 0) - beam.material.opacity) * 0.15; spot.material.opacity = beam.material.opacity * 1.3;
      beam.position.set(pos.x, pos.y - 0.3, pos.z); spot.position.set(pos.x, 0.08, pos.z); spot.scale.setScalar(1 + Math.sin(t * 8) * 0.06);
      sh.position.set(pos.x + 0.8, 0.07, pos.z + 0.8);
    } };
  }

  // ---------------------------------------------------------- 5. meteor shower
  meteors() {
    const list = [];
    for (let i = 0; i < 11; i++) {
      const a = this.rel(rnd(-14, 6), rnd(11, 14), rnd(-12, 4)), b = a.clone().add(new THREE.Vector3(rnd(10, 16), -rnd(2, 4), rnd(8, 14)));
      list.push({ a, b, s: (i / 11) * 0.78 + rnd(0, 0.04), m: this.streak(pick(['#ffffff', '#ffe0a0', '#ffb347'])), g: this.spr('#ffd9a0', 1.4, 0) });
    }
    let sound = 0;
    return { dur: 8, update: (p) => {
      for (const l of list) {
        const q = (p - l.s) / 0.12;
        l.m.visible = l.g.visible = q > 0 && q < 1;
        if (!l.m.visible) continue;
        const head = l.a.clone().lerp(l.b, q);
        this.setSeg(l.m, l.a.clone().lerp(l.b, Math.max(0, q - 0.5)), head, 0.16);
        l.g.position.copy(head); l.m.material.opacity = sinp(q); l.g.material.opacity = sinp(q);
        if (q > 0 && sound < list.indexOf(l) + 1) { sound = list.indexOf(l) + 1; this.g.sfx.tone(1400, 300, 0.25, 'sine', 0.06); }
      }
      this.dimTarget = 0.1; this.dimColor = '#0a0620';
    } };
  }

  // ---------------------------------------------------------- 6. thunderstorm
  storm() {
    let flash = 0, nextBolt = 1.5;
    return { dur: 16, update: (p, dt) => {
      const k = smooth(0, 0.15, p) * (1 - smooth(0.85, 1, p));
      this.setWeather('rain', k);
      this.dimTarget = 0.28 * k; this.dimColor = '#0c1230';
      this.fogKTarget = lerp(1, 0.55, k);
      this.g.swayK = 1 + k * 2;
      nextBolt -= dt;
      if (nextBolt <= 0 && k > 0.6) { flash = 1; nextBolt = rnd(2, 4.5); setTimeout(() => this.g.sfx.noise(0.9, 0.35, 320), rnd(250, 700)); }
      flash = Math.max(0, flash - dt * 3.2);
      this.tintColor = '#dfe8ff'; this.tintTarget = Math.max(0, flash * flash) * 0.6 * (Math.random() > 0.2 ? 1 : 0.4);
    } };
  }

  // ---------------------------------------------------------- 7. solar eclipse
  eclipse() {
    return { dur: 14, update: (p) => {
      const k = sinp(p);
      this.dimTarget = 0.5 * Math.pow(k, 0.7); this.dimColor = '#0b0720';
      this.tintColor = '#ffb347'; this.tintTarget = 0.06 * k;
      this.fogKTarget = lerp(1, 0.75, k);
    } };
  }

  // ---------------------------------------------------------- 8. rainbow
  rainbowEv() {
    return { dur: 12, update: (p) => {
      this.rainbow.classList.add('on');
      this.rainbow.style.opacity = (sinp(p) * 0.6).toFixed(3);
      this.tintColor = '#fff3c0'; this.tintTarget = 0.04 * sinp(p);
    } };
  }

  // ---------------------------------------------------------- 9. earthquake rumble
  quake() {
    const puffs = []; let acc = 0;
    this.g.sfx.noise(2.5, 0.3, 180);
    return { dur: 6, update: (p, dt) => {
      const k = smooth(0, 0.1, p) * (1 - smooth(0.7, 1, p));
      this.g.shake = Math.max(this.g.shake, 0.32 * k * (0.7 + 0.3 * Math.sin(this.cur.t * 25)));
      this.g.swayK = 1 + k * 6;
      acc += dt;
      while (acc > 0.18 && k > 0.3) {
        acc -= 0.18;
        const x = this.F().x + rnd(-12, 12), z = this.F().z + rnd(-10, 10);
        if (Math.abs(x) > 13.4 || Math.abs(z) > 13.4) {
          const s = this.spr('#a8845a', 1.5, 0.7, false); s.position.set(x, 0.5, z); puffs.push({ s, age: 0 });
        }
      }
      for (const q of puffs) { q.age += dt; q.s.position.y += dt * 1.2; q.s.scale.setScalar(1.5 + q.age * 3); q.s.material.opacity = Math.max(0, 0.7 - q.age * 0.5); }
      this.dimTarget = 0.06 * k; this.dimColor = '#3a2410';
    } };
  }

  // ---------------------------------------------------------- 10. fireflies
  fireflies() {
    const list = [];
    for (let i = 0; i < 70; i++) {
      const s = this.spr(pick(['#d6ff6a', '#fff3a0', '#9dffb0']), rnd(0.35, 0.7), 0);
      list.push({ s, x: rnd(-13, 13), z: rnd(-11, 11), y: rnd(0.5, 3), ph: rnd(0, 6), sp: rnd(0.4, 1.2) });
    }
    return { dur: 16, update: (p) => {
      const k = smooth(0, 0.18, p) * (1 - smooth(0.82, 1, p)), t = this.cur.t;
      this.dimTarget = 0.34 * k; this.dimColor = '#07102e';
      for (const f of list) {
        f.s.position.set(this.F().x + f.x + Math.sin(t * f.sp + f.ph) * 1.4, f.y + Math.sin(t * 1.3 + f.ph) * 0.4, this.F().z + f.z + Math.cos(t * f.sp * 0.8 + f.ph) * 1.4);
        f.s.material.opacity = k * (0.35 + 0.65 * Math.max(0, Math.sin(t * 2.2 + f.ph * 3)));
      }
    } };
  }

  // ---------------------------------------------------------- 11. butterflies
  butterflies() {
    const list = [];
    const [a, b] = this.lane(2.2, 16, 4);
    const dirv = b.clone().sub(a).normalize(), side = new THREE.Vector3(-dirv.z, 0, dirv.x);
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group(); const col = pick(['#ff7eb6', '#ffd23f', '#9b7bff', '#5ed3f3', '#ff8a3d']);
      const wings = [];
      for (const s of [-1, 1]) {
        const piv = new THREE.Group();
        const w = new THREE.Mesh(new THREE.CircleGeometry(0.28, 8), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); w.rotation.x = -Math.PI / 2; w.position.z = s * 0.2; piv.add(w);
        g.add(piv); wings.push([piv, s]);
      }
      g.userData.wings = wings; this.add(g);
      list.push({ g, off: rnd(-3.5, 3.5), lag: rnd(0, 0.25), ph: rnd(0, 6), sh: this.shadow(0.2, 0.18) });
    }
    return { dur: 12, update: (p) => {
      const t = this.cur.t;
      for (const f of list) {
        const q = clamp(p * 1.25 - f.lag, 0, 1);
        const pos = a.clone().lerp(b, q).addScaledVector(side, f.off + Math.sin(t * 1.6 + f.ph) * 1.4); pos.y += Math.sin(t * 2.4 + f.ph) * 0.7;
        f.g.position.copy(pos); f.g.rotation.y = Math.atan2(-dirv.z, dirv.x) + Math.sin(t + f.ph) * 0.8;
        for (const [pv, s] of f.g.userData.wings) pv.rotation.x = s * Math.abs(Math.sin(t * 12 + f.ph)) * 1.1;
        f.sh.position.set(pos.x + 0.4, 0.07, pos.z + 0.4);
        f.g.visible = f.sh.visible = q > 0 && q < 1;
      }
    } };
  }

  // ---------------------------------------------------------- 12. sandstorm
  sandstorm() {
    return { dur: 16, update: (p) => {
      const k = smooth(0, 0.2, p) * (1 - smooth(0.82, 1, p));
      this.setWeather('sand', k);
      this.tintColor = '#d9a05a'; this.tintTarget = 0.3 * k;
      this.dimTarget = 0.12 * k; this.dimColor = '#3a2410';
      this.fogKTarget = lerp(1, 0.4, k);
      this.g.swayK = 1 + k * 3;
    } };
  }

  // ---------------------------------------------------------- 13. tumbleweeds
  tumbleweeds() {
    const list = [];
    for (let i = 0; i < 5; i++) {
      const [a, b] = [this.rel(-17, 0, rnd(-8, 8)), this.rel(17, 0, rnd(-8, 8))];
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), this.toonMat('#c9a468')); this.outline(m, 1.1); this.add(m);
      list.push({ m, a, b, d: i * 0.17, sh: this.shadow(0.5, 0.25) });
    }
    return { dur: 11, update: (p) => {
      const t = this.cur.t;
      for (const w of list) {
        const q = clamp((p - w.d) / 0.7, 0, 1);
        const pos = w.a.clone().lerp(w.b, q); pos.y = 0.9 + Math.abs(Math.sin(q * 26)) * 2.6;
        w.m.position.copy(pos); w.m.rotation.x = t * 5; w.m.rotation.z = t * 3;
        w.sh.position.set(pos.x, 0.07, pos.z); w.sh.scale.setScalar(0.5 * (1 - (pos.y - 0.9) / 7));
        w.m.visible = w.sh.visible = q > 0 && q < 1;
      }
      this.g.swayK = 2;
    } };
  }

  // ---------------------------------------------------------- 14. snowfall
  snowfall() {
    return { dur: 16, update: (p) => {
      const k = smooth(0, 0.15, p) * (1 - smooth(0.85, 1, p));
      this.setWeather('snow', k);
      this.tintColor = '#dcefff'; this.tintTarget = 0.12 * k;
      this.dimTarget = 0.06 * k; this.dimColor = '#1a2a50';
      this.fogKTarget = lerp(1, 0.7, k);
    } };
  }

  // ---------------------------------------------------------- 15. polar lights
  aurora() {
    const ribbons = [];
    for (let i = 0; i < 3; i++) {
      const geom = new THREE.PlaneGeometry(60, 6, 48, 1);
      const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ map: this.auroraTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.userData.base = geom.attributes.position.array.slice(); m.userData.ph = rnd(0, 6);
      this.add(m); ribbons.push(m);
    }
    return { dur: 18, update: (p) => {
      const t = this.cur.t, k = smooth(0, 0.2, p) * (1 - smooth(0.8, 1, p));
      this.dimTarget = 0.36 * k; this.dimColor = '#050a28';
      ribbons.forEach((m, i) => {
        const pos = m.geometry.attributes.position, base = m.userData.base;
        for (let j = 0; j < pos.count; j++) {
          const x = base[j * 3], y = base[j * 3 + 1];
          pos.setY(j, y + Math.sin(x * 0.18 + t * 0.9 + m.userData.ph) * 3 + Math.sin(x * 0.07 - t * 0.5) * 2);
          pos.setZ(j, Math.sin(x * 0.3 + t * 1.6) * 0.6);
        }
        pos.needsUpdate = true;
        m.position.set(this.F().x + Math.sin(t * 0.15 + i) * 3, 13 + i * 1.2, this.F().z + (i - 1) * 8);
        m.material.opacity = k * (0.32 + 0.1 * Math.sin(t * 1.4 + i * 2));
      });
    } };
  }
}
