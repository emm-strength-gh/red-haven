// Rocket to the Rim — Babylon.js renderer, input and HUD on top of rocket-sim.js.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import { createGame, step, SECTORS, SECTOR_STARTS, TOTAL, FIELD, hasMod, progress, starRating, mulberry32 } from './rocket-sim.js';
import { RocketAudio } from './rocket-audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, true);
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.75));
const scene = new Scene(engine);
scene.clearColor = new Color4(0.45, 0.75, 1, 1);
scene.skipPointerMovePicking = true;
const audio = new RocketAudio();

// ------------------------------------------------------------------ lights & camera
const camera = new FreeCamera('cam', new Vector3(0, 8, -40), scene);
camera.fov = 0.9;
camera.minZ = 0.5;
camera.maxZ = 900;
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, -0.3), scene);
hemi.intensity = 0.8;
hemi.diffuse = new Color3(1, 0.96, 1);
hemi.groundColor = new Color3(0.35, 0.3, 0.75);
hemi.specular = new Color3(0.2, 0.2, 0.25);
const sun = new DirectionalLight('sun', new Vector3(0.45, -0.55, 0.7), scene);
sun.intensity = 1.05;
sun.diffuse = new Color3(1, 0.95, 0.9);
const glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.5, blurKernelSize: 40, ldrMerge: true });
glow.intensity = 0.85;

// ------------------------------------------------------------------ materials & textures
const matCache = new Map();
function mat(hex, o = {}) {
  const key = JSON.stringify([hex, o.e, o.ei, o.alpha, o.add, o.unlit, o.spec, o.double, o.tex?.name]);
  if (matCache.has(key)) return matCache.get(key);
  const m = new StandardMaterial('m' + matCache.size, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(1, 1, 1).scale(o.spec ?? 0.45);
  m.specularPower = o.power ?? 40;
  if (o.e) m.emissiveColor = Color3.FromHexString(o.e).scale(o.ei ?? 1);
  if (o.unlit) { m.disableLighting = true; m.emissiveColor = Color3.FromHexString(o.e ?? hex).scale(o.ei ?? 1); }
  if (o.tex) {
    if (o.unlit) { m.emissiveTexture = o.tex; m.opacityTexture = o.tex; }
    else m.diffuseTexture = o.tex;
  }
  if (o.alpha != null) m.alpha = o.alpha;
  if (o.add) { m.alphaMode = Constants.ALPHA_ADD; m.disableDepthWrite = true; }
  if (o.double) m.backFaceCulling = false;
  matCache.set(key, m);
  return m;
}

/** Mask a texture so it fades to fully transparent before its edges (no visible quad borders). */
function fadeRadial(c, w, h, inner = 0.2) {
  c.globalCompositeOperation = 'destination-in';
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * inner, w / 2, h / 2, Math.min(w, h) / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'source-over';
}
function fadeEdges(c, w, h, edge = 0.18) {
  c.globalCompositeOperation = 'destination-in';
  const v = c.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(edge, 'rgba(0,0,0,1)'); v.addColorStop(1 - edge, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = v; c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'source-over';
}
function dyn(name, w, h, draw, alpha = true) {
  const t = new DynamicTexture(name, { width: w, height: h }, scene, true);
  const ctx = t.getContext();
  draw(ctx, w, h);
  t.hasAlpha = alpha;
  t.update();
  return t;
}
const rnd = mulberry32(1234);

const texFlare = dyn('flare', 64, 64, (c, w) => {
  const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, w, w);
});
const chevrons = (name, rgb, up) => dyn(name, 128, 256, (c, w, h) => {
  const edge = c.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, `rgba(${rgb},0)`); edge.addColorStop(0.25, `rgba(${rgb},.28)`); edge.addColorStop(0.75, `rgba(${rgb},.28)`); edge.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = edge; c.fillRect(0, 0, w, h);
  c.strokeStyle = `rgba(${rgb},.95)`; c.lineWidth = 12; c.lineCap = 'round'; c.lineJoin = 'round';
  for (let y = 32; y < h; y += 64) {
    c.beginPath();
    if (up) { c.moveTo(30, y + 18); c.lineTo(64, y - 14); c.lineTo(98, y + 18); }
    else { c.moveTo(30, y - 18); c.lineTo(64, y + 14); c.lineTo(98, y - 18); }
    c.stroke();
  }
  fadeEdges(c, w, h, 0.12);
});
const softStrip = (name, horizontal) => dyn(name, 64, 64, (c, w, h) => {
  const g = horizontal ? c.createLinearGradient(0, 0, w, 0) : c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
});
const texSoftCol = softStrip('softCol', true);
const texSoftBand = softStrip('softBand', false);
const texCurrent = chevrons('current', '57,230,255', true);
const texDust = chevrons('dust', '255,63,208', false);
const texDisk = dyn('disk', 512, 512, (c, w) => {
  const g = c.createRadialGradient(w / 2, w / 2, w * 0.12, w / 2, w / 2, w / 2);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.08, 'rgba(255,255,230,1)'); g.addColorStop(0.25, 'rgba(255,170,60,.95)');
  g.addColorStop(0.55, 'rgba(255,60,190,.7)'); g.addColorStop(0.8, 'rgba(120,40,255,.35)'); g.addColorStop(1, 'rgba(60,0,120,0)');
  c.fillStyle = g; c.fillRect(0, 0, w, w);
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) { // dark swirl lanes
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 10 + i;
    c.beginPath(); c.arc(w / 2, w / 2, w * (0.18 + i * 0.035), i, i + 2.4); c.stroke();
  }
});
const swirl = (name, a, b) => dyn(name, 256, 256, (c, w) => {
  const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, a); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, w, w);
  c.strokeStyle = b; c.lineWidth = 7;
  for (let arm = 0; arm < 4; arm++) {
    c.beginPath();
    for (let t = 0; t < 1; t += 0.02) {
      const ang = arm * Math.PI / 2 + t * 5, r = t * w * 0.48;
      const x = w / 2 + Math.cos(ang) * r, y = w / 2 + Math.sin(ang) * r;
      t === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke();
  }
});
const texWorm = swirl('worm', 'rgba(57,230,255,.8)', 'rgba(200,255,255,.7)');
const texPortal = swirl('portal', 'rgba(200,120,255,.85)', 'rgba(255,240,255,.8)');
const texEarth = dyn('earth', 1024, 512, (c, w, h) => {
  const sea = c.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0, '#2f7fe0'); sea.addColorStop(0.5, '#1f6fd6'); sea.addColorStop(1, '#2f7fe0');
  c.fillStyle = sea; c.fillRect(0, 0, w, h);
  const r = mulberry32(7);
  for (let k = 0; k < 9; k++) { // continents: clusters of blobs
    const cx = r() * w, cy = h * (0.2 + r() * 0.6);
    for (let i = 0; i < 26; i++) {
      c.fillStyle = r() < 0.75 ? '#4fbf5a' : '#d9c27a';
      c.beginPath(); c.arc(cx + (r() - 0.5) * 170, cy + (r() - 0.5) * 90, 14 + r() * 30, 0, 7); c.fill();
    }
  }
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, w, 26); c.fillRect(0, h - 26, w, 26);
  for (let i = 0; i < 70; i++) { c.globalAlpha = 0.75; c.beginPath(); c.ellipse(r() * w, r() * h, 20 + r() * 50, 8 + r() * 12, 0, 0, 7); c.fill(); }
  c.globalAlpha = 1;
}, false);
const banded = (name, cols) => dyn(name, 256, 256, (c, w, h) => {
  const r = mulberry32(name.length * 31);
  let y = 0;
  while (y < h) { const bh = 10 + r() * 26; c.fillStyle = cols[Math.floor(r() * cols.length)]; c.fillRect(0, y, w, bh); y += bh; }
  c.globalAlpha = 0.25; c.fillStyle = '#fff';
  for (let i = 0; i < 20; i++) { c.beginPath(); c.ellipse(r() * w, r() * h, 20 + r() * 30, 3 + r() * 4, 0, 0, 7); c.fill(); }
  c.globalAlpha = 1;
}, false);
const texSaturn = banded('saturn', ['#e9b97a', '#d89a5a', '#f2d3a0', '#c98a4a']);
const texGiant = banded('giant', ['#8d6bff', '#b48cff', '#6a4ad8', '#d9b8ff']);
const texRedP = banded('redp', ['#ff7a5a', '#e0563c', '#ffa07a']);
const texMoon = dyn('moon', 256, 256, (c, w) => {
  c.fillStyle = '#b8b8c8'; c.fillRect(0, 0, w, w);
  const r = mulberry32(3);
  for (let i = 0; i < 40; i++) { c.fillStyle = r() < 0.5 ? '#9a9aae' : '#cfcfdc'; c.beginPath(); c.arc(r() * w, r() * w, 4 + r() * 18, 0, 7); c.fill(); }
}, false);
const texRings = dyn('rings', 256, 256, (c, w) => {
  for (let i = 0; i < 40; i++) {
    c.strokeStyle = `rgba(${230 - i * 2},${190 - i * 2},${140},${0.25 + (i % 3) * 0.2})`; c.lineWidth = 2.4;
    c.beginPath(); c.arc(w / 2, w / 2, w * 0.3 + i * 2.2, 0, 7); c.stroke();
  }
});
const nebulaTex = (name, rgb) => dyn(name, 256, 256, (c, w) => {
  const r = mulberry32(name.length * 7);
  for (let i = 0; i < 9; i++) {
    const x = w / 2 + (r() - 0.5) * w * 0.5, y = w / 2 + (r() - 0.5) * w * 0.5, rad = w * (0.15 + r() * 0.25);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${rgb},.16)`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.fillRect(0, 0, w, w);
  }
  fadeRadial(c, w, w, 0.05);
});
const texNebP = nebulaTex('nebp', '200,80,255');
const texNebM = nebulaTex('nebm', '255,70,200');
const texNebC = nebulaTex('nebc', '60,200,255');
const texGalaxy = dyn('galaxy', 256, 256, (c, w) => {
  const r = mulberry32(11);
  const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, 'rgba(255,240,255,1)'); g.addColorStop(0.2, 'rgba(255,140,230,.5)'); g.addColorStop(1, 'rgba(80,40,200,0)');
  c.fillStyle = g; c.fillRect(0, 0, w, w);
  for (let i = 0; i < 900; i++) {
    const arm = i % 2, t = r(), ang = arm * Math.PI + t * 6 + (r() - 0.5) * 0.5, rad = t * w * 0.46;
    c.fillStyle = `rgba(255,${200 + r() * 55},255,${0.4 + r() * 0.6})`;
    c.fillRect(w / 2 + Math.cos(ang) * rad, w / 2 + Math.sin(ang) * rad * 0.9, 2, 2);
  }
  fadeRadial(c, w, w, 0.3);
});
const texBalloon = dyn('balloon', 128, 64, (c, w, h) => {
  for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#ff6b5a' : '#fff8f0'; c.fillRect(i * w / 8, 0, w / 8 + 1, h); }
}, false);

// ------------------------------------------------------------------ geometry helpers
const v3 = (x, y, z = 0) => new Vector3(x, y, z);
function part(mesh, parent, m, pos = [0, 0, 0], rot = [0, 0, 0], scale) {
  mesh.material = m;
  mesh.parent = parent;
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  if (scale) mesh.scaling.set(...scale);
  return mesh;
}
/** Extrude a convex 2D outline (x, y) into a slab of the given depth (flat shaded). */
function slab(name, pts, depth) {
  const pos = [], idx = [];
  const n = pts.length, d = depth / 2;
  for (const [x, y] of pts) pos.push(x, y, -d);
  for (const [x, y] of pts) pos.push(x, y, d);
  for (let i = 1; i < n - 1; i++) { idx.push(0, i + 1, i); idx.push(n, n + i, n + i + 1); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, j, n + j, i, n + j, n + i); }
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos; vd.indices = idx;
  const normals = [];
  VertexData.ComputeNormals(pos, idx, normals);
  vd.normals = normals;
  vd.applyToMesh(m);
  m.convertToFlatShadedMesh();
  return m;
}
/** Lumpy low-ish poly rock: an icosphere displaced by smooth noise, flat shaded. */
function rockMesh(name, seed, detail = 2) {
  const m = MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions: detail, flat: true }, scene);
  const pos = m.getVerticesData(VertexBuffer.PositionKind);
  const r = mulberry32(seed);
  const bumps = Array.from({ length: 7 }, () => [v3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(), 0.15 + r() * 0.25]);
  for (let i = 0; i < pos.length; i += 3) {
    const p = v3(pos[i], pos[i + 1], pos[i + 2]).normalize();
    let s = 0.85;
    for (const [dir, amt] of bumps) s += Math.max(0, Vector3.Dot(p, dir)) ** 3 * amt;
    s -= Math.max(0, Vector3.Dot(p, bumps[0][0].scale(-1))) ** 4 * 0.3;
    pos[i] = p.x * s; pos[i + 1] = p.y * s * 0.85; pos[i + 2] = p.z * s;
  }
  m.updateVerticesData(VertexBuffer.PositionKind, pos);
  const normals = [];
  VertexData.ComputeNormals(pos, m.getIndices(), normals);
  m.updateVerticesData(VertexBuffer.NormalKind, normals);
  return m;
}

// ------------------------------------------------------------------ templates
const T = {};
const tplRoot = new TransformNode('templates', scene);
tplRoot.setEnabled(false);
function tpl(name, build) {
  const root = new TransformNode(name, scene);
  build(root);
  root.parent = tplRoot;
  T[name] = root;
  return root;
}
function cloneOf(name, id) {
  const n = T[name].clone(`${name}#${id}`, null);
  n.setEnabled(true);
  return n;
}

const metal = mat('#c9ced8', { spec: 0.8, power: 60 });
const coral = mat('#ff6b5a', { spec: 0.6 });
const white = mat('#fff8f0', { spec: 0.7, power: 64 });

function buildTemplates() {
  for (let i = 0; i < 4; i++) tpl('rock' + i, (r) => {
    part(rockMesh('rk', 40 + i, 2), r, mat(['#6e6478', '#7a6a5c', '#5d566e', '#857664'][i], { spec: 0.15 }));
  });
  for (let i = 0; i < 3; i++) tpl('shard' + i, (r) => {
    const c = ['#b98cff', '#39e6ff', '#ff7ae0'][i];
    part(MeshBuilder.CreatePolyhedron('sh', { type: 1, size: 0.8 }, scene), r, mat(c, { e: c, ei: 0.55, spec: 1, power: 90, alpha: 0.92 }), [0, 0, 0], [0, 0, 0], [0.7, 1.6, 0.7]);
    part(MeshBuilder.CreatePolyhedron('sh2', { type: 1, size: 0.45 }, scene), r, mat(c, { e: c, ei: 0.55, spec: 1, power: 90 }), [0.5, -0.4, 0], [0, 0, 0.5], [0.6, 1.4, 0.6]);
  });
  for (let i = 0; i < 3; i++) tpl('debris' + i, (r) => {
    if (i === 0) {
      part(MeshBuilder.CreateBox('d', { width: 1.4, height: 0.12, depth: 0.9 }, scene), r, metal, [0, 0, 0], [0.3, 0.4, 0.2]);
      part(MeshBuilder.CreateBox('d2', { width: 0.6, height: 0.13, depth: 0.5 }, scene), r, coral, [0.3, 0.08, 0.1], [0.3, 0.4, 0.2]);
    } else if (i === 1) {
      part(MeshBuilder.CreateTorus('d', { diameter: 1.3, thickness: 0.32, tessellation: 18 }, scene), r, metal, [0, 0, 0], [1.2, 0.3, 0]);
      part(MeshBuilder.CreateBox('cut', { width: 0.5, height: 0.5, depth: 0.5 }, scene), r, mat('#8e95a3', { spec: 0.6 }), [0.55, 0, 0]);
    } else {
      part(MeshBuilder.CreateCylinder('d', { height: 1.3, diameter: 0.45, tessellation: 14 }, scene), r, metal, [0, 0, 0], [0.4, 0, 1.1]);
      part(MeshBuilder.CreateBox('fin', { width: 0.9, height: 0.06, depth: 0.5 }, scene), r, mat('#3d6fd8', { e: '#1d3f9a', ei: 0.4 }), [0.2, 0.3, 0], [0.4, 0, 1.1]);
    }
  });
  tpl('junk', (r) => {
    part(MeshBuilder.CreateCylinder('body', { height: 1.3, diameter: 0.75, tessellation: 20 }, scene), r, metal, [0, 0, 0], [0, 0, Math.PI / 2]);
    part(MeshBuilder.CreateCylinder('gold', { height: 0.5, diameter: 0.8, tessellation: 20 }, scene), r, mat('#ffcc4a', { spec: 0.9 }), [0.2, 0, 0], [0, 0, Math.PI / 2]);
    for (const s of [-1, 1]) {
      part(MeshBuilder.CreateBox('panel', { width: 1.5, height: 0.06, depth: 0.85 }, scene), r, mat('#2d5fd8', { e: '#1840a8', ei: 0.35, spec: 1 }), [s * 1.45, 0, 0], [Math.PI / 2, 0, 0]);
      part(MeshBuilder.CreateCylinder('arm', { height: 0.6, diameter: 0.08 }, scene), r, metal, [s * 0.65, 0, 0], [0, 0, Math.PI / 2]);
    }
    part(MeshBuilder.CreateCylinder('dish', { height: 0.25, diameterTop: 0.7, diameterBottom: 0.05, tessellation: 18 }, scene), r, white, [-0.5, -0.55, 0], [Math.PI, 0, 0.3]);
  });
  tpl('meteor', (r) => {
    part(rockMesh('mh', 9, 1), r, mat('#ff8a3a', { e: '#ff5a1a', ei: 0.9, spec: 0.2 }));
    part(MeshBuilder.CreateCylinder('tail', { height: 4, diameterTop: 1.4, diameterBottom: 0.1, tessellation: 16 }, scene), r, mat('#ffb04a', { e: '#ff7a2a', unlit: true, alpha: 0.55, add: true }), [0, 2.2, 0]);
  });
  tpl('comet', (r) => {
    part(rockMesh('ch', 19, 1), r, mat('#dff6ff', { e: '#7ad8ff', ei: 0.7 }));
    part(MeshBuilder.CreateCylinder('tail', { height: 7, diameterTop: 2.2, diameterBottom: 0.2, tessellation: 18 }, scene), r, mat('#7ae8ff', { e: '#39e6ff', unlit: true, alpha: 0.45, add: true }), [0, 3.8, 0]);
  });
  tpl('bird', (r) => {
    part(MeshBuilder.CreateSphere('b', { diameter: 0.5, segments: 10 }, scene), r, white, [0, 0, 0], [0, 0, 0], [0.8, 0.8, 1.4]);
    part(MeshBuilder.CreateCylinder('beak', { height: 0.2, diameterTop: 0, diameterBottom: 0.12, tessellation: 8 }, scene), r, mat('#ffb03a'), [0, 0.2, 0]);
    for (const s of ['L', 'R']) {
      const w = part(MeshBuilder.CreateBox('wing' + s, { width: 0.7, height: 0.04, depth: 0.3 }, scene), r, mat('#e8e4f4'), [s === 'L' ? -0.35 : 0.35, 0, 0]);
      w.setPivotPoint(v3(s === 'L' ? 0.35 : -0.35, 0, 0));
    }
  });
  tpl('balloon', (r) => {
    part(MeshBuilder.CreateSphere('bl', { diameter: 1.5, segments: 20 }, scene), r, mat('#ffffff', { tex: texBalloon, spec: 0.8 }), [0, 0.3, 0], [0, 0, 0], [1, 1.15, 1]);
    part(MeshBuilder.CreateCylinder('str', { height: 0.8, diameter: 0.03 }, scene), r, white, [0, -0.75, 0]);
    part(MeshBuilder.CreateBox('box', { size: 0.3 }, scene), r, mat('#8a5a36'), [0, -1.2, 0]);
  });
  tpl('jet', (r) => {
    part(MeshBuilder.CreateCylinder('fus', { height: 2.6, diameter: 0.5, tessellation: 16 }, scene), r, white, [0, 0, 0], [0, 0, Math.PI / 2]);
    part(MeshBuilder.CreateCylinder('nose', { height: 0.5, diameterTop: 0, diameterBottom: 0.5, tessellation: 16 }, scene), r, coral, [1.55, 0, 0], [0, 0, -Math.PI / 2]);
    part(MeshBuilder.CreateBox('wing', { width: 0.8, height: 0.06, depth: 2.6 }, scene), r, white, [0, 0, 0]);
    part(MeshBuilder.CreateBox('tail', { width: 0.5, height: 0.7, depth: 0.06 }, scene), r, coral, [-1.1, 0.35, 0]);
  });
  tpl('cloudlet', (r) => {
    const m = mat('#f4efff', { spec: 0.05, e: '#3a2a7a', ei: 0.25 });
    for (const [x, y, s] of [[0, 0, 1.1], [0.7, 0.1, 0.8], [-0.7, 0, 0.85], [0.2, 0.45, 0.75]]) part(MeshBuilder.CreateSphere('c', { diameter: 1, segments: 12 }, scene), r, m, [x, y, 0], [0, 0, 0], [s, s * 0.85, s]);
  });
  tpl('storm', (r) => {
    const m = mat('#6b4ec8', { spec: 0.1, e: '#2a1670', ei: 0.4 });
    const m2 = mat('#8a6ae0', { spec: 0.1, e: '#3a1f90', ei: 0.35 });
    const rr = mulberry32(5);
    for (let i = 0; i < 9; i++) {
      const s = 1.2 + rr() * 1.2;
      part(MeshBuilder.CreateIcoSphere('c', { radius: 1, subdivisions: 2, flat: true }, scene), r, i % 2 ? m : m2, [(rr() - 0.5) * 2, (rr() - 0.5) * 0.8, rr() * 0.6], [0, rr() * 3, 0], [s, s * 0.7, s]);
    }
  });
  tpl('ring', (r) => {
    part(MeshBuilder.CreateTorus('t', { diameter: 2.5, thickness: 0.2, tessellation: 40 }, scene), r, mat('#39e6ff', { e: '#39e6ff', ei: 1, unlit: true }), [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(MeshBuilder.CreateDisc('in', { radius: 1.15, tessellation: 32 }, scene), r, mat('#39e6ff', { e: '#39e6ff', unlit: true, alpha: 0.12, add: true, double: true }));
  });
  tpl('fuel', (r) => {
    part(MeshBuilder.CreateCylinder('bat', { height: 1.1, diameter: 0.65, tessellation: 24 }, scene), r, mat('#ffd23f', { e: '#ffb000', ei: 0.45, spec: 0.9 }));
    part(MeshBuilder.CreateCylinder('cap', { height: 0.18, diameter: 0.32, tessellation: 16 }, scene), r, mat('#3a2f2a'), [0, 0.63, 0]);
    part(slab('bolt', [[0.05, 0.35], [-0.2, -0.02], [0.02, -0.02], [-0.05, -0.35], [0.2, 0.05], [-0.02, 0.05]].reverse(), 0.06), r, mat('#fff8f0', { e: '#ffffff', ei: 0.6 }), [0, 0, -0.33]);
  });
  tpl('repair', (r) => {
    part(MeshBuilder.CreateCylinder('hex', { height: 0.35, diameter: 1.15, tessellation: 6 }, scene), r, mat('#39e6ff', { e: '#18a8d8', ei: 0.6, spec: 1 }), [0, 0, 0], [Math.PI / 2, 0, Math.PI / 6]);
    part(MeshBuilder.CreateBox('p1', { width: 0.55, height: 0.16, depth: 0.1 }, scene), r, white, [0, 0, -0.2]);
    part(MeshBuilder.CreateBox('p2', { width: 0.16, height: 0.55, depth: 0.1 }, scene), r, white, [0, 0, -0.2]);
  });
  tpl('cool', (r) => {
    part(MeshBuilder.CreatePolyhedron('ice', { type: 1, size: 0.55 }, scene), r, mat('#bfefff', { e: '#5ac8ff', ei: 0.6, spec: 1, power: 90, alpha: 0.9 }), [0, 0, 0], [0, 0, 0], [0.9, 1.3, 0.9]);
  });
  tpl('shield', (r) => {
    part(MeshBuilder.CreateSphere('s', { diameter: 1, segments: 20 }, scene), r, mat('#39e6ff', { e: '#39e6ff', ei: 0.7, alpha: 0.65 }));
    part(MeshBuilder.CreateTorus('o', { diameter: 1.5, thickness: 0.07, tessellation: 32 }, scene), r, mat('#ffffff', { e: '#bff8ff', unlit: true }), [0, 0, 0], [1.2, 0, 0.3]);
  });
  tpl('current', (r) => {
    part(MeshBuilder.CreatePlane('z', { width: 1, height: 1 }, scene), r, mat('#39e6ff', { tex: texCurrent, unlit: true, add: true, double: true, e: '#39e6ff' }), [0, 0, 0.5]);
  });
  tpl('dust', (r) => {
    part(MeshBuilder.CreatePlane('z', { width: 1, height: 1 }, scene), r, mat('#ff3fd0', { tex: texDust, unlit: true, add: true, double: true, e: '#ff3fd0' }), [0, 0, 0.5]);
    const pm = mat('#d070ff', { e: '#8a2aa8', ei: 0.4, spec: 0.1 });
    const rr = mulberry32(8);
    for (let i = 0; i < 14; i++) part(MeshBuilder.CreateIcoSphere('p', { radius: 0.05 + rr() * 0.04, subdivisions: 0 }, scene), r, pm, [(rr() - 0.5) * 0.9, (rr() - 0.5) * 0.9, -0.1]);
  });
  tpl('planet', (r) => {
    part(MeshBuilder.CreateSphere('p', { diameter: 2, segments: 40 }, scene), r, mat('#ffffff', { tex: texSaturn, spec: 0.3 }));
  });
  tpl('blackhole', (r) => {
    part(MeshBuilder.CreateDisc('disk', { radius: 1, tessellation: 64 }, scene), r, mat('#ffffff', { tex: texDisk, unlit: true, add: true, double: true, e: '#ffffff' }), [0, 0, 0.3], [0.9, 0, 0]);
    part(MeshBuilder.CreateSphere('core', { diameter: 2, segments: 32 }, scene), r, mat('#000000', { unlit: true, e: '#000000' }));
    part(MeshBuilder.CreateTorus('photon', { diameter: 2.15, thickness: 0.08, tessellation: 48 }, scene), r, mat('#ffe6a8', { e: '#ffcf70', unlit: true }), [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(MeshBuilder.CreateTorus('pull', { diameter: 2, thickness: 0.015, tessellation: 64 }, scene), r, mat('#ff3fd0', { e: '#ff3fd0', unlit: true, alpha: 0.5, add: true }), [0, 0, 0], [Math.PI / 2, 0, 0]);
  });
  tpl('wormhole', (r) => {
    part(MeshBuilder.CreateTorus('t', { diameter: 3.2, thickness: 0.3, tessellation: 48 }, scene), r, mat('#39e6ff', { e: '#39e6ff', unlit: true }), [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(MeshBuilder.CreateDisc('sw', { radius: 1.5, tessellation: 48 }, scene), r, mat('#ffffff', { tex: texWorm, unlit: true, add: true, double: true, e: '#ffffff' }));
  });
  tpl('portal', (r) => {
    part(MeshBuilder.CreateTorus('t', { diameter: 13, thickness: 0.7, tessellation: 64 }, scene), r, mat('#ffffff', { e: '#e6b8ff', unlit: true }), [0, 0, 0], [Math.PI / 2, 0, 0]);
    part(MeshBuilder.CreateDisc('sw', { radius: 6.4, tessellation: 64 }, scene), r, mat('#ffffff', { tex: texPortal, unlit: true, add: true, double: true, e: '#ffffff' }));
  });
  for (const role of ['friendly', 'hostile']) tpl('uap_' + role, (r) => {
    const friendly = role === 'friendly';
    const hull = friendly ? '#6fe0b8' : '#9a4adf';
    const lightC = friendly ? '#ffe66a' : '#ff3fd0';
    const profile = [v3(0, -0.35), v3(0.9, -0.3), v3(1.55, -0.05), v3(1.6, 0.05), v3(1.1, 0.2), v3(0.6, 0.28), v3(0, 0.3)];
    part(MeshBuilder.CreateLathe('hull', { shape: profile, tessellation: 40 }, scene), r, mat(hull, { spec: 0.9, power: 70 }));
    part(MeshBuilder.CreateTorus('band', { diameter: 3.1, thickness: 0.12, tessellation: 40 }, scene), r, mat(friendly ? '#2fa88a' : '#5a1f9a', { spec: 0.6 }), [0, 0, 0]);
    part(MeshBuilder.CreateSphere('dome', { diameter: 1.25, segments: 24, slice: 0.5 }, scene), r, mat('#9ff4ff', { e: '#39b8e0', ei: 0.35, alpha: 0.5, spec: 1, power: 100 }), [0, 0.28, 0]);
    // the pilot
    const head = friendly ? '#7cf06a' : '#4a2a7a';
    part(MeshBuilder.CreateSphere('head', { diameter: 0.6, segments: 16 }, scene), r, mat(head, { spec: 0.5 }), [0, 0.5, 0]);
    for (const s of [-1, 1]) {
      part(MeshBuilder.CreateSphere('eye', { diameter: 0.2, segments: 10 }, scene), r, mat('#1a0f3d', { spec: 1 }), [s * 0.12, 0.55, -0.24], [0, 0, 0], friendly ? [1, 1.2, 0.6] : [1.3, 0.6, 0.6]);
      part(MeshBuilder.CreateSphere('glint', { diameter: 0.06, segments: 6 }, scene), r, mat('#ffffff', { unlit: true }), [s * 0.12 + 0.03, 0.6, -0.32]);
      if (!friendly) part(MeshBuilder.CreateBox('brow', { width: 0.2, height: 0.04, depth: 0.04 }, scene), r, mat('#ff3fd0', { e: '#ff3fd0', unlit: true }), [s * 0.12, 0.68, -0.27], [0, 0, s * 0.45]);
      part(MeshBuilder.CreateCylinder('ant', { height: 0.5, diameter: 0.04 }, scene), r, metal, [s * 0.18, 0.95, 0], [0, 0, -s * 0.3]);
      part(MeshBuilder.CreateSphere('bulb', { diameter: 0.13, segments: 8 }, scene), r, mat(lightC, { e: lightC, unlit: true }), [s * 0.26, 1.2, 0]);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      part(MeshBuilder.CreateSphere('light', { diameter: 0.22, segments: 10 }, scene), r, mat(lightC, { e: lightC, unlit: true }), [Math.cos(a) * 1.3, -0.08, Math.sin(a) * 1.3]);
    }
    if (!friendly) {
      part(MeshBuilder.CreateCylinder('beam', { height: 1, diameterTop: 1.6, diameterBottom: 3.6, tessellation: 32, cap: Mesh.NO_CAP }, scene), r, mat('#ff3fd0', { e: '#ff3fd0', unlit: true, alpha: 0.3, add: true, double: true }), [0, -6.3, 0], [0, 0, 0], [1, 12, 1]);
      part(MeshBuilder.CreateCylinder('scan', { height: 1, diameterTop: 0.3, diameterBottom: 1.8, tessellation: 20, cap: Mesh.NO_CAP }, scene), r, mat('#ff7ae6', { e: '#ff7ae6', unlit: true, alpha: 0.35, add: true, double: true }), [0, -7.3, 0], [0, 0, 0], [1, 14, 1]);
    }
  });
  tpl('warn', (r) => {
    part(MeshBuilder.CreatePlane('col', { width: 2.2, height: 1 }, scene), r, mat('#ff3fd0', { tex: texSoftCol, e: '#ff3fd0', unlit: true, alpha: 0.5, add: true, double: true }));
  });
  tpl('band', (r) => {
    part(MeshBuilder.CreatePlane('h', { width: 1, height: 2 }, scene), r, mat('#ff3fd0', { tex: texSoftBand, e: '#ff3fd0', unlit: true, alpha: 0.5, add: true, double: true }));
  });
}
buildTemplates();

// ------------------------------------------------------------------ the rocket
const rocket = new TransformNode('rocket', scene);
const rocketBody = new TransformNode('rocketBody', scene);
rocketBody.parent = rocket;
rocketBody.scaling.setAll(1.25);
(function buildRocket() {
  const body = [v3(0, -1.0), v3(0.38, -1.0), v3(0.5, -0.7), v3(0.56, -0.2), v3(0.55, 0.3), v3(0.5, 0.75), v3(0.44, 0.95)];
  part(MeshBuilder.CreateLathe('hullR', { shape: body, tessellation: 40, cap: Mesh.CAP_START }, scene), rocketBody, white);
  const nose = [v3(0.445, 0.94), v3(0.4, 1.15), v3(0.3, 1.4), v3(0.16, 1.62), v3(0, 1.72)];
  part(MeshBuilder.CreateLathe('noseR', { shape: nose, tessellation: 40 }, scene), rocketBody, coral);
  part(MeshBuilder.CreateTorus('stripe', { diameter: 1.12, thickness: 0.09, tessellation: 40 }, scene), rocketBody, coral, [0, -0.45, 0]);
  part(MeshBuilder.CreateTorus('rim', { diameter: 0.5, thickness: 0.09, tessellation: 32 }, scene), rocketBody, mat('#e8e2f0', { spec: 1, power: 80 }), [0, 0.35, -0.5], [Math.PI / 2, 0, 0]);
  part(MeshBuilder.CreateSphere('window', { diameter: 0.42, segments: 24 }, scene), rocketBody, mat('#39b8ff', { e: '#1c7fd8', ei: 0.6, spec: 1, power: 120 }), [0, 0.35, -0.47], [0, 0, 0], [1, 1, 0.5]);
  part(MeshBuilder.CreateLathe('nozzle', { shape: [v3(0.22, -0.98), v3(0.3, -1.15), v3(0.38, -1.32)], tessellation: 32, sideOrientation: Mesh.DOUBLESIDE }, scene), rocketBody, mat('#5a5470', { spec: 0.8 }));
  const finPts = [[0, 0.35], [0, -0.5], [0.62, -0.85], [0.58, -0.2]];
  for (const [rot, x, z] of [[0, 0.48, 0], [Math.PI, -0.48, 0], [-Math.PI / 2, 0, -0.48], [Math.PI / 2, 0, 0.48]]) {
    const f = part(slab('fin', x < 0 ? finPts.map(([a, b]) => [a, b]) : finPts, 0.1), rocketBody, coral, [x, -0.5, z], [0, rot, 0]);
    if (x < 0) f.rotation.y = Math.PI;
  }
})();
const flameMesh = part(MeshBuilder.CreateCylinder('flame', { height: 1.6, diameterTop: 0.55, diameterBottom: 0, tessellation: 24 }, scene), rocketBody, mat('#ffb347', { e: '#ff8a1a', unlit: true, alpha: 0.85, add: true }), [0, -2.05, 0]);
const flameCore = part(MeshBuilder.CreateCylinder('flameCore', { height: 1.0, diameterTop: 0.32, diameterBottom: 0, tessellation: 20 }, scene), rocketBody, mat('#fff4c0', { e: '#ffffff', unlit: true, add: true }), [0, -1.8, 0]);
const shieldBubble = part(MeshBuilder.CreateSphere('bubble', { diameter: 4, segments: 32 }, scene), rocket, mat('#39e6ff', { e: '#39e6ff', ei: 0.5, alpha: 0.18, add: true }), [0, 0.3, 0]);
shieldBubble.isVisible = false;
const nozzleEmitter = MeshBuilder.CreateBox('emit', { size: 0.1 }, scene);
nozzleEmitter.parent = rocketBody;
nozzleEmitter.position.y = -1.4;
nozzleEmitter.isVisible = false;

// launch pad
const pad = new TransformNode('pad', scene);
part(MeshBuilder.CreateCylinder('padBase', { height: 0.6, diameter: 6, tessellation: 40 }, scene), pad, mat('#8e8aa8', { spec: 0.3 }), [0, -2.2, 0]);
part(MeshBuilder.CreateCylinder('padTop', { height: 0.2, diameter: 3.4, tessellation: 40 }, scene), pad, mat('#ffd23f', { spec: 0.5 }), [0, -1.85, 0]);
part(MeshBuilder.CreateBox('tower', { width: 0.6, height: 6, depth: 0.6 }, scene), pad, mat('#ff6b5a', { spec: 0.4 }), [-2.3, 1, 0.4]);
for (let i = 0; i < 4; i++) part(MeshBuilder.CreateBox('arm', { width: 1.3, height: 0.12, depth: 0.2 }, scene), pad, metal, [-1.55, -0.4 + i * 1.3, 0.4]);

// ------------------------------------------------------------------ particles
function particles(name, cap, o) {
  const ps = new ParticleSystem(name, cap, scene);
  ps.particleTexture = texFlare;
  ps.blendMode = o.blend ?? ParticleSystem.BLENDMODE_ADD;
  ps.emitter = o.emitter;
  ps.minEmitBox = o.box?.[0] ?? v3(-0.1, 0, -0.1);
  ps.maxEmitBox = o.box?.[1] ?? v3(0.1, 0, 0.1);
  ps.direction1 = o.d1; ps.direction2 = o.d2;
  ps.color1 = o.c1; ps.color2 = o.c2; ps.colorDead = o.dead ?? new Color4(0, 0, 0, 0);
  ps.minSize = o.size[0]; ps.maxSize = o.size[1];
  ps.minLifeTime = o.life[0]; ps.maxLifeTime = o.life[1];
  ps.minEmitPower = o.power[0]; ps.maxEmitPower = o.power[1];
  ps.emitRate = o.rate ?? 100;
  ps.updateSpeed = 1 / 60;
  if (o.gravity) ps.gravity = o.gravity;
  return ps;
}
const exhaust = particles('exhaust', 900, {
  emitter: nozzleEmitter, d1: v3(-0.35, -1, -0.2), d2: v3(0.35, -1, 0.2),
  c1: new Color4(1, 0.75, 0.3, 1), c2: new Color4(1, 0.4, 0.2, 1), dead: new Color4(0.6, 0.2, 0.6, 0),
  size: [0.35, 0.9], life: [0.18, 0.42], power: [6, 12], rate: 0
});
exhaust.start();
const smoke = particles('smoke', 600, {
  emitter: v3(0, -2, 0), box: [v3(-1.5, 0, -0.5), v3(1.5, 0, 0.5)], d1: v3(-4, 0.4, -0.5), d2: v3(4, 1.2, 0.5),
  c1: new Color4(1, 1, 1, 0.7), c2: new Color4(0.9, 0.85, 1, 0.6), dead: new Color4(0.8, 0.7, 1, 0),
  size: [1.2, 2.8], life: [1.2, 2.6], power: [1, 4], rate: 0, blend: ParticleSystem.BLENDMODE_STANDARD
});
smoke.start();
const speedLines = particles('lines', 300, {
  emitter: v3(0, 0, 0), box: [v3(-18, 26, -2), v3(18, 30, 6)], d1: v3(0, -1, 0), d2: v3(0, -1, 0),
  c1: new Color4(0.7, 0.95, 1, 0.8), c2: new Color4(1, 1, 1, 0.6), size: [0.08, 0.16], life: [0.5, 0.8], power: [60, 90], rate: 0
});
speedLines.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
speedLines.start();
function burst(pos, c1, c2, n = 60, power = 8, size = [0.25, 0.8]) {
  const ps = particles('burst', n, { emitter: pos.clone(), box: [v3(-0.2, -0.2, -0.2), v3(0.2, 0.2, 0.2)], d1: v3(-1, -1, -1), d2: v3(1, 1, 1), c1, c2, size, life: [0.3, 0.8], power: [power * 0.4, power], rate: 0 });
  ps.manualEmitCount = n;
  ps.targetStopDuration = 0.9;
  ps.disposeOnStop = true;
  ps.start();
}

// ------------------------------------------------------------------ backdrop
const sky = [ // clear colours along the climb (top of each sector)
  [0.44, 0.76, 1], [0.16, 0.09, 0.42], [0.12, 0.06, 0.36], [0.13, 0.05, 0.3], [0.06, 0.03, 0.2], [0.2, 0.06, 0.35]
];
const earth = MeshBuilder.CreateSphere('earth', { diameter: 220, segments: 64 }, scene);
earth.material = mat('#ffffff', { tex: texEarth, spec: 0.25 });
earth.position.set(0, -118, 70);
earth.rotation.set(0.25, 0, 0.1);
const atmo = MeshBuilder.CreateSphere('atmo', { diameter: 228, segments: 48 }, scene);
atmo.material = mat('#7ad8ff', { e: '#7ad8ff', unlit: true, alpha: 0.18, add: true });
atmo.position.copyFrom(earth.position);

function starLayer(n, size, seed) {
  const r = mulberry32(seed);
  const m = new Mesh('stars' + seed, scene);
  const pos = [], col = [];
  for (let i = 0; i < n; i++) {
    pos.push((r() - 0.5) * 320, r() * 300, 120 + r() * 140);
    const t = r();
    col.push(0.8 + t * 0.2, 0.8 + (1 - t) * 0.2, 1, 1);
  }
  const vd = new VertexData();
  vd.positions = pos; vd.colors = col;
  vd.applyToMesh(m);
  m.isUnIndexed = true;
  const sm = new StandardMaterial('starMat' + seed, scene);
  sm.disableLighting = true;
  sm.emissiveColor = new Color3(1, 1, 1);
  sm.pointsCloud = true;
  sm.pointSize = size;
  m.material = sm;
  m.alwaysSelectAsActiveMesh = true;
  return [m, m.clone('stars' + seed + 'b')];
}
const starTiles = [...starLayer(700, 2.2, 1), ...starLayer(260, 3.6, 2)];
// The glow pass draws points without setting gl_PointSize; phone GPUs (notably Apple) then
// draw each star as a huge square and the whole screen washes out white. Keep stars out of it.
starTiles.forEach((m) => glow.addExcludedMesh(m));

// distant scenery, placed once along the whole climb (far z = natural parallax)
const decor = [];
function deco(mesh, x, y, z, spin = 0) { mesh.position.set(x, y, z); decor.push({ mesh, spin }); return mesh; }
(function placeDecor() {
  const r = mulberry32(99);
  const cloudM = mat('#ffffff', { spec: 0.05, e: '#b8a8ff', ei: 0.25 });
  for (let i = 0; i < 26; i++) { // fluffy clouds in the low atmosphere
    const c = new TransformNode('cloud' + i, scene);
    const n = 4 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) { const s = 2 + r() * 2.5; part(MeshBuilder.CreateSphere('cs', { diameter: 1, segments: 12 }, scene), c, cloudM, [(k - n / 2) * 1.8, r() * 1.2, r() * 2], [0, 0, 0], [s, s * 0.7, s]); }
    deco(c, (r() < 0.5 ? -1 : 1) * (8 + r() * 20), 10 + r() * 520, 18 + r() * 40);
  }
  const moon = deco(MeshBuilder.CreateSphere('moon', { diameter: 46, segments: 48 }, scene), -70, SECTOR_STARTS[1] + 260, 230, 0.02);
  moon.material = mat('#ffffff', { tex: texMoon, spec: 0.1 });
  const sat = deco(new TransformNode('saturn', scene), 80, SECTOR_STARTS[2] + 250, 260, 0);
  part(MeshBuilder.CreateSphere('s', { diameter: 60, segments: 48 }, scene), sat, mat('#ffffff', { tex: texSaturn, spec: 0.2 }));
  part(MeshBuilder.CreateDisc('r', { radius: 66, tessellation: 64 }, scene), sat, mat('#ffffff', { tex: texRings, unlit: true, double: true, e: '#ffe8c8', add: true }), [0, 0, 0], [1.25, 0, 0.3]);
  deco(MeshBuilder.CreateSphere('giant', { diameter: 90, segments: 48 }, scene), -95, SECTOR_STARTS[2] + 600, 300, 0.01).material = mat('#ffffff', { tex: texGiant, spec: 0.2 });
  deco(MeshBuilder.CreateSphere('redp', { diameter: 26, segments: 32 }, scene), 55, SECTOR_STARTS[2] + 820, 200, 0.03).material = mat('#ffffff', { tex: texRedP, spec: 0.2 });
  const mother = deco(new TransformNode('mother', scene), 70, SECTOR_STARTS[3] + 420, 240, 0);
  part(MeshBuilder.CreateLathe('mh', { shape: [v3(0, -6), v3(30, -3), v3(42, 0), v3(28, 4), v3(0, 6)], tessellation: 48 }, scene), mother, mat('#3a2470', { spec: 0.6, e: '#1a0f3d', ei: 0.5 }), [0, 0, 0], [0.25, 0, 0.12]);
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; part(MeshBuilder.CreateSphere('ml', { diameter: 2.4, segments: 8 }, scene), mother, mat('#ff3fd0', { e: '#ff3fd0', unlit: true }), [Math.cos(a) * 36, 0, Math.sin(a) * 36]); }
  const nebs = [texNebP, texNebM, texNebC];
  for (let i = 0; i < 22; i++) {
    const y = 300 + (i / 22) * (TOTAL - 200);
    const p = MeshBuilder.CreatePlane('neb' + i, { size: 160 + r() * 140 }, scene);
    p.material = mat('#ffffff', { tex: nebs[i % 3], unlit: true, add: true, e: '#ffffff', double: true });
    deco(p, (r() - 0.5) * 220, y, 380 + r() * 60, 0);
    decor[decor.length - 1].space = true;
    glow.addExcludedMesh(p);
  }
  for (let i = 0; i < 7; i++) {
    const p = MeshBuilder.CreatePlane('gal' + i, { size: 50 + r() * 60 }, scene);
    p.material = mat('#ffffff', { tex: texGalaxy, unlit: true, add: true, e: '#ffffff', double: true });
    deco(p, (r() - 0.5) * 200, SECTOR_STARTS[4] + r() * (TOTAL - SECTOR_STARTS[4]), 300, 0.05 * (r() < 0.5 ? -1 : 1)).rotation.x = r() * 0.8;
    glow.addExcludedMesh(p);
  }
  for (let i = 0; i < 18; i++) { // giant crystals at the edge of everything
    const c = ['#b98cff', '#39e6ff', '#ff7ae0'][i % 3];
    const s = deco(MeshBuilder.CreatePolyhedron('bigShard' + i, { type: 1, size: 8 + r() * 12 }, scene), (r() < 0.5 ? -1 : 1) * (70 + r() * 90), SECTOR_STARTS[5] + r() * 900, 220 + r() * 120, 0.1);
    s.material = mat(c, { e: c, ei: 0.25, spec: 0.6, alpha: 0.45 });
    glow.addExcludedMesh(s);
    s.scaling.y = 2.2;
  }
})();

// ------------------------------------------------------------------ entity views
const views = new Map();
function makeView(e) {
  let node, kind = e.kind;
  switch (e.kind) {
    case 'rock': node = cloneOf('rock' + Math.floor(e.seed * 4), e.id); node.scaling.setAll(e.r); break;
    case 'shard': node = cloneOf('shard' + Math.floor(e.seed * 3), e.id); node.scaling.setAll(e.r); break;
    case 'debris': node = cloneOf('debris' + Math.floor(e.seed * 3), e.id); node.scaling.setAll(e.r * 1.3); break;
    case 'junk': node = cloneOf('junk', e.id); break;
    case 'meteor': node = cloneOf('meteor', e.id); node.scaling.setAll(e.r); break;
    case 'comet': node = cloneOf('comet', e.id); node.scaling.setAll(e.r); break;
    case 'bird': node = cloneOf('bird', e.id); break;
    case 'balloon': node = cloneOf('balloon', e.id); break;
    case 'jet': node = cloneOf('jet', e.id); node.scaling.x = e.dir; break;
    case 'cloudlet': node = cloneOf('cloudlet', e.id); break;
    case 'storm': node = cloneOf('storm', e.id); node.scaling.set(e.w / 2.2, 1.3, 0.8); break;
    case 'ring': case 'fuel': case 'repair': case 'cool': case 'shield': node = cloneOf(e.kind, e.id); break;
    case 'current': case 'dust': node = cloneOf(e.kind, e.id); node.scaling.set(e.w * 2, e.h * 2, 1); break;
    case 'planet': {
      node = cloneOf('planet', e.id);
      node.scaling.setAll(e.r);
      node.getChildMeshes()[0].material = mat('#ffffff', { tex: [texSaturn, texGiant, texRedP][e.hue], spec: 0.3 });
      const orbit = part(MeshBuilder.CreateTorus('orbit', { diameter: (e.R * 2) / e.r, thickness: 0.05, tessellation: 64 }, scene), node, mat('#39e6ff', { e: '#39e6ff', unlit: true, alpha: 0.7, add: true }), [0, 0, 0], [Math.PI / 2, 0, 0]);
      node.metadata = { orbit };
      break;
    }
    case 'blackhole': node = cloneOf('blackhole', e.id); node.scaling.setAll(e.rh); break;
    case 'wormhole': node = cloneOf('wormhole', e.id); break;
    case 'portal': node = cloneOf('portal', e.id); break;
    case 'uap': node = cloneOf(e.role === 'friendly' ? 'uap_friendly' : 'uap_hostile', e.id); node.rotation.x = -0.25; break;
    case 'warn': node = cloneOf('warn', e.id); break;
    default: return null;
  }
  const kids = node.getChildMeshes(false);
  const find = (s) => kids.filter(m => m.name.endsWith(s));
  const view = { node, kind, find, extra: {} };
  if (e.kind === 'blackhole') {
    view.extra.pull = find('pull')[0];
    view.extra.pull.scaling.setAll(e.R / e.rh);
    view.extra.disk = find('disk')[0];
    view.extra.disk.scaling.setAll(e.R * 0.42 / e.rh);
  }
  if (e.kind === 'uap') {
    view.extra.lights = find('light');
    view.extra.beam = find('beam')[0];
    view.extra.scan = find('scan')[0];
    if (view.extra.beam) view.extra.beam.isVisible = false;
    if (view.extra.scan) view.extra.scan.isVisible = false;
  }
  if (e.kind === 'bird') view.extra.wings = [find('wingL')[0], find('wingR')[0]];
  if (e.kind === 'jet' || e.kind === 'comet') {
    const band = cloneOf('band', e.id + 'b');
    band.scaling.set(FIELD * 2 + 4, 1.4, 1);
    view.extra.band = band;
  }
  if (e.kind === 'storm') {
    const tele = part(MeshBuilder.CreatePlane('tele', { width: 0.25, height: 13 }, scene), null, mat('#bff8ff', { e: '#bff8ff', unlit: true, alpha: 0.5, add: true, double: true }));
    tele.isVisible = false;
    view.extra.tele = tele;
  }
  return view;
}
function disposeView(v) {
  v.node.dispose(false, false);
  v.extra.band?.dispose(false, false);
  v.extra.tele?.dispose(false, false);
  if (v.kind === 'planet') v.node.metadata?.orbit?.dispose();
}

const bolts = [];
function lightningBolt(x, yTop) {
  const pts = [];
  let px = x;
  for (let i = 0; i <= 10; i++) { pts.push(v3(px, yTop - i * 1.3, -0.4)); px = x + (Math.random() - 0.5) * 1.1; }
  const tube = MeshBuilder.CreateTube('bolt', { path: pts, radius: 0.12, tessellation: 6 }, scene);
  tube.material = mat('#e6fbff', { e: '#bff8ff', unlit: true });
  bolts.push({ mesh: tube, t: 0.22 });
  flash('cyan');
}

function syncViews(g, t) {
  const alive = new Set();
  for (const e of g.entities) {
    alive.add(e.id);
    let v = views.get(e.id);
    if (!v) { v = makeView(e); if (!v) continue; views.set(e.id, v); }
    const n = v.node;
    n.position.set(e.x, e.y, e.kind === 'storm' ? 2.5 : e.kind === 'cloudlet' ? 1.2 : 0);
    switch (e.kind) {
      case 'rock': case 'debris': case 'junk': case 'shard':
        n.rotation.set(t * e.spin * 0.6, t * e.spin, e.seed * 6);
        break;
      case 'meteor': case 'comet': {
        const ang = Math.atan2(e.kind === 'comet' ? (e.armed && e.warn <= 0 ? 9 : 0) : -e.vy, e.kind === 'comet' ? -e.dir * 20 : -e.vx);
        n.rotation.z = ang - Math.PI / 2;
        if (v.extra.band) { v.extra.band.position.set(0, e.y, 0.2); v.extra.band.setEnabled(e.armed && e.warn > 0 && Math.floor(t * 8) % 2 === 0); }
        break;
      }
      case 'jet':
        if (v.extra.band) { v.extra.band.position.set(0, e.y, 0.2); v.extra.band.setEnabled(e.armed && e.warn > 0 && Math.floor(t * 8) % 2 === 0); }
        break;
      case 'bird': {
        const f = Math.sin(t * 14 + e.seed * 9) * 0.7;
        v.extra.wings[0].rotation.z = f; v.extra.wings[1].rotation.z = -f;
        n.rotation.y = e.vx > 0 ? 0.5 : -0.5;
        break;
      }
      case 'balloon': n.rotation.z = Math.sin(t + e.seed * 6) * 0.08; break;
      case 'cloudlet': n.position.y += Math.sin(t * 0.8 + e.seed * 9) * 0.15; break;
      case 'ring': n.rotation.z = t * 1.5; n.scaling.setAll(1 + Math.sin(t * 5) * 0.05); break;
      case 'fuel': case 'repair': case 'cool': case 'shield':
        n.rotation.y = t * 2; n.position.y += Math.sin(t * 3 + e.seed * 6) * 0.15; break;
      case 'storm':
        if (e.strike) {
          v.extra.tele.isVisible = Math.floor(t * 16) % 2 === 0;
          v.extra.tele.position.set(e.strike.x, e.y - 6.5, -0.2);
        } else v.extra.tele.isVisible = false;
        break;
      case 'planet':
        n.getChildMeshes()[0].rotation.y = t * 0.15; // spin the planet, not its flat orbit ring
        n.metadata.orbit.isVisible = !e.used || Math.floor(t * 2) % 2 === 0;
        break;
      case 'blackhole':
        v.extra.disk.rotation.z = t * 1.4;
        n.rotation.y = 0;
        break;
      case 'wormhole': case 'portal': n.getChildMeshes()[1].rotation.z = -t * 2; break;
      case 'warn':
        n.setEnabled(e.delay <= 0);
        n.position.set(e.x, g.dist + 22, 0.1);
        n.scaling.set(1, 44, 1);
        n.visibility = 0.5 + Math.sin(t * 20) * 0.5;
        break;
      case 'uap': {
        n.setEnabled(e.active);
        const blink = e.role === 'beam' && e.warning ? 12 : 4;
        v.extra.lights.forEach((l, i) => { l.isVisible = Math.floor(t * blink + i) % 2 === 0; });
        n.rotation.y = t * 1.2;
        n.position.y += Math.sin(t * 2.4) * 0.25;
        if (v.extra.beam) v.extra.beam.isVisible = !!e.beaming || (e.warning && Math.floor(t * 10) % 2 === 0);
        if (v.extra.beam) v.extra.beam.visibility = e.beaming ? 1 : 0.35;
        if (v.extra.scan) {
          v.extra.scan.isVisible = !!e.scanning;
          v.extra.scan.position.x = 0;
          if (e.scanning) {
            // scanner beam sweeps: tilt the cone toward beamX
            v.extra.scan.rotation.y = -n.rotation.y;
          }
        }
        if (e.role === 'scanner' && e.scanning) n.rotation.z = (e.beamX - e.x) * -0.05;
        break;
      }
    }
  }
  for (const [id, v] of views) if (!alive.has(id)) { disposeView(v); views.delete(id); }
  // scanner beam lives in world space so it can sweep independently of the spinning saucer
  for (const e of g.entities) if (e.kind === 'uap' && e.role === 'scanner') {
    const v = views.get(e.id);
    if (v?.extra.scan) {
      v.extra.scan.parent = null;
      v.extra.scan.rotation.set(0, 0, 0);
      v.extra.scan.position.set(e.beamX, e.y - 7.3, 0);
    }
  }
}

// ------------------------------------------------------------------ game state & input
let g = createGame();
let mode = 'title';
let paused = false;
let shake = 0, camY = 10, camOff = 9, smoothX = 0, endTimer = 0, lastCount = 0;
const keys = new Set();
let drag = null, boostHeld = false;

window.addEventListener('keydown', (ev) => {
  audio.unlock();
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'a', 'd', 'w', 'A', 'D', 'W'].includes(ev.key)) ev.preventDefault();
  keys.add(ev.key.toLowerCase());
  if ((ev.key === 'Escape' || ev.key === 'p') && mode === 'play') togglePause();
});
window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
canvas.addEventListener('pointerdown', (ev) => {
  audio.unlock();
  if (mode !== 'play') return;
  canvas.setPointerCapture(ev.pointerId);
  drag = { id: ev.pointerId, sx: ev.clientX, x0: g.x, tx: g.x };
  $('steerHint').classList.add('gone');
});
canvas.addEventListener('pointermove', (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  const k = (FIELD * 2) / (Math.min(window.innerWidth, 900) * 0.75);
  drag.tx = Math.max(-FIELD, Math.min(FIELD, drag.x0 + (ev.clientX - drag.sx) * k));
});
const endDrag = (ev) => { if (drag && ev.pointerId === drag.id) drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
const boostBtn = $('boostBtn');
boostBtn.addEventListener('pointerdown', (ev) => { audio.unlock(); boostBtn.setPointerCapture(ev.pointerId); boostHeld = true; boostBtn.classList.add('held'); ev.preventDefault(); });
const boostUp = () => { boostHeld = false; boostBtn.classList.remove('held'); };
boostBtn.addEventListener('pointerup', boostUp);
boostBtn.addEventListener('pointercancel', boostUp);
boostBtn.addEventListener('contextmenu', (ev) => ev.preventDefault());

function readInput() {
  const left = keys.has('arrowleft') || keys.has('a');
  const right = keys.has('arrowright') || keys.has('d');
  const steer = (right ? 1 : 0) - (left ? 1 : 0);
  if (steer) drag = null;
  return { steer, targetX: drag ? drag.tx : null, boost: boostHeld || keys.has(' ') || keys.has('w') || keys.has('arrowup') };
}

// ------------------------------------------------------------------ HUD
const SEGS = window.innerWidth < 560 ? 8 : 10;
for (const id of ['barHull', 'barEnergy', 'barHeat', 'barSpeed']) $(id).querySelector('.segs').innerHTML = '<i></i>'.repeat(SEGS);
const segCache = {};
function setBar(id, frac, low) {
  const n = Math.round(Math.max(0, Math.min(1, frac)) * SEGS);
  const key = n + (low ? 'L' : '');
  if (segCache[id] === key) return;
  segCache[id] = key;
  const el = $(id);
  el.classList.toggle('low', !!low);
  el.querySelectorAll('.segs i').forEach((s, i) => s.classList.toggle('on', i < n));
}
const stops = [...SECTORS.map((s, i) => ({ icon: s.icon, at: SECTOR_STARTS[i] / TOTAL })), { icon: '🌟', at: 1 }];
$('routeStops').innerHTML = stops.map(s => `<span style="bottom:calc(18px + (100% - 36px) * ${s.at})">${s.icon}</span>`).join('');
const stopEls = [...$('routeStops').children];

const bannerQ = [];
let bannerT = 0;
function showBanners(dt) {
  bannerT -= dt;
  const el = $('banner');
  if (bannerT <= 0.3) el.classList.remove('show');
  if (bannerT <= 0 && bannerQ.length) {
    const b = bannerQ.shift();
    el.textContent = b.text;
    el.className = 'banner ' + (b.tone || '');
    void el.offsetWidth;
    el.classList.add('show');
    bannerT = 2.4;
  }
}
function flash(kind = 'red') {
  const el = $('flash');
  el.className = 'flash on ' + (kind === 'cyan' ? 'cyan' : '');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
}
let statusKey = '';
function updateHUD(dt) {
  setBar('barHull', g.hull / 100, g.hull < 30);
  setBar('barEnergy', g.energy / 100, g.energy < 20);
  setBar('barHeat', g.heat / 100, g.heat > 75);
  setBar('barSpeed', g.speed / 60, false);
  $('speedText').textContent = Math.round(g.speed * 10);
  const p = progress(g);
  $('routeFill').style.height = (p * 100).toFixed(1) + '%';
  $('routeRocket').style.bottom = `calc(18px + (100% - 36px) * ${p.toFixed(4)})`;
  stopEls.forEach((s, i) => s.classList.toggle('done', p >= stops[i].at - 1e-6));
  const st = [];
  if (g.shield > 0) st.push(['Shield', 0]);
  if (g.burst > 0) st.push(['Speed burst', 0]);
  if (hasMod(g, 'tailwind')) st.push(['Tailwind', 0]);
  if (hasMod(g, 'surge')) st.push(['Engine surge', 0]);
  if (g.fx.current) st.push(['Gravity current', 0]);
  if (hasMod(g, 'headwind')) st.push(['Headwind', 1]);
  if (hasMod(g, 'ion')) st.push(['Ion storm', 1]);
  if (hasMod(g, 'wave')) st.push(['Gravity wave', 1]);
  if (hasMod(g, 'leak')) st.push(['Fuel leak', 1]);
  if (g.fx.dust) st.push(['Dust drag', 1]);
  if (g.fx.beam) st.push(['Tractor beam!', 1]);
  if (g.fx.pull > 0.05) st.push([g.fx.horizon ? 'EVENT HORIZON!' : 'Black hole pull', 1]);
  if (g.jam > 0) st.push(['Jammed', 1]);
  if (g.overheated) st.push(['Overheated', 1]);
  if (g.energy <= 0) st.push(['Out of fuel', 1]);
  const key = st.map(s => s[0]).join();
  if (key !== statusKey) { statusKey = key; $('status').innerHTML = st.map(([t, bad]) => `<span class="${bad ? 'bad' : ''}">${t}</span>`).join(''); }
  const scanning = g.scan > 0.02;
  $('scanMeter').classList.toggle('hidden', !scanning);
  if (scanning) $('scanFill').style.width = (g.scan * 100).toFixed(0) + '%';
  boostBtn.classList.toggle('disabled', g.energy <= 0 || g.overheated || g.jam > 0);
  const danger = Math.max(g.fx.pull * 1.2, g.fx.beam ? 0.7 : 0, g.hull < 30 ? 0.5 : 0, g.overheated ? 0.6 : 0, g.fx.horizon ? 1 : 0);
  $('vignette').style.opacity = Math.min(1, danger).toFixed(2);
  if (g.phase === 'countdown') {
    const n = Math.ceil(g.countdown);
    const el = $('countdown');
    if (n !== lastCount && n > 0 && n <= 3) { lastCount = n; el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); audio.play({ t: 'tick' }); }
  } else if (lastCount) { lastCount = 0; $('countdown').textContent = ''; }
  showBanners(dt);
}

// ------------------------------------------------------------------ messages from the sim
function handle(msgs) {
  for (const m of msgs) {
    audio.play(m);
    switch (m.t) {
      case 'banner': bannerQ.push(m); if (bannerQ.length > 3) bannerQ.shift(); break;
      case 'hit':
        shake = 0.4; flash('red');
        burst(rocket.position.add(v3(0, 1, -0.5)), new Color4(1, 0.6, 0.2, 1), new Color4(1, 0.25, 0.5, 1), 40, 9);
        navigator.vibrate?.(60);
        break;
      case 'smash': burst(v3(m.x, m.y, 0), new Color4(0.9, 0.85, 1, 1), new Color4(1, 0.6, 0.3, 1), 30, 7, [0.15, 0.5]); break;
      case 'pickup': burst(v3(m.x, m.y, 0), new Color4(0.25, 0.9, 1, 1), new Color4(1, 0.95, 0.4, 1), 34, 6, [0.15, 0.5]); break;
      case 'bolt': lightningBolt(m.x, m.y - 0.5); shake = Math.max(shake, 0.15); break;
      case 'sling': case 'wormhole': flash('cyan'); shake = 0.2; break;
      case 'liftoff': shake = 0.5; break;
      case 'lose':
        burst(rocket.position.clone(), new Color4(1, 0.7, 0.2, 1), new Color4(1, 0.2, 0.6, 1), 220, 16, [0.4, 1.4]);
        rocket.setEnabled(false); exhaust.emitRate = 0; shake = 0.8; endTimer = 1.8; mode = 'ending';
        break;
      case 'win': endTimer = 2.2; mode = 'ending'; flash('cyan'); break;
    }
  }
}

// ------------------------------------------------------------------ per frame
function updateRocket(dt, t) {
  smoothX += (g.x - smoothX) * Math.min(1, dt * 20);
  rocket.position.set(smoothX, g.dist, 0);
  rocketBody.rotation.z = -g.vx * 0.035;
  rocketBody.rotation.y = Math.sin(t * 1.3) * 0.15 + g.vx * 0.03;
  if (g.phase === 'countdown') rocketBody.position.x = (Math.random() - 0.5) * 0.04 * (3.2 - g.countdown);
  else rocketBody.position.x = 0;
  const flying = g.phase === 'fly' || (g.phase === 'won');
  const boost = g.boosting ? 1 : 0;
  const flick = 0.85 + Math.random() * 0.3;
  const fl = flying ? (0.8 + g.speed / 40 + boost * 0.9) * flick : g.phase === 'countdown' && g.countdown < 1.2 ? 0.5 * flick : 0;
  flameMesh.scaling.set(0.8 + boost * 0.4, Math.max(0.01, fl), 0.8 + boost * 0.4);
  flameMesh.position.y = -1.32 - 0.8 * fl;
  flameCore.scaling.set(1, Math.max(0.01, fl * 0.9), 1);
  flameCore.position.y = -1.32 - 0.5 * fl * 0.9;
  flameMesh.isVisible = flameCore.isVisible = fl > 0.02;
  exhaust.emitRate = flying ? 160 + g.speed * 6 + boost * 380 : 0;
  smoke.emitRate = g.phase === 'countdown' ? (g.countdown < 1.5 ? 260 : 30) : g.dist < 25 && flying ? 240 * (1 - g.dist / 25) : 0;
  speedLines.emitRate = flying && (g.boosting || g.burst > 0 || g.fx.current) ? 120 : 0;
  speedLines.emitter = v3(0, camY, 0);
  shieldBubble.isVisible = g.shield > 0 && (g.shield > 1.2 || Math.floor(t * 10) % 2 === 0);
  // blink while invulnerable after a hit
  rocketBody.getChildMeshes().forEach(m => { if (m !== flameMesh && m !== flameCore && m !== nozzleEmitter) m.visibility = g.invuln > 0 && g.shield <= 0 && Math.floor(t * 18) % 2 === 0 ? 0.25 : 1; });
}

function updateCamera(dt, t) {
  const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
  const tanH = Math.tan(camera.fov / 2);
  const camDist = Math.max((FIELD + 2) / (tanH * aspect), 18 / tanH);
  const halfH = camDist * tanH;
  const targetY = g.dist + halfH * 0.5; // rocket sits a quarter of the way up the screen
  // follow the rocket's altitude exactly (no lag at speed) and ease only the framing offset
  camOff += (targetY - g.dist - camOff) * Math.min(1, dt * 4);
  camY = g.dist + camOff;
  shake = Math.max(0, shake - dt);
  const sx = shake > 0 ? (Math.random() - 0.5) * shake * 1.2 : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake * 1.2 : 0;
  camera.position.set(sx + smoothX * 0.08, camY - camDist * 0.04 + sy, -camDist);
  camera.setTarget(v3(smoothX * 0.08, camY + sy, 0));

  // sky colour by altitude, with a shimmering edge of the universe
  const s = g.sector, within = Math.min(1, (g.dist - SECTOR_STARTS[s]) / SECTORS[s].len);
  const a = s === 0 ? [0.44, 0.76, 1] : sky[s - 1], b = sky[s];
  const k = s === 0 ? Math.min(1, g.dist / 520) : Math.min(1, within * 3);
  let r = a[0] + (b[0] - a[0]) * k, gg = a[1] + (b[1] - a[1]) * k, bb = a[2] + (b[2] - a[2]) * k;
  if (s === 5) { r += Math.sin(t * 0.5) * 0.06; gg += Math.sin(t * 0.7 + 2) * 0.04; bb += Math.sin(t * 0.4 + 4) * 0.08; }
  if (g.fx.pull > 0) { const p = g.fx.pull * 0.6; r *= 1 - p; gg *= 1 - p; bb *= 1 - p * 0.5; }
  scene.clearColor.set(r, gg, bb, 1);
  hemi.groundColor.set(0.3 + r * 0.3, 0.25 + gg * 0.3, 0.7);
  const starA = Math.max(0, Math.min(1, (g.dist - 120) / 260));
  const H = 300;
  const base = Math.floor((camY - 150) / H) * H;
  starTiles.forEach((m, i) => { m.position.y = base + (i % 2) * H; m.visibility = starA; m.setEnabled(starA > 0.01); });
  atmo.visibility = Math.max(0, 1 - g.dist / 700);
  for (const d of decor) { if (d.spin) d.mesh.rotation.y += d.spin * dt; if (d.space) { d.mesh.visibility = starA * 0.8; d.mesh.setEnabled(starA > 0.01); } }
  pad.setEnabled(g.dist < 200);
}

engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  const t = performance.now() / 1000;
  if ((mode === 'play' || mode === 'ending') && !paused) {
    step(g, dt, mode === 'play' ? readInput() : {});
    handle(g.out.splice(0));
    if (mode === 'ending') { endTimer -= dt; if (endTimer <= 0) showEnd(); }
  }
  syncViews(g, t);
  for (const b of bolts) { b.t -= dt; if (b.t <= 0) b.mesh.dispose(); }
  for (let i = bolts.length - 1; i >= 0; i--) if (bolts[i].t <= 0) bolts.splice(i, 1);
  updateRocket(dt, t);
  updateCamera(dt, t);
  if (mode === 'play' || mode === 'ending') updateHUD(dt);
  audio.update(g);
  scene.render();
});
window.addEventListener('resize', () => engine.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { audio.suspend(); if (mode === 'play' && !paused) togglePause(); }
  else audio.resume();
});

// ------------------------------------------------------------------ screens
const BEST_KEY = 'rocket-rim-best';
function loadBest() { try { return JSON.parse(localStorage.getItem(BEST_KEY)) || null; } catch { return null; } }
function renderBest() {
  const b = loadBest();
  $('best').textContent = !b ? '' : b.won ? `Best: reached the Rim · ${'⭐'.repeat(b.stars)} · ${formatTime(b.time)}` : `Best: ${Math.round(b.pct * 100)}% of the way to the Rim`;
}
const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function resetWorld() {
  for (const v of views.values()) disposeView(v);
  views.clear();
  bannerQ.length = 0; bannerT = 0;
  $('banner').classList.remove('show');
  g = createGame();
  smoothX = 0; camY = 10; shake = 0; drag = null;
  rocket.setEnabled(true);
  Object.keys(segCache).forEach(k => delete segCache[k]);
  statusKey = '';
}
function launch() {
  audio.unlock();
  audio.play({ t: 'ui' });
  resetWorld();
  mode = 'play';
  paused = false;
  ['title', 'end', 'pause'].forEach(id => $(id).classList.add('hidden'));
  $('hud').classList.remove('hidden');
  $('steerHint').classList.remove('gone');
  setTimeout(() => $('steerHint').classList.add('gone'), 6000);
}
function togglePause() {
  paused = !paused;
  $('pause').classList.toggle('hidden', !paused);
  if (paused) { boostUp(); drag = null; keys.clear(); }
}
function showEnd() {
  mode = 'over';
  $('hud').classList.add('hidden');
  $('vignette').style.opacity = '0';
  const won = g.won, stars = starRating(g), pct = progress(g);
  $('endIcon').textContent = won ? '🌟' : g.cause === 'blackhole' ? '🕳️' : g.cause === 'heat' ? '🔥' : '💥';
  $('endTitle').textContent = won ? 'You reached the Rim!' : 'Rocket lost!';
  $('stars').innerHTML = won ? [1, 2, 3].map(i => `<span class="${i <= stars ? '' : 'off'}">⭐</span>`).join('') : '';
  const where = SECTORS[g.sector].name;
  const causes = { blackhole: 'Swallowed by a black hole', heat: 'The engines melted down', lightning: 'Fried by lightning', uap: 'Rammed by a UAP', planet: 'Crashed into a planet', meteor: 'Smashed by a meteor', comet: 'Hit by a comet', jet: 'Clipped by a jet' };
  $('endText').textContent = won
    ? `You flew through the edge of the universe with ${Math.round(g.hull)}% hull left.`
    : `${causes[g.cause] ?? 'Hull destroyed'} in ${where}, ${Math.round(pct * 100)}% of the way to the Rim.`;
  const s = g.stats;
  $('endStats').innerHTML = [
    ['Progress', Math.round(pct * 100) + '%'], ['Time', formatTime(s.time)], ['Top speed', Math.round(s.maxSpeed * 10)],
    ['Pickups', s.pickups], ['Hits taken', s.hits], ['Slingshots', s.slings]
  ].map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('');
  $('end').classList.remove('hidden');
  const best = loadBest();
  const better = !best || (won && (!best.won || stars > best.stars || (stars === best.stars && s.time < best.time))) || (!won && !best.won && pct > best.pct);
  if (better) try { localStorage.setItem(BEST_KEY, JSON.stringify({ won, stars, time: s.time, pct })); } catch { /* storage unavailable */ }
}

$('launchBtn').onclick = launch;
$('againBtn').onclick = launch;
$('pauseBtn').onclick = () => { audio.play({ t: 'ui' }); togglePause(); };
$('resumeBtn').onclick = () => { audio.play({ t: 'ui' }); togglePause(); };
$('restartBtn').onclick = launch;
const soundLabel = () => { $('soundBtn').textContent = audio.on ? '🔊 Sound on' : '🔇 Sound off'; };
soundLabel();
$('soundBtn').onclick = () => { audio.toggle(); soundLabel(); };
renderBest();

// the title screen floats over a live view of the launch pad
camY = 10;

if (import.meta.env?.DEV) window.__rocket = { scene, get g() { return g; }, set g(v) { g = v; } };
