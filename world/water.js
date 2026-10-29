import * as THREE from "three";
import { palette } from "./sky.js";
import { NOISE, FOG, U } from "./style.js";
import { rng } from "./land.js";

// The sea. Clear enough over the sand to see the bottom and the dark rocks,
// turquoise in the shallows, then azure and ultramarine further out, like
// the painting; it mirrors the lighthouse, the village and the sky, glints
// hard where the sun catches it, and foams where it meets the shore.

// A tileable field of little waves, as normals.
function waveNormals(size = 256) {
  const r = rng(5);
  const waves = Array.from({ length: 28 }, () => {
    const k = 1 + Math.floor(r() * 10), a = r() * Math.PI * 2;
    return { kx: Math.round(Math.cos(a) * k), kz: Math.round(Math.sin(a) * k), amp: 1 / k ** 1.15, ph: r() * 6.283 };
  }).filter((w) => w.kx || w.kz);
  const H = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size;
    let h = 0;
    for (const w of waves) h += w.amp * (1 - Math.abs(Math.sin(Math.PI * (w.kx * u + w.kz * v) + w.ph)));
    H[j * size + i] = h;
  }
  const data = new Uint8Array(size * size * 4);
  const at = (i, j) => H[((j + size) % size) * size + ((i + size) % size)];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) * 6, dz = (at(i, j + 1) - at(i, j - 1)) * 6;
    const l = Math.hypot(dx, 1, dz);
    const k = (j * size + i) * 4;
    data[k] = (-dx / l * 0.5 + 0.5) * 255;
    data[k + 1] = (-dz / l * 0.5 + 0.5) * 255;
    data[k + 2] = Math.min(255, at(i, j) * 40);
    data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export function createWater(floorTex, floorRect) {
  const reflRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const reflCam = new THREE.PerspectiveCamera();
  reflCam.layers.set(1);
  const reflMat = new THREE.Matrix4();
  const foamCanvas = document.createElement("canvas");
  foamCanvas.width = foamCanvas.height = 1024;
  const foamTex = new THREE.CanvasTexture(foamCanvas);
  foamTex.flipY = false;
  const FOAM_RECT = new THREE.Vector4(-420, -420, 840, 840);

  const uniforms = {
    tFloor: { value: floorTex }, uRect: { value: floorRect },
    tRefl: { value: reflRT.texture }, uReflMat: { value: reflMat }, uReflect: { value: 1 },
    tNormal: { value: waveNormals() }, tFoam: { value: foamTex }, uFoamRect: { value: FOAM_RECT },
    uLight: { value: new THREE.Vector3(0, 1, 0) }, uGlint: { value: 1 }, uGlintCol: { value: new THREE.Color("#fff8e6") },
    uDeep: { value: palette.waterDeep }, uMid: { value: palette.waterMid },
    uShallow: { value: palette.waterShallow }, uClear: { value: palette.waterClear },
    uFoamCol: { value: new THREE.Color("#f6f3ea") },
    uLamp: { value: new THREE.Vector3() }, uBeam: { value: 0 }, uBeamOn: { value: 0 }, uSunK: { value: 1 },
    uTime: U.uTime, uNight: U.uNight, uSunUp: U.uSunUp,
    uSunDir: U.uSunDir, uFogColor: U.uFogColor, uFogGlow: U.uFogGlow, uFogDensity: U.uFogDensity, uFogFalloff: U.uFogFalloff,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    premultipliedAlpha: true,
    vertexShader: /* glsl */ `
      uniform mat4 uReflMat;
      varying vec3 vW;
      varying vec4 vRefl;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.);
        vW = w.xyz;
        vRefl = uReflMat * w;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tFloor, tRefl, tNormal, tFoam;
      uniform vec4 uRect, uFoamRect;
      uniform vec3 uLight, uGlintCol, uDeep, uMid, uShallow, uClear, uFoamCol, uLamp;
      uniform float uTime, uGlint, uNight, uSunUp, uBeam, uBeamOn, uReflect, uSunK;
      varying vec3 vW;
      varying vec4 vRefl;
      ${NOISE}
      ${FOG}
      vec2 wave(vec2 uv) { return texture2D(tNormal, uv).xy * 2. - 1.; }
      void main() {
        vec2 xz = vW.xz;
        float dist = length(cameraPosition - vW);
        vec2 fuv = (xz - uRect.xy) / uRect.zw;
        vec4 fl = vec4(-40., 0., 0., 0.);
        if (fuv.x > 0. && fuv.y > 0. && fuv.x < 1. && fuv.y < 1.) {
          fl = texture2D(tFloor, fuv);
          // a hollow inland, below the level of the sea but not part of it
          if (fl.a < 0.5) discard;
        }
        float depth = max(-fl.r, 0.);
        float t = uTime;
        // the swell, at three sizes
        float nearK = 1. - smoothstep(25., 120., dist);
        vec2 g = wave(xz / 31. + t * vec2(0.011, 0.006)) * 0.55 + wave(xz / 11.3 + t * vec2(-0.016, 0.019)) * 0.45;
        g += wave(xz / 3.7 + t * vec2(0.035, -0.027)) * 0.3 * nearK;
        g *= mix(1., 0.4, smoothstep(40., 900., dist));
        g *= mix(0.45, 1., smoothstep(0.2, 2.5, depth));
        vec3 N = normalize(vec3(g.x * 0.2, 1., g.y * 0.2));
        vec3 V = normalize(cameraPosition - vW);
        // the colour of the water itself, by how deep it is
        float wob = vnoise(xz * 0.045 + t * 0.01) - 0.5;
        float dd = depth + wob * 1.6 * smoothstep(0., 3., depth);
        vec3 body = mix(uClear, uShallow, smoothstep(0.3, 2.6, dd));
        body = mix(body, uMid, smoothstep(3., 8.5, dd));
        body = mix(body, uDeep, smoothstep(10., 28., dd));
        body = mix(body, body * vec3(0.42, 0.6, 0.72), fl.g * smoothstep(18., 2., depth) * 0.7);
        // with the sun low, less light gets into the water to come back out
        body *= mix(0.68, 1., uSunK);
        // less of the floor shows when the light is low and slanting
        float clear = (1. - smoothstep(0.25, 6.5, depth)) * fl.a * mix(0.5, 1., uSunK);
        float aBody = mix(1., mix(0.4, 0.88, smoothstep(0.1, 5.5, depth)), clear);
        aBody = mix(aBody, 1., smoothstep(120., 380., dist));
        // what it reflects
        // far out, the swell breaks the mirror up and the haze takes it
        float farR = smoothstep(150., 2200., dist);
        vec2 ruv = vRefl.xy / vRefl.w + vec2(N.x * 0.03, N.z * 0.05) * (1. + farR * 2.5);
        // smeared up and down the way a mirror on moving water is
        float spread = 0.003 + 0.016 * smoothstep(20., 600., dist);
        vec3 refl = texture2D(tRefl, ruv).rgb * 0.36
          + (texture2D(tRefl, ruv + vec2(0., spread)).rgb + texture2D(tRefl, ruv - vec2(0., spread)).rgb) * 0.22
          + (texture2D(tRefl, ruv + vec2(spread * 0.3, spread * 2.2)).rgb + texture2D(tRefl, ruv - vec2(spread * 0.3, spread * 2.2)).rgb) * 0.1;
        refl = mix(refl, hazeColor(reflect(-V, vec3(0., 1., 0.))), farR * 0.55);
        float ndv = max(dot(N, V), 0.);
        // and the calm water of evening is more of a mirror
        float fres = clamp(0.03 + 0.1 * (1. - uSunK) + 0.62 * pow(1. - ndv, 4.), 0., 0.76) * uReflect;
        // sun (or moon) on the water: a hard core and broken sparkles
        vec3 R = reflect(-V, N);
        float sp = max(dot(R, uLight), 0.);
        float sparkle = smoothstep(0.62, 0.8, vnoise(xz * 1.6 / (1. + dist * 0.01) + vec2(t * 1.2, -t * 0.8)));
        vec3 glint = uGlintCol * (pow(sp, 600.) * 30. + pow(sp, 60.) * sparkle * 4. + pow(sp, 8.) * 0.05) * uGlint;
        // looking into a low sun the mirror whites out; keep some colour in it
        refl = min(refl, vec3(1.6));
        // foam: a thin line where the sea meets the shore, crests coming in
        // that break up as they arrive, and the lace they leave spreading out
        float fn = vnoise(xz * 2.2 + vec2(t * 0.3, -t * 0.2));
        float shore = (1. - smoothstep(0., 2.2, depth)) * fl.b;
        float edge = 0., crest = 0., foam = 0.;
        if (shore > 0.01) {
          edge = smoothstep(0.17, 0.02, depth + (fn - 0.5) * 0.12);
          float ph = depth * 5. - t * 1.3 + wob * 5.;
          crest = smoothstep(0.86, 0.97, sin(ph) * 0.5 + 0.5) * smoothstep(1.5, 0.3, depth) * smoothstep(0.32, 0.62, fn);
          float lace = 0.;
          if (dist < 90.) {
            vec4 lv = voronoi(xz * 1.15 + vec2(t * 0.05, -t * 0.04) + g * 0.5);
            lace = (1. - smoothstep(0.03, 0.11, lv.y - lv.x)) * smoothstep(0.8, 0.12, depth) * smoothstep(0.3, 0.7, fn) * (1. - smoothstep(40., 90., dist));
          }
          foam = max(edge * 0.95, max(crest * 0.62, lace * mix(0.18, 0.5, uSunK))) * shore;
        }
        vec2 fo = (xz - uFoamRect.xy) / uFoamRect.zw;
        if (fo.x > 0. && fo.y > 0. && fo.x < 1. && fo.y < 1.) {
          float ob = texture2D(tFoam, fo).r;
          float ring = sin(ob * 9. - t * 1.6) * 0.5 + 0.5;
          foam = max(foam, smoothstep(0.6, 0.85, ob + (fn - 0.5) * 0.35) * 0.85 + smoothstep(0.2, 0.5, ob) * smoothstep(0.75, 0.95, ring) * 0.4 * fn);
        }
        foam = clamp(foam, 0., 1.) * (1. - smoothstep(60., 220., dist) * 0.7);
        // deep in the night the breaking water glows blue-green, the way
        // plankton does: only where it breaks, in flecks
        float glowN = smoothstep(0.78, 0.98, uNight);
        float flick = smoothstep(0.45, 0.9, vnoise(xz * 2.3 + vec2(t * 0.9, -t * 0.7)) * 0.7 + vnoise(xz * 7.1 - t * 1.3) * 0.3);
        vec3 foamCol = uFoamCol * mix(1., 0.26, smoothstep(0., 0.85, uNight));
        vec3 bio = vec3(0.08, 0.62, 0.9) * (edge + crest * 0.6) * shore * flick * glowN * 0.85;
        // put it together, premultiplied so the reflection adds over what's under the water
        vec3 col = body * aBody * (1. - fres) + refl * fres + glint;
        float a = 1. - (1. - aBody) * (1. - fres);
        col = mix(col, foamCol, foam * 0.92) + bio;
        a = max(a, foam * 0.92);
        // the lighthouse beam, where it crosses the water
        if (uBeamOn > 0.) {
          vec2 rel = xz - uLamp.xz;
          float r = length(rel), ang = atan(rel.y, rel.x);
          float d1 = min(abs(mod(ang - uBeam + 3.14159, 6.28318) - 3.14159), abs(mod(ang - uBeam, 6.28318) - 3.14159));
          float cone = smoothstep(0.1, 0., d1) * smoothstep(260., 30., r) * smoothstep(8., 40., r);
          col += vec3(1., 0.86, 0.6) * cone * uBeamOn * 0.25;
        }
        float fa = hazeAmount(vW);
        col = col * (1. - fa) + hazeColor(V * -1.) * fa * a;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const geo = new THREE.CircleGeometry(12000, 96);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  // Foam rings round everything that stands in the water
  const setObstacles = (list) => {
    const g = foamCanvas.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, 1024, 1024);
    const k = 1024 / FOAM_RECT.z;
    for (const [x, z, rad] of list) {
      const u = (x - FOAM_RECT.x) * k, v = (z - FOAM_RECT.y) * k, rr = rad * k, out = (rad + 1.6) * k;
      const grd = g.createRadialGradient(u, v, rr * 0.7, u, v, out);
      grd.addColorStop(0, "rgba(255,255,255,0.9)");
      grd.addColorStop(0.4, "rgba(255,255,255,0.55)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.globalCompositeOperation = "lighten";
      g.fillStyle = grd;
      g.beginPath();
      g.arc(u, v, out, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
    foamTex.needsUpdate = true;
  };

  // The mirror: the scene seen from under the water, upside down
  const clipPlane = new THREE.Vector4(), plane = new THREE.Plane(), q = new THREE.Vector4();
  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), target = new THREE.Vector3();
  const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const reflect = (renderer, scene, camera, w, h) => {
    if (reflRT.width !== w || reflRT.height !== h) reflRT.setSize(w, h);
    camera.updateMatrixWorld();
    reflCam.position.set(camera.position.x, -camera.position.y, camera.position.z);
    camera.getWorldDirection(fwd);
    fwd.y = -fwd.y;
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    up.y = -up.y;
    reflCam.up.copy(up);
    reflCam.lookAt(target.copy(reflCam.position).add(fwd));
    reflCam.fov = camera.fov;
    reflCam.aspect = camera.aspect;
    reflCam.near = camera.near;
    reflCam.far = camera.far;
    reflCam.updateMatrixWorld();
    reflCam.updateProjectionMatrix();
    reflMat.copy(BIAS).multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
    // An oblique near plane at the water, so nothing under it is reflected
    plane.set(new THREE.Vector3(0, 1, 0), 0.05).applyMatrix4(reflCam.matrixWorldInverse);
    clipPlane.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = reflCam.projectionMatrix.elements;
    q.x = (Math.sign(clipPlane.x) + e[8]) / e[0];
    q.y = (Math.sign(clipPlane.y) + e[9]) / e[5];
    q.z = -1;
    q.w = (1 + e[10]) / e[14];
    clipPlane.multiplyScalar(2 / clipPlane.dot(q));
    e[2] = clipPlane.x; e[6] = clipPlane.y; e[10] = clipPlane.z + 1; e[14] = clipPlane.w;
    reflCam.projectionMatrixInverse.copy(reflCam.projectionMatrix).invert();
    renderer.setRenderTarget(reflRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, reflCam);
  };

  return { mesh, uniforms, reflect, setObstacles, reflRT };
}

// Rings on the water: from skipped stones, splashes, fish, oars and feet.
export function createRipples(count = 64) {
  const geo = new THREE.RingGeometry(0.8, 1, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  const rings = Array.from({ length: count }, () => ({ age: 9, life: 1, x: 0, z: 0, size: 1, power: 0 }));
  let next = 0;
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const add = (x, z, size = 1, power = 0.5, life = 1.6) => {
    const r = rings[next];
    next = (next + 1) % count;
    Object.assign(r, { x, z, size, power, life, age: 0 });
  };
  // By night the rings glow blue-green: the plankton lighting up where the
  // water's disturbed.
  const update = (dt, night = 0) => {
    const glow = Math.max(0, Math.min(1, (night - 0.72) / 0.24));
    rings.forEach((r, i) => {
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) {
        m.makeScale(0, 0, 0);
      } else {
        const s = r.size * (0.35 + Math.sqrt(k) * 2.2);
        m.makeScale(s, 1, s).setPosition(r.x, 0.04, r.z);
      }
      mesh.setMatrixAt(i, m);
      const a = k >= 1 ? 0 : r.power * (1 - k) ** 1.6 * (1 - night * 0.55) * (1 + glow * 3.2);
      mesh.setColorAt(i, c.setRGB(a * (1 - glow * 0.75), a * (1 - glow * 0.05), a * (1 + glow * 0.25)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  };
  return { mesh, add, update };
}
