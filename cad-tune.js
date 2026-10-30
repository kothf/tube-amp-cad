/* Auto-tune, the Tune tab under the schematic: part values changed until the simulated circuit
   meets goals such as "BA1 output ≥ 10 W" and "BA1 THD ≤ 1 %". The simulator judges every try;
   no AI is needed. An optimizer (a pattern search with adaptive steps, in log scale for values
   that span decades) proposes a batch of tries round the best so far, the engine's pool
   simulates them all at once, and the best one moves the search on. At the end the values are
   rounded to standard series (E24 resistors, E12 capacitors) and that circuit is simulated once
   more, so what Apply sets is exactly what was checked. With an AI key, "AI start" asks the
   model which values to vary, over what ranges and from where (cad-ai.js). */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // The optimizer: points are normalised to 0…1 per variable; it only sees costs.
  // ask() → the batch to evaluate, tell(batch, costs) → moves on; done when the step is tiny,
  // the budget is spent or the cost reaches zero (every goal met)
  // ---------------------------------------------------------------------------
  function Optimizer({ x0, budget, batch, seed }) {
    const n = x0.length, clamp = v => Math.max(0, Math.min(1, v));
    let s = seed || 12345;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const O = { best: null, cost: Infinity, step: 0.25, evals: 0, budget, done: false, history: [], started: false };
    let dirs = [];   // the last good direction is tried again, longer
    O.ask = function () {
      if (!O.started) { O.started = true; return [x0.map(clamp)]; }
      const out = [], k = Math.max(2, batch || 2 * n), b = O.best;
      // both ways along each variable, then random directions, then the last good move extended
      const coords = [];
      for (let i = 0; i < n; i++) [1, -1].forEach(sg => { const p = b.slice(); p[i] = clamp(p[i] + sg * O.step); coords.push(p); });
      dirs.forEach(d => out.push(b.map((v, i) => clamp(v + 2 * d[i]))));
      for (let i = 0; i < coords.length && out.length < k; i++) out.push(coords[(i + O.evals) % coords.length]);
      while (out.length < k) { const g = b.map(() => gauss()), m = Math.sqrt(g.reduce((a, v) => a + v * v, 0)) || 1; out.push(b.map((v, i) => clamp(v + O.step * g[i] / m))); }
      const left = Math.max(1, O.budget - O.evals);
      return out.filter((p, i, a) => a.findIndex(q => q.every((v, j) => Math.abs(v - p[j]) < 1e-9)) === i && !p.every((v, j) => Math.abs(v - b[j]) < 1e-9)).slice(0, left);
    };
    O.tell = function (pts, costs) {
      let moved = false;
      pts.forEach((p, i) => {
        O.evals++;
        const c = isFinite(costs[i]) ? costs[i] : Infinity;
        if (c < O.cost - 1e-12) { if (O.best) dirs = [p.map((v, j) => v - O.best[j])]; O.cost = c; O.best = p.slice(); moved = true; }
        O.history.push(O.cost);
      });
      if (!O.best) { O.best = pts[0].slice(); O.cost = Infinity; }
      if (!moved) { O.step *= 0.5; dirs = []; } else O.step = Math.min(0.5, O.step * 1.25);
      O.done = O.cost <= 0 || O.step < 0.004 || O.evals >= O.budget;
    };
    return O;
  }

  // standard values: the E series nearest to v
  const SERIES = {
    E12: [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2],
    E24: [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1]
  };
  function nearest(v, name) {
    const list = SERIES[name]; if (!list || !(v > 0)) return v;
    const d = Math.floor(Math.log10(v)); let best = v, err = Infinity;
    [d - 1, d, d + 1].forEach(e => list.forEach(m => { const c = m * Math.pow(10, e), r = Math.abs(Math.log(c / v)); if (r < err) { err = r; best = c; } }));
    return +best.toPrecision(3);
  }
  const seriesFor = (type, key) => (key === "r" && (type === "resistor" || type === "pot") ? "E24" : key === "c" && (type === "capacitor" || type === "electrolytic") ? "E12" : "");

  // a value ↔ its place in the variable's range (log where both ends are positive)
  const isLog = v => v.lo > 0 && v.hi > 0;
  const toUnit = (v, x) => (isLog(v) ? (Math.log(x) - Math.log(v.lo)) / (Math.log(v.hi) - Math.log(v.lo)) : (x - v.lo) / (v.hi - v.lo));
  const fromUnit = (v, t) => (isLog(v) ? Math.exp(Math.log(v.lo) + t * (Math.log(v.hi) - Math.log(v.lo))) : v.lo + t * (v.hi - v.lo));

  // how far a set of measured values is from the goals: 0 when every goal is met (within 1 %);
  // rated: [{ v, max }] each beyond its rating adds a penalty
  function cost(goals, q, rated) {
    let c = 0;
    goals.forEach(g => {
      const m = q[g.key];
      if (m === undefined || !isFinite(m)) { c += 4; return; }
      const scale = Math.abs(g.target) > 1e-12 ? Math.abs(g.target) : 1;
      let e = (m - g.target) / scale;
      if (g.op === ">=") e = Math.min(0, e); else if (g.op === "<=") e = Math.max(0, e); else if (Math.abs(e) < 0.01) e = 0;
      c += e * e;
    });
    (rated || []).forEach(r => { if (r.max > 0 && r.v > r.max) c += 4 * Math.pow(r.v / r.max - 1, 2) + 0.01; });
    return c;
  }
  const met = (g, m) => m !== undefined && isFinite(m) && (g.op === ">=" ? m >= g.target * (1 - 1e-6) : g.op === "<=" ? m <= g.target * (1 + 1e-6) + 1e-12 : Math.abs(m - g.target) <= 0.01 * Math.max(Math.abs(g.target), 1e-12));

  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadTune(cad) {
    const { S, buildNetlist, cmds, commit, desig, esc, fmtEng, harmonics, measurements, pool, scopeChannels, setStatus, signalFreq, speakerWave, topo, withResult } = cad;
    const LIB = CadLib.LIB, A = root.AiCircuit;
    const T = S.tune = { goals: [], vars: [], ratings: true, budget: 120, job: null, run: null, stale: false, error: null };
    let jobs = [], ai = null;
    const RUN = { budgetMs: 120000, maxPeriods: 20000 };
    const warmOf = r => (r && r.ok && r.warm && r.shooting && !r.shooting.converged ? r.warm : null);
    const $ = id => document.getElementById(id);
    const byId = id => S.comps.find(c => c.id === id);

    // what a goal can be: everything the CAD measures, and the THD of each speaker and scope channel
    function quantities() {
      const out = measurements().map(m => ({ key: m.key, label: m.label, unit: m.unit, v: m.v, max: m.max }));
      const f0 = signalFreq(), r = S.sim.result;
      const thd = w => { if (!w || !f0 || !r || !r.tran) return undefined; let mean = 0; for (let k = 0; k < w.length; k++) mean += w[k]; mean /= w.length; const h = harmonics(Array.from(w, x => x - mean), f0, r.tran.dt, Math.max(2, Math.min(10, Math.floor(0.5 / (r.tran.dt * f0)) - 1))); return 100 * Math.sqrt(h.slice(1).reduce((s, v) => s + v * v, 0)) / Math.max(h[0], 1e-15); };
      S.comps.forEach(c => {
        const name = desig(c) || c.id;
        if (c.type === "speaker") { const w = speakerWave(c); out.push({ key: c.id + ":thd", label: `${name} THD`, unit: "%", v: w ? thd(w.v) : undefined }); }
        else if (c.type === "scope") { const ch = scopeChannels(c); ["ch1", "ch2"].forEach(k => out.push({ key: c.id + ":" + k + "thd", label: `${name} ${k.toUpperCase()} THD`, unit: "%", v: ch ? thd(ch[k]) : undefined })); }
      });
      return out;
    }
    // the parts' values a variable can be: numeric fields (a resistor's resistance, a generator's level)
    function knobs() {
      const out = [];
      S.comps.forEach(c => {
        if (!LIB[c.type] || c.type === "frame" || c.type === "note") return;
        A.fields(c).forEach(fd => {
          if (!["eng", "number", "range"].includes(fd.kind) || !isFinite(+c.params[fd.key])) return;
          out.push({ id: c.id, key: fd.key, label: `${desig(c) || c.id} ${fd.label.toLowerCase()}`, unit: fd.unit, kind: fd.kind, min: fd.min, max: fd.max, type: c.type });
        });
      });
      return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    }
    const knob = v => knobs().find(k => k.id === v.id && k.key === v.key);
    // a sensible range: a third to three times the value (a range field: its whole range)
    function defaultRange(k) {
      const c = byId(k.id), x = +c.params[k.key];
      if (k.kind === "range") return [k.min !== undefined ? k.min : 0, k.max !== undefined ? k.max : 1];
      if (x > 0) return [+(x / 3).toPrecision(2), +(x * 3).toPrecision(2)];
      if (x < 0) return [x * 3, x / 3];
      return [0, 1];
    }
    function addVar(id, key, lo, hi) {
      if (T.vars.some(v => v.id === id && v.key === key)) return;
      const k = knobs().find(q => q.id === id && q.key === key); if (!k) return;
      const [a, b] = lo !== undefined && hi !== undefined && lo < hi ? [lo, hi] : defaultRange(k);
      T.vars.push({ id, key, lo: a, hi: b, snap: seriesFor(k.type, key) });
    }
    // a first guess at what to vary: the resistors at the tubes' and transistors' pins (bias and loads)
    function suggest() {
      const top = topo(), act = S.comps.filter(c => c.type === "tube" || CadLib.isTransistor(c.type));
      const nets = new Set(); act.forEach(c => Object.keys(c.params).length && LIB[c.type] && cad.compPins(c).forEach(p => nets.add(top.pinNet.get(c.id + ":" + p.id))));
      S.comps.filter(c => c.type === "resistor" && cad.compPins(c).some(p => nets.has(top.pinNet.get(c.id + ":" + p.id)) && top.pinNet.get(c.id + ":" + p.id) !== 0)).slice(0, 8).forEach(c => addVar(c.id, "r"));
      render();
    }

    // ---- a run ----
    function stop(why) {
      jobs.forEach(j => j.cancel()); jobs = [];
      if (T.job) { T.job = null; setStatus("idle", why || "Auto-tune stopped"); render(); cmds.sync(); }
    }
    function measureNow(vals) {
      const q = {}, rated = [];
      quantities().forEach(x => { if (x.v !== undefined) q[x.key] = x.v; if (T.ratings && x.max > 0 && x.v !== undefined) rated.push({ v: x.v, max: x.max, label: x.label }); });
      return { q, rated, vals };
    }
    // the netlist with the variables at these values (the parts get their values back at once)
    function netFor(vals) {
      const keep = T.vars.map(v => byId(v.id).params[v.key]);
      T.vars.forEach((v, i) => { byId(v.id).params[v.key] = vals[i]; });
      try { return buildNetlist(); } finally { T.vars.forEach((v, i) => { byId(v.id).params[v.key] = keep[i]; }); }
    }
    // simulate a batch of value sets on the pool: cb(k, { q, rated } | null)
    function simulate(sets, topoNow, options, cb, onProgress) {
      sets.forEach((vals, k) => {
        const net = netFor(vals);
        const take = res => { if (!T.job) return; cb(k, res && res.ok ? withResult(res, net, topoNow, () => measureNow(vals)) : null); };
        if (!pool.ok) { setTimeout(() => take(TubeSimEngine.simulate(net, options)), 0); return; }
        jobs.push(pool.run({ netlist: net, options }, { onResult: take, onProgress: f => onProgress && onProgress(k, f) }));
      });
    }
    function run() {
      stop();
      const top = topo();
      T.vars = T.vars.filter(v => byId(v.id) && knob(v));
      T.goals = T.goals.filter(g => g.key && isFinite(g.target));
      T.error = !S.comps.length ? "Empty sheet" : !top.hasGround ? "Add a ground symbol to simulate"
        : !T.goals.length ? "Add a goal first: what the circuit should reach (an output power, a THD, a tube's current…)."
          : !T.vars.length ? "Add the values Auto-tune may change (+ Value, or Suggest)." : null;
      if (T.error) { render(); return; }
      const vars = T.vars.map(v => Object.assign({}, v, { label: knob(v).label, unit: knob(v).unit }));
      const start = vars.map(v => +byId(v.id).params[v.key]);
      const x0 = vars.map((v, i) => Math.max(0, Math.min(1, toUnit(v, start[i]))));
      const cores = (pool && pool.size) || (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
      const opt = Optimizer({ x0, budget: Math.max(10, +T.budget || 120), batch: Math.max(4, Math.min(2 * vars.length + 2, Math.max(cores, 4))) });
      const base = buildNetlist();
      const last = !S.sim.busy && S.sim.result && S.sim.netlist && JSON.stringify(S.sim.netlist) === JSON.stringify(base) ? warmOf(S.sim.result) : null;
      const options = last ? Object.assign({ warm: last }, RUN) : RUN;
      const goals = T.goals.map(g => Object.assign({}, g));
      const job = T.job = { opt, failed: 0 };
      T.run = { vars, goals, start, startM: null, best: null, bestM: null, snapped: null, snappedM: null, history: opt.history, evals: 0, phase: "search" };
      T.stale = false;
      const valsOf = p => vars.map((v, i) => { const x = fromUnit(v, p[i]); return v.kind === "range" ? Math.round(x * 1000) / 1000 : x; });
      const progress = () => setStatus("busy", `Auto-tune: ${opt.evals} of ${opt.budget} tries · ${T.run.bestM ? "cost " + opt.cost.toPrecision(3) : "starting"}`, opt.evals / opt.budget);
      const step = () => {
        if (T.job !== job) return;
        if (opt.done) { finish(); return; }
        const pts = opt.ask(); if (!pts.length) { opt.done = true; finish(); return; }
        const sets = pts.map(valsOf), costs = new Array(pts.length), ms = new Array(pts.length);
        let left = pts.length;
        simulate(sets, top, options, (k, m) => {
          if (T.job !== job) return;
          ms[k] = m; costs[k] = m ? cost(goals, m.q, m.rated) : Infinity; if (!m) job.failed++;
          if (--left) return;
          const before = opt.cost;
          opt.tell(pts, costs);
          const i = costs.indexOf(Math.min(...costs));
          if (!T.run.startM && ms[0]) T.run.startM = ms[0].q;
          if (opt.cost < before) { T.run.best = sets[i]; T.run.bestM = ms[i]; }
          T.run.evals = opt.evals;
          progress(); render(); step();
        });
      };
      // the end: the best values rounded to standard series, checked once more
      const finish = () => {
        if (!T.run.best) { T.job = null; T.error = "No try settled: run ▶ Simulate to see what the circuit does."; setStatus("warn", T.error); render(); cmds.sync(); return; }
        T.run.phase = "round";
        const snapped = T.run.best.map((x, i) => (vars[i].snap ? nearest(x, vars[i].snap) : vars[i].kind === "range" ? x : +x.toPrecision(3)));
        simulate([snapped], top, options, (k, m) => {
          if (T.job !== job) return;
          T.job = null; jobs = [];
          T.run.snapped = snapped; T.run.snappedM = m;
          T.run.cost = m ? cost(goals, m.q, m.rated) : Infinity;
          T.run.ok = !!m && goals.every(g => met(g, m.q[g.key])) && (!T.ratings || !m.rated.some(r => r.v > r.max));
          T.run.phase = "done";
          setStatus(T.run.ok ? "ok" : "warn", `Auto-tune: ${T.run.ok ? "every goal met" : "closest it got"} after ${opt.evals} tries` + (job.failed ? ` · ${job.failed} did not settle` : "") + " · Apply sets the values");
          render(); cmds.sync();
        });
      };
      render(); cmds.sync(); progress(); step();
    }
    // the rounded best values into the circuit (one undo step)
    function apply() {
      const R = T.run; if (!R || !R.snapped) return;
      R.vars.forEach((v, i) => { const c = byId(v.id); if (c) c.params[v.key] = R.snapped[i]; });
      commit();
      R.applied = true;
      setStatus("ok", "Auto-tune: values set · " + R.vars.map((v, i) => `${v.label} ${fmtV(R.snapped[i], v)}`).join(", "));
      render();
    }
    function changed() { if (T.run && T.run.phase === "done" && !T.stale && !T.run.applied) { T.stale = true; render(); } }
    const fmtV = (x, v) => (v.kind === "range" ? (+x).toFixed(3) : fmtEng(+x, v.unit || ""));

    // ---- drawing ----
    function chart(hist) {
      const W = 300, H = 120, pts = hist.map((c, i) => [i, c]).filter(p => isFinite(p[1]));
      if (pts.length < 2) return "";
      const lg = v => Math.log10(Math.max(v, 1e-6)), ys = pts.map(p => lg(p[1])), y0 = Math.min(...ys), y1 = Math.max(...ys, y0 + 1);
      const X = i => 30 + i / Math.max(1, hist.length - 1) * (W - 36), Y = v => 8 + (y1 - lg(v)) / (y1 - y0) * (H - 26);
      return `<svg class="pw-chart tune-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="How far from the goals, try by try"><polyline class="thd" points="${pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}"/>`
        + `<text class="ax" x="${W / 2}" y="${H - 3}" text-anchor="middle">tries → (distance from the goals, log)</text></svg>`;
    }
    const opsHTML = op => [[">=", "≥"], ["<=", "≤"], ["=", "="]].map(([v, t]) => `<option value="${v}"${v === op ? " selected" : ""}>${t}</option>`).join("");
    function render() {
      const btn = $("btn-tune-run"); if (btn) btn.textContent = T.job ? `■ Stop · ${T.job.opt.evals} / ${T.job.opt.budget}` : "▶ Tune";
      const bud = $("tune-budget"); if (bud && document.activeElement !== bud) bud.value = T.budget;
      const host = $("tune-pane"); if (!host || host.hidden) return;
      const qs = quantities(), ks = knobs(), R = T.run;
      const qLabel = key => (qs.find(x => x.key === key) || {}).label || key, qUnit = key => (qs.find(x => x.key === key) || {}).unit || "";
      const qOpts = sel => qs.map(x => `<option value="${esc(x.key)}"${x.key === sel ? " selected" : ""}>${esc(x.label)}</option>`).join("");
      const goals = T.goals.map((g, i) => `<div class="tune-row" data-g="${i}"><select class="tol-sel" data-f="key">${qOpts(g.key)}</select><select class="tol-sel" data-f="op">${opsHTML(g.op)}</select><input class="tol-num sw-num" data-f="target" value="${esc(g.text !== undefined ? g.text : fmtEng(g.target, ""))}"><span class="muted">${esc(qUnit(g.key))}</span><button class="btn tune-x" data-del-g="${i}" title="Remove this goal">✕</button></div>`).join("");
      const vars = T.vars.map((v, i) => { const k = ks.find(q => q.id === v.id && q.key === v.key); const c = byId(v.id);
        return `<div class="tune-row" data-v="${i}"><span class="tune-name" title="Now ${c && k ? esc(fmtV(c.params[v.key], k)) : "—"}">${esc(k ? k.label : "(part removed)")}</span><span class="muted">from</span><input class="tol-num sw-num" data-f="lo" value="${esc(fmtEng(v.lo, ""))}"><span class="muted">to</span><input class="tol-num sw-num" data-f="hi" value="${esc(fmtEng(v.hi, ""))}"><span class="muted">${esc(k ? k.unit : "")}</span>`
          + `<select class="tol-sel" data-f="snap" title="Round the result to standard values"><option value="">exact</option><option value="E24"${v.snap === "E24" ? " selected" : ""}>E24</option><option value="E12"${v.snap === "E12" ? " selected" : ""}>E12</option></select><button class="btn tune-x" data-del-v="${i}" title="Remove">✕</button></div>`; }).join("");
      const kOpts = ks.filter(k => !T.vars.some(v => v.id === k.id && v.key === k.key)).map(k => `<option value="${esc(k.id + "|" + k.key)}">${esc(k.label)}</option>`).join("");
      let left = `<div class="tune-sec">Goals <span class="muted">what the circuit should reach</span></div>${goals || `<div class="muted tune-empty">No goal yet.</div>`}`
        + `<div class="tune-row"><select class="tol-sel" id="tune-add-g"><option value="">+ Goal…</option>${qOpts("")}</select></div>`
        + `<label class="tune-check"><input type="checkbox" id="tune-ratings"${T.ratings ? " checked" : ""}> Keep every tube and transistor within its ratings</label>`
        + `<div class="tune-sec">Values to change <span class="muted">and the range each may take</span></div>${vars || `<div class="muted tune-empty">None yet.</div>`}`
        + `<div class="tune-row"><select class="tol-sel" id="tune-add-v"><option value="">+ Value…</option>${kOpts}</select><button class="btn" id="btn-tune-suggest" title="The resistors at the tubes' and transistors' pins">Suggest</button></div>`;
      let right = "";
      if (T.error && !T.job) right = `<div class="bom-empty">${esc(T.error)}</div>`;
      else if (!R) right = `<div class="bom-empty">Set the goals (for example <b>BA1 output ≥ 10 W</b> and <b>BA1 THD ≤ 1 %</b>, with the generator's level among the values to change) and the values Auto-tune may change, then press <b>▶ Tune</b>. Each try is a full simulation; the tries run on all cores at once. No AI key is needed${window.AiClient && AiClient.ready(AiClient.load()) ? "; <b>AI start</b> asks the AI which values to vary and where to begin" : ""}.</div>`;
      else {
        const m = R.phase === "done" ? (R.snappedM || R.bestM) : R.bestM, mq = m ? m.q : {};
        const gRows = R.goals.map(g => { const v = mq[g.key], ok = met(g, v); return `<tr><td>${esc(qLabel(g.key))}</td><td class="n mono">${{ ">=": "≥", "<=": "≤", "=": "=" }[g.op]} ${esc(fmtEng(g.target, qUnit(g.key)))}</td><td class="n mono">${R.startM && R.startM[g.key] !== undefined ? esc(fmtEng(R.startM[g.key], qUnit(g.key), 3)) : "—"}</td><td class="n mono ${v === undefined ? "" : ok ? "ok" : "warn"}">${v !== undefined ? esc(fmtEng(v, qUnit(g.key), 3)) + (ok ? " ✓" : "") : "—"}</td></tr>`; }).join("");
        const shown = R.phase === "done" ? R.snapped : R.best;
        const vRows = R.vars.map((v, i) => `<tr><td>${esc(v.label)}</td><td class="n mono">${esc(fmtV(R.start[i], v))}</td><td class="n mono"><b>${shown ? esc(fmtV(shown[i], v)) : "…"}</b></td></tr>`).join("");
        const over = m && m.rated.filter(r => r.v > r.max);
        const head = T.job ? `<div class="tune-state">Searching… ${R.evals} of ${T.job.opt.budget} tries</div>`
          : `<div class="tune-state ${R.ok ? "ok" : "warn"}">${R.ok ? "✓ Every goal met" : "Closest it got: not every goal is met"}${R.vars.some(v => v.snap) ? " (values rounded to standard series)" : ""}</div>`;
        right = (T.stale ? `<div class="bom-empty tol-note">The circuit changed since this run: press ▶ Tune again.</div>` : "") + head
          + `<table class="tune-table"><tr><th>Goal</th><th>Target</th><th>Start</th><th>${T.job ? "Best so far" : "Result"}</th></tr>${gRows}</table>`
          + (over && over.length ? `<div class="tune-state warn">Beyond a rating: ${over.map(r => esc(r.label)).join(", ")}</div>` : "")
          + `<table class="tune-table"><tr><th>Value</th><th>Start</th><th>${T.job ? "Best so far" : "Result"}</th></tr>${vRows}</table>`
          + (!T.job && R.snapped ? `<div class="ai-row"><button class="btn primary" id="btn-tune-apply"${R.applied ? " disabled" : ""}>${R.applied ? "✓ Applied" : "Apply these values"}</button></div>` : "")
          + chart(R.history);
      }
      host.innerHTML = `<div class="tune-wrap"><div class="tune-left">${left}</div><div class="tune-right">${right}</div></div>`;
    }
    function onInput(e) {
      const t = e.target, row = t.closest("[data-g], [data-v]");
      if (t.id === "tune-add-g" && t.value) { const q = quantities().find(x => x.key === t.value); T.goals.push({ key: t.value, op: q && q.unit === "%" ? "<=" : q && q.max ? "<=" : ">=", target: q && q.v !== undefined ? +(+q.v).toPrecision(2) : 0 }); render(); return; }
      if (t.id === "tune-add-v" && t.value) { const [id, key] = t.value.split("|"); addVar(id, key); render(); return; }
      if (t.id === "tune-ratings") { T.ratings = t.checked; return; }
      if (!row) return;
      if (row.dataset.g !== undefined) {
        const g = T.goals[+row.dataset.g], f = t.dataset.f;
        if (f === "target") { const v = CadLib.parseEng(t.value); if (isFinite(v)) { g.target = v; delete g.text; } else t.classList.add("bad"); }
        else if (f) g[f] = t.value;
        if (f === "key") render();
      } else {
        const v = T.vars[+row.dataset.v], f = t.dataset.f;
        if (f === "lo" || f === "hi") { const x = CadLib.parseEng(t.value); if (isFinite(x)) v[f] = x; if (v.lo > v.hi) [v.lo, v.hi] = [v.hi, v.lo]; render(); }
        else if (f === "snap") v.snap = t.value;
      }
    }
    function onClick(e) {
      const t = e.target;
      if (t.dataset.delG !== undefined) { T.goals.splice(+t.dataset.delG, 1); render(); }
      else if (t.dataset.delV !== undefined) { T.vars.splice(+t.dataset.delV, 1); render(); }
      else if (t.id === "btn-tune-suggest") suggest();
      else if (t.id === "btn-tune-apply") apply();
    }

    // AI start: the model picks the values to vary, their ranges and where to begin (cad-ai.js)
    const AI_SYSTEM = "You are an expert amplifier designer helping an optimizer inside Tube Amp CAD. The user sets goals for the simulated circuit; a pattern-search optimizer will vary part values within ranges, and the simulator judges every try. "
      + "Pick the values most likely to reach the goals (usually 2 to 6: bias resistors, loads, feedback resistors, the generator's level when the goal is an output power at a distortion), a realistic range for each (keep the parts' ratings in mind), and a good starting value inside the range. Use only parts and value keys listed in the circuit. "
      + 'Answer with JSON only: {"note": "one or two sentences on the strategy", "variables": [{"part": "R10", "field": "r", "min": "500", "max": "3k", "start": "1.2k"}]}';
    async function aiStart() {
      if (!ai) return;
      if (!T.goals.length) { T.error = "Add a goal first: AI start picks the values to change for it."; render(); return; }
      const qs = quantities(), goals = T.goals.map(g => { const q = qs.find(x => x.key === g.key); return `- ${q ? q.label : g.key} ${{ ">=": "≥", "<=": "≤", "=": "=" }[g.op]} ${fmtEng(g.target, q ? q.unit : "")} (now ${q && q.v !== undefined ? fmtEng(q.v, q.unit, 3) : "unknown"})`; }).join("\n");
      ai.show();
      ai.add({ kind: "user", text: "Auto-tune: AI start", prompt: "Auto-tune: AI start" });
      try {
        const text = await ai.call({ system: AI_SYSTEM, messages: [{ role: "user", text: `The circuit, with each part's editable values as key=value:\n${ai.describe(true)}\n\nThe goals:\n${goals}${T.ratings ? "\nEvery tube and transistor must stay within its ratings." : ""}\n\nWhich values should the optimizer vary, over what ranges, and from where?` }] }, "Auto-tune: AI start");
        const j = AiClient.extractJson(text), used = [], bad = [];
        const keep = T.vars; T.vars = [];
        (Array.isArray(j.variables) ? j.variables : []).forEach(x => {
          const c = S.comps.find(k => ai.refOf(k) === String(x.part) || k.label === String(x.part)), k = c && knobs().find(q => q.id === c.id && q.key === String(x.field));
          const lo = CadLib.parseEng(String(x.min)), hi = CadLib.parseEng(String(x.max)), st = CadLib.parseEng(String(x.start));
          if (!k || !isFinite(lo) || !isFinite(hi) || lo >= hi) { bad.push(`${x.part} ${x.field}`); return; }
          addVar(c.id, k.key, lo, hi);
          if (isFinite(st)) { const t = Object.assign({ type: c.type, params: Object.assign({}, c.params) }); if (A.setValue(t, k.key, Math.max(lo, Math.min(hi, st))).ok) c.params[k.key] = t.params[k.key]; }
          used.push(`${k.label} ${fmtEng(lo, k.unit)}…${fmtEng(hi, k.unit)}${isFinite(st) ? `, from ${fmtEng(Math.max(lo, Math.min(hi, st)), k.unit)}` : ""}`);
        });
        if (!T.vars.length) T.vars = keep; else commit();
        ai.add({ kind: "answer", text: (j.note ? j.note + "\n\n" : "") + (used.length ? "Values to change:\n" + used.map(u => "- " + u).join("\n") + "\n\nThe starting values are set on the sheet (Ctrl+Z takes them back). Press **▶ Tune** in the Tune tab." : "No usable values in the answer.") + (bad.length ? `\n\nLeft out (not in the circuit): ${bad.join(", ")}` : "") });
        cad.toggleBom(true, "tune"); render();
      } catch (e) { ai.fail(e); }
    }

    function init(aiApi) {
      ai = aiApi || null;
      const host = $("tune-pane");
      if (host) { host.addEventListener("change", onInput); host.addEventListener("click", onClick); }
      const btn = $("btn-tune-run"); if (btn) btn.addEventListener("click", () => (T.job ? stop() : run()));
      const bud = $("tune-budget"); if (bud) bud.addEventListener("change", () => { const v = Math.round(+bud.value); if (v >= 10 && v <= 2000) T.budget = v; bud.value = T.budget; });
      const as = $("btn-tune-ai"); if (as) as.addEventListener("click", aiStart);
      render();
    }
    return { init, render, run, stop, apply, changed, suggest, addVar, quantities, knobs, aiStart, state: T };
  }
  CadTune.Optimizer = Optimizer; CadTune.nearest = nearest; CadTune.cost = cost; CadTune.met = met;
  root.CadTune = CadTune;
})(typeof window !== "undefined" ? window : globalThis);
