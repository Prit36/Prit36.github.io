// The GPU side: one WebGL2 context, the textures the scene has asked for,
// and a program per combination of switched-on systems. Knows nothing about
// the page; scene.js decides what to draw and when.

import { VERTEX, fragmentSource } from "./shaders.js";

const CONTEXT = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
};

const UNITS = { painting: 0, mattes: 1, fields: 2, groups: 3, plate: 4, leaves: 5, waterUnder: 6, skyUnder: 7 };
const SAMPLERS = { painting: "uPainting", mattes: "uMattes", fields: "uFields", groups: "uGroups", plate: "uPlate", leaves: "uLeaves",
  waterUnder: "uWaterUnder", skyUnder: "uSkyUnder" };

export class Renderer {
  static create(canvas) {
    const gl = canvas.getContext("webgl2", CONTEXT);
    return gl ? new Renderer(canvas, gl) : null;
  }

  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
    this.textures = new Map();
    this.programs = new Map();
    this.vao = gl.createVertexArray();
    this.envData = new Float32Array(8);
  }

  get lost() {
    return this.gl.isContextLost();
  }

  // Sets the drawing buffer's size; a resize clears it, so the caller draws
  // again before the next paint.
  resize(width, height) {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  // Uploads an image as a texture. Colour is converted as the browser
  // converts the <img>; data layers (masks, fields) were decoded with no
  // conversion and are uploaded as they are. No mipmaps: the painting has to
  // be read exactly as the browser reads the <img>, and the layers exactly
  // as the painting.
  setTexture(name, source, { filter = "linear", channels = 4 } = {}) {
    const gl = this.gl;
    this.deleteTexture(name);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const single = channels === 1;
    gl.texImage2D(gl.TEXTURE_2D, 0, single ? gl.R8 : gl.RGBA8, single ? gl.RED : gl.RGBA, gl.UNSIGNED_BYTE, source);
    const mode = filter === "nearest" ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mode);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mode);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const bytes = source.width * source.height * (single ? 1 : 4);
    this.textures.set(name, { tex, bytes, width: source.width, height: source.height });
  }

  hasTexture(name) {
    return this.textures.has(name);
  }

  deleteTexture(name) {
    const t = this.textures.get(name);
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.textures.delete(name);
  }

  // GPU memory held by textures, in bytes. The drawing buffer is extra.
  textureBytes() {
    let sum = 0;
    for (const t of this.textures.values()) sum += t.bytes;
    return sum;
  }

  // A program for these systems (and debug view), compiled once. Returns
  // null while it is still compiling off the main thread, if the driver
  // can; the caller keeps drawing with what it had.
  program(defines, debugView = 0) {
    const key = `${defines.join(",")}|${debugView}`;
    let entry = this.programs.get(key);
    if (!entry) {
      entry = this.#compile(fragmentSource(defines, debugView));
      this.programs.set(key, entry);
    }
    if (!entry.linked) {
      const gl = this.gl;
      if (this.parallel && !gl.getProgramParameter(entry.program, this.parallel.COMPLETION_STATUS_KHR)) return null;
      if (!gl.getProgramParameter(entry.program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(entry.program) || gl.getShaderInfoLog(entry.fs);
        throw new Error(`Landscape shader failed: ${log}`);
      }
      entry.linked = true;
      entry.uniforms = this.#locations(entry.program);
    }
    return entry;
  }

  // Draws one frame. `map` is Frame.deviceToUv; `probe` shifts each region
  // by a fixed number of painting pixels (zero outside the probe view).
  draw(entry, { map, source, env, probe = [0, 0, 0] }) {
    const gl = this.gl;
    const u = entry.uniforms;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(entry.program);
    gl.bindVertexArray(this.vao);
    for (const [name, unit] of Object.entries(UNITS)) {
      const loc = u[SAMPLERS[name]];
      const t = this.textures.get(name);
      if (!loc || !t) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(loc, unit);
    }
    gl.uniform4fv(u.uMap, map);
    gl.uniform2f(u.uSource, source.width, source.height);
    if (u.uEnv) gl.uniform4fv(u.uEnv, env.writeUniforms(this.envData));
    if (u.uProbe) gl.uniform3fv(u.uProbe, probe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const gl = this.gl;
    for (const name of [...this.textures.keys()]) this.deleteTexture(name);
    for (const e of this.programs.values()) {
      gl.deleteProgram(e.program);
      gl.deleteShader(e.vs);
      gl.deleteShader(e.fs);
    }
    this.programs.clear();
    gl.deleteVertexArray(this.vao);
    // Hand the context back now rather than whenever it is collected.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  // After a lost context comes back, every GPU object is gone, extensions
  // included.
  forgetResources() {
    this.textures.clear();
    this.programs.clear();
    this.parallel = this.gl.getExtension("KHR_parallel_shader_compile");
    this.vao = this.gl.createVertexArray();
  }

  #compile(fragment) {
    const gl = this.gl;
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, VERTEX);
    const fs = shader(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    return { program, vs, fs, linked: false, uniforms: null };
  }

  #locations(program) {
    const gl = this.gl;
    const out = {};
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(program, i).name.replace(/\[0\]$/, "");
      out[name] = gl.getUniformLocation(program, name);
    }
    return out;
  }
}
