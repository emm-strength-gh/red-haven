import * as THREE from 'three';

// Random events in the Martian sky. Everything lives in a group that follows the camera, so the
// objects behave like a distant sky dome: positions are given as azimuth / elevation in degrees
// (0° azimuth = straight ahead, towards the horizon). Ground-level things are still hidden by the
// mesas and the well because they are depth-tested against the real scene.

const R = 250;
const rad = THREE.MathUtils.degToRad;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const sinp = (p) => Math.sin(clamp(p, 0, 1) * Math.PI);        // 0 -> 1 -> 0
const X_AXIS = new THREE.Vector3(1, 0, 0);

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SkyEvents {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.objs = [];
    this.cur = null;
    this.timer = 7;
    this.last = '';
    this.dim = 0; this.dimTarget = 0;
    this.tint = 0; this.tintTarget = 0;
    this.fogFar = 260; this.fogFarTarget = 260;
    this.starTarget = 0.8; this.glowK = 1;

    this.glowTex = canvasTex(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    this.starTex = canvasTex(128, 128, (c, w, h) => {
      c.translate(w / 2, h / 2);
      for (const [len, wid] of [[w / 2, 3], [h / 2, 3]]) {
        const g = c.createLinearGradient(-len, 0, len, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(-len, -wid / 2, len * 2, wid);
        c.rotate(Math.PI / 2);
      }
      const rg = c.createRadialGradient(0, 0, 0, 0, 0, 26);
      rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = rg; c.fillRect(-w / 2, -h / 2, w, h);
    });
    this.ringTex = canvasTex(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    this.auroraTex = canvasTex(8, 128, (c, w, h) => {
      const g = c.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, 'rgba(90,255,170,0.95)'); g.addColorStop(0.45, 'rgba(70,230,200,0.5)'); g.addColorStop(0.8, 'rgba(180,90,255,0.3)'); g.addColorStop(1, 'rgba(180,90,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    this.earthTex = canvasTex(256, 128, (c, w, h) => {
      c.fillStyle = '#2f7be0'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#4cc05a';
      for (let i = 0; i < 16; i++) { c.beginPath(); c.ellipse(Math.random() * w, 20 + Math.random() * (h - 40), 12 + Math.random() * 26, 8 + Math.random() * 14, Math.random() * 3, 0, 7); c.fill(); }
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 7; c.lineCap = 'round';
      for (let i = 0; i < 9; i++) { const y = Math.random() * h, x = Math.random() * w; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 20, y - 10, x + 40 + Math.random() * 20, y); c.stroke(); }
      c.fillStyle = '#fff'; c.fillRect(0, 0, w, 10); c.fillRect(0, h - 10, w, 10);
    });

    this.events = [
      ['Shooting stars', '🌠', () => this.shootingStars()],
      ['Solar eclipse', '🌘', () => this.eclipse(false)],
      ['Total eclipse', '🌑', () => this.eclipse(true)],
      ['Satellite collision', '🛰️', () => this.collision()],
      ['Solar flare', '☀️', () => this.flare()],
      ['Comet', '☄️', () => this.comet()],
      ['Polar lights', '🌌', () => this.aurora()],
      ['UFO sighting', '🛸', () => this.ufo()],
      ['Rocket launch', '🚀', () => this.rocket()],
      ['Dust storm', '🌪️', () => this.dustStorm()],
      ['Phobos fly-by', '🌕', () => this.phobos()],
      ['Supernova', '💥', () => this.supernova()],
      ['Earth-rise', '🌍', () => this.earthrise()],
      ['Meteor impact', '🔥', () => this.impact()],
      ['Satellite pass', '📡', () => this.satPass()],
    ];
  }

  // ---------------------------------------------------------- helpers
  azRange() { return Math.max(7, this.g.visAz * 0.8); }
  dir(az, el, r = R) { return new THREE.Vector3(Math.sin(rad(az)) * Math.cos(rad(el)) * r, Math.sin(rad(el)) * r, -Math.cos(rad(az)) * Math.cos(rad(el)) * r); }
  /** a point on the ground at distance r (local space is centred on the camera) */
  ground(az, r, h = 0) { return new THREE.Vector3(Math.sin(rad(az)) * r, -this.g.camY + h, -Math.cos(rad(az)) * r); }
  add(o) { this.group.add(o); this.objs.push(o); return o; }
  spr(tex, color, size, op = 1, additive = true) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: op, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.scale.setScalar(size);
    return this.add(s);
  }
  basic(geom, color, op = 1, additive = false) {
    const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    return this.add(m);
  }
  toonMat(color, extra = {}) { return new THREE.MeshToonMaterial({ color, gradientMap: this.g.gradient, fog: false, ...extra }); }
  streak(color, op = 1) {
    const m = this.basic(new THREE.BoxGeometry(1, 1, 1), color, op, true);
    return m;
  }
  setSeg(m, a, b, w) {
    const d = b.clone().sub(a), len = Math.max(0.001, d.length());
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(X_AXIS, d.normalize());
    m.scale.set(len, w, w);
  }
  makeSat(scale = 1) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.2), this.toonMat('#cfd3dc')); g.add(body);
    const foil = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.4, 1.24), this.toonMat('#ffc94d')); g.add(foil);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.08, 1.5), this.toonMat('#3568d8')); p.position.x = s * 2.5; g.add(p);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), this.toonMat('#8a8f99')); arm.position.x = s * 1.0; g.add(arm);
    }
    const dish = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.5, 10), this.toonMat('#ffffff')); dish.position.set(0, 0.85, 0); g.add(dish);
    g.scale.setScalar(scale);
    return this.add(g);
  }

  // ---------------------------------------------------------- scheduling
  reset() { this.end(); this.timer = 7; this.dim = this.tint = 0; this.apply(); }

  end() {
    if (!this.cur) return;
    for (const o of this.objs) { this.group.remove(o); o.traverse((c) => { c.geometry?.dispose(); c.material?.dispose?.(); }); }
    this.objs = [];
    this.cur = null;
    this.g.hideSkyTag();
  }

  start(i) {
    const [name, icon, make] = this.events[i];
    this.last = name;
    const ev = make();
    this.cur = { name, t: 0, ...ev };
    this.g.showSkyTag(`${icon} ${name}`);
  }

  update(dt, running) {
    this.group.position.copy(this.g.camera.position);
    if (running) {
      if (this.cur) {
        this.cur.t += dt;
        const p = this.cur.t / this.cur.dur;
        if (p >= 1) { this.end(); this.timer = rnd(12, 24); } else this.cur.update(p, dt);
      } else {
        this.timer -= dt;
        if (this.timer <= 0) {
          let i;
          do { i = Math.floor(Math.random() * this.events.length); } while (this.events[i][0] === this.last);
          this.start(i);
        }
      }
    }
    if (!this.cur) { this.dimTarget = 0; this.tintTarget = 0; this.fogFarTarget = 260; this.starTarget = 0.8; this.glowK = 1; this.g.sunGlow.material.opacity = 0.28; }
    const k = 1 - Math.exp(-dt * 3);
    this.dim += (this.dimTarget - this.dim) * k;
    this.tint += (this.tintTarget - this.tint) * k;
    this.fogFar += (this.fogFarTarget - this.fogFar) * k;
    this.g.starMat.opacity += (this.starTarget - this.g.starMat.opacity) * k;
    this.g.sunGlow.scale.setScalar(this.glowK);
    this.apply();
  }

  apply() {
    this.g.scene.fog.far = this.fogFar;
    this.g.scene.fog.near = Math.min(50, this.fogFar * 0.2);
    this.g.setOverlay(this.dim, this.tint, this.tintColor || '#ff9a3c');
  }

  // ---------------------------------------------------------- 1. shooting stars
  shootingStars() {
    const v = this.azRange(), n = 10, list = [];
    for (let i = 0; i < n; i++) {
      const az = rnd(-v, v), el = rnd(8, 22), s = (i / n) * 0.78 + rnd(0, 0.05);
      const a = this.dir(az, el), b = this.dir(az + rnd(6, 14) * pick([-1, 1]), el - rnd(5, 11));
      list.push({ a, b, s, m: this.streak(pick(['#ffffff', '#ffe9a8', '#bfe6ff'])) });
    }
    return { dur: 8, update: (p) => {
      for (const l of list) {
        const q = (p - l.s) / 0.15;
        l.m.visible = q > 0 && q < 1;
        if (!l.m.visible) continue;
        this.setSeg(l.m, l.a.clone().lerp(l.b, Math.max(0, q - 0.55)), l.a.clone().lerp(l.b, q), 0.9);
        l.m.material.opacity = sinp(q);
      }
      this.starTarget = 1;
    } };
  }

  // ---------------------------------------------------------- 2/3. eclipses
  eclipse(total) {
    const disc = this.basic(new THREE.SphereGeometry(1, 24, 16), '#1b1226', 1);
    disc.renderOrder = 3;
    const corona = this.spr(this.glowTex, '#fff2d0', 120, 0); corona.renderOrder = 2;
    const rays = this.spr(this.starTex, '#ffe9b8', 190, 0); rays.renderOrder = 2;
    const ring = this.spr(this.glowTex, '#ffffff', 28, 0); ring.renderOrder = 4;
    const up = new THREE.Vector3(0, 1, 0);
    return { dur: total ? 16 : 11, update: (p) => {
      const s = this.g.sunDisk.position.clone().sub(this.g.camera.position);
      const L = s.length(), sd = s.clone().divideScalar(L);
      const right = new THREE.Vector3().crossVectors(sd, up).normalize();
      const rSun = 17 / L * L * 0.96;                              // world radius of the sun disk at 0.96 L
      const x = p * 2 - 1;
      const off = (x * (0.45 + 0.55 * x * x)) * 2.4 * rSun;       // lingers near the middle
      const vert = total ? 0 : 0.55 * rSun;
      disc.scale.setScalar(rSun * (total ? 1.06 : 1.0));
      disc.position.copy(sd).multiplyScalar(L * 0.96).addScaledVector(right, off).addScaledVector(up, vert);
      corona.position.copy(sd).multiplyScalar(L * 0.95); rays.position.copy(corona.position); ring.position.copy(corona.position).addScaledVector(right, off * 0.4);
      const d = Math.hypot(off, vert) / rSun;
      const c = 1 - smooth(0.15, 2.05, d);                          // how much of the sun is covered
      this.dimTarget = c * (total ? 0.5 : 0.22);
      this.tintColor = '#1a1040';
      this.g.sunGlow.material.opacity = 0.28 * (1 - c);
      if (total) {
        const tot = 1 - smooth(0.1, 0.5, d);
        corona.material.opacity = tot * 0.9; rays.material.opacity = tot * 0.7;
        rays.material.rotation = p * 0.6;
        ring.material.opacity = smooth(0.05, 0.3, d) * (1 - smooth(0.3, 0.6, d)) * 1.2;   // diamond ring flash
        this.starTarget = lerp(0.8, 1, tot);
      }
    } };
  }

  // ---------------------------------------------------------- 4. satellites colliding
  collision() {
    const v = this.azRange() * 0.55, az = rnd(-v, v), el = rnd(11, 18);
    const meet = this.dir(az, el, 210);
    const right = new THREE.Vector3(1, 0, 0);
    const A0 = meet.clone().addScaledVector(right, -70).add(new THREE.Vector3(0, 10, 0));
    const B0 = meet.clone().addScaledVector(right, 70).add(new THREE.Vector3(0, -8, 0));
    const a = this.makeSat(2.2), b = this.makeSat(2.2);
    const flash = this.spr(this.glowTex, '#ffe2a0', 1, 0);
    const ring = this.spr(this.ringTex, '#ffd27a', 1, 0);
    const cross = this.spr(this.starTex, '#ffffff', 1, 0);
    const deb = [];
    for (let i = 0; i < 26; i++) {
      const m = this.basic(new THREE.BoxGeometry(1, 1, 1), pick(['#cfd3dc', '#3568d8', '#ffc94d', '#ffa040']), 1, false);
      m.visible = false;
      const ang = Math.random() * Math.PI * 2, sp = rnd(8, 32);
      deb.push({ m, v: new THREE.Vector3(Math.cos(ang) * sp, Math.sin(ang) * sp * 0.8, rnd(-6, 6)), s: rnd(0.5, 1.6), spin: new THREE.Vector3(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6)) });
    }
    return { dur: 9, update: (p) => {
      const hit = 0.4;
      if (p < hit) {
        const q = p / hit, e = q * q;
        a.position.lerpVectors(A0, meet, e); b.position.lerpVectors(B0, meet, e);
        a.rotation.z = q * 1.2; b.rotation.z = -q * 1.4; a.rotation.y = b.rotation.y = q * 2;
        return;
      }
      a.visible = b.visible = false;
      const q = (p - hit) / (1 - hit);
      flash.position.copy(meet); ring.position.copy(meet); cross.position.copy(meet);
      flash.scale.setScalar(20 + q * 90); flash.material.opacity = (1 - smooth(0, 0.5, q)) * 1.2;
      ring.scale.setScalar(10 + q * 160); ring.material.opacity = 1 - smooth(0, 0.7, q);
      cross.scale.setScalar(60 * (1 - q * 0.5)); cross.material.opacity = 1 - smooth(0, 0.3, q);
      if (q < 0.05) { this.g.boom(0.4); }
      this.tintColor = '#ffd9a0'; this.tintTarget = (1 - smooth(0, 0.25, q)) * 0.18;
      for (const d of deb) {
        d.m.visible = true;
        d.m.position.copy(meet).addScaledVector(d.v, q * 3.2); d.m.position.y -= q * q * 30;
        d.m.rotation.set(d.spin.x * q * 3, d.spin.y * q * 3, d.spin.z * q * 3);
        d.m.scale.setScalar(d.s * (1 - q * 0.5));
        d.m.material.opacity = 1 - smooth(0.6, 1, q);
      }
    } };
  }

  // ---------------------------------------------------------- 5. solar flare
  flare() {
    const arcs = [];
    for (let i = 0; i < 4; i++) {
      const m = this.basic(new THREE.TorusGeometry(24 + i * 8, 2.4 - i * 0.3, 6, 28, Math.PI * rnd(0.55, 0.8)), pick(['#ff9a3c', '#ffd23f', '#ff6a3c']), 0, true);
      m.rotation.z = rnd(0, Math.PI * 2);
      arcs.push(m);
    }
    const burst = this.spr(this.starTex, '#fff0b0', 1, 0);
    return { dur: 7, update: (p) => {
      const sp = this.g.sunDisk.position.clone().sub(this.g.camera.position);
      const L = sp.length(), sd = sp.clone().divideScalar(L);
      const k = sinp(p);
      arcs.forEach((m, i) => {
        m.position.copy(sd).multiplyScalar(L * 0.99); m.lookAt(this.group.position);
        m.rotateZ(i * 1.7 + p * 0.4);
        m.scale.setScalar(0.5 + smooth(0.05 + i * 0.05, 0.7, p) * 1.3);
        m.material.opacity = k * 0.85;
      });
      burst.position.copy(sd).multiplyScalar(L * 0.98); burst.scale.setScalar(80 + k * 260); burst.material.opacity = k * 0.8; burst.material.rotation = p * 1.5;
      this.glowK = 1 + k * 1.8;
      this.tintColor = '#ff8a30'; this.tintTarget = k * 0.2;
    } };
  }

  // ---------------------------------------------------------- 6. comet
  comet() {
    const v = this.azRange();
    const a = this.dir(v * 0.95, 21, 240), b = this.dir(-v * 0.95, 7, 240);
    const head = this.spr(this.glowTex, '#e8fbff', 22, 1);
    const core = this.spr(this.glowTex, '#ffffff', 9, 1);
    const tail = [];
    for (let i = 0; i < 26; i++) tail.push(this.spr(this.glowTex, i < 10 ? '#bfeaff' : '#9fd0ff', 1, 0));
    return { dur: 16, update: (p) => {
      const pos = a.clone().lerp(b, p), dirv = b.clone().sub(a).normalize();
      head.position.copy(pos); core.position.copy(pos);
      const fade = smooth(0, 0.08, p) * (1 - smooth(0.92, 1, p));
      head.material.opacity = fade; core.material.opacity = fade;
      tail.forEach((s, i) => {
        const f = i / tail.length;
        s.position.copy(pos).addScaledVector(dirv, -(i + 1) * 5.5).add(new THREE.Vector3(0, (i * 0.5) * (1 + f), 0));
        s.scale.setScalar(17 * (1 - f * 0.75));
        s.material.opacity = (1 - f) * 0.55 * fade;
      });
      this.starTarget = 1;
    } };
  }

  // ---------------------------------------------------------- 7. aurora
  aurora() {
    const v = this.azRange();
    const sheets = [];
    for (let i = 0; i < 3; i++) {
      const geom = new THREE.PlaneGeometry(190, 70, 36, 1);
      const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ map: this.auroraTex, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      const az = lerp(-v, v, i / 2) * 0.7;
      m.position.copy(this.dir(az, 17 + i * 2, 235 - i * 14)); m.lookAt(this.group.position);
      m.userData.base = geom.attributes.position.array.slice();
      m.userData.ph = rnd(0, 6);
      this.add(m); sheets.push(m);
    }
    return { dur: 18, update: (p, dt) => {
      const t = this.cur.t;
      const k = smooth(0, 0.18, p) * (1 - smooth(0.82, 1, p));
      sheets.forEach((m, i) => {
        const pos = m.geometry.attributes.position, base = m.userData.base;
        for (let j = 0; j < pos.count; j++) {
          const x = base[j * 3], y = base[j * 3 + 1];
          pos.setZ(j, Math.sin(x * 0.07 + t * 0.9 + m.userData.ph) * 7);
          pos.setX(j, x + Math.sin(y * 0.1 + t * 0.7 + i) * 4);
        }
        pos.needsUpdate = true;
        m.material.opacity = Math.min(1, k * (0.95 + 0.3 * Math.sin(t * 1.3 + i * 2)));
      });
      this.starTarget = 1;
    } };
  }

  // ---------------------------------------------------------- 8. UFO
  ufo() {
    const g = new THREE.Group();
    const saucer = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), this.toonMat('#c7ccd8')); saucer.scale.set(5.5, 1.3, 5.5); g.add(saucer);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.toonMat('#7be8a8', { transparent: true, opacity: 0.9 })); dome.position.y = 1; g.add(dome);
    const lights = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd23f', fog: false }));
      const a = (i / 8) * Math.PI * 2; l.position.set(Math.cos(a) * 5, -0.15, Math.sin(a) * 5); g.add(l); lights.push(l);
    }
    this.add(g);
    const beam = this.basic(new THREE.ConeGeometry(5, 48, 20, 1, true), '#b9ffd0', 0, true); beam.geometry.translate(0, -24, 0);
    const v = this.azRange();
    const path = [this.dir(-v * 1.1, 17, 200), this.dir(-v * 0.5, 13, 190), this.dir(-v * 0.1, 18, 190), this.dir(v * 0.35, 12, 190), this.dir(v * 1.2, 20, 200)];
    return { dur: 12, update: (p) => {
      const t = this.cur.t;
      const seg = p * 4, i = Math.min(3, Math.floor(seg)), q = seg - i;
      const e = i === 2 ? 0.5 : smooth(0, 1, q);             // pauses halfway through the third leg (beam time)
      g.position.lerpVectors(path[i], path[i + 1], i === 2 ? smooth(0, 0.35, q) * 0.4 + smooth(0.65, 1, q) * 0.6 : e);
      g.rotation.z = Math.sin(t * 3) * 0.12; g.rotation.x = Math.sin(t * 2.3) * 0.08; g.rotation.y = t * 1.6;
      lights.forEach((l, j) => { l.visible = Math.sin(t * 8 + j) > -0.3; });
      const beamOn = i === 2 && q > 0.25 && q < 0.75;
      beam.position.copy(g.position); beam.position.y -= 1.5;
      beam.material.opacity += ((beamOn ? 0.45 : 0) - beam.material.opacity) * 0.2;
    } };
  }

  // ---------------------------------------------------------- 9. rocket launch
  rocket() {
    const az = rnd(-this.azRange(), this.azRange()) * 0.6;
    const base = this.ground(az, 215, 2);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 8, 12), this.toonMat('#f7f4ee')); g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3, 12), this.toonMat('#ff5f57')); nose.position.y = 5.5; g.add(nose);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 1, 12), this.toonMat('#4d96ff')); band.position.y = 1.5; g.add(band);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 2.2), this.toonMat('#ff5f57'));
      const a = (i / 3) * Math.PI * 2; f.position.set(Math.cos(a) * 1.4, -3, Math.sin(a) * 1.4); f.rotation.y = -a; g.add(f);
    }
    this.add(g);
    const flame = this.spr(this.glowTex, '#ffb347', 14, 1);
    const flame2 = this.spr(this.glowTex, '#fff2c0', 7, 1);
    const puffs = []; let acc = 0;
    return { dur: 13, update: (p, dt) => {
      const t = this.cur.t, lift = Math.max(0, t - 2.2);
      const y = lift * lift * 2.1;
      g.position.copy(base).add(new THREE.Vector3(lift * 1.2, y, 0));
      g.rotation.z = -Math.min(0.35, lift * 0.03);
      const tail = g.position.clone().add(new THREE.Vector3(0, -6.5, 0).applyEuler(g.rotation));
      flame.position.copy(tail); flame2.position.copy(tail);
      const on = t > 1.4;
      flame.scale.setScalar(on ? 10 + Math.random() * 6 : 0.01); flame2.scale.setScalar(on ? 5 + Math.random() * 3 : 0.01);
      if (on) {
        acc += dt;
        while (acc > 0.09) { acc -= 0.09; const s = this.spr(this.glowTex, pick(['#ffffff', '#e8d8cc']), 9, 0.7, false); s.position.copy(tail); puffs.push({ s, age: 0 }); }
      }
      for (const q of puffs) { q.age += dt; q.s.scale.setScalar(9 + q.age * 9); q.s.material.opacity = Math.max(0, 0.7 - q.age * 0.2); q.s.position.x += dt * 1.2; }
      if (t < 2.4) { this.tintColor = '#ffd9a0'; }
    } };
  }

  // ---------------------------------------------------------- 10. dust storm
  dustStorm() {
    const wisps = [];
    for (let i = 0; i < 14; i++) {
      const s = this.spr(this.glowTex, '#e8a070', 1, 0, false);
      wisps.push({ s, x: rnd(-1, 1), y: rnd(-6, 14), sp: rnd(0.04, 0.12), sz: rnd(60, 120) });
    }
    return { dur: 16, update: (p) => {
      const k = smooth(0, 0.22, p) * (1 - smooth(0.78, 1, p));
      this.tintColor = '#d9733c'; this.tintTarget = k * 0.36;
      this.fogFarTarget = lerp(260, 85, k);
      this.dimTarget = k * 0.1;
      this.starTarget = lerp(0.8, 0.1, k);
      const v = this.azRange() * 1.5;
      for (const w of wisps) {
        w.x += 0.0035 * w.sp * 60 * 0.016 * 4;
        if (w.x > 1.2) w.x = -1.2;
        w.s.position.copy(this.dir(w.x * v, w.y + 6, 230)); w.s.scale.setScalar(w.sz);
        w.s.material.opacity = k * 0.35;
      }
    } };
  }

  // ---------------------------------------------------------- 11. Phobos fly-by
  phobos() {
    const v = this.azRange();
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.toonMat('#b8a5b4')); this.add(rock);
    const crater = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), this.toonMat('#8d7a8c')); this.add(crater);
    const a = this.dir(-v * 1.25, 17, 150), b = this.dir(v * 1.25, 19, 150);
    rock.scale.set(15, 12, 13);
    return { dur: 10, update: (p) => {
      rock.position.lerpVectors(a, b, p); rock.rotation.y = p * 3; rock.rotation.x = 0.4;
      crater.position.copy(rock.position).add(new THREE.Vector3(Math.cos(p * 3) * 6, 3, Math.sin(p * 3) * 9)); crater.scale.set(8, 8, 8);
      this.dimTarget = sinp(p) * 0.06;
    } };
  }

  // ---------------------------------------------------------- 12. supernova
  supernova() {
    const v = this.azRange(), az = rnd(-v, v) * 0.8, el = rnd(10, 19);
    const pos = this.dir(az, el, 240);
    const glow = this.spr(this.glowTex, '#bfe2ff', 1, 0);
    const cross = this.spr(this.starTex, '#ffffff', 1, 0);
    const ring = this.spr(this.ringTex, '#9ccaff', 1, 0);
    const ring2 = this.spr(this.ringTex, '#ffc8ff', 1, 0);
    return { dur: 9, update: (p) => {
      const bang = smooth(0.08, 0.2, p), fade = 1 - smooth(0.5, 1, p);
      for (const s of [glow, cross, ring, ring2]) s.position.copy(pos);
      glow.scale.setScalar(10 + bang * 120); glow.material.opacity = bang * fade;
      cross.scale.setScalar(20 + bang * 220); cross.material.opacity = bang * fade; cross.material.rotation = p * 0.5;
      ring.scale.setScalar(5 + smooth(0.15, 1, p) * 300); ring.material.opacity = smooth(0.15, 0.3, p) * (1 - smooth(0.3, 1, p)) * 0.9;
      ring2.scale.setScalar(5 + smooth(0.22, 1, p) * 220); ring2.material.opacity = smooth(0.22, 0.35, p) * (1 - smooth(0.35, 1, p)) * 0.7;
      this.tintColor = '#cfe4ff'; this.tintTarget = sinp((p - 0.08) / 0.2) * 0.12 * (p < 0.3 ? 1 : 0);
      this.starTarget = 1;
    } };
  }

  // ---------------------------------------------------------- 13. Earth-rise
  earthrise() {
    const v = this.azRange(), az = rnd(-v, v) * 0.5;
    const earth = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), new THREE.MeshToonMaterial({ map: this.earthTex, gradientMap: this.g.gradient, fog: false })); this.add(earth);
    const halo = this.spr(this.glowTex, '#8fc8ff', 52, 0);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(2.1, 12, 8), this.toonMat('#d8d4d0')); this.add(moon);
    return { dur: 18, update: (p) => {
      const k = smooth(0, 0.25, p) * (1 - smooth(0.8, 1, p));
      const el = lerp(-2, 16, smooth(0, 0.35, p)) + smooth(0.8, 1, p) * 3;
      earth.position.copy(this.dir(az, el, 230)); earth.rotation.y = this.cur.t * 0.2; earth.rotation.z = 0.4;
      earth.scale.setScalar(0.4 + k * 0.6);
      halo.position.copy(earth.position); halo.material.opacity = k * 0.6;
      const o = this.cur.t * 0.5;
      moon.position.copy(earth.position).add(new THREE.Vector3(Math.cos(o) * 19, Math.sin(o) * 4, Math.sin(o) * 19)); moon.scale.setScalar(0.4 + k * 0.6);
    } };
  }

  // ---------------------------------------------------------- 14. meteor impact
  impact() {
    const v = this.azRange() * 0.8, az = rnd(-v, v);
    const start = this.dir(az + rnd(-14, 14), 22, 240), hitPos = this.ground(az, 240, 1);
    const head = this.spr(this.glowTex, '#ffd7a0', 26, 0);
    const core = this.spr(this.glowTex, '#ffffff', 11, 0);
    const trail = [];
    for (let i = 0; i < 18; i++) trail.push(this.spr(this.glowTex, i < 6 ? '#ffb347' : '#ff7a3c', 1, 0));
    const flash = this.spr(this.glowTex, '#fff3d0', 1, 0);
    const ring = this.spr(this.ringTex, '#ffe0b0', 1, 0);
    const plume = []; for (let i = 0; i < 6; i++) plume.push(this.spr(this.glowTex, '#6b3a2a', 1, 0, false));
    let boomed = false;
    return { dur: 11, update: (p) => {
      const fall = clamp(p / 0.28, 0, 1);
      const pos = start.clone().lerp(hitPos, fall * fall);
      const dirv = hitPos.clone().sub(start).normalize();
      const vis = fall < 1 ? smooth(0, 0.08, fall) : 0;
      head.position.copy(pos); core.position.copy(pos);
      head.material.opacity = vis; core.material.opacity = vis;
      trail.forEach((s, i) => { const f = i / trail.length; s.position.copy(pos).addScaledVector(dirv, -(i + 1) * 6); s.scale.setScalar(20 * (1 - f * 0.7)); s.material.opacity = vis * (1 - f) * 0.7; });
      if (fall >= 1) {
        const q = (p - 0.28) / 0.72;
        if (!boomed) { boomed = true; this.g.boom(1); }
        flash.position.copy(hitPos); flash.position.y += 6; flash.scale.setScalar(40 + q * 200); flash.material.opacity = (1 - smooth(0, 0.35, q)) * 1.2;
        ring.position.copy(hitPos); ring.scale.setScalar(20 + q * 280); ring.material.opacity = (1 - smooth(0, 0.8, q)) * 0.9;
        plume.forEach((s, i) => { s.position.copy(hitPos); s.position.y += 8 + q * 40 + i * 9 * q; s.position.x += Math.sin(i * 2) * q * 18; s.scale.setScalar(30 + q * 50 + i * 4); s.material.opacity = smooth(0, 0.12, q) * (1 - smooth(0.5, 1, q)) * 0.55; });
        this.tintColor = '#fff3d0'; this.tintTarget = (1 - smooth(0, 0.18, q)) * 0.45;
      }
    } };
  }

  // ---------------------------------------------------------- 15. satellite pass
  satPass() {
    const v = this.azRange();
    const a = this.dir(-v * 1.2, 15, 200), b = this.dir(v * 1.2, 21, 200);
    const sat = this.makeSat(1.3);
    const light = this.spr(this.glowTex, '#ff6a5a', 7, 1);
    const glint = this.spr(this.starTex, '#ffffff', 1, 0);
    return { dur: 13, update: (p) => {
      const t = this.cur.t;
      sat.position.lerpVectors(a, b, p); sat.rotation.y = t * 0.8; sat.rotation.z = Math.sin(t) * 0.2;
      light.position.copy(sat.position).add(new THREE.Vector3(0, 2, 0)); light.material.opacity = Math.sin(t * 6) > 0 ? 1 : 0.1;
      glint.position.copy(sat.position); glint.scale.setScalar(40 * sinp((p - 0.45) / 0.1)); glint.material.opacity = sinp((p - 0.45) / 0.1);
      glint.material.rotation = t;
    } };
  }
}
