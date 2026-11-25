// Kaboom Critters — synthesized sound effects (no audio files, so they work offline).
export function createAudio() {
  let ctx = null, master = null, enabled = true, noiseBuf = null, quiet = 1;
  const last = {};

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.55 : 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  const ready = () => quiet > 0.001 && ensure() && enabled && ctx.state === 'running';
  function gap(name, sec) {
    const t = performance.now();
    if (last[name] && t - last[name] < sec * 1000) return false;
    last[name] = t;
    return true;
  }
  function tone(freq, dur, { type = 'triangle', vol = 0.15, slide = 0, delay = 0, attack = 0.006 } = {}) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(25, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * quiet), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function noise(dur, { vol = 0.3, freq = 900, type = 'lowpass', q = 0.8, delay = 0, sweep = 0 } = {}) {
    if (!ready()) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol * quiet), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  return {
    unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    setEnabled(on) { enabled = on; if (master) master.gain.value = on ? 0.55 : 0; },
    /** Lower everything (used for the demo match behind the menu). */
    setQuiet(q) { quiet = q; },
    get enabled() { return enabled; },
    boom(r) {
      if (!gap('boom', 0.04)) return;
      const big = Math.min(1, r / 70);
      noise(0.5 + big * 0.7, { vol: 0.35 + big * 0.35, freq: 1400, sweep: -1300, q: 0.7 });
      tone(90 + 40 * (1 - big), 0.45 + big * 0.4, { type: 'sine', vol: 0.4, slide: -60 });
      noise(0.12, { vol: 0.25, freq: 3200, type: 'bandpass', q: 1.2 });
    },
    launch() { noise(0.35, { vol: 0.22, freq: 600, type: 'bandpass', sweep: 1800, q: 1.4 }); tone(220, 0.2, { type: 'square', vol: 0.05, slide: 260 }); },
    throw() { noise(0.16, { vol: 0.18, freq: 1500, type: 'bandpass', q: 1.5, sweep: -900 }); },
    bounce(v) { if (gap('bounce', 0.05)) tone(240 + Math.random() * 120, 0.08, { type: 'triangle', vol: Math.min(0.18, v / 2500) }); },
    jump() { tone(330, 0.16, { type: 'square', vol: 0.06, slide: 380 }); },
    land() { if (gap('land', 0.08)) noise(0.08, { vol: 0.12, freq: 380 }); },
    step() { if (gap('step', 0.16)) tone(170 + Math.random() * 40, 0.04, { type: 'triangle', vol: 0.05 }); },
    splash() { noise(0.6, { vol: 0.32, freq: 1600, type: 'bandpass', q: 0.6, sweep: -1200 }); tone(600, 0.25, { type: 'sine', vol: 0.06, slide: -350 }); },
    pickup() { [660, 880, 1100, 1320].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.12, delay: i * 0.06 })); },
    hurt() { if (gap('hurt', 0.12)) tone(880 + Math.random() * 200, 0.22, { type: 'sine', vol: 0.12, slide: -420 }); },
    die() { tone(520, 0.6, { type: 'triangle', vol: 0.14, slide: -380 }); },
    shot() { tone(1100, 0.14, { type: 'square', vol: 0.08, slide: -800 }); noise(0.1, { vol: 0.15, freq: 2600, type: 'highpass' }); },
    bonk(hit) { tone(hit ? 180 : 300, 0.18, { type: 'square', vol: hit ? 0.16 : 0.06, slide: -80 }); if (hit) tone(1200, 0.25, { type: 'sine', vol: 0.08, delay: 0.03 }); },
    beep() { tone(1250, 0.09, { type: 'square', vol: 0.07 }); tone(1250, 0.09, { type: 'square', vol: 0.07, delay: 0.18 }); },
    fuse() { if (gap('fuse', 0.12)) noise(0.08, { vol: 0.05, freq: 5000, type: 'highpass' }); },
    teleport() { tone(400, 0.45, { type: 'sine', vol: 0.12, slide: 1400 }); tone(800, 0.4, { type: 'triangle', vol: 0.05, slide: 1600, delay: 0.05 }); },
    plane() { noise(2, { vol: 0.12, freq: 240, q: 1.5, sweep: 120 }); tone(110, 1.8, { type: 'sawtooth', vol: 0.03, slide: 30 }); },
    drop() { tone(260, 0.1, { type: 'triangle', vol: 0.1 }); },
    tick() { tone(1500, 0.04, { type: 'square', vol: 0.05 }); },
    turn(mine) { (mine ? [523, 659, 784] : [392, 330]).forEach((f, i) => tone(f, 0.14, { type: 'triangle', vol: 0.13, delay: i * 0.09 })); },
    click() { tone(700, 0.05, { type: 'triangle', vol: 0.08 }); },
    crate() { tone(520, 0.3, { type: 'sine', vol: 0.06, slide: -120 }); },
    flood() { noise(1.6, { vol: 0.2, freq: 300, q: 0.5, sweep: 500 }); tone(98, 1.2, { type: 'sine', vol: 0.12, slide: -20 }); },
    win() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, i === 5 ? 0.5 : 0.16, { type: 'triangle', vol: 0.15, delay: i * 0.12 })); },
    lose() { [392, 370, 349, 262].forEach((f, i) => tone(f, i === 3 ? 0.7 : 0.28, { type: 'sawtooth', vol: 0.07, delay: i * 0.28, slide: i === 3 ? -40 : 0 })); },
  };
}
