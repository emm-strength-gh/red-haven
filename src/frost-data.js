// Frostfall — pure game data and balance formulas (no three.js, unit-testable).

export const CELL = 4;            // build grid cell size (world units)
export const DAY_LEN = 80;        // seconds of daylight
export const NIGHT_LEN = 42;      // seconds of night (crawler wave)
export const WORLD_R = 66;        // playable radius around the Heat Core

export const RES = ['ice', 'metal', 'fuel'];
export const RES_INFO = {
  ice: { name: 'Ice', emoji: '🧊', color: '#7fe3ff' },
  metal: { name: 'Metal', emoji: '⚙️', color: '#ffc14d' },
  fuel: { name: 'Fuel', emoji: '🔥', color: '#ff8a3d' },
};
export const START_RES = { ice: 60, metal: 60, fuel: 70 };

// resource nodes out on the ice
export const NODES = {
  ice: { name: 'Ice crystals', amount: 45, yield: 3, count: 40 },
  metal: { name: 'Ore rock', amount: 40, yield: 2, count: 36 },
  fuel: { name: 'Carbon rock', amount: 40, yield: 3, count: 34 },
};

export const BUILDINGS = {
  core: {
    name: 'Heat Core', emoji: '🔥', base: { metal: 60, ice: 40 }, growth: 1.6, maxLvl: 10,
    desc: 'The heart of the outpost. It burns fuel to keep everything in the warm zone running. Upgrade it to grow the zone and unlock new buildings.',
  },
  pump: {
    name: 'Ice Pump', emoji: '🧊', base: { metal: 25, fuel: 10 }, growth: 1.5, unlock: 1,
    max: (L) => Math.min(4, 1 + Math.floor(L / 2)), prod: { ice: 0.45 },
    desc: 'Pumps ice up from under the polar cap.',
  },
  drill: {
    name: 'Metal Drill', emoji: '⚙️', base: { ice: 30, fuel: 10 }, growth: 1.5, unlock: 1,
    max: (L) => Math.min(4, 1 + Math.floor(L / 2)), prod: { metal: 0.35 },
    desc: 'Drills metal ore out of the bedrock.',
  },
  turret: {
    name: 'Blaster Turret', emoji: '🔫', base: { metal: 40, ice: 15 }, growth: 1.5, unlock: 1,
    max: (L) => Math.min(10, 1 + L),
    desc: 'Shoots any crawler that comes into range.',
  },
  hab: {
    name: 'Habitat', emoji: '🏠', base: { ice: 30, metal: 20 }, growth: 1.5, unlock: 1,
    max: (L) => Math.min(5, 1 + Math.floor(L / 2)),
    desc: 'Living space for helper bots. Every level adds 2 helper slots.',
  },
  wall: {
    name: 'Ice Wall', emoji: '🧱', base: { ice: 20 }, growth: 1.4, unlock: 1,
    max: (L) => Math.min(30, 4 + 3 * L),
    desc: 'A tough block that crawlers have to chew through first.',
  },
  still: {
    name: 'Fuel Still', emoji: '🛢️', base: { ice: 40, metal: 35 }, growth: 1.5, unlock: 2,
    max: (L) => Math.min(3, Math.floor(L / 2)), prod: { fuel: 0.4 },
    desc: 'Cooks fuel out of frozen carbon slush.',
  },
  workshop: {
    name: 'Workshop', emoji: '🔧', base: { metal: 70, ice: 50 }, growth: 1.55, unlock: 2,
    max: () => 1,
    desc: 'Research better tools, a stronger blaster and faster helpers.',
  },
  tesla: {
    name: 'Tesla Coil', emoji: '⚡', base: { metal: 90, fuel: 30 }, growth: 1.55, unlock: 3,
    max: (L) => Math.min(5, Math.max(0, Math.floor((L - 1) / 2))),
    desc: 'Zaps every crawler around it at once.',
  },
};
export const BUILD_ORDER = ['pump', 'drill', 'turret', 'hab', 'wall', 'still', 'workshop', 'tesla'];

export const TECH = {
  tools: { name: 'Better Tools', emoji: '⛏️', desc: 'Gather 1 more with every swing.', base: { metal: 40, ice: 20 }, growth: 1.7, max: 5 },
  blaster: { name: 'Blaster Power', emoji: '💥', desc: 'Your blaster hits 6 harder.', base: { metal: 50, fuel: 15 }, growth: 1.7, max: 5 },
  helpers: { name: 'Turbo Helpers', emoji: '🤖', desc: 'Helpers move faster and carry more.', base: { ice: 40, metal: 40 }, growth: 1.7, max: 5 },
};

export const ENEMIES = {
  crawler: { name: 'Crawler', hp: 30, speed: 3.0, dmg: 8, r: 0.75, color: '#9fd8ff', spike: '#eef9ff', reward: { metal: 2 } },
  skitter: { name: 'Skitter', hp: 14, speed: 5.2, dmg: 4, r: 0.5, color: '#6ff0d0', spike: '#d4fff4', reward: { metal: 1 } },
  brute: { name: 'Brute', hp: 150, speed: 1.8, dmg: 22, r: 1.3, color: '#9b86e0', spike: '#4d3f8a', reward: { metal: 8, fuel: 4 } },
};

const round5 = (v) => Math.max(5, Math.round(v / 5) * 5);
const scaled = (base, growth, lvl) => {
  const k = Math.pow(growth, lvl - 1), out = {};
  for (const r in base) out[r] = round5(base[r] * k);
  return out;
};

/** Cost to build (lvl 1) or upgrade to `lvl`. */
export function costFor(type, lvl) {
  const b = BUILDINGS[type];
  return scaled(b.base, b.growth ?? 1.5, lvl);
}
export function techCost(key, lvl) {
  const t = TECH[key];
  return scaled(t.base, t.growth, lvl);
}
/** Highest research level the workshop allows. */
export function techCap(workshopLvl) {
  return workshopLvl > 0 ? Math.min(5, workshopLvl + 1) : 0;
}

export function canAfford(res, cost) {
  return Object.keys(cost).every((r) => (res[r] ?? 0) >= cost[r]);
}
export function pay(res, cost) {
  for (const r in cost) res[r] -= cost[r];
}

/** How many of a building type the current Heat Core level allows. */
export function maxCount(type, coreLvl) {
  const b = BUILDINGS[type];
  if (type === 'core') return 1;
  if (coreLvl < (b.unlock ?? 1)) return 0;
  return b.max(coreLvl);
}
/** Highest level a building may reach (everything is capped by the core). */
export function maxLevel(type, coreLvl) {
  return type === 'core' ? BUILDINGS.core.maxLvl : coreLvl;
}
/** Types that become available exactly at core level `lvl`. */
export function unlocksAt(lvl) {
  return BUILD_ORDER.filter((t) => (BUILDINGS[t].unlock ?? 1) === lvl);
}

export function warmRadius(coreLvl) { return 13 + coreLvl * 3; }
export function fuelBurn(coreLvl, night) { return (0.25 + 0.07 * coreLvl) * (night ? 1.5 : 1); }
export function helperCap(habLevels) { return 2 + 2 * habLevels.reduce((a, b) => a + b, 0); }
export function recruitCost(owned) { return { ice: round5(20 + 12 * owned), metal: round5(15 + 10 * owned) }; }

export function buildingHp(type, lvl) {
  switch (type) {
    case 'core': return 500 + 200 * lvl;
    case 'wall': return 300 + 200 * (lvl - 1);
    case 'turret': return 160 + 60 * lvl;
    case 'tesla': return 200 + 80 * lvl;
    default: return 150 + 60 * lvl;
  }
}
export function prodRate(type, lvl) {
  const p = BUILDINGS[type]?.prod;
  if (!p) return null;
  const out = {};
  for (const r in p) out[r] = +(p[r] * lvl).toFixed(2);
  return out;
}
export function turretStats(lvl) { return { range: 12 + lvl, dmg: 8 + 5 * (lvl - 1), rate: 1.3 + 0.15 * lvl }; }
export function teslaStats(lvl) { return { range: 8.5 + 0.5 * lvl, dmg: 7 + 4 * (lvl - 1), period: Math.max(0.9, 1.7 - 0.08 * lvl), targets: 3 + lvl }; }

/** The crawler wave that attacks on the night of `day`. */
export function waveFor(day) {
  return {
    crawler: 3 + Math.floor(day * 2.2),
    skitter: day >= 2 ? Math.floor(day * 1.5) : 0,
    brute: day >= 3 ? Math.floor((day - 1) / 2) : 0,
    hpMul: 1 + 0.15 * (day - 1),
    dirs: Math.min(3, 1 + Math.floor((day - 1) / 3)),
  };
}
