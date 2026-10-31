// How hard the scene may work on this device. The painting itself is always
// drawn at the screen's own resolution (up to a cap), so a still scene looks
// exactly like the <img>; the tiers only limit what motion will cost later.

const TIERS = {
  // Pixels the canvas may have, and frames per second while animating. The
  // sea moves slowly, a fraction of a pixel a frame, so 30 is smooth.
  high: { maxPixels: 4.5e6, fps: 30 },
  medium: { maxPixels: 3e6, fps: 30 },
  low: { maxPixels: 1.6e6, fps: 24 },
};

export function pickQuality(gl) {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  const saveData = navigator.connection?.saveData === true;
  let tier = "high";
  if (cores <= 4 || memory <= 4) tier = "medium";
  if (cores <= 2 || memory <= 2 || saveData) tier = "low";
  // A software rasteriser can draw the still painting, but not much more.
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) tier = "low";
  return { tier, ...TIERS[tier], maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), renderer };
}

// The canvas's pixel ratio: the screen's own, unless the banner would need
// more pixels than the tier allows.
export function pixelRatio(quality, cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const budget = Math.sqrt(quality.maxPixels / Math.max(1, cssWidth * cssHeight));
  return Math.max(0.5, Math.min(dpr, 3, budget));
}
