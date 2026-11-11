// Toy Cars Racing — synthesized sound (no audio files).
export function createAudio() {
  let ctx = null, master = null, enabled = true;
  let eng = null, screech = null, jet = null, noiseBuf = null;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.7 : 0;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noiseSrc() { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; }

  function startLoops() {
    if (!ensure() || eng) return;
    // engine: two detuned oscillators through a lowpass
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 4;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const og2 = ctx.createGain(); og2.gain.value = 0.35;
    o1.connect(lp); o2.connect(og2).connect(lp); lp.connect(g).connect(master);
    o1.start(); o2.start();
    eng = { g, lp, o1, o2 };
    // tyre screech: band-passed noise
    const sg = ctx.createGain(); sg.gain.value = 0;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 6;
    const ns = noiseSrc(); ns.connect(bp).connect(sg).connect(master); ns.start();
    screech = { g: sg, bp };
    // nitro jet
    const jg = ctx.createGain(); jg.gain.value = 0;
    const jl = ctx.createBiquadFilter(); jl.type = 'lowpass'; jl.frequency.value = 600;
    const js = noiseSrc(); js.connect(jl).connect(jg).connect(master); js.start();
    jet = { g: jg, f: jl };
  }

  function tone(freq, dur, { type = 'square', vol = 0.25, slide = 0, delay = 0 } = {}) {
    if (!ensure() || !enabled) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
  }

  function burst(dur, { vol = 0.4, freq = 800, type = 'lowpass' } = {}) {
    if (!ensure() || !enabled) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  return {
    unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); startLoops(); },
    setEnabled(v) { enabled = v; if (master) master.gain.value = v ? 0.7 : 0; },
    get enabled() { return enabled; },
    // speedRatio 0..1.4, throttle 0..1, drift 0..1, nitro bool, active bool
    engine(speedRatio, throttle, drift, nitro, active) {
      if (!ctx || !eng) return;
      const t = ctx.currentTime;
      const r = Math.max(0, speedRatio);
      // fake gearbox: rpm climbs within each gear band
      const gears = [0.22, 0.45, 0.7, 1.0, 1.6];
      let lo = 0, gi = 0; while (gi < gears.length - 1 && r > gears[gi]) { lo = gears[gi]; gi++; }
      const within = Math.min(1, (r - lo) / (gears[gi] - lo));
      const rpm = 0.3 + within * 0.7;
      const f = 48 + rpm * 120 + gi * 14;
      eng.o1.frequency.setTargetAtTime(f, t, 0.05);
      eng.o2.frequency.setTargetAtTime(f * 0.5 + 2, t, 0.05);
      eng.lp.frequency.setTargetAtTime(500 + throttle * 1400 + rpm * 600, t, 0.08);
      eng.g.gain.setTargetAtTime(active ? 0.06 + throttle * 0.07 + rpm * 0.03 : 0, t, 0.1);
      screech.g.gain.setTargetAtTime(active ? Math.min(0.16, drift * 0.18) : 0, t, 0.05);
      screech.bp.frequency.setTargetAtTime(1200 + drift * 600, t, 0.1);
      jet.g.gain.setTargetAtTime(active && nitro ? 0.22 : 0, t, 0.08);
      jet.f.frequency.setTargetAtTime(nitro ? 1400 : 500, t, 0.2);
    },
    beep(hi) { tone(hi ? 880 : 440, hi ? 0.5 : 0.22, { type: 'square', vol: 0.22 }); },
    boost() { tone(300, 0.35, { type: 'sawtooth', vol: 0.18, slide: 700 }); },
    lap() { tone(660, 0.12, { vol: 0.18 }); tone(880, 0.18, { vol: 0.18, delay: 0.12 }); },
    best() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { vol: 0.16, delay: i * 0.09, type: 'triangle' })); },
    finish(good) { (good ? [523, 659, 784, 1047, 1319] : [392, 349, 330]).forEach((f, i) => tone(f, 0.22, { vol: 0.18, delay: i * 0.13, type: 'triangle' })); },
    hit(v = 10) { burst(0.18, { vol: Math.min(0.5, 0.1 + v * 0.02), freq: 500 }); tone(90, 0.12, { type: 'sine', vol: 0.25, slide: -40 }); },
    knock() { tone(520, 0.08, { type: 'triangle', vol: 0.15, slide: -200 }); },
    land() { tone(70, 0.18, { type: 'sine', vol: 0.35, slide: -30 }); burst(0.1, { vol: 0.15, freq: 300 }); },
    whoosh() { burst(0.5, { vol: 0.25, freq: 1200, type: 'bandpass' }); },
    click() { tone(1200, 0.04, { type: 'square', vol: 0.06 }); }
  };
}
