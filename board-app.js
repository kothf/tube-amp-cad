/* =============================================================================
   BOARD DESIGN — the editor window. Gets the netlist from the Circuit CAD (which
   also keeps the board document with the circuit), places footprints, routes tracks
   on two copper layers, places vias, texts and mounting holes, measures, shows the
   ratsnest and the design-rule check; Board setup and Design rules dialogs; layers.
   Depends on: windows.js, panels.js, cad-components.js, board-core.js, board-route.js (Auto-route)
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
    netlist: null, raw: null, clr: null, board: B.newBoard(), model: null, conn: null, drc: [], hv: new Set(),
    view: { scale: 5, ox: 40, oy: 40 }, tool: "select", layer: "F.Cu", grid: 1.27, dim: 0.5,
    sel: null,              // { kind: "part", key } | { kind: "track" | "via" | "text" | "hole" | "zone" | "keepout", i } | { kind: "multi", parts, tracks, vias, texts, holes }
    fills: [],              // filled copper pours (BoardCore.fillZones), refilled on every change
    netHL: null,            // the highlighted net (Nets tab, ` key)
    poly: null,             // a pour outline being drawn: [[x, y]...]
    routeBad: null,         // while routing: where the next segment breaks the clearance
    route: null,            // { net, layer, pts: [[x, y]...], w, segs: [] }
    measure: null,          // { a: [x, y], b: [x, y] | null, sa, sb: what each end stuck to }
    snapHint: null,         // the measure tool: where the pointer sticks (snapPoint)
    gridStyle: "lines", axes: true,   // the screen grid (lines | dots | off) and the X / Y axes
    drag: null, hover: null, mouse: [0, 0], space: false,
    history: [], hIndex: -1,
    show: Object.fromEntries(LAYER_INFO.map(([k]) => [k, true])),
    cad: false, saved: true, linked: false, pendingSync: null
  };
  let canvas, ctx, dpr = 1, queued = false;
  // the grid style and the axes are this viewer's preference (kept in the browser)
  const VIEW_KEY = "tubecad_board_view";
  try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}"); if (["lines", "dots", "off"].includes(v.gridStyle)) S.gridStyle = v.gridStyle; if (typeof v.axes === "boolean") S.axes = v.axes; } catch (e) { /* no storage */ }
  const keepView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ gridStyle: S.gridStyle, axes: S.axes })); } catch (e) { /* no storage */ } };
  const snap = v => +(Math.round(v / S.grid) * S.grid).toFixed(4);
  // The board's origin is its bottom-left corner, X to the right and Y up, as in the Gerbers and
  // the drill file. The document keeps y down from the top edge; the user reads and types
  // showY(y), and the grid runs from the origin (snapY).
  const showY = y => +(S.board.outline.h - y).toFixed(4);
  const snapY = v => +(S.board.outline.h - snap(S.board.outline.h - v)).toFixed(4);
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
      // imported SPICE tubes of the circuit: their socket and pinout come with them
      if (window.SpiceModel && Array.isArray(m.netlist.tubes)) m.netlist.tubes.forEach(t => { try { SpiceModel.register(t); } catch (e) { /* a built-in of that name */ } });
      S.raw = m.netlist; S.netlist = B.withHeaters(S.raw, S.board.rules);
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
    if (S.raw) S.netlist = B.withHeaters(S.raw, S.board.rules);
    if (!S.netlist) { S.model = null; S.conn = null; S.drc = []; S.fills = []; return; }
    S.hv = B.hvNets(S.netlist.volts, S.board.rules.hvVolts);
    S.model = B.model(S.board, S.netlist);
    // names of earlier versions stored in the board (net classes, pours, vias) move to today's
    if (B.migrateNetNames(S.board, S.model)) save();
    // star grounding: the ground returns and the star point steer the ground's ratsnest
    S.gg = S.board.rules.ground === "star" ? B.groundGroups(S.board, S.model, S.netlist) : null;
    const star = S.gg && S.gg.star ? { pad: S.gg.star, groupOf: S.gg.groupOf } : null;
    const c0 = B.connectivity(S.board, S.model.pads, null, star);
    S.clr = B.clearanceRules(S.board, S.model, S.hv, S.netlist);
    S.sp = B.socketPads(S.board, S.model);
    if (!light) {
      // teardrops first: the pours keep clear of other nets' teardrops
      const tears = S.board.rules.teardrops !== false ? B.teardrops(S.board, c0, S.clr) : [];
      S.fills = ((S.board.zones || []).length ? B.fillZones(S.board, S.model, c0, S.hv, S.netlist, tears) : [])
        .concat(tears.map(t => ({ tear: true, zone: -1, layer: t.layer, net: t.net, ti: t.ti, pts: t.pts, ops: [{ pol: "D", t: "region", pts: t.pts }], links: [] })));
    }
    S.conn = S.fills.some(f => !f.tear) ? B.connectivity(S.board, S.model.pads, S.fills, star) : c0;
    S.amps = B.netCurrents(S.netlist);
    S.drc = B.drc(S.board, S.model, S.conn, S.hv, S.fills, S.netlist);
  }
  function checkSync() {
    if (!S.netlist) return;
    const parts = B.physicalParts(S.netlist), keys = new Set(parts.map(g => g.key));
    let add = parts.filter(g => !S.board.parts[g.key]).map(g => g.ref), del = Object.keys(S.board.parts).filter(k => !keys.has(k)).map(k => S.board.parts[k].ref);
    // the heater supplies and the star point come from the board's rules, not from the schematic: they follow at once
    const own = r => /^X[HG]\d+$/.test(r);
    if (add.concat(del).some(own)) {
      const r = B.sync(S.board, S.netlist, own); analyse(); save();
      const what = r => (/^XG/.test(r) ? "star ground point" : "heater supply");
      msg(r.added.length ? r.added.map(x => `${what(x)} ${x}`).join(", ") + " added below the board (Board ▾ → Design rules… sets it)" : r.removed.map(x => `${what(x)} ${x}`).join(", ") + " removed");
      add = add.filter(x => !own(x)); del = del.filter(x => !own(x));
    }
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
  function refresh() { analyse(); checkSync(); save(); render(); renderPanels(); sheetUi(); if (viewer && !$("view3d").hidden) { clearTimeout(v3Timer); v3Timer = setTimeout(() => build3D(false), 150); } }
  function commit(text) { pushHistory(); refresh(); if (text) msg(text); }
  function undo() { if (S.hIndex > 0) { S.hIndex--; restore(); } }
  function redo() { if (S.hIndex < S.history.length - 1) { S.hIndex++; restore(); } }
  // a board of another height: the screen keeps the origin (the bottom-left corner) still
  function restore() { const h0 = S.board.outline.h; S.board = JSON.parse(S.history[S.hIndex]); S.view.oy += (h0 - S.board.outline.h) * S.view.scale; S.sel = null; S.measure = null; refresh(); }
  // A new board height keeps the origin where it is: everything on the board (and a locked
  // sheet) moves down by the change in the document, so only the top edge moves.
  function setHeight(h) {
    const b = S.board, dh = +(h - b.outline.h).toFixed(4); if (!dh) return;
    const mv = o => { if (Number.isFinite(o.y)) o.y = +(o.y + dh).toFixed(4); }, mp = p => { p[1] = +(p[1] + dh).toFixed(4); };
    Object.values(b.parts).forEach(mv); b.vias.forEach(mv); b.holes.forEach(mv); b.texts.forEach(mv);
    b.tracks.forEach(t => t.pts.forEach(mp)); b.zones.forEach(z => z.pts && z.pts.forEach(mp)); b.keepouts.forEach(k => k.pts.forEach(mp));
    if (b.sheet && b.sheet.locked && Number.isFinite(b.sheet.y)) b.sheet.y = +(b.sheet.y + dh).toFixed(4);
    b.outline.h = h; S.view.oy -= dh * S.view.scale; S.measure = null;
  }

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
  // the "+" in the middle of each edge of the selected area: dragging it adds a corner there
  function hitAreaMid(x, y) {
    if (!S.sel || !AREAS[S.sel.kind]) return -1;
    const a = S.board[AREAS[S.sel.kind]][S.sel.i]; if (!a || !a.pts) return -1;
    const P = a.pts;
    return P.findIndex((p, k) => { const q = P[(k + 1) % P.length]; return Math.hypot((p[0] + q[0]) / 2 - x, (p[1] + q[1]) / 2 - y) <= 6 / S.view.scale; });
  }
  // a corner of the selected area removed (an area keeps three at least)
  function dropCorner(k) {
    const a = S.board[AREAS[S.sel.kind]][S.sel.i];
    if (a.locked) { lockedNote(); return; }
    if (a.pts.length <= 3) { msg("An area keeps three corners at least"); return; }
    a.pts.splice(k, 1); commit(`Corner removed: ${a.pts.length} left`);
  }
  // a pour's outline over the whole board: a rectangle (the pour is cut to the outline, round corners and edge clearance included)
  function boardShape() { const o = S.board.outline; return [[0, 0], [o.w, 0], [o.w, o.h], [0, o.h]]; }
  // the convex hull round the given parts' courtyards, m mm out (a pour round them)
  function hullAround(keys, m) {
    const pts = [];
    S.model.parts.forEach(g => { if (!g.place || !keys.includes(g.key)) return; const b = B.partBox(g); [[b.x1 - m, b.y1 - m], [b.x2 + m, b.y1 - m], [b.x2 + m, b.y2 + m], [b.x1 - m, b.y2 + m]].forEach(p => pts.push([snap(p[0]), snapY(p[1])])); });
    if (pts.length < 3) return null;
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
    pts.forEach(p => { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    pts.slice().reverse().forEach(p => { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); });
    const h = lo.slice(0, -1).concat(hi.slice(0, -1));
    return h.length >= 3 ? h : null;
  }
  const onBoardKeys = () => { const o = S.board.outline; return S.model ? S.model.parts.filter(g => g.place && g.place.x >= 0 && g.place.x <= o.w && g.place.y >= 0 && g.place.y <= o.h).map(g => g.key) : []; };
  function pourAround(keys) {
    const P = hullAround(keys, 2); if (!P) { msg("No parts on the board to pour round"); return null; }
    return P;
  }
  // refill the pours while a corner or the whole area is dragged (at most every 120 ms)
  let liveT = 0;
  function liveFill() { const t = performance.now(); if (t - liveT < 120) return; analyse(); liveT = performance.now(); }
  // the selected area's handles: squares on the corners, a "+" in the middle of each edge
  function areaHandles(P, px) {
    ctx.fillStyle = "#00e5ff"; P.forEach(p => ctx.fillRect(p[0] - 3.5 * px, p[1] - 3.5 * px, 7 * px, 7 * px));
    ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = Math.max(0.05, 1.2 * px);
    P.forEach((p, k) => {
      const q = P[(k + 1) % P.length], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) * S.view.scale < 24) return;
      ctx.fillStyle = "rgba(10,14,20,0.85)"; ctx.beginPath(); ctx.arc(mx, my, 4.5 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx - 2.5 * px, my); ctx.lineTo(mx + 2.5 * px, my); ctx.moveTo(mx, my - 2.5 * px); ctx.lineTo(mx, my + 2.5 * px); ctx.stroke();
    });
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
  const holeR = h => (h.plated ? B.holeRing(h) : h.d) / 2;
  const hitHole = (x, y) => (S.show.Holes ? S.board.holes.findIndex(h => Math.hypot(h.x - x, h.y - y) <= holeR(h) + 0.6) : -1);
  function textBox(t) { const w = Math.max(t.size, B.strokeText(t.text, 0, 0, t.size).width), h = t.size; return (t.rot & 1) ? { x1: t.x - h / 2, y1: t.y - w / 2, x2: t.x + h / 2, y2: t.y + w / 2 } : { x1: t.x - w / 2, y1: t.y - h / 2, x2: t.x + w / 2, y2: t.y + h / 2 }; }
  const hitText = (x, y) => S.board.texts.findIndex(t => { if (!S.show[t.layer]) return false; const b = textBox(t); return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2; });
  // the board's edge (outside the handle): dragging it moves the board on the drawing sheet. It is
  // grabbed on the line and up to 8 px outside; a pour's outline (0.5 mm in) is picked further in
  const onEdge = (x, y) => { const d = B.edgeDist(x, y, S.board.outline) * S.view.scale; return S.show["Edge.Cuts"] && !!sheetPlace() && d >= -8 && d <= 2; };
  // the board's resize handle: its top-right corner (the origin, bottom left, stays put)
  const onHandle = (x, y) => { const o = S.board.outline, t = 6 / S.view.scale; return S.show["Edge.Cuts"] && Math.abs(x - o.w) <= t && Math.abs(y) <= t; };
  function netAt(x, y) {
    const p = hitPad(x, y); if (p) return { net: p.net, pad: p };
    const vi = hitVia(x, y); if (vi >= 0 && S.conn) { const it = S.conn.items.find(it => it.kind === "via" && it.vi === vi); if (it && it.net !== null && it.net !== "short") { const v = S.board.vias[vi]; return { net: it.net, at: [v.x, v.y] }; } }
    const h = hitSeg(x, y); if (h && S.conn) { const it = S.conn.items.find(it => it.kind === "track" && it.ti === h.i); if (it && it.net !== null && it.net !== "short") return { net: it.net, track: h.i, at: onTrack(h.i, x, y) }; }
    return null;
  }
  // the point of track ti a route joins at: a corner or end within 8 px; else where a straight or
  // 45° line from the route's last corner (from) meets it near the pointer; else the nearest point
  // of its centre line (so the new copper really touches it, on or off the grid)
  function onTrack(ti, x, y, from) {
    const t = S.board.tracks[ti], tol = 8 / S.view.scale;
    let best = null, bd = Infinity;
    t.pts.forEach(p => { const d = Math.hypot(p[0] - x, p[1] - y); if (d <= tol && d < bd) { bd = d; best = p.slice(); } });
    if (best) return best;
    if (from) {
      const reach = Math.max(tol, S.grid * 1.5);
      for (let k = 0; k + 1 < t.pts.length; k++) {
        const [a, b] = [t.pts[k], t.pts[k + 1]], ex = b[0] - a[0], ey = b[1] - a[1];
        [[1, 0], [0, 1], [1, 1], [1, -1]].forEach(([ux, uy]) => {
          const den = ux * ey - uy * ex; if (Math.abs(den) < 1e-9) return;
          const u = ((from[0] - a[0]) * uy - (from[1] - a[1]) * ux) / -den;   // along the track segment
          if (u < -1e-9 || u > 1 + 1e-9) return;
          const q = [a[0] + u * ex, a[1] + u * ey], d = Math.hypot(q[0] - x, q[1] - y);
          if (d <= reach && d < bd) { bd = d; best = [+q[0].toFixed(4), +q[1].toFixed(4)]; }
        });
      }
      if (best) return best;
    }
    for (let k = 0; k + 1 < t.pts.length; k++) {
      const [a, b] = [t.pts[k], t.pts[k + 1]], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      const u = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0, q = [a[0] + u * dx, a[1] + u * dy], d = Math.hypot(q[0] - x, q[1] - y);
      if (d < bd) { bd = d; best = [+q[0].toFixed(4), +q[1].toFixed(4)]; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Routing: from a pad, 45° bends (straight first, then the diagonal), V changes layer with a via
  // ---------------------------------------------------------------------------
  // alt: the diagonal first, then straight
  function bend(a, b, alt) {
    const dx = b[0] - a[0], dy = b[1] - a[1], ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 1e-6 || ay < 1e-6 || Math.abs(ax - ay) < 1e-6) return [b];
    const d = Math.min(ax, ay);
    if (alt) return [[a[0] + Math.sign(dx) * d, a[1] + Math.sign(dy) * d], b];
    return [ax > ay ? [b[0] - Math.sign(dx) * d, a[1]] : [a[0], b[1] - Math.sign(dy) * d], b];
  }
  // the segments from the last corner to the pointer: straight first (or the diagonal first after
  // /), and the other way round by itself when only that one keeps the clearance
  function routeTail() {
    const r = S.route, last = r.pts[r.pts.length - 1], t = routeTarget();
    const a = [last].concat(bend(last, t.p, r.flip)), badA = tailCheck(a);
    if (!badA) return { pts: a, t, bad: null };
    const b = [last].concat(bend(last, t.p, !r.flip)), badB = tailCheck(b);
    return badB ? { pts: a, t, bad: badA } : { pts: b, t, bad: null };
  }
  // the clearance of the segments to the pointer against other nets' copper, holes and the edge
  function routeCheck() { return S.route && S.conn ? routeTail().bad : null; }
  function tailCheck(pts) {
    const r = S.route, R = S.board.rules, mine = B.classRule(classOf(r.net), R).clearance, w2 = r.w / 2;
    for (let k = 0; k + 1 < pts.length; k++) {
      const s = [pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]];
      for (const it of S.conn.items) {
        if (!it.layers.includes(r.layer) || (it.net === r.net && r.net !== null)) continue;
        if (it.kind === "via" && (r.vias || []).includes(it.vi)) continue;   // the route's own via: not joined to its net until the route ends
        let need = Math.max(mine, B.classRule(classOf(it.net), R).clearance, S.clr ? S.clr.need(r.net, it.net).c : 0); const g = B.segSeg(s, it.s) - w2 - it.r;
        if (g < need - 1e-6 && it.kind === "pad") { const eg = B.entryGap(s, it, S.conn.items); if (eg !== null) need = Math.min(need, eg - 0.02); }
        if (g < need - 1e-6 && it.kind === "pad" && S.sp) { const us = B.underSocket(S.sp, it, { s }); if (us !== null) need = Math.min(need, us); }
        if (g < need - 1e-6 && it.kind === "track" && B.anchoredOk({ s, r: w2 }, it, g, need, S.conn.items)) continue;
        if (g < need - 1e-6) { const [x, y] = it.kind === "pad" ? [it.pad.x, it.pad.y] : [(it.s[0] + it.s[2]) / 2, (it.s[1] + it.s[3]) / 2]; return { x, y, g, need, what: it.kind === "pad" ? `${it.pad.ref}-${it.pad.num}` : it.kind === "via" ? "a via" : "a track", net: netName(it.net) }; }
      }
      for (const ko of S.board.keepouts) if (ko.tracks !== false && B.koLayers(ko).includes(r.layer) && B.segInPoly(s, ko.pts, w2)) return { x: s[2], y: s[3], g: 0, need: 0, what: ko.name ? `keep-out "${ko.name}"` : "a keep-out area", net: "", ko: true };
      const hn = Math.max(mine, S.clr ? S.clr.toChassis(r.net).c : 0);
      for (const h of S.board.holes) { if (h.plated) continue; const g = B.segDist(s[0], s[1], s[2], s[3], h.x, h.y) - w2 - h.d / 2; if (g < hn - 1e-6) return { x: h.x, y: h.y, g, need: hn, what: "a mounting hole", net: "" }; }
    }
    return null;
  }
  // where the route goes next: { p, end: the click finishes it there, what }.
  // A pad's centre; the net's own via or track (a corner, else onto its centre line) on this
  // layer; else the grid, lined up with the last corner and with the net's pads and vias when
  // within half a grid step, so tracks run straight into pads that are off the grid.
  function routeTarget() {
    const [x, y] = S.mouse, r = S.route, p = hitPad(x, y);
    if (p) return { p: [p.x, p.y], end: true, what: `${p.ref}-${p.num}` };
    if (r && S.conn) {
      // on the first corner, copper already joined to where the route began is a corner, not the end
      // (ending there would join nothing); later it ends the route (a loop back onto the net)
      const home = r.pts.length === 1 ? routeHome() : null;
      const vi = hitVia(x, y), vit = vi >= 0 && S.conn.items.find(it => it.kind === "via" && it.vi === vi);
      if (vit && vit.net === r.net && vit.cluster !== home) { const v = S.board.vias[vi]; return { p: [v.x, v.y], end: true, what: "via" }; }
      const h = hitSeg(x, y), tit = h && S.board.tracks[h.i].layer === r.layer && S.conn.items.find(it => it.kind === "track" && it.ti === h.i);
      if (tit && tit.net === r.net && tit.cluster !== home && !(r.pts.length === 1 && h.i === r.from)) return { p: onTrack(h.i, x, y, r.pts[r.pts.length - 1]), end: true, what: "track" };
    }
    let gx = snap(x), gy = snapY(y);
    if (r) {
      const half = S.grid / 2 + 1e-6, last = r.pts[r.pts.length - 1];
      const xs = [last[0]], ys = [last[1]];
      if (S.model) S.model.pads.forEach(q => { if (q.net === r.net) { xs.push(q.x); ys.push(q.y); } });
      S.board.vias.forEach(v => { xs.push(v.x); ys.push(v.y); });
      const near = (v, list, raw) => { let b = v, bd = half; list.forEach(c => { const d = Math.abs(c - raw); if (d < bd) { bd = d; b = c; } }); return b; };
      gx = near(gx, xs, x); gy = near(gy, ys, y);
    }
    return { p: [gx, gy], end: false, what: "grid" };
  }
  // the copper cluster the route starts from: the pad, via or track under its first point
  function routeHome() {
    const r = S.route, [x, y] = r.pts[0], its = S.conn.items;
    const it = its.find(it => it.kind === "pad" && Math.hypot(it.pad.x - x, it.pad.y - y) < 1e-6) || its.find(it => it.kind === "via" && Math.hypot(it.s[0] - x, it.s[1] - y) < 1e-6)
      || its.find(it => it.kind === "track" && it.layers.includes(r.layer) && B.segDist(it.s[0], it.s[1], it.s[2], it.s[3], x, y) < 1e-4);
    return it ? it.cluster : null;
  }
  function startRoute(x, y) {
    const at = netAt(x, y);
    if (!at) { msg("Start a track on a pad (or on a routed track)"); return; }
    const start = at.pad ? [at.pad.x, at.pad.y] : at.at;
    // the class width, or wider when the net's DC current asks for it (IPC-2221)
    const I = (S.amps || {})[at.net], wI = Math.ceil(B.currentWidth(I, S.board.rules, S.board.stackup) * 20) / 20;
    S.route = { net: at.net, layer: S.layer, w: Math.max(trackWidth(at.net), wI), pts: [start], segs: [], from: at.track, flip: false };
    msg(`Routing ${netName(at.net)} (${classOf(at.net)}${I ? `, ${B.fmtA(I)}` : ""}, ${S.route.w} mm) on ${S.layer}: click corners, end on a pad, track or via of the same net; /: diagonal first, V: via, Backspace: undo a corner, Esc: stop`);
    render();
  }
  function routeClick(e) {
    const r = S.route, tail = routeTail(), tgt = tail.t.p, last = r.pts[r.pts.length - 1], bad = tail.bad;
    if (bad && bad.ko && !(e && e.shiftKey)) { msg(`Not through ${bad.what}: route around it, or Shift+click to place it anyway`); return; }
    if (bad && !(e && e.shiftKey)) { msg(`Too close to ${bad.what}${bad.net ? " on " + bad.net : ""}: ${Math.max(0, bad.g).toFixed(2)} mm < ${bad.need} mm. Choose another way, or Shift+click to place it anyway`); return; }
    if (Math.hypot(tgt[0] - last[0], tgt[1] - last[1]) < 1e-6) { finishRoute(); return; }
    tail.pts.slice(1).forEach(p => r.pts.push(p));
    const p = hitPad(tgt[0], tgt[1]);
    if (p && r.pts.length > 1) {
      if (p.net !== r.net) msg(`${p.ref}-${p.num} is on ${netName(p.net)}, not ${netName(r.net)}: the check will report a short`);
      finishRoute(); return;
    }
    if (tail.t.end && r.pts.length > 1) { finishRoute(); msg(`Joined the ${tail.t.what} of ${netName(r.net)}`); return; }
    render();
  }
  function routeVia() {
    const r = S.route, last = r.pts[r.pts.length - 1];
    if (r.pts.length > 1) r.segs.push({ layer: r.layer, w: r.w, pts: r.pts.slice() });
    S.board.vias.push({ x: last[0], y: last[1], drill: S.board.rules.viaDrill, pad: S.board.rules.viaPad, net: storedNet(r.net) });
    r.layer = r.layer === "F.Cu" ? "B.Cu" : "F.Cu"; r.pts = [last]; r.via = S.board.vias.length - 1; (r.vias = r.vias || []).push(r.via);
    setLayer(r.layer); analyse(); render();
  }
  function finishRoute() {
    const r = S.route; if (!r) return;
    // stopped right after a via (V, then Esc): the via goes too, unless it already joins copper
    // or a pour on the new layer (a via down to the ground plane stays)
    const vi = r.pts.length === 1 && r.via === S.board.vias.length - 1 ? r.via : -1;
    const joins = vi >= 0 && S.conn && (() => { const k = S.conn.items.findIndex(it => it.kind === "via" && it.vi === vi), v = S.conn.items[k];
      return !v || S.conn.items.some(it => it !== v && it.layers.includes(r.layer) && B.segSeg(it.s, v.s) <= it.r + v.r + 1e-6) || (S.fills || []).some(f => f.layer === r.layer && f.links.some(l => l.includes(k))); })();
    if (vi >= 0 && !joins) S.board.vias.pop();
    if (r.pts.length > 1) r.segs.push({ layer: r.layer, w: r.w, pts: r.pts });
    S.route = null;
    if (!r.segs.length) { if (vi >= 0) { if (joins) commit(); else analyse(); } render(); return; }
    r.segs.forEach(t => { const pts = tidy(t.pts); if (pts.length > 1) S.board.tracks.push({ layer: t.layer, w: +t.w.toFixed(3), pts, net: storedNet(r.net) }); });
    commit();
  }

  // ---------------------------------------------------------------------------
  // Tools: select, route, via, text, mounting hole, measure
  // ---------------------------------------------------------------------------
  const TOOL_HELP = { select: "Select: drag parts, vias, texts and holes; drag the board's top-right corner handle to resize it (the origin, bottom left, stays put)", route: "Route: click a pad to start a track",
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
  // Measure sticks to what is on the board: the centres of pads, vias and holes, track corners
  // and ends, the board's corners, edge middles and centre, area corners, texts and part
  // origins; failing those, onto a track's centre line, a hole's rim or the board edge; else
  // the grid. Shift (or Alt): the grid only. Returns { p: [x, y], what, shape: centre | corner | on | grid }
  const SNAP_PX = 10;
  function snapPoint(x, y, gridOnly) {
    const grid = { p: [snap(x), snapY(y)], what: "grid", shape: "grid" };
    if (gridOnly) return grid;
    const tol = SNAP_PX / S.view.scale, o = S.board.outline, copper = S.show["F.Cu"] || S.show["B.Cu"];
    let best = null, bd = tol;
    const at = (px, py, what, shape) => { const d = Math.hypot(px - x, py - y); if (d <= bd) { bd = d; best = { p: [+px.toFixed(4), +py.toFixed(4)], what, shape }; } };
    if (S.model && copper) S.model.pads.forEach(p => at(p.x, p.y, `pad ${p.ref}-${p.num}`, "centre"));
    if (copper) S.board.vias.forEach(v => at(v.x, v.y, "via", "centre"));
    if (S.show.Holes) S.board.holes.forEach(h => at(h.x, h.y, `hole Ø${h.d}`, "centre"));
    S.board.tracks.forEach(t => { if (S.show[t.layer]) t.pts.forEach((p, k) => at(p[0], p[1], k && k < t.pts.length - 1 ? "track corner" : "track end", "corner")); });
    if (S.show["Edge.Cuts"]) {
      [[0, 0], [o.w, 0], [0, o.h], [o.w, o.h]].forEach(p => at(p[0], p[1], "board corner", "corner"));
      [[o.w / 2, 0], [o.w / 2, o.h], [0, o.h / 2], [o.w, o.h / 2]].forEach(p => at(p[0], p[1], "middle of the board edge", "corner"));
      at(o.w / 2, o.h / 2, "board centre", "centre");
    }
    if (S.show.zones) S.board.zones.forEach(z => { if (z.pts && S.show[z.layer]) z.pts.forEach(p => at(p[0], p[1], "pour corner", "corner")); });
    if (S.show.keepouts) S.board.keepouts.forEach(k => k.pts.forEach(p => at(p[0], p[1], "keep-out corner", "corner")));
    S.board.texts.forEach(t => { if (S.show[t.layer]) at(t.x, t.y, `text "${t.text}"`, "centre"); });
    if (S.model) S.model.parts.forEach(g => { if (g.place) at(g.place.x, g.place.y, `${g.ref} origin`, "centre"); });
    if (best) return best;
    const pad = S.model && copper && hitPad(x, y);
    if (pad) return { p: [pad.x, pad.y], what: `pad ${pad.ref}-${pad.num}`, shape: "centre" };
    // onto a line: the nearest point of a track's centre line, a hole's rim or the board edge
    const on = (ax, ay, bx, by, what) => {
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; if (!L) return;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)); at(ax + t * dx, ay + t * dy, what, "on");
    };
    S.board.tracks.forEach(t => { if (S.show[t.layer]) for (let k = 0; k + 1 < t.pts.length; k++) on(t.pts[k][0], t.pts[k][1], t.pts[k + 1][0], t.pts[k + 1][1], "on a track"); });
    if (S.show.Holes) S.board.holes.forEach(h => { const d = Math.hypot(x - h.x, y - h.y); if (d > 1e-9) at(h.x + (x - h.x) / d * h.d / 2, h.y + (y - h.y) / d * h.d / 2, "hole rim", "on"); });
    if (S.show["Edge.Cuts"]) [[0, 0, o.w, 0], [o.w, 0, o.w, o.h], [o.w, o.h, 0, o.h], [0, o.h, 0, 0]].forEach(([a, b, c, d]) => on(a, b, c, d, "board edge"));
    return best || grid;
  }
  function placeAt(x, y) {
    const sx = snap(x), sy = snapY(y), R = S.board.rules;
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
    S.board.zones.push({ net: defaultNet(), layer: layer || "B.Cu", pts: boardShape(), thermal: true, gap: 0.5, spoke: 0.8 });
    S.sel = { kind: "zone", i: S.board.zones.length - 1 };
    commit(`${defaultNet()} pour over the whole ${layer === "F.Cu" ? "top" : "bottom"} layer: drag its corners, or the + on an edge for a new corner`);
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
  // Comfort: zoom, the card at the pointer, the route's width, the right-click menu
  // ---------------------------------------------------------------------------
  // the side panels hidden (\\): more room for the board
  function setBare(on) {
    S.bare = on; document.querySelector("main").classList.toggle("bare", on); $("btn-panels").classList.toggle("active", !on);
    window.dispatchEvent(new Event("resize")); msg(on ? "Side panels hidden (\\ or View ▾ brings them back)" : "Side panels shown");
  }
  function zoomAt(f, sx, sy) {
    if (sx === undefined) { sx = canvas.clientWidth / 2; sy = canvas.clientHeight / 2; }
    const s = Math.max(0.5, Math.min(80, S.view.scale * f)), k = s / S.view.scale;
    S.view.ox = sx - (sx - S.view.ox) * k; S.view.oy = sy - (sy - S.view.oy) * k; S.view.scale = s; render();
  }
  // the selection's extent, else the highlighted net's pads
  function zoomToSel() {
    const bx = []; const add = (x1, y1, x2, y2) => bx.push([x1, y1, x2, y2]);
    selItems().forEach(([k, id]) => {
      if (k === "part") { const g = S.model && S.model.parts.find(x => x.key === id); if (g && g.place) { const b = partBox(g); add(b.x1, b.y1, b.x2, b.y2); } }
      else { const o = objOf(k, id); if (!o) return; if (o.pts) o.pts.forEach(p => add(p[0], p[1], p[0], p[1])); else add(o.x - 2, o.y - 2, o.x + 2, o.y + 2); }
    });
    if (S.sel && AREAS[S.sel.kind]) { const a = S.board[AREAS[S.sel.kind]][S.sel.i]; if (a) areaPoly(S.sel.kind, a).forEach(p => add(p[0], p[1], p[0], p[1])); }
    if (!bx.length && S.netHL !== null && S.model) S.model.pads.filter(p => p.net === S.netHL).forEach(p => add(p.x - p.w, p.y - p.h, p.x + p.w, p.y + p.h));
    if (!bx.length) { fit(); return; }
    const x1 = Math.min(...bx.map(b => b[0])) - 4, y1 = Math.min(...bx.map(b => b[1])) - 4, x2 = Math.max(...bx.map(b => b[2])) + 4, y2 = Math.max(...bx.map(b => b[3])) + 4;
    const W = canvas.clientWidth, H = canvas.clientHeight, sc = Math.max(0.5, Math.min(40, W / (x2 - x1), H / (y2 - y1)));
    S.view.scale = sc; S.view.ox = W / 2 - (x1 + x2) / 2 * sc; S.view.oy = H / 2 - (y1 + y2) / 2 * sc; render();
  }
  // While routing: W steps through the useful widths (the class's, signal, power, the minimum, what the
  // current asks); the corners placed so far keep the old width
  function routeWidth() {
    const r = S.route, R = S.board.rules, need = Math.ceil(B.currentWidth((S.amps || {})[r.net], R, S.board.stackup) * 20) / 20;
    const opts = [...new Set([trackWidth(r.net), R.track, R.power, R.minTrack, need].filter(v => v >= R.minTrack - 1e-9).map(v => +(+v).toFixed(2)))].sort((a, b) => a - b);
    const w = opts[(opts.indexOf(+r.w.toFixed(2)) + 1) % opts.length];
    if (r.pts.length > 1) { r.segs.push({ layer: r.layer, w: r.w, pts: r.pts.slice() }); r.pts = [r.pts[r.pts.length - 1]]; }
    r.w = w; S.routeBad = routeCheck();
    msg(`Track width ${w} mm${w < need - 1e-9 ? ` (narrower than the ${need} mm its ${B.fmtA((S.amps || {})[r.net])} asks)` : ""} · W: next width (${opts.join(" / ")} mm)`); render(); hudNow();
  }
  // the card at the pointer: what is under it (after a short rest), or the route being drawn
  let hudTimer = 0, hudAt = null;
  const fmtV = v => (v === undefined || v === null ? "" : `${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)} V`);
  function hudText(x, y) {
    if (S.route) {
      const r = S.route, pts = r.pts.concat([[S.mouse[0], S.mouse[1]]]); let len = 0;
      r.segs.forEach(t => { for (let k = 1; k < t.pts.length; k++) len += Math.hypot(t.pts[k][0] - t.pts[k - 1][0], t.pts[k][1] - t.pts[k - 1][1]); });
      for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      const bad = S.routeBad;
      return `<b>${esc(netName(r.net))}</b> · ${r.w} mm · ${r.layer === "F.Cu" ? "top" : "bottom"} · ${len.toFixed(1)} mm` + (bad ? `<br><span class="bad">too close to ${esc(bad.what)}: ${Math.max(0, bad.g).toFixed(2)} &lt; ${bad.need} mm</span>` : "") +
        `<br><span class="mut">W width · V via · / bend · ⌫ corner · Esc end</span>`;
    }
    if (S.tool !== "select" || S.drag || !S.model) return "";
    const volts = (S.netlist && S.netlist.volts) || {}, p = hitPad(x, y);
    const netLine = n => { const I = (S.amps || {})[n]; return `${esc(netName(n))} <span class="mut">${classOf(n)}${volts[n] !== undefined ? " · " + fmtV(volts[n]) : ""}${I ? " · " + B.fmtA(I) : ""}</span>`; };
    if (p) return `<b>${esc(p.ref)}-${esc(p.num)}</b>${p.name !== p.num ? " " + esc(p.name) : ""} · ${p.net === null ? "<span class='mut'>no net</span>" : netLine(p.net)}`;
    const vi = hitVia(x, y); if (vi >= 0) { const it = S.conn && S.conn.items.find(q => q.kind === "via" && q.vi === vi); return `<b>Via</b> · ${it && it.net !== null ? netLine(it.net) : "<span class='mut'>no net</span>"}`; }
    const h = hitSeg(x, y); if (h) { const t = S.board.tracks[h.i], n = netOfTrack(h.i); return `<b>Track</b> ${t.w} mm · ${t.layer === "F.Cu" ? "top" : "bottom"} · ${n === null ? "<span class='mut'>no net</span>" : netLine(n)}`; }
    const g = hitPart(x, y);
    if (g) { const gr = S.gg && S.gg.byPart.get(g.key); return `<b>${esc(g.ref)}</b> ${esc(g.value || "")} <span class="mut">· ${esc(g.fp.name)}${g.place.side === "B" ? " · bottom" : ""}${g.place.locked ? " · locked" : ""}${gr ? " · ground: " + esc(gr.group) : ""}</span>`; }
    return "";
  }
  function placeHud(el) {
    const st = $("stage").getBoundingClientRect(), [mx, my] = hudAt || [0, 0], w = el.offsetWidth, h = el.offsetHeight;
    let left = mx - st.left + 16, top = my - st.top + 18;
    if (left + w > st.width - 6) left = mx - st.left - w - 12;
    if (top + h > st.height - 6) top = my - st.top - h - 12;
    el.style.left = Math.max(4, left) + "px"; el.style.top = Math.max(4, top) + "px";
  }
  function hudNow() { const el = $("hud"); if (!hudAt) { el.hidden = true; return; } const [x, y] = S.mouse, t = hudText(x, y); el.hidden = !t; if (t) { el.innerHTML = t; placeHud(el); } }
  function hudMove(e) {
    const el = $("hud"); clearTimeout(hudTimer);
    if (e.target !== canvas || !$("ctx").hidden) { hudAt = null; el.hidden = true; return; }
    hudAt = [e.clientX, e.clientY];
    if (S.route) { hudNow(); return; }
    el.hidden = true; hudTimer = setTimeout(hudNow, 380);
  }

  // the right-click menu: what can be done with the thing under the pointer
  function closeCtx() { $("ctx").hidden = true; }
  function openCtx(cx, cy, x, y) {
    const items = [], it = (label, key, fn, dis) => items.push({ label, key, fn, dis }), sep = () => items.push(null);
    let title = "";
    const p = hitPad(x, y), vi = hitVia(x, y), hi = hitHole(x, y), ti = hitText(x, y), seg = hitSeg(x, y), g = hitPart(x, y), ar = hitArea(x, y);
    if (vi >= 0 || hi >= 0 || ti >= 0) {
      const kind = vi >= 0 ? "via" : hi >= 0 ? "hole" : "text", i = vi >= 0 ? vi : hi >= 0 ? hi : ti, o = objOf(kind, i);
      S.sel = { kind, i }; title = { via: "Via", hole: "Mounting hole", text: `Text "${o.text}"` }[kind];
      if (kind === "text") it("Turn 90°", "R", rotateSel);
      it(o.locked ? "Unlock" : "Lock", "L", lockSel); sep(); it("Delete", "Del", deleteSel);
    } else if (seg) {
      const t = S.board.tracks[seg.i], n = netOfTrack(seg.i), R = S.board.rules; S.sel = { kind: "track", i: seg.i };
      title = `Track · ${netName(n)} · ${t.w} mm`;
      it("Select the whole track", "U", selectConnected);
      [[R.track, "signal"], [R.power, "power"], [R.minTrack, "minimum"]].filter(([w]) => w !== t.w).forEach(([w, nm]) => it(`Width ${w} mm (${nm})`, "", () => { if (t.locked) return lockedNote(); t.w = w; commit(`Track ${w} mm`); }));
      it(`Move to the ${t.layer === "F.Cu" ? "bottom" : "top"} layer`, "", () => { if (t.locked) return lockedNote(); t.layer = t.layer === "F.Cu" ? "B.Cu" : "F.Cu"; commit(`Track moved to ${t.layer}`); });
      if (n !== null && n !== "short") it(`Highlight ${netName(n)}`, "`", () => highlightNet(n));
      it(t.locked ? "Unlock" : "Lock", "L", lockSel); sep(); it("Delete", "Del", deleteSel);
    } else if (g) {
      selectPart(g); const bp = S.board.parts[g.key];
      title = `${g.ref} · ${g.value || g.fp.name}`;
      if (p) {
        it(`Route from ${p.ref}-${p.num}`, "X", () => { setTool("route"); startRoute(p.x, p.y); });
        if (p.net !== null) it(`Highlight ${netName(p.net)}`, "`", () => highlightNet(p.net));
        sep();
      }
      it("Turn 90°", "R", rotateSel); it(`Move to the ${(bp.side || "F") === "F" ? "bottom" : "top"} side`, "M", flipSel); it(bp.locked ? "Unlock" : "Lock", "L", lockSel);
      it("Zoom to it", "Z", zoomToSel);
    } else if (ar) {
      S.sel = { kind: ar.kind, i: ar.i }; const a = S.board[AREAS[ar.kind]][ar.i];
      title = ar.kind === "zone" ? `Copper pour · ${a.net}` : "Keep-out area";
      if (a.pts) it("Add a corner here", "", () => { if (a.locked) return lockedNote(); let best = 0, bd = Infinity; a.pts.forEach((q, k) => { const r = a.pts[(k + 1) % a.pts.length], d = B.segDist(q[0], q[1], r[0], r[1], x, y); if (d < bd) { bd = d; best = k; } }); a.pts.splice(best + 1, 0, [snap(x), snapY(y)]); commit(`Corner added: ${a.pts.length} corners`); });
      if (ar.kind === "zone") {
        it("Round the parts", "", () => { if (a.locked) return lockedNote(); const P = pourAround(onBoardKeys()); if (P) { a.pts = P; commit(`Pour round the parts: ${P.length} corners`); } });
        it("Over the whole board", "", () => { if (a.locked) return lockedNote(); a.pts = boardShape(); commit("Pour over the whole board"); });
      }
      it(a.locked ? "Unlock" : "Lock", "L", () => { a.locked = !a.locked; commit(a.locked ? "Locked" : "Unlocked"); }); sep(); it("Delete", "Del", deleteSel);
    } else {
      title = `x ${x.toFixed(1)}  y ${showY(y).toFixed(1)} mm`;
      const here = tool => () => { S.tool = tool; placeAt(snap(x), snapY(y)); setTool("select"); };
      it("Via here", "⇧V", here("via")); it("Mounting hole here", "H", here("hole")); it("Text here", "T", here("text"));
      sep(); it("Fit the board", "F", fit); if (S.sel) it("Zoom to the selection", "Z", zoomToSel); if (S.sel) it("Clear the selection", "Esc", () => { S.sel = null; });
    }
    renderPanels(); render();
    const el = $("ctx");
    el.innerHTML = (title ? `<div class="ctx-title">${esc(title)}</div>` : "") + items.map((m, k) => (m ? `<button class="menu-item" data-k="${k}" ${m.dis ? "disabled" : ""}><span>${esc(m.label)}</span>${m.key ? `<kbd>${esc(m.key)}</kbd>` : ""}</button>` : `<div class="menu-sep"></div>`)).join("");
    el.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => { closeCtx(); items[+b.dataset.k].fn(); renderPanels(); render(); }));
    el.hidden = false; $("hud").hidden = true;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.min(cx, innerWidth - w - 6) + "px"; el.style.top = Math.min(cy, innerHeight - h - 6) + "px";
  }

  // ---------------------------------------------------------------------------
  // Mouse and keyboard
  // ---------------------------------------------------------------------------
  function evPos(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function onDown(e) {
    canvas.focus();
    const [sx, sy] = evPos(e), [x, y] = toWorld(sx, sy);
    closeCtx();
    if (e.button === 1 || e.button === 2 || S.space) { S.drag = { kind: "pan", sx, sy, ox: S.view.ox, oy: S.view.oy, menu: e.button === 2 && !S.space && !S.route && !S.poly }; e.preventDefault(); return; }
    if (S.tool === "route") { if (S.route) routeClick(e); else startRoute(x, y); return; }
    if (S.tool === "pour" || S.tool === "keepout") {
      const pt = [snap(x), snapY(y)];
      if (!S.poly) S.poly = [pt];
      else if (S.poly.length >= 3 && Math.hypot(pt[0] - S.poly[0][0], pt[1] - S.poly[0][1]) <= 6 / S.view.scale + 1e-6) closePoly();
      else S.poly.push(pt);
      render(); return;
    }
    if (S.tool === "measure") { const sp = snapPoint(x, y, e.shiftKey || e.altKey); S.measure = !S.measure || S.measure.b ? { a: sp.p, sa: sp, b: null } : { ...S.measure, b: sp.p, sb: sp }; render(); return; }
    if (S.tool !== "select") { placeAt(x, y); return; }
    if (onHandle(x, y)) { S.drag = { kind: "outline", w0: S.board.outline.w, h0: S.board.outline.h, mx: x, sy, moved: false }; return; }
    let zc;
    if ((zc = hitAreaMid(x, y)) >= 0 && hitAreaCorner(x, y) < 0) {
      const list = AREAS[S.sel.kind], a = S.board[list][S.sel.i];
      if (a.locked) { S.drag = { kind: "locked" }; return; }
      const p = a.pts[zc], q = a.pts[(zc + 1) % a.pts.length], np = [+((p[0] + q[0]) / 2).toFixed(4), +((p[1] + q[1]) / 2).toFixed(4)];
      a.pts.splice(zc + 1, 0, np);
      S.drag = { kind: "corner", list, i: S.sel.i, k: zc + 1, x0: np[0], y0: np[1], mx: x, my: y, moved: true, added: true }; render(); return;
    }
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
      else if (hit.kind === "part") S.drag = { kind: "part", key: hit.id, x0: o.x, y0: o.y, mx: x, my: y, moved: false, ends: trackEnds([["part", hit.id]]) };
      else S.drag = { kind: hit.kind, i: hit.id, x0: o.x, y0: o.y, mx: x, my: y, moved: false };
      renderPanels(); render(); return;
    }
    if (onEdge(x, y)) { const p = sheetPlace(); S.drag = { kind: "board", x0: p.x, y0: p.y, sx, sy, ox: S.view.ox, oy: S.view.oy, moved: false }; return; }
    // inside the selected pour or keep-out, on empty space: drag the whole area
    let ar = hitArea(x, y);
    if (!ar && S.sel && AREAS[S.sel.kind]) { const a = S.board[AREAS[S.sel.kind]][S.sel.i]; if (a && a.pts && areaShown(S.sel.kind, a) && B.pip(x, y, areaPoly(S.sel.kind, a))) ar = { kind: S.sel.kind, i: S.sel.i }; }
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
      const bp = S.board.parts[d.key], nx = snap(d.x0 + x - d.mx), ny = snapY(d.y0 + y - d.my);
      if (nx !== bp.x || ny !== bp.y) { bp.x = nx; bp.y = ny; moveEnds(d.ends, nx - d.x0, ny - d.y0); d.moved = true; analyse(true); render(); }
    } else if (d && d.kind === "group") {
      const dx = snap(x - d.mx), dy = snap(y - d.my);
      if (dx !== d.dx || dy !== d.dy) { d.dx = dx; d.dy = dy; moveItems(d.items, d.base, dx, dy); d.moved = !!(dx || dy); analyse(true); render(); }
    } else if (d && d.kind === "seg") {
      const t = S.board.tracks[d.i], np = dragSeg(d.pts0, d.k, x - d.mx, y - d.my);
      if (JSON.stringify(np) !== JSON.stringify(t.pts)) { t.pts = np; d.moved = true; analyse(true); render(); }
    } else if (d && d.kind === "corner") {
      const p = S.board[d.list][d.i].pts[d.k], nx = snap(d.x0 + x - d.mx), ny = snapY(d.y0 + y - d.my);
      if (nx !== p[0] || ny !== p[1]) { p[0] = nx; p[1] = ny; d.moved = true; if (d.list === "zones") liveFill(); render(); }
    } else if (d && d.kind === "area") {
      const dx = snap(x - d.mx), dy = snap(y - d.my);
      if (dx !== d.dx || dy !== d.dy) { d.dx = dx; d.dy = dy; S.board[d.list][d.i].pts = d.pts0.map(p => [p[0] + dx, p[1] + dy]); d.moved = !!(dx || dy); if (d.list === "zones") liveFill(); render(); }
    } else if (d && d.kind === "box") {
      d.x1 = x; d.y1 = y; d.moved = Math.hypot(d.x1 - d.x0, d.y1 - d.y0) * S.view.scale > 4; render();
    } else if (d && d.kind === "locked") {
      if (!d.noted) { d.noted = true; lockedNote(); }
    } else if (d && LISTS[d.kind]) {
      const o = S.board[LISTS[d.kind]][d.i]; o.x = snap(d.x0 + x - d.mx); o.y = snapY(d.y0 + y - d.my); d.moved = true; analyse(true); render();
    } else if (d && d.kind === "board") {
      // the sheet stays still on the screen and the board slides over it
      const dx = snap((sx - d.sx) / S.view.scale), dy = snap((sy - d.sy) / S.view.scale);
      const sh = dx || dy || d.moved ? pinSheet() : {}; sh.x = +(d.x0 - dx).toFixed(4); sh.y = +(d.y0 - dy).toFixed(4); S.view.ox = d.ox + dx * S.view.scale; S.view.oy = d.oy + dy * S.view.scale; d.moved = !!(dx || dy); render();
    } else if (d && d.kind === "outline") {
      const o = S.board.outline; o.w = Math.max(10, snap(d.w0 + x - d.mx)); setHeight(Math.max(10, snap(d.h0 + (d.sy - sy) / S.view.scale))); d.moved = true; analyse(true); render();
    }
    const p = hitPad(x, y);
    S.hover = p ? p.net : null;
    S.snapHint = S.tool === "measure" ? snapPoint(x, y, e.shiftKey || e.altKey) : null;
    // the part under the pointer gets a faint outline and the move cursor
    const hp = S.tool === "select" && !d && e.target === canvas ? hitPart(x, y) : null, hk = hp ? hp.key : null;
    if (hk !== S.hoverPart) { S.hoverPart = hk; render(); }
    canvas.style.cursor = S.tool === "select" && onHandle(x, y) ? "nesw-resize" : S.tool === "select" && (onEdge(x, y) || (hp && !p)) ? "move" : S.tool === "select" ? "" : "crosshair";
    hudMove(e);
    const zone = sheetZone(x, y);
    $("st-pos").textContent = `x ${x.toFixed(2)}  y ${showY(y).toFixed(2)} mm` + (zone ? ` · ${zone}` : "") + (p ? ` · ${p.ref}-${p.num}${p.name !== p.num ? " (" + p.name + ")" : ""} · ${p.netName || "no net"} (${classOf(p.net)})` : "");
    if (S.route) S.routeBad = routeCheck();
    if (S.route || p || S.measure || S.tool !== "select") render();
  }
  function onUp(e) {
    const d = S.drag; S.drag = null;
    if (d && d.kind === "pan" && d.menu && e && Math.hypot(S.view.ox - d.ox, S.view.oy - d.oy) < 3) { const [x, y] = toWorld(...evPos(e)); openCtx(e.clientX, e.clientY, x, y); return; }
    if (d && d.kind === "box") {
      if (d.moved) { boxSelect(d.x0, d.y0, d.x1, d.y1, d.x1 < d.x0, d.add); const n = selItems().length; msg(n ? `${n} selected: drag one to move them all, R turns them, arrows nudge, L locks, the inspector aligns` : "Nothing in the box"); }
      else if (!d.add) S.sel = null;
      renderPanels(); render(); return;
    }
    if (d && d.kind === "seg" && d.moved) S.board.tracks[d.i].pts = tidy(S.board.tracks[d.i].pts);
    if (d && d.kind === "corner" && d.moved) {
      // a corner dropped onto its neighbour (or onto the line through its neighbours) goes away
      const P = S.board[d.list][d.i].pts, n = P.length, a = P[(d.k + n - 1) % n], b = P[d.k], c = P[(d.k + 1) % n];
      const flat = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-6;
      if (n > 3 && (flat || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6 || Math.hypot(b[0] - c[0], b[1] - c[1]) < 1e-6)) { P.splice(d.k, 1); commit(d.added ? undefined : `Corner merged: ${P.length} left`); return; }
      commit(d.added ? `Corner added: ${P.length} corners (double-click a corner to remove it)` : undefined); return;
    }
    if (d && d.kind !== "pan" && d.moved) commit(d.kind === "outline" ? `Board ${S.board.outline.w} × ${S.board.outline.h} mm` : d.kind === "board" ? `Board moved on the sheet: origin ${onSheet().map(v => v.toFixed(2)).join(", ")} mm from the sheet's bottom-left corner (the sheet is locked)` : undefined);
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
    if (e.key === "Escape") { const open = MODALS.find(id => !$(id).hidden); if (open) { $(open).hidden = true; return; } if (!$("ctx").hidden) { closeCtx(); return; } }
    if ((e.ctrlKey || e.metaKey) && (e.code === "KeyF" || String(e.key).toLowerCase() === "f")) { e.preventDefault(); $("find").focus(); $("find").select(); return; }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (!$("view3d").hidden) { if (e.key === "Escape" || e.code === "Digit3") { e.preventDefault(); close3D(); } return; }
    if (e.code === "Digit3" && !(e.ctrlKey || e.metaKey || e.altKey)) { e.preventDefault(); open3D(); return; }
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
    if (S.route && (e.code === "Slash" || e.key === "/")) { e.preventDefault(); S.route.flip = !S.route.flip; msg(S.route.flip ? "Diagonal first (/: straight first)" : "Straight first (/: diagonal first)"); S.routeBad = routeCheck(); render(); return; }
    if (e.key === "Backspace" && S.route) { e.preventDefault(); if (S.route.pts.length > 1) S.route.pts.pop(); render(); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && S.sel) { e.preventDefault(); deleteSel(); return; }
    // while routing, Ctrl+Z takes back the last corner (or drops the route), not a finished track
    if (ctrl && L === "z" && S.route && !e.shiftKey) { e.preventDefault(); if (S.route.pts.length > 1) S.route.pts.pop(); else if (S.route.segs.length) finishRoute(); else { S.route = null; msg("Route dropped"); } S.routeBad = routeCheck(); render(); return; }
    if (ctrl && L === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && L === "y") { e.preventDefault(); redo(); return; }
    if (ctrl) return;
    if (L === "w" && S.route) routeWidth();
    else if (e.code === "Equal" || e.code === "NumpadAdd" || e.key === "+") zoomAt(1.25);
    else if (e.code === "Minus" || e.code === "NumpadSubtract" || e.key === "-") zoomAt(0.8);
    else if (L === "z") zoomToSel();
    else if (e.code === "Backslash" || e.key === "\\") setBare(!S.bare);
    else if (L === "x") setTool(S.tool === "route" ? "select" : "route");
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
    else if (L === "f") (e.shiftKey ? fitSheet() : fit());
    else if (L === "g") setGridStyle({ lines: "dots", dots: "off", off: "lines" }[S.gridStyle]);
    else if (L === "a") setAxes(!S.axes);
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
  // (with the ends of the tracks that run into the moving parts' pads: they follow the pads)
  const snapshot = items => Object.assign(items.map(([k, id]) => { const o = objOf(k, id); return o.pts ? o.pts.map(p => p.slice()) : [o.x, o.y]; }), { ends: trackEnds(items) });
  function moveItems(items, base, dx, dy) {
    items.forEach(([k, id], n) => {
      const o = objOf(k, id); if (!o || o.locked) return;
      if (o.pts) o.pts = base[n].map(p => [+(p[0] + dx).toFixed(4), +(p[1] + dy).toFixed(4)]);
      else if (o.x !== undefined) { o.x = +(base[n][0] + dx).toFixed(4); o.y = +(base[n][1] + dy).toFixed(4); }
    });
    moveEnds(base.ends, dx, dy);
  }
  // the track ends lying on the pads of the parts among items (tracks moving along are left out)
  function trackEnds(items) {
    if (!S.model) return [];
    const parts = new Set(items.filter(([k, id]) => k === "part" && !isLocked(k, id)).map(([, id]) => id)), moving = new Set(items.filter(([k]) => k === "track").map(([, i]) => i));
    if (!parts.size) return [];
    const pads = S.model.pads.filter(p => parts.has(p.part)), out = [];
    S.board.tracks.forEach((t, ti) => { if (moving.has(ti) || t.locked) return; [0, t.pts.length - 1].forEach(k => { const q = t.pts[k]; if (pads.some(p => Math.hypot(p.x - q[0], p.y - q[1]) < 0.01)) out.push({ ti, k, x: q[0], y: q[1] }); }); });
    return out;
  }
  function moveEnds(ends, dx, dy) { (ends || []).forEach(e => { const t = S.board.tracks[e.ti]; if (t) t.pts[e.k] = [+(e.x + dx).toFixed(4), +(e.y + dy).toFixed(4)]; }); }
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
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), cx = snap((Math.min(...xs) + Math.max(...xs)) / 2), cy = snapY((Math.min(...ys) + Math.max(...ys)) / 2);
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
    const gone = [...(by.tracks || []).map(i => S.board.tracks[i]), ...(by.vias || []).map(i => S.board.vias[i])];
    Object.entries(by).forEach(([l, idx]) => idx.sort((a, b) => b - a).forEach(i => S.board[l].splice(i, 1)));
    S.sel = null;
    const left = gone.length ? dropResidue(gone) : 0;
    commit(`Deleted ${del.length}${left ? ` and ${left} piece${left === 1 ? "" : "s"} of its route left hanging` : ""}${locked ? `; ${locked} locked kept` : ""}${parts ? "; parts stay (they come from the schematic)" : ""}`);
  }
  // after tracks or vias are deleted: the copper of the same route that now hangs loose where it met them
  // (a track end or a via the checks call unconnected, on a deleted piece) goes too, until the route ends
  // at pads, a pour or copper still in use. Locked copper stays. gone: the deleted tracks and vias; returns how many more went
  // gone null: every loose end on the board counts (before an auto-route)
  function dropResidue(gone) {
    const b = S.board, R = b.rules, n0 = b.tracks.length + b.vias.length;
    const segs = o => o.pts ? o.pts.slice(1).map((p, k) => [o.pts[k][0], o.pts[k][1], p[0], p[1], o.w / 2]) : [[o.x, o.y, o.x, o.y, (o.pad || R.viaPad) / 2]];
    let cut = gone ? gone.flatMap(segs) : null;
    const near = (x, y, r) => !cut || cut.some(c => B.segDist(c[0], c[1], c[2], c[3], x, y) <= c[4] + r + 1e-6);
    for (let pass = 0; pass < 50 && (!cut || cut.length); pass++) {
      analyse();
      const loose = S.drc.filter(d => d.kind === "dangling").map(d => [d.x, d.y]), at = (x, y) => loose.some(([lx, ly]) => Math.abs(lx - x) < 1e-6 && Math.abs(ly - y) < 1e-6);
      const tr = b.tracks.filter(t => !t.locked && [t.pts[0], t.pts[t.pts.length - 1]].some(([x, y]) => at(x, y) && near(x, y, t.w / 2)));
      const vi = b.vias.filter(v => !v.locked && at(v.x, v.y) && near(v.x, v.y, (v.pad || R.viaPad) / 2));
      if (!tr.length && !vi.length) break;
      b.tracks = b.tracks.filter(t => !tr.includes(t)); b.vias = b.vias.filter(v => !vi.includes(v));
      if (cut) cut = [...tr, ...vi].flatMap(segs);
    }
    return n0 - b.tracks.length - b.vias.length;
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
  // Shift+F: the whole drawing sheet
  function fitSheet() {
    const sh = sheetPlace(); if (!sh) { fit(); return; }
    const W = canvas.clientWidth, H = canvas.clientHeight, m = 20, s = Math.max(0.5, Math.min(40, Math.min((W - 2 * m) / sh.w, (H - 2 * m) / sh.h)));
    S.view = { scale: s, ox: W / 2 - (sh.x + sh.w / 2) * s, oy: H / 2 - (sh.y + sh.h / 2) * s };
    render();
  }
  function setGridStyle(v) { S.gridStyle = v; gridUi(); keepView(); msg({ lines: "Grid: lines (G: dots)", dots: "Grid: dots (G: off)", off: "Grid off (G: lines)" }[v]); render(); }
  const gridUi = () => document.querySelectorAll("[data-gs]").forEach(b => b.classList.toggle("active", b.dataset.gs === S.gridStyle));
  function setAxes(on) { S.axes = on; $("btn-axes").classList.toggle("active", on); keepView(); msg(on ? "X / Y axes shown (A: hide)" : "Axes hidden (A: show)"); render(); }

  // ---------------------------------------------------------------------------
  // Drawing sheet: the board on an ISO 5457 sheet with the reference grid and the ISO 7200
  // title block, as the Circuit CAD draws its frames (CadLib.DRAW.frame, 4 units per mm).
  // The sheet is laid round the board, the board centred above the title block, and follows it
  // when it grows. Size "auto": the smallest sheet of the chosen orientation the board fits on.
  // Locked, the sheet keeps its size and its place (x, y: its top-left corner on the board).
  // ---------------------------------------------------------------------------
  const SHEET_ORDER = ["A4", "A3", "A2", "A1", "A0"];
  function sheetPlace() {
    const sh = S.board.sheet || {}, o = S.board.outline, L = window.CadLib;
    if (!L || sh.size === "none") return null;
    const orient = sh.orient === "portrait" ? "portrait" : "landscape", MM = L.MM;
    const geom = size => L.sheetGeom({ params: { size, orient } });
    // room for the board: inside the reference-grid band, above the title block (or beside it)
    const room = (g, tb) => ({ x1: g.fx1 / MM + 5, x2: g.fx2 / MM - 5, y1: g.fy1 / MM + 5, y2: (tb ? g.tb.y1 / MM : g.fy2 / MM - 5) });
    const fits = (g, tb) => { const r = room(g, tb); return o.w + 10 <= r.x2 - r.x1 && o.h + 10 <= r.y2 - r.y1; };
    const size = L.SHEETS[sh.size] ? sh.size : SHEET_ORDER.find(k => fits(geom(k), true)) || SHEET_ORDER.find(k => fits(geom(k), false)) || "A0";
    const g = geom(size), r = room(g, fits(g, true)), locked = !!sh.locked && Number.isFinite(sh.x) && Number.isFinite(sh.y);
    const x = locked ? -sh.x : Math.round((r.x1 + r.x2) / 2 - o.w / 2), y = locked ? -sh.y : Math.round((r.y1 + r.y2) / 2 - o.h / 2);
    const f = (S.netlist && S.netlist.frame) || {};
    const params = { ...L.LIB.frame.defaults, ...f, title: f.title || (S.netlist && S.netlist.title) || "", docno: f.docno || (S.netlist && S.netlist.docno) || "",
      size, orient, doctype: "PCB layout", sheet: "1/1" };
    return { size, orient, g, x: -x, y: -y, w: g.W / MM, h: g.H / MM, params, MM, locked };
  }
  // a new format (or orientation) for the sheet; a locked sheet is laid round the board afresh
  // and stays locked there
  function setSheet(patch, text) {
    const sh = { ...S.board.sheet, ...patch };
    S.board.sheet = { size: sh.size, orient: sh.orient };
    const p = sh.locked && sheetPlace();
    if (p) S.board.sheet = { ...S.board.sheet, size: p.size, locked: true, x: p.x, y: p.y };
    commit(text || (sh.size === "none" ? "No drawing sheet" : `Drawing sheet ${sheetName()}`));
  }
  function sheetName() { const p = sheetPlace(); return p ? `${p.size} ${p.orient}` : "none"; }
  // Lock: the sheet stays where it is (and keeps its size) whatever happens to the board
  function lockSheet(on) {
    const sh = S.board.sheet || {};
    if (on && sh.size === "none") { msg("There is no sheet to lock: choose a format first"); sheetUi(); return; }
    if (on) { const p = sheetPlace(); S.board.sheet = { ...sh, size: p.size, locked: true, x: p.x, y: p.y }; commit(`Drawing sheet ${p.size} locked in place (unlock: it follows the board again)`); }
    else { S.board.sheet = { size: sh.size, orient: sh.orient }; commit("Drawing sheet unlocked: it follows the board"); }
  }
  // the sheet locked where it is now (moving the board on it needs a sheet that stays put)
  function pinSheet() {
    const sh = S.board.sheet || {}, p = sheetPlace();
    if (!sh.locked) S.board.sheet = { ...sh, size: p.size, locked: true, x: p.x, y: p.y };
    return S.board.sheet;
  }
  // the origin (the board's bottom-left corner) from the sheet's bottom-left corner, mm
  function onSheet() { const p = sheetPlace(); return p ? [-p.x, +(p.y + p.h - S.board.outline.h).toFixed(4)] : null; }
  function moveOnSheet(X, Y) {
    const p = sheetPlace(); if (!p) return;
    const sh = pinSheet(), x = -X, y = +(S.board.outline.h + Y - p.h).toFixed(4), dx = sh.x - x, dy = sh.y - y;
    sh.x = x; sh.y = y; S.view.ox += dx * S.view.scale; S.view.oy += dy * S.view.scale;
    commit(`Board on the sheet at ${X}, ${Y} mm (the sheet is locked)`);
  }
  function centreOnSheet() {
    const sh = S.board.sheet || {}, before = sheetPlace(); if (!before) return;
    S.board.sheet = { size: before.size, orient: before.orient }; const p = sheetPlace();
    S.board.sheet = { ...S.board.sheet, locked: !!sh.locked, ...(sh.locked ? { x: p.x, y: p.y } : {}) };
    S.view.ox += (before.x - p.x) * S.view.scale; S.view.oy += (before.y - p.y) * S.view.scale;
    commit("Board centred on the sheet, above the title block");
  }
  function sheetUi() {
    const sh = S.board.sheet || {}, el = $("sheet-pick");
    if (!el) return;
    el.value = sh.size === "none" ? "none" : `${sh.size || "auto"} ${sh.orient === "portrait" ? "portrait" : "landscape"}`;
    $("btn-sheet-lock").classList.toggle("active", !!sh.locked); $("btn-sheet-lock").disabled = sh.size === "none";
    $("btn-sheet-lock").textContent = "Lock sheet";
  }
  // the reference-grid zone of a board point, e.g. "B3" (as the Circuit CAD shows it)
  function sheetZone(x, y) {
    const sh = sheetPlace(); if (!sh) return "";
    const g = sh.g, lx = (x - sh.x) * sh.MM, ly = (y - sh.y) * sh.MM;
    if (lx < g.fx1 || lx > g.fx2 || ly < g.fy1 || ly > g.fy2) return "";
    const col = Math.min(g.cols, Math.floor((lx - g.fx1) / ((g.fx2 - g.fx1) / g.cols)) + 1), row = Math.min(g.rows, Math.floor((ly - g.fy1) / ((g.fy2 - g.fy1) / g.rows)) + 1);
    return "ABCDEFGHJKLMNPRSTUVWXYZ"[row - 1] + col;
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
    const fs = S.fills.filter(f => f.layer === layer && !f.tear); if (!fs.length) return;
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
    const { scale, ox, oy } = S.view, sheet = sheetPlace();
    // the paper of the drawing sheet, then the grid over the whole screen, then the sheet's frame
    if (sheet) { ctx.fillStyle = "#0c121b"; ctx.fillRect(ox + sheet.x * scale, oy + sheet.y * scale, sheet.w * scale, sheet.h * scale); }
    drawGrid(W, H);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    const px = 1 / scale, o = S.board.outline;
    if (sheet) { ctx.save(); ctx.translate(sheet.x, sheet.y); ctx.scale(1 / sheet.MM, 1 / sheet.MM); CadLib.DRAW.frame(ctx, { params: sheet.params }); ctx.restore(); }
    if (S.axes) axisLines(W, H);
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
      // teardrops, in the track's colour
      S.fills.forEach(f => {
        if (!f.tear || f.layer !== layer || !S.board.tracks[f.ti]) return;
        const sel = trackSelected(f.ti), lit = hl !== null && f.net === hl;
        ctx.globalAlpha = NH !== null && !lit && !sel ? base * 0.25 : base; ctx.fillStyle = sel ? "#00e5ff" : COLORS[layer];
        ctx.beginPath(); f.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
      });
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
    // silkscreen: bottom first (mirrored footprints), then top. Each part's value (a screen note, not
    // silkscreen) goes inside its outline when it fits, else under it, and only where it covers no
    // reference and no other value
    const silk = new Map(), taken = [];
    const overlaps = r => taken.some(t => r.x1 < t.x2 && r.x2 > t.x1 && r.y1 < t.y2 && r.y2 > t.y1);
    if (S.model) S.model.parts.forEach(g => {
      if (!g.place) return;
      const ops = BoardFab.partSilk(g, S.board.outline); silk.set(g.key, ops);
      ops.filter(o => o.ref).forEach(o => { const xs = o.pts.map(q => q[0]), ys = o.pts.map(q => q[1]); taken.push({ x1: Math.min(...xs) - 0.3, y1: Math.min(...ys) - 0.3, x2: Math.max(...xs) + 0.3, y2: Math.max(...ys) + 0.3 }); });
    });
    ["B", "F"].forEach(side => {
      const L = side + ".SilkS"; if (!S.show[L]) return;
      S.board.texts.forEach((t, i) => { if (t.layer === L) drawText(t, selColor("text", i, COLORS[L])); });
      if (S.model) S.model.parts.forEach(g => {
        if (!g.place || (g.place.side || "F") !== side) return;
        const sel = isSel("part", g.key);
        // the silkscreen as it will be made (outline and reference in the stroke font)
        const ops = (silk.get(g.key) || BoardFab.partSilk(g, S.board.outline)).map(o => (o.t === "line" && px > 0.15 ? { ...o, w: Math.max(o.w, px) } : o));
        BoardFab.paint(ctx, ops, sel ? "#00e5ff" : COLORS[L], "erase");
        const b = partBox(g);
        if (scale > 6 && g.value) {
          const fh = Math.max(1, 9 * px); ctx.font = `${fh}px ui-monospace, monospace`;
          const tw = ctx.measureText(g.value).width, cx = (b.x1 + b.x2) / 2, inside = tw <= (b.x2 - b.x1) * 0.9 && fh <= (b.y2 - b.y1) * 0.5;
          const ty = inside ? (b.y1 + b.y2) / 2 + (g.type === "tube" ? (b.y2 - b.y1) * 0.27 : fh * 0.6) : b.y2 + 0.3, r = { x1: cx - tw / 2, x2: cx + tw / 2, y1: inside ? ty - fh / 2 : ty, y2: inside ? ty + fh / 2 : ty + fh };
          if (!overlaps(r)) { taken.push(r); ctx.fillStyle = "#8b949e"; ctx.textAlign = "center"; ctx.textBaseline = inside ? "middle" : "top"; ctx.fillText(g.value, cx, ty); }
        }
        if (!sel && S.hoverPart === g.key && S.tool === "select") { ctx.strokeStyle = "rgba(230,237,243,0.35)"; ctx.setLineDash([3 * px, 3 * px]); ctx.lineWidth = px; ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); ctx.setLineDash([]); }
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
    // a plated one: its copper ring, like a via's; a plain one: the copper clearance round it, dashed
    if (S.show.Holes) S.board.holes.forEach((h, i) => {
      if (h.plated) { ctx.fillStyle = selColor("hole", i, "#c9a95c"); ctx.beginPath(); ctx.arc(h.x, h.y, B.holeRing(h) / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#070b10"; ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = selColor("hole", i, COLORS.Holes); ctx.lineWidth = Math.max(0.12, px); ctx.stroke();
      if (!h.plated) { ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2 + S.board.rules.clearance, 0, Math.PI * 2); ctx.setLineDash([2 * px, 2 * px]); ctx.stroke(); ctx.setLineDash([]); }
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
      if (sel && z.pts) areaHandles(z.pts, px);
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
      if (sel) areaHandles(P, px);
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
      const pts = S.poly.concat([[snap(S.mouse[0]), snapY(S.mouse[1])]]);
      ctx.strokeStyle = S.tool === "keepout" ? COLORS.keepouts : COLORS[S.layer]; ctx.lineWidth = Math.max(0.1, 1.5 * px); ctx.setLineDash([5 * px, 4 * px]);
      ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (pts.length > 2) ctx.lineTo(pts[0][0], pts[0][1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = COLORS[S.layer]; S.poly.forEach(p => ctx.fillRect(p[0] - 2.5 * px, p[1] - 2.5 * px, 5 * px, 5 * px));
    }
    if (S.route) {
      const r = S.route, rt = routeTail(), tail = rt.pts, pts = r.pts.concat(tail.slice(1)), bad = rt.bad;
      const need = bad && bad.need ? bad.need : B.classRule(classOf(r.net), S.board.rules).clearance;
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
      const x = snap(S.mouse[0]), y = snapY(S.mouse[1]), R = S.board.rules;
      ctx.globalAlpha = 0.5; ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = Math.max(0.1, px);
      ctx.beginPath(); ctx.arc(x, y, S.tool === "via" ? R.viaPad / 2 : S.tool === "hole" ? 1.6 : 0.6, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (S.tool === "measure" && S.snapHint && !(S.measure && S.measure.b)) snapMark(S.snapHint, px);
    if (S.measure) {
      const m = S.measure, hint = S.snapHint || snapPoint(S.mouse[0], S.mouse[1]), a = m.a, b = m.b || hint.p, sb = m.b ? m.sb : hint;
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
      // the legs (Δx, Δy) faint, the distance dashed, the ends marked where they stuck
      ctx.strokeStyle = "rgba(0,229,255,0.35)"; ctx.lineWidth = Math.max(0.06, 0.8 * px); ctx.setLineDash([2 * px, 3 * px]);
      if (dx && dy) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = Math.max(0.1, 1.2 * px); ctx.setLineDash([4 * px, 3 * px]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
      if (m.sa) snapMark(m.sa, px, true);
      if (m.b && sb) snapMark(sb, px, true);
      const ang = d ? Math.atan2(-dy, dx) * 180 / Math.PI : 0, txt = `${d.toFixed(2)} mm  (Δx ${dx.toFixed(2)}, Δy ${(-dy || 0).toFixed(2)}, ${ang.toFixed(1)}°)`;
      ctx.font = `${12 * px}px ui-monospace, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      const tw = ctx.measureText(txt).width; ctx.fillStyle = "rgba(7,11,16,0.85)"; ctx.fillRect(b[0] + 6 * px, b[1] - 18 * px, tw + 8 * px, 16 * px);
      ctx.fillStyle = "#00e5ff"; ctx.fillText(txt, b[0] + 10 * px, b[1] - 4 * px);
      S.measured = { d, dx, dy: -dy || 0, from: m.sa ? m.sa.what : "grid", to: sb ? sb.what : "grid" };
      const ends = [S.measured.from, S.measured.to].some(w => w !== "grid") ? ` · ${S.measured.from} → ${S.measured.to}` : "";
      $("st-msg").textContent = "Measure: " + txt + ends;
    }
    if (S.show.drc) S.drc.forEach(d => {
      if (d.kind === "unplaced") return;
      const r = Math.max(0.8, 6 * px);
      ctx.strokeStyle = NOTE.includes(d.kind) ? "#ffb300" : "#ff7b72"; ctx.lineWidth = Math.max(0.12, 1.5 * px);
      ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(d.x - r * 0.6, d.y - r * 0.6); ctx.lineTo(d.x + r * 0.6, d.y + r * 0.6); ctx.moveTo(d.x + r * 0.6, d.y - r * 0.6); ctx.lineTo(d.x - r * 0.6, d.y + r * 0.6); ctx.stroke();
    });
    // the board's resize handle (select tool)
    if (S.tool === "select" && S.show["Edge.Cuts"]) { const t = 5 * px; ctx.fillStyle = COLORS["Edge.Cuts"]; ctx.fillRect(o.w - t, -t, 2 * t, 2 * t); }
    if (S.axes) axisMarks(W, H);
    $("z-pct").textContent = `${Math.round(S.view.scale / 3.7795 * 100)}%`;
    const c = S.conn, errs = errors();
    $("st-rats").textContent = c ? (c.unrouted ? `${c.unrouted} connection${c.unrouted > 1 ? "s" : ""} to route` : "All connections routed") : "";
    // green only when the board is finished: no violations, nothing to route; warnings in amber
    const warns = S.drc.filter(d => NOTE.includes(d.kind) && d.kind !== "unplaced").length, open = c && c.unrouted;
    $("st-drc").textContent = S.model ? (errs ? `${errs} rule violation${errs > 1 ? "s" : ""}` : "No rule violations") + (warns ? ` · ${warns} warning${warns > 1 ? "s" : ""}` : "") : "";
    $("st-drc").style.color = errs ? "var(--bad)" : warns ? "var(--warn)" : open ? "var(--muted)" : "var(--ok)";
  }
  // where the measure tool sticks: a circle on a centre, a square on a corner or end, a diamond on
  // a line; with its name next to it (not on the ends of a measurement already placed)
  function snapMark(sp, px, quiet) {
    if (sp.shape === "grid") return;
    const [x, y] = sp.p, r = 5 * px;
    ctx.strokeStyle = "#ffe680"; ctx.lineWidth = Math.max(0.08, 1.5 * px); ctx.beginPath();
    if (sp.shape === "centre") ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (sp.shape === "corner") ctx.rect(x - r, y - r, 2 * r, 2 * r);
    else { ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x + r * 1.3, y); ctx.lineTo(x, y + r * 1.3); ctx.lineTo(x - r * 1.3, y); ctx.closePath(); }
    ctx.stroke();
    if (quiet) return;
    ctx.font = `${11 * px}px ui-monospace, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "top";
    const tw = ctx.measureText(sp.what).width; ctx.fillStyle = "rgba(7,11,16,0.85)"; ctx.fillRect(x + 7 * px, y + 6 * px, tw + 6 * px, 14 * px);
    ctx.fillStyle = "#ffe680"; ctx.fillText(sp.what, x + 10 * px, y + 8 * px);
  }
  // the screen grid (in screen pixels): lines with every tenth stronger, or dots; coarser when zoomed out
  // It runs from the origin, the board's bottom-left corner (screen y Oy), rows counted upwards.
  function drawGrid(W, H) {
    if (S.gridStyle === "off") return;
    const { scale, ox } = S.view, Oy = originY(), lines = S.gridStyle === "lines", n = Math.max(1, Math.ceil((lines ? 8 : 6) / (S.grid * scale))), g = S.grid * n;
    const i1 = Math.floor(-ox / scale / g), i2 = Math.ceil((W - ox) / scale / g), j1 = Math.floor((Oy - H) / scale / g), j2 = Math.ceil(Oy / scale / g);
    if (!lines) {
      ctx.fillStyle = "#16202c";
      for (let i = i1; i <= i2; i++) for (let j = j1; j <= j2; j++) ctx.fillRect(i * g * scale + ox - 0.75, Oy - j * g * scale - 0.75, 1.5, 1.5);
      return;
    }
    ctx.lineWidth = 1;
    [false, true].forEach(major => {
      ctx.strokeStyle = major ? "#1a2533" : "#111923"; ctx.beginPath();
      for (let i = i1; i <= i2; i++) if ((i % 10 === 0) === major) { const sx = Math.round(i * g * scale + ox) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
      for (let j = j1; j <= j2; j++) if ((j % 10 === 0) === major) { const sy = Math.round(Oy - j * g * scale) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
      ctx.stroke();
    });
  }
  const originY = () => S.view.oy + S.board.outline.h * S.view.scale;   // the origin's screen y
  // X / Y axes through the board's origin (its bottom-left corner; y grows upwards, as in the
  // Gerbers' view from the top): the lines under the board, the arrows and the millimetre scale
  // on top. When the origin is off screen the scale sticks to the screen edge.
  const AX = { x: "#ff8a80", y: "#7ee787" };
  function axisLines(W, H) {
    const { ox } = S.view, oy = originY();
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineWidth = 1; ctx.globalAlpha = 0.45;
    if (oy >= 0 && oy <= H) { ctx.strokeStyle = AX.x; ctx.beginPath(); ctx.moveTo(0, Math.round(oy) + 0.5); ctx.lineTo(W, Math.round(oy) + 0.5); ctx.stroke(); }
    if (ox >= 0 && ox <= W) { ctx.strokeStyle = AX.y; ctx.beginPath(); ctx.moveTo(Math.round(ox) + 0.5, 0); ctx.lineTo(Math.round(ox) + 0.5, H); ctx.stroke(); }
    ctx.restore();
  }
  function axisMarks(W, H) {
    const { scale, ox } = S.view, oy = originY();
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(s => s * scale >= 60) || 1000;
    const yx = Math.max(2, Math.min(H - 18, oy)), xy = Math.max(2, Math.min(W - 40, ox));   // where the scales run
    ctx.font = "10px ui-monospace, monospace"; ctx.lineWidth = 1;
    // X scale
    ctx.strokeStyle = AX.x; ctx.fillStyle = AX.x; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.beginPath();
    for (let v = Math.ceil(-ox / scale / step) * step; v * scale + ox <= W; v += step) {
      const sx = Math.round(v * scale + ox) + 0.5; ctx.moveTo(sx, yx); ctx.lineTo(sx, yx + 5);
      if (v && Math.abs(sx - xy) > 24 && !(yx === oy && sx > ox && sx < ox + 76)) ctx.fillText(String(v), sx, yx + 6);   // clear of the X arrow
    }
    ctx.stroke();
    // Y scale
    ctx.strokeStyle = AX.y; ctx.fillStyle = AX.y; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.beginPath();
    for (let v = Math.ceil((oy - H) / scale / step) * step; oy - v * scale >= 0; v += step) {
      const sy = Math.round(oy - v * scale) + 0.5; ctx.moveTo(xy, sy); ctx.lineTo(xy + 5, sy);
      if (v && Math.abs(sy - yx) > 14 && !(xy === ox && sy < oy && sy > oy - 76)) ctx.fillText(String(v), xy + 7, sy);   // clear of the Y arrow
    }
    ctx.stroke();
    // the origin: two arrows, X to the right and Y up
    if (ox > -40 && ox < W + 40 && oy > -40 && oy < H + 40) {
      const arrow = (dx, dy, col, label) => {
        const L = 46, ex = ox + dx * L, ey = oy + dy * L;
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex + dx * 8, ey + dy * 8); ctx.lineTo(ex - dy * 4, ey + dx * 4); ctx.lineTo(ex + dy * 4, ey - dx * 4); ctx.closePath(); ctx.fill();
        ctx.font = "bold 12px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, ex + dx * 16 + dy * 9, ey + dy * 16 + dx * 9);
      };
      arrow(1, 0, AX.x, "X"); arrow(0, -1, AX.y, "Y");
      ctx.fillStyle = "#e6edf3"; ctx.beginPath(); ctx.arc(ox, oy, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.textBaseline = "top"; ctx.fillText("0,0", ox - 4, oy + 3);
    }
    ctx.restore();
  }
  const NOTE = ["unplaced", "check", "class", "silk", "dangling", "stopper", "coupling", "heat", "support"];
  const errors = () => S.drc.filter(d => !NOTE.includes(d.kind)).length;

  // ---------------------------------------------------------------------------
  // Panels: parts list, inspector, rule check, layers
  // ---------------------------------------------------------------------------
  function renderPanels() {
    const host = $("parts"), M = S.model;
    if (!M) { host.innerHTML = `<p class="help">The parts arrive from the Circuit CAD.</p>`; $("parts-count").textContent = ""; }
    else {
      const unplaced = new Set(S.drc.filter(d => d.kind === "unplaced").map(d => d.msg.split(" ")[0]));
      const row = g => `<button class="item${isSel("part", g.key) ? " active" : ""}" data-key="${esc(g.key)}" title="${esc(g.ref)} ${esc(g.value || "")} · ${esc(g.fp ? g.fp.name : "")}"><span>${esc(g.ref)}</span><em>${esc(g.value || (g.fp ? g.fp.name : ""))}</em></button>`;
      const q = (S.find || "").trim().toLowerCase(), hit = g => !q || [g.ref, g.value, g.fp && g.fp.name].some(t => String(t || "").toLowerCase().includes(q));
      // an exact reference first, then references that start with it, then anything that contains it
      const rank = g => { const r = g.ref.toLowerCase().replace(/'+$/, ""); return !q ? 0 : r === q ? 0 : r.startsWith(q) ? 1 : 2; };
      const on = M.parts.filter(g => !unplaced.has(g.ref) && hit(g)).sort((a, b) => rank(a) - rank(b)), off = M.parts.filter(g => unplaced.has(g.ref) && hit(g)).sort((a, b) => rank(a) - rank(b));
      host.innerHTML = (q && !on.length && !off.length ? `<p class="help">No part matches “${esc(S.find)}”.</p>` : "") + (off.length ? `<button class="btn" id="btn-arrange" style="width:100%;margin:2px 0 6px" title="Put the parts waiting below the board where they sit in the schematic (the schematic's extent mapped onto the board), each in the free spot nearest its place: a starting point that follows the signal">Place all on the board</button><h2>To place <small>${off.length}</small></h2>${off.map(row).join("")}` : "") + `<h2>On the board <small>${on.length}</small></h2>${on.map(row).join("")}`;
      $("parts-count").textContent = `${M.parts.length}`;
      host.querySelectorAll(".item").forEach(b => b.addEventListener("click", () => { const g = M.parts.find(x => x.key === b.dataset.key); selectPart(g); centerOn(g.place.x, g.place.y); renderPanels(); }));
      const ab = $("btn-arrange");
      if (ab) ab.onclick = () => { const left = B.arrange(S.board, M, off.map(g => g.key), S.netlist); commit(left ? `${left} part${left > 1 ? "s" : ""} did not fit: make the board larger` : `Placed ${off.length} parts where they sit in the schematic, so the signal runs across the board as on the sheet`); fit(); };
    }
    renderInspector();
    const dh = $("drc"), list = S.drc.slice().sort((a, b) => NOTE.includes(a.kind) - NOTE.includes(b.kind) || String(a.kind).localeCompare(String(b.kind)));
    $("drc-count").textContent = list.length ? String(list.length) : "";
    // grouped by kind once the list grows: errors first, then warnings
    const KN = { ...CHECK_NAMES, unplaced: "Parts not placed", check: "To check", short: "Shorts", edge: "Board edge" }, grouped = list.length > 6;
    let lastK = null;
    dh.innerHTML = list.length ? list.slice(0, 200).map((d, i) => {
      const head = grouped && d.kind !== lastK ? `<div class="drc-group"><span>${esc(KN[d.kind] || d.kind)}</span><span>${list.filter(x => x.kind === d.kind).length}</span></div>` : ""; lastK = d.kind;
      return head + `<button class="drc ${NOTE.includes(d.kind) && d.kind !== "unplaced" ? "check" : d.kind}" data-i="${i}" title="Click: show it on the board">${esc(d.msg)}${d.between ? ` <span class="help">(${esc(d.between.join(" – "))})</span>` : ""}</button>`;
    }).join("") : `<p class="help">${M ? "No problems." : ""}</p>`;
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
    const pour = new Set(S.fills.filter(f => !f.tear).map(f => f.net));
    const rows = nets.map(n => ({ n, name: netName(n), cls: classOf(n), pads: M.pads.filter(p => p.net === n).length, todo: todo[n] || 0, len: len[n] || 0, I: (S.amps || {})[n] || 0 }))
      .filter(r => (r.pads > 1 || r.len) && (!(S.find || "").trim() || r.name.toLowerCase().includes(S.find.trim().toLowerCase()))).sort((a, b) => (b.todo > 0) - (a.todo > 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
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
      const ff = field("Footprint", bp.fp, v => { bp.fp = v; commit(); }, g.options.map(n => { const f = B.footprint(n); return [n, f ? `${n} — ${f.title.replace(/^(.{0,48}).*$/, "$1")}` : n]; })); ff.classList.add("wide"); h.appendChild(ff);
      partPreview(h, g);
      h.appendChild(field("X (mm)", +bp.x.toFixed(3), v => { bp.x = v; commit(); }));
      h.appendChild(field("Y (mm)", +showY(bp.y).toFixed(3), v => { bp.y = showY(v); commit(); }));
      h.appendChild(field("Rotation", bp.rot || 0, v => { bp.rot = +v; commit(); }, [["0", "0°"], ["1", "90°"], ["2", "180°"], ["3", "270°"]]));
      h.appendChild(field("Side", bp.side || "F", v => { bp.side = v; commit(); }, [["F", "Top"], ["B", "Bottom (mirrored)"]]));
      h.appendChild(lockField(bp));
      // star grounding: which ground return this part's ground pads belong to
      const gr = S.gg && S.gg.byPart.get(g.key);
      if (gr) {
        const stages = [...new Set([...S.gg.byPart.values()].map(v => v.auto).concat(S.model.parts.filter(x => x.type === "tube").map(x => x.ref)))].filter(v => !B.RETURNS.includes(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        h.appendChild(field("Ground return", bp.ground || "", v => { if (v) bp.ground = v; else delete bp.ground; commit(`${g.ref}'s ground goes with ${v || gr.auto + " (auto)"} to the star point`); },
          [["", `Auto: ${gr.auto}`]].concat(B.RETURNS.concat(stages).map(v => [v, /^VL/.test(v) ? `Stage ${v}` : v]))));
      }
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
        const pa = document.createElement("button"); pa.className = "btn"; pa.style.cssText = "width:100%;margin-top:4px";
        pa.textContent = `+ ${defaultNet()} pour round these parts`; pa.title = `A copper pour of ${defaultNet()} on the active layer (${S.layer}), round the selected parts 2 mm out; it keeps clear of other nets' copper by itself, so it shorts nothing`;
        pa.onclick = () => { const P = pourAround(s.parts); if (!P) return; S.board.zones.push({ net: defaultNet(), layer: S.layer, pts: P, thermal: true, gap: 0.5, spoke: 0.8 }); S.sel = { kind: "zone", i: S.board.zones.length - 1 }; commit(`${defaultNet()} pour round ${s.parts.length} parts on ${S.layer}: drag its corners to shape it`); };
        h.appendChild(pa);
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
      h.insertAdjacentHTML("beforeend", `<p class="help">Drag a corner to move it; drag the <b>+</b> on an edge to add one; double-click a corner to remove it.</p>`);
      h.appendChild(lockField(k)); h.appendChild(delBtn()); return;
    }
    if (s && s.kind === "zone") {
      const z = S.board.zones[s.i]; if (!z) { S.sel = null; return renderInspector(); }
      const f = S.fills.find(x => x.zone === s.i), nets = S.model ? [...new Set(S.model.pads.filter(p => p.net !== null).map(p => p.netName))].sort((a, b) => (b === "GND") - (a === "GND") || a.localeCompare(b, undefined, { numeric: true })) : [z.net];
      if (!nets.includes(z.net)) nets.unshift(z.net);
      h.innerHTML = `<div class="insp-title">Copper pour</div>` + (f ? kv("Pieces", f.pieces + (f.islands ? ` · ${f.islands} island${f.islands > 1 ? "s" : ""} removed` : "")) : "");
      h.appendChild(field("Net", z.net, v => { z.net = v; commit(); }, nets.map(n => [n, n])));
      h.appendChild(field("Layer", z.layer, v => { z.layer = v; commit(); }, [["F.Cu", "Top copper"], ["B.Cu", "Bottom copper"]]));
      h.appendChild(field("Area", z.pts ? "poly" : "board", v => { if (v === "board") { z.pts = null; } else if (!z.pts) z.pts = boardShape(); commit(); }, [["board", "The whole board (follows its size)"], ["poly", "Its own outline (drag the corners)"]]));
      if (z.pts) h.insertAdjacentHTML("beforeend", kv("Corners", z.pts.length));
      const shp = document.createElement("div"); shp.className = "align"; shp.style.gridTemplateColumns = "1fr 1fr";
      [["around", "Round the parts", "The smallest outline round every part on the board, 2 mm out; the pour keeps clear of the other nets' copper by itself"],
       ["rect", "Board rectangle", "A rectangle over the whole board, with four corners to drag"]].forEach(([k, t, tip]) => {
        const b = document.createElement("button"); b.className = "btn"; b.textContent = t; b.title = tip;
        b.onclick = () => { if (z.locked) { lockedNote(); return; } const P = k === "around" ? pourAround(onBoardKeys()) : boardShape(); if (P) { z.pts = P; commit(k === "around" ? `Pour round the parts: ${P.length} corners` : "Pour over the whole board: drag its corners"); } };
        shp.appendChild(b);
      });
      h.appendChild(shp);
      h.insertAdjacentHTML("beforeend", `<p class="help">Drag a corner to move it; drag the <b>+</b> in the middle of an edge to add a corner; double-click a corner (or drop it onto its neighbour) to remove it. Drag the outline, or inside the selected pour, to move it all.</p>`);
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
      h.appendChild(field("X (mm)", v.x, n => { v.x = n; commit(); })); h.appendChild(field("Y (mm)", showY(v.y), n => { v.y = showY(n); commit(); }));
      h.appendChild(field("Drill (mm)", v.drill || R.viaDrill, n => { if (n > 0) { v.drill = n; commit(); } })); h.appendChild(field("Pad (mm)", v.pad || R.viaPad, n => { if (n > 0) { v.pad = n; commit(); } }));
      h.appendChild(lockField(v));
      if (S.model) { const nets = [""].concat([...new Set(S.model.pads.filter(p => p.net !== null).map(p => p.netName))].sort()); h.appendChild(field("Net (stitching)", v.net || "", n => { v.net = n || undefined; commit(); }, nets.map(n => [n, n || "from its tracks"]))); }
      h.appendChild(delBtn()); return;
    }
    if (s && s.kind === "hole") {
      const hl = S.board.holes[s.i]; if (!hl) { S.sel = null; return renderInspector(); }
      h.innerHTML = `<div class="insp-title">Mounting hole</div>`;
      h.appendChild(field("X (mm)", hl.x, n => { hl.x = n; commit(); })); h.appendChild(field("Y (mm)", showY(hl.y), n => { hl.y = showY(n); commit(); }));
      h.appendChild(field("Diameter (mm)", hl.d, n => { if (n > 0) { hl.d = n; commit(); } }));
      h.appendChild(field("Plating", hl.plated ? "yes" : "no", v => { if (v === "yes") hl.plated = true; else { delete hl.plated; delete hl.pad; delete hl.net; } commit(); }, [["no", "Not plated (NPTH)"], ["yes", "Plated, with a copper ring (PTH)"]]));
      if (hl.plated) {
        h.appendChild(field("Ring Ø (mm)", B.holeRing(hl), n => { if (n > hl.d) { hl.pad = n; commit(); } }));
        const nets = S.model ? [...new Set(Object.values(S.model.names))].sort((a, b) => (a === "GND" ? -1 : b === "GND" ? 1 : a.localeCompare(b))) : [];
        h.appendChild(field("Net", hl.net || "", v => { if (v) hl.net = v; else delete hl.net; commit(); }, [["", "None (the screw only)"]].concat(nets.map(n => [n, n]))));
        h.insertAdjacentHTML("beforeend", `<p class="help">Plated: a copper ring on both sides, bare of solder mask, drilled with the plated holes. Give it a net (GND for a grounded chassis screw) and a pour of that net joins it; otherwise it keeps every net's clearance as chassis copper.</p>`);
      } else h.insertAdjacentHTML("beforeend", `<p class="help">Not plated: drilled separately (NPTH). The dashed ring is the copper clearance (the screw is at chassis potential).</p>`);
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
    const at = onSheet();
    if (at) {
      h.insertAdjacentHTML("beforeend", `<h2>On the sheet</h2><p class="help">Where the origin (the board's bottom-left corner) lies from the sheet's bottom-left corner. Drag the board's edge to move it; that locks the sheet.</p>`);
      h.appendChild(field("X (mm)", at[0], v => moveOnSheet(v, at[1])));
      h.appendChild(field("Y (mm)", at[1], v => moveOnSheet(at[0], v)));
      const c = document.createElement("button"); c.className = "btn"; c.textContent = "Centre on the sheet"; c.title = "Put the board back in the middle of the sheet, above the title block"; c.onclick = centreOnSheet; if ((S.board.sheet || {}).locked) h.appendChild(c);
    }
    if (M) {
      const gp = document.createElement("button"); gp.className = "btn"; gp.style.marginTop = "6px";
      gp.textContent = `+ ${defaultNet()} plane (bottom)`;
      gp.title = "A copper pour of the ground net over the whole bottom layer, with clearance to everything else and thermal reliefs on its pads";
      gp.onclick = () => groundPlane("B.Cu");
      const gr = document.createElement("button"); gr.className = "btn"; gr.style.marginTop = "6px";
      gr.textContent = `+ ${defaultNet()} pour round the parts`;
      gr.title = `A ${defaultNet()} pour on the active layer (${S.layer}) round every part on the board, 2 mm out; it keeps every other net's clearance, so it shorts nothing. Drag its corners to shape it`;
      gr.onclick = () => { const P = pourAround(onBoardKeys()); if (!P) return; S.board.zones.push({ net: defaultNet(), layer: S.layer, pts: P, thermal: true, gap: 0.5, spoke: 0.8 }); S.sel = { kind: "zone", i: S.board.zones.length - 1 }; commit(`${defaultNet()} pour round the parts on ${S.layer}: drag its corners, or the + on an edge for a new corner`); };
      const gw = document.createElement("div"); gw.style.cssText = "display:flex;flex-wrap:wrap;gap:6px"; gw.appendChild(gp); gw.appendChild(gr); h.appendChild(gw);
    }
  }

  // ---------------------------------------------------------------------------
  // Design rules window: rules, checks, net classes; edited on a copy, Apply commits
  // ---------------------------------------------------------------------------
  let draft = null;
  const CHECK_NAMES = { clearance: "Clearance", short: "Shorts", edge: "Board edge", unplaced: "Parts not placed", annular: "Annular rings", drill: "Minimum drill", width: "Minimum track width", class: "Track width of the net class",
    current: "Track width for the current", courtyard: "Parts overlapping", keepout: "Keep-out areas", silk: "Silkscreen over pads", dangling: "Unconnected track ends", pinout: "Pinouts to check",
    star: "Ground returns meet only at the star point", stopper: "Grid stoppers at the socket", coupling: "Grid tracks near anodes, heaters", heat: "Electrolytics near hot parts", support: "Mounting hole near each socket" };
  function openRules() {
    draft = JSON.parse(JSON.stringify(S.board.rules));
    document.querySelectorAll("#rules-modal [data-r]").forEach(el => { el.value = draft[el.dataset.r]; el.classList.remove("invalid"); });
    $("rules-tent").checked = draft.tentVias !== false;
    $("rules-ipc").value = draft.ipc || "B2"; $("rules-heaters").checked = draft.heaters !== false; $("rules-shields").checked = draft.shields !== false; $("rules-h126").value = draft.heater126 ? "1" : "0"; $("rules-socket").checked = draft.socketBody !== false;
    $("rules-ground").value = draft.ground === "star" ? "star" : "free"; $("rules-tear").checked = draft.teardrops !== false;
    $("rules-checks").innerHTML = Object.keys(CHECK_NAMES).map(k => `<label><input type="checkbox" data-c="${k}" ${draft.checks[k] !== false ? "checked" : ""}> ${CHECK_NAMES[k]}</label>`).join("");
    rulesNets();
    $("rules-modal").hidden = false;
  }
  function readRules() {
    let ok = true;
    document.querySelectorAll("#rules-modal [data-r]").forEach(el => { const v = parseFloat(String(el.value).replace(",", ".")), good = el.dataset.min !== undefined ? v >= +el.dataset.min : v > 0; if (!good) { el.classList.add("invalid"); ok = false; } else { el.classList.remove("invalid"); draft[el.dataset.r] = v; } });
    draft.tentVias = $("rules-tent").checked;
    draft.ipc = $("rules-ipc").value; draft.heaters = $("rules-heaters").checked; draft.shields = $("rules-shields").checked; draft.heater126 = $("rules-h126").value === "1"; draft.socketBody = $("rules-socket").checked;
    draft.ground = $("rules-ground").value; draft.teardrops = $("rules-tear").checked;
    document.querySelectorAll("#rules-checks [data-c]").forEach(el => { draft.checks[el.dataset.c] = el.checked; });
    return ok;
  }
  function rulesNets() {
    const tb = $("rules-nets");
    if (!S.model) { tb.innerHTML = `<tr><td colspan="6">The nets arrive from the Circuit CAD.</td></tr>`; return; }
    readRules();
    const hv = B.hvNets(S.netlist.volts, draft.hvVolts), rows = B.netTable({ ...S.board, rules: draft }, S.model, hv, S.netlist.volts), cr = B.clearanceRules({ ...S.board, rules: draft }, S.model, hv, S.netlist);
    tb.innerHTML = rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.pads}</td><td>${r.volts === null ? "—" : r.volts.toFixed(Math.abs(r.volts) >= 100 ? 0 : 1) + " V"}</td>
      <td><select data-net="${esc(r.name)}"><option value="">Auto (${esc(B.netClassOf(r.net, S.model.names, hv, { ...draft, netClass: {} }))})</option>${B.CLASSES.map(c => `<option value="${c}" ${r.manual && r.cls === c ? "selected" : ""}>${c}</option>`).join("")}</select></td>
      <td class="cls-${r.cls}">${r.track}</td><td class="cls-${r.cls}">${+Math.max(r.clearance, cr.toChassis(r.net).c).toFixed(2)}</td></tr>`).join("");
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
    const sh = S.board.sheet || {}; $("sheet-size").value = sh.size || "auto"; $("sheet-orient").value = sh.orient || "landscape";
    $("setup-modal").hidden = false;
  }
  const holesNow = () => { $("holes-now").textContent = setupHoles.length ? `${setupHoles.length} mounting hole${setupHoles.length > 1 ? "s" : ""}: ${setupHoles.map(h => `Ø${h.d} at ${h.x.toFixed(1)}, ${showY(h.y).toFixed(1)}`).slice(0, 4).join("; ")}` : "No mounting holes."; };
  function readOutline() {
    const o = {}; let ok = true;
    document.querySelectorAll("#setup-modal [data-o]").forEach(el => { const v = parseFloat(String(el.value).replace(",", ".")); const min = el.dataset.o === "r" ? 0 : 10; if (!(v >= min)) { el.classList.add("invalid"); ok = false; } else o[el.dataset.o] = v; });
    return ok ? o : null;
  }
  function applySetup() {
    const o = readOutline(); if (!o) return;
    setHeight(o.h);   // the origin (bottom left) stays put; the holes kept from before move with the board
    S.board.outline = { ...S.board.outline, ...o, r: Math.min(o.r, o.w / 2, o.h / 2) };
    document.querySelectorAll("#setup-modal [data-s]").forEach(el => { S.board.stackup[el.dataset.s] = +el.value; });
    S.board.holes = setupHoles;
    const sh = S.board.sheet || {}, size = $("sheet-size").value, orient = $("sheet-orient").value;
    $("setup-modal").hidden = true;
    if (size !== sh.size || orient !== sh.orient) setSheet({ size, orient }, `Board ${S.board.outline.w} × ${S.board.outline.h} mm`); else commit(`Board ${S.board.outline.w} × ${S.board.outline.h} mm`);
    fit();
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
      S.fills.filter(f => f.tear && f.layer === l).forEach(f => parts.push(`<polygon points="${f.pts.map(p => p.join(",")).join(" ")}" fill="${ink(l)}"/>`));
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
  // ---------------------------------------------------------------------------
  // 3D: the board with its parts (Board3D solids in the Viewer3D), its faces textured with the
  // real copper, mask openings, silkscreen and holes; STEP export of the same solids
  // ---------------------------------------------------------------------------
  let viewer = null, v3Timer = 0, pvCanvas = null, pv = null;
  function boardTexture(side) {
    const o = S.board.outline, k = Math.min(10, 4096 / Math.max(o.w, o.h)), c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(o.w * k)); c.height = Math.max(2, Math.round(o.h * k));
    const x = c.getContext("2d"); x.scale(k, k);
    const [cu, mask, silk] = side === "top" ? ["F.Cu", "F.Mask", "F.SilkS"] : ["B.Cu", "B.Mask", "B.SilkS"], ops = l => BoardFab.layerOps(S.board, S.model, S.fills, l);
    const P = B.outlinePoly(o, 0); x.fillStyle = "#14532d"; x.beginPath(); P.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.fill();
    BoardFab.paint(x, ops(cu), "#1f7a3e", "#14532d");          // copper under the mask: a lighter green
    BoardFab.paint(x, ops(mask), "#d4a72c", "#14532d");        // mask openings: tinned pads
    // the silkscreen on its own layer: its cut-outs round the pads erase silk, not the pads under it
    const sc = document.createElement("canvas"); sc.width = c.width; sc.height = c.height; const sx = sc.getContext("2d"); sx.scale(k, k);
    BoardFab.paint(sx, ops(silk), "#f2f2ea", "erase"); sx.globalCompositeOperation = "source-over"; x.drawImage(sc, 0, 0, o.w, o.h);
    x.globalCompositeOperation = "destination-out"; x.fillStyle = "#000";
    const d = BoardFab.drills(S.board, S.model);
    d.pth.concat(d.npth).forEach(([dia, pts]) => pts.forEach(([hx, hy]) => { x.beginPath(); x.arc(hx, hy, +dia / 2, 0, Math.PI * 2); x.fill(); }));
    return c;
  }
  function build3D(frame) {
    if (!viewer || !S.model) return;
    const sc = Board3D.scene(S.board, S.model, { tubes: $("v3-tubes").checked, parts: $("v3-parts").checked });
    viewer.setScene([sc.board, ...sc.bodies], { top: boardTexture("top"), bottom: boardTexture("bottom") }, frame);
  }
  function open3D() {
    if (!S.model) { msg("The board needs its parts: open the Circuit CAD first"); return; }
    if (S.route) finishRoute();
    $("view3d").hidden = false;
    if (!viewer) { viewer = new Viewer3D($("gl3d")); if (!viewer.ok) { viewer = null; $("view3d").hidden = true; msg("This browser cannot draw 3D (no WebGL)"); return; } }
    build3D(true); msg("3D view: drag to turn, right-drag to move, wheel to zoom; 3 or Esc goes back to the layout");
  }
  function close3D() { $("view3d").hidden = true; render(); }
  function exportStep() {
    if (!S.model) return;
    const name = baseName() + ".step", sc = Board3D.scene(S.board, S.model, { tubes: $("v3-tubes").checked });
    download(Board3D.step(sc, { title: fabMeta().title, version: appVersion(), file: name }), name, "application/step");
  }
  // the selected part in 3D, on a small piece of board, turning slowly (drag to turn it yourself)
  function partPreview(h, g) {
    if (typeof Viewer3D === "undefined") return;
    if (!pvCanvas) { pvCanvas = document.createElement("canvas"); pvCanvas.className = "preview3d"; pvCanvas.title = "3D model of the part: drag to turn, wheel to zoom"; pv = new Viewer3D(pvCanvas, { spin: true }); if (!pv.ok) { pv = null; return; } }
    if (!pv) return;
    h.appendChild(pvCanvas);
    const key = g.key + "|" + g.fp.name;
    if (pv.key !== key) { pv.key = key; pv.spin = true; pv.lastView = "iso"; pv.setScene(Board3D.preview(g, { tubes: true }), null, true); } else pv.draw();
  }

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
  // ---------------------------------------------------------------------------
  // Auto-route: Freerouting's API server on this computer (BoardRoute). The button stays grey
  // until it answers; the routes come back as tracks and vias, one step to undo
  // ---------------------------------------------------------------------------
  const ROUTER_KEY = "tubecad_router_url";
  const router = { url: BoardRoute.DEFAULT_URL, up: false, why: "down", busy: false, timer: 0 };
  try { router.url = localStorage.getItem(ROUTER_KEY) || router.url; } catch (e) { /* no storage */ }
  const pageOrigin = () => /^https?:/.test(location.origin) ? location.origin : "*";
  const startCmd = () => BoardRoute.command(pageOrigin());
  // what a probe found, in words: what to change on Freerouting's side
  function routerWhy(url, p) {
    if (p.ok) return `Freerouting answers at ${url}.`;
    if (p.why === "cors") return `Freerouting runs at ${url} but does not let this page in: restart it with --api_server.cors_origins=${pageOrigin()} (the commands below have it).`;
    if (p.why === "status") return `Something answers at ${url} (${p.code}), but not Freerouting's API: check the address and port.`;
    return `No answer from ${url}. Is Freerouting's API server on? Started without --api_server.enabled=true (or with its window), it does not listen. In Docker, use the command below: the image's own command listens only inside the container. If the browser asked to reach devices on your network, allow it.`;
  }
  function routerUi() {
    const b = $("btn-autoroute"); if (!b) return;
    b.classList.toggle("off", !router.up || router.busy);
    b.textContent = router.busy ? "Routing…" : "Auto-route";
    b.title = router.busy ? "Freerouting is routing the board" : router.up ? `Route the open connections with Freerouting (${router.url}), within the design rules; Ctrl+Z takes it back`
      : routerWhy(router.url, router) + " Click for the address and the commands.";
  }
  async function pollRouter() {
    clearTimeout(router.timer);
    const p = await BoardRoute.probe(router.url, 3000), up = p.ok;
    router.why = p.why; router.code = p.code;
    if (up !== router.up) { router.up = up; routerUi(); }
    router.timer = setTimeout(pollRouter, up ? 15000 : 5000);
  }
  function dsnOf() { analyse(); return BoardRoute.toDsn(S.board, S.model, S.conn, S.clr, { hv: S.hv, amps: S.amps, title: baseName(), version: appVersion() }); }
  // the routes of a session on the board, one step in the history; a summary of what is left
  function addRoutes(ses, d) {
    const todo = S.conn.unrouted, got = BoardRoute.prune(BoardRoute.fromSes(ses, S.board, d, S.model.names), S.board, S.model.pads);
    S.board.tracks.push(...got.tracks); S.board.vias.push(...got.vias);
    commit();
    const left = S.conn.unrouted, done = todo - left;
    return `${done} of ${todo} connection${todo === 1 ? "" : "s"} routed (${got.tracks.length} track${got.tracks.length === 1 ? "" : "s"}, ${got.vias.length} via${got.vias.length === 1 ? "" : "s"})` + (left ? `; ${left} left to route by hand` : "") + (S.drc.length ? `; ${S.drc.length} rule message${S.drc.length === 1 ? "" : "s"} to look at` : "");
  }
  // before an auto-route: copper left over from an earlier layout (parts moved since) goes, so Freerouting
  // routes those connections afresh: loose ends and lone vias, copper reaching no pad, copper joining two nets,
  // and tracks breaking a clearance. Locked copper stays. Returns how many tracks and vias went
  function clearStale() {
    const b = S.board, n0 = b.tracks.length + b.vias.length;
    for (let pass = 0; pass < 20; pass++) {
      analyse();
      const bad = new Set();
      S.conn.items.forEach(it => { if ((it.kind === "track" || it.kind === "via") && (it.net === null || it.net === "short")) bad.add(it.kind === "track" ? b.tracks[it.ti] : b.vias[it.vi]); });
      S.drc.filter(d => d.kind === "clearance" && d.between).forEach(d => b.tracks.forEach(t => { if (t.pts.some((p, k) => k && B.segDist(t.pts[k - 1][0], t.pts[k - 1][1], p[0], p[1], d.x, d.y) <= t.w / 2 + 0.01)) bad.add(t); }));
      const go = [...bad].filter(o => o && !o.locked);
      if (!go.length) break;
      b.tracks = b.tracks.filter(t => !go.includes(t)); b.vias = b.vias.filter(v => !go.includes(v));
    }
    dropResidue(null);
    return n0 - b.tracks.length - b.vias.length;
  }
  async function autoRoute() {
    if (router.busy) return;
    if (!S.model) { msg("Open the Circuit CAD first: the board needs its parts"); return; }
    if (!router.up) { await pollRouter(); if (!router.up) { msg(`No Freerouting at ${router.url}: see Board ▾ → Freerouting…`); routerSetup(); return; } }
    const stale = clearStale(), staleNote = stale ? ` · ${stale} old piece${stale === 1 ? "" : "s"} of copper cleared first (left from where the parts were)` : "";
    if (!S.conn.unrouted) { if (stale) commit(); msg("Nothing to route: every connection is routed" + staleNote); return; }
    const d = dsnOf();
    router.busy = true; routerUi(); msg(`Freerouting is routing ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"}…`);
    try {
      const r = await BoardRoute.route(router.url, d.text, { version: appVersion() });
      msg(addRoutes(r.ses, d) + (d.skipped.length ? ` · left to the pour: ${d.skipped.join(", ")}` : "") + staleNote);
    } catch (e) { if (stale) commit(); msg(`Auto-route failed: ${e.message}` + staleNote); router.up = false; pollRouter(); }
    finally { router.busy = false; routerUi(); }
  }
  // Unroute: every track and via off the board (locked ones stay), one step to undo
  function unroute() {
    const b = S.board, n = b.tracks.length + b.vias.length;
    const tracks = b.tracks.filter(t => t.locked), vias = b.vias.filter(v => v.locked), kept = tracks.length + vias.length;
    if (n === kept) { msg(n ? "Every track and via is locked: nothing to remove" : "No tracks or vias to remove"); return; }
    const gone = b.tracks.length - tracks.length, vgone = b.vias.length - vias.length;
    b.tracks = tracks; b.vias = vias; S.sel = null; S.route = null;
    commit(`Removed ${gone} track${gone === 1 ? "" : "s"} and ${vgone} via${vgone === 1 ? "" : "s"}` + (kept ? `; ${kept} locked kept` : "") + "; Ctrl+Z brings them back");
  }
  // Board ▾ → Freerouting…: the address (this computer or another on the network) and how to start it
  function routerSetup() {
    const origin = pageOrigin();
    $("router-addr").value = router.url.replace(/^http:\/\//, "");
    $("router-cmd-java").textContent = BoardRoute.command(origin); $("router-cmd-docker").textContent = BoardRoute.dockerCommand(origin);
    $("router-state").textContent = routerWhy(router.url, router);
    $("router-modal").hidden = false; $("router-addr").focus();
  }
  async function routerTest() {
    const url = BoardRoute.address($("router-addr").value), st = $("router-state");
    if (!url) { st.textContent = "That is not an address: an IP or a name, and :port if not 37864"; return; }
    st.textContent = `Asking ${url}…`;
    st.textContent = routerWhy(url, await BoardRoute.probe(url, 3000));
  }
  function routerSave() {
    const url = BoardRoute.address($("router-addr").value);
    if (!url) { $("router-state").textContent = "That is not an address: an IP or a name, and :port if not 37864"; return; }
    router.url = url; router.up = false; $("router-modal").hidden = true;
    try { localStorage.setItem(ROUTER_KEY, router.url); } catch (e) { /* no storage */ }
    routerUi(); pollRouter().then(() => msg(router.up ? `Freerouting answers at ${router.url}` : `No Freerouting at ${router.url} yet: Auto-route stays grey until it answers`));
  }
  function importSes(file) {
    if (!file || !S.model) return;
    file.text().then(t => { try { msg(addRoutes(t, dsnOf())); } catch (e) { msg(`Not imported: ${e.message}`); } });
  }
  function msg(t) { if (t) { const el = $("st-msg"); el.textContent = t; el.title = t; } }
  function init() {
    canvas = $("pcb"); ctx = canvas.getContext("2d"); dpr = window.devicePixelRatio || 1; canvas.tabIndex = 0;
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    canvas.addEventListener("dblclick", e => {
      if (S.route) finishRoute(); else if (S.poly) closePoly();
      else { const [x, y] = toWorld(...evPos(e)), k = hitAreaCorner(x, y); if (k >= 0) dropCorner(k); }
    });
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    window.addEventListener("keydown", onKey); window.addEventListener("keyup", e => { if (e.key === " ") S.space = false; });
    window.addEventListener("resize", render);
    Panels.columns(document.querySelector("main"), { key: "board", minViewport: 1000, minCenter: 360,
      cols: [{ index: 0, side: "left", def: 220, min: 160, max: 480 }, { index: 2, side: "right", def: 300, min: 220, max: 640 }], template: w => (S.bare ? "1fr" : `${w[0]}px 1fr ${w[1]}px`) });
    // comfort: the zoom bar, side panels, the find box, sections that remember being folded, the menu closing
    $("z-in").onclick = () => zoomAt(1.25); $("z-out").onclick = () => zoomAt(0.8); $("z-pct").onclick = () => fit(); $("z-sel").onclick = zoomToSel;
    $("btn-panels").onclick = () => setBare(!S.bare);
    $("find").addEventListener("input", e => { S.find = e.target.value; renderPanels(); });
    $("find").addEventListener("keydown", e => {
      if (e.key === "Escape") { e.target.value = ""; S.find = ""; renderPanels(); e.target.blur(); }
      else if (e.key === "Enter") {
        const first = document.querySelector($("nets").hidden ? "#parts .item" : "#nets .net");
        if (first) first.click(); if (!$("nets").hidden) zoomToSel(); e.target.blur();
      }
    });
    const SEC_KEY = "tubecad_board_sections";
    let secs = {}; try { secs = JSON.parse(localStorage.getItem(SEC_KEY) || "{}"); } catch (e) { /* no storage */ }
    document.querySelectorAll("details.sec").forEach(d => { if (secs[d.id] === false) d.open = false; d.addEventListener("toggle", () => { secs[d.id] = d.open; try { localStorage.setItem(SEC_KEY, JSON.stringify(secs)); } catch (e) { /* no storage */ } }); });
    document.addEventListener("mousedown", e => { if (!$("ctx").contains(e.target)) closeCtx(); });
    canvas.addEventListener("mouseleave", () => { clearTimeout(hudTimer); hudAt = null; $("hud").hidden = true; if (S.hoverPart) { S.hoverPart = null; render(); } });
    document.querySelectorAll("[data-tool]").forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
    $("layer").onchange = e => setLayer(e.target.value);
    $("grid").onchange = e => { S.grid = +e.target.value; render(); };
    $("dim").oninput = e => { S.dim = +e.target.value; render(); };
    $("btn-fit").onclick = e => (e.shiftKey ? fitSheet() : fit());
    $("sheet-pick").onchange = e => { const [size, orient] = e.target.value.split(" "); setSheet(orient ? { size, orient } : { size }); if (size !== "none") fitSheet(); };
    $("btn-sheet-lock").onclick = () => lockSheet(!(S.board.sheet || {}).locked);
    gridUi(); document.querySelectorAll("[data-gs]").forEach(b => { b.onclick = () => setGridStyle(b.dataset.gs); });
    $("btn-axes").classList.toggle("active", S.axes); $("btn-axes").onclick = () => setAxes(!S.axes); $("btn-undo").onclick = undo; $("btn-redo").onclick = redo;
    $("btn-sync").onclick = syncNow; $("banner-sync").onclick = syncNow;
    $("btn-setup").onclick = openSetup; $("btn-rules").onclick = openRules;
    $("rules-apply").onclick = applyRules; $("rules-cancel").onclick = () => { $("rules-modal").hidden = true; };
    $("rules-reset").onclick = () => { const nc = draft.netClass; draft = { ...B.defaultRules(), netClass: nc }; $("rules-tent").checked = true; document.querySelectorAll("#rules-modal [data-r]").forEach(el => { el.value = draft[el.dataset.r]; }); document.querySelectorAll("#rules-checks [data-c]").forEach(el => { el.checked = true; }); rulesNets(); };
    document.querySelectorAll("#rules-modal [data-r]").forEach(el => el.addEventListener("change", rulesNets));
    $("rules-ipc").addEventListener("change", rulesNets);
    $("setup-apply").onclick = applySetup; $("setup-cancel").onclick = () => { $("setup-modal").hidden = true; };
    $("holes-corners").onclick = () => { const o = readOutline() || S.board.outline, d = +$("hole-d").value, inset = parseFloat($("hole-inset").value) || 5; setupHoles = B.cornerHoles(o, d, inset).map(h => ({ ...h, locked: true })); holesNow(); };
    $("holes-clear").onclick = () => { setupHoles = []; holesNow(); };
    $("btn-cad").onclick = () => ToolWindows.open("circuit_sandbox.html");
    $("btn-help").onclick = () => { $("help-modal").hidden = false; }; $("btn-help-close").onclick = () => { $("help-modal").hidden = true; };
    // the toolbar's menus (one open at a time; ticks keep it open) and the state of their ticks
    UiKit.menus(document.querySelector("header"));
    const list = $("export-menu").querySelector(".menu-list");
    $("ex-svg").onclick = () => { list.hidden = true; download(svgDoc(["F.Cu", "B.Cu", "F.SilkS", "Edge.Cuts"], false), baseName() + "-board.svg", "image/svg+xml"); };
    $("ex-gerber").onclick = () => { list.hidden = true; exportGerber(); };
    $("ex-step").onclick = () => { list.hidden = true; exportStep(); };
    $("btn-3d").onclick = () => ($("view3d").hidden ? open3D() : close3D());
    $("v3-close").onclick = close3D; $("v3-step").onclick = exportStep;
    $("v3-png").onclick = () => { if (!viewer) return; const a = document.createElement("a"); a.href = viewer.png(); a.download = baseName() + "-3d.png"; a.click(); msg("Saved " + a.download); };
    document.querySelectorAll("[data-view]").forEach(b => { b.onclick = () => viewer && viewer.view(b.dataset.view); });
    ["v3-parts", "v3-tubes"].forEach(id => { $(id).onchange = () => build3D(false); });
    window.addEventListener("resize", () => { if (viewer && !$("view3d").hidden) viewer.draw(); });
    $("ex-pdf").onclick = () => { list.hidden = true; exportPdf("print"); };
    $("ex-toner").onclick = () => { list.hidden = true; exportPdf("toner"); };
    document.querySelectorAll("[data-tab]").forEach(t => { t.onclick = () => { document.querySelectorAll("[data-tab]").forEach(x => x.classList.toggle("active", x === t)); $("parts").hidden = t.dataset.tab !== "parts"; $("nets").hidden = t.dataset.tab !== "nets"; }; });
    $("ex-json").onclick = () => { list.hidden = true; download(JSON.stringify(S.board, null, 1), baseName() + "-board.json", "application/json"); };
    $("ex-dsn").onclick = () => { list.hidden = true; if (S.model) download(dsnOf().text, baseName() + ".dsn", "text/plain"); };
    $("btn-autoroute").onclick = autoRoute; $("btn-unroute").onclick = unroute; $("btn-router").onclick = routerSetup;
    $("router-test").onclick = routerTest; $("router-save").onclick = routerSave; $("router-cancel").onclick = () => { $("router-modal").hidden = true; };
    $("router-addr").onkeydown = e => { if (e.key === "Enter") routerSave(); };
    $("btn-ses").onclick = () => $("ses-file").click(); $("ses-file").onchange = e => { importSes(e.target.files[0]); e.target.value = ""; };
    routerUi(); pollRouter();
    renderPanels(); fit(); hello();
  }
  window.BoardApp = { autoRoute, unroute, clearStale, router, open3D, close3D, exportStep, viewer: () => viewer, preview: () => pv, state: S, analyse, commit, groundPlane, highlightNet, selectConnected, exportGerber, exportPdf, fabFiles: () => BoardFab.fabFiles(S.board, S.model, S.fills, fabMeta()), routeCheck, syncNow, fit, fitSheet, sheetPlace, setSheet, lockSheet, onSheet, moveOnSheet, centreOnSheet, snapPoint, setTool, setLayer, undo, redo, svgDoc, openRules, openSetup, toWorld, toScreen: (x, y) => [x * S.view.scale + S.view.ox, y * S.view.scale + S.view.oy] };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
