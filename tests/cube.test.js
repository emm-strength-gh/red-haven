import test from 'node:test';
import assert from 'node:assert/strict';
import { Puzzle, invert, simplify, pathBetween, rng, starsFor, fullScrambleLength } from '../src/cube-logic.js';
import { CHAPTERS, LEVELS, levelsIn, puzzleFor } from '../src/cube-levels.js';

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test('every size has 6·n² stickers and starts solved', () => {
  for (let n = 2; n <= 7; n++) {
    const p = new Puzzle(n);
    assert.equal(p.slots.length, 6 * n * n);
    assert.ok(p.isSolved(p.solved()));
  }
});

test('any single-layer turn done four times is the identity, and undoing it restores the cube', () => {
  for (const n of [2, 3, 4, 5]) {
    const p = new Puzzle(n), s0 = p.solved();
    for (const m of p.singleLayerMoves()) {
      const once = p.apply(s0, m);
      assert.ok(!eq(once, s0), `${n}: ${p.format(m)} changes nothing`);
      let s = s0;
      for (let i = 0; i < 4; i++) s = p.apply(s, { ...m, q: 1 });
      assert.ok(eq(s, s0));
      assert.ok(eq(p.applyAll(once, invert([m])), s0));
    }
  }
});

test('classic identities: sexy move ×6 and the T-perm squared', () => {
  const p = new Puzzle(3), s0 = p.solved();
  const sexy = p.parse("R U R' U'");
  let s = s0;
  for (let i = 0; i < 6; i++) s = p.applyAll(s, sexy);
  assert.ok(eq(s, s0));
  const t = p.parse("R U R' U' R' F R2 U' R' U' R U R' F'");
  const once = p.applyAll(s0, t);
  assert.ok(!p.isSolved(once));
  assert.ok(eq(p.applyAll(once, t), s0));
});

test('notation parses and formats round-trip', () => {
  const p3 = new Puzzle(3);
  const alg = "R U' F2 L D B' M E' S2 x y' z2";
  assert.equal(p3.formatAll(p3.parse(alg)), alg);
  const p5 = new Puzzle(5);
  const big = "Rw 2U' 3Fw2 L";
  assert.equal(p5.formatAll(p5.parse(big)), big);
  assert.deepEqual(p3.parse('r'), p3.parse('Rw'));
  assert.throws(() => new Puzzle(4).parse('M'));
});

test('slice moves equal face turns plus a whole-cube rotation', () => {
  const p = new Puzzle(3), s0 = p.solved();
  assert.ok(eq(p.applyAll(s0, p.parse("M")), p.applyAll(s0, p.parse("R L' x'"))));
  assert.ok(eq(p.applyAll(s0, p.parse("E")), p.applyAll(s0, p.parse("U D' y'"))));
  assert.ok(eq(p.applyAll(s0, p.parse("S")), p.applyAll(s0, p.parse("F' B z"))));
});

test('whole-cube rotations keep the cube solved and give exactly 24 orientations', () => {
  for (const n of [2, 3, 4]) {
    const p = new Puzzle(n);
    assert.equal(p.rotations().length, 24);
    assert.ok(p.isSolved(p.applyAll(p.solved(), p.parse("x y2 z'"))));
  }
});

test('pattern matching ignores whole-cube orientation', () => {
  const p = new Puzzle(3);
  const target = p.applyAll(p.solved(), p.parse('M2'));
  const v = p.variants(target);
  assert.ok(p.matches(p.applyAll(p.solved(), p.parse('R2 L2')), v), 'R2 L2 is M2 seen from another side');
  assert.ok(p.matches(p.applyAll(p.solved(), p.parse('M2 y z')), v));
  assert.ok(!p.matches(p.applyAll(p.solved(), p.parse('M2 E2')), v));
});

test('simplify merges and cancels same-axis turns', () => {
  const p = new Puzzle(3);
  assert.equal(p.formatAll(simplify(p.parse("R R"))), 'R2');
  assert.equal(simplify(p.parse("R U U' R'")).length, 0);
  assert.equal(p.formatAll(simplify(p.parse("R L R"))), 'R2 L');
  assert.equal(p.formatAll(simplify(p.parse("R U R'"))), "R U R'");
});

test('random scrambles never cancel and the reverse path always solves', () => {
  for (const n of [2, 3, 4, 5]) {
    const p = new Puzzle(n), r = rng(42 + n);
    for (let k = 0; k < 20; k++) {
      const len = 1 + (k % 12);
      const s = p.scramble(r, len, { inner: n > 3 });
      assert.equal(simplify(s).length, len);
      const st = p.applyAll(p.solved(), s);
      assert.ok(!p.isSolved(st));
      assert.ok(p.isSolved(p.applyAll(st, pathBetween(s, []))));
    }
  }
});

test('the hint path leads from any position to the target pattern', () => {
  const p = new Puzzle(3);
  const target = p.parse("M E M' E'");
  const wander = p.scramble(rng(7), 9);
  const here = p.applyAll(p.solved(), wander);
  const path = pathBetween(wander, target);
  assert.ok(p.matches(p.applyAll(here, path), p.variants(p.applyAll(p.solved(), target))));
});

test('levels: 40 levels in 7 chapters, all valid and not already won', () => {
  assert.equal(LEVELS.length, 40);
  assert.equal(CHAPTERS.length, 7);
  CHAPTERS.forEach((_, ch) => assert.ok(levelsIn(ch).length >= 4, `chapter ${ch} too small`));
  for (const l of LEVELS) {
    const p = puzzleFor(l.n);
    const start = p.applyAll(p.solved(), l.setup);
    assert.ok(l.par > 0, `${l.name} par`);
    if (l.kind === 'pattern') {
      assert.equal(l.setup.length, 0);
      const target = p.applyAll(p.solved(), l.target);
      assert.ok(!p.isSolved(target), `${l.name} target is just solved`);
      assert.ok(!p.matches(start, p.variants(target)), `${l.name} starts matched`);
    } else {
      assert.ok(!p.isSolved(start), `${l.name} starts solved`);
      assert.equal(simplify(l.setup).length, l.setup.length, `${l.name} scramble cancels`);
      if (!l.full) assert.equal(l.par, l.setup.length);
      assert.ok(p.isSolved(p.applyAll(start, pathBetween(l.setup, []))));
    }
    if (l.faces) {
      for (const m of l.setup) assert.ok(l.faces.includes(p.faceName(m.axis, m.layers[0])), `${l.name} uses a locked face`);
    }
    if (l.full) assert.equal(l.setup.length, fullScrambleLength(l.n));
  }
});

test('levels are deterministic between loads', async () => {
  const again = await import('../src/cube-levels.js?again');
  LEVELS.forEach((l, i) => assert.deepEqual(again.LEVELS[i].setup, l.setup));
});

test('star rating', () => {
  assert.equal(starsFor(3, 3), 3);
  assert.equal(starsFor(8, 3), 2);
  assert.equal(starsFor(9, 3), 1);
  assert.equal(starsFor(3, 3, true), 2);
});
