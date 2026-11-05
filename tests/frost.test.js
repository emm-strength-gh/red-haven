import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDINGS, BUILD_ORDER, canAfford, costFor, helperCap, maxCount, maxLevel, pay, recruitCost, techCap, unlocksAt, warmRadius, waveFor,
} from '../src/frost-data.js';

test('costs grow with level and are rounded to 5', () => {
  for (const t of Object.keys(BUILDINGS)) {
    const a = costFor(t, 1), b = costFor(t, 4);
    for (const r in a) {
      assert.ok(b[r] > a[r], `${t} ${r} should grow`);
      assert.equal(a[r] % 5, 0);
    }
  }
});

test('core level gates buildings', () => {
  assert.equal(maxCount('tesla', 1), 0);
  assert.equal(maxCount('still', 1), 0);
  assert.ok(maxCount('tesla', 3) >= 1);
  assert.ok(maxCount('turret', 5) > maxCount('turret', 1));
  assert.equal(maxCount('workshop', 9), 1);
  assert.equal(maxLevel('pump', 3), 3);
  assert.equal(maxLevel('core', 3), BUILDINGS.core.maxLvl);
  assert.deepEqual(unlocksAt(3), ['tesla']);
  for (const t of BUILD_ORDER) assert.ok(maxCount(t, BUILDINGS[t].unlock ?? 1) >= 1, `${t} buildable when unlocked`);
});

test('afford and pay', () => {
  const res = { ice: 50, metal: 10, fuel: 0 };
  assert.ok(canAfford(res, { ice: 50 }));
  assert.ok(!canAfford(res, { ice: 20, metal: 11 }));
  pay(res, { ice: 20, metal: 10 });
  assert.deepEqual(res, { ice: 30, metal: 0, fuel: 0 });
});

test('warm zone, helpers, research and waves scale up', () => {
  assert.ok(warmRadius(2) > warmRadius(1));
  assert.equal(helperCap([]), 2);
  assert.equal(helperCap([1, 2]), 8);
  assert.ok(recruitCost(3).ice > recruitCost(1).ice);
  assert.equal(techCap(0), 0);
  assert.equal(techCap(9), 5);
  let prev = 0;
  for (let d = 1; d < 12; d++) {
    const w = waveFor(d), total = w.crawler + w.skitter + w.brute;
    assert.ok(total > prev, `wave ${d} grows`);
    assert.ok(w.dirs >= 1 && w.dirs <= 3);
    prev = total;
  }
});
