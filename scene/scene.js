// The living painting: a canvas laid exactly over the banner's <img>, drawn
// from the same picture through the same object-fit, so the two cannot be
// told apart until something moves. The <img> stays underneath the whole
// time; the canvas only shows once it has drawn a frame, and hides again if
// the GPU goes away, so there is never an empty banner.
//
// Frames are drawn on demand. A still scene is drawn once, and again only
// when the banner changes size or the picture changes. The animation loop
// runs only while a system has motion, motion is allowed, the tab is
// visible and the banner is on screen.
//
// Motion fades in over the first few seconds, so the canvas takes over from
// the <img> without a jump and the painting only gradually comes alive.
// With reduced motion it is the painting, exactly, and holds still.

import { Renderer } from "./renderer.js";
import { measureFrame } from "./frame.js";
import { Environment } from "./environment.js";
import { pickQuality, pixelRatio } from "./quality.js";
import { requirements, SYSTEMS } from "./systems.js";

// Masks and fields are data, not colour: decoded exactly as stored.
const loadData = async (url) => {
  const res = await fetch(new URL(url, document.baseURI));
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

// Seconds for motion to fade in.
const FADE_IN = 3.5;

export class LandscapeScene {
  // still: switch the systems on but keep them at rest (for checking that
  // a scene at rest is the painting).
  constructor(root, manifest, { systems = [], debugView = 0, probe = null, still = false } = {}) {
    this.root = root;
    this.img = root.querySelector("img");
    this.manifest = manifest;
    this.environment = new Environment();
    this.systems = [];
    this.defines = [];
    // The moving systems' Motions, by id.
    this.motions = new Map();
    this.still = still;
    // How much of their motion is shown, 0 to 1, and how much the frame on
    // screen shows.
    this.presence = 0;
    this.drawnMotion = 0;
    this.debugView = debugView;
    this.probe = probe;
    this.initialSystems = systems;
    this.frame = null;
    this.live = false;
    this.dirty = false;
    this.disposed = false;
    this.raf = 0;
    this.last = 0;
    this.visible = !document.hidden;
    this.onScreen = true;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    this.cleanups = [];
    // How the painting looks onto the sea, for every view that draws it.
    const sea = manifest.sea;
    this.layout = {
      uSeaView: new Float32Array([sea.horizon, sea.centre, sea.focal, sea.eye]),
      uSeaStretch: sea.stretch,
      uShoreReach: sea.shoreReach,
    };
  }

  // Resolves true once the canvas is showing the painting, false if it
  // cannot (no WebGL2, no image), in which case the page is left as it was.
  async start() {
    const canvas = document.createElement("canvas");
    canvas.className = "scene";
    canvas.setAttribute("aria-hidden", "true");
    const renderer = Renderer.create(canvas);
    if (!renderer) return false;
    this.canvas = canvas;
    this.renderer = renderer;
    this.quality = pickQuality(renderer.gl);
    // Right over the <img>, under the sky's tints, stars and sun.
    this.img.after(canvas);
    try {
      await this.#loadPainting();
      await this.setSystems(this.initialSystems);
      if (this.disposed) return false;
      this.#observe();
      this.#measure(this.root.clientWidth, this.root.clientHeight);
      this.#draw();
      this.#show(true);
      this.#schedule();
      return true;
    } catch (err) {
      console.warn("Landscape stays a still image:", err);
      this.dispose();
      return false;
    }
  }

  // Switches systems on or off by name (see systems.js). Their layers load
  // first and the new program compiles off the main thread where it can;
  // the scene keeps drawing as it was until both are ready.
  async setSystems(ids) {
    ids = ids.filter((id) => SYSTEMS[id]);
    const { textures, defines } = requirements(ids);
    const needed = this.debugView ? Object.keys(this.manifest.textures) : textures;
    await Promise.all(needed.filter((t) => !this.renderer.hasTexture(t)).map((t) => this.#loadLayer(t)));
    if (this.disposed) return;
    // Layers nothing uses any more give their memory back.
    for (const name of [...this.renderer.textures.keys()]) {
      if (name !== "painting" && !needed.includes(name)) this.renderer.deleteTexture(name);
    }
    while (!this.renderer.program(defines, this.debugView)) {
      await nextFrame();
      if (this.disposed) return;
    }
    for (const id of [...this.motions.keys()]) if (!ids.includes(id)) this.motions.delete(id);
    for (const id of ids) {
      const { Motion } = SYSTEMS[id];
      if (Motion && !this.motions.has(id)) this.motions.set(id, new Motion(this.environment.options.seed, this.manifest));
    }
    this.systems = ids;
    this.defines = defines;
    this.invalidate();
  }

  // Asks for one more frame; the loop keeps itself going while it is needed.
  invalidate() {
    this.dirty = true;
    this.#schedule();
  }

  // How the scene is set up right now, for the console.
  describe() {
    const r = this.renderer;
    return {
      live: this.live,
      systems: this.systems,
      animating: this.#animating(),
      presence: +this.presence.toFixed(3),
      quality: this.quality?.tier,
      canvas: r ? [r.canvas.width, r.canvas.height] : null,
      textureMB: r ? +(r.textureBytes() / 1048576).toFixed(1) : 0,
      frame: this.frame,
      environment: { time: this.environment.time, ...this.environment.wind, activity: this.environment.activity },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cleanups.forEach((f) => f());
    this.cleanups = [];
    this.#show(false);
    this.renderer?.dispose();
    this.canvas?.remove();
  }

  #animating() {
    return this.live && this.motions.size > 0 && !this.still && !this.reducedMotion.matches && this.visible && this.onScreen;
  }

  #schedule() {
    if (!this.raf && this.live && !this.disposed) this.raf = requestAnimationFrame(this.#tick);
  }

  #tick = (now) => {
    this.raf = 0;
    if (this.disposed || this.renderer.lost) return;
    const animating = this.#animating();
    if (animating) {
      // Hold to the quality tier's frame rate.
      if (this.last && !this.dirty && now - this.last < 1000 / this.quality.fps - 2) {
        this.raf = requestAnimationFrame(this.#tick);
        return;
      }
      const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
      this.environment.step(dt);
      for (const m of this.motions.values()) m.step(dt, this.environment);
      this.presence = Math.min(1, this.presence + dt / FADE_IN);
      this.last = now;
    } else {
      this.last = 0;
      // Motion was just turned off: the last frame still shows it, so put
      // the painting back, whether or not the media query's event comes.
      if (this.drawnMotion > 0 && this.reducedMotion.matches) this.dirty = true;
    }
    if (animating || this.dirty) this.#draw();
    if (animating) this.raf = requestAnimationFrame(this.#tick);
  };

  #draw() {
    this.dirty = false;
    const entry = this.renderer.program(this.defines, this.debugView);
    if (!entry || !this.frame) return;
    const [rx, ry] = this.ratio;
    // Eased, so the fade-in neither starts nor ends with a jolt.
    const p = this.still || this.reducedMotion.matches ? 0 : this.presence;
    const motion = p * p * (3 - 2 * p);
    this.drawnMotion = motion;
    // The page's own day and night (main.js): no sun glints after dark.
    const night = parseFloat(this.root.style.getPropertyValue("--night")) || 0;
    const uniforms = { ...this.layout };
    for (const m of this.motions.values()) Object.assign(uniforms, m.uniforms(motion, 1 - night));
    this.renderer.draw(entry, {
      map: this.frame.deviceToUv(rx, ry, this.canvas.height, window.devicePixelRatio || 1),
      source: this.manifest.source,
      env: this.environment,
      probe: this.probe || undefined,
      uniforms,
    });
  }

  // Fits the drawing buffer to the banner, in whole device pixels where the
  // browser says exactly how many there are. Those pixels then sit on the
  // screen's own grid, one CSS pixel per devicePixelRatio of them, however
  // the banner's fractional height was rounded; anything else is scaled to
  // fit by the compositor.
  #measure(cssWidth, cssHeight, deviceWidth, deviceHeight) {
    if (!cssWidth || !cssHeight) return;
    const dpr = window.devicePixelRatio || 1;
    const ratio = pixelRatio(this.quality, cssWidth, cssHeight);
    const exact = deviceWidth && ratio === dpr;
    const w = exact ? deviceWidth : Math.max(1, Math.round(cssWidth * ratio));
    const h = exact ? deviceHeight : Math.max(1, Math.round(cssHeight * ratio));
    this.renderer.resize(w, h);
    // Device pixels are square, so the width (a whole number of CSS pixels
    // nearly always) gives the ratio for both axes; it is the screen's own
    // unless the browser says otherwise, as device emulation can.
    const r = w / cssWidth;
    this.ratio = exact && Math.abs(r - dpr) < dpr * 0.01 ? [dpr, dpr] : exact ? [r, r] : [r, h / cssHeight];
    this.frame = measureFrame(this.img, this.manifest.source, cssWidth, cssHeight);
  }

  #show(on) {
    this.live = on;
    this.canvas?.classList.toggle("is-live", on);
  }

  async #loadPainting() {
    // The <img> already has the picture, at the size srcset picked for this
    // screen; the canvas draws that same file.
    await this.img.decode();
    const bitmap = await createImageBitmap(this.img);
    if (this.disposed) return bitmap.close();
    this.renderer.setTexture("painting", bitmap);
    bitmap.close();
  }

  async #loadLayer(name) {
    const spec = this.manifest.textures[name];
    const bitmap = await loadData(spec.url);
    if (this.disposed || this.renderer.lost) return bitmap.close();
    this.renderer.setTexture(name, bitmap, { filter: spec.filter, channels: spec.format === "r" ? 1 : 4 });
    bitmap.close();
  }

  #observe() {
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn, opts));
    };

    // Resizing clears the drawing buffer, so the new frame is drawn right
    // here, before the browser paints, not on the next animation frame.
    const resized = new ResizeObserver(([entry]) => {
      const css = entry.contentBoxSize?.[0];
      const dev = entry.devicePixelContentBoxSize?.[0];
      this.#measure(css?.inlineSize ?? this.root.clientWidth, css?.blockSize ?? this.root.clientHeight,
        dev?.inlineSize, dev?.blockSize);
      if (this.live) this.#draw();
    });
    try {
      resized.observe(this.canvas, { box: "device-pixel-content-box" });
    } catch {
      resized.observe(this.canvas);
    }
    this.cleanups.push(() => resized.disconnect());

    // Moving to a screen with another pixel density, or zooming, without
    // the banner changing size in CSS pixels.
    const watchRatio = () => {
      const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      const changed = () => {
        mq.removeEventListener("change", changed);
        this.#measure(this.root.clientWidth, this.root.clientHeight);
        if (this.live) this.#draw();
        if (!this.disposed) watchRatio();
      };
      mq.addEventListener("change", changed);
      this.cleanups.push(() => mq.removeEventListener("change", changed));
    };
    watchRatio();

    const seen = new IntersectionObserver(([e]) => {
      this.onScreen = e.isIntersecting;
      this.#schedule();
    });
    seen.observe(this.root);
    this.cleanups.push(() => seen.disconnect());

    on(document, "visibilitychange", () => {
      this.visible = !document.hidden;
      // Time stands still while nobody is looking.
      this.last = 0;
      this.#schedule();
    });
    on(this.reducedMotion, "change", () => {
      // Back from reduced motion, the sea and the trees fade in again.
      this.presence = 0;
      this.invalidate();
    });

    // srcset swaps in the larger picture when the window grows.
    on(this.img, "load", () => {
      this.#loadPainting().then(() => this.invalidate(), (err) => console.warn(err));
    });

    // If the GPU resets, the <img> shows until everything is rebuilt.
    on(this.canvas, "webglcontextlost", (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.#show(false);
    });
    on(this.canvas, "webglcontextrestored", async () => {
      this.renderer.forgetResources();
      try {
        await this.#loadPainting();
        const ids = this.systems;
        this.systems = [];
        await this.setSystems(ids);
        this.#measure(this.root.clientWidth, this.root.clientHeight);
        this.#draw();
        this.#show(true);
        this.#schedule();
      } catch (err) {
        console.warn("Landscape stays a still image:", err);
      }
    });
  }
}
