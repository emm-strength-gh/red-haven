// Kaboom Critters — low-poly 3D renderer. The fight happens on the z = 0 plane; the terrain mask is
// turned into faceted slabs (marching squares, extruded along z) so the same world looks like a 2D
// side view from the front and a chunky diorama when the camera orbits around it.
import * as THREE from 'three';
import { THEMES } from './critters-levels.js';
import { PROJ } from './critters-sim.js';

const CELL = 8;           // terrain mesh resolution (world units)
const CHUNK = 16;         // cells per chunk side
const DEPTH = 170;        // slab thickness along z
const HALF = DEPTH / 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function h2(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ shared caches
const GC = new Map();
const geo = (k, f) => { let g = GC.get(k); if (!g) { g = f(); GC.set(k, g); } return g; };
const MC = new Map();
function mat(color, o = {}) {
  const k = color + '|' + (o.emissive || '') + '|' + (o.opacity ?? 1) + '|' + (o.basic ? 1 : 0);
  let m = MC.get(k);
  if (!m) {
    if (o.basic) m = new THREE.MeshBasicMaterial({ color, transparent: o.opacity != null, opacity: o.opacity ?? 1, toneMapped: false });
    else m = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: o.emissive || '#000000', emissiveIntensity: o.ei ?? 1, transparent: o.opacity != null, opacity: o.opacity ?? 1 });
    MC.set(k, m);
  }
  return m;
}
const lighten = (hex, t) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), t).getHexString();
const darken = (hex, t) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#000000'), t).getHexString();

function mesh(g, m, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  return o;
}
const G = {
  body: () => geo('body', () => new THREE.IcosahedronGeometry(9, 1)),
  ball: (r, d = 0) => geo('ico' + r + '_' + d, () => new THREE.IcosahedronGeometry(r, d)),
  sph: (r, w = 8, h = 6) => geo(`sph${r}_${w}_${h}`, () => new THREE.SphereGeometry(r, w, h)),
  cyl: (rt, rb, h, s = 7) => geo(`cyl${rt}_${rb}_${h}_${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s)),
  cone: (r, h, s = 6) => geo(`cone${r}_${h}_${s}`, () => new THREE.ConeGeometry(r, h, s)),
  box: (w, h, d) => geo(`box${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d)),
  tor: (r, t, rs = 6, ts = 14, arc = Math.PI * 2) => geo(`tor${r}_${t}_${rs}_${ts}_${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)),
  oct: (r) => geo('oct' + r, () => new THREE.OctahedronGeometry(r, 0)),
  dome: (r) => geo('dome' + r, () => new THREE.SphereGeometry(r, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2)),
};

// ------------------------------------------------------------------ marching squares tables
// corners 0 BL, 1 BR, 2 TR, 3 TL; edge points 4 bottom, 5 right, 6 top, 7 left. Polygons are CCW.
const POLY = [
  null, [[0, 4, 7]], [[4, 1, 5]], [[0, 1, 5, 7]], [[5, 2, 6]], null, [[4, 1, 2, 6]], [[0, 1, 2, 6, 7]],
  [[7, 6, 3]], [[0, 4, 6, 3]], null, [[0, 1, 5, 6, 3]], [[7, 5, 2, 3]], [[0, 4, 5, 2, 3]], [[4, 1, 2, 3, 7]], [[0, 1, 2, 3]],
];
const SADDLE = {
  5: { joined: [[0, 4, 5, 2, 6, 7]], split: [[0, 4, 7], [5, 2, 6]] },
  10: { joined: [[4, 1, 5, 6, 3, 7]], split: [[4, 1, 5], [7, 6, 3]] },
};

function createTerrain(S, theme, parent) {
  const W = S.W, H = S.H;
  const GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL), SW = GW + 1;
  const den = new Float32Array(SW * (GH + 1));
  const CX = Math.ceil(GW / CHUNK), CY = Math.ceil(GH / CHUNK);
  const meshes = new Array(CX * CY).fill(null);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const C = {
    top: new THREE.Color(theme.top), top2: new THREE.Color(theme.top2), scorch: new THREE.Color(theme.scorch),
    steel: new THREE.Color(theme.steel), soil: theme.soil.map((c) => new THREE.Color(c)),
  };
  const tmp = new THREE.Color();
  const sampleDen = (i, j) => {
    const x = i * CELL, y = j * CELL;
    let n = 0;
    for (let oy = -3; oy <= 3; oy += 3) for (let ox = -3; ox <= 3; ox += 3) {
      const xi = x + ox, yi = y + oy;
      if (xi >= 0 && xi < W && yi >= 0 && yi < H && S.mask[yi * W + xi]) n++;
    }
    return n / 9;
  };
  const CH = 4, CZ = 12; // chamfer inset and depth
  const D = (x, y) => {
    const gx = clamp(x / CELL, 0, GW - 0.001), gy = clamp(y / CELL, 0, GH - 0.001);
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    const a = den[j * SW + i], b = den[j * SW + i + 1], c = den[(j + 1) * SW + i], d = den[(j + 1) * SW + i + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  function colorAt(x, y, out, shade) {
    let xi = clamp(Math.floor(x), 0, W - 1), yi = clamp(Math.floor(y), 0, H - 1);
    let i = yi * W + xi;
    if (!S.mask[i]) {
      for (const d of [-4, 4, -8, 8]) { const yy = clamp(yi + d, 0, H - 1); if (S.mask[yy * W + xi]) { i = yy * W + xi; yi = yy; break; } }
    }
    const m = S.mask[i], p = S.paint[i];
    if (m === 2) out.copy(C.steel);
    else if (p === 1) out.copy(C.top);
    else if (p === 2) out.copy(C.top2);
    else if (p === 3) out.copy(C.scorch);
    else {
      const n = C.soil.length;
      const band = Math.floor((y + 26 * Math.sin(x * 0.011) + 14 * Math.sin(x * 0.037)) / 34);
      out.copy(C.soil[((band % n) + n) % n]);
    }
    out.multiplyScalar(shade * (0.9 + 0.2 * h2(xi >> 2, yi >> 2)));
  }

  function buildChunk(cx, cy) {
    const pos = [], col = [];
    const i0 = cx * CHUNK, j0 = cy * CHUNK, i1 = Math.min(GW, i0 + CHUNK), j1 = Math.min(GH, j0 + CHUNK);
    const px = new Float32Array(8), py = new Float32Array(8), pz = new Float32Array(8);
    const ix = new Float32Array(8), iy = new Float32Array(8);
    const tri = (ax, ay, az, bx, by, bz, qx, qy, qz, c) => {
      pos.push(ax, ay, az, bx, by, bz, qx, qy, qz);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const t = (a, b) => (Math.abs(b - a) < 1e-6 ? 0.5 : clamp((0.5 - a) / (b - a), 0.04, 0.96));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const d0 = den[j * SW + i], d1 = den[j * SW + i + 1], d2 = den[(j + 1) * SW + i + 1], d3 = den[(j + 1) * SW + i];
      const code = (d0 >= 0.5 ? 1 : 0) | (d1 >= 0.5 ? 2 : 0) | (d2 >= 0.5 ? 4 : 0) | (d3 >= 0.5 ? 8 : 0);
      if (!code) continue;
      const x0 = i * CELL, y0 = j * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      px[0] = x0; py[0] = y0; px[1] = x1; py[1] = y0; px[2] = x1; py[2] = y1; px[3] = x0; py[3] = y1;
      px[4] = x0 + t(d0, d1) * CELL; py[4] = y0;
      px[5] = x1; py[5] = y0 + t(d1, d2) * CELL;
      px[6] = x0 + t(d3, d2) * CELL; py[6] = y1;
      px[7] = x0; py[7] = y0 + t(d0, d3) * CELL;
      pz[0] = (h2(i, j) - 0.5) * 11; pz[1] = (h2(i + 1, j) - 0.5) * 11; pz[2] = (h2(i + 1, j + 1) - 0.5) * 11; pz[3] = (h2(i, j + 1) - 0.5) * 11;
      pz[4] = pz[5] = pz[6] = pz[7] = 0;
      // cap outlines are pulled in a little along the outward direction (taken from the density
      // field, so neighbouring cells agree) — that makes a chamfered, low-poly edge while the
      // middle of the slab, where the critters fight, keeps the exact outline.
      for (let k = 0; k < 4; k++) { ix[k] = px[k]; iy[k] = py[k]; }
      if (code !== 15) {
        for (let k = 4; k < 8; k++) {
          const x = px[k], y = py[k];
          let gx = D(x + 3, y) - D(x - 3, y), gy = D(x, y + 3) - D(x, y - 3);
          const l = Math.hypot(gx, gy);
          if (l < 1e-6) { gx = 0; gy = -1; } else { gx /= l; gy /= l; }
          ix[k] = x + gx * CH; iy[k] = y + gy * CH;
        }
      }
      let polys = POLY[code];
      if (!polys) { const s = SADDLE[code]; polys = (d0 + d1 + d2 + d3) / 4 >= 0.5 ? s.joined : s.split; }
      for (const poly of polys) {
        // caps: fan triangulation, front faces +z, back faces -z
        for (let k = 1; k + 1 < poly.length; k++) {
          const a = poly[0], b = poly[k], c = poly[k + 1];
          colorAt((px[a] + px[b] + px[c]) / 3, (py[a] + py[b] + py[c]) / 3, tmp, 1);
          tri(ix[a], iy[a], HALF + pz[a], ix[b], iy[b], HALF + pz[b], ix[c], iy[c], HALF + pz[c], tmp);
          tri(ix[a], iy[a], -HALF - pz[a], ix[c], iy[c], -HALF - pz[c], ix[b], iy[b], -HALF - pz[b], tmp);
        }
        // walls along the contour (consecutive edge points): chamfer, straight middle, chamfer
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k], b = poly[(k + 1) % poly.length];
          if (a < 4 || b < 4) continue;
          const ax = px[a], ay = py[a], bx = px[b], by = py[b];
          const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
          const nx = dy / l, ny = -dx / l;
          colorAt((ax + bx) / 2 - nx * 3, (ay + by) / 2 - ny * 3, tmp, ny > 0.35 ? 1 : 0.86);
          const rows = [
            [ix[a], iy[a], ix[b], iy[b], HALF], [ax, ay, bx, by, HALF - CZ],
            [ax, ay, bx, by, -HALF + CZ], [ix[a], iy[a], ix[b], iy[b], -HALF],
          ];
          for (let r = 0; r < 3; r++) {
            const F = rows[r], B = rows[r + 1];
            tri(F[0], F[1], F[4], B[2], B[3], B[4], F[2], F[3], F[4], tmp);
            tri(F[0], F[1], F[4], B[0], B[1], B[4], B[2], B[3], B[4], tmp);
          }
        }
      }
    }
    return { pos, col };
  }

  function rebuild(cx, cy) {
    const idx = cy * CX + cx;
    const { pos, col } = buildChunk(cx, cy);
    let m = meshes[idx];
    if (!pos.length) {
      if (m) { m.geometry.dispose(); parent.remove(m); meshes[idx] = null; }
      return;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    if (m) { m.geometry.dispose(); m.geometry = g; }
    else {
      m = new THREE.Mesh(g, material);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      meshes[idx] = m;
    }
  }
  function refresh(x0, y0, x1, y1) {
    const i0 = clamp(Math.floor((x0 - 4) / CELL), 0, GW), i1 = clamp(Math.ceil((x1 + 4) / CELL), 0, GW);
    const j0 = clamp(Math.floor((y0 - 4) / CELL), 0, GH), j1 = clamp(Math.ceil((y1 + 4) / CELL), 0, GH);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) den[j * SW + i] = sampleDen(i, j);
    const c0 = clamp(Math.floor((i0 - 1) / CHUNK), 0, CX - 1), c1 = clamp(Math.floor(i1 / CHUNK), 0, CX - 1);
    const r0 = clamp(Math.floor((j0 - 1) / CHUNK), 0, CY - 1), r1 = clamp(Math.floor(j1 / CHUNK), 0, CY - 1);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) rebuild(cx, cy);
  }
  refresh(0, 0, W, H);
  return {
    refresh,
    dispose() { for (const m of meshes) if (m) { m.geometry.dispose(); parent.remove(m); } material.dispose(); },
  };
}

// ------------------------------------------------------------------ props
function propBuilders(theme, key) {
  const P = theme.backdrop;
  const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];
  const B = {
    candy: [
      (r) => { // lollipop
        const g = new THREE.Group();
        g.add(mesh(G.cyl(1.2, 1.2, 44, 5), mat('#ffffff'), 0, 22, 0));
        const c = pick(['#ff4fa3', '#ffd23a', '#7ef0ff', '#a46bff', '#3fcf5a'], r);
        const d = mesh(G.cyl(15, 15, 4, 10), mat(c), 0, 52, 0); d.rotation.x = Math.PI / 2; g.add(d);
        g.add(mesh(G.tor(9, 2, 4, 12), mat('#ffffff'), 0, 52, 2.4));
        return { g, big: true };
      },
      (r) => { // gumdrop
        const g = new THREE.Group();
        const c = pick(['#ff4fa3', '#ffd23a', '#3fcf5a', '#ff8a1f', '#a46bff'], r);
        g.add(mesh(G.dome(9), mat(c), 0, -1, 0));
        g.add(mesh(G.ball(1.2), mat('#ffffff'), 3, 5, 5)); g.add(mesh(G.ball(1.2), mat('#ffffff'), -3, 4, 6));
        return { g, big: false };
      },
      (r) => { // candy cane
        const g = new THREE.Group();
        for (let k = 0; k < 6; k++) g.add(mesh(G.cyl(2.4, 2.4, 6, 6), mat(k % 2 ? '#ffffff' : '#ff3a4f'), 0, 3 + k * 6, 0));
        const hook = mesh(G.tor(6, 2.4, 5, 10, Math.PI), mat('#ff3a4f'), 6, 36, 0); g.add(hook);
        g.rotation.y = r * 6;
        return { g, big: true };
      },
      (r) => { // donut
        const g = new THREE.Group();
        const d = mesh(G.tor(8, 4, 6, 12), mat('#e2a462'), 0, 6, 0);
        const ic = mesh(G.tor(8, 4.3, 6, 12, Math.PI), mat(pick(['#ff7ab8', '#7a4a2a', '#9fe6ff'], r)), 0, 6, 0.5);
        g.add(d, ic);
        g.rotation.y = r * 3;
        return { g, big: false };
      },
      (r) => { // cupcake
        const g = new THREE.Group();
        g.add(mesh(G.cyl(9, 7, 10, 8), mat(pick(['#7ef0ff', '#ffd23a', '#a46bff'], r)), 0, 5, 0));
        g.add(mesh(G.ball(9, 0), mat('#ffb1d6'), 0, 14, 0));
        g.add(mesh(G.ball(2.5), mat('#ff2a4a'), 0, 23, 0));
        return { g, big: false };
      },
    ],
    jungle: [
      (r) => { // palm tree
        const g = new THREE.Group();
        let x = 0;
        for (let k = 0; k < 5; k++) { const s = mesh(G.cyl(2.2, 2.8, 12, 6), mat(k % 2 ? '#a0703c' : '#8a5a30'), x, 6 + k * 11, 0); s.rotation.z = -0.08 * k; g.add(s); x += 1.1 * k * 0.6; }
        for (let k = 0; k < 6; k++) {
          const leaf = mesh(G.cone(4.5, 30, 4), mat(k % 2 ? '#3fcf5a' : '#2f9d43'), x, 60, 0);
          const a = (k / 6) * Math.PI * 2;
          leaf.position.x += Math.cos(a) * 12; leaf.position.z += Math.sin(a) * 12; leaf.position.y -= 4;
          leaf.rotation.set(Math.sin(a) * 1.9, 0, -Math.cos(a) * 1.9);
          g.add(leaf);
        }
        g.add(mesh(G.ball(3), mat('#6b4a2a'), x + 2, 56, 3));
        return { g, big: true };
      },
      (r) => { // bush
        const g = new THREE.Group();
        g.add(mesh(G.ball(8, 0), mat('#3fcf5a'), 0, 4, 0), mesh(G.ball(6, 0), mat('#2f9d43'), 7, 3, 2), mesh(G.ball(5, 0), mat('#5fe86a'), -6, 3, -1));
        if (r > 0.5) g.add(mesh(G.ball(1.8), mat('#ff4fa3'), 2, 11, 5));
        return { g, big: false };
      },
      () => { // ruin stone
        const g = new THREE.Group();
        const s = mesh(G.box(16, 20, 12), mat('#9aa48a'), 0, 8, 0); s.rotation.z = 0.12; g.add(s);
        g.add(mesh(G.box(17, 3, 13), mat('#4fd65a'), 1, 18, 0));
        return { g, big: false };
      },
      (r) => { // flower
        const g = new THREE.Group();
        g.add(mesh(G.cyl(0.8, 0.8, 12, 4), mat('#2f9d43'), 0, 6, 0));
        g.add(mesh(G.ball(4, 0), mat(pick(['#ff4fa3', '#ffd23a', '#ff8a1f', '#a46bff'], r)), 0, 13, 0));
        g.add(mesh(G.ball(1.6), mat('#fff3a0'), 0, 13, 3.4));
        return { g, big: false };
      },
    ],
    frost: [
      () => { // pine
        const g = new THREE.Group();
        g.add(mesh(G.cyl(2.5, 3, 12, 6), mat('#7a5232'), 0, 6, 0));
        for (let k = 0; k < 3; k++) {
          g.add(mesh(G.cone(17 - k * 4, 20, 7), mat('#1f7a4a'), 0, 18 + k * 12, 0));
          g.add(mesh(G.cone(9 - k * 2.2, 8, 7), mat('#ffffff'), 0, 25 + k * 12, 0));
        }
        return { g, big: true };
      },
      (r) => { // ice crystal
        const g = new THREE.Group();
        const c = mesh(G.oct(7), mat('#9fe6ff', { emissive: '#2a6fb0', opacity: 0.85 }), 0, 9, 0); c.scale.set(0.8, 1.8, 0.8); c.rotation.z = (r - 0.5) * 0.6; g.add(c);
        const c2 = mesh(G.oct(5), mat('#d8f6ff', { emissive: '#2a6fb0', opacity: 0.85 }), 6, 6, 2); c2.scale.set(0.7, 1.5, 0.7); c2.rotation.z = -0.5; g.add(c2);
        return { g, big: false };
      },
      () => { // snowman
        const g = new THREE.Group();
        g.add(mesh(G.ball(9, 1), mat('#ffffff'), 0, 8, 0), mesh(G.ball(6.5, 1), mat('#ffffff'), 0, 21, 0));
        g.add(mesh(G.ball(1.2), mat('#222222'), -2.2, 23, 5.6), mesh(G.ball(1.2), mat('#222222'), 2.2, 23, 5.6));
        const n = mesh(G.cone(1.4, 7, 5), mat('#ff8a1f'), 0, 21, 8); n.rotation.x = Math.PI / 2; g.add(n);
        g.add(mesh(G.cyl(5, 5, 6, 8), mat('#3aa0ff'), 0, 28.5, 0));
        return { g, big: false };
      },
      () => { // snowy rock
        const g = new THREE.Group();
        g.add(mesh(G.ball(8, 0), mat('#8aa4c0'), 0, 3, 0), mesh(G.dome(7), mat('#ffffff'), 0, 6, 0));
        return { g, big: false };
      },
    ],
    lava: [
      () => { // dead tree
        const g = new THREE.Group();
        g.add(mesh(G.cyl(2, 3.2, 34, 5), mat('#2a1d24'), 0, 17, 0));
        const b1 = mesh(G.cyl(1, 1.6, 16, 4), mat('#2a1d24'), 6, 30, 0); b1.rotation.z = -0.9; g.add(b1);
        const b2 = mesh(G.cyl(0.9, 1.4, 13, 4), mat('#2a1d24'), -5, 26, 1); b2.rotation.z = 0.8; g.add(b2);
        return { g, big: true };
      },
      (r) => { // obsidian crystals
        const g = new THREE.Group();
        for (let k = 0; k < 3; k++) { const c = mesh(G.oct(5), mat(k === 1 ? '#5a2a7a' : '#22182a', { emissive: '#3a0a4a', ei: 0.4 }), (k - 1) * 5, 7, 0); c.scale.set(0.7, 1.7 + r, 0.7); c.rotation.z = (k - 1) * 0.35; g.add(c); }
        return { g, big: false };
      },
      () => { // glowing rock
        const g = new THREE.Group();
        g.add(mesh(G.ball(8, 0), mat('#3b2b38'), 0, 3, 0));
        g.add(mesh(G.ball(3.5, 0), mat('#ff7a1a', { emissive: '#ff5a1f', ei: 1.2 }), 2, 6, 5));
        return { g, big: false };
      },
      () => { // smoking vent
        const g = new THREE.Group();
        g.add(mesh(G.cyl(5, 11, 14, 7), mat('#46303d'), 0, 7, 0));
        g.add(mesh(G.cyl(4.6, 4.6, 1.5, 7), mat('#ff7a1a', { emissive: '#ff5a1f', ei: 1.5 }), 0, 14, 0));
        return { g, big: false, vent: true };
      },
    ],
    moon: [
      (r) => { // crystal cluster
        const g = new THREE.Group();
        const cs = ['#b45cff', '#6dfff0', '#ff6fd8'];
        for (let k = 0; k < 3; k++) { const c = mesh(G.oct(5), mat(cs[(k + Math.floor(r * 3)) % 3], { emissive: cs[(k + Math.floor(r * 3)) % 3], ei: 0.45 }), (k - 1) * 5, 7, (k % 2) * 3); c.scale.set(0.7, 1.9, 0.7); c.rotation.z = (k - 1) * 0.4; g.add(c); }
        return { g, big: false };
      },
      () => { // antenna
        const g = new THREE.Group();
        g.add(mesh(G.cyl(1.2, 1.6, 40, 5), mat('#c8d0e0'), 0, 20, 0));
        const dish = mesh(G.dome(10), mat('#e8ecf6'), 0, 40, 0); dish.rotation.x = Math.PI * 0.75; g.add(dish);
        g.add(mesh(G.ball(1.8), mat('#ff3a4f', { basic: true }), 0, 44, 4));
        return { g, big: true, blink: true };
      },
      () => { // little dome base
        const g = new THREE.Group();
        g.add(mesh(G.cyl(14, 15, 3, 10), mat('#9fb0c8'), 0, 1.5, 0));
        g.add(mesh(G.dome(13), mat('#9fe6ff', { opacity: 0.55, emissive: '#2a3a6a' }), 0, 3, 0));
        return { g, big: true };
      },
      () => { // moon rock
        const g = new THREE.Group();
        g.add(mesh(G.ball(7, 0), mat('#7a7396'), 0, 3, 0), mesh(G.ball(4, 0), mat('#a59fc0'), 7, 2, 2));
        return { g, big: false };
      },
    ],
  };
  void P;
  return B[key];
}

function makeBackdrop(S, theme, key, group, rnd) {
  const cx = S.W / 2;
  const cols = theme.backdrop;
  const ring = (n, rMin, rMax, build) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
      // keep the space between the 2D camera and the arena clear
      const front = -Math.cos(a) > 0.2;
      const r = front ? Math.max(rMin, 3600) + rnd() * 1500 : rMin + rnd() * (rMax - rMin);
      const x = cx + Math.sin(a) * (r + S.W * 0.35), z = -Math.cos(a) * r;
      const o = build(i);
      o.position.set(x, S.water - 6, z);
      group.add(o);
    }
  };
  const mountain = (i) => {
    const g = new THREE.Group();
    const h = 300 + rnd() * 700, w = 260 + rnd() * 420;
    const c = cols[i % cols.length];
    const m = mesh(G.cone(1, 1, 5 + (i % 3)), mat(c), 0, h / 2, 0, false); m.scale.set(w, h, w * (0.7 + rnd() * 0.5)); m.rotation.y = rnd() * 3; g.add(m);
    if (key === 'frost' || (key === 'candy' && i % 2 === 0)) {
      const cap = mesh(G.cone(1, 1, 5 + (i % 3)), mat(key === 'candy' ? '#ffffff' : '#ffffff'), 0, h * 0.82, 0, false);
      cap.scale.set(w * 0.36, h * 0.36, w * 0.36 * (0.7 + rnd() * 0.5)); cap.rotation.y = m.rotation.y; g.add(cap);
    }
    if (key === 'lava' && i % 2 === 0) {
      const glow = mesh(G.cyl(1, 1, 1, 6), mat('#ff7a1a', { emissive: '#ff5a1f', ei: 2 }), 0, h * 0.97, 0, false);
      glow.scale.set(w * 0.12, 18, w * 0.12); g.add(glow);
      g.userData.volcano = { x: 0, y: h, w };
    }
    if (key === 'jungle') {
      for (let k = 0; k < 4; k++) {
        const t = mesh(G.ball(1, 0), mat(k % 2 ? '#2f9d43' : '#4fd65a'), (rnd() - 0.5) * w * 0.8, h * (0.15 + rnd() * 0.3), (rnd() - 0.5) * w * 0.5, false);
        t.scale.setScalar(60 + rnd() * 70); g.add(t);
      }
    }
    return g;
  };
  ring(14, 1300, 3600, mountain);
  // clouds
  if (key !== 'moon') {
    const ccol = key === 'candy' ? ['#ffffff', '#ffd1ec', '#e2d1ff'] : key === 'lava' ? ['#5a3a4a', '#3b2b38', '#7a4a4a'] : ['#ffffff', '#f2f7ff'];
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const p = mesh(G.ball(1, 0), mat(ccol[k % ccol.length]), k * 70 - n * 35, rnd() * 30, rnd() * 40, false);
        p.scale.setScalar(55 + rnd() * 50); g.add(p);
      }
      const a = rnd() * Math.PI * 2, r = 1500 + rnd() * 3500;
      g.position.set(cx + Math.sin(a) * r * 1.3, 950 + rnd() * 700, Math.cos(a) > 0.3 ? -r : -Math.abs(Math.cos(a) * r) - 600);
      g.userData.drift = 6 + rnd() * 12;
      group.add(g);
    }
  } else {
    // stars and a ringed planet
    const n = 900, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, y = Math.abs(u) * 0.9 + 0.05, rr = Math.sqrt(1 - y * y);
      arr[i * 3] = cx + Math.cos(a) * rr * 9000; arr[i * 3 + 1] = y * 9000; arr[i * 3 + 2] = Math.sin(a) * rr * 9000;
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false }));
    group.add(pts);
    const planet = new THREE.Group();
    const ball = mesh(G.ball(1, 2), new THREE.MeshLambertMaterial({ color: '#ff9a5a', flatShading: true, fog: false }), 0, 0, 0, false); ball.scale.setScalar(700); planet.add(ball);
    const ringM = mesh(G.tor(1, 0.08, 3, 40), new THREE.MeshLambertMaterial({ color: '#ffe0a8', flatShading: true, fog: false }), 0, 0, 0, false); ringM.scale.setScalar(1150); ringM.rotation.x = 1.25; planet.add(ringM);
    planet.position.set(cx - 2600, 2600, -6500);
    group.add(planet);
  }
  // the sun
  const sunDisc = mesh(G.ball(1, 1), new THREE.MeshBasicMaterial({ color: theme.sun, fog: false, toneMapped: false }), cx + 2200, 3300, -7600, false);
  sunDisc.scale.setScalar(key === 'moon' ? 220 : 420);
  group.add(sunDisc);
}

// ------------------------------------------------------------------ critters & objects
function makeCritter(b, color) {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  pivot.scale.setScalar(b.r / 9);
  const bodyMat = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: '#000000' });
  const body = mesh(G.body(), bodyMat); body.scale.set(1, 1.05, 0.92); pivot.add(body);
  const belly = mesh(G.ball(6, 1), mat(lighten(color, 0.5)), 0, -2.4, 4.6, false); belly.scale.set(1, 1.05, 0.55); pivot.add(belly);
  const eyes = [], pupils = [];
  for (const s of [-1, 1]) {
    const e = mesh(G.sph(2.7, 8, 6), mat('#ffffff'), s * 3.1, 3.4, 6.6, false); pivot.add(e); eyes.push(e);
    const p = mesh(G.sph(1.45, 6, 5), mat('#1b1235'), 0, 0, 2.1, false); e.add(p); pupils.push(p);
    const shine = mesh(G.sph(0.5, 4, 3), mat('#ffffff', { basic: true }), 0.5, 0.6, 1.2, false); p.add(shine);
    const cheek = mesh(G.sph(1.3, 6, 4), mat('#ff7aa8'), s * 5.4, -0.2, 6.1, false); cheek.scale.set(1, 0.6, 0.5); pivot.add(cheek);
  }
  const feet = [];
  for (const s of [-1, 1]) { const f = mesh(G.sph(2.6, 6, 4), mat(darken(color, 0.45)), s * 3.6, -8.2, 1.5); f.scale.set(1, 0.6, 1.4); pivot.add(f); feet.push(f); }
  const tuft = mesh(G.cone(2.2, 6, 5), mat(darken(color, 0.25)), 1, 10.3, 0); tuft.rotation.z = -0.4; pivot.add(tuft);
  if (b.boss) {
    const crown = new THREE.Group();
    crown.add(mesh(G.cyl(5, 5.4, 2.6, 8), mat('#ffd23a', { emissive: '#7a5a00', ei: 0.4 }), 0, 0, 0));
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; crown.add(mesh(G.cone(1.2, 4, 4), mat('#ffd23a', { emissive: '#7a5a00', ei: 0.4 }), Math.cos(a) * 4.4, 3, Math.sin(a) * 4.4)); }
    crown.add(mesh(G.ball(1.2), mat('#ff2a6a'), 0, 1, 5.3));
    crown.position.set(0, 10, 0); crown.rotation.z = 0.15;
    pivot.add(crown);
    tuft.visible = false;
  }
  return { kind: 'critter', root, pivot, body, bodyMat, eyes, pupils, feet, blinkT: Math.random() * 4, facing: b.facing, sq: 1, wasRest: true };
}

function makeGrave(color) {
  const g = new THREE.Group();
  const stone = new THREE.Group();
  stone.add(mesh(G.box(10, 10, 5), mat('#b8bccb'), 0, -1, 0));
  const top = mesh(G.cyl(5, 5, 5, 8, 1), mat('#b8bccb'), 0, 4, 0); top.rotation.x = Math.PI / 2; stone.add(top);
  stone.add(mesh(G.box(6, 1.4, 1), mat('#7a7f90'), 0, 2, 2.6), mesh(G.box(1.4, 6, 1), mat('#7a7f90'), 0, 2, 2.6));
  stone.add(mesh(G.ball(1.8, 0), mat(color), 4, -5, 3));
  g.add(stone);
  return { kind: 'grave', root: g };
}
function makeMine() {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(5, 5.5, 3, 8), mat('#3a3a48'), 0, -1.5, 0));
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const s = mesh(G.cone(0.9, 3, 4), mat('#5a5a6a'), Math.cos(a) * 5, -1.5, Math.sin(a) * 5); s.rotation.set(Math.sin(a) * Math.PI / 2, 0, -Math.cos(a) * Math.PI / 2); g.add(s); }
  const light = new THREE.Mesh(G.sph(1.5, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false }));
  light.position.set(0, 1, 0);
  g.add(light);
  return { kind: 'mine', root: g, light };
}
function makeBarrel(theme) {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(8, 8, 18, 10), mat(theme.barrel), 0, 0, 0));
  g.add(mesh(G.cyl(8.3, 8.3, 3, 10), mat(theme.barrelBand), 0, 3, 0), mesh(G.cyl(8.3, 8.3, 3, 10), mat(theme.barrelBand), 0, -4, 0));
  g.add(mesh(G.cyl(6, 6, 1, 10), mat(darken(theme.barrel, 0.3)), 0, 9.2, 0));
  return { kind: 'barrel', root: g };
}
function makeCrate(kind) {
  const g = new THREE.Group();
  const box = new THREE.Group();
  if (kind === 'health') {
    box.add(mesh(G.box(16, 16, 16), mat('#ffffff'), 0, 0, 0));
    box.add(mesh(G.box(12, 4, 16.6), mat('#ff3a4f'), 0, 0, 0), mesh(G.box(4, 12, 16.6), mat('#ff3a4f'), 0, 0, 0));
  } else {
    box.add(mesh(G.box(16, 16, 16), mat('#d39a4a'), 0, 0, 0));
    box.add(mesh(G.box(16.6, 3, 16.6), mat('#8a5a2a'), 0, 5, 0), mesh(G.box(16.6, 3, 16.6), mat('#8a5a2a'), 0, -5, 0));
    box.add(mesh(G.box(5, 5, 16.8), mat('#ffd23a', { emissive: '#7a5a00', ei: 0.3 }), 0, 0, 0));
  }
  g.add(box);
  const chute = new THREE.Group();
  const canopy = mesh(G.dome(20), mat('#ff4fa3'), 0, 34, 0, false); canopy.scale.set(1, 0.55, 1); chute.add(canopy);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.78; const l = mesh(G.cyl(0.3, 0.3, 30, 3), mat('#ffffff'), Math.cos(a) * 9, 22, Math.sin(a) * 9, false); l.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); chute.add(l); }
  const stripe = mesh(G.dome(20.3), mat('#ffd23a'), 0, 34, 0, false); stripe.scale.set(0.45, 0.58, 1.01); chute.add(stripe);
  g.add(chute);
  return { kind: 'crate', root: g, chute, box };
}

function makeProjMesh(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'rocket': {
      const b = mesh(G.cyl(2.6, 2.6, 12, 7), mat('#e9edf5'), 0, 0, 0); b.rotation.z = Math.PI / 2; g.add(b);
      const n = mesh(G.cone(2.6, 6, 7), mat('#ff3a4f'), 9, 0, 0); n.rotation.z = -Math.PI / 2; g.add(n);
      for (const s of [-1, 1]) { const f = mesh(G.box(4, 0.8, 7), mat('#ff3a4f'), -5, 0, 0); f.rotation.x = s > 0 ? 0 : Math.PI / 2; g.add(f); }
      break;
    }
    case 'grenade':
      g.add(mesh(G.ball(4, 1), mat('#3fae4a'), 0, 0, 0), mesh(G.cyl(1.4, 1.4, 3, 5), mat('#444444'), 0, 4, 0));
      break;
    case 'grapes':
      for (let k = 0; k < 4; k++) g.add(mesh(G.ball(2.6, 1), mat('#8a3fd6'), (k % 2) * 3 - 1.5, Math.floor(k / 2) * 3 - 1.5, (k % 3) - 1));
      g.add(mesh(G.cone(1.6, 4, 4), mat('#3fcf5a'), 0, 4, 0));
      break;
    case 'grape':
      g.add(mesh(G.ball(3, 1), mat('#9a4fe6'), 0, 0, 0));
      break;
    case 'melon':
      g.add(mesh(G.ball(6.5, 1), mat('#2f9d43'), 0, 0, 0));
      g.add(mesh(G.tor(6.5, 0.9, 4, 14), mat('#a8e66a'), 0, 0, 0));
      { const t = mesh(G.tor(6.5, 0.9, 4, 14), mat('#a8e66a'), 0, 0, 0); t.rotation.y = Math.PI / 2; g.add(t); }
      break;
    case 'slice': {
      const s = mesh(geo('slice', () => new THREE.CylinderGeometry(5, 5, 2.5, 6, 1, false, 0, Math.PI * 0.6)), mat('#ff4a5a'), 0, 0, 0); s.rotation.x = Math.PI / 2; g.add(s);
      break;
    }
    case 'bee': {
      const b = mesh(G.ball(3.4, 1), mat('#ffd23a'), 0, 0, 0); b.scale.set(1.5, 1, 1); g.add(b);
      g.add(mesh(G.cyl(3.3, 3.3, 1.4, 8), mat('#2b2b2b'), 0, 0, 0)).children.at(-1).rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) { const w = mesh(G.sph(3, 6, 4), mat('#ffffff', { opacity: 0.75 }), 0, 3, s * 1.5, false); w.scale.set(0.6, 0.3, 1); w.userData.wing = s; g.add(w); }
      g.add(mesh(G.ball(1, 0), mat('#2b2b2b'), 5, 0.8, 1.5));
      break;
    }
    case 'bomb': {
      const b = mesh(G.ball(4, 1), mat('#2b2b40'), 0, 0, 0); b.scale.set(1.5, 1, 1); g.add(b);
      const f = mesh(G.box(4, 6, 0.8), mat('#ff3a4f'), -6, 0, 0); g.add(f);
      break;
    }
    case 'dynamite':
      for (let k = 0; k < 3; k++) g.add(mesh(G.cyl(1.8, 1.8, 10, 6), mat('#ff3a4f'), (k - 1) * 3.6, 0, 0));
      g.add(mesh(G.box(11, 2, 4), mat('#2b2b2b'), 0, 0, 0));
      g.add(mesh(G.cyl(0.4, 0.4, 4, 3), mat('#ddd'), 0, 7, 0));
      g.add(new THREE.Mesh(G.sph(1.3, 5, 4), new THREE.MeshBasicMaterial({ color: '#ffdd55', toneMapped: false })));
      g.children.at(-1).position.set(0, 9.5, 0);
      g.children.at(-1).userData.spark = true;
      break;
    default:
      g.add(mesh(G.ball(3, 0), mat('#ffffff'), 0, 0, 0));
  }
  return g;
}

function makeHeld() {
  const root = new THREE.Group();
  const models = {};
  const tube = (c) => { const g = new THREE.Group(); const t = mesh(G.cyl(2.6, 2.9, 17, 8), mat(c), 9, 0, 0); t.rotation.z = Math.PI / 2; g.add(t); g.add(mesh(G.cyl(3.1, 3.1, 2, 8), mat('#2b2b2b'), 17, 0, 0)).children.at(-1).rotation.z = Math.PI / 2; g.add(mesh(G.box(3, 5, 2), mat('#2b2b2b'), 5, -3.5, 0)); return g; };
  models.rocket = tube('#3fae4a');
  models.grapes = tube('#8a3fd6');
  models.melon = tube('#2f9d43');
  models.bee = tube('#ffd23a');
  models.grenade = (() => { const g = new THREE.Group(); g.add(mesh(G.ball(3.5, 1), mat('#3fae4a'), 9, 0, 0)); return g; })();
  models.blaster = (() => {
    const g = new THREE.Group();
    g.add(mesh(G.box(13, 5, 4), mat('#ff8a1f'), 8, 0, 0));
    g.add(mesh(G.ball(3.4, 1), mat('#3aa0ff'), 6, 4.5, 0));
    const b = mesh(G.cyl(1.4, 1.4, 6, 6), mat('#ffd23a'), 16, 0.5, 0); b.rotation.z = Math.PI / 2; g.add(b);
    g.add(mesh(G.box(3, 5, 3), mat('#ff3a4f'), 4, -4, 0));
    return g;
  })();
  models.bonk = (() => {
    const g = new THREE.Group();
    const h = mesh(G.cyl(1, 1, 16, 5), mat('#a0703c'), 8, 0, 0); h.rotation.z = Math.PI / 2; g.add(h);
    g.add(mesh(G.box(6, 10, 7), mat('#ff4fa3'), 17, 0, 0));
    return g;
  })();
  models.airdrop = (() => { const g = new THREE.Group(); g.add(mesh(G.box(4, 7, 3), mat('#2b2b40'), 9, 0, 0), mesh(G.cyl(0.4, 0.4, 7, 3), mat('#ddd'), 9, 7, 0), mesh(G.ball(1.2), mat('#ff3a4f', { basic: true }), 9, 10.5, 0)); return g; })();
  models.dynamite = (() => { const g = makeProjMesh('dynamite'); g.position.x = 9; g.scale.setScalar(0.8); const w = new THREE.Group(); w.add(g); return w; })();
  models.mine = (() => { const w = new THREE.Group(); const m = makeMine().root; m.position.x = 10; w.add(m); return w; })();
  models.teleport = (() => {
    const g = new THREE.Group();
    const s = mesh(G.cyl(0.8, 0.8, 14, 4), mat('#ffffff'), 8, 0, 0); s.rotation.z = Math.PI / 2; g.add(s);
    const star = mesh(G.oct(3.4), mat('#6dfff0', { emissive: '#6dfff0', ei: 0.8 }), 16, 0, 0); star.userData.spin = true; g.add(star);
    return g;
  })();
  models.skip = new THREE.Group();
  for (const k in models) { models[k].visible = false; root.add(models[k]); }
  return { root, models };
}

// ------------------------------------------------------------------ particles
function makePool(parent, g, material, max) {
  const im = new THREE.InstancedMesh(g, material, max);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.count = 0;
  im.frustumCulled = false;
  im.setColorAt(0, new THREE.Color('#ffffff'));
  parent.add(im);
  const parts = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  return {
    im,
    spawn(o) {
      if (parts.length >= max) parts.shift();
      parts.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, age: 0, s0: 4, s1: 0, rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 8, grav: 0, drag: 0, color: new THREE.Color('#ffffff'), ...o });
    },
    update(dt, water) {
      let n = 0;
      for (let i = parts.length - 1; i >= 0; i--) {
        const a = parts[i];
        a.age += dt;
        if (a.age >= a.life) { parts.splice(i, 1); continue; }
      }
      for (const a of parts) {
        a.vy -= a.grav * dt;
        if (a.drag) { const k = Math.max(0, 1 - a.drag * dt); a.vx *= k; a.vy *= k; a.vz *= k; }
        a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
        if (a.floor && a.y < water) { a.y = water; a.vy = 0; a.vx *= 0.9; }
        a.rx += a.spin * dt; a.ry += a.spin * 0.7 * dt;
        const t = a.age / a.life;
        const sc = a.pop ? lerp(a.s0, a.s1, Math.sin(Math.min(1, t) * Math.PI) ** 0.6) : lerp(a.s0, a.s1, t);
        p.set(a.x, a.y, a.z); e.set(a.rx, a.ry, 0); q.setFromEuler(e); s.setScalar(Math.max(0.01, sc));
        m4.compose(p, q, s);
        im.setMatrixAt(n, m4);
        im.setColorAt(n, a.color);
        n++;
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    },
    clear() { parts.length = 0; im.count = 0; },
  };
}

// ------------------------------------------------------------------ world
export function createWorld() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 10, 32000);
  const hemi = new THREE.HemisphereLight('#ffffff', '#888888', 1.25);
  const sun = new THREE.DirectionalLight('#ffffff', 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(hemi, sun, sun.target);
  const skyGeo = new THREE.SphereGeometry(14000, 32, 16);
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  sky.renderOrder = -10;
  scene.add(sky);
  const root = new THREE.Group();
  scene.add(root);
  const fx = new THREE.Group();
  scene.add(fx);
  const smoke = makePool(fx, G.ball(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), 420);
  const debris = makePool(fx, geo('tet', () => new THREE.TetrahedronGeometry(1)), new THREE.MeshLambertMaterial({ flatShading: true }), 420);
  const sparks = makePool(fx, G.oct(1), new THREE.MeshBasicMaterial({ toneMapped: false }), 500);
  const flashes = [];
  for (let i = 0; i < 10; i++) {
    const f = new THREE.Mesh(G.ball(1, 1), new THREE.MeshBasicMaterial({ color: '#fff3a0', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    f.visible = false;
    fx.add(f);
    flashes.push({ m: f, t: 1, life: 0.25, r: 10 });
  }
  const held = makeHeld();
  scene.add(held.root);
  // aiming helpers
  const aim = new THREE.Group();
  const cross = new THREE.Group();
  const crossMat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, toneMapped: false });
  cross.add(new THREE.Mesh(G.tor(6, 1.1, 5, 18), crossMat));
  for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(G.box(1.2, 4, 1), crossMat); const a = (k / 4) * Math.PI * 2; t.position.set(Math.cos(a) * 9, Math.sin(a) * 9, 0); t.rotation.z = a + Math.PI / 2; cross.add(t); }
  cross.renderOrder = 20;
  aim.add(cross);
  const dots = [];
  for (let k = 0; k < 9; k++) {
    const d = new THREE.Mesh(G.sph(1.9, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.15 - k * 0.017, 1, 0.55), depthTest: false, transparent: true, toneMapped: false }));
    d.renderOrder = 19;
    aim.add(d);
    dots.push(d);
  }
  const guide = [];
  for (let k = 0; k < 16; k++) {
    const d = new THREE.Mesh(G.sph(1.5, 5, 3), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthTest: false, toneMapped: false }));
    d.renderOrder = 18;
    aim.add(d);
    guide.push(d);
  }
  aim.visible = false;
  scene.add(aim);
  const marker = new THREE.Group();
  {
    const mm = new THREE.MeshBasicMaterial({ color: '#ffd23a', depthTest: false, transparent: true, toneMapped: false });
    const ring = new THREE.Mesh(G.tor(12, 1.6, 5, 24), mm); marker.add(ring);
    const arrow = new THREE.Mesh(G.cone(6, 14, 5), mm); arrow.rotation.z = Math.PI; arrow.position.y = 26; marker.add(arrow);
    marker.userData.arrow = arrow;
    marker.renderOrder = 21;
    marker.visible = false;
    scene.add(marker);
  }
  const arrowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const turnArrow = new THREE.Mesh(G.cone(4.5, 10, 4), arrowMat);
  turnArrow.rotation.z = Math.PI;
  turnArrow.visible = false;
  scene.add(turnArrow);

  let S = null, theme = null, themeKey = 'candy', terrain = null, water = null, farWater = null, seabed = null;
  const vis = new Map(), pvis = new Map();
  let props = [], sinkers = [], planes = [], smokers = [], drifters = [];
  const W = { shake: 0, time: 0 };
  const v3 = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  function paintSky(t) {
    const c0 = new THREE.Color(t.sky[0]), c1 = new THREE.Color(t.sky[1]), c2 = new THREE.Color(t.sky[2]), fog = new THREE.Color(t.fog);
    const pos = skyGeo.attributes.position, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 14000;
      if (y <= 0) c.copy(fog).lerp(c2, Math.max(0, 1 + y * 6));
      else if (y < 0.22) c.copy(c2).lerp(c1, y / 0.22);
      else c.copy(c1).lerp(c0, Math.min(1, (y - 0.22) / 0.6));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  }

  function disposeMatch() {
    if (terrain) terrain.dispose();
    terrain = null;
    for (const v of vis.values()) { if (v.bodyMat) v.bodyMat.dispose(); }
    vis.clear(); pvis.clear();
    const cached = new Set(GC.values());
    root.traverse((o) => { if (o.geometry && !cached.has(o.geometry)) o.geometry.dispose(); });
    root.clear();
    props = []; sinkers = []; planes = []; smokers = []; drifters = [];
    smoke.clear(); debris.clear(); sparks.clear();
    for (const f of flashes) { f.m.visible = false; f.t = 1; }
  }

  function load(match, key) {
    disposeMatch();
    S = match;
    themeKey = key;
    theme = THEMES[key];
    paintSky(theme);
    scene.fog = new THREE.Fog(theme.fog, 4200, 15000);
    hemi.color.set(theme.hemiSky);
    hemi.groundColor.set(theme.hemiGround);
    hemi.intensity = key === 'moon' ? 1.0 : key === 'lava' ? 1.05 : 1.25;
    sun.color.set(theme.sun);
    sun.intensity = key === 'moon' ? 1.7 : key === 'lava' ? 1.8 : 2.15;
    const cx = S.W / 2;
    sun.target.position.set(cx, 300, 0);
    sun.position.set(cx - 900, 1900, 1500);
    const sc = sun.shadow.camera;
    sc.left = -S.W / 2 - 300; sc.right = S.W / 2 + 300; sc.top = 1100; sc.bottom = -1100; sc.near = 100; sc.far = 5200;
    sc.updateProjectionMatrix();

    const tg = new THREE.Group();
    root.add(tg);
    terrain = createTerrain(S, theme, tg);

    // sea: animated near water, a flat far sea with a hole, and a seabed under the near part
    const NW = S.W + 4000, ND = 4000;
    const wg = new THREE.PlaneGeometry(NW, ND, 72, 30);
    wg.rotateX(-Math.PI / 2);
    wg.userData.base = Float32Array.from(wg.attributes.position.array);
    const wmat = new THREE.MeshLambertMaterial({ color: theme.water, transparent: true, opacity: theme.waterOpacity, flatShading: true, emissive: theme.waterGlow ? theme.water : '#000000', emissiveIntensity: theme.waterGlow ? 0.75 : 1, depthWrite: false });
    water = new THREE.Mesh(wg, wmat);
    water.position.set(cx, S.water, 0);
    water.receiveShadow = true;
    water.renderOrder = 2;
    root.add(water);
    const shape = new THREE.Shape();
    shape.moveTo(-22000, -22000); shape.lineTo(22000, -22000); shape.lineTo(22000, 22000); shape.lineTo(-22000, 22000); shape.lineTo(-22000, -22000);
    const hole = new THREE.Path();
    hole.moveTo(-NW / 2, -ND / 2); hole.lineTo(-NW / 2, ND / 2); hole.lineTo(NW / 2, ND / 2); hole.lineTo(NW / 2, -ND / 2); hole.lineTo(-NW / 2, -ND / 2);
    shape.holes.push(hole);
    const fg = new THREE.ShapeGeometry(shape);
    fg.rotateX(-Math.PI / 2);
    const farCol = new THREE.Color(theme.water).lerp(new THREE.Color(theme.waterDeep), 1 - theme.waterOpacity);
    farWater = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ color: farCol, emissive: theme.waterGlow ? farCol : '#000000', emissiveIntensity: 0.7 }));
    farWater.position.set(cx, S.water, 0);
    root.add(farWater);
    seabed = new THREE.Mesh(geo('seabed', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: theme.waterDeep, toneMapped: false }));
    seabed.scale.set(NW, 1, ND);
    seabed.position.set(cx, -2, 0);
    root.add(seabed);

    // props on the ground
    let seed = S.seed * 9 + 1;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const builders = propBuilders(theme, key);
    const bigs = builders.filter((_, i) => builders[i](0.5).big);
    const smalls = builders.filter((_, i) => !builders[i](0.5).big);
    const pg = new THREE.Group();
    root.add(pg);
    for (let x = 30 + rnd() * 30; x < S.W - 30; x += 22 + rnd() * 46) {
      const xi = Math.floor(x);
      const tops = [];
      let prev = S.mask[(S.H - 1) * S.W + xi];
      for (let y = S.H - 2; y > S.water + 6; y--) { const s = S.mask[y * S.W + xi]; if (s && !prev) tops.push(y + 1); prev = s; }
      for (let k = 0; k < tops.length; k++) {
        const y = tops[k];
        if (S.mask[(y - 1) * S.W + xi] === 2 || rnd() < 0.25) continue;
        let room = 0;
        while (room < 70 && y + room < S.H && !S.mask[(y + room) * S.W + xi]) room++;
        const big = k === 0 && room >= 70 && rnd() < 0.45;
        const list = big ? bigs : smalls;
        if (!list.length) continue;
        const made = list[Math.floor(rnd() * list.length)](rnd());
        const back = big || rnd() < 0.6;
        const z = back ? -HALF + 14 + rnd() * (HALF - 40) : 26 + rnd() * (HALF - 36);
        const s = (big ? 0.85 + rnd() * 0.5 : 0.7 + rnd() * 0.6) * (back ? 1 : 0.7);
        made.g.scale.setScalar(s);
        made.g.position.set(x, y - 1, z);
        made.g.rotation.y = (rnd() - 0.5) * 1.2;
        made.g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        pg.add(made.g);
        props.push({ obj: made.g, x, y, z, vy: 0, vx: 0, vz: 0, spin: 0, falling: false, vent: made.vent, blink: made.blink, t: rnd() * 5 });
      }
    }
    const bg = new THREE.Group();
    root.add(bg);
    makeBackdrop(S, theme, key, bg, rnd);
    bg.traverse((o) => { if (o.userData.volcano) smokers.push(o); if (o.userData.drift) drifters.push(o); });
  }

  // ---------------------------------------------------------------- effects
  function flash(x, y, z, r, color, life = 0.25) {
    const f = flashes.find((q) => q.t >= 1) || flashes[0];
    f.t = 0; f.life = life; f.r = r;
    f.m.position.set(x, y, z);
    f.m.material.color.set(color);
    f.m.visible = true;
  }
  const C = (hex) => new THREE.Color(hex);
  function boom(x, y, R, kind) {
    const pal = theme.boom;
    flash(x, y, 0, R * 1.25, pal[0], 0.22 + R / 400);
    const nf = 10 + Math.round(R / 3);
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI, sp = R * (3 + Math.random() * 5);
      sparks.spawn({ x, y, z: 0, vx: Math.cos(a) * Math.cos(b) * sp, vy: Math.sin(a) * Math.cos(b) * sp + R, vz: Math.sin(b) * sp, life: 0.35 + Math.random() * 0.35, s0: R * 0.12 + 2, s1: 0, grav: 300, drag: 2.5, color: C(pal[i % pal.length]) });
    }
    const smokeCol = themeKey === 'lava' ? '#3b2b38' : themeKey === 'candy' ? '#ffe3f2' : themeKey === 'moon' ? '#8c86a8' : '#d8d8d8';
    for (let i = 0; i < 6 + R / 8; i++) {
      smoke.spawn({ x: x + (Math.random() - 0.5) * R, y: y + (Math.random() - 0.3) * R * 0.6, z: (Math.random() - 0.5) * R, vx: (Math.random() - 0.5) * 30, vy: 25 + Math.random() * 40, vz: (Math.random() - 0.5) * 30, life: 1.1 + Math.random() * 0.8, s0: R * 0.3, s1: R * 0.6, pop: true, drag: 0.6, color: C(smokeCol).multiplyScalar(0.85 + Math.random() * 0.25) });
    }
    if (kind !== 'shot') {
      const soil = theme.soil, cols = [theme.top, soil[0], soil[1 % soil.length], theme.scorch];
      for (let i = 0; i < 10 + R / 3; i++) {
        const a = Math.random() * Math.PI, sp = 120 + Math.random() * R * 6;
        debris.spawn({ x: x + (Math.random() - 0.5) * R * 0.6, y, z: (Math.random() - 0.5) * DEPTH * 0.8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 80, vz: (Math.random() - 0.5) * 260, life: 1.2 + Math.random() * 0.8, s0: 2 + Math.random() * R * 0.09, s1: 0.5, grav: 620, spin: (Math.random() - 0.5) * 14, color: C(cols[i % cols.length]) });
      }
    }
    W.shake = Math.min(18, W.shake + R / 5);
    // knock props out of the blast
    for (const p of props) {
      if (p.falling) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < R * 1.15) { p.falling = true; p.vy = 240 + Math.random() * 200; p.vx = (p.x - x) * 4; p.vz = (Math.random() - 0.5) * 200; p.spin = (Math.random() - 0.5) * 10; }
    }
  }
  function splash(x, y, big) {
    const n = big ? 26 : 12;
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = (big ? 220 : 150) * (0.5 + Math.random());
      debris.spawn({ x, y: y + 2, z: (Math.random() - 0.5) * 30, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.5) * 100, life: 0.9, s0: big ? 4 : 2.5, s1: 0.5, grav: 700, color: C(lighten(theme.water, 0.4)) });
    }
    flash(x, y, 0, big ? 22 : 12, lighten(theme.water, 0.6), 0.25);
  }
  function sparkle(x, y, cols, n = 16, sp = 120) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      sparks.spawn({ x, y, z: (Math.random() - 0.5) * 20, vx: Math.cos(a) * sp * Math.random(), vy: Math.sin(a) * sp * Math.random() + 40, vz: (Math.random() - 0.5) * 60, life: 0.6 + Math.random() * 0.4, s0: 2.6, s1: 0, grav: 60, color: C(cols[i % cols.length]) });
    }
  }
  function puff(x, y, s = 4, col = '#e8e8e8') {
    smoke.spawn({ x, y, z: (Math.random() - 0.5) * 4, vx: (Math.random() - 0.5) * 12, vy: 12, vz: 0, life: 0.6 + Math.random() * 0.3, s0: s, s1: s * 1.8, pop: true, color: C(col) });
  }
  function makePlane(x, dir) {
    const g = new THREE.Group();
    const body = mesh(G.cyl(7, 5, 46, 8), mat('#ffd23a'), 0, 0, 0); body.rotation.z = Math.PI / 2; g.add(body);
    g.add(mesh(G.box(14, 2, 70), mat('#ff4fa3'), 2, 0, 0));
    g.add(mesh(G.box(8, 12, 2), mat('#ff4fa3'), -21, 7, 0));
    const nose = mesh(G.cone(7, 10, 8), mat('#3aa0ff'), 28, 0, 0); nose.rotation.z = -Math.PI / 2; g.add(nose);
    g.scale.set(dir * 1.4, 1.4, 1.4);
    g.position.set(x - dir * 900, S.H + 110, 0);
    scene.add(g);
    planes.push({ g, dir, t: 0 });
  }

  function onEvent(e) {
    if (!S) return;
    switch (e.type) {
      case 'boom': boom(e.x, e.y, e.r, e.kind); break;
      case 'splash': splash(e.x, e.y, e.big); break;
      case 'drown': {
        const v = vis.get(e.id);
        if (v) { vis.delete(e.id); sinkers.push({ obj: v.root, t: 0, mat: v.bodyMat }); }
        break;
      }
      case 'teleport': sparkle(e.x0, e.y0, ['#6dfff0', '#b45cff', '#ffffff'], 24, 160); sparkle(e.x1, e.y1, ['#6dfff0', '#b45cff', '#ffffff'], 24, 160); break;
      case 'pickup': sparkle(e.x, e.y, ['#ffd23a', '#ffffff', '#ff4fa3'], 22, 140); break;
      case 'bonk': if (e.hit) sparkle(e.x, e.y, ['#ffd23a', '#ffffff'], 14, 200); W.shake = Math.min(18, W.shake + (e.hit ? 6 : 1)); break;
      case 'shot': {
        const n = Math.max(2, Math.floor(Math.hypot(e.x1 - e.x0, e.y1 - e.y0) / 14));
        for (let i = 0; i < n; i++) { const t = i / n; sparks.spawn({ x: lerp(e.x0, e.x1, t), y: lerp(e.y0, e.y1, t), z: 0, life: 0.25, s0: 1.8, s1: 0, color: C(i % 2 ? '#7ef0ff' : '#ffffff') }); }
        break;
      }
      case 'launch': { const c = byId(e.id); if (c) for (let i = 0; i < 4; i++) puff(c.x, c.y, 4); break; }
      case 'plane': makePlane(e.x, e.dir); break;
      case 'pop': sparkle(e.x, e.y, ['#ffffff', '#ff3a4f'], 10, 100); break;
      case 'thud': if (e.v > 220) for (let i = 0; i < 3; i++) puff(e.x + (Math.random() - 0.5) * 10, e.y - 8, 3, lighten(theme.soil[0], 0.4)); break;
      case 'jump': { const c = byId(e.id); if (c) { const v = vis.get(c.id); if (v) v.sq = 0.7; } break; }
    }
  }
  const byId = (id) => S.bodies.find((b) => b.id === id);

  // ---------------------------------------------------------------- per frame
  function syncBodies(dt, info) {
    const seen = new Set();
    const t = W.time;
    for (const b of S.bodies) {
      if (b.gone) continue;
      seen.add(b.id);
      let v = vis.get(b.id);
      if (!v) {
        if (b.kind === 'critter') v = makeCritter(b, S.teams[b.team].color);
        else if (b.kind === 'grave') v = makeGrave(S.teams[b.team].color);
        else if (b.kind === 'mine') v = makeMine();
        else if (b.kind === 'barrel') v = makeBarrel(theme);
        else if (b.kind === 'crate') v = makeCrate(b.crate);
        else continue;
        v.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        root.add(v.root);
        vis.set(b.id, v);
      }
      v.root.position.set(b.x, b.y, 0);
      if (v.kind === 'critter') animateCritter(v, b, dt, t, info);
      else if (v.kind === 'mine') {
        const on = b.fuse != null ? Math.sin(t * 30) > 0 : b.armT > 0 ? Math.sin(t * 6) > 0.6 : Math.sin(t * 3) > 0.85;
        v.light.material.color.set(b.armT > 0 && b.fuse == null ? '#ffd23a' : '#ff2a2a');
        v.light.visible = on;
        v.root.position.y -= 1;
      } else if (v.kind === 'crate') {
        v.chute.visible = !!b.chute;
        v.root.rotation.z = b.chute ? Math.sin(t * 2 + b.id) * 0.12 : 0;
      } else if (v.kind === 'barrel') {
        v.root.rotation.z = b.rest ? 0 : v.root.rotation.z + b.vx * 0.0006;
      } else if (v.kind === 'grave') {
        v.root.position.y -= 1;
      }
    }
    for (const [id, v] of vis) {
      if (seen.has(id)) continue;
      root.remove(v.root);
      if (v.bodyMat) v.bodyMat.dispose();
      vis.delete(id);
    }
  }

  function animateCritter(v, b, dt, t, info) {
    const isActive = b.id === S.active;
    const walking = S.time - b.walkT < 0.1;
    const want = b.facing > 0 ? 0.72 : -0.72;
    v.pivot.rotation.y += (want - v.pivot.rotation.y) * Math.min(1, dt * 12);
    let sy = 1 + Math.sin(t * 3 + b.id) * 0.025, bob = 0, rz = 0;
    if (walking) { bob = Math.abs(Math.sin(t * 15)) * 1.6; rz = Math.sin(t * 15) * 0.13; }
    if (!b.rest) sy = 1 + clamp(b.vy / 1600, -0.14, 0.2);
    if (b.rest && !v.wasRest) v.sq = 0.72;
    v.wasRest = b.rest;
    v.sq += (1 - v.sq) * Math.min(1, dt * 10);
    sy *= v.sq;
    const s = b.r / 9;
    v.pivot.scale.set(s * (2 - sy) ** 0.5, s * sy, s * (2 - sy) ** 0.5);
    v.pivot.position.y = bob - (1 - sy) * 6;
    v.pivot.rotation.z = rz;
    // blinking and looking where it aims
    v.blinkT -= dt;
    const blink = v.blinkT < 0.12;
    if (v.blinkT < 0) v.blinkT = 2 + Math.random() * 3.5;
    for (const e of v.eyes) e.scale.y = blink ? 0.15 : 1;
    const look = isActive ? Math.sin(b.elev) * 0.9 : 0;
    for (const p of v.pupils) { p.position.y = look; p.position.x = isActive ? 0.25 : 0; }
    const hurt = S.time - b.hurtT;
    if (hurt < 0.4) v.bodyMat.emissive.setRGB(0.9 * (1 - hurt / 0.4), 0.1, 0.1); else v.bodyMat.emissive.setRGB(0, 0, 0);
    if (isActive && info.showHeld) {
      held.root.position.set(b.x, b.y - 1, 6);
      const a = Math.atan2(Math.sin(b.elev), b.facing * Math.cos(b.elev));
      held.root.rotation.set(0, 0, a);
      held.root.scale.set(s, b.facing > 0 ? s : -s, s);
    }
  }

  function syncProjectiles(dt) {
    const seen = new Set();
    for (const p of S.projs) {
      seen.add(p.id);
      let o = pvis.get(p.id);
      if (!o) { o = makeProjMesh(p.kind); o.userData.trail = 0; root.add(o); pvis.set(p.id, o); }
      o.position.set(p.x, p.y, 0);
      const ang = Math.atan2(p.vy, p.vx);
      if (p.kind === 'rocket' || p.kind === 'bee' || p.kind === 'bomb') o.rotation.z = ang;
      else o.rotation.z -= p.vx * 0.0009 * 60 * dt;
      o.userData.trail -= dt;
      if (o.userData.trail <= 0) {
        if (p.kind === 'rocket' || p.kind === 'bomb') { o.userData.trail = 0.025; puff(p.x - Math.cos(ang) * 8, p.y - Math.sin(ang) * 8, 3.2, '#f0f0f0'); }
        else if (p.kind === 'bee') { o.userData.trail = 0.06; sparks.spawn({ x: p.x, y: p.y, z: 0, life: 0.4, s0: 1.4, s1: 0, color: C('#ffd23a') }); }
        else if (p.kind === 'dynamite') { o.userData.trail = 0.04; sparks.spawn({ x: p.x, y: p.y + 10, z: 0, vx: (Math.random() - 0.5) * 60, vy: 40 + Math.random() * 40, vz: 0, grav: 200, life: 0.35, s0: 1.2, s1: 0, color: C(Math.random() < 0.5 ? '#ffd23a' : '#ff7a1a') }); }
      }
      if (p.kind === 'bee') o.traverse((c) => { if (c.userData.wing) c.rotation.x = Math.sin(W.time * 60) * 0.6 * c.userData.wing; });
      if (p.kind === 'dynamite') o.traverse((c) => { if (c.userData.spark) c.scale.setScalar(0.7 + Math.random() * 0.8); });
    }
    for (const [id, o] of pvis) { if (!seen.has(id)) { root.remove(o); pvis.delete(id); } }
  }

  function updateAim(info) {
    const c = info.aim && S.bodies.find((b) => b.id === S.active && !b.gone);
    aim.visible = !!c;
    if (c) {
      const dx = c.facing * Math.cos(c.elev), dy = Math.sin(c.elev);
      const ca = PROJ[info.weapon];
      cross.position.set(c.x + dx * (c.r + 46), c.y + dy * (c.r + 46), 8);
      cross.quaternion.copy(camera.quaternion);
      cross.children[0].material.color.set(S.teams[c.team].color).lerp(new THREE.Color('#ffffff'), 0.35);
      const showPow = info.powerAim;
      for (let k = 0; k < dots.length; k++) {
        const f = (k + 1) / dots.length;
        dots[k].visible = showPow && f <= info.power + 0.001;
        const d = c.r + 8 + f * 78;
        dots[k].position.set(c.x + dx * d, c.y + dy * d, 8);
        dots[k].scale.setScalar(0.7 + f * 0.9);
      }
      // trajectory guide: the first moments of flight, no wind
      const gOn = info.guide && showPow && ca;
      if (gOn) {
        const sp = 90 + info.power * 810;
        let x = c.x + dx * (c.r + 5), y = c.y + dy * (c.r + 5), vx = dx * sp, vy = dy * sp;
        const step = 0.028;
        for (let k = 0; k < guide.length; k++) {
          for (let s = 0; s < 2; s++) { vy -= S.grav * step / 2; x += vx * step / 2; y += vy * step / 2; }
          guide[k].visible = true;
          guide[k].position.set(x, y, 8);
          guide[k].material.opacity = 0.75 * (1 - k / guide.length);
        }
      } else for (const g of guide) g.visible = false;
    }
    marker.visible = !!info.target;
    if (info.target) {
      marker.position.set(info.target.x, info.target.y, 8);
      marker.userData.arrow.position.y = 26 + Math.sin(W.time * 6) * 4;
      marker.children[0].rotation.z = W.time;
    }
    for (const k in held.models) held.models[k].visible = info.showHeld && k === info.weapon;
    if (held.models.teleport.visible) held.models.teleport.children[1].rotation.y = W.time * 4;
    const ac = info.showArrow && S.bodies.find((b) => b.id === S.active && !b.gone);
    turnArrow.visible = !!ac;
    if (ac) {
      turnArrow.position.set(ac.x, ac.y + ac.r + 30 + Math.sin(W.time * 6) * 4, 0);
      turnArrow.rotation.y = W.time * 3;
      arrowMat.color.set(S.teams[ac.team].color);
    }
  }

  function update(dt, info) {
    if (!S) return;
    W.time += dt;
    for (const r of S.dirty) {
      terrain.refresh(r[0], r[1], r[2], r[3]);
      for (const p of props) {
        if (p.falling || p.x < r[0] - 12 || p.x > r[2] + 12 || p.y < r[1] - 12 || p.y > r[3] + 12) continue;
        const xi = Math.floor(p.x), yi = Math.floor(p.y - 3);
        const ok = (xx) => xx >= 0 && xx < S.W && yi >= 0 && S.mask[yi * S.W + xx];
        if (!ok(xi) && !ok(xi - 4) && !ok(xi + 4)) { p.falling = true; p.vy = 0; p.vx = (Math.random() - 0.5) * 30; p.spin = (Math.random() - 0.5) * 3; }
      }
    }
    S.dirty.length = 0;
    syncBodies(dt, info);
    syncProjectiles(dt);
    updateAim(info);
    // water
    water.position.y = S.water; farWater.position.y = S.water - 0.5;
    const wp = water.geometry.attributes.position, base = water.geometry.userData.base;
    const NW2 = (S.W + 4000) / 2;
    const amp = themeKey === 'lava' ? 3 : 4.5;
    for (let i = 0; i < wp.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      const edge = clamp((NW2 - Math.abs(x)) / 300, 0, 1) * clamp((2000 - Math.abs(z)) / 300, 0, 1);
      wp.setY(i, edge * amp * (Math.sin(x * 0.012 + W.time * 1.6) + Math.sin(z * 0.02 + W.time * 1.1 + x * 0.004) * 0.7));
    }
    wp.needsUpdate = true;
    // props
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i];
      if (p.blink) p.obj.children.at(-1).visible = Math.sin(W.time * 4 + p.t) > 0.3;
      if (p.vent && Math.random() < dt * 1.5) puff(p.x, p.y + 14, 4, '#5a4a52');
      if (!p.falling) continue;
      p.vy -= 650 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.obj.position.set(p.x, p.y, p.z);
      p.obj.rotation.z += p.spin * dt;
      p.obj.rotation.x += p.spin * 0.5 * dt;
      if (p.y < S.water - 80) { p.obj.parent.remove(p.obj); props.splice(i, 1); }
    }
    for (let i = sinkers.length - 1; i >= 0; i--) {
      const s = sinkers[i];
      s.t += dt;
      s.obj.position.y -= 18 * dt;
      s.obj.rotation.z += dt * 1.2;
      if (s.t > 2) { root.remove(s.obj); if (s.mat) s.mat.dispose(); sinkers.splice(i, 1); }
    }
    for (let i = planes.length - 1; i >= 0; i--) {
      const p = planes[i];
      p.t += dt;
      p.g.position.x += p.dir * 900 * dt;
      if (p.t > 2.2) { scene.remove(p.g); planes.splice(i, 1); }
    }
    for (const o of smokers) {
      if (Math.random() < dt * 3) {
        const wpos = o.getWorldPosition(v3);
        smoke.spawn({ x: wpos.x + (Math.random() - 0.5) * 40, y: wpos.y + o.userData.volcano.y, z: wpos.z, vx: 20, vy: 60, vz: 0, life: 4, s0: 40, s1: 140, pop: true, color: C('#3b2b38') });
      }
    }
    for (const o of drifters) { o.position.x += o.userData.drift * dt; if (o.position.x > S.W / 2 + 8000) o.position.x -= 16000; }
    smoke.update(dt, S.water);
    debris.update(dt, -1e9);
    sparks.update(dt, -1e9);
    for (const f of flashes) {
      if (f.t >= 1) continue;
      f.t += dt / f.life;
      const k = Math.min(1, f.t);
      f.m.scale.setScalar(f.r * (0.35 + 0.65 * Math.sqrt(k)));
      f.m.material.opacity = 0.9 * (1 - k);
      if (f.t >= 1) f.m.visible = false;
    }
    W.shake = Math.max(0, W.shake - dt * 30);
    sky.position.copy(camera.position);
  }

  return {
    scene, camera,
    get theme() { return theme; },
    get shake() { return W.shake; },
    load, update, onEvent, dispose: disposeMatch,
    /** Project a world point to CSS pixels. */
    toScreen(x, y, z, w, h, out) {
      v3.set(x, y, z).project(camera);
      out.x = (v3.x * 0.5 + 0.5) * w;
      out.y = (-v3.y * 0.5 + 0.5) * h;
      out.vis = v3.z > -1 && v3.z < 1;
      return out;
    },
    /** Where a screen point lands on the fighting plane (z = 0), or null. */
    pick(sx, sy, w, h) {
      raycaster.setFromCamera({ x: (sx / w) * 2 - 1, y: -(sy / h) * 2 + 1 }, camera);
      const d = raycaster.ray.direction;
      if (Math.abs(d.z) < 0.12) return null;
      const p = raycaster.ray.intersectPlane(planeZ, new THREE.Vector3());
      return p ? { x: p.x, y: p.y } : null;
    },
    setShadows(on) { sun.castShadow = on; },
  };
}
