import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRS, LIE_X, LIE_Z, STAND, initialState, parseLevel, solve, step } from '../src/tumble-logic.js';
import { LEVELS } from '../src/tumble-levels.js';

const play = (level, moves) => {
  let s = initialState(level), ev = null;
  for (const m of moves) ({ state: s, ev } = step(level, s, ...DIRS[m]));
  return { s, ev };
};

test('there are 66 levels in three temples', () => {
  assert.equal(LEVELS.length, 66);
});

test('every level is solvable in exactly its par and the solution replays to a win', () => {
  LEVELS.forEach((def, i) => {
    const level = parseLevel(def.map);
    const res = solve(level);
    assert.ok(res, `level ${i + 1} unsolvable`);
    assert.equal(res.length, def.par, `level ${i + 1} par`);
    let s = initialState(level), ev;
    for (const [k, m] of [...res.path].entries()) {
      ({ state: s, ev } = step(level, s, ...DIRS[m]));
      assert.notEqual(ev.result, 'fall', `level ${i + 1} fell at move ${k + 1}`);
    }
    assert.equal(ev.result, 'win', `level ${i + 1} did not win`);
  });
});

test('the block stands, lies and rolls end over end', () => {
  const level = parseLevel(['S#####G']);
  let s = initialState(level);
  ({ state: s } = step(level, s, 1, 0));
  assert.deepEqual([s.x, s.o], [1, LIE_X]);
  ({ state: s } = step(level, s, 1, 0));
  assert.deepEqual([s.x, s.o], [3, STAND]);
  assert.equal(play(level, 'EEEE').ev.result, 'win');
  const wide = parseLevel(['S#', '##', '##', 'G#']);
  const r = step(wide, initialState(wide), 0, 1);
  assert.deepEqual([r.state.z, r.state.o], [1, LIE_Z]);
});

test('lying across a hole or off the edge falls', () => {
  const level = parseLevel(['S##.G']);
  assert.equal(play(level, 'EE').ev.result, 'fall');
  assert.equal(play(level, 'W').ev.result, 'fall');
});

test('glass breaks under an upright block but holds a lying one', () => {
  const level = parseLevel(['S#oo#G', '##o###']);
  assert.equal(play(level, 'E').ev.result, 'ok');
  const broke = play(parseLevel(['S#o#G']), 'E').s;
  assert.equal(broke.o, LIE_X);
  const r = play(parseLevel(['S#o#G']), 'EE');
  assert.equal(r.ev.result, 'ok');
  const standOnGlass = play(parseLevel(['S##oG']), 'EE');
  assert.equal(standOnGlass.ev.result, 'fall');
  assert.deepEqual(standOnGlass.ev.broke, [3, 0]);
});

test('cracked tiles collapse once the block rolls off them', () => {
  const level = parseLevel(['#Sc##G']);
  let { s, ev } = play(level, 'E');
  assert.equal(ev.result, 'ok');
  ({ state: s, ev } = step(level, s, 1, 0));
  assert.deepEqual(ev.cracked, [[2, 0]]);
  ({ ev } = step(level, s, -1, 0));
  assert.equal(ev.result, 'fall', 'rolling back onto the collapsed tile falls');
});

test('soft switches react to any contact, heavy switches only to an upright block', () => {
  const soft = parseLevel(['S1#A##G']);
  const r1 = play(soft, 'E');
  assert.equal(r1.ev.toggled.length, 1);
  assert.equal(play(soft, 'EEEE').ev.result, 'win');
  const heavy = parseLevel(['S#4#A#G', '#######']);
  assert.equal(play(heavy, 'E').ev.toggled.length, 0, 'lying on heavy switch does nothing');
  const press = play(parseLevel(['#S##4#A#G']), 'EE');
  assert.equal(press.ev.toggled.length, 1);
});
