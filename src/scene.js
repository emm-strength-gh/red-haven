import * as THREE from 'three';
import { SIZE } from './game.js';

const palette = {
  ground: [0xd77c52, 0xe38d55, 0xca7250, 0xe59660, 0xc56c4b],
  soil: 0x81745a, ridge: 0xb85f43, stone: 0xb48b72,
  cream: 0xffdcaa, creamDark: 0xcba783, red: 0xe45f46, redDark: 0x8e4d48,
  slate: 0x3a5861, teal: 0x51c9bc, gold: 0xffbf59, blue: 0x2979a3,
  leaf: 0x4baf78, leafLight: 0x83d18a, wood: 0x946340, metal: 0xc4c0ac
};
const shades = new Uint8Array([58, 58, 66, 112, 114, 120, 181, 185, 188, 255, 250, 232]);
const gradient = new THREE.DataTexture(shades, 4, 1, THREE.RGBFormat);
gradient.magFilter = THREE.NearestFilter;
gradient.minFilter = THREE.NearestFilter;
gradient.needsUpdate = true;
const mat = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...extra });
const materials = Object.fromEntries(Object.entries(palette).filter(([k]) => !Array.isArray(palette[k])).map(([k, v]) => [k, mat(v)]));
const geom = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 5),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 7),
  sphere: new THREE.IcosahedronGeometry(1, 0)
};
const edgeGeom = Object.fromEntries(Object.entries(geom).map(([name, value]) => [name, new THREE.EdgesGeometry(value, 24)]));
const edgeMat = new THREE.LineBasicMaterial({ color: 0x26373f, transparent: true, opacity: .8 });
function part(group, kind, material, x, y, z, sx, sy, sz, rotation = 0) {
  const mesh = new THREE.Mesh(geom[kind], materials[material] || mat(material));
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.y = rotation;
  group.add(mesh);
  if (group.userData.outline && Math.max(sx, sy, sz) > .24) {
    const edges = new THREE.LineSegments(edgeGeom[kind], edgeMat);
    edges.position.copy(mesh.position);
    edges.scale.set(sx * 1.005, sy * 1.005, sz * 1.005);
    edges.rotation.copy(mesh.rotation);
    group.add(edges);
  }
  return mesh;
}
function roof(group, x, z, color = 'red') {
  const mesh = part(group, 'cone', color, x, .88, z, .72, .35, .72, Math.PI / 4);
  mesh.rotation.y = Math.PI / 4;
}
function makeBuilding(building) {
  const group = new THREE.Group();
  group.userData.outline = true;
  group.position.set(building.x + .5, 0, building.z + .5);
  const t = building.type;
  if (t === 'shelter') {
    part(group, 'box', 'creamDark', 0, .06, 0, 1.02, .14, 1.02);
    part(group, 'cylinder', 'cream', 0, .52, 0, .68, .8, .68);
    roof(group, 0, 0);
    part(group, 'box', 'slate', 0, .3, .55, .28, .46, .12);
    part(group, 'box', 'gold', -.36, .57, .48, .16, .15, .08);
    part(group, 'box', 'gold', .36, .57, .48, .16, .15, .08);
    part(group, 'cylinder', 'slate', -.26, 1.15, -.18, .035, .38, .035);
  } else if (t === 'farm') {
    part(group, 'box', 'creamDark', 0, .1, 0, 1, .2, 1);
    part(group, 'box', 'soil', 0, .21, 0, .86, .08, .86);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      part(group, 'cone', i === 1 ? 'leafLight' : 'leaf', -.28 + i * .28, .38, -.28 + j * .28, .12, .32, .12);
    }
    for (const v of [-.48, .48]) part(group, 'box', 'cream', v, .33, 0, .06, .45, 1.03);
  } else if (t === 'solar') {
    part(group, 'box', 'slate', 0, .08, 0, .92, .16, .92);
    part(group, 'cylinder', 'metal', 0, .4, 0, .08, .55, .08);
    const panel = part(group, 'box', 'blue', 0, .74, 0, 1.15, .06, .88);
    panel.rotation.x = -.3;
    for (let i = -1; i <= 1; i++) part(group, 'box', 'teal', i * .29, .79, -.01, .018, .015, .84).rotation.x = -.3;
    part(group, 'box', 'cream', 0, .79, 0, 1.18, .015, .015).rotation.x = -.3;
  } else if (t === 'wall') {
    part(group, 'box', 'creamDark', 0, .34, 0, .98, .65, .95);
    part(group, 'box', 'cream', 0, .7, 0, 1, .13, 1);
    for (const v of [-.36, .36]) part(group, 'box', 'red', v, .43, .48, .13, .43, .035);
  } else if (t === 'turret') {
    part(group, 'cylinder', 'creamDark', 0, .16, 0, .46, .32, .46);
    part(group, 'cylinder', 'cream', 0, .51, 0, .28, .45, .28);
    part(group, 'box', 'slate', 0, .8, 0, .49, .23, .48);
    part(group, 'box', 'slate', 0, .78, -.42, .13, .13, .55);
    part(group, 'box', 'teal', 0, .84, .25, .28, .07, .04);
  } else if (t === 'beacon') {
    part(group, 'cylinder', 'slate', 0, .13, 0, .65, .25, .65);
    part(group, 'cylinder', 'cream', 0, .54, 0, .27, .68, .27);
    part(group, 'cylinder', 'red', 0, .97, 0, .37, .18, .37);
    part(group, 'cylinder', 'slate', 0, 1.45, 0, .06, .92, .06);
    part(group, 'sphere', 'teal', 0, 1.94, 0, .16, .16, .16);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      part(group, 'box', 'metal', Math.sin(a) * .37, .61, Math.cos(a) * .37, .1, .8, .1);
    }
  }
  return group;
}
function makeColonist(c) {
  const group = new THREE.Group();
  group.userData.outline = true;
  const uniform = c.role === 'Guard' ? 'red' : c.role === 'Farmer' ? 'leaf' : c.role === 'Engineer' ? 'teal' : 'gold';
  part(group, 'sphere', 'slate', 0, .09, 0, .22, .06, .22);
  part(group, 'box', uniform, 0, .4, 0, .26, .4, .22);
  part(group, 'sphere', 'cream', 0, .76, 0, .18, .18, .18);
  part(group, 'box', 'slate', 0, .82, .13, .24, .1, .08);
  part(group, 'box', 'slate', -.1, .13, 0, .08, .26, .1);
  part(group, 'box', 'slate', .1, .13, 0, .08, .26, .1);
  if (c.role === 'Guard') part(group, 'box', 'metal', .24, .45, .12, .1, .1, .38);
  return group;
}
function makeEnemy() {
  const group = new THREE.Group();
  group.userData.outline = true;
  part(group, 'box', 'redDark', 0, .4, 0, .28, .41, .24);
  part(group, 'sphere', 'creamDark', 0, .76, 0, .17, .17, .17);
  part(group, 'cone', 'red', 0, .94, 0, .22, .22, .22);
  part(group, 'box', 'slate', .23, .42, .12, .09, .1, .4);
  for (const x of [-.1, .1]) part(group, 'box', 'slate', x, .13, 0, .08, .26, .1);
  return group;
}
function makeNode(n) {
  const group = new THREE.Group();
  group.userData.marked = n.marked;
  group.position.set(n.x + .5, 0, n.z + .5);
  if (n.type === 'rock') {
    part(group, 'sphere', 'stone', 0, .25, 0, .39, .33, .37, .3);
    part(group, 'sphere', 'creamDark', .23, .15, -.2, .23, .18, .2);
  } else {
    part(group, 'cylinder', 'wood', 0, .36, 0, .09, .65, .09);
    part(group, 'cone', 'leaf', 0, .83, 0, .37, .7, .37);
    part(group, 'cone', 'leafLight', 0, 1.12, 0, .26, .53, .26);
  }
  if (n.marked) part(group, 'box', 'teal', 0, .035, 0, .76, .025, .76);
  return group;
}

export class GameScene {
  constructor(container, game) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x72c5dc);
    this.scene.fog = new THREE.Fog(0x72c5dc, 48, 100);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8c746c, 2.1));
    const sun = new THREE.DirectionalLight(0xffe2ad, 2.25);
    sun.position.set(-10, 24, -8);
    this.scene.add(sun);
    this.sun = sun;
    this.camera = new THREE.OrthographicCamera(-12, 12, 8, -8, .1, 100);
    this.target = new THREE.Vector3(14, 0, 14);
    this.zoom = 1;
    this.camera.position.set(32, 27, 32);
    this.camera.lookAt(this.target);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.entities = new Map();
    this.nodes = new Map();
    this.units = new Map();
    this.raiders = new Map();
    this.selection = new THREE.Mesh(new THREE.BoxGeometry(1.02, .035, 1.02), mat(0x8ff0df, { transparent: true, opacity: .35, depthWrite: false }));
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const rainPositions = new Float32Array(100 * 6);
    const random = (i) => ((Math.sin(i * 91.37) * 43758.5453) % 1 + 1) % 1;
    for (let i = 0; i < 100; i++) {
      const x = (random(i + 2) - .5) * 31, z = (random(i + 201) - .5) * 31;
      const y = random(i + 442) * 8 + 1;
      rainPositions.set([x, y, z, x - .08, y - .55, z + .05], i * 6);
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xd4efff, transparent: true, opacity: .7 }));
    this.rain.visible = false;
    this.scene.add(this.rain);
    this.makeGround(game);
    this.sync(game);
    this.resize();
  }
  makeGround(game) {
    const mesh = new THREE.InstancedMesh(geom.box, mat(0xffffff), SIZE * SIZE);
    const dummy = new THREE.Object3D();
    game.tiles.forEach((t, i) => {
      dummy.position.set(t.x + .5, -.16, t.z + .5);
      dummy.scale.set(1.005, .32 + (t.type === 'ridge' ? .08 : 0), 1.005);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const value = t.type === 'plain' ? palette.ground[Math.min(4, Math.floor(t.shade * 5))] : palette[t.type];
      mesh.setColorAt(i, new THREE.Color(value));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    this.world.add(mesh);
    const base = new THREE.Mesh(new THREE.BoxGeometry(SIZE + .5, .65, SIZE + .5), mat(0x8e4a3c));
    base.position.set(SIZE / 2, -.65, SIZE / 2);
    this.world.add(base);
  }
  sync(game) {
    if (this.lastWeather !== game.weather) {
      this.lastWeather = game.weather;
      const rain = game.weather === 'Heavy rain';
      const storm = game.weather === 'Dust storm';
      const sky = rain ? 0x285471 : storm ? 0xc27b5f : game.weather === 'Heat wave' ? 0xe8b073 : 0x72c5dc;
      this.scene.background.setHex(sky);
      this.scene.fog.color.setHex(sky);
      this.sun.intensity = rain ? 1.1 : storm ? 1.5 : 2.25;
      this.rain.visible = rain;
    }
    if (this.rain.visible) {
      this.rain.position.set(this.target.x, 0, this.target.z);
      const positions = this.rain.geometry.attributes.position;
      for (let i = 0; i < positions.count; i += 2) {
        let y = positions.getY(i) - .13;
        if (y < .4) y += 8;
        positions.setY(i, y); positions.setY(i + 1, y - .55);
      }
      positions.needsUpdate = true;
    }
    const updateMap = (items, map, maker) => {
      const ids = new Set(items.map(i => i.id));
      for (const [id, obj] of map) if (!ids.has(id)) { this.world.remove(obj); map.delete(id); }
      for (const item of items) if (!map.has(item.id)) {
        const obj = maker(item);
        this.world.add(obj);
        map.set(item.id, obj);
      }
    };
    updateMap(game.buildings, this.entities, makeBuilding);
    updateMap(game.nodes, this.nodes, makeNode);
    updateMap(game.colonists, this.units, makeColonist);
    updateMap(game.enemies, this.raiders, makeEnemy);
    for (const c of game.colonists) this.units.get(c.id).position.set(c.x, .02 + Math.sin(performance.now() * .005 + c.x) * .015, c.z);
    for (const e of game.enemies) this.raiders.get(e.id).position.set(e.x, .02, e.z);
    for (const n of game.nodes) {
      const obj = this.nodes.get(n.id);
      if (obj.userData.marked !== n.marked) {
        this.world.remove(obj); this.nodes.delete(n.id);
        const next = makeNode(n); next.userData.marked = n.marked;
        this.world.add(next); this.nodes.set(n.id, next);
      }
    }
  }
  tileFromClient(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height * 2 - 1));
    this.raycaster.setFromCamera(pointer, this.camera);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) return null;
    const x = Math.floor(point.x), z = Math.floor(point.z);
    return x >= 0 && z >= 0 && x < SIZE && z < SIZE ? { x, z } : null;
  }
  select(tile, valid = true) {
    this.selection.visible = !!tile;
    if (tile) {
      this.selection.position.set(tile.x + .5, .018, tile.z + .5);
      this.selection.material.color.set(valid ? 0x8ff0df : 0xff8e80);
    }
  }
  pan(dx, dy) {
    const scale = 18 / Math.min(this.container.clientWidth, this.container.clientHeight) / this.zoom;
    this.target.x = THREE.MathUtils.clamp(this.target.x + (-dx + dy) * scale, 3, SIZE - 3);
    this.target.z = THREE.MathUtils.clamp(this.target.z + (dx + dy) * scale, 3, SIZE - 3);
    this.updateCamera();
  }
  setZoom(value) { this.zoom = THREE.MathUtils.clamp(value, .65, 2.1); this.resize(); }
  updateCamera() {
    this.camera.position.copy(this.target).add(new THREE.Vector3(20, 24, 20));
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const span = 13 / this.zoom;
    this.camera.left = -span * aspect;
    this.camera.right = span * aspect;
    this.camera.top = span;
    this.camera.bottom = -span;
    this.updateCamera();
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
