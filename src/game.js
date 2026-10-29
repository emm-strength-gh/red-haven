export const SIZE = 28;
export const SAVE_KEY = 'redhaven-save-v1';
export const BUILDINGS = {
  shelter: { name: 'Habitat', icon: '⌂', cost: { timber: 24, metal: 12 }, hp: 120, detail: 'Beds and protection for the crew.' },
  farm: { name: 'Farm', icon: '✳', cost: { timber: 14, metal: 8 }, hp: 85, detail: 'Produces food each day.' },
  solar: { name: 'Solar array', icon: '☼', cost: { metal: 25 }, hp: 75, detail: 'Generates power in clear daylight.' },
  wall: { name: 'Barrier', icon: '▥', cost: { timber: 8, metal: 4 }, hp: 100, detail: 'Slows and absorbs attacks.' },
  turret: { name: 'Sentry', icon: '✣', cost: { metal: 35, power: 8 }, hp: 85, detail: 'Automatically fires at nearby raiders.' },
  beacon: { name: 'Beacon', icon: '✦', cost: { metal: 90, timber: 35, power: 25 }, hp: 140, detail: 'Expedition objective. Build to call for rescue.' }
};

const NAMES = ['Ari', 'Mara', 'Sol', 'Kei'];
const ROLES = ['Builder', 'Farmer', 'Engineer', 'Guard'];
const rand = (seed) => {
  let n = seed >>> 0;
  return () => { n = (1664525 * n + 1013904223) >>> 0; return n / 4294967296; };
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const center = (x, z) => ({ x: x + .5, z: z + .5 });

export function newGame(mode = 'expedition', seed = Math.floor(Math.random() * 999999)) {
  const random = rand(seed);
  const tiles = [];
  const nodes = [];
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    const edge = Math.min(x, z, SIZE - 1 - x, SIZE - 1 - z);
    const roll = random();
    const shade = random();
    tiles.push({ x, z, shade, type: edge < 2 ? 'ridge' : roll < .10 ? 'soil' : roll < .14 ? 'stone' : 'plain' });
    if (edge > 2 && (Math.abs(x - 13) > 5 || Math.abs(z - 13) > 5)) {
      if (random() < .085) nodes.push({ id: `n${x}-${z}`, x, z, type: 'rock', amount: 18 + Math.floor(random() * 20), marked: false });
      else if (random() < .085) nodes.push({ id: `n${x}-${z}`, x, z, type: 'tree', amount: 14 + Math.floor(random() * 16), marked: false });
    }
  }
  const buildings = [
    { id: 'b1', type: 'shelter', x: 13, z: 13, hp: 120 },
    { id: 'b2', type: 'solar', x: 11, z: 12, hp: 75 },
    { id: 'b3', type: 'farm', x: 15, z: 13, hp: 85 }
  ];
  const colonists = NAMES.map((name, i) => ({ id: `c${i}`, name, role: ROLES[i], x: 12 + i % 2 * 2 + .5, z: 14 + Math.floor(i / 2) * 2 + .5, hp: 100, hunger: 0, task: 'Idle' }));
  return {
    version: 1, mode, seed, tiles, nodes, buildings, colonists, enemies: [], projectiles: [],
    resources: { timber: 78, metal: 72, food: 65, power: 12 },
    day: 1, clock: 0, weather: 'Clear skies', weatherUntil: 0, eventAt: 30,
    raidAt: 75, pendingEvent: null, eventLog: [{ id: 1, text: 'Touchdown. A new home begins on Mars.', kind: 'good', day: 1 }],
    nextId: 10, modeWon: false, gameOver: false, beaconCharge: 0
  };
}

export function loadGame() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    return saved?.version === 1 && Array.isArray(saved.tiles) && saved.tiles.length === SIZE * SIZE ? saved : null;
  } catch { return null; }
}
export function saveGame(game) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...game, projectiles: [] })); return true; }
  catch { return false; }
}
export function logEvent(game, text, kind = 'info') {
  game.eventLog.unshift({ id: game.nextId++, text, kind, day: game.day });
  game.eventLog = game.eventLog.slice(0, 28);
}
export function canBuild(game, type, x, z) {
  if (!BUILDINGS[type] || x < 2 || z < 2 || x >= SIZE - 2 || z >= SIZE - 2) return 'Outside the buildable area';
  if (game.buildings.some(b => b.x === x && b.z === z) || game.nodes.some(n => n.x === x && n.z === z)) return 'Tile is occupied';
  for (const [resource, amount] of Object.entries(BUILDINGS[type].cost)) if (game.resources[resource] < amount) return `Need ${amount} ${resource}`;
  return null;
}
export function placeBuilding(game, type, x, z) {
  const error = canBuild(game, type, x, z);
  if (error) return error;
  const spec = BUILDINGS[type];
  for (const [resource, amount] of Object.entries(spec.cost)) game.resources[resource] -= amount;
  game.buildings.push({ id: `b${game.nextId++}`, type, x, z, hp: spec.hp });
  logEvent(game, `${spec.name} constructed.`, 'good');
  return null;
}
export function markNode(game, x, z) {
  const node = game.nodes.find(n => n.x === x && n.z === z);
  if (!node) return false;
  node.marked = !node.marked;
  logEvent(game, `${node.type === 'rock' ? 'Ore' : 'Timber'} ${node.marked ? 'marked for gathering' : 'unmarked'}.`);
  return true;
}

export const EVENT_CHOICES = {
  rain: { icon: '☁', title: 'Heavy rain', text: 'A dark curtain of rain sweeps across the colony. The cisterns fill, but uncovered food stores may be soaked.', choices: [
    { label: 'Cover the food', detail: 'Spend 6 timber · gain 8 power' },
    { label: 'Let it pour', detail: 'Lose 12 food · gain 8 power' }
  ] },
  storm: { icon: '≋', title: 'Dust storm', text: 'A red wall is coming over the ridge. Seal the solar arrays, or work through the storm.', choices: [
    { label: 'Protect the arrays', detail: 'Spend 5 metal · short storm' },
    { label: 'Keep working', detail: 'Solar output reduced longer' }
  ] },
  heat: { icon: '☼', title: 'Heat wave', text: 'Hot winds roll across the farms. The crops need cover before the afternoon peak.', choices: [
    { label: 'Shade the crops', detail: 'Spend 8 timber · food protected' },
    { label: 'Risk the harvest', detail: 'Lose 12 food' }
  ] },
  cache: { icon: '✦', title: 'Survey cache', text: 'A weathered cargo pod lies open in the hills. The crew can carry back one useful load.', choices: [
    { label: 'Take construction metal', detail: 'Gain 16 metal' },
    { label: 'Take preserved rations', detail: 'Gain 20 food' }
  ] }
};

export function resolveEvent(game, choice) {
  const type = game.pendingEvent;
  if (!EVENT_CHOICES[type]) return;
  if (type === 'rain') {
    game.resources.power += 8;
    if (choice === 0 && game.resources.timber >= 6) { game.resources.timber -= 6; logEvent(game, 'Food secured before the rain. Cisterns filled.', 'good'); }
    else { game.resources.food = Math.max(0, game.resources.food - 12); logEvent(game, 'Rain soaked the stores. 12 food lost.', 'warning'); }
    game.weather = 'Heavy rain'; game.weatherUntil = game.clock + 18;
  } else if (type === 'storm') {
    if (choice === 0 && game.resources.metal >= 5) { game.resources.metal -= 5; game.weatherUntil = game.clock + 10; logEvent(game, 'The arrays are sealed against the storm.', 'good'); }
    else { game.weatherUntil = game.clock + 25; logEvent(game, 'Dust chokes the solar arrays.', 'warning'); }
    game.weather = 'Dust storm';
  } else if (type === 'heat') {
    if (choice === 0 && game.resources.timber >= 8) { game.resources.timber -= 8; logEvent(game, 'The crops were shaded in time.', 'good'); }
    else { game.resources.food = Math.max(0, game.resources.food - 12); logEvent(game, 'Heat spoiled 12 food.', 'warning'); }
    game.weather = 'Heat wave'; game.weatherUntil = game.clock + 18;
  } else if (type === 'cache') {
    if (choice === 0) { game.resources.metal += 16; logEvent(game, 'The crew recovered 16 metal.', 'good'); }
    else { game.resources.food += 20; logEvent(game, 'The crew recovered 20 food.', 'good'); }
  }
  game.pendingEvent = null;
}

function moveTowards(unit, target, speed, dt) {
  const dx = target.x - unit.x, dz = target.z - unit.z;
  const d = Math.hypot(dx, dz);
  if (d <= .12) return true;
  const step = Math.min(d, speed * dt);
  unit.x += dx / d * step;
  unit.z += dz / d * step;
  return d < .85;
}
function nearest(list, from) { return [...list].sort((a, b) => dist(a, from) - dist(b, from))[0]; }

export function stepGame(game, dt) {
  if (game.gameOver || game.modeWon || game.pendingEvent) return;
  dt = Math.min(dt, .12);
  game.clock += dt;
  const elapsed = game.clock;
  const newDay = 1 + Math.floor(elapsed / 48);
  if (newDay > game.day) {
    game.day = newDay;
    const farms = game.buildings.filter(b => b.type === 'farm' && b.hp > 0).length;
    const solar = game.buildings.filter(b => b.type === 'solar' && b.hp > 0).length;
    const storm = game.weather === 'Dust storm';
    game.resources.food += farms * (storm ? 7 : 13);
    game.resources.power += solar * (storm ? 2 : 11);
    game.resources.food -= game.colonists.length * 3;
    game.resources.power -= game.buildings.filter(b => b.type === 'turret').length * 3;
    game.resources.food = Math.max(0, game.resources.food);
    game.resources.power = Math.max(0, game.resources.power);
    if (game.resources.food === 0) {
      game.colonists.forEach(c => c.hp -= 12);
      logEvent(game, 'Food stores are empty. The crew is starving.', 'danger');
    }
    logEvent(game, `Day ${game.day}. Farms yielded ${farms * (storm ? 7 : 13)} food.`, 'info');
  }
  if (elapsed > game.weatherUntil && game.weather !== 'Clear skies') game.weather = 'Clear skies';
  if (elapsed > game.eventAt) {
    game.eventAt = elapsed + 35 + ((game.seed + game.day * 7) % 20);
    const options = ['rain', 'storm', 'heat', 'cache'];
    game.pendingEvent = options[(game.seed + Math.floor(elapsed) * 31) % options.length];
  }
  if (elapsed > game.raidAt) {
    game.raidAt = elapsed + Math.max(55, 100 - game.day * 2);
    const count = Math.min(2 + Math.floor(game.day / 2), 9);
    for (let i = 0; i < count; i++) game.enemies.push({ id: `e${game.nextId++}`, x: i * 1.2 + 2.5, z: 1.5, hp: 35 + game.day * 2, attackAt: 0 });
    logEvent(game, `${count} raiders are approaching from the north!`, 'danger');
  }
  for (const colonist of game.colonists) {
    const threat = nearest(game.enemies.filter(e => dist(e, colonist) < (colonist.role === 'Guard' ? 6 : 3)), colonist);
    if (threat && colonist.role === 'Guard') {
      colonist.task = 'Defending';
      if (dist(colonist, threat) > 3.5) moveTowards(colonist, threat, 1.5, dt);
      else if (!colonist.attackAt || elapsed > colonist.attackAt) {
        threat.hp -= 15;
        colonist.attackAt = elapsed + 1.1;
        game.projectiles.push({ x: colonist.x, z: colonist.z, tx: threat.x, tz: threat.z, ttl: .18 });
      }
    } else if (threat) {
      colonist.task = 'Taking cover';
      moveTowards(colonist, center(13, 13), 2, dt);
    } else {
      const target = nearest(game.nodes.filter(n => n.marked && n.amount > 0), colonist);
      if (target) {
        colonist.task = target.type === 'rock' ? 'Mining ore' : 'Gathering timber';
        if (moveTowards(colonist, center(target.x, target.z), 1.3, dt)) {
          colonist.workAt ??= elapsed + 1.7;
          if (elapsed > colonist.workAt) {
            const gained = Math.min(3, target.amount);
            game.resources[target.type === 'rock' ? 'metal' : 'timber'] += gained;
            target.amount -= gained;
            colonist.workAt = elapsed + 1.8;
            if (target.amount <= 0) { game.nodes = game.nodes.filter(n => n.id !== target.id); logEvent(game, `${target.type === 'rock' ? 'Ore' : 'Timber'} deposit exhausted.`); }
          }
        }
      } else {
        colonist.task = colonist.role === 'Farmer' ? 'Tending crops' : 'Patrolling';
        const offset = Number(colonist.id.slice(1));
        moveTowards(colonist, { x: 12 + offset % 3 * 1.7, z: 14 + Math.floor(offset / 2) * 1.3 }, .8, dt);
      }
    }
  }
  const activeTurrets = game.buildings.filter(b => b.type === 'turret' && b.hp > 0);
  for (const turret of activeTurrets) {
    const target = nearest(game.enemies.filter(e => dist(e, center(turret.x, turret.z)) < 7), center(turret.x, turret.z));
    if (target && game.resources.power > 0 && (!turret.attackAt || elapsed > turret.attackAt)) {
      target.hp -= 21;
      turret.attackAt = elapsed + .75;
      game.projectiles.push({ x: turret.x + .5, z: turret.z + .5, tx: target.x, tz: target.z, ttl: .18 });
    }
  }
  for (const enemy of game.enemies) {
    const objective = nearest(game.buildings.filter(b => b.hp > 0), enemy);
    if (!objective) break;
    const aim = center(objective.x, objective.z);
    if (moveTowards(enemy, aim, .75, dt) && elapsed > enemy.attackAt) {
      objective.hp -= 9;
      enemy.attackAt = elapsed + 1.4;
      const victim = game.colonists.find(c => dist(c, enemy) < 1.1);
      if (victim) victim.hp -= 7;
    }
  }
  const before = game.enemies.length;
  game.enemies = game.enemies.filter(e => e.hp > 0);
  if (before > 0 && !game.enemies.length) logEvent(game, 'Raid repelled. The colony stands.', 'good');
  game.projectiles.forEach(p => p.ttl -= dt);
  game.projectiles = game.projectiles.filter(p => p.ttl > 0);
  game.colonists = game.colonists.filter(c => c.hp > 0);
  game.buildings = game.buildings.filter(b => b.hp > 0);
  if (!game.colonists.length || !game.buildings.some(b => b.type === 'shelter')) {
    game.gameOver = true;
    logEvent(game, 'The settlement has fallen.', 'danger');
  }
  const beacon = game.buildings.find(b => b.type === 'beacon');
  if (beacon && game.resources.power >= 10 && game.mode === 'expedition') {
    game.beaconCharge += dt;
    if (game.beaconCharge >= 30) { game.modeWon = true; logEvent(game, 'Signal received! The expedition is saved.', 'good'); }
  }
}
