// Cube Lab: chapters and levels. Scrambles are seeded so every level is the same each time.
import { Puzzle, rng, fullScrambleLength } from './cube-logic.js';

export const CHAPTERS = [
  { name: 'First Twists', sub: 'Undo the scramble', icon: '🌱', hue: ['#6af0c8', '#2a8cff'] },
  { name: 'Pattern Studio', sub: 'Copy the target cube', icon: '🎨', hue: ['#ff8ad8', '#8a5cff'] },
  { name: 'Pocket Cube', sub: 'The 2×2 cube', icon: '🎲', hue: ['#ffd36a', '#ff7a3d'] },
  { name: 'Locked Layers', sub: 'Only some faces turn', icon: '🔒', hue: ['#9ae66e', '#1fa36b'] },
  { name: 'Beat the Clock', sub: 'Solve before time runs out', icon: '⏱️', hue: ['#ff9a6a', '#e2365b'] },
  { name: 'Big Cubes', sub: '4×4 and 5×5', icon: '🧊', hue: ['#8fe3ff', '#4a6cff'] },
  { name: 'Grand Master', sub: 'Full scrambles', icon: '👑', hue: ['#ffe680', '#c9861f'] }
];

// kind: 'solve' (make every face one colour) or 'pattern' (match the target cube)
const DEFS = [
  // ---- First Twists
  { ch: 0, name: 'One Twist', n: 3, len: 1, tip: 'Drag a sticker to turn its layer. Drag the background (or use two fingers) to spin the whole cube.' },
  { ch: 0, name: 'Double Back', n: 3, len: 2, tip: 'Watch the scramble — then undo it in reverse order.' },
  { ch: 0, name: 'Three Steps', n: 3, len: 3, tip: 'Stuck? The 💡 button shows the next turn (it costs one star).' },
  { ch: 0, name: 'Four Corners', n: 3, len: 4 },
  { ch: 0, name: 'High Five', n: 3, len: 5 },
  { ch: 0, name: 'Half Dozen', n: 3, len: 6 },
  // ---- Pattern Studio
  { ch: 1, name: 'Stripes', n: 3, kind: 'pattern', alg: 'M2', tip: 'Middle layers turn too! Match the little target cube in the corner — any orientation counts.' },
  { ch: 1, name: 'Plaid', n: 3, kind: 'pattern', alg: 'M2 E2' },
  { ch: 1, name: 'Checkerboard', n: 3, kind: 'pattern', alg: 'M2 E2 S2', tip: 'Every middle slice turned halfway round…' },
  { ch: 1, name: 'Polka Dots', n: 3, kind: 'pattern', alg: "M E M' E'", tip: 'Tap the target cube to see its back.' },
  { ch: 1, name: 'Swapped Bars', n: 3, kind: 'pattern', alg: "M' U2 M U2" },
  { ch: 1, name: 'Picture Frames', n: 3, kind: 'pattern', alg: "U D' R L' F B' U D'" },
  // ---- Pocket Cube
  { ch: 2, name: 'Pocket Warm-up', n: 2, len: 2, tip: 'No centres on a 2×2 — any orientation of the solved cube counts.' },
  { ch: 2, name: 'Pocket Trio', n: 2, len: 3 },
  { ch: 2, name: 'Pocket Four', n: 2, len: 4 },
  { ch: 2, name: 'Pocket Six', n: 2, len: 6 },
  { ch: 2, name: 'Pocket Eight', n: 2, len: 8 },
  { ch: 2, name: 'Pocket Chaos', n: 2, len: fullScrambleLength(2), par: 25, tip: 'A full scramble. Solve layer by layer: one face first, then the rest.' },
  // ---- Locked Layers
  { ch: 3, name: 'Right & Up', n: 3, len: 3, faces: ['R', 'U'], tip: 'Only the glowing-labelled faces can turn here. Everything else is locked tight.' },
  { ch: 3, name: 'Two-Step Dance', n: 3, len: 5, faces: ['R', 'U'] },
  { ch: 3, name: 'Right Angle', n: 3, len: 4, faces: ['R', 'F'] },
  { ch: 3, name: 'Three Keys', n: 3, len: 5, faces: ['R', 'U', 'F'] },
  { ch: 3, name: 'Sandwich', n: 3, len: 5, faces: ['R', 'L', 'U'] },
  { ch: 3, name: 'The Long Way', n: 3, len: 7, faces: ['R', 'U'] },
  // ---- Beat the Clock
  { ch: 4, name: 'Quick Fix', n: 3, len: 3, time: 30, tip: 'The clock starts on your first twist.' },
  { ch: 4, name: 'Rush Hour', n: 3, len: 4, time: 40 },
  { ch: 4, name: 'Pocket Sprint', n: 2, len: 5, time: 45 },
  { ch: 4, name: 'Countdown', n: 3, len: 5, time: 50 },
  { ch: 4, name: 'Pattern Panic', n: 3, kind: 'pattern', alg: "M E M' E'", time: 25 },
  { ch: 4, name: 'Photo Finish', n: 3, len: 6, time: 60 },
  // ---- Big Cubes
  { ch: 5, name: 'Revenge Lite', n: 4, len: 2, tip: 'Big cubes have inner slices. Drag a sticker in the middle rows to turn them.' },
  { ch: 5, name: 'Inner Circle', n: 4, len: 3, inner: true },
  { ch: 5, name: 'Four by Four', n: 4, len: 5, inner: true },
  { ch: 5, name: 'Professor', n: 5, len: 2 },
  { ch: 5, name: 'Deep Slice', n: 5, len: 4, inner: true },
  { ch: 5, name: 'Five Alive', n: 5, len: 6, inner: true },
  // ---- Grand Master
  { ch: 6, name: 'Cube in a Cube', n: 3, kind: 'pattern', alg: "F L F U' R U F2 L2 U' L' B D' B' L2 U" },
  { ch: 6, name: 'The Real Deal', n: 3, len: fullScrambleLength(3), par: 70, tip: 'A full competition-style scramble. Good luck — hints are always there.' },
  { ch: 6, name: 'Revenge', n: 4, len: fullScrambleLength(4), par: 150, inner: true },
  { ch: 6, name: 'Professor’s Exam', n: 5, len: fullScrambleLength(5), par: 240, inner: true }
];

const puzzles = new Map();
export const puzzleFor = (n) => { if (!puzzles.has(n)) puzzles.set(n, new Puzzle(n)); return puzzles.get(n); };

export const LEVELS = DEFS.map((d, i) => {
  const p = puzzleFor(d.n);
  const kind = d.kind || 'solve';
  let setup = [], target = [];
  if (kind === 'pattern') {
    target = p.parse(d.alg);
  } else {
    setup = p.scramble(rng(1000 + i * 7919), d.len, { faces: d.faces, inner: d.inner });
  }
  const chIndex = DEFS.filter((e, j) => j < i && e.ch === d.ch).length;
  return {
    id: i,
    ch: d.ch,
    num: chIndex + 1,
    name: d.name,
    n: d.n,
    kind,
    setup,
    target,
    par: d.par || (kind === 'pattern' ? target.length : setup.length),
    time: d.time || 0,
    faces: d.faces || null,
    full: !!(d.len && d.len >= fullScrambleLength(d.n)),
    tip: d.tip || ''
  };
});

export const levelsIn = (ch) => LEVELS.filter((l) => l.ch === ch);
