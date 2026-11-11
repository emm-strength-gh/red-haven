import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, CARS, AI_NAMES, AI_COLORS } from '../src/racing-tracks.js';
import {
  buildTrack, setupRace, stepWorld, makeCar, placeOnTrack, stepCarPhysics, queryTrack, mainProgress,
  formatTime, makeAI, mulberry32, createWorld, rampHeight, gapAt, pathPoint
} from '../src/racing-sim.js';

const built = TRACKS.map((t) => buildTrack(t));
const DT = 1 / 120;

test('six tracks with unique ids build without NaNs', () => {
  assert.equal(TRACKS.length, 6);
  assert.equal(new Set(TRACKS.map((t) => t.id)).size, 6);
  for (const T of built) {
    assert.ok(T.L > 600 && T.L < 2000, `${T.def.id} length ${T.L}`);
    for (const p of T.paths) for (let i = 0; i < p.n; i++) assert.ok(Number.isFinite(p.x[i] + p.z[i] + p.y[i] + p.w[i]), `${T.def.id} NaN`);
    for (const f of T.features) assert.ok(f.s >= 0 && f.s < T.L, `${T.def.id} feature ${f.type} off track`);
  }
});

test('every shortcut is actually shorter than the main track it replaces', () => {
  for (const T of built) {
    for (const p of T.paths.slice(1)) {
      const mainLen = ((p.b - p.a) % T.L + T.L) % T.L;
      assert.ok(p.len < mainLen, `${T.def.id} ${p.name}: ${p.len.toFixed(0)} vs ${mainLen.toFixed(0)}`);
    }
  }
});

test('progress along a shortcut maps onto the main track continuously', () => {
  for (const T of built) {
    for (let pi = 1; pi < T.paths.length; pi++) {
      const p = T.paths[pi];
      let prev = null;
      for (let s = 10; s < p.len - 10; s += 4) {
        const i = Math.round(s / p.step);
        const q = queryTrack(T, p.x[i], p.z[i], p.y[i] + 0.3);
        assert.ok(q.inside, `${T.def.id} ${p.name} sample inside`);
        const ms = mainProgress(T, q);
        if (prev != null) {
          let d = ms - prev; if (d < -T.L / 2) d += T.L;
          assert.ok(d > -1 && d < 40, `${T.def.id} ${p.name} progress jump ${d}`);
        }
        prev = ms;
      }
    }
  }
});

test('ramps rise from zero and gaps have no road', () => {
  const canyon = built.find((t) => t.def.id === 'canyon');
  const kick = canyon.ramps.find((r) => r.type === 'kicker');
  assert.equal(rampHeight(canyon, kick.s - 1, 0), 0);
  assert.ok(rampHeight(canyon, kick.s + kick.len * 0.95, 0) > kick.h * 0.8);
  const gap = canyon.gaps[0];
  assert.ok(gapAt(canyon, gap.s + gap.len / 2));
  assert.equal(gapAt(canyon, gap.s - 5), null);
});

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00.00');
  assert.equal(formatTime(65.432), '1:05.43');
  assert.equal(formatTime(null), '--:--.--');
});

test('throttle accelerates, brake stops then reverses, steering right turns right', () => {
  const car = makeCar(CARS[0]);
  car.h = 0;
  const road = { grip: 1, maxMul: 1 };
  for (let i = 0; i < 240; i++) stepCarPhysics(car, { steer: 0, throttle: 1, brake: 0 }, road, DT);
  assert.ok(car.speed > 30 && car.speed <= CARS[0].top, `speed ${car.speed}`);
  const z0 = car.z;
  assert.ok(z0 > 20, 'moved forward along +z for heading 0');
  // right is (-cos h, sin h) = -x at heading 0
  for (let i = 0; i < 60; i++) stepCarPhysics(car, { steer: 1, throttle: 1, brake: 0 }, road, DT);
  assert.ok(car.h < 0, 'steering right lowers the heading');
  for (let i = 0; i < 600; i++) stepCarPhysics(car, { steer: 0, throttle: 0, brake: 1 }, road, DT);
  assert.ok(car.speed < 0, 'holding brake from a stop reverses');
  assert.ok(car.speed >= -CARS[0].top * 0.3 - 0.01);
});

test('nitro raises top speed and drains', () => {
  const a = makeCar(CARS[0]), b = makeCar(CARS[0]);
  a.nitro = b.nitro = 1;
  const road = { grip: 1, maxMul: 1 };
  for (let i = 0; i < 360; i++) {
    stepCarPhysics(a, { steer: 0, throttle: 1, brake: 0, nitro: false }, road, DT);
    stepCarPhysics(b, { steer: 0, throttle: 1, brake: 0, nitro: true }, road, DT);
  }
  assert.ok(b.speed > a.speed + 5, `${b.speed} vs ${a.speed}`);
  assert.ok(b.nitro < 0.2);
});

test('laps only count forward: reversing over the line does not add a lap', () => {
  const T = built[0];
  const w = createWorld(T, { laps: 3 });
  const car = makeCar(CARS[0]);
  w.cars = [car]; w.player = car;
  placeOnTrack(T, car, T.L - 5, 0, 0);
  car.dist = -5;
  w.phase = 'race';
  const step = (s) => {
    const p = pathPoint(T.main, ((s % T.L) + T.L) % T.L);
    car.x = p.x; car.z = p.z; car.y = p.y; car.vx = car.vz = car.vy = 0; car.h = Math.atan2(p.tx, p.tz);
    stepWorld(w, DT);
  };
  // creep forward over the line, back again, forward again
  for (let s = T.L - 5; s < T.L + 5; s += 0.5) step(s);
  for (let s = T.L + 5; s > T.L - 5; s -= 0.5) step(s);
  for (let s = T.L - 5; s < T.L + 5; s += 0.5) step(s);
  assert.equal(car.maxLap, 0);
  assert.ok(Math.abs(car.dist - 5) < 3, `dist ${car.dist}`);
});

test('AI completes a 3-lap race on every track without getting stuck', () => {
  for (const T of built) {
    const opp = [1, 2, 3, 0, 1].map((k, i) => ({ spec: CARS[k], name: AI_NAMES[i], color: AI_COLORS[i] }));
    const w = setupRace(T, { playerSpec: CARS[0], opponents: opp, difficulty: 'normal', seed: 3 });
    w.player.ai = makeAI(mulberry32(5), 'hard', 9);
    let respawns = 0;
    while (w.t < 200 && !w.cars.every((c) => c.finished)) {
      stepWorld(w, DT);
      for (const e of w.events) if (e.type === 'respawn' && e.why === 'stuck') respawns++;
      w.events.length = 0;
    }
    assert.ok(w.cars.every((c) => c.finished), `${T.def.id}: not everyone finished`);
    for (const c of w.cars) {
      assert.equal(c.laps.length, 3);
      for (const l of c.laps) assert.ok(l > 15 && l < 60, `${T.def.id} ${c.name} lap ${l.toFixed(1)}`);
    }
    assert.ok(respawns <= 3, `${T.def.id}: ${respawns} stuck respawns`);
  }
});
