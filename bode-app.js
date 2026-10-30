/* The Bode plotter window (bode.html): gain and phase against frequency from the CAD's Bode runs,
   and in Loop gain mode the gain around a feedback loop with its phase and gain margins. */
(function () {
  "use strict";
  const I = Instrument, $ = id => document.getElementById(id);
  const S = { mode: "resp", show: "both", ref: "abs", range: [10, 100000], phase: true, gen: null, at: null, reverse: false, zoom: null };   // zoom: { fa, fb } visible part
  const COL = { ch1: "#ffe23d", ch2: "#00e5ff", ratio: "#ff8ad8", loop: "#ff8ad8" };
  const NAME = { ch1: "CH1", ch2: "CH2", ratio: "CH2 ÷ CH1", loop: "Loop gain T" };
  const loopMode = () => S.mode === "loop";

  // --- asking the CAD: after every new simulation, and when the generator changes ---------------
  let askedFor = null;
  function ask(force) {
    const r = I.result; if (!r) return;
    const k = r.at + "|" + S.mode + "|" + (loopMode() ? S.at + "|" + S.reverse : S.gen);
    if (!force && k === askedFor) return;
    askedFor = k;
    if (loopMode()) I.send({ type: "RUN_LOOP", at: S.at, reverse: S.reverse });
    else I.send({ type: "RUN_AC", gen: S.gen });
  }

  // complex values → dB and phase unwrapped along the sweep, the phase at fRef put between −180° and 180°
  function polar(f, re, im, fRef) {
    const db = new Float64Array(f.length), ph = new Float64Array(f.length);
    let prev = null, off = 0;
    for (let k = 0; k < f.length; k++) {
      db[k] = 20 * Math.log10(Math.max(Math.hypot(re[k], im[k]), 1e-15));
      const p = Math.atan2(im[k], re[k]) * 180 / Math.PI;
      if (prev !== null) { while (p + off - prev > 180) off -= 360; while (p + off - prev < -180) off += 360; }
      prev = p + off; ph[k] = prev;
    }
    const k1 = nearest(f, fRef || 1000), shift = Math.round((ph[k1] - ((ph[k1] % 360 + 540) % 360 - 180)) / 360) * 360;
    for (let k = 0; k < f.length; k++) ph[k] -= shift;
    return { db, ph };
  }
  // Stability of a loop from its gain T (positive for negative feedback): from the reference point
  // (1 kHz, or the most loop gain where that is under 1) outwards each way, where |T| falls to 1
  // (the unity-gain frequency) and the phase margin there, 180° − |phase|; and where the phase
  // reaches ±180° and the gain margin there, how far |T| is below 1. A side that never gets to
  // unity gain within the sweep has none.
  function margins(f, db, ph) {
    const k1 = nearest(f, 1000);
    let k0 = k1;
    if (db[k0] <= 0) { k0 = 0; for (let k = 1; k < f.length; k++) if (db[k] > db[k0]) k0 = k; }
    const at = (k, j, t) => ({ f: f[k] * Math.pow(f[j] / f[k], t), db: db[k] + t * (db[j] - db[k]), ph: ph[k] + t * (ph[j] - ph[k]) });
    const side = dir => {
      const o = { unity: null, pm: null, g180: null, gm: null };
      for (let k = k0; k + dir >= 0 && k + dir < f.length; k += dir) {
        const j = k + dir;
        if (!o.unity && db[k] > 0 && db[j] <= 0) { const p = at(k, j, db[k] / (db[k] - db[j])); o.unity = p.f; o.pm = 180 - Math.abs(p.ph); }
        if (!o.g180 && Math.abs(ph[k]) < 180 && Math.abs(ph[j]) >= 180) { const t = (180 - Math.abs(ph[k])) / (Math.abs(ph[j]) - Math.abs(ph[k])), p = at(k, j, t); o.g180 = p.f; o.gm = -p.db; }
      }
      return o;
    };
    return { k0, k1, mid: db[k0], midPh: ph[k0], ph1: ph[k1], hi: side(1), lo: side(-1), max: Math.max(...db) };
  }
  // what the margins mean, in words: [class, text]
  function verdict(m, f) {
    if (Math.abs(m.ph1) > 90) return ["bad", `The loop's phase is ${Math.round(m.ph1)}° at 1 kHz: this is positive feedback. Swap the output transformer's secondary leads (or the feedback's source), or tick Other end if the loop is broken the wrong way round.`];
    if (m.max <= 0) return ["good", `The loop gain is under 1 at every frequency (at most ${m.max.toFixed(1)} dB): the loop cannot oscillate. The feedback is light.`];
    const sides = [["high", m.hi], ["low", m.lo]].filter(([, s]) => s.pm !== null);
    if (!sides.length) return ["warn", `The loop gain stays above 1 over the whole sweep (${I.fmt(f[0], "Hz")} – ${I.fmt(f[f.length - 1], "Hz")}): no unity-gain point to measure a margin at.`];
    const [name, w] = sides.reduce((a, b) => (b[1].pm < a[1].pm ? b : a));
    const where = `at the ${name} end (${I.fmt(w.unity, "Hz")})`;
    if (w.pm < 0) return ["bad", `Unstable: the phase passes 180° before the loop gain falls to 1 ${where}. It will oscillate near ${I.fmt(w.unity, "Hz")}${name === "low" ? " (motorboating)" : ""}.`];
    if (w.pm < 20) return ["bad", `Barely stable: ${Math.round(w.pm)}° of phase margin ${where}. Expect a large peak and ringing; another speaker or a weaker tube can tip it into oscillation.`];
    if (w.pm < 45) return ["warn", `Stable, but with ${Math.round(w.pm)}° of phase margin ${where} the response peaks and square waves ring. 45° or more is the usual aim (60° for no overshoot).`];
    return ["good", `Stable: at least ${Math.round(w.pm)}° of phase margin (the least is ${where}).`];
  }

  // the response of each trace: complex gain → dB and unwrapped phase
  function traces() {
    if (loopMode()) {
      const L = I.loop;
      if (!L || !L.ok || !L.freqs || !L.freqs.length) return null;
      const p = polar(L.freqs, L.re, L.im);
      return { list: [{ key: "loop", db: p.db, ph: p.ph }], f: L.freqs, loop: true };
    }
    const ac = I.ac, sc = I.scope();
    if (!ac || !ac.ok || !sc) return null;
    const s = (ac.scopes || []).find(x => x.id === sc.id);
    if (!s) return { list: [], f: ac.freqs };
    const f = ac.freqs, list = [];
    const mk = (key, re, im) => { const p = polar(f, re, im); list.push({ key, db: p.db, ph: p.ph }); };
    const want = S.show === "both" ? ["ch1", "ch2"] : [S.show];
    if (want.includes("ch1") && s.ch1) mk("ch1", s.ch1.re, s.ch1.im);
    if (want.includes("ch2") && s.ch2) mk("ch2", s.ch2.re, s.ch2.im);
    if (S.show === "ratio" && s.ch1 && s.ch2) {
      const re = [], im = [];
      for (let k = 0; k < f.length; k++) { const a = s.ch1.re[k], b = s.ch1.im[k], c = s.ch2.re[k], d = s.ch2.im[k], m = a * a + b * b || 1e-30; re.push((c * a + d * b) / m); im.push((d * a - c * b) / m); }
      mk("ratio", re, im);
    }
    if (S.ref === "1k") { const k1 = nearest(f, 1000); list.forEach(t => { const r0 = t.db[k1]; for (let k = 0; k < f.length; k++) t.db[k] -= r0; }); }
    return { list, f };
  }
  const nearest = (f, x) => { let b = 0; for (let k = 1; k < f.length; k++) if (Math.abs(Math.log(f[k] / x)) < Math.abs(Math.log(f[b] / x))) b = k; return b; };
  // value at frequency x, interpolated in log f
  const interp = (f, a, x) => {
    if (x <= f[0]) return a[0]; if (x >= f[f.length - 1]) return a[f.length - 1];
    let k = 1; while (f[k] < x) k++;
    const t = Math.log(x / f[k - 1]) / Math.log(f[k] / f[k - 1]);
    return a[k - 1] + t * (a[k] - a[k - 1]);
  };
  // where the gain first falls 3 dB below its 1 kHz value, going down (lo) and up (hi) from 1 kHz
  function corner(f, db, dir, drop) {
    const k1 = nearest(f, 1000), lim = db[k1] - drop;
    for (let k = k1; k >= 0 && k < f.length; k += dir) {
      const j = k + dir; if (j < 0 || j >= f.length) return null;
      if (db[j] < lim) { const t = (db[k] - lim) / (db[k] - db[j]); return f[k] * Math.pow(f[j] / f[k], t); }
    }
    return null;
  }

  let G = null, hover = null;
  function draw() {
    const cv = $("screen"), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fillGens();
    showStatus();
    ctx.fillStyle = "#03080d"; ctx.fillRect(0, 0, W, H);
    ctx.font = "11px ui-monospace, Menlo, monospace";
    const padL = 52, padR = 52, padT = 24, padB = 30, gw = W - padL - padR, gh = H - padT - padB;
    const T = traces();
    const msg = t => { ctx.fillStyle = "#5c6b80"; ctx.textAlign = "center"; ctx.fillText(t, padL + gw / 2, padT + gh / 2); ctx.textAlign = "left"; G = null; $("resp").innerHTML = ""; $("resp-head").innerHTML = ""; $("verdict").innerHTML = ""; $("foot").textContent = ""; renderMarks(); };
    const L = I.loop;
    if (!T && loopMode()) return msg(L && L.running ? "Computing the loop gain…" : L && !L.ok && L.error ? L.error : "NO LOOP GAIN YET");
    if (!T) return msg(I.ac && I.ac.running ? "Computing the frequency response…" : I.ac && !I.ac.ok && I.ac.error ? I.ac.error : I.scope() ? "NO RESPONSE YET" : "NO SCOPE");
    if (!T.list.length) return msg(S.show === "ratio" ? "Wire both CH1 and CH2 to see the gain between them" : `The scope's ${S.show === "both" ? "inputs are" : S.show.toUpperCase() + " is"} not connected`);
    const f = T.f, fa = S.zoom ? S.zoom.fa : S.range[0], fb = S.zoom ? S.zoom.fb : S.range[1];
    const lg = Math.log10, X = x => padL + (lg(x) - lg(fa)) / (lg(fb) - lg(fa)) * gw;
    // gain axis: 10 dB steps over what the visible traces span (at most 80 dB); phase axis in 45° steps
    let mx = -Infinity, mn = Infinity, pmx = -Infinity, pmn = Infinity;
    T.list.forEach(t => { for (let k = 0; k < f.length; k++) if (f[k] >= fa * 0.999 && f[k] <= fb * 1.001) { mx = Math.max(mx, t.db[k]); mn = Math.min(mn, t.db[k]); pmx = Math.max(pmx, t.ph[k]); pmn = Math.min(pmn, t.ph[k]); } });
    if (T.loop) { mx = Math.max(mx, 10); mn = Math.min(mn, -20); pmx = Math.max(pmx, 179); pmn = Math.min(pmn, -179); }
    const top = Math.ceil((mx + 3) / 10) * 10, bottom = Math.max(Math.floor((mn - 3) / 10) * 10, top - (T.loop ? 120 : 80));
    const pTop = Math.ceil((pmx + 1) / 45) * 45, pBot = Math.min(Math.floor((pmn - 1) / 45) * 45, pTop - 90);
    const magH = S.phase ? gh * 0.62 : gh, phT = padT + magH + 22, phH = gh - magH - 22;
    const Y = d => padT + (top - d) / (top - bottom) * magH, P = p => phT + (pTop - p) / (pTop - pBot) * phH;
    // grids
    const grid = (y0, h) => {
      for (let e = Math.floor(lg(fa)); e <= Math.ceil(lg(fb)); e++) for (let m = 1; m <= 9; m++) {
        const x = m * Math.pow(10, e); if (x < fa * 0.999 || x > fb * 1.001) continue;
        ctx.strokeStyle = m === 1 ? "rgba(0,180,216,0.3)" : "rgba(0,180,216,0.12)"; ctx.beginPath(); ctx.moveTo(X(x), y0); ctx.lineTo(X(x), y0 + h); ctx.stroke();
      }
    };
    ctx.lineWidth = 1; grid(padT, magH);
    ctx.textAlign = "right"; ctx.fillStyle = "#6a82a0";
    const dStep = (top - bottom) > 40 ? 10 : 5;
    for (let d = bottom; d <= top + 1e-9; d += dStep) { ctx.strokeStyle = "rgba(0,180,216,0.16)"; ctx.beginPath(); ctx.moveTo(padL, Y(d)); ctx.lineTo(padL + gw, Y(d)); ctx.stroke(); ctx.fillText(d + " dB", padL - 6, Y(d) + 4); }
    if (S.phase) {
      grid(phT, phH);
      ctx.textAlign = "left";
      const pStep = (pTop - pBot) > 360 ? 90 : 45;
      for (let p = pBot; p <= pTop + 1e-9; p += pStep) { ctx.strokeStyle = "rgba(0,180,216,0.16)"; ctx.beginPath(); ctx.moveTo(padL, P(p)); ctx.lineTo(padL + gw, P(p)); ctx.stroke(); ctx.fillStyle = "#6a82a0"; ctx.fillText(p + "°", padL + gw + 6, P(p) + 4); }
    }
    // frequency labels: 1, 2, 5 × 10^n where they fit
    ctx.textAlign = "center"; ctx.fillStyle = "#6a82a0";
    const taken = [];
    [1, 2, 5].forEach(m => { for (let e = Math.floor(lg(fa)); e <= Math.ceil(lg(fb)); e++) {
      const x = m * Math.pow(10, e); if (x < fa * 0.999 || x > fb * 1.001) continue;
      const t = I.fmt(x, "Hz"), w = ctx.measureText(t).width, px = Math.max(padL + w / 2, Math.min(padL + gw - w / 2, X(x)));
      if (taken.some(([l, r]) => px - w / 2 < r + 8 && px + w / 2 > l - 8)) continue;
      taken.push([px - w / 2, px + w / 2]); ctx.fillText(t, px, padT + gh + 16);
    } });
    // traces
    const plot = (a, Yf, y0, h, color, dash) => {
      ctx.save(); ctx.beginPath(); ctx.rect(padL, y0, gw, h); ctx.clip();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash || []); ctx.beginPath();
      let started = false; for (let k = 0; k < f.length; k++) { const x = X(f[k]), y = Yf(a[k]); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
      ctx.stroke(); ctx.restore();
    };
    // loop gain: unity gain and ±180°, the lines the margins are measured from, and the unity-gain points
    let M = null;
    if (T.loop) {
      ctx.strokeStyle = "rgba(255,226,61,0.55)"; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL + gw, Y(0)); ctx.stroke();
      if (S.phase) [180, -180].forEach(p => { if (p <= pTop && p >= pBot) { ctx.beginPath(); ctx.moveTo(padL, P(p)); ctx.lineTo(padL + gw, P(p)); ctx.stroke(); } });
      M = margins(f, T.list[0].db, T.list[0].ph);
    }
    T.list.forEach(t => { plot(t.db, Y, padT, magH, COL[t.key]); if (S.phase) plot(t.ph, P, phT, phH, COL[t.key], [5, 3]); });
    if (M) [M.hi, M.lo].forEach(sd => {
      if (sd.unity === null || sd.unity < fa || sd.unity > fb) return;
      const x = X(sd.unity), col = sd.pm < 20 ? "#ff7b72" : sd.pm < 45 ? "#ffb300" : "#3fb950";
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, Y(0), 4, 0, 2 * Math.PI); ctx.fill();
      if (S.phase) { const pp = interp(f, T.list[0].ph, sd.unity); ctx.strokeStyle = col; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(x, Y(0)); ctx.lineTo(x, P(pp)); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(x, P(pp), 3, 0, 2 * Math.PI); ctx.fill(); }
    });
    ctx.textAlign = "left"; ctx.fillStyle = "#c9d6e3";
    ctx.fillText(`${T.loop ? "Loop gain (dB; 0 dB = unity)" : `Gain (${S.ref === "1k" ? "dB re 1 kHz" : "dB re the generator"})`} · log f${S.zoom ? ` · zoomed: ${I.fmt(fa, "Hz")} – ${I.fmt(fb, "Hz")}` : ""}`, padL, 14);
    if (S.phase) { ctx.fillStyle = "#8b949e"; ctx.fillText("Phase (dashed)", padL, phT - 6); }
    G = { X, Y, P, padL, padT, gw, gh, magH, fa, fb, f, list: T.list };
    if (hover) {
      const x = X(hover.f);
      ctx.strokeStyle = "rgba(230,237,243,0.22)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + gh); ctx.stroke(); ctx.setLineDash([]);
      MarkerPicker.label(ctx, x, padT + 4, padL, padL + gw, [[I.fmt(hover.f, "Hz"), "#c9d6e3"], ...T.list.map(t => [`${interp(f, t.db, hover.f).toFixed(1)} dB ${Math.round(interp(f, t.ph, hover.f))}°`, COL[t.key]])]);
    }
    pick.list.forEach((m, i) => { const p = markerPos(m); if (p) MarkerPicker.draw(ctx, p.x, p.y, MarkerPicker.LETTERS[i], "#ff8ad8"); });
    if (T.loop) loopTable(T, M); else table(T);
    renderMarks();
    if (T.loop) { $("foot").innerHTML = `Loop broken at <b>${esc(L.label || L.at)}</b>${L.reverse ? " (other end)" : ""} · ${f.length} frequencies in ${L.elapsedMs} ms${L.averaged ? " · supply at its averaged steady state" : ""}`; return; }
    const ac = I.ac;
    $("foot").innerHTML = `Driven by <b>${(ac.gens.find(g => g.id === ac.gen) || {}).label || "?"}</b> at 1 V · ${f.length} frequencies in ${ac.elapsedMs} ms${ac.averaged ? " · supply at its averaged steady state" : ""}`;
  }

  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // the loop's figures: its gain and the feedback in the middle of the band, then each side's
  // unity-gain frequency, phase margin and gain margin
  function loopTable(T, M) {
    const f = T.f, t = T.list[0], k1 = M.k1, lin = Math.pow(10, t.db[k1] / 20);
    const fb = 20 * Math.log10(Math.hypot(1 + lin * Math.cos(t.ph[k1] * Math.PI / 180), lin * Math.sin(t.ph[k1] * Math.PI / 180)));
    const pm = v => (v === null ? "—" : `<span class="${v < 20 ? "bad" : v < 45 ? "warn" : "good"}">${Math.round(v)}°</span>`);
    const fq = (v, none) => (v === null ? none : I.fmt(v, "Hz"));
    const rows = [
      [`Loop gain at ${I.fmt(f[k1], "Hz")}`, `${lin >= 100 ? lin.toFixed(0) : lin.toPrecision(3)}× · ${t.db[k1].toFixed(1)} dB`, ""],
      ["Feedback (1 + T)", `${fb.toFixed(1)} dB`, ""],
      ["", "Low end", "High end"],
      ["Unity gain at", fq(M.lo.unity, "none in sweep"), fq(M.hi.unity, "none in sweep")],
      ["Phase margin", pm(M.lo.pm), pm(M.hi.pm)],
      ["Phase at ±180° at", fq(M.lo.g180, "never"), fq(M.hi.g180, "never")],
      ["Gain margin", M.lo.gm === null ? "—" : `${M.lo.gm.toFixed(1)} dB`, M.hi.gm === null ? "—" : `${M.hi.gm.toFixed(1)} dB`]
    ];
    $("resp-title").textContent = "Stability";
    $("resp-head").innerHTML = "";
    $("resp").innerHTML = rows.map((r, i) => (i === 2 ? `<tr><th></th><th>${r[1]}</th><th>${r[2]}</th></tr>` : i < 2 ? `<tr><td>${r[0]}</td><td colspan="2">${r[1]}</td></tr>` : `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`)).join("");
    const [cls, text] = verdict(M, f);
    $("verdict").innerHTML = `<span class="${cls}">${esc(text)}</span>`;
    $("resp-note").textContent = "T is the gain once around the loop (positive: negative feedback; the closed loop is the open loop ÷ (1 + T)). Phase margin: how far the phase is from ±180° where |T| = 1; gain margin: how far |T| is below 1 where the phase reaches ±180°. A tube amplifier has two: at the high end (the output transformer's leakage, Miller capacitance) and at the low end (coupling capacitors, the transformer's primary inductance, motorboating).";
  }

  // midband gain and phase, the −3 dB points around 1 kHz, the ends of the audio band, and any peak
  function table(T) {
    $("resp-title").textContent = "Response"; $("verdict").innerHTML = "";
    const f = T.f, rows = [["Gain at 1 kHz"], ["Phase at 1 kHz"], ["−3 dB low"], ["−3 dB high"], ["At 20 Hz"], ["At 20 kHz"], ["Peak"]];
    T.list.forEach(t => {
      const k1 = nearest(f, 1000), g = t.db[k1] + (S.ref === "1k" ? 0 : 0), lo = corner(f, t.db, -1, 3), hi = corner(f, t.db, 1, 3);
      const lin = Math.pow(10, t.db[k1] / 20);
      rows[0].push(S.ref === "1k" ? "0 dB (ref)" : `${lin >= 100 ? lin.toFixed(0) : lin.toPrecision(3)}× · ${g.toFixed(1)} dB`);
      rows[1].push(`${Math.round(t.ph[k1])}°`);
      rows[2].push(lo ? I.fmt(lo, "Hz") : `below ${I.fmt(f[0], "Hz")}`);
      rows[3].push(hi ? I.fmt(hi, "Hz") : `above ${I.fmt(f[f.length - 1], "Hz")}`);
      const rel = x => (interp(f, t.db, x) - t.db[k1]);
      rows[4].push(`${rel(20) >= 0 ? "+" : ""}${rel(20).toFixed(2)} dB`); rows[5].push(`${rel(20000) >= 0 ? "+" : ""}${rel(20000).toFixed(2)} dB`);
      let kp = 0; for (let k = 1; k < f.length; k++) if (t.db[k] > t.db[kp]) kp = k;
      const over = t.db[kp] - t.db[k1];
      rows[6].push(over > 0.5 ? `<span class="warn">+${over.toFixed(1)} dB at ${I.fmt(f[kp], "Hz")}</span>` : "none");
    });
    $("resp-head").innerHTML = `<tr><th></th>${T.list.map(t => `<th><span class="key" style="background:${COL[t.key]}"></span>${NAME[t.key]}</th>`).join("")}</tr>`;
    $("resp").innerHTML = rows.map(r => `<tr><td>${r[0]}</td>${r.slice(1).map(v => `<td>${v}</td>`).join("")}</tr>`).join("");
    $("resp-note").textContent = "The −3 dB points are measured from the gain at 1 kHz, going down and up in frequency. 20 Hz and 20 kHz are relative to 1 kHz. A peak above the 1 kHz gain is a resonance (an output transformer's leakage, a feedback loop near instability).";
  }

  // --- markers --------------------------------------------------------------------------------
  function snap(x) {
    if (!G || x < G.padL - 8 || x > G.padL + G.gw + 8) return null;
    const fx = Math.pow(10, Math.log10(G.fa) + (x - G.padL) / G.gw * (Math.log10(G.fb) - Math.log10(G.fa)));
    return { f: G.f[nearest(G.f, Math.min(G.fb, Math.max(G.fa, fx)))] };
  }
  function markerPos(m) { if (!G || !G.list.length || m.f < G.fa * 0.999 || m.f > G.fb * 1.001) return null; return { x: G.X(m.f), y: G.Y(interp(G.f, G.list[0].db, m.f)) }; }
  function renderMarks() {
    let h = "";
    if (G) pick.list.forEach((m, i) => { h += `<span>${MarkerPicker.LETTERS[i]} ${I.fmt(m.f, "Hz")}: ${G.list.map(t => `<b style="color:${COL[t.key]}">${interp(G.f, t.db, m.f).toFixed(2)} dB ${Math.round(interp(G.f, t.ph, m.f))}°</b>`).join(" · ")}</span>`; });
    if (G && pick.list.length === 2) { const [a, b] = pick.list; h += `<span>B−A: ${G.list.map(t => `<b style="color:${COL[t.key]}">${(interp(G.f, t.db, b.f) - interp(G.f, t.db, a.f)).toFixed(2)} dB</b>`).join(" · ")}</span>`; }
    if (!h && G) h = `<span class="hint">Click the graph to place marker A, then B, to read gain and phase. Drag to move, double-click to remove.</span>`;
    if (pick.list.length) h += `<button class="btn" id="marks-clear">Clear markers</button>`;
    if (S.zoom) h += `<button class="btn" id="zoom-reset"${pick.list.length ? ' style="margin-left:0"' : ""}>Reset zoom</button>`;
    $("marks").innerHTML = h;
    const b = $("marks-clear"); if (b) b.onclick = () => pick.clear();
    const z = $("zoom-reset"); if (z) z.onclick = () => { S.zoom = null; draw(); };
  }
  const pick = MarkerPicker($("screen"), { snap, pos: markerPos, hover: m => { hover = m; draw(); }, change: () => draw() });
  // wheel zooms the frequency axis at the pointer, kept in 1 Hz – 1 MHz
  const clampF = (a, b) => { const lo = Math.log10(1), hi = Math.log10(1e6); let la = Math.log10(a), lb = Math.log10(b); const w = Math.min(Math.max(lb - la, 0.3), hi - lo); la = Math.max(lo, Math.min(hi - w, la)); return { fa: Math.pow(10, la), fb: Math.pow(10, la + w) }; };
  PlotZoom($("screen"), {
    inside: (x, y) => !!G && x >= G.padL && x <= G.padL + G.gw && y >= G.padT && y <= G.padT + G.gh,
    zoom: (x, y, k) => { const la = Math.log10(G.fa), lb = Math.log10(G.fb), u = la + (x - G.padL) / G.gw * (lb - la); S.zoom = clampF(Math.pow(10, u - (u - la) * k), Math.pow(10, u + (lb - u) * k)); draw(); },
    pan: dx => { const la = Math.log10(G.fa), lb = Math.log10(G.fb), d = -dx / G.gw * (lb - la); S.zoom = clampF(Math.pow(10, la + d), Math.pow(10, lb + d)); draw(); }
  });
  PlotZoom.hint($("screen"), [["Wheel", "zoom the frequency axis at the pointer"], ["Shift + wheel", "move along the frequency axis"], ["Right-drag", "move the view (or Shift + drag)"], ["Reset zoom", "button under the screen"], ["Click", "place marker A, then B"]]);

  function fillPlaces() {
    const L = I.loop, list = (L && L.places) || [], sel = $("loop-at");
    const html = list.length ? list.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("") : `<option value="">no part to break at</option>`;
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.disabled = !list.length;
    const cur = S.at || (L && L.at);
    if (cur && list.some(p => p.id === cur)) sel.value = cur;
    $("loop-rev").checked = S.reverse;
  }
  function fillGens() {
    document.body.classList.toggle("loop", loopMode());
    fillPlaces();
    const ac = I.ac, gens = (ac && ac.gens) || [], sel = $("gen"), cur = S.gen || (ac && ac.gen);
    const html = gens.length ? gens.map(g => `<option value="${g.id}">${g.label}</option>`).join("") : `<option>no generator</option>`;
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.disabled = !gens.length;
    if (cur && gens.some(g => g.id === cur)) sel.value = cur;
  }
  function showStatus() {
    const ac = I.ac, el = $("status");
    if (I.problem || !I.result || !I.result.ok || !I.scopes().length) { I.showStatus(el); return; }
    if (loopMode()) {
      const L = I.loop;
      if (L && L.running) { el.className = "status idle progress"; el.textContent = "Computing the loop gain…"; el.style.setProperty("--progress", ((L.progress || 0) * 100).toFixed(1) + "%"); return; }
      if (L && !L.ok && L.error && L.error !== "Not run yet") { el.className = "status bad"; el.textContent = L.error; return; }
      I.showStatus(el); return;
    }
    if (ac && ac.running) { el.className = "status idle progress"; el.textContent = "Computing the frequency response…"; el.style.setProperty("--progress", ((ac.progress || 0) * 100).toFixed(1) + "%"); return; }
    if (ac && !ac.ok) { el.className = "status bad"; el.textContent = ac.error || "No response"; return; }
    I.showStatus(el);
  }

  const bindSel = (id, set) => $(id).addEventListener("change", e => { set(e.target.value); draw(); });
  bindSel("show", v => S.show = v); bindSel("ref", v => S.ref = v); bindSel("phase", v => S.phase = v === "on");
  bindSel("range", v => { S.range = v.split("-").map(Number); S.zoom = null; });
  $("gen").addEventListener("change", e => { S.gen = e.target.value; ask(true); });
  $("mode").addEventListener("change", e => { S.mode = e.target.value; S.zoom = null; pick.clear(); ask(); draw(); });
  $("loop-at").addEventListener("change", e => { S.at = e.target.value; ask(); draw(); });
  $("loop-rev").addEventListener("change", e => { S.reverse = e.target.checked; ask(); draw(); });
  // ?mode=loop opens in Loop gain mode
  if (new URLSearchParams(location.search).get("mode") === "loop") { S.mode = "loop"; $("mode").value = "loop"; }
  $("btn-cad").addEventListener("click", () => ToolWindows.open("circuit_sandbox.html"));
  I.bindScopeSelect($("scope-select"));
  I.onUpdate(() => { ask(); draw(); });
  window.addEventListener("resize", draw);
  Panels.columns(document.querySelector("main"), { key: "bode", minViewport: 900, minCenter: 360,
    cols: [{ index: 1, side: "right", def: 320, min: 240, max: 640 }], template: w => `1fr ${w[0]}px` });
  setInterval(() => { if (!I.result) draw(); }, 1500);
  draw();
  window.Bode = { state: S, draw, traces, ask, margins, verdict, polar, view: () => G && { fa: G.fa, fb: G.fb } };
})();
