import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCity, createPuzzle, createSignalLevel, createState, planBuild, commitBuild, eraseTile, setControl, placeStop,
  createLine, nkey, simulate, step, vehPose, saveCity, loadCity, addHouse, addDest, rebuildNet, puzzleStars, TER, COST,
} from '../src/traffic-sim.js';
import { CITY_MAPS, PUZZLES, SIGNAL_LEVELS } from '../src/traffic-maps.js';

const tiles = (arr) => arr.map(([x, y]) => ({ x, y }));

function applySolution(S, P, swap = null) {
  for (const st of P.solution) {
    const [kind] = st;
    if (kind === 'stop') { const r = placeStop(S, st[1], st[2]); assert.equal(r.err, null, `${P.id} stop: ${r.err}`); continue; }
    if (kind === 'round' || kind === 'lights') { const r = setControl(S, st[1], st[2], kind); assert.equal(r.err, null, `${P.id} ${kind}: ${r.err}`); continue; }
    if (kind === 'line') { const r = createLine(S, st[1], st[2].map(([x, y]) => nkey(S, x, y, 0))); assert.equal(r.err, null, `${P.id} line: ${r.err}`); continue; }
    const k = swap && swap[kind] ? swap[kind] : kind;
    const plan = planBuild(S, tiles(st[2]), k, st[1]);
    assert.equal(plan.err, null, `${P.id} ${kind} ${JSON.stringify(st[2])}: ${plan.err}`);
    assert.ok(commitBuild(S, plan));
  }
}

// closest approach of two vehicles that are not simply following each other
function closest(S) {
  const vs = S.vehicles.filter((v) => v.active);
  const P = vs.map((v) => vehPose(S, v, v.len / 2, {}));
  let best = Infinity;
  for (let i = 0; i < vs.length; i++) for (let k = i + 1; k < vs.length; k++) {
    if (Math.abs(P[i].y - P[k].y) > 0.2) continue;
    const dot = P[i].hx * P[k].hx + P[i].hz * P[k].hz;
    if (dot > 0.9) continue;
    best = Math.min(best, Math.hypot(P[i].x - P[k].x, P[i].z - P[k].z));
  }
  return best;
}

test('city maps generate and start with two districts', () => {
  for (const def of CITY_MAPS) {
    const S = createCity(def);
    assert.equal(S.dests.length, 2, def.id);
    assert.ok(S.houses.length >= 3, `${def.id} houses ${S.houses.length}`);
    const b = S.bounds;
    for (const h of S.houses) assert.ok(h.x >= b.x0 && h.x <= b.x1 && h.y >= b.y0 && h.y <= b.y1, `${def.id} house outside start area`);
    for (const d of S.dests) assert.equal(S.terrain[d.lot.y * S.W + d.lot.x], TER.GRASS);
    assert.notEqual(S.dests[0].color, S.dests[1].color);
  }
});

test('every road puzzle can be won at par with its reference solution', () => {
  for (const P of PUZZLES) {
    const S = createPuzzle(P);
    applySolution(S, P);
    assert.equal(P.budget - S.money, P.par, `${P.id} cost`);
    let worst = Infinity;
    for (let t = 0; t < 300 && !S.result; t++) { simulate(S, 1); worst = Math.min(worst, closest(S)); }
    assert.equal(S.result, 'win', `${P.id} ${P.name}: ${S.gameOver && S.gameOver.reason} trips ${S.trips}`);
    assert.equal(puzzleStars(S), 3);
    assert.ok(worst > 0.15, `${P.id} vehicles overlapped (${worst.toFixed(3)})`);
  }
});

test('Express Way needs the motorway: plain roads are too slow', () => {
  const P = PUZZLES.find((p) => p.id === 'p8');
  const S = createPuzzle(P);
  applySolution(S, P, { motorway: 'road' });
  simulate(S, 300);
  assert.equal(S.result, 'lose');
});

test('signal levels: careful light changes win, all-green crashes', () => {
  for (const L of SIGNAL_LEVELS) {
    const S = createSignalLevel(L);
    assert.ok(S.portals.length >= 3, L.id);
    const ctrl = new Map();
    let crashes = 0;
    for (let t = 0; t < 300 && !S.result; t += 0.25) {
      for (const n of S.junctions) {
        const st = ctrl.get(n.key) || { i: 0, t: 0, go: true };
        st.t += 0.25;
        const train = n.cross && (n.barrier || S.trainWarn);
        if (st.go && (st.t > 3 || train)) { st.go = false; st.t = 0; }
        if (!st.go && !n.occ.length && st.t > 0.3) { st.go = true; st.t = 0; st.i ^= 1; }
        ctrl.set(n.key, st);
        for (let s = 0; s < 4; s++) if (n.sig[s] != null) n.sig[s] = st.go && (s & 1) === st.i && !train ? 'g' : 'r';
      }
      simulate(S, 0.25);
      crashes += S.events.filter((e) => e.t === 'crash').length;
      S.events.length = 0;
    }
    assert.equal(S.result, 'win', `${L.id} passed ${S.passed}/${L.goal} strikes ${S.strikes}`);
    assert.equal(crashes, 0, `${L.id} crashed`);
  }
  const S = createSignalLevel(SIGNAL_LEVELS[0]);
  for (const n of S.junctions) for (let s = 0; s < 4; s++) if (n.sig[s] != null) n.sig[s] = 'g';
  simulate(S, 60);
  assert.ok(S.strikes > 0, 'all green should cause a crash');
});

test('tapping a light goes red -> yellow (one car) -> green -> red', async () => {
  const { tapSignal } = await import('../src/traffic-sim.js');
  const S = createSignalLevel(SIGNAL_LEVELS[0]);
  const n = S.junctions[0];
  const side = n.sig.findIndex((s) => s != null);
  assert.equal(tapSignal(S, n.key, side), 'y');
  assert.equal(tapSignal(S, n.key, side), 'g');
  assert.equal(tapSignal(S, n.key, side), 'r');
});

function blank(W = 14, H = 10) {
  const S = createState({ W, H, mode: 'puzzle', money: 5000, income: false });
  S.level = { rate: 0.2 };
  S.goal = 9999;
  return S;
}

test('building rules: mountains, flyovers, motorways, railways', () => {
  const S = blank();
  for (let y = 0; y < S.H; y++) S.terrain[y * S.W + 6] = TER.MOUNTAIN;
  assert.match(planBuild(S, tiles([[4, 2], [5, 2], [6, 2], [7, 2]]), 'road').err, /tunnel/i);
  const tun = planBuild(S, tiles([[4, 2], [5, 2], [6, 2], [7, 2], [8, 2]]), 'road', 'down');
  assert.equal(tun.err, null);
  assert.deepEqual(tun.lv, [0, -1, -1, -1, 0]);
  assert.match(planBuild(S, tiles([[1, 1], [2, 1]]), 'road', 'up').err, /3 tiles/);
  // motorway crossing
  assert.ok(commitBuild(S, planBuild(S, tiles([[0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6]]), 'motorway')));
  assert.match(planBuild(S, tiles([[2, 4], [2, 5], [2, 6], [2, 7]]), 'road').err, /flyover or tunnel/);
  const exit = planBuild(S, tiles([[2, 4], [2, 5], [2, 6]]), 'road');
  assert.equal(exit.err, null);
  assert.equal(exit.cost, 20 + COST.interchange);
  const fly = planBuild(S, tiles([[3, 4], [3, 5], [3, 6], [3, 7], [3, 8]]), 'road', 'up');
  assert.equal(fly.err, null);
  assert.equal(fly.cost, 4 * 10 * 3);
  // railway may only cross a road straight on
  assert.ok(commitBuild(S, planBuild(S, tiles([[9, 1], [10, 1], [11, 1], [12, 1]]), 'road')));
  assert.equal(planBuild(S, tiles([[10, 0], [10, 1], [10, 2]]), 'rail').err, null);
  assert.match(planBuild(S, tiles([[10, 0], [10, 1], [11, 1]]), 'rail').err, /Erase|straight/);
  // erase refunds half
  const before = S.money;
  assert.ok(eraseTile(S, 12, 1) > 0);
  assert.equal(S.money, before + 5);
});

test('cars cross a flyover and a signalised junction without touching', () => {
  const S = blank(16, 12);
  // red flow west -> east, blue flow north -> south over a flyover, green flow through lights
  addHouse(S, 0, 3, 0); addHouse(S, 0, 4, 0); addHouse(S, 0, 5, 0);
  addDest(S, 13, 3, { x: 13, y: 4 }, 0);
  addHouse(S, 7, 0, 1); addHouse(S, 8, 0, 1); addHouse(S, 9, 0, 1);
  addDest(S, 7, 10, { x: 7, y: 10 }, 1);
  rebuildNet(S);
  const ok = (p) => { assert.equal(p.err, null, p.err); commitBuild(S, p); };
  ok(planBuild(S, tiles([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 4], [13, 4]]), 'road'));
  ok(planBuild(S, tiles([[0, 3], [1, 3], [1, 4]]), 'road'));
  ok(planBuild(S, tiles([[0, 5], [1, 5], [1, 4]]), 'road'));
  ok(planBuild(S, tiles([[7, 0], [7, 1], [7, 2], [7, 3]]), 'road'));
  ok(planBuild(S, tiles([[8, 0], [8, 1], [7, 1]]), 'road'));
  ok(planBuild(S, tiles([[9, 0], [9, 1], [8, 1]]), 'road'));
  ok(planBuild(S, tiles([[7, 3], [7, 4], [7, 5]]), 'road', 'up'));
  ok(planBuild(S, tiles([[7, 5], [7, 6], [7, 7], [7, 8], [7, 9], [7, 10]]), 'road'));
  // the flyover means (7,4) on the ground is not a junction
  assert.equal(S.nodes[nkey(S, 7, 4, 0)].j, false);
  assert.ok(S.nodes[nkey(S, 7, 4, 1)]);
  // lights where the red feeder joins
  assert.equal(setControl(S, 1, 4, 'lights').err, null);
  let worst = Infinity, phases = new Set();
  for (let t = 0; t < 120; t++) {
    simulate(S, 1);
    worst = Math.min(worst, closest(S));
    phases.add(S.nodes[nkey(S, 1, 4, 0)].lights.phase);
  }
  assert.ok(S.trips > 15, `trips ${S.trips}`);
  assert.ok(worst > 0.15, `overlap ${worst}`);
  assert.equal(phases.size, 2);
  const red = S.dests.find((d) => d.color === 0), blue = S.dests.find((d) => d.color === 1);
  assert.ok(red.served > 3 && blue.served > 3);
});

test('a level crossing keeps cars and trains apart', () => {
  const S = blank(16, 10);
  addHouse(S, 0, 4, 2); addHouse(S, 0, 5, 2);
  addDest(S, 13, 4, { x: 13, y: 4 }, 2);
  rebuildNet(S);
  const ok = (p) => { assert.equal(p.err, null, p.err); commitBuild(S, p); };
  ok(planBuild(S, tiles([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 4], [13, 4]]), 'road'));
  ok(planBuild(S, tiles([[0, 5], [1, 5], [1, 4]]), 'road'));
  ok(planBuild(S, tiles([[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 6], [8, 7], [8, 8], [8, 9]]), 'rail'));
  assert.ok(S.nodes[nkey(S, 8, 4)].cross);
  assert.equal(placeStop(S, 8, 0).err, null);
  assert.equal(placeStop(S, 8, 9).err, null);
  const r = createLine(S, 'train', [nkey(S, 8, 0), nkey(S, 8, 9)]);
  assert.equal(r.err, null);
  let worst = Infinity, barrier = 0;
  for (let t = 0; t < 150; t++) {
    simulate(S, 1);
    worst = Math.min(worst, closest(S));
    barrier += S.nodes[nkey(S, 8, 4)].barrier;
  }
  assert.ok(S.trips > 10, `trips ${S.trips}`);
  assert.ok(barrier > 3, 'barrier never came down');
  assert.ok(worst > 0.15, `train and car overlapped (${worst.toFixed(3)})`);
  assert.equal(r.line.veh.length, 1);
});

test('erasing a busy road tows cars home and keeps counters sane', () => {
  const P = PUZZLES.find((p) => p.id === 'p2');
  const S = createPuzzle(P);
  applySolution(S, P);
  simulate(S, 25);
  assert.ok(S.vehicles.length > 0);
  for (const x of [4, 5, 6]) eraseTile(S, x, 5);
  simulate(S, 20);
  for (const d of S.dests) { assert.ok(d.enroute >= 0 && d.pins >= 0); assert.ok(d.enroute <= d.pins + 3); }
  for (const v of S.vehicles) assert.ok(S.lanes.has(v.seg.key) || S.boxes.has(v.seg.key));
});

test('a city saves and loads with its network, buildings and lines', () => {
  const def = CITY_MAPS[0];
  const S = createCity(def);
  const d = S.dests[0];
  const h = S.houses.find((x) => x.color === d.color);
  // join one house to its destination with a straight-ish road using the planner
  const path = [];
  let x = h.x, y = h.y;
  path.push([x, y]);
  while (x !== d.lot.x) { x += Math.sign(d.lot.x - x); path.push([x, y]); }
  while (y !== d.lot.y) { y += Math.sign(d.lot.y - y); path.push([x, y]); }
  const plan = planBuild(S, tiles(path), 'road');
  if (!plan.err) commitBuild(S, plan);
  simulate(S, 60);
  const data = JSON.parse(JSON.stringify(saveCity(S)));
  const L = loadCity(def, data);
  assert.equal(L.links.size, S.links.size);
  assert.equal(L.houses.length, S.houses.length);
  assert.equal(L.dests.length, S.dests.length);
  assert.equal(L.money, S.money);
  assert.deepEqual(L.bounds, S.bounds);
  simulate(L, 10);
});

test('a city grows, opens new land and is lost if nobody gets to work', () => {
  const S = createCity(CITY_MAPS[1]);
  const b0 = { ...S.bounds };
  simulate(S, 200);
  assert.ok(S.houses.length > 10);
  assert.ok(S.bounds.x0 < b0.x0 && S.bounds.x1 > b0.x1);
  simulate(S, 400);
  assert.ok(S.gameOver, 'expected a game over without roads');
  const E = createCity(CITY_MAPS[1], { sandbox: true });
  simulate(E, 400);
  assert.equal(E.gameOver, null, 'sandbox never ends');
});
