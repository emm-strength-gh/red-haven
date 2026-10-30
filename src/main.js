import './style.css';
import { BUILDINGS, EVENT_CHOICES, SAVE_KEY, canBuild, loadGame, markNode, newGame, placeBuilding, resolveEvent, saveGame, stepGame } from './game.js';
import { GameScene } from './scene.js';
import { icon } from './icons.js';
import { Audio } from './audio.js';

const RESOURCES = ['timber', 'metal', 'food', 'power'];
const LOG_BADGE = { good: '✓', warning: '!', danger: '!', info: 'i' };

const app = document.querySelector('#app');
app.innerHTML = `
  <main class="shell">
    <div id="viewport" class="viewport" aria-label="3D colony map"></div>
    <div class="vignette"></div>
    <header class="topbar">
      <div class="brand"><div class="brand-mark">${icon('planet')}</div><div><strong>REDHAVEN</strong><small>Martian Frontier</small></div></div>
      <div class="resources" aria-label="Colony resources">
        ${RESOURCES.map(r => `<div class="resource res-${r}" id="res-${r}">${icon(r)}<span><b id="${r}">0</b><small>${r}</small></span></div>`).join('')}
      </div>
      <div class="top-actions"><span class="day-pill">${icon('sun')}<span id="day">DAY 01</span></span><button id="menuBtn" class="icon-btn" title="Menu" aria-label="Menu">${icon('menu')}</button></div>
    </header>
    <aside class="left-panel">
      <div class="eyebrow">Colony status</div>
      <h2 id="colonyTitle">A new beginning</h2>
      <p id="objective" class="objective"></p>
      <div class="status-row"><span class="weather-chip"><span class="status-dot"></span><span id="weather">Clear skies</span></span><span id="population">4 colonists</span></div>
      <div class="progress-caption"><span>Expedition</span><span id="progressText">0%</span></div>
      <div class="progress-track"><div id="progressBar"></div></div>
      <div class="panel-divider"></div>
      <div class="eyebrow eyebrow-pink">Crew</div>
      <div id="crew" class="crew-list"></div>
    </aside>
    <aside class="right-panel">
      <div class="panel-heading"><span class="eyebrow eyebrow-orange">Field report</span><span class="live-dot">LIVE</span></div>
      <div id="log" class="event-list" aria-live="polite"></div>
      <div id="inspect" class="inspect-box"><span class="eyebrow eyebrow-teal">Inspect</span><p>Tap a tile, building or crew member for details.</p></div>
    </aside>
    <div class="camera-controls"><button id="zoomIn" class="small-btn" title="Zoom in" aria-label="Zoom in">${icon('plus')}</button><button id="zoomOut" class="small-btn" title="Zoom out" aria-label="Zoom out">${icon('minus')}</button></div>
    <footer class="bottom-bar">
      <div class="tool-section"><span class="eyebrow">Tools</span><div class="tool-buttons"><button class="tool active" data-tool="inspect">${icon('inspect')}<span>Inspect</span></button><button class="tool" data-tool="gather">${icon('gather')}<span>Gather</span></button></div></div>
      <div class="build-section"><span class="eyebrow eyebrow-orange">Build</span><div id="buildCards" class="build-cards"></div></div>
      <div class="time-section"><span class="eyebrow eyebrow-purple">Time</span><button id="speedBtn" class="speed-btn"><span id="speedIcon"></span><small id="speedLabel">PAUSE</small></button></div>
    </footer>
    <div id="toast" class="toast" role="status"></div>
    <div id="eventOverlay" class="overlay event-overlay hidden"><div class="choice-dialog"><div id="eventIcon" class="choice-icon"></div><div class="eyebrow eyebrow-teal">A Martian moment</div><h2 id="eventTitle"></h2><p id="eventText"></p><div id="eventChoices" class="choice-list"></div></div></div>
    <div id="startOverlay" class="overlay">
      <div class="start-card">
        <div class="overline">A new world is waiting</div>
        <div class="large-mark">${icon('planet')}</div>
        <h1>REDHAVEN</h1>
        <p class="subtitle">Build a home. Weather the storms. Survive together.</p>
        <div class="mode-grid">
          <button id="expeditionBtn" class="mode-card mode-expedition"><span class="mode-icon">${icon('rocket')}</span><strong>Expedition</strong><span>Build a signal beacon and secure your place on Mars.</span><em>Goal driven →</em></button>
          <button id="endlessBtn" class="mode-card mode-endless"><span class="mode-icon">${icon('infinity')}</span><strong>Endless Colony</strong><span>Grow freely and see how long your people can thrive.</span><em>Sandbox →</em></button>
        </div>
        <button id="continueBtn" class="continue-btn" hidden>Continue saved colony →</button>
        <div class="start-foot">Low-poly 3D · Offline ready · Saves on this device</div>
      </div>
    </div>
    <div id="menuOverlay" class="overlay hidden">
      <div class="dialog"><button id="closeMenu" class="dialog-close" aria-label="Close menu">${icon('close')}</button><div class="eyebrow eyebrow-purple">Paused at the frontier</div><h2>Game menu</h2><p>Drag to move the camera. Pinch or scroll to zoom. Choose a building, then tap an empty tile to construct it. Mark rocks and trees for gathering.</p><div class="sound-row"><button id="soundBtn" class="toggle-btn"></button><button id="musicBtn" class="toggle-btn"></button></div><div class="dialog-actions"><button id="saveBtn" class="primary-btn">Save colony</button><button id="newBtn" class="secondary-btn">New game</button></div><div id="saveStatus" class="save-status"></div></div>
    </div>
    <div id="endOverlay" class="overlay hidden"><div class="dialog end-dialog"><div class="eyebrow eyebrow-orange" id="endEyebrow"></div><h2 id="endTitle"></h2><p id="endText"></p><div class="dialog-actions"><button id="endNew" class="primary-btn">Start a new colony</button><button id="endClose" class="secondary-btn">View colony</button></div></div></div>
  </main>`;

const $ = (id) => document.getElementById(id);
const savedGame = loadGame();
let game = savedGame || newGame('expedition', 47120);
let world = new GameScene($('viewport'), game);
let started = false;
let speed = 1;
let tool = 'inspect';
let selected = null;
let last = performance.now();
let uiAt = 0, saveAt = 0, endShown = false, visibleEvent = null;
const shownResources = {};
const audio = new Audio();
// only touch the DOM when a list actually changes, so its pop-in animation doesn't replay
const rendered = { crew: '', log: '' };
const setHTML = (key, html) => { if (rendered[key] !== html) { rendered[key] = html; $(key).innerHTML = html; } };
// what the sound layer saw last frame, to turn state changes into sound effects
const heard = { enemies: 0, projectiles: 0, day: 0, timber: 0, metal: 0 };
let zapAt = 0, chopAt = 0;

const cardOrder = ['shelter', 'farm', 'solar', 'wall', 'turret', 'beacon'];
$('buildCards').innerHTML = cardOrder.map(type => {
  const b = BUILDINGS[type];
  const cost = Object.entries(b.cost).map(([r, n]) => `<span class="cost" data-res="${r}" data-n="${n}">${icon(r)}${n}</span>`).join('');
  return `<button class="build-card" data-build="${type}" title="${b.detail}">${icon(type, 'build-icon')}<strong>${b.name}</strong><span class="costs">${cost}</span></button>`;
}).join('');
if (savedGame) $('continueBtn').hidden = false;

function setTool(value) {
  tool = value;
  document.querySelectorAll('.tool').forEach(button => button.classList.toggle('active', button.dataset.tool === value));
  document.querySelectorAll('.build-card').forEach(button => button.classList.toggle('active', button.dataset.build === value));
  $('viewport').classList.toggle('placing', !!BUILDINGS[value]);
  $('viewport').classList.toggle('gathering', value === 'gather');
  if (value === 'inspect') world.select(null);
}
function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}
function start(mode) {
  if (mode !== 'continue') {
    game = newGame(mode);
    world.renderer.dispose();
    $('viewport').replaceChildren();
    world = new GameScene($('viewport'), game);
    saveGame(game);
  }
  started = true;
  speed = 1;
  resetHeard();
  $('startOverlay').classList.add('hidden');
  setTool('inspect');
  renderUI();
  toast(mode === 'continue' ? 'Welcome back, commander!' : 'Welcome to habitable Mars. Build your colony!');
}
function renderUI() {
  for (const key of RESOURCES) {
    const value = Math.floor(game.resources[key]);
    if (shownResources[key] !== undefined && shownResources[key] !== value) {
      const chip = $(`res-${key}`);
      chip.classList.remove('bump', 'drop');
      void chip.offsetWidth;
      chip.classList.add(value > shownResources[key] ? 'bump' : 'drop');
    }
    shownResources[key] = value;
    $(key).textContent = value;
  }
  $('day').textContent = `DAY ${String(game.day).padStart(2, '0')}`;
  $('weather').textContent = game.weather;
  $('population').textContent = `${game.colonists.length} colonists`;
  const expedition = game.mode === 'expedition';
  $('colonyTitle').textContent = expedition ? 'The signal project' : 'Your living frontier';
  const beacon = game.buildings.some(b => b.type === 'beacon');
  $('objective').textContent = expedition
    ? beacon ? `Keep the beacon powered for ${Math.max(0, Math.ceil(30 - game.beaconCharge))} more seconds to reach orbit.` : 'Build a signal beacon and hold the colony together until it transmits.'
    : 'A world without an ending. Build, grow, and survive the next season.';
  const progress = expedition ? (beacon ? Math.min(100, 60 + game.beaconCharge / 30 * 40) : Math.min(60, game.day * 5)) : Math.min(100, game.day * 4);
  $('progressBar').style.width = `${progress}%`;
  $('progressText').textContent = expedition ? `${Math.floor(progress)}%` : `DAY ${game.day}`;
  setHTML('crew', game.colonists.map(c => {
    const hp = Math.max(0, Math.floor(c.hp));
    return `<button class="crew-member" data-crew="${c.id}"><span class="avatar role-${c.role.toLowerCase()}">${c.name[0]}</span><span class="crew-info"><strong>${c.name}</strong><small>${c.role} · ${c.task}</small><span class="hp${hp < 40 ? ' low' : ''}"><i style="width:${hp}%"></i></span></span></button>`;
  }).join('') || '<p class="empty">No survivors.</p>');
  setHTML('log', game.eventLog.slice(0, 5).map(e => `<div class="event ${e.kind}"><span class="event-badge">${LOG_BADGE[e.kind] ?? 'i'}</span><span><small>DAY ${String(e.day).padStart(2, '0')}</small><p>${e.text}</p></span></div>`).join(''));
  document.querySelectorAll('.build-card').forEach(button => {
    const type = button.dataset.build;
    button.classList.toggle('unaffordable', Object.entries(BUILDINGS[type].cost).some(([r, n]) => game.resources[r] < n));
  });
  document.querySelectorAll('.cost').forEach(chip => chip.classList.toggle('short', game.resources[chip.dataset.res] < Number(chip.dataset.n)));
  const speedState = speed === 0 ? 'play' : speed === 1 ? 'pause' : 'fast';
  if ($('speedBtn').dataset.state !== speedState) {
    $('speedBtn').dataset.state = speedState;
    $('speedIcon').innerHTML = icon(speedState);
  }
  $('speedLabel').textContent = speed === 0 ? 'PLAY' : speed === 1 ? 'PAUSE' : '3× SPEED';
}
function inspectTile(tile) {
  if (!tile) return;
  const b = game.buildings.find(item => item.x === tile.x && item.z === tile.z);
  const n = game.nodes.find(item => item.x === tile.x && item.z === tile.z);
  const c = game.colonists.find(item => Math.hypot(item.x - tile.x - .5, item.z - tile.z - .5) < .55);
  let title = `Sector ${tile.x + 1}.${tile.z + 1}`;
  let detail = 'Open terrain. Select a building to construct here.';
  if (b) { title = BUILDINGS[b.type].name; detail = `${BUILDINGS[b.type].detail} Integrity ${Math.max(0, Math.ceil(b.hp))}/${BUILDINGS[b.type].hp}.`; }
  if (n) { title = n.type === 'rock' ? 'Metal deposit' : 'Martian grove'; detail = `${n.amount} resources remain. ${n.marked ? 'Marked for gathering.' : 'Use Gather to assign your crew.'}`; }
  if (c) { title = `${c.name} · ${c.role}`; detail = `${c.task}. Health ${Math.max(0, Math.floor(c.hp))}%.`; }
  $('inspect').innerHTML = `<span class="eyebrow eyebrow-teal">Inspect · ${tile.x + 1}, ${tile.z + 1}</span><h3>${title}</h3><p>${detail}</p>`;
  world.select(tile);
}
function clickTile(tile) {
  if (!tile || !started) return;
  if (BUILDINGS[tool]) {
    const error = placeBuilding(game, tool, tile.x, tile.z);
    if (error) { toast(error); audio.error(); }
    else { world.sync(game); saveGame(game); inspectTile(tile); toast(`${BUILDINGS[tool].name} constructed!`); audio.built(); }
  } else if (tool === 'gather') {
    if (!markNode(game, tile.x, tile.z)) { toast('Select a tree or metal deposit.'); audio.error(); }
    else audio.mark();
    world.sync(game); inspectTile(tile);
  } else { inspectTile(tile); audio.select(); }
  renderUI();
}

function resetHeard() {
  Object.assign(heard, { enemies: game.enemies.length, projectiles: game.projectiles.length, day: game.day, timber: game.resources.timber, metal: game.resources.metal });
}
/** Turn simulation changes since last frame into sound effects. */
function listen(now) {
  const enemies = game.enemies.length;
  if (enemies > heard.enemies && heard.enemies === 0) audio.alarm();
  else if (enemies === 0 && heard.enemies > 0 && !game.gameOver) audio.fanfare();
  else if (enemies < heard.enemies) audio.hit();
  const shots = game.projectiles.length;
  if (shots > heard.projectiles && now - zapAt > 90) { audio.zap(); zapAt = now; }
  if (game.day > heard.day) audio.dawn();
  for (const r of ['timber', 'metal']) {
    const v = game.resources[r];
    // small gains are the crew's pickaxes and axes; big ones are rewards
    if (v > heard[r] && v - heard[r] <= 3 && now - chopAt > 150) { audio.chop(); audio.pickup(); chopAt = now; }
    heard[r] = v;
  }
  heard.enemies = enemies; heard.projectiles = shots; heard.day = game.day;
}
function renderSoundButtons() {
  $('soundBtn').textContent = audio.sound ? '🔊 Sound on' : '🔇 Sound off';
  $('musicBtn').textContent = audio.music ? '🎵 Music on' : '🎵 Music off';
  $('soundBtn').classList.toggle('off', !audio.sound);
  $('musicBtn').classList.toggle('off', !audio.music);
}
renderSoundButtons();
$('soundBtn').onclick = () => { audio.setPrefs(!audio.sound, audio.music); renderSoundButtons(); };
$('musicBtn').onclick = () => { audio.setPrefs(audio.sound, !audio.music); renderSoundButtons(); };
// browsers only allow audio after a user gesture
document.addEventListener('pointerdown', () => audio.unlock(), true);
document.addEventListener('keydown', () => audio.unlock(), true);
document.addEventListener('click', e => { if (e.target.closest('button')) audio.ui(); }, true);
document.addEventListener('visibilitychange', () => document.hidden ? audio.suspend() : audio.resume());

$('expeditionBtn').onclick = () => start('expedition');
$('endlessBtn').onclick = () => start('endless');
$('continueBtn').onclick = () => start('continue');
document.querySelectorAll('.build-card').forEach(button => button.onclick = () => { setTool(button.dataset.build); toast(`Place ${BUILDINGS[button.dataset.build].name} on an empty tile.`); });
document.querySelectorAll('.tool').forEach(button => button.onclick = () => setTool(button.dataset.tool));
$('speedBtn').onclick = () => { speed = speed === 1 ? 0 : speed === 0 ? 3 : 1; renderUI(); };
$('zoomIn').onclick = () => world.setZoom(world.zoom * 1.2);
$('zoomOut').onclick = () => world.setZoom(world.zoom / 1.2);
$('menuBtn').onclick = () => { $('menuOverlay').classList.remove('hidden'); speed = 0; renderUI(); };
$('closeMenu').onclick = () => $('menuOverlay').classList.add('hidden');
$('saveBtn').onclick = () => { $('saveStatus').textContent = saveGame(game) ? 'Saved on this device.' : 'Storage is unavailable on this device.'; };
$('newBtn').onclick = () => {
  if (!confirm('Start a new colony? Your current local save will be replaced.')) return;
  $('menuOverlay').classList.add('hidden'); $('startOverlay').classList.remove('hidden');
  $('continueBtn').hidden = true; started = false;
  localStorage.removeItem(SAVE_KEY);
};
$('endNew').onclick = () => { $('endOverlay').classList.add('hidden'); $('startOverlay').classList.remove('hidden'); $('continueBtn').hidden = true; started = false; endShown = false; };
$('endClose').onclick = () => $('endOverlay').classList.add('hidden');
$('eventChoices').addEventListener('click', event => {
  const choice = event.target.closest('[data-choice]');
  if (!choice) return;
  resolveEvent(game, Number(choice.dataset.choice));
  $('eventOverlay').classList.add('hidden');
  visibleEvent = null;
  world.sync(game); renderUI(); saveGame(game);
});
document.querySelector('#crew').addEventListener('click', (event) => {
  const id = event.target.closest('[data-crew]')?.dataset.crew;
  const c = game.colonists.find(item => item.id === id);
  if (c) { inspectTile({ x: Math.floor(c.x), z: Math.floor(c.z) }); world.target.set(c.x, 0, c.z); world.updateCamera(); }
});

let pointer = null;
let pinch = null;
function bindCanvas() {
  const element = world.renderer.domElement;
  element.addEventListener('pointerdown', e => { element.setPointerCapture(e.pointerId); pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false }; });
  element.addEventListener('pointermove', e => {
    if (pinch) return;
    if (pointer && pointer.id === e.pointerId) {
      const dx = e.clientX - pointer.lastX, dy = e.clientY - pointer.lastY;
      if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 7) pointer.moved = true;
      if (pointer.moved) world.pan(dx, dy);
      pointer.lastX = e.clientX; pointer.lastY = e.clientY;
    } else if (e.pointerType === 'mouse' && started && BUILDINGS[tool]) {
      const tile = world.tileFromClient(e.clientX, e.clientY);
      world.select(tile, tile ? !canBuild(game, tool, tile.x, tile.z) : false);
    }
  });
  element.addEventListener('pointerup', e => { if (pointer?.id === e.pointerId && !pointer.moved) clickTile(world.tileFromClient(e.clientX, e.clientY)); pointer = null; });
  element.addEventListener('wheel', e => { e.preventDefault(); world.setZoom(world.zoom * (e.deltaY > 0 ? .9 : 1.1)); }, { passive: false });
  element.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: true });
  element.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !pinch) return;
    const next = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    world.setZoom(world.zoom * next / pinch); pinch = next;
  }, { passive: true });
  element.addEventListener('touchend', () => { pinch = null; });
}
bindCanvas();
// Rebind canvas after a new scene replaces the preview canvas.
function ensureCanvasBound() {
  if (world.renderer.domElement.dataset.bound) return;
  world.renderer.domElement.dataset.bound = 'true'; bindCanvas();
}
world.renderer.domElement.dataset.bound = 'true';
const observer = new MutationObserver(ensureCanvasBound);
observer.observe($('viewport'), { childList: true });
window.addEventListener('resize', () => world.resize());
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { setTool('inspect'); $('menuOverlay').classList.add('hidden'); }
  if (e.code === 'Space' && started) { e.preventDefault(); speed = speed ? 0 : 1; renderUI(); }
});

function frame(now) {
  const dt = Math.min((now - last) / 1000, .1);
  last = now;
  if (started && speed) stepGame(game, dt * speed);
  if (started) listen(now);
  audio.update(dt, { weather: game.weather, danger: started && game.enemies.length > 0 });
  world.sync(game);
  world.render();
  if (now - uiAt > 350) { renderUI(); uiAt = now; }
  if (started && now - saveAt > 9000) { saveGame(game); saveAt = now; }
  if (started && game.pendingEvent && visibleEvent !== game.pendingEvent) {
    visibleEvent = game.pendingEvent;
    const event = EVENT_CHOICES[visibleEvent];
    $('eventIcon').innerHTML = icon(visibleEvent);
    $('eventIcon').dataset.kind = visibleEvent;
    $('eventTitle').textContent = event.title;
    $('eventText').textContent = event.text;
    $('eventChoices').innerHTML = event.choices.map((c, i) => `<button class="choice" data-choice="${i}"><strong>${c.label}</strong><small>${c.detail}</small></button>`).join('');
    $('eventOverlay').classList.remove('hidden');
    audio.chime();
  }
  if (started && !endShown && (game.modeWon || game.gameOver)) {
    endShown = true; speed = 0; saveGame(game);
    if (game.modeWon) audio.win(); else audio.lose();
    $('endEyebrow').textContent = game.modeWon ? 'Expedition complete' : 'Colony lost';
    $('endTitle').textContent = game.modeWon ? 'Mars heard your signal!' : 'The frontier endures.';
    $('endText').textContent = game.modeWon ? `Your crew survived ${game.day} days and reached orbit. Their home on Mars lives on.` : `Your colony survived ${game.day} days. Every ending teaches the next crew how to begin.`;
    $('endOverlay').classList.remove('hidden');
  }
  requestAnimationFrame(frame);
}
renderUI();
requestAnimationFrame(frame);
