// Tiny synthesized effects: no downloads, no autoplay before the first gesture.
const KEY = 'arrange-sound-v1';

export class ArrangeAudio {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* private storage */ }
    this.ctx = null;
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(KEY, this.enabled ? 'on' : 'off'); } catch { /* private storage */ }
    if (this.enabled) this.unlock();
    return this.enabled;
  }

  tone(frequency, duration, type = 'sine', volume = .12, slide = 1, delay = 0) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, t);
    if (slide !== 1) oscillator.frequency.exponentialRampToValueAtTime(Math.max(25, frequency * slide), t + duration);
    gain.gain.setValueAtTime(.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(t);
    oscillator.stop(t + duration + .02);
  }

  noise(duration, volume = .12, lowpass = 900) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const count = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, count, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < count; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / count);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
  }

  correct() { this.tone(520, .11, 'triangle', .11, 1.35); this.tone(780, .16, 'triangle', .08, 1.2, .08); }
  land() { this.tone(185, .12, 'sine', .13, .55); }
  wrong() { this.noise(.23, .13, 1450); this.tone(270, .21, 'square', .055, .45); }
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, .3, 'triangle', .1, 1.05, i * .12)); }

  event(kind) {
    switch (kind) {
      case 'rocket':
        this.noise(.55, .08, 550); this.tone(180, .55, 'sawtooth', .04, 2.7); break;
      case 'meteor':
        this.tone(650, .32, 'sawtooth', .045, .25); this.noise(.35, .13, 500); break;
      case 'wind':
        this.noise(.65, .065, 340); break;
      case 'rover':
        this.tone(390, .08, 'square', .04, 1.3); this.tone(520, .08, 'square', .035, 1.3, .13); break;
      case 'crystal':
        [880, 1109, 1320].forEach((f, i) => this.tone(f, .45, 'sine', .05, 1, i * .09)); break;
      case 'geyser':
        this.noise(.6, .09, 1200); break;
      default:
        this.tone(480, .18, 'triangle', .055, 1.4); break;
    }
  }
}
