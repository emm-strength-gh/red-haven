// Commute City — synthesized sound (no audio files).
export function createAudio() {
  let ctx = null, master = null, enabled = true, noiseBuf = null;
  let hum = null;
  const last = {};

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.6 : 0;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // soft city hum: low-passed noise whose level follows the traffic
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    src.connect(lp).connect(g).connect(master); src.start();
    hum = { g, lp };
    return ctx;
  }

  const ready = () => ensure() && enabled && ctx.state === 'running';
  function gap(name, sec) {
    const t = performance.now();
    if (last[name] && t - last[name] < sec * 1000) return false;
    last[name] = t;
    return true;
  }

  function tone(freq, dur, { type = 'triangle', vol = 0.15, slide = 0, delay = 0, attack = 0.008 } = {}) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, { vol = 0.3, freq = 900, type = 'lowpass', q = 0.8, delay = 0, sweep = 0 } = {}) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  return {
    unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
    setEnabled(on) {
      enabled = !!on;
      if (master) master.gain.value = enabled ? 0.6 : 0;
    },
    get enabled() { return enabled; },
    click() { tone(900, 0.05, { vol: 0.08 }); },
    build() {
      if (!gap('build', 0.05)) return;
      tone(196, 0.1, { type: 'square', vol: 0.07, slide: 90 });
      noise(0.08, { vol: 0.12, freq: 2200, type: 'bandpass', q: 1.5 });
      tone(392, 0.12, { vol: 0.08, delay: 0.05 });
    },
    erase() { if (gap('erase', 0.06)) tone(620, 0.14, { vol: 0.1, slide: -380 }); },
    error() { if (!gap('err', 0.3)) return; tone(200, 0.12, { type: 'square', vol: 0.06 }); tone(150, 0.16, { type: 'square', vol: 0.06, delay: 0.1 }); },
    coin(transit) {
      if (!gap('coin', 0.07)) return;
      tone(transit ? 1318 : 1175, 0.08, { vol: 0.09 });
      tone(transit ? 1760 : 1568, 0.16, { vol: 0.08, delay: 0.06 });
    },
    bell() {
      if (!gap('bell', 0.6)) return;
      tone(2093, 0.22, { type: 'sine', vol: 0.06 });
      tone(2093, 0.26, { type: 'sine', vol: 0.05, delay: 0.17 });
    },
    horn() {
      if (!gap('horn', 2)) return;
      tone(311, 0.55, { type: 'sawtooth', vol: 0.045, attack: 0.04 });
      tone(370, 0.55, { type: 'sawtooth', vol: 0.04, attack: 0.04 });
    },
    crash() {
      noise(0.4, { vol: 0.45, freq: 1400, sweep: -1100 });
      tone(110, 0.3, { type: 'sawtooth', vol: 0.12, slide: -60 });
      noise(0.25, { vol: 0.2, freq: 3500, type: 'highpass', delay: 0.05 });
    },
    angry() {
      if (!gap('angry', 0.3)) return;
      tone(440, 0.12, { type: 'square', vol: 0.06 });
      tone(330, 0.2, { type: 'square', vol: 0.06, delay: 0.13 });
    },
    pass() { if (gap('pass', 0.08)) tone(740, 0.06, { vol: 0.05 }); },
    tap(st) { tone(st === 'g' ? 880 : st === 'y' ? 700 : 500, 0.07, { type: 'square', vol: 0.06 }); },
    chime() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.22, { vol: 0.08, delay: i * 0.08 })); },
    warn() { if (!gap('warn', 2.4)) return; tone(988, 0.12, { type: 'square', vol: 0.05 }); tone(988, 0.12, { type: 'square', vol: 0.05, delay: 0.2 }); },
    whoosh() { noise(0.7, { vol: 0.16, freq: 400, type: 'bandpass', q: 0.7, sweep: 1600 }); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, { vol: 0.1, delay: i * 0.1 })); },
    lose() { [523, 440, 370, 294].forEach((f, i) => tone(f, 0.32, { type: 'square', vol: 0.06, delay: i * 0.16 })); },
    traffic(level) {
      if (!hum || !ctx) return;
      const v = enabled ? Math.min(0.05, level * 0.0012) : 0;
      hum.g.gain.setTargetAtTime(v, ctx.currentTime, 0.4);
    },
  };
}
