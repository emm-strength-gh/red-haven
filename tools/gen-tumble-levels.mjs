// Generates the 66 Tumble Temple puzzles into src/tumble-levels.js.
// Each level starts as a solid slab with its special tiles scattered on it, then a
// seeded hill-climb carves holes and moves tiles around to make the shortest
// solution (found by the BFS solver) as long as the level's target. Special tiles
// must matter: a level is rejected if swapping them for plain stone wouldn't change
// the solution. Run with: node tools/gen-tumble-levels.mjs
import { writeFileSync } from 'node:fs';
import { parseLevel, solve, reachableCells } from '../src/tumble-logic.js';

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function plan(n) {
  const area = Math.floor(n / 22), k = n % 22, t = k / 21;
  const p = {
    W: Math.min(14, Math.round(5 + t * 6 + area * 1.5)),
    H: Math.min(9, Math.round(4 + t * 3 + area)),
    target: Math.round([8, 14, 18][area] + t * [20, 22, 28][area]),
    tiles: []
  };
  const add = (ch, count) => { for (let i = 0; i < count; i++) p.tiles.push(ch); };
  if (area === 0) {
    if (k >= 7) add('c', Math.min(5, 1 + Math.floor((k - 7) / 3)));
  } else if (area === 1) {
    add('o', Math.min(5, 2 + Math.floor(k / 6)));
    if (k >= 6) { add('1', 1); add('A', 2); }
    if (k >= 14) { add('2', 1); add('B', 2); }
    if (k >= 3 && k % 2) add('c', 2);
  } else {
    add('4', 1); add('A', 2);
    if (k >= 6) { add('2', 1); add('B', 2); }
    if (k >= 4) add('o', 2 + Math.floor(k / 8));
    if (k >= 10) add('c', 2 + Math.floor((k - 10) / 5));
  }
  return p;
}

const toMap = (grid) => grid.map((r) => r.join(''));
const swapChars = (map, from, to) => map.map((r) => r.replace(from, to));

function evaluate(grid, p) {
  const map = toMap(grid);
  const level = parseLevel(map);
  const res = solve(level, 120000);
  if (!res) return null;
  let missing = 0;
  const kinds = new Set(p.tiles);
  const alt = (re) => solve(parseLevel(swapChars(map, re, '#')), 120000);
  if (kinds.has('c')) { const a = alt(/c/g); if (a && a.length >= res.length) missing++; }
  if (kinds.has('o')) { const a = alt(/o/g); if (a && a.length >= res.length) missing++; }
  if (kinds.has('1') || kinds.has('2')) { const a = alt(/[12]/g); if (a && a.length <= res.length) missing++; }
  if (kinds.has('4')) { const a = alt(/4/g); if (a && a.length <= res.length) missing++; }
  return { len: res.length, missing, score: Math.min(res.length, p.target) - missing * 10, path: res.path };
}

function build(n, seed) {
  const p = plan(n), rand = rng(seed);
  const ri = (m) => Math.floor(rand() * m);
  const grid = Array.from({ length: p.H }, () => Array(p.W).fill('#'));
  const cells = [];
  for (let z = 0; z < p.H; z++) for (let x = 0; x < p.W; x++) cells.push([x, z]);
  cells.sort(() => rand() - 0.5);
  grid[0][0] = '#';
  const [sx, sz] = [ri(2), ri(p.H)], [gx, gz] = [p.W - 1 - ri(2), ri(p.H)];
  grid[sz][sx] = 'S'; grid[gz][gx] = 'G';
  for (const ch of p.tiles) {
    const c = cells.find(([x, z]) => grid[z][x] === '#');
    grid[c[1]][c[0]] = ch;
  }
  let cur = evaluate(grid, p);
  if (!cur) return null;
  const iterations = 900 + n * 25;
  for (let it = 0; it < iterations && !(cur.len >= p.target && cur.missing === 0); it++) {
    const undo = [];
    const set = (x, z, ch) => { undo.push([x, z, grid[z][x]]); grid[z][x] = ch; };
    const moves = 1 + ri(2);
    for (let m = 0; m < moves; m++) {
      const x = ri(p.W), z = ri(p.H);
      if (rand() < 0.7) {
        if (grid[z][x] === '.') set(x, z, '#'); else if (grid[z][x] === '#') set(x, z, '.');
      } else {
        const x2 = ri(p.W), z2 = ri(p.H), a = grid[z][x], b = grid[z2][x2];
        if (a !== b) { set(x, z, b); set(x2, z2, a); }
      }
    }
    const next = undo.length ? evaluate(grid, p) : null;
    if (next && next.score >= cur.score) cur = next;
    else for (const [x, z, ch] of undo.reverse()) grid[z][x] = ch;
  }
  // Tidy: drop tiles the block can never reach, then plain stone that isn't needed.
  const clearUnreachable = () => {
    const reach = reachableCells(parseLevel(toMap(grid)));
    for (let z = 0; z < p.H; z++) for (let x = 0; x < p.W; x++) {
      if (grid[z][x] !== '.' && !reach.has(z * p.W + x)) grid[z][x] = '.';
    }
  };
  clearUnreachable();
  const stones = cells.filter(([x, z]) => grid[z][x] === '#');
  for (const [x, z] of stones) {
    if (rand() > 0.7) continue;
    grid[z][x] = '.';
    const next = evaluate(grid, p);
    if (next && next.len >= cur.len && next.missing <= cur.missing) cur = next; else grid[z][x] = '#';
  }
  clearUnreachable();
  // Crop to the used area.
  const used = cells.filter(([x, z]) => grid[z][x] !== '.');
  const x0 = Math.min(...used.map((c) => c[0])), x1 = Math.max(...used.map((c) => c[0]));
  const z0 = Math.min(...used.map((c) => c[1])), z1 = Math.max(...used.map((c) => c[1]));
  const map = grid.slice(z0, z1 + 1).map((r) => r.slice(x0, x1 + 1).join(''));
  const final = evaluate(map.map((r) => [...r]), p);
  return final && { map, par: final.len, missing: final.missing, target: p.target, path: final.path };
}

// Hand-made openers that teach rolling and standing up.
const HAND = {
  0: ['###.....', '#S####..', '########', '..####G#', '....###.'],
  1: ['S###......', '#######...', '.#######..', '......##G#', '.......###']
};

const levels = [];
const t0 = Date.now();
for (let n = 0; n < 66; n++) {
  if (HAND[n]) {
    const res = solve(parseLevel(HAND[n]));
    levels.push({ map: HAND[n], par: res.length, target: res.length, missing: 0, sig: 'hand' });
    continue;
  }
  let best = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const lv = build(n, 1000 * n + attempt * 7919 + 17);
    if (!lv) continue;
    const score = lv.missing * -100 + Math.min(lv.par, lv.target);
    if (!best || score > best.score) best = { ...lv, score };
    if (lv.missing === 0 && lv.par >= lv.target * 0.85) break;
  }
  levels.push({ ...best, sig: plan(n).tiles.join('') });
  console.log(`${n + 1}`.padStart(2), `par ${best.par}/${best.target}`, best.missing ? `MISSING ${best.missing}` : '', `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// Within each run of levels that share the same special tiles, order by par so
// difficulty climbs smoothly while new mechanics still appear in sequence.
for (let i = 0; i < levels.length;) {
  let j = i;
  while (j < levels.length && levels[j].sig === levels[i].sig && Math.floor(j / 22) === Math.floor(i / 22)) j++;
  const run = levels.slice(i, j).sort((a, b) => a.par - b.par);
  levels.splice(i, run.length, ...run);
  i = j;
}

const body = levels.map((l) => `  { par: ${l.par}, map: [\n${l.map.map((r) => `    '${r}'`).join(',\n')}\n  ] }`).join(',\n');
writeFileSync(new URL('../src/tumble-levels.js', import.meta.url),
  `// Generated by tools/gen-tumble-levels.mjs — par is the shortest solution found by the solver.\n// See src/tumble-logic.js for the map legend.\nexport const LEVELS = [\n${body}\n];\n`);
console.log('wrote src/tumble-levels.js');
