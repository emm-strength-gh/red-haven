// All sound is synthesised with Web Audio (same approach as Drift Haven), so there
// are no audio files to download and everything works offline.

const PREFS_KEY = 'redhaven-audio-v1';

export class Audio {
  constructor() {
    this.ctx = null;
    this.sound = true;
    this.music = true;
    this.musicT = 1;
    this.gustT = 5;
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY));
      if (saved) { this.sound = saved.sound !== false; this.music = saved.music !== false; }
    } catch { /* storage blocked: keep defaults */ }
  }

  /** Must be called from a user gesture (mobile autoplay rules). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.sfxGain = ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.connect(this.master);
    this.windGain = ctx.createGain();
    this.windGain.connect(this.master);
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainGain.connect(this.master);
    // looping brown noise through a slowly swept low-pass: Martian wind
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = last * 0.98 + (Math.random() * 2 - 1) * 0.02;
      d[i] = last * 4;
    }
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 240;
    lfo.connect(lfoG).connect(this.windFilter.frequency);
    wind.connect(this.windFilter).connect(this.windGain);
    wind.start();
    lfo.start();
    const rbuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const rd = rbuf.getChannelData(0);
    for (let i = 0; i < rd.length; i++) rd[i] = Math.random() * 2 - 1;
    const rain = ctx.createBufferSource();
    rain.buffer = rbuf;
    rain.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    rain.connect(hp).connect(this.rainGain);
    rain.start();
    this.apply();
  }

  setPrefs(sound, music) {
    this.sound = sound;
    this.music = music;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ sound, music })); } catch { /* ignore */ }
    this.apply();
  }

  apply() {
    if (!this.ctx) return;
    this.sfxGain.gain.value = this.sound ? 0.9 : 0;
    this.windGain.gain.value = this.sound ? 0.12 : 0;
    this.musicGain.gain.value = this.music ? 0.22 : 0;
  }

  suspend() { this.ctx?.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, out, when = 0) {
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
    o.connect(gn).connect(out ?? this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, freq, vol = 0.3, type = 'bandpass') {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
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
    src.connect(f).connect(gn).connect(this.sfxGain);
    src.start(t);
  }

  ui() { this.tone(660, 0.07, 'triangle', 0.12); this.tone(990, 0.05, 'triangle', 0.06, 0, undefined, 0.04); }
  select() { this.tone(520, 0.08, 'triangle', 0.14, 260); }
  error() { this.tone(220, 0.12, 'square', 0.07); this.tone(165, 0.16, 'square', 0.07, 0, undefined, 0.11); }
  mark() { this.tone(880, 0.09, 'triangle', 0.16); this.tone(1320, 0.12, 'triangle', 0.12, 0, undefined, 0.07); }
  built() { this.thump(); [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.15, 0, undefined, 0.06 + i * 0.07)); }
  thump() { this.tone(110, 0.15, 'sine', 0.35, -50); this.noise(0.1, 400, 0.2); }
  chop() { this.tone(180, 0.06, 'square', 0.07, -60); this.noise(0.05, 2500, 0.08); }
  pickup() { this.tone(988, 0.08, 'sine', 0.1); this.tone(1319, 0.1, 'sine', 0.08, 0, undefined, 0.06); }
  zap() { this.tone(1400, 0.14, 'sawtooth', 0.05, -1100); this.noise(0.06, 3500, 0.06); }
  hit() { this.noise(0.09, 900, 0.18); this.tone(140, 0.08, 'square', 0.06, -40); }
  alarm() { for (let i = 0; i < 3; i++) { this.tone(740, 0.16, 'square', 0.07, 0, undefined, i * 0.34); this.tone(554, 0.16, 'square', 0.07, 0, undefined, i * 0.34 + 0.17); } }
  fanfare() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, i > 3 ? 0.4 : 0.16, 'triangle', 0.14, 0, undefined, i * 0.11)); }
  chime() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.11, 0, undefined, i * 0.12)); }
  dawn() { [392, 523, 659].forEach((f, i) => this.tone(f, 0.6, 'sine', 0.08, 0, undefined, i * 0.15)); }
  win() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.13, 0, undefined, i * 0.13)); }
  lose() { [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.12, 0, undefined, i * 0.25)); }

  /** Per-frame ambience: weather layers, wind gusts and gentle generative music. */
  update(dt, { weather, danger }) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const storm = weather === 'Dust storm';
    const rain = weather === 'Heavy rain';
    this.rainGain.gain.value = this.sound && rain ? 0.07 : 0;
    this.windGain.gain.value = this.sound ? (storm ? 0.4 : 0.12) : 0;
    this.windFilter.Q.value = storm ? 3 : 0.7;
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 7 + Math.random() * 12;
      if (this.sound) this.noise(1.6, 300 + Math.random() * 300, storm ? 0.25 : 0.1, 'lowpass');
    }
    // soft pentatonic plucks; minor and quicker while raiders are near
    this.musicT -= dt;
    if (this.musicT <= 0 && this.music) {
      this.musicT = danger ? 0.7 + Math.random() * 0.8 : 1.4 + Math.random() * 2.2;
      const scale = danger ? [220, 261.6, 293.7, 311.1, 392] : [261.6, 293.7, 329.6, 392, 440, 523.3];
      const f = scale[Math.floor(Math.random() * scale.length)];
      this.tone(f, 1.6, 'triangle', 0.09, 0, this.musicGain);
      if (Math.random() < 0.4) this.tone(f * 1.5, 1.2, 'sine', 0.05, 0, this.musicGain, 0.3);
      if (danger && Math.random() < 0.5) this.tone(f / 2, 0.5, 'sawtooth', 0.03, 0, this.musicGain);
    }
  }
}
