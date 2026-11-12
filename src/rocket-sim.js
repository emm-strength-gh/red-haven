// Rocket to the Rim — pure simulation (no rendering), so it can be unit tested.
// World: x is lateral (−FIELD..FIELD), y is altitude. The rocket sits at y = g.dist.
// The renderer drains g.out each frame for sounds, banners and effects.

export const FIELD = 8.5;
export const ROCKET_R = 0.6;
export const VIEW_AHEAD = 70;

export const SECTORS = [
  { id: 'atmos', name: 'Lower Atmosphere', icon: '🌍', len: 650, cruise: 20, events: ['tailwind', 'headwind', 'ion', 'surge'] },
  { id: 'orbit', name: 'Orbital Debris Field', icon: '🛰️', len: 850, cruise: 21.5, events: ['tailwind', 'shower', 'leak', 'surge', 'wave'] },
  { id: 'solar', name: 'The Solar System', icon: '🪐', len: 950, cruise: 23, events: ['tailwind', 'headwind', 'shower', 'wave', 'surge'] },
  { id: 'alien', name: 'Alien Territory', icon: '👽', len: 950, cruise: 24, events: ['hail', 'ion', 'leak', 'shower', 'tailwind'] },
  { id: 'deep', name: 'The Deep Dark', icon: '🌀', len: 950, cruise: 25, events: ['headwind', 'wave', 'hail', 'shower', 'surge'] },
  { id: 'rim', name: 'Edge of the Universe', icon: '✨', len: 900, cruise: 26, events: ['wave', 'ion', 'headwind', 'tailwind', 'shower', 'surge'] }
];
export const SECTOR_STARTS = SECTORS.reduce((a, s, i) => { a.push(i ? a[i - 1] + SECTORS[i - 1].len : 0); return a; }, []);
export const TOTAL = SECTOR_STARTS[SECTORS.length - 1] + SECTORS[SECTORS.length - 1].len;

export const EVENTS = {
  tailwind: { text: 'Solar tailwind! Speed up', tone: 'cyan', dur: 7 },
  headwind: { text: 'Cosmic headwind — drag rising', tone: 'magenta', dur: 6 },
  ion: { text: 'Ion storm — steering sluggish', tone: 'magenta', dur: 6 },
  surge: { text: 'Engine surge — free boost!', tone: 'cyan', dur: 4 },
  leak: { text: 'Fuel leak! Energy draining', tone: 'magenta', dur: 6 },
  wave: { text: 'Gravity wave — hold steady', tone: 'magenta', dur: 5 },
  shower: { text: 'Meteor shower incoming!', tone: 'magenta', dur: 0 },
  hail: { text: 'Friendly signal detected', tone: 'cyan', dur: 0 }
};

const PATTERNS = {
  atmos: [['birds', 3], ['balloons', 2], ['storm', 2], ['jet', 2], ['rings', 2], ['pickups', 2.2], ['current', 1.5], ['cloudGate', 2]],
  orbit: [['debris', 3], ['junkGate', 3], ['drift', 2], ['rings', 2], ['pickups', 2.2], ['current', 1], ['satellites', 2]],
  solar: [['rocks', 3], ['rockGate', 3], ['planet', 2], ['current', 2], ['dust', 1.5], ['rings', 2], ['pickups', 2.2], ['comet', 1]],
  alien: [['uapFriendly', 1.5], ['uapScanner', 2], ['uapBlocker', 2], ['uapBeam', 2.5], ['storm', 2], ['rocks', 2], ['rings', 1.5], ['pickups', 2.2]],
  deep: [['blackhole', 2.5], ['dust', 2], ['comet', 2], ['rocks', 2], ['wormhole', 1], ['rings', 1.5], ['pickups', 2.2], ['uapFriendly', 1], ['current', 1.5]],
  rim: [['shardGate', 3], ['shards', 2], ['blackhole', 2], ['wormhole', 1], ['uapBeam', 1.5], ['comet', 1.5], ['rings', 1.5], ['pickups', 2.2], ['dust', 1]]
};
const SPECIAL = new Set(['blackhole', 'planet', 'wormhole', 'uapFriendly', 'uapScanner', 'uapBlocker', 'uapBeam', 'storm']);

const OBSTACLE = { debris: 9, junk: 16, rock: 0, meteor: 16, bird: 5, balloon: 8, jet: 20, shard: 14, comet: 22, cloudlet: 0 };

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

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function sectorAt(dist) {
  for (let i = SECTORS.length - 1; i >= 0; i--) if (dist >= SECTOR_STARTS[i]) return i;
  return 0;
}

export function createGame(seed = (Math.random() * 2 ** 31) | 0) {
  return {
    seed, rng: mulberry32(seed),
    phase: 'countdown', countdown: 3.2,
    t: 0, dist: 0, x: 0, vx: 0, speed: 0,
    hull: 100, energy: 100, heat: 0,
    boosting: false, overheated: false, invuln: 0, shield: 0, jam: 0, scan: 0, burst: 0,
    sector: 0, mods: [], entities: [], nextId: 1,
    nextSpawn: 34, nextEvent: 20, lastPattern: '',
    // live influences, recomputed each step (read by the renderer/HUD)
    fx: { dust: false, current: false, beam: false, pull: 0, horizon: false, storm: false },
    out: [],
    stats: { time: 0, hits: 0, pickups: 0, maxSpeed: 0, slings: 0 },
    won: false, lost: false, cause: ''
  };
}

export const hasMod = (g, id) => g.mods.some(m => m.id === id);

function add(g, e) { e.id = g.nextId++; g.entities.push(e); return e; }

function hurt(g, amount, kind, knock = 0) {
  if (g.invuln > 0) return false;
  if (g.shield > 0) { g.out.push({ t: 'shieldHit' }); g.invuln = 0.4; return false; }
  g.hull -= amount;
  g.invuln = 0.85;
  g.vx += knock;
  g.stats.hits++;
  g.out.push({ t: 'hit', kind, amount });
  if (g.hull <= 0) lose(g, kind);
  return true;
}

function lose(g, cause) {
  if (g.phase !== 'fly') return;
  g.hull = 0;
  g.phase = 'over';
  g.lost = true;
  g.cause = cause;
  g.out.push({ t: 'lose', cause });
}

function banner(g, text, tone = 'gold') { g.out.push({ t: 'banner', text, tone }); }

// ------------------------------------------------------------------ spawning

function pick(g, list) {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = g.rng() * total;
  for (const [name, w] of list) { r -= w; if (r <= 0) return name; }
  return list[0][0];
}

/** Scatter n points in a vertical span, keeping a minimum spacing so a route always exists. */
function scatter(g, n, y0, span, minGap = 2.8) {
  const pts = [];
  for (let tries = 0; pts.length < n && tries < n * 12; tries++) {
    const p = { x: (g.rng() * 2 - 1) * (FIELD - 0.6), y: y0 + g.rng() * span };
    if (pts.every(q => Math.hypot(q.x - p.x, q.y - p.y) > minGap)) pts.push(p);
  }
  return pts;
}

function obstacle(g, kind, x, y, r, extra = {}) {
  const dmg = OBSTACLE[kind] || Math.round(10 + r * 8);
  return add(g, { kind, x, y, r, dmg, vx: 0, vy: 0, spin: (g.rng() - 0.5) * 3, seed: g.rng(), ...extra });
}

function pickup(g, kind, x, y) { return add(g, { kind, x, y, r: kind === 'ring' ? 1.4 : 0.7, pickup: true, seed: g.rng() }); }

/** A row of obstacles with a guaranteed gap; a reward sits in the gap to show the route. */
function gate(g, kind, y, diff, rFn) {
  const gapW = 4.4 - diff * 1.2;
  const gx = (g.rng() * 2 - 1) * (FIELD - gapW / 2 - 0.5);
  for (let x = -FIELD; x <= FIELD; x += 1.7) {
    if (Math.abs(x - gx) < gapW / 2 + 0.6) continue;
    obstacle(g, kind, x + (g.rng() - 0.5) * 0.4, y + (g.rng() - 0.5) * 0.8, rFn());
  }
  if (g.rng() < 0.55) pickup(g, g.rng() < 0.6 ? 'ring' : 'fuel', gx, y);
}

function spawnPattern(g, name, y, sector, diff) {
  const r = g.rng;
  switch (name) {
    case 'birds': {
      const cx = (r() * 2 - 1) * 5, dir = r() < 0.5 ? -1 : 1;
      for (let i = 0; i < 5 + diff * 4; i++) obstacle(g, 'bird', cx + (r() - 0.5) * 6, y + (r() - 0.5) * 5, 0.45, { vx: dir * (2 + r() * 2) });
      return 8;
    }
    case 'balloons':
      for (const p of scatter(g, 3 + Math.round(diff * 3), y, 14, 3.4)) obstacle(g, 'balloon', p.x, p.y, 0.8, { vy: 1.5 });
      return 14;
    case 'storm': {
      const w = 3.5 + r() * 2;
      add(g, { kind: 'storm', x: (r() * 2 - 1) * (FIELD - w), y: y + 6, w, timer: 1.4, strike: null, alien: sector >= 3 });
      return 14;
    }
    case 'jet': {
      const dir = r() < 0.5 ? 1 : -1;
      obstacle(g, 'jet', -dir * (FIELD + 5), y, 0.9, { armed: false, warn: 0, dir });
      return 6;
    }
    case 'comet': {
      const dir = r() < 0.5 ? 1 : -1;
      obstacle(g, 'comet', -dir * (FIELD + 5), y + 8, 1.1, { armed: false, warn: 0, dir, diag: true });
      return 10;
    }
    case 'cloudGate':
      gate(g, 'cloudlet', y, diff, () => 0.95);
      return 4;
    case 'rings': {
      const x0 = (r() * 2 - 1) * 5, dx = (r() - 0.5) * 2.2;
      for (let i = 0; i < 4; i++) pickup(g, 'ring', clamp(x0 + dx * i + Math.sin(i) * 1.2, -FIELD + 1, FIELD - 1), y + i * 5);
      return 18;
    }
    case 'pickups': {
      const kinds = g.energy < 45 ? ['fuel', 'fuel', 'repair'] : ['fuel', 'repair', 'cool', 'shield', 'fuel'];
      const x0 = (r() * 2 - 1) * 5;
      for (let i = 0; i < 3; i++) pickup(g, kinds[Math.floor(r() * kinds.length)], clamp(x0 + (r() - 0.5) * 4, -FIELD + 1, FIELD - 1), y + i * 4);
      return 10;
    }
    case 'current': {
      const w = 1.8 + r() * 0.8, h = 9 + r() * 5;
      add(g, { kind: 'current', x: (r() * 2 - 1) * (FIELD - w), y: y + h, w, h });
      if (r() < 0.6) pickup(g, 'ring', 0, y + h);
      return h * 2;
    }
    case 'dust': {
      const w = 3 + r() * 2.5, h = 7 + r() * 5;
      add(g, { kind: 'dust', x: (r() * 2 - 1) * (FIELD - w * 0.6), y: y + h, w, h });
      return h * 2;
    }
    case 'debris':
      for (const p of scatter(g, 6 + Math.round(diff * 6), y, 18, 2.6)) obstacle(g, 'debris', p.x, p.y, 0.5 + r() * 0.3, { vx: (r() - 0.5) * 1.5 });
      return 18;
    case 'satellites':
      for (const p of scatter(g, 2 + Math.round(diff * 2), y, 14, 5)) obstacle(g, 'junk', p.x, p.y, 1.2, { vx: (r() - 0.5) * 2 });
      return 14;
    case 'junkGate':
      gate(g, 'debris', y, diff, () => 0.55 + r() * 0.25);
      return 4;
    case 'drift': {
      for (let lane = 0; lane < 3; lane++) {
        const dir = lane % 2 ? 1 : -1;
        for (let i = 0; i < 3; i++) obstacle(g, 'debris', -FIELD + i * 6 + r() * 2, y + lane * 5, 0.6, { vx: dir * (2.5 + diff * 2), wrap: true });
      }
      return 15;
    }
    case 'rocks':
      for (const p of scatter(g, 4 + Math.round(diff * 5), y, 18, 3.2)) obstacle(g, 'rock', p.x, p.y, 0.7 + r() * 0.9, { vx: (r() - 0.5) * 1.2 });
      return 18;
    case 'rockGate':
      gate(g, 'rock', y, diff, () => 0.7 + r() * 0.4);
      return 4;
    case 'planet': {
      const side = r() < 0.5 ? -1 : 1;
      add(g, { kind: 'planet', x: side * (FIELD + 1.5), y: y + 9, r: 4.2, R: 8.2, used: false, hue: Math.floor(r() * 3) });
      pickup(g, 'ring', side * (FIELD - 4.5), y + 9);
      return 18;
    }
    case 'blackhole': {
      const x = (r() * 2 - 1) * 4.5;
      add(g, { kind: 'blackhole', x, y: y + 12, rh: 1.5 + diff * 0.5, R: 14, k: 70 + sector * 8 });
      return 26;
    }
    case 'wormhole':
      add(g, { kind: 'wormhole', x: (r() * 2 - 1) * 5, y: y + 4, r: 1.5 });
      return 8;
    case 'shards':
      for (const p of scatter(g, 5 + Math.round(diff * 5), y, 18, 3)) obstacle(g, 'shard', p.x, p.y, 0.7 + r() * 0.6, { osc: r() < 0.4 ? 1.5 + r() : 0, ox: p.x });
      return 18;
    case 'shardGate':
      gate(g, 'shard', y, diff, () => 0.8);
      return 4;
    case 'uapFriendly': case 'uapScanner': case 'uapBlocker': case 'uapBeam': {
      const role = name.slice(3).toLowerCase();
      // UAPs hover relative to the rocket; `trigger` is the altitude where they show up
      add(g, { kind: 'uap', role, trigger: y, active: false, x: (r() * 2 - 1) * 5, rel: 30, t: 0, life: role === 'friendly' ? 8 : role === 'blocker' ? 7 : 7.5, r: 1.3, dropped: 0, beamX: 0 });
      return 10;
    }
  }
  return 6;
}

function director(g) {
  while (g.nextSpawn < g.dist + VIEW_AHEAD && g.nextSpawn < TOTAL - 40) {
    const sector = sectorAt(g.nextSpawn);
    const within = (g.nextSpawn - SECTOR_STARTS[sector]) / SECTORS[sector].len;
    const diff = clamp(sector / 6 + within * 0.35, 0, 1);
    const list = PATTERNS[SECTORS[sector].id].filter(([n]) =>
      !(SPECIAL.has(n) && n === g.lastPattern) &&
      !(n.startsWith('uap') && g.entities.some(e => e.kind === 'uap')));
    const name = pick(g, list);
    g.lastPattern = name;
    const span = spawnPattern(g, name, g.nextSpawn, sector, diff);
    g.nextSpawn += span + 7 + g.rng() * 6 - diff * 3;
  }
  if (!g.portal && g.dist > TOTAL - VIEW_AHEAD) g.portal = add(g, { kind: 'portal', x: 0, y: TOTAL, r: 6 });
}

function startEvent(g) {
  const id = SECTORS[g.sector].events[Math.floor(g.rng() * SECTORS[g.sector].events.length)];
  const ev = EVENTS[id];
  banner(g, ev.text, ev.tone);
  g.out.push({ t: 'event', id });
  if (id === 'shower') {
    const n = 6 + g.sector * 2;
    for (let i = 0; i < n; i++) add(g, { kind: 'warn', x: (g.rng() * 2 - 1) * (FIELD - 0.5), delay: i * 0.55 + g.rng() * 0.3, t: 1.1 });
  } else if (id === 'hail') {
    add(g, { kind: 'uap', role: 'friendly', trigger: g.dist, active: false, x: (g.rng() * 2 - 1) * 5, rel: 30, t: 0, life: 8, r: 1.3, dropped: 0, beamX: 0 });
  } else {
    g.mods = g.mods.filter(m => m.id !== id);
    g.mods.push({ id, t: ev.dur });
  }
}

// ------------------------------------------------------------------ step

/** Advance the game. input = { steer: −1..1, targetX: number|null, boost: boolean }. */
export function step(g, dt, input = {}) {
  dt = Math.min(dt, 0.05);
  if (g.phase === 'countdown') {
    g.countdown -= dt;
    if (g.countdown <= 0) { g.phase = 'fly'; banner(g, 'LIFTOFF!', 'gold'); g.out.push({ t: 'liftoff' }); }
    return;
  }
  if (g.phase !== 'fly') return;
  g.t += dt;
  g.stats.time += dt;

  for (const m of g.mods) m.t -= dt;
  g.mods = g.mods.filter(m => m.t > 0);
  g.invuln = Math.max(0, g.invuln - dt);
  g.shield = Math.max(0, g.shield - dt);
  g.jam = Math.max(0, g.jam - dt);
  g.burst = Math.max(0, g.burst - dt);

  // ---------------------------------------------------------- environment
  const fx = g.fx;
  fx.dust = fx.current = fx.beam = fx.horizon = fx.storm = false;
  fx.pull = 0;
  let speedMul = 1, ax = 0, pullSpeed = 0, beamMul = 1;
  for (const e of g.entities) {
    if (e.kind === 'dust' && Math.abs(g.x - e.x) < e.w && Math.abs(g.dist - e.y) < e.h) { speedMul *= 0.55; fx.dust = true; }
    if (e.kind === 'current' && Math.abs(g.x - e.x) < e.w && Math.abs(g.dist - e.y) < e.h) { speedMul *= 1.55; fx.current = true; ax += (e.x - g.x) * 3; }
    if (e.kind === 'blackhole') {
      const dx = e.x - g.x, dy = e.y - g.dist, d = Math.hypot(dx, dy);
      if (d < e.R) {
        const f = e.k / Math.pow(Math.max(d, 1.1), 1.25);
        ax += (dx / d) * f;
        pullSpeed += (dy / d) * f * 0.55; // ahead: drags you in faster; behind: holds you back
        fx.pull = Math.max(fx.pull, 1 - d / e.R);
        if (d < e.rh) {
          fx.horizon = true;
          g.hull -= 32 * dt;
          if (g.hull <= 0) lose(g, 'blackhole');
        }
      }
    }
    if (e.kind === 'uap' && e.active && e.role === 'beam' && e.beaming && Math.abs(g.x - e.x) < 1.6) {
      fx.beam = true;
      beamMul = 0.42;
      ax += (e.x - g.x) * 9;
      g.energy -= 6 * dt;
    }
    if (e.kind === 'storm' && Math.abs(g.x - e.x) < e.w && Math.abs(g.dist - e.y) < 3.5) fx.storm = true;
  }
  if (hasMod(g, 'headwind')) speedMul *= 0.72;

  // ---------------------------------------------------------- engine
  const surge = hasMod(g, 'surge');
  const wantBoost = !!input.boost && g.energy > 0 && !g.overheated && g.jam <= 0;
  g.boosting = wantBoost || surge;
  const drain = 1.1 * (hasMod(g, 'leak') ? 3.2 : 1) + (wantBoost ? 14 : 0);
  g.energy = clamp(g.energy - drain * dt, 0, 100);

  let heatRate = g.boosting ? 22 : -15;
  if (g.sector === 0 && g.speed > 30) heatRate += 12; // thick air heats a fast climb
  if (g.speed > 46) heatRate += 9;
  if (fx.storm) heatRate += 6;
  g.heat = clamp(g.heat + heatRate * dt, 0, 100);
  if (g.heat >= 100 && !g.overheated) { g.overheated = true; banner(g, 'OVERHEATING! Ease off the boost', 'magenta'); g.out.push({ t: 'overheat' }); }
  if (g.overheated) {
    g.hull -= 7 * dt;
    if (g.hull <= 0) lose(g, 'heat');
    if (g.heat < 55) { g.overheated = false; banner(g, 'Engines cooled', 'cyan'); }
  }

  const sec = SECTORS[g.sector];
  let target = sec.cruise * (g.energy <= 0 ? 0.6 : 1) * speedMul * beamMul;
  if (g.boosting) target += 15;
  if (g.burst > 0) target += 16;
  if (hasMod(g, 'tailwind')) target += 8;
  if (g.jam > 0) target *= 0.8;
  target += pullSpeed;
  g.speed += (target - g.speed) * Math.min(1, dt * (target > g.speed ? 1.7 : 2.4));
  g.speed = clamp(g.speed, 3, 80);
  g.stats.maxSpeed = Math.max(g.stats.maxSpeed, g.speed);
  g.dist += g.speed * dt;

  // ---------------------------------------------------------- steering
  const agility = hasMod(g, 'ion') ? 0.45 : 1;
  const maxLat = g.boosting ? 18 : 13;
  const desired = input.targetX != null
    ? clamp((input.targetX - g.x) * 5, -maxLat, maxLat)
    : clamp((input.steer || 0) * maxLat, -maxLat, maxLat);
  g.vx += (desired - g.vx) * Math.min(1, dt * 7 * agility);
  g.vx += ax * dt;
  if (hasMod(g, 'wave')) g.vx += Math.sin(g.t * 2.6) * 11 * dt;
  g.x += g.vx * dt;
  if (Math.abs(g.x) > FIELD) { g.x = Math.sign(g.x) * FIELD; g.vx *= -0.3; }

  // ---------------------------------------------------------- sectors & events
  const s = sectorAt(g.dist);
  if (s !== g.sector) {
    g.sector = s;
    banner(g, `${SECTORS[s].icon} ${SECTORS[s].name}`, 'gold');
    g.out.push({ t: 'sector', i: s });
    g.nextEvent = g.t + 9;
  }
  if (g.t > g.nextEvent && g.dist < TOTAL - 120) { startEvent(g); g.nextEvent = g.t + 15 + g.rng() * 10; }

  director(g);
  updateEntities(g, dt);
  if (g.lost) return;

  if (g.dist >= TOTAL) {
    g.phase = 'won';
    g.won = true;
    g.out.push({ t: 'win' });
  }
}

function updateEntities(g, dt) {
  const ents = g.entities;
  for (const e of ents) {
    switch (e.kind) {
      case 'warn':
        if (e.delay > 0) { e.delay -= dt; break; }
        e.t -= dt;
        if (e.t <= 0) {
          e.dead = true;
          add(g, { kind: 'meteor', x: e.x, y: g.dist + 40, r: 0.65, dmg: OBSTACLE.meteor, vx: (g.rng() - 0.5) * 4, vy: -24, spin: 4, seed: g.rng() });
          g.out.push({ t: 'meteor' });
        }
        break;
      case 'jet': case 'comet':
        if (!e.armed && e.y - g.dist < 30) { e.armed = true; e.warn = 1.1; g.out.push({ t: 'warn', kind: e.kind }); }
        if (e.armed) {
          if (e.warn > 0) e.warn -= dt;
          else { e.x += e.dir * (e.kind === 'jet' ? 30 : 20) * dt; if (e.diag) e.y -= 9 * dt; }
          if (Math.abs(e.x) > FIELD + 8) e.dead = true;
        }
        break;
      case 'storm':
        if (Math.abs(e.y - g.dist) > 30) break;
        e.timer -= dt;
        if (!e.strike && e.timer <= 0) {
          // telegraph a bolt, biased toward the rocket so the player must react
          const bx = Math.abs(g.x - e.x) < e.w + 2 && g.rng() < 0.6 ? g.x : e.x + (g.rng() * 2 - 1) * e.w;
          e.strike = { x: clamp(bx, e.x - e.w, e.x + e.w), t: 0.85 };
          g.out.push({ t: 'charge' });
        } else if (e.strike) {
          e.strike.t -= dt;
          if (e.strike.t <= 0) {
            g.out.push({ t: 'bolt', x: e.strike.x, y: e.y, id: e.id });
            if (Math.abs(g.x - e.strike.x) < 1.2 && g.dist > e.y - 13 && g.dist < e.y) {
              if (hurt(g, 18, 'lightning', (g.x - e.strike.x) * 6 || 4)) g.energy = Math.max(0, g.energy - 15);
            }
            e.strike = null;
            e.timer = 1.3 + g.rng() * 0.9;
          }
        }
        break;
      case 'uap': updateUAP(g, e, dt); break;
      case 'planet':
        if (!e.used) {
          const d = Math.hypot(g.x - e.x, g.dist - e.y);
          if (d < e.R && d > e.r + ROCKET_R) {
            e.used = true;
            g.burst = 3.2;
            g.energy = Math.min(100, g.energy + 12);
            g.stats.slings++;
            banner(g, 'Planetary slingshot! Speed burst', 'cyan');
            g.out.push({ t: 'sling' });
          }
        }
        if (Math.hypot(g.x - e.x, g.dist - e.y) < e.r + ROCKET_R) hurt(g, 28, 'planet', -Math.sign(e.x) * 10);
        break;
      case 'wormhole':
        if (Math.hypot(g.x - e.x, g.dist - e.y) < e.r) {
          e.dead = true;
          const jump = Math.min(260, TOTAL - g.dist - 60);
          if (jump > 0) {
            g.dist += jump;
            for (const o of ents) if (o !== e && o.y < g.dist + 20 && o.kind !== 'uap') o.dead = true;
            g.nextSpawn = Math.max(g.nextSpawn, g.dist + 22);
            banner(g, `Wormhole! Skipped ${Math.round(jump * 10)} km`, 'cyan');
            g.out.push({ t: 'wormhole' });
          }
        }
        break;
      case 'portal': break;
      default:
        if (e.pickup) {
          if (Math.hypot(g.x - e.x, g.dist - e.y) < e.r + ROCKET_R) collect(g, e);
        } else if (OBSTACLE[e.kind] !== undefined) {
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          if (e.osc) e.x = e.ox + Math.sin(g.t * e.osc + e.seed * 6) * 2;
          if (e.wrap && Math.abs(e.x) > FIELD + 1.5) e.x = -Math.sign(e.x) * (FIELD + 1.4);
          if (e.kind === 'cloudlet') break; // soft clouds only slow you a little
          if (Math.hypot(g.x - e.x, g.dist - e.y) < e.r + ROCKET_R) {
            if (hurt(g, e.dmg, e.kind, (g.x - e.x >= 0 ? 1 : -1) * 7)) {
              if (e.kind !== 'jet' && e.kind !== 'comet') e.dead = true;
              g.out.push({ t: 'smash', x: e.x, y: e.y, kind: e.kind });
            }
          }
        }
    }
    if (e.kind === 'cloudlet' && Math.hypot(g.x - e.x, g.dist - e.y) < e.r + ROCKET_R) { g.speed *= 1 - 1.5 * dt; g.fx.dust = true; }
    // tall zones and black holes reach well below their centre, so measure from their far edge
    if (e.kind !== 'uap' && e.kind !== 'warn' && e.y + (e.h || e.R || 0) < g.dist - 30) e.dead = true;
  }
  g.entities = ents.filter(e => !e.dead);
}

function collect(g, e) {
  e.dead = true;
  g.stats.pickups++;
  g.out.push({ t: 'pickup', kind: e.kind, x: e.x, y: e.y });
  if (e.kind === 'fuel') g.energy = Math.min(100, g.energy + 25);
  else if (e.kind === 'repair') g.hull = Math.min(100, g.hull + 20);
  else if (e.kind === 'cool') { g.heat = Math.max(0, g.heat - 45); if (g.heat < 55) g.overheated = false; }
  else if (e.kind === 'shield') g.shield = 6;
  else if (e.kind === 'ring') { g.burst = Math.max(g.burst, 1.6); g.energy = Math.min(100, g.energy + 4); }
}

function updateUAP(g, e, dt) {
  if (!e.active) {
    if (g.dist >= e.trigger) { e.active = true; g.out.push({ t: 'uap', role: e.role }); banner(g, UAP_TEXT[e.role][0], e.role === 'friendly' ? 'cyan' : 'magenta'); }
    else return;
  }
  e.t += dt;
  const leaving = e.t > e.life;
  const enter = Math.min(1, e.t / 1.4);
  if (e.role === 'blocker') {
    // drift into the rocket's path and sink past it; dodge at the last moment
    e.rel = 22 - e.t * 4.5;
    e.x += clamp(g.x - e.x, -1, 1) * 3.2 * dt;
    if (Math.hypot(g.x - e.x, g.dist - (g.dist + e.rel)) < e.r + ROCKET_R) hurt(g, 18, 'uap', (g.x - e.x >= 0 ? 1 : -1) * 9);
    if (e.rel < -14) e.dead = true;
  } else {
    e.rel = leaving ? e.rel + 22 * dt : 30 - enter * (e.role === 'friendly' ? 22 : 18);
    if (e.role === 'friendly') {
      e.x += clamp(g.x + 2.5 * Math.sign(e.x || 1) - e.x, -1, 1) * 3 * dt;
      if (e.t > 2 && e.dropped < 3 && e.t > 2 + e.dropped * 1.1) {
        e.dropped++;
        add(g, { kind: e.dropped === 3 ? 'shield' : 'fuel', x: clamp(e.x, -FIELD + 1, FIELD - 1), y: g.dist + e.rel - 1, r: 0.7, pickup: true, seed: g.rng() });
        g.out.push({ t: 'drop' });
      }
    } else if (e.role === 'scanner') {
      e.x = Math.sin(e.t * 0.9) * 4;
      e.beamX = e.x + Math.sin(e.t * 2.2) * 3.5;
      e.scanning = e.t > 1.6 && !leaving;
      if (e.scanning && Math.abs(g.x - e.beamX) < 1.1) {
        g.scan += dt * 1.1;
        if (g.scan >= 1) { g.scan = 0; g.jam = 3.5; banner(g, 'Scanned! Systems jammed', 'magenta'); g.out.push({ t: 'jam' }); }
      } else g.scan = Math.max(0, g.scan - dt * 0.6);
    } else if (e.role === 'beam') {
      // lights blink to telegraph, then the beam drops
      e.warning = e.t > 1.2 && e.t < 2.6;
      e.beaming = e.t >= 2.6 && !leaving;
      if (!e.beaming && !leaving) e.x += clamp(g.x - e.x, -1, 1) * 2.5 * dt;
      if (e.t >= 2.6 && !e.beamSound) { e.beamSound = true; g.out.push({ t: 'beam' }); }
    }
    if (leaving && e.rel > 50) e.dead = true;
  }
  e.y = g.dist + e.rel;
}

const UAP_TEXT = {
  friendly: ['Friendly UAP — grab its energy!'],
  scanner: ['UAP scanner — avoid the beam'],
  blocker: ['UAP blocking your route!'],
  beam: ['Tractor beam! Stay clear']
};

export function progress(g) { return clamp(g.dist / TOTAL, 0, 1); }
export function starRating(g) { return g.won ? (g.hull >= 70 ? 3 : g.hull >= 35 ? 2 : 1) : 0; }
