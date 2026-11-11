// Little Cup Plaza — low-poly mall models: shop units, décor, instanced crowds and cars.
import * as THREE from 'three';
import { mat, glow, box, cyl, sph, cone, mesh, buildFurniture, buildTree, buildEspressoMachine, buildRegister, buildPastryCase } from './cafe-models.js';
import { UNITS, footprint } from './mall-logic.js';

export { mat, glow, box, cyl, sph, cone, mesh, buildTree };

export const WALL_H = 1.25;
const shade = (hex, f) => { const c = new THREE.Color(hex); c.offsetHSL(0, 0, f); return '#' + c.getHexString(); };

// ---------------------------------------------------------------- signs
const signCache = new Map();
export function signTexture(text, bg, fg = '#fffaf0', icon = '') {
  const key = text + bg + fg + icon;
  if (signCache.has(key)) return signCache.get(key);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.beginPath(); x.roundRect(4, 4, 504, 120, 28); x.fill();
  x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 6; x.beginPath(); x.roundRect(14, 14, 484, 100, 22); x.stroke();
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  let size = 64;
  x.font = `800 ${size}px Nunito, system-ui, sans-serif`;
  const label = (icon ? icon + ' ' : '') + text;
  while (x.measureText(label).width > 460 && size > 26) { size -= 4; x.font = `800 ${size}px Nunito, system-ui, sans-serif`; }
  x.fillText(label, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  signCache.set(key, t);
  return t;
}
function sign(parent, text, color, w, y, z, icon) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: signTexture(text, color, '#fffaf0', icon), roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.12, emissiveMap: signTexture(text, color, '#fffaf0', icon) }));
  m.position.set(0, y, z);
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------- shop props (local space: unit interior, door at +z)
function shelfRow(gr, x, z, len, color, items) {
  mesh(box(len, 0.5, 0.28), mat(shade(color, -0.25)), x, 0.25, z, gr);
  for (let i = 0; i < 3; i++) for (let k = 0; k < Math.floor(len / 0.18); k++) {
    const c = items[(i + k) % items.length];
    mesh(box(0.12, 0.1, 0.16), mat(c), x - len / 2 + 0.12 + k * 0.18, 0.12 + i * 0.16 + 0.05, z, gr);
  }
}
const PROD = ['#e86f5f', '#5a86c5', '#f2c14e', '#7fb77e', '#c58fd9', '#f2f2ee', '#63b2b0', '#ff9ab0'];

function counter(gr, w, z, color = '#7b4f31', x = 0) {
  mesh(box(w, 0.42, 0.34, 0.03), mat(color), x, 0.21, z, gr);
  mesh(box(w + 0.04, 0.04, 0.38), mat('#f4efe6'), x, 0.44, z, gr);
  const r = buildRegister(); r.scale.setScalar(0.7); r.position.set(x + w / 2 - 0.25, 0.46, z); gr.add(r);
}

function buildProps(type, def, w, d) {
  const gr = new THREE.Group();
  const hw = w / 2, hd = d / 2;
  const c = def.color;
  switch (def.props) {
    case 'cafe': {
      counter(gr, w - 0.6, -hd + 0.55, '#a8714a');
      const em = buildEspressoMachine('#5f8a6a'); em.scale.setScalar(0.7); em.position.set(-hw + 0.7, 0.46, -hd + 0.5); gr.add(em);
      const pc = buildPastryCase(); pc.scale.setScalar(0.7); pc.position.set(0.2, 0.44, -hd + 0.55); gr.add(pc);
      for (const [x, z] of [[-0.75, 0.35], [0.75, 0.35]]) {
        const t = buildFurniture('bistro', { accent: '#e0674f' }); t.scale.setScalar(0.75); t.position.set(x, 0, z); gr.add(t);
        for (const dx of [-0.3, 0.3]) { const ch = buildFurniture('chair', { accent: '#6f9a7a' }); ch.scale.setScalar(0.6); ch.position.set(x + dx, 0, z); ch.rotation.y = dx < 0 ? Math.PI / 2 : -Math.PI / 2; gr.add(ch); }
      }
      break;
    }
    case 'counter': {
      counter(gr, w - 0.5, -hd + 0.6);
      for (let i = 0; i < 3; i++) { const pc = buildPastryCase(); pc.scale.setScalar(0.6); pc.position.set(-0.8 + i * 0.8, 0, 0.1); gr.add(pc); }
      mesh(box(w - 0.4, 0.9, 0.2), mat('#c99569'), 0, 0.45, -hd + 0.15, gr);
      for (let i = 0; i < 6; i++) mesh(sph(0.08, 8), mat(['#e5a84f', '#c9705b', '#f4d28a'][i % 3]), -0.9 + i * 0.36, 0.95, -hd + 0.2, gr).scale.set(1.4, 0.7, 1);
      break;
    }
    case 'flowers': {
      for (let i = 0; i < 5; i++) {
        const p = buildFurniture(i % 2 ? 'flowerbox' : 'plant'); p.scale.setScalar(0.7); p.position.set(-hw + 0.45 + (i % 2) * (w - 0.9), 0, -hd + 0.5 + Math.floor(i / 2) * 0.8); gr.add(p);
      }
      counter(gr, w - 0.8, -hd + 0.45, '#d9d4cc');
      for (let i = 0; i < 4; i++) { const b = buildFurniture('flowerbox'); b.scale.setScalar(0.5); b.position.set(-0.4 + i * 0.27, 0, 0.6); gr.add(b); }
      break;
    }
    case 'racks': {
      for (let r = 0; r < 2; r++) {
        const z = -0.3 + r * 0.9;
        mesh(box(w - 1.2, 0.04, 0.04), mat('#d6d8da', { metalness: 0.6, roughness: 0.3 }), 0, 0.78, z, gr);
        for (const x of [-(w - 1.2) / 2, (w - 1.2) / 2]) mesh(box(0.04, 0.78, 0.04), mat('#d6d8da', { metalness: 0.6 }), x, 0.39, z, gr);
        for (let k = 0; k < 6; k++) mesh(box(0.12, 0.42, 0.24), mat(PROD[(k + r * 3) % PROD.length]), -(w - 1.4) / 2 + k * ((w - 1.4) / 5), 0.55, z, gr);
      }
      counter(gr, 1.3, -hd + 0.45, '#3c3f46');
      mesh(box(0.25, 1.0, 0.25), mat('#fffaf0'), hw - 0.4, 0.5, hd - 0.6, gr);
      mesh(sph(0.12, 10), mat('#fffaf0'), hw - 0.4, 1.12, hd - 0.6, gr);
      break;
    }
    case 'shelves': {
      for (let r = 0; r < Math.max(1, Math.floor(d / 1.3)); r++) shelfRow(gr, -0.25, -hd + 0.6 + r * 1.0, w - 1.2, c, PROD);
      counter(gr, 0.9, hd - 0.7, '#3c3f46', hw - 0.6);
      break;
    }
    case 'books': {
      for (let i = 0; i < 3; i++) shelfRow(gr, 0, -hd + 0.4 + i * 1.0, w - 0.6, '#6b4a33', ['#c9705b', '#3f5f7a', '#6f9a7a', '#f2c14e', '#8a6a52']);
      const a = buildFurniture('armchair', { accent: '#6f9a7a' }); a.scale.setScalar(0.75); a.position.set(hw - 0.55, 0, hd - 0.7); a.rotation.y = -Math.PI / 2; gr.add(a);
      break;
    }
    case 'tables': {
      counter(gr, w - 1, -hd + 0.5, '#7b4f31');
      for (let i = 0; i < 4; i++) {
        const x = -0.85 + (i % 2) * 1.7, z = -0.2 + Math.floor(i / 2) * 1.3;
        const t = buildFurniture('table'); t.scale.setScalar(0.85); t.position.set(x, 0, z); gr.add(t);
        for (const dz of [-0.42, 0.42]) { const ch = buildFurniture('chair', { accent: '#e0674f' }); ch.scale.setScalar(0.7); ch.position.set(x, 0, z + dz); ch.rotation.y = dz < 0 ? 0 : Math.PI; gr.add(ch); }
      }
      break;
    }
    case 'screens': {
      for (let i = 0; i < 4; i++) {
        mesh(box(0.7, 0.42, 0.04), mat('#1b1b22'), -1.2 + i * 0.8, 0.95, -hd + 0.25, gr);
        mesh(box(0.62, 0.34, 0.01), glow(['#8fd4ff', '#ffd34d', '#ff8fb1', '#9dff8a'][i], 0.9), -1.2 + i * 0.8, 0.95, -hd + 0.28, gr);
      }
      for (let i = 0; i < 2; i++) {
        mesh(box(1.3, 0.5, 0.6, 0.03), mat('#e8eef0'), -0.8 + i * 1.6, 0.25, 0.2, gr);
        for (let k = 0; k < 3; k++) mesh(box(0.28, 0.03, 0.2), mat('#2b2d33'), -1.2 + i * 1.6 + k * 0.4, 0.52, 0.2, gr);
      }
      counter(gr, 1.4, hd - 0.7, '#3c3f46');
      break;
    }
    case 'arcade': {
      for (let i = 0; i < 6; i++) {
        const x = -hw + 0.5 + (i % 3) * ((w - 1) / 2), z = -hd + 0.5 + Math.floor(i / 3) * 1.6;
        const cab = new THREE.Group(); cab.position.set(x, 0, z); gr.add(cab);
        const col = ['#9b5de5', '#e0674f', '#5a86c5', '#ffd34d', '#63b2b0', '#ff8fb1'][i];
        mesh(box(0.5, 1.0, 0.45, 0.03), mat(col), 0, 0.5, 0, cab);
        mesh(box(0.38, 0.3, 0.02), glow(['#9dff8a', '#8fd4ff', '#ffd34d'][i % 3], 1.1), 0, 0.75, 0.23, cab);
        mesh(box(0.42, 0.06, 0.2), mat('#2b2d33'), 0, 0.5, 0.28, cab);
        cab.rotation.y = z > 0 ? Math.PI : 0;
      }
      break;
    }
    case 'gym': {
      for (let i = 0; i < 4; i++) {
        const x = -hw + 0.7 + i * ((w - 1.4) / 3);
        mesh(box(0.4, 0.15, 1.0, 0.03), mat('#2b2d33'), x, 0.08, -hd + 0.8, gr);
        mesh(box(0.06, 0.9, 0.06), mat('#d6d8da', { metalness: 0.6 }), x, 0.45, -hd + 0.35, gr);
        mesh(box(0.4, 0.2, 0.05), glow('#9dff8a', 0.6), x, 0.95, -hd + 0.35, gr);
      }
      for (let i = 0; i < 3; i++) {
        mesh(box(0.7, 0.04, 0.04), mat('#d6d8da', { metalness: 0.7 }), -1 + i * 1, 0.45, 0.7, gr);
        for (const s of [-0.35, 0.35]) mesh(cyl(0.12, 0.12, 0.06, 12), mat('#3c3f46'), -1 + i * 1 + s, 0.45, 0.7, gr).rotation.z = Math.PI / 2;
        mesh(box(0.5, 0.08, 1.0), mat('#e0674f'), -1 + i * 1, 0.04, 0.7, gr);
      }
      break;
    }
    case 'foodcourt': {
      for (let i = 0; i < 3; i++) {
        const x = -hw + 0.9 + i * ((w - 1.8) / 2);
        const col = ['#e0674f', '#f2c14e', '#6f9a7a'][i];
        mesh(box(1.3, 0.5, 0.5, 0.03), mat(col), x, 0.25, -hd + 0.5, gr);
        mesh(box(1.3, 0.3, 0.06), mat(shade(col, 0.1)), x, 1.05, -hd + 0.3, gr);
        mesh(box(1.1, 0.18, 0.02), glow('#fffaf0', 0.4), x, 1.05, -hd + 0.34, gr);
      }
      for (let i = 0; i < 6; i++) {
        const x = -1.4 + (i % 3) * 1.4, z = 0.1 + Math.floor(i / 3) * 1.3;
        const t = buildFurniture('roundtable'); t.scale.setScalar(0.8); t.position.set(x, 0, z); gr.add(t);
        for (const dx of [-0.42, 0.42]) { const ch = buildFurniture('stool'); ch.scale.setScalar(0.75); ch.position.set(x + dx, 0, z); gr.add(ch); }
      }
      break;
    }
    case 'market': {
      for (let r = 0; r < 3; r++) shelfRow(gr, -0.4, -hd + 0.6 + r * 1.15, w - 2.0, '#7b8a7a', PROD);
      for (let i = 0; i < 3; i++) counter(gr, 0.7, hd - 0.6, '#3c3f46', hw - 0.6 - i * 0.9);
      mesh(box(0.8, 0.8, 1.6, 0.04), mat('#e8eef0'), hw - 0.55, 0.4, -0.6, gr);
      mesh(box(0.7, 0.05, 1.5), glow('#cfeeff', 0.3), hw - 0.55, 0.82, -0.6, gr);
      for (let i = 0; i < 6; i++) { const cart = mesh(box(0.25, 0.2, 0.35, 0.02), mat('#d6d8da', { metalness: 0.6 }), -hw + 0.4 + i * 0.12, 0.22, hd - 0.4, gr); cart.rotation.y = 0.1; }
      break;
    }
    case 'cinema': {
      mesh(box(w - 0.6, 1.0, 0.06), glow('#e8eef0', 0.5), 0, 1.0, -hd + 0.2, gr);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 7; k++) {
        const seat = mesh(box(0.42, 0.3, 0.38, 0.04), mat('#c9405b'), -1.8 + k * 0.6, 0.15 + r * 0.06, -hd + 1.4 + r * 0.7, gr);
        mesh(box(0.42, 0.25, 0.08), mat('#a33049'), seat.position.x, 0.4 + r * 0.06, seat.position.z + 0.18, gr);
      }
      counter(gr, 2.2, hd - 0.6, '#c9405b');
      mesh(box(0.4, 0.5, 0.4), mat('#fffaf0'), -hw + 0.6, 0.7, hd - 0.6, gr);
      break;
    }
    case 'bowling': {
      for (let l = 0; l < 4; l++) {
        const x = -hw + 0.75 + l * ((w - 1.5) / 3);
        mesh(box(0.7, 0.04, d - 1.2), mat('#e9c38f', { roughness: 0.3 }), x, 0.02, -0.4, gr);
        for (let p = 0; p < 6; p++) mesh(cyl(0.03, 0.05, 0.18, 8), mat('#fffaf0'), x - 0.12 + (p % 3) * 0.12, 0.13, -hd + 0.4 + Math.floor(p / 3) * 0.12, gr);
        mesh(sph(0.1, 10), mat(['#5a86c5', '#e0674f', '#9b5de5', '#6f9a7a'][l]), x, 0.12, hd - 1.2, gr);
      }
      counter(gr, 1.6, hd - 0.5, '#3c3f46');
      break;
    }
    case 'toilets': {
      for (let i = 0; i < 3; i++) mesh(box(0.06, 0.9, 0.6), mat('#e8eef0'), -hw + 0.45 + i * 0.5, 0.45, -hd + 0.4, gr);
      for (let i = 0; i < 3; i++) mesh(box(0.3, 0.3, 0.3, 0.05), mat('#fffaf0'), -hw + 0.7 + i * 0.5, 0.15, -hd + 0.35, gr);
      mesh(box(w - 0.4, 0.4, 0.3), mat('#d9d4cc'), 0, 0.2, 0.6, gr);
      for (let i = 0; i < 2; i++) mesh(cyl(0.1, 0.08, 0.06, 10), mat('#fffaf0'), -0.3 + i * 0.6, 0.43, 0.6, gr);
      break;
    }
    case 'office': default: {
      mesh(box(w - 0.8, 0.4, 0.6, 0.03), mat('#a8714a'), 0, 0.2, -0.2, gr);
      mesh(box(0.4, 0.3, 0.04), mat('#2b2d33'), -0.3, 0.6, -0.3, gr);
      mesh(box(0.34, 0.24, 0.01), glow('#8fd4ff', 0.7), -0.3, 0.6, -0.28, gr);
      const b = buildFurniture('bookshelf'); b.scale.setScalar(0.7); b.position.set(hw - 0.4, 0, -hd + 0.3); gr.add(b);
      const p = buildFurniture('plant'); p.scale.setScalar(0.7); p.position.set(-hw + 0.35, 0, hd - 0.4); gr.add(p);
    }
  }
  return gr;
}

// ---------------------------------------------------------------- the shop unit (world-placed group)
// Units get side & back walls, a glass shopfront with a door gap, a floor tint and a sign.
export function buildUnit(u, opts = {}) {
  const def = UNITS[u.type];
  const { w, d } = footprint(u.type, u.rot);
  const outer = new THREE.Group();
  outer.position.set(u.x + w / 2, 0, u.z + d / 2);
  const gr = new THREE.Group();
  gr.rotation.y = [0, Math.PI / 2, Math.PI, -Math.PI / 2][u.rot];
  outer.add(gr);
  const lw = def.w, ld = def.d, hw = lw / 2, hd = ld / 2;
  const wallC = shade(def.color, 0.18);
  const floor = mesh(box(lw - 0.04, 0.03, ld - 0.04), mat(shade(def.color, 0.32), { roughness: 0.6 }), 0, 0.015, 0, gr);
  floor.castShadow = false;
  const wm = mat(wallC, { roughness: 0.85 });
  const back = mesh(box(lw, WALL_H, 0.1), wm, 0, WALL_H / 2, -hd + 0.05, gr);
  const left = mesh(box(0.1, WALL_H, ld), wm, -hw + 0.05, WALL_H / 2, 0, gr);
  const right = mesh(box(0.1, WALL_H, ld), wm, hw - 0.05, WALL_H / 2, 0, gr);
  // shopfront: pillars + glass, door gap at the centre tile
  const doorX = Math.floor((lw - 1) / 2) + 0.5 - hw;
  const fz = hd - 0.05;
  const glass = mat('#cfeeff', { transparent: true, opacity: 0.25, roughness: 0.05 });
  const frame = mat(shade(def.color, -0.15), { roughness: 0.5 });
  const segs = [[-hw, doorX - 0.45], [doorX + 0.45, hw]];
  for (const [a, b] of segs) {
    if (b - a < 0.05) continue;
    const gm = mesh(box(b - a, WALL_H - 0.35, 0.04), glass, (a + b) / 2, (WALL_H - 0.35) / 2 + 0.05, fz, gr); gm.castShadow = false;
    mesh(box(b - a, 0.08, 0.1), frame, (a + b) / 2, 0.04, fz, gr);
  }
  mesh(box(lw, 0.3, 0.12), frame, 0, WALL_H - 0.15, fz, gr);
  for (const x of [-hw + 0.05, doorX - 0.45, doorX + 0.45, hw - 0.05]) mesh(box(0.08, WALL_H, 0.12), frame, x, WALL_H / 2, fz, gr);
  const sg = sign(gr, def.name, shade(def.color, -0.12), Math.min(lw - 0.3, 2.8), WALL_H + 0.28, fz + 0.03, def.icon);
  // awning
  const aw = mesh(box(lw - 0.2, 0.05, 0.42), mat(def.color), 0, WALL_H - 0.2, fz + 0.24, gr); aw.rotation.x = 0.25;
  const props = buildProps(u.type, def, lw, ld);
  gr.add(props);
  // status light above the door: green open / amber leased / red broken
  const lamp = mesh(sph(0.07, 8), glow('#9dff8a', 1.5), doorX, WALL_H + 0.05, fz + 0.12, gr);
  outer.userData = { unitId: u.id, lamp, back, left, right, sign: sg, props };
  outer.traverse((o) => { o.userData.unitId = u.id; });
  return outer;
}

// ---------------------------------------------------------------- décor
export function buildDecor(type) {
  const gr = new THREE.Group();
  switch (type) {
    case 'bench': {
      mesh(box(0.8, 0.06, 0.3, 0.02), mat('#a8714a'), 0, 0.26, 0, gr);
      mesh(box(0.8, 0.22, 0.05, 0.02), mat('#a8714a'), 0, 0.42, -0.13, gr);
      for (const x of [-0.33, 0.33]) mesh(box(0.05, 0.26, 0.28), mat('#3c3f46'), x, 0.13, 0, gr);
      break;
    }
    case 'bin': {
      mesh(cyl(0.14, 0.12, 0.42, 12), mat('#4f7f6a'), 0, 0.21, 0, gr);
      mesh(cyl(0.15, 0.15, 0.04, 12), mat('#3c3f46'), 0, 0.43, 0, gr);
      break;
    }
    case 'atm': {
      mesh(box(0.5, 0.95, 0.35, 0.03), mat('#3f5f7a'), 0, 0.48, 0, gr);
      mesh(box(0.3, 0.2, 0.02), glow('#8fd4ff', 0.9), 0, 0.68, 0.18, gr);
      mesh(box(0.5, 0.12, 0.36), mat('#f2c14e'), 0, 0.96, 0, gr);
      break;
    }
    case 'vending': {
      mesh(box(0.6, 1.05, 0.45, 0.03), mat('#e0674f'), 0, 0.53, 0, gr);
      mesh(box(0.4, 0.6, 0.02), mat('#cfeeff', { transparent: true, opacity: 0.6 }), -0.05, 0.62, 0.23, gr);
      for (let i = 0; i < 6; i++) mesh(cyl(0.03, 0.03, 0.1, 6), mat(PROD[i]), -0.18 + (i % 3) * 0.12, 0.45 + Math.floor(i / 3) * 0.25, 0.18, gr);
      break;
    }
    case 'info': {
      mesh(cyl(0.42, 0.42, 0.5, 16, 1), mat('#fffaf0'), 0, 0.25, 0, gr);
      mesh(cyl(0.45, 0.45, 0.05, 16), mat('#6f9a7a'), 0, 0.52, 0, gr);
      mesh(box(0.06, 0.6, 0.06), mat('#3c3f46'), 0, 0.85, 0, gr);
      mesh(box(0.34, 0.34, 0.04), mat('#5a86c5'), 0, 1.2, 0, gr);
      mesh(box(0.1, 0.18, 0.05), mat('#fffaf0'), 0, 1.2, 0.01, gr);
      break;
    }
    case 'fountain': {
      mesh(cyl(0.47, 0.5, 0.28, 18), mat('#d9d4cc'), 0, 0.14, 0, gr);
      const water = mesh(cyl(0.42, 0.42, 0.04, 18), mat('#7fc4e8', { roughness: 0.1, emissive: '#2a7fb0', emissiveIntensity: 0.25 }), 0, 0.27, 0, gr); water.castShadow = false;
      mesh(cyl(0.08, 0.1, 0.5, 10), mat('#d9d4cc'), 0, 0.45, 0, gr);
      mesh(cyl(0.2, 0.12, 0.08, 14), mat('#d9d4cc'), 0, 0.7, 0, gr);
      const jet = mesh(cone(0.08, 0.35, 8), mat('#bfe6ff', { transparent: true, opacity: 0.7 }), 0, 0.92, 0, gr); jet.castShadow = false;
      gr.userData.jet = jet;
      break;
    }
    case 'play': {
      mesh(box(0.92, 0.04, 0.92), mat('#7fc4a4'), 0, 0.02, 0, gr);
      const s = mesh(box(0.18, 0.04, 0.7), mat('#ffd34d'), 0.15, 0.32, 0, gr); s.rotation.x = 0.55;
      mesh(box(0.3, 0.55, 0.3), mat('#e0674f'), 0.15, 0.28, -0.35, gr);
      mesh(cone(0.22, 0.25, 4), mat('#5a86c5'), 0.15, 0.68, -0.35, gr).rotation.y = Math.PI / 4;
      for (let i = 0; i < 3; i++) mesh(sph(0.07, 8), mat(PROD[i]), -0.3, 0.07, -0.2 + i * 0.18, gr);
      break;
    }
    case 'lamp': {
      mesh(cyl(0.03, 0.05, 1.35, 8), mat('#3c3f46'), 0, 0.68, 0, gr);
      const bulb = mesh(sph(0.11, 10), glow('#ffe7a8', 1.2), 0, 1.4, 0, gr);
      gr.userData.bulb = bulb;
      break;
    }
    case 'tree': {
      const t = buildTree(Math.random, Math.random() < 0.3 ? 'pine' : 'round'); t.scale.setScalar(0.8); gr.add(t);
      break;
    }
    default: {
      const f = buildFurniture(type); f.scale.setScalar(type === 'bigplant' ? 0.8 : 0.75); gr.add(f);
    }
  }
  return gr;
}

// ---------------------------------------------------------------- instanced crowd
const SKINS = ['#f6d3b3', '#e8b48f', '#c98d66', '#9c6644', '#6e4630', '#f1c7a6'];
const HAIRS = ['#2b1d16', '#5a3a22', '#a4652e', '#e2b25e', '#1b1b22', '#c55a35', '#8f8f99'];
const SHIRTS = ['#e86f5f', '#5a86c5', '#f2c14e', '#7fb77e', '#c58fd9', '#f2f2ee', '#3f5f7a', '#e89ac2', '#63b2b0', '#d98b48'];
const PANTS = ['#3b4a6b', '#5b4636', '#2e2e36', '#6c7a5a', '#8a6a52'];
export const STAFF_SHIRT = { janitor: '#6f9a7a', security: '#2e3b55', technician: '#e89a3a' };

export class Crowd {
  constructor(scene, max = 1600) {
    this.max = max;
    const mk = (geo, m) => { const im = new THREE.InstancedMesh(geo, m, max); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.castShadow = true; im.frustumCulled = false; im.count = 0; scene.add(im); return im; };
    const body = new THREE.BoxGeometry(0.2, 0.24, 0.13); body.translate(0, 0.38, 0);
    const legs = new THREE.BoxGeometry(0.17, 0.25, 0.11); legs.translate(0, 0.125, 0);
    const head = new THREE.SphereGeometry(0.085, 10, 7); head.translate(0, 0.6, 0);
    const hair = new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55); hair.translate(0, 0.615, -0.005);
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 });
    this.parts = [mk(body, white), mk(legs, white.clone()), mk(head, white.clone()), mk(hair, white.clone())];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1); this.p = new THREE.Vector3(); this.e = new THREE.Euler();
    this.col = new THREE.Color();
  }
  look(rng) {
    const pick = (a) => a[(rng() * a.length) | 0];
    return { shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKINS), hair: pick(HAIRS), h: 0.9 + rng() * 0.22, bald: rng() < 0.08 };
  }
  // agents: [{x, z, y?, face, bob, look, scale?}]
  update(agents) {
    const n = Math.min(agents.length, this.max);
    const [body, legs, head, hair] = this.parts;
    for (let i = 0; i < n; i++) {
      const a = agents[i];
      const sc = a.look.h * (a.scale || 1);
      this.e.set(a.tilt || 0, a.face, 0);
      this.q.setFromEuler(this.e);
      this.s.set(sc, sc, sc);
      this.p.set(a.x, (a.y || 0) + Math.abs(Math.sin(a.bob || 0)) * 0.03, a.z);
      this.m.compose(this.p, this.q, this.s);
      body.setMatrixAt(i, this.m); legs.setMatrixAt(i, this.m); head.setMatrixAt(i, this.m);
      if (a.look.bald) { this.s.set(0, 0, 0); this.m.compose(this.p, this.q, this.s); }
      hair.setMatrixAt(i, this.m);
      if (a.colorDirty !== false) {
        body.setColorAt(i, this.col.set(a.look.shirt)); legs.setColorAt(i, this.col.set(a.look.pants));
        head.setColorAt(i, this.col.set(a.look.skin)); hair.setColorAt(i, this.col.set(a.look.hair));
      }
    }
    for (const p of this.parts) {
      p.count = n;
      p.instanceMatrix.needsUpdate = true;
      if (p.instanceColor) p.instanceColor.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- instanced cars
const CAR_COLORS = ['#e0674f', '#5a86c5', '#f2f2ee', '#3c3f46', '#f2c14e', '#7fb77e', '#c58fd9', '#d6d8da', '#9c2f2f', '#2e3b55'];
export class Traffic {
  constructor(scene, max = 500) {
    this.max = max;
    const mk = (geo, m, shadow = true) => { const im = new THREE.InstancedMesh(geo, m, max); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.castShadow = shadow; im.frustumCulled = false; im.count = 0; scene.add(im); return im; };
    const body = new THREE.BoxGeometry(0.5, 0.2, 0.86); body.translate(0, 0.17, 0);
    const cab = new THREE.BoxGeometry(0.42, 0.17, 0.46); cab.translate(0, 0.35, -0.04);
    const wheels = new THREE.BoxGeometry(0.54, 0.13, 0.62); wheels.translate(0, 0.07, 0);
    this.body = mk(body, new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.45, metalness: 0.15 }));
    this.cab = mk(cab, new THREE.MeshStandardMaterial({ color: '#2c3b4d', roughness: 0.15, metalness: 0.3 }));
    this.wheels = mk(wheels, new THREE.MeshStandardMaterial({ color: '#1b1b22', roughness: 0.9 }), false);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1); this.p = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0); this.col = new THREE.Color();
  }
  color(rng) { return CAR_COLORS[(rng() * CAR_COLORS.length) | 0]; }
  update(cars) {
    const n = Math.min(cars.length, this.max);
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      this.q.setFromAxisAngle(this.up, c.face);
      this.s.set(c.bus ? 1.3 : 1, c.bus ? 1.6 : 1, c.bus ? 2.6 : 1);
      this.p.set(c.x, 0, c.z);
      this.m.compose(this.p, this.q, this.s);
      this.body.setMatrixAt(i, this.m); this.cab.setMatrixAt(i, this.m); this.wheels.setMatrixAt(i, this.m);
      this.body.setColorAt(i, this.col.set(c.color));
    }
    for (const p of [this.body, this.cab, this.wheels]) { p.count = n; p.instanceMatrix.needsUpdate = true; if (p.instanceColor) p.instanceColor.needsUpdate = true; }
  }
}

// litter pieces (instanced little scraps)
export class LitterLayer {
  constructor(scene, max = 800) {
    const geo = new THREE.BoxGeometry(0.1, 0.015, 0.07); geo.translate(0, 0.04, 0);
    this.im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.9 }), max);
    this.im.count = 0; this.im.frustumCulled = false; this.max = max;
    scene.add(this.im);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1); this.p = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0); this.col = new THREE.Color();
  }
  update(items) {
    const n = Math.min(items.length, this.max);
    for (let i = 0; i < n; i++) {
      const it = items[i];
      this.q.setFromAxisAngle(this.up, it.r);
      this.p.set(it.x, 0, it.z);
      this.m.compose(this.p, this.q, this.s);
      this.im.setMatrixAt(i, this.m);
      this.im.setColorAt(i, this.col.set(it.c));
    }
    this.im.count = n;
    this.im.instanceMatrix.needsUpdate = true;
    if (this.im.instanceColor) this.im.instanceColor.needsUpdate = true;
  }
}
