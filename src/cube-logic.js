// Cube Lab: pure N×N×N twisty-cube logic (no DOM), shared by the game and the tests.
//
// Coordinates are "doubled" integers so even and odd cubes work the same way:
// for an n-cube each axis runs -(n-1), -(n-3), …, n-1. A sticker slot is a
// cubie position plus an outward face normal. The cube state is a Uint8Array
// holding one colour (0–5, the solved face) per slot.
//
// A move is { axis: 0|1|2, layers: [coords…], q: 1|2|3 } where q counts
// right-handed quarter turns about the +axis (x, y, z).

export const FACES = ['U', 'D', 'F', 'B', 'R', 'L'];
export const FACE_NORMALS = [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];
// face letter → [axis, sign]
export const FACE_AXIS = { R: [0, 1], L: [0, -1], U: [1, 1], D: [1, -1], F: [2, 1], B: [2, -1] };
const AXIS_FACE = [['R', 'L'], ['U', 'D'], ['F', 'B']]; // [axis][sign>0 ? 0 : 1]

const rot90 = (v, axis) => {
  const [x, y, z] = v;
  if (axis === 0) return [x, -z, y];
  if (axis === 1) return [z, y, -x];
  return [-y, x, z];
};
export const rotateVec = (v, axis, q) => { for (let i = 0; i < ((q % 4) + 4) % 4; i++) v = rot90(v, axis); return v; };
const faceOfNormal = (nr) => FACE_NORMALS.findIndex((f) => f[0] === nr[0] && f[1] === nr[1] && f[2] === nr[2]);
const slotKey = (p, nr) => `${p[0]},${p[1]},${p[2]}|${nr[0]},${nr[1]},${nr[2]}`;
const sameLayers = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Clockwise quarter-turn count for a face with the given sign (looking at that face). */
export const cwQ = (sign) => (sign > 0 ? 3 : 1);

export const invertMove = (m) => ({ axis: m.axis, layers: m.layers, q: (4 - m.q) % 4 });
export const invert = (moves) => moves.slice().reverse().map(invertMove);

/** Merge/cancel turns of the same layers on the same axis (same-axis turns commute). */
export function simplify(moves) {
  const out = [];
  for (const mv of moves) {
    if (!mv.q) continue;
    let merged = false;
    for (let i = out.length - 1; i >= 0 && out[i].axis === mv.axis; i--) {
      if (sameLayers(out[i].layers, mv.layers)) {
        const q = (out[i].q + mv.q) % 4;
        if (q === 0) out.splice(i, 1); else out[i] = { ...out[i], q };
        merged = true;
        break;
      }
    }
    if (!merged) out.push({ axis: mv.axis, layers: mv.layers, q: mv.q % 4 });
  }
  return out;
}

/** Small fast seeded RNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Puzzle {
  constructor(n) {
    if (!(n >= 2 && n <= 9)) throw new Error(`unsupported cube size ${n}`);
    this.n = n;
    this.m = n - 1;
    this.coords = Array.from({ length: n }, (_, i) => -this.m + 2 * i);
    this.slots = [];
    this.index = new Map();
    for (const x of this.coords) for (const y of this.coords) for (const z of this.coords) {
      const p = [x, y, z];
      for (let a = 0; a < 3; a++) for (const s of [1, -1]) {
        if (p[a] !== s * this.m) continue;
        const nr = [0, 0, 0]; nr[a] = s;
        this.index.set(slotKey(p, nr), this.slots.length);
        this.slots.push({ p, n: nr, face: faceOfNormal(nr) });
      }
    }
    this.faceSlots = FACES.map((_, f) => this.slots.flatMap((s, i) => (s.face === f ? [i] : [])));
    this.permCache = new Map();
    this._rotations = null;
  }

  solved() { return Uint8Array.from(this.slots, (s) => s.face); }

  /** Coordinate of the layer `depth` (1 = outer) in from the face with this sign. */
  layerAt(sign, depth = 1) { return sign * (this.m - 2 * (depth - 1)); }

  perm(move) {
    const key = `${move.axis}/${move.layers.join(',')}/${move.q}`;
    let perm = this.permCache.get(key);
    if (perm) return perm;
    perm = new Int32Array(this.slots.length);
    this.slots.forEach((s, i) => {
      if (!move.layers.includes(s.p[move.axis])) { perm[i] = i; return; }
      perm[i] = this.index.get(slotKey(rotateVec(s.p, move.axis, move.q), rotateVec(s.n, move.axis, move.q)));
    });
    this.permCache.set(key, perm);
    return perm;
  }

  apply(state, move) {
    if (!move.q) return state;
    const perm = this.perm(move), out = new Uint8Array(state.length);
    for (let i = 0; i < perm.length; i++) out[perm[i]] = state[i];
    return out;
  }

  applyAll(state, moves) { for (const m of moves) state = this.apply(state, m); return state; }

  /** Every face is a single colour (any orientation counts). */
  isSolved(state) {
    return this.faceSlots.every((slots) => slots.every((i) => state[i] === state[slots[0]]));
  }

  /** The 24 whole-cube rotations, as slot permutations. */
  rotations() {
    if (this._rotations) return this._rotations;
    const all = this.coords;
    const gens = [this.perm({ axis: 0, layers: all, q: 1 }), this.perm({ axis: 1, layers: all, q: 1 })];
    const id = Int32Array.from(this.slots, (_, i) => i);
    const seen = new Map([[id.join(','), id]]), todo = [id];
    while (todo.length) {
      const p = todo.pop();
      for (const g of gens) {
        const c = p.map((v) => g[v]);
        const k = c.join(',');
        if (!seen.has(k)) { seen.set(k, c); todo.push(c); }
      }
    }
    this._rotations = [...seen.values()];
    return this._rotations;
  }

  /** All rotated copies of a target state, for orientation-free matching. */
  variants(target) {
    return this.rotations().map((r) => {
      const v = new Uint8Array(target.length);
      for (let i = 0; i < r.length; i++) v[r[i]] = target[i];
      return v;
    });
  }

  matches(state, variants) {
    return variants.some((v) => { for (let i = 0; i < v.length; i++) if (v[i] !== state[i]) return false; return true; });
  }

  /** Parse cube notation: R U' F2, Rw / r, 2R, M E S, x y z. */
  parse(alg) {
    const out = [];
    for (const tok of alg.trim().split(/\s+/).filter(Boolean)) {
      const m = /^(\d*)([URFDLBurfdlbMESxyz])(w?)(2'|'2|'|2)?$/.exec(tok);
      if (!m) throw new Error(`bad move "${tok}"`);
      let [, digits, letter, wide, suf = ''] = m;
      let axis, layers, base;
      if ('xyz'.includes(letter)) {
        axis = 'xyz'.indexOf(letter); layers = this.coords.slice(); base = 3;
      } else if ('MES'.includes(letter)) {
        if (this.n % 2 === 0) throw new Error(`${letter} needs an odd cube`);
        axis = 'MES'.indexOf(letter); layers = [0]; base = letter === 'S' ? 3 : 1;
      } else {
        if (letter === letter.toLowerCase()) { letter = letter.toUpperCase(); wide = 'w'; }
        const [a, s] = FACE_AXIS[letter];
        axis = a; base = cwQ(s);
        const depth = digits ? parseInt(digits, 10) : wide ? 2 : 1;
        if (depth < 1 || depth > this.n) throw new Error(`bad depth in "${tok}"`);
        layers = wide
          ? Array.from({ length: depth }, (_, i) => this.layerAt(s, i + 1))
          : [this.layerAt(s, depth)];
        layers.sort((p, q) => p - q);
      }
      const q = suf.includes('2') ? 2 : suf === "'" ? (4 - base) % 4 : base;
      out.push({ axis, layers, q });
    }
    return out;
  }

  /** Human notation for one move. */
  format(move) {
    const { axis, layers, q } = move;
    const suffix = (base) => (q === 2 ? '2' : q === base ? '' : "'");
    if (layers.length === this.n) return 'xyz'[axis] + suffix(3);
    if (layers.length === 1 && layers[0] === 0 && this.n % 2 === 1) {
      return 'MES'[axis] + suffix(axis === 2 ? 3 : 1);
    }
    const l = layers.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), layers[0]);
    const s = l > 0 ? 1 : -1;
    const face = AXIS_FACE[axis][s > 0 ? 0 : 1];
    const base = cwQ(s);
    if (layers.length === 1) {
      const depth = (this.m - Math.abs(l)) / 2 + 1;
      return `${depth > 1 ? depth : ''}${face}${suffix(base)}`;
    }
    const sorted = layers.slice().sort((p, q2) => s * (q2 - p));
    const wideOk = sorted.every((v, i) => v === this.layerAt(s, i + 1));
    if (wideOk) return `${layers.length > 2 ? layers.length : ''}${face}w${suffix(base)}`;
    return `${face}[${layers.join(',')}]${suffix(base)}`;
  }

  formatAll(moves) { return moves.map((m) => this.format(m)).join(' '); }

  /** Name of a single outer layer (e.g. 'R') or null if it is not an outer face. */
  faceName(axis, layer) {
    if (Math.abs(layer) !== this.m) return null;
    return AXIS_FACE[axis][layer > 0 ? 0 : 1];
  }

  /**
   * Random scramble with no two consecutive turns on the same axis (so it never cancels).
   * opts.faces: restrict to these outer faces (e.g. ['R','U']).
   * opts.inner: allow inner slices on big cubes.
   */
  scramble(random, len, opts = {}) {
    const faces = opts.faces;
    for (let tries = 0; tries < 50; tries++) {
      const moves = [];
      let lastAxis = -1;
      while (moves.length < len) {
        let axis, layer;
        if (faces) {
          const choices = faces.filter((f) => FACE_AXIS[f][0] !== lastAxis);
          const f = choices[Math.floor(random() * choices.length)];
          axis = FACE_AXIS[f][0]; layer = this.layerAt(FACE_AXIS[f][1]);
        } else {
          do axis = Math.floor(random() * 3); while (axis === lastAxis);
          const pool = opts.inner ? this.coords : [-this.m, this.m];
          layer = pool[Math.floor(random() * pool.length)];
        }
        moves.push({ axis, layers: [layer], q: 1 + Math.floor(random() * 3) });
        lastAxis = axis;
      }
      if (!this.isSolved(this.applyAll(this.solved(), moves))) return moves;
    }
    throw new Error('could not build a scramble');
  }

  /** Every way to turn a single layer (used by view-relative input and tests). */
  singleLayerMoves() {
    const out = [];
    for (let axis = 0; axis < 3; axis++) for (const l of this.coords) for (const q of [1, 2, 3]) out.push({ axis, layers: [l], q });
    return out;
  }
}

/** Shortest-known path from `fromMoves` (applied to solved) to `toMoves` (applied to solved). */
export const pathBetween = (fromMoves, toMoves) => simplify([...invert(simplify(fromMoves)), ...toMoves]);

/** Default scramble length for a full random scramble of an n-cube. */
export const fullScrambleLength = (n) => ({ 2: 11, 3: 22, 4: 40, 5: 60, 6: 80, 7: 100 }[n] || 20 * n);

/** Star rating: within par → 3, within roughly double par → 2, otherwise 1. Hints cap at 2. */
export function starsFor(moves, par, hinted = false) {
  const s = moves <= par ? 3 : moves <= par * 2 + 2 ? 2 : 1;
  return hinted ? Math.min(2, s) : s;
}
