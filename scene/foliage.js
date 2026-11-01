// How the trees answer the wind, worked out on the CPU once a frame: a
// couple of numbers per tree, which the shader spreads over its leaves.
//
// Each tree (see TREES in build_scene.py) feels the wind where its crown is
// (Environment.windAt), so a gust coming in off the sea reaches the headland
// pines first and the village a few seconds later, harder at some trees than
// others. Wind pushes on a crown as the square of its speed, so a calm
// breeze hardly moves anything and a gust a good deal more.
//
// A tree has two ways of moving, each a damped spring with its own period:
//   sway    the whole crown bending over its trunk: slow, a second or two
//           for a tall cypress, and lightly damped, so it carries on a
//           little after a gust has passed and settles by itself;
//   branch  its smaller branches, quicker and more damped, shaken by the
//           eddies in the wind and by the crown's own swaying, so they
//           follow it a moment late.
// and a flutter of the leaves at its edge, which comes up with the wind and
// dies away after it.
//
// Only changes in the wind are passed on, not its steady push, so a tree
// always comes back to where the painter put it.
//
// Every tree's springs differ a little from the next one's, even among trees
// of a kind, so no two keep time together.

import { noise } from "./environment.js";

const TAU = Math.PI * 2;

const generator = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// How each kind of tree moves. sway and branch are the springs' frequencies
// (Hz) and damping ratios; bend and twig how far each one goes (painting
// pixels at the tip of a 100-pixel tree, for a full push of wind); flutter
// how far the leaves at the edge of the crown shiver.
//
// Cypresses are tall and slender and sway the most, slowly; their foliage
// is dense, so little flutters. The olive is heavy and stiff in the trunk
// but its outer branches are long and loose, and its leaves turn in the
// slightest air. Pines are like the cypresses, smaller. Bushes are stiff
// and quick.
export const KINDS = {
  cypress: { sway: [0.42, 0.1], branch: [1.3, 0.25], bend: 1.35, twig: 0.45, flutter: 0.16 },
  olive: { sway: [0.36, 0.3], branch: [1.0, 0.2], bend: 0.8, twig: 1.1, flutter: 0.3 },
  broadleaf: { sway: [0.55, 0.22], branch: [1.5, 0.24], bend: 1.4, twig: 1.0, flutter: 0.24 },
  pine: { sway: [0.5, 0.16], branch: [1.3, 0.26], bend: 1.4, twig: 0.7, flutter: 0.14 },
  bush: { sway: [0.9, 0.32], branch: [2.0, 0.3], bend: 0.8, twig: 0.8, flutter: 0.22 },
};

// Matches TREES in shaders.js.
export const TREES = 32;

// Approaches a target with time constant tau seconds.
const ease = (value, target, dt, tau) => value + (target - value) * (1 - Math.exp(-dt / tau));

export class Foliage {
  constructor(seed = 36, manifest) {
    const r = generator(seed * 104729 + 5);
    const list = manifest?.trees ?? [];
    if (list.length > TREES) throw new Error(`${list.length} trees; the shader takes ${TREES}`);
    this.trees = list.map((spec) => {
      const kind = KINDS[spec.kind] ?? KINDS.bush;
      const vary = (v, by) => v * (1 + by * (r() * 2 - 1));
      // Bigger trees move further at the tip, though not in proportion: a
      // bush a few pixels across must not be seen to jump.
      const size = Math.min(1.5, Math.pow((spec.length + spec.root) / 100, 0.6));
      const [bx, by] = spec.base, [tx, ty] = spec.top;
      return {
        // Where it feels the wind: up in its crown.
        x: bx + (tx - bx) * 0.7,
        y: by + (ty - by) * 0.7,
        sway: spring(vary(kind.sway[0], 0.25), vary(kind.sway[1], 0.25)),
        branch: spring(vary(kind.branch[0], 0.22), vary(kind.branch[1], 0.2)),
        lift: spring(vary(kind.branch[0] * 1.15, 0.22), vary(kind.branch[1], 0.2)),
        bend: kind.bend * size * vary(1, 0.2),
        twig: kind.twig * size * vary(1, 0.2),
        flutter: kind.flutter * vary(1, 0.25),
        // How much of the wind it catches, open or sheltered, and how long
        // the wind takes to get into its crown: a dense crown takes it up
        // more slowly than an open one.
        catch: vary(1, 0.25),
        delay: 0.2 + 0.9 * r(),
        seed: Math.floor(r() * 1e6),
        // Leaves start shivering at their own strength of wind.
        threshold: vary(0.42, 0.15),
        level: 0,
        push: undefined,
        slow: undefined,
        quick: undefined,
      };
    });
    this.wind = {};
    // The flutter's course through its noise, shared by every tree so it
    // runs on unbroken from one to the next; each tree sets how much of it
    // its leaves show.
    this.turn = r() * TAU;
    this.buffers = {
      uTrees: new Float32Array(TREES * 8),
      uFoliage: new Float32Array(4),
    };
    this.reset();
  }

  reset() {
    for (const t of this.trees) {
      for (const s of [t.sway, t.branch, t.lift]) s.x = s.v = 0;
      t.level = 0;
      t.push = t.slow = t.quick = undefined;
    }
  }

  step(dt, env) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    // Small steps keep the quicker springs steady at any frame rate.
    const n = Math.ceil(dt / (1 / 60));
    const h = dt / n;
    const w = this.wind;
    for (const t of this.trees) {
      env.windAt(t.x, t.y, w);
      // Eddies no bigger than the crown itself, which its neighbour, a few
      // metres off, does not feel.
      const own = 1 + 0.3 * noise(env.time / 1.9, t.seed) + 0.15 * noise(env.time / 0.7, t.seed + 1);
      const along = w.along * own;
      const felt = t.catch * along * along;
      t.push = ease(t.push ?? felt, felt, dt, t.delay);
      const push = t.push;
      // The steady push goes nowhere: a tree is drawn bent the way it
      // usually is in this breeze, and comes back there as soon as a gust
      // has gone. What moves it is the wind getting up, over seconds for the
      // crown, and quicker for the branches, which the eddies jostle.
      t.slow = ease(t.slow ?? push, push, dt, push > t.slow ? 20 : 3);
      t.quick = ease(t.quick ?? felt, felt, dt, 0.7);
      const swayForce = t.bend * (push - t.slow);
      const branchForce = t.twig * (felt - t.quick) * 1.6;
      const liftForce = t.twig * w.lift * 0.8;
      for (let i = 0; i < n; i++) {
        const before = t.sway.v;
        t.sway.step(h, swayForce, 0);
        // The crown's swaying carries its branches along a moment late.
        const carry = (t.sway.v - before) / h;
        t.branch.step(h, branchForce, carry);
        t.lift.step(h, liftForce, 0);
      }
      // Leaves shiver once the wind is up, quickly, and calm down slowly.
      const want = Math.min(1, Math.max(0, (along - t.threshold) / 0.4));
      t.level = ease(t.level, want, dt, want > t.level ? 0.6 : 2.5);
    }
    // Quicker as the wind gets up.
    this.turn = (this.turn + dt * (0.09 + 0.06 * env.wind.strength)) % TAU;
  }

  // Uniforms for the shader, refreshed in place:
  //   uTrees    two vec4s per tree, in id order:
  //             sway now, sway a quarter period on (pixels at the tip);
  //             branch the same; up and down the same; flutter, unused
  //   uFoliage  motion (0 is the painting exactly), the flutter's course,
  //             unused x2
  uniforms(motion) {
    const { uTrees: out, uFoliage: f } = this.buffers;
    this.trees.forEach((t, i) => {
      const o = i * 8;
      out[o] = t.sway.x;
      out[o + 1] = t.sway.v / t.sway.w;
      out[o + 2] = t.branch.x;
      out[o + 3] = t.branch.v / t.branch.w;
      out[o + 4] = t.lift.x;
      out[o + 5] = t.lift.v / t.lift.w;
      out[o + 6] = t.flutter * t.level;
      out[o + 7] = 0;
    });
    f[0] = motion;
    f[1] = this.turn;
    return this.buffers;
  }

  // What the console shows: the liveliest trees.
  describe() {
    const most = (key) => Math.max(0, ...this.trees.map((t) => Math.abs(t[key].x)));
    return {
      sway: +most("sway").toFixed(3),
      branch: +most("branch").toFixed(3),
      flutter: +Math.max(0, ...this.trees.map((t) => t.flutter * t.level)).toFixed(3),
    };
  }
}

// A damped spring, x'' = w^2 (force - x) - 2 zeta w x' - carry, stepped
// semi-implicitly. Its quarter-period-on value, v / w, lets the shader see
// it a little earlier or later than now.
function spring(hz, zeta) {
  const w = TAU * hz;
  return {
    w,
    x: 0,
    v: 0,
    step(h, force, carry) {
      this.v += (w * w * (force - this.x) - 2 * zeta * w * this.v - carry) * h;
      this.x += this.v * h;
    },
  };
}
