// Commute City — maps, road puzzles and signal levels (pure data + terrain generators).

function makeNoise(seed) {
  const hash = (x, y) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const sm = (t) => t * t * (3 - 2 * t);
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => n(x, y) * 0.6 + n(x * 2.1 + 17, y * 2.1 + 5) * 0.3 + n(x * 4.3 + 3, y * 4.3 + 11) * 0.1;
}

function grid(W, H, seed, fn) {
  const terrain = new Uint8Array(W * H), trees = new Uint8Array(W * H);
  const n = makeNoise(seed), nt = makeNoise(seed + 99);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = fn(x, y, n);
    terrain[y * W + x] = t;
    if (t === 0 && nt(x * 0.35, y * 0.35) > 0.6) trees[y * W + x] = 1;
  }
  return { terrain, trees };
}

export const CITY_MAPS = [
  {
    id: 'meadow', name: 'Meadowvale', W: 34, H: 22, seed: 101, money: 1500, start: { w: 16, h: 11 },
    blurb: 'Gentle green fields and two ponds. A good first city.',
    gen() {
      return grid(this.W, this.H, this.seed, (x, y) => {
        const p1 = Math.hypot((x - 7) / 2.6, (y - 5) / 1.8) < 1;
        const p2 = Math.hypot((x - 27) / 3, (y - 16) / 2) < 1;
        return p1 || p2 ? 1 : 0;
      });
    },
  },
  {
    id: 'river', name: 'Riverbend', W: 38, H: 24, seed: 202, money: 1700, start: { w: 16, h: 11 },
    blurb: 'A winding river splits the town. Bridges cost more; tunnels even more.',
    gen() {
      const H = this.H;
      return grid(this.W, H, this.seed, (x, y, n) => {
        const yc = H * 0.5 + Math.sin(x * 0.21 + 1.3) * 3.4 + (n(x * 0.2, 3.7) - 0.5) * 2.5;
        if (Math.abs(y - yc) < 1.05) return 1;
        if (Math.hypot((x - 31) / 2.6, (y - 4) / 1.8) < 1) return 1;
        return 0;
      });
    },
  },
  {
    id: 'hills', name: 'Highlands', W: 38, H: 24, seed: 303, money: 1900, start: { w: 16, h: 11 },
    blurb: 'A rocky ridge runs through the valley. Tunnel through or go around.',
    gen() {
      const W = this.W, H = this.H;
      return grid(W, H, this.seed, (x, y, n) => {
        const rx = W * 0.6 + Math.sin(y * 0.35) * 1.5;
        if (Math.abs(x - rx) < 1.2 + n(x * 0.3, y * 0.3) * 0.8) return 2;
        const far = Math.hypot(x - W / 2, (y - H / 2) * 1.4) > 9;
        if (far && n(x * 0.16, y * 0.16) > 0.64) return 2;
        if (Math.hypot((x - 6) / 2.4, (y - 18) / 1.6) < 1) return 1;
        return 0;
      });
    },
  },
  {
    id: 'bay', name: 'Harbour Bay', W: 44, H: 28, seed: 404, money: 2200, start: { w: 18, h: 12 },
    blurb: 'A big coastal city with a river mouth and hills. Room for trains.',
    gen() {
      const W = this.W, H = this.H;
      return grid(W, H, this.seed, (x, y, n) => {
        const coast = W - 6 - n(1.3, y * 0.18) * 4;
        if (x > coast) return 1;
        const ry = H * 0.32 + Math.sin(x * 0.18) * 2 + (n(x * 0.25, 9.1) - 0.5) * 1.6;
        if (x > 3 && Math.abs(y - ry) < 0.95) return 1;
        if (Math.hypot(x - 8, y - (H - 5)) < 4.5 && n(x * 0.3, y * 0.3) > 0.42) return 2;
        return 0;
      });
    },
  },
];

// ------------------------------------------------------------------ road puzzles
// map legend: . grass  ~ water  ^ mountain  t tree  a-f house (colour 0-5)
//             = road   M motorway   R railway (pre-built)
// dests: [x, y, lotX, lotY, colour] with the 2x2 footprint's top-left at x,y
// solution: steps used by the tests to prove each puzzle can be won within budget
export const PUZZLES = [
  {
    id: 'p1', name: 'First Commute', budget: 150, par: 80, goal: 15, rate: 0.18,
    tools: ['road', 'erase'],
    hint: 'Drag a road from the houses to the red diner car park.',
    map: [
      '............',
      '............',
      '..a.........',
      '..a.........',
      '............',
      '.......tt...',
      '............',
      '............',
    ],
    dests: [[8, 2, 8, 3, 0]],
    solution: [
      ['road', 'ground', [[2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3]]],
      ['road', 'ground', [[2, 2], [3, 2], [3, 3]]],
    ],
  },
  {
    id: 'p2', name: 'Crossroads', budget: 260, par: 200, goal: 30, rate: 0.22,
    tools: ['road', 'lights', 'erase'],
    hint: 'Two districts must cross. A junction forms where roads meet.',
    map: [
      '.............',
      '......bb.....',
      '.............',
      '.............',
      '.............',
      '.a...........',
      '.a...........',
      '.............',
      '....t........',
      '.............',
      '.............',
    ],
    dests: [[10, 5, 10, 5, 0], [6, 8, 6, 8, 1]],
    solution: [
      ['road', 'ground', [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5]]],
      ['road', 'ground', [[1, 6], [2, 6], [2, 5]]],
      ['road', 'ground', [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 6], [6, 7], [6, 8]]],
      ['road', 'ground', [[7, 1], [7, 2], [6, 2]]],
    ],
  },
  {
    id: 'p3', name: 'Over the River', budget: 230, par: 190, goal: 25, rate: 0.25,
    tools: ['road', 'tunnel', 'erase'],
    hint: 'Roads over water become bridges and cost three times as much.',
    map: [
      '......~~......',
      '..c...~~......',
      '..c...~~......',
      '......~~......',
      '..c...~~......',
      '......~~...t..',
      '......~~......',
      '......~~......',
      '......~~......',
    ],
    dests: [[10, 3, 10, 3, 2]],
    solution: [
      ['road', 'ground', [[2, 1], [3, 1], [3, 2], [3, 3]]],
      ['road', 'ground', [[2, 2], [3, 2]]],
      ['road', 'ground', [[2, 4], [3, 4], [3, 3]]],
      ['road', 'ground', [[3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3]]],
    ],
  },
  {
    id: 'p4', name: 'Mountain Pass', budget: 290, par: 250, goal: 25, rate: 0.25,
    tools: ['road', 'tunnel', 'erase'],
    hint: 'Pick the Tunnel layer and drag through the mountains.',
    map: [
      '......^^......',
      '.d....^^......',
      '.d....^^......',
      '......^^......',
      '.d....^^......',
      '......^^......',
      '......^^^.....',
      '......^^......',
      '......^^......',
    ],
    dests: [[10, 5, 10, 5, 3]],
    solution: [
      ['road', 'ground', [[1, 1], [2, 1], [2, 2], [2, 3]]],
      ['road', 'ground', [[1, 2], [2, 2]]],
      ['road', 'ground', [[1, 4], [2, 4], [2, 3]]],
      ['road', 'ground', [[2, 3], [3, 3], [4, 3], [5, 3]]],
      ['road', 'down', [[5, 3], [6, 3], [7, 3], [8, 3]]],
      ['road', 'ground', [[8, 3], [9, 3], [9, 4], [9, 5], [10, 5]]],
    ],
  },
  {
    id: 'p5', name: 'Over the Motorway', budget: 180, par: 150, goal: 30, rate: 0.3,
    tools: ['road', 'flyover', 'tunnel', 'erase'],
    hint: 'Roads cannot cross a motorway on the ground. Build a flyover over it.',
    map: [
      '.............',
      '...b..b......',
      '.............',
      '.............',
      '.............',
      'MMMMMMMMMMMMM',
      '.............',
      '.............',
      '.............',
      '.............',
      '.............',
    ],
    dests: [[6, 8, 6, 8, 1]],
    solution: [
      ['road', 'ground', [[3, 1], [3, 2], [4, 2], [5, 2], [6, 2]]],
      ['road', 'ground', [[6, 1], [6, 2], [6, 3], [6, 4]]],
      ['road', 'up', [[6, 4], [6, 5], [6, 6]]],
      ['road', 'ground', [[6, 6], [6, 7], [6, 8]]],
    ],
  },
  {
    id: 'p6', name: 'Rush Hour Roundabout', budget: 430, par: 370, goal: 45, rate: 0.26,
    tools: ['road', 'lights', 'round', 'erase'],
    hint: 'Heavy traffic meets in the middle. Try a roundabout or traffic lights.',
    map: [
      '.............',
      '.....b.b.....',
      '....b...b....',
      '.............',
      '..a..........',
      '.a...........',
      '.............',
      '.a...........',
      '..a..........',
      '.............',
      '.............',
      '.............',
      '.............',
    ],
    dests: [[10, 6, 10, 6, 0], [6, 10, 6, 10, 1]],
    solution: [
      ['road', 'ground', [[1, 5], [2, 5], [2, 6]]],
      ['road', 'ground', [[2, 4], [2, 5]]],
      ['road', 'ground', [[1, 7], [2, 7], [2, 6]]],
      ['road', 'ground', [[2, 8], [2, 7]]],
      ['road', 'ground', [[2, 6], [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6]]],
      ['road', 'ground', [[5, 1], [5, 2], [6, 2]]],
      ['road', 'ground', [[4, 2], [5, 2]]],
      ['road', 'ground', [[7, 1], [7, 2], [6, 2]]],
      ['road', 'ground', [[8, 2], [7, 2]]],
      ['road', 'ground', [[6, 2], [6, 3], [6, 4], [6, 5], [6, 6], [6, 7], [6, 8], [6, 9], [6, 10]]],
      ['round', 6, 6],
    ],
  },
  {
    id: 'p7', name: 'Tram Town', budget: 720, par: 670, goal: 20, rate: 0.2,
    tools: ['tram', 'stop', 'line', 'erase'],
    hint: 'No roads here. Lay tram track, put stops near the houses and the mall, then run a line.',
    map: [
      '......~~......',
      '.e.e..~~......',
      '......~~......',
      '.e.e..~~......',
      '......~~......',
      '......~~......',
      '......~~......',
      '......~~......',
    ],
    dests: [[10, 3, 10, 3, 4]],
    solution: [
      ['tram', 'ground', [[2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2]]],
      ['stop', 2, 2],
      ['stop', 10, 2],
      ['line', 'tram', [[2, 2], [10, 2]]],
    ],
  },
  {
    id: 'p8', name: 'Express Way', budget: 820, par: 740, goal: 40, rate: 0.3,
    tools: ['road', 'motorway', 'erase'],
    hint: 'The hospital is far away and the houses only have a few cars. A motorway is twice as fast.',
    map: [
      '........................',
      '.f......................',
      '.f......................',
      '.f......................',
      '.f......................',
      '........................',
      '..........tt............',
      '........................',
      '........................',
    ],
    dests: [[21, 3, 21, 3, 5]],
    solution: [
      ['road', 'ground', [[1, 1], [2, 1], [2, 2], [2, 3]]],
      ['road', 'ground', [[1, 2], [2, 2]]],
      ['road', 'ground', [[1, 3], [2, 3]]],
      ['road', 'ground', [[1, 4], [2, 4], [2, 3]]],
      ['road', 'ground', [[2, 3], [3, 3]]],
      ['motorway', 'ground', [[3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], [13, 3], [14, 3], [15, 3], [16, 3], [17, 3], [18, 3], [19, 3]]],
      ['road', 'ground', [[19, 3], [20, 3], [21, 3]]],
    ],
  },
  {
    id: 'p9', name: 'Rail Link', budget: 1850, par: 1740, goal: 20, rate: 0.2,
    tools: ['rail', 'station', 'line', 'erase'],
    hint: 'Stations serve houses up to three tiles away. Run a train across the lake.',
    map: [
      '..........~~~~~~..........',
      '..f.......~~~~~~..........',
      '..........~~~~~~..........',
      '...f......~~~~~~..........',
      '.f........~~~~~~..........',
      '..........~~~~~~..........',
      '..........~~~~~~..........',
      '..........~~~~~~..........',
      '..........~~~~~~..........',
      '..........~~~~~~..........',
    ],
    dests: [[22, 3, 22, 3, 5]],
    solution: [
      ['rail', 'ground', [[3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2], [15, 2], [16, 2], [17, 2], [18, 2], [19, 2], [20, 2], [21, 2], [22, 2]]],
      ['stop', 3, 2],
      ['stop', 22, 2],
      ['line', 'train', [[3, 2], [22, 2]]],
    ],
  },
  {
    id: 'p10', name: 'Grand Junction', budget: 490, par: 430, goal: 40, rate: 0.17,
    tools: ['road', 'flyover', 'tunnel', 'lights', 'round', 'erase'],
    hint: 'Both districts need to cross the river. One shared bridge can be enough.',
    map: [
      '................',
      '.a..............',
      '.a.aa...........',
      '................',
      '................',
      '................',
      '~~~~~~~~~~~~~~~~',
      '................',
      '................',
      '.b.bb...........',
      '.b..............',
      '................',
    ],
    dests: [[12, 9, 12, 9, 0], [12, 1, 12, 2, 1]],
    solution: [
      ['road', 'ground', [[1, 1], [2, 1], [2, 2]]],
      ['road', 'ground', [[1, 2], [2, 2], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3]]],
      ['road', 'ground', [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7], [7, 8]]],
      ['road', 'ground', [[7, 8], [8, 8], [9, 8], [10, 8], [11, 8], [12, 8], [12, 9]]],
      ['road', 'ground', [[1, 9], [2, 9]]],
      ['road', 'ground', [[1, 10], [2, 10], [2, 9], [2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8]]],
      ['road', 'ground', [[7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [12, 3], [12, 2]]],
      ['road', 'ground', [[3, 2], [3, 3]]],
      ['road', 'ground', [[4, 2], [4, 3]]],
      ['road', 'ground', [[3, 9], [3, 8]]],
      ['road', 'ground', [[4, 9], [4, 8]]],
    ],
  },
];

// ------------------------------------------------------------------ signal levels (tap the lights)
// roads/trams/rails: straight runs [x0, y0, x1, y1]; ends on the map border are entry/exit points.
// rate: seconds between cars, patience: seconds a driver waits before giving up.
export const SIGNAL_LEVELS = [
  {
    id: 's1', name: 'First Light', W: 13, H: 9, goal: 20, rate: 2.6, patience: 16,
    hint: 'Tap a light once to let one car through, twice for green. Tap green to make it red.',
    roads: [[0, 4, 12, 4], [6, 0, 6, 8]],
  },
  {
    id: 's2', name: 'T-Bone', W: 13, H: 9, goal: 28, rate: 2.0, patience: 15,
    hint: 'Turning cars cross the oncoming lane. Watch both sides.',
    roads: [[0, 3, 12, 3], [6, 3, 6, 8]],
  },
  {
    id: 's3', name: 'Twin Lights', W: 15, H: 9, goal: 34, rate: 1.8, patience: 15,
    hint: 'Two junctions on one street. Let a wave of green roll along it.',
    roads: [[0, 4, 14, 4], [4, 0, 4, 8], [10, 0, 10, 8]],
  },
  {
    id: 's4', name: 'Tram Crossing', W: 13, H: 9, goal: 30, rate: 2.1, patience: 15, tramEvery: 9,
    hint: 'Long trams need the junction clear for longer.',
    roads: [[0, 4, 12, 4], [6, 0, 6, 8]], trams: [[6, 0, 6, 8]],
  },
  {
    id: 's5', name: 'Level Crossing', W: 15, H: 9, goal: 30, rate: 2.1, patience: 15, trainEvery: 13,
    hint: 'Trains never stop. When the crossing flashes, keep cars off the tracks.',
    roads: [[0, 4, 14, 4], [5, 0, 5, 8]], rails: [[10, 0, 10, 8]],
  },
  {
    id: 's6', name: 'Downtown', W: 15, H: 11, goal: 44, rate: 1.5, patience: 16,
    hint: 'Four junctions. Keep traffic moving everywhere at once.',
    roads: [[0, 3, 14, 3], [0, 7, 14, 7], [4, 0, 4, 10], [10, 0, 10, 10]],
  },
  {
    id: 's7', name: 'Rush Hour', W: 17, H: 11, goal: 52, rate: 1.35, patience: 15, tramEvery: 11, trainEvery: 16,
    hint: 'Trams, trains and cars all at once.',
    roads: [[0, 5, 16, 5], [4, 0, 4, 10], [8, 0, 8, 10]], trams: [[0, 5, 16, 5]], rails: [[13, 0, 13, 10]],
  },
  {
    id: 's8', name: 'Gridlock Gauntlet', W: 17, H: 11, goal: 66, rate: 1.15, patience: 16, tramEvery: 10, trainEvery: 15,
    hint: 'The final test. Six junctions, trams and three level crossings.',
    roads: [[0, 2, 16, 2], [0, 5, 16, 5], [0, 8, 16, 8], [4, 0, 4, 10], [9, 0, 9, 10]], trams: [[9, 0, 9, 10]], rails: [[13, 0, 13, 10]],
  },
];
