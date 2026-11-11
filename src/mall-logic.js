// Little Cup Plaza — pure mall rules & data (no DOM / three.js) so they can be unit tested.

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

// ---------------------------------------------------------------- the plot
export const W = 36, D = 28;
export const T = { GRASS: 0, ROAD: 1, SIDEWALK: 2, PATH: 3, PARKING: 4, FLOOR: 5 };
export const ROAD_Z = [D - 2, D - 1];       // two road lanes along the front
export const SIDEWALK_Z = D - 3;           // fixed sidewalk between road and plot
export const BUILD_MAX_Z = D - 4;          // last buildable row

export const GROUND = {
  path: { name: 'Footpath', icon: '🟫', kind: T.PATH, cost: 8, desc: 'Outdoor walkway linking parking and entrances.' },
  parking: { name: 'Car Park', icon: '🅿️', kind: T.PARKING, cost: 16, desc: 'Each tile is one space. Must touch the sidewalk or other parking.' },
  floor: { name: 'Mall Floor', icon: '⬜', kind: T.FLOOR, cost: 30, desc: 'Indoor concourse. Walls go up around the edge automatically.' },
  entrance: { name: 'Entrance', icon: '🚪', cost: 220, desc: 'Place on an edge floor tile so shoppers can get in.' },
  demolish: { name: 'Demolish', icon: '🧨', cost: 0, desc: 'Remove ground, shops or décor (50% refund).' }
};

// ---------------------------------------------------------------- shops & services
// time: visit length in game minutes · cap: shoppers served at once per staff member
export const UNITS = {
  cafe: { name: 'Little Cup Café', cat: 'food', w: 3, d: 3, cost: 900, spend: 7, time: 22, cap: 3, staff: 3, wage: 70, attract: 3, rent: 160, color: '#e9a46b', props: 'cafe', icon: '☕' },
  bakery: { name: 'Bakery', cat: 'food', w: 3, d: 3, cost: 1100, spend: 8, time: 12, cap: 4, staff: 3, wage: 70, attract: 3, rent: 180, color: '#f2c98a', props: 'counter', icon: '🥐', research: 'bakery' },
  florist: { name: 'Florist', cat: 'fashion', w: 2, d: 3, cost: 800, spend: 14, time: 10, cap: 3, staff: 2, wage: 65, attract: 2, rent: 130, color: '#f5a6c0', props: 'flowers', icon: '💐' },
  boutique: { name: 'Boutique', cat: 'fashion', w: 3, d: 4, cost: 1600, spend: 34, time: 20, cap: 3, staff: 3, wage: 80, attract: 4, rent: 260, color: '#c58fd9', props: 'racks', icon: '👗' },
  shoes: { name: 'Shoe Store', cat: 'fashion', w: 3, d: 3, cost: 1400, spend: 40, time: 16, cap: 3, staff: 3, wage: 80, attract: 3, rent: 240, color: '#d98b48', props: 'shelves', icon: '👟', research: 'shoes' },
  pharmacy: { name: 'Pharmacy', cat: 'essentials', w: 3, d: 3, cost: 1300, spend: 16, time: 9, cap: 4, staff: 2, wage: 85, attract: 3, rent: 220, color: '#7fc4a4', props: 'shelves', icon: '💊', research: 'pharmacy' },
  toys: { name: 'Toy Shop', cat: 'leisure', w: 3, d: 3, cost: 1300, spend: 22, time: 14, cap: 3, staff: 2, wage: 70, attract: 3, rent: 210, color: '#ffd34d', props: 'shelves', icon: '🧸', research: 'toys' },
  bookstore: { name: 'Bookstore', cat: 'leisure', w: 3, d: 4, cost: 1700, spend: 18, time: 24, cap: 4, staff: 2, wage: 70, attract: 4, rent: 230, color: '#8a6a52', props: 'books', icon: '📚', research: 'bookstore' },
  restaurant: { name: 'Restaurant', cat: 'food', w: 4, d: 4, cost: 3200, spend: 26, time: 45, cap: 4, staff: 4, wage: 80, attract: 6, rent: 420, color: '#c9705b', props: 'tables', icon: '🍝', research: 'restaurant' },
  electronics: { name: 'Electronics', cat: 'tech', w: 4, d: 4, cost: 4200, spend: 70, time: 22, cap: 3, staff: 4, wage: 95, attract: 7, rent: 560, color: '#5a86c5', props: 'screens', icon: '📺', research: 'electronics' },
  arcade: { name: 'Arcade', cat: 'fun', w: 4, d: 4, cost: 3800, spend: 15, time: 35, cap: 6, staff: 2, wage: 70, attract: 7, rent: 380, color: '#9b5de5', props: 'arcade', icon: '🕹️', research: 'arcade' },
  gym: { name: 'Fitness Club', cat: 'fun', w: 5, d: 4, cost: 4800, spend: 20, time: 60, cap: 6, staff: 3, wage: 85, attract: 6, rent: 480, color: '#63b2b0', props: 'gym', icon: '🏋️', research: 'gym' },
  foodcourt: { name: 'Food Court', cat: 'food', w: 5, d: 5, cost: 6000, spend: 13, time: 30, cap: 7, staff: 5, wage: 70, attract: 9, rent: 700, color: '#f4cf6b', props: 'foodcourt', icon: '🍔', research: 'foodcourt' },
  supermarket: { name: 'Supermarket', cat: 'essentials', w: 6, d: 5, cost: 7500, spend: 42, time: 28, cap: 6, staff: 6, wage: 75, attract: 12, rent: 900, color: '#6f9a7a', props: 'market', icon: '🛒', research: 'supermarket' },
  cinema: { name: 'Cinema', cat: 'fun', w: 6, d: 6, cost: 12000, spend: 18, time: 90, cap: 12, staff: 4, wage: 80, attract: 16, rent: 1300, color: '#3c3f46', props: 'cinema', icon: '🎬', research: 'cinema' },
  bowling: { name: 'Bowling Alley', cat: 'fun', w: 6, d: 5, cost: 10000, spend: 22, time: 60, cap: 8, staff: 4, wage: 80, attract: 13, rent: 1100, color: '#e0674f', props: 'bowling', icon: '🎳', research: 'bowling' },
  // services (no sales)
  toilets: { name: 'Restrooms', cat: 'service', w: 2, d: 3, cost: 700, spend: 0, time: 5, cap: 4, staff: 0, wage: 0, attract: 0, upkeep: 30, color: '#a8c8ea', props: 'toilets', icon: '🚻', service: 'toilet' },
  office: { name: 'Management Office', cat: 'service', w: 3, d: 3, cost: 1500, spend: 0, time: 0, cap: 0, staff: 0, wage: 0, attract: 0, upkeep: 60, color: '#d9d4cc', props: 'office', icon: '🗂️', service: 'research', staffOnly: true },
  security: { name: 'Security Post', cat: 'service', w: 2, d: 2, cost: 900, spend: 0, time: 0, cap: 0, staff: 0, wage: 0, attract: 0, upkeep: 20, color: '#3f5f7a', props: 'office', icon: '🛡️', service: 'security', staffOnly: true },
  maintenance: { name: 'Workshop', cat: 'service', w: 2, d: 2, cost: 900, spend: 0, time: 0, cap: 0, staff: 0, wage: 0, attract: 0, upkeep: 20, color: '#c9a27a', props: 'office', icon: '🧰', service: 'maintenance', staffOnly: true }
};
export const UNIT_CATS = [
  { id: 'food', name: 'Food', icon: '🍽️' }, { id: 'fashion', name: 'Fashion', icon: '👗' }, { id: 'essentials', name: 'Essentials', icon: '🛒' },
  { id: 'leisure', name: 'Leisure', icon: '📚' }, { id: 'tech', name: 'Tech', icon: '📺' }, { id: 'fun', name: 'Fun', icon: '🎳' }, { id: 'service', name: 'Services', icon: '🚻' }
];
export const PRICE_LEVELS = [
  { id: 'budget', name: 'Budget', mult: 0.75, mood: 6, demand: 1.15 },
  { id: 'standard', name: 'Standard', mult: 1, mood: 0, demand: 1 },
  { id: 'premium', name: 'Premium', mult: 1.35, mood: -8, demand: 0.85 }
];

export const DECOR = {
  bench: { name: 'Bench', icon: '🪑', cost: 90, comfort: 2, seat: true },
  bin: { name: 'Litter Bin', icon: '🗑️', cost: 40, comfort: 0, bin: true },
  plant: { name: 'Potted Plant', icon: '🪴', cost: 50, comfort: 2 },
  bigplant: { name: 'Palm Planter', icon: '🌴', cost: 120, comfort: 4 },
  flowerbox: { name: 'Flower Bed', icon: '🌷', cost: 80, comfort: 3 },
  lamp: { name: 'Lamp Post', icon: '💡', cost: 70, comfort: 2 },
  atm: { name: 'Cash Machine', icon: '🏧', cost: 400, comfort: 1, atm: true },
  vending: { name: 'Vending Machine', icon: '🥤', cost: 300, comfort: 0, vending: true },
  info: { name: 'Info Desk', icon: 'ℹ️', cost: 600, comfort: 3, info: true, research: 'info' },
  fountain: { name: 'Fountain', icon: '⛲', cost: 900, comfort: 9, research: 'fountain' },
  play: { name: 'Kids Play Area', icon: '🛝', cost: 1200, comfort: 8, research: 'play' },
  tree: { name: 'Shade Tree', icon: '🌳', cost: 60, comfort: 2, outdoor: true }
};

export const STAFF = {
  janitor: { name: 'Janitor', icon: '🧹', wage: 60, desc: 'Sweeps up litter and keeps the floor clean.' },
  security: { name: 'Security Guard', icon: '🛡️', wage: 75, desc: 'Patrols, stops shoplifters and calms trouble.', needs: 'security' },
  technician: { name: 'Technician', icon: '🔧', wage: 80, desc: 'Repairs broken shops, restrooms and fixtures.', needs: 'maintenance' }
};

// ---------------------------------------------------------------- research
export const RESEARCH = {
  bakery: { name: 'Bakery licence', cost: 20, tier: 1, kind: 'unit' },
  pharmacy: { name: 'Pharmacy licence', cost: 25, tier: 1, kind: 'unit' },
  toys: { name: 'Toy Shop licence', cost: 25, tier: 1, kind: 'unit' },
  shoes: { name: 'Shoe Store licence', cost: 30, tier: 1, kind: 'unit' },
  fasttills: { name: 'Fast Tills', cost: 30, tier: 1, kind: 'upgrade', desc: 'Shops serve 25% faster.' },
  bins: { name: 'Recycling Drive', cost: 20, tier: 1, kind: 'upgrade', desc: 'Shoppers drop 40% less litter.' },
  bookstore: { name: 'Bookstore licence', cost: 45, tier: 2, kind: 'unit', needs: ['toys'] },
  restaurant: { name: 'Restaurant licence', cost: 55, tier: 2, kind: 'unit', needs: ['bakery'] },
  info: { name: 'Info Desks', cost: 35, tier: 2, kind: 'decor', needs: ['fasttills'] },
  marketing: { name: 'Marketing Office', cost: 50, tier: 2, kind: 'upgrade', desc: '+20% visitors every day.', needs: ['fasttills'] },
  bus: { name: 'Bus Route', cost: 60, tier: 2, kind: 'upgrade', desc: 'A bus brings shoppers without needing parking.', needs: ['marketing'] },
  arcade: { name: 'Arcade licence', cost: 65, tier: 2, kind: 'unit', needs: ['toys'] },
  electronics: { name: 'Electronics licence', cost: 85, tier: 3, kind: 'unit', needs: ['shoes'] },
  supermarket: { name: 'Supermarket licence', cost: 95, tier: 3, kind: 'unit', needs: ['pharmacy'] },
  foodcourt: { name: 'Food Court licence', cost: 100, tier: 3, kind: 'unit', needs: ['restaurant'] },
  gym: { name: 'Fitness Club licence', cost: 80, tier: 3, kind: 'unit', needs: ['arcade'] },
  fountain: { name: 'Fountains', cost: 60, tier: 3, kind: 'decor', needs: ['info'] },
  cctv: { name: 'CCTV Network', cost: 70, tier: 3, kind: 'upgrade', desc: 'Shoplifting drops by half.', needs: ['bins'] },
  led: { name: 'LED Lighting', cost: 60, tier: 3, kind: 'upgrade', desc: 'Upkeep costs 30% less.', needs: ['bins'] },
  loyalty: { name: 'Loyalty Cards', cost: 90, tier: 3, kind: 'upgrade', desc: 'Happy shoppers spend 15% more.', needs: ['marketing'] },
  play: { name: 'Kids Play Areas', cost: 80, tier: 4, kind: 'decor', needs: ['fountain'] },
  cinema: { name: 'Cinema licence', cost: 160, tier: 4, kind: 'unit', needs: ['arcade', 'foodcourt'] },
  bowling: { name: 'Bowling licence', cost: 140, tier: 4, kind: 'unit', needs: ['gym'] },
  smartparking: { name: 'Smart Parking', cost: 110, tier: 4, kind: 'upgrade', desc: 'Parking earns $2 per car.', needs: ['bus'] }
};
export const researchAvailable = (id, done) => !done.includes(id) && (RESEARCH[id].needs || []).every((n) => done.includes(n));
export const unitUnlocked = (type, done) => !UNITS[type].research || done.includes(UNITS[type].research);
export const decorUnlocked = (type, done) => !DECOR[type].research || done.includes(DECOR[type].research);

// ---------------------------------------------------------------- difficulty
export const DIFFICULTY = {
  normal: { name: 'Normal', cash: 15000, costMul: 1, pickiness: 1, events: 1, desc: 'Comfortable start, forgiving shoppers.' },
  challenge: { name: 'Challenge', cash: 9000, costMul: 1.2, pickiness: 1.2, events: 1.3, desc: 'Tighter budget, pickier shoppers, more trouble.' },
  expert: { name: 'Expert', cash: 5000, costMul: 1.4, pickiness: 1.4, events: 1.6, desc: 'Every coin counts. For seasoned tycoons.' },
  sandbox: { name: 'Sandbox', cash: Infinity, costMul: 1, pickiness: 1, events: 0.6, desc: 'Unlimited money and every licence. Just build.' }
};

// ---------------------------------------------------------------- time
export const OPEN_HOUR = 9, CLOSE_HOUR = 21, LAST_ENTRY = 20;
export const SEC_PER_HOUR = 15; // real seconds per game hour at 1x
const CURVE = { 9: 0.6, 10: 0.8, 11: 1, 12: 1.35, 13: 1.3, 14: 1, 15: 0.9, 16: 1, 17: 1.2, 18: 1.3, 19: 1.05, 20: 0.5 };
export const hourCurve = (h) => CURVE[Math.floor(h)] || 0;

export function visitorsPerHour({ attraction, rating, marketing = 1, event = 1, curve = 1 }) {
  return (2 + attraction * 1.05) * (0.55 + rating * 0.22) * marketing * event * curve;
}
export const ratingStars = (score) => clamp(score / 20, 0, 5); // 0..100 -> 0..5

// overall mall score 0..100 (stars = score / 20)
export function mallScore({ avgSat = 60, cleanliness = 100, cats = 0, types = 0, comfort = 0, floorTiles = 0, services = 0 }) {
  const variety = clamp(cats * 10 + types * 5, 0, 100);
  const comfortS = clamp(floorTiles ? (comfort / floorTiles) * 400 : 0, 0, 100);
  return clamp(0.35 * avgSat + 0.15 * cleanliness + 0.3 * variety + 0.1 * comfortS + 0.1 * clamp(services, 0, 100), 0, 100);
}

// what a new shopper hopes to find: mostly shops you have, sometimes ones you don't (demand)
export const SHOP_TYPES = Object.keys(UNITS).filter((k) => !UNITS[k].service);
export function pickWishes(rng, existing, n) {
  const out = [];
  const have = SHOP_TYPES.filter((t) => existing.has(t));
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const pool = have.length && rng() < 0.7 ? have : SHOP_TYPES;
    const total = pool.reduce((a, t) => a + UNITS[t].attract + 2, 0);
    let r = rng() * total, pick = pool[0];
    for (const t of pool) { r -= UNITS[t].attract + 2; if (r <= 0) { pick = t; break; } }
    if (!out.includes(pick)) out.push(pick);
  }
  return out;
}

// ---------------------------------------------------------------- economy helpers
export const unitCapacity = (u, def, fastTills) => def.service ? def.cap : Math.max(0, u.staff) * def.cap * (1 + (u.level - 1) * 0.35) * (fastTills ? 1.25 : 1);
export const unitVisitMinutes = (def, u, fastTills) => def.time / (1 + (u.level - 1) * 0.15) / (fastTills ? 1.2 : 1);
export const leaseRent = (def, rating) => Math.round(def.rent * (0.6 + rating * 0.15));
export const upgradeCost = (def, level) => Math.round(def.cost * 0.6 * level);
export const stockCostRatio = 0.42;
export const stockMax = (def, u) => Math.round(def.cap * def.staff * 18 * (1 + (u.level - 1) * 0.4));

export function purchase(rng, def, priceMult, loyalty, mood) {
  const base = def.spend * priceMult * (0.6 + rng() * 0.8);
  return Math.round(base * (loyalty && mood > 70 ? 1.15 : 1) * 100) / 100;
}

export function loanInterest(balance) { return Math.round(balance * 0.012); }
export const LOANS = [2000, 5000, 10000, 25000];

// ---------------------------------------------------------------- the grid
export const idx = (x, z) => z * W + x;
export const inBounds = (x, z) => x >= 0 && z >= 0 && x < W && z < D;

export function emptyWorld() {
  const kind = new Uint8Array(W * D);
  for (let x = 0; x < W; x++) {
    for (const z of ROAD_Z) kind[idx(x, z)] = T.ROAD;
    kind[idx(x, SIDEWALK_Z)] = T.SIDEWALK;
  }
  return { kind: Array.from(kind), entrances: [], units: [], decor: [], nextId: 1 };
}

// rot 0: door faces +z (toward the road), 1: +x, 2: -z, 3: -x
export function footprint(type, rot) {
  const def = UNITS[type];
  return rot % 2 === 0 ? { w: def.w, d: def.d } : { w: def.d, d: def.w };
}
export function doorOf(u) {
  const { w, d } = footprint(u.type, u.rot);
  const cx = u.x + Math.floor((w - 1) / 2), cz = u.z + Math.floor((d - 1) / 2);
  switch (u.rot) {
    case 0: return { door: { x: cx, z: u.z + d - 1 }, front: { x: cx, z: u.z + d }, dir: [0, 1] };
    case 1: return { door: { x: u.x + w - 1, z: cz }, front: { x: u.x + w, z: cz }, dir: [1, 0] };
    case 2: return { door: { x: cx, z: u.z }, front: { x: cx, z: u.z - 1 }, dir: [0, -1] };
    default: return { door: { x: u.x, z: cz }, front: { x: u.x - 1, z: cz }, dir: [-1, 0] };
  }
}

// derived occupancy maps for fast queries
export function buildIndex(world) {
  const unitAt = new Int32Array(W * D).fill(-1);
  const decorAt = new Int32Array(W * D).fill(-1);
  const ent = new Uint8Array(W * D);
  for (const u of world.units) {
    const { w, d } = footprint(u.type, u.rot);
    for (let x = u.x; x < u.x + w; x++) for (let z = u.z; z < u.z + d; z++) unitAt[idx(x, z)] = u.id;
  }
  for (const dcr of world.decor) decorAt[idx(dcr.x, dcr.z)] = dcr.id;
  for (const e of world.entrances) ent[e] = 1;
  return { unitAt, decorAt, ent };
}

export function makeNav(world, blocked = new Set()) {
  const ix = buildIndex(world);
  const k = world.kind;
  const walk = new Uint8Array(W * D);
  for (let i = 0; i < W * D; i++) {
    const t = k[i];
    walk[i] = (t === T.SIDEWALK || t === T.PATH || t === T.PARKING || t === T.FLOOR) && ix.unitAt[i] < 0 && ix.decorAt[i] < 0 && !blocked.has(i) ? 1 : 0;
  }
  const indoor = (i) => k[i] === T.FLOOR;
  const passable = (a, b) => walk[a] && walk[b] && (indoor(a) === indoor(b) || (indoor(a) && ix.ent[a]) || (indoor(b) && ix.ent[b]));
  return { ...ix, walk, indoor, passable, kind: k };
}

export function neighbors(i) {
  const x = i % W, z = (i / W) | 0, out = [];
  if (x > 0) out.push(i - 1);
  if (x < W - 1) out.push(i + 1);
  if (z > 0) out.push(i - W);
  if (z < D - 1) out.push(i + W);
  return out;
}

// BFS distance field toward the goal tiles (goal tiles need not be walkable themselves)
export function flowField(nav, goals) {
  const dist = new Int16Array(W * D).fill(-1);
  const q = new Int32Array(W * D);
  let h = 0, t = 0;
  for (const g of goals) if (g >= 0 && dist[g] < 0) { dist[g] = 0; q[t++] = g; }
  while (h < t) {
    const c = q[h++];
    for (const n of neighbors(c)) {
      if (dist[n] >= 0 || !nav.walk[n]) continue;
      if (nav.walk[c] && !nav.passable(c, n)) continue;
      if (!nav.walk[c] && !nav.walk[n]) continue;
      dist[n] = dist[c] + 1;
      q[t++] = n;
    }
  }
  return dist;
}
// next tile downhill on a field, or -1
export function stepDown(nav, field, i, rng = Math.random) {
  let best = -1, bd = field[i] < 0 ? 1e9 : field[i];
  const ns = neighbors(i);
  for (let k = ns.length - 1; k > 0; k--) { const j = (rng() * (k + 1)) | 0; [ns[k], ns[j]] = [ns[j], ns[k]]; }
  for (const n of ns) {
    const d = field[n];
    if (d < 0 || d >= bd) continue;
    if (d > 0 && !nav.passable(i, n)) continue;
    if (d === 0 && nav.walk[n] && !nav.passable(i, n)) continue;
    best = n; bd = d;
  }
  return best;
}

export const spawnTiles = () => [idx(0, SIDEWALK_Z), idx(W - 1, SIDEWALK_Z)];

// ---------------------------------------------------------------- placement rules
export function canPaint(world, nav, tool, x, z) {
  if (!inBounds(x, z) || z > BUILD_MAX_Z) return { ok: false, reason: 'Outside the plot' };
  const i = idx(x, z);
  if (nav.unitAt[i] >= 0) return { ok: false, reason: 'A shop is here' };
  if (nav.decorAt[i] >= 0) return { ok: false, reason: 'Décor is here' };
  const kind = GROUND[tool].kind;
  if (world.kind[i] === kind) return { ok: false, reason: 'Already built', same: true };
  return { ok: true };
}

export function canPlaceUnit(world, nav, type, x, z, rot) {
  const { w, d } = footprint(type, rot);
  for (let tx = x; tx < x + w; tx++) for (let tz = z; tz < z + d; tz++) {
    if (!inBounds(tx, tz)) return { ok: false, reason: 'Outside the plot' };
    const i = idx(tx, tz);
    if (world.kind[i] !== T.FLOOR) return { ok: false, reason: 'Shops must sit on mall floor' };
    if (nav.unitAt[i] >= 0) return { ok: false, reason: 'Overlaps another shop' };
    if (nav.decorAt[i] >= 0) return { ok: false, reason: 'Clear the décor first' };
    if (nav.ent[i]) return { ok: false, reason: 'Don’t build over an entrance' };
  }
  const { front } = doorOf({ type, x, z, rot });
  if (!inBounds(front.x, front.z) || world.kind[idx(front.x, front.z)] !== T.FLOOR) return { ok: false, reason: 'The shop door must open onto the concourse' };
  const fi = idx(front.x, front.z);
  if (nav.unitAt[fi] >= 0 || nav.decorAt[fi] >= 0) return { ok: false, reason: 'The door is blocked' };
  return { ok: true };
}

export function canPlaceDecor(world, nav, type, x, z) {
  if (!inBounds(x, z) || z > BUILD_MAX_Z) return { ok: false, reason: 'Outside the plot' };
  const i = idx(x, z), def = DECOR[type];
  if (nav.unitAt[i] >= 0) return { ok: false, reason: 'A shop is here' };
  if (nav.decorAt[i] >= 0) return { ok: false, reason: 'Tile is taken' };
  if (nav.ent[i]) return { ok: false, reason: 'Keep entrances clear' };
  const k = world.kind[i];
  if (def.outdoor ? !(k === T.GRASS || k === T.PATH) : k !== T.FLOOR) return { ok: false, reason: def.outdoor ? 'Trees go on grass or paths' : 'Place it on the mall floor' };
  // never block a shop door
  for (const u of world.units) { const { front } = doorOf(u); if (front.x === x && front.z === z) return { ok: false, reason: 'That would block a shop door' }; }
  return { ok: true };
}

export function canPlaceEntrance(world, nav, x, z) {
  if (!inBounds(x, z)) return { ok: false, reason: 'Outside the plot' };
  const i = idx(x, z);
  if (world.kind[i] !== T.FLOOR) return { ok: false, reason: 'Entrances go on mall floor' };
  if (nav.ent[i]) return { ok: false, reason: 'Already an entrance' };
  if (nav.unitAt[i] >= 0 || nav.decorAt[i] >= 0) return { ok: false, reason: 'Tile is taken' };
  const outside = neighbors(i).some((n) => [T.PATH, T.PARKING, T.SIDEWALK].includes(world.kind[n]));
  if (!outside) return { ok: false, reason: 'Must face a path, car park or sidewalk' };
  return { ok: true };
}

// which units can shoppers actually reach from the street?
export function reachability(world, nav) {
  const field = flowField(nav, spawnTiles());
  const out = new Map();
  for (const u of world.units) {
    const { front } = doorOf(u);
    out.set(u.id, inBounds(front.x, front.z) && field[idx(front.x, front.z)] >= 0);
  }
  return out;
}

// parking spaces reachable by car: parking tiles connected to a tile touching the sidewalk
export function parkingNetwork(world) {
  const k = world.kind;
  const seen = new Uint8Array(W * D);
  const q = [];
  for (let x = 0; x < W; x++) { const i = idx(x, SIDEWALK_Z - 1); if (k[i] === T.PARKING) { seen[i] = 1; q.push(i); } }
  for (let h = 0; h < q.length; h++) for (const n of neighbors(q[h])) if (!seen[n] && k[n] === T.PARKING) { seen[n] = 1; q.push(n); }
  return q;
}

// ---------------------------------------------------------------- shoppers
export function satisfactionSample({ mood, pickiness = 1 }) { return clamp(Math.round(50 + (mood - 50) / pickiness), 0, 100); }

export const THOUGHTS = {
  noShop: (n) => `I wish there was a ${n} here.`,
  crowded: (n) => `${n} was far too crowded.`,
  closed: (n) => `${n} was closed.`,
  broken: (n) => `${n} is out of order.`,
  stock: (n) => `${n} was sold out!`,
  pricey: (n) => `${n} is a bit pricey.`,
  litter: 'There’s litter everywhere…',
  toilet: 'I couldn’t find a restroom!',
  parking: 'No parking spaces — I’m going elsewhere.',
  tired: 'Nowhere to sit down.',
  great: (n) => `Loved ${n}!`,
  pretty: 'This place is lovely.',
  walk: 'So much walking!',
  thief: 'Ha! Got away with it.'
};

// ---------------------------------------------------------------- events / problems
export const EVENTS = {
  power: { name: 'Power cut', icon: '⚡', weight: 2 },
  leak: { name: 'Water leak', icon: '💧', weight: 3 },
  thieves: { name: 'Shoplifting ring', icon: '🦹', weight: 2 },
  inspection: { name: 'Health inspection', icon: '📋', weight: 2, needsCat: 'food' },
  supplier: { name: 'Supplier price hike', icon: '📦', weight: 2 },
  strike: { name: 'Staff want a raise', icon: '✊', weight: 1, needsStaff: 3 },
  celebrity: { name: 'Celebrity visit', icon: '🌟', weight: 1, good: true },
  holiday: { name: 'Holiday rush', icon: '🎉', weight: 2, good: true },
  tenant: { name: 'Tenant request', icon: '📝', weight: 2, needsLease: true },
  lostchild: { name: 'Lost child', icon: '🧒', weight: 1 },
  viral: { name: 'Gone viral', icon: '📱', weight: 1, good: true },
  storm: { name: 'Storm warning', icon: '⛈️', weight: 1 }
};
export function pickEvent(rng, ctx) {
  const pool = Object.entries(EVENTS).filter(([, e]) => (!e.needsCat || ctx.cats.has(e.needsCat)) && (!e.needsStaff || ctx.staff >= e.needsStaff) && (!e.needsLease || ctx.leased > 0));
  const total = pool.reduce((a, [, e]) => a + e.weight, 0);
  let r = rng() * total;
  for (const [id, e] of pool) { r -= e.weight; if (r <= 0) return id; }
  return pool[0]?.[0];
}

// ---------------------------------------------------------------- goals (career milestones)
export const GOALS = [
  { id: 'shops2', text: 'Open a second shop', test: (s) => s.shopsOpen >= 2, reward: 1500 },
  { id: 'park40', text: 'Have 40 parking spaces', test: (s) => s.parking >= 40, reward: 1000 },
  { id: 'research1', text: 'Research a new shop licence', test: (s) => s.unitLicences >= 1, reward: 1200 },
  { id: 'visit100', text: 'Welcome 100 shoppers in one day', test: (s) => s.bestDayVisitors >= 100, reward: 2000 },
  { id: 'star2', text: 'Reach a ★★ mall rating', test: (s) => s.stars >= 2, reward: 2000 },
  { id: 'shops5', text: 'Have 5 shops open', test: (s) => s.shopsOpen >= 5, reward: 3000 },
  { id: 'clean', text: 'Finish a day with 85%+ cleanliness and 60+ shoppers', test: (s) => s.cleanDay, reward: 2000 },
  { id: 'profit2k', text: 'Make $2,000 profit in one day', test: (s) => s.bestProfit >= 2000, reward: 3500 },
  { id: 'fun', text: 'Open an arcade, gym, cinema or bowling alley', test: (s) => s.funOpen >= 1, reward: 4000 },
  { id: 'star3', text: 'Reach a ★★★ mall rating', test: (s) => s.stars >= 3, reward: 5000 },
  { id: 'visit300', text: 'Welcome 300 shoppers in one day', test: (s) => s.bestDayVisitors >= 300, reward: 6000 },
  { id: 'shops10', text: 'Have 10 shops open', test: (s) => s.shopsOpen >= 10, reward: 8000 },
  { id: 'anchor', text: 'Open a cinema or bowling alley', test: (s) => s.anchorOpen >= 1, reward: 10000 },
  { id: 'star4', text: 'Reach a ★★★★ mall rating', test: (s) => s.stars >= 4, reward: 12000 },
  { id: 'profit10k', text: 'Make $10,000 profit in one day', test: (s) => s.bestProfit >= 10000, reward: 15000 },
  { id: 'star5', text: 'Become a ★★★★★ Mall of the Year', test: (s) => s.stars >= 4.75, reward: 25000 }
];

// ---------------------------------------------------------------- starter mall
export function starterWorld() {
  const w = emptyWorld();
  const set = (x0, z0, x1, z1, kind) => { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) w.kind[idx(x, z)] = kind; };
  set(11, 12, 22, 20, T.FLOOR);
  set(16, 21, 17, 24, T.PATH);
  set(5, 21, 10, 24, T.PARKING);
  set(11, 22, 15, 22, T.PATH);
  w.entrances.push(idx(16, 20), idx(17, 20));
  const add = (type, x, z, rot, extra = {}) => { const u = { id: w.nextId++, type, x, z, rot, staff: UNITS[type].staff ? 2 : 0, price: 'standard', lease: false, level: 1, stock: 0, open: true, ...extra }; u.stock = stockMax(UNITS[type], u); w.units.push(u); return u; };
  add('cafe', 12, 12, 0);
  add('toilets', 21, 12, 0);
  const dec = (type, x, z) => w.decor.push({ id: w.nextId++, type, x, z });
  dec('bench', 15, 17); dec('bin', 14, 17); dec('plant', 11, 19); dec('plant', 22, 19); dec('bench', 19, 17); dec('lamp', 17, 16);
  dec('tree', 4, 19); dec('tree', 24, 22);
  return w;
}
