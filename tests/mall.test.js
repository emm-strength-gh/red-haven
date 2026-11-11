import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/mall-logic.js';

const navOf = (w) => L.makeNav(w);
const without = (w, id) => ({ ...w, units: w.units.filter((u) => u.id !== id) });

test('starter mall: every shop is validly placed and reachable from the street', () => {
  const w = L.starterWorld();
  const nav = navOf(w);
  for (const u of w.units) {
    const rest = without(w, u.id);
    assert.ok(L.canPlaceUnit(rest, navOf(rest), u.type, u.x, u.z, u.rot).ok, `${u.type} placement`);
  }
  const reach = L.reachability(w, nav);
  for (const u of w.units) assert.ok(reach.get(u.id), `${u.type} reachable`);
  assert.ok(w.units.some((u) => u.type === 'cafe'), 'the café is where it all started');
  assert.ok(L.parkingNetwork(w).length >= 20, 'starter car park');
});

test('walls: shoppers only get indoors through an entrance', () => {
  const w = L.starterWorld();
  const cafe = w.units.find((u) => u.type === 'cafe');
  w.entrances = [];
  const reach = L.reachability(w, navOf(w));
  assert.equal(reach.get(cafe.id), false);
});

test('flow field leads step by step from the sidewalk to a shop door', () => {
  const w = L.starterWorld();
  const nav = navOf(w);
  const cafe = w.units.find((u) => u.type === 'cafe');
  const { front } = L.doorOf(cafe);
  const goal = L.idx(front.x, front.z);
  const field = L.flowField(nav, [goal]);
  let at = L.spawnTiles()[0], steps = 0;
  const rng = L.mulberry32(5);
  while (at !== goal && steps < 400) { const n = L.stepDown(nav, field, at, rng); assert.ok(n >= 0, `stuck at ${at}`); at = n; steps++; }
  assert.equal(at, goal);
});

test('unit placement rules: floor only, no overlap, door must face the concourse', () => {
  const w = L.starterWorld();
  const nav = navOf(w);
  assert.equal(L.canPlaceUnit(w, nav, 'florist', 2, 2, 0).ok, false, 'grass');
  assert.equal(L.canPlaceUnit(w, nav, 'florist', 12, 12, 0).ok, false, 'overlaps café');
  assert.equal(L.canPlaceUnit(w, nav, 'florist', 15, 12, 0).ok, true);
  assert.equal(L.canPlaceUnit(w, nav, 'florist', 18, 18, 0).ok, false, 'door would face the wall');
  assert.equal(L.canPlaceUnit(w, nav, 'florist', 18, 18, 2).ok, true, 'rotated to face inward');
});

test('entrances and décor placement', () => {
  const w = L.starterWorld();
  const nav = navOf(w);
  assert.equal(L.canPlaceEntrance(w, nav, 14, 16).ok, false, 'interior tile');
  assert.equal(L.canPlaceEntrance(w, nav, 12, 20).ok, false, 'faces grass');
  assert.equal(L.canPlaceEntrance(w, nav, 18, 20).ok, false, 'faces grass');
  assert.equal(L.canPlaceDecor(w, nav, 'plant', 13, 15).ok, false, 'blocks café door');
  assert.equal(L.canPlaceDecor(w, nav, 'plant', 18, 18).ok, true);
  assert.equal(L.canPlaceDecor(w, nav, 'tree', 18, 18).ok, false, 'trees stay outside');
  assert.equal(L.canPlaceDecor(w, nav, 'tree', 2, 2).ok, true);
});

test('research tree: every prerequisite exists and everything is eventually unlockable', () => {
  for (const [id, r] of Object.entries(L.RESEARCH)) for (const n of r.needs || []) assert.ok(L.RESEARCH[n], `${id} needs ${n}`);
  for (const u of Object.values(L.UNITS)) if (u.research) assert.ok(L.RESEARCH[u.research], u.name);
  for (const d of Object.values(L.DECOR)) if (d.research) assert.ok(L.RESEARCH[d.research], d.name);
  const done = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const id of Object.keys(L.RESEARCH)) if (L.researchAvailable(id, done)) { done.push(id); progress = true; }
  }
  assert.equal(done.length, Object.keys(L.RESEARCH).length);
  assert.ok(!L.unitUnlocked('cinema', []) && L.unitUnlocked('cinema', done));
  assert.ok(L.unitUnlocked('cafe', []));
});

test('economy: staff add capacity, rating raises rent and footfall', () => {
  const def = L.UNITS.boutique;
  const u = { staff: 1, level: 1 };
  assert.ok(L.unitCapacity({ ...u, staff: 3 }, def) > L.unitCapacity(u, def));
  assert.equal(L.unitCapacity({ ...u, staff: 0 }, def), 0);
  assert.ok(L.unitCapacity(u, def, true) > L.unitCapacity(u, def, false));
  assert.ok(L.leaseRent(def, 4) > L.leaseRent(def, 1));
  const v = (rating) => L.visitorsPerHour({ attraction: 10, rating });
  assert.ok(v(4) > v(1));
  assert.ok(L.hourCurve(12) > L.hourCurve(9) && L.hourCurve(22) === 0);
  assert.equal(L.ratingStars(100), 5);
  assert.ok(L.purchase(L.mulberry32(1), def, 1, false, 50) > 0);
});

test('events respect what the mall actually has', () => {
  const rng = L.mulberry32(9);
  for (let i = 0; i < 200; i++) {
    const e = L.pickEvent(rng, { cats: new Set(['fashion']), staff: 0, leased: 0 });
    assert.ok(L.EVENTS[e]);
    assert.notEqual(e, 'inspection');
    assert.notEqual(e, 'strike');
    assert.notEqual(e, 'tenant');
  }
});

test('goals are unique and modes are defined', () => {
  const ids = L.GOALS.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(L.DIFFICULTY.sandbox.cash, Infinity);
  assert.ok(L.DIFFICULTY.expert.cash < L.DIFFICULTY.normal.cash);
});

test('mall score rewards variety, cleanliness and happy shoppers', () => {
  const base = { avgSat: 70, cleanliness: 90, cats: 1, types: 1, comfort: 10, floorTiles: 100, services: 40 };
  const start = L.mallScore(base);
  assert.ok(L.ratingStars(start) > 1.5 && L.ratingStars(start) < 3, `start ${start}`);
  assert.ok(L.mallScore({ ...base, cats: 6, types: 10 }) > start);
  assert.ok(L.mallScore({ ...base, cleanliness: 20 }) < start);
  const best = L.mallScore({ avgSat: 95, cleanliness: 100, cats: 7, types: 14, comfort: 40, floorTiles: 100, services: 100 });
  assert.ok(L.ratingStars(best) >= 4.75, 'five stars is reachable');
});

test('wishes favour shops the mall already has but still hint at new ones', () => {
  const rng = L.mulberry32(2);
  let haveHits = 0, other = new Set();
  for (let i = 0; i < 300; i++) for (const w of L.pickWishes(rng, new Set(['cafe', 'florist']), 3)) { if (w === 'cafe' || w === 'florist') haveHits++; else other.add(w); }
  assert.ok(haveHits > 300);
  assert.ok(other.size > 5);
});
