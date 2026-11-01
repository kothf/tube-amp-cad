/* The oscilloscope window (oscilloscope.html): an Oscilloscope part's channels from the CAD's
   broadcast results, steady state or power-on record, auto-ranging, markers, zoom. */
(function () {
  "use strict";
  const I = Instrument, $ = id => document.getElementById(id);
  const SM = ScopeMath, VDIV = SM.VDIV, TDIV = SM.TDIV;
  const esc = x => String(x).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const S = { mode: "dual", analysis: "steady", tStop: "auto", warmup: true, view: { tdiv: "auto", pos: 0, seq: null, event: -1 }, ch1: { vdiv: "auto", cpl: "dc" }, ch2: { vdiv: "auto", cpl: "dc" }, tdiv: "auto", hpos: 0, trig: { src: "ch1", slope: "rising" }, logT: false, ratings: true, extra: [], xv: {} };

  const fill = (sel, list, unit) => { sel.innerHTML = `<option value="auto">Auto</option>` + list.map(v => `<option value="${v}">${I.fmt(v, unit)}/div</option>`).join(""); };
  fill($("ch1-vdiv"), VDIV, "V"); fill($("ch2-vdiv"), VDIV, "V"); fill($("tdiv"), TDIV, "s");

  function channels(sc) {
    const out = {};
    ["ch1", "ch2"].forEach(k => {
      const raw = sc && sc[k];
      if (!raw) return;
      out[k] = { raw, cpl: S[k].cpl, ...SM.channel(raw, S[k].vdiv, S[k].cpl) };
    });
    return out;
  }

  // Power-on record: one value per simulation step (or, for very long runs, the
  // min and max of a few steps). raw is the midpoint, used by markers.
  let chCache = null;
  function startupChannels(ts) {
    const t = I.transient, xs = extraCaps(ts);
    const key = [S.ch1.vdiv, S.ch1.cpl, S.ch2.vdiv, S.ch2.cpl, S.ratings, xs.map(c => c.id + ":" + (S.xv["x:" + c.id] || "auto")).join("|")].join();
    if (chCache && chCache.ts === ts && chCache.t === t && chCache.key === key) return chCache.out;
    const out = {};
    ["ch1", "ch2"].forEach(k => {
      const d = ts && ts[k]; if (!d || !d.min.length) return;
      const n = d.min.length, mid = new Float32Array(n + 2), inter = new Float32Array(2 * n + 1);
      for (let i = 0; i < n; i++) { mid[i] = (d.min[i] + d.max[i]) / 2; inter[2 * i] = d.min[i]; inter[2 * i + 1] = d.max[i]; }
      mid[n] = mid[n + 1] = mid[n - 1]; inter[2 * n] = inter[2 * n - 1];
      const cpl = S[k].cpl === "ac" ? "dc" : S[k].cpl;   // AC coupling means nothing for a one-shot record
      // the voltage ratings of the capacitors this channel reads across, drawn as limit lines; the
      // automatic volts/div takes in those near the trace (within 1.5 × its largest swing)
      let big = 0; for (let i = 0; i < n; i++) big = Math.max(big, Math.abs(d.min[i]), Math.abs(d.max[i]));
      const limits = S.ratings ? capLimits(d.nets) : [], near = limits.filter(l => Math.abs(l.v) <= 1.5 * big);
      const scaled = near.length ? Float32Array.from([...inter, ...near.map(l => l.v)]) : inter;
      out[k] = { raw: mid, min: d.min, max: d.max, cpl, limits, ...SM.channel(scaled, S[k].vdiv, cpl) };
    });
    // capacitors plotted without a probe: their coarser record from the run, put on the probes' time
    // grid (each sample its bucket's low and high); their own volts/div
    const n = t && t.dt > 0 ? Math.round(t.tStop / t.dt) : 0;
    xs.forEach((c, j) => {
      if (!n || !c.lo || !t.watchDt) return;
      const nb = c.lo.length, mn = new Float32Array(n), mx = new Float32Array(n), mid = new Float32Array(n + 2);
      for (let i = 0; i < n; i++) { const b = Math.min(nb - 1, Math.floor((i + 0.5) * t.dt / t.watchDt)); mn[i] = c.lo[b]; mx[i] = c.hi[b]; mid[i] = (mn[i] + mx[i]) / 2; }
      mid[n] = mid[n + 1] = mid[n - 1];
      const limits = S.ratings ? capLimits(c.nets) : [];
      let big = 0; for (let b = 0; b < nb; b++) big = Math.max(big, Math.abs(c.lo[b]), Math.abs(c.hi[b]));
      const near = limits.filter(l => Math.abs(l.v) <= 1.5 * big), k = "x:" + c.id;
      const scaled = Float32Array.from([...c.lo.filter(Number.isFinite), ...c.hi.filter(Number.isFinite), ...near.map(l => l.v)]);
      out[k] = { raw: mid, min: mn, max: mx, cpl: "dc", limits, extra: true, id: c.id, label: c.label + (c.bplus ? " (B+)" : ""), auto: !!c.auto,
        color: XCOLORS[j % XCOLORS.length], ...SM.channel(scaled, S.xv[k] || "auto", "dc") };
    });
    chCache = { ts, t, key, out };
    return out;
  }
  // the capacitors plotted without a probe: those picked in the report, and B+ (the first reservoir
  // capacitor) when no probe is wired to this scope
  const XCOLORS = ["#ff8ad8", "#9dff7a", "#ffb35c", "#c8a2ff"];
  function extraCaps(ts) {
    const t = I.transient, caps = (t && t.ok && t.caps) || [];
    const list = S.extra.map(id => caps.find(c => c.id === id)).filter(c => c && c.lo);
    if (!(ts && (ts.ch1 || ts.ch2))) { const b = caps.find(c => c.bplus && c.lo); if (b && !list.includes(b)) list.unshift(Object.assign({}, b, { auto: true })); }
    return list;
  }
  const SEV = { critical: 1, warning: 2, info: 3 }, LEVEL_COLOR = { critical: "#ff6b6b", warning: "#ff9e64", info: "#8fa3b8" };
  // the capacitors across a channel's two nets (its input and the scope's common), each with its
  // voltage rating signed as the channel reads it; one line per rating
  function capLimits(nets) {
    const t = I.transient; if (!nets || !t || !t.caps) return [];
    const out = [];
    t.caps.forEach(c => {
      if (!(c.rating > 0)) return;
      const sgn = c.nets[0] === nets[0] && c.nets[1] === nets[1] ? 1 : c.nets[0] === nets[1] && c.nets[1] === nets[0] ? -1 : 0;
      if (!sgn) return;
      const v = sgn * c.rating, have = out.find(l => l.v === v);
      if (have) have.labels.push(c.label); else out.push({ v, labels: [c.label], level: c.level });
      if (have && (SEV[c.level] || 9) < (SEV[have.level] || 9)) have.level = c.level;
    });
    return out;
  }
  // Final level and swing (last 5 % of the record), peak, and the settling time:
  // when the signal's envelope (sliding max/min over 1 % of the record, so an
  // audio signal counts by its amplitude, not by its phase) last left ±2 % of
  // its final level and swing.
  const settleCache = new WeakMap();
  function settleInfo(c, dt) {
    if (settleCache.has(c.min)) return settleCache.get(c.min);
    // sliding max/min over 1 % of the record, in blocks of w (fast for long records)
    const n = c.min.length, w = Math.max(1, Math.round(n / 100)), nb = Math.ceil(n / w), bh = new Float32Array(nb), bl = new Float32Array(nb), hi = new Float32Array(n), lo = new Float32Array(n);
    for (let b = 0; b < nb; b++) { let a = -Infinity, z = Infinity; for (let j = b * w; j < Math.min(n, (b + 1) * w); j++) { if (c.max[j] > a) a = c.max[j]; if (c.min[j] < z) z = c.min[j]; } bh[b] = a; bl[b] = z; }
    for (let i = 0; i < n; i++) {
      const b = Math.floor(i / w); let a = bh[b], z = bl[b];
      if (b > 0) { a = Math.max(a, bh[b - 1]); z = Math.min(z, bl[b - 1]); }
      if (b < nb - 1) { a = Math.max(a, bh[b + 1]); z = Math.min(z, bl[b + 1]); }
      hi[i] = a; lo[i] = z;
    }
    const tail = Math.max(1, Math.round(n * 0.05));
    let f = 0, sw = 0;
    for (let i = n - tail; i < n; i++) { f += (hi[i] + lo[i]) / 2; sw += hi[i] - lo[i]; }
    f /= tail; sw /= tail;
    let pk = -Infinity, pkAt = 0, mn = Infinity;
    for (let i = 0; i < n; i++) { if (c.max[i] > pk) { pk = c.max[i]; pkAt = i; } if (c.min[i] < mn) mn = c.min[i]; }
    const tol = 0.02 * Math.max(Math.abs(f), sw, 1e-3 / 0.02);
    let last = -1;
    for (let i = 0; i < n; i++) if (Math.abs((hi[i] + lo[i]) / 2 - f) > tol || Math.abs(hi[i] - lo[i] - sw) > tol) last = i;
    const q = { final: f, swing: sw, peak: pk, peakAt: (pkAt + 0.5) * dt, min: mn, settle: last < 0 ? 0 : (last + 1) * dt, settled: last < n - tail };
    settleCache.set(c.min, q);
    return q;
  }

  // the selected trigger source, unless it is a flat line and the other channel isn't
  const triggerChannel = ch => ch[S.trig.src] && !SM.isFlat(ch[S.trig.src].st) ? ch[S.trig.src]
    : (ch.ch1 && !SM.isFlat(ch.ch1.st) ? ch.ch1 : ch.ch2 || ch.ch1);

  // Axes: labels at round values (whole multiples of the time/div or volts/div),
  // placed where those values fall, so they follow zoom, position, volts/div and
  // offset; unpanned they sit on the graticule lines. All labels on an axis share
  // one SI prefix (from the largest) and the decimals the step needs.
  function axisText(values, step, unit) {
    const big = Math.max(...values.map(Math.abs), Math.abs(step));
    const P = [[1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"]], [f, p] = P.find(([f]) => big >= f * 0.9995) || P[P.length - 1];
    // enough decimals to write the step itself (2.5 s/div: one), four at most
    let d = Math.max(0, Math.min(4, Math.ceil(-Math.log10(Math.abs(step) / f) - 1e-9)));
    while (d < 4 && Math.abs(step / f * Math.pow(10, d) - Math.round(step / f * Math.pow(10, d))) > 1e-6) d++;
    return values.map(v => { const x = v / f; return (Math.abs(x) < 0.5 * Math.pow(10, -d) ? "0" : x.toFixed(d)) + p + unit; });
  }
  // the multiples of step in [lo, hi]
  const ticks = (lo, hi, step) => { const out = []; for (let k = Math.ceil(lo / step - 1e-6); k <= Math.floor(hi / step + 1e-6); k++) out.push(k * step); return out; };
  // h: { start, step, unit, color }: the time (or XY volts) at the left edge, per division;
  // left / right: { center, step, unit, color, ac }: the value at mid-screen, per division
  function drawAxes(ctx, h, left, right) {
    const g = G, out = {};
    ctx.save(); ctx.font = "10px ui-monospace, Menlo, monospace"; ctx.textBaseline = "middle"; ctx.lineWidth = 1;
    if (h) {
      const vals = ticks(h.start, h.start + 10 * h.step, h.step), txt = axisText(vals, h.step, h.unit);
      const wmax = Math.max(0, ...txt.map(t => ctx.measureText(t).width)), stride = Math.max(1, Math.ceil((wmax + 10) / (g.gw / 10)));
      ctx.fillStyle = ctx.strokeStyle = h.color;
      vals.forEach((v, i) => {
        const x = g.x0 + (v - h.start) / h.step * g.gw / 10;
        ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(x, g.y0 + g.gh); ctx.lineTo(x, g.y0 + g.gh + 4); ctx.stroke(); ctx.globalAlpha = 1;
        if (i % stride) return;
        ctx.textAlign = x < g.x0 + 12 ? "left" : x > g.x0 + g.gw - 12 ? "right" : "center";
        ctx.fillText(txt[i], x, g.y0 + g.gh + 13);
      });
      out.h = txt; out.hv = vals;
    }
    [[left, "right", g.x0 - 22], [right, "left", g.x0 + g.gw + 5]].forEach(([a, align, x], side) => {
      if (!a) return;
      const c = a.ac ? 0 : a.center, vals = ticks(c - 4 * a.step, c + 4 * a.step, a.step).reverse(), txt = axisText(vals, a.step, a.unit);
      ctx.fillStyle = a.color; ctx.textAlign = align;
      vals.forEach((v, j) => ctx.fillText((a.ac && v > 0 ? "+" : "") + txt[j], x, g.y0 + g.gh / 2 - (v - c) / a.step * g.gh / 8));
      out[side ? "right" : "left"] = txt;
    });
    ctx.restore();
    g.axes = out;
  }
  const vAxis = (c, color) => c && { center: c.cpl === "gnd" ? 0 : c.off, step: c.vdiv, unit: "V", color, ac: c.cpl === "ac" };

  // a channel with no probe wired in the CAD: its settings greyed, "not connected" in the title
  function markChannels(ch) { ["ch1", "ch2"].forEach(k => { const c = $("card-" + k); if (c) c.classList.toggle("off", !(ch && ch[k])); }); }
  function draw() {
    const cv = $("screen"), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    I.showStatus($("status"));
    if (S.analysis === "startup" && I.transient && !I.problem) { const t = I.transient; $("status").className = "status " + (t.running ? "idle" : t.ok ? "ok" : "bad"); $("status").textContent = t.running ? `Power-on transient… ${Math.round((t.progress || 0) * 100)} %` : t.ok ? `Power-on transient · ${I.fmt(t.tStop, "s")}${t.stale ? " · circuit changed" : ""}` : (t.error || "Power-on transient failed"); }
    ctx.fillStyle = "#03080d"; ctx.fillRect(0, 0, W, H);
    // margins: volt scales left (CH1) and right (CH2), the time scale below
    const x0 = 64, y0 = 32, gw = W - 2 * x0, gh = H - y0 - 26;
    // graticule
    ctx.strokeStyle = "rgba(0,180,216,0.16)"; ctx.lineWidth = 1;
    const logx = S.analysis === "startup" && S.logT && I.transient && I.transient.ok && !I.transient.running;   // its own grid, at 1-2-5 times
    for (let i = 0; i <= 10; i++) { if (logx && i > 0 && i < 10) continue; ctx.beginPath(); ctx.moveTo(x0 + i * gw / 10, y0); ctx.lineTo(x0 + i * gw / 10, y0 + gh); ctx.stroke(); }
    for (let j = 0; j <= 8; j++) { ctx.beginPath(); ctx.moveTo(x0, y0 + j * gh / 8); ctx.lineTo(x0 + gw, y0 + j * gh / 8); ctx.stroke(); }
    ctx.strokeStyle = "rgba(0,229,255,0.35)";
    for (let i = 0; i <= 50; i++) { if (logx) break; const x = x0 + i * gw / 50; ctx.beginPath(); ctx.moveTo(x, y0 + gh / 2 - 3); ctx.lineTo(x, y0 + gh / 2 + 3); ctx.stroke(); }
    for (let j = 0; j <= 40; j++) { if (logx) break; const y = y0 + j * gh / 40; ctx.beginPath(); ctx.moveTo(x0 + gw / 2 - 3, y); ctx.lineTo(x0 + gw / 2 + 3, y); ctx.stroke(); }

    ctx.font = "12px ui-monospace, Menlo, monospace";
    if (S.analysis === "startup") { drawStartup(ctx, x0, y0, gw, gh); return; }
    $("overview").hidden = true; $("lanes").hidden = true;
    const sc = I.scope();
    const ch = channels(sc);
    const any = ch.ch1 || ch.ch2;
    markChannels(ch);
    if (!any) {
      ctx.fillStyle = "#5c6b80"; ctx.textAlign = "center";
      ctx.fillText(sc ? "No input connected — wire CH1 / CH2 of " + sc.label + " in the CAD" : "NO SIGNAL", x0 + gw / 2, y0 + gh / 2 - 12);
      ctx.textAlign = "left"; $("meas").innerHTML = ""; G = null; renderMarks(); return;
    }
    const dt = sc.dt, N = (any.raw).length, P = N - 1;   // capture is whole periods: sample P == sample 0
    const at = SM.at;
    // timebase from the measured fundamental of the trigger channel; the CAD's
    // generator frequency is only the fallback (e.g. for a DC-only probe)
    const trigCh = triggerChannel(ch);
    const tb = SM.timebase(trigCh.raw, dt, I.result && I.result.fSig);
    const fSig = (I.result && I.result.fSig) || tb.f;
    const tdiv = S.tdiv === "auto" ? tb.tdiv : parseFloat(S.tdiv);
    const span = 10 * tdiv, M = Math.max(2, Math.round(span / dt));
    // horizontal position: the trigger point moves left by hpos (whole samples; the capture is periodic)
    const org = Math.round(S.hpos / dt), start = SM.triggerIndex(trigCh.raw, S.trig.slope) + org;
    G = { x0, y0, gw, gh, dt, M, P, start, org, tdiv, span, ch, xy: S.mode === "xy" && !!(ch.ch1 && ch.ch2) };
    const glow = (color) => { ctx.strokeStyle = color; ctx.globalAlpha = 0.18; ctx.lineWidth = 5; ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 1.7; ctx.stroke(); };
    if (G.xy) {   // CH1 along the bottom, CH2 up the left
      const a = vAxis(ch.ch1, "#ffe23d");
      drawAxes(ctx, { start: (a.ac ? 0 : a.center) - 5 * a.step, step: a.step, unit: "V", color: "#ffe23d" }, vAxis(ch.ch2, "#00e5ff"), null);
    } else {
      const on = k => ch[k] && (S.mode === "dual" || S.mode === k);
      drawAxes(ctx, { start: org * dt, step: tdiv, unit: "s", color: "#c9d6e3" },
        on("ch1") ? vAxis(ch.ch1, "#ffe23d") : on("ch2") ? vAxis(ch.ch2, "#00e5ff") : null, on("ch1") && on("ch2") ? vAxis(ch.ch2, "#00e5ff") : null);
    }
    const levels = [];
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, gw, gh); ctx.clip();
    if (S.mode === "xy" && ch.ch1 && ch.ch2) {
      ctx.beginPath();
      for (let i = 0; i <= P; i++) {
        const vx = (ch.ch1.cpl === "gnd" ? 0 : at(ch.ch1.raw, i) - ch.ch1.off) / ch.ch1.vdiv, vy = (ch.ch2.cpl === "gnd" ? 0 : at(ch.ch2.raw, i) - ch.ch2.off) / ch.ch2.vdiv;
        const px = x0 + gw / 2 + vx * gw / 10, py = y0 + gh / 2 - vy * gh / 8;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      glow("#7fffd4");
    } else {
      [["ch1", "#ffe23d"], ["ch2", "#00e5ff"]].forEach(([k, color]) => {
        const c = ch[k]; if (!c || (S.mode !== "dual" && S.mode !== k)) return;
        const stepPx = Math.max(1, Math.floor(M / (gw * 1.5)));
        ctx.beginPath();
        for (let i = 0; i <= M; i += stepPx) {
          const v = c.cpl === "gnd" ? 0 : (at(c.raw, start + i) - c.off) / c.vdiv;
          const px = x0 + i / M * gw, py = y0 + gh / 2 - Math.max(-4.4, Math.min(4.4, v)) * gh / 8;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        glow(color);
        // channel marker at its 0 V (DC) or mean (AC) level, pinned to the edge when off screen
        const lv = c.cpl === "gnd" ? 0 : (c.cpl === "ac" ? 0 : -c.off / c.vdiv), my = y0 + gh / 2 - Math.max(-4, Math.min(4, lv)) * gh / 8;
        const arrow = lv > 4 ? "▴" : lv < -4 ? "▾" : "▸";
        levels.push([color, (k === "ch1" ? "1" : "2") + arrow, my + 4 + (k === "ch1" ? -5 : 5)]);
      });
    }
    ctx.restore();
    // the level markers sit in the margin, outside the clipped screen
    levels.forEach(([color, t, y]) => { ctx.fillStyle = color; ctx.fillText(t, x0 - 16, y); });
    // markers
    pick.list.forEach((m, i) => { const p = markerPos(m); if (p) MarkerPicker.draw(ctx, p.x, p.y, MarkerPicker.LETTERS[i], m.ch === "ch2" ? "#00e5ff" : m.ch === "ch1" ? "#ffe23d" : "#7fffd4"); });
    if (hover && !G.xy) {
      const x = x0 + hover.i / M * gw; ctx.strokeStyle = "rgba(230,237,243,0.22)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + gh); ctx.stroke(); ctx.setLineDash([]);
      cursorLabel(ctx, x, [[fmtT((hover.i + G.org) * dt), "#c9d6e3"], ...KEYS.filter(shown).map(k => [`${k.toUpperCase()} ${I.fmt(valueAt(ch[k], hover.i), "V")}`, k === "ch1" ? "#ffe23d" : "#00e5ff"])]);
    }
    // readout
    ctx.fillStyle = "#ffe23d"; let tx = x0;
    const label = (n, c) => `CH${n} ${I.fmt(c.vdiv, "V")}${c.cpl === "ac" ? "~" : ""}${c.offset ? ` offset ${I.fmt(c.offset, "V")}` : ""}`;
    if (ch.ch1) { const s = label(1, ch.ch1); ctx.fillText(s, tx, 16); tx += ctx.measureText(s).width + 18; }
    ctx.fillStyle = "#00e5ff";
    if (ch.ch2) { const s = label(2, ch.ch2); ctx.fillText(s, tx, 16); tx += ctx.measureText(s).width + 18; }
    ctx.fillStyle = "#c9d6e3"; ctx.fillText(`M ${I.fmt(tdiv, "s")}${org ? `   Pos ${fmtT(org * dt)}` : ""}   Trig ${S.trig.src.toUpperCase()} ${S.trig.slope === "rising" ? "↑" : "↓"}`, tx, 16);

    // measurements
    let h = "";
    [["ch1", "c1"], ["ch2", "c2"]].forEach(([k, cls]) => {
      const c = ch[k]; if (!c) return;
      const f = SM.fundamental(c.raw, dt);
      h += `<span class="${cls}">${k.toUpperCase()}: <b>${I.fmt(c.st.pp, "Vpp")}</b> · ${I.fmt(c.st.rms, "Vrms")} AC (${I.dbv(c.st.rms)}) · ${I.fmt(c.st.mean, "V")} DC · ${f ? I.fmt(f, "Hz") : "—"}</span>`;
    });
    if (ch.ch1 && ch.ch2 && fSig) {
      const a = I.dft(ch.ch1.raw, fSig, dt), b = I.dft(ch.ch2.raw, fSig, dt);
      if (a.amp > 1e-9 && b.amp > 1e-9) {
        let ph = (b.phase - a.phase) * 180 / Math.PI; ph = ((ph + 540) % 360) - 180;
        h += `<span>CH1/CH2 at ${I.fmt(fSig, "Hz")}: <b>${(a.amp / b.amp).toPrecision(3)}×</b> (${(20 * Math.log10(a.amp / b.amp)).toFixed(1)} dB), phase <b>${(-ph).toFixed(0)}°</b></span>`;
      }
    }
    $("meas").innerHTML = h;
    renderMarks();
  }

  // time/div choices for the power-on record: a zoom ladder up to the whole record
  // (the scope's own steps, then 0.5 to 5 s/div for a long warm-up record)
  const zoomSteps = tStop => SM.TDIV.concat([0.5, 1, 2, 5]).filter(v => v < tStop / 10 * 0.999).concat([tStop / 10]);
  // default zoom: a few periods of the circuit's signal; a DC-only circuit shows the whole record
  // a long record of the cathodes warming up opens whole; a short one on a few signal periods
  const wholeByDefault = t => !!t.warmup && t.tStop >= 5;
  function defaultTdiv(t) {
    if (wholeByDefault(t)) return t.tStop / 10;
    const f = I.result && I.result.fSig;
    return f ? Math.min(t.tStop / 10, SM.pick(SM.TDIV, 5 / f / 10)) : t.tStop / 10;
  }
  function viewOf(t) {
    const v = S.view;
    if (v.seq !== t.seq) { v.seq = t.seq; v.pos = 0; v.event = -1; }       // a new record starts at power-on
    const tdiv = v.tdiv === "auto" ? defaultTdiv(t) : v.tdiv === "full" ? t.tStop / 10 : Math.min(+v.tdiv, t.tStop / 10);
    const span = 10 * tdiv;
    v.pos = Math.max(0, Math.min(t.tStop - span, v.pos));
    return { tdiv, span, pos: v.pos };
  }
  // draw a channel over [i0, i0 + count] samples into width gw: an envelope per pixel
  // when there are more samples than pixels, the waveform itself when zoomed further
  function trace(ctx, c, i0, count, x0, gw, ys) {
    const n = c.min.length, spp = count / gw;
    ctx.beginPath();
    if (spp > 1) {
      const top = [], bot = [];
      for (let px = 0; px < gw; px++) {
        const a = Math.max(0, Math.floor(i0 + px * spp)), b = Math.min(n, Math.ceil(i0 + (px + 1) * spp));
        let hi = -Infinity, lo = Infinity;
        for (let i = a; i < b; i++) { if (c.max[i] > hi) hi = c.max[i]; if (c.min[i] < lo) lo = c.min[i]; }
        if (hi === -Infinity) break;
        top.push(ys(c, hi)); bot.push(ys(c, lo));
      }
      top.forEach((y, px) => px ? ctx.lineTo(x0 + px, y) : ctx.moveTo(x0, y));
      for (let px = bot.length - 1; px >= 0; px--) ctx.lineTo(x0 + px + 1, bot[px]);
      ctx.closePath();
      return "fill";
    }
    for (let i = Math.max(0, Math.floor(i0)), k = 0; i <= Math.min(n - 1, Math.ceil(i0 + count)); i++, k++) {
      const x = x0 + (i - i0) / count * gw, y = ys(c, c.raw[i]);
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    return "line";
  }
  // Time axis of the power-on screen: linear over the window, or (Log time) log10(t + ε) over it, so
  // the first milliseconds' inrush and the seconds of warm-up share one screen. ε: 1 ms (less for a
  // window under a second), at least one sample.
  function timeMap(vw, dt, x0, gw) {
    const a = vw.pos, b = vw.pos + vw.span;
    if (!S.logT) return { log: false, tx: t => x0 + (t - a) / vw.span * gw, xt: x => a + (x - x0) / gw * vw.span };
    const eps = Math.max(dt, Math.min(1e-3, vw.span / 1000)), L = t => Math.log10(Math.max(0, t) + eps), la = L(a), lb = L(b);
    return { log: true, eps, tx: t => x0 + (L(t) - la) / (lb - la) * gw, xt: x => Math.pow(10, la + (x - x0) / gw * (lb - la)) - eps };
  }
  // a channel through a time map: the waveform itself when zoomed in past one sample a pixel, else
  // an envelope per pixel (min to max of its samples; a pixel narrower than a sample reads the
  // waveform there)
  function traceMap(ctx, c, dt, M, x0, gw, ys) {
    const n = c.min.length, t0 = M.xt(x0), t1 = M.xt(x0 + gw);
    ctx.beginPath();
    if (!M.log && (t1 - t0) / dt <= gw) {
      for (let i = Math.max(0, Math.floor(t0 / dt)), k = 0; i <= Math.min(n - 1, Math.ceil(t1 / dt)); i++, k++) {
        const x = M.tx(i * dt), y = ys(c, c.raw[i]);
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      return "line";
    }
    const top = [], bot = [], at = f => { const j = Math.max(0, Math.min(n - 1, Math.floor(f))), q = Math.max(0, Math.min(1, f - j)), u = c.raw[j], w = c.raw[Math.min(n - 1, j + 1)]; return u + (w - u) * q; };
    for (let px = 0; px < gw; px++) {
      const ta = M.xt(x0 + px), tb = M.xt(x0 + px + 1);
      if (ta / dt >= n) break;
      if (tb - ta < dt) { const y = ys(c, at(ta / dt)); top.push(y); bot.push(y); continue; }
      const a = Math.max(0, Math.floor(ta / dt)), b = Math.min(n, Math.max(a + 1, Math.ceil(tb / dt)));
      let hi = -Infinity, lo = Infinity;
      for (let i = a; i < b; i++) { if (c.max[i] > hi) hi = c.max[i]; if (c.min[i] < lo) lo = c.min[i]; }
      top.push(ys(c, hi)); bot.push(ys(c, lo));
    }
    top.forEach((y, px) => px ? ctx.lineTo(x0 + px, y) : ctx.moveTo(x0, y));
    for (let px = bot.length - 1; px >= 0; px--) ctx.lineTo(x0 + px + 1, bot[px]);
    ctx.closePath();
    return "fill";
  }
  // 1-2-5 times over a log window, labelled at the decades (and 2, 5 when they fit)
  function drawLogAxis(ctx, M, vw, x0, y0, gw, gh) {
    const a = vw.pos, b = vw.pos + vw.span, out = [];
    for (let d = Math.floor(Math.log10(Math.max(M.eps, 1e-9))); d <= Math.ceil(Math.log10(b)); d++)
      [1, 2, 5].forEach(m => { const v = m * Math.pow(10, d); if (v > a + M.eps * 0.5 && v <= b * 1.0001) out.push({ v, major: m === 1 }); });
    ctx.save(); ctx.font = "10px ui-monospace, Menlo, monospace"; ctx.textBaseline = "middle"; ctx.lineWidth = 1;
    let lastX = -1e9;
    const lbl = [];
    [{ v: a, major: true, edge: true }, ...out].forEach(({ v, major, edge }) => {
      const x = M.tx(v); if (x < x0 - 0.5 || x > x0 + gw + 0.5) return;
      if (!edge) { ctx.strokeStyle = major ? "rgba(0,180,216,0.22)" : "rgba(0,180,216,0.10)"; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + gh); ctx.stroke(); }
      const txt = v === 0 ? "0" : I.fmt(v, "s"), w = ctx.measureText(txt).width;
      if ((major || edge || x - lastX > w + 14) && x - lastX > w + 8) {
        ctx.fillStyle = "#c9d6e3"; ctx.textAlign = x < x0 + 12 ? "left" : x > x0 + gw - 12 ? "right" : "center";
        ctx.fillText(txt, x, y0 + gh + 13); lastX = x; lbl.push(txt);
      }
    });
    ctx.restore();
    return lbl;
  }
  // the run's events (the report strip's rows) inside [a, b]
  const eventsOf = t => (t && t.ok && !t.running && t.events) || [];
  function drawStartup(ctx, x0, y0, gw, gh) {
    const t = I.transient, ts = I.transientScope(), ov = $("overview");
    const msg = (lines) => { ov.hidden = true; $("lanes").hidden = true; ctx.fillStyle = "#5c6b80"; ctx.textAlign = "center"; lines.forEach((l, i) => ctx.fillText(l, x0 + gw / 2, y0 + gh / 2 - 12 + i * 18)); ctx.textAlign = "left"; $("meas").innerHTML = ""; G = null; renderMarks(); };
    if (t && t.running) {
      const p = Math.max(0, Math.min(1, t.progress || 0));
      ctx.strokeStyle = "#26344a"; ctx.strokeRect(x0 + gw * 0.2, y0 + gh / 2 + 14, gw * 0.6, 10);
      ctx.fillStyle = "#00b4d8"; ctx.fillRect(x0 + gw * 0.2, y0 + gh / 2 + 14, gw * 0.6 * p, 10);
      return msg([`Simulating the first ${I.fmt(t.tStop, "s")} after power-on${t.warmup ? ", the cathodes warming up" : ""}… ${Math.round(p * 100)} %`]);
    }
    if (!t) return msg([`Power-on transient: press ▶ Run to simulate the first ${S.tStop === "auto" ? (S.warmup ? "seconds, until the cathodes are warm," : "second") : I.fmt(+S.tStop, "s")} after switch-on.`,
      `Every capacitor starts empty and every source switches on at t = 0${S.warmup ? "; the tubes' cathodes start cold and warm up" : ""}.`]);
    if (!t.ok) return msg([`Power-on transient: ${t.error || "failed"}`]);
    const ch = startupChannels(ts), keys = Object.keys(ch), any = ch[keys[0]];
    markChannels(ch);
    if (!any) return msg([ts ? "No input connected — wire CH1 / CH2 of " + ts.label + " in the CAD" : "This scope part was not in the simulated circuit"]);
    const n = any.min.length, dt = t.dt, vw = viewOf(t);
    const i0 = Math.round(vw.pos / dt), count = vw.span / dt, M = timeMap(vw, dt, x0, gw);
    G = { x0, y0, gw, gh, dt, M: count, P: n, start: i0, org: i0, ch, xy: false, startup: true, t, vw, tx: M.tx, xt: M.xt, log: M.log };
    const ys = (c, v) => y0 + gh / 2 - Math.max(-4.4, Math.min(4.4, c.cpl === "gnd" ? 0 : (v - c.off) / c.vdiv)) * gh / 8;
    {   // time after power-on along the bottom; volts as in steady state
      // left: CH1, else CH2, else the first capacitor plotted unprobed; right: CH2 beside CH1
      const on = k => ch[k] && (S.mode === "dual" || S.mode === k || S.mode === "xy"), xk = keys.find(k => ch[k].extra);
      drawAxes(ctx, M.log ? null : { start: vw.pos, step: vw.tdiv, unit: "s", color: "#c9d6e3" },
        on("ch1") ? vAxis(ch.ch1, "#ffe23d") : on("ch2") ? vAxis(ch.ch2, "#00e5ff") : xk ? vAxis(ch[xk], ch[xk].color) : null, on("ch1") && on("ch2") ? vAxis(ch.ch2, "#00e5ff") : null);
      if (M.log) G.axes.h = drawLogAxis(ctx, M, vw, x0, y0, gw, gh);
    }
    const levels = [];
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, gw, gh); ctx.clip();
    const glow = color => { ctx.strokeStyle = color; ctx.globalAlpha = 0.18; ctx.lineWidth = 5; ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 1.7; ctx.stroke(); };
    keys.forEach(k => {
      const c = ch[k], color = chColor(k); if (!shown(k)) return;
      if (traceMap(ctx, c, dt, M, x0, gw, ys) === "fill") { ctx.fillStyle = color; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke(); }
      else glow(color);
      const lv = c.cpl === "gnd" ? 0 : -c.off / c.vdiv, my = y0 + gh / 2 - Math.max(-4, Math.min(4, lv)) * gh / 8;
      if (!c.extra || (!ch.ch1 && !ch.ch2 && k === keys[0])) levels.push([color, (k === "ch1" ? "1" : k === "ch2" ? "2" : "") + (lv > 4 ? "▴" : lv < -4 ? "▾" : "▸"), my + 4 + (k === "ch1" ? -5 : 5)]);
    });
    // capacitor ratings: a dashed line at each, red when the trace goes well over it
    keys.forEach(k => {
      const c = ch[k]; if (!c.limits || c.cpl === "gnd" || !shown(k)) return;
      c.limits.forEach(l => {
        const d = (l.v - c.off) / c.vdiv; if (Math.abs(d) > 4.4) return;
        const y = y0 + gh / 2 - d * gh / 8, col = LEVEL_COLOR[l.level] || "#8fa3b8";
        ctx.strokeStyle = col; ctx.setLineDash([6, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + gw, y); ctx.stroke(); ctx.setLineDash([]);
        const txt = `${l.labels.join(", ")} rating ${I.fmt(Math.abs(l.v), "V")}`;
        ctx.fillStyle = col; ctx.textAlign = "right"; ctx.fillText(txt, x0 + gw - 6, y + (d > 0 ? 14 : -5)); ctx.textAlign = "left";
      });
    });
    // the report's events: a tick each along the bottom of the screen (hover: what happened)
    G.ticks = [];
    eventsOf(t).forEach((e, k) => {
      const x = M.tx(e.t); if (x < x0 - 0.5 || x > x0 + gw + 0.5) return;
      const col = LEVEL_COLOR[e.level];
      ctx.strokeStyle = col; ctx.globalAlpha = k === S.view.event ? 0.7 : 0.35; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + gh); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y0 + gh - 9); ctx.lineTo(x - 5, y0 + gh); ctx.lineTo(x + 5, y0 + gh); ctx.closePath(); ctx.fill();
      G.ticks.push({ x, k });
    });
    ctx.restore();
    levels.forEach(([color, t, y]) => { ctx.fillStyle = color; ctx.fillText(t, x0 - 16, y); });
    pick.list.forEach((m, i) => { const p = markerPos(m); if (p) MarkerPicker.draw(ctx, p.x, p.y, MarkerPicker.LETTERS[i], chColor(m.ch)); });
    if (hover) {
      const x = M.tx((hover.i + i0) * dt); ctx.strokeStyle = "rgba(230,237,243,0.22)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + gh); ctx.stroke(); ctx.setLineDash([]);
      cursorLabel(ctx, x, [[fmtT((hover.i + i0) * dt), "#c9d6e3"], ...keysOf().filter(shown).map(k => [`${chName(k)} ${I.fmt(valueAt(ch[k], hover.i), "V")}`, chColor(k)])]);
    }
    ctx.fillStyle = "#ffe23d"; let tx = x0;
    const label = (nn, c) => `CH${nn} ${I.fmt(c.vdiv, "V")}${c.offset ? ` offset ${I.fmt(c.offset, "V")}` : ""}`;
    if (ch.ch1) { const s = label(1, ch.ch1); ctx.fillText(s, tx, 16); tx += ctx.measureText(s).width + 18; }
    ctx.fillStyle = "#00e5ff";
    if (ch.ch2) { const s = label(2, ch.ch2); ctx.fillText(s, tx, 16); tx += ctx.measureText(s).width + 18; }
    keys.filter(k => ch[k].extra).forEach(k => { const c = ch[k], s = `${c.label} ${I.fmt(c.vdiv, "V")}${c.offset ? ` offset ${I.fmt(c.offset, "V")}` : ""}`; ctx.fillStyle = c.color; ctx.fillText(s, tx, 16); tx += ctx.measureText(s).width + 18; });
    ctx.fillStyle = t.stale ? "#ff9e64" : "#c9d6e3";
    ctx.fillText(`${M.log ? "M log" : "M " + I.fmt(vw.tdiv, "s")}   ${I.fmt(vw.pos, "s")} … ${I.fmt(vw.pos + vw.span, "s")} of ${I.fmt(t.tStop, "s")} after power-on${t.stale ? "   circuit changed since — ▶ Run again" : ""}`, tx, 16);
    drawOverview(ch, t, vw);
    let h = "";
    keys.forEach(k => {
      const c = ch[k], cls = k === "ch1" ? "c1" : k === "ch2" ? "c2" : "";
      const q = settleInfo(c, dt);
      h += `<span class="${cls}"${c.extra ? ` style="color:${c.color}"` : ""}>${esc(chName(k))}: final <b>${I.fmt(q.final, "V")}</b>${q.swing > 1e-3 * Math.max(1, Math.abs(q.final)) ? ` (${I.fmt(q.swing, "Vpp")})` : ""} · peak ${I.fmt(q.peak, "V")} at ${I.fmt(q.peakAt, "s")} · ${q.settled ? `within ±2 % from <b>${I.fmt(q.settle, "s")}</b>` : "<b>not settled yet</b>"}</span>`;
    });
    if (keys.some(k => ch[k].auto)) h += `<span class="hint">No probe on this scope: B+ shown from the run (wire CH1 / CH2 in the CAD for other nets, or pick a capacitor under Show)</span>`;
    $("meas").innerHTML = h;
    renderMarks();
    drawLanes(t, M, vw);
  }
  // the whole record under the screen, with the visible window marked and a tick at each of the
  // report's events; click or drag to scroll
  let ovTicks = [];
  function drawOverview(ch, t, vw) {
    const cv = $("overview"); cv.hidden = false;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#03080d"; ctx.fillRect(0, 0, W, H);
    const pad = 64, gw = W - 2 * pad;               // lines up with the screen's grid
    Object.keys(ch).forEach(k => {
      const c = ch[k], color = chColor(k); if (!shown(k)) return;
      const ys = (c, v) => H / 2 - Math.max(-4.4, Math.min(4.4, c.cpl === "gnd" ? 0 : (v - c.off) / c.vdiv)) * (H - 6) / 9;
      trace(ctx, c, 0, c.min.length, pad, gw, ys);
      ctx.fillStyle = color; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    });
    ovTicks = [];
    eventsOf(t).forEach((e, k) => {
      const x = pad + e.t / t.tStop * gw, col = LEVEL_COLOR[e.level];
      ctx.strokeStyle = col; ctx.lineWidth = k === S.view.event ? 2 : 1; ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, H - 1); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 7); ctx.closePath(); ctx.fill();
      ovTicks.push({ x, k });
    });
    const a = pad + vw.pos / t.tStop * gw, w = Math.max(3, vw.span / t.tStop * gw);
    ctx.fillStyle = "rgba(0,180,216,0.18)"; ctx.fillRect(a, 1, w, H - 2);
    ctx.strokeStyle = "#00b4d8"; ctx.lineWidth = 1.5; ctx.strokeRect(a, 1, w, H - 2);
    ctx.fillStyle = "#8b949e"; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillText("0", 4, H - 6);
    ctx.textAlign = "right"; ctx.fillText(I.fmt(t.tStop, "s"), W - 3, H - 6); ctx.textAlign = "left";
  }

  // --- per-tube warm-up lanes under the overview strip, on the screen's time axis: each heated
  // tube's emission (the share of its hot emission, Richardson's law over T(t) = room + (hot − room)
  // (1 − e^(−t/τ))) as a bar that fills, a mark where it reaches 90 % ("warm at"), orange where the
  // run found it overdrawn with its cathode cold; at the right its emission at the cursor (or at
  // the window's end)
  const LANE = 18, tr = x => (window.I18n && window.I18n.lang === "ru" && window.I18n.ru(x)) || x;   // canvas text in the interface's language
  function emission(C, tt, tau) {
    const T = C.room + (C.hot - C.room) * (1 - Math.exp(-Math.max(tt, 0) / Math.max(tau, 1e-6)));
    return Math.pow(T / C.hot, 2) * Math.exp(C.b * (1 / C.hot - 1 / T));
  }
  function warmAt(C, tau, share) { let a = 0, b = 30 * tau; for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (emission(C, m, tau) < share) a = m; else b = m; } return (a + b) / 2; }
  let laneInfo = [];
  function drawLanes(t, M, vw) {
    const cv = $("lanes"), C = t && t.cathode, tubes = (t && t.ok && t.warmup && C && t.tubes || []).filter(x => x.tau > 0);
    laneInfo = [];
    cv.hidden = !tubes.length; if (!tubes.length) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = tubes.length * LANE + 2;
    if (cv.style.height !== H + "px") cv.style.height = H + "px";
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const x0 = 64, gw = W - 128, at = hover && G && G.startup ? (hover.i + G.org) * G.dt : vw.pos + vw.span;
    ctx.font = "10px ui-monospace, Menlo, monospace"; ctx.textBaseline = "middle";
    tubes.forEach((u, j) => {
      const y = 1 + j * LANE, h = LANE - 4, w90 = warmAt(C, u.tau, 0.9), pct = Math.round(100 * Math.min(1, emission(C, at, u.tau)));
      ctx.fillStyle = "#0d1520"; ctx.fillRect(x0, y, gw, h);
      for (let px = 0; px < gw; px++) {
        const f = Math.min(1, emission(C, M.xt(x0 + px + 0.5), u.tau)); if (f < 0.005) continue;
        ctx.fillStyle = `rgba(0,180,216,${(0.18 + 0.5 * f).toFixed(3)})`; ctx.fillRect(x0 + px, y + h * (1 - f), 1, h * f);
      }
      (u.coldSpans || []).forEach(([a, b]) => {
        const xa = Math.max(x0, M.tx(a)), xb = Math.min(x0 + gw, M.tx(b)); if (xb < x0 || xa > x0 + gw) return;
        ctx.fillStyle = "rgba(255,158,100,0.85)"; ctx.fillRect(xa, y, Math.max(2, xb - xa), h);
      });
      const xw = M.tx(w90);
      if (xw >= x0 && xw <= x0 + gw) { ctx.strokeStyle = "#e6edf3"; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(xw + 0.5, y); ctx.lineTo(xw + 0.5, y + h); ctx.stroke(); ctx.setLineDash([]); }
      const name = `${u.label} (${u.tube})`, warm = tr(`warm at ${I.fmt(w90, "s", 1)}`);
      ctx.lineWidth = 3; ctx.strokeStyle = "#0d1520"; ctx.textAlign = "left"; ctx.strokeText(name, x0 + 4, y + h / 2); ctx.fillStyle = "#e6edf3"; ctx.fillText(name, x0 + 4, y + h / 2);
      ctx.textAlign = "right"; ctx.strokeText(warm, x0 + gw - 4, y + h / 2); ctx.fillStyle = "#c9d6e3"; ctx.fillText(warm, x0 + gw - 4, y + h / 2); ctx.lineWidth = 1;
      ctx.textAlign = "left"; ctx.fillStyle = pct >= 90 ? "#3fb950" : "#8fa3b8"; ctx.fillText(pct + " %", x0 + gw + 6, y + h / 2);
      laneInfo.push({ id: u.id, label: u.label, tube: u.tube, tau: u.tau, warmAt: w90, pct, at, cold: (u.coldSpans || []).slice(), y, h });
    });
  }

  // --- markers: A and B on a trace (time + voltage), or on the X-Y figure --
  let G = null, hover = null;
  const KEYS = ["ch1", "ch2"], keysOf = () => (G ? Object.keys(G.ch) : KEYS);
  // a capacitor plotted unprobed (key "x:<id>") shows in every display mode
  const shown = k => G && G.ch[k] && (G.ch[k].extra || S.mode === "dual" || S.mode === k);
  const chColor = k => k === "ch1" ? "#ffe23d" : k === "ch2" ? "#00e5ff" : (G && G.ch[k] && G.ch[k].color) || "#7fffd4";
  const chName = k => k === "ch1" || k === "ch2" ? k.toUpperCase() : (G && G.ch[k] && G.ch[k].label) || k;
  // channel value at a fractional display index (linear between samples)
  const valueAt = (c, i) => { const j = Math.floor(i), f = i - j, a = SM.at(c.raw, G.start + j), b = SM.at(c.raw, G.start + j + 1); return a + (b - a) * f; };
  const screenY = (c, v) => G.y0 + G.gh / 2 - Math.max(-4.4, Math.min(4.4, c.cpl === "gnd" ? 0 : (v - c.off) / c.vdiv)) * G.gh / 8;
  const xyPoint = i => { const a = G.ch.ch1, b = G.ch.ch2, vx = a.cpl === "gnd" ? 0 : (SM.at(a.raw, i) - a.off) / a.vdiv, vy = b.cpl === "gnd" ? 0 : (SM.at(b.raw, i) - b.off) / b.vdiv;
    return { x: G.x0 + G.gw / 2 + vx * G.gw / 10, y: G.y0 + G.gh / 2 - vy * G.gh / 8 }; };
  function snap(x, y) {
    if (!G || x < G.x0 - 4 || x > G.x0 + G.gw + 4 || y < G.y0 - 4 || y > G.y0 + G.gh + 4) return null;
    if (G.xy) {
      // nearest point of the X-Y figure
      let best = 0, bd = Infinity;
      for (let i = 0; i < G.P; i++) { const p = xyPoint(i), d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = i; } }
      return { xy: true, i: best };
    }
    // power-on: through the screen's time axis (linear or log)
    const i = G.startup ? Math.max(0, Math.min(G.M, rel(Math.max(G.vw.pos, Math.min(G.vw.pos + G.vw.span, G.xt(Math.max(G.x0, Math.min(G.x0 + G.gw, x)))))))) : Math.max(0, Math.min(G.M, (x - G.x0) / G.gw * G.M));
    // the visible trace nearest the pointer at that time
    const ks = keysOf().filter(shown); if (!ks.length) return null;
    const k = ks.reduce((b, k) => Math.abs(screenY(G.ch[k], valueAt(G.ch[k], i)) - y) < Math.abs(screenY(G.ch[b], valueAt(G.ch[b], i)) - y) ? k : b);
    return { ch: k, t: (i + G.org) * G.dt };   // time from the trigger (power-on: from switch-on)
  }
  function markerPos(m) {
    if (!G) return null;
    if (m.xy) return G.xy ? xyPoint(m.i) : null;
    if (G.xy || !shown(m.ch)) return null;
    const i = rel(m.t); if (i > G.M + 1e-6 || i < -1e-6) return null;
    return { x: G.startup ? G.tx(m.t) : G.x0 + i / G.M * G.gw, y: screenY(G.ch[m.ch], valueAt(G.ch[m.ch], i)) };
  }
  // what a marker reads now: time from the trigger and the channel voltage(s)
  function reading(m) {
    if (!markerPos(m)) return null;
    if (m.xy) return { v1: SM.at(G.ch.ch1.raw, m.i), v2: SM.at(G.ch.ch2.raw, m.i) };
    const r = { t: m.t, ch: m.ch, v: valueAt(G.ch[m.ch], rel(m.t)) };
    if (G.startup) { const c = G.ch[m.ch], j = Math.min(c.min.length - 1, Math.round(m.t / G.dt)); r.lo = c.min[j]; r.hi = c.max[j]; }
    return r;
  }
  // display index of a marker time (power-on markers are absolute, the window scrolls)
  const rel = t => t / G.dt - G.org;
  const cursorLabel = (ctx, x, parts) => MarkerPicker.label(ctx, x, G.y0 + 4, G.x0, G.x0 + G.gw, parts);
  const fmtT = t => (t >= 0 ? "+" : "") + I.fmt(t, "s", Math.abs(t) < 1e-9 ? 0 : undefined);
  function renderMarks() {
    const el = $("marks"), rs = pick.list.map(reading);
    let h = "";
    rs.forEach((r, i) => {
      if (!r) return;
      const L = MarkerPicker.LETTERS[i];
      h += r.v1 !== undefined
        ? `<span>${L}: <b class="c1">X ${I.fmt(r.v1, "V")}</b> <b class="c2">Y ${I.fmt(r.v2, "V")}</b></span>`
        : `<span class="${r.ch === "ch1" ? "c1" : r.ch === "ch2" ? "c2" : ""}"${r.ch === "ch1" || r.ch === "ch2" ? "" : ` style="color:${chColor(r.ch)}"`}>${L} ${esc(chName(r.ch))}: <b>${I.fmt(r.v, "V")}</b>${r.hi - r.lo > 1e-3 * Math.max(1, Math.abs(r.v)) ? ` (${I.fmt(r.lo, "V")} … ${I.fmt(r.hi, "V")})` : ""} at ${fmtT(r.t)}</span>`;
    });
    if (rs.length === 2 && rs[0] && rs[1]) {
      if (rs[0].t !== undefined) {
        const dT = rs[1].t - rs[0].t, dV = rs[1].v - rs[0].v;
        h += `<span>ΔT <b>${I.fmt(dT, "s")}</b>${Math.abs(dT) > 1e-12 ? ` (1/ΔT ${I.fmt(1 / Math.abs(dT), "Hz")})` : ""} · ΔV <b>${I.fmt(dV, "V")}</b></span>`;
      } else h += `<span>ΔX <b>${I.fmt(rs[1].v1 - rs[0].v1, "V")}</b> · ΔY <b>${I.fmt(rs[1].v2 - rs[0].v2, "V")}</b></span>`;
    }
    if (!h && G) h = `<span class="hint">Click a trace to place marker A, then B, to measure time and voltage. Drag to move, double-click to remove.</span>`;
    if (pick.list.length) h += `<button class="btn" id="marks-clear" title="Remove the markers (Esc)">Clear markers</button>`;
    el.innerHTML = h;
    const b = $("marks-clear"); if (b) b.onclick = () => pick.clear();
  }
  const pick = MarkerPicker($("screen"), {
    snap, pos: markerPos,
    hover: m => { hover = m && !m.xy ? { i: rel(m.t) } : null; draw(); },
    change: () => draw()
  });

  // controls
  document.querySelectorAll("#mode .btn").forEach(b => b.addEventListener("click", () => { if (S.analysis === "startup" && b.dataset.v === "xy") return; S.mode = b.dataset.v; if ((S.mode === "xy") !== !!(G && G.xy)) pick.clear(); document.querySelectorAll("#mode .btn").forEach(x => x.classList.toggle("active", x === b)); draw(); }));
  const bindSel = (id, set) => $(id).addEventListener("change", e => { set(e.target.value); draw(); });
  bindSel("ch1-vdiv", v => S.ch1.vdiv = v); bindSel("ch2-vdiv", v => S.ch2.vdiv = v);
  bindSel("ch1-cpl", v => S.ch1.cpl = v); bindSel("ch2-cpl", v => S.ch2.cpl = v);
  bindSel("tdiv", v => { if (S.analysis === "startup") { S.view.tdiv = v; S.view.preset = null; syncPresets(); } else S.tdiv = v; }); bindSel("trig-src", v => S.trig.src = v); bindSel("trig-slope", v => S.trig.slope = v);
  $("btn-autoset").addEventListener("click", () => {
    S.ch1.vdiv = S.ch2.vdiv = S.tdiv = "auto"; S.hpos = 0; S.xv = {};
    const ch = channels(I.scope());
    ["ch1", "ch2"].forEach(k => { if (S[k].cpl === "gnd") S[k].cpl = "dc"; $(k + "-cpl").value = S[k].cpl; $(k + "-vdiv").value = "auto"; });
    // trigger on the channel with the largest visible swing
    const live = ["ch1", "ch2"].filter(k => ch[k] && !SM.isFlat(ch[k].st)).sort((p, q) => ch[q].st.pp / ch[q].vdiv - ch[p].st.pp / ch[p].vdiv);
    if (live.length) { S.trig.src = live[0]; $("trig-src").value = live[0]; }
    $("tdiv").value = "auto"; draw();
  });
  $("btn-cad").addEventListener("click", () => ToolWindows.open("circuit_sandbox.html"));
  $("btn-board").addEventListener("click", () => ToolWindows.openBoard());
  // Time/div lists: the scope's own in steady state; in power-on mode a zoom ladder up to the whole record
  let tdivFor = null;
  function fillTdiv() {
    const st = S.analysis === "startup", tStop = st ? ((I.transient && I.transient.ok && I.transient.tStop) || (S.tStop === "auto" ? 1 : +S.tStop)) : 0, whole = st && I.transient && I.transient.ok && wholeByDefault(I.transient), key = st ? "p" + tStop + whole : "s";
    if (tdivFor === key) return; tdivFor = key;
    const sel = $("tdiv");
    if (!st) { fill(sel, TDIV, "s"); sel.value = S.tdiv; return; }
    sel.innerHTML = `<option value="auto">Auto (${whole ? "the whole record" : "a few periods"})</option>` + zoomSteps(tStop).slice(0, -1).map(v => `<option value="${v}">${I.fmt(v, "s")}/div</option>`).join("") + `<option value="full">Whole record (${I.fmt(tStop / 10, "s")}/div)</option>`;
    if (![...sel.options].some(o => o.value === String(S.view.tdiv))) S.view.tdiv = "auto";
    sel.value = String(S.view.tdiv);
  }
  // zoom (wheel) around the pointer and scroll (Shift+wheel, ← →, overview strip)
  function zoomTo(tdiv, anchorFrac) {
    if (!G || !G.startup) return;
    const vw = G.vw, at = vw.pos + anchorFrac * vw.span;
    S.view.tdiv = tdiv >= G.t.tStop / 10 * 0.999 ? "full" : tdiv; S.view.preset = null; syncPresets();
    S.view.pos = at - anchorFrac * 10 * Math.min(tdiv, G.t.tStop / 10);
    fillTdiv(); $("tdiv").value = String(S.view.tdiv); draw();
  }
  const scrollBy = dtime => { if (!G || !G.startup) return; S.view.pos += dtime; S.view.preset = null; syncPresets(); draw(); };
  // mouse zoom and pan (PlotZoom): wheel = time/div around the pointer, Ctrl+wheel = volts/div,
  // Shift+wheel or right-drag = move along the time axis. Steady state moves the trigger
  // point (horizontal position); power-on scrolls through the record.
  let wheelAcc = 0;
  const notch = k => { wheelAcc += Math.log(k); if (Math.abs(wheelAcc) < Math.log(1.2)) return 0; const d = Math.sign(wheelAcc); wheelAcc = 0; return d; };
  function zoomTime(frac, dir) {
    if (G.startup) {
      const steps = zoomSteps(G.t.tStop), cur = G.vw.tdiv;
      let k = steps.findIndex(v => v >= cur * 0.999); if (k < 0) k = steps.length - 1;
      zoomTo(steps[Math.max(0, Math.min(steps.length - 1, k + dir))], frac);
      return;
    }
    let k = TDIV.findIndex(v => v >= G.tdiv * 0.999); if (k < 0) k = TDIV.length - 1;
    const next = TDIV[Math.max(0, Math.min(TDIV.length - 1, k + dir))];
    if (next === G.tdiv) return;
    const at = S.hpos + frac * G.span;                 // time under the pointer stays put
    S.tdiv = String(next); S.hpos = at - frac * 10 * next;
    $("tdiv").value = S.tdiv; draw();
  }
  function zoomVolts(dir) {
    keysOf().filter(shown).forEach(k => {
      let j = VDIV.findIndex(v => v >= G.ch[k].vdiv * 0.999); if (j < 0) j = VDIV.length - 1;
      const v = String(VDIV[Math.max(0, Math.min(VDIV.length - 1, j + dir))]);
      if (G.ch[k].extra) { S.xv[k] = v; return; }
      S[k].vdiv = v; $(k + "-vdiv").value = v;
    });
    draw();
  }
  const moveTime = dtime => { if (G.startup) scrollBy(dtime); else { S.hpos += dtime; draw(); } };
  PlotZoom($("screen"), {
    inside: (x, y) => !!G && !G.xy && x >= G.x0 && x <= G.x0 + G.gw && y >= G.y0 && y <= G.y0 + G.gh,
    zoom: (x, y, k, vertical) => {
      const dir = notch(k); if (!dir) return;
      if (vertical) zoomVolts(dir); else zoomTime(Math.max(0, Math.min(1, G.startup ? (G.xt(x) - G.vw.pos) / G.vw.span : (x - G.x0) / G.gw)), dir);
    },
    pan: dx => moveTime(-dx / G.gw * (G.startup ? G.vw.span : G.span)),
    scroll: dir => moveTime(dir * (G.startup ? G.vw.span : G.span) / 10)
  });
  PlotZoom.hint($("screen"), [
    ["Wheel", "time/div, zooming at the pointer"],
    ["Ctrl + wheel", "volts/div"],
    ["Shift + wheel", "move along the time axis"],
    ["Right-drag", "move the trace (or Shift + drag)"],
    ["Autoset", "back to the automatic view"],
    ["Click", "place marker A, then B"]]);
  window.addEventListener("keydown", e => {
    if (S.analysis !== "startup" || !G || !G.startup || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === "ArrowRight") { scrollBy(G.vw.tdiv); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { scrollBy(-G.vw.tdiv); e.preventDefault(); }
    else if (e.key === "Home") { S.view.pos = 0; draw(); }
    else if (e.key === "End") { S.view.pos = G.t.tStop; draw(); }
    else if (PRESETS[+e.key - 1] && !e.ctrlKey && !e.metaKey && !e.altKey) { preset(PRESETS[+e.key - 1]); e.preventDefault(); }
  });
  { // overview strip: click or drag to center the window there
    const ov = $("overview");
    const go = e => { if (!G || !G.startup) return; const r = ov.getBoundingClientRect(), frac = (e.clientX - r.left - 64) / (r.width - 128); S.view.pos = frac * G.t.tStop - G.vw.span / 2; draw(); };
    ov.addEventListener("pointerdown", e => { ov.setPointerCapture(e.pointerId); go(e); });
    const base = ov.getAttribute("aria-label");
    ov.addEventListener("pointermove", e => { if (e.buttons & 1) go(e); const r = ov.getBoundingClientRect(), x = e.clientX - r.left, hit = ovTicks.find(k => Math.abs(k.x - x) <= 5); ov.title = hit ? eventLine(eventsOf(I.transient)[hit.k]) : base; });
    ov.addEventListener("wheel", e => { if (!G || !G.startup) return; e.preventDefault(); scrollBy(Math.sign(e.deltaY || e.deltaX) * G.vw.span / 2); }, { passive: false });
  }
  // --- the power-on report strip: the run's events in time order; a click zooms the screen to one ---
  const TAG = { critical: "Critical", warning: "Warning", info: "Info" }, ICON = { critical: "✖", warning: "⚠", info: "ℹ" };
  const fmtEv = t => I.fmt(t, "s", t >= 1 ? 2 : undefined);
  const eventLine = e => e ? `${fmtEv(e.t)}  ${e.who}: ${e.text} [${TAG[e.level]}]` : "";
  function verdict(list) {
    const n = l => list.filter(e => e.level === l).length, c = n("critical"), w = n("warning");
    if (!c && !w) return "No problems found";
    return [c && `${c} critical`, w && `${w} warning${w > 1 ? "s" : ""}`].filter(Boolean).join(", ");
  }
  // Show: plot any capacitor of the run without a probe (its coarser record), or take it off
  function renderShow() {
    const sel = $("pwr-show"), t = I.transient, caps = ((t && t.ok && t.caps) || []).filter(c => c.lo);
    const on = id => S.extra.includes(id) || (G && G.ch["x:" + id] && G.ch["x:" + id].auto);
    sel.innerHTML = `<option value="">Show…</option>` + caps.map(c => `<option value="${esc(c.id)}">${on(c.id) ? "✓ " : ""}${esc(c.label)}${c.bplus ? " (B+)" : ""} · ${esc(I.fmt(c.peak, "V"))} peak${c.rating ? ` of ${esc(I.fmt(c.rating, "V"))}` : ""}</option>`).join("");
    sel.value = ""; sel.disabled = !caps.length;
  }
  $("pwr-show").addEventListener("change", e => {
    const id = e.target.value; if (!id) return;
    const i = S.extra.indexOf(id);
    if (i >= 0) S.extra.splice(i, 1); else S.extra.push(id);
    pick.clear(); draw(); renderShow();
  });
  let reportKey = null;
  function renderReport(t) {
    const box = $("pwr-report"), st = S.analysis === "startup", ok = st && t && t.ok && !t.running;
    box.hidden = !ok;
    const list = ok ? eventsOf(t) : [], key = ok ? t.seq + JSON.stringify(list) + t.stale + S.view.event : "";
    if (key === reportKey) return;
    if (!ok) { reportKey = key; $("pwr-events").innerHTML = ""; return; }
    if (!reportKey || reportKey.split("[")[0] !== key.split("[")[0]) S.extra = S.extra.filter(id => (t.caps || []).some(c => c.id === id));   // a new run keeps the capacitors it still has
    reportKey = key; renderShow();
    const v = verdict(list), cls = list.some(e => e.level === "critical") ? "critical" : list.some(e => e.level === "warning") ? "warning" : "ok";
    $("pwr-verdict").className = "verdict " + cls;
    $("pwr-verdict").textContent = v + (t.stale ? " · circuit changed since: run again" : "");
    $("pwr-events").innerHTML = list.length ? list.map((e, k) => `<button class="ev ${e.level}${k === S.view.event ? " active" : ""}" data-k="${k}" role="listitem" title="${esc(e.detail || e.text)}">` +
      `<span class="ic" aria-hidden="true">${ICON[e.level]}</span><span class="tm">${esc(fmtEv(e.t))}</span><span class="who">${esc(e.who)}</span><span class="tx">${esc(e.text)}</span><span class="tag">${TAG[e.level]}</span></button>`).join("")
      : `<div class="none">No capacitor near its rating, no tube overdrawn while cold.</div>`;
    $("pwr-events").querySelectorAll(".ev").forEach(b => b.addEventListener("click", () => focusEvent(+b.dataset.k)));
  }
  // zoom to an event: fast ones (a surge, a cold-cathode current) on 200 ms around it, slow ones (a
  // capacitor's peak, B+ settling) on a quarter of the record; marker A on it
  function focusEvent(k) {
    const t = I.transient, e = eventsOf(t)[k]; if (!e || !G || !G.startup) return;
    const fast = e.kind === "cold" || e.kind === "surge" || e.t < 0.2;
    S.view.event = k; S.view.preset = null;
    S.view.tdiv = ladder(t.tStop, fast ? 0.02 : t.tStop / 40);
    const span = S.view.tdiv === "full" ? t.tStop : 10 * S.view.tdiv;
    S.view.pos = e.t - span / 2;
    fillTdiv(); $("tdiv").value = String(S.view.tdiv); syncPresets(); renderReport(t);
    draw();
    // marker A on the channel reading this event's nets; a capacitor no channel reads is plotted
    // from the run's record (no new run); else the first trace shown
    const ts = I.transientScope(), same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
    let kch = ["ch1", "ch2"].find(c => G.ch[c] && shown(c) && e.nets && ts && ts[c] && same(ts[c].nets, e.nets));
    const cap = !kch && (t.caps || []).find(c => c.id === e.id && c.lo);
    if (cap) { if (!G.ch["x:" + cap.id]) { S.extra.push(cap.id); draw(); renderShow(); } kch = G.ch["x:" + cap.id] ? "x:" + cap.id : null; }
    kch = kch || keysOf().find(shown);
    if (kch) pick.set([{ ch: kch, t: e.t }]); else draw();
  }
  function reportText(t) {
    const list = eventsOf(t);
    return [`Power-on report: ${I.fmt(t.tStop, "s")} after switch-on, ${t.warmup ? "cathodes warming up" : "hot cathodes"}. ${verdict(list)}.`,
      ...list.map(e => `${eventLine(e)}\n    ${e.detail || e.text}`)].join("\n");
  }
  $("pwr-copy").addEventListener("click", () => {
    const t = I.transient; if (!t || !t.ok) return;
    const txt = reportText(t), done = () => { const b = $("pwr-copy"), was = b.textContent; b.textContent = "Copied"; setTimeout(() => { b.textContent = was; }, 1200); };
    const fallback = () => { const a = document.createElement("textarea"); a.value = txt; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); done(); } catch (e) {} a.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback); else fallback();
  });
  // --- time presets: Inrush (0 to 200 ms), Warm-up (0 to 3 τ of the slowest cathode), Settled (the
  // last 200 ms), Whole; keys 1 to 4. Each snaps to the zoom ladder's next step up.
  const PRESETS = ["inrush", "warmup", "settled", "whole"];
  function ladder(tStop, tdiv) { const st = zoomSteps(tStop), v = st.find(x => x >= tdiv * 0.999); return v === undefined || v >= tStop / 10 * 0.999 ? "full" : v; }
  function preset(p) {
    const t = I.transient; if (!t || !t.ok || t.running) return;
    const tau = Math.max(0, ...(t.tubes || []).map(x => x.tau || 0));
    S.view.tdiv = p === "inrush" || p === "settled" ? ladder(t.tStop, 0.02) : p === "warmup" && tau > 0 && t.warmup ? ladder(t.tStop, 3 * tau / 10) : "full";
    const span = S.view.tdiv === "full" ? t.tStop : 10 * S.view.tdiv;
    S.view.pos = p === "settled" ? t.tStop - span : 0;
    S.view.preset = p;
    fillTdiv(); $("tdiv").value = String(S.view.tdiv); syncPresets(); draw();
  }
  const syncPresets = () => document.querySelectorAll("#presets .btn").forEach(b => b.classList.toggle("active", b.dataset.p === S.view.preset));
  document.querySelectorAll("#presets .btn").forEach(b => b.addEventListener("click", () => preset(b.dataset.p)));
  $("logt").addEventListener("change", e => { S.logT = e.target.checked; draw(); });
  $("ratings").addEventListener("change", e => { S.ratings = e.target.checked; draw(); });
  // hover on a lane: the tube's warm-up in words
  $("lanes").addEventListener("pointermove", e => {
    const cv = $("lanes"), r = cv.getBoundingClientRect(), y = e.clientY - r.top, l = laneInfo.find(q => y >= q.y && y <= q.y + q.h + 3);
    cv.title = l ? `${l.label} (${l.tube}): cathode warm-up τ = ${I.fmt(l.tau, "s", 1)}, 90 % of its emission at ${I.fmt(l.warmAt, "s", 1)}${l.cold.length ? `; overdrawn with a cold cathode ${l.cold.map(([a, b]) => `${I.fmt(a, "s", 2)} … ${I.fmt(b, "s", 2)}`).join(", ")}` : ""}` : "Cathode warm-up per tube";
  });
  // hover on an event's tick along the bottom of the screen: what happened
  $("screen").addEventListener("pointermove", e => {
    const cv = $("screen"); if (!G || !G.startup || !G.ticks) { if (cv.dataset.tip) { cv.removeAttribute("title"); delete cv.dataset.tip; } return; }
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = y > G.y0 + G.gh - 14 && y < G.y0 + G.gh + 4 ? G.ticks.find(k => Math.abs(k.x - x) <= 6) : null;
    if (hit) { cv.title = eventLine(eventsOf(I.transient)[hit.k]); cv.dataset.tip = "1"; } else if (cv.dataset.tip) { cv.removeAttribute("title"); delete cv.dataset.tip; }
  });
  // analysis: steady state (the CAD's settled result) or the power-on transient
  const syncAnalysis = () => {
    const st = S.analysis === "startup", t = I.transient, running = st && t && t.running;
    document.querySelectorAll("#analysis .btn").forEach(x => x.classList.toggle("active", x.dataset.v === S.analysis));
    ["trig-src", "trig-slope"].forEach(id => { $(id).disabled = st; });
    fillTdiv();
    $("pwr-bar").hidden = !st;
    $("logt").checked = S.logT; $("ratings").checked = S.ratings;
    document.querySelectorAll("#presets .btn").forEach(b => { b.disabled = !(t && t.ok && !t.running); });
    renderReport(t);
    $("analysis-note").textContent = st ? "Power-on: the circuit starts cold (capacitors empty, and with Cathodes warm up the tubes' cathodes too) and every source switches on at t = 0. Above the screen: Duration, ▶ Run and the time presets (keys 1 to 4: Inrush, Warm-up, Settled, Whole) with Log time. Under it: the whole record with a tick at each event, and the report: click an event to zoom to it. Dashed lines: the voltage ratings of capacitors the channel reads across. Zoom with the mouse wheel or Time/div (Ctrl+wheel: volts/div); scroll with the strip under the screen, Shift+wheel, right-drag or ← →."
      : "Steady state: the settled circuit, one window repeated like a triggered scope. Zoom with the mouse wheel (Ctrl+wheel: volts/div); move along the time axis with Shift+wheel or right-drag. Autoset resets the view.";
    $("btn-sim").textContent = running ? "■ Stop" : "▶ Simulate"; $("btn-sim").classList.toggle("active", !!running);
    $("btn-run").textContent = running ? "■ Stop" : "▶ Run"; $("btn-run").classList.toggle("active", !!running);
  };
  document.querySelectorAll("#analysis .btn").forEach(b => b.addEventListener("click", () => {
    if (S.analysis === b.dataset.v) return;
    S.analysis = b.dataset.v; pick.clear(); if (S.analysis === "startup" && S.mode === "xy") { S.mode = "dual"; document.querySelectorAll("#mode .btn").forEach(x => x.classList.toggle("active", x.dataset.v === "dual")); }
    syncAnalysis(); draw();
  }));
  $("t-stop").addEventListener("change", e => { S.tStop = e.target.value === "auto" ? "auto" : +e.target.value; draw(); });
  $("warmup").addEventListener("change", e => { S.warmup = e.target.checked; draw(); });
  const runOrStop = () => {
    if (S.analysis !== "startup") { I.send({ type: "RUN_SIM" }); return; }
    const t = I.transient;
    if (t && t.running) I.send({ type: "STOP_TRANSIENT" }); else I.send({ type: "RUN_TRANSIENT", tStop: S.tStop, warmup: S.warmup });
  };
  $("btn-sim").addEventListener("click", runOrStop); $("btn-run").addEventListener("click", runOrStop);
  I.onUpdate(syncAnalysis);
  syncAnalysis();
  I.bindScopeSelect($("scope-select"));
  I.onUpdate(draw);
  window.addEventListener("resize", draw);
  // control panel width: drag its left edge (double-click resets)
  Panels.columns(document.querySelector("main"), { key: "oscilloscope", minViewport: 900, minCenter: 360,
    cols: [{ index: 1, side: "right", def: 300, min: 240, max: 640 }], template: w => `1fr ${w[0]}px` });
  setInterval(() => { if (!I.result) draw(); }, 1500);
  draw();
  // current scaling, for tests and debugging
  window.Scope = { state: S, draw, preset, focusEvent, reportText, lanes: () => laneInfo.map(l => ({ ...l })), channels: () => G && G.ch ? Object.keys(G.ch).map(k => ({ key: k, label: chName(k), auto: !!G.ch[k].auto, vdiv: G.ch[k].vdiv })) : [], timeMap: () => G && G.startup ? { log: G.log, tx: G.tx, xt: G.xt } : null, axes: () => G && G.axes, settleInfo, startupChannels, zoomTo, startupView: () => G && G.startup ? { tdiv: G.vw.tdiv, pos: G.vw.pos, span: G.vw.span } : null,
    // canvas position of a channel's trace at a fraction of the screen width
    screenPoint: (k, frac) => { const c = G && G.ch[k]; if (!c) return null; const i = frac * G.M; return { x: G.x0 + frac * G.gw, y: screenY(c, valueAt(c, i)) }; },
    markers: () => pick.list.map(m => ({ ...m, pos: markerPos(m), reading: reading(m) })), view: () => { const sc = I.scope(), ch = channels(sc), any = ch.ch1 || ch.ch2; if (!any) return null;
    const t = triggerChannel(ch);
    const tb = SM.timebase(t.raw, sc.dt, I.result && I.result.fSig);
    const strip = c => c && { vdiv: c.vdiv, off: c.off, offset: c.offset, min: c.st.min, max: c.st.max };
    return { ch1: strip(ch.ch1), ch2: strip(ch.ch2), tdiv: S.tdiv === "auto" ? tb.tdiv : +S.tdiv, f: tb.f }; } };
})();
