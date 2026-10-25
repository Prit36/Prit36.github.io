(() => {
  const clock = document.getElementById("clock");
  const clockFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const setClock = () => { clock.textContent = clockFormat.format(new Date()); };
  setClock();
  setInterval(setClock, 10000);

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
  const totalEl = document.getElementById("total");
  const noteEl = document.getElementById("note");

  const rows = [...document.querySelectorAll(".work")].map((el) => {
    const counts = new Array(n).fill(0);
    for (const [day, c] of Object.entries(data.projects[el.dataset.project] || {})) {
      const i = indexOf(day);
      if (i >= 0 && i < n) counts[i] += c;
    }
    const active = counts.flatMap((c, i) => (c ? [i] : []));
    return {
      el, counts, active, total: sum(counts), ticks: [],
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

  const mark = (className, i, vars = {}) => {
    const e = document.createElement("span");
    e.className = className;
    e.style.setProperty("--x", i / n);
    for (const [k, v] of Object.entries(vars)) e.style.setProperty(k, v);
    return e;
  };

  // Month lines, today and the playhead go into the timeline and every track,
  // so they read as one line running down the page.
  const staff = (parent) => {
    months.forEach((i) => parent.append(mark("m", i)));
    parent.append(mark("now-line", today));
    parent.append(mark("ph", 0));
  };

  staff(wave);
  const bars = [];
  for (let i = 0; i <= today && i < n; i++) {
    bars[i] = mark(totals[i] ? "d" : "d zero", i, { "--v": totals[i] / maxDay });
    wave.append(bars[i]);
  }

  const label = (text, i, className = "") => {
    const s = document.createElement("span");
    s.className = className;
    s.textContent = text;
    s.style.left = `${(i / n) * 100}%`;
    axis.append(s);
    return s;
  };
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

  // The big number and the line beside it describe whatever is in focus.

  const hour = (h) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
  const plural = (c) => (c === 1 ? "commit" : "commits");
  const all = sum(totals);
  const activeDays = totals.filter(Boolean).length;
  const overview =
    `commits since ${dayMonth.format(parse(data.first))} ${data.first.slice(0, 4)}, ` +
    `on ${activeDays} different days. ${Math.round(data.weekendShare * 100)}% of them ` +
    `on a weekend, most often around ${hour(data.peakHour)}.`;

  const show = (num, note) => {
    totalEl.textContent = num;
    noteEl.textContent = note;
  };

  const span = (a, b) => {
    const da = dateOf(a), db = dateOf(b);
    const first = da.getUTCMonth() === db.getUTCMonth() ? da.getUTCDate() : dayMonth.format(da);
    return `between ${first} and ${dayMonth.format(db)}`;
  };

  let lit = [];
  let current = -1;

  const clear = () => {
    lit.forEach((e) => (e.classList.contains("hl") ? e.remove() : e.classList.remove("hit")));
    lit = [];
    score.classList.remove("is-row", "is-scrub");
    rows.forEach((r) => r.el.classList.remove("is-on"));
  };

  const reset = () => {
    clear();
    current = -1;
    show(all, overview);
  };

  const focusRow = (r) => {
    clear();
    score.classList.add("is-row");
    r.el.classList.add("is-on");
    r.active.forEach((i) => {
      if (i > today) return;
      const e = mark("d hl", i, { "--v": r.counts[i] / maxDay });
      wave.append(e);
      lit.push(e);
    });
    const [a, b] = [r.active[0], r.active.at(-1)];
    let when = "none yet";
    if (r.total === 1) when = `on ${dayMonth.format(dateOf(a))}`;
    else if (r.active.length === 1) when = `all on ${dayMonth.format(dateOf(a))}`;
    else if (r.active.length) when = `${span(a, b)}, on ${r.active.length} days`;
    show(r.total, `${plural(r.total)} to ${r.name}, ${when}.`);
  };

  const scrubTo = (i) => {
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
    const d = `${weekday.format(dateOf(i))}, ${dayMonth.format(dateOf(i))}`;
    show(totals[i], on.length
      ? `${plural(totals[i])} on ${d}: ${and.format(on.map((r) => r.name))}.`
      : `commits on ${d}.`);
  };

  const list = document.querySelector(".works");
  list.addEventListener("pointerover", (e) => {
    const row = rows.find((r) => r.el === e.target.closest(".work"));
    if (row && !(score.classList.contains("is-row") && row.el.classList.contains("is-on"))) focusRow(row);
  });
  list.addEventListener("pointerleave", reset);
  list.addEventListener("focusin", (e) => {
    const row = rows.find((r) => r.el === e.target.closest(".work"));
    if (row) focusRow(row);
  });
  list.addEventListener("focusout", (e) => { if (!list.contains(e.relatedTarget)) reset(); });

  const dayAt = (e) => {
    const box = wave.getBoundingClientRect();
    return Math.floor(((e.clientX - box.left) / box.width) * n);
  };
  timeline.addEventListener("pointermove", (e) => scrubTo(dayAt(e)));
  timeline.addEventListener("pointerdown", (e) => scrubTo(dayAt(e)));
  timeline.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch" && document.activeElement !== wave) reset();
  });
  document.addEventListener("pointerdown", (e) => {
    if (current >= 0 && !timeline.contains(e.target)) reset();
  });

  wave.addEventListener("focus", () => scrubTo(today));
  wave.addEventListener("blur", reset);
  wave.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 7 : 1;
    const next = {
      ArrowLeft: current - step, ArrowRight: current + step, Home: 0, End: today,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    scrubTo(next);
  });

  document.getElementById("updated").textContent = stamp.format(parse(data.updated));
  reset();
})();
