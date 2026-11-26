// Kaboom Critters — game shell: menus, campaign, skirmish, HUD, input, the 2D/3D camera and the loop.
import * as THREE from 'three';
import * as Sim from './critters-sim.js';
import { WEAPONS, WEAPON_ORDER, INF } from './critters-sim.js';
import { createCpu } from './critters-ai.js';
import {
  THEMES, THEME_KEYS, STAGES, LEVELS, DIFFS, TEAM_COLORS, SHAPES, SKIRMISH_DEFAULTS, levelMatch, skirmishMatch, demoMatch,
} from './critters-levels.js';
import { createWorld } from './critters-world.js';
import { createSprites } from './critters-sprites.js';
import { createAudio } from './critters-audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SAVE_KEY = 'kaboom-critters-v1';
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ------------------------------------------------------------------ save
const save = loadSave();
function loadSave() {
  const base = { diff: 'easy', medals: {}, stage: 0, settings: { sound: true, quality: 'high', guide: true, cam: '2d', sprites: true, artPicked: false }, skirmish: { ...SKIRMISH_DEFAULTS }, helped: false };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s && typeof s === 'object') {
      const out = { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) }, skirmish: { ...base.skirmish, ...(s.skirmish || {}) } };
      // 2D sprites are the default art style unless the player picked one themselves
      if (!out.settings.artPicked) out.settings.sprites = true;
      return out;
    }
  } catch { /* broken save: start fresh */ }
  return base;
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* storage blocked */ } }

const audio = createAudio();
audio.setEnabled(save.settings.sound);

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);
const canvas = renderer.domElement;
const world = createWorld();
const camera = world.camera;
// flat 2D sprite renderer drawn on its own canvas over the 3D one (input still goes to the 3D canvas)
const spriteCanvas = document.createElement('canvas');
spriteCanvas.className = 'sprites';
$('stage').appendChild(spriteCanvas);
const sprites = createSprites(spriteCanvas);
const spritesOn = () => save.settings.sprites;
const view = () => (spritesOn() ? sprites : world);
let worldStale = false; // the 3D terrain missed craters while sprites were drawing
function applyQuality() {
  const hi = save.settings.quality === 'high';
  renderer.setPixelRatio(Math.min(hi ? 2 : 1, window.devicePixelRatio || 1));
  sprites.resize(innerWidth, innerHeight, Math.min(hi ? 2 : 1, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = hi;
  world.setShadows(hi);
  world.scene.traverse((o) => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  sprites.resize(innerWidth, innerHeight, Math.min(save.settings.quality === 'high' ? 2 : 1, window.devicePixelRatio || 1));
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
applyQuality();

// ------------------------------------------------------------------ state
const G = {
  S: null, cpu: null, mode: null, level: null, cfg: null, human: -1, diff: save.diff,
  paused: false, over: false, overT: 0, resultShown: false, target: null, charge: null,
  fireDown: 0, fireTimer: 0, btn: { left: false, right: false }, lastBoom: null, turnsPlayed: 0, tick: -1, demoT: 0,
};
const cam = { mode: '2d', blend: 0, yaw: 0.7, pitch: 0.3, spin: true, fx: 800, fy: 400, zoom: 1, free: false, spinPause: 0, dragging: false };

const humanTurn = () => {
  const S = G.S;
  if (!S || G.mode === 'demo' || S.result) return false;
  const c = Sim.active(S);
  return !!c && !S.teams[c.team].cpu && (S.phase === 'turn' || S.phase === 'start');
};
const canMove = () => { const S = G.S; return humanTurn() || (S && S.phase === 'retreat' && Sim.active(S) && !S.teams[Sim.active(S).team].cpu); };

// ------------------------------------------------------------------ screens
const screens = ['title', 'campaign', 'skirmish'];
function show(id) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
  $('hud').classList.toggle('hidden', id !== 'hud');
  $('tags').classList.toggle('hidden', id !== 'hud');
  $('pops').classList.toggle('hidden', id !== 'hud');
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
function modal(html, onBind) {
  $('modalCard').innerHTML = html;
  $('modal').classList.remove('hidden');
  if (onBind) onBind($('modalCard'));
}
function closeModal() { $('modal').classList.add('hidden'); }

// difficulty pickers (title, campaign, skirmish share one setting)
function renderDiffRows() {
  for (const id of ['diffRow', 'diffRow2', 'diffRow3']) {
    const row = $(id);
    row.innerHTML = DIFFS.map((d) => `<button role="radio" aria-checked="${d.id === G.diff}" class="${d.id === G.diff ? 'on' : ''}" data-d="${d.id}">${d.icon} ${d.name}<small>${d.blurb}</small></button>`).join('');
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.diff-row button');
  if (!b) return;
  G.diff = save.diff = b.dataset.d;
  persist();
  audio.click();
  renderDiffRows();
});

// ------------------------------------------------------------------ title & demo
function toTitle() {
  closeModal();
  G.paused = false;
  show('title');
  const done = LEVELS.filter((L) => save.medals[L.id] != null).length;
  $('mCampProg').textContent = done ? `${done} / ${LEVELS.length} won` : '';
  renderDiffRows();
  startDemo();
}
function startDemo() {
  const cfg = demoMatch((Math.random() * 1e9) >>> 0);
  startMatch(cfg, 'demo', null);
  audio.setQuiet(0);
  cam.mode = spritesOn() ? '2d' : '3d'; cam.blend = cam.mode === '3d' ? 1 : 0; cam.spin = true; cam.zoom = 0.75; cam.pitch = 0.32;
}
$('mCampaign').onclick = () => { audio.unlock(); audio.click(); openCampaign(); };
$('mSkirmish').onclick = () => { audio.unlock(); audio.click(); openSkirmish(); };
$('mHelp').onclick = () => { audio.unlock(); showHelp(); };
$('mSettings').onclick = () => { audio.unlock(); showSettings(false); };
if (document.documentElement.requestFullscreen && isTouch) $('mFull').classList.remove('hidden');
$('mFull').onclick = () => goFullscreen();
function goFullscreen() {
  const el = document.documentElement;
  const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
  if (p && p.then) p.then(lockLandscape).catch(() => {});
}
function lockLandscape() { try { const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); } catch { /* not supported */ } }

// ------------------------------------------------------------------ campaign
let campStage = save.stage || 0;
const unlocked = (i) => i === 0 || save.medals[LEVELS[i - 1].id] != null;
function openCampaign() {
  show('campaign');
  renderDiffRows();
  renderCampaign();
}
$('campBack').onclick = () => { audio.click(); toTitle(); };
function renderCampaign() {
  const tabs = $('stageTabs');
  tabs.innerHTML = STAGES.map((st, i) => {
    const lv = LEVELS.filter((L) => L.stage === i);
    const got = lv.filter((L) => save.medals[L.id] != null).length;
    const open = unlocked(LEVELS.indexOf(lv[0]));
    return `<button class="stab ${i === campStage ? 'on' : ''} ${open ? '' : 'locked'}" data-s="${i}"><i>${THEMES[st.theme].emoji}</i><span><b>${i + 1}. ${st.name}</b><small>${open ? `${got}/4 won` : 'Locked'}</small></span></button>`;
  }).join('');
  tabs.querySelectorAll('.stab').forEach((b) => (b.onclick = () => { campStage = +b.dataset.s; save.stage = campStage; persist(); audio.click(); renderCampaign(); }));
  const st = STAGES[campStage];
  $('stageBlurb').textContent = `${THEMES[st.theme].emoji} ${st.blurb}  Foes: ${st.foe}.`;
  const sky = THEMES[st.theme].sky;
  $('levelGrid').innerHTML = LEVELS.map((L, i) => ({ L, i })).filter(({ L }) => L.stage === campStage).map(({ L, i }) => {
    const m = save.medals[L.id];
    const shape = SHAPES.find((s) => s.id === L.shape);
    return `<button class="lcard ${L.boss ? 'boss' : ''} ${unlocked(i) ? '' : 'locked'}" data-i="${i}" style="--g:linear-gradient(135deg, ${sky[0]}, ${sky[1]})">
      <span class="num">LEVEL ${L.id}</span><span class="ico">${L.boss ? '👑' : shape.icon}</span>
      <b>${L.name}</b><small>${L.p[0]} vs ${L.c[0]}${L.boss ? ' + boss' : ''} · ${shape.name}</small>
      <span class="medals">${DIFFS.map((d, k) => `<span class="${m != null && m >= k ? 'got' : ''}" title="${d.name}">${d.medal}</span>`).join('')}</span>
    </button>`;
  }).join('');
  $('levelGrid').querySelectorAll('.lcard').forEach((b) => (b.onclick = () => {
    const i = +b.dataset.i;
    if (!unlocked(i)) { toast('Win the previous battle to unlock this one'); return; }
    audio.click();
    levelIntro(i);
  }));
}
function rulesChips(cfg, L) {
  const out = [];
  out.push(cfg.wind >= 0.8 ? '🌪️ Wild wind' : cfg.wind >= 0.45 ? '💨 Breezy' : cfg.wind > 0 ? '🍃 Light wind' : '🚫 No wind');
  if (cfg.gravity < 1) out.push('🪐 Low gravity');
  if (cfg.slippery) out.push('🧊 Slippery');
  if (cfg.mines) out.push(`⚙️ ${cfg.mines} mines`);
  if (cfg.barrels) out.push(`🛢️ ${cfg.barrels} barrels`);
  if (cfg.girders) out.push('🧱 Steel beams');
  if (cfg.suddenDeath) out.push(`🌊 Sudden death: round ${cfg.suddenDeath}`);
  if (cfg.crates) out.push('🎁 Crates');
  if (L && L.boss) out.push(`👑 ${L.boss[0]}`);
  return out.map((s) => `<span>${s}</span>`).join('');
}
function levelIntro(i) {
  const L = LEVELS[i];
  const st = STAGES[L.stage];
  const cfg = levelMatch(L, G.diff);
  const m = save.medals[L.id];
  modal(`
    <p class="kicker">${THEMES[st.theme].emoji} ${st.name} · Level ${L.id}${L.boss ? ' · Boss' : ''}</p>
    <h3>${L.name}</h3>
    <div class="rules">${rulesChips(cfg, L)}</div>
    <p class="tip">💡 ${L.tip}</p>
    <p style="margin-top:.6em;font-weight:700">CPU difficulty</p>
    <div class="diff-row" id="introDiff">${DIFFS.map((d, k) => `<button class="${d.id === G.diff ? 'on' : ''}" data-d="${d.id}">${d.icon} ${d.name} ${m != null && m >= k ? d.medal : ''}</button>`).join('')}</div>
    <div class="row"><button class="go gray" id="introBack">Back</button><button class="go big" id="introGo">⚔️ Fight!</button></div>`, (card) => {
    card.querySelector('#introBack').onclick = () => { audio.click(); closeModal(); if (G.mode === 'campaign' && G.over) openCampaignFromMatch(); };
    card.querySelector('#introGo').onclick = () => { audio.unlock(); closeModal(); playLevel(i); };
    card.querySelectorAll('#introDiff button').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); G.diff = save.diff = b.dataset.d; persist(); audio.click(); levelIntro(i); renderDiffRows(); }));
  });
}
function playLevel(i) {
  const L = LEVELS[i];
  startMatch(levelMatch(L, G.diff), 'campaign', i);
}

// ------------------------------------------------------------------ skirmish
let skSeed = (Math.random() * 1e9) >>> 0;
function openSkirmish() {
  show('skirmish');
  renderDiffRows();
  renderSkirmish();
}
$('skBack').onclick = () => { audio.click(); toTitle(); };
$('skReroll').onclick = () => { audio.click(); skSeed = (Math.random() * 1e9) >>> 0; drawPreview(); };
$('skStart').onclick = () => { audio.unlock(); audio.click(); startMatch(skirmishMatch(save.skirmish, G.diff, skSeed), 'skirmish', null); skSeed = (Math.random() * 1e9) >>> 0; };
const SK_ROWS = [
  ['Theme', 'theme', [['random', '🎲 Random'], ...THEME_KEYS.map((k) => [k, `${THEMES[k].emoji} ${THEMES[k].name}`])]],
  ['Terrain', 'shape', [['random', '🎲 Random'], ...SHAPES.map((s) => [s.id, `${s.icon} ${s.name}`])]],
  ['Map size', 'size', [['S', 'Small'], ['M', 'Medium'], ['L', 'Large']]],
  ['Your critters', 'you', [1, 2, 3, 4, 5, 6].map((n) => [n, String(n)])],
  ['Team colour', 'color', TEAM_COLORS.map((c, i) => [i, c])],
  ['CPU teams', 'cpus', [1, 2, 3].map((n) => [n, String(n)])],
  ['CPU critters', 'cpuSize', [1, 2, 3, 4, 5, 6].map((n) => [n, String(n)])],
  ['Health', 'hp', [50, 100, 150, 200].map((n) => [n, String(n)])],
  ['Turn time', 'turn', [30, 45, 60, 90].map((n) => [n, n + 's'])],
  ['Wind', 'wind', [['off', 'Off'], ['calm', 'Calm'], ['normal', 'Normal'], ['wild', 'Wild']]],
  ['Gravity', 'gravity', [['normal', 'Normal'], ['low', 'Low 🪐'], ['theme', 'By theme']]],
  ['Weapons', 'arsenal', [['start', 'Basic'], ['full', 'Full'], ['boss', 'Loaded']]],
  ['Sudden death', 'sudden', [[0, 'Off'], [5, 'Round 5'], [10, 'Round 10'], [15, 'Round 15']]],
  ['Mines', 'mines', [[true, 'On'], [false, 'Off']]],
  ['Barrels', 'barrels', [[true, 'On'], [false, 'Off']]],
  ['Crates', 'crates', [[true, 'On'], [false, 'Off']]],
];
function renderSkirmish() {
  const o = save.skirmish;
  $('skForm').innerHTML = SK_ROWS.map(([label, key, opts]) => `<label>${label}</label><div class="chips">${opts.map(([v, t]) => key === 'color'
    ? `<button class="chip sw ${o[key] === v ? 'on' : ''}" style="--c:${t}" data-k="${key}" data-v="${v}" aria-label="Colour ${v + 1}"></button>`
    : `<button class="chip ${o[key] === v ? 'on' : ''}" data-k="${key}" data-v="${v}">${t}</button>`).join('')}</div>`).join('');
  $('skForm').querySelectorAll('.chip').forEach((b) => (b.onclick = () => {
    const row = SK_ROWS.find((r) => r[1] === b.dataset.k);
    const opt = row[2].find(([v]) => String(v) === b.dataset.v);
    save.skirmish[b.dataset.k] = opt[0];
    persist();
    audio.click();
    renderSkirmish();
  }));
  drawPreview();
}
function drawPreview() {
  const cfg = skirmishMatch(save.skirmish, G.diff, skSeed);
  const th = THEMES[cfg.theme];
  const W = cfg.W, H = Sim.WORLD_H;
  const mask = Sim.generateTerrain({ W, H, shape: cfg.shape, seed: cfg.seed, water: 70, girders: cfg.girders, caves: cfg.caves });
  const cv = $('skPreview');
  const cw = 360, ch = Math.round((cw * 0.82 * H) / W) + 20;
  cv.width = cw; cv.height = ch;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, th.sky[0]); grad.addColorStop(0.6, th.sky[1]); grad.addColorStop(1, th.sky[2]);
  g.fillStyle = grad;
  g.fillRect(0, 0, cw, ch);
  const sx = W / cw, sy = H / (ch - 4);
  const img = g.getImageData(0, 0, cw, ch);
  const top = hexRgb(th.top), soil = hexRgb(th.soil[0]), steel = hexRgb(th.steel);
  for (let py = 0; py < ch; py++) {
    const wy = Math.floor((ch - 1 - py) * sy);
    if (wy >= H) continue;
    for (let px = 0; px < cw; px++) {
      const wx = Math.floor(px * sx);
      const v = mask[wy * W + wx];
      if (!v) continue;
      const above = wy + 10 < H ? mask[(wy + 10) * W + wx] : 0;
      const c = v === 2 ? steel : above ? soil : top;
      const i = (py * cw + px) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = th.water;
  g.globalAlpha = 0.85;
  g.fillRect(0, ch - 1 - 70 / sy, cw, 70 / sy + 2);
  g.globalAlpha = 1;
  const sh = SHAPES.find((s) => s.id === cfg.shape);
  $('skMapName').textContent = `${th.emoji} ${th.name} · ${sh.icon} ${sh.name} · ${cfg.teams.length} teams`;
}
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

// ------------------------------------------------------------------ match lifecycle
function startMatch(cfg, mode, level) {
  closeModal();
  G.S = Sim.createMatch(cfg);
  G.cpu = createCpu(G.S);
  G.mode = mode; G.level = level; G.cfg = cfg;
  G.human = cfg.teams.findIndex((t) => !t.cpu);
  G.over = false; G.overT = 0; G.resultShown = false; G.target = null; G.charge = null; G.paused = false;
  G.turnsPlayed = 0; G.lastBoom = null; G.demoT = 0;
  world.load(G.S, cfg.theme);
  worldStale = false;
  if (spritesOn()) sprites.load(G.S, cfg.theme);
  applyQuality();
  const c = Sim.active(G.S);
  cam.fx = c ? c.x : cfg.W / 2;
  cam.fy = c ? c.y + 60 : 400;
  cam.zoom = 1.3; cam.free = false;
  if (mode !== 'demo') {
    audio.setQuiet(1);
    cam.mode = spritesOn() ? '2d' : save.settings.cam;
    cam.blend = cam.mode === '3d' ? 1 : 0;
    cam.yaw = 0.7; cam.pitch = 0.3;
    show('hud');
    buildTeamBars();
    clearTags();
    updateCamButtons();
    if (mode === 'campaign' && !save.helped) { save.helped = true; persist(); setTimeout(() => showHelp(true), 300); }
  } else clearTags();
}
function restartMatch() {
  if (G.mode === 'campaign') playLevel(G.level);
  else if (G.cfg) startMatch({ ...G.cfg, seed: G.cfg.seed }, G.mode, G.level);
}

// ------------------------------------------------------------------ HUD: team bars, tags, pops, banner
function buildTeamBars() {
  const S = G.S;
  $('teamBars').innerHTML = S.teams.map((t, i) => `<div class="tbar" id="tb${i}" style="--c:${t.color}"><small><span>${t.cpu ? '🤖 ' : '⭐ '}${t.name}</span><em id="tbh${i}"></em></small><div class="bar"><i id="tbf${i}"></i></div></div>`).join('');
}
const tagEls = new Map();
function clearTags() { $('tags').innerHTML = ''; tagEls.clear(); $('pops').innerHTML = ''; pops.length = 0; }
const pops = [];
function addPop(x, y, text, cls, color, life = 1.2, rise = 50) {
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.textContent = text;
  if (color) el.style.setProperty('--c', color);
  $('pops').appendChild(el);
  pops.push({ el, x, y, t: 0, life, rise });
}
let bannerT = 0;
function banner(main, sub = '', dur = 1.8) {
  const b = $('banner');
  b.innerHTML = '';
  b.append(main);
  if (sub) { const s = document.createElement('small'); s.textContent = sub; b.append(s); }
  b.classList.add('show');
  bannerT = dur;
}
const WORDS = ['KABOOM!', 'BLAM!', 'POW!', 'WHAM!', 'BOOM!', 'KAPOW!', 'BAM!', 'ZOINK!'];
const WORD_COLORS = ['#ffd23a', '#ff4fa3', '#7ef0ff', '#3fcf5a', '#ff8a1f', '#a46bff'];

const screenPt = { x: 0, y: 0, vis: false };
function updateTags() {
  const S = G.S;
  if (!S || G.mode === 'demo') return;
  const w = innerWidth, h = innerHeight;
  const seen = new Set();
  const far = cam.zoom < 0.7;
  for (const b of S.bodies) {
    if (b.kind !== 'critter' || b.gone || b.dead) continue;
    seen.add(b.id);
    let el = tagEls.get(b.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tag-el';
      el.style.setProperty('--c', S.teams[b.team].color);
      el.innerHTML = '<b></b><i></i>';
      $('tags').appendChild(el);
      tagEls.set(b.id, el);
      el._hp = -1;
    }
    view().toScreen(b.x, b.y + b.r + 8, 0, w, h, screenPt);
    if (!screenPt.vis) { el.style.opacity = 0; continue; }
    el.style.opacity = 1;
    el.style.transform = `translate(${screenPt.x.toFixed(1)}px, ${screenPt.y.toFixed(1)}px) translate(-50%, -100%)`;
    if (el._hp !== b.hp) { el._hp = b.hp; el.children[0].textContent = b.name; el.children[1].textContent = b.hp; }
    el.classList.toggle('active', b.id === S.active && S.phase !== 'settle');
    el.classList.toggle('far', far && b.id !== S.active);
  }
  for (const [id, el] of tagEls) if (!seen.has(id)) { el.remove(); tagEls.delete(id); }
}
function updatePops(dt) {
  const w = innerWidth, h = innerHeight;
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    p.t += dt;
    if (p.t >= p.life) { p.el.remove(); pops.splice(i, 1); continue; }
    view().toScreen(p.x, p.y, 0, w, h, screenPt);
    const k = p.t / p.life;
    const s = p.el.classList.contains('word') ? Math.min(1, p.t * 8) * (1 + 0.15 * Math.sin(p.t * 20) * (1 - k)) : 1;
    p.el.style.transform = `translate(${screenPt.x.toFixed(1)}px, ${(screenPt.y - k * p.rise).toFixed(1)}px) translate(-50%, -50%) scale(${s.toFixed(3)})`;
    p.el.style.opacity = k > 0.75 ? (1 - k) / 0.25 : 1;
  }
}

function weaponAmmo(key) {
  const S = G.S, c = S && Sim.active(S);
  const t = c ? S.teams[c.team] : S && S.teams[G.human];
  if (!t) return 0;
  return t.ammo[key] ?? 0;
}
const ammoText = (a) => (a === INF ? '∞' : `×${a}`);
let lastHud = '';
function updateHud(dt) {
  const S = G.S;
  if (!S || G.mode === 'demo') return;
  const c = Sim.active(S);
  const team = c ? S.teams[c.team] : null;
  // team bars
  S.teams.forEach((t, i) => {
    const hp = Sim.teamHp(S, i);
    const f = $('tbf' + i);
    if (!f) return;
    f.style.width = `${clamp((hp / Math.max(1, t.startHp)) * 100, 0, 100)}%`;
    $('tbh' + i).textContent = hp;
    $('tb' + i).classList.toggle('now', i === S.teamTurn && !S.result);
    $('tb' + i).classList.toggle('out', hp <= 0);
  });
  // timer
  const tm = $('timer');
  tm.style.setProperty('--c', team ? team.color : '#fff');
  let num = '–';
  if (S.phase === 'turn' || S.phase === 'start') num = Math.ceil(Math.max(0, S.turnLeft));
  else if (S.phase === 'retreat') num = Math.ceil(Math.max(0, S.retreatLeft));
  $('timerNum').textContent = num;
  $('timerWho').textContent = c && S.phase !== 'settle' ? c.name : S.result ? 'Game over' : '…';
  tm.classList.toggle('urgent', S.phase === 'turn' && S.turnLeft < 5.5 && humanTurn());
  tm.classList.toggle('retreat', S.phase === 'retreat');
  // tick tock for the player's last seconds
  if (humanTurn() && S.phase === 'turn' && S.turnLeft < 5) {
    const sec = Math.ceil(S.turnLeft);
    if (sec !== G.tick) { G.tick = sec; audio.tick(); }
  }
  // wind
  const wv = S.wind;
  $('windL').style.setProperty('--w', `${clamp(-wv, 0, 1) * 100}%`);
  $('windR').style.setProperty('--w', `${clamp(wv, 0, 1) * 100}%`);
  const arrows = Math.round(Math.abs(wv) * 3);
  $('windTxt').textContent = !arrows ? 'Wind: calm' : wv < 0 ? `Wind ${'◀'.repeat(arrows)}` : `Wind ${'▶'.repeat(arrows)}`;
  // weapon + controls
  const mine = humanTurn() || canMove();
  $('hud').classList.toggle('cpu', !!team && team.cpu && !S.result);
  const key = S.weapon;
  const w = WEAPONS[key];
  const a = weaponAmmo(key);
  const hk = `${key}|${a}|${S.locked}`;
  if (hk !== lastHud) {
    lastHud = hk;
    $('wIcon').textContent = w.icon;
    $('wName').textContent = w.name;
    $('wAmmo').textContent = S.locked ? `Shot ${WEAPONS.blaster.shots - S.shotsLeft + 1} of ${WEAPONS.blaster.shots}` : ammoText(a);
    $('bWeapon').classList.toggle('locked', S.locked);
  }
  $('bFire').classList.toggle('off', !humanTurn());
  // power bar
  const cpuCharging = team && team.cpu && G.cpu.charge > 0 && S.phase === 'turn';
  const pw = G.charge ? G.charge.v : cpuCharging ? G.cpu.charge : null;
  $('powerBar').classList.toggle('hidden', pw == null);
  if (pw != null) $('powerFill').style.width = `${pw * 100}%`;
  // cpu thinking
  const thinking = team && team.cpu && G.cpu.thinking && (S.phase === 'turn' || S.phase === 'start');
  $('think').classList.toggle('hidden', !thinking);
  if (thinking) $('thinkTxt').textContent = `${team.name} is thinking`;
  // hint
  let hint = '';
  if (humanTurn()) {
    if (w.aim === 'power') hint = isTouch ? 'Drag from your critter to aim & set power · tap FIRE' : 'Drag from your critter, or ↑↓ aim + hold Space · ←→ walk';
    else if (w.aim === 'angle') hint = key === 'bonk' ? 'Walk up to a foe, aim, then FIRE' : 'Drag to aim · FIRE twice';
    else if (w.aim === 'target') hint = G.target ? 'Tap FIRE to confirm (or tap another spot)' : `Tap a spot for the ${w.name}`;
    else if (key === 'skip') hint = 'FIRE to skip your turn';
    else hint = 'FIRE to drop it — then run!';
  } else if (S.phase === 'retreat' && mine) hint = 'Run for cover!';
  $('hint').textContent = hint;
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').classList.remove('show'); }
  void mine;
}

// ------------------------------------------------------------------ events from the match
function handleEvent(e) {
  view().onEvent(e);
  const S = G.S;
  const demo = G.mode === 'demo';
  switch (e.type) {
    case 'boom':
      audio.boom(e.r);
      G.lastBoom = { x: e.x, y: e.y, t: S.time };
      if (!demo && e.r >= 30 && e.kind !== 'pop') addPop(e.x, e.y + e.r * 0.6, WORDS[Math.floor(Math.random() * WORDS.length)], 'word', WORD_COLORS[Math.floor(Math.random() * WORD_COLORS.length)], 0.9, 30);
      break;
    case 'launch': if (e.kind === 'rocket' || e.kind === 'bee') audio.launch(); else audio.throw(); cam.free = false; break;
    case 'bounce': audio.bounce(e.v); break;
    case 'jump': audio.jump(); break;
    case 'thud': if (e.kind === 'critter') audio.land(); break;
    case 'splash': audio.splash(); if (!demo && e.big) addPop(e.x, e.y + 30, 'SPLOOSH!', 'word', '#7ef0ff', 1, 30); break;
    case 'pickup':
      audio.pickup();
      if (!demo) {
        const txt = e.what === 'health' ? `+${e.amount} HP` : `+1 ${WEAPONS[e.what].icon} ${WEAPONS[e.what].name}`;
        addPop(e.x, e.y + 20, txt, 'dmg heal', '#0f5a1d', 1.5, 60);
        if (e.team === G.human) toast(e.what === 'health' ? `❤️ ${txt}` : `🎁 ${txt}`);
      }
      break;
    case 'hurt': audio.hurt(); if (!demo) addPop(e.x, e.y + 22, `-${e.amount}`, 'dmg', S.teams[e.team].color, 1.3, 55); break;
    case 'die': audio.die(); if (!demo) banner(`${e.name} went kaboom!`, S.teams[e.team].name, 1.6); break;
    case 'drown': if (!demo) banner(`${e.name} took a swim!`, S.teams[e.team].name, 1.6); break;
    case 'shot': audio.shot(); cam.free = false; break;
    case 'bonk': audio.bonk(e.hit); break;
    case 'beep': audio.beep(); break;
    case 'teleport': audio.teleport(); break;
    case 'plane': audio.plane(); cam.free = false; break;
    case 'drop': audio.drop(); break;
    case 'crate': audio.crate(); if (!demo) toast('🪂 Supply crate incoming!'); break;
    case 'flood': audio.flood(); break;
    case 'suddendeath': if (!demo) banner('SUDDEN DEATH!', 'The water rises every turn', 2.4); break;
    case 'turn': {
      cam.free = false;
      G.target = null;
      G.charge = null;
      G.tick = -1;
      const t = S.teams[e.team], c = Sim.byId(S, e.id);
      if (!demo && c) {
        G.turnsPlayed++;
        const mineTurn = !t.cpu;
        audio.turn(mineTurn);
        banner(mineTurn ? `Your turn — ${c.name}!` : `${t.name}`, mineTurn ? `Round ${e.round}` : `${c.name} is up · round ${e.round}`, 1.7);
      }
      break;
    }
    case 'over': {
      if (demo) break;
      const win = e.winner === G.human;
      if (win) audio.win(); else audio.lose();
      banner(win ? 'VICTORY!' : e.winner < 0 ? 'Draw!' : 'Defeat…', win ? 'Your crew wins!' : e.winner >= 0 ? `${S.teams[e.winner].name} win` : 'Nobody survived', 2.2);
      break;
    }
  }
}

// ------------------------------------------------------------------ results
function showResult() {
  G.resultShown = true;
  const S = G.S;
  const win = S.result.winner === G.human;
  let medalHtml = '', next = null;
  if (G.mode === 'campaign') {
    const L = LEVELS[G.level];
    const k = DIFFS.findIndex((d) => d.id === G.diff);
    if (win) {
      const before = save.medals[L.id];
      if (before == null || k > before) { save.medals[L.id] = k; persist(); medalHtml = `<div class="medal-big">${DIFFS[k].medal}</div><p><b>New ${DIFFS[k].name} medal!</b></p>`; }
      else medalHtml = `<p>${DIFFS[k].medal} ${DIFFS[k].name} medal already earned${k < 2 ? ' — try a harder difficulty!' : ''}</p>`;
      if (G.level + 1 < LEVELS.length) next = G.level + 1;
      if (next != null && LEVELS[next].stage !== L.stage) campStage = LEVELS[next].stage;
    }
  }
  const rows = S.teams.map((t, i) => {
    const alive = S.bodies.filter((b) => b.team === i && Sim.isAlive(b)).length;
    return `<tr class="${S.result.winner === i ? 'win' : ''}"><td><i style="--c:${t.color}"></i>${t.name}</td><td>${S.stats[i].dmg}</td><td>${S.stats[i].kills}</td><td>${alive}/${t.members.length}</td></tr>`;
  }).join('');
  const confetti = win ? `<div class="confetti">${Array.from({ length: 26 }, (_, i) => `<i style="left:${(i * 37) % 100}%;--c:${WORD_COLORS[i % WORD_COLORS.length]};--d:${2 + (i % 5) * 0.4}s;--delay:${-(i % 7) * 0.35}s"></i>`).join('')}</div>` : '';
  modal(`${confetti}
    <h3 class="result-title ${win ? 'win' : 'lose'}">${win ? 'VICTORY!' : S.result.winner < 0 ? 'DRAW!' : 'DEFEAT'}</h3>
    ${G.mode === 'campaign' ? `<p class="kicker">Level ${LEVELS[G.level].id} · ${LEVELS[G.level].name} · ${DIFFS.find((d) => d.id === G.diff).name}</p>` : `<p class="kicker">Skirmish · ${DIFFS.find((d) => d.id === G.diff).name}</p>`}
    ${medalHtml}
    <table class="stats"><tr><th></th><th>Damage</th><th>KOs</th><th>Left</th></tr>${rows}</table>
    <div class="row">
      <button class="go gray" id="rMenu">Menu</button>
      <button class="go alt" id="rRetry">${win ? 'Play again' : 'Try again'}</button>
      ${next != null ? '<button class="go big" id="rNext">Next battle ▶</button>' : ''}
    </div>`, (card) => {
    card.querySelector('#rMenu').onclick = () => { audio.click(); if (G.mode === 'campaign') { closeModal(); openCampaignFromMatch(); } else if (G.mode === 'skirmish') { closeModal(); openSkirmishFromMatch(); } else toTitle(); };
    card.querySelector('#rRetry').onclick = () => { audio.click(); restartMatch(); };
    const n = card.querySelector('#rNext');
    if (n) n.onclick = () => { audio.click(); closeModal(); levelIntro(next); };
  });
}
function openCampaignFromMatch() { startDemo(); openCampaign(); }
function openSkirmishFromMatch() { startDemo(); openSkirmish(); }

// ------------------------------------------------------------------ pause / settings / help
$('pauseBtn').onclick = () => { audio.click(); pause(); };
function pause() {
  if (!G.S || G.mode === 'demo' || G.resultShown) return;
  G.paused = true;
  G.charge = null;
  showSettings(true);
}
function showSettings(inMatch) {
  const st = save.settings;
  const rowsHtml = `
    <div class="toggle-list">
      <button data-t="sound">🔊 Sound <em>${st.sound ? 'On' : 'Off'}</em></button>
      <button data-t="guide">🎯 Aim guide (short trajectory) <em>${st.guide ? 'On' : 'Off'}</em></button>
      <button data-t="cam">🎥 Starting camera <em>${st.cam === '3d' ? '3D orbit' : '2D side view'}</em></button>
      <button data-t="sprites">🖼️ Art style <em>${st.sprites ? '2D sprites' : 'Low-poly 3D'}</em></button>
      <button data-t="quality">✨ Graphics <em>${st.quality === 'high' ? 'High (shadows)' : 'Fast'}</em></button>
    </div>`;
  modal(`<h3>${inMatch ? 'Paused' : 'Settings'}</h3>${rowsHtml}
    <div class="row">${inMatch ? '<button class="go gray" id="pQuit">Quit</button><button class="go alt" id="pRestart">Restart</button><button class="go alt" id="pHelp">❓ Help</button><button class="go big" id="pResume">Resume ▶</button>' : '<button class="go big" id="pClose">Done</button>'}</div>`, (card) => {
    card.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
      const t = b.dataset.t;
      if (t === 'sound') { st.sound = !st.sound; audio.setEnabled(st.sound); }
      if (t === 'guide') st.guide = !st.guide;
      if (t === 'cam') st.cam = st.cam === '3d' ? '2d' : '3d';
      if (t === 'sprites') setSprites(!st.sprites);
      if (t === 'quality') { st.quality = st.quality === 'high' ? 'low' : 'high'; applyQuality(); }
      persist();
      audio.click();
      showSettings(inMatch);
    }));
    const on = (id, f) => { const el = card.querySelector(id); if (el) el.onclick = () => { audio.click(); f(); }; };
    on('#pClose', closeModal);
    on('#pResume', () => { closeModal(); G.paused = false; });
    on('#pRestart', () => { closeModal(); restartMatch(); });
    on('#pHelp', () => showHelp(false, true));
    on('#pQuit', () => { if (G.mode === 'campaign') { closeModal(); openCampaignFromMatch(); } else if (G.mode === 'skirmish') { closeModal(); openSkirmishFromMatch(); } else toTitle(); });
  });
}
function showHelp(first = false, fromPause = false) {
  const wl = WEAPON_ORDER.map((k) => `<div><i>${WEAPONS[k].icon}</i><span><b>${WEAPONS[k].name}</b> — ${WEAPONS[k].tip}</span></div>`).join('');
  modal(`<h3>${first ? 'Welcome, commander!' : 'How to play'}</h3>
    <div class="help">
      <p>Teams of critters take turns. Blow up the enemy crew — or knock them into the water — to win. The fight always stays on one flat lane; the 🎥 button only moves the camera.</p>
      <h4>📱 Touch</h4>
      <ul>
        <li><b>◀ ▶</b> walk, <b>⤴</b> jump, <b>↶</b> back flip.</li>
        <li><b>Drag from your critter</b> to aim — drag farther for more power. Tap <b>FIRE</b>. (Or hold FIRE to charge.)</li>
        <li>Drag anywhere else to look around (spin it in 3D). Pinch to zoom. 🎯 returns to the action.</li>
      </ul>
      <h4>⌨️ Keyboard & mouse</h4>
      <ul>
        <li><kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>D</kbd> walk · <kbd>Enter</kbd> jump · <kbd>Backspace</kbd> back flip</li>
        <li><kbd>↑</kbd><kbd>↓</kbd> / <kbd>W</kbd><kbd>S</kbd> aim · hold <kbd>Space</kbd> to charge, let go to fire</li>
        <li><kbd>Q</kbd><kbd>E</kbd> or <kbd>1</kbd>–<kbd>0</kbd> weapons · <kbd>Tab</kbd> weapon menu</li>
        <li><kbd>V</kbd> 2D/3D camera · <kbd>G</kbd> 2D sprite / low-poly art · <kbd>R</kbd> spin · <kbd>C</kbd> centre · wheel zoom · right-drag look around · <kbd>Esc</kbd> pause</li>
      </ul>
      <h4>🌬️ Tips</h4>
      <ul>
        <li>Wind pushes rockets, grapes and bombs — not grenades.</li>
        <li>After you fire you get a few seconds to run. Falling far hurts!</li>
        <li>Crates float down between turns: ❤️ health or 🎁 bonus weapons.</li>
      </ul>
      <h4>🎒 Weapons</h4>
      <div class="wlist">${wl}</div>
    </div>
    <div class="row"><button class="go big" id="hClose">${first ? "Let's go!" : 'Got it'}</button></div>`, (card) => {
    card.querySelector('#hClose').onclick = () => { audio.click(); if (fromPause) showSettings(true); else closeModal(); };
  });
}

// ------------------------------------------------------------------ weapons panel
function openWeapons() {
  const S = G.S;
  if (!humanTurn() || S.locked) { if (S && S.locked) toast('Finish your Blaster shots first'); return; }
  const team = S.teams[G.human];
  const keys = WEAPON_ORDER.filter((k) => team.ammo[k] != null);
  $('wGrid').innerHTML = keys.map((k) => {
    const a = team.ammo[k];
    return `<button class="wcell ${k === S.weapon ? 'sel' : ''} ${a === 0 ? 'empty' : ''}" data-k="${k}"><i>${WEAPONS[k].icon}</i><b>${WEAPONS[k].name}</b><em>${a === INF ? '∞' : a}</em></button>`;
  }).join('');
  $('wTip').textContent = WEAPONS[S.weapon].tip;
  $('wGrid').querySelectorAll('.wcell').forEach((b) => {
    b.onpointerenter = () => { $('wTip').textContent = WEAPONS[b.dataset.k].tip; };
    b.onclick = () => {
      if (Sim.selectWeapon(S, b.dataset.k)) { audio.click(); G.target = null; closeWeapons(); toast(`${WEAPONS[b.dataset.k].icon} ${WEAPONS[b.dataset.k].tip}`); }
      else toast('None left!');
    };
  });
  $('weaponPanel').classList.remove('hidden');
}
function closeWeapons() { $('weaponPanel').classList.add('hidden'); }
$('bWeapon').onclick = () => { audio.click(); if ($('weaponPanel').classList.contains('hidden')) openWeapons(); else closeWeapons(); };
$('wClose').onclick = () => { audio.click(); closeWeapons(); };
$('weaponPanel').addEventListener('pointerdown', (e) => { if (e.target === $('weaponPanel')) closeWeapons(); });
function cycleWeapon(dir) {
  const S = G.S;
  if (!humanTurn() || S.locked) return;
  const team = S.teams[G.human];
  const keys = WEAPON_ORDER.filter((k) => (team.ammo[k] ?? 0) !== 0);
  let i = keys.indexOf(S.weapon);
  i = (i + dir + keys.length) % keys.length;
  Sim.selectWeapon(S, keys[i]);
  G.target = null;
  audio.click();
}

// ------------------------------------------------------------------ firing
function doFire(power) {
  const S = G.S;
  if (!humanTurn()) return;
  const c = Sim.active(S);
  const key = S.weapon, w = WEAPONS[key];
  const o = { weapon: key };
  if (w.aim === 'power') o.power = power != null ? power : c.power;
  if (w.aim === 'target') {
    if (!G.target) { toast(`Tap a spot for the ${w.name} first`); return; }
    o.tx = G.target.x; o.ty = G.target.y;
  }
  const r = Sim.fire(S, o);
  if (!r.ok) { toast(r.why); return; }
  closeWeapons();
  if (!r.more) G.target = null;
  cam.free = false;
}
const fireBtn = $('bFire');
fireBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  audio.unlock();
  if (!humanTurn()) return;
  fireBtn.classList.add('held');
  G.fireDown = performance.now();
  clearTimeout(G.fireTimer);
  if (WEAPONS[G.S.weapon].aim === 'power') G.fireTimer = setTimeout(() => { if (fireBtn.classList.contains('held')) G.charge = { v: 0, src: 'btn' }; }, 260);
});
const fireUp = () => {
  if (!fireBtn.classList.contains('held')) return;
  fireBtn.classList.remove('held');
  clearTimeout(G.fireTimer);
  if (G.charge && G.charge.src === 'btn') { const v = G.charge.v; G.charge = null; doFire(Math.max(0.05, v)); }
  else doFire();
};
fireBtn.addEventListener('pointerup', fireUp);
fireBtn.addEventListener('pointerleave', fireUp);
fireBtn.addEventListener('pointercancel', () => { fireBtn.classList.remove('held'); G.charge = null; });

// hold-to-walk pads
function holdBtn(id, on, off) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); audio.unlock(); b.classList.add('held'); on(); });
  const up = () => { if (!b.classList.contains('held')) return; b.classList.remove('held'); off(); };
  b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
}
holdBtn('bLeft', () => { G.btn.left = true; }, () => { G.btn.left = false; });
holdBtn('bRight', () => { G.btn.right = true; }, () => { G.btn.right = false; });
$('bJump').addEventListener('pointerdown', (e) => { e.preventDefault(); if (canMove()) { Sim.hurry(G.S); Sim.jump(G.S, false); } });
$('bBack').addEventListener('pointerdown', (e) => { e.preventDefault(); if (canMove()) { Sim.hurry(G.S); Sim.jump(G.S, true); } });

// ------------------------------------------------------------------ camera buttons
function updateCamButtons() {
  $('camBtn').textContent = cam.mode === '3d' ? '🎥 2D' : '🎥 3D';
  $('camBtn').classList.toggle('hidden', spritesOn());
  $('spinBtn').classList.toggle('hidden', cam.mode !== '3d' || spritesOn());
  $('spinBtn').classList.toggle('on', cam.spin);
  $('sprBtn').textContent = spritesOn() ? '🧊 Low-poly' : '🖼️ 2D Sprite';
  $('sprBtn').classList.toggle('on', spritesOn());
}
/** Switch between the low-poly 3D world and flat 2D sprites. The match itself is untouched. */
function setSprites(on) {
  save.settings.sprites = on;
  save.settings.artPicked = true;
  persist();
  spriteCanvas.classList.toggle('hidden', !on);
  if (on) {
    if (G.S) sprites.load(G.S, G.cfg.theme);
    cam.mode = '2d'; cam.blend = 0;
  } else {
    if (G.S && worldStale) G.S.dirty.push([0, 0, G.S.W - 1, G.S.H - 1]);
    worldStale = false;
    sprites.dispose();
    if (G.mode === 'demo') { cam.mode = '3d'; cam.blend = 1; } else cam.mode = save.settings.cam;
  }
  updateCamButtons();
}
$('sprBtn').onclick = () => { audio.click(); setSprites(!spritesOn()); };
function toggleCam() {
  if (spritesOn()) { toast('2D Sprite mode is a flat view — switch to 🧊 Low-poly for 3D'); return; }
  cam.mode = cam.mode === '3d' ? '2d' : '3d';
  if (cam.mode === '2d') { cam.yaw = Math.atan2(Math.sin(cam.yaw), Math.cos(cam.yaw)); }
  else if (Math.abs(cam.yaw) < 0.2) cam.yaw = 0.7;
  audio.click();
  updateCamButtons();
}
$('camBtn').onclick = toggleCam;
$('spinBtn').onclick = () => { cam.spin = !cam.spin; audio.click(); updateCamButtons(); };
$('focusBtn').onclick = () => { cam.free = false; audio.click(); };

// ------------------------------------------------------------------ keyboard
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.repeat && (e.code === 'Space')) { e.preventDefault(); return; }
  audio.unlock();
  if (!$('modal').classList.contains('hidden')) {
    if (e.code === 'Escape' && G.paused) { closeModal(); G.paused = false; }
    return;
  }
  if (!G.S || G.mode === 'demo') return;
  keys.add(e.code);
  const S = G.S;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (!humanTurn()) break;
      if (WEAPONS[S.weapon].aim === 'power') { if (!G.charge) G.charge = { v: 0, src: 'key' }; } else doFire();
      break;
    case 'Enter': case 'KeyJ': e.preventDefault(); if (canMove()) { Sim.hurry(S); Sim.jump(S, false); } break;
    case 'Backspace': case 'KeyK': e.preventDefault(); if (canMove()) { Sim.hurry(S); Sim.jump(S, true); } break;
    case 'KeyQ': cycleWeapon(-1); break;
    case 'KeyE': cycleWeapon(1); break;
    case 'Tab': case 'KeyI': e.preventDefault(); if ($('weaponPanel').classList.contains('hidden')) openWeapons(); else closeWeapons(); break;
    case 'KeyV': toggleCam(); break;
    case 'KeyG': audio.click(); setSprites(!spritesOn()); break;
    case 'KeyR': if (cam.mode === '3d') { cam.spin = !cam.spin; updateCamButtons(); } break;
    case 'KeyC': cam.free = false; break;
    case 'Equal': case 'NumpadAdd': cam.zoom = clamp(cam.zoom * 1.15, 0.4, 2.4); break;
    case 'Minus': case 'NumpadSubtract': cam.zoom = clamp(cam.zoom / 1.15, 0.4, 2.4); break;
    case 'Escape': if (!$('weaponPanel').classList.contains('hidden')) closeWeapons(); else pause(); break;
    default: {
      const m = /^Digit(\d)$/.exec(e.code);
      if (m && humanTurn() && !S.locked) {
        const team = S.teams[G.human];
        const list = WEAPON_ORDER.filter((k) => team.ammo[k] != null);
        const k = list[(+m[1] + 9) % 10];
        if (k && Sim.selectWeapon(S, k)) { G.target = null; audio.click(); toast(`${WEAPONS[k].icon} ${WEAPONS[k].name}`); }
      }
    }
  }
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Space' && G.charge && G.charge.src === 'key') { const v = G.charge.v; G.charge = null; doFire(Math.max(0.05, v)); }
});
addEventListener('blur', () => { keys.clear(); G.btn.left = G.btn.right = false; G.charge = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.S && G.mode !== 'demo' && !G.S.result) pause(); });

// ------------------------------------------------------------------ pointer: aim, pan, orbit, pinch, target
const ptrs = new Map();
let pinch = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (isTouch && (document.fullscreenElement || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches)) lockLandscape();
  if (!G.S || G.mode === 'demo') return;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  const p = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, mode: 'pan', button: e.button };
  ptrs.set(e.pointerId, p);
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom };
    for (const q of ptrs.values()) q.mode = 'pinch';
    return;
  }
  const S = G.S;
  const c = Sim.active(S);
  const w = WEAPONS[S.weapon];
  if (humanTurn() && c && (w.aim === 'power' || w.aim === 'angle') && e.button === 0) {
    view().toScreen(c.x, c.y, 0, innerWidth, innerHeight, screenPt);
    const dx = c.facing * Math.cos(c.elev), dy = Math.sin(c.elev);
    const near = Math.hypot(screenPt.x - e.clientX, screenPt.y - e.clientY);
    view().toScreen(c.x + dx * (c.r + 46), c.y + dy * (c.r + 46), 0, innerWidth, innerHeight, screenPt);
    const nearCross = Math.hypot(screenPt.x - e.clientX, screenPt.y - e.clientY);
    if (near < (isTouch ? 95 : 70) || nearCross < 40) { p.mode = 'aim'; Sim.hurry(S); aimAt(e.clientX, e.clientY, near < 30 && nearCross > 40); return; }
  }
  p.mode = e.button === 2 || e.button === 1 ? 'look' : 'pan';
});
canvas.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  p.moved += Math.abs(dx) + Math.abs(dy);
  if (p.mode === 'pinch' && pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    cam.zoom = clamp(pinch.zoom * (d / Math.max(1, pinch.d)), 0.4, 2.4);
    return;
  }
  if (p.mode === 'aim') { aimAt(e.clientX, e.clientY, false); return; }
  if (p.moved < 6) return;
  if (cam.mode === '3d' && (p.mode === 'pan' || p.mode === 'look')) {
    cam.yaw -= dx * 0.006;
    cam.pitch = clamp(cam.pitch + dy * 0.004, 0.04, 1.25);
    cam.spinPause = 2.5;
  } else {
    const visW = viewWidth();
    cam.fx -= (dx * visW) / innerWidth;
    cam.fy += (dy * visW) / innerWidth;
    cam.free = true;
  }
});
function endPtr(e) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (p.mode === 'pan' && p.moved < 8 && G.S && humanTurn() && WEAPONS[G.S.weapon].aim === 'target') {
    const pt = view().pick(e.clientX, e.clientY, innerWidth, innerHeight);
    if (pt) {
      Sim.hurry(G.S);
      if (G.S.weapon === 'teleport' && !Sim.canTeleport(G.S, Sim.active(G.S), pt.x, pt.y)) toast('No room there — pick an open spot');
      else { G.target = pt; audio.click(); }
    }
  }
}
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.zoom = clamp(cam.zoom * Math.exp(-e.deltaY * 0.0012), 0.4, 2.4);
}, { passive: false });

function aimAt(sx, sy, keepPower) {
  const S = G.S, c = Sim.active(S);
  if (!c) return;
  const pt = view().pick(sx, sy, innerWidth, innerHeight);
  if (!pt) { toast('Turn the camera to aim'); return; }
  const dx = pt.x - c.x, dy = pt.y - c.y, d = Math.hypot(dx, dy);
  if (d < 6) return;
  c.facing = dx >= 0 ? 1 : -1;
  c.elev = clamp(Math.atan2(dy, Math.abs(dx)), -1.5, 1.5);
  if (!keepPower && WEAPONS[S.weapon].aim === 'power') c.power = clamp((d - 14) / 150, 0.06, 1);
}

// ------------------------------------------------------------------ human input each frame
function humanInput(dt) {
  const S = G.S;
  if (!canMove()) { if (S && Sim.active(S) && !S.teams[Sim.active(S).team].cpu) Sim.setControl(S, 0, 0); return; }
  const left = keys.has('ArrowLeft') || keys.has('KeyA') || G.btn.left;
  const right = keys.has('ArrowRight') || keys.has('KeyD') || G.btn.right;
  const up = keys.has('ArrowUp') || keys.has('KeyW');
  const down = keys.has('ArrowDown') || keys.has('KeyS');
  let move = (right ? 1 : 0) - (left ? 1 : 0);
  if (cam.blend > 0.5 && Math.cos(cam.yaw) < 0) move = -move;
  const aim = (up ? 1 : 0) - (down ? 1 : 0);
  Sim.setControl(S, move, aim);
  if (move || aim) Sim.hurry(S);
  if (move && S.time - Sim.active(S).walkT < 0.05) audio.step();
  if (G.charge) {
    G.charge.v = Math.min(1, G.charge.v + dt / 2.4);
    const c = Sim.active(S);
    if (c) c.power = G.charge.v;
    if (G.charge.v >= 1) { const src = G.charge.src; G.charge = null; if (src === 'btn') fireBtn.classList.remove('held'); doFire(1); }
  }
  void dt;
}

// ------------------------------------------------------------------ camera
function viewWidth() { return 1050 / cam.zoom; }
function focusTarget(S) {
  if (S.projs.length) { const p = S.projs[S.projs.length - 1]; return { x: p.x, y: Math.min(p.y, S.H + 60), fast: true }; }
  if (G.lastBoom && S.time - G.lastBoom.t < 1.1) return G.lastBoom;
  const c = Sim.active(S);
  if (c && (S.phase === 'start' || S.phase === 'turn' || S.phase === 'retreat')) return { x: c.x, y: c.y + 40 };
  let mv = null;
  for (const b of S.bodies) if (!b.rest && (b.kind === 'critter' || b.kind === 'crate')) { mv = b; break; }
  if (mv) return { x: mv.x, y: mv.y };
  return null;
}
function updateCamera(dt) {
  const S = G.S;
  if (!S) return;
  const aspect = innerWidth / innerHeight;
  const want = cam.free ? null : focusTarget(S);
  if (want) {
    const k = 1 - Math.exp(-dt * (want.fast ? 5 : 2.8));
    cam.fx += (want.x - cam.fx) * k;
    cam.fy += (want.y - cam.fy) * k;
  }
  const visW = viewWidth(), visH = visW / aspect;
  const fov = (camera.fov * Math.PI) / 180;
  const dist = visH / 2 / Math.tan(fov / 2);
  if (S.W > visW * 0.7) cam.fx = clamp(cam.fx, visW * 0.25, S.W - visW * 0.25); else cam.fx = S.W / 2;
  cam.fy = clamp(cam.fy, S.water + visH * 0.32, S.H + 160);
  cam.blend += ((cam.mode === '3d' ? 1 : 0) - cam.blend) * (1 - Math.exp(-dt * 3));
  if (Math.abs(cam.blend - (cam.mode === '3d' ? 1 : 0)) < 0.002) cam.blend = cam.mode === '3d' ? 1 : 0;
  cam.spinPause -= dt;
  if (cam.mode === '3d' && cam.spin && cam.spinPause <= 0 && !G.paused) cam.yaw += dt * 0.17;
  const yaw = cam.yaw * cam.blend, pitch = cam.pitch * cam.blend;
  const d = dist * (1 + 0.2 * cam.blend);
  const sh = world.shake;
  const jx = (Math.random() - 0.5) * sh, jy = (Math.random() - 0.5) * sh;
  camera.position.set(cam.fx + Math.sin(yaw) * Math.cos(pitch) * d + jx, cam.fy + Math.sin(pitch) * d + jy, Math.cos(yaw) * Math.cos(pitch) * d);
  camera.lookAt(cam.fx + jx * 0.5, cam.fy + jy * 0.5, 0);
}

// ------------------------------------------------------------------ portrait lock
const portrait = matchMedia('(orientation: portrait)');
const blockedByPortrait = () => isTouch && portrait.matches;

// ------------------------------------------------------------------ main loop
function info() {
  const S = G.S;
  const c = S && Sim.active(S);
  const w = S && WEAPONS[S.weapon];
  const aiming = !!c && (S.phase === 'turn' || S.phase === 'start') && !S.result;
  const cpuTurn = !!c && S.teams[c.team].cpu;
  const showAim = aiming && w && (w.aim === 'power' || w.aim === 'angle') && (!cpuTurn || (G.cpu.plan && !G.cpu.thinking));
  let target = null;
  if (aiming && w && w.aim === 'target') target = cpuTurn ? (G.cpu.plan && G.cpu.plan.tx != null && !G.cpu.thinking ? { x: G.cpu.plan.tx, y: G.cpu.plan.ty } : null) : G.target;
  return {
    aim: showAim,
    powerAim: w && w.aim === 'power',
    power: G.charge ? G.charge.v : cpuTurn ? G.cpu.charge : c ? c.power : 0.5,
    weapon: S ? S.weapon : 'rocket',
    guide: save.settings.guide && !cpuTurn && G.mode !== 'demo',
    target,
    showHeld: aiming,
    showArrow: !!c && (S.phase === 'start' || (S.phase === 'turn' && S.phaseT < 2.5)) && !S.result,
  };
}
let lastT = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
  lastT = t;
  const S = G.S;
  // the match freezes while a dialog is open (help, pause) or the phone is held upright
  const dialog = G.mode !== 'demo' && !G.over && !$('modal').classList.contains('hidden');
  const blocked = G.paused || dialog || blockedByPortrait();
  if (S && !blocked) {
    if (G.mode !== 'demo') humanInput(dt);
    G.cpu.update(dt);
    Sim.step(S, dt);
    for (const e of S.events) handleEvent(e);
    S.events.length = 0;
    if (S.projs.some((p) => p.kind === 'dynamite')) audio.fuse();
    if (S.result && !G.over) { G.over = true; G.overT = 0; }
    if (G.over) {
      G.overT += dt;
      if (G.mode === 'demo') { if (G.overT > 4) startDemo(); }
      else if (G.overT > 2.4 && !G.resultShown) showResult();
    }
    if (G.mode === 'demo') { G.demoT += dt; if (G.demoT > 240) startDemo(); }
  }
  updateCamera(blocked ? 0 : dt);
  if (spritesOn()) {
    if (S && sprites.match !== S) sprites.load(S, G.cfg.theme);
    sprites.update(blocked ? 0 : dt, info(), cam, innerWidth, innerHeight);
    if (S && S.dirty.length) { worldStale = true; S.dirty.length = 0; }
  } else world.update(blocked ? 0 : dt, info());
  updateTags();
  updatePops(blocked ? 0 : dt);
  updateHud(blocked ? 0 : dt);
  if (spritesOn()) sprites.render(); else renderer.render(world.scene, camera);
}
spriteCanvas.classList.toggle('hidden', !spritesOn());

renderDiffRows();
toTitle();
requestAnimationFrame(frame);
if (import.meta.env && import.meta.env.DEV) window.__critters = { G, cam, world, renderer, Sim };
