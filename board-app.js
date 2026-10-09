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
    ["F.Cu", "Top copper", "#e5534b"], ["B.Cu", "Bottom copper", "#4d8fdc"], ["zones", "Copper pours", "#8b949e"], ["F.SilkS", "Top silkscreen", "#e6edf3"], ["B.SilkS", "Bottom silkscreen", "#b392f0"],
    ["Edge.Cuts", "Board outline", "#ffd54f"], ["keepouts", "Keep-out areas", "#ff9e3d"], ["Holes", "Mounting holes", "#9aa7b4"], ["rats", "Ratsnest", "#c9d1d9"], ["drc", "Rule markers", "#ff7b72"]
  ];
  const COLORS = Object.fromEntries(LAYER_INFO.map(([k, , c]) => [k, c]));
  COLORS.pad = "#d4a72c";

  const S = {
    netlist: null, board: B.newBoard(), model: null, conn: null, drc: [], hv: new Set(),
    view: { scale: 5, ox: 40, oy: 40 }, tool: "select", layer: "F.Cu", grid: 1.27, dim: 0.5,
    sel: null,              // { kind: "part", key } | { kind: "track" | "via" | "text" | "hole" | "zone" | "keepout", i } | { kind: "multi", parts, tracks, vias, texts, holes }
    fills: [],              // filled copper pours (BoardCore.fillZones), refilled on every change
    netHL: null,            // the highlighted net (Nets tab, ` key)
    poly: null,             // a pour outline being drawn: [[x, y]...]
    routeBad: null,         // while routing: where the next segment breaks the clearance
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
  const LISTS = { track: "tracks", via: "vias", text: "texts", hole: "holes", zone: "zones" };
  const appVersion = () => VERSION.replace(/^\?v=/, "") || "dev";

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
    } else if (m.type === "CAD_SELECT" && S.model) {
      // the schematic's selection: select the same part here (without echoing it back)
      const ids = new Set(m.ids || []), g = S.model.parts.find(p => p.members.some(x => ids.has(x.id)));
      if (g) { S.sel = { kind: "part", key: g.key }; if (g.place) ensureVisible(g.place.x, g.place.y); renderPanels(); render(); }
      else if (S.sel && S.sel.kind === "part") { S.sel = null; renderPanels(); render(); }
    } else if (m.type === "ACK" && pendingAck[m.id]) { clearTimeout(pendingAck[m.id]); delete pendingAck[m.id]; S.saved = true; status("ok", linkText()); }
  };
  // cross-probing: a part selected here is selected in the schematic too
  function probe(g) { if (bc && g) bc.postMessage({ type: "BOARD_SELECT", ids: g.members.map(m => m.id) }); }
  function selectPart(g) { S.sel = { kind: "part", key: g.key }; probe(g); }
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
  // light: while dragging, keep the pours as they were filled (they refill when the drag ends)
  function analyse(light) {
    if (!S.netlist) { S.model = null; S.conn = null; S.drc = []; S.fills = []; return; }
    S.hv = B.hvNets(S.netlist.volts, S.board.rules.hvVolts);
    S.model = B.model(S.board, S.netlist);
    const c0 = B.connectivity(S.board, S.model.pads);
    if (!(S.board.zones || []).length) S.fills = [];
    else if (!light) S.fills = B.fillZones(S.board, S.model, c0, S.hv);
    S.conn = S.fills.length ? B.connectivity(S.board, S.model.pads, S.fills) : c0;
    S.amps = B.netCurrents(S.netlist);
    S.drc = B.drc(S.board, S.model, S.conn, S.hv, S.fills, S.netlist);
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
  const storedNet = n => (n === null || n === undefined || n === "short" ? undefined : netName(n));
  const netOfTrack = ti => { const it = S.conn && S.conn.items.find(it => it.kind === "track" && it.ti === ti); return it ? it.net : null; };
  // a track's points without repeats and without corners that are not corners
  function tidy(pts) {
    const out = [];
    pts.forEach(p => { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push([+p[0].toFixed(4), +p[1].toFixed(4)]); });
    for (let k = out.length - 2; k >= 1; k--) { const [a, b, c] = [out[k - 1], out[k], out[k + 1]]; if (Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) < 1e-6 && (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) > 0) out.splice(k, 1); }
    return out;
  }

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
  function hitSeg(x, y, tolPx) {
    const tol = (tolPx === undefined ? 3 : tolPx) / S.view.scale;
    for (let i = S.board.tracks.length - 1; i >= 0; i--) { const t = S.board.tracks[i]; if (!S.show[t.layer]) continue; for (let k = 0; k + 1 < t.pts.length; k++) if (B.segDist(t.pts[k][0], t.pts[k][1], t.pts[k + 1][0], t.pts[k + 1][1], x, y) <= t.w / 2 + tol) return { i, k }; }
    return null;
  }
  const hitTrack = (x, y) => { const h = hitSeg(x, y); return h ? h.i : -1; };
  // pours and keep-outs (areas) are picked by their outline (inside, the copper and parts under them
  // stay selectable); the selected one's corners are handles
  const AREAS = { zone: "zones", keepout: "keepouts" };
  const areaPoly = (kind, a) => (kind === "zone" ? B.zonePoly(S.board, a) : a.pts);
  const areaShown = (kind, a) => (kind === "zone" ? S.show.zones && S.show[a.layer] : S.show.keepouts && B.koLayers(a).some(l => S.show[l]));
  function hitAreaCorner(x, y) {
    if (!S.sel || !AREAS[S.sel.kind]) return -1;
    const a = S.board[AREAS[S.sel.kind]][S.sel.i]; if (!a || !a.pts) return -1;
    return a.pts.findIndex(p => Math.hypot(p[0] - x, p[1] - y) <= 6 / S.view.scale);
  }
  function hitArea(x, y) {
    const tol = 5 / S.view.scale;
    for (const kind of ["keepout", "zone"]) {
      const list = S.board[AREAS[kind]] || [];
      for (let i = list.length - 1; i >= 0; i--) {
        if (!areaShown(kind, list[i])) continue;
        const P = areaPoly(kind, list[i]);
        for (let k = 0, j = P.length - 1; k < P.length; j = k++) if (B.segDist(P[j][0], P[j][1], P[k][0], P[k][1], x, y) <= tol) return { kind, i };
      }
    }
    return null;
  }
  const hitVia = (x, y) => S.board.vias.findIndex(v => Math.hypot(v.x - x, v.y - y) <= (v.pad || S.board.rules.viaPad) / 2);
  const hitHole = (x, y) => (S.show.Holes ? S.board.holes.findIndex(h => Math.hypot(h.x - x, h.y - y) <= h.d / 2 + 0.6) : -1);
  function textBox(t) { const w = Math.max(t.size, B.strokeText(t.text, 0, 0, t.size).width), h = t.size; return (t.rot & 1) ? { x1: t.x - h / 2, y1: t.y - w / 2, x2: t.x + h / 2, y2: t.y + w / 2 } : { x1: t.x - w / 2, y1: t.y - h / 2, x2: t.x + w / 2, y2: t.y + h / 2 }; }
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
  // the clearance of the segments to the pointer against other nets' copper, holes and the edge
  function routeCheck() {
    const r = S.route; if (!r || !S.conn) return null;
    const pts = [r.pts[r.pts.length - 1]].concat(bend(r.pts[r.pts.length - 1], routeTarget())), R = S.board.rules, mine = B.classRule(classOf(r.net), R).clearance, w2 = r.w / 2;
    for (let k = 0; k + 1 < pts.length; k++) {
      const s = [pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]];
      for (const it of S.conn.items) {
        if (!it.layers.includes(r.layer) || (it.net === r.net && r.net !== null)) continue;
        let need = Math.max(mine, B.classRule(classOf(it.net), R).clearance); const g = B.segSeg(s, it.s) - w2 - it.r;
        if (g < need - 1e-6 && it.kind === "pad") { const eg = B.entryGap(s, it, S.conn.items); if (eg !== null) need = Math.min(need, eg - 0.02); }
        if (g < need - 1e-6) { const [x, y] = it.kind === "pad" ? [it.pad.x, it.pad.y] : [(it.s[0] + it.s[2]) / 2, (it.s[1] + it.s[3]) / 2]; return { x, y, g, need, what: it.kind === "pad" ? `${it.pad.ref}-${it.pad.num}` : it.kind === "via" ? "a via" : "a track", net: netName(it.net) }; }
      }
      for (const ko of S.board.keepouts) if (ko.tracks !== false && B.koLayers(ko).includes(r.layer) && B.segInPoly(s, ko.pts, w2)) return { x: s[2], y: s[3], g: 0, need: 0, what: ko.name ? `keep-out "${ko.name}"` : "a keep-out area", net: "", ko: true };
      for (const h of S.board.holes) { const g = B.segDist(s[0], s[1], s[2], s[3], h.x, h.y) - w2 - h.d / 2; if (g < mine - 1e-6) return { x: h.x, y: h.y, g, need: mine, what: "a mounting hole", net: "" }; }
    }
    return null;
  }
  function routeTarget() { const [x, y] = S.mouse, p = hitPad(x, y); return p ? [p.x, p.y] : [snap(x), snap(y)]; }
  function startRoute(x, y) {
    const at = netAt(x, y);
    if (!at) { msg("Start a track on a pad (or on a routed track)"); return; }
    const start = at.pad ? [at.pad.x, at.pad.y] : [snap(x), snap(y)];
    // the class width, or wider when the net's DC current asks for it (IPC-2221)
    const I = (S.amps || {})[at.net], wI = Math.ceil(B.currentWidth(I, S.board.rules, S.board.stackup) * 20) / 20;
    S.route = { net: at.net, layer: S.layer, w: Math.max(trackWidth(at.net), wI), pts: [start], segs: [] };
    msg(`Routing ${netName(at.net)} (${classOf(at.net)}${I ? `, ${B.fmtA(I)}` : ""}, ${S.route.w} mm) on ${S.layer}: click corners, end on a pad of the same net; V: via, Backspace: undo a corner, Esc: stop`);
    render();
  }
  function routeClick(e) {
    const r = S.route, tgt = routeTarget(), last = r.pts[r.pts.length - 1], bad = routeCheck();
    if (bad && bad.ko && !(e && e.shiftKey)) { msg(`Not through ${bad.what}: route around it, or Shift+click to place it anyway`); return; }
    if (bad && !(e && e.shiftKey)) { msg(`Too close to ${bad.what}${bad.net ? " on " + bad.net : ""}: ${Math.max(0, bad.g).toFixed(2)} mm < ${bad.need} mm. Choose another way, or Shift+click to place it anyway`); return; }
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
    S.board.vias.push({ x: last[0], y: last[1], drill: S.board.rules.viaDrill, pad: S.board.rules.viaPad, net: storedNet(r.net) });
    r.layer = r.layer === "F.Cu" ? "B.Cu" : "F.Cu"; r.pts = [last];
    setLayer(r.layer); analyse(); render();
  }
  function finishRoute() {
    const r = S.route; if (!r) return;
    if (r.pts.length > 1) r.segs.push({ layer: r.layer, w: r.w, pts: r.pts });
    S.route = null;
    if (!r.segs.length) { render(); return; }
    r.segs.forEach(t => { const pts = tidy(t.pts); if (pts.length > 1) S.board.tracks.push({ layer: t.layer, w: +t.w.toFixed(3), pts, net: storedNet(r.net) }); });
    commit();
  }

  // ---------------------------------------------------------------------------
  // Tools: select, route, via, text, mounting hole, measure
  // ---------------------------------------------------------------------------
  const TOOL_HELP = { select: "Select: drag parts, vias, texts and holes; drag the board's corner handle to resize it", route: "Route: click a pad to start a track",
    via: "Via: click to place a via", text: "Text: click where the text goes, then type it in the inspector", hole: "Mounting hole: click to place one", measure: "Measure: click two points",
    pour: "Copper pour: click the corners on the active layer, double-click (or click the first corner) to close; Backspace: take back a corner",
    keepout: "Keep-out area: click the corners, double-click to close; no tracks, vias or pour may enter it (set in the inspector)" };
  function setTool(t) {
    if (S.route && t !== "route") finishRoute();
    if (t !== "measure") S.measure = null;
    if (t !== S.tool || (t !== "pour" && t !== "keepout")) S.poly = null;
    S.tool = t;
    document.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
    if (canvas) canvas.style.cursor = t === "select" ? "" : "crosshair";
    msg(TOOL_HELP[t]);
    render();
  }
  function setLayer(l) { S.layer = l; $("layer").value = l; renderLayers(); render(); }
  function placeAt(x, y) {
    const sx = snap(x), sy = snap(y), R = S.board.rules;
    if (S.tool === "via") {
      // a via dropped in a pour takes its net (a stitching via)
      if (S.board.keepouts.some(k => k.vias !== false && B.pip(sx, sy, k.pts))) { msg("Not here: a keep-out area forbids vias"); return; }
      const zi = S.board.zones.findIndex(z => B.pip(sx, sy, B.zonePoly(S.board, z)));
      S.board.vias.push({ x: sx, y: sy, drill: R.viaDrill, pad: R.viaPad, net: zi >= 0 ? S.board.zones[zi].net : undefined }); S.sel = { kind: "via", i: S.board.vias.length - 1 }; commit("Via placed"); }
    else if (S.tool === "hole") { S.board.holes.push({ x: sx, y: sy, d: 3.2 }); S.sel = { kind: "hole", i: S.board.holes.length - 1 }; commit("Mounting hole placed (Ø 3.2 mm, M3): change it in the inspector"); }
    else if (S.tool === "text") {
      S.board.texts.push({ x: sx, y: sy, text: "TEXT", size: 1.5, layer: S.layer === "B.Cu" ? "B.SilkS" : "F.SilkS", rot: 0 });
      S.sel = { kind: "text", i: S.board.texts.length - 1 }; setTool("select"); commit("Text placed: type it in the inspector");
      const inp = document.querySelector("#inspector input"); if (inp) { inp.focus(); inp.select(); }
    }
  }

  const defaultNet = () => { const names = S.model ? [...new Set(S.model.pads.filter(p => p.net !== null).map(p => p.netName))] : []; return names.includes("GND") ? "GND" : names.sort()[0] || "GND"; };
  function closePoly() {
    const pts = tidy((S.poly || []).concat([S.poly[0]])).slice(0, -1);
    S.poly = null;
    if (pts.length < 3) { msg("An area needs at least three corners"); render(); return; }
    if (S.tool === "keepout") {
      S.board.keepouts.push({ name: "", pts, layers: ["F.Cu", "B.Cu"], tracks: true, vias: true, pour: true, parts: false });
      S.sel = { kind: "keepout", i: S.board.keepouts.length - 1 }; setTool("select");
      commit("Keep-out area: no tracks, vias or pour on either layer (the inspector sets what it forbids)"); return;
    }
    S.board.zones.push({ net: defaultNet(), layer: S.layer, pts, thermal: true, gap: 0.5, spoke: 0.8 });
    S.sel = { kind: "zone", i: S.board.zones.length - 1 }; setTool("select");
    commit(`Copper pour on ${S.layer}, net ${defaultNet()}: change its net in the inspector`);
  }
  function groundPlane(layer) {
    S.board.zones.push({ net: defaultNet(), layer: layer || "B.Cu", pts: null, thermal: true, gap: 0.5, spoke: 0.8 });
    S.sel = { kind: "zone", i: S.board.zones.length - 1 };
    commit(`${defaultNet()} pour over the whole ${layer === "F.Cu" ? "top" : "bottom"} layer`);
  }
  // drag a track segment sideways: its neighbours keep their direction (45° stays 45°), a
  // segment at a track's end gets a jog
  function inter(p1, p2, p3, p4) {
    const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]); if (Math.abs(d) < 1e-9) return null;
    const a = p1[0] * p2[1] - p1[1] * p2[0], b = p3[0] * p4[1] - p3[1] * p4[0];
    return [(a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d];
  }
  function dragSeg(P, k, dx, dy) {
    const a = P[k], b = P[k + 1], ux = b[0] - a[0], uy = b[1] - a[1], L = Math.hypot(ux, uy); if (!L) return P;
    const nx = -uy / L, ny = ux / L, d = Math.round((dx * nx + dy * ny) / S.grid) * S.grid; if (!d) return P;
    const a2 = [a[0] + nx * d, a[1] + ny * d], b2 = [b[0] + nx * d, b[1] + ny * d], res = P.slice(0, k).map(p => p.slice());
    let q;
    if (k > 0 && (q = inter(P[k - 1], P[k], a2, b2))) res.push(q); else res.push(a.slice(), a2);
    if (k + 2 < P.length && (q = inter(P[k + 1], P[k + 2], a2, b2))) res.push(q); else res.push(b2, b.slice());
    return res.concat(P.slice(k + 2).map(p => p.slice()));
  }
  // U: the whole connected track (all segments of the copper it belongs to, on both layers)
  function selectConnected() {
    let ti = hitTrack(S.mouse[0], S.mouse[1]);
    if (ti < 0 && S.sel && S.sel.kind === "track") ti = S.sel.i;
    if (ti < 0 || !S.conn) { msg("Point at a track (or select one), then U"); return; }
    const it = S.conn.items.find(x => x.kind === "track" && x.ti === ti), list = [...new Set(S.conn.items.filter(x => x.kind === "track" && x.cluster === it.cluster).map(x => x.ti))];
    S.sel = simplify({ ...newMulti(), tracks: list }); msg(`${list.length} track${list.length > 1 ? "s" : ""} selected: Del removes them, the inspector sets their width`); renderPanels(); render();
  }
  const trackSelected = i => isSel("track", i);
  function ensureVisible(x, y) { const [sx, sy] = [x * S.view.scale + S.view.ox, y * S.view.scale + S.view.oy]; if (sx < 40 || sy < 40 || sx > canvas.clientWidth - 40 || sy > canvas.clientHeight - 40) centerOn(x, y); }

  // ---------------------------------------------------------------------------
  // Mouse and keyboard
  // ---------------------------------------------------------------------------
  function evPos(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function onDown(e) {
    canvas.focus();
    const [sx, sy] = evPos(e), [x, y] = toWorld(sx, sy);
    if (e.button === 1 || e.button === 2 || S.space) { S.drag = { kind: "pan", sx, sy, ox: S.view.ox, oy: S.view.oy }; e.preventDefault(); return; }
    if (S.tool === "route") { if (S.route) routeClick(e); else startRoute(x, y); return; }
    if (S.tool === "pour" || S.tool === "keepout") {
      const pt = [snap(x), snap(y)];
      if (!S.poly) S.poly = [pt];
      else if (S.poly.length >= 3 && Math.hypot(pt[0] - S.poly[0][0], pt[1] - S.poly[0][1]) <= 6 / S.view.scale + 1e-6) closePoly();
      else S.poly.push(pt);
      render(); return;
    }
    if (S.tool === "measure") { const p = hitPad(x, y), pt = p ? [p.x, p.y] : [snap(x), snap(y)]; S.measure = !S.measure || S.measure.b ? { a: pt, b: null } : { a: S.measure.a, b: pt }; render(); return; }
    if (S.tool !== "select") { placeAt(x, y); return; }
    if (onHandle(x, y)) { S.drag = { kind: "outline", w0: S.board.outline.w, h0: S.board.outline.h, mx: x, my: y, moved: false }; return; }
    let zc;
    if ((zc = hitAreaCorner(x, y)) >= 0) {
      const list = AREAS[S.sel.kind], a = S.board[list][S.sel.i];
      S.drag = a.locked ? { kind: "locked" } : { kind: "corner", list, i: S.sel.i, k: zc, x0: a.pts[zc][0], y0: a.pts[zc][1], mx: x, my: y, moved: false }; return;
    }
    // what is under the pointer: vias, holes, texts, then a track right under it, a part, a track near it
    let hit = null, i;
    if ((i = hitVia(x, y)) >= 0) hit = { kind: "via", id: i };
    else if ((i = hitHole(x, y)) >= 0) hit = { kind: "hole", id: i };
    else if ((i = hitText(x, y)) >= 0) hit = { kind: "text", id: i };
    else {
      const seg = hitPad(x, y) ? null : hitSeg(x, y, 1), g = seg ? null : hitPart(x, y);
      if (g) hit = { kind: "part", id: g.key };
      else { const sg = seg || hitSeg(x, y); if (sg) hit = { kind: "track", id: sg.i, k: sg.k }; }
    }
    if (hit) {
      if (e.shiftKey) { toggleSel(hit.kind, hit.id); renderPanels(); render(); return; }
      if (S.sel && S.sel.kind === "multi" && isSel(hit.kind, hit.id)) { const items = selItems(); S.drag = { kind: "group", items, base: snapshot(items), mx: x, my: y, moved: false }; return; }
      if (hit.kind === "part") selectPart(S.model.parts.find(g => g.key === hit.id)); else S.sel = { kind: hit.kind, i: hit.id };
      const o = objOf(hit.kind, hit.id);
      if (o.locked) S.drag = { kind: "locked" };
      else if (hit.kind === "track") S.drag = { kind: "seg", i: hit.id, k: hit.k, pts0: o.pts.map(p => p.slice()), mx: x, my: y, moved: false };
      else if (hit.kind === "part") S.drag = { kind: "part", key: hit.id, x0: o.x, y0: o.y, mx: x, my: y, moved: false };
      else S.drag = { kind: hit.kind, i: hit.id, x0: o.x, y0: o.y, mx: x, my: y, moved: false };
      renderPanels(); render(); return;
    }
    const ar = hitArea(x, y);
    if (ar) {
      S.sel = { kind: ar.kind, i: ar.i }; const a = S.board[AREAS[ar.kind]][ar.i];
      if (a.locked) S.drag = { kind: "locked" }; else if (a.pts) S.drag = { kind: "area", list: AREAS[ar.kind], i: ar.i, pts0: a.pts.map(p => p.slice()), mx: x, my: y, moved: false };
      renderPanels(); render(); return;
    }
    // empty space: a selection box (dragged left to right: what lies inside; right to left: what it touches)
    S.drag = { kind: "box", x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, moved: false };
  }
  function onMove(e) {
    if (!canvas) return;
    const [sx, sy] = evPos(e), [x, y] = toWorld(sx, sy);
    S.mouse = [x, y];
    const d = S.drag;
    if (d && d.kind === "pan") { S.view.ox = d.ox + sx - d.sx; S.view.oy = d.oy + sy - d.sy; render(); return; }
    if (d && d.kind === "part") {
      const bp = S.board.parts[d.key], nx = snap(d.x0 + x - d.mx), ny = snap(d.y0 + y - d.my);
      if (nx !== bp.x || ny !== bp.y) { bp.x = nx; bp.y = ny; d.moved = true; analyse(true); render(); }
    } else if (d && d.kind === "group") {
      const dx = snap(x - d.mx), dy = snap(y - d.my);
      if (dx !== d.dx || dy !== d.dy) { d.dx = dx; d.dy = dy; moveItems(d.items, d.base, dx, dy); d.moved = !!(dx || dy); analyse(true); render(); }
    } else if (d && d.kind === "seg") {
      const t = S.board.tracks[d.i], np = dragSeg(d.pts0, d.k, x - d.mx, y - d.my);
      if (JSON.stringify(np) !== JSON.stringify(t.pts)) { t.pts = np; d.moved = true; analyse(true); render(); }
    } else if (d && d.kind === "corner") {
      const p = S.board[d.list][d.i].pts[d.k]; p[0] = snap(d.x0 + x - d.mx); p[1] = snap(d.y0 + y - d.my); d.moved = true; render();
    } else if (d && d.kind === "area") {
      const dx = snap(x - d.mx), dy = snap(y - d.my); S.board[d.list][d.i].pts = d.pts0.map(p => [p[0] + dx, p[1] + dy]); d.moved = !!(dx || dy); render();
    } else if (d && d.kind === "box") {
      d.x1 = x; d.y1 = y; d.moved = Math.hypot(d.x1 - d.x0, d.y1 - d.y0) * S.view.scale > 4; render();
    } else if (d && d.kind === "locked") {
      if (!d.noted) { d.noted = true; lockedNote(); }
    } else if (d && LISTS[d.kind]) {
      const o = S.board[LISTS[d.kind]][d.i]; o.x = snap(d.x0 + x - d.mx); o.y = snap(d.y0 + y - d.my); d.moved = true; analyse(true); render();
    } else if (d && d.kind === "outline") {
      const o = S.board.outline; o.w = Math.max(10, snap(d.w0 + x - d.mx)); o.h = Math.max(10, snap(d.h0 + y - d.my)); d.moved = true; analyse(true); render();
    }
    const p = hitPad(x, y);
    S.hover = p ? p.net : null;
    canvas.style.cursor = S.tool === "select" && onHandle(x, y) ? "nwse-resize" : S.tool === "select" ? "" : "crosshair";
    $("st-pos").textContent = `x ${x.toFixed(2)}  y ${y.toFixed(2)} mm` + (p ? ` · ${p.ref}-${p.num}${p.name !== p.num ? " (" + p.name + ")" : ""} · ${p.netName || "no net"} (${classOf(p.net)})` : "");
    if (S.route) S.routeBad = routeCheck();
    if (S.route || p || S.measure || S.tool !== "select") render();
  }
  function onUp() {
    const d = S.drag; S.drag = null;
    if (d && d.kind === "box") {
      if (d.moved) { boxSelect(d.x0, d.y0, d.x1, d.y1, d.x1 < d.x0, d.add); const n = selItems().length; msg(n ? `${n} selected: drag one to move them all, R turns them, arrows nudge, L locks, the inspector aligns` : "Nothing in the box"); }
      else if (!d.add) S.sel = null;
      renderPanels(); render(); return;
    }
    if (d && d.kind === "seg" && d.moved) S.board.tracks[d.i].pts = tidy(S.board.tracks[d.i].pts);
    if (d && d.kind !== "pan" && d.moved) commit(d.kind === "outline" ? `Board ${S.board.outline.w} × ${S.board.outline.h} mm` : undefined);
  }
  function onWheel(e) {
    e.preventDefault();
    const [sx, sy] = evPos(e), k = Math.exp(-e.deltaY * 0.0015), s = Math.max(0.5, Math.min(80, S.view.scale * k)), f = s / S.view.scale;
    S.view.ox = sx - (sx - S.view.ox) * f; S.view.oy = sy - (sy - S.view.oy) * f; S.view.scale = s;
    render();
  }
  const MODALS = ["help-modal", "rules-modal", "setup-modal"];
  function highlightNet(n) { S.netHL = n === null || n === undefined || n === S.netHL ? null : n; msg(S.netHL === null ? "Net highlight off" : `Highlighting ${netName(S.netHL)} (again: off)`); renderNets(); render(); }
  function onKey(e) {
    const tag = (e.target.tagName || "").toUpperCase();
    if (e.key === "F1") { e.preventDefault(); toggle("help-modal"); return; }
    if (e.key === "Escape") { const open = MODALS.find(id => !$(id).hidden); if (open) { $(open).hidden = true; return; } }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (!MODALS.every(id => $(id).hidden)) return;
    const ctrl = e.ctrlKey || e.metaKey, L = /^Key[A-Z]$/.test(e.code || "") ? e.code.slice(3).toLowerCase() : String(e.key).toLowerCase();
    if (e.key === " ") { S.space = true; e.preventDefault(); return; }
    if (e.code === "Backquote") { const p = hitPad(S.mouse[0], S.mouse[1]), ti = hitTrack(S.mouse[0], S.mouse[1]); highlightNet(p ? p.net : ti >= 0 ? netOfTrack(ti) : null); return; }
    if (S.poly && e.key === "Escape") { S.poly = null; render(); return; }
    if (S.poly && e.key === "Backspace") { e.preventDefault(); S.poly.pop(); if (!S.poly.length) S.poly = null; render(); return; }
    if (S.poly && e.key === "Enter") { closePoly(); return; }
    const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (ARROWS[e.key] && S.sel && !S.route) { e.preventDefault(); const k = S.grid * (e.shiftKey ? 10 : 1); nudge(ARROWS[e.key][0] * k, ARROWS[e.key][1] * k); return; }
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
    else if (L === "p") setTool("pour");
    else if (L === "u") selectConnected();
    else if (L === "k") setTool("keepout");
    else if (L === "l") lockSel();
    else if (L === "r") rotateSel();
    else if (L === "m") flipSel();
    else if (L === "f") fit();
    else if (e.key === "?") toggle("help-modal");
  }
  // ---------------------------------------------------------------------------
  // Selection of several things (box, Shift+click, U): { kind: "multi", parts: [keys], tracks, vias, texts, holes: [indices] }
  // ---------------------------------------------------------------------------
  const MLIST = { track: "tracks", via: "vias", text: "texts", hole: "holes" };
  const newMulti = () => ({ kind: "multi", parts: [], tracks: [], vias: [], texts: [], holes: [] });
  function asMulti(s) {
    const m = newMulti(); if (!s || AREAS[s.kind]) return m;
    if (s.kind === "multi") { Object.keys(m).forEach(k => { if (Array.isArray(s[k])) m[k] = s[k].slice(); }); return m; }
    if (s.kind === "part") m.parts.push(s.key); else if (MLIST[s.kind]) m[MLIST[s.kind]].push(s.i);
    return m;
  }
  function simplify(m) {
    const n = m.parts.length + m.tracks.length + m.vias.length + m.texts.length + m.holes.length;
    if (!n) return null; if (n > 1) return m;
    if (m.parts.length) return { kind: "part", key: m.parts[0] };
    for (const [k, l] of Object.entries(MLIST)) if (m[l].length) return { kind: k, i: m[l][0] };
    return null;
  }
  function toggleSel(kind, id) {
    const m = asMulti(S.sel), arr = kind === "part" ? m.parts : m[MLIST[kind]], at = arr.indexOf(id);
    if (at >= 0) arr.splice(at, 1); else arr.push(id);
    S.sel = simplify(m);
  }
  function isSel(kind, id) {
    const s = S.sel; if (!s) return false;
    if (s.kind === "multi") return (kind === "part" ? s.parts : s[MLIST[kind]] || []).includes(id);
    return kind === "part" ? s.kind === "part" && s.key === id : s.kind === kind && s.i === id;
  }
  const objOf = (kind, id) => (kind === "part" ? S.board.parts[id] : (S.board[MLIST[kind] || AREAS[kind]] || [])[id]);
  const isLocked = (kind, id) => !!(objOf(kind, id) || {}).locked;
  function selItems() {
    const s = S.sel; if (!s) return [];
    if (s.kind === "multi") return [...s.parts.map(k => ["part", k]), ...Object.entries(MLIST).flatMap(([k, l]) => s[l].map(i => [k, i]))];
    return [[s.kind, s.kind === "part" ? s.key : s.i]];
  }
  function boxSelect(x1, y1, x2, y2, crossing, add) {
    const bx1 = Math.min(x1, x2), bx2 = Math.max(x1, x2), by1 = Math.min(y1, y2), by2 = Math.max(y1, y2), R = [[bx1, by1], [bx2, by1], [bx2, by2], [bx1, by2]];
    const inside = (x, y) => x >= bx1 && x <= bx2 && y >= by1 && y <= by2;
    const box = b => (crossing ? !(b.x2 < bx1 || b.x1 > bx2 || b.y2 < by1 || b.y1 > by2) : inside(b.x1, b.y1) && inside(b.x2, b.y2));
    const pt = (x, y, r) => box({ x1: x - r, y1: y - r, x2: x + r, y2: y + r });
    const m = add ? asMulti(S.sel) : newMulti(), put = (arr, v) => { if (!arr.includes(v)) arr.push(v); };
    if (S.model) S.model.parts.forEach(g => { if (g.place && box(partBox(g))) put(m.parts, g.key); });
    S.board.tracks.forEach((t, i) => { if (!S.show[t.layer]) return; if (crossing ? t.pts.some((p, k) => k && B.segInPoly([t.pts[k - 1][0], t.pts[k - 1][1], p[0], p[1]], R, 0)) : t.pts.every(p => inside(p[0], p[1]))) put(m.tracks, i); });
    S.board.vias.forEach((v, i) => { if (pt(v.x, v.y, (v.pad || S.board.rules.viaPad) / 2)) put(m.vias, i); });
    if (S.show.Holes) S.board.holes.forEach((h, i) => { if (pt(h.x, h.y, h.d / 2)) put(m.holes, i); });
    S.board.texts.forEach((t, i) => { if (S.show[t.layer] && box(textBox(t))) put(m.texts, i); });
    S.sel = simplify(m);
  }
  // positions of the selected things, to move them all from where they started (locked ones stay)
  const snapshot = items => items.map(([k, id]) => { const o = objOf(k, id); return o.pts ? o.pts.map(p => p.slice()) : [o.x, o.y]; });
  function moveItems(items, base, dx, dy) {
    items.forEach(([k, id], n) => {
      const o = objOf(k, id); if (!o || o.locked) return;
      if (o.pts) o.pts = base[n].map(p => [+(p[0] + dx).toFixed(4), +(p[1] + dy).toFixed(4)]);
      else if (o.x !== undefined) { o.x = +(base[n][0] + dx).toFixed(4); o.y = +(base[n][1] + dy).toFixed(4); }
    });
  }
  const lockedNote = () => msg("Locked: it stays put. Select it and press L to unlock");
  function nudge(dx, dy) {
    const it = selItems(); if (!it.length) return;
    if (it.every(([k, id]) => isLocked(k, id))) { lockedNote(); return; }
    moveItems(it, snapshot(it), dx, dy); commit();
  }
  function lockSel() {
    const it = selItems(); if (!it.length) { msg("Select something, then L locks it in place"); return; }
    const lock = !it.every(([k, id]) => isLocked(k, id));
    it.forEach(([k, id]) => { const o = objOf(k, id); if (!o) return; if (lock) o.locked = true; else delete o.locked; });
    commit(lock ? `Locked ${it.length} item${it.length > 1 ? "s" : ""}: they cannot be moved by mistake (L again unlocks)` : `Unlocked ${it.length} item${it.length > 1 ? "s" : ""}`);
  }
  function rotateSel() {
    const it = selItems(); if (!it.length) return;
    if (it.some(([k, id]) => isLocked(k, id))) { lockedNote(); return; }
    if (it.length === 1 && (it[0][0] === "part" || it[0][0] === "text")) { const o = objOf(it[0][0], it[0][1]); o.rot = ((o.rot || 0) + 1) & 3; commit(); return; }
    // a group turns 90° (counter-clockwise on screen) about its middle, snapped to the grid
    const pts = [];
    it.forEach(([k, id]) => { const o = objOf(k, id); if (o.pts) pts.push(...o.pts); else if (o.x !== undefined) pts.push([o.x, o.y]); });
    if (!pts.length) return;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), cx = snap((Math.min(...xs) + Math.max(...xs)) / 2), cy = snap((Math.min(...ys) + Math.max(...ys)) / 2);
    const T = ([x, y]) => [+(cx + (y - cy)).toFixed(4), +(cy - (x - cx)).toFixed(4)];
    it.forEach(([k, id]) => {
      const o = objOf(k, id);
      if (o.pts) { o.pts = o.pts.map(T); return; }
      [o.x, o.y] = T([o.x, o.y]);
      // a mirrored (bottom-side) footprint or text turns the other way in its own frame
      if (k === "part") o.rot = ((o.rot || 0) + (o.side === "B" ? 3 : 1)) & 3;
      if (k === "text") o.rot = ((o.rot || 0) + (o.layer.startsWith("B") ? 3 : 1)) & 3;
    });
    commit(`Turned ${it.length} items 90°`);
  }
  function flipSel() {
    if (!S.sel) return;
    if (S.sel.kind === "multi") { msg("M moves one part at a time to the other side"); return; }
    if (S.sel.kind === "part") { const p = S.board.parts[S.sel.key]; if (p.locked) { lockedNote(); return; } p.side = p.side === "B" ? "F" : "B"; commit(`${p.ref} is now on the ${p.side === "B" ? "bottom" : "top"} side`); }
    else if (S.sel.kind === "text") { const t = S.board.texts[S.sel.i]; t.layer = { "F.SilkS": "B.SilkS", "B.SilkS": "F.SilkS", "F.Cu": "B.Cu", "B.Cu": "F.Cu" }[t.layer]; commit(); }
  }
  function deleteSel() {
    const it = selItems(); if (!it.length) return;
    const parts = it.filter(([k]) => k === "part").length, locked = it.filter(([k, id]) => k !== "part" && isLocked(k, id)).length, del = it.filter(([k, id]) => k !== "part" && !isLocked(k, id));
    if (!del.length) { msg(parts ? "Parts come from the schematic: delete them there (then Update from schematic)" : "Locked: press L to unlock it first"); return; }
    const by = {}; del.forEach(([k, i]) => { const l = MLIST[k] || AREAS[k]; (by[l] = by[l] || []).push(i); });
    Object.entries(by).forEach(([l, idx]) => idx.sort((a, b) => b - a).forEach(i => S.board[l].splice(i, 1)));
    S.sel = null;
    commit(`Deleted ${del.length}${locked ? `; ${locked} locked kept` : ""}${parts ? "; parts stay (they come from the schematic)" : ""}`);
  }
  // align and distribute the selected parts by their outlines (locked parts count, but stay)
  function alignParts(how) {
    const s = S.sel; if (!s || s.kind !== "multi" || !S.model) return;
    const gs = s.parts.map(k => S.model.parts.find(g => g.key === k)).filter(g => g && g.place); if (gs.length < 2) return;
    const bs = gs.map(partBox), X1 = Math.min(...bs.map(b => b.x1)), X2 = Math.max(...bs.map(b => b.x2)), Y1 = Math.min(...bs.map(b => b.y1)), Y2 = Math.max(...bs.map(b => b.y2));
    const move = (i, dx, dy) => { const bp = S.board.parts[gs[i].key]; if (bp.locked) return; bp.x = +(bp.x + dx).toFixed(4); bp.y = +(bp.y + dy).toFixed(4); };
    const cxs = bs.map(b => (b.x1 + b.x2) / 2), cys = bs.map(b => (b.y1 + b.y2) / 2);
    if (how === "left") bs.forEach((b, i) => move(i, X1 - b.x1, 0));
    else if (how === "right") bs.forEach((b, i) => move(i, X2 - b.x2, 0));
    else if (how === "hcenter") bs.forEach((b, i) => move(i, (X1 + X2) / 2 - cxs[i], 0));
    else if (how === "top") bs.forEach((b, i) => move(i, 0, Y1 - b.y1));
    else if (how === "bottom") bs.forEach((b, i) => move(i, 0, Y2 - b.y2));
    else if (how === "vcenter") bs.forEach((b, i) => move(i, 0, (Y1 + Y2) / 2 - cys[i]));
    else if (how === "hdist" || how === "vdist") {
      const c = how === "hdist" ? cxs : cys, order = c.map((v, i) => i).sort((a, b) => c[a] - c[b]), a = c[order[0]], z = c[order[order.length - 1]], step = (z - a) / (order.length - 1);
      order.forEach((i, n) => { const t = a + n * step - c[i]; move(i, how === "hdist" ? t : 0, how === "vdist" ? t : 0); });
    }
    commit({ left: "Aligned left", right: "Aligned right", hcenter: "Centred on one vertical line", top: "Aligned to the top", bottom: "Aligned to the bottom", vcenter: "Centred on one horizontal line", hdist: "Spread evenly across", vdist: "Spread evenly down" }[how] + ` (${gs.length} parts)`);
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
  // texts in the stroke font the Gerbers use
  function drawText(t, color) {
    const st = B.strokeText(t.text, t.x, t.y, t.size, t.rot, t.layer.startsWith("B"));
    ctx.strokeStyle = color; ctx.lineWidth = st.w; ctx.lineCap = "round"; ctx.lineJoin = "round";
    st.lines.forEach(l => { ctx.beginPath(); l.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); });
  }
  // a copper layer's pours, painted apart (their clearances cut only the pour) and laid on the board
  let pourCanvas = null;
  function drawPours(layer, alpha) {
    const fs = S.fills.filter(f => f.layer === layer); if (!fs.length) return;
    if (!pourCanvas) pourCanvas = document.createElement("canvas");
    if (pourCanvas.width !== canvas.width || pourCanvas.height !== canvas.height) { pourCanvas.width = canvas.width; pourCanvas.height = canvas.height; }
    const pc = pourCanvas.getContext("2d"), { scale, ox, oy } = S.view;
    pc.setTransform(1, 0, 0, 1, 0, 0); pc.clearRect(0, 0, pourCanvas.width, pourCanvas.height);
    pc.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    fs.forEach(f => BoardFab.paint(pc, f.ops, COLORS[layer], "erase"));
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.drawImage(pourCanvas, 0, 0); ctx.restore();
  }
  const selColor = (kind, i, c) => (isSel(kind, i) ? "#00e5ff" : c);
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
    const NH = S.netHL, hl = NH !== null ? NH : S.hover !== null && S.hover !== undefined ? S.hover : S.route ? S.route.net : null;
    order.forEach(layer => {
      if (!S.show[layer]) return;
      const base = layer === S.layer ? 0.92 : S.dim;
      if (S.show.zones) drawPours(layer, (layer === S.layer ? 0.5 : S.dim * 0.55) * (NH !== null ? 0.4 : 1));
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      S.board.tracks.forEach((t, i) => {
        if (t.layer !== layer) return;
        const sel = trackSelected(i), n = netOfTrack(i), lit = hl !== null && n === hl;
        ctx.globalAlpha = NH !== null && !lit && !sel ? base * 0.25 : base;
        ctx.strokeStyle = sel ? "#00e5ff" : COLORS[layer]; ctx.lineWidth = t.w;
        ctx.beginPath(); t.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
        if (lit && !sel) { ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = t.w * 0.35; ctx.stroke(); }
      });
      ctx.globalAlpha = base;
      S.board.texts.forEach((t, i) => { if (t.layer === layer) drawText(t, selColor("text", i, COLORS[layer])); });
      ctx.globalAlpha = 1;
    });
    // silkscreen: bottom first (mirrored footprints), then top
    ["B", "F"].forEach(side => {
      const L = side + ".SilkS"; if (!S.show[L]) return;
      S.board.texts.forEach((t, i) => { if (t.layer === L) drawText(t, selColor("text", i, COLORS[L])); });
      if (S.model) S.model.parts.forEach(g => {
        if (!g.place || (g.place.side || "F") !== side) return;
        const sel = isSel("part", g.key);
        // the silkscreen as it will be made (outline and reference in the stroke font)
        const ops = BoardFab.partSilk(g); if (px > 0.15) ops.forEach(o => { if (o.t === "line") o.w = Math.max(o.w, px); });
        BoardFab.paint(ctx, ops, sel ? "#00e5ff" : COLORS[L], "erase");
        const b = partBox(g);
        if (scale > 6) { ctx.font = `${Math.max(1, 9 * px)}px ui-monospace, monospace`; ctx.fillStyle = "#8b949e"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(g.value, (b.x1 + b.x2) / 2, b.y2 + 0.3); }
        if (sel) { ctx.strokeStyle = "rgba(0,229,255,0.6)"; ctx.setLineDash([4 * px, 3 * px]); ctx.lineWidth = px; ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); ctx.setLineDash([]); }
      });
    });
    // pads (through-hole: on both layers) and vias, when any copper layer is shown
    if (S.model && (S.show["F.Cu"] || S.show["B.Cu"])) {
      S.model.pads.forEach(p => {
        const lit = hl !== null && p.net === hl;
        ctx.fillStyle = p.conflict ? "#ff7b72" : lit ? "#ffe680" : NH !== null ? "#5c4a14" : COLORS.pad;
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
      ctx.lineWidth = Math.max(0.08, 0.8 * px);
      S.conn.rats.forEach(r => { ctx.strokeStyle = NH === null ? "rgba(230,237,243,0.55)" : r.net === NH ? "rgba(255,230,128,0.95)" : "rgba(230,237,243,0.12)"; ctx.beginPath(); ctx.moveTo(r.x1, r.y1); ctx.lineTo(r.x2, r.y2); ctx.stroke(); });
    }
    // pour outlines (dashed), the selected one with its corner handles; a pour being drawn
    if (S.show.zones) S.board.zones.forEach((z, i) => {
      if (!S.show[z.layer]) return;
      const P = B.zonePoly(S.board, z), sel = S.sel && S.sel.kind === "zone" && S.sel.i === i;
      ctx.strokeStyle = sel ? "#00e5ff" : COLORS[z.layer]; ctx.lineWidth = Math.max(0.1, (sel ? 1.6 : 1) * px); ctx.setLineDash([5 * px, 4 * px]);
      ctx.beginPath(); P.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      if (sel && z.pts) { ctx.fillStyle = "#00e5ff"; z.pts.forEach(p => ctx.fillRect(p[0] - 3 * px, p[1] - 3 * px, 6 * px, 6 * px)); }
    });
    // keep-out areas: hatched, dashed orange
    if (S.show.keepouts) S.board.keepouts.forEach((k, i) => {
      if (!B.koLayers(k).some(l => S.show[l])) return;
      const P = k.pts, sel = S.sel && S.sel.kind === "keepout" && S.sel.i === i, col = sel ? "#00e5ff" : COLORS.keepouts;
      const xs = P.map(p => p[0]), ys = P.map(p => p[1]), x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys), step = Math.max(1.2, 9 * px);
      ctx.save(); ctx.beginPath(); P.forEach((p, n) => (n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.clip();
      ctx.strokeStyle = col; ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(0.08, px); ctx.beginPath();
      for (let t = x1 - (y2 - y1); t < x2; t += step) { ctx.moveTo(t, y2); ctx.lineTo(t + (y2 - y1), y1); }
      ctx.stroke(); ctx.restore();
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.1, (sel ? 1.8 : 1.2) * px); ctx.setLineDash([6 * px, 4 * px]);
      ctx.beginPath(); P.forEach((p, n) => (n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      if (k.name) { ctx.fillStyle = col; ctx.font = `${11 * px}px ui-monospace, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(k.name, x1 + 3 * px, y1 + 3 * px); }
      if (sel) { ctx.fillStyle = "#00e5ff"; P.forEach(p => ctx.fillRect(p[0] - 3 * px, p[1] - 3 * px, 6 * px, 6 * px)); }
    });
    // a padlock on locked parts and holes
    const lockMark = (x, y) => { const u = 4 * px; ctx.strokeStyle = "#9aa7b4"; ctx.fillStyle = "#9aa7b4"; ctx.lineWidth = Math.max(0.08, px); ctx.fillRect(x - u, y - u * 0.2, 2 * u, 1.5 * u); ctx.beginPath(); ctx.arc(x, y - u * 0.2, u * 0.65, Math.PI, 0); ctx.stroke(); };
    if (S.model) S.model.parts.forEach(g => { if (g.place && S.board.parts[g.key].locked) { const b = partBox(g), w = B.strokeText(g.ref, 0, 0, 1.27).width; lockMark((b.x1 + b.x2) / 2 + w / 2 + 1 + 5 * px, b.y1 - 0.4 - 0.9); } });
    if (S.show.Holes) S.board.holes.forEach(h => { if (h.locked) lockMark(h.x + h.d / 2 + 4 * px, h.y - h.d / 2); });
    // the selection box: solid when it takes what lies inside, dashed when it takes what it touches
    if (S.drag && S.drag.kind === "box" && S.drag.moved) {
      const d = S.drag, cross = d.x1 < d.x0; ctx.strokeStyle = cross ? "#7ee787" : "#58a6ff"; ctx.fillStyle = cross ? "rgba(126,231,135,0.08)" : "rgba(88,166,255,0.08)";
      ctx.lineWidth = px; ctx.setLineDash(cross ? [5 * px, 4 * px] : []); ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); ctx.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); ctx.setLineDash([]);
    }
    if (S.poly) {
      const pts = S.poly.concat([[snap(S.mouse[0]), snap(S.mouse[1])]]);
      ctx.strokeStyle = S.tool === "keepout" ? COLORS.keepouts : COLORS[S.layer]; ctx.lineWidth = Math.max(0.1, 1.5 * px); ctx.setLineDash([5 * px, 4 * px]);
      ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (pts.length > 2) ctx.lineTo(pts[0][0], pts[0][1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = COLORS[S.layer]; S.poly.forEach(p => ctx.fillRect(p[0] - 2.5 * px, p[1] - 2.5 * px, 5 * px, 5 * px));
    }
    if (S.route) {
      const r = S.route, pts = r.pts.concat(bend(r.pts[r.pts.length - 1], routeTarget())), bad = S.routeBad;
      const need = B.classRule(classOf(r.net), S.board.rules).clearance, tail = [r.pts[r.pts.length - 1]].concat(bend(r.pts[r.pts.length - 1], routeTarget()));
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      // the clearance halo of the segments being placed: red when they come too close
      ctx.strokeStyle = bad ? "rgba(255,80,80,0.28)" : "rgba(0,229,255,0.13)"; ctx.lineWidth = r.w + 2 * need;
      ctx.beginPath(); tail.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
      ctx.strokeStyle = bad ? "#ff5050" : COLORS[r.layer]; ctx.globalAlpha = 0.75; ctx.lineWidth = r.w;
      ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.globalAlpha = 1;
      if (bad) {
        ctx.strokeStyle = "#ff5050"; ctx.lineWidth = Math.max(0.12, 1.5 * px); ctx.beginPath(); ctx.arc(bad.x, bad.y, Math.max(1, 8 * px), 0, Math.PI * 2); ctx.stroke();
        $("st-msg").textContent = `Too close to ${bad.what}${bad.net ? " (" + bad.net + ")" : ""}: ${Math.max(0, bad.g).toFixed(2)} < ${bad.need} mm — Shift+click places it anyway`;
      }
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
      ctx.strokeStyle = NOTE.includes(d.kind) ? "#ffb300" : "#ff7b72"; ctx.lineWidth = Math.max(0.12, 1.5 * px);
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
  const NOTE = ["unplaced", "check", "class", "silk", "dangling"];
  const errors = () => S.drc.filter(d => !NOTE.includes(d.kind)).length;

  // ---------------------------------------------------------------------------
  // Panels: parts list, inspector, rule check, layers
  // ---------------------------------------------------------------------------
  function renderPanels() {
    const host = $("parts"), M = S.model;
    if (!M) { host.innerHTML = `<p class="help">The parts arrive from the Circuit CAD.</p>`; $("parts-count").textContent = ""; }
    else {
      const unplaced = new Set(S.drc.filter(d => d.kind === "unplaced").map(d => d.msg.split(" ")[0]));
      const row = g => `<button class="item${isSel("part", g.key) ? " active" : ""}" data-key="${esc(g.key)}"><span>${esc(g.ref)}</span><em>${esc(g.fp ? g.fp.name : "")}</em></button>`;
      const on = M.parts.filter(g => !unplaced.has(g.ref)), off = M.parts.filter(g => unplaced.has(g.ref));
      host.innerHTML = (off.length ? `<button class="btn" id="btn-arrange" style="width:100%;margin:2px 0 6px" title="Pack the parts waiting below the board into rows inside the outline: a starting point for your placement">Place all on the board</button><h2>To place <small>${off.length}</small></h2>${off.map(row).join("")}` : "") + `<h2>On the board <small>${on.length}</small></h2>${on.map(row).join("")}`;
      $("parts-count").textContent = `${M.parts.length}`;
      host.querySelectorAll(".item").forEach(b => b.addEventListener("click", () => { const g = M.parts.find(x => x.key === b.dataset.key); selectPart(g); centerOn(g.place.x, g.place.y); renderPanels(); }));
      const ab = $("btn-arrange");
      if (ab) ab.onclick = () => { const left = B.arrange(S.board, M, off.map(g => g.key)); commit(left ? `${left} part${left > 1 ? "s" : ""} did not fit: make the board larger` : `Placed ${off.length} parts in rows on the board`); fit(); };
    }
    renderInspector();
    const dh = $("drc"), list = S.drc.slice().sort((a, b) => NOTE.includes(a.kind) - NOTE.includes(b.kind));
    $("drc-count").textContent = list.length ? String(list.length) : "";
    dh.innerHTML = list.length ? list.slice(0, 200).map((d, i) => `<button class="drc ${NOTE.includes(d.kind) && d.kind !== "unplaced" ? "check" : d.kind}" data-i="${i}">${esc(d.msg)}${d.between ? ` <span class="help">(${esc(d.between.join(" – "))})</span>` : ""}</button>`).join("") : `<p class="help">${M ? "No problems." : ""}</p>`;
    dh.querySelectorAll(".drc").forEach(b => b.addEventListener("click", () => { const d = list[+b.dataset.i]; if (S.view.scale < 8) S.view.scale = 8; centerOn(d.x, d.y); }));
    renderLayers(); renderNets();
  }
  // nets: class, pads, connections still to route, routed length; click to highlight
  function renderNets() {
    const host = $("nets"), M = S.model;
    if (!M || !S.conn) { host.innerHTML = `<p class="help">The nets arrive from the Circuit CAD.</p>`; $("nets-count").textContent = ""; return; }
    const nets = [...new Set(M.pads.filter(p => p.net !== null).map(p => p.net))], todo = {}, len = {};
    S.conn.rats.forEach(r => { todo[r.net] = (todo[r.net] || 0) + 1; });
    S.board.tracks.forEach((t, i) => { const n = netOfTrack(i); if (n === null) return; for (let k = 0; k + 1 < t.pts.length; k++) len[n] = (len[n] || 0) + Math.hypot(t.pts[k + 1][0] - t.pts[k][0], t.pts[k + 1][1] - t.pts[k][1]); });
    const pour = new Set(S.fills.map(f => f.net));
    const rows = nets.map(n => ({ n, name: netName(n), cls: classOf(n), pads: M.pads.filter(p => p.net === n).length, todo: todo[n] || 0, len: len[n] || 0, I: (S.amps || {})[n] || 0 }))
      .filter(r => r.pads > 1 || r.len).sort((a, b) => (b.todo > 0) - (a.todo > 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    $("nets-count").textContent = String(rows.length);
    host.innerHTML = `<p class="help">Click a net to highlight it (again: off), or point at a pad and press the key left of 1 (\`).</p>` + rows.map(r => `<button class="net${r.n === S.netHL ? " active" : ""}" data-n="${esc(r.n)}" title="${esc(r.name)}: ${r.pads} pads, ${r.len.toFixed(1)} mm of track${pour.has(r.n) ? ", copper pour" : ""}${r.I ? `, ${B.fmtA(r.I)} DC: ${B.currentWidth(r.I, S.board.rules, S.board.stackup)} mm wide at least` : ""}">
      <span class="nm">${esc(r.name)}${r.I >= 0.001 ? ` <small class="help">${B.fmtA(r.I)}</small>` : ""}</span><span class="cls cls-${r.cls}">${r.cls}</span><span class="${r.todo ? "todo" : "done"}">${r.todo ? `${r.todo} to route` : pour.has(r.n) ? "pour ✓" : "✓"}</span></button>`).join("");
    host.querySelectorAll(".net").forEach(b => b.addEventListener("click", () => { const n = isNaN(+b.dataset.n) ? b.dataset.n : +b.dataset.n; highlightNet(n); }));
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
  const lockField = o => field("Position", o.locked ? "locked" : "free", v => { if (v === "locked") o.locked = true; else delete o.locked; commit(); }, [["free", "Free"], ["locked", "Locked (L)"]]);
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
      h.appendChild(lockField(bp));
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
      const I = net !== null && net !== "short" ? (S.amps || {})[net] : 0, need = B.currentWidth(I, R, S.board.stackup);
      if (I) h.insertAdjacentHTML("beforeend", kv("DC current", `${B.fmtA(I)} · needs ${need} mm`, need > t.w ? "bad" : "ok"));
      h.appendChild(lockField(t)); h.appendChild(delBtn()); return;
    }
    if (s && s.kind === "multi") {
      const ts = s.tracks.map(i => S.board.tracks[i]).filter(Boolean), n = selItems().length, nl = selItems().filter(([k, id]) => isLocked(k, id)).length;
      const what = [[s.parts.length, "part"], [ts.length, "track"], [s.vias.length, "via"], [s.texts.length, "text"], [s.holes.length, "hole"]].filter(([c]) => c).map(([c, w]) => `${c} ${w}${c > 1 ? "s" : ""}`).join(", ");
      h.innerHTML = `<div class="insp-title">${n} selected</div><p class="help">${what}${nl ? ` · ${nl} locked` : ""}. Drag one to move them all; R turns them, arrows nudge (Shift: ×10), L locks.</p>`;
      if (s.parts.length >= 2) {
        h.insertAdjacentHTML("beforeend", `<h2>Align parts</h2><div class="align">${[["left", "⇤ Left"], ["hcenter", "↔ Centre"], ["right", "Right ⇥"], ["top", "⤒ Top"], ["vcenter", "↕ Middle"], ["bottom", "Bottom ⤓"]].map(([k, t]) => `<button class="btn" data-al="${k}">${t}</button>`).join("")}</div>` +
          (s.parts.length >= 3 ? `<div class="align">${[["hdist", "Spread across"], ["vdist", "Spread down"]].map(([k, t]) => `<button class="btn" data-al="${k}">${t}</button>`).join("")}</div>` : ""));
        h.querySelectorAll("[data-al]").forEach(b => { b.onclick = () => alignParts(b.dataset.al); });
      }
      if (ts.length) {
        const len = ts.reduce((a, t) => a + t.pts.slice(1).reduce((b, p, k) => b + Math.hypot(p[0] - t.pts[k][0], p[1] - t.pts[k][1]), 0), 0);
        h.insertAdjacentHTML("beforeend", kv("Track length", len.toFixed(1) + " mm") + kv("Widths", [...new Set(ts.map(t => t.w))].join(", ") + " mm"));
        h.appendChild(field("Set track width (mm)", ts[0].w, v => { if (v > 0) { ts.forEach(t => { t.w = v; }); commit(`Width ${v} mm on ${ts.length} tracks`); } }));
      }
      const row = document.createElement("div"); row.style.cssText = "display:flex;gap:6px;margin-top:8px";
      const lk = document.createElement("button"); lk.className = "btn"; lk.textContent = nl === n ? "Unlock (L)" : "Lock (L)"; lk.onclick = lockSel;
      row.appendChild(lk); row.appendChild(delBtn()); h.appendChild(row); return;
    }
    if (s && s.kind === "keepout") {
      const k = S.board.keepouts[s.i]; if (!k) { S.sel = null; return renderInspector(); }
      const L = B.koLayers(k), yes = [["yes", "Not allowed"], ["no", "Allowed"]];
      h.innerHTML = `<div class="insp-title">Keep-out area</div><p class="help">Nothing it forbids may enter it: the check reports it, routing refuses it, pours leave it empty. Typical: under a power transformer, round a mains entry, by a heater.</p>`;
      h.appendChild(field("Name", k.name || "", v => { k.name = v; commit(); }, "text"));
      h.appendChild(field("Layers", L.length === 2 ? "both" : L[0], v => { k.layers = v === "both" ? ["F.Cu", "B.Cu"] : [v]; commit(); }, [["both", "Both copper layers"], ["F.Cu", "Top copper"], ["B.Cu", "Bottom copper"]]));
      [["tracks", "Tracks"], ["vias", "Vias"], ["pour", "Copper pour"], ["parts", "Parts"]].forEach(([key, t]) => h.appendChild(field(t, (key === "parts" ? !!k.parts : k[key] !== false) ? "yes" : "no", v => { k[key] = v === "yes"; commit(); }, yes)));
      h.appendChild(lockField(k)); h.appendChild(delBtn()); return;
    }
    if (s && s.kind === "zone") {
      const z = S.board.zones[s.i]; if (!z) { S.sel = null; return renderInspector(); }
      const f = S.fills.find(x => x.zone === s.i), nets = S.model ? [...new Set(S.model.pads.filter(p => p.net !== null).map(p => p.netName))].sort((a, b) => (b === "GND") - (a === "GND") || a.localeCompare(b, undefined, { numeric: true })) : [z.net];
      if (!nets.includes(z.net)) nets.unshift(z.net);
      h.innerHTML = `<div class="insp-title">Copper pour</div>` + (f ? kv("Pieces", f.pieces + (f.islands ? ` · ${f.islands} island${f.islands > 1 ? "s" : ""} removed` : "")) : "");
      h.appendChild(field("Net", z.net, v => { z.net = v; commit(); }, nets.map(n => [n, n])));
      h.appendChild(field("Layer", z.layer, v => { z.layer = v; commit(); }, [["F.Cu", "Top copper"], ["B.Cu", "Bottom copper"]]));
      h.appendChild(field("Area", z.pts ? "poly" : "board", v => { if (v === "board") { z.pts = null; } else if (!z.pts) { const o = S.board.outline, e = 3; z.pts = [[e, e], [o.w - e, e], [o.w - e, o.h - e], [e, o.h - e]]; } commit(); }, [["board", "The whole board"], ["poly", "Its own outline (drag the corners)"]]));
      h.appendChild(field("Pads of its net", z.thermal === false ? "solid" : "thermal", v => { z.thermal = v === "thermal"; commit(); }, [["thermal", "Thermal reliefs (easy to solder)"], ["solid", "Solid (more current)"]]));
      h.appendChild(field("Thermal gap (mm)", z.gap || 0.5, v => { if (v > 0) { z.gap = v; commit(); } }));
      h.appendChild(field("Spoke width (mm)", z.spoke || 0.8, v => { if (v > 0) { z.spoke = v; commit(); } }));
      h.appendChild(lockField(z));
      h.insertAdjacentHTML("beforeend", `<p class="help">Keeps each other net's clearance (by its class), the edge clearance and the mounting holes clear. Pieces that reach nothing are removed.</p>`);
      h.appendChild(delBtn()); return;
    }
    if (s && s.kind === "via") {
      const v = S.board.vias[s.i]; if (!v) { S.sel = null; return renderInspector(); }
      h.innerHTML = `<div class="insp-title">Via</div>`;
      h.appendChild(field("X (mm)", v.x, n => { v.x = n; commit(); })); h.appendChild(field("Y (mm)", v.y, n => { v.y = n; commit(); }));
      h.appendChild(field("Drill (mm)", v.drill || R.viaDrill, n => { if (n > 0) { v.drill = n; commit(); } })); h.appendChild(field("Pad (mm)", v.pad || R.viaPad, n => { if (n > 0) { v.pad = n; commit(); } }));
      h.appendChild(lockField(v));
      if (S.model) { const nets = [""].concat([...new Set(S.model.pads.filter(p => p.net !== null).map(p => p.netName))].sort()); h.appendChild(field("Net (stitching)", v.net || "", n => { v.net = n || undefined; commit(); }, nets.map(n => [n, n || "from its tracks"]))); }
      h.appendChild(delBtn()); return;
    }
    if (s && s.kind === "hole") {
      const hl = S.board.holes[s.i]; if (!hl) { S.sel = null; return renderInspector(); }
      h.innerHTML = `<div class="insp-title">Mounting hole</div>`;
      h.appendChild(field("X (mm)", hl.x, n => { hl.x = n; commit(); })); h.appendChild(field("Y (mm)", hl.y, n => { hl.y = n; commit(); }));
      h.appendChild(field("Diameter (mm)", hl.d, n => { if (n > 0) { hl.d = n; commit(); } }));
      h.insertAdjacentHTML("beforeend", `<p class="help">Not plated. The dashed ring is the copper clearance.</p>`);
      h.appendChild(lockField(hl)); h.appendChild(delBtn()); return;
    }
    if (s && s.kind === "text") {
      const t = S.board.texts[s.i]; if (!t) { S.sel = null; return renderInspector(); }
      h.innerHTML = `<div class="insp-title">Text</div>`;
      h.appendChild(field("Text", t.text, v => { if (v) { t.text = v; commit(); } }, "text"));
      h.appendChild(field("Height (mm)", t.size, v => { if (v > 0.3) { t.size = v; commit(); } }));
      h.appendChild(field("Layer", t.layer, v => { t.layer = v; commit(); }, [["F.SilkS", "Top silkscreen"], ["B.SilkS", "Bottom silkscreen (mirrored)"], ["F.Cu", "Top copper"], ["B.Cu", "Bottom copper (mirrored)"]]));
      h.appendChild(field("Rotation", t.rot || 0, v => { t.rot = +v; commit(); }, [["0", "0°"], ["1", "90°"], ["2", "180°"], ["3", "270°"]]));
      h.appendChild(lockField(t)); h.appendChild(delBtn()); return;
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
    if (M) {
      const gp = document.createElement("button"); gp.className = "btn"; gp.style.marginTop = "6px";
      gp.textContent = `+ ${defaultNet()} plane (bottom)`;
      gp.title = "A copper pour of the ground net over the whole bottom layer, with clearance to everything else and thermal reliefs on its pads";
      gp.onclick = () => groundPlane("B.Cu"); h.appendChild(gp);
    }
  }

  // ---------------------------------------------------------------------------
  // Design rules window: rules, checks, net classes; edited on a copy, Apply commits
  // ---------------------------------------------------------------------------
  let draft = null;
  const CHECK_NAMES = { clearance: "Clearance", short: "Shorts", edge: "Board edge", unplaced: "Parts not placed", annular: "Annular rings", drill: "Minimum drill", width: "Minimum track width", class: "Track width of the net class",
    current: "Track width for the current", courtyard: "Parts overlapping", keepout: "Keep-out areas", silk: "Silkscreen over pads", dangling: "Unconnected track ends", pinout: "Pinouts to check" };
  function openRules() {
    draft = JSON.parse(JSON.stringify(S.board.rules));
    document.querySelectorAll("#rules-modal [data-r]").forEach(el => { el.value = draft[el.dataset.r]; el.classList.remove("invalid"); });
    $("rules-tent").checked = draft.tentVias !== false;
    $("rules-checks").innerHTML = Object.keys(CHECK_NAMES).map(k => `<label><input type="checkbox" data-c="${k}" ${draft.checks[k] !== false ? "checked" : ""}> ${CHECK_NAMES[k]}</label>`).join("");
    rulesNets();
    $("rules-modal").hidden = false;
  }
  function readRules() {
    let ok = true;
    document.querySelectorAll("#rules-modal [data-r]").forEach(el => { const v = parseFloat(String(el.value).replace(",", ".")), good = el.dataset.min !== undefined ? v >= +el.dataset.min : v > 0; if (!good) { el.classList.add("invalid"); ok = false; } else { el.classList.remove("invalid"); draft[el.dataset.r] = v; } });
    draft.tentVias = $("rules-tent").checked;
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
  // manufacturing outputs: ask first when the board is not finished
  function fabReady(what) {
    const off = S.drc.filter(d => d.kind === "unplaced").length, errs = errors(), todo = S.conn ? S.conn.unrouted : 0;
    if (!S.model) { msg("Open the Circuit CAD first: the board needs its parts"); return false; }
    const why = [off ? `${off} part${off > 1 ? "s are" : " is"} not on the board (left out)` : "", todo ? `${todo} connection${todo > 1 ? "s" : ""} not routed` : "", errs ? `${errs} rule violation${errs > 1 ? "s" : ""}` : ""].filter(Boolean);
    return !why.length || confirm(`${what}: the board is not finished —\n• ${why.join("\n• ")}\n\nExport anyway?`);
  }
  const fabMeta = () => ({ base: baseName(), title: (S.netlist && (S.netlist.title || S.netlist.docno)) || baseName(), version: appVersion() });
  function exportGerber() { if (!fabReady("Gerber files")) return; download(BoardFab.zip(BoardFab.fabFiles(S.board, S.model, S.fills, fabMeta())), baseName() + "-gerbers.zip", "application/zip"); }
  function exportPdf(kind) { if (!S.model) return; download(BoardFab.pdfPages(S.board, S.model, S.fills, kind, fabMeta()), baseName() + (kind === "toner" ? "-toner-transfer.pdf" : "-prints.pdf"), "application/pdf"); }
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
    canvas.addEventListener("dblclick", () => { if (S.route) finishRoute(); else if (S.poly) closePoly(); });
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
    $("rules-reset").onclick = () => { const nc = draft.netClass; draft = { ...B.defaultRules(), netClass: nc }; $("rules-tent").checked = true; document.querySelectorAll("#rules-modal [data-r]").forEach(el => { el.value = draft[el.dataset.r]; }); document.querySelectorAll("#rules-checks [data-c]").forEach(el => { el.checked = true; }); rulesNets(); };
    document.querySelectorAll("#rules-modal [data-r]").forEach(el => el.addEventListener("change", rulesNets));
    $("setup-apply").onclick = applySetup; $("setup-cancel").onclick = () => { $("setup-modal").hidden = true; };
    $("holes-corners").onclick = () => { const o = readOutline() || S.board.outline, d = +$("hole-d").value, inset = parseFloat($("hole-inset").value) || 5; setupHoles = B.cornerHoles(o, d, inset).map(h => ({ ...h, locked: true })); holesNow(); };
    $("holes-clear").onclick = () => { setupHoles = []; holesNow(); };
    $("btn-cad").onclick = () => ToolWindows.open("circuit_sandbox.html");
    $("btn-help").onclick = () => { $("help-modal").hidden = false; }; $("btn-help-close").onclick = () => { $("help-modal").hidden = true; };
    const menu = $("export-menu"), list = menu.querySelector(".menu-list");
    $("btn-export").onclick = e => { e.stopPropagation(); list.hidden = !list.hidden; };
    document.addEventListener("click", e => { if (!menu.contains(e.target)) list.hidden = true; });
    $("ex-svg").onclick = () => { list.hidden = true; download(svgDoc(["F.Cu", "B.Cu", "F.SilkS", "Edge.Cuts"], false), baseName() + "-board.svg", "image/svg+xml"); };
    $("ex-gerber").onclick = () => { list.hidden = true; exportGerber(); };
    $("ex-pdf").onclick = () => { list.hidden = true; exportPdf("print"); };
    $("ex-toner").onclick = () => { list.hidden = true; exportPdf("toner"); };
    document.querySelectorAll("[data-tab]").forEach(t => { t.onclick = () => { document.querySelectorAll("[data-tab]").forEach(x => x.classList.toggle("active", x === t)); $("parts").hidden = t.dataset.tab !== "parts"; $("nets").hidden = t.dataset.tab !== "nets"; }; });
    $("ex-json").onclick = () => { list.hidden = true; download(JSON.stringify(S.board, null, 1), baseName() + "-board.json", "application/json"); };
    renderPanels(); fit(); hello();
  }
  window.BoardApp = { state: S, analyse, commit, groundPlane, highlightNet, selectConnected, exportGerber, exportPdf, fabFiles: () => BoardFab.fabFiles(S.board, S.model, S.fills, fabMeta()), routeCheck, syncNow, fit, setTool, setLayer, undo, redo, svgDoc, openRules, openSetup, toWorld, toScreen: (x, y) => [x * S.view.scale + S.view.ox, y * S.view.scale + S.view.oy] };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
