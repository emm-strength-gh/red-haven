// Toy Cars Racing — pure simulation: track building, car physics, AI, laps.
// No Three.js here, so it runs headless in tests.

export const STEP = 2;      // track sample spacing (world units)
export const G = 34;        // gravity
export const CAR_R = 1.15;  // car collision radius
export const SPEED_TO_KMH = 3.6;

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTime(t) {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

// ------------------------------------------------------------------ paths

// centripetal Catmull-Rom on [x, z, y, w] vectors (knots from xz distance)
function cr(P0, P1, P2, P3, u) {
  const kn = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0, t1 = kn(P0, P1), t2 = t1 + kn(P1, P2), t3 = t2 + kn(P2, P3);
  const t = t1 + (t2 - t1) * u;
  const L = (A, B, ta, tb) => A.map((a, i) => ((tb - t) * a + (t - ta) * B[i]) / (tb - ta));
  const A1 = L(P0, P1, t0, t1), A2 = L(P1, P2, t1, t2), A3 = L(P2, P3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}

export function buildPath(points, { closed = true, width = 16, walls = true, surface = 'road' } = {}) {
  const P = points.map((p) => [p[0], p[1], p[2] ?? 0, p[3] ?? width]);
  const n = P.length;
  const get = (i) => {
    if (closed) return P[((i % n) + n) % n];
    if (i < 0) return P[0].map((v, k) => 2 * v - P[1][k]);
    if (i >= n) return P[n - 1].map((v, k) => 2 * v - P[n - 2][k]);
    return P[i];
  };
  const dense = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const sub = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.5));
    for (let j = 0; j < sub; j++) dense.push(cr(p0, p1, p2, p3, j / sub));
  }
  dense.push(closed ? dense[0].slice() : P[n - 1].slice());
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const len = cum[cum.length - 1];
  const count = closed ? Math.max(8, Math.round(len / STEP)) : Math.max(2, Math.round(len / STEP) + 1);
  const step = closed ? len / count : len / (count - 1);
  const x = new Float32Array(count), z = new Float32Array(count), y = new Float32Array(count), w = new Float32Array(count);
  const tx = new Float32Array(count), tz = new Float32Array(count);
  let k = 0;
  for (let i = 0; i < count; i++) {
    const s = i * step;
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const f = cum[k + 1] > cum[k] ? (s - cum[k]) / (cum[k + 1] - cum[k]) : 0;
    const a = dense[k], b = dense[k + 1];
    x[i] = a[0] + (b[0] - a[0]) * f; z[i] = a[1] + (b[1] - a[1]) * f;
    y[i] = a[2] + (b[2] - a[2]) * f; w[i] = a[3] + (b[3] - a[3]) * f;
  }
  for (let i = 0; i < count; i++) {
    const ia = closed ? (i - 1 + count) % count : Math.max(0, i - 1);
    const ib = closed ? (i + 1) % count : Math.min(count - 1, i + 1);
    const dx = x[ib] - x[ia], dz = z[ib] - z[ia], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }
  return { closed, n: count, len, step, x, z, y, w, tx, tz, walls, surface };
}

// Point on a path at distance s (wraps for closed paths). right = (-tz, tx).
export function pathPoint(path, s) {
  const { n, step } = path;
  let u = s / step;
  if (path.closed) u = ((u % n) + n) % n; else u = clamp(u, 0, n - 1.0001);
  const i = Math.floor(u), f = u - i, j = path.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
  const L = (A) => A[i] + (A[j] - A[i]) * f;
  let tx = L(path.tx), tz = L(path.tz); const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  return { x: L(path.x), z: L(path.z), y: L(path.y), w: L(path.w), tx, tz, rx: -tz, rz: tx, i };
}

export function nearestOnPath(path, px, pz, py = null) {
  const { n, x, z, y } = path;
  let best = 0, bs = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = px - x[i], dz = pz - z[i];
    let sc = dx * dx + dz * dz;
    if (sc >= bs) continue;
    if (py != null) {
      const dy = py - y[i];
      const pen = dy > 0 ? Math.max(0, dy - 2) * 3 : Math.max(0, -dy - 1.5) * 4;
      sc += pen * pen;
      if (sc >= bs) continue;
    }
    bs = sc; best = i;
  }
  // refine by projecting on the neighbouring segments
  let bestS = best * path.step, bestD2 = Infinity;
  for (const o of [-1, 0]) {
    let a = best + o, b = a + 1;
    if (path.closed) { a = (a + n) % n; b = (b + n) % n; } else if (a < 0 || b >= n) continue;
    const ax = x[a], az = z[a], bx = x[b], bz = z[b];
    const ex = bx - ax, ez = bz - az, el = ex * ex + ez * ez || 1;
    const f = clamp(((px - ax) * ex + (pz - az) * ez) / el, 0, 1);
    const qx = ax + ex * f, qz = az + ez * f, d2 = (px - qx) ** 2 + (pz - qz) ** 2;
    if (d2 < bestD2) { bestD2 = d2; bestS = (a + f) * path.step; }
  }
  const p = pathPoint(path, bestS);
  const d = (px - p.x) * p.rx + (pz - p.z) * p.rz;
  return { s: bestS, d, hw: p.w / 2, y: p.y, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz, i: p.i, score: bs };
}

// ------------------------------------------------------------------ track

const SURFACES = {
  road: { grip: 1, maxMul: 1 },
  dirt: { grip: 0.8, maxMul: 0.88, dirt: true },
  ice: { grip: 0.28, maxMul: 1.04 }
};

export function buildTrack(def) {
  const main = buildPath(def.points, { closed: true, width: def.width, walls: def.walls !== false });
  main.name = 'main';
  const L = main.len;
  const sAt = (at) => nearestOnPath(main, at[0], at[1]).s;
  const paths = [main];
  for (const sc of def.shortcuts || []) {
    const pts = sc.points.map((p) => p.slice());
    // endpoints sit on the main centre line, at its elevation
    const a = nearestOnPath(main, pts[0][0], pts[0][1]);
    const b = nearestOnPath(main, pts[pts.length - 1][0], pts[pts.length - 1][1]);
    const pa = pathPoint(main, a.s), pb = pathPoint(main, b.s);
    // funnel-shaped mouths so the junction is easy to enter
    const mw = Math.max(sc.width, def.width * 0.85);
    pts[0] = [pa.x, pa.z, pa.y, mw]; pts[pts.length - 1] = [pb.x, pb.z, pb.y, mw];
    for (let i = 1; i < pts.length - 1; i++) {
      if (pts[i][2] == null) pts[i][2] = pa.y + (pb.y - pa.y) * (i / (pts.length - 1));
    }
    const p = buildPath(pts, { closed: false, width: sc.width, walls: sc.walls !== false, surface: sc.surface || 'road' });
    p.name = sc.name; p.a = a.s; p.b = b.s; p.def = sc;
    // progress map: where the shortcut overlaps the main road use the main
    // road's own progress, in between interpolate by distance
    const m = new Float32Array(p.n), ov = [];
    const unwrap = (v) => { let u = v - a.s; while (u < -L / 4) u += L; while (u > L * 0.75) u -= L; return u; };
    for (let i = 0; i < p.n; i++) {
      const c = nearestOnPath(main, p.x[i], p.z[i], p.y[i]);
      ov.push(Math.abs(c.d) < c.hw - 0.5); m[i] = unwrap(c.s);
    }
    let iA = 0; while (iA < p.n - 1 && ov[iA + 1]) iA++;
    let iB = p.n - 1; while (iB > iA + 1 && ov[iB - 1]) iB--;
    for (let i = iA + 1; i < iB; i++) m[i] = m[iA] + (m[iB] - m[iA]) * ((i - iA) / (iB - iA));
    for (let i = 1; i < p.n; i++) m[i] = Math.max(m[i], m[i - 1]);
    p.map = m;
    paths.push(p);
  }
  const features = (def.features || []).map((f, id) => ({ ...f, id, s: f.at ? sAt(f.at) : (f.s || 0) * L }));
  const t = {
    def, main, paths, L, features,
    gaps: features.filter((f) => f.type === 'gap'),
    ramps: features.filter((f) => f.type === 'kicker' || f.type === 'hump'),
    loops: features.filter((f) => f.type === 'loop'),
    zones: features.filter((f) => f.type === 'boost' || f.type === 'ice'),
    offroad: def.offroad || 'floor'
  };
  t.obstacles = buildObstacles(t);
  t.props = placeProps(t);
  t.routes = buildRoutes(t);
  return t;
}

const inRange = (s, s0, len, L) => { const u = (((s - s0) % L) + L) % L; return u <= len ? u : -1; };

export function gapAt(track, s) {
  for (const g of track.gaps) if (inRange(s, g.s, g.len, track.L) >= 0) return g;
  return null;
}

export function rampHeight(track, s, d) {
  let h = 0;
  for (const r of track.ramps) {
    const u = inRange(s, r.s, r.len, track.L);
    if (u < 0) continue;
    if (r.w != null && Math.abs(d - (r.d || 0)) > r.w / 2) continue;
    const f = u / r.len;
    h += r.type === 'kicker' ? r.h * Math.pow(f, 1.35) : r.h * Math.sin(Math.PI * f);
  }
  return h;
}

export function zoneAt(track, s, d, type) {
  for (const z of track.zones) {
    if (z.type !== type) continue;
    if (inRange(s, z.s, z.len, track.L) < 0) continue;
    if (z.w != null && Math.abs(d - (z.d || 0)) > z.w / 2) continue;
    return z;
  }
  return null;
}

// Is (x, z, y) on any path other than `skip`?  Used for wall gaps at junctions.
export function insideOther(track, x, z, y, skip, margin = 0.2) {
  for (let pi = 0; pi < track.paths.length; pi++) {
    if (pi === skip) continue;
    const c = nearestOnPath(track.paths[pi], x, z, y);
    if (Math.abs(c.d) < c.hw - margin && Math.abs(c.y - y) < 3 && c.score < (c.hw + 4) ** 2 + 4) {
      const p = track.paths[pi];
      if (!p.closed && (c.s <= 0.01 || c.s >= p.len - 0.01)) continue;
      return true;
    }
  }
  return false;
}

export function queryTrack(track, x, z, y) {
  const cands = [];
  for (let pi = 0; pi < track.paths.length; pi++) {
    const c = nearestOnPath(track.paths[pi], x, z, y);
    c.pi = pi;
    const p = track.paths[pi];
    const endOpen = !p.closed && (c.s <= 0.01 || c.s >= p.len - 0.01);
    c.inside = !endOpen && Math.abs(c.d) <= c.hw + 0.25 && y > c.y - 2.5 && c.score < (c.hw + 3) ** 2 + 9;
    cands.push(c);
  }
  let best = null;
  for (const c of cands) {
    if (!c.inside) continue;
    if (!best || Math.abs(y - c.y) < Math.abs(y - best.y) - 0.5) best = c;
  }
  const main = cands[0];
  const inside = !!best;
  if (!best) best = main;
  return { ...best, inside, main, cands };
}

export function mainProgress(track, q) {
  if (q.inside && q.pi > 0) {
    const p = track.paths[q.pi];
    const u = Math.min(p.n - 1.001, Math.max(0, q.s / p.step)), i = Math.floor(u), f = u - i;
    const v = p.map[i] + (p.map[i + 1] - p.map[i]) * f;
    return ((p.a + v) % track.L + track.L) % track.L;
  }
  return q.main.s;
}

export function groundAt(track, q) {
  const m = q.main;
  // chasm under a gap
  const g = gapAt(track, m.s);
  const chasm = g && Math.abs(m.d) < m.hw + 14;
  let terrain = chasm ? -40 : 0;
  if (!q.inside) {
    // embankments slope down from raised roads, so cars can drive back up
    if (track.def.embank && !chasm) {
      for (const c of q.cands) {
        const ex = Math.abs(c.d) - c.hw;
        if (ex >= 0 && c.y > 0) terrain = Math.max(terrain, c.y - ex / 1.6);
      }
    }
    return { y: terrain, onPath: false, chasm };
  }
  if (q.pi === 0 && g) return { y: terrain, onPath: false, chasm };
  let y = q.y;
  if (q.pi === 0) y += rampHeight(track, q.s, q.d);
  return { y: Math.max(y, terrain), onPath: true, chasm };
}

// ------------------------------------------------------------------ obstacles & props

function buildObstacles(t) {
  const out = [];
  const L = t.L;
  const place = (o, s, d, extra = {}) => {
    const p = pathPoint(t.main, s);
    const y = p.y + rampHeight(t, s, d);
    out.push({ type: o.type, kind: o.kind || o.type, x: p.x + p.rx * d, z: p.z + p.rz * d, y, hx: p.x + p.rx * d, hz: p.z + p.rz * d, hy: y, h: Math.atan2(p.tx, p.tz), s, d, ...extra });
  };
  const sAt = (at) => nearestOnPath(t.main, at[0], at[1]).s;
  // shortcut-hosted obstacles: snap to whichever path is closest
  const placeAny = (o, at, d, extra) => {
    let bestPi = 0, best = null;
    t.paths.forEach((p, pi) => { const c = nearestOnPath(p, at[0], at[1]); if (!best || c.score < best.score) { best = c; bestPi = pi; } });
    const p = pathPoint(t.paths[bestPi], best.s);
    const y = p.y;
    out.push({ type: o.type, kind: o.kind || o.type, x: p.x + p.rx * d, z: p.z + p.rz * d, y, hx: p.x + p.rx * d, hz: p.z + p.rz * d, hy: y, h: Math.atan2(p.tx, p.tz), pi: bestPi, s: best.s, d, ...extra });
  };
  const KNOCK = { cone: 0.55, cones: 0.55, barrel: 0.85, barrels: 0.85, crate: 1.0, crates: 1.0 };
  for (const o of t.def.obstacles || []) {
    if (o.type === 'traffic') {
      const rng = mulberry32(99);
      for (let i = 0; i < o.count; i++) {
        const [d, dir] = o.lanes[i % o.lanes.length];
        const s = ((i + 0.5) / o.count) * L + rng() * 20;
        out.push({ type: 'traffic', kind: 'traffic', s, d, dir, v: o.speed * (0.85 + rng() * 0.3), vt: 0, x: 0, z: 0, y: 0, h: 0, r: 1.3, color: i });
        out[out.length - 1].vt = out[out.length - 1].v;
      }
    } else if (o.type === 'roller') {
      place(o, sAt(o.at), o.d || 0, { r: o.r || 2, amp: o.amp || 5, period: o.period || 3, phase: (out.length * 1.7) % TAU, d0: o.d || 0, kind: o.kind || 'ball', moving: true });
    } else if (o.type in KNOCK) {
      const n = o.n || 1, [d0, d1] = Array.isArray(o.d) ? o.d : [o.d || 0, o.d || 0];
      const s0 = sAt(o.at);
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0.5 : i / (n - 1);
        const kind = o.type.replace(/s$/, '');
        placeAny({ type: 'knock', kind }, [o.at[0], o.at[1]], d0 + (d1 - d0) * f, { r: KNOCK[o.type], knock: true, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, flying: false, downT: 0 });
        const last = out[out.length - 1];
        if (o.gap) {
          // spread along the path
          const p = pathPoint(t.paths[last.pi], last.s + (i - (n - 1) / 2) * o.gap);
          last.x = last.hx = p.x + p.rx * last.d; last.z = last.hz = p.z + p.rz * last.d;
        }
      }
      void s0;
    } else {
      // static: block, barrier, rock, snowman, pebble
      placeAny(o, o.at, o.d || 0, { r: o.r || 1.2, static: true });
    }
  }
  return out;
}

function placeProps(t) {
  const rng = mulberry32(hashStr(t.def.id));
  const props = [];
  const clear = (x, z, r) => {
    for (const p of t.paths) {
      for (let i = 0; i < p.n; i += 2) {
        const dx = x - p.x[i], dz = z - p.z[i], lim = p.w[i] / 2 + r;
        if (dx * dx + dz * dz < lim * lim) return false;
      }
    }
    for (const l of t.def.landmarks || []) {
      const lr = LANDMARK_R[l.kind] || 0;
      if (lr && Math.hypot(x - l.at[0], z - l.at[1]) < lr + r) return false;
    }
    return true;
  };
  for (const rule of t.def.decor || []) {
    let placed = 0, tries = 0;
    while (placed < rule.count && tries < rule.count * 40) {
      tries++;
      const s = rng() * t.L;
      const p = pathPoint(t.main, s);
      const side = rng() < 0.5 ? -1 : 1;
      const off = p.w / 2 + rule.near[0] + rng() * (rule.near[1] - rule.near[0]);
      const x = p.x + p.rx * off * side, z = p.z + p.rz * off * side;
      const sc = rule.scale[0] + rng() * (rule.scale[1] - rule.scale[0]);
      const r = (PROP_R[rule.kind] || 1) * sc;
      if (!clear(x, z, rule.near[0] > 2 ? r + 1 : 0.6)) continue;
      let ok = true;
      for (const q of props) if ((q.x - x) ** 2 + (q.z - z) ** 2 < (q.r + r) ** 2) { ok = false; break; }
      if (!ok) continue;
      props.push({ kind: rule.kind, x, z, r, scale: sc, rot: rule.align ? Math.atan2(p.tx, p.tz) + (side > 0 ? Math.PI : 0) : rng() * TAU, collide: !!rule.collide, side, seed: rng() });
      placed++;
    }
  }
  return props;
}

const PROP_R = { toyblock: 1.2, crayon: 0.6, book: 3, marble: 0.6, lamp: 0.3, building: 9, hydrant: 0.4, cactus: 0.9, mesa: 14, rock: 1.4, pine: 1.4, snowrock: 1.5, peak: 22, grass: 0.4, flower: 1.0, mushroom: 1.2, pebble: 0.8, cone: 0.6, flag: 0.3 };
const LANDMARK_R = { bed: 60, teddy: 22, tower: 22, billboard: 10, arch: 0, gasstation: 16, cabin: 12, lake: 40, stands: 40, trophy: 12, hose: 0, gnome: 10, flowerpot: 14, bookbridge: 0 };

function hashStr(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// ------------------------------------------------------------------ AI routes

function buildRoutes(t) {
  const routes = [];
  const fromMain = (i0, i1) => { const pts = []; for (let i = i0; i < i1; i++) pts.push(i); return pts; };
  const mk = (list) => {
    const pts = list.map(([p, i]) => ({ x: p.x[i], z: p.z[i], y: p.y[i], w: p.w[i], tx: p.tx[i], tz: p.tz[i], surface: p.surface }));
    computeRouteSpeeds(pts);
    return pts;
  };
  const M = t.main;
  routes.push(mk(fromMain(0, M.n).map((i) => [M, i])));
  t.paths.slice(1).forEach((p) => {
    const ia = Math.floor(p.a / M.step), ib = Math.ceil(p.b / M.step);
    if (ib <= ia) return;
    const list = fromMain(0, ia).map((i) => [M, i]);
    for (let i = 0; i < p.n; i++) list.push([p, i]);
    for (let i = ib + 1; i < M.n; i++) list.push([M, i]);
    const r = mk(list);
    r.shortcut = p.name;
    routes.push(r);
  });
  return routes;
}

function computeRouteSpeeds(pts) {
  const n = pts.length, K = 5, LAT = 30, DEC = 32;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - K + n) % n], b = pts[(i + K) % n];
    const ang = Math.abs(wrapAngle(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)));
    const dist = Math.max(1, Math.hypot(b.x - a.x, b.z - a.z));
    const k = ang / dist;
    let v = k > 1e-4 ? Math.sqrt(LAT / k) : 999;
    if (pts[i].surface === 'ice') v = Math.min(v * 0.62, 999);
    if (pts[i].surface === 'dirt') v *= 0.85;
    pts[i].v = Math.min(v, 999);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const nx = pts[(i + 1) % n], c = pts[i];
      const ds = Math.hypot(nx.x - c.x, nx.z - c.z);
      c.v = Math.min(c.v, Math.sqrt(nx.v * nx.v + 2 * DEC * ds));
    }
  }
}

// ------------------------------------------------------------------ cars

export function makeCar(spec, opts = {}) {
  return {
    spec, id: opts.id ?? 0, name: opts.name || spec.name, color: opts.color || spec.color,
    ai: opts.ai || null, x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0, h: 0,
    steer: 0, air: false, airT: 0, nitro: 0.35, nitroOn: false, boostT: 0, drift: 0, speed: 0,
    loop: null, q: null, lastS: 0, dist: 0, maxLap: 0, laps: [], lapStart: 0,
    finished: false, finishT: 0, place: 0, safeS: 0, safeD: 0, offT: 0, wrongT: 0, ghostT: 0,
    stuckT: 0, pitch: 0, roll: 0, spin: 0, wheelRot: 0, input: { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false },
    onShortcut: false, zoneBoost: -1, events: 0, hitT: 0, lastPi: 0
  };
}

export function placeOnTrack(track, car, s, d, speed = 0) {
  const p = pathPoint(track.main, s);
  car.x = p.x + p.rx * d; car.z = p.z + p.rz * d;
  car.y = p.y + rampHeight(track, ((s % track.L) + track.L) % track.L, d);
  car.h = Math.atan2(p.tx, p.tz);
  car.vx = p.tx * speed; car.vz = p.tz * speed; car.vy = 0; car.air = false; car.loop = null;
  car.q = queryTrack(track, car.x, car.z, car.y);
  car.lastS = mainProgress(track, car.q);
}

// one physics step for a car on the ground plane
export function stepCarPhysics(car, inp, surf, dt) {
  const sp = car.spec;
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  const rx = -fz, rz = fx;
  let vf = car.vx * fx + car.vz * fz;
  let vl = car.vx * rx + car.vz * rz;
  // smooth steering, faster return to centre
  const target = clamp(inp.steer, -1, 1);
  const rate = Math.abs(target) < Math.abs(car.steer) || Math.sign(target) !== Math.sign(car.steer) ? 9 : 5.5;
  car.steer += clamp(target - car.steer, -rate * dt, rate * dt);
  const nitroOn = inp.nitro && car.nitro > 0.01 && !car.air;
  car.nitroOn = nitroOn;
  const boosting = car.boostT > 0;
  const top = sp.top * surf.maxMul * (nitroOn ? 1.32 : 1) * (boosting ? 1.25 : 1);
  if (!car.air) {
    const thr = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    if (thr > 0 && vf >= -1) {
      if (vf < top) vf += sp.accel * thr * (1 - Math.max(0, vf) / top * 0.82) * dt * (surf.grip < 0.5 ? 0.7 : 1);
    }
    if (vf > top) vf -= Math.min(vf - top, (vf - top) * 1.4 * dt + 6 * dt);
    if (brk > 0) {
      if (vf > 0.5) vf -= 55 * brk * dt;
      else vf = Math.max(-sp.top * 0.3, vf - 16 * brk * dt);
    } else if (thr > 0 && vf < -0.5) {
      vf += 40 * dt; // braking out of reverse
    }
    if (thr === 0 && brk === 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), (4 + Math.abs(vf) * 0.04) * dt);
    if (inp.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 9 * dt);
    if (nitroOn) { vf += 26 * sp.nitroPower * dt; car.nitro = Math.max(0, car.nitro - dt / 3.2); }
    if (boosting) vf += 30 * dt;
    // yaw
    const av = Math.abs(vf);
    const sf = clamp(av / 10, 0, 1) * (1 - 0.38 * clamp(av / sp.top, 0, 1.3));
    const hb = inp.handbrake && av > 12;
    const yaw = -car.steer * sp.turn * sf * Math.sign(vf || 1) * (hb ? 1.55 : 1) * (surf.grip < 0.5 ? 0.85 : 1);
    car.h = wrapAngle(car.h + yaw * dt);
    // lateral grip (low grip = slides)
    const grip = sp.grip * surf.grip * (hb ? 0.16 : 1);
    vl *= Math.exp(-grip * dt);
    car.drift = Math.abs(vl);
    if (car.drift > 3.2 && av > 15) car.nitro = Math.min(1, car.nitro + dt * 0.22);
  } else {
    car.h = wrapAngle(car.h - car.steer * 0.6 * dt);
    car.drift = 0;
  }
  if (car.boostT > 0) car.boostT -= dt;
  car.vx = fx * vf + rx * vl;
  car.vz = fz * vf + rz * vl;
  car.speed = vf;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.wheelRot += vf * dt / 0.55;
}

function surfaceFor(track, car) {
  const q = car.q;
  if (!q || !q.inside) {
    const off = car.spec.offroad;
    return { grip: 0.6, maxMul: off, offroad: true };
  }
  let s = SURFACES[track.paths[q.pi].surface] || SURFACES.road;
  if (q.pi === 0 && zoneAt(track, q.s, q.d, 'ice')) s = SURFACES.ice;
  if (s.dirt && car.spec.offroad > 0.7) s = { ...s, maxMul: 1 };
  return s;
}

// ------------------------------------------------------------------ world

export function createWorld(track, { mode = 'race', laps = 3 } = {}) {
  return { track, mode, laps, cars: [], t: 0, raceT: 0, phase: 'countdown', countdown: 3.5, events: [], obstacles: track.obstacles.map((o) => ({ ...o })), finishOrder: [] };
}

export function gridSlot(k) {
  const row = Math.floor(k / 2);
  return { s: -9 - row * 8, d: (k % 2 ? 3.6 : -3.6) };
}

function emit(w, type, car, extra) { w.events.push({ type, car, ...extra }); }

export function stepWorld(w, dt) {
  w.t += dt;
  if (w.phase === 'countdown') {
    const before = Math.ceil(w.countdown);
    w.countdown -= dt;
    const now = Math.ceil(w.countdown);
    if (now !== before && now >= 1 && now <= 3) emit(w, 'count', null, { n: now });
    if (w.countdown <= 0) { w.phase = 'race'; w.raceT = 0; emit(w, 'go', null); }
  } else {
    w.raceT += dt;
  }
  const racing = w.phase !== 'countdown';
  stepObstacles(w, dt);
  for (const car of w.cars) {
    let inp;
    if (!racing) { car.vx = car.vz = 0; car.speed = 0; continue; }
    else if (car.ai || car.finished) inp = aiControl(w, car, dt);
    else inp = car.input;
    stepCar(w, car, inp, dt);
  }
  collideCars(w);
  rank(w);
}

function stepCar(w, car, inp, dt) {
  const T = w.track;
  if (car.ghostT > 0) car.ghostT -= dt;
  if (car.hitT > 0) car.hitT -= dt;
  if (car.loop) { stepLoop(w, car, dt); return; }
  const surf = surfaceFor(T, car);
  const prevS = car.q ? car.q.main.s : 0;
  const prevPi = car.q ? (car.q.inside ? car.q.pi : -1) : 0;
  stepCarPhysics(car, inp, surf, dt);
  let q = queryTrack(T, car.x, car.z, car.y);
  const gr = groundAt(T, q);
  // vertical
  if (!car.air) {
    const pred = car.y + car.vy * dt - 0.5 * G * dt * dt;
    if (gr.y < pred - 0.08) { car.air = true; car.y = pred; car.vy -= G * dt; car.airT = 0; }
    else {
      const dy = gr.y - car.y;
      if (Math.abs(dy) > 0.3) { car.vy = Math.min(car.vy, 0); car.y = gr.y; }
      else { car.vy = clamp(dy / dt, -40, 30); car.y = gr.y; }
    }
  } else {
    car.vy -= G * dt; car.y += car.vy * dt; car.airT += dt;
    if (car.y <= gr.y && car.y > gr.y - 3) {
      const impact = -car.vy;
      car.y = gr.y; car.vy = 0; car.air = false;
      if (car.airT > 0.55) { emit(w, 'bigair', car, { t: car.airT }); car.nitro = Math.min(1, car.nitro + car.airT * 0.25); }
      if (impact > 10) { emit(w, 'land', car, { impact }); const k = impact > 18 ? 0.9 : 0.97; car.vx *= k; car.vz *= k; }
      car.airT = 0;
    } else if (car.y < gr.y - 3) {
      // fell below a surface we can no longer reach (e.g. dropped off a bridge)
      car.y = Math.min(car.y, gr.y - 3);
    }
  }
  // walls
  if (q.pi === q.main.pi || true) wallCollide(w, car, q, dt);
  q = car.q = queryTrack(T, car.x, car.z, car.y);
  // loops
  if (!car.air && q.inside && q.pi === 0 && car.speed > 4) {
    for (const lp of T.loops) {
      const u0 = inRange(prevS, lp.s - 6, 6, T.L), u1 = inRange(q.s, lp.s, 6, T.L);
      if (u0 >= 0 && u1 >= 0) { startLoop(w, car, lp, q); return; }
    }
  }
  // zones
  if (!car.air && q.inside && q.pi === 0) {
    const b = zoneAt(T, q.s, q.d, 'boost');
    if (b && car.zoneBoost !== b.id) { car.boostT = 1.1; car.nitro = Math.min(1, car.nitro + 0.18); emit(w, 'boost', car); }
    car.zoneBoost = b ? b.id : -1;
  }
  // shortcut entry
  const pi = q.inside ? q.pi : -1;
  if (pi > 0 && prevPi === 0) { emit(w, 'shortcut', car, { name: T.paths[pi].name }); car.onShortcut = true; }
  if (pi === 0) car.onShortcut = false;
  // progress
  const ms = mainProgress(T, q);
  let delta = ms - car.lastS;
  if (delta > T.L / 2) delta -= T.L; else if (delta < -T.L / 2) delta += T.L;
  if (Math.abs(delta) < 40) car.dist += delta;
  car.lastS = ms;
  if (w.phase === 'race' && !car.finished) {
    const lapIdx = Math.floor(car.dist / T.L);
    if (lapIdx > car.maxLap) {
      car.maxLap = lapIdx;
      const lt = w.raceT - car.lapStart;
      car.laps.push(lt); car.lapStart = w.raceT;
      emit(w, 'lap', car, { lap: lapIdx, time: lt });
      if (lapIdx >= w.laps) { car.finished = true; car.finishT = w.raceT; w.finishOrder.push(car); emit(w, 'finish', car, { place: w.finishOrder.length, time: w.raceT }); }
    }
  }
  // safe respawn point
  if (!car.air && q.inside && q.pi === 0 && !gapAt(T, q.s) && rampHeight(T, q.s, q.d) === 0) { car.safeS = q.s; car.safeD = q.d; }
  // wrong way
  const along = car.vx * q.tx + car.vz * q.tz;
  const facing = Math.sin(car.h) * q.tx + Math.cos(car.h) * q.tz;
  if (q.pi === 0 && facing < -0.4 && along < -3) car.wrongT += dt; else car.wrongT = Math.max(0, car.wrongT - dt * 2);
  // respawn rules
  const excess = Math.abs(q.main.d) - q.main.hw;
  if (!q.inside && excess > 22) car.offT += dt; else car.offT = Math.max(0, car.offT - dt);
  const fell = car.y < -6 || (!q.inside && car.y < q.main.y - 6) || (gapAt(T, q.main.s) && Math.abs(q.main.d) < q.main.hw + 14 && car.y < q.main.y - 5);
  if (fell || car.offT > 2.5) respawn(w, car, fell ? 'fall' : 'off');
}

function wallCollide(w, car, q) {
  const T = w.track;
  if (!q.inside) {
    // outside every path: walls of the nearest path stop us (unless at a gap or none)
    const c = q.main;
    const near = q.cands.reduce((a, b) => (Math.abs(b.d) - b.hw < Math.abs(a.d) - a.hw && Math.abs(car.y - b.y) < 4 ? b : a), c);
    const p = T.paths[near.pi];
    if (!p.walls || Math.abs(car.y - near.y) > 3.5 || car.air && car.y > near.y + 2.5) return;
    if (near.pi === 0 && gapAt(T, near.s)) return;
    if (!p.closed && (near.s <= 0.5 || near.s >= p.len - 0.5)) return;
    if (Math.abs(near.d) - near.hw > 6) return;
    pushIn(w, car, near, near.hw - CAR_R * 0.9);
    return;
  }
  const p = T.paths[q.pi];
  if (!p.walls) return;
  if (q.pi === 0 && gapAt(T, q.s)) return;
  const lim = q.hw - CAR_R * 0.9;
  if (Math.abs(q.d) <= lim) return;
  // an overlapping path (junction) means there is no wall here
  for (const c of q.cands) if (c.pi !== q.pi && Math.abs(c.d) < c.hw - 0.5 && Math.abs(c.y - q.y) < 2.5 && c.score < (c.hw + 3) ** 2) return;
  pushIn(w, car, q, lim);
}

function pushIn(w, car, c, lim) {
  const sgn = Math.sign(c.d) || 1;
  const over = Math.abs(c.d) - lim;
  if (over <= 0) return;
  car.x -= c.rx * sgn * over; car.z -= c.rz * sgn * over;
  const vout = (car.vx * c.rx + car.vz * c.rz) * sgn;
  if (vout > 0) {
    car.vx -= c.rx * sgn * vout * 1.35; car.vz -= c.rz * sgn * vout * 1.35;
    if (vout > 7 && car.hitT <= 0) { emit(w, 'wall', car, { v: vout }); car.hitT = 0.25; }
  }
  // scrape
  const k = 1 - Math.min(0.03, 0.002 + vout * 0.0015);
  car.vx *= k; car.vz *= k;
  // nudge heading toward the wall tangent so the car slides along
  const along = Math.atan2(c.tx, c.tz), fwd = car.speed >= 0 ? along : wrapAngle(along + Math.PI);
  const diff = wrapAngle(fwd - car.h);
  if (Math.abs(diff) < 1.2) car.h = wrapAngle(car.h + diff * 0.08);
}

function startLoop(w, car, lp, q) {
  const p = pathPoint(w.track.main, lp.s);
  const v = Math.max(car.speed, 42);
  car.loop = { th: 0, R: lp.r, v, bx: p.x + p.rx * q.d, bz: p.z + p.rz * q.d, by: p.y, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz, d: q.d, shift: 0, s: lp.s };
  car.air = false; car.vy = 0;
  emit(w, 'loop', car);
}

function stepLoop(w, car, dt) {
  const L = car.loop;
  L.th += (L.v / L.R) * dt;
  L.v = Math.max(30, L.v - G * 0.25 * Math.sin(L.th) * dt);
  const th = Math.min(L.th, TAU);
  const fw = L.R * Math.sin(th), up = L.R * (1 - Math.cos(th)), side = L.shift * (th / TAU);
  car.x = L.bx + L.tx * fw + L.rx * side;
  car.z = L.bz + L.tz * fw + L.rz * side;
  car.y = L.by + up;
  car.wheelRot += L.v * dt / 0.55;
  car.speed = L.v;
  if (L.th >= TAU) {
    car.loop = null;
    car.x = L.bx + L.tx * 1.5 + L.rx * L.shift; car.z = L.bz + L.tz * 1.5 + L.rz * L.shift; car.y = L.by;
    car.h = Math.atan2(L.tx, L.tz);
    car.vx = L.tx * L.v; car.vz = L.tz * L.v; car.vy = 0;
    car.q = queryTrack(w.track, car.x, car.z, car.y);
    car.lastS = mainProgress(w.track, car.q);
    car.nitro = Math.min(1, car.nitro + 0.15);
    emit(w, 'loopdone', car);
  }
}

export function respawn(w, car, why = 'reset') {
  const T = w.track;
  let s = car.safeS;
  // fell into a gap: put the car across it
  for (const g of T.gaps) {
    const u = inRange(car.q ? car.q.main.s : s, g.s - 40, g.len + 46, T.L);
    if (u >= 0) { s = g.s + g.len + 10; break; }
  }
  const d = clamp(car.safeD, -T.main.w[0] / 2 + 3, T.main.w[0] / 2 - 3);
  placeOnTrack(T, car, s, d, Math.min(car.spec.top * 0.45, 26));
  // keep lap progress continuous
  car.offT = 0; car.ghostT = 1.6; car.boostT = 0; car.wrongT = 0; car.stuckT = 0;
  if (car.ai) car.ai.ri = -1;
  emit(w, 'respawn', car, { why });
}

function collideCars(w) {
  const cs = w.cars;
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    if (a.loop || a.ghostT > 0) continue;
    for (let j = i + 1; j < cs.length; j++) {
      const b = cs[j];
      if (b.loop || b.ghostT > 0 || Math.abs(a.y - b.y) > 1.8) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, R = CAR_R * 2;
      if (d2 >= R * R || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, over = (R - d) / 2;
      a.x -= nx * over; a.z -= nz * over; b.x += nx * over; b.z += nz * over;
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const imp = -rv * 0.75;
        a.vx -= nx * imp; a.vz -= nz * imp; b.vx += nx * imp; b.vz += nz * imp;
        if (-rv > 6) emit(w, 'bump', a.ai ? b : a, { v: -rv });
      }
    }
  }
  // obstacles
  for (const car of cs) {
    if (car.loop || car.ghostT > 0) continue;
    for (const o of w.obstacles) {
      if (o.flying || o.down) continue;
      if (Math.abs(car.y - o.y) > 3) continue;
      if (o.type === 'traffic') {
        const fx = Math.sin(o.h), fz = Math.cos(o.h);
        for (const k of [-1.3, 1.3]) circleHit(w, car, { x: o.x + fx * k, z: o.z + fz * k, r: o.r, vx: fx * o.vCur * o.dir, vz: fz * o.vCur * o.dir, solid: true }, o);
      } else if (o.knock) {
        const dx = car.x - o.x, dz = car.z - o.z, R = CAR_R + o.r;
        if (dx * dx + dz * dz < R * R) {
          o.flying = true;
          const sp = Math.hypot(car.vx, car.vz);
          o.vx = car.vx * 1.15 + (Math.random() - 0.5) * 6; o.vz = car.vz * 1.15 + (Math.random() - 0.5) * 6; o.vy = 5 + sp * 0.18;
          o.spinX = (Math.random() - 0.5) * 14; o.spinZ = (Math.random() - 0.5) * 14;
          const k = o.kind === 'cone' ? 0.97 : 0.9; car.vx *= k; car.vz *= k;
          emit(w, 'knock', car, { kind: o.kind });
        }
      } else {
        circleHit(w, car, o, o);
      }
    }
    for (const p of w.track.props) {
      if (!p.collide) continue;
      const dx = car.x - p.x, dz = car.z - p.z, R = CAR_R + p.r;
      if (dx * dx + dz * dz < R * R && car.y < 6) circleHit(w, car, { x: p.x, z: p.z, r: p.r }, p);
    }
  }
}

function circleHit(w, car, c, src) {
  const dx = car.x - c.x, dz = car.z - c.z, R = CAR_R + c.r, d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return;
  const d = Math.sqrt(d2) || 0.01, nx = dx / d, nz = dz / d;
  car.x += nx * (R - d); car.z += nz * (R - d);
  const ovx = c.vx || 0, ovz = c.vz || 0;
  const rv = (car.vx - ovx) * nx + (car.vz - ovz) * nz;
  if (rv < 0) {
    car.vx -= nx * rv * 1.45; car.vz -= nz * rv * 1.45;
    car.vx *= 0.9; car.vz *= 0.9;
    if (-rv > 5 && car.hitT <= 0) { emit(w, 'hit', car, { v: -rv, kind: src.kind }); car.hitT = 0.3; }
  }
}

function stepObstacles(w, dt) {
  const T = w.track;
  for (const o of w.obstacles) {
    if (o.type === 'traffic') {
      // slow down behind cars in the same lane
      let blocked = false;
      const fx = Math.sin(o.h), fz = Math.cos(o.h);
      for (const c of w.cars) {
        const dx = c.x - o.x, dz = c.z - o.z, ahead = (dx * fx + dz * fz) * o.dir;
        const side = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && ahead < 9 && side < 2.6) { blocked = true; break; }
      }
      o.vCur = o.vCur == null ? o.v : o.vCur;
      o.vCur += ((blocked ? 0 : o.v) - o.vCur) * Math.min(1, dt * (blocked ? 6 : 1.2));
      o.s = (((o.s + o.vCur * o.dir * dt) % T.L) + T.L) % T.L;
      const p = pathPoint(T.main, o.s);
      o.x = p.x + p.rx * o.d; o.z = p.z + p.rz * o.d; o.y = p.y + rampHeight(T, o.s, o.d);
      o.h = Math.atan2(p.tx * o.dir, p.tz * o.dir);
      o.wheel = (o.wheel || 0) + o.vCur * dt / 0.5;
    } else if (o.moving) {
      const p = pathPoint(T.main, o.s);
      const ph = (w.t / o.period) * TAU + o.phase;
      const d = o.d0 + Math.sin(ph) * o.amp;
      const nx = p.x + p.rx * d, nz = p.z + p.rz * d;
      o.vx = (nx - o.x) / dt; o.vz = (nz - o.z) / dt;
      if (!isFinite(o.vx) || Math.abs(o.vx) > 100) { o.vx = 0; o.vz = 0; }
      o.x = nx; o.z = nz; o.y = p.y;
      o.roll = (o.roll || 0) + Math.cos(ph) * o.amp * TAU / o.period * dt / o.r;
    } else if (o.knock && o.flying) {
      o.vy -= G * dt;
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      o.rx += o.spinX * dt; o.rz += o.spinZ * dt;
      if (o.y < o.hy) {
        o.y = o.hy; o.vy *= -0.3; o.vx *= 0.6; o.vz *= 0.6; o.spinX *= 0.5; o.spinZ *= 0.5;
        if (Math.abs(o.vy) < 1.5) { o.flying = false; o.down = true; o.downT = 3.5; }
      }
    } else if (o.knock && o.down) {
      o.downT -= dt;
      if (o.downT <= 0) {
        // respawn at home when nobody is close
        const busy = w.cars.some((c) => (c.x - o.hx) ** 2 + (c.z - o.hz) ** 2 < 100);
        if (!busy) { o.down = false; o.x = o.hx; o.y = o.hy; o.z = o.hz; o.rx = 0; o.rz = 0; o.vx = o.vy = o.vz = 0; }
      }
    }
  }
}

function rank(w) {
  const order = w.cars.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishT - b.finishT;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.dist - a.dist;
  });
  order.forEach((c, i) => { c.place = i + 1; });
  w.order = order;
}

// ------------------------------------------------------------------ AI

export const DIFFICULTY = {
  easy: { skill: 0.84, spread: 0.06, shortcut: 0.25, nitro: 0.4 },
  normal: { skill: 0.93, spread: 0.05, shortcut: 0.5, nitro: 0.7 },
  hard: { skill: 1.0, spread: 0.035, shortcut: 0.75, nitro: 1 }
};

export function makeAI(rng, diff, k) {
  const D = DIFFICULTY[diff] || DIFFICULTY.normal;
  return { skill: D.skill + (rng() - 0.5) * 2 * D.spread + (k % 3) * 0.008, lane: (rng() - 0.5) * 6, laneT: rng() * 10, avoid: 0, ri: -1, route: 0, shortcutP: D.shortcut, nitroP: D.nitro, rng, routeLap: -99, rubber: true };
}

function findRouteIndex(route, car, from = -1) {
  const n = route.length;
  let best = 0, bs = Infinity;
  if (from >= 0) {
    for (let k = -6; k < 40; k++) {
      const i = (from + k + n) % n, p = route[i];
      const d = (car.x - p.x) ** 2 + (car.z - p.z) ** 2 + Math.max(0, Math.abs(car.y - p.y) - 2) ** 2 * 9;
      if (d < bs) { bs = d; best = i; }
    }
    if (bs < 30 * 30) return best;
  }
  for (let i = 0; i < n; i++) {
    const p = route[i];
    const d = (car.x - p.x) ** 2 + (car.z - p.z) ** 2 + Math.max(0, Math.abs(car.y - p.y) - 2) ** 2 * 9;
    if (d < bs) { bs = d; best = i; }
  }
  return best;
}

export function aiControl(w, car, dt) {
  const T = w.track;
  if (!car.ai) car.ai = makeAI(mulberry32(car.id * 7 + 3), 'normal', car.id);
  const ai = car.ai;
  // choose a route each lap (only switch near the start line, before any shortcut)
  const lapNow = car.maxLap;
  if (ai.routeLap !== lapNow) {
    ai.routeLap = lapNow;
    const prev = ai.route;
    ai.route = T.routes.length > 1 && ai.rng() < ai.shortcutP ? 1 + Math.floor(ai.rng() * (T.routes.length - 1)) : 0;
    if (ai.route !== prev) ai.ri = -1;
  }
  const route = T.routes[ai.route];
  const n = route.length;
  ai.ri = findRouteIndex(route, car, ai.ri);
  const sp = Math.max(0, car.speed);
  const la = Math.max(3, Math.round((7 + sp * 0.33) / STEP));
  const tp = route[(ai.ri + la) % n];
  // lane wander
  ai.laneT += dt;
  const hw = tp.w / 2 - 1.5, lhw = Math.max(0, tp.w / 2 - 3);
  let lane = clamp(ai.lane + Math.sin(ai.laneT * 0.35 + car.id) * 1.5, -lhw, lhw);
  // avoidance: obstacles and cars ahead
  const fx = Math.sin(car.h), fz = Math.cos(car.h), rx = -fz, rz = fx;
  const cp = route[ai.ri];
  const crx = -cp.tz, crz = cp.tx;
  let want = 0;
  const consider = (ox, oz, oy, r, mv, o) => {
    const dx = ox - car.x, dz = oz - car.z;
    const ahead = dx * fx + dz * fz;
    if (ahead < 1 || ahead > 26 + sp * 0.3 || Math.abs(oy - car.y) > 3) return;
    let lat = (ox - cp.x) * crx + (oz - cp.z) * crz;
    if (o && o.moving) {
      // where will the sweeper be when we get there?
      const tA = ahead / Math.max(8, sp);
      const ph = ((w.t + tA) / o.period) * TAU + o.phase, ph0 = (w.t / o.period) * TAU + o.phase;
      lat += (Math.sin(ph) - Math.sin(ph0)) * o.amp;
    }
    const mine = lane + ai.avoid;
    const need = r + CAR_R + 1.1 + (mv ? 0.8 : 0);
    if (Math.abs(lat - mine) < need) {
      const left = lat - need, right = lat + need;
      const okL = left > -hw, okR = right < hw;
      if (!okL && !okR) return; // no room: just go through it
      const target = okL && (!okR || Math.abs(left - mine) < Math.abs(right - mine)) ? left : right;
      const push = target - lane;
      if (Math.abs(push) > Math.abs(want)) want = push;
    }
    void rx; void rz;
  };
  for (const o of w.obstacles) {
    if (o.flying || o.down) continue;
    if (o.knock && o.kind === 'cone') continue; // cones are fine to clip
    consider(o.x, o.z, o.y, o.r + (o.type === 'traffic' ? 1.3 : 0), o.type === 'traffic', o);
  }
  for (const c of w.cars) if (c !== car && c.speed < car.speed - 2) consider(c.x, c.z, c.y, CAR_R, false);
  ai.avoid += (want - ai.avoid) * Math.min(1, dt * (want ? 5 : 1.5));
  const off = clamp(lane + ai.avoid, -hw, hw);
  const px = tp.x - tp.tz * off, pz = tp.z + tp.tx * off;
  const desired = Math.atan2(px - car.x, pz - car.z);
  const diff = wrapAngle(desired - car.h);
  let steer = clamp(-diff * 2.6, -1, 1);
  // target speed
  let vt = 999;
  for (let k = 0; k < la * 2 + 6; k++) vt = Math.min(vt, route[(ai.ri + k) % n].v);
  let mul = ai.skill;
  if (ai.rubber && w.mode === 'race') {
    const player = w.cars.find((c) => !c.ai);
    if (player && !car.finished) {
      const gap = player.dist - car.dist;
      mul *= 1 + clamp(gap / 400, -0.06, 0.07);
    }
  }
  if (car.finished) mul *= 0.8;
  const topNow = car.spec.top * mul * (car.q && !car.q.inside ? car.spec.offroad : 1);
  vt = Math.min(vt * (0.94 + (mul - 0.9) * 0.6), topNow);
  const inp = { steer, throttle: 0, brake: 0, handbrake: false, nitro: false };
  if (car.speed < vt) inp.throttle = 1;
  else if (car.speed > vt + 4) inp.brake = clamp((car.speed - vt) / 10, 0.3, 1);
  if (Math.abs(diff) > 0.75 && car.speed > 24) inp.handbrake = true;
  if (Math.abs(diff) > 1.6) { inp.throttle = 0.6; }
  // nitro on long fast stretches
  let straight = 999;
  for (let k = 0; k < 40; k++) straight = Math.min(straight, route[(ai.ri + k) % n].v);
  if (straight > car.spec.top * 1.05 && car.nitro > 0.25 && ai.rng() < ai.nitroP * 0.5 && !car.finished) ai.nitroHold = 1.4;
  if (ai.nitroHold > 0) { ai.nitroHold -= dt; inp.nitro = true; }
  // stuck: no forward progress -> reverse out, then respawn
  if (ai.chkT == null) { ai.chkT = 0; ai.chkDist = car.dist; ai.revT = 0; ai.noProg = 0; }
  ai.chkT += dt;
  if (ai.chkT > 1.2) {
    const moved = car.dist - ai.chkDist;
    ai.chkT = 0; ai.chkDist = car.dist;
    if (moved < 4 && !car.loop && w.phase === 'race') {
      ai.noProg += 1.2;
      // only back up when actually pinned (slow and pointing the wrong way or blocked)
      if (ai.revT <= 0 && Math.abs(car.speed) < 4 && ai.noProg >= 2.4) ai.revT = 0.8;
    } else ai.noProg = 0;
  }
  if (ai.revT > 0) { ai.revT -= dt; inp.throttle = 0; inp.brake = 1; inp.nitro = false; inp.handbrake = false; inp.steer = Math.sign(diff || 1); }
  if (ai.noProg > 5 || car.wrongT > 2.5) { ai.noProg = 0; ai.revT = 0; respawn(w, car, 'stuck'); }
  return inp;
}

// ------------------------------------------------------------------ setup helpers

export function setupRace(track, { playerSpec, opponents = [], mode = 'race', difficulty = 'normal', laps, seed = 1 } = {}) {
  const w = createWorld(track, { mode, laps: laps || track.def.laps || 3 });
  const rng = mulberry32(seed);
  const total = opponents.length + 1;
  const playerSlot = mode === 'race' ? Math.min(total - 1, Math.max(0, total - 2)) : 0;
  let k = 0;
  const all = [];
  for (let i = 0; i < total; i++) {
    const isPlayer = i === playerSlot;
    const o = isPlayer ? null : opponents[k++];
    const car = makeCar(isPlayer ? playerSpec : o.spec, isPlayer ? { id: i, name: 'You' } : { id: i, name: o.name, color: o.color, ai: makeAI(mulberry32(seed * 31 + i * 17), difficulty, i) });
    const slot = mode === 'race' ? gridSlot(i) : { s: -6, d: 0 };
    placeOnTrack(track, car, ((slot.s % track.L) + track.L) % track.L, slot.d, 0);
    car.dist = slot.s; car.safeS = ((slot.s % track.L) + track.L) % track.L; car.safeD = slot.d;
    all.push(car);
  }
  void rng;
  w.cars = all;
  w.player = all[playerSlot];
  return w;
}
