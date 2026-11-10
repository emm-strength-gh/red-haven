// Little Cup Café — low-poly three.js model builders (furniture, people, counter props).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const cache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, ...opts }));
  return cache.get(key);
}
export const glow = (color, intensity = 1.4) => mat(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.4 });

const geo = new Map();
const g = (key, make) => { if (!geo.has(key)) geo.set(key, make()); return geo.get(key); };
export const box = (w, h, d, r = 0) => g(`b${w},${h},${d},${r}`, () => (r ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d)));
export const cyl = (rt, rb, h, s = 14) => g(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
export const sph = (r, s = 14) => g(`s${r},${s}`, () => new THREE.SphereGeometry(r, s, Math.max(6, s * 0.7 | 0)));
export const cone = (r, h, s = 10) => g(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));

export function mesh(geometry, material, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

const WOOD = '#a8714a', WOOD_D = '#7b4f31', WOOD_L = '#c99569';
const POT = '#d07f55', LEAF = '#5f9c4f', LEAF_D = '#3f7a3c';

function leg(parent, x, z, h, w = 0.05, color = WOOD_D) { mesh(box(w, h, w), mat(color), x, h / 2, z, parent); }

function flowersOn(parent, y, rng = Math.random) {
  mesh(cyl(0.04, 0.05, 0.1, 8), mat('#e8eef0', { roughness: 0.2 }), 0, y + 0.05, 0, parent);
  const cols = ['#ffd34d', '#ff8fb1', '#ffffff', '#ff9f43'];
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    mesh(sph(0.03, 6), mat(cols[(i + (rng() * 4 | 0)) % 4]), Math.cos(a) * 0.04, y + 0.15 + (i % 2) * 0.02, Math.sin(a) * 0.04, parent);
  }
  mesh(sph(0.035, 6), mat(LEAF), 0, y + 0.12, 0, parent);
}

// every model faces +z (a seat's front is +z), origin at the floor in the tile centre
export function buildFurniture(type, palette = {}) {
  const gr = new THREE.Group();
  const accent = palette.accent || '#5f8a6a';
  switch (type) {
    case 'chair': {
      for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) leg(gr, x, z, 0.3);
      mesh(box(0.4, 0.06, 0.4, 0.02), mat(WOOD), 0, 0.32, 0, gr);
      mesh(box(0.4, 0.34, 0.05, 0.02), mat(WOOD), 0, 0.52, -0.18, gr);
      mesh(box(0.32, 0.03, 0.32, 0.01), mat(accent), 0, 0.36, 0.01, gr);
      break;
    }
    case 'stool': {
      for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) leg(gr, x, z, 0.4, 0.04, '#3c3f46');
      mesh(cyl(0.18, 0.18, 0.06, 16), mat(WOOD_L), 0, 0.42, 0, gr);
      mesh(box(0.28, 0.03, 0.03), mat('#3c3f46'), 0, 0.18, 0.12, gr);
      break;
    }
    case 'armchair': {
      const fab = palette.fabric || '#c9705b';
      mesh(box(0.62, 0.22, 0.56, 0.06), mat(fab), 0, 0.2, 0, gr);
      mesh(box(0.5, 0.08, 0.46, 0.04), mat('#efd8b5'), 0, 0.34, 0.03, gr);
      mesh(box(0.62, 0.42, 0.14, 0.06), mat(fab), 0, 0.44, -0.22, gr);
      for (const s of [-1, 1]) mesh(box(0.11, 0.2, 0.52, 0.04), mat(fab), s * 0.27, 0.38, 0, gr);
      for (const [x, z] of [[-0.25, -0.22], [0.25, -0.22], [-0.25, 0.22], [0.25, 0.22]]) leg(gr, x, z, 0.09, 0.05);
      break;
    }
    case 'sofa': {
      const fab = palette.fabric2 || '#6f9a7a';
      mesh(box(0.9, 0.22, 0.56, 0.06), mat(fab), 0, 0.2, 0, gr);
      for (const s of [-1, 1]) mesh(box(0.38, 0.08, 0.44, 0.04), mat('#f2e4cc'), s * 0.2, 0.34, 0.03, gr);
      mesh(box(0.9, 0.42, 0.14, 0.06), mat(fab), 0, 0.44, -0.22, gr);
      for (const s of [-1, 1]) mesh(box(0.1, 0.22, 0.52, 0.04), mat(fab), s * 0.42, 0.38, 0, gr);
      mesh(box(0.16, 0.16, 0.06, 0.03), mat('#e9a46b'), -0.25, 0.46, -0.12, gr).rotation.z = 0.3;
      break;
    }
    case 'table': {
      for (const [x, z] of [[-0.27, -0.27], [0.27, -0.27], [-0.27, 0.27], [0.27, 0.27]]) leg(gr, x, z, 0.52, 0.06);
      mesh(box(0.72, 0.06, 0.72, 0.02), mat(WOOD_L), 0, 0.55, 0, gr);
      flowersOn(gr, 0.58);
      break;
    }
    case 'roundtable': {
      mesh(cyl(0.05, 0.05, 0.5, 8), mat('#3c3f46'), 0, 0.27, 0, gr);
      mesh(cyl(0.2, 0.24, 0.04, 16), mat('#3c3f46'), 0, 0.02, 0, gr);
      mesh(cyl(0.38, 0.38, 0.05, 24), mat(WOOD_L), 0, 0.55, 0, gr);
      flowersOn(gr, 0.58);
      break;
    }
    case 'bistro': {
      mesh(cyl(0.03, 0.03, 0.55, 8), mat('#2f3a40', { metalness: 0.5 }), 0, 0.29, 0, gr);
      mesh(cyl(0.18, 0.2, 0.03, 14), mat('#2f3a40', { metalness: 0.5 }), 0, 0.02, 0, gr);
      mesh(cyl(0.3, 0.3, 0.04, 20), mat('#f4efe6'), 0, 0.57, 0, gr);
      flowersOn(gr, 0.59);
      break;
    }
    case 'plant': {
      mesh(cyl(0.16, 0.12, 0.26, 12), mat(POT), 0, 0.13, 0, gr);
      mesh(cyl(0.15, 0.15, 0.03, 12), mat('#5b3a26'), 0, 0.26, 0, gr);
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05, l = mesh(sph(0.13, 8), mat(i % 2 ? LEAF : LEAF_D), Math.cos(a) * 0.1, 0.42 + (i % 3) * 0.08, Math.sin(a) * 0.1, gr);
        l.scale.set(1, 0.7, 1);
      }
      break;
    }
    case 'bigplant': {
      mesh(cyl(0.22, 0.17, 0.34, 14), mat('#e9e1d3'), 0, 0.17, 0, gr);
      mesh(box(0.44, 0.04, 0.04), mat('#c9b99f'), 0, 0.26, 0.21, gr);
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7, h = 0.45 + i * 0.07;
        mesh(cyl(0.012, 0.012, h, 5), mat(LEAF_D), Math.cos(a) * 0.05, 0.34 + h / 2, Math.sin(a) * 0.05, gr);
        const lf = mesh(sph(0.16, 8), mat(i % 2 ? '#4f9a4a' : '#3d8541'), Math.cos(a) * 0.2, 0.34 + h, Math.sin(a) * 0.2, gr);
        lf.scale.set(1, 0.25, 0.7); lf.rotation.y = -a; lf.rotation.z = 0.4;
      }
      break;
    }
    case 'flowerbox': {
      mesh(box(0.8, 0.24, 0.34, 0.03), mat(WOOD), 0, 0.12, 0, gr);
      mesh(box(0.74, 0.03, 0.28), mat('#5b3a26'), 0, 0.24, 0, gr);
      const cols = ['#ffffff', '#ffd34d', '#ff8fb1', '#ff7e5f', '#c9a2ff'];
      for (let i = 0; i < 12; i++) {
        const x = -0.32 + (i % 6) * 0.13, z = i < 6 ? -0.07 : 0.07;
        mesh(sph(0.07, 7), mat(LEAF), x, 0.3, z, gr);
        mesh(sph(0.045, 6), mat(cols[i % 5]), x + 0.02, 0.37, z, gr);
      }
      break;
    }
    case 'cactus': {
      mesh(cyl(0.14, 0.11, 0.2, 10), mat('#d9a35b'), 0, 0.1, 0, gr);
      mesh(cyl(0.08, 0.09, 0.42, 10), mat('#5c9b5f'), 0, 0.4, 0, gr);
      mesh(sph(0.08, 10), mat('#5c9b5f'), 0, 0.61, 0, gr);
      const arm = mesh(cyl(0.05, 0.05, 0.18, 8), mat('#5c9b5f'), 0.11, 0.42, 0, gr); arm.rotation.z = -0.9;
      mesh(sph(0.04, 6), mat('#ff8fb1'), 0, 0.69, 0, gr);
      break;
    }
    case 'lamp': {
      mesh(cyl(0.14, 0.16, 0.04, 12), mat('#3c3f46'), 0, 0.02, 0, gr);
      mesh(cyl(0.02, 0.02, 1.0, 6), mat('#3c3f46'), 0, 0.52, 0, gr);
      mesh(cyl(0.12, 0.2, 0.22, 14), mat('#f6dfa9', { emissive: '#ffcc77', emissiveIntensity: 0.6, side: THREE.DoubleSide }), 0, 1.06, 0, gr);
      mesh(sph(0.06, 8), glow('#fff0c4', 2), 0, 0.99, 0, gr);
      gr.userData.light = { y: 1.0, color: '#ffcf80' };
      break;
    }
    case 'lantern': {
      mesh(cyl(0.02, 0.02, 1.1, 6), mat('#2b2d33'), 0, 0.55, 0, gr);
      mesh(box(0.3, 0.03, 0.03), mat('#2b2d33'), 0.13, 1.08, 0, gr);
      const l = mesh(sph(0.13, 12), glow(gr.userData.col = '#ff6b4a', 1.1), 0.24, 0.9, 0, gr); l.scale.y = 1.25;
      mesh(cyl(0.06, 0.06, 0.03, 10), mat('#2b2d33'), 0.24, 1.06, 0, gr);
      gr.userData.light = { y: 0.9, color: '#ff8a5c' };
      break;
    }
    case 'candles': {
      mesh(cyl(0.12, 0.14, 0.04, 12), mat('#8a6a3a', { metalness: 0.4 }), 0, 0.02, 0, gr);
      mesh(cyl(0.025, 0.03, 0.7, 6), mat('#8a6a3a', { metalness: 0.4 }), 0, 0.37, 0, gr);
      for (const x of [-0.12, 0, 0.12]) {
        mesh(cyl(0.03, 0.03, 0.14, 8), mat('#f7efe0'), x, 0.78 + (x ? 0 : 0.05), 0, gr);
        mesh(cone(0.02, 0.06, 6), glow('#ffb347', 2.5), x, 0.88 + (x ? 0 : 0.05), 0, gr);
      }
      mesh(box(0.3, 0.03, 0.05), mat('#8a6a3a', { metalness: 0.4 }), 0, 0.71, 0, gr);
      gr.userData.light = { y: 0.85, color: '#ffb347' };
      break;
    }
    case 'bookshelf': {
      mesh(box(0.82, 1.3, 0.34), mat(WOOD_D), 0, 0.65, -0.04, gr);
      const cols = ['#c9705b', '#5f8a6a', '#e9b95a', '#5a7fb0', '#a86fb0', '#e8dcc4'];
      for (let r = 0; r < 3; r++) {
        mesh(box(0.74, 0.34, 0.3), mat('#5b3a26'), 0, 0.27 + r * 0.4, 0.0, gr);
        let x = -0.33;
        for (let b = 0; x < 0.3; b++) {
          const w = 0.06 + ((r * 7 + b * 3) % 4) * 0.015, h = 0.22 + ((r + b) % 3) * 0.04;
          mesh(box(w, h, 0.22), mat(cols[(r * 5 + b) % cols.length]), x + w / 2, 0.12 + r * 0.4 + h / 2, 0.04, gr);
          x += w + 0.01;
        }
      }
      break;
    }
    case 'rug': {
      const r = mesh(box(0.98, 0.02, 0.98, 0.0), mat(palette.rug || '#d9c49a'), 0, 0.012, 0, gr);
      r.castShadow = false;
      const i = mesh(box(0.78, 0.022, 0.78), mat(palette.rug2 || '#8fae8b'), 0, 0.014, 0, gr); i.castShadow = false;
      const c = mesh(box(0.4, 0.024, 0.4), mat('#e9dcc0'), 0, 0.016, 0, gr); c.castShadow = false; c.rotation.y = Math.PI / 4;
      break;
    }
    case 'umbrella': {
      mesh(cyl(0.16, 0.18, 0.08, 12), mat('#e9e1d3'), 0, 0.04, 0, gr);
      mesh(cyl(0.022, 0.022, 1.45, 6), mat('#f4efe6'), 0, 0.75, 0, gr);
      const segs = 8;
      for (let i = 0; i < segs; i++) {
        const geom = g(`umb${i}`, () => new THREE.ConeGeometry(0.62, 0.3, 2, 1, true, (i / segs) * Math.PI * 2, (Math.PI * 2) / segs));
        const m = mesh(geom, mat(i % 2 ? '#ffffff' : (palette.awning || '#e85d5d'), { side: THREE.DoubleSide }), 0, 1.42, 0, gr);
        m.castShadow = true;
      }
      break;
    }
    case 'fireplace': {
      mesh(box(0.92, 0.95, 0.5), mat('#9a8f86'), 0, 0.475, -0.18, gr);
      for (let i = 0; i < 8; i++) mesh(box(0.22, 0.12, 0.04), mat(i % 2 ? '#857b72' : '#a89d93'), -0.32 + (i % 4) * 0.21, 0.15 + (i >> 2) * 0.65, 0.08, gr);
      mesh(box(0.5, 0.42, 0.06), mat('#2a1d18'), 0, 0.3, 0.07, gr);
      mesh(box(1.02, 0.07, 0.56), mat(WOOD_D), 0, 0.98, -0.16, gr);
      for (const [x, s] of [[-0.08, 0.17], [0.06, 0.22], [0.13, 0.13]]) mesh(cone(0.07, s, 6), glow('#ff9640', 2.2), x, 0.17 + s / 2, 0.05, gr);
      mesh(box(0.4, 0.05, 0.08), mat('#5b3a26'), 0, 0.12, 0.05, gr);
      gr.userData.light = { y: 0.4, color: '#ff8a3c', z: 0.3 };
      break;
    }
    case 'jukebox': {
      mesh(box(0.6, 0.9, 0.44, 0.08), mat('#8b2f3c'), 0, 0.45, -0.04, gr);
      const top = mesh(cyl(0.3, 0.3, 0.44, 16, 1), mat('#8b2f3c'), 0, 0.9, -0.04, gr); top.rotation.x = Math.PI / 2;
      mesh(box(0.44, 0.3, 0.04), glow('#ffd34d', 0.8), 0, 0.62, 0.19, gr);
      for (let i = 0; i < 4; i++) mesh(box(0.06, 0.4, 0.03), glow(['#ff6b8b', '#6be0ff', '#9dff8a', '#ffb347'][i], 1.4), -0.15 + i * 0.1, 0.25, 0.2, gr);
      gr.userData.light = { y: 0.7, color: '#ff7fb0', z: 0.3 };
      break;
    }
    default:
      mesh(box(0.5, 0.5, 0.5), mat('#ff00ff'), 0, 0.25, 0, gr);
  }
  return gr;
}

// ---------------------------------------------------------------- people
export const SKINS = ['#f6d3b3', '#e8b48f', '#c98d66', '#9c6644', '#6e4630', '#f1c7a6'];
export const HAIRS = ['#2b1d16', '#5a3a22', '#a4652e', '#e2b25e', '#1b1b22', '#c55a35', '#8f8f99', '#f0d9a0'];
export const SHIRTS = ['#e86f5f', '#5a86c5', '#f2c14e', '#7fb77e', '#c58fd9', '#f2f2ee', '#3f5f7a', '#e89ac2', '#63b2b0', '#d98b48'];
export const PANTS = ['#3b4a6b', '#5b4636', '#2e2e36', '#6c7a5a', '#8a6a52'];
export const HAIR_STYLES = ['short', 'bun', 'long', 'beanie', 'curly', 'pony', 'cap', 'bald'];

export function randomLook(rng = Math.random) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  return {
    skin: pick(SKINS), hair: pick(HAIRS), style: pick(HAIR_STYLES), shirt: pick(SHIRTS), pants: pick(PANTS),
    hat: pick(SHIRTS), glasses: rng() < 0.3, scale: 0.92 + rng() * 0.14
  };
}

export function buildPerson(look, { apron = null } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.3; body.add(hips);
  const legs = [];
  for (const s of [-1, 1]) {
    const lg = new THREE.Group(); lg.position.set(s * 0.065, 0.3, 0); body.add(lg);
    mesh(box(0.1, 0.28, 0.11, 0.03), mat(look.pants), 0, -0.14, 0, lg);
    mesh(box(0.11, 0.06, 0.16, 0.025), mat('#3a2a22'), 0, -0.28, 0.025, lg);
    legs.push(lg);
  }
  const torso = mesh(box(0.27, 0.3, 0.18, 0.07), mat(look.shirt), 0, 0.15, 0, hips);
  if (apron) mesh(box(0.25, 0.28, 0.02, 0.01), mat(apron), 0, 0.12, 0.095, hips);
  const arms = [];
  for (const s of [-1, 1]) {
    const ar = new THREE.Group(); ar.position.set(s * 0.165, 0.27, 0); hips.add(ar);
    mesh(box(0.08, 0.24, 0.09, 0.035), mat(look.shirt), 0, -0.11, 0, ar);
    mesh(sph(0.045, 8), mat(look.skin), 0, -0.24, 0, ar);
    arms.push(ar);
  }
  const head = new THREE.Group(); head.position.y = 0.53; hips.add(head);
  mesh(sph(0.17, 16), mat(look.skin), 0, 0, 0, head);
  for (const s of [-1, 1]) mesh(sph(0.022, 6), mat('#2a1d18'), s * 0.06, 0.0, 0.158, head);
  for (const s of [-1, 1]) mesh(sph(0.025, 6), mat('#f29a8a'), s * 0.1, -0.05, 0.13, head);
  const smile = mesh(g('smile', () => new THREE.TorusGeometry(0.035, 0.008, 4, 10, Math.PI)), mat('#7a3a2a'), 0, -0.05, 0.16, head);
  smile.rotation.z = Math.PI;
  const hm = mat(look.hair);
  switch (look.style) {
    case 'short': { const h = mesh(sph(0.18, 14), hm, 0, 0.04, -0.02, head); h.scale.set(1, 0.75, 1); break; }
    case 'bun': { const h = mesh(sph(0.18, 14), hm, 0, 0.04, -0.02, head); h.scale.set(1, 0.75, 1); mesh(sph(0.08, 10), hm, 0, 0.18, -0.06, head); break; }
    case 'long': {
      const h = mesh(sph(0.185, 14), hm, 0, 0.03, -0.02, head); h.scale.set(1, 0.8, 1);
      mesh(box(0.34, 0.3, 0.12, 0.05), hm, 0, -0.1, -0.1, head); break;
    }
    case 'pony': {
      const h = mesh(sph(0.18, 14), hm, 0, 0.04, -0.02, head); h.scale.set(1, 0.75, 1);
      const p = mesh(sph(0.07, 8), hm, 0, -0.02, -0.2, head); p.scale.set(0.8, 1.6, 0.8); break;
    }
    case 'curly': for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; mesh(sph(0.075, 8), hm, Math.cos(a) * 0.13, 0.08 + (i % 2) * 0.03, Math.sin(a) * 0.11 - 0.03, head); } mesh(sph(0.1, 8), hm, 0, 0.15, -0.02, head); break;
    case 'beanie': {
      const b = mesh(sph(0.185, 14), mat(look.hat), 0, 0.05, 0, head); b.scale.set(1, 0.78, 1);
      mesh(cyl(0.18, 0.18, 0.05, 16), mat(look.hat), 0, 0.03, 0, head);
      mesh(sph(0.05, 8), mat('#fffaf0'), 0, 0.2, 0, head); break;
    }
    case 'cap': {
      const b = mesh(sph(0.18, 14), mat(look.hat), 0, 0.05, 0, head); b.scale.set(1, 0.7, 1);
      const v = mesh(box(0.2, 0.02, 0.12), mat(look.hat), 0, 0.04, 0.17, head); v.rotation.x = 0.15; break;
    }
    default: break;
  }
  if (look.glasses) {
    for (const s of [-1, 1]) {
      const ring = mesh(g('lens', () => new THREE.TorusGeometry(0.035, 0.007, 4, 12)), mat('#2a2a30'), s * 0.06, 0.0, 0.165, head);
      ring.castShadow = false;
    }
  }
  const cup = new THREE.Group(); cup.visible = false;
  mesh(cyl(0.04, 0.032, 0.08, 10), mat('#fffaf0'), 0, 0, 0, cup);
  mesh(cyl(0.042, 0.042, 0.015, 10), mat('#c98d5a'), 0, 0.045, 0, cup);
  arms[1].add(cup); cup.position.set(0, -0.26, 0.05);
  root.scale.setScalar((look.scale || 1) * 1.22);
  return { root, body, hips, head, legs, arms, cup, torso };
}

// poses: walk(t), idle(t), sit
export function posePerson(p, mode, t) {
  if (mode === 'walk') {
    const s = Math.sin(t * 9);
    p.legs[0].rotation.x = s * 0.6; p.legs[1].rotation.x = -s * 0.6;
    p.arms[0].rotation.x = -s * 0.5; p.arms[1].rotation.x = p.cup.visible ? -0.9 : s * 0.5;
    p.body.position.y = Math.abs(Math.cos(t * 9)) * 0.03;
    p.hips.rotation.z = 0;
  } else if (mode === 'sit') {
    p.legs[0].rotation.x = p.legs[1].rotation.x = -Math.PI / 2;
    p.body.position.y = 0.06;
    p.arms[0].rotation.x = -0.6; p.arms[1].rotation.x = p.cup.visible ? -1.1 : -0.6;
    p.hips.rotation.z = Math.sin(t * 1.3) * 0.02;
  } else if (mode === 'work') {
    p.legs[0].rotation.x = p.legs[1].rotation.x = 0;
    p.arms[0].rotation.x = -1.1 + Math.sin(t * 8) * 0.25; p.arms[1].rotation.x = -1.0 + Math.cos(t * 8) * 0.25;
    p.body.position.y = 0;
  } else {
    p.legs[0].rotation.x = p.legs[1].rotation.x = 0;
    p.arms[0].rotation.x = 0; p.arms[1].rotation.x = p.cup.visible ? -0.9 : 0;
    p.body.position.y = Math.sin(t * 2) * 0.006;
    p.hips.rotation.z = Math.sin(t * 1.1) * 0.03;
  }
}

// ---------------------------------------------------------------- counter props
export function buildEspressoMachine(color = '#5f8a6a') {
  const gr = new THREE.Group();
  mesh(box(0.7, 0.42, 0.42, 0.05), mat(color, { roughness: 0.4 }), 0, 0.21, 0, gr);
  mesh(box(0.72, 0.06, 0.44, 0.02), mat('#d6d8da', { metalness: 0.7, roughness: 0.3 }), 0, 0.45, 0, gr);
  for (const x of [-0.17, 0.17]) {
    mesh(cyl(0.05, 0.05, 0.08, 10), mat('#d6d8da', { metalness: 0.7, roughness: 0.3 }), x, 0.24, 0.24, gr);
    mesh(box(0.03, 0.03, 0.18), mat('#2b2d33'), x, 0.2, 0.34, gr);
  }
  mesh(cyl(0.06, 0.06, 0.02, 14), mat('#fffaf0'), 0, 0.53, 0, gr);
  for (let i = 0; i < 4; i++) mesh(cyl(0.045, 0.035, 0.08, 10), mat('#fffaf0'), -0.18 + i * 0.12, 0.52, -0.08, gr);
  const gauge = mesh(cyl(0.05, 0.05, 0.02, 12), mat('#fffaf0'), 0, 0.33, 0.215, gr); gauge.rotation.x = Math.PI / 2;
  const lamp = mesh(sph(0.025, 8), glow('#9dff8a', 1.6), 0.26, 0.36, 0.215, gr);
  gr.userData.lamp = lamp;
  return gr;
}

export function buildRegister() {
  const gr = new THREE.Group();
  mesh(box(0.34, 0.12, 0.28, 0.03), mat('#3c3f46'), 0, 0.06, 0, gr);
  const s = mesh(box(0.28, 0.2, 0.03, 0.01), mat('#2b2d33'), 0, 0.22, -0.05, gr); s.rotation.x = -0.35;
  const sc = mesh(box(0.23, 0.15, 0.01), glow('#8fd4ff', 0.6), 0, 0.225, -0.032, gr); sc.rotation.x = -0.35;
  return gr;
}

export function buildPastryCase() {
  const gr = new THREE.Group();
  mesh(box(0.86, 0.08, 0.5), mat('#7b4f31'), 0, 0.04, 0, gr);
  const glass = mesh(box(0.84, 0.42, 0.48, 0.04), mat('#cfeeff', { transparent: true, opacity: 0.28, roughness: 0.05 }), 0, 0.29, 0, gr);
  glass.castShadow = false;
  mesh(box(0.8, 0.02, 0.44), mat('#f4efe6'), 0, 0.26, 0, gr);
  const cols = ['#e5a84f', '#f4d28a', '#c9705b', '#8a4a2a', '#ff9ab0'];
  for (let i = 0; i < 10; i++) {
    const p = mesh(sph(0.055, 8), mat(cols[i % 5]), -0.32 + (i % 5) * 0.16, i < 5 ? 0.13 : 0.31, i < 5 ? 0.08 : -0.05, gr);
    p.scale.set(1.3, 0.7, 1);
  }
  return gr;
}

export function buildCupStack() {
  const gr = new THREE.Group();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) mesh(cyl(0.045, 0.035, 0.09, 10), mat('#fffaf0'), -0.06 + j * 0.1 + i * 0.05, 0.05 + i * 0.09, 0, gr);
  return gr;
}

export function buildJar(color) {
  const gr = new THREE.Group();
  mesh(cyl(0.07, 0.07, 0.18, 10), mat('#e8f4f6', { transparent: true, opacity: 0.55, roughness: 0.1 }), 0, 0.09, 0, gr);
  mesh(cyl(0.062, 0.062, 0.12, 10), mat(color), 0, 0.07, 0, gr);
  mesh(cyl(0.075, 0.075, 0.03, 10), mat('#7b4f31'), 0, 0.195, 0, gr);
  return gr;
}

export function buildTree(rng = Math.random, kind = 'round') {
  const gr = new THREE.Group();
  if (kind === 'pine') {
    mesh(cyl(0.08, 0.1, 0.5, 6), mat('#6b4a33'), 0, 0.25, 0, gr);
    for (let i = 0; i < 3; i++) mesh(cone(0.7 - i * 0.17, 0.8, 7), mat(i % 2 ? '#3f6f55' : '#4a7d5f'), 0, 0.7 + i * 0.45, 0, gr);
    mesh(cone(0.28, 0.3, 7), mat('#ffffff'), 0, 1.85, 0, gr);
  } else if (kind === 'palm') {
    const t = mesh(cyl(0.06, 0.1, 1.9, 6), mat('#a07a50'), 0.1, 0.95, 0, gr); t.rotation.z = -0.08;
    for (let i = 0; i < 6; i++) {
      const lf = mesh(box(0.9, 0.03, 0.22), mat(i % 2 ? '#4f9a4a' : '#5fae55'), 0, 1.9, 0, gr);
      lf.rotation.y = (i / 6) * Math.PI * 2; lf.rotation.z = -0.4; lf.translateX(0.4);
    }
  } else {
    mesh(cyl(0.08, 0.11, 0.6, 6), mat('#6b4a33'), 0, 0.3, 0, gr);
    const c = ['#6fa957', '#5e9a4c', '#7fb865'];
    for (let i = 0; i < 4; i++) mesh(sph(0.45 - i * 0.05, 9), mat(c[i % 3]), (rng() - 0.5) * 0.4, 0.85 + i * 0.22, (rng() - 0.5) * 0.4, gr);
  }
  return gr;
}
