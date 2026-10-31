// One full-screen pass draws the painting through the cover transform, then
// lets each switched-on system resample its own region. With no system on,
// it is a single texture read per pixel.

export const VERTEX = `#version 300 es
// A single triangle that covers the canvas; no buffers needed.
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FRAGMENT = `
precision highp float;
precision highp int;

uniform sampler2D uPainting;
// gl_FragCoord to painting uv: uv = fragCoord * uMap.xy + uMap.zw
uniform vec4 uMap;
// The full-size painting, in pixels: the space the layers were made in.
uniform vec2 uSource;
// The shared environment (see environment.js).
uniform vec4 uEnv[2];
// A fixed shift, in painting pixels, per system (water, sky, foliage). Zero
// except in the probe view, which checks that each region moves alone.
uniform vec3 uProbe;

#if defined(WATER) || defined(SKY) || defined(FOLIAGE) || DEBUG_VIEW > 0
#define MATTES 1
uniform sampler2D uMattes; // water, sky, foliage
uniform sampler2D uFields; // how shallow the water is, cloud density, foliage flex
#endif
#if defined(WATER) || DEBUG_VIEW > 0
uniform sampler2D uWater;  // distance to the shore, painted foam, painted light
uniform float uShoreReach; // metres of shore distance the layer holds
#endif
#ifdef WATER
uniform sampler2D uWaterUnder; // the sea, carried on under the land
// How the painting looks onto the sea: the horizon's row, the column
// straight ahead, the focal length (painting pixels) and the eye's height
// above the water (metres); and how far the far water is squashed at most
// (see SEA_VIEW in build_scene.py).
uniform vec4 uSeaView;
uniform float uSeaStretch;
// The waves (see water.js): wave vector in radians per metre, phase, how
// much of it there is now; and how much each counts towards the look of the
// sea. The first SWELLS are swell, the rest wind ripples.
#define WAVES 16
#define SWELLS 6
uniform vec4 uWaves[WAVES];
uniform float uWaveWeights[WAVES];
// shore phase, shore waves so far, shore strength, shore period;
// wind drift (metres), ripple strength, swell strength;
// time, motion (0 is the painting exactly), daylight, -
uniform vec4 uSea[3];
#endif
#ifdef SKY
uniform sampler2D uSkyUnder;   // the sky, carried on behind what stands in it
#endif
#if defined(FOLIAGE) || DEBUG_VIEW > 0
uniform sampler2D uGroups; // which tree, as id / 255, read without filtering
uniform sampler2D uPlate;  // the painting with the foliage taken out
uniform sampler2D uLeaves; // the foliage, premultiplied by its matte
#endif

out vec4 outColor;

const float TAU = 6.28318530718;

// Plain bilinear from the full-size picture: what Chromium does when it
// draws the <img>, at every scale and pixel ratio measured. Mipmaps or a
// cubic filter would look smoother, and not like the original.
vec3 paint(vec2 uv) { return texture(uPainting, uv).rgb; }

#ifdef MATTES
vec3 mattes(vec2 uv) { return texture(uMattes, uv).rgb; }
vec3 fields(vec2 uv) { return texture(uFields, uv).rgb; }
#endif
#if defined(WATER) || DEBUG_VIEW > 0
// Metres to the nearest rock or beach, out to uShoreReach.
float shoreDistance(vec2 uv) {
  float s = texture(uWater, uv).r;
  return s * s * uShoreReach;
}
#endif
#if defined(FOLIAGE) || DEBUG_VIEW > 0
float group(vec2 uv) {
  ivec2 size = textureSize(uGroups, 0);
  ivec2 texel = clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1);
  return texelFetch(uGroups, texel, 0).r * 255.0;
}
#endif

#ifdef MATTES
// How much of a pixel's paint to trust as the region's own: an edge pixel
// is part something else, so the underlay stands in for it.
float pure(float m) { return smoothstep(0.55, 1.0, m); }
#endif

#ifdef WATER
// Integer hashing (pcg2d), so the same cell gives the same number on every
// GPU, however far out it is.
uvec2 pcg(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return v;
}
vec2 gradient(ivec2 c) { return vec2(pcg(uvec2(c))) * (2.0 / 4294967295.0) - 1.0; }
float random(float n, float seed) { return float(pcg(uvec2(ivec2(int(n), int(seed)))).x) / 4294967295.0; }
// Smooth gradient noise, about -1 to 1. Not periodic anywhere.
float noise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(i);
  float a = dot(gradient(c), f);
  float b = dot(gradient(c + ivec2(1, 0)), f - vec2(1.0, 0.0));
  float d = dot(gradient(c + ivec2(0, 1)), f - vec2(0.0, 1.0));
  float e = dot(gradient(c + ivec2(1, 1)), f - vec2(1.0));
  return 1.4 * mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

// Where a pixel of the painting lies on the sea, in metres: x across the
// view, z away from you. span is how many metres one painting pixel covers
// there, across the view and into it: a couple of centimetres close by,
// metres near the horizon.
vec2 seaPoint(vec2 p, out vec2 span) {
  float d = max(p.y - uSeaView.x, 1.0);
  float m = uSeaView.w / d;
  float knee = uSeaView.z / uSeaStretch;
  span = vec2(m, m * min(uSeaView.z / d, uSeaStretch));
  // Past the knee every row is uSeaStretch times as deep as it is wide,
  // which adds up to a logarithm.
  float z = d >= knee ? uSeaView.z * m : uSeaStretch * uSeaView.w * (1.0 + log(knee / d));
  return vec2((p.x - uSeaView.y) * m, z);
}

struct Sea {
  vec2 shift;  // where the paint seen here comes from, in uv
  float gain;  // brighter or darker, as a fraction
  float foam;  // how much pale foam lies over it
  float glint; // how much sunlight it throws back
};

// The pale of the painted foam and the warm white of the sun.
const vec3 FOAM = vec3(0.93, 0.975, 0.965);
const vec3 SUN = vec3(1.0, 0.97, 0.88);

// shore and its screen gradient come from compose(), where every pixel
// takes part in the derivative.
Sea seaAt(vec2 uv, float shore, vec2 shoreSlope) {
  Sea sea = Sea(vec2(0.0), 0.0, 0.0, 0.0);
  float motion = uSea[2].y;
  if (motion <= 0.0) return sea;

  vec2 p = uv * uSource;
  vec2 span;
  vec2 P = seaPoint(p, span);
  float rows = p.y - uSeaView.x;
  // Metres per pixel of this canvas.
  vec2 foot = span * (uMap.x * uSource.x);
  float shallow = fields(uv).r;
  vec3 layer = texture(uWater, uv).rgb;
  float t = uSea[2].x;

  // Patches of livelier ripples, carried along by the wind and slowly
  // changing shape as they go.
  vec2 drift = uSea[1].xy;
  float gusty = noise((P - drift) / 23.0) + 0.5 * noise((P - drift * 0.7) / 9.0 + vec2(t * 0.021, -t * 0.013));
  float lively = clamp(0.62 + 0.45 * gusty, 0.15, 1.35);
  // The swell comes in groups, a few larger waves then a few smaller, and
  // the groups wander as they roll in.
  float grouped = clamp(0.7 + 0.5 * noise(P / 70.0 + vec2(-t * 0.011, t * 0.017)), 0.25, 1.3);

  // The surface's tilt and curvature, from the waves long enough to draw
  // here (a wave only a few pixels long would just flicker), measured
  // against the most they could add up to. So the far sea moves with its
  // long, slow waves alone, broad and unhurried, and the near sea with all
  // of them; how much it moves is set below, not by how many there are.
  // Deep water is mostly swell, the shallows mostly ripples.
  vec2 tilt = vec2(0.0), glance = vec2(0.0);
  float curve = 0.0, full = 0.0, small = 0.0, stir = 0.0;
  for (int i = 0; i < WAVES; i++) {
    vec4 w = uWaves[i];
    float k = length(w.xy);
    float pixels = TAU / max(length(w.xy * foot), 1e-6);
    bool swell = i < SWELLS;
    float weight = uWaveWeights[i] * smoothstep(3.0, 9.0, pixels)
      * (swell ? mix(1.15, 0.7, shallow) : mix(0.8, 1.3, shallow));
    full += weight * weight;
    float a = weight * w.w * (swell ? grouped : lively);
    if (!swell) {
      small += weight * weight;
      stir += a * a;
    }
    float phase = dot(w.xy, P) + w.z;
    vec2 s = a * cos(phase) * (w.xy / k);
    tilt += s;
    if (!swell) glance += s;
    curve -= a * sin(phase);
  }
  float norm = inversesqrt(max(full, 1e-3)) * smoothstep(0.0, 0.3, full);
  tilt *= norm;
  curve *= norm;
  // The ripples alone, against how stirred up they are now, so a glint is
  // always one facet in a few dozen tipped further than most. They need
  // facets small enough to see: far out, where no ripple can be drawn,
  // there are none.
  glance *= inversesqrt(max(0.5 * stir, 1e-6)) * smoothstep(0.0, 0.3, small);
  // Right at the horizon nothing can be seen to move.
  float seen = smoothstep(2.0, 16.0, rows);

  // The painted water is seen through the surface, so a tilt carries it a
  // little way: hardly at all far out, more in the shallows close by. In
  // painting pixels, then uv; +z is up the painting.
  float close = smoothstep(10.0, 330.0, rows);
  vec2 reach = vec2(mix(0.85, 1.8, close), mix(0.75, 1.35, close)) * mix(0.85, 1.25, shallow) * seen;
  sea.shift = vec2(tilt.x, -tilt.y) * reach / uSource;

  // Facets tipped away from you catch the paler sky near the horizon,
  // facets tipped towards you the deeper blue overhead. In the shallows,
  // light through the surface gathers under its hollows.
  sea.gain = (-0.05 * tilt.y + 0.04 * shallow * curve) * seen;

  // The sun's glints, only where the painter already put light on the
  // water, and only on the few ripples tipped just so.
  float glint = smoothstep(1.45, 2.1, dot(glance, vec2(-0.51, -0.86)));
  // Never everywhere at once: a few drifting spots where the light falls.
  float spots = noise(P * 0.8 - drift * 1.3 + vec2(t * 0.07, -t * 0.05)) + 0.5 * noise(P * 2.3 + vec2(-t * 0.11, t * 0.09));
  glint *= smoothstep(0.45, 0.9, spots);
  sea.glint = 0.5 * glint * layer.b * uSea[2].z * seen;

  // Small waves coming in to the shore, one after another. Where the shore
  // is small in the picture they are drawn larger than life, as the painter
  // drew its foam, never less than a few pixels apart; where even then
  // they would be too fine to draw, each wave is a brightening that runs
  // along the shore as it comes in.
  float fine = abs(shoreSlope.x) + abs(shoreSlope.y); // metres per canvas pixel
  float scale = clamp(9.0 * fine / 2.3, 1.0, 4.0);
  float near = 1.0 - smoothstep(3.5 * scale, 5.5 * scale, shore);
  if (near > 0.0 && uSea[0].z > 0.0) {
    float drawn = smoothstep(2.5, 6.0, 2.3 * scale / max(fine, 1e-5));
    float k = TAU / (2.3 * scale) * drawn;
    // How far each wave front lags along the shore: it never comes in
    // straight.
    float lag = 1.8 * noise(P * 0.065 + vec2(0.0, t * 0.012)) + 0.6 * noise(P * 0.21 + vec2(t * 0.035, 0.0));
    float arrive = uSea[0].x + lag;
    float psi = arrive + k * shore;
    float wave = uSea[0].y + floor(psi / TAU);
    float strength = uSea[0].z * (0.3 + 0.7 * pow(random(wave, 7.0), 1.6));
    // Waves steepen and brighten as they come in.
    float crest = pow(0.5 + 0.5 * cos(psi), 2.5) * near * (0.35 + 0.65 * (1.0 - smoothstep(0.0, 3.5 * scale, shore)));
    sea.gain += 0.045 * crest * strength * (0.5 + 0.5 * shallow);

    // The wave that last reached the shore: its foam, thinning out and
    // drawn back as the water runs off.
    float last = uSea[0].y + floor(arrive / TAU);
    float age = fract(arrive / TAU);
    float broke = uSea[0].z * (0.3 + 0.7 * pow(random(last, 7.0), 1.6));
    float reach = (0.3 + 0.9 * age) * scale;
    float band = 1.0 - smoothstep(reach * 0.5, reach, shore);
    float lace = noise(P * 2.7 + vec2(last * 7.31, 0.0)) * 0.6 + noise(P * 6.1 - vec2(0.0, last * 3.7)) * 0.4;
    float open = mix(-0.35, 0.55, age);
    float cell = 0.35 / max(max(foot.x, foot.y), 1e-5);
    float lacy = mix(1.0 - smoothstep(-0.35, 0.55, open), smoothstep(open, open + 0.25, lace), smoothstep(1.5, 4.0, cell));
    sea.foam = 0.38 * broke * band * lacy * pow(1.0 - age, 1.5) * (0.4 + 0.6 * shallow);
    // The painted foam brightens as a wave comes in and dims as it ebbs.
    sea.gain += layer.g * broke * (0.12 * pow(1.0 - age, 3.0) - 0.035);

    // The water itself is pushed in by each crest and drawn back after it.
    vec2 toward = -shoreSlope;
    float l = length(toward);
    if (l > 1e-6) {
      toward /= l;
      float push = 0.6 * crest * strength * drawn - 0.35 * broke * sin(3.1416 * age) * band;
      // Not right against the rock: the paint there is half rock.
      push *= smoothstep(0.0, 2.0, shore / max(fine, 1e-5));
      // canvas pixels (y up) to uv (y down)
      sea.shift += push * vec2(toward.x * uMap.x, toward.y * uMap.y);
    }
  }

  sea.shift *= motion;
  sea.gain *= motion;
  sea.foam *= motion;
  sea.glint *= motion;
  return sea;
}
#endif

// How far the paint now at uv has travelled, in uv, for each system. This
// is where motion goes.
#ifdef SKY
vec2 skyShift(vec2 uv) { return vec2(uProbe.y, 0.0) / uSource; }
#endif
#ifdef FOLIAGE
vec2 foliageShift(vec2 uv) { return vec2(uProbe.z, 0.0) * fields(uv).b / uSource; }
#endif

vec3 compose(vec2 uv) {
  vec3 color = paint(uv);
#ifdef MATTES
  vec3 here = mattes(uv);
#endif

#ifdef WATER
  // Water moves only where there is water, and is drawn from the sea
  // carried on under the land where it comes from past the shore; pixels
  // along the shore, part rock, take the sea from there too. Written as a
  // change to the painting, so holding still is exactly the painting.
  float shore = shoreDistance(uv);
  vec2 shoreSlope = vec2(dFdx(shore), dFdy(shore));
  if (here.r > 0.0) {
    Sea sea = seaAt(uv, shore, shoreSlope);
    vec2 from = uv - sea.shift - vec2(uProbe.x, 0.0) / uSource;
    vec3 there = mix(texture(uWaterUnder, from).rgb, paint(from), pure(mattes(from).r));
    vec3 still = mix(texture(uWaterUnder, uv).rgb, color, pure(here.r));
    color += here.r * (there - still);
    color *= 1.0 + here.r * sea.gain;
    color = mix(color, FOAM, here.r * clamp(sea.foam, 0.0, 1.0));
    color = mix(color, SUN, here.r * clamp(sea.glint, 0.0, 1.0));
  }
#endif

#ifdef SKY
  {
    vec2 from = uv - skyShift(uv);
    vec3 there = mix(texture(uSkyUnder, from).rgb, paint(from), pure(mattes(from).g));
    vec3 still = mix(texture(uSkyUnder, uv).rgb, color, pure(here.g));
    color += here.g * (there - still);
  }
#endif

#ifdef FOLIAGE
  // The painting is the foliage over what was behind it: paint = leaves +
  // behind, both premultiplied, leaves = a * leaf colour. The leaves are
  // lifted from where they were and laid where they are now. Uncovered
  // ground is what was behind them, topped up from the clean plate where
  // the leaves used to cover it; covered ground is dimmed by the leaves
  // now over it. Every term is filtered linearly, so nothing moving means
  // exactly the painting, at any scale.
  {
    vec2 from = uv - foliageShift(uv);
    float a = mattes(from).b;
    vec3 leaves = texture(uLeaves, from).rgb;
    vec3 behind = color - texture(uLeaves, uv).rgb;
    color = a <= here.b
      ? leaves + behind + (here.b - a) * texture(uPlate, uv).rgb
      : leaves + behind * ((1.0 - a) / (1.0 - here.b));
  }
#endif
  return color;
}

#if DEBUG_VIEW > 0
vec3 hue(float id) {
  return 0.35 + 0.65 * fract(sin(vec3(id) * vec3(12.9898, 78.233, 37.719)) * 43758.5453);
}
vec3 debugView(vec2 uv) {
  vec3 base = paint(uv);
  vec3 m = mattes(uv), f = fields(uv), w = texture(uWater, uv).rgb;
  float shade = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 grey = vec3(shade * 0.55 + 0.2);
#if DEBUG_VIEW == 1
  vec3 tint = m.r * vec3(0.12, 0.38, 1.0) + m.g * vec3(1.0, 0.66, 0.16) + m.b * vec3(0.9, 0.12, 0.8);
  float rest = clamp(1.0 - m.r - m.g - m.b, 0.0, 1.0);
  return mix(base, tint + rest * grey, 0.62);
#elif DEBUG_VIEW == 2
  return mix(grey, base, m.r);
#elif DEBUG_VIEW == 3
  return mix(grey, base, m.g);
#elif DEBUG_VIEW == 4
  return mix(grey, base, m.b);
#elif DEBUG_VIEW == 5
  float id = group(uv);
  return id > 0.0 ? mix(base, hue(id), 0.7) : grey;
#elif DEBUG_VIEW == 6
  return mix(grey, vec3(1.0, 0.85, 0.2) * f.b + vec3(0.1, 0.3, 0.1) * (1.0 - f.b), m.b);
#elif DEBUG_VIEW == 7
  // A line every metre out from the shore.
  float d = shoreDistance(uv);
  float line = smoothstep(0.86, 0.96, abs(fract(d) - 0.5) * 2.0) * step(d, uShoreReach - 0.01);
  return mix(grey, mix(base, vec3(1.0, 0.1, 0.35), line * 0.8), m.r);
#elif DEBUG_VIEW == 8
  return mix(grey, vec3(f.g), m.g);
#elif DEBUG_VIEW == 9
  return texture(uPlate, uv).rgb;
#elif DEBUG_VIEW == 10
  return mix(grey, mix(vec3(0.05, 0.12, 0.45), vec3(0.3, 0.95, 0.85), f.r), m.r);
#elif DEBUG_VIEW == 11
  return mix(grey, mix(base, vec3(1.0, 0.1, 0.35), w.g), m.r);
#else
  return mix(grey, mix(base * 0.6, vec3(1.0, 0.85, 0.3), w.b), m.r);
#endif
}
#endif

void main() {
  vec2 uv = gl_FragCoord.xy * uMap.xy + uMap.zw;
#if DEBUG_VIEW > 0
  outColor = vec4(debugView(uv), 1.0);
#else
  outColor = vec4(compose(uv), 1.0);
#endif
}
`;

export const DEBUG_VIEWS = ["mattes", "water", "sky", "foliage", "groups", "flex", "shore", "clouds", "plate",
  "depth", "foam", "light"];

export function fragmentSource(defines, debugView = 0) {
  const head = ["#version 300 es", ...defines.map((d) => `#define ${d} 1`), `#define DEBUG_VIEW ${debugView}`];
  return `${head.join("\n")}\n${FRAGMENT}`;
}
