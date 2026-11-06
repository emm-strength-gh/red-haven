import * as THREE from 'three';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const shortest = (a, b) => a + ((((b - a) + 540) % 360) - 180);
const STORE_KEY = 'body-mechanics-pose-library-v1';
const JOINT_VISIBILITY_KEY = 'body-mechanics-joints-visible';

const BASE = {
  torso: 1.85, neck: 0.28, head: 0.72, upperArm: 1.25, forearm: 1.1,
  femur: 1.68, shin: 1.55, shoulderWidth: 1.82, hipWidth: 0.82, hand: 0.52, foot: 0.72,
};
const DEFAULT_PROPORTIONS = Object.fromEntries(Object.keys(BASE).map((k) => [k, 1]));

const JOINT_SPECS = {
  spine: { label: 'Spine', side: 'Core', color: '#f77525', axes: [['x','Pitch / bend',-45,45],['y','Yaw / twist',-55,55],['z','Roll / side bend',-35,35]] },
  neck: { label: 'Neck', side: 'Head', color: '#ffbe19', axes: [['x','Look up / down',-40,50],['y','Turn',-70,70],['z','Tilt',-35,35]] },
  leftShoulder: { label: 'Left shoulder', side: 'Left arm', color: '#f6378e', axes: [['x','Flex / extend',-120,180],['z','Abduct / adduct',-170,60],['y','Internal / external',-80,80]] },
  rightShoulder: { label: 'Right shoulder', side: 'Right arm', color: '#f6378e', axes: [['x','Flex / extend',-120,180],['z','Abduct / adduct',-60,170],['y','Internal / external',-80,80]] },
  leftElbow: { label: 'Left elbow', side: 'Left arm', color: '#009bf5', axes: [['x','Flexion',0,145],['y','Forearm rotation',-85,85]] },
  rightElbow: { label: 'Right elbow', side: 'Right arm', color: '#009bf5', axes: [['x','Flexion',0,145],['y','Forearm rotation',-85,85]] },
  leftWrist: { label: 'Left wrist', side: 'Left hand', color: '#18c985', axes: [['x','Flex / extend',-65,65],['z','Side deviation',-30,30]] },
  rightWrist: { label: 'Right wrist', side: 'Right hand', color: '#18c985', axes: [['x','Flex / extend',-65,65],['z','Side deviation',-30,30]] },
  leftHip: { label: 'Left hip', side: 'Left leg', color: '#7940df', axes: [['x','Flex / extend',-120,45],['z','Abduct / adduct',-45,50],['y','Internal / external',-40,40]] },
  rightHip: { label: 'Right hip', side: 'Right leg', color: '#7940df', axes: [['x','Flex / extend',-120,45],['z','Abduct / adduct',-50,45],['y','Internal / external',-40,40]] },
  leftKnee: { label: 'Left knee', side: 'Left leg', color: '#ffbe19', axes: [['x','Flexion',0,145],['y','Small rotation',-12,12]] },
  rightKnee: { label: 'Right knee', side: 'Right leg', color: '#ffbe19', axes: [['x','Flexion',0,145],['y','Small rotation',-12,12]] },
  leftAnkle: { label: 'Left ankle', side: 'Left foot', color: '#18c985', axes: [['x','Dorsi / plantar flex',-45,35],['z','Inversion / eversion',-20,20]] },
  rightAnkle: { label: 'Right ankle', side: 'Right foot', color: '#18c985', axes: [['x','Dorsi / plantar flex',-45,35],['z','Inversion / eversion',-20,20]] },
};

const zeroJoints = () => Object.fromEntries(Object.keys(JOINT_SPECS).map((id) => [id, { x: 0, y: 0, z: 0 }]));

const PRESETS = {
  neutral: { name: 'Neutral', body: [0,0,0], root: 0, equipment: 'none', joints: {} },
  squat: { name: 'Back squat', body: [6,0,0], root: -1.0, equipment: 'squat', joints: {
    spine:{x:15}, leftHip:{x:-70,z:-7}, rightHip:{x:-70,z:7}, leftKnee:{x:112}, rightKnee:{x:112}, leftAnkle:{x:-28}, rightAnkle:{x:-28},
    leftShoulder:{x:-55,z:-20,y:25}, rightShoulder:{x:-55,z:20,y:-25}, leftElbow:{x:110}, rightElbow:{x:110}
  }},
  deadlift: { name: 'Deadlift setup', body: [8,0,0], root: -.58, equipment: 'deadlift', joints: {
    spine:{x:29}, leftHip:{x:-62,z:-4}, rightHip:{x:-62,z:4}, leftKnee:{x:48}, rightKnee:{x:48}, leftAnkle:{x:-10}, rightAnkle:{x:-10},
    leftShoulder:{x:-24,z:-6}, rightShoulder:{x:-24,z:6}, leftElbow:{x:5}, rightElbow:{x:5}, leftWrist:{x:-10}, rightWrist:{x:-10}
  }},
  bench: { name: 'Bench press', body: [-90,0,0], root: -1.75, equipment: 'bench', joints: {
    spine:{x:-8}, leftHip:{x:-34,z:-12}, rightHip:{x:-34,z:12}, leftKnee:{x:92}, rightKnee:{x:92}, leftAnkle:{x:-18}, rightAnkle:{x:-18},
    leftShoulder:{x:-10,z:-78,y:10}, rightShoulder:{x:-10,z:78,y:-10}, leftElbow:{x:88}, rightElbow:{x:88}, leftWrist:{x:8}, rightWrist:{x:8}
  }},
  overhead: { name: 'Overhead lockout', body: [0,0,0], root: 0, equipment: 'overhead', joints: {
    spine:{x:-7}, leftShoulder:{x:176,z:-5}, rightShoulder:{x:176,z:5}, leftElbow:{x:4}, rightElbow:{x:4}, leftWrist:{x:-8}, rightWrist:{x:-8}
  }},
  runner: { name: 'Runner', body: [7,-8,-4], root: -.18, equipment: 'none', joints: {
    spine:{x:8,y:7}, leftShoulder:{x:48,z:-8}, rightShoulder:{x:-58,z:8}, leftElbow:{x:92}, rightElbow:{x:83},
    leftHip:{x:42,z:-4}, rightHip:{x:-55,z:5}, leftKnee:{x:32}, rightKnee:{x:108}, leftAnkle:{x:10}, rightAnkle:{x:-22}
  }},
};

class BodyMechanics {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.jointState = zeroJoints();
    this.bodyRotation = { x: 0, y: 0, z: 0 };
    this.proportions = { ...DEFAULT_PROPORTIONS };
    this.rootOffset = 0;
    this.equipmentMode = 'none';
    this.selectedJoint = null;
    this.musclesVisible = true;
    this.jointsVisible = true;
    try { this.jointsVisible = localStorage.getItem(JOINT_VISIBILITY_KEY) !== 'false'; } catch {}
    this.poses = [];
    this.selectedPose = -1;
    this.animation = null;
    this.cameraState = { yaw: 0.72, pitch: 1.12, distance: 16, tyaw: 0.72, tpitch: 1.12, tdistance: 16 };
    this.pointers = new Map();
    this.initScene();
    this.loadLibrary();
    this.buildRig();
    this.buildHandles();
    this.initUI();
    this.resize();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#198acb');
    this.scene.fog = new THREE.Fog('#198acb', 18, 32);
    this.camera = new THREE.PerspectiveCamera(28, 1, .1, 80);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.$('stage').appendChild(this.renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x544080, 1.2); this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff3db, 2); key.position.set(-6, 11, 8); key.castShadow = true; key.shadow.mapSize.set(1024,1024); key.shadow.camera.left=-8; key.shadow.camera.right=8; key.shadow.camera.top=10; key.shadow.camera.bottom=-3; this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x56aeff, 1); rim.position.set(7,6,-8); this.scene.add(rim);

    this.mat = {
      floor: this.toon('#25458e'), floorEdge: this.toon('#ffbe19'), skin: this.toon('#dfa14a'), skin2: this.toon('#b9742d'),
      joint: this.toon('#6436d9'), muscle: new THREE.MeshToonMaterial({ color:'#e83c53', transparent:true, opacity:.9, depthWrite:false }),
      muscle2: new THREE.MeshToonMaterial({ color:'#f77525', transparent:true, opacity:.9, depthWrite:false }),
      dark: this.toon('#201938'),
    };
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(5.4,5.65,.25,48), this.mat.floor); floor.position.y=-.18; floor.receiveShadow=true; this.scene.add(floor);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(5.5,.1,8,48), this.mat.floorEdge); edge.rotation.x=Math.PI/2; edge.position.y=-.03; this.scene.add(edge);
    const grid = new THREE.GridHelper(10,20,0x16c9ef,0x5685ca); grid.position.y=-.04; grid.material.opacity=.45; grid.material.transparent=true; this.scene.add(grid);
    this.addStudioDecor();
    this.bindStage();
    window.addEventListener('resize', () => this.resize());
  }

  toon(color) { return new THREE.MeshToonMaterial({ color }); }
  mesh(geo, mat, parent, pos=[0,0,0], rot=[0,0,0]) {
    const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.rotation.set(...rot); m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
  }
  addStudioDecor() {
    const colors=['#f6378e','#ffbe19','#18c985','#009bf5','#7940df'];
    for(let i=0;i<10;i++) {
      const a=i/10*Math.PI*2, r=7.2+(i%2)*.7;
      const g=new THREE.Group(); g.position.set(Math.cos(a)*r,.7+((i*7)%4)*.65,Math.sin(a)*r); g.rotation.y=-a;
      this.mesh(new THREE.SphereGeometry(.32+(i%3)*.08,8,6),this.toon(colors[i%colors.length]),g);
      this.scene.add(g);
    }
    const archMat=this.toon('#7940df');
    for(const x of [-5.8,5.8]) { const p=this.mesh(new THREE.CapsuleGeometry(.18,5.4,3,8),archMat,this.scene,[x,2.7,-4.6]); p.scale.z=.75; }
  }

  dims() { const d={}; for(const k in BASE) d[k]=BASE[k]*this.proportions[k]; return d; }
  naturalRoot() { const d=this.dims(); return d.femur+d.shin+.28; }
  clearRig() { if(this.body) { this.scene.remove(this.body); this.body.traverse(o=>{ if(o.geometry) o.geometry.dispose(); }); } }

  buildRig() {
    this.clearRig();
    const d=this.dims(); this.joints={}; this.muscles=[];
    this.body=new THREE.Group(); this.body.rotation.order='YXZ'; this.scene.add(this.body);
    this.body.position.y=this.naturalRoot()+this.rootOffset;

    const pelvis=new THREE.Group(); this.body.add(pelvis);
    const pelvisMesh=this.mesh(new THREE.CapsuleGeometry(.42,.34,3,8),this.mat.skin2,pelvis,[0,.05,0],[0,0,Math.PI/2]); pelvisMesh.scale.x=d.hipWidth/1.12; pelvisMesh.scale.z=.78;
    for (const x of [-d.hipWidth*.27,d.hipWidth*.27]) {
      const glute=this.mesh(new THREE.CapsuleGeometry(.18,.08,2,8),this.mat.muscle,pelvis,[x,.1,-.19],[0,0,Math.PI/2]);
      glute.userData={type:'glute'}; this.muscles.push(glute);
    }

    const spine=this.addJoint('spine',pelvis,[0,.2,0]);
    const torso=this.segment(spine,d.torso,.55,1,this.mat.skin,'torso');
    torso.mesh.scale.x=lerp(.82,1.15,this.proportions.shoulderWidth/1.3); torso.mesh.scale.z=.68;
    this.addMuscleShell(torso,d.torso,.57,1,'core');
    const chest=torso.end;

    const neck=this.addJoint('neck',chest,[0,.06,0]);
    const neckSeg=this.segment(neck,d.neck,.16,1,this.mat.skin2,'neck');
    const head=this.mesh(new THREE.CapsuleGeometry(.34,Math.max(.05,d.head-.68),4,10),this.mat.skin,neckSeg.end,[0,d.head*.38,0]); head.scale.set(.82,1.08,.9);
    this.mesh(new THREE.SphereGeometry(.045,8,6),this.mat.dark,head,[-.13,.08,.29]);
    this.mesh(new THREE.SphereGeometry(.045,8,6),this.mat.dark,head,[.13,.08,.29]);

    for(const side of ['left','right']) {
      const s=side==='left'?-1:1;
      const shoulder=this.addJoint(`${side}Shoulder`,chest,[s*d.shoulderWidth/2,-.13,0]);
      const upper=this.segment(shoulder,d.upperArm,.205,-1,this.mat.skin,`${side}UpperArm`); this.addMuscleShell(upper,d.upperArm,.22,-1,'upperArm');
      const elbow=this.addJoint(`${side}Elbow`,upper.end,[0,0,0]);
      const fore=this.segment(elbow,d.forearm,.17,-1,this.mat.skin2,`${side}Forearm`); this.addMuscleShell(fore,d.forearm,.185,-1,'forearm');
      const wrist=this.addJoint(`${side}Wrist`,fore.end,[0,0,0]);
      const hand=this.mesh(new THREE.CapsuleGeometry(.14,Math.max(.05,d.hand-.28),3,8),this.mat.skin,wrist,[0,-d.hand*.42,-.02]); hand.scale.set(.82,1,.42);
    }

    for(const side of ['left','right']) {
      const s=side==='left'?-1:1;
      const hip=this.addJoint(`${side}Hip`,pelvis,[s*d.hipWidth/2,-.13,0]);
      const thigh=this.segment(hip,d.femur,.25,-1,this.mat.skin,`${side}Thigh`); this.addMuscleShell(thigh,d.femur,.275,-1,'thigh');
      const knee=this.addJoint(`${side}Knee`,thigh.end,[0,0,0]);
      const shin=this.segment(knee,d.shin,.205,-1,this.mat.skin2,`${side}Shin`); this.addMuscleShell(shin,d.shin,.225,-1,'calf');
      const ankle=this.addJoint(`${side}Ankle`,shin.end,[0,0,0]);
      const foot=this.mesh(new THREE.CapsuleGeometry(.17,Math.max(.05,d.foot-.34),3,8),this.mat.skin,ankle,[0,-.12,-d.foot*.35],[Math.PI/2,0,0]); foot.scale.set(.8,1,.55);
    }
    this.applyState();
  }

  addJoint(id,parent,pos) {
    const pivot=new THREE.Group(); pivot.position.set(...pos); pivot.rotation.order='YXZ'; parent.add(pivot);
    const spec=JOINT_SPECS[id];
    const jointRadius=(id.includes('Hip') || id.includes('Shoulder')) ? .18 : .145;
    const ball=this.mesh(new THREE.SphereGeometry(jointRadius,10,7),this.mat.joint,pivot);
    ball.material=this.toon(spec.color); this.joints[id]={pivot,ball,spec}; return pivot;
  }
  segment(parent,length,radius,dir,material,name) {
    const g=new THREE.Group(); g.name=name; parent.add(g);
    const geo=new THREE.CapsuleGeometry(radius,Math.max(.02,length-radius*2),3,8);
    const mesh=this.mesh(geo,material,g,[0,dir*length/2,0]);
    const end=new THREE.Group(); end.position.y=dir*length; g.add(end); return {group:g,mesh,end,length,radius,dir,name};
  }
  addMuscleShell(seg,length,radius,dir,type) {
    const geo=new THREE.CapsuleGeometry(radius,Math.max(.02,length*.7-radius*2),3,8);
    const m=this.mesh(geo,type==='core'?this.mat.muscle2:this.mat.muscle,seg.group,[0,dir*length*.48,-radius*.17]);
    m.userData={type,side:seg.name.startsWith('left')?'left':seg.name.startsWith('right')?'right':'core'}; this.muscles.push(m); return m;
  }

  applyState() {
    if(!this.body) return;
    for(const [id,j] of Object.entries(this.joints)) {
      const s=this.jointState[id]||{x:0,y:0,z:0}; j.pivot.rotation.set(s.x*DEG,s.y*DEG,s.z*DEG);
    }
    this.body.rotation.set(this.bodyRotation.x*DEG,this.bodyRotation.y*DEG,this.bodyRotation.z*DEG);
    this.body.position.y=this.naturalRoot()+this.rootOffset;
    this.updateMuscles();
  }
  updateMuscles() {
    for(const m of this.muscles) {
      let flex=0, type=m.userData.type;
      if(type==='upperArm') flex=this.jointState[`${m.userData.side}Elbow`].x/145;
      else if(type==='thigh'||type==='calf') flex=this.jointState[`${m.userData.side}Knee`].x/145;
      else if(type==='core') flex=(Math.abs(this.jointState.spine.x)+Math.abs(this.jointState.spine.z))/80;
      m.scale.x=1+clamp(flex,0,1)*.16; m.scale.z=1+clamp(flex,0,1)*.2; m.visible=this.musclesVisible;
    }
  }
  buildHandles() {
    const root=this.$('jointHandles'); root.innerHTML=''; this.handleEls={};
    for(const [id,spec] of Object.entries(JOINT_SPECS)) {
      const b=document.createElement('button'); b.className='joint-handle'; b.dataset.joint=id; b.style.background=spec.color; b.setAttribute('aria-label',`Control ${spec.label}`); b.innerHTML=`<span>${spec.label}</span>`;
      root.appendChild(b); this.handleEls[id]=b;
      b.addEventListener('pointerdown',(e)=>this.startJointDrag(e,id));
    }
  }
  startJointDrag(e,id) {
    if(this.animation) this.stopAnimation();
    e.preventDefault(); e.stopPropagation(); this.selectJoint(id);
    const spec=JOINT_SPECS[id], start={...this.jointState[id]}, sx=e.clientX, sy=e.clientY; let moved=false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const move=(ev)=>{
      const dx=ev.clientX-sx,dy=ev.clientY-sy; if(Math.hypot(dx,dy)>3)moved=true;
      const a=spec.axes[0],b=spec.axes[1];
      this.setJoint(id,a[0],start[a[0]]-dy*.42,false);
      if(b)this.setJoint(id,b[0],start[b[0]]+dx*.42,false);
      this.renderJointEditor();
    };
    const up=()=>{ window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); if(moved)this.toast(`${spec.label} constrained to its safe range`); };
    window.addEventListener('pointermove',move); window.addEventListener('pointerup',up,{once:true});
  }
  selectJoint(id) {
    this.selectedJoint=id;
    for(const [k,el] of Object.entries(this.handleEls)) el.classList.toggle('active',k===id);
    this.renderJointEditor();
    if(innerWidth<=900)this.$('panel').classList.add('open');
  }
  setJoint(id,axis,value,refresh=true) {
    const def=JOINT_SPECS[id].axes.find(a=>a[0]===axis); if(!def)return;
    this.jointState[id][axis]=clamp(+value,def[2],def[3]);
    if(this.joints[id])this.joints[id].pivot.rotation[axis]=this.jointState[id][axis]*DEG;
    this.updateMuscles(); if(refresh)this.renderJointEditor();
  }

  bindStage() {
    const el=this.renderer.domElement;
    el.addEventListener('pointerdown',(e)=>{
      el.setPointerCapture?.(e.pointerId); this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,lx:e.clientX,ly:e.clientY});
      if(this.pointers.size===2){const p=[...this.pointers.values()];this.pinch={d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),zoom:this.cameraState.tdistance};}
    });
    el.addEventListener('pointermove',(e)=>{
      const p=this.pointers.get(e.pointerId); if(!p)return; const dx=e.clientX-p.lx,dy=e.clientY-p.ly; p.x=p.lx=e.clientX;p.y=p.ly=e.clientY;
      if(this.pointers.size>=2&&this.pinch){const q=[...this.pointers.values()],d=Math.hypot(q[0].x-q[1].x,q[0].y-q[1].y)||1;this.cameraState.tdistance=clamp(this.pinch.zoom*this.pinch.d/d,8,23);return;}
      this.cameraState.tyaw-=dx*.008; this.cameraState.tpitch=clamp(this.cameraState.tpitch+dy*.006,.28,1.5);
    });
    const end=(e)=>{this.pointers.delete(e.pointerId);if(this.pointers.size<2)this.pinch=null;};
    el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
    el.addEventListener('wheel',(e)=>{e.preventDefault();this.cameraState.tdistance=clamp(this.cameraState.tdistance*Math.exp(e.deltaY*.001),8,23);},{passive:false});
    document.addEventListener('contextmenu',(e)=>e.preventDefault()); document.addEventListener('dblclick',(e)=>e.preventDefault());
  }

  initUI() {
    this.$('jointToggle').addEventListener('click',()=>{
      this.jointsVisible=!this.jointsVisible;
      try { localStorage.setItem(JOINT_VISIBILITY_KEY,String(this.jointsVisible)); } catch {}
      this.syncJointVisibility();
    });
    this.syncJointVisibility();
    document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>this.openTab(b.dataset.tab)));
    document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>this.applyPreset(b.dataset.preset)));
    document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>this.setView(b.dataset.view,b)));
    this.$('panelToggle').addEventListener('click',()=>this.$('panel').classList.add('open'));
    this.$('panelClose').addEventListener('click',()=>this.$('panel').classList.remove('open'));
    this.$('resetPose').addEventListener('click',()=>this.applyPreset('neutral'));
    this.$('muscleToggle').addEventListener('click',()=>{this.musclesVisible=!this.musclesVisible;this.$('muscleToggle').setAttribute('aria-pressed',String(this.musclesVisible));this.updateMuscles();this.toast(this.musclesVisible?'Muscle layer on':'Muscle layer off');});
    this.$('resetProportions').addEventListener('click',()=>{this.proportions={...DEFAULT_PROPORTIONS};this.buildRig();this.renderProportionSliders();this.toast('Proportions reset');});
    this.$('addPose').addEventListener('click',()=>this.addPose());
    this.$('updatePose').addEventListener('click',()=>this.updateSelectedPose());
    this.$('playSequence').addEventListener('click',()=>this.playSequence());
    this.$('stopSequence').addEventListener('click',()=>this.stopAnimation());
    this.$('poseDuration').addEventListener('input',(e)=>{this.$('poseDurationOut').textContent=`${(+e.target.value).toFixed(1)}s`;this.saveLibrary();});
    this.$('loopPlayback').addEventListener('change',()=>this.saveLibrary());
    this.buildBodySliders(); this.renderProportionSliders(); this.renderPoseList(); this.updateTransport();
  }
  openTab(name) {
    document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.id===`tab-${name}`));
  }
  syncJointVisibility() {
    this.$('jointHandles').hidden=!this.jointsVisible;
    this.$('jointToggle').textContent=this.jointsVisible?'Hide joints':'Show joints';
    this.$('jointToggle').setAttribute('aria-pressed',String(this.jointsVisible));
    this.$('hint').innerHTML=this.jointsVisible
      ? '<b>Drag a joint</b> to pose · drag the floor to orbit · pinch or wheel to zoom'
      : '<b>Joints hidden</b> · drag the floor to orbit · pinch or wheel to zoom';
  }
  slider(container,{label,min,max,step=1,value,unit='°',onInput}) {
    const row=document.createElement('div');row.className='slider-row';
    row.innerHTML=`<label><span>${label}</span><output>${unit==='%'?Math.round(value*100):Math.round(value)}${unit}</output></label><input type="range" min="${min}" max="${max}" step="${step}" value="${value}">`;
    const input=row.querySelector('input'),out=row.querySelector('output');
    input.addEventListener('input',()=>{const v=+input.value;out.textContent=unit==='%'?`${Math.round(v*100)}%`:`${Math.round(v)}${unit}`;onInput(v);});
    container.appendChild(row); return input;
  }
  renderJointEditor() {
    const c=this.$('jointSliders');c.innerHTML='';c.classList.toggle('empty',!this.selectedJoint);
    if(!this.selectedJoint){this.$('jointTitle').textContent='Select a joint';this.$('jointSide').textContent='Tap a colored handle';c.innerHTML='<p>Each joint is restricted to a practical human range. Drag a handle for fast posing or use the sliders for precision.</p>';return;}
    const spec=JOINT_SPECS[this.selectedJoint];this.$('jointTitle').textContent=spec.label;this.$('jointSide').textContent=spec.side;
    for(const [axis,label,min,max] of spec.axes)this.slider(c,{label,min,max,value:this.jointState[this.selectedJoint][axis],onInput:v=>this.setJoint(this.selectedJoint,axis,v,false)});
  }
  buildBodySliders() {
    const c=this.$('bodySliders');c.innerHTML='';
    for(const [axis,label,min,max] of [['x','Pitch forward / back',-100,100],['y','Yaw left / right',-180,180],['z','Roll side to side',-100,100]])
      this.slider(c,{label,min,max,value:this.bodyRotation[axis],onInput:v=>{this.bodyRotation[axis]=v;this.applyState();}});
  }
  renderProportionSliders() {
    const c=this.$('proportionSliders');c.innerHTML='';
    const labels={torso:'Torso length',neck:'Neck length',head:'Head size',upperArm:'Upper arms',forearm:'Forearms',femur:'Femurs',shin:'Lower legs',shoulderWidth:'Shoulder width',hipWidth:'Hip width',hand:'Hands',foot:'Feet'};
    for(const key of Object.keys(labels))this.slider(c,{label:labels[key],min:.7,max:1.3,step:.01,value:this.proportions[key],unit:'%',onInput:v=>{this.proportions[key]=v;this.buildRig();}});
  }
  refreshBodyInputs() { this.buildBodySliders(); }

  applyPreset(key) {
    if(this.animation)this.stopAnimation(); const p=PRESETS[key]; if(!p)return;
    this.jointState=zeroJoints(); for(const [id,val] of Object.entries(p.joints))Object.assign(this.jointState[id],val);
    [this.bodyRotation.x,this.bodyRotation.y,this.bodyRotation.z]=p.body; this.rootOffset=p.root;this.equipmentMode=p.equipment;
    this.applyState();this.renderJointEditor();this.refreshBodyInputs();this.toast(`${p.name} pose loaded`);
  }
  capture() { return { joints:structuredClone(this.jointState),body:{...this.bodyRotation},proportions:{...this.proportions},root:this.rootOffset,equipment:this.equipmentMode,muscles:this.musclesVisible }; }
  loadSnapshot(data,{quiet=false}={}) {
    if(this.animation)this.stopAnimation();this.jointState=zeroJoints();
    for(const [id,val] of Object.entries(data.joints||{}))if(this.jointState[id])Object.assign(this.jointState[id],val);
    this.bodyRotation={x:0,y:0,z:0,...data.body};this.proportions={...DEFAULT_PROPORTIONS,...data.proportions};this.rootOffset=data.root||0;this.equipmentMode=data.equipment||'none';this.musclesVisible=data.muscles!==false;
    this.$('muscleToggle').setAttribute('aria-pressed',String(this.musclesVisible));this.buildRig();this.renderJointEditor();this.refreshBodyInputs();this.renderProportionSliders();if(!quiet)this.toast('Saved pose loaded');
  }
  addPose() {
    const n=this.poses.length+1;this.poses.push({id:Date.now()+Math.random(),name:`Pose ${n}`,data:this.capture()});this.selectedPose=this.poses.length-1;this.saveLibrary();this.renderPoseList();this.updateTransport();this.toast('Pose saved to this device');
  }
  updateSelectedPose() { if(this.selectedPose<0||!this.poses[this.selectedPose])return;this.poses[this.selectedPose].data=this.capture();this.saveLibrary();this.renderPoseList();this.toast('Saved pose updated'); }
  deletePose(index) { this.poses.splice(index,1);this.selectedPose=Math.min(this.selectedPose,this.poses.length-1);this.saveLibrary();this.renderPoseList();this.updateTransport(); }
  renderPoseList() {
    const c=this.$('poseList');c.innerHTML='';this.$('poseCount').textContent=`${this.poses.length} pose${this.poses.length===1?'':'s'} saved`;
    this.$('updatePose').disabled=this.selectedPose<0;
    if(!this.poses.length){c.innerHTML='<div class="pose-empty">Your reusable pose library is empty.<br>Pose the mannequin, then add the current pose.</div>';return;}
    this.poses.forEach((p,i)=>{const row=document.createElement('div');row.className=`pose-item${i===this.selectedPose?' selected':''}`;row.innerHTML=`<span class="num">${i+1}</span><input class="pose-name" aria-label="Pose name" value="${this.escape(p.name)}"><button class="load">Load</button><button class="delete" aria-label="Delete ${this.escape(p.name)}">×</button>`;
      row.addEventListener('click',()=>{this.selectedPose=i;this.renderPoseList();});
      row.querySelector('.load').addEventListener('click',(e)=>{e.stopPropagation();this.selectedPose=i;this.loadSnapshot(p.data);this.renderPoseList();});
      row.querySelector('.delete').addEventListener('click',(e)=>{e.stopPropagation();this.deletePose(i);});
      row.querySelector('input').addEventListener('click',e=>e.stopPropagation());row.querySelector('input').addEventListener('change',(e)=>{p.name=e.target.value.trim()||`Pose ${i+1}`;this.saveLibrary();this.renderPoseList();});c.appendChild(row);
    });
  }
  escape(s) { const d=document.createElement('div');d.textContent=s;return d.innerHTML.replaceAll('"','&quot;'); }
  loadLibrary() { try{const s=JSON.parse(localStorage.getItem(STORE_KEY)||'{}');this.poses=Array.isArray(s.poses)?s.poses:[];if(s.duration)this.$('poseDuration').value=s.duration;if(typeof s.loop==='boolean')this.$('loopPlayback').checked=s.loop;}catch{this.poses=[];} }
  saveLibrary() { localStorage.setItem(STORE_KEY,JSON.stringify({poses:this.poses,duration:+this.$('poseDuration').value,loop:this.$('loopPlayback').checked})); }

  playSequence() {
    if(this.poses.length<2){this.openTab('sequence');this.$('panel').classList.add('open');this.toast('Save at least two poses first');return;}
    const from=this.capture();this.animation={index:0,start:performance.now(),from,to:this.poses[0].data};this.prepareTweenTarget(this.animation.to);this.$('playSequence').disabled=true;this.$('stopSequence').disabled=false;this.$('transportTitle').textContent='Playing pose sequence';
  }
  prepareTweenTarget(to) {
    const changed=Object.keys(DEFAULT_PROPORTIONS).some(k=>Math.abs((to.proportions?.[k]??1)-this.proportions[k])>.001);
    if(changed){this.proportions={...DEFAULT_PROPORTIONS,...to.proportions};this.buildRig();this.renderProportionSliders();}
    this.equipmentMode=to.equipment||'none';
  }
  updateAnimation(now) {
    const a=this.animation;if(!a)return;const duration=+this.$('poseDuration').value*1000;const t=clamp((now-a.start)/duration,0,1),q=ease(t);
    for(const id of Object.keys(this.jointState))for(const axis of ['x','y','z'])this.jointState[id][axis]=lerp(a.from.joints[id]?.[axis]||0,a.to.joints[id]?.[axis]||0,q);
    for(const axis of ['x','y','z'])this.bodyRotation[axis]=lerp(a.from.body?.[axis]||0,shortest(a.from.body?.[axis]||0,a.to.body?.[axis]||0),q);
    this.rootOffset=lerp(a.from.root||0,a.to.root||0,q);this.applyState();this.$('transportStatus').textContent=`Pose ${a.index+1} of ${this.poses.length}`;
    if(t>=1){let next=a.index+1;if(next>=this.poses.length){if(!this.$('loopPlayback').checked){this.stopAnimation(false);this.toast('Sequence complete');return;}next=0;}const from=this.capture(),to=this.poses[next].data;this.animation={index:next,start:now,from,to};this.prepareTweenTarget(to);}
  }
  stopAnimation(show=true) { this.animation=null;this.$('playSequence').disabled=false;this.$('stopSequence').disabled=true;this.updateTransport();if(show)this.toast('Playback stopped'); }
  updateTransport() { this.$('transportTitle').textContent=this.poses.length?`${this.poses.length} saved pose${this.poses.length===1?'':'s'}`:'Build a sequence';this.$('transportStatus').textContent=this.poses.length<2?'Add two or more poses to animate':'Ready to play and loop'; }

  setView(name,button) {
    const views={front:[0,1.12],side:[Math.PI/2,1.12],three:[.72,1.12],back:[Math.PI,1.12]};[this.cameraState.tyaw,this.cameraState.tpitch]=views[name];document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));
  }
  updateCamera(dt) {
    const c=this.cameraState,k=1-Math.exp(-dt*7);c.yaw=lerp(c.yaw,c.tyaw,k);c.pitch=lerp(c.pitch,c.tpitch,k);c.distance=lerp(c.distance,c.tdistance,k);
    const d=this.dims();const localCenter=new THREE.Vector3(0,d.torso*.1,0).applyEuler(this.body.rotation).add(this.body.position);this.lookTarget=this.lookTarget||localCenter.clone();this.lookTarget.lerp(localCenter,k);
    const sp=Math.sin(c.pitch);this.camera.position.set(this.lookTarget.x+Math.sin(c.yaw)*sp*c.distance,this.lookTarget.y+Math.cos(c.pitch)*c.distance,this.lookTarget.z+Math.cos(c.yaw)*sp*c.distance);this.camera.lookAt(this.lookTarget);
  }
  updateHandles() {
    if(!this.jointsVisible)return;
    const rect=this.renderer.domElement.getBoundingClientRect(),v=new THREE.Vector3();
    for(const [id,j] of Object.entries(this.joints)){j.pivot.getWorldPosition(v);v.project(this.camera);const el=this.handleEls[id];const visible=v.z>-1&&v.z<1&&v.x>-1.1&&v.x<1.1&&v.y>-1.1&&v.y<1.1;el.style.display=visible?'flex':'none';if(visible){el.style.left=`${(v.x*.5+.5)*rect.width}px`;el.style.top=`${(-v.y*.5+.5)*rect.height}px`;el.style.opacity=String(clamp(1-(v.z-.5)*.4,.45,1));}}
  }
  resize() { const rect=this.$('stage').getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false); }
  loop(now) { requestAnimationFrame(this.loop);const dt=Math.min(.05,(now-this.last)/1000||0);this.last=now;if(this.animation)this.updateAnimation(now);this.updateCamera(dt);this.updateHandles();this.renderer.render(this.scene,this.camera); }
  toast(text) { const el=this.$('toast');el.textContent=text;el.classList.remove('show');void el.offsetWidth;el.classList.add('show');clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>el.classList.remove('show'),1900); }
}

new BodyMechanics();
