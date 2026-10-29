import * as THREE from "three";
import { heightAt, groundAt, grassAt, rng } from "./land.js";
import { stylize, toonish, U } from "./style.js";

// Things that move by themselves: gulls over the cove, butterflies over the
// flowers, pollen drifting in the sun, fireflies in the olive terraces at
// night, cats in the village, a fish that jumps now and then, the stones you
// skip, and the red ball on the pier.

const r = rng(11);

export function createGulls(count = 16) {
  const pos = [], col = [];
  const tri = (a, b, c, color) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) col.push(...color); };
  const white = [0.95, 0.94, 0.9], grey = [0.55, 0.6, 0.66], tip = [0.08, 0.09, 0.1];
  const n = [0, 0, 0.42], t = [0, 0, -0.38], u = [0, 0.09, 0], d = [0, -0.07, 0.02], lft = [-0.08, 0, 0.05], rgt = [0.08, 0, 0.05];
  for (const [a, b] of [[u, rgt], [rgt, d], [d, lft], [lft, u]]) { tri(n, a, b, white); tri(t, b, a, white); }
  for (const s of [-1, 1]) {
    const rootF = [0.07 * s, 0.02, 0.15], rootB = [0.07 * s, 0.02, -0.1], elbow = [0.42 * s, 0.04, 0.1], wtip = [0.85 * s, 0, -0.2];
    tri(rootF, rootB, elbow, grey);
    tri(elbow, rootB, wtip, tip);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const phases = new Float32Array(count).map(() => r() * 6.28);
  geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
  const uStartle = { value: 0 };
  const mat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), {
    key: "gull",
    defines: { RIM: "0.3", WRAP: "0.3" },
    uniforms: { uStartle },
    vertexPars: "uniform float uStartle;\nattribute float aPhase;",
    vertex: `
      float wing = max(abs(position.x) - 0.07, 0.);
      float flapping = max(smoothstep(-0.1, 0.7, sin(uTime * 0.37 + aPhase)), uStartle);
      transformed.y += wing * (sin(uTime * (8. + uStartle * 4.) + aPhase * 5.) * 0.95 * flapping + 0.16);`,
    normal: "normal = normalize(vNormal);",
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.layers.enable(1);
  const birds = Array.from({ length: count }, (_, i) => ({
    cx: i < 10 ? -20 + r() * 80 : -190 + r() * 40, cz: i < 10 ? -60 + r() * 60 : -60 + r() * 30,
    rad: 25 + r() * 90, alt: 16 + r() * 40, sp: (r() < 0.5 ? -1 : 1) * (0.08 + r() * 0.1), ang: r() * 6.28, ph: phases[i],
  }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  let startle = 0;
  const update = (dt, t, night) => {
    startle = Math.max(0, startle - dt * 0.12);
    uStartle.value = Math.min(1, startle * 1.5);
    const show = night > 0.75 ? 0 : 1.3;
    birds.forEach((b, i) => {
      b.ang += b.sp * dt * (1 + startle * 2.5);
      const rad = b.rad * (1 + startle * 0.6);
      p.set(b.cx + Math.cos(b.ang) * rad, b.alt + Math.sin(t * 0.3 + b.ph) * 4 + startle * 22, b.cz + Math.sin(b.ang) * rad);
      const sg = Math.sign(b.sp);
      e.set(0, Math.atan2(-Math.sin(b.ang) * sg, Math.cos(b.ang) * sg), -sg * 0.35, "YXZ");
      mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), s.setScalar(show)));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  return { mesh, update, startle: () => { startle = 1; }, birds };
}

// Butterflies, out by day over the flowers near you
export function createButterflies(count = 30) {
  const pos = [], col = [];
  for (const s of [-1, 1]) {
    const a = [0, 0, 0.02], b = [0.11 * s, 0, 0.09], c = [0.13 * s, 0, -0.03], d = [0, 0, -0.04], e = [0.08 * s, 0, -0.12];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d, ...d, ...c, ...e);
    for (let i = 0; i < 9; i++) col.push(1, 1, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(new Float32Array(count).map(() => r() * 6.28), 1));
  const mat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), {
    key: "butterfly",
    defines: { WRAP: "0.5", FOLIAGE: "0.6" },
    vertexPars: "attribute float aPhase;",
    vertex: `
      float a = sin(uTime * 17. + aPhase * 9.) * 1.15 + 0.35;
      float x = transformed.x;
      transformed.x = x * cos(a);
      transformed.y = abs(x) * sin(a);`,
    normal: "normal = normalize(vNormal);",
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  const COLS = ["#f6f2e4", "#f2d34a", "#f08a2c", "#8fb8f0", "#f4f0e8", "#e9e17a"];
  const c = new THREE.Color();
  const flies = Array.from({ length: count }, (_, i) => {
    mesh.setColorAt(i, c.set(COLS[i % COLS.length]));
    return { home: new THREE.Vector3(1e5, 0, 0), p: new THREE.Vector3(1e5, 0, 0), ph: r() * 6.28, sp: 0.6 + r() * 0.6 };
  });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), last = new THREE.Vector3();
  const update = (dt, t, player, day) => {
    flies.forEach((f, i) => {
      if (f.home.distanceTo(player) > 40 || r() < dt * 0.02) {
        for (let k = 0; k < 8; k++) {
          const a = r() * 6.28, d = 6 + r() * 26;
          const x = player.x + Math.cos(a) * d, z = player.z + Math.sin(a) * d;
          if (grassAt(x, z) > 0.25 && heightAt(x, z) > 1) { f.home.set(x, heightAt(x, z), z); break; }
        }
        if (f.p.x > 1e4) f.p.copy(f.home);
      }
      last.copy(f.p);
      const tt = t * f.sp + f.ph;
      const want = new THREE.Vector3(f.home.x + Math.sin(tt * 0.7) * 3 + Math.sin(tt * 2.3) * 0.6, f.home.y + 0.7 + Math.sin(tt * 1.7) * 0.45 + Math.max(0, Math.sin(tt * 0.31)) * 1.4, f.home.z + Math.cos(tt * 0.5) * 3 + Math.cos(tt * 2.9) * 0.5);
      f.p.lerp(want, Math.min(1, dt * 2));
      const vx = f.p.x - last.x, vz = f.p.z - last.z;
      e.set(0, Math.atan2(vx, vz), 0, "YXZ");
      mesh.setMatrixAt(i, m.compose(f.p, q.setFromEuler(e), s.setScalar(day > 0.4 && f.home.x < 1e4 ? 1.1 : 0)));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  return { mesh, update };
}

// Pollen and dust, drifting in the light around you
export function createMotes(count = 700) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { pos.set([r(), r(), r()], i * 3); seed[i] = r(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const uniforms = { uCenter: { value: new THREE.Vector3() }, uScale: { value: 600 }, uAmount: { value: 1 }, uTime: U.uTime, uSunDir: U.uSunDir, uWind: U.uWind };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform vec3 uCenter, uSunDir;
      uniform vec2 uWind;
      uniform float uTime, uScale, uAmount;
      varying float vA;
      void main() {
        vec3 box = vec3(28., 12., 28.);
        vec3 p = position * box + vec3(uWind.x, 0.05, uWind.y) * uTime * (0.4 + aSeed * 0.5);
        p += vec3(sin(uTime * 0.7 + aSeed * 40.), sin(uTime * 0.5 + aSeed * 23.) * 0.5, cos(uTime * 0.6 + aSeed * 31.)) * 0.6;
        p = mod(p - uCenter + box * 0.5, box) - box * 0.5 + uCenter;
        vec4 mv = viewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(0.045 * uScale / -mv.z, 1., 6.);
        vec3 V = normalize(p - cameraPosition);
        float toward = pow(max(dot(V, uSunDir), 0.), 4.);
        float edge = 1. - smoothstep(9., 14., length(p.xz - uCenter.xz));
        vA = (0.025 + 1.2 * toward) * edge * uAmount * (0.6 + 0.4 * sin(uTime * 2. + aSeed * 50.));
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.;
        gl_FragColor = vec4(vec3(1.4, 1.2, 0.8) * pow(max(1. - d, 0.), 2.) * vA, 1.);
      }`,
  });
  const mesh = new THREE.Points(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

export function createFireflies(spots) {
  const pos = [], seed = [];
  for (const [x, y, z] of spots) { pos.push(x, y, z); seed.push(r()); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
  const uniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uScale: { value: 600 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uNight, uScale;
      varying float vA;
      void main() {
        float s = aSeed * 40.;
        vec3 p = position + vec3(sin(uTime * 0.5 + s) * 1.6, sin(uTime * 0.7 + s * 1.3) * 0.7, cos(uTime * 0.43 + s * 0.7) * 1.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(0.7 * uScale / -mv.z, 2., 22.);
        vA = smoothstep(0.35, 0.8, uNight) * smoothstep(0.55, 0.95, sin(uTime * 1.6 + s) * 0.5 + 0.5);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.;
        gl_FragColor = vec4(vec3(2.2, 2.6, 0.9) * pow(max(1. - d, 0.), 2.) * vA, 1.);
      }`,
  });
  const mesh = new THREE.Points(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

export function createFish() {
  const geo = new THREE.OctahedronGeometry(1, 1);
  geo.scale(0.09, 0.13, 0.36);
  const tail = new THREE.ConeGeometry(0.12, 0.18, 3);
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0, -0.42);
  const mesh = new THREE.Group();
  const mat = toonish("#a9c3d4", { defines: { RIM: "0.5" } });
  mesh.add(new THREE.Mesh(geo, mat), new THREE.Mesh(tail, mat));
  mesh.visible = false;
  let next = 3, jump = null;
  const update = (dt, player, events) => {
    next -= dt;
    if (!jump && next < 0) {
      next = 3 + r() * 6;
      for (let i = 0; i < 12; i++) {
        const a = r() * 6.28, dd = 14 + r() * 60;
        const x = player.x + Math.cos(a) * dd, z = player.z + Math.sin(a) * dd;
        if (heightAt(x, z) < -2) {
          const h = r() * 6.28;
          jump = { x, z, dx: Math.cos(h), dz: Math.sin(h), k: 0, len: 1.6 + r() * 1.6, high: 0.6 + r() * 0.9 };
          events.splash(x, z, 0.4);
          break;
        }
      }
    }
    if (!jump) { mesh.visible = false; return; }
    jump.k += dt / 0.85;
    const k = Math.min(1, jump.k);
    mesh.visible = true;
    mesh.position.set(jump.x + jump.dx * jump.len * k, jump.high * 4 * k * (1 - k) - 0.15, jump.z + jump.dz * jump.len * k);
    mesh.rotation.set(-(1 - 2 * k) * 1.1, Math.atan2(jump.dx, jump.dz), 0, "YXZ");
    if (jump.k >= 1) {
      events.splash(mesh.position.x, mesh.position.z, 0.5);
      jump = null;
    }
  };
  return { mesh, update };
}

// Stones for skipping. Flat ones, of course.
export function createStones(count = 14) {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  geo.scale(0.1, 0.035, 0.08);
  const mat = toonish("#8e8a82");
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const stones = Array.from({ length: count }, () => ({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), spin: 0, skips: 0, state: "", life: 0, luck: 1 }));
  let next = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3();
  const throwStone = (from, dir, carry) => {
    const s = stones[next];
    next = (next + 1) % count;
    s.on = true;
    s.state = "fly";
    s.skips = 0;
    s.life = 0;
    // No two stones are quite the same shape
    s.luck = 0.72 + Math.random() * 0.24;
    s.p.copy(from);
    s.v.copy(dir).multiplyScalar(19).add(carry);
    s.v.y += 2.2;
  };
  const update = (dt, events) => {
    stones.forEach((s, i) => {
      if (!s.on) { mesh.setMatrixAt(i, m.compose(zero, q, zero)); return; }
      s.life += dt;
      if (s.state === "fly") {
        s.v.y -= 17 * dt;
        s.p.addScaledVector(s.v, dt);
        s.spin += dt * 25;
        const ground = groundAt(s.p.x, s.p.z, s.p.y).y;
        if (s.p.y <= 0 && ground < -0.15) {
          const vh = Math.hypot(s.v.x, s.v.z);
          if (vh > 4.5 && -s.v.y < vh * 0.55 && s.skips < 30 && Math.random() > 0.02 * s.skips) {
            s.skips++;
            s.p.y = 0.01;
            s.v.y = Math.abs(s.v.y) * 0.4 + 0.8 + vh * 0.07;
            s.v.x *= s.luck;
            s.v.z *= s.luck;
            events.skip(s.p.x, s.p.z, s.skips);
          } else {
            s.state = "sink";
            s.life = 0;
            events.sink(s.p.x, s.p.z, s.skips);
          }
        } else if (s.p.y <= ground) {
          s.p.y = ground + 0.03;
          s.state = "rest";
          s.life = 0;
          events.land(s.p.x, s.p.z, s.skips);
        }
        if (s.life > 12) s.on = false;
      } else if (s.state === "sink") {
        s.p.y -= dt * 0.8;
        if (s.life > 1.2) s.on = false;
      } else if (s.life > 8) {
        s.on = false;
      }
      e.set(0.2, s.spin, 0.1);
      mesh.setMatrixAt(i, m.compose(s.p, q.setFromEuler(e), one));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  return { mesh, throwStone, update, list: stones };
}

// The red ball from Bounce. Walk into it.
export function createBall(home) {
  const mat = toonish("#e03b2b", { defines: { RIM: "0.35", WRAP: "0.05" } });
  const R = 0.34;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), mat);
  mesh.castShadow = true;
  const band = new THREE.Mesh(new THREE.TorusGeometry(R * 1.002, 0.03, 6, 32), toonish("#f6efe0"));
  mesh.add(band);
  const p = new THREE.Vector3(...home), v = new THREE.Vector3();
  let cool = 0;
  const reset = () => { p.set(home[0], home[1] + 1.5, home[2]); v.set(0, 0, 0); };
  reset();
  const update = (dt, player, events) => {
    cool -= dt;
    v.y -= 20 * dt;
    p.addScaledVector(v, dt);
    const g = groundAt(p.x, p.z, p.y - R).y;
    if (g < -0.25 && p.y < 0.3) {
      // floating
      v.y += (0.12 - p.y) * 40 * dt - v.y * 3 * dt;
      v.x *= 1 - dt * 0.6;
      v.z *= 1 - dt * 0.6;
      if (Math.abs(v.y) > 3) events.splash(p.x, p.z, 0.4);
    } else if (p.y - R < g) {
      p.y = g + R;
      if (v.y < -2) events.bounce(p, -v.y);
      v.y = Math.abs(v.y) * 0.72;
      if (v.y < 0.6) v.y = 0;
      v.x *= 1 - dt * 1.5;
      v.z *= 1 - dt * 1.5;
    }
    // A kick, from whoever walks into it
    const dx = p.x - player.pos.x, dz = p.z - player.pos.z, dy = p.y - (player.pos.y + 0.4);
    const d = Math.hypot(dx, dz);
    if (d < R + 0.45 && Math.abs(dy) < 1 && cool <= 0) {
      const speed = Math.hypot(player.vel.x, player.vel.z);
      v.set(dx / (d || 1) * (3 + speed * 1.1), 4 + speed * 0.35, dz / (d || 1) * (3 + speed * 1.1));
      cool = 0.3;
      events.bounce(p, 6);
    }
    if (Math.hypot(p.x - home[0], p.z - home[2]) > 220 || p.y < -20) reset();
    mesh.position.copy(p);
    mesh.rotation.x += v.z * dt / R;
    mesh.rotation.z -= v.x * dt / R;
  };
  const hit = (impulse) => { v.add(impulse); };
  return { mesh, update, hit, p };
}

// ------------------------------------------------------------------ cats
// The village cats. They sit in the sun, wander, and if you come close and
// make a fuss of them, they purr and follow you about for a while.
function catModel(coat, belly, mark) {
  const g = new THREE.Group();
  const fur = toonish(coat, { defines: { RIM: "0.35", WRAP: "0.35" } });
  const pale = toonish(belly, { defines: { RIM: "0.35", WRAP: "0.35" } });
  const dark = toonish(mark, { defines: { RIM: "0.3", WRAP: "0.35" } });
  const ball = new THREE.SphereGeometry(1, 16, 12);
  const body = new THREE.Mesh(ball, fur);
  body.scale.set(0.15, 0.15, 0.29);
  body.position.set(0, 0.27, 0);
  const chest = new THREE.Mesh(ball, pale);
  chest.scale.set(0.12, 0.13, 0.12);
  chest.position.set(0, 0.25, 0.16);
  const head = new THREE.Group();
  head.position.set(0, 0.42, 0.27);
  const skull = new THREE.Mesh(ball, fur);
  skull.scale.set(0.12, 0.105, 0.11);
  const muzzle = new THREE.Mesh(ball, pale);
  muzzle.scale.set(0.06, 0.045, 0.05);
  muzzle.position.set(0, -0.03, 0.085);
  const ear = new THREE.ConeGeometry(0.045, 0.09, 4);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(ear, dark);
    e.position.set(s * 0.065, 0.1, -0.005);
    e.rotation.set(-0.15, Math.PI / 4, s * -0.25);
    head.add(e);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), toonish("#2a3a12"));
    eye.position.set(s * 0.045, 0.012, 0.095);
    head.add(eye);
  }
  head.add(skull, muzzle);
  const legs = [];
  const leg = new THREE.CylinderGeometry(0.03, 0.026, 0.24, 6);
  leg.translate(0, -0.12, 0);
  for (const [x, z] of [[-0.075, 0.17], [0.075, 0.17], [-0.075, -0.17], [0.075, -0.17]]) {
    const l = new THREE.Mesh(leg, z > 0 ? pale : fur);
    l.position.set(x, 0.24, z);
    g.add(l);
    legs.push(l);
  }
  // the tail, a chain of short pieces so it can curl
  const tail = [];
  let parent = g;
  let at = new THREE.Vector3(0, 0.33, -0.27);
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.position.copy(at);
    const piece = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.09, 6), i > 3 ? dark : fur);
    piece.position.y = 0.045;
    seg.add(piece);
    parent.add(seg);
    tail.push(seg);
    parent = seg;
    at = new THREE.Vector3(0, 0.09, 0);
  }
  tail[0].rotation.x = -2.2;
  g.add(body, chest, head);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { g, head, legs, tail, body };
}

export function createCats(spots) {
  const COATS = [["#d9873e", "#f3e3c8", "#a85a24"], ["#2c2a2c", "#3d3a3c", "#1c1a1c"], ["#cfcac0", "#f4f1ea", "#7e7a74"], ["#e8e2d6", "#f7f3ec", "#c46a2c"]];
  const cats = spots.map(([x, z], i) => {
    const [a, b, c] = COATS[i % COATS.length];
    const m = catModel(a, b, c);
    const y = groundAt(x, z).y;
    m.g.position.set(x, y, z);
    m.g.rotation.y = r() * 6.28;
    return { ...m, home: new THREE.Vector3(x, y, z), state: "sit", t: r() * 4, target: null, follow: 0, pet: 0, speed: 0, step: 0, i };
  });
  const group = new THREE.Group();
  cats.forEach((c) => group.add(c.g));
  const tmp = new THREE.Vector3();
  const update = (dt, t, player) => {
    for (const c of cats) {
      c.t -= dt;
      c.pet = Math.max(0, c.pet - dt);
      c.follow = Math.max(0, c.follow - dt);
      const p = c.g.position;
      const toPlayer = tmp.set(player.pos.x - p.x, 0, player.pos.z - p.z);
      const dPlayer = toPlayer.length();
      if (c.follow > 0 && dPlayer > 2.2 && c.pet <= 0) {
        c.state = "walk";
        c.target = new THREE.Vector3(player.pos.x - toPlayer.x / dPlayer * 1.4, 0, player.pos.z - toPlayer.z / dPlayer * 1.4);
      } else if (c.t <= 0 && c.pet <= 0) {
        if (c.state === "walk" || r() < 0.4) { c.state = r() < 0.5 ? "sit" : "loaf"; c.t = 5 + r() * 9; c.target = null; }
        else {
          const a = r() * 6.28, d = 2 + r() * 7;
          c.target = new THREE.Vector3(c.home.x + Math.cos(a) * d, 0, c.home.z + Math.sin(a) * d);
          c.state = "walk";
          c.t = 8;
        }
      }
      let speed = 0;
      if (c.state === "walk" && c.target) {
        const dx = c.target.x - p.x, dz = c.target.z - p.z, d = Math.hypot(dx, dz);
        if (d < 0.3) { c.state = c.follow > 0 ? "sit" : "sit"; c.t = c.follow > 0 ? 0.5 : 4 + r() * 6; c.target = null; }
        else {
          speed = Math.min(c.follow > 0 && d > 6 ? 3.2 : 1.1, d * 1.5);
          const want = Math.atan2(dx, dz);
          let diff = ((want - c.g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          c.g.rotation.y += diff * Math.min(1, dt * 5);
          const nx = p.x + Math.sin(c.g.rotation.y) * speed * dt, nz = p.z + Math.cos(c.g.rotation.y) * speed * dt;
          const g = groundAt(nx, nz, p.y + 0.4);
          if (g.y > -0.2 && Math.abs(g.y - p.y) < 0.6) { p.x = nx; p.z = nz; p.y += (g.y - p.y) * Math.min(1, dt * 12); }
          else { c.state = "sit"; c.t = 2; c.target = null; }
        }
      }
      c.speed += (speed - c.speed) * Math.min(1, dt * 6);
      c.step += c.speed * dt * 7;
      const walking = Math.min(1, c.speed);
      c.legs.forEach((l, k) => { l.rotation.x = Math.sin(c.step + (k === 0 || k === 3 ? 0 : Math.PI)) * 0.7 * walking; });
      // sitting folds the back legs and tips the body up
      const sit = c.state === "sit" ? 1 : 0, loaf = c.state === "loaf" ? 1 : 0;
      c.body.rotation.x += ((-0.45 * sit) - c.body.rotation.x) * Math.min(1, dt * 4);
      c.body.position.y += ((0.27 - 0.06 * sit - 0.12 * loaf) - c.body.position.y) * Math.min(1, dt * 4);
      c.legs[2].scale.y = c.legs[3].scale.y = 1 - 0.55 * sit - 0.7 * loaf;
      c.legs[0].scale.y = c.legs[1].scale.y = 1 - 0.75 * loaf;
      c.head.position.y += ((0.42 + 0.06 * sit - 0.14 * loaf) - c.head.position.y) * Math.min(1, dt * 4);
      // the head follows you when you're near, the tail never stops
      const look = dPlayer < 7 ? Math.atan2(toPlayer.x, toPlayer.z) - c.g.rotation.y : Math.sin(t * 0.3 + c.i) * 0.5;
      const lk = ((look + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      c.head.rotation.y += (Math.max(-1, Math.min(1, lk)) - c.head.rotation.y) * Math.min(1, dt * 3);
      c.head.rotation.z = c.pet > 0 ? Math.sin(t * 3) * 0.25 : 0;
      const happy = c.pet > 0 || c.follow > 0;
      c.tail.forEach((s, k) => {
        if (k === 0) { s.rotation.x = happy ? -0.4 : -2.2 + 0.9 * sit - 0.75 * loaf; return; }
        s.rotation.x = (happy ? 0.12 : 0.25) + Math.sin(t * (happy ? 3 : 1.3) + k * 0.6 + c.i) * 0.12;
        s.rotation.z = Math.sin(t * (happy ? 2.2 : 0.9) + k * 0.7 + c.i * 2) * (happy ? 0.25 : 0.35);
      });
    }
  };
  const petted = (c) => { c.pet = 3.5; c.follow = 40; c.state = "sit"; c.target = null; c.t = 3.5; };
  return { group, cats, update, petted };
}

// A pod of dolphins that crosses the bay where you can see it, leaping
// one after another, splashing as they go in and come out.
function dolphinGeometry() {
  const pos = [], col = [];
  const dark = new THREE.Color("#3a4a58"), pale = new THREE.Color("#c9d2d6"), c = new THREE.Color();
  const body = new THREE.LatheGeometry([[0.001, -1.15], [0.05, -1.08], [0.1, -0.9], [0.2, -0.5], [0.29, 0], [0.3, 0.25], [0.25, 0.7], [0.17, 0.92], [0.07, 1.06], [0.05, 1.18], [0.001, 1.25]]
    .map(([a, b]) => new THREE.Vector2(a, b)), 14).toNonIndexed();
  body.rotateX(Math.PI / 2);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    pos.push(p.getX(i), p.getY(i) * 0.92, p.getZ(i));
    c.copy(pale).lerp(dark, Math.min(1, Math.max(0, p.getY(i) / 0.3 * 0.9 + 0.55)));
    col.push(c.r, c.g, c.b);
  }
  const tri = (a, b, d, color) => {
    pos.push(...a, ...b, ...d);
    for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
  };
  // dorsal fin, flukes, flippers
  tri([0, 0.24, 0.12], [0, 0.6, -0.22], [0, 0.24, -0.34], dark);
  for (const s of [-1, 1]) {
    tri([0, 0, -1.02], [0.46 * s, 0.02, -1.36], [0.1 * s, 0, -1.2], dark);
    tri([0.2 * s, -0.12, 0.5], [0.46 * s, -0.3, 0.22], [0.22 * s, -0.12, 0.3], dark);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

export function createDolphins(count = 4) {
  const mat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { key: "dolphin", defines: { RIM: "0.4", WRAP: "0.2" } });
  const mesh = new THREE.InstancedMesh(dolphinGeometry(), mat, count);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.layers.enable(1);
  const pod = { from: new THREE.Vector3(-60, 0, -80), dir: new THREE.Vector3(1, 0, 0), len: 140, went: 0, t: 0, rest: 0 };
  const deep = (x, z) => heightAt(x, z) < -4.5;
  // A route across the water in front of you, deep all the way
  const route = (cam, yaw) => {
    for (let k = 0; k < 40; k++) {
      const a = yaw + (Math.random() - 0.5) * 1.6, d = 60 + Math.random() * 130;
      const mx = cam.x - Math.sin(a) * d, mz = cam.z - Math.cos(a) * d;
      const across = a + Math.PI / 2 + (Math.random() - 0.5) * 0.8, len = 90 + Math.random() * 70;
      const dx = -Math.sin(across), dz = -Math.cos(across);
      const sx = mx - dx * len / 2, sz = mz - dz * len / 2;
      let ok = true;
      for (let i = 0; i <= 8 && ok; i++) ok = deep(sx + dx * len * i / 8, sz + dz * len * i / 8);
      if (!ok) continue;
      pod.from.set(sx, 0, sz);
      pod.dir.set(dx, 0, dz);
      pod.len = len;
      pod.went = 0;
      return true;
    }
    return false;
  };
  const was = new Float32Array(count).fill(9);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const update = (dt, cam, yaw, events) => {
    pod.t += dt;
    if (pod.rest > 0) {
      // between passes, they're out of sight
      pod.rest -= dt;
      if (pod.rest <= 0 && !route(cam, yaw)) pod.rest = 6;
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
      mesh.instanceMatrix.needsUpdate = true;
      return;
    }
    pod.went += dt * 6;
    if (pod.went > pod.len) { pod.rest = 12 + Math.random() * 18; return; }
    const heading = Math.atan2(pod.dir.x, pod.dir.z);
    for (let i = 0; i < count; i++) {
      const side = (i - (count - 1) / 2) * 2.4, back = Math.abs(i - (count - 1) / 2) * 2 + (i % 2) * 1.3;
      const along = pod.went - back;
      const cyc = (pod.t * 0.85 + i * 0.41 + i * i * 0.17) % 2.4;
      const leap = cyc < 1.05 && along > 0 && along < pod.len;
      const x = pod.from.x + pod.dir.x * along + pod.dir.z * side, z = pod.from.z + pod.dir.z * along - pod.dir.x * side;
      if (leap) {
        const k = cyc / 1.05;
        p.set(x, Math.sin(Math.PI * k) * (1.3 + 0.3 * (i % 2)) - 0.45, z);
        e.set(-Math.cos(Math.PI * k) * 0.85, heading, Math.sin(pod.t + i) * 0.1, "YXZ");
        mesh.setMatrixAt(i, m.compose(p, q.setFromEuler(e), s.setScalar(1 + (i % 3) * 0.08)));
        if (was[i] >= 1.05) events?.splash(x - pod.dir.x * 0.8, z - pod.dir.z * 0.8, 0.7);
      } else {
        mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
        if (was[i] < 1.05 && along > 0) events?.splash(x, z, 0.9);
      }
      was[i] = leap ? cyc : 9;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (Math.random() < dt * 0.4) events?.call(pod.from.clone().addScaledVector(pod.dir, pod.went));
  };
  return { mesh, update, pod };
}
