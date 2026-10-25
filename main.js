(() => {
  const clock = document.getElementById("clock");
  const doing = document.getElementById("doing");
  const clockFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  // A guess at what I'm doing right now, from the time in Surat.
  const guess = (h, weekend) =>
    h < 7 ? "probably asleep"
      : h < 10 ? "morning chai"
        : !weekend && h < 19 ? "at the day job"
          : "side-project hours";
  const setClock = () => {
    const p = Object.fromEntries(clockFormat.formatToParts(new Date()).map((x) => [x.type, x.value]));
    clock.textContent = `${p.hour}:${p.minute}`;
    doing.textContent = guess(+p.hour, p.weekday === "Sat" || p.weekday === "Sun");
    presence.classList.toggle("awake", +p.hour >= 7);
  };
  const presence = document.getElementById("presence");
  setClock();
  setInterval(setClock, 10000);

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
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
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
  }
  let px = 0, py = 0, pending = false;
  const weigh = () => {
    pending = false;
    const boxes = letters.map((s) => s.getBoundingClientRect());
    letters.forEach((s, i) => {
      const b = boxes[i];
      const d = Math.hypot(px - (b.left + b.width / 2), py - (b.top + b.height / 2));
      s.style.fontWeight = Math.round(400 + 300 * Math.exp(-((d / b.height) ** 2)));
    });
  };
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || !letters.length) return;
    px = e.clientX;
    py = e.clientY;
    if (!pending) { pending = true; requestAnimationFrame(weigh); }
  });
  document.documentElement.addEventListener("pointerleave", () => {
    letters.forEach((s) => { s.style.fontWeight = ""; });
  });

  const data = window.ACTIVITY;
  if (!data) return;

  const DAY = 864e5;
  const parse = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const start = parse(data.from);
  const n = Math.round((parse(data.to) - start) / DAY) + 1;
  const indexOf = (s) => Math.round((parse(s) - start) / DAY);
  const dateOf = (i) => new Date(start + i * DAY);
  const today = indexOf(data.updated);
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
      el, counts, active, ticks: [],
      name: el.querySelector(".title a").textContent,
      track: el.querySelector(".track"),
    };
  });

  const totals = Array.from({ length: n }, (_, i) => sum(rows.map((r) => r.counts[i])));
  const maxDay = Math.max(...totals);
  const maxCell = Math.max(...rows.flatMap((r) => r.counts));
  const months = totals.flatMap((_, i) => (dateOf(i).getUTCDate() === 1 ? [i] : []));

  score.style.setProperty("--n", n);
  score.style.setProperty("--ph", 0);

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
  const staff = (parent) => {
    months.forEach((i) => parent.append(mark("m", i)));
    parent.append(mark("now-line", today));
    parent.append(mark("ph", 0));
  };

  // The marks sweep in from the left once, on load.
  score.classList.add("drawing");
  setTimeout(() => score.classList.remove("drawing"), 2000);

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
    const slot = wave.clientWidth / n;
    score.style.setProperty("--bw", `${Math.max(1, Math.round(slot * 0.66))}px`);
    nowLabel.style.translate = "";
    const overhang = nowLabel.getBoundingClientRect().right - axis.getBoundingClientRect().right;
    if (overhang > 0) nowLabel.style.translate = `${-overhang}px`;
    const now = nowLabel.getBoundingClientRect();
    monthLabels.forEach((s) => {
      s.style.visibility = "";
      const box = s.getBoundingClientRect();
      if (box.right + 8 > now.left && box.left < now.right + 8) s.style.visibility = "hidden";
    });
  };
  fitBars();
  new ResizeObserver(fitBars).observe(wave);

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Pointing at a project makes its name do a tiny version of what the
  // project does. Nothing moves before that, and leaving undoes all of it.

  const make = (tag, className = "", text = "") => {
    const e = document.createElement(tag);
    e.className = className;
    e.textContent = text;
    return e;
  };

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
        e.classList.remove(c);
        void e.offsetWidth; // so the animation starts over
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
      const gap = (k.a.offsetWidth - sum(ls.map((s) => s.offsetWidth))) / (ls.length - 1);
      const to = [];
      let x = 0;
      order.forEach((i) => { to[i] = x; x += ls[i].offsetWidth + gap; });
      const move = "cubic-bezier(0.6, 0, 0.2, 1)";
      ls.forEach((s, i) => {
        const y = -Math.log(time(i) / 8) / Math.log(80) * em * 0.8; // log scale, 8 ms to 640 ms
        const at = (dx) => `translate(${dx}px, ${y}px)`;
        const timing = { duration: 2400, delay: i * 15 };
        k.anim(s, [
          { offset: 0, transform: "none", easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
          { offset: 0.15, transform: at(0) },
          { offset: 0.22, transform: at(0), easing: move },
          { offset: 0.5, transform: at(to[i] - s.offsetLeft) },
          { offset: 0.74, transform: at(to[i] - s.offsetLeft), easing: move },
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
        k.stack.textContent = p < 1 ? `${(65 * p).toFixed(1)}M lines` : "65M lines in 2 s";
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
      const items = rows.map((row) => ({ row, v: sum(row.counts) })).filter((t) => t.v).sort((p, q) => q.v - p.v);
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
    while (slots.length > text.length) slots.pop().remove();
    [...text].forEach((ch, i) => {
      const slot = slots[i];
      if (slot.dataset.ch === ch) return;
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
      next.animate([{ transform: `translateY(${dir * 1.1}em)` }, { transform: "none" }], timing);
      old.animate([{ transform: "none" }, { transform: `translateY(${-dir * 1.1}em)` }], timing)
        .onfinish = () => old.remove();
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
  const show = (note) => { noteEl.textContent = note; };

  const span = (a, b) => {
    const da = dateOf(a), db = dateOf(b);
    if (a === b) return `on ${dayMonth.format(da)}`;
    const first = da.getUTCMonth() === db.getUTCMonth() ? da.getUTCDate() : dayMonth.format(da);
    return `between ${first} and ${dayMonth.format(db)}`;
  };

  let lit = [];
  let current = -1;

  const clear = () => {
    endFx();
    lit.forEach((e) => (e.classList.contains("hl") ? e.remove() : e.classList.remove("hit")));
    lit = [];
    score.classList.remove("is-row", "is-scrub");
    rows.forEach((r) => r.el.classList.remove("is-on"));
  };

  const reset = () => {
    clear();
    current = -1;
    show(overview);
    roll(year, -1);
  };

  const focusRow = (r) => {
    clear();
    score.classList.add("is-row");
    r.el.classList.add("is-on");
    r.active.forEach((i) => {
      if (i > today) return;
      const e = mark("d hl", i, { "--v": r.counts[i] / maxDay });
      zoom.append(e);
      lit.push(e);
    });
    const built = r.active.length ? ` Built ${span(r.active[0], r.active.at(-1))}.` : "";
    show(`${r.el.dataset.detail}${built}`);
    if (r.active.length) roll(monthsOf(r), r.active[0]);
    startFx(r);
  };

  // During playback a quiet day keeps the last line, so the text doesn't flicker.
  const scrubTo = (i, playback = false) => {
    i = Math.max(0, Math.min(today, n - 1, i));
    clear();
    current = i;
    score.classList.add("is-scrub");
    score.style.setProperty("--ph", i / n);
    if (totals[i]) {
      bars[i].classList.add("hit");
      lit.push(bars[i]);
    }
    const on = rows.filter((r) => r.counts[i]);
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

  const pluck = (out, freq, at, v) => {
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.04 + 0.1 * Math.sqrt(v), at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
    osc.connect(env).connect(out);
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
    return { input: tone, master, analyser };
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

  const pluckString = (analyser) => {
    cancelAnimationFrame(scopeFrame);
    const g = scope.getContext("2d");
    const buf = new Float32Array(analyser.fftSize);
    const color = getComputedStyle(scope).color;
    summary.classList.add("is-live");
    const frame = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = scope.clientWidth, h = scope.clientHeight, mid = h / 2;
      if (scope.width !== Math.round(w * dpr)) {
        scope.width = Math.round(w * dpr);
        scope.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (performance.now() > scopeUntil) {
        summary.classList.remove("is-live");
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
    cancelAnimationFrame(playing.frame);
    if (playing.sound) {
      const { master } = playing.sound;
      master.gain.setTargetAtTime(0, audio.currentTime, finished ? 0.4 : 0.03);
      setTimeout(() => master.disconnect(), finished ? 3000 : 400);
      scopeUntil = performance.now() + (finished ? 2500 : 250);
    }
    playing = null;
    document.title = title;
    playBtn.textContent = "Play the year";
    playBtn.setAttribute("aria-pressed", "false");
    reset();
  };

  const play = () => {
    if (AudioCtx) {
      audio ||= new AudioCtx();
      audio.resume();
    }
    // Notes are scheduled on the audio clock; the picture follows the page clock,
    // so it still runs if the browser keeps the sound off.
    const t0 = performance.now() / 1000 + 0.12;
    const sound = audio && chain();
    if (sound) {
      const a0 = audio.currentTime + 0.12;
      rows.forEach((r, k) => r.active.forEach((i) => {
        if (i <= today) pluck(sound.input, pitch(k), a0 + i * STEP, r.counts[i] / maxCell);
      }));
      scopeUntil = Infinity;
      pluckString(sound.analyser);
    }
    playing = { sound, frame: 0 };
    playBtn.textContent = "Stop";
    playBtn.setAttribute("aria-pressed", "true");
    reset();

    let shown = -1;
    const frame = () => {
      const pos = (performance.now() / 1000 - t0) / STEP;
      const i = Math.floor(pos);
      if (i > today + 10) return stop(true);
      if (i >= 0 && i !== shown && i <= today) {
        shown = i;
        scrubTo(i, true);
        document.title = `▶ ${dateLabel(i)} · ${title}`;
      }
      score.style.setProperty("--ph", Math.max(0, Math.min(pos, today)) / n);
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
    if (e.key === "Escape") { stop(); leaveCareer(); }
    else if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      leaveCareer();
      toggle();
    }
  });

  // Hovering is ignored while the year plays, so moving the mouse doesn't cut it off.

  const list = document.querySelector(".works");
  list.addEventListener("pointerover", (e) => {
    if (playing || career) return;
    const row = rows.find((r) => r.el === e.target.closest(".work"));
    if (row && !(score.classList.contains("is-row") && row.el.classList.contains("is-on"))) focusRow(row);
  });
  list.addEventListener("pointerleave", () => { if (!playing && !career) reset(); });
  list.addEventListener("focusin", (e) => {
    if (playing || career) return;
    const row = rows.find((r) => r.el === e.target.closest(".work"));
    if (row && !row.el.classList.contains("is-on")) focusRow(row);
  });
  list.addEventListener("focusout", (e) => { if (!playing && !career && !list.contains(e.relatedTarget)) reset(); });

  const dayAt = (e) => {
    const box = wave.getBoundingClientRect();
    return Math.floor(((e.clientX - box.left) / box.width) * n);
  };
  timeline.addEventListener("pointermove", (e) => { if (!playing && !career) scrubTo(dayAt(e)); });
  timeline.addEventListener("pointerdown", (e) => {
    if (career) return;
    stop();
    scrubTo(dayAt(e));
  });
  timeline.addEventListener("pointerleave", (e) => {
    if (!playing && !career && e.pointerType !== "touch" && document.activeElement !== wave) reset();
  });
  document.addEventListener("pointerdown", (e) => {
    if (career || playBtn.contains(e.target) || timeline.contains(e.target)) return;
    if (playing) stop();
    else if (current >= 0) reset();
  });

  wave.addEventListener("focus", () => { leaveCareer(); if (!playing) scrubTo(today); });
  wave.addEventListener("blur", () => { if (!playing) reset(); });
  wave.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 7 : 1;
    const next = {
      ArrowLeft: current - step, ArrowRight: current + step, Home: 0, End: today,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    stop();
    scrubTo(next);
  });

  document.getElementById("updated").textContent = stamp.format(parse(data.updated));
  reset();

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
      + "Press P on the page to hear the year.",
    "font: 18px/1 monospace; color: #6f7cff;",
    "font: 12px/1.5 monospace;",
  );
})();
