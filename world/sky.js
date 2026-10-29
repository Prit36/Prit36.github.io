import * as THREE from "three";
import { rng, noise, fbm, smooth } from "./land.js";
import { NOISE, FOG, U, stylize } from "./style.js";

// The sky keeps Surat's hours, the same way the banner does: the real height
// of the sun over Surat sets the light, and the moon keeps the opposite side
// of the sky in tonight's phase.

const RAD = Math.PI / 180;
const LAT = 21.17 * RAD, LON = 72.83;
export const sunAt = (t) => {
  const n = (t - Date.UTC(new Date(t).getUTCFullYear(), 0, 0)) / 864e5;
  const decl = -23.44 * RAD * Math.cos((2 * Math.PI / 365) * (n + 10));
  const b = (2 * Math.PI * (n - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const solar = ((t / 6e4) % 1440) + LON * 4 + eot;
  const H = (solar / 4 - 180) * RAD;
  const east = -Math.cos(decl) * Math.sin(H);
  const north = Math.sin(decl) * Math.cos(LAT) - Math.cos(decl) * Math.sin(LAT) * Math.cos(H);
  const up = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
  return { alt: Math.asin(up) / RAD, dir: new THREE.Vector3(east, up, -north).normalize() };
};
// 0 is a new moon, 0.5 a full one.
export const phaseAt = (t) => ((((t - Date.UTC(2000, 0, 6, 18, 14)) / 864e5 / 29.530588853) % 1) + 1) % 1;
export const PHASES = ["new moon", "waxing crescent", "first quarter", "waxing gibbous",
  "full moon", "waning gibbous", "last quarter", "waning crescent"];
export const smoothstep = smooth;

// Three palettes, mixed by how far the sun is below the horizon (night)
// and how close it is to it (gold). Colours are picked from the painting.
const C = (h) => new THREE.Color(h);
const DAY = {
  zenith: C("#2a68c4"), horizon: C("#b9d6ea"), fog: C("#bcd3e3"), glow: C("#fff0d0"), wisp: C("#f7f3ea"),
  cloudLit: C("#fff9ee"), cloudMid: C("#f4e6cf"), cloudShade: C("#a9b5d6"), cloudUnder: C("#8e9cc4"),
  hemiSky: C("#b4cdee"), hemiGround: C("#cdb38a"), light: C("#fff0d8"),
  waterDeep: C("#1b4aa2"), waterMid: C("#2380c2"), waterShallow: C("#2bb8bd"), waterClear: C("#79decb"),
  range: C("#7d98c8"), rangeFar: C("#a8bcdf"),
};
const GOLD = {
  zenith: C("#4a5ea8"), horizon: C("#f6a869"), fog: C("#e6b79c"), glow: C("#ffb25a"), wisp: C("#ffc8a0"),
  cloudLit: C("#ffd8a0"), cloudMid: C("#f4ab8c"), cloudShade: C("#9483b8"), cloudUnder: C("#76659c"),
  hemiSky: C("#ae9fd4"), hemiGround: C("#c48c66"), light: C("#ffad62"),
  waterDeep: C("#2c3d82"), waterMid: C("#4864a4"), waterShallow: C("#4c9aab"), waterClear: C("#82c4b6"),
  range: C("#8a76a8"), rangeFar: C("#cb9da0"),
};
const NIGHT = {
  zenith: C("#060d2b"), horizon: C("#1d2c5c"), fog: C("#1b2852"), glow: C("#3d4f8c"), wisp: C("#2c3a70"),
  cloudLit: C("#66769f"), cloudMid: C("#38457c"), cloudShade: C("#232c5c"), cloudUnder: C("#192046"),
  hemiSky: C("#4b5ea6"), hemiGround: C("#1e2444"), light: C("#a8bcff"),
  waterDeep: C("#071234"), waterMid: C("#0d2252"), waterShallow: C("#123e5c"), waterClear: C("#1d5864"),
  range: C("#141d44"), rangeFar: C("#1c2652"),
};
export const palette = {};
for (const k of Object.keys(DAY)) palette[k] = new THREE.Color();

// Everything the hour decides, worked out once per frame.
export function lightOf(t) {
  const sun = sunAt(t);
  const { alt } = sun;
  const night = smooth(4, -9, alt);
  const gold = Math.exp(-(((alt - 2.5) / 7) ** 2));
  const phase = phaseAt(t);
  for (const k of Object.keys(DAY)) {
    palette[k].copy(DAY[k]).lerp(NIGHT[k], night).lerp(GOLD[k], gold * (1 - 0.45 * night));
  }
  const sunUp = smooth(-2.5, 3, alt);
  const moonUp = smooth(1, -5, alt);
  const lit = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const moonDir = sun.dir.clone().negate();
  moonDir.y = Math.max(moonDir.y, 0.25);
  moonDir.normalize();
  // The light that casts shadows: the sun by day, the moon by night.
  const lightDir = alt > -1.5 ? sun.dir.clone() : moonDir.clone();
  if (lightDir.y < 0.07) lightDir.y = 0.07;
  lightDir.normalize();
  const strength = alt > -1.5
    ? sunUp * (0.8 + 0.6 * smooth(2, 32, alt))
    : moonUp * (0.16 + 0.26 * lit);
  return { t, alt, night, gold, phase, lit, sunDir: sun.dir, moonDir, lightDir, strength, sunUp, moonUp };
}

export function createSky() {
  const uniforms = {
    uZenith: { value: palette.zenith }, uHorizon: { value: palette.horizon },
    uGlow: { value: palette.glow }, uWisp: { value: palette.wisp },
    uMoon: { value: new THREE.Vector3(0, -1, 0) }, uPhase: { value: 0.5 }, uMoonUp: { value: 0 },
    uSunUp: U.uSunUp, uNight: U.uNight, uTime: U.uTime,
    uSunDir: U.uSunDir, uFogColor: U.uFogColor, uFogGlow: U.uFogGlow, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uGlow, uWisp, uMoon;
      uniform float uNight, uTime, uPhase, uSunUp, uMoonUp;
      varying vec3 vDir;
      ${NOISE}
      ${FOG}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float t = pow(clamp(h, 0., 1.), 0.42);
        vec3 col = mix(uHorizon, uZenith, t);
        // a little unevenness, the way a wash of paint dries
        col *= 0.97 + 0.06 * fbm2(d.xz / (abs(h) + 0.4) * 1.6 + 3.);
        float sd = max(dot(d, uSunDir), 0.);
        col += uGlow * (pow(sd, 5.) * 0.32 + pow(sd, 40.) * 0.7 + pow(sd, 500.) * 2.5) * uSunUp;
        // Thin streaks of high cloud, like the ones over the bay
        float az = atan(d.z, d.x);
        vec2 wp = vec2(az * 5. + uTime * 0.003, h * 24.);
        float w = fbm2(wp + vec2(fbm2(wp * 0.5) * 2.));
        float wisp = smoothstep(0.58, 0.82, w) * smoothstep(0.04, 0.12, h) * (1. - smoothstep(0.24, 0.45, h));
        col = mix(col, uWisp * (1. + pow(sd, 6.) * uSunUp), wisp * 0.55);
        if (uNight > 0.01) {
          vec3 p = d * 110.;
          vec3 cell = floor(p), f = fract(p) - 0.5;
          float r = hash13(cell);
          if (r > 0.93) {
            vec3 off = vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) - 0.5;
            float size = 0.09 + 0.14 * smoothstep(0.985, 1., r);
            float tw = 0.6 + 0.4 * sin(uTime * (1. + r * 30.) + r * 300.);
            vec3 sc = mix(vec3(1., 0.85, 0.7), vec3(0.8, 0.9, 1.), hash13(cell + 7.));
            col += sc * smoothstep(size, 0., length(f - off * 0.6)) * tw * uNight * smoothstep(0., 0.15, h) * (2. + 6. * smoothstep(0.99, 1., r));
          }
          float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.5, 0.79))) / 0.2, 2.));
          col += vec3(0.16, 0.18, 0.32) * band * fbm2(d.xy * 7. + d.z * 3.) * uNight * smoothstep(0., 0.3, h);
          // Now and then, a shooting star
          float per = floor(uTime / 9.), ph = fract(uTime / 9.) * 9.;
          if (ph < 0.8 && hash12(vec2(per, 3.)) > 0.3) {
            float a = hash12(vec2(per, 1.)) * 6.283, el = 0.35 + hash12(vec2(per, 2.)) * 0.5;
            vec3 s0 = vec3(cos(a) * cos(el), sin(el), sin(a) * cos(el));
            vec3 dir = normalize(cross(s0, vec3(0., 1., 0.)) + vec3(0., -0.45, 0.));
            vec3 head = normalize(s0 + dir * ph * 0.3), tail = normalize(s0 + dir * max(ph - 0.3, 0.) * 0.3);
            vec3 ab = head - tail;
            float tt = clamp(dot(d - tail, ab) / max(dot(ab, ab), 1e-6), 0., 1.);
            col += vec3(3.) * smoothstep(0.004, 0., length(d - tail - ab * tt)) * tt * (1. - ph / 0.8) * uNight;
          }
        }
        float md = dot(d, uMoon);
        if (uMoonUp > 0.001 && md > 0.9) {
          col += vec3(0.5, 0.58, 0.9) * (pow(max(md, 0.), 200.) * 0.5 + pow(max(md, 0.), 2000.) * 1.5) * uMoonUp;
          vec3 right = normalize(cross(uMoon, vec3(0., 1., 0.)));
          vec3 up = cross(right, uMoon);
          vec2 q = vec2(dot(d, right), dot(d, up)) / 0.035;
          float r2 = dot(q, q);
          if (r2 < 1.) {
            float k = cos(6.2831853 * uPhase), limb = sqrt(max(1. - q.y * q.y, 0.));
            bool lit = uPhase < 0.5 ? q.x > k * limb : q.x < -k * limb;
            float maria = 0.85 + 0.15 * fbm2(q * 2.2 + 4.);
            vec3 mc = lit ? vec3(2.2, 2.1, 1.9) * maria : mix(col, vec3(0.04, 0.05, 0.1), 0.6);
            col = mix(col, mc, smoothstep(1., 0.86, r2) * uMoonUp);
          }
        }
        col += vec3(1., 0.94, 0.82) * smoothstep(0.99962, 0.9998, sd) * 36. * uSunUp;
        // The same haze as the ground, for a point infinitely far away
        float dens = uFogDensity * exp(-uFogFalloff * max(cameraPosition.y, 0.));
        float fogT = h > 0.0005 ? 1. - exp(-dens / (uFogFalloff * h)) : 1.;
        col = mix(col, hazeColor(d), clamp(fogT, 0., 1.));
        gl_FragColor = vec4(col, 0.);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), mat);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  mesh.layers.enable(1);
  return { mesh, uniforms };
}

// Sculptural cumulus heaped up out of puffs: cream where the sun catches
// them, lavender in their own shade, with a bright edge when the sun is
// behind. Big ones over the sea to the south-west and over the mountains,
// like the painting.
export function createClouds() {
  const r = rng(77);
  const puffs = [];
  const banks = [];
  for (let c = 0; c < 26; c++) {
    const az = c < 9 ? Math.PI * (0.55 + r() * 0.8) : c < 17 ? -Math.PI * (0.1 + r() * 0.6) : r() * Math.PI * 2;
    banks.push({ az, dist: 1300 + r() * 2600, size: 130 + r() * 260 });
  }
  for (const { az, dist, size } of banks) {
    const alt = 300 + r() * 260 + dist * 0.05;
    const cx = Math.cos(az) * dist, cz = Math.sin(az) * dist;
    const tx = -Math.sin(az), tz = Math.cos(az);
    const mine = [];
    // a flat base, then puffs heaped on puffs, highest in the middle
    const base = 7 + Math.floor(size / 30);
    for (let i = 0; i < base; i++) {
      const u = (i / (base - 1)) * 2 - 1;
      const across = (r() * 2 - 1) * size * 0.22;
      const rad = size * (0.17 + 0.1 * r()) * (1 - 0.35 * u * u);
      mine.push({ x: cx + tx * u * size + Math.cos(az) * across, y: alt + rad * 0.3, z: cz + tz * u * size + Math.sin(az) * across, rad, u });
    }
    const heap = 18 + Math.floor(size / 7);
    for (let i = 0; i < heap; i++) {
      const p = mine[Math.floor(Math.pow(r(), 0.7) * mine.length)];
      const dome = 1 - p.u * p.u;
      const top = alt + size * (0.25 + 0.75 * dome) * 0.85;
      const a = r() * Math.PI * 2, up = 0.45 + r() * 0.55;
      const rad = p.rad * (0.55 + 0.35 * r());
      const y = p.y + p.rad * up * 0.8;
      if (y > top) continue;
      mine.push({ x: p.x + Math.cos(a) * p.rad * 0.5, y, z: p.z + Math.sin(a) * p.rad * 0.5, rad, u: p.u });
    }
    const lo = alt, hi = Math.max(...mine.map((m) => m.y + m.rad));
    for (const m of mine) puffs.push({ ...m, shade: (m.y - lo) / (hi - lo) });
  }
  const uniforms = {
    uLight: { value: new THREE.Vector3(0, 1, 0) },
    uLit: { value: palette.cloudLit }, uMid: { value: palette.cloudMid }, uShade: { value: palette.cloudShade },
    uUnder: { value: palette.cloudUnder }, uBright: { value: 1.3 },
    uSunUp: U.uSunUp, uTime: U.uTime,
    uSunDir: U.uSunDir, uFogColor: U.uFogColor, uFogGlow: U.uFogGlow, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff,
  };
  const geo = new THREE.IcosahedronGeometry(1, 3);
  geo.setAttribute("aShade", new THREE.InstancedBufferAttribute(Float32Array.from(puffs.map((p) => p.shade)), 1));
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(Float32Array.from(puffs.map(() => r() * 100)), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aShade, aSeed;
      varying vec3 vN, vW;
      varying float vShade;
      ${NOISE}
      void main() {
        vec3 p = position * (1. + (vnoise3(position * 2.2 + aSeed) - 0.5) * 0.3);
        mat4 m = modelMatrix * instanceMatrix;
        vec4 w = m * vec4(p, 1.);
        vW = w.xyz;
        vN = normalize(mat3(m) * normal);
        vShade = aShade;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLight, uLit, uMid, uShade, uUnder;
      uniform float uSunUp, uBright, uTime;
      varying vec3 vN, vW;
      varying float vShade;
      ${NOISE}
      ${FOG}
      void main() {
        vec3 n = normalize(vN);
        vec3 q = vW * 0.022;
        n = normalize(n + (vec3(vnoise3(q), vnoise3(q + 5.2), vnoise3(q - 9.1)) - 0.5) * 0.9);
        float l = dot(n, uLight);
        vec3 c = mix(uShade, uMid, smoothstep(-0.45, 0.1, l));
        c = mix(c, uLit * uBright, smoothstep(0.15, 0.6, l));
        c *= mix(0.8, 1., smoothstep(0., 0.6, vShade));
        c = mix(c, uUnder, smoothstep(-0.1, -0.75, n.y) * (1. - vShade) * 0.75);
        vec3 V = normalize(cameraPosition - vW);
        float edge = pow(1. - max(dot(n, V), 0.), 3.);
        float behind = pow(max(dot(-V, uLight), 0.), 5.);
        c += uLit * edge * (0.08 + 1.4 * behind) * mix(0.3, 1., uSunUp);
        gl_FragColor = vec4(applyFog(c, vW), 1.);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, puffs.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  puffs.forEach((pf, i) => {
    s.set(pf.rad, pf.rad * 0.8, pf.rad);
    mesh.setMatrixAt(i, m.compose(p.set(pf.x, pf.y, pf.z), q, s));
  });
  mesh.frustumCulled = false;
  mesh.layers.enable(1);
  const group = new THREE.Group();
  group.add(mesh);
  return { group, uniforms };
}

// The blue ranges beyond the walkable hills: real ridges, lit on one side
// and shaded on the other, gone blue with distance as the painting has them.
export function createRanges() {
  const segA = 300, segR = 30;
  const a0 = -Math.PI * 1.25, a1 = Math.PI * 0.55;
  const pos = [], col = [];
  const near = palette.range, c = new THREE.Color();
  const R0 = 5200, R1 = 13000;
  const at = (a, rr) => {
    const k = (rr - R0) / (R1 - R0);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    // broad massifs with a few sharper crests, like the painting's
    let ridge = 0, amp = 1, f = 1 / 3200;
    for (let o = 0; o < 5; o++) {
      const n = 1 - Math.abs(noise(x * f + o * 7.1, z * f - o * 3.3) * 2 - 1);
      ridge += (o < 2 ? n : n * n) * amp;
      amp *= 0.45; f *= 2.1;
    }
    const mass = fbm(x / 5200 + 9, z / 5200 - 4, 3);
    const ends = smooth(a0, a0 + 0.5, a) * smooth(a1, a1 - 0.4, a);
    const env = smooth(0, 0.3, k) * (0.55 + 0.45 * Math.sin(Math.min(1, k * 1.2) * Math.PI)) * ends;
    const h = (120 + 1500 * ridge * smooth(0.25, 0.7, mass) + 260 * ridge) * env - 180 * (1 - smooth(0, 0.06, k));
    return [x, h, z];
  };
  const grid = [];
  for (let j = 0; j <= segR; j++) {
    const rr = R0 + (R1 - R0) * Math.pow(j / segR, 1.3);
    const row = [];
    for (let i = 0; i <= segA; i++) row.push(at(a0 + ((a1 - a0) * i) / segA, rr));
    grid.push(row);
  }
  const idx = [];
  const W2 = segA + 1;
  for (let j = 0; j <= segR; j++) for (let i = 0; i <= segA; i++) {
    const [x, h, z] = grid[j][i];
    pos.push(x, h, z);
    c.set("#5f7d66").lerp(new THREE.Color("#8f8a8c"), smooth(500, 1500, h));
    col.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < segR; j++) for (let i = 0; i < segA; i++) {
    const a = j * W2 + i;
    idx.push(a, a + 1, a + W2, a + 1, a + W2 + 1, a + W2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Painted the way the far terrain is: spurs catching the light, forest
  // dark in the folds, bare rock high up, all of it gone blue with distance
  const mat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true }), {
    key: "ranges",
    defines: { WRAP: 0.2 },
    color: /* glsl */ `{
      vec3 P = vWorldP;
      float rid = 0.;
      vec2 q = P.xz * 0.0011 + 3.;
      float a = 0.5;
      for (int i = 0; i < 5; i++) { float v = 1. - abs(vnoise(q) * 2. - 1.); rid += a * v * v; q = q * 2.1 + 5.3; a *= 0.5; }
      gBump += (rid - 0.4) * 240.;
      float slope = 1. - normalize(vWorldN).y;
      float wood = smoothstep(0.42, 0.62, fbm2(P.xz * 0.0009) + (0.45 - rid) * 0.6);
      vec3 c = mix(vec3(0.13, 0.2, 0.12), vec3(0.055, 0.1, 0.06), wood);
      c = mix(c, vec3(0.3, 0.28, 0.27), clamp(smoothstep(0.55, 0.85, rid) * smoothstep(0.15, 0.45, slope) + smoothstep(800., 1500., P.y) * 0.7, 0., 1.));
      c *= 0.72 + 0.5 * rid;
      diffuseColor.rgb = c;
    }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.layers.enable(1);
  return { mesh, near };
}
