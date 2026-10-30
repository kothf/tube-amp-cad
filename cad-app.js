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

  // File ▾ → Revisions… (cad-rev-dialog.js), made in init()
  let revisions = null;

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
    probe: { hover: null, pin: null },   // voltmeter probe: target under the pointer, and the one clicked down
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
    // sheet connectors and power rails with the same name are one net (as if wired)
    const byName = new Map();
    S.comps.forEach(c => { if (c.type !== "offsheet" && c.type !== "rail") return; const n = connName(c); if (!n) return; const r = find(key(c.x, c.y)); if (byName.has(n)) union(r, byName.get(n)); else byName.set(n, r); });
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
  // where the partners of a sheet connector are (connectors and power rails of its name)
  function connRefs(c) {
    const n = connName(c);
    return S.comps.filter(k => k !== c && (k.type === "offsheet" || k.type === "rail") && connName(k) === n).map(k => (zoneOf(k.x, k.y) || {}).text).filter(Boolean)
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
    // a part number the app knows: the real part (package, size) is saved with the circuit (mpn.js)
    if (window.PartNo) S.comps.forEach(c => PartNo.keep(c));
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
    if (revisions) revisions.changed();
    scheduleBoardNetlist();
    updateSheetNav();
    if (S.trans && !S.trans.stale && !S.trans.running) { S.trans.stale = true; if (channel) channel.postMessage(transientMessage()); }
    tolerance.changed();
    power.changed();
    listen.changed();
    sweep.changed();
    tune.changed();
    animChanged();
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
  // the engine's workers, one per processor core, shared by every calculation (sim-pool.js)
  const pool = SimPool("sim-worker.js" + VERSION);
  let simJob = null, simTimer = null;
  // "live" runs after every edit within a short time budget; "full" runs until
  // the periodic steady state is reached (slow supplies need seconds of solver time)
  const RUN_OPTIONS = { live: { budgetMs: 2500 }, full: { budgetMs: 120000, maxPeriods: 20000 } };
  const LIVE_KEY = "tubecad_live", LEGEND_KEY = "tubecad_legend";

  // What the CAD reads from the last result: node voltages, currents, power, tube data (cad-results.js)
  const { acDigits, harmonics, netAC, netDC, netWave, oneCycle, otDcCurrent, pinCurrent, pinCurrents, pinMap, pinNetOf, resistorPower, semiData, signalFreq, speakerPower, speakerWave, stats, tubeData, tubeLimits, waveOf, wireCurrents } = CadResults({ S, buildNetlist, compPins, decimate, fmtEng, key, topo, tubeByName, tubeKind });

  // the selection as text, to tell whether it changed
  const selSig = () => [...S.sel.comps].sort().join(",") + "|" + [...S.sel.wires].sort().join(",");
  // The board window or tab, the netlist and board document it shares with the CAD, cross-probing (cad-board-link.js)
  const { BOARD_KEY, boardNetlist, isBoardTab, probeBoard, scheduleBoardNetlist, selectFromBoard, selectNetFromBoard, sendBoardNetlist, setBoardTab, showBoard, storeBoard } = CadBoardLink({ S, VERSION, channel, compBBox, compPins, frames, getCanvas: () => canvas, netDC, netWave, pinCurrents, render, selSig, showFile, topo, updateInspector, usedCustomTubes });
  S.showLegend = (() => { try { return localStorage.getItem(LEGEND_KEY) !== "0"; } catch (e) { return true; } })();
  S.sim.live = (() => { try { return localStorage.getItem(LIVE_KEY) !== "0"; } catch (e) { return true; } })();

  function buildNetlist() {
    const T = topo();
    let nodeCount = T.nodeCount;
    const alloc = () => nodeCount++;
    const elements = [], railNets = new Set();
    S.comps.forEach(c => {
      const net = pid => T.pinNet.get(c.id + ":" + pid);
      // power rails of one net are one supply: the first of them is its source
      if (c.type === "rail") { if (railNets.has(net("1"))) return; railNets.add(net("1")); }
      LIB[c.type].build(c, net, alloc, elements);
    });
    return { nodeCount, elements };
  }

  // a promise of the simulation's result once nothing is running or waiting to run (null: none)
  const simWaiters = [];
  function whenSimulated() { return new Promise(res => { simWaiters.push(res); setTimeout(flushSimWaiters, 300); }); }
  function flushSimWaiters() {
    if (S.sim.busy || S.sim.pending || simTimer) return;
    simWaiters.splice(0).forEach(res => res(S.sim.result));
  }
  function scheduleSim(delay) {
    clearTimeout(simTimer); simTimer = null;
    if (!S.sim.live) {
      // manual mode: the old result no longer matches the circuit
      if (S.sim.busy) cancelRun();
      S.sim.result = null; S.sim.error = null; S.sim.warnings = [];
      setStatus("idle", hasCircuit() ? "Circuit changed · press Simulate (Ctrl+Enter)" : "Empty sheet");
      broadcast();
      return;
    }
    simTimer = setTimeout(() => { simTimer = null; runSim("live"); }, delay === undefined ? 150 : delay);
  }
  function cancelRun() {
    if (simJob) { simJob.cancel(); simJob = null; }
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
    if (!hasCircuit()) { S.sim.result = null; S.sim.error = null; setStatus("idle", "Empty sheet"); broadcast(); render(); setTimeout(flushSimWaiters, 0); return; }
    if (!T.hasGround) { S.sim.result = null; S.sim.error = "Add a ground symbol to simulate"; setStatus("warn", S.sim.error); broadcast(); render(); updateInspector(); setTimeout(flushSimWaiters, 0); return; }
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
    // the animation's frames over one period of the signal generator
    const g = S.comps.find(c => c.type === "siggen"), options = Object.assign({}, RUN_OPTIONS[mode], g && g.params.freq > 0 ? { frameSpan: 1 / g.params.freq } : {});
    if (pool.ok) simJob = pool.run({ netlist, options }, { urgent: true, onResult: result => { simJob = null; onSimResult({ seq, result }); }, onProgress: progress => onSimProgress({ seq, progress }) });
    else setTimeout(() => onSimResult({ seq, result: TubeSimEngine.simulate(netlist, options) }), 0);
  }
  // the busy text of the running steady-state simulation, with its readiness in percent
  function simBusy(text) { S.sim.busyText = text; S.sim.progress = 0; showBusy(); updatePct(); simButton(); }
  // the status while simulations run: the steady state and the power-on transient may run at once,
  // so both share one line and one bar (the lower readiness), instead of taking turns at it
  function showBusy() {
    const jobs = [];
    if (S.sim.busy) jobs.push([S.sim.busyText.replace(/…$/, ""), S.sim.progress || 0]);
    if (S.trans && S.trans.running) jobs.push([`Power-on transient, first ${fmtEng(S.trans.tStop, "s")}`, S.trans.progress || 0]);
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
      // the BOM's Sim. max column for every part, whether the BOM is open or not
      S.sim.stress = new Map();
      if (result.ok) S.comps.forEach(c => { let st = null; try { st = partStress(c); } catch (e) { st = null; } if (st) S.sim.stress.set(c.id, st); });
      if (result.ok) {
        const tr = result.tran;
        const what = tr && tr.fBase ? `${fmtEng(tr.samples * tr.dt, "s")} window, ${tr.periods ? `${tr.periods} cycles to settle` : `free-running at ${fmtEng(tr.fBase, "Hz")}`}` : "DC operating point";
        const took = result.elapsedMs >= 1000 ? (result.elapsedMs / 1000).toFixed(1) + " s" : result.elapsedMs + " ms";
        // a quick live run that ran out of time continues as a full run in the background
        const more = tr && !tr.settled && S.sim.mode === "live" && S.sim.live && !S.sim.pending;
        if (more) S.sim.warnings = S.sim.warnings.filter(w => !/^Not fully settled/.test(w));
        if (!(S.trans && S.trans.running && showBusy()))   // the power-on transient still runs: its progress stays on the line
          setStatus(S.sim.warnings.length ? "warn" : "ok", `Simulated in ${took} · ${what}` + (result.dcAveraged ? " · DC values averaged over the window" : "") + (S.sim.warnings.length ? " · " + S.sim.warnings[0] : ""));
        if (more) { broadcast(); updateInspector(true); render(); runSim("full"); simBusy("Preliminary result shown · settling fully…"); return; }
      } else setStatus("error", result.error);
      broadcast();
      updateInspector(true);
      render();
    }
    if (S.sim.pending) { S.sim.pending = false; runSim(); }
    flushSimWaiters();
  }

  // AC animation (View ▾ → Animate): dots for each wire's current, a tint for each node's AC (cad-anim.js)
  const { animData, changed: animChanged, drawAnimDots, drawAnimHud, drawAnimTint, eyeLevel, ledLevel, setAnim } = CadAnim({ S, buildNetlist, fmtEng, getCtx: () => ctx, netDC, pinCurrent, pinMap, pool, render, setStatus, signalFreq, stats, topo, wireCurrents });

  function limitRows(c) {
    return tubeLimits(c).filter(o => o.key !== "Vg2k").map(o => kv(o.label, `${o.value} · ${Math.round(o.share * 100)}% of ${o.lim}`, o.share > 1 ? "bad" : o.share > 0.85 ? "warn" : "")).join("");
  }

  // ---------------------------------------------------------------------------
  // Bias detection (bias.js): whether each tube is cathode or fixed biased and the resistance
  // in its grid circuit, for the grid-resistor limit in the checks
  // ---------------------------------------------------------------------------
  S.bias = { tubes: new Map() };
  function detectBias() {
    S.bias.tubes = new Map();
    const r = S.sim.result;
    if (!r || !window.TubeBias || !S.sim.netlist) return;
    TubeBias.detect(S.sim.netlist, r.dc).forEach(d => S.bias.tubes.set(d.tube, d));
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
  // What a tolerance run measures (cad-tolerance.js), from the result in S.sim.result: each tube's
  // Ia, Va and Pa, each transistor's current and dissipation, each speaker's power and each
  // scope channel's AC. max: the rating the runs are counted against.
  function measurements() {
    const out = [], r = S.sim.result;
    if (!r) return out;
    S.comps.forEach(c => {
      const name = desig(c) || c.id;
      if (c.type === "tube") {
        const d = tubeData(c);
        if (!d || d.kind === "rectifier" || !d.dc) return;
        out.push({ key: c.id + ":ia", label: `${name} Ia`, unit: "A", v: d.dc.ia }, { key: c.id + ":va", label: `${name} Va`, unit: "V", v: d.dc.vak, max: d.vaMax },
          { key: c.id + ":pa", label: `${name} Pa`, unit: "W", v: d.metrics ? d.metrics.pAvg : d.dc.vak * d.dc.ia, max: d.paMax });
      } else if (CadLib.isTransistor(c.type)) {
        const d = (r.dc.devices[c.id] || {}).main, bip = !CadLib.isFet(c.type), m = CadLib.semiTable(c.type)[c.params.model];
        if (!d) return;
        out.push({ key: c.id + ":i", label: `${name} ${bip ? "Ic" : "Id"}`, unit: "A", v: Math.abs(bip ? d.ic : d.id), max: m && m.i },
          { key: c.id + ":pd", label: `${name} dissipation`, unit: "W", v: d.pd, max: m && m.p });
      } else if (c.type === "speaker") {
        const sp = speakerPower(c);
        if (sp) out.push({ key: c.id + ":p", label: `${name} output`, unit: "W", v: sp.p });
      } else if (c.type === "scope") {
        const ch = scopeChannels(c);
        if (ch) ["ch1", "ch2"].forEach(k => { const st = stats(ch[k]); if (st) out.push({ key: c.id + ":" + k, label: `${name} ${k.toUpperCase()} AC`, unit: "Vrms", v: st.rmsAC }); });
      }
    });
    return out;
  }
  // fn() with another run's result in place of the last simulation (synchronous, so nothing sees the swap)
  function withResult(result, netlist, T, fn) {
    const keep = [S.sim.result, S.sim.netlist, S.sim.topo];
    S.sim.result = result; S.sim.netlist = netlist; S.sim.topo = T;
    try { return fn(); } finally { [S.sim.result, S.sim.netlist, S.sim.topo] = keep; }
  }
  function buildSummary() {
    const r = S.sim.result;
    // seq: which run this is, so an instrument window can tell it shows the latest
    const summary = { type: "SIM_RESULT", version: VERSION, seq: S.sim.seq, at: Date.now(), selectedTubeId: lastTubeId, ok: !!r, error: S.sim.error, warnings: S.sim.warnings || [], empty: !S.comps.length, fSig: signalFreq(), tubes: [], transistors: [], scopes: [], speakers: [], customTubes: usedCustomTubes() };
    if (!r) return summary;
    summary.elapsedMs = r.elapsedMs;
    S.comps.forEach(c => {
      if (c.type === "tube") {
        const d = tubeData(c);
        if (d && d.kind !== "rectifier") {
          summary.tubes.push({ id: c.id, label: c.label, tube: d.tube, kind: d.kind, model: d.model, paMax: d.paMax, vaMax: d.vaMax, dc: d.dc, metrics: d.metrics || null,
            traj: d.traj ? oneCycle(d.traj) : null });
        }
      } else if (CadLib.isTransistor(c.type)) {
        const d = semiData(c);
        if (d) summary.transistors.push(d);
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
    else if (m.type === "BOARD_SAVE") { storeBoard(m.doc); renderBom(); }   // the BOM names the parts made SMD there
    else if (m.type === "BOARD_SELECT") selectFromBoard(m.ids);
    else if (m.type === "BOARD_NET") selectNetFromBoard(m.net);
    if (m.type === "RUN_SIM") runSim("full");                            // ▶ Simulate in an instrument window
    else if (m.type === "RUN_TRANSIENT") runTransient(m.tStop);
    else if (m.type === "STOP_TRANSIENT") stopTransient();
    else if (m.type === "RUN_AC") runAC(m.gen);
  };

  // ---------------------------------------------------------------------------
  // Power-on transient for the oscilloscopes and frequency response for the Bode plotter,
  // on workers of their own from the pool, so live runs go on (cad-analysis.js)
  // ---------------------------------------------------------------------------
  const { acMessage, runAC, runTransient, stopTransient, transientMessage } = CadAnalysis({ S, VERSION, buildNetlist, pool, channel, desig, fmtEng, setStatus, showBusy, topo });

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
    // parts being dragged turn where they are; letting go commits the move and the turn as one step
    const dragging = S.drag && S.drag.kind === "comps", moving = dragging && new Set(S.drag.comps0.map(o => o.id));
    let any = false;
    S.comps.forEach(c => { if (S.sel.comps.has(c.id) && (!dragging || moving.has(c.id)) && !LIB[c.type].noRotate) { c.rot = (c.rot + 1) & 3; any = true; } });
    if (any && dragging) { S.drag.moved = true; render(); } else if (any) commit();
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
    if (e.button === 0) clearBomShown();   // a click on the sheet shows its selection in the BOM again
    if (e.button === 1 || (e.button === 0 && S.spaceDown)) { if (S.spaceDown) S.spacePanned = true; S.drag = { kind: "pan", sx: m.sx, sy: m.sy, ox: S.view.ox, oy: S.view.oy }; e.preventDefault(); return; }
    if (e.button === 2) { if (S.wiring) finishWiring(); else if (S.placing) { S.placing = null; setTool("select"); } else openSheetMenu(e, m); return; }
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

    if (S.tool === "probe") { S.probe.pin = probeAt(m.wx, m.wy); S.probe.hover = null; render(); return; }

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

  // Right mouse button on the sheet: what can be done with the part or wire under the pointer
  // (selected first, unless it already is), or with the sheet
  function openSheetMenu(e, m) {
    const c = hitComp(m.wx, m.wy), w = c ? null : hitWire(m.wx, m.wy);
    if ((c && !S.sel.comps.has(c.id)) || (w && !S.sel.wires.has(w.id))) {
      S.sel.comps.clear(); S.sel.wires.clear();
      if (c) S.sel.comps.add(c.id); else S.sel.wires.add(w.id);
      updateInspector(); render();
    }
    const item = id => { const k = cmds.get(id); return { label: k.label, key: k.keys[0], icon: k.icon, run: () => cmds.run(id) }; };
    const n = S.sel.comps.size + S.sel.wires.size;
    const items = c || w ? ["rotate", "mirror", "duplicate", "delete", null, "copy", "paste"] : ["paste", "select-all", null, "fit", "undo", "redo"];
    const title = c ? (n > 1 ? `${n} selected` : desig(c) || LIB[c.type].name) : w ? (n > 1 ? `${n} selected` : "Wire") : "";
    UiKit.contextMenu(items.map(id => (id ? item(id) : null)), e.clientX, e.clientY, title);
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
    if (S.tool === "probe") {
      const out = m.sx < 0 || m.sy < 0 || m.sx > canvas.clientWidth || m.sy > canvas.clientHeight;
      S.probe.hover = out || S.drag ? null : probeAt(m.wx, m.wy);
    }
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
    // a switch, a push button or a selector moves on to its next position
    if (c && LIB[c.type].flip && !S.wiring) { setSwitch(c, LIB[c.type].flip(c)); updateInspector(); }
    if (c && c.type === "jack" && c.params.kind === "TS-SW" && !S.wiring) { c.params.plug = c.params.plug === "in" ? "out" : "in"; commit(); updateInspector(); }
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
    S.comps.forEach(k => { if (k === c || (g && k.type === c.type && switchGang(k) === g)) k.params.pos = pos; });
    commit();
  }

  function onWheel(e) {
    e.preventDefault();
    const m = evPos(e);
    if (e.shiftKey) { S.view.ox -= e.deltaY || e.deltaX; render(); return; }
    // a sideways swipe on a touchpad (or a tilted wheel) scrolls left and right
    if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) { S.view.ox -= e.deltaX; render(); return; }
    zoomAt(m.sx, m.sy, Math.exp(-e.deltaY * 0.0015));
  }

  // What the editor can do from the keyboard, in one table (UiKit.commands): the shortcuts, the
  // toolbar and menu buttons bound to them and the help's Keyboard list all come from it.
  // A new command with a key and a help text shows up in the help by itself.
  const cmds = UiKit.commands();
  const ICONS = {
    rotate: `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M11.7 1.6v3h-3"/></svg>`,
    mirror: `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13" stroke-dasharray="2 1.6"/><path d="M6 4 2 12h4z"/><path d="M10 4l4 8h-4z"/></svg>`,
    delete: `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11"/><path d="M6 4.5V2.5h4v2"/><path d="M4 4.5l.8 9.5h6.4l.8-9.5"/><path d="M6.8 7v4.5M9.2 7v4.5"/></svg>`
  };
  const helpModal = () => document.getElementById("help-modal");
  const toggleHelp = () => { const m = helpModal(); m.hidden = !m.hidden; };
  const zoomBy = k => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, k);
  function clearOrCancel() {
    if (S.wiring) finishWiring();
    else if (S.placing) { S.placing = null; setTool("select"); }
    else if (S.probe.pin) { S.probe.pin = null; render(); }
    else if (S.tool === "probe") setTool("select");
    else { S.sel.comps.clear(); S.sel.wires.clear(); updateInspector(); render(); }
  }
  function selectAll() { S.comps.forEach(c => S.sel.comps.add(c.id)); S.wires.forEach(w => S.sel.wires.add(w.id)); updateInspector(); render(); }
  function toggleView(key) { S[key] = !S[key]; render(); }
  cmds
    .add({ id: "help-close", keys: ["Escape"], anyCtrl: true, when: () => !helpModal().hidden, run: () => { helpModal().hidden = true; } })
    .add({ id: "diff-close", keys: ["Escape"], anyCtrl: true, when: () => !!S.revDiff, run: () => revisions.closeDiff() })
    .add({ id: "save-revision", keys: ["Ctrl+Alt+S"], prevent: true, when: () => !!revisions, run: () => revisions.quickSave(), help: "save a revision of the project (File ▾ → Revisions…)" })
    .add({ id: "rotate", label: "Rotate", icon: ICONS.rotate, keys: ["Space", "R"], helpKeys: ["Space"], run: rotateSelection, help: "rotate the selection, the part being placed or the parts being dragged (a tap: Space held down while dragging pans; R also rotates)" })
    .add({ id: "mirror", label: "Mirror left–right", icon: ICONS.mirror, keys: ["M"], run: mirrorSelection, help: "mirror left–right" })
    .add({ id: "duplicate", label: "Duplicate", keys: ["D", "Ctrl+D"], prevent: true, run: () => { if (copySelection()) paste(40, 40); }, help: "duplicate (also Ctrl+D)", helpKeys: ["D"] })
    .add({ id: "delete", label: "Delete", icon: ICONS.delete, keys: ["Delete", "Backspace"], anyCtrl: true, prevent: true, run: deleteSelection, help: "delete" })
    .add({ id: "wire", keys: ["W"], run: () => setTool(S.tool === "wire" ? "select" : "wire"), help: "wire tool" })
    .add({ id: "select", keys: ["V"], run: () => setTool("select"), help: "select tool" })
    .add({ id: "probe", keys: ["P"], run: () => { S.placing = null; S.wiring = null; setTool(S.tool === "probe" ? "select" : "probe"); }, help: "voltmeter probe: point at a wire or pin for its DC, AC and waveform; click to leave the probe there" })
    .add({ id: "escape", keys: ["Escape"], anyCtrl: true, run: clearOrCancel, help: "cancel / clear the selection" })
    .add({ id: "sheet-prev", label: "Previous sheet", keys: ["PageUp"], prevent: true, when: () => frames().length > 1, run: () => stepSheet(-1), help: "previous sheet" })
    .add({ id: "sheet-next", label: "Next sheet", keys: ["PageDown"], prevent: true, when: () => frames().length > 1, run: () => stepSheet(1), help: "next sheet" })
    .add({ id: "fit", label: "Fit the sheet", keys: ["F"], run: () => fitCurrent(), help: "fit the sheet in use; again: all sheets" })
    .add({ id: "bom", keys: ["B"], run: () => toggleBom(), check: () => bomOpts.open && bomOpts.tab === "bom", help: "bill of materials" })
    .add({ id: "checks", label: "Checks", run: () => toggleBom(undefined, "checks"), check: () => bomOpts.open && bomOpts.tab === "checks" })
    .add({ id: "tolerance", label: "Tolerance runs", run: () => toggleBom(undefined, "tolerance"), check: () => bomOpts.open && bomOpts.tab === "tolerance" })
    .add({ id: "sweep", label: "Parameter sweep", run: () => toggleBom(undefined, "sweep"), check: () => bomOpts.open && bomOpts.tab === "sweep" })
    .add({ id: "listen", label: "Listen", run: () => toggleBom(undefined, "listen"), check: () => bomOpts.open && bomOpts.tab === "listen" })
    .add({ id: "power", label: "Power sweep", run: () => toggleBom(undefined, "power"), check: () => bomOpts.open && bomOpts.tab === "power" })
    .add({ id: "zoom-in", keys: ["+", "=", "NumpadAdd", "Equal"], anyCtrl: true, run: () => zoomBy(1.2), help: "zoom in · wheel zooms at the pointer", helpKeys: ["+"] })
    .add({ id: "zoom-out", keys: ["-", "NumpadSubtract", "Minus"], anyCtrl: true, run: () => zoomBy(1 / 1.2), help: "zoom out", helpKeys: ["-"] })
    .add({ id: "undo", menuId: "menu-undo", label: "Undo", keys: ["Ctrl+Z"], prevent: true, inControls: true, run: undo, help: "undo" })
    .add({ id: "redo", menuId: "menu-redo", label: "Redo", keys: ["Ctrl+Y", "Ctrl+Shift+Z"], prevent: true, inControls: true, run: redo, help: "redo (also Ctrl+Shift+Z)", helpKeys: ["Ctrl+Y"] })
    .add({ id: "copy", label: "Copy", keys: ["Ctrl+C"], run: () => copySelection(), help: "copy" })
    .add({ id: "paste", label: "Paste", keys: ["Ctrl+V"], prevent: true, run: () => paste(40, 40), help: "paste" })
    .add({ id: "select-all", label: "Select all", keys: ["Ctrl+A"], prevent: true, run: selectAll, help: "select all" })
    .add({ id: "save", keys: ["Ctrl+S"], prevent: true, run: () => saveFile(), help: "save" })
    .add({ id: "save-as", keys: ["Ctrl+Shift+S"], prevent: true, run: () => saveFileAs(), help: "save as" })
    .add({ id: "open", keys: ["Ctrl+O"], prevent: true, run: () => openDialog(), help: "open" })
    .add({ id: "print", keys: ["Ctrl+P"], prevent: true, inInputs: true, run: () => openPrintDialog(), help: "print the sheet, all sheets or the bill of materials" })
    .add({ id: "simulate", keys: ["Ctrl+Enter"], prevent: true, run: () => runSim("full"), help: "simulate until settled" })
    .add({ id: "board", keys: ["Alt+B"], prevent: true, inInputs: true, run: showBoard, help: "the board layout (Alt+S in the Board window comes back)" })
    .add({ id: "board-tab", label: "Board in this window", run: () => setBoardTab(!isBoardTab()), check: isBoardTab })
    .add({ id: "help", keys: ["F1"], inInputs: true, prevent: true, run: toggleHelp, help: "this help (also ?)" })
    .add({ id: "help-alt", keys: ["?"], prevent: true, run: toggleHelp })
    .add({ id: "inspector", label: "Inspector", run: () => setDrawer(!document.body.classList.contains("insp-open")), check: () => document.body.classList.contains("insp-open") })
    .add({ id: "renumber", menuId: "menu-renumber", label: "Renumber designations", title: "Letter code (R, C, L, T, VL …) and number for every part, in reading order", run: () => renumber() })
    // settings without a key: View menu ticks and the toolbar's switches
    .add({ id: "volts", run: () => toggleView("showVolts"), check: () => S.showVolts })
    .add({ id: "amps", run: () => toggleView("showAmps"), check: () => S.showAmps })
    .add({ id: "legend", run: () => { toggleView("showLegend"); try { localStorage.setItem(LEGEND_KEY, S.showLegend ? "1" : "0"); } catch (e) {} }, check: () => S.showLegend })
    .add({ id: "live", run: () => setLive(!S.sim.live), check: () => S.sim.live })
    .add({ id: "anim", run: () => setAnim(!S.anim.on), check: () => S.anim.on });

  function onKeyDown(e) {
    const tag = (e.target.tagName || "").toUpperCase(), typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    // Space rotates: at once while placing or dragging parts; otherwise on letting go of a tap, since
    // Space held down while dragging the sheet pans it. Never a page scroll or a click on a focused button.
    if (e.key === " ") {
      if (typing || inDialog(e)) return;
      e.preventDefault(); if (e.repeat) return;
      if (S.placing || (S.drag && S.drag.kind === "comps")) { cmds.run("rotate", e); return; }
      S.spaceDown = true; S.spacePanned = false; canvas.style.cursor = "grab"; return;
    }
    cmds.key(e);
  }
  // a dialog's or a menu's buttons keep Space for themselves
  const inDialog = e => !!(e.target.closest && e.target.closest(".modal, .menu-list"));
  function onKeyUp(e) {
    if (e.key !== " " || !S.spaceDown) return;
    e.preventDefault();
    const tap = !S.spacePanned;
    S.spaceDown = false; canvas.style.cursor = "";
    if (tap && !S.drag) cmds.run("rotate", e);
  }

  function updateHover(m) {
    const pin = hitPin(m.wx, m.wy);
    let net, label = "", wireI = "";
    const T = S.sim.topo || topo();
    if (pin) { net = T.pinNet.get(pin.c.id + ":" + pin.p.id); label = pin.c.type === "offsheet" ? `${pin.c.params.name || "connector"} (also at ${refText(connRefs(pin.c)) || "no other place"})` : pin.c.type === "rail" ? `${pin.c.params.name || "rail"} ${LIB.rail.value(pin.c)}` : `${pin.c.label || LIB[pin.c.type].name} ${pin.p.name || pin.p.id}`; }
    else {
      const w = hitWire(m.wx, m.wy);
      if (w) { net = (S.sim.topo || topo()).wireNet.get(w.id); label = "wire"; const wc = S.sim.result && wireCurrents(), i = wc ? wc.currents.get(w.id) : undefined; if (typeof i === "number") wireI = (isH(w) ? (i > 0 === w.x2 > w.x1 ? "→" : "←") : (i > 0 === w.y2 > w.y1 ? "↓" : "↑")) + fmtEng(Math.abs(i), "A", 2); }
    }
    let cursor = "";
    if (S.spaceDown) cursor = "grab";
    else if (S.tool === "probe") cursor = "crosshair";
    else if (S.placing || S.wiring || S.tool === "wire" || pin) cursor = "crosshair";
    else if (!pin) { const w = hitWire(m.wx, m.wy); if (w) cursor = isH(w) ? "ns-resize" : "ew-resize"; else if (hitComp(m.wx, m.wy)) cursor = "move"; }
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    const el = document.getElementById("status-hover");
    if (net === undefined) { el.textContent = `x ${snap(m.wx)}  y ${snap(m.wy)}`; return; }
    const dc = netDC(net), wave = netWave(net), st = wave ? stats(wave) : null;
    el.textContent = `${label}: ` + (net === 0 ? "ground (0 V)" : (dc === null ? "not simulated" : `DC ${fmtEng(dc, "V", 2)}` + (st && st.pp > 1e-4 ? ` · AC ${fmtEng(st.rmsAC, "Vrms", 2)} (${fmtEng(st.pp, "Vpp", 2)}) · avg ${fmtEng(st.mean, "V", 2)}` : "") + (wireI ? ` · I ${wireI} DC` : "")));
  }

  // Voltmeter probe (P): the card at the pointer, the pinned card and the glow on the probed net (cad-probe.js)
  const { drawProbeGlow, drawProbes, probeAt, probeRead } = CadProbe({ S, LIB, acDigits, compPins, desig, fmtEng, getCtx: () => ctx, hitPin, hitWire, isH, netDC, netWave, render, signalFreq, stats });

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    updateHScroll();   // at once, not on the next frame: a page in the background gets none
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
    drawAnimTint(T);
    // with the voltages shown, wires that carry signal (AC) get a cyan glow under them (the animation tints them instead)
    if (S.showVolts && !S.anim.on && S.sim.result && S.sim.result.tran) {
      ctx.strokeStyle = "rgba(0,229,255,0.30)"; ctx.lineWidth = 7;
      S.wires.forEach(w => { const ac = netAC(T.wireNet.get(w.id)); if (ac && ac.signal) { ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke(); } });
    }
    drawProbeGlow(T);
    S.wires.forEach(w => {
      const sel = S.sel.wires.has(w.id);
      ctx.strokeStyle = sel ? "#ffd54f" : "#3fb950";
      ctx.lineWidth = sel ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
    });
    drawAnimDots();
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
    drawDiff();

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
    if (S.showLegend) drawLegend(H - (document.getElementById("hscroll").hidden ? 0 : 18)); else legendBox = null;
    drawAnimHud();
    drawProbes(T, W, H);
  }
  // Compare with a revision (cad-rev-dialog.js), on the drawing: parts added in green, changed in
  // amber, moved in blue, and the parts and wires taken out drawn faintly in red where they were;
  // the change being looked at is drawn thicker
  const DIFF_COL = { added: "#3fb950", changed: "#ffb300", moved: "#79c0ff", removed: "#ff7b72" };
  // the frame a point lies on, by its order (marks are stepped through sheet by sheet)
  const frameIndex = (x, y) => { const i = frames().findIndex(f => { const b = compBBox(f); return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2; }); return i < 0 ? 1e6 : i; };
  function showDiff(d) {
    if (d) d.marks.sort((p, q) => (frameIndex(p.comp.x, p.comp.y) - frameIndex(q.comp.x, q.comp.y)) || (p.comp.y - q.comp.y) || (p.comp.x - q.comp.x));
    S.revDiff = d || null; render();
  }
  // a part as drawn: an old revision's part gets the library's defaults, as loading it would
  const asDrawn = c => (LIB[c.type] ? Object.assign({}, c, { params: Object.assign({}, LIB[c.type].defaults, c.params) }) : null);
  function diffBox(m) { const c = asDrawn(m.comp); return c ? compBBox(c) : null; }
  function drawDiff() {
    const D = S.revDiff; if (!D) return;
    const sc = S.view.scale, cur = D.marks[D.idx];
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,123,114,0.75)"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    D.wiresRemoved.forEach(w => { ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(63,185,80,0.45)"; ctx.lineWidth = 7;
    D.wiresAdded.forEach(w => { ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke(); });
    D.marks.forEach(m => {
      const c = asDrawn(m.comp); if (!c) return;
      if (m.kind === "removed") { ctx.globalAlpha = 0.4; drawComp(c, false, true); ctx.globalAlpha = 1; }
      const b = compBBox(c), pad = 8, on = m === cur;
      ctx.strokeStyle = DIFF_COL[m.kind]; ctx.lineWidth = (on ? 3 : 1.6) / Math.min(sc, 1);
      if (m.kind === "removed") ctx.setLineDash([5 / Math.min(sc, 1), 4 / Math.min(sc, 1)]);
      if (on) { ctx.fillStyle = DIFF_COL[m.kind] + "22"; ctx.fillRect(b.x1 - pad, b.y1 - pad, b.x2 - b.x1 + 2 * pad, b.y2 - b.y1 + 2 * pad); }
      ctx.strokeRect(b.x1 - pad, b.y1 - pad, b.x2 - b.x1 + 2 * pad, b.y2 - b.y1 + 2 * pad);
      ctx.setLineDash([]);
    });
    ctx.restore();
  }
  // the view centred on change i, close enough to read it
  function focusDiff(i) {
    const D = S.revDiff; if (!D || !D.marks.length) return;
    D.idx = (i + D.marks.length) % D.marks.length;
    const b = diffBox(D.marks[D.idx]);
    if (b) {
      const W = canvas.clientWidth, H = canvas.clientHeight;
      const s = Math.max(S.view.scale, Math.min(1.6, Math.min(W / 3 / Math.max(b.x2 - b.x1, 40), H / 3 / Math.max(b.y2 - b.y1, 40))));
      S.view.scale = s; S.view.ox = W / 2 - (b.x1 + b.x2) / 2 * s; S.view.oy = H / 2 - (b.y1 + b.y2) / 2 * s;
      updateZoomLabel();
    }
    render();
  }
  // a small picture of the first sheet, in the editor's colours, for a revision (data: URL)
  function thumbnail(maxW = 640) {
    try {
      const { canvas: big } = renderPNG(frames()[0] || null, 100, "screen");
      const k = Math.min(1, maxW / big.width), cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(big.width * k)); cv.height = Math.max(1, Math.round(big.height * k));
      const g = cv.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(big, 0, 0, cv.width, cv.height);
      const webp = cv.toDataURL("image/webp", 0.8);
      return /^data:image\/webp/.test(webp) ? webp : cv.toDataURL("image/png");
    } catch (e) { return null; }
  }

  // what the colours on the sheet mean: only the marks that are showing
  function legendRows() {
    const r = S.sim.result; if (!r || !(S.showVolts || S.showAmps || S.anim.on)) return [];
    const rows = [], ac = S.showVolts && r.tran;
    if (S.anim.on && animData()) rows.push({ anim: "dots", text: "AC current: dots swing with it (node mostly AC)" }, { anim: "dcdots", text: "DC current: dots flow steadily (node mostly DC)" }, { anim: "up", text: "node swinging up (above its DC)" }, { anim: "down", text: "node swinging down" });
    else if (ac) rows.push({ glow: true, text: "signal: AC on the wire (≥ 1 % of its DC)" });
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
      if (q.anim) {
        ctx.lineCap = "round";
        const dots = q.anim === "dots" || q.anim === "dcdots";
        if (!dots) { ctx.strokeStyle = q.anim === "up" ? "rgba(255,150,60,0.6)" : "rgba(70,160,255,0.6)"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(x + sw - 8, y); ctx.stroke(); }
        ctx.strokeStyle = "#3fb950"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(x + sw - 8, y); ctx.stroke();
        if (dots) { ctx.fillStyle = q.anim === "dots" ? "rgba(255,247,194,0.95)" : "rgba(210,168,255,0.95)"; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(x + 8 + k * 11, y, 2.2, 0, Math.PI * 2); ctx.fill(); } }
      } else if (q.glow) {
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
  // (a part with pinSpots of its own, an op-amp, brings them in the same form)
  function drawPinNumbers(c, sel) {
    const def = LIB[c.type], nums = def.pinNumbers(c), ids = new Set(compPins(c).map(p => p.id).concat("H"));
    ctx.save();
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.fillStyle = sel ? COL.bodySel : COL.value;
    for (const [id, x, y, nx, ny] of def.pinSpots || TUBE_PIN_SPOTS) {
      if (!nums[id] || !ids.has(id)) continue;
      const f = flipX(c), [px, py] = rotPt(f * x, y, c.rot), [dx, dy] = rotPt(f * nx, ny, c.rot);
      ctx.textAlign = dx > 0 ? "left" : dx < 0 ? "right" : "center";
      ctx.textBaseline = dy > 0 ? "top" : dy < 0 ? "bottom" : "middle";
      ctx.fillText(nums[id], c.x + px + dx * 4, c.y + py + dy * 3);
    }
    ctx.restore();
  }
  // a tube's anode temperature (CadLib.anodeTemp) from its average dissipation, kept with the
  // simulation's result so the sheet's redraws do not work it out again
  function anodeHeat(c) {
    const r = S.sim.result; if (!r) return null;
    const cache = r._heat || (r._heat = new Map());
    if (!cache.has(c.id)) { const d = tubeData(c); cache.set(c.id, d && d.dc && d.kind !== "rectifier" && d.paMax > 0 ? CadLib.anodeTemp(d.metrics ? d.metrics.pAvg : d.dc.vak * d.dc.ia, d.paMax) : null); }
    return cache.get(c.id);
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
    ctx.strokeStyle = sel ? COL.bodySel : (c.type === "ground" ? "#8b949e" : (c.type === "vdc" || c.type === "rail" || c.type === "isrc" || c.type === "vcvs" || c.type === "vccs" || c.type === "ptx" || c.type === "ptx_cat" || c.type === "mains" ? "#ff9e64" : (c.type === "siggen" || c.type === "pickup" || c.type === "phono" ? "#00e5ff" : COL.body)));
    ctx.lineWidth = 2;
    c._sel = sel;
    if (["led", "vactrol", "neon", "gasreg"].includes(c.type) && !ghost && !S.printing) c._lit = ledLevel(c);
    if (c.type === "eye" && !ghost && !S.printing) c._eye = eyeLevel(c);
    if (c.type === "tube" && !ghost && !S.printing) { const h = anodeHeat(c); if (h) c._hot = h.glow; }
    // a relay drawn pulled in when the simulation (its settled average) has it so
    if (c.type === "relay" && !ghost && !S.printing && S.sim.result && S.sim.result.dc) { const d = (S.sim.result.dc.devices[c.id] || {}).main; c._on = !!(d && d.q > 0.5); }
    DRAW[c.type](ctx, c);
    delete c._sel; delete c._lit; delete c._on; delete c._eye; delete c._hot;
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
    if (c.type === "rail") {
      // name and voltage beyond the arrow's tip, upright whichever way the arrow points
      const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][c.rot & 3], tx = c.x + d[0] * 22, ty = c.y + d[1] * 22;
      const name = String(c.params.name || "").trim(), val = def.value(c);
      ctx.font = "bold 11px ui-monospace, Menlo, monospace"; const wn = name ? ctx.measureText(name + " ").width : 0;
      ctx.font = "10px ui-monospace, monospace"; const wv = ctx.measureText(val).width;
      const x0 = d[0] > 0 ? tx : d[0] < 0 ? tx - wn - wv : tx - (wn + wv) / 2, y0 = d[1] < 0 ? ty : d[1] > 0 ? ty + 8 : ty + 4;
      ctx.textAlign = "left";
      ctx.font = "bold 11px ui-monospace, Menlo, monospace"; ctx.fillStyle = sel ? COL.bodySel : "#ff9e64"; ctx.fillText(name, x0, y0);
      ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = sel ? COL.bodySel : COL.value; ctx.fillText(val, x0 + wn, y0);
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
    if (LIB[c.type].pinSpots) drawPinNumbers(c, sel);
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
    if (CadLib.isTransistor(c.type)) {
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
    const m = c2.getTransform(), fs = parseFloat((/([\d.]+)px/.exec(c2.font) || ["", 10])[1]), w = c2.measureText(t).width;
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
    document.getElementById("btn-tool-probe").classList.toggle("active", t === "probe");
    if (t !== "probe") S.probe.hover = null;
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
      if (it[1] && (L.BJTS[it[1].model] || L.MOSFETS[it[1].model] || L.JFETS[it[1].model] || L.REGS[it[1].model])) return;   // a catalog part: its own entry below
      const [type, params, label] = it, def = LIB[type], p = Object.assign({}, def.defaults, params || {}), sub = def.value({ params: p });
      out.push([g.group, label || def.name, sub, type, params, `${label || ""} ${def.name} ${sub} ${type}`]);
    }));
    Object.entries(L.BJTS).forEach(([k, m]) => out.push(["Semiconductors", `${m.pol > 0 ? "NPN" : "PNP"} · ${k}`, `${m.v} V ${m.p} W`, m.pol > 0 ? "npn" : "pnp", { model: k }, `${k} transistor bjt ${m.pol > 0 ? "npn" : "pnp"} ${m.ge ? "germanium" : "silicon"} ${m.use}`]));
    Object.entries(L.MOSFETS).forEach(([k, m]) => out.push(["Semiconductors", `${m.pol > 0 ? "N" : "P"}-MOSFET · ${k}`, `${m.v} V ${m.p} W`, m.pol > 0 ? "nmos" : "pmos", { model: k }, `${k} mosfet fet ${m.use}`]));
    Object.entries(L.JFETS).forEach(([k, m]) => out.push(["Semiconductors", `${m.pol > 0 ? "N" : "P"}-JFET · ${k}`, `${fmtEng(m.beta * m.vto * m.vto, "A", 2)} IDSS`, m.pol > 0 ? "njf" : "pjf", { model: k }, `${k} jfet fet junction ${m.use}`]));
    Object.entries(L.REGS).forEach(([k, m]) => out.push(["Integrated circuits", `Regulator · ${k}`, m.use, "reg", { model: k }, `${k} regulator voltage ${m.adj ? "adjustable" : "fixed"} ${m.pol > 0 ? "positive" : "negative"} ${m.use} lm${k} ${m.pkg}`]));
    Object.entries(L.SHUNTS).forEach(([k, m]) => out.push(["Integrated circuits", `Shunt reference · ${k}`, m.use, "tl431", { model: k }, `${k} shunt reference regulator programmable zener ${m.use}`]));
    Object.entries(L.ZENERS).forEach(([k, z]) => out.push(["Semiconductors", `Zener · ${k}`, `${z.bv} V ${z.p} W`, "zener", { model: k }, `${k} zener ${z.bv}v`]));
    Object.keys(L.LEDS).forEach(k => out.push(["Semiconductors", `LED · ${k}`, `${L.LEDS[k].vf} V`, "led", { color: k }, `led ${k}`]));
    Object.entries(L.DIODES).forEach(([k, d]) => out.push(["Semiconductors", `Diode · ${k}`, d.use, "diode", { model: k }, `${k} diode ${d.kind} ${d.use}`]));
    Object.entries(L.BRIDGES).forEach(([k, b]) => out.push(["Semiconductors", `Bridge rectifier · ${k}`, b.use, "bridge", { model: k }, `${k} bridge rectifier ${b.use}`]));
    Object.entries(L.NTCS).forEach(([k, m]) => out.push(["Passive", `Inrush limiter · ${k}`, m.use, "ntc", { model: k }, `${k} ntc thermistor inrush current limiter soft start ${m.use}`]));
    Object.entries(L.MOVS).forEach(([k, m]) => out.push(["Passive", `Varistor · ${k}`, m.use, "mov", { model: k }, `${k} mov varistor surge protection ${m.use}`]));
    Object.entries(L.GASREGS).forEach(([k, m]) => out.push(["Gas-discharge tubes", `Voltage regulator · ${k}`, m.use, "gasreg", { model: k }, `${k} ${k.replace("0", "o")} vr gas regulator glow discharge stabilizer ${m.use}`]));
    L.SPEAKER_PRESETS.forEach(p => out.push(["Passive", p.name, `${p.r} Ω, fs ${p.fs} Hz`, "speaker", { model: "ts", r: p.r, re: p.re, le: p.le, fs: p.fs, qms: p.qms, qes: p.qes }, `${p.name} ${p.id.startsWith("hp") ? "headphones headphone phones earphones" : "speaker loudspeaker driver"}`]));
    Object.entries(L.CHIPAMPS).forEach(([k, m]) => out.push(["Integrated circuits", `Power amplifier · ${k}`, m.use, "chipamp", { model: k }, `${k} power amplifier chip amp gainclone ic ${m.pkg} ${m.use}`]));
    Object.entries(L.NEONS).forEach(([k, m]) => out.push(["Gas-discharge tubes", `Neon lamp · ${k}`, m.use, "neon", { model: k }, `${k} neon lamp glow indicator pilot light ne2 ${m.use}`]));
    Object.entries(L.EYES).forEach(([k, m]) => out.push(["Gas-discharge tubes", `Magic eye · ${k}`, m.use, "eye", { model: k }, `${k} magic eye tuning indicator electron ray cat's eye level meter ${m.use}`]));
    Object.entries(L.RELAYS).forEach(([k, m]) => out.push(["Switches & relays", `Relay · ${k}`, m.use, "relay", { model: k }, `${k} relay omron ${m.poles > 1 ? "dpdt" : "spdt"} coil ${m.use} mute standby channel`]));
    Object.entries(L.VACTROLS).forEach(([k, m]) => out.push(["Switches & relays", `Vactrol · ${k}`, m.use, "vactrol", { model: k }, `${k} vactrol optocoupler opto ldr photoresistor led cds ${m.use}`]));
    L.PICKUPS.forEach(p => out.push(["Sources", `Guitar pickup · ${p.name}`, `${fmtEng(p.l, "H")} ${fmtEng(p.r, "Ω")}`, "pickup", { preset: p.id, r: p.r, l: p.l, c: p.c, amp: p.amp }, `${p.name} guitar pickup bass single coil humbucker source`]));
    L.CARTRIDGES.forEach(p => out.push(["Sources", `Phono cartridge · ${p.name}`, fmtEng(p.mv, "V"), "phono", { preset: p.id, mv: p.mv, r: p.r, l: p.l }, `${p.name} phono cartridge turntable record riaa mm mc vinyl source`]));
    L.ITX_PRESETS.forEach(p => out.push(["Transformers", p.name, "", "itx", Object.assign({}, ...["ratio", "lp", "dcrp", "dcrs", "llk", "cs", "idc", "ct"].map(k => ({ [k]: p[k] }))), `${p.name} transformer interstage input step-up`]));
    Object.entries(L.JACKS).forEach(([k, j]) => out.push(["Ground & connectors", `Jack · ${j.use}`, k, "jack", { kind: k }, `jack socket input output ${k} ${j.use} phone headphone`]));
    Object.entries(L.OUTPUT_TX).forEach(([k, m]) => out.push(["Transformers", `Output · ${m.name}`, `${m.w} W ${m.ma} mA`, "opt_cat", { model: k }, `${k} ${m.name} output transformer single-ended`]));
    Object.entries(L.OPT_SE).forEach(([k, m]) => out.push(["Transformers", `Output · ${m.name}`, `SE ${fmtEng(m.p.zp, "Ω")} ${m.w} W ${m.ma} mA`, "opt_se", Object.assign({}, m.p), `${k} ${m.name} output transformer single-ended ${m.maker}`]));
    Object.entries(L.OPT_PP).forEach(([k, m]) => out.push(["Transformers", `Output · ${m.name}`, `PP ${fmtEng(m.p.zaa, "Ω")} ${m.w} W`, "opt_pp", Object.assign({}, m.p), `${k} ${m.name} output transformer push-pull ultralinear ${m.maker}`]));
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
  // (and which transistor: the tracer draws their curves too)
  function announceSelectedTube(c) {
    const isTube = c && c.type === "tube" && tubeKind(tubeByName(c.params.tube)) !== "rectifier", isSemi = c && CadLib.isTransistor(c.type);
    if (!isTube && !isSemi) { selectedTubeId = null; return; }
    const key = c.id + ":" + (isTube ? c.params.tube : c.params.model);
    if (key === selectedTubeId) return;
    selectedTubeId = key; lastTubeId = c.id;
    if (!channel) return;
    try {
      channel.postMessage(isTube ? { type: "SELECT_TUBE", id: c.id, tube: c.params.tube, label: c.label, def: window.SpiceModel && SpiceModel.isCustom(tubeByName(c.params.tube)) ? tubeByName(c.params.tube) : undefined }
        : { type: "SELECT_TUBE", id: c.id, semi: c.type, model: c.params.model, label: c.label });
    } catch (e) {}
  }

  let inspectorFor = null;
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
          <p class="insp-help">Drag to move · Space rotates parts · Del deletes · D duplicates · M mirrors.<br>Drag a wire segment sideways to move it; connected wires follow.</p>`;
      } else buildCircuitPanel(host);
    }
    const live = document.getElementById("insp-live");
    if (live) live.innerHTML = c ? liveReadout(c) : circuitReadout();
    syncDrawer();
    renderBom(); renderChecks();
  }

  // Narrow windows (below 900 px, where the page's CSS makes the inspector a drawer): it slides in
  // when something is selected and out when the selection is cleared; the toolbar's Inspector
  // button (the "inspector" command) opens and closes it at any time.
  const isNarrow = () => window.innerWidth <= 900;
  let drawerFor = "";
  function syncDrawer() {
    const sig = selSig() + "|" + [...S.sel.wires].join(",");
    if (sig === drawerFor) return;
    drawerFor = sig;
    if (isNarrow()) setDrawer(S.sel.comps.size + S.sel.wires.size > 0);
  }
  function setDrawer(on) { document.body.classList.toggle("insp-open", on); cmds.sync(); }

  function buildCompInspector(host, c) {
    const def = LIB[c.type];
    host.innerHTML = `<div class="insp-title">${def.name}</div>`;
    if (window.Hints) Hints.attach(host.firstChild, Hints.parts[c.type], def.name);
    if (!def.noLabel) host.appendChild(row("Designator", input("text", c.label, v => { c.label = v.trim() || c.label; commit(); })));
    (canMirror(c.type) ? def.fields.concat([CadLib.FLIP_FIELD]) : def.fields).forEach(f => {
      if (f.when && !f.when(c)) return;
      // a heading over the fields that follow it (the signal generator's Signal / Level / Output)
      if (f.kind === "heading") { const h = document.createElement("div"); h.className = "insp-sub"; h.textContent = f.label; host.appendChild(h); return; }
      let el;
      if (f.kind === "eng") {
        // magnitude: the field shows the size of a signed value whose sign another field sets (the
        // DC supply's Polarity); a typed minus still flips it
        el = input("text", f.optional && !(c.params[f.key] > 0) ? "" : fmtEng(f.magnitude ? Math.abs(c.params[f.key]) : c.params[f.key], ""), v => {
          if (f.optional && !String(v).trim()) { delete c.params[f.key]; commit(); return; }
          let n = parseEng(v);
          if (f.magnitude && n >= 0 && c.params[f.key] < 0) n = -n;
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
        // an option's third element puts it under that heading (<optgroup>), in the order the headings come
        const groups = {};
        (typeof f.options === "function" ? f.options(c) : f.options).forEach(([v, t, g]) => {
          const o = document.createElement("option"); o.value = v; o.textContent = t;
          if (!g) { el.appendChild(o); return; }
          if (!groups[g]) { groups[g] = document.createElement("optgroup"); groups[g].label = g; el.appendChild(groups[g]); }
          groups[g].appendChild(o);
        });
        el.value = String(f.get ? f.get(c) : c.params[f.key]);
        if (el.selectedIndex < 0) el.selectedIndex = 0;   // a setting the part was saved without (e.g. Mirror) shows its default
        el.addEventListener("change", () => { if (LIB[c.type].flip && f.key === "pos") setSwitch(c, el.value); else if (f.apply) { f.apply(c, el.value); commit(); } else { c.params[f.key] = el.value; commit(); } });
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
    // what the part library adds for this kind of part: a line of text, then a panel (cad-components.js)
    const info = def.info && def.info(c);
    if (info) { const p = document.createElement("p"); p.className = "insp-help"; p.textContent = info; host.appendChild(p); }
    const panel = def.panel && def.panel(c, readoutApi(c));
    if (panel) host.appendChild(panel);
    if (!def.noLabel) {
      host.appendChild(row("Part number (BOM)", input("text", c.params.partno || "", v => { c.params.partno = v.trim(); commit(); updateInspector(); })));
      // what the number says the real part is: Board Design takes its footprint and size (mpn.js)
      const pn = window.PartNo && PartNo.resolve(c.params, c.type);
      if (pn) { const p = document.createElement("p"); p.className = "insp-help" + (pn.warn.length ? " warn" : pn.known ? " ok" : ""); p.textContent = PartNo.describe(pn) + pn.warn.map(w => " · " + w).join(""); host.appendChild(p); }
    }
    const live = document.createElement("div"); live.id = "insp-live"; live.className = "insp-live";
    host.appendChild(live);
    const act = document.createElement("div"); act.className = "insp-actions";
    act.innerHTML = `<button class="btn" data-a="rot" title="Rotate (Space)" ${def.noRotate ? "disabled" : ""}>${ICONS.rotate} Rotate</button><button class="btn" data-a="mir" title="Mirror left–right (M)" ${canMirror(c.type) ? "" : "disabled"}>${ICONS.mirror} Mirror</button><button class="btn danger" data-a="del" title="Delete (Del)">${ICONS.delete} Delete</button>`;
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

  // the rms voltage between two of a part's pins over the capture (the DC value without one)
  function vRmsAcross(c, a, b) {
    const wa = waveOf(c, a), wb = waveOf(c, b);
    if (wa && wb) { let s = 0; for (let i = 0; i < wa.length; i++) { const v = wa[i] - wb[i]; s += v * v; } return Math.sqrt(s / wa.length); }
    const va = netDC(pinNetOf(c, a)), vb = netDC(pinNetOf(c, b));
    return va === null || vb === null ? null : Math.abs(va - vb);
  }
  // a fuse's or an inrush limiter's rms current, and the resistance it ran at (an NTC's self-heated one)
  function seriesPart(c) {
    const r = c.type === "fuse" ? CadLib.fuseCold(c.params.a) : S.sim.result && S.sim.result.ntc && S.sim.result.ntc[c.id] ? S.sim.result.ntc[c.id].r : null, v = vRmsAcross(c, "1", "2");
    return r === null || v === null ? null : { r, i: v / r, p: v * v / r };
  }
  // The simulation as a part sees it, for the readouts and panels of the part library
  // (cad-components.js: readout(c, R), panel(c, R)).
  function readoutApi(c) {
    const netOf = pid => pinNetOf(c, pid);
    const vAcross = (a, b) => { const va = netDC(netOf(a)), vb = netDC(netOf(b)); return va === null || vb === null ? null : va - vb; };
    const vRms = (a, b) => vRmsAcross(c, a, b);
    const pAvg = (a, b, R) => { const wa = waveOf(c, a), wb = waveOf(c, b); if (!wa || !wb) { const v = vAcross(a, b); return v === null ? null : v * v / R; } let s = 0; for (let i = 0; i < wa.length; i++) { const v = wa[i] - wb[i]; s += v * v; } return s / wa.length / R; };
    return {
      r: S.sim.result, kv, note: (text, cls) => `<p class="insp-help${cls ? " " + cls : ""}">${text}</p>`,
      vAcross, vRms, pAvg, netDC, pinNet: netOf, pinCurrent: pid => pinCurrent(c, pid),
      // the source of a power rail's net: this rail or the first other rail on it (buildNetlist)
      railDevice: () => { const n = netOf("1"), k = S.comps.find(q => q.type === "rail" && pinNetOf(q, "1") === n && S.sim.result.dc.devices[q.id]); return k ? S.sim.result.dc.devices[k.id] : null; },
      tubeData: () => tubeData(c), tubeLimits: () => tubeLimits(c), limitRows: () => limitRows(c),
      seriesPart: () => seriesPart(c), resistorPower: () => resistorPower(c), speakerPower: () => speakerPower(c), otDcCurrent: () => otDcCurrent(c),
      scopeChannels: () => scopeChannels(c), wave: pid => waveOf(c, pid), signalFreq, stats
    };
  }
  function liveReadout(c) {
    const head = `<div class="insp-sub">Operating point${simPct()}</div>`;
    if (!S.sim.result) return head + `<p class="insp-help">${S.sim.error || (S.sim.busy ? "Simulating…" : "Not simulated yet.")}</p>`;
    const f = LIB[c.type].readout;
    return f ? head + f(c, readoutApi(c)) : "";
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
    let out = 0, tubes = 0, res = 0, semi = 0, ics = 0, sup = 0, haveSup = false;
    S.comps.forEach(c => {
      if (c.type === "speaker") { const sp = speakerPower(c); if (sp) out += sp.p; }
      else if (c.type === "resistor") { const p = resistorPower(c); if (p) res += p; }
      else if (c.type === "tube") { const d = tubeData(c); if (d && d.dc && d.kind !== "rectifier") tubes += (d.metrics ? d.metrics.pAvg : d.dc.vak * d.dc.ia) + (d.dc.vg2k && d.dc.ig2 ? d.dc.vg2k * d.dc.ig2 : 0); }
      else if (c.type === "opamp" || c.type === "chipamp") { const d = (r.dc.devices[c.id] || {}).main; if (d && d.pd > 0) ics += d.pd; }
      else if (CadLib.isTransistor(c.type)) { const d = (r.dc.devices[c.id] || {}).main; if (d && d.pd > 0) semi += d.pd; }
      else if (c.type === "reg" || c.type === "tl431") { const d = (r.dc.devices[c.id] || {}).main; if (d && d.pd > 0) ics += d.pd; }
      else if (c.type === "vdc" || c.type === "rail") { const d = (r.dc.devices[c.id] || {}).main; if (d) { sup += -d.i * c.params.v; haveSup = true; } }
    });
    let h = `<div class="insp-sub">Power</div>`;
    if (out > 0) h += kv("Output (speakers)", fmtEng(out, "W", 2));
    if (tubes > 0) h += kv("Tubes (anode + screen)", fmtEng(tubes, "W", 2));
    if (semi > 0) h += kv("Transistors", fmtEng(semi, "W", 2));
    if (ics > 0) h += kv("Integrated circuits", fmtEng(ics, "W", 2));
    if (res > 0) h += kv("Resistors", fmtEng(res, "W", 2));
    if (haveSup) h += kv("From DC supplies", fmtEng(sup, "W", 2));
    return h;
  }

  function circuitReadout() {
    const T = topo();
    const counts = {};
    S.comps.forEach(c => { counts[c.type] = (counts[c.type] || 0) + 1; });
    const h = kv("Parts · wires · nets", `${S.comps.length} · ${S.wires.length} · ${T.nodeCount}`) + powerSummary();
    return h + `<div class="insp-sub">Checks${simPct()}</div>` + checksHTML(circuitIssues());
  }
  const checksHTML = issues => (issues.length ? issues.map(i => `<p class="insp-help warn">⚠ ${i}</p>`).join("") : `<p class="insp-help ok">✓ No problems found.</p>`);
  // The Checks tab of the panel under the sheet: the same list, with the count on its tab
  function renderChecks() {
    const host = document.getElementById("checks-pane"), count = document.getElementById("checks-count");
    if (!host) return;
    const issues = circuitIssues();
    count.textContent = issues.length ? String(issues.length) : "";
    if (!host.hidden) host.innerHTML = checksHTML(issues);
  }
  // wiring problems and every part beyond its rating, one sentence each
  function circuitIssues() {
    const T = topo();
    const issues = [];
    if (hasCircuit() && !T.hasGround) issues.push("No ground symbol.");
    const open = [];
    S.comps.forEach(c => { if (c.type === "scope") return; compPins(c).forEach(p => { if (!T.pinConnected.get(c.id + ":" + p.id)) { if (c.type === "opt_pp" && (p.id === "U1" || p.id === "U2")) return; if (c.type === "opamp" && (p.id === "1" || p.id === "8")) return; open.push(`${c.label || LIB[c.type].name}.${p.id}`); } }); });
    const lonely = S.comps.filter(c => c.type === "offsheet" && !connRefs(c).length && !S.comps.some(k => k !== c && (k.type === "offsheet" || k.type === "rail") && connName(k) === connName(c))).map(c => c.params.name || "(no name)");
    if (lonely.length) issues.push("Sheet connectors without a partner: " + lonely.join(", "));
    // power rails: one voltage per net, never on ground
    const railsOn = new Map();
    S.comps.forEach(c => { if (c.type !== "rail") return; const n = T.pinNet.get(c.id + ":1"); if (!railsOn.has(n)) railsOn.set(n, []); railsOn.get(n).push(c); });
    railsOn.forEach((list, n) => {
      const named = list.map(c => `${c.params.name || "(no name)"} ${fmtEng(+c.params.v || 0, "V")}`).filter((t, i, a) => a.indexOf(t) === i);
      if (n === 0) issues.push("Power rail on ground: " + named.join(", "));
      else if (list.some(c => +c.params.v !== +list[0].params.v)) issues.push(`Power rails on one net with different voltages: ${named.join(", ")} (the simulation uses ${named[0]})`);
    });
    if (open.length) issues.push("Unconnected pins: " + open.slice(0, 8).join(", ") + (open.length > 8 ? ` (+${open.length - 8})` : ""));
    // parts whose terminals are wired together
    const shortPairs = { resistor: [["1", "2"]], capacitor: [["1", "2"]], electrolytic: [["+", "-"]], inductor: [["1", "2"]], speaker: [["+", "-"]], fuse: [["1", "2"]], ntc: [["1", "2"]], mov: [["1", "2"]], gasreg: [["A", "K"]], neon: [["A", "K"]], eye: [["T", "K"]], itx: [["P1", "P2"], ["S1", "S2"]], diode: [["A", "K"]], bridge: [["+", "-"], ["AC1", "AC2"]], zener: [["A", "K"]], led: [["A", "K"]], npn: [["C", "E"]], pnp: [["C", "E"]], nmos: [["D", "S"]], pmos: [["D", "S"]], njf: [["D", "S"]], pjf: [["D", "S"]], reg: [["I", "O"]], tl431: [["K", "A"]], vdc: [["+", "-"]], pickup: [["+", "-"]], phono: [["+", "-"]], relay: [["A1", "A2"]], vactrol: [["A", "K"]], isrc: [["+", "-"]], opamp: [["V+", "V-"]], chipamp: [["V+", "V-"]], siggen: [["+", "-"]],
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
    S.comps.forEach(c => { if (c.type !== "opt_se" || !(+c.params.idc > 0)) return; const i = otDcCurrent(c); if (i !== null && i > +c.params.idc) issues.push(`${c.label} carries ${(i * 1000).toFixed(0)} mA DC, more than its ${fmtEng(+c.params.idc, "A")} rating.`); });
    // an output transformer's core driven past its knee
    S.comps.forEach(c => {
      const tr = (c.type === "opt_se" || c.type === "opt_cat" || c.type === "opt_pp") && S.sim.result && S.sim.result.tran && S.sim.result.tran.devices[c.id];
      if (!tr) return; let pk = 0; for (let k = 0; k < tr.i.length; k++) pk = Math.max(pk, Math.abs(tr.i[k]));
      if (pk > 0.95) issues.push(`${c.label}: the output transformer's core saturates (flux ${Math.round(pk * 100)} % of its knee): bass distortion. Less drive at this frequency${c.type === "opt_pp" ? ", the halves' DC in balance" : ", less DC"}, or a bigger transformer.`);
    });
    S.comps.forEach(c => { if (c.type !== "resistor" || !+c.params.w) return; const p = resistorPower(c); if (p !== null && p > +c.params.w) issues.push(`${c.label} dissipates ${fmtEng(p, "W", 2)}, more than its ${+c.params.w} W rating.`); });
    S.comps.forEach(c => {
      if (!CadLib.isTransistor(c.type) || !S.sim.result) return;
      const d = (S.sim.result.dc.devices[c.id] || {}).main, m = CadLib.semiTable(c.type)[c.params.model];
      if (!d || !m) return;
      const v = Math.abs(d.vce !== undefined ? d.vce : d.vds);
      if (d.pd > m.p) issues.push(`${c.label} (${c.params.model}) dissipates ${fmtEng(d.pd, "W", 2)}, more than its ${m.p} W rating.`);
      if (v > m.v) issues.push(`${c.label} (${c.params.model}) has ${v.toFixed(0)} V across it, more than its ${m.v} V rating.`);
    });
    S.comps.forEach(c => {
      if (c.type !== "opamp" || !S.sim.result) return;
      const d = (S.sim.result.dc.devices[c.id] || {}).main, m = CadLib.OPAMPS[c.params.model];
      if (d && m && d.vs > m.vmax) issues.push(`${c.label} (${c.params.model}) has ${d.vs.toFixed(1)} V between V+ and V−, more than its ${m.vmax} V rating.`);
      if (d && m && d.vs < 2) issues.push(`${c.label} (${c.params.model}) has no supply between V+ and V−.`);
    });
    // power amplifier ICs: the supply within its range, the dissipation within the package's, the LM3886 not muted
    S.comps.forEach(c => {
      if (c.type !== "chipamp" || !S.sim.result) return;
      const d = (S.sim.result.dc.devices[c.id] || {}).main, m = CadLib.CHIPAMPS[c.params.model];
      if (!d || !m) return;
      if (d.vs > m.vmax) issues.push(`${c.label} (${c.params.model}) has ${d.vs.toFixed(1)} V between its supply pins, more than its ${m.vmax} V rating.`);
      else if (d.vs < m.vmin) issues.push(`${c.label} (${c.params.model}) has ${d.vs.toFixed(1)} V between its supply pins, less than the ${m.vmin} V it needs.`);
      if (d.pd > m.pmax) issues.push(`${c.label} (${c.params.model}) dissipates ${fmtEng(d.pd, "W", 2)}, more than the ${m.pmax} W its package can${c.params.model === "LM386" ? "" : " on a large heatsink"}.`);
      const mu = (S.sim.result.dc.devices[c.id + "#mute"] || {}).main;
      if (c.params.model === "LM3886" && mu && !(mu.i > 0.5e-3 || -mu.i > 0.5e-3)) issues.push(`${c.label} (LM3886) is muted: draw 0.5 mA or more from its mute pin (8), a resistor to V− (10 kΩ from −28 V).`);
    });
    S.comps.forEach(c => {
      if (c.type !== "reg" || !S.sim.result) return;
      const d = (S.sim.result.dc.devices[c.id] || {}).main, m = CadLib.REGS[c.params.model];
      if (!d || !m) return;
      const across = m.adj ? d.vio : d.vin;
      if (across > m.vmax) issues.push(`${c.label} (${c.params.model}) has ${across.toFixed(1)} V ${m.adj ? "between input and output" : "at its input"}, more than its ${m.vmax} V rating.`);
      if (d.pd > m.p) issues.push(`${c.label} (${c.params.model}) dissipates ${fmtEng(d.pd, "W", 2)}, more than its ${m.p} W rating.`);
      else if (d.pd > (m.pkg === "TO-92" ? 0.6 : 2)) issues.push(`${c.label} (${c.params.model}) dissipates ${fmtEng(d.pd, "W", 2)}: ${m.pkg === "TO-92" ? "too much for a TO-92" : "it needs a heatsink"}.`);
      if (d.vin > 1 && d.vio < m.vdo + 0.5) issues.push(`${c.label} (${c.params.model}) is in dropout: ${d.vio.toFixed(2)} V between input and output, it needs ${(m.vdo + 0.5).toFixed(1)} V or more.`);
      if (m.adj && d.vio > 1 && d.iout < m.iq) issues.push(`${c.label} (${c.params.model}) carries ${fmtEng(d.iout, "A", 2)}, less than its ${fmtEng(m.iq, "A")} minimum load: the output rises.`);
    });
    S.comps.forEach(c => {
      if (c.type !== "tl431" || !S.sim.result) return;
      const d = (S.sim.result.dc.devices[c.id] || {}).main, m = CadLib.SHUNTS[c.params.model];
      if (d && m && d.vka > m.v) issues.push(`${c.label} (${c.params.model}) has ${d.vka.toFixed(1)} V on its cathode, more than its ${m.v} V rating.`);
      if (d && m && d.pd > m.p) issues.push(`${c.label} (${c.params.model}) dissipates ${fmtEng(d.pd, "W", 2)}, more than its ${m.p} W rating.`);
    });
    // diodes and bridges: the peak reverse voltage over the capture (or DC) against VRRM, the average current against the rating
    S.comps.forEach(c => {
      if ((c.type !== "diode" && c.type !== "bridge") || !S.sim.result) return;
      const m = c.type === "diode" ? CadLib.DIODES[c.params.model] : CadLib.BRIDGES[c.params.model];
      if (!m) return;
      const [hi, lo] = c.type === "diode" ? ["K", "A"] : ["+", "-"], wh = waveOf(c, hi), wl = waveOf(c, lo);
      let piv = null;
      if (wh && wl) { piv = -Infinity; for (let k = 0; k < wh.length; k++) piv = Math.max(piv, wh[k] - wl[k]); }
      else { const a = netDC(pinNetOf(c, hi)), b = netDC(pinNetOf(c, lo)); if (a !== null && b !== null) piv = a - b; }
      const i = pinCurrent(c, c.type === "diode" ? "A" : "+"), iav = i === null ? null : Math.abs(i);
      if (piv !== null && piv > m.v) issues.push(`${c.label} (${c.params.model}) sees ${piv.toFixed(0)} V in reverse, more than its ${m.v} V rating.`);
      if (iav !== null && iav > m.i) issues.push(`${c.label} (${c.params.model}) carries ${fmtEng(iav, "A", 2)} on average, more than its ${m.i} A rating.`);
    });
    S.comps.forEach(c => { if (c.type !== "zener" || !S.sim.result) return; const z = CadLib.ZENERS[c.params.model], v = netDC(pinNetOf(c, "A")), w = netDC(pinNetOf(c, "K")), i = pinCurrent(c, "A"); if (z && v !== null && w !== null && i !== null && Math.abs((v - w) * i) > z.p) issues.push(`${c.label} (${c.params.model}) dissipates ${fmtEng(Math.abs((v - w) * i), "W", 2)}, more than its ${z.p} W rating.`); });
    // fuses at 75 % of their rating or less (the makers' derating), inrush limiters within their current
    S.comps.forEach(c => {
      if ((c.type !== "fuse" && c.type !== "ntc") || !S.sim.result) return;
      const sp = seriesPart(c); if (!sp) return;
      if (c.type === "fuse") {
        const a = +c.params.a;
        if (sp.i > a) issues.push(`${c.label} (${c.params.speed}${fmtEng(a, "A")}) carries ${fmtEng(sp.i, "A", 2)} rms, more than its rating: it blows.`);
        else if (sp.i > 0.75 * a) issues.push(`${c.label} (${c.params.speed}${fmtEng(a, "A")}) runs at ${Math.round(sp.i / a * 100)} % of its rating: keep a fuse at 75 % or less, or it ages and blows.`);
      } else {
        const m = CadLib.NTCS[c.params.model];
        if (m && sp.i > m.imax) issues.push(`${c.label} (${c.params.model}) carries ${fmtEng(sp.i, "A", 2)} rms, more than its ${m.imax} A rating.`);
      }
    });
    // relays: the coil's voltage near its rating (it may not pull in below 75 %, and it overheats well
    // above); vactrols: the LED's current within its 40 mA
    S.comps.forEach(c => {
      if (!S.sim.result) return;
      if (c.type === "relay") {
        const v = +c.params.v || 12, vc = Math.abs(netDC(T.pinNet.get(c.id + ":A1")) - netDC(T.pinNet.get(c.id + ":A2"))), m = CadLib.RELAYS[c.params.model];
        if (!m || !isFinite(vc)) return;
        if (vc > 1.3 * v) issues.push(`${c.label} (${c.params.model}, ${v} V coil) has ${fmtEng(vc, "V", 2)} across its coil: more than 130 % of its rating, it overheats. Use a ${vc > 18 ? 24 : 12} V coil or a dropping resistor.`);
        else if (vc > 0.2 * v && vc < m.op * v) issues.push(`${c.label} (${c.params.model}, ${v} V coil) has only ${fmtEng(vc, "V", 2)} across its coil: below its must-operate ${fmtEng(m.op * v, "V")}, it may not pull in.`);
      } else if (c.type === "vactrol") {
        const i = pinCurrent(c, "A");
        if (i !== null && i > 0.04) issues.push(`${c.label} (${c.params.model}) has ${fmtEng(i, "A", 2)} in its LED, more than the 40 mA it is rated for: raise its series resistor.`);
      }
    });
    // gas regulators: lit, and within their current range; interstage transformers: the primary's DC within the gap's rating
    S.comps.forEach(c => {
      if (c.type !== "gasreg" || !S.sim.result) return;
      const d = (S.sim.result.dc.devices[c.id] || {}).main, m = CadLib.GASREGS[c.params.model];
      if (!d || !m) return;
      if (!d.q) issues.push(`${c.label} (${c.params.model}) does not strike: it needs ${m.vs} V across it to light, and then ${m.imin * 1000}–${m.imax * 1000} mA through it.`);
      else if (d.i > m.imax) issues.push(`${c.label} (${c.params.model}) carries ${fmtEng(d.i, "A", 2)}, more than its ${m.imax * 1000} mA maximum: raise its series resistor.`);
      else if (d.i < m.imin) issues.push(`${c.label} (${c.params.model}) carries ${fmtEng(d.i, "A", 2)}, less than the ${m.imin * 1000} mA it needs to regulate: lower its series resistor or lighten the load.`);
    });
    // neon lamps: no more than twice the design current; magic eyes: the target within its rating
    S.comps.forEach(c => {
      if (!S.sim.result) return;
      if (c.type === "neon") {
        const m = CadLib.NEONS[c.params.model], i = pinCurrent(c, "A");
        if (m && i !== null && Math.abs(i) > 2 * m.i) issues.push(`${c.label} (${c.params.model}) carries ${fmtEng(Math.abs(i), "A", 2)}, more than twice its ${fmtEng(m.i, "A")} design current: it darkens and fails early. Raise its series resistor.`);
      }
      if (c.type === "eye") {
        const m = CadLib.EYES[c.params.model], vt = netDC(pinNetOf(c, "T")), vk = netDC(pinNetOf(c, "K"));
        if (m && vt !== null && vk !== null && vt - vk > 1.1 * m.vt) issues.push(`${c.label} (${c.params.model}) has ${fmtEng(vt - vk, "V", 3)} on its target, above its ${m.vt} V rating.`);
      }
    });
    S.comps.forEach(c => {
      if (c.type !== "itx" || !S.sim.result) return;
      const i = pinCurrent(c, "P1"), lim = +c.params.idc || 0;
      if (i === null) return;
      if (lim > 0 && Math.abs(i) > lim) issues.push(`${c.label} has ${fmtEng(Math.abs(i), "A", 2)} DC in its primary, more than the ${fmtEng(lim, "A")} it is gapped for: the core saturates.`);
      else if (lim === 0 && Math.abs(i) > 0.5e-3) issues.push(`${c.label} is ungapped but has ${fmtEng(Math.abs(i), "A", 2)} DC in its primary: feed it through a capacitor (parafeed) or use a gapped one.`);
    });
    // varistors: the voltage across them within their continuous rating
    S.comps.forEach(c => {
      if (c.type !== "mov" || !S.sim.result) return;
      const m = CadLib.MOVS[c.params.model], v = vRmsAcross(c, "1", "2"), dc = Math.abs((netDC(pinNetOf(c, "1")) || 0) - (netDC(pinNetOf(c, "2")) || 0));
      if (m && v !== null && (v > m.vrms || dc > m.vdc)) issues.push(`${c.label} (${c.params.model}) has ${fmtEng(v, "V", 1)} rms across it, more than its ${m.vrms} V continuous rating: it conducts and burns.`);
    });
    // capacitors against the rating set on them (from 80 %); an electrolytic the wrong way round
    S.comps.forEach(c => {
      if ((c.type !== "capacitor" && c.type !== "electrolytic") || !S.sim.result) return;
      const [a, b] = c.type === "capacitor" ? ["1", "2"] : ["+", "-"], wa = waveOf(c, a), wb = waveOf(c, b), va = netDC(pinNetOf(c, a)), vb = netDC(pinNetOf(c, b));
      let pk = null;
      if (wa && wb) { pk = 0; for (let k = 0; k < wa.length; k++) pk = Math.max(pk, Math.abs(wa[k] - wb[k])); } else if (va !== null && vb !== null) pk = Math.abs(va - vb);
      const vr = +c.params.v;
      if (vr && pk !== null && pk > vr) issues.push(`${c.label} has ${fmtEng(pk, "V", 1)} peak across it, more than its ${vr} V rating.`);
      else if (vr && pk !== null && pk > 0.8 * vr) issues.push(`${c.label} runs at ${Math.round(pk / vr * 100)} % of its ${vr} V rating: keep a capacitor at 80 % or less.`);
      if (c.type === "electrolytic" && va !== null && vb !== null && va - vb < -1) issues.push(`${c.label} is reversed: its − is ${fmtEng(vb - va, "V", 1)} above its +.`);
    });
    // tubes: the plate's average dissipation over the signal cycle (with a reactive load the
    // path may cross the Pa max curve for part of a cycle, which is normal); the DC value without signal
    S.comps.forEach(c => {
      if (c.type !== "tube") return; const d = tubeData(c); if (!d || !d.dc || d.kind === "rectifier") return;
      const avg = d.metrics ? d.metrics.pAvg : null, dc = d.dc.vak * d.dc.ia;
      if (avg !== null && avg > d.paMax) issues.push(`${c.label} over dissipation: ${avg.toFixed(1)} W on average over the signal cycle > ${d.paMax} W.`);
      else if (avg === null && dc > d.paMax) issues.push(`${c.label} over dissipation (${dc.toFixed(1)} W > ${d.paMax} W).`);
      const th = CadLib.anodeTemp(avg !== null ? avg : dc, d.paMax);
      if (th.glow > 0) issues.push(`${c.label}: its anode runs at about ${Math.round(th.t / 10) * 10} °C and glows red (red-plating): it will fail within hours.`);
    });
    S.comps.forEach(c => { if (c.type === "tube") tubeLimits(c).forEach(o => { if (o.share > 1) issues.push(o.text); }); });
    return issues;
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
      ? "A further sheet of this circuit, to the right of the last one, with the same title block. Join wires between sheets with Sheet connectors (Ground & connectors) of the same name."
      : "The sheet starts with an IEC 61082 drawing frame: ISO 5457 border, reference grid and an ISO 7200 title block.";
    document.getElementById("new-title").placeholder = mode === "add" ? "Sheet title (empty: same as sheet 1)" : "e.g. 2 × EL84 single-ended amplifier";
    document.getElementById("btn-new-create").textContent = mode === "add" ? "Add" : "Create";
    m.hidden = false; document.getElementById("new-title").focus();
  }
  function newCircuit(opts) {
    opts = Object.assign({ size: "A3", orient: "landscape", title: "" }, opts);
    if (revisions) revisions.detach();
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
  // The horizontal scroll bar under the drawing: its track spans the whole drawing (and the
  // view), the thumb is the part on screen, and every sheet is marked on it by its number.
  // Drag the thumb to scroll; click a sheet's mark to show that sheet, the bare track to move
  // a screen's width; the arrows (Page Up / Page Down) step from sheet to sheet. It shows
  // while there are several sheets or the drawing runs past the sides of the view.
  const hs = { range: null, key: "" };
  function drawingSpan() {
    let x1 = Infinity, x2 = -Infinity;
    S.comps.forEach(c => { const b = compBBox(c); x1 = Math.min(x1, b.x1); x2 = Math.max(x2, b.x2); });
    S.wires.forEach(w => { x1 = Math.min(x1, w.x1, w.x2); x2 = Math.max(x2, w.x1, w.x2); });
    return x1 <= x2 ? { x1, x2 } : null;
  }
  function hsRange() {
    const W = canvas.clientWidth, v1 = toWorld(0, 0).x, v2 = toWorld(W, 0).x, d = drawingSpan();
    if (!d) return null;
    const pad = 40 / S.view.scale;   // a little room past the drawing's ends
    return { x1: Math.min(d.x1 - pad, v1), x2: Math.max(d.x2 + pad, v2), v1, v2, over: d.x1 < v1 - 1e-6 || d.x2 > v2 + 1e-6 };
  }
  function updateHScroll() {
    const bar = document.getElementById("hscroll"); if (!bar) return;
    const list = frames();
    const r = hs.drag ? { ...hs.drag.range, v1: toWorld(0, 0).x, v2: toWorld(canvas.clientWidth, 0).x } : hsRange();
    const on = !!r && (list.length > 1 || r.over || !!hs.drag);
    bar.hidden = !on;
    if (!on) { hs.range = null; return; }
    hs.range = r;
    const track = document.getElementById("hs-track"), thumb = document.getElementById("hs-thumb"), tw = track.clientWidth, span = r.x2 - r.x1;
    const px = x => (x - r.x1) / span * tw;
    thumb.style.left = px(r.v1) + "px"; thumb.style.width = Math.max(16, px(r.v2) - px(r.v1)) + "px";
    thumb.setAttribute("aria-valuemin", 0); thumb.setAttribute("aria-valuemax", 100);
    thumb.setAttribute("aria-valuenow", Math.round(span > r.v2 - r.v1 ? (r.v1 - r.x1) / (span - (r.v2 - r.v1)) * 100 : 0));
    // the sheet marks, redrawn only when a sheet or the track's scale changed
    const marks = list.map(f => { const b = compBBox(f); return { id: f.id, no: sheetNo(f, list), title: f.params.title || "", l: px(b.x1), w: px(b.x2) - px(b.x1) }; });
    const key = JSON.stringify(marks.map(m => [m.id, m.no, m.title, Math.round(m.l), Math.round(m.w)]));
    if (key !== hs.key) {
      hs.key = key;
      track.querySelectorAll(".hs-mark").forEach(el => el.remove());
      if (list.length > 1) marks.forEach(m => {
        const el = document.createElement("div"); el.className = "hs-mark"; el.dataset.id = m.id;
        el.style.left = m.l + "px"; el.style.width = Math.max(2, m.w) + "px";
        el.textContent = m.w > 14 ? m.no : ""; el.title = `Sheet ${m.no}${m.title ? " · " + m.title : ""}: click to show it`;
        track.insertBefore(el, thumb);
      });
    }
    const cur = list.length > 1 ? viewedSheet() : -1;
    document.getElementById("hs-prev").hidden = document.getElementById("hs-next").hidden = list.length < 2;
    document.getElementById("hs-prev").disabled = cur <= 0;
    document.getElementById("hs-next").disabled = cur >= list.length - 1;
  }
  // the sheet that fills most of the view (its index in frames()), -1 for none
  function viewedSheet() {
    const list = frames(), v1 = toWorld(0, 0), v2 = toWorld(canvas.clientWidth, canvas.clientHeight);
    let best = -1, area = 0;
    list.forEach((f, i) => { const b = compBBox(f), a = Math.max(0, Math.min(b.x2, v2.x) - Math.max(b.x1, v1.x)) * Math.max(0, Math.min(b.y2, v2.y) - Math.max(b.y1, v1.y)); if (a > area) { area = a; best = i; } });
    return best;
  }
  // the previous (-1) or next (+1) sheet; from a view of all sheets, the first or last
  function stepSheet(dir) {
    const list = frames(); if (list.length < 2) return;
    const cur = viewedSheet(), f = list[Math.max(0, Math.min(list.length - 1, cur < 0 ? (dir > 0 ? 0 : list.length - 1) : cur + dir))];
    fitSheet(f);
  }
  // scroll so the left edge of the view is at world x
  function hsScrollTo(worldLeft) { S.view.ox = -worldLeft * S.view.scale; render(); }
  function bindHScroll() {
    const track = document.getElementById("hs-track"), thumb = document.getElementById("hs-thumb");
    thumb.addEventListener("pointerdown", e => {
      if (e.button !== 0 || !hs.range) return;
      e.preventDefault(); e.stopPropagation(); thumb.setPointerCapture(e.pointerId); thumb.classList.add("drag");
      hs.drag = { x0: e.clientX, v1: hs.range.v1, range: { x1: hs.range.x1, x2: hs.range.x2 } };
      const nav = document.getElementById("sheet-nav"); if (nav) nav.value = "";
    });
    thumb.addEventListener("pointermove", e => {
      if (!hs.drag) return;
      const d = hs.drag, k = (d.range.x2 - d.range.x1) / track.clientWidth;
      hsScrollTo(d.v1 + (e.clientX - d.x0) * k);
    });
    const end = () => { if (!hs.drag) return; hs.drag = null; thumb.classList.remove("drag"); render(); };
    thumb.addEventListener("pointerup", end); thumb.addEventListener("pointercancel", end);
    track.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target === thumb || !hs.range) return;
      e.preventDefault();
      const f = e.target.classList.contains("hs-mark") && S.comps.find(c => c.id === e.target.dataset.id);
      if (f) { fitSheet(f); return; }
      // the bare track: a screen's width towards the click
      const r = hs.range, x = r.x1 + (e.clientX - track.getBoundingClientRect().left) / track.clientWidth * (r.x2 - r.x1), w = r.v2 - r.v1;
      hsScrollTo(r.v1 + (x < r.v1 ? -1 : 1) * w * 0.9);
      const nav = document.getElementById("sheet-nav"); if (nav) nav.value = "";
    });
    bind("hs-prev", () => stepSheet(-1));
    bind("hs-next", () => stepSheet(1));
  }
  // file name from the title block (or a default)
  function baseName() {
    const f = S.comps.find(c => c.type === "frame"), t = f && (f.params.docno || f.params.title);
    return (t ? t.replace(/[^\w.\- ]+/g, "").trim().replace(/\s+/g, "-") : "") || "tube-circuit";
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
  // Bill of materials: a panel under the schematic (B), exported as TXT, CSV, XLSX or PDF (cad-bom.js)
  // ---------------------------------------------------------------------------
  // Tolerance runs: the Tolerance tab of the same panel (cad-tolerance.js)
  const tolerance = CadTolerance({ S, VERSION, buildNetlist, pool, cmds, esc: escH, fmtEng, measurements, setStatus, topo, withResult });
  // Power sweep: the Power tab (cad-power.js)
  const power = CadPower({ S, buildNetlist, cmds, commit, desig, esc: escH, fmtEng, harmonics, pool, scopeChannels, setStatus, signalFreq, speakerWave, topo, withResult });
  // Parameter sweep: the Sweep tab (cad-sweep.js)
  const sweep = CadSweep({ S, buildNetlist, cmds, commit, desig, esc: escH, fmtEng, harmonics, measurements, parseEng: CadLib.parseEng, pool, scopeChannels, setStatus, signalFreq, speakerWave, topo, withResult });
  // Listen: the Listen tab (cad-listen.js)
  const listen = CadListen({ S, buildNetlist, cmds, desig, esc: escH, fmtEng, pool, setStatus, topo });
  const { bomData, bomOpts, clearBomShown, exportBom, initBom, partStress, renderBom, toggleBom } = CadBom({ S, baseName, bind, cmds, renderChecks, renderTolerance: () => { tolerance.render(); power.render(); sweep.render(); listen.render(); tune.render(); }, commit, fmtEng, frames, netDC, otDcCurrent, pinCurrent, pinNetOf, render, resistorPower, seriesPart, setStatus, speakerPower, tubeByName, tubeData, tubeLimits, updateInspector, vRmsAcross, waveOf });
  // The AI assistant: the AI tab and the AI menu (cad-ai.js)
  const ai = CadAi({ S, VERSION, circuitIssues, commit, compPins, desig, fmtEng, harmonics, measurements, netAC, netDC, runSim, selectParts: selectFromBoard, setStatus, signalFreq, speakerWave, toggleBom, topo, tubeData, undo, whenSimulated });
  // Auto-tune: the Tune tab (cad-tune.js)
  // AI ▾ → Design from a description: the drawn design on a new sheet, one undo step
  function placeDesign(out) {
    const f = makeComp("frame", { size: out.frame.size, orient: out.frame.orient, title: out.frame.title, date: new Date().toISOString().slice(0, 10) }, 0, 0, 0);
    S.comps = [f]; S.wires = [];
    out.comps.forEach(o => {
      const c = makeComp(o.type, o.params, o.x, o.y, o.rot);
      c.params = Object.assign({}, LIB[o.type].defaults, o.params);
      if (o.label) c.label = o.label;
      S.comps.push(c);
    });
    out.wires.forEach(w => addSegment(w.x1, w.y1, w.x2, w.y2));
    normalizeWires(); S.topo = null;
    S.sel.comps.clear(); S.sel.wires.clear();
    setCurFile(null, "");
    storeBoard(null);
    commit(); fitStart();
    sendBoardNetlist(true);
  }
  const design = CadDesign({ S, circuitIssues, placeDesign, runSim, setStatus, whenSimulated });
  const datasheet = CadDatasheet({ S, buildPalette, setStatus });
  const tune = CadTune({ S, buildNetlist, cmds, commit, compPins, desig, esc: escH, fmtEng, harmonics, measurements, pool, scopeChannels, setStatus, signalFreq, speakerWave, toggleBom, topo, withResult });
  // PDF / PNG export and printing (cad-export.js)
  const { expOpts, exportPDF, initExport, openExportDialog, openPrintDialog, printPages, prnOpts, renderPNG, runExport, runPrint } = CadExport({ S, baseName, bind, bomData, compBBox, currentSheet, drawSheet, frames, setStatus, sheetNo });
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
    { file: "07-gubin-5ts4s-stereo.json", title: "Gubin stereo amplifier with 5Ц4С supply", tag: "tubes", about: "GUB-245-01, three sheets (Radio 4/1957; musicangel.ru Fig. 3): 373BX transformer, 5Ц4С rectifier with capacitor input and a 2.5 H choke, two 6N23P-EV + 6P14P channels; anode resistors 180 Ω keep the 5Ц4С within its 375 mA peak; 6P14P at 276 V, −8.5 V bias; 2.2 kΩ feedback (R11, R12): a phone at full volume (−5.6 dBV) gives 1.1 W at 0.32 % THD in triode, 2 W in pentode; 1.7 W at 1 % THD in triode" },
    { file: "13-2a3-single-ended-1627sea.json", title: "Single-ended 2A3, Hammond 1627SEA", tag: "tubes", about: "The classic directly heated triode amplifier: a 6SN7 stage R-C coupled to a cathode-biased 2A3 at RCA's 250 V, −45 V, 60 mA into 2.5 kΩ, on a Hammond 1627SEA; simulated 3.6 W at 1.8 % THD at 1 kHz (RCA: 3.5 W at 5 %). At 20 Hz and 2.5 W the 20 H primary loads the 2A3: 6 % THD" },
    { file: "14-el84-push-pull-ultralinear-1608.json", title: "Push-pull EL84 ultralinear, Hammond 1608", tag: "tubes", about: "Mullard-style: a 12AX7 stage and split-load phase splitter, 2 × EL84 ultralinear (40 % taps) with a shared 160 Ω cathode resistor into 8 kΩ on a Hammond 1608, 14 dB of feedback; simulated 11 W at 0.9 % THD at 1 kHz, 9.4 W at 30 Hz, and at 15 Hz the core saturates (15 % THD)" },
    { file: "15-6v6-push-pull-guitar-1750h.json", title: "Push-pull 6V6 guitar amplifier, Hammond 1750H", tag: "tubes", about: "Tweed-style: a 12AX7 gain stage and split-load phase splitter, 2 × 6V6GT cathode-biased (250 Ω) in class AB1 at 315 V, no feedback, on a Hammond 1750H (6.6 kΩ, 70 Hz–15 kHz); simulated 7.7 W at 2 % THD, 14.5 W driven to 15 %; the small core's 21 H puts 40 Hz 4 dB down" },
    { file: "03-12ax7-ccs-vs-resistor.json", title: "12AX7: plate resistor vs current source", tag: "tube + transistor", about: "J. Broskie, TubeCAD (2000): the same 12AX7 stage loaded by 150k (gain 70) and by an MPSA92 current source (gain 100), side by side" },
    { file: "04-12ax7-irf820-follower.json", title: "12AX7 stage + IRF820 follower", tag: "tube + MOSFET", about: "The GE 12AX7 data sheet's resistance-coupled stage (gain 50, 40 Vrms at 5 % THD) driving an IRF820 source follower" },
    { file: "05-10w-mosfet-amplifier.json", title: "10 W complementary MOSFET amplifier", tag: "MOSFETs", about: "homemade-circuits.com, fig. 1: BC177 input, BC107 driver, IRF540 / IRF9540 followers into 8 Ω (A3 sheet)" },
    { file: "01-2n3904-ce-unbypassed.json", title: "2N3904 common emitter, RE unbypassed", tag: "transistor", about: "University of Washington lab notes (2017), with the bench-measured part values: gain −4.7" },
    { file: "02-2n3904-ce-bypassed.json", title: "2N3904 common emitter, RE bypassed", tag: "transistor", about: "The same stage with 10 µF across RE: gain about −115, distorting at 50 mVpp in" },
    { file: "08-555-astable.json", title: "NE555 astable multivibrator", tag: "555", about: "555-timer-circuits.com, the astable multivibrator: 1k, 10k, 100 nF at 9 V; simulated 678 Hz at 51.8 % (formula 686 Hz, 52.4 %; the discharge transistor's 0.1 V makes the difference)" },
    { file: "09-555-flashing-led.json", title: "NE555 flashing LED", tag: "555", about: "555-timer-circuits.com, flashing LED: 1K, 470K, 1 µF, red LED through 1K, 9 V; simulated 1.51 Hz, about 0.33 s on and off (formula 1.53 Hz); run the oscilloscope's power-on transient for 3 s" },
    { file: "10-555-metronome.json", title: "NE555 metronome", tag: "555", about: "555-timer-circuits.com, metronome: 1K, 250K speed pot (here 50k), 22 µF, an 8 Ω speaker through 22 µF; simulated 0.641 Hz (formula 0.648 Hz); power-on transient 5 s" },
    { file: "11-555-car-tachometer.json", title: "NE555 car tachometer", tag: "555", about: "555-timer-circuits.com, car tachometer: a one-shot of 47k and 100 nF from a 9 V zener supply; simulated 5.16 ms pulses (1.1 RC = 5.17 ms), the meter's current proportional to the spark rate" },
    { file: "12-555-simplest-oscillator.json", title: "NE555 simplest oscillator", tag: "555", about: "555-timer-circuits.com, the simplest 555 oscillator: the output charges 100 nF through 10k; simulated 572 Hz at 60 % high, slower than the 721 Hz of an ideal output because pin 3 rises only to VCC − 1.4 V" }
  ];
  async function openExample(ex) {
    if (S.comps.length && !confirm(`Open the example "${ex.title}"?\n\nIt replaces the circuit on the sheet. Ctrl+Z brings the circuit back; its board layout is kept only if you saved the circuit.`)) return;
    try {
      const r = await fetch("examples/" + ex.file + VERSION);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const d = await r.json();
      if (Array.isArray(d.tubes) && window.SpiceModel) { d.tubes.forEach(t => { try { SpiceModel.add(t); } catch (e) { /* a built-in of that name */ } }); buildPalette(); }
      if (revisions) revisions.detach();
      loadCircuit(d);
      storeBoard(d.board || null);
      S.sel.comps.clear(); S.sel.wires.clear();
      setCurFile(null, "");                       // untitled: Save asks for a name, the example stays as it is
      commit(); fitStart(); markClean();
      sendBoardNetlist(true);
      setStatus("ok", `Example: ${ex.title}. ${ex.about}.`);
    } catch (err) { setStatus("error", `Could not open the example: ${err.message}`); }
  }
  // ---------------------------------------------------------------------------
  // Share by link (cad-share.js): the design deflated into the address after #c=, and on
  // aerocat.tech also kept by the site's link store, which gives the short link /s/<id>
  // ---------------------------------------------------------------------------
  async function shareLink() {
    const d = JSON.parse(circuitJSON());
    if (!document.getElementById("share-board").checked) delete d.board;
    const packed = await CadShare.pack(d), long = CadShare.link(location.href, packed);
    const id = await CadShare.store(packed, location.origin);
    return { url: id ? CadShare.shortLink(location.origin, id) : long, short: !!id, long };
  }
  let shareSeq = 0;
  async function updateShare() {
    const t = document.getElementById("share-text"), info = document.getElementById("share-info"), seq = ++shareSeq;
    t.value = ""; info.textContent = "Making the link…";
    try {
      const L = await shareLink();
      if (seq !== shareSeq) return;            // the board was ticked again meanwhile
      t.value = L.url; t.dataset.short = L.short ? "1" : "";
      info.textContent = L.short ? "Short link: the design is kept on aerocat.tech under this id."
        : `Long link: the design is inside it (${L.url.length.toLocaleString("en")} characters), nothing is stored. ` + (location.origin === CadShare.SITE ? "The short-link store could not be reached." : "Short links are made on aerocat.tech.")
          + (L.url.length > 16000 ? " A link this long can be cut short by some chat apps and e-mail; there, share it without the board or send the saved .json file." : "");
    } catch (err) { if (seq === shareSeq) { t.value = ""; info.textContent = "Cannot make a link: " + err.message; } }
  }
  function openShareDialog() {
    const cb = document.getElementById("share-board");
    cb.disabled = !S.board; cb.checked = !!S.board;
    document.getElementById("share-modal").hidden = false;
    updateShare().then(() => { const t = document.getElementById("share-text"); if (t.value) { t.focus(); t.select(); } });
  }
  async function copyShare() {
    const t = document.getElementById("share-text"); if (!t.value) return;
    try { await navigator.clipboard.writeText(t.value); } catch (e) { t.select(); document.execCommand("copy"); }
    setStatus("ok", "Link copied: whoever opens it gets this design");
  }
  // a link with #c=… (or a short link, which arrives as #s=<id>) opens its design, after asking
  // if there is a circuit on the sheet; the fragment is then taken off the address, so a reload
  // keeps the design as edited
  async function openSharedLink() {
    if (!window.CadShare) return;
    const packed = CadShare.fromHash(location.hash), id = CadShare.shortFromHash(location.hash);
    if (!packed && !id) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* file:// in some browsers */ }
    let d;
    try { d = await CadShare.unpack(packed || await CadShare.fetchShort(id, location.origin)); if (!d || d.app !== "TubeAmpCAD") throw new Error("not a Tube Amp CAD design"); }
    catch (err) { setStatus("error", "Could not open the shared link: " + err.message); return; }
    openDesign(d, "the design from this link", true);
  }
  // a design (as File › Save writes it) onto the sheet, untitled; `ask`: first ask if a circuit is there
  function openDesign(d, what, ask) {
    if (ask && S.comps.some(c => c.type !== "frame") && !confirm(`Open ${what}?\n\nIt replaces the circuit on the sheet. Ctrl+Z brings the circuit back; its board layout is kept only if you saved the circuit.`)) return false;
    try {
      if (Array.isArray(d.tubes) && window.SpiceModel) { d.tubes.forEach(t => { try { SpiceModel.add(t); } catch (e) { /* a built-in of that name */ } }); buildPalette(); }
      if (revisions) revisions.detach();          // a revision being opened attaches itself again after
      loadCircuit(d);
      storeBoard(d.board || null);
      S.sel.comps.clear(); S.sel.wires.clear();
      setCurFile(null, "");                       // untitled: Save asks for a name
      commit(); fitStart(); markClean();
      sendBoardNetlist(true);
      setStatus("ok", "Opened " + what + (sheetName().full ? ": " + sheetName().full : ""));
      return true;
    } catch (err) { setStatus("error", `Could not open ${what}: ` + err.message); return false; }
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
  // a circuit not saved to a file yet (new, or an example) goes by its title block: title, else identification number
  function sheetName() {
    const f = S.comps.find(c => c.type === "frame"), p = f ? f.params : {};
    return { name: String(p.title || p.docno || "").trim(), full: [p.docno, p.title].map(t => String(t || "").trim()).filter(Boolean).join(" · ") };
  }
  function showFile() {
    const sheet = curFile.name ? null : sheetName();
    const el = document.getElementById("cur-file"), name = curFile.name || sheet.name || "Untitled", dirty = isDirty();
    if (el) {
      el.textContent = name; el.classList.toggle("untitled", !curFile.name);
      if (dirty) { const d = document.createElement("span"); d.className = "dirty"; d.textContent = " •"; el.appendChild(d); }
      el.title = (curFile.name ? `Open file: ${name}` : (sheet.full ? sheet.full + " · " : "") + "Not saved to a file yet") + (dirty ? " · changes not saved (Ctrl+S)" : " · saved");
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
        if (revisions) revisions.detach();
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
    const nl = buildNetlist();
    const nn = n => (n === 0 ? "0" : "N" + n);
    const lines = ["* Tube Amp CAD export — " + new Date().toISOString().slice(0, 10), "* Koren tube models as behavioural sources (LTspice and ngspice syntax)"];
    const models = new Set();
    nl.elements.forEach(e => {
      if (e.internal) return;   // inside a part that goes out as a subcircuit (a 555's divider)
      const id = (e.id || "X").replace(/[^A-Za-z0-9_]/g, "_");
      const nd = (e.nodes || []).map(nn);
      switch (e.kind) {
        case "R": {
          // an inrush limiter at the resistance it settled at (cold before a simulation)
          const hot = e.ntc && S.sim.result && S.sim.result.ntc && S.sim.result.ntc[e.id];
          if (e.ntc) lines.push(`* ${id}: NTC inrush limiter, ${hot ? "self-heated as simulated" : "cold"} (${e.ntc.r25} ohm at 25 C)`);
          lines.push(`R${id} ${nd[0]} ${nd[1]} ${hot ? +hot.r.toPrecision(4) : e.r}`);
          break;
        }
        case "C": lines.push(`C${id} ${nd[0]} ${nd[1]} ${e.c}`); break;
        case "L": lines.push(`L${id} ${nd[0]} ${nd[1]} ${e.l}`); break;
        case "V": lines.push(`V${id} ${nd[0]} ${nd[1]} DC ${e.v}`); break;
        case "I": lines.push(`I${id} ${nd[0]} ${nd[1]} DC ${e.i}`); break;
        case "E": lines.push(`E${id} ${nd.join(" ")} ${e.gain}`); break;
        case "G": lines.push(`G${id} ${nd.join(" ")} ${e.gm}`); break;
        case "GLOW": {
          // no glow discharge in SPICE: lit, the simulator's own curve (vm plus r per ampere, eased
          // over 50 mV) one way only, dark the other way (it neither strikes nor goes out here)
          const m = e.model, x = `(V(${nd[0]},${nd[1]})-${m.vm})/0.05`;
          lines.push(`* ${id}: glow discharge, lit (maintains ${m.vm} V, strikes at ${m.vs} V, out below ${m.iext * 1000} mA: not in this model)`);
          lines.push(`B${id} ${nd[0]} ${nd[1]} I=V(${nd[0]},${nd[1]})/1e10+${+(0.05 / m.r).toPrecision(6)}*(max(${x},0)+ln(1+exp(-abs(${x}))))`);
          break;
        }
        case "RELAY": {
          // the contacts as voltage-controlled switches on the coil's resistance (S+ − S−), with its hysteresis
          const m = e.model, vt = (m.von + m.voff) / 2, vh = (m.von - m.voff) / 2;
          lines.push(`* ${id}: relay contacts, pulled in above ${m.von} V on the coil, released below ${m.voff} V (one polarity in this model)`);
          if (!models.has("SRELAY_" + id)) { models.add("SRELAY_" + id); lines.push(`.model SNO_${id} SW(VT=${vt} VH=${vh} RON=${m.ron} ROFF=${m.roff})`, `.model SNC_${id} SW(VT=${-vt} VH=${vh} RON=${m.ron} ROFF=${m.roff})`); }
          for (let p = 2, k = 1; p + 2 < nd.length; p += 3, k++) lines.push(`S${id}_${k}NO ${nd[p]} ${nd[p + 2]} ${nd[0]} ${nd[1]} SNO_${id}`, `S${id}_${k}NC ${nd[p]} ${nd[p + 1]} ${nd[1]} ${nd[0]} SNC_${id}`);
          break;
        }
        case "LDR": {
          // no light in SPICE: the cell at the resistance it settled at (dark before a simulation)
          const d = S.sim.result && S.sim.result.dc && (S.sim.result.dc.devices[e.id] || {}).main, r = d && d.r ? +d.r.toPrecision(4) : e.model.rdark;
          lines.push(`* ${id}: vactrol cell, ${d ? "at its simulated resistance" : "dark"} (it follows the LED's light, not modelled here)`, `R${id} ${nd[0]} ${nd[1]} ${r}`);
          break;
        }
        // a sine as SPICE's SIN with its phase (the mains start at the peak); a square or a triangle
        // as the simulator makes it (a triangle, the square clipped from it with 1 % edges), phase too
        case "VSRC": {
          const ph = +e.phase || 0, w = `(2*pi*${e.freq}*time+${+(ph * Math.PI / 180).toPrecision(9)})`, tri = `(2/pi)*asin(sin(${w}))`;
          if (e.wave === "square" || e.wave === "triangle") lines.push(`B${id} ${nd[0]} ${nd[1]} V=${e.offset || 0}+${e.amp}*${e.wave === "square" ? `max(-1,min(1,50*${tri}))` : tri}`);
          // DC: the operating point the engine starts from (SPICE would take the sine's t = 0 value, and a
        // mains source starting at its peak would then drive tens of amps of DC through a primary)
        else lines.push(`V${id} ${nd[0]} ${nd[1]} DC ${e.dcValue !== undefined ? +e.dcValue.toPrecision(6) : e.offset || 0} SIN(${e.offset || 0} ${e.amp} ${e.freq}${ph ? ` 0 0 ${ph}` : ""})`);
          break;
        }
        case "D": lines.push(`D${id} ${nd[0]} ${nd[1]} DMOD_${id}`); lines.push(`.model DMOD_${id} D(Is=${e.is} N=${e.n}${e.tt ? ` TT=${e.tt}` : ""}${e.cj ? ` CJO=${e.cj} M=0` : ""})`); break;
        case "BJT": {
          const m = e.model, mn = `Q${m.pol > 0 ? "N" : "P"}_${(S.comps.find(c => c.id === e.id) || { params: {} }).params.model || id}`.replace(/[^A-Za-z0-9_]/g, "_");
          lines.push(`Q${id} ${nd.join(" ")} ${mn}`);
          // the model's data with SPICE's temperature terms, the part's temperature on the instance. The
          // simulator's kT/q at 25 °C (25.85 mV) is SPICE's at its nominal 27 °C, so the data go out at
          // TNOM=27 and a temperature on that scale (ngspice runs at 27 °C unless told otherwise)
          const m0 = CadLib.BJTS[(S.comps.find(c => c.id === e.id) || { params: {} }).params.model] || m;
          if (m.t !== undefined && Math.abs(m.t - 25) > 1e-9) lines[lines.length - 1] += ` temp=${+((m.t + 273.15) * 300.15 / 298.15 - 273.15).toFixed(2)}`;
          if (!models.has(mn)) { models.add(mn); lines.push(`.model ${mn} ${m.pol > 0 ? "NPN" : "PNP"}(IS=${m0.is} BF=${m0.bf} BR=${m0.br || 1} NF=${m.nf || 1} VAF=${m.vaf} IKF=${m.ikf} EG=${m.ge ? 0.67 : 1.11} XTI=3 XTB=1.5 TNOM=27)`); }
          // germanium leakage, collector to base: ICBO at this temperature, saturating as in the simulator
          if (m.icbo) {
            const [hi, lo] = m.pol > 0 ? [nd[0], nd[1]] : [nd[1], nd[0]], vbc = `V(${lo},${hi})`, vt = +m.vt.toPrecision(5);   // junction voltage, B–C for NPN, C–B for PNP
            lines.push(`B${id}_LK ${hi} ${lo} I=${m.icbo.toExponential(3)}*(${vbc}<0 ? 1-exp(${vbc}/${vt}) : -${vbc}/${vt})`);
          }
          break;
        }
        case "MOS": {
          const m = e.model, pm = (S.comps.find(c => c.id === e.id) || { params: {} }).params.model || id;
          if (m.jf) {
            // a JFET: SPICE's own (its gate junctions inside it); PJF takes VTO with the N-channel sign
            const mn = `J${m.pol > 0 ? "N" : "P"}_${pm}`.replace(/[^A-Za-z0-9_]/g, "_");
            lines.push(`J${id} ${nd[0]} ${nd[1]} ${nd[2]} ${mn}`);
            if (!models.has(mn)) { models.add(mn); lines.push(`.model ${mn} ${m.pol > 0 ? "NJF" : "PJF"}(VTO=${-Math.abs(m.vto)} BETA=${m.jf.beta} LAMBDA=${m.lambda || 0} IS=${m.jf.is})`); }
            break;
          }
          const mn = `M${m.pol > 0 ? "N" : "P"}_${pm}`.replace(/[^A-Za-z0-9_]/g, "_");
          lines.push(`M${id} ${nd[0]} ${nd[1]} ${nd[2]} ${nd[2]} ${mn}`);
          if (!models.has(mn)) { models.add(mn); lines.push(`.model ${mn} ${m.pol > 0 ? "NMOS" : "PMOS"}(LEVEL=1 VTO=${m.vto} KP=${m.kp} LAMBDA=${m.lambda || 0})`); }
          break;
        }
        // a 555 by its pins 1-8 (GND TRIG OUT RESET CV THR DIS VCC): the maker's NE555 macro model goes with it
        case "TIMER555":
          if (!models.has("NE555")) { models.add("NE555"); lines.push("* NE555: include a NE555 subcircuit with pins 1-8 in order (GND TRIG OUT RESET CV THR DIS VCC), e.g. TI's NE555 macro model"); }
          lines.push(`X${id} ${nd.slice(0, 8).join(" ")} NE555`);
          break;
        case "REG": case "SHUNT": {
          const pm = (S.comps.find(c => c.id === e.id) || { params: {} }).params.model || id, name = `${e.kind}_${pm}`.replace(/[^A-Za-z0-9_]/g, "_");
          if (!models.has(name)) { models.add(name); lines.push(...TubeSimEngine.Spice[e.kind === "REG" ? "reg" : "shunt"](e.model, name)); }
          lines.push(`X${id} ${nd.join(" ")} ${name}`);
          break;
        }
        case "OPAMP": {
          const pm = (S.comps.find(c => c.id === e.id) || { params: {} }).params.model || id, name = `OPAMP_${pm}`.replace(/[^A-Za-z0-9_]/g, "_");
          if (!models.has(name)) { models.add(name); lines.push(...TubeSimEngine.Spice.opamp(e.model, name)); }
          lines.push(`X${id} ${nd.join(" ")} ${name}`);
          break;
        }
        case "VDIODE": lines.push(`B${id}${e.part || ""} ${nd[0]} ${nd[1]} I=${e.perveance}*pwr(max(V(${nd[0]},${nd[1]}),0),1.5)`); break;
        case "XFMR": {
          // each winding's leakage on top of its share of the magnetising inductance, so the
          // coupling is below 1 by the leakage; a saturating core goes out linear (its slope at zero)
          const AL = e.lp / Math.pow(e.primaryTurns, 2), names = [], Ls = e.windings.map(w => AL * w.turns * w.turns + (w.leak || 0));
          if (e.sat) lines.push(`* ${id}: core saturation not exported (linear core)`);
          e.windings.forEach((w, j) => { const n = `L${id}_${j}`; names.push(n); lines.push(`${n} ${nn(w.a)} ${nn(w.b)} ${Ls[j]}`); });
          // the coupling pair by pair: ngspice's K takes two inductors only
          names.forEach((a, j) => names.slice(j + 1).forEach((b, k) => {
            const q = j + k + 1, kk = AL * e.windings[j].turns * e.windings[q].turns * e.k / Math.sqrt(Ls[j] * Ls[q]);
            lines.push(`K${id}_${j}_${q} ${a} ${b} ${+Math.min(kk, 0.999999).toPrecision(9)}`);
          }));
          break;
        }
        case "TRIODE": case "PENTODE": {
          if (e.model.spice) {
            // an imported model goes out as it came in; its pins wired by their roles
            const sp = e.model.spice, tri = e.kind === "TRIODE", at = { A: nd[0], G: nd[1], G2: tri ? nd[0] : nd[2], K: nd[tri ? 2 : 3] };
            if (!models.has("spice:" + sp.sub)) { models.add("spice:" + sp.sub); lines.push(`* imported model ${sp.sub}`, ...sp.text.trim().split("\n")); }
            lines.push(`X${id} ${sp.roles.map(r => at[r] !== undefined ? at[r] : at.K).join(" ")} ${sp.sub}`);
          } else if (e.kind === "TRIODE") {
            const m = e.model, p = (S.comps.find(c => c.id === e.id) || {}).params, name = `TRIODE_${(p.tube || p.model).replace(/[^A-Za-z0-9]/g, "_")}`;
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
    });
    const f = signalFreq() || 1000;
    // the print step also as the time step: ngspice refuses a time step of 0 (LTspice takes it)
    const step = (1 / f / 200).toPrecision(3);
    lines.push(`.tran ${step} ${(20 / f).toPrecision(3)} ${(10 / f).toPrecision(3)} ${step}`, ".end");
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
    cmds.menuItems(document.querySelector("#edit-menu .menu-list"), ["undo", "redo", null, "rotate", "mirror", "duplicate", "delete", null, "copy", "paste", "select-all", null, "renumber"]);
    // the version under the name: "?v=3.72.0" is stamped by npm run package, the source says "dev"
    const ver = (VERSION.match(/[?&]v=([^&]+)/) || [])[1];
    if (ver) { document.getElementById("app-version").textContent = ver === "dev" ? "dev" : "v" + ver; document.querySelector(".brand").title = "Tube Amp CAD " + ver; }
    // toolbar menus (File, Edit, View, Windows) and the state of their ticks and switches
    UiKit.menus(document.querySelector("header"));
    bind("btn-new", () => openSheetDialog("new"));
    bind("btn-add-sheet", () => openSheetDialog("add"));
    bindHScroll();
    document.getElementById("sheet-nav").addEventListener("change", e => { const f = S.comps.find(c => c.id === e.target.value); if (f) fitSheet(f); else fitView(); });
    initExport();
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
    bind("btn-share", openShareDialog);
    bind("btn-share-copy", copyShare);
    bind("btn-share-close", () => { document.getElementById("share-modal").hidden = true; });
    document.getElementById("share-board").addEventListener("change", updateShare);
    document.getElementById("share-modal").addEventListener("keydown", e => { if (e.key === "Escape") document.getElementById("share-modal").hidden = true; });
    window.addEventListener("hashchange", openSharedLink);
    // File ▾ → Revisions… (cad-rev-dialog.js), and #rev=<project>.<n> addresses from the project manager
    revisions = window.CadRevDialog ? CadRevDialog({ circuitJSON, openDesign, setStatus, sheetName, isDirty, showDiff, focusDiff, thumbnail, fitStart }) : null;
    if (revisions) {
      revisions.wire();
      bind("btn-revisions", () => revisions.open());
      window.addEventListener("hashchange", () => revisions.openFromLink());
    }
    document.getElementById("save-name").addEventListener("keydown", e => { if (e.key === "Enter") saveDialogOk(); });
    document.getElementById("save-modal").addEventListener("keydown", e => { if (e.key === "Escape") document.getElementById("save-modal").hidden = true; });
    cmds.bind("btn-undo", "undo").bind("btn-redo", "redo");
    bind("btn-tool-select", () => { S.placing = null; setTool("select"); });
    bind("btn-tool-wire", () => { S.placing = null; setTool(S.tool === "wire" ? "select" : "wire"); });
    bind("btn-tool-probe", () => cmds.run("probe"));
    cmds.bind("btn-help", "help").helpRows(document.getElementById("help-keys"));
    bind("btn-help-close", () => { document.getElementById("help-modal").hidden = true; });
    bind("btn-help-manual", () => { document.getElementById("help-modal").hidden = true; ToolWindows.open("help.html"); });
    bind("btn-open-manual", () => ToolWindows.open("help.html"));
    document.getElementById("help-modal").addEventListener("click", e => { if (e.target.id === "help-modal") e.target.hidden = true; });
    bind("btn-zoom-in", () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.25));
    bind("btn-zoom-out", () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 0.8));
    cmds.bind("btn-zoom-fit", "fit");
    cmds.bind("btn-live", "live");
    cmds.bind("btn-insp", "inspector");
    cmds.bind("btn-checks", "checks");
    cmds.bind("btn-tolerance", "tolerance");
    cmds.bind("btn-power", "power");
    cmds.bind("btn-listen", "listen");
    cmds.bind("btn-sweep", "sweep");
    bind("btn-sim", () => { if (S.sim.busy && S.sim.mode === "full") { cancelRun(); setStatus("idle", "Stopped"); } else runSim("full"); });
    cmds.bind("btn-volts", "volts").bind("btn-amps", "amps").bind("btn-legend", "legend").bind("btn-anim", "anim");
    bind("btn-spice", () => { document.getElementById("spice-text").value = spiceNetlist(); document.getElementById("spice-modal").hidden = false; });
    bind("btn-spice-close", () => { document.getElementById("spice-modal").hidden = true; });
    bind("btn-spice-copy", () => { const t = document.getElementById("spice-text"); t.select(); try { navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand("copy"); } });
    bind("btn-spice-download", () => { const blob = new Blob([document.getElementById("spice-text").value], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tube-circuit.cir"; a.click(); });
    tolerance.init();
    power.init();
    listen.init();
    sweep.init();
    initBom();
    ai.init();
    tune.init(ai);
    design.init(ai);
    datasheet.init(ai);
    bind("btn-open-board", showBoard);
    cmds.bind("btn-board-tab", "board-tab");
    cmds.bind("btn-doc-board", "board");
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
    cmds.sync();
    updateInspector();
    updateSheetNav();
    requestAnimationFrame(() => { fitStart(); scheduleSim(0); });
    openSharedLink();
    if (revisions) revisions.openFromLink();
  }

  // Exposed for tests and the other windows
  window.TubeCAD = { circuitIssues, ai, tune, design, datasheet, tolerance, power, listen, sweep, probeAt, probeRead, measurements, anim: () => ({ on: S.anim.on, phase: S.anim.phase, data: animData(), power: S.anim.power }), ledLevel, eyeLevel, setAnim, legend: () => legendBox, state: S, updateInspector, circuitJSON, EXAMPLES, openExample, shareLink, openSharedLink, openDesign, revisions: () => revisions, showDiff, focusDiff, thumbnail, boardNetlist, storeBoard, fitStart, stickerReport, mirrorSelection, renderPNG, openExportDialog, runExport, exportOptions: expOpts, openPrintDialog, runPrint, printPages, printOptions: prnOpts, isLocked, deleteSelection, currentSheet, stepSheet, viewedSheet, pinCurrents, wireCurrents, bomData, exportBom, toggleBom, runOptions: RUN_OPTIONS, newCircuit, addSheet, resistorPower, frames, zoneOf, connRefs, refText, isRail, fitSheet, exportPDF, saveFile, renumber, desig, runTransient, stopTransient, commit, setSwitch, setLive, undo, redo, fitView, buildNetlist, topo: () => topo(), makeComp, compPins, addSegment, lRoute, runSim, spiceNetlist, buildSummary, tubeData, normalizeWires };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
