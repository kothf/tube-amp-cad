/* The Board window's construction geometry (board-construct.js does the geometry): the Construct
   menu and its tools (construction line, offset, circle / arc, reference point), the numbers typed
   on the board (the HUD: θ, d, R, Δx Δy, Ø), snapping to construction points and crossings, the
   hole tool placing holes tied to what it snapped to, the dashed drawing, the inspector of a
   construction item and the tie and finish of a mounting hole. A factory, like board-panels.js:
   BoardCons(app) takes what it needs from board-app.js by name. */
(function (root) {
  "use strict";
  root.BoardCons = function (app) {
    const { $, B, S, commit, msg, snap } = app;
    const K = root.BoardConstruct, RAD = Math.PI / 180, R4 = v => Math.round(v * 1e4) / 1e4;
    const render = () => app.render(), renderPanels = () => app.renderPanels();
    const TOOLS = ["cline", "coffset", "ccircle", "cpoint"];
    const COLOR = "#c792ea";   // the construction layer's colour
    const HELP = {
      cline: "Construction line: click a point, then a second one (they stick to holes, pads, corners, construction points and crossings); or type the angle θ and press Enter. Shift: steps of 15°; Alt: the grid only",
      coffset: "Offset: click a board edge, a keep-out edge or a construction line or circle, then click (or type d and press Enter) how far away. Shift+click on the board outline: the whole contour",
      ccircle: "Construction circle: click the centre (a hole, pad or point), then click (or type R and press Enter) the radius",
      cpoint: "Reference point: click where it goes; type Δx Δy first to put it that far from what the pointer sticks to (a hole, pad, corner, crossing)"
    };
    const HUDF = { cline: [["ang", "θ", "°"]], coffset: [["d", "d", "mm"]], ccircle: [["r", "R", "mm"]], cpoint: [["dx", "Δx", "mm"], ["dy", "Δy", "mm"]], hole: [["dx", "Δx", "mm"], ["dy", "Δy", "mm"], ["d", "Ø", "mm"]] };
    const T = { a: null, pick: null, hover: null, sp: null, hud: {}, from: null };   // the tool in progress
    const last = new WeakMap();   // where each tied hole was put the last time (K.applyHoles)
    const SNAP_KEY = "tubecad_board_snap";
    let snapSet = { ...K.SNAP_DEFAULT };
    try { snapSet = { ...snapSet, ...JSON.parse(localStorage.getItem(SNAP_KEY) || "{}") }; } catch (e) { /* no storage */ }
    let holeD = 3.2;   // the hole tool's diameter: the last one placed or set

    const H = () => S.board.outline.h;
    const toU = (x, y) => [x, H() - y], fromU = p => [p[0], H() - p[1]];
    const cs = () => S.board.construct || K.normalise(S.board);
    const active = () => TOOLS.includes(S.tool) || S.tool === "hole";
    const shown = () => !cs().hide;

    // ---------------------------------------------------------------------------
    // Solving (from analyse): every item, and the holes tied to them moved where they belong
    // ---------------------------------------------------------------------------
    function solve() { S.csol = K.solve(S.board, S.model); S.cholesLost = K.applyHoles(S.csol, last); }
    const sol = () => S.csol || (solve(), S.csol);

    // ---------------------------------------------------------------------------
    // Snapping: construction candidates for snapPoint (board coordinates, y down)
    // ---------------------------------------------------------------------------
    function snapInto(x, y, at, phase) {
      if (!S.csol || !shown()) return;
      const u = toU(x, y), tol = 10 / S.view.scale;
      K.snaps(S.csol, u[0], u[1], tol, snapSet, T.from).forEach(c => {
        if ((phase === "on") !== (c.shape === "on")) return;
        const p = fromU(c.p); at(p[0], p[1], c.what, c.shape === "tan" ? "on" : c.shape, { kind: "point", ref: c.ref });
      });
    }
    // what a snap (from snapPoint) is tied to, as a point of the construction (user frame)
    function specOf(sp) {
      const u = toU(sp.p[0], sp.p[1]), fixed = { x: R4(u[0]), y: R4(u[1]) };
      if (!sp || sp.shape === "grid") return fixed;
      if (sp.ref) return { ref: sp.ref };
      const b = S.board, s = sol();
      if (sp.kind === "pad" && sp.pad) return { ref: { t: "pad", part: sp.pad.part, num: String(sp.pad.num) } };
      if (sp.kind === "hole" && sp.hole && b.holes.includes(sp.hole)) {
        const id = K.idOf(b, sp.hole, "h");
        if (sp.shape === "on") { const c = toU(sp.hole.x, sp.hole.y); return { ref: { t: "hole", id }, pr: R4(sp.hole.d / 2), pa: R4(Math.atan2(u[1] - c[1], u[0] - c[0]) / RAD) }; }
        return { ref: { t: "hole", id } };
      }
      if (sp.kind === "via" && sp.via && b.vias.includes(sp.via)) return { ref: { t: "via", id: K.idOf(b, sp.via, "v") } };
      if (sp.shape !== "on" && (/^board (corner|centre)$/.test(sp.what) || sp.what === "middle of the board edge")) {
        const at = ["BL", "BR", "TL", "TR", "C", "B", "T", "L", "R"].find(k => { const p = s.refPt({ t: "board", at: k }); return Math.hypot(p[0] - u[0], p[1] - u[1]) < 1e-6; });
        if (at) return { ref: { t: "board", at } };
      }
      if (sp.what === "keep-out corner") for (const ko of b.keepouts) { const k = ko.pts.findIndex(p => Math.hypot(p[0] - sp.p[0], p[1] - sp.p[1]) < 1e-6); if (k >= 0) return { ref: { t: "ko", id: K.idOf(b, ko, "k"), k } }; }
      if (/ origin$/.test(sp.what) && S.model) { const g = S.model.parts.find(q => q.place && Math.hypot(q.place.x - sp.p[0], q.place.y - sp.p[1]) < 1e-6); if (g) return { ref: { t: "part", key: g.key } }; }
      if (sp.kind === "edge" && sp.shape === "on") { const e = K.pick(s, u[0], u[1], 1e-3, { cons: false, keepouts: false }); if (e && e.c.t === "L") return { ref: { t: "on", g: { id: e.id, k: e.k }, u: R4(e.n.u) } }; }
      return fixed;
    }
    const withOff = (P, dx, dy) => { if (!dx && !dy) return P; if (P.ref) return { ...P, dx: R4((P.dx || 0) + dx), dy: R4((P.dy || 0) + dy) }; return { x: R4(P.x + dx), y: R4(P.y + dy) }; };

    // ---------------------------------------------------------------------------
    // The HUD: numbers typed while a tool is on (θ, d, R, Δx Δy, Ø), shown by the pointer
    // ---------------------------------------------------------------------------
    const hudNum = k => { const v = parseFloat(String(T.hud[k] === undefined ? "" : T.hud[k]).replace(",", ".")); return Number.isFinite(v) ? v : null; };
    function buildHud() {
      const el = $("chud"); if (!el) return;
      const f = HUDF[S.tool];
      if (!f) { el.hidden = true; el.innerHTML = ""; return; }
      el.innerHTML = f.map(([k, l, u]) => `<label title="${HUD_TIP[k]}">${l} <input data-k="${k}" inputmode="decimal" autocomplete="off" placeholder="${k === "d" && S.tool === "hole" ? holeD : ""}" value="${T.hud[k] === undefined ? "" : T.hud[k]}"> <small>${u}</small></label>`).join("") + `<small class="chud-k">Enter · Esc</small>`;
      el.querySelectorAll("input").forEach(inp => {
        inp.addEventListener("input", () => { T.hud[inp.dataset.k] = inp.value; render(); });
        inp.addEventListener("keydown", e => {
          if (e.key === "Enter") { e.preventDefault(); enter(); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); T.hud = {}; buildHud(); app.canvas().focus(); render(); }
          e.stopPropagation();
        });
      });
      el.hidden = false; placeHud();
    }
    const HUD_TIP = { ang: "The line's angle, degrees counter-clockwise from the X axis (Enter places it)", d: "How far: mm (Enter places it)", r: "The radius, mm (Enter places it)", dx: "Along X from what the pointer sticks to, mm", dy: "Along Y (up) from what the pointer sticks to, mm" };
    function placeHud() {
      const el = $("chud"); if (!el || el.hidden) return;
      if (el.contains(document.activeElement)) return;   // it stays put while typing
      const [sx, sy] = app.toScreen(S.mouse[0], S.mouse[1]), st = $("stage"), W = st.clientWidth, Hh = st.clientHeight;
      let left = sx + 18, top = sy + 22;   // below and right of the pointer (the snap's name sits right of it)
      if (left + el.offsetWidth > W - 6) left = sx - el.offsetWidth - 18;
      if (top + el.offsetHeight > Hh - 6) top = sy - el.offsetHeight - 22;
      el.style.left = Math.max(4, Math.min(W - el.offsetWidth - 4, left)) + "px"; el.style.top = Math.max(4, Math.min(Hh - el.offsetHeight - 4, top)) + "px";
    }
    // a digit typed on the board goes into the HUD's first field
    function hudKey(e) {
      const el = $("chud"); if (!el || el.hidden || e.ctrlKey || e.metaKey || e.altKey) return false;
      if (!/^[0-9.,]$/.test(e.key) && !(e.key === "-" && TOOLS.includes(S.tool))) return false;
      const inp = el.querySelector("input"); if (!inp) return false;
      e.preventDefault(); inp.focus(); inp.value += e.key; T.hud[inp.dataset.k] = inp.value; render();
      return true;
    }

    // ---------------------------------------------------------------------------
    // Tools
    // ---------------------------------------------------------------------------
    function toolChanged(t) {
      T.a = null; T.pick = null; T.hover = null; T.from = null; T.hud = {};
      if (TOOLS.includes(t) && !shown()) { cs().hide = false; commit(); menuState(); }
      const b = $("btn-cons"); if (b) b.classList.toggle("active", TOOLS.includes(t));
      buildHud();
    }
    function curSnap(x, y, e) { const gridOnly = !!(e && e.altKey) || (S.tool !== "cline" && !!(e && e.shiftKey)); return app.snapPoint(x, y, gridOnly); }
    function onMove(x, y, e) {
      if (!active()) return;
      T.sp = curSnap(x, y, e);
      if (S.tool === "coffset" && !T.pick) { const u = toU(x, y); T.hover = K.pick(sol(), u[0], u[1], 10 / S.view.scale); }
      T.shift = !!(e && e.shiftKey);
      placeHud();
    }
    // the pointer's distance for an offset: positive into the board for its edges, outwards for circles and keep-outs, left of a line
    function offsetD(pk, u) {
      const c = pk.c, s = sol();
      if (pk.id === "@outline" && (pk.k === undefined || pk.k === null)) return B.edgeDist(u[0], H() - u[1], S.board.outline);
      if (c.t === "C") { const d = Math.hypot(u[0] - c.cx, u[1] - c.cy) - c.r; return pk.id === "@outline" ? -d : d; }
      const len = Math.hypot(c.x2 - c.x1, c.y2 - c.y1), left = ((c.x2 - c.x1) * (u[1] - c.y1) - (c.y2 - c.y1) * (u[0] - c.x1)) / len;
      if (typeof pk.id === "string" && pk.id.startsWith("@ko:")) { const ko = S.board.keepouts.find(q => q.id === pk.id.slice(4)); return ko && s.koTurn(ko) > 0 ? -left : left; }
      return left;
    }
    const roundD = v => { const st = S.view.scale > 25 ? 0.1 : 0.5; return R4(Math.round(v / st) * st); };
    // the line's second point with Shift: the angle in steps of 15°
    function lineEnd(u) {
      const a = T.a.p, ang = hudNum("ang");
      if (ang !== null) return { ang };
      if (T.shift) { const raw = Math.atan2(u[1] - a[1], u[0] - a[0]) / RAD; return { ang: R4(Math.round(raw / 15) * 15) }; }
      return null;
    }
    function previewItem() {
      if (!T.sp && S.tool !== "coffset") return null;
      const u = T.sp ? toU(T.sp.p[0], T.sp.p[1]) : toU(S.mouse[0], S.mouse[1]);
      if (S.tool === "cline" && T.a) {
        const le = lineEnd(u);
        if (le) return { curves: [{ t: "L", x1: T.a.p[0], y1: T.a.p[1], x2: T.a.p[0] + Math.cos(le.ang * RAD), y2: T.a.p[1] + Math.sin(le.ang * RAD), ext: "line" }], note: `θ ${le.ang.toFixed(1)}°` };
        if (Math.hypot(u[0] - T.a.p[0], u[1] - T.a.p[1]) < 1e-6) return null;
        return { curves: [{ t: "L", x1: T.a.p[0], y1: T.a.p[1], x2: u[0], y2: u[1], ext: "line" }], note: `θ ${(Math.atan2(u[1] - T.a.p[1], u[0] - T.a.p[0]) / RAD).toFixed(1)}°` };
      }
      if (S.tool === "coffset" && T.pick) {
        const um = toU(S.mouse[0], S.mouse[1]), d = hudNum("d") !== null ? hudNum("d") : roundD(offsetD(T.pick, um));
        const r = sol().offsetOf({ id: T.pick.id, k: T.pick.k }, d); return { curves: r.curves, note: `d ${d.toFixed(2)} mm`, d };
      }
      if (S.tool === "ccircle" && T.a) {
        const um = toU(S.mouse[0], S.mouse[1]), r = hudNum("r") !== null ? hudNum("r") : roundD(Math.hypot(um[0] - T.a.p[0], um[1] - T.a.p[1]));
        return r > 0 ? { curves: [{ t: "C", cx: T.a.p[0], cy: T.a.p[1], r }], note: `R ${r.toFixed(2)} mm`, r } : null;
      }
      if (S.tool === "cpoint" || S.tool === "hole") { const dx = hudNum("dx") || 0, dy = hudNum("dy") || 0; return { pt: [u[0] + dx, u[1] + dy], base: u, curves: [] }; }
      return null;
    }
    function addItem(item, text) {
      const it = K.add(S.board, item);
      S.sel = { kind: "cons", id: it.id }; T.hud = {}; buildHud();
      commit(text || `${K.NAMES[it.k]} ${K.label(it).split(" ").pop()}: ${K.describe(sol(), it)}`);
      return it;
    }
    // a click on the board with a construction tool (or the hole tool): true when handled
    function onDown(x, y, e) {
      if (!active()) return false;
      if (TOOLS.includes(S.tool) && cs().lock) { msg("The construction is locked: Construct ▾ → Lock construction unlocks it"); return true; }
      T.sp = curSnap(x, y, e); T.shift = !!e.shiftKey;
      const sp = T.sp, u = toU(sp.p[0], sp.p[1]);
      if (S.tool === "cline") {
        if (!T.a) { T.a = { p: u, P: specOf(sp) }; T.from = { p: u, P: T.a.P }; msg(`From ${K.pointName(sol(), T.a.P)}: click the second point, or type θ and press Enter (Shift: steps of 15°)`); render(); return true; }
        const le = lineEnd(u);
        if (le) { finishLine({ a: T.a.P, ang: le.ang }); return true; }
        if (Math.hypot(u[0] - T.a.p[0], u[1] - T.a.p[1]) < 1e-6) { msg("The second point is the first one: click somewhere else"); return true; }
        finishLine({ a: T.a.P, b: specOf(sp) }); return true;
      }
      if (S.tool === "coffset") {
        if (!T.pick) {
          const pk = T.hover || (() => { const uu = toU(x, y); return K.pick(sol(), uu[0], uu[1], 10 / S.view.scale); })();
          if (!pk) { msg("Click a board edge, a keep-out edge or a construction line or circle to offset"); return true; }
          T.pick = { id: pk.id, k: pk.id === "@outline" && e.shiftKey ? undefined : pk.k, c: pk.c };
          msg(`Offset of ${T.pick.k === undefined ? "the whole board outline" : K.curveName(sol(), pk)}: click how far away, or type d and press Enter`); render(); return true;
        }
        const pv = previewItem(); if (!pv || !pv.curves.length) { msg("Not there: the offset would vanish (a circle's radius below zero, or past the board's middle)"); return true; }
        addItem({ k: "offset", of: T.pick.k === undefined ? { id: T.pick.id } : { id: T.pick.id, k: T.pick.k }, d: pv.d }); T.pick = null; return true;
      }
      if (S.tool === "ccircle") {
        if (!T.a) { T.a = { p: u, P: specOf(sp) }; msg(`Centre at ${K.pointName(sol(), T.a.P)}: click the radius, or type R and press Enter`); render(); return true; }
        const pv = previewItem(); if (!pv) { msg("The radius is zero: click further from the centre"); return true; }
        addItem({ k: "circle", c: T.a.P, r: pv.r }); T.a = null; return true;
      }
      if (S.tool === "cpoint") { addItem({ k: "point", at: withOff(specOf(sp), hudNum("dx") || 0, hudNum("dy") || 0) }); return true; }
      if (S.tool === "hole") { placeHole(sp); return true; }
      return false;
    }
    function finishLine(it) { addItem({ k: "line", ...it, ext: "line" }); T.a = null; T.from = null; }
    // Enter in the HUD: place what the typed numbers say, at the last place the pointer stuck to
    function enter() {
      if (S.tool === "cline") { if (!T.a) { msg("Click the line's first point first"); return; } const ang = hudNum("ang"); if (ang === null) { msg("Type the angle θ"); return; } finishLine({ a: T.a.P, ang }); }
      else if (S.tool === "coffset") { if (!T.pick) { msg("Click what to offset first"); return; } if (hudNum("d") === null) { msg("Type the distance d"); return; } const pv = previewItem(); if (!pv || !pv.curves.length) { msg("That offset vanishes"); return; } addItem({ k: "offset", of: T.pick.k === undefined ? { id: T.pick.id } : { id: T.pick.id, k: T.pick.k }, d: pv.d }); T.pick = null; }
      else if (S.tool === "ccircle") { if (!T.a) { msg("Click the centre first"); return; } const r = hudNum("r"); if (!(r > 0)) { msg("Type the radius R"); return; } addItem({ k: "circle", c: T.a.P, r }); T.a = null; }
      else if (S.tool === "cpoint" && T.sp) addItem({ k: "point", at: withOff(specOf(T.sp), hudNum("dx") || 0, hudNum("dy") || 0) });
      else if (S.tool === "hole" && T.sp) placeHole(T.sp);
      app.canvas().focus();
    }
    // the hole tool: a hole where the pointer sticks (Δx Δy from it), tied to it unless that is the grid
    function placeHole(sp) {
      const P = withOff(specOf(sp), hudNum("dx") || 0, hudNum("dy") || 0), d = hudNum("d") > 0 ? hudNum("d") : holeD, s = sol(), p = s.pointOf(P);
      if (!p) return;
      holeD = d;
      const h = { x: R4(p[0]), y: R4(H() - p[1]), d };
      if (P.ref) h.at = P;
      S.board.holes.push(h); S.sel = { kind: "hole", i: S.board.holes.length - 1 }; T.hud = {}; buildHud();
      const wall = B.edgeDist(h.x, h.y, S.board.outline) - d / 2, need = S.board.rules.holeEdge;
      commit(`Mounting hole Ø${d} mm placed${h.at ? `, tied to ${K.pointName(s, P)}: it follows it (Detach in the inspector)` : " (change it in the inspector)"}${wall < need ? ` — its wall is ${Math.max(0, wall).toFixed(2)} mm from the board edge (rule ${need} mm)` : ""}`);
    }
    // Esc in a tool: drop the step in progress (true), or nothing to drop (false)
    function escape() {
      if (T.a || T.pick) { T.a = null; T.pick = null; T.from = null; T.hud = {}; buildHud(); msg(HELP[S.tool] || ""); render(); return true; }
      return false;
    }

    // ---------------------------------------------------------------------------
    // Selecting and dragging items (select tool)
    // ---------------------------------------------------------------------------
    function hit(x, y) { if (!S.csol || !shown()) return null; const u = toU(x, y); return K.hitItem(S.csol, u[0], u[1], 6 / S.view.scale); }
    // a click with the select tool on a construction item: select it and start dragging it
    // early: before the board's own things (then only points, or anything with Alt); late: on empty board
    function select(x, y, early, alt) {
      const id = hit(x, y); if (!id) return false;
      const it = cs().items.find(q => q.id === id); if (!it) return false;
      if (early && it.k !== "point" && !alt) return false;
      S.sel = { kind: "cons", id };
      const u = toU(x, y);
      S.drag = cs().lock ? { kind: "locked" } : { kind: "cons", id, u0: u, base: JSON.stringify(it), moved: false, rim: it.k === "circle" && (() => { const c = S.csol.items[id].curves[0]; return c && Math.abs(Math.hypot(u[0] - c.cx, u[1] - c.cy) - c.r) < 6 / S.view.scale; })() };
      renderPanels(); render(); return true;
    }
    function drag(d, x, y) {
      const it = cs().items.find(q => q.id === d.id); if (!it) return;
      const base = JSON.parse(d.base), u = toU(x, y), dx = R4(snap(u[0] - d.u0[0])), dy = R4(snap(u[1] - d.u0[1])), s = sol();
      const move = (P, Q) => { const p = s.pointOf(P); return p ? K.rebase(s, JSON.parse(JSON.stringify(P)), [p[0] + dx, p[1] + dy]) : Q; };
      Object.keys(it).forEach(k => delete it[k]); Object.assign(it, base);
      if (it.k === "point") it.at = move(base.at, it.at);
      else if (it.k === "line") { it.a = move(base.a, it.a); if (base.b) it.b = move(base.b, it.b); }
      else if (it.k === "circle") { if (d.rim) { const c = s.pointOf(base.c); if (c) it.r = R4(Math.max(0.05, roundD(Math.hypot(u[0] - c[0], u[1] - c[1]) - (base.rim ? s.rimOf(base.c) : 0)))); } else it.c = move(base.c, it.c); }
      else if (it.k === "offset") { const src = s.offsetOf(base.of, 0).curves[0]; if (src) it.d = roundD(offsetD({ id: base.of.id, k: base.of.k, c: src }, u)); }
      else if (it.k === "polar") it.c = move(base.c, it.c);
      else { if (!d.noted) { d.noted = true; msg("Arrays and detached items are changed in the inspector"); } return; }
      d.moved = JSON.stringify(it) !== d.base;
      solve(); if (K.dependents(S.board, it.id).holes.length || S.board.holes.some(h => h.at)) app.analyse(true); render();
    }
    function nudge(dx, dy) {
      const it = selItem(); if (!it) return;
      if (cs().lock) { msg("The construction is locked"); return; }
      const s = sol(), mv = P => { const p = s.pointOf(P); return p ? K.rebase(s, P, [p[0] + dx, p[1] - dy]) : P; };
      if (it.k === "point") mv(it.at); else if (it.k === "line") { mv(it.a); if (it.b) mv(it.b); } else if (it.k === "circle" || it.k === "polar") mv(it.c); else { msg("Arrays and offsets are changed in the inspector"); return; }
      commit();
    }
    const selItem = () => (S.sel && S.sel.kind === "cons" ? cs().items.find(q => q.id === S.sel.id) : null);
    // delete an item: what depended on it keeps its place, cut loose
    function deleteSel() {
      const it = selItem(); if (!it) return;
      if (cs().lock) { msg("The construction is locked: Construct ▾ → Lock construction unlocks it"); return; }
      const s = sol(), dep = K.dependents(S.board, it.id);
      dep.items.forEach(q => K.detach(s, q)); dep.holes.forEach(h => { delete h.at; });
      cs().items.splice(cs().items.indexOf(it), 1); S.sel = null;
      const n = dep.items.length + dep.holes.length;
      commit(`${K.label(it)} deleted${n ? `; ${n} thing${n > 1 ? "s" : ""} drawn from it ${n > 1 ? "stay where they are" : "stays where it is"} (detached)` : ""}`);
    }

    // ---------------------------------------------------------------------------
    // Batch holes, arrays, clearing
    // ---------------------------------------------------------------------------
    function holesOn(points, d) {
      const Hh = H(); let n = 0;
      points.forEach(({ p, ref }) => {
        if (S.board.holes.some(h => Math.hypot(h.x - p[0], (Hh - h.y) - p[1]) < 1e-3)) return;
        S.board.holes.push({ x: R4(p[0]), y: R4(Hh - p[1]), d: d || holeD, at: { ref } }); n++;
      });
      if (!n) { msg("Every one of those points already has a hole"); return 0; }
      commit(`${n} mounting hole${n > 1 ? "s" : ""} Ø${d || holeD} mm placed on the construction points, tied to them: select one to change its size, plating or finish`);
      return n;
    }
    function allPoints() {
      const s = sol(), seen = [];
      cs().items.forEach(it => K.pointsOf(s, it).forEach(e => { if (!seen.some(q => Math.hypot(q.p[0] - e.p[0], q.p[1] - e.p[1]) < 1e-3)) seen.push(e); }));
      return seen;
    }
    function holesOnAll() { const pts = allPoints(); if (!pts.length) { msg("No construction points yet: place reference points, or arrays of them, first"); return; } holesOn(pts); }
    function arrayOf(kind) {
      const it = selItem();
      if (!it) { msg("Select a construction line, point or circle first, then make an array of it"); return; }
      if (cs().lock) { msg("The construction is locked"); return; }
      const s = sol(), r = s.items[it.id];
      if (kind === "array") addItem({ k: "array", of: it.id, n: 4, by: "step", step: 10, ...(r && r.curves.length === 1 && r.curves[0].t === "L" ? {} : { ang: 0 }) }, "Linear array: 4 copies 10 mm apart — set the count, step or span in the inspector");
      else {
        const c = it.k === "circle" ? { ref: { t: "ctr", id: it.id } } : it.k === "point" ? null : null;
        if (!c && it.k !== "point" && it.k !== "line") { msg("A polar array turns a point, a line or a circle about a centre"); return; }
        // a point turns about the board's centre unless it sits on a circle, then about that circle's centre
        let centre = c;
        if (!centre && it.k === "point" && it.at && it.at.ref && it.at.ref.t === "on") { const g = it.at.ref.g, src = cs().items.find(q => q.id === g.id); if (src && src.k === "circle") centre = { ref: { t: "ctr", id: src.id } }; }
        if (!centre) centre = { ref: { t: "board", at: "C" } };
        addItem({ k: "polar", c: centre, of: it.k === "circle" ? undefined : it.id, n: 4, by: "span", span: 360, a0: 0 }, "Polar array: 4 round the circle — set the count, step or span and the centre in the inspector");
      }
    }
    // the context menu's "Construction circle round it" for a mounting hole: 5 mm out from its wall
    function circleRound(h) {
      if (cs().lock) { msg("The construction is locked"); return; }
      if (!shown()) cs().hide = false;
      addItem({ k: "circle", c: { ref: { t: "hole", id: K.idOf(S.board, h, "h") } }, r: 5, rim: true }, "Construction circle 5 mm out from the hole's wall: set R in the inspector; points on it (Shift+P) and polar arrays place holes round it");
      menuState();
    }
    function clearAll() {
      if (cs().lock) { msg("The construction is locked: unlock it first"); return; }
      const n = cs().items.length; if (!n) { msg("There is no construction to clear"); return; }
      S.board.holes.forEach(h => { delete h.at; });
      cs().items = []; if (S.sel && S.sel.kind === "cons") S.sel = null;
      commit(`Cleared ${n} construction item${n > 1 ? "s" : ""}; the holes on them stay where they are (Ctrl+Z brings it all back)`);
    }
    function setShown(on) { cs().hide = !on; if (!on && S.sel && S.sel.kind === "cons") S.sel = null; commit(on ? "Construction shown" : "Construction hidden (it is kept: Construct ▾ → Show construction)"); menuState(); }
    function setLock(on) { cs().lock = !!on; commit(on ? "Construction locked: it cannot be moved, changed or deleted" : "Construction unlocked"); menuState(); }
    function setSnap(k, on) { snapSet[k] = !!on; try { localStorage.setItem(SNAP_KEY, JSON.stringify(snapSet)); } catch (e) { /* no storage */ } menuState(); }
    function menuState() {
      const q = id => $(id);
      if (q("mi-cshow")) q("mi-cshow").classList.toggle("active", shown());
      if (q("mi-clock")) q("mi-clock").classList.toggle("active", !!cs().lock);
      document.querySelectorAll("[data-csnap]").forEach(b => b.classList.toggle("active", !!snapSet[b.dataset.csnap]));
    }

    // ---------------------------------------------------------------------------
    // Drawing (from board-draw.js, board coordinates; the context is in millimetres)
    // ---------------------------------------------------------------------------
    function viewRect(ctx) { const c = ctx.canvas, sc = S.view.scale, W = c.clientWidth || c.width, Hh = c.clientHeight || c.height; return [-S.view.ox / sc, -S.view.oy / sc, (W - S.view.ox) / sc, (Hh - S.view.oy) / sc]; }
    // an endless line or ray cut to the view (Liang–Barsky), board coordinates
    function clipLine(c, rect) {
      const p = fromU([c.x1, c.y1]), q = fromU([c.x2, c.y2]), dx = q[0] - p[0], dy = q[1] - p[1];
      let t0 = c.ext === "line" ? -Infinity : 0, t1 = c.ext === "seg" ? 1 : Infinity;
      const [x0, y0, x1, y1] = rect;
      for (const [pp, qq] of [[-dx, p[0] - x0], [dx, x1 - p[0]], [-dy, p[1] - y0], [dy, y1 - p[1]]]) {
        if (Math.abs(pp) < 1e-12) { if (qq < 0) return null; continue; }
        const r = qq / pp; if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
      }
      if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return null;
      return [p[0] + t0 * dx, p[1] + t0 * dy, p[0] + t1 * dx, p[1] + t1 * dy];
    }
    function strokeCurve(ctx, c, rect) {
      if (!c) return;
      ctx.beginPath();
      if (c.t === "L") { const s = clipLine(c, rect); if (!s) return; ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); }
      else { const m = fromU([c.cx, c.cy]); if (c.a0 === undefined) ctx.arc(m[0], m[1], c.r, 0, Math.PI * 2); else ctx.arc(m[0], m[1], c.r, -c.a0 * RAD, -c.a1 * RAD, true); }
      ctx.stroke();
    }
    const cross = (ctx, p, r) => { ctx.beginPath(); ctx.moveTo(p[0] - r, p[1] - r); ctx.lineTo(p[0] + r, p[1] + r); ctx.moveTo(p[0] + r, p[1] - r); ctx.lineTo(p[0] - r, p[1] + r); ctx.stroke(); };
    const plus = (ctx, p, r) => { ctx.beginPath(); ctx.moveTo(p[0] - r, p[1]); ctx.lineTo(p[0] + r, p[1]); ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0], p[1] + r); ctx.stroke(); };
    function draw(ctx, px, snapMark) {
      const s = S.csol; if (!s) return;
      const rect = viewRect(ctx), sel = selItem();
      // hole finishes (counterbore / countersink): the wider circle, faint
      if (S.show.Holes) S.board.holes.forEach(h => { if (h.finish && h.finish.d > h.d) { ctx.strokeStyle = "rgba(154,167,180,0.55)"; ctx.lineWidth = Math.max(0.05, px); ctx.setLineDash([2 * px, 2 * px]); ctx.beginPath(); ctx.arc(h.x, h.y, h.finish.d / 2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); } });
      if (shown()) {
        ctx.lineCap = "butt";
        cs().items.forEach(it => {
          const r = s.items[it.id]; if (!r) return;
          const on = sel === it, col = on ? "#00e5ff" : r.err ? "#ff7b72" : COLOR;
          ctx.strokeStyle = col; ctx.globalAlpha = on ? 1 : 0.85; ctx.lineWidth = Math.max(0.05, (on ? 1.6 : 1) * px); ctx.setLineDash([6 * px, 4 * px]);
          r.curves.forEach(c => strokeCurve(ctx, c, rect));
          ctx.setLineDash([]); ctx.lineWidth = Math.max(0.05, (on ? 1.6 : 1.2) * px);
          r.pts.forEach(p => cross(ctx, fromU(p), 4 * px));
          if (r.centre && it.k !== "point") plus(ctx, fromU(r.centre), 3 * px);
          ctx.globalAlpha = 1;
        });
        // tied holes: a faint dotted leader from the place they are measured from
        ctx.strokeStyle = COLOR; ctx.lineWidth = Math.max(0.04, 0.8 * px); ctx.setLineDash([1.5 * px, 2.5 * px]);
        S.board.holes.forEach(h => { if (!h.at || !h.at.ref || !(h.at.dx || h.at.dy || h.at.pr)) return; const b = s.refPt(h.at.ref); if (!b) return; const q = fromU(b); ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(h.x, h.y); ctx.stroke(); });
        ctx.setLineDash([]);
      }
      if (!active()) return;
      // the tool in progress
      if (S.tool === "coffset") {
        const pk = T.pick || T.hover;
        if (pk) { ctx.strokeStyle = "#ffe680"; ctx.lineWidth = Math.max(0.1, 2.2 * px); ctx.globalAlpha = 0.8; (pk.k === undefined && pk.id === "@outline" ? s.outline : [pk.c]).forEach(c => strokeCurve(ctx, c, rect)); ctx.globalAlpha = 1; }
      }
      const pv = previewItem();
      if (pv) {
        ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = Math.max(0.06, 1.2 * px); ctx.setLineDash([6 * px, 4 * px]);
        pv.curves.forEach(c => strokeCurve(ctx, c, rect)); ctx.setLineDash([]);
        if (pv.pt && S.tool === "cpoint") { ctx.lineWidth = Math.max(0.06, 1.4 * px); cross(ctx, fromU(pv.pt), 5 * px); }
        if (pv.pt && S.tool === "hole") {
          const p = fromU(pv.pt), d = hudNum("d") > 0 ? hudNum("d") : holeD, wall = B.edgeDist(p[0], p[1], S.board.outline) - d / 2, bad = wall < S.board.rules.holeEdge;
          ctx.strokeStyle = bad ? "#ff5050" : "#00e5ff"; ctx.globalAlpha = 0.75; ctx.lineWidth = Math.max(0.08, 1.2 * px);
          ctx.beginPath(); ctx.arc(p[0], p[1], d / 2, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
          if (bad) tag(ctx, px, p, `${Math.max(0, wall).toFixed(2)} mm to the edge < ${S.board.rules.holeEdge}`, "#ff5050");
        }
        if ((pv.pt && (hudNum("dx") || hudNum("dy")))) { const a = fromU(pv.base), b = fromU(pv.pt); ctx.strokeStyle = "rgba(0,229,255,0.5)"; ctx.setLineDash([2 * px, 3 * px]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]); }
        if (pv.note) tag(ctx, px, S.mouse, pv.note, "#00e5ff");
      }
      if (T.a) { ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = Math.max(0.06, 1.4 * px); plus(ctx, fromU(T.a.p), 5 * px); }
      if (T.sp && snapMark && !(S.tool === "coffset")) snapMark(T.sp, px);
    }
    function tag(ctx, px, p, text, col) {
      ctx.font = `${11 * px}px ui-monospace, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "top";
      const w = ctx.measureText(text).width; ctx.fillStyle = "rgba(7,11,16,0.85)"; ctx.fillRect(p[0] + 8 * px, p[1] - 22 * px, w + 6 * px, 14 * px);
      ctx.fillStyle = col; ctx.fillText(text, p[0] + 11 * px, p[1] - 20 * px);
    }

    // ---------------------------------------------------------------------------
    // The inspector: a construction item; a mounting hole's tie, tolerance and finish
    // ---------------------------------------------------------------------------
    function btn(text, title, fn) { const b = document.createElement("button"); b.className = "btn"; b.textContent = text; b.title = title; b.style.margin = "4px 4px 0 0"; b.onclick = fn; return b; }
    const help = (h, text, cls) => h.insertAdjacentHTML("beforeend", `<p class="help${cls ? " " + cls : ""}">${app.esc(text)}</p>`);
    // a point's fields: the reference in words and Δx Δy from it (or X Y when it is fixed)
    function pointFields(h, field, P, set, title) {
      const s = sol();
      if (title) h.insertAdjacentHTML("beforeend", `<div class="help" style="margin-top:6px"><b>${app.esc(title)}</b></div>`);
      if (P && P.ref) {
        h.insertAdjacentHTML("beforeend", app.kv("Placed from", app.esc(K.refName(s, P.ref))));
        if (Number.isFinite(P.pr)) { h.appendChild(field("Distance from it (mm)", P.pr, n => { P.pr = n; set(); })); h.appendChild(field("Angle from it (°)", P.pa || 0, n => { P.pa = n; set(); })); }
        else { h.appendChild(field("Δx (mm)", P.dx || 0, n => { P.dx = n; set(); })); h.appendChild(field("Δy (mm)", P.dy || 0, n => { P.dy = n; set(); })); }
      } else if (P) { h.appendChild(field("X (mm)", P.x, n => { P.x = n; set(); })); h.appendChild(field("Y (mm)", P.y, n => { P.y = n; set(); })); }
    }
    function lineRefs() {
      const s = sol(), out = [["", "the X axis"]];
      s.outline.forEach((c, k) => { if (c && c.t === "L") out.push([`@outline|${k}`, `board ${K.EDGE_NAMES[k]}`]); });
      cs().items.forEach(it => { const r = s.items[it.id]; if (r && r.curves.length === 1 && r.curves[0].t === "L") out.push([`${it.id}|0`, K.label(it)]); });
      return out;
    }
    function inspector(h, ui) {
      const it = selItem(); if (!it) { S.sel = null; return false; }
      const { field } = ui, s = sol(), r = s.items[it.id] || { curves: [], pts: [] }, locked = cs().lock;
      const set = () => { if (locked) { msg("The construction is locked"); renderPanels(); return; } commit(); };
      h.innerHTML = `<div class="insp-title">${app.esc(K.NAMES[it.k])} <small class="help">${app.esc(K.label(it).split(" ").pop())}</small></div>`;
      help(h, K.describe(s, it));
      if (r.err) help(h, `Not drawn: ${r.err}. Detach it, point it at something else, or delete it.`, "bad");
      h.appendChild(field("Name", it.name || "", v => { if (v) it.name = String(v).slice(0, 40); else delete it.name; set(); }, "text"));
      if (it.k === "point") pointFields(h, field, it.at, set);
      if (it.k === "line") {
        pointFields(h, field, it.a, set, it.b ? "First point" : "Through");
        if (it.b) pointFields(h, field, it.b, set, "Second point");
        else {
          h.appendChild(field("Angle θ (°)", it.ang || 0, n => { it.ang = n; set(); }));
          h.appendChild(field("Angle from", it.rel ? `${it.rel.id}|${it.rel.k || 0}` : "", v => { if (!v) delete it.rel; else { const [id, k] = v.split("|"); it.rel = { id, k: +k }; } set(); }, lineRefs()));
        }
        h.appendChild(field("Extent", it.ext || "line", v => { it.ext = v; set(); }, [["line", "Endless line"], ["ray", "Ray (from the first point)"], ["seg", "Segment (between its points)"]]));
      }
      if (it.k === "offset") {
        h.appendChild(field("Offset d (mm)", it.d, n => { it.d = n; set(); }));
        if (it.of && it.of.id === "@outline") h.appendChild(field("Offset of", it.of.k === undefined || it.of.k === null ? "all" : "one", v => { if (v === "all") delete it.of.k; else if (it.of.k === undefined || it.of.k === null) it.of.k = 0; set(); }, [["one", "This edge only"], ["all", "The whole outline"]]));
        help(h, "d > 0: into the board from its edges, outwards from circles and keep-out areas, to the left of a construction line (as it was drawn).");
      }
      if (it.k === "circle") {
        h.appendChild(field("Radius R (mm)", it.r, n => { if (n >= 0) { it.r = n; set(); } }));
        if (it.c && it.c.ref && ["hole", "pad", "ctr"].includes(it.c.ref.t)) h.appendChild(field("R measured from", it.rim ? "rim" : "centre", v => { it.rim = v === "rim"; if (!it.rim) delete it.rim; set(); }, [["centre", "The centre"], ["rim", "The rim (the hole's or pad's edge)"]]));
        h.appendChild(field("Arc from (°)", it.arc ? it.arc[0] : "", n => { it.arc = [n, it.arc ? it.arc[1] : n + 90]; set(); }));
        h.appendChild(field("Arc to (°)", it.arc ? it.arc[1] : "", n => { it.arc = [it.arc ? it.arc[0] : n - 90, n]; set(); }));
        if (it.arc) h.appendChild(btn("Whole circle", "Draw the whole circle again instead of an arc", () => { delete it.arc; set(); }));
        pointFields(h, field, it.c, set, "Centre");
      }
      if (it.k === "array" || it.k === "polar") {
        h.appendChild(field("Count (with the original)", it.n, n => { if (n >= 2 && n <= 200) { it.n = Math.round(n); set(); } }));
        h.appendChild(field("Spacing by", it.by || "step", v => { it.by = v; if (v === "span" && !Number.isFinite(+it.span)) it.span = it.k === "polar" ? 360 : (+it.step || 10) * (it.n - 1); if (v === "step" && !Number.isFinite(+it.step)) it.step = it.k === "polar" ? 360 / it.n : 10; set(); }, [["step", it.k === "polar" ? "Step angle" : "Step distance"], ["span", it.k === "polar" ? "Total angle" : "Total span"]]));
        const u = it.k === "polar" ? "°" : "mm";
        if ((it.by || "step") === "step") h.appendChild(field(`Array step (${u})`, it.step || 0, n => { it.step = n; set(); }));
        else h.appendChild(field(`Array span (${u})`, it.span || 0, n => { it.span = n; set(); }));
        if (it.k === "array") h.appendChild(field("Array direction (°)", Number.isFinite(+it.ang) && it.ang !== undefined && it.ang !== null && it.ang !== "" ? it.ang : "", n => { it.ang = n; set(); }));
        if (it.k === "array" && it.ang !== undefined) h.appendChild(btn("Square to the line", "Copies step square to the line they copy (as an offset does)", () => { delete it.ang; set(); }));
        if (it.k === "polar") { h.appendChild(field("Start angle (°)", it.a0 || 0, n => { it.a0 = n; set(); })); pointFields(h, field, it.c, set, "Centre"); }
      }
      const pts = K.pointsOf(s, it);
      if (pts.length) {
        const row = document.createElement("div"); row.className = "row"; row.innerHTML = `<span>Holes Ø (mm)</span>`;
        const inp = document.createElement("input"); inp.value = holeD; inp.title = "The diameter of the holes the button below places"; row.appendChild(inp); h.appendChild(row);
        h.appendChild(btn(`Holes on its ${pts.length} point${pts.length > 1 ? "s" : ""}`, "A mounting hole on each of its points, tied to it: they follow when it moves", () => { const d = parseFloat(String(inp.value).replace(",", ".")); if (d > 0) holeD = d; holesOn(pts, holeD); }));
      }
      if (["point", "line", "circle"].includes(it.k)) { h.appendChild(btn("Linear array…", "Copies of it in a row, by a step or over a span", () => arrayOf("array"))); h.appendChild(btn("Polar array…", "Copies of it turned about a centre", () => arrayOf("polar"))); }
      if (it.k !== "fixed") h.appendChild(btn("Detach", "Cut it loose from what it was drawn from: it stays where it is now, in fixed coordinates", () => { if (locked) return msg("The construction is locked"); if (K.detach(s, it)) commit(`${K.label(it)} detached: fixed coordinates`); }));
      const del = ui.delBtn(); del.style.margin = "4px 4px 0 0"; h.appendChild(del);
      return true;
    }
    // the hole inspector's part: where it is tied, its tolerance and its finish
    function holeExtra(h, hl, ui) {
      const { field } = ui;
      if (hl.at) {
        h.insertAdjacentHTML("beforeend", `<div class="help" style="margin-top:6px"><b>Tied to the construction</b></div>`);
        if ((S.cholesLost || []).includes(hl)) help(h, "Its reference is gone: it stays where it was. Detach it, or place it again.", "bad");
        pointFields(h, field, hl.at, () => commit());
        const b = btn("Detach", "Cut it loose: it keeps its X and Y and no longer follows what it was placed from", () => { delete hl.at; commit("Hole detached: fixed X and Y"); });
        h.appendChild(b);
      }
      const tol = hl.tol || [];
      h.appendChild(field("Tolerance + (mm)", tol[0] === undefined ? "" : tol[0], n => { hl.tol = [n, (hl.tol || [])[1] === undefined ? 0 : hl.tol[1]]; commit(); }));
      h.appendChild(field("Tolerance − (mm)", tol[1] === undefined ? "" : tol[1], n => { hl.tol = [(hl.tol || [])[0] === undefined ? 0 : hl.tol[0], Math.abs(n)]; commit(); }));
      const f = hl.finish || {};
      h.appendChild(field("Finish", f.k || "", v => { if (!v) delete hl.finish; else hl.finish = { k: v, d: f.d > hl.d ? f.d : R4(hl.d * 1.9), ...(v === "cb" ? { depth: f.depth || 3 } : { ang: f.ang || 90 }) }; commit(); }, [["", "Plain drilled hole"], ["cb", "Counterbore"], ["cs", "Countersink"]]));
      if (hl.finish) {
        h.appendChild(field(hl.finish.k === "cb" ? "Counterbore Ø (mm)" : "Countersink Ø (mm)", hl.finish.d, n => { if (n > hl.d) { hl.finish.d = n; commit(); } }));
        if (hl.finish.k === "cb") h.appendChild(field("Counterbore depth (mm)", hl.finish.depth, n => { if (n > 0) { hl.finish.depth = n; commit(); } }));
        else h.appendChild(field("Countersink angle (°)", hl.finish.ang, n => { if (n > 0 && n < 180) { hl.finish.ang = n; commit(); } }, [["82", "82° (inch screws)"], ["90", "90° (metric screws)"], ["100", "100°"], ["120", "120°"]]));
        help(h, "The finish and tolerance go to the board maker in the README of the Gerber ZIP (drill files carry only the drilled diameter).");
      }
      holeD = hl.d;
    }
    // several holes selected: one diameter and plating for all of them
    function multiHoles(h, idx, ui) {
      const hs = idx.map(i => S.board.holes[i]).filter(Boolean); if (!hs.length) return;
      const { field } = ui, same = hs.every(q => q.d === hs[0].d);
      h.appendChild(field("Holes Ø (mm)", same ? hs[0].d : "", n => { if (n > 0) { hs.forEach(q => { q.d = n; }); holeD = n; commit(`${hs.length} holes Ø${n} mm`); } }));
      h.appendChild(field("Holes plating", hs.every(q => q.plated) ? "yes" : hs.some(q => q.plated) ? "" : "no", v => { if (!v) return; hs.forEach(q => { if (v === "yes") q.plated = true; else { delete q.plated; delete q.pad; delete q.net; } }); commit(); }, [["", "(mixed)"], ["no", "Not plated (NPTH)"], ["yes", "Plated (PTH)"]]));
    }

    // ---------------------------------------------------------------------------
    // Keys and the menu
    // ---------------------------------------------------------------------------
    function onKey(e, L) {
      if (e.key === "Escape" && TOOLS.includes(S.tool) && escape()) return true;
      if (e.key === "Enter" && active()) { const el = $("chud"); if (el && !el.hidden && Object.values(T.hud).some(v => v !== "")) { e.preventDefault(); enter(); return true; } }
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (L === "c" && !e.shiftKey) { app.setTool("cline"); return true; }
      if (L === "c" && e.shiftKey) { app.setTool("ccircle"); return true; }
      if (L === "o" && !e.shiftKey) { app.setTool("coffset"); return true; }
      if (L === "p" && e.shiftKey) { app.setTool("cpoint"); return true; }
      return false;
    }
    function init() {
      K.normalise(S.board);
      const on = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
      on("mi-carray", () => arrayOf("array")); on("mi-cpolar", () => arrayOf("polar")); on("mi-choles", holesOnAll);
      on("mi-cshow", () => setShown(!shown())); on("mi-clock", () => setLock(!cs().lock)); on("mi-cclear", clearAll);
      document.querySelectorAll("[data-csnap]").forEach(b => b.addEventListener("click", () => setSnap(b.dataset.csnap, !snapSet[b.dataset.csnap])));
      menuState();
    }

    return { circleRound, TOOLS, HELP, hudKey: e => active() && hudKey(e), solve, snapInto, specOf, onDown, onMove, onKey, toolChanged, escape, select, drag, nudge, deleteSel, hit, draw, inspector, holeExtra, multiHoles, menuState, init, holesOnAll, clearAll, setShown, setLock, arrayOf, allPoints, placeHud, isSel: id => !!(S.sel && S.sel.kind === "cons" && S.sel.id === id) };
  };
})(window);
