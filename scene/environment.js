// The weather over the painting, shared by everything that will move in it.
// A gust is one event: it reaches the sea, the trees and the birds alike,
// and each answers it in its own way. Nothing here repeats: wind, gusts and
// the general liveliness of the scene come from noise and from gusts that
// arrive at random, so no loop can be spotted.
//
// The wind is the same everywhere (`wind`), as the sea feels it, and also
// varies across the painting (`windAt`): each gust comes in off the open sea
// on the left and sweeps across to the village, arriving a few seconds
// later there and harder in some places than others, and eddies carried
// along with the breeze make nearby trees feel related but never identical
// air.
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
const fade = (f) => f * f * f * (f * (f * 6 - 15) + 10);
export const noise = (t, seed = 0) => {
  const i = Math.floor(t), f = t - i;
  const a = hash(i, seed) * f, b = hash(i + 1, seed) * (f - 1);
  return (a + (b - a) * fade(f)) * 2;
};
// The same in 2D, about -1 to 1.
const corner = (i, j, seed, x, y) => {
  const a = hash(Math.imul(i, 0x1b873593) ^ j, seed) * Math.PI;
  return Math.cos(a) * x + Math.sin(a) * y;
};
export const noise2 = (x, y, seed = 0) => {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fade(fx), v = fade(fy);
  const a = corner(i, j, seed, fx, fy), b = corner(i + 1, j, seed, fx - 1, fy);
  const c = corner(i, j + 1, seed, fx, fy - 1), d = corner(i + 1, j + 1, seed, fx - 1, fy - 1);
  return 1.4 * (a + (b - a) * u + (c - a + (a - b - c + d) * u) * v);
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
  // Where, across the painting (in its pixels), `wind` is felt: out over
  // the open sea. Gusts reach anywhere to the right of it later.
  seaX: 700,
};

// How fast a gust sweeps across the painting, in its pixels a second, and
// so how long one can still be on its way after it has passed the sea.
const GUST_SPEED = [160, 260];
const GUST_TRAVEL = 2400 / GUST_SPEED[0];

export class Environment {
  constructor(options = {}) {
    this.options = { ...ENVIRONMENT_DEFAULTS, ...options };
    this.random = generator(this.options.seed);
    // Where and how each gust lands is drawn from its own stream, so the
    // gusts themselves come exactly when they always have.
    this.spread = generator(this.options.seed * 7 + 3);
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
    // The breeze without its gusts, and how far it has carried the eddies
    // in it, in painting pixels.
    this.calm = this.options.baseStrength;
    this.carried = 0;
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
    // Kept until they have crossed the whole painting.
    this.gusts = this.gusts.filter((g) => this.time < g.start + g.rise + g.fall + GUST_TRAVEL);
    this.#sample();
    this.carried += (40 + 150 * this.wind.strength) * this.wind.x * dt;
    return this;
  }

  // The envelope of every gust still blowing at time t: a quick rise and a
  // long fall, each smoothed so neither starts or stops with a jolt.
  gustAt(t = this.time) {
    let sum = 0;
    for (const g of this.gusts) sum += g.peak * envelope(g, t - g.start);
    return Math.min(1, sum);
  }

  // The wind at a point of the painting (its pixels) now: `along`, its
  // strength across the picture, left to right, about 0 to 1.3; `lift`, a
  // small up and down part, from the eddies; `gust`, how much of it is gust.
  windAt(x, y, out = {}) {
    const t = this.time, seed = this.options.seed;
    let gust = 0;
    for (const g of this.gusts) {
      // The front comes in from the sea, ragged: it reaches some rows a
      // little before others.
      const lag = (x - this.options.seaX) / g.speed + 0.9 * noise2(y / 90, g.seed, seed);
      const reach = Math.min(1.35, Math.max(0.15, 0.75 + 0.55 * noise2(x / 300 + g.seed, y / 220, seed + 9)));
      gust += g.peak * reach * envelope(g, t - lag - g.start);
    }
    gust = Math.min(1, gust);
    const mean = this.calm + 0.55 * gust;
    // Eddies large and small, carried along with the breeze and slowly
    // changing as they go.
    const c = this.carried;
    const big = noise2((x - c) / 240, y / 170 + t / 13, seed + 11);
    const small = noise2((x - 1.3 * c) / 75, y / 60 + t / 3.7, seed + 12);
    const swirl = noise2((x - c) / 110 + 37.1, y / 90 - t / 5.3, seed + 13);
    const stir = 0.25 + 0.3 * this.wind.turbulence;
    out.along = Math.max(0, mean * (1 + stir * (big + 0.6 * small))) * Math.cos(this.wind.direction);
    out.lift = mean * stir * 0.5 * swirl;
    out.gust = gust;
    return out;
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
    const r = this.random, s = this.spread;
    this.gusts.push({
      start: this.time,
      peak: 0.25 + 0.75 * r() ** 1.6 * (0.5 + this.activity),
      rise: 1.1 + r() * 1.8,
      fall: 3 + r() * 5,
      speed: GUST_SPEED[0] + (GUST_SPEED[1] - GUST_SPEED[0]) * s(),
      seed: Math.floor(s() * 1000) + 0.5,
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
    this.calm = baseStrength * (0.7 + 0.6 * fbm(t / 23, seed + 1));
    w.strength = Math.min(1, Math.max(0, this.calm + 0.55 * gust));
    // Direction drifts slowly, and veers a little with each gust.
    w.direction = prevailing + wander * fbm(t / 61, seed + 2) + 0.15 * gust * noise(t / 3.7, seed + 3);
    w.x = Math.cos(w.direction);
    w.y = Math.sin(w.direction);
    // Short-lived disorder: highest as a gust builds and breaks.
    w.turbulence = Math.min(1, 0.15 + 0.85 * gust * (0.6 + 0.4 * Math.abs(noise(t / 1.3, seed + 4))));
  }
}

function envelope(g, u) {
  if (u <= 0) return 0;
  return smoothstep(0, g.rise, u) * (1 - smoothstep(g.rise, g.rise + g.fall, u));
}
