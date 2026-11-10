// Little Cup Café — pure game data and rules (no DOM / three.js), so it can be unit tested.

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- ingredients & prep steps
export const INGREDIENTS = {
  beans: { name: 'Coffee beans', icon: '🫘', pack: 10, cost: 9 },
  milk: { name: 'Milk', icon: '🥛', pack: 10, cost: 7 },
  tea: { name: 'Tea leaves', icon: '🍃', pack: 10, cost: 5 },
  ice: { name: 'Ice', icon: '🧊', pack: 10, cost: 3 },
  cocoa: { name: 'Cocoa', icon: '🍫', pack: 10, cost: 6 },
  matcha: { name: 'Matcha', icon: '🍵', pack: 10, cost: 10 },
  chai: { name: 'Chai spice', icon: '🌰', pack: 10, cost: 7 },
  lemon: { name: 'Lemons', icon: '🍋', pack: 10, cost: 6 },
  syrup: { name: 'Syrups', icon: '🍯', pack: 10, cost: 8 },
  cups: { name: 'Cups', icon: '🥤', pack: 20, cost: 4 },
  pastry: { name: 'Pastries', icon: '🥐', pack: 6, cost: 9 }
};

// timed steps use a stop-the-needle gauge; the rest are a single tap
export const STEPS = {
  shot: { name: 'Pull shot', icon: '☕', ing: 'beans', timed: true, machine: 'espresso' },
  drip: { name: 'Drip brew', icon: '⏬', ing: 'beans' },
  steam: { name: 'Steam milk', icon: '♨️', ing: 'milk', timed: true, machine: 'espresso' },
  foam: { name: 'Foam top', icon: '☁️' },
  milk: { name: 'Cold milk', icon: '🥛', ing: 'milk' },
  cream: { name: 'Whip cream', icon: '🍦', ing: 'milk' },
  ice: { name: 'Ice', icon: '🧊', ing: 'ice' },
  kettle: { name: 'Hot water', icon: '🫖' },
  leaves: { name: 'Tea leaves', icon: '🍃', ing: 'tea' },
  coldbrew: { name: 'Cold brew', icon: '🧋', ing: 'beans' },
  cocoa: { name: 'Cocoa', icon: '🍫', ing: 'cocoa' },
  matcha: { name: 'Matcha', icon: '🍵', ing: 'matcha' },
  chai: { name: 'Chai spice', icon: '🌰', ing: 'chai' },
  lemon: { name: 'Squeeze lemon', icon: '🍋', ing: 'lemon' },
  vanilla: { name: 'Vanilla', icon: '🌼', ing: 'syrup' },
  caramel: { name: 'Caramel', icon: '🍮', ing: 'syrup' }
};

export const RECIPES = {
  coffee: { name: 'Coffee', icon: '☕', steps: ['drip'], price: 3, color: '#6b3f22' },
  espresso: { name: 'Espresso', icon: '🫘', steps: ['shot'], price: 3.5, color: '#3a2011' },
  latte: { name: 'Latte', icon: '🥛', steps: ['shot', 'steam'], price: 5, color: '#c99a6b' },
  cappuccino: { name: 'Cappuccino', icon: '☁️', steps: ['shot', 'steam', 'foam'], price: 5, color: '#b98455' },
  tea: { name: 'Tea', icon: '🍃', steps: ['kettle', 'leaves'], price: 3, color: '#b5873a' },
  coldbrew: { name: 'Cold Brew', icon: '🧋', steps: ['coldbrew', 'ice'], price: 4, color: '#4a2a18' },
  icedlatte: { name: 'Iced Latte', icon: '🧊', steps: ['shot', 'milk', 'ice'], price: 5, color: '#c49a72' },
  lemonade: { name: 'Lemonade', icon: '🍋', steps: ['lemon', 'ice'], price: 3.5, color: '#f4dc6b' },
  mocha: { name: 'Mocha', icon: '🍫', steps: ['shot', 'cocoa', 'steam'], price: 5.5, color: '#6e3b24' },
  matcha: { name: 'Matcha Latte', icon: '🍵', steps: ['matcha', 'steam'], price: 5.5, color: '#8fbf5a' },
  chai: { name: 'Chai Latte', icon: '🌰', steps: ['kettle', 'chai', 'steam'], price: 5, color: '#c08850' },
  hotchoc: { name: 'Hot Chocolate', icon: '🍦', steps: ['cocoa', 'steam', 'cream'], price: 4.5, color: '#7a4027' }
};

// City Roastery custom requests: one extra step on top of the base recipe
export const MODS = {
  extra: { name: 'extra shot', step: 'shot', price: 1 },
  vanilla: { name: 'vanilla', step: 'vanilla', price: 0.75 },
  caramel: { name: 'caramel', step: 'caramel', price: 0.75 }
};

export const stepsFor = (recipe, mod) => [...RECIPES[recipe].steps, ...(mod ? [MODS[mod].step] : [])];
export const ingredientUse = (steps) => {
  const use = { cups: 1 };
  for (const s of steps) { const ing = STEPS[s].ing; if (ing) use[ing] = (use[ing] || 0) + 1; }
  return use;
};
export const ingredientsForRecipe = (recipe, mod) => ingredientUse(stepsFor(recipe, mod));

// a drink is correct when it contains exactly the right steps (order is forgiving)
export function drinkMatches(made, recipe, mod) {
  const want = [...stepsFor(recipe, mod)].sort().join(',');
  return [...made].sort().join(',') === want;
}

// needle accuracy on a 0..1 gauge with a sweet spot centred at `center`
export function gaugeAccuracy(pos, center, halfWidth) {
  const d = Math.abs(pos - center);
  if (d <= halfWidth) return 1 - (d / halfWidth) * 0.15;
  return clamp(0.85 - (d - halfWidth) * 1.4, 0.45, 0.85);
}

// ---------------------------------------------------------------- furniture
export const FURNITURE = {
  chair: { name: 'Wood Chair', cat: 'seat', cost: 20, comfort: 1, seat: true },
  stool: { name: 'Bar Stool', cat: 'seat', cost: 15, comfort: 0, seat: true },
  armchair: { name: 'Armchair', cat: 'seat', cost: 60, comfort: 3, seat: true, rep: 2 },
  sofa: { name: 'Loveseat', cat: 'seat', cost: 95, comfort: 4, seat: true, rep: 4 },
  table: { name: 'Square Table', cat: 'table', cost: 30, comfort: 1, table: true },
  roundtable: { name: 'Round Table', cat: 'table', cost: 40, comfort: 2, table: true },
  bistro: { name: 'Bistro Table', cat: 'table', cost: 35, comfort: 1, table: true, rep: 2 },
  plant: { name: 'Potted Plant', cat: 'plant', cost: 15, comfort: 2 },
  bigplant: { name: 'Monstera', cat: 'plant', cost: 40, comfort: 4, rep: 2 },
  flowerbox: { name: 'Flower Box', cat: 'plant', cost: 25, comfort: 3 },
  cactus: { name: 'Cactus', cat: 'plant', cost: 18, comfort: 2, rep: 3 },
  lamp: { name: 'Floor Lamp', cat: 'light', cost: 30, comfort: 2 },
  lantern: { name: 'Paper Lantern', cat: 'light', cost: 35, comfort: 3, rep: 3 },
  candles: { name: 'Candle Stand', cat: 'light', cost: 28, comfort: 2, rep: 2 },
  bookshelf: { name: 'Bookshelf', cat: 'decor', cost: 55, comfort: 4 },
  rug: { name: 'Woven Rug', cat: 'decor', cost: 30, comfort: 2, floor: true },
  umbrella: { name: 'Sun Umbrella', cat: 'decor', cost: 45, comfort: 3, rep: 3 },
  fireplace: { name: 'Fireplace', cat: 'decor', cost: 140, comfort: 7, rep: 5 },
  jukebox: { name: 'Jukebox', cat: 'decor', cost: 120, comfort: 5, reward: true }
};
export const FURNITURE_CATS = [
  { id: 'seat', name: 'Seats', icon: '🪑' }, { id: 'table', name: 'Tables', icon: '🟫' },
  { id: 'plant', name: 'Plants', icon: '🪴' }, { id: 'light', name: 'Lights', icon: '💡' },
  { id: 'decor', name: 'Décor', icon: '📚' }
];

// ---------------------------------------------------------------- equipment & staff
export const EQUIPMENT = {
  grinder: { name: 'Burr Grinder', icon: '⚙️', cost: 90, desc: 'Wider sweet spot when pulling shots.' },
  wand: { name: 'Steam Wand Pro', icon: '♨️', cost: 110, desc: 'Wider sweet spot when steaming milk.' },
  dualboiler: { name: 'Dual-Boiler Machine', icon: '🔧', cost: 220, desc: 'Baristas work 25% faster.', rep: 3 },
  backup: { name: 'Backup Station', icon: '🧰', cost: 120, desc: 'Keeps espresso drinks going if the machine breaks.', rep: 2 },
  pastrycase: { name: 'Pastry Case', icon: '🥐', cost: 140, desc: 'Customers may add a pastry (+$3).' },
  speakers: { name: 'Cozy Speakers', icon: '🎵', cost: 80, desc: '+8 comfort from soft music.' },
  sign: { name: 'Chalk Sign', icon: '🪧', cost: 150, desc: '+15% walk-in customers.', rep: 2 },
  tipjar: { name: 'Tip Jar', icon: '🫙', cost: 60, desc: '+15% tips.' }
};

export const ROLES = {
  barista: { name: 'Barista', icon: '☕', desc: 'Makes queued drinks on their own.' },
  cashier: { name: 'Cashier', icon: '🧾', desc: 'Takes orders at the register.' },
  runner: { name: 'Runner', icon: '🧹', desc: 'Cleans spills and greets guests (+patience).' }
};
const FIRST = ['Mia', 'Leo', 'Ava', 'Noah', 'Ivy', 'Kai', 'Zoe', 'Eli', 'Ruby', 'Omar', 'Nina', 'Theo', 'Luna', 'Sam', 'Iris', 'Finn', 'June', 'Ravi', 'Yuki', 'Ada', 'Milo', 'Rosa', 'Jude', 'Tess', 'Arlo', 'Lena', 'Hugo', 'Pia', 'Cole', 'Wren'];
export const randomName = (rng) => FIRST[Math.floor(rng() * FIRST.length)];
export function makeCandidate(rng, role, id) {
  const speed = +(0.6 + rng() * 0.5).toFixed(2), skill = +(0.55 + rng() * 0.35).toFixed(2);
  return { id, name: randomName(rng), role, speed, skill, level: 1, xp: 0, wage: Math.round(18 + speed * 14 + skill * 16) };
}
export function staffGainXp(member, n = 1) {
  member.xp += n;
  const need = 6 + member.level * 4;
  if (member.xp >= need && member.level < 5) {
    member.xp -= need; member.level++;
    member.speed = +Math.min(1.6, member.speed + 0.08).toFixed(2);
    member.skill = +Math.min(0.99, member.skill + 0.05).toFixed(2);
    member.wage += 3;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- customers
export const CUSTOMER_TYPES = {
  local: { name: 'Local', budget: 1.15, patience: 1, takeaway: 0.25, stay: 1, picky: 1, tip: 1 },
  student: { name: 'Student', budget: 0.95, patience: 1.2, takeaway: 0.1, stay: 1.6, picky: 0.8, tip: 0.7, laptop: true },
  tourist: { name: 'Tourist', budget: 1.4, patience: 0.75, takeaway: 0.6, stay: 0.7, picky: 0.9, tip: 1.3 },
  nightowl: { name: 'Night owl', budget: 1.2, patience: 0.85, takeaway: 0.45, stay: 0.8, picky: 1.1, tip: 1.1 },
  hiker: { name: 'Hiker', budget: 1.5, patience: 1.25, takeaway: 0.05, stay: 1.4, picky: 1.6, tip: 1.4 },
  business: { name: 'Professional', budget: 1.45, patience: 0.7, takeaway: 0.55, stay: 0.6, picky: 1.2, tip: 1.2, custom: true },
  critic: { name: 'Food critic', budget: 2, patience: 1.1, takeaway: 0, stay: 1.2, picky: 2, tip: 0.5 }
};

export function customerSatisfaction({ waitFrac, correct, quality, comfort, price, budget, seated, wantedSeat, picky = 1, celebration = false }) {
  let s = 92;
  s -= clamp(waitFrac, 0, 1) * 38;
  if (!correct) s -= 55;
  s += (quality - 0.75) * 40 * picky;
  s += (comfort - 50) / 6;
  if (price > budget) s -= ((price - budget) / budget) * 70;
  if (wantedSeat && !seated) s -= 12;
  if (celebration) s += 10;
  return Math.round(clamp(s, 0, 100));
}

export function tipFor(sat, price, mul = 1) {
  if (sat < 60) return 0;
  return Math.round(price * ((sat - 60) / 40) * 0.28 * mul * 4) / 4; // to the quarter
}

// how likely someone who would like this drink actually orders at this price
export const priceAcceptance = (price, base) => clamp(1.35 - (price / base - 1) * 1.6, 0, 1);

export function comfortScore(layout, bonus = 0) {
  let sum = bonus;
  for (const f of layout) sum += FURNITURE[f.type]?.comfort || 0;
  return Math.round(100 * (1 - Math.exp(-sum / 22)));
}

export function arrivalInterval({ repLevel, comfort, mul = 1, seats }) {
  const base = 8.5 / (1 + Math.min(repLevel, 8) * 0.05) / (0.75 + comfort / 200) / mul;
  return clamp(base * (seats < 2 ? 1.15 : 1), 2.4, 14);
}

// ---------------------------------------------------------------- reputation
export const REP_XP = [0, 50, 130, 250, 420, 650, 950, 1320, 1780, 2350, 3050];
export function repLevel(xp) { let l = 0; while (l + 1 < REP_XP.length && xp >= REP_XP[l + 1]) l++; return l + 1; }
export function repProgress(xp) {
  const l = repLevel(xp) - 1;
  if (l + 1 >= REP_XP.length) return 1;
  return (xp - REP_XP[l]) / (REP_XP[l + 1] - REP_XP[l]);
}

// ---------------------------------------------------------------- locations & levels
// Grids: x = 0..w-1 (left wall at x=0), z = 0..d-1 (back wall at z=0, front at d-1).
// The counter always runs along z=1 from cx0..cx1, baristas stand at z=0.
export const LOCATIONS = [
  {
    id: 'corner', name: 'Corner Café', blurb: 'Learn the basics on a quiet neighbourhood corner.',
    w: 12, d: 10, base: [0, 0, 9, 7], cx: [5, 9], door: 1, shift: 150, maxStaff: 2,
    palette: { wall: '#f1dcc4', wallLow: '#8a5a3a', floor: ['#b9825a', '#ad7650'], trim: '#6e4429', accent: '#5f8a6a', outside: '#7fa463', sky: '#ffd9a8' },
    recipes: ['coffee', 'espresso', 'latte', 'cappuccino', 'tea', 'mocha'],
    types: { local: 6, student: 3, tourist: 1 },
    expansions: [
      { id: 'nook', name: 'Window Nook', cost: 180, rep: 2, rects: [[10, 0, 11, 7]], kind: 'indoor', desc: 'Two more rows of seating by the big windows.' },
      { id: 'patio', name: 'Front Patio', cost: 260, rep: 3, rects: [[0, 8, 9, 9]], kind: 'patio', desc: 'Sunny sidewalk tables. More walk-ins.', arrival: 1.12 },
      { id: 'window', name: 'Takeaway Window', cost: 200, rep: 4, rects: [], kind: 'takeaway', desc: 'Grab-and-go guests skip the seats.', takeaway: 0.2, arrival: 1.1 }
    ],
    start: [['table', 2, 3], ['chair', 1, 3], ['chair', 3, 3], ['roundtable', 3, 5], ['chair', 2, 5], ['chair', 4, 5], ['plant', 0, 0], ['plant', 4, 0], ['rug', 3, 4]]
  },
  {
    id: 'seaside', name: 'Seaside Kiosk', blurb: 'Tourist rushes, sea breeze and fickle weather.',
    w: 12, d: 10, base: [3, 0, 9, 4], cx: [5, 9], door: 4, shift: 150, maxStaff: 3,
    palette: { wall: '#e8f3f4', wallLow: '#3d7f99', floor: ['#e5d3a7', '#dcc796'], trim: '#2f6a80', accent: '#f08a5d', outside: '#f0dca5', sky: '#bfe7f5' },
    recipes: ['coffee', 'espresso', 'latte', 'icedlatte', 'coldbrew', 'lemonade'],
    types: { tourist: 6, local: 2, student: 1 },
    expansions: [
      { id: 'deck', name: 'Boardwalk Deck', cost: 220, rep: 3, rects: [[0, 5, 9, 7]], kind: 'patio', desc: 'Sea-view deck for sit-down guests.', arrival: 1.1 },
      { id: 'window', name: 'Takeaway Window', cost: 160, rep: 3, rects: [], kind: 'takeaway', desc: 'Faster grab-and-go for beach crowds.', takeaway: 0.25, arrival: 1.15 },
      { id: 'pier', name: 'Pier Corner', cost: 240, rep: 5, rects: [[10, 0, 11, 7]], kind: 'patio', desc: 'More deck space along the water.' }
    ],
    start: [['bistro', 1, 6], ['stool', 0, 6], ['stool', 2, 6], ['umbrella', 3, 1], ['flowerbox', 3, 4]],
    startExpansions: ['deck']
  },
  {
    id: 'night', name: 'Night Market Stall', blurb: 'Short, busy shifts and specialty drinks under lanterns.',
    w: 9, d: 7, base: [0, 0, 6, 4], cx: [3, 6], door: 1, shift: 105, maxStaff: 2, night: true,
    palette: { wall: '#3b2a4a', wallLow: '#7a3b5e', floor: ['#4b3a44', '#433340'], trim: '#c2425e', accent: '#ffb347', outside: '#2a2238', sky: '#1d1630' },
    recipes: ['espresso', 'latte', 'matcha', 'chai', 'mocha', 'coldbrew'],
    types: { nightowl: 6, student: 2, tourist: 2 },
    expansions: [
      { id: 'alley', name: 'Lantern Alley', cost: 200, rep: 4, rects: [[0, 5, 6, 6]], kind: 'patio', desc: 'Stools along the market lane.', arrival: 1.1 },
      { id: 'window', name: 'Hatch Window', cost: 150, rep: 4, rects: [], kind: 'takeaway', desc: 'Serve walkers straight from the hatch.', takeaway: 0.3, arrival: 1.15 },
      { id: 'side', name: 'Side Canopy', cost: 220, rep: 5, rects: [[7, 0, 8, 6]], kind: 'patio', desc: 'Covered seats beside the stall.' }
    ],
    start: [['bistro', 0, 1], ['stool', 0, 0], ['stool', 0, 2], ['lantern', 2, 0], ['lantern', 0, 4]]
  },
  {
    id: 'lodge', name: 'Mountain Lodge Café', blurb: 'Fewer, pickier guests — and late deliveries.',
    w: 12, d: 10, base: [0, 0, 9, 7], cx: [5, 9], door: 1, shift: 165, maxStaff: 2, delivery: true,
    palette: { wall: '#c9a27a', wallLow: '#5a3b2a', floor: ['#7a5236', '#70492f'], trim: '#3e2a1e', accent: '#b8463c', outside: '#e9eef2', sky: '#c9dbe8' },
    recipes: ['coffee', 'latte', 'cappuccino', 'tea', 'hotchoc', 'chai', 'mocha'],
    types: { hiker: 6, local: 2, tourist: 1 },
    expansions: [
      { id: 'loft', name: 'Timber Loft', cost: 320, rep: 5, rects: [[10, 0, 11, 7]], kind: 'loft', desc: 'A raised loft with a staircase.', arrival: 1.08 },
      { id: 'terrace', name: 'Snowy Terrace', cost: 240, rep: 5, rects: [[0, 8, 9, 9]], kind: 'patio', desc: 'Blankets and mountain views.', arrival: 1.1 }
    ],
    start: [['fireplace', 0, 2], ['armchair', 2, 3], ['armchair', 2, 1], ['table', 2, 2], ['rug', 1, 2], ['bookshelf', 0, 0], ['roundtable', 3, 5], ['chair', 2, 5], ['chair', 4, 5]]
  },
  {
    id: 'roastery', name: 'City Roastery', blurb: 'High volume, a big team and custom drinks.',
    w: 13, d: 10, base: [0, 0, 10, 7], cx: [5, 10], door: 1, shift: 165, maxStaff: 5, custom: true,
    palette: { wall: '#d9d4cc', wallLow: '#3c3f46', floor: ['#8c6f58', '#7f644f'], trim: '#2b2d33', accent: '#d6763c', outside: '#9aa3ad', sky: '#ffd0a0' },
    recipes: ['coffee', 'espresso', 'latte', 'cappuccino', 'icedlatte', 'coldbrew', 'mocha', 'matcha'],
    types: { business: 5, local: 3, student: 2, tourist: 1 },
    expansions: [
      { id: 'mezz', name: 'Mezzanine Floor', cost: 380, rep: 6, rects: [[11, 0, 12, 7]], kind: 'loft', desc: 'A second floor of seats up the stairs.', arrival: 1.1 },
      { id: 'window', name: 'Street Window', cost: 220, rep: 6, rects: [], kind: 'takeaway', desc: 'Commuters order from the sidewalk.', takeaway: 0.25, arrival: 1.15 },
      { id: 'patio', name: 'Plaza Patio', cost: 280, rep: 6, rects: [[0, 8, 10, 9]], kind: 'patio', desc: 'Tables on the plaza.', arrival: 1.1 }
    ],
    start: [['table', 2, 3], ['stool', 1, 3], ['stool', 3, 3], ['table', 2, 5], ['stool', 1, 5], ['stool', 3, 5], ['plant', 0, 0], ['bookshelf', 4, 0], ['lamp', 0, 6]]
  }
];

// goal: {type, n?, recipe?, ing?, optional?, reward?}
export const LEVELS = {
  corner: [
    { name: 'Opening Day', goals: [{ type: 'drinks', n: 8 }, { type: 'earn', n: 35 }, { type: 'happiness', n: 70, optional: true, reward: { coins: 30 } }], recipes: 3, arrival: 0.85, tutorial: true },
    { name: 'The Morning Crowd', goals: [{ type: 'customers', n: 12 }, { type: 'earn', n: 60 }, { type: 'featured', recipe: 'cappuccino', n: 3, optional: true, reward: { coins: 40 } }], recipes: 4, events: ['promo'], troubles: ['spill'] },
    { name: 'A Local Favourite', goals: [{ type: 'earn', n: 90 }, { type: 'happiness', n: 75 }, { type: 'seats', n: 8, optional: true, reward: { decor: 'jukebox' } }], recipes: 6, events: ['celebration'], troubles: ['machine'] }
  ],
  seaside: [
    { name: 'Boardwalk Breeze', goals: [{ type: 'customers', n: 14 }, { type: 'takeaway', n: 5 }, { type: 'earn', n: 70, optional: true, reward: { coins: 40 } }], recipes: 4, events: ['rain'], troubles: ['shortage'] },
    { name: 'Tourist Season', goals: [{ type: 'earn', n: 110 }, { type: 'happiness', n: 70 }, { type: 'nostockout', ing: 'ice', optional: true, reward: { coins: 50 } }], recipes: 5, events: ['festival'], troubles: ['rush'], arrival: 1.15 },
    { name: 'Summer Festival', goals: [{ type: 'drinks', n: 22 }, { type: 'featured', recipe: 'lemonade', n: 4 }, { type: 'rep', n: 5, optional: true, reward: { decor: 'umbrella' } }], recipes: 6, events: ['festival', 'critic'], troubles: ['machine', 'sick'] }
  ],
  night: [
    { name: 'Lanterns On', goals: [{ type: 'drinks', n: 12 }, { type: 'earn', n: 55 }, { type: 'featured', recipe: 'matcha', n: 3, optional: true, reward: { coins: 40 } }], recipes: 4, arrival: 1.25, troubles: ['rush'] },
    { name: 'Midnight Rush', goals: [{ type: 'customers', n: 16 }, { type: 'happiness', n: 70 }, { type: 'takeaway', n: 6, optional: true, reward: { coins: 50 } }], recipes: 5, arrival: 1.4, events: ['promo'], troubles: ['spill', 'sick'] },
    { name: 'Market Legend', goals: [{ type: 'earn', n: 120 }, { type: 'critic' }, { type: 'nostockout', ing: 'milk', optional: true, reward: { decor: 'lantern' } }], recipes: 6, arrival: 1.4, events: ['critic'], troubles: ['shortage', 'machine'] }
  ],
  lodge: [
    { name: 'First Snow', goals: [{ type: 'happiness', n: 80 }, { type: 'earn', n: 70 }, { type: 'featured', recipe: 'hotchoc', n: 3, optional: true, reward: { coins: 50 } }], recipes: 5, arrival: 0.75, troubles: ['delivery'] },
    { name: 'Ski Weekend', goals: [{ type: 'customers', n: 12 }, { type: 'nostockout', ing: 'milk' }, { type: 'happiness', n: 85, optional: true, reward: { coins: 60 } }], recipes: 6, arrival: 0.85, events: ['celebration'], troubles: ['delivery', 'machine'] },
    { name: 'Summit Celebration', goals: [{ type: 'earn', n: 130 }, { type: 'critic' }, { type: 'seats', n: 12, optional: true, reward: { decor: 'fireplace' } }], recipes: 7, arrival: 0.9, events: ['critic', 'festival'], troubles: ['delivery', 'sick'] }
  ],
  roastery: [
    { name: 'Grand Opening', goals: [{ type: 'drinks', n: 22 }, { type: 'earn', n: 120 }, { type: 'custom', n: 5, optional: true, reward: { coins: 60 } }], recipes: 5, arrival: 1.35, troubles: ['rush'] },
    { name: 'Commuter Crush', goals: [{ type: 'customers', n: 26 }, { type: 'custom', n: 8 }, { type: 'happiness', n: 75, optional: true, reward: { coins: 80 } }], recipes: 6, arrival: 1.55, events: ['promo'], troubles: ['sick', 'spill', 'machine'] },
    { name: 'Best Roast in Town', goals: [{ type: 'earn', n: 220 }, { type: 'rep', n: 8 }, { type: 'critic', optional: true, reward: { coins: 120 } }], recipes: 8, arrival: 1.6, events: ['critic', 'festival'], troubles: ['shortage', 'machine', 'rush'] }
  ]
};

export const EVENTS = {
  festival: { name: 'Local Festival', icon: '🎪', desc: 'Crowds are out! More customers, and seasonal drinks are popular.' },
  rain: { name: 'Rainy Day', icon: '🌧️', desc: 'Fewer walk-ins, but lots of takeaway orders.' },
  critic: { name: 'Food Critic Visit', icon: '🎩', desc: 'A critic will drop by. Great service and quality earns a big reputation boost.' },
  promo: { name: 'Seasonal Promotion', icon: '🍂', desc: 'One recipe is featured today — it earns +50% tips.' },
  celebration: { name: "Regular's Celebration", icon: '🎉', desc: 'A regular is celebrating! Serve their special order before they leave.' }
};

export const TROUBLES = {
  machine: { name: 'Espresso machine jammed', icon: '🔧' },
  delivery: { name: 'Delivery running late', icon: '🚚' },
  rush: { name: 'Rush incoming', icon: '🏃' },
  sick: { name: 'Staff called in sick', icon: '🤒' },
  spill: { name: 'Spill on the floor', icon: '💧' },
  shortage: { name: 'Supply shortage', icon: '📦' }
};

export function goalLabel(g) {
  switch (g.type) {
    case 'earn': return `Earn $${g.n} this shift`;
    case 'customers': return `Serve ${g.n} customers`;
    case 'drinks': return `Serve ${g.n} drinks`;
    case 'happiness': return `Keep happiness ≥ ${g.n}%`;
    case 'featured': return `Make ${g.n} great ${RECIPES[g.recipe].name}s`;
    case 'rep': return `Reach reputation ★${g.n}`;
    case 'nostockout': return `Never run out of ${INGREDIENTS[g.ing].name.toLowerCase()}`;
    case 'seats': return `Have ${g.n} usable seats`;
    case 'takeaway': return `Serve ${g.n} takeaway orders`;
    case 'critic': return 'Impress the food critic';
    case 'custom': return `Serve ${g.n} custom drinks`;
    default: return g.type;
  }
}

// progress toward a goal: { value, target, done }
export function goalProgress(g, st, ctx = {}) {
  const earned = Math.floor((st.revenue || 0) + (st.tips || 0));
  switch (g.type) {
    case 'earn': return { value: earned, target: g.n, done: earned >= g.n };
    case 'customers': return { value: st.served || 0, target: g.n, done: (st.served || 0) >= g.n };
    case 'drinks': return { value: st.drinks || 0, target: g.n, done: (st.drinks || 0) >= g.n };
    case 'happiness': {
      const h = st.satCount ? Math.round(st.satSum / st.satCount) : 0;
      return { value: h, target: g.n, done: st.satCount >= 3 && h >= g.n, pct: true };
    }
    case 'featured': { const v = st.featured?.[g.recipe] || 0; return { value: v, target: g.n, done: v >= g.n }; }
    case 'rep': return { value: ctx.repLevel || 1, target: g.n, done: (ctx.repLevel || 1) >= g.n };
    case 'nostockout': { const v = st.stockouts?.[g.ing] || 0; return { value: v, target: 0, done: v === 0, inverse: true }; }
    case 'seats': return { value: ctx.seats || 0, target: g.n, done: (ctx.seats || 0) >= g.n };
    case 'takeaway': return { value: st.takeaway || 0, target: g.n, done: (st.takeaway || 0) >= g.n };
    case 'critic': return { value: st.critic ? 1 : 0, target: 1, done: !!st.critic };
    case 'custom': return { value: st.custom || 0, target: g.n, done: (st.custom || 0) >= g.n };
    default: return { value: 0, target: 1, done: false };
  }
}

export function levelResult(level, st, ctx) {
  const res = level.goals.map((g) => ({ goal: g, ...goalProgress(g, st, ctx) }));
  const passed = res.filter((r) => !r.goal.optional).every((r) => r.done);
  const optionalDone = res.filter((r) => r.goal.optional && r.done).length;
  return { res, passed, stars: passed ? 1 + optionalDone + (res.every((r) => r.done) ? 1 : 0) : 0 };
}

// a location unlocks when every level of the previous location is passed
export function locationUnlocked(index, progress) {
  if (index === 0) return true;
  const prev = LOCATIONS[index - 1];
  return LEVELS[prev.id].every((_, i) => (progress[prev.id]?.[i] || 0) > 0);
}
export const levelUnlocked = (locId, i, progress) => i === 0 || (progress[locId]?.[i - 1] || 0) > 0;

// ---------------------------------------------------------------- the grid
export function activeTiles(loc, expansions = []) {
  const tiles = new Map(); // key -> {x,z,kind,h}
  const add = (r, kind, h = 0) => {
    for (let x = r[0]; x <= r[2]; x++) for (let z = r[1]; z <= r[3]; z++) tiles.set(`${x},${z}`, { x, z, kind, h });
  };
  add(loc.base, 'indoor');
  for (const id of expansions) {
    const e = loc.expansions.find((q) => q.id === id);
    if (!e) continue;
    for (const r of e.rects) add(r, e.kind === 'loft' ? 'loft' : e.kind, e.kind === 'loft' ? 1 : 0);
    if (e.kind === 'loft') {
      // a staircase where the loft meets the main floor, about halfway along
      const r = e.rects[0], sz = Math.floor((r[1] + r[3]) / 2) + 1;
      tiles.set(`${r[0]},${sz}`, { x: r[0], z: sz, kind: 'stairs', h: 0.5 });
    }
  }
  return tiles;
}

export function fixedLayout(loc) {
  const [c0, c1] = loc.cx;
  const blocked = new Set();
  for (let x = c0; x <= c1; x++) { blocked.add(`${x},0`); blocked.add(`${x},1`); }
  const register = { x: c1, z: 2 };
  const pickup = [];
  for (let x = c1 - 1; x >= c0; x--) pickup.push({ x, z: 2 });
  const queue = [register];
  for (let z = 3; z <= loc.base[3] - 1; z++) queue.push({ x: c1, z });
  const reserved = new Set([...queue, ...pickup].map((p) => `${p.x},${p.z}`));
  return { blocked, register, pickup, queue, reserved };
}

export function entrance(loc, tiles) {
  let z = -1;
  for (const t of tiles.values()) if (t.x === loc.door && t.z > z) z = t.z;
  return { x: loc.door, z };
}

export function buildGrid(loc, expansions, layout, extraBlocked = []) {
  const tiles = activeTiles(loc, expansions);
  const fixed = fixedLayout(loc);
  const ent = entrance(loc, tiles);
  const solid = new Map();
  const floor = new Map();
  for (const f of layout) (FURNITURE[f.type]?.floor ? floor : solid).set(`${f.x},${f.z}`, f);
  const extra = new Set(extraBlocked);
  const walkable = (x, z) => {
    const k = `${x},${z}`;
    return tiles.has(k) && !fixed.blocked.has(k) && !solid.has(k) && !extra.has(k);
  };
  const hAt = (x, z) => tiles.get(`${x},${z}`)?.h || 0;
  const reserved = new Set(fixed.reserved);
  for (let dz = 0; dz <= 1; dz++) reserved.add(`${ent.x},${ent.z - dz}`);
  for (const t of tiles.values()) if (t.kind === 'stairs') reserved.add(`${t.x},${t.z}`);
  return { loc, tiles, fixed, ent, solid, floor, walkable, hAt, reserved };
}

const stepOk = (g, ax, az, bx, bz) => Math.abs(g.hAt(ax, az) - g.hAt(bx, bz)) <= 0.55;

// BFS path from a to b (b may be a solid seat tile). Returns array of {x,z} including both ends, or null.
export function findPath(g, a, b) {
  const key = (x, z) => `${x},${z}`;
  const goal = key(b.x, b.z);
  if (key(a.x, a.z) === goal) return [{ x: a.x, z: a.z }];
  const prev = new Map([[key(a.x, a.z), null]]);
  const q = [[a.x, a.z]];
  while (q.length) {
    const [x, z] = q.shift();
    for (const [dx, dz] of DIR4) {
      const nx = x + dx, nz = z + dz, k = key(nx, nz);
      if (prev.has(k)) continue;
      if (!stepOk(g, x, z, nx, nz)) continue;
      if (k === goal) {
        if (!g.tiles.has(k)) continue;
        prev.set(k, key(x, z));
        const path = [];
        let c = k;
        while (c) { const [px, pz] = c.split(',').map(Number); path.push({ x: px, z: pz }); c = prev.get(c); }
        return path.reverse();
      }
      if (!g.walkable(nx, nz)) continue;
      prev.set(k, key(x, z));
      q.push([nx, nz]);
    }
  }
  return null;
}

export function reachableSet(g) {
  const seen = new Set();
  const start = g.ent;
  if (!g.walkable(start.x, start.z)) return seen;
  const q = [[start.x, start.z]];
  seen.add(`${start.x},${start.z}`);
  while (q.length) {
    const [x, z] = q.shift();
    for (const [dx, dz] of DIR4) {
      const nx = x + dx, nz = z + dz, k = `${nx},${nz}`;
      if (seen.has(k) || !g.walkable(nx, nz) || !stepOk(g, x, z, nx, nz)) continue;
      seen.add(k); q.push([nx, nz]);
    }
  }
  return seen;
}

// seats next to a table that a customer can reach; facing = direction toward the table
export function usableSeats(g) {
  const reach = reachableSet(g);
  const out = [];
  for (const f of g.solid.values()) {
    if (!FURNITURE[f.type]?.seat) continue;
    let table = null, access = false;
    for (const [dx, dz] of DIR4) {
      const n = g.solid.get(`${f.x + dx},${f.z + dz}`);
      if (n && FURNITURE[n.type]?.table && !table && g.hAt(n.x, n.z) === g.hAt(f.x, f.z)) table = { dx, dz, x: n.x, z: n.z };
      if (reach.has(`${f.x + dx},${f.z + dz}`) && stepOk(g, f.x, f.z, f.x + dx, f.z + dz)) access = true;
    }
    if (table && access) out.push({ x: f.x, z: f.z, facing: [table.dx, table.dz], table, kind: g.tiles.get(`${f.x},${f.z}`)?.kind });
  }
  return out;
}

// can furniture `type` go on tile x,z? Solid pieces must keep every service spot reachable.
export function canPlace(g, type, x, z) {
  const k = `${x},${z}`;
  const def = FURNITURE[type];
  if (!def) return { ok: false, reason: 'Unknown item' };
  if (!g.tiles.has(k)) return { ok: false, reason: 'Outside the café' };
  if (g.fixed.blocked.has(k)) return { ok: false, reason: 'That is the counter' };
  if (def.floor) return g.floor.has(k) ? { ok: false, reason: 'Already a rug here' } : { ok: true };
  if (g.reserved.has(k)) return { ok: false, reason: 'Keep the queue and door clear' };
  if (g.solid.has(k)) return { ok: false, reason: 'Tile is taken' };
  if (g.tiles.get(k).kind === 'stairs') return { ok: false, reason: 'Keep the stairs clear' };
  const solid = new Map(g.solid);
  solid.set(k, { type, x, z });
  const test = { ...g, solid, walkable: (a, b) => g.walkable(a, b) && `${a},${b}` !== k };
  const reach = reachableSet(test);
  for (const p of [...g.fixed.queue, ...g.fixed.pickup]) {
    if (g.tiles.has(`${p.x},${p.z}`) && !reach.has(`${p.x},${p.z}`)) return { ok: false, reason: 'That would block the path to the counter' };
  }
  // every loft/stair/patio tile region must stay connected through the stairs
  for (const t of g.tiles.values()) {
    if (t.kind === 'stairs' && !reach.has(`${t.x},${t.z}`)) return { ok: false, reason: 'That would block the stairs' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- shift planning helpers
export function pickOrder(rng, menu, type, featured) {
  const items = menu.filter((m) => m.on);
  if (!items.length) return null;
  const weights = items.map((m) => {
    let w = 1 * priceAcceptance(m.price, RECIPES[m.id].price);
    if (featured && m.id === featured) w *= 1.8;
    if (type === 'tourist' && ['icedlatte', 'coldbrew', 'lemonade'].includes(m.id)) w *= 1.6;
    if (type === 'hiker' && ['hotchoc', 'chai', 'tea'].includes(m.id)) w *= 1.6;
    if (type === 'nightowl' && ['matcha', 'chai', 'espresso'].includes(m.id)) w *= 1.4;
    if (type === 'student' && ['coffee', 'tea'].includes(m.id)) w *= 1.4;
    return w;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

export function weightedPick(rng, table) {
  const entries = Object.entries(table);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[0][0];
}

export function feedbackLines(st, comfort) {
  const lines = [];
  const h = st.satCount ? st.satSum / st.satCount : 0;
  if (h >= 85) lines.push('“Best cup on the block. I’ll be back tomorrow!”');
  if ((st.avgWait || 0) > 0.55) lines.push('“Lovely place, but the line moved slowly.”');
  if (st.wrong > 0) lines.push(`“My order wasn’t quite right…” (${st.wrong} mix-up${st.wrong > 1 ? 's' : ''})`);
  if (st.pricey > 0) lines.push('“A little pricey for me today.”');
  if (st.noSeat > 0) lines.push('“Couldn’t find a seat, so I took it to go.”');
  if (comfort >= 70) lines.push('“So cozy — love all the plants and lights.”');
  else if (comfort < 35) lines.push('“Feels a bit bare. Some décor would be nice.”');
  if (st.quality > 0.9 * Math.max(1, st.drinks) && st.drinks > 3) lines.push('“The foam art! The perfect shot!”');
  if (st.walkouts > 0) lines.push(`${st.walkouts} guest${st.walkouts > 1 ? 's' : ''} gave up waiting.`);
  if (!lines.length) lines.push('“Nice little café. Pleasant afternoon.”');
  return lines.slice(0, 4);
}
