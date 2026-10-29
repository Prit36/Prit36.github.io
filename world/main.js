import * as THREE from "three";
import { heightAt, groundAt, pushOut, field, buildTerrain, smooth, PATHS, STEP_UP, ISLANDS, rng } from "./land.js";
import { lightOf, palette, createSky, createClouds, createRanges, PHASES, sunAt } from "./sky.js";
import { createWater, createRipples } from "./water.js";
import { buildWorld, createWindows, createGlows } from "./build.js";
import { createFlora, createGrass } from "./flora.js";
import { createGulls, createButterflies, createMotes, createFireflies, createFish, createStones, createBall, createCats } from "./life.js";
import { createPost } from "./post.js";
import { createSound } from "./sound.js";
import { U, stylize, toonish } from "./style.js";

// The bay from the banner, walkable. It keeps Surat's hours by default, the
// way the banner does; the scroll wheel turns them.

const $ = (id) => document.getElementById(id);
const canvas = $("world");
const goBtn = $("go");
const intro = $("intro");
const hud = $("hud");
const touch = matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
document.documentElement.classList.toggle("is-touch", touch);
const fail = (msg) => {
  goBtn.textContent = "Can't paint the bay here";
  $("error").hidden = false;
  $("error").textContent = msg;
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  if (!renderer.capabilities.isWebGL2) throw new Error("no webgl2");
} catch {
  fail("This needs WebGL 2, which this browser doesn't have turned on.");
  throw new Error("WebGL 2 is not available");
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

// Let the button say what's happening before the heavy part starts.
// (A tab in the background gets no frames, so a timer stands in.)
await new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 120); });

const scene = new THREE.Scene();
// Turns the haze on in every material; the haze itself is the bay's own
scene.fog = new THREE.FogExp2(0xffffff, 0.0001);
const baseFov = () => 70 + Math.max(0, 1 - innerWidth / innerHeight) * 26;
const camera = new THREE.PerspectiveCamera(baseFov(), innerWidth / innerHeight, 0.15, 24000);
camera.rotation.order = "YXZ";
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
const sunLight = new THREE.DirectionalLight(0xffffff, 1);
const SHADOW = 80, SHADOW_MAP = touch ? 2048 : 4096;
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
Object.assign(sunLight.shadow.camera, { left: -SHADOW, right: SHADOW, top: SHADOW, bottom: -SHADOW, near: 1, far: 900 });
sunLight.shadow.bias = -0.00025;
sunLight.shadow.normalBias = 0.045;
scene.add(hemi, sunLight, sunLight.target);

// ------------------------------------------------------------------ the world
const terrain = buildTerrain();
scene.add(terrain.mesh, terrain.coarse);
const sky = createSky();
scene.add(sky.mesh);
const ranges = createRanges();
scene.add(ranges.mesh);
const clouds = createClouds();
scene.add(clouds.group);
const water = createWater(terrain.floorTex, terrain.floorRect);
scene.add(water.mesh);
const ripples = createRipples();
scene.add(ripples.mesh);
const world = buildWorld(scene);
const { places } = world;
const windows = createWindows(world.windows);
scene.add(windows.mesh);
const glows = createGlows(world.glows);
scene.add(glows.mesh);
const flora = createFlora(scene, world.plants);
const grass = createGrass();
scene.add(...grass.meshes);
water.setObstacles(world.foam);
const gulls = createGulls();
scene.add(gulls.mesh);
const butterflies = createButterflies();
scene.add(butterflies.mesh);
const motes = createMotes(touch ? 350 : 700);
scene.add(motes.mesh);
const fish = createFish();
scene.add(fish.mesh);
const stones = createStones();
scene.add(stones.mesh);
const ball = createBall([places.pier.end[0] - places.pier.dir.x * 3.5, places.pier.deck, places.pier.end[2] - places.pier.dir.y * 3.5]);
scene.add(ball.mesh);
const cats = createCats([[212, 0], [236, -28], [184, -38], [198, -64]].map(([x, z]) => {
  for (let k = 0; k < 30; k++) {
    const a = k * 2.4, d = k * 0.6, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const g = groundAt(px, pz);
    if (!g.on && Math.abs(heightAt(px + 0.6, pz) - heightAt(px - 0.6, pz)) < 0.4) return [px, pz];
  }
  return [x, z];
}));
scene.add(cats.group);
const sound = createSound();

// Fireflies, in the olive terraces and the gardens
const fireflies = createFireflies((() => {
  const r = rng(5), spots = [];
  for (let i = 0; i < 6000 && spots.length < 300; i++) {
    const x = 120 + r() * 220, z = -170 + r() * 260, f = field(x, z);
    if (f.h > 1.5 && f.village > 0.15) spots.push([x, heightAt(x, z) + 0.6 + r() * 2.2, z]);
  }
  return spots;
})());
scene.add(fireflies.mesh);

// A soft round glow, for lamps and lanterns
const glowTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.15, "rgba(255,255,255,0.5)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.1)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const sprite = (color, size) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  s.scale.setScalar(size);
  return s;
};

// ------------------------------------------------------------------ the lighthouse at work
const LH = places.lighthouse;
const beam = new THREE.Group();
beam.position.copy(LH.lamp);
{
  const cone = new THREE.ConeGeometry(12, 190, 32, 1, true);
  cone.translate(0, -95, 0);
  cone.rotateZ(Math.PI / 2 + 0.02);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOn: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vN, vV;
      void main() {
        vAlong = clamp(position.x / 190., 0., 1.);
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOn;
      varying float vAlong;
      varying vec3 vN, vV;
      void main() {
        float ln = length(vN);
        vec3 n = ln > 1e-5 ? vN / ln : vec3(0., 0., 1.);
        float edge = pow(clamp(abs(dot(n, normalize(vV))), 0., 1.), 2.);
        float a = pow(clamp(1. - vAlong, 0., 1.), 1.8) * edge * uOn * 0.55;
        gl_FragColor = vec4(max(vec3(1.3, 1.15, 0.85) * a, 0.), 1.);
      }`,
  });
  const a = new THREE.Mesh(cone, mat);
  const b = new THREE.Mesh(cone, mat);
  b.rotation.y = Math.PI;
  beam.add(a, b);
  beam.userData.mat = mat;
}
scene.add(beam);
const lamp = sprite(new THREE.Color(4, 3.4, 2.4), 5);
lamp.position.copy(LH.lamp);
scene.add(lamp);
const lampLight = new THREE.PointLight("#ffd79a", 0, 60, 1.6);
lampLight.position.copy(LH.lamp);
scene.add(lampLight);

// ------------------------------------------------------------------ the bell and the clock
const TW = places.tower;
const bell = new THREE.Group();
bell.position.set(TW.x, TW.floor + 3.0, TW.z);
bell.rotation.y = TW.rot;
{
  const prof = [[0.12, 0], [0.32, -0.1], [0.42, -0.55], [0.55, -1.05], [0.72, -1.25], [0.7, -1.32], [0, -1.32]].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), toonish("#b98a3e", { params: { side: THREE.DoubleSide }, defines: { RIM: "0.6", WRAP: "0.05" } }));
  body.castShadow = true;
  bell.add(body);
  const yoke = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.25, 0.25), toonish("#5d4634"));
  yoke.position.y = 0.12;
  bell.add(yoke);
}
scene.add(bell);
// The bell strikes again each time it swings back, softer each time.
let bellSwing = 0, bellT = 9, strikes = [];
const ringBell = () => {
  bellSwing = 0.55;
  bellT = 0;
  strikes = [0.98, 1.96, 2.94];
  sound.bell(camera.position.distanceTo(bell.position));
  gulls.startle();
};
const clock = new THREE.Group();
clock.position.set(...TW.clock);
clock.rotation.y = TW.rot;
const hand = (len, w) => {
  const g = new THREE.BoxGeometry(w, len, 0.04);
  g.translate(0, len / 2 - 0.08, 0.03);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: "#2c2622" }));
  clock.add(m);
  return m;
};
const hourHand = hand(0.62, 0.11), minuteHand = hand(0.95, 0.07);
scene.add(clock);

// ------------------------------------------------------------------ the parasol
const parasol = new THREE.Group();
{
  const geo = new THREE.ConeGeometry(1.15, 0.42, 10, 1, true).toNonIndexed();
  const cols = new Float32Array(geo.attributes.position.count * 3);
  const a = new THREE.Color("#f6efe0"), b = new THREE.Color("#d0663f");
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const c = Math.floor(i / 6) % 2 ? a : b;
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const canopy = new THREE.Mesh(geo, stylize(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { key: "parasol", defines: { FOLIAGE: "0.5" }, normal: "normal = normalize(vNormal);" }));
  canopy.position.y = 0.25;
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.3, 5), toonish("#5d4634"));
  stick.position.y = -0.4;
  parasol.add(canopy, stick);
  // Held up and off to the right: the canopy fills the top of the view, the
  // stick leaves by the lower right corner.
  parasol.position.set(0.55, 1.0, -0.7);
  parasol.rotation.set(-0.3, 0, -0.42);
  parasol.visible = false;
  camera.add(parasol);
}
let parasolOpen = 0;

// ------------------------------------------------------------------ the lanterns
// One for each project on the page. Their words come from the page itself.
const SPOTS = {
  glyph: () => [...places.glyph, 0],
  "pm2-native": () => { const [x, , z] = places.beachBoat; return [x + 2.6, heightAt(x + 2.6, z + 0.8), z + 0.8, 0]; },
  bounce: () => { const [x, y, z] = places.pier.end; return [x, y, z, 0]; },
  "pdf-compressor": () => { const [x, y, z] = places.plaza; return [x + 3.6, y, z + 1.5, 0]; },
  fuelmate: () => [...places.fuel, 0],
  sonograph: () => [TW.x + Math.cos(-TW.rot) * 1.2, TW.floor + 0.3, TW.z + Math.sin(-TW.rot) * 1.2, 0.6],
  jpegview: () => [...places.view, 0],
  quarry: () => [...places.quarry, 0],
  pm2: () => [...places.woodpile, 0],
  argus: () => [LH.x - 2.4, LH.gallery, LH.z + 0.6, 0.6],
  whistle: () => [...places.islet, 0],
};
const FALLBACK = [
  ["fuelmate", "FuelMate"], ["pm2", "PM2 Log Analyzer"], ["pdf-compressor", "PDF Compressor"], ["pm2-native", "PM2 Native"],
  ["jpegview", "JPEGView"], ["glyph", "Glyph"], ["sonograph", "Sonograph"], ["bounce", "Bounce"], ["whistle", "Whistle"],
  ["quarry", "Quarry"], ["argus", "Argus"],
].map(([key, name]) => ({ key, name, stack: "", detail: "", href: "https://github.com/Prit36" }));
const projects = await fetch("../index.html").then((r) => r.text()).then((html) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const list = [...doc.querySelectorAll(".work")].map((li) => {
    const a = li.querySelector(".title a");
    return {
      key: li.dataset.project, name: a?.textContent.trim() || li.dataset.project,
      stack: li.querySelector(".stack")?.textContent.trim() || "", detail: li.dataset.detail || "",
      href: a?.href || "https://github.com/Prit36", live: li.querySelector(".live")?.href,
    };
  }).filter((p) => SPOTS[p.key]);
  return list.length ? list : FALLBACK;
}).catch(() => FALLBACK);

let litKeys = new Set();
try { litKeys = new Set(JSON.parse(localStorage.getItem("world-lanterns") || "[]")); } catch { /* storage is optional */ }
const saveLit = () => { try { localStorage.setItem("world-lanterns", JSON.stringify([...litKeys])); } catch { /* storage is optional */ } };

const crookGeo = (() => {
  const g = [];
  const put = (geo, m) => { geo.applyMatrix4(m); g.push(geo); };
  put(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 8), new THREE.Matrix4().makeTranslation(0, 1.1, 0));
  put(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0.3, 2.15, 0));
  return g;
})();
const crookMat = toonish("#4a3a2c");
// A paper lantern: ribbed, so it reads as paper round a frame
const paperGeo = (() => {
  const prof = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, y = -0.32 + t * 0.64;
    prof.push(new THREE.Vector2(Math.max(0.0001, 0.28 * Math.sin(Math.PI * (0.08 + t * 0.84)) * (1 - 0.06 * (i % 2))), y));
  }
  return new THREE.LatheGeometry(prof, 18);
})();
const capGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12);
const paperMat = () => stylize(new THREE.MeshLambertMaterial({ color: "#f3e3c0", emissive: "#000000", side: THREE.DoubleSide }), { key: "paper", defines: { FOLIAGE: "0.9", WRAP: "0.4" } });
const lanterns = projects.map((p, i) => {
  const [x, y, z, rot] = SPOTS[p.key]();
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rot;
  for (const g of crookGeo) {
    const m = new THREE.Mesh(g, crookMat);
    m.castShadow = true;
    group.add(m);
  }
  const hang = new THREE.Group();
  hang.position.set(0.6, 2.12, 0);
  const mat = paperMat();
  const body = new THREE.Mesh(paperGeo, mat);
  body.position.y = -0.5;
  body.castShadow = true;
  const cap = new THREE.Mesh(capGeo, crookMat);
  cap.position.y = -0.17;
  const foot = new THREE.Mesh(capGeo, crookMat);
  foot.position.y = -0.83;
  const glow = sprite(new THREE.Color(3, 1.9, 0.9), 3.2);
  glow.position.y = -0.5;
  const light = new THREE.PointLight("#ffb466", 0, 9, 1.8);
  light.position.y = -0.5;
  hang.add(body, cap, foot, glow, light);
  group.add(hang);
  group.traverse((o) => o.layers.enable(1));
  scene.add(group);
  const lit = litKeys.has(p.key);
  return { p, i, group, hang, mat, glow, light, lit, home: group.position.clone(), lightT: lit ? 9 : 0, rise: null };
});
const lanternWorld = (l) => l.hang.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.5, 0));

// ------------------------------------------------------------------ the boat you can row
const boatMat = world.materials.boat;
const rowboat = (() => {
  // somewhere off the beach by the quay, in a metre or two of water
  let best = null, bd = Infinity;
  for (let x = 96; x <= 136; x += 1.5) for (let z = -100; z <= -58; z += 1.5) {
    const h = heightAt(x, z);
    if (h > -0.9 || h < -2.4) continue;
    const near = Math.min(...[[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].map(([dx, dz]) => heightAt(x + dx, z + dz)));
    if (near > -0.7) continue;
    const pd = Math.hypot(x - 124, z + 76);
    if (pd < bd && groundAt(x, z).on == null) { bd = pd; best = [x, z]; }
  }
  const [x, z] = best || [118, -80];
  const mesh = new THREE.Mesh(world.gozzo(4.6, 1.7, "#f2ece0", "#2f7f9a"), boatMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.layers.enable(1);
  const oars = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.78, 0.66, 0.15);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 6), toonish("#c9a878"));
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = s * 0.9;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.16), toonish("#c9a878"));
    blade.position.x = s * 2.05;
    g.add(shaft, blade);
    mesh.add(g);
    return g;
  });
  scene.add(mesh);
  // pointing out to sea
  return { mesh, oars, x, z, heading: Math.atan2(-20 - x, -55 - z), speed: 0, oarT: 0, lastDip: 0, phase: 1.3 };
})();

// ------------------------------------------------------------------ the swing at the lookout
const SW = places.swing;
const swing = (() => {
  const ground = groundAt(SW.x, SW.z).y;
  const L = SW.top - (ground + 0.55);
  const yaw = Math.atan2(-20 - SW.x, -55 - SW.z);
  const group = new THREE.Group();
  group.position.set(SW.x, SW.top, SW.z);
  group.rotation.order = "YXZ";
  group.rotation.y = yaw;
  const rope = new THREE.CylinderGeometry(0.018, 0.018, L, 5);
  rope.translate(0, -L / 2, 0);
  const ropeMat = toonish("#cdb991");
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(rope, ropeMat);
    m.position.x = s * 0.32;
    m.castShadow = true;
    group.add(m);
  }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.3), toonish("#8a6646"));
  seat.position.y = -L;
  seat.castShadow = true;
  group.add(seat);
  const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.6, 6), toonish("#6a5040"));
  branch.rotation.z = Math.PI / 2;
  group.add(branch);
  scene.add(group);
  return { group, seat, L, yaw, th: 0, om: 0, on: false, prev: new THREE.Vector3(), lastCreak: 0 };
})();
const seatWorld = (v = new THREE.Vector3()) => swing.seat.getWorldPosition(v);

// ------------------------------------------------------------------ time
// Minutes the sky has been turned away from now.
let skew = Number(new URLSearchParams(location.search).get("skew")) || 0;
let glide = null;
const wrap = (m) => ((((m % 1440) + 2160) % 1440) - 720);
const glideTo = (target, ms = 1500, done) => { glide = { from: skew, to: target, t: 0, ms, done }; };
const skyHome = () => { skew = wrap(skew); glideTo(0); };
const sunCrossing = (rising, from) => {
  let before = sunAt(from).alt;
  for (let m = 2; m <= 1440; m += 2) {
    const a = sunAt(from + m * 6e4).alt;
    if (rising ? before < -0.8 && a >= -0.8 : before >= -0.8 && a < -0.8) return m;
    before = a;
  }
  return 0;
};
const IST = 330 * 6e4;
const two = (n) => String(n).padStart(2, "0");
const hoursAt = (t) => { const d = new Date(t + IST); return [d.getUTCHours(), d.getUTCMinutes()]; };
const describe = (t) => {
  const [h, m] = hoursAt(t), alt = sunAt(t).alt;
  const part = alt > 40 ? "the middle of the day" : alt > 8 ? (h < 12 ? "morning" : "afternoon")
    : alt > -1 ? (h < 12 ? "sunrise" : "golden hour") : alt > -12 ? (h < 12 ? "first light" : "dusk") : "night";
  return `${part} there, ${two(h)}:${two(m)}`;
};
$("intro-time").textContent = describe(Date.now() + skew * 6e4);

// ------------------------------------------------------------------ the player
const P = {
  pos: new THREE.Vector3(...places.spawn), vel: new THREE.Vector3(),
  yaw: 1.12, pitch: -0.06,
  grounded: true, swimming: false, gliding: false, on: null,
  stride: 0, lastStep: 0, dip: 0, airTime: 0, fov: camera.fov,
  boat: null, swing: false, scope: false,
};
const keys = new Set();
let jumpQueued = false;
let playing = false;
const stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
let touchJump = false;

const surfaceAt = (x, z, on) => {
  if (on) return on.surf === "board" ? "wood" : on.surf || "stone";
  const f = field(x, z);
  if (f.h < 0.05) return "water";
  if (f.beach > 0.5 && f.h < 3.2) return "sand";
  if (f.path > 0.5 || f.d < 10) return "stone";
  return "grass";
};
const input = () => {
  let ix = 0, iz = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) iz += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) iz -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
  ix += stick.x;
  iz -= stick.y;
  const len = Math.hypot(ix, iz);
  if (len > 1) { ix /= len; iz /= len; }
  return [ix, iz];
};

const WATER_FEET = -1.25;
function movePlayer(dt) {
  if (P.boat) return rowBoat(dt);
  if (P.swing) return swingAbout(dt);
  if (P.scope) return;
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const [ix, iz] = input();
  const run = keys.has("ShiftLeft") || keys.has("ShiftRight") || Math.hypot(stick.x, stick.y) > 0.92;
  const here = groundAt(P.pos.x, P.pos.z, P.pos.y);
  const wading = here.y < -0.35 && !here.on && !P.swimming;
  let speed = P.swimming ? (run ? 4.6 : 3.1) : run ? 9.5 : 5.2;
  if (wading) speed *= 0.62;
  const wx = fx * iz + rx * ix, wz = fz * iz + rz * ix;
  if (P.gliding) {
    const ahead = 10.5 * (1 + 0.35 * iz);
    P.vel.x += (fx * ahead + rx * ix * 3 - P.vel.x) * Math.min(1, dt * 1.6);
    P.vel.z += (fz * ahead + rz * ix * 3 - P.vel.z) * Math.min(1, dt * 1.6);
  } else {
    const accel = P.grounded || P.swimming ? 12 : 2.2;
    P.vel.x += (wx * speed - P.vel.x) * Math.min(1, dt * accel);
    P.vel.z += (wz * speed - P.vel.z) * Math.min(1, dt * accel);
  }
  if (jumpQueued) {
    if (P.grounded) {
      // the diving board throws you higher
      P.vel.y = P.on?.bouncy ? 12.5 : 7.6;
      if (P.on?.bouncy) { sound.boing(0); board.k = 1; }
      P.grounded = false; P.airTime = 0;
    } else if (P.swimming) { P.vel.y = 6; P.swimming = false; P.airTime = 0; }
    jumpQueued = false;
  }
  const holding = keys.has("Space") || touchJump;
  if (!P.grounded && !P.swimming) {
    P.airTime += dt;
    if (!P.gliding && holding && P.airTime > 0.22 && P.vel.y < 2.5) { P.gliding = true; sound.whoosh(); }
    if (!holding) P.gliding = false;
  } else {
    P.gliding = false;
  }
  if (!P.swimming) P.vel.y -= (P.gliding ? 10 : 22) * dt;
  if (P.gliding) P.vel.y = Math.max(P.vel.y, -2.1);

  // Across: blocked by cliffs too steep to walk up, and by walls
  const ox = P.pos.x, oz = P.pos.z;
  const can = (nx, nz) => {
    if (!P.grounded) return true;
    const g = groundAt(nx, nz, P.pos.y);
    const moved = Math.hypot(nx - ox, nz - oz);
    return g.y - P.pos.y <= (g.on ? STEP_UP : 1.35 * moved + 0.12);
  };
  const nx = ox + P.vel.x * dt, nz = oz + P.vel.z * dt;
  if (can(nx, nz)) { P.pos.x = nx; P.pos.z = nz; }
  else if (can(nx, oz)) { P.pos.x = nx; P.vel.z *= 0.3; }
  else if (can(ox, nz)) { P.pos.z = nz; P.vel.x *= 0.3; }
  else { P.vel.x *= 0.2; P.vel.z *= 0.2; }
  if (!P.grounded && !P.swimming) {
    const g = groundAt(P.pos.x, P.pos.z, P.pos.y);
    if (!g.on && g.y > P.pos.y + 0.8) { P.pos.x = ox; P.pos.z = oz; P.vel.x *= 0.3; P.vel.z *= 0.3; }
  }
  pushOut(P.pos, 0.35, P.pos.y);
  keepInside();

  // Up and down
  P.pos.y += P.vel.y * dt;
  const g = groundAt(P.pos.x, P.pos.z, P.pos.y);
  P.on = g.on;
  if (!g.on && g.y < WATER_FEET && P.pos.y <= WATER_FEET + 0.02) {
    if (!P.swimming) {
      splash(P.pos.x, P.pos.z, Math.min(1.6, 0.4 - P.vel.y * 0.08));
      sound.splash(Math.min(1.4, 0.4 - P.vel.y * 0.1));
    }
    P.swimming = true;
    P.grounded = false;
    P.pos.y = WATER_FEET;
    P.vel.y = 0;
  } else {
    P.swimming = false;
    const snap = P.grounded && P.vel.y <= 0 && P.pos.y - g.y < 0.7;
    if (P.pos.y <= g.y || snap) {
      if (g.on?.bouncy && P.vel.y < -4.5) {
        // a bounce off the board, a little lower each time
        P.pos.y = g.y;
        P.vel.y = Math.min(14, -P.vel.y * 0.72);
        sound.boing(0);
        board.k = 1;
        P.grounded = false;
        return;
      }
      if (!P.grounded && P.vel.y < -8) {
        P.dip = Math.min(0.35, -P.vel.y * 0.022);
        sound.step(surfaceAt(P.pos.x, P.pos.z, g.on));
      }
      P.pos.y = g.y;
      P.vel.y = 0;
      P.grounded = true;
      P.airTime = 0;
    } else {
      P.grounded = false;
    }
  }
}
// The painting ends somewhere
function keepInside() {
  const fromMid = Math.hypot(P.pos.x + 40, P.pos.z + 40);
  if (fromMid > 1250) {
    const k = (fromMid - 1250) / fromMid;
    P.pos.x -= (P.pos.x + 40) * k;
    P.pos.z -= (P.pos.z + 40) * k;
    toast("The painting ends a little further out.");
  }
}
const board = { k: 0 };

// Rowing: W and S pull on the oars, A and D turn her.
function rowBoat(dt) {
  const b = P.boat;
  const [ix, iz] = input();
  const pull = iz, turn = -ix;
  b.speed += pull * dt * (pull > 0 ? 2.4 : 1.6);
  b.speed *= Math.exp(-dt * 0.55);
  b.speed = Math.max(-2.2, Math.min(4.6, b.speed));
  const dh = turn * dt * (0.55 + 0.35 * Math.min(1, Math.abs(b.speed) / 2));
  b.heading += dh;
  P.yaw += dh;
  const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
  const nx = b.x + fx * b.speed * dt, nz = b.z + fz * b.speed * dt;
  const bowX = nx + fx * 2.2 * Math.sign(b.speed || 1), bowZ = nz + fz * 2.2 * Math.sign(b.speed || 1);
  const g = groundAt(bowX, bowZ, 0.2);
  if (heightAt(bowX, bowZ) > -0.45 || (g.on && g.y > -0.2)) {
    if (Math.abs(b.speed) > 1) sound.clack(0);
    b.speed *= -0.25;
  } else {
    b.x = nx; b.z = nz;
  }
  const rowing = Math.abs(pull) > 0.1 || Math.abs(turn) > 0.1;
  if (rowing) {
    b.oarT += dt * 2.6;
    if (Math.sin(b.oarT) < -0.6 && b.lastDip < b.oarT - 1.5) {
      b.lastDip = b.oarT;
      sound.oar();
      for (const s of [-1, 1]) {
        ripples.add(b.x + Math.cos(b.heading) * s * 2.6, b.z - Math.sin(b.heading) * s * 2.6, 0.5, 0.4, 1.4);
      }
    }
  }
  b.oars.forEach((o, i) => {
    const s = i ? 1 : -1;
    o.rotation.y = rowing ? s * Math.sin(b.oarT) * 0.55 : o.rotation.y * 0.95;
    o.rotation.z = rowing ? s * (0.25 + 0.2 * Math.cos(b.oarT)) : s * 0.32;
  });
  if (Math.abs(b.speed) > 1.5 && Math.random() < dt * 3) ripples.add(b.x - fx * 2, b.z - fz * 2, 0.8, 0.25, 1.8);
  P.pos.set(b.x, 0.35, b.z);
  P.vel.set(fx * b.speed, 0, fz * b.speed);
  keepInside();
}
const landing = () => {
  const b = P.boat;
  if (!b) return null;
  let best = null;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    for (const d of [2.2, 3, 3.8]) {
      const x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d;
      const g = groundAt(x, z, 2);
      if (g.y > 0.15 && g.y < 2.2 && (!best || d < best.d)) best = { x, z, y: g.y, d, pier: !!g.on };
    }
  }
  return best;
};
const leaveBoat = () => {
  const spot = landing();
  if (!spot) { toast("Row in closer to the shore or the pier to step out."); return; }
  const b = P.boat;
  teleport(spot.x, spot.y, spot.z, P.yaw, () => { P.boat = null; b.speed = 0; });
};

// The swing: W pumps it higher, Space lets go at the top (and Space again
// opens the parasol), E steps off.
function swingAbout(dt) {
  const s = swing;
  const g = 9.8 / s.L;
  const [, iz] = input();
  s.om += (-g * Math.sin(s.th) - 0.12 * s.om) * dt;
  if (iz > 0.1) s.om += Math.sign(s.om || 1) * 1.15 * dt * Math.max(0, Math.cos(s.th));
  s.th += s.om * dt;
  s.th = Math.max(-1.35, Math.min(1.35, s.th));
  s.group.rotation.x = s.th;
  s.group.updateMatrixWorld();
  const seat = seatWorld();
  if (Math.abs(s.om) < 0.15 && Math.abs(s.th) > 0.3 && performance.now() - s.lastCreak > 600) { s.lastCreak = performance.now(); sound.creak(Math.min(1, Math.abs(s.th))); }
  P.vel.subVectors(seat, s.prev).divideScalar(Math.max(dt, 1e-3));
  s.prev.copy(seat);
  P.pos.set(seat.x, seat.y + 0.03, seat.z);
  if (jumpQueued) {
    jumpQueued = false;
    P.swing = false;
    P.vel.multiplyScalar(1.35);
    P.vel.y += 3.5;
    P.grounded = false;
    P.airTime = 0;
    sound.whoosh();
    toast("Hold Space to open the parasol");
  }
}
const sitOnSwing = () => {
  P.swing = true;
  swing.th = 0; swing.om = 0.4;
  swing.group.rotation.x = 0;
  swing.group.updateMatrixWorld();
  seatWorld(swing.prev);
  P.yaw = swing.yaw + Math.PI;
  P.pitch = -0.05;
  P.vel.set(0, 0, 0);
  toast("W to swing higher, Space to let go, E to step off", 4500);
};
const leaveSwing = () => {
  P.swing = false;
  const f = new THREE.Vector3(Math.sin(swing.yaw), 0, Math.cos(swing.yaw));
  const x = swing.group.position.x + f.x * 1.2, z = swing.group.position.z + f.z * 1.2;
  P.pos.set(x, groundAt(x, z).y, z);
  P.vel.set(0, 0, 0);
  P.grounded = true;
  swing.om *= 0.3;
};

function placeCamera(dt, t) {
  const speed = Math.hypot(P.vel.x, P.vel.z);
  let eye = P.swimming ? WATER_FEET + 1.6 + Math.sin(t * 1.7) * 0.07 : P.pos.y + 1.62;
  if (P.boat) eye = 0.35 + 0.95 + Math.sin(t * 1.1 + 1.3) * 0.06;
  if (P.swing) eye = P.pos.y + 1.0;
  if (P.scope) {
    const tp = places.telescope;
    camera.position.set(tp.x, tp.y + 1.45, tp.z);
  } else {
    if ((P.grounded || P.swimming) && speed > 0.5 && !P.boat) {
      P.stride += speed * dt;
      eye += Math.sin(P.stride * 2.1) * 0.045 * Math.min(1, speed / 5);
      const stepLen = P.swimming ? 2.4 : speed > 7 ? 2.2 : 1.5;
      if (P.stride - P.lastStep > stepLen) {
        P.lastStep = P.stride;
        const s = P.swimming ? "water" : surfaceAt(P.pos.x, P.pos.z, P.on);
        sound.step(s);
        if (s === "water") ripples.add(P.pos.x, P.pos.z, 0.7, 0.35, 1.4);
      }
    }
    P.dip *= Math.exp(-dt * 7);
    eye -= P.dip;
    camera.position.set(P.pos.x, eye, P.pos.z);
  }
  const roll = P.boat ? Math.sin(t * 0.9 + 1.3) * 0.025 : 0;
  camera.rotation.set(P.pitch, P.yaw, roll);
  // A tall screen gets a taller view, so it doesn't feel like a keyhole
  const want = P.scope ? 13 : baseFov() + (speed > 7 && P.grounded ? 5 : 0) + (P.gliding ? 7 : 0) + (P.swing ? Math.abs(swing.om) * 3 : 0);
  P.fov += (want - P.fov) * Math.min(1, dt * (P.scope ? 6 : 4));
  if (Math.abs(camera.fov - P.fov) > 0.01) { camera.fov = P.fov; camera.updateProjectionMatrix(); }
  parasolOpen += ((P.gliding ? 1 : 0) - parasolOpen) * Math.min(1, dt * 8);
  parasol.visible = parasolOpen > 0.02;
  parasol.scale.set(parasolOpen, 0.6 + 0.4 * parasolOpen, parasolOpen);
}

// ------------------------------------------------------------------ the HUD
const toastEl = $("toast");
let toastTimer = 0, lastToast = "";
function toast(text, ms = 2600) {
  if (text === lastToast && toastEl.classList.contains("on")) return;
  lastToast = text;
  toastEl.textContent = text;
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("on"), ms);
}
const card = $("card");
let cardTimer = 0, cardLink = null;
function showCard(kicker, title, body, foot, link = null, ms = 11000) {
  $("card-kicker").textContent = kicker;
  $("card-title").textContent = title;
  $("card-body").textContent = body;
  $("card-foot").innerHTML = foot;
  cardLink = link;
  card.hidden = false;
  card.style.animation = "none";
  void card.offsetWidth;
  card.style.animation = "";
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => { card.hidden = true; cardLink = null; }, ms);
}
const dots = $("dots");
lanterns.forEach(() => dots.append(document.createElement("i")));
const tally = () => {
  const n = lanterns.filter((l) => l.lit).length;
  $("tally-text").textContent = `${n} of ${lanterns.length} lanterns`;
  lanterns.forEach((l, i) => dots.children[i].classList.toggle("lit", l.lit));
  return n;
};
tally();

// The compass, with a mark for every lantern still dark
const compass = $("compass");
const marks = [];
for (const [label, deg, minor] of [["N", 0], ["NE", 45, 1], ["E", 90], ["SE", 135, 1], ["S", 180], ["SW", 225, 1], ["W", 270], ["NW", 315, 1]]) {
  const s = document.createElement("span");
  s.textContent = label;
  if (minor) s.className = "minor";
  compass.append(s);
  marks.push({ el: s, bearing: (deg * Math.PI) / 180 });
}
const lanternMarks = lanterns.map((l) => {
  const b = document.createElement("b");
  compass.append(b);
  return { el: b, l };
});
const drawCompass = () => {
  const width = compass.clientWidth;
  if (!width) return;
  const heading = -P.yaw;
  const span = Math.PI * 0.75;
  const place = (el, bearing, extra = "") => {
    let rel = ((bearing - heading) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    const on = Math.abs(rel) < span / 2;
    el.style.display = on ? "" : "none";
    if (on) el.style.transform = `translateX(${((rel / span) * width).toFixed(1)}px)${extra}`;
  };
  marks.forEach((m) => place(m.el, m.bearing));
  lanternMarks.forEach(({ el, l }) => {
    if (l.lit || l.rise) { el.style.display = "none"; return; }
    const p = l.group.position;
    const dx = p.x - P.pos.x, dz = p.z - P.pos.z;
    el.style.setProperty("--o", (0.35 + 0.65 * (1 - smooth(60, 500, Math.hypot(dx, dz)))).toFixed(2));
    place(el, Math.atan2(dx, -dz));
  });
};

// ------------------------------------------------------------------ the map
const mapWrap = $("map-wrap"), mapCanvas = $("map"), mapPen = mapCanvas.getContext("2d");
const MAP = { cx: -20, cz: -80, half: 400 };
let mapBase = null;
const toMap = (x, z) => [((x - MAP.cx + MAP.half) / (2 * MAP.half)) * 900, ((z - MAP.cz + MAP.half) / (2 * MAP.half)) * 900];
function paintMapBase() {
  const N = 300, img = new ImageData(N, N);
  const sea = [[0.6, [148, 220, 206]], [2.5, [104, 196, 200]], [8, [86, 160, 205]], [20, [70, 120, 190]], [99, [58, 96, 168]]];
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    H[j * N + i] = heightAt(MAP.cx - MAP.half + (i + 0.5) / N * 2 * MAP.half, MAP.cz - MAP.half + (j + 0.5) / N * 2 * MAP.half);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const h = H[j * N + i], k = (j * N + i) * 4;
    let c;
    if (h < 0) {
      c = sea.find(([d]) => -h < d)[1];
    } else {
      const hx = H[j * N + Math.min(N - 1, i + 1)] - H[j * N + Math.max(0, i - 1)];
      const hz = H[Math.min(N - 1, j + 1) * N + i] - H[Math.max(0, j - 1) * N + i];
      const shade = Math.max(-0.25, Math.min(0.25, (-hx - hz) * 0.05));
      const g = Math.min(1, h / 90);
      c = [236 - 70 * g, 222 - 34 * g, 178 - 64 * g].map((v) => v * (1 + shade));
      if (h < 1.6) c = [236, 220, 176];
      if (Math.floor(h / 12) !== Math.floor(H[j * N + Math.min(N - 1, i + 1)] / 12) || Math.floor(h / 12) !== Math.floor(H[Math.min(N - 1, j + 1) * N + i] / 12)) c = c.map((v) => v * 0.82);
    }
    const coast = h >= 0 && ((H[j * N + Math.min(N - 1, i + 1)] < 0) || (H[Math.min(N - 1, j + 1) * N + i] < 0) || (H[j * N + Math.max(0, i - 1)] < 0) || (H[Math.max(0, j - 1) * N + i] < 0));
    if (coast) c = [120, 104, 84];
    img.data.set([c[0], c[1], c[2], 255], k);
  }
  const small = document.createElement("canvas");
  small.width = small.height = N;
  small.getContext("2d").putImageData(img, 0, 0);
  const base = document.createElement("canvas");
  base.width = base.height = 900;
  const g = base.getContext("2d");
  g.fillStyle = "#f4f0e4";
  g.fillRect(0, 0, 900, 900);
  g.imageSmoothingQuality = "high";
  g.drawImage(small, 0, 0, 900, 900);
  g.setLineDash([6, 6]);
  g.strokeStyle = "rgba(120, 82, 50, 0.75)";
  g.lineWidth = 2;
  for (const p of PATHS) {
    g.beginPath();
    p.forEach(([x, z], i) => { const [u, v] = toMap(x, z); if (i) g.lineTo(u, v); else g.moveTo(u, v); });
    g.stroke();
  }
  g.setLineDash([]);
  g.fillStyle = "#3b3226";
  g.font = "italic 22px Newsreader, Georgia, serif";
  const label = (text, x, z, dx = 0, dy = 0) => { const [u, v] = toMap(x, z); g.fillText(text, u + dx, v + dy); };
  label("the lighthouse", LH.x, LH.z, -60, 34);
  label("the church", TW.x, TW.z, 12, -12);
  label("the village", 210, 40, -10, 0);
  label("the pier", places.pier.end[0], places.pier.end[2], -40, 28);
  label("the lookout & swing", -20, -290, 14, 6);
  label("the quarry", 96, -322, 14, 6);
  label("the islet", ISLANDS[0][0], ISLANDS[0][1], -30, 44);
  label("a boat", rowboat.x, rowboat.z, -22, 30);
  g.font = "italic 40px Newsreader, Georgia, serif";
  g.fillStyle = "rgba(30, 60, 110, 0.55)";
  label("the cove", -30, -40, -60, 10);
  g.font = "500 15px 'IBM Plex Mono', monospace";
  g.fillStyle = "#5c5b57";
  g.fillText("THE BAY · TAB TO CLOSE", 26, 40);
  g.strokeStyle = "rgba(60, 50, 40, 0.6)";
  g.lineWidth = 3;
  g.strokeRect(14, 14, 872, 872);
  mapBase = base;
}
let mapOpen = false;
const setMap = (open) => {
  mapOpen = open;
  if (open && !mapBase) paintMapBase();
  mapWrap.hidden = !open;
};
const drawMap = () => {
  mapPen.drawImage(mapBase, 0, 0);
  for (const l of lanterns) {
    if (l.rise) continue;
    const [u, v] = toMap(l.group.position.x, l.group.position.z);
    mapPen.beginPath();
    mapPen.arc(u, v, 8, 0, Math.PI * 2);
    mapPen.fillStyle = l.lit ? "#f2a93b" : "rgba(244, 240, 228, 0.9)";
    mapPen.fill();
    mapPen.lineWidth = 2;
    mapPen.strokeStyle = "#7a4a1f";
    mapPen.stroke();
  }
  const [u, v] = toMap(P.pos.x, P.pos.z);
  mapPen.save();
  mapPen.translate(u, v);
  mapPen.rotate(-P.yaw);
  mapPen.beginPath();
  mapPen.moveTo(0, -16);
  mapPen.lineTo(9, 10);
  mapPen.lineTo(0, 5);
  mapPen.lineTo(-9, 10);
  mapPen.closePath();
  mapPen.fillStyle = "#c8372d";
  mapPen.fill();
  mapPen.restore();
};

// ------------------------------------------------------------------ doing things
let post = null;
const fadeTo = (then) => {
  const f = post.final.uniforms.uFade;
  let t = 0;
  const step = () => {
    t += 1 / 60;
    f.value = Math.min(1, t / 0.35);
    if (t < 0.35) return requestAnimationFrame(step);
    then();
    const back = () => {
      t += 1 / 60;
      f.value = Math.max(0, 1 - (t - 0.35) / 0.5);
      if (f.value > 0) requestAnimationFrame(back);
    };
    requestAnimationFrame(back);
  };
  requestAnimationFrame(step);
};
const teleport = (x, y, z, yaw, also) => fadeTo(() => {
  also?.();
  P.pos.set(x, y, z);
  P.vel.set(0, 0, 0);
  P.yaw = yaw;
  P.pitch = -0.1;
  P.grounded = true;
  P.swimming = false;
});

let finale = null;
// Where each lantern comes to rest at the end: a loose ring over the cove.
const skySpot = (i) => {
  const a = (i / lanterns.length) * Math.PI * 2;
  return new THREE.Vector3(-20 + Math.cos(a) * 58, 62 + (i % 4) * 9, -55 + Math.sin(a) * 58);
};
const lightLantern = (l) => {
  l.lit = true;
  l.lightT = 0;
  litKeys.add(l.p.key);
  saveLit();
  sound.flame();
  sound.chime(l.i);
  const n = tally();
  const { p } = l;
  const foot = `<a href="${p.href}" target="_blank" rel="noopener" style="color:inherit">${p.href.replace("https://", "")}</a> · <kbd>O</kbd> opens it`;
  showCard(`${n} of ${lanterns.length} · ${p.stack || "project"}`, p.name, p.detail || "One of this year's projects.", foot, p.href);
  if (n === lanterns.length) setTimeout(startFinale, 2200);
};
function startFinale() {
  if (finale) return;
  const t = Date.now() + skew * 6e4;
  if (sunAt(t).alt > -8) glideTo(wrap(skew + sunCrossing(false, t) + 55), 7000);
  finale = { t: 0 };
  lanterns.forEach((l, i) => {
    l.rise = { from: l.group.position.clone(), to: skySpot(i), delay: i * 0.9 };
  });
  setTimeout(() => ringBell(), 1500);
  setTimeout(() => sound.melody(), 4000);
  setTimeout(() => showCard("all eleven", "The bay is lit",
    "Every project from this year, floating over the water. Thank you for walking all the way round.",
    `<a href="../" style="color:inherit">back to the page</a> · <a href="https://github.com/Prit36" target="_blank" rel="noopener" style="color:inherit">github.com/Prit36</a>`, "https://github.com/Prit36", 20000), 5000);
  $("reset").hidden = false;
}
// Lanterns already all lit on an earlier visit go straight to the sky.
if (lanterns.every((l) => l.lit)) {
  finale = { t: 999 };
  lanterns.forEach((l, i) => {
    l.rise = { from: l.group.position.clone(), to: skySpot(i), delay: 0 };
  });
  $("reset").hidden = false;
}
$("reset").addEventListener("click", () => {
  try { localStorage.removeItem("world-lanterns"); } catch { /* storage is optional */ }
  location.reload();
});

const free = () => !P.boat && !P.swing && !P.scope;
const actions = [];
for (const l of lanterns) {
  actions.push({ at: () => lanternWorld(l), r: 4.4, when: () => !l.lit && !l.rise && free(), label: "light the lantern", act: () => lightLantern(l) });
}
{
  const d = LH.door;
  actions.push({ at: () => new THREE.Vector3(d[0], d[1] + 1.4, d[2]), r: 3.6, when: free, label: "climb the lighthouse",
    act: () => teleport(LH.x + 2.4, LH.gallery, LH.z - 0.4, -Math.PI / 2 - 0.3) });
  actions.push({ at: () => new THREE.Vector3(LH.x + Math.cos(LH.da) * 2.4, LH.gallery + 1, LH.z + Math.sin(LH.da) * 2.4), r: 2.2, label: "climb down",
    when: () => P.pos.y > LH.gallery - 1 && free(), act: () => teleport(d[0] + Math.cos(LH.da) * 1.5, d[1], d[2] + Math.sin(LH.da) * 1.5, -LH.da - Math.PI / 2) });
  const s = Math.sin(TW.rot), c = Math.cos(TW.rot);
  const door = [TW.x + s * 2.9, TW.y, TW.z + c * 2.9];
  actions.push({ at: () => new THREE.Vector3(door[0], door[1] + 1.4, door[2]), r: 3.4, when: free, label: "climb the bell tower",
    act: () => teleport(TW.x + s * 1.2, TW.floor + 0.3, TW.z + c * 1.2, TW.rot + Math.PI + 0.25) });
  actions.push({ at: () => bell.position.clone().add(new THREE.Vector3(0, -0.6, 0)), r: 2.8, label: "ring the bell",
    when: () => P.pos.y > TW.floor - 1 && free(), act: ringBell });
  actions.push({ at: () => new THREE.Vector3(TW.x - s * 1.4 + c * 1.4, TW.floor + 1, TW.z - c * 1.4 - s * 1.4), r: 2, label: "climb down",
    when: () => P.pos.y > TW.floor - 1 && free(), act: () => teleport(door[0] + s * 1.2, door[1], door[2] + c * 1.2, TW.rot) });
  actions.push({ at: () => rowboat.mesh.position.clone().add(new THREE.Vector3(0, 0.6, 0)), r: 4.2, when: free, label: "take the boat out",
    act: () => teleport(rowboat.x, 0.35, rowboat.z, rowboat.heading + Math.PI, () => {
      P.boat = rowboat;
      P.swimming = false;
      toast("W and S row, A and D turn. E by the shore to step out.", 5000);
    }) });
  actions.push({ at: () => seatWorld().add(new THREE.Vector3(0, 0.5, 0)), r: 2.8, when: free, label: "sit on the swing", act: sitOnSwing });
  const tp = places.telescope;
  actions.push({ at: () => new THREE.Vector3(tp.x, tp.y + 1.2, tp.z), r: 2.4, when: free, label: "look through the telescope",
    act: () => { P.scope = true; P.yaw = tp.yaw; P.pitch = -0.02; toast("Mouse to look, E to step back", 3500); } });
  for (const c of cats.cats) {
    actions.push({ at: () => c.g.position.clone().add(new THREE.Vector3(0, 0.3, 0)), r: 2.3, when: () => free() && c.pet <= 0, label: "stroke the cat",
      act: () => {
        cats.petted(c);
        sound.purr();
        toast(["Purring. It'll follow you for a bit.", "It leans into your hand.", "A slow blink. That means yes.", "Purring, loudly."][c.i % 4]);
      } });
  }
}
let focused = null;
const promptEl = $("prompt"), aimEl = $("aim");
const fwd = new THREE.Vector3(), to = new THREE.Vector3();
let lastHint = "";
const findAction = () => {
  // While rowing, swinging or looking, E has one job
  let hint = null;
  if (P.boat) { const spot = landing(); hint = spot ? (spot.pier ? "climb onto the pier" : "step ashore") : null; }
  else if (P.swing) hint = "step off the swing";
  else if (P.scope) hint = "step back";
  if (hint || P.boat || P.swing || P.scope) {
    focused = null;
    const text = hint ? `<kbd>${touch ? "tap" : "E"}</kbd>${hint}` : "";
    if (text !== lastHint) { lastHint = text; promptEl.innerHTML = text; promptEl.hidden = !text; }
    aimEl.classList.toggle("on", false);
    return;
  }
  if (lastHint) { lastHint = ""; promptEl.hidden = true; }
  camera.getWorldDirection(fwd);
  let best = null, bestScore = 0.3;
  for (const a of actions) {
    if (a.when && !a.when()) continue;
    const at = a.at();
    to.subVectors(at, camera.position);
    const d = to.length();
    if (d > a.r) continue;
    const score = to.normalize().dot(fwd) + (d < 1.6 ? 0.4 : 0);
    if (score > bestScore) { best = a; bestScore = score; }
  }
  if (best !== focused) {
    focused = best;
    promptEl.hidden = !best;
    if (best) promptEl.innerHTML = `<kbd>${touch ? "tap" : "E"}</kbd>${best.label}`;
    aimEl.classList.toggle("on", !!best);
  }
};
const act = () => {
  if (P.boat) { leaveBoat(); return; }
  if (P.swing) { leaveSwing(); return; }
  if (P.scope) { P.scope = false; return; }
  if (!focused) return;
  const a = focused;
  focused = null;
  promptEl.hidden = true;
  aimEl.classList.remove("on");
  a.act();
};

// Water, stones and the ball
function splash(x, z, size = 1) {
  ripples.add(x, z, size, 0.55, 1.8);
  ripples.add(x, z, size * 0.5, 0.4, 1.2);
}
let best = 0;
try { best = Number(localStorage.getItem("world-skips")) || 0; } catch { /* storage is optional */ }
const stoneEvents = {
  skip: (x, z, n) => { ripples.add(x, z, 0.5, 0.5, 1.5); sound.plip(n); },
  sink: (x, z, n) => { splash(x, z, 0.5); sound.splash(0.35, camera.position.distanceTo(new THREE.Vector3(x, 0, z))); skipped(n); },
  land: (x, z, n) => { sound.clack(camera.position.distanceTo(new THREE.Vector3(x, 0, z))); skipped(n); },
};
function skipped(n) {
  if (!n) return;
  if (n > best) {
    best = n;
    try { localStorage.setItem("world-skips", String(best)); } catch { /* storage is optional */ }
    toast(n === 1 ? "One skip. Flatter, and lower." : `${n} skips, your best yet`);
  } else {
    toast(n === 1 ? "One skip" : `${n} skips`);
  }
}
const ballEvents = {
  splash: (x, z, s) => splash(x, z, s),
  bounce: (p, v) => sound.boing(camera.position.distanceTo(p) * (2 - Math.min(1, v / 6))),
};
const fishEvents = { splash: (x, z, s) => { splash(x, z, s); sound.splash(0.25, Math.hypot(x - P.pos.x, z - P.pos.z)); } };
let lastThrow = 0;
const throwStone = () => {
  const now = performance.now();
  if (now - lastThrow < 300 || P.swimming || P.scope) return;
  lastThrow = now;
  camera.getWorldDirection(fwd);
  const from = camera.position.clone().addScaledVector(fwd, 0.6).add(new THREE.Vector3(0, -0.3, 0));
  stones.throwStone(from, fwd, P.vel.clone().multiplyScalar(0.5));
};

// ------------------------------------------------------------------ input
post = createPost(renderer);
post.resize();
const locked = () => document.pointerLockElement === canvas;
// Where the browser won't lock the pointer (some embeds, some settings), the
// mouse drags to look instead, and a click without a drag throws.
let dragLook = false, lockTimer = 0;
const enter = () => {
  sound.start();
  if (touch) { begin(); return; }
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => {
    if (locked()) return;
    dragLook = true;
    begin();
    toast("Drag to look around. Esc pauses.", 4000);
  }, 600);
  const p = canvas.requestPointerLock?.({ unadjustedMovement: true });
  if (p?.catch) p.catch(() => canvas.requestPointerLock()?.catch?.(() => {}));
};
let started = false;
const begin = () => {
  clearTimeout(lockTimer);
  playing = true;
  intro.classList.add("out");
  hud.hidden = false;
  $("touch").hidden = !touch;
  canvas.style.cursor = dragLook ? "grab" : "none";
  if (!started) {
    started = true;
    fadeTo(() => {});
    const lit = lanterns.filter((l) => l.lit).length;
    const hello = lit === lanterns.length ? "All eleven lanterns are over the cove, where you left them."
      : lit ? `${lit} of ${lanterns.length} lanterns lit so far. ${touch ? "Map" : "Tab"} shows the rest.`
        : `Eleven lanterns are hidden around the bay. ${touch ? "Map" : "Tab"} shows where.`;
    setTimeout(() => toast(hello, 5200), dragLook ? 4500 : 900);
  }
};
const pause = () => {
  playing = false;
  keys.clear();
  goBtn.textContent = "Keep walking";
  intro.classList.remove("out");
  canvas.style.cursor = "";
  setMap(false);
};
document.addEventListener("pointerlockchange", () => {
  if (locked()) { dragLook = false; begin(); } else if (!dragLook) pause();
});
goBtn.addEventListener("click", enter);
canvas.addEventListener("click", () => { if (!playing && !touch && started) enter(); });

let drag = null;
document.addEventListener("mousemove", (e) => {
  let dx = e.movementX, dy = e.movementY;
  if (!locked()) {
    if (!dragLook || !drag || !playing) return;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    dx *= 1.6; dy *= 1.6;
  }
  const k = P.scope ? 0.0005 : 0.0022;
  P.yaw -= dx * k;
  P.pitch = Math.max(-1.5, Math.min(1.5, P.pitch - dy * k));
});
document.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (locked()) throwStone();
  else if (dragLook && playing && e.target === canvas) { drag = { moved: 0, t: performance.now() }; canvas.style.cursor = "grabbing"; }
});
document.addEventListener("mouseup", () => {
  if (!drag) return;
  if (drag.moved < 6 && performance.now() - drag.t < 300) throwStone();
  drag = null;
  canvas.style.cursor = dragLook && playing ? "grab" : "";
});
document.addEventListener("wheel", (e) => {
  if (!playing) return;
  glide = null;
  skew += Math.sign(e.deltaY) * (e.shiftKey ? 60 : 12);
}, { passive: true });
document.addEventListener("keydown", (e) => {
  if (e.code === "Tab") { e.preventDefault(); if (playing) setMap(!mapOpen); return; }
  if (e.code === "Escape" && P.scope) { P.scope = false; return; }
  if (e.code === "Escape" && dragLook && playing) { pause(); return; }
  if (!playing) return;
  if (e.code === "Space") { e.preventDefault(); if (!e.repeat) jumpQueued = true; }
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === "KeyE" || e.code === "Enter") act();
  else if (e.code === "KeyN") { skyHome(); toast("Back to now in Surat"); }
  else if (e.code === "KeyT") { skew = wrap(skew); glideTo(skew + 1440, 24000, () => { skew = wrap(skew); }); toast("A whole day, in twenty-four seconds"); }
  else if (e.code === "KeyM") toast(sound.toggle() ? "Sound off" : "Sound on");
  else if (e.code === "KeyH") document.documentElement.classList.toggle("is-bare");
  else if (e.code === "KeyO" && cardLink) window.open(cardLink, "_blank", "noopener");
});
document.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

// Touch: the left side is a stick, the right side looks; a tap throws.
if (touch) {
  const looks = new Map();
  const stickEl = $("stick"), knob = stickEl.firstElementChild;
  canvas.addEventListener("touchstart", (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.4 && stick.id === null) { stick.id = t.identifier; stick.ox = t.clientX; stick.oy = t.clientY; }
      else looks.set(t.identifier, { x: t.clientX, y: t.clientY, t0: performance.now(), moved: 0 });
    }
  }, { passive: true });
  canvas.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) {
        const dx = (t.clientX - stick.ox) / 55, dy = (t.clientY - stick.oy) / 55, l = Math.max(1, Math.hypot(dx, dy));
        stick.x = dx / l; stick.y = dy / l;
        knob.style.transform = `translate(${stick.x * 37}px, ${stick.y * 37}px)`;
      } else if (looks.has(t.identifier)) {
        const l = looks.get(t.identifier);
        const k = P.scope ? 0.0015 : 0.006;
        P.yaw -= (t.clientX - l.x) * k;
        P.pitch = Math.max(-1.4, Math.min(1.4, P.pitch - (t.clientY - l.y) * k));
        l.moved += Math.abs(t.clientX - l.x) + Math.abs(t.clientY - l.y);
        l.x = t.clientX; l.y = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) { stick.id = null; stick.x = stick.y = 0; knob.style.transform = ""; }
      const l = looks.get(t.identifier);
      if (l && l.moved < 12 && performance.now() - l.t0 < 250 && playing) throwStone();
      looks.delete(t.identifier);
    }
  };
  canvas.addEventListener("touchend", end);
  canvas.addEventListener("touchcancel", end);
  const jumpBtn = $("t-jump");
  jumpBtn.addEventListener("pointerdown", () => { jumpQueued = true; touchJump = true; });
  jumpBtn.addEventListener("pointerup", () => { touchJump = false; });
  jumpBtn.addEventListener("pointercancel", () => { touchJump = false; });
  $("t-hours").addEventListener("click", () => { glide = null; skew += 60; });
  $("t-map").addEventListener("click", () => setMap(!mapOpen));
  promptEl.addEventListener("click", act);
}

const onResize = () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  post.resize();
};
window.addEventListener("resize", onResize);

// ------------------------------------------------------------------ the frame
const clockEl = $("clock");
let L = lightOf(Date.now());
let t = 0, last = performance.now(), hudTick = 0, slow = 0, fast = 0;
let quality = 3; // 3 best … 0 lightest
const tmp = new THREE.Vector3(), center = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3(), sunWorld = new THREE.Vector3();
const skyTint = new THREE.Color();
const setQuality = (q) => {
  quality = Math.max(0, Math.min(3, q));
  grass.density = [0.45, 0.65, 0.85, 1][quality];
  post.scale = [0.62, 0.75, 0.88, 1][quality];
};
setQuality(touch ? 1 : 3);

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;

  // Time of day
  if (glide) {
    glide.t += dt * 1000;
    const k = Math.min(1, glide.t / glide.ms);
    skew = glide.from + (glide.to - glide.from) * (k < 0.5 ? 4 * k ** 3 : 1 - (2 - 2 * k) ** 3 / 2);
    if (k >= 1) { const d = glide.done; glide = null; d?.(); }
  }
  const time = Date.now() + skew * 6e4;
  L = lightOf(time);

  // The player, or the slow circling view behind the title
  if (playing) {
    movePlayer(dt);
    placeCamera(dt, t);
  } else if (!started) {
    const a = t * 0.02 + 2.1;
    camera.position.set(-30 + Math.cos(a) * 230, 48, -50 + Math.sin(a) * 230);
    camera.lookAt(-60, 8, -50);
  }
  camera.updateMatrixWorld();

  // Light, shared by everything
  const night = L.night;
  U.uTime.value = t;
  U.uSunDir.value.copy(L.sunDir);
  U.uSunUp.value = L.sunUp;
  U.uNight.value = night;
  U.uFogColor.value.copy(palette.fog);
  U.uFogGlow.value.copy(palette.fog).lerp(palette.glow, L.sunUp * 0.85);
  U.uFogDensity.value = 0.00013 * (1 + 0.5 * L.gold);
  U.uPlayer.value.copy(P.pos);
  U.uGust.value = 0.75 + 0.35 * Math.sin(t * 0.13) * Math.sin(t * 0.071 + 1);
  sunLight.color.copy(palette.light);
  sunLight.intensity = L.strength * 1.08;
  hemi.color.copy(palette.hemiSky);
  hemi.groundColor.copy(palette.hemiGround);
  hemi.intensity = THREE.MathUtils.lerp(0.72, 0.34, night) * (1 - 0.15 * L.gold);

  // The shadow map covers the ground ahead of you, stepped to its own
  // texels so the edges don't crawl as you walk.
  if (playing || started) {
    camera.getWorldDirection(fwd);
    center.set(P.pos.x + fwd.x * 30, P.pos.y, P.pos.z + fwd.z * 30);
  } else center.set(-60, 8, -50);
  right.crossVectors(new THREE.Vector3(0, 1, 0), L.lightDir).normalize();
  upv.crossVectors(L.lightDir, right);
  const texel = (2 * SHADOW) / SHADOW_MAP;
  const cr = center.dot(right), cu = center.dot(upv);
  center.addScaledVector(right, Math.round(cr / texel) * texel - cr).addScaledVector(upv, Math.round(cu / texel) * texel - cu);
  sunLight.target.position.copy(center);
  sunLight.position.copy(center).addScaledVector(L.lightDir, 420);
  sunLight.target.updateMatrixWorld();

  const su = sky.uniforms;
  su.uMoon.value.copy(L.moonDir);
  su.uPhase.value = L.phase;
  su.uMoonUp.value = L.moonUp;
  sky.mesh.position.copy(camera.position);
  clouds.uniforms.uLight.value.copy(L.alt > -1.5 ? L.sunDir : L.moonDir);
  clouds.uniforms.uBright.value = 1.25 + 0.2 * L.gold;
  clouds.group.rotation.y += dt * 0.0012;

  const wu = water.uniforms;
  wu.uLight.value.copy(L.alt > -1.5 ? L.sunDir : L.moonDir);
  wu.uGlint.value = L.alt > -1.5 ? L.sunUp * (0.8 + 0.6 * L.gold) : L.moonUp * (0.2 + 0.6 * L.lit);
  wu.uGlintCol.value.copy(palette.light).multiplyScalar(L.alt > -1.5 ? 1 : 0.6);
  skyTint.copy(palette.horizon).lerp(palette.zenith, 0.4);
  windows.uniforms.uSky.value.copy(skyTint);
  windows.uniforms.uDay.value = 0.35 + 0.65 * (1 - night);

  // The lighthouse works from dusk
  const beamOn = Math.max(0, Math.min(1, night * 1.6 - 0.25));
  beam.visible = beamOn > 0.01;
  beam.rotation.y = (t / 9) * Math.PI * 2;
  beam.userData.mat.uniforms.uOn.value = beamOn;
  wu.uLamp.value.copy(LH.lamp);
  wu.uBeam.value = -beam.rotation.y;
  wu.uBeamOn.value = beamOn;
  tmp.subVectors(camera.position, LH.lamp).setY(0).normalize();
  const along = tmp.x * Math.cos(beam.rotation.y) - tmp.z * Math.sin(beam.rotation.y);
  const flash = Math.max(along, -along) ** 10;
  lamp.visible = beamOn > 0.01;
  lamp.scale.setScalar(4 + 16 * flash);
  lamp.material.opacity = beamOn * (0.6 + 0.4 * flash);
  lampLight.intensity = beamOn * 10;

  windows.uniforms.uTime.value = t;
  glows.uniforms.uNight.value = night;
  glows.uniforms.uTime.value = t;
  const scale = post.height / 2 / Math.tan((camera.fov * Math.PI) / 360);
  glows.uniforms.uScale.value = scale;
  fireflies.uniforms.uNight.value = night;
  fireflies.uniforms.uTime.value = t;
  fireflies.uniforms.uScale.value = scale;
  motes.uniforms.uCenter.value.copy(camera.position);
  motes.uniforms.uScale.value = scale;
  motes.uniforms.uAmount.value = L.sunUp * (1 - night);

  // Moving things
  grass.update(camera.position);
  flora.update(camera.position);
  gulls.update(dt, t, night);
  butterflies.update(dt, t, P.pos, 1 - night);
  cats.update(dt, t, P);
  fish.update(dt, P.pos, fishEvents);
  stones.update(dt, stoneEvents);
  ball.update(dt, P, ballEvents);
  ripples.update(dt, 1 - night * 0.55);
  for (const b of world.boats) {
    if (b.kind === "sail") {
      b.phase += dt * b.sp;
      b.mesh.position.set(b.cx + Math.cos(b.phase) * b.rad, Math.sin(t * 0.9 + b.rad) * 0.15, b.cz + Math.sin(b.phase) * b.rad);
      b.mesh.rotation.set(Math.sin(t * 0.7) * 0.04, Math.atan2(-Math.sin(b.phase) * Math.sign(b.sp), Math.cos(b.phase) * Math.sign(b.sp)), 0.12 * Math.sign(b.sp), "YXZ");
    } else {
      b.mesh.position.y = Math.sin(t * 1.1 + b.phase) * 0.08 - 0.05;
      b.mesh.rotation.x = Math.sin(t * 0.9 + b.phase) * 0.03;
      b.mesh.rotation.z = Math.sin(t * 0.7 + b.phase * 2) * 0.04;
    }
  }
  {
    const b = rowboat;
    b.mesh.position.set(b.x, Math.sin(t * 1.1 + b.phase) * 0.07 - 0.04, b.z);
    b.mesh.rotation.set(Math.sin(t * 0.9 + b.phase) * 0.03 - (P.boat ? b.speed * 0.006 : 0), b.heading, Math.sin(t * 0.7 + b.phase * 2) * 0.035, "YXZ");
  }
  board.k *= Math.exp(-dt * 3);
  if (!P.swing) {
    swing.om += (-9.8 / swing.L * Math.sin(swing.th) - 0.4 * swing.om) * dt;
    swing.th += swing.om * dt;
    swing.group.rotation.x = swing.th;
  }
  // The bell swings, and keeps time
  bellT += dt;
  bell.rotation.x = bellSwing * Math.sin(bellT * 3.2) * Math.exp(-bellT * 0.45);
  if (strikes.length && bellT >= strikes[0]) {
    sound.bell(camera.position.distanceTo(bell.position), 0.75 ** (4 - strikes.length));
    strikes.shift();
  }
  const [h, m] = hoursAt(time);
  hourHand.rotation.z = -((h % 12) + m / 60) / 12 * Math.PI * 2;
  minuteHand.rotation.z = -(m / 60) * Math.PI * 2;
  // Stones ring the bell and push the ball
  for (const s of stones.list) {
    if (!s.on || s.state !== "fly") continue;
    if (s.p.distanceTo(bell.position) < 1.4 && bellT > 0.6) { ringBell(); s.v.multiplyScalar(-0.3); }
    if (s.p.distanceTo(ball.p) < 0.5) { ball.hit(s.v.clone().multiplyScalar(0.25)); s.v.multiplyScalar(0.3); }
  }

  // Lanterns: bob in the wind, glow once lit, rise at the end
  for (const l of lanterns) {
    l.lightT += dt;
    l.hang.rotation.z = Math.sin(t * 1.3 + l.i) * 0.06;
    l.hang.rotation.x = Math.sin(t * 1.1 + l.i * 2) * 0.05;
    const on = l.lit ? smooth(0, 0.8, l.lightT) : 0;
    const flick = 0.85 + 0.15 * Math.sin(t * 9 + l.i * 3) * Math.sin(t * 5.3 + l.i);
    l.mat.emissive.setRGB(1.6, 0.85, 0.3).multiplyScalar(on * (0.7 + 1.1 * night) * flick);
    l.light.intensity = on * (0.6 + 2.5 * night) * flick;
    l.glow.material.opacity = on ? on * (0.25 + 0.75 * night) * flick : (0.1 + 0.08 * Math.sin(t * 2 + l.i)) * (0.3 + 0.7 * night);
    l.glow.material.color.setRGB(...(on ? [3, 1.8, 0.8] : [1.6, 1.8, 2.4]));
    l.glow.scale.setScalar(on ? 2.2 + 1.8 * night : 1.5);
    if (l.rise && finale) {
      const k = smooth(0, 1, (finale.t - l.rise.delay) / 28);
      l.group.position.lerpVectors(l.rise.from, l.rise.to, k);
      l.group.position.x += Math.sin(t * 0.4 + l.i) * 3 * k;
      l.group.children.forEach((c) => { if (c !== l.hang) c.visible = k < 0.02; });
      l.group.scale.setScalar(1 + 1.6 * k);
      if (k > 0) { l.glow.scale.setScalar(3 + 6 * k); l.glow.material.opacity = 0.6 + 0.4 * night; }
    }
  }
  if (finale) finale.t += dt;

  if (playing) findAction();

  // Sound of the place
  if (playing) {
    let wet = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (heightAt(P.pos.x + Math.cos(a) * 30, P.pos.z + Math.sin(a) * 30) < 0) wet++;
    }
    const high = smooth(15, 80, P.pos.y - Math.max(0, heightAt(P.pos.x, P.pos.z)));
    sound.update(t, {
      shore: P.boat ? 0.7 : wet > 0 && wet < 8 ? 1 : wet === 8 ? 0.45 : 0.15,
      high, wind: P.gliding ? 1 : P.swing ? Math.min(1, Math.abs(swing.om) * 0.5) : smooth(4, 12, Math.hypot(P.vel.x, P.vel.z)) * 0.3,
      day: 1 - night, night, trees: field(P.pos.x, P.pos.z).village > 0.1 || P.pos.y > 20 ? 1 : 0.4,
    });
  }

  // The HUD, a few times a second
  hudTick -= dt;
  if (hudTick <= 0 && playing) {
    hudTick = 0.25;
    const said = `${two(h)}:${two(m)} in Surat · sun ${L.alt < 0 ? "−" : ""}${Math.abs(Math.round(L.alt))}°`;
    clockEl.textContent = night > 0.4 ? `${said} · ${PHASES[Math.round(L.phase * 8) % 8]}` : said;
  }
  if (playing) drawCompass();
  if (mapOpen) drawMap();

  // Draw: what the water mirrors, then the bay, then the finish
  const pf = post.final.uniforms;
  pf.uExposure.value = 0.92 + night * 0.8;
  pf.uBloom.value = 0.45 + 0.55 * night;
  pf.uVignette.value = P.scope ? 1.6 : 0.32;
  post.rays = 0.32 * L.sunUp * (1 + 1.2 * L.gold) * (1 - night);
  sunWorld.copy(camera.position).addScaledVector(L.sunDir, 1000);
  if (quality > 0 || !touch) water.reflect(renderer, scene, camera, Math.max(1, Math.round(post.width * (quality > 1 ? 0.5 : 0.35))), Math.max(1, Math.round(post.height * (quality > 1 ? 0.5 : 0.35))));
  renderer.shadowMap.needsUpdate = true;
  post.render(scene, camera, sunWorld);

  // Keep the frame rate: draw less when it struggles, more when it doesn't
  if (dt > 1 / 38) slow += dt; else slow = Math.max(0, slow - dt * 0.5);
  if (dt < 1 / 57) fast += dt; else fast = 0;
  if (slow > 1.5 && quality > 0) { setQuality(quality - 1); slow = 0; }
  if (fast > 8 && quality < 3) { setQuality(quality + 1); fast = 0; }
}
renderer.setAnimationLoop(frame);

goBtn.disabled = false;
goBtn.textContent = "Walk in";

// For looking around while working on the bay: ?dev puts a handle on window.
if (new URLSearchParams(location.search).has("dev")) {
  window.bay = {
    P, camera, places, lanterns, post, actions, rowboat, swing, cats, world, U, renderer, scene, water,
    hour(m) { glide = null; skew = m; },
    at(h) { glide = null; const nowMin = ((Date.now() / 6e4) + 330) % 1440; skew = h * 60 - nowMin; },
    look(x, y, z, yaw, pitch = -0.1) { P.pos.set(x, y ?? groundAt(x, z).y, z); P.yaw = yaw; P.pitch = pitch; P.vel.set(0, 0, 0); P.grounded = true; P.swimming = false; },
    play() { started = true; begin(); },
    quality: (q) => setQuality(q),
    act, keys, map: () => setMap(!mapOpen),
  };
}
