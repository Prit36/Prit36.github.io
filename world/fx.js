import * as THREE from "three";
import { U } from "./style.js";

// Fireworks over the cove. Every spark is worked out on the GPU from where
// and when it set off: it flies out, slows in the air, falls, and fades,
// the gold ones crackling. The CPU only flies the rockets up and writes in
// each burst as it happens.

const MAX = 24000;
const PALETTES = [
  [[4.2, 1.2, 0.45], [4.5, 3.2, 1.4]],   // red and gold
  [[1.2, 2.2, 5.0], [3.8, 3.8, 4.4]],    // blue and silver
  [[1.4, 4.0, 1.6], [4.6, 3.6, 1.2]],    // green and gold
  [[4.0, 1.4, 3.6], [1.6, 2.6, 5.0]],    // magenta and blue
  [[4.6, 3.0, 1.0], [4.6, 3.0, 1.0]],    // all gold, a willow
  [[4.2, 4.0, 3.6], [4.0, 1.6, 0.6]],    // white and orange
];

export function createFireworks() {
  const geo = new THREE.BufferGeometry();
  const origin = new Float32Array(MAX * 3), vel = new Float32Array(MAX * 3);
  const when = new Float32Array(MAX * 4);   // start, life, drag, kind
  const color = new Float32Array(MAX * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(origin, 3));
  geo.setAttribute("aVel", new THREE.BufferAttribute(vel, 3));
  geo.setAttribute("aWhen", new THREE.BufferAttribute(when, 4));
  geo.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
  for (let i = 0; i < MAX; i++) when[i * 4] = -999;
  const uniforms = { uNow: { value: 0 }, uScale: { value: 600 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aVel, aColor;
      attribute vec4 aWhen;
      uniform float uNow, uScale;
      varying vec3 vC;
      varying float vA;
      float h(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float t = uNow - aWhen.x, life = aWhen.y, k = aWhen.z;
        if (t < 0. || t > life) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }
        // out against the air, then down
        float fly = (1. - exp(-k * t)) / k;
        vec3 p = position + aVel * fly + vec3(0., -4.2, 0.) * t * t * (aWhen.w > 1.5 ? 0.25 : 0.5);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float u = t / life;
        float a = (1. - smoothstep(0.55, 1., u)) * smoothstep(0., 0.04, t);
        // the gold ones twinkle as they die
        if (aWhen.w > 0.5 && aWhen.w < 1.5) a *= mix(1., step(0.5, h(floor(uNow * 18.) + position.x * 7.1 + aVel.y * 13.)), smoothstep(0.35, 0.6, u));
        vC = aColor * mix(1.4, 0.6, u);
        vA = a;
        gl_PointSize = clamp((aWhen.w > 2.5 ? 0.5 : 1.0) * uScale / -mv.z, 1.8, 26.);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.;
        float a = (pow(max(1. - d, 0.), 2.) * 0.6 + pow(max(1. - d, 0.), 8.)) * vA;
        gl_FragColor = vec4(vC * a, 1.);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 7;
  points.layers.enable(1);
  // A flash that lights the bay and the water under each burst
  const flash = new THREE.PointLight("#ffd6a0", 0, 420, 1.4);
  flash.layers.enable(1);
  const group = new THREE.Group();
  group.add(points, flash);

  let next = 0, now = 0;
  const lo = { n: MAX, hi: 0 };
  const put = (p, v, life, drag, kind, c) => {
    const i = next;
    next = (next + 1) % MAX;
    origin.set(p, i * 3);
    vel.set(v, i * 3);
    when.set([now, life, drag, kind], i * 4);
    color.set(c, i * 3);
    lo.n = Math.min(lo.n, i);
    lo.hi = Math.max(lo.hi, i);
  };
  const rockets = [];
  const queue = [];
  let flashK = 0;
  const flashCol = new THREE.Color();

  const burst = (p, events) => {
    const [a, b] = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const style = Math.random();
    const n = 300 + Math.floor(Math.random() * 180);
    const speed = 34 + Math.random() * 16;
    const willow = a === b;
    for (let i = 0; i < n; i++) {
      // even over a sphere, a little ragged
      const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), th = i * 2.39996;
      let v = [Math.cos(th) * r, y, Math.sin(th) * r];
      let s = speed * (0.88 + Math.random() * 0.24);
      if (style < 0.25) {
        // a ring, tilted
        v = [Math.cos(th), (Math.random() - 0.5) * 0.12, Math.sin(th)];
        s = speed;
      }
      const c = i % 3 === 0 ? b : a;
      put(p, [v[0] * s, v[1] * s + 2, v[2] * s], willow ? 3.8 + Math.random() : 2.4 + Math.random() * 0.9, willow ? 1.5 : 1.9, willow || c === b ? 1 : 0, c);
    }
    // a second, smaller heart of a different colour
    if (style > 0.6) {
      const [c2] = PALETTES[Math.floor(Math.random() * PALETTES.length)];
      for (let i = 0; i < 90; i++) {
        const y = 1 - (2 * (i + 0.5)) / 90, r = Math.sqrt(1 - y * y), th = i * 2.39996;
        put(p, [Math.cos(th) * r * 16, y * 16 + 1, Math.sin(th) * r * 16], 1.7, 2.4, 0, c2);
      }
    }
    flashK = 1;
    flashCol.setRGB(a[0], a[1], a[2]).multiplyScalar(0.25);
    flash.position.set(...p);
    events?.boom(p, willow || style > 0.5);
  };

  return {
    group,
    uniforms,
    get busy() { return rockets.length > 0 || queue.length > 0; },
    // A show: `count` shells from (x, z), one every so often
    show(x, z, count = 14, every = 0.9) {
      for (let i = 0; i < count; i++) queue.push({ at: now + i * every * (0.6 + Math.random() * 0.8) + (i > count - 4 ? 0.4 : 0), x, z });
    },
    update(dt, events) {
      now += dt;
      uniforms.uNow.value = now;
      for (let i = queue.length - 1; i >= 0; i--) {
        const q = queue[i];
        if (q.at > now) continue;
        queue.splice(i, 1);
        const h = 70 + Math.random() * 45;
        const sx = q.x + (Math.random() - 0.5) * 24, sz = q.z + (Math.random() - 0.5) * 24;
        rockets.push({ p: new THREE.Vector3(sx, 1, sz), v: new THREE.Vector3((Math.random() - 0.5) * 4, 44 + Math.random() * 8, (Math.random() - 0.5) * 4), top: h });
        events?.launch([sx, 1, sz]);
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.v.y -= 9.8 * dt;
        r.p.addScaledVector(r.v, dt);
        // its trail of sparks
        for (let k = 0; k < 3; k++) put([r.p.x, r.p.y - k * 0.3, r.p.z], [(Math.random() - 0.5) * 1.5, -2 - Math.random() * 2, (Math.random() - 0.5) * 1.5], 0.5 + Math.random() * 0.4, 3, 3, [3.2, 2.0, 0.9]);
        if (r.p.y >= r.top || r.v.y < 6) {
          rockets.splice(i, 1);
          burst([r.p.x, r.p.y, r.p.z], events);
        }
      }
      if (lo.hi >= lo.n) {
        for (const name of ["position", "aVel", "aWhen", "aColor"]) {
          const attr = geo.attributes[name];
          attr.clearUpdateRanges();
          attr.addUpdateRange(lo.n * attr.itemSize, (lo.hi - lo.n + 1) * attr.itemSize);
          attr.needsUpdate = true;
        }
        lo.n = MAX; lo.hi = 0;
      }
      flashK *= Math.exp(-dt * 3.2);
      flash.intensity = flashK * 320 * (0.3 + 0.7 * U.uNight.value);
      flash.color.copy(flashCol).multiplyScalar(1 / Math.max(flashCol.r, flashCol.g, flashCol.b, 1e-3));
    },
  };
}

// Spray: droplets thrown up by a splash, sand kicked up by a landing, dust,
// and the embers of a lantern catching. Like the fireworks, each grain is
// worked out on the GPU from where and when it was thrown; the CPU only
// writes a burst in when it happens.
const SPRAY = {
  water: { c: [0.86, 0.94, 1], size: 0.06, g: 9.8, drag: 0.6, life: 0.9, glow: 0 },
  mist: { c: [0.9, 0.95, 1], size: 0.22, g: 1.2, drag: 2.4, life: 1.3, glow: 0 },
  sand: { c: [0.86, 0.76, 0.56], size: 0.05, g: 9.8, drag: 1.2, life: 0.8, glow: 0 },
  dust: { c: [0.82, 0.76, 0.64], size: 0.32, g: -0.15, drag: 2.2, life: 1.6, glow: 0 },
  ember: { c: [3.2, 1.7, 0.6], size: 0.05, g: -1.4, drag: 1.1, life: 1.8, glow: 1 },
  spark: { c: [4, 3, 1.6], size: 0.035, g: 2.5, drag: 2.2, life: 0.9, glow: 1 },
};
function sprayPoints(max, additive) {
  const geo = new THREE.BufferGeometry();
  const origin = new Float32Array(max * 3), vel = new Float32Array(max * 3), when = new Float32Array(max * 4), color = new Float32Array(max * 4);
  geo.setAttribute("position", new THREE.BufferAttribute(origin, 3));
  geo.setAttribute("aVel", new THREE.BufferAttribute(vel, 3));
  geo.setAttribute("aWhen", new THREE.BufferAttribute(when, 4));     // start, life, gravity, drag
  geo.setAttribute("aColor", new THREE.BufferAttribute(color, 4));   // rgb, size
  for (let i = 0; i < max; i++) when[i * 4] = -999;
  const uniforms = { uNow: { value: 0 }, uScale: { value: 600 }, uLight: { value: new THREE.Color(1, 1, 1) } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aVel;
      attribute vec4 aWhen, aColor;
      uniform float uNow, uScale;
      uniform vec3 uLight;
      varying vec3 vC;
      varying float vA;
      void main() {
        float t = uNow - aWhen.x, life = aWhen.y;
        if (t < 0. || t > life) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }
        float k = aWhen.w;
        vec3 p = position + aVel * (1. - exp(-k * t)) / k - vec3(0., aWhen.z * 0.5 * t * t, 0.);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float u = t / life;
        vA = (1. - smoothstep(0.45, 1., u)) * smoothstep(0., 0.05, t);
        vC = aColor.rgb * ${additive ? "1." : "uLight"};
        gl_PointSize = clamp(aColor.a * (1. + u * 0.6) * uScale / -mv.z, 1., 48.);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.;
        float a = pow(max(1. - d, 0.), ${additive ? "2." : "1.4"}) * vA;
        ${additive ? "gl_FragColor = vec4(vC * a, 1.);" : "gl_FragColor = vec4(vC, a * 0.85);"}
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  let next = 0;
  const lo = { n: max, hi: 0 };
  const put = (p, v, life, g, drag, c, size, now) => {
    const i = next;
    next = (next + 1) % max;
    origin[i * 3] = p[0]; origin[i * 3 + 1] = p[1]; origin[i * 3 + 2] = p[2];
    vel[i * 3] = v[0]; vel[i * 3 + 1] = v[1]; vel[i * 3 + 2] = v[2];
    when[i * 4] = now; when[i * 4 + 1] = life; when[i * 4 + 2] = g; when[i * 4 + 3] = drag;
    color[i * 4] = c[0]; color[i * 4 + 1] = c[1]; color[i * 4 + 2] = c[2]; color[i * 4 + 3] = size;
    lo.n = Math.min(lo.n, i);
    lo.hi = Math.max(lo.hi, i);
  };
  const flush = () => {
    if (lo.hi < lo.n) return;
    for (const name of ["position", "aVel", "aWhen", "aColor"]) {
      const attr = geo.attributes[name];
      attr.clearUpdateRanges();
      attr.addUpdateRange(lo.n * attr.itemSize, (lo.hi - lo.n + 1) * attr.itemSize);
      attr.needsUpdate = true;
    }
    lo.n = max; lo.hi = 0;
  };
  return { points, uniforms, put, flush };
}

export function createSpray() {
  const soft = sprayPoints(2400, false), bright = sprayPoints(800, true);
  const group = new THREE.Group();
  group.add(soft.points, bright.points);
  let now = 0;
  const v = [0, 0, 0], c = [0, 0, 0];
  // n grains of a kind from p, flung up at `up` and out at `out`, scattered a little
  const emit = (kind, p, n, up = 3, out = 2, tint = null) => {
    const s = SPRAY[kind], sys = s.glow ? bright : soft, base = tint || s.c;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, o = out * (0.35 + Math.random() * 0.65);
      v[0] = Math.cos(a) * o; v[1] = up * (0.55 + Math.random() * 0.6); v[2] = Math.sin(a) * o;
      const j = 0.88 + Math.random() * 0.24;
      c[0] = base[0] * j; c[1] = base[1] * j; c[2] = base[2] * j;
      sys.put(p, v, s.life * (0.7 + Math.random() * 0.6), s.g, s.drag, c, s.size * (0.7 + Math.random() * 0.6), now);
    }
  };
  return {
    group,
    // a splash: a crown of droplets, and a little mist
    splash(x, y, z, size = 1) {
      emit("water", [x, y + 0.05, z], Math.round(10 + 26 * Math.min(1.6, size)), 2.2 + 2.6 * size, 0.8 + 1.4 * size);
      emit("mist", [x, y + 0.1, z], Math.round(3 + 4 * size), 0.6 * size, 0.8 * size);
    },
    // a foot coming down: sand flies on the beach, dust on the paths
    kick(x, y, z, surface, size = 1) {
      if (surface === "sand") {
        emit("sand", [x, y + 0.03, z], Math.round(6 + 14 * size), 1.4 + 1.6 * size, 0.6 + size);
        emit("dust", [x, y + 0.05, z], Math.round(1 + 3 * size), 0.25, 0.7 * size, [0.9, 0.82, 0.66]);
      } else if (surface === "grass") {
        emit("dust", [x, y + 0.05, z], Math.round(1 + 2 * size), 0.2, 0.5 * size, [0.7, 0.72, 0.56]);
      } else if (surface !== "water") {
        emit("dust", [x, y + 0.04, z], Math.round(2 + 4 * size), 0.25, 0.8 * size);
      }
    },
    // a flame catching: sparks thrown out, then embers drifting up
    embers(x, y, z, n = 26) {
      emit("spark", [x, y, z], n, 1.2, 2.6);
      emit("ember", [x, y, z], Math.round(n * 0.6), 1.3, 0.5);
    },
    update(dt, scale, light) {
      now += dt;
      for (const s of [soft, bright]) { s.uniforms.uNow.value = now; s.uniforms.uScale.value = scale; s.flush(); }
      soft.uniforms.uLight.value.copy(light);
    },
  };
}

// Smoke from chimneys, mornings and evenings when the stoves are lit: a
// thread of soft puffs rising, spreading, and leaning off with the wind.
// Nothing moves on the CPU; each puff knows its chimney and how far through
// its rise it is.
export function createSmoke(spots, per = 7) {
  const n = spots.length * per;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 2);
  spots.forEach(([x, y, z], i) => {
    for (let k = 0; k < per; k++) {
      const j = i * per + k;
      pos.set([x, y, z], j * 3);
      seed[j * 2] = k / per;
      seed[j * 2 + 1] = Math.random();
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 2));
  const uniforms = { uTime: U.uTime, uWind: U.uWind, uScale: { value: 600 }, uAmount: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec2 aSeed;
      uniform float uTime, uScale, uAmount;
      uniform vec2 uWind;
      varying float vA, vK;
      void main() {
        float k = fract(uTime / 9. + aSeed.x + aSeed.y * 0.13);
        // only some chimneys are lit
        float on = step(0.45, fract(sin(dot(position.xz, vec2(12.99, 78.23))) * 437.5)) * uAmount;
        vec3 p = position + vec3(uWind.x, 0., uWind.y) * k * k * 9. + vec3(sin(uTime * 0.7 + aSeed.y * 9.) * 0.4, k * 7.5, cos(uTime * 0.6 + aSeed.y * 7.) * 0.4) * k;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((0.5 + 2.6 * k) * uScale / -mv.z, 0., 140.) * step(0.01, on);
        vA = on * smoothstep(0., 0.12, k) * (1. - smoothstep(0.3, 1., k)) * 0.2;
        vK = k;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLight;
      varying float vA, vK;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        // a ragged edge, never a disc
        float ang = atan(q.y, q.x);
        float d = length(q) * 2. * (1. + 0.16 * sin(ang * 5. + vK * 11.) + 0.1 * sin(ang * 9. - vK * 7.));
        float a = pow(smoothstep(1., 0., d), 1.6) * vA;
        gl_FragColor = vec4(uLight * mix(0.78, 0.92, vK) * (0.92 - 0.12 * q.y), a);
      }`,
  });
  const mesh = new THREE.Points(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return { mesh, uniforms };
}
