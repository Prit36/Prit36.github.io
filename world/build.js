import * as THREE from "three";
import { rng, noise, smooth, field, heightAt, slopeAt, addSolid, pathDist, clearGround, ISLANDS, PATHS, TERRAIN, LIMESTONE } from "./land.js";
import { stylize, U, NOISE, FOG } from "./style.js";

// Everything built on the bay: the village with its windows and shutters,
// balconies and flower boxes, the church and its bell tower, the lighthouse
// and the keeper's house, the harbour with its jetty and boats, a café and a
// market on the plaza, the beach, and the rocks all along the shore.
// Buildings are merged into one mesh; each part says what it's made of
// (plaster, stone, tiles, wood, shutters) and the shader paints that.

const r = rng(2026);
const hex = (c) => new THREE.Color(c);
const pick = (list) => list[Math.floor(r() * list.length)];
const M = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")), new THREE.Vector3(sx, sy, sz));

// What a part is made of
const PLAIN = 0, PLASTER = 1, STONE = 2, TILE = 3, WOOD = 4, LOUVRE = 5, PAVING = 6, METAL = 7, CLOTH = 8;

// A bag of parts, merged into one geometry at the end.
export class Kit {
  constructor() { this.parts = []; }
  put(geo, color, m, kind = PLAIN) {
    const src = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(src.attributes)) if (k !== "position" && k !== "normal") src.deleteAttribute(k);
    const g = src.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = typeof color === "string" ? hex(color) : color, n = g.attributes.position.count;
    const a = new Float32Array(n * 3), kd = new Float32Array(n).fill(kind);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    g.setAttribute("aKind", new THREE.BufferAttribute(kd, 1));
    this.parts.push(g);
    return g;
  }
  geometry() {
    const total = this.parts.reduce((s, g) => s + g.attributes.position.count, 0);
    const out = new THREE.BufferGeometry();
    for (const [name, size] of [["position", 3], ["normal", 3], ["color", 3], ["aKind", 1]]) {
      const arr = new Float32Array(total * size);
      let o = 0;
      for (const g of this.parts) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
      out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    for (const g of this.parts) g.dispose();
    this.parts = [];
    out.computeBoundingSphere();
    return out;
  }
}

// The one material for everything built: plaster with weather in it, stone
// laid in courses, barrel tiles in rows, planks with grain, louvred shutters.
export function builtMaterial(o = {}) {
  return stylize(new THREE.MeshLambertMaterial({ vertexColors: true, side: o.side || THREE.FrontSide }), {
    key: `built-${o.key || "solid"}`,
    defines: { CONTACT: "1.4", RIM: "0.12", WRAP: "0.08", ...(o.defines || {}) },
    vertexPars: "attribute float aKind;\nvarying float vKind;",
    vertex: "vKind = aKind;",
    fragmentPars: "varying float vKind;",
    color: /* glsl */ `{
      int kind = int(vKind + 0.5);
      vec3 P = vWorldP;
      vec3 Nw = normalize(vWorldN);
      vec3 an = abs(Nw);
      float detail = 1. - smoothstep(25., 170., length(P - cameraPosition));
      vec2 fuv = an.y > 0.75 ? P.xz : (an.x > an.z ? P.zy : P.xy);
      vec3 col = diffuseColor.rgb;
      if (kind == 1) {
        float m = vnoise(fuv * 0.8) * 0.55 + vnoise(fuv * 3.3) * 0.3 + vnoise(fuv * 10.) * 0.15;
        col *= 0.9 + 0.17 * m;
        float streak = vnoise(vec2(fuv.x * 2.7, fuv.y * 0.22));
        col *= 1. - 0.08 * smoothstep(0.55, 0.92, streak);
        gBump = (vnoise(fuv * 13.) * 0.007 + vnoise(fuv * 2.6) * 0.018) * detail;
      } else if (kind == 2) {
        vec2 b = fuv * vec2(2.1, 3.6);
        float row = floor(b.y);
        b.x += hash11(row) * 7.;
        vec2 id = floor(b), f = fract(b);
        vec2 e = min(f, 1. - f) / vec2(2.1, 3.6);
        float mortar = 1. - smoothstep(0.007, 0.02, min(e.x, e.y));
        col *= mix(0.84 + 0.3 * hash12(id), 0.66, mortar * detail);
        col *= 0.95 + 0.1 * vnoise(fuv * 6.);
        gBump = ((1. - mortar) * 0.03 + vnoise(fuv * 9.) * 0.008) * detail;
      } else if (kind == 3) {
        vec3 tU = normalize(cross(vec3(0., 1., 0.), Nw) + vec3(1e-4, 0., 0.));
        vec3 tV = cross(Nw, tU);
        float u = dot(P, tU) * 4.3, v = dot(P, tV) * 3.1;
        float ch = floor(u);
        float rf = fract(v + hash11(ch) * 0.25);
        float rib = fract(u) * 2. - 1.;
        float barrel = 1. - rib * rib;
        float lip = smoothstep(0.76, 1., rf);
        col *= (0.8 + 0.32 * hash12(vec2(ch, floor(v + hash11(ch) * 0.25)))) * mix(0.8, 1.07, barrel) * (1. - lip * 0.32 * detail);
        col = mix(col, col * vec3(0.78, 0.82, 0.66), smoothstep(0.62, 0.85, vnoise(P.xz * 0.5)) * 0.45);
        gBump = (barrel * 0.05 + rf * 0.025) * detail;
      } else if (kind == 4) {
        vec2 w = an.y > 0.75 ? P.xz : fuv;
        float plank = floor(w.x * 6.5);
        float grain = vnoise(vec2(w.x * 40., w.y * 2.5 + plank * 3.));
        float gap = smoothstep(0.9, 0.98, fract(w.x * 6.5));
        col *= (0.86 + 0.22 * hash11(plank)) * (0.88 + 0.18 * grain) * (1. - gap * 0.45 * detail);
        gBump = (grain * 0.01 - gap * 0.02) * detail;
      } else if (kind == 5) {
        float sl = fract(P.y * 9.);
        col *= 0.78 + 0.3 * smoothstep(0.05, 0.55, sl) - 0.18 * smoothstep(0.85, 1., sl);
        gBump = sl * 0.025 * detail;
      } else if (kind == 6) {
        vec2 tp = P.xz * 1.6;
        vec2 f = fract(tp);
        float edge = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y));
        col *= mix(0.84 + 0.26 * hash12(floor(tp)), 0.68, (1. - smoothstep(0.02, 0.06, edge)) * detail);
      } else if (kind == 8) {
        col *= 0.9 + 0.1 * vnoise(fuv * 5.);
      }
      diffuseColor.rgb = col;
    }`,
  });
}

// Triangles turned to face outward, away from a point under the roof.
function shell(tris) {
  const pos = [];
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const [p, q, w] of tris) {
    a.fromArray(p); b.fromArray(q); c.fromArray(w);
    const n = v.subVectors(b, a).cross(c.clone().sub(a));
    const mid = a.clone().add(b).add(c).divideScalar(3).sub(new THREE.Vector3(0, -1, 0));
    if (n.dot(mid) < 0) pos.push(...p, ...w, ...q); else pos.push(...p, ...q, ...w);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
// A hip roof over a w × d footprint, rising by `rise` to a ridge along the long side.
function hipRoof(w, d, rise) {
  if (w < d) return hipRoof(d, w, rise).rotateY(Math.PI / 2);
  const hw = w / 2, hd = d / 2, rl = hw - hd;
  const A = [-rl, rise, 0], B = [rl, rise, 0];
  const c = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd]];
  const tris = [[c[0], A, c[1]], [A, B, c[1]], [c[2], B, c[3]], [B, A, c[3]], [c[3], A, c[0]], [c[1], B, c[2]]];
  return shell(tris);
}
// The lines along a hip roof's ridge and hips, for the capping tiles.
function hipLines(w, d, rise) {
  const swap = w < d;
  const W2 = Math.max(w, d) / 2, D2 = Math.min(w, d) / 2, rl = W2 - D2;
  const pts = [[[-rl, rise, 0], [rl, rise, 0]], [[-W2, 0, -D2], [-rl, rise, 0]], [[-W2, 0, D2], [-rl, rise, 0]], [[W2, 0, -D2], [rl, rise, 0]], [[W2, 0, D2], [rl, rise, 0]]];
  return pts.map(([a, b]) => (swap ? [[a[2], a[1], -a[0]], [b[2], b[1], -b[0]]] : [a, b]));
}
// A gable roof with its ridge along z.
function gableRoof(w, d, rise) {
  const hw = w / 2, hd = d / 2;
  const a = [-hw, 0, -hd], b = [hw, 0, -hd], c = [hw, 0, hd], e = [-hw, 0, hd], f = [0, rise, -hd], g = [0, rise, hd];
  return shell([[a, f, g], [a, g, e], [b, c, g], [b, g, f]]);
}
// A triangle of wall, for a gable end
function gableEnd(w, rise, depth = 0.3) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, rise); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const CYL8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6);
const BALL = new THREE.IcosahedronGeometry(1, 1);
const ARCH = new THREE.TorusGeometry(1, 0.12, 4, 12, Math.PI);

// A line of something between two points (a capping ridge, a rope, a rail)
const beam = (kit, a, b, w, h, color, kind) => {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B), mid = A.clone().add(B).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.clone().sub(A).normalize());
  kit.put(BOX, color, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(w, h, len)), kind);
};

const WALLS = ["#f3e6cb", "#efd7ae", "#f5ecda", "#ebcfa2", "#f2d8bb", "#e9d3b0", "#f7f1e3", "#efcea6", "#f0dcc4", "#e6c39a"];
const ROOFS = ["#c8623a", "#cf703f", "#bb5633", "#d27a49", "#c45c3b", "#b85e3e", "#c96a43"];
const SHUTTERS = ["#4f7d63", "#46708f", "#6b8c5a", "#3f6577", "#7a5a3f", "#5d8aa0", "#8a9a5b"];
const TRIM = ["#e9dfcb", "#ddd0b5", "#f1e9d8", "#d8c7a7"];
const FLOWERS = ["#d8457a", "#e8506a", "#f2efe4", "#c43c58", "#e88cb2", "#f0b13a", "#a14fd0"];

export function buildWorld(scene) {
  const kit = new Kit();          // everything built, in one mesh
  const cloth = new Kit();        // things that flap: washing, awnings, sails
  const windows = [];             // [x, y, z, rot, w, h, lit, shape]
  const glows = [];               // [x, y, z, size, r, g, b, kind]
  const lamps = [];               // street lamps: [x, y, z]
  const plants = [];              // trees and bushes for the flora
  const foam = [];                // [x, z, radius] things standing in the sea
  const places = {};
  const footprints = [];          // [x, z, radius]: keep trees off these
  const clear = (x, z, rad) => footprints.every(([fx, fz, fr]) => Math.hypot(x - fx, z - fz) > fr + rad);
  const claim = (x, z, rad, grass = 0) => { footprints.push([x, z, rad]); clearGround(x, z, rad, grass); };

  // A frame at (x, z) turned by rot: local (lx, lz) to world
  const frame = (x, z, rot) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return { c, s, at: (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz] };
  };
  // Something flat against a wall facing `rot`: `along` it, `up`, `out` from it
  const onWall = (wx, wz, rot, along, out) => [wx + Math.cos(rot) * along + Math.sin(rot) * out, wz - Math.sin(rot) * along + Math.cos(rot) * out];

  // A window: stone surround, sill, glass (lit at night) and shutters.
  const windowAt = (wx, y, wz, rot, w, h, o = {}) => {
    const { shutter, trim = "#e6dcc6", lit = r() < 0.55, shape = 0, box = r() < 0.22 } = o;
    const state = shutter ? (r() < 0.72 ? "open" : r() < 0.6 ? "closed" : "none") : "none";
    const put = (along, yy, out, sx, sy, sz, color, kind) => {
      const [px, pz] = onWall(wx, wz, rot, along, out);
      kit.put(BOX, color, M(px, yy, pz, rot, sx, sy, sz), kind);
    };
    put(0, y + h / 2 + 0.09, 0.04, w + 0.3, 0.18, 0.1, trim, STONE);
    put(0, y - h / 2 - 0.05, 0.08, w + 0.34, 0.1, 0.2, trim, STONE);
    put(-w / 2 - 0.06, y, 0.03, 0.12, h, 0.08, trim, STONE);
    put(w / 2 + 0.06, y, 0.03, 0.12, h, 0.08, trim, STONE);
    if (state === "closed") {
      put(-w / 4, y, 0.05, w / 2 - 0.01, h, 0.05, shutter, LOUVRE);
      put(w / 4, y, 0.05, w / 2 - 0.01, h, 0.05, shutter, LOUVRE);
      return;
    }
    const [gx, gz] = onWall(wx, wz, rot, 0, 0.035);
    windows.push([gx, y, gz, rot, w, h, lit ? 1 : 0, shape]);
    if (lit) {
      const [lx, lz] = onWall(wx, wz, rot, 0, 0.6);
      glows.push([lx, y, lz, 2.4, 1, 0.66, 0.32, 0]);
    }
    if (state === "open") {
      put(-w / 2 - 0.13 - w / 4, y, 0.06, w / 2, h, 0.05, shutter, LOUVRE);
      put(w / 2 + 0.13 + w / 4, y, 0.06, w / 2, h, 0.05, shutter, LOUVRE);
    }
    if (box) {
      put(0, y - h / 2 - 0.2, 0.22, w + 0.1, 0.22, 0.24, "#a9673f", WOOD);
      const fc = pick(FLOWERS);
      for (let k = 0; k < 5; k++) {
        const [fx, fz] = onWall(wx, wz, rot, (k / 4 - 0.5) * w, 0.26 + r() * 0.06);
        kit.put(BALL, k % 2 ? fc : "#5b7d3a", M(fx, y - h / 2 + 0.02 + r() * 0.06, fz, r() * 3, 0.13, 0.11, 0.13), PLAIN);
      }
    }
  };

  // A door with a stone frame, a step, and a lamp beside it.
  const doorAt = (wx, y, wz, rot, o = {}) => {
    const { color = pick(["#5b4636", "#3f5f6e", "#6b3f2f", "#4c6a52", "#7a5a3f"]), w = 1.05, h = 2.15, arch = r() < 0.4, lamp = r() < 0.5 } = o;
    const put = (along, yy, out, sx, sy, sz, c, kind, geo = BOX, rx = 0) => {
      const [px, pz] = onWall(wx, wz, rot, along, out);
      kit.put(geo, c, M(px, yy, pz, rot, sx, sy, sz, rx), kind);
    };
    put(0, y + h / 2, 0.03, w, h, 0.08, color, WOOD);
    put(-w / 2 - 0.1, y + h / 2, 0.05, 0.18, h + 0.1, 0.12, "#e3d8c2", STONE);
    put(w / 2 + 0.1, y + h / 2, 0.05, 0.18, h + 0.1, 0.12, "#e3d8c2", STONE);
    if (arch) put(0, y + h, 0.05, w / 2 + 0.1, w / 2 + 0.1, 1.2, "#e3d8c2", STONE, ARCH);
    else put(0, y + h + 0.1, 0.05, w + 0.4, 0.2, 0.14, "#e3d8c2", STONE);
    put(0, y + 0.08, 0.35, w + 0.6, 0.16, 0.7, "#d8cdb6", STONE);
    if (lamp) {
      put(w / 2 + 0.45, y + h + 0.15, 0.18, 0.18, 0.28, 0.18, "#2e2a26", METAL);
      const [lx, lz] = onWall(wx, wz, rot, w / 2 + 0.45, 0.2);
      windows.push([lx, y + h + 0.15, lz, rot, 0.12, 0.2, 1, 3]);
      glows.push([lx, y + h + 0.15, lz, 3.4, 1, 0.7, 0.36, 0]);
    }
  };

  // A balcony: a slab, iron railings and pots of geraniums.
  const balcony = (wx, y, wz, rot, w) => {
    const put = (along, yy, out, sx, sy, sz, c, kind, geo = BOX) => {
      const [px, pz] = onWall(wx, wz, rot, along, out);
      kit.put(geo, c, M(px, yy, pz, rot, sx, sy, sz), kind);
    };
    put(0, y, 0.55, w, 0.14, 1.1, "#e6dcc7", STONE);
    put(0, y - 0.12, 0.5, w - 0.2, 0.1, 0.9, "#d8ccb3", STONE);
    put(0, y + 0.95, 1.06, w, 0.05, 0.05, "#2b2a28", METAL);
    put(-w / 2 + 0.02, y + 0.95, 0.55, 0.05, 0.05, 1.05, "#2b2a28", METAL);
    put(w / 2 - 0.02, y + 0.95, 0.55, 0.05, 0.05, 1.05, "#2b2a28", METAL);
    for (let a = -w / 2 + 0.06; a <= w / 2; a += 0.13) put(a, y + 0.5, 1.06, 0.025, 0.9, 0.025, "#2b2a28", METAL);
    for (const o of [0.25, 0.85]) for (const a of [-w / 2 + 0.06, w / 2 - 0.06]) put(a, y + 0.5, o, 0.025, 0.9, 0.025, "#2b2a28", METAL);
    const fc = pick(FLOWERS);
    for (let k = 0; k < 3; k++) {
      const a = (k - 1) * w * 0.32;
      put(a, y + 0.22, 0.85, 0.16, 0.3, 0.16, "#b5653c", PLAIN, CYL8);
      put(a, y + 0.45, 0.85, 0.24, 0.2, 0.24, k % 2 ? "#4f7436" : fc, PLAIN, BALL);
    }
  };

  // A house on the slope. Its walls go down into the hill, so it never floats.
  const house = (x, z, w, d, rot, stories, opt = {}) => {
    const F = frame(x, z, rot);
    const corner = (sx, sz) => heightAt(...F.at((sx * w) / 2, (sz * d) / 2));
    const hs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const lo = Math.min(...hs), hi = Math.max(...hs);
    const FH = 3;
    const eave = lo + Math.max(stories * FH, hi - lo + 3.2) + 0.2;
    const base = lo - 2.5;
    const wall = opt.wall || pick(WALLS), roof = opt.roof || pick(ROOFS), shutter = opt.shutter ?? pick(SHUTTERS), trim = pick(TRIM);
    kit.put(BOX, wall, M(x, (base + eave) / 2, z, rot, w, eave - base, d), PLASTER);
    kit.put(BOX, "#cdbb9b", M(x, (base + lo + 0.55) / 2, z, rot, w + 0.12, lo + 0.55 - base, d + 0.12), STONE);
    // Corner stones
    if (r() < 0.45) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        for (let y = lo + 0.6, k = 0; y < eave - 0.3; y += 0.36, k++) {
          const lw = k % 2 ? 0.55 : 0.32, ld = k % 2 ? 0.32 : 0.55;
          const [qx, qz] = F.at((sx * w) / 2 - (sx * lw) / 2 + sx * 0.02, (sz * d) / 2 - (sz * ld) / 2 + sz * 0.02);
          kit.put(BOX, trim, M(qx, y + 0.17, qz, rot, lw, 0.32, ld), STONE);
        }
      }
    }
    // Bands between the floors, and a cornice under the eaves
    if (stories > 1 && r() < 0.55) {
      for (let k = 1; k < stories; k++) kit.put(BOX, trim, M(x, lo + k * FH + 0.05, z, rot, w + 0.12, 0.14, d + 0.12), STONE);
    }
    kit.put(BOX, trim, M(x, eave - 0.12, z, rot, w + 0.24, 0.24, d + 0.24), STONE);
    kit.put(BOX, trim, M(x, eave + 0.03, z, rot, w + 0.42, 0.08, d + 0.42), STONE);
    const flat = opt.flat ?? r() < 0.2;
    let top;
    if (flat) {
      kit.put(BOX, "#d9c9ad", M(x, eave + 0.12, z, rot, w + 0.3, 0.2, d + 0.3), PAVING);
      for (const [ox, oz, pw, pd] of [[0, d / 2, w + 0.3, 0.2], [0, -d / 2, w + 0.3, 0.2], [w / 2, 0, 0.2, d + 0.3], [-w / 2, 0, 0.2, d + 0.3]]) {
        const [px, pz] = F.at(ox, oz);
        kit.put(BOX, wall, M(px, eave + 0.55, pz, rot, pw, 0.7, pd), PLASTER);
        kit.put(BOX, trim, M(px, eave + 0.93, pz, rot, pw + 0.06, 0.07, pd + 0.06), STONE);
      }
      if (r() < 0.7) {
        // a pergola with a vine over it, and a table under it
        for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const [px, pz] = F.at(ox * w * 0.3, oz * d * 0.25);
          kit.put(CYL6, "#7d6248", M(px, eave + 1.3, pz, 0, 0.07, 2.4, 0.07), WOOD);
        }
        for (const oz of [-1, 0, 1]) {
          const [px, pz] = F.at(0, oz * d * 0.25);
          kit.put(BOX, "#7d6248", M(px, eave + 2.5, pz, rot, w * 0.64, 0.08, 0.08), WOOD);
        }
        const [vx, vz] = F.at(0, 0);
        plants.push({ kind: "bush", x: vx, y: eave + 2.2, z: vz, s: 1.3, sy: 0.35, ry: rot, v: r(), flower: r() < 0.5 ? 1 : 0, tint: 1 });
        const [tx, tz] = F.at(0.4, 0.3);
        kit.put(CYL, "#e8e1d2", M(tx, eave + 0.95, tz, 0, 0.45, 0.05, 0.45), PLAIN);
        kit.put(CYL6, "#4a4642", M(tx, eave + 0.6, tz, 0, 0.05, 0.7, 0.05), METAL);
      }
      for (let k = 0; k < 3; k++) {
        const [px, pz] = F.at((r() - 0.5) * w * 0.8, d / 2 - 0.5);
        kit.put(CYL8, "#b5653c", M(px, eave + 0.45, pz, 0, 0.22, 0.45, 0.22), PLAIN);
        kit.put(BALL, k % 2 ? pick(FLOWERS) : "#55783a", M(px, eave + 0.8, pz, 0, 0.32, 0.28, 0.32), PLAIN);
      }
      top = eave + 0.22;
    } else {
      const rise = Math.min(w, d) * 0.24;
      const RW = w + 0.9, RD = d + 0.9;
      kit.put(hipRoof(RW, RD, rise), roof, M(x, eave + 0.08, z, rot), TILE);
      // the roof's edge, and capping tiles along the ridge and hips
      for (const [ox, oz, pw, pd] of [[0, RD / 2, RW, 0.1], [0, -RD / 2, RW, 0.1], [RW / 2, 0, 0.1, RD], [-RW / 2, 0, 0.1, RD]]) {
        const [px, pz] = F.at(ox, oz);
        kit.put(BOX, hex(roof).multiplyScalar(0.8), M(px, eave + 0.04, pz, rot, pw, 0.14, pd), TILE);
      }
      for (const [a, b] of hipLines(RW, RD, rise)) {
        const [ax, az] = F.at(a[0], a[2]), [bx, bz] = F.at(b[0], b[2]);
        beam(kit, [ax, eave + 0.1 + a[1], az], [bx, eave + 0.1 + b[1], bz], 0.2, 0.14, hex(roof).multiplyScalar(0.88), TILE);
      }
      if (r() < 0.65) {
        const [cx, cz] = F.at((r() - 0.5) * w * 0.5, (r() - 0.5) * d * 0.3);
        const ch = eave + rise * 0.7 + 1.1;
        kit.put(BOX, wall, M(cx, ch - 0.6, cz, rot, 0.6, 1.8, 0.6), PLASTER);
        kit.put(BOX, trim, M(cx, ch + 0.33, cz, rot, 0.78, 0.1, 0.78), STONE);
        kit.put(hipRoof(0.7, 0.7, 0.22), roof, M(cx, ch + 0.5, cz, rot), TILE);
        for (const k of [-1, 1]) {
          const [px, pz] = [cx + Math.cos(rot) * k * 0.2, cz - Math.sin(rot) * k * 0.2];
          kit.put(BOX, "#b5653c", M(px, ch + 0.42, pz, rot, 0.12, 0.14, 0.5), PLAIN);
        }
      }
      const hs2 = Math.min(w, d) / 2 + 0.45;
      top = (lx, lz) => eave + 0.08 + rise * Math.max(0, Math.min((w / 2 + 0.45 - Math.abs(lx)) / hs2, (d / 2 + 0.45 - Math.abs(lz)) / hs2, 1));
    }
    addSolid({ x, z, hw: w / 2, hd: d / 2, rot, top, surf: "roof" });
    claim(x, z, Math.hypot(w, d) / 2 + 0.9);
    // Windows, on every wall that stands above the ground there; a door
    // on the side that faces down the hill, and maybe a balcony over it
    const faces = [[0, d / 2, w, 0], [0, -d / 2, w, Math.PI], [w / 2, 0, d, Math.PI / 2], [-w / 2, 0, d, -Math.PI / 2]];
    let doorDone = false;
    for (const [fx, fz, len, face] of faces) {
      const n = Math.max(1, Math.floor(len / 2.6));
      const frot = rot + face;
      const front = face === 0;
      const doorSlot = front ? Math.floor(r() * n) : -1;
      const balconySlot = front && stories > 1 && r() < 0.4 ? Math.floor(r() * n) : -1;
      for (let k = 0; k < n; k++) {
        const o = (k - (n - 1) / 2) * (len / n);
        const lx = fx + (face === 0 || face === Math.PI ? (face === 0 ? o : -o) : 0);
        const lz = fz + (face === 0 || face === Math.PI ? 0 : (face === Math.PI / 2 ? -o : o));
        const [wx, wz] = F.at(lx, lz);
        const out = [wx + Math.sin(frot) * 0.9, wz + Math.cos(frot) * 0.9];
        const ground = heightAt(...out);
        let floor0 = true;
        for (let y = lo + 1.6; y < eave - 0.9; y += FH) {
          if (y - 0.9 < ground + 0.25) { floor0 = false; continue; }
          if (k === doorSlot && !doorDone && floor0 && Math.abs(ground - lo) < 0.8) {
            doorAt(wx, ground, wz, frot, {});
            doorDone = true;
            floor0 = false;
            continue;
          }
          floor0 = false;
          windowAt(wx, y, wz, frot, 0.86, 1.3, { shutter, trim });
          if (k === balconySlot && y > lo + 3) balcony(wx, y - 0.78, wz, frot, 1.7);
        }
      }
    }
    // Bougainvillea up a corner, now and then
    if (r() < 0.3) {
      const [bx, bz] = F.at((r() < 0.5 ? -1 : 1) * (w / 2 - 0.3), d / 2 + 0.55);
      plants.push({ kind: "bush", x: bx, y: heightAt(bx, bz), z: bz, s: 0.95 + r() * 0.3, sy: 1.3 + r() * 0.8, ry: r() * 6, v: r(), flower: 1, tint: 1 });
    }
    return { eave, lo, top, F, w, d, rot, x, z };
  };

  // ---------------------------------------------------------------- the village
  const villageSpots = [];
  for (let tries = 0; tries < 4000 && villageSpots.length < 52; tries++) {
    const x = 150 + r() * 165, z = -140 + r() * 215;
    const f = field(x, z);
    if (f.village < 0.25 || f.d < 9 || f.path > 0.05 || pathDist(x, z) < 6) continue;
    if (Math.hypot(x - 262, z + 48) < 22 || Math.hypot(x - 206, z + 8) < 14) continue; // church, plaza
    if (slopeAt(x, z) > 0.45) continue;
    if (villageSpots.some(([vx, vz, vr]) => Math.hypot(x - vx, z - vz) < vr + 5.2)) continue;
    villageSpots.push([x, z, 5 + r() * 1.5]);
  }
  const houses = [];
  for (const [x, z] of villageSpots) {
    // Face down the hill, toward the bay.
    const e = 3;
    const gx = heightAt(x + e, z) - heightAt(x - e, z), gz = heightAt(x, z + e) - heightAt(x, z - e);
    const rot = Math.atan2(-gx, -gz) + (r() - 0.5) * 0.3;
    houses.push(house(x, z, 6 + r() * 4.5, 6 + r() * 3.5, rot, r() < 0.35 ? 3 : 2));
  }

  // Washing hung out between neighbours
  {
    let lines = 0;
    for (let i = 0; i < houses.length && lines < 9; i++) {
      for (let j = i + 1; j < houses.length && lines < 9; j++) {
        const a = houses[i], b = houses[j];
        const dd = Math.hypot(a.x - b.x, a.z - b.z);
        if (dd < 8 || dd > 13 || r() < 0.5) continue;
        const y = Math.min(a.eave, b.eave) - 1.2;
        if (y < Math.max(a.lo, b.lo) + 2.6) continue;
        const dx = (b.x - a.x) / dd, dz = (b.z - a.z) / dd;
        const A = [a.x + dx * (Math.max(a.w, a.d) / 2 - 0.4), y, a.z + dz * (Math.max(a.w, a.d) / 2 - 0.4)];
        const B = [b.x - dx * (Math.max(b.w, b.d) / 2 - 0.4), y, b.z - dz * (Math.max(b.w, b.d) / 2 - 0.4)];
        const span = Math.hypot(B[0] - A[0], B[2] - A[2]);
        if (span < 3) continue;
        lines++;
        const sag = (k) => -Math.sin(k * Math.PI) * 0.35;
        for (let s = 0; s < 8; s++) {
          const k0 = s / 8, k1 = (s + 1) / 8;
          beam(kit, [A[0] + (B[0] - A[0]) * k0, y + sag(k0), A[2] + (B[2] - A[2]) * k0], [A[0] + (B[0] - A[0]) * k1, y + sag(k1), A[2] + (B[2] - A[2]) * k1], 0.02, 0.02, "#e8e2d6", PLAIN);
        }
        const rotL = Math.atan2(dx, dz) + Math.PI / 2;
        for (let k = 0.15; k < 0.9; k += 0.12 + r() * 0.06) {
          const cw = 0.5 + r() * 0.5, chh = 0.5 + r() * 0.5;
          const px = A[0] + (B[0] - A[0]) * k, pz = A[2] + (B[2] - A[2]) * k;
          cloth.put(new THREE.PlaneGeometry(cw, chh, 2, 3).translate(0, -chh / 2, 0), pick(["#f4f0e6", "#e4ecf2", "#d9a3b5", "#7fa8c9", "#f0d27a", "#c7563f", "#9fc5a8"]), M(px, y + sag(k) - 0.02, pz, rotL), CLOTH);
        }
      }
    }
  }

  // Low stone walls along the lanes in the village, and street lamps
  {
    let lampGap = 0;
    for (const p of PATHS) {
      for (let i = 1; i < p.length; i++) {
        const [ax, az] = p[i - 1], [bx, bz] = p[i];
        const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
        for (let t = 1; t < len - 1; t += 1.7) {
          const cx = ax + dx * t, cz = az + dz * t;
          const f = field(cx, cz);
          if (f.village < 0.3 || f.beach > 0.25 || f.h < 3) continue;
          for (const side of [-1, 1]) {
            const wx = cx - dz * 2.25 * side, wz = cz + dx * 2.25 * side;
            if (!clear(wx, wz, 0.6) || pathDist(wx, wz) < 1.9 || noise(wx / 7, wz / 7) < 0.3) continue;
            const y = heightAt(wx, wz);
            kit.put(BOX, "#d8c8a8", M(wx, y + 0.12, wz, Math.atan2(dx, dz), 0.5, 0.9, 1.74), STONE);
            kit.put(BOX, "#e7dcc6", M(wx, y + 0.6, wz, Math.atan2(dx, dz), 0.6, 0.08, 1.76), STONE);
            addSolid({ x: wx, z: wz, hw: 0.25, hd: 0.87, rot: Math.atan2(dx, dz), top: y + 0.64, surf: "stone" });
            clearGround(wx, wz, 1.2, 0.3);
          }
          lampGap += 1.7;
          if (lampGap > 24) {
            lampGap = 0;
            const side = r() < 0.5 ? -1 : 1;
            const lx = cx - dz * 1.7 * side, lz = cz + dx * 1.7 * side;
            if (!clear(lx, lz, 0.4)) continue;
            lamps.push([lx, heightAt(lx, lz), lz, Math.atan2(-dz * side, dx * side)]);
          }
        }
      }
    }
  }

  // A street lamp: an iron post and a lantern that lights at dusk
  const streetLamp = (x, y, z, rot) => {
    kit.put(CYL8, "#2e3030", M(x, y + 0.15, z, 0, 0.16, 0.3, 0.16), METAL);
    kit.put(CYL8, "#2e3030", M(x, y + 1.7, z, 0, 0.055, 3.2, 0.055), METAL);
    const ax = x + Math.sin(rot) * 0.45, az = z + Math.cos(rot) * 0.45;
    beam(kit, [x, y + 3.2, z], [ax, y + 3.25, az], 0.05, 0.05, "#2e3030", METAL);
    kit.put(BOX, "#2e3030", M(ax, y + 3.05, az, rot, 0.3, 0.06, 0.3), METAL);
    kit.put(new THREE.ConeGeometry(0.24, 0.2, 4), "#2e3030", M(ax, y + 3.38, az, rot + Math.PI / 4), METAL);
    for (const k of [0, 1, 2, 3]) {
      const a = rot + (k * Math.PI) / 2;
      windows.push([ax + Math.sin(a) * 0.12, y + 3.17, az + Math.cos(a) * 0.12, a, 0.22, 0.24, 1, 3]);
    }
    glows.push([ax, y + 3.15, az, 6, 1, 0.72, 0.38, 2]);
    addSolid({ x, z, r: 0.16, top: y + 3.4, surf: "metal" });
  };
  for (const [x, y, z, rot] of lamps) streetLamp(x, y, z, rot);

  // ---------------------------------------------------------------- the plaza
  {
    const [x, z] = [206, -8], y = heightAt(x, z);
    kit.put(CYL, "#d6c6a6", M(x, y - 1.6, z, 0, 9.05, 3.2, 9.05), STONE);
    kit.put(CYL, "#e4d8c0", M(x, y + 0.02, z, 0, 9, 0.08, 9), PAVING);
    // the fountain: an eight-sided basin, a column, a bowl
    kit.put(CYL8, "#ddd0b6", M(x, y + 0.35, z, Math.PI / 8, 2.5, 0.7, 2.5), STONE);
    kit.put(CYL8, "#e9e0cc", M(x, y + 0.74, z, Math.PI / 8, 2.62, 0.1, 2.62), STONE);
    kit.put(CYL8, "#5fb1b4", M(x, y + 0.6, z, Math.PI / 8, 2.3, 0.04, 2.3), PLAIN);
    kit.put(CYL, "#ddd0b6", M(x, y + 1.4, z, 0, 0.3, 1.6, 0.3), STONE);
    kit.put(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), "#e3d7bf", M(x, y + 2.3, z, 0, 0.9, 0.35, 0.9), STONE);
    kit.put(CYL, "#e3d7bf", M(x, y + 2.31, z, 0, 0.9, 0.04, 0.9), STONE);
    kit.put(CYL, "#6cbdbd", M(x, y + 2.32, z, 0, 0.78, 0.03, 0.78), PLAIN);
    kit.put(BALL, "#e3d7bf", M(x, y + 2.6, z, 0, 0.16, 0.3, 0.16), STONE);
    addSolid({ x, z, r: 2.6, top: y + 0.78, surf: "stone" });
    places.plaza = [x, y, z];
    places.fountain = [x, y + 2.5, z];
    claim(x, z, 10);
    // A café under umbrellas, and a market stall
    const cafe = (cx, cz) => {
      const cy = heightAt(cx, cz);
      kit.put(CYL, "#f0ece2", M(cx, cy + 0.75, cz, 0, 0.42, 0.04, 0.42), PLAIN);
      kit.put(CYL6, "#3a3836", M(cx, cy + 0.38, cz, 0, 0.04, 0.75, 0.04), METAL);
      for (let k = 0; k < 2; k++) {
        const a = r() * 6 + k * Math.PI;
        const sx = cx + Math.cos(a) * 0.75, sz = cz + Math.sin(a) * 0.75;
        kit.put(BOX, "#a8673d", M(sx, cy + 0.46, sz, -a, 0.4, 0.04, 0.4), WOOD);
        kit.put(BOX, "#a8673d", M(sx + Math.cos(a) * 0.19, cy + 0.72, sz + Math.sin(a) * 0.19, -a + Math.PI / 2, 0.4, 0.5, 0.04), WOOD);
        for (const [ox, oz] of [[-0.17, -0.17], [0.17, -0.17], [0.17, 0.17], [-0.17, 0.17]]) kit.put(CYL6, "#3a3836", M(sx + ox, cy + 0.23, sz + oz, 0, 0.018, 0.46, 0.018), METAL);
      }
      umbrella(cx, cy, cz, pick([["#f2ede0", "#2f6b8f"], ["#f2ede0", "#c7563f"], ["#f2ede0", "#5c8a4f"]]));
      addSolid({ x: cx, z: cz, r: 0.5, top: cy + 0.78, surf: "wood" });
    };
    for (const [ox, oz] of [[6.5, 3.5], [8.2, -0.8], [5.2, 6.8]]) cafe(x + ox, z + oz);
    // the stall
    {
      const sx = x - 6.5, sz = z + 3, sy = heightAt(sx, sz), rot = 0.9;
      kit.put(BOX, "#9a6a43", M(sx, sy + 0.85, sz, rot, 2.4, 0.08, 1.1), WOOD);
      for (const [ox, oz] of [[-1.1, -0.5], [1.1, -0.5], [1.1, 0.5], [-1.1, 0.5]]) {
        const [px, pz] = [sx + Math.cos(rot) * ox + Math.sin(rot) * oz, sz - Math.sin(rot) * ox + Math.cos(rot) * oz];
        kit.put(BOX, "#7a5235", M(px, sy + 1.15, pz, rot, 0.08, 2.3, 0.08), WOOD);
      }
      for (let k = 0; k < 8; k++) {
        const ox = -1.05 + k * 0.3;
        const [px, pz] = [sx + Math.cos(rot) * ox + Math.sin(rot) * 0.0, sz - Math.sin(rot) * ox];
        cloth.put(BOX, k % 2 ? "#f2ede0" : "#c7563f", M(px, sy + 2.3, pz, rot, 0.3, 0.04, 1.5, 0.3), CLOTH);
      }
      for (let k = 0; k < 4; k++) {
        const ox = -0.85 + k * 0.57;
        const [px, pz] = [sx + Math.cos(rot) * ox, sz - Math.sin(rot) * ox];
        kit.put(BOX, "#b98a5a", M(px, sy + 0.98, pz, rot, 0.5, 0.18, 0.4), WOOD);
        const fruit = ["#f08a1c", "#e2c23a", "#c7362a", "#7aa83a"][k];
        for (let f = 0; f < 6; f++) kit.put(BALL, fruit, M(px + (r() - 0.5) * 0.3, sy + 1.1, pz + (r() - 0.5) * 0.25, 0, 0.07, 0.07, 0.07), PLAIN);
      }
      addSolid({ x: sx, z: sz, hw: 1.2, hd: 0.55, rot, top: sy + 0.9, surf: "wood" });
    }
  }

  // A beach umbrella or café parasol, in stripes
  function umbrella(x, y, z, [a, b], h = 2.3, rad = 1.3) {
    const segs = 10;
    const g = new THREE.ConeGeometry(rad, 0.5, segs, 1, true).toNonIndexed();
    const half = g.attributes.position.count / segs;
    const A = hex(a), B = hex(b);
    const p = g.attributes.position;
    const tilt = (r() - 0.5) * 0.15;
    // each panel its own colour
    const panel = (i) => (Math.floor(i / half) % 2 ? A : B);
    for (let s = 0; s < segs; s++) {
      const seg = new THREE.BufferGeometry();
      const arr = [];
      for (let i = s * half; i < (s + 1) * half; i++) arr.push(p.getX(i), p.getY(i), p.getZ(i));
      seg.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      seg.computeVertexNormals();
      cloth.put(seg, panel(s * half), M(x, y + h, z, 0, 1, 1, 1, tilt, tilt), CLOTH);
    }
    kit.put(CYL6, "#e8e1d4", M(x, y + h / 2, z, 0, 0.025, h, 0.025, tilt, tilt), PLAIN);
  }

  // ---------------------------------------------------------------- the church
  {
    const [x, z] = [264, -50];
    const rot = -Math.PI / 2 + 0.25; // its door looks west, over the bay
    const F = frame(x, z, rot);
    const c = Math.cos(rot), s = Math.sin(rot);
    const w = 9, d = 17;
    const lo = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => heightAt(...F.at((a * w) / 2, (b * d) / 2))));
    const eave = lo + 9;
    const WALL = "#f4ead6", TR = "#e3d6bb";
    kit.put(BOX, WALL, M(x, (lo - 3 + eave) / 2, z, rot, w, eave - lo + 3, d), PLASTER);
    kit.put(BOX, "#cdbb9b", M(x, lo - 0.9, z, rot, w + 0.2, 3.2, d + 0.2), STONE);
    kit.put(BOX, TR, M(x, eave - 0.15, z, rot, w + 0.3, 0.3, d + 0.3), STONE);
    kit.put(gableRoof(w + 1, d + 0.8, 3.2), "#c35f3a", M(x, eave + 0.05, z, rot), TILE);
    {
      const [ax, az] = F.at(0, -(d + 0.8) / 2), [bx, bz] = F.at(0, (d + 0.8) / 2);
      beam(kit, [ax, eave + 3.27, az], [bx, eave + 3.27, bz], 0.24, 0.16, "#a84f31", TILE);
    }
    // The gable ends, with a cornice following the roof
    for (const k of [-1, 1]) {
      const [gx, gz] = F.at(0, (k * d) / 2);
      kit.put(gableEnd(w, 3.1, 0.3), WALL, M(gx, eave, gz, rot), PLASTER);
    }
    // the facade: pilasters, a pediment, a round window and a big door
    const fz = d / 2 + 0.06;
    for (const k of [-1, -0.36, 0.36, 1]) {
      const [px, pz] = F.at((k * w) / 2 - k * 0.25, fz);
      kit.put(BOX, TR, M(px, (lo + eave) / 2, pz, rot, 0.55, eave - lo, 0.25), STONE);
    }
    {
      for (const k of [-1, 1]) {
        const a = Math.atan2(3.1, w / 2 + 0.3);
        const [qx, qz] = F.at((k * (w / 2 + 0.3)) / 2, fz + 0.12);
        kit.put(BOX, TR, M(qx, eave + 1.55, qz, rot, w / 2 + 1.1, 0.22, 0.3, 0, k * a), STONE);
      }
      const [rx, rz] = F.at(0, fz + 0.02);
      windows.push([rx, eave - 1.8, rz, rot, 2, 2, 1, 1]);
      kit.put(new THREE.TorusGeometry(1.05, 0.14, 6, 24), TR, M(rx, eave - 1.8, rz, rot), STONE);
      glows.push([rx + s * 0.8, eave - 1.8, rz + c * 0.8, 5, 1, 0.75, 0.42, 0]);
      const [dx, dz] = F.at(0, fz);
      doorAt(dx, lo, dz, rot, { color: "#5a3c2c", w: 1.9, h: 3.4, arch: true, lamp: false });
      for (let k = 0; k < 3; k++) {
        const [sx2, sz2] = F.at(0, fz + 0.9 + k * 0.45);
        kit.put(BOX, "#ddd1b9", M(sx2, lo - 0.15 - k * 0.22, sz2, rot, 4.2 + k * 0.6, 0.45, 0.5), STONE);
      }
    }
    // tall arched windows down the sides, and buttresses between them
    for (const k of [-1, 1]) for (const o of [-5, 0, 5]) {
      const [wx, wz] = F.at((k * w) / 2, o);
      windowAt(wx, lo + 5, wz, rot + (k * Math.PI) / 2, 0.85, 2.6, { lit: true, trim: TR, shape: 2, box: false });
      for (const b of [-2.5, 2.5]) {
        const [bx, bz] = F.at((k * w) / 2 + k * 0.35, o + b);
        kit.put(BOX, "#e6d9c0", M(bx, lo + 2.5, bz, rot, 0.7, 5.5, 0.6), STONE);
      }
    }
    addSolid({ x, z, hw: w / 2, hd: d / 2, rot, top: (lx) => eave + 3.2 * Math.max(0, 1 - Math.abs(lx) / (w / 2 + 0.5)), surf: "roof" });
    claim(x, z, 13);
    // The bell tower, at the front corner
    const tx = x + s * (d / 2 - 2.2) + c * (w / 2 + 2.3), tz = z + c * (d / 2 - 2.2) - s * (w / 2 + 2.3);
    const ty = heightAt(tx, tz);
    const floor = ty + 15, cap = floor + 3.6;
    const T = frame(tx, tz, rot);
    kit.put(BOX, "#f1e3c8", M(tx, (ty - 3 + floor) / 2, tz, rot, 4.4, floor - ty + 3, 4.4), PLASTER);
    for (const [sx2, sz2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let y = ty + 0.2, k = 0; y < floor - 0.3; y += 0.42, k++) {
        const lw = k % 2 ? 0.6 : 0.36, ld = k % 2 ? 0.36 : 0.6;
        const [qx, qz] = T.at(sx2 * (2.2 - lw / 2 + 0.03), sz2 * (2.2 - ld / 2 + 0.03));
        kit.put(BOX, TR, M(qx, y + 0.2, qz, rot, lw, 0.38, ld), STONE);
      }
    }
    for (const yy of [ty + 5, ty + 10]) kit.put(BOX, TR, M(tx, yy, tz, rot, 4.65, 0.2, 4.65), STONE);
    kit.put(BOX, "#e5d3b2", M(tx, floor + 0.15, tz, rot, 4.9, 0.3, 4.9), STONE);
    // the belfry: piers at the corners, arches between
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [px, pz] = T.at(a * 1.8, b * 1.8);
      kit.put(BOX, "#efe1c4", M(px, floor + 1.8, pz, rot, 0.85, 3.6, 0.85), PLASTER);
      addSolid({ x: px, z: pz, r: 0.55, top: cap, bottom: floor - 0.1, surf: "stone" });
    }
    for (let k = 0; k < 4; k++) {
      const a = rot + (k * Math.PI) / 2;
      const [ax, az] = [tx + Math.sin(a) * 2.05, tz + Math.cos(a) * 2.05];
      kit.put(ARCH, "#efe1c4", M(ax, floor + 2.65, az, a, 1.38, 1.1, 2.4), PLASTER);
      kit.put(BOX, "#efe1c4", M(ax, floor + 3.45, az, a, 3.6, 0.45, 0.45), PLASTER);
      // a low parapet between the piers, to lean on
      kit.put(BOX, "#e5d3b2", M(ax, floor + 0.65, az, a, 2.8, 0.7, 0.3), STONE);
    }
    kit.put(BOX, "#e5d3b2", M(tx, cap + 0.25, tz, rot, 4.9, 0.5, 4.9), STONE);
    kit.put(new THREE.ConeGeometry(3.4, 3.6, 4), "#c35f3a", M(tx, cap + 2.3, tz, rot + Math.PI / 4), TILE);
    kit.put(BALL, "#c9b071", M(tx, cap + 4.25, tz, 0, 0.2, 0.2, 0.2), METAL);
    kit.put(BOX, "#3a3634", M(tx, cap + 4.9, tz, rot, 0.07, 1.2, 0.07), METAL);
    kit.put(BOX, "#3a3634", M(tx, cap + 5.05, tz, rot, 0.6, 0.07, 0.07), METAL);
    addSolid({ x: tx, z: tz, hw: 2.2, hd: 2.2, rot, top: floor + 0.3, surf: "stone" });
    claim(tx, tz, 4);
    // The clock, on the side that faces the bay
    const cx = tx + s * 2.25, cz = tz + c * 2.25;
    kit.put(new THREE.CircleGeometry(1.15, 32), "#f7f1e2", M(cx, floor - 3, cz, rot), PLAIN);
    kit.put(new THREE.TorusGeometry(1.2, 0.09, 6, 32), "#5b4a3a", M(cx + s * 0.02, floor - 3, cz + c * 0.02, rot), METAL);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const lx = Math.sin(a) * 0.95, ly = Math.cos(a) * 0.95;
      kit.put(BOX, "#3a2f28", M(cx + Math.cos(rot) * lx + s * 0.02, floor - 3 + ly, cz - Math.sin(rot) * lx + c * 0.02, rot, 0.05, k % 3 ? 0.12 : 0.22, 0.02, 0, -a), PLAIN);
    }
    const [cdx, cdz] = F.at(0, fz + 1.2);
    places.church = { x, z, rot, door: [cdx, lo, cdz] };
    places.tower = { x: tx, z: tz, y: ty, floor, cap, rot, clock: [cx + s * 0.04, floor - 3, cz + c * 0.04] };
  }

  // ---------------------------------------------------------------- the lighthouse
  {
    const [x, z] = [-190, -54];
    const y = heightAt(x, z) - 0.3;
    kit.put(CYL8, "#d6c7aa", M(x, y - 1.2, z, Math.PI / 8, 4.4, 3, 4.4), STONE);
    kit.put(CYL8, "#e2d5bb", M(x, y + 0.33, z, Math.PI / 8, 4.55, 0.12, 4.55), STONE);
    const prof = [[2.75, 0], [2.65, 4], [2.3, 12], [2.05, 18.4], [2.05, 18.6]].map(([a, b]) => new THREE.Vector2(a, b));
    kit.put(new THREE.LatheGeometry(prof, 32), "#f6f1e6", M(x, y + 0.3, z), PLASTER);
    kit.put(new THREE.CylinderGeometry(2.78, 2.85, 0.6, 32), "#cdbb9b", M(x, y + 0.6, z), STONE);
    kit.put(new THREE.CylinderGeometry(2.14, 2.2, 0.5, 32), "#e5d9c2", M(x, y + 17.2, z), STONE);
    const g = y + 19;
    // corbels under the gallery
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      kit.put(BOX, "#e5d9c2", M(x + Math.cos(a) * 2.3, g - 0.55, z + Math.sin(a) * 2.3, -a, 0.6, 0.7, 0.3), STONE);
    }
    kit.put(new THREE.CylinderGeometry(3.05, 2.9, 0.32, 32), "#e3d6be", M(x, g - 0.05, z), STONE);
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      kit.put(BOX, "#2f4440", M(x + Math.cos(a) * 2.92, g + 0.55, z + Math.sin(a) * 2.92, -a, 0.045, 1, 0.045), METAL);
    }
    kit.put(new THREE.TorusGeometry(2.92, 0.05, 4, 48), "#2f4440", M(x, g + 1.05, z, 0, 1, 1, 1, Math.PI / 2), METAL);
    kit.put(new THREE.TorusGeometry(2.92, 0.03, 4, 48), "#2f4440", M(x, g + 0.55, z, 0, 1, 1, 1, Math.PI / 2), METAL);
    // the lantern room: a low wall, glass, a green copper dome
    kit.put(new THREE.CylinderGeometry(1.55, 1.55, 0.7, 24), "#2f4440", M(x, g + 0.45, z), METAL);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      kit.put(BOX, "#2f4440", M(x + Math.cos(a) * 1.5, g + 1.85, z + Math.sin(a) * 1.5, -a, 0.08, 2.2, 0.08), METAL);
    }
    for (let k = 0; k < 10; k++) {
      const a = ((k + 0.5) / 10) * Math.PI * 2;
      windows.push([x + Math.cos(a) * 1.45, g + 1.85, z + Math.sin(a) * 1.45, Math.atan2(Math.cos(a), Math.sin(a)), 0.92, 2.1, 1, 3]);
    }
    kit.put(new THREE.CylinderGeometry(1.7, 1.7, 0.12, 24), "#2f4440", M(x, g + 3, z), METAL);
    kit.put(new THREE.SphereGeometry(1.6, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), "#4e7a6c", M(x, g + 3.02, z, 0, 1, 0.75, 1), METAL);
    kit.put(BALL, "#4e7a6c", M(x, g + 4.35, z, 0, 0.22, 0.22, 0.22), METAL);
    kit.put(BOX, "#2f4440", M(x, g + 4.9, z, 0, 0.05, 1, 0.05), METAL);
    kit.put(BOX, "#2f4440", M(x, g + 5.1, z, 0.6, 0.7, 0.18, 0.02), METAL);
    // small windows up the tower, on the stair
    for (let k = 0; k < 5; k++) {
      const a = 0.9 + k * 1.3, hy = 3.5 + k * 3;
      const rad = 2.7 - hy * 0.035;
      windowAt(x + Math.cos(a) * rad, y + hy, z + Math.sin(a) * rad, Math.atan2(Math.cos(a), Math.sin(a)), 0.4, 0.75, { lit: k % 2 === 0, trim: "#e5d9c2", box: false });
    }
    // the door, toward the keeper's house
    const da = Math.atan2(-76 - z, -199 - x);
    const [ddx, ddz] = [x + Math.cos(da) * 2.66, z + Math.sin(da) * 2.66];
    doorAt(ddx, y + 0.35, ddz, Math.atan2(Math.cos(da), Math.sin(da)), { color: "#3f6570", w: 1.1, h: 2.2, arch: true, lamp: true });
    addSolid({ x, z, r: 2.75, top: g, surf: "stone" });
    addSolid({ x, z, r: 4.4, top: y + 0.38, surf: "stone" });
    addSolid({ x, z, r: 3, top: g + 0.12, bottom: g - 0.3, surf: "metal" });
    addSolid({ x, z, r: 1.6, top: g + 3.4, bottom: g + 0.12, surf: "metal" });
    claim(x, z, 6);
    places.lighthouse = { x, z, y, gallery: g + 0.12, lamp: new THREE.Vector3(x, g + 1.85, z),
      door: [x + Math.cos(da) * 3.6, y + 0.35, z + Math.sin(da) * 3.6], da };
    // The keeper's house, a wall round its garden, and the woodpile
    const k = house(-200, -76, 7, 5.5, da + Math.PI / 2, 1, { wall: "#f4ecd9", roof: "#c45f3b", shutter: "#4f7d63", flat: false });
    const wx = -194, wz = -82, wy = heightAt(wx, wz);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5 - row; i++) {
        kit.put(CYL8, i % 2 ? "#7a5236" : "#6c4630", M(wx + (i - (4 - row) / 2) * 0.36, wy + 0.2 + row * 0.32, wz, 0.4, 0.17, 1.7, 0.17, Math.PI / 2, 0), WOOD);
      }
    }
    kit.put(BOX, "#c9643b", M(wx, wy + 1.55, wz, 0.4, 2.2, 0.08, 1.2, 0.25), TILE);
    for (const sx of [-1, 1]) kit.put(BOX, "#6e5039", M(wx + sx * 1, wy + 0.8, wz - 0.5, 0.4, 0.08, 1.7, 0.08), WOOD);
    addSolid({ x: wx, z: wz, hw: 1.0, hd: 0.9, rot: 0.4, top: wy + 1.1, surf: "wood" });
    places.woodpile = [wx, wy + 1.3, wz + 1.2];
    places.keeper = k;
    // a low wall round the headland garden
    for (let a = 0; a < Math.PI * 2; a += 0.09) {
      const rr = 11, px = -195 + Math.cos(a) * rr, pz = -66 + Math.sin(a) * rr * 0.9;
      if (Math.abs(a - 2.4) < 0.25) continue;
      const py = heightAt(px, pz);
      if (py < 2) continue;
      kit.put(BOX, "#e0d3b8", M(px, py + 0.25, pz, -a, 0.45, 0.8, 1.0), STONE);
    }
  }

  // ---------------------------------------------------------------- the harbour
  {
    const sx = 136, sz = -64;
    const dir = new THREE.Vector2(-0.93, 0.36).normalize();
    const len = 50, deck = 1.05;
    const rot = Math.atan2(-dir.x, -dir.y);
    const along = (o, side = 0) => [sx + dir.x * o + dir.y * side, sz + dir.y * o - dir.x * side];
    // stone quay where it leaves the shore
    {
      const [qx, qz] = along(4);
      kit.put(BOX, "#d9cbb0", M(qx, deck - 1.4, qz, rot, 4.4, 3, 8), STONE);
      kit.put(BOX, "#e6dbc4", M(qx, deck + 0.01, qz, rot, 4.5, 0.12, 8.1), PAVING);
      foam.push([qx, qz, 2.6]);
    }
    for (let k = 0; k < (len - 8) / 0.32; k++) {
      const o = 8 + 0.16 + k * 0.32;
      const [px, pz] = along(o);
      kit.put(BOX, k % 4 ? "#a57d56" : "#94704c", M(px, deck - 0.08, pz, rot, 2.9, 0.12, 0.29), WOOD);
    }
    for (const side of [-1.35, 1.35]) {
      const [ax, az] = along(8, side), [bx, bz] = along(len, side);
      beam(kit, [ax, deck - 0.25, az], [bx, deck - 0.25, bz], 0.18, 0.22, "#7c5c3f", WOOD);
    }
    for (let o = 9; o <= len; o += 3.4) {
      for (const side of [-1.4, 1.4]) {
        const [qx, qz] = along(o, side);
        const floor = heightAt(qx, qz);
        kit.put(CYL8, "#6d5038", M(qx, (floor + deck + 0.4) / 2, qz, 0, 0.15, deck + 0.4 - floor, 0.15), WOOD);
        if (floor < -0.2) foam.push([qx, qz, 0.25]);
      }
      if (Math.round(o) % 2) {
        const [bx, bz] = along(o, 1.2);
        kit.put(CYL8, "#3a3a38", M(bx, deck + 0.18, bz, 0, 0.12, 0.36, 0.12), METAL);
        kit.put(CYL8, "#3a3a38", M(bx, deck + 0.38, bz, 0, 0.17, 0.06, 0.17), METAL);
      }
    }
    // a lamp at the end, a ladder down to the water, and a diving board
    {
      const [lx, lz] = along(len - 0.6, -1.15);
      streetLamp(lx, deck, lz, rot + Math.PI / 2);
      const [rx, rz] = along(len - 4, 1.55);
      for (const k of [-0.25, 0.25]) {
        const [ax, az] = [rx + dir.x * k, rz + dir.y * k];
        kit.put(CYL6, "#8a8f8c", M(ax, deck - 0.8, az, 0, 0.03, 2.4, 0.03), METAL);
      }
      for (let y = deck - 1.8; y < deck; y += 0.32) kit.put(BOX, "#8a8f8c", M(rx, y, rz, rot, 0.5, 0.03, 0.03), METAL);
      // ring buoy
      const [bx, bz] = along(len - 8, -1.4);
      kit.put(CYL6, "#6d5038", M(bx, deck + 0.6, bz, 0, 0.06, 1.2, 0.06), WOOD);
      kit.put(new THREE.TorusGeometry(0.32, 0.08, 6, 16), "#e2462f", M(bx - dir.y * 0.1, deck + 0.85, bz + dir.x * 0.1, rot + Math.PI / 2), PLAIN);
      // the board, sprung, off the end
      const [ex, ez] = along(len + 1.3);
      kit.put(BOX, "#e8e2d0", M(ex, deck + 0.35, ez, rot, 0.6, 0.07, 3.2, -0.04), WOOD);
      const [hx, hz] = along(len - 0.2);
      kit.put(BOX, "#5c6a6e", M(hx, deck + 0.17, hz, rot, 0.5, 0.34, 0.3), METAL);
      addSolid({ x: ex, z: ez, hw: 0.3, hd: 1.6, rot, top: deck + 0.4, bottom: deck + 0.2, surf: "board", bouncy: true });
      places.board = [ex, deck + 0.4, ez];
    }
    // crates, a barrel and a net on the quay
    {
      const [cx, cz] = along(5, -1.4);
      for (let k = 0; k < 3; k++) kit.put(BOX, "#b08a5c", M(cx + dir.x * k * 0.7, deck + 0.25 + (k === 2 ? 0.5 : 0), cz + dir.y * k * 0.7 + (k === 2 ? -0.35 : 0), rot + r() * 0.2, 0.6, 0.5, 0.6), WOOD);
      const [bx, bz] = along(6.5, 1.5);
      kit.put(new THREE.CylinderGeometry(0.32, 0.3, 0.85, 12), "#8a5a35", M(bx, deck + 0.43, bz), WOOD);
      for (const yy of [0.15, 0.7]) kit.put(new THREE.TorusGeometry(0.33, 0.025, 4, 16), "#3a3836", M(bx, deck + yy, bz, 0, 1, 1, 1, Math.PI / 2), METAL);
      const [nx, nz] = along(3, 1.6);
      kit.put(new THREE.SphereGeometry(0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), "#6d8f8a", M(nx, deck, nz, 0, 1, 0.45, 0.8), PLAIN);
      for (let k = 0; k < 5; k++) kit.put(BALL, "#e8a33a", M(nx + (r() - 0.5) * 0.9, deck + 0.3, nz + (r() - 0.5) * 0.7, 0, 0.09, 0.09, 0.09), PLAIN);
    }
    const mx = sx + dir.x * len / 2, mz = sz + dir.y * len / 2;
    addSolid({ x: mx, z: mz, hw: 1.5, hd: len / 2, rot, top: deck, bottom: deck - 0.5, surf: "wood" });
    const ex = sx + dir.x * (len - 1.5), ez = sz + dir.y * (len - 1.5);
    places.pier = { start: [sx, sz], end: [ex, deck, ez], dir, rot, deck, along };
    claim(sx, sz, 5);
  }

  // ---------------------------------------------------------------- the beach
  {
    const spots = [[118, -84, 0], [124, -70, 1], [130, -52, 2], [133, -38, 0], [137, -12, 1]];
    for (const [x, z, k] of spots) {
      const y = heightAt(x, z);
      if (y < 0.4) continue;
      umbrella(x, y - 0.1, z, [["#f4efe2", "#2f6b8f"], ["#f4efe2", "#d0663f"], ["#f2d16b", "#f4efe2"]][k], 2.4, 1.5);
      const a = r() * 6;
      const tx = x + Math.cos(a) * 1.4, tz = z + Math.sin(a) * 1.4;
      kit.put(BOX, pick(["#3f7fb5", "#e0b33a", "#d3533e", "#6aa889"]), M(tx, heightAt(tx, tz) + 0.02, tz, a, 0.9, 0.02, 1.8), CLOTH);
      addSolid({ x, z, r: 0.12, top: y + 2.4, surf: "wood" });
    }
    // two deckchairs, striped
    for (const [x, z, a] of [[128, -60, 2.4], [129.5, -58, 2.6]]) {
      const y = heightAt(x, z);
      for (const k of [-0.32, 0.32]) {
        const [px, pz] = [x + Math.cos(a) * k, z - Math.sin(a) * k];
        beam(kit, [px, y, pz], [px + Math.sin(a) * 0.9, y + 0.85, pz + Math.cos(a) * 0.9], 0.04, 0.04, "#a9845a", WOOD);
        beam(kit, [px + Math.sin(a) * 0.45, y, pz + Math.cos(a) * 0.45], [px - Math.sin(a) * 0.5, y + 0.4, pz - Math.cos(a) * 0.5], 0.04, 0.04, "#a9845a", WOOD);
      }
      for (let s2 = 0; s2 < 5; s2++) {
        const k = -0.26 + s2 * 0.13;
        cloth.put(BOX, s2 % 2 ? "#f4efe2" : "#2f8f8a", M(x + Math.cos(a) * k + Math.sin(a) * 0.2, y + 0.45, z - Math.sin(a) * k + Math.cos(a) * 0.2, a, 0.13, 0.02, 1.3, -0.65), CLOTH);
      }
    }
    // a kiosk at the top of the beach
    {
      const x = 148, z = -30, y = heightAt(x, z), rot = -2.0;
      kit.put(BOX, "#f4ecda", M(x, y + 1.2, z, rot, 3, 2.4, 2.2), PLASTER);
      kit.put(hipRoof(3.6, 2.8, 0.7), "#c8623a", M(x, y + 2.42, z, rot), TILE);
      const fr = frame(x, z, rot);
      for (let k = 0; k < 9; k++) {
        const [px, pz] = fr.at(-1.4 + k * 0.35, 1.45);
        cloth.put(BOX, k % 2 ? "#f4efe2" : "#3d8fb0", M(px, y + 2.15, pz, rot, 0.35, 0.03, 0.9, -0.5), CLOTH);
      }
      const [wx, wz] = fr.at(0, 1.12);
      windows.push([wx, y + 1.3, wz, rot, 2.2, 0.9, 1, 3]);
      kit.put(BOX, "#c9b28c", M(...[fr.at(0, 1.35)[0], y + 0.85, fr.at(0, 1.35)[1]], rot, 2.6, 0.1, 0.5), WOOD);
      addSolid({ x, z, hw: 1.5, hd: 1.1, rot, top: y + 2.4, surf: "roof" });
      claim(x, z, 3);
      places.kiosk = [x, y, z];
    }
  }

  // ---------------------------------------------------------------- boats
  const boats = [];
  const boatMat = builtMaterial({ key: "boat", side: THREE.DoubleSide, defines: { RIM: "0.12", WRAP: "0.1" } });
  // A Mediterranean fishing boat: a lofted hull with a raised stem, painted
  // above the waterline, wood inside, thwarts and a pair of oars.
  const gozzo = (len, beam2, hullC, trimC) => {
    const b = new Kit();
    const segZ = 18, segA = 12;
    const pts = [], inner = [];
    for (let i = 0; i <= segZ; i++) {
      const zz = (i / segZ - 0.5) * len, k = Math.abs((2 * zz) / len);
      const half = (beam2 / 2) * Math.pow(Math.max(0, 1 - Math.pow(k, 2.2)), 0.55);
      const sheer = 0.62 + 0.3 * Math.pow(k, 3);
      const keel = -0.25 * (1 - 0.4 * k * k);
      const ring = [], ringIn = [];
      for (let j = 0; j <= segA; j++) {
        const a = (j / segA) * Math.PI;
        const sx = Math.cos(a), sy = Math.sin(a);
        const x = half * Math.sign(sx) * Math.pow(Math.abs(sx), 0.7);
        const y = sheer - (sheer - keel) * Math.pow(sy, 1.4);
        ring.push([x, y, zz]);
        ringIn.push([x * 0.9, y + (sheer - y) * 0.06 + 0.02, zz * 0.97]);
      }
      pts.push(ring);
      inner.push(ringIn);
    }
    const quad = (out, A, B, C, D) => out.push(...A, ...B, ...C, ...A, ...C, ...D);
    const hull = [], trim = [], wood = [];
    for (let i = 0; i < segZ; i++) for (let j = 0; j < segA; j++) {
      const A = pts[i][j], B = pts[i + 1][j], Cc = pts[i + 1][j + 1], D = pts[i][j + 1];
      const top = j < 2 || j >= segA - 2;
      quad(top ? trim : hull, A, D, Cc, B);
      quad(wood, inner[i][j], inner[i + 1][j], inner[i + 1][j + 1], inner[i][j + 1]);
    }
    for (const [arr, col, kind] of [[hull, hullC, PLAIN], [trim, trimC, PLAIN], [wood, "#b08455", WOOD]]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      b.put(g, col, new THREE.Matrix4(), kind);
    }
    // the gunwale rail, thwarts, the stem post, oars
    for (const sd of [-1, 1]) {
      for (let i = 0; i < segZ; i++) {
        const A = pts[i][sd < 0 ? segA : 0], B = pts[i + 1][sd < 0 ? segA : 0];
        beam(b, A, B, 0.07, 0.07, trimC, WOOD);
      }
    }
    for (const zz of [-len * 0.22, len * 0.08, len * 0.3]) b.put(BOX, "#a07a50", M(0, 0.32, zz, 0, beam2 * 0.82, 0.05, 0.26), WOOD);
    b.put(BOX, trimC, M(0, 0.95, len / 2 - 0.05, 0, 0.08, 0.36, 0.12, 0.2), WOOD);
    b.put(BOX, trimC, M(0, 0.95, -len / 2 + 0.05, 0, 0.08, 0.45, 0.12, -0.2), WOOD);
    for (const sd of [-1, 1]) {
      b.put(CYL6, "#c9a878", M(sd * 0.3, 0.42, 0, 0, 0.025, 2.6, 0.025, Math.PI / 2 - 0.05), WOOD);
      b.put(BOX, "#c9a878", M(sd * 0.3, 0.45, 1.25, 0, 0.13, 0.02, 0.45), WOOD);
    }
    return b.geometry();
  };
  const sailboat = () => {
    const b = new Kit();
    const g = gozzo(7.4, 2.4, "#f4f1e8", "#2f5e8c");
    b.parts.push(g);
    b.put(BOX, "#f0ece2", M(0, 0.95, -0.6, 0, 1.4, 0.6, 2.2), PLAIN);
    b.put(CYL6, "#8a7660", M(0, 4.8, 0.6, 0, 0.07, 9, 0.07), WOOD);
    b.put(CYL6, "#8a7660", M(0, 1.6, -0.8, 0, 0.05, 2.8, 0.05, Math.PI / 2), WOOD);
    const sail = (pts, bulge) => {
      const geo = new THREE.BufferGeometry();
      const [p0, p1, p2] = pts.map((p) => new THREE.Vector3(...p));
      const pos = [];
      const S = 8;
      const at = (u, v) => {
        // a triangle, bellied out sideways by the wind
        const p = p0.clone().multiplyScalar(1 - u - v).addScaledVector(p1, u).addScaledVector(p2, v);
        p.x += bulge * Math.sin(Math.PI * Math.min(1, (u + v))) * Math.sin(Math.PI * (v / Math.max(u + v, 1e-3))) * (1 - u);
        return p;
      };
      for (let i = 0; i < S; i++) for (let j = 0; j < S - i; j++) {
        const u0 = i / S, v0 = j / S, d = 1 / S;
        const a = at(u0, v0), b2 = at(u0 + d, v0), c = at(u0, v0 + d);
        pos.push(a.x, a.y, a.z, b2.x, b2.y, b2.z, c.x, c.y, c.z);
        if (j < S - i - 1) {
          const e = at(u0 + d, v0 + d);
          pos.push(b2.x, b2.y, b2.z, e.x, e.y, e.z, c.x, c.y, c.z);
        }
      }
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      return geo;
    };
    b.put(sail([[0, 1.7, 0.55], [0, 9.1, 0.55], [0, 1.7, -3]], 0.9), "#fbf6e8", new THREE.Matrix4(), CLOTH);
    b.put(sail([[0, 1.4, 0.8], [0, 8.2, 0.7], [0, 1.1, 3.6]], 0.6), "#f1e6cc", new THREE.Matrix4(), CLOTH);
    return b.geometry();
  };
  const { end, dir } = places.pier;
  const moored = [
    [end[0] + dir.y * 4.2, end[2] - dir.x * 4.2, "#f3efe4", "#3d73a8", Math.atan2(dir.x, dir.y) + 0.2],
    [end[0] - dir.y * 4.2 + dir.x * 12, end[2] + dir.x * 4.2 + dir.y * 12, "#e8d9b6", "#bb5a35", Math.atan2(dir.x, dir.y) - 0.3],
    [end[0] + dir.y * 4.4 + dir.x * 20, end[2] - dir.x * 4.4 + dir.y * 20, "#2f6f8f", "#f1ead6", Math.atan2(dir.x, dir.y) + 0.1],
    [62, -96, "#d84f3a", "#f4efe4", 2.6],
  ];
  for (const [x, z, color, stripe, a] of moored) {
    const m = new THREE.Mesh(gozzo(4.6, 1.6, color, stripe), boatMat);
    m.position.set(x, 0, z);
    m.rotation.y = a;
    m.castShadow = true;
    m.receiveShadow = true;
    m.layers.enable(1);
    scene.add(m);
    boats.push({ mesh: m, x, z, a, phase: r() * 6, kind: "row" });
    foam.push([x, z, 1.4]);
  }
  // One pulled up on the beach
  {
    const x = 141, z = -21, y = heightAt(x, z);
    const m = new THREE.Mesh(gozzo(4.4, 1.6, "#d9e6e8", "#c0563a"), boatMat);
    m.position.set(x, y - 0.12, z);
    m.rotation.set(0.1, 2.4, 0.16);
    m.castShadow = true;
    m.receiveShadow = true;
    m.layers.enable(1);
    scene.add(m);
    addSolid({ x, z, hw: 0.8, hd: 2.1, rot: 2.4, top: y + 0.75, surf: "wood" });
    places.beachBoat = [x, y + 0.9, z];
    claim(x, z, 3);
  }
  for (const [cx, cz, rad, sp] of [[-520, 260, 220, 0.012], [-900, -80, 300, -0.008], [-300, 600, 380, 0.006]]) {
    const m = new THREE.Mesh(sailboat(), boatMat);
    m.castShadow = true;
    m.layers.enable(1);
    scene.add(m);
    boats.push({ mesh: m, cx, cz, rad, sp, phase: r() * 6, kind: "sail" });
  }

  // ---------------------------------------------------------------- props for the lanterns
  // A frame on a stand at the lookout, the way viewpoints have them; a bench,
  // a telescope, and a swing hung from the big pine.
  {
    const [x, z] = [-20, -290], y = heightAt(x, z);
    const rot = Math.atan2(30, 140);
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const k of [-1, 1]) kit.put(BOX, "#6e5039", M(x + c * k * 1.1, y + 1.1, z - s * k * 1.1, rot, 0.14, 2.2, 0.14), WOOD);
    for (const [ox, oy, w, h] of [[0, 2.15, 2.4, 0.16], [0, 0.9, 2.4, 0.16], [-1.12, 1.52, 0.16, 1.4], [1.12, 1.52, 0.16, 1.4]]) {
      kit.put(BOX, "#d9a64c", M(x + c * ox, y + oy, z - s * ox, rot, w, h, 0.12), WOOD);
    }
    const bx = x - s * 2.2, bz = z - c * 2.2;
    kit.put(BOX, "#8a6646", M(bx, y + 0.45, bz, rot, 2.2, 0.08, 0.5), WOOD);
    kit.put(BOX, "#8a6646", M(bx - s * 0.25, y + 0.75, bz - c * 0.25, rot, 2.2, 0.4, 0.06, -0.15), WOOD);
    for (const k of [-0.9, 0.9]) kit.put(BOX, "#3a3836", M(bx + c * k, y + 0.22, bz - s * k, rot, 0.08, 0.45, 0.45), METAL);
    addSolid({ x: bx, z: bz, hw: 1.1, hd: 0.3, rot, top: y + 0.5, surf: "wood" });
    places.view = [x + c * 2.2, y, z - s * 2.2];
    // the telescope, pointed across the bay
    const tx = x + c * 3.8 + s * 1.2, tz = z - s * 3.8 + c * 1.2, ty = heightAt(tx, tz);
    kit.put(CYL8, "#3b4a4f", M(tx, ty + 0.55, tz, 0, 0.07, 1.1, 0.07), METAL);
    kit.put(CYL, "#c9a24a", M(tx, ty + 1.2, tz, 0, 0.09, 0.85, 0.09, Math.PI / 2 - 0.12, 0), METAL);
    places.telescope = { x: tx, y: ty, z: tz, yaw: rot + Math.PI };
    addSolid({ x: tx, z: tz, r: 0.15, top: ty + 1.3, surf: "metal" });
    // the swing's pine, and the swing
    const px = x - c * 6 + s * 2, pz = z + s * 6 + c * 2;
    plants.push({ kind: "pine", x: px, y: heightAt(px, pz) - 0.3, z: pz, s: 1.05, ry: 0.4, tint: 1 });
    places.swing = { x: px + 2.2, z: pz + 0.8, top: heightAt(px, pz) + 6.4 };
    claim(px, pz, 3.5, 1);
  }
  // The quarry: cut blocks of the same stone the village is built from, and a derrick.
  {
    const [x, z] = [96, -322], y = heightAt(x, z);
    for (let i = 0; i < 11; i++) {
      const bx = x + (r() - 0.5) * 10, bz = z + (r() - 0.5) * 8, by = heightAt(bx, bz);
      const sx = 1 + r() * 1.4, sy = 0.8 + r() * 1.2, sz = 1 + r() * 1.2, a = r() * 3;
      kit.put(BOX, pick(["#e2d4b8", "#d6c6a6", "#ece0c8"]), M(bx, by + sy / 2 - 0.1, bz, a, sx, sy, sz), STONE);
      addSolid({ x: bx, z: bz, hw: sx / 2, hd: sz / 2, rot: a, top: by + sy - 0.1, surf: "stone" });
    }
    const dx = x - 4, dz = z - 5, dy = heightAt(dx, dz);
    beam(kit, [dx - 1.2, dy, dz], [dx, dy + 6, dz + 0.2], 0.16, 0.16, "#6e5039", WOOD);
    beam(kit, [dx + 1.2, dy, dz], [dx, dy + 6, dz + 0.2], 0.16, 0.16, "#6e5039", WOOD);
    beam(kit, [dx, dy, dz + 1.4], [dx, dy + 6, dz + 0.2], 0.16, 0.16, "#6e5039", WOOD);
    beam(kit, [dx, dy + 5.8, dz + 0.2], [dx + 3.5, dy + 4.6, dz + 2], 0.12, 0.12, "#6e5039", WOOD);
    beam(kit, [dx + 3.5, dy + 4.6, dz + 2], [dx + 3.5, dy + 1.5, dz + 2], 0.02, 0.02, "#d8d0bc", PLAIN);
    kit.put(BOX, "#e2d4b8", M(dx + 3.5, dy + 1.2, dz + 2, 0.3, 0.8, 0.6, 0.7), STONE);
    places.quarry = [x + 5, y, z + 4];
  }
  // A red scooter by the top road, and the fuel can that feeds it
  {
    const [x, z] = [292, -10], y = heightAt(x, z);
    kit.put(BOX, "#c8372d", M(x + 1.2, y + 0.32, z + 0.4, 0.3, 0.5, 0.64, 0.24), PLAIN);
    kit.put(BOX, "#c8372d", M(x + 1.2, y + 0.7, z + 0.4, 0.3, 0.3, 0.1, 0.08), PLAIN);
    const rot = 0.3;
    const at = (lx, ly, lz) => [x + Math.cos(rot) * lx + Math.sin(rot) * lz, y + ly, z - Math.sin(rot) * lx + Math.cos(rot) * lz];
    const red = "#b8322a";
    kit.put(new THREE.TorusGeometry(0.22, 0.07, 8, 16), "#222", M(...at(0, 0.29, 0.62), rot + Math.PI / 2), PLAIN);
    kit.put(new THREE.TorusGeometry(0.22, 0.07, 8, 16), "#222", M(...at(0, 0.29, -0.6), rot + Math.PI / 2), PLAIN);
    kit.put(BALL, red, M(...at(0, 0.62, -0.42), rot, 0.38, 0.32, 0.55), PLAIN);
    kit.put(BOX, red, M(...at(0, 0.32, 0.05), rot, 0.3, 0.1, 0.8), PLAIN);
    kit.put(BOX, red, M(...at(0, 0.75, 0.55), rot, 0.34, 0.75, 0.12, 0.25), PLAIN);
    kit.put(BOX, "#3b2c25", M(...at(0, 0.98, -0.35), rot, 0.3, 0.1, 0.6), PLAIN);
    kit.put(CYL6, "#cfcfcf", M(...at(0, 1.18, 0.66), rot, 0.02, 0.6, 0.02, 0, Math.PI / 2), METAL);
    kit.put(BALL, "#f4f0d8", M(...at(0, 1.08, 0.68), rot, 0.08, 0.08, 0.06), PLAIN);
    addSolid({ x, z, hw: 0.3, hd: 0.9, rot, top: y + 1, surf: "metal" });
    places.fuel = [x, y, z];
  }
  places.spawn = [147, heightAt(147, 70), 70];
  places.glyph = [142, heightAt(142, 64.3), 64.3];
  places.islet = [ISLANDS[0][0], heightAt(ISLANDS[0][0], ISLANDS[0][1]), ISLANDS[0][1]];

  // ---------------------------------------------------------------- rocks
  footprints.push([147, 70, 4], [places.glyph[0], places.glyph[2], 2.5]);
  const rocks = [];
  for (let i = 0; i < 90000 && rocks.length < 1300; i++) {
    const x = -480 + r() * 860, z = -420 + r() * 680;
    const f = field(x, z);
    const shore = Math.abs(f.d) < 8 && f.beach < 0.35 && f.h > -3 && f.h < 6;
    const reef = false; // the dark rocks under the water are painted on the sea floor
    const hill = f.h > 3 && (slopeAt(x, z) > 0.3 || f.d < 30) && r() < 0.12;
    if (!(shore || reef || hill) || !clear(x, z, 1)) continue;
    const big = shore && r() < 0.35;
    const s = big ? 2.2 + r() * 3.6 : reef ? 0.9 + r() * 1.8 : shore ? 0.6 + r() * 1.6 : 0.5 + r() * 1.3;
    // reef rocks stay under the surface, dark shapes in the clear water
    const sink = reef && !shore ? 0.55 : 0.25;
    rocks.push({ x, z, y: heightAt(x, z) - s * sink, s, ry: r() * 6.28, tilt: (r() - 0.5) * 0.4, tilt2: (r() - 0.5) * 0.4, sy: 0.55 + r() * 0.4, v: Math.floor(r() * 5) });
  }
  // Big pieces of headland, slumped into the sea round the lighthouse and the village rocks
  for (const [cx, cz, count, spread] of [[-200, -40, 16, 40], [-150, -100, 10, 30], [145, 40, 12, 26], [150, 110, 8, 20], [-300, 112, 8, 18]]) {
    let n = count;
    for (let i = 0; i < count * 3 && n > 0; i++) {
      const x = cx + (r() - 0.5) * spread * 2, z = cz + (r() - 0.5) * spread * 2;
      const f = field(x, z);
      if (Math.abs(f.d) > 6 || f.beach > 0.3 || !clear(x, z, 2)) continue;
      const s = 3.5 + r() * 4.5;
      rocks.push({ x, z, y: heightAt(x, z) - s * 0.3, s, ry: r() * 6.28, tilt: (r() - 0.5) * 0.3, tilt2: (r() - 0.5) * 0.3, sy: 0.5 + r() * 0.35, v: Math.floor(r() * 5) });
      n--;
    }
  }
  for (const k of rocks) {
    const top = k.y + k.s * k.sy * 0.85;
    if (k.s > 1.2 && top > -0.5) addSolid({ x: k.x, z: k.z, r: k.s * 0.62, top, surf: "stone" });
    if (k.y < 0.1 && top > 0.15) foam.push([k.x, k.z, k.s * 0.5]);
    if (k.s > 1.5) clearGround(k.x, k.z, k.s * 0.8, 0.2);
  }
  createRocks(scene, rocks);

  // ---------------------------------------------------------------- trees and bushes
  const scatter = (count, tries, test) => {
    const out = [];
    for (let i = 0; i < tries && out.length < count; i++) {
      const x = -560 + r() * 1120, z = -560 + r() * 1000;
      const f = field(x, z);
      const p = test(x, z, f);
      if (p) out.push({ x, z, y: heightAt(x, z), ry: r() * 6.28, tint: 0.88 + r() * 0.24, v: r(), ...p });
    }
    return out;
  };
  const inVillage = (f) => f.village > 0.2;
  plants.push(...scatter(150, 20000, (x, z, f) => {
    if (f.d < 7 || f.path > 0.1 || f.h > 160 || !clear(x, z, 1.5) || slopeAt(x, z) > 0.5) return null;
    const want = inVillage(f) ? 0.5 : (f.north > 0.1 && noise(x / 40, z / 40) > 0.62 ? 0.25 : 0.015);
    return r() < want ? { kind: "cypress", s: 0.75 + r() * 0.5, y: heightAt(x, z) - 0.2 } : null;
  }));
  // A row of cypresses up the path to the church, as the painting has them
  for (let k = 0; k < 7; k++) {
    const x = 240 + k * 3.6 + 2.5, z = -36 - k * 2.4 - 2;
    if (clear(x, z, 1.2)) plants.push({ kind: "cypress", x, z, y: heightAt(x, z) - 0.2, s: 1.05 + r() * 0.25, ry: r() * 6, tint: 1 });
  }
  plants.push(...scatter(320, 30000, (x, z, f) => {
    if (f.d < 5 || f.path > 0.1 || f.h > 200 || !clear(x, z, 3.5) || slopeAt(x, z) > 0.55) return null;
    const want = (f.north > 0.05 ? 0.4 : 0.12) * smooth(0.35, 0.6, noise(x / 70 + 3, z / 70)) + (f.island ? 0.6 : 0);
    return r() < want && !inVillage(f) ? { kind: "pine", s: 0.75 + r() * 0.5, y: heightAt(x, z) - 0.3 } : null;
  }));
  // Stone pines on the headland, like the ones by the painting's lighthouse
  for (const [x, z] of [[-178, -40], [-205, -36], [-168, -70], [-214, -60], [-150, -96]]) {
    if (clear(x, z, 2.5) && heightAt(x, z) > 1.5) plants.push({ kind: "pine", x, z, y: heightAt(x, z) - 0.3, s: 0.85 + r() * 0.3, ry: r() * 6, tint: 1 });
  }
  plants.push(...scatter(260, 20000, (x, z, f) => {
    if (f.d < 6 || f.path > 0.1 || !clear(x, z, 2.2) || slopeAt(x, z) > 0.5) return null;
    const want = inVillage(f) ? 0.55 : (f.h < 70 && f.north < 0.4 ? 0.12 : 0);
    return r() < want ? { kind: "olive", s: 0.8 + r() * 0.45, y: heightAt(x, z) - 0.2 } : null;
  }));
  plants.push(...scatter(220, 20000, (x, z, f) => {
    if (f.d < 12 || f.path > 0.1 || f.h < 25 || f.h > 260 || !clear(x, z, 3) || slopeAt(x, z) > 0.5) return null;
    return r() < 0.35 * smooth(0.45, 0.65, noise(x / 50 - 3, z / 50 + 1)) ? { kind: "oak", s: 0.8 + r() * 0.5, y: heightAt(x, z) - 0.3 } : null;
  }));
  // Palms, a few, by the beach and the plaza
  for (const [x, z] of [[150, -44], [155, -18], [196, -2], [214, 0], [160, 8], [146, -62]]) {
    if (clear(x, z, 1)) plants.push({ kind: "palm", x, z, y: heightAt(x, z) - 0.2, s: 0.9 + r() * 0.25, ry: r() * 6, tint: 1 });
  }
  for (const p of plants) if (["pine", "cypress", "olive", "oak", "palm"].includes(p.kind)) {
    footprints.push([p.x, p.z, 1.2]);
    addSolid({ x: p.x, z: p.z, r: 0.32 * p.s, top: p.y + 30, surf: "wood" });
  }
  const bushes = [];
  for (let i = 0; i < 70000 && bushes.length < 3600; i++) {
    const near = i % 3 !== 0;
    const x = near ? -300 + r() * 640 : -560 + r() * 1120, z = near ? -360 + r() * 520 : -560 + r() * 1000;
    const f = field(x, z);
    if (f.h < 1 || f.h > 220 || f.path > 0.25 || (f.beach > 0.6 && f.h < 3) || !clear(x, z, 0.8)) continue;
    if (noise(x / 26 + 7, z / 26) < 0.46 || slopeAt(x, z) > 0.6) continue;
    const flower = r() < (inVillage(f) ? 0.4 : 0.1) ? 1 + Math.floor(r() * 4) : 0;
    bushes.push({ kind: "bush", x, z, y: heightAt(x, z) - 0.1, s: 0.55 + r() * 1.1, sy: 0.75 + r() * 0.4, ry: r() * 6.28, tint: 0.85 + r() * 0.3, v: r(), flower });
  }
  plants.push(...bushes);
  // Woods on the far hills
  let woods = 0;
  for (let i = 0; i < 90000 && woods < 7000; i++) {
    const x = -3200 + r() * 6400, z = -3000 + r() * 6000;
    if (Math.abs(x + 20) < 560 && Math.abs(z + 80) < 560) continue;
    const f = field(x, z);
    if (f.d < 14 || f.h < 6 || f.h > 700 || noise(x / 140, z / 140) < (f.island ? 0.35 : 0.5)) continue;
    woods++;
    plants.push({ kind: "far", x, z, y: heightAt(x, z) - 1, s: 4 + r() * 5, sy: 1.1 + r() * 0.5, ry: r() * 6, tint: 0.75 + r() * 0.4 });
  }

  // ---------------------------------------------------------------- the far towns
  // White houses along the far shore, too far to walk to. At night they are
  // points of light, like the towns in the banner.
  const towns = [];
  for (let i = 0; i < 50000 && towns.length < 420; i++) {
    const x = -2000 + r() * 1700, z = -1050 + r() * 870;
    const f = field(x, z);
    if (f.d < 6 || f.d > 170 || f.h > 95 || f.island) continue;
    if (noise(x / 160, z / 160) < 0.5) continue;
    towns.push({ x, z, y: heightAt(x, z), s: 4 + r() * 4 });
  }
  {
    const mat = builtMaterial({ key: "towns" });
    const body = new Kit();
    body.put(BOX, "#ffffff", M(0, 0.4, 0, 0, 1, 1, 0.9), PLASTER);
    const bodyGeo = body.geometry();
    const roofKit = new Kit();
    roofKit.put(hipRoof(1.15, 1.05, 0.32), "#ffffff", M(0, 0.9, 0), TILE);
    const roofGeo = roofKit.geometry();
    const wallsIm = new THREE.InstancedMesh(bodyGeo, mat, towns.length);
    const roofIm = new THREE.InstancedMesh(roofGeo, mat, towns.length);
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    towns.forEach((t, i) => {
      m4.compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 3, 0)), new THREE.Vector3(t.s, t.s * 0.8, t.s));
      wallsIm.setMatrixAt(i, m4);
      roofIm.setMatrixAt(i, m4);
      wallsIm.setColorAt(i, c.set(pick(["#f5eee0", "#efe2c6", "#f8f3ea", "#f1dcc0"])));
      roofIm.setColorAt(i, c.set(pick(ROOFS)));
      if (r() < 0.55) glows.push([t.x, t.y + t.s * 0.5, t.z, 9 + r() * 6, 1, 0.78, 0.48, 1]);
    });
    for (const im of [wallsIm, roofIm]) { im.computeBoundingSphere(); im.layers.enable(1); scene.add(im); }
  }

  // ---------------------------------------------------------------- merge
  const mat = builtMaterial();
  const mesh = new THREE.Mesh(kit.geometry(), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.layers.enable(1);
  scene.add(mesh);
  const clothMesh = new THREE.Mesh(cloth.geometry(), clothMaterial());
  clothMesh.castShadow = true;
  clothMesh.receiveShadow = true;
  clothMesh.layers.enable(1);
  scene.add(clothMesh);

  return { places, windows, glows, boats, plants, foam, materials: { built: mat, boat: boatMat }, gozzo };
}

// Cloth stirs in the wind: washing, awnings, parasols and sails.
function clothMaterial() {
  return stylize(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), {
    key: "cloth",
    defines: { WRAP: "0.3", FOLIAGE: "0.35" },
    vertex: `{
      vec4 wp = modelMatrix * vec4(transformed, 1.);
      float ph = uTime * 3.1 + wp.x * 1.3 + wp.z * 0.9;
      transformed += vec3(uWind.x, 0., uWind.y) * (sin(ph) * 0.05 + sin(ph * 2.3) * 0.02) * uGust;
    }`,
    normal: "normal = normalize(vNormal);",
    color: "diffuseColor.rgb *= 0.92 + 0.12 * vnoise(vWorldP.xy * 9. + vWorldP.z * 7.);",
  });
}

// ---------------------------------------------------------------- rocks
// Limestone boulders: a ball cut by a few planes, so it has the flat faces
// and sharp edges that real limestone breaks into, then roughened a little.
function rockGeometry(seed) {
  const rr = rng(seed);
  const g = new THREE.IcosahedronGeometry(1, 4);
  const p = g.attributes.position, v = new THREE.Vector3();
  const cuts = Array.from({ length: 7 }, () => {
    const n = new THREE.Vector3(rr() * 2 - 1, rr() * 1.4 - 0.5, rr() * 2 - 1).normalize();
    return { n, d: 0.55 + rr() * 0.3 };
  });
  cuts.push({ n: new THREE.Vector3(0, -1, 0), d: 0.35 });
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(0.92 + 0.16 * noise(v.x * 2.3 + seed, v.z * 2.3 + v.y * 1.7));
    for (const { n, d } of cuts) {
      const k = v.dot(n) - d;
      if (k > 0) v.addScaledVector(n, -k);
    }
    v.y *= 0.95;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
function createRocks(scene, list) {
  const mat = stylize(new THREE.MeshLambertMaterial({ color: "#ffffff" }), {
    key: "rock",
    defines: { CONTACT: "0.6", WRAP: "0.12", RIM: "0.1" },
    uniforms: TERRAIN,
    fragmentPars: `uniform vec3 cRockA, cRockB, cRockC, cBedRock;\n${LIMESTONE}`,
    color: /* glsl */ `{
      vec3 P = vWorldP;
      float detail = 1. - smoothstep(30., 200., length(P - cameraPosition));
      float rb;
      vec3 col = limestone(P * 1.4, detail, cRockA, cRockB, cRockC, rb);
      vec3 Nw = normalize(vWorldN);
      // lichen and a little scrub on the tops, dark and green below the water line
      col = mix(col, col * vec3(0.86, 0.9, 0.7), smoothstep(0.55, 0.9, Nw.y) * smoothstep(0.5, 0.7, vnoise(P.xz * 1.3)) * 0.6);
      float swash = sin(uTime * 0.7 + P.x * 0.05 + P.z * 0.03) * 0.12;
      col *= 1. - 0.3 * smoothstep(0.5, -0.1, P.y - swash);
      col = mix(col, cBedRock * 1.4, smoothstep(-0.2, -1.2, P.y) * 0.7);
      diffuseColor.rgb *= col;
      gBump = rb * 0.3;
    }`,
  });
  const geos = [1, 2, 3, 4, 5].map(rockGeometry);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  const cell = 100;
  const groups = new Map();
  for (const k of list) {
    const key = `${Math.floor(k.x / cell)},${Math.floor(k.z / cell)},${k.v}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(k);
  }
  for (const [key, items] of groups) {
    const vi = Number(key.split(",")[2]);
    const im = new THREE.InstancedMesh(geos[vi], mat, items.length);
    items.forEach((k, i) => {
      e.set(k.tilt, k.ry, k.tilt2);
      im.setMatrixAt(i, m.compose(v.set(k.x, k.y, k.z), q.setFromEuler(e), s.set(k.s, k.s * k.sy, k.s * (0.8 + 0.4 * ((i * 7919) % 10) / 10))));
      im.setColorAt(i, c.setScalar(0.9 + 0.2 * (((i * 104729) % 100) / 100)));
    });
    im.computeBoundingSphere();
    im.castShadow = true;
    im.receiveShadow = true;
    if (items.some((k) => k.s > 2)) im.layers.enable(1);
    scene.add(im);
  }
}

// The windows of the village, as one mesh: glass that holds the sky by day
// and lamplight by night, with its frame and glazing bars.
export function createWindows(list) {
  const pos = [], uv = [], lit = [], seed = [], shape = [];
  const v = new THREE.Vector3();
  const plane = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  for (const [x, y, z, rot, w, h, on, sh = 0] of list) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(w, h, 1));
    const p = plane.attributes.position, u = plane.attributes.uv;
    const s = Math.random();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      uv.push(u.getX(i), u.getY(i));
      lit.push(on); seed.push(s); shape.push(sh);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("aLit", new THREE.Float32BufferAttribute(lit, 1));
  geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
  geo.setAttribute("aShape", new THREE.Float32BufferAttribute(shape, 1));
  const uniforms = {
    uSky: { value: new THREE.Color("#9fc0e0") }, uDay: { value: 1 },
    uTime: U.uTime, uNight: U.uNight,
    uSunDir: U.uSunDir, uFogColor: U.uFogColor, uFogGlow: U.uFogGlow, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      attribute float aLit, aSeed, aShape;
      varying float vLit, vSeed, vShape;
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vLit = aLit; vSeed = aSeed; vShape = aShape; vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSky;
      uniform float uNight, uTime, uDay;
      varying float vLit, vSeed, vShape;
      varying vec2 vUv;
      varying vec3 vW;
      ${NOISE}
      ${FOG}
      void main() {
        vec2 uv = vUv;
        if (vShape > 0.5 && vShape < 1.5 && length(uv - 0.5) > 0.5) discard;
        if (vShape > 1.5 && vShape < 2.5 && uv.y > 0.72 && length((uv - vec2(0.5, 0.72)) * vec2(1., 1.79)) > 0.5) discard;
        float fx = min(uv.x, 1. - uv.x), fy = min(uv.y, 1. - uv.y);
        float pane = vShape > 2.5 ? 0. : 1.;
        float frame = (1. - step(0.06, min(fx * 1.25, fy))) * pane;
        float bars = vShape > 0.5 && vShape < 1.5
          ? max(1. - step(0.035, abs(uv.x - 0.5)), 1. - step(0.035, abs(uv.y - 0.5)))
          : max(1. - step(0.028, abs(uv.x - 0.5)), 1. - step(0.022, abs(uv.y - 0.62))) * pane;
        float wood = max(frame, bars);
        // by day, the glass holds the sky, darker low down, and a curtain
        vec3 glass = mix(vec3(0.02, 0.03, 0.05), uSky * 0.7, smoothstep(0.05, 1.1, uv.y) * 0.75);
        float curtain = smoothstep(0.24, 0.12, fx) * step(0.45, fract(vSeed * 7.31));
        glass = mix(glass, vec3(0.42, 0.38, 0.3), curtain * 0.5);
        float flick = 0.9 + 0.1 * sin(uTime * (0.7 + vSeed) + vSeed * 40.);
        vec3 lamp = mix(vec3(3.2, 1.75, 0.65), vec3(3.4, 2.3, 1.1), vSeed) * flick * (0.75 + 0.35 * uv.y);
        if (vShape > 2.5) lamp *= 1.6;
        float on = vLit * smoothstep(0.12, 0.55, uNight);
        vec3 inside = mix(glass, lamp, on);
        vec3 frameCol = mix(vec3(0.82, 0.8, 0.74) * uDay, vec3(0.04, 0.03, 0.03), on * 0.85);
        vec3 col = mix(inside, frameCol, wood);
        gl_FragColor = vec4(applyFog(col, vW), 1.);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.layers.enable(1);
  return { mesh, uniforms };
}

// Soft lights that only show at night: lit windows, far towns, lamps.
export function createGlows(list) {
  const pos = [], size = [], color = [], kind = [];
  for (const [x, y, z, s, cr, cg, cb, k] of list) {
    pos.push(x, y, z);
    size.push(s);
    color.push(cr, cg, cb);
    kind.push(k);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
  geo.setAttribute("aColor", new THREE.Float32BufferAttribute(color, 3));
  geo.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
  const uniforms = { uNight: { value: 0 }, uScale: { value: 600 }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSize, aKind;
      attribute vec3 aColor;
      uniform float uScale, uNight, uTime;
      varying vec3 vC;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * mv;
        float far = aKind > 0.5 && aKind < 1.5 ? 1. : 0.;
        gl_PointSize = clamp(aSize * uScale / -mv.z, far * 2.5, 120.);
        vC = aColor;
        vA = smoothstep(0.15, 0.7, uNight) * mix(0.5, 1.4, far) * (aKind > 1.5 ? 0.9 : 0.6) * (0.92 + 0.08 * sin(uTime * 2. + position.x));
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.;
        float a = (pow(max(1. - d, 0.), 3.) * 0.9 + pow(max(1. - d, 0.), 12.) * 2.) * vA;
        gl_FragColor = vec4(vC * a, 1.);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return { mesh: pts, uniforms };
}
