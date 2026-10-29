import * as THREE from "three";

// How everything in the bay is lit and seen. Every surface shares the same
// light model (a soft terminator, cool shadows, light through leaves), the
// same haze (thicker low over the water, warmer toward the sun) and the same
// wind, so the place hangs together the way a painting does.

export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunUp: { value: 1 },
  uNight: { value: 0 },
  uFogColor: { value: new THREE.Color("#bcd2e4") },
  uFogGlow: { value: new THREE.Color("#fff0d0") },
  uFogDensity: { value: 0.00013 },
  uFogFalloff: { value: 0.0032 },
  uWind: { value: new THREE.Vector2(0.86, 0.5) },
  uGust: { value: 1 },
  uPlayer: { value: new THREE.Vector3() },
  tGround: { value: null },
  uGround: { value: new THREE.Vector4(0, 0, 1, 2) },
};

export const NOISE = /* glsl */ `
  float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
    return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), u.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), u.x), u.y);
  }
  float vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
    float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
    float e = hash13(i + vec3(0, 0, 1)), f1 = hash13(i + vec3(1, 0, 1)), g = hash13(i + vec3(0, 1, 1)), h = hash13(i + vec3(1, 1, 1));
    return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
  }
  float fbm2(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s / .9375; }
  float fbm3(vec3 p) { float s = 0., a = .5; for (int i = 0; i < 3; i++) { s += a * vnoise3(p); p = p * 2.07 + 11.3; a *= .5; } return s / .875; }
  // Distance to the nearest cell point and the next one, and the cell's id
  vec4 voronoi(vec2 p) {
    vec2 n = floor(p), f = fract(p);
    float d1 = 8., d2 = 8.; vec2 id = vec2(0.);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j)), o = hash22(n + g) * 0.8 + 0.1;
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; id = n + g; } else if (d < d2) d2 = d;
    }
    return vec4(d1, d2, id);
  }
`;

// Haze that thins with height: dense over the water, thin on the hills, so
// distance turns things blue the way it does in the painting.
export const FOG = /* glsl */ `
  uniform vec3 uFogColor, uFogGlow, uSunDir;
  uniform float uFogDensity, uFogFalloff;
  vec3 hazeColor(vec3 dir) {
    float s = max(dot(dir, uSunDir), 0.);
    return mix(uFogColor, uFogGlow, pow(s, 6.) * 0.85);
  }
  float hazeAmount(vec3 wp) {
    vec3 d = wp - cameraPosition;
    float dist = length(d);
    float fy = d.y * uFogFalloff;
    float integ = abs(fy) > 1e-3 ? (1. - exp(-fy)) / fy : 1. - fy * 0.5;
    float dens = uFogDensity * exp(-uFogFalloff * max(cameraPosition.y, 0.));
    return 1. - exp(-dens * dist * integ);
  }
  vec3 applyFog(vec3 col, vec3 wp) {
    return mix(col, hazeColor(normalize(wp - cameraPosition)), hazeAmount(wp));
  }
`;

// The height of the ground anywhere near the bay, so that things standing
// on it can be darker where they meet it.
export const GROUND = /* glsl */ `
  uniform sampler2D tGround;
  uniform vec4 uGround;
  float groundH(vec2 xz) {
    vec2 g = (xz - uGround.xy) / uGround.z;
    int n = int(uGround.w);
    ivec2 i = clamp(ivec2(floor(g)), ivec2(0), ivec2(n - 2));
    vec2 f = clamp(g - vec2(i), 0., 1.);
    float a = texelFetch(tGround, i, 0).r, b = texelFetch(tGround, i + ivec2(1, 0), 0).r;
    float c = texelFetch(tGround, i + ivec2(0, 1), 0).r, d = texelFetch(tGround, i + ivec2(1, 1), 0).r;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  vec4 groundData(vec2 xz) {
    vec2 g = (xz - uGround.xy) / uGround.z;
    int n = int(uGround.w);
    ivec2 i = clamp(ivec2(floor(g)), ivec2(0), ivec2(n - 2));
    vec2 f = clamp(g - vec2(i), 0., 1.);
    vec4 a = texelFetch(tGround, i, 0), b = texelFetch(tGround, i + ivec2(1, 0), 0);
    vec4 c = texelFetch(tGround, i + ivec2(0, 1), 0), d = texelFetch(tGround, i + ivec2(1, 1), 0);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

// The light: a soft but definite edge between lit and shaded, shade lit by
// the sky (so it goes cool, not black), and sun coming through leaves.
const LIGHTING = /* glsl */ `
  varying vec3 vViewPosition;
  struct LambertMaterial { vec3 diffuseColor; float specularStrength; };
  // A surface roughened by a height painted on it
  vec3 bumpN(vec3 n, float h) {
    vec3 p = -vViewPosition;
    vec3 dpx = dFdx(p), dpy = dFdy(p);
    vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    return normalize(abs(det) * n - grad);
  }
  #ifndef WRAP
    #define WRAP 0.1
  #endif
  void RE_Direct_Lambert(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
    float nl = dot(geometryNormal, directLight.direction);
    float lit = smoothstep(-WRAP, 0.3 + WRAP, nl) * (0.78 + 0.22 * clamp(nl, 0., 1.));
    vec3 irr = directLight.color * lit * mix(1., gAO, 0.4);
    #ifdef FOLIAGE
      float back = pow(clamp(dot(geometryViewDir, -directLight.direction), 0., 1.), 3.);
      irr += directLight.color * back * float(FOLIAGE) * vec3(1., 0.92, 0.45) * gAO;
    #endif
    reflectedLight.directDiffuse += irr * material.diffuseColor;
  }
  void RE_IndirectDiffuse_Lambert(const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
    reflectedLight.indirectDiffuse += irradiance * material.diffuseColor * gAO;
    #ifdef RIM
      float rim = pow(1. - clamp(dot(geometryNormal, geometryViewDir), 0., 1.), 4.);
      reflectedLight.indirectDiffuse += irradiance * rim * float(RIM) * gAO;
    #endif
  }
  #define RE_Direct RE_Direct_Lambert
  #define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert
`;

// For alpha-cut leaves under multisampling: a crisp edge that's still smooth.
export const A2C = /* glsl */ `
  diffuseColor.a = clamp((diffuseColor.a - 0.5) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0., 1.);
`;

// Plants lean with the wind and rock on their stems; leaves flutter.
const SWAY = /* glsl */ `
  #if defined(SWAY) && defined(USE_INSTANCING)
  {
    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float hgt = max(position.y, 0.);
    float ph = uTime * 1.05 + dot(ip.xz, vec2(0.13, 0.09));
    float gust = 0.55 + 0.45 * sin(uTime * 0.31 + ip.x * 0.017 + ip.z * 0.011);
    vec2 w = uWind * uGust * (0.55 + 0.45 * sin(ph)) * gust;
    mat3 im = mat3(instanceMatrix);
    vec3 lw = transpose(im) * vec3(w.x, 0., w.y) / dot(im[0], im[0]);
    transformed += lw * hgt * hgt * float(SWAY);
    #ifdef FLUTTER
      float k = smoothstep(0.5, 3., hgt) * float(FLUTTER) * uGust;
      transformed += vec3(sin(uTime * 6.3 + position.x * 2.7 + ip.z), sin(uTime * 5.1 + position.z * 3.1 + ip.x) * 0.6, cos(uTime * 6.9 + position.y * 2.3)) * k;
    #endif
  }
  #endif
`;

const VERTEX_PARS = /* glsl */ `
  uniform float uTime, uGust;
  uniform vec2 uWind;
  uniform vec3 uPlayer;
  varying vec3 vWorldP, vWorldN;
`;

// Patches a built-in material (Lambert, nearly always) into the bay's look.
//   key       program cache key, unique per variant
//   defines   WRAP, FOLIAGE, RIM, SWAY, FLUTTER, CONTACT
//   vertexPars, vertexHead (before normals), vertex (after begin_vertex)
//   fragmentPars, color (after color_fragment), normal (after normal maps)
//   emissive (adds to totalEmissiveRadiance), a2c (keep alpha for coverage)
export function stylize(mat, o = {}) {
  const key = o.key || "plain";
  mat.customProgramCacheKey = () => key;
  mat.defines = { ...(mat.defines || {}), ...(o.defines || {}) };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, o.uniforms || {});
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
${VERTEX_PARS}
${o.noiseVertex ? NOISE : ""}
${o.vertexPars || ""}`)
      .replace("#include <beginnormal_vertex>", o.vertexHead ? o.vertexHead : "#include <beginnormal_vertex>")
      .replace("#include <begin_vertex>", o.vertexBegin ? o.vertexBegin : `#include <begin_vertex>
${SWAY}
${o.vertex || ""}`)
      .replace("#include <project_vertex>", `#include <project_vertex>
{
  vec4 wp = vec4(transformed, 1.);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
    wn = mat3(instanceMatrix) * wn;
  #endif
  vWorldP = (modelMatrix * wp).xyz;
  vWorldN = normalize(mat3(modelMatrix) * wn);
}`);
    let f = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uTime, uSunUp, uNight;
uniform vec2 uWind;
varying vec3 vWorldP, vWorldN;
float gAO = 1.;
float gBump = 0.;
${NOISE}
${FOG}
${GROUND}
${o.fragmentPars || ""}`)
      .replace("#include <lights_lambert_pars_fragment>", LIGHTING)
      .replace("#include <color_fragment>", `#include <color_fragment>
${o.color || ""}
#ifdef CONTACT
{
  float above = vWorldP.y - groundH(vWorldP.xz);
  gAO *= mix(0.42, 1., smoothstep(-0.15, float(CONTACT), above));
}
#endif`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
${o.normal || ""}
if (gBump != 0.) normal = bumpN(normal, gBump);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
${o.emissive || ""}`)
      .replace("#include <fog_fragment>", `#ifdef USE_FOG
  gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWorldP);
#endif`);
    if (o.a2c) f = f.replace("#include <opaque_fragment>", "gl_FragColor = vec4(outgoingLight, diffuseColor.a);");
    sh.fragmentShader = f;
  };
  return mat;
}

// The shadow-casting twin of a swaying, alpha-cut material.
export function swayingDepth(o = {}) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: o.map || null, alphaTest: o.map ? 0.5 : 0, side: THREE.DoubleSide });
  mat.defines = { ...(o.defines || {}) };
  mat.customProgramCacheKey = () => `depth-${o.key || ""}`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
${VERTEX_PARS}
${o.vertexPars || ""}`)
      .replace("#include <begin_vertex>", o.vertexBegin ? o.vertexBegin : `#include <begin_vertex>
${SWAY}`);
    if (o.vertexHead) sh.vertexShader = sh.vertexShader.replace("void main() {", `void main() {\n${o.vertexHead}`);
  };
  return mat;
}

// A plain stylized material, for odds and ends.
export const toonish = (color, o = {}) => stylize(new THREE.MeshLambertMaterial({ color, ...(o.params || {}) }), { key: o.key || "plain", defines: o.defines || { RIM: 0.25 } });
