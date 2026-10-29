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
