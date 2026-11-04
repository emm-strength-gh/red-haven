// Color Pour puzzles are scrambled from a solved board using reversible moves.
// This gives every level a known solution without a heavyweight search on phones.
export const CAPACITY = 4;

export function settingsForLevel(level) {
  const n = Math.max(1, Math.floor(level));
  return {
    colors: Math.min(8, 3 + Math.floor((n - 1) / 4)),
    empties: n >= 17 && n % 5 === 0 ? 1 : 2,
    depth: Math.min(40, 8 + n * 2),
  };
}

function randomFor(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const cloneBoard = (board) => board.map((tube) => [...tube]);
export const topColor = (tube) => tube[tube.length - 1];
export function topRun(tube) {
  if (!tube.length) return 0;
  let count = 1;
  while (count < tube.length && tube[tube.length - 1 - count] === topColor(tube)) count++;
  return count;
}

export function pourAmount(board, from, to, capacity = CAPACITY) {
  if (from === to || !board[from]?.length || !board[to] || board[to].length >= capacity) return 0;
  const color = topColor(board[from]);
  if (board[to].length && topColor(board[to]) !== color) return 0;
  return Math.min(topRun(board[from]), capacity - board[to].length);
}

export function pour(board, from, to, capacity = CAPACITY) {
  const amount = pourAmount(board, from, to, capacity);
  if (!amount) return 0;
  for (let i = 0; i < amount; i++) board[to].push(board[from].pop());
  return amount;
}

export function isSolved(board, capacity = CAPACITY) {
  return board.every((tube) => tube.length === 0 ||
    (tube.length === capacity && tube.every((color) => color === tube[0])));
}

function boardKey(board) { return board.map((tube) => tube.join('')).join('|'); }
function complexity(board) {
  let changes = 0, mixed = 0;
  for (const tube of board) {
    let hasChange = false;
    for (let i = 1; i < tube.length; i++) if (tube[i] !== tube[i - 1]) { changes++; hasChange = true; }
    if (hasChange) mixed++;
  }
  return changes * 3 + mixed * 2;
}

export function createPuzzle(level) {
  const number = Math.max(1, Math.floor(level));
  const { colors, empties, depth } = settingsForLevel(number);
  let best = null;
  for (let attempt = 0; attempt < 18; attempt++) {
    const rng = randomFor(number * 23581 + attempt * 4219 + 0xabc927);
    const board = Array.from({ length: colors }, (_, color) => Array(CAPACITY).fill(color));
    for (let i = 0; i < empties; i++) board.push([]);
    const solution = [];
    const seen = new Set([boardKey(board)]);
    for (let step = 0; step < depth; step++) {
      const choices = [];
      for (let from = 0; from < board.length; from++) {
        const source = board[from];
        if (!source.length) continue;
        const run = topRun(source);
        for (let to = 0; to < board.length; to++) {
          const target = board[to];
          if (from === to || target.length === CAPACITY || (target.length && topColor(target) === topColor(source))) continue;
          for (let amount = 1; amount <= Math.min(run, CAPACITY - target.length); amount++) {
            // Source must remain the same color on top (or become empty) so
            // pouring back is legal. The destination starts with another color,
            // making the newly moved group exactly the amount to pour back.
            if (amount === source.length || amount < run) {
              const next = cloneBoard(board);
              for (let k = 0; k < amount; k++) next[to].push(next[from].pop());
              const key = boardKey(next);
              if (!seen.has(key)) choices.push({ from, to, amount, key, score: complexity(next) + rng() * 6 });
            }
          }
        }
      }
      if (!choices.length) break;
      choices.sort((a, b) => b.score - a.score);
      const pick = choices[Math.floor(rng() * Math.min(choices.length, 6))];
      for (let k = 0; k < pick.amount; k++) board[pick.to].push(board[pick.from].pop());
      solution.unshift({ from: pick.to, to: pick.from });
      seen.add(pick.key);
    }
    const score = complexity(board) + solution.length * 0.2;
    if (!best || score > best.score) best = { board, solution, score };
  }
  // The known route is a guaranteed attainable three-star target.
  return { level: number, board: best.board, solution: best.solution, colors, empties, par: Math.max(4, best.solution.length) };
}
