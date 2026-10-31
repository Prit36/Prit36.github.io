// The sea's motion, worked out on the CPU once a frame and handed to the
// shader as a handful of numbers. The shader does the rest per pixel.
//
// The surface is a sum of waves on the plane of the sea, in metres (see
// SEA_VIEW in build_scene.py): a few long, low swells rolling in from the
// open sea towards the coast, and a fan of short wind ripples around the way
// the wind blows. Each wave keeps its own direction, length and speed (deep
// water: longer is faster), so together they never fall back into step.
// What changes is how much of each there is: the swell rises and falls over
// minutes, the ripples follow the wind and its gusts, and each wave also
// drifts in strength on its own, so the sea has calm spells and livelier
// ones without any timeline.
//
// Along the shore, small waves come in one after another. Their spacing in
// time wanders, every wave has its own strength, and whole sets of them die
// away for a while.
//
// Phases are kept here in double precision and wrapped, so the shader never
// sees a large, imprecise time.

import { noise } from "./environment.js";

const TAU = Math.PI * 2;
const G = 9.81;

const generator = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// The swell comes in from the open sea, far away on the left, towards the
// beach and the rocks near you on the right: +x across the view, -z towards
// you.
const SWELL_HEADING = Math.atan2(-0.8, 0.6);
// Matches WAVES and SWELLS in shaders.js.
export const SWELLS = 6;
export const RIPPLES = 10;
export const WAVES = SWELLS + RIPPLES;
// A painted sea, and a calm one, moves a little slower than a real sea
// would: at full speed the swell hurries and the short ripples look busy.
const PACE = { swell: 0.7, ripple: 0.68 };

// Approaches a target with time constant tau seconds.
const ease = (value, target, dt, tau) => value + (target - value) * (1 - Math.exp(-dt / tau));

export class Sea {
  constructor(seed = 36) {
    const r = generator(seed * 7919 + 17);
    this.seed = seed;
    this.waves = [];
    // Long and slow, from thirty metres down to six, at uneven spacings;
    // the longer ones count for more in the look of the sea.
    for (let i = 0; i < SWELLS; i++) {
      const u = (i + 0.15 + r() * 0.7) / SWELLS;
      this.#add(31 * Math.pow(6 / 31, u), SWELL_HEADING + (r() - 0.5) * 1.1, 1 - 0.5 * u, r, "swell");
    }
    // Ripples from about three metres down to a hand's breadth, spread round
    // the prevailing wind, the shorter ones counting a little less.
    for (let i = 0; i < RIPPLES; i++) {
      const u = (i + 0.15 + r() * 0.7) / RIPPLES;
      this.#add(3.1 * Math.pow(0.33 / 3.1, u), (r() - 0.5) * 2.4, 0.9 - 0.35 * u, r, "ripple");
    }
    this.buffers = {
      uWaves: new Float32Array(WAVES * 4),
      uWaveWeights: new Float32Array(this.waves.map((w) => w.weight)),
      uSea: new Float32Array(12),
    };
    this.reset();
  }

  reset() {
    this.time = 0;
    for (const w of this.waves) {
      w.phase = w.start;
      w.amount = undefined;
    }
    // How much of each there is, eased towards what the weather asks for.
    this.swell = 0.6;
    this.ripple = 0.4;
    this.shore = 0.5;
    // The shore waves: the phase of the one coming in, and how many have
    // broken so far, kept apart so neither loses precision.
    this.shorePhase = 0;
    this.shoreCount = 0;
    this.shorePeriod = 7.2;
    // How far the wind has carried its patches of ripples, in metres.
    this.drift = [0, 0];
  }

  step(dt, env) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const t = this.time, s = this.seed;
    const { wind, activity } = env;

    // Swell builds and fades over minutes, a little more on livelier days.
    const swellWanted = 0.35 + 0.45 * activity + 0.3 * noise(t / 47, s + 21);
    this.swell = ease(this.swell, Math.max(0.15, swellWanted), dt, 6);
    // Ripples answer the wind within seconds, but a gust can only stir them
    // so far: this is a calm sea.
    const rippleWanted = 0.18 + 0.75 * wind.strength + 0.25 * wind.gust;
    this.ripple = ease(this.ripple, Math.min(1, rippleWanted), dt, 2.5);
    // Sets of shore waves come and go; between them, near stillness.
    const sets = 0.5 + 0.5 * noise(t / 38, s + 22) + 0.25 * noise(t / 13, s + 23);
    const shoreWanted = Math.max(0, Math.min(1, (sets - 0.22) / 0.6)) * (0.55 + 0.45 * this.swell);
    this.shore = ease(this.shore, shoreWanted, dt, 4);

    for (const w of this.waves) {
      // A real sea has a spread of lengths, not a few exact ones: each wave's
      // speed wanders a little, so no two ever settle into a rhythm.
      const pace = 1 + 0.07 * noise(t / (2.3 * w.wander), w.seed + 1);
      w.phase = (w.phase - w.omega * pace * dt) % TAU;
      // Each wave's own slow drift in strength.
      const own = 0.62 + 0.38 * noise(t / w.wander, w.seed);
      let amount;
      if (w.kind === "swell") {
        amount = this.swell * own;
      } else {
        // Ripples lying along the wind are the ones it raises.
        const along = Math.cos(w.heading - wind.direction);
        amount = this.ripple * own * (0.25 + 0.75 * Math.max(0, along) ** 2);
      }
      w.amount = ease(w.amount ?? amount, amount, dt, 1.5);
    }

    // A shore wave every seven seconds or so, never on the beat.
    this.shorePeriod = 7.2 * (1 + 0.28 * noise(t / 17, s + 24));
    this.shorePhase += (TAU / this.shorePeriod) * dt;
    while (this.shorePhase >= TAU) {
      this.shorePhase -= TAU;
      this.shoreCount += 1;
    }

    // Gusts sweep their patches across the water at a few metres a second.
    const speed = 1.2 + 2.6 * wind.strength;
    this.drift[0] += wind.x * speed * dt;
    this.drift[1] += wind.y * speed * dt;
  }

  // Uniforms for the shader, refreshed in place:
  //   uWaves        WAVES vec4s: wave vector x and z (radians per metre),
  //                 phase, how much of it there is now
  //   uWaveWeights  how much each counts towards the look of the sea
  //   uSea          three vec4s:
  //                 shore phase, shore waves so far, shore strength, shore period
  //                 drift x, drift z, ripple strength, swell strength
  //                 time, motion, daylight, unused
  // motion scales everything: at 0 the sea is exactly the painting.
  uniforms(motion, daylight) {
    const { uWaves: waves, uSea: sea } = this.buffers;
    this.waves.forEach((w, i) => {
      waves[i * 4] = w.kx;
      waves[i * 4 + 1] = w.kz;
      waves[i * 4 + 2] = w.phase;
      waves[i * 4 + 3] = w.amount ?? 0;
    });
    sea[0] = this.shorePhase;
    sea[1] = this.shoreCount % 4096;
    sea[2] = this.shore;
    sea[3] = this.shorePeriod;
    sea[4] = this.drift[0];
    sea[5] = this.drift[1];
    sea[6] = this.ripple;
    sea[7] = this.swell;
    sea[8] = this.time;
    sea[9] = motion;
    sea[10] = daylight;
    sea[11] = 0;
    return this.buffers;
  }

  // What the console shows.
  describe() {
    return { swell: +this.swell.toFixed(3), ripple: +this.ripple.toFixed(3), shore: +this.shore.toFixed(3), waves: this.shoreCount };
  }

  #add(length, heading, weight, r, kind) {
    const k = TAU / length;
    this.waves.push({
      kind,
      heading,
      weight,
      kx: k * Math.cos(heading),
      kz: k * Math.sin(heading),
      // Deep water: each wave travels at its own speed.
      omega: Math.sqrt(G * k) * PACE[kind],
      start: r() * TAU,
      phase: 0,
      wander: 9 + r() * 22,
      seed: Math.floor(r() * 1e6),
      amount: undefined,
    });
  }
}
