// Commute City — pure traffic simulation. No Three.js here, so it runs headless in tests.
//
// The map is a grid of tiles. Roads, motorways, tram tracks and railways are links between
// neighbouring tiles on one of three levels: tunnel (-1), ground (0) and flyover (+1). A link
// between two levels is a ramp. Every link has one lane per direction (motorways have two).
// Vehicles queue along lanes; at junctions they cross a "box" movement once the junction grants
// it (priority rules, traffic lights, roundabouts or level crossings).

export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E, S, W, N (tile y grows south)
export const opp = (d) => (d + 2) & 3;
export const LEVEL_H = [-0.62, 0, 0.62]; // height of each level (index = level + 1)
export const TER = { GRASS: 0, WATER: 1, MOUNTAIN: 2 };
export const DAY = 120; // game seconds per day
export const MIN_GAP = 0.05;
export const RING_R = 0.25;
export const PIN_CAP = 9;
export const OVER_T = 50;
export const TRIP_PAY = 8;
export const TRANSIT_PAY = 9;

const ACCEL = 1.5, DECEL = 4.5;
const C_BLEND = 0.5;  // corner curves span the last/first half tile of the two lanes
const TURN_F = 0.58;  // speed factor while turning
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const KIND = {
  road: { car: 1, tram: 0, rail: 0, lanes: 1, speed: 1.15, off: [0.105], half: 0.21, cost: 10, label: 'Road' },
  motorway: { car: 1, tram: 0, rail: 0, lanes: 2, speed: 2.3, off: [0.23, 0.08], half: 0.31, cost: 40, label: 'Motorway' },
  tram: { car: 0, tram: 1, rail: 0, lanes: 1, speed: 1.0, off: [0.105], half: 0.2, cost: 25, label: 'Tram track' },
  rail: { car: 0, tram: 0, rail: 1, lanes: 1, speed: 2.1, off: [0.13], half: 0.25, cost: 30, label: 'Railway' },
};
export const VEH = {
  car: { len: 0.24, w: 0.13 },
  tram: { len: 0.72, w: 0.15, max: 1.0, cap: 24 },
  train: { len: 2.3, w: 0.18, cars: 4, cap: 60 },
};
export const COST = { lights: 60, round: 90, stop: 60, station: 150, tramVeh: 200, trainVeh: 450, interchange: 80 };
export const MULT = { water: 3, elevated: 3, tunnel: 4 };
export const DISTRICTS = [
  { name: 'Red', hex: '#ef5b4c', place: 'Diner', icon: '🍔' },
  { name: 'Blue', hex: '#3b8ff0', place: 'Offices', icon: '💼' },
  { name: 'Yellow', hex: '#f6c132', place: 'Market', icon: '🛒' },
  { name: 'Green', hex: '#3fbf6a', place: 'School', icon: '🎒' },
  { name: 'Purple', hex: '#a06ae0', place: 'Mall', icon: '🛍️' },
  { name: 'Teal', hex: '#22c3c0', place: 'Hospital', icon: '🏥' },
];
export const LINE_COLORS = ['#ff6b3d', '#2bb3ff', '#9b5cff', '#21c07a', '#ff4f9a', '#f2b800'];
const COLOR_DAYS = [0, 0, 1.5, 3, 5, 7.5];
const EXPAND_DAYS = [1, 2, 3.5, 5, 7, 9];

// ------------------------------------------------------------------ rng
export function makeRng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.get = () => a;
  f.set = (v) => { a = v >>> 0; };
  return f;
}

// ------------------------------------------------------------------ state
export function createState(o) {
  const W = o.W, H = o.H, WH = W * H;
  const S = {
    W, H, WH,
    mode: o.mode || 'city',
    mapId: o.mapId || null,
    terrain: o.terrain || new Uint8Array(WH),
    trees: o.trees || new Uint8Array(WH),
    bounds: o.bounds || { x0: 0, y0: 0, x1: W - 1, y1: H - 1 },
    bld: new Int32Array(WH).fill(-1),
    nodes: new Array(3 * WH).fill(null),
    links: new Map(), nextLink: 1,
    edgeOcc: new Uint8Array(WH * 2),
    houses: [], dests: [], bmap: new Map(), nextBld: 1,
    stops: new Map(), lines: [], nextLine: 1,
    vehicles: [], nextVeh: 1,
    lanes: new Map(), boxes: new Map(), junctions: [],
    rng: makeRng(o.seed || 1),
    seed: o.seed || 1,
    tick: 0,
    time: o.time ?? DAY * 0.25,
    t0: o.time ?? DAY * 0.25,
    money: o.money ?? 1500,
    income: o.income !== false,
    trips: 0,
    sandbox: !!o.sandbox,
    grow: o.grow !== false,
    fail: o.fail !== false,
    reckless: false,
    colors: [], colorOrder: [0, 1, 2, 3, 4, 5],
    timers: { house: 4, dest: 70, exp: 0, dispatch: 0, day: 0 },
    netV: 0, bldV: 0, boundsV: 0, lineV: 0,
    events: [],
    gameOver: null,
    transitDirty: true,
    netValue: 0,
    tools: null,
  };
  S._g = new Float64Array(3 * WH);
  S._st = new Uint32Array(3 * WH);
  S._pv = new Int32Array(3 * WH);
  S._gen = 0;
  return S;
}

// ------------------------------------------------------------------ keys & helpers
export const nkey = (S, x, y, lvl = 0) => (lvl + 1) * S.WH + y * S.W + x;
export function keyInfo(S, k) {
  const t = k % S.WH;
  return { x: t % S.W, y: (t - (t % S.W)) / S.W, lvl: (k - t) / S.WH - 1, t };
}
function mkNode(S, k) {
  const i = keyInfo(S, k);
  return {
    key: k, x: i.x, y: i.y, lvl: i.lvl, t: i.t, h: LEVEL_H[i.lvl + 1],
    dirs: [-1, -1, -1, -1], ctrl: 'none', bld: -1, term: false, portal: false, stop: null,
    j: false, cross: false, R: 0, deg: 0, lights: null, sig: null, tok: null,
    occ: [], req: [], app: [], moves: [], conf: null, inL: [], outL: [], trainT: -10, barrier: 0,
  };
}
const ensureNode = (S, k) => S.nodes[k] || (S.nodes[k] = mkNode(S, k));
function pruneNode(S, k) {
  const n = S.nodes[k];
  if (n && n.dirs[0] < 0 && n.dirs[1] < 0 && n.dirs[2] < 0 && n.dirs[3] < 0 && !n.term && !n.stop) S.nodes[k] = null;
}
export const otherEnd = (L, k) => (L.a === k ? L.b : L.a);
export function dirBetween(ax, ay, bx, by) {
  if (by === ay) { if (bx === ax + 1) return 0; if (bx === ax - 1) return 2; }
  if (bx === ax) { if (by === ay + 1) return 1; if (by === ay - 1) return 3; }
  return -1;
}
function edgeIdx(S, t, d) {
  if (d === 0) return t * 2;
  if (d === 1) return t * 2 + 1;
  if (d === 2) return (t - 1) * 2;
  return (t - S.W) * 2 + 1;
}
const slotBits = (la, lb) => (1 << (la + 1)) | (1 << (lb + 1));
function setCaps(L) {
  const K = KIND[L.kind];
  L.car = !!K.car;
  L.trm = L.kind === 'tram' || (L.kind === 'road' && !!L.tram);
  L.rl = !!K.rail;
}
export const inMap = (S, x, y) => x >= 0 && y >= 0 && x < S.W && y < S.H;
export function unlocked(S, x, y) {
  const b = S.bounds;
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}
export function linkTo(S, N, M) {
  for (let d = 0; d < 4; d++) {
    const id = N.dirs[d];
    if (id < 0) continue;
    const L = S.links.get(id);
    if (otherEnd(L, N.key) === M) return L;
  }
  return null;
}
const canUse = (L, mode) => (mode === 'car' ? L.car : mode === 'tram' ? L.trm : L.rl);
export function hourOf(S) { return ((S.time % DAY) / DAY) * 24; }
export function dayOf(S) { return Math.floor(S.time / DAY); }
function ev(S, e) { if (S.events.length < 200) S.events.push(e); }

// ------------------------------------------------------------------ buildings
function mkCar(S, home) {
  return {
    id: S.nextVeh++, kind: 'car', len: VEH.car.len, w: VEH.car.w, color: home ? home.color : 0, home,
    state: 'home', dest: null, seg: null, s: 0, v: 0, odo: 0, path: null, pi: 0, ahead: [], hist: [], prev: null,
    grant: null, grantBox: null, grantRec: null, occs: [], wait: 0, reqT: -1, reqTick: -1,
    epoch: 0, active: false, lost: false, park: 0, crashed: 0, served: -1, dwell: 0, tries: 0, rerouteT: 0,
  };
}
export function tileFree(S, x, y, needUnlocked = true) {
  if (!inMap(S, x, y)) return false;
  if (needUnlocked && !unlocked(S, x, y)) return false;
  const t = y * S.W + x;
  if (S.terrain[t] !== TER.GRASS || S.bld[t] >= 0) return false;
  if (S.nodes[S.WH + t] || S.nodes[2 * S.WH + t]) return false;
  return true;
}
export function addHouse(S, x, y, color) {
  const t = y * S.W + x;
  const id = S.nextBld++;
  const h = { id, type: 'house', x, y, t, color, key: nkey(S, x, y, 0), cars: [] };
  h.cars.push(mkCar(S, h), mkCar(S, h));
  S.houses.push(h);
  S.bmap.set(id, h);
  S.bld[t] = id;
  S.trees[t] = 0;
  const n = ensureNode(S, h.key);
  n.term = true; n.bld = id;
  S.bldV++; S.transitDirty = true;
  return h;
}
// footprint (x,y)-(x+1,y+1); lot is one of its corner tiles
export function addDest(S, x, y, lot, color) {
  const id = S.nextBld++;
  const d = {
    id, type: 'dest', x, y, color, lot: { x: lot.x, y: lot.y }, lotKey: nkey(S, lot.x, lot.y, 0),
    pins: 0, enroute: 0, acc: 0, over: 0, age: 0, parked: [], served: 0, transit: [],
  };
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const t = (y + dy) * S.W + x + dx;
    S.bld[t] = id; S.trees[t] = 0;
  }
  const n = ensureNode(S, d.lotKey);
  n.term = true; n.bld = id;
  S.dests.push(d);
  S.bmap.set(id, d);
  S.bldV++; S.transitDirty = true;
  return d;
}
const inFoot = (d, x, y) => x >= d.x && x <= d.x + 1 && y >= d.y && y <= d.y + 1;
function lotSides(d) {
  const out = [];
  for (let k = 0; k < 4; k++) if (!inFoot(d, d.lot.x + DIRS[k][0], d.lot.y + DIRS[k][1])) out.push(k);
  return out;
}
export function removeBuilding(S, b) {
  if (b.type === 'house') {
    for (const c of b.cars) {
      if (c.active) despawn(S, c);
      if (c.state === 'parked' && c.dest) c.dest.parked = c.dest.parked.filter((p) => p !== c);
      if (c.state === 'out' && c.dest) c.dest.enroute = Math.max(0, c.dest.enroute - 1);
      c.state = 'gone';
    }
    S.houses = S.houses.filter((h) => h !== b);
    S.bld[b.t] = -1;
  } else {
    for (const v of S.vehicles) if (v.kind === 'car' && v.dest === b && v.active) { despawn(S, v); v.state = 'home'; v.dest = null; }
    for (const c of b.parked) { c.state = 'home'; c.dest = null; }
    for (const st of S.stops.values()) st.wait = st.wait.filter((p) => p.dest !== b);
    for (const v of S.vehicles) if (v.pax) v.pax = v.pax.filter((p) => p.dest !== b);
    S.dests = S.dests.filter((d) => d !== b);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) S.bld[(b.y + dy) * S.W + b.x + dx] = -1;
  }
  const k = b.type === 'house' ? b.key : b.lotKey;
  const n = S.nodes[k];
  if (n) {
    for (let d = 0; d < 4; d++) if (n.dirs[d] >= 0) removeLink(S, n.dirs[d]);
    n.term = false; n.bld = -1; pruneNode(S, k);
  }
  S.bmap.delete(b.id);
  S.bldV++; S.transitDirty = true;
  rebuildNet(S);
}

// ------------------------------------------------------------------ building the network
function nodeProblem(S, x, y, lvl) {
  if (!inMap(S, x, y)) return 'Off the map';
  if (S.mode === 'city' && !unlocked(S, x, y)) return 'That area is not open yet';
  const t = y * S.W + x, ter = S.terrain[t], b = S.bld[t];
  if (lvl === 0) {
    if (ter === TER.MOUNTAIN) return 'Mountains need a tunnel';
    if (b >= 0) {
      const B = S.bmap.get(b);
      if (B.type === 'dest' && !(B.lot.x === x && B.lot.y === y)) return 'A building is in the way';
    }
  } else if (lvl === 1) {
    if (ter === TER.MOUNTAIN) return 'Too high here: tunnel through mountains';
    if (b >= 0) return "Flyovers can't pass over buildings";
  }
  return null;
}
function linkMult(S, ta, tb, la, lb) {
  if (la === 1 || lb === 1) return MULT.elevated;
  if (la === -1 || lb === -1) return MULT.tunnel;
  if (S.terrain[ta] === TER.WATER || S.terrain[tb] === TER.WATER) return MULT.water;
  return 1;
}
const hasLinks = (S, k) => { const n = S.nodes[k]; return !!n && n.dirs.some((d) => d >= 0); };

// Plan a build along a path of adjacent tiles. layer: 'ground' | 'up' (flyover) | 'down' (tunnel)
export function planBuild(S, tiles, kind, layer = 'ground') {
  const res = { links: [], cost: 0, err: null, bad: [], lv: [], kind, layer };
  const n = tiles.length;
  if (n < 2) { res.err = 'Drag across tiles to build'; return res; }
  for (let i = 1; i < n; i++) {
    if (dirBetween(tiles[i - 1].x, tiles[i - 1].y, tiles[i].x, tiles[i].y) < 0) { res.err = 'Tiles must touch'; return res; }
  }
  let lv = tiles.map(() => 0);
  if (layer !== 'ground') {
    const L = layer === 'up' ? 1 : -1;
    const sUp = hasLinks(S, nkey(S, tiles[0].x, tiles[0].y, L));
    const eUp = hasLinks(S, nkey(S, tiles[n - 1].x, tiles[n - 1].y, L));
    lv = tiles.map((_, i) => ((i === 0 && !sUp) || (i === n - 1 && !eUp) ? 0 : L));
    if (lv.every((l) => l === 0)) { res.err = layer === 'up' ? 'Flyovers span at least 3 tiles' : 'Tunnels span at least 3 tiles'; return res; }
  }
  res.lv = lv;
  const K = KIND[kind];
  const virt = new Map(); // node key -> dirs[] of {kind, tram} after the build
  const vget = (k) => {
    if (!virt.has(k)) {
      const N = S.nodes[k];
      virt.set(k, [0, 1, 2, 3].map((d) => {
        if (!N || N.dirs[d] < 0) return null;
        const L = S.links.get(N.dirs[d]);
        return { kind: L.kind, tram: L.tram };
      }));
    }
    return virt.get(k);
  };
  for (let i = 0; i < n - 1; i++) {
    const A = tiles[i], B = tiles[i + 1];
    const d = dirBetween(A.x, A.y, B.x, B.y);
    const la = lv[i], lb = lv[i + 1];
    const ka = nkey(S, A.x, A.y, la), kb = nkey(S, B.x, B.y, lb);
    const p = nodeProblem(S, A.x, A.y, la) || nodeProblem(S, B.x, B.y, lb);
    if (p) { res.err = res.err || p; res.bad.push(i); continue; }
    const ta = A.y * S.W + A.x, tb = B.y * S.W + B.x;
    const mult = linkMult(S, ta, tb, la, lb);
    const NA = S.nodes[ka];
    const exId = NA ? NA.dirs[d] : -1;
    const ex = exId >= 0 ? S.links.get(exId) : null;
    if (ex && otherEnd(ex, ka) === kb) {
      let up = null;
      if (ex.kind === kind) up = null; // already built
      else if (kind === 'tram' && ex.kind === 'road') up = ex.tram ? null : { kind: 'road', tram: true, cost: KIND.tram.cost * mult };
      else if (kind === 'road' && ex.kind === 'tram') up = { kind: 'road', tram: true, cost: KIND.road.cost * mult };
      else if (kind === 'motorway' && ex.kind === 'road' && !ex.tram) up = { kind: 'motorway', tram: false, cost: KIND.motorway.cost * mult };
      else if (ex.kind !== kind) { res.err = res.err || 'Erase this first'; res.bad.push(i); continue; }
      if (up) {
        res.links.push({ up: ex.id, a: ka, b: kb, d, kind: up.kind, tram: up.tram, cost: up.cost, i });
        res.cost += up.cost;
        vget(ka)[d] = { kind: up.kind, tram: up.tram };
        vget(kb)[opp(d)] = { kind: up.kind, tram: up.tram };
      }
      continue;
    }
    const e = edgeIdx(S, ta, d);
    if (S.edgeOcc[e] & slotBits(la, lb)) { res.err = res.err || 'Something is already here'; res.bad.push(i); continue; }
    if (res.links.some((q) => q.e === e && (q.bits & slotBits(la, lb)))) { res.err = res.err || 'Path crosses itself'; res.bad.push(i); continue; }
    const cost = K.cost * mult;
    res.links.push({ a: ka, b: kb, d, kind, tram: false, cost, e, bits: slotBits(la, lb), i });
    res.cost += cost;
    vget(ka)[d] = { kind, tram: false };
    vget(kb)[opp(d)] = { kind, tram: false };
  }
  // node rules on the resulting network
  for (const [k, dirs] of virt) {
    const info = keyInfo(S, k);
    const N = S.nodes[k];
    const list = dirs.map((x, d) => (x ? { ...x, d } : null)).filter(Boolean);
    const rail = list.filter((x) => x.kind === 'rail');
    const other = list.filter((x) => x.kind !== 'rail');
    let p = null;
    const t = info.t;
    const B = S.bld[t] >= 0 && info.lvl === 0 ? S.bmap.get(S.bld[t]) : null;
    const portal = N && N.portal;
    if (B || portal) {
      if (list.some((x) => x.kind !== 'road' || x.tram)) p = 'Only plain roads connect to buildings';
      else if (B && B.type === 'house' && list.length > 1) p = 'A house has one driveway';
      else if (B && B.type === 'dest') {
        const ok = lotSides(B);
        if (list.some((x) => !ok.includes(x.d))) p = 'Connect to the car park from outside';
      }
    }
    if (!p && rail.length && other.length) {
      const straight = rail.length === 2 && rail[0].d === opp(rail[1].d);
      const perp = other.every((x) => x.d !== rail[0].d && x.d !== opp(rail[0].d));
      if (info.lvl !== 0 || !straight || !perp) p = 'Railways can only cross a road straight on';
      else if (other.some((x) => x.kind === 'motorway')) p = 'Motorways need a bridge over railways';
    }
    if (!p && list.some((x) => x.kind === 'motorway') && list.some((x) => x.kind === 'tram')) p = "Trams can't join a motorway";
    if (!p) {
      // a road joining a motorway mid-way is an entrance/exit (interchange); crossing it on the ground is not allowed
      const mw = list.filter((x) => x.kind === 'motorway').length;
      const side = list.length - mw;
      if (mw >= 2 && side >= 2) p = 'Cross motorways with a flyover or tunnel';
      else if (mw >= 2 && side === 1) {
        const before = N ? N.dirs.filter((id) => id >= 0 && S.links.get(id).kind !== 'motorway').length : 0;
        const mwBefore = N ? N.dirs.filter((id) => id >= 0 && S.links.get(id).kind === 'motorway').length : 0;
        if (!(before === 1 && mwBefore >= 2)) {
          res.cost += COST.interchange;
          res.interchanges = (res.interchanges || 0) + 1;
          const q = res.links.find((l) => l.a === k || l.b === k);
          if (q) q.cost += COST.interchange;
        }
      }
    }
    if (!p && N && N.stop && (list.length > 2 || (list.length === 2 && list[0].d !== opp(list[1].d)))) p = 'Stops must stay on a straight track';
    if (p) { res.err = res.err || p; res.bad.push(-1 - k); }
  }
  if (!res.err && !S.sandbox && res.cost > S.money) res.err = 'Not enough money';
  return res;
}

export function commitBuild(S, plan) {
  if (plan.err || !plan.links.length) return false;
  if (!S.sandbox && plan.cost > S.money) return false;
  for (const q of plan.links) {
    if (q.up) {
      const L = S.links.get(q.up);
      L.kind = q.kind; L.tram = q.tram; L.value += q.cost; setCaps(L);
    } else addLink(S, q.a, q.b, q.d, q.kind, q.tram, q.cost);
  }
  if (!S.sandbox) S.money -= plan.cost;
  S.netValue += plan.cost;
  rebuildNet(S);
  ev(S, { t: 'build', cost: plan.cost });
  return true;
}

export function addLink(S, a, b, d, kind, tram = false, value = 0) {
  const NA = ensureNode(S, a), NB = ensureNode(S, b);
  const e = edgeIdx(S, NA.t, d);
  const bits = slotBits(NA.lvl, NB.lvl);
  const L = { id: S.nextLink++, a, b, d, kind, tram: !!tram, e, bits, value };
  setCaps(L);
  NA.dirs[d] = L.id; NB.dirs[opp(d)] = L.id;
  S.edgeOcc[e] |= bits;
  S.links.set(L.id, L);
  for (const N of [NA, NB]) if (N.lvl === 0) S.trees[N.t] = 0;
  return L;
}

function removeLink(S, id) {
  const L = S.links.get(id);
  if (!L) return 0;
  const NA = S.nodes[L.a], NB = S.nodes[L.b];
  NA.dirs[L.d] = -1; NB.dirs[opp(L.d)] = -1;
  S.edgeOcc[L.e] &= ~L.bits;
  S.links.delete(id);
  S.netValue = Math.max(0, S.netValue - L.value);
  pruneNode(S, L.a); pruneNode(S, L.b);
  return L.value;
}

// Erase everything on a tile at one level (ground first unless a layer is given).
export function eraseTile(S, x, y, layer = 'ground') {
  if (!inMap(S, x, y)) return 0;
  const order = layer === 'up' ? [1] : layer === 'down' ? [-1] : [0, 1, -1];
  let locked = false;
  for (const lvl of order) {
    const k = nkey(S, x, y, lvl);
    const N = S.nodes[k];
    if (!N) continue;
    let refund = 0, did = false;
    if (N.stop) { refund += N.stop.value; removeStop(S, k); did = true; }
    for (let d = 0; d < 4; d++) {
      if (N.dirs[d] < 0) continue;
      // road puzzles: the pieces that came with the map stay
      if (S.mode === 'puzzle' && S.links.get(N.dirs[d]).value === 0) { locked = true; continue; }
      refund += removeLink(S, N.dirs[d]); did = true;
    }
    if (N.ctrl !== 'none') { refund += N.ctrl === 'lights' ? COST.lights : COST.round; N.ctrl = 'none'; did = true; }
    if (!did) continue;
    pruneNode(S, k);
    const back = Math.round(refund * 0.5);
    if (!S.sandbox) S.money += back;
    rebuildNet(S);
    ev(S, { t: 'erase', x, y });
    return back || 1;
  }
  if (S.sandbox && S.bld[y * S.W + x] >= 0 && layer === 'ground') {
    removeBuilding(S, S.bmap.get(S.bld[y * S.W + x]));
    ev(S, { t: 'erase', x, y });
    return 1;
  }
  return locked ? -1 : 0;
}

// Cycle a junction's control: none -> lights -> roundabout -> none
export function setControl(S, x, y, ctrl, lvl = null) {
  const lvls = lvl == null ? [0, 1, -1] : [lvl];
  for (const l of lvls) {
    const N = S.nodes[nkey(S, x, y, l)];
    if (!N || !N.j || N.term) continue;
    if (N.cross) return { err: 'Level crossings control themselves' };
    if (ctrl === 'round' && N.dirs.some((id) => id >= 0 && S.links.get(id).kind === 'rail')) return { err: 'No roundabouts on railways' };
    if (N.ctrl === ctrl) return { err: null, same: true };
    const cost = ctrl === 'lights' ? COST.lights : ctrl === 'round' ? COST.round : 0;
    if (!S.sandbox && cost > S.money) return { err: 'Not enough money' };
    if (!S.sandbox) S.money -= cost;
    N.ctrl = ctrl;
    N.lights = null;
    rebuildNet(S);
    ev(S, { t: 'build', cost });
    return { err: null, node: N };
  }
  return { err: 'Tap a junction (3 or more roads meet)' };
}

export function toggleLights(S, N) {
  if (!N || !N.lights) return false;
  N.lights.manual = true;
  N.lights.want = N.lights.phase ^ 1;
  return true;
}
export function autoLights(S, N) { if (N && N.lights) { N.lights.manual = false; N.lights.want = -1; } }

// ------------------------------------------------------------------ stops & lines
export function placeStop(S, x, y) {
  for (const lvl of [0, 1, -1]) {
    const k = nkey(S, x, y, lvl);
    const N = S.nodes[k];
    if (!N || N.term) continue;
    const ls = N.dirs.filter((d) => d >= 0).map((id) => S.links.get(id));
    const tram = ls.length && ls.every((L) => L.trm);
    const rail = ls.length && ls.every((L) => L.rl);
    if (!tram && !rail) continue;
    const ds = [0, 1, 2, 3].filter((d) => N.dirs[d] >= 0);
    if (ds.length > 2 || (ds.length === 2 && ds[0] !== opp(ds[1]))) return { err: 'Stops go on a straight piece of track' };
    if (N.stop) return { err: 'There is already a stop here' };
    const type = rail ? 'station' : 'stop';
    const cost = rail ? COST.station : COST.stop;
    if (!S.sandbox && cost > S.money) return { err: 'Not enough money' };
    if (!S.sandbox) S.money -= cost;
    N.stop = { key: k, type, wait: [], value: cost, x, y, lvl };
    S.stops.set(k, N.stop);
    S.transitDirty = true; S.lineV++;
    ev(S, { t: 'build', cost });
    return { err: null, stop: N.stop };
  }
  return { err: 'Stops go on tram track or railway' };
}

function removeStop(S, k) {
  const st = S.stops.get(k);
  if (!st) return;
  for (const p of st.wait) p.dest.enroute = Math.max(0, p.dest.enroute - 1);
  S.stops.delete(k);
  const N = S.nodes[k];
  if (N) N.stop = null;
  for (const line of S.lines.slice()) if (line.stopSet.has(k)) deleteLine(S, line, 'A stop was removed');
  S.transitDirty = true; S.lineV++;
}

export function findTrackPath(S, stops, mode) {
  let path = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const p = findPath(S, stops[i], stops[i + 1], mode);
    if (!p) return null;
    path = path.length ? path.concat(p.slice(1)) : p;
  }
  return path;
}

export function createLine(S, kind, stopKeys) {
  const mode = kind === 'tram' ? 'tram' : 'rail';
  if (stopKeys.length < 2) return { err: 'Pick at least two stops' };
  for (const k of stopKeys) {
    const st = S.stops.get(k);
    if (!st) return { err: 'That is not a stop' };
    if ((st.type === 'station') !== (kind === 'train')) return { err: kind === 'train' ? 'Trains use stations' : 'Trams use tram stops' };
  }
  const path = findTrackPath(S, stopKeys, mode);
  if (!path) return { err: 'The stops are not joined by track' };
  const cost = kind === 'tram' ? COST.tramVeh : COST.trainVeh;
  if (!S.sandbox && cost > S.money) return { err: 'Not enough money' };
  const loop = stopKeys.length > 2 && stopKeys[0] === stopKeys[stopKeys.length - 1];
  const line = {
    id: S.nextLine++, kind, stops: stopKeys.slice(), stopSet: new Set(stopKeys), path, loop,
    color: LINE_COLORS[(S.nextLine - 2) % LINE_COLORS.length], veh: [], pending: 1, ok: true,
  };
  S.lines.push(line);
  if (!S.sandbox) S.money -= cost;
  S.transitDirty = true; S.lineV++;
  trySpawnLineVehicles(S, line);
  ev(S, { t: 'build', cost });
  return { err: null, line };
}

export function addLineVehicle(S, line) {
  const cost = line.kind === 'tram' ? COST.tramVeh : COST.trainVeh;
  if (!S.sandbox && cost > S.money) return { err: 'Not enough money' };
  if (line.veh.length + line.pending >= 6) return { err: 'This line is full' };
  if (!S.sandbox) S.money -= cost;
  line.pending++;
  trySpawnLineVehicles(S, line);
  return { err: null };
}

export function deleteLine(S, line, why = null) {
  for (const v of line.veh) {
    if (v.active) despawn(S, v);
    for (const p of v.pax || []) p.dest.enroute = Math.max(0, p.dest.enroute - 1);
  }
  for (const st of S.stops.values()) {
    st.wait = st.wait.filter((p) => { if (p.line === line) { p.dest.enroute = Math.max(0, p.dest.enroute - 1); return false; } return true; });
  }
  S.lines = S.lines.filter((l) => l !== line);
  S.transitDirty = true; S.lineV++;
  if (why) ev(S, { t: 'msg', msg: `Line removed: ${why}` });
}

function mkTransit(S, line) {
  const kind = line.kind === 'tram' ? 'tram' : 'train';
  const V = VEH[kind];
  return {
    id: S.nextVeh++, kind, len: V.len, w: V.w, color: 0, line, path: line.path.slice(), pi: 0, loop: line.loop,
    seg: null, s: 0, v: 0, odo: 0, ahead: [], hist: [], prev: null, grant: null, grantBox: null, grantRec: null, occs: [],
    wait: 0, reqT: -1, reqTick: -1, epoch: 0, active: false, crashed: 0, served: -1, dwell: 0, pax: [], fwd: true,
  };
}

function trySpawnLineVehicles(S, line) {
  while (line.pending > 0) {
    const v = mkTransit(S, line);
    if (!spawnAlong(S, v, v.path, v.kind === 'train' ? 'rail' : 'tram')) break;
    line.pending--;
    line.veh.push(v);
  }
}

// ------------------------------------------------------------------ net rebuild
function nodeFlags(S, n) {
  let deg = 0, rl = 0, mw = 0, maxHalf = 0;
  for (let d = 0; d < 4; d++) {
    const id = n.dirs[d];
    if (id < 0) continue;
    const L = S.links.get(id);
    deg++;
    if (L.rl) rl++;
    if (L.kind === 'motorway') mw++;
    maxHalf = Math.max(maxHalf, KIND[L.kind].half);
  }
  n.deg = deg;
  n.cross = rl > 0 && rl < deg;
  let j = false;
  if (!n.term) {
    if (deg >= 3) j = true;
    else if (deg === 2 && mw === 1) j = true; // motorway end joins a road: merge
    if (n.cross) j = true;
  }
  n.j = j;
  if (!j || n.cross) n.ctrl = 'none';
  if (n.ctrl === 'round' && rl) n.ctrl = 'none';
  n.R = n.ctrl === 'round' ? 0.42 : Math.max(0.27, maxHalf + 0.06);
  if (n.ctrl === 'lights') { if (!n.lights) n.lights = { phase: 0, t: 0, clear: 0, manual: false, want: -1 }; }
  else n.lights = null;
  if (j) S.junctions.push(n);
}

export function rebuildNet(S) {
  S.netV++;
  // remember where every vehicle is
  for (const v of S.vehicles) {
    const seg = v.seg;
    if (seg.type === 'lane') { v._k = seg.key; v._abs = seg.s0 + v.s; v._bx = null; }
    else { v._k = seg.outLane.key; v._abs = null; v._bx = seg.key; v._bs = v.s; }
  }
  S.junctions = [];
  for (const n of S.nodes) if (n) nodeFlags(S, n);
  const old = S.lanes;
  const lanes = new Map();
  for (const L of S.links.values()) {
    const K = KIND[L.kind];
    for (let f = 0; f < 2; f++) for (let i = 0; i < K.lanes; i++) {
      const key = L.id * 4 + f * 2 + i;
      let ln = old.get(key);
      if (!ln || ln.link !== L) ln = { type: 'lane', key, veh: [], tailVeh: null, tailOdo: 0, tailEp: 0 };
      const from = f ? L.b : L.a, to = f ? L.a : L.b;
      const A = S.nodes[from], B = S.nodes[to];
      ln.link = L; ln.f = f; ln.idx = i; ln.from = from; ln.to = to; ln.dir = f ? opp(L.d) : L.d;
      ln.off = K.off[i]; ln.s0 = A.j ? A.R : 0; ln.len = 1 - ln.s0 - (B.j ? B.R : 0);
      ln.hA = A.h; ln.hB = B.h; ln.speed = K.speed; ln.car = L.car; ln.trm = L.trm; ln.rl = L.rl; ln.lanes = K.lanes;
      ln.veh = [];
      lanes.set(key, ln);
    }
  }
  S.lanes = lanes;
  for (const n of S.nodes) if (n) { n.inL = []; n.outL = []; n.occ = []; n.req = []; n.app = []; n.moves = []; }
  for (const ln of lanes.values()) { S.nodes[ln.to].inL.push(ln); S.nodes[ln.from].outL.push(ln); }
  const oldB = S.boxes;
  const boxes = new Map();
  for (const n of S.junctions) buildBoxes(S, n, oldB, boxes);
  S.boxes = boxes;
  for (const b of boxes.values()) b.veh = [];
  // put vehicles back
  for (const v of S.vehicles.slice()) {
    v.grant = null; v.grantBox = null; v.grantRec = null; v.occs = []; v.ahead = []; v.reqT = -1;
    let ok = false;
    if (v._bx && boxes.has(v._bx)) {
      const b = boxes.get(v._bx);
      v.seg = b; v.s = Math.min(v._bs, b.len); b.veh.push(v);
      occAdd(b.node, v, b, v.odo - v.s);
      ok = true;
    } else {
      const ln = lanes.get(v._k);
      if (ln) { v.seg = ln; v.s = v._abs == null ? 0 : clamp(v._abs - ln.s0, 0, ln.len); ln.veh.push(v); ok = true; }
    }
    if (!ok) { orphan(S, v); continue; }
    const hist = [];
    for (const h of v.hist) { if ((h.type === 'lane' ? lanes.get(h.key) : boxes.get(h.key)) !== h) break; hist.push(h); }
    v.hist = hist;
    v.prev = hist[0] || null;
  }
  for (const ln of lanes.values()) ln.veh.sort((a, b) => b.s - a.s);
  for (const b of boxes.values()) b.veh.sort((a, b2) => b2.s - a.s);
  // lines first (vehicles may get new paths), then car routes
  for (const line of S.lines.slice()) validateLine(S, line);
  for (const v of S.vehicles) if (v.active && v.kind === 'car') validateRoute(S, v);
  S.transitDirty = true;
}

function buildBoxes(S, n, oldB, boxes) {
  const moves = [];
  for (const a of n.inL) for (const b of n.outL) {
    if (a.link === b.link) continue;
    const car = a.car && b.car, trm = a.trm && b.trm, rl = a.rl && b.rl;
    if (!car && !trm && !rl) continue;
    const key = a.key + '>' + b.key;
    let bx = oldB.get(key);
    if (!bx || bx.node !== n) bx = { type: 'box', key, veh: [], tailVeh: null, tailOdo: 0, tailEp: 0 };
    bx.node = n; bx.inLane = a; bx.outLane = b; bx.inSide = opp(a.dir); bx.outSide = b.dir;
    bx.round = n.ctrl === 'round'; bx.car = car; bx.trm = trm; bx.rl = rl;
    bx.turn = b.dir !== a.dir;
    bx.path = movePath(n.R, bx.inSide, a.off, bx.outSide, b.off, bx.round);
    bx.len = bx.path.len;
    bx.speed = Math.min(a.speed, b.speed) * (bx.turn || bx.round ? TURN_F : 1);
    bx.mw = a.link.kind === 'motorway' && b.link.kind === 'motorway';
    bx.mi = moves.length;
    moves.push(bx);
    boxes.set(key, bx);
  }
  n.moves = moves;
  const m = moves.length;
  n.conf = new Uint8Array(m * m);
  if (n.ctrl === 'round') return;
  for (let i = 0; i < m; i++) for (let k = i + 1; k < m; k++) {
    const c = movesConflict(moves[i], moves[k]) ? 1 : 0;
    n.conf[i * m + k] = c; n.conf[k * m + i] = c;
  }
}

const confCache = new Map();
function movesConflict(A, B) {
  if (A.inLane === B.inLane) return false;
  if (A.outLane === B.outLane) return true;
  const key = A.path.key < B.path.key ? A.path.key + '#' + B.path.key : B.path.key + '#' + A.path.key;
  let c = confCache.get(key);
  if (c === undefined) {
    c = false;
    const p = A.path.pts, q = B.path.pts;
    const pa = densify(p), qa = densify(q);
    outer: for (let i = 0; i < pa.length; i += 2) for (let k = 0; k < qa.length; k += 2) {
      const dx = pa[i] - qa[k], dy = pa[i + 1] - qa[k + 1];
      if (dx * dx + dy * dy < 0.135 * 0.135) { c = true; break outer; }
    }
    confCache.set(key, c);
  }
  return c;
}
function densify(p) {
  const out = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const x0 = p[i - 2], y0 = p[i - 1], x1 = p[i], y1 = p[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.04));
    for (let k = 1; k <= n; k++) out.push(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
  }
  return out;
}

const pathCache = new Map();
// movement path through a junction box, relative to the node centre (x right, y = tile y)
export function movePath(R, inSide, offIn, outSide, offOut, round) {
  const key = `${R.toFixed(3)}|${inSide}|${offIn}|${outSide}|${offOut}|${round ? 1 : 0}`;
  let p = pathCache.get(key);
  if (p) return p;
  const dIn = opp(inSide);
  const [ix, iy] = DIRS[inSide], [tx, ty] = DIRS[dIn];
  const p0x = ix * R - ty * offIn, p0y = iy * R + tx * offIn;
  const [ox, oy] = DIRS[outSide];
  const p2x = ox * R - oy * offOut, p2y = oy * R + ox * offOut;
  const pts = [];
  if (round) {
    const ai = Math.atan2(iy, ix) - 0.45, ao = Math.atan2(oy, ox) + 0.45;
    let sweep = ai - ao;
    while (sweep <= 0.2) sweep += TAU;
    while (sweep > TAU + 0.2) sweep -= TAU;
    pts.push(p0x, p0y);
    const n = Math.max(3, Math.ceil(sweep / 0.22));
    for (let k = 0; k <= n; k++) { const a = ai - (sweep * k) / n; pts.push(Math.cos(a) * RING_R, Math.sin(a) * RING_R); }
    pts.push(p2x, p2y);
  } else if (outSide === dIn) {
    pts.push(p0x, p0y, p2x, p2y);
  } else {
    let cx, cy;
    if (tx !== 0) { cx = p2x; cy = p0y; } else { cx = p0x; cy = p2y; }
    for (let k = 0; k <= 12; k++) {
      const t = k / 12, u = 1 - t;
      pts.push(u * u * p0x + 2 * u * t * cx + t * t * p2x, u * u * p0y + 2 * u * t * cy + t * t * p2y);
    }
  }
  const cum = [0];
  for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  p = { key, pts, cum, len: cum[cum.length - 1] };
  pathCache.set(key, p);
  return p;
}

// ------------------------------------------------------------------ path finding
class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, p = this.p;
    let i = k.length; k.push(key); p.push(pri);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= pri) break;
      k[i] = k[j]; p[i] = p[j]; i = j;
    }
    k[i] = key; p[i] = pri;
  }
  pop() {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        k[i] = k[c]; p[i] = p[c]; i = c;
      }
      k[i] = lk; p[i] = lp;
    }
    return top;
  }
}

function travelCost(S, L, fromKey, mode) {
  const K = KIND[L.kind];
  let sp = mode === 'tram' ? Math.min(VEH.tram.max, K.speed) : K.speed;
  let c = 1 / sp;
  if (mode === 'car') {
    const f = L.a === fromKey ? 0 : 1;
    let q = 0;
    for (let i = 0; i < K.lanes; i++) { const ln = S.lanes.get(L.id * 4 + f * 2 + i); if (ln) q += ln.veh.length; }
    c += (q / K.lanes) * 0.3 / sp;
    const to = S.nodes[otherEnd(L, fromKey)];
    if (to.j) c += to.ctrl === 'lights' ? 0.6 : to.ctrl === 'round' ? 0.3 : 0.25;
  }
  return c;
}

// A* over the network. Terminal nodes (buildings, portals) are only allowed as start or goal.
export function findPath(S, from, to, mode = 'car') {
  if (from === to) return [from];
  if (!S.nodes[from] || !S.nodes[to]) return null;
  const g = S._g, st = S._st, pv = S._pv;
  const gen = ++S._gen;
  const W = S.W, WH = S.WH;
  const tt = to % WH, tx = tt % W, ty = (tt - tx) / W;
  const maxSp = mode === 'car' ? KIND.motorway.speed : mode === 'tram' ? 1 : KIND.rail.speed;
  const hfun = (k) => { const t = k % WH, x = t % W, y = (t - x) / W; return (Math.abs(x - tx) + Math.abs(y - ty)) / maxSp; };
  const heap = new Heap();
  g[from] = 0; st[from] = gen; pv[from] = -1;
  heap.push(from, hfun(from));
  const closed = new Set();
  let guard = 0;
  while (heap.size && guard++ < 60000) {
    const k = heap.pop();
    if (closed.has(k)) continue;
    closed.add(k);
    if (k === to) break;
    const N = S.nodes[k];
    if (N.term && k !== from) continue;
    for (let d = 0; d < 4; d++) {
      const id = N.dirs[d];
      if (id < 0) continue;
      const L = S.links.get(id);
      if (!canUse(L, mode)) continue;
      const m = otherEnd(L, k);
      if (closed.has(m)) continue;
      const M = S.nodes[m];
      if (M.term && m !== to) continue;
      const ng = g[k] + travelCost(S, L, k, mode);
      if (st[m] !== gen || ng < g[m]) {
        g[m] = ng; st[m] = gen; pv[m] = k;
        heap.push(m, ng + hfun(m));
      }
    }
  }
  if (st[to] !== gen || !closed.has(to)) return null;
  const path = [];
  for (let k = to; k !== -1; k = pv[k]) path.push(k);
  path.reverse();
  return path[0] === from ? path : null;
}

// Dijkstra outward from a destination's car park, collecting the nearest houses of its colour
// that have a car at home. Returns [{house, path}] with paths house -> car park.
function searchHouses(S, d, max) {
  const out = [];
  const g = S._g, st = S._st, pv = S._pv;
  const gen = ++S._gen;
  const start = d.lotKey;
  if (!S.nodes[start]) return out;
  const heap = new Heap();
  g[start] = 0; st[start] = gen; pv[start] = -1;
  heap.push(start, 0);
  const closed = new Set();
  let guard = 0;
  while (heap.size && out.length < max && guard++ < 20000) {
    const k = heap.pop();
    if (closed.has(k)) continue;
    closed.add(k);
    const N = S.nodes[k];
    if (N.term && k !== start) {
      const B = N.bld >= 0 ? S.bmap.get(N.bld) : null;
      if (B && B.type === 'house' && B.color === d.color) {
        const car = B.cars.find((c) => c.state === 'home');
        if (car) {
          const path = [];
          for (let q = k; q !== -1; q = pv[q]) path.push(q);
          const ln = firstLane(S, path);
          if (ln && laneRearFree(ln) >= car.len + MIN_GAP) out.push({ house: B, car, path });
        }
      }
      continue;
    }
    for (let dd = 0; dd < 4; dd++) {
      const id = N.dirs[dd];
      if (id < 0) continue;
      const L = S.links.get(id);
      if (!L.car) continue;
      const m = otherEnd(L, k);
      if (closed.has(m)) continue;
      const ng = g[k] + travelCost(S, L, m, 'car');
      if (st[m] !== gen || ng < g[m]) { g[m] = ng; st[m] = gen; pv[m] = k; heap.push(m, ng); }
    }
  }
  return out;
}

function firstLane(S, path) {
  const N = S.nodes[path[0]];
  const L = linkTo(S, N, path[1]);
  if (!L) return null;
  return S.lanes.get(L.id * 4 + (L.a === N.key ? 0 : 1) * 2);
}

// ------------------------------------------------------------------ vehicles: placement
function laneRearFree(ln) {
  const n = ln.veh.length;
  if (n) { const r = ln.veh[n - 1]; return r.s - r.len; }
  const t = ln.tailVeh;
  if (t && t.active && t.epoch === ln.tailEp) {
    const p = ln.len + (t.odo - ln.tailOdo) - t.len;
    if (p < ln.len) return p;
  }
  return ln.len;
}

function placeOn(S, v, seg, s) {
  v.seg = seg; v.s = s; v.v = 0;
  let i = seg.veh.length;
  while (i > 0 && seg.veh[i - 1].s < s) i--;
  seg.veh.splice(i, 0, v);
  v.ahead = []; v.prev = null; v.hist = [];
  v.epoch++; v.active = true; v.wait = 0; v.reqT = -1; v.grant = null; v.grantBox = null; v.grantRec = null;
  releaseAll(v);
  v.lost = false;
  if (!S.vehicles.includes(v)) S.vehicles.push(v);
}

// spawn a vehicle at the start of a node path with its front `len` along it (no junctions in the way)
function spawnAlong(S, v, path, mode) {
  if (path.length < 2) return false;
  const segs = [];
  let dist = 0, i = 0;
  while (dist < v.len - 1e-6) {
    if (i >= path.length - 1) break;
    const N = S.nodes[path[i]];
    const L = linkTo(S, N, path[i + 1]);
    if (!L || !canUse(L, mode)) return false;
    const ln = S.lanes.get(L.id * 4 + (L.a === N.key ? 0 : 1) * 2);
    if (i > 0 && N.j) break; // stop before a junction
    if (ln.veh.length || laneRearFree(ln) < ln.len - 1e-6) return false;
    segs.push(ln);
    dist += ln.len;
    i++;
  }
  if (!segs.length) return false;
  const last = segs[segs.length - 1];
  const s = Math.min(last.len, last.len - (dist - v.len));
  placeOn(S, v, last, Math.max(0.01, s));
  v.path = path; v.pi = i;
  v.hist = segs.slice(0, -1).reverse();
  v.prev = v.hist[0] || null;
  return true;
}

function removeFromSeg(v) {
  if (!v.seg) return;
  const i = v.seg.veh.indexOf(v);
  if (i >= 0) v.seg.veh.splice(i, 1);
}
// junction reservations: n.occ and v.occs hold the same records {v, box, odo, n}
function occAdd(n, v, box, odo) {
  const r = { v, box, odo, n };
  n.occ.push(r); v.occs.push(r);
  return r;
}
function occRemove(r) {
  let i = r.n.occ.indexOf(r);
  if (i >= 0) r.n.occ.splice(i, 1);
  i = r.v.occs.indexOf(r);
  if (i >= 0) r.v.occs.splice(i, 1);
}
function releaseAll(v) { while (v.occs.length) occRemove(v.occs[v.occs.length - 1]); }
// give back a junction reservation the vehicle has not used yet
function dropGrant(v) {
  if (v.grantRec && v.odo < v.grantRec.odo + 1e-6) occRemove(v.grantRec);
  v.grant = null; v.grantBox = null; v.grantRec = null;
}
function resetAhead(v) {
  if (v.grant) dropGrant(v);
  v.ahead = [];
}
function releaseCleared(v) {
  for (let i = v.occs.length - 1; i >= 0; i--) {
    const r = v.occs[i];
    if (v.odo >= r.odo + r.box.len + v.len) occRemove(r);
  }
}
function despawn(S, v) {
  removeFromSeg(v);
  releaseAll(v);
  v.active = false; v.grant = null; v.grantBox = null; v.grantRec = null; v.v = 0;
}

// a vehicle whose road vanished
function orphan(S, v) {
  despawn(S, v);
  if (v.kind === 'car') carAbort(S, v);
  else if (v.line) { v.line.veh = v.line.veh.filter((x) => x !== v); v.line.pending++; for (const p of v.pax) p.dest.enroute = Math.max(0, p.dest.enroute - 1); v.pax = []; }
}

function carAbort(S, v) {
  if (v.state === 'out' && v.dest) v.dest.enroute = Math.max(0, v.dest.enroute - 1);
  if (v.state === 'gone') return;
  v.state = 'home'; v.dest = null;
  if (S.mode === 'city' || S.mode === 'puzzle') ev(S, { t: 'tow', id: v.id });
}

// ------------------------------------------------------------------ vehicles: route following
function aheadEntry(S, v, k) {
  while (v.ahead.length <= k) {
    const last = v.ahead.length ? v.ahead[v.ahead.length - 1] : { seg: v.seg, pi: v.pi };
    const e = nextEntry(S, v, last);
    if (!e) return null;
    v.ahead.push(e);
  }
  return v.ahead[k];
}

function nextEntry(S, v, E) {
  const seg = E.seg;
  if (seg.type === 'box') return { seg: seg.outLane, pi: E.pi + 1 };
  let pi = E.pi;
  const path = v.path;
  if (path[pi] !== seg.to) return null;
  if (v.line && v.served !== seg.to && v.line.stopSet.has(seg.to)) return null; // dwell at the stop
  if (pi >= path.length - 1) {
    if (!v.loop) return null;
    pi = 0;
  }
  const N = S.nodes[seg.to];
  const L = linkTo(S, N, path[pi + 1]);
  const mode = v.kind === 'car' ? 'car' : v.kind === 'tram' ? 'tram' : 'rail';
  if (!L || !canUse(L, mode)) { v.broken = true; return null; }
  const f = L.a === N.key ? 0 : 1;
  const K = KIND[L.kind];
  let idx = 0;
  if (K.lanes > 1) {
    if (!N.j && seg.lanes === K.lanes) idx = seg.idx;
    else {
      let best = -1;
      for (let i = 0; i < K.lanes; i++) { const r = laneRearFree(S.lanes.get(L.id * 4 + f * 2 + i)); if (r > best + 0.05) { best = r; idx = i; } }
    }
  }
  const out = S.lanes.get(L.id * 4 + f * 2 + idx);
  if (N.j) {
    const bx = S.boxes.get(seg.key + '>' + out.key);
    if (!bx) { v.broken = true; return null; }
    return { seg: bx, pi };
  }
  return { seg: out, pi: pi + 1 };
}

function vehPrio(v, box) {
  if (v.kind === 'train') return 3;
  if (box.mw) return 2;
  if (v.kind === 'tram') return 1;
  return 0;
}

function requestBox(S, v, box, dist) {
  const n = box.node;
  if (v.grant === n && v.grantBox !== box) dropGrant(v); // plans changed at this junction
  const bd = (v.v * v.v) / (2 * DECEL) + 0.3;
  const prio = vehPrio(v, box);
  if (dist <= bd) {
    if (v.reqTick !== S.tick) {
      v.reqTick = S.tick;
      if (v.reqT < 0) v.reqT = S.time;
      n.req.push({ v, box, prio });
    }
  } else if (prio >= 2 && dist < 1.5) n.app.push({ v, box, prio });
}

// distance from the vehicle's front to the nearest thing it must not hit
function obstacleAhead(S, v) {
  const seg = v.seg;
  const arr = seg.veh;
  const i = arr.indexOf(v);
  v.lead = null;
  if (i > 0) { const L = arr[i - 1]; v.lead = L; return L.s - L.len - v.s; }
  let best = Infinity;
  const tv = seg.tailVeh;
  if (tv && tv !== v && tv.active && tv.epoch === seg.tailEp) {
    const p = seg.len + (tv.odo - seg.tailOdo) - tv.len - v.s;
    if (p < best) best = p;
    if (p < 1.5) { v.lead2 = tv; v.lead2T = S.time; }
  }
  if (seg.type === 'box' && seg.round) best = Math.min(best, ringGap(S, v));
  let dist = seg.len - v.s;
  const look = 1.6 + v.v * 0.7;
  for (let k = 0; k < 6; k++) {
    if (dist > best || dist > look) break;
    const e = aheadEntry(S, v, k);
    if (!e) return Math.min(best, dist + MIN_GAP);
    const nx = e.seg;
    if (nx.type === 'box' && !(v.grant === nx.node && v.grantBox === nx)) {
      requestBox(S, v, nx, dist);
      return Math.min(best, dist);
    }
    if (nx.veh.length) {
      const r = nx.veh[nx.veh.length - 1];
      if (r !== v) { v.lead = r; return Math.min(best, dist + r.s - r.len); }
    }
    const t2 = nx.tailVeh;
    if (t2 && t2 !== v && t2.active && t2.epoch === nx.tailEp) {
      const p = dist + nx.len + (t2.odo - nx.tailOdo) - t2.len;
      if (p < best) best = p;
      if (p < 1.5) { v.lead2 = t2; v.lead2T = S.time; }
    }
    dist += nx.len;
  }
  return best;
}

function ringAngle(S, v) {
  const p = segPose(S, v.seg, v.s, null, null, {});
  const n = v.seg.node;
  return Math.atan2(p.z - n.y, p.x - n.x);
}
const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

function ringGap(S, v) {
  const n = v.seg.node;
  const a = ringAngle(S, v);
  let best = Infinity;
  for (const r of n.occ) {
    const o = r.v;
    if (o === v || o.seg.type !== 'box' || o.seg.node !== n) continue;
    const d = wrapA(a - ringAngle(S, o)); // positive: o is ahead (we travel towards smaller angles)
    if (d > 0.05 && d < 1.8) best = Math.min(best, d * RING_R - o.len);
  }
  return best;
}

function ringOk(S, n, box, v) {
  let count = 0;
  const ai = Math.atan2(DIRS[box.inSide][1], DIRS[box.inSide][0]) - 0.45;
  for (const r of n.occ) {
    const o = r.v;
    if (o === v) continue;
    count++;
    if (o.seg.type !== 'box' || o.seg.node !== n) { continue; }
    const d = wrapA(ringAngle(S, o) - ai);
    if (d > -0.6 && d < 1.5) return false;
  }
  return count < 4;
}

function exitSpace(S, n, box, v) {
  const out = box.outLane;
  const free = laneRearFree(out);
  let pend = 0;
  for (const r of n.occ) if (r.v !== v && r.box.outLane === out && r.v.odo < r.odo + r.box.len) pend += r.v.len + MIN_GAP;
  const need = v.len + MIN_GAP;
  if (out.len < need + 0.02) return free >= out.len - 1e-6 && pend === 0;
  return free - pend >= need;
}

function allowedBySignal(S, n, box, v) {
  if (v.kind === 'train') return true;
  if (S.reckless) {
    if (!n.sig || n.sig[box.inSide] == null) return true;
    const st = n.sig[box.inSide];
    if (st === 'g') return true;
    if (st === 'y') return n.tok[box.inSide] > 0;
    return false;
  }
  if (n.cross && n.barrier) return false;
  if (n.lights) {
    const L = n.lights;
    if (L.clear > 0) return false;
    const ns = box.inSide === 1 || box.inSide === 3;
    return L.phase === 0 ? ns : !ns;
  }
  return true;
}

function updateLights(S, n, dt) {
  const L = n.lights;
  if (L.clear > 0) {
    L.clear -= dt;
    if (L.clear <= 0) { L.phase ^= 1; L.t = 0; L.clear = 0; }
    return;
  }
  L.t += dt;
  if (L.manual) {
    if (L.want >= 0 && L.want !== L.phase) L.clear = 1.1;
    L.want = -1;
    return;
  }
  let q0 = 0, q1 = 0;
  for (const ln of n.inL) {
    if (ln.rl) continue;
    const side = opp(ln.dir);
    if (side === 1 || side === 3) q0 += ln.veh.length; else q1 += ln.veh.length;
  }
  const qc = L.phase === 0 ? q0 : q1, qo = L.phase === 0 ? q1 : q0;
  if (L.t > 4 && qo > 0 && (qc === 0 || L.t > 11 + Math.min(qc, 6))) L.clear = 1.1;
}

function grantIt(S, n, v, box) {
  v.grant = n; v.grantBox = box;
  v.grantRec = occAdd(n, v, box, v.odo + (v.seg.len - v.s));
  v.reqT = -1;
  if (S.reckless && n.sig && n.sig[box.inSide] === 'y') { n.tok[box.inSide] = 0; n.sig[box.inSide] = 'r'; }
}

function arbitrate(S, n, dt) {
  if (n.lights) updateLights(S, n, dt);
  if (n.cross) n.barrier = (S.tick - n.trainT <= 2 || n.occ.some((r) => r.v.kind === 'train')) ? 1 : 0;
  const reqs = n.req; n.req = [];
  const app = n.app; n.app = [];
  if (!reqs.length) return;
  reqs.sort((a, b) => b.prio - a.prio || a.v.reqT - b.v.reqT);
  const m = n.moves.length;
  const blockers = app.slice();
  for (const r of reqs) {
    const { v, box } = r;
    if (!v.active || (v.grant === n && v.grantBox === box)) continue;
    if (!allowedBySignal(S, n, box, v)) continue;
    if (!exitSpace(S, n, box, v)) continue;
    if (S.reckless && (!box.turn || v.kind === 'train')) { grantIt(S, n, v, box); continue; }
    let ok = true;
    if (box.round) ok = ringOk(S, n, box, v);
    else if (S.reckless && turnThreat(S, n, box, v)) ok = false;
    else {
      for (const o of n.occ) {
        if (o.v === v || o.box === box) continue;
        if (n.conf[o.box.mi * m + box.mi]) { ok = false; break; }
      }
      if (ok) for (const b of blockers) {
        if (b.v === v || b.box === box) continue;
        if ((b.prio > r.prio || (b.prio === r.prio && b.long)) && n.conf[b.box.mi * m + box.mi]) { ok = false; break; }
      }
    }
    if (ok) grantIt(S, n, v, box);
    else if (r.prio > 0 || S.time - v.reqT > 2.5) blockers.push({ v, box, prio: r.prio, long: S.time - v.reqT > 2.5 });
  }
}

// signal levels: a turning driver waits for a gap in straight-on traffic that has a green light
function turnThreat(S, n, box, v) {
  const m = n.moves.length;
  for (const ln of n.inL) {
    if (ln === box.inLane || ln.rl) continue;
    const side = opp(ln.dir);
    const st = n.sig ? n.sig[side] : 'g';
    if (st !== 'g' && st !== 'y') continue;
    let f = ln.veh[0] || null;
    let d = f ? ln.len - f.s : Infinity;
    if (!f) {
      const P = S.nodes[ln.from];
      if (P && !P.j) for (const l2 of P.inL) {
        if (l2.link === ln.link || !l2.veh.length) continue;
        const g = l2.veh[0], dd = ln.len + l2.len - g.s;
        if (dd < d) { d = dd; f = g; }
      }
    }
    if (!f || f === v || d > 1.7 || f.crashed) continue;
    let fb = null;
    for (const e of f.ahead) if (e.seg.type === 'box' && e.seg.node === n) { fb = e.seg; break; }
    if (!fb) fb = n.moves.find((b) => b.inLane === ln && b.outSide === ln.dir) || null;
    if (fb && !fb.turn && n.conf[fb.mi * m + box.mi]) return true;
  }
  return false;
}

function laneTurnCap(S, v, base) {
  const seg = v.seg;
  let cap = Infinity;
  if (seg.type !== 'lane') return cap;
  const p = v.prev;
  if (p && p.type === 'lane' && p.dir !== seg.dir && v.s < C_BLEND) cap = base * (p.dir === opp(seg.dir) ? 0.35 : TURN_F);
  const e = aheadEntry(S, v, 0);
  if (e) {
    const nx = e.seg;
    let tv = -1, dist = 0;
    if (nx.type === 'lane' && nx.dir !== seg.dir) { tv = base * (nx.dir === opp(seg.dir) ? 0.35 : TURN_F); dist = seg.len - C_BLEND - v.s; }
    else if (nx.type === 'box' && (nx.turn || nx.round)) { tv = nx.speed; dist = seg.len - v.s; }
    if (tv >= 0) cap = Math.min(cap, Math.sqrt(tv * tv + DECEL * Math.max(0, dist)));
  }
  return cap;
}

function segSpeed(v, seg) {
  let sp = seg.speed;
  if (v.kind === 'tram') sp = Math.min(sp, VEH.tram.max);
  return sp;
}

function stepVehicle(S, v, dt) {
  if (v.crashed > 0) {
    v.crashed -= dt; v.v = 0;
    if (v.crashed <= 0) { despawn(S, v); if (v.kind === 'car' && S.mode !== 'signal') carAbort(S, v); }
    return;
  }
  if (v.dwell > 0) {
    v.dwell -= dt; v.v = 0;
    if (v.dwell <= 0) finishDwell(S, v);
    return;
  }
  const seg = v.seg;
  const base = segSpeed(v, seg);
  const vmax = Math.min(base, laneTurnCap(S, v, base));
  const gap = obstacleAhead(S, v) - MIN_GAP;
  const vs = gap > 0 ? Math.sqrt(2 * DECEL * gap) : 0;
  const target = Math.min(vmax, vs);
  v.v = v.v < target ? Math.min(target, v.v + ACCEL * dt) : target;
  const ds = Math.min(v.v * dt, Math.max(0, gap));
  if (ds > 0) advance(S, v, ds);
  if (!v.active) return;
  if (v.v < 0.03) v.wait += dt;
  else if (v.v > 0.2) v.wait = Math.max(0, v.wait - dt * 3);
  if (v.occs.length) releaseCleared(v);
  if (v.kind === 'train') markCrossings(S, v);
  if (v.kind === 'car' && S.mode !== 'signal') carStuck(S, v, dt);
}

function markCrossings(S, v) {
  for (let i = v.pi; i < Math.min(v.path.length, v.pi + 4); i++) {
    const n = S.nodes[v.path[i]];
    if (n && n.cross) n.trainT = S.tick;
  }
}

function carStuck(S, v, dt) {
  if (v.wait > 7 && S.time - v.rerouteT > 7 && !v.grant && v.seg.type === 'lane') {
    v.rerouteT = S.time;
    const target = v.path[v.path.length - 1];
    const p = findPath(S, v.seg.to, target, 'car');
    if (p) { v.path = p; v.pi = 0; resetAhead(v); }
  }
  if (v.wait > 45) {
    // tow it home so the city never locks up for good
    despawn(S, v);
    carAbort(S, v);
  }
}

function advance(S, v, ds) {
  v.s += ds; v.odo += ds;
  let guard = 0;
  while (v.s >= v.seg.len - 1e-9 && guard++ < 8) {
    const seg = v.seg;
    const e = aheadEntry(S, v, 0);
    if (!e) { v.s = seg.len; handleEnd(S, v); return; }
    const nx = e.seg;
    if (nx.type === 'box' && !(v.grant === nx.node && v.grantBox === nx)) { v.s = seg.len; return; }
    const over = v.s - seg.len;
    const ix = seg.veh.indexOf(v);
    if (ix >= 0) seg.veh.splice(ix, 1);
    seg.tailVeh = v; seg.tailEp = v.epoch; seg.tailOdo = v.odo - over;
    v.hist.unshift(seg);
    if (v.hist.length > 8) v.hist.pop();
    v.prev = seg;
    v.ahead.shift();
    v.seg = nx; v.pi = e.pi; v.s = over;
    nx.veh.push(v);
    if (nx.type === 'box') { v.grant = null; v.grantBox = null; }
    else if (v.served >= 0 && nx.from !== v.served) v.served = -1;
  }
}

function handleEnd(S, v) {
  const seg = v.seg;
  const at = seg.type === 'lane' ? seg.to : -1;
  if (v.kind === 'car') {
    if (S.mode === 'signal') { exitPortal(S, v); return; }
    if (v.lost || v.broken) { despawn(S, v); carAbort(S, v); return; }
    if (at === v.path[v.path.length - 1]) { carArrive(S, v); return; }
    replan(S, v);
    return;
  }
  if (S.mode === 'signal' && at === v.path[v.path.length - 1]) { exitPortal(S, v); return; }
  if (v.broken) { orphan(S, v); return; }
  // transit: dwell at a stop, or turn around at the end of the line
  if (v.line && v.line.stopSet.has(at) && v.served !== at) { startDwell(S, v, at); return; }
  if (at === v.path[v.path.length - 1]) { turnAround(S, v); return; }
}

function replan(S, v) {
  const from = v.seg.type === 'lane' ? v.seg.to : v.seg.outLane.to;
  const p = findPath(S, from, v.path[v.path.length - 1], 'car');
  resetAhead(v);
  if (!p) { v.lost = true; v.path = [from]; v.pi = 0; if (v.seg.type !== 'lane') v.path = [v.seg.node.key, from]; return; }
  if (v.seg.type === 'lane') { v.path = p; v.pi = 0; }
  else { v.path = [v.seg.node.key, ...p]; v.pi = 0; }
}

function validateRoute(S, v) {
  v.broken = false;
  const cur = v.seg.type === 'lane' ? v.seg.to : v.seg.outLane.to;
  const pi = v.seg.type === 'lane' ? v.pi : v.pi + 1;
  let ok = v.path && v.path[pi] === cur;
  if (ok) for (let i = pi; i < v.path.length - 1; i++) {
    const N = S.nodes[v.path[i]];
    const L = N && linkTo(S, N, v.path[i + 1]);
    if (!L || !L.car) { ok = false; break; }
  }
  if (!ok) replan(S, v);
}

function validateLine(S, line) {
  let ok = true;
  for (let i = 0; i < line.path.length - 1; i++) {
    const N = S.nodes[line.path[i]];
    const L = N && linkTo(S, N, line.path[i + 1]);
    if (!L || !canUse(L, line.kind === 'tram' ? 'tram' : 'rail')) { ok = false; break; }
  }
  if (ok) { for (const v of line.veh) v.broken = false; return; }
  const path = findTrackPath(S, line.stops, line.kind === 'tram' ? 'tram' : 'rail');
  if (!path) { deleteLine(S, line, 'its track was cut'); return; }
  line.path = path;
  for (const v of line.veh.slice()) orphan(S, v);
  trySpawnLineVehicles(S, line);
}

// ------------------------------------------------------------------ cars at buildings
function carArrive(S, v) {
  despawn(S, v);
  if (v.state === 'out' && v.dest && S.dests.includes(v.dest)) {
    const d = v.dest;
    v.state = 'parked'; v.park = 2.4; v.tries = 0;
    d.parked.push(v);
    fulfill(S, d, false, d.lot.x, d.lot.y);
  } else { v.state = 'home'; v.dest = null; }
}

function fulfill(S, d, transit, x, y) {
  d.pins = Math.max(0, d.pins - 1);
  d.enroute = Math.max(0, d.enroute - 1);
  d.served++;
  S.trips++;
  const pay = transit ? TRANSIT_PAY : TRIP_PAY;
  if (S.income && !S.sandbox) S.money += pay;
  ev(S, { t: 'trip', x, y, color: d.color, pay: S.income ? pay : 0, transit });
}

function parkedStep(S, dt) {
  for (const d of S.dests) {
    for (const c of d.parked.slice()) {
      c.park -= dt;
      if (c.park > 0) continue;
      const path = findPath(S, d.lotKey, c.home.key, 'car');
      if (!path) {
        c.tries++;
        c.park = 2;
        if (c.tries > 2) { d.parked = d.parked.filter((x) => x !== c); c.state = 'home'; c.dest = null; }
        continue;
      }
      const ln = firstLane(S, path);
      if (!ln || laneRearFree(ln) < c.len + MIN_GAP) { c.park = 0.4; continue; }
      d.parked = d.parked.filter((x) => x !== c);
      placeOn(S, c, ln, c.len);
      c.path = path; c.pi = 1; c.state = 'back';
    }
  }
}

function launchCar(S, f, d) {
  const c = f.car;
  const ln = firstLane(S, f.path);
  placeOn(S, c, ln, c.len);
  c.path = f.path; c.pi = 1; c.state = 'out'; c.dest = d; c.lost = false; c.broken = false;
  d.enroute++;
}

// ------------------------------------------------------------------ transit
function startDwell(S, v, at) {
  const st = S.stops.get(at);
  v.served = at;
  let moved = 0;
  if (st) {
    const keep = [];
    for (const p of v.pax) {
      if (p.to === at) { if (S.dests.includes(p.dest)) fulfill(S, p.dest, true, st.x, st.y); moved++; }
      else keep.push(p);
    }
    v.pax = keep;
    const cap = VEH[v.kind].cap;
    st.wait = st.wait.filter((p) => {
      if (p.line === v.line && v.pax.length < cap) { v.pax.push(p); moved++; return false; }
      return true;
    });
    ev(S, { t: v.kind === 'tram' ? 'bell' : 'horn', x: st.x, y: st.y });
  }
  v.dwell = moved ? 2.2 : 1.1;
}

function finishDwell(S, v) {
  resetAhead(v);
  const at = v.seg.type === 'lane' ? v.seg.to : -1;
  if (at === v.path[v.path.length - 1] && !v.loop) turnAround(S, v);
}

function reverseSeg(S, seg) {
  if (seg.type === 'lane') return S.lanes.get(seg.link.id * 4 + (1 - seg.f) * 2 + 0) || null;
  const ri = reverseSeg(S, seg.outLane), ro = reverseSeg(S, seg.inLane);
  return ri && ro ? S.boxes.get(ri.key + '>' + ro.key) || null : null;
}

// ping-pong lines: the back of the vehicle becomes its front
function turnAround(S, v) {
  if (v.loop) return;
  const segs = [v.seg, ...v.hist];
  let i = 0, pos = v.s, rem = v.len;
  while (rem > pos && i < segs.length - 1) { rem -= pos; i++; pos = segs[i].len; }
  const tailSeg = segs[i];
  const tailS = Math.max(0, pos - rem);
  const rs = reverseSeg(S, tailSeg);
  const newPath = v.path.slice().reverse();
  if (!rs) { v.dwell = 0.6; return; }
  const hist = [];
  for (let k = i - 1; k >= 0; k--) { const r = reverseSeg(S, segs[k]); if (!r) break; hist.push(r); }
  // all segments the body will occupy must be clear of others
  for (const s2 of [rs, ...hist]) if (s2.veh.some((o) => o !== v)) { v.dwell = 0.6; return; }
  const nodeAt = rs.type === 'lane' ? rs.to : rs.node.key;
  const pi = newPath.indexOf(nodeAt);
  if (pi < 0) { v.dwell = 0.6; return; }
  removeFromSeg(v);
  releaseAll(v);
  v.grant = null; v.grantBox = null; v.grantRec = null;
  v.seg = rs; v.s = Math.max(0.01, rs.len - tailS);
  let j = rs.veh.length;
  while (j > 0 && rs.veh[j - 1].s < v.s) j--;
  rs.veh.splice(j, 0, v);
  if (rs.type === 'box') occAdd(rs.node, v, rs, v.odo - v.s);
  v.hist = hist;
  v.prev = v.hist[0] || null;
  v.path = newPath; v.pi = pi; v.ahead = [];
  v.fwd = !v.fwd;
  v.epoch++;
}

function updateTransit(S) {
  S.transitDirty = false;
  for (const d of S.dests) d.transit = [];
  for (const line of S.lines) {
    const r = line.kind === 'tram' ? 2 : 3;
    const info = [];
    for (const k of line.stopSet) {
      const st = S.stops.get(k);
      if (!st) continue;
      const colors = new Set();
      for (const h of S.houses) if (Math.max(Math.abs(h.x - st.x), Math.abs(h.y - st.y)) <= r) colors.add(h.color);
      const ds = S.dests.filter((d) => Math.max(Math.abs(d.x + 0.5 - st.x), Math.abs(d.y + 0.5 - st.y)) <= r + 0.5);
      info.push({ k, colors, ds });
    }
    for (const a of info) for (const d of a.ds) for (const b of info) {
      if (b.k !== a.k && b.colors.has(d.color)) d.transit.push({ line, from: b.k, to: a.k });
    }
  }
}

// ------------------------------------------------------------------ city: demand, dispatch, growth
function demandRate(S, d) {
  const h = hourOf(S);
  const rush = S.mode === 'puzzle' ? 1 : (h >= 7 && h < 9.5) || (h >= 16 && h < 18.5) ? 1.6 : h >= 22 || h < 5 ? 0.45 : 1;
  const day = (S.time - S.t0) / DAY;
  const young = d.age < 25 ? 0.4 : 1;
  const base = S.level ? S.level.rate : 0.1;
  return base * rush * (1 + (S.level ? 0 : 0.11 * day)) * young;
}

function dispatch(S) {
  if (S.transitDirty) updateTransit(S);
  const order = S.dests.slice().sort((a, b) => b.over - a.over || (b.pins - b.enroute) - (a.pins - a.enroute));
  for (const d of order) {
    let need = Math.min(d.pins - d.enroute, 3);
    if (need <= 0) continue;
    const opts = d.transit;
    let carsWanted = need;
    if (opts.length) {
      for (let k = 0; k < need; k++) {
        if (S.rng() < 0.55) {
          const o = opts[(S.rng() * opts.length) | 0];
          const st = S.stops.get(o.from);
          if (st && st.wait.length < 24) { st.wait.push({ dest: d, line: o.line, to: o.to }); d.enroute++; carsWanted--; }
        }
      }
    }
    if (carsWanted <= 0) continue;
    const found = searchHouses(S, d, carsWanted);
    for (const f of found) launchCar(S, f, d);
    // no car could go: let transit take them if it can
    if (found.length < carsWanted && opts.length) {
      for (let k = found.length; k < carsWanted; k++) {
        const o = opts[(S.rng() * opts.length) | 0];
        const st = S.stops.get(o.from);
        if (st && st.wait.length < 24) { st.wait.push({ dest: d, line: o.line, to: o.to }); d.enroute++; }
      }
    }
  }
}

function cityStep(S, dt) {
  const prevDay = Math.floor((S.time - dt) / DAY);
  for (const d of S.dests) {
    d.age += dt;
    d.acc += dt * demandRate(S, d);
    while (d.acc >= 1) { d.acc -= 1; if (d.pins < PIN_CAP + 3) d.pins++; }
    if (d.pins >= PIN_CAP) d.over += dt;
    else d.over = Math.max(0, d.over - dt * 0.6);
    if (S.fail && !S.sandbox && d.over >= OVER_T && !S.gameOver) {
      S.gameOver = { reason: `The ${DISTRICTS[d.color].place.toLowerCase()} gave up waiting`, dest: d.id };
      ev(S, { t: 'over' });
    }
  }
  S.timers.dispatch -= dt;
  if (S.timers.dispatch <= 0) { S.timers.dispatch = 0.5; dispatch(S); }
  parkedStep(S, dt);
  for (const line of S.lines) if (line.pending > 0 && S.tick % 30 === 0) trySpawnLineVehicles(S, line);
  if (S.mode === 'city' && S.grow) growth(S, dt);
  if (Math.floor(S.time / DAY) > prevDay && S.mode === 'city') {
    const upkeep = S.sandbox ? 0 : Math.round(S.netValue * 0.02);
    S.money -= upkeep;
    ev(S, { t: 'day', day: dayOf(S) - Math.floor(S.t0 / DAY) + 1, upkeep });
  }
}

function growth(S, dt) {
  const T = S.timers;
  const day = (S.time - S.t0) / DAY;
  while (S.colors.length < 6 && day >= COLOR_DAYS[S.colors.length]) {
    const c = S.colorOrder.find((k) => !S.colors.includes(k));
    S.colors.push(c);
    if (S.colors.length > 2) { const d = spawnDest(S, c); ev(S, { t: 'newColor', color: c, x: d && d.x, y: d && d.y }); }
  }
  while (T.exp < EXPAND_DAYS.length && day >= EXPAND_DAYS[T.exp]) { T.exp++; expand(S, 2); }
  T.dest -= dt;
  if (T.dest <= 0) {
    T.dest = Math.max(45, 72 - day * 3);
    const d = spawnDest(S, pickDestColor(S));
    if (d) ev(S, { t: 'newDest', color: d.color, x: d.x, y: d.y });
  }
  T.house -= dt;
  if (T.house <= 0) {
    T.house = Math.max(2.2, 6.5 - 0.4 * day);
    spawnHouse(S, pickHouseColor(S));
  }
}

export function expand(S, by) {
  const b = S.bounds;
  b.x0 = Math.max(0, b.x0 - by); b.y0 = Math.max(0, b.y0 - Math.ceil(by * 0.75));
  b.x1 = Math.min(S.W - 1, b.x1 + by); b.y1 = Math.min(S.H - 1, b.y1 + Math.ceil(by * 0.75));
  S.boundsV++;
  ev(S, { t: 'expand' });
}

function pickHouseColor(S) {
  let best = S.colors[0], bw = -1;
  for (const c of S.colors) {
    const nd = S.dests.filter((d) => d.color === c).length;
    const nh = S.houses.filter((h) => h.color === c).length;
    const w = (nd * 3 + 0.5) / (nh + 1) * (0.6 + S.rng() * 0.8);
    if (w > bw) { bw = w; best = c; }
  }
  return best;
}
function pickDestColor(S) {
  let best = S.colors[0], bw = -1;
  for (const c of S.colors) {
    const nd = S.dests.filter((d) => d.color === c).length;
    const nh = S.houses.filter((h) => h.color === c).length;
    const w = (nh + 2) / (nd + 1) * (0.5 + S.rng());
    if (w > bw) { bw = w; best = c; }
  }
  return best;
}

export function spawnHouse(S, color) {
  const anchors = [...S.dests.filter((d) => d.color === color), ...S.houses.filter((h) => h.color === color)];
  if (!anchors.length) anchors.push({ x: (S.bounds.x0 + S.bounds.x1) / 2, y: (S.bounds.y0 + S.bounds.y1) / 2 });
  const blocked = new Set();
  for (const d of S.dests) for (const k of lotSides(d)) blocked.add((d.lot.y + DIRS[k][1]) * S.W + d.lot.x + DIRS[k][0]);
  let best = null, bs = -Infinity;
  for (let tries = 0; tries < 80; tries++) {
    const a = anchors[(S.rng() * anchors.length) | 0];
    const r = 1 + S.rng() * 5;
    const ang = S.rng() * TAU;
    const x = Math.round(a.x + Math.cos(ang) * r), y = Math.round(a.y + Math.sin(ang) * r);
    if (!tileFree(S, x, y) || blocked.has(y * S.W + x)) continue;
    let freeN = 0, sameN = 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(S, nx, ny)) continue;
      const t = ny * S.W + nx;
      const N = S.nodes[S.WH + t];
      if (tileFree(S, nx, ny) || (N && !N.term && S.terrain[t] !== TER.MOUNTAIN)) freeN++;
      const b = S.bld[t] >= 0 ? S.bmap.get(S.bld[t]) : null;
      if (b && b.type === 'house' && b.color === color) sameN++;
    }
    if (!freeN) continue;
    let dd = Infinity;
    for (const d of S.dests) dd = Math.min(dd, Math.abs(d.x + 0.5 - x) + Math.abs(d.y + 0.5 - y));
    const score = sameN * 1.5 + freeN * 0.3 - Math.abs(dd - 5) * 0.4 + S.rng();
    if (score > bs) { bs = score; best = { x, y }; }
  }
  if (!best) return null;
  const h = addHouse(S, best.x, best.y, color);
  ev(S, { t: 'newHouse', x: best.x, y: best.y, color });
  return h;
}

export function destSpotOk(S, x, y, lotIdx) {
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (!tileFree(S, x + dx, y + dy)) return null;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const order = lotIdx == null ? [0, 1, 2, 3] : [lotIdx];
  for (const ci of order) {
    const lot = { x: x + corners[ci][0], y: y + corners[ci][1] };
    const fake = { x, y, lot };
    const ok = lotSides(fake).some((k) => {
      const nx = lot.x + DIRS[k][0], ny = lot.y + DIRS[k][1];
      return tileFree(S, nx, ny) || (inMap(S, nx, ny) && S.nodes[S.WH + ny * S.W + nx] && !S.nodes[S.WH + ny * S.W + nx].term);
    });
    if (ok) return lot;
  }
  return null;
}

export function spawnDest(S, color) {
  const b = S.bounds;
  let best = null, bs = -Infinity;
  for (let tries = 0; tries < 160; tries++) {
    const x = b.x0 + 1 + Math.floor(S.rng() * Math.max(1, b.x1 - b.x0 - 2));
    const y = b.y0 + 1 + Math.floor(S.rng() * Math.max(1, b.y1 - b.y0 - 2));
    const lot = destSpotOk(S, x, y, Math.floor(S.rng() * 4));
    if (!lot) continue;
    let near = 12;
    for (const d of S.dests) near = Math.min(near, Math.hypot(d.x - x, d.y - y));
    if (near < 4.5) continue;
    let hn = 0;
    for (const h of S.houses) if (Math.abs(h.x - x) + Math.abs(h.y - y) < 3) hn++;
    const score = -Math.abs(near - 8) * 0.5 - hn + S.rng() * 2;
    if (score > bs) { bs = score; best = { x, y, lot }; }
  }
  if (!best) return null;
  return addDest(S, best.x, best.y, best.lot, color);
}

// ------------------------------------------------------------------ city creation
export function createCity(def, opts = {}) {
  const { terrain, trees } = def.gen();
  const sandbox = !!opts.sandbox;
  const S = createState({
    W: def.W, H: def.H, terrain, trees, mode: 'city', mapId: def.id, seed: opts.seed ?? def.seed,
    money: def.money ?? 1500, sandbox, grow: opts.grow !== false, fail: !sandbox,
  });
  const sw = Math.min(def.W, def.start?.w ?? 16), sh = Math.min(def.H, def.start?.h ?? 11);
  const x0 = Math.floor((def.W - sw) / 2), y0 = Math.floor((def.H - sh) / 2);
  S.bounds = sandbox && opts.open ? { x0: 0, y0: 0, x1: def.W - 1, y1: def.H - 1 } : { x0, y0, x1: x0 + sw - 1, y1: y0 + sh - 1 };
  // colour order is shuffled per seed
  const ord = [0, 1, 2, 3, 4, 5];
  for (let i = 5; i > 0; i--) { const j = Math.floor(S.rng() * (i + 1)); [ord[i], ord[j]] = [ord[j], ord[i]]; }
  S.colorOrder = ord;
  S.colors = [ord[0], ord[1]];
  if (opts.empty) { rebuildNet(S); return S; }
  for (const c of S.colors) {
    const d = spawnDest(S, c);
    if (d) for (let i = 0; i < 2; i++) spawnHouse(S, c);
  }
  rebuildNet(S);
  S.events = [];
  return S;
}

// ------------------------------------------------------------------ road puzzles
// ascii legend: . grass, ~ water, ^ mountain, t tree, a-f house of colour 0-5, = road
export function createPuzzle(P) {
  const rows = P.map;
  const H = rows.length, W = rows[0].length;
  const terrain = new Uint8Array(W * H), trees = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = rows[y][x];
    if (ch === '~') terrain[y * W + x] = TER.WATER;
    else if (ch === '^') terrain[y * W + x] = TER.MOUNTAIN;
    else if (ch === 't') trees[y * W + x] = 1;
  }
  const S = createState({ W, H, terrain, trees, mode: 'puzzle', seed: P.seed || 3, money: P.budget, income: false, grow: false });
  S.level = P;
  S.time = P.startHour != null ? (P.startHour / 24) * DAY : DAY * 0.3;
  S.t0 = S.time;
  for (const [x, y, lx, ly, c] of P.dests) addDest(S, x, y, { x: lx, y: ly }, c);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = rows[y][x];
    if (ch >= 'a' && ch <= 'f') addHouse(S, x, y, ch.charCodeAt(0) - 97);
  }
  S.colors = [...new Set([...S.houses.map((h) => h.color), ...S.dests.map((d) => d.color)])];
  // pre-built pieces: '=' road, 'M' motorway, 'R' railway join neighbours with the same symbol;
  // roads also join houses next to them
  const KCH = { '=': 'road', M: 'motorway', R: 'rail' };
  const isHouse = (ch) => ch >= 'a' && ch <= 'f';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = rows[y][x];
    const kind = KCH[ch];
    if (!kind) continue;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (!inMap(S, nx, ny)) continue;
      const c2 = rows[ny][nx];
      const join = (d < 2 && c2 === ch) || (kind === 'road' && isHouse(c2));
      if (join) addLink(S, nkey(S, x, y), nkey(S, nx, ny), d, kind, false, 0);
    }
  }
  for (const [x, y, nx, ny] of P.joins || []) addLink(S, nkey(S, x, y), nkey(S, nx, ny), dirBetween(x, y, nx, ny), 'road', false, 0);
  S.tools = P.tools || null;
  S.goal = P.goal;
  S.timeLimit = P.time || null;
  rebuildNet(S);
  for (const d of S.dests) d.age = 30;
  return S;
}

// ------------------------------------------------------------------ signal (traffic light) levels
export function createSignalLevel(L) {
  const S = createState({ W: L.W, H: L.H, mode: 'signal', seed: L.seed || 11, money: 0, income: false, grow: false });
  S.reckless = true; S.sandbox = true; S.fail = false;
  S.level = L;
  const run = ([x0, y0, x1, y1], kind) => {
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    while (x !== x1 || y !== y1) {
      const nx = x + dx, ny = y + dy;
      const a = nkey(S, x, y), b = nkey(S, nx, ny);
      const d = dirBetween(x, y, nx, ny);
      const NA = S.nodes[a];
      const ex = NA && NA.dirs[d] >= 0 ? S.links.get(NA.dirs[d]) : null;
      if (ex) { if (kind === 'tram' && ex.kind === 'road') { ex.tram = true; setCaps(ex); } }
      else addLink(S, a, b, d, kind, false, 0);
      x = nx; y = ny;
    }
  };
  for (const r of L.roads || []) run(r, 'road');
  for (const r of L.trams || []) run(r, 'tram');
  for (const r of L.rails || []) run(r, 'rail');
  S.portals = [];
  for (const n of S.nodes) {
    if (!n) continue;
    const edge = n.x === 0 || n.y === 0 || n.x === S.W - 1 || n.y === S.H - 1;
    const ds = [0, 1, 2, 3].filter((d) => n.dirs[d] >= 0);
    if (edge && ds.length === 1) {
      n.term = true; n.portal = true;
      const Lk = S.links.get(n.dirs[ds[0]]);
      S.portals.push({ key: n.key, car: Lk.car, tram: Lk.trm, rail: Lk.rl, x: n.x, y: n.y });
    }
  }
  rebuildNet(S);
  for (const n of S.junctions) {
    n.sig = [null, null, null, null];
    n.tok = [0, 0, 0, 0];
    for (const ln of n.inL) if (!ln.rl) n.sig[opp(ln.dir)] = 'r';
  }
  S.passed = 0; S.strikes = 0; S.spawned = 0;
  S.spawnT = 1.2; S.tramT = L.tramEvery ? 5 : Infinity; S.trainT = L.trainEvery ? L.trainEvery * 0.6 : Infinity;
  S.trainWarn = 0;
  S.result = null;
  S.elapsed = 0;
  return S;
}

// tap a light: red -> yellow (lets one vehicle through) -> green -> red
export function tapSignal(S, key, side) {
  const n = S.nodes[key];
  if (!n || !n.sig || n.sig[side] == null) return null;
  const st = n.sig[side];
  if (st === 'r') { n.sig[side] = 'y'; n.tok[side] = 1; n.yT = n.yT || [0, 0, 0, 0]; n.yT[side] = 2.5; }
  else if (st === 'y') { n.sig[side] = 'g'; n.tok[side] = 0; }
  else { n.sig[side] = 'r'; n.tok[side] = 0; }
  return n.sig[side];
}

function spawnSignal(S, kind) {
  const mode = kind === 'car' ? 'car' : kind === 'tram' ? 'tram' : 'rail';
  const ports = S.portals.filter((p) => p[mode === 'rail' ? 'rail' : mode]);
  if (ports.length < 2) return false;
  const a = ports[(S.rng() * ports.length) | 0];
  const others = ports.filter((p) => p !== a && (kind !== 'car' || p.x !== a.x || p.y !== a.y));
  for (let k = others.length - 1; k > 0; k--) { const j = (S.rng() * (k + 1)) | 0; [others[k], others[j]] = [others[j], others[k]]; }
  if (S.rng() < 0.55) {
    const st = others.findIndex((p) => (a.x === 0 && p.x === S.W - 1 && p.y === a.y) || (a.x === S.W - 1 && p.x === 0 && p.y === a.y) || (a.y === 0 && p.y === S.H - 1 && p.x === a.x) || (a.y === S.H - 1 && p.y === 0 && p.x === a.x));
    if (st > 0) others.unshift(others.splice(st, 1)[0]);
  }
  for (const b of others) {
    const path = findPath(S, a.key, b.key, mode);
    if (!path) continue;
    let v;
    if (kind === 'car') {
      v = mkCar(S, null);
      v.color = (S.rng() * 6) | 0;
      v.state = 'out';
    } else v = mkTransit(S, { kind: kind === 'tram' ? 'tram' : 'train', path, loop: false, stopSet: new Set(), veh: [] });
    v.line = null;
    if (kind === 'car') {
      const ln = firstLane(S, path);
      if (!ln || laneRearFree(ln) < v.len + MIN_GAP) return false;
      placeOn(S, v, ln, v.len);
      v.path = path; v.pi = 1;
    } else if (!spawnAlong(S, v, path, mode)) return false;
    S.spawned++;
    return true;
  }
  return false;
}

function exitPortal(S, v) {
  despawn(S, v);
  if (v.kind !== 'train') S.passed++;
  ev(S, { t: 'pass', kind: v.kind });
}

function strike(S, why, x, y) {
  S.strikes++;
  ev(S, { t: why, x, y });
  if (S.strikes >= (S.level.strikes || 3) && !S.result) { S.result = 'lose'; ev(S, { t: 'lose' }); }
}

function bodyPoints(S, v, out) {
  const n = Math.max(2, Math.ceil(v.len / 0.1) + 1);
  for (let i = 0; i < n; i++) {
    const p = vehPose(S, v, (v.len * i) / (n - 1), {});
    out.push(p.x, p.z, p.y, p.hx, p.hz);
  }
}

function crashCheck(S) {
  const vs = S.vehicles.filter((v) => v.active && !v.crashed);
  const pts = vs.map((v) => { const a = []; bodyPoints(S, v, a); return a; });
  for (let i = 0; i < vs.length; i++) for (let k = i + 1; k < vs.length; k++) {
    const A = vs[i], B = vs[k];
    if (A.crashed || B.crashed) continue;
    if (A.lead === B || B.lead === A) continue;
    if ((A.lead2 === B && S.time - A.lead2T < 2.5) || (B.lead2 === A && S.time - B.lead2T < 2.5)) continue;
    const pa = pts[i], pb = pts[k];
    // quick reject on front points
    if (Math.abs(pa[0] - pb[0]) > 3 || Math.abs(pa[1] - pb[1]) > 3) continue;
    let hit = false, hx = 0, hz = 0;
    for (let a = 0; a < pa.length && !hit; a += 5) for (let b = 0; b < pb.length; b += 5) {
      if (Math.abs(pa[a + 2] - pb[b + 2]) > 0.2) continue;
      const dx = pa[a] - pb[b], dz = pa[a + 1] - pb[b + 1];
      if (dx * dx + dz * dz < 0.11 * 0.11) {
        const dot = pa[a + 3] * pb[b + 3] + pa[a + 4] * pb[b + 4];
        if (dot < 0.9) { hit = true; hx = pa[a]; hz = pa[a + 1]; break; }
      }
    }
    if (!hit) continue;
    if (A.kind !== 'train') A.crashed = 2.2;
    if (B.kind !== 'train') B.crashed = 2.2;
    if (A.kind === 'train' || B.kind === 'train') { (A.kind === 'train' ? B : A).crashed = 0.6; }
    if (S.debugCrash) {
      const d = (v) => v.kind + '#' + v.id + ' ' + (v.seg.type === 'box' ? 'box ' + v.seg.inSide + '>' + v.seg.outSide + '@' + v.seg.node.x + ',' + v.seg.node.y : 'lane d' + v.seg.dir + ' s' + v.s.toFixed(2) + '/' + v.seg.len.toFixed(2)) + ' lead:' + (v.lead && v.lead.id) + '/' + (v.lead2 && v.lead2.id);
      S.debugCrash.push(d(A) + ' X ' + d(B) + ' sig ' + S.junctions.map((n) => n.sig.join('')).join(' '));
    }
    strike(S, 'crash', hx, hz);
  }
}

function signalStep(S, dt) {
  const L = S.level;
  S.elapsed += dt;
  const prog = Math.min(1, S.passed / L.goal);
  S.spawnT -= dt;
  if (S.spawnT <= 0) {
    const iv = L.rate * (1 - 0.35 * prog);
    S.spawnT = iv * (0.6 + S.rng() * 0.8);
    spawnSignal(S, 'car');
  }
  S.tramT -= dt;
  if (S.tramT <= 0) { S.tramT = L.tramEvery * (0.8 + S.rng() * 0.4); spawnSignal(S, 'tram'); }
  S.trainT -= dt;
  S.trainWarn = S.trainT < 3.5 && S.trainT > 0 ? 1 : 0;
  if (S.trainT <= 0) { S.trainT = L.trainEvery * (0.85 + S.rng() * 0.3); if (spawnSignal(S, 'train')) ev(S, { t: 'horn' }); }
  for (const n of S.junctions) {
    if (!n.yT) continue;
    for (let s = 0; s < 4; s++) if (n.sig[s] === 'y') { n.yT[s] -= dt; if (n.yT[s] <= 0) { n.sig[s] = 'r'; n.tok[s] = 0; } }
  }
  const patience = L.patience || 14;
  for (const v of S.vehicles) {
    if (!v.active || v.crashed || v.kind === 'train') continue;
    if (v.v < 0.03) v.mood = (v.mood || 0) + dt; else v.mood = Math.max(0, (v.mood || 0) - dt * 0.5);
    if (v.mood > patience) {
      const p = vehPose(S, v, 0, {});
      despawn(S, v);
      strike(S, 'gaveup', p.x, p.z);
    }
  }
  crashCheck(S);
  if (!S.result && S.passed >= L.goal) { S.result = 'win'; ev(S, { t: 'win' }); }
}

// ------------------------------------------------------------------ main step
export function step(S, dt) {
  if (S.gameOver || S.result) return;
  S.tick++;
  S.time += dt;
  for (const n of S.junctions) arbitrate(S, n, dt);
  const vs = S.vehicles;
  for (let i = 0; i < vs.length; i++) { const v = vs[i]; if (v.active) stepVehicle(S, v, dt); }
  let w = 0;
  for (let i = 0; i < vs.length; i++) if (vs[i].active) vs[w++] = vs[i];
  vs.length = w;
  if (S.mode === 'signal') signalStep(S, dt);
  else {
    cityStep(S, dt);
    if (S.mode === 'puzzle') puzzleStep(S, dt);
  }
}

function puzzleStep(S) {
  if (S.result) return;
  if (S.trips >= S.goal) { S.result = 'win'; ev(S, { t: 'win' }); return; }
  if (S.timeLimit && S.time - S.t0 >= S.timeLimit) { S.result = 'lose'; S.gameOver = { reason: 'Out of time' }; ev(S, { t: 'lose' }); }
  if (S.gameOver && !S.result) S.result = 'lose';
}

export function simulate(S, seconds, dt = 1 / 30) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) step(S, dt);
}

export function puzzleStars(S) {
  const P = S.level;
  if (S.result !== 'win') return 0;
  const spent = P.budget - S.money;
  if (spent <= P.par) return 3;
  if (spent <= P.par * 1.35) return 2;
  return 1;
}
export function signalStars(S) {
  if (S.result !== 'win') return 0;
  return Math.max(1, 3 - S.strikes);
}

// ------------------------------------------------------------------ poses (shared with the renderer)
export function rampY(hA, hB, u) {
  if (hA === hB) return hA;
  if (hA === 0 && hB < 0) { const t = clamp((u - 0.4) / 0.6, 0, 1); return hB * t * t * (3 - 2 * t); }
  if (hA < 0 && hB === 0) { const t = clamp(u / 0.6, 0, 1); return hA * (1 - t * t * (3 - 2 * t)); }
  const t = clamp(u, 0, 1);
  return hA + (hB - hA) * t * t * (3 - 2 * t);
}

function lanePoint(S, L, s, out) {
  const A = S.nodes[L.from];
  const [dx, dy] = DIRS[L.dir];
  const u = L.s0 + s;
  out.x = A.x + dx * u - dy * L.off;
  out.z = A.y + dy * u + dx * L.off;
  out.y = rampY(L.hA, L.hB, u);
  out.hx = dx; out.hz = dy;
  return out;
}

function boxPoint(S, B, s, out) {
  const p = B.path, n = B.node;
  const cum = p.cum;
  s = clamp(s, 0, p.len);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / seg;
  const x0 = p.pts[(i - 1) * 2], y0 = p.pts[(i - 1) * 2 + 1], x1 = p.pts[i * 2], y1 = p.pts[i * 2 + 1];
  out.x = n.x + x0 + (x1 - x0) * t;
  out.z = n.y + y0 + (y1 - y0) * t;
  out.y = n.h;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  out.hx = (x1 - x0) / len; out.hz = (y1 - y0) / len;
  return out;
}

const _p0 = {}, _p2 = {};
function cornerPose(S, A, B, u, out) {
  lanePoint(S, A, A.len - C_BLEND, _p0);
  lanePoint(S, B, C_BLEND, _p2);
  const N = S.nodes[A.to];
  const t = clamp(u / (2 * C_BLEND), 0, 1), w = 1 - t;
  const [ax, ay] = DIRS[A.dir];
  if (B.dir === opp(A.dir)) {
    const k = 0.62;
    const c1x = _p0.x + ax * k, c1z = _p0.z + ay * k, c2x = _p2.x + ax * k, c2z = _p2.z + ay * k;
    const b0 = w * w * w, b1 = 3 * w * w * t, b2 = 3 * w * t * t, b3 = t * t * t;
    out.x = b0 * _p0.x + b1 * c1x + b2 * c2x + b3 * _p2.x;
    out.z = b0 * _p0.z + b1 * c1z + b2 * c2z + b3 * _p2.z;
    const dx = 3 * w * w * (c1x - _p0.x) + 6 * w * t * (c2x - c1x) + 3 * t * t * (_p2.x - c2x);
    const dz = 3 * w * w * (c1z - _p0.z) + 6 * w * t * (c2z - c1z) + 3 * t * t * (_p2.z - c2z);
    const l = Math.hypot(dx, dz) || 1;
    out.hx = dx / l; out.hz = dz / l;
    out.y = N.h;
    return out;
  }
  let cx, cz;
  if (ax !== 0) { cx = _p2.x; cz = _p0.z; } else { cx = _p0.x; cz = _p2.z; }
  out.x = w * w * _p0.x + 2 * w * t * cx + t * t * _p2.x;
  out.z = w * w * _p0.z + 2 * w * t * cz + t * t * _p2.z;
  out.y = w * w * _p0.y + 2 * w * t * N.h + t * t * _p2.y;
  const dx = 2 * w * (cx - _p0.x) + 2 * t * (_p2.x - cx), dz = 2 * w * (cz - _p0.z) + 2 * t * (_p2.z - cz);
  const l = Math.hypot(dx, dz) || 1;
  out.hx = dx / l; out.hz = dz / l;
  return out;
}

export function segPose(S, seg, s, prev, next, out) {
  if (seg.type === 'box') return boxPoint(S, seg, s, out);
  if (next && next.type === 'lane' && s > seg.len - C_BLEND && next.dir !== seg.dir && S.nodes[seg.to] && !S.nodes[seg.to].j) {
    return cornerPose(S, seg, next, s - (seg.len - C_BLEND), out);
  }
  if (prev && prev.type === 'lane' && s < C_BLEND && prev.dir !== seg.dir && S.nodes[seg.from] && !S.nodes[seg.from].j) {
    return cornerPose(S, prev, seg, C_BLEND + s, out);
  }
  return lanePoint(S, seg, s, out);
}

// world pose of a point `back` behind the vehicle's front
export function vehPose(S, v, back = 0, out = {}) {
  let seg = v.seg, s = v.s - back;
  const e = v.ahead[0] || (v.active ? aheadEntry(S, v, 0) : null);
  let next = e ? e.seg : null, prev = v.hist[0] || null, hi = 0;
  while (s < 0 && hi < v.hist.length) {
    next = seg; seg = v.hist[hi]; hi++; prev = v.hist[hi] || null; s += seg.len;
  }
  if (s < 0 && seg.type === 'box') s = 0;
  return segPose(S, seg, s, prev, next, out);
}

// ------------------------------------------------------------------ save / load (city & sandbox)
export function saveCity(S) {
  return {
    v: 1, map: S.mapId, sandbox: S.sandbox, grow: S.grow, seed: S.seed, rng: S.rng.get(), time: S.time, t0: S.t0,
    money: S.money, trips: S.trips, bounds: { ...S.bounds }, colors: S.colors.slice(), order: S.colorOrder.slice(),
    timers: { ...S.timers }, netValue: S.netValue,
    links: [...S.links.values()].map((L) => [L.a, L.b, L.d, L.kind, L.tram ? 1 : 0, L.value]),
    ctrl: S.nodes.filter((n) => n && n.ctrl !== 'none').map((n) => [n.key, n.ctrl]),
    houses: S.houses.map((h) => [h.x, h.y, h.color]),
    dests: S.dests.map((d) => [d.x, d.y, d.lot.x, d.lot.y, d.color, d.pins, Math.round(d.over), Math.round(d.age)]),
    stops: [...S.stops.values()].map((st) => [st.key, st.value]),
    lines: S.lines.map((l) => [l.kind, l.stops, l.veh.length + l.pending]),
  };
}

export function loadCity(def, data) {
  const S = createCity(def, { sandbox: data.sandbox, grow: data.grow, seed: data.seed, empty: true });
  S.events = [];
  S.rng.set(data.rng);
  S.time = data.time; S.t0 = data.t0; S.money = data.money; S.trips = data.trips;
  S.bounds = { ...data.bounds }; S.colors = data.colors.slice(); S.colorOrder = data.order.slice();
  S.timers = { ...S.timers, ...data.timers }; S.netValue = data.netValue || 0;
  for (const [x, y, c] of data.houses) addHouse(S, x, y, c);
  for (const [x, y, lx, ly, c, pins, over, age] of data.dests) { const d = addDest(S, x, y, { x: lx, y: ly }, c); d.pins = pins; d.over = over; d.age = age; }
  for (const [a, b, d, kind, tram, value] of data.links) addLink(S, a, b, d, kind, !!tram, value);
  for (const [k, ctrl] of data.ctrl) if (S.nodes[k]) S.nodes[k].ctrl = ctrl;
  rebuildNet(S);
  for (const [k, value] of data.stops) {
    const N = S.nodes[k];
    if (!N) continue;
    const i = keyInfo(S, k);
    const rail = N.dirs.some((id) => id >= 0 && S.links.get(id).rl);
    N.stop = { key: k, type: rail ? 'station' : 'stop', wait: [], value, x: i.x, y: i.y, lvl: i.lvl };
    S.stops.set(k, N.stop);
  }
  for (const [kind, stops, n] of data.lines) {
    const path = findTrackPath(S, stops, kind === 'tram' ? 'tram' : 'rail');
    if (!path) continue;
    const line = {
      id: S.nextLine++, kind, stops: stops.slice(), stopSet: new Set(stops), path,
      loop: stops.length > 2 && stops[0] === stops[stops.length - 1],
      color: LINE_COLORS[(S.nextLine - 2) % LINE_COLORS.length], veh: [], pending: n, ok: true,
    };
    S.lines.push(line);
    trySpawnLineVehicles(S, line);
  }
  S.transitDirty = true;
  S.bldV++; S.lineV++;
  return S;
}

// ------------------------------------------------------------------ queries for the UI
export function stats(S) {
  let driving = 0, waiting = 0, transit = 0;
  for (const v of S.vehicles) {
    if (v.kind === 'car') { driving++; if (v.wait > 3) waiting++; } else transit++;
  }
  let pax = 0;
  for (const st of S.stops.values()) pax += st.wait.length;
  return { driving, waiting, transit, pax };
}

export function junctionAt(S, x, y) {
  for (const lvl of [0, 1, -1]) {
    const n = S.nodes[nkey(S, x, y, lvl)];
    if (n && n.j) return n;
  }
  return null;
}
