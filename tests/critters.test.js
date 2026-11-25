import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatch, step, fire, explode, active, isAlive, teamHp, canTeleport, hitC, WEAPONS, WEAPON_ORDER, INF, SIZES,
} from '../src/critters-sim.js';
import { createCpu } from '../src/critters-ai.js';
import { LEVELS, STAGES, THEMES, SHAPES, SKIRMISH_DEFAULTS, levelMatch, skirmishMatch, demoMatch } from '../src/critters-levels.js';

const team = (name, cpu, n, hp = 100, extra = {}) => ({
  name, color: cpu ? '#3aa0ff' : '#ff8a1f', cpu, difficulty: 'medium', ammo: { rocket: INF, grenade: 3, teleport: 1, skip: INF, dynamite: 1 },
  members: Array.from({ length: n }, (_, i) => ({ name: `${name}${i}`, hp })), ...extra,
});
const base = (o = {}) => ({ W: SIZES.S, shape: 'hills', seed: 1234, wind: 0, crates: 0, mines: 0, barrels: 0, teams: [team('A', false, 2), team('B', true, 2)], ...o });
const run = (S, sec) => { for (let t = 0; t < sec; t += 1 / 60) step(S, 1 / 60); };
const critterList = (S) => S.bodies.filter((b) => b.kind === 'critter');

function assertSpawned(S, label) {
  const want = S.teams.reduce((n, t) => n + t.members.length, 0);
  const cs = critterList(S);
  assert.equal(cs.length, want, `${label}: every critter spawned`);
  for (const c of cs) {
    assert.ok(c.y > S.water, `${label}: ${c.name} above the water`);
    assert.ok(c.x > 0 && c.x < S.W, `${label}: ${c.name} inside the map`);
    assert.ok(!hitC(S, c.x, c.y, c.r - 2), `${label}: ${c.name} not stuck in rock`);
  }
}

test('every terrain shape spawns all critters on dry land', () => {
  for (const s of SHAPES) {
    for (const size of ['S', 'L']) {
      const S = createMatch(base({ shape: s.id, W: SIZES[size], seed: 77, teams: [team('A', false, 4), team('B', true, 4)] }));
      assertSpawned(S, `${s.id}/${size}`);
      assert.equal(S.phase, 'start');
      assert.ok(active(S), `${s.id}: someone has the first turn`);
    }
  }
});

test('an explosion carves the ground and hurts critters nearby', () => {
  const S = createMatch(base());
  const c = active(S);
  const below = Math.floor(c.y - c.r - 6);
  const solidBefore = S.mask[below * S.W + Math.floor(c.x)];
  assert.equal(solidBefore, 1, 'ground under the critter is dirt');
  const hp = c.hp;
  explode(S, c.x, c.y - c.r, 40, 40, 1);
  assert.equal(S.mask[below * S.W + Math.floor(c.x)], 0, 'crater carved');
  assert.ok(c.hp < hp, 'critter took damage');
  assert.ok(S.events.some((e) => e.type === 'boom'));
  assert.ok(S.events.some((e) => e.type === 'hurt' && e.id === c.id));
});

test('skipping passes the turn to the other team', () => {
  const S = createMatch(base());
  const first = S.teamTurn;
  const r = fire(S, { weapon: 'skip' });
  assert.ok(r.ok);
  run(S, 4);
  assert.notEqual(S.teamTurn, first, 'other team is up');
  assert.equal(S.turnCount, 1);
});

test('a rocket flies and explodes', () => {
  const S = createMatch(base());
  const c = active(S);
  const r = fire(S, { weapon: 'rocket', elev: 0.7, facing: 1, power: 0.7 });
  assert.ok(r.ok, r.why);
  assert.equal(S.projs.length, 1);
  let boomed = false;
  for (let t = 0; t < 10 && !boomed; t += 1 / 60) { step(S, 1 / 60); boomed = S.events.some((e) => e.type === 'boom' || e.type === 'splash'); }
  assert.ok(boomed, 'the rocket landed somewhere');
  assert.ok(isAlive(c));
});

test('a grenade waits for its fuse', () => {
  const S = createMatch(base());
  const r = fire(S, { weapon: 'grenade', elev: 1.2, facing: 1, power: 0.3 });
  assert.ok(r.ok, r.why);
  assert.equal(S.teams[active(S).team].ammo.grenade, 2, 'one grenade used');
  run(S, 2.5);
  assert.ok(!S.events.some((e) => e.type === 'boom'), 'no boom before the fuse burns down');
  run(S, 1.2);
  assert.ok(S.events.some((e) => e.type === 'boom' || e.type === 'splash'), 'boom after ~3 s');
});

test('teleport refuses solid rock and open sea', () => {
  const S = createMatch(base());
  const c = active(S);
  assert.equal(canTeleport(S, c, c.x, c.y - 40), false, 'inside the ground');
  assert.equal(canTeleport(S, c, c.x, S.water - 20), false, 'under the water line');
  assert.equal(canTeleport(S, c, c.x, S.H + 40), true, 'open sky');
  const bad = fire(S, { weapon: 'teleport', tx: c.x, ty: c.y - 40 });
  assert.equal(bad.ok, false);
  assert.equal(S.teams[c.team].ammo.teleport, 1, 'a refused teleport costs nothing');
});

test('every campaign level builds a fair match on every difficulty', () => {
  assert.equal(LEVELS.length, 20);
  assert.equal(new Set(LEVELS.map((L) => L.id)).size, 20, 'level ids are unique');
  STAGES.forEach((st, i) => {
    assert.ok(THEMES[st.theme], `${st.id} theme exists`);
    const lv = LEVELS.filter((L) => L.stage === i);
    assert.equal(lv.length, 4, `${st.id} has 4 levels`);
    assert.ok(lv[3].boss, `${st.id} ends with a boss`);
  });
  for (const L of LEVELS) {
    for (const d of ['easy', 'hard']) {
      const cfg = levelMatch(L, d);
      assert.equal(cfg.teams.filter((t) => !t.cpu).length, 1);
      for (const t of cfg.teams) for (const k of Object.keys(t.ammo)) assert.ok(WEAPONS[k], `${L.id}: weapon ${k} exists`);
      if (d === 'hard') continue;
      const S = createMatch(cfg);
      assertSpawned(S, `level ${L.id}`);
      if (L.boss) assert.ok(critterList(S).some((c) => c.boss), `${L.id}: boss spawned`);
    }
  }
  const easy = levelMatch(LEVELS[0], 'easy').teams[1].members[0].hp;
  const hard = levelMatch(LEVELS[0], 'hard').teams[1].members[0].hp;
  assert.ok(hard > easy, 'hard CPUs are tougher');
});

test('skirmish options turn into valid matches', () => {
  const combos = [
    { ...SKIRMISH_DEFAULTS },
    { ...SKIRMISH_DEFAULTS, theme: 'moon', shape: 'floaters', size: 'L', cpus: 3, you: 6, cpuSize: 6, gravity: 'theme', arsenal: 'boss' },
    { ...SKIRMISH_DEFAULTS, theme: 'frost', shape: 'caves', size: 'S', cpus: 2, you: 1, cpuSize: 1, mines: false, barrels: false, crates: false, sudden: 0, wind: 'off' },
  ];
  combos.forEach((o, i) => {
    const cfg = skirmishMatch(o, 'medium', 900 + i);
    assert.equal(cfg.teams.length, 1 + o.cpus);
    assert.ok(SHAPES.some((s) => s.id === cfg.shape), 'random shape resolved');
    assert.ok(THEMES[cfg.theme], 'random theme resolved');
    assertSpawned(createMatch(cfg), `skirmish ${i}`);
  });
  assert.equal(skirmishMatch(combos[1], 'medium', 1).gravity, 0.5, 'moon theme gravity');
});

test('CPU vs CPU plays a whole match to a winner', () => {
  const cfg = base({ seed: 4242, teams: [team('H', true, 2, 60, { difficulty: 'hard', ammo: { rocket: INF, grenade: 3, blaster: INF, bonk: INF, skip: INF } }), team('E', true, 2, 60, { difficulty: 'easy', ammo: { rocket: INF, grenade: 3, blaster: INF, bonk: INF, skip: INF } })] });
  const S = createMatch(cfg);
  const cpu = createCpu(S, 1e9);
  const kinds = new Set();
  for (let t = 0; t < 60 * 60 * 15 && !S.result; t++) {
    cpu.update(1 / 60);
    step(S, 1 / 60);
    for (const e of S.events) if (e.type === 'launch' || e.type === 'shot' || e.type === 'bonk') kinds.add(e.kind || e.type);
    S.events.length = 0;
  }
  assert.ok(S.result, `match finished (turns: ${S.turnCount})`);
  assert.ok(S.result.winner === -1 || teamHp(S, S.result.winner) > 0, 'winner has critters left');
  assert.ok(S.stats.some((s) => s.dmg > 0), 'someone did damage');
  assert.ok(kinds.size >= 1, 'CPUs used weapons');
});

test('the menu demo match is two CPU teams', () => {
  const cfg = demoMatch(5);
  assert.ok(cfg.teams.every((t) => t.cpu));
  assertSpawned(createMatch(cfg), 'demo');
  assert.deepEqual(WEAPON_ORDER, Object.keys(WEAPONS));
});
