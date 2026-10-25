/* The spectrum analyzer window (spectrum_analyzer.html): the FFT of an Oscilloscope part's channel
   from the CAD's broadcast results, harmonics and THD, markers, zoom. */
(function () {
  "use strict";
  const I = Instrument, $ = id => document.getElementById(id);
  const S = { src: "ch1", span: "auto", units: "dbc", scale: 10, zoom: null, fx: "lin" };   // fx: frequency axis linear or logarithmic   // zoom: { fa, fb, top, bottom } visible part, null = all
  const params = new URLSearchParams(location.search);
  if (params.get("ch") === "ch2") S.src = "ch2";
  $("src").value = S.src;

  // Line spectrum of one whole-period capture: bins at k / T
  // (cached: pointer moves redraw the screen without recomputing it)
  let cache = null;
  function spectrum(a, dt, fMaxWanted) {
    if (cache && cache.a === a && cache.dt === dt && cache.f === fMaxWanted) return cache.sp;
    cache = { a, dt, f: fMaxWanted, sp: lineSpectrum(a, dt, fMaxWanted) };
    return cache.sp;
  }
  function lineSpectrum(a, dt, fMaxWanted) {
    const P = a.length - 1, T = P * dt, df = 1 / T;
    let mean = 0; for (let i = 0; i < P; i++) mean += a[i]; mean /= P;
    const K = Math.min(Math.floor(fMaxWanted / df), Math.floor(P / 2) - 1);
    const lines = [];
    for (let k = 1; k <= K; k++) {
      let re = 0, im = 0; const w = 2 * Math.PI * k / P;
      for (let i = 0; i < P; i++) { const v = a[i] - mean; re += v * Math.cos(w * i); im -= v * Math.sin(w * i); }
      lines.push({ f: k * df, vpk: 2 * Math.hypot(re, im) / P });
    }
    return { lines, df, dc: mean };
  }

  function draw() {
    const cv = $("screen"), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    I.showStatus($("status"));
    ctx.fillStyle = "#03080d"; ctx.fillRect(0, 0, W, H);
    const padL = 52, padR = 16, padT = 24, padB = 30, gw = W - padL - padR, gh = H - padT - padB;
    ctx.font = "11px ui-monospace, Menlo, monospace";

    const sc = I.scope(), a = sc && sc[S.src];
    if (!a) {
      ctx.fillStyle = "#5c6b80"; ctx.textAlign = "center";
      ctx.fillText(sc ? `${S.src.toUpperCase()} of ${sc.label} is not connected` : "NO SIGNAL", padL + gw / 2, padT + gh / 2);
      ctx.textAlign = "left"; $("harm").innerHTML = ""; $("spurs").innerHTML = ""; $("thd").textContent = ""; $("foot").textContent = ""; G = null; renderMarks(); return;
    }
    // fundamental of the analysed signal itself (e.g. 100 Hz ripple even when a
    // 1 kHz generator sets the simulation); the CAD's frequency is the fallback
    const dt = sc.dt, fSig = ScopeMath.fundamental(a, dt) || (I.result && I.result.fSig) || 0;
    const fNyq = 0.5 / dt;
    const span = Math.min(S.span === "auto" ? (fSig ? fSig * 10.5 : 10000) : parseFloat(S.span), fNyq * 0.8);
    const sp = spectrum(a, dt, span);
    // fundamental: the line nearest fSig, else the largest line
    let fund = fSig ? sp.lines.reduce((b, l) => Math.abs(l.f - fSig) < Math.abs(b.f - fSig) ? l : b, sp.lines[0]) : sp.lines.reduce((b, l) => l.vpk > b.vpk ? l : b, sp.lines[0]);
    if (!fund) { G = null; renderMarks(); return; }
    const f0 = fund.f;
    const refDb = S.units === "dbc" ? 20 * Math.log10(Math.max(fund.vpk, 1e-15)) : 20 * Math.log10(Math.SQRT1_2);
    const db = v => 20 * Math.log10(Math.max(v, 1e-15)) - refDb;            // dBc, or dBV (vpk -> rms)
    const fullTop = S.units === "dbc" ? 0 : Math.ceil(db(fund.vpk) / 10) * 10, fullBottom = fullTop - S.scale * 10;
    // the visible window: the whole span and range, or the zoomed part of it
    // frequency axis: linear from 0, or logarithmic from just below the first line (DC is left out)
    const LOG = S.fx === "log", fLo = LOG ? sp.df * 0.8 : 0;
    const u = f => (LOG ? Math.log10(Math.max(f, fLo)) : f), inv = v => (LOG ? Math.pow(10, v) : v);
    const z = clampZoom(S.zoom, span, fullTop, fullBottom, u, inv, fLo); S.zoom = z;
    const fa = z ? z.fa : fLo, fb = z ? z.fb : span, top = z ? z.top : fullTop, bottom = z ? z.bottom : fullBottom;
    const X = f => padL + (u(f) - u(fa)) / (u(fb) - u(fa)) * gw, Y = d => padT + (top - d) / (top - bottom) * gh;
    ctx.strokeStyle = "rgba(0,180,216,0.16)"; ctx.lineWidth = 1;
    const vline = x => { ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + gh); ctx.stroke(); };
    const hline = y => { ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke(); };
    ctx.fillStyle = "#6a82a0";
    // level axis: 10 divisions, or round values when zoomed
    ctx.textAlign = "right";
    if (!z) { for (let j = 0; j <= 10; j++) { hline(padT + j * gh / 10); ctx.fillText(String(top - j * S.scale), padL - 6, padT + j * gh / 10 + 4); } }
    else { const ds = I.niceStep((top - bottom) / 10); for (let k = Math.ceil(bottom / ds - 1e-9); k * ds <= top + 1e-9; k++) { hline(Y(k * ds)); ctx.fillText(String(+(k * ds).toFixed(2)), padL - 6, Y(k * ds) + 4); } }
    // frequency axis
    ctx.textAlign = "center";
    if (LOG) {
      // decades: a line at every 1…9 × 10^n; labels by priority (1, 5, 2, then the rest), each
      // only where it doesn't touch one already placed
      const cands = [];
      for (let e = Math.floor(Math.log10(fa)); e <= Math.ceil(Math.log10(fb)); e++) for (let m = 1; m <= 9; m++) {
        const f = m * Math.pow(10, e); if (f < fa * 0.999 || f > fb * 1.001) continue;
        ctx.strokeStyle = m === 1 ? "rgba(0,180,216,0.3)" : "rgba(0,180,216,0.12)"; vline(X(f));
        cands.push({ f, m, rank: [1, 5, 2, 3, 4, 6, 7, 8, 9].indexOf(m) });
      }
      ctx.strokeStyle = "rgba(0,180,216,0.16)";
      const taken = [];
      cands.sort((a, b) => a.rank - b.rank || a.f - b.f).forEach(c => {
        const t = I.fmt(c.f, "Hz"), w = ctx.measureText(t).width, x = Math.max(padL + w / 2, Math.min(padL + gw - w / 2, X(c.f)));
        if (taken.some(([l, r]) => x - w / 2 < r + 8 && x + w / 2 > l - 8)) return;
        taken.push([x - w / 2, x + w / 2]); ctx.fillText(t, x, padT + gh + 16);
      });
    } else if (!z) {
      for (let i = 0; i <= 10; i++) vline(padL + i * gw / 10);
      if (S.span === "auto" && f0 > 0) { for (let k = 0; k * f0 <= span; k += 2) ctx.fillText(I.fmt(k * f0, "Hz"), X(k * f0), padT + gh + 16); }
      else for (let i = 0; i <= 10; i += 2) ctx.fillText(I.fmt(span * i / 10, "Hz"), padL + i * gw / 10, padT + gh + 16);
    } else {
      // zoomed: grid on round values of the visible window
      const fs = I.niceStep((fb - fa) / 10);
      for (let k = Math.ceil(fa / fs - 1e-9); k * fs <= fb + 1e-9; k++) { vline(X(k * fs)); if (k % 2 === 0) ctx.fillText(I.fmt(k * fs, "Hz"), X(k * fs), padT + gh + 16); }
    }
    ctx.textAlign = "left"; ctx.fillStyle = "#c9d6e3";
    ctx.fillText(`${S.units === "dbc" ? "dBc" : "dBV"} · ${LOG ? "log f · " : ""}${z ? `zoomed: ${I.fmt(fa, "Hz")} – ${I.fmt(fb, "Hz")}, ${+(top - bottom).toFixed(1)} dB` : S.scale + " dB/div"} · resolution ${I.fmt(sp.df, "Hz")}`, padL, 14);
    // stems
    ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, gw, gh); ctx.clip();
    const harmonicOf = l => f0 > 0 && Math.abs(l.f / f0 - Math.round(l.f / f0)) < 1e-6 ? Math.round(l.f / f0) : 0;
    const shown = [];   // harmonic labels on screen, for the tests
    sp.lines.forEach(l => {
      const d = db(l.vpk), h = harmonicOf(l); if (LOG && l.f < fLo) return;
      // a harmonic under the floor still gets its place marked: a short dim stub and "H7↓"
      if (d < bottom) {
        if (h < 2 || h > 10) return;
        ctx.strokeStyle = ctx.fillStyle = "rgba(255,213,79,0.45)"; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(X(l.f), Y(bottom)); ctx.lineTo(X(l.f), Y(bottom) - 12); ctx.stroke(); ctx.setLineDash([]);
        ctx.textAlign = "center"; ctx.fillText("H" + h + "↓", X(l.f), Y(bottom) - 16); shown.push("H" + h + "↓"); return;
      }
      ctx.strokeStyle = h === 1 ? "#00e5ff" : (h > 1 ? "#ffd54f" : "#7a8aa0");
      ctx.lineWidth = h ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(X(l.f), Y(bottom)); ctx.lineTo(X(l.f), Y(d)); ctx.stroke();
      if (h >= 1 && h <= 10) { ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = "center"; ctx.fillText(h === 1 ? "F" : "H" + h, X(l.f), Math.max(padT + 10, Y(d) - 6)); shown.push(h === 1 ? "F" : "H" + h); }
    });
    ctx.restore(); ctx.textAlign = "left";
    G = { X, Y, u, inv, LOG, fLo, padL, padT, gw, gh, span, fa, fb, top, bottom, fullTop, fullBottom, lines: sp.lines, db, fund, harmonicOf, shown, dbUnit: S.units === "dbc" ? "dBc" : "dBV" };
    if (hover) {
      const x = X(hover.f), r = reading(hover);
      ctx.strokeStyle = "rgba(230,237,243,0.22)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + gh); ctx.stroke(); ctx.setLineDash([]);
      if (r) MarkerPicker.label(ctx, x, padT + 4, padL, padL + gw, [[I.fmt(r.f, "Hz") + (r.h ? ` ${r.h === 1 ? "F" : "H" + r.h}` : ""), "#c9d6e3"], [`${lvl(r.level)} ${G.dbUnit}`, "#ff8ad8"], ...(G.dbUnit === "dBc" ? [[I.dbv(r.vrms), "#c9d6e3"]] : []), [I.fmt(r.vrms, "Vrms"), "#8b949e"]]);
    }
    pick.list.forEach((m, i) => { const p = markerPos(m); if (p) MarkerPicker.draw(ctx, p.x, p.y, MarkerPicker.LETTERS[i], "#ff8ad8"); });

    // harmonic table and THD
    let rows = "", sum2 = 0;
    for (let h = 1; h <= 10; h++) {
      const f = f0 * h; const l = sp.lines.find(x => Math.abs(x.f - f) < sp.df / 2);
      if (!l) break;
      const pct = l.vpk / fund.vpk * 100; if (h > 1) sum2 += l.vpk * l.vpk;
      // the fundamental in Vrms and dBV; harmonics in dBc, or in dBV when the screen shows dBV
      const lev = h === 1 ? `${I.fmt(l.vpk / Math.SQRT2, "Vrms")}<br><span class="muted">${I.dbv(l.vpk / Math.SQRT2)}</span>`
        : S.units === "dbv" ? I.dbv(l.vpk / Math.SQRT2) : (l.vpk / fund.vpk < 1e-6 ? "< −120 dBc" : (20 * Math.log10(l.vpk / fund.vpk)).toFixed(1) + " dBc");
      rows += `<tr><td>${h === 1 ? "Fundamental" : "H" + h}</td><td>${I.fmt(f, "Hz")}</td><td>${lev}</td><td>${h === 1 ? "100" : pct < 0.01 ? "<0.01" : pct.toFixed(pct < 1 ? 3 : 2)}</td></tr>`;
    }
    const thd = 100 * Math.sqrt(sum2) / fund.vpk;
    $("harm").innerHTML = rows;
    $("thd").textContent = "THD " + (thd < 0.01 ? "<0.01" : thd.toFixed(thd < 1 ? 3 : 2)) + " %";
    const spurs = sp.lines.filter(l => !harmonicOf(l) && l.vpk / fund.vpk > 1e-4).sort((p, q) => q.vpk - p.vpk).slice(0, 6);
    $("spurs").innerHTML = spurs.length ? spurs.map(l => `<tr><td>${I.fmt(l.f, "Hz")}</td><td>${(20 * Math.log10(l.vpk / fund.vpk)).toFixed(1)} dBc</td><td>${I.dbv(l.vpk / Math.SQRT2)}</td></tr>`).join("") : `<tr><td class="muted">None above −80 dBc (e.g. no mains hum)</td></tr>`;
    renderMarks();
    $("foot").innerHTML = `Fundamental <b>${I.fmt(f0, "Hz")}</b> · <b>${I.fmt(fund.vpk / Math.SQRT2, "Vrms")}</b> (<b>${I.dbv(fund.vpk / Math.SQRT2)}</b>) · THD <b>${thd.toFixed(3)} %</b> · DC <b>${I.fmt(sp.dc, "V")}</b>`;
  }

  // --- markers: A and B on spectral lines (frequency + level) ---------------
  let G = null, hover = null;
  const lineAt = f => G && G.lines.find(l => Math.abs(l.f - f) < 1e-6 * Math.max(1, f));
  const stemTop = l => G.Y(Math.max(G.bottom, G.db(l.vpk)));
  function snap(x, y) {
    if (!G || !G.lines.length || x < G.padL - 8 || x > G.padL + G.gw + 8) return null;   // any height: the fundamental touches the top
    // the stem nearest the pointer (a click on or just above a stem picks it),
    // else the line nearest in frequency
    let best = null, bd = Infinity;
    G.lines.forEach(l => {
      const dx = Math.abs(G.X(l.f) - x); if (dx > 8) return;
      const top = Math.max(G.padT, stemTop(l)), d = dx + Math.max(0, top - y) * 0.5 + Math.max(0, y - (G.padT + G.gh));
      if (d < bd) { bd = d; best = l; }
    });
    if (!best) best = G.lines.reduce((b, l) => Math.abs(G.X(l.f) - x) < Math.abs(G.X(b.f) - x) ? l : b);
    return { f: best.f };
  }
  function markerPos(m) {
    const l = lineAt(m.f); if (!l || l.f < G.fa - 1e-9 || l.f > G.fb + 1e-9) return null;
    return { x: G.X(l.f), y: Math.max(G.padT, stemTop(l)) };
  }
  function reading(m) {
    const l = lineAt(m.f); if (!l) return null;
    const h = G.harmonicOf(l);
    return { f: l.f, h, vrms: l.vpk / Math.SQRT2, level: G.db(l.vpk), dbc: 20 * Math.log10(Math.max(l.vpk, 1e-15) / G.fund.vpk) };
  }
  const lvl = d => d < -200 ? "< −200" : d.toFixed(1);
  const describe = r => `${I.fmt(r.f, "Hz")}${r.h ? ` (${r.h === 1 ? "F" : "H" + r.h})` : ""}: <b>${lvl(r.level)} ${G.dbUnit}</b>${G.dbUnit === "dBc" ? ` · ${I.dbv(r.vrms)}` : ""} · ${I.fmt(r.vrms, "Vrms")}`;
  function renderMarks() {
    const el = $("marks"), rs = pick.list.map(reading);
    let h = "";
    rs.forEach((r, i) => { if (r) h += `<span>${MarkerPicker.LETTERS[i]} ${describe(r)}</span>`; });
    if (rs.length === 2 && rs[0] && rs[1]) h += `<span>B−A: <b>${I.fmt(rs[1].f - rs[0].f, "Hz")}</b>, <b>${(rs[1].level - rs[0].level).toFixed(1)} dB</b></span>`;
    if (!h && G) h = `<span class="hint">Click a spectral line to place marker A, then B, to read its frequency and level. Drag to move, double-click to remove.</span>`;
    if (pick.list.length) h += `<button class="btn" id="marks-clear" title="Remove the markers (Esc)">Clear markers</button>`;
    if (S.zoom) h += `<button class="btn" id="zoom-reset" title="Show the whole span again"${pick.list.length ? ' style="margin-left:0"' : ""}>Reset zoom</button>`;
    el.innerHTML = h;
    const b = $("marks-clear"); if (b) b.onclick = () => pick.clear();
    const zr = $("zoom-reset"); if (zr) zr.onclick = () => { S.zoom = null; draw(); };
  }
  const pick = MarkerPicker($("screen"), { snap, pos: markerPos, hover: m => { hover = m; draw(); }, change: () => draw() });

  // --- zoom: wheel = frequency axis at the pointer, Ctrl+wheel = level axis, right-drag moves --
  // the zoom window kept inside the span; on a log axis the frequency window is kept in decades
  function clampZoom(z, span, top, bottom, u, inv, fLo) {
    if (!z) return null;
    const lo = u(fLo), hi = u(span), full = hi - lo;
    const uw = Math.min(u(Math.max(z.fb, fLo)) - u(Math.max(z.fa, fLo)), full), ua = Math.max(lo, Math.min(hi - uw, u(Math.max(z.fa, fLo))));
    const dw = Math.min(z.top - z.bottom, top - bottom), t = Math.min(top, Math.max(bottom + dw, z.top));
    return uw >= full * 0.999 && dw >= (top - bottom) * 0.999 ? null : { fa: inv(ua), fb: inv(ua + uw), top: t, bottom: t - dw };
  }
  const win = () => ({ fa: G.fa, fb: G.fb, top: G.top, bottom: G.bottom });
  PlotZoom($("screen"), {
    inside: (x, y) => !!G && x >= G.padL && x <= G.padL + G.gw && y >= G.padT && y <= G.padT + G.gh,
    zoom: (x, y, k, vertical) => {
      const z = win();
      if (vertical) {
        const d = z.top - (y - G.padT) / G.gh * (z.top - z.bottom), kk = Math.max(k, 1 / (z.top - z.bottom));   // down to 1 dB in view
        S.zoom = { ...z, top: d + (z.top - d) * kk, bottom: d - (d - z.bottom) * kk };
      } else {
        // in axis units (Hz, or decades on a log axis), so the frequency under the pointer stays put
        const ua = G.u(z.fa), ub = G.u(z.fb), uf = ua + (x - G.padL) / G.gw * (ub - ua);
        const kk = Math.max(k, (G.LOG ? 0.02 : G.span / 2000) / (ub - ua));
        S.zoom = { ...z, fa: G.inv(uf - (uf - ua) * kk), fb: G.inv(uf + (ub - uf) * kk) };
      }
      draw();
    },
    pan: (dx, dy) => {
      const z = win(), ua = G.u(z.fa), ub = G.u(z.fb), du = -dx / G.gw * (ub - ua), dd = dy / G.gh * (z.top - z.bottom);
      S.zoom = { fa: G.inv(ua + du), fb: G.inv(ub + du), top: z.top + dd, bottom: z.bottom + dd };
      draw();
    }
  });
  PlotZoom.hint($("screen"), [
    ["Wheel", "zoom the frequency axis at the pointer"],
    ["Ctrl + wheel", "zoom the level axis"],
    ["Shift + wheel", "move along the frequency axis"],
    ["Right-drag", "move the view (or Shift + drag)"],
    ["Reset zoom", "button under the screen: the whole span"],
    ["Click", "place marker A, then B on a line"]]);

  const bindSel = (id, set) => $(id).addEventListener("change", e => { set(e.target.value); draw(); });
  bindSel("src", v => S.src = v); bindSel("span", v => { S.span = v; S.zoom = null; }); bindSel("units", v => { S.units = v; S.zoom = null; }); bindSel("scale", v => { S.scale = parseFloat(v); S.zoom = null; }); bindSel("fx", v => { S.fx = v; S.zoom = null; });
  $("btn-cad").addEventListener("click", () => ToolWindows.open("circuit_sandbox.html"));
  I.bindScopeSelect($("scope-select"));
  I.onUpdate(draw);
  window.addEventListener("resize", draw);
  // control panel width: drag its left edge (double-click resets)
  Panels.columns(document.querySelector("main"), { key: "spectrum", minViewport: 900, minCenter: 360,
    cols: [{ index: 1, side: "right", def: 320, min: 240, max: 640 }], template: w => `1fr ${w[0]}px` });
  setInterval(() => { if (!I.result) draw(); }, 1500);
  draw();
  window.Spectrum = { state: S, draw, view: () => G && { fa: G.fa, fb: G.fb, log: G.LOG }, harmonics: () => G && G.shown, linePoint: f => markerPos({ f }), markers: () => pick.list.map(m => ({ ...m, pos: markerPos(m), reading: reading(m) })) };
})();
