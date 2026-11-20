// Commute City — the Three.js world: terrain, roads, buildings and vehicles in a bright toy style.
// Everything static is rebuilt from the sim state when its version counters change; vehicles,
// lights and barriers are instanced and updated every frame.
import * as THREE from 'three';
import { DIRS, opp, TER, KIND, LEVEL_H, DISTRICTS, rampY, vehPose, keyInfo, otherEnd } from './traffic-sim.js';

const UP = [0, 1, 0], DOWN = [0, -1, 0];
const col = (hex) => new THREE.Color(hex);
const WHITE = col('#ffffff');
const PAL = {
  grass: col('#8edb5c'), grassB: col('#89d757'), locked: col('#a9bd96'), lockedB: col('#a2b78f'),
  edge: col('#79c34d'), dirt: col('#c98b58'), dirtDark: col('#9a6743'), sand: col('#f4dfa6'),
  water: col('#4cc6f5'), shallow: col('#7dd8f7'),
  asphalt: col('#b3b8c1'), motorway: col('#9ea5b0'), curb: col('#fbfbf6'), mark: col('#ffffff'), yellow: col('#ffcf3a'),
  tramBed: col('#d3cdbf'), rail: col('#68707c'), sleeper: col('#9c6b46'), ballast: col('#c9b796'),
  concrete: col('#e8e4da'), deck: col('#cfcabd'), pillar: col('#dedace'), barrier: col('#f6f5f0'),
  tunnel: col('#6b717b'), tunnelTop: col('#4f545c'), mouth: col('#22252b'), arch: col('#ece6d6'), lamp: col('#ffe9a3'),
  lot: col('#c8ccd3'), pole: col('#3b4049'), head: col('#2b2f36'), platform: col('#efe8d8'), canopy: col('#ff7d5c'),
  glass: col('#cdeeff'), glassDark: col('#30405a'), door: col('#8a5534'), trunk: col('#9b6a43'), roofGray: col('#d6d1c7'),
};
const TREE_COLS = ['#b7dc3c', '#a2d23a', '#c9e249', '#8fca3c', '#d4e44f'].map(col);
const ROCK_COLS = ['#b9aec9', '#aea4bf', '#c4b8cf', '#a99fb6'].map(col);

// ------------------------------------------------------------------ geometry accumulator
class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; }
  tri(a, b, c, k) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) { this.n.push(nx, ny, nz); this.c.push(k.r, k.g, k.b); }
  }
  // a-b-c-d in order around the quad; the face is turned so its normal points along w
  quad(a, b, c, d, k, w = UP) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * w[0] + ny * w[1] + nz * w[2] < 0) { this.tri(a, d, c, k); this.tri(a, c, b, k); return; }
    this.tri(a, b, c, k); this.tri(a, c, d, k);
  }
  triW(a, b, c, k, w) {
    this.tri(a, b, c, k);
    const n = this.n, i = n.length - 9;
    if (n[i] * w[0] + n[i + 1] * w[1] + n[i + 2] * w[2] >= 0) return;
    const p = this.p;
    for (let j = 0; j < 3; j++) { const t = p[i + 3 + j]; p[i + 3 + j] = p[i + 6 + j]; p[i + 6 + j] = t; }
    for (let j = 0; j < 9; j++) n[i + j] = -n[i + j];
  }
  get empty() { return this.p.length === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// box with its long axis along (dx, dz); u along the axis, l to the right of it
function boxAlong(G, ox, oz, dx, dz, u0, u1, l0, l1, y0, y1, k, bottom = false) {
  const P = (u, l, y) => [ox + dx * u - dz * l, y, oz + dz * u + dx * l];
  const a = P(u0, l0, y1), b = P(u1, l0, y1), c = P(u1, l1, y1), d = P(u0, l1, y1);
  const a0 = P(u0, l0, y0), b0 = P(u1, l0, y0), c0 = P(u1, l1, y0), d0 = P(u0, l1, y0);
  G.quad(a, b, c, d, k, UP);
  if (bottom) G.quad(a0, b0, c0, d0, k, DOWN);
  G.quad(a, b, b0, a0, k, [dz, 0, -dx]);
  G.quad(d, c, c0, d0, k, [-dz, 0, dx]);
  G.quad(b, c, c0, b0, k, [dx, 0, dz]);
  G.quad(a, d, d0, a0, k, [-dx, 0, -dz]);
}
const boxAt = (G, x, z, sx, sz, y0, y1, k, bottom = false) => boxAlong(G, x, z, 1, 0, -sx / 2, sx / 2, -sz / 2, sz / 2, y0, y1, k, bottom);

// triangular prism roof along x (ridge at y1), local box [-sx/2, sx/2] x [-sz/2, sz/2]
function roofAt(G, x, z, sx, sz, y0, y1, k, alongZ = false) {
  const P = (u, l, y) => (alongZ ? [x + l, y, z + u] : [x + u, y, z + l]);
  const hx = sx / 2, hz = sz / 2;
  const u = alongZ ? hz : hx, l = alongZ ? hx : hz;
  const r0 = P(-u, 0, y1), r1 = P(u, 0, y1);
  const fl0 = P(-u, -l, y0), fl1 = P(u, -l, y0), fr0 = P(-u, l, y0), fr1 = P(u, l, y0);
  G.quad(fl0, fl1, r1, r0, k, alongZ ? [-1, 1, 0] : [0, 1, -1]);
  G.quad(fr0, fr1, r1, r0, k, alongZ ? [1, 1, 0] : [0, 1, 1]);
  G.triW(fl0, r0, fr0, k, alongZ ? [0, 0, -1] : [-1, 0, 0]);
  G.triW(fl1, r1, fr1, k, alongZ ? [0, 0, 1] : [1, 0, 0]);
}

function fan(G, cx, cz, y, r, n, k, a0 = 0, a1 = Math.PI * 2) {
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    G.quad([cx, y, cz], [cx + Math.cos(t0) * r, y, cz + Math.sin(t0) * r], [cx + Math.cos(t1) * r, y, cz + Math.sin(t1) * r], [cx, y, cz], k, UP);
  }
}

// ------------------------------------------------------------------ path helpers
// a path is a list of {x, y, z, hx, hz}: centre points with a unit heading in the ground plane
const sideOf = (p, l, dy) => [p.x - p.hz * l, p.y + dy, p.z + p.hx * l];
function band(G, pts, a, b, dy, k, w = UP) {
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    G.quad(sideOf(p, a, dy), sideOf(p, b, dy), sideOf(q, b, dy), sideOf(q, a, dy), k, w);
  }
}
function cumLen(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
  return c;
}
function atLen(pts, cs, s) {
  let i = 1;
  while (i < pts.length - 1 && cs[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const t = cs[i] > cs[i - 1] ? Math.min(1, Math.max(0, (s - cs[i - 1]) / (cs[i] - cs[i - 1]))) : 0;
  let hx = a.hx + (b.hx - a.hx) * t, hz = a.hz + (b.hz - a.hz) * t;
  const l = Math.hypot(hx, hz) || 1;
  hx /= l; hz /= l;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, hx, hz };
}
function subPath(pts, cs, s0, s1) {
  const out = [atLen(pts, cs, s0)];
  for (let i = 0; i < pts.length; i++) if (cs[i] > s0 + 1e-6 && cs[i] < s1 - 1e-6) out.push(pts[i]);
  out.push(atLen(pts, cs, s1));
  return out;
}
function dashes(G, pts, l, w, on, off, dy, k, phase = 0, face = UP) {
  const cs = cumLen(pts), total = cs[cs.length - 1];
  for (let s = phase; s < total - 0.005; s += on + off) band(G, subPath(pts, cs, s, Math.min(total, s + on)), l - w / 2, l + w / 2, dy, k, face);
}

// ------------------------------------------------------------------ edges of paved surfaces
// a, b: endpoints on the pavement boundary (at road surface height); o: outward unit [ox, oz]
function edgeLine(G, a, b, o, style, bot) {
  const [ox, oz] = o;
  const at = (p, d, dy) => [p[0] + ox * d, p[1] + dy, p[2] + oz * d];
  const OUT = [ox, 0, oz], IN = [-ox, 0, -oz];
  if (style === 'ground') {
    const ai = at(a, -0.035, 0.022), bi = at(b, -0.035, 0.022), ao = at(a, 0, 0.022), bo = at(b, 0, 0.022);
    G.quad(ai, bi, bo, ao, PAL.curb, UP);
    G.quad(ai, bi, at(b, -0.035, 0), at(a, -0.035, 0), PAL.curb, IN);
    G.quad(ao, bo, at(b, 0, -0.016), at(a, 0, -0.016), PAL.curb, OUT);
  } else if (style === 'tunnel') {
    const ai = at(a, 0.04, 0), bi = at(b, 0.04, 0);
    G.quad(ai, bi, at(b, 0.04, 0.3), at(a, 0.04, 0.3), PAL.tunnel, IN);
    G.quad(a, b, bi, ai, PAL.tunnel, UP);
  } else {
    const ai = at(a, -0.028, 0.055), bi = at(b, -0.028, 0.055), ao = at(a, 0, 0.055), bo = at(b, 0, 0.055);
    G.quad(ai, bi, bo, ao, PAL.barrier, UP);
    G.quad(ai, bi, at(b, -0.028, 0), at(a, -0.028, 0), PAL.barrier, IN);
    const ya = bot(a), yb = bot(b);
    G.quad(ao, bo, [b[0], yb, b[2]], [a[0], ya, a[2]], PAL.concrete, OUT);
  }
}
// both edges of a path at lateral ±half
function pathEdges(G, pts, half, style, bot, which = 3) {
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    if (which & 1) edgeLine(G, sideOf(p, half, 0.012), sideOf(q, half, 0.012), [-(p.hz + q.hz) / 2, (p.hx + q.hx) / 2], style, bot);
    if (which & 2) edgeLine(G, sideOf(p, -half, 0.012), sideOf(q, -half, 0.012), [(p.hz + q.hz) / 2, -(p.hx + q.hx) / 2], style, bot);
  }
  if (style === 'tunnel') band(G, pts, -half - 0.04, half + 0.04, 0.312, PAL.tunnelTop, DOWN);
  if (style === 'elev' || style === 'bridge') band(G, pts, -half, half, -0.09, PAL.deck, DOWN);
}

// ------------------------------------------------------------------ road surfaces and markings
function paintSurface(G, pts, kind, tram) {
  const h = KIND[kind].half;
  if (kind === 'rail') {
    band(G, pts, -h, h, 0.008, PAL.ballast);
    for (const t of [-0.13, 0.13]) {
      dashes(G, pts, t, 0.15, 0.028, 0.056, 0.014, PAL.sleeper, 0.02);
      for (const g of [-0.04, 0.04]) band(G, pts, t + g - 0.007, t + g + 0.007, 0.024, PAL.rail);
    }
    return;
  }
  if (kind === 'tram') {
    band(G, pts, -h, h, 0.01, PAL.tramBed);
    for (const t of [-0.105, 0.105]) for (const g of [-0.035, 0.035]) band(G, pts, t + g - 0.006, t + g + 0.006, 0.018, PAL.rail);
    return;
  }
  band(G, pts, -h, h, 0.012, kind === 'motorway' ? PAL.motorway : PAL.asphalt);
  if (kind === 'road') {
    dashes(G, pts, 0, 0.016, 0.075, 0.065, 0.0135, PAL.mark, 0.03);
    if (tram) for (const t of [-0.105, 0.105]) for (const g of [-0.035, 0.035]) band(G, pts, t + g - 0.006, t + g + 0.006, 0.0135, PAL.rail);
  } else {
    band(G, pts, -0.024, -0.01, 0.0135, PAL.yellow);
    band(G, pts, 0.01, 0.024, 0.0135, PAL.yellow);
    for (const s of [-0.155, 0.155]) dashes(G, pts, s, 0.013, 0.08, 0.07, 0.0135, PAL.mark, 0.02);
    for (const s of [-1, 1]) band(G, pts, s * (h - 0.032), s * (h - 0.02), 0.0135, PAL.mark);
  }
}
// rails laid across a junction patch (level crossing): sleepers and rails only
function paintRailsOnly(G, pts) {
  for (const t of [-0.13, 0.13]) {
    dashes(G, pts, t, 0.15, 0.028, 0.056, 0.0135, PAL.sleeper, 0.01);
    for (const g of [-0.04, 0.04]) band(G, pts, t + g - 0.007, t + g + 0.007, 0.02, PAL.rail);
  }
}

// ------------------------------------------------------------------ network builder
function terrainAt(S, x, z) {
  const tx = Math.round(x), ty = Math.round(z);
  if (tx < 0 || ty < 0 || tx >= S.W || ty >= S.H) return TER.GRASS;
  return S.terrain[ty * S.W + tx];
}
const groundY = (S, x, z) => (terrainAt(S, x, z) === TER.WATER ? -0.07 : 0);

function nodeStyle(S, N) {
  if (N.lvl < 0) return 'tunnel';
  if (N.lvl > 0) return 'elev';
  return S.terrain[N.t] === TER.WATER ? 'bridge' : 'ground';
}
function armPts(N, d, M, u0, u1) {
  const [dx, dz] = DIRS[d];
  const steps = M.h === N.h ? 1 : 8;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const u = u0 + ((u1 - u0) * i) / steps;
    let y = rampY(N.h, M.h, u);
    if (N.lvl === 0 && M.lvl < 0) y = Math.max(0, y); // stays on the surface up to the tunnel mouth
    out.push({ x: N.x + dx * u, y, z: N.y + dz * u, hx: dx, hz: dz });
  }
  return out;
}
function cornerPts(N, a1, a2, t0, t1) {
  const e1 = { x: N.x + DIRS[a1.d][0] * 0.5, z: N.y + DIRS[a1.d][1] * 0.5, y: rampY(N.h, a1.M.h, 0.5) };
  const e2 = { x: N.x + DIRS[a2.d][0] * 0.5, z: N.y + DIRS[a2.d][1] * 0.5, y: rampY(N.h, a2.M.h, 0.5) };
  if (N.lvl === 0) { e1.y = Math.max(0, e1.y); e2.y = Math.max(0, e2.y); }
  const out = [];
  const n = Math.max(2, Math.round(12 * (t1 - t0)));
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n, w = 1 - t;
    const x = w * w * e1.x + 2 * w * t * N.x + t * t * e2.x;
    const z = w * w * e1.z + 2 * w * t * N.y + t * t * e2.z;
    const y = w * w * e1.y + 2 * w * t * N.h + t * t * e2.y;
    let hx = 2 * w * (N.x - e1.x) + 2 * t * (e2.x - N.x), hz = 2 * w * (N.y - e1.z) + 2 * t * (e2.z - N.y);
    const l = Math.hypot(hx, hz) || 1;
    out.push({ x, y, z, hx: hx / l, hz: hz / l });
  }
  return out;
}

function buildNet(S, sigMode) {
  const G = new Geo(), ghost = new Geo(), glow = new Geo();
  const lamps = [], gates = [], stops = [];
  const margin = sigMode ? 3 : 0;
  for (const N of S.nodes) {
    if (!N) continue;
    const arms = [];
    for (let d = 0; d < 4; d++) {
      const id = N.dirs[d];
      if (id < 0) continue;
      const L = S.links.get(id);
      const M = S.nodes[otherEnd(L, N.key)];
      arms.push({ d, L, M, kind: L.kind, tram: L.tram, half: KIND[L.kind].half });
    }
    if (!arms.length) continue;
    const base = nodeStyle(S, N);
    const styleOf = (a) => (N.lvl === 0 && a.M.lvl > 0 ? 'ramp' : base);
    const bot = (style) => (style === 'elev' ? (p) => p[1] - 0.1 : (p) => groundY(S, p[0], p[2]));
    const piece = (pts, a, style = styleOf(a), which = 3) => {
      paintSurface(G, pts, a.kind, a.tram);
      pathEdges(G, pts, a.half, style, bot(style), which);
      // warm strip lights along the tunnel ceiling (unlit material, so they glow)
      if (style === 'tunnel') for (const l of [-a.half * 0.92, a.half * 0.92]) dashes(glow, pts, l, 0.03, 0.09, 0.07, 0.3, PAL.lamp, 0.03, DOWN);
    };
    if (N.j) {
      junctionPatch(G, S, N, arms, base, bot(base));
      const R = N.R;
      for (const a of arms) {
        const u0 = N.ctrl === 'round' ? Math.sqrt(Math.max(0, R * R - a.half * a.half)) - 0.012 : R;
        piece(armPts(N, a.d, a.M, u0, 0.5), a);
      }
      signalGizmos(G, S, N, arms, lamps, gates, sigMode);
    } else if (arms.length === 2 && arms[0].d !== opp(arms[1].d)) {
      const [a1, a2] = arms;
      if (a1.kind === a2.kind && a1.tram === a2.tram && styleOf(a1) === styleOf(a2)) piece(cornerPts(N, a1, a2, 0, 1), a1);
      else { piece(cornerPts(N, a1, a2, 0, 0.5), a1); piece(cornerPts(N, a1, a2, 0.5, 1), a2); }
    } else {
      for (const a of arms) piece(armPts(N, a.d, a.M, 0, 0.5), a);
      if (arms.length === 1 && !N.term) deadEnd(G, N, arms[0], base, bot(base));
    }
    // map-edge entry roads in signal levels run on off the board
    if (N.portal && margin) {
      const a = arms[0], [dx, dz] = DIRS[opp(a.d)];
      const pts = [{ x: N.x, y: 0, z: N.y, hx: dx, hz: dz }, { x: N.x + dx * margin, y: 0, z: N.y + dz * margin, hx: dx, hz: dz }];
      piece(pts, a, 'ground');
    }
    for (const a of arms) {
      if (N.lvl === 0 && a.M.lvl < 0) tunnelMouth(G, S, N, a);
      if (N.lvl < 0) band(ghost, armPts(N, a.d, a.M, 0, 0.5).map((p) => ({ ...p, y: 0.006 })), -a.half * 0.75, a.half * 0.75, 0, PAL.mouth);
    }
    if (N.lvl < 0 && N.j) {
      const R = N.R;
      ghost.quad([N.x - R, 0.006, N.y - R], [N.x + R, 0.006, N.y - R], [N.x + R, 0.006, N.y + R], [N.x - R, 0.006, N.y + R], PAL.mouth, UP);
    }
    if (N.lvl > 0) pillar(G, S, N);
    if (N.stop) stopModel(G, S, N, arms, stops);
  }
  return { geo: G.empty ? null : G.build(), ghost: ghost.empty ? null : ghost.build(), glow: glow.empty ? null : glow.build(), lamps, gates, stops };
}

function junctionPatch(G, S, N, arms, style, bot) {
  const R = N.R, y = N.h + 0.012, x = N.x, z = N.y;
  const surf = arms.some((a) => a.kind === 'motorway') ? PAL.motorway : arms.every((a) => a.kind === 'tram') ? PAL.tramBed : PAL.asphalt;
  const has = [null, null, null, null];
  for (const a of arms) has[a.d] = a;
  if (N.ctrl === 'round') {
    fan(G, x, z, y, R, 28, surf);
    fan(G, x, z, y + 0.035, 0.155, 16, PAL.grass);
    for (let i = 0; i < 16; i++) {
      const t0 = (i / 16) * Math.PI * 2, t1 = ((i + 1) / 16) * Math.PI * 2, tm = (t0 + t1) / 2;
      const a = [x + Math.cos(t0) * 0.155, y + 0.035, z + Math.sin(t0) * 0.155], b = [x + Math.cos(t1) * 0.155, y + 0.035, z + Math.sin(t1) * 0.155];
      G.quad(a, b, [b[0], y, b[2]], [a[0], y, a[2]], PAL.curb, [Math.cos(tm), 0, Math.sin(tm)]);
    }
    // ring markings
    for (let i = 0; i < 20; i += 2) {
      const t0 = (i / 20) * Math.PI * 2, t1 = ((i + 1) / 20) * Math.PI * 2;
      const r0 = 0.245, r1 = 0.26;
      G.quad([x + Math.cos(t0) * r0, y + 0.0015, z + Math.sin(t0) * r0], [x + Math.cos(t1) * r0, y + 0.0015, z + Math.sin(t1) * r0],
        [x + Math.cos(t1) * r1, y + 0.0015, z + Math.sin(t1) * r1], [x + Math.cos(t0) * r1, y + 0.0015, z + Math.sin(t0) * r1], PAL.mark, UP);
    }
    const n = 32;
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2, tm = (t0 + t1) / 2;
      let gap = false;
      for (const a of arms) {
        const aa = Math.atan2(DIRS[a.d][1], DIRS[a.d][0]);
        let df = Math.abs(tm - aa) % (Math.PI * 2);
        if (df > Math.PI) df = Math.PI * 2 - df;
        if (df < Math.asin(Math.min(1, (a.half + 0.02) / R))) gap = true;
      }
      if (gap) continue;
      edgeLine(G, [x + Math.cos(t0) * R, y, z + Math.sin(t0) * R], [x + Math.cos(t1) * R, y, z + Math.sin(t1) * R], [Math.cos(tm), Math.sin(tm)], style, bot);
    }
    if (style === 'elev' || style === 'bridge') fanDown(G, x, z, y - 0.1, R);
    return;
  }
  G.quad([x - R, y, z - R], [x + R, y, z - R], [x + R, y, z + R], [x - R, y, z + R], surf, UP);
  if (N.cross) {
    const ra = arms.find((a) => a.kind === 'rail');
    if (ra) {
      const [dx, dz] = DIRS[ra.d];
      paintRailsOnly(G, [{ x: x - dx * R, y: N.h, z: z - dz * R, hx: dx, hz: dz }, { x: x + dx * R, y: N.h, z: z + dz * R, hx: dx, hz: dz }]);
    }
  }
  // sides: full edge where nothing joins, shoulders beside narrower roads
  for (let s = 0; s < 4; s++) {
    const [dx, dz] = DIRS[s], rx = -dz, rz = dx;
    const P = (l) => [x + dx * R + rx * l, y, z + dz * R + rz * l];
    const a = has[s];
    if (!a) edgeLine(G, P(-R), P(R), [dx, dz], style, bot);
    else if (R - a.half > 0.012) { edgeLine(G, P(-R), P(-a.half), [dx, dz], style, bot); edgeLine(G, P(a.half), P(R), [dx, dz], style, bot); }
    // stop line across the lanes coming in
    if (a && a.kind !== 'rail' && a.kind !== 'tram' && !N.cross) {
      const u0 = R + 0.012, u1 = R + 0.034;
      G.quad([x + dx * u0 - rx * 0.012, y + 0.0015, z + dz * u0 - rz * 0.012], [x + dx * u1 - rx * 0.012, y + 0.0015, z + dz * u1 - rz * 0.012],
        [x + dx * u1 - rx * (a.half - 0.03), y + 0.0015, z + dz * u1 - rz * (a.half - 0.03)], [x + dx * u0 - rx * (a.half - 0.03), y + 0.0015, z + dz * u0 - rz * (a.half - 0.03)], PAL.mark, UP);
    }
  }
  if (style === 'tunnel') G.quad([x - R - 0.04, y + 0.3, z - R - 0.04], [x + R + 0.04, y + 0.3, z - R - 0.04], [x + R + 0.04, y + 0.3, z + R + 0.04], [x - R - 0.04, y + 0.3, z + R + 0.04], PAL.tunnelTop, DOWN);
  if (style === 'elev' || style === 'bridge') G.quad([x - R, y - 0.1, z - R], [x + R, y - 0.1, z - R], [x + R, y - 0.1, z + R], [x - R, y - 0.1, z + R], PAL.deck, DOWN);
}
function fanDown(G, x, z, y, r) {
  for (let i = 0; i < 20; i++) {
    const t0 = (i / 20) * Math.PI * 2, t1 = ((i + 1) / 20) * Math.PI * 2;
    G.quad([x, y, z], [x + Math.cos(t0) * r, y, z + Math.sin(t0) * r], [x + Math.cos(t1) * r, y, z + Math.sin(t1) * r], [x, y, z], PAL.deck, DOWN);
  }
}

function deadEnd(G, N, a, style, bot) {
  const y = N.h + 0.012, h = a.half;
  const aa = Math.atan2(DIRS[a.d][1], DIRS[a.d][0]);
  const surf = a.kind === 'motorway' ? PAL.motorway : a.kind === 'tram' ? PAL.tramBed : a.kind === 'rail' ? PAL.ballast : PAL.asphalt;
  fan(G, N.x, N.y, y - (a.kind === 'rail' ? 0.004 : a.kind === 'tram' ? 0.002 : 0), h, 14, surf, aa + Math.PI / 2, aa + Math.PI * 1.5);
  if (a.kind === 'rail') {
    // buffer stop
    const [dx, dz] = DIRS[a.d];
    for (const t of [-0.13, 0.13]) boxAlong(G, N.x, N.y, dx, dz, -0.06, 0.0, t - 0.07, t + 0.07, N.h, N.h + 0.07, col('#e8443a'));
    return;
  }
  for (let i = 0; i < 10; i++) {
    const t0 = aa + Math.PI / 2 + (Math.PI * i) / 10, t1 = aa + Math.PI / 2 + (Math.PI * (i + 1)) / 10, tm = (t0 + t1) / 2;
    edgeLine(G, [N.x + Math.cos(t0) * h, y, N.y + Math.sin(t0) * h], [N.x + Math.cos(t1) * h, y, N.y + Math.sin(t1) * h], [Math.cos(tm), Math.sin(tm)], style, bot);
  }
}

function tunnelMouth(G, S, N, a) {
  const [dx, dz] = DIRS[a.d];
  const h = a.half, x = N.x, z = N.y;
  const w = h + 0.11;
  // portal frame at the tile edge, facing back along the road
  boxAlong(G, x, z, dx, dz, 0.47, 0.55, -w, -h, 0, 0.27, PAL.arch);
  boxAlong(G, x, z, dx, dz, 0.47, 0.55, h, w, 0, 0.27, PAL.arch);
  boxAlong(G, x, z, dx, dz, 0.47, 0.55, -h, h, 0.2, 0.27, PAL.arch);
  boxAlong(G, x, z, dx, dz, 0.45, 0.47, -w - 0.01, w + 0.01, 0.255, 0.29, PAL.arch);
  // dark mouth
  const P = (u, l, y) => [x + dx * u - dz * l, y, z + dz * u + dx * l];
  G.quad(P(0.475, -h, 0.005), P(0.475, h, 0.005), P(0.475, h, 0.2), P(0.475, -h, 0.2), PAL.mouth, [-dx, 0, -dz]);
  // grassy mound over the tunnel mouth (not on mountains, which cover it anyway)
  const tt = terrainAt(S, x + dx, z + dz);
  if (tt === TER.MOUNTAIN) return;
  const k = tt === TER.WATER ? PAL.sand : PAL.edge;
  const u0 = 0.55, u1 = 0.95, top = 0.2;
  G.quad(P(u0, -w, top), P(u0, w, top), P(u1, w, 0.0), P(u1, -w, 0.0), k, [dx, 1, dz]);
  G.triW(P(u0, -w, top), P(u1, -w, 0), P(u0, -w, 0), k, [dz, 0, -dx]);
  G.triW(P(u0, w, top), P(u1, w, 0), P(u0, w, 0), k, [-dz, 0, dx]);
}

function pillar(G, S, N) {
  const g = S.nodes[S.WH + N.t];
  if (g && g.dirs.some((id) => id >= 0)) return; // a road runs underneath
  if (S.bld[N.t] >= 0) return;
  const y0 = groundY(S, N.x, N.y);
  boxAt(G, N.x, N.y, 0.13, 0.13, y0, N.h - 0.09, PAL.pillar);
  boxAt(G, N.x, N.y, 0.24, 0.24, y0, y0 + 0.03, PAL.concrete);
}

function stopModel(G, S, N, arms, out) {
  const st = N.stop;
  const a = arms[0];
  const [dx, dz] = DIRS[a.d];
  const h = Math.max(...arms.map((q) => q.half));
  const y = N.h + 0.012, x = N.x, z = N.y;
  const big = st.type === 'station';
  const len = big ? 0.46 : 0.3, wid = big ? 0.15 : 0.1;
  for (const s of [-1, 1]) {
    const l0 = s > 0 ? h + 0.015 : -h - 0.015 - wid, l1 = l0 + wid;
    boxAlong(G, x, z, dx, dz, -len, len, l0, l1, N.h, y + 0.04, PAL.platform);
    // edge stripe
    const le = s > 0 ? l0 : l1 - 0.015;
    boxAlong(G, x, z, dx, dz, -len, len, le, le + 0.015, y + 0.04, y + 0.043, PAL.yellow);
    // shelter / canopy
    const lc = s > 0 ? l1 - 0.03 : l0;
    const roofL0 = s > 0 ? l0 + 0.01 : l0, roofL1 = s > 0 ? l1 : l1 - 0.01;
    const rl = big ? len * 0.8 : 0.14;
    for (const u of big ? [-rl * 0.85, 0, rl * 0.85] : [-rl * 0.85, rl * 0.85]) boxAlong(G, x, z, dx, dz, u - 0.012, u + 0.012, lc, lc + 0.024, y + 0.04, y + 0.2, PAL.pole);
    boxAlong(G, x, z, dx, dz, -rl, rl, roofL0, roofL1, y + 0.2, y + 0.225, big ? PAL.canopy : col('#5fc6ff'));
  }
  out.push({ key: st.key, x, y: y + 0.3, z });
}

function signalGizmos(G, S, N, arms, lamps, gates, sigMode) {
  const R = N.R;
  const ctl = N.lights || N.sig;
  for (const a of arms) {
    if (a.kind === 'rail') continue;
    const s = a.d;
    const [dx, dz] = DIRS[s];
    const [tx, tz] = DIRS[opp(s)]; // inbound travel direction
    const rx = -tz, rz = tx; // right of inbound traffic
    const h = a.half;
    if (ctl && (!N.sig || N.sig[s] != null)) {
      const px = N.x + dx * (R + 0.05) + rx * (h + 0.06), pz = N.y + dz * (R + 0.05) + rz * (h + 0.06);
      boxAt(G, px, pz, 0.028, 0.028, N.h, N.h + 0.34, PAL.pole);
      boxAt(G, px + dx * 0.012, pz + dz * 0.012, 0.07, 0.07, N.h + 0.27, N.h + 0.4, PAL.head);
      lamps.push({ key: N.key, side: s, x: px + dx * 0.05, y: N.h + 0.335, z: pz + dz * 0.05, type: 'sig' });
    }
    if (N.cross) {
      const px = N.x + dx * (R + 0.05) - rx * (h + 0.06), pz = N.y + dz * (R + 0.05) - rz * (h + 0.06);
      boxAt(G, px, pz, 0.026, 0.026, N.h, N.h + 0.3, PAL.pole);
      boxAlong(G, px, pz, rx, rz, -0.07, 0.07, -0.012, 0.012, N.h + 0.27, N.h + 0.29, PAL.head);
      lamps.push({ key: N.key, side: s, x: px - rx * 0.05 + dx * 0.02, y: N.h + 0.25, z: pz - rz * 0.05 + dz * 0.02, type: 'cross', k: 0 });
      lamps.push({ key: N.key, side: s, x: px + rx * 0.05 + dx * 0.02, y: N.h + 0.25, z: pz + rz * 0.05 + dz * 0.02, type: 'cross', k: 1 });
      if (!sigMode) {
        const gx = N.x + dx * (R + 0.1) + rx * (h + 0.05), gz = N.y + dz * (R + 0.1) + rz * (h + 0.05);
        boxAt(G, gx, gz, 0.05, 0.05, N.h, N.h + 0.12, col('#e8443a'));
        gates.push({ key: N.key, x: gx, y: N.h + 0.1, z: gz, ax: -rx, az: -rz, len: h + 0.02, open: 1 });
      }
    }
  }
}

// ------------------------------------------------------------------ terrain
function buildGround(S, margin, lockOn) {
  const G = new Geo();
  const W = S.W, H = S.H, b = S.bounds;
  const ter = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? (margin ? TER.GRASS : -1) : S.terrain[y * W + x]);
  const x0 = -margin, y0 = -margin, x1 = W - 1 + margin, y1 = H - 1 + margin;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = ter(x, y);
    const outside = x < 0 || y < 0 || x >= W || y >= H;
    const locked = outside || (lockOn && (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1));
    const chk = (x + y) & 1;
    if (t === TER.WATER) {
      let shore = false;
      for (const [dx, dy] of DIRS) { const n = ter(x + dx, y + dy); if (n !== TER.WATER && n !== -1) shore = true; }
      const k = (shore ? PAL.shallow : PAL.water).clone();
      if (locked) k.lerp(PAL.locked, 0.35);
      G.quad([x - 0.5, -0.07, y - 0.5], [x + 0.5, -0.07, y - 0.5], [x + 0.5, -0.07, y + 0.5], [x - 0.5, -0.07, y + 0.5], k, UP);
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DIRS[d];
        const n = ter(x + dx, y + dy);
        if (n === TER.WATER || n === -1) continue;
        const ex = x + dx * 0.5, ez = y + dy * 0.5, rx = -dy * 0.5, rz = dx * 0.5;
        G.quad([ex - rx, 0, ez - rz], [ex + rx, 0, ez + rz], [ex + rx, -0.07, ez + rz], [ex - rx, -0.07, ez - rz], PAL.sand, [-dx, 0, -dy]);
      }
    } else {
      const k = (locked ? (chk ? PAL.locked : PAL.lockedB) : chk ? PAL.grass : PAL.grassB).clone().multiplyScalar(0.97 + hash(x + 100, y + 100) * 0.05);
      G.quad([x - 0.5, 0, y - 0.5], [x + 0.5, 0, y - 0.5], [x + 0.5, 0, y + 0.5], [x - 0.5, 0, y + 0.5], k, UP);
    }
  }
  // the board's earthy sides
  const side = (ax, az, bx, bz, o, yTop) => {
    G.quad([ax, yTop, az], [bx, yTop, bz], [bx, -0.34, bz], [ax, -0.34, az], PAL.dirt, o);
    G.quad([ax, -0.34, az], [bx, -0.34, bz], [bx, -0.95, bz], [ax, -0.95, az], PAL.dirtDark, o);
  };
  const top = (x, y) => (ter(x, y) === TER.WATER ? -0.07 : 0);
  for (let x = x0; x <= x1; x++) {
    side(x - 0.5, y0 - 0.5, x + 0.5, y0 - 0.5, [0, 0, -1], top(x, y0));
    side(x - 0.5, y1 + 0.5, x + 0.5, y1 + 0.5, [0, 0, 1], top(x, y1));
  }
  for (let y = y0; y <= y1; y++) {
    side(x0 - 0.5, y - 0.5, x0 - 0.5, y + 0.5, [-1, 0, 0], top(x0, y));
    side(x1 + 0.5, y - 0.5, x1 + 0.5, y + 0.5, [1, 0, 0], top(x1, y));
  }
  return G.build();
}

// ------------------------------------------------------------------ models
function carGeos() {
  const B = new Geo(), T = new Geo();
  const y = 0.012;
  boxAt(B, 0, 0, 0.22, 0.12, y + 0.022, y + 0.068, WHITE);
  boxAt(B, -0.012, 0, 0.105, 0.1, y + 0.106, y + 0.116, WHITE);
  boxAt(T, -0.012, 0, 0.115, 0.106, y + 0.068, y + 0.106, PAL.glassDark);
  for (const sx of [-0.068, 0.068]) for (const sz of [-0.056, 0.056]) boxAt(T, sx, sz, 0.05, 0.026, y, y + 0.046, col('#26272b'));
  for (const sz of [-0.038, 0.038]) {
    boxAt(T, 0.111, sz, 0.006, 0.026, y + 0.04, y + 0.056, col('#fff7c7'));
    boxAt(T, -0.111, sz, 0.006, 0.026, y + 0.04, y + 0.056, col('#ff4646'));
  }
  return { body: B.build(), trim: T.build() };
}
function tramGeos() {
  const B = new Geo(), T = new Geo();
  const y = 0.012;
  boxAt(B, 0, 0, 0.22, 0.148, y + 0.03, y + 0.15, WHITE);
  boxAt(T, 0, 0, 0.2, 0.152, y + 0.085, y + 0.132, PAL.glassDark);
  boxAt(T, 0, 0, 0.215, 0.14, y + 0.15, y + 0.168, col('#eef0f2'));
  boxAt(T, 0, 0, 0.2, 0.13, y, y + 0.03, col('#3a3d44'));
  boxAt(T, 0, 0, 0.012, 0.09, y + 0.168, y + 0.215, col('#3a3d44'));
  boxAt(T, 0, 0, 0.09, 0.012, y + 0.21, y + 0.218, col('#3a3d44'));
  return { body: B.build(), trim: T.build() };
}
function trainGeos() {
  const B = new Geo(), T = new Geo();
  const y = 0.012;
  boxAt(B, 0, 0, 0.53, 0.178, y + 0.04, y + 0.19, WHITE);
  boxAt(T, 0, 0, 0.49, 0.182, y + 0.11, y + 0.16, PAL.glassDark);
  boxAt(T, 0, 0, 0.52, 0.16, y + 0.19, y + 0.215, col('#e2e4e8'));
  for (const sx of [-0.18, 0.18]) boxAt(T, sx, 0, 0.13, 0.15, y, y + 0.045, col('#2e3036'));
  boxAt(T, 0, 0, 0.53, 0.182, y + 0.06, y + 0.075, WHITE);
  return { body: B.build(), trim: T.build() };
}
function houseGeos() {
  const B = new Geo(), R = new Geo(), T = new Geo();
  boxAt(B, 0, 0, 0.48, 0.4, 0, 0.29, WHITE);
  roofAt(R, 0, 0, 0.56, 0.5, 0.28, 0.47, WHITE);
  boxAt(T, 0, 0.2, 0.09, 0.016, 0, 0.16, PAL.door);
  for (const sx of [-0.14, 0.14]) {
    boxAt(T, sx, 0.2, 0.1, 0.014, 0.12, 0.215, WHITE);
    boxAt(T, sx, 0.203, 0.076, 0.014, 0.13, 0.205, PAL.glass);
  }
  for (const sx of [-0.12, 0.12]) boxAt(T, sx, -0.2, 0.09, 0.014, 0.12, 0.21, PAL.glass);
  for (const sz of [-0.06, 0.06]) for (const sx of [-0.24, 0.24]) boxAt(T, sx, sz * 1.5, 0.014, 0.08, 0.12, 0.21, PAL.glass);
  boxAt(T, 0.14, -0.08, 0.07, 0.07, 0.36, 0.54, PAL.roofGray);
  boxAt(T, 0, 0.27, 0.16, 0.12, 0, 0.012, PAL.concrete);
  return { body: B.build(), roof: R.build(), trim: T.build() };
}
function treeGeos() {
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.16, 6).translate(0, 0.08, 0);
  const crown = new THREE.IcosahedronGeometry(1, 1);
  return { trunk, crown };
}
function gateGeo() {
  const G = new Geo();
  const n = 6;
  for (let i = 0; i < n; i++) boxAlong(G, 0, 0, 1, 0, i / n, (i + 1) / n, -0.012, 0.012, -0.012, 0.012, i & 1 ? WHITE : col('#e8443a'));
  return G.build();
}

// destination: a 2x2 block with a car park on the lot corner
const DEST_STYLE = [
  { h: 0.46, annex: 0.3, awning: '#ffffff' },   // diner
  { h: 1.18, annex: 0.42 },                      // offices
  { h: 0.5, annex: 0.34, awning: '#ffffff' },   // market
  { h: 0.6, annex: 0.5, tower: true },           // school
  { h: 0.62, annex: 0.4, glass: true },          // mall
  { h: 0.92, annex: 0.44, cross: true },         // hospital
];
function destGeo(S, d) {
  const G = new Geo();
  const base = col(DISTRICTS[d.color].hex);
  const light = base.clone().lerp(WHITE, 0.3), dark = base.clone().multiplyScalar(0.72);
  const st = DEST_STYLE[d.color] || DEST_STYLE[0];
  const lx = d.lot.x, ly = d.lot.y;
  const ox = lx === d.x ? d.x + 1 : d.x, oy = ly === d.y ? d.y + 1 : d.y;
  const fz = Math.sign(ly - oy); // the main block's front faces the car park row
  // car park
  G.quad([lx - 0.48, 0.007, ly - 0.48], [lx + 0.48, 0.007, ly - 0.48], [lx + 0.48, 0.007, ly + 0.48], [lx - 0.48, 0.007, ly + 0.48], PAL.lot, UP);
  const ix = Math.sign(ox - lx), iz = Math.sign(oy - ly);
  for (let i = 0; i < 3; i++) {
    const sx = lx + ix * (0.06 + i * 0.16);
    boxAt(G, sx, ly + iz * 0.3, 0.012, 0.3, 0.007, 0.009, PAL.mark);
  }
  // plinth
  for (const [tx, ty] of [[ox, ly], [d.x, oy], [d.x + 1, oy]]) boxAt(G, tx, ty, 1, 1, 0, 0.03, PAL.concrete);
  // main block across the back row
  const mx = d.x + 0.5, mz = oy;
  boxAt(G, mx, mz, 1.8, 0.86, 0.03, st.h, st.glass ? light : base);
  for (let y = 0.17; y < st.h - 0.1; y += 0.19) boxAt(G, mx, mz, 1.82, 0.88, y, y + 0.08, st.glass ? PAL.glass : col('#e4f6ff'));
  if (st.glass) boxAt(G, mx, mz + fz * 0.44, 1.2, 0.02, 0.03, st.h * 0.75, PAL.glass);
  boxAt(G, mx, mz, 1.84, 0.9, st.h, st.h + 0.04, dark);
  boxAt(G, mx - 0.45, mz, 0.3, 0.26, st.h + 0.04, st.h + 0.12, PAL.roofGray);
  // annex beside the car park
  boxAt(G, ox, ly, 0.86, 0.82, 0.03, st.annex, light);
  boxAt(G, ox, ly, 0.88, 0.84, st.annex, st.annex + 0.03, dark);
  boxAt(G, ox, ly + fz * 0.42, 0.16, 0.02, 0.03, 0.2, PAL.door);
  for (const sx of [-0.25, 0.25]) boxAt(G, ox + sx, ly + fz * 0.415, 0.14, 0.02, 0.13, 0.23, PAL.glass);
  if (st.awning) {
    for (let i = 0; i < 8; i++) {
      const x0 = d.x - 0.4 + i * 0.225;
      boxAlong(G, x0, mz + fz * 0.43, 1, 0, 0, 0.225, fz > 0 ? 0 : -0.16, fz > 0 ? 0.16 : 0, 0.24, 0.27, i & 1 ? col(st.awning) : base);
    }
  }
  if (d.color === 1) boxAt(G, mx + 0.5, mz, 0.03, 0.03, st.h + 0.04, st.h + 0.4, PAL.pole);
  if (st.tower) {
    boxAt(G, ox, ly, 0.3, 0.3, st.annex, st.annex + 0.42, light);
    roofAt(G, ox, ly, 0.36, 0.36, st.annex + 0.42, st.annex + 0.62, dark);
    boxAt(G, ox, ly + fz * 0.152, 0.16, 0.012, st.annex + 0.24, st.annex + 0.36, WHITE);
  }
  if (st.cross) {
    boxAt(G, mx, mz, 0.36, 0.1, st.h + 0.04, st.h + 0.07, WHITE);
    boxAt(G, mx, mz, 0.1, 0.36, st.h + 0.04, st.h + 0.07, WHITE);
    boxAt(G, mx + 0.6, mz + fz * 0.452, 0.22, 0.012, st.h - 0.3, st.h - 0.08, WHITE);
    boxAt(G, mx + 0.6, mz + fz * 0.458, 0.06, 0.012, st.h - 0.28, st.h - 0.1, col('#ff4a5a'));
    boxAt(G, mx + 0.6, mz + fz * 0.458, 0.18, 0.012, st.h - 0.22, st.h - 0.16, col('#ff4a5a'));
  }
  return G.build();
}

// ------------------------------------------------------------------ instanced helper
class Inst {
  constructor(parent, geo, mat, cap, { tint = false, shadow = true, recv = false } = {}) {
    this.parent = parent; this.geo = geo; this.mat = mat; this.tint = tint; this.shadow = shadow; this.recv = recv;
    this.make(cap);
  }
  make(cap) {
    if (this.mesh) { this.parent.remove(this.mesh); this.mesh.dispose(); }
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = this.shadow; m.receiveShadow = this.recv;
    m.frustumCulled = false;
    m.count = 0;
    if (this.tint) m.setColorAt(0, WHITE);
    this.parent.add(m);
    this.mesh = m; this.cap = cap;
  }
  ensure(n) { if (n > this.cap) this.make(Math.max(n, this.cap * 2)); }
  done(n) {
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.tint && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const hash = (a, b = 0) => {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ------------------------------------------------------------------ world
export function createWorld(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const M = {
    ground: std({ vertexColors: true, roughness: 1 }),
    net: std({ vertexColors: true }),
    bld: std({ vertexColors: true, roughness: 0.7 }),
    tint: std({ roughness: 0.55, metalness: 0.05 }),
    trim: std({ vertexColors: true, roughness: 0.5 }),
    crown: std({ flatShading: true, roughness: 0.9 }),
    trunk: std({ color: '#9b6a43' }),
    rock: std({ flatShading: true, roughness: 0.95 }),
    snow: std({ color: '#ffffff', flatShading: true, roughness: 0.8 }),
    lamp: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    ghost: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    prev: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }),
    line: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }),
    grid: new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false }),
    hover: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthTest: false, depthWrite: false }),
  };

  const groundMesh = new THREE.Mesh(new THREE.BufferGeometry(), M.ground);
  groundMesh.receiveShadow = true;
  root.add(groundMesh);
  const netMesh = new THREE.Mesh(new THREE.BufferGeometry(), M.net);
  netMesh.castShadow = true; netMesh.receiveShadow = true;
  root.add(netMesh);
  const glowMesh = new THREE.Mesh(new THREE.BufferGeometry(), M.glow);
  root.add(glowMesh);
  const ghostMesh = new THREE.Mesh(new THREE.BufferGeometry(), M.ghost);
  ghostMesh.renderOrder = 2;
  root.add(ghostMesh);
  const prevMesh = new THREE.Mesh(new THREE.BufferGeometry(), M.prev);
  prevMesh.renderOrder = 10;
  root.add(prevMesh);
  const lineMesh = new THREE.Mesh(new THREE.BufferGeometry(), M.line);
  lineMesh.renderOrder = 3; lineMesh.visible = false;
  root.add(lineMesh);
  const gridMesh = new THREE.LineSegments(new THREE.BufferGeometry(), M.grid);
  gridMesh.visible = false; gridMesh.renderOrder = 1;
  root.add(gridMesh);
  const hoverMesh = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.68, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), M.hover);
  hoverMesh.visible = false; hoverMesh.renderOrder = 11;
  root.add(hoverMesh);
  const destGroup = new THREE.Group();
  root.add(destGroup);

  const car = carGeos(), tram = tramGeos(), train = trainGeos(), house = houseGeos(), tree = treeGeos();
  const I = {
    carB: new Inst(root, car.body, M.tint, 256, { tint: true }),
    carT: new Inst(root, car.trim, M.trim, 256),
    tramB: new Inst(root, tram.body, M.tint, 32, { tint: true }),
    tramT: new Inst(root, tram.trim, M.trim, 32),
    trainB: new Inst(root, train.body, M.tint, 32, { tint: true }),
    trainT: new Inst(root, train.trim, M.trim, 32),
    houseB: new Inst(root, house.body, M.tint, 64, { tint: true, recv: true }),
    houseR: new Inst(root, house.roof, M.tint, 64, { tint: true }),
    houseT: new Inst(root, house.trim, M.trim, 64),
    trunk: new Inst(root, tree.trunk, M.trunk, 256),
    crown: new Inst(root, tree.crown, M.crown, 256, { tint: true }),
    rock: new Inst(root, new THREE.ConeGeometry(1, 1, 6, 1).translate(0, 0.5, 0), M.rock, 64, { tint: true, recv: true }),
    snow: new Inst(root, new THREE.ConeGeometry(1, 1, 6, 1).translate(0, 0.5, 0), M.snow, 64),
    lamp: new Inst(root, new THREE.SphereGeometry(0.03, 10, 8), M.lamp, 64, { tint: true, shadow: false }),
    gate: new Inst(root, gateGeo(), M.trim, 16),
  };

  const m4 = new THREE.Matrix4(), m5 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const W = {
    S: null, ver: {}, lamps: [], gates: [], stops: [], houseFace: new Map(), born: new Map(), margin: 0, sig: false,
    destMeshes: new Map(), clock: 0,
  };

  function compose(x, y, z, yaw, sx, sy, sz, out = m4) {
    q.setFromAxisAngle(Y.set(0, 1, 0), yaw);
    return out.compose(v3.set(x, y, z), q, s3.set(sx, sy, sz));
  }

  // ---------------------------------------------------------------- static rebuilds
  function setGeo(mesh, geo) { mesh.geometry.dispose(); mesh.geometry = geo || new THREE.BufferGeometry(); }

  function rebuildGround() {
    const S = W.S;
    setGeo(groundMesh, buildGround(S, W.margin, S.mode === 'city'));
    // mountains
    const list = [];
    for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) if (S.terrain[y * S.W + x] === TER.MOUNTAIN) list.push([x, y]);
    I.rock.ensure(list.length * 2); I.snow.ensure(list.length * 2);
    let n = 0;
    for (const [x, y] of list) {
      const r = hash(x, y), r2 = hash(y + 7, x + 3);
      const h = 0.6 + r * 0.5;
      compose(x + (r2 - 0.5) * 0.1, 0, y + (r - 0.5) * 0.1, r * 6, 0.56, h, 0.56);
      I.rock.mesh.setMatrixAt(n, m4); I.rock.mesh.setColorAt(n, ROCK_COLS[(r2 * 4) | 0]);
      compose(x + (r2 - 0.5) * 0.1, h * 0.6, y + (r - 0.5) * 0.1, r * 6, 0.56 * 0.43, h * 0.415, 0.56 * 0.43);
      I.snow.mesh.setMatrixAt(n, m4);
      n++;
      if (r2 > 0.45) {
        const h2 = 0.35 + r2 * 0.3, ox = (r - 0.5) * 0.5, oz = (r2 - 0.5) * 0.5;
        compose(x + ox + 0.22, 0, y + oz - 0.2, r2 * 5, 0.3, h2, 0.3);
        I.rock.mesh.setMatrixAt(n, m4); I.rock.mesh.setColorAt(n, ROCK_COLS[(r * 4) | 0]);
        compose(x + ox + 0.22, h2 * 0.65, y + oz - 0.2, r2 * 5, 0.3 * 0.38, h2 * 0.365, 0.3 * 0.38);
        I.snow.mesh.setMatrixAt(n, m4);
        n++;
      }
    }
    I.rock.done(n); I.snow.done(n);
    // build grid
    const g = [];
    const b = S.mode === 'city' ? S.bounds : { x0: 0, y0: 0, x1: S.W - 1, y1: S.H - 1 };
    for (let x = b.x0; x <= b.x1 + 1; x++) g.push(x - 0.5, 0.004, b.y0 - 0.5, x - 0.5, 0.004, b.y1 + 0.5);
    for (let y = b.y0; y <= b.y1 + 1; y++) g.push(b.x0 - 0.5, 0.004, y - 0.5, b.x1 + 0.5, 0.004, y - 0.5);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(g, 3));
    gridMesh.geometry.dispose(); gridMesh.geometry = gg;
  }

  function rebuildNet() {
    const r = buildNet(W.S, W.sig);
    setGeo(netMesh, r.geo);
    setGeo(ghostMesh, r.ghost);
    setGeo(glowMesh, r.glow);
    W.lamps = r.lamps; W.gates = r.gates; W.stops = r.stops;
    I.lamp.ensure(W.lamps.length); I.gate.ensure(W.gates.length);
  }

  function rebuildTrees() {
    const S = W.S;
    const list = [];
    for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) {
      const t = y * S.W + x;
      if (!S.trees[t] || S.terrain[t] !== TER.GRASS || S.bld[t] >= 0) continue;
      if (S.nodes[S.WH + t] || S.nodes[2 * S.WH + t]) continue;
      const n = 1 + ((hash(x, y) * 3) | 0);
      for (let i = 0; i < n; i++) {
        const a = hash(x * 3 + i, y * 5 - i), b2 = hash(y * 7 + i, x * 11 + i);
        list.push([x + (a - 0.5) * 0.62, y + (b2 - 0.5) * 0.62, 0.15 + hash(x + i * 13, y + 3) * 0.1, (a * 5) | 0]);
      }
    }
    // a little tree on every roundabout island
    for (const N of S.junctions) if (N.ctrl === 'round') list.push([N.x, N.y, 0.09, 1, N.h + 0.035]);
    // a fringe of trees around the board in signal levels
    if (W.margin) {
      for (let y = -W.margin; y < S.H + W.margin; y++) for (let x = -W.margin; x < S.W + W.margin; x++) {
        if (x >= 0 && y >= 0 && x < S.W && y < S.H) continue;
        if (hash(x + 40, y + 40) < 0.55) continue;
        let road = false;
        for (const p of S.portals || []) if ((p.x === 0 || p.x === S.W - 1) ? p.y === y : p.x === x) road = true;
        if (road) continue;
        list.push([x + (hash(x, y + 9) - 0.5) * 0.5, y + (hash(y, x + 9) - 0.5) * 0.5, 0.16 + hash(x, y) * 0.1, (hash(y, x) * 5) | 0]);
      }
    }
    I.trunk.ensure(list.length); I.crown.ensure(list.length);
    let i = 0;
    for (const [x, z, s, c, y0 = 0] of list) {
      compose(x, y0, z, 0, s * 4.5, s * 4.5, s * 4.5);
      I.trunk.mesh.setMatrixAt(i, m4);
      compose(x, y0 + s * 0.7 + 0.07 * s * 4.5, z, hash(i) * 3, s, s * 1.05, s);
      I.crown.mesh.setMatrixAt(i, m4); I.crown.mesh.setColorAt(i, TREE_COLS[c % TREE_COLS.length]);
      i++;
    }
    I.trunk.done(i); I.crown.done(i);
  }

  function rebuildBuildings() {
    const S = W.S;
    // houses (instanced)
    I.houseB.ensure(S.houses.length); I.houseR.ensure(S.houses.length); I.houseT.ensure(S.houses.length);
    W.houseFace.clear();
    for (const h of S.houses) {
      const N = S.nodes[h.key];
      let d = 1;
      if (N) for (let k = 0; k < 4; k++) if (N.dirs[k] >= 0) { d = k; break; }
      W.houseFace.set(h.id, d);
      if (!W.born.has(h.id)) W.born.set(h.id, W.ver.first ? -10 : W.clock);
    }
    // destinations (one mesh each so they can pop in)
    const live = new Set();
    for (const d of S.dests) {
      live.add(d.id);
      if (W.destMeshes.has(d.id)) continue;
      const mesh = new THREE.Mesh(destGeo(S, d), M.bld);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.d = d;
      destGroup.add(mesh);
      W.destMeshes.set(d.id, mesh);
      if (!W.born.has(d.id)) W.born.set(d.id, W.ver.first ? -10 : W.clock);
    }
    for (const [id, mesh] of W.destMeshes) if (!live.has(id)) { destGroup.remove(mesh); mesh.geometry.dispose(); W.destMeshes.delete(id); }
    W.houseDirty = true;
  }

  function rebuildLines() {
    const S = W.S;
    const G = new Geo();
    for (const line of S.lines) {
      const k = col(line.color);
      for (let i = 0; i < line.path.length - 1; i++) {
        const a = keyInfo(S, line.path[i]), b = keyInfo(S, line.path[i + 1]);
        const ha = LEVEL_H[a.lvl + 1], hb = LEVEL_H[b.lvl + 1];
        const dx = b.x - a.x, dz = b.y - a.y;
        const pts = [];
        const steps = ha === hb ? 1 : 6;
        for (let s = 0; s <= steps; s++) { const u = s / steps; pts.push({ x: a.x + dx * u, y: rampY(ha, hb, u) + 0.07, z: a.y + dz * u, hx: dx, hz: dz }); }
        const off = ((line.id % 3) - 1) * 0.05;
        band(G, pts, off - 0.03, off + 0.03, 0, k);
      }
    }
    setGeo(lineMesh, G.empty ? null : G.build());
  }

  function sync() {
    const S = W.S, v = W.ver;
    if (v.bounds !== S.boundsV) { v.bounds = S.boundsV; rebuildGround(); }
    const netKey = S.netV + '|' + S.lineV;
    if (v.net !== netKey) { v.net = netKey; rebuildNet(); }
    if (v.bld !== S.bldV + '|' + S.netV) {
      v.bld = S.bldV + '|' + S.netV;
      rebuildBuildings();
      rebuildTrees();
    }
    if (v.line !== S.lineV + '|' + S.netV) { v.line = S.lineV + '|' + S.netV; rebuildLines(); }
    v.first = false;
  }

  // ---------------------------------------------------------------- per-frame
  const _f = {}, _r = {};
  function placeBetween(S, v, b0, b1, wob = 0) {
    vehPose(S, v, b0, _f); vehPose(S, v, b1, _r);
    let fx = _f.x - _r.x, fy = _f.y - _r.y, fz = _f.z - _r.z;
    let L = Math.hypot(fx, fy, fz);
    if (L < 1e-4) { fx = _f.hx; fz = _f.hz; fy = 0; L = Math.hypot(fx, fz) || 1; }
    X.set(fx / L, fy / L, fz / L);
    if (wob) X.applyAxisAngle(Y.set(0, 1, 0), wob);
    Y.set(0, 1, 0).addScaledVector(X, -X.y).normalize();
    Z.crossVectors(X, Y);
    m4.makeBasis(X, Y, Z);
    m4.setPosition((_f.x + _r.x) / 2, (_f.y + _r.y) / 2, (_f.z + _r.z) / 2);
    return m4;
  }
  const easeBack = (t) => { const c = 1.7; t = Math.min(1, t) - 1; return 1 + t * t * ((c + 1) * t + c); };

  function update(S, dt, opt = {}) {
    W.clock += dt;
    const t = W.clock;
    sync();
    const hide = opt.hideId ?? -1;
    // vehicles
    let nc = 0, nt = 0, nr = 0;
    let cars = 0, trams = 0, trains = 0;
    for (const v of S.vehicles) { if (v.kind === 'car') cars++; else if (v.kind === 'tram') trams++; else trains++; }
    let homeCars = 0;
    for (const h of S.houses) for (const c of h.cars) if (c.state === 'home') homeCars++;
    let parked = 0;
    for (const d of S.dests) parked += Math.min(3, d.parked.length);
    I.carB.ensure(cars + homeCars + parked); I.carT.ensure(cars + homeCars + parked);
    I.tramB.ensure(trams * 3); I.tramT.ensure(trams * 3);
    I.trainB.ensure(trains * 4); I.trainT.ensure(trains * 4);
    for (const v of S.vehicles) {
      if (!v.active || v.id === hide) continue;
      if (v.kind === 'car') {
        const wob = v.crashed > 0 ? Math.sin(t * 22 + v.id) * 0.35 * Math.min(1, v.crashed) : 0;
        placeBetween(S, v, 0.01, 0.23, wob);
        I.carB.mesh.setMatrixAt(nc, m4); I.carT.mesh.setMatrixAt(nc, m4);
        I.carB.mesh.setColorAt(nc, tmpC.set(DISTRICTS[v.color % 6].hex));
        nc++;
      } else if (v.kind === 'tram') {
        tmpC.set(v.line && v.line.color ? v.line.color : '#ffc93c');
        for (let i = 0; i < 3; i++) {
          placeBetween(S, v, i * 0.24 + 0.01, i * 0.24 + 0.23);
          I.tramB.mesh.setMatrixAt(nt, m4); I.tramT.mesh.setMatrixAt(nt, m4); I.tramB.mesh.setColorAt(nt, tmpC);
          nt++;
        }
      } else {
        tmpC.set(v.line && v.line.color ? v.line.color : '#ef4f3a');
        for (let i = 0; i < 4; i++) {
          placeBetween(S, v, i * 0.575 + 0.012, i * 0.575 + 0.562);
          I.trainB.mesh.setMatrixAt(nr, m4); I.trainT.mesh.setMatrixAt(nr, m4); I.trainB.mesh.setColorAt(nr, tmpC);
          nr++;
        }
      }
    }
    // cars parked at home and at work
    for (const h of S.houses) {
      const d = W.houseFace.get(h.id) ?? 1;
      const [dx, dz] = DIRS[d], rx = -dz, rz = dx;
      let k = 0;
      tmpC.set(DISTRICTS[h.color].hex);
      for (const c of h.cars) {
        if (c.state !== 'home') continue;
        const side = k++ ? 1 : -1;
        const x = h.x + dx * 0.34 + rx * side * 0.33, z = h.y + dz * 0.34 + rz * side * 0.33;
        compose(x, 0, z, Math.atan2(-dz, dx), 1, 1, 1);
        I.carB.mesh.setMatrixAt(nc, m4); I.carT.mesh.setMatrixAt(nc, m4); I.carB.mesh.setColorAt(nc, tmpC);
        nc++;
      }
    }
    for (const d of S.dests) {
      const lx = d.lot.x, ly = d.lot.y;
      const ox = lx === d.x ? d.x + 1 : d.x, oy = ly === d.y ? d.y + 1 : d.y;
      const ix = Math.sign(ox - lx), iz = Math.sign(oy - ly);
      for (let i = 0; i < Math.min(3, d.parked.length); i++) {
        const c = d.parked[i];
        compose(lx + ix * (0.14 + i * 0.16), 0, ly + iz * 0.3, Math.PI / 2, 1, 1, 1);
        I.carB.mesh.setMatrixAt(nc, m4); I.carT.mesh.setMatrixAt(nc, m4); I.carB.mesh.setColorAt(nc, tmpC.set(DISTRICTS[c.color % 6].hex));
        nc++;
      }
    }
    I.carB.done(nc); I.carT.done(nc); I.tramB.done(nt); I.tramT.done(nt); I.trainB.done(nr); I.trainT.done(nr);

    // houses (pop-in animation)
    if (W.houseDirty || W.popping) {
      W.houseDirty = false;
      W.popping = false;
      let i = 0;
      for (const h of S.houses) {
        const d = W.houseFace.get(h.id) ?? 1;
        const [dx, dz] = DIRS[d];
        const age = t - (W.born.get(h.id) ?? -10);
        const s = age < 0.6 ? Math.max(0.01, easeBack(age / 0.6)) : 1;
        if (age < 0.6) W.popping = true;
        const r = hash(h.id, 5), hs = 0.92 + r * 0.22;
        compose(h.x, 0, h.y, Math.atan2(dx, dz), s, s * hs, s);
        I.houseB.mesh.setMatrixAt(i, m4); I.houseR.mesh.setMatrixAt(i, m4); I.houseT.mesh.setMatrixAt(i, m4);
        const base = tmpC.set(DISTRICTS[h.color].hex);
        I.houseR.mesh.setColorAt(i, base);
        I.houseB.mesh.setColorAt(i, base.clone().lerp(WHITE, 0.5));
        i++;
      }
      I.houseB.done(i); I.houseR.done(i); I.houseT.done(i);
    }
    for (const [id, mesh] of W.destMeshes) {
      const age = t - (W.born.get(id) ?? -10);
      if (age < 0.8) {
        const d = mesh.userData.d;
        const s = Math.max(0.01, easeBack(age / 0.8));
        const cx = d.x + 0.5, cz = d.y + 0.5;
        mesh.position.set(cx * (1 - s), 0, cz * (1 - s));
        mesh.scale.set(s, s, s);
      } else if (mesh.scale.x !== 1) { mesh.scale.set(1, 1, 1); mesh.position.set(0, 0, 0); }
    }

    // traffic lights and level crossings
    let nl = 0;
    const blink = Math.floor(t * 3) & 1;
    for (const L of W.lamps) {
      const N = S.nodes[L.key];
      if (!N) continue;
      let c = '#3a3f48';
      if (L.type === 'sig') {
        if (N.sig) c = N.sig[L.side] === 'g' ? '#3dff6e' : N.sig[L.side] === 'y' ? '#ffd21f' : '#ff3b3b';
        else if (N.lights) {
          const ns = L.side === 1 || L.side === 3;
          const go = (N.lights.phase === 0) === ns;
          c = go ? (N.lights.clear > 0 ? '#ffd21f' : '#3dff6e') : '#ff3b3b';
        }
      } else {
        const warn = N.barrier || (W.sig && S.trainWarn && N.cross);
        c = warn && (blink ^ L.k) ? '#ff3b3b' : '#4a2a2a';
      }
      compose(L.x, L.y, L.z, 0, 1, 1, 1);
      I.lamp.mesh.setMatrixAt(nl, m4); I.lamp.mesh.setColorAt(nl, tmpC.set(c));
      nl++;
    }
    I.lamp.done(nl);
    let ng = 0;
    for (const g of W.gates) {
      const N = S.nodes[g.key];
      const want = N && N.barrier ? 0 : 1;
      g.open += (want - g.open) * Math.min(1, dt * 4);
      m4.makeTranslation(g.x, g.y, g.z);
      m4.multiply(m5.makeRotationY(Math.atan2(-g.az, g.ax)));
      m4.multiply(m5.makeRotationZ(g.open * 1.35));
      m4.multiply(m5.makeScale(g.len, 1, 1));
      I.gate.mesh.setMatrixAt(ng++, m4);
    }
    I.gate.done(ng);
  }

  // ---------------------------------------------------------------- tools
  function setPreview(S, plan, tiles, kind) {
    const G = new Geo();
    const ok = col('#45f07f'), bad = col('#ff4d5e');
    const lv = plan && plan.lv && plan.lv.length === tiles.length ? plan.lv : tiles.map(() => 0);
    const half = KIND[kind] ? KIND[kind].half : 0.2;
    const badSet = new Set(plan ? plan.bad : []);
    const allBad = plan && plan.err && !plan.bad.length;
    for (let i = 0; i < tiles.length - 1; i++) {
      const A = tiles[i], B = tiles[i + 1];
      const hA = LEVEL_H[lv[i] + 1], hB = LEVEL_H[lv[i + 1] + 1];
      const dx = B.x - A.x, dz = B.y - A.y;
      const pts = [];
      for (let k = 0; k <= 8; k++) { const u = k / 8; pts.push({ x: A.x + dx * u, y: rampY(hA, hB, u) + 0.04, z: A.y + dz * u, hx: dx, hz: dz }); }
      band(G, pts, -half, half, 0, allBad || badSet.has(i) ? bad : ok);
    }
    for (const b of plan ? plan.bad : []) {
      if (b >= 0) continue;
      const info = keyInfo(S, -1 - b);
      const y = LEVEL_H[info.lvl + 1] + 0.05;
      G.quad([info.x - 0.45, y, info.y - 0.45], [info.x + 0.45, y, info.y - 0.45], [info.x + 0.45, y, info.y + 0.45], [info.x - 0.45, y, info.y + 0.45], bad, UP);
    }
    if (tiles.length === 1) {
      const A = tiles[0];
      G.quad([A.x - 0.2, 0.05, A.y - 0.2], [A.x + 0.2, 0.05, A.y - 0.2], [A.x + 0.2, 0.05, A.y + 0.2], [A.x - 0.2, 0.05, A.y + 0.2], ok, UP);
    }
    setGeo(prevMesh, G.empty ? null : G.build());
  }
  function setTiles(tiles, hex) {
    const G = new Geo();
    const k = col(hex);
    for (const A of tiles) {
      const y = (A.h || 0) + 0.05;
      G.quad([A.x - 0.46, y, A.y - 0.46], [A.x + 0.46, y, A.y - 0.46], [A.x + 0.46, y, A.y + 0.46], [A.x - 0.46, y, A.y + 0.46], k, UP);
    }
    setGeo(prevMesh, G.empty ? null : G.build());
  }
  function clearPreview() { setGeo(prevMesh, null); }
  function setHover(x, y, h = 0, size = 1, hex = '#ffffff') {
    if (x == null) { hoverMesh.visible = false; return; }
    hoverMesh.visible = true;
    hoverMesh.position.set(x + (size - 1) / 2, h + 0.03, y + (size - 1) / 2);
    hoverMesh.scale.set(size, 1, size);
    M.hover.color.set(hex);
  }
  function setXray(on) {
    for (const m of [M.ground, M.rock, M.snow]) {
      m.transparent = on; m.opacity = on ? 0.38 : 1; m.depthWrite = !on; m.needsUpdate = true;
    }
    ghostMesh.visible = !on;
  }

  function setState(S, opts = {}) {
    W.S = S;
    W.sig = S.mode === 'signal';
    W.margin = W.sig ? 3 : S.mode === 'puzzle' ? 2 : opts.margin || 0;
    W.ver = { first: true };
    W.born.clear();
    for (const [, mesh] of W.destMeshes) { destGroup.remove(mesh); mesh.geometry.dispose(); }
    W.destMeshes.clear();
    sync();
    W.houseDirty = true;
  }

  return {
    root, setState, update, sync, setPreview, setTiles, clearPreview, setHover, setXray,
    setGrid(on) { gridMesh.visible = on; },
    setLines(on) { lineMesh.visible = on; },
    get stops() { return W.stops; },
    get lamps() { return W.lamps; },
    get margin() { return W.margin; },
  };
}
