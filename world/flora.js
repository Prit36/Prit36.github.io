import * as THREE from "three";
import { rng } from "./land.js";
import { stylize, swayingDepth, A2C, U, GROUND } from "./style.js";

// Everything that grows: grass that the wind runs through in waves and that
// parts round your feet, wildflowers in it, and trees built the way a
// painter would build them: a trunk and branches, then masses of foliage
// that read as soft round shapes, light on top, dark inside, glowing where
// the sun comes through from behind.

// ------------------------------------------------------------------ leaf textures
// Drawn on a canvas, then copied out so the colour under the transparent
// parts stays light (no dark fringes when it's filtered).
function leafTexture(kind, seed) {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const r = rng(seed);
  const shade = (k) => `rgb(${k},${k},${Math.round(k * 0.96)})`;
  if (kind === "leafy") {
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 92;
      const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
      g.save();
      g.translate(x, y);
      g.rotate(a + Math.PI / 2 + (r() - 0.5) * 1.2);
      g.fillStyle = shade(150 + Math.floor(r() * 105));
      g.beginPath();
      g.ellipse(0, 0, 6 + r() * 4, 16 + r() * 8, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  } else if (kind === "needle") {
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 70;
      const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
      g.strokeStyle = shade(140 + Math.floor(r() * 115));
      g.lineWidth = 3;
      g.lineCap = "round";
      for (let k = 0; k < 16; k++) {
        const b = r() * Math.PI * 2, l = 22 + r() * 26;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l);
        g.stroke();
      }
    }
  } else if (kind === "scale") {
    for (let i = 0; i < 220; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 104;
      g.fillStyle = shade(130 + Math.floor(r() * 125));
      g.beginPath();
      g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 5 + r() * 9, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === "frond") {
    // a palm frond, rib along the middle, leaflets either side
    g.strokeStyle = shade(200);
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(S / 2, 0); g.lineTo(S / 2, S); g.stroke();
    for (let y = 6; y < S - 4; y += 7) {
      const l = 118 * Math.sin((y / S) * Math.PI) ** 0.6;
      g.lineWidth = 5;
      for (const sd of [-1, 1]) {
        g.strokeStyle = shade(150 + Math.floor(r() * 100));
        g.beginPath(); g.moveTo(S / 2, y); g.lineTo(S / 2 + sd * l, y + 26); g.stroke();
      }
    }
  }
  const src = g.getImageData(0, 0, S, S).data;
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const a = src[i * 4 + 3];
    data[i * 4] = a > 8 ? src[i * 4] : 205;
    data[i * 4 + 1] = a > 8 ? src[i * 4 + 1] : 205;
    data[i * 4 + 2] = a > 8 ? src[i * 4 + 2] : 198;
    data[i * 4 + 3] = a;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ geometry helpers
class Mesher {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(p, n, c, u = 0, v = 0) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.c.push(c.r, c.g, c.b); this.uv.push(u, v);
    return this.count - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// A tapering tube through a list of points: trunks, branches, stems.
function tube(m, pts, radii, segs, color) {
  const rings = [];
  let nrm = null;
  for (let i = 0; i < pts.length; i++) {
    const t = V().subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    if (!nrm) nrm = Math.abs(t.y) < 0.9 ? V(0, 1, 0).cross(t).normalize() : V(1, 0, 0).cross(t).normalize();
    else nrm.sub(t.clone().multiplyScalar(nrm.dot(t))).normalize();
    const bin = V().crossVectors(t, nrm);
    const ring = [];
    const k = i / (pts.length - 1);
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const d = nrm.clone().multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
      ring.push(m.vert(pts[i].clone().addScaledVector(d, radii[i]), d, color(k, a), s / segs, k));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < segs; s++) {
      const a = rings[i][s], b = rings[i][s + 1], c = rings[i + 1][s], d = rings[i + 1][s + 1];
      m.i.push(a, c, b, b, c, d);
    }
  }
}
// A gently bent line from a to b, for branches.
const bend = (a, b, n, sag, r) => {
  const out = [];
  const side = V(r() - 0.5, r() * 0.5, r() - 0.5).multiplyScalar(sag);
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    out.push(a.clone().lerp(b, k).addScaledVector(side, Math.sin(k * Math.PI)));
  }
  return out;
};

// Cards of foliage scattered through a set of ellipsoid clumps. Their
// normals point out from the whole crown, so it shades as one soft mass.
function foliage(m, o, r) {
  const { clumps, count, size, center, squash = 1, top, bottom, inner = 0.55, jitter = 0.12 } = o;
  const vols = clumps.map((c) => c.r.x * c.r.y * c.r.z);
  const total = vols.reduce((a, b) => a + b, 0);
  let minY = Infinity, maxY = -Infinity;
  for (const c of clumps) { minY = Math.min(minY, c.c.y - c.r.y); maxY = Math.max(maxY, c.c.y + c.r.y); }
  const col = new THREE.Color(), q = V();
  for (let i = 0; i < count; i++) {
    let pick = r() * total, ci = 0;
    while (pick > vols[ci] && ci < vols.length - 1) pick -= vols[ci++];
    const cl = clumps[ci];
    const dir = V(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
    if (dir.lengthSq() > 1 || dir.lengthSq() < 0.01) { i--; continue; }
    dir.normalize();
    const rad = 0.42 + 0.58 * Math.pow(r(), 0.5);
    const p = cl.c.clone().add(V(dir.x * cl.r.x, dir.y * cl.r.y, dir.z * cl.r.z).multiplyScalar(rad));
    const s = size[0] + r() * (size[1] - size[0]);
    const n = dir.clone().add(V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(1.6)).normalize();
    const t1 = V(r() - 0.5, r() - 0.5, r() - 0.5).cross(n).normalize();
    const t2 = V().crossVectors(n, t1);
    const hk = (p.y - minY) / Math.max(0.01, maxY - minY);
    const depth = rad;
    const tint = 1 - jitter + r() * jitter * 2;
    const base = [];
    for (const [a, b, u, v] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      const pos = p.clone().addScaledVector(t1, (a * s) / 2).addScaledVector(t2, (b * s) / 2);
      q.subVectors(pos, center);
      q.y *= squash;
      q.normalize();
      const nn = q.clone().multiplyScalar(0.88).addScaledVector(n.dot(q) < 0 ? n.clone().negate() : n, 0.12).normalize();
      col.copy(bottom).lerp(top, Math.min(1, hk * 0.75 + (q.y * 0.5 + 0.5) * 0.35));
      col.multiplyScalar((inner + (1 - inner) * depth) * tint);
      base.push(m.vert(pos, nn, col, u, v));
    }
    m.i.push(base[0], base[1], base[2], base[0], base[2], base[3]);
  }
}

const C = (h) => new THREE.Color(h);
const barkColor = (lo, hi) => (k) => C(lo).lerp(C(hi), k);

// ------------------------------------------------------------------ the trees
// Each returns { wood, leaves } geometries, in metres, standing at the origin.
function stonePine(seed) {
  const r = rng(seed);
  const H = 8 + r() * 3;
  const wood = new Mesher(), leaves = new Mesher();
  const lean = V((r() - 0.5) * 2.2, 0, (r() - 0.5) * 2.2);
  const top = V(lean.x, H * 0.66, lean.z);
  const bark = barkColor("#5e4636", "#8a6a50");
  tube(wood, bend(V(0, -0.5, 0), top, 6, 0.8, r), [0.36, 0.32, 0.29, 0.26, 0.23, 0.2, 0.18], 7, (k) => bark(k));
  const clumps = [];
  const nb = 4 + Math.floor(r() * 3);
  const crownR = 3.2 + r() * 1.4;
  for (let b = 0; b < nb; b++) {
    const a = (b / nb) * Math.PI * 2 + r() * 0.6;
    const d = crownR * (0.55 + r() * 0.45);
    const end = V(lean.x + Math.cos(a) * d, H * (0.8 + r() * 0.08), lean.z + Math.sin(a) * d);
    tube(wood, bend(top, end, 4, 0.6, r), [0.17, 0.14, 0.11, 0.08, 0.06], 5, (k) => bark(0.5 + k * 0.5));
    clumps.push({ c: end.clone().add(V(0, 0.45, 0)), r: V(1.9 + r() * 0.8, 0.95 + r() * 0.3, 1.9 + r() * 0.8) });
  }
  clumps.push({ c: V(lean.x, H * 0.9, lean.z), r: V(2.2, 1.05, 2.2) });
  const center = V(lean.x, H * 0.86, lean.z);
  const crown = { clumps, count: 300, size: [1.5, 2.2], center, squash: 2.2, top: C("#6a8a48"), bottom: C("#3a5530"), inner: 0.5 };
  foliage(leaves, crown, r);
  return { wood: wood.geometry(), leaves: leaves.geometry(), height: H, radius: 0.35, crown, trunk: [V(0, -0.5, 0), top, 0.3], bark: "#6e5240" };
}

function cypress(seed) {
  const r = rng(seed);
  const H = 9 + r() * 4, R = 0.95 + r() * 0.35;
  const wood = new Mesher(), leaves = new Mesher();
  tube(wood, [V(0, -0.4, 0), V(0, 1.2, 0), V(0, H * 0.7, 0)], [0.2, 0.17, 0.08], 6, barkColor("#4f3a2c", "#6b5040"));
  const clumps = [];
  for (let i = 0; i < 9; i++) {
    const k = (i + 0.5) / 9;
    const y = 0.7 + k * (H - 0.9);
    const w = R * Math.pow(Math.sin(Math.min(1, k * 1.25 + 0.08) * Math.PI * 0.5 + (k > 0.6 ? (k - 0.6) * 1.6 : 0)), 0.8) * (1 - Math.pow(k, 2.6) * 0.92);
    clumps.push({ c: V((r() - 0.5) * 0.15, y, (r() - 0.5) * 0.15), r: V(Math.max(0.18, w), H / 14, Math.max(0.18, w)) });
  }
  const crown = { clumps, count: 230, size: [0.75, 1.15], center: V(0, H * 0.45, 0), squash: 0.25, top: C("#4c6c3a"), bottom: C("#263f24"), inner: 0.45 };
  foliage(leaves, crown, r);
  return { wood: wood.geometry(), leaves: leaves.geometry(), height: H, radius: 0.25, crown };
}

function olive(seed, palette = "olive") {
  const r = rng(seed);
  const big = palette === "oak";
  const H = (big ? 6.5 : 4.2) + r() * 1.6;
  const wood = new Mesher(), leaves = new Mesher();
  const bark = big ? barkColor("#4d4036", "#6e5d4e") : barkColor("#5f554a", "#8d8273");
  const clumps = [];
  const stems = 2 + Math.floor(r() * 2);
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * Math.PI * 2 + r();
    const fork = V(Math.cos(a) * 0.25, H * 0.32, Math.sin(a) * 0.25);
    const end = V(Math.cos(a) * (1.2 + r()), H * (0.62 + r() * 0.12), Math.sin(a) * (1.2 + r()));
    tube(wood, [V(0, -0.4, 0), V(Math.cos(a) * 0.1, H * 0.12, Math.sin(a) * 0.1), fork], [0.3, 0.26, 0.2], 7, (k) => bark(k * 0.4));
    tube(wood, bend(fork, end, 4, 0.9, r), [0.19, 0.16, 0.12, 0.09, 0.07], 6, (k) => bark(0.4 + k * 0.6));
    clumps.push({ c: end.clone().add(V(0, 0.5, 0)), r: V(1.5 + r() * 0.6, 1.1 + r() * 0.4, 1.5 + r() * 0.6).multiplyScalar(big ? 1.35 : 1) });
  }
  clumps.push({ c: V(0, H * 0.8, 0), r: V(1.7, 1.2, 1.7).multiplyScalar(big ? 1.4 : 1) });
  const pal = big ? [C("#5f7e48"), C("#33502c")] : [C("#aebd98"), C("#6c7e5c")];
  const crown = { clumps, count: big ? 300 : 240, size: big ? [1.4, 2] : [1.05, 1.5], center: V(0, H * 0.72, 0), squash: 1.3, top: pal[0], bottom: pal[1], inner: 0.55 };
  foliage(leaves, crown, r);
  return { wood: wood.geometry(), leaves: leaves.geometry(), height: H, radius: 0.32, crown, trunk: [V(0, -0.4, 0), V(0, H * 0.45, 0), 0.28], bark: big ? "#5a4b3e" : "#77695b" };
}

function palm(seed) {
  const r = rng(seed);
  const H = 7 + r() * 2.5;
  const wood = new Mesher(), leaves = new Mesher();
  const lean = V((r() - 0.5) * 1.6, 0, (r() - 0.5) * 1.6);
  const pts = [], radii = [];
  for (let i = 0; i <= 12; i++) {
    const k = i / 12;
    pts.push(V(lean.x * k * k, -0.3 + k * H, lean.z * k * k));
    radii.push(0.28 - 0.08 * k);
  }
  tube(wood, pts, radii, 8, (k, a) => C("#8a7358").multiplyScalar(0.8 + 0.25 * (Math.sin(k * 70) * 0.5 + 0.5)));
  const crown = pts[pts.length - 1];
  const col = new THREE.Color();
  const nf = 14;
  for (let f = 0; f < nf; f++) {
    const a = (f / nf) * Math.PI * 2 + r() * 0.3;
    const up = 0.5 - r() * 0.7, len = 3.2 + r() * 1.2;
    const dir = V(Math.cos(a), 0, Math.sin(a));
    const side = V(-dir.z, 0, dir.x);
    const segs = 8;
    let prev = null;
    for (let i = 0; i <= segs; i++) {
      const k = i / segs;
      const p = crown.clone().addScaledVector(dir, k * len).add(V(0, (up * k - k * k * 1.3) * len * 0.6, 0));
      const w = 0.9 * Math.sin(Math.min(1, k * 1.4 + 0.15) * Math.PI) + 0.08;
      const nrm = V(0, 1, 0).addScaledVector(dir, 0.3).normalize();
      col.set("#7d9a4a").lerp(C("#4a6a30"), k * 0.5 + r() * 0.2);
      const a1 = leaves.vert(p.clone().addScaledVector(side, -w), nrm, col, 0, k);
      const a2 = leaves.vert(p.clone().addScaledVector(side, w), nrm, col, 1, k);
      if (prev) leaves.i.push(prev[0], a1, prev[1], prev[1], a1, a2);
      prev = [a1, a2];
    }
  }
  return { wood: wood.geometry(), leaves: leaves.geometry(), height: H, radius: 0.3 };
}

// A bush: a few clumps of leaves, and flowers over them if it's in flower.
// Bigger and darker, it's the maquis that covers the hills (lentisk, myrtle,
// broom and rock-rose); small, grey and purple, it's lavender.
function bush(seed, flowering = null, o = {}) {
  const r = rng(seed);
  const leaves = new Mesher();
  const clumps = [];
  const { n = [2, 3], spread = 0.6, rad = [0.55, 0.45], count = 46, size = [0.65, 1.0], flowers = 22, flowerSize = [0.4, 0.62], squat = 0.85 } = o;
  const k = n[0] + Math.floor(r() * n[1]);
  for (let i = 0; i < k; i++) {
    const a = r() * Math.PI * 2, d = r() * spread;
    const rr = rad[0] + r() * rad[1];
    clumps.push({ c: V(Math.cos(a) * d, rr * squat * 0.9, Math.sin(a) * d), r: V(rr * 1.15, rr * squat, rr * 1.15) });
  }
  const greens = o.greens || [[C("#7f9850"), C("#3f5a30")], [C("#9aa86a"), C("#55693e")], [C("#6d8a46"), C("#344d2a")]];
  const [top, bottom] = greens[Math.floor(r() * greens.length)];
  const center = V(0, 0.5, 0);
  const crown = { clumps, count, size, center, squash: 1.2, top, bottom, inner: 0.5 };
  foliage(leaves, crown, r);
  if (flowering) {
    const c = C(flowering);
    foliage(leaves, { clumps: clumps.map((q) => ({ c: q.c.clone().add(V(0, 0.08 + (o.spikes || 0), 0)), r: q.r.clone().multiplyScalar(1.02) })), count: flowers, size: flowerSize, center, squash: 1.2, top: c.clone().multiplyScalar(1.05), bottom: c.clone().multiplyScalar(0.7), inner: 0.75, jitter: 0.08 }, r);
  }
  return { leaves: leaves.geometry(), crown, flowering };
}
const MAQUIS = [[C("#5f7a3c"), C("#283f20")], [C("#6f7c4c"), C("#38472a")], [C("#4d6d38"), C("#20361d")], [C("#7b8a55"), C("#3e4c2c")]];
const scrub = (seed, flowering) => bush(seed, flowering, { n: [3, 4], spread: 1.1, rad: [0.6, 0.65], count: 70, size: [0.75, 1.2], flowers: 30, flowerSize: [0.45, 0.7], squat: 0.72, greens: MAQUIS });
const lavender = (seed) => bush(seed, "#8d72d4", { n: [2, 2], spread: 0.2, rad: [0.3, 0.12], count: 26, size: [0.32, 0.5], flowers: 34, flowerSize: [0.24, 0.36], squat: 0.75, spikes: 0.16, greens: [[C("#a3ad8e"), C("#5d6a4e")]] });

// The far version of a plant: a soft lump for each clump of foliage,
// coloured the way the cards are, and a plain trunk under it.
const LUMP_BIG = new THREE.SphereGeometry(1, 7, 4), SMALL_LUMP = new THREE.SphereGeometry(1, 6, 4);
function lumps(t, small = false) {
  const m = new Mesher();
  const LUMP = small ? SMALL_LUMP : LUMP_BIG;
  const { center, squash, top, bottom } = t.crown;
  let { clumps } = t.crown;
  if (small) {
    // a bush far off is one soft shape
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of clumps) {
      x0 = Math.min(x0, c.c.x - c.r.x); x1 = Math.max(x1, c.c.x + c.r.x);
      y0 = Math.min(y0, c.c.y - c.r.y); y1 = Math.max(y1, c.c.y + c.r.y);
      z0 = Math.min(z0, c.c.z - c.r.z); z1 = Math.max(z1, c.c.z + c.r.z);
    }
    clumps = [{ c: V((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), r: V((x1 - x0) / 2 * 0.85, (y1 - y0) / 2, (z1 - z0) / 2 * 0.85) }];
  } else {
    // a tree, its four biggest masses
    clumps = [...clumps].sort((a, b) => b.r.x * b.r.y * b.r.z - a.r.x * a.r.y * a.r.z).slice(0, 4);
  }
  let minY = Infinity, maxY = -Infinity;
  for (const c of clumps) { minY = Math.min(minY, c.c.y - c.r.y); maxY = Math.max(maxY, c.c.y + c.r.y); }
  const p = LUMP.attributes.position, col = new THREE.Color(), q = V(), v = V(), w = V();
  for (const c of clumps) {
    const base = m.count;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      w.set(c.c.x + v.x * c.r.x * 0.9, c.c.y + v.y * c.r.y * 0.9, c.c.z + v.z * c.r.z * 0.9);
      q.subVectors(w, center);
      q.y *= squash;
      q.normalize();
      const n = q.clone().multiplyScalar(0.7).addScaledVector(v, 0.3).normalize();
      const hk = (w.y - minY) / Math.max(0.01, maxY - minY);
      col.copy(bottom).lerp(top, Math.min(1, hk * 0.75 + (q.y * 0.5 + 0.5) * 0.35)).multiplyScalar(0.92);
      m.vert(w, n, col);
    }
    for (let i = 0; i < LUMP.index.count; i++) m.i.push(base + LUMP.index.getX(i));
  }
  if (t.flowering) {
    // a cap of the flower colour over the top
    const fc = C(t.flowering);
    for (const c of clumps) {
      const base = m.count;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        w.set(c.c.x + v.x * c.r.x * 0.95, c.c.y + 0.06 + v.y * c.r.y * 0.95, c.c.z + v.z * c.r.z * 0.95);
        m.vert(w, v.clone(), col.copy(fc).multiplyScalar(0.6 + 0.4 * Math.max(0, v.y)));
      }
      for (let i = 0; i < LUMP.index.count; i += 3) {
        const a = LUMP.index.getX(i), b = LUMP.index.getX(i + 1), d = LUMP.index.getX(i + 2);
        if (p.getY(a) + p.getY(b) + p.getY(d) > 0.9) m.i.push(base + a, base + b, base + d);
      }
    }
  }
  if (t.trunk) {
    const [a, b, rad] = t.trunk;
    tube(m, [a, a.clone().lerp(b, 0.5), b], [rad, rad * 0.85, rad * 0.6], 5, () => C(t.bark));
  }
  return m.geometry();
}

// ------------------------------------------------------------------ planting
const TEX = {};
const tex = (k) => (TEX[k] ??= leafTexture(k, k.length * 17 + 3));

function leafMaterial(kind, sway, flutter, lod) {
  const map = tex(kind);
  const key = `leaf-${kind}-${sway}-${flutter}-${lod}`;
  const defines = { SWAY: sway, FLUTTER: flutter, FOLIAGE: "0.6", WRAP: "0.5" };
  const mat = stylize(new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.04, alphaToCoverage: true }), {
    key, defines: lod ? { ...defines, LOD_NEAR: lod.toFixed(1) } : defines, a2c: true, color: A2C, normal: "normal = normalize(vNormal);",
  });
  return { mat, depth: swayingDepth({ map, defines, key }) };
}
// The far lumps: dappled, so they still read as leaves
function lumpMaterial(lod) {
  return stylize(new THREE.MeshLambertMaterial({ vertexColors: true }), {
    key: `lumps-${lod}`,
    defines: { FOLIAGE: "0.35", WRAP: "0.45", LOD_FAR: lod.toFixed(1), SWAY: "0.002" },
    color: `{
      float n = vnoise3(vWorldP * 0.9) * 0.6 + vnoise3(vWorldP * 2.7) * 0.4;
      diffuseColor.rgb *= 0.74 + 0.48 * n;
      gBump = n * 0.3;
    }`,
  });
}
function barkMaterial(sway, lod) {
  return stylize(new THREE.MeshLambertMaterial({ vertexColors: true }), {
    key: `bark-${sway}-${lod}`,
    defines: { SWAY: sway, CONTACT: "0.9", WRAP: "0.25", ...(lod ? { LOD_NEAR: lod.toFixed(1) } : {}) },
    color: `{
      vec2 bp = vec2(atan(vWorldN.z, vWorldN.x) * 3., vWorldP.y * 2.4);
      float fur = vnoise(vec2(bp.x * 2.2, bp.y * 0.6)) * 0.6 + vnoise(bp * 4.) * 0.4;
      diffuseColor.rgb *= 0.78 + 0.4 * fur;
      gBump = fur * 0.04;
    }`,
  });
}

// Many copies, in patches of ground, so what's off screen isn't drawn; a
// patch is shown between `min` and `far` from the camera.
function patches(scene, parts, list, cell, far, min = -1) {
  const groups = new Map();
  for (const p of list) {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  const chunks = [];
  for (const items of groups.values()) {
    const center = new THREE.Vector3();
    items.forEach((p) => center.add(v.set(p.x, p.y, p.z)));
    center.divideScalar(items.length);
    const meshes = [];
    for (const part of parts) {
      if (!part.geo) continue;
      const im = new THREE.InstancedMesh(part.geo, part.mat, items.length);
      items.forEach((p, i) => {
        e.set(p.tilt || 0, p.ry, p.tilt2 || 0);
        im.setMatrixAt(i, m.compose(v.set(p.x, p.y, p.z), q.setFromEuler(e), s.set(p.s, p.s * (p.sy || 1), p.s)));
        if (part.tint) im.setColorAt(i, c.setRGB(p.tint, p.tint, p.tint * (p.blue || 1)));
      });
      im.computeBoundingSphere();
      im.castShadow = part.shadow !== false;
      im.receiveShadow = true;
      if (part.depth) im.customDepthMaterial = part.depth;
      if (part.reflect) im.layers.enable(1);
      scene.add(im);
      meshes.push(im);
    }
    let reach = 0;
    items.forEach((p) => { reach = Math.max(reach, Math.hypot(p.x - center.x, p.z - center.z)); });
    chunks.push({ center, meshes, far, min: min - reach });
  }
  return chunks;
}

// kinds: pine, cypress, olive, oak, palm, bush, scrub, lavender, far
export function createFlora(scene, plants) {
  const chunks = [];
  // Each kind: its variants, how it moves, and where it changes from leaf
  // cards to lumps (lod) and stops being drawn (far).
  const kinds = {
    pine: { gen: stonePine, seeds: [11, 12, 13], sway: "0.0032", flutter: "0.03", tex: "needle", cell: 110, lod: 240, far: 2600 },
    cypress: { gen: cypress, seeds: [21, 22, 23], sway: "0.0034", flutter: "0.02", tex: "scale", cell: 110, lod: 220, far: 2200 },
    olive: { gen: (s) => olive(s), seeds: [31, 32, 33], sway: "0.006", flutter: "0.035", tex: "leafy", cell: 110, lod: 200, far: 1600 },
    oak: { gen: (s) => olive(s, "oak"), seeds: [41, 42], sway: "0.004", flutter: "0.03", tex: "leafy", cell: 110, lod: 240, far: 2600 },
    palm: { gen: palm, seeds: [51, 52], sway: "0.006", flutter: "0.02", tex: "frond", cell: 120, far: 900 },
  };
  for (const [kind, k] of Object.entries(kinds)) {
    const list = plants.filter((p) => p.kind === kind);
    if (!list.length) continue;
    const variants = k.seeds.map((s) => k.gen(s));
    const leaf = leafMaterial(k.tex, k.sway, k.flutter, k.lod);
    const bark = barkMaterial(k.sway, k.lod);
    const lump = k.lod && lumpMaterial(k.lod);
    variants.forEach((tv, vi) => {
      const mine = list.filter((_, i) => i % variants.length === vi);
      chunks.push(...patches(scene, [
        { geo: tv.wood, mat: bark, reflect: true },
        { geo: tv.leaves, mat: leaf.mat, depth: leaf.depth, tint: true, reflect: true },
      ], mine, k.cell, k.lod ? k.lod + k.cell * 0.75 : k.far));
      if (lump) chunks.push(...patches(scene, [{ geo: lumps(tv), mat: lump, tint: true, shadow: false, reflect: true }], mine, 420, k.far, k.lod - 24));
    });
  }
  // Bushes, plain and in flower; the maquis; lavender
  const shrubs = [
    { kind: "bush", make: (f, i) => bush(61 + i, f), flowers: [null, null, null, "#d9538c", "#f1ede0", "#e8c240", "#b46fd0"],
      pick: (p) => (p.flower ? 3 + (p.flower - 1) % 4 : Math.floor(p.v * 3)), cell: 80, lod: 140, far: 1200 },
    { kind: "scrub", make: (f, i) => scrub(81 + i, f), flowers: [null, null, null, "#e9c53a", "#efd4dc", "#f4efe6"],
      pick: (p) => (p.flower ? 2 + p.flower : Math.floor(p.v * 3)), cell: 80, lod: 130, far: 820 },
    { kind: "lavender", make: (f, i) => lavender(91 + i), flowers: [1, 2],
      pick: (p) => Math.floor(p.v * 2), cell: 60, lod: 70, far: 380 },
  ];
  for (const s of shrubs) {
    const list = plants.filter((p) => p.kind === s.kind);
    if (!list.length) continue;
    const leaf = leafMaterial("leafy", "0.03", "0.02", s.lod);
    const lump = lumpMaterial(s.lod);
    s.flowers.map(s.make).forEach((v, vi) => {
      const mine = list.filter((p) => s.pick(p) === vi);
      if (!mine.length) return;
      chunks.push(...patches(scene, [{ geo: v.leaves, mat: leaf.mat, depth: leaf.depth, tint: true }], mine, s.cell, s.lod + s.cell * 0.75));
      chunks.push(...patches(scene, [{ geo: lumps(v, true), mat: lump, tint: true, shadow: false }], mine, 380, s.far, s.lod - 24));
    });
  }
  // The far hills: dark round trees, just masses of colour at that distance
  const woods = plants.filter((p) => p.kind === "far");
  if (woods.length) {
    const g = new THREE.SphereGeometry(1, 7, 4);
    const p = g.attributes.position, cc = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const k = 0.7 + 0.3 * (p.getY(i) * 0.5 + 0.5); cc.set([k, k, k], i * 3); }
    g.setAttribute("color", new THREE.BufferAttribute(cc, 3));
    g.translate(0, 0.8, 0);
    const mat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, color: "#46613a" }), { key: "far-woods", defines: { WRAP: "0.4" } });
    chunks.push(...patches(scene, [{ geo: g, mat, tint: true, shadow: false, reflect: true }], woods, 400, 6000));
  }
  return {
    chunks,
    // how far out plants are drawn, as a share of the full distance (less on slower machines)
    reach: 1,
    update(cam) {
      for (const c of chunks) {
        const d = c.center.distanceTo(cam);
        const vis = d < c.far * (c.far > 700 ? this.reach : 1) && d > c.min;
        for (const m of c.meshes) m.visible = vis;
      }
    },
  };
}

// ------------------------------------------------------------------ grass
// Two fields of blades that travel with you, one fine and close, one coarse
// out to the middle distance. Each blade finds the ground under it, and how
// thick the grass is there, from the ground data.
const GRASS_COLORS = {
  cDryB: { value: C("#5c5a30") }, cDryT: { value: C("#b9b06e") }, cGrnB: { value: C("#2f4826") }, cGrnT: { value: C("#8aa25c") },
};
export function createGrass() {
  const make = (count, size, segs, o) => {
    const pos = [], idx = [];
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      pos.push(-1, t, 0, 1, t, 0);
    }
    pos.push(0, 1, 0);
    for (let i = 0; i < segs - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const a = (segs - 1) * 2;
    idx.push(a, a + 1, a + 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    const r = rng(o.seed);
    const data = new Float32Array(count * 4);
    const side = Math.ceil(Math.sqrt(count));
    for (let i = 0; i < count; i++) {
      data[i * 4] = ((i % side) + r()) / side;
      data[i * 4 + 1] = (Math.floor(i / side) + r()) / side;
      data[i * 4 + 2] = r();
      data[i * 4 + 3] = r();
    }
    // Shuffle, so drawing fewer of them thins the grass evenly
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      for (let k = 0; k < 4; k++) { const t = data[i * 4 + k]; data[i * 4 + k] = data[j * 4 + k]; data[j * 4 + k] = t; }
    }
    g.setAttribute("aBlade", new THREE.InstancedBufferAttribute(data, 4));
    g.instanceCount = count;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const uniforms = {
      ...GRASS_COLORS,
      uTile: { value: new THREE.Vector4(0, 0, size, 0) },
      uFade: { value: new THREE.Vector4(...o.fade) },
      uDims: { value: new THREE.Vector4(o.width, o.height, o.flowers, o.lean) },
    };
    const mat = stylize(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), {
      key: `grass-${o.seed}`,
      defines: { FOLIAGE: "0.45", WRAP: "0.6" },
      uniforms,
      noiseVertex: true,
      vertexPars: /* glsl */ `
        attribute vec4 aBlade;
        uniform vec4 uTile, uFade, uDims;
        uniform vec3 cDryB, cDryT, cGrnB, cGrnT;
        varying vec3 vGrassCol;
        ${GROUND}`,
      vertexHead: /* glsl */ `
        vec2 rel = aBlade.xy * uTile.z - uTile.xy;
        rel -= uTile.z * floor(rel / uTile.z + 0.5);
        vec2 root = uTile.xy + rel;
        float dist = length(root - cameraPosition.xz);
        vec4 gd = groundData(root);
        vec3 cv = coverData(root);
        float clump = smoothstep(0.2, 0.75, vnoise(root * 0.85 + 3.)) * 1.35;
        float dens = gd.g * mix(0.45, 1.25, clump);
        float fade = smoothstep(uFade.x, uFade.y, dist) * (1. - smoothstep(uFade.z, uFade.w, dist));
        float keep = smoothstep(aBlade.z, aBlade.z + 0.08, dens) * fade;
        float fl = step(1. - uDims.z * (0.2 + 1.6 * smoothstep(0.45, 0.8, vnoise(root * 0.07 + 11.)) + 7. * cv.z), fract(aBlade.w * 13.7)) * step(0.1, gd.g);
        float hgt = uDims.y * gd.b * (0.55 + 0.9 * fract(aBlade.w * 7.31)) * keep * (1. + fl * 0.3);
        float ang = aBlade.w * 6.2831;
        vec2 face = vec2(cos(ang), sin(ang));
        vec2 across = vec2(-face.y, face.x);
        float t = position.y, s = position.x;
        float gust = vnoise(root * 0.045 - uWind * uTime * 0.7) * 0.65 + vnoise(root * 0.14 - uWind * uTime * 1.3) * 0.35;
        float wave = sin(dot(root, uWind) * 0.3 - uTime * 2.4 + gust * 3.);
        vec2 lean = uWind * uGust * (0.1 + 0.85 * gust * gust) * (0.75 + 0.25 * wave) + face * uDims.w;
        vec2 away = root - uPlayer.xz;
        float pd = length(away);
        float push = (1. - smoothstep(0.25, 1.3, pd)) * (1. - smoothstep(0.6, 1.8, abs(uPlayer.y - gd.r)));
        lean += away / max(pd, 0.05) * push * 1.8;
        float bl = length(lean);
        float w = uDims.x * (1. - t * t * 0.8) * (0.7 + 0.6 * aBlade.z);
        float ty = t, head = 0.;
        if (fl > 0.5) {
          // a flower: a thin stalk, and a cup of petals turned up at the top
          head = step(0.6, t);
          w = head > 0. ? 0.05 : 0.005;
          ty = t <= 0.5 ? t * 1.6 : 0.8 + (t - 0.5) * 0.12;
        }
        vec3 gPos = vec3(root.x, gd.r - 0.05, root.y);
        gPos.xz += across * s * w * step(0.001, hgt);
        gPos.xz += face * head * (t - 0.8) * 0.26 * step(0.001, hgt);
        gPos.y += hgt * ty / (1. + bl * bl * 0.35);
        gPos.xz += lean * hgt * t * t;
        vec3 objectNormal = normalize(vec3(face.x * 0.25 + lean.x * 0.35, 1., face.y * 0.25 + lean.y * 0.35));
        vec3 base = mix(cDryB, cGrnB, gd.a), tip = mix(cDryT, cGrnT, gd.a);
        vGrassCol = mix(base, tip, smoothstep(0., 1., t)) * (0.82 + 0.36 * fract(aBlade.w * 3.3)) * (1. + gust * 0.22);
        if (fl > 0.5 && t > 0.6) {
          float k = fract(aBlade.w * 29.1);
          vGrassCol = k < 0.3 ? vec3(0.9, 0.86, 0.75) : k < 0.5 ? vec3(0.95, 0.62, 0.08) : k < 0.68 ? vec3(0.8, 0.07, 0.03) : k < 0.86 ? vec3(0.42, 0.28, 0.75) : vec3(0.85, 0.3, 0.5);
          // a meadow mostly has one flower: poppies here, daisies there
          if (cv.z > 0.2 && fract(aBlade.w * 41.3) < 0.75) {
            float kind = vnoise(root * 0.021 + 3.);
            vGrassCol = kind < 0.42 ? vec3(0.8, 0.07, 0.03) : kind < 0.58 ? vec3(0.95, 0.92, 0.84) : kind < 0.72 ? vec3(0.96, 0.72, 0.1) : vec3(0.5, 0.36, 0.86);
          }
          vGrassCol *= 0.85 + 0.3 * t;
        }`,
      vertexBegin: "vec3 transformed = gPos;",
      fragmentPars: "varying vec3 vGrassCol;",
      color: "diffuseColor.rgb = vGrassCol;",
      normal: "normal = normalize(vNormal);",
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.userData.full = count;
    return { mesh, uniforms };
  };
  const near = make(90000, 36, 4, { seed: 7, fade: [-1, 0, 12, 17], width: 0.034, height: 0.5, flowers: 0, lean: 0.12 });
  const far = make(70000, 140, 3, { seed: 8, fade: [11, 16, 46, 66], width: 0.1, height: 0.55, flowers: 0.02, lean: 0.12 });
  const bloom = flowers(26000, 34);
  const all = [near, far, bloom];
  return {
    meshes: all.map((m) => m.mesh),
    update(cam) {
      for (const m of all) { m.uniforms.uTile.value.x = cam.x; m.uniforms.uTile.value.y = cam.z; }
    },
    set density(k) {
      for (const { mesh } of all) mesh.geometry.instanceCount = Math.floor(mesh.userData.full * k);
    },
  };
}

// The small stuff underfoot, near you: pebbles and bits of shell on the
// beach (and under the clear water at its edge), stones kicked up along the
// paths and scattered down the steep ground. Like the grass, a field of them
// travels with you and each one finds what kind of ground it's on.
export function createClutter(count = 7000, size = 26) {
  const base = new THREE.IcosahedronGeometry(1, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(base.index);
  g.setAttribute("position", base.attributes.position);
  g.setAttribute("normal", base.attributes.normal);
  const r = rng(13);
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) data.set([r(), r(), r(), r()], i * 4);
  g.setAttribute("aBlade", new THREE.InstancedBufferAttribute(data, 4));
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const uniforms = { uTile: { value: new THREE.Vector4(0, 0, size, 0) } };
  const mat = stylize(new THREE.MeshLambertMaterial(), {
    key: "clutter",
    defines: { WRAP: "0.2", RIM: "0.15", CLUTTER_TILE: size.toFixed(1) },
    uniforms,
    noiseVertex: true,
    vertexPars: /* glsl */ `
      attribute vec4 aBlade;
      uniform vec4 uTile;
      varying vec3 vClutterCol;
      ${GROUND}`,
    vertexHead: /* glsl */ `
      vec2 rel = aBlade.xy * uTile.z - uTile.xy;
      rel -= uTile.z * floor(rel / uTile.z + 0.5);
      vec2 root = uTile.xy + rel;
      float dist = length(root - cameraPosition.xz);
      vec4 gd = groundData(root);
      vec4 sf = surfaceData(root);
      float h = gd.r;
      float beach = sf.x * step(-1.6, h) * (1. - smoothstep(2.6, 3.4, h));
      float path = sf.y * (1. - beach);
      float steep = smoothstep(0.32, 0.55, sf.z) * (1. - beach) * step(0.4, h);
      float wild = step(0.4, h) * (1. - beach) * (1. - path) * (1. - steep);
      float want = beach * (0.16 + 0.5 * (1. - sf.x) + 0.25 * smoothstep(0.3, -0.6, h)) + path * 0.4 + steep * 0.36 + wild * (0.02 + 0.05 * sf.w);
      want *= 0.5 + 0.9 * smoothstep(0.35, 0.75, vnoise(root * 0.6 + 2.));
      float keep = step(aBlade.z, want) * (1. - smoothstep(CLUTTER_TILE * 0.32, CLUTTER_TILE * 0.48, dist));
      float k = fract(aBlade.w * 17.3);
      float shell = beach * step(0.93, k) * step(0.2, h);
      float s = mix(0.035, 0.12, pow(fract(aBlade.w * 5.7), 1.6)) * mix(1., 1.9, steep) * mix(1., 0.7, shell) * keep;
      float ang = aBlade.w * 6.2831;
      mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
      vec3 lp = position * vec3(1., mix(0.45, 0.22, shell), 0.8 + 0.4 * fract(aBlade.w * 3.1)) * s;
      lp.xz = rot * lp.xz;
      vec3 gPos = vec3(root.x, h - s * 0.12, root.y) + lp;
      vec3 objectNormal = normalize(vec3(rot * (normal.xz / vec2(1., 0.8)), normal.y / mix(0.45, 0.22, shell)).xzy);
      float tone = 0.75 + 0.45 * fract(aBlade.w * 11.9);
      vec3 stone = mix(vec3(0.78, 0.74, 0.66), vec3(0.55, 0.53, 0.5), fract(aBlade.w * 23.1)) * tone;
      vClutterCol = shell > 0.5 ? mix(vec3(0.9, 0.86, 0.8), vec3(0.88, 0.7, 0.64), step(0.5, fract(aBlade.w * 31.))) : stone * mix(vec3(1.), vec3(0.92, 0.86, 0.76), beach);
      vClutterCol *= h < 0.05 ? vec3(0.8, 0.86, 0.84) : vec3(1.);`,
    vertexBegin: "vec3 transformed = gPos;",
    fragmentPars: "varying vec3 vClutterCol;",
    color: "diffuseColor.rgb = vClutterCol;",
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.userData.full = count;
  return {
    mesh,
    update(cam) { uniforms.uTile.value.x = cam.x; uniforms.uTile.value.y = cam.z; },
    set density(k) { g.instanceCount = Math.floor(count * k); },
  };
}

// Wildflowers near you: a stalk and a head of petals, turned up to the
// sun, in drifts of one kind (poppies here, daisies there) through the
// meadows, and a few anywhere the grass grows.
function flowers(count, size) {
  const pos = [], part = [], idx = [];
  const w = 0.0045;
  // the stalk, two crossed strips
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    const b = pos.length / 3;
    pos.push(-w * ax, 0, -w * az, w * ax, 0, w * az, -w * ax, 1, -w * az, w * ax, 1, w * az);
    part.push(0, 0, 0, 0);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  // the head: a centre and a ring of petals, cupped
  const c0 = pos.length / 3;
  pos.push(0, 1, 0);
  part.push(2);
  const P = 12;
  for (let i = 0; i < P; i++) {
    const a = (i / P) * Math.PI * 2, rr = i % 2 ? 0.66 : 1;
    pos.push(Math.cos(a) * rr, 1 + 0.32 * rr, Math.sin(a) * rr);
    part.push(1);
  }
  for (let i = 0; i < P; i++) idx.push(c0, c0 + 1 + i, c0 + 1 + ((i + 1) % P));
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute("aPart", new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  const r = rng(9);
  const data = new Float32Array(count * 4);
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    data[i * 4] = ((i % side) + r()) / side;
    data[i * 4 + 1] = (Math.floor(i / side) + r()) / side;
    data[i * 4 + 2] = r();
    data[i * 4 + 3] = r();
  }
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    for (let k = 0; k < 4; k++) { const t = data[i * 4 + k]; data[i * 4 + k] = data[j * 4 + k]; data[j * 4 + k] = t; }
  }
  g.setAttribute("aBlade", new THREE.InstancedBufferAttribute(data, 4));
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const uniforms = { uTile: { value: new THREE.Vector4(0, 0, size, 0) } };
  const mat = stylize(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), {
    key: "flowers",
    defines: { FOLIAGE: "0.7", WRAP: "0.5", FLOWER_TILE: size.toFixed(1) },
    uniforms,
    noiseVertex: true,
    vertexPars: /* glsl */ `
      attribute vec4 aBlade;
      attribute float aPart;
      uniform vec4 uTile;
      varying vec3 vFlowerCol;
      ${GROUND}`,
    vertexHead: /* glsl */ `
      vec2 rel = aBlade.xy * uTile.z - uTile.xy;
      rel -= uTile.z * floor(rel / uTile.z + 0.5);
      vec2 root = uTile.xy + rel;
      float dist = length(root - cameraPosition.xz);
      vec4 gd = groundData(root);
      vec3 cv = coverData(root);
      float want = (cv.z * 0.85 + 0.035) * smoothstep(0.08, 0.3, gd.g) * (0.4 + 0.6 * smoothstep(0.3, 0.7, vnoise(root * 0.18 + 5.)));
      float keep = step(aBlade.z, want) * (1. - smoothstep(FLOWER_TILE * 0.32, FLOWER_TILE * 0.48, dist));
      float hgt = (0.28 + 0.34 * fract(aBlade.w * 7.31)) * gd.b * keep;
      float hs = (0.03 + 0.03 * fract(aBlade.w * 3.7)) * keep;
      // which flower: mostly the meadow's own, sometimes any
      float kind = cv.z > 0.15 && fract(aBlade.w * 41.3) < 0.8 ? vnoise(root * 0.021 + 3.) : fract(aBlade.w * 29.1);
      vec3 petal = kind < 0.42 ? vec3(0.82, 0.06, 0.03) : kind < 0.58 ? vec3(0.95, 0.93, 0.86) : kind < 0.72 ? vec3(0.98, 0.74, 0.08) : kind < 0.86 ? vec3(0.42, 0.34, 0.9) : vec3(0.9, 0.42, 0.62);
      vec3 heart = kind < 0.42 ? vec3(0.06, 0.04, 0.05) : kind < 0.72 ? vec3(0.95, 0.65, 0.05) : vec3(0.95, 0.9, 0.7);
      vec2 away = root - uPlayer.xz;
      float pd = length(away);
      float push = (1. - smoothstep(0.25, 1.1, pd)) * (1. - smoothstep(0.6, 1.8, abs(uPlayer.y - gd.r)));
      float gust = vnoise(root * 0.045 - uWind * uTime * 0.7);
      vec2 lean = uWind * uGust * (0.12 + 0.5 * gust) * (0.8 + 0.2 * sin(uTime * 2.3 + aBlade.w * 40.)) + away / max(pd, 0.05) * push * 1.6;
      float ang = aBlade.w * 6.2831;
      vec2 tilt = vec2(cos(ang), sin(ang)) * 0.25 + lean * 0.6;
      vec3 gPos;
      vec3 objectNormal;
      if (aPart < 0.5) {
        gPos = vec3(root.x + position.x, gd.r - 0.03 + position.y * hgt, root.y + position.z);
        gPos.xz += lean * hgt * position.y * position.y;
        objectNormal = normalize(vec3(position.x, 0.3, position.z) + vec3(0.001));
        vFlowerCol = vec3(0.2, 0.34, 0.12);
      } else {
        vec3 l = vec3(position.x, position.y - 1., position.z) * hs;
        l.y += dot(l.xz, tilt) * 0.8;
        gPos = vec3(root.x, gd.r - 0.03 + hgt, root.y) + l;
        gPos.xz += lean * hgt;
        objectNormal = normalize(vec3(-tilt.x, 1., -tilt.y));
        vFlowerCol = aPart > 1.5 ? heart : petal * (0.85 + 0.25 * fract(aBlade.w * 11.1));
      }`,
    vertexBegin: "vec3 transformed = gPos;",
    fragmentPars: "varying vec3 vFlowerCol;",
    color: "diffuseColor.rgb = vFlowerCol;",
    normal: "normal = normalize(vNormal);",
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.userData.full = count;
  return { mesh, uniforms };
}
