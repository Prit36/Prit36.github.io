// Every sound in the bay is made here, from noise and sine waves: the sea,
// the wind, leaves, cicadas by day and crickets and an owl by night, the
// fountain, the bells, the lanterns' chimes, gulls, stones skipping,
// footsteps. Nothing is downloaded. Sounds that come from somewhere are
// placed left or right, and fall away with distance.

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
    // Leaves: a high hush that rises and falls with the gusts
    beds.leaves = gain();
    beds.leafBand = filter("bandpass", 4200, 0.7);
    source().connect(filter("highpass", 2200, 0.5)).connect(beds.leafBand).connect(beds.leaves).connect(master);
    // The fountain: water falling into water
    beds.fountain = gain();
    beds.fountainPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    source().connect(filter("bandpass", 1300, 0.9)).connect(beds.fountain);
    (beds.fountainPan ? beds.fountain.connect(beds.fountainPan) : beds.fountain).connect(master);
    beds.nextLap = 0;
  };

  const set = (g, v, k = 0.4) => g && g.gain.setTargetAtTime(v, ctx.currentTime, k);

  // Called every frame with what the place sounds like right now.
  const update = (t, { shore, high, wind, day, night, trees, gust = 1, fountain = 0, fountainPan = 0, lap = 0 }) => {
    if (!ctx || ctx.state !== "running") return;
    set(beds.leaves, 0.03 * trees * (0.25 + 0.75 * gust * gust) * (1 - high * 0.5), 0.5);
    beds.leafBand.frequency.setTargetAtTime(3400 + 1600 * gust, ctx.currentTime, 0.6);
    set(beds.fountain, 0.09 * fountain, 0.3);
    if (beds.fountainPan) beds.fountainPan.pan.setTargetAtTime(fountainPan * 0.8, ctx.currentTime, 0.1);
    // a wave arriving on the sand, and drawing back over it
    if (lap > 0.05 && ctx.currentTime > beds.nextLap) {
      const at = ctx.currentTime + 0.02, k = lap * (0.6 + Math.random() * 0.4);
      const f = burst("lowpass", 700, 0.6, 0.12 * k, 1.4, at, 0.35);
      f.frequency.exponentialRampToValueAtTime(2600, at + 0.5);
      f.frequency.exponentialRampToValueAtTime(500, at + 1.6);
      burst("highpass", 3500, 0.5, 0.025 * k, 1.8, at + 0.6, 0.6);
      beds.nextLap = at + 5 + Math.random() * 2.5;
    }
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
  const burst = (type, freq, Q, peak, decay, at = ctx.currentTime, attack = 0.004, out = master) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = filter(type, freq, Q);
    const g = gain();
    env(g, at, peak, attack, decay);
    s.connect(f).connect(g).connect(out);
    s.start(at, Math.random() * 1.5);
    s.stop(at + attack + decay + 0.1);
    return f;
  };
  // Somewhere off to the left or right (-1 to 1)
  const side = (pan = 0) => {
    if (!pan || !ctx.createStereoPanner) return master;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(master);
    return p;
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
    bell(dist = 0, volume = 1, pan = 0, pitch = 1) {
      if (!ready()) return;
      const k = far(dist) * 0.5 * volume, at = ctx.currentTime, out = side(pan * 0.7);
      for (const [ratio, g, d] of PARTIALS) tone(196 * pitch * ratio, g * k, d / Math.sqrt(pitch), "sine", at, 0.003, out);
      burst("bandpass", 2400 * pitch, 2, 0.3 * k, 0.08, at, 0.004, out);
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
      // and it settles to a soft flutter
      const g = burst("bandpass", 600, 0.9, 0.05, 1.2, ctx.currentTime + 0.25, 0.2);
      g.frequency.linearRampToValueAtTime(420, ctx.currentTime + 1.4);
    },
    plip(n) {
      if (!ready()) return;
      const o = tone(620 + n * 70, 0.18, 0.12, "sine");
      o.frequency.exponentialRampToValueAtTime((620 + n * 70) * 0.65, ctx.currentTime + 0.1);
      burst("highpass", 3000, 0.7, 0.05, 0.05);
    },
    splash(size = 1, dist = 0, pan = 0) {
      if (!ready()) return;
      const out = side(pan * 0.8), at = ctx.currentTime;
      const f = burst("lowpass", 1800, 0.7, 0.3 * size * far(dist), 0.35 + 0.3 * size, at, 0.004, out);
      f.frequency.exponentialRampToValueAtTime(260, at + 0.5);
      // and the drops coming back down
      for (let i = 0; i < 2 + size * 4; i++) {
        const d = at + 0.15 + Math.random() * 0.4;
        const o = tone(900 + Math.random() * 1400, 0.025 * size * far(dist), 0.05, "sine", d, 0.002, out);
        o.frequency.exponentialRampToValueAtTime(400, d + 0.06);
      }
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
    gull(dist = 0, pan = 0) {
      if (!ready()) return;
      const at = ctx.currentTime, out = gain(0.07 * far(dist / 3));
      const bp = filter("bandpass", 1500, 3);
      bp.connect(out).connect(side(pan * 0.8));
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
    meow(dist = 0, pan = 0) {
      if (!ready()) return;
      const at = ctx.currentTime, k = far(dist);
      const bp = filter("bandpass", 1100, 4);
      const out = gain(0.16 * k);
      bp.connect(out).connect(side(pan * 0.7));
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
    // A rocket going up: a rising hiss
    launch(dist = 0) {
      if (!ready()) return;
      const f = burst("bandpass", 900, 2.5, 0.07 * far(dist / 4), 1.3);
      f.frequency.exponentialRampToValueAtTime(3800, ctx.currentTime + 1.2);
    },
    // A shell bursting: the thump arrives later the further off it is,
    // then the crackle of the stars
    boom(dist = 0, crackle = false) {
      if (!ready()) return;
      const at = ctx.currentTime + dist / 343, k = 1 / (1 + dist / 120);
      const o = tone(70, 0.5 * k, 1.4, "sine", at, 0.005);
      o.frequency.exponentialRampToValueAtTime(34, at + 0.8);
      const f = burst("lowpass", 900, 0.7, 0.45 * k, 1.1, at);
      f.frequency.exponentialRampToValueAtTime(120, at + 0.9);
      if (crackle) {
        for (let i = 0; i < 26; i++) burst("highpass", 3000 + Math.random() * 3000, 1, 0.05 * k * Math.random(), 0.03, at + 0.6 + Math.random() * 1.3);
      }
    },
    // The balloon's burner: a roar while it's held
    burner(on) {
      if (!ready()) return;
      if (!beds.burner) {
        beds.burnerLow = filter("lowpass", 520, 0.7);
        beds.burner = gain();
        source().connect(beds.burnerLow).connect(beds.burner).connect(master);
      }
      set(beds.burner, on ? 0.34 : 0, on ? 0.05 : 0.15);
    },
    // An owl in the trees, two soft notes and a third
    owl(dist = 0, pan = 0) {
      if (!ready()) return;
      const at = ctx.currentTime, k = 0.07 * far(dist / 3), out = side(pan * 0.8);
      for (const [d, f, len] of [[0, 410, 0.32], [0.55, 380, 0.22], [0.82, 372, 0.6]]) {
        const o = tone(f, k, len, "sine", at + d, 0.08, out);
        o.frequency.linearRampToValueAtTime(f * 0.94, at + d + len);
      }
    },
    // Wings clattering as gulls take off, and one of them complaining
    flutter(dist = 0, pan = 0, n = 1) {
      if (!ready()) return;
      const at = ctx.currentTime, k = far(dist) * Math.min(1.6, 0.7 + 0.3 * n), out = side(pan * 0.8);
      for (let i = 0; i < 9; i++) burst("bandpass", 900 + Math.random() * 500, 1.4, 0.06 * k * (1 - i / 10), 0.05, at + i * 0.07 + Math.random() * 0.02, 0.004, out);
      if (Math.random() < 0.6) setTimeout(() => this.gull(dist, pan), 350);
    },
    // Little claws on sand
    scuttle(dist = 0, pan = 0) {
      if (!ready()) return;
      const at = ctx.currentTime, out = side(pan * 0.8);
      for (let i = 0; i < 10; i++) burst("highpass", 4200, 2, 0.03 * far(dist), 0.012, at + i * 0.045 + Math.random() * 0.02, 0.002, out);
    },
    // A jump, and coming down again
    hup() {
      if (!ready()) return;
      const f = burst("bandpass", 500, 1.2, 0.05, 0.18);
      f.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.15);
    },
    land(surface, k = 1) {
      if (!ready()) return;
      const v = Math.min(1.5, k);
      tone(80, 0.12 * v, 0.14, "sine");
      if (surface === "sand") burst("lowpass", 700, 0.7, 0.16 * v, 0.2);
      else if (surface === "wood") { tone(110, 0.16 * v, 0.12); burst("bandpass", 700, 1.2, 0.08 * v, 0.08); }
      else if (surface === "grass") burst("bandpass", 2400, 0.8, 0.07 * v, 0.12);
      else burst("bandpass", 1300, 1.4, 0.1 * v, 0.08);
    },
    // A coin spinning up, and into the fountain
    coin(dist = 0) {
      if (!ready()) return;
      const at = ctx.currentTime, k = far(dist);
      tone(3150, 0.07 * k, 0.5, "sine", at, 0.002);
      tone(4720, 0.03 * k, 0.3, "sine", at, 0.002);
      const o = tone(1500, 0.08 * k, 0.12, "sine", at + 0.55, 0.002);
      o.frequency.exponentialRampToValueAtTime(700, at + 0.65);
      burst("lowpass", 2400, 0.7, 0.06 * k, 0.2, at + 0.55);
    },
    // Dolphins: quick clicks and a whistle
    dolphin(dist = 0, pan = 0) {
      if (!ready()) return;
      const at = ctx.currentTime, k = far(dist / 2), out = side(pan * 0.8);
      for (let i = 0; i < 5; i++) burst("bandpass", 4000, 6, 0.04 * k, 0.012, at + i * 0.035, 0.004, out);
      const o = tone(5200, 0.025 * k, 0.5, "sine", at + 0.25, 0.05, out);
      o.frequency.linearRampToValueAtTime(7600, at + 0.5);
      o.frequency.linearRampToValueAtTime(5800, at + 0.75);
    },
  };
}
