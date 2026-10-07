/* =============================================================================
   TUBE AMP CAD — schematic editor + live simulation
   Depends on: tube-db.js, sim-engine.js, cad-components.js
   ============================================================================= */
(function () {
  "use strict";
  const { LIB, DRAW, COL, PALETTE, parseEng, fmtEng, tubeByName, tubeKind } = CadLib;
  const GRID = 10;
  const STORAGE_KEY = "tubecad_circuit_v2";
  const CHANNEL = "tube_cad_v2";
  // cache-busting version from this script's own URL (?v=...), passed on to the worker
  const VERSION = (document.currentScript && document.currentScript.src.split("?")[1]) ? "?" + document.currentScript.src.split("?")[1] : "";
  const snap = v => Math.round(v / GRID) * GRID;
  const key = (x, y) => x + "," + y;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const S = {
    comps: [], wires: [],
    sel: { comps: new Set(), wires: new Set() },
    view: { scale: 1, ox: 0, oy: 0 },
    tool: "select",
    placing: null,        // { type, params, rot }
    wiring: null,         // { x, y } last committed point
    drag: null,
    mouse: { sx: 0, sy: 0, wx: 0, wy: 0 },
    spaceDown: false,
    history: [], hIndex: -1,
    topo: null,
    sim: { seq: 0, busy: false, pending: false, result: null, netlist: null, nodeOfPin: null, error: null, at: 0 },
    showVolts: true,
    hover: null,
    clipboard: null,
    idCounter: 1
  };

  let canvas, ctx, dpr = 1, renderQueued = false;
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;

  // ---------------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------------
  function rotPt(x, y, rot) {
    switch (rot & 3) {
      case 1: return [-y, x];
      case 2: return [-x, -y];
      case 3: return [y, -x];
      default: return [x, y];
    }
  }
  function compPins(c) {
    return LIB[c.type].pins(c).map(p => {
      const [x, y] = rotPt(p.x, p.y, c.rot);
      return { id: p.id, name: p.name, x: c.x + x, y: c.y + y };
    });
  }
  function compBBox(c) {
    const b = typeof LIB[c.type].bbox === "function" ? LIB[c.type].bbox(c) : LIB[c.type].bbox;
    const a = rotPt(b[0], b[1], c.rot), d = rotPt(b[2], b[3], c.rot);
    return { x1: c.x + Math.min(a[0], d[0]), y1: c.y + Math.min(a[1], d[1]), x2: c.x + Math.max(a[0], d[0]), y2: c.y + Math.max(a[1], d[1]) };
  }
  const isH = w => w.y1 === w.y2;
  function onSegInterior(w, x, y) {
    if (isH(w)) return y === w.y1 && x > Math.min(w.x1, w.x2) && x < Math.max(w.x1, w.x2);
    return x === w.x1 && y > Math.min(w.y1, w.y2) && y < Math.max(w.y1, w.y2);
  }
  function distToSeg(px, py, w) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - w.x1) * dx + (py - w.y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy));
  }
  const newId = p => p + (S.idCounter++) + "_" + Math.floor(Math.random() * 1e4);

  // ---------------------------------------------------------------------------
  // Topology: nets from coincident points
  // ---------------------------------------------------------------------------
  function computeTopology() {
    const parent = new Map();
    const find = k => { if (!parent.has(k)) parent.set(k, k); let r = k; while (parent.get(r) !== r) r = parent.get(r); let c = k; while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    const degree = new Map(), pinAt = new Map();
    const bump = k => degree.set(k, (degree.get(k) || 0) + 1);
    S.wires.forEach(w => { const a = key(w.x1, w.y1), b = key(w.x2, w.y2); union(a, b); bump(a); bump(b); });
    S.comps.forEach(c => compPins(c).forEach(p => { const k = key(p.x, p.y); find(k); bump(k); if (!pinAt.has(k)) pinAt.set(k, []); pinAt.get(k).push({ c, p }); }));
    let groundRoot = null;
    S.comps.forEach(c => { if (c.type === "ground") { const p = compPins(c)[0]; const r = find(key(p.x, p.y)); if (groundRoot === null) groundRoot = r; else union(r, groundRoot); } });
    if (groundRoot !== null) groundRoot = find(groundRoot);
    const netOfRoot = new Map();
    let next = 1;
    if (groundRoot !== null) netOfRoot.set(groundRoot, 0);
    const netOfKey = k => { const r = find(k); if (!netOfRoot.has(r)) netOfRoot.set(r, next++); return netOfRoot.get(r); };
    const pinNet = new Map();
    S.comps.forEach(c => compPins(c).forEach(p => pinNet.set(c.id + ":" + p.id, netOfKey(key(p.x, p.y)))));
    const wireNet = new Map();
    S.wires.forEach(w => wireNet.set(w.id, netOfKey(key(w.x1, w.y1))));
    // connection count per pin (other things touching it)
    const pinConnected = new Map();
    S.comps.forEach(c => compPins(c).forEach(p => pinConnected.set(c.id + ":" + p.id, (degree.get(key(p.x, p.y)) || 0) > 1)));
    const junctions = [];
    degree.forEach((d, k) => { if (d >= 3) { const [x, y] = k.split(",").map(Number); junctions.push({ x, y }); } });
    return { pinNet, wireNet, nodeCount: next, hasGround: groundRoot !== null, pinConnected, junctions, degree, pinAt };
  }
  function topo() { if (!S.topo) S.topo = computeTopology(); return S.topo; }

  // ---------------------------------------------------------------------------
  // Wire normalisation: split at T-junctions / pins, merge straight runs
  // ---------------------------------------------------------------------------
  function normalizeWires() {
    let wires = S.wires.filter(w => w.x1 !== w.x2 || w.y1 !== w.y2);
    // de-duplicate
    const seen = new Set();
    wires = wires.filter(w => { const a = key(w.x1, w.y1), b = key(w.x2, w.y2); const k = a < b ? a + "|" + b : b + "|" + a; if (seen.has(k)) return false; seen.add(k); return true; });
    // split wires where an endpoint or a pin lies on their interior
    const points = [];
    wires.forEach(w => { points.push([w.x1, w.y1], [w.x2, w.y2]); });
    S.comps.forEach(c => compPins(c).forEach(p => points.push([p.x, p.y])));
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < wires.length && !changed; i++) {
        const w = wires[i];
        for (const [x, y] of points) {
          if (onSegInterior(w, x, y)) {
            wires.splice(i, 1, { id: w.id, x1: w.x1, y1: w.y1, x2: x, y2: y }, { id: newId("w"), x1: x, y1: y, x2: w.x2, y2: w.y2 });
            if (S.sel.wires.has(w.id)) S.sel.wires.add(wires[i + 1].id);
            changed = true;
            break;
          }
        }
      }
    }
    // merge collinear pairs meeting at a point with exactly two wire ends and no pin
    const pinKeys = new Set();
    S.comps.forEach(c => compPins(c).forEach(p => pinKeys.add(key(p.x, p.y))));
    changed = true;
    while (changed) {
      changed = false;
      const ends = new Map();
      wires.forEach((w, i) => { [[w.x1, w.y1], [w.x2, w.y2]].forEach(([x, y]) => { const k = key(x, y); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); }); });
      for (const [k, list] of ends) {
        if (list.length !== 2 || pinKeys.has(k)) continue;
        const a = wires[list[0]], b = wires[list[1]];
        if (a === b || isH(a) !== isH(b)) continue;
        const [x, y] = k.split(",").map(Number);
        const fa = (a.x1 === x && a.y1 === y) ? [a.x2, a.y2] : [a.x1, a.y1];
        const fb = (b.x1 === x && b.y1 === y) ? [b.x2, b.y2] : [b.x1, b.y1];
        const merged = { id: a.id, x1: fa[0], y1: fa[1], x2: fb[0], y2: fb[1] };
        if (S.sel.wires.has(b.id)) S.sel.wires.add(a.id);
        wires = wires.filter(w => w !== a && w !== b);
        wires.push(merged);
        changed = true;
        break;
      }
    }
    S.wires = wires;
    S.sel.wires.forEach(id => { if (!wires.some(w => w.id === id)) S.sel.wires.delete(id); });
  }

  // ---------------------------------------------------------------------------
  // History / persistence
  // ---------------------------------------------------------------------------
  function snapshot() { return JSON.stringify({ comps: S.comps, wires: S.wires }); }
  function restore(json) {
    const d = JSON.parse(json);
    S.comps = d.comps || []; S.wires = d.wires || [];
    S.sel.comps.clear(); S.sel.wires.clear();
    circuitChanged(false);
  }
  function commit() {
    normalizeWires();
    S.history = S.history.slice(0, S.hIndex + 1);
    S.history.push(snapshot());
    if (S.history.length > 150) S.history.shift();
    S.hIndex = S.history.length - 1;
    circuitChanged(true);
  }
  function undo() { if (S.hIndex > 0) { S.hIndex--; restore(S.history[S.hIndex]); } }
  function redo() { if (S.hIndex < S.history.length - 1) { S.hIndex++; restore(S.history[S.hIndex]); } }
  function circuitChanged() {
    S.topo = null;
    if (S.trans && !S.trans.stale && !S.trans.running) { S.trans.stale = true; if (channel) channel.postMessage(transientMessage()); }
    try { localStorage.setItem(STORAGE_KEY, snapshot()); } catch (e) {}
    scheduleSim();
    updateInspector();
    render();
  }

  // ---------------------------------------------------------------------------
  // Components
  // ---------------------------------------------------------------------------
  function nextLabel(prefix) {
    let n = 0;
    S.comps.forEach(c => { const m = c.label && c.label.match(new RegExp("^" + prefix + "(\\d+)$")); if (m) n = Math.max(n, +m[1]); });
    return prefix + (n + 1);
  }
  function makeComp(type, params, x, y, rot) {
    const def = LIB[type];
    const c = { id: newId("c"), type, x: snap(x), y: snap(y), rot: def.noRotate ? 0 : (rot || 0), params: Object.assign({}, def.defaults, params || {}) };
    if (type === "tube") {
      const t = tubeByName(c.params.tube);
      c.params.connection = tubeKind(t) === "pentode" ? "pentode" : "triode";
    }
    c.label = def.noLabel ? "" : nextLabel(def.prefixFor ? def.prefixFor(c) : def.prefix);
    return c;
  }

  // ---------------------------------------------------------------------------
  // Netlist + simulation
  // ---------------------------------------------------------------------------
  let worker = null, simTimer = null;
  function startWorker() { try { worker = new Worker("sim-worker.js" + VERSION); worker.onmessage = e => onSimResult(e.data); } catch (e) { worker = null; } }
  startWorker();
  // "live" runs after every edit within a short time budget; "full" runs until
  // the periodic steady state is reached (slow supplies need seconds of solver time)
  const RUN_OPTIONS = { live: { budgetMs: 2500 }, full: { budgetMs: 120000, maxPeriods: 20000 } };
  const LIVE_KEY = "tubecad_live";
  S.sim.live = (() => { try { return localStorage.getItem(LIVE_KEY) !== "0"; } catch (e) { return true; } })();

  function buildNetlist() {
    const T = topo();
    let nodeCount = T.nodeCount;
    const alloc = () => nodeCount++;
    const elements = [];
    S.comps.forEach(c => {
      const net = pid => T.pinNet.get(c.id + ":" + pid);
      LIB[c.type].build(c, net, alloc, elements);
    });
    return { nodeCount, elements };
  }

  function scheduleSim(delay) {
    clearTimeout(simTimer);
    if (!S.sim.live) {
      // manual mode: the old result no longer matches the circuit
      if (S.sim.busy) cancelRun();
      S.sim.result = null; S.sim.error = null; S.sim.warnings = [];
      setStatus("idle", hasCircuit() ? "Circuit changed · press Simulate (Ctrl+Enter)" : "Empty sheet");
      broadcast();
      return;
    }
    simTimer = setTimeout(() => runSim("live"), delay === undefined ? 150 : delay);
  }
  function cancelRun() {
    if (worker) { worker.terminate(); startWorker(); }
    S.sim.busy = false; S.sim.pending = false; S.sim.seq++;
    simButton();
  }
  function simButton() {
    const b = document.getElementById("btn-sim");
    if (b) { const stop = S.sim.busy && S.sim.mode === "full"; b.textContent = stop ? "■ Stop" : "▶ Simulate"; b.classList.toggle("active", stop); }
  }
  function setLive(on) {
    S.sim.live = on;
    try { localStorage.setItem(LIVE_KEY, on ? "1" : "0"); } catch (e) {}
    const b = document.getElementById("btn-live"); if (b) b.classList.toggle("active", on);
    if (on) scheduleSim(0);
    else if (!S.sim.busy) setStatus("idle", "Live off · edits wait for ▶ Simulate (Ctrl+Enter)");
  }
  function runSim(mode) {
    mode = mode === "full" ? "full" : "live";
    const T = topo();
    if (!hasCircuit()) { S.sim.result = null; S.sim.error = null; setStatus("idle", "Empty sheet"); broadcast(); render(); return; }
    if (!T.hasGround) { S.sim.result = null; S.sim.error = "Add a ground symbol to simulate"; setStatus("warn", S.sim.error); broadcast(); render(); updateInspector(); return; }
    if (S.sim.busy) {
      // a full run is long: a new request replaces it; quick runs queue
      if (S.sim.mode === "full" || mode === "full") cancelRun();
      else { S.sim.pending = true; return; }
    }
    const netlist = buildNetlist();
    S.sim.busy = true; S.sim.mode = mode; S.sim.netlist = netlist; S.sim.topoForRun = T;
    const seq = ++S.sim.seq;
    setStatus("busy", mode === "full" ? "Simulating until settled…" : "Simulating…");
    simButton();
    if (worker) worker.postMessage({ seq, netlist, options: RUN_OPTIONS[mode] });
    else setTimeout(() => onSimResult({ seq, result: TubeSimEngine.simulate(netlist, RUN_OPTIONS[mode]) }), 0);
  }
  function onSimResult({ seq, result }) {
    if (seq !== S.sim.seq) return;   // a cancelled run
    S.sim.busy = false;
    simButton();
    {
      S.sim.result = result.ok ? result : null;
      S.sim.error = result.ok ? null : result.error;
      S.sim.warnings = result.warnings || [];
      S.sim.topo = S.sim.topoForRun;
      if (result.ok) {
        const tr = result.tran;
        const what = tr && tr.fBase ? `${fmtEng(tr.samples * tr.dt, "s")} window, ${tr.periods} cycles to settle` : "DC operating point";
        const took = result.elapsedMs >= 1000 ? (result.elapsedMs / 1000).toFixed(1) + " s" : result.elapsedMs + " ms";
        // a quick live run that ran out of time continues as a full run in the background
        const more = tr && !tr.settled && S.sim.mode === "live" && S.sim.live && !S.sim.pending;
        if (more) S.sim.warnings = S.sim.warnings.filter(w => !/^Not fully settled/.test(w));
        setStatus(S.sim.warnings.length ? "warn" : "ok", `Simulated in ${took} · ${what}` + (result.dcAveraged ? " · DC values averaged over the window" : "") + (S.sim.warnings.length ? " · " + S.sim.warnings[0] : ""));
        if (more) { broadcast(); updateInspector(true); render(); runSim("full"); setStatus("busy", "Preliminary result shown · settling fully…"); return; }
      } else setStatus("error", result.error);
      broadcast();
      updateInspector(true);
      render();
    }
    if (S.sim.pending) { S.sim.pending = false; runSim(); }
  }

  // Node voltage helpers on the last result
  function netDC(net) { const r = S.sim.result; return r && net !== undefined && r.dc.nodes[net] !== undefined ? r.dc.nodes[net] : null; }
  function netWave(net) { const r = S.sim.result; return r && r.tran && net !== undefined && net > 0 ? r.tran.nodes[net] : null; }
  function pinNetOf(c, pid) { const T = S.sim.topo || topo(); return T.pinNet.get(c.id + ":" + pid); }
  function waveOf(c, pid) {
    const n = pinNetOf(c, pid), r = S.sim.result;
    if (!r || !r.tran) return null;
    if (n === 0) return new Float32Array(r.tran.samples);
    return r.tran.nodes[n] || null;
  }
  function stats(a) {
    if (!a || !a.length) return null;
    let mn = Infinity, mx = -Infinity, s = 0;
    for (const v of a) { mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; }
    const mean = s / a.length;
    let q = 0; for (const v of a) q += (v - mean) * (v - mean);
    return { min: mn, max: mx, pp: mx - mn, mean, rmsAC: Math.sqrt(q / a.length) };
  }
  // Harmonic amplitudes by DFT over the (whole-period) capture
  function harmonics(a, f0, dt, count) {
    const N = a.length - 1, out = [];
    for (let k = 1; k <= count; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) { const ph = 2 * Math.PI * k * f0 * i * dt; re += a[i] * Math.cos(ph); im += a[i] * Math.sin(ph); }
      out.push(2 * Math.hypot(re, im) / N);
    }
    return out;
  }
  function signalFreq() {
    const g = S.comps.find(c => c.type === "siggen");
    return g ? g.params.freq : (S.sim.result && S.sim.result.tran ? S.sim.result.tran.fBase : 0);
  }

  // Tube operating data (DC + trajectory) for inspector and the curve tracer
  function tubeData(c) {
    const r = S.sim.result;
    if (!r) return null;
    const t = tubeByName(c.params.tube), kind = tubeKind(t);
    const dev = r.dc.devices[c.id];
    if (!dev) return null;
    if (kind === "rectifier") return { kind, a1: dev.a1, a2: dev.a2 };
    const conn = c.params.connection === "pentode" && t.koren.Pentode ? "pentode" : "triode";
    const d = { kind: conn, tube: t.commonName, label: c.label, id: c.id, dc: dev.main, paMax: t.paMax, vaMax: t.vaMax, model: conn === "pentode" ? t.koren.Pentode : t.koren.Triode };
    if (r.tran) {
      const A = waveOf(c, "A"), K = waveOf(c, "K"), G = waveOf(c, conn === "pentode" ? "G1" : "G"), G2 = conn === "pentode" ? waveOf(c, "G2") : null;
      const I = r.tran.devices[c.id] ? r.tran.devices[c.id].i : null;
      if (A && K && G && I) {
        const n = A.length, vak = new Float32Array(n), vgk = new Float32Array(n), vg2k = G2 ? new Float32Array(n) : null;
        let pSum = 0;
        for (let i = 0; i < n; i++) { vak[i] = A[i] - K[i]; vgk[i] = G[i] - K[i]; if (vg2k) vg2k[i] = G2[i] - K[i]; pSum += vak[i] * I[i]; }
        const sa = stats(vak), sg = stats(vgk);
        const f = signalFreq();
        let thd = null;
        if (f && sa.pp > 1e-3) { const h = harmonics(vak, f, r.tran.dt, 8); thd = 100 * Math.sqrt(h.slice(1).reduce((s, v) => s + v * v, 0)) / Math.max(h[0], 1e-12); }
        d.traj = { vak, vgk, vg2k, ia: I, dt: r.tran.dt };
        d.metrics = { vakPP: sa.pp, vgkPP: sg.pp, gain: sg.pp > 1e-6 ? sa.pp / sg.pp : null, pAvg: pSum / n, thd };
      }
    }
    return d;
  }

  // ---------------------------------------------------------------------------
  // Cross-window broadcast (curve tracer, oscilloscope, spectrum analyzer)
  // ---------------------------------------------------------------------------
  function decimate(a, maxN) {
    if (!a) return null;
    if (a.length <= maxN) return Array.from(a);
    const out = [], step = (a.length - 1) / (maxN - 1);
    for (let i = 0; i < maxN; i++) out.push(a[Math.round(i * step)]);
    return out;
  }
  function scopeChannels(c) {
    const r = S.sim.result;
    if (!r || !r.tran) return null;
    const com = waveOf(c, "COM");
    const T = S.sim.topo || topo();
    const ch = pid => {
      const connected = T.pinConnected.get(c.id + ":" + pid);
      const w = waveOf(c, pid);
      if (!connected || !w || !com) return null;
      const out = new Float32Array(w.length);
      for (let i = 0; i < w.length; i++) out[i] = w[i] - com[i];
      return out;
    };
    return { ch1: ch("CH1"), ch2: ch("CH2"), dt: r.tran.dt };
  }
  function buildSummary() {
    const r = S.sim.result;
    const summary = { type: "SIM_RESULT", version: VERSION, at: Date.now(), selectedTubeId: lastTubeId, ok: !!r, error: S.sim.error, warnings: S.sim.warnings || [], empty: !S.comps.length, fSig: signalFreq(), tubes: [], scopes: [], speakers: [] };
    if (!r) return summary;
    summary.elapsedMs = r.elapsedMs;
    S.comps.forEach(c => {
      if (c.type === "tube") {
        const d = tubeData(c);
        if (d && d.kind !== "rectifier") {
          summary.tubes.push({ id: c.id, label: c.label, tube: d.tube, kind: d.kind, model: d.model, paMax: d.paMax, vaMax: d.vaMax, dc: d.dc, metrics: d.metrics || null,
            traj: d.traj ? { vak: decimate(d.traj.vak, 600), vgk: decimate(d.traj.vgk, 600), vg2k: decimate(d.traj.vg2k, 600), ia: decimate(d.traj.ia, 600) } : null });
        }
      } else if (c.type === "scope") {
        const ch = scopeChannels(c);
        if (ch) summary.scopes.push({ id: c.id, label: c.label, dt: ch.dt, ch1: ch.ch1 ? Array.from(ch.ch1) : null, ch2: ch.ch2 ? Array.from(ch.ch2) : null });
      } else if (c.type === "speaker") {
        const a = waveOf(c, "+"), b = waveOf(c, "-");
        if (a && b) { let p = 0; for (let i = 0; i < a.length; i++) { const v = a[i] - b[i]; p += v * v; } p /= a.length * c.params.r; summary.speakers.push({ label: c.label, pAvg: p, r: c.params.r }); }
      }
    });
    return summary;
  }
  let lastSummary = null;
  function broadcast() {
    lastSummary = buildSummary();
    if (channel) { try { channel.postMessage(lastSummary); } catch (e) {} }
  }
  if (channel) channel.onmessage = e => {
    const m = e.data || {};
    if (m.type === "REQUEST_STATE") {
      if (!lastSummary) lastSummary = buildSummary(); lastSummary.selectedTubeId = lastTubeId; channel.postMessage(lastSummary);
      if (S.trans) channel.postMessage(transientMessage());
    }
    // requests from instrument windows are acknowledged at once, so a window can
    // tell a CAD that does not understand them (an older version still open)
    else if (/^(RUN_SIM|RUN_TRANSIENT|STOP_TRANSIENT)$/.test(m.type)) channel.postMessage({ type: "ACK", req: m.type, id: m.id, version: VERSION });
    if (m.type === "RUN_SIM") runSim("full");                            // ▶ Simulate in an instrument window
    else if (m.type === "RUN_TRANSIENT") runTransient(m.tStop);
    else if (m.type === "STOP_TRANSIENT") stopTransient();
  };

  // ---------------------------------------------------------------------------
  // Power-on transient for the oscilloscopes (own worker, so live runs go on)
  // ---------------------------------------------------------------------------
  let tWorker = null;
  S.trans = null;           // { seq, running, progress, tStop, ok, error, dt, scopes: [{ id, label, ch1: {min,max}, ch2 }] }
  function transientMessage() {
    const t = S.trans;
    return { type: "TRANSIENT_RESULT", version: VERSION, seq: t.seq, running: !!t.running, progress: t.progress || 0, tStop: t.tStop, ok: !!t.ok, error: t.error || null, stale: !!t.stale,
      dt: t.dt, elapsedMs: t.elapsedMs, scopes: t.scopes || [] };
  }
  function stopTransient() {
    if (tWorker) { tWorker.terminate(); tWorker = null; }
    if (S.trans && S.trans.running) { S.trans.running = false; S.trans.error = "Stopped"; if (channel) channel.postMessage(transientMessage()); setStatus("idle", "Power-on transient stopped"); }
  }
  function runTransient(tStop) {
    tStop = Math.min(5, Math.max(0.01, +tStop || 1));
    const T = topo();
    if (!T.hasGround) { S.trans = { running: false, ok: false, error: "Add a ground symbol to simulate", tStop }; if (channel) channel.postMessage(transientMessage()); return; }
    stopTransient();
    const netlist = buildNetlist(), probes = [], map = [];
    S.comps.filter(c => c.type === "scope").forEach(c => {
      const com = T.pinNet.get(c.id + ":COM");
      ["CH1", "CH2"].forEach(pid => {
        if (!T.pinConnected.get(c.id + ":" + pid)) return;
        map.push({ id: c.id, label: c.label, ch: pid.toLowerCase(), k: probes.length });
        probes.push([T.pinNet.get(c.id + ":" + pid), com]);
      });
    });
    const seq = (S.trans && S.trans.seq || 0) + 1;
    S.trans = { seq, running: true, progress: 0, tStop };
    if (channel) channel.postMessage(transientMessage());
    setStatus("busy", `Power-on transient, first ${fmtEng(tStop, "s")}…`);
    try { tWorker = new Worker("sim-worker.js" + VERSION); } catch (e) { tWorker = null; }
    const done = result => {
      if (!S.trans || S.trans.seq !== seq) return;
      tWorker = null;
      const scopes = [];
      if (result.ok) map.forEach(p => {
        let sc = scopes.find(x => x.id === p.id); if (!sc) scopes.push(sc = { id: p.id, label: p.label });
        sc[p.ch] = { min: result.min[p.k], max: result.max[p.k] };
      });
      Object.assign(S.trans, { running: false, ok: !!result.ok, error: result.ok ? null : result.error, dt: result.dt, elapsedMs: result.elapsedMs, scopes, progress: 1 });
      if (channel) channel.postMessage(transientMessage());
      if (result.ok) setStatus("ok", `Power-on transient: ${fmtEng(tStop, "s")} of circuit time in ${(result.elapsedMs / 1000).toFixed(1)} s · ${result.steps} steps`);
      else setStatus("error", "Power-on transient: " + result.error);
    };
    const options = { tStop, probes, maxPoints: 250000, budgetMs: 600000 };   // every step, for zooming in the scope
    if (!tWorker) { setTimeout(() => done(TubeSimEngine.startup(netlist, options)), 0); return; }
    tWorker.onmessage = e => {
      const d = e.data;
      if (d.progress !== undefined && !d.result) {
        if (!S.trans || S.trans.seq !== seq) return;
        S.trans.progress = d.progress;
        if (channel) channel.postMessage(transientMessage());
        setStatus("busy", `Power-on transient, first ${fmtEng(tStop, "s")}: ${Math.round(d.progress * 100)} %`);
      } else done(d.result);
    };
    tWorker.postMessage({ seq, netlist, options, kind: "startup" });
  }

  // ---------------------------------------------------------------------------
  // View transforms
  // ---------------------------------------------------------------------------
  const toWorld = (sx, sy) => ({ x: (sx - S.view.ox) / S.view.scale, y: (sy - S.view.oy) / S.view.scale });
  function zoomAt(sx, sy, factor) {
    const s = Math.min(5, Math.max(0.2, S.view.scale * factor));
    const w = toWorld(sx, sy);
    S.view.scale = s; S.view.ox = sx - w.x * s; S.view.oy = sy - w.y * s;
    updateZoomLabel(); render();
  }
  function fitView() {
    if (!S.comps.length && !S.wires.length) { S.view = { scale: 1, ox: canvas.clientWidth / 2 - 300, oy: canvas.clientHeight / 2 - 200 }; updateZoomLabel(); render(); return; }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    S.comps.forEach(c => { const b = compBBox(c); x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); });
    S.wires.forEach(w => { x1 = Math.min(x1, w.x1, w.x2); y1 = Math.min(y1, w.y1, w.y2); x2 = Math.max(x2, w.x1, w.x2); y2 = Math.max(y2, w.y1, w.y2); });
    const W = canvas.clientWidth, H = canvas.clientHeight, m = 60;
    const s = Math.min(3, Math.max(0.2, Math.min((W - 2 * m) / Math.max(x2 - x1, 1), (H - 2 * m) / Math.max(y2 - y1, 1))));
    S.view.scale = s; S.view.ox = W / 2 - (x1 + x2) / 2 * s; S.view.oy = H / 2 - (y1 + y2) / 2 * s;
    updateZoomLabel(); render();
  }

  // ---------------------------------------------------------------------------
  // Hit testing (world coordinates)
  // ---------------------------------------------------------------------------
  function hitPin(x, y) {
    const r = Math.max(5, 7 / S.view.scale);
    for (let i = S.comps.length - 1; i >= 0; i--) {
      const c = S.comps[i];
      for (const p of compPins(c)) if (Math.hypot(p.x - x, p.y - y) <= r) return { c, p };
    }
    return null;
  }
  function hitComp(x, y) {
    for (let i = S.comps.length - 1; i >= 0; i--) {
      const c = S.comps[i], def = LIB[c.type];
      if (def.hit) { if (def.hit(c, x, y)) return c; continue; }
      const b = compBBox(c);
      if (x >= b.x1 - 2 && x <= b.x2 + 2 && y >= b.y1 - 2 && y <= b.y2 + 2) return c;
    }
    return null;
  }
  function hitWire(x, y) {
    const tol = Math.max(3, 6 / S.view.scale);
    let best = null, bd = Infinity;
    S.wires.forEach(w => { const d = distToSeg(x, y, w); if (d <= tol && d < bd) { bd = d; best = w; } });
    return best;
  }

  // ---------------------------------------------------------------------------
  // Editing operations
  // ---------------------------------------------------------------------------
  function addSegment(x1, y1, x2, y2) {
    if (x1 === x2 && y1 === y2) return;
    S.wires.push({ id: newId("w"), x1, y1, x2, y2 });
  }
  // L-shaped route from a to b; horizontal first when |dx| >= |dy|
  function lRoute(ax, ay, bx, by, hFirst) {
    if (ax === bx || ay === by) return [[ax, ay, bx, by]];
    return hFirst ? [[ax, ay, bx, ay], [bx, ay, bx, by]] : [[ax, ay, ax, by], [ax, by, bx, by]];
  }
  function isConnectionPoint(x, y) {
    if (S.wires.some(w => (w.x1 === x && w.y1 === y) || (w.x2 === x && w.y2 === y) || onSegInterior(w, x, y))) return true;
    return S.comps.some(c => compPins(c).some(p => p.x === x && p.y === y));
  }
  function deleteSelection() {
    if (!S.sel.comps.size && !S.sel.wires.size) return;
    S.comps = S.comps.filter(c => !S.sel.comps.has(c.id));
    S.wires = S.wires.filter(w => !S.sel.wires.has(w.id));
    S.sel.comps.clear(); S.sel.wires.clear();
    commit();
  }
  function rotateSelection() {
    if (S.placing) { if (!LIB[S.placing.type].noRotate) S.placing.rot = (S.placing.rot + 1) & 3; render(); return; }
    let any = false;
    S.comps.forEach(c => { if (S.sel.comps.has(c.id) && !LIB[c.type].noRotate) { c.rot = (c.rot + 1) & 3; any = true; } });
    if (any) commit();
  }
  function copySelection() {
    const comps = S.comps.filter(c => S.sel.comps.has(c.id));
    const wires = S.wires.filter(w => S.sel.wires.has(w.id));
    if (!comps.length && !wires.length) return false;
    S.clipboard = JSON.stringify({ comps, wires });
    return true;
  }
  function paste(dx, dy) {
    if (!S.clipboard) return;
    const d = JSON.parse(S.clipboard);
    S.sel.comps.clear(); S.sel.wires.clear();
    d.comps.forEach(c => {
      const n = makeComp(c.type, c.params, c.x + dx, c.y + dy, c.rot);
      S.comps.push(n); S.sel.comps.add(n.id);
    });
    d.wires.forEach(w => { const id = newId("w"); S.wires.push({ id, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy }); S.sel.wires.add(id); });
    commit();
  }

  // Component drag with rubber-banding of attached wires
  function startCompDrag(wx, wy) {
    const moving = new Set(S.sel.comps);
    const pinKeys = new Set();
    S.comps.forEach(c => { if (moving.has(c.id)) compPins(c).forEach(p => pinKeys.add(key(p.x, p.y))); });
    S.drag = {
      kind: "comps", x0: snap(wx), y0: snap(wy), moved: false,
      comps0: S.comps.filter(c => moving.has(c.id)).map(c => ({ id: c.id, x: c.x, y: c.y })),
      wires0: S.wires.map(w => Object.assign({}, w)),
      pinKeys
    };
  }
  function updateCompDrag(wx, wy) {
    const d = S.drag, dx = snap(wx) - d.x0, dy = snap(wy) - d.y0;
    if (!dx && !dy && !d.moved) return;
    d.moved = true;
    d.comps0.forEach(o => { const c = S.comps.find(k => k.id === o.id); if (c) { c.x = o.x + dx; c.y = o.y + dy; } });
    const out = [];
    d.wires0.forEach(w => {
      const selW = S.sel.wires.has(w.id);
      const a = selW || d.pinKeys.has(key(w.x1, w.y1)), b = selW || d.pinKeys.has(key(w.x2, w.y2));
      if (a && b) { out.push({ id: w.id, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy }); return; }
      if (!a && !b) { out.push(w); return; }
      const F = a ? [w.x2, w.y2] : [w.x1, w.y1];
      const E = a ? [w.x1 + dx, w.y1 + dy] : [w.x2 + dx, w.y2 + dy];
      if (F[0] === E[0] || F[1] === E[1]) { out.push({ id: w.id, x1: F[0], y1: F[1], x2: E[0], y2: E[1] }); return; }
      const corner = isH(w) ? [E[0], F[1]] : [F[0], E[1]];
      out.push({ id: w.id, x1: F[0], y1: F[1], x2: corner[0], y2: corner[1] });
      out.push({ id: w.id + "_j", x1: corner[0], y1: corner[1], x2: E[0], y2: E[1] });
    });
    S.wires = out;
    S.topo = null;
    render();
  }

  // Wire segment drag: move perpendicular, stretch neighbours, add jogs at pins
  function startWireDrag(w, wx, wy) {
    S.drag = { kind: "wire", id: w.id, w0: Object.assign({}, w), horiz: isH(w), x0: snap(wx), y0: snap(wy), moved: false, wires0: S.wires.map(x => Object.assign({}, x)) };
  }
  function updateWireDrag(wx, wy) {
    const d = S.drag, w = d.w0;
    const delta = d.horiz ? snap(wy) - d.y0 : snap(wx) - d.x0;
    if (!delta && !d.moved) return;
    d.moved = true;
    const dx = d.horiz ? 0 : delta, dy = d.horiz ? delta : 0;
    const pinKeys = new Set();
    S.comps.forEach(c => compPins(c).forEach(p => pinKeys.add(key(p.x, p.y))));
    const out = [], connectors = [];
    const ends = [[w.x1, w.y1], [w.x2, w.y2]];
    const handled = ends.map(() => false);
    d.wires0.forEach(o => {
      if (o.id === w.id) return;
      let n = Object.assign({}, o);
      ends.forEach(([ex, ey], i) => {
        const at1 = o.x1 === ex && o.y1 === ey, at2 = o.x2 === ex && o.y2 === ey;
        if (!at1 && !at2) return;
        const perpendicular = isH(o) !== d.horiz;
        if (perpendicular) {
          if (at1) { n.x1 += dx; n.y1 += dy; } else { n.x2 += dx; n.y2 += dy; }
        } else handled[i] = "connector";
        if (handled[i] !== "connector") handled[i] = true;
      });
      out.push(n);
    });
    ends.forEach(([ex, ey], i) => {
      if (handled[i] === "connector" || pinKeys.has(key(ex, ey))) connectors.push({ id: d.id + "_c" + i, x1: ex, y1: ey, x2: ex + dx, y2: ey + dy });
    });
    out.push({ id: w.id, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy });
    S.wires = out.concat(connectors).filter(x => x.x1 !== x.x2 || x.y1 !== x.y2);
    S.topo = null;
    render();
  }

  // ---------------------------------------------------------------------------
  // Mouse / keyboard
  // ---------------------------------------------------------------------------
  function evPos(e) {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const w = toWorld(sx, sy);
    S.mouse = { sx, sy, wx: w.x, wy: w.y };
    return S.mouse;
  }

  function finishWiring() { S.wiring = null; render(); }

  function onMouseDown(e) {
    canvas.focus();
    const m = evPos(e);
    if (e.button === 1 || (e.button === 0 && S.spaceDown)) { S.drag = { kind: "pan", sx: m.sx, sy: m.sy, ox: S.view.ox, oy: S.view.oy }; e.preventDefault(); return; }
    if (e.button === 2) { if (S.wiring) finishWiring(); else if (S.placing) { S.placing = null; setTool("select"); } return; }
    if (e.button !== 0) return;
    const gx = snap(m.wx), gy = snap(m.wy);

    if (S.placing) {
      const c = makeComp(S.placing.type, S.placing.params, gx, gy, S.placing.rot);
      S.comps.push(c);
      S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(c.id);
      commit();
      if (!e.shiftKey) { S.placing = null; setTool("select"); }
      return;
    }

    if (S.wiring) {
      const pin = hitPin(m.wx, m.wy);
      const tx = pin ? pin.p.x : gx, ty = pin ? pin.p.y : gy;
      if (tx === S.wiring.x && ty === S.wiring.y) { finishWiring(); return; }
      const hFirst = S.wiring.hFirst;
      const endsOnSomething = isConnectionPoint(tx, ty);
      lRoute(S.wiring.x, S.wiring.y, tx, ty, hFirst).forEach(s => addSegment(s[0], s[1], s[2], s[3]));
      commit();
      if (endsOnSomething || e.detail >= 2) finishWiring();
      else S.wiring = { x: tx, y: ty, hFirst: null };
      return;
    }

    const pin = hitPin(m.wx, m.wy);
    if (pin && S.tool === "select") { S.wiring = { x: pin.p.x, y: pin.p.y, hFirst: null }; S.sel.comps.clear(); S.sel.wires.clear(); updateInspector(); render(); return; }

    if (S.tool === "wire") {
      S.wiring = { x: pin ? pin.p.x : gx, y: pin ? pin.p.y : gy, hFirst: null };
      render(); return;
    }

    const c = hitComp(m.wx, m.wy);
    if (c) {
      if (e.shiftKey) { S.sel.comps.has(c.id) ? S.sel.comps.delete(c.id) : S.sel.comps.add(c.id); }
      else if (!S.sel.comps.has(c.id)) { S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(c.id); }
      startCompDrag(m.wx, m.wy);
      updateInspector(); render(); return;
    }
    const w = hitWire(m.wx, m.wy);
    if (w) {
      if (e.shiftKey) { S.sel.wires.has(w.id) ? S.sel.wires.delete(w.id) : S.sel.wires.add(w.id); }
      else { S.sel.comps.clear(); S.sel.wires.clear(); S.sel.wires.add(w.id); }
      startWireDrag(w, m.wx, m.wy);
      updateInspector(); render(); return;
    }
    if (!e.shiftKey) { S.sel.comps.clear(); S.sel.wires.clear(); }
    S.drag = { kind: "box", x0: m.wx, y0: m.wy, x1: m.wx, y1: m.wy };
    updateInspector(); render();
  }

  function onMouseMove(e) {
    const m = evPos(e);
    const d = S.drag;
    if (d && d.kind === "pan") { S.view.ox = d.ox + (m.sx - d.sx); S.view.oy = d.oy + (m.sy - d.sy); render(); return; }
    if (d && d.kind === "comps") { updateCompDrag(m.wx, m.wy); return; }
    if (d && d.kind === "wire") { updateWireDrag(m.wx, m.wy); return; }
    if (d && d.kind === "box") { d.x1 = m.wx; d.y1 = m.wy; render(); return; }
    if (S.wiring && S.wiring.hFirst === null) {
      const dx = Math.abs(snap(m.wx) - S.wiring.x), dy = Math.abs(snap(m.wy) - S.wiring.y);
      if (dx + dy >= GRID) S.wiring.hFirst = dx >= dy;
    }
    updateHover(m);
    render();
  }

  function onMouseUp() {
    const d = S.drag;
    S.drag = null;
    if (!d) return;
    if ((d.kind === "comps" || d.kind === "wire") && d.moved) commit();
    if (d.kind === "box") {
      const x1 = Math.min(d.x0, d.x1), x2 = Math.max(d.x0, d.x1), y1 = Math.min(d.y0, d.y1), y2 = Math.max(d.y0, d.y1);
      if (x2 - x1 > 2 || y2 - y1 > 2) {
        S.comps.forEach(c => { const b = compBBox(c); if (b.x1 >= x1 && b.x2 <= x2 && b.y1 >= y1 && b.y2 <= y2) S.sel.comps.add(c.id); });
        S.wires.forEach(w => { if (Math.min(w.x1, w.x2) >= x1 && Math.max(w.x1, w.x2) <= x2 && Math.min(w.y1, w.y2) >= y1 && Math.max(w.y1, w.y2) <= y2) S.sel.wires.add(w.id); });
      }
      updateInspector();
    }
    render();
  }

  function onDblClick(e) {
    const m = evPos(e);
    const c = hitComp(m.wx, m.wy);
    if (c && c.type === "scope" && !S.wiring) ToolWindows.open("oscilloscope.html", { scope: c.id });
    if (c && c.type === "switch" && !S.wiring) { setSwitch(c, c.params.pos === "B" ? "A" : "B"); updateInspector(); }
  }
  // Renumber reference designations (IEC 81346-2 class code + number) in
  // reading order of the diagram: left to right, then top to bottom. Parts
  // whose labels share a base before a dot (a dual triode -K1.1/-K1.2, the
  // sections -S1.1/-S1.2 of one switch) stay one object with their sections.
  function renumber() {
    const groups = new Map();
    S.comps.forEach(c => {
      const def = LIB[c.type]; if (def.noLabel) return;
      const cls = def.prefixFor ? def.prefixFor(c) : def.prefix, l = c.label || "", i = l.lastIndexOf(".");
      const base = i > 0 ? l.slice(0, i) : null, key = base ? cls + "|" + base : c.id;
      if (!groups.has(key)) groups.set(key, { cls, members: [] });
      groups.get(key).members.push(c);
    });
    const pos = c => [Math.round(c.x / 10), Math.round(c.y / 10)];
    const order = (a, b) => { const [ax, ay] = pos(a), [bx, by] = pos(b); return ax - bx || ay - by; };
    const list = [...groups.values()].map(g => { g.members.sort(order); return g; }).sort((a, b) => order(a.members[0], b.members[0]));
    const next = {};
    list.forEach(g => {
      const n = next[g.cls] = (next[g.cls] || 0) + 1;
      if (g.members.length > 1 || (g.members[0].label || "").includes(".")) g.members.forEach((c, k) => { c.label = `${g.cls}${n}.${k + 1}`; });
      else g.members[0].label = g.cls + n;
    });
    commit();
  }
  // Sections of one switch share its name before the dot (SF1.1, SF1.2) and always move together.
  function switchGang(c) { const i = c.label.lastIndexOf("."); return i > 0 ? c.label.slice(0, i) : null; }
  function setSwitch(c, pos) {
    const g = switchGang(c);
    S.comps.forEach(k => { if (k === c || (g && k.type === "switch" && switchGang(k) === g)) k.params.pos = pos; });
    commit();
  }

  function onWheel(e) {
    e.preventDefault();
    const m = evPos(e);
    if (e.shiftKey) { S.view.ox -= e.deltaY; render(); return; }
    zoomAt(m.sx, m.sy, Math.exp(-e.deltaY * 0.0015));
  }

  function onKeyDown(e) {
    const tag = (e.target.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (k === " ") { S.spaceDown = true; canvas.style.cursor = "grab"; e.preventDefault(); return; }
    if (k === "Escape") { if (S.wiring) finishWiring(); else if (S.placing) { S.placing = null; setTool("select"); } else { S.sel.comps.clear(); S.sel.wires.clear(); updateInspector(); render(); } }
    else if ((k === "Delete" || k === "Backspace")) { deleteSelection(); e.preventDefault(); }
    else if (k === "r" || k === "R") { if (!ctrl) rotateSelection(); }
    else if (k === "w" || k === "W") setTool(S.tool === "wire" ? "select" : "wire");
    else if (k === "v" && !ctrl) setTool("select");
    else if (k === "f" || k === "F") fitView();
    else if (ctrl && k === "Enter") { runSim("full"); e.preventDefault(); }
    else if (ctrl && (k === "s" || k === "S")) { saveFile(); e.preventDefault(); }
    else if (ctrl && (k === "o" || k === "O")) { document.getElementById("file-input").click(); e.preventDefault(); }
    else if (ctrl && (k === "z" || k === "Z")) { e.shiftKey ? redo() : undo(); e.preventDefault(); }
    else if (ctrl && (k === "y" || k === "Y")) { redo(); e.preventDefault(); }
    else if (ctrl && (k === "c" || k === "C")) { copySelection(); }
    else if (ctrl && (k === "v" || k === "V")) { paste(40, 40); e.preventDefault(); }
    else if (ctrl && (k === "d" || k === "D")) { if (copySelection()) paste(40, 40); e.preventDefault(); }
    else if (ctrl && (k === "a" || k === "A")) { S.comps.forEach(c => S.sel.comps.add(c.id)); S.wires.forEach(w => S.sel.wires.add(w.id)); updateInspector(); render(); e.preventDefault(); }
    else if (k === "+" || k === "=") zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.2);
    else if (k === "-") zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.2);
  }
  function onKeyUp(e) { if (e.key === " ") { S.spaceDown = false; canvas.style.cursor = ""; } }

  function updateHover(m) {
    const pin = hitPin(m.wx, m.wy);
    let net, label = "";
    const T = S.sim.topo || topo();
    if (pin) { net = T.pinNet.get(pin.c.id + ":" + pin.p.id); label = `${pin.c.label || LIB[pin.c.type].name} ${pin.p.name || pin.p.id}`; }
    else {
      const w = hitWire(m.wx, m.wy);
      if (w) { net = (S.sim.topo || topo()).wireNet.get(w.id); label = "wire"; }
    }
    let cursor = "";
    if (S.spaceDown) cursor = "grab";
    else if (S.placing || S.wiring || S.tool === "wire" || pin) cursor = "crosshair";
    else if (!pin) { const w = hitWire(m.wx, m.wy); if (w) cursor = isH(w) ? "ns-resize" : "ew-resize"; else if (hitComp(m.wx, m.wy)) cursor = "move"; }
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    const el = document.getElementById("status-hover");
    if (net === undefined) { el.textContent = `x ${snap(m.wx)}  y ${snap(m.wy)}`; return; }
    const dc = netDC(net), wave = netWave(net), st = wave ? stats(wave) : null;
    el.textContent = `${label}: ` + (net === 0 ? "ground (0 V)" : (dc === null ? "not simulated" : `DC ${fmtEng(dc, "V", 2)}` + (st && st.pp > 1e-4 ? ` · AC ${fmtEng(st.pp, "Vpp", 2)} · avg ${fmtEng(st.mean, "V", 2)}` : "")));
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(draw);
  }

  function draw() {
    renderQueued = false;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a0e14"; ctx.fillRect(0, 0, W, H);
    const { scale, ox, oy } = S.view;

    // grid dots
    const step = scale < 0.6 ? 50 : (scale < 1.2 ? 20 : 10);
    const tl = toWorld(0, 0), br = toWorld(W, H);
    ctx.fillStyle = "#1a2433";
    const sz = Math.max(1, 1.4 * Math.min(scale, 1.5));
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step)
      for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step)
        ctx.fillRect(x * scale + ox - sz / 2, y * scale + oy - sz / 2, sz, sz);

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    const T = topo();

    // drawing sheets lie behind everything
    S.comps.forEach(c => { if (c.type === "frame") drawComp(c, S.sel.comps.has(c.id), false); });
    // wires
    ctx.lineCap = "round";
    S.wires.forEach(w => {
      const sel = S.sel.wires.has(w.id);
      ctx.strokeStyle = sel ? "#ffd54f" : "#3fb950";
      ctx.lineWidth = sel ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
    });
    // dangling wire ends
    ctx.fillStyle = "#ff7b72";
    T.degree.forEach((d, k) => {
      if (d !== 1 || T.pinAt.has(k)) return;
      const [x, y] = k.split(",").map(Number);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    });
    // junction dots
    ctx.fillStyle = "#3fb950";
    T.junctions.forEach(j => { ctx.beginPath(); ctx.arc(j.x, j.y, 4, 0, Math.PI * 2); ctx.fill(); });

    // components
    S.comps.forEach(c => { if (c.type !== "frame") drawComp(c, S.sel.comps.has(c.id), false); });

    // voltage tags
    if (S.showVolts && S.sim.result) drawVoltTags(T);

    // placing ghost
    if (S.placing) {
      const g = { id: "ghost", type: S.placing.type, x: snap(S.mouse.wx), y: snap(S.mouse.wy), rot: S.placing.rot, params: Object.assign({}, LIB[S.placing.type].defaults, S.placing.params), label: "" };
      if (g.type === "tube") g.params.connection = tubeKind(tubeByName(g.params.tube)) === "pentode" ? "pentode" : "triode";
      ctx.globalAlpha = 0.55; drawComp(g, false, true); ctx.globalAlpha = 1;
    }
    // wiring preview
    if (S.wiring) {
      const pin = hitPin(S.mouse.wx, S.mouse.wy);
      const tx = pin ? pin.p.x : snap(S.mouse.wx), ty = pin ? pin.p.y : snap(S.mouse.wy);
      const hFirst = S.wiring.hFirst === null ? Math.abs(tx - S.wiring.x) >= Math.abs(ty - S.wiring.y) : S.wiring.hFirst;
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      lRoute(S.wiring.x, S.wiring.y, tx, ty, hFirst).forEach(s => { ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); ctx.stroke(); });
      ctx.setLineDash([]);
      ctx.fillStyle = "#00e5ff"; ctx.beginPath(); ctx.arc(S.wiring.x, S.wiring.y, 3.5, 0, Math.PI * 2); ctx.fill();
      if (isConnectionPoint(tx, ty)) { ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI * 2); ctx.stroke(); }
    }
    // box selection
    if (S.drag && S.drag.kind === "box") {
      const d = S.drag;
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 1 / scale; ctx.setLineDash([4 / scale, 3 / scale]);
      ctx.fillStyle = "rgba(0,229,255,0.06)";
      ctx.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.setLineDash([]);
    }

    // empty-sheet hint
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!S.comps.length && !S.wires.length) {
      ctx.fillStyle = "#5c6b80"; ctx.textAlign = "center"; ctx.font = "15px system-ui, sans-serif";
      ctx.fillText("Empty sheet — pick parts from the left panel and click to place them.", W / 2, H / 2 - 12);
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText("Click a pin to start a wire · wheel zooms · Space or middle-drag pans", W / 2, H / 2 + 12);
      ctx.textAlign = "left";
    }
  }

  // Reference designation as shown on the diagram: the label as typed, e.g. RA1,
  // KF1.2 (the IEC 81346-1 aspect prefix "-" is left off, as is usual on a
  // single schematic; type it into the label to show it)
  function desig(c) { return c.label || ""; }
  function drawComp(c, sel, ghost) {
    const def = LIB[c.type];
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((c.rot & 3) * Math.PI / 2);
    ctx.strokeStyle = sel ? COL.bodySel : (c.type === "ground" ? "#8b949e" : (c.type === "vdc" || c.type === "ptx" || c.type === "ptx_cat" || c.type === "mains" ? "#ff9e64" : (c.type === "siggen" ? "#00e5ff" : COL.body)));
    ctx.lineWidth = 2;
    c._sel = sel;
    DRAW[c.type](ctx, c);
    delete c._sel;
    ctx.restore();

    if (c.type === "scope" && !S.printing) drawScopeScreen(c);

    // pins
    if (!ghost && !S.printing) {
      const T = topo();
      compPins(c).forEach(p => {
        const conn = T.pinConnected.get(c.id + ":" + p.id);
        if (conn || (c.type === "scope" && /^CH/.test(p.id))) return;   // probe inputs are optional
        ctx.strokeStyle = "#ff7b72"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.stroke();
      });
    }
    // labels
    if (def.noLabel) return;
    const b = compBBox(c);
    const val = def.value(c);
    ctx.font = "bold 11px ui-monospace, Menlo, monospace";
    ctx.fillStyle = sel ? COL.bodySel : COL.text;
    const vertical = (b.y2 - b.y1) > (b.x2 - b.x1) * 1.2 && c.type !== "tube";
    if (c.type === "scope") {
      // IEC 60617 S00922 oscilloscope: circle with a time-base trace
      ctx.save(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(b.x1 + 18, b.y1 - 11, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b.x1 + 13, b.y1 - 8); ctx.lineTo(b.x1 + 20, b.y1 - 15); ctx.lineTo(b.x1 + 20, b.y1 - 8); ctx.lineTo(b.x1 + 24, b.y1 - 12); ctx.stroke(); ctx.restore();
      ctx.textAlign = "left"; ctx.fillText(desig(c) + "  oscilloscope", b.x1 + 32, b.y1 - 6);
      ctx.font = "9px ui-monospace, monospace"; ctx.fillStyle = "#ffd54f"; ctx.fillText("CH1", c.x - 88, c.y - 34); ctx.fillStyle = "#00e5ff"; ctx.fillText("CH2", c.x - 88, c.y - 14); ctx.fillStyle = "#8b949e"; ctx.fillText("COM", c.x - 88, c.y + 26);
      return;
    }
    // IEC 61082-1 7.1.6.1 / 7.1.2.5: the reference designation goes to the left of a
    // symbol with mainly vertical terminal lines and above one with mainly horizontal
    // ones; technical data on the same side, below (or right of) the designation
    if (c.type === "tube") {
      if ((c.rot & 1) === 0) {   // anode up, cathode down: text to the left, clear of the grid lead
        ctx.textAlign = "right";
        ctx.fillText(desig(c), c.x - 30, c.y - 28);
        ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = COL.value;
        ctx.fillText(val, c.x - 30, c.y - 15);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(desig(c), c.x, b.y1 - 17);
        ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = COL.value;
        ctx.fillText(val, c.x, b.y1 - 5);
      }
      ctx.textAlign = "left";
      return;
    }
    if (vertical) {
      ctx.textAlign = "right";
      ctx.fillText(desig(c), b.x1 - 5, c.y - 2);
      ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = COL.value;
      ctx.fillText(val, b.x1 - 5, c.y + 11);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(desig(c), c.x, b.y1 - (val ? 17 : 5));
      ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = COL.value;
      if (val) ctx.fillText(val, c.x, b.y1 - 5);
    }
    ctx.textAlign = "left";
  }

  // Scaling of the on-canvas scope screens: same auto-ranging as the
  // oscilloscope window (scope-math.js)
  function scopeView(c, chans) {
    const SM = ScopeMath, dt = chans.dt, live = [chans.ch1, chans.ch2].filter(a => a && !SM.isFlat(SM.stats(a)));
    const trig = live[0] || chans.ch1 || chans.ch2;
    const tdiv = c.params.time === "auto" ? SM.timebase(trig, dt, signalFreq()).tdiv : parseFloat(c.params.time);
    const count = Math.max(2, Math.round((10 * tdiv) / dt));
    const start = SM.triggerIndex(trig, "rising");
    const ch = (arr, vd, coupling) => arr ? { arr, ...SM.channel(arr, vd === "auto" ? "auto" : parseFloat(vd), coupling) } : null;
    return { start, count, span: count * dt, c1: ch(chans.ch1, c.params.ch1, c.params.coupling1), c2: ch(chans.ch2, c.params.ch2, c.params.coupling2) };
  }
  function drawScopeScreen(c) {
    const x0 = c.x - 62, y0 = c.y - 39, w = 124, h = 66;
    ctx.fillStyle = "#03080d"; ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = "rgba(0,180,216,0.18)"; ctx.lineWidth = 0.6;
    for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(x0 + i * w / 10, y0); ctx.lineTo(x0 + i * w / 10, y0 + h); ctx.stroke(); }
    for (let j = 0; j <= 8; j++) { ctx.beginPath(); ctx.moveTo(x0, y0 + j * h / 8); ctx.lineTo(x0 + w, y0 + j * h / 8); ctx.stroke(); }
    const chans = scopeChannels(c);
    ctx.font = "7px ui-monospace, monospace";
    if (!chans || (!chans.ch1 && !chans.ch2)) {
      ctx.fillStyle = "#5c6b80"; ctx.textAlign = "center"; ctx.fillText(S.sim.result ? "connect CH1 / CH2" : "no signal", c.x, y0 + h / 2 + 2); ctx.textAlign = "left";
      return;
    }
    const v = scopeView(c, chans);
    const plot = (ch, color) => {
      if (!ch) return;
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let i = 0; i < v.count; i++) {
        const val = (ScopeMath.at(ch.arr, v.start + i) - ch.off) / ch.vdiv;
        const px = x0 + i / (v.count - 1) * w, py = y0 + h / 2 - Math.max(-4.2, Math.min(4.2, val)) * h / 8;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    };
    plot(v.c1, "#ffd54f"); plot(v.c2, "#00e5ff");
    // "+" marks a channel shown with a position offset (its DC level is off screen)
    ctx.fillStyle = "#ffd54f"; if (v.c1) ctx.fillText(fmtEng(v.c1.vdiv, "V") + "/div" + (c.params.coupling1 === "ac" ? " AC" : v.c1.offset ? "+" : ""), x0 + 2, y0 + h + 10);
    ctx.fillStyle = "#00e5ff"; if (v.c2) ctx.fillText(fmtEng(v.c2.vdiv, "V") + "/div" + (c.params.coupling2 === "ac" ? " AC" : v.c2.offset ? "+" : ""), x0 + 44, y0 + h + 10);
    ctx.fillStyle = "#8b949e"; ctx.fillText(fmtEng(v.span / 10, "s") + "/div", x0 + 88, y0 + h + 10);
  }

  function drawVoltTags(T) {
    const placed = new Set();
    ctx.font = "9px ui-monospace, monospace";
    // one tag per net at its first horizontal wire's midpoint (or first wire)
    const byNet = new Map();
    S.wires.forEach(w => { const n = T.wireNet.get(w.id); if (n === 0 || n === undefined) return; const cur = byNet.get(n); const len = Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1); if (!cur || (isH(w) && !isH(cur)) || (isH(w) === isH(cur) && len > Math.abs(cur.x2 - cur.x1) + Math.abs(cur.y2 - cur.y1))) byNet.set(n, w); });
    byNet.forEach((w, n) => {
      const v = netDC(n);
      if (v === null) return;
      const txt = fmtEng(v, "V", Math.abs(v) >= 100 ? 0 : 1);
      const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
      const k = Math.round(mx / 30) + ":" + Math.round(my / 20);
      if (placed.has(k)) return; placed.add(k);
      const tw = ctx.measureText(txt).width + 6;
      const tx = isH(w) ? mx - tw / 2 : mx + 4, ty = isH(w) ? my - 15 : my - 6;
      ctx.fillStyle = "rgba(10,14,20,0.85)"; ctx.fillRect(tx, ty, tw, 12);
      ctx.strokeStyle = "rgba(255,213,79,0.35)"; ctx.lineWidth = 0.8; ctx.strokeRect(tx, ty, tw, 12);
      ctx.fillStyle = "#ffd54f"; ctx.fillText(txt, tx + 3, ty + 9);
    });
  }

  // ---------------------------------------------------------------------------
  // UI: palette, toolbar, inspector, status
  // ---------------------------------------------------------------------------
  function setStatus(kind, text) {
    const el = document.getElementById("status-sim");
    el.className = "sim-status " + kind;
    el.textContent = text;
    // instrument windows show what the CAD is doing (e.g. after their ▶ Simulate)
    if (channel) { try { channel.postMessage({ type: "SIM_STATUS", kind, text, busy: kind === "busy", version: VERSION }); } catch (e) {} }
  }
  function setTool(t) {
    S.tool = t;
    if (t !== "wire") S.wiring = null;
    document.getElementById("btn-tool-select").classList.toggle("active", t === "select" && !S.placing);
    document.getElementById("btn-tool-wire").classList.toggle("active", t === "wire");
    document.querySelectorAll(".pal-item.active").forEach(el => { if (!S.placing) el.classList.remove("active"); });
    render();
  }
  function updateZoomLabel() { document.getElementById("zoom-label").textContent = Math.round(S.view.scale * 100) + "%"; }

  function startPlacing(type, params, el) {
    S.placing = { type, params: params || {}, rot: 0 };
    S.wiring = null;
    document.querySelectorAll(".pal-item.active").forEach(x => x.classList.remove("active"));
    if (el) el.classList.add("active");
    setTool("select");
    canvas.focus();
  }

  function buildPalette() {
    const host = document.getElementById("palette");
    host.innerHTML = "";
    const addGroup = (title) => { const h = document.createElement("div"); h.className = "pal-group"; h.textContent = title; host.appendChild(h); };
    const addItem = (label, sub, type, params, extraClass) => {
      const b = document.createElement("button");
      b.className = "pal-item" + (extraClass ? " " + extraClass : "");
      b.innerHTML = `<span>${label}</span>${sub ? `<em>${sub}</em>` : ""}`;
      b.title = "Click, then click on the sheet to place (Shift-click places several)";
      b.addEventListener("click", () => startPlacing(type, params, b));
      host.appendChild(b);
      return b;
    };
    PALETTE.forEach(g => {
      addGroup(g.group);
      g.items.forEach(([type, params, label]) => {
        const def = LIB[type];
        const p = Object.assign({}, def.defaults, params || {});
        addItem(label || def.name, def.value({ params: p }), type, params);
      });
    });
    // tubes from the shared database
    addGroup("Tubes");
    const search = document.createElement("input");
    search.type = "search"; search.placeholder = "Search 40 tubes…"; search.className = "pal-search";
    host.appendChild(search);
    const list = document.createElement("div");
    host.appendChild(list);
    const fill = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = "";
      [["triode", "Triodes"], ["pentode", "Pentodes & beam tetrodes"], ["rectifier", "Rectifiers"]].forEach(([kind, title]) => {
        const tubes = TUBE_DATABASE.filter(t => tubeKind(t) === kind && (!q || (t.commonName + " " + t.nameGost + " " + t.nameWestern + " " + t.type).toLowerCase().includes(q)));
        if (!tubes.length) return;
        const h = document.createElement("div"); h.className = "pal-sub"; h.textContent = title; list.appendChild(h);
        tubes.forEach(t => {
          const b = document.createElement("button");
          b.className = "pal-item tube";
          b.innerHTML = `<span>${t.commonName}</span><em>${t.type.replace(/ (Triode|Pentode|Tetrode|Rectifier)$/, "")}</em>`;
          b.title = `${t.nameWestern} · ${t.nameGost} · Pa max ${t.paMax} W`;
          b.addEventListener("click", () => startPlacing("tube", { tube: t.commonName }, b));
          list.appendChild(b);
        });
      });
    };
    search.addEventListener("input", fill);
    fill();
  }

  function selectedComp() { return S.sel.comps.size === 1 && !S.sel.wires.size ? S.comps.find(c => S.sel.comps.has(c.id)) : null; }

  // Tell the curve tracer which tube is selected so its graph follows the editor
  let selectedTubeId = null;      // tube selected right now (null when not a tube)
  let lastTubeId = null;          // last tube selected; a newly opened tracer starts on it
  function announceSelectedTube(c) {
    const isTube = c && c.type === "tube" && tubeKind(tubeByName(c.params.tube)) !== "rectifier";
    if (!isTube) { selectedTubeId = null; return; }
    if (c.id === selectedTubeId) return;
    selectedTubeId = lastTubeId = c.id;
    if (channel) { try { channel.postMessage({ type: "SELECT_TUBE", id: c.id, tube: c.params.tube, label: c.label }); } catch (e) {} }
  }

  let inspectorFor = null;
  function updateInspector(liveOnly) {
    const host = document.getElementById("inspector");
    const c = selectedComp();
    announceSelectedTube(c);
    const sig = c ? c.id + ":" + c.type + ":" + c.params.tube + ":" + c.params.connection + ":" + (c.type === "ptx_cat" ? [c.params.model, c.params.tap, c.params.bias].join("/") : "") : (S.sel.wires.size ? "wires" : "none") + S.sel.comps.size;
    if (!liveOnly || sig !== inspectorFor) {
      inspectorFor = sig;
      host.innerHTML = "";
      if (c) buildCompInspector(host, c);
      else if (S.sel.comps.size || S.sel.wires.size) {
        host.innerHTML = `<div class="insp-title">${S.sel.comps.size} part(s), ${S.sel.wires.size} wire segment(s)</div>
          <p class="insp-help">Drag to move · R rotates parts · Del deletes · Ctrl+D duplicates.<br>Drag a wire segment sideways to move it; connected wires follow.</p>`;
      } else buildCircuitPanel(host);
    }
    const live = document.getElementById("insp-live");
    if (live) live.innerHTML = c ? liveReadout(c) : circuitReadout();
  }

  function buildCompInspector(host, c) {
    const def = LIB[c.type];
    host.innerHTML = `<div class="insp-title">${def.name}</div>`;
    if (!def.noLabel) host.appendChild(row("Designator", input("text", c.label, v => { c.label = v.trim() || c.label; commit(); })));
    def.fields.forEach(f => {
      if (f.when && !f.when(c)) return;
      let el;
      if (f.kind === "eng") {
        el = input("text", fmtEng(c.params[f.key], ""), v => {
          const n = parseEng(v);
          const allowNeg = f.key === "v" || f.key === "offset";
          if (!isFinite(n) || (!allowNeg && n < 0) || (n === 0 && !["offset", "rs", "v"].includes(f.key))) { flash(el); return; }
          c.params[f.key] = n; commit();
        });
      } else if (f.kind === "text") {
        el = input("text", c.params[f.key] || "", v => { c.params[f.key] = v; commit(); });
      } else if (f.kind === "number") {
        el = input("number", c.params[f.key], v => { const n = parseFloat(v); if (!isFinite(n)) { flash(el); return; } c.params[f.key] = Math.min(f.max !== undefined ? f.max : Infinity, Math.max(f.min !== undefined ? f.min : -Infinity, n)); commit(); });
      } else if (f.kind === "select") {
        el = document.createElement("select");
        (typeof f.options === "function" ? f.options(c) : f.options).forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; el.appendChild(o); });
        el.value = String(c.params[f.key]);
        el.addEventListener("change", () => { if (c.type === "switch" && f.key === "pos") setSwitch(c, el.value); else { c.params[f.key] = el.value; commit(); } });
      } else if (f.kind === "range") {
        const wrap = document.createElement("div"); wrap.className = "range-wrap";
        const r = document.createElement("input"); r.type = "range"; r.min = f.min; r.max = f.max; r.step = f.step; r.value = c.params[f.key];
        const lab = document.createElement("span"); lab.textContent = f.format(c.params[f.key]);
        r.addEventListener("input", () => { c.params[f.key] = parseFloat(r.value); lab.textContent = f.format(c.params[f.key]); S.topo = null; scheduleSim(60); render(); });
        r.addEventListener("change", () => commit());
        wrap.appendChild(r); wrap.appendChild(lab); el = wrap;
      } else if (f.kind === "tube") {
        el = document.createElement("select");
        [["triode", "Triodes"], ["pentode", "Pentodes & beam tetrodes"], ["rectifier", "Rectifiers"]].forEach(([kind, title]) => {
          const g = document.createElement("optgroup"); g.label = title;
          TUBE_DATABASE.filter(t => tubeKind(t) === kind).forEach(t => { const o = document.createElement("option"); o.value = t.commonName; o.textContent = `${t.commonName} — ${t.type}`; g.appendChild(o); });
          el.appendChild(g);
        });
        el.value = c.params.tube;
        el.addEventListener("change", () => { c.params.tube = el.value; c.params.connection = tubeKind(tubeByName(el.value)) === "pentode" ? "pentode" : "triode"; commit(); });
      }
      host.appendChild(row(f.label + (f.unit && f.kind !== "range" ? ` (${f.unit})` : ""), el));
    });
    if (c.type === "tube") {
      const t = tubeByName(c.params.tube);
      if (t) {
        const p = document.createElement("p"); p.className = "insp-help";
        p.textContent = `${t.nameWestern} · ${t.nameGost} · Va max ${t.vaMax} V · Pa max ${t.paMax} W · heater ${t.vh} V / ${t.ih} A (not simulated)`;
        host.appendChild(p);
      }
    }
    if (def.info) {
      const p = document.createElement("p"); p.className = "insp-help";
      p.textContent = def.info(c);
      host.appendChild(p);
    }
    if (c.type === "switch") {
      const p = document.createElement("p"); p.className = "insp-help";
      p.textContent = "Double-click the switch on the sheet to flip it. Sections named like SF1.1 and SF1.2 are one switch and flip together.";
      host.appendChild(p);
    }
    if (c.type === "scope") {
      const b = document.createElement("button"); b.className = "btn wide"; b.textContent = "Open full oscilloscope ↗";
      b.addEventListener("click", () => ToolWindows.open("oscilloscope.html", { scope: c.id }));
      host.appendChild(b);
      const b2 = document.createElement("button"); b2.className = "btn wide"; b2.textContent = "Open spectrum analyzer ↗";
      b2.addEventListener("click", () => ToolWindows.open("spectrum_analyzer.html", { scope: c.id }));
      host.appendChild(b2);
    }
    const live = document.createElement("div"); live.id = "insp-live"; live.className = "insp-live";
    host.appendChild(live);
    const act = document.createElement("div"); act.className = "insp-actions";
    act.innerHTML = `<button class="btn" data-a="rot" ${def.noRotate ? "disabled" : ""}>⟳ Rotate (R)</button><button class="btn danger" data-a="del">Delete (Del)</button>`;
    act.querySelector('[data-a="rot"]').onclick = rotateSelection;
    act.querySelector('[data-a="del"]').onclick = deleteSelection;
    host.appendChild(act);
  }

  function kv(k, v, cls) { return `<div class="kv${cls ? " " + cls : ""}"><span>${k}</span><b>${v}</b></div>`; }

  function liveReadout(c) {
    const r = S.sim.result;
    if (!r) return `<div class="insp-sub">Operating point</div><p class="insp-help">${S.sim.error || "Not simulated yet."}</p>`;
    let h = `<div class="insp-sub">Operating point</div>`;
    const vAcross = (a, b) => { const na = pinNetOf(c, a), nb = pinNetOf(c, b); const va = netDC(na), vb = netDC(nb); return va === null || vb === null ? null : va - vb; };
    const pAvg = (a, b, R) => { const wa = waveOf(c, a), wb = waveOf(c, b); if (!wa || !wb) { const v = vAcross(a, b); return v === null ? null : v * v / R; } let s = 0; for (let i = 0; i < wa.length; i++) { const v = wa[i] - wb[i]; s += v * v; } return s / wa.length / R; };
    switch (c.type) {
      case "tube": {
        const d = tubeData(c);
        if (!d) return h + `<p class="insp-help">No data.</p>`;
        if (d.kind === "rectifier") {
          h += kv("Anode 1 current", fmtEng(d.a1 ? d.a1.i : 0, "A")) + kv("Anode 2 current", fmtEng(d.a2 ? d.a2.i : 0, "A"));
          return h + `<p class="insp-help">DC values; peak currents are higher while the reservoir cap charges.</p>`;
        }
        const dc = d.dc;
        const pa = dc.vak * dc.ia, over = pa > d.paMax;
        h += kv("Va (anode–cathode)", fmtEng(dc.vak, "V", 1), dc.vak > d.vaMax ? "bad" : "");
        h += kv(d.kind === "pentode" ? "Vg1k (bias)" : "Vgk (bias)", fmtEng(dc.vgk, "V", 2), dc.vgk > 0 ? "warn" : "");
        if (d.kind === "pentode") h += kv("Vg2k (screen)", fmtEng(dc.vg2k, "V", 1));
        h += kv("Ia (anode current)", fmtEng(dc.ia, "A", 2));
        if (d.kind === "pentode") h += kv("Ig2 (screen current)", fmtEng(dc.ig2, "A", 2));
        h += kv("Pa (dissipation)", `${fmtEng(pa, "W", 2)} · ${Math.round(pa / d.paMax * 100)}% of ${d.paMax} W`, over ? "bad" : (pa > 0.85 * d.paMax ? "warn" : ""));
        if (d.metrics) {
          h += `<div class="insp-sub">With signal</div>`;
          h += kv("Plate swing", fmtEng(d.metrics.vakPP, "Vpp", 1)) + kv("Grid swing", fmtEng(d.metrics.vgkPP, "Vpp", 2));
          if (d.metrics.gain) h += kv("Plate/grid gain", d.metrics.gain.toFixed(1) + "×");
          if (d.metrics.thd !== null) h += kv("THD at plate", d.metrics.thd.toFixed(2) + " %", d.metrics.thd > 5 ? "warn" : "");
          h += kv("Average Pa", fmtEng(d.metrics.pAvg, "W", 2), d.metrics.pAvg > d.paMax ? "bad" : "");
        }
        if (dc.vgk > 0) h += `<p class="insp-help warn">Grid is positive: grid current flows.</p>`;
        return h;
      }
      case "resistor": case "pot": {
        if (c.type === "pot") { h += kv("Wiper DC", fmtEng(netDC(pinNetOf(c, "W")), "V", 2)); return h; }
        const v = vAcross("1", "2"), p = pAvg("1", "2", c.params.r);
        h += kv("Voltage (DC)", fmtEng(v, "V", 2)) + kv("Current (DC)", fmtEng(v / c.params.r, "A", 2)) + kv("Power (avg)", fmtEng(p, "W", 2), p > 1 ? "warn" : "");
        return h;
      }
      case "capacitor": case "electrolytic": {
        const v = c.type === "electrolytic" ? vAcross("+", "-") : vAcross("1", "2");
        h += kv("DC voltage across", fmtEng(v, "V", 1), c.type === "electrolytic" && v < -0.5 ? "bad" : "");
        if (c.type === "electrolytic" && v < -0.5) h += `<p class="insp-help warn">Reverse-biased electrolytic.</p>`;
        return h;
      }
      case "inductor": {
        const v = vAcross("1", "2"); h += kv("DC current", fmtEng(v / Math.max(c.params.dcr, 1e-3), "A", 2)) + kv("DC drop", fmtEng(v, "V", 2)); return h;
      }
      case "speaker": {
        const p = pAvg("+", "-", c.params.r);
        h += kv("Output power", fmtEng(p, "W", 2)) + kv("Voltage", fmtEng(Math.sqrt(p * c.params.r), "Vrms", 2)); return h;
      }
      case "vdc": {
        const dev = r.dc.devices[c.id];
        const i = dev && dev.main ? -dev.main.i : null;
        h += kv("Current supplied", fmtEng(i, "A", 2)) + kv("Power", fmtEng(i !== null ? i * c.params.v : null, "W", 2)); return h;
      }
      case "opt_se": case "opt_pp": {
        h += kv("Secondary", fmtEng(Math.sqrt(pAvg("S1", "S2", 1)), "Vrms", 2)); return h;
      }
      case "scope": {
        const ch = scopeChannels(c);
        if (!ch) return h + `<p class="insp-help">No transient data (add a signal generator).</p>`;
        [["CH1", ch.ch1], ["CH2", ch.ch2]].forEach(([n, a]) => {
          if (!a) { h += kv(n, "not connected"); return; }
          const s = stats(a); h += kv(n, `${fmtEng(s.pp, "Vpp", 2)} · avg ${fmtEng(s.mean, "V", 2)}`);
        });
        return h;
      }
      default: return "";
    }
  }

  function buildCircuitPanel(host) {
    host.innerHTML = `<div class="insp-title">Circuit</div><div id="insp-live" class="insp-live"></div>
      <button class="btn wide" id="btn-renumber" title="Class code (IEC 81346-2) and number for every part, in reading order">Renumber designations (IEC 81346)</button>
      <div class="insp-sub">How to</div>
      <ul class="help-list">
        <li><b>Place:</b> pick a part on the left, click the sheet. <kbd>R</kbd> rotates while placing, <kbd>Shift</kbd>-click places several.</li>
        <li><b>Wire:</b> click a pin, click corners, finish on a pin or wire. <kbd>W</kbd> starts wires anywhere.</li>
        <li><b>Move:</b> drag parts (wires follow) or drag a wire segment sideways.</li>
        <li><b>View:</b> wheel zooms, <kbd>Space</kbd>/middle-drag pans, <kbd>F</kbd> fits.</li>
        <li><b>Measure:</b> hover a wire for its voltage; wire an Oscilloscope to see waveforms; double-click it for the full scope.</li>
        <li><b>Simulate:</b> <i>Live</i> re-simulates after every edit. Turn it off to simulate only on <i>▶ Simulate</i> (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>), which always runs until the circuit has settled.</li>
        <li><b>Switch:</b> double-click to flip it; sections named SF1.1, SF1.2… flip together.</li>
        <li><b>Standards:</b> symbols follow IEC 60617 and designations IEC 81346. Add a <i>Drawing frame</i> for an IEC 61082 sheet with reference grid and title block.</li>
      </ul>`;
    const rb = host.querySelector("#btn-renumber"); if (rb) rb.addEventListener("click", renumber);
  }
  function circuitReadout() {
    const T = topo();
    const counts = {};
    S.comps.forEach(c => { counts[c.type] = (counts[c.type] || 0) + 1; });
    let h = kv("Parts", S.comps.length) + kv("Wire segments", S.wires.length) + kv("Nets", T.nodeCount);
    const issues = [];
    if (hasCircuit() && !T.hasGround) issues.push("No ground symbol.");
    const open = [];
    S.comps.forEach(c => { if (c.type === "scope") return; compPins(c).forEach(p => { if (!T.pinConnected.get(c.id + ":" + p.id)) { if (c.type === "opt_pp" && (p.id === "U1" || p.id === "U2")) return; open.push(`${c.label || LIB[c.type].name}.${p.id}`); } }); });
    if (open.length) issues.push("Unconnected pins: " + open.slice(0, 8).join(", ") + (open.length > 8 ? ` (+${open.length - 8})` : ""));
    // parts whose terminals are wired together
    const shortPairs = { resistor: [["1", "2"]], capacitor: [["1", "2"]], electrolytic: [["+", "-"]], inductor: [["1", "2"]], speaker: [["+", "-"]], diode: [["A", "K"]], vdc: [["+", "-"]], siggen: [["+", "-"]],
      opt_se: [["P1", "P2"], ["S1", "S2"]], opt_pp: [["P1", "CT"], ["CT", "P2"], ["S1", "S2"]], ptx: [["HT1", "CT"], ["CT", "HT2"]] };
    const shorted = [];
    S.comps.forEach(c => (shortPairs[c.type] || []).forEach(([a, b]) => {
      const na = T.pinNet.get(c.id + ":" + a), nb = T.pinNet.get(c.id + ":" + b);
      if (na !== undefined && na === nb && T.pinConnected.get(c.id + ":" + a)) shorted.push(`${c.label}(${a}–${b})`);
    }));
    if (shorted.length) issues.push("Shorted by wiring: " + shorted.join(", "));
    if (S.sim.error) issues.push(S.sim.error);
    (S.sim.warnings || []).forEach(w => issues.push(w));
    S.comps.forEach(c => { if (c.type !== "tube") return; const d = tubeData(c); if (d && d.dc && d.kind !== "rectifier" && d.dc.vak * d.dc.ia > d.paMax) issues.push(`${c.label} over dissipation (${(d.dc.vak * d.dc.ia).toFixed(1)} W > ${d.paMax} W).`); });
    h += `<div class="insp-sub">Checks</div>` + (issues.length ? issues.map(i => `<p class="insp-help warn">⚠ ${i}</p>`).join("") : `<p class="insp-help ok">✓ No problems found.</p>`);
    return h;
  }

  function row(label, el) {
    const d = document.createElement("label"); d.className = "row";
    const s = document.createElement("span"); s.textContent = label;
    d.appendChild(s); d.appendChild(el); return d;
  }
  function input(type, value, onCommit) {
    const el = document.createElement("input"); el.type = type; el.value = value;
    el.addEventListener("change", () => onCommit(el.value));
    el.addEventListener("keydown", e => { if (e.key === "Enter") el.blur(); });
    return el;
  }
  function flash(el) { el.classList.add("invalid"); setTimeout(() => el.classList.remove("invalid"), 900); }

  // ---------------------------------------------------------------------------
  // File operations, SPICE export
  // ---------------------------------------------------------------------------
  // a sheet with only document parts (frame, notes) holds no circuit yet
  const hasCircuit = () => S.comps.some(c => c.type !== "frame" && c.type !== "note");
  // New circuit: a sheet with an IEC 61082 drawing frame (format and orientation chosen in a dialog)
  function newSheet() { document.getElementById("new-modal").hidden = false; document.getElementById("new-title").focus(); }
  function newCircuit(opts) {
    opts = Object.assign({ size: "A3", orient: "landscape", title: "" }, opts);
    const f = makeComp("frame", { size: opts.size, orient: opts.orient, title: opts.title, date: new Date().toISOString().slice(0, 10) }, 0, 0, 0);
    S.comps = [f]; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
    commit(); fitView();
  }
  // file name from the title block (or a default)
  function baseName() {
    const f = S.comps.find(c => c.type === "frame"), t = f && (f.params.docno || f.params.title);
    return (t ? t.replace(/[^\w.\- ]+/g, "").trim().replace(/\s+/g, "-") : "") || "tube-circuit";
  }
  // Save as PDF: the sheet in vector form, black on white. With a drawing frame the
  // page is that sheet (A4…A1, landscape or portrait, 1:1); without one, the drawing's bounds.
  function exportPDF(download) {
    const MMU = CadLib.MM, k = 72 / 25.4 / MMU;         // pt per drawing unit
    const f = S.comps.find(c => c.type === "frame");
    let page;
    if (f) { const g = CadLib.sheetGeom(f); page = { widthPt: g.W * k, heightPt: g.H * k, k, ox: f.x, oy: f.y }; }
    else {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      S.comps.forEach(c => { const b = compBBox(c); x1 = Math.min(x1, b.x1 - 60); y1 = Math.min(y1, b.y1 - 40); x2 = Math.max(x2, b.x2 + 60); y2 = Math.max(y2, b.y2 + 40); });
      S.wires.forEach(w => { x1 = Math.min(x1, w.x1, w.x2); y1 = Math.min(y1, w.y1, w.y2); x2 = Math.max(x2, w.x1, w.x2); y2 = Math.max(y2, w.y1, w.y2); });
      if (!isFinite(x1)) { x1 = 0; y1 = 0; x2 = 1188; y2 = 840; }
      page = { widthPt: (x2 - x1) * k, heightPt: (y2 - y1) * k, k, ox: x1, oy: y1 };
    }
    const bytes = PdfExport.buildPdf(page, pc => drawSheet(pc), { title: f && f.params.title });
    if (download !== false) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      a.download = baseName() + ".pdf"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setStatus("ok", `Saved ${baseName()}.pdf (${Math.round(bytes.length / 1024)} kB)`);
    }
    return bytes;
  }
  // the printable drawing: frame, conductors, junctions and parts (no grid, tags or selection)
  function drawSheet(target) {
    const keep = ctx; ctx = target; S.printing = true;
    try {
      const T = topo();
      S.comps.forEach(c => { if (c.type === "frame") drawComp(c, false, false); });
      ctx.lineCap = "round"; ctx.strokeStyle = "#3fb950"; ctx.lineWidth = 2;
      S.wires.forEach(w => { ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke(); });
      ctx.fillStyle = "#3fb950";
      T.junctions.forEach(j => { ctx.beginPath(); ctx.arc(j.x, j.y, 4, 0, Math.PI * 2); ctx.fill(); });
      S.comps.forEach(c => { if (c.type !== "frame") drawComp(c, false, false); });
    } finally { ctx = keep; S.printing = false; }
  }
  // The page shows no confirm() dialogs in some hosts; ask through the status bar instead
  let pendingConfirm = 0;
  function confirmInline(msg) {
    const now = Date.now();
    if (now - pendingConfirm < 4000) { pendingConfirm = 0; return true; }
    pendingConfirm = now;
    setStatus("warn", msg + " — click again to confirm.");
    return false;
  }
  function saveFile() {
    const blob = new Blob([JSON.stringify({ app: "TubeAmpCAD", version: 2, comps: S.comps, wires: S.wires }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = baseName() + ".json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function openFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (!Array.isArray(d.comps) || !Array.isArray(d.wires)) throw new Error("not a Tube Amp CAD file");
        d.comps.forEach(c => { if (!LIB[c.type]) throw new Error("unknown part " + c.type); c.params = Object.assign({}, LIB[c.type].defaults, c.params); });
        S.comps = d.comps; S.wires = d.wires; S.sel.comps.clear(); S.sel.wires.clear();
        commit(); fitView();
      } catch (err) { setStatus("error", "Could not open file: " + err.message); }
    };
    rd.readAsText(file);
  }

  function spiceNetlist() {
    const T = topo();
    const nl = buildNetlist();
    const nn = n => (n === 0 ? "0" : "N" + n);
    const lines = ["* Tube Amp CAD export — " + new Date().toISOString().slice(0, 10), "* Koren tube models as behavioural sources (LTspice syntax)"];
    const models = new Set();
    let k = 0;
    nl.elements.forEach(e => {
      const id = (e.id || "X").replace(/[^A-Za-z0-9_]/g, "_");
      const nd = (e.nodes || []).map(nn);
      switch (e.kind) {
        case "R": lines.push(`R${id} ${nd[0]} ${nd[1]} ${e.r}`); break;
        case "C": lines.push(`C${id} ${nd[0]} ${nd[1]} ${e.c}`); break;
        case "L": lines.push(`L${id} ${nd[0]} ${nd[1]} ${e.l}`); break;
        case "V": lines.push(`V${id} ${nd[0]} ${nd[1]} DC ${e.v}`); break;
        case "VSRC": lines.push(e.wave === "sine" ? `V${id} ${nd[0]} ${nd[1]} SIN(${e.offset || 0} ${e.amp} ${e.freq})` : `V${id} ${nd[0]} ${nd[1]} PULSE(${(e.offset || 0) - e.amp} ${(e.offset || 0) + e.amp} 0 ${e.wave === "triangle" ? 0.5 / e.freq : 1e-7} ${e.wave === "triangle" ? 0.5 / e.freq : 1e-7} ${e.wave === "triangle" ? 0 : 0.5 / e.freq} ${1 / e.freq})`); break;
        case "D": lines.push(`D${id} ${nd[0]} ${nd[1]} DMOD_${id}`); lines.push(`.model DMOD_${id} D(Is=${e.is} N=${e.n})`); break;
        case "VDIODE": lines.push(`B${id}${e.part || ""} ${nd[0]} ${nd[1]} I=${e.perveance}*pwr(max(V(${nd[0]},${nd[1]}),0),1.5)`); break;
        case "XFMR": {
          const AL = e.lp / Math.pow(e.primaryTurns, 2), names = [];
          e.windings.forEach((w, j) => { const n = `L${id}_${j}`; names.push(n); lines.push(`${n} ${nn(w.a)} ${nn(w.b)} ${AL * w.turns * w.turns}`); });
          lines.push(`K${id} ${names.join(" ")} ${e.k}`);
          break;
        }
        case "TRIODE": {
          const m = e.model, name = `TRIODE_${(S.comps.find(c => c.id === e.id) || {}).params.tube.replace(/[^A-Za-z0-9]/g, "_")}`;
          if (!models.has(name)) { const x = TubeSimEngine.Spice.triode(m); models.add(name); lines.push(`.subckt ${name} A G K`, `Bp A K I=${x.plate}`, `Bg G K I=${x.grid}`, `.ends`); }
          lines.push(`X${id} ${nd.join(" ")} ${name}`); break;
        }
        case "PENTODE": {
          const m = e.model, name = `PENTODE_${(S.comps.find(c => c.id === e.id) || {}).params.tube.replace(/[^A-Za-z0-9]/g, "_")}`;
          if (!models.has(name)) { const x = TubeSimEngine.Spice.pentode(m); models.add(name); lines.push(`.subckt ${name} A G1 G2 K`, `Bp A K I=${x.plate}`, `Bs G2 K I=${x.screen}`, `Bg G1 K I=${x.grid}`, `.ends`); }
          lines.push(`X${id} ${nd.join(" ")} ${name}`); break;
        }
      }
      k++;
    });
    const f = signalFreq() || 1000;
    lines.push(`.tran 0 ${(20 / f).toPrecision(3)} ${(10 / f).toPrecision(3)} ${(1 / f / 200).toPrecision(3)}`, ".end");
    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function bind(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); }
  function init() {
    canvas = document.getElementById("cad");
    ctx = canvas.getContext("2d");
    dpr = window.devicePixelRatio || 1;
    canvas.tabIndex = 0;
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", render);

    buildPalette();
    // File menu
    const menu = document.getElementById("file-menu"), menuList = menu.querySelector(".menu-list"), menuBtn = document.getElementById("btn-file");
    const closeMenu = () => { menuList.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); };
    menuBtn.addEventListener("click", e => { e.stopPropagation(); menuList.hidden = !menuList.hidden; menuBtn.setAttribute("aria-expanded", String(!menuList.hidden)); });
    menuList.addEventListener("click", closeMenu);
    document.addEventListener("click", e => { if (!menu.contains(e.target)) closeMenu(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
    bind("btn-new", newSheet);
    bind("btn-pdf", () => exportPDF());
    // New dialog: format and orientation of the drawing frame
    const pickSeg = id => { const host = document.getElementById(id); host.querySelectorAll(".btn").forEach(b => b.addEventListener("click", () => host.querySelectorAll(".btn").forEach(x => x.classList.toggle("active", x === b)))); return () => host.querySelector(".btn.active").dataset.v; };
    const newSize = pickSeg("new-size"), newOrient = pickSeg("new-orient");
    document.getElementById("new-title").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("btn-new-create").click(); });
    bind("btn-new-cancel", () => { document.getElementById("new-modal").hidden = true; });
    bind("btn-new-create", () => { document.getElementById("new-modal").hidden = true; newCircuit({ size: newSize(), orient: newOrient(), title: document.getElementById("new-title").value.trim() }); document.getElementById("new-title").value = ""; });
    bind("btn-open", () => document.getElementById("file-input").click());
    document.getElementById("file-input").addEventListener("change", e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ""; });
    bind("btn-save", saveFile);
    bind("btn-undo", undo); bind("btn-redo", redo);
    bind("btn-tool-select", () => { S.placing = null; setTool("select"); });
    bind("btn-tool-wire", () => { S.placing = null; setTool(S.tool === "wire" ? "select" : "wire"); });
    bind("btn-rotate", rotateSelection); bind("btn-delete", deleteSelection);
    bind("btn-zoom-in", () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.25));
    bind("btn-zoom-out", () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 0.8));
    bind("btn-zoom-fit", fitView);
    bind("btn-live", () => setLive(!S.sim.live));
    bind("btn-sim", () => { if (S.sim.busy && S.sim.mode === "full") { cancelRun(); setStatus("idle", "Stopped"); } else runSim("full"); });
    document.getElementById("btn-live").classList.toggle("active", S.sim.live);
    bind("btn-volts", () => { S.showVolts = !S.showVolts; document.getElementById("btn-volts").classList.toggle("active", S.showVolts); render(); });
    bind("btn-spice", () => { document.getElementById("spice-text").value = spiceNetlist(); document.getElementById("spice-modal").hidden = false; });
    bind("btn-spice-close", () => { document.getElementById("spice-modal").hidden = true; });
    bind("btn-spice-copy", () => { const t = document.getElementById("spice-text"); t.select(); try { navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand("copy"); } });
    bind("btn-spice-download", () => { const blob = new Blob([document.getElementById("spice-text").value], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tube-circuit.cir"; a.click(); });
    bind("btn-open-tracer", () => ToolWindows.open("index.html"));
    bind("btn-open-scope", () => { const sc = S.comps.find(c => c.type === "scope"); ToolWindows.open("oscilloscope.html", sc ? { scope: sc.id } : null); });
    bind("btn-open-spectrum", () => { const sc = S.comps.find(c => c.type === "scope"); ToolWindows.open("spectrum_analyzer.html", sc ? { scope: sc.id } : null); });

    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (saved) { try { const d = JSON.parse(saved); S.comps = (d.comps || []).filter(c => LIB[c.type]); S.wires = d.wires || []; } catch (e) {} }
    else S.comps = [makeComp("frame", { size: "A3", orient: "landscape", date: new Date().toISOString().slice(0, 10) }, 0, 0, 0)];   // first visit: an A3 sheet
    S.history = [snapshot()]; S.hIndex = 0;
    S.topo = null;
    setTool("select");
    updateInspector();
    requestAnimationFrame(() => { fitView(); scheduleSim(0); });
  }

  // Exposed for tests and the other windows
  window.TubeCAD = { state: S, runOptions: RUN_OPTIONS, newCircuit, exportPDF, saveFile, renumber, desig, runTransient, stopTransient, commit, setSwitch, setLive, undo, redo, fitView, buildNetlist, topo: () => topo(), makeComp, compPins, addSegment, lRoute, runSim, spiceNetlist, buildSummary, tubeData, normalizeWires };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
