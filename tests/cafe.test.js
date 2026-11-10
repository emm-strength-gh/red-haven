import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/cafe-logic.js';

const gridFor = (loc, exp = loc.startExpansions || [], layout = loc.start.map(([type, x, z]) => ({ type, x, z }))) => L.buildGrid(loc, exp, layout);

test('five locations with three levels each, and every level recipe count fits the location', () => {
  assert.equal(L.LOCATIONS.length, 5);
  for (const loc of L.LOCATIONS) {
    assert.equal(L.LEVELS[loc.id].length, 3, loc.id);
    for (const lv of L.LEVELS[loc.id]) {
      assert.ok(lv.recipes <= loc.recipes.length, `${loc.id} ${lv.name}`);
      for (const g of lv.goals) {
        if (g.recipe) assert.ok(loc.recipes.slice(0, lv.recipes).includes(g.recipe), `${lv.name} featured recipe must be on the menu`);
        assert.ok(L.goalLabel(g).length > 3);
      }
      for (const e of lv.events || []) assert.ok(L.EVENTS[e], e);
      for (const t of lv.troubles || []) assert.ok(L.TROUBLES[t], t);
    }
  }
});

test('every recipe step exists and every ingredient is stockable', () => {
  for (const r of Object.values(L.RECIPES)) for (const s of r.steps) {
    assert.ok(L.STEPS[s], s);
    if (L.STEPS[s].ing) assert.ok(L.INGREDIENTS[L.STEPS[s].ing]);
  }
});

test('starting layouts are valid: queue reachable, seats usable, start furniture inside the café', () => {
  for (const loc of L.LOCATIONS) {
    const g = gridFor(loc);
    const reach = L.reachableSet(g);
    for (const p of [...g.fixed.queue, ...g.fixed.pickup]) assert.ok(reach.has(`${p.x},${p.z}`), `${loc.id} ${p.x},${p.z}`);
    for (const [, x, z] of loc.start) {
      assert.ok(g.tiles.has(`${x},${z}`), `${loc.id} start item at ${x},${z} outside`);
      assert.ok(!g.fixed.blocked.has(`${x},${z}`), `${loc.id} start item on counter`);
      assert.ok(!g.reserved.has(`${x},${z}`), `${loc.id} start item on reserved tile ${x},${z}`);
    }
    assert.ok(L.usableSeats(g).length >= 2, `${loc.id} should start with seats`);
  }
});

test('expansions keep the café connected, including lofts with stairs', () => {
  for (const loc of L.LOCATIONS) {
    const all = loc.expansions.map((e) => e.id);
    const g = gridFor(loc, all);
    const reach = L.reachableSet(g);
    for (const t of g.tiles.values()) {
      if (g.fixed.blocked.has(`${t.x},${t.z}`)) continue;
      if (g.solid.has(`${t.x},${t.z}`)) continue;
      assert.ok(reach.has(`${t.x},${t.z}`), `${loc.id} tile ${t.x},${t.z} (${t.kind}) unreachable`);
    }
  }
});

test('canPlace refuses furniture that would cut off the counter', () => {
  const loc = L.LOCATIONS.find((l) => l.id === 'night');
  const g = gridFor(loc, [], []);
  // night market: entrance (1,4), counter lane z=2..; wall off column x=2 completely
  let layout = [];
  for (let z = 0; z <= 4; z++) layout.push({ type: 'plant', x: 2, z });
  const blocked = L.buildGrid(loc, [], layout.slice(0, 4));
  const r = L.canPlace(blocked, 'plant', 2, 4);
  assert.equal(r.ok, false);
  assert.equal(L.canPlace(g, 'plant', 0, 0).ok, true);
  assert.equal(L.canPlace(g, 'plant', loc.cx[1], 2).ok, false, 'register spot is reserved');
  assert.equal(L.canPlace(g, 'rug', loc.cx[1], 2).ok, true, 'rugs may go anywhere walkable');
});

test('seats need an adjacent table and face it', () => {
  const loc = L.LOCATIONS[0];
  const g = gridFor(loc, [], [{ type: 'chair', x: 1, z: 4 }, { type: 'table', x: 2, z: 4 }, { type: 'chair', x: 0, z: 6 }]);
  const seats = L.usableSeats(g);
  assert.equal(seats.length, 1);
  assert.deepEqual(seats[0].facing, [1, 0]);
});

test('findPath walks around furniture and onto a seat', () => {
  const loc = L.LOCATIONS[0];
  const g = gridFor(loc);
  const seat = L.usableSeats(g)[0];
  const path = L.findPath(g, g.ent, seat);
  assert.ok(path && path.length > 1);
  for (const p of path.slice(1, -1)) assert.ok(g.walkable(p.x, p.z));
  assert.deepEqual(path[path.length - 1], { x: seat.x, z: seat.z });
});

test('drink matching ignores order but not missing or extra steps', () => {
  assert.ok(L.drinkMatches(['steam', 'shot'], 'latte'));
  assert.ok(!L.drinkMatches(['shot'], 'latte'));
  assert.ok(!L.drinkMatches(['shot', 'steam', 'foam'], 'latte'));
  assert.ok(L.drinkMatches(['shot', 'steam', 'vanilla'], 'latte', 'vanilla'));
  assert.ok(L.drinkMatches(['shot', 'shot', 'steam'], 'latte', 'extra'));
});

test('satisfaction and tips reward fast, correct, fairly priced service', () => {
  const base = { waitFrac: 0.1, correct: true, quality: 0.95, comfort: 60, price: 5, budget: 6, seated: true, wantedSeat: true };
  const good = L.customerSatisfaction(base);
  assert.ok(good >= 85, `good=${good}`);
  assert.ok(L.customerSatisfaction({ ...base, correct: false }) < 50);
  assert.ok(L.customerSatisfaction({ ...base, waitFrac: 0.95 }) < good);
  assert.ok(L.customerSatisfaction({ ...base, price: 9 }) < good);
  assert.ok(L.tipFor(good, 5) > 0);
  assert.equal(L.tipFor(50, 5), 0);
});

test('level results: required goals pass the level, optional goals add stars', () => {
  const lv = L.LEVELS.corner[0];
  const st = { drinks: 9, revenue: 30, tips: 6, satSum: 240, satCount: 3 };
  const r = L.levelResult(lv, st, {});
  assert.ok(r.passed);
  assert.equal(r.stars, 3);
  const fail = L.levelResult(lv, { drinks: 3, revenue: 10, tips: 0, satSum: 0, satCount: 0 }, {});
  assert.ok(!fail.passed);
  assert.equal(fail.stars, 0);
});

test('locations unlock after finishing every level of the previous one', () => {
  const p = {};
  assert.ok(L.locationUnlocked(0, p));
  assert.ok(!L.locationUnlocked(1, p));
  p.corner = [1, 2, 0];
  assert.ok(!L.locationUnlocked(1, p));
  assert.ok(L.levelUnlocked('corner', 2, p));
  p.corner[2] = 1;
  assert.ok(L.locationUnlocked(1, p));
});

test('reputation levels climb with xp', () => {
  assert.equal(L.repLevel(0), 1);
  assert.equal(L.repLevel(L.REP_XP[3]), 4);
  assert.ok(L.repProgress(L.REP_XP[2] + 1) > 0);
});

test('staff level up and get better', () => {
  const m = L.makeCandidate(L.mulberry32(3), 'barista', 'x');
  const s0 = m.skill;
  let up = false;
  for (let i = 0; i < 20; i++) up = L.staffGainXp(m) || up;
  assert.ok(up && m.level > 1 && m.skill > s0);
});
