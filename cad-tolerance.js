/* Tolerance runs (Monte Carlo), the Tolerance tab under the schematic: the circuit simulated
   again and again with every resistor, pot and capacitor at a random value within its tolerance
   and every tube drawing more or less current than its model, as production parts do. Each
   quantity the CAD measures (a tube's Ia, Va and Pa, a transistor's current and dissipation, a
   speaker's power, a scope channel's AC) shows its nominal value and its spread over the runs,
   and how many runs took a part beyond its rating.
   A value is normally distributed about its nominal with the tolerance as two standard
   deviations (about 95 % of parts within it), cut off at the tolerance. A tube's spread scales
   all its currents (the engine's iScale): ±20 % is a tube drawing 20 % more or less plate
   current than the model at the same voltages. Runs are seeded, so a seed repeats its runs. */
(function (root) {
  "use strict";
  // mulberry32: a small seeded generator, uniform on [0, 1)
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // a factor within ±tol (a fraction): normal, σ = tol / 2, cut off at ±2σ
  function factor(rand, tol) {
    if (!(tol > 0)) return 1;
    const g = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    return 1 + Math.max(-2, Math.min(2, g)) * tol / 2;
  }
  // which tolerance a part takes, by its type
  const CLASS = { resistor: "r", pot: "r", capacitor: "c", electrolytic: "c", tube: "tube" };
  // The netlist with each part's value varied. typeOf(id): a part's type; tol: { r, c, tube } as
  // fractions. One factor per part, so both halves of a pot move together; a part's own
  // internal elements (a tube's interelectrode capacitances, a speaker's voice coil) stay as they are.
  function vary(netlist, typeOf, tol, rand) {
    const f = {};
    const take = (id, t) => (f[id] !== undefined ? f[id] : (f[id] = factor(rand, t)));
    const elements = netlist.elements.map(e => {
      const id = String(e.id || ""), part = id.split("#")[0], cls = CLASS[typeOf(part)];
      if (cls === "r" && e.kind === "R" && (id === part || typeOf(part) === "pot")) return Object.assign({}, e, { r: e.r * take(part, tol.r) });
      if (cls === "c" && e.kind === "C" && id === part) return Object.assign({}, e, { c: e.c * take(part, tol.c) });
      if (cls === "tube" && (e.kind === "TRIODE" || e.kind === "PENTODE") && id === part) return Object.assign({}, e, { iScale: (e.iScale || 1) * take(part, tol.tube) });
      return e;
    });
    return { netlist: { nodeCount: netlist.nodeCount, elements }, factors: f };
  }
  // per quantity: nominal, min, mean, max, standard deviation, and how many runs were over its rating
  // runs: [[{ key, label, unit, v, max }]] (run 0 the nominal circuit); quantities in run 0's order
  function summarize(runs) {
    const nominal = runs[0] || [], varied = runs.slice(1).filter(Boolean);
    return nominal.map(q => {
      const vs = varied.map(r => (r.find(x => x.key === q.key) || {}).v).filter(v => isFinite(v));
      const n = vs.length, mean = n ? vs.reduce((s, v) => s + v, 0) / n : NaN;
      const sd = n > 1 ? Math.sqrt(vs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1)) : 0;
      const over = q.max > 0 ? vs.filter(v => v > q.max).length : 0;
      return { key: q.key, label: q.label, unit: q.unit, max: q.max, nominal: q.v, n, min: n ? Math.min(...vs) : NaN, maxV: n ? Math.max(...vs) : NaN, mean, sd, over };
    });
  }

  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadTolerance(cad) {
    const { S, VERSION, buildNetlist, cmds, esc, fmtEng, measurements, setStatus, topo, withResult } = cad;
    const TOL_KEY = "tubecad_tolerance";
    const opts = { runs: 20, r: 5, c: 20, tube: 20, seed: 1 };
    try { Object.assign(opts, JSON.parse(localStorage.getItem(TOL_KEY)) || {}); } catch (e) {}
    const saveOpts = () => { try { localStorage.setItem(TOL_KEY, JSON.stringify(opts)); } catch (e) {} };
    // job: { seq, done, total, failed, runs }; rows: the last finished summary
    S.tol = { seq: 0, job: null, rows: null, runs: 0, failed: 0, stale: false, error: null, opts };
    let worker = null;
    const RUN = { budgetMs: 120000, maxPeriods: 20000 };   // as ▶ Simulate: each run settles fully

    function stop() {
      if (worker) { worker.terminate(); worker = null; }
      if (S.tol.job) { S.tol.job = null; S.tol.seq++; setStatus("idle", "Tolerance runs stopped"); render(); cmds.sync(); }
    }
    function run() {
      stop();
      const T = topo();
      if (!S.comps.length) { S.tol.error = "Empty sheet"; render(); return; }
      if (!T.hasGround) { S.tol.error = "Add a ground symbol to simulate"; render(); return; }
      const base = buildNetlist(), types = new Map(S.comps.map(c => [c.id, c.type])), typeOf = id => types.get(id);
      const tol = { r: opts.r / 100, c: opts.c / 100, tube: opts.tube / 100 }, rand = rng(opts.seed);
      const total = Math.max(1, Math.min(500, Math.round(opts.runs) || 1));
      // run 0: the circuit as drawn, then the varied ones
      const nets = [base];
      for (let k = 0; k < total; k++) nets.push(vary(base, typeOf, tol, rand).netlist);
      const seq = ++S.tol.seq, job = S.tol.job = { seq, done: 0, total, failed: 0, runs: [] };
      S.tol.error = null;
      const progress = f => setStatus("busy", `Tolerance runs: ${job.done} of ${total + 1} · ${Math.floor(f * 100)} %`, (job.done + f) / (total + 1));
      const finish = () => {
        worker = null; S.tol.job = null;
        S.tol.rows = summarize(job.runs); S.tol.runs = total; S.tol.failed = job.failed; S.tol.stale = false;
        S.tol.error = job.runs[0] ? null : "The circuit as drawn did not simulate";
        setStatus(S.tol.error || job.failed ? "warn" : "ok", S.tol.error || `Tolerance: ${total - job.failed} runs` + (job.failed ? ` · ${job.failed} did not settle` : ""));
        render(); cmds.sync();
      };
      const take = (k, result) => {
        if (S.tol.seq !== seq) return;
        if (result && result.ok) job.runs[k] = withResult(result, nets[k], T, measurements);
        else if (k > 0) job.failed++;
        job.done = k + 1;
        if (k + 1 < nets.length) next(k + 1); else finish();
        if (S.tol.job) render();
      };
      const next = k => {
        progress(0);
        if (worker) worker.postMessage({ seq: k, netlist: nets[k], options: RUN });
        else setTimeout(() => take(k, TubeSimEngine.simulate(nets[k], RUN)), 0);
      };
      try { worker = new Worker("sim-worker.js" + VERSION); } catch (e) { worker = null; }
      if (worker) worker.onmessage = e => { if (e.data.result) take(e.data.seq, e.data.result); else if (S.tol.job) progress(e.data.progress); };
      render(); cmds.sync();
      next(0);
    }
    // an edit makes the shown spread the old circuit's
    function changed() { if (S.tol.rows && !S.tol.stale) { S.tol.stale = true; render(); } }

    const pct = (v, nom) => (nom ? `±${(Math.abs(v / nom) * 100).toFixed(1)} %` : "—");
    function render() {
      const host = document.getElementById("tol-pane"), btn = document.getElementById("btn-tol-run");
      if (btn) btn.textContent = S.tol.job ? `■ Stop · ${S.tol.job.done} / ${S.tol.job.total + 1}` : "▶ Run";
      if (!host || host.hidden) return;
      const t = S.tol;
      if (t.error && !t.job) { host.innerHTML = `<div class="bom-empty">${esc(t.error)}</div>`; return; }
      if (!t.rows) {
        host.innerHTML = `<div class="bom-empty">${t.job ? "Running…" : "Press ▶ Run: the circuit is simulated once as drawn and then once per run with every resistor, pot and capacitor at a random value within its tolerance and every tube drawing more or less current, and each measured value shows its spread."}</div>`;
        return;
      }
      const note = (t.stale ? `<div class="bom-empty tol-note">The circuit changed since these runs: press ▶ Run again.</div>` : "")
        + (t.failed ? `<div class="bom-empty tol-note">${t.failed} of ${t.runs} runs did not settle and are left out.</div>` : "");
      const f = (v, u) => fmtEng(v, u);
      host.innerHTML = note + `<table id="tol-table"><thead><tr><th>Quantity</th><th>Nominal</th><th>Min</th><th>Mean</th><th>Max</th><th title="Two standard deviations over the runs, against the nominal value">Spread (2σ)</th><th title="Runs that took the part beyond its rating">Over rating</th></tr></thead><tbody>`
        + t.rows.map(r => `<tr><td>${esc(r.label)}</td><td class="n mono">${f(r.nominal, r.unit)}</td><td class="n mono">${f(r.min, r.unit)}</td><td class="n mono">${f(r.mean, r.unit)}</td><td class="n mono">${f(r.maxV, r.unit)}</td>`
          + `<td class="n mono">${pct(2 * r.sd, r.nominal)}</td><td class="n${r.over ? " warn" : ""}">${r.max > 0 ? `${r.over} of ${r.n}` : ""}</td></tr>`).join("") + "</tbody></table>";
    }
    function init() {
      [["runs", 1, 500], ["r", 0, 50], ["c", 0, 80], ["tube", 0, 60], ["seed", 1, 1e9]].forEach(([k, lo, hi]) => {
        const el = document.getElementById("tol-" + k); if (!el) return;
        el.value = opts[k];
        el.addEventListener("change", () => { const v = Math.round(+el.value * 10) / 10; if (isFinite(v) && v >= lo && v <= hi) { opts[k] = k === "runs" || k === "seed" ? Math.round(v) : v; saveOpts(); } el.value = opts[k]; });
      });
      const btn = document.getElementById("btn-tol-run");
      if (btn) btn.addEventListener("click", () => (S.tol.job ? stop() : run()));
      render();
    }
    return { changed, init, render, run, stop };
  }
  CadTolerance.rng = rng; CadTolerance.factor = factor; CadTolerance.vary = vary; CadTolerance.summarize = summarize;
  root.CadTolerance = CadTolerance;
})(typeof window !== "undefined" ? window : globalThis);
