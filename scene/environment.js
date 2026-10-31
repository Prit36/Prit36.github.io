// The weather over the painting, shared by everything that will move in it.
// A gust is one event: it reaches the sea, the trees and the birds alike,
// and each answers it in its own way. Nothing here repeats: wind, gusts and
// the general liveliness of the scene come from noise and from gusts that
// arrive at random, so no loop can be spotted.
//
// It advances only while the scene is animating, and never by more than a
// tenth of a second at a time, so a tab left in the background picks up
// where it was instead of jumping.

// A small, fast, seedable generator (mulberry32).
const generator = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// 1D gradient noise: smooth, between about -1 and 1, and never periodic.
const hash = (i, seed) => {
  let h = Math.imul(i ^ seed, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296) * 2 - 1;
};
export const noise = (t, seed = 0) => {
  const i = Math.floor(t), f = t - i;
  const a = hash(i, seed) * f, b = hash(i + 1, seed) * (f - 1);
  const k = f * f * f * (f * (f * 6 - 15) + 10);
  return (a + (b - a) * k) * 2;
};
// Octaves at irrational ratios, so they never line up.
const fbm = (t, seed, octaves = 3) => {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(t * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2.137;
  }
  return sum / norm;
};

const smoothstep = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

export const ENVIRONMENT_DEFAULTS = {
  seed: 36,
  // The breeze comes in off the sea, from the left of the painting, a
  // little towards the viewer.
  prevailing: -0.12,
  // How far it wanders either side of that, in radians.
  wander: 0.45,
  // Calm to blustery, 0 to 1.
  baseStrength: 0.32,
  // Seconds between gusts, on average, at full activity.
  gustInterval: 11,
};

export class Environment {
  constructor(options = {}) {
    this.options = { ...ENVIRONMENT_DEFAULTS, ...options };
    this.random = generator(this.options.seed);
    this.reset();
  }

  reset() {
    // Seconds of simulated time. Each system can take its own phases from
    // this without ever needing to wrap it.
    this.time = 0;
    this.gusts = [];
    // Everything systems read, refreshed by step().
    this.wind = { strength: this.options.baseStrength, direction: this.options.prevailing, x: 1, y: 0, gust: 0, turbulence: 0 };
    this.activity = 0.5;
    this.#sample();
    this.nextGust = this.#gustWait(0.6);
  }

  // Advances by dt seconds (clamped) and refreshes the shared values.
  step(dt) {
    if (!(dt > 0)) return this;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    if (this.time >= this.nextGust) {
      this.#addGust();
      this.nextGust = this.time + this.#gustWait();
    }
    this.gusts = this.gusts.filter((g) => this.time < g.start + g.rise + g.fall);
    this.#sample();
    return this;
  }

  // The envelope of every gust still blowing at time t: a quick rise and a
  // long fall, each smoothed so neither starts or stops with a jolt.
  gustAt(t = this.time) {
    let sum = 0;
    for (const g of this.gusts) {
      const u = t - g.start;
      if (u <= 0) continue;
      const up = smoothstep(0, g.rise, u);
      const down = 1 - smoothstep(g.rise, g.rise + g.fall, u);
      sum += g.peak * up * down;
    }
    return Math.min(1, sum);
  }

  // Values for the GPU, two vec4s:
  //   time, strength, direction x, direction y
  //   gust, turbulence, activity, seed
  writeUniforms(out = new Float32Array(8)) {
    const w = this.wind;
    out[0] = this.time;
    out[1] = w.strength;
    out[2] = w.x;
    out[3] = w.y;
    out[4] = w.gust;
    out[5] = w.turbulence;
    out[6] = this.activity;
    out[7] = (this.options.seed % 997) / 997;
    return out;
  }

  #gustWait(scale = 1) {
    // Exponential waits are what independent arrivals look like; a calmer
    // scene waits longer.
    const mean = this.options.gustInterval / (0.35 + this.activity);
    return scale * -Math.log(1 - this.random() * 0.999) * mean;
  }

  #addGust() {
    const r = this.random;
    this.gusts.push({
      start: this.time,
      peak: 0.25 + 0.75 * r() ** 1.6 * (0.5 + this.activity),
      rise: 1.1 + r() * 1.8,
      fall: 3 + r() * 5,
    });
  }

  #sample() {
    const { seed, prevailing, wander, baseStrength } = this.options;
    const t = this.time;
    // Minutes-long swings in how lively the whole scene is.
    this.activity = 0.5 + 0.5 * fbm(t / 95, seed + 7, 2);
    const gust = this.gustAt(t);
    const w = this.wind;
    w.gust = gust;
    w.strength = Math.min(1, Math.max(0, baseStrength * (0.7 + 0.6 * fbm(t / 23, seed + 1)) + 0.55 * gust));
    // Direction drifts slowly, and veers a little with each gust.
    w.direction = prevailing + wander * fbm(t / 61, seed + 2) + 0.15 * gust * noise(t / 3.7, seed + 3);
    w.x = Math.cos(w.direction);
    w.y = Math.sin(w.direction);
    // Short-lived disorder: highest as a gust builds and breaks.
    w.turbulence = Math.min(1, 0.15 + 0.85 * gust * (0.6 + 0.4 * Math.abs(noise(t / 1.3, seed + 4))));
  }
}
