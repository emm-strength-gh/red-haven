// Kaboom Critters — CPU players. The planner tries shots by running the real projectile physics
// (simulateShot) and scores each blast; the controller then walks, aims, charges and fires the way
// a player would. Difficulty sets how finely it searches, how well it reads the wind, how far it is
// willing to walk and how wobbly its final aim is.
import {
  PROJ, INF, simulateShot, launchSpeed, walkStep, solid, active, isAlive, fire, setControl, jump, selectWeapon, makeRng,
} from './critters-sim.js';

export const AI = {
  easy: { angStep: 0.17, powStep: 0.12, refine: 0, angErr: 0.1, powErr: 0.1, wind: 0.3, move: 0, pool: 6, margin: 99, think: 1.1, weapons: ['rocket', 'grenade', 'blaster', 'bonk'] },
  medium: { angStep: 0.1, powStep: 0.08, refine: 1, angErr: 0.035, powErr: 0.04, wind: 0.8, move: 110, pool: 3, margin: 18, think: 0.8, weapons: ['rocket', 'grenade', 'grapes', 'melon', 'bee', 'blaster', 'bonk', 'dynamite', 'airdrop'] },
  hard: { angStep: 0.07, powStep: 0.06, refine: 2, angErr: 0.007, powErr: 0.01, wind: 1, move: 220, pool: 1, margin: 8, think: 0.55, weapons: ['rocket', 'grenade', 'grapes', 'melon', 'bee', 'blaster', 'bonk', 'dynamite', 'airdrop'] },
};
const POWER_KEYS = ['rocket', 'grenade', 'grapes', 'melon', 'bee'];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function gauss(rnd) {
  const u = Math.max(1e-6, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// how likely a hit at this spot is to send a critter into the sea
function wetRisk(S, x, y) {
  let r = 0;
  const h = y - S.water;
  if (h < 60) r = 1; else if (h < 140) r = 0.5;
  if (x < 110 || x > S.W - 110) r = Math.max(r, 0.6);
  const open = (cx) => { for (let yy = y - 10; yy > S.water; yy -= 6) if (solid(S, cx, yy)) return false; return true; };
  if (open(x - 55) || open(x + 55)) r = Math.max(r, 0.4);
  return r;
}

function makeScorer(S, me) {
  const risk = new Map();
  for (const b of S.bodies) if (isAlive(b)) risk.set(b.id, wetRisk(S, b.x, b.y));
  let posKey = '', posRisk = 0;
  function score(x, y, R, dmg, pos, depth = 0) {
    let s = 0;
    for (const b of S.bodies) {
      if (b.gone || (b.kind === 'critter' && b.dead)) continue;
      let bx = b.x, by = b.y;
      if (b.id === me.id && pos) { bx = pos.x; by = pos.y; }
      const d = Math.hypot(bx - x, by - y), reach = R + b.r;
      if (d >= reach) continue;
      const f = 1 - d / reach, amt = dmg * f;
      if (b.kind === 'critter') {
        const take = Math.min(b.hp, amt), kill = amt >= b.hp;
        let wet = risk.get(b.id) || 0;
        if (b.id === me.id && pos) {
          const k = `${pos.x | 0},${pos.y | 0}`;
          if (k !== posKey) { posKey = k; posRisk = wetRisk(S, pos.x, pos.y); }
          wet = posRisk;
        }
        if (b.team === me.team) s -= take * (b.id === me.id ? 1.7 : 1.3) + (kill ? 70 : 0) + wet * f * 60;
        else s += take + (kill ? 45 : 0) + wet * f * 40;
      } else if (b.kind === 'barrel' && depth === 0) s += 0.7 * score(bx, by, 52, 40, pos, 1);
      else if (b.kind === 'mine' && depth === 0) s += 0.5 * score(bx, by, 44, 45, pos, 1);
      else if (b.kind === 'crate') s -= 2;
    }
    return s;
  }
  return score;
}

function nearestEnemy(S, me, x, y) {
  let best = Infinity;
  for (const b of S.bodies) if (isAlive(b) && b.team !== me.team) best = Math.min(best, Math.hypot(b.x - x, b.y - y));
  return best;
}

function clearLine(S, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 3);
  for (let i = 2; i < n - 2; i++) { const t = i / n; if (solid(S, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false; }
  return true;
}

// where can the critter get to by walking? (a clone walks with the real walking rules)
function walkSpots(S, me, maxDist) {
  const out = [];
  for (const dir of [-1, 1]) {
    const b = { x: me.x, y: me.y, r: me.r, rest: true, vx: 0, vy: 0 };
    for (let d = 1; d <= maxDist; d++) {
      if (!walkStep(S, b, dir) || !b.rest) break;
      if (d % 45 === 0 && b.y - S.water > 40) out.push({ x: b.x, y: b.y, dist: d, dir });
    }
  }
  return out;
}

function evalPower(S, me, score, pos, key, facing, elev, pw, wind) {
  const dx = facing * Math.cos(elev), dy = Math.sin(elev), sp = launchSpeed(pw);
  const sx = pos.x + dx * (me.r + 5), sy = pos.y + dy * (me.r + 5);
  const res = simulateShot(S, key, sx, sy, dx * sp, dy * sp, me, wind, 6);
  if (res.end === 'water' || res.end === 'out' || res.end === 'time') return { score: -500, near: nearestEnemy(S, me, res.x, res.y) + 400, ix: res.x, iy: res.y };
  const P = PROJ[key];
  let s = score(res.x, res.y, P.boom[0], P.boom[1], pos);
  if (P.split) s += 0.45 * score(res.x, res.y + 10, P.boom[0] * 2.2, PROJ[P.split.kind].boom[1] * 1.5, pos);
  return { score: s, near: nearestEnemy(S, me, res.x, res.y), ix: res.x, iy: res.y };
}

function* searchFrom(S, me, score, pos, cfg, has, wind, add, coarse) {
  let n = 0;
  const as = coarse ? cfg.angStep * 1.6 : cfg.angStep, ps = coarse ? cfg.powStep * 1.5 : cfg.powStep;
  for (const key of POWER_KEYS) {
    if (!has(key) || (coarse && key !== 'rocket' && key !== 'grenade')) continue;
    for (const facing of [-1, 1]) {
      for (let elev = -0.6; elev <= 1.46; elev += as) {
        for (let pw = 0.18; pw <= 1.0001; pw += ps) {
          const r = evalPower(S, me, score, pos, key, facing, elev, pw, wind);
          add({ ...r, key, facing, elev, power: pw, from: pos });
          if (++n % 20 === 0) yield;
        }
      }
    }
  }
  const foes = S.bodies.filter((b) => isAlive(b) && b.team !== me.team);
  if (has('blaster')) {
    for (const e of foes) {
      const dx = e.x - pos.x, dy = e.y - pos.y, d = Math.hypot(dx, dy);
      if (d > 850 || !clearLine(S, pos.x, pos.y, e.x, e.y)) continue;
      const hit = Math.min(e.hp, 32);
      add({ score: hit + (e.hp <= 32 ? 40 : 0) + (wetRisk(S, e.x, e.y) * 15), key: 'blaster', facing: dx >= 0 ? 1 : -1, elev: Math.atan2(dy, Math.abs(dx)), power: 0, from: pos, ix: e.x, iy: e.y });
    }
  }
  if (has('bonk')) {
    for (const e of foes) {
      const dx = e.x - pos.x, dy = e.y - pos.y;
      if (Math.hypot(dx, dy) > me.r + e.r + 14) continue;
      const facing = dx >= 0 ? 1 : -1;
      add({ score: Math.min(e.hp, 30) + (e.hp <= 30 ? 45 : 0) + wetRisk(S, e.x + facing * 120, e.y) * 50, key: 'bonk', facing, elev: 0.45, power: 0, from: pos, ix: e.x, iy: e.y });
    }
  }
  if (coarse) return;
  if (has('dynamite') && foes.some((e) => Math.hypot(e.x - pos.x, e.y - pos.y) < 60)) {
    let best = null;
    for (const dir of [-1, 1]) {
      const b = { x: pos.x, y: pos.y, r: me.r, rest: true, vx: 0, vy: 0 };
      for (let d = 0; d < 230; d++) if (!walkStep(S, b, dir) || !b.rest) break;
      const s = score(pos.x + me.facing * 8, pos.y - 2, 74, 75, b);
      if (!best || s > best.s) best = { s, dir };
    }
    add({ score: best.s, key: 'dynamite', facing: me.facing, elev: me.elev, power: 0, from: pos, retreat: best.dir, ix: pos.x, iy: pos.y });
  }
  if (has('airdrop')) {
    const bomb = PROJ.bomb;
    for (const e of foes) {
      for (const off of [-30, 0, 30]) {
        const tx = e.x + off, dir = tx >= pos.x ? 1 : -1;
        let s = 0;
        for (let i = 0; i < 5; i++) {
          const r = simulateShot(S, 'bomb', tx + (i - 2) * 26, S.H + 80 + i * 8, dir * 20, -40, me, wind, 6);
          if (r.end === 'hit') s += score(r.x, r.y, bomb.boom[0], bomb.boom[1], pos) * 0.8;
        }
        add({ score: s, key: 'airdrop', facing: dir, elev: me.elev, power: 0, from: pos, tx, ty: e.y, ix: tx, iy: e.y });
        if (++n % 4 === 0) yield;
      }
    }
  }
}

function* refine(S, me, score, c, cfg, wind, rounds) {
  let best = c;
  let as = cfg.angStep / 2, ps = cfg.powStep / 2;
  for (let r = 0; r < rounds; r++) {
    const base = best;
    let n = 0;
    for (let de = -2; de <= 2; de++) for (let dp = -2; dp <= 2; dp++) {
      const elev = base.elev + de * as, power = Math.min(1, Math.max(0.05, base.power + dp * ps));
      const res = evalPower(S, me, score, base.from, base.key, base.facing, elev, power, wind);
      if (res.score > best.score) best = { ...base, ...res, elev, power };
      if (++n % 10 === 0) yield;
    }
    as /= 2.5; ps /= 2.5;
  }
  return best;
}

/** Plan a turn for critter `me`. A generator so the work can be spread over frames. */
export function* planTurn(S, me, cfg, rnd) {
  const team = S.teams[me.team];
  const has = (k) => cfg.weapons.includes(k) && (team.ammo[k] ?? 0) !== 0;
  const special = (k) => team.ammo[k] !== INF;
  const wind = S.wind * cfg.wind;
  const score = makeScorer(S, me);
  const cands = [];
  const add = (c) => cands.push(c);
  const here = { x: me.x, y: me.y };
  yield* searchFrom(S, me, score, here, cfg, has, wind, add, false);
  const bestScore = () => cands.reduce((m, c) => Math.max(m, c.score), -Infinity);
  if (cfg.move && bestScore() < 30) {
    for (const sp of walkSpots(S, me, cfg.move)) yield* searchFrom(S, me, score, sp, cfg, has, wind, add, true);
  }
  for (const c of cands) c.adj = c.score - (special(c.key) ? cfg.margin : 0) - (c.from !== here ? 6 + (c.from.dist || 0) * 0.04 : 0);
  cands.sort((a, b) => b.adj - a.adj);
  let pick = null;
  if (cands.length && cands[0].adj > 4) {
    const pool = cands.filter((c) => c.adj > cands[0].adj * 0.55).slice(0, cfg.pool);
    pick = pool[Math.floor(rnd() * pool.length)];
  } else {
    // nothing good: lob something close to an enemy from where we stand
    const near = cands.filter((c) => c.from === here && POWER_KEYS.includes(c.key) && !special(c.key) && c.score > -60);
    near.sort((a, b) => a.near - b.near);
    pick = near[0] || null;
  }
  if (!pick) {
    const foe = S.bodies.find((b) => isAlive(b) && b.team !== me.team);
    return { key: 'rocket', facing: foe && foe.x < me.x ? -1 : 1, elev: 0.75, power: 0.7, from: here };
  }
  if (POWER_KEYS.includes(pick.key) && cfg.refine) pick = yield* refine(S, me, score, pick, cfg, wind, cfg.refine);
  const plan = { ...pick };
  if (plan.from !== here) plan.walkTo = plan.from.x;
  if (plan.retreat == null && plan.ix != null && Math.hypot(plan.ix - plan.from.x, plan.iy - plan.from.y) < 80 && plan.key !== 'bonk') plan.retreat = plan.ix > plan.from.x ? -1 : 1;
  return plan;
}

/** Re-aim from where the critter actually ended up after walking. */
function* reaim(S, me, plan, cfg) {
  const score = makeScorer(S, me);
  const wind = S.wind * cfg.wind;
  const pos = { x: me.x, y: me.y };
  if (POWER_KEYS.includes(plan.key)) {
    const base = { ...plan, from: pos, ...evalPower(S, me, score, pos, plan.key, plan.facing, plan.elev, plan.power, wind) };
    return { ...(yield* refine(S, me, score, base, { ...cfg, angStep: 0.12, powStep: 0.1 }, wind, 2)), walkTo: null };
  }
  if (plan.key === 'blaster' || plan.key === 'bonk') {
    const foes = S.bodies.filter((b) => isAlive(b) && b.team !== me.team);
    foes.sort((a, b) => Math.hypot(a.x - plan.ix, a.y - plan.iy) - Math.hypot(b.x - plan.ix, b.y - plan.iy));
    const e = foes[0];
    if (e) { const dx = e.x - pos.x; return { ...plan, facing: dx >= 0 ? 1 : -1, elev: plan.key === 'bonk' ? 0.45 : Math.atan2(e.y - pos.y, Math.abs(dx)), walkTo: null }; }
  }
  return { ...plan, walkTo: null };
}

/**
 * Drives every CPU team. Call update(dt) each frame before stepping the match.
 * budgetMs limits planning work per call (tests pass a big number).
 */
export function createCpu(S, budgetMs = 7) {
  let turnKey = -1, st = null;
  const api = {
    charge: 0, thinking: false, plan: null,
    update(dt) {
      api.thinking = false;
      if (S.result) return;
      const c = active(S);
      if (!c) return;
      const team = S.teams[c.team];
      if (!team.cpu) { st = null; turnKey = -1; return; }
      if (turnKey !== S.turnCount) {
        turnKey = S.turnCount;
        const cfg = AI[team.difficulty] || AI.medium;
        st = { mode: 'think', t: 0, gen: null, plan: null, cfg, rnd: makeRng(S.seed * 7 + S.turnCount * 7919 + 13), lastX: c.x, stuckT: 0, jumped: false, shots: 0 };
        api.charge = 0;
        api.plan = null;
      }
      if (S.phase === 'settle' || S.phase === 'over') { setControl(S, 0); return; }
      st.t += dt;
      const P = st.plan;
      switch (st.mode) {
        case 'think':
        case 'rethink': {
          api.thinking = true;
          if (!st.gen) st.gen = st.mode === 'think' ? planTurn(S, c, st.cfg, st.rnd) : reaim(S, c, P, st.cfg);
          const t0 = now();
          let r;
          do { r = st.gen.next(); } while (!r.done && now() - t0 < budgetMs);
          if (r.done) {
            st.plan = r.value;
            api.plan = st.plan;
            st.gen = null;
            st.mode = st.mode === 'think' ? 'wait' : 'aim';
            if (st.mode === 'aim') st.t = 0;
          }
          break;
        }
        case 'wait':
          api.thinking = true;
          if (S.phase === 'turn' && st.t > st.cfg.think) { st.mode = P.walkTo != null ? 'walk' : 'aim'; st.t = 0; st.lastX = c.x; }
          break;
        case 'walk': {
          const dx = P.walkTo - c.x;
          if (Math.abs(dx) < 1.5 || st.t > 6 || S.turnLeft < 9 || S.phase !== 'turn') {
            setControl(S, 0);
            st.mode = 'arrive';
            st.t = 0;
            break;
          }
          setControl(S, dx > 0 ? 1 : -1);
          if (Math.abs(c.x - st.lastX) > 0.5) { st.lastX = c.x; st.stuckT = 0; } else st.stuckT += dt;
          if (st.stuckT > 0.45) {
            if (!st.jumped && c.rest) { jump(S, false); st.jumped = true; st.stuckT = 0; } else { setControl(S, 0); st.mode = 'arrive'; st.t = 0; }
          }
          break;
        }
        case 'arrive':
          if (!c.rest && st.t < 3) break;
          st.mode = 'rethink';
          break;
        case 'aim': {
          if (!P.errApplied) {
            P.errApplied = true;
            P.elev += gauss(st.rnd) * st.cfg.angErr;
            if (P.power) P.power = Math.min(1, Math.max(0.05, P.power * (1 + gauss(st.rnd) * st.cfg.powErr)));
            if (P.tx != null) P.tx += gauss(st.rnd) * st.cfg.angErr * 260;
          }
          if (!selectWeapon(S, P.key)) { P.key = 'rocket'; selectWeapon(S, 'rocket'); }
          c.facing = P.facing;
          const de = P.elev - c.elev;
          c.elev += Math.sign(de) * Math.min(Math.abs(de), 1.8 * dt);
          if (Math.abs(de) < 0.005 && st.t > 0.4) { st.mode = POWER_KEYS.includes(P.key) ? 'charge' : 'fire'; st.t = 0; api.charge = 0; }
          if (S.turnLeft < 2) { c.elev = P.elev; st.mode = POWER_KEYS.includes(P.key) ? 'charge' : 'fire'; api.charge = P.power; }
          break;
        }
        case 'charge':
          api.charge = Math.min(P.power, api.charge + dt / 1.3);
          if (api.charge >= P.power - 1e-6) st.mode = 'fire';
          break;
        case 'fire': {
          if (S.phase !== 'turn') break;
          if (st.shots && st.t < 0.6) break;
          const r = fire(S, { weapon: P.key, elev: P.elev, facing: P.facing, power: P.power, tx: P.tx, ty: P.ty });
          st.shots++;
          st.t = 0;
          api.charge = 0;
          if (!r.ok) { fire(S, { weapon: 'skip' }); st.mode = 'done'; break; }
          if (!r.more) st.mode = 'retreat';
          break;
        }
        case 'retreat':
          if (S.phase === 'retreat' && P.retreat) setControl(S, P.retreat);
          else setControl(S, 0);
          break;
        default:
          setControl(S, 0);
      }
    },
  };
  return api;
}

