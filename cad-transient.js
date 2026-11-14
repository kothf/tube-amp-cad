/* Free transient, the Transient tab under the schematic (Analyze ▾ → Transient): the circuit run
   from its operating point (or from zero) for as long as you set, at the steps the circuit asks
   for (sim-engine.js transient: steps land on every corner of a pulse, PWL or exponential source).
   Nothing has to repeat: start-up, one-shots, oscillators, switching supplies. The chart plots the
   nets you pick (the scope channels and named nets to begin with), with a cursor that reads every
   trace, drag to zoom and the min, max, average, RMS and final value of each. Initial conditions
   (SPICE's .ic) name nets by their connector or rail name, or a part's pin (R3.2, V1.+). */
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

  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadTransient(cad) {
    const { S, buildNetlist, cmds, compPins, desig, esc, fmtEng, parseEng, pool, setStatus, topo } = cad;
    const LIB = CadLib.LIB;
    const KEY = "tubecad_tran";
    const opts = { stop: "10m", step: "", from: "", start: "op", ic: "" };
    try { Object.assign(opts, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch (e) {} };
    // job: the run under way; result: the engine's; traces: the nets plotted (by name key, kept
    // across runs and edits); view: the time span shown [t0, t1] (null: all); hover: the cursor's time
    const TR = S.tran = { seq: 0, job: null, result: null, nets: null, stale: false, error: null, traces: null, view: null, hover: null, progress: 0 };
    let job = null;

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
      if (!TR.traces) TR.traces = defaultTraces(list);
      const options = { tStop, tStart, maxStep: maxStep || undefined, uic: opts.start === "zero", ic, budgetMs: 300000 };
      const done = result => {
        if (TR.seq !== seq) return;
        job = null; TR.job = null;
        if (result.ok) { TR.result = result; TR.nets = list; TR.error = null; TR.view = null; }
        else { TR.result = null; TR.error = result.error || "The transient failed"; }
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

    // the traces that can be drawn from the result: { name, color, y }
    function shown() {
      const r = TR.result; if (!r || !TR.traces) return [];
      return TR.traces.map((name, k) => {
        const net = findNet(TR.nets || [], name), y = net === undefined ? null : r.nodes[net];
        return { name, color: COLORS[k % COLORS.length], y, missing: !y };
      });
    }
    const W = 900, H = 280, L = 58, R = 12, Tp = 10, B = 28;
    function chart(tr) {
      const r = TR.result, t = r.t, n = t.length;
      const [v0, v1] = TR.view || [t[0], t[n - 1]], span = (v1 - v0) || 1;
      const i0 = Math.max(0, indexAt(t, v0) - 1), i1 = Math.min(n - 1, indexAt(t, v1));
      let lo = Infinity, hi = -Infinity;
      tr.forEach(q => { if (!q.y) return; for (let i = i0; i <= i1; i++) { const v = q.y[i]; if (v < lo) lo = v; if (v > hi) hi = v; } });
      if (!isFinite(lo)) { lo = -1; hi = 1; }
      if (hi - lo < 1e-9) { const m = Math.max(Math.abs(hi), 1e-3); lo -= m * 0.1; hi += m * 0.1; }
      const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
      const X = x => L + (x - v0) / span * (W - L - R), Y = v => Tp + (hi - v) / (hi - lo) * (H - Tp - B);
      const nice = (a, b, k) => { const raw = (b - a) / k, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p, st = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p, out = []; for (let v = Math.ceil(a / st) * st; v <= b + st * 1e-9; v += st) out.push(Math.abs(v) < st * 1e-9 ? 0 : v); return out; };
      let s = `<svg class="pw-chart tr-chart" id="tr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Transient waveforms">`;
      nice(v0, v1, 8).forEach(x => { s += `<line class="g1" x1="${X(x).toFixed(1)}" x2="${X(x).toFixed(1)}" y1="${Tp}" y2="${H - B}"/><text class="ax" x="${X(x).toFixed(1)}" y="${H - B + 14}" text-anchor="middle">${esc(fmtEng(x, "s"))}</text>`; });
      nice(lo, hi, 5).forEach(v => { s += `<line class="g1" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${L - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${esc(fmtEng(v, "V"))}</text>`; });
      // each trace: per pixel column its first, lowest, highest and last point (fast edges stay sharp)
      tr.forEach(q => {
        if (!q.y) return;
        const pts = [], cols = W - L - R;
        let col = -1, first = 0, mn = 0, mx = 0, last = 0, imn = 0, imx = 0;
        const flush = () => { if (col < 0) return; const x = (L + col).toFixed(1); const a = imn < imx ? [mn, mx] : [mx, mn]; pts.push(`${x},${Y(first).toFixed(1)}`, `${x},${Y(a[0]).toFixed(1)}`, `${x},${Y(a[1]).toFixed(1)}`, `${x},${Y(last).toFixed(1)}`); };
        for (let i = i0; i <= i1; i++) {
          const c = Math.max(0, Math.min(cols, Math.round((t[i] - v0) / span * cols))), v = q.y[i];
          if (c !== col) { flush(); col = c; first = mn = mx = last = v; imn = imx = i; } else { if (v < mn) { mn = v; imn = i; } if (v > mx) { mx = v; imx = i; } last = v; }
        }
        flush();
        s += `<polyline style="stroke:${q.color}" points="${pts.join(" ")}"/>`;
      });
      if (TR.hover !== null && TR.hover >= v0 && TR.hover <= v1) s += `<line class="tr-cursor" x1="${X(TR.hover).toFixed(1)}" x2="${X(TR.hover).toFixed(1)}" y1="${Tp}" y2="${H - B}"/>`;
      s += `<rect class="tr-zoom" id="tr-zoom" x="0" y="${Tp}" width="0" height="${H - Tp - B}" visibility="hidden"/>`;
      return s + "</svg>";
    }
    function readout(tr) {
      const r = TR.result, x = TR.hover;
      if (x === null) return `<span class="muted">Point at the chart to read the traces · drag to zoom in · double-click: all</span>`;
      return `<b class="mono">${esc(fmtEng(x, "s"))}</b> ` + tr.filter(q => q.y).map(q => `<span class="tr-val"><i style="background:${q.color}"></i>${esc(q.name)} <b class="mono">${esc(fmtEng(valueAt(r.t, q.y, x), "V"))}</b></span>`).join(" ");
    }
    function render() {
      const host = document.getElementById("tr-pane"), btn = document.getElementById("btn-tr-run");
      if (btn) btn.textContent = TR.job ? `■ Stop · ${Math.floor(TR.progress * 100)} %` : "▶ Run";
      const add = document.getElementById("tr-add");
      if (add && document.activeElement !== add) {
        const list = TR.nets && TR.result ? TR.nets : netNames(), have = new Set((TR.traces || []).map(x => x.toUpperCase()));
        const html = `<option value="">+ Plot a net…</option>` + list.filter(x => !have.has(x.key)).map(x => `<option value="${esc(x.name)}">${esc(x.name)}${x.alias && x.alias.length ? " (" + esc(x.alias.slice(0, 2).join(", ")) + ")" : ""}</option>`).join("");
        if (add.innerHTML !== html) add.innerHTML = html;
        add.value = "";
      }
      if (!host || host.hidden) return;
      if (TR.error && !TR.job) { host.innerHTML = `<div class="bom-empty">${esc(TR.error)}</div>`; return; }
      if (!TR.result) {
        host.innerHTML = `<div class="bom-empty">${TR.job ? "Running the transient…" : `Press ▶ Run: the circuit runs from ${opts.start === "zero" ? "zero (every capacitor empty)" : "its operating point"} for ${esc(opts.stop || "?")}s, at the steps it needs, and the chart shows the scope channels and named nets (add any net with + Plot a net). A pulse, PWL or exponential generator gives one-off events: start-up, a step response, a switching supply's soft start.`}</div>`;
        return;
      }
      const tr = shown(), r = TR.result, t = r.t, [v0, v1] = TR.view || [t[0], t[t.length - 1]], i0 = indexAt(t, v0), i1 = Math.min(t.length - 1, indexAt(t, v1));
      const chips = tr.map((q, k) => `<span class="tr-chip${q.missing ? " gone" : ""}" title="${q.missing ? "Not in this run (the net is gone or was added after it): run again" : esc(q.name)}"><i style="background:${q.color}"></i>${esc(q.name)}<button class="tr-x" data-k="${k}" title="Stop plotting it" aria-label="Remove ${esc(q.name)}">×</button></span>`).join("");
      const rows = tr.filter(q => q.y).map(q => { const st = traceStats(t, q.y, i0, i1); return st ? `<tr><td><i class="tr-sw" style="background:${q.color}"></i>${esc(q.name)}</td>${["min", "max", "pp", "avg", "rms", "end"].map(k => `<td class="n mono">${esc(fmtEng(st[k], "V", 4))}</td>`).join("")}</tr>` : ""; }).join("");
      const note = (TR.stale ? `<div class="bom-empty tol-note">The circuit changed since this run: press ▶ Run again.</div>` : "")
        + (TR.job ? `<div class="bom-empty tol-note">Running again…</div>` : "");
      host.innerHTML = note + `<div class="tr-wrap"><div class="tr-chips">${chips}<span class="muted tr-info" title="Steps the run took, and how many were taken again shorter because the waveform turned faster than the step">${esc(fmtEng(r.tStop, "s"))} · ${r.steps} steps · ${r.points} points${TR.view ? ` · showing ${esc(fmtEng(v0, "s"))} to ${esc(fmtEng(v1, "s"))}` : ""}</span>`
        + `<button class="btn tr-csv" id="btn-tr-csv" title="Save the plotted traces as a CSV file (time and one column per trace)">CSV</button>${TR.view ? `<button class="btn" id="btn-tr-all" title="Show the whole run (or double-click the chart)">Show all</button>` : ""}</div>`
        + chart(tr) + `<div class="tr-read" id="tr-read">${readout(tr)}</div>`
        + `<table class="nz-table tr-table"><thead><tr><th style="text-align:left" title="Over the time shown">Trace</th><th>Min</th><th>Max</th><th title="Peak to peak">p-p</th><th title="Average over the time shown">Average</th><th title="RMS over the time shown (with the DC)">RMS</th><th title="At the end of the time shown">End</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    function exportCsv() {
      const r = TR.result; if (!r) return "";
      const tr = shown().filter(q => q.y);
      const lines = ["time," + tr.map(q => `"V(${q.name.replace(/"/g, "'")})"`).join(",")];
      for (let i = 0; i < r.t.length; i++) lines.push(+r.t[i].toPrecision(9) + "," + tr.map(q => +q.y[i].toPrecision(7)).join(","));
      const data = lines.join("\n") + "\n";
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "text/csv;charset=utf-8" })); a.download = "transient.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setStatus("ok", `Saved transient.csv (${r.t.length} points, ${tr.length} traces)`);
      return data;
    }
    // the chart's pointer: the cursor, and a drag across it zooms to that span
    let drag = null;
    const timeAt = (svg, clientX) => {
      const r = TR.result, b = svg.getBoundingClientRect(), x = (clientX - b.left) / b.width * W;
      const [v0, v1] = TR.view || [r.t[0], r.t[r.t.length - 1]];
      return { t: v0 + (Math.max(L, Math.min(W - R, x)) - L) / (W - L - R) * (v1 - v0), x: Math.max(L, Math.min(W - R, x)) };
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
      if (add) add.addEventListener("change", () => { if (!add.value) return; TR.traces = (TR.traces || []).concat(add.value); add.value = ""; render(); });
      const btn = document.getElementById("btn-tr-run");
      if (btn) btn.addEventListener("click", () => (TR.job ? stop() : run()));
      const host = document.getElementById("tr-pane");
      if (!host) return;
      host.addEventListener("click", e => {
        const x = e.target.closest(".tr-x"); if (x) { TR.traces.splice(+x.dataset.k, 1); render(); return; }
        if (e.target.closest("#btn-tr-csv")) exportCsv();
        if (e.target.closest("#btn-tr-all")) { TR.view = null; render(); }
      });
      host.addEventListener("mousedown", e => { const svg = e.target.closest("#tr-chart"); if (!svg || !TR.result || e.button !== 0) return; e.preventDefault(); drag = timeAt(svg, e.clientX); });
      host.addEventListener("mousemove", e => {
        const svg = e.target.closest("#tr-chart") || (drag && document.getElementById("tr-chart"));
        if (!svg || !TR.result) return;
        const p = timeAt(svg, e.clientX);
        TR.hover = p.t;
        const z = document.getElementById("tr-zoom");
        if (drag && z) { const a = Math.min(drag.x, p.x), b = Math.max(drag.x, p.x); z.setAttribute("x", a); z.setAttribute("width", b - a); z.setAttribute("visibility", b - a > 3 ? "visible" : "hidden"); }
        let cur = svg.querySelector(".tr-cursor");
        if (!cur) { cur = document.createElementNS("http://www.w3.org/2000/svg", "line"); cur.setAttribute("class", "tr-cursor"); cur.setAttribute("y1", Tp); cur.setAttribute("y2", H - B); svg.insertBefore(cur, z); }
        cur.setAttribute("x1", p.x); cur.setAttribute("x2", p.x);
        const rd = document.getElementById("tr-read"); if (rd) rd.innerHTML = readout(shown());
      });
      window.addEventListener("mouseup", e => {
        if (!drag) return;
        const svg = document.getElementById("tr-chart"), a = drag; drag = null;
        if (!svg || !TR.result) return;
        const b = timeAt(svg, e.clientX);
        if (Math.abs(b.x - a.x) > 3) { TR.view = [Math.min(a.t, b.t), Math.max(a.t, b.t)]; render(); }
        else { const z = document.getElementById("tr-zoom"); if (z) z.setAttribute("visibility", "hidden"); }
      });
      host.addEventListener("dblclick", e => { if (e.target.closest("#tr-chart") && TR.view) { TR.view = null; render(); } });
      host.addEventListener("mouseleave", () => { if (drag) return; TR.hover = null; const rd = document.getElementById("tr-read"); if (rd && TR.result) rd.innerHTML = readout(shown()); const cur = document.querySelector("#tr-chart .tr-cursor"); if (cur) cur.remove(); });
      render();
    }
    return { changed, init, render, run, stop, exportCsv, netNames, shown, opts, setTraces: list => { TR.traces = list.slice(); render(); } };
  }
  CadTransient.parseIc = parseIc; CadTransient.traceStats = traceStats; CadTransient.valueAt = valueAt;
  root.CadTransient = CadTransient;
})(typeof window !== "undefined" ? window : globalThis);
