// Toy Cars Racing — track definitions.
// Coordinates are world units (x, z) on the ground plane; y is elevation.
// Features, obstacles and shortcuts are placed with `at: [x, z]` (snapped to
// the nearest point on the main track) so the layouts stay easy to edit.

// Build a closed list of control points from corners with rounded radii.
// Each corner is { p: [x, z], r, y }. r = 0 means "pass through this point".
export function rounded(corners, { scale = 1, y = 0, step = 40 } = {}) {
  const C = corners.map((c) => ({ x: c.p[0] * scale, z: c.p[1] * scale, r: (c.r || 0) * scale, y: c.y ?? y }));
  const out = [];
  const n = C.length;
  for (let i = 0; i < n; i++) {
    const a = C[i], b = C[(i + 1) % n];
    const pa = cornerPts(C, i), pb = cornerPts(C, (i + 1) % n);
    out.push(...pa.pts);
    // straight from the end of corner a to the start of corner b
    const s0 = pa.exit, s1 = pb.entry;
    const len = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
    const k = Math.floor(len / step);
    for (let j = 1; j <= k; j++) {
      const t = j / (k + 1);
      out.push([s0[0] + (s1[0] - s0[0]) * t, s0[1] + (s1[1] - s0[1]) * t, a.y + (b.y - a.y) * t]);
    }
  }
  return out;
}

function cornerPts(C, i) {
  const n = C.length, c = C[i];
  if (!c.r) return { pts: [[c.x, c.z, c.y]], entry: [c.x, c.z], exit: [c.x, c.z] };
  const p = C[(i - 1 + n) % n], q = C[(i + 1) % n];
  let ax = c.x - p.x, az = c.z - p.z; const al = Math.hypot(ax, az); ax /= al; az /= al;
  let bx = q.x - c.x, bz = q.z - c.z; const bl = Math.hypot(bx, bz); bx /= bl; bz /= bl;
  const entry = [c.x - ax * c.r, c.z - az * c.r], exit = [c.x + bx * c.r, c.z + bz * c.r];
  const mid = [0.25 * entry[0] + 0.5 * c.x + 0.25 * exit[0], 0.25 * entry[1] + 0.5 * c.z + 0.25 * exit[1]];
  const q1 = [0.5625 * entry[0] + 0.375 * c.x + 0.0625 * exit[0], 0.5625 * entry[1] + 0.375 * c.z + 0.0625 * exit[1]];
  const q3 = [0.0625 * entry[0] + 0.375 * c.x + 0.5625 * exit[0], 0.0625 * entry[1] + 0.375 * c.z + 0.5625 * exit[1]];
  return { pts: [[...entry, c.y], [...q1, c.y], [...mid, c.y], [...q3, c.y], [...exit, c.y]], entry, exit };
}

const S = 1.2; // global layout scale for the toy-track rooms

export const TRACKS = [
  // ------------------------------------------------------------------ 1
  {
    id: 'bedroom',
    name: 'Bedroom Blitz',
    theme: 'bedroom',
    blurb: 'Orange plastic track across a giant bedroom floor. Loop the loop, leap off the book ramp and sneak through the toy box.',
    tags: ['Loop', 'Jump', 'Shortcut'],
    difficulty: 1,
    laps: 3,
    width: 16,
    walls: true,
    points: rounded([
      { p: [0, 0], r: 0, y: 0.5 },
      { p: [150, 0], r: 35, y: 0.5 },
      { p: [150, -110], r: 30, y: 0.5 },
      { p: [60, -110], r: 22, y: 0.5 },
      { p: [60, -60], r: 20, y: 0.5 },
      { p: [-30, -60], r: 20, y: 0.5 },
      { p: [-30, -150], r: 26, y: 0.5 },
      { p: [-90, -150], r: 0, y: 6 },
      { p: [-150, -150], r: 34, y: 0.5 },
      { p: [-150, 0], r: 34, y: 0.5 }
    ], { scale: S }),
    shortcuts: [
      { name: 'Toy Box Tunnel', width: 9, surface: 'road', walls: true, tunnel: true,
        points: [[100 * S, -110 * S], [40 * S, -110 * S], [5 * S, -118 * S], [-25 * S, -136 * S], [-60 * S, -150 * S]] }
    ],
    features: [
      { type: 'boost', at: [30 * S, 0], len: 10, d: 0, w: 10 },
      { type: 'loop', at: [80 * S, 0], r: 10 },
      { type: 'boost', at: [-150 * S, -40 * S], len: 10, d: 0, w: 10 },
      { type: 'kicker', at: [-150 * S, -80 * S], len: 12, h: 2.4 },
      { type: 'boost', at: [100 * S, -110 * S], len: 8, d: 0, w: 12 }
    ],
    obstacles: [
      { type: 'block', at: [10 * S, -114 * S], d: 2.2, r: 1.2 },
      { type: 'block', at: [-12 * S, -125 * S], d: -2.2, r: 1.2 },
      { type: 'roller', at: [150 * S, -55 * S], d: 0, amp: 6, period: 3.2, r: 2.4 },
      { type: 'roller', at: [15 * S, -60 * S], d: 0, amp: 6, period: 2.8, r: 2.4 }
    ],
    decor: [
      { kind: 'toyblock', count: 40, near: [10, 70], scale: [1.5, 4], collide: true },
      { kind: 'crayon', count: 26, near: [6, 50], scale: [1, 1.6], collide: true },
      { kind: 'book', count: 14, near: [12, 80], scale: [1, 2.2], collide: true },
      { kind: 'marble', count: 30, near: [4, 60], scale: [0.6, 1.2], collide: false }
    ],
    landmarks: [
      { kind: 'bed', at: [-90 * S, -230 * S], rot: 0, scale: 1 },
      { kind: 'teddy', at: [80 * S, -190 * S], rot: 0.6, scale: 1 },
      { kind: 'bookbridge', at: [-90 * S, -150 * S], rot: 0, scale: 1 }
    ]
  },

  // ------------------------------------------------------------------ 2
  {
    id: 'city',
    name: 'Neon City',
    theme: 'city',
    blurb: 'Night streets with two-way traffic, roadworks and a tight back alley. Hit the car-carrier ramp for big air.',
    tags: ['Traffic', 'Alley', 'Ramp'],
    difficulty: 2,
    laps: 3,
    width: 18,
    walls: true,
    points: rounded([
      { p: [0, 0], r: 0 },
      { p: [140, 0], r: 24 },
      { p: [140, -160], r: 24 },
      { p: [50, -160], r: 20 },
      { p: [50, -70], r: 18 },
      { p: [-30, -70], r: 18 },
      { p: [-30, -160], r: 20 },
      { p: [-140, -160], r: 24 },
      { p: [-140, 0], r: 24 }
    ], { scale: 1.15 }),
    shortcuts: [
      { name: 'Back Alley', width: 9, surface: 'road', walls: true,
        points: [[82 * 1.15, -160 * 1.15], [10 * 1.15, -160 * 1.15], [-62 * 1.15, -160 * 1.15]] }
    ],
    features: [
      { type: 'boost', at: [40, 0], len: 10, d: -4.5, w: 7 },
      { type: 'boost', at: [40, 0], len: 10, d: 4.5, w: 7 },
      { type: 'kicker', at: [-161, -100], len: 11, h: 2.6, d: 4.5, w: 7 },
      { type: 'boost', at: [-161, -125], len: 8, d: 4.5, w: 7 }
    ],
    obstacles: [
      { type: 'traffic', count: 10, speed: 15, lanes: [[4.5, 1], [-4.5, -1]] },
      { type: 'cones', at: [161, -60], d: [-8, 0], n: 5, gap: 3 },
      { type: 'cones', at: [161, -100], d: [0, 8], n: 5, gap: 3 },
      { type: 'barrels', at: [20, -80.5], d: [-7, -1], n: 3, gap: 0 },
      { type: 'barrels', at: [0, -80.5], d: [1, 7], n: 3, gap: 0 },
      { type: 'crates', at: [25, -184], d: [-2.5, 2.5], n: 2, gap: 0 },
      { type: 'crates', at: [-20, -184], d: [-2.5, 2.5], n: 2, gap: 0 },
      { type: 'barrier', at: [-161, -40], d: 0, r: 1.1 }
    ],
    decor: [
      { kind: 'lamp', count: 50, near: [1.5, 3], scale: [1, 1], collide: false, align: true },
      { kind: 'building', count: 70, near: [9, 60], scale: [1, 2.2], collide: true },
      { kind: 'hydrant', count: 14, near: [1.5, 3], scale: [1, 1], collide: false }
    ],
    landmarks: [
      { kind: 'tower', at: [5, -120], rot: 0, scale: 1 },
      { kind: 'billboard', at: [0, 34], rot: 0, scale: 1 }
    ]
  },

  // ------------------------------------------------------------------ 3
  {
    id: 'canyon',
    name: 'Canyon Rush',
    theme: 'canyon',
    blurb: 'Sun-baked desert highway. Launch over the ravine, dodge rolling tumbleweeds and gamble on the dirt cut.',
    tags: ['Gap jump', 'Dirt cut', 'Hills'],
    difficulty: 2,
    laps: 3,
    width: 16,
    walls: false,
    embank: true,
    offroad: 'sand',
    points: [
      [0, 0, 0], [70, 0, 0], [140, -8, 1], [180, -35, 2], [200, -70, 3], [203, -110, 3],
      [200, -150, 3], [175, -190, 3], [115, -205, 2], [60, -180, 1], [30, -135, 0],
      [-20, -115, 0], [-70, -130, 1], [-110, -175, 3], [-170, -190, 4], [-225, -150, 3],
      [-238, -90, 2], [-210, -38, 1], [-140, -8, 0], [-70, 0, 0]
    ],
    shortcuts: [
      { name: 'Dirt Cut', width: 10, surface: 'dirt', walls: false,
        points: [[-82, -145], [-130, -110], [-180, -75], [-217, -50]] }
    ],
    features: [
      { type: 'boost', at: [190, -45], len: 10, d: 0, w: 12 },
      { type: 'kicker', at: [202, -86], len: 14, h: 3.2 },
      { type: 'gap', at: [203, -104], len: 18 },
      { type: 'hump', at: [60, -180], len: 18, h: 1.6 },
      { type: 'hump', at: [-170, -190], len: 18, h: 1.8 },
      { type: 'boost', at: [-20, -115], len: 10, d: 0, w: 12 }
    ],
    obstacles: [
      { type: 'roller', kind: 'tumbleweed', at: [100, -3], d: 0, amp: 7, period: 3.4, r: 1.6 },
      { type: 'roller', kind: 'tumbleweed', at: [-110, -175], d: 0, amp: 7, period: 2.9, r: 1.6 },
      { type: 'roller', kind: 'tumbleweed', at: [-230, -120], d: 0, amp: 7, period: 3.1, r: 1.6 },
      { type: 'rock', at: [-130, -110], d: -2, r: 1.5 },
      { type: 'rock', at: [-165, -85], d: 2.5, r: 1.5 }
    ],
    decor: [
      { kind: 'cactus', count: 70, near: [5, 70], scale: [0.8, 1.6], collide: true },
      { kind: 'mesa', count: 22, near: [40, 140], scale: [1, 2.4], collide: false },
      { kind: 'rock', count: 50, near: [4, 60], scale: [0.6, 1.8], collide: true }
    ],
    landmarks: [
      { kind: 'arch', at: [-140, -8], rot: 0, scale: 1 },
      { kind: 'gasstation', at: [10, 40], rot: 0, scale: 1 }
    ]
  },

  // ------------------------------------------------------------------ 4
  {
    id: 'snow',
    name: 'Frosty Summit',
    theme: 'snow',
    blurb: 'Climb an alpine pass, blast through the ice tunnel and skid down the black-ice summit. The frozen lake is quick — if you can hold it.',
    tags: ['Mountain', 'Ice', 'Lake cut'],
    difficulty: 3,
    laps: 3,
    width: 15,
    walls: true,
    embank: true,
    offroad: 'snow',
    points: [
      [0, 0, 0], [80, 0, 0], [150, -20, 2], [195, -70, 3], [190, -130, 3], [140, -170, 4],
      [80, -160, 8], [35, -190, 13], [-25, -215, 17], [-85, -195, 17], [-125, -150, 14],
      [-115, -100, 11], [-150, -55, 7], [-130, -5, 4], [-70, 15, 1]
    ],
    shortcuts: [
      { name: 'Frozen Lake', width: 13, surface: 'ice', walls: false,
        points: [[155, -26], [150, -70], [148, -115], [142, -165]] }
    ],
    features: [
      { type: 'boost', at: [40, 0], len: 10, d: 0, w: 12 },
      { type: 'tunnel', at: [194, -100], len: 70 },
      { type: 'ice', at: [-40, -212], len: 40 },
      { type: 'ice', at: [-118, -130], len: 35 },
      { type: 'hump', at: [-120, -110], len: 16, h: 1.4 },
      { type: 'hump', at: [-142, -40], len: 16, h: 1.4 },
      { type: 'boost', at: [-90, -195], len: 8, d: 0, w: 10 }
    ],
    obstacles: [
      { type: 'roller', kind: 'snowball', at: [-25, -215], d: 0, amp: 5, period: 3.0, r: 2.2 },
      { type: 'roller', kind: 'snowball', at: [60, -168], d: 0, amp: 5, period: 2.6, r: 2.2 },
      { type: 'block', kind: 'snowman', at: [148, -95], d: 3, r: 1.4 },
      { type: 'block', kind: 'snowman', at: [150, -55], d: -3, r: 1.4 }
    ],
    decor: [
      { kind: 'pine', count: 110, near: [5, 80], scale: [0.8, 1.8], collide: true },
      { kind: 'snowrock', count: 30, near: [5, 50], scale: [0.6, 1.6], collide: true },
      { kind: 'peak', count: 14, near: [70, 160], scale: [1.2, 2.6], collide: false }
    ],
    landmarks: [
      { kind: 'cabin', at: [20, 40], rot: 0.3, scale: 1 },
      { kind: 'lake', at: [150, -95], rot: 0, scale: 1 }
    ]
  },

  // ------------------------------------------------------------------ 5
  {
    id: 'stadium',
    name: 'Mega Loop Mayhem',
    theme: 'stadium',
    blurb: 'The ultimate toy stadium: a figure-8 with a sky-high crossover, two loops, a gap jump on the bridge and giant rolling balls.',
    tags: ['Figure 8', '2 Loops', 'Bridge jump'],
    difficulty: 3,
    laps: 3,
    width: 14,
    walls: true,
    points: [
      [100, -72, 0.5], [150, -74, 0.5], [200, -75, 0.5], [240, -42, 0.5], [242, 0, 0.5], [240, 40, 0.5],
      [200, 75, 2], [140, 75, 5], [80, 70, 8], [40, 40, 9.5], [0, 0, 10], [-40, -40, 9.5],
      [-80, -70, 8], [-140, -75, 6], [-200, -75, 2], [-240, -42, 0.5], [-242, 0, 0.5], [-240, 40, 0.5],
      [-200, 75, 0.5], [-140, 75, 0.5], [-80, 70, 0.5], [-40, 40, 0.5], [0, 0, 0.5], [40, -40, 0.5]
    ],
    shortcuts: [],
    features: [
      { type: 'boost', at: [130, -73], len: 10, d: 0, w: 10 },
      { type: 'loop', at: [175, -74], r: 10 },
      { type: 'kicker', at: [-100, -73], len: 12, h: 2.2 },
      { type: 'gap', at: [-117, -74], len: 14 },
      { type: 'boost', at: [-200, 75], len: 10, d: 0, w: 10 },
      { type: 'loop', at: [-140, 75], r: 9 },
      { type: 'boost', at: [240, 10], len: 10, d: 0, w: 10 }
    ],
    obstacles: [
      { type: 'roller', kind: 'ball', at: [-242, 0], d: 0, amp: 4.5, period: 2.6, r: 2.6 },
      { type: 'roller', kind: 'ball', at: [242, 0], d: 0, amp: 4.5, period: 3.0, r: 2.6 }
    ],
    decor: [
      { kind: 'toyblock', count: 30, near: [10, 60], scale: [1.5, 4], collide: true },
      { kind: 'cone', count: 30, near: [4, 30], scale: [1, 1], collide: false },
      { kind: 'flag', count: 24, near: [2, 4], scale: [1, 1], collide: false }
    ],
    landmarks: [
      { kind: 'stands', at: [0, 140], rot: 0, scale: 1 },
      { kind: 'stands', at: [0, -140], rot: Math.PI, scale: 1 },
      { kind: 'trophy', at: [0, 70], rot: 0, scale: 1 }
    ]
  },

  // ------------------------------------------------------------------ 6
  {
    id: 'backyard',
    name: 'Backyard Jungle',
    theme: 'backyard',
    blurb: 'Tiny cars, giant garden. Race between towering grass, splash past the garden hose and take the flower-bed jump.',
    tags: ['Giant garden', 'Jumps', 'Shortcut'],
    difficulty: 2,
    laps: 3,
    width: 15,
    walls: true,
    offroad: 'grass',
    points: [
      [0, 0, 0.5], [60, 5, 0.5], [120, -5, 0.5], [165, -40, 1.5], [170, -95, 3], [135, -135, 4],
      [80, -140, 4], [40, -115, 2], [0, -130, 1], [-30, -175, 3], [-90, -190, 4], [-145, -160, 3],
      [-160, -105, 1.5], [-120, -70, 0.5], [-130, -25, 0.5], [-70, 0, 0.5]
    ],
    shortcuts: [
      { name: 'Watering Can Run', width: 9, surface: 'road', walls: true,
        points: [[-35, -170], [-70, -135], [-110, -112], [-140, -100]] }
    ],
    features: [
      { type: 'boost', at: [30, 2], len: 10, d: 0, w: 10 },
      { type: 'kicker', at: [85, 3], len: 12, h: 2.6 },
      { type: 'hump', at: [170, -80], len: 16, h: 1.4 },
      { type: 'boost', at: [100, -140], len: 8, d: 0, w: 10 },
      { type: 'kicker', at: [-100, -188], len: 12, h: 2.4 },
      { type: 'gap', at: [-117, -183], len: 13 }
    ],
    obstacles: [
      { type: 'roller', kind: 'ladybug', at: [10, -128], d: 0, amp: 5, period: 2.7, r: 1.8 },
      { type: 'roller', kind: 'ladybug', at: [-125, -50], d: 0, amp: 5, period: 3.1, r: 1.8 },
      { type: 'block', kind: 'pebble', at: [-75, -133], d: 2, r: 1.3 },
      { type: 'block', kind: 'pebble', at: [-115, -110], d: -2, r: 1.3 }
    ],
    decor: [
      { kind: 'grass', count: 160, near: [3, 50], scale: [1, 2.4], collide: false },
      { kind: 'flower', count: 40, near: [6, 60], scale: [1, 2], collide: true },
      { kind: 'mushroom', count: 20, near: [5, 40], scale: [0.8, 1.6], collide: true },
      { kind: 'pebble', count: 40, near: [3, 50], scale: [0.6, 1.4], collide: false }
    ],
    landmarks: [
      { kind: 'hose', at: [70, -60], rot: 0, scale: 1 },
      { kind: 'gnome', at: [-60, 40], rot: 0.4, scale: 1 },
      { kind: 'flowerpot', at: [-90, -100], rot: 0, scale: 1 }
    ]
  }
];

export const CARS = [
  { id: 'flame', name: 'Flame Fury', style: 'racer', color: '#ff3b2f', accent: '#ffd400', top: 60, accel: 30, grip: 9.5, turn: 2.35, offroad: 0.55, nitroPower: 1 },
  { id: 'muscle', name: 'Big Mike', style: 'muscle', color: '#2f6bff', accent: '#ffffff', top: 64, accel: 27, grip: 8, turn: 2.1, offroad: 0.55, nitroPower: 1.1 },
  { id: 'buggy', name: 'Dune Bug', style: 'buggy', color: '#4fd34a', accent: '#ff8a00', top: 56, accel: 33, grip: 10.5, turn: 2.6, offroad: 0.82, nitroPower: 0.95 },
  { id: 'rocket', name: 'Rocket Wedge', style: 'rocket', color: '#b04dff', accent: '#00e5ff', top: 68, accel: 25, grip: 7.5, turn: 1.95, offroad: 0.5, nitroPower: 1.3 }
];

export const AI_NAMES = ['Zoomer', 'Turbo Tess', 'Skid Kid', 'Max Wheels', 'Dash', 'Nitro Nell', 'Gears', 'Blaze'];
export const AI_COLORS = ['#ffcf1f', '#ff5fa8', '#16d1c2', '#ff8a1f', '#e8e8f0', '#8bff3c', '#ff2d55', '#5ac8fa'];
