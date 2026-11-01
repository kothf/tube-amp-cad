/* The Board window's driving dimensions (board-dims.js does the solving): the Dimension tool
   (Shift+D: click two features, place the dimension, type its value), Align horizontally /
   vertically for a selection, the drawing of dimensions, selecting and dragging them, their
   inspector and what a part's, hole's, via's, text's or keep-out's inspector says of them, and
   enforce(): after every change (from analyse) whatever a dimension holds is moved back where it
   belongs, the thing the user just moved staying where it was put. A factory, like board-cons.js:
   BoardDimUI(app) takes what it needs from board-app.js by name. */
(function (root) {
  "use strict";
  root.BoardDimUI = function (app) {
    const { $, S, commit, msg } = app;
    const D = root.BoardDims, K = root.BoardConstruct, R4 = v => Math.round(v * 1e4) / 1e4;
    const render = () => app.render(), renderPanels = () => app.renderPanels();
    const COLOR = "#4fc3f7", REF = "#9aa7b4", BAD = "#ff5252", SEL = "#ffffff";
    const HELP = "Dimension (D): click two things (a pad, a part's origin, a hole, a via, a text, a keep-out corner or edge, a board corner or edge, a construction point or line), then place it: up or down for horizontal, sideways for vertical, between for aligned (or H, V, A). Type the value and press Enter: the second thing moves. The tool stays on for the next one; drag a dimension's value to move it, click it to change it. Esc cancels, Esc again leaves";
    const T = { a: null, b: null, hover: null, force: null, val: "", m: null };   // the tool in progress
    const E = { id: null };   // the dimension whose value is being typed in the box on its label
    const last = new Map();   // body → where it was after the last solve (board frame): what moved since was moved by hand
    let prefer = null, note = "";
    const H = () => S.board.outline.h;
    const dims = () => S.board.dims || D.normalise(S.board);
    const shown = () => !dims().hide;
    const tr = t => (root.I18n && root.I18n.lang === "ru" && root.I18n.ru(t)) || t;   // canvas text in the interface's language
    const fmt = v => (Math.abs(v) < 0.0005 ? 0 : Math.abs(v)).toFixed(2);

    // ---------------------------------------------------------------------------
    // Enforcing: from analyse, right after the model (and the construction) is solved
    // ---------------------------------------------------------------------------
    // the ends of tracks on a body (a part's pads, a via) where it is now
    function endsOf(key, p0) {
      const b = S.board, out = [], at = (x, y) => b.tracks.forEach((t, ti) => { if (t.locked) return; [0, t.pts.length - 1].forEach(k => { const q = t.pts[k]; if (Math.hypot(q[0] - x, q[1] - y) < 0.01 && !out.some(e => e.ti === ti && e.k === k)) out.push({ ti, k }); }); });
      if (key.startsWith("part:") && S.model) {
        const k = key.slice(5), bp = b.parts[k], base = p0.get(key) || [bp.x, bp.y];
        S.model.pads.forEach(pd => { if (pd.part === k) at(pd.x + bp.x - base[0], pd.y + bp.y - base[1]); });
      } else if (key.startsWith("via:")) { const v = D.objOfBody(b, key); if (v) at(v.x, v.y); }
      return out;
    }
    function slide(key, dx, dy, p0) {
      if (Math.hypot(dx, dy) < 1e-7) return false;
      const ends = endsOf(key, p0);
      D.moveBody(S.board, key, dx, dy);
      ends.forEach(e => { const t = S.board.tracks[e.ti]; t.pts[e.k] = [R4(t.pts[e.k][0] + dx), R4(t.pts[e.k][1] + dy)]; });
      return true;
    }
    function bodies() {
      const b = S.board, out = new Set();
      dims().items.forEach(d => [d.a, d.b].forEach(f => { const k = D.bodyOf(b, f); if (k) out.add(k); }));
      return out;
    }
    /** returns true when something moved (the model must be built again) */
    function enforce(pref) {
      const b = S.board; D.normalise(b);
      if (!dims().items.length) { S.dsol = null; last.clear(); return false; }
      const keys = bodies(), p0 = new Map(), pinned = new Set();
      keys.forEach(k => { const p = D.bodyPos(b, k); if (!p) return; p0.set(k, p); const l = last.get(k); if (l && Math.hypot(l[0] - p[0], l[1] - p[1]) > 1e-6) pinned.add(k); });
      const pr = pref || prefer; prefer = null;
      let r = D.solve(b, S.model, { csol: S.csol, pinned, prefer: pr || undefined }), moved = false;
      if (!r.ok && pinned.size) {
        // it cannot go there: back where it was, and the dimension that stopped it named
        const why = r.bad.map(id => dims().items.find(d => d.id === id)).filter(Boolean)[0];
        pinned.forEach(k => { const p = D.bodyPos(b, k), l = last.get(k); if (p && l) moved = slide(k, l[0] - p[0], l[1] - p[1], p0) || moved; });
        r = D.solve(b, S.model, { csol: S.csol });
        note = why ? `Held by a dimension: ${D.describe(b, S.model, why)}. Change or delete it (or make it a reference) to move this` : "Held by its dimensions";
      }
      r.T.forEach(([dx, dy], k) => { moved = slide(k, dx, dy, p0) || moved; });
      keys.forEach(k => { const p = D.bodyPos(b, k); if (p) last.set(k, p); });
      S.dsol = { ok: r.ok, bad: new Set(r.bad), lost: new Set(r.lost) };
      if (note) { const n = note; note = ""; setTimeout(() => msg(n), 0); }
      return moved;
    }

    // ---------------------------------------------------------------------------
    // Features under the pointer (board coordinates)
    // ---------------------------------------------------------------------------
    function featureAt(x, y) {
      const b = S.board, tol = 10 / S.view.scale, o = b.outline;
      let best = null, bd = tol;
      const at = (px, py, name, make) => { const d = Math.hypot(px - x, py - y); if (d < bd - 1e-9) { bd = d; best = { p: [px, py], name, make }; } };
      if (S.model) S.model.pads.forEach(p => at(p.x, p.y, `pad ${p.ref}-${p.num}`, () => ({ t: "pad", part: p.part, num: String(p.num) })));
      if (S.model) S.model.parts.forEach(g => { if (g.place) at(g.place.x, g.place.y, `${g.ref} origin`, () => ({ t: "part", key: g.key })); });
      b.holes.forEach(h => at(h.x, h.y, `hole Ø${h.d}`, () => ({ t: "hole", id: K.idOf(b, h, "h") })));
      b.vias.forEach(v => at(v.x, v.y, "via", () => ({ t: "via", id: K.idOf(b, v, "v") })));
      b.texts.forEach(t => at(t.x, t.y, `text "${t.text}"`, () => ({ t: "text", id: D.textId(b, t) })));
      b.keepouts.forEach(ko => ko.pts.forEach((p, k) => at(p[0], p[1], "keep-out corner", () => ({ t: "ko", id: K.idOf(b, ko, "k"), k }))));
      [["BL", 0, o.h], ["BR", o.w, o.h], ["TL", 0, 0], ["TR", o.w, 0], ["C", o.w / 2, o.h / 2], ["B", o.w / 2, o.h], ["T", o.w / 2, 0], ["L", 0, o.h / 2], ["R", o.w, o.h / 2]]
        .forEach(([k, px, py]) => at(px, py, k === "C" ? "board centre" : k.length === 2 ? "board corner" : "middle of the board edge", () => ({ t: "board", at: k })));
      if (app.cons) app.cons.snapInto(x, y, (px, py, what, shape, ent) => { if (ent && ent.ref) at(px, py, what, () => ({ t: "cp", ref: ent.ref })); }, "point");
      if (best) return best;
      // failing a point: a line (board edge, keep-out edge, construction line)
      if (!S.csol) return null;
      const pk = K.pick(S.csol, x, H() - y, tol, {});
      if (!pk || !pk.c || pk.c.t !== "L") return null;
      const c = pk.c, seg = [c.x1, H() - c.y1, c.x2, H() - c.y2];
      if (pk.id === "@outline") return pk.k <= 3 ? { line: seg, name: `board ${D.EDGE_NAMES[pk.k]}`, make: () => ({ t: "edge", k: pk.k }) } : null;
      if (typeof pk.id === "string" && pk.id.startsWith("@ko:")) return { line: seg, name: `keep-out edge ${pk.k + 1}`, make: () => ({ t: "koe", id: pk.id.slice(4), k: pk.k }) };
      return { line: seg, name: "construction line", make: () => ({ t: "cl", g: { id: pk.id, k: pk.k || 0 } }) };
    }

    // ---------------------------------------------------------------------------
    // The tool
    // ---------------------------------------------------------------------------
    const active = () => S.tool === "dim";
    function toolChanged(t) {
      T.a = T.b = T.hover = T.force = null; T.val = ""; closeEdit(); hud();
      if (t === "dim" && !shown()) { dims().hide = false; menuState(); }
    }
    // the kind a placement gives: by where the pointer is against the two points
    function kindOf(pa, pb, m) {
      if (T.force) return T.force;
      const x0 = Math.min(pa[0], pb[0]), x1 = Math.max(pa[0], pb[0]), y0 = Math.min(pa[1], pb[1]), y1 = Math.max(pa[1], pb[1]);
      if (x1 - x0 < 1e-6) return "dy"; if (y1 - y0 < 1e-6) return "dx";
      const inX = m[0] > x0 && m[0] < x1, inY = m[1] > y0 && m[1] < y1;
      if (inX && !inY) return "dx"; if (inY && !inX) return "dy";
      return "dist";
    }
    // the dimension being placed (features made only on the click that makes it)
    function pending() {
      if (!T.a || !T.b) return null;
      const A = T.a, Bf = T.b, m = T.m || A.p || Bf.p;
      if (A.line || Bf.line) { const pt = A.line ? Bf : A, ln = A.line ? A : Bf; return { k: "pl", pa: pt.p, line: ln.line, pt, ln }; }
      const k = kindOf(A.p, Bf.p, m);
      return { k, pa: A.p, pb: Bf.p, o: offsetFor(k, A.p, Bf.p, m) };
    }
    function offsetFor(k, pa, pb, m) {
      if (k === "dx") return m[1] - pa[1];
      if (k === "dy") return m[0] - pa[0];
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L = Math.hypot(dx, dy) || 1;
      return ((m[0] - pa[0]) * -dy + (m[1] - pa[1]) * dx) / L;
    }
    function onDown(x, y, e) {
      if (!active()) return false;
      if (e && e.button !== 0) return false;
      if (T.a && T.b) { place(); return true; }
      // an existing dimension's value: drag it to move the dimension, click it to type a new value
      const own = !T.a && hit(x, y, true);
      if (own) { S.sel = { kind: "dim", id: own }; S.drag = { ...grab(own, x, y), edit: true }; renderPanels(); render(); return true; }
      const f = featureAt(x, y);
      if (!f) { msg("Nothing to dimension there: click a pad, a part's origin, a hole, a via, a text, a keep-out, the board's corner or edge, or construction"); return true; }
      if (!T.a) { T.a = f; msg(`From ${f.name}: now click the second thing (it is the one that moves)`); }
      else {
        if (f.line && T.a.line) { msg("Two lines: click a point (a pad, hole, via, corner…) for one of them"); return true; }
        if (f.p && T.a.p && Math.hypot(f.p[0] - T.a.p[0], f.p[1] - T.a.p[1]) < 1e-6 && f.name === T.a.name) return true;
        T.b = f; T.m = [x, y];
        msg("Place it (up/down: horizontal, sideways: vertical, between: aligned; or H, V, A), type the value, then Enter or click. Esc cancels");
      }
      hud(); render(); return true;
    }
    function onMove(x, y) {
      if (!active()) return;
      T.m = [x, y];
      if (!T.b) T.hover = featureAt(x, y);
      hud(); render();
    }
    function cancel() { T.a = T.b = T.hover = T.force = null; T.val = ""; hud(); render(); }
    function place() {
      const p = pending(); if (!p) return;
      const b = S.board; D.normalise(b);
      let dim;
      if (p.k === "pl") dim = { k: "pl", a: p.pt.make(), b: p.ln.make() };
      else dim = { k: p.k, a: T.a.make(), b: T.b.make(), o: R4(p.o) };
      const typed = T.val.trim() === "" ? null : parseFloat(T.val.replace(",", "."));
      // the thing picked second moves (a line that cannot move: the point does)
      const second = p.k === "pl" ? (T.b.line ? dim.b : dim.a) : dim.b, first = second === dim.a ? dim.b : dim.a;
      const mover = D.bodyOf(b, second) || D.bodyOf(b, first);
      cancel();
      const made = add(dim, typed, mover);
      // nothing typed while placing: the Modify box asks for the value (as in SolidWorks)
      if (made && typed === null && !made.ref && D.HAS_VALUE[made.k]) setTimeout(() => editAt(made.id), 0);
    }
    /** a new dimension: driving if it can be, else a reference one (with the reason) */
    function add(dim, typed, mover) {
      const b = S.board, env = D.makeEnv(b, S.model, S.csol), cur = D.measure(env, dim);
      if (cur === null) { msg("Those cannot be dimensioned"); return; }
      dim.id = D.newId(b);
      if (D.HAS_VALUE[dim.k]) {
        if (typed === null || !Number.isFinite(typed)) dim.v = cur;
        else if (dim.k === "dist") dim.v = R4(Math.abs(typed));
        else { const s = cur < 0 ? -1 : 1; dim.v = R4(typed < 0 ? -s * Math.abs(typed) : s * typed); }
      }
      dims().items.push(dim);
      const say = D.describe(b, S.model, dim);
      if (D.redundant(b, S.model, dim, S.csol)) {
        dim.ref = true; dim.v = cur;
        commit(`Reference dimension (a driving one would over-constrain: the other dimensions or locks already fix this): ${D.describe(b, S.model, dim)}`); return dim;
      }
      const pref = new Set(mover ? [mover] : []);
      const r = D.solve(b, S.model, { csol: S.csol, prefer: pref });
      if (!r.ok) { dim.ref = true; dim.v = cur; commit(`Reference dimension: ${say} cannot be met with the other dimensions (or a locked part); it shows ${fmt(cur)} mm`); return dim; }
      enforce(pref);
      commit(`Dimension: ${say}${dim.k === "hz" || dim.k === "vt" ? "" : ". Click its value to change it, drag the value to move it; the tool stays on for the next one"}`);
      return dim;
    }
    function setValue(dim, v) {
      if (!D.HAS_VALUE[dim.k] || !Number.isFinite(v)) return false;
      const old = dim.v;
      // the side it is on stays; a minus sign puts it on the other side
      dim.v = dim.k === "dist" ? R4(Math.abs(v)) : R4((old < 0 ? -1 : 1) * v);
      if (dim.ref) { commit(); return true; }
      const mover = D.bodyOf(S.board, dim.b) || D.bodyOf(S.board, dim.a);
      const r = D.solve(S.board, S.model, { csol: S.csol, prefer: new Set(mover ? [mover] : []) });
      if (!r.ok) { dim.v = old; msg(`${fmt(v)} mm cannot be met with the other dimensions (or a locked part)`); renderPanels(); render(); return false; }
      enforce(new Set(mover ? [mover] : []));
      commit(D.describe(S.board, S.model, dim));
      return true;
    }
    function setRef(dim, on) {
      if (!on) {
        dim.ref = false;
        if (D.redundant(S.board, S.model, dim, S.csol)) { dim.ref = true; msg("It stays a reference: the other dimensions already fix this"); renderPanels(); return; }
        const mover = D.bodyOf(S.board, dim.b) || D.bodyOf(S.board, dim.a), pref = new Set(mover ? [mover] : []);
        if (!D.solve(S.board, S.model, { csol: S.csol, prefer: pref }).ok) { dim.ref = true; msg("It cannot drive: it fights the other dimensions"); renderPanels(); return; }
        enforce(pref); commit("Driving dimension: it holds them " + fmt(dim.v) + " mm apart"); return;
      }
      dim.ref = true; commit("Reference dimension: it only shows the distance");
    }
    // Align horizontally / vertically: the first selected stays, the others line up with it
    function featureOfSel(kind, id) {
      const b = S.board;
      if (kind === "part") return { t: "part", key: id };
      if (kind === "hole") return { t: "hole", id: K.idOf(b, b.holes[id], "h") };
      if (kind === "via") return { t: "via", id: K.idOf(b, b.vias[id], "v") };
      if (kind === "text") return { t: "text", id: D.textId(b, b.texts[id]) };
      return null;
    }
    function align(k) {
      const items = app.selItems().map(([kind, id]) => featureOfSel(kind, id)).filter(Boolean);
      if (items.length < 2) { msg("Select two or more parts, holes, vias or texts first (Shift+click or drag a box), then align them"); return; }
      const first = items[0], b = S.board; let n = 0, refs = 0;
      items.slice(1).forEach(f => {
        const dim = { id: D.newId(b), k, a: first, b: f }; dims().items.push(dim);
        if (D.redundant(b, S.model, dim, S.csol)) { dim.ref = true; refs++; return; }
        const pref = new Set([D.bodyOf(b, f)].filter(Boolean));
        if (!D.solve(b, S.model, { csol: S.csol, prefer: pref }).ok) { dim.ref = true; refs++; return; }
        enforce(pref); n++;
      });
      commit(`${n} aligned ${k === "hz" ? "horizontally (same Y)" : "vertically (same X)"} with ${D.featureName(b, S.model, first)}${refs ? `; ${refs} already held another way (kept as references)` : ""}. They stay aligned when one moves`);
    }
    function clearAll() {
      const n = dims().items.length; if (!n) { msg("There are no dimensions to clear"); return; }
      dims().items = []; if (S.sel && S.sel.kind === "dim") S.sel = null; last.clear();
      commit(`Cleared ${n} dimension${n > 1 ? "s" : ""}: everything stays where it is, free to move (Ctrl+Z brings them back)`);
    }
    function setShown(on) { dims().hide = !on; if (!on && S.sel && S.sel.kind === "dim") S.sel = null; commit(on ? "Dimensions shown" : "Dimensions hidden (they still hold: Construct ▾ → Show dimensions)"); menuState(); }
    function menuState() { const q = $("mi-dshow"); if (q) q.classList.toggle("active", shown()); }
    /** a measurement kept (Measure tool, Enter): a dimension when both its ends are things a dimension
        can hold (pads, holes, vias, corners…); null when they are not (a track's width, a hole's rim) */
    function fromMeasure(pa, pb) {
      if (!pa || !pb) return null;
      const at = p => { const f = featureAt(p[0], p[1]); return f && f.p && Math.hypot(f.p[0] - p[0], f.p[1] - p[1]) < 1e-3 ? f : null; };
      const fa = at(pa), fb = at(pb); if (!fa || !fb || fa.name === fb.name && Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 1e-6) return null;
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], k = Math.abs(dy) < 1e-4 ? "dx" : Math.abs(dx) < 1e-4 ? "dy" : "dist";
      const dim = { k, a: fa.make(), b: fb.make(), o: k === "dist" ? 4 : -6 };
      // a note, as the measurement was: a reference dimension (its value typed in the Modify box makes it drive)
      const env = D.makeEnv(S.board, S.model, S.csol), cur = D.measure(env, dim); if (cur === null) return null;
      dim.id = D.newId(S.board); dim.v = cur; dim.ref = true; dims().items.push(dim);
      commit(`Kept as a reference dimension: ${D.describe(S.board, S.model, dim)}. Drag its value to move it; click it in the Dimension tool (or double-click it) to type a value that drives`);
      return dim;
    }
    function removeOf(key) {
      const list = D.onBody(S.board, key); if (!list.length) return;
      dims().items = dims().items.filter(d => !list.includes(d));
      commit(`Removed ${list.length} dimension${list.length > 1 ? "s" : ""}: it is free to move`);
    }

    // ---------------------------------------------------------------------------
    // Geometry of a drawn dimension (board coordinates): its line, extension lines and label spot
    // ---------------------------------------------------------------------------
    // the value slides along its dimension line by d.s mm from the middle (it may go past an end: the
    // line runs on to it, as in a drawing), wherever the user dragged it
    function slid(sh, d) {
      const s = Number.isFinite(d.s) ? d.s : 0; if (!s || !sh) return sh;
      const [A, Bq] = sh.line, dx = Bq[0] - A[0], dy = Bq[1] - A[1], L = Math.hypot(dx, dy); if (L < 1e-9) return sh;
      const ux = dx / L, uy = dy / L, m = [(A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2];
      sh.lbl = [m[0] + ux * s, m[1] + uy * s];
      if (Math.abs(s) > L / 2) sh.tail = [s > 0 ? Bq : A, sh.lbl];
      return sh;
    }
    function shape(d, env) { return slid(shapeBase(d, env), d); }
    function shapeBase(d, env) {
      if (d.k === "pl") {
        const p = env.point(d.a, null), l = env.line(d.b, null); if (!p || !l) return null;
        const dx = l[2] - l[0], dy = l[3] - l[1], L2 = dx * dx + dy * dy || 1, t = ((p[0] - l[0]) * dx + (p[1] - l[1]) * dy) / L2, f = [l[0] + t * dx, l[1] + t * dy];
        // moved sideways (along the line it is measured to) by d.o: extension lines from the point and the line
        const o = Number.isFinite(d.o) ? d.o : 0, Ll = Math.sqrt(L2), wx = dx / Ll * o, wy = dy / Ll * o;
        if (Math.abs(o) < 1e-9) return { line: [p, f], ext: [], lbl: [(p[0] + f[0]) / 2, (p[1] + f[1]) / 2], arrows: true, lineRef: l };
        const P = [p[0] + wx, p[1] + wy], Fq = [f[0] + wx, f[1] + wy];
        return { line: [P, Fq], ext: [[p, P], [f, Fq]], lbl: [(P[0] + Fq[0]) / 2, (P[1] + Fq[1]) / 2], arrows: true, lineRef: l };
      }
      const pa = env.point(d.a, null), pb = env.point(d.b, null); if (!pa || !pb) return null;
      if (d.k === "hz" || d.k === "vt") return { line: [pa, pb], ext: [], lbl: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], arrows: false, tag: d.k === "hz" ? "═" : "‖" };
      const o = Number.isFinite(d.o) ? d.o : -6;
      if (d.k === "dx") { const y = pa[1] + o, A = [pa[0], y], Bq = [pb[0], y]; return { line: [A, Bq], ext: [[pa, A], [pb, Bq]], lbl: [(A[0] + Bq[0]) / 2, y], arrows: true }; }
      if (d.k === "dy") { const x = pa[0] + o, A = [x, pa[1]], Bq = [x, pb[1]]; return { line: [A, Bq], ext: [[pa, A], [pb, Bq]], lbl: [x, (A[1] + Bq[1]) / 2], arrows: true }; }
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, A = [pa[0] + nx * o, pa[1] + ny * o], Bq = [pb[0] + nx * o, pb[1] + ny * o];
      return { line: [A, Bq], ext: [[pa, A], [pb, Bq]], lbl: [(A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2], arrows: true };
    }
    const textOf = (d, env) => {
      if (d.k === "hz" || d.k === "vt") return d.k === "hz" ? "═ H" : "‖ V";
      const v = d.ref ? D.measure(env, d) : d.v;
      return v === null ? "?" : d.ref ? `(${fmt(v)})` : fmt(v);
    };

    // ---------------------------------------------------------------------------
    // Drawing (from board-draw.js; the context is in millimetres)
    // ---------------------------------------------------------------------------
    function arrow(ctx, from, to, px) {
      const dx = to[0] - from[0], dy = to[1] - from[1], L = Math.hypot(dx, dy); if (L < 1e-9) return;
      const ux = dx / L, uy = dy / L, s = 7 * px, w = 2.6 * px;
      ctx.beginPath(); ctx.moveTo(to[0], to[1]); ctx.lineTo(to[0] - ux * s - uy * w, to[1] - uy * s + ux * w); ctx.lineTo(to[0] - ux * s + uy * w, to[1] - uy * s - ux * w); ctx.closePath(); ctx.fill();
    }
    function drawOne(ctx, px, sh, text, col, selected) {
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = (selected ? 1.6 : 1) * px; ctx.setLineDash([]);
      sh.ext.forEach(([p, q]) => { const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy); if (L < 1e-9) return; const g = 2 * px, over = 3 * px; ctx.beginPath(); ctx.moveTo(p[0] + dx / L * g, p[1] + dy / L * g); ctx.lineTo(q[0] + dx / L * over, q[1] + dy / L * over); ctx.stroke(); });
      const [A, Bq] = sh.line;
      if (!sh.arrows) ctx.setLineDash([3 * px, 3 * px]);
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Bq[0], Bq[1]); if (sh.tail) { ctx.moveTo(sh.tail[0][0], sh.tail[0][1]); ctx.lineTo(sh.tail[1][0], sh.tail[1][1]); } ctx.stroke(); ctx.setLineDash([]);
      if (sh.arrows) { const m = [(A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2]; arrow(ctx, m, A, px); arrow(ctx, m, Bq, px); }
      ctx.font = `${11 * px}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const w = ctx.measureText(text).width + 6 * px, h = 14 * px;
      ctx.fillStyle = "rgba(11,15,20,0.85)"; ctx.fillRect(sh.lbl[0] - w / 2, sh.lbl[1] - h / 2, w, h);
      ctx.fillStyle = col; ctx.fillText(text, sh.lbl[0], sh.lbl[1]);
      return [sh.lbl[0] - w / 2, sh.lbl[1] - h / 2, w, h];
    }
    function draw(ctx, px) {
      S.dboxes = [];
      if (shown() && dims().items.length) {
        const env = D.makeEnv(S.board, S.model, S.csol), bad = (S.dsol && S.dsol.bad) || new Set();
        dims().items.forEach(d => {
          const sh = shape(d, env); if (!sh) return;
          const selected = !!(S.sel && S.sel.kind === "dim" && S.sel.id === d.id);
          const col = selected ? SEL : bad.has(d.id) ? BAD : d.ref ? REF : COLOR;
          S.dboxes.push({ id: d.id, box: drawOne(ctx, px, sh, textOf(d, env), col, selected), line: sh.line });
        });
      }
      if (!active()) return;
      // the tool: what the pointer would pick, what is picked, the dimension being placed
      const mark = (f, col) => {
        if (!f) return; ctx.strokeStyle = col; ctx.lineWidth = 1.5 * px;
        if (f.p) { ctx.beginPath(); ctx.arc(f.p[0], f.p[1], 5 * px, 0, Math.PI * 2); ctx.stroke(); }
        else if (f.line) { ctx.beginPath(); ctx.moveTo(f.line[0], f.line[1]); ctx.lineTo(f.line[2], f.line[3]); ctx.stroke(); }
      };
      mark(T.a, COLOR); mark(T.b, COLOR);
      if (!T.b && T.hover) { mark(T.hover, "#ffd54f"); if (T.m) { ctx.font = `${11 * px}px ui-monospace, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillStyle = "#ffd54f"; ctx.fillText(tr(T.hover.name), T.m[0] + 10 * px, T.m[1] - 6 * px); } }
      const p = pending(); if (!p) return;
      drawOne(ctx, px, shapeRaw(p), T.val ? T.val : fmt(liveValue(p)), "#ffd54f", false);
    }
    function shapeRaw(p) {
      const { pa, pb, o } = p;
      if (p.k === "pl") { const l = p.line, dx = l[2] - l[0], dy = l[3] - l[1], L2 = dx * dx + dy * dy || 1, t = ((pa[0] - l[0]) * dx + (pa[1] - l[1]) * dy) / L2, f = [l[0] + t * dx, l[1] + t * dy]; return { line: [pa, f], ext: [], lbl: [(pa[0] + f[0]) / 2, (pa[1] + f[1]) / 2], arrows: true }; }
      if (p.k === "dx") { const y = pa[1] + o, A = [pa[0], y], Bq = [pb[0], y]; return { line: [A, Bq], ext: [[pa, A], [pb, Bq]], lbl: [(A[0] + Bq[0]) / 2, y], arrows: true }; }
      if (p.k === "dy") { const x = pa[0] + o, A = [x, pa[1]], Bq = [x, pb[1]]; return { line: [A, Bq], ext: [[pa, A], [pb, Bq]], lbl: [x, (A[1] + Bq[1]) / 2], arrows: true }; }
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, A = [pa[0] + nx * o, pa[1] + ny * o], Bq = [pb[0] + nx * o, pb[1] + ny * o];
      return { line: [A, Bq], ext: [[pa, A], [pb, Bq]], lbl: [(A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2], arrows: true };
    }
    function liveValue(p) {
      if (p.k === "pl") return D.signedDist(p.pa, p.line);
      if (p.k === "dx") return p.pb[0] - p.pa[0];
      if (p.k === "dy") return p.pa[1] - p.pb[1];
      return Math.hypot(p.pb[0] - p.pa[0], p.pb[1] - p.pa[1]);
    }
    const kindName = k => ({ dx: "Horizontal", dy: "Vertical", dist: "Aligned", pl: "To the line" })[k] || k;

    // the HUD: the value typed while placing (on the dimension's label), or the box on an existing
    // dimension's label while its value is changed
    const labelAt = sh => { const [sx, sy] = app.toScreen(sh.lbl[0], sh.lbl[1]); return [Math.round(sx), Math.round(sy)]; };
    function hud() {
      const el = $("dhud"); if (!el) return;
      const p = active() && pending();
      if (!p) { el.hidden = true; return; }
      el.hidden = false;
      el.innerHTML = `<span>${app.esc(tr(kindName(p.k)))}</span><input data-k="v" value="${app.esc(T.val)}" placeholder="${fmt(liveValue(p))}" title="${app.esc(tr("The value, mm: Enter makes it; empty keeps the distance as it is"))}"><small>mm</small><small class="chud-k">${p.k === "pl" ? "" : "H V A · "}Enter · Esc</small>`;
      const inp = el.querySelector("input");
      inp.oninput = () => { T.val = inp.value; render(); };
      inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); place(); app.canvas().focus(); } else if (e.key === "Escape") { e.preventDefault(); cancel(); app.canvas().focus(); } else if (/^[hHvVaA]$/.test(e.key)) { e.preventDefault(); forceKind(e.key); } };
      // just past the value on the dimension line, where the eye already is
      const [lx, ly] = labelAt(shapeRaw(p)); el.style.left = (lx + 24) + "px"; el.style.top = (ly - 13) + "px";
    }
    function forceKind(key) { const k = { h: "dx", v: "dy", a: "dist" }[key.toLowerCase()]; T.force = T.force === k ? null : k; hud(); render(); }
    // keys on the board while the tool is on: digits go into the HUD, H V A, Enter, Esc
    function onKey(e) {
      if (!active()) return false;
      if (e.key === "Escape") { if (T.a) { e.preventDefault(); cancel(); msg("Dimension cancelled"); return true; } return false; }
      if (!T.b) return false;
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key === "Enter") { e.preventDefault(); place(); return true; }
      if (/^[hHvVaA]$/.test(e.key) && !(T.a.line || T.b.line)) { e.preventDefault(); forceKind(e.key); return true; }
      if (/^[0-9.,-]$/.test(e.key)) { e.preventDefault(); T.val += e.key; hud(); const inp = $("dhud") && $("dhud").querySelector("input"); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } render(); return true; }
      if (e.key === "Backspace") { e.preventDefault(); T.val = T.val.slice(0, -1); hud(); render(); return true; }
      return false;
    }

    // ---------------------------------------------------------------------------
    // Selecting, dragging the label, deleting
    // ---------------------------------------------------------------------------
    function hit(x, y, boxOnly) {
      if (!shown() || !S.dboxes) return null;
      const tol = 4 / S.view.scale;
      for (let i = S.dboxes.length - 1; i >= 0; i--) {
        const q = S.dboxes[i], [bx, by, w, h] = q.box;
        if (x >= bx - tol && x <= bx + w + tol && y >= by - tol && y <= by + h + tol) return q.id;
      }
      if (boxOnly) return null;
      for (let i = S.dboxes.length - 1; i >= 0; i--) {
        const q = S.dboxes[i], [A, Bq] = q.line, dx = Bq[0] - A[0], dy = Bq[1] - A[1], L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, ((x - A[0]) * dx + (y - A[1]) * dy) / L2)) : 0;
        if (Math.hypot(A[0] + t * dx - x, A[1] + t * dy - y) <= tol) return q.id;
      }
      return null;
    }
    function select(x, y) {
      const id = hit(x, y); if (!id) return false;
      const d = dims().items.find(q => q.id === id); if (!d) return false;
      S.sel = { kind: "dim", id };
      S.drag = grab(id, x, y);
      renderPanels(); render(); return true;
    }
    // a drag of a dimension: where on its value it was taken, so the value does not jump to the pointer
    function grab(id, x, y) {
      const d = dims().items.find(q => q.id === id), sh = d && shape(d, D.makeEnv(S.board, S.model, S.csol));
      return { kind: "dim", id, o0: d && d.o, s0: d && d.s, mx: x, my: y, gx: sh ? x - sh.lbl[0] : 0, gy: sh ? y - sh.lbl[1] : 0, moved: false };
    }
    // the value goes where it is dragged, both ways: away from or nearer the things (the dimension line
    // follows, its extension lines still on them) and along the line (past an end, the line runs on)
    function drag(dr, x, y) {
      if (!dr.moved && Math.hypot(x - dr.mx, y - dr.my) * S.view.scale < 3) return;   // a click, not a drag (the pointer may twitch)
      const d = dims().items.find(q => q.id === dr.id); if (!d || !["dx", "dy", "dist", "pl"].includes(d.k)) return;
      const env = D.makeEnv(S.board, S.model, S.csol), m = [x - (dr.gx || 0), y - (dr.gy || 0)];
      if (d.k === "pl") {
        const p = env.point(d.a, null), l = env.line(d.b, null); if (!p || !l) return;
        const dx = l[2] - l[0], dy = l[3] - l[1], L = Math.hypot(dx, dy) || 1;
        d.o = R4(((m[0] - p[0]) * dx + (m[1] - p[1]) * dy) / L);
      } else {
        const pa = env.point(d.a, null), pb = env.point(d.b, null); if (!pa || !pb) return;
        d.o = R4(offsetFor(d.k, pa, pb, m));
      }
      const base = shapeBase(d, env); if (!base) return;
      const [A, Bq] = base.line, dx = Bq[0] - A[0], dy = Bq[1] - A[1], L = Math.hypot(dx, dy);
      if (L > 1e-9) { const s = ((m[0] - (A[0] + Bq[0]) / 2) * dx + (m[1] - (A[1] + Bq[1]) / 2) * dy) / L; d.s = Math.abs(s) < 0.3 ? 0 : R4(s); }   // near the middle: it snaps there
      dr.moved = true; render();
    }
    function deleteSel() {
      const s = S.sel; if (!s || s.kind !== "dim") return false;
      const d = dims().items.find(q => q.id === s.id); if (!d) return false;
      dims().items = dims().items.filter(q => q !== d); S.sel = null;
      commit(`Dimension deleted: ${D.describe(S.board, S.model, d)} no longer holds`);
      return true;
    }
    function dbl(x, y) {
      const id = hit(x, y); if (!id) return false;
      editAt(id); return true;
    }
    // the Modify box (as in SolidWorks): it pops up on the dimension's label when one is placed, clicked
    // in the Dimension tool or double-clicked; the value is selected, so typing replaces it. Enter or ✓
    // sets it (the second thing moves), Esc or ✗ keeps it as it was, ⇄ puts it on the other side, the
    // arrow keys step it by 0.1 mm (Shift: 1 mm)
    function editAt(id) {
      const d = dims().items.find(q => q.id === id); if (!d) return false;
      S.sel = { kind: "dim", id }; renderPanels();
      if (!D.HAS_VALUE[d.k]) { render(); msg("An alignment has no value: Del deletes it, the inspector makes it a reference"); return true; }
      E.id = id; render(); modBox();
      return true;
    }
    function closeEdit() { if (!E.id) return; E.id = null; const el = $("dmod"); if (el) el.hidden = true; render(); }
    function modBox() {
      const el = $("dmod"); if (!el) return;
      const d = E.id && dims().items.find(q => q.id === E.id), sh = d && shape(d, D.makeEnv(S.board, S.model, S.csol));
      if (!sh) { E.id = null; el.hidden = true; return; }
      const signed = d.k !== "dist", T_ = t => app.esc(tr(t));
      el.innerHTML = `<div class="dm-t">${T_("Modify")} <small>${T_(kindName(d.k))}</small></div>`
        + `<div class="dm-r"><input data-k="v" inputmode="decimal" value="${fmt(d.v)}" title="${T_("The value, mm: Enter sets it (the second thing moves), Esc leaves it as it was; ↑ ↓ step 0.1 mm, Shift 1 mm")}"><small>mm</small></div>`
        + `<div class="dm-b"><button class="btn" data-dm="ok" title="${T_("Set the value (Enter)")}">✓</button><button class="btn" data-dm="cancel" title="${T_("Keep it as it was (Esc)")}">✗</button>${signed ? `<button class="btn" data-dm="flip" title="${T_("The second thing on the other side of the first")}">⇄</button>` : ""}</div>`;
      const [lx, ly] = labelAt(sh); el.hidden = false;
      const wrap = el.offsetParent || el.parentElement, W = wrap ? wrap.clientWidth : 1e4, Hh = wrap ? wrap.clientHeight : 1e4;
      el.style.left = Math.max(4, Math.min(W - el.offsetWidth - 4, lx - el.offsetWidth / 2)) + "px";
      el.style.top = Math.max(4, Math.min(Hh - el.offsetHeight - 4, ly + 12)) + "px";
      const inp = el.querySelector("input"), id = E.id;
      let done = false;
      const finish = (set, flip) => {
        if (done) return; done = true;
        const v = parseFloat(inp.value.replace(",", ".")); E.id = null; el.hidden = true;
        if (d.ref && (set || flip)) { setRef(d, false); if (d.ref) return; }   // a value typed into a reference one: it drives from now on
        if (flip) { const was = d.v, cur = Number.isFinite(v) ? Math.abs(v) : Math.abs(d.v); d.v = -d.v; if (!setValue(d, cur)) d.v = was; }
        else if (set && Number.isFinite(v) && (v < 0 || Math.abs(Math.abs(d.v) - v) > 1e-9)) setValue(d, v);
        else render();
        app.canvas().focus();
      };
      inp.onkeydown = e => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape") { e.preventDefault(); finish(false); }
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const v = parseFloat(inp.value.replace(",", ".")) || 0, st = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowUp" ? 1 : -1); inp.value = (Math.round((v + st) * 100) / 100).toFixed(2); inp.select(); }
      };
      el.onmousedown = e => { if (e.target !== inp) e.preventDefault(); e.stopPropagation(); };   // its buttons keep the focus in the box
      el.onclick = e => { const b = e.target.closest("[data-dm]"); if (!b) return; finish(b.dataset.dm !== "cancel", b.dataset.dm === "flip"); };
      inp.onblur = () => setTimeout(() => { if (E.id === id && document.activeElement !== inp) finish(false); }, 0);
      inp.focus(); inp.select();
    }

    // ---------------------------------------------------------------------------
    // Inspectors (from board-panels.js)
    // ---------------------------------------------------------------------------
    function inspector(h, ui) {
      const s = S.sel, d = s && dims().items.find(q => q.id === s.id); if (!d) { S.sel = null; return false; }
      const { field, delBtn } = ui, b = S.board, env = D.makeEnv(b, S.model, S.csol);
      h.innerHTML = `<div class="insp-title">${app.esc(D.NAMES[d.k])} <small class="help">${app.esc(d.id.toUpperCase())}</small></div>`;
      const help = (t, cls) => h.insertAdjacentHTML("beforeend", `<p class="help${cls ? " " + cls : ""}">${app.esc(t)}</p>`);
      help(D.describe(b, S.model, d.ref ? { ...d, v: D.measure(env, d) } : d));
      help(`From ${D.featureName(b, S.model, d.a)} to ${D.featureName(b, S.model, d.b)}`);
      if (S.dsol && S.dsol.lost.has(d.id)) help("Something it names is gone: delete it, or bring that back.", "bad");
      if (S.dsol && S.dsol.bad.has(d.id)) help("Not met: it fights another dimension or a locked part. Change its value, make it a reference or delete it.", "bad");
      if (D.HAS_VALUE[d.k]) {
        const f = field(d.ref ? "Measured (mm)" : "Dimension value (mm)", d.ref ? fmt(D.measure(env, d) || 0) : fmt(d.v), v => { if (d.ref) { renderPanels(); return; } setValue(d, +v); });
        f.dataset.dimval = "1"; if (d.ref) { const i = f.querySelector("input"); if (i) i.disabled = true; } h.appendChild(f);
      }
      h.appendChild(field("Role", d.ref ? "ref" : "drive", v => setRef(d, v === "ref"), [["drive", "Driving: it holds them"], ["ref", "Reference: it only shows"]]));
      help(d.k === "hz" || d.k === "vt" ? "The second stays level with (or in line with) the first when either moves." : "Changing the value moves the second thing; dragging either moves the other with it. Drag the value anywhere (up, down, left, right): the dimension line and its extension lines follow it, still tied to what it measures.");
      h.appendChild(delBtn());
      return true;
    }
    function bodyKeyOfSel(s) {
      const b = S.board; if (!s) return null;
      if (s.kind === "part") return "part:" + s.key;
      const o = s.kind === "hole" ? b.holes[s.i] : s.kind === "via" ? b.vias[s.i] : s.kind === "text" ? b.texts[s.i] : s.kind === "keepout" ? b.keepouts[s.i] : null;
      if (!o || !o.id) return null;
      return ({ hole: "hole:", via: "via:", text: "text:", keepout: "ko:" })[s.kind] + o.id;
    }
    // a part's, hole's, via's, text's or keep-out's inspector: what its dimensions leave free
    function bodyInfo(h) {
      const key = bodyKeyOfSel(S.sel); if (!key) return;
      const list = D.onBody(S.board, key); if (!list.length) return;
      const fr = D.freedom(S.board, S.model, S.csol).get(key), locked = (D.objOfBody(S.board, key) || {}).locked;
      const state = locked ? "locked" : !fr ? "free" : fr.x && fr.y ? "fully defined" : fr.x ? "free to move up and down" : fr.y ? "free to move sideways" : "free to move";
      const row = document.createElement("div"); row.className = "help";
      row.innerHTML = `<b>${list.length} dimension${list.length > 1 ? "s" : ""}</b> · ${app.esc(state)}`;
      row.title = list.map(d => D.describe(S.board, S.model, d)).join("\n");
      h.appendChild(row);
      const btn = document.createElement("button"); btn.className = "btn"; btn.style.cssText = "margin:2px 0 6px"; btn.textContent = "Remove its dimensions";
      btn.title = "Delete the dimensions and alignments that hold it; it stays where it is";
      btn.onclick = () => removeOf(key); h.appendChild(btn);
    }

    function init() {
      document.querySelectorAll("[data-dalign]").forEach(b => b.addEventListener("click", () => align(b.dataset.dalign)));
      const q = id => $(id);
      if (q("mi-dshow")) q("mi-dshow").addEventListener("click", () => setShown(!shown()));
      if (q("mi-dclear")) q("mi-dclear").addEventListener("click", clearAll);
      menuState();
    }

    return { HELP, enforce, toolChanged, onDown, onMove, onKey, cancel, select, drag, deleteSel, dbl, editAt, closeEdit, fromMeasure, hit, draw, inspector, bodyInfo, align, clearAll, setShown, menuState, init, add, setValue, featureAt, isSel: id => !!(S.sel && S.sel.kind === "dim" && S.sel.id === id) };
  };
})(typeof window !== "undefined" ? window : globalThis);
