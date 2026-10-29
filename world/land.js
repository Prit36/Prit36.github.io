import * as THREE from "three";
import { stylize, U } from "./style.js";

// The ground of the bay: one height field for the coast, the hills, the
// sea floor and the far mountains, so that what you see and what you walk
// on are the same thing. Land lies north (−z) and east (+x); the open sea
// is to the south-west, where the sun sets.

// The same numbers every visit, so the bay is always the same bay.
export const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hash = (x, y) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export const noise = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
export const fbm = (x, y, octaves = 4) => {
  let sum = 0, amp = 0.5, total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x + i * 17.31, y - i * 9.17);
    total += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
  }
  return sum / total;
};
const ridged = (x, y) => {
  let sum = 0, amp = 0.55;
  for (let i = 0; i < 4; i++) {
    const n = 1 - Math.abs(noise(x + i * 5.3, y + i * 3.1) * 2 - 1);
    sum += amp * n * n;
    amp *= 0.5;
    x *= 2.1;
    y *= 2.1;
  }
  return sum;
};
export const smooth = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
export const lerp = (a, b, k) => a + (b - a) * k;

// The coast, walked with the land on the left: the far shore to the west,
// the lighthouse headland, the cove, the beach under the village, the
// village rocks, and on down the east shore. The corners far out close it.
const COAST = [
  [-4800, -1100], [-2600, -880], [-1500, -620], [-900, -430], [-620, -340], [-430, -282],
  [-326, -236], [-266, -196],
  [-254, -146], [-242, -100], [-226, -62], [-208, -38], [-188, -30], [-168, -38],
  [-154, -64], [-140, -98], [-120, -124],
  [-80, -144], [-30, -154], [20, -148], [62, -128],
  [96, -100], [120, -66], [134, -26], [140, 12],
  [143, 46], [131, 76], [134, 108], [152, 134],
  [168, 200], [182, 330], [200, 600], [260, 1400], [400, 4800],
  [4800, 4800], [4800, -4800], [-4800, -4800],
];
// x, z, radius, peak height. The near one is the islet you can swim to.
export const ISLANDS = [[-300, 112, 21, 7], [-1350, 420, 95, 62], [-2350, 760, 170, 120], [-880, 980, 42, 26]];
const BEACH = [[70, -120], [139, 20]];

// Footpaths, as lines between points. They are painted lighter and smoothed.
export const PATHS = [
  [[164, 84], [172, 58], [162, 28], [150, 4]],
  [[150, 4], [178, -6], [206, -8], [232, -24], [258, -42]],
  [[258, -42], [276, -24], [290, -12]],
  [[150, 4], [138, -44], [112, -92], [80, -120]],
  [[80, -120], [40, -162], [-20, -172], [-80, -160], [-130, -132], [-166, -96], [-186, -64]],
  [[40, -162], [28, -214], [6, -260], [-20, -290]],
  [[28, -214], [70, -270], [96, -318]],
];

const segDist = (x, z, [ax, az], [bx, bz]) => {
  const ex = bx - ax, ez = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
  return Math.hypot(x - ax - ex * t, z - az - ez * t);
};
// Signed distance to the coast: positive on land.
const coastDist = (x, z) => {
  let best = Infinity, inside = false;
  for (let i = 0, j = COAST.length - 1; i < COAST.length; j = i++) {
    const [ax, az] = COAST[j], [bx, bz] = COAST[i];
    const ex = bx - ax, ez = bz - az, wx = x - ax, wz = z - az;
    const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
    const dx = wx - ex * t, dz = wz - ez * t;
    best = Math.min(best, dx * dx + dz * dz);
    if ((az > z) !== (bz > z) && x < ax + ((z - az) * ex) / ez) inside = !inside;
  }
  return inside ? Math.sqrt(best) : -Math.sqrt(best);
};
export const pathDist = (x, z) => {
  let best = Infinity;
  for (const p of PATHS) for (let i = 1; i < p.length; i++) best = Math.min(best, segDist(x, z, p[i - 1], p[i]));
  return best;
};

// Everything known about one spot. Reused, so a call allocates nothing.
const F = { h: 0, d: 0, beach: 0, rock: 0, village: 0, path: 0, north: 0, island: 0, terrace: 0 };
export const TERRACE_STEP = 3.2;
export function field(x, z, out = F) {
  let d = coastDist(x, z);
  const beach = 1 - smooth(22, 52, segDist(x, z, BEACH[0], BEACH[1]));
  const rocky = 1 - beach;
  const wob = ((fbm(x / 70, z / 70, 3) - 0.5) * 26 + (noise(x / 13, z / 13) - 0.5) * 5) * (1 - 0.85 * beach);
  d += wob;
  let island = null, best = -Infinity;
  for (const isl of ISLANDS) {
    const di = isl[2] - Math.hypot(x - isl[0], z - isl[1]) + wob * 0.35;
    if (di > best) { best = di; island = isl; }
  }
  const onIsland = best > d;
  if (onIsland) d = best;
  const near = Math.abs(x) < 700 && Math.abs(z) < 700;
  const path = near ? 1 - smooth(1.3, 2.8, pathDist(x, z)) : 0;
  const vd = Math.hypot(x - 228, (z + 30) * 1.15);
  const village = 1 - smooth(70, 125, vd);
  const north = smooth(-150, -560, z), east = smooth(165, 560, x);
  let h, rock = 0, terrace = 0;
  if (d >= 0) {
    h = beach * d * 0.055 + rocky * 6.5 * (1 - Math.exp(-d / 4.5));
    if (onIsland) {
      h += island[3] * smooth(0, island[2] * 0.9, d);
    } else {
      h += (100 * north + 80 * east + 60 * north * east) * smooth(4, 70, d);
      h += smooth(250, 2600, d) * (160 + 520 * ridged(x / 1300, z / 1300));
    }
    h += (fbm(x / 95, z / 95, 4) - 0.45) * 24 * smooth(8, 90, d);
    h += ((fbm(x / 38, z / 38, 3) - 0.5) * 7 + (fbm(x / 13, z / 13, 2) - 0.5) * 2.2) * smooth(1, 16, d) * (1 - 0.8 * path);
    // Terraces for olives and lavender on some of the gentler hills
    if (near && !onIsland) {
      terrace = smooth(0.5, 0.58, fbm(x / 150 - 13, z / 150 + 6, 3)) * smooth(14, 24, d) * (1 - smooth(0.04, 0.3, village))
        * smooth(6, 12, h) * (1 - smooth(64, 86, h)) * (1 - smooth(0.4, 0.75, beach));
      if (terrace > 0) {
        const step = TERRACE_STEP, q = h / step, fr = q - Math.floor(q);
        h = lerp(h, (Math.floor(q) + smooth(0.55, 1, fr)) * step, terrace * 0.9 * (1 - path));
      }
    }
    // The village is built on terraces.
    if (village > 0 && d > 6) {
      const step = 2.6, q = h / step, f = q - Math.floor(q);
      const terraced = (Math.floor(q) + smooth(0.55, 1, f)) * step;
      h = lerp(h, terraced, village * 0.75 * smooth(6, 16, d) * (1 - path));
    }
  } else {
    const dd = -d;
    let depth = beach * dd * 0.07 + rocky * Math.min(dd * 0.38, 2.2 + dd * 0.078);
    depth = Math.min(depth, 42) + (fbm(x / 40, z / 40, 3) - 0.5) * 3 * smooth(0, 12, dd);
    // Dark rocks on the sea floor, the way the painting has them.
    rock = smooth(0.6, 0.7, fbm(x / 16 + 31, z / 16 - 7, 3)) * (1 - smooth(60, 130, dd));
    depth -= rock * Math.min(depth * 0.45, 2.2);
    h = -Math.max(0, depth);
  }
  out.h = h; out.d = d; out.beach = beach; out.rock = rock;
  out.village = village; out.path = path; out.north = north; out.island = onIsland ? 1 : 0; out.terrace = terrace;
  return out;
}

// What covers the land besides grass: woods of pine and oak in patches over
// the hills, maquis scrub between them, and meadows thick with flowers. The
// ground is painted to match, so from far off the hills read as the painting's
// dark green, and close to it each patch has its plants.
const CV = { wood: 0, scrub: 0, meadow: 0, terrace: 0 };
export function cover(x, z, f = field(x, z, {}), out = CV) {
  const land = smooth(4, 12, f.d) * smooth(1.6, 3.6, f.h) * (1 - smooth(0.15, 0.5, f.path)) * (1 - smooth(0.3, 0.7, f.beach) * (1 - smooth(4, 9, f.h)));
  const town = 1 - smooth(0.12, 0.5, f.village);
  const hills = smooth(8, 34, f.h);
  const farmed = 1 - smooth(0.1, 0.5, f.terrace);
  out.wood = smooth(0.5, 0.6, fbm(x / 230 + 5, z / 230 - 3, 4) + f.north * 0.12 + f.island * 0.3) * land * town * hills * farmed;
  const maquis = smooth(0.4, 0.55, fbm(x / 64 + 2, z / 64 + 9, 3));
  const cliffs = smooth(34, 8, f.d) * (1 - f.beach) * smooth(0.35, 0.6, noise(x / 23 + 4, z / 23));
  out.scrub = Math.max(maquis * (0.35 + 0.65 * hills), cliffs) * land * (1 - 0.75 * (1 - town)) * (1 - out.wood * 0.55) * (0.15 + 0.85 * farmed);
  out.meadow = smooth(0.5, 0.62, fbm(x / 110 - 7, z / 110 + 4, 3)) * land * (1 - out.wood) * (1 - out.scrub * 0.6) * (1 - smooth(60, 140, f.h));
  out.terrace = f.terrace;
  return out;
}

// The ground is one mesh, 3.5 m apart near the bay and stretching out to
// 4.6 km, so the same mesh is the far mountains.
export const CORE = 600, STEP = 2.5, CELLS = 480;
const OUT = 56, OUT_A = 1.23;
const coordAt = (i) => {
  const k = i - OUT;
  if (k < 0) return -CORE - (STEP * -k + OUT_A * k * k);
  if (k > CELLS) { const m = k - CELLS; return CORE + STEP * m + OUT_A * m * m; }
  return -CORE + STEP * k;
};
let HG = null;
const W = CELLS + 1;
export function heightAt(x, z) {
  const fx = (x + CORE) / STEP, fz = (z + CORE) / STEP;
  if (HG && fx >= 0 && fz >= 0 && fx < CELLS && fz < CELLS) {
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
    const a = HG[j * W + i], b = HG[j * W + i + 1], c = HG[(j + 1) * W + i], d = HG[(j + 1) * W + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  return field(x, z).h;
}
// Slope as 1 − the up component of the normal.
export const slopeAt = (x, z) => {
  const e = 1.5;
  const dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e);
  return 1 - 2 * e / Math.hypot(dx, 2 * e, dz);
};

// What grows where, and how the ground looks there, worked out once per
// point of the grid and handed to the shaders.
let GD = null;   // ground data: height, grass, grass height, green-ness
let GROUND_TEX = null;
let CD = null;   // cover data: wood, scrub, meadow
// Nothing grows under a house or a wall.
export function clearGround(x, z, rad, keep = 0) {
  if (!GD) return;
  const i0 = Math.max(0, Math.floor((x - rad + CORE) / STEP)), i1 = Math.min(CELLS, Math.ceil((x + rad + CORE) / STEP));
  const j0 = Math.max(0, Math.floor((z - rad + CORE) / STEP)), j1 = Math.min(CELLS, Math.ceil((z + rad + CORE) / STEP));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const gx = -CORE + i * STEP, gz = -CORE + j * STEP;
    if (Math.hypot(gx - x, gz - z) <= rad) GD[(j * W + i) * 4 + 1] *= keep;
  }
  if (GROUND_TEX) GROUND_TEX.needsUpdate = true;
}
export const grassAt = (x, z) => {
  if (!GD) return 0;
  const i = Math.round((x + CORE) / STEP), j = Math.round((z + CORE) / STEP);
  if (i < 0 || j < 0 || i > CELLS || j > CELLS) return 0;
  return GD[(j * W + i) * 4 + 1];
};
// The cover at a point, from the grid (cheaper than working it out again)
export const coverAt = (x, z) => {
  const i = Math.round((x + CORE) / STEP), j = Math.round((z + CORE) / STEP);
  if (!CD || i < 0 || j < 0 || i > CELLS || j > CELLS) return cover(x, z);
  const c = (j * W + i) * 4;
  CV.wood = CD[c]; CV.scrub = CD[c + 1]; CV.meadow = CD[c + 2]; CV.terrace = CD[c + 3];
  return CV;
};

export function buildTerrain() {
  const n = CELLS + 2 * OUT + 1;
  const xs = Float32Array.from({ length: n }, (_, i) => coordAt(i));
  const pos = new Float32Array(n * n * 3);
  const terr = new Float32Array(n * n * 4);
  const misc = new Float32Array(n * n * 4);
  const cov = new Float32Array(n * n * 3);
  HG = new Float32Array(W * W);
  GD = new Float32Array(W * W * 4);
  CD = new Float32Array(W * W * 4);
  const floor = new Uint16Array(W * W * 4);
  const half = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = xs[i], z = xs[j], f = field(x, z), k = j * n + i;
      pos[k * 3] = x; pos[k * 3 + 1] = f.h; pos[k * 3 + 2] = z;
      terr[k * 4] = f.beach; terr[k * 4 + 1] = f.path; terr[k * 4 + 2] = f.rock;
      misc[k * 4] = f.village; misc[k * 4 + 1] = f.d; misc[k * 4 + 2] = f.north; misc[k * 4 + 3] = f.island;
      const cv = cover(x, z, f);
      cov[k * 3] = cv.wood; cov[k * 3 + 1] = cv.scrub; cov[k * 3 + 2] = cv.meadow;
      const ci = i - OUT, cj = j - OUT;
      if (ci >= 0 && cj >= 0 && ci <= CELLS && cj <= CELLS) {
        const c = cj * W + ci;
        HG[c] = f.h;
        CD[c * 4] = cv.wood; CD[c * 4 + 1] = cv.scrub; CD[c * 4 + 2] = cv.meadow; CD[c * 4 + 3] = cv.terrace;
        floor[c * 4] = half(f.h);
        floor[c * 4 + 1] = half(f.rock);
        floor[c * 4 + 2] = half(1 - smooth(3, 12, -f.d));
        floor[c * 4 + 3] = half(1);
      }
    }
  }
  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // Split each cell along whichever diagonal follows the ground better
      if (Math.abs(pos[a * 3 + 1] - pos[d * 3 + 1]) < Math.abs(pos[b * 3 + 1] - pos[c * 3 + 1])) index.set([a, c, d, a, d, b], q);
      else index.set([a, c, b, b, c, d], q);
      q += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;
  // Grass: on the hills, not on rock, sand, paths or steep ground
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = pos[k * 3], h = pos[k * 3 + 1], z = pos[k * 3 + 2];
      const slope = 1 - nrm[k * 3 + 1];
      const beach = terr[k * 4], path = terr[k * 4 + 1];
      const village = misc[k * 4], d = misc[k * 4 + 1], north = misc[k * 4 + 2];
      let g = smooth(1.2, 2.4, h) * (1 - smooth(0.3, 0.6, beach)) * (1 - smooth(0.05, 0.35, path)) * (1 - smooth(0.3, 0.44, slope));
      g *= smooth(5, 11, d) * (1 - smooth(160, 260, h));
      const patch = smooth(0.32, 0.62, fbm(x / 34 + 3, z / 34 - 8, 3));
      const wood = cov[k * 3], scrub = cov[k * 3 + 1], meadow = cov[k * 3 + 2];
      g *= (0.4 + 0.6 * Math.max(patch, meadow)) * (1 - 0.6 * wood) * (1 - 0.25 * scrub);
      if (village > 0.3) g *= 0.85;
      terr[k * 4 + 3] = g;
      const ci = i - OUT, cj = j - OUT;
      if (ci >= 0 && cj >= 0 && ci <= CELLS && cj <= CELLS) {
        const c = (cj * W + ci) * 4;
        GD[c] = h;
        GD[c + 1] = g;
        GD[c + 2] = (0.55 + 0.75 * fbm(x / 22 - 5, z / 22 + 2, 3) + 0.25 * north) * (1 + 0.35 * meadow - 0.3 * wood);
        GD[c + 3] = Math.min(1, 0.3 + smooth(0.3, 0.75, fbm(x / 60 + 11, z / 60, 3)) * 0.6 + north * 0.4 + village * 0.25 + meadow * 0.5 + wood * 0.4);
      }
    }
  }
  geo.setAttribute("aTerr", new THREE.BufferAttribute(terr, 4));
  geo.setAttribute("aMisc", new THREE.BufferAttribute(misc, 4));
  geo.setAttribute("aCover", new THREE.BufferAttribute(cov, 3));
  const material = terrainMaterial();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;

  // A coarse copy, for what the water reflects
  const step = 4, m = Math.floor((n - 1) / step) + 1;
  const cpos = new Float32Array(m * m * 3), cterr = new Float32Array(m * m * 4), cmisc = new Float32Array(m * m * 4), ccov = new Float32Array(m * m * 3);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const k = j * step * n + i * step, c = j * m + i;
    cpos.set(pos.subarray(k * 3, k * 3 + 3), c * 3);
    cterr.set(terr.subarray(k * 4, k * 4 + 4), c * 4);
    cmisc.set(misc.subarray(k * 4, k * 4 + 4), c * 4);
    ccov.set(cov.subarray(k * 3, k * 3 + 3), c * 3);
  }
  const cindex = new Uint32Array((m - 1) * (m - 1) * 6);
  q = 0;
  for (let j = 0; j < m - 1; j++) for (let i = 0; i < m - 1; i++) {
    const a = j * m + i;
    cindex.set([a, a + m, a + 1, a + 1, a + m, a + m + 1], q);
    q += 6;
  }
  const cgeo = new THREE.BufferGeometry();
  cgeo.setAttribute("position", new THREE.BufferAttribute(cpos, 3));
  cgeo.setAttribute("aTerr", new THREE.BufferAttribute(cterr, 4));
  cgeo.setAttribute("aMisc", new THREE.BufferAttribute(cmisc, 4));
  cgeo.setAttribute("aCover", new THREE.BufferAttribute(ccov, 3));
  cgeo.setIndex(new THREE.BufferAttribute(cindex, 1));
  cgeo.computeVertexNormals();
  const coarse = new THREE.Mesh(cgeo, material);
  coarse.layers.set(1);

  const floorTex = new THREE.DataTexture(floor, W, W, THREE.RGBAFormat, THREE.HalfFloatType);
  floorTex.magFilter = floorTex.minFilter = THREE.LinearFilter;
  floorTex.needsUpdate = true;
  GROUND_TEX = new THREE.DataTexture(GD, W, W, THREE.RGBAFormat, THREE.FloatType);
  GROUND_TEX.magFilter = GROUND_TEX.minFilter = THREE.NearestFilter;
  GROUND_TEX.needsUpdate = true;
  U.tGround.value = GROUND_TEX;
  U.uGround.value.set(-CORE, -CORE, STEP, W);
  const coverTex = new THREE.DataTexture(CD, W, W, THREE.RGBAFormat, THREE.FloatType);
  coverTex.magFilter = coverTex.minFilter = THREE.NearestFilter;
  coverTex.needsUpdate = true;
  U.tCover.value = coverTex;
  return { mesh, coarse, floorTex, floorRect: new THREE.Vector4(-CORE, -CORE, CORE * 2, CORE * 2) };
}

// The ground's paint: dry grass and sage in patches, cream limestone in
// layers where it's steep or by the sea, warm sand, worn paths and cobbles in
// the village, and under the water, sand with dark rocks and moving light.
const col = (h) => ({ value: new THREE.Color(h) });
export const TERRAIN = {
  cDry: col("#b5a866"), cSage: col("#8e9f6e"), cGreen: col("#6a8a46"), cForest: col("#4a6a3a"), cSoil: col("#66683c"),
  cWood: col("#4a5530"), cScrub: col("#4d6634"), cMeadow: col("#87a24c"),
  cRockA: col("#ece2cc"), cRockB: col("#cbbb9d"), cRockC: col("#a59780"),
  cSand: col("#e2cb98"), cWetSand: col("#b9a07a"), cPath: col("#e0cda2"), cCobble: col("#d9c8a8"), cMortar: col("#9c8b72"),
  cBed: col("#d2c096"), cBedRock: col("#3d4f52"), cFar: col("#5f7f60"), cPeak: col("#a3968c"),
};
// Limestone in layers, with cracks and darker weathered patches; shared
// with the rocks so the boulders and the cliffs are the same stone.
export const LIMESTONE = /* glsl */ `
  vec3 limestone(vec3 P, float detail, vec3 cA, vec3 cB, vec3 cC, out float bump) {
    float warp = fbm2(P.xz * 0.05) * 3.;
    float strata = vnoise(vec2(P.y * 0.9 + warp, 3.7));
    float fine = vnoise(vec2(P.y * 4.3 + warp * 2.3, 1.3));
    float blot = vnoise3(P * 0.16) * 0.6 + vnoise3(P * 0.45) * 0.4;
    float crack = detail > 0. ? 1. - smoothstep(0.012, 0.045, abs(vnoise3(P * vec3(0.45, 0.8, 0.45)) - 0.5)) : 0.;
    vec3 c = mix(cB, cA, smoothstep(0.3, 0.72, strata));
    c = mix(c, cC, smoothstep(0.55, 0.78, blot) * 0.75);
    c *= 0.92 + 0.12 * fine;
    c *= 1. - crack * 0.45 * detail;
    bump = (strata * 0.35 + fine * 0.08 - crack * 0.12) * detail;
    return c;
  }
`;
function terrainMaterial() {
  return stylize(new THREE.MeshLambertMaterial(), {
    key: "terrain",
    defines: { WRAP: 0.14 },
    uniforms: TERRAIN,
    vertexPars: "attribute vec4 aTerr, aMisc;\nattribute vec3 aCover;\nvarying vec4 vTerr, vMisc;\nvarying vec3 vCover;",
    vertex: "vTerr = aTerr; vMisc = aMisc; vCover = aCover;",
    fragmentPars: /* glsl */ `
      varying vec4 vTerr, vMisc;
      varying vec3 vCover;
      uniform vec3 cDry, cSage, cGreen, cForest, cSoil, cWood, cScrub, cMeadow, cRockA, cRockB, cRockC, cSand, cWetSand, cPath, cCobble, cMortar, cBed, cBedRock, cFar, cPeak;
      ${LIMESTONE}
      float caustic(vec2 p) {
        vec4 a = voronoi(p + vec2(uTime * 0.31, uTime * 0.19));
        vec4 b = voronoi(p * 1.31 + vec2(-uTime * 0.23, uTime * 0.27) + 5.);
        float ca = smoothstep(0.22, 0.0, a.y - a.x), cb = smoothstep(0.22, 0.0, b.y - b.x);
        return ca * cb * 1.4 + (ca + cb) * 0.12;
      }`,
    color: /* glsl */ `
      vec3 P = vWorldP;
      vec3 Nw = normalize(vWorldN);
      float slope = 1. - Nw.y;
      float dist = length(P - cameraPosition);
      float detail = 1. - smoothstep(50., 240., dist);
      float h = P.y;
      float n1 = fbm2(P.xz * 0.011), n2 = fbm2(P.xz * 0.037 + 7.3), n3 = vnoise(P.xz * 0.23), n4 = vnoise(P.xz * 1.7);
      vec3 col = mix(cDry, cSage, smoothstep(0.36, 0.64, n1));
      col = mix(col, cGreen, smoothstep(0.5, 0.74, n2) * 0.75);
      if (vMisc.z > 0.02) col = mix(col, cForest, smoothstep(0.1, 0.7, vMisc.z) * smoothstep(0.42, 0.62, fbm2(P.xz * 0.008 + 3.)));
      // scrub dark and close-knit, the floor of the woods in shade, meadows lush
      col = mix(col, cScrub * (0.8 + 0.4 * n3), vCover.y * 0.7);
      col = mix(col, cWood * (0.75 + 0.5 * n3), vCover.x * 0.85);
      col = mix(col, cMeadow * (0.9 + 0.2 * n3), vCover.z * 0.55);
      col *= 0.9 + 0.2 * mix(0.5, n3 * 0.7 + n4 * 0.3, detail);
      // the flowers in a meadow, as specks of colour from further than the
      // blades of grass are drawn, and as a tint where even the specks are too small
      if (vCover.z > 0.03) {
        vec2 fp = P.xz * 1.3;
        vec4 fv = voronoi(fp);
        float kind = vnoise(P.xz * 0.021 + 3.);
        vec3 fc = kind < 0.42 ? vec3(0.78, 0.1, 0.05) : kind < 0.58 ? vec3(0.95, 0.92, 0.84) : kind < 0.72 ? vec3(0.96, 0.74, 0.12) : vec3(0.52, 0.4, 0.86);
        float fine = smoothstep(0.25, 0.9, length(fwidth(fp)));
        float speck = mix(smoothstep(0.3, 0.16, fv.x) * step(0.42, hash12(fv.zw)), 0.13, fine);
        col = mix(col, fc, speck * vCover.z * smoothstep(20., 45., dist) * 0.85);
      }
      // close up: dabs laid in one direction per patch, clover, bare earth
      if (detail > 0.) {
        float ang = vnoise(P.xz * 0.06 + 3.) * 6.2832;
        vec2 dir = vec2(cos(ang), sin(ang));
        vec2 sp = vec2(dot(P.xz, dir), dot(P.xz, vec2(-dir.y, dir.x)));
        float dab = vnoise(sp * vec2(0.9, 3.6));
        float clover = smoothstep(0.55, 0.75, vnoise(P.xz * 0.45 + 9.)) * smoothstep(0.3, 0.6, vnoise(P.xz * 2.1));
        float bare = smoothstep(0.62, 0.8, vnoise(P.xz * 0.33 - 4.)) * (1. - vTerr.w);
        col *= 1. + (dab - 0.5) * 0.14 * detail;
        col = mix(col, cGreen * 0.85, clover * 0.45 * detail);
        col = mix(col, cSoil * 1.25, bare * 0.5 * detail);
      }
      // under the grass near you, earth, so the blades stand out of it
      col = mix(col, cSoil * (0.8 + 0.4 * n4), vTerr.w * (1. - smoothstep(14., 34., dist)) * 0.45);
      // far away, the colours the painting gives the mountains
      float far = smoothstep(300., 1100., vMisc.y);
      if (far > 0.) {
        // Ridges and ravines painted in (the mesh is coarse out there): light
        // catches the spurs, the gullies between them go dark with forest
        float rid = 0.;
        {
          vec2 q = P.xz * 0.0042 + vec2(3.1, 7.7);
          float a = 0.5;
          for (int i = 0; i < 4; i++) { float v = 1. - abs(vnoise(q) * 2. - 1.); rid += a * v * v; q = q * 2.07 + 5.3; a *= 0.5; }
        }
        gBump += (rid - 0.4) * 46. * far;
        col = mix(col, cFar * (0.85 + 0.3 * n1), far * 0.8);
        float wood = smoothstep(0.4, 0.58, fbm2(P.xz * 0.0031 + 4.) + (0.45 - rid) * 0.5) * (1. - smoothstep(0.38, 0.6, slope));
        col = mix(col, cForest * (0.5 + 0.25 * vnoise(P.xz * 0.05)), wood * far * 0.85);
        col *= mix(1., 0.72 + 0.5 * rid, far);
        float bare = smoothstep(0.55, 0.8, rid) * smoothstep(0.2, 0.45, slope + (n2 - 0.5) * 0.3);
        col = mix(col, cPeak * (0.9 + 0.25 * n3), bare * far * 0.75);
        col = mix(col, cPeak * 1.05, smoothstep(480., 950., h) * smoothstep(0.15, 0.4, slope) * far);
      }
      // sand on the beach, darker where the sea has just been
      float swash = sin(uTime * 0.7 + P.x * 0.05 + P.z * 0.03) * 0.1;
      vec3 sand = mix(cWetSand, cSand, smoothstep(0.08, 0.75, h - swash));
      sand *= 0.95 + 0.07 * vnoise(P.xz * vec2(0.8, 3.4)) * detail;
      col = mix(col, sand, vTerr.x * (1. - smoothstep(2.4, 3.8, h)));
      // rock where it's steep, and all along the rocky shore
      float shore = (1. - vTerr.x) * (1. - smoothstep(4., 10., vMisc.y)) * (1. - smoothstep(14., 24., h)) * (1. - vMisc.w * 0.5);
      float rocky = max(smoothstep(0.34, 0.5, slope + (n2 - 0.5) * 0.14), shore * smoothstep(0.25, 0.55, n2 * 0.6 + n3 * 0.6));
      rocky *= 1. - far;
      if (rocky > 0.01) {
        float rb;
        vec3 rock = limestone(P, detail, cRockA, cRockB, cRockC, rb);
        col = mix(col, rock, rocky);
        gBump += rb * rocky * 0.25;
      }
      // paths: packed earth outside the village, cobbles in it
      if (vTerr.y > 0.01) {
        vec3 path = cPath * (0.9 + 0.16 * n4);
        if (vMisc.x > 0.2 && detail > 0. && vTerr.x < 0.3 && h > 2.5) {
          vec4 v = voronoi(P.xz * 2.4);
          float edge = smoothstep(0.02, 0.1, v.y - v.x);
          vec3 cob = cCobble * (0.85 + 0.25 * hash12(v.zw));
          cob = mix(cMortar, cob, mix(1., edge, detail));
          path = mix(path, cob, smoothstep(0.2, 0.45, vMisc.x));
          gBump += edge * 0.03 * detail * vTerr.y;
        }
        col = mix(col, path, vTerr.y * (1. - rocky * 0.5));
      }
      // the sea floor
      if (h < 0.4) {
        vec3 bed = mix(cBed, cBed * vec3(0.78, 0.86, 0.85), smoothstep(-0.5, -8., h));
        bed *= 0.92 + 0.12 * n4;
        bed = mix(bed, cBedRock * (0.75 + 0.5 * n3), max(vTerr.z, rocky * 0.55));
        float ca = detail > 0. ? caustic(P.xz * 0.8) : 0.;
        bed *= 1. + ca * uSunUp * smoothstep(-9., -0.4, h) * 0.85;
        col = mix(col, bed, smoothstep(0.35, -0.35, h));
      }
      // wet just above the water line
      col *= 1. - 0.22 * smoothstep(0.65, 0.05, h - swash) * step(-0.05, h);
      diffuseColor.rgb = col;`,
  });
}

// Things you bump into and things you can stand on: boxes (with a roof
// for a top, if they have one) and upright cylinders, kept in a coarse grid.
const solids = [];
const cells = new Map();
const CELL = 16;
const cellKey = (i, j) => (i + 4096) * 8192 + (j + 4096);
const NONE = [];
export function addSolid(s) {
  s.cos = Math.cos(s.rot || 0);
  s.sin = Math.sin(s.rot || 0);
  s.bottom ??= -50;
  const r = s.r ?? Math.hypot(s.hw, s.hd);
  for (let i = Math.floor((s.x - r - 1) / CELL); i <= Math.floor((s.x + r + 1) / CELL); i++) {
    for (let j = Math.floor((s.z - r - 1) / CELL); j <= Math.floor((s.z + r + 1) / CELL); j++) {
      const k = cellKey(i, j);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(s);
    }
  }
  solids.push(s);
  return s;
}
const near = (x, z) => cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || NONE;
const local = (s, x, z) => {
  const dx = x - s.x, dz = z - s.z;
  return [s.cos * dx - s.sin * dz, s.sin * dx + s.cos * dz];
};
const topOf = (s, lx, lz) => (typeof s.top === "function" ? s.top(lx, lz) : s.top);
export const STEP_UP = 0.55;

// The highest thing under (x, z) that can be stood on from `feet`.
export function groundAt(x, z, feet = Infinity) {
  let g = heightAt(x, z), on = null;
  for (const s of near(x, z)) {
    let top;
    if (s.r !== undefined) {
      if (Math.hypot(x - s.x, z - s.z) > s.r) continue;
      top = s.top;
    } else {
      const [lx, lz] = local(s, x, z);
      if (Math.abs(lx) > s.hw || Math.abs(lz) > s.hd) continue;
      top = topOf(s, lx, lz);
    }
    if (top > g && top <= feet + STEP_UP) { g = top; on = s; }
  }
  return { y: g, on };
}

// Moves a body of radius r at height [feet, feet + tall] out of anything solid.
export function pushOut(p, r, feet, tall = 1.7) {
  let hit = false;
  for (const s of near(p.x, p.z)) {
    if (s.bottom > feet + tall) continue;
    if (s.r !== undefined) {
      if (s.top <= feet + STEP_UP) continue;
      const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz), min = s.r + r;
      if (d >= min) continue;
      if (d < 1e-5) p.x += min;
      else { p.x += (dx * (min - d)) / d; p.z += (dz * (min - d)) / d; }
      hit = true;
      continue;
    }
    const [lx, lz] = local(s, p.x, p.z);
    const cx = Math.max(-s.hw, Math.min(s.hw, lx)), cz = Math.max(-s.hd, Math.min(s.hd, lz));
    if (topOf(s, cx, cz) <= feet + STEP_UP) continue;
    let ox = lx - cx, oz = lz - cz;
    const d = Math.hypot(ox, oz);
    if (d >= r) continue;
    if (d > 1e-5) {
      ox *= (r - d) / d;
      oz *= (r - d) / d;
    } else {
      // Inside: out through the nearest side.
      const px = s.hw - Math.abs(lx), pz = s.hd - Math.abs(lz);
      if (px < pz) { ox = Math.sign(lx || 1) * (px + r); oz = 0; } else { oz = Math.sign(lz || 1) * (pz + r); ox = 0; }
    }
    p.x += s.cos * ox + s.sin * oz;
    p.z += -s.sin * ox + s.cos * oz;
    hit = true;
  }
  return hit;
}
