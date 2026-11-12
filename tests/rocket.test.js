import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, SECTORS, SECTOR_STARTS, TOTAL, FIELD, sectorAt, starRating } from '../src/rocket-sim.js';

const DT = 1 / 60;
const fly = (g) => { g.phase = 'fly'; g.countdown = 0; };

test('sectors are contiguous and add up to the total climb', () => {
  assert.equal(SECTORS.length, 6);
  assert.equal(SECTOR_STARTS[0], 0);
  for (let i = 1; i < SECTORS.length; i++) assert.equal(SECTOR_STARTS[i], SECTOR_STARTS[i - 1] + SECTORS[i - 1].len);
  assert.equal(sectorAt(0), 0);
  assert.equal(sectorAt(TOTAL - 1), SECTORS.length - 1);
});

test('countdown leads to liftoff', () => {
  const g = createGame(1);
  for (let i = 0; i < 300 && g.phase === 'countdown'; i++) step(g, DT, {});
  assert.equal(g.phase, 'fly');
  assert.ok(g.out.some(m => m.t === 'liftoff'));
});

test('an invulnerable rocket can climb all the way to the rim without NaNs', () => {
  for (const seed of [3, 77, 2024]) {
    const g = createGame(seed);
    fly(g);
    let maxEnts = 0;
    const seen = new Set();
    for (let i = 0; i < 60 * 600 && g.phase === 'fly'; i++) {
      g.hull = 100; g.energy = Math.max(g.energy, 50); g.invuln = 1;
      step(g, DT, { steer: Math.sin(i / 90), boost: i % 400 < 120 });
      g.out.length = 0;
      for (const e of g.entities) seen.add(e.kind);
      maxEnts = Math.max(maxEnts, g.entities.length);
      assert.ok(Number.isFinite(g.x + g.dist + g.speed + g.heat + g.energy), `NaN at step ${i}`);
      assert.ok(Math.abs(g.x) <= FIELD + 1e-9);
    }
    assert.equal(g.phase, 'won', `seed ${seed} reached ${g.dist.toFixed(0)}/${TOTAL}`);
    assert.ok(maxEnts < 160, `entity count stays bounded (${maxEnts})`);
    for (const k of ['rock', 'debris', 'uap', 'blackhole']) assert.ok(seen.has(k), `seed ${seed} spawned a ${k}`);
  }
});

test('every gate leaves a gap wide enough to fly through', () => {
  const g = createGame(9);
  fly(g);
  for (let i = 0; i < 60 * 240; i++) { g.invuln = 1; g.hull = 100; step(g, DT, { steer: 0 }); g.out.length = 0; }
  // group static obstacles into rows by altitude and check for a gap wider than the rocket
  const rows = new Map();
  for (const e of g.entities) if (['rock', 'shard'].includes(e.kind) && !e.vx) {
    const k = Math.round(e.y / 2);
    rows.set(k, [...(rows.get(k) ?? []), e]);
  }
  for (const row of rows.values()) {
    if (row.length < 6) continue;
    const edges = row.map(e => [e.x - e.r, e.x + e.r]).sort((a, b) => a[0] - b[0]);
    let best = edges[0][0] + FIELD, end = edges[0][1];
    for (const [a, b] of edges.slice(1)) { best = Math.max(best, a - end); end = Math.max(end, b); }
    best = Math.max(best, FIELD - end);
    assert.ok(best > 1.4, `row gap ${best.toFixed(2)}`);
  }
});

test('boosting burns energy, heats the engine and goes faster', () => {
  const a = createGame(5), b = createGame(5);
  fly(a); fly(b);
  a.entities = b.entities = [];
  a.nextSpawn = b.nextSpawn = 1e9;
  for (let i = 0; i < 180; i++) { step(a, DT, { boost: true }); step(b, DT, {}); }
  assert.ok(a.speed > b.speed + 8);
  assert.ok(a.energy < b.energy - 20);
  assert.ok(a.heat > 40 && b.heat === 0);
});

test('running the engine hot overheats and damages the hull', () => {
  const g = createGame(5);
  fly(g);
  g.nextSpawn = 1e9;
  g.mods.push({ id: 'surge', t: 99 });
  for (let i = 0; i < 60 * 8; i++) step(g, DT, {});
  assert.ok(g.overheated || g.hull < 100);
  assert.ok(g.hull < 100);
});

test('a black hole pulls the rocket sideways and its horizon is deadly', () => {
  const g = createGame(5);
  fly(g);
  g.nextSpawn = 1e9;
  g.speed = 20;
  g.entities.push({ id: 999, kind: 'blackhole', x: 4, y: 6, rh: 1.6, R: 14, k: 80 });
  step(g, DT, {});
  assert.ok(g.vx > 0, 'pulled toward the hole');
  g.x = 4; g.dist = 6;
  const before = g.hull;
  step(g, DT, {});
  assert.ok(g.hull < before && g.fx.horizon);
});

test('speed zones change speed: currents accelerate, dust drags', () => {
  const base = () => { const g = createGame(2); fly(g); g.nextSpawn = 1e9; g.speed = 20; return g; };
  const cur = base(), dust = base(), none = base();
  cur.entities.push({ id: 1, kind: 'current', x: 0, y: 0, w: 3, h: 1e6 });
  dust.entities.push({ id: 1, kind: 'dust', x: 0, y: 0, w: 3, h: 1e6 });
  for (let i = 0; i < 120; i++) { step(cur, DT, {}); step(dust, DT, {}); step(none, DT, {}); }
  assert.ok(cur.speed > none.speed + 5);
  assert.ok(dust.speed < none.speed - 4);
});

test('pickups restore resources and stars reflect remaining hull', () => {
  const g = createGame(4);
  fly(g);
  g.nextSpawn = 1e9;
  g.energy = 10; g.hull = 50;
  g.entities.push({ id: 1, kind: 'fuel', x: 0, y: 0.5, r: 0.7, pickup: true }, { id: 2, kind: 'repair', x: 0, y: 0.8, r: 0.7, pickup: true });
  step(g, DT, {});
  assert.ok(g.energy > 30 && g.hull > 65);
  g.won = true; g.hull = 80;
  assert.equal(starRating(g), 3);
});
