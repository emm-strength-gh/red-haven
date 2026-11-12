// Rocket to the Rim — synthesised Web Audio: an engine rumble that follows speed and
// boost, plus one-shot effects. No audio files, so it works offline.

const KEY = 'rocket-rim-audio';

export class RocketAudio {
  constructor() {
    this.ctx = null;
    this.on = true;
    try { this.on = localStorage.getItem(KEY) !== 'off'; } catch { /* storage blocked */ }
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.on ? 0.8 : 0;
    this.master.connect(ctx.destination);
    // engine: looping brown noise through a low-pass whose cutoff rises with speed
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 3.5; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 200;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    src.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    src.start();
    // black-hole drone
    this.drone = ctx.createOscillator();
    this.drone.type = 'sine';
    this.drone.frequency.value = 48;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.drone.connect(this.droneGain).connect(this.master);
    this.drone.start();
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem(KEY, this.on ? 'on' : 'off'); } catch { /* ignore */ }
    if (this.master) this.master.gain.value = this.on ? 0.8 : 0;
    return this.on;
  }

  suspend() { this.ctx?.suspend(); }
  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  /** Continuous layers. */
  update(g) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const flying = g.phase === 'fly';
    const t = this.ctx.currentTime;
    const boost = g.boosting ? 1 : 0;
    this.engineGain.gain.setTargetAtTime(flying ? 0.22 + boost * 0.18 : g.phase === 'countdown' ? 0.06 : 0, t, 0.15);
    this.engineFilter.frequency.setTargetAtTime(160 + g.speed * 9 + boost * 500, t, 0.2);
    this.droneGain.gain.setTargetAtTime(flying ? g.fx.pull * 0.35 : 0, t, 0.3);
    this.drone.frequency.setTargetAtTime(40 + g.fx.pull * 30, t, 0.3);
  }

  tone(freq, dur, type = 'sine', vol = 0.25, slide = 0, when = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const gn = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, freq, vol = 0.3, type = 'bandpass', when = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const gn = ctx.createGain();
    gn.gain.value = vol;
    src.connect(f).connect(gn).connect(this.master);
    src.start(ctx.currentTime + when);
  }

  /** One-shot effects keyed by the simulation's out-messages. */
  play(m) {
    switch (m.t) {
      case 'liftoff': this.noise(2.2, 160, 0.6, 'lowpass'); this.tone(90, 1.6, 'sawtooth', 0.08, 60); break;
      case 'tick': this.tone(880, 0.12, 'square', 0.08); break;
      case 'hit': this.tone(120, 0.25, 'sine', 0.4, -60); this.noise(0.25, 700, 0.35); break;
      case 'smash': this.noise(0.18, 1600, 0.2); break;
      case 'shieldHit': this.tone(1200, 0.2, 'triangle', 0.15, -500); break;
      case 'pickup':
        if (m.kind === 'ring') { this.tone(988, 0.08, 'triangle', 0.12); this.tone(1480, 0.14, 'triangle', 0.1, 0, 0.05); }
        else [784, 988, 1319].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.13, 0, i * 0.05));
        break;
      case 'banner': if (m.tone === 'magenta') this.tone(440, 0.12, 'square', 0.06, -80); break;
      case 'warn': case 'charge': this.tone(1046, 0.08, 'square', 0.07); this.tone(1046, 0.08, 'square', 0.07, 0, 0.14); break;
      case 'meteor': this.noise(0.5, 2200, 0.08, 'highpass'); break;
      case 'bolt': this.noise(0.5, 3000, 0.4, 'highpass'); this.noise(0.9, 120, 0.4, 'lowpass', 0.05); break;
      case 'sling': this.tone(300, 0.9, 'sawtooth', 0.08, 900); this.noise(0.8, 900, 0.2); break;
      case 'wormhole': this.tone(200, 1.2, 'sine', 0.2, 1400); this.tone(1600, 1.2, 'sine', 0.1, -1300); break;
      case 'uap': [660, 880, 660, 990].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.09, 40, i * 0.12)); break;
      case 'beam': this.tone(110, 1.4, 'sawtooth', 0.08, 30); this.tone(165, 1.4, 'triangle', 0.06, 20); break;
      case 'jam': this.tone(300, 0.4, 'square', 0.08, -200); break;
      case 'drop': this.tone(1320, 0.1, 'sine', 0.1, -300); break;
      case 'overheat': for (let i = 0; i < 3; i++) this.tone(740, 0.1, 'square', 0.08, 0, i * 0.18); break;
      case 'sector': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.12, 0, i * 0.1)); break;
      case 'win': [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.14, 0, i * 0.14)); break;
      case 'lose': this.noise(1.4, 200, 0.6, 'lowpass'); [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.12, 0, 0.3 + i * 0.22)); break;
      case 'ui': this.tone(660, 0.06, 'triangle', 0.1); break;
    }
  }
}
