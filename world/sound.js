// Every sound in the bay is made here, from noise and sine waves: the sea,
// the wind, cicadas by day and crickets by night, the bell, the lanterns'
// chimes, stones skipping, footsteps. Nothing is downloaded.

export function createSound() {
  let ctx = null, master = null, noise = null;
  const beds = {};
  let muted = false;
  try { muted = localStorage.getItem("world-muted") === "1"; } catch { /* storage is optional */ }

  const source = () => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(0, Math.random() * 2);
    return s;
  };
  const filter = (type, frequency, Q = 1) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    return f;
  };
  const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };

  const start = () => {
    if (ctx) { ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = gain(muted ? 0 : 0.85);
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    // Pinkish, so the sea sounds like water and not like a radio
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    // The sea: a low wash and a hiss on top, swelling
    beds.waveLow = filter("lowpass", 500, 0.6);
    beds.waves = gain();
    source().connect(beds.waveLow).connect(beds.waves).connect(master);
    beds.hiss = gain();
    source().connect(filter("bandpass", 2600, 0.6)).connect(beds.hiss).connect(master);
    // Wind, for when you are high up or floating down
    beds.windBand = filter("bandpass", 700, 1.1);
    beds.wind = gain();
    source().connect(beds.windBand).connect(beds.wind).connect(master);
    // Cicadas: high noise, pulsed
    const am = gain(0.5);
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 47;
    const depth = gain(0.5);
    lfo.connect(depth).connect(am.gain);
    lfo.start();
    beds.cicada = gain();
    source().connect(filter("bandpass", 5200, 5)).connect(am).connect(beds.cicada).connect(master);
    // Crickets: a pure tone, chirped
    beds.cricketTone = ctx.createOscillator();
    beds.cricketTone.frequency.value = 4400;
    beds.chirp = gain();
    beds.cricket = gain();
    beds.cricketTone.connect(beds.chirp).connect(beds.cricket).connect(master);
    beds.cricketTone.start();
    beds.nextChirp = 0;
  };

  const set = (g, v, k = 0.4) => g && g.gain.setTargetAtTime(v, ctx.currentTime, k);

  // Called every frame with what the place sounds like right now.
  const update = (t, { shore, high, wind, day, night, trees }) => {
    if (!ctx || ctx.state !== "running") return;
    const swell = 0.62 + 0.38 * Math.sin(t * 0.45) * Math.sin(t * 0.17 + 1);
    set(beds.waves, (0.05 + 0.32 * shore) * swell * (1 - high * 0.6), 0.3);
    beds.waveLow.frequency.setTargetAtTime(380 + 520 * swell * shore, ctx.currentTime, 0.3);
    set(beds.hiss, 0.05 * shore * swell * swell, 0.3);
    set(beds.wind, 0.015 + 0.12 * wind + 0.05 * high, 0.3);
    beds.windBand.frequency.setTargetAtTime(500 + 900 * wind, ctx.currentTime, 0.4);
    set(beds.cicada, 0.018 * day * trees * (0.7 + 0.3 * Math.sin(t * 0.3)), 0.8);
    set(beds.cricket, 0.02 * night * (0.4 + 0.6 * trees), 0.8);
    if (night > 0.2 && ctx.currentTime > beds.nextChirp) {
      const at = ctx.currentTime + 0.05, g = beds.chirp.gain;
      for (let i = 0; i < 3; i++) {
        g.setValueAtTime(0, at + i * 0.07);
        g.linearRampToValueAtTime(1, at + i * 0.07 + 0.012);
        g.linearRampToValueAtTime(0, at + i * 0.07 + 0.045);
      }
      beds.cricketTone.frequency.setValueAtTime(4200 + Math.random() * 400, at);
      beds.nextChirp = at + 0.6 + Math.random() * 0.7;
    }
  };

  // One-shot helpers
  const env = (node, at, peak, attack, decay) => {
    node.gain.setValueAtTime(0, at);
    node.gain.linearRampToValueAtTime(peak, at + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  };
  const tone = (freq, peak, decay, type = "sine", at = ctx.currentTime, attack = 0.004, out = master) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    const g = gain();
    env(g, at, peak, attack, decay);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + attack + decay + 0.05);
    return o;
  };
  const burst = (type, freq, Q, peak, decay, at = ctx.currentTime) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = filter(type, freq, Q);
    const g = gain();
    env(g, at, peak, 0.004, decay);
    s.connect(f).connect(g).connect(master);
    s.start(at, Math.random() * 1.5);
    s.stop(at + decay + 0.1);
    return f;
  };
  const ready = () => ctx && ctx.state === "running";
  const far = (dist) => 1 / (1 + Math.max(0, dist) / 22);

  const PARTIALS = [[0.5, 0.35, 6], [1, 0.5, 4.5], [1.19, 0.38, 3.6], [1.5, 0.24, 2.6], [2, 0.42, 3.1], [2.51, 0.18, 1.9], [2.66, 0.14, 1.6], [3.01, 0.11, 1.2], [4.15, 0.07, 0.8]];
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

  return {
    start,
    update,
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem("world-muted", muted ? "1" : "0"); } catch { /* storage is optional */ }
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.05);
      return muted;
    },
    bell(dist = 0, volume = 1) {
      if (!ready()) return;
      const k = far(dist) * 0.5 * volume, at = ctx.currentTime;
      for (const [ratio, g, d] of PARTIALS) tone(196 * ratio, g * k, d, "sine", at, 0.003);
      burst("bandpass", 2400, 2, 0.3 * k, 0.08, at);
    },
    chime(i, at = 0) {
      if (!ready()) return;
      const t = ctx.currentTime + at;
      const f = 261.63 * 2 ** (PENTA[i % PENTA.length] / 12);
      tone(f, 0.22, 2.4, "sine", t, 0.006);
      tone(f * 2, 0.07, 1.4, "sine", t, 0.006);
      tone(f * 3.01, 0.03, 0.8, "triangle", t, 0.006);
    },
    flame() {
      if (!ready()) return;
      const f = burst("lowpass", 300, 0.8, 0.18, 0.5);
      f.frequency.exponentialRampToValueAtTime(1600, ctx.currentTime + 0.3);
    },
    plip(n) {
      if (!ready()) return;
      const o = tone(620 + n * 70, 0.18, 0.12, "sine");
      o.frequency.exponentialRampToValueAtTime((620 + n * 70) * 0.65, ctx.currentTime + 0.1);
      burst("highpass", 3000, 0.7, 0.05, 0.05);
    },
    splash(size = 1, dist = 0) {
      if (!ready()) return;
      const f = burst("lowpass", 1800, 0.7, 0.3 * size * far(dist), 0.35 + 0.3 * size);
      f.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.5);
    },
    clack(dist = 0) { if (ready()) burst("bandpass", 2200, 3, 0.18 * far(dist), 0.06); },
    step(surface) {
      if (!ready()) return;
      const v = 0.9 + Math.random() * 0.2;
      if (surface === "water") this.splash(0.25);
      else if (surface === "sand") burst("lowpass", 900 * v, 0.7, 0.11, 0.09);
      else if (surface === "wood") { tone(120 * v, 0.18, 0.08); burst("bandpass", 900 * v, 1.2, 0.06, 0.05); }
      else if (surface === "roof") burst("bandpass", 2600 * v, 2.5, 0.07, 0.04);
      else if (surface === "metal") { tone(520 * v, 0.05, 0.12, "triangle"); burst("bandpass", 1800, 2, 0.05, 0.04); }
      else if (surface === "stone") burst("bandpass", 1500 * v, 1.4, 0.08, 0.05);
      else burst("bandpass", 3200 * v, 0.8, 0.05, 0.07);
    },
    boing(dist = 0) {
      if (!ready()) return;
      const o = tone(300, 0.22 * far(dist), 0.3, "sine");
      o.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.25);
    },
    gull(dist = 0) {
      if (!ready()) return;
      const at = ctx.currentTime, out = gain(0.07 * far(dist / 3));
      const bp = filter("bandpass", 1500, 3);
      bp.connect(out).connect(master);
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
        const t = at + i * 0.28;
        const o = tone(1350, 1, 0.22, "sawtooth", t, 0.02, bp);
        o.frequency.linearRampToValueAtTime(1050, t + 0.2);
      }
    },
    whoosh() {
      if (!ready()) return;
      const f = burst("bandpass", 400, 1, 0.12, 0.45);
      f.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.35);
    },
    // A cat, pleased: a low rumble that comes and goes with its breathing
    purr() {
      if (!ready()) return;
      const at = ctx.currentTime;
      const s = ctx.createBufferSource();
      s.buffer = noise;
      const lp = filter("lowpass", 180, 1.2);
      const am = gain(0);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 24;
      const depth = gain(0.5);
      lfo.connect(depth).connect(am.gain);
      const out = gain();
      for (let i = 0; i < 4; i++) {
        out.gain.setTargetAtTime(0.5, at + i * 0.9, 0.12);
        out.gain.setTargetAtTime(0.18, at + i * 0.9 + 0.5, 0.15);
      }
      out.gain.setTargetAtTime(0, at + 3.6, 0.2);
      s.connect(lp).connect(am).connect(out).connect(master);
      am.gain.value = 0.5;
      s.start(at); lfo.start(at);
      s.stop(at + 4.6); lfo.stop(at + 4.6);
    },
    meow(dist = 0) {
      if (!ready()) return;
      const at = ctx.currentTime, k = far(dist);
      const bp = filter("bandpass", 1100, 4);
      const out = gain(0.16 * k);
      bp.connect(out).connect(master);
      const o = tone(520, 1, 0.55, "sawtooth", at, 0.06, bp);
      o.frequency.linearRampToValueAtTime(760, at + 0.18);
      o.frequency.linearRampToValueAtTime(430, at + 0.55);
      bp.frequency.linearRampToValueAtTime(1600, at + 0.2);
      bp.frequency.linearRampToValueAtTime(800, at + 0.55);
    },
    oar() {
      if (!ready()) return;
      const f = burst("lowpass", 1400, 0.8, 0.08, 0.3);
      f.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.3);
      tone(140, 0.05, 0.08, "triangle");
    },
    creak(k = 1) {
      if (!ready()) return;
      const o = tone(180 + Math.random() * 40, 0.035 * k, 0.25, "sawtooth", ctx.currentTime, 0.05);
      o.frequency.linearRampToValueAtTime(140, ctx.currentTime + 0.25);
    },
    melody() {
      if (!ready()) return;
      PENTA.forEach((_, i) => this.chime(i, i * 0.32));
      [0, 2, 3, 5].forEach((n, i) => this.chime(n, 4 + i * 0.6));
    },
  };
}
