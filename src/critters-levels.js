// Kaboom Critters — worlds (themes), campaign stages and levels, and the skirmish match builder.
import { SIZES, INF, WEAPON_ORDER } from './critters-sim.js';

export const DIFFS = [
  { id: 'easy', name: 'Easy', icon: '🙂', medal: '🥉', blurb: 'Wobbly aim, ignores the wind' },
  { id: 'medium', name: 'Medium', icon: '😎', medal: '🥈', blurb: 'Reads the wind, moves to get a shot' },
  { id: 'hard', name: 'Hard', icon: '😈', medal: '🥇', blurb: 'Sharp-shooter with every trick' },
];

// colours are plain hex strings so the renderer and the CSS can share them
export const THEMES = {
  candy: {
    name: 'Candy Cove', emoji: '🍭',
    sky: ['#7fd3ff', '#ffc6ec', '#fff1d6'], fog: '#ffd9ef', sun: '#fff3d1',
    hemiSky: '#fff2fb', hemiGround: '#b98bd9',
    water: '#46d6f0', waterDeep: '#2a9fd0', waterGlow: false, waterOpacity: 0.82,
    top: '#ff6fb1', top2: '#ffb1d6', soil: ['#8a4b2d', '#a35d36', '#f4dca8', '#8a4b2d', '#b8693c'], scorch: '#4a2a1d', steel: '#e8eaf6',
    barrel: '#ff5a5a', barrelBand: '#ffffff', boom: ['#ffe14d', '#ff6fb1', '#7ef0ff'],
    backdrop: ['#ff9ad1', '#c79bff', '#8fe3ff', '#ffd27a'],
  },
  jungle: {
    name: 'Jungle Ruins', emoji: '🌴',
    sky: ['#3fb6ff', '#9fe6ff', '#e9fff1'], fog: '#cdf3e6', sun: '#fff6cc',
    hemiSky: '#effff4', hemiGround: '#6b8a3a',
    water: '#1fd1c0', waterDeep: '#0f8f9a', waterGlow: false, waterOpacity: 0.84,
    top: '#4fd65a', top2: '#2f9d43', soil: ['#a86b3c', '#8f5a32', '#c48d55', '#7c4e2c'], scorch: '#3b2a1c', steel: '#a7b4a0',
    barrel: '#ff8a1f', barrelBand: '#2b2b2b', boom: ['#ffd23f', '#ff7a1a', '#ffffff'],
    backdrop: ['#2f9d43', '#4fd65a', '#1f7a4a', '#7bd36b'],
  },
  frost: {
    name: 'Frosty Peaks', emoji: '❄️',
    sky: ['#4f8dff', '#a9d4ff', '#f1f8ff'], fog: '#dcecff', sun: '#ffffff',
    hemiSky: '#ffffff', hemiGround: '#7fa6d6',
    water: '#2f7fe0', waterDeep: '#1b4fa6', waterGlow: false, waterOpacity: 0.86,
    top: '#ffffff', top2: '#dff2ff', soil: ['#8fd3ff', '#6db7ef', '#a9e2ff', '#5aa3e0'], scorch: '#3c5f8f', steel: '#c8d3de',
    barrel: '#3fa0ff', barrelBand: '#ffffff', boom: ['#ffffff', '#9fe0ff', '#ffd23f'],
    backdrop: ['#ffffff', '#cfe6ff', '#9cc6f0', '#e9f4ff'],
  },
  lava: {
    name: 'Lava Forge', emoji: '🌋',
    sky: ['#2a1036', '#8a2a3c', '#ff8a4a'], fog: '#5a2236', sun: '#ffb36b',
    hemiSky: '#ffb08a', hemiGround: '#3a1a2a',
    water: '#ff5a1f', waterDeep: '#c22a10', waterGlow: true, waterOpacity: 0.96,
    top: '#5d4a63', top2: '#43344a', soil: ['#2e2333', '#3b2b38', '#ff7a1a', '#2e2333', '#46303d'], scorch: '#1a1218', steel: '#6f7380',
    barrel: '#ffd23f', barrelBand: '#2b2b2b', boom: ['#ffd23f', '#ff5a1f', '#ff2a6a'],
    backdrop: ['#3b2b38', '#2e2333', '#5d4a63', '#46303d'],
  },
  moon: {
    name: 'Moon Base', emoji: '🌙',
    sky: ['#0a0b26', '#2a1f5c', '#5a3f8f'], fog: '#2a2050', sun: '#e6e0ff',
    hemiSky: '#d9d4ff', hemiGround: '#3a2f5f',
    water: '#b45cff', waterDeep: '#6a2fcf', waterGlow: true, waterOpacity: 0.9,
    top: '#e2dcf7', top2: '#bdb5dc', soil: ['#8c86a8', '#7a7396', '#a59fc0', '#6a6488'], scorch: '#3a3550', steel: '#9fb0c8',
    barrel: '#6dff8a', barrelBand: '#2b2b40', boom: ['#ffffff', '#b45cff', '#6dfff0'],
    backdrop: ['#6a6488', '#8c86a8', '#4a4470', '#a59fc0'],
  },
};
export const THEME_KEYS = Object.keys(THEMES);

export const TEAM_COLORS = ['#ff8a1f', '#3aa0ff', '#ff4fa3', '#3fcf5a', '#a46bff', '#ffd23a'];

const NAMES = [
  'Pip', 'Nugget', 'Biscuit', 'Zappy', 'Dumpling', 'Waffles', 'Mochi', 'Tater', 'Pickles', 'Bubbles', 'Sprout', 'Noodle',
  'Clover', 'Gizmo', 'Pudding', 'Taco', 'Jinx', 'Bolt', 'Peanut', 'Sprocket', 'Fizz', 'Muffin', 'Toffee', 'Bean',
  'Pebble', 'Ziggy', 'Rascal', 'Doodle', 'Sushi', 'Nacho', 'Wobble', 'Fudge', 'Kiwi', 'Blip', 'Chip', 'Gumbo',
  'Squeak', 'Turbo', 'Puddle', 'Sparky', 'Bonbon', 'Crumble', 'Dash', 'Echo', 'Fluff', 'Gadget', 'Honey', 'Ink',
];

// weapon sets: INF = unlimited, a number = that many per match
const BASIC = { rocket: INF, grenade: INF, blaster: INF, bonk: INF, skip: INF };
export const ARSENALS = {
  start: { ...BASIC },
  grapes: { ...BASIC, grapes: 2 },
  boom: { ...BASIC, grapes: 2, dynamite: 1, airdrop: 1 },
  jungle: { ...BASIC, grapes: 2, dynamite: 1, airdrop: 1, mine: 2, teleport: 2 },
  frost: { ...BASIC, grapes: 3, dynamite: 2, airdrop: 1, mine: 2, teleport: 2, melon: 1 },
  full: { ...BASIC, grapes: 3, dynamite: 2, airdrop: 1, mine: 2, teleport: 2, melon: 1, bee: 2 },
  boss: { ...BASIC, grapes: 3, dynamite: 2, airdrop: 2, mine: 3, teleport: 2, melon: 1, bee: 2 },
};

export const STAGES = [
  { id: 'candy', name: 'Candy Cove', theme: 'candy', foe: 'Gumdrop Gang', foeColor: '#a46bff', blurb: 'Frosted hills and fizzy seas. Learn the ropes!' },
  { id: 'jungle', name: 'Jungle Ruins', theme: 'jungle', foe: 'Moss Mob', foeColor: '#ff4fa3', blurb: 'Temple towers, vine caves and sneaky mines.' },
  { id: 'frost', name: 'Frosty Peaks', theme: 'frost', foe: 'Frost Bites', foeColor: '#3fcf5a', blurb: 'Slippery snow — knocked critters slide far!' },
  { id: 'lava', name: 'Lava Forge', theme: 'lava', foe: 'Magma Mites', foeColor: '#3aa0ff', blurb: 'The lava sea rises when battles drag on.' },
  { id: 'moon', name: 'Moon Base', theme: 'moon', foe: 'Moon Goons', foeColor: '#ffd23a', blurb: 'Low gravity: huge lobs and floaty jumps.' },
];

// p / c: [count, hp] for you / the CPU. boss: [name, hp] replaces one CPU critter.
export const LEVELS = [
  // ---- Candy Cove
  { id: '1-1', stage: 0, name: 'Gumdrop Beach', shape: 'hills', size: 'S', seed: 101, p: [3, 100], c: [2, 70], wind: 0.15, crates: 0.3, arsenal: 'start',
    tip: 'Drag from your critter to aim — drag farther for more power. Then tap FIRE (or hold Space).' },
  { id: '1-2', stage: 0, name: 'Lollipop Lagoon', shape: 'islands', size: 'S', seed: 202, p: [3, 100], c: [3, 75], wind: 0.35, barrels: 3, crates: 0.35, arsenal: 'grapes',
    tip: 'Wind pushes rockets — check the wind arrows at the top. Soda cans explode when hit!' },
  { id: '1-3', stage: 0, name: 'Frosting Falls', shape: 'bowl', size: 'M', seed: 303, p: [3, 100], c: [3, 90], wind: 0.45, mines: 3, crates: 0.35, arsenal: 'boom',
    tip: 'Grenades ignore the wind and bounce over hills. Dynamite: drop it and run!' },
  { id: '1-4', stage: 0, name: 'Captain Gumdrop', shape: 'hills', size: 'M', seed: 404, caves: 0.5, p: [4, 100], c: [3, 80], boss: ['Captain Gumdrop', 180], wind: 0.5, barrels: 4, crates: 0.4, arsenal: 'boom',
    tip: 'Boss battle! The Captain is big and tough — knock him into the sea for a quick win.' },
  // ---- Jungle Ruins
  { id: '2-1', stage: 1, name: 'Vine Valley', shape: 'hills', size: 'M', seed: 505, caves: 1, p: [4, 100], c: [3, 100], wind: 0.5, mines: 3, crates: 0.35, arsenal: 'jungle',
    tip: 'New: Teleport and Sneaky Mines. Tap a spot, then fire.' },
  { id: '2-2', stage: 1, name: 'Temple Steps', shape: 'towers', size: 'M', seed: 606, girders: true, p: [4, 100], c: [4, 100], wind: 0.55, barrels: 3, crates: 0.35, arsenal: 'jungle',
    tip: 'Grey temple stone can’t be blown up. Use it for cover.' },
  { id: '2-3', stage: 1, name: 'Monkey Isles', shape: 'islands', size: 'M', seed: 707, girders: true, p: [4, 100], c: [4, 100], wind: 0.8, barrels: 5, crates: 0.4, arsenal: 'jungle',
    tip: 'Strong winds today! Grenades and the Blaster don’t care about wind.' },
  { id: '2-4', stage: 1, name: 'Chief Mossbeard', shape: 'caves', size: 'M', seed: 808, p: [4, 100], c: [3, 100], boss: ['Chief Mossbeard', 200], wind: 0.4, mines: 4, crates: 0.4, arsenal: 'jungle',
    tip: 'Boss battle in the caves. Air Drops can fall through the skylights.' },
  // ---- Frosty Peaks
  { id: '3-1', stage: 2, name: 'Snowball Slopes', shape: 'hills', size: 'L', seed: 909, slippery: true, p: [4, 100], c: [4, 100], wind: 0.55, crates: 0.4, arsenal: 'frost',
    tip: 'Ice is slippery — knocked critters slide a long way. New: the Mega Melon!' },
  { id: '3-2', stage: 2, name: 'Icicle Caverns', shape: 'caves', size: 'M', seed: 1010, slippery: true, p: [4, 100], c: [4, 100], wind: 0.4, mines: 6, crates: 0.4, arsenal: 'frost',
    tip: 'Mines everywhere. Blast them from afar to clear a path — or to hit a foe.' },
  { id: '3-3', stage: 2, name: 'Blizzard Bluffs', shape: 'towers', size: 'L', seed: 1111, slippery: true, girders: true, p: [4, 100], c: [5, 100], wind: 1, barrels: 3, crates: 0.4, suddenDeath: 9, arsenal: 'frost',
    tip: 'A howling blizzard. Sudden death starts at round 9!' },
  { id: '3-4', stage: 2, name: 'Yeti Yolanda', shape: 'bowl', size: 'L', seed: 1212, slippery: true, p: [4, 110], c: [4, 100], boss: ['Yeti Yolanda', 220], wind: 0.6, mines: 3, barrels: 3, crates: 0.4, arsenal: 'frost',
    tip: 'Boss battle! Yolanda sits on the big middle hill.' },
  // ---- Lava Forge
  { id: '4-1', stage: 3, name: 'Ember Isles', shape: 'islands', size: 'L', seed: 1313, p: [4, 100], c: [4, 100], wind: 0.6, barrels: 7, crates: 0.4, suddenDeath: 10, arsenal: 'full',
    tip: 'New: the Buzz Bee homes in on the nearest enemy. Barrels everywhere — chain reactions!' },
  { id: '4-2', stage: 3, name: 'Magma Chamber', shape: 'caves', size: 'L', seed: 1414, p: [4, 100], c: [5, 100], wind: 0.4, mines: 4, crates: 0.4, suddenDeath: 3, arsenal: 'full',
    tip: 'The lava rises from round 3. Stay high and finish fast!' },
  { id: '4-3', stage: 3, name: 'Ash Towers', shape: 'towers', size: 'L', seed: 1515, girders: true, p: [4, 100], c: [5, 100], wind: 0.9, barrels: 4, crates: 0.4, suddenDeath: 8, arsenal: 'full',
    tip: 'Tall towers and gusty heat. Knock the Mites off their perches.' },
  { id: '4-4', stage: 3, name: 'Baron Blaze', shape: 'bowl', size: 'L', seed: 1616, caves: 0.6, p: [5, 100], c: [4, 100], boss: ['Baron Blaze', 240], wind: 0.7, barrels: 5, mines: 3, crates: 0.45, suddenDeath: 6, arsenal: 'full',
    tip: 'Boss battle! The Baron is fire-proof but not water-proof… er, lava-proof.' },
  // ---- Moon Base
  { id: '5-1', stage: 4, name: 'Crater Hop', shape: 'hills', size: 'L', seed: 1717, caves: 0.5, gravity: 0.45, p: [4, 100], c: [4, 100], wind: 0.3, crates: 0.45, arsenal: 'full',
    tip: 'Low gravity! Shots fly much further — use less power.' },
  { id: '5-2', stage: 4, name: 'Asteroid Belt', shape: 'floaters', size: 'L', seed: 1818, gravity: 0.45, p: [4, 100], c: [5, 100], wind: 0.35, barrels: 4, crates: 0.45, arsenal: 'full',
    tip: 'Floating rocks in space goo. One good bonk sends a Goon flying.' },
  { id: '5-3', stage: 4, name: 'Goo Lagoon', shape: 'islands', size: 'L', seed: 1919, gravity: 0.5, girders: true, p: [5, 100], c: [5, 100], wind: 0.5, mines: 4, barrels: 3, crates: 0.45, suddenDeath: 7, arsenal: 'full',
    tip: 'The goo rises from round 7.' },
  { id: '5-4', stage: 4, name: 'King Kaboom', shape: 'floaters', size: 'L', seed: 2020, gravity: 0.5, girders: true, p: [5, 100], c: [4, 110], boss: ['King Kaboom', 300], wind: 0.6, mines: 4, barrels: 4, crates: 0.5, suddenDeath: 9, arsenal: 'boss',
    tip: 'The final battle! Topple the King of Kaboom.' },
];

function pickNames(rnd, n, used) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let name, tries = 0;
    do { name = NAMES[Math.floor(rnd() * NAMES.length)]; } while (used.has(name) && ++tries < 60);
    used.add(name);
    out.push(name);
  }
  return out;
}
function rng(seed) { let a = seed >>> 0 || 1; return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; }; }

const HP_SCALE = { easy: 0.85, medium: 1, hard: 1.1 };

/** Match config for a campaign level. */
export function levelMatch(L, difficulty, playerColor = TEAM_COLORS[0]) {
  const st = STAGES[L.stage];
  const rnd = rng(L.seed * 3 + 1);
  const used = new Set();
  const ammo = ARSENALS[L.arsenal] || ARSENALS.start;
  const cHp = Math.round(L.c[1] * HP_SCALE[difficulty]);
  const foe = pickNames(rnd, L.c[0], used).map((name) => ({ name, hp: cHp }));
  if (L.boss) foe[0] = { name: L.boss[0], hp: Math.round(L.boss[1] * HP_SCALE[difficulty]), boss: true };
  return {
    W: SIZES[L.size], shape: L.shape, seed: L.seed, theme: st.theme, girders: !!L.girders, caves: L.caves || 0,
    gravity: L.gravity || 1, wind: L.wind, turnTime: 45, slippery: !!L.slippery, crates: L.crates ?? 0.35,
    suddenDeath: L.suddenDeath || 0, mines: L.mines || 0, barrels: L.barrels || 0, first: 0,
    teams: [
      { name: 'Your Crew', color: playerColor, cpu: false, ammo: { ...ammo }, members: pickNames(rnd, L.p[0], used).map((name) => ({ name, hp: L.p[1] })) },
      { name: st.foe, color: playerColor === st.foeColor ? '#3aa0ff' : st.foeColor, cpu: true, difficulty, ammo: { ...ammo }, members: foe },
    ],
  };
}

export const SKIRMISH_DEFAULTS = {
  theme: 'random', shape: 'random', size: 'M', you: 4, cpus: 1, cpuSize: 4, hp: 100, turn: 45, wind: 'normal',
  mines: true, barrels: true, crates: true, sudden: 10, gravity: 'normal', color: 0, arsenal: 'full',
};
export const SHAPES = [
  { id: 'hills', name: 'Hills', icon: '⛰️' }, { id: 'islands', name: 'Islands', icon: '🏝️' }, { id: 'caves', name: 'Caves', icon: '🕳️' },
  { id: 'floaters', name: 'Floating', icon: '☁️' }, { id: 'towers', name: 'Towers', icon: '🗼' }, { id: 'bowl', name: 'Valley', icon: '🥣' },
];
const WINDS = { off: 0, calm: 0.25, normal: 0.55, wild: 1 };

/** Turn the skirmish form into a match config. Random choices use `seed`. */
export function skirmishMatch(o, difficulty, seed) {
  const rnd = rng(seed * 7 + 3);
  const theme = o.theme === 'random' ? THEME_KEYS[Math.floor(rnd() * THEME_KEYS.length)] : o.theme;
  const shape = o.shape === 'random' ? SHAPES[Math.floor(rnd() * SHAPES.length)].id : o.shape;
  const used = new Set();
  const ammo = { ...(ARSENALS[o.arsenal] || ARSENALS.full) };
  const pColor = TEAM_COLORS[o.color % TEAM_COLORS.length];
  const others = TEAM_COLORS.filter((c) => c !== pColor);
  const foeNames = ['Gumdrop Gang', 'Moss Mob', 'Frost Bites', 'Magma Mites', 'Moon Goons', 'Pickle Posse'];
  const teams = [{ name: 'Your Crew', color: pColor, cpu: false, ammo: { ...ammo }, members: pickNames(rnd, o.you, used).map((name) => ({ name, hp: o.hp })) }];
  const fn = foeNames.slice().sort(() => rnd() - 0.5);
  for (let i = 0; i < o.cpus; i++) {
    teams.push({ name: fn[i], color: others[i], cpu: true, difficulty, ammo: { ...ammo }, members: pickNames(rnd, o.cpuSize, used).map((name) => ({ name, hp: o.hp })) });
  }
  const moon = theme === 'moon';
  return {
    W: SIZES[o.size] || SIZES.M, shape, seed, theme, girders: rnd() < 0.5 || shape === 'towers', caves: shape === 'hills' || shape === 'bowl' ? rnd() * 0.8 : 0,
    gravity: o.gravity === 'low' || (o.gravity === 'theme' && moon) ? 0.5 : 1, wind: WINDS[o.wind] ?? 0.55, turnTime: o.turn,
    slippery: theme === 'frost', crates: o.crates ? 0.4 : 0, suddenDeath: o.sudden || 0,
    mines: o.mines ? Math.round(o.size === 'L' ? 5 : o.size === 'S' ? 2 : 3) : 0, barrels: o.barrels ? (o.size === 'L' ? 5 : 3) : 0,
    first: Math.floor(rnd() * teams.length), teams,
  };
}

/** A CPU-vs-CPU match that plays behind the title menu. */
export function demoMatch(seed) {
  const rnd = rng(seed);
  const theme = THEME_KEYS[Math.floor(rnd() * THEME_KEYS.length)];
  const shape = SHAPES[Math.floor(rnd() * SHAPES.length)].id;
  const used = new Set();
  const ammo = { ...ARSENALS.full };
  return {
    W: SIZES.M, shape, seed, theme, girders: shape === 'towers', caves: 0.4, gravity: theme === 'moon' ? 0.5 : 1, wind: 0.4, turnTime: 30,
    slippery: theme === 'frost', crates: 0.4, suddenDeath: 6, mines: 2, barrels: 3, first: 0,
    teams: [
      { name: 'Red Rockets', color: '#ff5a5a', cpu: true, difficulty: 'hard', ammo: { ...ammo }, members: pickNames(rnd, 3, used).map((name) => ({ name, hp: 100 })) },
      { name: 'Blue Blasters', color: '#3aa0ff', cpu: true, difficulty: 'hard', ammo: { ...ammo }, members: pickNames(rnd, 3, used).map((name) => ({ name, hp: 100 })) },
    ],
  };
}

export { WEAPON_ORDER };
