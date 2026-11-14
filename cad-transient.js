/* Free transient, the Transient tab under the schematic (Analyze ▾ → Transient): the circuit run
   from its operating point (or from zero) for as long as you set, at the steps the circuit asks
   for (sim-engine.js transient: steps land on every corner of a pulse, PWL or exponential source).
   Nothing has to repeat: start-up, one-shots, oscillators, switching supplies. The viewer plots
   the nets you pick (the scope channels and named nets to begin with), any part's current (I(R3),
   I(Q1.C)) and expressions over them (wave-math.js: V(OUT)-V(IN), V(R1.1)*I(R1), d(), integ()),
   in panes of their own scale, each in time or as a spectrum (FFT); a cursor reads every trace,
   a drag zooms, cursors A and B measure Δt and the figures between them, and a run can be kept
   as a dashed reference under the next. Initial conditions (SPICE's .ic) name nets by their
   connector or rail name, or a part's pin (R3.2, V1.+). */
(function (root) {
  "use strict";
  // "OUT=2.5, B+=300 V1.+=0": [{ name, v }] (the names as typed), or { error }
  function parseIc(text, parseEng) {
    const out = [];
    const s = String(text || "").trim();
    if (!s) return out;
    for (const part of s.split(/[,;\n]+|\s+(?=[^=\s]+\s*=)/).map(x => x.trim()).filter(Boolean)) {
      const m = /^(?:v\()?([^=()\s]+)\)?\s*=\s*(\S+)$/i.exec(part);
      if (!m) return { error: `"${part}" is not NAME=VOLTS` };
      const v = parseEng(m[2].replace(/v$/i, ""));
      if (!isFinite(v)) return { error: `"${m[2]}" is not a voltage` };
      out.push({ name: m[1], v });
    }
    return out;
  }
  // summary of one trace over [i0, i1] of the record: min, max, average and RMS by the time between points
  function traceStats(t, y, i0, i1) {
    i0 = Math.max(0, i0 || 0); i1 = Math.min(t.length - 1, i1 === undefined ? t.length - 1 : i1);
    if (i1 < i0) return null;
    let mn = Infinity, mx = -Infinity, area = 0, sq = 0;
    for (let i = i0; i <= i1; i++) {
      const v = y[i]; if (v < mn) mn = v; if (v > mx) mx = v;
      if (i > i0) { const dt = t[i] - t[i - 1], a = y[i - 1]; area += (a + v) / 2 * dt; sq += (a * a + a * v + v * v) / 3 * dt; }
    }
    const span = t[i1] - t[i0];
    return { min: mn, max: mx, avg: span > 0 ? area / span : y[i0], rms: span > 0 ? Math.sqrt(Math.max(0, sq / span)) : Math.abs(y[i0]), end: y[i1], pp: mx - mn };
  }
  // the record's value at time x, straight between points
  function valueAt(t, y, x) {
    const n = t.length; if (!n) return NaN;
    if (x <= t[0]) return y[0]; if (x >= t[n - 1]) return y[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; }
    const f = (x - t[lo]) / ((t[hi] - t[lo]) || 1);
    return y[lo] + f * (y[hi] - y[lo]);
  }
  // first index with t ≥ x
  function indexAt(t, x) { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; } return lo; }

  const COLORS = ["#00e5ff", "#ffb300", "#c792ea", "#3fb950", "#ff6b81", "#82aaff", "#f78c6c", "#c3e88d"];
  const SKIP = new Set(["frame", "note", "ground", "offsheet", "rail", "scope"]);

  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadTransient(cad) {
    const { S, buildNetlist, cmds, compPins, desig, esc, fmtEng, parseEng, pool, setStatus, topo } = cad;
    const LIB = CadLib.LIB, WM = WaveMath;
    const KEY = "tubecad_tran";
    const opts = { stop: "10m", step: "", from: "", start: "op", ic: "" };
    try { Object.assign(opts, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch (e) {} };
    // job: the run under way; result: the engine's; traces: what is plotted, [{ expr, pane }] (a net's
    // name or an expression, kept across runs and edits); panes: [{ fft }] (a pane shows its traces
    // in time, or their spectrum); active: the pane new traces go to; view: the time span shown
    // [t0, t1] (null: all); hover: the pointer's time (or frequency in a spectrum); cur: cursors A and
    // B (times); ref: a run kept to compare against ({ t, data: { expr: y }, label })
    const TR = S.tran = { seq: 0, job: null, result: null, nets: null, T: null, stale: false, error: null, traces: null, panes: [{ fft: false }], active: 0, view: null, hover: null, hoverPane: 0, cur: { a: null, b: null }, ref: null, progress: 0 };
    let job = null, cache = new Map(), cacheOf = null;

    // every net with a name: { net, name, key, kind: "conn" | "scope" | "pin" }. A net is named by
    // its sheet connector or rail, else by a part's pin on it (R3.2); the scope channels too
    function netNames() {
      const T = topo(), byNet = new Map(), add = (net, name, kind) => {
        if (net === undefined || net === 0) return;
        const cur = byNet.get(net), rank = { conn: 0, scope: 1, pin: 2 };
        if (!cur || rank[kind] < rank[cur.kind]) byNet.set(net, { net, name, kind, alias: cur ? [cur.name].concat(cur.alias || []) : [] });
        else (cur.alias = cur.alias || []).push(name);
      };
      S.comps.forEach(c => {
        if (!LIB[c.type] || c.type === "frame" || c.type === "note" || c.type === "ground") return;
        if (c.type === "offsheet" || c.type === "rail") { const n = String(c.params.name || "").trim(); if (n) add(T.pinNet.get(c.id + ":" + compPins(c)[0].id), n, "conn"); return; }
        const d = desig(c);
        if (c.type === "scope") { compPins(c).forEach(p => { if (/^CH/i.test(p.id)) add(T.pinNet.get(c.id + ":" + p.id), `${d || "scope"} ${p.id}`, "scope"); }); return; }
        if (!d) return;
        compPins(c).forEach(p => add(T.pinNet.get(c.id + ":" + p.id), `${d}.${p.id}`, "pin"));
      });
      const list = [...byNet.values()];
      list.forEach(x => { x.key = x.name.toUpperCase(); });
      return list.sort((a, b) => ({ conn: 0, scope: 1, pin: 2 })[a.kind] - ({ conn: 0, scope: 1, pin: 2 })[b.kind] || a.name.localeCompare(b.name, undefined, { numeric: true }));
    }
    // the currents that can be plotted: I(R3) for a part of two pins (into its first pin), I(Q1.C) for each pin of the others
    function currentNames() {
      const out = [];
      S.comps.forEach(c => {
        if (!LIB[c.type] || SKIP.has(c.type)) return;
        const d = desig(c), pins = compPins(c); if (!d || pins.length < 2) return;
        if (pins.length === 2) out.push(`I(${d})`); else pins.forEach(p => out.push(`I(${d}.${p.id})`));
      });
      return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    // a name typed in the initial conditions or kept as a trace: the net it is now
    function findNet(list, name) {
      const k = String(name).trim().toUpperCase();
      const hit = list.find(x => x.key === k || (x.alias || []).some(a => a.toUpperCase() === k));
      return hit ? hit.net : undefined;
    }
    // what is plotted to begin with: the scope channels, else the named nets (not the supplies'
    // own rails), else the generator's output
    function defaultTraces(list) {
      const sc = list.filter(x => x.kind === "scope").map(x => x.name);
      if (sc.length) return sc.slice(0, 6);
      const conn = list.filter(x => x.kind === "conn").map(x => x.name);
      if (conn.length) return conn.slice(0, 4);
      const g = S.comps.find(c => c.type === "siggen" || c.type === "pickup" || c.type === "phono"), d = g && desig(g);
      return d ? [`${d}.+`] : list.slice(0, 2).map(x => x.name);
    }
    const asTrace = (x, pane) => (typeof x === "string" ? { expr: x, pane: pane || 0 } : { expr: String(x.expr), pane: x.pane | 0 });

    function stop() {
      if (job) { job.cancel(); job = null; }
      if (TR.job) { TR.job = null; TR.seq++; setStatus("idle", "Transient stopped"); render(); cmds.sync(); }
    }
    function run() {
      stop();
      const T = topo();
      TR.error = !S.comps.length ? "Empty sheet" : !T.hasGround ? "Add a ground symbol to simulate" : null;
      const tStop = parseEng(opts.stop), maxStep = opts.step ? parseEng(opts.step) : 0, tStart = opts.from ? parseEng(opts.from) : 0;
      if (!TR.error && !(tStop > 0)) TR.error = "Set the stop time (10m, 2.5, 500u…)";
      if (!TR.error && opts.step && !(maxStep > 0)) TR.error = "The maximum step is not a time: leave it empty for automatic";
      if (!TR.error && opts.from && !(tStart >= 0 && tStart < tStop)) TR.error = "Save from must be before the stop time";
      const list = netNames(), ic = {};
      if (!TR.error) {
        const p = parseIc(opts.ic, parseEng);
        if (p.error) TR.error = "Initial conditions: " + p.error;
        else for (const { name, v } of p) { const n = findNet(list, name); if (n === undefined) { TR.error = `Initial conditions: no net called ${name} (name a connector, a rail, or a pin like R3.2)`; break; } ic[n] = v; }
      }
      if (TR.error) { TR.result = null; render(); return; }
      const netlist = buildNetlist();
      const seq = ++TR.seq;
      TR.job = { seq, t0: Date.now() }; TR.progress = 0; TR.stale = false;
      if (!TR.traces) TR.traces = defaultTraces(list).map(x => asTrace(x));
      const options = { tStop, tStart, maxStep: maxStep || undefined, uic: opts.start === "zero", ic, currents: true, budgetMs: 300000 };
      const done = result => {
        if (TR.seq !== seq) return;
        job = null; TR.job = null;
        if (result.ok) {
          TR.result = result; TR.nets = list; TR.T = T; TR.error = null;
          // the zoom and the cursors stay while they fit the new run
          if (TR.view && !(TR.view[0] >= result.t[0] && TR.view[1] <= result.tStop)) TR.view = null;
          ["a", "b"].forEach(k => { if (TR.cur[k] !== null && !(TR.cur[k] >= result.t[0] && TR.cur[k] <= result.tStop)) TR.cur[k] = null; });
        } else { TR.result = null; TR.error = result.error || "The transient failed"; }
        setStatus(result.ok ? "ok" : "error", result.ok ? `Transient: ${fmtEng(result.tStop, "s")} in ${(result.elapsedMs / 1000).toFixed(1)} s · ${result.steps} steps${result.rejected ? ` (${result.rejected} retaken shorter)` : ""}` : "Transient: " + TR.error);
        render(); cmds.sync();
      };
      render(); cmds.sync();
      setStatus("busy", "Transient…", 0);
      if (!pool.ok) { setTimeout(() => done(TubeSimEngine.transient(netlist, options)), 0); return; }
      job = pool.run({ netlist, options, kind: "tran" }, {
        urgent: true, onResult: done,
        onProgress: f => { if (TR.seq !== seq) return; TR.progress = f; setStatus("busy", `Transient… ${Math.floor(f * 100)} %`, f); const b = document.getElementById("btn-tr-run"); if (b) b.textContent = `■ Stop · ${Math.floor(f * 100)} %`; }
      });
    }
    function changed() { if (TR.result && !TR.stale) { TR.stale = true; render(); } }

    // a part's current in the run, by I(R3) (into its first pin) or I(Q1.C) (into that pin)
    function partCurrent(name) {
      const r = TR.result, T = TR.T;
      if (!r.pinI) throw new Error("this run has no currents: run again");
      const key = String(name).trim().toUpperCase();
      let c = S.comps.find(x => (desig(x) || "").toUpperCase() === key), pin = null;
      if (!c) {
        const dot = key.lastIndexOf(".");
        if (dot > 0) { c = S.comps.find(x => (desig(x) || "").toUpperCase() === key.slice(0, dot)); if (c) { pin = compPins(c).find(p => p.id.toUpperCase() === key.slice(dot + 1)); if (!pin) throw new Error(`${desig(c)} has no pin ${name.slice(dot + 1)}`); } }
      }
      if (!c) throw new Error(`no part called ${name}`);
      const pins = compPins(c);
      if (!pin) { if (pins.length !== 2) throw new Error(`name a pin of ${desig(c)}: ${pins.map(p => `I(${desig(c)}.${p.id})`).slice(0, 3).join(", ")}`); pin = pins[0]; }
      const net = T.pinNet.get(c.id + ":" + pin.id);
      if (net === undefined) throw new Error(`${desig(c)}.${pin.id} is not connected`);
      if (pins.some(p => p !== pin && T.pinNet.get(c.id + ":" + p.id) === net)) throw new Error(`${desig(c)} has another pin on the same net: its current there is not known`);
      let y = null;
      r.pinI.ids.forEach(([id, node], k) => {
        const s = String(id), h = s.indexOf("#");
        if ((h < 0 ? s : s.slice(0, h)) !== c.id || node !== net) return;
        const v = r.pinI.vals[k];
        if (!y) y = Float64Array.from(v); else for (let i = 0; i < y.length; i++) y[i] += v[i];
      });
      if (!y) throw new Error(`${desig(c)} is not in this run: run again`);
      return y;
    }
    // a trace's values in the run: { y, unit } or { error }
    function evalTrace(expr) {
      const r = TR.result; if (!r) return { error: "no run" };
      if (cacheOf !== r) { cache = new Map(); cacheOf = r; }
      if (cache.has(expr)) return cache.get(expr);
      let out;
      const net = findNet(TR.nets || [], expr);
      if (net !== undefined) out = { y: r.nodes[net], unit: "V", net: true };
      else {
        try {
          const tree = WM.parse(expr);
          out = WM.evaluate(tree, { t: r.t, volt: name => { const k = findNet(TR.nets || [], name); return k === undefined ? null : r.nodes[k]; }, cur: partCurrent });
        } catch (e) { out = { error: e.message }; }
      }
      cache.set(expr, out);
      return out;
    }
    // the traces with their values: { name, expr, pane, color, y, unit, missing, error }
    function shown() {
      if (!TR.traces) return [];
      return TR.traces.map((tr, k) => {
        const v = TR.result ? evalTrace(tr.expr) : { error: "no run" };
        return { name: tr.expr, expr: tr.expr, pane: tr.pane, color: COLORS[k % COLORS.length], y: v.y || null, unit: v.unit || "", missing: !v.y, error: v.error || null, k };
      });
    }
    const span = () => { const t = TR.result.t; return TR.view || [t[0], t[t.length - 1]]; };
    const unitOfPane = tr => { const u = [...new Set(tr.filter(q => q.y).map(q => q.unit))]; return u.length === 1 ? u[0] : ""; };

    const W = 900, L = 58, R = 12, Tp = 10, B = 28;
    const paneH = () => (TR.panes.length > 1 ? 190 : 280);
    const nice = (a, b, k) => { const raw = (b - a) / k, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p, st = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p, out = []; for (let v = Math.ceil(a / st) * st; v <= b + st * 1e-9; v += st) out.push(Math.abs(v) < st * 1e-9 ? 0 : v); return out; };
    // per pixel column its first, lowest, highest and last point (fast edges stay sharp)
    function polyline(t, y, i0, i1, X, Y, v0, sp, cls, color) {
      const pts = [], cols = W - L - R;
      let col = -1, first = 0, mn = 0, mx = 0, last = 0, imn = 0, imx = 0;
      const flush = () => { if (col < 0) return; const x = (L + col).toFixed(1); const a = imn < imx ? [mn, mx] : [mx, mn]; pts.push(`${x},${Y(first).toFixed(1)}`, `${x},${Y(a[0]).toFixed(1)}`, `${x},${Y(a[1]).toFixed(1)}`, `${x},${Y(last).toFixed(1)}`); };
      for (let i = i0; i <= i1; i++) {
        const v = y[i]; if (!isFinite(v)) continue;
        const c = Math.max(0, Math.min(cols, Math.round((t[i] - v0) / sp * cols)));
        if (c !== col) { flush(); col = c; first = mn = mx = last = v; imn = imx = i; } else { if (v < mn) { mn = v; imn = i; } if (v > mx) { mx = v; imx = i; } last = v; }
      }
      flush();
      return `<polyline${cls ? ` class="${cls}"` : ""} style="stroke:${color}" points="${pts.join(" ")}"/>`;
    }
    // a pane in time: its traces, the kept run's dashed, the cursors
    function chartTime(p, tr) {
      const H = paneH(), r = TR.result, t = r.t, n = t.length, [v0, v1] = span(), sp = (v1 - v0) || 1;
      const i0 = Math.max(0, indexAt(t, v0) - 1), i1 = Math.min(n - 1, indexAt(t, v1));
      const ref = TR.ref, refs = ref ? tr.map(q => ({ q, y: ref.data[q.expr] })).filter(x => x.y) : [];
      const ri0 = ref ? Math.max(0, indexAt(ref.t, v0) - 1) : 0, ri1 = ref ? Math.min(ref.t.length - 1, indexAt(ref.t, v1)) : 0;
      let lo = Infinity, hi = -Infinity;
      const scan = (y, a, b) => { for (let i = a; i <= b; i++) { const v = y[i]; if (!isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; } };
      tr.forEach(q => { if (q.y) scan(q.y, i0, i1); });
      refs.forEach(x => scan(x.y, ri0, ri1));
      if (!isFinite(lo)) { lo = -1; hi = 1; }
      if (hi - lo < 1e-12) { const m = Math.max(Math.abs(hi), 1e-6); lo -= m * 0.1; hi += m * 0.1; }
      const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
      const X = x => L + (x - v0) / sp * (W - L - R), Y = v => Tp + (hi - v) / (hi - lo) * (H - Tp - B), unit = unitOfPane(tr);
      let s = `<svg class="pw-chart tr-chart" ${p === 0 ? 'id="tr-chart" ' : ""}data-pane="${p}" data-kind="time" viewBox="0 0 ${W} ${H}" role="img" aria-label="Waveforms, pane ${p + 1}">`;
      nice(v0, v1, 8).forEach(x => { s += `<line class="g1" x1="${X(x).toFixed(1)}" x2="${X(x).toFixed(1)}" y1="${Tp}" y2="${H - B}"/><text class="ax" x="${X(x).toFixed(1)}" y="${H - B + 14}" text-anchor="middle">${esc(fmtEng(x, "s"))}</text>`; });
      nice(lo, hi, 5).forEach(v => { s += `<line class="g1" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${L - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${esc(fmtEng(v, unit))}</text>`; });
      refs.forEach(x => { s += polyline(ref.t, x.y, ri0, ri1, X, Y, v0, sp, "tr-ref", x.q.color); });
      tr.forEach(q => { if (q.y) s += polyline(t, q.y, i0, i1, X, Y, v0, sp, "", q.color); });
      ["a", "b"].forEach(k => { const c = TR.cur[k]; if (c !== null && c >= v0 && c <= v1) s += `<line class="tr-mark" x1="${X(c).toFixed(1)}" x2="${X(c).toFixed(1)}" y1="${Tp}" y2="${H - B}"/><text class="tr-mark-l" x="${(X(c) + 3).toFixed(1)}" y="${Tp + 11}">${k.toUpperCase()}</text>`; });
      if (TR.hover !== null && TR.hoverPane >= 0 && !TR.panes[TR.hoverPane].fft && TR.hover >= v0 && TR.hover <= v1) s += `<line class="tr-cursor" x1="${X(TR.hover).toFixed(1)}" x2="${X(TR.hover).toFixed(1)}" y1="${Tp}" y2="${H - B}"/>`;
      s += `<rect class="tr-zoom" x="0" y="${Tp}" width="0" height="${H - Tp - B}" visibility="hidden"/>`;
      return s + "</svg>";
    }
    // the spectra of a pane's traces over the time shown (A to B when both cursors are set)
    const fftSpan = () => { const [v0, v1] = span(), a = TR.cur.a, b = TR.cur.b; return a !== null && b !== null && Math.abs(b - a) > 0 ? [Math.min(a, b), Math.max(a, b)] : [v0, v1]; };
    const fftCache = new Map();
    function spectrum(q) {
      const [f0, f1] = fftSpan(), key = q.expr + "|" + f0 + "|" + f1;
      if (fftCache.res !== TR.result) { fftCache.clear(); fftCache.res = TR.result; }
      if (!fftCache.has(key)) fftCache.set(key, WM.fft(TR.result.t, q.y, f0, f1, 65536));
      return fftCache.get(key);
    }
    const fftAxis = [];
    function chartFft(p, tr) {
      const H = paneH(), sps = tr.filter(q => q.y).map(q => ({ q, sp: spectrum(q) })).filter(x => x.sp);
      let s = `<svg class="pw-chart tr-chart" ${p === 0 ? 'id="tr-chart" ' : ""}data-pane="${p}" data-kind="fft" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spectrum, pane ${p + 1}">`;
      if (!sps.length) return s + `<text class="ax" x="${W / 2}" y="${H / 2}" text-anchor="middle">Nothing to show</text></svg>`;
      const fa = sps[0].sp.df, fb = sps[0].sp.f[sps[0].sp.f.length - 1];
      const lf0 = Math.log10(fa), lf1 = Math.log10(Math.max(fb, fa * 10));
      fftAxis[p] = { lf0, lf1 };
      let top = -Infinity;
      sps.forEach(({ sp }) => { for (let k = 1; k < sp.a.length; k++) top = Math.max(top, 20 * Math.log10(sp.a[k] || 1e-30)); });
      top = Math.ceil((top + 3) / 10) * 10; const bot = top - 120;
      const X = f => L + (Math.log10(f) - lf0) / (lf1 - lf0) * (W - L - R), Y = d => Tp + (top - Math.max(bot, Math.min(top, d))) / (top - bot) * (H - Tp - B);
      for (let d = Math.ceil(lf0); d <= lf1; d++) { const f = Math.pow(10, d); s += `<line class="g1" x1="${X(f).toFixed(1)}" x2="${X(f).toFixed(1)}" y1="${Tp}" y2="${H - B}"/><text class="ax" x="${X(f).toFixed(1)}" y="${H - B + 14}" text-anchor="middle">${esc(fmtEng(f, "Hz"))}</text>`; for (let m = 2; m < 10; m++) { const g = m * f; if (Math.log10(g) < lf1) s += `<line class="g2" x1="${X(g).toFixed(1)}" x2="${X(g).toFixed(1)}" y1="${Tp}" y2="${H - B}"/>`; } }
      const unit = unitOfPane(tr);
      for (let d = bot; d <= top; d += 20) s += `<line class="g1" x1="${L}" x2="${W - R}" y1="${Y(d).toFixed(1)}" y2="${Y(d).toFixed(1)}"/><text class="ax" x="${L - 5}" y="${(Y(d) + 3).toFixed(1)}" text-anchor="end">${d} dB${esc(unit)}</text>`;
      sps.forEach(({ q, sp }) => {
        const cols = new Map();
        for (let k = 1; k < sp.a.length; k++) { const c = Math.round(X(sp.f[k])), v = 20 * Math.log10(sp.a[k] || 1e-30); if (!cols.has(c) || v > cols.get(c)) cols.set(c, v); }
        s += `<polyline style="stroke:${q.color}" points="${[...cols].map(([c, v]) => `${c},${Y(v).toFixed(1)}`).join(" ")}"/>`;
      });
      if (TR.hover !== null && TR.hoverPane === p) s += `<line class="tr-cursor" x1="${X(TR.hover).toFixed(1)}" x2="${X(TR.hover).toFixed(1)}" y1="${Tp}" y2="${H - B}"/>`;
      return s + "</svg>";
    }
    function readout(tr) {
      const r = TR.result, x = TR.hover, p = TR.hoverPane;
      if (x === null) return `<span class="muted">Point at a chart to read the traces · drag to zoom in · click: cursor A, Shift+click: cursor B · double-click: all</span>`;
      if (TR.panes[p] && TR.panes[p].fft) {
        return `<b class="mono">${esc(fmtEng(x, "Hz"))}</b> ` + tr.filter(q => q.y && q.pane === p).map(q => { const sp = spectrum(q); if (!sp) return ""; const k = Math.max(1, Math.min(sp.a.length - 1, Math.round(x / sp.df))); return `<span class="tr-val"><i style="background:${q.color}"></i>${esc(q.name)} <b class="mono">${(20 * Math.log10(sp.a[k] || 1e-30)).toFixed(1)} dB${esc(q.unit)}</b> <span class="muted">(${esc(fmtEng(sp.a[k], q.unit, 3))})</span></span>`; }).join(" ");
      }
      return `<b class="mono">${esc(fmtEng(x, "s"))}</b> ` + tr.filter(q => q.y && !TR.panes[q.pane].fft).map(q => `<span class="tr-val"><i style="background:${q.color}"></i>${esc(q.name)} <b class="mono">${esc(fmtEng(valueAt(r.t, q.y, x), q.unit))}</b></span>`).join(" ");
    }
    function cursorLine() {
      const a = TR.cur.a, b = TR.cur.b;
      if (a === null && b === null) return "";
      const d = a !== null && b !== null ? Math.abs(b - a) : null;
      return `<div class="tr-curline"><span class="tr-mk">A</span> ${a === null ? "—" : esc(fmtEng(a, "s"))} <span class="tr-mk">B</span> ${b === null ? "—" : esc(fmtEng(b, "s"))}${d ? ` · Δt <b class="mono">${esc(fmtEng(d, "s"))}</b> · 1/Δt <b class="mono">${esc(fmtEng(1 / d, "Hz"))}</b>` : ""} <button class="btn tr-curx" id="btn-tr-curx" title="Take the cursors off">Clear cursors</button></div>`;
    }
    function render() {
      const host = document.getElementById("tr-pane"), btn = document.getElementById("btn-tr-run");
      if (btn) btn.textContent = TR.job ? `■ Stop · ${Math.floor(TR.progress * 100)} %` : "▶ Run";
      const add = document.getElementById("tr-add");
      if (add && document.activeElement !== add) {
        const list = TR.nets && TR.result ? TR.nets : netNames(), have = new Set((TR.traces || []).map(x => x.expr.toUpperCase()));
        const html = `<option value="">+ Plot a net…</option>` + list.filter(x => !have.has(x.key)).map(x => `<option value="${esc(x.name)}">${esc(x.name)}${x.alias && x.alias.length ? " (" + esc(x.alias.slice(0, 2).join(", ")) + ")" : ""}</option>`).join("");
        if (add.innerHTML !== html) add.innerHTML = html;
        add.value = "";
      }
      const dl = document.getElementById("tr-names");
      if (dl && document.activeElement !== document.getElementById("tr-expr")) {
        const html = (TR.nets && TR.result ? TR.nets : netNames()).map(x => `<option value="${esc(/^[A-Za-z_][\w.]*$/.test(x.name) ? x.name : `V(${x.name})`)}">`).join("") + currentNames().map(x => `<option value="${esc(x)}">`).join("");
        if (dl.innerHTML !== html) dl.innerHTML = html;
      }
      if (!host || host.hidden) return;
      if (TR.error && !TR.job) { host.innerHTML = `<div class="bom-empty">${esc(TR.error)}</div>`; return; }
      if (!TR.result) {
        host.innerHTML = `<div class="bom-empty">${TR.job ? "Running the transient…" : `Press ▶ Run: the circuit runs from ${opts.start === "zero" ? "zero (every capacitor empty)" : "its operating point"} for ${esc(opts.stop || "?")}s, at the steps it needs, and the chart shows the scope channels and named nets (add any net with + Plot a net, or type an expression such as V(OUT)-V(IN) or I(R3)). A pulse, PWL or exponential generator gives one-off events: start-up, a step response, a switching supply's soft start.`}</div>`;
        return;
      }
      if (TR.active >= TR.panes.length) TR.active = TR.panes.length - 1;
      const tr = shown(), r = TR.result, t = r.t, [v0, v1] = span();
      const ca = TR.cur.a, cb = TR.cur.b, both = ca !== null && cb !== null && ca !== cb;
      const [s0, s1] = both ? [Math.min(ca, cb), Math.max(ca, cb)] : [v0, v1], i0 = indexAt(t, s0), i1 = Math.min(t.length - 1, indexAt(t, s1));
      const chip = q => `<span class="tr-chip${q.missing ? " gone" : ""}" title="${q.error ? esc(q.error) : esc(q.name) + (q.unit ? " (" + esc(q.unit) + ")" : "")}"><i style="background:${q.color}"></i>${esc(q.name)}${q.error ? ` <span class="tr-err">${esc(q.error)}</span>` : ""}${TR.panes.length > 1 ? `<button class="tr-x tr-mv" data-k="${q.k}" title="Move it to the next pane" aria-label="Move ${esc(q.name)} to the next pane">⇅</button>` : ""}<button class="tr-x" data-k="${q.k}" title="Stop plotting it" aria-label="Remove ${esc(q.name)}">×</button></span>`;
      const panes = TR.panes.map((pn, p) => {
        const mine = tr.filter(q => q.pane === p);
        let info = "";
        if (pn.fft) info = mine.filter(q => q.y).map(q => { const pk = WM.peak(spectrum(q)); return pk ? `<span class="muted tr-info">${esc(q.name)} peak ${esc(fmtEng(pk.f, "Hz", 1))} ${esc(fmtEng(pk.a, q.unit, 3))}</span>` : ""; }).join("");
        return `<div class="tr-panebox${p === TR.active ? " on" : ""}" data-pane="${p}"><div class="tr-chips"><button class="tr-pn" data-p="${p}" title="New traces go to this pane">${TR.panes.length > 1 ? `Pane ${p + 1}` : "Traces"}</button>${mine.map(chip).join("")}`
          + `<span class="tr-pane-tools"><button class="btn tr-fft${pn.fft ? " active" : ""}" data-p="${p}" title="Show this pane's traces as a spectrum (FFT of the time shown, or from cursor A to B), or back in time">${pn.fft ? "Time" : "FFT"}</button>${TR.panes.length > 1 ? `<button class="btn tr-px" data-p="${p}" title="Remove this pane and its traces">×</button>` : ""}</span></div>${info ? `<div class="tr-chips">${info}</div>` : ""}`
          + (pn.fft ? chartFft(p, mine) : chartTime(p, mine)) + `</div>`;
      }).join("");
      const timeTr = tr.filter(q => q.y && !TR.panes[q.pane].fft);
      const rows = timeTr.map(q => {
        const st = traceStats(t, q.y, i0, i1); if (!st) return "";
        const at = k => (TR.cur[k] === null ? "" : `<td class="n mono">${esc(fmtEng(valueAt(t, q.y, TR.cur[k]), q.unit, 4))}</td>`);
        return `<tr><td><i class="tr-sw" style="background:${q.color}"></i>${esc(q.name)}</td>${["min", "max", "pp", "avg", "rms", "end"].map(k => `<td class="n mono">${esc(fmtEng(st[k], q.unit, 4))}</td>`).join("")}${at("a")}${at("b")}${both ? `<td class="n mono">${esc(fmtEng(valueAt(t, q.y, cb) - valueAt(t, q.y, ca), q.unit, 4))}</td>` : ""}</tr>`;
      }).join("");
      const over = both ? "from A to B" : "over the time shown";
      const note = (TR.stale ? `<div class="bom-empty tol-note">The circuit changed since this run: press ▶ Run again.</div>` : "")
        + (TR.job ? `<div class="bom-empty tol-note">Running again…</div>` : "");
      host.innerHTML = note + `<div class="tr-wrap"><div class="tr-chips"><span class="muted tr-info" title="Steps the run took, and how many were taken again shorter because the waveform turned faster than the step">${esc(fmtEng(r.tStop, "s"))} · ${r.steps} steps · ${r.points} points${TR.view ? ` · showing ${esc(fmtEng(v0, "s"))} to ${esc(fmtEng(v1, "s"))}` : ""}</span>`
        + `<button class="btn" id="btn-tr-pane" title="Add a pane under the others: traces added next go there (each pane has its own scale)">+ Pane</button>`
        + `<button class="btn" id="btn-tr-keep" title="Keep this run's traces to compare: they are drawn dashed under the next runs">${TR.ref ? "Keep this run instead" : "Keep as reference"}</button>${TR.ref ? `<button class="btn" id="btn-tr-unref" title="Stop drawing the kept run (${esc(TR.ref.label)})">Clear reference</button>` : ""}`
        + `<button class="btn tr-csv" id="btn-tr-csv" title="Save the traces in time as a CSV file (time and one column per trace)">CSV</button>${TR.view ? `<button class="btn" id="btn-tr-all" title="Show the whole run (or double-click the chart)">Show all</button>` : ""}</div>`
        + panes + `<div class="tr-read" id="tr-read">${readout(tr)}</div>` + cursorLine()
        + `<table class="nz-table tr-table"><thead><tr><th style="text-align:left" title="Figures ${over}">Trace</th><th>Min</th><th>Max</th><th title="Peak to peak">p-p</th><th title="Average ${over}">Average</th><th title="RMS ${over} (with the DC)">RMS</th><th title="At the end of the time shown">End</th>${ca !== null ? `<th title="At cursor A">At A</th>` : ""}${cb !== null ? `<th title="At cursor B">At B</th>` : ""}${both ? `<th title="The value at B less the value at A">B − A</th>` : ""}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    function exportCsv() {
      const r = TR.result; if (!r) return "";
      const tr = shown().filter(q => q.y);
      const head = q => { const v = evalTrace(q.expr); return v.net ? `V(${q.name})` : q.name + (q.unit ? ` (${q.unit})` : ""); };
      const lines = ["time," + tr.map(q => `"${head(q).replace(/"/g, "'")}"`).join(",")];
      for (let i = 0; i < r.t.length; i++) lines.push(+r.t[i].toPrecision(9) + "," + tr.map(q => +q.y[i].toPrecision(7)).join(","));
      const data = lines.join("\n") + "\n";
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "text/csv;charset=utf-8" })); a.download = "transient.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setStatus("ok", `Saved transient.csv (${r.t.length} points, ${tr.length} traces)`);
      return data;
    }
    // a trace typed or picked: into the active pane
    function addTrace(expr) {
      expr = String(expr || "").trim(); if (!expr) return false;
      TR.traces = (TR.traces || []).concat({ expr, pane: TR.active });
      render();
      return true;
    }
    function keepRef() {
      const r = TR.result; if (!r) return;
      const data = {};
      shown().forEach(q => { if (q.y) data[q.expr] = q.y; });
      const d = new Date();
      TR.ref = { t: r.t, data, label: `run at ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` };
      render();
    }
    // the chart's pointer: the cursor, a drag across it zooms to that span, a click sets cursor A (Shift: B)
    let drag = null;
    const W2 = W - L - R;
    const posAt = (svg, clientX) => {
      const b = svg.getBoundingClientRect(), x = Math.max(L, Math.min(W - R, (clientX - b.left) / b.width * W)), p = +svg.dataset.pane;
      if (svg.dataset.kind === "fft") { const ax = fftAxis[p] || { lf0: 0, lf1: 1 }; return { t: Math.pow(10, ax.lf0 + (x - L) / W2 * (ax.lf1 - ax.lf0)), x, p, fft: true }; }
      const [v0, v1] = span();
      return { t: v0 + (x - L) / W2 * (v1 - v0), x, p, fft: false };
    };
    function init() {
      const bindIn = (id, key, check) => {
        const el = document.getElementById(id); if (!el) return;
        el.value = opts[key];
        el.addEventListener("change", () => { const v = el.value.trim(); if (check && v && !check(v)) { el.classList.add("bad"); return; } el.classList.remove("bad"); opts[key] = v; save(); render(); });
      };
      bindIn("tr-stop", "stop", v => parseEng(v) > 0);
      bindIn("tr-step", "step", v => parseEng(v) > 0);
      bindIn("tr-from", "from", v => parseEng(v) >= 0);
      bindIn("tr-ic", "ic", v => !parseIc(v, parseEng).error);
      const st = document.getElementById("tr-start");
      if (st) { st.value = opts.start; st.addEventListener("change", () => { opts.start = st.value; save(); render(); }); }
      const add = document.getElementById("tr-add");
      if (add) add.addEventListener("change", () => { if (!add.value) return; addTrace(add.value); add.value = ""; });
      const ex = document.getElementById("tr-expr");
      if (ex) ex.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const v = ex.value.trim(); if (!v) return;
        // a typo is caught before it becomes a trace (names are checked against the run)
        try { if (findNet(TR.nets || netNames(), v) === undefined) WM.parse(v); ex.classList.remove("bad"); } catch (err) { ex.classList.add("bad"); ex.title = err.message; setStatus("warn", "Expression: " + err.message); return; }
        addTrace(v); ex.value = "";
      });
      const btn = document.getElementById("btn-tr-run");
      if (btn) btn.addEventListener("click", () => (TR.job ? stop() : run()));
      const host = document.getElementById("tr-pane");
      if (!host) return;
      host.addEventListener("click", e => {
        const mv = e.target.closest(".tr-mv"); if (mv) { const q = TR.traces[+mv.dataset.k]; q.pane = (q.pane + 1) % TR.panes.length; render(); return; }
        const x = e.target.closest(".tr-x"); if (x) { TR.traces.splice(+x.dataset.k, 1); render(); return; }
        const pn = e.target.closest(".tr-pn"); if (pn) { TR.active = +pn.dataset.p; render(); return; }
        const ff = e.target.closest(".tr-fft"); if (ff) { const p = TR.panes[+ff.dataset.p]; p.fft = !p.fft; TR.hover = null; render(); return; }
        const px = e.target.closest(".tr-px"); if (px) { const p = +px.dataset.p; TR.panes.splice(p, 1); TR.traces = TR.traces.filter(q => q.pane !== p).map(q => (q.pane > p ? Object.assign(q, { pane: q.pane - 1 }) : q)); TR.active = Math.min(TR.active, TR.panes.length - 1); render(); return; }
        if (e.target.closest("#btn-tr-pane")) { TR.panes.push({ fft: false }); TR.active = TR.panes.length - 1; render(); return; }
        if (e.target.closest("#btn-tr-keep")) { keepRef(); return; }
        if (e.target.closest("#btn-tr-unref")) { TR.ref = null; render(); return; }
        if (e.target.closest("#btn-tr-curx")) { TR.cur = { a: null, b: null }; render(); return; }
        if (e.target.closest("#btn-tr-csv")) exportCsv();
        if (e.target.closest("#btn-tr-all")) { TR.view = null; render(); }
      });
      host.addEventListener("mousedown", e => {
        const svg = e.target.closest(".tr-chart"); if (!svg || !TR.result || e.button !== 0) return;
        e.preventDefault();
        const p = +svg.dataset.pane; if (TR.active !== p) { TR.active = p; host.querySelectorAll(".tr-panebox").forEach(b => b.classList.toggle("on", +b.dataset.pane === p)); }
        if (svg.dataset.kind === "fft") return;
        drag = Object.assign(posAt(svg, e.clientX), { svg, shift: e.shiftKey });
      });
      host.addEventListener("mousemove", e => {
        const svg = (drag && drag.svg.isConnected && drag.svg) || e.target.closest(".tr-chart");
        if (!svg || !TR.result) return;
        const p = posAt(svg, e.clientX);
        TR.hover = p.t; TR.hoverPane = p.p;
        const z = svg.querySelector(".tr-zoom");
        if (drag && z) { const a = Math.min(drag.x, p.x), b = Math.max(drag.x, p.x); z.setAttribute("x", a); z.setAttribute("width", b - a); z.setAttribute("visibility", b - a > 3 ? "visible" : "hidden"); }
        // the cursor line on every time pane at once (they share the time axis), or on this spectrum
        host.querySelectorAll(".tr-chart").forEach(c => {
          let cur = c.querySelector(".tr-cursor");
          const on = p.fft ? c === svg : c.dataset.kind === "time";
          if (!on) { if (cur) cur.remove(); return; }
          if (!cur) { cur = document.createElementNS("http://www.w3.org/2000/svg", "line"); cur.setAttribute("class", "tr-cursor"); cur.setAttribute("y1", Tp); cur.setAttribute("y2", paneH() - B); c.appendChild(cur); }
          cur.setAttribute("x1", p.x); cur.setAttribute("x2", p.x);
        });
        const rd = document.getElementById("tr-read"); if (rd) rd.innerHTML = readout(shown());
      });
      window.addEventListener("mouseup", e => {
        if (!drag) return;
        const a = drag; drag = null;
        if (!a.svg.isConnected || !TR.result) return;
        const b = posAt(a.svg, e.clientX);
        if (Math.abs(b.x - a.x) > 3) { TR.view = [Math.min(a.t, b.t), Math.max(a.t, b.t)]; render(); return; }
        const z = a.svg.querySelector(".tr-zoom"); if (z) z.setAttribute("visibility", "hidden");
        TR.cur[a.shift ? "b" : "a"] = a.t; render();
      });
      host.addEventListener("dblclick", e => { if (e.target.closest(".tr-chart") && TR.view) { TR.view = null; render(); } });
      host.addEventListener("mouseleave", () => { if (drag) return; TR.hover = null; const rd = document.getElementById("tr-read"); if (rd && TR.result) rd.innerHTML = readout(shown()); host.querySelectorAll(".tr-chart .tr-cursor").forEach(c => c.remove()); });
      render();
    }
    return {
      changed, init, render, run, stop, exportCsv, netNames, currentNames, shown, opts, addTrace, keepRef, evalTrace,
      setTraces: list => { TR.traces = list.map(x => asTrace(x)); TR.traces.forEach(q => { while (q.pane >= TR.panes.length) TR.panes.push({ fft: false }); }); render(); },
      setPanes: n => { while (TR.panes.length < n) TR.panes.push({ fft: false }); render(); },
      setCursor: (k, v) => { TR.cur[k] = v; render(); }
    };
  }
  CadTransient.parseIc = parseIc; CadTransient.traceStats = traceStats; CadTransient.valueAt = valueAt;
  root.CadTransient = CadTransient;
})(typeof window !== "undefined" ? window : globalThis);
