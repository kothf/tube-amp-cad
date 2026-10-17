/* =============================================================================
   TUBE AMP CAD — schematic editor + live simulation
   Depends on: tube-db.js, sim-engine.js, cad-components.js
   ============================================================================= */
(function () {
  "use strict";
  const { LIB, DRAW, COL, PALETTE, parseEng, fmtEng, tubeByName, tubeKind } = CadLib;
  const GRID = 10;
  const STORAGE_KEY = "tubecad_circuit_v2";
  const FILE_KEY = "tubecad_file_v1";        // the open file's name and whether it had unsaved changes (for a reload)
  let clean = null;                          // the circuit and board as last opened or saved (showFile)
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
    showAmps: true,
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
  // Mirror: any part that can be rotated can also be flipped left to right (params.flip),
  // applied before the rotation. Parts added to the library get it automatically; a part
  // that does not rotate mirrors when its definition says so (mirror: true, the oscilloscope).
  const canMirror = type => !!LIB[type] && (!LIB[type].noRotate || !!LIB[type].mirror);
  const flipX = c => (c.params && c.params.flip === "yes" && canMirror(c.type) ? -1 : 1);
  function compPins(c) {
    const f = flipX(c);
    return LIB[c.type].pins(c).map(p => {
      const [x, y] = rotPt(f * p.x, p.y, c.rot);
      return { id: p.id, name: p.name, x: c.x + x, y: c.y + y };
    });
  }
  function compBBox(c) {
    let b = typeof LIB[c.type].bbox === "function" ? LIB[c.type].bbox(c) : LIB[c.type].bbox;
    if (flipX(c) < 0) b = [-b[2], b[1], -b[0], b[3]];
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
    // sheet connectors with the same signal name are one net (as if wired)
    const byName = new Map();
    S.comps.forEach(c => { if (c.type !== "offsheet") return; const n = connName(c); if (!n) return; const r = find(key(c.x, c.y)); if (byName.has(n)) union(r, byName.get(n)); else byName.set(n, r); });
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
  const connName = c => String(c.params.name || "").trim().toUpperCase();

  // ---------------------------------------------------------------------------
  // Sheets: every drawing frame is a sheet, numbered left to right, then top to bottom
  // ---------------------------------------------------------------------------
  function frames() { return S.comps.filter(c => c.type === "frame").sort((a, b) => (a.y - b.y > 200 ? 1 : b.y - a.y > 200 ? -1 : a.x - b.x)); }
  // the sheet number shown in a frame: its "Sheet" field ("2/3" -> 2), else its position
  function sheetNo(f, list) { const m = /^\s*(\d+)/.exec(f.params.sheet || ""); return m ? m[1] : String((list || frames()).indexOf(f) + 1); }
  // keep automatic sheet fields ("1/1", "2/3", empty) numbered as frames are added or removed
  function numberSheets() {
    const list = frames();
    if (list.every(f => !f.params.sheet || /^\d+\/\d+$/.test(f.params.sheet))) list.forEach((f, i) => { f.params.sheet = `${i + 1}/${list.length}`; });
  }
  // sheet and reference-grid zone of a point, e.g. "2/B7" (IEC 61082-1 cross-reference)
  function zoneOf(x, y) {
    const list = frames();
    for (const f of list) {
      const g = CadLib.sheetGeom(f), lx = x - f.x, ly = y - f.y;
      if (lx < 0 || ly < 0 || lx > g.W || ly > g.H) continue;
      const col = Math.min(g.cols, Math.max(1, Math.floor((lx - g.fx1) / ((g.fx2 - g.fx1) / g.cols)) + 1));
      const row = Math.min(g.rows, Math.max(1, Math.floor((ly - g.fy1) / ((g.fy2 - g.fy1) / g.rows)) + 1));
      return { frame: f, text: (list.length > 1 ? sheetNo(f, list) + "/" : "") + "ABCDEFGHJKLMNPRSTUVWXYZ"[row - 1] + col };
    }
    return null;
  }
  // a supply rail: a connector name used this often reads as a rail (B+, GND …); its connectors
  // show no zone list, which would repeat every place it is used on every one of them
  const RAIL_CONNECTORS = 5;
  const isRail = c => { const n = connName(c); return !!n && S.comps.filter(k => k.type === "offsheet" && connName(k) === n).length >= RAIL_CONNECTORS; };
  // zone references written short: one row letter per group, its columns after it
  // ("B2, A3, A5, B5, B8" → "A3,5 B2,5,8"; on several sheets "2/A3,5")
  function refText(refs) {
    const groups = new Map();
    refs.forEach(t => { const m = /^(?:(\d+)\/)?([A-Z])(\d+)$/.exec(t); const k = m ? `${m[1] || ""}|${m[2]}` : `|${t}`; if (!groups.has(k)) groups.set(k, []); if (m) groups.get(k).push(+m[3]); });
    return [...groups.entries()].sort(([a], [b]) => { const [sa, ra] = a.split("|"), [sb, rb] = b.split("|"); return (+sa || 0) - (+sb || 0) || ra.localeCompare(rb); })
      .map(([k, cols]) => { const [sh, row] = k.split("|"); return (sh ? sh + "/" : "") + row + cols.sort((a, b) => a - b).join(","); }).join(" ");
  }
  // where the partners of a sheet connector are
  function connRefs(c) {
    const n = connName(c);
    return S.comps.filter(k => k !== c && k.type === "offsheet" && connName(k) === n).map(k => (zoneOf(k.x, k.y) || {}).text).filter(Boolean)
      .filter((t, i, a) => a.indexOf(t) === i);
  }

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
    numberSheets();
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
    scheduleBoardNetlist();
    updateSheetNav();
    if (S.trans && !S.trans.stale && !S.trans.running) { S.trans.stale = true; if (channel) channel.postMessage(transientMessage()); }
    try { localStorage.setItem(STORAGE_KEY, snapshot()); } catch (e) {}
    showFile();
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
    const c = { id: newId("c"), type, x: snap(x), y: snap(y), rot: def.noRotate ? 0 : (rot || 0), params: Object.assign({}, def.defaults, def.newDefaults || {}, params || {}) };
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
  function startWorker() { try { worker = new Worker("sim-worker.js" + VERSION); worker.onmessage = e => { if (e.data.result) onSimResult(e.data); else onSimProgress(e.data); }; } catch (e) { worker = null; } }
  startWorker();
  // "live" runs after every edit within a short time budget; "full" runs until
  // the periodic steady state is reached (slow supplies need seconds of solver time)
  const RUN_OPTIONS = { live: { budgetMs: 2500 }, full: { budgetMs: 120000, maxPeriods: 20000 } };
  const LIVE_KEY = "tubecad_live", LEGEND_KEY = "tubecad_legend";
  S.showLegend = (() => { try { return localStorage.getItem(LEGEND_KEY) !== "0"; } catch (e) { return true; } })();
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
  // ▶ Simulate shows how far a run has got: a bar along its bottom edge and the percentage
  // (■ Stop 48 % while a full run can be stopped)
  function simButton() {
    const b = document.getElementById("btn-sim"); if (!b) return;
    const stop = S.sim.busy && S.sim.mode === "full", pct = Math.floor((S.sim.progress || 0) * 100);
    b.textContent = stop ? `■ Stop · ${pct} %` : S.sim.busy ? `▶ Simulate · ${pct} %` : "▶ Simulate";
    b.classList.toggle("active", stop);
    b.classList.toggle("progress", S.sim.busy);
    b.style.setProperty("--progress", (S.sim.busy ? pct : 0) + "%");
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
    simBusy(mode === "full" ? "Simulating until settled…" : "Simulating…");
    simButton();
    if (worker) worker.postMessage({ seq, netlist, options: RUN_OPTIONS[mode] });
    else setTimeout(() => onSimResult({ seq, result: TubeSimEngine.simulate(netlist, RUN_OPTIONS[mode]) }), 0);
  }
  // the busy text of the running steady-state simulation, with its readiness in percent
  function simBusy(text) { S.sim.busyText = text; S.sim.progress = 0; showBusy(); updatePct(); simButton(); }
  // the status while simulations run: the steady state and the power-on transient may run at once,
  // so both share one line and one bar (the lower readiness), instead of taking turns at it
  function showBusy() {
    const jobs = [];
    if (S.sim.busy) jobs.push([S.sim.busyText.replace(/…$/, ""), S.sim.progress || 0]);
    if (S.trans && S.trans.running) jobs.push([`Power-on transient, first ${fmtEng(S.trans.tStop, "s")}`, S.trans.progress || 0]);
    if (S.bias && S.bias.job) jobs.push(["Finding bias resistors", S.bias.job.progress || 0]);
    if (!jobs.length) return false;
    setStatus("busy", jobs.map(([t, p]) => `${t}: ${Math.floor(p * 100)} %`).join(" · "), Math.min(...jobs.map(j => j[1])));
    return true;
  }
  function onSimProgress({ seq, progress }) {
    if (seq !== S.sim.seq || !S.sim.busy) return;
    S.sim.progress = progress;
    showBusy();
    updatePct();
    simButton();
  }
  // the inspector's Operating point and Checks headings carry the readiness while a run is
  // going: the values and warnings under them come from an unfinished simulation
  const simPct = () => S.sim.busy
    ? ` <span class="sim-pct" title="Simulation still running: these values and checks may still change">${Math.floor((S.sim.progress || 0) * 100)} %</span>` : "";
  function updatePct() {
    const els = document.querySelectorAll("#inspector .sim-pct");
    if (!els.length) { if (S.sim.busy) updateInspector(true); return; }
    els.forEach(e => { e.textContent = Math.floor((S.sim.progress || 0) * 100) + " %"; });
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
      detectBias();
      if (result.ok) {
        const tr = result.tran;
        const what = tr && tr.fBase ? `${fmtEng(tr.samples * tr.dt, "s")} window, ${tr.periods} cycles to settle` : "DC operating point";
        const took = result.elapsedMs >= 1000 ? (result.elapsedMs / 1000).toFixed(1) + " s" : result.elapsedMs + " ms";
        // a quick live run that ran out of time continues as a full run in the background
        const more = tr && !tr.settled && S.sim.mode === "live" && S.sim.live && !S.sim.pending;
        if (more) S.sim.warnings = S.sim.warnings.filter(w => !/^Not fully settled/.test(w));
        if (!(S.trans && S.trans.running && showBusy()))   // the power-on transient still runs: its progress stays on the line
          setStatus(S.sim.warnings.length ? "warn" : "ok", `Simulated in ${took} · ${what}` + (result.dcAveraged ? " · DC values averaged over the window" : "") + (S.sim.warnings.length ? " · " + S.sim.warnings[0] : ""));
        if (more) { broadcast(); updateInspector(true); render(); runSim("full"); simBusy("Preliminary result shown · settling fully…"); return; }
      } else setStatus("error", result.error);
      if (result.ok) runBias();
      broadcast();
      updateInspector(true);
      render();
    }
    if (S.sim.pending) { S.sim.pending = false; runSim(); }
  }

  // Node voltage helpers on the last result
  function netDC(net) { const r = S.sim.result; return r && net !== undefined && r.dc.nodes[net] !== undefined ? r.dc.nodes[net] : null; }
  // AC on a net over the captured cycles: rms of the wave about its mean (null below 1 mV).
  // signal: the AC is a real part of the node (≥ 1 % of its DC), not just a rail's ripple
  let acCache = null;
  // three significant figures: 20.1, 353m, 1.25
  const acDigits = v => { const m = v / Math.pow(1000, Math.floor(Math.log10(v) / 3)); return m >= 99.95 ? 0 : m >= 9.995 ? 1 : 2; };
  function netAC(net) {
    const r = S.sim.result; if (!r || !r.tran || !(net > 0)) return null;
    if (!acCache || acCache.r !== r) acCache = { r, m: new Map() };
    if (acCache.m.has(net)) return acCache.m.get(net);
    const st = stats(netWave(net)), dc = netDC(net);
    const ac = st && st.rmsAC >= 1e-3 ? { rms: st.rmsAC, pp: st.pp, signal: st.rmsAC >= 0.01 * Math.abs(dc || 0) } : null;
    acCache.m.set(net, ac); return ac;
  }
  function netWave(net) { const r = S.sim.result; return r && r.tran && net !== undefined && net > 0 ? r.tran.nodes[net] : null; }
  function pinNetOf(c, pid) { const T = S.sim.topo || topo(); return T.pinNet.get(c.id + ":" + pid); }
  // DC current flowing from the net into each part's pin ("compId:pinId" -> A), summed
  // from the solver elements' terminal currents (averaged over the window when the DC
  // readouts are). A part with two pins on one net leaves them out: the split is unknown.
  function pinCurrents() {
    const r = S.sim.result;
    if (!r || !r.dc.currents) return null;
    if (S.sim.pinI && S.sim.pinI.result === r) return S.sim.pinI.map;
    const T = S.sim.topo || topo(), byComp = new Map(), cur = r.dc.currents;
    for (let k = 0; k < cur.length; k += 3) {
      const id = String(cur[k]), h = id.indexOf("#"), cid = h < 0 ? id : id.slice(0, h);
      let m = byComp.get(cid); if (!m) byComp.set(cid, m = new Map());
      m.set(cur[k + 1], (m.get(cur[k + 1]) || 0) + cur[k + 2]);
    }
    const map = new Map();
    S.comps.forEach(c => {
      const m = byComp.get(c.id); if (!m) return;
      const pins = compPins(c), nets = pins.map(p => T.pinNet.get(c.id + ":" + p.id));
      pins.forEach((p, i) => { if (nets[i] !== undefined && nets.indexOf(nets[i]) === i && nets.lastIndexOf(nets[i]) === i) map.set(c.id + ":" + p.id, m.get(nets[i]) || 0); });
    });
    S.sim.pinI = { result: r, map };
    return map;
  }
  function pinCurrent(c, pid) { const m = pinCurrents(), v = m && m.get(c.id + ":" + pid); return v === undefined ? null : v; }
  // DC current in each wire segment (wire id -> A, positive from (x1,y1) to (x2,y2)).
  // In the wiring of a net, a loose end whose pins draw a known current passes it on to
  // the next point, and so on inwards; segments stay unknown only in loops or between
  // points with an unknown current (ground symbols, sheet connectors), at most one of which
  // a tree can absorb.
  function wireCurrents() {
    const pins = pinCurrents(); if (!pins) return null;
    const draw = new Map(), hasPin = new Set();   // point -> current drawn from the wiring there (consumed below)
    const free = new Set();
    S.comps.forEach(c => compPins(c).forEach(p => {
      const k = key(p.x, p.y), v = pins.get(c.id + ":" + p.id);
      hasPin.add(k);
      if (v === undefined) free.add(k); else draw.set(k, (draw.get(k) || 0) + v);
    }));
    const adj = new Map();
    const link = (k, w, other) => { if (!adj.has(k)) adj.set(k, []); adj.get(k).push({ w, other }); };
    S.wires.forEach(w => { const a = key(w.x1, w.y1), b = key(w.x2, w.y2); link(a, w, b); link(b, w, a); });
    const deg = new Map(), out = new Map();
    adj.forEach((l, k) => deg.set(k, l.length));
    const queue = [...adj.keys()].filter(k => deg.get(k) === 1);
    while (queue.length) {
      const k = queue.pop();
      if (deg.get(k) !== 1 || free.has(k)) continue;
      const e = adj.get(k).find(e => !out.has(e.w.id)); if (!e) continue;
      const i = draw.get(k) || 0;                   // flows along the segment towards k
      out.set(e.w.id, key(e.w.x2, e.w.y2) === k ? i : -i);
      deg.set(k, 0);
      draw.set(e.other, (draw.get(e.other) || 0) + i);
      deg.set(e.other, deg.get(e.other) - 1);
      if (deg.get(e.other) === 1) queue.push(e.other);
    }
    // what the pins draw at each point, for the stickers
    const pinDraw = new Map();
    S.comps.forEach(c => compPins(c).forEach(p => { const v = pins.get(c.id + ":" + p.id), k = key(p.x, p.y); pinDraw.set(k, v === undefined ? NaN : (pinDraw.get(k) || 0) + v); }));
    return { currents: out, adj, pinDraw };
  }

  // DC current in a catalog output transformer's primary (from the drop across its DCR)
  function otDcCurrent(c) {
    const m = CadLib.OUTPUT_TX[c.params.model], va = netDC(pinNetOf(c, "P1")), vb = netDC(pinNetOf(c, "P2"));
    return !m || va === null || vb === null ? null : (va - vb) / m.rp;
  }
  // average power in a resistor: from the steady-state waveform when there is one, else DC
  function resistorPower(c) {
    const wa = waveOf(c, "1"), wb = waveOf(c, "2");
    if (wa && wb) { let s = 0; for (let i = 0; i < wa.length; i++) { const v = wa[i] - wb[i]; s += v * v; } return s / wa.length / c.params.r; }
    const va = netDC(pinNetOf(c, "1")), vb = netDC(pinNetOf(c, "2"));
    return va === null || vb === null ? null : (va - vb) * (va - vb) / c.params.r;
  }
  function waveOf(c, pid) {
    const n = pinNetOf(c, pid), r = S.sim.result;
    if (!r || !r.tran) return null;
    if (n === 0) return new Float32Array(r.tran.samples);
    return r.tran.nodes[n] || null;
  }
  // a speaker's voltage and current over the captured cycle: the current through Re for the
  // Thiele–Small model (its inner node), V/R for the resistor
  function speakerWave(c) {
    const a = waveOf(c, "+"), b = waveOf(c, "-"), r = S.sim.result;
    if (!a || !b) return null;
    const n = a.length, v = new Float32Array(n), i = new Float32Array(n);
    let inner = null;
    if (c.params.model === "ts") { const e = buildNetlist().elements.find(x => x.id === c.id + "#re"); inner = e && r.tran.nodes[e.nodes[1]]; }
    const re = c.params.model === "ts" ? CadLib.speakerTS(c.params).re : Math.max(c.params.r, 0.1);
    for (let k = 0; k < n; k++) { v[k] = a[k] - b[k]; i[k] = inner ? (a[k] - inner[k]) / re : v[k] / re; }
    return { v, i };
  }
  function speakerPower(c) {
    const w = speakerWave(c); if (!w) return null;
    let p = 0, vv = 0; for (let k = 0; k < w.v.length; k++) { p += w.v[k] * w.i[k]; vv += w.v[k] * w.v[k]; }
    return { p: p / w.v.length, vrms: Math.sqrt(vv / w.v.length) };
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

  // the load line for the curve tracer: the last whole cycle of the signal. The capture holds
  // many cycles (a whole number of mains periods), and with a rectified supply the ripple moves
  // each one a little; drawn together they smear into a band
  function oneCycle(t) {
    const f = signalFreq(), n = t.vak.length, per = f && t.dt ? Math.round(1 / (f * t.dt)) : 0;
    const cut = a => (a && per > 4 && per < n ? a.subarray(n - per - 1) : a);
    return { vak: decimate(cut(t.vak), 600), vgk: decimate(cut(t.vgk), 600), vg2k: decimate(cut(t.vg2k), 600), ia: decimate(cut(t.ia), 600) };
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
    const d = { kind: conn, tube: t.commonName, label: c.label, id: c.id, dc: dev.main, paMax: t.paMax, vaMax: t.vaMax, model: conn === "pentode" ? t.koren.Pentode : t.koren.Triode || t.koren.Pentode };
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

  // A tube's ratings beyond Va and Pa (tube-db.js t.limits): screen voltage and dissipation,
  // cathode current, heater-to-cathode voltage, grid circuit resistance, a rectifier's peak
  // inverse voltage and rectified current. Each: { label, value (text), share of the rating, text
  // for the checks }. Averages over the signal cycle where there is one; Vhk and the peak inverse
  // voltage at their worst instant. The heater is at its DC potential (the tube's Heater DC
  // potential, 0 V: grounded or a grounded centre tap).
  function tubeLimits(c) {
    const r = S.sim.result, t = tubeByName(c.params.tube);
    if (!r || !t || !t.limits || !r.dc.devices[c.id]) return [];
    const L = t.limits, out = [], mean = a => { let s = 0; const n = Math.max(a.length - 1, 1); for (let i = 0; i < n; i++) s += a[i]; return s / n; };
    // say(value, rating): the sentence for the checks
    const add = (label, v, lim, unit, say) => {
      if (!(lim > 0) || v === null || !isFinite(v)) return;
      const f = x => fmtEng(x, unit);
      out.push({ key: label.split(" ")[0], label, value: f(v), lim: f(lim), share: v / lim, text: `${c.label} ${say(f(v), f(lim))}.` });
    };
    const kWave = waveOf(c, "K"), vk = netDC(pinNetOf(c, "K")), vh = +c.params.heaterV || 0;
    // heater to cathode: the worse of the two directions, each against its own rating
    const vhk = () => {
      if (t.directlyHeated || vk === null) return;
      const s = kWave ? stats(kWave) : { min: vk, max: vk }, up = s.max - vh, down = vh - s.min;
      const neg = L.vhkNeg || L.vhk, pos = L.vhk;
      const a = up > 0 && neg ? up / neg : 0, b = down > 0 && pos ? down / pos : 0;
      if (a >= b && a > 0) add("Vhk (cathode above heater)", up, neg, "V", (v, m) => `has its cathode ${v} above the heater, more than the ${m} allowed`);
      else if (b > 0) add("Vhk (heater above cathode)", down, pos, "V", (v, m) => `has its heater ${v} above the cathode, more than the ${m} allowed`);
    };
    if (tubeKind(t) === "rectifier") {
      const dev = r.dc.devices[c.id], tr = r.tran && r.tran.devices;
      const ia = (x, part) => (tr && tr[c.id + "#" + part] ? mean(tr[c.id + "#" + part].i) : x ? x.i : 0);
      add("Rectified current", ia(dev.a1, "a1") + ia(dev.a2, "a2"), t.ikMax / 1000, "A", (v, m) => `delivers ${v} on average, more than its ${m} rating`);
      // each anode's peak, while the reservoir capacitor charges, against the book's peak anode current (settled cycles, not the switch-on surge)
      const ipk = t.book && t.book.limits && t.book.limits.i_peak_ma;
      if (tr && ipk) {
        const pk = Math.max(...["a1", "a2"].map(p => { const w = tr[c.id + "#" + p]; let m = 0; if (w) for (const x of w.i) m = Math.max(m, x); return m; }));
        add("Peak anode current", pk, ipk / 1000, "A", (v, m) => `pulls ${v} peak through an anode while the reservoir capacitor charges, more than its ${m} rating`);
      }
      if (kWave) {
        let piv = 0;
        ["A1", "A2"].forEach(p => { const w = pinNetOf(c, p) !== undefined && waveOf(c, p); if (w) for (let i = 0; i < w.length; i++) piv = Math.max(piv, kWave[i] - w[i]); });
        add("Peak inverse voltage", piv, L.piv, "V", (v, m) => `sees ${v} peak inverse voltage, more than its ${m} rating`);
      }
      vhk();
      return out;
    }
    const d = tubeData(c); if (!d || !d.dc) return [];
    const tr = r.tran && r.tran.devices[c.id], dc = d.dc;
    if (d.kind === "pentode") {
      add("Vg2k (screen)", dc.vg2k, L.vg2, "V", (v, m) => `has its screen at ${v}, more than its ${m} rating`);
      const G2 = waveOf(c, "G2");
      let pg2 = dc.vg2k * dc.ig2;
      if (tr && tr.ig2 && G2 && kWave) { let s = 0; const n = Math.max(tr.ig2.length - 1, 1); for (let i = 0; i < n; i++) s += (G2[i] - kWave[i]) * tr.ig2[i]; pg2 = s / n; }
      add("Pg2 (screen dissipation)", pg2, L.pg2, "W", (v, m) => `screen dissipates ${v} (average), more than its ${m} Pg2 max`);
    }
    const ik = (tr ? mean(tr.i) + (tr.ig2 ? mean(tr.ig2) : 0) : dc.ia + (dc.ig2 || 0)) + (dc.ig || 0);
    add("Ik (cathode current)", ik, t.ikMax / 1000, "A", (v, m) => `draws ${v} cathode current, more than its ${m} rating`);
    vhk();
    const b = S.bias.tubes.get(c.id), fixed = b && (b.kind === "fixed" || b.fixed), rgLim = fixed ? L.rgFixed || L.rg : L.rg;
    if (b && isFinite(b.rg) && b.rg > 0) add(`Grid circuit R (${fixed ? "fixed" : "cathode"} bias)`, b.rg, rgLim, "Ω", (v, m) => `has ${v} in its grid circuit, more than the ${m} allowed with ${fixed ? "fixed" : "cathode"} bias (the tube can run away as it warms)`);
    return out;
  }
  function limitRows(c) {
    return tubeLimits(c).filter(o => o.key !== "Vg2k").map(o => kv(o.label, `${o.value} · ${Math.round(o.share * 100)}% of ${o.lim}`, o.share > 1 ? "bad" : o.share > 0.85 ? "warn" : "")).join("");
  }

  // ---------------------------------------------------------------------------
  // Bias finder (bias.js). Every result marks the parts that set each tube's bias, drawn in
  // their own colour. For tubes with a target anode current, a worker of its own simulates
  // again with the signal off and finds the value; it is written beside the part.
  // ---------------------------------------------------------------------------
  const BIAS_COL = "#d2a8ff";
  const RATINGS = [0.125, 0.25, 0.5, 1, 2, 3, 5, 10, 20];
  S.bias = { show: true, parts: new Map(), tubes: new Map(), job: null, result: null, key: null, seq: 0 };
  let bWorker = null;
  const compById = id => S.comps.find(c => c.id === id);
  const labelOf = id => { const c = compById(id); return c ? desig(c) : id; };
  function detectBias() {
    S.bias.parts = new Map(); S.bias.tubes = new Map();
    const r = S.sim.result;
    if (!r || !window.TubeBias || !S.sim.netlist) return;
    TubeBias.detect(S.sim.netlist, r.dc).forEach(d => {
      S.bias.tubes.set(d.tube, d);
      if (!d.part) return;
      if (!S.bias.parts.has(d.part)) S.bias.parts.set(d.part, { kind: d.kind, type: d.type, tubes: [] });
      S.bias.parts.get(d.part).tubes.push(d.tube);
    });
  }
  const paMaxOf = c => { const t = tubeByName(c.params.tube); return t ? t.paMax : 0; };
  // each tube's target for the bias finder: an anode current, or a share of Pa max (as watts); and
  // what was measured on the amp: the anode or cathode current, or the voltage across a resistor
  function biasTargets() {
    const out = [];
    S.comps.forEach(c => {
      if (c.type !== "tube") return;
      const by = CadLib.biasBy(c), t = { tube: c.id };
      if (by === "ia" && c.params.biasIa > 0) t.ia = +c.params.biasIa;
      else if (by === "pa" && c.params.biasPa > 0 && paMaxOf(c) > 0) t.pa = c.params.biasPa / 100 * paMaxOf(c);
      else return;
      const mb = CadLib.biasMeasBy(c);
      if ((mb === "ia" || mb === "ik") && c.params.biasMeas > 0) t.measured = { kind: mb, value: +c.params.biasMeas };
      else if (/^r:/.test(mb) && c.params.biasMeasV > 0 && compById(mb.slice(2))) t.measured = { kind: "v", part: mb.slice(2), value: +c.params.biasMeasV };
      out.push(t);
    });
    return out;
  }
  // the anode current the simulation shows now (prefills an anode current bias target)
  LIB.tube.simIa = c => { const d = S.sim.result && tubeData(c); return d && d.dc && d.dc.ia > 0 ? d.dc.ia : 0; };
  // the resistors on a tube's cathode, to measure the voltage across (a 1 Ω sense resistor, Rk)
  LIB.tube.senseOptions = c => {
    const T = topo(), k = T.pinNet.get(c.id + ":K");
    if (k === undefined) return [];
    return S.comps.filter(r => r.type === "resistor" && compPins(r).some(p => T.pinNet.get(r.id + ":" + p.id) === k))
      .map(r => ["r:" + r.id, `Voltage across ${desig(r)} (${fmtEng(r.params.r, "Ω")})`]);
  };
  function stopBias() { if (bWorker) { bWorker.terminate(); bWorker = null; } S.bias.job = null; }
  function runBias() {
    const targets = biasTargets(), netlist = S.sim.netlist;
    if (!targets.length || !netlist || !S.sim.result || !window.TubeBias) { stopBias(); S.bias.result = null; S.bias.key = null; return; }
    const quiet = new Set(S.comps.filter(c => c.type === "siggen").map(c => c.id));
    // the signal level does not move the bias: a new level alone does not start a new search
    const key = JSON.stringify([netlist.elements.map(e => (quiet.has(e.id) ? Object.assign({}, e, { amp: 0 }) : e)), targets]);
    if (key === S.bias.key) return;
    stopBias();
    S.bias.key = key; S.bias.result = null;
    const seq = ++S.bias.seq;
    S.bias.job = { seq, progress: 0 };
    const options = { quiet: [...quiet], budgetMs: 20000 };
    const done = res => {
      if (S.bias.seq !== seq || !S.bias.job) return;
      bWorker = null; S.bias.job = null; S.bias.result = res;
      if (!showBusy()) {
        if (!res.ok) setStatus("error", "Bias finder: " + res.error);
        else {
          const hot = overPa(res);
          setStatus(hot.length || res.parts.some(p => !p.reached) ? "warn" : "ok", `Bias found in ${(res.elapsedMs / 1000).toFixed(1)} s (${res.runs} runs, signal off): ` +
            (res.parts.length ? res.parts.map(p => `${labelOf(p.part)} → ${biasValueText(p)}`).join(" · ") : "no bias part for the tubes with a target") +
            res.parts.filter(p => !p.reached).map(p => ` · ⚠ ${labelOf(p.part)}: target not reached`).join("") +
            hot.map(h => ` · ⚠ ${desig(h.c)} ${fmtEng(h.pa, "W", 2)} at idle, over its ${h.m} W`).join(""));
        }
      }
      updateInspector(true); render();
    };
    try { bWorker = new Worker("sim-worker.js" + VERSION); } catch (e) { bWorker = null; }
    if (!bWorker) { setTimeout(() => done(TubeBias.solve(netlist, targets, options)), 0); return; }
    bWorker.onmessage = e => {
      const d = e.data;
      if (d.seq !== seq || !S.bias.job) return;
      if (d.result) done(d.result);
      else { S.bias.job.progress = d.progress; showBusy(); updatePct(); }
    };
    bWorker.postMessage({ seq, netlist, options, kind: "bias", targets });
    showBusy();
  }
  const biasFor = id => (S.bias.result && S.bias.result.ok ? S.bias.result.parts.find(p => p.part === id) || null : null);
  // a pot's wiper setting (its knob, 0…1) for the share of the track between pin 1 and the wiper
  function potPos(c, f) { return c && c.params.taper === "log" ? Math.log10(99 * f + 1) / 2 : f; }
  function biasValueText(p) {
    if (!p.reached && /out of reach|travel/.test(p.note || "")) return "out of range";
    return p.type === "pot" ? Math.round(potPos(compById(p.part), p.fraction) * 100) + "%" : fmtEng(p.e24, "Ω");
  }
  const ratingFor = pw => RATINGS.find(w => w >= 2 * pw) || RATINGS[RATINGS.length - 1];
  const biasKind = k => (k === "fixed" ? "fixed bias (grid)" : "cathode bias");
  const pct = () => (S.bias.job ? ` <span class="sim-pct">${Math.floor(S.bias.job.progress * 100)} %</span>` : "");
  // a tube's target as written: "35mA", or "5.6W (70 % of Pa max)"
  function targetText(t, c) {
    if (t.ia) return fmtEng(t.ia, "A", 2);
    const m = c ? paMaxOf(c) : 0;
    return fmtEng(t.pa, "W", 2) + (m ? ` (${Math.round(t.pa / m * 100)} % of Pa max)` : "");
  }
  // the anode dissipation at the bias found, against the tube's rating
  function paRow(st, c, label) {
    const m = paMaxOf(c), share = m ? st.pa / m : 0;
    return kv(label || "Pa then", `${fmtEng(st.pa, "W", 2)}${m ? ` · ${Math.round(share * 100)}% of ${m} W` : ""}`, share > 1 ? "bad" : share > 0.85 ? "warn" : "");
  }
  // the tubes the bias found leaves above Pa max (for the status line and the inspectors)
  function overPa(res) {
    const out = [];
    if (res && res.ok) res.parts.forEach(p => p.tubes.forEach((id, k) => { const c = compById(id), m = c && paMaxOf(c); if (m && p.at && p.at[k].pa > m) out.push({ c, pa: p.at[k].pa, m }); }));
    return out;
  }
  // the inspector of a resistor or pot that sets a bias
  function biasPartReadout(c) {
    const d = S.bias.parts.get(c.id);
    if (!d) return "";
    const names = d.tubes.map(labelOf).join(", ");
    let h = `<div class="insp-sub bias">Bias${pct()}</div>`;
    h += `<p class="insp-help">Sets the ${biasKind(d.kind)} of ${names}.</p>`;
    const p = biasFor(c.id);
    if (!p) {
      if (S.bias.job) return h + `<p class="insp-help">Finding the value (simulating with the signal off)…</p>`;
      if (S.bias.result && !S.bias.result.ok) return h + `<p class="insp-help warn">${escH(S.bias.result.error)}</p>`;
      return h + `<p class="insp-help">Give ${names} a bias target to find the value.</p>`;
    }
    const tubes = p.tubes.map(compById), target = p.targets.map((t, k) => targetText(t, tubes[k])).join(" · ");
    const ia = p.ia.map(i => fmtEng(i, "A", 2)).join(" · ");
    if (p.type === "resistor") {
      h += kv("Exact value", fmtEng(p.value, "Ω", 3)) + kv("Nearest E24", fmtEng(p.e24, "Ω"));
      h += kv(`Ia with ${fmtEng(p.e24, "Ω")}`, `${ia} (target ${target})`);
      if (p.power !== undefined) h += kv("Power in it", `${fmtEng(p.power, "W", 2)} · rate ${ratingFor(p.power)} W or more`);
    } else {
      const pos = potPos(c, p.fraction);
      h += kv("Wiper position", `${(pos * 100).toFixed(1)} %`) + kv("Ia there", `${ia} (target ${target})`);
    }
    p.tubes.forEach((id, k) => { if (p.at) h += paRow(p.at[k], tubes[k], p.tubes.length > 1 ? `Pa of ${escH(labelOf(id))}` : "Pa then"); });
    if (p.reached && (p.type === "resistor" ? Math.abs(p.e24 - c.params.r) > 1e-9 * p.e24 : Math.abs(potPos(c, p.fraction) - c.params.pos) > 0.0005))
      h += `<button class="btn wide bias-apply" data-bias-apply="${escH(c.id)}">${p.type === "resistor" ? `Use ${fmtEng(p.e24, "Ω")}` : `Set the wiper to ${(potPos(c, p.fraction) * 100).toFixed(1)} %`}</button>`;
    if (!p.reached) h += `<p class="insp-help warn">${escH(p.note)}.</p>`;
    // a bias pot: its range, whether it covers a fresh set of tubes, and the divider for mid-travel
    if (p.type === "pot") {
      if (p.range) h += kv("Ia over the travel", `${fmtEng(Math.min(...p.range), "A", 2)} … ${fmtEng(Math.max(...p.range), "A", 2)}`);
      if (p.covers) {
        const sp = Math.round(p.spread * 100), ok = p.covers.weak && p.covers.strong;
        h += kv(`Covers tubes ±${sp} %`, ok ? "yes" : "no", ok ? "" : "warn");
        if (!ok) h += `<p class="insp-help warn">${!p.covers.weak ? `A tube ${sp} % weaker cannot reach the target at the end of the travel.` : ""}${!p.covers.weak && !p.covers.strong ? " " : ""}${!p.covers.strong ? `A tube ${sp} % stronger cannot be turned down to it.` : ""}</p>`;
      }
      if (p.mid) {
        const r = compById(p.mid.part);
        h += kv("For mid-travel", `${escH(labelOf(p.mid.part))} ${fmtEng(p.mid.from, "Ω")} → ${fmtEng(p.mid.e24, "Ω")}` + (p.mid.ia ? ` (Ia ${p.mid.ia.map(i => fmtEng(i, "A", 2)).join(" · ")})` : ""), p.mid.reached ? "" : "warn");
        h += `<p class="insp-help">With the target at mid-travel the pot has the most room either way for the next set of tubes.</p>`;
        if (p.mid.reached && r && (Math.abs(r.params.r - p.mid.e24) > 1e-9 * p.mid.e24 || Math.abs(c.params.pos - potPos(c, 0.5)) > 0.0005))
          h += `<button class="btn wide bias-apply" data-bias-mid="${escH(c.id)}">Use ${fmtEng(p.mid.e24, "Ω")} for ${escH(labelOf(p.mid.part))}, wiper to mid-track</button>`;
      }
    }
    return h;
  }
  // the inspector of a tube: what sets its bias, and the value found for its target
  function tubeBiasReadout(c, d) {
    const det = S.bias.tubes.get(c.id);
    if (!det) return "";
    let h = `<div class="insp-sub bias">Bias${pct()}</div>`;
    if (!det.part) return h + kv("Set by", "no resistor") + `<p class="insp-help">${escH(det.reason[0].toUpperCase() + det.reason.slice(1))}.</p>`;
    h += kv("Set by", `${escH(labelOf(det.part))} · ${biasKind(det.kind)}`);
    const target = biasTargets().find(t => t.tube === c.id);
    if (!target) {
      const hint = d && d.dc && d.dc.vak > 1 ? ` For reference, 70 % of Pa max at this Va is ${fmtEng(0.7 * d.paMax / d.dc.vak, "A", 2)}.` : "";
      return h + `<p class="insp-help">Choose a bias target above (an anode current, or a share of Pa max) to find the value of ${escH(labelOf(det.part))}.${hint}</p>`;
    }
    if (target.pa > paMaxOf(c)) h += `<p class="insp-help warn">The target is above the tube's Pa max (${paMaxOf(c)} W).</p>`;
    const p = biasFor(det.part);
    if (!p) return h + (S.bias.job ? `<p class="insp-help">Finding the value (simulating with the signal off)…</p>` : S.bias.result && !S.bias.result.ok ? `<p class="insp-help warn">${escH(S.bias.result.error)}</p>` : "");
    const k = p.tubes.indexOf(c.id), st = p.at[k];
    h += kv("Suggested", `${escH(labelOf(det.part))} → ${biasValueText(p)}`, p.reached ? "" : "warn");
    h += kv("Ia then", fmtEng(st.ia, "A", 2) + (p.tubes.length > 1 ? ` · ${p.tubes.length} tubes share it, set for their average` : ""));
    h += kv("Ik then (cathode)", fmtEng(st.ik, "A", 2));
    h += paRow(st, c);
    if (st.pa > paMaxOf(c)) h += `<p class="insp-help warn">At this bias the anode dissipates more than its Pa max at idle: lower the target.</p>`;
    const sh = S.bias.result.shift && S.bias.result.shift[c.id];
    if (sh !== undefined) h += kv("Grid shift vs model (fitted)", (sh >= 0 ? "+" : "") + fmtEng(sh, "V", 2)) + `<p class="insp-help">Your tube reads what you measured as if its grid were ${fmtEng(Math.abs(sh), "V", 2)} ${sh >= 0 ? "more positive" : "more negative"} than the model's, so the suggestion is for your tube. A large shift can also mean the reading, or the amp, differs from the drawing.</p>`;
    return h;
  }
  function applyBias(id, mid) {
    const c = compById(id), p = biasFor(id);
    if (!c || !p) return;
    if (mid) {
      const r = p.mid && compById(p.mid.part); if (!r) return;
      r.params.r = p.mid.e24; c.params.pos = Math.round(potPos(c, 0.5) * 1000) / 1000;
      commit();
      setStatus("ok", `${desig(r)} set to ${fmtEng(p.mid.e24, "Ω")} and ${desig(c)} to mid-track: the bias target sits at mid-travel`);
      return;
    }
    if (p.type === "resistor") c.params.r = p.e24; else c.params.pos = Math.round(potPos(c, p.fraction) * 1000) / 1000;
    commit();
    setStatus("ok", `${desig(c)} set to ${p.type === "resistor" ? fmtEng(p.e24, "Ω") : (c.params.pos * 100).toFixed(1) + " %"} for the bias`);
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
    // seq: which run this is, so an instrument window can tell it shows the latest
    const summary = { type: "SIM_RESULT", version: VERSION, seq: S.sim.seq, at: Date.now(), selectedTubeId: lastTubeId, ok: !!r, error: S.sim.error, warnings: S.sim.warnings || [], empty: !S.comps.length, fSig: signalFreq(), tubes: [], scopes: [], speakers: [], customTubes: usedCustomTubes() };
    if (!r) return summary;
    summary.elapsedMs = r.elapsedMs;
    S.comps.forEach(c => {
      if (c.type === "tube") {
        const d = tubeData(c);
        if (d && d.kind !== "rectifier") {
          summary.tubes.push({ id: c.id, label: c.label, tube: d.tube, kind: d.kind, model: d.model, paMax: d.paMax, vaMax: d.vaMax, dc: d.dc, metrics: d.metrics || null,
            traj: d.traj ? oneCycle(d.traj) : null });
        }
      } else if (c.type === "scope") {
        const ch = scopeChannels(c);
        if (ch) summary.scopes.push({ id: c.id, label: c.label, dt: ch.dt, ch1: ch.ch1 ? Array.from(ch.ch1) : null, ch2: ch.ch2 ? Array.from(ch.ch2) : null });
      } else if (c.type === "speaker") {
        const sp = speakerPower(c);
        if (sp) summary.speakers.push({ label: c.label, pAvg: sp.p, r: c.params.r });
      }
    });
    return summary;
  }
  // ---------------------------------------------------------------------------
  // Board Design: the board window takes the netlist from here; the CAD keeps the board
  // document with the circuit (file and browser storage). The board window sends its
  // document back (BOARD_SAVE); the CAD stores it without echoing, so nothing loops.
  // ---------------------------------------------------------------------------
  const BOARD_KEY = "tubecad_board_v1";
  S.board = null;
  function boardNetlist() {
    const T = topo(), skip = new Set(["frame", "note", "ground", "offsheet", "scope"]);
    // DC current into each pin from the last result (the board sizes tracks by it)
    const PI = S.sim.result && S.sim.topo === T ? pinCurrents() : null;
    const parts = S.comps.filter(c => !skip.has(c.type)).map(c => ({ id: c.id, type: c.type, label: c.label, params: c.params, x: c.x, y: c.y,
      pins: compPins(c).map(p => { const k = c.id + ":" + p.id, i = PI && PI.get(k); return { id: p.id, name: p.name || p.id, net: T.pinNet.get(k), i: Number.isFinite(i) ? +i.toPrecision(4) : undefined }; }) }));
    const names = {};
    if (T.hasGround) names[0] = "GND";
    S.comps.forEach(c => { if (c.type === "offsheet" && String(c.params.name || "").trim()) { const n = T.pinNet.get(c.id + ":1"); if (n !== 0) names[n] = String(c.params.name).trim(); } });
    // DC level per net from the last result, for the high-voltage clearance rule
    const volts = {};
    if (S.sim.result && S.sim.topo === T) Object.keys(names).concat([...new Set([...T.pinNet.values()])]).forEach(n => { const v = netDC(+n); if (v !== null) volts[n] = v; });
    // the swing of each net in the simulation (min, max), for the clearance by voltage
    const ranges = {};
    if (S.sim.result && S.sim.topo === T && S.sim.result.tran) Object.keys(volts).forEach(n => {
      const w = netWave(+n); if (!w || !w.length) return;
      let lo = Infinity, hi = -Infinity; for (const v of w) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > 1e-3) ranges[n] = [+lo.toPrecision(4), +hi.toPrecision(4)];
    });
    const f = frames()[0];
    return { parts, names, volts, ranges, title: f ? f.params.title || "" : "", docno: f ? f.params.docno || "" : "", frame: f ? { ...f.params } : null, tubes: usedCustomTubes() };
  }
  let boardTimer = 0;
  function sendBoardNetlist(withBoard) {
    if (!channel) return;
    try { channel.postMessage({ type: "BOARD_NETLIST", version: VERSION, netlist: boardNetlist(), board: withBoard ? S.board : undefined, replace: !!withBoard }); } catch (e) {}
  }
  const scheduleBoardNetlist = () => { clearTimeout(boardTimer); boardTimer = setTimeout(() => sendBoardNetlist(false), 250); };
  function storeBoard(doc) {
    S.board = doc || null;
    try { if (S.board) localStorage.setItem(BOARD_KEY, JSON.stringify(S.board)); else localStorage.removeItem(BOARD_KEY); } catch (e) {}
    showFile();
  }

  let lastSummary = null;
  function broadcast() {
    lastSummary = buildSummary();
    scheduleBoardNetlist();
    if (channel) { try { channel.postMessage(lastSummary); } catch (e) {} }
  }
  if (channel) channel.onmessage = e => {
    const m = e.data || {};
    if (m.type === "REQUEST_STATE") {
      if (!lastSummary) lastSummary = buildSummary(); lastSummary.selectedTubeId = lastTubeId; channel.postMessage(lastSummary);
      if (S.trans) channel.postMessage(transientMessage());
      if (S.ac.msg) channel.postMessage(acMessage());
    }
    // requests from instrument windows are acknowledged at once, so a window can
    // tell a CAD that does not understand them (an older version still open)
    else if (/^(RUN_SIM|RUN_TRANSIENT|STOP_TRANSIENT|BOARD_SAVE|RUN_AC)$/.test(m.type)) channel.postMessage({ type: "ACK", req: m.type, id: m.id, version: VERSION });
    if (m.type === "BOARD_HELLO") sendBoardNetlist(true);                    // a board window opened: netlist and the stored board
    else if (m.type === "BOARD_SAVE") storeBoard(m.doc);
    else if (m.type === "BOARD_SELECT") selectFromBoard(m.ids);
    if (m.type === "RUN_SIM") runSim("full");                            // ▶ Simulate in an instrument window
    else if (m.type === "RUN_TRANSIENT") runTransient(m.tStop);
    else if (m.type === "STOP_TRANSIENT") stopTransient();
    else if (m.type === "RUN_AC") runAC(m.gen);
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
    showBusy();
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
      if (S.sim.busy && result.ok) showBusy();   // the steady state still runs: its progress stays on the line
      else if (result.ok) setStatus("ok", `Power-on transient: ${fmtEng(tStop, "s")} of circuit time in ${(result.elapsedMs / 1000).toFixed(1)} s · ${result.steps} steps`);
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
        showBusy();
      } else done(d.result);
    };
    tWorker.postMessage({ seq, netlist, options, kind: "startup" });
  }

  // ---------------------------------------------------------------------------
  // Frequency response for the Bode plotter window (own worker): the circuit with its signal
  // generators quiet, linearized at that operating point; the chosen generator drives it (1 V),
  // the others are shorts. Each scope channel's response against the scope's common.
  // ---------------------------------------------------------------------------
  let aWorker = null;
  S.ac = { seq: 0, key: null, job: null, msg: null };
  const AC_RANGE = { fStart: 1, fStop: 1e6, perDecade: 40 };
  function acMessage(extra) { return Object.assign({ type: "AC_RESULT", version: VERSION }, S.ac.msg || { ok: false, error: "Not run yet" }, extra || {}); }
  function runAC(gen) {
    const T = topo(), netlist = S.sim.netlist;
    const gens = S.comps.filter(c => c.type === "siggen").map(c => ({ id: c.id, label: desig(c) }));
    const post = m => { S.ac.msg = m; if (channel) try { channel.postMessage(acMessage()); } catch (e) {} };
    if (!netlist || !S.sim.result) { S.ac.key = null; post({ ok: false, error: S.sim.error || "Circuit not simulated", gens }); return; }
    if (!gens.length) { S.ac.key = null; post({ ok: false, error: "Add a signal generator: the response is measured from it", gens }); return; }
    const g = gens.find(x => x.id === gen) || gens[0];
    const probes = [], map = [];
    S.comps.filter(c => c.type === "scope").forEach(c => {
      const com = T.pinNet.get(c.id + ":COM") || 0;
      ["CH1", "CH2"].forEach(pid => {
        if (!T.pinConnected.get(c.id + ":" + pid)) return;
        map.push({ id: c.id, label: c.label, ch: pid.toLowerCase(), k: probes.length });
        probes.push([T.pinNet.get(c.id + ":" + pid), com]);
      });
    });
    const quiet = new Set(gens.map(x => x.id));
    const nl = { nodeCount: netlist.nodeCount, elements: netlist.elements.map(e => (quiet.has(e.id) ? Object.assign({}, e, { amp: 0 }) : e)) };
    const key = JSON.stringify([nl.elements, g.id, probes]);
    if (key === S.ac.key && (S.ac.job || (S.ac.msg && S.ac.msg.ok !== undefined))) { if (!S.ac.job && channel) channel.postMessage(acMessage()); return; }
    if (aWorker) { aWorker.terminate(); aWorker = null; }
    S.ac.key = key;
    const seq = ++S.ac.seq;
    S.ac.job = { seq };
    if (channel) channel.postMessage(acMessage({ running: true, progress: 0, gen: g.id, gens }));
    const options = Object.assign({ inputs: [{ id: g.id, mag: 1 }], probes, budgetMs: 60000 }, AC_RANGE);
    const done = res => {
      if (S.ac.seq !== seq) return;
      aWorker = null; S.ac.job = null;
      const scopes = [];
      if (res.ok) map.forEach(p => {
        let sc = scopes.find(x => x.id === p.id); if (!sc) scopes.push(sc = { id: p.id, label: p.label, ch1: null, ch2: null });
        sc[p.ch] = { re: Array.from(res.probes[p.k].re), im: Array.from(res.probes[p.k].im) };
      });
      post({ ok: !!res.ok, error: res.ok ? null : res.error, gen: g.id, gens, freqs: res.ok ? Array.from(res.freqs) : [], scopes, averaged: !!res.averaged, elapsedMs: res.elapsedMs, running: false });
    };
    try { aWorker = new Worker("sim-worker.js" + VERSION); } catch (e) { aWorker = null; }
    if (!aWorker) { setTimeout(() => done(TubeSimEngine.acSweep(nl, options)), 0); return; }
    aWorker.onmessage = e => {
      const d = e.data;
      if (d.seq !== seq) return;
      if (d.result) done(d.result);
      else if (channel) channel.postMessage(acMessage({ running: true, progress: d.progress, gen: g.id, gens }));
    };
    aWorker.postMessage({ seq, netlist: nl, options, kind: "ac" });
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
  // a sheet frame is locked unless unlocked in its inspector (older files have no setting: locked)
  const isLocked = c => c.type === "frame" && c.params.locked !== "no";
  const lockedNote = () => setStatus("warn", "The sheet frame is locked: select it and set Position to Unlocked in the inspector to move or delete it.");
  function deleteSelection() {
    if (!S.sel.comps.size && !S.sel.wires.size) return;
    // locked frames stay (and stay selected); everything else selected goes
    const keep = new Set(S.comps.filter(c => S.sel.comps.has(c.id) && isLocked(c)).map(c => c.id));
    if (keep.size) lockedNote();
    if (keep.size === S.sel.comps.size && !S.sel.wires.size) return;
    S.comps = S.comps.filter(c => !S.sel.comps.has(c.id) || keep.has(c.id));
    S.wires = S.wires.filter(w => !S.sel.wires.has(w.id));
    S.sel.comps = keep; S.sel.wires.clear();
    commit();
  }
  function mirrorSelection() {
    if (S.placing) { if (canMirror(S.placing.type)) { S.placing.params = Object.assign({}, S.placing.params, { flip: S.placing.params && S.placing.params.flip === "yes" ? "no" : "yes" }); render(); } return; }
    let any = false;
    S.comps.forEach(c => { if (S.sel.comps.has(c.id) && canMirror(c.type)) { c.params.flip = c.params.flip === "yes" ? "no" : "yes"; any = true; } });
    if (any) commit();
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
    const moving = new Set([...S.sel.comps].filter(id => !isLocked(S.comps.find(c => c.id === id) || {})));
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
    if (!d.comps0.length && !S.sel.wires.size) { if (!d.warned) { d.warned = true; lockedNote(); } return; }
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
    if (e.button === 0 && !S.spaceDown) S.lastClick = { x: m.wx, y: m.wy };   // Fit picks the sheet clicked last
    if (e.button === 0) bomSelShown = "";   // a click on the sheet shows its selection in the BOM again
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
  // Renumber reference designations (classic letter code + number: R, C, L, T,
  // VL ... as in ГОСТ 2.710) in reading order of the diagram: left to right,
  // then top to bottom. Parts whose labels share a base before a dot (a dual
  // triode VL1.1/VL1.2, the sections SA1.1/SA1.2 of one switch) stay one
  // object with their sections.
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
  // Sections of one switch share its name before the dot (SA1.1, SA1.2) and always move together.
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
    if (e.key === "F1") { const m = document.getElementById("help-modal"); m.hidden = !m.hidden; e.preventDefault(); return; }   // also while typing
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, L = /^Key[A-Z]$/.test(e.code || "") ? e.code.slice(3).toLowerCase() : String(k).toLowerCase();
    if (k === " ") { S.spaceDown = true; canvas.style.cursor = "grab"; e.preventDefault(); return; }
    if (k === "?") { const m = document.getElementById("help-modal"); m.hidden = !m.hidden; e.preventDefault(); return; }
    if (k === "Escape" && !document.getElementById("help-modal").hidden) { document.getElementById("help-modal").hidden = true; return; }
    if (k === "Escape") { if (S.wiring) finishWiring(); else if (S.placing) { S.placing = null; setTool("select"); } else { S.sel.comps.clear(); S.sel.wires.clear(); updateInspector(); render(); } }
    else if ((k === "Delete" || k === "Backspace")) { deleteSelection(); e.preventDefault(); }
    // letters by physical key (e.code), so the shortcuts work in any keyboard layout
    // (with a Cyrillic layout e.key is "к" for R); other keys by e.key
    else if (L === "r") { if (!ctrl) rotateSelection(); }
    else if (L === "m" && !ctrl) mirrorSelection();
    else if (L === "w" && !ctrl) setTool(S.tool === "wire" ? "select" : "wire");
    else if (L === "v" && !ctrl) setTool("select");
    else if (L === "f" && !ctrl) fitCurrent();
    else if (L === "b" && !ctrl) toggleBom();
    else if (L === "d") { if (copySelection()) paste(40, 40); e.preventDefault(); }   // D or Ctrl+D duplicates
    else if (ctrl && k === "Enter") { runSim("full"); e.preventDefault(); }
    else if (ctrl && L === "s") { e.shiftKey ? saveFileAs() : saveFile(); e.preventDefault(); }
    else if (ctrl && L === "o") { openDialog(); e.preventDefault(); }
    else if (ctrl && L === "z") { e.shiftKey ? redo() : undo(); e.preventDefault(); }
    else if (ctrl && L === "y") { redo(); e.preventDefault(); }
    else if (ctrl && L === "c") { copySelection(); }
    else if (ctrl && L === "v") { paste(40, 40); e.preventDefault(); }
    else if (ctrl && L === "a") { S.comps.forEach(c => S.sel.comps.add(c.id)); S.wires.forEach(w => S.sel.wires.add(w.id)); updateInspector(); render(); e.preventDefault(); }
    else if (k === "+" || k === "=" || e.code === "NumpadAdd" || e.code === "Equal") zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.2);
    else if (k === "-" || e.code === "NumpadSubtract" || e.code === "Minus") zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.2);
  }
  function onKeyUp(e) { if (e.key === " ") { S.spaceDown = false; canvas.style.cursor = ""; } }

  function updateHover(m) {
    const pin = hitPin(m.wx, m.wy);
    let net, label = "", wireI = "";
    const T = S.sim.topo || topo();
    if (pin) { net = T.pinNet.get(pin.c.id + ":" + pin.p.id); label = pin.c.type === "offsheet" ? `${pin.c.params.name || "connector"} (also at ${refText(connRefs(pin.c)) || "no other place"})` : `${pin.c.label || LIB[pin.c.type].name} ${pin.p.name || pin.p.id}`; }
    else {
      const w = hitWire(m.wx, m.wy);
      if (w) { net = (S.sim.topo || topo()).wireNet.get(w.id); label = "wire"; const wc = S.sim.result && wireCurrents(), i = wc ? wc.currents.get(w.id) : undefined; if (typeof i === "number") wireI = (isH(w) ? (i > 0 === w.x2 > w.x1 ? "→" : "←") : (i > 0 === w.y2 > w.y1 ? "↓" : "↑")) + fmtEng(Math.abs(i), "A", 2); }
    }
    let cursor = "";
    if (S.spaceDown) cursor = "grab";
    else if (S.placing || S.wiring || S.tool === "wire" || pin) cursor = "crosshair";
    else if (!pin) { const w = hitWire(m.wx, m.wy); if (w) cursor = isH(w) ? "ns-resize" : "ew-resize"; else if (hitComp(m.wx, m.wy)) cursor = "move"; }
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    const el = document.getElementById("status-hover");
    if (net === undefined) { el.textContent = `x ${snap(m.wx)}  y ${snap(m.wy)}`; return; }
    const dc = netDC(net), wave = netWave(net), st = wave ? stats(wave) : null;
    el.textContent = `${label}: ` + (net === 0 ? "ground (0 V)" : (dc === null ? "not simulated" : `DC ${fmtEng(dc, "V", 2)}` + (st && st.pp > 1e-4 ? ` · AC ${fmtEng(st.rmsAC, "Vrms", 2)} (${fmtEng(st.pp, "Vpp", 2)}) · avg ${fmtEng(st.mean, "V", 2)}` : "") + (wireI ? ` · I ${wireI} DC` : "")));
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

    // drawing sheets lie behind everything; every text the sheet and parts print is recorded
    // so the stickers can keep clear of it
    textBoxes = [];
    ctx.fillText = function (t, x, y, mw) { recordText(this, String(t), x, y); return CanvasRenderingContext2D.prototype.fillText.call(this, t, x, y, mw); };
    recordingFrame = true;
    S.comps.forEach(c => { if (c.type === "frame") drawComp(c, S.sel.comps.has(c.id), false); });
    recordingFrame = false;
    // wires
    ctx.lineCap = "round";
    // with the voltages shown, wires that carry signal (AC) get a cyan glow under them
    if (S.showVolts && S.sim.result && S.sim.result.tran) {
      ctx.strokeStyle = "rgba(0,229,255,0.30)"; ctx.lineWidth = 7;
      S.wires.forEach(w => { const ac = netAC(T.wireNet.get(w.id)); if (ac && ac.signal) { ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke(); } });
    }
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
    delete ctx.fillText;

    // voltage and current stickers
    if ((S.showVolts || S.showAmps) && S.sim.result) drawStickers(T);

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
    if (S.showLegend) drawLegend(H); else legendBox = null;
  }
  // what the colours on the sheet mean: only the marks that are showing
  function legendRows() {
    const r = S.sim.result; if (!r || !(S.showVolts || S.showAmps)) return [];
    const rows = [], ac = S.showVolts && r.tran;
    if (ac) rows.push({ glow: true, text: "signal: AC on the wire (≥ 1 % of its DC)" });
    if (S.showVolts) rows.push({ tag: "250V", fg: "#ffd54f", line: "rgba(255,213,79,0.35)", text: "DC voltage of the node" });
    if (ac) rows.push({ tag: "~1.2Vrms", fg: "#00e5ff", line: "rgba(0,229,255,0.45)", text: "AC on the node, rms" });
    if (S.showAmps) rows.push({ tag: "↓1.2mA", fg: "#d2a8ff", line: "rgba(210,168,255,0.45)", text: "DC current and its direction" });
    return rows;
  }
  function drawLegend(H) {
    const rows = legendRows(); if (!rows.length) { legendBox = null; return; }
    ctx.save();
    ctx.font = "10px ui-monospace, monospace";
    const sw = 58, lh = 16, tw = Math.max(...rows.map(q => ctx.measureText(q.text).width)), w = sw + tw + 18, h = rows.length * lh + 10, x0 = 8, y0 = H - h - 8;
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = "rgba(10,14,20,0.88)"; ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = "#26344a"; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    rows.forEach((q, i) => {
      const y = y0 + 5 + i * lh + lh / 2, x = x0 + 6;
      if (q.glow) {
        ctx.lineCap = "round"; ctx.strokeStyle = "rgba(0,229,255,0.30)"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(x + sw - 8, y); ctx.stroke();
        ctx.strokeStyle = "#3fb950"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(x + sw - 8, y); ctx.stroke();
      } else {
        const tw2 = ctx.measureText(q.tag).width + 6;
        ctx.fillStyle = "rgba(10,14,20,0.85)"; ctx.fillRect(x, y - TAG_H / 2, tw2, TAG_H);
        ctx.strokeStyle = q.line; ctx.lineWidth = 0.8; ctx.strokeRect(x, y - TAG_H / 2, tw2, TAG_H);
        ctx.fillStyle = q.fg; ctx.fillText(q.tag, x + 3, y + 3);
      }
      ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = "#8b949e"; ctx.fillText(q.text, x + sw + 4, y + 3.5); ctx.font = "9px ui-monospace, monospace";
    });
    ctx.restore();
    legendBox = { x: x0, y: y0, w, h, rows: rows.map(q => q.text) };
  }
  let legendBox = null;

  // Reference designation as shown on the diagram: the label as typed, e.g. R1, VL1.2
  function desig(c) { return c.label || ""; }

  // Tube pin numbers beside the terminal lines, outside the envelope (IEC 61082-1 terminal
  // designations): [terminal, point on its lead, side to write on] in symbol coordinates
  const TUBE_PIN_SPOTS = [["A", 0, -40, 1, 0], ["A1", -20, -40, -1, 0], ["A2", 20, -40, 1, 0],
    ["G", -40, 0, 0, 1], ["G1", -40, 0, 0, 1], ["G2", 40, -10, 0, -1], ["K", 0, 44, -1, 0], ["H", 10, 47, 0, 1]];
  function drawPinNumbers(c, sel) {
    const nums = LIB.tube.pinNumbers(c), ids = new Set(compPins(c).map(p => p.id).concat("H"));
    ctx.save();
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.fillStyle = sel ? COL.bodySel : COL.value;
    for (const [id, x, y, nx, ny] of TUBE_PIN_SPOTS) {
      if (!nums[id] || !ids.has(id)) continue;
      const f = flipX(c), [px, py] = rotPt(f * x, y, c.rot), [dx, dy] = rotPt(f * nx, ny, c.rot);
      ctx.textAlign = dx > 0 ? "left" : dx < 0 ? "right" : "center";
      ctx.textBaseline = dy > 0 ? "top" : dy < 0 ? "bottom" : "middle";
      ctx.fillText(nums[id], c.x + px + dx * 4, c.y + py + dy * 3);
    }
    ctx.restore();
  }
  function drawComp(c, sel, ghost) {
    const def = LIB[c.type];
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((c.rot & 3) * Math.PI / 2);
    const mirrored = flipX(c) < 0, ownFill = Object.prototype.hasOwnProperty.call(ctx, "fillText"), prevFill = ctx.fillText;
    if (mirrored) {
      ctx.scale(-1, 1);
      // text inside a symbol (switch A/B, generator G) stays readable: un-mirror it about its anchor
      ctx.fillText = function (t, x, y, mw) {
        this.save(); this.translate(x, y); this.scale(-1, 1);
        const a = this.textAlign; this.textAlign = a === "left" || a === "start" ? "right" : a === "right" || a === "end" ? "left" : a;
        prevFill.call(this, t, 0, 0, mw); this.restore();
      };
    }
    // a part that sets a tube's bias (bias finder) in its own colour, on screen only
    const biasPart = !ghost && !S.printing && S.bias.show && S.sim.result ? S.bias.parts.get(c.id) : null;
    ctx.strokeStyle = sel ? COL.bodySel : biasPart ? BIAS_COL : (c.type === "ground" ? "#8b949e" : (c.type === "vdc" || c.type === "ptx" || c.type === "ptx_cat" || c.type === "mains" ? "#ff9e64" : (c.type === "siggen" ? "#00e5ff" : COL.body)));
    ctx.lineWidth = 2;
    c._sel = sel;
    DRAW[c.type](ctx, c);
    delete c._sel;
    if (mirrored) { if (ownFill) ctx.fillText = prevFill; else delete ctx.fillText; }
    ctx.restore();

    if (c.type === "scope" && !S.printing) drawScopeScreen(c);
    if (isLocked(c) && !S.printing && !ghost) {
      // padlock in the filing margin, outside the frame: shows the sheet stays put
      ctx.save(); ctx.translate(c.x + 34, c.y + 34); ctx.strokeStyle = ctx.fillStyle = sel ? COL.bodySel : "#8b949e"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -6, 5, Math.PI, 0); ctx.stroke(); ctx.fillRect(-8, -6, 16, 12);
      ctx.restore();
    }

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
    if (c.type === "offsheet") {
      const d = [[1, 0], [0, 1], [-1, 0], [0, -1]][c.rot & 3], tx = c.x + d[0] * 26, ty = c.y + d[1] * 26;
      const refs = connRefs(c), align = d[0] > 0 ? "left" : d[0] < 0 ? "right" : "center";
      ctx.textAlign = align; ctx.font = "bold 11px ui-monospace, Menlo, monospace"; ctx.fillStyle = sel ? COL.bodySel : COL.text;
      const vy = d[1] > 0 ? ty + 8 : d[1] < 0 ? ty - 14 : ty + 4;
      ctx.fillText(c.params.name || "", tx, vy);
      ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = refs.length ? COL.value : "#ff7b72";
      if (!refs.length || !isRail(c)) ctx.fillText(refs.length ? refText(refs) : "no partner", tx, vy + 12);
      ctx.textAlign = "left";
      return;
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
      // the title over the body's left edge; the input names over their stubs, on whichever side they are
      const tx = c.x - 80, lx = flipX(c) < 0 ? c.x + 72 : c.x - 88;
      ctx.beginPath(); ctx.arc(tx + 18, b.y1 - 11, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx + 13, b.y1 - 8); ctx.lineTo(tx + 20, b.y1 - 15); ctx.lineTo(tx + 20, b.y1 - 8); ctx.lineTo(tx + 24, b.y1 - 12); ctx.stroke(); ctx.restore();
      ctx.textAlign = "left"; ctx.fillText(desig(c) + "  oscilloscope", tx + 32, b.y1 - 6);
      ctx.font = "9px ui-monospace, monospace"; ctx.fillStyle = "#ffd54f"; ctx.fillText("CH1", lx, c.y - 34); ctx.fillStyle = "#00e5ff"; ctx.fillText("CH2", lx, c.y - 14); ctx.fillStyle = "#8b949e"; ctx.fillText("COM", lx, c.y + 26);
      return;
    }
    // IEC 61082-1 7.1.6.1 / 7.1.2.5: the reference designation goes to the left of a
    // symbol with mainly vertical terminal lines and above one with mainly horizontal
    // ones; technical data on the same side, below (or right of) the designation
    if (c.type === "tube") {
      drawPinNumbers(c, sel);
      if ((c.rot & 1) === 0) {   // anode up, cathode down: text above the control-grid lead (left, or right when mirrored)
        const side = ((c.rot & 2) ? -1 : 1) * flipX(c);        // -1: grid on the right
        ctx.textAlign = side > 0 ? "right" : "left";
        ctx.fillText(desig(c), c.x - 30 * side, c.y - 28);
        ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = COL.value;
        ctx.fillText(val, c.x - 30 * side, c.y - 15);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(desig(c), c.x, b.y1 - 17);
        ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = COL.value;
        ctx.fillText(val, c.x, b.y1 - 5);
      }
      ctx.textAlign = "left";
      return;
    }
    if (/^(npn|pnp|nmos|pmos)$/.test(c.type)) {
      // beside the envelope, on the side away from the base / gate lead (the collector and
      // emitter leads run on through the space above and below)
      const bp = compPins(c).find(p => p.id === "B" || p.id === "G"), right = bp.x < c.x - 5;
      ctx.textAlign = right ? "left" : "right";
      const tx = right ? b.x2 + 5 : b.x1 - 5;
      ctx.fillText(desig(c), tx, c.y - 2);
      ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = COL.value;
      ctx.fillText(val, tx, c.y + 11);
      ctx.textAlign = "left";
      return;
    }
    // the bias finder's value under the part's own: "→ 270Ω", a pot's wiper "→ 64%", "→ …" while it searches
    const biasP = biasPart && biasFor(c.id), biasTag = biasPart && (biasP ? "→ " + biasValueText(biasP) : S.bias.job && biasPart.tubes.some(id => { const t = compById(id); return t && CadLib.biasBy(t); }) ? "→ …" : "");
    if (vertical) {
      ctx.textAlign = "right";
      ctx.fillText(desig(c), b.x1 - 5, c.y - 2);
      ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = COL.value;
      ctx.fillText(val, b.x1 - 5, c.y + 11);
      if (biasTag) { ctx.font = "bold 10px ui-monospace, monospace"; ctx.fillStyle = BIAS_COL; ctx.fillText(biasTag, b.x1 - 5, c.y + 24); }
    } else {
      ctx.textAlign = "center";
      ctx.fillText(desig(c), c.x, b.y1 - (val ? 17 : 5));
      ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = COL.value;
      if (val) ctx.fillText(val, c.x, b.y1 - 5);
      if (biasTag) { ctx.font = "bold 10px ui-monospace, monospace"; ctx.fillStyle = BIAS_COL; ctx.fillText(biasTag, c.x, b.y2 + 12); }
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

  // ---------------------------------------------------------------------------
  // Voltage and current stickers. Each is placed where it covers nothing: the
  // drawing records every text it prints (designations, values, pin numbers,
  // connector names, notes), and part symbols and wires count as taken too.
  // A voltage sticker may sit on any wire of its net, a current sticker on any
  // segment of its run, at several points along it and on either side; the
  // first free spot in order of preference wins (voltage above / right of a
  // wire, current below / left), else the one that covers least. Placement is
  // recomputed only when the circuit, the result or the switches change.
  // ---------------------------------------------------------------------------
  let textBoxes = [], stickerCache = null, recordingFrame = false;
  const TAG_H = 12;
  // record the world-space box of a text drawn with the current transform
  function recordText(c2, t, x, y) {
    const m = c2.getTransform(), fs = parseFloat((/([\d.]+)px/.exec(c2.font) || [, 10])[1]), w = c2.measureText(t).width;
    const al = c2.textAlign, bl = c2.textBaseline;
    const x0 = al === "center" ? x - w / 2 : al === "right" || al === "end" ? x - w : x;
    const y0 = bl === "middle" ? y - fs / 2 : bl === "top" || bl === "hanging" ? y : bl === "bottom" ? y - fs : y - 0.8 * fs;
    const { scale, ox, oy } = S.view;
    let X1 = Infinity, Y1 = Infinity, X2 = -Infinity, Y2 = -Infinity;
    [[x0, y0], [x0 + w, y0], [x0, y0 + fs], [x0 + w, y0 + fs]].forEach(([px, py]) => {
      const X = ((m.a * px + m.c * py + m.e) / dpr - ox) / scale, Y = ((m.b * px + m.d * py + m.f) / dpr - oy) / scale;
      X1 = Math.min(X1, X); Y1 = Math.min(Y1, Y); X2 = Math.max(X2, X); Y2 = Math.max(Y2, Y);
    });
    if (isFinite(X1)) textBoxes.push({ x1: X1, y1: Y1, x2: X2, y2: Y2, frame: recordingFrame });
  }
  const overlap = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  // the runs of wire that carry one current: segments joined where nothing else takes current
  function currentRuns(wc) {
    const { currents, adj, pinDraw } = wc;
    const parent = new Map(), find = a => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
    currents.forEach((i, id) => parent.set(id, id));
    adj.forEach((l, k) => {
      if (l.some(e => !currents.has(e.w.id)) || !(Math.abs(pinDraw.get(k) || 0) < 1e-6)) return;
      const big = l.filter(e => Math.abs(currents.get(e.w.id)) >= 1e-6);
      if (big.length === 2) parent.set(find(big[0].w.id), find(big[1].w.id));
    });
    const runs = new Map();
    currents.forEach((i, id) => { const r = find(id); if (!runs.has(r)) runs.set(r, []); runs.get(r).push(id); });
    return [...runs.values()];
  }
  function placeStickers(T) {
    ctx.save(); ctx.font = "9px ui-monospace, monospace";
    const width = t => ctx.measureText(t).width + 6;
    const len = w => Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);
    // what is already on the sheet; text and symbols weigh more than crossing a wire
    const obst = [];
    textBoxes.forEach(b => obst.push({ ...b, k: 10 }));
    S.comps.forEach(c => {
      if (c.type === "frame") { const g = CadLib.sheetGeom(c); obst.push({ x1: c.x + g.tb.x1, y1: c.y + g.tb.y1, x2: c.x + g.tb.x2, y2: c.y + g.tb.y2, k: 10 }); return; }
      if (c.type === "note") return;   // its text is recorded
      const b = compBBox(c); obst.push({ x1: b.x1 - 1, y1: b.y1 - 1, x2: b.x2 + 1, y2: b.y2 + 1, k: 5 });
    });
    S.wires.forEach(w => obst.push({ x1: Math.min(w.x1, w.x2) - 1.5, y1: Math.min(w.y1, w.y2) - 1.5, x2: Math.max(w.x1, w.x2) + 1.5, y2: Math.max(w.y1, w.y2) + 1.5, k: 1 }));
    const placed = [];
    // hard: covering a text, a symbol or another sticker (never accepted); soft: crossing a wire
    const cost = r => {
      let hard = 0, soft = 0;
      for (const o of obst) { const a = overlap(r, o); if (a) { if (o.k > 1) hard += a * o.k; else soft += a; } }
      for (const p of placed) hard += overlap(r, p) * 20;
      return hard > 0.5 ? 1e6 + hard : soft;
    };
    // candidate spots along a list of wires (preferred first); side: "a" = above / right, "b" = below / left
    const place = (txt, wires, side, style) => {
      const tw = width(txt);
      let best = null;
      for (const w of wires) {
        const h = isH(w), L = len(w);
        const ts = L >= 60 ? [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9] : L >= 30 ? [0.5, 0.3, 0.7, 0.15, 0.85] : [0.5, 0.25, 0.75];
        for (const t of ts) for (const gap of [3, 9, 15]) for (const sd of side === "a" ? ["a", "b"] : ["b", "a"]) {
          const mx = w.x1 + (w.x2 - w.x1) * t, my = w.y1 + (w.y2 - w.y1) * t;
          const x = h ? mx - tw / 2 : sd === "a" ? mx + gap + 1 : mx - tw - gap - 1;
          const y = h ? (sd === "a" ? my - TAG_H - gap : my + gap) : my - TAG_H / 2;
          const r = { x1: x, y1: y, x2: x + tw, y2: y + TAG_H }, c = cost(r);
          if (!best || c < best.c - 1e-9) best = { r, c };
          if (c === 0) break;
        }
        if (best && best.c === 0) break;
      }
      // no spot clear of text, symbols and other stickers: leave it out (hovering the wire still reads it)
      if (best && best.c < 1e6) { placed.push(best.r); out.push({ txt, ...style, x: best.r.x1, y: best.r.y1, w: tw, c: best.c }); }
      else hidden.push(txt);
    };
    const out = [], hidden = [];
    const byLen = (a, b) => (isH(b) - isH(a)) || len(b) - len(a);
    if (S.showVolts) {
      const nets = new Map();
      S.wires.forEach(w => { const n = T.wireNet.get(w.id); if (n === 0 || n === undefined) return; if (!nets.has(n)) nets.set(n, []); nets.get(n).push(w); });
      nets.forEach((ws, n) => {
        const v = netDC(n); if (v === null) return;
        // DC in yellow, AC after it in cyan as "~1.2Vrms"; a node with no DC on it (a signal
        // after a coupling capacitor) shows its AC only
        const ac = netAC(n), dcT = fmtEng(v, "V", Math.abs(v) >= 100 ? 0 : 1), acT = ac && "~" + fmtEng(ac.rms, "Vrms", acDigits(ac.rms));
        const parts = !ac ? [[dcT, "#ffd54f"]] : Math.abs(v) < 1e-3 ? [[acT, "#00e5ff"]] : [[dcT, "#ffd54f"], [" " + acT, "#00e5ff"]];
        place(parts.map(q => q[0]).join(""), ws.sort(byLen), "a", { kind: "v", ac: !!ac, parts, fg: "#ffd54f", line: ac && ac.signal ? "rgba(0,229,255,0.45)" : "rgba(255,213,79,0.35)" });
      });
    }
    if (S.showAmps) {
      const wc = wireCurrents();
      if (wc) {
        const byId = new Map(S.wires.map(w => [w.id, w]));
        currentRuns(wc).forEach(ids => {
          const ws = ids.map(id => byId.get(id)).filter(w => w && len(w) >= 20).sort(byLen); if (!ws.length) return;
          const w = ws[0], i = wc.currents.get(w.id); if (!(Math.abs(i) >= 1e-6)) return;
          // the arrow follows the direction on whichever segment the sticker lands
          const lab = x => { const h = isH(x), j = wc.currents.get(x.id), fwd = j > 0 === (h ? x.x2 > x.x1 : x.y2 > x.y1); return (h ? (fwd ? "→" : "←") : (fwd ? "↓" : "↑")) + fmtEng(Math.abs(j), "A"); };
          // try each segment with its own arrow; keep the first free spot
          const before = out.length, saved = placed.length;
          let pick = null;
          const hid = hidden.length;
          for (const x of ws) {
            place(lab(x), [x], "b", { kind: "i", fg: "#d2a8ff", line: "rgba(210,168,255,0.45)" });
            if (out.length === before) continue;          // no room on this segment
            const s = out.pop(); placed.pop();
            if (!pick || s.c < pick.c) pick = s;
            if (s.c === 0) break;
          }
          out.length = before; placed.length = saved; hidden.length = hid;
          if (pick) { out.push(pick); placed.push({ x1: pick.x, y1: pick.y, x2: pick.x + pick.w, y2: pick.y + TAG_H }); }
          else hidden.push(lab(ws[0]));
        });
      }
    }
    ctx.restore();
    out.hidden = hidden;
    return out;
  }
  function drawStickers(T) {
    const key = [S.history[S.hIndex], S.sim.result, S.showVolts, S.showAmps, S.wires];
    if (S.drag || !stickerCache || stickerCache.key.some((k, i) => k !== key[i])) stickerCache = { key, list: placeStickers(T) };
    ctx.font = "9px ui-monospace, monospace";
    stickerCache.list.forEach(t => {
      ctx.fillStyle = "rgba(10,14,20,0.85)"; ctx.fillRect(t.x, t.y, t.w, TAG_H);
      ctx.strokeStyle = t.line; ctx.lineWidth = 0.8; ctx.strokeRect(t.x, t.y, t.w, TAG_H);
      if (!t.parts) { ctx.fillStyle = t.fg; ctx.fillText(t.txt, t.x + 3, t.y + 9); return; }
      let x = t.x + 3; t.parts.forEach(([s, col]) => { ctx.fillStyle = col; ctx.fillText(s, x, t.y + 9); x += ctx.measureText(s).width; });
    });
  }
  // for tests: how many stickers and how many still cover a text or another sticker
  function stickerReport() {
    const list = (stickerCache && stickerCache.list) || [];
    const box = t => ({ x1: t.x, y1: t.y, x2: t.x + t.w, y2: t.y + TAG_H });
    const onText = list.filter(t => textBoxes.some(b => overlap(box(t), b) > 0.5)).map(t => t.txt);
    const onOther = list.filter((t, i) => list.some((u, j) => j !== i && overlap(box(t), box(u)) > 0.5)).map(t => t.txt);
    // texts of the drawing itself that run into each other (labels placed too close)
    const textClash = [], parts = textBoxes.filter(b => !b.frame), grow = b => ({ x1: b.x1 - 1, y1: b.y1 - 1, x2: b.x2 + 1, y2: b.y2 + 1 });   // touching counts
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (overlap(grow(parts[i]), parts[j]) > 2) textClash.push([parts[i], parts[j]].map(b => [Math.round(b.x1), Math.round(b.y1)]));
    return { count: list.length, hidden: list.hidden || [], textClash, volts: list.filter(t => t.kind === "v").length, ac: list.filter(t => t.ac).map(t => t.txt), signalNets: [...new Set(S.wires.map(w => (S.sim.topo || topo()).wireNet.get(w.id)))].filter(n => { const a = netAC(n); return a && a.signal; }).length, amps: list.filter(t => t.kind === "i").length, onText, onOther, list: list.map(t => ({ txt: t.txt, kind: t.kind, ...box(t) })) };
  }


  // ---------------------------------------------------------------------------
  // UI: palette, toolbar, inspector, status
  // ---------------------------------------------------------------------------
  // progress: readiness 0…1 of a running simulation (shown as a bar under the status text)
  function setStatus(kind, text, progress) {
    const el = document.getElementById("status-sim");
    el.className = "sim-status " + kind;
    el.textContent = text;
    const bar = kind === "busy" && progress !== undefined;
    el.classList.toggle("progress", bar);
    el.style.setProperty("--progress", bar ? (progress * 100).toFixed(1) + "%" : "0%");
    // instrument windows show what the CAD is doing (e.g. after their ▶ Simulate)
    if (channel) { try { channel.postMessage({ type: "SIM_STATUS", kind, text, busy: kind === "busy", progress: bar ? progress : null, version: VERSION }); } catch (e) {} }
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

  // ---------------------------------------------------------------------------
  // Parts palette: collapsible groups (state kept per browser) and one search box for
  // parts, part numbers (2N3904, IRF540, 125ESE …), tubes and values ("47k" → 47 kΩ resistor)
  // ---------------------------------------------------------------------------
  const PAL_KEY = "tubecad_palette";
  const palState = { closed: { Transformers: true, Semiconductors: true, Instruments: true, Document: true, Tubes: true }, allTubes: false };
  try { Object.assign(palState, JSON.parse(localStorage.getItem(PAL_KEY)) || {}); } catch (e) {}
  const savePal = () => { try { localStorage.setItem(PAL_KEY, JSON.stringify(palState)); } catch (e) {} };
  const escH = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  function palItem(label, sub, type, params, extraClass, title) {
    const b = document.createElement("button");
    b.className = "pal-item" + (extraClass ? " " + extraClass : "");
    b.innerHTML = `<span>${escH(label)}</span>${sub ? `<em>${escH(sub)}</em>` : ""}`;
    const what = title || (window.Hints && Hints.parts[type]) || "";
    b.dataset.hint = (what ? what + "\n" : "") + "Click, then click on the sheet to place (Shift-click places several).";
    b.dataset.hintTitle = label;
    b.addEventListener("click", () => startPlacing(type, params, b));
    return b;
  }
  const tubeItem = t => palItem(t.commonName, t.type.replace(/ (Triode|Pentode|Tetrode|Rectifier)$/, ""), "tube", { tube: t.commonName }, "tube", `${t.type}. ${t.nameWestern} · ${t.nameGost}\nVa max ${t.vaMax} V · Pa max ${t.paMax} W · heater ${t.vh} V / ${t.ih} A`);
  // everything the search can find: [group, label, sub, type, params, text to match]
  function searchables() {
    const L = CadLib, out = [];
    PALETTE.forEach(g => g.items.forEach(it => {
      if (it.sub) return;
      const [type, params, label] = it, def = LIB[type], p = Object.assign({}, def.defaults, params || {}), sub = def.value({ params: p });
      out.push([g.group, label || def.name, sub, type, params, `${label || ""} ${def.name} ${sub} ${type}`]);
    }));
    Object.entries(L.BJTS).forEach(([k, m]) => out.push(["Semiconductors", `${m.pol > 0 ? "NPN" : "PNP"} · ${k}`, `${m.v} V ${m.p} W`, m.pol > 0 ? "npn" : "pnp", { model: k }, `${k} transistor bjt ${m.pol > 0 ? "npn" : "pnp"} ${m.use}`]));
    Object.entries(L.MOSFETS).forEach(([k, m]) => out.push(["Semiconductors", `${m.pol > 0 ? "N" : "P"}-MOSFET · ${k}`, `${m.v} V ${m.p} W`, m.pol > 0 ? "nmos" : "pmos", { model: k }, `${k} mosfet fet ${m.use}`]));
    Object.entries(L.ZENERS).forEach(([k, z]) => out.push(["Semiconductors", `Zener · ${k}`, `${z.bv} V ${z.p} W`, "zener", { model: k }, `${k} zener ${z.bv}v`]));
    Object.keys(L.LEDS).forEach(k => out.push(["Semiconductors", `LED · ${k}`, `${L.LEDS[k].vf} V`, "led", { color: k }, `led ${k}`]));
    ["1N4007", "UF4007", "1N4148"].forEach(k => out.push(["Semiconductors", `Diode · ${k}`, "", "diode", { model: k }, `${k} diode rectifier`]));
    Object.entries(L.OUTPUT_TX).forEach(([k, m]) => out.push(["Transformers", `Output · ${m.name}`, `${m.w} W ${m.ma} mA`, "opt_cat", { model: k }, `${k} ${m.name} output transformer single-ended`]));
    Object.entries(L.POWER_TX).forEach(([k, m]) => out.push(["Transformers", `Power · ${m.name}`, m.rated, "ptx_cat", { model: k }, `${k} ${m.name} power transformer ${m.rated}`]));
    TUBE_DATABASE.forEach(t => out.push(["Tubes", t, "", "tube", { tube: t.commonName }, `${t.commonName} ${t.nameGost} ${t.nameWestern} ${t.type}`]));
    return out;
  }
  // a typed value becomes the part it describes: 47k → resistor, 100n / 100nF → capacitor, 47u → electrolytic, 5H → choke
  function valueHits(q) {
    const m = /^([\d.,]+\s*(?:meg|[pnuµmkKMG])?)\s*(Ω|ohm|r|f|h|v)?$/i.exec(q.trim()); if (!m) return [];
    const v = parseEng(m[1].replace(/\s+/g, "")); if (!(v > 0)) return [];
    const u = (m[2] || "").toLowerCase(), out = [];
    if (u === "f" || (!u && /[pnuµ]$/i.test(m[1]))) { out.push(["Value", "Capacitor", fmtEng(v, "F"), "capacitor", { c: v }]); if (v >= 1e-6) out.push(["Value", "Electrolytic cap", fmtEng(v, "F"), "electrolytic", { c: v }]); }
    else if (u === "h") out.push(["Value", "Inductor / choke", fmtEng(v, "H"), "inductor", { l: v }]);
    else if (u === "v") out.push(["Value", "DC supply", fmtEng(v, "V"), "vdc", { v }]);
    else { out.push(["Value", "Resistor", fmtEng(v, "Ω"), "resistor", { r: v }]); out.push(["Value", "Potentiometer", fmtEng(v, "Ω"), "pot", { r: v }]); }
    return out;
  }
  function buildPalette() {
    const host = document.getElementById("palette");
    host.innerHTML = "";
    const search = document.createElement("input");
    search.type = "search"; search.className = "pal-search"; search.id = "pal-search";
    search.placeholder = "Search parts, 2N3904, EL84, 47k…"; search.setAttribute("aria-label", "Search parts");
    host.appendChild(search);
    const body = document.createElement("div"); host.appendChild(body);
    const index = searchables();
    const group = (title, count) => {
      const h = document.createElement("button"); h.className = "pal-group" + (palState.closed[title] ? " closed" : ""); h.type = "button";
      h.innerHTML = `<span class="chev">▾</span>${escH(title)}${count ? `<small>${count}</small>` : ""}`;
      h.setAttribute("aria-expanded", String(!palState.closed[title]));
      const box = document.createElement("div"); box.className = "pal-box"; box.hidden = !!palState.closed[title];
      h.addEventListener("click", () => { palState.closed[title] = !palState.closed[title]; savePal(); h.classList.toggle("closed"); box.hidden = !!palState.closed[title]; h.setAttribute("aria-expanded", String(!box.hidden)); });
      body.appendChild(h); body.appendChild(box);
      return box;
    };
    const browse = () => {
      body.innerHTML = "";
      PALETTE.forEach(g => {
        const box = group(g.group);
        g.items.forEach(it => {
          if (it.sub) { const h = document.createElement("div"); h.className = "pal-sub"; h.textContent = it.sub; box.appendChild(h); return; }
          const [type, params, label] = it, def = LIB[type], p = Object.assign({}, def.defaults, params || {});
          box.appendChild(palItem(label || def.name, def.value({ params: p }), type, params));
        });
      });
      // tubes: the popular ones, or all of them by kind
      const box = group("Tubes", TUBE_DATABASE.length);
      const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "pal-more";
      toggle.textContent = palState.allTubes ? "Show popular tubes only" : `Show all ${TUBE_DATABASE.length} tubes`;
      toggle.addEventListener("click", () => { palState.allTubes = !palState.allTubes; savePal(); browse(); });
      if (palState.allTubes) {
        [["triode", "Triodes"], ["pentode", "Pentodes & beam tetrodes"], ["rectifier", "Rectifiers"]].forEach(([kind, title]) => {
          const h = document.createElement("div"); h.className = "pal-sub"; h.textContent = title; box.appendChild(h);
          TUBE_DATABASE.filter(t => tubeKind(t) === kind).forEach(t => box.appendChild(tubeItem(t)));
        });
      } else TUBE_DATABASE.filter(t => t.isFavorite).forEach(t => box.appendChild(tubeItem(t)));
      box.appendChild(toggle);
    };
    const find = q => {
      body.innerHTML = "";
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = valueHits(q).concat(index.filter(e => words.every(w => e[5].toLowerCase().includes(w))));
      if (!hits.length) { body.innerHTML = `<p class="pal-none">Nothing found for “${escH(q)}”.</p>`; return; }
      let last = null;
      hits.slice(0, 80).forEach(([g, label, sub, type, params]) => {
        if (g !== last) { const h = document.createElement("div"); h.className = "pal-sub"; h.textContent = g; body.appendChild(h); last = g; }
        body.appendChild(type === "tube" && typeof label === "object" ? tubeItem(label) : palItem(label, sub, type, params));
      });
    };
    const update = () => { const q = search.value.trim(); if (q) find(q); else browse(); };
    search.addEventListener("input", update);
    search.addEventListener("keydown", e => {
      if (e.key === "Enter") { const first = body.querySelector(".pal-item"); if (first) first.click(); }
      else if (e.key === "Escape") { search.value = ""; update(); search.blur(); }
    });
    update();
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
    if (channel) { try { channel.postMessage({ type: "SELECT_TUBE", id: c.id, tube: c.params.tube, label: c.label, def: window.SpiceModel && SpiceModel.isCustom(tubeByName(c.params.tube)) ? tubeByName(c.params.tube) : undefined }); } catch (e) {} }
  }

  let inspectorFor = null;
  // Cross-probing with the Board window: a part selected there is selected (and shown) here;
  // a selection made here goes to the board. probeSig keeps a selection from echoing back.
  let probeSig = "";
  const selSig = () => [...S.sel.comps].sort().join(",");
  function selectFromBoard(ids) {
    const want = new Set(ids || []), cs = S.comps.filter(c => want.has(c.id));
    if (!cs.length) return;
    S.sel.comps.clear(); S.sel.wires.clear(); cs.forEach(c => S.sel.comps.add(c.id));
    probeSig = selSig();
    const b = compBBox(cs[0]), cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, sx = cx * S.view.scale + S.view.ox, sy = cy * S.view.scale + S.view.oy;
    if (sx < 40 || sy < 40 || sx > canvas.clientWidth - 40 || sy > canvas.clientHeight - 40) { S.view.ox = canvas.clientWidth / 2 - cx * S.view.scale; S.view.oy = canvas.clientHeight / 2 - cy * S.view.scale; }
    updateInspector(); render();
  }
  function probeBoard() {
    const sig = selSig(); if (sig === probeSig) return;
    probeSig = sig;
    if (channel) { try { channel.postMessage({ type: "CAD_SELECT", ids: [...S.sel.comps] }); } catch (e) {} }
  }
  function updateInspector(liveOnly) {
    probeBoard();
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
          <p class="insp-help">Drag to move · R rotates parts · Del deletes · D duplicates · M mirrors.<br>Drag a wire segment sideways to move it; connected wires follow.</p>`;
      } else buildCircuitPanel(host);
    }
    const live = document.getElementById("insp-live");
    if (live) live.innerHTML = c ? liveReadout(c) : circuitReadout();
    renderBom();
  }

  function buildCompInspector(host, c) {
    const def = LIB[c.type];
    host.innerHTML = `<div class="insp-title">${def.name}</div>`;
    if (window.Hints) Hints.attach(host.firstChild, Hints.parts[c.type], def.name);
    if (!def.noLabel) host.appendChild(row("Designator", input("text", c.label, v => { c.label = v.trim() || c.label; commit(); })));
    (canMirror(c.type) ? def.fields.concat([CadLib.FLIP_FIELD]) : def.fields).forEach(f => {
      if (f.when && !f.when(c)) return;
      let el;
      if (f.kind === "eng") {
        el = input("text", f.optional && !(c.params[f.key] > 0) ? "" : fmtEng(c.params[f.key], ""), v => {
          if (f.optional && !String(v).trim()) { delete c.params[f.key]; commit(); return; }
          const n = parseEng(v);
          const allowNeg = f.key === "v" || f.key === "offset";
          if (!isFinite(n) || (!allowNeg && n < 0) || (n === 0 && !["offset", "rs", "v"].includes(f.key))) { flash(el); return; }
          c.params[f.key] = n; commit();
        });
        if (f.placeholder) el.placeholder = typeof f.placeholder === "function" ? f.placeholder(c) : f.placeholder;
      } else if (f.kind === "level") {
        // RMS / dBV view of a peak amplitude: Vrms = Vpk / crest factor (√2 sine, 1 square, √3 triangle)
        const crest = { sine: Math.SQRT2, square: 1, triangle: Math.sqrt(3) }[c.params.wave] || Math.SQRT2;
        const rms = c.params[f.key] / crest;
        const shown = f.as === "dbv" ? (rms > 0 ? (20 * Math.log10(rms)).toFixed(2).replace(/\.?0+$/, "") : "-inf") : fmtEng(rms, "");
        el = input("text", shown, v => {
          const n = f.as === "dbv" ? parseFloat(String(v).replace(/dBV?/i, "").replace("−", "-")) : parseEng(v);
          if (!isFinite(n) || (f.as !== "dbv" && n <= 0)) { flash(el); return; }
          c.params[f.key] = (f.as === "dbv" ? Math.pow(10, n / 20) : n) * crest; commit();
        });
      } else if (f.kind === "text") {
        el = input("text", c.params[f.key] || "", v => { c.params[f.key] = v; commit(); });
      } else if (f.kind === "number") {
        el = input("number", c.params[f.key] !== undefined ? c.params[f.key] : f.dflt, v => { const n = parseFloat(v); if (!isFinite(n)) { flash(el); return; } c.params[f.key] = Math.min(f.max !== undefined ? f.max : Infinity, Math.max(f.min !== undefined ? f.min : -Infinity, n)); commit(); });
      } else if (f.kind === "select") {
        el = document.createElement("select");
        (typeof f.options === "function" ? f.options(c) : f.options).forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; el.appendChild(o); });
        el.value = String(f.get ? f.get(c) : c.params[f.key]);
        if (el.selectedIndex < 0) el.selectedIndex = 0;   // a setting the part was saved without (e.g. Mirror) shows its default
        el.addEventListener("change", () => { if (c.type === "switch" && f.key === "pos") setSwitch(c, el.value); else if (f.apply) { f.apply(c, el.value); commit(); } else { c.params[f.key] = el.value; commit(); } });
      } else if (f.kind === "range") {
        const wrap = document.createElement("div"); wrap.className = "range-wrap";
        const r = document.createElement("input"); r.type = "range"; r.min = f.min; r.max = f.max; r.step = f.step; r.value = c.params[f.key];
        const lab = document.createElement("span"); lab.textContent = f.format(c.params[f.key]);
        r.addEventListener("input", () => { c.params[f.key] = parseFloat(r.value); lab.textContent = f.format(c.params[f.key]); S.topo = null; scheduleSim(60); render(); });
        r.addEventListener("change", () => commit());
        wrap.appendChild(r); wrap.appendChild(lab); el = wrap;
      } else if (f.kind === "tube") {
        const sel = document.createElement("select"), custom = t => window.SpiceModel && SpiceModel.isCustom(t);
        [["triode", "Triodes"], ["pentode", "Pentodes & beam tetrodes"], ["rectifier", "Rectifiers"], ["custom", "Imported (SPICE models)"]].forEach(([kind, title]) => {
          const list = TUBE_DATABASE.filter(t => (kind === "custom" ? custom(t) : !custom(t) && tubeKind(t) === kind));
          if (!list.length) return;
          const g = document.createElement("optgroup"); g.label = title;
          list.forEach(t => { const o = document.createElement("option"); o.value = t.commonName; o.textContent = `${t.commonName} — ${t.type}`; g.appendChild(o); });
          sel.appendChild(g);
        });
        sel.value = c.params.tube;
        sel.addEventListener("change", () => { c.params.tube = sel.value; c.params.connection = tubeKind(tubeByName(sel.value)) === "pentode" ? "pentode" : "triode"; commit(); });
        // a model of your own: paste or open a SPICE subcircuit
        const imp = document.createElement("button"); imp.className = "btn"; imp.id = "btn-import-spice"; imp.textContent = "Import SPICE model…";
        imp.title = "Use a tube model from Koren, Ayumi, Duncan, Reefman or a maker's library: paste or open its .SUBCKT";
        const done = entry => { c.params.tube = entry.commonName; c.params.connection = tubeKind(entry) === "pentode" ? "pentode" : "triode"; buildPalette(); commit(); setStatus("ok", `${entry.commonName} imported (${entry.custom.sub}) and set on ${c.label}`); };
        done.inUse = name => S.comps.some(k => k.type === "tube" && k.params.tube === name); done.changed = () => { buildPalette(); updateInspector(); };
        imp.onclick = () => SpiceImport.open(done);
        el = document.createElement("div"); el.className = "tube-pick"; el.appendChild(sel); el.appendChild(imp);
      }
      const r = row(f.label + (f.unit && f.kind !== "range" ? ` (${f.unit})` : ""), el, f.wide || f.kind === "tube");
      if (window.Hints) Hints.attach(r.firstChild, Hints.field(c.type, f.key) || Hints.label(f.label), f.label);
      host.appendChild(r);
    });
    if (c.type === "speaker" && c.params.model === "ts") host.appendChild(speakerPlot(c));
    if (c.type === "tube") {
      const t = tubeByName(c.params.tube);
      if (t) {
        const p = document.createElement("p"); p.className = "insp-help";
        p.textContent = t.custom
          ? `Imported SPICE model ${t.custom.sub}${t.custom.like ? ` · socket, pinout and heater of the ${t.custom.like}` : ""} · Va max ${t.vaMax} V · Pa max ${t.paMax} W`
          : `${t.nameWestern} · ${t.nameGost} · Va max ${t.vaMax} V · Pa max ${t.paMax} W · heater ${t.vh} V / ${t.ih} A (not simulated)`;
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
      // this scope's channels in the instrument windows
      const open = document.createElement("div"); open.className = "insp-open";
      open.innerHTML = `<div class="insp-sub">Open in</div><div class="insp-actions">${[["oscilloscope.html", "Oscilloscope", "Full oscilloscope: cursors, X-Y, power-on run"], ["spectrum_analyzer.html", "Spectrum", "Spectrum analyzer: harmonics and THD"], ["bode.html", "Bode", "Bode plotter: gain and phase against frequency"]].map(([f, t, tip]) => `<button class="btn link" data-win="${f}" title="${tip}">${t} ↗</button>`).join("")}</div>`;
      open.querySelectorAll("[data-win]").forEach(b => b.addEventListener("click", () => ToolWindows.open(b.dataset.win, { scope: c.id })));
      host.appendChild(open);
    }
    if (!def.noLabel) host.appendChild(row("Part number (BOM)", input("text", c.params.partno || "", v => { c.params.partno = v.trim(); commit(); })));
    const live = document.createElement("div"); live.id = "insp-live"; live.className = "insp-live";
    host.appendChild(live);
    const act = document.createElement("div"); act.className = "insp-actions";
    const ico = id => document.querySelector(`#${id} svg`).outerHTML;   // the toolbar's icons
    act.innerHTML = `<button class="btn" data-a="rot" title="Rotate (R)" ${def.noRotate ? "disabled" : ""}>${ico("btn-rotate")} Rotate</button><button class="btn" data-a="mir" title="Mirror left–right (M)" ${canMirror(c.type) ? "" : "disabled"}>${ico("btn-mirror")} Mirror</button><button class="btn danger" data-a="del" title="Delete (Del)">${ico("btn-delete")} Delete</button>`;
    act.querySelector('[data-a="rot"]').onclick = rotateSelection;
    act.querySelector('[data-a="mir"]').onclick = mirrorSelection;
    act.querySelector('[data-a="del"]').onclick = deleteSelection;
    host.appendChild(act);
  }

  // "1.4W · 64% of 2.2W": the share of the rating goes on a second, quieter line
  function kv(k, v, cls) {
    const m = /^(.*?) · (\d+% of .*)$/.exec(v);
    return `<div class="kv${cls ? " " + cls : ""}"><span>${k}</span><b>${m ? `${m[1]}<small>${m[2]}</small>` : v}</b></div>`;
  }

  function liveReadout(c) {
    const r = S.sim.result;
    if (!r) return `<div class="insp-sub">Operating point${simPct()}</div><p class="insp-help">${S.sim.error || (S.sim.busy ? "Simulating…" : "Not simulated yet.")}</p>`;
    let h = `<div class="insp-sub">Operating point${simPct()}</div>`;
    const vAcross = (a, b) => { const na = pinNetOf(c, a), nb = pinNetOf(c, b); const va = netDC(na), vb = netDC(nb); return va === null || vb === null ? null : va - vb; };
    const pAvg = (a, b, R) => { const wa = waveOf(c, a), wb = waveOf(c, b); if (!wa || !wb) { const v = vAcross(a, b); return v === null ? null : v * v / R; } let s = 0; for (let i = 0; i < wa.length; i++) { const v = wa[i] - wb[i]; s += v * v; } return s / wa.length / R; };
    switch (c.type) {
      case "tube": {
        const d = tubeData(c);
        if (!d) return h + `<p class="insp-help">No data.</p>`;
        if (d.kind === "rectifier") {
          h += kv("Anode 1 current", fmtEng(d.a1 ? d.a1.i : 0, "A")) + kv("Anode 2 current", fmtEng(d.a2 ? d.a2.i : 0, "A"));
          h += limitRows(c);
          return h + `<p class="insp-help">Anode currents are averages over the settled cycle; the peak is drawn while the reservoir capacitor charges.</p>`;
        }
        const dc = d.dc;
        const pa = dc.vak * dc.ia, over = pa > d.paMax;
        h += kv("Va (anode–cathode)", fmtEng(dc.vak, "V", 1), dc.vak > d.vaMax ? "bad" : "");
        h += kv(d.kind === "pentode" ? "Vg1k (bias)" : "Vgk (bias)", fmtEng(dc.vgk, "V", 2), dc.vgk > 0 ? "warn" : "");
        if (d.kind === "pentode") { const l = tubeLimits(c).find(o => o.key === "Vg2k"); h += kv("Vg2k (screen)", fmtEng(dc.vg2k, "V", 1) + (l ? ` · ${Math.round(l.share * 100)}% of ${l.lim}` : ""), l && l.share > 1 ? "bad" : ""); }
        h += kv("Ia (anode current)", fmtEng(dc.ia, "A", 2));
        if (d.kind === "pentode") h += kv("Ig2 (screen current)", fmtEng(dc.ig2, "A", 2));
        h += kv("Pa (dissipation)", `${fmtEng(pa, "W", 2)} · ${Math.round(pa / d.paMax * 100)}% of ${d.paMax} W`, over ? "bad" : (pa > 0.85 * d.paMax ? "warn" : ""));
        h += limitRows(c);
        if (d.metrics) {
          h += `<div class="insp-sub">With signal</div>`;
          h += kv("Plate swing", fmtEng(d.metrics.vakPP, "Vpp", 1)) + kv("Grid swing", fmtEng(d.metrics.vgkPP, "Vpp", 2));
          if (d.metrics.gain) h += kv("Plate/grid gain", d.metrics.gain.toFixed(1) + "×");
          if (d.metrics.thd !== null) h += kv("THD at plate", d.metrics.thd.toFixed(2) + " %", d.metrics.thd > 5 ? "warn" : "");
          h += kv("Average Pa", fmtEng(d.metrics.pAvg, "W", 2), d.metrics.pAvg > d.paMax ? "bad" : "");
        }
        if (dc.vgk > 0) h += `<p class="insp-help warn">Grid is positive: grid current flows.</p>`;
        return h + tubeBiasReadout(c, d);
      }
      case "resistor": case "pot": {
        if (c.type === "pot") { h += kv("Wiper DC", fmtEng(netDC(pinNetOf(c, "W")), "V", 2)); return h + biasPartReadout(c); }
        const v = vAcross("1", "2"), p = resistorPower(c), w = +c.params.w;
        h += kv("Voltage (DC)", fmtEng(v, "V", 2)) + kv("Current (DC)", fmtEng(v / c.params.r, "A", 2));
        // rated: share of the rating (over 60 % runs hot: derate about 2×); unrated: flag above 1 W
        h += w ? kv("Power (avg)", `${fmtEng(p, "W", 2)} · ${Math.round(p / w * 100)}% of ${w} W`, p > w ? "bad" : p > 0.6 * w ? "warn" : "")
               : kv("Power (avg)", fmtEng(p, "W", 2), p > 1 ? "warn" : "");
        return h + biasPartReadout(c);
      }
      case "capacitor": case "electrolytic": {
        const v = c.type === "electrolytic" ? vAcross("+", "-") : vAcross("1", "2");
        h += kv("DC voltage across", fmtEng(v, "V", 1), c.type === "electrolytic" && v < -0.5 ? "bad" : "");
        if (c.type === "electrolytic" && v < -0.5) h += `<p class="insp-help warn">Reverse-biased electrolytic.</p>`;
        return h;
      }
      case "npn": case "pnp": case "nmos": case "pmos": {
        const dev = r.dc.devices[c.id], d = dev && dev.main, m = (c.type === "npn" || c.type === "pnp" ? CadLib.BJTS : CadLib.MOSFETS)[c.params.model];
        if (!d || !m) return h + `<p class="insp-help">No data.</p>`;
        const bip = c.type === "npn" || c.type === "pnp", vMain = bip ? d.vce : d.vds, iMain = bip ? d.ic : d.id;
        h += kv(bip ? "Vce" : "Vds", fmtEng(vMain, "V", 2), Math.abs(vMain) > m.v ? "bad" : Math.abs(vMain) > 0.8 * m.v ? "warn" : "");
        h += kv(bip ? "Vbe" : "Vgs", fmtEng(bip ? d.vbe : d.vgs, "V", 3));
        h += kv(bip ? "Ic" : "Id", fmtEng(iMain, "A", 2), Math.abs(iMain) > m.i ? "bad" : "");
        if (bip) h += kv("Ib", fmtEng(d.ib, "A", 2)) + kv("hFE (Ic/Ib)", Math.abs(d.ib) > 1e-12 ? (d.ic / d.ib).toFixed(0) : "—");
        // germanium: the leakage at the part's temperature, and how much of Ic it makes up ((hFE + 1)·ICBO)
        if (bip && m.ge) { const a = CadLib.bjtAt(m, c.params.temp), iceo = (a.bf + 1) * a.icbo; h += kv(`Leakage at ${+a.t.toFixed(1)} °C`, `ICBO ${fmtEng(a.icbo, "A", 2)} · ×hFE ≈ ${fmtEng(iceo, "A", 2)}`, Math.abs(d.ic) > 0 && iceo > 0.5 * Math.abs(d.ic) ? "warn" : ""); }
        h += kv("Dissipation", `${fmtEng(d.pd, "W", 2)} · ${Math.round(d.pd / m.p * 100)}% of ${m.p} W`, d.pd > m.p ? "bad" : d.pd > 0.6 * m.p ? "warn" : "");
        if (bip && d.vce < 0.3 && d.ic > 1e-6) h += `<p class="insp-help warn">Saturated (Vce below 0.3 V).</p>`;
        if (!bip && Math.abs(iMain) < 1e-6) h += `<p class="insp-help">Off: Vgs below the threshold.</p>`;
        if (m.p > 2) h += `<p class="insp-help">Rated ${m.p} W with the case at 25 °C: needs a heatsink well before that.</p>`;
        return h;
      }
      case "zener": case "led": case "diode": {
        const v = vAcross("A", "K"), i = pinCurrent(c, "A");
        h += kv("Voltage (A–K)", fmtEng(v, "V", 3)) + kv("Current (A→K)", fmtEng(i, "A", 2));
        if (c.type === "zener") { const z = CadLib.ZENERS[c.params.model], p = Math.abs(v * i); if (z) h += kv("Dissipation", `${fmtEng(p, "W", 2)} · ${Math.round(p / z.p * 100)}% of ${z.p} W`, p > z.p ? "bad" : p > 0.6 * z.p ? "warn" : ""); }
        if (c.type === "led") { const l = CadLib.LEDS[c.params.color]; if (l && i > l.i) h += `<p class="insp-help warn">Above the ${l.i * 1000} mA maximum.</p>`; }
        return h;
      }
      case "inductor": {
        const v = vAcross("1", "2"); h += kv("DC current", fmtEng(v / Math.max(c.params.dcr, 1e-3), "A", 2)) + kv("DC drop", fmtEng(v, "V", 2)); return h;
      }
      case "speaker": {
        const sp = speakerPower(c), f = signalFreq();
        if (sp) h += kv("Output power", fmtEng(sp.p, "W", 2)) + kv("Voltage", fmtEng(sp.vrms, "Vrms", 2));
        else { const p = pAvg("+", "-", c.params.r); h += kv("Output power", fmtEng(p, "W", 2)); }
        if (c.params.model === "ts" && f) { const [z, ph] = CadLib.speakerZ(c.params, f); h += kv(`Impedance at ${fmtEng(f, "Hz")}`, `${fmtEng(z, "Ω", 3)} · ${ph >= 0 ? "+" : ""}${ph.toFixed(0)}°`); }
        return h;
      }
      case "vdc": {
        const dev = r.dc.devices[c.id];
        const i = dev && dev.main ? -dev.main.i : null;
        h += kv("Current supplied", fmtEng(i, "A", 2)) + kv("Power", fmtEng(i !== null ? i * c.params.v : null, "W", 2)); return h;
      }
      case "opt_se": case "opt_cat": case "opt_pp": {
        if (c.type === "opt_cat") {
          const i = otDcCurrent(c), m = CadLib.OUTPUT_TX[c.params.model];
          if (i !== null && m) h += kv("Primary DC current", `${fmtEng(i, "A", 2)} · ${Math.round(i * 1000 / m.ma * 100)}% of ${m.ma} mA`, i * 1000 > m.ma ? "bad" : i * 1000 > 0.9 * m.ma ? "warn" : "");
        }
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
      <button class="btn wide" id="btn-renumber" title="Letter code (R, C, L, T, VL …) and number for every part, in reading order">Renumber designations</button>
      <p class="insp-help">Click a part to see and edit it. Help and keyboard shortcuts: <kbd>F1</kbd> or the <b>?</b> button.</p>`;
    const rb = host.querySelector("#btn-renumber"); if (rb) rb.addEventListener("click", renumber);
  }
  // where the power goes: output into speakers, dissipation per kind of part, what the DC supplies deliver
  function powerSummary() {
    const r = S.sim.result; if (!r) return "";
    let out = 0, tubes = 0, res = 0, semi = 0, sup = 0, haveSup = false;
    S.comps.forEach(c => {
      if (c.type === "speaker") { const sp = speakerPower(c); if (sp) out += sp.p; }
      else if (c.type === "resistor") { const p = resistorPower(c); if (p) res += p; }
      else if (c.type === "tube") { const d = tubeData(c); if (d && d.dc && d.kind !== "rectifier") tubes += (d.metrics ? d.metrics.pAvg : d.dc.vak * d.dc.ia) + (d.dc.vg2k && d.dc.ig2 ? d.dc.vg2k * d.dc.ig2 : 0); }
      else if (/^(npn|pnp|nmos|pmos)$/.test(c.type)) { const d = (r.dc.devices[c.id] || {}).main; if (d && d.pd > 0) semi += d.pd; }
      else if (c.type === "vdc") { const d = (r.dc.devices[c.id] || {}).main; if (d) { sup += -d.i * c.params.v; haveSup = true; } }
    });
    let h = `<div class="insp-sub">Power</div>`;
    if (out > 0) h += kv("Output (speakers)", fmtEng(out, "W", 2));
    if (tubes > 0) h += kv("Tubes (anode + screen)", fmtEng(tubes, "W", 2));
    if (semi > 0) h += kv("Transistors", fmtEng(semi, "W", 2));
    if (res > 0) h += kv("Resistors", fmtEng(res, "W", 2));
    if (haveSup) h += kv("From DC supplies", fmtEng(sup, "W", 2));
    return h;
  }

  function circuitReadout() {
    const T = topo();
    const counts = {};
    S.comps.forEach(c => { counts[c.type] = (counts[c.type] || 0) + 1; });
    let h = kv("Parts · wires · nets", `${S.comps.length} · ${S.wires.length} · ${T.nodeCount}`) + powerSummary();
    const issues = [];
    if (hasCircuit() && !T.hasGround) issues.push("No ground symbol.");
    const open = [];
    S.comps.forEach(c => { if (c.type === "scope") return; compPins(c).forEach(p => { if (!T.pinConnected.get(c.id + ":" + p.id)) { if (c.type === "opt_pp" && (p.id === "U1" || p.id === "U2")) return; open.push(`${c.label || LIB[c.type].name}.${p.id}`); } }); });
    const lonely = S.comps.filter(c => c.type === "offsheet" && !connRefs(c).length && !S.comps.some(k => k !== c && k.type === "offsheet" && connName(k) === connName(c))).map(c => c.params.name || "(no name)");
    if (lonely.length) issues.push("Sheet connectors without a partner: " + lonely.join(", "));
    if (open.length) issues.push("Unconnected pins: " + open.slice(0, 8).join(", ") + (open.length > 8 ? ` (+${open.length - 8})` : ""));
    // parts whose terminals are wired together
    const shortPairs = { resistor: [["1", "2"]], capacitor: [["1", "2"]], electrolytic: [["+", "-"]], inductor: [["1", "2"]], speaker: [["+", "-"]], diode: [["A", "K"]], zener: [["A", "K"]], led: [["A", "K"]], npn: [["C", "E"]], pnp: [["C", "E"]], nmos: [["D", "S"]], pmos: [["D", "S"]], vdc: [["+", "-"]], siggen: [["+", "-"]],
      opt_se: [["P1", "P2"], ["S1", "S2"]], opt_cat: [["P1", "P2"], ["S1", "S2"]], opt_pp: [["P1", "CT"], ["CT", "P2"], ["S1", "S2"]], ptx: [["HT1", "CT"], ["CT", "HT2"]] };
    const shorted = [];
    S.comps.forEach(c => (shortPairs[c.type] || []).forEach(([a, b]) => {
      const na = T.pinNet.get(c.id + ":" + a), nb = T.pinNet.get(c.id + ":" + b);
      if (na !== undefined && na === nb && T.pinConnected.get(c.id + ":" + a)) shorted.push(`${c.label}(${a}–${b})`);
    }));
    if (shorted.length) issues.push("Shorted by wiring: " + shorted.join(", "));
    if (S.sim.error) issues.push(S.sim.error);
    (S.sim.warnings || []).forEach(w => issues.push(w));
    S.comps.forEach(c => { if (c.type !== "opt_cat") return; const i = otDcCurrent(c), m = CadLib.OUTPUT_TX[c.params.model]; if (i !== null && m && i * 1000 > m.ma) issues.push(`${c.label} (${m.name}) carries ${(i * 1000).toFixed(0)} mA DC, more than its ${m.ma} mA rating.`); });
    S.comps.forEach(c => { if (c.type !== "resistor" || !+c.params.w) return; const p = resistorPower(c); if (p !== null && p > +c.params.w) issues.push(`${c.label} dissipates ${fmtEng(p, "W", 2)}, more than its ${+c.params.w} W rating.`); });
    S.comps.forEach(c => {
      if (!/^(npn|pnp|nmos|pmos)$/.test(c.type) || !S.sim.result) return;
      const d = (S.sim.result.dc.devices[c.id] || {}).main, m = (c.type === "npn" || c.type === "pnp" ? CadLib.BJTS : CadLib.MOSFETS)[c.params.model];
      if (!d || !m) return;
      const v = Math.abs(d.vce !== undefined ? d.vce : d.vds);
      if (d.pd > m.p) issues.push(`${c.label} (${c.params.model}) dissipates ${fmtEng(d.pd, "W", 2)}, more than its ${m.p} W rating.`);
      if (v > m.v) issues.push(`${c.label} (${c.params.model}) has ${v.toFixed(0)} V across it, more than its ${m.v} V rating.`);
    });
    S.comps.forEach(c => { if (c.type !== "zener" || !S.sim.result) return; const z = CadLib.ZENERS[c.params.model], v = netDC(pinNetOf(c, "A")), w = netDC(pinNetOf(c, "K")), i = pinCurrent(c, "A"); if (z && v !== null && w !== null && i !== null && Math.abs((v - w) * i) > z.p) issues.push(`${c.label} (${c.params.model}) dissipates ${fmtEng(Math.abs((v - w) * i), "W", 2)}, more than its ${z.p} W rating.`); });
    // tubes: the plate's average dissipation over the signal cycle (with a reactive load the
    // path may cross the Pa max curve for part of a cycle, which is normal); the DC value without signal
    S.comps.forEach(c => {
      if (c.type !== "tube") return; const d = tubeData(c); if (!d || !d.dc || d.kind === "rectifier") return;
      const avg = d.metrics ? d.metrics.pAvg : null, dc = d.dc.vak * d.dc.ia;
      if (avg !== null && avg > d.paMax) issues.push(`${c.label} over dissipation: ${avg.toFixed(1)} W on average over the signal cycle > ${d.paMax} W.`);
      else if (avg === null && dc > d.paMax) issues.push(`${c.label} over dissipation (${dc.toFixed(1)} W > ${d.paMax} W).`);
    });
    S.comps.forEach(c => { if (c.type === "tube") tubeLimits(c).forEach(o => { if (o.share > 1) issues.push(o.text); }); });
    h += `<div class="insp-sub">Checks${simPct()}</div>` + (issues.length ? issues.map(i => `<p class="insp-help warn">⚠ ${i}</p>`).join("") : `<p class="insp-help ok">✓ No problems found.</p>`);
    return h;
  }

  // a loudspeaker's impedance (solid) and phase (dotted) from 10 Hz to 20 kHz, the nominal value dashed
  function speakerPlot(c) {
    const wrap = document.createElement("div"); wrap.className = "spk-plot";
    const cv = document.createElement("canvas"); cv.width = 300; cv.height = 150; cv.id = "spk-plot"; wrap.appendChild(cv);
    const x = cv.getContext("2d"), W = cv.width, H = cv.height, L = 30, Rm = 28, T = 8, B = 18, f1 = 10, f2 = 20000;
    const pts = Array.from({ length: 161 }, (_, i) => { const f = f1 * Math.pow(f2 / f1, i / 160); return [f, ...CadLib.speakerZ(c.params, f)]; });
    const zmax = Math.max(...pts.map(p => p[1])) * 1.1, X = f => L + (W - L - Rm) * Math.log(f / f1) / Math.log(f2 / f1), Y = z => H - B - (H - B - T) * z / zmax, P = ph => T + (H - B - T) * (90 - ph) / 180;
    x.fillStyle = "#0b0f14"; x.fillRect(0, 0, W, H); x.font = "9px ui-monospace, monospace";
    [10, 100, 1000, 10000].forEach(f => { x.strokeStyle = "#1b2430"; x.beginPath(); x.moveTo(X(f), T); x.lineTo(X(f), H - B); x.stroke(); x.fillStyle = "#6e7781"; x.fillText(f >= 1000 ? f / 1000 + "k" : String(f), X(f) - 6, H - 5); });
    [0, 0.5, 1].forEach(k => { const z = zmax / 1.1 * k; x.fillStyle = "#6e7781"; x.fillText(z.toFixed(0), 3, Y(z) + 3); });
    x.font = "9px sans-serif"; x.fillText("|Z| Ω", L + 3, T + 8); x.font = "9px ui-monospace, monospace";
    ["+90°", "0°", "−90°"].forEach((t, k) => { x.fillStyle = "#6e7781"; x.fillText(t, W - Rm + 3, T + (H - B - T) * k / 2 + 3); });
    x.strokeStyle = "#8b949e"; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(L, Y(c.params.r)); x.lineTo(W - Rm, Y(c.params.r)); x.stroke(); x.setLineDash([]);
    x.strokeStyle = "#ffd54f"; x.lineWidth = 1.5; x.beginPath(); pts.forEach(([f, z], i) => (i ? x.lineTo(X(f), Y(z)) : x.moveTo(X(f), Y(z)))); x.stroke();
    x.strokeStyle = "#58a6ff"; x.lineWidth = 1; x.setLineDash([2, 2]); x.beginPath(); pts.forEach(([f, , ph], i) => (i ? x.lineTo(X(f), P(ph)) : x.moveTo(X(f), P(ph)))); x.stroke(); x.setLineDash([]);
    // the resonance peak near fs, and the lowest point between it and the voice coil's rise
    const fs = c.params.fs, near = pts.filter(p => p[0] > fs / 3 && p[0] < fs * 3), peak = (near.length ? near : pts).reduce((a, p) => (p[1] > a[1] ? p : a));
    const above = pts.filter(p => p[0] > peak[0] && p[0] < 10000), dip = above.reduce((a, p) => (p[1] < a[1] ? p : a), above[0] || peak);
    const ph = pts.reduce((a, p) => (Math.abs(p[2]) > Math.abs(a) ? p[2] : a), 0);
    const note = document.createElement("p"); note.className = "insp-help";
    note.textContent = `Impedance (yellow) and phase (blue): ${peak[1].toFixed(0)} Ω at ${peak[0].toFixed(0)} Hz, ${dip[1].toFixed(1)} Ω at ${dip[0] >= 1000 ? (dip[0] / 1000).toFixed(1) + " kHz" : dip[0].toFixed(0) + " Hz"} at the lowest above it, phase up to ${ph >= 0 ? "+" : ""}${ph.toFixed(0)}°. The tube sees this through the output transformer.`;
    wrap.appendChild(note);
    return wrap;
  }

  function row(label, el, wide) {
    const d = document.createElement("label"); d.className = "row" + (wide ? " wide" : "");
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
  // the format dialog serves both New (a fresh circuit) and Add sheet (one more frame)
  function openSheetDialog(mode) {
    const m = document.getElementById("new-modal"); m.dataset.mode = mode;
    m.querySelector(".insp-title").textContent = mode === "add" ? "Add sheet" : "New circuit";
    m.querySelector(".insp-help").textContent = mode === "add"
      ? "A further sheet of this circuit, to the right of the last one, with the same title block. Join wires between sheets with Sheet connectors (Sources) of the same name."
      : "The sheet starts with an IEC 61082 drawing frame: ISO 5457 border, reference grid and an ISO 7200 title block.";
    document.getElementById("new-title").placeholder = mode === "add" ? "Sheet title (empty: same as sheet 1)" : "e.g. 2 × EL84 single-ended amplifier";
    document.getElementById("btn-new-create").textContent = mode === "add" ? "Add" : "Create";
    m.hidden = false; document.getElementById("new-title").focus();
  }
  function newCircuit(opts) {
    opts = Object.assign({ size: "A3", orient: "landscape", title: "" }, opts);
    const f = makeComp("frame", { size: opts.size, orient: opts.orient, title: opts.title, date: new Date().toISOString().slice(0, 10) }, 0, 0, 0);
    S.comps = [f]; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
    setCurFile(null, "");
    storeBoard(null);
    commit(); fitView(); markClean();
    sendBoardNetlist(true);
  }
  // Add sheet: a new frame to the right of the last one, with the same title block data
  function addSheet(opts) {
    const list = frames(), last = list[list.length - 1], first = list[0];
    const p = Object.assign({}, first ? first.params : { date: new Date().toISOString().slice(0, 10) }, { size: opts.size, orient: opts.orient, sheet: "" });
    if (opts.title) p.title = opts.title;
    let x = 0, y = 0;
    if (last) { const b = compBBox(last); x = Math.ceil((b.x2 + 100) / 100) * 100; y = first.y; }   // on the grid, so parts drawn on it snap into place
    const f = makeComp("frame", p, x, y, 0); f.x = x; f.y = y;
    S.comps.push(f);
    commit(); updateSheetNav(); fitSheet(f);
    return f;
  }
  function fitBox(x1, y1, x2, y2) {
    const W = canvas.clientWidth, H = canvas.clientHeight, m = 40;
    const s = Math.min(3, Math.max(0.05, Math.min((W - 2 * m) / Math.max(x2 - x1, 1), (H - 2 * m) / Math.max(y2 - y1, 1))));
    S.view.scale = s; S.view.ox = W / 2 - (x1 + x2) / 2 * s; S.view.oy = H / 2 - (y1 + y2) / 2 * s;
    updateZoomLabel(); render();
  }
  // Fit (button or F): the sheet you are working on, which is the one holding the selection,
  // else the one clicked last (while it is on screen), else the one filling most of the
  // view. When that sheet already fills the view, or no sheet is on screen, everything.
  function currentSheet() {
    const list = frames(); if (!list.length) return null;
    const box = f => compBBox(f), inside = (b, x, y) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
    const W = canvas.clientWidth, H = canvas.clientHeight, v1 = toWorld(0, 0), v2 = toWorld(W, H);
    const visible = b => Math.max(0, Math.min(b.x2, v2.x) - Math.max(b.x1, v1.x)) * Math.max(0, Math.min(b.y2, v2.y) - Math.max(b.y1, v1.y));
    const at = (x, y) => list.find(f => inside(box(f), x, y));
    const sel = S.comps.find(c => S.sel.comps.has(c.id));
    if (sel) { if (sel.type === "frame") return sel; const b = compBBox(sel), f = at((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2); if (f) return f; }
    const w = S.wires.find(w => S.sel.wires.has(w.id));
    if (w) { const f = at((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2); if (f) return f; }
    if (S.lastClick) { const f = at(S.lastClick.x, S.lastClick.y); if (f && visible(box(f)) > 0) return f; }
    let best = null, area = 0;
    list.forEach(f => { const a = visible(box(f)); if (a > area) { area = a; best = f; } });
    return best;
  }
  function fitCurrent() {
    const f = currentSheet();
    if (f) {
      const before = [S.view.scale, S.view.ox, S.view.oy];
      fitSheet(f);
      if (Math.abs(S.view.scale / before[0] - 1) > 0.01 || Math.abs(S.view.ox - before[1]) > 2 || Math.abs(S.view.oy - before[2]) > 2) return;
    }
    const nav = document.getElementById("sheet-nav"); if (nav) nav.value = "";
    fitView();
  }
  // opening a circuit: its first sheet when it has several (the Sheet list and F show all)
  function fitStart() { const list = frames(); if (list.length > 1) fitSheet(list[0]); else fitView(); }
  function fitSheet(f) { const b = compBBox(f); fitBox(b.x1, b.y1, b.x2, b.y2); const nav = document.getElementById("sheet-nav"); if (nav) nav.value = f.id; }
  // the Sheet selector in the toolbar: all sheets, or zoom to one
  function updateSheetNav() {
    const nav = document.getElementById("sheet-nav"); if (!nav) return;
    const list = frames(), cur = nav.value;
    nav.hidden = list.length < 2;
    nav.innerHTML = `<option value="">All sheets</option>` + list.map((f, i) => `<option value="${f.id}">Sheet ${sheetNo(f, list)}${f.params.title ? " · " + f.params.title.replace(/[<&]/g, "") : ""}</option>`).join("");
    nav.value = list.some(f => f.id === cur) ? cur : "";
  }
  // file name from the title block (or a default)
  function baseName() {
    const f = S.comps.find(c => c.type === "frame"), t = f && (f.params.docno || f.params.title);
    return (t ? t.replace(/[^\w.\- ]+/g, "").trim().replace(/\s+/g, "-") : "") || "tube-circuit";
  }
  // Save as PDF: the sheet in vector form, black on white. With a drawing frame the
  // page is that sheet (A4…A1, landscape or portrait, 1:1); without one, the drawing's bounds.
  // drawing bounds of everything (a circuit without a drawing frame)
  function drawingBounds() {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    S.comps.forEach(c => { const b = compBBox(c); x1 = Math.min(x1, b.x1 - 60); y1 = Math.min(y1, b.y1 - 40); x2 = Math.max(x2, b.x2 + 60); y2 = Math.max(y2, b.y2 + 40); });
    S.wires.forEach(w => { x1 = Math.min(x1, w.x1, w.x2); y1 = Math.min(y1, w.y1, w.y2); x2 = Math.max(x2, w.x1, w.x2); y2 = Math.max(y2, w.y1, w.y2); });
    return isFinite(x1) ? { x1, y1, x2, y2 } : { x1: 0, y1: 0, x2: 1188, y2: 840 };
  }
  // sheets: the frames to print (default all), one page each; name: the file name without .pdf
  function exportPDF(download, sheets, name) {
    const MMU = CadLib.MM, k = 72 / 25.4 / MMU;         // pt per drawing unit
    const list = sheets || frames(), f = list[0];
    let page;
    if (f) page = list.map(fr => { const g = CadLib.sheetGeom(fr); return { widthPt: g.W * k, heightPt: g.H * k, k, ox: fr.x, oy: fr.y, frame: fr }; });
    else { const { x1, y1, x2, y2 } = drawingBounds(); page = { widthPt: (x2 - x1) * k, heightPt: (y2 - y1) * k, k, ox: x1, oy: y1 }; }
    const bytes = PdfExport.buildPdf(page, (pc, i) => drawSheet(pc, Array.isArray(page) ? page[i].frame : null), { title: f && f.params.title });
    if (download !== false) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const file = (name || baseName()) + ".pdf";
      a.download = file; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setStatus("ok", `Saved ${file} (${list.length > 1 ? list.length + " sheets, " : ""}${Math.round(bytes.length / 1024)} kB)`);
    }
    return bytes;
  }
  // the printable drawing: frame, conductors, junctions and parts (no grid, tags or selection);
  // with a frame given, only what lies on that sheet
  function drawSheet(target, frame) {
    const keep = ctx; ctx = target; S.printing = true;
    try {
      const T = topo();
      let on = () => true;
      if (frame) { const b = compBBox(frame); on = (x1, y1, x2, y2) => x2 >= b.x1 && x1 <= b.x2 && y2 >= b.y1 && y1 <= b.y2; }
      const onComp = c => { const b = compBBox(c); return on(b.x1, b.y1, b.x2, b.y2); };
      S.comps.forEach(c => { if (c.type === "frame" && (!frame || c === frame)) drawComp(c, false, false); });
      ctx.lineCap = "round"; ctx.strokeStyle = "#3fb950"; ctx.lineWidth = 2;
      S.wires.forEach(w => { if (!on(Math.min(w.x1, w.x2), Math.min(w.y1, w.y2), Math.max(w.x1, w.x2), Math.max(w.y1, w.y2))) return; ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke(); });
      ctx.fillStyle = "#3fb950";
      T.junctions.forEach(j => { if (!on(j.x, j.y, j.x, j.y)) return; ctx.beginPath(); ctx.arc(j.x, j.y, 4, 0, Math.PI * 2); ctx.fill(); });
      S.comps.forEach(c => { if (c.type !== "frame" && onComp(c)) drawComp(c, false, false); });
    } finally { ctx = keep; S.printing = false; }
  }
  // ---------------------------------------------------------------------------
  // Bill of materials: a panel under the schematic (B), exported as TXT, CSV, XLSX or PDF
  // ---------------------------------------------------------------------------
  const BOM_KEY = "tubecad_bom";
  const bomOpts = { open: false, sockets: true, bench: false, height: 0 };
  try { Object.assign(bomOpts, JSON.parse(localStorage.getItem(BOM_KEY)) || {}); } catch (e) {}
  const saveBomOpts = () => { try { localStorage.setItem(BOM_KEY, JSON.stringify(bomOpts)); } catch (e) {} };
  let bomStale = false, bomSelShown = "";
  // simulated worst case of a part: dissipation of resistors, transistors and zeners (against
  // their ratings), capacitor peak voltage, LED current
  function partStress(c) {
    if (!S.sim.result) return null;
    if (c.type === "resistor") {
      const p = resistorPower(c);
      return p === null ? null : { v: p, text: fmtEng(p, "W"), warn: +c.params.w > 0 && p > +c.params.w };
    }
    if (c.type === "capacitor" || c.type === "electrolytic") {
      const [a, b] = c.type === "capacitor" ? ["1", "2"] : ["+", "-"], wa = waveOf(c, a), wb = waveOf(c, b);
      const va = netDC(pinNetOf(c, a)), vb = netDC(pinNetOf(c, b));
      let v = null;
      if (wa && wb) { v = 0; for (let i = 0; i < wa.length; i++) v = Math.max(v, Math.abs(wa[i] - wb[i])); }
      else if (va !== null && vb !== null) v = Math.abs(va - vb);
      if (v === null) return null;
      const reversed = c.type === "electrolytic" && va !== null && vb !== null && va - vb < -1;
      return { v, text: fmtEng(v, "V"), warn: reversed, note: "reversed" };
    }
    if (/^(npn|pnp|nmos|pmos)$/.test(c.type)) {
      const d = (S.sim.result.dc.devices[c.id] || {}).main, m = (c.type === "npn" || c.type === "pnp" ? CadLib.BJTS : CadLib.MOSFETS)[c.params.model];
      return d && m ? { v: d.pd, text: fmtEng(d.pd, "W"), warn: d.pd > m.p } : null;
    }
    if (c.type === "zener" || c.type === "led") {
      const i = pinCurrent(c, "A"), va = netDC(pinNetOf(c, "A")), vk = netDC(pinNetOf(c, "K"));
      if (i === null || va === null || vk === null) return null;
      if (c.type === "led") { const l = CadLib.LEDS[c.params.color]; return { v: Math.abs(i), text: fmtEng(Math.abs(i), "A"), warn: !!l && i > l.i }; }
      const z = CadLib.ZENERS[c.params.model], p = Math.abs((va - vk) * i);
      return { v: p, text: fmtEng(p, "W"), warn: !!z && p > z.p };
    }
    return null;
  }
  function bomData() {
    const f = frames()[0], p = f ? f.params : {};
    return { rows: BomLib.build(S.comps, { sockets: bomOpts.sockets, bench: bomOpts.bench, stress: partStress }),
      title: p.title || "", docno: p.docno || "", rev: p.rev || "", date: p.date || new Date().toISOString().slice(0, 10) };
  }
  const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  function renderBom() {
    const host = document.getElementById("bom");
    if (!host || host.hidden) return;
    // don't rebuild under a part number being typed; catch up when it loses focus
    const a = document.activeElement;
    if (a && a.tagName === "INPUT" && host.contains(a) && a.closest("#bom-table")) { bomStale = true; return; }
    bomStale = false;
    const bom = bomData(), table = document.getElementById("bom-table");
    const parts = bom.rows.reduce((n, r) => n + r.qty, 0);
    document.getElementById("bom-count").textContent = bom.rows.length ? `${bom.rows.length} lines · ${parts} parts` + (S.sim.result ? "" : " · simulate for the Sim. max column") : "";
    if (!bom.rows.length) { table.innerHTML = `<tbody><tr><td class="bom-empty">No parts yet. Place resistors, capacitors, tubes, transformers… and they are listed here.</td></tr></tbody>`; return; }
    const tip = { sim: "Simulated worst case: dissipation (resistors, transistors, zeners), capacitor peak voltage, LED current", partno: "Your order or manufacturer number; saved with the circuit" };
    table.innerHTML = `<thead><tr>${BomLib.COLUMNS.map(c => `<th${tip[c.key] ? ` title="${tip[c.key]}"` : ""}>${c.title}</th>`).join("")}</tr></thead><tbody>` +
      bom.rows.map((r, i) => `<tr data-i="${i}"${r.ids.some(id => S.sel.comps.has(id)) ? ' class="sel"' : ""}>
        <td class="n">${r.item}</td><td class="n">${r.qty}</td><td class="mono">${esc(r.refs)}</td><td>${esc(r.desc)}</td><td class="mono">${esc(r.value)}</td>
        <td>${esc(r.rating)}</td><td class="mono${r.warn ? " warn" : ""}">${esc(r.sim)}</td>
        <td>${r.socket ? "" : `<input type="text" value="${esc(r.partno)}" spellcheck="false" aria-label="Part number for ${esc(r.refs)}">`}</td></tr>`).join("") + "</tbody>";
    // a new selection on the sheet scrolls its line into view and flashes it
    const sel = [...S.sel.comps].sort().join(), first = table.querySelector("tbody tr.sel");
    if (sel !== bomSelShown) {
      bomSelShown = sel;
      if (first) {
        const box = table.parentElement, head = table.querySelector("thead").offsetHeight, top = first.offsetTop - head;
        if (top < box.scrollTop || first.offsetTop + first.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top - (box.clientHeight - head - first.offsetHeight) / 2);
        table.querySelectorAll("tbody tr.sel").forEach(tr => tr.classList.add("flash"));
      }
    }
    table.querySelectorAll("tbody tr").forEach(tr => {
      const r = bom.rows[+tr.dataset.i];
      tr.addEventListener("click", e => {
        if (e.target.tagName === "INPUT") return;
        // select the line's parts on the sheet (a socket line selects its tubes)
        const ids = r.socket ? S.comps.filter(c => c.type === "tube" && r.refList.includes(String(c.label || "").replace(/\.\d+$/, ""))).map(c => c.id) : r.ids;
        S.sel.comps = new Set(ids); S.sel.wires.clear(); updateInspector(); render();
      });
      const inp = tr.querySelector("input");
      if (inp) {
        inp.addEventListener("change", () => { const v = inp.value.trim(); S.comps.forEach(c => { if (r.ids.includes(c.id)) c.params.partno = v; }); bomStale = false; inp.blur(); commit(); });
        inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); else if (e.key === "Escape") { inp.value = r.partno; inp.blur(); } });
        inp.addEventListener("blur", () => { if (bomStale) setTimeout(renderBom, 0); });
      }
    });
  }
  function toggleBom(on) {
    const host = document.getElementById("bom");
    bomOpts.open = on === undefined ? host.hidden : !!on; saveBomOpts();
    host.hidden = !bomOpts.open; bomSelShown = "";
    document.getElementById("btn-bom").classList.toggle("active", bomOpts.open);
    renderBom(); render();
  }
  function exportBom(fmt) {
    const bom = bomData(), name = baseName() + "-BOM." + fmt;
    const [data, type] = fmt === "txt" ? [BomLib.toTxt(bom), "text/plain;charset=utf-8"] : fmt === "csv" ? [BomLib.toCsv(bom), "text/csv;charset=utf-8"]
      : fmt === "xlsx" ? [BomLib.toXlsx(bom), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] : [BomLib.toPdf(bom), "application/pdf"];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    setStatus("ok", `Saved ${name} (${bom.rows.length} lines, ${bom.rows.reduce((n, r) => n + r.qty, 0)} parts)`);
    return data;
  }
  function initBom() {
    const host = document.getElementById("bom"), center = document.getElementById("center");
    const setH = h => { bomOpts.height = h; host.style.setProperty("--bom-h", h + "px"); };
    if (bomOpts.height) setH(bomOpts.height);
    ["sockets", "bench"].forEach(k => { const el = document.getElementById("bom-" + k); el.checked = bomOpts[k]; el.addEventListener("change", () => { bomOpts[k] = el.checked; saveBomOpts(); renderBom(); }); });
    host.querySelectorAll("[data-bom]").forEach(b => b.addEventListener("click", () => exportBom(b.dataset.bom)));
    bind("btn-bom", () => toggleBom()); bind("btn-bom-menu", () => toggleBom(true)); bind("btn-bom-close", () => toggleBom(false));
    host.querySelector(".bom-grip").addEventListener("mousedown", e => {
      e.preventDefault();
      const y0 = e.clientY, h0 = host.offsetHeight, max = center.clientHeight - 120;
      const move = ev => { setH(Math.round(Math.max(120, Math.min(max, h0 + y0 - ev.clientY)))); render(); };
      const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); saveBomOpts(); };
      window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    });
    if (bomOpts.open) toggleBom(true);
  }
  // PNG of one sheet (or of the whole drawing without frames) at dpi. "print" colours are
  // those of the PDF (black on white, same luminance rule); "screen" keeps the editor's.
  // Very large sheets come out at a lower resolution: a canvas holds at most ~16k px a side.
  function renderPNG(frame, dpi, colours) {
    const b = frame ? compBBox(frame) : drawingBounds(), W = b.x2 - b.x1, H = b.y2 - b.y1;
    let scale = dpi / 25.4 / CadLib.MM;
    const limit = Math.min(16384 / W, 16384 / H, Math.sqrt(120e6 / (W * H)));
    if (scale > limit) scale = limit;
    const cv = document.createElement("canvas"); cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    const c2 = cv.getContext("2d"), print = colours !== "screen";
    c2.fillStyle = print ? "#ffffff" : "#0a0e14"; c2.fillRect(0, 0, cv.width, cv.height);
    c2.setTransform(scale, 0, 0, scale, -b.x1 * scale, -b.y1 * scale);
    // print colours: every fill and stroke colour becomes black or white as it is set; reads
    // give back the drawing's own colour (code like fillStyle = strokeStyle copies it), and
    // save/restore keep those in step with the canvas state
    let orig = { fillStyle: "#000", strokeStyle: "#000" };
    const stack = [];
    const target = !print ? c2 : new Proxy(c2, {
      get: (t, p) => {
        if (p === "fillStyle" || p === "strokeStyle") return orig[p];
        if (p === "save") return () => { stack.push(Object.assign({}, orig)); t.save(); };
        if (p === "restore") return () => { if (stack.length) orig = stack.pop(); t.restore(); };
        const v = t[p]; return typeof v === "function" ? v.bind(t) : v;
      },
      set: (t, p, v) => {
        if ((p === "fillStyle" || p === "strokeStyle") && typeof v === "string") { orig[p] = v; v = PdfExport.ink(v) ? "#ffffff" : "#000000"; }
        t[p] = v; return true;
      }
    });
    drawSheet(target, frame);
    return { canvas: cv, dpi: Math.round(scale * 25.4 * CadLib.MM) };
  }
  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const sheetLabel = (f, list) => "Sheet " + sheetNo(f, list) + (f.params.title ? " · " + f.params.title : "");
  // Export dialog: PDF or PNG, of the sheet in use, of all sheets in one PDF, or of each sheet as its own file
  const EXP_KEY = "tubecad_export";
  const expOpts = { fmt: "pdf", which: "current", dpi: "300", colours: "print" };
  try { Object.assign(expOpts, JSON.parse(localStorage.getItem(EXP_KEY)) || {}); } catch (e) {}
  function openExportDialog(fmt) {
    if (fmt) expOpts.fmt = fmt;
    const m = document.getElementById("export-modal"), list = frames(), cur = currentSheet();
    m.dataset.sheet = cur ? cur.id : "";
    document.getElementById("exp-current-name").textContent = cur ? sheetLabel(cur, list) : "the whole drawing (no sheet frame)";
    syncExportDialog(); m.hidden = false;
  }
  function syncExportDialog() {
    const list = frames(), png = expOpts.fmt === "png";
    if (list.length < 2 && expOpts.which !== "current") expOpts.which = "current";
    if (png && expOpts.which === "all") expOpts.which = "each";
    document.querySelectorAll("#export-modal [data-k]").forEach(b => {
      b.classList.toggle("active", expOpts[b.dataset.k] === b.dataset.v);
      if (b.dataset.k === "which") b.disabled = b.dataset.v !== "current" && list.length < 2 || (png && b.dataset.v === "all");
    });
    document.getElementById("exp-png-opts").hidden = !png;
    const n = expOpts.which === "current" ? 1 : list.length;
    document.getElementById("exp-summary").textContent = expOpts.which === "all" ? `One PDF with ${list.length} pages.` : `${n} ${png ? "PNG" : "PDF"} file${n > 1 ? "s" : ""}` + (n > 1 ? ", one per sheet." : ".");
  }
  async function runExport() {
    try { localStorage.setItem(EXP_KEY, JSON.stringify(expOpts)); } catch (e) {}
    document.getElementById("export-modal").hidden = true;
    const list = frames(), cur = S.comps.find(c => c.id === document.getElementById("export-modal").dataset.sheet) || null;
    const sheets = expOpts.which === "current" ? [cur] : list;
    const fileOf = f => baseName() + (f && list.length > 1 ? "-sheet" + sheetNo(f, list) : "");
    if (expOpts.fmt === "pdf") {
      if (expOpts.which === "all") exportPDF(true, list);
      else sheets.forEach(f => exportPDF(true, f ? [f] : null, fileOf(f)));
      if (sheets.length > 1 && expOpts.which === "each") setStatus("ok", `Saved ${sheets.length} PDF files, one per sheet`);
      return sheets.length;
    }
    let last = null;
    for (const f of sheets) {
      const { canvas: cv, dpi } = renderPNG(f, +expOpts.dpi, expOpts.colours);
      const blob = await new Promise(res => cv.toBlob(res, "image/png"));
      download(blob, fileOf(f) + ".png"); last = { dpi, w: cv.width, h: cv.height, kb: Math.round(blob.size / 1024) };
    }
    setStatus("ok", sheets.length > 1 ? `Saved ${sheets.length} PNG files, one per sheet (${last.dpi} dpi)` : `Saved ${fileOf(sheets[0])}.png (${last.w} × ${last.h} px, ${last.dpi} dpi${last.dpi < +expOpts.dpi ? ", reduced to fit" : ""}, ${last.kb} kB)`);
    return sheets.length;
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
  // The file this circuit came from or was last saved to. With the File System Access API
  // (Chromium) we keep its handle, so Save can write it again (after asking); other browsers
  // only download, so there Save works like Save as
  let curFile = { handle: null, name: "" };
  const FS_API = typeof window.showSaveFilePicker === "function";
  const JSON_TYPES = [{ description: "Tube Amp CAD circuit", accept: { "application/json": [".json"] } }];
  // imported SPICE tubes the circuit uses travel inside the file, so it opens anywhere
  function usedCustomTubes() { return [...new Set(S.comps.filter(c => c.type === "tube").map(c => c.params.tube))].map(tubeByName).filter(t => window.SpiceModel && SpiceModel.isCustom(t)); }
  const circuitJSON = () => { const tubes = usedCustomTubes(); return JSON.stringify(Object.assign({ app: "TubeAmpCAD", version: 2, comps: S.comps, wires: S.wires }, tubes.length ? { tubes } : {}, S.board ? { board: S.board } : {}), null, 1); };
  // ---------------------------------------------------------------------------
  // Examples (File menu): circuits drawn from published sources and checked against them
  // (docs: the README's Accuracy section and tests/reference.mjs)
  // ---------------------------------------------------------------------------
  const EXAMPLES = [
    { file: "06-gubin-6n23p-6p14p.json", title: "Gubin three-tube amplifier", tag: "tubes", about: "Igor Gubin's stereo single-ended amplifier (radionic.ru): 6N23P-EV direct-coupled to 6P14P, pentode / triode switch, 3–4 dB feedback; simulated 3.4 W at 1.9 % THD, 5 W at 10 % into 4 Ω" },
    { file: "07-gubin-5ts4s-stereo.json", title: "Gubin stereo amplifier with 5Ц4С supply", tag: "tubes", about: "GUB-245-01, three sheets (Radio 4/1957; musicangel.ru Fig. 3): 373BX transformer, 5Ц4С rectifier with capacitor input and a 2.5 H choke, two 6N23P-EV + 6P14P channels; anode resistors 180 Ω keep the 5Ц4С within its 375 mA peak; 1.5 kΩ feedback (R11, R12) takes a phone at full volume (−5.6 dBV) cleanly: 0.07 % THD, clipping from −3 dBV" },
    { file: "03-12ax7-ccs-vs-resistor.json", title: "12AX7: plate resistor vs current source", tag: "tube + transistor", about: "J. Broskie, TubeCAD (2000): the same 12AX7 stage loaded by 150k (gain 70) and by an MPSA92 current source (gain 100), side by side" },
    { file: "04-12ax7-irf820-follower.json", title: "12AX7 stage + IRF820 follower", tag: "tube + MOSFET", about: "The GE 12AX7 data sheet's resistance-coupled stage (gain 50, 40 Vrms at 5 % THD) driving an IRF820 source follower" },
    { file: "05-10w-mosfet-amplifier.json", title: "10 W complementary MOSFET amplifier", tag: "MOSFETs", about: "homemade-circuits.com, fig. 1: BC177 input, BC107 driver, IRF540 / IRF9540 followers into 8 Ω (A3 sheet)" },
    { file: "01-2n3904-ce-unbypassed.json", title: "2N3904 common emitter, RE unbypassed", tag: "transistor", about: "University of Washington lab notes (2017), with the bench-measured part values: gain −4.7" },
    { file: "02-2n3904-ce-bypassed.json", title: "2N3904 common emitter, RE bypassed", tag: "transistor", about: "The same stage with 10 µF across RE: gain about −115, distorting at 50 mVpp in" }
  ];
  async function openExample(ex) {
    if (S.comps.length && !confirm(`Open the example "${ex.title}"?\n\nIt replaces the circuit on the sheet. Ctrl+Z brings the circuit back; its board layout is kept only if you saved the circuit.`)) return;
    try {
      const r = await fetch("examples/" + ex.file + VERSION);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const d = await r.json();
      if (Array.isArray(d.tubes) && window.SpiceModel) { d.tubes.forEach(t => { try { SpiceModel.add(t); } catch (e) { /* a built-in of that name */ } }); buildPalette(); }
      loadCircuit(d);
      storeBoard(d.board || null);
      S.sel.comps.clear(); S.sel.wires.clear();
      setCurFile(null, "");                       // untitled: Save asks for a name, the example stays as it is
      commit(); fitStart(); markClean();
      sendBoardNetlist(true);
      setStatus("ok", `Example: ${ex.title}. ${ex.about}.`);
    } catch (err) { setStatus("error", `Could not open the example: ${err.message}`); }
  }
  function buildExamplesMenu() {
    const host = document.getElementById("examples-list"); if (!host) return;
    EXAMPLES.forEach(ex => {
      const b = document.createElement("button"); b.className = "menu-item"; b.setAttribute("role", "menuitem"); b.dataset.example = ex.file;
      b.title = ex.about; b.innerHTML = `${ex.title}<kbd>${ex.tag}</kbd>`;
      b.addEventListener("click", () => openExample(ex));
      host.appendChild(b);
    });
  }
  function setCurFile(handle, name) {
    curFile = { handle: handle || null, name: name || "" };
    showFile();
  }
  // the file open now, in the toolbar and the tab title; • when the circuit or its board changed since it was opened or saved
  const boardText = () => JSON.stringify(S.board || null);
  function markClean() { clean = { snap: snapshot(), board: boardText() }; showFile(); }
  const isDirty = () => !clean || snapshot() !== clean.snap || boardText() !== clean.board;
  function showFile() {
    const el = document.getElementById("cur-file"), name = curFile.name || "Untitled", dirty = isDirty();
    if (el) {
      el.textContent = name; el.classList.toggle("untitled", !curFile.name);
      if (dirty) { const d = document.createElement("span"); d.className = "dirty"; d.textContent = " •"; el.appendChild(d); }
      el.title = (curFile.name ? `Open file: ${name}` : "Not saved to a file yet") + (dirty ? " · changes not saved (Ctrl+S)" : " · saved");
    }
    document.title = (dirty ? "• " : "") + name + " — Tube Amp CAD";
    try { localStorage.setItem(FILE_KEY, JSON.stringify({ name: curFile.name, dirty })); } catch (e) {}
  }
  async function writeHandle(h) {
    try {
      const w = await h.createWritable(); await w.write(circuitJSON()); await w.close();
      setCurFile(h, h.name); markClean(); setStatus("ok", "Saved " + h.name);
    } catch (err) { setStatus("error", "Could not save " + h.name + ": " + err.message); }
  }
  function downloadJSON(name) {
    const blob = new Blob([circuitJSON()], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setCurFile(null, name); markClean(); setStatus("ok", "Downloaded " + name);
  }
  const jsonName = n => { n = String(n || "").trim().replace(/[\\/:*?"<>|]+/g, "-"); return n ? (/\.json$/i.test(n) ? n : n + ".json") : ""; };
  // Save: the opened (or last saved) file is overwritten after a confirmation; otherwise Save as
  function saveFile() {
    if (!curFile.handle) { saveFileAs(); return; }
    saveDialog("overwrite");
  }
  async function saveFileAs() {
    const suggested = curFile.name || baseName() + ".json";
    if (!FS_API) { saveDialog("name", suggested); return; }
    let h;
    try { h = await window.showSaveFilePicker({ suggestedName: suggested, types: JSON_TYPES }); }
    catch (err) { if (err.name !== "AbortError") setStatus("error", "Save as: " + err.message); return; }
    await writeHandle(h);
  }
  // overwrite: "Overwrite name.json?"; name: a file name for the download (browsers without the API)
  function saveDialog(mode, suggested) {
    const m = document.getElementById("save-modal"), inp = document.getElementById("save-name");
    m.dataset.mode = mode;
    document.getElementById("save-msg").textContent = mode === "overwrite"
      ? `Overwrite ${curFile.name} with the current circuit? The previous contents of the file are replaced.`
      : "This browser cannot write files directly, so the circuit is downloaded under this name.";
    inp.hidden = mode !== "name"; inp.value = suggested || "";
    document.getElementById("btn-save-as-alt").hidden = mode !== "overwrite";
    document.getElementById("btn-save-ok").textContent = mode === "overwrite" ? "Overwrite" : "Download";
    m.hidden = false;
    (mode === "name" ? inp : document.getElementById("btn-save-ok")).focus();
    if (mode === "name") inp.select();
  }
  function saveDialogOk() {
    const m = document.getElementById("save-modal"); m.hidden = true;
    if (m.dataset.mode === "overwrite") writeHandle(curFile.handle);
    else { const n = jsonName(document.getElementById("save-name").value); if (n) downloadJSON(n); else setStatus("warn", "Not saved: no file name"); }
  }
  // A circuit from a file or from browser storage: part defaults filled in and wires
  // split where another wire or a pin ends on them, so both load paths give the same nets
  function loadCircuit(d) {
    if (!d || !Array.isArray(d.comps) || !Array.isArray(d.wires)) throw new Error("not a Tube Amp CAD file");
    d.comps.forEach(c => { if (!LIB[c.type]) throw new Error("unknown part " + c.type); c.params = Object.assign({}, LIB[c.type].defaults, c.params); });
    S.comps = d.comps; S.wires = d.wires;
    normalizeWires();
    S.topo = null;
  }
  function openFile(file, handle) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (Array.isArray(d.tubes) && window.SpiceModel) { d.tubes.forEach(t => { try { SpiceModel.add(t); } catch (e) { setStatus("warn", e.message); } }); buildPalette(); }
        loadCircuit(d);
        storeBoard(d.board || null);
        S.sel.comps.clear(); S.sel.wires.clear();
        setCurFile(handle, file.name);
        commit(); fitStart(); markClean();
        sendBoardNetlist(true);                 // an open board window switches to this file's board
      } catch (err) { setStatus("error", "Could not open file: " + err.message); }
    };
    rd.readAsText(file);
  }
  // Open: with the File System Access API the handle is kept, so Save can write the file back
  async function openDialog() {
    if (typeof window.showOpenFilePicker !== "function") { document.getElementById("file-input").click(); return; }
    let h;
    try { [h] = await window.showOpenFilePicker({ types: JSON_TYPES }); }
    catch (err) { if (err.name !== "AbortError") setStatus("error", "Open: " + err.message); return; }
    try { openFile(await h.getFile(), h); } catch (err) { setStatus("error", "Could not open file: " + err.message); }
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
        case "BJT": {
          const m = e.model, mn = `Q${m.pol > 0 ? "N" : "P"}_${(S.comps.find(c => c.id === e.id) || { params: {} }).params.model || id}`.replace(/[^A-Za-z0-9_]/g, "_");
          lines.push(`Q${id} ${nd.join(" ")} ${mn}`);
          // the model at 25 °C with SPICE's temperature terms; the part's temperature on the instance
          const m0 = CadLib.BJTS[(S.comps.find(c => c.id === e.id) || { params: {} }).params.model] || m;
          if (m.t !== undefined && Math.abs(m.t - 25) > 1e-9) lines[lines.length - 1] += ` temp=${+m.t.toFixed(2)}`;
          if (!models.has(mn)) { models.add(mn); lines.push(`.model ${mn} ${m.pol > 0 ? "NPN" : "PNP"}(IS=${m0.is} BF=${m0.bf} BR=${m0.br || 1} NF=${m.nf || 1} VAF=${m.vaf} IKF=${m.ikf} EG=${m.ge ? 0.67 : 1.11} XTI=3 XTB=1.5 TNOM=25)`); }
          // germanium leakage, collector to base: ICBO at this temperature, saturating as in the simulator
          if (m.icbo) {
            const [hi, lo] = m.pol > 0 ? [nd[0], nd[1]] : [nd[1], nd[0]], vbc = `V(${lo},${hi})`, vt = +m.vt.toPrecision(5);   // junction voltage, B–C for NPN, C–B for PNP
            lines.push(`B${id}_LK ${hi} ${lo} I=${m.icbo.toExponential(3)}*(${vbc}<0 ? 1-exp(${vbc}/${vt}) : -${vbc}/${vt})`);
          }
          break;
        }
        case "MOS": {
          const m = e.model, mn = `M${m.pol > 0 ? "N" : "P"}_${(S.comps.find(c => c.id === e.id) || { params: {} }).params.model || id}`.replace(/[^A-Za-z0-9_]/g, "_");
          lines.push(`M${id} ${nd[0]} ${nd[1]} ${nd[2]} ${nd[2]} ${mn}`);
          if (!models.has(mn)) { models.add(mn); lines.push(`.model ${mn} ${m.pol > 0 ? "NMOS" : "PMOS"}(LEVEL=1 VTO=${m.vto} KP=${m.kp} LAMBDA=${m.lambda || 0})`); }
          break;
        }
        case "VDIODE": lines.push(`B${id}${e.part || ""} ${nd[0]} ${nd[1]} I=${e.perveance}*pwr(max(V(${nd[0]},${nd[1]}),0),1.5)`); break;
        case "XFMR": {
          const AL = e.lp / Math.pow(e.primaryTurns, 2), names = [];
          e.windings.forEach((w, j) => { const n = `L${id}_${j}`; names.push(n); lines.push(`${n} ${nn(w.a)} ${nn(w.b)} ${AL * w.turns * w.turns}`); });
          lines.push(`K${id} ${names.join(" ")} ${e.k}`);
          break;
        }
        case "TRIODE": case "PENTODE": {
          if (e.model.spice) {
            // an imported model goes out as it came in; its pins wired by their roles
            const sp = e.model.spice, tri = e.kind === "TRIODE", at = { A: nd[0], G: nd[1], G2: tri ? nd[0] : nd[2], K: nd[tri ? 2 : 3] };
            if (!models.has("spice:" + sp.sub)) { models.add("spice:" + sp.sub); lines.push(`* imported model ${sp.sub}`, ...sp.text.trim().split("\n")); }
            lines.push(`X${id} ${sp.roles.map(r => at[r] !== undefined ? at[r] : at.K).join(" ")} ${sp.sub}`);
          } else if (e.kind === "TRIODE") {
            const m = e.model, name = `TRIODE_${(S.comps.find(c => c.id === e.id) || {}).params.tube.replace(/[^A-Za-z0-9]/g, "_")}`;
            if (!models.has(name)) { const x = TubeSimEngine.Spice.triode(m); models.add(name); lines.push(`.subckt ${name} A G K`, `Bp A K I=${x.plate}`, `Bg G K I=${x.grid}`, `.ends`); }
            lines.push(`X${id} ${nd.join(" ")} ${name}`);
          } else {
            const m = e.model, name = `PENTODE_${(S.comps.find(c => c.id === e.id) || {}).params.tube.replace(/[^A-Za-z0-9]/g, "_")}`;
            if (!models.has(name)) { const x = TubeSimEngine.Spice.pentode(m); models.add(name); lines.push(`.subckt ${name} A G1 G2 K`, `Bp A K I=${x.plate}`, `Bs G2 K I=${x.screen}`, `Bg G1 K I=${x.grid}`, `.ends`); }
            lines.push(`X${id} ${nd.join(" ")} ${name}`);
          }
          break;
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
    // palette and inspector widths: drag the edges (double-click resets)
    Panels.columns(document.querySelector("main"), { key: "cad", minViewport: 900, minCenter: 360,
      cols: [{ index: 0, side: "left", def: 210, min: 150, max: 480 }, { index: 2, side: "right", def: 280, min: 200, max: 700 }],
      template: w => `${w[0]}px 1fr ${w[1]}px` });

    buildPalette();
    // File menu
    // toolbar menus (File, View, Windows): one open at a time; a tick item leaves its menu open
    document.querySelectorAll("header .menu").forEach(menu => {
      const list = menu.querySelector(".menu-list"), btn = menu.querySelector(":scope > .btn");
      const close = () => { list.hidden = true; btn.setAttribute("aria-expanded", "false"); };
      btn.addEventListener("click", e => {
        e.stopPropagation(); const open = list.hidden;
        document.querySelectorAll("header .menu-list").forEach(l => { if (l !== list) l.hidden = true; });
        list.hidden = !open; btn.setAttribute("aria-expanded", String(open));
      });
      list.addEventListener("click", e => { if (!e.target.closest(".menu-item.check")) close(); });
      document.addEventListener("click", e => { if (!menu.contains(e.target)) close(); });
      document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    });
    // tick items and the Live switch tell screen readers their state too
    new MutationObserver(ms => ms.forEach(m => { const el = m.target;
      if (el.getAttribute("role") === "menuitemcheckbox") el.setAttribute("aria-checked", String(el.classList.contains("active")));
      else if (el.classList.contains("toggle")) el.setAttribute("aria-pressed", String(el.classList.contains("active")));
    })).observe(document.querySelector("header"), { subtree: true, attributes: true, attributeFilter: ["class"] });
    bind("btn-new", () => openSheetDialog("new"));
    bind("btn-add-sheet", () => openSheetDialog("add"));
    document.getElementById("sheet-nav").addEventListener("change", e => { const f = S.comps.find(c => c.id === e.target.value); if (f) fitSheet(f); else fitView(); });
    bind("btn-pdf", () => exportPDF());
    bind("btn-export", () => openExportDialog());
    bind("btn-png", () => openExportDialog("png"));
    document.querySelectorAll("#export-modal [data-k]").forEach(b => b.addEventListener("click", () => { expOpts[b.dataset.k] = b.dataset.v; syncExportDialog(); }));
    bind("btn-exp-cancel", () => { document.getElementById("export-modal").hidden = true; });
    bind("btn-exp-ok", runExport);
    document.getElementById("export-modal").addEventListener("keydown", e => { if (e.key === "Escape") document.getElementById("export-modal").hidden = true; });
    // New dialog: format and orientation of the drawing frame
    const pickSeg = id => { const host = document.getElementById(id); host.querySelectorAll(".btn").forEach(b => b.addEventListener("click", () => host.querySelectorAll(".btn").forEach(x => x.classList.toggle("active", x === b)))); return () => host.querySelector(".btn.active").dataset.v; };
    const newSize = pickSeg("new-size"), newOrient = pickSeg("new-orient");
    document.getElementById("new-title").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("btn-new-create").click(); });
    bind("btn-new-cancel", () => { document.getElementById("new-modal").hidden = true; });
    bind("btn-new-create", () => {
      const m = document.getElementById("new-modal"), opts = { size: newSize(), orient: newOrient(), title: document.getElementById("new-title").value.trim() };
      m.hidden = true;
      if (m.dataset.mode === "add") addSheet(opts); else { newCircuit(opts); updateSheetNav(); }
      document.getElementById("new-title").value = "";
    });
    bind("btn-open", openDialog);
    buildExamplesMenu();
    document.getElementById("file-input").addEventListener("change", e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ""; });
    bind("btn-save", saveFile);
    bind("btn-save-as", saveFileAs);
    bind("btn-save-cancel", () => { document.getElementById("save-modal").hidden = true; });
    bind("btn-save-as-alt", () => { document.getElementById("save-modal").hidden = true; saveFileAs(); });
    bind("btn-save-ok", saveDialogOk);
    document.getElementById("save-name").addEventListener("keydown", e => { if (e.key === "Enter") saveDialogOk(); });
    document.getElementById("save-modal").addEventListener("keydown", e => { if (e.key === "Escape") document.getElementById("save-modal").hidden = true; });
    bind("btn-undo", undo); bind("btn-redo", redo);
    bind("btn-tool-select", () => { S.placing = null; setTool("select"); });
    bind("btn-tool-wire", () => { S.placing = null; setTool(S.tool === "wire" ? "select" : "wire"); });
    bind("btn-rotate", rotateSelection); bind("btn-delete", deleteSelection);
    bind("btn-mirror", mirrorSelection);
    bind("btn-help", () => { document.getElementById("help-modal").hidden = false; });
    bind("btn-help-close", () => { document.getElementById("help-modal").hidden = true; });
    bind("btn-help-manual", () => { document.getElementById("help-modal").hidden = true; ToolWindows.open("help.html"); });
    bind("btn-open-manual", () => ToolWindows.open("help.html"));
    document.getElementById("help-modal").addEventListener("click", e => { if (e.target.id === "help-modal") e.target.hidden = true; });
    bind("btn-zoom-in", () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.25));
    bind("btn-zoom-out", () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 0.8));
    bind("btn-zoom-fit", fitCurrent);
    bind("btn-live", () => setLive(!S.sim.live));
    bind("btn-sim", () => { if (S.sim.busy && S.sim.mode === "full") { cancelRun(); setStatus("idle", "Stopped"); } else runSim("full"); });
    document.getElementById("btn-live").classList.toggle("active", S.sim.live);
    bind("btn-volts", () => { S.showVolts = !S.showVolts; document.getElementById("btn-volts").classList.toggle("active", S.showVolts); render(); });
    bind("btn-bias", () => { S.bias.show = !S.bias.show; document.getElementById("btn-bias").classList.toggle("active", S.bias.show); render(); });
    document.getElementById("inspector").addEventListener("click", e => {
      const b = e.target.closest("[data-bias-apply], [data-bias-mid]");
      if (b) applyBias(b.dataset.biasApply || b.dataset.biasMid, !!b.dataset.biasMid);
    });
    { const b = document.getElementById("btn-legend"); b.classList.toggle("active", S.showLegend); b.setAttribute("aria-checked", String(S.showLegend)); }
    bind("btn-legend", () => { S.showLegend = !S.showLegend; document.getElementById("btn-legend").classList.toggle("active", S.showLegend); try { localStorage.setItem(LEGEND_KEY, S.showLegend ? "1" : "0"); } catch (e) {} render(); });
    bind("btn-amps", () => { S.showAmps = !S.showAmps; document.getElementById("btn-amps").classList.toggle("active", S.showAmps); render(); });
    bind("btn-spice", () => { document.getElementById("spice-text").value = spiceNetlist(); document.getElementById("spice-modal").hidden = false; });
    bind("btn-spice-close", () => { document.getElementById("spice-modal").hidden = true; });
    bind("btn-spice-copy", () => { const t = document.getElementById("spice-text"); t.select(); try { navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand("copy"); } });
    bind("btn-spice-download", () => { const blob = new Blob([document.getElementById("spice-text").value], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tube-circuit.cir"; a.click(); });
    initBom();
    bind("btn-open-board", () => ToolWindows.open("board.html"));
    bind("btn-open-tracer", () => ToolWindows.open("index.html"));
    bind("btn-open-scope", () => { const sc = S.comps.find(c => c.type === "scope"); ToolWindows.open("oscilloscope.html", sc ? { scope: sc.id } : null); });
    bind("btn-open-spectrum", () => { const sc = S.comps.find(c => c.type === "scope"); ToolWindows.open("spectrum_analyzer.html", sc ? { scope: sc.id } : null); });
    bind("btn-open-bode", () => { const sc = S.comps.find(c => c.type === "scope"); ToolWindows.open("bode.html", sc ? { scope: sc.id } : null); });

    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (saved) {
      try { const d = JSON.parse(saved); d.comps = (d.comps || []).filter(c => LIB[c.type]); loadCircuit(d); } catch (e) { S.comps = []; S.wires = []; }
      try { S.board = JSON.parse(localStorage.getItem(BOARD_KEY)) || null; } catch (e) { S.board = null; }
    }
    else S.comps = [makeComp("frame", { size: "A3", orient: "landscape", date: new Date().toISOString().slice(0, 10) }, 0, 0, 0)];   // first visit: an A3 sheet
    S.history = [snapshot()]; S.hIndex = 0;
    S.topo = null;
    // after a reload: the same file name, and the unsaved mark if there was one
    let last = null; try { last = JSON.parse(localStorage.getItem(FILE_KEY)); } catch (e) {}
    curFile = { handle: null, name: (saved && last && last.name) || "" };
    if (!saved || !last || !last.dirty) markClean(); else showFile();
    setTool("select");
    updateInspector();
    updateSheetNav();
    requestAnimationFrame(() => { fitStart(); scheduleSim(0); });
  }

  // Exposed for tests and the other windows
  window.TubeCAD = { legend: () => legendBox, state: S, updateInspector, circuitJSON, EXAMPLES, openExample, boardNetlist, storeBoard, fitStart, stickerReport, mirrorSelection, renderPNG, openExportDialog, runExport, exportOptions: expOpts, isLocked, deleteSelection, currentSheet, pinCurrents, wireCurrents, bomData, exportBom, toggleBom, runOptions: RUN_OPTIONS, newCircuit, addSheet, resistorPower, frames, zoneOf, connRefs, refText, isRail, fitSheet, exportPDF, saveFile, renumber, desig, runTransient, stopTransient, commit, setSwitch, setLive, undo, redo, fitView, buildNetlist, topo: () => topo(), makeComp, compPins, addSegment, lRoute, runSim, spiceNetlist, buildSummary, tubeData, normalizeWires };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
