import * as THREE from 'three';
import { CAPACITY, cloneBoard, createPuzzle, isSolved, pour, pourAmount, topColor } from './pour-logic.js';

const $ = (id) => document.getElementById(id);
const COLORS = ['#ff6695', '#ffd448', '#4fd8f5', '#9be75b', '#a764f3', '#ff9249', '#438cf3', '#f064cf'];
const STORAGE = 'color-pour-progress-v1';
const SOUND = 'color-pour-sound-v1';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = (x) => x * x * (3 - 2 * x);

const ramp = new THREE.DataTexture(new Uint8Array([100, 175, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;
const toonMaterials = new Map();
function toon(color) {
  if (!toonMaterials.has(color)) toonMaterials.set(color, new THREE.MeshToonMaterial({ color, gradientMap: ramp }));
  return toonMaterials.get(color);
}
const ink = new THREE.MeshBasicMaterial({ color: '#281b45', side: THREE.BackSide });
function mesh(parent, geometry, color, x = 0, y = 0, z = 0, outlined = false) {
  const object = new THREE.Mesh(geometry, toon(color));
  object.position.set(x, y, z);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  if (outlined) {
    const edge = new THREE.Mesh(geometry, ink);
    edge.scale.setScalar(1.055);
    edge.raycast = () => {};
    object.add(edge);
  }
  return object;
}
function cylinder(r1, r2, h, segments = 10) { return new THREE.CylinderGeometry(r1, r2, h, segments); }

class AudioFX {
  constructor() { this.enabled = true; this.context = null; }
  unlock() {
    if (!this.context) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.context = new AC();
      this.master = this.context.createGain();
      this.master.gain.value = 0.3;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.resume();
  }
  note(f0, f1, duration, delay = 0, type = 'sine', volume = .2) {
    if (!this.enabled || !this.context) return;
    const at = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(f0, at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, f1), at + duration);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(at); oscillator.stop(at + duration + .02);
  }
  pick() { this.note(450, 690, .12, 0, 'triangle'); }
  wrong() { this.note(220, 125, .17, 0, 'sawtooth', .14); }
  pour() { this.note(500, 850, .42, 0, 'triangle', .13); this.note(900, 420, .45, .1, 'sine', .09); }
  land() { this.note(630, 890, .13, 0, 'sine'); this.note(940, 1175, .18, .07, 'triangle', .16); }
  undo() { this.note(700, 350, .23, 0, 'triangle'); }
  win() { [523,659,784,1047,1319].forEach((f,i) => this.note(f,f,.25,i*.11,'triangle',.24)); }
}

class ColorPour {
  constructor() {
    this.progress = this.readProgress();
    this.audio = new AudioFX();
    try { this.audio.enabled = localStorage.getItem(SOUND) !== 'off'; } catch { /* private mode */ }
    this.state = 'menu';
    this.level = this.progress.highest;
    this.board = cloneBoard(createPuzzle(this.level).board);
    this.tubes = [];
    this.selected = -1;
    this.history = [];
    this.moves = 0;
    this.anim = null;
    this.clock = new THREE.Clock();
    this.setupScene();
    this.buildWorld();
    this.setupUI();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame(() => this.frame());
  }
  readProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE));
      if (saved && Number.isInteger(saved.highest) && saved.highest > 0 && saved.stars && typeof saved.stars === 'object' && !Array.isArray(saved.stars)) return saved;
    } catch { /* fresh game */ }
    return { highest: 1, stars: {} };
  }
  saveProgress() { try { localStorage.setItem(STORAGE, JSON.stringify(this.progress)); } catch { /* storage unavailable */ } }
  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#f99b77', 35, 110);
    const sky = document.createElement('canvas'); sky.width = 2; sky.height = 256;
    const ctx = sky.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#3a246d'); gradient.addColorStop(.46, '#9067aa'); gradient.addColorStop(1, '#ffc396');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2, 256);
    this.scene.background = new THREE.CanvasTexture(sky);
    this.scene.add(new THREE.HemisphereLight('#ffe5d2', '#a34b64', 2));
    const sun = new THREE.DirectionalLight('#fff2cf', 2.3);
    sun.position.set(-8, 17, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -18;
    sun.shadow.camera.right = sun.shadow.camera.top = 18;
    this.scene.add(sun);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    $('stage').appendChild(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(-8,8,8,-8,.1,150);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bottleGroup = new THREE.Group();
    this.scene.add(this.bottleGroup);
  }
  buildWorld() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(220,220), toon('#c95e60'));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -.13;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.plateau = new THREE.Group();
    this.scene.add(this.plateau);
    mesh(this.plateau,cylinder(11,11.7,.45,12),'#934785',0,-.35,0,true);
    mesh(this.plateau,cylinder(10.8,11,.18,12),'#f7b277',0,-.07,0,true);
    // Distant rocks, gumdrop-shaped flora, and crystals make the habitable
    // Martian setting feel alive without loading any external textures.
    let seed = 72311;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 72; i++) {
      const angle = rand()*Math.PI*2, radius = 14+rand()*42;
      const x = Math.cos(angle)*radius, z = Math.sin(angle)*radius;
      const size = .25+rand()*1.05;
      if (i%6===0) {
        const crystal = mesh(this.scene,cylinder(0,size*.52,size*1.8,5),['#8fe9ff','#d38cf8','#ffe36c'][i%3],x,size*.9,z,true);
        crystal.rotation.z = (rand()-.5)*.4;
      } else {
        const rock = mesh(this.scene,new THREE.IcosahedronGeometry(size,0),['#9a4b76','#a34c6e','#f28d73'][i%3],x,size*.4,z,true);
        rock.scale.y = .6;
        rock.rotation.y = rand()*6;
      }
    }
    for (let i=0;i<16;i++) {
      const angle=i*2.4, radius=13+(i%4)*2;
      const x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
      mesh(this.scene,cylinder(.1,.15,.9,6),'#55a680',x,.45,z);
      mesh(this.scene,new THREE.IcosahedronGeometry(.42,0),i%2?'#9ae66b':'#70ddf5',x,1,z,true);
    }
    for (const [x,z,color] of [[-5.5,-4.5,'#8fe9ff'],[5.8,-4,'#d58af5'],[-5.2,4.8,'#ffe36c'],[5.4,4.5,'#9ae66b']]) {
      mesh(this.scene,cylinder(.45,.6,.2,6),'#8f518d',x,.1,z,true);
      const shard=mesh(this.scene,new THREE.ConeGeometry(.42,1.4,5),color,x,.9,z,true);
      shard.rotation.z=x<0?-.18:.18;
      mesh(this.scene,new THREE.IcosahedronGeometry(.18,0),color,x+.62,.4,z+.28);
    }
    // Hanging moons and a little rocket lander sit behind the puzzle board.
    mesh(this.scene,new THREE.IcosahedronGeometry(2.5,1),'#f7d8d9',-27,32,-55);
    mesh(this.scene,new THREE.IcosahedronGeometry(1.1,0),'#d1b0ed',29,37,-53);
    const rocket = new THREE.Group(); rocket.position.set(16,0,-14); this.scene.add(rocket);
    mesh(rocket,cylinder(.42,.55,2.1,8),'#f4eee3',0,1.55,0,true);
    mesh(rocket,new THREE.ConeGeometry(.43,.9,8),'#ff75b6',0,3.05,0,true);
    for (const s of [-1,1]) mesh(rocket,new THREE.BoxGeometry(.55,.8,.12),'#70ddf5',s*.53,.85,0,true);
    mesh(rocket,new THREE.SphereGeometry(.19,8,6),'#5bd2f3',0,1.8,.43,true);
  }
  makeBottle(index, x, z) {
    const group = new THREE.Group(); group.position.set(x,0,z); this.bottleGroup.add(group);
    mesh(group,cylinder(.7,.78,.18,12),'#7d4fa4',0,.1,0,true);
    mesh(group,cylinder(.56,.6,.11,12),'#f8d097',0,.24,0,true);
    const liquidGroup = new THREE.Group(); group.add(liquidGroup);
    // Slightly transparent faceted glass and bright rims keep the flat-color
    // liquid legible, even on small screens.
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,2.62,12,1,true),new THREE.MeshPhongMaterial({ color:'#ddfaff',transparent:true,opacity:.17,side:THREE.DoubleSide,depthWrite:false,shininess:90 }));
    glass.position.y=1.77; glass.renderOrder=3; group.add(glass);
    mesh(group,new THREE.TorusGeometry(.46,.045,5,12),'#c6f3ff',0,.48,0).rotation.x=Math.PI/2;
    mesh(group,new THREE.TorusGeometry(.46,.065,5,12),'#c6f3ff',0,3.08,0).rotation.x=Math.PI/2;
    mesh(group,cylinder(.31,.36,.35,12),'#a9d3e9',0,3.23,0,true);
    mesh(group,new THREE.TorusGeometry(.33,.07,5,12),'#e8ffff',0,3.45,0).rotation.x=Math.PI/2;
    const shine=mesh(group,new THREE.BoxGeometry(.06,2.1,.025),'#ffffff',-.3,1.82,.32);
    shine.material=new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.35,depthWrite:false});
    const hit = new THREE.Mesh(cylinder(.58,.58,3.55,8),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
    hit.position.y=1.75; hit.userData.index=index; group.add(hit);
    const glow=mesh(group,new THREE.TorusGeometry(.69,.075,5,12),'#ffe05d',0,.09,0);
    glow.rotation.x=Math.PI/2; glow.visible=false;
    return {group,liquidGroup,hit,glow};
  }
  drawLiquid(index) {
    const container=this.tubes[index].liquidGroup;
    container.traverse((object)=>{ if (object.isMesh && object.geometry) object.geometry.dispose(); });
    container.clear();
    this.board[index].forEach((color,layer) => {
      const y=.52+layer*.615+.305;
      mesh(container,cylinder(.398,.398,.61,12),COLORS[color],0,y,0);
      // A thin top surface gives the liquid a readable layer boundary.
      mesh(container,cylinder(.405,.405,.035,12),COLORS[color],0,y+.305,0);
    });
  }
  layoutBottles() {
    const count=this.board.length || 5;
    this.columns=window.innerWidth<700?3:Math.min(6,count);
    const rows=Math.ceil(count/this.columns);
    const spacingX=1.85,spacingZ=rows>1?5.05:3.75;
    this.bottleGroup.traverse((object)=>{
      if (object.isMesh && object.geometry) object.geometry.dispose();
      if (object.isMesh && object.material?.isMeshPhongMaterial) object.material.dispose();
    });
    this.bottleGroup.clear(); this.tubes=[];
    for (let i=0;i<count;i++) {
      const row=Math.floor(i/this.columns),rowCount=Math.min(this.columns,count-row*this.columns);
      const col=i%this.columns;
      this.tubes.push(this.makeBottle(i,(col-(rowCount-1)/2)*spacingX,(row-(rows-1)/2)*spacingZ));
      if (this.board[i]) this.drawLiquid(i);
    }
    this.plateau.scale.set(window.innerWidth<700?.64:1,1,rows>=3?1.15:.8);
    const aspect=window.innerWidth/window.innerHeight;
    const worldWidth=this.columns*spacingX+2.5;
    const worldHeight=rows*spacingZ+5.4;
    const height=Math.max(worldHeight,worldWidth/aspect);
    this.camera.left=-height*aspect/2; this.camera.right=height*aspect/2;
    this.camera.top=height/2; this.camera.bottom=-height/2;
    this.camera.position.set(6,15,20);
    this.camera.lookAt(0,1.4,0);
    this.camera.updateProjectionMatrix();
  }
  resize() {
    this.renderer.setSize(window.innerWidth,window.innerHeight);
    this.layoutBottles();
  }
  setupUI() {
    $('playButton').addEventListener('click',()=>this.start(this.progress.highest));
    $('mapButton').addEventListener('click',()=>this.openMap('menu'));
    $('hudMap').addEventListener('click',()=>this.openMap('game'));
    $('winMap').addEventListener('click',()=>this.openMap('win'));
    $('mapBack').addEventListener('click',()=>this.closeMap());
    $('nextButton').addEventListener('click',()=>this.start(this.level+1));
    $('undoButton').addEventListener('click',()=>this.undo());
    $('restartButton').addEventListener('click',()=>this.start(this.level));
    $('soundButton').addEventListener('click',()=>{
      this.audio.enabled=!this.audio.enabled;
      try { localStorage.setItem(SOUND,this.audio.enabled?'on':'off'); } catch { /* blocked */ }
      $('soundButton').textContent=this.audio.enabled?'🔊':'🔇';
      this.audio.unlock(); this.audio.pick();
    });
    $('soundButton').textContent=this.audio.enabled?'🔊':'🔇';
    this.renderer.domElement.addEventListener('pointerup',(event)=>this.onPointer(event));
    this.renderer.domElement.addEventListener('contextmenu',(event)=>event.preventDefault());
    document.addEventListener('dblclick',(event)=>event.preventDefault());
    document.addEventListener('keydown',(event)=>{
      if (this.state!=='playing' || this.anim) return;
      const n=Number(event.key);
      if (n>=1 && n<=this.board.length) this.tap(n-1);
      else if (event.key.toLowerCase()==='u') this.undo();
    });
    $('playButton').textContent=`▶ Play Level ${this.progress.highest}`;
  }
  start(level) {
    this.audio.unlock();
    if (this.stream) this.stream.visible=false;
    this.level=level;
    const puzzle=createPuzzle(level);
    this.par=puzzle.par;
    this.board=cloneBoard(puzzle.board);
    this.initialBoard=cloneBoard(puzzle.board);
    this.moves=0; this.history=[]; this.selected=-1; this.anim=null;
    this.state='playing';
    $('menu').classList.add('hidden'); $('map').classList.add('hidden'); $('win').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('levelNumber').textContent=level;
    $('hint').textContent='Tap a bottle, then tap another to pour.';
    this.layoutBottles(); this.updateHUD();
    this.audio.pick();
  }
  onPointer(event) {
    if (this.state!=='playing'||this.anim) return;
    this.audio.unlock();
    const box=this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX-box.left)/box.width)*2-1,-((event.clientY-box.top)/box.height)*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const hits=this.raycaster.intersectObjects(this.tubes.map(t=>t.hit),false);
    if (hits.length) this.tap(hits[0].object.userData.index);
  }
  tap(index) {
    if (!this.board[index] || this.anim) return;
    if (this.selected===-1) {
      if (!this.board[index].length) { this.audio.wrong(); $('hint').textContent='Pick a bottle that has color in it.'; return; }
      this.select(index); this.audio.pick(); $('hint').textContent='Now choose an empty bottle or matching top color.'; return;
    }
    if (this.selected===index) { this.select(-1); this.audio.pick(); $('hint').textContent='Tap a bottle to pick it up.'; return; }
    const amount=pourAmount(this.board,this.selected,index);
    if (!amount) {
      this.audio.wrong();
      this.tubes[index].group.position.y=.2;
      $('hint').textContent='That pour won’t fit. Try a matching color or empty bottle.';
      if (this.board[index].length) this.select(index);
      return;
    }
    this.history.push(cloneBoard(this.board));
    this.moves++;
    this.updateHUD();
    this.audio.pour();
    this.anim={from:this.selected,to:index,amount,color:topColor(this.board[this.selected]),time:0};
    this.select(-1);
    $('hint').textContent='Nice pour! Keep the colors together.';
  }
  select(index) {
    this.selected=index;
    this.tubes.forEach((tube,i)=>{ tube.glow.visible=i===index; });
  }
  updateHUD() {
    $('moveCount').textContent=this.moves;
    $('undoButton').disabled=this.history.length===0 || !!this.anim;
  }
  undo() {
    if (!this.history.length||this.anim||this.state!=='playing') return;
    this.board=this.history.pop(); this.moves=Math.max(0,this.moves-1);
    this.select(-1); this.tubes.forEach((_,i)=>this.drawLiquid(i));
    this.updateHUD(); this.audio.undo(); $('hint').textContent='Last pour undone.';
  }
  finish() {
    if (this.state!=='completing') return;
    this.state='win';
    const stars=this.moves<=this.par?3:this.moves<=Math.ceil(this.par*1.5)?2:1;
    this.progress.stars[this.level]=Math.max(stars,this.progress.stars[this.level]||0);
    this.progress.highest=Math.max(this.progress.highest,this.level+1);
    this.saveProgress();
    $('winStars').textContent='⭐'.repeat(stars)+'☆'.repeat(3-stars);
    $('winSummary').textContent=`You sorted every color in ${this.moves} ${this.moves===1?'move':'moves'}. ${stars===3?'A perfect little masterpiece!':'Try again to earn more stars.'}`;
    $('nextButton').textContent=`▶ Level ${this.level+1}`;
    $('win').classList.remove('hidden'); $('hud').classList.add('hidden');
    this.audio.win();
  }
  openMap(from) {
    if (this.anim) return;
    this.audio.unlock(); this.audio.pick();
    this.mapFrom=from;
    this.state='map';
    $('map').classList.remove('hidden');
    $('menu').classList.add('hidden'); $('win').classList.add('hidden'); $('hud').classList.add('hidden');
    this.renderMap();
  }
  closeMap() {
    $('map').classList.add('hidden');
    if (this.mapFrom==='game') { this.state='playing'; $('hud').classList.remove('hidden'); }
    else if (this.mapFrom==='win') { this.state='win'; $('win').classList.remove('hidden'); }
    else { this.state='menu'; $('menu').classList.remove('hidden'); }
    this.audio.pick();
  }
  renderMap() {
    const path=$('mapPath'); path.replaceChildren();
    const max=Math.max(60,Math.ceil((this.progress.highest+10)/10)*10);
    const x=[50,68,78,64,40,22,30,55,76,57,34,20];
    const rows=[];
    for (let level=1;level<=max;level++) {
      if ((level-1)%10===0) {
        const zone=document.createElement('div'); zone.className='zone';
        zone.textContent=['Landing Meadow','Crystal Cliffs','Canyon Glow','Sky Gardens','Moonlit Mesa','Aurora Ridge'][Math.floor((level-1)/10)%6]+` · ${Math.floor((level-1)/10)+1}`;
        path.append(zone);
      }
      const row=document.createElement('div'); row.className='node-row';
      const button=document.createElement('button'); button.className='level-node';
      const unlocked=level<=this.progress.highest;
      button.classList.add(!unlocked?'locked':this.progress.stars[level]?'done':'current');
      button.style.setProperty('--x',`${x[(level-1)%x.length]}%`);
      button.setAttribute('aria-label',`Level ${level}${!unlocked?', locked':this.progress.stars[level]?`, ${this.progress.stars[level]} stars`: ', unlocked'}`);
      button.disabled=!unlocked;
      button.textContent=unlocked?level:'🔒';
      if (this.progress.stars[level]) {
        const marks=document.createElement('span'); marks.className='node-stars'; marks.textContent='★'.repeat(this.progress.stars[level]); button.append(marks);
      }
      if (unlocked) button.addEventListener('click',()=>this.start(level));
      row.append(button); path.append(row); rows.push({row,button,x:x[(level-1)%x.length]});
    }
    $('totalStars').textContent=`⭐ ${Object.values(this.progress.stars).reduce((a,b)=>a+Number(b||0),0)}`;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox',`0 0 100 ${path.offsetHeight}`);
    svg.setAttribute('preserveAspectRatio','none');
    Object.assign(svg.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});
    const line=document.createElementNS('http://www.w3.org/2000/svg','path');
    line.setAttribute('d',rows.map((entry,i)=>`${i?'L':'M'} ${entry.x} ${entry.row.offsetTop+40}`).join(' '));
    line.setAttribute('fill','none'); line.setAttribute('stroke','#fff8ea'); line.setAttribute('stroke-width','1.1'); line.setAttribute('stroke-dasharray','2 1');
    svg.append(line); path.prepend(svg);
    const current=rows[this.progress.highest-1];
    if (current) $('mapScroll').scrollTop=Math.max(0,current.row.offsetTop-$('mapScroll').clientHeight*.4);
  }
  frame() {
    requestAnimationFrame(()=>this.frame());
    const dt=Math.min(.05,this.clock.getDelta());
    if (this.anim) {
      const a=this.anim; a.time+=dt;
      const t=clamp(a.time/.72,0,1);
      const source=this.tubes[a.from].group;
      const target=this.tubes[a.to].group;
      source.position.y=.56*Math.sin(Math.PI*t);
      const sign=target.position.x>=source.position.x?1:-1;
      source.rotation.z=-sign*.65*ease(clamp(t/.38,0,1))*(1-ease(clamp((t-.68)/.32,0,1)));
      if (!this.stream) {
        this.stream=new THREE.Mesh(cylinder(.055,.075,1,6),toon(COLORS[a.color]));
        this.scene.add(this.stream);
      }
      const start=new THREE.Vector3(0,3.46,0).applyMatrix4(source.matrixWorld);
      const end=new THREE.Vector3(0,3.32,0).applyMatrix4(target.matrixWorld);
      const direction=end.clone().sub(start);
      this.stream.visible=t>.22&&t<.82;
      this.stream.material=toon(COLORS[a.color]);
      this.stream.position.copy(start).addScaledVector(direction,.5);
      this.stream.scale.y=direction.length();
      this.stream.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
      if (t>=1) {
        source.position.y=0; source.rotation.z=0; this.stream.visible=false;
        pour(this.board,a.from,a.to);
        this.drawLiquid(a.from); this.drawLiquid(a.to);
        this.anim=null; this.audio.land(); this.updateHUD();
        if (isSolved(this.board)) { this.state='completing'; setTimeout(()=>this.finish(),360); }
      }
    }
    for (const tube of this.tubes) {
      if (tube.group.position.y>.01 && (!this.anim||tube.group!==this.tubes[this.anim.from].group)) tube.group.position.y*=.7;
      if (tube.glow.visible) tube.glow.rotation.z+=dt*.9;
    }
    this.renderer.render(this.scene,this.camera);
  }
}

new ColorPour();
