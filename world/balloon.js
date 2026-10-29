import * as THREE from "three";
import { stylize } from "./style.js";
import { Kit, builtMaterial } from "./build.js";

// A hot-air balloon in painted stripes, a wicker basket under it and a
// burner that roars and lights the envelope from inside. The origin is the
// floor of the basket.

const GORES = 24;
const STRIPES = ["#f3ead6", "#d0663f", "#f3ead6", "#2f7f9a", "#f3ead6", "#e3b043"];

export function createBalloon() {
  const group = new THREE.Group();

  // The envelope: a lathe, each gore its own colour, a band round the middle
  const prof = [[0.9, 0], [1.6, 1.2], [3.2, 3.6], [5.4, 7], [6.9, 10.4], [7.5, 13], [7.3, 15.4], [6.2, 17.6], [4.2, 19.2], [2, 20], [0.001, 20.3]]
    .map(([a, b]) => new THREE.Vector2(a, b));
  const lathe = new THREE.LatheGeometry(prof, GORES * 2);
  lathe.computeVertexNormals();
  const env = lathe.toNonIndexed();
  const p = env.attributes.position, cols = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const gore = Math.floor(((Math.atan2(z, x) / (Math.PI * 2) + 1) % 1) * GORES);
    c.set(STRIPES[gore % STRIPES.length]);
    if (y > 9.6 && y < 11.4) c.set(gore % 2 ? "#2f7f9a" : "#f3ead6");
    if (y > 18.6) c.set("#d0663f");
    for (let k = 0; k < 3; k++) cols.set([c.r, c.g, c.b], (i + k) * 3);
  }
  env.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  const uBurn = { value: 0 }, uBase = { value: 0 };
  const envMat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), {
    key: "balloon",
    defines: { FOLIAGE: "0.55", RIM: "0.2", WRAP: "0.3" },
    uniforms: { uBurn, uBase },
    fragmentPars: "uniform float uBurn, uBase;",
    color: "diffuseColor.rgb *= 0.92 + 0.1 * vnoise(vec2(atan(vWorldN.z, vWorldN.x) * 12., vWorldP.y * 0.5));",
    // the burner's flame lights it from inside, brightest low down
    emissive: "totalEmissiveRadiance += vColor * vec3(1.6, 0.9, 0.45) * uBurn * (0.35 + 0.65 * (1. - smoothstep(4., 18., vWorldP.y - uBase)));",
  });
  const envelope = new THREE.Mesh(env, envMat);
  envelope.position.y = 3.6;
  envelope.castShadow = true;
  envelope.receiveShadow = true;
  group.add(envelope);

  // Basket, ropes, burner
  const kit = new Kit();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const M = (x, y, z, sx, sy, sz, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(sx, sy, sz));
  const W = 1.5, H = 1.1;
  kit.put(box, "#a77b4c", M(0, -0.05, 0, W, 0.1, W), 4);
  for (const [x, z, sx, sz] of [[0, W / 2, W, 0.08], [0, -W / 2, W, 0.08], [W / 2, 0, 0.08, W], [-W / 2, 0, 0.08, W]]) {
    kit.put(box, "#b98a55", M(x, H / 2, z, sx, H, sz), 4);
    kit.put(box, "#5a3e2a", M(x, H + 0.04, z, sx + 0.1, 0.1, sz + 0.1), 0);
  }
  const rope = (a, b) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    kit.put(new THREE.CylinderGeometry(0.015, 0.015, 1, 4), "#cdb991", new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, len, 1)), 0);
  };
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const cx = Math.sign(Math.cos(a)) * W / 2 * (Math.abs(Math.cos(a)) > 0.3 ? 1 : 0), cz = Math.sign(Math.sin(a)) * W / 2 * (Math.abs(Math.sin(a)) > 0.3 ? 1 : 0);
    rope([cx * 0.95, H, cz * 0.95], [Math.cos(a) * 0.9, 3.6, Math.sin(a) * 0.9]);
  }
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) rope([x, H, z], [x * 0.5, 2.5, z * 0.5]);
  kit.put(box, "#3a3634", M(0, 2.55, 0, 0.62, 0.08, 0.62), 7);
  kit.put(new THREE.CylinderGeometry(0.2, 0.24, 0.42, 10), "#9aa0a0", M(0, 2.8, 0, 1, 1, 1), 7);
  for (const s of [-1, 1]) kit.put(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 10), "#c9372d", M(s * 0.45, 0.35, -0.45, 1, 1, 1), 7);
  const rig = new THREE.Mesh(kit.geometry(), builtMaterial({ key: "balloon-rig" }));
  rig.castShadow = true;
  rig.receiveShadow = true;
  group.add(rig);

  // The flame
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 10, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  flame.position.y = 3.5;
  flame.visible = false;
  group.add(flame);
  group.traverse((o) => o.layers.enable(1));
  return { group, envelope, flame, uBurn, uBase };
}
