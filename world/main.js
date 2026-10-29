import * as THREE from "three";
import { heightAt, groundAt, pushOut, field, buildTerrain, smooth, seaAt, PATHS, STEP_UP, ISLANDS, rng } from "./land.js";
import { lightOf, palette, createSky, createClouds, createRanges, PHASES, sunAt } from "./sky.js";
import { createWater, createRipples } from "./water.js";
import { buildWorld, createWindows, createGlows, createBulbs } from "./build.js";
import { createFlora, createGrass, createClutter } from "./flora.js";
import { createGulls, createPerchers, createButterflies, createMotes, createFireflies, createFish, createShoals, createCrabs, createStones, createBall, createCats, createDolphins } from "./life.js";
import { createFireworks, createSpray, createSmoke } from "./fx.js";
import { createBalloon } from "./balloon.js";
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
// Settings that stay between visits, if the browser lets them
const stored = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage is optional */ } };
// A steadier camera, for anyone who'd rather not have the bob and the sway
const prefersCalm = matchMedia("(prefers-reduced-motion: reduce)");
let calm = stored("world-calm", prefersCalm.matches ? "1" : "0") === "1";
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
// A page opened in a hidden tab can start with no size at all
const aspect = () => Math.max(1, innerWidth) / Math.max(1, innerHeight);
const baseFov = () => 70 + Math.max(0, 1 - aspect()) * 26;
const camera = new THREE.PerspectiveCamera(baseFov(), aspect(), 0.15, 24000);
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
scene.add(createBulbs(world.bulbs).mesh);
const flora = createFlora(scene, world.plants);
const grass = createGrass();
scene.add(...grass.meshes);
const clutter = createClutter();
scene.add(clutter.mesh);
water.setObstacles(world.foam);
const gulls = createGulls();
scene.add(gulls.mesh);
// Splashes, sand, dust and sparks
const spray = createSpray();
scene.add(spray.group);
// Smoke from the chimneys
const smoke = createSmoke(world.chimneys);
scene.add(smoke.mesh);
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
const dolphins = createDolphins();
scene.add(dolphins.mesh);
// Gulls standing about on the pier posts, the beached boat and the kiosk roof
const perchers = (() => {
  const { along, deck } = places.pier, spots = [];
  for (const [o, side] of [[12.4, 1.4], [19.2, -1.4], [26, 1.4], [32.8, 1.4], [39.6, -1.4], [46.4, 1.4]]) {
    const [x, z] = along(o, side);
    spots.push([x, deck + 0.42, z]);
  }
  spots.push([places.beachBoat[0] + 0.3, places.beachBoat[1] + 0.05, places.beachBoat[2] - 0.6]);
  spots.push([places.kiosk[0], places.kiosk[1] + 3.1, places.kiosk[2]]);
  return createPerchers(spots);
})();
scene.add(perchers.mesh);
// Shoals in the shallows, and crabs on the sand
const findSpots = (n, seeds, test, spread = 14) => {
  const out = [], rr = rng(31);
  for (const [sx, sz] of seeds) {
    for (let k = 0; k < 60 && out.length < n; k++) {
      const x = sx + (rr() - 0.5) * spread * 2, z = sz + (rr() - 0.5) * spread * 2;
      if (test(x, z, heightAt(x, z)) && out.every(([ox, oz]) => Math.hypot(ox - x, oz - z) > 6)) { out.push([x, z]); break; }
    }
  }
  return out;
};
const shoals = createShoals(findSpots(4, [[112, -78], [98, -98], [126, -40], [104, -58]], (x, z, h) => h < -0.9 && h > -2.2));
scene.add(shoals.mesh);
const crabs = createCrabs(findSpots(7, [[120, -82], [126, -66], [131, -48], [135, -30], [138, -10], [96, -110], [110, -92]], (x, z, h) => h > 0.35 && h < 1.1 && field(x, z).beach > 0.6, 8));
scene.add(crabs.mesh);
// Fireworks go up from a raft in the middle of the cove
const fireworks = createFireworks();
scene.add(fireworks.group);
const SHOW = { x: -10, z: -40 };
let showNight = -1;
{
  const raft = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 4), toonish("#8a6646"));
  deck.position.y = 0.1;
  raft.add(deck);
  for (const [x, z] of [[-1, -1], [1, 0.6], [0.2, -0.9]]) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), toonish("#b8453a"));
    crate.position.set(x, 0.55, z);
    raft.add(crate);
  }
  raft.position.set(SHOW.x, 0, SHOW.z);
  raft.traverse((o) => { o.castShadow = true; o.layers.enable(1); });
  scene.add(raft);
  SHOW.raft = raft;
}
// Where a sound comes from: how far, and how far to the left or right
const placeSound = (x, z) => {
  const dx = x - camera.position.x, dz = z - camera.position.z, d = Math.hypot(dx, dz) || 1;
  return [d, (dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw)) / d];
};
const fireworkEvents = {
  launch: (p) => sound.launch(camera.position.distanceTo(tmpV.set(...p))),
  boom: (p, crackle) => sound.boom(camera.position.distanceTo(tmpV.set(...p)), crackle),
};
const dolphinEvents = {
  splash: (x, z, s) => { ripples.add(x, z, s, 0.5, 1.6); ripples.add(x, z, s * 0.5, 0.4, 1.1); spray.splash(x, 0, z, s * 0.8); },
  call: (p) => sound.dolphin(...placeSound(p.x, p.z)),
};
const percherEvents = {
  lift: (p, n) => sound.flutter(...placeSound(p.x, p.z), n),
};
const crabEvents = {
  scuttle: (p) => sound.scuttle(...placeSound(p.x, p.z)),
  plop: (p) => { ripples.add(p.x, p.z, 0.25, 0.35, 1); },
};
const tmpV = new THREE.Vector3();

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
// The bell strikes again each time it swings back, softer each time. On
// the hour it tolls the hour, slow and even.
let bellSwing = 0, bellT = 9, swingT = 9, strikes = [];
const bellSound = (volume) => sound.bell(camera.position.distanceTo(bell.position), volume, placeSound(bell.position.x, bell.position.z)[1]);
const ringBell = () => {
  bellSwing = 0.55;
  bellT = 0;
  swingT = 0;
  strikes = [[0.98, 0.42], [1.96, 0.56], [2.94, 0.75]].map(([at, v]) => ({ at, v }));
  bellSound(1);
  gulls.startle();
  perchers.startle();
};
const tollHour = (n) => {
  bellSwing = 0.32;
  bellT = 0;
  strikes = Array.from({ length: n }, (_, i) => ({ at: i * 2.3 + 0.05, v: 0.7, swing: true }));
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
  return { p, i, group, hang, mat, glow, light, lit, home: group.position.clone(), lightT: lit ? 9 : 0, rise: null, kick: 0 };
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

// ------------------------------------------------------------------ the balloon
// Tethered in the meadow above the beach. Space fires the burner, Shift
// lets air out, W A S D drift her with what breeze there is up there.
const BAL = (() => {
  const b = createBalloon();
  const [x, y, z] = places.balloon;
  b.group.position.set(x, y, z);
  scene.add(b.group);
  return { ...b, x, y, z, vx: 0, vy: 0, vz: 0, heat: 0, glow: 0 };
})();

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
  boat: null, swing: false, scope: false, balloon: false, bench: false,
  fovKick: 0,
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
  if (P.balloon) return flyBalloon(dt);
  if (P.scope || P.bench) return;
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
      else { sound.hup(); spray.kick(P.pos.x, P.pos.y, P.pos.z, surfaceAt(P.pos.x, P.pos.z, P.on), 0.5); }
      P.grounded = false; P.airTime = 0;
    } else if (P.swimming) { P.vel.y = 6; P.swimming = false; P.airTime = 0; spray.splash(P.pos.x, 0, P.pos.z, 0.5); }
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
      const k = Math.min(1.6, 0.4 - P.vel.y * 0.08);
      splash(P.pos.x, P.pos.z, k);
      spray.splash(P.pos.x, 0, P.pos.z, k);
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
      if (!P.grounded && P.vel.y < -4.5) {
        const surf = surfaceAt(P.pos.x, P.pos.z, g.on), k = Math.min(1.5, (-P.vel.y - 3) / 8);
        P.dip = calm ? 0 : Math.min(0.35, -P.vel.y * 0.022);
        sound.land(surf, k);
        spray.kick(P.pos.x, g.y, P.pos.z, surf, k);
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
// Back to the nearest footpath, from wherever you've got to
function nearestPath(x, z) {
  let best = null, bd = Infinity;
  for (const p of PATHS) for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1], [bx, bz] = p[i], ex = bx - ax, ez = bz - az;
    const k = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    const px = ax + ex * k, pz = az + ez * k, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; best = [px, pz, Math.atan2(-ex, -ez)]; }
  }
  return best;
}
const unstick = () => {
  if (!free()) return;
  const [x, z, yaw] = nearestPath(P.pos.x, P.pos.z);
  teleport(x, groundAt(x, z).y, z, yaw, () => toast("Back on the path"));
};
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
        spray.splash(b.x + Math.cos(b.heading) * s * 2.6, 0, b.z - Math.sin(b.heading) * s * 2.6, 0.12);
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

function flyBalloon(dt) {
  const b = BAL;
  const burn = keys.has("Space") || touchJump;
  const vent = keys.has("ShiftLeft") || keys.has("ShiftRight");
  jumpQueued = false;
  b.heat += ((burn ? 1 : 0) - b.heat) * Math.min(1, dt * 0.8);
  const ground = Math.max(groundAt(b.x, b.z, b.y + 0.5).y, 0.15);
  b.vy += ((b.heat - 0.4) * 3.4 - (vent ? 1.6 : 0)) * dt;
  b.vy *= Math.exp(-dt * 0.7);
  b.vy = Math.max(-4.5, Math.min(5, b.vy));
  b.y += b.vy * dt;
  if (b.y > 340) { b.y = 340; b.vy = Math.min(0, b.vy); }
  if (b.y <= ground) {
    if (b.vy < -2) sound.step("wood");
    b.y = ground;
    b.vy = Math.max(0, b.vy);
  }
  // the breeze takes her, more the higher she is, and the keys lean on it
  const aloft = smooth(1.5, 30, b.y - ground);
  const [ix, iz] = input();
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const wx = (U.uWind.value.x * 2.2 + (fx * iz + rx * ix) * 3) * aloft, wz = (U.uWind.value.y * 2.2 + (fz * iz + rz * ix) * 3) * aloft;
  b.vx += (wx - b.vx) * Math.min(1, dt * 0.5);
  b.vz += (wz - b.vz) * Math.min(1, dt * 0.5);
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  const fromMid = Math.hypot(b.x + 40, b.z + 40);
  if (fromMid > 1150) {
    const k = (fromMid - 1150) / fromMid;
    b.x -= (b.x + 40) * k; b.z -= (b.z + 40) * k;
    toast("The painting ends a little further out.");
  }
  b.y = Math.max(b.y, groundAt(b.x, b.z, b.y + 0.5).y);
  P.pos.set(b.x, b.y + 0.05, b.z);
  P.vel.set(b.vx, b.vy, b.vz);
  sound.burner(burn);
}
const boardBalloon = () => teleport(BAL.x, BAL.y + 0.05, BAL.z, P.yaw, () => {
  P.balloon = true;
  toast("Hold Space for the burner, Shift to let air out, W A S D to drift. E to step out once you're down.", 6500);
});
const leaveBalloon = () => {
  const b = BAL;
  const ground = groundAt(b.x, b.z, b.y + 0.5).y;
  if (b.y - Math.max(ground, 0.15) > 1.2) { toast("Let the burner rest and she'll come down. Step out once you've landed."); return; }
  P.balloon = false;
  sound.burner(false);
  const x = b.x - Math.sin(P.yaw) * 2.2, z = b.z - Math.cos(P.yaw) * 2.2;
  P.pos.set(x, Math.max(groundAt(x, z).y, WATER_FEET), z);
  P.vel.set(0, 0, 0);
  P.grounded = true;
};

function placeCamera(dt, t) {
  const speed = Math.hypot(P.vel.x, P.vel.z);
  let eye = P.swimming ? WATER_FEET + 1.6 + Math.sin(t * 1.7) * (calm ? 0.02 : 0.07) : P.pos.y + 1.62;
  if (P.boat) eye = 0.35 + 0.95 + Math.sin(t * 1.1 + 1.3) * (calm ? 0.015 : 0.06);
  if (P.swing) eye = P.pos.y + 1.0;
  if (P.balloon) eye = P.pos.y + 1.55;
  if (P.bench) eye = P.pos.y + 0.84 + (calm ? 0 : Math.sin(t * 0.9) * 0.008);
  if (P.scope) {
    const tp = places.telescope;
    camera.position.set(tp.x, tp.y + 1.45, tp.z);
  } else {
    if ((P.grounded || P.swimming) && speed > 0.5 && !P.boat && !P.balloon && !P.bench) {
      P.stride += speed * dt;
      if (!calm) eye += Math.sin(P.stride * 2.1) * 0.045 * Math.min(1, speed / 5);
      const stepLen = P.swimming ? 2.4 : speed > 7 ? 2.2 : 1.5;
      if (P.stride - P.lastStep > stepLen) {
        P.lastStep = P.stride;
        const s = P.swimming ? "water" : surfaceAt(P.pos.x, P.pos.z, P.on);
        sound.step(s);
        if (s === "water") ripples.add(P.pos.x, P.pos.z, 0.7, 0.35, 1.4);
        // running on the beach throws the sand up behind you
        else if (s === "sand" && speed > 7) spray.kick(P.pos.x, P.pos.y, P.pos.z, "sand", 0.3);
      }
    }
    P.dip *= Math.exp(-dt * 7);
    eye -= P.dip;
    camera.position.set(P.pos.x, eye, P.pos.z);
  }
  const roll = P.boat && !calm ? Math.sin(t * 0.9 + 1.3) * 0.025 : 0;
  camera.rotation.set(P.pitch, P.yaw, roll);
  // A tall screen gets a taller view, so it doesn't feel like a keyhole
  P.fovKick *= Math.exp(-dt * 2.5);
  const lively = calm ? 0 : 1;
  const want = P.scope ? 13 : baseFov() + lively * ((speed > 7 && P.grounded ? 5 : 0) + (P.gliding ? 7 : 0) + (P.swing ? Math.abs(swing.om) * 3 : 0) + P.fovKick) - (P.bench ? 4 : 0);
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
    const x = MAP.cx - MAP.half + (i + 0.5) / N * 2 * MAP.half, z = MAP.cz - MAP.half + (j + 0.5) / N * 2 * MAP.half;
    // a hollow inland is ground, however low
    H[j * N + i] = seaAt(x, z) ? heightAt(x, z) : Math.max(heightAt(x, z), 0.5);
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
  label("the lookout, swing & bench", -20, -290, 14, 6);
  label("the quarry", 96, -322, 14, 6);
  label("the islet", ISLANDS[0][0], ISLANDS[0][1], -30, 44);
  label("the windmill", places.windmill[0], places.windmill[2], 14, 30);
  label("the chapel", places.chapel[0], places.chapel[2], 14, 6);
  label("a boat", rowboat.x, rowboat.z, -22, 30);
  g.font = "italic 40px Newsreader, Georgia, serif";
  g.fillStyle = "rgba(30, 60, 110, 0.55)";
  label("the cove", -30, -40, -60, 10);
  g.font = "500 15px 'IBM Plex Mono', monospace";
  g.fillStyle = "#5c5b57";
  g.fillText(touch ? "THE BAY · MAP TO CLOSE" : "THE BAY · TAB TO CLOSE", 26, 40);
  // the key
  const ky = 852;
  g.fillStyle = "rgba(244, 240, 228, 0.85)";
  g.fillRect(22, ky - 28, 470, 40);
  g.lineWidth = 2;
  g.strokeStyle = "#7a4a1f";
  for (const [x, lit] of [[40, true], [150, false]]) {
    g.beginPath(); g.arc(x, ky - 8, 7, 0, Math.PI * 2);
    g.fillStyle = lit ? "#f2a93b" : "rgba(244, 240, 228, 0.9)"; g.fill(); g.stroke();
  }
  g.fillStyle = "#c8372d";
  g.beginPath(); g.moveTo(290, ky - 18); g.lineTo(297, ky + 2); g.lineTo(290, ky - 3); g.lineTo(283, ky + 2); g.closePath(); g.fill();
  g.fillStyle = "#5c5b57";
  g.fillText("LIT", 54, ky - 3);
  g.fillText("STILL DARK", 164, ky - 3);
  g.fillText("YOU", 306, ky - 3);
  g.fillText("- - PATHS", 374, ky - 3);
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
  {
    // where the balloon is now
    const [bu, bv] = toMap(BAL.x, BAL.z);
    mapPen.beginPath();
    mapPen.ellipse(bu, bv - 9, 8, 10, 0, 0, Math.PI * 2);
    mapPen.fillStyle = "#d0663f";
    mapPen.fill();
    mapPen.fillStyle = "#7a4a1f";
    mapPen.fillRect(bu - 3, bv + 2, 6, 5);
    mapPen.font = "italic 20px Newsreader, Georgia, serif";
    mapPen.fillStyle = "#3b3226";
    mapPen.fillText("the balloon", bu + 14, bv);
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

// ------------------------------------------------------------------ postcards
// P turns the view into a postcard: the picture with a paper border, a
// stamp cut from the picture itself, a postmark, and a line written on it.
const pcEl = $("postcard"), pcImg = $("postcard-img"), pcSave = $("postcard-save");
let postcardOpen = false, shotWanted = false, pcUrl = null;
const PAPER = "#f4f0e4";
function makePostcard() {
  const W = 1800, H = 1200, B = 56;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const g = out.getContext("2d");
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  // the view, cut to the card's shape
  const sw = canvas.width, sh = canvas.height;
  let cw = sw, ch = sw / 1.5;
  if (ch > sh) { ch = sh; cw = sh * 1.5; }
  const ix = B, iy = B, iw = W - 2 * B, ih = H - 2 * B;
  g.drawImage(canvas, (sw - cw) / 2, (sh - ch) / 2, cw, ch, ix, iy, iw, ih);
  g.strokeStyle = "rgba(60, 50, 40, 0.22)";
  g.lineWidth = 2;
  g.strokeRect(ix - 12, iy - 12, iw + 24, ih + 24);
  // the stamp: a corner of the same view, with a perforated edge
  const stamp = document.createElement("canvas");
  const SW = 190, SH = 230, S2 = 14;
  stamp.width = SW; stamp.height = SH;
  const s = stamp.getContext("2d");
  s.fillStyle = "#fbf8f0";
  s.fillRect(0, 0, SW, SH);
  s.drawImage(canvas, sw * 0.5 - cw * 0.1, sh * 0.62 - cw * 0.12, cw * 0.2, cw * 0.24, S2, S2, SW - 2 * S2, SH - 2 * S2 - 34);
  s.fillStyle = "#3b3226";
  s.font = "italic 600 26px Newsreader, Georgia, serif";
  s.fillText("The Bay", S2 + 4, SH - S2 - 8);
  s.font = "500 20px 'IBM Plex Mono', monospace";
  s.textAlign = "right";
  s.fillText("₹5", SW - S2 - 2, SH - S2 - 10);
  s.globalCompositeOperation = "destination-out";
  for (let x = 0; x <= SW; x += 15) for (const y of [0, SH]) { s.beginPath(); s.arc(x, y, 5, 0, Math.PI * 2); s.fill(); }
  for (let y = 0; y <= SH; y += 15) for (const x of [0, SW]) { s.beginPath(); s.arc(x, y, 5, 0, Math.PI * 2); s.fill(); }
  const stx = ix + iw - SW - 36, sty = iy + 34;
  g.save();
  g.shadowColor = "rgba(0, 0, 0, 0.25)";
  g.shadowBlur = 12;
  g.shadowOffsetY = 3;
  g.translate(stx + SW / 2, sty + SH / 2);
  g.rotate(0.03);
  g.drawImage(stamp, -SW / 2, -SH / 2);
  g.restore();
  // the postmark, half over the stamp
  const now = new Date(Date.now() + skew * 6e4 + IST);
  const [hh, mm] = hoursAt(Date.now() + skew * 6e4);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const px = stx - 6, py = sty + SH - 40;
  g.save();
  g.strokeStyle = "rgba(40, 36, 60, 0.62)";
  g.fillStyle = "rgba(40, 36, 60, 0.62)";
  g.lineWidth = 4;
  g.beginPath(); g.arc(px, py, 74, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.beginPath(); g.arc(px, py, 58, 0, Math.PI * 2); g.stroke();
  g.font = "600 21px 'IBM Plex Mono', monospace";
  g.textAlign = "center";
  g.fillText(`${now.getUTCDate()} ${months[now.getUTCMonth()]}`, px, py - 4);
  g.fillText(`${two(hh)}:${two(mm)}`, px, py + 22);
  g.lineWidth = 4;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    for (let x = 0; x <= 230; x += 6) g.lineTo(px + 80 + x, py - 42 + k * 26 + Math.sin(x * 0.09) * 7);
    g.stroke();
  }
  g.restore();
  // the line written on it
  g.save();
  g.shadowColor = "rgba(10, 14, 30, 0.55)";
  g.shadowBlur = 18;
  g.fillStyle = "#fffaf0";
  g.font = "italic 500 92px Newsreader, Georgia, serif";
  g.fillText("Greetings from the Bay", ix + 46, iy + ih - 92);
  g.font = "500 26px 'IBM Plex Mono', monospace";
  g.fillText(describe(Date.now() + skew * 6e4).replace(" there", "").toUpperCase() + " IN SURAT · PRIT PRAJAPATI", ix + 52, iy + ih - 46);
  g.restore();
  out.toBlob((blob) => {
    if (pcUrl) URL.revokeObjectURL(pcUrl);
    pcUrl = URL.createObjectURL(blob);
    pcImg.src = pcUrl;
    pcSave.href = pcUrl;
    pcSave.download = `the-bay-${two(hh)}${two(mm)}.jpg`;
  }, "image/jpeg", 0.92);
}
const openPostcard = () => {
  shotWanted = true;
};
const closePostcard = () => {
  if (!postcardOpen) return;
  postcardOpen = false;
  pcEl.hidden = true;
  hud.hidden = false;
  if (!touch && !dragLook) canvas.requestPointerLock?.()?.catch?.(() => {});
};
$("postcard-close").addEventListener("click", closePostcard);

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
  l.kick = 1;
  litKeys.add(l.p.key);
  saveLit();
  const at = lanternWorld(l);
  spray.embers(at.x, at.y, at.z, 30);
  if (!calm) P.fovKick = -4;
  sound.flame();
  sound.chime(l.i);
  setTimeout(() => sound.chime(l.i + 2), 260);
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
  setTimeout(() => fireworks.show(SHOW.x, SHOW.z, 30, 0.9), 9000);
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

const free = () => !P.boat && !P.swing && !P.scope && !P.balloon && !P.bench;

// The bench at the lookout: sit, and the day goes by faster while you do.
const sitOnBench = () => {
  const b = places.bench;
  P.bench = true;
  P.pos.set(b.x, b.y, b.z);
  P.vel.set(0, 0, 0);
  P.yaw = b.yaw;
  P.pitch = 0.02;
  glide = null;
  toast("You sit, and the day slips by. E to get up.", 5000);
};
const leaveBench = () => {
  const b = places.bench;
  P.bench = false;
  const x = b.x - Math.sin(b.yaw) * 1.1, z = b.z - Math.cos(b.yaw) * 1.1;
  P.pos.set(x, groundAt(x, z).y, z);
  P.grounded = true;
  skew = wrap(skew);
  toast("N brings the sky back to now");
};

// A coin for the fountain
const WISHES = ["Plink. A wish, for whoever finds the bay next.", "It settles on the others, a little gold among the green.", "Heads. That's a good sign, the café owner would say.",
  "Down it goes. Wishes made here are said to come true slowly.", "It spins once and is gone. Someone else's coin glints back."];
let wishes = 0, coin = null;
const coinMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.008, 12), toonish("#e3b34a", { defines: { RIM: "0.6", WRAP: "0.1" } }));
coinMesh.visible = false;
scene.add(coinMesh);
const tossCoin = () => {
  if (coin) return;
  const [fx, fy, fz] = places.fountain;
  const ang = Math.random() * Math.PI * 2, d = 0.8 + Math.random() * 1.2;
  camera.getWorldDirection(fwd);
  coin = { t: 0, from: camera.position.clone().addScaledVector(fwd, 0.4).add(new THREE.Vector3(0, -0.2, 0)), to: new THREE.Vector3(fx + Math.cos(ang) * d, fy - 1.85, fz + Math.sin(ang) * d) };
  coinMesh.visible = true;
  sound.coin(camera.position.distanceTo(coin.to));
};

// The white chapel's bell, smaller and higher than the church's
let chapelStrikes = [];
const ringChapel = () => {
  const [x, , z] = places.chapelBell;
  chapelStrikes = [0, 0.62, 1.24, 2.1].map((at, i) => ({ at: performance.now() / 1000 + at, v: [1, 0.8, 0.9, 0.55][i] }));
  gulls.startle();
  toast(["A thin, bright note over the terraces.", "Ding, ding. The lavender doesn't mind."][Math.floor(Math.random() * 2)]);
  return [x, z];
};

// A message in a bottle, washed up at the far end of the beach. Every one
// says something different about the bay.
const NOTES = [
  "Whoever finds this: the bench at the lookout is the best seat in the bay. Sit a while and let the day go by.",
  "The fountain in the square takes coins. Nobody knows who keeps them.",
  "A flat stone thrown hard at the church bell will ring it.",
  "There's a bell at the white chapel too, smaller and higher, over the lavender.",
  "Jump, and hold Space as you fall: the parasol will carry you down.",
  "The dolphins come past most evenings, out beyond the pier.",
  "Press T and watch a whole day go round in under half a minute.",
  "The gulls on the pier posts don't like company. Walk up slowly anyway.",
];
let notesRead = Number(stored("world-notes", "0")) || 0;
const bottle = (() => {
  let spot = null;
  for (let x = 74; x <= 104 && !spot; x += 1.5) for (let z = -124; z <= -96 && !spot; z += 1.5) {
    const h = heightAt(x, z);
    if (h > 0.3 && h < 0.55 && field(x, z).beach > 0.7) spot = [x, h, z];
  }
  const [x, y, z] = spot || [88, 0.5, -110];
  const g = new THREE.Group();
  const glass = toonish("#5f9c78", { defines: { RIM: "0.9", WRAP: "0.2" } });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.26, 10), glass);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.12, 10), glass);
  neck.position.y = 0.19;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.05, 8), toonish("#b38a5a"));
  cork.position.y = 0.27;
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 8), toonish("#efe6cf"));
  g.add(body, neck, cork, paper);
  g.traverse((o) => { o.castShadow = true; });
  g.position.set(x, y + 0.06, z);
  g.rotation.set(Math.PI / 2 - 0.15, 0.6, 0.1, "YXZ");
  scene.add(g);
  const glint = sprite(new THREE.Color(1.6, 1.7, 1.5), 0.6);
  glint.position.set(x, y + 0.2, z);
  scene.add(glint);
  return { g, glint, x, y, z, taken: false };
})();
const readBottle = () => {
  bottle.taken = true;
  bottle.g.visible = bottle.glint.visible = false;
  const note = NOTES[notesRead % NOTES.length];
  notesRead++;
  store("world-notes", String(notesRead));
  sound.clack(0);
  showCard("a message in a bottle", "Found on the beach", note, `${notesRead} of ${NOTES.length} read · another will wash up`, null, 14000);
  // the tide brings another
  setTimeout(() => { bottle.taken = false; bottle.g.visible = bottle.glint.visible = true; }, 90000);
};
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
  actions.push({ at: () => new THREE.Vector3(BAL.x, BAL.y + 1.1, BAL.z), r: 3.6, when: free, label: "climb into the balloon", act: boardBalloon });
  actions.push({ at: () => new THREE.Vector3(...places.fireworks), r: 2.6, when: () => free() && !fireworks.busy, label: "set off the fireworks",
    act: () => {
      fireworks.show(SHOW.x, SHOW.z, 16, 0.85);
      sound.flame();
      toast(L.night > 0.5 ? "Look up, over the cove" : "They'd show better after dark, but here they go", 3500);
    } });
  const bn = places.bench;
  actions.push({ at: () => new THREE.Vector3(bn.x, bn.y + 0.4, bn.z), r: 2.4, when: free, label: "sit on the bench and watch the day go by", act: sitOnBench });
  const [fx, fy, fz] = places.fountain;
  actions.push({ at: () => new THREE.Vector3(fx, fy - 1.6, fz), r: 3.6, when: () => free() && !coin, label: "toss a coin in the fountain",
    act: () => { tossCoin(); toast(WISHES[wishes++ % WISHES.length], 3800); } });
  const cb = places.chapelBell;
  actions.push({ at: () => new THREE.Vector3(cb[0], cb[1], cb[2]), r: 6.5, when: () => free() && !chapelStrikes.length, label: "ring the chapel bell", act: ringChapel });
  actions.push({ at: () => new THREE.Vector3(bottle.x, bottle.y + 0.2, bottle.z), r: 2.6, when: () => free() && !bottle.taken, label: "open the bottle", act: readBottle });
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
  else if (P.balloon) hint = BAL.y - Math.max(groundAt(BAL.x, BAL.z, BAL.y + 0.5).y, 0.15) < 1.2 ? "step out of the basket" : null;
  else if (P.bench) hint = "get up";
  if (hint || P.boat || P.swing || P.scope || P.balloon || P.bench) {
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
  if (P.balloon) { leaveBalloon(); return; }
  if (P.bench) { leaveBench(); return; }
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
  skip: (x, z, n) => { ripples.add(x, z, 0.5, 0.5, 1.5); spray.splash(x, 0, z, 0.18); sound.plip(n); },
  sink: (x, z, n) => { splash(x, z, 0.5); spray.splash(x, 0, z, 0.35); sound.splash(0.35, ...placeSound(x, z)); skipped(n); },
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
  splash: (x, z, s) => { splash(x, z, s); spray.splash(x, 0, z, s * 0.6); },
  bounce: (p, v) => sound.boing(camera.position.distanceTo(p) * (2 - Math.min(1, v / 6))),
};
const fishEvents = { splash: (x, z, s) => { splash(x, z, s); spray.splash(x, 0, z, s * 0.5); sound.splash(0.25, ...placeSound(x, z)); } };
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
  touchJump = false;
  goBtn.textContent = "Keep walking";
  intro.classList.remove("out");
  canvas.style.cursor = "";
  setMap(false);
  $("unstick").hidden = !started;
  // so Enter (or Space) carries straight on
  goBtn.focus({ preventScroll: true });
};
document.addEventListener("pointerlockchange", () => {
  if (locked()) { dragLook = false; begin(); } else if (!dragLook && !postcardOpen) pause();
});
goBtn.addEventListener("click", enter);
$("unstick").addEventListener("click", () => { enter(); unstick(); });

// Settings, kept between visits
const setSound = $("set-sound"), setCalm = $("set-calm"), setDetail = $("set-detail");
let detail = stored("world-detail", "auto");
const showSettings = () => {
  setSound.setAttribute("aria-pressed", String(!sound.muted));
  setSound.textContent = sound.muted ? "Sound off" : "Sound on";
  setCalm.setAttribute("aria-pressed", String(calm));
  setDetail.value = detail;
};
setSound.addEventListener("click", () => { sound.start(); sound.toggle(); showSettings(); });
setCalm.addEventListener("click", () => { calm = !calm; store("world-calm", calm ? "1" : "0"); showSettings(); });
setDetail.addEventListener("change", () => {
  detail = setDetail.value;
  store("world-detail", detail);
  setQuality(detail === "auto" ? (touch ? 1 : 3) : Number(detail));
});
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
  if (postcardOpen) {
    if (e.code === "KeyP" || e.code === "Escape") { e.preventDefault(); closePostcard(); }
    return;
  }
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
  else if (e.code === "KeyM") { toast(sound.toggle() ? "Sound off" : "Sound on"); showSettings(); }
  else if (e.code === "KeyR") unstick();
  else if (e.key === "?" || e.code === "F1") { e.preventDefault(); hintsEl.classList.remove("off"); hintsT = 12; }
  else if (e.code === "KeyH") document.documentElement.classList.toggle("is-bare");
  else if (e.code === "KeyP") openPostcard();
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
  $("t-card").addEventListener("click", openPostcard);
  $("t-menu").addEventListener("click", pause);
  promptEl.addEventListener("click", act);
}

const onResize = () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = aspect();
  camera.updateProjectionMatrix();
  post.resize();
};
window.addEventListener("resize", onResize);

// ------------------------------------------------------------------ the frame
const clockEl = $("clock");
const hintsEl = $("hints");
let hintsT = 25;
let L = lightOf(Date.now());
let t = 0, last = performance.now(), hudTick = 0, slow = 0, fast = 0;
let quality = 3; // 3 best … 0 lightest
let devShot = null;
let lastHour = null, lastTime = 0, ambientT = 8;
const ambient = new THREE.Color(), tmpCol = new THREE.Color(), fieldHere = {};
const mothLamps = [...world.lamps];
const tmp = new THREE.Vector3(), center = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3(), sunWorld = new THREE.Vector3();
const skyTint = new THREE.Color();
const setQuality = (q) => {
  quality = Math.max(0, Math.min(3, q));
  // a smaller shadow map on the lighter settings
  const size = [1024, 2048, 2048, SHADOW_MAP][quality];
  if (sunLight.shadow.mapSize.x !== size) {
    sunLight.shadow.mapSize.set(size, size);
    sunLight.shadow.map?.dispose();
    sunLight.shadow.map = null;
  }
  grass.density = [0.45, 0.65, 0.85, 1][quality];
  clutter.density = [0.35, 0.6, 0.85, 1][quality];
  post.scale = [0.62, 0.75, 0.88, 1][quality];
  flora.reach = [0.45, 0.6, 0.8, 1][quality];
  U.uLodScale.value = [0.55, 0.7, 0.85, 1][quality];
};
setQuality(detail === "auto" ? (touch ? 1 : 3) : Number(detail));
showSettings();

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
  // early mornings lay a mist on the water; evenings are clearer
  const mist = L.gold * (L.rising ? 1 : 0.3) + night * 0.12;
  U.uFogDensity.value = 0.00013 * (1 + 0.5 * L.gold + 1.3 * mist);
  U.uFogFalloff.value = 0.0032 * (1 + 0.9 * mist);
  U.uPlayer.value.copy(P.pos);
  U.uGust.value = 0.75 + 0.35 * Math.sin(t * 0.13) * Math.sin(t * 0.071 + 1);
  // sitting on the bench, the day goes by: ten minutes a second
  if (P.bench) skew += dt * 10;
  sunLight.color.copy(palette.light);
  sunLight.intensity = L.strength * 1.08;
  hemi.color.copy(palette.hemiSky);
  hemi.groundColor.copy(palette.hemiGround);
  // the blue hour is lit almost entirely by the sky
  hemi.intensity = THREE.MathUtils.lerp(0.72, 0.34, night) * (1 - 0.15 * L.gold) + 0.2 * L.blue;

  // The shadow map covers the ground ahead of you, stepped to its own
  // texels so the edges don't crawl as you walk.
  if (playing || started) {
    camera.getWorldDirection(fwd);
    center.set(P.pos.x + fwd.x * 30, P.pos.y, P.pos.z + fwd.z * 30);
  } else center.set(-60, 8, -50);
  right.crossVectors(new THREE.Vector3(0, 1, 0), L.lightDir).normalize();
  upv.crossVectors(L.lightDir, right);
  const texel = (2 * SHADOW) / sunLight.shadow.mapSize.x;
  const cr = center.dot(right), cu = center.dot(upv);
  center.addScaledVector(right, Math.round(cr / texel) * texel - cr).addScaledVector(upv, Math.round(cu / texel) * texel - cu);
  sunLight.target.position.copy(center);
  sunLight.position.copy(center).addScaledVector(L.lightDir, 420);
  sunLight.target.updateMatrixWorld();

  const su = sky.uniforms;
  su.uMoon.value.copy(L.moonDir);
  su.uPhase.value = L.phase;
  su.uMoonUp.value = L.moonUp;
  su.uMist.value = mist * 0.75;
  sky.mesh.position.copy(camera.position);
  clouds.uniforms.uLight.value.copy(L.alt > -1.5 ? L.sunDir : L.moonDir);
  clouds.uniforms.uBright.value = (1.2 + 0.25 * L.gold) * (1 - 0.3 * night);
  // the afterglow, lighting them from underneath once the sun is down
  clouds.uniforms.uAfter.value = Math.exp(-(((L.alt + 2.5) / 3.4) ** 2)) * (L.rising ? 0.6 : 0.95);
  clouds.group.rotation.y += dt * 0.0012;

  const wu = water.uniforms;
  wu.uLight.value.copy(L.alt > -1.5 ? L.sunDir : L.moonDir);
  wu.uGlint.value = L.alt > -1.5 ? L.sunUp * (0.8 + 0.6 * L.gold) : L.moonUp * (0.2 + 0.6 * L.lit);
  wu.uGlintCol.value.copy(palette.light).multiplyScalar(L.alt > -1.5 ? 1 : 0.6);
  wu.uSunK.value = smooth(-4, 18, L.alt);
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
  clutter.update(camera.position);
  flora.update(camera.position);
  gulls.update(dt, t, night);
  perchers.update(dt, t, P, night, percherEvents);
  shoals.update(dt, t, P);
  crabs.update(dt, t, P, crabEvents);
  butterflies.update(dt, t, P.pos, 1 - night, mothLamps);
  cats.update(dt, t, P);
  fish.update(dt, P.pos, fishEvents);
  stones.update(dt, stoneEvents);
  ball.update(dt, P, ballEvents);
  ripples.update(dt, night);
  // at night, swimming or rowing stirs up the glow behind you
  if (night > 0.4 && (P.swimming || P.boat) && Math.hypot(P.vel.x, P.vel.z) > 0.6 && Math.random() < dt * 9) {
    ripples.add(P.pos.x + (Math.random() - 0.5) * 1.6, P.pos.z + (Math.random() - 0.5) * 1.6, 0.35 + Math.random() * 0.3, 0.45, 1.3);
  }
  dolphins.update(dt, camera.position, P.yaw, dolphinEvents);
  fireworks.uniforms.uScale.value = scale;
  fireworks.update(dt, fireworkEvents);
  // what lights the dust and the smoke: the sky, and the sun on it
  ambient.copy(palette.hemiSky).multiplyScalar(hemi.intensity * 0.9).add(tmpCol.copy(palette.light).multiplyScalar(sunLight.intensity * 0.55));
  spray.update(dt, scale, ambient);
  smoke.uniforms.uScale.value = scale;
  smoke.uniforms.uLight.value.copy(ambient).multiplyScalar(1.1);
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
  world.windmill.sails.rotation.z -= dt * (0.35 + 0.25 * U.uGust.value);
  SHOW.raft.position.y = Math.sin(t * 1.1) * 0.06 - 0.05;
  SHOW.raft.rotation.z = Math.sin(t * 0.8) * 0.03;
  {
    // the balloon: the flame and the glow it throws up into the envelope
    const burning = P.balloon && (keys.has("Space") || touchJump);
    if (!P.balloon) BAL.heat *= Math.exp(-dt * 0.5);
    BAL.glow += ((burning ? 1 : 0) - BAL.glow) * Math.min(1, dt * 10);
    BAL.group.position.set(BAL.x, BAL.y, BAL.z);
    const up = smooth(1, 20, BAL.y - Math.max(heightAt(BAL.x, BAL.z), 0));
    BAL.group.rotation.set(Math.sin(t * 0.43) * 0.02 * up, 0, Math.sin(t * 0.37 + 1) * 0.02 * up);
    BAL.flame.visible = BAL.glow > 0.02;
    BAL.flame.scale.set(1, (0.6 + 0.4 * Math.sin(t * 31) * Math.sin(t * 17)) * BAL.glow + 0.2, 1);
    BAL.uBurn.value = BAL.glow * (0.4 + 0.6 * night) + 0.08 * night * (P.balloon ? 1 : 0);
    BAL.uBase.value = BAL.y;
  }
  if (!P.swing) {
    swing.om += (-9.8 / swing.L * Math.sin(swing.th) - 0.4 * swing.om) * dt;
    swing.th += swing.om * dt;
    swing.group.rotation.x = swing.th;
  }
  // The bell swings, and keeps time
  bellT += dt;
  swingT += dt;
  bell.rotation.x = bellSwing * Math.sin(swingT * 3.2) * Math.exp(-swingT * 0.45);
  if (strikes.length && bellT >= strikes[0].at) {
    const s = strikes.shift();
    bellSound(s.v);
    if (s.swing) swingT = 0;
  }
  const [h, m] = hoursAt(time);
  // on the hour, if the hours are passing at their own pace
  if (lastHour !== null && h !== lastHour && !glide && !P.bench && Math.abs(time - lastTime) < 12e4 && started) tollHour(h % 12 || 12);
  lastHour = h;
  lastTime = time;
  // the chapel bell, rung by hand
  while (chapelStrikes.length && performance.now() / 1000 >= chapelStrikes[0].at) {
    const s = chapelStrikes.shift(), [cx, cy, cz] = places.chapelBell, [d, pan] = placeSound(cx, cz);
    sound.bell(Math.hypot(d, cy - camera.position.y), s.v * 0.75, pan, 1.9);
  }
  // a coin, on its way into the fountain
  if (coin) {
    coin.t += dt / 0.55;
    const k = Math.min(1, coin.t);
    coinMesh.position.lerpVectors(coin.from, coin.to, k);
    coinMesh.position.y += Math.sin(k * Math.PI) * 0.9;
    coinMesh.rotation.set(t * 14, 0, t * 9);
    if (k >= 1) { spray.splash(coin.to.x, coin.to.y, coin.to.z, 0.1); coinMesh.visible = false; coin = null; }
  }
  // the bottle catches the light now and then
  if (!bottle.taken) bottle.glint.material.opacity = (0.15 + 0.85 * Math.max(0, Math.sin(t * 1.9) * Math.sin(t * 0.7 + 1)) ** 6) * (1 - 0.6 * night);
  // smoke from the chimneys when the stoves are lit: breakfast, and supper
  const hf = h + m / 60;
  smoke.uniforms.uAmount.value = 0.12 + 0.88 * Math.max(Math.exp(-(((hf - 7.5) / 1.6) ** 2)), Math.exp(-(((hf - 19.5) / 2.2) ** 2)));
  // the bay's own show, at nine every evening
  if (h === 21 && m < 2 && showNight !== new Date(time + IST).getUTCDate() && started) {
    showNight = new Date(time + IST).getUTCDate();
    fireworks.show(SHOW.x, SHOW.z, 22, 1.1);
  }
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
    l.kick *= Math.exp(-dt * 1.4);
    l.hang.rotation.z = Math.sin(t * 1.3 + l.i) * 0.06 + Math.sin(l.lightT * 5.5) * 0.3 * l.kick;
    l.hang.rotation.x = Math.sin(t * 1.1 + l.i * 2) * 0.05;
    const on = l.lit ? smooth(0, 0.8, l.lightT) : 0;
    const flick = 0.85 + 0.15 * Math.sin(t * 9 + l.i * 3) * Math.sin(t * 5.3 + l.i);
    // a dark one breathes a little, pale in the moonlight, so it can be found
    const breathe = 0.5 + 0.5 * Math.sin(t * 1.6 + l.i * 1.7);
    if (on) l.mat.emissive.setRGB(1.6, 0.85, 0.3).multiplyScalar(on * (0.7 + 1.1 * night) * flick);
    else l.mat.emissive.setRGB(0.16, 0.18, 0.24).multiplyScalar(night * (0.55 + 0.45 * breathe));
    l.light.intensity = on * (0.6 + 2.5 * night) * flick + 3 * l.kick;
    l.glow.material.opacity = on ? on * (0.25 + 0.75 * night) * flick : (0.08 + 0.12 * breathe) * (0.3 + 0.7 * night);
    l.glow.material.color.setRGB(...(on ? [3, 1.8, 0.8] : [1.6, 1.8, 2.4]));
    // the halo shrinks as you come close, so a lantern at arm's length doesn't fill the view
    const near = Math.min(1, Math.max(0.35, camera.position.distanceTo(l.group.position) / 9));
    l.glow.scale.setScalar((on ? 2.2 + 1.8 * night : 1.5) * (1 + 0.6 * l.kick) * near);
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
    const here = field(P.pos.x, P.pos.z, fieldHere);
    const [fd, fpan] = placeSound(places.fountain[0], places.fountain[2]);
    sound.update(t, {
      shore: P.boat ? 0.7 : wet > 0 && wet < 8 ? 1 : wet === 8 ? 0.45 : 0.15,
      high, wind: P.gliding ? 1 : P.swing ? Math.min(1, Math.abs(swing.om) * 0.5) : P.balloon ? 0.25 * high : smooth(4, 12, Math.hypot(P.vel.x, P.vel.z)) * 0.3,
      day: 1 - night, night, trees: here.village > 0.1 || P.pos.y > 20 ? 1 : 0.4,
      gust: U.uGust.value, fountain: 1 - smooth(3, 26, fd), fountainPan: fpan,
      lap: here.beach * (1 - smooth(1.5, 7, Math.max(0, here.h))) * (wet > 0 && wet < 8 ? 1 : 0),
    });
    // now and then a gull calls from overhead, or by night an owl from the trees
    ambientT -= dt;
    if (ambientT <= 0) {
      ambientT = 5 + Math.random() * 10;
      if (night < 0.55) {
        const g = gulls.nearest(P.pos.x, P.pos.z);
        if (g) { const [d, pan] = placeSound(g.p.x, g.p.z); sound.gull(Math.hypot(d, g.p.y - camera.position.y), pan); }
      } else if (night > 0.8 && Math.random() < 0.45) sound.owl(25 + Math.random() * 40, Math.random() * 2 - 1);
    }
  }

  // The HUD, a few times a second
  hudTick -= dt;
  if (hudTick <= 0 && playing) {
    hudTick = 0.25;
    // the lamps the moths go to: street lamps, and the lanterns already lit
    mothLamps.length = world.lamps.length;
    for (const l of lanterns) if (l.lit && !l.rise) mothLamps.push(lanternWorld(l).toArray());
    const said = `${two(h)}:${two(m)} in Surat · sun ${L.alt < 0 ? "−" : ""}${Math.abs(Math.round(L.alt))}°`;
    clockEl.textContent = night > 0.4 ? `${said} · ${PHASES[Math.round(L.phase * 8) % 8]}` : said;
  }
  if (playing) drawCompass();
  if (playing && hintsT > 0) { hintsT -= dt; if (hintsT <= 0) hintsEl.classList.add("off"); }
  if (mapOpen) drawMap();

  // Draw: what the water mirrors, then the bay, then the finish
  const pf = post.final.uniforms;
  pf.uExposure.value = 0.92 + night * 0.72;
  pf.uBloom.value = 0.42 + 0.5 * night;
  // the grade: shade cooler and light warmer at the ends of the day, colour
  // a little richer in the golden hour, a little quieter by night
  pf.uSat.value = 1.05 + 0.08 * L.gold * (1 - night) - 0.08 * night;
  pf.uShadowTint.value.setRGB(0.95 + 0.02 * L.gold - 0.03 * night, 0.98 - 0.03 * L.gold * (1 - night), 1.06 + 0.04 * night + 0.02 * L.blue);
  pf.uLightTint.value.setRGB(1.03 + 0.04 * L.gold * (1 - night), 1.0, 0.96 - 0.05 * L.gold * (1 - night) + 0.02 * L.blue);
  pf.uVignette.value = P.scope ? 1.6 : 0.32;
  post.rays = 0.32 * L.sunUp * (1 + 1.2 * L.gold) * (1 - night);
  sunWorld.copy(camera.position).addScaledVector(L.sunDir, 1000);
  if (quality > 0 || !touch) water.reflect(renderer, scene, camera, Math.max(1, Math.round(post.width * (quality > 1 ? 0.5 : 0.35))), Math.max(1, Math.round(post.height * (quality > 1 ? 0.5 : 0.35))));
  renderer.shadowMap.needsUpdate = true;
  post.render(scene, camera, sunWorld);
  if (devShot) { const cb = devShot; devShot = null; cb(canvas.toDataURL("image/jpeg", 0.88)); }
  if (shotWanted) {
    // read the picture now, while it's still in the canvas, then a flash
    shotWanted = false;
    makePostcard();
    postcardOpen = true;
    pcEl.hidden = false;
    hud.hidden = true;
    keys.clear();
    sound.clack(0);
    const f = post.final.uniforms.uFade;
    f.value = 0.85;
    const back = () => { f.value = Math.max(0, f.value - 0.06); if (f.value > 0) requestAnimationFrame(back); };
    requestAnimationFrame(back);
    if (locked()) document.exitPointerLock();
  }

  // Keep the frame rate: draw less when it struggles, more when it doesn't
  if (dt > 1 / 38) slow += dt; else slow = Math.max(0, slow - dt * 0.5);
  if (dt < 1 / 57) fast += dt; else fast = 0;
  if (detail === "auto") {
    if (slow > 1.5 && quality > 0) { setQuality(quality - 1); slow = 0; }
    if (fast > 8 && quality < 3) { setQuality(quality + 1); fast = 0; }
  }
}
renderer.setAnimationLoop(frame);

goBtn.disabled = false;
goBtn.textContent = "Walk in";
window.__bayReady = true;

// For looking around while working on the bay: ?dev puts a handle on window.
if (new URLSearchParams(location.search).has("dev")) {
  window.bay = {
    P, camera, places, lanterns, post, actions, rowboat, swing, cats, world, U, renderer, scene, water, fireworks, dolphins, SHOW, BAL,
    postcard: openPostcard,
    hour(m) { glide = null; skew = m; },
    at(h) { glide = null; const nowMin = ((Date.now() / 6e4) + 330) % 1440; skew = h * 60 - nowMin; },
    look(x, y, z, yaw, pitch = -0.1) { P.pos.set(x, y ?? groundAt(x, z).y, z); P.yaw = yaw; P.pitch = pitch; P.vel.set(0, 0, 0); P.grounded = true; P.swimming = false; },
    play() { started = true; begin(); },
    quality: (q) => setQuality(q),
    act, keys, map: () => setMap(!mapOpen),
    // the next frame, as a JPEG data URL
    shot: () => new Promise((res) => { devShot = res; }),
    // draw n frames now, whether or not the page is being shown; returns the
    // average milliseconds each took, GPU included
    step(n = 1) {
      const gl = renderer.getContext(), px = new Uint8Array(4);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        frame(Math.max(performance.now(), last + 1));
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      return (performance.now() - t0) / n;
    },
  };
}
