import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildDoll } from './mechanics-doll.js';
import {
  BASE, DEFAULT_PROPORTIONS, HAND_STYLES, JOINT_IDS, JOINT_SPECS, LEGACY_STORE_KEY, PRESETS,
  PROPORTION_LABELS, STORE_KEY, blendSnapshots, clamp, clampJoint, jointEuler, lerp, migrateV1Library,
  mirrorPose, normalizeJoints,
} from './mechanics-data.js';

const ease = (t) => t * t * (3 - 2 * t);
const $ = (id) => document.getElementById(id);
const COLORS = { shell: '#efe7e2', joint: '#ec8a12', glow: '#ff8a1a' };
const VIEWS = { front: 0, side: Math.PI / 2, three: 0.72, back: Math.PI };
const UNDO_LIMIT = 80;

class BodyMechanics {
  constructor() {
    this.joints = normalizeJoints();
    this.body = { x: 0, y: 0, z: 0 };
    this.hands = 'fist';
    this.proportions = { ...DEFAULT_PROPORTIONS };
    this.selected = null;
    this.hovered = null;
    this.undoStack = [];
    this.poses = [];
    this.selectedPose = -1;
    this.animation = null;
    this.cam = { yaw: 0.72, pitch: 1.18, dist: 17, tyaw: 0.72, tpitch: 1.18, tdist: 17 };
    this.pointers = new Map();
    this.materials = new Map();
    this.glowColor = new THREE.Color(COLORS.glow);
    this.raycaster = new THREE.Raycaster();
    this.box = new THREE.Box3();

    this.initScene();
    this.loadLibrary();
    this.buildRig();
    this.initUI();
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------------------------------------------------------------- scene
  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000000');
    this.scene.fog = new THREE.Fog('#000000', 20, 36);
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    $('stage').appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    const key = new THREE.DirectionalLight('#fff4e8', 2.4);
    key.position.set(-5, 10, 7); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6; key.shadow.bias = -0.0004;
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 9, bottom: -3, near: 1, far: 30 });
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#c9d8ff', 1.1); rim.position.set(6, 6, -8); this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#1a1a1a', 0.35));

    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshStandardMaterial({ color: '#0e0e10', roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.94, 6, 96), new THREE.MeshBasicMaterial({ color: '#2b2b30' }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; this.scene.add(ring);
    const grid = new THREE.GridHelper(12, 24, '#232327', '#18181b');
    grid.position.y = 0.001; this.scene.add(grid);

    this.bindStage();
    addEventListener('resize', () => this.resize());
  }

  /** One material per (joint, kind) so a single limb can glow when hovered or selected. */
  material(joint, kind) {
    const key = `${joint}:${kind}`;
    if (!this.materials.has(key)) {
      this.materials.set(key, new THREE.MeshStandardMaterial({
        color: COLORS[kind], roughness: kind === 'joint' ? 0.45 : 0.62, metalness: 0, emissive: COLORS.glow, emissiveIntensity: 0,
      }));
      this.materials.get(key).userData.base = new THREE.Color(COLORS[kind]);
    }
    return this.materials.get(key);
  }

  dims() { const d = {}; for (const k in BASE) d[k] = BASE[k] * this.proportions[k]; return d; }

  buildRig() {
    if (this.rig) {
      this.scene.remove(this.rig.root);
      this.rig.root.traverse((o) => o.geometry?.dispose());
    }
    this.rig = buildDoll(this.dims(), (j, k) => this.material(j, k), this.hands);
    this.scene.add(this.rig.root);
    this.applyState();
    this.refreshHighlight();
  }

  applyJoint(id) {
    const r = jointEuler(id, this.joints[id]);
    this.rig.pivots[id].rotation.set(r.x, r.y, r.z);
  }

  /** Pose every joint, then drop the doll so its lowest point rests on the floor. */
  applyState() {
    if (!this.rig) return;
    for (const id of JOINT_IDS) this.applyJoint(id);
    const root = this.rig.root, D = Math.PI / 180;
    root.rotation.set(this.body.x * D, this.body.y * D, this.body.z * D);
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    this.box.setFromObject(root, true);
    root.position.y = -this.box.min.y;
    root.updateMatrixWorld(true);
    this.box.translate(new THREE.Vector3(0, root.position.y, 0));
  }

  refreshHighlight() {
    for (const [key, m] of this.materials) {
      const [joint, kind] = key.split(':');
      const level = joint === this.selected ? 1 : joint === this.hovered ? 0.45 : 0;
      // Tint the white shell toward orange and make the joint ball glow.
      m.color.copy(m.userData.base).lerp(this.glowColor, kind === 'joint' ? 0 : level * 0.45);
      m.emissiveIntensity = level * (kind === 'joint' ? 0.35 : 0.08);
    }
    this.renderer.domElement.style.cursor = this.drag ? 'grabbing' : this.hovered ? 'grab' : this.orbiting ? 'move' : 'default';
  }

  // ---------------------------------------------------------- interaction
  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.rig.parts, false)[0];
    return hit && hit.object.userData.joint ? hit : null;
  }

  bindStage() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      try { el.setPointerCapture(e.pointerId); } catch {}
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (this.pointers.size === 2) {
        this.endDrag();
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, dist: this.cam.tdist };
        return;
      }
      const hit = this.pick(e);
      if (hit) this.startDrag(e, hit);
      else this.orbiting = true;
      this.refreshHighlight();
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) { // plain hover
        const id = this.pick(e)?.object.userData.joint ?? null;
        if (id !== this.hovered) { this.hovered = id; this.refreshHighlight(); }
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        this.cam.tdist = clamp(this.pinch.dist * this.pinch.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1), 7, 24);
      } else if (this.drag?.pointerId === e.pointerId) {
        this.solveDrag(e.clientX, e.clientY);
      } else if (this.orbiting) {
        this.cam.tyaw -= dx * 0.008;
        this.cam.tpitch = clamp(this.cam.tpitch + dy * 0.006, 0.3, 1.55);
      }
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.drag?.pointerId === e.pointerId) this.endDrag();
      else if (this.orbiting && p && Math.hypot(p.x - p.sx, p.y - p.sy) < 4 && this.pointers.size === 0) this.selectJoint(null);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) this.orbiting = false;
      this.refreshHighlight();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => { if (!this.pointers.size && this.hovered) { this.hovered = null; this.refreshHighlight(); } });
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.tdist = clamp(this.cam.tdist * Math.exp(e.deltaY * 0.001), 7, 24); }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  startDrag(e, hit) {
    const id = hit.object.userData.joint;
    if (this.animation) this.stopAnimation(false);
    this.pushUndo();
    this.selectJoint(id);
    const pivot = this.rig.pivots[id], tip = this.rig.tips[id];
    // Pin the exact point that was grabbed under the cursor; points too close to the
    // pivot have no leverage, so fall back to the end of the limb.
    const local = pivot.worldToLocal(hit.point.clone());
    this.drag = { id, pointerId: e.pointerId, local: local.length() > tip.length() * 0.4 ? local : tip.clone() };
  }

  endDrag() { this.drag = null; }

  /**
   * Turn the joint (within its human limits) so the grabbed point follows the cursor.
   * Small coordinate search over the joint's swing axes in screen space; cheap and stable.
   */
  solveDrag(clientX, clientY) {
    const { id, local } = this.drag;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const tx = clientX - rect.left, ty = clientY - rect.top;
    const pivot = this.rig.pivots[id], st = this.joints[id], axes = JOINT_SPECS[id].drag;
    const start = { ...st }, v = new THREE.Vector3();
    const cost = () => {
      this.applyJoint(id);
      pivot.updateWorldMatrix(false, false);
      v.copy(local).applyMatrix4(pivot.matrixWorld).project(this.camera);
      const px = (v.x * 0.5 + 0.5) * rect.width, py = (-v.y * 0.5 + 0.5) * rect.height;
      let reg = 0;
      for (const a of axes) reg += (st[a] - start[a]) ** 2;
      return (px - tx) ** 2 + (py - ty) ** 2 + reg * 0.04;
    };
    let best = cost(), step = 8;
    for (let i = 0; i < 80 && step > 0.15; i++) {
      let improved = false;
      for (const a of axes) for (const dir of [1, -1]) {
        const old = st[a], next = clampJoint(id, a, old + dir * step);
        if (next === old) continue;
        st[a] = next;
        const c = cost();
        if (c < best - 1e-6) { best = c; improved = true; } else st[a] = old;
      }
      if (!improved) step /= 2;
    }
    this.applyState();
    this.syncJointSliders();
  }

  selectJoint(id) {
    this.selected = id;
    this.renderJointEditor();
    this.refreshHighlight();
    this.updateHint();
  }

  setJointValue(id, axis, value) {
    this.joints[id][axis] = clampJoint(id, axis, value);
    this.applyState();
  }

  // ---------------------------------------------------------------- undo
  snapshot() { return { joints: structuredClone(this.joints), body: { ...this.body }, hands: this.hands }; }
  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    $('undo').disabled = false;
  }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    if (this.animation) this.stopAnimation(false);
    const handsChanged = s.hands !== this.hands;
    this.joints = s.joints; this.body = s.body; this.hands = s.hands;
    if (handsChanged) this.buildRig(); else this.applyState();
    this.syncAllInputs();
    $('undo').disabled = !this.undoStack.length;
  }

  // ------------------------------------------------------------------- UI
  initUI() {
    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => this.openTab(b.dataset.tab)));
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
    $('panelToggle').addEventListener('click', () => $('panel').classList.add('open'));
    $('panelClose').addEventListener('click', () => $('panel').classList.remove('open'));
    $('undo').addEventListener('click', () => this.undo());
    $('resetPose').addEventListener('click', () => this.applyPreset('neutral'));
    $('mirrorPose').addEventListener('click', () => this.mirror());
    $('resetJoint').addEventListener('click', () => {
      if (!this.selected) return;
      this.pushUndo(); this.joints[this.selected] = { x: 0, y: 0, z: 0 }; this.applyState(); this.syncJointSliders();
    });
    $('resetProportions').addEventListener('click', () => { this.proportions = { ...DEFAULT_PROPORTIONS }; this.buildRig(); this.renderProportionSliders(); this.toast('Proportions reset'); });
    $('addPose').addEventListener('click', () => this.addPose());
    $('updatePose').addEventListener('click', () => this.updateSelectedPose());
    $('playSequence').addEventListener('click', () => this.playSequence());
    $('stopSequence').addEventListener('click', () => this.stopAnimation());
    $('poseDuration').addEventListener('input', (e) => { $('poseDurationOut').textContent = `${(+e.target.value).toFixed(1)}s`; this.saveLibrary(); });
    $('loopPlayback').addEventListener('change', () => this.saveLibrary());
    addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.target.tagName !== 'INPUT') { e.preventDefault(); this.undo(); }
      if (e.key === 'Escape') this.selectJoint(null);
    });

    this.renderPresets();
    this.renderJointPicker();
    this.renderHandToggle();
    this.renderBodySliders();
    this.renderProportionSliders();
    this.renderJointEditor();
    this.renderPoseList();
    this.updateTransport();
    this.updateHint();
    $('poseDurationOut').textContent = `${(+$('poseDuration').value).toFixed(1)}s`;
  }

  openTab(name) {
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  }

  renderPresets() {
    const c = $('presets'); c.innerHTML = '';
    for (const [key, p] of Object.entries(PRESETS)) {
      const b = document.createElement('button'); b.textContent = p.name; b.addEventListener('click', () => this.applyPreset(key)); c.appendChild(b);
    }
  }

  renderJointPicker() {
    const c = $('jointPicker'); c.innerHTML = '';
    const groups = {};
    for (const id of JOINT_IDS) (groups[JOINT_SPECS[id].group] ||= []).push(id);
    for (const [group, ids] of Object.entries(groups)) {
      const row = document.createElement('div'); row.className = 'picker-row';
      row.innerHTML = `<span>${group}</span>`;
      for (const id of ids) {
        const b = document.createElement('button'); b.dataset.joint = id;
        const spec = JOINT_SPECS[id];
        b.textContent = spec.side ? `${spec.side === 'left' ? 'L' : 'R'} ${spec.label.split(' ')[1]}` : spec.label;
        b.title = spec.label;
        b.addEventListener('click', () => this.selectJoint(this.selected === id ? null : id));
        row.appendChild(b);
      }
      c.appendChild(row);
    }
  }

  renderHandToggle() {
    const c = $('handStyle'); c.innerHTML = '';
    for (const [key, label] of Object.entries(HAND_STYLES)) {
      const b = document.createElement('button'); b.textContent = label; b.dataset.hand = key;
      b.addEventListener('click', () => { if (this.hands === key) return; this.pushUndo(); this.hands = key; this.buildRig(); this.syncHandToggle(); });
      c.appendChild(b);
    }
    this.syncHandToggle();
  }
  syncHandToggle() { document.querySelectorAll('[data-hand]').forEach((b) => b.classList.toggle('active', b.dataset.hand === this.hands)); }

  /** Slider with the meaning of each end written underneath, e.g. "Back ··· Forward". */
  slider(container, { label, min, max, step = 1, value, format, neg, pos, onInput }) {
    const row = document.createElement('div'); row.className = 'slider-row';
    row.innerHTML = `<label><span>${label}</span><output></output></label><input type="range" min="${min}" max="${max}" step="${step}">${neg ? `<div class="ends"><span>${neg}</span><span>${pos}</span></div>` : ''}`;
    const input = row.querySelector('input'), out = row.querySelector('output');
    const show = (v) => { out.textContent = format(v); };
    input.value = value; show(value);
    let gesture = false;
    input.addEventListener('input', () => {
      if (!gesture) { this.pushUndo(); gesture = true; }
      show(+input.value); onInput(+input.value);
    });
    input.addEventListener('change', () => { gesture = false; });
    container.appendChild(row);
    return { set: (v) => { input.value = v; show(v); } };
  }

  renderJointEditor() {
    const c = $('jointSliders'); c.innerHTML = '';
    this.jointInputs = {};
    document.querySelectorAll('#jointPicker [data-joint]').forEach((b) => b.classList.toggle('active', b.dataset.joint === this.selected));
    $('resetJoint').hidden = !this.selected;
    if (!this.selected) {
      $('jointTitle').textContent = 'Joints';
      c.innerHTML = '<p class="empty">Click any part of the doll and drag it — the limb follows your pointer and stops at natural human limits. Or pick a joint above for exact angles.</p>';
      return;
    }
    const id = this.selected, spec = JOINT_SPECS[id];
    $('jointTitle').textContent = spec.label;
    for (const a of spec.axes) {
      this.jointInputs[a.axis] = this.slider(c, {
        label: a.label, min: a.min, max: a.max, value: this.joints[id][a.axis], neg: a.neg, pos: a.pos,
        format: (v) => `${Math.round(v)}°`, onInput: (v) => this.setJointValue(id, a.axis, v),
      });
    }
  }
  syncJointSliders() {
    if (!this.selected) return;
    for (const [axis, s] of Object.entries(this.jointInputs)) s.set(this.joints[this.selected][axis]);
  }

  renderBodySliders() {
    const c = $('bodySliders'); c.innerHTML = ''; this.bodyInputs = {};
    for (const [axis, label, min, max, neg, pos] of [['y', 'Turn', -180, 180, 'Right', 'Left'], ['x', 'Lean', -100, 100, 'Back', 'Forward'], ['z', 'Tilt', -100, 100, 'Left', 'Right']]) {
      this.bodyInputs[axis] = this.slider(c, { label, min, max, value: this.body[axis], neg, pos, format: (v) => `${Math.round(v)}°`, onInput: (v) => { this.body[axis] = v; this.applyState(); } });
    }
  }

  renderProportionSliders() {
    const c = $('proportionSliders'); c.innerHTML = '';
    for (const [key, label] of Object.entries(PROPORTION_LABELS)) {
      this.slider(c, { label, min: 0.7, max: 1.3, step: 0.01, value: this.proportions[key], format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { this.proportions[key] = v; this.buildRig(); } });
    }
  }

  syncAllInputs() {
    this.renderJointEditor();
    for (const [axis, s] of Object.entries(this.bodyInputs)) s.set(this.body[axis]);
    this.syncHandToggle();
  }

  updateHint() {
    const spec = this.selected && JOINT_SPECS[this.selected];
    $('hint').innerHTML = spec
      ? `<b>${spec.label}</b> · drag the limb to pose · <kbd>Esc</kbd> to deselect`
      : '<b>Drag a body part</b> to pose · drag the background to orbit · scroll or pinch to zoom';
  }

  // -------------------------------------------------------------- poses
  applyPreset(key) {
    const p = PRESETS[key]; if (!p) return;
    if (this.animation) this.stopAnimation(false);
    this.pushUndo();
    this.joints = normalizeJoints(p.joints);
    [this.body.x, this.body.y, this.body.z] = p.body;
    this.applyState(); this.syncAllInputs();
    this.toast(`${p.name}`);
  }

  mirror() {
    this.pushUndo();
    const m = mirrorPose({ joints: this.joints, body: this.body });
    this.joints = m.joints; this.body = m.body;
    if (this.selected && JOINT_SPECS[this.selected].side) {
      this.selected = this.selected.startsWith('left') ? this.selected.replace('left', 'right') : this.selected.replace('right', 'left');
    }
    this.applyState(); this.syncAllInputs(); this.refreshHighlight(); this.updateHint();
    this.toast('Pose mirrored');
  }

  capture() { return { ...this.snapshot(), proportions: { ...this.proportions } }; }

  loadSnapshot(data) {
    if (this.animation) this.stopAnimation(false);
    this.pushUndo();
    this.joints = normalizeJoints(data.joints);
    this.body = { x: 0, y: 0, z: 0, ...data.body };
    this.proportions = { ...DEFAULT_PROPORTIONS, ...data.proportions };
    this.hands = HAND_STYLES[data.hands] ? data.hands : 'fist';
    this.buildRig(); this.syncAllInputs(); this.renderProportionSliders();
  }

  addPose() {
    this.poses.push({ id: Date.now() + Math.random(), name: `Pose ${this.poses.length + 1}`, data: this.capture() });
    this.selectedPose = this.poses.length - 1;
    this.saveLibrary(); this.renderPoseList(); this.updateTransport(); this.toast('Pose saved');
  }
  updateSelectedPose() {
    const p = this.poses[this.selectedPose]; if (!p) return;
    p.data = this.capture(); this.saveLibrary(); this.renderPoseList(); this.toast('Pose updated');
  }
  deletePose(i) {
    this.poses.splice(i, 1);
    this.selectedPose = Math.min(this.selectedPose, this.poses.length - 1);
    this.saveLibrary(); this.renderPoseList(); this.updateTransport();
  }

  renderPoseList() {
    const c = $('poseList'); c.innerHTML = '';
    $('poseCount').textContent = `${this.poses.length} saved`;
    $('updatePose').disabled = this.selectedPose < 0;
    if (!this.poses.length) { c.innerHTML = '<div class="pose-empty">No poses yet. Pose the doll, then add it here.</div>'; return; }
    this.poses.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = `pose-item${i === this.selectedPose ? ' selected' : ''}`;
      row.innerHTML = `<span class="num">${i + 1}</span><input class="pose-name" aria-label="Pose name"><button class="load">Load</button><button class="delete" aria-label="Delete pose">×</button>`;
      const name = row.querySelector('input'); name.value = p.name;
      row.addEventListener('click', () => { this.selectedPose = i; this.renderPoseList(); });
      row.querySelector('.load').addEventListener('click', (e) => { e.stopPropagation(); this.selectedPose = i; this.loadSnapshot(p.data); this.renderPoseList(); });
      row.querySelector('.delete').addEventListener('click', (e) => { e.stopPropagation(); this.deletePose(i); });
      name.addEventListener('click', (e) => e.stopPropagation());
      name.addEventListener('change', () => { p.name = name.value.trim() || `Pose ${i + 1}`; this.saveLibrary(); });
      c.appendChild(row);
    });
  }

  loadLibrary() {
    let lib = null;
    try {
      lib = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!lib) {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_STORE_KEY) || 'null');
        if (legacy) lib = migrateV1Library(legacy);
      }
    } catch { lib = null; }
    this.poses = Array.isArray(lib?.poses) ? lib.poses : [];
    if (lib?.duration) $('poseDuration').value = lib.duration;
    if (typeof lib?.loop === 'boolean') $('loopPlayback').checked = lib.loop;
  }
  saveLibrary() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ poses: this.poses, duration: +$('poseDuration').value, loop: $('loopPlayback').checked })); } catch {}
  }

  // ---------------------------------------------------------- playback
  playSequence() {
    if (this.poses.length < 2) { this.openTab('sequence'); $('panel').classList.add('open'); this.toast('Save at least two poses first'); return; }
    this.startTween(0, performance.now());
    $('playSequence').disabled = true; $('stopSequence').disabled = false;
    $('transportTitle').textContent = 'Playing';
  }
  startTween(index, now) {
    const to = this.poses[index].data;
    const propsChanged = Object.keys(DEFAULT_PROPORTIONS).some((k) => Math.abs((to.proportions?.[k] ?? 1) - this.proportions[k]) > 0.001);
    const hands = HAND_STYLES[to.hands] ? to.hands : this.hands;
    if (propsChanged || hands !== this.hands) {
      this.proportions = { ...DEFAULT_PROPORTIONS, ...to.proportions }; this.hands = hands;
      this.buildRig(); this.renderProportionSliders(); this.syncHandToggle();
    }
    this.animation = { index, start: now, from: this.capture(), to: { ...to, joints: normalizeJoints(to.joints) } };
  }
  updateAnimation(now) {
    const a = this.animation;
    const t = clamp((now - a.start) / (+$('poseDuration').value * 1000), 0, 1);
    const blend = blendSnapshots(a.from, a.to, ease(t));
    this.joints = blend.joints; this.body = blend.body;
    this.applyState();
    $('transportStatus').textContent = `Pose ${a.index + 1} of ${this.poses.length}`;
    if (t < 1) return;
    let next = a.index + 1;
    if (next >= this.poses.length) {
      if (!$('loopPlayback').checked) { this.stopAnimation(false); this.toast('Sequence complete'); return; }
      next = 0;
    }
    this.startTween(next, now);
  }
  stopAnimation(show = true) {
    this.animation = null;
    $('playSequence').disabled = false; $('stopSequence').disabled = true;
    this.updateTransport(); this.syncAllInputs();
    if (show) this.toast('Playback stopped');
  }
  updateTransport() {
    $('transportTitle').textContent = this.poses.length ? `${this.poses.length} pose${this.poses.length === 1 ? '' : 's'}` : 'Sequence';
    $('transportStatus').textContent = this.poses.length < 2 ? 'Save two or more poses to animate' : 'Ready to play';
  }

  // ------------------------------------------------------------ camera
  setView(name) {
    this.cam.tyaw = VIEWS[name]; this.cam.tpitch = 1.18;
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  }
  updateCamera(dt) {
    const c = this.cam, k = 1 - Math.exp(-dt * 7);
    c.yaw = lerp(c.yaw, c.tyaw, k); c.pitch = lerp(c.pitch, c.tpitch, k); c.dist = lerp(c.dist, c.tdist, k);
    const centre = this.box.getCenter(new THREE.Vector3());
    // While dragging, hold the camera still so the limb under the pointer doesn't swim.
    if (!this.lookTarget) this.lookTarget = centre.clone();
    else if (!this.drag) this.lookTarget.lerp(centre, k * 0.6);
    const dist = c.dist * (this.camera.aspect < 0.8 ? 1.18 : 1); // step back a little on portrait phones
    const sp = Math.sin(c.pitch), t = this.lookTarget;
    this.camera.position.set(t.x + Math.sin(c.yaw) * sp * dist, t.y + Math.cos(c.pitch) * dist, t.z + Math.cos(c.yaw) * sp * dist);
    this.camera.lookAt(t);
  }
  resize() {
    const r = $('stage').getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h, false);
  }
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0); this.last = now;
    if (this.animation) this.updateAnimation(now);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  toast(text) {
    const el = $('toast'); el.textContent = text;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => el.classList.remove('show'), 1700);
  }
}

window.bodyMechanics = new BodyMechanics();
