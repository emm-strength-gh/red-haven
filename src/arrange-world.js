import * as THREE from 'three';

// Fifteen looping background scenes. Geometry is shared and only one event is active at a time.
export const MARS_EVENTS = [
  ['Sand-worm migration', 'rover'],
  ['Scout rocket landing', 'rocket'],
  ['Scout rocket launch', 'rocket'],
  ['Meteor impact', 'meteor'],
  ['Meteor shower', 'meteor'],
  ['Dust devil', 'wind'],
  ['Red dust squall', 'wind'],
  ['Rover patrol', 'rover'],
  ['UFO flyby', 'rover'],
  ['Supply pod drop', 'rocket'],
  ['Crystal pulse', 'crystal'],
  ['Steam geyser', 'geyser'],
  ['Volcanic vent', 'meteor'],
  ['Orbital satellite', 'rover'],
  ['Glowing alien spores', 'crystal'],
];

const cache = new Map();
function geometry(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}
const box = (w, h, d) => geometry(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const ico = (r) => geometry(`i${r}`, () => new THREE.IcosahedronGeometry(r, 0));
const sphere = (r) => geometry(`s${r}`, () => new THREE.SphereGeometry(r, 8, 6));
const cone = (r, h) => geometry(`c${r},${h}`, () => new THREE.ConeGeometry(r, h, 7));
const cylinder = (r1, r2, h) => geometry(`y${r1},${r2},${h}`, () => new THREE.CylinderGeometry(r1, r2, h, 8));
const ring = (r) => geometry(`t${r}`, () => new THREE.TorusGeometry(r, .09, 5, 16));
const ease = (t) => t * t * (3 - 2 * t);
const random = (a, b) => a + Math.random() * (b - a);

export class MarsAmbience {
  constructor(scene, makeMesh, audio, onEvent) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.mesh = makeMesh;
    this.audio = audio;
    this.onEvent = onEvent;
    this.clock = 0;
    this.timer = 4;
    this.queue = [];
    this.worms = [];
    this.current = null;
    this.layout = null;
  }

  add(parent, shape, color, x = 0, y = 0, z = 0, outline = false) {
    return this.mesh(parent, shape, color, x, y, z, outline);
  }

  reset(layout) {
    this.root.clear();
    this.worms = [];
    this.current = null;
    this.layout = layout;
    this.timer = 3.5;
    if (!layout) return;
    const edge = (layout.cols - 1) * layout.spacing / 2 + 1.25;
    const depth = .8 + (layout.rows - 1) * layout.spacing;

    // Side terrain is near enough to see, but never covers a playable tile.
    for (let i = 0; i < 24; i++) {
      const sign = i % 2 ? 1 : -1;
      const x = sign * (edge + random(.25, 2.5));
      const z = random(-3.8, depth + 1.5);
      const size = random(.25, .95);
      const rock = this.add(this.root, ico(.75), i % 3 ? '#a8463d' : '#e48762', x, size * .32, z, true);
      rock.scale.set(size, size * .65, size * .9);
      rock.rotation.y = random(0, Math.PI);
    }
    for (let i = 0; i < 10; i++) {
      const sign = i % 2 ? 1 : -1;
      const crystal = this.add(this.root, cone(.32, 1.1), i % 2 ? '#68d5dc' : '#a78bff', sign * (edge + random(.4, 2.5)), .52, random(-3, depth + 1), true);
      crystal.rotation.z = random(-.2, .2);
    }
    for (let i = 0; i < 2; i++) {
      const group = new THREE.Group();
      this.root.add(group);
      const segments = [];
      for (let j = 0; j < 7; j++) {
        const segment = this.add(group, ico(j === 0 ? .42 : .34), i ? '#83d765' : '#7bd9cb', 0, 0, 0, j === 0);
        segments.push(segment);
      }
      const eye = this.add(segments[0], sphere(.08), '#29263c', .2, .18, .25);
      eye.scale.set(1, 1, .6);
      this.worms.push({ group, segments, x: (i ? 1 : -1) * (edge + .6), phase: i * 2.8, depth });
    }
  }

  makeRocket(group) {
    const rocket = new THREE.Group();
    group.add(rocket);
    this.add(rocket, cylinder(.35, .43, 1.7), '#fff4dc', 0, 0, 0, true);
    this.add(rocket, cone(.37, .72), '#ff6653', 0, 1.17, 0, true);
    this.add(rocket, cylinder(.2, .28, .28), '#35314a', 0, -1, 0);
    this.add(rocket, sphere(.22), '#5ed3f3', 0, .3, .35, true);
    for (const sign of [-1, 1]) {
      const fin = this.add(rocket, box(.18, .68, .53), '#ff8a3d', sign * .43, -.68, 0, true);
      fin.rotation.z = sign * .24;
    }
    return rocket;
  }

  makeMeteor(group, size = .38) {
    const body = this.add(group, ico(size), '#544052', 0, 0, 0, true);
    this.add(group, cone(size * .5, size * 2.2), '#ffb14c', 0, size * .9, 0).rotation.z = -.4;
    return body;
  }

  next() {
    if (!this.layout) return;
    if (!this.queue.length) {
      this.queue = Array.from({ length: MARS_EVENTS.length }, (_, i) => i);
      for (let i = this.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
      }
    }
    this.spawn(this.queue.pop());
    this.timer = random(11, 16);
  }

  spawn(index) {
    if (this.current) this.root.remove(this.current.group);
    const group = new THREE.Group();
    this.root.add(group);
    const [name, sound] = MARS_EVENTS[index];
    this.audio.event(sound);
    this.onEvent(name);
    const l = this.layout;
    const edge = (l.cols - 1) * l.spacing / 2 + 1.3;
    const side = Math.random() < .5 ? -1 : 1;
    const x = side * edge;
    const z = .8 + Math.floor(l.rows / 2) * l.spacing;
    const parts = [];
    let duration = 5.5;
    let animate = () => {};

    if (index === 0) { // migrating giant sand worm
      for (let i = 0; i < 10; i++) parts.push(this.add(group, ico(i === 0 ? .55 : .4), '#9ae76a', 0, 0, 0, i === 0));
      animate = (t) => parts.forEach((part, i) => part.position.set(x + side * Math.sin(t * 8 - i * .55) * .45, .25 + Math.max(0, Math.sin(t * 10 - i * .65)) * .3, z + 5 - t * 10 + i * .5));
    } else if (index === 1 || index === 2) { // landing / launch
      const rocket = this.makeRocket(group);
      const smoke = Array.from({ length: 5 }, (_, i) => this.add(group, ico(.3), '#ead0bb', x + (i - 2) * .33, .2, z + (i % 2) * .3));
      animate = (t) => {
        rocket.position.set(x, index === 1 ? 1.15 + 12 * (1 - ease(t)) : 1.15 + 13 * ease(t), z);
        rocket.rotation.z = Math.sin(t * 13) * .025;
        smoke.forEach((puff, i) => {
          const visible = index === 1 ? t > .62 : t < .75;
          puff.visible = visible;
          puff.position.y = .2 + ((t * 3 + i * .18) % 1) * 1.5;
          puff.scale.setScalar(.5 + ((t * 3 + i * .18) % 1) * 1.5);
        });
      };
    } else if (index === 3 || index === 4) { // impact / shower
      const count = index === 3 ? 1 : 4;
      const meteors = [];
      for (let i = 0; i < count; i++) {
        const meteor = new THREE.Group(); group.add(meteor); this.makeMeteor(meteor, i ? .24 : .38); meteors.push(meteor);
      }
      const impact = this.add(group, ring(.55), '#ffd36d', x, .12, z);
      impact.rotation.x = Math.PI / 2;
      animate = (t) => {
        meteors.forEach((meteor, i) => {
          const p = Math.min(1, Math.max(0, t * 1.4 - i * .17));
          meteor.position.set(x - 4 + i * .8 + p * 4, 10 - p * 9.65, z - 3 + i * .55 + p * 3);
          meteor.visible = p < 1;
        });
        impact.visible = t > (index === 3 ? .7 : .9);
        impact.scale.setScalar(1 + Math.max(0, t - .7) * 12);
      };
    } else if (index === 5) { // dust devil
      const funnel = new THREE.Group(); group.add(funnel);
      for (let i = 0; i < 4; i++) this.add(funnel, cone(.45 + i * .2, .85), i % 2 ? '#e5a377' : '#d77f5b', 0, .5 + i * .62, 0).rotation.x = Math.PI;
      animate = (t) => { funnel.position.set(x + Math.sin(t * 5) * 1.6, .05, z + (t - .5) * 4); funnel.rotation.y = t * 15; };
    } else if (index === 6) { // rolling dust squall
      for (let i = 0; i < 8; i++) {
        const cloud = this.add(group, ico(.7), i % 2 ? '#e6a17d' : '#c77b62');
        cloud.scale.set(1.8, .7, .8); parts.push(cloud);
      }
      animate = (t) => parts.forEach((cloud, i) => cloud.position.set(-side * (edge + 5) + side * t * (edge * 2 + 10) + (i % 3) * .7, .45 + i * .19, z + (i - 4) * .55));
    } else if (index === 7) { // rover patrol
      const rover = new THREE.Group(); group.add(rover);
      this.add(rover, box(1.6, .42, 1), '#5ed3f3', 0, .67, 0, true);
      this.add(rover, box(.8, .35, .7), '#fff1d6', 0, 1.05, -.1, true);
      const wheels = [];
      for (const xx of [-.65, .65]) for (const zz of [-.46, .46]) {
        const wheel = this.add(rover, cylinder(.25, .25, .18), '#303049', xx, .38, zz, true);
        wheel.rotation.z = Math.PI / 2; wheels.push(wheel);
      }
      animate = (t) => { rover.position.set(-edge - 2 + t * (edge * 2 + 4), 0, z + 1.3); wheels.forEach((wheel) => { wheel.rotation.x += .11; }); };
    } else if (index === 8) { // saucer flyby
      const saucer = new THREE.Group(); group.add(saucer);
      this.add(saucer, cylinder(.55, 1.2, .34), '#a47bed', 0, 0, 0, true);
      this.add(saucer, sphere(.58), '#68d9ef', 0, .3, 0, true).scale.y = .52;
      for (let i = 0; i < 6; i++) this.add(saucer, sphere(.09), '#fff09b', Math.cos(i * Math.PI / 3) * .85, -.1, Math.sin(i * Math.PI / 3) * .85);
      animate = (t) => { saucer.position.set(-edge - 3 + t * (edge * 2 + 6), 4 + Math.sin(t * 15) * .3, z); saucer.rotation.y = t * 5; };
    } else if (index === 9) { // supply pod and parachute
      const pod = new THREE.Group(); group.add(pod);
      this.add(pod, cylinder(.46, .39, 1), '#ffca67', 0, 0, 0, true);
      this.add(pod, cone(.43, .4), '#ff6c59', 0, .7, 0, true);
      const chute = this.add(pod, sphere(1.1), '#fff1d6', 0, 1.8, 0, true);
      chute.scale.y = .4;
      animate = (t) => { pod.position.set(x + Math.sin(t * 7) * .4, .6 + 9 * (1 - ease(t)), z); chute.visible = t < .9; };
    } else if (index === 10) { // crystal pulse
      for (let i = 0; i < 6; i++) parts.push(this.add(group, cone(.26, .9 + i % 3 * .25), i % 2 ? '#8cf0e9' : '#bfa0ff', x + (i % 3 - 1) * .55, .55, z + (Math.floor(i / 3) - .5) * .65, true));
      animate = (t) => parts.forEach((part, i) => part.scale.setScalar(1 + .2 * Math.sin(t * 24 - i * .7)));
    } else if (index === 11) { // steam geyser
      const vent = this.add(group, cylinder(.7, .8, .18), '#4c4851', x, .1, z, true);
      vent.rotation.y = .4;
      for (let i = 0; i < 9; i++) parts.push(this.add(group, ico(.22 + i % 3 * .07), '#e9dfc8'));
      animate = (t) => parts.forEach((puff, i) => {
        const phase = (t * 2.8 + i / parts.length) % 1;
        puff.position.set(x + Math.sin(i * 2.4) * phase * .7, .3 + phase * 4, z + Math.cos(i * 2.4) * phase * .7);
        puff.scale.setScalar(1 - phase * .75);
      });
    } else if (index === 12) { // volcanic vent
      this.add(group, cone(.9, 1.3), '#553d45', x, .6, z, true);
      this.add(group, cone(.45, .65), '#ff9a46', x, 1.25, z);
      for (let i = 0; i < 9; i++) parts.push(this.add(group, ico(.13), '#ffd15a'));
      animate = (t) => parts.forEach((spark, i) => {
        const phase = (t * 3.2 + i / 9) % 1;
        spark.position.set(x + Math.sin(i * 2.4) * phase * 1.2, 1.3 + Math.sin(phase * Math.PI) * 2, z + Math.cos(i * 2.4) * phase * 1.2);
      });
    } else if (index === 13) { // satellite crossing the sky
      const satellite = new THREE.Group(); group.add(satellite);
      this.add(satellite, box(.65, .65, .65), '#cfc9ca', 0, 0, 0, true);
      this.add(satellite, box(1.3, .12, .75), '#4d96ff', -1, 0, 0, true);
      this.add(satellite, box(1.3, .12, .75), '#4d96ff', 1, 0, 0, true);
      animate = (t) => { satellite.position.set(-edge - 4 + t * (edge * 2 + 8), 8 + Math.sin(t * Math.PI) * 2, z - 3); satellite.rotation.z = t * 2; };
    } else { // glowing alien spores
      for (let i = 0; i < 14; i++) parts.push(this.add(group, sphere(.11 + i % 3 * .04), i % 2 ? '#a9ed72' : '#7de8df'));
      animate = (t) => parts.forEach((spore, i) => {
        const angle = i * 2.4 + t * 5;
        spore.position.set(x + Math.cos(angle) * (1 + i % 4 * .2), .5 + (i % 5) * .42 + Math.sin(t * 16 + i) * .2, z + Math.sin(angle) * 1.3);
        spore.scale.setScalar(.7 + .3 * Math.sin(t * 20 + i));
      });
    }

    this.current = { group, age: 0, duration, animate };
    animate(0);
  }

  update(delta, active) {
    this.clock += delta;
    for (const worm of this.worms) {
      worm.group.position.set(worm.x + Math.sin(this.clock * .45 + worm.phase) * .35, 0, (this.clock * .5 + worm.phase * 2) % (worm.depth + 6) - 2);
      worm.segments.forEach((segment, i) => segment.position.set(Math.sin(this.clock * 4 - i * .65 + worm.phase) * .25, .29 + Math.max(0, Math.sin(this.clock * 5 - i * .7)) * .15, -i * .42));
    }
    if (this.current) {
      this.current.age += delta;
      this.current.animate(Math.min(1, this.current.age / this.current.duration));
      if (this.current.age >= this.current.duration) {
        this.root.remove(this.current.group);
        this.current = null;
      }
    }
    if (active && this.layout) {
      this.timer -= delta;
      if (this.timer <= 0) this.next();
    }
  }
}
