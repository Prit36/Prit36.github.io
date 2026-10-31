// Where the painting sits in the banner. The <img> is drawn with
// object-fit and object-position, so a point of the painting lands somewhere
// that depends on the banner's size and on the breakpoint; everything that
// is drawn over or instead of the painting goes through here, so it lands in
// the same place.
//
// Three spaces:
//   image  pixels of the full-size painting (manifest.source), y down
//   uv     the same, as 0..1 of the painting's width and height
//   view   CSS pixels from the top left of the banner
// and device pixels, which are view pixels times the canvas's pixel ratio.

const parseAxis = (value, free) => {
  if (value.endsWith("%")) return free * (parseFloat(value) / 100);
  return parseFloat(value) || 0;
};

export function measureFrame(img, source, width, height) {
  const style = getComputedStyle(img);
  const fit = style.objectFit;
  const sx = width / source.width, sy = height / source.height;
  const scale = fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
  const shownW = source.width * scale, shownH = source.height * scale;
  const [px = "50%", py = "50%"] = style.objectPosition.split(" ");
  return new Frame(source, width, height, scale,
    parseAxis(px, width - shownW), parseAxis(py, height - shownH));
}

export class Frame {
  constructor(source, width, height, scale, offsetX, offsetY) {
    this.source = source;
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
  }

  imageToView([x, y]) {
    return [this.offsetX + x * this.scale, this.offsetY + y * this.scale];
  }

  viewToImage([x, y]) {
    return [(x - this.offsetX) / this.scale, (y - this.offsetY) / this.scale];
  }

  // The rectangle the browser really paints the picture into, in device
  // pixels: Chromium snaps each edge of it to a whole device pixel, so the
  // picture can sit a fraction of a pixel off, and be a fraction of a pixel
  // smaller or larger, than the exact fit says.
  deviceRect(dpr) {
    const snap = (v) => Math.round(v * dpr);
    const { width: iw, height: ih } = this.source;
    return [snap(this.offsetX), snap(this.offsetY), snap(this.offsetX + iw * this.scale), snap(this.offsetY + ih * this.scale)];
  }

  // An affine map from gl_FragCoord (canvas pixels, y up) to painting uv,
  // as uv = fragCoord * [a, b] + [c, d], through the snapped rectangle.
  // ratioX and ratioY are the canvas's pixels per CSS pixel; dpr is the
  // screen's, which is what the browser snaps to.
  deviceToUv(ratioX, ratioY, canvasHeight, dpr) {
    const [l, t, r, b] = this.deviceRect(dpr).map((v) => v / dpr);
    const w = r - l, h = b - t;
    return [
      1 / (ratioX * w),
      -1 / (ratioY * h),
      -l / w,
      (canvasHeight / ratioY - t) / h,
    ];
  }
}
