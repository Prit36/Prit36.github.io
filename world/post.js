import * as THREE from "three";

// From the scene to the screen. The bay is drawn sharp, at full resolution
// with multisampling, in high dynamic range; then lamps and the sun bloom,
// light falls in shafts past the clouds, and the colour is finished the way
// a print is: highlights rolled off gently, shadows a little cooler, a
// vignette, and a grain too fine to see but enough to stop banding.

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const DOWN = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uFirst, uThreshold, uKnee;
  varying vec2 vUv;
  // Clamped, so one bad pixel (a NaN, or a light too bright to store) can't spread
  vec3 s(vec2 o) {
    vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb;
    if (any(isnan(c)) || any(isinf(c))) return vec3(0.);
    return clamp(c, 0., 200.);
  }
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  void main() {
    vec3 a = s(vec2(-2., 2.)), b = s(vec2(0., 2.)), c = s(vec2(2., 2.));
    vec3 d = s(vec2(-2., 0.)), e = s(vec2(0.)), f = s(vec2(2., 0.));
    vec3 g = s(vec2(-2., -2.)), h = s(vec2(0., -2.)), i = s(vec2(2., -2.));
    vec3 j = s(vec2(-1., 1.)), k = s(vec2(1., 1.)), l = s(vec2(-1., -1.)), m = s(vec2(1., -1.));
    vec3 col;
    if (uFirst > 0.5) {
      // Weighted so that one bright pixel can't flash on and off
      vec3 g0 = (a + b + d + e) * .25, g1 = (b + c + e + f) * .25, g2 = (d + e + g + h) * .25, g3 = (e + f + h + i) * .25, g4 = (j + k + l + m) * .25;
      float w0 = .125 / (1. + lum(g0)), w1 = .125 / (1. + lum(g1)), w2 = .125 / (1. + lum(g2)), w3 = .125 / (1. + lum(g3)), w4 = .5 / (1. + lum(g4));
      col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
      float br = max(col.r, max(col.g, col.b));
      float soft = clamp(br - uThreshold + uKnee, 0., 2. * uKnee);
      soft = soft * soft / (4. * uKnee + 1e-4);
      col *= max(soft, br - uThreshold) / max(br, 1e-4);
    } else {
      col = e * .125 + (a + c + g + i) * .03125 + (b + d + f + h) * .0625 + (j + k + l + m) * .125;
    }
    gl_FragColor = vec4(col, 1.);
  }`;

const UP = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uRadius;
  varying vec2 vUv;
  void main() {
    vec2 t = uTexel * uRadius;
    vec3 c = texture2D(tSrc, vUv).rgb * 4.;
    c += (texture2D(tSrc, vUv + vec2(t.x, 0.)).rgb + texture2D(tSrc, vUv - vec2(t.x, 0.)).rgb + texture2D(tSrc, vUv + vec2(0., t.y)).rgb + texture2D(tSrc, vUv - vec2(0., t.y)).rgb) * 2.;
    c += texture2D(tSrc, vUv + t).rgb + texture2D(tSrc, vUv - t).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb;
    gl_FragColor = vec4(c / 16., 1.);
  }`;

// Light shafts: the bright sky near the sun, smeared away from it.
const MASK = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uSun;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tSrc, vUv);
    vec2 d = vUv - uSun;
    d.x *= uAspect;
    float near = exp(-dot(d, d) * 5.);
    float sky = clamp(1. - c.a, 0., 1.);
    float l = min(dot(c.rgb, vec3(0.3, 0.5, 0.2)), 3.);
    gl_FragColor = vec4(vec3(sky * near * l), 1.);
  }`;

const RADIAL = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uSun;
  uniform float uSpan;
  varying vec2 vUv;
  void main() {
    vec2 delta = (vUv - uSun) * uSpan / 28.;
    vec2 uv = vUv;
    float decay = 1., sum = 0.;
    vec3 acc = vec3(0.);
    for (int i = 0; i < 28; i++) {
      acc += texture2D(tSrc, uv).rgb * decay;
      sum += decay;
      decay *= 0.965;
      uv -= delta;
    }
    gl_FragColor = vec4(acc / sum, 1.);
  }`;

const FINAL = /* glsl */ `
  uniform sampler2D tScene, tBloom, tRays;
  uniform float uExposure, uBloom, uRays, uTime, uFade, uSat, uVignette, uContrast, uCanvas, uPixel;
  uniform vec3 uRayColor, uFadeColor, uShadowTint, uLightTint;
  varying vec2 vUv;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  // Keeps the painted colours as they are and only bends the brightest
  // light down to white (the Khronos neutral curve).
  vec3 neutral(vec3 color) {
    const float start = 0.76, desat = 0.15;
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;
    float peak = max(color.r, max(color.g, color.b));
    if (peak < start) return color;
    float d = 1. - start;
    float newPeak = 1. - d * d / (peak + d - start);
    color *= newPeak / peak;
    float g = 1. - 1. / (desat * (peak - newPeak) + 1.);
    return mix(color, vec3(newPeak), g);
  }
  vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - 0.055, step(0.0031308, c)); }
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    if (any(isnan(c))) c = vec3(0.);
    c += texture2D(tBloom, vUv).rgb * uBloom;
    c += texture2D(tRays, vUv).rgb * uRayColor * uRays;
    c *= uExposure;
    c = neutral(max(c, 0.));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    c *= mix(uShadowTint, uLightTint, smoothstep(0.04, 0.65, l));
    vec2 q = vUv - 0.5;
    c *= 1. - uVignette * smoothstep(0.1, 0.75, dot(q, q) * 2.2);
    c = toSRGB(clamp(c, 0., 1.));
    c = mix(c, c * c * (3. - 2. * c), uContrast);
    // the weave of the canvas, faintly, in the mid-tones: sharp, never a blur
    {
      vec2 p = gl_FragCoord.xy / max(uPixel, 1.);
      float weave = sin(p.x * 1.9) * sin(p.y * 1.9 + sin(p.x * 0.37) * 1.3);
      float tooth = hash(floor(p * 0.5)) - 0.5;
      float mid = 1. - abs(dot(c, vec3(0.33)) * 2. - 1.);
      c *= 1. + (weave * 0.018 + tooth * 0.022) * mid * uCanvas;
    }
    c = mix(c, uFadeColor, uFade);
    c += (hash(gl_FragCoord.xy + fract(uTime * 7.13) * 91.) - 0.5) / 160.;
    gl_FragColor = vec4(c, 1.);
  }`;

export function createPost(renderer) {
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const flat = new THREE.Scene();
  flat.add(quad);
  const flatCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const samples = Math.min(4, renderer.capabilities.maxSamples || 0);
  const target = (o = {}) => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, ...o });
  const sceneRT = target({ depthBuffer: true, samples });
  const LEVELS = 6;
  const mips = Array.from({ length: LEVELS }, () => target());
  const rayA = target(), rayB = target();
  const pass = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false, ...extra });
  const down = pass(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1.1 }, uKnee: { value: 0.6 } });
  const up = pass(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } }, { blending: THREE.AdditiveBlending });
  const mask = pass(MASK, { tSrc: { value: sceneRT.texture }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
  const radial = pass(RADIAL, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uSpan: { value: 1 } });
  const final = pass(FINAL, {
    tScene: { value: sceneRT.texture }, tBloom: { value: mips[0].texture }, tRays: { value: rayB.texture },
    uExposure: { value: 1 }, uBloom: { value: 0.6 }, uRays: { value: 0 }, uTime: { value: 0 }, uFade: { value: 0 },
    uSat: { value: 1.06 }, uVignette: { value: 0.32 }, uContrast: { value: 0.08 }, uCanvas: { value: 1 }, uPixel: { value: 1 },
    uRayColor: { value: new THREE.Color("#ffe2b0") }, uFadeColor: { value: new THREE.Color("#f4f0e4") },
    uShadowTint: { value: new THREE.Color(0.95, 0.98, 1.06) }, uLightTint: { value: new THREE.Color(1.03, 1.0, 0.96) },
  });
  // The fade is mixed in after the colour is converted for the screen
  final.uniforms.uFadeColor.value.setRGB(0.957, 0.941, 0.894, THREE.LinearSRGBColorSpace);

  const draw = (mat, rt, clear = true) => {
    quad.material = mat;
    renderer.setRenderTarget(rt);
    if (clear) renderer.clear(true, false, false);
    renderer.render(flat, flatCam);
  };

  let width = 1, height = 1, scale = 1, pixelRatio = 1, seen = "";
  const size = () => {
    seen = `${innerWidth}x${innerHeight}`;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = Math.max(1, Math.round(innerWidth * pixelRatio * scale));
    height = Math.max(1, Math.round(innerHeight * pixelRatio * scale));
    sceneRT.setSize(width, height);
    let w = width, h = height;
    for (const m of mips) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); m.setSize(w, h); }
    rayA.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    rayB.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    // the canvas weave is laid in CSS pixels, so it's the same on any screen
    final.uniforms.uPixel.value = Math.min(window.devicePixelRatio || 1, 1.5);
  };

  const sunScreen = new THREE.Vector3();
  const render = (scene, camera, sunWorld) => {
    if (seen !== `${innerWidth}x${innerHeight}`) size();
    renderer.setRenderTarget(sceneRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    // Bloom: down a chain of halves, then back up, adding as it goes
    let src = sceneRT.texture, sw = width, sh = height;
    mips.forEach((m, i) => {
      down.uniforms.tSrc.value = src;
      down.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      down.uniforms.uFirst.value = i === 0 ? 1 : 0;
      draw(down, m);
      src = m.texture; sw = m.width; sh = m.height;
    });
    for (let i = LEVELS - 2; i >= 0; i--) {
      const from = mips[i + 1];
      up.uniforms.tSrc.value = from.texture;
      up.uniforms.uTexel.value.set(1 / from.width, 1 / from.height);
      draw(up, mips[i], false);
    }

    // Shafts of light, when the sun is somewhere ahead
    let rays = 0;
    if (sunWorld) {
      sunScreen.copy(sunWorld).project(camera);
      const ahead = sunScreen.z < 1 && sunScreen.z > -1;
      const off = Math.max(Math.abs(sunScreen.x), Math.abs(sunScreen.y));
      rays = ahead ? 1 - Math.min(1, Math.max(0, (off - 1) / 0.6)) : 0;
    }
    if (rays > 0.01) {
      const sx = sunScreen.x * 0.5 + 0.5, sy = sunScreen.y * 0.5 + 0.5;
      mask.uniforms.uSun.value.set(sx, sy);
      mask.uniforms.uAspect.value = width / height;
      draw(mask, rayA);
      radial.uniforms.uSun.value.set(sx, sy);
      radial.uniforms.tSrc.value = rayA.texture;
      radial.uniforms.uSpan.value = 0.85;
      draw(radial, rayB);
      radial.uniforms.tSrc.value = rayB.texture;
      radial.uniforms.uSpan.value = 0.22;
      draw(radial, rayA);
      final.uniforms.tRays.value = rayA.texture;
    }
    final.uniforms.uRays.value = rays > 0.01 ? api.rays * rays : 0;
    final.uniforms.uTime.value = performance.now() / 1000;
    draw(final, null);
  };

  const api = {
    rays: 0,
    render,
    resize: size,
    final,
    bloom: down.uniforms,
    get height() { return height; },
    get width() { return width; },
    get scale() { return scale; },
    set scale(s) { scale = s; size(); },
  };
  return api;
}
