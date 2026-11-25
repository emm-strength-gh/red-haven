// Kaboom Critters — match simulation. Pure logic with no three.js: a destructible terrain mask,
// physics bodies, weapons and the turn cycle. Everything is seeded, so the CPU players and the
// tests can replay a match exactly. World units: x to the right, y UP, y = 0 is the sea floor.

export const STEP = 1 / 120;
export const WORLD_H = 1000;
export const SIZES = { S: 1700, M: 2200, L: 2800 };
export const GRAVITY = 520;
export const WALK_SPEED = 56;
export const MIN_LAUNCH = 90;
export const MAX_LAUNCH = 900;
export const WIND_ACCEL = 170;
export const FALL_SAFE = 400;
export const INF = -1; // "infinite ammo" marker that survives JSON

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);

export const WEAPONS = {
  rocket: { name: 'Rocket', icon: '🚀', aim: 'power', tip: 'Fast, explodes on impact. The wind pushes it.' },
  grenade: { name: 'Grenade', icon: '💣', aim: 'power', tip: 'Bounces about and pops after 3 seconds. Ignores the wind.' },
  grapes: { name: 'Grape Shot', icon: '🍇', aim: 'power', tip: 'Bursts into five juicy exploding grapes.' },
  melon: { name: 'Mega Melon', icon: '🍉', aim: 'power', tip: 'Huge blast that sprays exploding melon slices.' },
  bee: { name: 'Buzz Bee', icon: '🐝', aim: 'power', tip: 'After a moment it locks onto the nearest enemy.' },
  blaster: { name: 'Splat Blaster', icon: '🔫', aim: 'angle', shots: 2, tip: 'Two straight shots — no gravity, no wind.' },
  bonk: { name: 'Bonk Hammer', icon: '🔨', aim: 'angle', tip: 'Whack a critter right next to you. Great for knocking foes into the water.' },
  airdrop: { name: 'Air Drop', icon: '✈️', aim: 'target', tip: 'Tap a spot, then fire — a plane drops five bombs on it.' },
  dynamite: { name: 'Dynamite', icon: '🧨', aim: 'none', retreat: 5, tip: 'Drop it and run! Massive blast after 5 seconds.' },
  mine: { name: 'Sneaky Mine', icon: '⚙️', aim: 'none', retreat: 5, tip: 'Arms after 2 seconds, then pops when a critter wanders close.' },
  teleport: { name: 'Teleport', icon: '🌀', aim: 'target', tip: 'Tap any open spot, then fire to zap your critter there.' },
  skip: { name: 'Skip Turn', icon: '💤', aim: 'none', tip: 'Have a nap and end your turn.' },
};
export const WEAPON_ORDER = Object.keys(WEAPONS);

// projectile kinds (weapons plus the pieces some of them split into)
export const PROJ = {
  rocket: { r: 3, wind: 1, impact: true, boom: [42, 46] },
  grenade: { r: 3, fuse: 3, bounce: 0.45, boom: [42, 46] },
  grapes: { r: 4, wind: 0.4, impact: true, boom: [26, 22], split: { n: 5, kind: 'grape', speed: 250 } },
  grape: { r: 3, wind: 0.4, impact: true, boom: [25, 22] },
  melon: { r: 6, fuse: 3, bounce: 0.35, boom: [54, 55], split: { n: 5, kind: 'slice', speed: 330 } },
  slice: { r: 4, impact: true, boom: [42, 42] },
  bee: { r: 3, wind: 0.3, impact: true, homing: true, boom: [40, 42] },
  bomb: { r: 4, wind: 0.5, impact: true, boom: [32, 28] },
  dynamite: { r: 4, fuse: 5, bounce: 0.12, boom: [74, 75] },
};

const CRATE_LOOT = ['grapes', 'grapes', 'melon', 'bee', 'bee', 'airdrop', 'dynamite', 'dynamite', 'mine', 'teleport'];

// ------------------------------------------------------------------ random & noise
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(i, j, s) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = smooth(x - i), fy = smooth(y - j);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm(x, y, s, oct = 4) {
  let sum = 0, amp = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { sum += amp * vnoise(x * f, y * f, s + o * 17); n += amp; amp *= 0.5; f *= 2.03; }
  return sum / n;
}

// ------------------------------------------------------------------ terrain
// mask values: 0 empty, 1 dirt, 2 steel (indestructible)
export function generateTerrain(o) {
  const W = o.W | 0, H = o.H || WORLD_H, water = o.water ?? 70, seed = (o.seed >>> 0) % 1000003;
  const m = new Uint8Array(W * H);
  const R = makeRng(seed * 13 + 5);
  const edge = (x) => smooth(clamp((x - 30) / 220, 0, 1)) * smooth(clamp((W - 30 - x) / 220, 0, 1));
  const column = (x, y0, y1, v = 1) => {
    const a = Math.max(0, Math.floor(y0)), b = Math.min(H - 1, Math.floor(y1));
    for (let y = a; y <= b; y++) m[y * W + x] = v;
  };
  const disc = (cx, cy, r, v) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
      const i = y * W + x;
      if (v === 0) { if (m[i] === 1) m[i] = 0; } else if (!m[i]) m[i] = v;
    }
  };
  const bar = (x0, x1, y, th = 12) => {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.floor(x1)); x++) {
      for (let yy = Math.floor(y - th / 2); yy < y + th / 2; yy++) if (yy >= 0 && yy < H) m[yy * W + x] = 2;
    }
  };
  const top = new Float32Array(W);
  const shape = o.shape || 'hills';

  if (shape === 'hills' || shape === 'bowl' || shape === 'towers') {
    for (let x = 0; x < W; x++) {
      let h;
      if (shape === 'hills') h = 130 + 300 * fbm(x / 430, 0.3, seed, 3) + 80 * (fbm(x / 90, 7.1, seed + 5, 2) - 0.5);
      else if (shape === 'bowl') {
        const t = Math.abs((x / W) * 2 - 1);
        h = 90 + 420 * Math.pow(t, 1.7) + 170 * Math.exp(-(((x - W / 2) / 130) ** 2)) + 70 * (fbm(x / 150, 2.2, seed, 3) - 0.5);
      } else h = 60 + 110 * fbm(x / 260, 4.4, seed, 3);
      top[x] = water - 40 + edge(x) * (h + 40);
      column(x, 0, top[x]);
    }
    if (shape === 'towers') {
      const n = Math.max(3, Math.round(W / 560));
      const tops = [];
      for (let i = 0; i < n; i++) {
        const cx = (W * (i + 0.5)) / n + (R() - 0.5) * 120;
        const hw = 34 + R() * 22;
        const ty = water + 320 + R() * 250;
        for (let y = 0; y < ty + 22; y++) {
          let w;
          if (y >= ty) w = (hw + 26) * Math.sqrt(Math.max(0, 1 - ((y - ty) / 22) ** 2));
          else w = hw + (fbm(cx / 50, y / 60, seed + i * 13, 2) - 0.5) * 30 + (y > ty - 46 ? 26 * smooth((y - (ty - 46)) / 46) : 0);
          for (let x = Math.max(0, Math.floor(cx - w)); x <= Math.min(W - 1, cx + w); x++) m[y * W + x] = 1;
          const xi = Math.round(cx);
          if (xi >= 0 && xi < W) top[xi] = Math.max(top[xi], y);
        }
        tops.push({ x: cx, y: ty + 18, hw: hw + 26 });
      }
      if (o.girders) {
        for (let i = 0; i + 1 < tops.length; i++) {
          const a = tops[i], b = tops[i + 1];
          if (Math.abs(a.y - b.y) < 130 && R() < 0.75) bar(a.x + a.hw * 0.6, b.x - b.hw * 0.6, Math.min(a.y, b.y) - 4);
        }
      }
    }
  } else if (shape === 'islands') {
    const n = Math.max(3, Math.round(W / 520));
    const isl = [];
    for (let i = 0; i < n; i++) {
      isl.push({ cx: (W * (i + 0.5)) / n + (R() - 0.5) * (W / n) * 0.25, hw: (W / n) * (0.3 + R() * 0.13), ht: 150 + R() * 190 });
    }
    for (let x = 0; x < W; x++) {
      let h = -1;
      for (let i = 0; i < n; i++) {
        const dx = (x - isl[i].cx) / isl[i].hw;
        if (Math.abs(dx) >= 1) continue;
        const k = 1 - dx * dx;
        h = Math.max(h, water - 60 + (isl[i].ht + 60) * Math.pow(k, 0.5) + 70 * (fbm(x / 110, i * 3.3, seed, 3) - 0.5) * k);
      }
      top[x] = h;
      if (h > 0) column(x, 0, h);
    }
    if (o.girders) {
      for (let i = 0; i + 1 < n; i++) {
        const a = isl[i], b = isl[i + 1];
        const y = water + Math.min(a.ht, b.ht) * 0.75;
        if (R() < 0.8) bar(a.cx + a.hw * 0.5, b.cx - b.hw * 0.5, y);
      }
    }
  } else if (shape === 'caves') {
    for (let x = 0; x < W; x++) {
      const roof = water + 560 + 70 * fbm(x / 210, 1.7, seed, 3);
      top[x] = water - 40 + edge(x) * (roof - water + 40);
      column(x, 0, top[x]);
    }
    const levels = [water + 115, water + 285, water + 450];
    for (let k = 0; k < levels.length; k++) {
      let y = levels[k] + (R() - 0.5) * 30;
      for (let x = 150 + R() * 80; x < W - 150; x += 12) {
        disc(x, y, 44 + 26 * fbm(x / 90, k * 3.1, seed + 3, 2), 0);
        y = clamp(y + (fbm(x / 170, k + 0.5, seed + 9, 2) - 0.5) * 9, levels[k] - 55, levels[k] + 55);
      }
    }
    const shafts = Math.max(3, Math.round(W / 480));
    for (let s = 0; s < shafts; s++) {
      let x = (W * (s + 0.5)) / shafts + (R() - 0.5) * 140;
      const skylight = s % 2 === 0;
      const y1 = skylight ? top[clamp(Math.round(x), 0, W - 1)] + 30 : levels[2] + 30;
      for (let y = levels[0]; y < y1; y += 9) { disc(x, y, 30 + 8 * R(), 0); x += (R() - 0.5) * 9; }
    }
  } else if (shape === 'floaters') {
    const tiers = [water + 160, water + 340, water + 520];
    for (let t = 0; t < tiers.length; t++) {
      const count = Math.max(2, Math.round(W / 470));
      for (let k = 0; k < count; k++) {
        const cx = clamp((W * (k + 0.5 + (t % 2) * 0.5)) / count + (R() - 0.5) * 120, 110, W - 110);
        if (t % 2 && k === count - 1 && cx > W - 200) continue;
        const hw = 75 + R() * 75, ty = tiers[t] + (R() - 0.5) * 60, depth = 70 + R() * 90;
        for (let x = Math.max(0, Math.floor(cx - hw)); x <= Math.min(W - 1, cx + hw); x++) {
          const dx = (x - cx) / hw, kk = 1 - dx * dx;
          if (kk <= 0) continue;
          const yt = ty + 12 * kk + 14 * (fbm(x / 60, k + t * 7, seed, 2) - 0.5);
          const yb = ty - depth * Math.pow(kk, 0.8) - 6;
          column(x, yb, yt);
          top[x] = Math.max(top[x], yt);
        }
      }
    }
    // a few low reefs near the waterline
    const reefs = Math.max(2, Math.round(W / 700));
    for (let k = 0; k < reefs; k++) {
      const cx = (W * (k + 0.5)) / reefs + (R() - 0.5) * 150, hw = 90 + R() * 60;
      for (let x = Math.max(0, Math.floor(cx - hw)); x <= Math.min(W - 1, cx + hw); x++) {
        const dx = (x - cx) / hw, kk = 1 - dx * dx;
        if (kk <= 0) continue;
        const h = water - 30 + 80 * Math.pow(kk, 0.6) + 20 * (fbm(x / 50, k, seed + 2, 2) - 0.5);
        column(x, 0, h);
        top[x] = Math.max(top[x], h);
      }
    }
  }

  // extra pockets of caves (coarse noise grid keeps generation fast)
  if (o.caves && shape !== 'floaters') {
    const thr = 0.73 - o.caves * 0.07;
    for (let y = water + 30; y < H - 4; y += 4) for (let x = 0; x < W - 4; x += 4) {
      if (y > top[x] - 34 || fbm(x / 85, y / 85, seed + 21, 3) < thr) continue;
      for (let yy = y; yy < y + 4; yy++) for (let xx = x; xx < x + 4; xx++) { const i = yy * W + xx; if (m[i] === 1) m[i] = 0; }
    }
  }
  // free-standing steel ledges
  const ledges = o.girders && shape !== 'towers' && shape !== 'islands' ? Math.round(W / 800) : (o.girders && shape === 'islands' ? 1 : 0);
  for (let g = 0; g < ledges; g++) {
    const x0 = 160 + R() * (W - 480), len = 110 + R() * 80;
    const surf = Math.max(top[Math.floor(x0)], top[Math.floor(x0 + len / 2)], top[Math.floor(x0 + len)]);
    const y = Math.min(H - 160, Math.max(water + 120, surf) + 120 + R() * 90);
    bar(x0, x0 + len, y);
  }
  removeSpecks(m, W, H, 320);
  return m;
}

function removeSpecks(m, W, H, minSize) {
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const comp = [];
  for (let start = 0; start < m.length; start++) {
    if (!m[start] || seen[start]) continue;
    let sp = 0, steel = false;
    comp.length = 0;
    stack[sp++] = start; seen[start] = 1;
    while (sp) {
      const i = stack[--sp];
      comp.push(i);
      if (m[i] === 2) steel = true;
      const x = i % W;
      if (x > 0 && m[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < W - 1 && m[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (i >= W && m[i - W] && !seen[i - W]) { seen[i - W] = 1; stack[sp++] = i - W; }
      if (i < m.length - W && m[i + W] && !seen[i + W]) { seen[i + W] = 1; stack[sp++] = i + W; }
      if (comp.length > minSize && !steel) { /* big enough; keep flooding to mark it seen */ }
    }
    if (comp.length < minSize && !steel) for (const i of comp) m[i] = 0;
  }
}

// paint (render hints): 1 = top layer, 2 = under-top, 3 = scorched crater rim
function paintSurfaces(S) {
  const { W, H, mask, paint } = S;
  for (let x = 0; x < W; x++) {
    let d = 99, prev = false;
    for (let y = H - 1; y >= 0; y--) {
      const i = y * W + x, s = mask[i] === 1;
      if (s) { d = prev ? d + 1 : 0; paint[i] = d < 9 ? 1 : d < 18 ? 2 : 0; } else paint[i] = 0;
      prev = mask[i] !== 0;
    }
  }
}

// ------------------------------------------------------------------ collision helpers
export function solid(S, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || xi >= S.W || yi < 0 || yi >= S.H) return 0;
  return S.mask[yi * S.W + xi];
}
const OFFS = new Map();
function offsets(r) {
  let o = OFFS.get(r);
  if (o) return o;
  const a = [0, 0];
  for (let k = 0; k < 16; k++) { const t = (k / 16) * Math.PI * 2; a.push(Math.cos(t) * r, Math.sin(t) * r); }
  for (let k = 0; k < 8; k++) { const t = ((k + 0.5) / 8) * Math.PI * 2; a.push(Math.cos(t) * r * 0.55, Math.sin(t) * r * 0.55); }
  o = Float32Array.from(a);
  OFFS.set(r, o);
  return o;
}
export function hitC(S, x, y, r) {
  const o = offsets(r), W = S.W, H = S.H, m = S.mask;
  for (let i = 0; i < o.length; i += 2) {
    const xi = Math.floor(x + o[i]), yi = Math.floor(y + o[i + 1]);
    if (xi < 0 || xi >= W || yi < 0 || yi >= H) continue;
    if (m[yi * W + xi]) return true;
  }
  return false;
}
const RING = Array.from({ length: 16 }, (_, k) => [Math.cos((k / 16) * Math.PI * 2), Math.sin((k / 16) * Math.PI * 2)]);
export function normalAt(S, x, y, r) {
  let nx = 0, ny = 0;
  const rr = r + 2.5;
  for (const [c, s] of RING) if (solid(S, x + c * rr, y + s * rr)) { nx -= c; ny -= s; }
  const l = Math.hypot(nx, ny);
  return l < 1e-6 ? { x: 0, y: 1 } : { x: nx / l, y: ny / l };
}
export const launchSpeed = (power) => MIN_LAUNCH + clamp(power, 0, 1) * (MAX_LAUNCH - MIN_LAUNCH);
export const byId = (S, id) => S.bodies.find((b) => b.id === id) || null;
export const isAlive = (b) => !!b && b.kind === 'critter' && !b.dead && !b.gone;
export function active(S) { const b = byId(S, S.active); return isAlive(b) ? b : null; }
export const critters = (S) => S.bodies.filter((b) => b.kind === 'critter' && !b.gone);
export function teamHp(S, ti) { let h = 0; for (const b of S.bodies) if (b.kind === 'critter' && b.team === ti && !b.dead && !b.gone) h += b.hp; return h; }
export function teamsAlive(S) {
  const out = [];
  for (let t = 0; t < S.teams.length; t++) if (S.bodies.some((b) => b.team === t && isAlive(b))) out.push(t);
  return out;
}

// ------------------------------------------------------------------ match
// cfg: { W, shape, seed, water, girders, caves, gravity, wind, turnTime, slippery, crates,
//        suddenDeath, mines, barrels, first, teams: [{ name, color, cpu, difficulty, ammo, members: [{ name, hp, boss }] }] }
export function createMatch(cfg) {
  const W = cfg.W || SIZES.M, H = WORLD_H, seed = cfg.seed >>> 0, water = cfg.water ?? 70;
  const mask = generateTerrain({ W, H, shape: cfg.shape, seed, water, girders: cfg.girders, caves: cfg.caves });
  const S = {
    W, H, mask, paint: new Uint8Array(W * H), seed, water, waterTarget: water,
    grav: GRAVITY * (cfg.gravity || 1), gravity: cfg.gravity || 1, windMax: cfg.wind ?? 0.5, wind: 0,
    turnTime: cfg.turnTime || 45, slippery: !!cfg.slippery, crateChance: cfg.crates ?? 0.35, suddenDeath: cfg.suddenDeath || 0,
    bodies: [], projs: [], events: [], dirty: [], nextId: 1, time: 0, acc: 0, lastBoom: -9,
    phase: 'start', phaseT: 0, turnLeft: 0, retreatLeft: 0, shotsLeft: 0, locked: false, weapon: 'rocket',
    active: 0, teamTurn: -1, turnCount: 0, round: 1, ctl: { move: 0, aim: 0, jump: 0 }, endFlags: {}, result: null,
    rand: makeRng(seed * 31 + 7), teams: [], stats: [], flooding: false,
  };
  paintSurfaces(S);
  const rnd = makeRng(seed * 17 + 11);
  S.teams = cfg.teams.map((t) => ({
    name: t.name, color: t.color, cpu: !!t.cpu, difficulty: t.difficulty || 'medium', ammo: { ...(t.ammo || {}) },
    members: [], next: 0, lastWeapon: 'rocket', startHp: 0,
  }));
  S.stats = S.teams.map(() => ({ dmg: 0, self: 0, kills: 0, shots: 0 }));
  // alternate teams while placing so nobody gets all the good spots
  const most = Math.max(...cfg.teams.map((t) => t.members.length));
  for (let k = 0; k < most; k++) {
    for (let ti = 0; ti < cfg.teams.length; ti++) {
      const mem = cfg.teams[ti].members[k];
      if (!mem) continue;
      const r = mem.boss ? 13 : 9;
      const spot = findSpot(S, rnd, r, 85) || findSpot(S, rnd, r, 40) || findSpot(S, rnd, r, 0);
      if (!spot) continue;
      const b = addBody(S, 'critter', spot.x, spot.y, {
        r, team: ti, name: mem.name, hp: mem.hp, maxHp: mem.hp, boss: !!mem.boss, facing: spot.x < W / 2 ? 1 : -1,
        elev: 0.6, dead: false, lastBy: -1, hurtT: -9, walkAcc: 0, walkT: -9, jumping: false, power: 0.6,
      });
      S.teams[ti].members.push(b.id);
      S.teams[ti].startHp += mem.hp;
    }
  }
  for (let i = 0; i < (cfg.mines || 0); i++) {
    const spot = findSpot(S, rnd, 5, 70);
    if (spot) addBody(S, 'mine', spot.x, spot.y, { r: 5, armT: 0 });
  }
  for (let i = 0; i < (cfg.barrels || 0); i++) {
    const spot = findSpot(S, rnd, 9, 60);
    if (spot) addBody(S, 'barrel', spot.x, spot.y, { r: 9, hp: 25 });
  }
  // let everything drop onto the ground before the first turn
  for (let i = 0; i < 480; i++) {
    for (const b of S.bodies) bodyTick(S, b, STEP);
    S.bodies = S.bodies.filter((b) => !b.gone);
    if (S.bodies.every((b) => b.rest)) break;
  }
  for (const b of S.bodies) if (b.kind === 'critter') { b.hp = b.maxHp; b.lastBy = -1; }
  S.events.length = 0;
  S.dirty.length = 0;
  S.teamTurn = (cfg.first ?? 0) - 1;
  nextTurn(S, true);
  return S;
}

function addBody(S, kind, x, y, extra = {}) {
  const b = { id: S.nextId++, kind, x, y, vx: 0, vy: 0, r: 8, rest: false, gone: false, fuse: null, ...extra };
  S.bodies.push(b);
  return b;
}

function surfaceSpots(S, x) {
  const out = [];
  let prev = solid(S, x, S.H - 1);
  for (let y = S.H - 2; y > S.water + 4; y--) {
    const s = solid(S, x, y);
    if (s && !prev) out.push(y + 1);
    prev = s;
  }
  return out;
}
export function findSpot(S, rnd, r, minDist, xmin = 50, xmax = S.W - 50) {
  for (let tries = 0; tries < 700; tries++) {
    const x = xmin + rnd() * (xmax - xmin);
    const spots = surfaceSpots(S, Math.floor(x));
    if (!spots.length) continue;
    const y = spots[Math.floor(rnd() * spots.length)] + r + 0.5;
    if (y < S.water + 30) continue;
    if (hitC(S, x, y, r) || hitC(S, x, y + 16, r)) continue;
    if (!hitC(S, x, y - 2, r)) continue;
    // not on a cliff edge: ground a little to either side
    if (!hitC(S, x - 7, y - 6, r) || !hitC(S, x + 7, y - 6, r)) continue;
    if (S.bodies.some((b) => Math.hypot(b.x - x, b.y - y) < minDist)) continue;
    return { x, y };
  }
  return null;
}

// ------------------------------------------------------------------ turn cycle
function setPhase(S, ph) { S.phase = ph; S.phaseT = 0; S.events.push({ type: 'phase', phase: ph }); }

function nextTurn(S, first = false) {
  const n = S.teams.length;
  const prev = S.teamTurn;
  let ti = prev;
  for (let k = 0; k < n; k++) {
    ti = (ti + 1) % n;
    if (S.bodies.some((b) => b.team === ti && isAlive(b))) break;
  }
  if (!first) { S.turnCount++; if (ti <= prev) S.round++; }
  S.teamTurn = ti;
  const team = S.teams[ti];
  let pick = null;
  for (let k = 0; k < team.members.length; k++) {
    const idx = (team.next + k) % team.members.length;
    const b = byId(S, team.members[idx]);
    if (isAlive(b)) { pick = b; team.next = idx + 1; break; }
  }
  S.active = pick ? pick.id : 0;
  S.wind = Math.round((S.rand() * 2 - 1) * S.windMax * 100) / 100;
  S.turnLeft = S.turnTime;
  S.retreatLeft = 0;
  S.shotsLeft = 0;
  S.locked = false;
  S.weapon = team.ammo[team.lastWeapon] !== 0 && team.ammo[team.lastWeapon] != null ? team.lastWeapon : 'rocket';
  S.endFlags = {};
  S.ctl.move = 0; S.ctl.aim = 0; S.ctl.jump = 0;
  setPhase(S, 'start');
  S.events.push({ type: 'turn', team: ti, id: S.active, wind: S.wind, round: S.round });
}

/** Skip the short turn intro as soon as the player does something. */
export function hurry(S) { if (S.phase === 'start') setPhase(S, 'turn'); }

function endAction(S) {
  if (S.phase === 'turn' || S.phase === 'start' || S.phase === 'retreat') {
    S.ctl.move = 0;
    setPhase(S, 'settle');
  }
}

export function isCalm(S) {
  if (S.projs.length) return false;
  if (S.water < S.waterTarget - 0.01) return false;
  if (S.time - S.lastBoom < 0.5) return false;
  for (const b of S.bodies) { if (b.gone) continue; if (!b.rest || b.fuse != null) return false; }
  return true;
}

function resolve(S) {
  // 1. critters at 0 HP blow up, one at a time
  const dying = S.bodies.find((b) => b.kind === 'critter' && !b.dead && !b.gone && b.hp <= 0);
  if (dying) { killCritter(S, dying); setPhase(S, 'settle'); return; }
  // 2. is the match over?
  const alive = teamsAlive(S);
  if (alive.length <= 1) {
    S.result = { winner: alive.length ? alive[0] : -1 };
    setPhase(S, 'over');
    S.events.push({ type: 'over', winner: S.result.winner });
    return;
  }
  // 3. sudden death: the water creeps up
  if (!S.endFlags.water && S.suddenDeath && S.round >= S.suddenDeath) {
    S.endFlags.water = true;
    if (!S.flooding) { S.flooding = true; S.events.push({ type: 'suddendeath' }); }
    S.waterTarget = Math.min(S.H - 200, S.waterTarget + 24);
    S.events.push({ type: 'flood', to: S.waterTarget });
    setPhase(S, 'settle');
    return;
  }
  // 4. maybe a supply crate floats down
  if (!S.endFlags.crate) {
    S.endFlags.crate = true;
    if (S.rand() < S.crateChance && dropCrate(S)) { setPhase(S, 'settle'); return; }
  }
  nextTurn(S);
}

function dropCrate(S) {
  for (let k = 0; k < 40; k++) {
    const x = 100 + S.rand() * (S.W - 200);
    const spots = surfaceSpots(S, Math.floor(x));
    if (!spots.length || spots[0] < S.water + 40) continue;
    const health = S.rand() < 0.4;
    const what = health ? 25 : CRATE_LOOT[Math.floor(S.rand() * CRATE_LOOT.length)];
    addBody(S, 'crate', x, S.H + 40, { r: 9, chute: true, crate: health ? 'health' : 'weapon', what });
    S.events.push({ type: 'crate', x, kind: health ? 'health' : 'weapon' });
    return true;
  }
  return false;
}

function killCritter(S, b) {
  b.dead = true;
  b.gone = true;
  b.hp = 0;
  if (b.lastBy >= 0 && b.lastBy !== b.team) S.stats[b.lastBy].kills++;
  S.events.push({ type: 'die', id: b.id, team: b.team, name: b.name, x: b.x, y: b.y });
  addBody(S, 'grave', b.x, b.y, { r: 7, team: b.team, name: b.name });
  explode(S, b.x, b.y, 22, 12, -1, 'pop');
}

// ------------------------------------------------------------------ main step
export function step(S, dt) {
  S.acc += Math.min(dt, 0.1);
  while (S.acc >= STEP) { S.acc -= STEP; tick(S); }
  if (S.events.length > 4000) S.events.splice(0, S.events.length - 1000);
}

function tick(S) {
  const dt = STEP;
  S.time += dt;
  if (S.phase === 'over') { for (const b of S.bodies) bodyTick(S, b, dt); for (const p of [...S.projs]) projTick(S, p, dt); return; }
  if (S.water < S.waterTarget) S.water = Math.min(S.waterTarget, S.water + 28 * dt);

  const c = active(S);
  const mobile = c && ((S.phase === 'turn' && !S.locked) || S.phase === 'retreat');
  if (c && S.ctl.aim && (S.phase === 'turn' || S.phase === 'start')) c.elev = clamp(c.elev + S.ctl.aim * 1.25 * dt, -1.5, 1.5);
  if (mobile && c.rest) {
    if (S.ctl.jump) {
      const back = S.ctl.jump === 2;
      c.vx = back ? -c.facing * 62 : c.facing * 135;
      c.vy = back ? 335 : 235;
      c.rest = false;
      c.jumping = true;
      S.events.push({ type: 'jump', id: c.id, back });
    } else if (S.ctl.move) {
      c.facing = S.ctl.move;
      c.walkAcc += WALK_SPEED * dt;
      c.walkT = S.time;
      while (c.walkAcc >= 1) {
        c.walkAcc -= 1;
        if (!walkStep(S, c, S.ctl.move)) { c.walkAcc = 0; break; }
        if (!c.rest) break;
      }
    }
  } else if (c && S.ctl.move && S.phase === 'turn' && !S.locked) c.facing = S.ctl.move;
  S.ctl.jump = 0;

  for (const b of S.bodies) bodyTick(S, b, dt);
  for (const p of [...S.projs]) projTick(S, p, dt);
  pickups(S);
  if (S.bodies.some((b) => b.gone)) S.bodies = S.bodies.filter((b) => !b.gone);

  S.phaseT += dt;
  switch (S.phase) {
    case 'start':
      if (!active(S)) endAction(S);
      else if (S.phaseT > 1.1) setPhase(S, 'turn');
      break;
    case 'turn':
      S.turnLeft -= dt;
      if (S.turnLeft <= 0 || !active(S)) endAction(S);
      break;
    case 'retreat':
      S.retreatLeft -= dt;
      S.turnLeft = Math.max(0, S.turnLeft - dt);
      if (S.retreatLeft <= 0 || !active(S)) setPhase(S, 'settle');
      break;
    case 'settle':
      if ((isCalm(S) && S.phaseT > 0.45) || S.phaseT > 20) {
        if (S.phaseT > 20) { S.projs.length = 0; for (const b of S.bodies) { b.fuse = null; b.rest = true; b.vx = b.vy = 0; } }
        resolve(S);
      }
      break;
  }
}

// ------------------------------------------------------------------ movement
export function walkStep(S, b, dir) {
  const nx = b.x + dir;
  for (let up = 0; up <= 3; up++) {
    if (hitC(S, nx, b.y + up, b.r)) continue;
    b.x = nx;
    b.y += up;
    for (let d = 0; d < 5 && !hitC(S, b.x, b.y - 1, b.r); d++) b.y -= 1;
    if (!hitC(S, b.x, b.y - 1.5, b.r)) { b.rest = false; b.vx = dir * 40; b.vy = 0; }
    return true;
  }
  return false;
}

/** Drive the active critter: move -1/0/1, aim -1/0/1 (raise/lower). */
export function setControl(S, move, aim = 0) { S.ctl.move = move; S.ctl.aim = aim; }
export function jump(S, back = false) { S.ctl.jump = back ? 2 : 1; }

function bodyTick(S, b, dt) {
  if (b.gone) return;
  if (b.y < S.water - 1) { drown(S, b); return; }
  if (b.fuse != null) { b.fuse -= dt; if (b.fuse <= 0) { detonateBody(S, b); return; } }
  if (b.kind === 'mine') mineTick(S, b, dt);
  if (b.rest) {
    if (hitC(S, b.x, b.y - 1.5, b.r)) return;
    b.rest = false;
  }
  b.vy -= S.grav * dt;
  if (b.chute) { if (b.vy < -55) b.vy = -55; b.vx += (S.wind * 40 - b.vx) * Math.min(1, dt * 2); }
  const sp = Math.hypot(b.vx, b.vy);
  const n = Math.max(1, Math.ceil((sp * dt) / 1.5));
  const sdt = dt / n;
  for (let i = 0; i < n; i++) {
    const nx = b.x + b.vx * sdt, ny = b.y + b.vy * sdt;
    if (!hitC(S, nx, ny, b.r)) { b.x = nx; b.y = ny; continue; }
    const nr = normalAt(S, nx, ny, b.r);
    const vn = b.vx * nr.x + b.vy * nr.y;
    if (vn < 0) {
      const impact = -vn;
      if (b.kind === 'critter' && impact > FALL_SAFE && !b.dead) hurt(S, b, Math.round((impact - FALL_SAFE) * 0.09), -1);
      const tx = -nr.y, ty = nr.x, vt = b.vx * tx + b.vy * ty;
      const e = b.kind === 'barrel' ? 0.3 : 0.22;
      const fr = S.slippery ? 0.92 : 0.6;
      b.vx = nr.x * impact * e + tx * vt * fr;
      b.vy = nr.y * impact * e + ty * vt * fr;
      if (impact > 90) S.events.push({ type: 'thud', id: b.id, kind: b.kind, v: impact, x: b.x, y: b.y });
      b.chute = false;
    }
    break;
  }
  if (hitC(S, b.x, b.y, b.r)) unstick(S, b);
  if (Math.abs(b.vx) + Math.abs(b.vy) < (S.slippery ? 30 : 50) && hitC(S, b.x, b.y - 1.5, b.r)) {
    const nr = normalAt(S, b.x, b.y - 1, b.r);
    if (nr.y > 0.42 || Math.abs(b.vx) + Math.abs(b.vy) < 6) { b.vx = 0; b.vy = 0; b.rest = true; b.jumping = false; }
  }
  if (b.x < -400 || b.x > S.W + 400) { b.vx *= 0.98; }
}

function unstick(S, b) {
  const nr = normalAt(S, b.x, b.y, b.r);
  const dirs = [[nr.x, nr.y], [0, 1], [0.7, 0.7], [-0.7, 0.7], [1, 0], [-1, 0], [0, -1]];
  for (let d = 1; d <= 16; d++) for (const [dx, dy] of dirs) {
    if (!hitC(S, b.x + dx * d, b.y + dy * d, b.r)) { b.x += dx * d; b.y += dy * d; return; }
  }
}

function drown(S, b) {
  if (b.kind === 'critter' && !b.dead) {
    b.dead = true;
    b.hp = 0;
    if (b.lastBy >= 0 && b.lastBy !== b.team) S.stats[b.lastBy].kills++;
    S.events.push({ type: 'drown', id: b.id, team: b.team, name: b.name, x: b.x, y: S.water });
  }
  S.events.push({ type: 'splash', x: b.x, y: S.water, big: b.kind === 'critter' });
  b.gone = true;
}

function mineTick(S, b, dt) {
  if (b.armT > 0) { b.armT -= dt; return; }
  if (b.fuse != null) return;
  for (const c of S.bodies) {
    if (c.kind === 'critter' && !c.dead && !c.gone && Math.hypot(c.x - b.x, c.y - b.y) < 34) {
      b.fuse = 1.1;
      S.events.push({ type: 'beep', id: b.id, x: b.x, y: b.y });
      break;
    }
  }
}

function detonateBody(S, b) {
  b.gone = true;
  if (b.kind === 'barrel') explode(S, b.x, b.y, 52, 40, -1, 'barrel');
  else if (b.kind === 'mine') explode(S, b.x, b.y, 44, 45, -1, 'mine');
  else if (b.kind === 'crate') explode(S, b.x, b.y, 30, 20, -1, 'crate');
}

function pickups(S) {
  for (const k of S.bodies) {
    if (k.kind !== 'crate' || k.gone) continue;
    for (const c of S.bodies) {
      if (!isAlive(c) || Math.hypot(c.x - k.x, c.y - k.y) > c.r + k.r + 3) continue;
      k.gone = true;
      if (k.crate === 'health') { c.hp += k.what; S.events.push({ type: 'pickup', id: c.id, team: c.team, what: 'health', amount: k.what, x: k.x, y: k.y }); }
      else {
        const t = S.teams[c.team];
        if (t.ammo[k.what] !== INF) t.ammo[k.what] = (t.ammo[k.what] || 0) + 1;
        S.events.push({ type: 'pickup', id: c.id, team: c.team, what: k.what, x: k.x, y: k.y });
      }
      break;
    }
  }
}

// ------------------------------------------------------------------ damage
function hurt(S, b, amount, byTeam) {
  if (b.dead || amount <= 0) return;
  const before = b.hp;
  b.hp = Math.max(0, b.hp - amount);
  const dealt = before - b.hp;
  b.hurtT = S.time;
  if (byTeam >= 0) {
    b.lastBy = byTeam;
    if (byTeam !== b.team) S.stats[byTeam].dmg += dealt; else S.stats[byTeam].self += dealt;
  }
  S.events.push({ type: 'hurt', id: b.id, team: b.team, amount: dealt, x: b.x, y: b.y });
  if (b.id === S.active) {
    if (S.phase === 'turn' || S.phase === 'start') endAction(S);
    else if (S.phase === 'retreat') S.retreatLeft = 0;
  }
}

export function explode(S, x, y, R, dmg, byTeam = -1, kind = 'boom') {
  carve(S, x, y, R);
  S.lastBoom = S.time;
  S.events.push({ type: 'boom', x, y, r: R, kind });
  for (const b of S.bodies) {
    if (b.gone || (b.kind === 'critter' && b.dead)) continue;
    const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy), reach = R + b.r;
    if (d >= reach) continue;
    const f = 1 - d / reach;
    const nx = d > 0.01 ? dx / d : 0, ny = d > 0.01 ? dy / d : 1;
    const kv = (120 + dmg * 7) * f;
    b.vx += nx * kv;
    b.vy += ny * kv + 90 * f;
    b.rest = false;
    const amount = Math.max(1, Math.round(dmg * f));
    if (b.kind === 'critter') hurt(S, b, amount, byTeam);
    else if (b.kind === 'barrel') { b.hp -= amount; if (b.hp <= 0 && b.fuse == null) b.fuse = 0.22; }
    else if (b.kind === 'mine') { if (b.fuse == null) { b.fuse = 0.35 + S.rand() * 0.35; b.armT = 0; } }
    else if (b.kind === 'crate' && amount > 8) {
      b.gone = true;
      if (b.crate === 'weapon') explode(S, b.x, b.y, 30, 20, -1, 'crate');
      else S.events.push({ type: 'pop', x: b.x, y: b.y });
    }
  }
}

function carve(S, x, y, R) {
  const { W, H, mask, paint } = S;
  const RR = R + 5;
  const x0 = Math.max(0, Math.floor(x - RR)), x1 = Math.min(W - 1, Math.ceil(x + RR));
  const y0 = Math.max(0, Math.floor(y - RR)), y1 = Math.min(H - 1, Math.ceil(y + RR));
  if (x0 > x1 || y0 > y1) return;
  const R2 = R * R, O2 = RR * RR;
  for (let yy = y0; yy <= y1; yy++) {
    const dy = yy + 0.5 - y;
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx + 0.5 - x, d2 = dx * dx + dy * dy;
      if (d2 > O2) continue;
      const i = yy * W + xx;
      if (mask[i] !== 1) continue;
      if (d2 <= R2) mask[i] = 0; else paint[i] = 3;
    }
  }
  // shave off sliver-thin leftovers so what you see is what you stand on
  for (let pass = 0; pass < 2; pass++) {
    for (let yy = Math.max(1, y0); yy <= Math.min(H - 2, y1); yy++) for (let xx = Math.max(1, x0); xx <= Math.min(W - 2, x1); xx++) {
      const i = yy * W + xx;
      if (mask[i] !== 1) continue;
      const n = (mask[i - 1] ? 1 : 0) + (mask[i + 1] ? 1 : 0) + (mask[i - W] ? 1 : 0) + (mask[i + W] ? 1 : 0);
      if (n <= 1) mask[i] = 0;
    }
  }
  S.dirty.push([x0, y0, x1, y1]);
}

// ------------------------------------------------------------------ weapons
export function selectWeapon(S, key) {
  if (S.locked || !WEAPONS[key]) return false;
  const c = active(S);
  if (!c) return false;
  if ((S.teams[c.team].ammo[key] ?? 0) === 0) return false;
  S.weapon = key;
  return true;
}

export function canTeleport(S, c, tx, ty) {
  return tx > 15 && tx < S.W - 15 && ty > S.water + 25 && ty < S.H + 150 && !hitC(S, tx, ty, c.r + 1);
}

export function makeProj(S, kind, x, y, vx, vy, owner, ownerId) {
  const P = PROJ[kind];
  return {
    id: 0, kind, x, y, vx, vy, r: P.r, t: 0, fuse: P.fuse ?? null, bounce: P.bounce || 0, wind: P.wind || 0,
    impact: !!P.impact, homing: !!P.homing, boom: P.boom, split: P.split || null, owner, ownerId, lockT: 0.12,
    target: 0, bounced: 0,
  };
}

function launch(S, p) { p.id = S.nextId++; S.projs.push(p); return p; }

/**
 * Fire the selected weapon for the active critter.
 * o: { weapon, elev, facing, power, tx, ty } — returns { ok, why?, more? }
 */
export function fire(S, o = {}) {
  hurry(S);
  const c = active(S);
  if (!c || S.phase !== 'turn' || S.result) return { ok: false, why: 'Not now' };
  const key = S.locked ? S.weapon : o.weapon || S.weapon;
  const w = WEAPONS[key], team = S.teams[c.team];
  const ammo = team.ammo[key] ?? 0;
  if (!w || ammo === 0) return { ok: false, why: 'Out of ammo' };
  if (o.elev != null) c.elev = clamp(o.elev, -1.5, 1.5);
  if (o.facing) c.facing = o.facing > 0 ? 1 : -1;
  if (o.power != null) c.power = clamp(o.power, 0, 1);
  const dx = c.facing * Math.cos(c.elev), dy = Math.sin(c.elev);
  S.weapon = key;
  const use = () => { if (ammo !== INF) team.ammo[key] = ammo - 1; team.lastWeapon = key; S.stats[c.team].shots++; };

  switch (key) {
    case 'skip':
      S.events.push({ type: 'skip', id: c.id });
      endAction(S);
      return { ok: true };
    case 'teleport': {
      if (o.tx == null || !canTeleport(S, c, o.tx, o.ty)) return { ok: false, why: 'Pick an open spot to teleport to' };
      S.events.push({ type: 'teleport', id: c.id, x0: c.x, y0: c.y, x1: o.tx, y1: o.ty });
      c.x = o.tx; c.y = o.ty; c.vx = 0; c.vy = 0; c.rest = false;
      use();
      break;
    }
    case 'airdrop': {
      if (o.tx == null) return { ok: false, why: 'Tap a target for the plane first' };
      const dir = o.tx >= c.x ? 1 : -1;
      for (let i = 0; i < 5; i++) launch(S, makeProj(S, 'bomb', o.tx + (i - 2) * 26, S.H + 80 + i * 8, dir * 20, -40, c.team, c.id));
      S.events.push({ type: 'plane', x: o.tx, dir });
      use();
      break;
    }
    case 'blaster': {
      if (!S.locked) { use(); S.shotsLeft = w.shots; S.locked = true; }
      S.shotsLeft--;
      hitscan(S, c, dx, dy);
      if (S.shotsLeft > 0 && active(S) && S.phase === 'turn') return { ok: true, more: true };
      break;
    }
    case 'bonk': {
      use();
      let hit = false;
      for (const b of S.bodies) {
        if (b === c || b.gone || (b.kind === 'critter' && b.dead)) continue;
        const ex = b.x - c.x, ey = b.y - c.y, d = Math.hypot(ex, ey);
        if (d > c.r + b.r + 18 || (ex * dx + ey * dy) / Math.max(d, 0.01) < 0.2) continue;
        b.vx = dx * 640; b.vy = dy * 640 + 140; b.rest = false;
        if (b.kind === 'critter') hurt(S, b, 30, c.team);
        hit = true;
      }
      S.events.push({ type: 'bonk', id: c.id, hit, x: c.x + dx * 14, y: c.y + dy * 14 });
      break;
    }
    case 'mine': {
      use();
      addBody(S, 'mine', c.x + c.facing * 10, c.y + 4, { r: 5, armT: 2, vx: c.facing * 60, vy: 60 });
      S.events.push({ type: 'drop', id: c.id, what: 'mine' });
      break;
    }
    case 'dynamite': {
      use();
      const p = launch(S, makeProj(S, 'dynamite', c.x + c.facing * 8, c.y + 2, c.facing * 50, 80, c.team, c.id));
      if (hitC(S, p.x, p.y, p.r)) { p.x = c.x; p.y = c.y; }
      S.events.push({ type: 'drop', id: c.id, what: 'dynamite' });
      break;
    }
    default: {
      use();
      const sp = launchSpeed(c.power);
      const sx = c.x + dx * (c.r + 5), sy = c.y + dy * (c.r + 5);
      const p = makeProj(S, key, sx, sy, dx * sp, dy * sp, c.team, c.id);
      if (hitC(S, sx, sy, p.r)) {
        if (p.impact) { S.events.push({ type: 'launch', kind: key, id: c.id }); detonate(S, p); break; }
        p.x = c.x; p.y = c.y;
      }
      launch(S, p);
      S.events.push({ type: 'launch', kind: key, id: c.id, power: c.power });
    }
  }
  S.locked = false;
  S.shotsLeft = 0;
  S.retreatLeft = w.retreat ?? 3;
  S.ctl.move = 0;
  if (active(S) && S.phase === 'turn') setPhase(S, 'retreat');
  return { ok: true };
}

function hitscan(S, c, dx, dy) {
  let x = c.x + dx * (c.r + 2), y = c.y + dy * (c.r + 2), hit = false;
  const x0 = x, y0 = y;
  for (let d = 0; d < 1100 && !hit; d += 2) {
    x += dx * 2; y += dy * 2;
    if (y < S.water) break;
    if (solid(S, x, y)) { hit = true; break; }
    for (const b of S.bodies) {
      if (b === c || b.gone || (b.kind === 'critter' && b.dead)) continue;
      if ((b.x - x) ** 2 + (b.y - y) ** 2 < b.r * b.r) { hit = true; break; }
    }
  }
  S.events.push({ type: 'shot', id: c.id, x0, y0, x1: x, y1: y, hit });
  if (hit) explode(S, x, y, 16, 25, c.team, 'shot');
}

/** Advance a projectile by dt without touching the match. Returns 'hit' | 'water' | 'out' | null. */
export function moveProj(S, p, dt, ignoreId = -1, wind = S.wind) {
  if (p.homing) {
    if (p.t > 0.45 && p.t < 5.5) {
      let tg = p.target ? byId(S, p.target) : null;
      if (!isAlive(tg)) {
        tg = null;
        let best = Infinity;
        for (const b of S.bodies) {
          if (!isAlive(b) || b.team === p.owner) continue;
          const d = Math.hypot(b.x - p.x, b.y - p.y);
          if (d < best) { best = d; tg = b; }
        }
        p.target = tg ? tg.id : 0;
      }
      if (tg) {
        const want = Math.atan2(tg.y - p.y, tg.x - p.x);
        let a = Math.atan2(p.vy, p.vx), da = want - a;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        a += clamp(da, -3.4 * dt, 3.4 * dt);
        let s = Math.hypot(p.vx, p.vy);
        s += (430 - s) * Math.min(1, dt * 2.5);
        p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      }
    } else p.vy -= S.grav * dt;
  } else p.vy -= S.grav * dt;
  if (p.wind) p.vx += wind * WIND_ACCEL * p.wind * dt;
  const sp = Math.hypot(p.vx, p.vy);
  const n = Math.max(1, Math.ceil((sp * dt) / 2));
  const sdt = dt / n;
  for (let i = 0; i < n; i++) {
    const nx = p.x + p.vx * sdt, ny = p.y + p.vy * sdt;
    for (const b of S.bodies) {
      if (b.gone || b.id === ignoreId || (b.kind === 'critter' && b.dead)) continue;
      const ex = nx - b.x, ey = ny - b.y, rr = b.r + p.r;
      if (ex * ex + ey * ey >= rr * rr) continue;
      if (p.impact) { p.x = nx; p.y = ny; p.hitBody = b.id; return 'hit'; }
      if (b.kind === 'critter') {
        const d = Math.hypot(ex, ey) || 1, ux = ex / d, uy = ey / d, vn = p.vx * ux + p.vy * uy;
        if (vn < 0) { p.vx -= (1 + p.bounce) * vn * ux; p.vy -= (1 + p.bounce) * vn * uy; }
      }
    }
    if (hitC(S, nx, ny, p.r)) {
      if (p.impact) { p.x = nx; p.y = ny; return 'hit'; }
      const nr = normalAt(S, nx, ny, p.r);
      const vn = p.vx * nr.x + p.vy * nr.y;
      if (vn < 0) {
        if (-vn > 60) p.bounced = -vn;
        const tx = -nr.y, ty = nr.x, vt = p.vx * tx + p.vy * ty;
        const out = -vn < 30 ? 0 : -vn * p.bounce;
        const keep = -vn < 30 ? 0.9 : 0.78;
        p.vx = nr.x * out + tx * vt * keep;
        p.vy = nr.y * out + ty * vt * keep;
      }
      if (hitC(S, p.x, p.y, p.r)) p.y += 1;
      break;
    }
    p.x = nx; p.y = ny;
  }
  if (p.y < S.water) return 'water';
  if (p.x < -700 || p.x > S.W + 700) return 'out';
  return null;
}

function projTick(S, p, dt) {
  p.t += dt;
  if (p.fuse != null && p.t >= p.fuse) { detonate(S, p); return; }
  const res = moveProj(S, p, dt, p.t < p.lockT ? p.ownerId : -1);
  if (p.bounced) { S.events.push({ type: 'bounce', kind: p.kind, v: p.bounced, x: p.x, y: p.y }); p.bounced = 0; }
  if (res === 'hit') detonate(S, p);
  else if (res === 'water') { removeProj(S, p); S.events.push({ type: 'splash', x: p.x, y: S.water, big: false }); }
  else if (res === 'out') removeProj(S, p);
}

function removeProj(S, p) { const i = S.projs.indexOf(p); if (i >= 0) S.projs.splice(i, 1); }

function detonate(S, p) {
  removeProj(S, p);
  explode(S, p.x, p.y, p.boom[0], p.boom[1], p.owner, p.kind);
  if (p.split) {
    const n = p.split.n;
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (i - (n - 1) / 2) * 0.42 + (S.rand() - 0.5) * 0.25;
      const s = p.split.speed * (0.7 + 0.5 * S.rand());
      const q = makeProj(S, p.split.kind, p.x, p.y + 2, Math.cos(a) * s, Math.sin(a) * s, p.owner, -1);
      q.lockT = 0;
      if (hitC(S, q.x, q.y, q.r)) q.y += 6;
      launch(S, q);
    }
  }
}

/**
 * Predict where a shot ends without changing the match (used by the CPU players).
 * me: the shooter (ignored by the projectile), wind: the wind the shooter believes in.
 */
export function simulateShot(S, kind, x, y, vx, vy, me, wind = S.wind, maxT = 8) {
  const p = makeProj(S, kind, x, y, vx, vy, me ? me.team : -1, me ? me.id : -1);
  let end = 'time';
  if (hitC(S, x, y, p.r)) return { x, y, t: 0, end: 'hit', hit: null };
  while (p.t < maxT) {
    p.t += STEP;
    if (p.fuse != null && p.t >= p.fuse) { end = 'fuse'; break; }
    const r = moveProj(S, p, STEP, me ? me.id : -1, wind);
    if (r) { end = r; break; }
  }
  return { x: p.x, y: p.y, t: p.t, end, hit: p.hitBody || null };
}
