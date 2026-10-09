/* =============================================================================
   BOARD DESIGN — the editor window. Gets the netlist from the Circuit CAD (which
   also keeps the board document with the circuit), places footprints, routes tracks
   on two copper layers, places vias, texts and mounting holes, measures, shows the
   ratsnest and the design-rule check; Board setup and Design rules dialogs; layers.
   Depends on: windows.js, panels.js, cad-components.js, board-core.js
   ============================================================================= */
(function () {
  "use strict";
  const B = BoardCore, $ = id => document.getElementById(id);
  const VERSION = (() => { const sc = document.currentScript; const q = sc && sc.src.split("?")[1]; return q ? "?" + q : ""; })();
  const LAYER_INFO = [
    ["F.Cu", "Top copper", "#e5534b"], ["B.Cu", "Bottom copper", "#4d8fdc"], ["F.SilkS", "Top silkscreen", "#e6edf3"], ["B.SilkS", "Bottom silkscreen", "#b392f0"],
    ["Edge.Cuts", "Board outline", "#ffd54f"], ["Holes", "Mounting holes", "#9aa7b4"], ["rats", "Ratsnest", "#c9d1d9"], ["drc", "Rule markers", "#ff7b72"]
  ];
  const COLORS = Object.fromEntries(LAYER_INFO.map(([k, , c]) => [k, c]));
  COLORS.pad = "#d4a72c";

  const S = {
    netlist: null, board: B.newBoard(), model: null, conn: null, drc: [], hv: new Set(),
    view: { scale: 5, ox: 40, oy: 40 }, tool: "select", layer: "F.Cu", grid: 1.27, dim: 0.5,
    sel: null,              // { kind: "part", key } | { kind: "track" | "via" | "text" | "hole", i }
    route: null,            // { net, layer, pts: [[x, y]...], w, segs: [] }
    measure: null,          // { a: [x, y], b: [x, y] | null }
    drag: null, hover: null, mouse: [0, 0], space: false,
    history: [], hIndex: -1,
    show: Object.fromEntries(LAYER_INFO.map(([k]) => [k, true])),
    cad: false, saved: true, linked: false, pendingSync: null
  };
  let canvas, ctx, dpr = 1, queued = false;
  const snap = v => Math.round(v / S.grid) * S.grid;
  const toWorld = (sx, sy) => [(sx - S.view.ox) / S.view.scale, (sy - S.view.oy) / S.view.scale];
  const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const kv = (k, v, cls) => `<div class="kv${cls ? " " + cls : ""}"><span>${k}</span><b>${v}</b></div>`;
  const LISTS = { track: "tracks", via: "vias", text: "texts", hole: "holes" };

  // ---------------------------------------------------------------------------
  // Link with the CAD: BOARD_HELLO asks for the netlist and the stored board; the CAD
  // sends BOARD_NETLIST after every schematic change; BOARD_SAVE hands the board back
  // ---------------------------------------------------------------------------
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("tube_cad_v2") : null;
  let saveTimer = 0, helloTimer = 0, reqId = 0;
  const pendingAck = {};
  if (bc) bc.onmessage = e => {
    const m = e.data || {};
    if (m.type === "BOARD_NETLIST") {
      clearTimeout(helloTimer);
      if (m.version !== undefined && m.version !== VERSION) status("bad", `The Circuit CAD runs another version (${(m.version || "?").replace("?v=", "")}): reload both tabs.`);
      S.linked = true;
      if (m.replace) { S.board = B.normaliseBoard(m.board); S.history = []; S.hIndex = -1; S.sel = null; S.route = null; }
      S.netlist = m.netlist;
      // a new board (or one without parts) takes the schematic's parts at once
      let placed = false;
      if (!Object.keys(S.board.parts).length && (m.netlist.parts || []).length) { const r = B.sync(S.board, S.netlist); placed = r.added.length > 0; if (placed) msg(`Placed ${r.added.length} parts below the board: drag them onto it, or Place all on the board`); }
      if (S.hIndex < 0) pushHistory();
      if (placed) save();                     // the first placement goes into the circuit file too
      analyse(); checkSync();
      if (m.replace || placed) fit();
      render(); renderPanels();
      S.cad = true; status("ok", linkText());
    } else if (m.type === "ACK" && pendingAck[m.id]) { clearTimeout(pendingAck[m.id]); delete pendingAck[m.id]; S.saved = true; status("ok", linkText()); }
  };
  function hello() {
    if (!bc) { status("bad", "This browser cannot talk to the Circuit CAD window"); return; }
    bc.postMessage({ type: "BOARD_HELLO" });
    helloTimer = setTimeout(() => { if (!S.linked) status("idle", "No Circuit CAD open: open it (Circuit CAD ↗) to load the circuit's parts"); }, 2000);
  }
  const linkText = () => { const nl = S.netlist || {}, t = nl.docno || nl.title; return `Linked to CAD${t ? " · " + t : ""} · ${S.model ? S.model.parts.length : 0} parts${S.saved ? "" : " · saving…"}`; };
  // the board goes to the CAD, which saves it with the circuit (debounced; the CAD acknowledges)
  function save() {
    S.saved = false;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!bc) return;
      const id = "b" + (++reqId);
      pendingAck[id] = setTimeout(() => { delete pendingAck[id]; status("bad", "Not saved: no Circuit CAD answered. Open it, or export the board file."); }, 2000);
      bc.postMessage({ type: "BOARD_SAVE", id, doc: S.board });
    }, 300);
  }

  // ---------------------------------------------------------------------------
  // Model and checks
  // ---------------------------------------------------------------------------
  function analyse() {
    if (!S.netlist) { S.model = null; S.conn = null; S.drc = []; return; }
    S.hv = B.hvNets(S.netlist.volts, S.board.rules.hvVolts);
    S.model = B.model(S.board, S.netlist);
    S.conn = B.connectivity(S.board, S.model.pads);
    S.drc = B.drc(S.board, S.model, S.conn, S.hv);
  }
  function checkSync() {
    if (!S.netlist) return;
    const parts = B.physicalParts(S.netlist), keys = new Set(parts.map(g => g.key));
    const add = parts.filter(g => !S.board.parts[g.key]).map(g => g.ref), del = Object.keys(S.board.parts).filter(k => !keys.has(k)).map(k => S.board.parts[k].ref);
    S.pendingSync = add.length || del.length ? { add, del } : null;
    $("banner").hidden = !S.pendingSync;
    if (S.pendingSync) $("banner-text").textContent = `The schematic changed: ${add.length ? `${add.length} new part${add.length > 1 ? "s" : ""} (${add.slice(0, 6).join(", ")}${add.length > 6 ? "…" : ""})` : ""}${add.length && del.length ? "; " : ""}${del.length ? `${del.length} removed (${del.slice(0, 6).join(", ")})` : ""}.`;
    $("btn-sync").classList.toggle("warn", !!S.pendingSync);
  }
  function syncNow() {
    if (!S.netlist) return;
    const r = B.sync(S.board, S.netlist);
    commit(`Updated from the schematic: ${r.added.length} added${r.removed.length ? `, ${r.removed.length} removed` : ""}`);
  }
  const netName = n => (n === null || n === undefined ? "no net" : n === "short" ? "SHORT" : (S.model && S.model.names[n]) || String(n));
  const classOf = n => (n === null || n === undefined || n === "short" || !S.model ? "Signal" : B.netClassOf(n, S.model.names, S.hv, S.board.rules));
  const trackWidth = n => B.classRule(classOf(n), S.board.rules).track;

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------
  function pushHistory() {
    S.history = S.history.slice(0, S.hIndex + 1); S.history.push(JSON.stringify(S.board));
    if (S.history.length > 200) S.history.shift();
    S.hIndex = S.history.length - 1;
  }
  function refresh() { analyse(); checkSync(); save(); render(); renderPanels(); }
  function commit(text) { pushHistory(); refresh(); if (text) msg(text); }
  function undo() { if (S.hIndex > 0) { S.hIndex--; S.board = JSON.parse(S.history[S.hIndex]); S.sel = null; refresh(); } }
  function redo() { if (S.hIndex < S.history.length - 1) { S.hIndex++; S.board = JSON.parse(S.history[S.hIndex]); S.sel = null; refresh(); } }

  // ---------------------------------------------------------------------------
  // Hit testing
  // ---------------------------------------------------------------------------
  function partBox(g) {
    const pts = [[g.fp.box[0], g.fp.box[1]], [g.fp.box[2], g.fp.box[1]], [g.fp.box[0], g.fp.box[3]], [g.fp.box[2], g.fp.box[3]]].map(p => B.place(p, g.place));
    return { x1: Math.min(...pts.map(p => p[0])), y1: Math.min(...pts.map(p => p[1])), x2: Math.max(...pts.map(p => p[0])), y2: Math.max(...pts.map(p => p[1])) };
  }
  const hitPad = (x, y) => S.model && S.model.pads.find(p => Math.abs(x - p.x) <= p.w / 2 + 0.2 && Math.abs(y - p.y) <= p.h / 2 + 0.2);
  function hitPart(x, y) {
    if (!S.model) return null;
    for (let i = S.model.parts.length - 1; i >= 0; i--) { const g = S.model.parts[i]; if (!g.place) continue; const b = partBox(g); if (x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) return g; }
    return null;
  }
  function hitTrack(x, y) {
    const tol = 3 / S.view.scale;
    for (let i = S.board.tracks.length - 1; i >= 0; i--) { const t = S.board.tracks[i]; if (!S.show[t.layer]) continue; for (let k = 0; k + 1 < t.pts.length; k++) if (B.segDist(t.pts[k][0], t.pts[k][1], t.pts[k + 1][0], t.pts[k + 1][1], x, y) <= t.w / 2 + tol) return i; }
    return -1;
  }
  const hitVia = (x, y) => S.board.vias.findIndex(v => Math.hypot(v.x - x, v.y - y) <= (v.pad || S.board.rules.viaPad) / 2);
  const hitHole = (x, y) => (S.show.Holes ? S.board.holes.findIndex(h => Math.hypot(h.x - x, h.y - y) <= h.d / 2 + 0.6) : -1);
  function textBox(t) { const w = t.text.length * t.size * 0.62, h = t.size; return (t.rot & 1) ? { x1: t.x - h / 2, y1: t.y - w / 2, x2: t.x + h / 2, y2: t.y + w / 2 } : { x1: t.x - w / 2, y1: t.y - h / 2, x2: t.x + w / 2, y2: t.y + h / 2 }; }
  const hitText = (x, y) => S.board.texts.findIndex(t => { if (!S.show[t.layer]) return false; const b = textBox(t); return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2; });
  // the board's resize handle: its bottom-right corner
  const onHandle = (x, y) => { const o = S.board.outline, t = 6 / S.view.scale; return S.show["Edge.Cuts"] && Math.abs(x - o.w) <= t && Math.abs(y - o.h) <= t; };
  function netAt(x, y) {
    const p = hitPad(x, y); if (p) return { net: p.net, pad: p };
    const ti = hitTrack(x, y); if (ti >= 0 && S.conn) { const it = S.conn.items.find(it => it.kind === "track" && it.ti === ti); if (it && it.net !== null && it.net !== "short") return { net: it.net, track: ti }; }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Routing: from a pad, 45° bends (straight first, then the diagonal), V changes layer with a via
  // ---------------------------------------------------------------------------
  function bend(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], ax = Math.abs(dx), ay = Math.abs(dy);
    if (!ax || !ay || Math.abs(ax - ay) < 1e-6) return [b];
    const d = Math.min(ax, ay);
    return [ax > ay ? [b[0] - Math.sign(dx) * d, a[1]] : [a[0], b[1] - Math.sign(dy) * d], b];
  }
  function routeTarget() { const [x, y] = S.mouse, p = hitPad(x, y); return p ? [p.x, p.y] : [snap(x), snap(y)]; }
  function startRoute(x, y) {
    const at = netAt(x, y);
    if (!at) { msg("Start a track on a pad (or on a routed track)"); return; }
    const start = at.pad ? [at.pad.x, at.pad.y] : [snap(x), snap(y)];
    S.route = { net: at.net, layer: S.layer, w: trackWidth(at.net), pts: [start], segs: [] };
    msg(`Routing ${netName(at.net)} (${classOf(at.net)}, ${S.route.w} mm) on ${S.layer}: click corners, end on a pad of the same net; V: via, Backspace: undo a corner, Esc: stop`);
    render();
  }
  function routeClick() {
    const r = S.route, tgt = routeTarget(), last = r.pts[r.pts.length - 1];
    if (Math.hypot(tgt[0] - last[0], tgt[1] - last[1]) < 1e-6) { finishRoute(); return; }
    bend(last, tgt).forEach(p => r.pts.push(p));
    const p = hitPad(tgt[0], tgt[1]);
    if (p && r.pts.length > 1) {
      if (p.net !== r.net) msg(`${p.ref}-${p.num} is on ${netName(p.net)}, not ${netName(r.net)}: the check will report a short`);
      finishRoute(); return;
    }
    render();
  }
  function routeVia() {
    const r = S.route, last = r.pts[r.pts.length - 1];
    if (r.pts.length > 1) r.segs.push({ layer: r.layer, w: r.w, pts: r.pts.slice() });
    S.board.vias.push({ x: last[0], y: last[1], drill: S.board.rules.viaDrill, pad: S.board.rules.viaPad });
    r.layer = r.layer === "F.Cu" ? "B.Cu" : "F.Cu"; r.pts = [last];
    setLayer(r.layer); analyse(); render();
  }
  function finishRoute() {
    const r = S.route; if (!r) return;
    if (r.pts.length > 1) r.segs.push({ layer: r.layer, w: r.w, pts: r.pts });
    S.route = null;
    if (!r.segs.length) { render(); return; }
    r.segs.forEach(t => S.board.tracks.push({ layer: t.layer, w: +t.w.toFixed(3), pts: t.pts.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]) }));
    commit();
  }

  // ---------------------------------------------------------------------------
  // Tools: select, route, via, text, mounting hole, measure
  // ---------------------------------------------------------------------------
  const TOOL_HELP = { select: "Select: drag parts, vias, texts and holes; drag the board's corner handle to resize it", route: "Route: click a pad to start a track",
    via: "Via: click to place a via", text: "Text: click where the text goes, then type it in the inspector", hole: "Mounting hole: click to place one", measure: "Measure: click two points" };
  function setTool(t) {
    if (S.route && t !== "route") finishRoute();
    if (t !== "measure") S.measure = null;
    S.tool = t;
    document.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
    if (canvas) canvas.style.cursor = t === "select" ? "" : "crosshair";
    msg(TOOL_HELP[t]);
    render();
  }
  function setLayer(l) { S.layer = l; $("layer").value = l; renderLayers(); render(); }
  function placeAt(x, y) {
    const sx = snap(x), sy = snap(y), R = S.board.rules;
    if (S.tool === "via") { S.board.vias.push({ x: sx, y: sy, drill: R.viaDrill, pad: R.viaPad }); S.sel = { kind: "via", i: S.board.vias.length - 1 }; commit("Via placed"); }
    else if (S.tool === "hole") { S.board.holes.push({ x: sx, y: sy, d: 3.2 }); S.sel = { kind: "hole", i: S.board.holes.length - 1 }; commit("Mounting hole placed (Ø 3.2 mm, M3): change it in the inspector"); }
    else if (S.tool === "text") {
      S.board.texts.push({ x: sx, y: sy, text: "TEXT", size: 1.5, layer: S.layer === "B.Cu" ? "B.SilkS" : "F.SilkS", rot: 0 });
      S.sel = { kind: "text", i: S.board.texts.length - 1 }; setTool("select"); commit("Text placed: type it in the inspector");
      const inp = document.querySelector("#inspector input"); if (inp) { inp.focus(); inp.select(); }
    }
  }

  // ---------------------------------------------------------------------------
  // Mouse and keyboard
  // ---------------------------------------------------------------------------
  function evPos(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function onDown(e) {
    canvas.focus();
    const [sx, sy] = evPos(e), [x, y] = toWorld(sx, sy);
    if (e.button === 1 || e.button === 2 || S.space) { S.drag = { kind: "pan", sx, sy, ox: S.view.ox, oy: S.view.oy }; e.preventDefault(); return; }
    if (S.tool === "route") { if (S.route) routeClick(); else startRoute(x, y); return; }
    if (S.tool === "measure") { const p = hitPad(x, y), pt = p ? [p.x, p.y] : [snap(x), snap(y)]; S.measure = !S.measure || S.measure.b ? { a: pt, b: null } : { a: S.measure.a, b: pt }; render(); return; }
    if (S.tool !== "select") { placeAt(x, y); return; }
    if (onHandle(x, y)) { S.drag = { kind: "outline", w0: S.board.outline.w, h0: S.board.outline.h, mx: x, my: y, moved: false }; return; }
    const grab = (kind, i) => { const obj = S.board[LISTS[kind]][i]; S.sel = { kind, i }; S.drag = { kind, i, x0: obj.x, y0: obj.y, mx: x, my: y, moved: false }; renderPanels(); render(); };
    let i;
    if ((i = hitVia(x, y)) >= 0) return grab("via", i);
    if ((i = hitHole(x, y)) >= 0) return grab("hole", i);
    if ((i = hitText(x, y)) >= 0) return grab("text", i);
    const g = hitPart(x, y);
    if (g) { S.sel = { kind: "part", key: g.key }; S.drag = { kind: "part", key: g.key, x0: g.place.x, y0: g.place.y, mx: x, my: y, moved: false }; renderPanels(); render(); return; }
    const ti = hitTrack(x, y); if (ti >= 0) { S.sel = { kind: "track", i: ti }; renderPanels(); render(); return; }
    S.sel = null; renderPanels(); render();
  }
  function onMove(e) {
    if (!canvas) return;
    const [sx, sy] = evPos(e), [x, y] = toWorld(sx, sy);
    S.mouse = [x, y];
    const d = S.drag;
    if (d && d.kind === "pan") { S.view.ox = d.ox + sx - d.sx; S.view.oy = d.oy + sy - d.sy; render(); return; }
    if (d && d.kind === "part") {
      const bp = S.board.parts[d.key], nx = snap(d.x0 + x - d.mx), ny = snap(d.y0 + y - d.my);
      if (nx !== bp.x || ny !== bp.y) { bp.x = nx; bp.y = ny; d.moved = true; analyse(); render(); }
    } else if (d && LISTS[d.kind]) {
      const o = S.board[LISTS[d.kind]][d.i]; o.x = snap(d.x0 + x - d.mx); o.y = snap(d.y0 + y - d.my); d.moved = true; analyse(); render();
    } else if (d && d.kind === "outline") {
      const o = S.board.outline; o.w = Math.max(10, snap(d.w0 + x - d.mx)); o.h = Math.max(10, snap(d.h0 + y - d.my)); d.moved = true; analyse(); render();
    }
    const p = hitPad(x, y);
    S.hover = p ? p.net : null;
    canvas.style.cursor = S.tool === "select" && onHandle(x, y) ? "nwse-resize" : S.tool === "select" ? "" : "crosshair";
    $("st-pos").textContent = `x ${x.toFixed(2)}  y ${y.toFixed(2)} mm` + (p ? ` · ${p.ref}-${p.num}${p.name !== p.num ? " (" + p.name + ")" : ""} · ${p.netName || "no net"} (${classOf(p.net)})` : "");
    if (S.route || p || S.measure || S.tool !== "select") render();
  }
  function onUp() {
    const d = S.drag; S.drag = null;
    if (d && d.kind !== "pan" && d.moved) commit(d.kind === "outline" ? `Board ${S.board.outline.w} × ${S.board.outline.h} mm` : undefined);
  }
  function onWheel(e) {
    e.preventDefault();
    const [sx, sy] = evPos(e), k = Math.exp(-e.deltaY * 0.0015), s = Math.max(0.5, Math.min(80, S.view.scale * k)), f = s / S.view.scale;
    S.view.ox = sx - (sx - S.view.ox) * f; S.view.oy = sy - (sy - S.view.oy) * f; S.view.scale = s;
    render();
  }
  const MODALS = ["help-modal", "rules-modal", "setup-modal"];
  function onKey(e) {
    const tag = (e.target.tagName || "").toUpperCase();
    if (e.key === "F1") { e.preventDefault(); toggle("help-modal"); return; }
    if (e.key === "Escape") { const open = MODALS.find(id => !$(id).hidden); if (open) { $(open).hidden = true; return; } }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (!MODALS.every(id => $(id).hidden)) return;
    const ctrl = e.ctrlKey || e.metaKey, L = /^Key[A-Z]$/.test(e.code || "") ? e.code.slice(3).toLowerCase() : String(e.key).toLowerCase();
    if (e.key === " ") { S.space = true; e.preventDefault(); return; }
    if (e.key === "Escape") { if (S.route) finishRoute(); else if (S.measure) { S.measure = null; render(); } else { S.sel = null; setTool("select"); renderPanels(); } return; }
    if (e.key === "Backspace" && S.route) { e.preventDefault(); if (S.route.pts.length > 1) S.route.pts.pop(); render(); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && S.sel) { e.preventDefault(); deleteSel(); return; }
    if (ctrl && L === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && L === "y") { e.preventDefault(); redo(); return; }
    if (ctrl) return;
    if (L === "x") setTool(S.tool === "route" ? "select" : "route");
    else if (L === "v" && e.shiftKey) setTool("via");
    else if (L === "v") { if (S.route) routeVia(); else setLayer(S.layer === "F.Cu" ? "B.Cu" : "F.Cu"); }
    else if (L === "t") setTool("text");
    else if (L === "h") setTool("hole");
    else if (L === "d") setTool("measure");
    else if (L === "s") setTool("select");
    else if (L === "r") rotateSel();
    else if (L === "m") flipSel();
    else if (L === "f") fit();
    else if (e.key === "?") toggle("help-modal");
  }
  function rotateSel() {
    if (!S.sel) return;
    if (S.sel.kind === "part") { const p = S.board.parts[S.sel.key]; p.rot = ((p.rot || 0) + 1) & 3; commit(); }
    else if (S.sel.kind === "text") { const t = S.board.texts[S.sel.i]; t.rot = ((t.rot || 0) + 1) & 3; commit(); }
  }
  function flipSel() {
    if (!S.sel) return;
    if (S.sel.kind === "part") { const p = S.board.parts[S.sel.key]; p.side = p.side === "B" ? "F" : "B"; commit(`${p.ref} is now on the ${p.side === "B" ? "bottom" : "top"} side`); }
    else if (S.sel.kind === "text") { const t = S.board.texts[S.sel.i]; t.layer = { "F.SilkS": "B.SilkS", "B.SilkS": "F.SilkS", "F.Cu": "B.Cu", "B.Cu": "F.Cu" }[t.layer]; commit(); }
  }
  function deleteSel() {
    const s = S.sel; if (!s) return;
    if (LISTS[s.kind]) { S.board[LISTS[s.kind]].splice(s.i, 1); S.sel = null; commit(); }
    else msg("Parts come from the schematic: delete them there (then Update from schematic)");
  }
  function fit() {
    if (!canvas) return;
    const W = canvas.clientWidth, H = canvas.clientHeight, o = S.board.outline;
    let x1 = 0, y1 = 0, x2 = o.w, y2 = o.h;
    if (S.model) S.model.parts.forEach(g => { if (!g.place) return; const b = partBox(g); x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); });
    const m = 30, s = Math.max(0.5, Math.min(40, Math.min((W - 2 * m) / (x2 - x1 || 1), (H - 2 * m) / (y2 - y1 || 1))));
    S.view = { scale: s, ox: W / 2 - (x1 + x2) / 2 * s, oy: H / 2 - (y1 + y2) / 2 * s };
    render();
  }
  function centerOn(x, y) { const W = canvas.clientWidth, H = canvas.clientHeight; S.view.ox = W / 2 - x * S.view.scale; S.view.oy = H / 2 - y * S.view.scale; render(); }
  const toggle = id => { $(id).hidden = !$(id).hidden; };

  // ---------------------------------------------------------------------------
  // Drawing (millimetres, scaled by the view)
  // ---------------------------------------------------------------------------
  function render() { if (queued) return; queued = true; requestAnimationFrame(draw); }
  function outlinePath(c, o) {
    const r = Math.max(0, Math.min(o.r || 0, o.w / 2, o.h / 2));
    c.beginPath(); c.moveTo(r, 0); c.lineTo(o.w - r, 0); c.arcTo(o.w, 0, o.w, r, r); c.lineTo(o.w, o.h - r); c.arcTo(o.w, o.h, o.w - r, o.h, r);
    c.lineTo(r, o.h); c.arcTo(0, o.h, 0, o.h - r, r); c.lineTo(0, r); c.arcTo(0, 0, r, 0, r); c.closePath();
  }
  function drawText(t, color) {
    ctx.save(); ctx.translate(t.x, t.y);
    if (t.layer.startsWith("B")) ctx.scale(-1, 1);
    ctx.rotate(-(t.rot || 0) * Math.PI / 2);
    ctx.fillStyle = color; ctx.font = `bold ${t.size}px ui-monospace, Menlo, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(t.text, 0, 0); ctx.restore();
  }
  const selColor = (kind, i, c) => (S.sel && S.sel.kind === kind && S.sel.i === i ? "#00e5ff" : c);
  function draw() {
    queued = false;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#070b10"; ctx.fillRect(0, 0, W, H);
    const { scale, ox, oy } = S.view;
    const g = S.grid * Math.max(1, Math.ceil(6 / (S.grid * scale))), [gx1, gy1] = toWorld(0, 0), [gx2, gy2] = toWorld(W, H);
    ctx.fillStyle = "#16202c";
    for (let x = Math.floor(gx1 / g) * g; x <= gx2; x += g) for (let y = Math.floor(gy1 / g) * g; y <= gy2; y += g) ctx.fillRect(x * scale + ox - 0.75, y * scale + oy - 0.75, 1.5, 1.5);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    const px = 1 / scale, o = S.board.outline;
    outlinePath(ctx, o); ctx.fillStyle = "#0c1712"; ctx.fill();
    if (S.show["Edge.Cuts"]) { ctx.strokeStyle = COLORS["Edge.Cuts"]; ctx.lineWidth = Math.max(0.15, 1.2 * px); ctx.stroke(); }
    // copper: the inactive layer dimmed underneath, the active one on top
    const order = S.layer === "F.Cu" ? ["B.Cu", "F.Cu"] : ["F.Cu", "B.Cu"];
    const hl = S.hover !== null && S.hover !== undefined ? S.hover : S.route ? S.route.net : null;
    const netOfTrack = ti => { const it = S.conn && S.conn.items.find(it => it.kind === "track" && it.ti === ti); return it ? it.net : null; };
    order.forEach(layer => {
      if (!S.show[layer]) return;
      ctx.globalAlpha = layer === S.layer ? 0.92 : S.dim;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      S.board.tracks.forEach((t, i) => {
        if (t.layer !== layer) return;
        const sel = S.sel && S.sel.kind === "track" && S.sel.i === i, lit = hl !== null && netOfTrack(i) === hl;
        ctx.strokeStyle = sel ? "#00e5ff" : COLORS[layer]; ctx.lineWidth = t.w;
        ctx.beginPath(); t.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
        if (lit && !sel) { ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = t.w * 0.35; ctx.stroke(); }
      });
      S.board.texts.forEach((t, i) => { if (t.layer === layer) drawText(t, selColor("text", i, COLORS[layer])); });
      ctx.globalAlpha = 1;
    });
    // silkscreen: bottom first (mirrored footprints), then top
    ["B", "F"].forEach(side => {
      const L = side + ".SilkS"; if (!S.show[L]) return;
      S.board.texts.forEach((t, i) => { if (t.layer === L) drawText(t, selColor("text", i, COLORS[L])); });
      if (S.model) S.model.parts.forEach(g => {
        if (!g.place || (g.place.side || "F") !== side) return;
        const sel = S.sel && S.sel.kind === "part" && S.sel.key === g.key;
        ctx.strokeStyle = sel ? "#00e5ff" : COLORS[L]; ctx.lineWidth = Math.max(0.15, px);
        ctx.save(); ctx.translate(g.place.x, g.place.y);
        if (side === "B") ctx.scale(-1, 1);
        ctx.rotate(-(g.place.rot || 0) * Math.PI / 2);
        g.fp.silk.forEach(s => {
          ctx.beginPath();
          if (s.t === "line") { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
          else if (s.t === "rect") ctx.rect(s.x, s.y, s.w, s.h);
          else if (s.t === "circle") ctx.arc(s.x, s.y, s.r, (s.from || 0) * Math.PI / 180, (s.to === undefined ? 360 : s.to) * Math.PI / 180);
          ctx.stroke();
        });
        ctx.restore();
        const b = partBox(g);
        ctx.fillStyle = sel ? "#00e5ff" : COLORS[L]; ctx.font = `bold ${Math.max(1.2, 11 * px)}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText(g.ref, (b.x1 + b.x2) / 2, b.y1 - 0.3);
        if (scale > 6) { ctx.font = `${Math.max(1, 9 * px)}px ui-monospace, monospace`; ctx.fillStyle = "#8b949e"; ctx.textBaseline = "top"; ctx.fillText(g.value, (b.x1 + b.x2) / 2, b.y2 + 0.3); }
        if (sel) { ctx.strokeStyle = "rgba(0,229,255,0.6)"; ctx.setLineDash([4 * px, 3 * px]); ctx.lineWidth = px; ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); ctx.setLineDash([]); }
      });
    });
    // pads (through-hole: on both layers) and vias, when any copper layer is shown
    if (S.model && (S.show["F.Cu"] || S.show["B.Cu"])) {
      S.model.pads.forEach(p => {
        const lit = hl !== null && p.net === hl;
        ctx.fillStyle = p.conflict ? "#ff7b72" : lit ? "#ffe680" : COLORS.pad;
        ctx.beginPath();
        if (p.shape === "rect") ctx.rect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h); else ctx.ellipse(p.x, p.y, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#070b10"; ctx.beginPath(); ctx.arc(p.x, p.y, p.drill / 2, 0, Math.PI * 2); ctx.fill();
        if (scale > 9) { ctx.fillStyle = "#0b0f14"; ctx.font = `${Math.min(p.w, p.h) * 0.42}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(p.name.length <= 3 ? p.name : p.num, p.x, p.y + p.drill * 0.9); }
      });
    }
    if (S.show["F.Cu"] || S.show["B.Cu"]) S.board.vias.forEach((v, i) => {
      ctx.fillStyle = selColor("via", i, "#a9b4c2"); ctx.beginPath(); ctx.arc(v.x, v.y, (v.pad || S.board.rules.viaPad) / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#070b10"; ctx.beginPath(); ctx.arc(v.x, v.y, (v.drill || S.board.rules.viaDrill) / 2, 0, Math.PI * 2); ctx.fill();
    });
    // mounting holes, with their copper clearance dashed
    if (S.show.Holes) S.board.holes.forEach((h, i) => {
      ctx.fillStyle = "#070b10"; ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = selColor("hole", i, COLORS.Holes); ctx.lineWidth = Math.max(0.12, px); ctx.stroke();
      ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2 + S.board.rules.clearance, 0, Math.PI * 2); ctx.setLineDash([2 * px, 2 * px]); ctx.stroke(); ctx.setLineDash([]);
    });
    if (S.show.rats && S.conn) {
      ctx.strokeStyle = "rgba(230,237,243,0.55)"; ctx.lineWidth = Math.max(0.08, 0.8 * px);
      S.conn.rats.forEach(r => { ctx.beginPath(); ctx.moveTo(r.x1, r.y1); ctx.lineTo(r.x2, r.y2); ctx.stroke(); });
    }
    if (S.route) {
      const r = S.route, pts = r.pts.concat(bend(r.pts[r.pts.length - 1], routeTarget()));
      ctx.strokeStyle = COLORS[r.layer]; ctx.globalAlpha = 0.75; ctx.lineWidth = r.w; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.globalAlpha = 1;
      r.segs.forEach(t => { ctx.strokeStyle = COLORS[t.layer]; ctx.lineWidth = t.w; ctx.beginPath(); t.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); });
    }
    // placement ghost for the via / hole / text tools
    if (["via", "hole", "text"].includes(S.tool) && !S.drag) {
      const x = snap(S.mouse[0]), y = snap(S.mouse[1]), R = S.board.rules;
      ctx.globalAlpha = 0.5; ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = Math.max(0.1, px);
      ctx.beginPath(); ctx.arc(x, y, S.tool === "via" ? R.viaPad / 2 : S.tool === "hole" ? 1.6 : 0.6, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (S.measure) {
      const a = S.measure.a, b = S.measure.b || (() => { const p = hitPad(S.mouse[0], S.mouse[1]); return p ? [p.x, p.y] : [snap(S.mouse[0]), snap(S.mouse[1])]; })();
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = Math.max(0.1, 1.2 * px); ctx.setLineDash([4 * px, 3 * px]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
      const dx = b[0] - a[0], dy = b[1] - a[1], txt = `${Math.hypot(dx, dy).toFixed(2)} mm  (Δx ${dx.toFixed(2)}, Δy ${dy.toFixed(2)})`;
      ctx.font = `${12 * px}px ui-monospace, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      const tw = ctx.measureText(txt).width; ctx.fillStyle = "rgba(7,11,16,0.85)"; ctx.fillRect(b[0] + 6 * px, b[1] - 18 * px, tw + 8 * px, 16 * px);
      ctx.fillStyle = "#00e5ff"; ctx.fillText(txt, b[0] + 10 * px, b[1] - 4 * px);
      S.measured = { d: Math.hypot(dx, dy), dx, dy };
      $("st-msg").textContent = "Measure: " + txt;
    }
    if (S.show.drc) S.drc.forEach(d => {
      if (d.kind === "unplaced") return;
      const r = Math.max(0.8, 6 * px);
      ctx.strokeStyle = d.kind === "check" || d.kind === "class" ? "#ffb300" : "#ff7b72"; ctx.lineWidth = Math.max(0.12, 1.5 * px);
      ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(d.x - r * 0.6, d.y - r * 0.6); ctx.lineTo(d.x + r * 0.6, d.y + r * 0.6); ctx.moveTo(d.x + r * 0.6, d.y - r * 0.6); ctx.lineTo(d.x - r * 0.6, d.y + r * 0.6); ctx.stroke();
    });
    // the board's resize handle (select tool)
    if (S.tool === "select" && S.show["Edge.Cuts"]) { const t = 5 * px; ctx.fillStyle = COLORS["Edge.Cuts"]; ctx.fillRect(o.w - t, o.h - t, 2 * t, 2 * t); }
    const c = S.conn, errs = errors();
    $("st-rats").textContent = c ? (c.unrouted ? `${c.unrouted} connection${c.unrouted > 1 ? "s" : ""} to route` : "All connections routed") : "";
    $("st-drc").textContent = S.model ? (errs ? `${errs} rule violation${errs > 1 ? "s" : ""}` : "No rule violations") : "";
    $("st-drc").style.color = errs ? "var(--bad)" : "var(--ok)";
  }
  const NOTE = ["unplaced", "check", "class"];
  const errors = () => S.drc.filter(d => !NOTE.includes(d.kind)).length;

  // ---------------------------------------------------------------------------
  // Panels: parts list, inspector, rule check, layers
  // ---------------------------------------------------------------------------
  function renderPanels() {
    const host = $("parts"), M = S.model;
    if (!M) { host.innerHTML = `<p class="help">The parts arrive from the Circuit CAD.</p>`; $("parts-count").textContent = ""; }
    else {
      const unplaced = new Set(S.drc.filter(d => d.kind === "unplaced").map(d => d.msg.split(" ")[0]));
      const row = g => `<button class="item${S.sel && S.sel.kind === "part" && S.sel.key === g.key ? " active" : ""}" data-key="${esc(g.key)}"><span>${esc(g.ref)}</span><em>${esc(g.fp ? g.fp.name : "")}</em></button>`;
      const on = M.parts.filter(g => !unplaced.has(g.ref)), off = M.parts.filter(g => unplaced.has(g.ref));
      host.innerHTML = (off.length ? `<button class="btn" id="btn-arrange" style="width:100%;margin:2px 0 6px" title="Pack the parts waiting below the board into rows inside the outline: a starting point for your placement">Place all on the board</button><h2>To place <small>${off.length}</small></h2>${off.map(row).join("")}` : "") + `<h2>On the board <small>${on.length}</small></h2>${on.map(row).join("")}`;
      $("parts-count").textContent = `${M.parts.length}`;
      host.querySelectorAll(".item").forEach(b => b.addEventListener("click", () => { const g = M.parts.find(x => x.key === b.dataset.key); S.sel = { kind: "part", key: g.key }; centerOn(g.place.x, g.place.y); renderPanels(); }));
      const ab = $("btn-arrange");
      if (ab) ab.onclick = () => { const left = B.arrange(S.board, M, off.map(g => g.key)); commit(left ? `${left} part${left > 1 ? "s" : ""} did not fit: make the board larger` : `Placed ${off.length} parts in rows on the board`); fit(); };
    }
    renderInspector();
    const dh = $("drc"), list = S.drc.slice().sort((a, b) => NOTE.includes(a.kind) - NOTE.includes(b.kind));
    $("drc-count").textContent = list.length ? String(list.length) : "";
    dh.innerHTML = list.length ? list.slice(0, 200).map((d, i) => `<button class="drc ${d.kind === "class" ? "check" : d.kind}" data-i="${i}">${esc(d.msg)}${d.between ? ` <span class="help">(${esc(d.between.join(" – "))})</span>` : ""}</button>`).join("") : `<p class="help">${M ? "No problems." : ""}</p>`;
    dh.querySelectorAll(".drc").forEach(b => b.addEventListener("click", () => { const d = list[+b.dataset.i]; if (S.view.scale < 8) S.view.scale = 8; centerOn(d.x, d.y); }));
    renderLayers();
  }
  // layers: colour, visibility, active copper layer (click its name), "only" shows that layer alone
  function renderLayers() {
    const lh = $("layers");
    lh.innerHTML = LAYER_INFO.map(([k, t, c]) => `<div class="layer${k === S.layer ? " active" : ""}" data-l="${k}"><input type="checkbox" ${S.show[k] ? "checked" : ""} aria-label="Show ${t}"><span class="sw" style="background:${c}"></span><span class="nm" title="${k.endsWith("Cu") ? "Make it the active layer for new tracks (V)" : t}">${t}</span>${k === S.layer ? `<span class="tag">active</span>` : "<span></span>"}<button class="solo" title="Show only this layer (again: show all)">only</button></div>`).join("");
    lh.querySelectorAll(".layer").forEach(row => {
      const k = row.dataset.l;
      row.querySelector("input").addEventListener("change", e => { S.show[k] = e.target.checked; render(); });
      row.querySelector(".nm").addEventListener("click", () => { if (k.endsWith("Cu")) { S.show[k] = true; setLayer(k); } });
      row.querySelector(".solo").addEventListener("click", () => {
        const only = LAYER_INFO.every(([j]) => S.show[j] === (j === k));
        LAYER_INFO.forEach(([j]) => { S.show[j] = only ? true : j === k; });
        if (!only && k.endsWith("Cu")) S.layer = k;
        $("layer").value = S.layer; renderLayers(); render();
      });
    });
  }
  function field(label, value, onSet, type) {
    const row = document.createElement("div"); row.className = "row";
    row.innerHTML = `<span>${label}</span>`;
    let el;
    if (Array.isArray(type)) { el = document.createElement("select"); type.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; el.appendChild(o); }); el.value = String(value); el.addEventListener("change", () => onSet(el.value)); }
    else { el = document.createElement("input"); el.value = value; el.addEventListener("change", () => { const n = type === "text" ? el.value : parseFloat(String(el.value).replace(",", ".")); if (type !== "text" && !isFinite(n)) { el.classList.add("invalid"); return; } onSet(n); }); el.addEventListener("keydown", e => { if (e.key === "Enter") el.blur(); }); }
    row.appendChild(el); return row;
  }
  const delBtn = () => { const b = document.createElement("button"); b.className = "btn"; b.textContent = "Delete (Del)"; b.onclick = deleteSel; return b; };
  function renderInspector() {
    const h = $("inspector"); h.innerHTML = "";
    const R = S.board.rules, o = S.board.outline, s = S.sel;
    if (s && s.kind === "part" && S.model) {
      const g = S.model.parts.find(x => x.key === s.key); if (!g) { S.sel = null; return renderInspector(); }
      const bp = S.board.parts[g.key];
      h.innerHTML = `<div class="insp-title">${esc(g.ref)} <small class="help">${esc(g.value)}</small></div>`;
      h.appendChild(field("Footprint", bp.fp, v => { bp.fp = v; commit(); }, g.options.map(n => { const f = B.footprint(n); return [n, f ? f.title.replace(/^(.{0,40}).*$/, "$1") + ` (${n})` : n]; })));
      h.appendChild(field("X (mm)", +bp.x.toFixed(3), v => { bp.x = v; commit(); }));
      h.appendChild(field("Y (mm)", +bp.y.toFixed(3), v => { bp.y = v; commit(); }));
      h.appendChild(field("Rotation", bp.rot || 0, v => { bp.rot = +v; commit(); }, [["0", "0°"], ["1", "90°"], ["2", "180°"], ["3", "270°"]]));
      h.appendChild(field("Side", bp.side || "F", v => { bp.side = v; commit(); }, [["F", "Top"], ["B", "Bottom (mirrored)"]]));
      const pinCheck = B.PINOUT[g.members[0].params.model];
      h.insertAdjacentHTML("beforeend", `<p class="help">${esc(g.fp.title)}${B.isOffboard(g) ? " — a chassis-mounted part: wire it to these pads" : ""}.</p>` +
        (pinCheck && pinCheck[1] === "verify" ? `<p class="help warn">Check pinout: makers differ for the ${esc(g.members[0].params.model)}.</p>` : "") +
        `<h2>Pads</h2><div class="pads">${S.model.pads.filter(p => p.part === g.key).map(p => `<div><span>${esc(p.num)}${p.name !== p.num ? " " + esc(p.name) : ""}</span><span>${esc(p.netName || "—")}</span></div>`).join("")}</div>`);
      return;
    }
    if (s && s.kind === "track") {
      const t = S.board.tracks[s.i]; if (!t) { S.sel = null; return renderInspector(); }
      const it = S.conn && S.conn.items.find(x => x.kind === "track" && x.ti === s.i), net = it ? it.net : null;
      let len = 0; for (let k = 0; k + 1 < t.pts.length; k++) len += Math.hypot(t.pts[k + 1][0] - t.pts[k][0], t.pts[k + 1][1] - t.pts[k][1]);
      h.innerHTML = `<div class="insp-title">Track</div>` + kv("Net", esc(net === null ? "not connected" : netName(net)), net === "short" ? "bad" : "") + kv("Class", `${classOf(net)} · ${trackWidth(net)} mm`) + kv("Length", len.toFixed(2) + " mm");
      h.appendChild(field("Layer", t.layer, v => { t.layer = v; commit(); }, [["F.Cu", "Top copper"], ["B.Cu", "Bottom copper"]]));
      h.appendChild(field("Width (mm)", t.w, v => { if (v > 0) { t.w = v; commit(); } }));
      h.appendChild(delBtn()); return;
    }
    if (s && s.kind === "via") {
      const v = S.board.vias[s.i]; if (!v) { S.sel = null; return renderInspector(); }
      h.innerHTML = `<div class="insp-title">Via</div>`;
      h.appendChild(field("X (mm)", v.x, n => { v.x = n; commit(); })); h.appendChild(field("Y (mm)", v.y, n => { v.y = n; commit(); }));
      h.appendChild(field("Drill (mm)", v.drill || R.viaDrill, n => { if (n > 0) { v.drill = n; commit(); } })); h.appendChild(field("Pad (mm)", v.pad || R.viaPad, n => { if (n > 0) { v.pad = n; commit(); } }));
      h.appendChild(delBtn()); return;
    }
    if (s && s.kind === "hole") {
      const hl = S.board.holes[s.i]; if (!hl) { S.sel = null; return renderInspector(); }
      h.innerHTML = `<div class="insp-title">Mounting hole</div>`;
      h.appendChild(field("X (mm)", hl.x, n => { hl.x = n; commit(); })); h.appendChild(field("Y (mm)", hl.y, n => { hl.y = n; commit(); }));
      h.appendChild(field("Diameter (mm)", hl.d, n => { if (n > 0) { hl.d = n; commit(); } }));
      h.insertAdjacentHTML("beforeend", `<p class="help">Not plated. The dashed ring is the copper clearance.</p>`);
      h.appendChild(delBtn()); return;
    }
    if (s && s.kind === "text") {
      const t = S.board.texts[s.i]; if (!t) { S.sel = null; return renderInspector(); }
      h.innerHTML = `<div class="insp-title">Text</div>`;
      h.appendChild(field("Text", t.text, v => { if (v) { t.text = v; commit(); } }, "text"));
      h.appendChild(field("Height (mm)", t.size, v => { if (v > 0.3) { t.size = v; commit(); } }));
      h.appendChild(field("Layer", t.layer, v => { t.layer = v; commit(); }, [["F.SilkS", "Top silkscreen"], ["B.SilkS", "Bottom silkscreen (mirrored)"], ["F.Cu", "Top copper"], ["B.Cu", "Bottom copper (mirrored)"]]));
      h.appendChild(field("Rotation", t.rot || 0, v => { t.rot = +v; commit(); }, [["0", "0°"], ["1", "90°"], ["2", "180°"], ["3", "270°"]]));
      h.appendChild(delBtn()); return;
    }
    const M = S.model, c = S.conn, errs = errors();
    h.innerHTML = `<div class="insp-title">Board</div>` + kv("Size", `${o.w} × ${o.h} mm${o.r ? `, r ${o.r}` : ""}`) +
      kv("Stack", `2 layers · ${S.board.stackup.thickness} mm · ${S.board.stackup.copper} µm`) +
      (M ? kv("Parts", `${M.parts.length - S.drc.filter(d => d.kind === "unplaced").length} placed of ${M.parts.length}`) + kv("Tracks · vias · holes", `${S.board.tracks.length} · ${S.board.vias.length} · ${S.board.holes.length}`) +
        kv("To route", c ? c.unrouted : "—", c && c.unrouted ? "" : "ok") + kv("Rule violations", errs, errs ? "bad" : "ok") : "") +
      `<h2>Rules in force</h2>` + kv("Clearance · HV", `${R.clearance} · ${R.hvClearance} mm`) + kv("Tracks: signal · power", `${R.track} · ${R.power} mm`) + kv(`High-voltage nets (> ${R.hvVolts} V)`, S.hv.size);
    const wrap = document.createElement("div"); wrap.style.cssText = "display:flex;gap:6px;margin-top:8px";
    const b1 = document.createElement("button"); b1.className = "btn"; b1.textContent = "Board setup…"; b1.onclick = openSetup;
    const b2 = document.createElement("button"); b2.className = "btn"; b2.textContent = "Design rules…"; b2.onclick = openRules;
    wrap.appendChild(b1); wrap.appendChild(b2); h.appendChild(wrap);
  }

  // ---------------------------------------------------------------------------
  // Design rules window: rules, checks, net classes; edited on a copy, Apply commits
  // ---------------------------------------------------------------------------
  let draft = null;
  const CHECK_NAMES = { clearance: "Clearance", short: "Shorts", edge: "Board edge", unplaced: "Parts not placed", annular: "Annular rings", drill: "Minimum drill", width: "Minimum track width", class: "Track width of the net class", pinout: "Pinouts to check" };
  function openRules() {
    draft = JSON.parse(JSON.stringify(S.board.rules));
    document.querySelectorAll("#rules-modal [data-r]").forEach(el => { el.value = draft[el.dataset.r]; el.classList.remove("invalid"); });
    $("rules-checks").innerHTML = Object.keys(CHECK_NAMES).map(k => `<label><input type="checkbox" data-c="${k}" ${draft.checks[k] !== false ? "checked" : ""}> ${CHECK_NAMES[k]}</label>`).join("");
    rulesNets();
    $("rules-modal").hidden = false;
  }
  function readRules() {
    let ok = true;
    document.querySelectorAll("#rules-modal [data-r]").forEach(el => { const v = parseFloat(String(el.value).replace(",", ".")); if (!(v > 0)) { el.classList.add("invalid"); ok = false; } else { el.classList.remove("invalid"); draft[el.dataset.r] = v; } });
    document.querySelectorAll("#rules-checks [data-c]").forEach(el => { draft.checks[el.dataset.c] = el.checked; });
    return ok;
  }
  function rulesNets() {
    const tb = $("rules-nets");
    if (!S.model) { tb.innerHTML = `<tr><td colspan="6">The nets arrive from the Circuit CAD.</td></tr>`; return; }
    readRules();
    const hv = B.hvNets(S.netlist.volts, draft.hvVolts), rows = B.netTable({ ...S.board, rules: draft }, S.model, hv, S.netlist.volts);
    tb.innerHTML = rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.pads}</td><td>${r.volts === null ? "—" : r.volts.toFixed(Math.abs(r.volts) >= 100 ? 0 : 1) + " V"}</td>
      <td><select data-net="${esc(r.name)}"><option value="">Auto (${esc(B.netClassOf(r.net, S.model.names, hv, { ...draft, netClass: {} }))})</option>${B.CLASSES.map(c => `<option value="${c}" ${r.manual && r.cls === c ? "selected" : ""}>${c}</option>`).join("")}</select></td>
      <td class="cls-${r.cls}">${r.track}</td><td class="cls-${r.cls}">${r.clearance}</td></tr>`).join("");
    tb.querySelectorAll("select").forEach(sel => sel.addEventListener("change", () => { if (sel.value) draft.netClass[sel.dataset.net] = sel.value; else delete draft.netClass[sel.dataset.net]; rulesNets(); }));
  }
  function applyRules() { if (!readRules()) return; S.board.rules = draft; $("rules-modal").hidden = true; commit("Design rules applied"); }

  // ---------------------------------------------------------------------------
  // Board setup window: outline, corners, mounting holes, layer stack
  // ---------------------------------------------------------------------------
  let setupHoles = null;
  function openSetup() {
    const o = S.board.outline;
    document.querySelectorAll("#setup-modal [data-o]").forEach(el => { el.value = o[el.dataset.o] || 0; el.classList.remove("invalid"); });
    document.querySelectorAll("#setup-modal [data-s]").forEach(el => { el.value = String(S.board.stackup[el.dataset.s]); });
    setupHoles = S.board.holes.slice(); holesNow();
    $("setup-modal").hidden = false;
  }
  const holesNow = () => { $("holes-now").textContent = setupHoles.length ? `${setupHoles.length} mounting hole${setupHoles.length > 1 ? "s" : ""}: ${setupHoles.map(h => `Ø${h.d} at ${h.x.toFixed(1)}, ${h.y.toFixed(1)}`).slice(0, 4).join("; ")}` : "No mounting holes."; };
  function readOutline() {
    const o = {}; let ok = true;
    document.querySelectorAll("#setup-modal [data-o]").forEach(el => { const v = parseFloat(String(el.value).replace(",", ".")); const min = el.dataset.o === "r" ? 0 : 10; if (!(v >= min)) { el.classList.add("invalid"); ok = false; } else o[el.dataset.o] = v; });
    return ok ? o : null;
  }
  function applySetup() {
    const o = readOutline(); if (!o) return;
    S.board.outline = { ...S.board.outline, ...o, r: Math.min(o.r, o.w / 2, o.h / 2) };
    document.querySelectorAll("#setup-modal [data-s]").forEach(el => { S.board.stackup[el.dataset.s] = +el.value; });
    S.board.holes = setupHoles;
    $("setup-modal").hidden = true; commit(`Board ${S.board.outline.w} × ${S.board.outline.h} mm`); fit();
  }

  // ---------------------------------------------------------------------------
  // Exports: SVG drawings at 1:1 mm, the board file
  // ---------------------------------------------------------------------------
  function svgDoc(layers, mirror) {
    const o = S.board.outline, M = S.model, parts = [], color = layers.length > 1, r = Math.min(o.r || 0, o.w / 2, o.h / 2);
    const tr = mirror ? ` transform="translate(${o.w} 0) scale(-1 1)"` : "";
    parts.push(`<rect x="0" y="0" width="${o.w}" height="${o.h}" rx="${r}" fill="${color ? "#0c1712" : "white"}" stroke="${color ? COLORS["Edge.Cuts"] : "black"}" stroke-width="0.15"/>`);
    const ink = l => (color ? COLORS[l] : "black");
    ["B.Cu", "F.Cu"].filter(l => layers.includes(l)).forEach(l => {
      S.board.tracks.filter(t => t.layer === l).forEach(t => parts.push(`<polyline points="${t.pts.map(p => p.join(",")).join(" ")}" fill="none" stroke="${ink(l)}" stroke-width="${t.w}" stroke-linecap="round" stroke-linejoin="round"/>`));
      S.board.texts.filter(t => t.layer === l).forEach(t => parts.push(svgText(t, ink(l))));
    });
    if (layers.some(l => l.endsWith("Cu")) && M) {
      M.pads.forEach(p => parts.push(p.shape === "rect" ? `<rect x="${p.x - p.w / 2}" y="${p.y - p.h / 2}" width="${p.w}" height="${p.h}" fill="${color ? COLORS.pad : "black"}"/>` : `<ellipse cx="${p.x}" cy="${p.y}" rx="${p.w / 2}" ry="${p.h / 2}" fill="${color ? COLORS.pad : "black"}"/>`, `<circle cx="${p.x}" cy="${p.y}" r="${p.drill / 2}" fill="${color ? "#070b10" : "white"}"/>`));
      S.board.vias.forEach(v => parts.push(`<circle cx="${v.x}" cy="${v.y}" r="${(v.pad || S.board.rules.viaPad) / 2}" fill="${color ? "#a9b4c2" : "black"}"/><circle cx="${v.x}" cy="${v.y}" r="${(v.drill || S.board.rules.viaDrill) / 2}" fill="${color ? "#070b10" : "white"}"/>`));
    }
    S.board.holes.forEach(h => parts.push(`<circle cx="${h.x}" cy="${h.y}" r="${h.d / 2}" fill="${color ? "#070b10" : "white"}" stroke="${color ? COLORS.Holes : "black"}" stroke-width="0.1"/>`));
    if (layers.includes("F.SilkS") && M) {
      M.parts.forEach(g => { if (!g.place || g.place.side === "B") return; const b = partBox(g); parts.push(`<text x="${(b.x1 + b.x2) / 2}" y="${b.y1 - 0.3}" font-family="monospace" font-size="1.6" text-anchor="middle" fill="${COLORS["F.SilkS"]}">${esc(g.ref)}</text>`); });
      S.board.texts.filter(t => t.layer === "F.SilkS").forEach(t => parts.push(svgText(t, COLORS["F.SilkS"])));
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${o.w}mm" height="${o.h}mm" viewBox="0 0 ${o.w} ${o.h}"><g${tr}>${parts.join("")}</g></svg>\n`;
  }
  const svgText = (t, fill) => `<text x="0" y="0" transform="translate(${t.x} ${t.y})${t.layer.startsWith("B") ? " scale(-1 1)" : ""} rotate(${-(t.rot || 0) * 90})" font-family="monospace" font-weight="bold" font-size="${t.size}" text-anchor="middle" dominant-baseline="middle" fill="${fill}">${esc(t.text)}</text>`;
  function download(text, name, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); msg("Saved " + name); }
  const baseName = () => ((S.netlist && (S.netlist.docno || S.netlist.title)) || "board").replace(/[^\w.\- ]+/g, "").trim().replace(/\s+/g, "-") || "board";

  // ---------------------------------------------------------------------------
  // Status and boot
  // ---------------------------------------------------------------------------
  function status(kind, text) { const el = $("status"); el.className = "status " + kind; el.textContent = text; }
  function msg(t) { if (t) $("st-msg").textContent = t; }
  function init() {
    canvas = $("pcb"); ctx = canvas.getContext("2d"); dpr = window.devicePixelRatio || 1; canvas.tabIndex = 0;
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    canvas.addEventListener("dblclick", () => { if (S.route) finishRoute(); });
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    window.addEventListener("keydown", onKey); window.addEventListener("keyup", e => { if (e.key === " ") S.space = false; });
    window.addEventListener("resize", render);
    Panels.columns(document.querySelector("main"), { key: "board", minViewport: 1000, minCenter: 360,
      cols: [{ index: 0, side: "left", def: 220, min: 160, max: 480 }, { index: 2, side: "right", def: 300, min: 220, max: 640 }], template: w => `${w[0]}px 1fr ${w[1]}px` });
    document.querySelectorAll("[data-tool]").forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
    $("layer").onchange = e => setLayer(e.target.value);
    $("grid").onchange = e => { S.grid = +e.target.value; render(); };
    $("dim").oninput = e => { S.dim = +e.target.value; render(); };
    $("btn-fit").onclick = fit; $("btn-undo").onclick = undo; $("btn-redo").onclick = redo;
    $("btn-sync").onclick = syncNow; $("banner-sync").onclick = syncNow;
    $("btn-setup").onclick = openSetup; $("btn-rules").onclick = openRules;
    $("rules-apply").onclick = applyRules; $("rules-cancel").onclick = () => { $("rules-modal").hidden = true; };
    $("rules-reset").onclick = () => { const nc = draft.netClass; draft = { ...B.defaultRules(), netClass: nc }; document.querySelectorAll("#rules-modal [data-r]").forEach(el => { el.value = draft[el.dataset.r]; }); document.querySelectorAll("#rules-checks [data-c]").forEach(el => { el.checked = true; }); rulesNets(); };
    document.querySelectorAll("#rules-modal [data-r]").forEach(el => el.addEventListener("change", rulesNets));
    $("setup-apply").onclick = applySetup; $("setup-cancel").onclick = () => { $("setup-modal").hidden = true; };
    $("holes-corners").onclick = () => { const o = readOutline() || S.board.outline, d = +$("hole-d").value, inset = parseFloat($("hole-inset").value) || 5; setupHoles = B.cornerHoles(o, d, inset); holesNow(); };
    $("holes-clear").onclick = () => { setupHoles = []; holesNow(); };
    $("btn-cad").onclick = () => ToolWindows.open("circuit_sandbox.html");
    $("btn-help").onclick = () => { $("help-modal").hidden = false; }; $("btn-help-close").onclick = () => { $("help-modal").hidden = true; };
    const menu = $("export-menu"), list = menu.querySelector(".menu-list");
    $("btn-export").onclick = e => { e.stopPropagation(); list.hidden = !list.hidden; };
    document.addEventListener("click", e => { if (!menu.contains(e.target)) list.hidden = true; });
    $("ex-svg").onclick = () => { list.hidden = true; download(svgDoc(["F.Cu", "B.Cu", "F.SilkS", "Edge.Cuts"], false), baseName() + "-board.svg", "image/svg+xml"); };
    $("ex-fcu").onclick = () => { list.hidden = true; download(svgDoc(["F.Cu"], false), baseName() + "-F_Cu.svg", "image/svg+xml"); };
    $("ex-bcu").onclick = () => { list.hidden = true; download(svgDoc(["B.Cu"], true), baseName() + "-B_Cu-mirrored.svg", "image/svg+xml"); };
    $("ex-json").onclick = () => { list.hidden = true; download(JSON.stringify(S.board, null, 1), baseName() + "-board.json", "application/json"); };
    renderPanels(); fit(); hello();
  }
  window.BoardApp = { state: S, analyse, commit, syncNow, fit, setTool, setLayer, undo, redo, svgDoc, openRules, openSetup, toWorld, toScreen: (x, y) => [x * S.view.scale + S.view.ox, y * S.view.scale + S.view.oy] };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
