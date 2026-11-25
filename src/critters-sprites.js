// Kaboom Critters — flat 2D sprite renderer (canvas 2D, no WebGL).
// It draws the same match as the low-poly world: same simulation, same camera framing,
// so the HUD, tags, aiming and touch controls work unchanged.
import { THEMES } from './critters-levels.js';
import { PROJ } from './critters-sim.js';

const SP = 4;            // sprite texture pixels per world unit
const VIEW_W = 1050;     // world units across the screen at zoom 1 (matches the 3D camera)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',')})`; };
const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const INK = '#1b1235';

// ------------------------------------------------------------------ sprite cache
const cache = new Map();
/** A sprite is drawn once into its own canvas (y down, origin at ox/oy world units). */
function sprite(key, w, h, ox, oy, draw) {
  let s = cache.get(key);
  if (s) return s;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * SP); c.height = Math.ceil(h * SP);
  const g = c.getContext('2d');
  g.scale(SP, SP);
  g.translate(ox, oy);
  g.lineJoin = 'round'; g.lineCap = 'round';
  draw(g);
  s = { c, w, h, ox, oy };
  cache.set(key, s);
  return s;
}
function ellipse(g, x, y, rx, ry, fill, stroke, lw = 1.1) {
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function rrect(g, x, y, w, h, r, fill, stroke, lw = 1.1) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}

/** Critter facing right, radius 9, centre at the origin. */
function critterSprite(color, boss, state) {
  return sprite(`c|${color}|${boss}|${state}`, 30, 34, 15, 19, (g) => {
    const body = state === 'hurt' ? mix(color, '#ff2a2a', 0.55) : color;
    const dark = mix(color, '#000000', 0.45);
    ellipse(g, -3.8, 8.4, 3.6, 2.1, dark, INK);
    ellipse(g, 4.2, 8.4, 3.6, 2.1, dark, INK);
    if (!boss) {
      g.beginPath(); g.moveTo(-1, -8.4); g.quadraticCurveTo(1, -14.5, 4.6, -13.2); g.quadraticCurveTo(2.6, -10.6, 3.2, -8.2); g.closePath();
      g.fillStyle = mix(color, '#000000', 0.25); g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.stroke();
    }
    ellipse(g, 0, 0, 9.2, 9.6, body, INK, 1.3);
    ellipse(g, -2.6, -3.4, 4.2, 3.2, 'rgba(255,255,255,0.22)');
    ellipse(g, 1.2, 3.2, 5.4, 4.6, mix(color, '#ffffff', 0.5));
    ellipse(g, -1.3, 0.6, 1.6, 1, '#ff7aa8');
    ellipse(g, 7.2, 0.6, 1.4, 1, '#ff7aa8');
    for (const ex of [0.9, 5.6]) {
      if (state === 'blink') { g.beginPath(); g.moveTo(ex - 2.2, -3.2); g.lineTo(ex + 2.2, -3.2); g.strokeStyle = INK; g.lineWidth = 1.2; g.stroke(); continue; }
      ellipse(g, ex, -3.4, 2.4, 2.8, '#ffffff', INK, 0.7);
      ellipse(g, ex + 0.9, -3.2, 1.3, 1.6, INK);
      ellipse(g, ex + 1.3, -3.8, 0.45, 0.45, '#ffffff');
    }
    if (state === 'hurt') { g.beginPath(); g.ellipse(3.4, 3.4, 1.6, 1.8, 0, 0, Math.PI * 2); g.fillStyle = INK; g.fill(); }
    else { g.beginPath(); g.arc(3.4, 2.4, 2.2, 0.15 * Math.PI, 0.85 * Math.PI); g.strokeStyle = INK; g.lineWidth = 1; g.stroke(); }
    if (boss) {
      g.save(); g.translate(0, -9.6); g.rotate(-0.15);
      g.beginPath(); g.moveTo(-5.5, 1.5); g.lineTo(-5.5, -3); g.lineTo(-3, -0.5); g.lineTo(0, -4.5); g.lineTo(3, -0.5); g.lineTo(5.5, -3); g.lineTo(5.5, 1.5); g.closePath();
      g.fillStyle = '#ffd23a'; g.fill(); g.strokeStyle = '#7a5a00'; g.lineWidth = 0.9; g.stroke();
      ellipse(g, 0, -0.6, 1.1, 1.1, '#ff2a6a');
      g.restore();
    }
  });
}
const graveSprite = (color) => sprite(`g|${color}`, 16, 18, 8, 14, (g) => {
  g.beginPath(); g.moveTo(-5.5, 4); g.lineTo(-5.5, -6); g.arc(0, -6, 5.5, Math.PI, 0); g.lineTo(5.5, 4); g.closePath();
  g.fillStyle = '#b8bccb'; g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.stroke();
  g.fillStyle = '#7a7f90'; g.fillRect(-0.8, -8, 1.6, 7); g.fillRect(-3, -6, 6, 1.6);
  ellipse(g, 3.6, 2, 1.6, 1.6, color, INK, 0.6);
});
const mineSprite = () => sprite('mine', 16, 10, 8, 6, (g) => {
  for (let k = 0; k < 5; k++) { const a = Math.PI + (k / 4) * Math.PI; g.beginPath(); g.moveTo(Math.cos(a) * 4, Math.sin(a) * 4); g.lineTo(Math.cos(a) * 7, Math.sin(a) * 7); g.strokeStyle = '#5a5a6a'; g.lineWidth = 1.4; g.stroke(); }
  g.beginPath(); g.arc(0, 1, 5.5, Math.PI, 0); g.lineTo(5.5, 2.6); g.lineTo(-5.5, 2.6); g.closePath();
  g.fillStyle = '#3a3a48'; g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.stroke();
});
const barrelSprite = (t) => sprite(`b|${t.barrel}`, 20, 22, 10, 11, (g) => {
  rrect(g, -8, -9, 16, 18, 2.5, t.barrel, INK, 1.2);
  g.fillStyle = t.barrelBand; g.fillRect(-8, -4.5, 16, 2.4); g.fillRect(-8, 3, 16, 2.4);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(-5.5, -8, 2.2, 16);
  g.fillStyle = INK; g.font = 'bold 5px sans-serif'; g.textAlign = 'center'; g.fillText('!', 0, 2);
});
const crateSprite = (kind) => sprite(`k|${kind}`, 20, 20, 10, 10, (g) => {
  if (kind === 'health') {
    rrect(g, -8, -8, 16, 16, 2, '#ffffff', INK, 1.2);
    g.fillStyle = '#ff3a4f'; g.fillRect(-6, -2, 12, 4); g.fillRect(-2, -6, 4, 12);
  } else {
    rrect(g, -8, -8, 16, 16, 2, '#d39a4a', INK, 1.2);
    g.fillStyle = '#8a5a2a'; g.fillRect(-8, -6.5, 16, 2.6); g.fillRect(-8, 4, 16, 2.6);
    rrect(g, -2.6, -2.6, 5.2, 5.2, 1, '#ffd23a', '#7a5a00', 0.6);
  }
});
const chuteSprite = () => sprite('chute', 46, 40, 23, 38, (g) => {
  g.strokeStyle = '#ffffff'; g.lineWidth = 0.6;
  for (const x of [-16, -6, 6, 16]) { g.beginPath(); g.moveTo(x * 1.1, -25); g.lineTo(x * 0.3, -6); g.stroke(); }
  g.beginPath(); g.moveTo(-20, -25); g.quadraticCurveTo(-20, -37, 0, -37); g.quadraticCurveTo(20, -37, 20, -25);
  for (let k = 0; k < 4; k++) g.quadraticCurveTo(20 - k * 10 - 5, -21, 20 - (k + 1) * 10, -25);
  g.closePath();
  g.fillStyle = '#ff4fa3'; g.fill(); g.strokeStyle = INK; g.lineWidth = 1; g.stroke();
  g.beginPath(); g.moveTo(-6, -25); g.quadraticCurveTo(-6, -36.6, 0, -37); g.quadraticCurveTo(6, -36.6, 6, -25); g.closePath();
  g.fillStyle = '#ffd23a'; g.fill();
});
const planeSprite = () => sprite('plane', 80, 40, 40, 20, (g) => {
  g.beginPath(); g.moveTo(-30, -10); g.lineTo(-24, 0); g.lineTo(-34, 0); g.closePath(); g.fillStyle = '#ff4fa3'; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.4; g.stroke();
  rrect(g, -34, -4, 66, 10, 5, '#ffd23a', INK, 1.4);
  g.beginPath(); g.moveTo(30, -4); g.quadraticCurveTo(40, 1, 30, 6); g.closePath(); g.fillStyle = '#3aa0ff'; g.fill(); g.stroke();
  rrect(g, -6, 1, 18, 5, 2, '#ff4fa3', INK, 1.2);
  ellipse(g, 14, -1, 4, 3, '#bff3ff', INK, 1);
});

// ------------------------------------------------------------------ weapons and projectiles (vector, drawn live)
function drawHeld(g, kind) {
  const tube = (c) => { rrect(g, 1, -2.8, 17, 5.6, 2, c, INK, 1); g.fillStyle = '#2b2b2b'; g.fillRect(16, -3.2, 2.4, 6.4); g.fillRect(4, 2, 3, 4); };
  switch (kind) {
    case 'rocket': tube('#3fae4a'); break;
    case 'grapes': tube('#8a3fd6'); break;
    case 'melon': tube('#2f9d43'); break;
    case 'bee': tube('#ffd23a'); break;
    case 'grenade': ellipse(g, 10, 0, 3.6, 3.6, '#3fae4a', INK); break;
    case 'blaster': rrect(g, 2, -2.6, 13, 5.2, 1.5, '#ff8a1f', INK); ellipse(g, 7, -4, 2.6, 2.2, '#3aa0ff', INK, 0.8); g.fillStyle = '#ffd23a'; g.fillRect(15, -1, 5, 2); break;
    case 'bonk': g.fillStyle = '#a0703c'; g.fillRect(1, -1, 15, 2); rrect(g, 14, -5, 6, 10, 1.5, '#ff4fa3', INK); break;
    case 'airdrop': rrect(g, 7, -3.5, 4, 7, 1, '#2b2b40', INK, 0.8); ellipse(g, 9, -6, 1.3, 1.3, '#ff3a4f'); break;
    case 'dynamite': for (let k = 0; k < 3; k++) rrect(g, 6 + k * 3.4, -5, 3.2, 10, 1, '#ff3a4f', INK, 0.7); break;
    case 'mine': g.save(); g.translate(11, 1); g.scale(0.8, 0.8); g.drawImage(mineSprite().c, -8, -6, 16, 10); g.restore(); break;
    case 'teleport': g.fillStyle = '#ffffff'; g.fillRect(1, -0.8, 14, 1.6); star(g, 17, 0, 3.6, 1.6, '#6dfff0'); break;
  }
}
function star(g, x, y, R, r, fill, n = 5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = rot + (i * Math.PI) / n, d = i % 2 ? r : R; g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); }
  g.closePath(); g.fillStyle = fill; g.fill(); g.strokeStyle = INK; g.lineWidth = 0.7; g.stroke();
}
function drawProj(g, kind, t) {
  switch (kind) {
    case 'rocket': rrect(g, -6, -2.6, 12, 5.2, 2, '#e9edf5', INK); g.beginPath(); g.moveTo(6, -2.6); g.lineTo(11, 0); g.lineTo(6, 2.6); g.closePath(); g.fillStyle = '#ff3a4f'; g.fill(); g.stroke(); g.fillStyle = '#ff3a4f'; g.fillRect(-7, -4.5, 3.5, 9); break;
    case 'grenade': ellipse(g, 0, 0, 4, 4, '#3fae4a', INK); g.fillStyle = '#444'; g.fillRect(-1.4, -6, 2.8, 2.4); break;
    case 'grapes': for (let k = 0; k < 4; k++) ellipse(g, (k % 2) * 3 - 1.5, Math.floor(k / 2) * 3 - 1.5, 2.6, 2.6, '#8a3fd6', INK, 0.7); break;
    case 'grape': ellipse(g, 0, 0, 3, 3, '#9a4fe6', INK, 0.8); break;
    case 'melon': ellipse(g, 0, 0, 6.5, 6.5, '#2f9d43', INK); g.strokeStyle = '#a8e66a'; g.lineWidth = 1.2; for (const k of [-3, 0, 3]) { g.beginPath(); g.ellipse(k, 0, 1.2, 6, 0, 0, Math.PI * 2); g.stroke(); } break;
    case 'slice': g.beginPath(); g.moveTo(0, 2); g.arc(0, 2, 6, Math.PI * 1.15, Math.PI * 1.85); g.closePath(); g.fillStyle = '#ff4a5a'; g.fill(); g.strokeStyle = '#2f9d43'; g.lineWidth = 1.2; g.stroke(); break;
    case 'bee': {
      const flap = Math.sin(t * 60) * 0.6;
      ellipse(g, -1, -3.4 - flap, 2.4, 3.2, 'rgba(255,255,255,0.8)', INK, 0.5);
      ellipse(g, 0, 0, 5, 3.4, '#ffd23a', INK, 0.8);
      g.fillStyle = '#2b2b2b'; g.fillRect(-1.4, -3.2, 1.6, 6.4); g.fillRect(-4.2, -2.6, 1.4, 5.2);
      ellipse(g, 3.4, -0.6, 0.8, 0.8, INK);
      break;
    }
    case 'bomb': ellipse(g, 0, 0, 6, 4, '#2b2b40', INK); g.fillStyle = '#ff3a4f'; g.fillRect(-9, -3, 3.5, 6); break;
    case 'dynamite':
      for (let k = 0; k < 3; k++) rrect(g, (k - 1) * 3.6 - 1.8, -5, 3.6, 10, 1, '#ff3a4f', INK, 0.7);
      g.fillStyle = '#2b2b2b'; g.fillRect(-5.5, -1, 11, 2);
      g.strokeStyle = '#ddd'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, -5); g.lineTo(0.8, -8.5); g.stroke();
      ellipse(g, 0.8, -9.5, 1 + Math.random() * 1.2, 1 + Math.random() * 1.2, '#ffdd55');
      break;
    default: ellipse(g, 0, 0, 3, 3, '#ffffff', INK);
  }
}

// ------------------------------------------------------------------ renderer
export function createSprites(canvas) {
  const ctx = canvas.getContext('2d');
  let S = null, theme = null, themeKey = 'candy';
  let terr = null, tctx = null, img = null;
  let colTop, colTop2, colScorch, colSteel, colSoil;
  let parts = [], sinkers = [], planes = [], props = [];
  const W = { shake: 0, time: 0 };
  const view = { x: 0, y: 0, s: 1, w: 1, h: 1, jx: 0, jy: 0 };
  let cssW = 1, cssH = 1, dpr = 1;
  const anim = new Map();
  let lastInfo = null;

  // ---------------------------------------------------------------- terrain bitmap
  function paint(x0, y0, x1, y1) {
    const Wd = S.W, H = S.H, d = img.data, m = S.mask, p = S.paint;
    x0 = clamp(Math.floor(x0), 0, Wd - 1); x1 = clamp(Math.ceil(x1), 0, Wd - 1);
    y0 = clamp(Math.floor(y0), 0, H - 1); y1 = clamp(Math.ceil(y1), 0, H - 1);
    const solid = (x, y) => x >= 0 && x < Wd && y >= 0 && y < H && m[y * Wd + x] !== 0;
    const n = colSoil.length;
    for (let y = y0; y <= y1; y++) {
      const row = (H - 1 - y) * Wd;
      for (let x = x0; x <= x1; x++) {
        const i = y * Wd + x, o = (row + x) * 4;
        const mv = m[i];
        if (!mv) { d[o + 3] = 0; continue; }
        let c;
        const pv = p[i];
        if (mv === 2) c = colSteel;
        else if (pv === 1) c = colTop;
        else if (pv === 2) c = colTop2;
        else if (pv === 3) c = colScorch;
        else { const band = Math.floor((y + 26 * Math.sin(x * 0.011) + 14 * Math.sin(x * 0.037)) / 34); c = colSoil[((band % n) + n) % n]; }
        let k = 0.9 + 0.2 * hash(x >> 2, y >> 2);
        if (!solid(x, y + 2) || !solid(x, y - 2) || !solid(x + 2, y) || !solid(x - 2, y)) k *= 0.55;
        else if (!solid(x, y + 5)) k *= 1.15;
        else if (mv === 2 && ((x >> 3) + (y >> 3)) % 2) k *= 0.9;
        d[o] = Math.min(255, c[0] * k); d[o + 1] = Math.min(255, c[1] * k); d[o + 2] = Math.min(255, c[2] * k); d[o + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0, x0, H - 1 - y1, x1 - x0 + 1, y1 - y0 + 1);
  }

  function load(match, key) {
    S = match; themeKey = key; theme = THEMES[key];
    colTop = rgb(theme.top); colTop2 = rgb(theme.top2); colScorch = rgb(theme.scorch); colSteel = rgb(theme.steel); colSoil = theme.soil.map(rgb);
    terr = document.createElement('canvas');
    terr.width = S.W; terr.height = S.H;
    tctx = terr.getContext('2d');
    img = tctx.createImageData(S.W, S.H);
    paint(0, 0, S.W - 1, S.H - 1);
    parts = []; sinkers = []; planes = []; anim.clear();
    W.shake = 0;
    // little flowers, mushrooms and rocks on the grass (cosmetic, knocked off by blasts)
    props = [];
    let seed = S.seed * 7 + 3;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let x = 20 + rnd() * 20; x < S.W - 20; x += 14 + rnd() * 34) {
      const xi = Math.floor(x);
      let prev = 0;
      for (let y = S.H - 1; y > S.water + 4; y--) {
        const s = S.mask[y * S.W + xi];
        if (s === 1 && !prev && rnd() < 0.55) props.push({ x, y: y + 1, kind: Math.floor(rnd() * 4), c: theme.backdrop[Math.floor(rnd() * theme.backdrop.length)], s: 0.7 + rnd() * 0.6 });
        prev = s;
      }
    }
  }

  // ---------------------------------------------------------------- effects
  function spawn(o) { if (parts.length < 900) parts.push({ t: 0, vx: 0, vy: 0, grav: 0, drag: 0, s1: 0, spin: 0, a: 0, shape: 'dot', ...o }); }
  function boom(x, y, R, kind) {
    const pal = theme.boom;
    spawn({ x, y, life: 0.22 + R / 400, s0: R * 0.5, s1: R * 1.3, color: pal[0], shape: 'flash' });
    spawn({ x, y, life: 0.35, s0: R * 0.6, s1: R * 1.6, color: '#ffffff', shape: 'ring' });
    for (let i = 0; i < 10 + R / 3; i++) {
      const a = Math.random() * Math.PI * 2, sp = R * (2.5 + Math.random() * 4.5);
      spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + R, life: 0.35 + Math.random() * 0.35, s0: R * 0.1 + 2, grav: 300, drag: 2.5, color: pal[i % pal.length] });
    }
    const smokeCol = themeKey === 'lava' ? '#3b2b38' : themeKey === 'candy' ? '#ffe3f2' : themeKey === 'moon' ? '#8c86a8' : '#d8d8d8';
    for (let i = 0; i < 6 + R / 8; i++) spawn({ x: x + (Math.random() - 0.5) * R, y: y + (Math.random() - 0.3) * R * 0.6, vx: (Math.random() - 0.5) * 30, vy: 25 + Math.random() * 40, life: 1.1 + Math.random() * 0.8, s0: R * 0.3, s1: R * 0.6, drag: 0.6, color: smokeCol, shape: 'smoke' });
    if (kind !== 'shot') {
      const cols = [theme.top, theme.soil[0], theme.soil[1 % theme.soil.length], theme.scorch];
      for (let i = 0; i < 10 + R / 3; i++) {
        const a = Math.random() * Math.PI, sp = 120 + Math.random() * R * 6;
        spawn({ x: x + (Math.random() - 0.5) * R * 0.6, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 80, life: 1.2 + Math.random() * 0.8, s0: 2 + Math.random() * R * 0.09, s1: 0.5, grav: 620, spin: (Math.random() - 0.5) * 14, color: cols[i % cols.length], shape: 'chunk' });
      }
    }
    for (const p of props) {
      if (p.falling) continue;
      if (Math.hypot(p.x - x, p.y - y) < R * 1.15) { p.falling = true; p.vy = 240 + Math.random() * 200; p.vx = (p.x - x) * 4; p.rot = 0; p.spin = (Math.random() - 0.5) * 10; }
    }
    W.shake = Math.min(18, W.shake + R / 5);
  }
  function splash(x, y, big) {
    const n = big ? 26 : 12, c = mix(theme.water, '#ffffff', 0.4);
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = (big ? 220 : 150) * (0.5 + Math.random());
      spawn({ x, y: y + 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.9, s0: big ? 4 : 2.5, s1: 0.5, grav: 700, color: c });
    }
    spawn({ x, y, life: 0.3, s0: 4, s1: big ? 26 : 14, color: '#ffffff', shape: 'ring' });
  }
  function sparkle(x, y, cols, n = 16, sp = 120) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      spawn({ x, y, vx: Math.cos(a) * sp * Math.random(), vy: Math.sin(a) * sp * Math.random() + 40, life: 0.6 + Math.random() * 0.4, s0: 3, grav: 60, color: cols[i % cols.length], shape: 'star', spin: 6 });
    }
  }
  function puff(x, y, s = 4, col = '#e8e8e8') { spawn({ x, y, vx: (Math.random() - 0.5) * 12, vy: 12, life: 0.6 + Math.random() * 0.3, s0: s, s1: s * 1.8, color: col, shape: 'smoke' }); }
  const byId = (id) => S.bodies.find((b) => b.id === id);

  function onEvent(e) {
    if (!S) return;
    switch (e.type) {
      case 'boom': boom(e.x, e.y, e.r, e.kind); break;
      case 'splash': splash(e.x, e.y, e.big); break;
      case 'drown': { const b = byId(e.id); if (b && b.kind === 'critter') sinkers.push({ x: b.x, y: b.y, r: b.r, color: S.teams[b.team].color, boss: !!b.boss, facing: b.facing, t: 0 }); break; }
      case 'teleport': sparkle(e.x0, e.y0, ['#6dfff0', '#b45cff', '#ffffff'], 24, 160); sparkle(e.x1, e.y1, ['#6dfff0', '#b45cff', '#ffffff'], 24, 160); break;
      case 'pickup': sparkle(e.x, e.y, ['#ffd23a', '#ffffff', '#ff4fa3'], 22, 140); break;
      case 'bonk': if (e.hit) sparkle(e.x, e.y, ['#ffd23a', '#ffffff'], 14, 200); W.shake = Math.min(18, W.shake + (e.hit ? 6 : 1)); break;
      case 'shot': {
        const n = Math.max(2, Math.floor(Math.hypot(e.x1 - e.x0, e.y1 - e.y0) / 10));
        for (let i = 0; i < n; i++) { const t = i / n; spawn({ x: lerp(e.x0, e.x1, t), y: lerp(e.y0, e.y1, t), life: 0.25, s0: 2, color: i % 2 ? '#7ef0ff' : '#ffffff' }); }
        break;
      }
      case 'launch': { const c = byId(e.id); if (c) for (let i = 0; i < 4; i++) puff(c.x, c.y, 4); break; }
      case 'plane': planes.push({ x: e.x - e.dir * 900, dir: e.dir, t: 0 }); break;
      case 'pop': sparkle(e.x, e.y, ['#ffffff', '#ff3a4f'], 10, 100); break;
      case 'thud': if (e.v > 220) for (let i = 0; i < 3; i++) puff(e.x + (Math.random() - 0.5) * 10, e.y - 8, 3, mix(theme.soil[0], '#ffffff', 0.4)); break;
      case 'jump': { const a = anim.get(e.id); if (a) a.sq = 0.7; break; }
    }
  }

  // ---------------------------------------------------------------- per frame
  function setView(cam, w, h) {
    view.w = w; view.h = h;
    view.s = w / (VIEW_W / cam.zoom);
    view.x = cam.fx; view.y = cam.fy;
    view.jx = (Math.random() - 0.5) * W.shake; view.jy = (Math.random() - 0.5) * W.shake;
  }
  const sx = (x) => view.w / 2 + (x - view.x - view.jx) * view.s;
  const sy = (y) => view.h / 2 - (y - view.y - view.jy) * view.s;

  function update(dt, info, cam, w, h) {
    if (!S) return;
    W.time += dt;
    lastInfo = info;
    for (const r of S.dirty) {
      paint(r[0] - 3, r[1] - 3, r[2] + 3, r[3] + 3);
      for (const p of props) {
        if (p.falling || p.x < r[0] - 6 || p.x > r[2] + 6 || p.y < r[1] - 6 || p.y > r[3] + 6) continue;
        const xi = Math.floor(p.x), yi = Math.floor(p.y - 2);
        if (!(yi >= 0 && S.mask[yi * S.W + xi])) { p.falling = true; p.vy = 0; p.vx = 0; p.rot = 0; p.spin = (Math.random() - 0.5) * 3; }
      }
    }
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i];
      if (!p.falling) continue;
      p.vy -= 650 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
      if (p.y < S.water - 40) props.splice(i, 1);
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt / p.life;
      if (p.t >= 1) { parts.splice(i, 1); continue; }
      p.vy -= p.grav * dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.spin * dt;
      if (p.shape === 'chunk' && p.y < S.water) { p.vy *= 0.2; p.grav = 60; }
    }
    for (let i = sinkers.length - 1; i >= 0; i--) { const s = sinkers[i]; s.t += dt; s.y -= 18 * dt; if (s.t > 2) sinkers.splice(i, 1); }
    for (let i = planes.length - 1; i >= 0; i--) { const p = planes[i]; p.t += dt; p.x += p.dir * 900 * dt; if (p.t > 2.2) planes.splice(i, 1); }
    // trails
    for (const p of S.projs) {
      const a = anim.get('p' + p.id) || { trail: 0 };
      anim.set('p' + p.id, a);
      a.trail -= dt;
      if (a.trail > 0) continue;
      const ang = Math.atan2(p.vy, p.vx);
      if (p.kind === 'rocket' || p.kind === 'bomb') { a.trail = 0.025; puff(p.x - Math.cos(ang) * 8, p.y - Math.sin(ang) * 8, 3.2, '#f0f0f0'); }
      else if (p.kind === 'bee') { a.trail = 0.06; spawn({ x: p.x, y: p.y, life: 0.4, s0: 1.6, color: '#ffd23a' }); }
      else if (p.kind === 'dynamite') { a.trail = 0.04; spawn({ x: p.x, y: p.y + 10, vx: (Math.random() - 0.5) * 60, vy: 40 + Math.random() * 40, grav: 200, life: 0.35, s0: 1.4, color: Math.random() < 0.5 ? '#ffd23a' : '#ff7a1a' }); }
    }
    for (const b of S.bodies) {
      if (b.kind !== 'critter' || b.gone) continue;
      let a = anim.get(b.id);
      if (!a) { a = { sq: 1, wasRest: true, blinkT: Math.random() * 4, face: b.facing }; anim.set(b.id, a); }
      if (b.rest && !a.wasRest) a.sq = 0.72;
      a.wasRest = b.rest;
      a.sq += (1 - a.sq) * Math.min(1, dt * 10);
      a.blinkT -= dt;
      if (a.blinkT < 0) a.blinkT = 2 + Math.random() * 3.5;
      a.face += (b.facing - a.face) * Math.min(1, dt * 14);
    }
    W.shake = Math.max(0, W.shake - dt * 30);
    if (cam) setView(cam, w, h);
  }

  // ---------------------------------------------------------------- drawing
  function hills(layer, par, amp, base, col) {
    const s = view.s * par, top = view.h / 2 - (base - view.y) * s;
    ctx.beginPath();
    ctx.moveTo(0, view.h);
    for (let px = 0; px <= view.w + 24; px += 24) {
      const u = (px - view.w / 2) / s + view.x;
      const hgt = amp * (0.55 + 0.25 * Math.sin(u * 0.0021 + layer * 1.7) + 0.15 * Math.sin(u * 0.0057 + layer * 4.1) + 0.05 * Math.sin(u * 0.019 + layer));
      ctx.lineTo(px, top - hgt * s);
    }
    ctx.lineTo(view.w, view.h); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
  }
  function drawSprite(sp, x, y, scale, flip = 1, sqx = 1, sqy = 1, rot = 0, alpha = 1) {
    const k = view.s * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx(x), sy(y));
    if (rot) ctx.rotate(-rot);
    ctx.scale(flip * sqx, sqy);
    ctx.drawImage(sp.c, -sp.ox * k, -sp.oy * k, sp.w * k, sp.h * k);
    ctx.restore();
  }
  function water(front) {
    const wy = S.water, amp = themeKey === 'lava' ? 3 : 4.5;
    ctx.beginPath();
    ctx.moveTo(0, view.h);
    for (let px = 0; px <= view.w + 16; px += 16) {
      const u = (px - view.w / 2) / view.s + view.x;
      const yy = wy + (front ? 0 : 6) + amp * Math.sin(u * 0.012 + W.time * (front ? 1.6 : 1.1) + (front ? 0 : 2));
      ctx.lineTo(px, sy(yy));
    }
    ctx.lineTo(view.w, view.h); ctx.closePath();
    if (front) {
      const g = ctx.createLinearGradient(0, sy(wy), 0, sy(wy - 240));
      g.addColorStop(0, theme.water); g.addColorStop(1, theme.waterDeep);
      ctx.globalAlpha = theme.waterOpacity;
      ctx.fillStyle = g; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = mix(theme.water, '#ffffff', 0.55); ctx.lineWidth = Math.max(1.5, view.s * 1.4); ctx.stroke();
    } else { ctx.fillStyle = mix(theme.waterDeep, theme.water, 0.4); ctx.fill(); }
  }
  function drawProp(p) {
    const k = view.s * p.s;
    ctx.save();
    ctx.translate(sx(p.x), sy(p.y));
    if (p.rot) ctx.rotate(p.rot);
    ctx.scale(k, k);
    ctx.lineWidth = 0.8; ctx.strokeStyle = INK;
    if (p.kind === 0) { // flower
      ctx.strokeStyle = mix(theme.top2, '#000000', 0.3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -6); ctx.stroke();
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(a) * 1.8, -7 + Math.sin(a) * 1.8, 1.4, 0, Math.PI * 2); ctx.fillStyle = p.c; ctx.fill(); }
      ctx.beginPath(); ctx.arc(0, -7, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#ffd23a'; ctx.fill();
    } else if (p.kind === 1) { // mushroom
      ctx.fillStyle = '#fff1d6'; ctx.fillRect(-1, -4, 2, 4);
      ctx.beginPath(); ctx.arc(0, -4, 3.4, Math.PI, 0); ctx.closePath(); ctx.fillStyle = p.c; ctx.fill(); ctx.stroke();
    } else if (p.kind === 2) { // grass tuft
      ctx.strokeStyle = mix(theme.top, '#000000', 0.25); ctx.lineWidth = 1;
      for (const a of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(a * 3, -3, a * 5, -6); ctx.stroke(); }
    } else { // pebble
      ctx.beginPath(); ctx.ellipse(0, -1.4, 3, 2, 0, 0, Math.PI * 2); ctx.fillStyle = mix(p.c, '#888888', 0.5); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  function drawCritter(b, info) {
    const a = anim.get(b.id) || { sq: 1, blinkT: 1, face: b.facing };
    const t = W.time;
    const walking = S.time - b.walkT < 0.1;
    let sqy = 1 + Math.sin(t * 3 + b.id) * 0.025, bob = 0, rz = 0;
    if (walking) { bob = Math.abs(Math.sin(t * 15)) * 1.6; rz = Math.sin(t * 15) * 0.13; }
    if (!b.rest) sqy = 1 + clamp(b.vy / 1600, -0.14, 0.2);
    sqy *= a.sq;
    const sqx = (2 - sqy) ** 0.5;
    const scale = b.r / 9;
    const hurt = S.time - b.hurtT < 0.4 && Math.sin(t * 40) > -0.3;
    const state = hurt ? 'hurt' : a.blinkT < 0.12 ? 'blink' : 'ok';
    const sp = critterSprite(S.teams[b.team].color, !!b.boss, state);
    const flip = Math.abs(a.face) < 0.2 ? Math.sign(a.face || 1) * 0.2 : a.face;
    drawSprite(sp, b.x, b.y + bob - (1 - sqy) * 6 * scale, scale, flip, sqx, sqy, rz);
    if (b.id === S.active && info && info.showHeld) {
      const ang = Math.atan2(Math.sin(b.elev), b.facing * Math.cos(b.elev));
      ctx.save();
      ctx.translate(sx(b.x), sy(b.y - 1));
      ctx.rotate(-ang);
      ctx.scale(view.s * scale, view.s * scale * (b.facing > 0 ? 1 : -1));
      ctx.lineJoin = 'round';
      drawHeld(ctx, info.weapon);
      ctx.restore();
    }
  }
  function drawParticle(p) {
    const k = p.t, s = lerp(p.s0, p.s1, p.shape === 'smoke' ? Math.sqrt(k) : k) * view.s;
    if (s <= 0.2) return;
    const x = sx(p.x), y = sy(p.y);
    ctx.fillStyle = p.color;
    switch (p.shape) {
      case 'flash': ctx.globalAlpha = 0.9 * (1 - k); ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 0.9 * (1 - k); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, s * 0.55, 0, Math.PI * 2); ctx.fill(); break;
      case 'ring': ctx.globalAlpha = 0.8 * (1 - k); ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, view.s * 3 * (1 - k)); ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.stroke(); break;
      case 'smoke': ctx.globalAlpha = 0.75 * (1 - k); ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill(); break;
      case 'chunk': ctx.globalAlpha = 1; ctx.save(); ctx.translate(x, y); ctx.rotate(p.a); ctx.fillRect(-s, -s, s * 2, s * 2); ctx.restore(); break;
      case 'star': ctx.globalAlpha = 1 - k * k; ctx.save(); ctx.translate(x, y); ctx.rotate(p.a); ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, d = i % 2 ? s * 0.4 : s; ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d); } ctx.closePath(); ctx.fill(); ctx.restore(); break;
      default: ctx.globalAlpha = 1 - k * 0.6; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawAim(info) {
    const c = info.aim && S.bodies.find((b) => b.id === S.active && !b.gone);
    if (c) {
      const dx = c.facing * Math.cos(c.elev), dy = Math.sin(c.elev);
      const tc = mix(S.teams[c.team].color, '#ffffff', 0.35);
      if (info.powerAim) {
        for (let k = 0; k < 9; k++) {
          const f = (k + 1) / 9;
          if (f > info.power + 0.001) break;
          const d = c.r + 8 + f * 78;
          ctx.beginPath(); ctx.arc(sx(c.x + dx * d), sy(c.y + dy * d), (1.3 + f * 1.6) * view.s, 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${(0.15 - k * 0.017) * 360},100%,55%)`; ctx.fill();
          ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
        }
        if (info.guide && PROJ[info.weapon]) {
          const spd = 90 + info.power * 810;
          let x = c.x + dx * (c.r + 5), y = c.y + dy * (c.r + 5), vx = dx * spd, vy = dy * spd;
          const st = 0.028;
          for (let k = 0; k < 16; k++) {
            for (let s = 0; s < 2; s++) { vy -= S.grav * st / 2; x += vx * st / 2; y += vy * st / 2; }
            ctx.globalAlpha = 0.75 * (1 - k / 16);
            ctx.beginPath(); ctx.arc(sx(x), sy(y), 1.5 * view.s, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }
      const cx = sx(c.x + dx * (c.r + 46)), cy = sy(c.y + dy * (c.r + 46)), r = 6 * view.s;
      ctx.lineWidth = 1.1 * view.s + 1.5; ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.1 * view.s; ctx.strokeStyle = tc;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 1.2, cy + Math.sin(a) * r * 1.2); ctx.lineTo(cx + Math.cos(a) * r * 1.8, cy + Math.sin(a) * r * 1.8); ctx.stroke(); }
    }
    if (info.target) {
      const x = sx(info.target.x), y = sy(info.target.y), r = 12 * view.s;
      ctx.save(); ctx.translate(x, y); ctx.rotate(W.time);
      ctx.setLineDash([r * 0.5, r * 0.3]); ctx.lineWidth = 1.6 * view.s; ctx.strokeStyle = '#ffd23a';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      const ay = y - (26 + Math.sin(W.time * 6) * 4) * view.s;
      ctx.beginPath(); ctx.moveTo(x, ay + 7 * view.s); ctx.lineTo(x - 6 * view.s, ay - 7 * view.s); ctx.lineTo(x + 6 * view.s, ay - 7 * view.s); ctx.closePath();
      ctx.fillStyle = '#ffd23a'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
    }
    const ac = info.showArrow && S.bodies.find((b) => b.id === S.active && !b.gone);
    if (ac) {
      const x = sx(ac.x), y = sy(ac.y + ac.r + 30 + Math.sin(W.time * 6) * 4), k = view.s, wob = Math.cos(W.time * 3);
      ctx.beginPath(); ctx.moveTo(x, y + 6 * k); ctx.lineTo(x - 5 * k * wob, y - 6 * k); ctx.lineTo(x + 5 * k * wob, y - 6 * k); ctx.closePath();
      ctx.fillStyle = S.teams[ac.team].color; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!S) { ctx.fillStyle = '#2a1660'; ctx.fillRect(0, 0, cssW, cssH); return; }
    const info = lastInfo || {};
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, view.h);
    g.addColorStop(0, theme.sky[0]); g.addColorStop(0.6, theme.sky[1]); g.addColorStop(1, theme.sky[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, view.w, view.h);
    // sun or moon, stars, clouds
    const sunX = view.w * 0.78 - (view.x - S.W / 2) * view.s * 0.03, sunY = view.h * 0.2;
    if (themeKey === 'moon' || themeKey === 'lava') {
      for (let i = 0; i < 70; i++) {
        const u = ((hash(i, 7) * 3000 - view.x * 0.05 * view.s) % view.w + view.w) % view.w;
        ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(W.time * (0.5 + hash(i, 3)) + i));
        ctx.fillStyle = '#ffffff'; ctx.fillRect(u, hash(i, 9) * view.h * 0.6, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.arc(sunX, sunY, Math.min(view.w, view.h) * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = theme.sun; ctx.shadowColor = theme.sun; ctx.shadowBlur = 40; ctx.fill(); ctx.shadowBlur = 0;
    if (themeKey !== 'moon') {
      ctx.fillStyle = themeKey === 'lava' ? 'rgba(90,40,60,0.55)' : 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 7; i++) {
        const span = view.w + 400;
        const u = (((hash(i, 1) * span + W.time * (8 + i * 3) - view.x * 0.15 * view.s) % span) + span) % span - 200;
        const v = view.h * (0.08 + hash(i, 2) * 0.3), r = 20 + hash(i, 5) * 26;
        ctx.beginPath(); ctx.arc(u, v, r, 0, Math.PI * 2); ctx.arc(u + r, v + 6, r * 0.8, 0, Math.PI * 2); ctx.arc(u - r, v + 8, r * 0.7, 0, Math.PI * 2); ctx.fill();
      }
    }
    // parallax hills in the theme's backdrop colours
    const bd = theme.backdrop;
    hills(1, 0.35, 520, S.water, mix(bd[2], theme.sky[2], 0.55));
    hills(2, 0.55, 380, S.water, mix(bd[0], theme.sky[2], 0.35));
    hills(3, 0.75, 220, S.water, mix(bd[1], theme.sky[2], 0.15));
    water(false);
    // terrain bitmap (pixel-crisp)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terr, sx(0), sy(S.H), S.W * view.s, S.H * view.s);
    ctx.imageSmoothingEnabled = true;
    for (const p of props) drawProp(p);
    // bodies
    const t = W.time;
    for (const b of S.bodies) {
      if (b.gone) continue;
      if (b.kind === 'grave') drawSprite(graveSprite(S.teams[b.team].color), b.x, b.y - 1, 1);
      else if (b.kind === 'mine') {
        drawSprite(mineSprite(), b.x, b.y - 1, 1);
        const on = b.fuse != null ? Math.sin(t * 30) > 0 : b.armT > 0 ? Math.sin(t * 6) > 0.6 : Math.sin(t * 3) > 0.85;
        if (on) { ctx.beginPath(); ctx.arc(sx(b.x), sy(b.y + 1), 1.8 * view.s, 0, Math.PI * 2); ctx.fillStyle = b.armT > 0 && b.fuse == null ? '#ffd23a' : '#ff2a2a'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0; }
      } else if (b.kind === 'barrel') drawSprite(barrelSprite(theme), b.x, b.y, 1, 1, 1, 1, b.rest ? 0 : b.x * 0.05);
      else if (b.kind === 'crate') {
        const rot = b.chute ? Math.sin(t * 2 + b.id) * 0.12 : 0;
        if (b.chute) drawSprite(chuteSprite(), b.x, b.y, 1, 1, 1, 1, rot);
        drawSprite(crateSprite(b.crate), b.x, b.y, 1, 1, 1, 1, rot);
      }
    }
    for (const s of sinkers) drawSprite(critterSprite(s.color, s.boss, 'hurt'), s.x, s.y, s.r / 9, s.facing, 1, 1, s.t * 1.2, Math.max(0, 1 - s.t / 2));
    for (const b of S.bodies) if (b.kind === 'critter' && !b.gone) drawCritter(b, info);
    // projectiles
    for (const p of S.projs) {
      const a = anim.get('p' + p.id);
      const spinning = !(p.kind === 'rocket' || p.kind === 'bee' || p.kind === 'bomb');
      if (a && spinning) a.rot = (a.rot || 0) - p.vx * 0.0009;
      ctx.save();
      ctx.translate(sx(p.x), sy(p.y));
      ctx.rotate(-(spinning ? (a && a.rot) || 0 : Math.atan2(p.vy, p.vx)));
      ctx.scale(view.s, view.s);
      ctx.lineJoin = 'round'; ctx.lineWidth = 1;
      drawProj(ctx, p.kind, t);
      ctx.restore();
    }
    for (const p of parts) drawParticle(p);
    for (const p of planes) drawSprite(planeSprite(), p.x, S.H + 110, 1.4, p.dir);
    water(true);
    drawAim(info);
    // tidy up stale animation entries
    if (anim.size > 200) { const live = new Set(S.bodies.map((b) => b.id)); for (const p of S.projs) live.add('p' + p.id); for (const k of anim.keys()) if (!live.has(k)) anim.delete(k); }
  }

  return {
    get theme() { return theme; },
    get shake() { return W.shake; },
    get match() { return S; },
    load, update, render, onEvent,
    dispose() { S = null; terr = null; img = null; parts = []; },
    resize(w, h, ratio) {
      cssW = w; cssH = h; dpr = ratio;
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    },
    toScreen(x, y, z, w, h, out) { out.x = sx(x); out.y = sy(y); out.vis = true; return out; },
    pick(px, py) { return { x: (px - view.w / 2) / view.s + view.x, y: view.y - (py - view.h / 2) / view.s }; },
  };
}
