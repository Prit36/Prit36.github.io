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
uniform sampler2D uFields; // shore distance, cloud density, foliage flex
#endif
#ifdef WATER
uniform sampler2D uWaterUnder; // the sea, carried on under the land
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

// Plain bilinear from the full-size picture: what Chromium does when it
// draws the <img>, at every scale and pixel ratio measured. Mipmaps or a
// cubic filter would look smoother, and not like the original.
vec3 paint(vec2 uv) { return texture(uPainting, uv).rgb; }

#ifdef MATTES
vec3 mattes(vec2 uv) { return texture(uMattes, uv).rgb; }
vec3 fields(vec2 uv) { return texture(uFields, uv).rgb; }
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

// How far the paint now at uv has travelled, in uv, for each system. This
// is where motion goes; for now each holds still unless probed.
#ifdef WATER
vec2 waterShift(vec2 uv) { return vec2(uProbe.x, 0.0) / uSource; }
#endif
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
  {
    vec2 from = uv - waterShift(uv);
    vec3 there = mix(texture(uWaterUnder, from).rgb, paint(from), pure(mattes(from).r));
    vec3 still = mix(texture(uWaterUnder, uv).rgb, color, pure(here.r));
    color += here.r * (there - still);
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
  vec3 m = mattes(uv), f = fields(uv);
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
  return mix(grey, mix(vec3(1.0), vec3(0.0, 0.1, 0.5), f.r), m.r);
#elif DEBUG_VIEW == 8
  return mix(grey, vec3(f.g), m.g);
#else
  return texture(uPlate, uv).rgb;
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

export const DEBUG_VIEWS = ["mattes", "water", "sky", "foliage", "groups", "flex", "shore", "clouds", "plate"];

export function fragmentSource(defines, debugView = 0) {
  const head = ["#version 300 es", ...defines.map((d) => `#define ${d} 1`), `#define DEBUG_VIEW ${debugView}`];
  return `${head.join("\n")}\n${FRAGMENT}`;
}
