// Tumble Temple rules: a 1×1×2 block rolls over a grid of temple tiles.
// Pure logic with no rendering so it can be tested and used by the level generator.
//
// Map characters
//   .  empty sky           #  stone            S  start (stone)      G  goal hole
//   o  glass tile (the block may lie on it but breaks through when standing upright)
//   c  cracked tile (collapses after the block rolls off it)
//   1 2 3  soft switch for bridge group 1–3 (any contact)
//   4 5 6  heavy switch for bridge group 1–3 (block must stand upright)
//   A B C  bridge of group 1–3, retracted at the start
//   D E F  bridge of group 1–3, extended at the start
// Every switch press flips its bridge group.

export const VOID = 0, STONE = 1, GOAL = 2, GLASS = 3, CRACK = 4, SOFT = 5, HEAVY = 6, BRIDGE = 7;
export const STAND = 0, LIE_X = 1, LIE_Z = 2;
export const DIRS = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };

const CHAR = {
  '.': [VOID], ' ': [VOID], '#': [STONE], S: [STONE], G: [GOAL], o: [GLASS], c: [CRACK],
  1: [SOFT, 0], 2: [SOFT, 1], 3: [SOFT, 2], 4: [HEAVY, 0], 5: [HEAVY, 1], 6: [HEAVY, 2],
  A: [BRIDGE, 0, 0], B: [BRIDGE, 1, 0], C: [BRIDGE, 2, 0], D: [BRIDGE, 0, 1], E: [BRIDGE, 1, 1], F: [BRIDGE, 2, 1]
};

export function parseLevel(map) {
  const h = map.length, w = Math.max(...map.map((r) => r.length));
  const type = new Int8Array(w * h), group = new Int8Array(w * h).fill(-1);
  const startOn = new Uint8Array(w * h), crackIndex = new Int16Array(w * h).fill(-1);
  let start = null, goal = null, cracks = 0, groups = 0;
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    const ch = map[z][x] ?? '.';
    const spec = CHAR[ch];
    if (!spec) throw new Error(`Unknown tile "${ch}"`);
    const i = z * w + x;
    type[i] = spec[0];
    if (spec[1] !== undefined) { group[i] = spec[1]; groups = Math.max(groups, spec[1] + 1); }
    if (spec[2]) startOn[i] = 1;
    if (ch === 'S') start = { x, z };
    if (ch === 'G') goal = { x, z };
    if (spec[0] === CRACK) crackIndex[i] = cracks++;
  }
  if (!start || !goal) throw new Error('Level needs S and G');
  return { w, h, type, group, startOn, crackIndex, cracks, groups, start, goal };
}

export function initialState(level) {
  return { x: level.start.x, z: level.start.z, o: STAND, bridges: 0, cracked: 0 };
}

export function covered(s) {
  if (s.o === STAND) return [[s.x, s.z]];
  return s.o === LIE_X ? [[s.x, s.z], [s.x + 1, s.z]] : [[s.x, s.z], [s.x, s.z + 1]];
}

export function tileAt(level, x, z) {
  return x < 0 || z < 0 || x >= level.w || z >= level.h ? VOID : level.type[z * level.w + x];
}

export function solidAt(level, x, z, bridges, cracked) {
  const t = tileAt(level, x, z);
  if (t === VOID) return false;
  const i = z * level.w + x;
  if (t === BRIDGE) return !!(level.startOn[i] ^ ((bridges >> level.group[i]) & 1));
  if (t === CRACK) return !((cracked >> level.crackIndex[i]) & 1);
  return true;
}

/** Where the block ends up after rolling one step, ignoring the floor. */
export function roll(s, dx, dz) {
  let { x, z, o } = s;
  if (o === STAND) {
    if (dx) { x = dx > 0 ? x + 1 : x - 2; o = LIE_X; } else { z = dz > 0 ? z + 1 : z - 2; o = LIE_Z; }
  } else if (o === LIE_X) {
    if (dx) { x = dx > 0 ? x + 2 : x - 1; o = STAND; } else z += dz;
  } else if (dz) { z = dz > 0 ? z + 2 : z - 1; o = STAND; } else x += dx;
  return { x, z, o, bridges: s.bridges, cracked: s.cracked };
}

/**
 * Rolls the block and applies the rules. Returns the new state and what happened:
 * result is 'ok', 'fall' or 'win'.
 */
export function step(level, s, dx, dz) {
  const ns = roll(s, dx, dz);
  const before = covered(s), after = covered(ns);
  const ev = { result: 'ok', cracked: [], toggled: [], broke: null, unsupported: [] };
  for (const [x, z] of before) {
    if (tileAt(level, x, z) !== CRACK || after.some(([ax, az]) => ax === x && az === z)) continue;
    const bit = 1 << level.crackIndex[z * level.w + x];
    if (!(ns.cracked & bit)) { ns.cracked |= bit; ev.cracked.push([x, z]); }
  }
  const check = () => {
    ev.unsupported = after.filter(([x, z]) => !solidAt(level, x, z, ns.bridges, ns.cracked));
    return ev.unsupported.length === 0;
  };
  if (!check()) { ev.result = 'fall'; return { state: ns, ev }; }
  if (ns.o === STAND && tileAt(level, ns.x, ns.z) === GLASS) {
    ev.result = 'fall'; ev.broke = [ns.x, ns.z]; return { state: ns, ev };
  }
  for (const [x, z] of after) {
    const t = tileAt(level, x, z);
    if (t === SOFT || (t === HEAVY && ns.o === STAND)) {
      const g = level.group[z * level.w + x];
      ns.bridges ^= 1 << g;
      ev.toggled.push({ x, z, group: g });
    }
  }
  if (ev.toggled.length && !check()) { ev.result = 'fall'; return { state: ns, ev }; }
  if (ns.o === STAND && ns.x === level.goal.x && ns.z === level.goal.z) ev.result = 'win';
  return { state: ns, ev };
}

const DIR_KEYS = Object.keys(DIRS);
const keyOf = (level, s) => ((((s.cracked * 8 + s.bridges) * 3 + s.o) * (level.h + 4) + s.z + 2) * (level.w + 4)) + s.x + 2;

/** Every cell the block can ever touch from the start (full exploration). */
export function reachableCells(level, maxStates = 400000) {
  const start = initialState(level);
  const seen = new Set([keyOf(level, start)]), cells = new Set();
  const stack = [start];
  while (stack.length && seen.size < maxStates) {
    const s = stack.pop();
    for (const [x, z] of covered(s)) cells.add(z * level.w + x);
    for (const d of DIR_KEYS) {
      const { state, ev } = step(level, s, ...DIRS[d]);
      if (ev.result === 'fall') continue;
      const k = keyOf(level, state);
      if (seen.has(k)) continue;
      seen.add(k);
      if (ev.result === 'win') { for (const [x, z] of covered(state)) cells.add(z * level.w + x); continue; }
      stack.push(state);
    }
  }
  return cells;
}

/** Breadth-first search for the shortest solution. Returns null when unsolvable. */
export function solve(level, maxStates = 400000) {
  const start = initialState(level);
  const seen = new Map([[keyOf(level, start), null]]);
  const touched = new Set();
  let frontier = [start], depth = 0;
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      for (const [x, z] of covered(s)) touched.add(z * level.w + x);
      for (const d of DIR_KEYS) {
        const { state, ev } = step(level, s, ...DIRS[d]);
        if (ev.result === 'fall') continue;
        const k = keyOf(level, state);
        if (seen.has(k)) continue;
        seen.set(k, { from: keyOf(level, s), dir: d });
        if (ev.result === 'win') {
          const path = [];
          for (let c = k; seen.get(c); c = seen.get(c).from) path.push(seen.get(c).dir);
          for (const [x, z] of covered(state)) touched.add(z * level.w + x);
          return { length: depth + 1, path: path.reverse().join(''), states: seen.size, touched };
        }
        next.push(state);
      }
      if (seen.size > maxStates) return null;
    }
    frontier = next; depth++;
  }
  return null;
}
