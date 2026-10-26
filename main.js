(() => {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = motion.matches;

  const make = (tag, className = "", text = "") => {
    const e = document.createElement(tag);
    e.className = className;
    e.textContent = text;
    return e;
  };

  // Lights. The page follows the system until the switch is flipped, and the
  // new theme spreads out from the switch. Flipping back to what the system
  // wants hands control back to the system.

  const root = document.documentElement;
  const lightsBtn = document.getElementById("lights");
  const darkScheme = matchMedia("(prefers-color-scheme: dark)");
  const themeMetas = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => [m, m.content]);
  const isDark = () => (root.dataset.theme || (darkScheme.matches ? "dark" : "light")) === "dark";
  const syncLights = () => {
    const dark = isDark();
    lightsBtn.classList.toggle("is-dark", dark);
    lightsBtn.setAttribute("aria-label", dark ? "Turn the lights on" : "Turn the lights off");
    const forced = root.dataset.theme;
    themeMetas.forEach(([m, c]) => { m.content = forced ? (dark ? "#131312" : "#f4f3ef") : c; });
  };
  const setTheme = (dark, from = lightsBtn) => {
    const apply = () => {
      if (dark === darkScheme.matches) delete root.dataset.theme;
      else root.dataset.theme = dark ? "dark" : "light";
      try {
        if (root.dataset.theme) localStorage.setItem("theme", root.dataset.theme);
        else localStorage.removeItem("theme");
      } catch {
        // Private windows can refuse storage; the switch still works for this visit.
      }
      syncLights();
    };
    // Every colour on the page changes at once, so the page's own colour
    // transitions are held off until the switch is done; only the icon moves.
    // The hold goes on with the new colours, in the same style pass.
    const switchTo = () => { root.classList.add("is-theming"); apply(); };
    const settle = () => root.classList.remove("is-theming");
    if (reduced || !document.startViewTransition || document.hidden) {
      switchTo();
      requestAnimationFrame(() => requestAnimationFrame(settle));
      return;
    }
    const b = from.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const switching = document.startViewTransition(switchTo);
    switching.ready.then(() => {
      root.animate({ clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 700, easing: "cubic-bezier(0.6, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" });
    }).catch(() => {});
    switching.finished.then(settle, settle);
  };
  const toggleTheme = (from) => setTheme(!isDark(), from);
  lightsBtn.addEventListener("click", () => toggleTheme(lightsBtn));
  darkScheme.addEventListener("change", syncLights);
  syncLights();

  // The painting keeps Surat's hours. The real height of the sun over Surat
  // sets the light: gold near the horizon, then dusk, the stars, the moon in
  // tonight's phase, lit windows and the lighthouse at work. The sun (or the
  // moon) is in the sky too, and it can be picked up and dragged to another hour.

  const landscape = document.querySelector(".landscape");
  const bannerImg = landscape.querySelector("img");
  const skyNote = document.getElementById("sky-note");
  const sky = make("div", "sky");
  sky.innerHTML = `
    <div class="tint dusk"></div><div class="tint gold"></div><div class="tint ember"></div>
    <div class="stars"></div>
    <div class="windows"></div>
    <canvas class="glow"></canvas>
    <div class="orbs">
      <span class="orb sun"></span>
      <svg class="orb moon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path/></svg>
    </div>
    <span class="orb-ring"></span>
    <span class="orb-tag mono"></span>`;
  bannerImg.after(sky);
  const sunEl = sky.querySelector(".sun");
  const moonEl = sky.querySelector(".moon");
  const orbsEl = sky.querySelector(".orbs");
  const moonLit = moonEl.querySelector("path");
  const ring = sky.querySelector(".orb-ring");
  const tag = sky.querySelector(".orb-tag");
  const glow = sky.querySelector(".glow");
  const pen = glow.getContext("2d");
  // What only changes with the hour or the size of the banner, the soft light
  // on the water and the dotted path, is drawn once into these and copied
  // onto the glow each frame. Each holds memory only while it has something
  // to show.
  const layer = () => document.createElement("canvas").getContext("2d");
  const water = layer(), trail = layer();
  let waterDirty = true, trailDirty = true;
  const fit = (c, w, h) => { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } };
  // Writing a style that hasn't changed still costs a style pass.
  const setVar = (el, name, value) => {
    if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
  };
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  // The same stars every night, and the same glints on the water.
  let seed = 36;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const stars = sky.querySelector(".stars");
  for (let i = 0; i < 110; i++) {
    const s = make("i", rand() < 0.1 ? "big" : "");
    s.style.cssText = `left:${(rand() * 100).toFixed(2)}%;top:${(rand() * 96).toFixed(2)}%;`
      + `--o:${(0.3 + rand() * 0.7).toFixed(2)};--d:${(1.8 + rand() * 4).toFixed(2)}s;animation-delay:${(-rand() * 6).toFixed(2)}s`;
    stars.append(s);
  }
  const shooting = make("b", "shoot");
  const aimShot = () => {
    shooting.style.left = `${(5 + Math.random() * 70).toFixed(1)}%`;
    shooting.style.top = `${(Math.random() * 35).toFixed(1)}%`;
  };
  aimShot();
  shooting.addEventListener("animationiteration", aimShot);
  stars.append(shooting);
  const GLINTS = Array.from({ length: 360 }, () => ({
    row: rand(), off: (rand() + rand() + rand() - 1.5) * 1.5, len: rand(), ph: rand() * 6.283, sp: 1.1 + rand() * 3.2,
  }));

  // Points in the 2172 × 724 painting: the lighthouse lamp, the horizon, the
  // windows of the village on the right, and the far towns.
  const PAINTING = [2172, 724];
  const LAMP = [1164, 329];
  const HORIZON = 374;
  const WINDOWS = [
    [2012, 281], [2038, 281], [2067, 281], [2012, 311], [2040, 311], [2017, 226],
    [1850, 325], [1875, 325], [1905, 325], [1850, 355],
    [1915, 361], [1950, 361], [1985, 361], [1945, 390],
    [1650, 371], [1695, 376], [1356, 376], [1384, 381],
  ];
  const TOWNS = [[700, 352], [742, 349], [790, 347], [836, 345], [893, 348], [957, 354], [1560, 358], [1618, 362], [1460, 356]];
  // The open sea, traced round the headland, the beach and the rocks, as
  // fractions of the painting. Reflections stay inside it.
  const SEA = [[0, 0.515], [0.465, 0.515], [0.465, 0.575], [0.5, 0.585], [0.74, 0.585], [0.8, 0.62],
    [0.87, 0.67], [0.88, 0.72], [0.84, 0.78], [0.79, 0.82], [0.78, 1], [0, 1]];
  // The skyline: the open horizon on the left, then the islands, the hills
  // and the mountains behind the village. Stars, sun and moon stay above it.
  const SKYLINE = [[0, 375], [95, 375], [105, 369], [118, 375], [140, 373], [160, 355], [175, 347], [195, 352],
    [235, 372], [250, 366], [285, 362], [300, 356], [320, 364], [345, 350], [375, 343], [400, 326], [440, 315],
    [470, 318], [520, 300], [575, 284], [610, 293], [638, 297], [665, 282], [710, 280], [798, 282], [847, 271],
    [902, 242], [935, 244], [979, 235], [1023, 244], [1060, 236], [1100, 224], [1162, 214], [1218, 229],
    [1291, 252], [1347, 246], [1397, 232], [1442, 246], [1498, 241], [1538, 224], [1582, 221], [1638, 224],
    [1694, 213], [1779, 204], [1857, 183], [1902, 176], [1947, 187], [1990, 193], [2003, 178], [2012, 192],
    [2050, 196], [2095, 190], [2112, 138], [2128, 190], [2140, 165], [2150, 195], [2172, 176]];
  // The sun and moon set into the open sea on the left and rise from behind
  // the hills, along this stretch of the painting.
  const ARC = [70, 820];
  const windowsEl = sky.querySelector(".windows");
  const lights = [...WINDOWS, ...TOWNS].map((p, i) => {
    const e = make("i", i >= WINDOWS.length ? "far" : "");
    e.style.setProperty("--t", `${(-rand() * 11).toFixed(2)}s`);
    windowsEl.append(e);
    return [e, p];
  });

  // Where a point of the painting lands, given object-fit: cover.
  let geo = null, sea = null, ridge = null, skyState = null;
  const at = ([x, y]) => [geo.ox + x * geo.s, geo.oy + y * geo.s];
  const placeSky = () => {
    const W = landscape.clientWidth, H = landscape.clientHeight;
    if (!W || !H) return;
    const s = Math.max(W / PAINTING[0], H / PAINTING[1]);
    const [fx, fy] = getComputedStyle(bannerImg).objectPosition.split(" ").map((v) => parseFloat(v) / 100);
    const ox = (W - PAINTING[0] * s) * fx, oy = (H - PAINTING[1] * s) * fy;
    const horizon = Math.max(0, oy + HORIZON * s);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const orb = Math.round(Math.max(12, Math.min(34, horizon * 0.34)));
    // The water layer starts just above the horizon, the path layer stops
    // just below it, both in device pixels.
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    const waterTop = Math.max(0, Math.min(ch - 1, Math.floor(horizon * dpr) - 4));
    geo = { W, H, s, ox, oy, horizon, dpr, orb, waterTop };
    geo.trailH = Math.min(ch, Math.ceil((horizon * 1.05 + 6) * dpr));
    fit(glow, cw, ch);
    waterDirty = trailDirty = true;
    setVar(landscape, "--s", s.toFixed(4));
    setVar(landscape, "--horizon", `${horizon.toFixed(1)}px`);
    setVar(landscape, "--orb", `${orb}px`);
    sea = new Path2D();
    SEA.forEach(([u, v], i) => {
      const [x, y] = at([u * PAINTING[0], v * PAINTING[1]]);
      if (i) sea.lineTo(x, y); else sea.moveTo(x, y);
    });
    sea.closePath();
    ridge = SKYLINE.map(at);
    const above = `path("M${ridge.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}`
      + `L${ridge.at(-1)[0].toFixed(1)} -99L${ridge[0][0].toFixed(1)} -99Z")`;
    orbsEl.style.clipPath = stars.style.clipPath = above;
    lights.forEach(([e, p]) => {
      const [x, y] = at(p);
      e.style.left = `${x.toFixed(1)}px`;
      e.style.top = `${y.toFixed(1)}px`;
    });
    geo.arc = arcEnds();
    if (skyState) layoutSky();
  };
  const skyObserver = new ResizeObserver(placeSky);
  skyObserver.observe(landscape);

  // The sun over Surat: its altitude, and its hour angle (0 at solar noon),
  // both in degrees. Close enough to light a painting.
  const RAD = Math.PI / 180;
  const SURAT = { lat: 21.17 * RAD, lon: 72.83 };
  const sunAt = (t) => {
    const n = (t - Date.UTC(new Date(t).getUTCFullYear(), 0, 0)) / 864e5;
    const decl = -23.44 * RAD * Math.cos((2 * Math.PI / 365) * (n + 10));
    const b = (2 * Math.PI * (n - 81)) / 364;
    const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
    const solar = ((t / 6e4) % 1440) + SURAT.lon * 4 + eot;
    const hour = solar / 4 - 180;
    const alt = Math.asin(Math.sin(SURAT.lat) * Math.sin(decl)
      + Math.cos(SURAT.lat) * Math.cos(decl) * Math.cos(hour * RAD)) / RAD;
    return { alt, hour: ((((hour + 180) % 360) + 360) % 360) - 180 };
  };
  // The moon keeps the opposite side of the sky, the way a full one does.
  const moonOf = ({ alt, hour }) => ({ alt: -alt, hour: ((hour + 360) % 360) - 180 });
  // 0 is a new moon, 0.5 a full one.
  const phaseAt = (t) => ((((t - Date.UTC(2000, 0, 6, 18, 14)) / 864e5 / 29.530588853) % 1) + 1) % 1;
  const PHASES = ["new moon", "waxing crescent", "first quarter", "waxing gibbous",
    "full moon", "waning gibbous", "last quarter", "waning crescent"];
  // The lit limb is a half circle; the terminator is half an ellipse.
  const moonPath = (p) => {
    const k = Math.cos(2 * Math.PI * p);
    const waxing = p < 0.5;
    return `M12 2A10 10 0 0 ${waxing ? 1 : 0} 12 22A${(Math.abs(k) * 10).toFixed(2)} 10 0 0 ${(k > 0) !== waxing ? 1 : 0} 12 2Z`;
  };
  const smooth = (a, b, x) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

  // Where the sun or moon sits in the banner. It rises from behind the hills
  // in the morning and sets into the open sea on the left in the evening.
  // Its height is measured from the sea horizon, so the hills hide it while
  // it is low over them; at its highest it stays just inside the banner.
  // A wide, short banner shows only a strip of sky over the left of the
  // painting, so there the arc closes in to where the hills leave room for
  // the whole body.
  const arcEnds = () => {
    const open = ridge.find(([, y]) => y < geo.orb * 1.1);
    const rise = Math.min(geo.ox + ARC[1] * geo.s, open ? open[0] + geo.orb * 2 : Infinity);
    return [Math.max(geo.ox + ARC[0] * geo.s, geo.orb * 1.2), rise];
  };
  const bodySpan = () => { const [a, b] = geo.arc; return (b - a) / 2; };
  const bodyAt = ({ hour, alt }) => {
    const [a, b] = geo.arc;
    const top = Math.max(geo.oy + 70 * geo.s, geo.orb * 0.95);
    const k = alt >= 0 ? Math.sin((Math.min(1, alt / 50) * Math.PI) / 2) : alt / 12;
    return [(a + b) / 2 - (hour / 95) * (b - a) / 2, geo.horizon - k * Math.max(0, geo.horizon - top)];
  };
  // The height of the skyline at x, and how much of a body at (x, y) shows
  // above it.
  const ridgeAt = (x) => {
    let i = 1;
    while (i < ridge.length - 1 && ridge[i][0] < x) i++;
    const [[x0, y0], [x1, y1]] = [ridge[i - 1], ridge[i]];
    return y0 + (y1 - y0) * Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  };
  const shows = ([x, y]) => smooth(geo.orb * 0.45, -geo.orb * 0.45, y - ridgeAt(x));

  const paintSky = (t) => {
    const sun = sunAt(t);
    const { alt } = sun;
    const night = smooth(4, -9, alt);
    const gold = Math.exp(-(((alt - 2.5) / 6.5) ** 2));
    const phase = phaseAt(t);
    setVar(landscape, "--night", night.toFixed(3));
    setVar(landscape, "--gold", gold.toFixed(3));
    landscape.classList.toggle("is-night", night > 0.02);
    landscape.classList.toggle("is-gold", gold > 0.01);
    const lit = moonPath(phase);
    if (lit !== moonLit.getAttribute("d")) moonLit.setAttribute("d", lit);
    skyState = {
      t, sun, night, gold, phase,
      lit: (1 - Math.cos(2 * Math.PI * phase)) / 2,
      isSun: alt > -1,
      sunVis: smooth(-3, 1, alt),
      moonVis: smooth(1, -5, alt),
    };
    if (geo) layoutSky();
    const said = `sun ${alt < 0 ? "−" : ""}${Math.abs(Math.round(alt))}°`;
    return night > 0.4 ? `${said} · ${PHASES[Math.round(phase * 8) % 8]}` : said;
  };

  const layoutSky = () => {
    const st = skyState;
    st.sunAt = bodyAt(st.sun);
    st.moonAt = bodyAt(moonOf(st.sun));
    const [r, g, b] = mix([255, 238, 190], [255, 140, 60], st.gold);
    setVar(sunEl, "--sun", `rgb(${r} ${g} ${b})`);
    setVar(sunEl, "--sun-halo", `rgb(${r} ${g} ${b} / ${(0.35 + 0.3 * st.gold).toFixed(2)})`);
    // A body below the horizon isn't painted at all, glow and shadow included.
    sunEl.style.visibility = st.sunVis > 0.001 ? "" : "hidden";
    sunEl.style.transform = `translate(${st.sunAt[0].toFixed(1)}px, ${st.sunAt[1].toFixed(1)}px)`;
    sunEl.style.opacity = st.sunVis.toFixed(3);
    moonEl.style.visibility = st.moonVis > 0.001 ? "" : "hidden";
    moonEl.style.transform = `translate(${st.moonAt[0].toFixed(1)}px, ${st.moonAt[1].toFixed(1)}px)`;
    moonEl.style.opacity = st.moonVis.toFixed(3);

    // The ring and the label follow whichever one is up.
    const [x, y] = st.isSun ? st.sunAt : st.moonAt;
    ring.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const side = x > geo.W * 0.62 ? `calc(${(x - geo.orb).toFixed(1)}px - 100%)` : `${(x + geo.orb).toFixed(1)}px`;
    tag.style.transform = `translate(${side}, calc(${Math.max(y, geo.orb * 0.6).toFixed(1)}px - 50%))`;

    // Hidden behind the hills, a body lights no path on the water.
    st.sunShine = st.sunVis * shows(st.sunAt) * (0.18 + 0.82 * (1 - smooth(4, 32, st.sun.alt)) + 0.6 * st.gold);
    st.moonShine = st.moonVis * shows(st.moonAt) * st.night * (0.3 + 0.7 * st.lit);
    st.sunRgb = mix([255, 246, 225], [255, 170, 90], st.gold).join(",");
    waterDirty = trailDirty = true;
    wakeSky();
  };

  // Light on the water: a path from the horizon straight down to you under
  // the sun or moon, narrow where it meets the horizon and wider close by,
  // made of a soft glow and glints that flicker on the swell. The higher the
  // body, the wider and the more its light gathers near you.
  const reach = (alt) => {
    const high = Math.sin(Math.min(80, Math.max(0, alt)) * RAD);
    return [high, geo.orb * (0.22 + 0.35 * high), geo.orb * (0.9 + 1.8 * high)];
  };
  // The soft glow holds still, so it goes on the water layer.
  const sheen = (bx, alt, rgb, strength) => {
    const { H, horizon, orb } = geo;
    const depth = H - horizon;
    if (depth < 2) return;
    const [high, w0, w1] = reach(alt);
    const rows = 18;
    for (let i = 0; i < rows; i++) {
      const d = i / rows, w = w0 + (w1 - w0) * d;
      const a = 0.3 * strength * (1 - 0.75 * high * (1 - d)) * (1 - 0.35 * d);
      const band = water.createLinearGradient(bx - w, 0, bx + w, 0);
      band.addColorStop(0, `rgba(${rgb},0)`);
      band.addColorStop(0.5, `rgba(${rgb},${Math.min(0.5, a).toFixed(3)})`);
      band.addColorStop(1, `rgba(${rgb},0)`);
      water.fillStyle = band;
      water.fillRect(bx - w, horizon + d * depth, w * 2, depth / rows + 0.5);
    }
    // Where the path meets the horizon, a low body burns brightest.
    const spot = orb * 0.9;
    water.save();
    water.translate(bx, horizon);
    water.scale(1, 0.3);
    const meet = water.createRadialGradient(0, 0, 0, 0, 0, spot);
    meet.addColorStop(0, `rgba(${rgb},${(0.7 * strength * (1 - high)).toFixed(3)})`);
    meet.addColorStop(1, `rgba(${rgb},0)`);
    water.fillStyle = meet;
    water.fillRect(-spot, -spot, spot * 2, spot * 2);
    water.restore();
  };
  // The glints flicker, so they are drawn every frame: one colour, with only
  // the alpha changing from glint to glint.
  const glints = (bx, alt, rgb, strength, time) => {
    const { H, horizon, s } = geo;
    const depth = H - horizon;
    if (depth < 2) return;
    const [, w0, w1] = reach(alt);
    const scale = Math.max(0.7, s * 1.4);
    pen.fillStyle = `rgb(${rgb})`;
    for (const p of GLINTS) {
      const flick = Math.max(0, Math.sin(time * p.sp + p.ph));
      if (flick < 0.12) continue; // too dim to see whatever the strength
      const d = p.row ** 1.3;
      const u = p.off * 0.5;
      const a = 1.6 * strength * flick * flick * Math.exp(-u * u * 2.4) * (0.55 + 0.45 * d);
      if (a < 0.04) continue;
      const y = horizon + 0.5 + d * depth;
      const w = w0 + (w1 - w0) * d;
      const x = bx + u * w + Math.sin(time * 0.7 + p.ph + y * 0.2) * w * 0.08;
      const len = (1.5 + p.len * 5) * (0.5 + d * 1.5) * scale * (1 - 0.5 * Math.abs(u));
      pen.globalAlpha = Math.min(1, a);
      pen.fillRect(x - len / 2, y, len, 0.8 + d);
    }
    pen.globalAlpha = 1;
  };
  const paintWater = () => {
    const st = skyState, { dpr, waterTop } = geo;
    waterDirty = false;
    if (st.sunShine <= 0.02 && st.moonShine <= 0.02) return fit(water.canvas, 0, 0);
    fit(water.canvas, glow.width, glow.height - waterTop);
    water.setTransform(1, 0, 0, 1, 0, 0);
    water.clearRect(0, 0, water.canvas.width, water.canvas.height);
    water.setTransform(dpr, 0, 0, dpr, 0, -waterTop);
    water.save();
    water.clip(sea);
    water.globalCompositeOperation = "lighter";
    if (st.sunShine > 0.02) sheen(st.sunAt[0], st.sun.alt, st.sunRgb, st.sunShine);
    if (st.moonShine > 0.02) sheen(st.moonAt[0], -st.sun.alt, "236,238,255", st.moonShine);
    water.restore();
  };

  // The path of the sun or moon through this part of the day, dotted: done in
  // faint dots, still to come in bright ones. Only worked out when shown.
  const paintTrail = () => {
    const st = skyState, { dpr, orb } = geo;
    trailDirty = false;
    const [x, y] = st.isSun ? st.sunAt : st.moonAt;
    const past = new Path2D(), ahead = new Path2D();
    for (let m = -12 * 60; m <= 12 * 60; m += 9) {
      const p = sunAt(st.t + m * 6e4);
      const q = st.isSun ? p : moonOf(p);
      if (q.alt < -0.5) continue;
      const [px, py] = bodyAt(q);
      if (Math.hypot(px - x, py - y) < orb * 0.85) continue;
      const path = m < 0 ? past : ahead;
      path.moveTo(px + 1.1, py);
      path.arc(px, py, 1.1, 0, 2 * Math.PI);
    }
    fit(trail.canvas, glow.width, geo.trailH);
    trail.setTransform(1, 0, 0, 1, 0, 0);
    trail.clearRect(0, 0, trail.canvas.width, trail.canvas.height);
    trail.setTransform(dpr, 0, 0, dpr, 0, 0);
    trail.shadowColor = "rgba(8,14,32,0.6)";
    trail.shadowBlur = 3;
    trail.fillStyle = "rgba(255,255,255,0.55)";
    trail.fill(past);
    trail.fillStyle = "rgba(255,255,255,0.92)";
    trail.fill(ahead);
  };

  // The lighthouse, seen from the side. Its beam turns round a vertical
  // axis: long when it points sideways, short, wide and blinding when it
  // points at you, faint when it points away behind the tower.
  const BEAM_PERIOD = 9;
  const lighthouse = (time, strength) => {
    const { s, W, horizon } = geo;
    const [lx, ly] = at(LAMP);
    const turn = (time / BEAM_PERIOD) * 2 * Math.PI;
    const side = Math.cos(turn), toward = Math.sin(turn);
    const facing = Math.max(0, toward);
    const power = strength * (0.18 + 0.82 * smooth(-0.35, 1, toward));
    const ex = lx + side * s * 1100;
    const ey = ly + s * (5 + 70 * facing);
    const dx = ex - lx, dy = ey - ly, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const far = s * (28 + 150 * facing);
    pen.save();
    pen.globalCompositeOperation = "lighter";

    // Layers of cone, wide and faint to narrow and bright, read as haze.
    for (const [width, alpha] of [[1, 0.05], [0.62, 0.08], [0.34, 0.13], [0.14, 0.24]]) {
      const cone = pen.createLinearGradient(lx, ly, ex, ey);
      cone.addColorStop(0, `rgba(255,241,206,${(alpha * power).toFixed(3)})`);
      cone.addColorStop(0.55, `rgba(255,236,196,${(alpha * power * 0.35).toFixed(3)})`);
      cone.addColorStop(1, "rgba(255,236,196,0)");
      const w0 = s * 4 * width + 0.6, w1 = far * width;
      pen.fillStyle = cone;
      pen.beginPath();
      pen.moveTo(lx + nx * w0, ly + ny * w0);
      pen.lineTo(ex + nx * w1, ey + ny * w1);
      pen.lineTo(ex - nx * w1, ey - ny * w1);
      pen.lineTo(lx - nx * w0, ly - ny * w0);
      pen.fill();
    }

    // Where the beam crosses the sea, the water picks it up.
    pen.save();
    pen.clip(sea);
    const graze = pen.createLinearGradient(lx, 0, ex, 0);
    graze.addColorStop(0, `rgba(255,236,200,${(0.22 * power).toFixed(3)})`);
    graze.addColorStop(1, "rgba(255,236,200,0)");
    pen.fillStyle = graze;
    pen.fillRect(Math.min(lx, ex), horizon, Math.abs(ex - lx), Math.max(2, s * 14));
    pen.restore();

    // The lamp, and the flash as the beam swings past you
    const flash = facing ** 8;
    const r = s * 18 * (1 + 3.5 * flash);
    const lamp = pen.createRadialGradient(lx, ly, 0, lx, ly, r);
    lamp.addColorStop(0, `rgba(255,253,240,${(0.95 * strength).toFixed(3)})`);
    lamp.addColorStop(0.18, `rgba(255,236,185,${(strength * (0.45 + 0.5 * flash)).toFixed(3)})`);
    lamp.addColorStop(1, "rgba(255,220,160,0)");
    pen.fillStyle = lamp;
    pen.fillRect(lx - r, ly - r, r * 2, r * 2);
    if (flash > 0.02) {
      // A horizontal streak, like a lens catching it
      pen.save();
      pen.translate(lx, ly);
      pen.scale(1, 0.03);
      const streak = s * 620 * flash;
      const line = pen.createRadialGradient(0, 0, 0, 0, 0, streak);
      line.addColorStop(0, `rgba(235,240,255,${(0.5 * flash * strength).toFixed(3)})`);
      line.addColorStop(1, "rgba(235,240,255,0)");
      pen.fillStyle = line;
      pen.fillRect(-streak, -streak, streak * 2, streak * 2);
      pen.restore();
      // and the whole scene lit for a moment
      const wash = pen.createRadialGradient(lx, ly, 0, lx, ly, W * 0.5);
      wash.addColorStop(0, `rgba(255,232,190,${(0.12 * flash * strength).toFixed(3)})`);
      wash.addColorStop(1, "rgba(255,232,190,0)");
      pen.fillStyle = wash;
      pen.fillRect(0, 0, W, geo.H);
    }
    pen.restore();
  };

  let skyFrame = 0, lastSky = 0, pathShown = 0, pathWanted = 0, skyOnScreen = true;
  let skyDirty = true, skyLive = true;
  // Draws one frame, and says whether anything in it moves on its own.
  const drawSky = (now) => {
    const st = skyState;
    if (!geo || !st) return false;
    const { dpr, waterTop } = geo;
    const time = now / 1000;
    if (waterDirty) paintWater();
    pen.setTransform(1, 0, 0, 1, 0, 0);
    pen.clearRect(0, 0, glow.width, glow.height);
    const sunShine = st.sunShine > 0.02, moonShine = st.moonShine > 0.02;
    if (sunShine || moonShine) pen.drawImage(water.canvas, 0, waterTop);
    pen.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (sunShine || moonShine) {
      pen.save();
      pen.clip(sea);
      pen.globalCompositeOperation = "lighter";
      if (sunShine) glints(st.sunAt[0], st.sun.alt, st.sunRgb, st.sunShine, time);
      if (moonShine) glints(st.moonAt[0], -st.sun.alt, "236,238,255", st.moonShine, time);
      pen.restore();
    }

    const beam = st.night > 0.08;
    if (beam) lighthouse(time, Math.min(1, st.night * 1.6 - 0.3));

    if (pathShown > 0.01) {
      if (trailDirty) paintTrail();
      pen.setTransform(1, 0, 0, 1, 0, 0);
      pen.globalAlpha = pathShown;
      pen.drawImage(trail.canvas, 0, 0);
      pen.globalAlpha = 1;
    } else if (trail.canvas.width) {
      fit(trail.canvas, 0, 0);
      trailDirty = true;
    }
    return sunShine || moonShine || beam;
  };
  // The water and the lighthouse move all the time, at 30 frames a second,
  // and only while the banner is on screen. A frame that holds still is
  // drawn once and left. A change of hour is drawn on the next frame, so the
  // light on the water keeps up with a dragged sun.
  const tickSky = (now) => {
    skyFrame = 0;
    if (document.hidden || !skyOnScreen) return;
    const fading = pathShown !== pathWanted;
    if (fading) {
      pathShown += (pathWanted - pathShown) * 0.2;
      if (Math.abs(pathWanted - pathShown) < 0.01) pathShown = pathWanted;
    }
    if (fading || skyDirty || now - lastSky > 31) {
      lastSky = now;
      skyDirty = false;
      skyLive = drawSky(now);
    }
    if ((skyLive && !reduced) || pathShown !== pathWanted) skyFrame = requestAnimationFrame(tickSky);
  };
  function wakeSky() {
    skyDirty = true;
    if (reduced) {
      pathShown = pathWanted;
      drawSky(0);
    } else if (!skyFrame && !document.hidden && skyOnScreen) {
      skyFrame = requestAnimationFrame(tickSky);
    }
  }
  new IntersectionObserver(([e]) => {
    skyOnScreen = e.isIntersecting;
    if (skyOnScreen) wakeSky();
  }).observe(landscape);

  // Minutes from now until the sun next crosses the horizon.
  const sunCrossing = (rising) => {
    const now = Date.now();
    let before = sunAt(now).alt;
    for (let m = 2; m <= 1440; m += 2) {
      const a = sunAt(now + m * 6e4).alt;
      if (rising ? before < -0.8 && a >= -0.8 : before >= -0.8 && a < -0.8) return m;
      before = a;
    }
    return 0;
  };

  const clock = document.getElementById("clock");
  const doing = document.getElementById("doing");
  const timeEl = document.getElementById("time");
  // India keeps one offset all year, so the time there is plain arithmetic,
  // cheap enough to run on every move of a drag.
  const IST = 330 * 6e4;
  const two = (n) => String(n).padStart(2, "0");
  // A guess at what I'm doing right now, from the time in Surat.
  const guess = (h, weekend) =>
    h < 7 ? "probably asleep"
      : h < 10 ? "morning chai"
        : !weekend && h < 19 ? "at the day job"
          : "side-project hours";
  // Once someone has moved the sun, the label stops telling them they can.
  let dragged = false;
  try { dragged = localStorage.getItem("sky-dragged") === "1"; } catch { /* storage is optional */ }
  // Minutes the sky has been dragged away from now.
  let skew = 0;
  const setClock = () => {
    cancelAnimationFrame(clockFrame);
    clockFrame = 0;
    const t = Date.now() + skew * 6e4;
    const local = new Date(t + IST);
    const h = local.getUTCHours(), m = local.getUTCMinutes(), day = local.getUTCDay();
    const hm = `${two(h)}:${two(m)}`;
    setText(clock, hm);
    setText(doing, guess(h, day === 0 || day === 6));
    const sun = paintSky(t);
    const skewed = Math.round(skew) !== 0;
    setText(tag, dragged ? hm : `${hm} · drag the ${skyState.isSun ? "sun" : "moon"}`);
    setText(skyNote, `${skewed ? `${hm} in Surat` : "Lit by the sun over Surat"} · ${sun}`);
    timeEl.classList.toggle("is-skewed", skewed);
    landscape.classList.toggle("is-skewed", skewed);
    timeEl.setAttribute("aria-valuenow", String(h * 60 + m));
    timeEl.setAttribute("aria-valuetext", `${hm} in Surat, ${sun}`);
  };
  // Pointer and key events can come faster than frames; the sky only needs
  // redoing once per frame.
  let clockFrame = 0;
  const queueClock = () => { if (!clockFrame) clockFrame = requestAnimationFrame(setClock); };

  let glide = 0;
  const glideTo = (target, ms = 900, done) => {
    cancelAnimationFrame(glide);
    glide = 0;
    if (reduced || document.hidden) {
      skew = target;
      setClock();
      return done?.();
    }
    const from = skew, t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      skew = from + (target - from) * (k < 0.5 ? 4 * k ** 3 : 1 - (2 - 2 * k) ** 3 / 2);
      setClock();
      if (k < 1) glide = requestAnimationFrame(step);
      else { glide = 0; done?.(); }
    };
    glide = requestAnimationFrame(step);
  };
  // Takes the short way round the clock face.
  const wrap = (m) => ((((m % 1440) + 2160) % 1440) - 720);
  const skyHome = () => { skew = wrap(skew); glideTo(0); };
  const skyTo = (minutes, ms = 2600) => { skew = wrap(skew); glideTo(wrap(minutes), ms); };
  const skyDay = () => {
    skew = wrap(skew);
    glideTo(skew + 1440, 12000, () => { skew = wrap(skew); setClock(); });
  };

  // Pointing at the banner (or the clock) shows the path the sun or moon is
  // on, a ring round it and a label saying it can be dragged. First-time
  // visitors get the same hint once, by itself, shortly after the page loads.
  let drag = null, overSky = false, overClock = false, hinting = false;
  const showPath = () => {
    const on = overSky || overClock || hinting || !!drag;
    pathWanted = on ? 1 : 0;
    landscape.classList.toggle("show-path", on);
    landscape.classList.toggle("show-note", on || Math.round(skew) !== 0);
    wakeSky();
  };
  if (!dragged) {
    setTimeout(() => {
      hinting = true;
      showPath();
      setTimeout(() => { hinting = false; showPath(); }, 4500);
    }, 1800);
  }

  // Dragging the sky moves the sun or moon along with the pointer. Dragging
  // the clock scrubs it, later to the right.
  const beginDrag = (e, el, perPx) => {
    if (e.button) return;
    // Otherwise the mouse starts a text selection that spans the page by the
    // time the drag ends.
    if (e.pointerType === "mouse") e.preventDefault();
    cancelAnimationFrame(glide);
    glide = 0;
    drag = { x: e.clientX, from: skew, moved: false, perPx, el };
    el.setPointerCapture(e.pointerId);
    showPath();
  };
  const moveDrag = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 3 && !drag.moved) {
      drag.moved = true;
      root.classList.add("is-dragging-sky");
    }
    if (!drag.moved) return;
    skew = drag.from + dx * drag.perPx;
    queueClock();
  };
  const endDrag = (e) => {
    if (!drag) return;
    const { moved, el } = drag;
    drag = null;
    root.classList.remove("is-dragging-sky");
    if (moved && !dragged) {
      dragged = true;
      try { localStorage.setItem("sky-dragged", "1"); } catch { /* storage is optional */ }
      setClock();
    } else if (!moved && e.type === "pointerup" && (el === timeEl || Math.round(skew) !== 0)) {
      skyHome();
    }
    showPath();
  };
  for (const el of [timeEl, landscape]) {
    el.addEventListener("pointermove", moveDrag);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
  }
  timeEl.addEventListener("pointerdown", (e) => beginDrag(e, timeEl, 4)); // 360 px is a whole day
  // 95° of hour angle (6 h 20 min) is half the banner.
  landscape.addEventListener("pointerdown", (e) => { if (geo) beginDrag(e, landscape, -380 / bodySpan()); });
  landscape.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { overSky = true; showPath(); } });
  landscape.addEventListener("pointerleave", () => { overSky = false; showPath(); });
  timeEl.addEventListener("pointerenter", () => { overClock = true; showPath(); });
  timeEl.addEventListener("pointerleave", () => { overClock = false; showPath(); });
  timeEl.addEventListener("focus", () => { overClock = true; showPath(); });
  timeEl.addEventListener("blur", () => { overClock = false; showPath(); });
  timeEl.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 60 : 15;
    const by = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
    if (by) {
      e.preventDefault();
      cancelAnimationFrame(glide);
      glide = 0;
      skew += by;
      queueClock();
      showPath();
    } else if (e.key === "Home" || e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      skyHome();
    }
  });

  let clockTimer = 0;
  const refreshClock = () => {
    clearTimeout(clockTimer);
    if (document.hidden) return;
    setClock();
    clockTimer = setTimeout(refreshClock, 60000 - Date.now() % 60000);
  };
  refreshClock();
  document.addEventListener("visibilitychange", refreshClock);
  window.addEventListener("pagehide", () => clearTimeout(clockTimer));
  window.addEventListener("pageshow", refreshClock);

  const copyBtn = document.getElementById("copy");
  let copied = 0;
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById("email").textContent.trim());
    } catch {
      return;
    }
    copyBtn.classList.add("done");
    copyBtn.setAttribute("aria-label", "Copied");
    clearTimeout(copied);
    copied = setTimeout(() => {
      copyBtn.classList.remove("done");
      copyBtn.setAttribute("aria-label", "Copy email address");
    }, 1600);
  });

  // The name thickens under the mouse, letter by letter, like ink pooling.
  const nameEl = document.querySelector(".name");
  const letters = [];
  const splitName = () => {
    if (letters.length) return;
    nameEl.setAttribute("aria-label", "Prit Prajapati");
    for (const node of [...nameEl.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const frag = document.createDocumentFragment();
      for (const ch of node.textContent.trim()) {
        const s = document.createElement("span");
        s.textContent = ch;
        s.setAttribute("aria-hidden", "true");
        frag.append(s);
        letters.push(s);
      }
      node.replaceWith(frag);
    }
  };
  if (!reduced) splitName();
  let px = 0, py = 0, nameFrame = 0, measureFrame = 0, nameActive = false;
  let nameBox, letterBoxes = [];
  const measureName = () => {
    measureFrame = 0;
    nameBox = nameEl.getBoundingClientRect();
    letterBoxes = letters.map((s) => s.getBoundingClientRect());
  };
  const resetName = () => {
    cancelAnimationFrame(nameFrame);
    nameFrame = 0;
    if (!nameActive) return;
    nameActive = false;
    letters.forEach((s) => { s.style.fontWeight = ""; });
  };
  const scheduleNameMeasure = () => {
    if (!letters.length || reduced || document.hidden || measureFrame) return;
    resetName();
    measureFrame = requestAnimationFrame(measureName);
  };
  const weigh = () => {
    nameFrame = 0;
    nameActive = true;
    letters.forEach((s, i) => {
      const b = letterBoxes[i];
      if (!b.height) return;
      const d = Math.hypot(px - (b.left + b.width / 2), py - (b.top + b.height / 2));
      const weight = String(Math.round(400 + 300 * Math.exp(-((d / b.height) ** 2))));
      if (s.style.fontWeight !== weight) s.style.fontWeight = weight;
    });
  };
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || !letters.length || reduced || document.hidden || !nameBox) return;
    px = e.clientX;
    py = e.clientY;
    const margin = nameBox.height;
    if (px < nameBox.left - margin || px > nameBox.right + margin
      || py < nameBox.top - margin || py > nameBox.bottom + margin) return resetName();
    if (!nameFrame) nameFrame = requestAnimationFrame(weigh);
  });
  document.documentElement.addEventListener("pointerleave", resetName);
  window.addEventListener("resize", scheduleNameMeasure);
  window.addEventListener("scroll", scheduleNameMeasure, { passive: true });
  document.fonts.ready.then(scheduleNameMeasure);
  scheduleNameMeasure();

  const data = window.ACTIVITY;
  if (!data) return;

  const DAY = 864e5;
  const parse = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const start = parse(data.from);
  const n = Math.round((parse(data.to) - start) / DAY) + 1;
  const indexOf = (s) => Math.round((parse(s) - start) / DAY);
  const dateOf = (i) => new Date(start + i * DAY);
  const today = Math.max(0, Math.min(n - 1, indexOf(data.updated)));
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
  const stamp = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const and = new Intl.ListFormat("en-GB", { type: "conjunction" });

  const score = document.querySelector(".score");
  const timeline = document.querySelector(".timeline");
  const wave = document.getElementById("wave");
  const axis = document.getElementById("axis");
  const noteEl = document.getElementById("note");
  const playBtn = document.getElementById("play");

  const rows = [...document.querySelectorAll(".work")].map((el) => {
    const counts = new Array(n).fill(0);
    for (const [day, c] of Object.entries(data.projects[el.dataset.project] || {})) {
      const i = indexOf(day);
      if (i >= 0 && i < n) counts[i] += c;
    }
    const active = counts.flatMap((c, i) => (c ? [i] : []));
    return {
      el, counts, active, ticks: [], highlights: [], total: sum(counts),
      name: el.querySelector(".title a").textContent,
      track: el.querySelector(".track"),
    };
  });

  const totals = new Array(n).fill(0);
  const rowsByDay = Array.from({ length: n }, () => []);
  let maxCell = 1;
  rows.forEach((r) => r.active.forEach((i) => {
    totals[i] += r.counts[i];
    rowsByDay[i].push(r);
    maxCell = Math.max(maxCell, r.counts[i]);
  }));
  rows.forEach((r, i) => { r.pitchIndex = i; });
  const maxDay = Math.max(1, ...totals);
  const months = totals.flatMap((_, i) => (dateOf(i).getUTCDate() === 1 ? [i] : []));

  score.style.setProperty("--n", n);

  const markAt = (className, x, vars = {}) => {
    const e = document.createElement("span");
    e.className = className;
    e.style.setProperty("--x", x);
    for (const [k, v] of Object.entries(vars)) e.style.setProperty(k, v);
    return e;
  };
  const mark = (className, i, vars) => markAt(className, i / n, vars);

  // Everything drawn in the timeline sits in one layer, so it can be squeezed
  // into the corner when the view zooms out to years.
  const zoom = document.createElement("div");
  zoom.className = "zoom";
  wave.append(zoom);

  // Month lines, today and the playhead go into the timeline and every track,
  // so they read as one line running down the page.
  const playheads = [];
  let playheadWidth = 0, playheadPosition = 0, waveHeight = 0;
  const setPlayhead = (position) => {
    playheadPosition = position;
    const transform = `translateX(${position * playheadWidth}px)`;
    playheads.forEach((e) => { if (e.style.transform !== transform) e.style.transform = transform; });
  };
  const staff = (parent) => {
    months.forEach((i) => parent.append(mark("m", i)));
    parent.append(mark("now-line", today));
    const head = mark("ph", 0);
    parent.append(head);
    playheads.push(head);
  };

  // The marks sweep in from the left once, on load.
  if (!reduced) score.classList.add("drawing");
  const drawingTimer = setTimeout(() => score.classList.remove("drawing"), 2000);

  staff(zoom);
  const bars = [];
  for (let i = 0; i <= today && i < n; i++) {
    bars[i] = mark(totals[i] ? "d" : "d zero", i, { "--v": totals[i] / maxDay });
    zoom.append(bars[i]);
  }

  const labelAt = (text, x, className = "") => {
    const s = document.createElement("span");
    s.className = className;
    s.textContent = text;
    s.style.left = `${x * 100}%`;
    axis.append(s);
    return s;
  };
  const label = (text, i, className) => labelAt(text, i / n, className);
  const monthLabels = months.map((i) => label(MONTHS[dateOf(i).getUTCMonth()], i));
  const nowLabel = label("today", today + 0.5, "now");

  rows.forEach((r) => {
    staff(r.track);
    if (r.active.length > 1) {
      const a = r.active[0];
      r.track.append(mark("s", a, { "--w": (r.active.at(-1) - a) / n }));
    }
    r.active.forEach((i) => {
      r.ticks[i] = mark("t", i, { "--v": r.counts[i] / maxCell });
      r.track.append(r.ticks[i]);
    });
  });

  // Bars get a whole-pixel width, and a month label that would touch "today" is hidden.
  const fitBars = () => {
    playheadWidth = wave.clientWidth;
    waveHeight = wave.clientHeight;
    setPlayhead(playheadPosition);
    const slot = playheadWidth / n;
    score.style.setProperty("--bw", `${Math.max(1, Math.round(slot * 0.66))}px`);
    nowLabel.style.translate = "";
    const now = nowLabel.getBoundingClientRect();
    const overhang = Math.max(0, now.right - axis.getBoundingClientRect().right);
    const boxes = monthLabels.map((s) => s.getBoundingClientRect());
    if (overhang) nowLabel.style.translate = `${-overhang}px`;
    monthLabels.forEach((s, i) => {
      const box = boxes[i];
      s.style.visibility = box.right + 8 > now.left - overhang && box.left < now.right - overhang + 8 ? "hidden" : "";
    });
  };
  const waveObserver = new ResizeObserver(fitBars);
  waveObserver.observe(wave);
  document.fonts.ready.then(fitBars);

  // Pointing at a project makes its name do a tiny version of what the
  // project does. Nothing moves before that, and leaving undoes all of it.

  let undoFx = [];
  const endFx = () => {
    undoFx.reverse().forEach((f) => f());
    undoFx = [];
  };
  const kit = (r) => {
    const undo = (f) => undoFx.push(f);
    return {
      a: r.el.querySelector(".title a"),
      stack: r.el.querySelector(".stack"),
      undo,
      later: (ms, f) => { const t = setTimeout(f, ms); undo(() => clearTimeout(t)); },
      put: (parent, e) => { parent.append(e); undo(() => e.remove()); return e; },
      cls: (e, c) => {
        e.classList.add(c);
        undo(() => e.classList.remove(c));
      },
      anim: (e, frames, timing) => { const x = e.animate(frames, timing); undo(() => x.cancel()); return x; },
    };
  };

  // JPEGView paints coarse blocks first. One pixelating filter per block size.
  const svgDefs = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgDefs.setAttribute("class", "fx-defs");
  svgDefs.setAttribute("aria-hidden", "true");
  svgDefs.innerHTML = [8, 4, 2].map((b) => `
    <filter id="fx-px${b}" x="0" y="0" color-interpolation-filters="sRGB">
      <feFlood x="${b / 2}" y="${b / 2}" width="1" height="1"/>
      <feComposite width="${b}" height="${b}"/>
      <feTile result="grid"/>
      <feComposite in="SourceGraphic" in2="grid" operator="in"/>
      <feMorphology operator="dilate" radius="${b / 2}"/>
    </filter>`).join("");
  document.body.append(svgDefs);

  // Splits a name into letters once, so they can move on their own.
  const splitLetters = (a) => {
    if (!a.querySelector(".fx-l")) {
      const word = a.textContent;
      a.textContent = "";
      [...word].forEach((ch) => a.append(ch === " " ? ch : make("span", "fx-l", ch)));
    }
    return [...a.querySelectorAll(".fx-l")];
  };

  // Splits a rectangle by value, alternating sides, the way a disk treemap does.
  const treemap = (items, x, y, w, h, out = []) => {
    if (!items.length) return out;
    if (items.length === 1) { out.push({ ...items[0], x, y, w, h }); return out; }
    const total = sum(items.map((t) => t.v));
    let k = 1, acc = items[0].v;
    while (k < items.length - 1 && acc + items[k].v <= total / 2) acc += items[k++].v;
    const f = acc / total;
    if (w >= h) {
      treemap(items.slice(0, k), x, y, w * f, h, out);
      treemap(items.slice(k), x + w * f, y, w * (1 - f), h, out);
    } else {
      treemap(items.slice(0, k), x, y, w, h * f, out);
      treemap(items.slice(k), x, y + h * f, w, h * (1 - f), out);
    }
    return out;
  };

  const tricks = {
    // A tank filling up
    fuelmate: (k) => k.cls(k.a, "fx-fuel"),

    // The heading as typed, then as rendered
    "markdown-pdf": (k) => {
      k.put(k.a, make("span", "fx-hash", "#"));
      k.later(560, () => k.cls(k.a, "fx-rendered"));
    },

    // Every letter is a request. They lift by response time, sort themselves
    // into a percentile curve with the slow tail in blue, then settle back.
    pm2: (k) => {
      const ls = splitLetters(k.a);
      const ms = [41, 12, 8, 95, 23, 17, 380, 30, 14, 52, 9, 26, 640, 19];
      const time = (i) => ms[i % ms.length];
      const em = parseFloat(getComputedStyle(k.a).fontSize);
      const ink = getComputedStyle(k.a).color;
      const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
      const order = ls.map((_, i) => i).sort((p, q) => time(p) - time(q));
      const widths = ls.map((s) => s.offsetWidth);
      const lefts = ls.map((s) => s.offsetLeft);
      const gap = (k.a.offsetWidth - sum(widths)) / Math.max(1, ls.length - 1);
      const to = [];
      let x = 0;
      order.forEach((i) => { to[i] = x; x += widths[i] + gap; });
      const move = "cubic-bezier(0.6, 0, 0.2, 1)";
      ls.forEach((s, i) => {
        const y = -Math.log(time(i) / 8) / Math.log(80) * em * 0.8; // log scale, 8 ms to 640 ms
        const at = (dx) => `translate(${dx}px, ${y}px)`;
        const timing = { duration: 2400, delay: i * 15 };
        k.anim(s, [
          { offset: 0, transform: "none", easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
          { offset: 0.15, transform: at(0) },
          { offset: 0.22, transform: at(0), easing: move },
          { offset: 0.5, transform: at(to[i] - lefts[i]) },
          { offset: 0.74, transform: at(to[i] - lefts[i]), easing: move },
          { offset: 0.95, transform: "none" },
          { offset: 1, transform: "none" },
        ], timing);
        if (order.indexOf(i) >= ls.length - 2) {
          k.anim(s, [
            { offset: 0, color: ink }, { offset: 0.42, color: ink }, { offset: 0.52, color: accent },
            { offset: 0.74, color: accent }, { offset: 0.9, color: ink }, { offset: 1, color: ink },
          ], timing);
        }
      });
    },

    // Squeezed, and the label moves up into the space it saved
    "pdf-compressor": (k) => {
      const w = k.a.offsetWidth;
      const steps = [1, 0.5, 0.77, 0.64, 0.7];
      const timing = { duration: 900, fill: "forwards" };
      k.anim(k.a, steps.map((s) => ({ transform: `scaleX(${s})`, easing: "ease-in-out" })), timing);
      k.anim(k.stack, steps.map((s) => ({ transform: `translateX(${-(1 - s) * w}px)`, easing: "ease-in-out" })), timing);
    },

    // 65 million lines, at the speed the native build reads them
    "pm2-native": (k) => {
      const was = k.stack.textContent;
      k.undo(() => { k.stack.textContent = was; });
      k.cls(k.stack, "fx-count");
      const t0 = performance.now();
      let frame = 0;
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / 2000);
        const text = p < 1 ? `${(65 * p).toFixed(1)}M lines` : "65M lines in 2 s";
        if (k.stack.textContent !== text) k.stack.textContent = text;
        if (p < 1) frame = requestAnimationFrame(tick);
      };
      tick();
      k.undo(() => cancelAnimationFrame(frame));
    },

    // Coarse blocks first, sharp a moment later
    jpegview: (k) => {
      const paint = (b) => { k.a.style.filter = b ? `url(#fx-px${b})` : ""; };
      k.undo(() => paint(0));
      paint(8);
      k.later(90, () => paint(4));
      k.later(180, () => paint(2));
      k.later(270, () => paint(0));
    },

    // A box dragged over the text, then the text inside it read
    glyph: (k) => {
      const box = k.put(k.a, make("span", "fx-box"));
      k.anim(box, [{ width: "0px", height: "0px" },
        { width: `${k.a.offsetWidth + 8}px`, height: `${k.a.offsetHeight + 2}px` }],
      { duration: 420, easing: "cubic-bezier(0.3, 0.6, 0.3, 1)", fill: "forwards" });
      k.later(460, () => box.classList.add("is-read"));
    },

    // A wave running through the letters
    sonograph: (k) => {
      const a = "0.2em";
      const wave = ["0", `-${a}`, "0", a, "0"].map((y) => ({ transform: `translateY(${y})`, easing: "ease-in-out" }));
      splitLetters(k.a).forEach((s, i) =>
        k.anim(s, wave, { duration: 1300, delay: i * 85, iterations: Infinity }));
    },

    // The red ball, hopping along the tops of the letters and off the end
    bounce: (k) => {
      const text = k.a.firstChild;
      const cs = getComputedStyle(k.a);
      const fs = parseFloat(cs.fontSize);
      const g = document.createElement("canvas").getContext("2d");
      g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const x = g.measureText("x");
      const xh = x.actualBoundingBoxAscent, cap = g.measureText("B").actualBoundingBoxAscent;
      const ascent = x.fontBoundingBoxAscent ?? fs * 0.9;
      const box = k.a.getBoundingClientRect();
      const range = document.createRange();
      const top = (i) => {
        range.setStart(text, i);
        range.setEnd(text, i + 1);
        const b = range.getBoundingClientRect();
        const tall = /[A-Zbdfhklt]/.test(text.data[i]);
        return { x: b.left - box.left + b.width / 2, y: b.top - box.top + ascent - (tall ? cap : xh) };
      };
      const stops = [0, 2, text.data.length - 1].map(top);
      const d = fs * 0.42;

      const ball = k.put(k.a, make("span", "fx-ball"));
      const lift = make("span");
      const core = make("span");
      ball.append(lift);
      lift.append(core);
      core.style.width = core.style.height = `${d}px`;

      const T = 1500;
      const lands = [330, 690, 1050].map((t) => t / T);
      const fall = "cubic-bezier(0.5, 0, 1, 1)", rise = "cubic-bezier(0, 0, 0.5, 1)";
      const sit = (s) => s.y - d;
      const apex = (s, t) => Math.min(s.y, t.y) - d - fs * 0.55;
      const timing = { duration: T };

      k.anim(ball, [
        { offset: 0, transform: `translateX(${stops[0].x - d / 2}px)`, opacity: 0 },
        { offset: 0.06, opacity: 1 },
        { offset: lands[0], transform: `translateX(${stops[0].x - d / 2}px)` },
        { offset: lands[1], transform: `translateX(${stops[1].x - d / 2}px)` },
        { offset: lands[2], transform: `translateX(${stops[2].x - d / 2}px)` },
        { offset: 0.9, opacity: 1 },
        { offset: 1, transform: `translateX(${stops[2].x + fs * 1.1}px)`, opacity: 0 },
      ], timing);
      k.anim(lift, [
        { offset: 0, transform: `translateY(${sit(stops[0]) - fs * 1.3}px)`, easing: fall },
        { offset: lands[0], transform: `translateY(${sit(stops[0])}px)`, easing: rise },
        { offset: (lands[0] + lands[1]) / 2, transform: `translateY(${apex(stops[0], stops[1])}px)`, easing: fall },
        { offset: lands[1], transform: `translateY(${sit(stops[1])}px)`, easing: rise },
        { offset: (lands[1] + lands[2]) / 2, transform: `translateY(${apex(stops[1], stops[2])}px)`, easing: fall },
        { offset: lands[2], transform: `translateY(${sit(stops[2])}px)`, easing: rise },
        { offset: lands[2] + (1 - lands[2]) * 0.35, transform: `translateY(${apex(stops[2], stops[2])}px)`, easing: fall },
        { offset: 1, transform: `translateY(${ascent + fs * 0.5}px)` },
      ], timing);
      k.anim(core, [{ offset: 0, transform: "none" }, ...lands.flatMap((l) => [
        { offset: l - 0.025, transform: "none" },
        { offset: l, transform: "scale(1.35, 0.65)" },
        { offset: l + 0.04, transform: "none" },
      ]), { offset: 1, transform: "none" }], timing);
    },

    // Heard as "Whisper", then corrected after the pause
    whistle: (k) => {
      const say = k.put(k.a, make("span", "fx-say"));
      const said = make("span");
      say.append(said, make("span", "fx-caret"));
      k.cls(k.a, "fx-hide");
      let t = 0;
      const at = (ms, f) => { t += ms; k.later(t, f); };
      const type = (s) => [...s].forEach((ch) => at(50 + Math.random() * 45, () => { said.textContent += ch; }));
      type("Whisper");
      for (let i = 0; i < 3; i++) at(i ? 45 : 480, () => { said.textContent = said.textContent.slice(0, -1); });
      type("tle");
      at(140, () => say.classList.add("is-final"));
    },

    // This year's commits as a treemap, the way Quarry draws a drive.
    // Its own tile is the blue one.
    quarry: (k, r) => {
      const map = k.put(k.a.parentElement, make("span", "fx-map"));
      map.style.left = `${k.stack.offsetLeft}px`;
      k.cls(k.stack, "fx-gone");
      const items = rows.map((row) => ({ row, v: row.total })).filter((t) => t.v).sort((p, q) => q.v - p.v);
      treemap(items, 0, 0, map.clientWidth, map.clientHeight).forEach((t, i) => {
        const s = make("span", t.row === r ? "is-me" : "");
        Object.assign(s.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: `${t.h}px` });
        s.style.setProperty("--i", i);
        map.append(s);
      });
    },

    // Outlines, then subpixel colour fringes, then settled native text
    nanoui: (k) => k.cls(k.a, "fx-raster"),
  };

  const startFx = (r) => {
    endFx();
    const trick = tricks[r.el.dataset.project];
    if (trick && !reduced) trick(kit(r), r);
  };

  // The big year rolls, like an odometer, into whatever is in focus: a day,
  // or the months a project was built in. Later rolls up, earlier rolls down.

  const totalEl = document.querySelector(".total");
  const year = totalEl.textContent.trim();
  totalEl.textContent = "";
  const slots = [];
  const slotAnimations = new Map();
  const cancelRoll = (slot) => {
    const animations = slotAnimations.get(slot);
    if (!animations) return;
    animations.forEach((a) => { a.onfinish = null; a.cancel(); });
    slotAnimations.delete(slot);
  };
  const settleRoll = () => slots.forEach((slot) => {
    cancelRoll(slot);
    while (slot.children.length > 1) slot.firstElementChild.remove();
  });
  let rolled = "";
  let rolledPos = -1;

  const roll = (text, pos, fast = false) => {
    if (text === rolled) return;
    const dir = pos >= rolledPos ? 1 : -1;
    rolled = text;
    rolledPos = pos;
    while (slots.length < text.length) {
      const s = document.createElement("span");
      s.className = "slot";
      totalEl.append(s);
      slots.push(s);
    }
    while (slots.length > text.length) {
      const slot = slots.pop();
      cancelRoll(slot);
      slot.remove();
    }
    [...text].forEach((ch, i) => {
      const slot = slots[i];
      if (slot.dataset.ch === ch) return;
      cancelRoll(slot);
      slot.dataset.ch = ch;
      [...slot.children].slice(0, -1).forEach((c) => c.remove());
      const old = slot.lastElementChild;
      const next = document.createElement("span");
      next.textContent = ch;
      slot.append(next);
      if (!old) return;
      if (reduced) { old.remove(); return; }
      old.className = "out";
      const timing = { duration: fast ? 90 : 240, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" };
      const incoming = next.animate([{ transform: `translateY(${dir * 1.1}em)` }, { transform: "none" }], timing);
      const outgoing = old.animate([{ transform: "none" }, { transform: `translateY(${-dir * 1.1}em)` }], timing);
      slotAnimations.set(slot, [incoming, outgoing]);
      outgoing.onfinish = () => { old.remove(); cancelRoll(slot); };
    });
  };

  const dateLabel = (i) => `${MONTHS[dateOf(i).getUTCMonth()]} ${dateOf(i).getUTCDate()}`;
  const monthsOf = (r) => {
    const a = MONTHS[dateOf(r.active[0]).getUTCMonth()];
    const b = MONTHS[dateOf(r.active.at(-1)).getUTCMonth()];
    return a === b ? a : `${a}–${b}`;
  };

  // The line beside the year describes whatever is in focus.

  const overview = noteEl.textContent.trim();
  const show = (note) => { if (noteEl.textContent !== note) noteEl.textContent = note; };

  const span = (a, b) => {
    const da = dateOf(a), db = dateOf(b);
    if (a === b) return `on ${dayMonth.format(da)}`;
    const first = da.getUTCMonth() === db.getUTCMonth() ? da.getUTCDate() : dayMonth.format(da);
    return `between ${first} and ${dayMonth.format(db)}`;
  };

  let lit = [];
  let focusedRows = [];
  let highlightedRow = null;
  let current = -1;

  const clear = () => {
    endFx();
    lit.forEach((e) => e.classList.remove("hit"));
    lit = [];
    if (highlightedRow) {
      highlightedRow.highlights.forEach((e) => { e.hidden = true; });
      highlightedRow = null;
    }
    score.classList.remove("is-row", "is-scrub");
    focusedRows.forEach((r) => r.el.classList.remove("is-on"));
    focusedRows = [];
  };

  const reset = () => {
    clear();
    current = -1;
    show(overview);
    roll(year, -1);
  };

  const focusRow = (r) => {
    clear();
    current = -1;
    score.classList.add("is-row");
    r.el.classList.add("is-on");
    focusedRows = [r];
    if (!r.highlights.length) r.active.forEach((i) => {
      if (i > today) return;
      const e = mark("d hl", i, { "--v": r.counts[i] / maxDay });
      zoom.append(e);
      r.highlights.push(e);
    });
    r.highlights.forEach((e) => { e.hidden = false; });
    highlightedRow = r;
    const built = r.active.length ? ` Built ${span(r.active[0], r.active.at(-1))}.` : "";
    show(`${r.el.dataset.detail}${built}`);
    if (r.active.length) roll(monthsOf(r), r.active[0]);
    startFx(r);
  };

  // During playback a quiet day keeps the last line, so the text doesn't flicker.
  const scrubTo = (i, playback = false) => {
    i = Math.max(0, Math.min(today, n - 1, i));
    if (i === current) return;
    clear();
    current = i;
    score.classList.add("is-scrub");
    if (!playback) setPlayhead(i / n);
    if (totals[i]) {
      bars[i].classList.add("hit");
      lit.push(bars[i]);
    }
    const on = rowsByDay[i];
    focusedRows = on;
    on.forEach((r) => {
      r.el.classList.add("is-on");
      r.ticks[i].classList.add("hit");
      lit.push(r.ticks[i]);
    });
    // The date itself is in the big rolling numbers, so the line only needs the weekday.
    roll(dateLabel(i), i, playback);
    const d = weekday.format(dateOf(i));
    if (on.length) show(`${d}: worked on ${and.format(on.map((r) => r.name))}.`);
    else if (!playback) show(`${d}: nothing public.`);
  };

  // Play the year: the playhead sweeps from July to today, and each project
  // sounds a note on the days I worked on it. Every row has its own pitch on a
  // pentatonic scale, rising down the list, so busy days land as chords.

  const STEP = 0.075; // seconds per day
  const SCALE = [0, 2, 4, 7, 9];
  const pitch = (k) => 220 * 2 ** ((12 * Math.floor(k / 5) + SCALE[k % 5]) / 12);
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audio = null;
  let playing = null;
  const sounds = new Set();
  const activeNotes = new Set();
  const suspendAudio = () => {
    if (audio && !playing && !sounds.size && !activeNotes.size) audio.suspend().catch(() => {});
  };

  const pluck = (sound, freq, at, v) => {
    const osc = audio.createOscillator();
    const env = audio.createGain();
    const note = { osc, env };
    sound.notes.add(note);
    activeNotes.add(note);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
      sound.notes.delete(note);
      activeNotes.delete(note);
      osc.onended = null;
      suspendAudio();
    };
    osc.type = "triangle";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.04 + 0.1 * Math.sqrt(v), at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
    osc.connect(env).connect(sound.input);
    osc.start(at);
    osc.stop(at + 1.15);
  };

  // notes -> lowpass -> master, with an echo four days long feeding back into itself
  const chain = () => {
    const master = audio.createGain();
    const tone = audio.createBiquadFilter();
    const echo = audio.createDelay();
    const feedback = audio.createGain();
    const wet = audio.createGain();
    tone.type = "lowpass";
    tone.frequency.value = 2200;
    echo.delayTime.value = STEP * 4;
    feedback.gain.value = 0.3;
    wet.gain.value = 0.22;
    tone.connect(master);
    tone.connect(echo).connect(feedback).connect(echo);
    echo.connect(wet).connect(master);
    master.connect(audio.destination);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(analyser);
    const sound = { input: tone, master, analyser, notes: new Set(), nextDay: 0, timer: 0 };
    sound.dispose = () => {
      if (!sounds.delete(sound)) return;
      clearTimeout(sound.timer);
      sound.notes.forEach(({ osc, env }) => {
        osc.stop();
        osc.disconnect();
        env.disconnect();
      });
      sound.notes.clear();
      // Disconnect every edge, including the echo's feedback cycle.
      [tone, echo, feedback, wet, master, analyser].forEach((node) => node.disconnect());
      // Let stopped sources dispatch `ended` before suspending the context.
      suspendAudio();
    };
    sounds.add(sound);
    return sound;
  };

  // Keep only a short look-ahead of notes alive, even for a multi-year range.
  const scheduleNotes = (sound, elapsed) => {
    if (audio.state !== "running") return;
    const last = Math.min(today, Math.floor((elapsed + 0.2) / STEP));
    for (; sound.nextDay <= last; sound.nextDay++) {
      const i = sound.nextDay;
      if (i * STEP < elapsed - STEP) continue;
      const at = audio.currentTime + Math.max(0, i * STEP - elapsed);
      rowsByDay[i].forEach((r) => pluck(sound, pitch(r.pitchIndex), at, r.counts[i] / maxCell));
    }
  };

  // While the year plays, the rule under the summary becomes the sound itself:
  // a string, fixed at both ends, moving with what you hear.

  const summary = document.querySelector(".summary");
  const scope = document.createElement("canvas");
  scope.className = "scope";
  scope.setAttribute("aria-hidden", "true");
  summary.append(scope);
  let scopeUntil = 0;
  let scopeFrame = 0;
  let scopeWidth = 0, scopeHeight = 0, scopeDpr = 1;
  const sizeScope = () => {
    scopeWidth = scope.clientWidth;
    scopeHeight = scope.clientHeight;
    scopeDpr = Math.min(window.devicePixelRatio || 1, 2);
    scope.width = Math.round(scopeWidth * scopeDpr);
    scope.height = Math.round(scopeHeight * scopeDpr);
  };
  const scopeObserver = new ResizeObserver(() => { if (scopeFrame) sizeScope(); });
  scopeObserver.observe(summary);
  const stopScope = () => {
    cancelAnimationFrame(scopeFrame);
    scopeFrame = 0;
    // Resetting dimensions releases the bitmap instead of retaining it at idle.
    scope.width = scope.height = 0;
    summary.classList.remove("is-live");
  };

  const pluckString = (analyser) => {
    stopScope();
    if (reduced || document.hidden) return;
    sizeScope();
    const g = scope.getContext("2d");
    const buf = new Float32Array(analyser.fftSize);
    const color = getComputedStyle(scope).color;
    summary.classList.add("is-live");
    const frame = () => {
      const w = scopeWidth, h = scopeHeight, mid = h / 2;
      g.setTransform(scopeDpr, 0, 0, scopeDpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (performance.now() > scopeUntil) {
        stopScope();
        return;
      }
      analyser.getFloatTimeDomainData(buf);
      // Start at a rising zero crossing so the wave holds still instead of sliding.
      let s = 0;
      for (let i = 1; i < buf.length / 2; i++) {
        if (buf[i - 1] < 0 && buf[i] >= 0) { s = i; break; }
      }
      g.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const v = buf[s + Math.floor((x / w) * 480)];
        g.lineTo(x, mid - Math.tanh(v * 8) * (mid - 2) * Math.sin((Math.PI * x) / w));
      }
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.stroke();
      scopeFrame = requestAnimationFrame(frame);
    };
    frame();
  };

  const title = document.title;

  const stop = (finished = false) => {
    if (!playing) return;
    const { frame, sound } = playing;
    playing = null;
    cancelAnimationFrame(frame);
    if (sound) {
      const { master } = sound;
      master.gain.setTargetAtTime(0, audio.currentTime, finished ? 0.4 : 0.03);
      sound.timer = setTimeout(sound.dispose, finished ? 3000 : 400);
      scopeUntil = performance.now() + (finished ? 2500 : 250);
    }
    document.title = title;
    playBtn.textContent = "Play the year";
    playBtn.setAttribute("aria-pressed", "false");
    reset();
  };

  const openSound = () => {
    if (!AudioCtx) return null;
    try {
      audio ||= new AudioCtx();
      audio.resume().catch(() => {});
      return chain();
    } catch {
      // The visual timeline remains usable when audio is unavailable.
      return null;
    }
  };

  const play = () => {
    if (document.hidden) return;
    stopRide();
    const sound = openSound();
    // Notes are scheduled on the audio clock; the picture follows the page clock,
    // so it still runs if the browser keeps the sound off.
    const t0 = performance.now() / 1000 + 0.12;
    if (sound) {
      scheduleNotes(sound, -0.12);
      scopeUntil = Infinity;
      pluckString(sound.analyser);
    }
    playing = { sound, frame: 0 };
    playBtn.textContent = "Stop";
    playBtn.setAttribute("aria-pressed", "true");
    reset();

    let shown = -1;
    const frame = () => {
      const elapsed = performance.now() / 1000 - t0;
      const pos = elapsed / STEP;
      if (sound) scheduleNotes(sound, elapsed);
      const i = Math.floor(pos);
      if (i > today + 10) return stop(true);
      if (i >= 0 && i !== shown && i <= today) {
        shown = i;
        scrubTo(i, true);
        document.title = `▶ ${dateLabel(i)} · ${title}`;
      }
      setPlayhead(Math.max(0, Math.min(pos, today)) / n);
      playing.frame = requestAnimationFrame(frame);
    };
    playing.frame = requestAnimationFrame(frame);
  };

  const toggle = () => (playing ? stop() : play());
  playBtn.addEventListener("click", toggle);

  // Experience. Pointing at the switch zooms the score out from months to
  // years: the side projects squeeze into the corner they take up, and the
  // jobs before them appear on the same staff. A click keeps it there.

  const careerEl = document.getElementById("career");
  const projectsBtn = document.getElementById("mode-projects");
  const careerBtn = document.getElementById("mode-career");
  const careerNote = careerEl.dataset.note;
  const careerStart = Date.UTC(2023, 0, 1);
  const careerDays = Math.round((parse(data.to) - careerStart) / DAY) + 1;
  const cx = (t) => (t - careerStart) / DAY / careerDays;
  const nowT = parse(data.updated);
  const month = (s, end = false) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - (end ? 0 : 1), 1) - (end ? DAY : 0);
  const newYears = [2024, 2025, 2026].map((y) => Date.UTC(y, 0, 1)).filter((t) => t <= parse(data.to));
  const FAR = -1e6; // roll positions for career views, all earlier than any project day

  score.style.setProperty("--k", n / careerDays);
  careerEl.style.setProperty("--n", careerDays);

  const years = document.createElement("div");
  years.className = "years";
  newYears.forEach((t) => years.append(markAt("m", cx(t))));
  wave.append(years);
  [careerStart, ...newYears].forEach((t) => labelAt(String(new Date(t).getUTCFullYear()), cx(t), "yr"));

  const jobs = [...careerEl.querySelectorAll(".job")].map((el, k) => {
    const a = month(el.dataset.from);
    const b = el.dataset.to ? month(el.dataset.to, true) : nowT;
    const track = el.querySelector(".track");
    newYears.forEach((t) => track.append(markAt("m", cx(t))));
    track.append(markAt("now-line", cx(nowT)));
    track.append(markAt(el.dataset.to ? "span" : "span open", cx(a), { "--w": cx(b + DAY) - cx(a) }));
    el.style.setProperty("--i", k);
    const d = new Date(a);
    return { el, pos: FAR + 1 + (a - careerStart) / DAY, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  });

  let career = false;
  let pinned = false;
  let leaveTimer = 0;

  const setPressed = () => {
    careerBtn.setAttribute("aria-pressed", String(career));
    projectsBtn.setAttribute("aria-pressed", String(!career));
  };

  const careerOverview = () => {
    careerEl.classList.remove("has-focus");
    jobs.forEach((j) => j.el.classList.remove("is-on"));
    show(careerNote);
    roll(String(new Date(careerStart).getUTCFullYear()), FAR);
  };

  const enterCareer = () => {
    clearTimeout(leaveTimer);
    if (career) return;
    stop();
    stopRide();
    reset();
    career = true;
    score.classList.add("is-career");
    setPressed();
    careerOverview();
  };

  const leaveCareer = () => {
    clearTimeout(leaveTimer);
    pinned = false;
    if (!career) return;
    career = false;
    score.classList.remove("is-career");
    careerEl.classList.remove("has-focus");
    jobs.forEach((j) => j.el.classList.remove("is-on"));
    setPressed();
    reset();
  };

  // A hovered preview closes shortly after the mouse leaves the section.
  const leaveSoon = () => {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(leaveCareer, 400);
  };

  const isMouse = (e) => e.pointerType === "mouse" || e.pointerType === "pen";
  careerBtn.addEventListener("pointerenter", (e) => { if (isMouse(e)) enterCareer(); });
  projectsBtn.addEventListener("pointerenter", (e) => { if (isMouse(e) && !pinned) leaveCareer(); });
  careerBtn.addEventListener("click", () => { enterCareer(); pinned = true; });
  projectsBtn.addEventListener("click", leaveCareer);
  score.addEventListener("pointerenter", () => { if (career) clearTimeout(leaveTimer); });
  score.addEventListener("pointerleave", (e) => { if (isMouse(e) && career && !pinned) leaveSoon(); });
  document.addEventListener("pointerdown", (e) => {
    if (career && !pinned && !score.contains(e.target)) leaveCareer();
  });

  careerEl.addEventListener("pointerover", (e) => {
    const j = jobs.find((x) => x.el === e.target.closest(".job"));
    if (!career || !j || j.el.classList.contains("is-on")) return;
    careerEl.classList.add("has-focus");
    jobs.forEach((x) => x.el.classList.toggle("is-on", x === j));
    show(j.el.dataset.detail);
    roll(j.label, j.pos);
  });
  careerEl.addEventListener("pointerleave", () => { if (career) careerOverview(); });

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.target.closest?.("input, textarea, [contenteditable], dialog")) return;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === "Escape") { stop(); stopRide(); leaveCareer(); }
    else if ((e.key === "p" || e.key === "P") && plain) {
      leaveCareer();
      toggle();
    } else if ((e.key === "b" || e.key === "B") && plain && !riding) {
      startRide();
    }
  });

  // Hovering is ignored while the year plays, so moving the mouse doesn't cut it off.

  const busy = () => playing || riding || career;
  const list = document.querySelector(".works");
  list.addEventListener("pointerover", (e) => {
    if (busy()) return;
    const row = rows.find((r) => r.el === e.target.closest(".work"));
    if (row && !(score.classList.contains("is-row") && row.el.classList.contains("is-on"))) focusRow(row);
  });
  list.addEventListener("pointerleave", () => { if (!busy()) reset(); });
  list.addEventListener("focusin", (e) => {
    if (busy()) return;
    const row = rows.find((r) => r.el === e.target.closest(".work"));
    if (row && !row.el.classList.contains("is-on")) focusRow(row);
  });
  list.addEventListener("focusout", (e) => { if (!busy() && !list.contains(e.relatedTarget)) reset(); });

  const dayAt = (x) => {
    const box = wave.getBoundingClientRect();
    return Math.floor(((x - box.left) / box.width) * n);
  };
  let scrubFrame = 0, scrubX = 0;
  const cancelScrub = () => {
    cancelAnimationFrame(scrubFrame);
    scrubFrame = 0;
  };
  timeline.addEventListener("pointermove", (e) => {
    if (busy() || document.hidden) return;
    scrubX = e.clientX;
    if (!scrubFrame) scrubFrame = requestAnimationFrame(() => {
      scrubFrame = 0;
      if (!busy()) scrubTo(dayAt(scrubX));
    });
  });
  timeline.addEventListener("pointerdown", (e) => {
    if (career || riding) return;
    cancelScrub();
    stop();
    scrubTo(dayAt(e.clientX));
  });
  timeline.addEventListener("pointerleave", (e) => {
    cancelScrub();
    if (!busy() && e.pointerType !== "touch" && document.activeElement !== wave) reset();
  });
  document.addEventListener("pointerdown", (e) => {
    if (riding && !rideBtn.contains(e.target) && !e.target.closest(".palette")) stopRide();
    if (career || riding || playBtn.contains(e.target) || timeline.contains(e.target)) return;
    if (playing) stop();
    else if (current >= 0) reset();
  });

  wave.addEventListener("focus", () => { if (riding) return; leaveCareer(); if (!playing) scrubTo(today); });
  wave.addEventListener("blur", () => { if (!playing && !riding) reset(); });
  wave.addEventListener("keydown", (e) => {
    if (riding) return;
    const step = e.shiftKey ? 7 : 1;
    const next = {
      ArrowLeft: current - step, ArrowRight: current + step, Home: 0, End: today,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    stop();
    scrubTo(next);
  });

  // Ride the year. The red ball from Bounce drops onto the timeline and the
  // busy days are its hills. Every day it touches plays that day's projects,
  // and lights up; light all of them and the year plays back to you.

  const page = document.querySelector(".page");
  const rideBtn = document.getElementById("ride");
  const hud = document.getElementById("hud");
  const rider = make("span", "rider");
  const riderCore = make("span");
  rider.append(riderCore);
  const workedDays = totals.reduce((c, v, i) => c + (v && i <= today ? 1 : 0), 0);
  const ROLL = { ArrowLeft: -1, a: -1, A: -1, ArrowRight: 1, d: 1, D: 1 };
  const JUMP = new Set(["ArrowUp", "w", "W", " "]);
  const held = new Map();
  let riding = null;

  // The top of the bars under the ball, in pixels from the top of the timeline.
  const groundAt = (x, r, W, H) => {
    const slot = W / n;
    const a = Math.max(0, Math.floor((x - r * 0.6) / slot));
    const b = Math.min(today, Math.floor((x + r * 0.6) / slot));
    let top = H / 2 - 0.75;
    for (let i = a; i <= b; i++) {
      if (totals[i]) top = Math.min(top, Math.min((1 - totals[i] / maxDay) * H / 2, H / 2 - 1));
    }
    return top;
  };

  const chord = (i) => {
    const s = riding?.sound;
    if (!s || audio.state !== "running") return;
    rowsByDay[i].forEach((r) => pluck(s, pitch(r.pitchIndex), audio.currentTime + 0.005, r.counts[i] / maxCell));
  };

  const showHud = () => {
    const s = riding;
    hud.innerHTML = s.done
      ? `The whole year, ridden. <b>Esc</b> to stop.`
      : `<b>← →</b> roll, <b>↑</b> jump · ${s.got.size}/${workedDays} days · <b>Esc</b>`;
  };

  const touch = (s, i, landed) => {
    if (i < 0 || i > today) return;
    if (i !== s.day) {
      s.day = i;
      scrubTo(i, true);
    }
    if (!totals[i] || (!landed && s.got.has(i))) return;
    chord(i);
    if (s.got.has(i)) return;
    s.got.add(i);
    bars[i].classList.add("got");
    if (s.got.size === workedDays) {
      s.done = true;
      page.classList.add("ridden");
      show(`That's all ${workedDays} days I worked on something, across ${rows.length} projects. Thanks for riding.`);
      if (s.sound && audio.state === "running") {
        rows.forEach((r, k) => pluck(s.sound, pitch(r.pitchIndex), audio.currentTime + 0.25 + k * 0.09, 0.6));
      }
    }
    showHud();
  };

  const stepRide = (now) => {
    const s = riding;
    if (!s) return;
    const dt = Math.min(0.033, (now - s.last) / 1000);
    s.last = now;
    const W = playheadWidth, H = waveHeight;
    if (!W || !H) { s.frame = requestAnimationFrame(stepRide); return; }
    if (W !== s.W) { s.x *= W / s.W; s.W = W; }
    const r = Math.max(3.5, Math.min(7, H * 0.1));
    const slot = W / n;
    const g = H * 30;
    let dir = 0;
    held.forEach((d) => { dir += d; });
    dir = Math.sign(dir);

    // Rolling
    const grounded = now - s.landed < 90;
    if (dir) s.vx += dir * H * (grounded ? 14 : 8) * dt;
    else if (grounded) s.vx *= 0.004 ** dt;
    s.vx = Math.max(-H * 2.6, Math.min(H * 2.6, s.vx));
    let x = s.x + s.vx * dt;
    const right = (today + 1) * slot - r;
    if (x < r || x > right) {
      x = Math.max(r, Math.min(right, x));
      s.vx *= -0.4;
    }
    // A hill steeper than the ball can climb is a wall until it jumps.
    if (groundAt(x, r, W, H) < s.y + r - r * 0.9) {
      x = s.x;
      s.vx *= -0.35;
    }
    s.x = x;

    // Jumping and falling
    if (now - s.wantJump < 140 && grounded) {
      s.vy = -Math.sqrt(2 * g * H * 0.9);
      s.wantJump = 0;
      s.landed = 0;
    }
    s.vy += g * dt;
    s.y += s.vy * dt;
    const floor = groundAt(s.x, r, W, H) - r;
    if (s.y >= floor) {
      const impact = s.vy;
      s.y = floor;
      if (impact > H * 4) {
        s.vy = -impact * 0.42;
        s.squash = Math.min(1, impact / (H * 11));
        touch(s, Math.floor(s.x / slot), true);
      } else {
        s.vy = 0;
      }
      s.landed = now;
    }
    const day = Math.floor(s.x / slot);
    if (day !== s.day) {
      if (now - s.landed < 90) touch(s, day, false);
      else if (day >= 0 && day <= today) { s.day = day; scrubTo(day, true); }
    }
    setPlayhead((s.x - slot / 2) / W);

    // Squash on landing, unless motion is reduced
    s.squash *= 0.0005 ** dt;
    const q = reduced ? 0 : s.squash;
    rider.style.width = rider.style.height = `${r * 2}px`;
    rider.style.transform = `translate(${(s.x - r).toFixed(2)}px, ${(s.y - r).toFixed(2)}px)`;
    riderCore.style.transform = q > 0.01 ? `scale(${1 + 0.4 * q}, ${1 - 0.4 * q})` : "";
    s.frame = requestAnimationFrame(stepRide);
  };

  const startRide = () => {
    if (riding || document.hidden || !rows.length) return;
    closePalette();
    stop();
    leaveCareer();
    reset();
    const sound = openSound();
    if (sound) {
      scopeUntil = Infinity;
      pluckString(sound.analyser);
    }
    riding = {
      x: 8, y: -waveHeight, vx: 0, vy: 0, W: playheadWidth, day: -1, got: new Set(),
      sound, frame: 0, last: performance.now(), landed: 0, wantJump: 0, squash: 0, done: false,
    };
    wave.append(rider);
    page.classList.add("is-riding");
    show("Ride the year. Every day the ball touches plays the projects I worked on that day.");
    showHud();
    riding.frame = requestAnimationFrame(stepRide);
  };

  const stopRide = () => {
    if (!riding) return;
    const { frame, sound } = riding;
    riding = null;
    cancelAnimationFrame(frame);
    held.clear();
    rider.remove();
    bars.forEach((b) => b.classList.remove("got"));
    page.classList.remove("is-riding", "ridden");
    if (sound) {
      sound.master.gain.setTargetAtTime(0, audio.currentTime, 0.15);
      sound.timer = setTimeout(sound.dispose, 1500);
      scopeUntil = performance.now() + 700;
    }
    setPlayhead(0);
    reset();
  };

  rideBtn.addEventListener("click", () => (riding ? stopRide() : startRide()));
  document.addEventListener("keydown", (e) => {
    if (!riding || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key in ROLL) {
      e.preventDefault();
      held.set(e.key.toLowerCase(), ROLL[e.key]);
    } else if (JUMP.has(e.key)) {
      e.preventDefault();
      if (!e.repeat) riding.wantJump = performance.now();
    }
  });
  document.addEventListener("keyup", (e) => { held.delete(e.key.toLowerCase()); });
  window.addEventListener("blur", () => held.clear());

  // Ctrl K, or /, opens everything on the page as a list you can type into.
  // Moving through the projects points at them, so their names still do
  // their tricks behind the list.

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const keysBtn = document.getElementById("keys");
  const canHover = matchMedia("(hover: hover)");
  keysBtn.textContent = !canHover.matches ? "Menu" : isMac ? "⌘K" : "Ctrl K";

  const palette = make("dialog", "palette");
  palette.setAttribute("aria-label", "Jump to anything");
  palette.innerHTML = `
    <input class="palette-q" type="text" placeholder="Jump to a project, or do something…" autocomplete="off"
           spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list">
    <ul class="palette-list" id="palette-list" role="listbox"></ul>
    <p class="palette-foot"><span>↑↓ choose</span><span>↵ go</span><span>esc close</span></p>`;
  document.body.append(palette);
  const paletteQ = palette.querySelector(".palette-q");
  const paletteList = palette.querySelector(".palette-list");

  const go = (href) => { location.href = href; };
  const commands = [
    ...rows.map((r) => ({
      group: "Projects", label: r.name, hint: r.el.querySelector(".stack").textContent, row: r,
      run: () => r.el.querySelector(".title a").click(),
    })),
    { group: "Play", label: "Play the year", hint: "P", run: () => { leaveCareer(); if (!playing) play(); } },
    { group: "Play", label: "Ride the year", hint: "B", run: startRide, when: () => canHover.matches },
    { group: "Play", label: "Watch a day go by in Surat", hint: "12 s", run: skyDay },
    { group: "Play", label: "Skip to sunset", hint: "sky", run: () => skyTo(sunCrossing(false) + 12) },
    { group: "Play", label: "Skip to sunrise", hint: "sky", run: () => skyTo(sunCrossing(true) - 12) },
    { group: "Play", label: "Bring the sky back to now", hint: "sky", run: skyHome, when: () => Math.round(skew) !== 0 },
    { group: "Page", label: () => (isDark() ? "Lights on" : "Lights off"), hint: "theme", run: () => toggleTheme(lightsBtn) },
    { group: "Page", label: "Show experience", hint: "since 2023", run: () => { careerBtn.click(); } },
    { group: "Page", label: "Copy email address", hint: "pprit362@gmail.com", run: () => copyBtn.click() },
    { group: "Elsewhere", label: "Email me", hint: "mailto", run: () => go("mailto:pprit362@gmail.com") },
    { group: "Elsewhere", label: "GitHub", hint: "Prit36", run: () => go("https://github.com/Prit36") },
    { group: "Elsewhere", label: "LinkedIn", hint: "prit-prajapati36", run: () => go("https://www.linkedin.com/in/prit-prajapati36") },
  ];
  const labelOf = (c) => (typeof c.label === "function" ? c.label() : c.label);

  // Letters in order, not necessarily together. Earlier and tighter is better.
  const fuzzy = (text, q) => {
    const t = text.toLowerCase();
    let at = -1, score = 0;
    const hits = [];
    for (const ch of q) {
      const j = t.indexOf(ch, at + 1);
      if (j < 0) return null;
      score += j === at + 1 ? 3 : j === 0 || t[j - 1] === " " ? 2 : 0.5;
      hits.push(j);
      at = j;
    }
    return { score: score - hits[0] * 0.05, hits };
  };
  const marked = (text, hits) => {
    const li = document.createDocumentFragment();
    [...text].forEach((ch, i) => li.append(hits?.includes(i) ? make("mark", "", ch) : ch));
    return li;
  };

  let shown = [], picked = 0;
  const pick = (k) => {
    if (!shown.length) return;
    picked = (k + shown.length) % shown.length;
    shown.forEach(({ el }, i) => el.setAttribute("aria-selected", String(i === picked)));
    const { el, c } = shown[picked];
    el.scrollIntoView({ block: "nearest" });
    paletteQ.setAttribute("aria-activedescendant", el.id);
    if (busy()) return;
    if (c.row) { if (!c.row.el.classList.contains("is-on")) focusRow(c.row); }
    else if (score.classList.contains("is-row")) reset();
  };
  const renderPalette = () => {
    const q = paletteQ.value.trim().toLowerCase().replace(/\s+/g, " ");
    let found = commands.filter((c) => !c.when || c.when()).map((c, i) => {
      const label = labelOf(c);
      const m = q ? fuzzy(label, q) : { score: 0 };
      return m && { c, label, i, ...m };
    }).filter(Boolean);
    if (q) found.sort((p, o) => o.score - p.score || p.i - o.i);
    paletteList.textContent = "";
    shown = [];
    let group = "";
    found.forEach((f, k) => {
      if (!q && f.c.group !== group) {
        group = f.c.group;
        const h = make("li", "palette-group", group);
        h.setAttribute("role", "presentation");
        paletteList.append(h);
      }
      const el = make("li", "palette-item");
      el.id = `palette-${k}`;
      el.setAttribute("role", "option");
      const name = make("span");
      name.append(marked(f.label, f.hits));
      el.append(name, make("span", "hint-r", f.c.hint || ""));
      el.addEventListener("pointermove", () => { if (picked !== k) pick(k); });
      el.addEventListener("click", () => runPick(k));
      paletteList.append(el);
      shown.push({ el, c: f.c });
    });
    if (!shown.length) paletteList.append(make("li", "palette-empty", `Nothing here matches “${paletteQ.value.trim()}”.`));
    picked = 0;
    pick(0);
  };
  const openPalette = () => {
    if (palette.open) return;
    paletteQ.value = "";
    palette.showModal();
    renderPalette();
    paletteQ.focus();
  };
  function closePalette() {
    if (palette.open) palette.close();
  }
  const runPick = (k) => {
    const c = shown[k]?.c;
    if (!c) return;
    closePalette();
    c.run();
  };
  palette.addEventListener("close", () => { if (!busy()) reset(); });
  palette.addEventListener("click", (e) => { if (e.target === palette) closePalette(); });
  paletteQ.addEventListener("input", renderPalette);
  paletteQ.addEventListener("keydown", (e) => {
    const by = { ArrowDown: 1, ArrowUp: -1, Tab: e.shiftKey ? -1 : 1 }[e.key];
    if (by) { e.preventDefault(); pick(picked + by); }
    else if (e.key === "Enter") { e.preventDefault(); runPick(picked); }
  });
  keysBtn.addEventListener("click", openPalette);
  document.addEventListener("keydown", (e) => {
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey) && !e.altKey) {
      e.preventDefault();
      if (palette.open) closePalette(); else openPalette();
    } else if (e.key === "/" && !palette.open && !e.target.closest?.("input, textarea, [contenteditable]")) {
      e.preventDefault();
      openPalette();
    }
  });

  document.getElementById("updated").textContent = stamp.format(parse(data.updated));
  reset();

  // A background or cached page must not retain sound, timers or render loops.
  const pausePage = () => {
    document.documentElement.classList.add("is-paused");
    resetName();
    cancelAnimationFrame(measureFrame);
    measureFrame = 0;
    cancelScrub();
    clearTimeout(copied);
    copyBtn.classList.remove("done");
    copyBtn.setAttribute("aria-label", "Copy email address");
    clearTimeout(leaveTimer);
    clearTimeout(drawingTimer);
    score.classList.remove("drawing");
    stop();
    stopRide();
    cancelAnimationFrame(glide);
    glide = 0;
    cancelAnimationFrame(skyFrame);
    skyFrame = 0;
    cancelAnimationFrame(clockFrame);
    clockFrame = 0;
    drag = null;
    root.classList.remove("is-dragging-sky");
    if (!career) reset();
    endFx();
    sounds.forEach((sound) => sound.dispose());
    stopScope();
    settleRoll();
    waveObserver.disconnect();
    scopeObserver.disconnect();
    skyObserver.disconnect();
  };
  const resumePage = () => {
    document.documentElement.classList.remove("is-paused");
    scheduleNameMeasure();
    waveObserver.observe(wave);
    scopeObserver.observe(summary);
    skyObserver.observe(landscape);
    wakeSky();
  };
  document.addEventListener("visibilitychange", () => document.hidden ? pausePage() : resumePage());
  window.addEventListener("pagehide", pausePage);
  window.addEventListener("pageshow", () => { if (!document.hidden) resumePage(); });
  motion.addEventListener("change", () => {
    reduced = motion.matches;
    if (reduced) {
      resetName();
      cancelAnimationFrame(measureFrame);
      measureFrame = 0;
      endFx();
      stopScope();
      settleRoll();
    } else {
      splitName();
      scheduleNameMeasure();
      if (playing?.sound) pluckString(playing.sound.analyser);
    }
    wakeSky();
  });

  // For anyone who opens the console: the same year, three days per bar.
  const BLOCKS = "▁▂▃▄▅▆▇█";
  const bins = [];
  for (let i = 0; i <= today; i += 3) bins.push(sum(totals.slice(i, Math.min(i + 3, today + 1))));
  const peak = Math.max(...bins);
  const spark = bins.map((b) => (b ? BLOCKS[Math.min(7, Math.floor((b / peak) * 8))] : " ")).join("");
  console.log(
    `%c${spark}%c\nJuly to today, three days per bar.\n\n`
      + "Hand-written HTML, CSS and JS. No framework, no build step.\n"
      + "Source: https://github.com/Prit36/Prit36.github.io\n"
      + "Press P on the page to hear the year, B to ride it, Ctrl K for everything else.\n"
      + "The sun (or the moon) in the banner can be dragged to another hour.",
    "font: 18px/1 monospace; color: #6f7cff;",
    "font: 12px/1.5 monospace;",
  );
})();
