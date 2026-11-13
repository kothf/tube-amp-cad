/* The Board window's outline sketch (board-outline.js does the geometry): the board's edge drawn as a
   2D sketch of lines, arcs and circles, with rectangles, regular polygons and fillets as shortcuts,
   and closed shapes inside it as cut-outs. While the sketch is open the board itself is not edited:
   the bar over the board has the tools, the numbers typed on the board go into the HUD (length and
   angle, radius, width and height, X Y), points stick to the sketch's own ends, middles and centres
   and to everything the board snaps to. Finish checks the sketch (closed, not crossing, cut-outs
   inside) and makes it the outline; Cancel leaves the board as it was.
   A factory, like board-cons.js: BoardSketch(app) takes what it needs from board-app.js by name. */
(function (root) {
  "use strict";
  root.BoardSketch = function (app) {
    const { $, S, msg } = app;
    const OL = root.BoardOutline, K = root.BoardConstruct, RAD = Math.PI / 180, R4 = v => Math.round(v * 1e4) / 1e4;
    const render = () => app.render();
    const TOL = 0.01;          // mm: ends this close are one point
    const COLOR = "#ffd54f", SEL = "#ffffff", BAD = "#ff5252", GHOST = "#8fd3ff";
    const TOOLS = [
      ["select", "Select", "S", "Select and edit: drag an end to move the corner (the lines that meet there follow), drag a line or arc to move it, drag an arc's middle mark to bend it, a circle's rim to size it. Click one to type its numbers in the bar; double-click a line to split it; Del deletes (S)", "M3 2l8 5-3.5 1 2.5 4-1.5.8-2.5-4L3 11z"],
      ["line", "Line", "L", "Line: click point after point; it ends when it closes on a point of the sketch (or Esc, or a double-click). Type the length (and Tab, the angle) and press Enter. Shift: steps of 15°; Alt: the grid only (L)", "M3 13L13 3M2 13h2v-2M12 3h2v2"],
      ["arc", "Arc", "A", "Arc through three points: click its start, its end, then a point it passes through; or type the radius R and press Enter (the side: where the pointer is) (A)", "M2.5 12.5a10 10 0 0 1 11-9"],
      ["circle", "Circle", "C", "Circle: click the centre, then the rim; or type the diameter Ø and press Enter. Alone it is a round board; inside the edge it is a round cut-out (C)", "M8 8m-5.5 0a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0"],
      ["rect", "Rectangle", "R", "Rectangle: click a corner, then the opposite one; or type W (Tab) H and press Enter. Inside the edge it is a cut-out (R)", "M2.5 4h11v8h-11z"],
      ["poly", "Polygon", "P", "Regular polygon: type the number of sides N, click the centre, then a corner; or type the radius R and press Enter (P)", "M8 2l5.2 3v6L8 14l-5.2-3V5z"],
      ["slot", "Slot", "O", "Slot: click the centre of one round end, then of the other; W is its width (type it, Tab). Inside the edge it is a routed slot (O)", "M5 5h6a3 3 0 0 1 0 6H5a3 3 0 0 1 0-6z"],
      ["fillet", "Fillet", "F", "Fillet: type the radius R, then click a corner where two lines meet: it is rounded (F)", "M3 13V8a5 5 0 0 1 5-5h5"]
    ];
    const HELP = Object.fromEntries(TOOLS.map(t => [t[0], t[3]]));
    let K_ = null;   // the open sketch: { ents, tool, a, b, chain, sel, hud, hist, hi, res, sp, drag, src }
    const active = () => !!K_;
    const H = () => S.board.outline.h;
    const uy = y => R4(H() - y);            // board y ↔ the user's Y (up from the bottom edge of the box)
    const fmt = v => String(+(+v).toFixed(3));

    // ---------------------------------------------------------------------------
    // Entities
    // ---------------------------------------------------------------------------
    const ends = e => (e.t === "C" ? [] : [[e.x1, e.y1], [e.x2, e.y2]]);
    const near = (ax, ay, bx, by, t) => Math.hypot(ax - bx, ay - by) <= (t || TOL);
    const arcG = e => OL.arcOf(e.x1, e.y1, e.x2, e.y2, e.b);
    const midOf = e => (e.t === "C" ? [e.cx, e.cy] : e.t === "A" ? OL.arcPt(arcG(e), 0.5) : [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2]);
    function distTo(e, x, y) {
      if (e.t === "C") return Math.abs(Math.hypot(x - e.cx, y - e.cy) - e.r);
      return OL.segDist(e.t === "A" ? { t: "A", ...e, ...arcG(e) } : { t: "L", ...e }, x, y);
    }
    const bulge3 = OL.bulge3;   // the bulge of the arc from p to q through m
    // the bulge of an arc of radius r from p to q, on the side of the chord where m is (the short way round)
    function bulgeR(p, q, r, m) {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]) / 2; if (r < d + 1e-9) r = d;
      const s = r - Math.sqrt(Math.max(0, r * r - d * d)), cr = (q[0] - p[0]) * (m[1] - p[1]) - (q[1] - p[1]) * (m[0] - p[0]);
      return (cr > 0 ? -1 : 1) * s / d;
    }
    // every end at (x, y) moved to (nx, ny)
    function moveNode(x, y, nx, ny) {
      K_.ents.forEach(e => { if (e.t === "C") return; if (near(e.x1, e.y1, x, y)) { e.x1 = nx; e.y1 = ny; } if (near(e.x2, e.y2, x, y)) { e.x2 = nx; e.y2 = ny; } });
    }
    const add = (...es) => { es.forEach(e => K_.ents.push(e)); };
    const lineE = (x1, y1, x2, y2) => ({ t: "L", x1: R4(x1), y1: R4(y1), x2: R4(x2), y2: R4(y2) });
    // a half circle from p to q, bulging away from the point `from` (a slot's end)
    const arcAway = (p, q, from) => { const mk = s => ({ ...lineE(p[0], p[1], q[0], q[1]), t: "A", b: s }), far = s => { const m = midOf(mk(s)); return Math.hypot(m[0] - from[0], m[1] - from[1]); }; return far(1) > far(-1) ? mk(1) : mk(-1); };

    // ---------------------------------------------------------------------------
    // The sketch's own history, and its check after every change
    // ---------------------------------------------------------------------------
    function check() {
      K_.res = OL.fromEntities(K_.ents, TOL);
      const b = $("sk-finish"); if (b) b.disabled = !!K_.res.error;
      const st = $("sk-state");
      if (st) { st.textContent = K_.res.error ? K_.res.error : `Closed: ${OL.describe(OL.outlineOf(K_.res))}. Finish makes it the board's outline`; st.classList.toggle("bad", !!K_.res.error); }
    }
    function push() { K_.hist.length = K_.hi + 1; K_.hist.push(JSON.stringify(K_.ents)); K_.hi = K_.hist.length - 1; check(); props(); render(); }
    function step(d) {
      const i = K_.hi + d; if (i < 0 || i >= K_.hist.length) return;
      K_.hi = i; K_.ents = JSON.parse(K_.hist[i]); K_.sel = []; K_.a = K_.b = K_.chain = null; check(); props(); render();
    }
    const revert = () => { K_.ents = JSON.parse(K_.hist[K_.hi]); };   // a drag given up

    // ---------------------------------------------------------------------------
    // Open, finish, cancel
    // ---------------------------------------------------------------------------
    /** the curve(s) of an outline (board-construct.js's list, user frame) an entity is: their indexes */
    function curvesOf(curves, e, h) {
      const Y = y => h - y, hit = [];
      curves.forEach((c, k) => {
        if (!c) return;
        if (e.t === "L" && c.t === "L" && ((near(c.x1, c.y1, e.x1, Y(e.y1), 1e-3) && near(c.x2, c.y2, e.x2, Y(e.y2), 1e-3)) || (near(c.x1, c.y1, e.x2, Y(e.y2), 1e-3) && near(c.x2, c.y2, e.x1, Y(e.y1), 1e-3)))) hit.push(k);
        else if (e.t === "C" && c.t === "C" && near(c.cx, c.cy, e.cx, Y(e.cy), 1e-3) && Math.abs(c.r - e.r) < 1e-3) hit.push(k);
        else if (e.t === "A" && c.t === "C") { const g = arcG(e), m = OL.arcPt(g, 0.5); if (near(c.cx, c.cy, g.cx, Y(g.cy), 1e-3) && Math.abs(c.r - g.r) < 1e-3 && K.onArc(c, Math.atan2(Y(m[1]) - c.cy, m[0] - c.cx) / RAD)) hit.push(k); }
      });
      return hit;
    }
    function open(tool) {
      if (K_) return;
      if (!$("view3d").hidden) return;
      app.setTool("select"); S.sel = null; S.measure = null;
      const o = S.board.outline, ents = OL.toEntities(o), curves = K.outlineCurves(o);
      ents.forEach(e => { e.src = curvesOf(curves, e, o.h); });   // which outline curve each one was: what is tied to it follows
      K_ = { ents, tool: tool || "select", a: null, b: null, chain: null, sel: [], hud: {}, hist: [], hi: -1, res: null, sp: null, drag: null };
      S.sketch = K_;
      $("skbar").hidden = false; document.body.classList.add("sketching");
      push(); setTool(K_.tool);
      app.renderPanels();
      msg("Outline sketch: draw the board's edge with the tools over the board (closed shapes inside it are cut-outs), then Finish. Esc ends a tool; Cancel leaves the board as it was");
    }
    function close() {
      K_ = null; S.sketch = null;
      $("skbar").hidden = true; $("skhud").hidden = true; document.body.classList.remove("sketching");
      app.renderPanels(); render();
    }
    function cancel() { if (!K_) return; close(); msg("Outline sketch cancelled: the board is as it was"); }
    function finish() {
      if (!K_) return;
      check();
      const res = K_.res;
      if (res.error) { msg(res.error); render(); return; }
      const ents = K_.ents, flat = [].concat(...res.ents);
      close();
      app.applyOutline(OL.outlineOf(res), res.dx, res.dy, (oldCurves, newCurves, hNew) => {
        // old curve index → new one, by the entity that was the one and is now the other
        const map = {};
        ents.forEach((e, i) => {
          if (!e.src || !e.src.length || !flat.includes(i)) return;
          const moved = e.t === "C" ? { ...e, cx: e.cx + res.dx, cy: e.cy + res.dy } : { ...e, x1: e.x1 + res.dx, y1: e.y1 + res.dy, x2: e.x2 + res.dx, y2: e.y2 + res.dy };
          const now = curvesOf(newCurves, moved, hNew);
          e.src.forEach((k, j) => { if (now[j] !== undefined) map[k] = now[j]; else if (now.length) map[k] = now[0]; });
        });
        return map;
      });
    }

    // ---------------------------------------------------------------------------
    // The bar and the HUD
    // ---------------------------------------------------------------------------
    const HUDF = {
      line: s => (s.a ? [["len", "L", "mm"], ["ang", "θ", "°"]] : [["x", "X", "mm"], ["y", "Y", "mm"]]),
      arc: s => (s.a && s.b ? [["r", "R", "mm"]] : [["x", "X", "mm"], ["y", "Y", "mm"]]),
      circle: s => (s.a ? [["d", "Ø", "mm"]] : [["x", "X", "mm"], ["y", "Y", "mm"]]),
      rect: s => (s.a ? [["w", "W", "mm"], ["h", "H", "mm"]] : [["x", "X", "mm"], ["y", "Y", "mm"]]),
      poly: s => (s.a ? [["n", "N", ""], ["r", "R", "mm"]] : [["n", "N", ""], ["x", "X", "mm"], ["y", "Y", "mm"]]),
      slot: s => (s.a ? [["w", "W", "mm"], ["len", "L", "mm"]] : [["w", "W", "mm"], ["x", "X", "mm"], ["y", "Y", "mm"]]),
      fillet: () => [["r", "R", "mm"]]
    };
    const HUD_TIP = { len: "Length, mm (Enter places it)", ang: "Angle, degrees counter-clockwise from the X axis", r: "Radius, mm", d: "Diameter, mm (Enter places it)", w: "Width, mm", h: "Height, mm (Enter places it)", n: "Number of sides (3 to 24)", x: "X from the board's origin, mm", y: "Y (up) from the board's origin, mm (Enter places the point)" };
    const KEEP = { n: 6, r: 3, w: 4 };   // numbers that stay from one use to the next: sides, fillet radius, slot width
    const hudNum = k => { const v = parseFloat(String(K_.hud[k] === undefined ? "" : K_.hud[k]).replace(",", ".")); return Number.isFinite(v) ? v : null; };
    const sidesN = () => Math.max(3, Math.min(24, Math.round(hudNum("n") || KEEP.n)));
    const filletR = () => (hudNum("r") > 0 ? hudNum("r") : KEEP.r);
    const slotW = () => (hudNum("w") > 0 ? hudNum("w") : KEEP.w);
    let hudSig = "";
    function buildHud(force) {
      const el = $("skhud"); if (!el) return;
      const f = K_ && HUDF[K_.tool] ? HUDF[K_.tool](K_) : null;
      if (!f) { el.hidden = true; el.innerHTML = ""; hudSig = ""; return; }
      const sig = K_.tool + ":" + f.map(q => q[0]).join(",");
      if (sig === hudSig && !force) { placeHud(); return; }
      hudSig = sig;
      const ph = k => (k === "n" ? KEEP.n : k === "r" && K_.tool === "fillet" ? KEEP.r : k === "w" && K_.tool === "slot" ? KEEP.w : "");
      el.innerHTML = f.map(([k, l, u]) => `<label title="${HUD_TIP[k]}">${l} <input data-k="${k}" inputmode="decimal" autocomplete="off" placeholder="${ph(k)}" value="${K_.hud[k] === undefined ? "" : K_.hud[k]}"> <small>${u}</small></label>`).join("") + `<small class="chud-k">Enter</small>`;
      el.querySelectorAll("input").forEach(inp => {
        inp.addEventListener("input", () => { K_.hud[inp.dataset.k] = inp.value; render(); });
        inp.addEventListener("keydown", e => {
          if (e.key === "Enter") { e.preventDefault(); enter(); }
          else if (e.key === "Escape") { e.preventDefault(); K_.hud = {}; buildHud(true); app.canvas().focus(); render(); }
          e.stopPropagation();
        });
      });
      el.hidden = false; placeHud();
    }
    function placeHud() {
      const el = $("skhud"); if (!el || el.hidden || el.contains(document.activeElement)) return;
      const [sx, sy] = app.toScreen(S.mouse[0], S.mouse[1]), st = $("stage"), W = st.clientWidth, Hh = st.clientHeight;
      let left = sx + 18, top = sy + 22;
      if (left + el.offsetWidth > W - 6) left = sx - el.offsetWidth - 18;
      if (top + el.offsetHeight > Hh - 6) top = sy - el.offsetHeight - 22;
      el.style.left = Math.max(4, Math.min(W - el.offsetWidth - 4, left)) + "px"; el.style.top = Math.max(44, Math.min(Hh - el.offsetHeight - 4, top)) + "px";
    }
    function hudKey(e) {
      const el = $("skhud"); if (!el || el.hidden || e.ctrlKey || e.metaKey || e.altKey) return false;
      if (!/^[0-9.,-]$/.test(e.key)) return false;
      const inp = [...el.querySelectorAll("input")].find(i => !(K_.tool === "poly" && i.dataset.k === "n") && !(K_.tool === "slot" && !K_.a && i.dataset.k === "w")) || el.querySelector("input"); if (!inp) return false;
      e.preventDefault(); inp.focus(); inp.value += e.key; K_.hud[inp.dataset.k] = inp.value; render();
      return true;
    }
    function setTool(t) {
      if (!K_) return;
      if (K_.tool === "fillet" && hudNum("r") > 0) KEEP.r = hudNum("r");
      if (hudNum("n") >= 3) KEEP.n = sidesN();
      if (K_.tool === "slot" && hudNum("w") > 0) KEEP.w = hudNum("w");
      K_.tool = t; K_.a = K_.b = K_.chain = null; K_.hud = {}; K_.drag = null;
      if (t !== "select") K_.sel = [];
      document.querySelectorAll("#skbar [data-sk]").forEach(b => b.classList.toggle("active", b.dataset.sk === t));
      buildHud(true); props(); msg(HELP[t]); render();
    }
    // the numbers of the one selected entity, in the bar: typed, they move it
    function props() {
      const el = $("sk-props"); if (!el) return;
      const e = K_ && K_.tool === "select" && K_.sel.length === 1 ? K_.ents[K_.sel[0]] : null;
      if (!e) { el.innerHTML = K_ && K_.sel.length > 1 ? `<small>${K_.sel.length} selected: Del deletes them</small>` : ""; return; }
      const f = [];
      if (e.t === "C") f.push(["cx", "X", e.cx], ["cy", "Y", uy(e.cy)], ["d", "Ø", 2 * e.r]);
      else {
        f.push(["x1", "X1", e.x1], ["y1", "Y1", uy(e.y1)], ["x2", "X2", e.x2], ["y2", "Y2", uy(e.y2)]);
        if (e.t === "L") f.push(["len", "L", Math.hypot(e.x2 - e.x1, e.y2 - e.y1)], ["ang", "θ", ((Math.atan2(-(e.y2 - e.y1), e.x2 - e.x1) / RAD) + 360) % 360]);
        else f.push(["r", "R", arcG(e).r]);
      }
      el.innerHTML = `<b>${e.t === "C" ? "Circle" : e.t === "A" ? "Arc" : "Line"}</b>` + f.map(([k, l, v]) => `<label>${l} <input data-p="${k}" inputmode="decimal" autocomplete="off" value="${fmt(v)}"></label>`).join("");
      el.querySelectorAll("input").forEach(inp => {
        inp.addEventListener("keydown", ev => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); inp.blur(); } else if (ev.key === "Escape") { ev.preventDefault(); props(); app.canvas().focus(); } });
        inp.addEventListener("change", () => {
          const v = parseFloat(String(inp.value).replace(",", ".")), k = inp.dataset.p; if (!Number.isFinite(v)) { props(); return; }
          if (e.t === "C") { if (k === "cx") e.cx = R4(v); else if (k === "cy") e.cy = R4(H() - v); else if (v > 0) e.r = R4(v / 2); }
          else if (k === "x1" || k === "y1") moveNode(e.x1, e.y1, k === "x1" ? R4(v) : e.x1, k === "y1" ? R4(H() - v) : e.y1);
          else if (k === "x2" || k === "y2") moveNode(e.x2, e.y2, k === "x2" ? R4(v) : e.x2, k === "y2" ? R4(H() - v) : e.y2);
          else if (k === "len" || k === "ang") {
            // the second end goes where the length and the angle put it (what meets there follows)
            const L = k === "len" ? v : Math.hypot(e.x2 - e.x1, e.y2 - e.y1), a = (k === "ang" ? v : Math.atan2(-(e.y2 - e.y1), e.x2 - e.x1) / RAD) * RAD;
            if (L > 0) moveNode(e.x2, e.y2, R4(e.x1 + L * Math.cos(a)), R4(e.y1 - L * Math.sin(a)));
          } else if (k === "r" && v > 0) { const nb = bulgeR([e.x1, e.y1], [e.x2, e.y2], v, OL.arcPt(arcG(e), 0.5)); e.b = Math.abs(e.b) > 1 && Math.abs(nb) > 1e-6 ? 1 / nb : nb; }   // more than a half circle stays so
          push();
        });
      });
    }
    function init() {
      const bar = $("skbar"); if (!bar) return;
      const ico = d => `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
      bar.innerHTML = `<b class="sk-title" title="The board's outline as a sketch: the edge, and closed shapes inside it as cut-outs">Outline sketch</b>` +
        TOOLS.map(([id, name, key, tip, d]) => `<button class="btn" data-sk="${id}" title="${tip}">${ico(d)}<span>${name}</span><kbd>${key}</kbd></button>`).join("") +
        `<span class="sk-sep"></span><button class="btn" id="sk-undo" title="Undo the last sketch step (Ctrl+Z)">${ico("M6 3L2.5 6.5 6 10M3 6.5h6a4 4 0 0 1 0 8H6")}</button><button class="btn" id="sk-redo" title="Redo (Ctrl+Y)">${ico("M10 3l3.5 3.5L10 10M13 6.5H7a4 4 0 0 0 0 8h3")}</button>` +
        `<button class="btn" id="sk-rect" title="Start again from a plain rectangle the size of the board">Reset to rectangle</button>` +
        `<span class="sk-sep"></span><button class="btn active" id="sk-finish" title="Check the sketch and make it the board's outline (Enter). The Gerbers, the 3D model, the checks and the routers then follow it">✓ Finish</button><button class="btn" id="sk-cancel" title="Leave the sketch: the board's outline stays as it was">✗ Cancel</button>` +
        `<div class="sk-row2"><span id="sk-props"></span><span id="sk-state"></span></div>`;
      bar.querySelectorAll("[data-sk]").forEach(b => { b.onclick = () => { setTool(b.dataset.sk); app.canvas().focus(); }; });
      $("sk-undo").onclick = () => step(-1); $("sk-redo").onclick = () => step(1);
      $("sk-finish").onclick = finish; $("sk-cancel").onclick = cancel;
      $("sk-rect").onclick = () => { const o = S.board.outline; K_.ents = OL.toEntities({ w: o.w, h: o.h, r: 0 }); K_.sel = []; push(); };
      const m = $("btn-sketch"); if (m) m.onclick = () => open();
    }

    // ---------------------------------------------------------------------------
    // Snapping: the sketch's own points first, then what the board sticks to
    // ---------------------------------------------------------------------------
    function snapAt(x, y, e, skip) {
      const tol = 10 / S.view.scale; let best = null, bd = tol;
      const at = (px, py, what) => { const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = { p: [R4(px), R4(py)], what, shape: "corner", own: true }; } };
      if (!(e && e.altKey)) {
        K_.ents.forEach((q, i) => {
          if (skip && skip(q, i)) return;
          if (q.t === "C") { at(q.cx, q.cy, "circle centre"); [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => at(q.cx + dx * q.r, q.cy + dy * q.r, "circle quadrant")); return; }
          at(q.x1, q.y1, "end"); at(q.x2, q.y2, "end");
          const m = midOf(q); at(m[0], m[1], "middle");
          if (q.t === "A") { const g = arcG(q); at(g.cx, g.cy, "arc centre"); }
        });
        if (best) return best;
      }
      const sp = app.snapPoint(x, y, !!(e && e.altKey));
      // straight across or straight up from the point before: within a few pixels the line goes true
      const a = K_.a && K_.tool === "line" ? K_.a : null;
      if (a && sp.shape === "grid" && !(e && e.altKey)) {
        const t = 6 / S.view.scale;
        if (Math.abs(sp.p[1] - a[1]) < t && Math.abs(sp.p[1] - a[1]) > 0) return { ...sp, p: [sp.p[0], a[1]], what: "horizontal" };
        if (Math.abs(sp.p[0] - a[0]) < t && Math.abs(sp.p[0] - a[0]) > 0) return { ...sp, p: [a[0], sp.p[1]], what: "vertical" };
      }
      return sp;
    }
    // where the next point goes: the snap, or (Shift, line) on a 15° ray from the point before; the HUD's numbers win
    function target(x, y, e) {
      const sp = snapAt(x, y, e); let p = sp.p.slice();
      const a = K_.a, t = K_.tool;
      if (t === "line" && a) {
        let ang = Math.atan2(-(p[1] - a[1]), p[0] - a[0]), len = Math.hypot(p[0] - a[0], p[1] - a[1]);
        if (e && e.shiftKey && !sp.own) { ang = Math.round(ang / (15 * RAD)) * 15 * RAD; len = Math.hypot(x - a[0], y - a[1]); len = Math.round(len / (S.grid || 0.5)) * (S.grid || 0.5); }
        const hl = hudNum("len"), ha = hudNum("ang");
        if (ha !== null) ang = ha * RAD;
        if (hl !== null && hl > 0) len = hl;
        if (hl !== null || ha !== null || (e && e.shiftKey && !sp.own)) p = [R4(a[0] + len * Math.cos(ang)), R4(a[1] - len * Math.sin(ang))];
      }
      return { p, sp };
    }
    const typedXY = () => { const X = hudNum("x"), Y = hudNum("y"); return X !== null && Y !== null ? [R4(X), R4(H() - Y)] : null; };

    // ---------------------------------------------------------------------------
    // What a tool would make now (also its preview): entities from the points so far and p
    // ---------------------------------------------------------------------------
    function make(p) {
      const a = K_.a, t = K_.tool;
      if (!a) return [];
      if (t === "line") return near(a[0], a[1], p[0], p[1]) ? [] : [lineE(a[0], a[1], p[0], p[1])];
      if (t === "circle") { const d = hudNum("d"), r = d > 0 ? d / 2 : Math.hypot(p[0] - a[0], p[1] - a[1]); return r > TOL ? [{ t: "C", cx: a[0], cy: a[1], r: R4(r) }] : []; }
      if (t === "rect") {
        const w = hudNum("w"), h = hudNum("h"), sx = p[0] >= a[0] ? 1 : -1, sy = p[1] >= a[1] ? 1 : -1;
        const x2 = w > 0 ? a[0] + sx * w : p[0], y2 = h > 0 ? a[1] + sy * h : p[1];
        if (Math.abs(x2 - a[0]) < TOL || Math.abs(y2 - a[1]) < TOL) return [];
        return [lineE(a[0], a[1], x2, a[1]), lineE(x2, a[1], x2, y2), lineE(x2, y2, a[0], y2), lineE(a[0], y2, a[0], a[1])];
      }
      if (t === "poly") {
        const n = sidesN(), hr = hudNum("r"), r = hr > 0 ? hr : Math.hypot(p[0] - a[0], p[1] - a[1]); if (r < TOL) return [];
        const P = OL.polygonLoop(a[0], a[1], r, n, Math.atan2(p[1] - a[1], p[0] - a[0]));
        return P.map((q, i) => { const s = P[(i + 1) % n]; return lineE(q[0], q[1], s[0], s[1]); });
      }
      if (t === "slot") {
        let dx = p[0] - a[0], dy = p[1] - a[1], len = Math.hypot(dx, dy); const r = slotW() / 2, hl = hudNum("len");
        if (len < TOL) return [];
        if (hl > 0) { dx *= hl / len; dy *= hl / len; len = hl; }
        const nx = -dy / len * r, ny = dx / len * r, b = [a[0] + dx, a[1] + dy];
        const A1 = [a[0] + nx, a[1] + ny], A2 = [a[0] - nx, a[1] - ny], B1 = [b[0] + nx, b[1] + ny], B2 = [b[0] - nx, b[1] - ny];
        return [lineE(A1[0], A1[1], B1[0], B1[1]), arcAway(B1, B2, a), lineE(B2[0], B2[1], A2[0], A2[1]), arcAway(A2, A1, b)];
      }
      if (t === "arc") {
        const b = K_.b; if (!b) return near(a[0], a[1], p[0], p[1]) ? [] : [lineE(a[0], a[1], p[0], p[1])];   // the chord, until the third point
        const hr = hudNum("r"), bl = hr > 0 ? bulgeR(a, b, hr, p) : bulge3(a, b, p);
        return Math.abs(bl) > 1e-6 ? [{ ...lineE(a[0], a[1], b[0], b[1]), t: "A", b: bl }] : [];
      }
      return [];
    }
    // a click (or Enter) at p
    function place(p, dbl) {
      const t = K_.tool;
      if (t === "fillet") { fillet(p); return; }
      if (!K_.a) { K_.a = p; K_.chain = p; K_.hud = t === "poly" ? { n: K_.hud.n } : t === "slot" ? { w: K_.hud.w } : {}; buildHud(); render(); return; }
      if (t === "arc" && !K_.b) { if (!near(K_.a[0], K_.a[1], p[0], p[1])) { K_.b = p; K_.hud = {}; buildHud(); } render(); return; }
      const made = make(p); if (!made.length) { render(); return; }
      add(...made);
      if (t === "line") {
        // the chain goes on from here, until it closes on a point the sketch already has
        const end = [made[0].x2, made[0].y2], closes = K_.ents.some(e => e !== made[0] && ends(e).some(q => near(q[0], q[1], end[0], end[1])));
        K_.a = closes || dbl ? null : end; K_.hud = {};
      } else { K_.a = K_.b = null; K_.hud = t === "poly" ? { n: K_.hud.n } : t === "slot" ? { w: K_.hud.w } : {}; }
      push(); buildHud();
    }
    function enter() {
      if (!K_) return;
      if (K_.tool === "select") { finish(); return; }
      if (K_.tool === "fillet") { app.canvas().focus(); return; }
      if (!K_.a) { const p = typedXY(); if (p) place(p); app.canvas().focus(); return; }
      if (K_.tool === "arc" && !K_.b) { app.canvas().focus(); return; }
      place(target(S.mouse[0], S.mouse[1], null).p); app.canvas().focus();
    }
    // the corner nearest p where two lines meet, rounded with the HUD's radius
    function fillet(p) {
      const r = filletR(), tol = 12 / S.view.scale;
      let node = null, nd = tol;
      K_.ents.forEach(e => ends(e).forEach(q => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < nd) { nd = d; node = q.slice(); } }));
      if (!node) { msg("Fillet: click a corner where two lines meet"); return; }
      const at = K_.ents.filter(e => e.t !== "C" && ends(e).some(q => near(q[0], q[1], node[0], node[1])));
      if (at.length !== 2 || at.some(e => e.t !== "L")) { msg("Fillet: this corner is not two lines meeting (an arc is already round)"); return; }
      const dir = e => { const first = near(e.x1, e.y1, node[0], node[1]), o = first ? [e.x2, e.y2] : [e.x1, e.y1], l = Math.hypot(o[0] - node[0], o[1] - node[1]); return { u: [(o[0] - node[0]) / l, (o[1] - node[1]) / l], l, first }; };
      const d1 = dir(at[0]), d2 = dir(at[1]), cos = d1.u[0] * d2.u[0] + d1.u[1] * d2.u[1], phi = Math.acos(Math.max(-1, Math.min(1, cos)));
      if (phi < 1e-3 || Math.PI - phi < 1e-3) { msg("Fillet: the two lines run on in one line"); return; }
      const t = r / Math.tan(phi / 2);
      if (t > d1.l - TOL || t > d2.l - TOL) { msg(`Fillet: R ${fmt(r)} mm is too large for this corner (the shorter line is ${fmt(Math.min(d1.l, d2.l))} mm)`); return; }
      const A = [R4(node[0] + d1.u[0] * t), R4(node[1] + d1.u[1] * t)], Bp = [R4(node[0] + d2.u[0] * t), R4(node[1] + d2.u[1] * t)];
      const cut = (e, d, q) => { if (d.first) { e.x1 = q[0]; e.y1 = q[1]; } else { e.x2 = q[0]; e.y2 = q[1]; } };
      cut(at[0], d1, A); cut(at[1], d2, Bp);
      // the arc turns through 180° − φ, bulging towards the old corner
      const bm = Math.tan((Math.PI - phi) / 4), arc = s => ({ t: "A", x1: A[0], y1: A[1], x2: Bp[0], y2: Bp[1], b: s * bm });
      const dm = s => { const m = midOf(arc(s)); return Math.hypot(m[0] - node[0], m[1] - node[1]); };
      add(dm(1) < dm(-1) ? arc(1) : arc(-1));
      KEEP.r = r; push();
    }

    // ---------------------------------------------------------------------------
    // Select: picking and dragging
    // ---------------------------------------------------------------------------
    function hit(x, y) {
      const tol = 7 / S.view.scale; let best = null;
      const take = (d, h) => { if (d <= tol && (!best || d < best.d - 1e-9)) best = { d, ...h }; };
      // ends first (a corner), then the marks of the selected ones, then bodies
      K_.ents.forEach((e, i) => ends(e).forEach((q, k) => take(Math.hypot(q[0] - x, q[1] - y) * 0.5, { kind: "node", i, k, p: q.slice() })));
      K_.ents.forEach((e, i) => {
        if (e.t === "C") take(Math.hypot(e.cx - x, e.cy - y) * 0.5, { kind: "centre", i });
        if (e.t === "A") { const m = midOf(e); take(Math.hypot(m[0] - x, m[1] - y) * 0.6, { kind: "bend", i }); }
      });
      if (best) return best;
      K_.ents.forEach((e, i) => take(distTo(e, x, y), { kind: e.t === "C" ? "rim" : "body", i }));
      return best;
    }
    function onDown(x, y, e) {
      if (!K_) return false;
      if (K_.tool !== "select") { const tg = target(x, y, e); place(K_.tool === "fillet" ? [x, y] : tg.p); return true; }
      const h = hit(x, y);
      if (!h) { if (!e.shiftKey) K_.sel = []; props(); render(); return true; }
      if (e.shiftKey) { K_.sel = K_.sel.includes(h.i) ? K_.sel.filter(i => i !== h.i) : K_.sel.concat([h.i]); }
      else if (!K_.sel.includes(h.i)) K_.sel = [h.i];
      K_.drag = { ...h, mx: x, my: y, moved: false, ents0: JSON.stringify(K_.ents) };
      props(); render();
      return true;
    }
    function onMove(x, y, e) {
      if (!K_) return false;
      const d = K_.drag;
      if (!d) { K_.sp = K_.tool === "select" ? null : target(x, y, e); K_.hover = K_.tool === "select" ? hit(x, y) : null; placeHud(); app.canvas().style.cursor = K_.tool !== "select" ? "crosshair" : K_.hover ? "move" : "default"; return true; }
      if (!d.moved && Math.hypot(x - d.mx, y - d.my) * S.view.scale < 3) return true;
      d.moved = true;
      K_.ents = JSON.parse(d.ents0);
      const ent = K_.ents[d.i];
      if (d.kind === "node") {
        // the corner goes to the snap (not onto its own ends)
        const sp = snapAt(x, y, e, q => ends(q).some(p => near(p[0], p[1], d.p[0], d.p[1])));
        moveNode(d.p[0], d.p[1], sp.p[0], sp.p[1]); K_.sp = { p: sp.p, sp };
      } else if (d.kind === "centre") {
        const sp = snapAt(x, y, e, (q, i) => i === d.i); ent.cx = sp.p[0]; ent.cy = sp.p[1]; K_.sp = { p: sp.p, sp };
      } else if (d.kind === "rim") {
        const sp = snapAt(x, y, e, (q, i) => i === d.i), r = Math.hypot(sp.p[0] - ent.cx, sp.p[1] - ent.cy); if (r > TOL) ent.r = R4(r); K_.sp = { p: sp.p, sp };
      } else if (d.kind === "bend") {
        const sp = snapAt(x, y, e, (q, i) => i === d.i), b = bulge3([ent.x1, ent.y1], [ent.x2, ent.y2], sp.p);
        if (Math.abs(b) < 0.02) { delete ent.b; ent.t = "L"; } else { ent.t = "A"; ent.b = b; }
        K_.sp = { p: sp.p, sp };
      } else {
        // the whole thing (and the rest of the selection) by a grid step; the ends it shares follow
        const g = S.grid || 0.5, dx = Math.round((x - d.mx) / g) * g, dy = Math.round((y - d.my) / g) * g, moving = K_.sel.includes(d.i) ? K_.sel : [d.i], src = JSON.parse(d.ents0), done = [];
        moving.forEach(i => { const q = src[i]; if (!q) return; if (q.t === "C") { K_.ents[i].cx = R4(q.cx + dx); K_.ents[i].cy = R4(q.cy + dy); return; } ends(q).forEach(p => { if (done.some(o => near(o[0], o[1], p[0], p[1]))) return; done.push(p); }); });
        // all at once from the picture before the drag, so a moved end is not caught again by the next move
        K_.ents.forEach((q, i) => { if (q.t === "C") return; const s = src[i]; if (done.some(o => near(o[0], o[1], s.x1, s.y1))) { q.x1 = R4(s.x1 + dx); q.y1 = R4(s.y1 + dy); } if (done.some(o => near(o[0], o[1], s.x2, s.y2))) { q.x2 = R4(s.x2 + dx); q.y2 = R4(s.y2 + dy); } });
        K_.sp = null;
      }
      check(); props();
      return true;
    }
    function onUp() {
      if (!K_ || !K_.drag) return false;
      const d = K_.drag; K_.drag = null; K_.sp = null;
      if (d.moved) {
        // ends dropped onto each other leave nothing between them
        K_.ents = K_.ents.filter(e => e.t === "C" || !near(e.x1, e.y1, e.x2, e.y2));
        K_.sel = K_.sel.filter(i => i < K_.ents.length);
        push();
      }
      return true;
    }
    function dbl(x, y) {
      if (!K_) return false;
      if (K_.tool === "line") { K_.a = null; K_.hud = {}; buildHud(); render(); return true; }
      if (K_.tool !== "select") return true;
      const h = hit(x, y);
      if (h && h.kind === "body" && K_.ents[h.i].t === "L") {
        // a new corner on the line, where it was double-clicked
        const e = K_.ents[h.i], dx = e.x2 - e.x1, dy = e.y2 - e.y1, t = Math.max(0.05, Math.min(0.95, ((x - e.x1) * dx + (y - e.y1) * dy) / (dx * dx + dy * dy))), g = S.grid || 0.5;
        let p = [e.x1 + t * dx, e.y1 + t * dy];
        const sn = [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g]; if (distTo(e, sn[0], sn[1]) < 1e-6) p = sn;
        const rest = lineE(p[0], p[1], e.x2, e.y2); e.x2 = R4(p[0]); e.y2 = R4(p[1]); delete e.src; add(rest); K_.sel = []; push();
        msg("Line split: drag the new corner");
      }
      return true;
    }
    function del() {
      if (!K_.sel.length) return;
      K_.ents = K_.ents.filter((e, i) => !K_.sel.includes(i)); K_.sel = []; push();
    }
    function onKey(e, L) {
      if (!K_) return false;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === " ") return false;                                      // Space still pans
      if (ctrl && L === "z") { e.preventDefault(); step(e.shiftKey ? 1 : -1); return true; }
      if (ctrl && L === "y") { e.preventDefault(); step(1); return true; }
      if (ctrl) return true;
      if (hudKey(e)) return true;
      if (e.key === "Escape") {
        if (K_.drag) { revert(); K_.drag = null; check(); }
        else if (K_.a || K_.b) { K_.a = K_.b = null; K_.hud = {}; buildHud(); }
        else if (K_.tool !== "select") setTool("select");
        else if (K_.sel.length) { K_.sel = []; props(); }
        render(); return true;
      }
      if (e.key === "Enter") { e.preventDefault(); enter(); return true; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); del(); return true; }
      const t = TOOLS.find(q => q[2].toLowerCase() === L && !e.shiftKey && !e.altKey);
      if (t) { setTool(t[0]); return true; }
      return true;   // nothing else of the board answers while the sketch is open
    }

    // ---------------------------------------------------------------------------
    // Drawing (world coordinates, px: one screen pixel in mm)
    // ---------------------------------------------------------------------------
    function path(c, e) {
      if (e.t === "C") { c.moveTo(e.cx + e.r, e.cy); c.arc(e.cx, e.cy, e.r, 0, 2 * Math.PI); return; }
      c.moveTo(e.x1, e.y1);
      if (e.t === "A") { const g = arcG(e); c.arc(g.cx, g.cy, g.r, g.a0, g.a0 + g.sw, g.sw < 0); } else c.lineTo(e.x2, e.y2);
    }
    function label(c, px, x, y, text, color) {
      c.font = `${11 * px}px ui-monospace, Menlo, monospace`; const w = c.measureText(text).width;
      c.fillStyle = "rgba(10,15,22,.85)"; c.fillRect(x - w / 2 - 3 * px, y - 8 * px, w + 6 * px, 15 * px);
      c.fillStyle = color || COLOR; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(text, x, y); c.textAlign = "start"; c.textBaseline = "alphabetic";
    }
    function draw(c, px) {
      if (!K_) return;
      const o = S.board.outline;
      // the board as it is goes dim under the sketch
      c.save(); c.fillStyle = "rgba(7,11,16,.55)"; c.fillRect(-1e4, -1e4, 2e4, 2e4); c.restore();
      c.lineCap = "round"; c.lineJoin = "round";
      // what it will be: the closed shape filled faintly
      if (K_.res && !K_.res.error) {
        c.save(); c.translate(-K_.res.dx, -K_.res.dy); c.beginPath(); OL.trace({ w: K_.res.w, h: K_.res.h, shape: K_.res.shape }, c); c.fillStyle = "rgba(255,213,79,.10)"; c.fill("evenodd"); c.restore();
      }
      c.setLineDash([4 * px, 4 * px]); c.strokeStyle = "rgba(255,255,255,.25)"; c.lineWidth = px; c.beginPath(); OL.trace(o, c); c.stroke(); c.setLineDash([]);
      K_.ents.forEach((e, i) => {
        const sel = K_.sel.includes(i), hov = K_.hover && K_.hover.i === i && !K_.drag;
        c.beginPath(); path(c, e); c.strokeStyle = sel ? SEL : COLOR; c.lineWidth = (sel || hov ? 3 : 2) * px; c.stroke();
      });
      // ends: joined ones square, loose ones red
      const count = (x, y) => K_.ents.reduce((n, e) => n + ends(e).filter(q => near(q[0], q[1], x, y)).length, 0);
      K_.ents.forEach((e, i) => {
        ends(e).forEach(q => { const n = count(q[0], q[1]), s = 3 * px; c.fillStyle = n === 2 ? COLOR : BAD; if (n === 2) c.fillRect(q[0] - s, q[1] - s, 2 * s, 2 * s); else { c.beginPath(); c.arc(q[0], q[1], 4.5 * px, 0, 2 * Math.PI); c.fill(); } });
        if (e.t === "C") { c.strokeStyle = COLOR; c.lineWidth = px; c.beginPath(); c.moveTo(e.cx - 4 * px, e.cy); c.lineTo(e.cx + 4 * px, e.cy); c.moveTo(e.cx, e.cy - 4 * px); c.lineTo(e.cx, e.cy + 4 * px); c.stroke(); }
        if (e.t === "A") { const m = midOf(e), s = 3.5 * px; c.fillStyle = K_.sel.includes(i) ? SEL : COLOR; c.beginPath(); c.moveTo(m[0], m[1] - s); c.lineTo(m[0] + s, m[1]); c.lineTo(m[0], m[1] + s); c.lineTo(m[0] - s, m[1]); c.closePath(); c.fill(); }
      });
      // the one selected: its size beside it
      if (K_.sel.length === 1 && K_.ents[K_.sel[0]]) {
        const e = K_.ents[K_.sel[0]], m = midOf(e);
        label(c, px, m[0], m[1] - 14 * px, e.t === "C" ? `Ø${fmt(2 * e.r)}` : e.t === "A" ? `R${fmt(arcG(e).r)}` : `${fmt(Math.hypot(e.x2 - e.x1, e.y2 - e.y1))} mm`, SEL);
      }
      // where the check failed
      if (K_.res && K_.res.error) (K_.res.at || []).forEach(p => { c.strokeStyle = BAD; c.lineWidth = 2 * px; c.beginPath(); c.arc(p[0], p[1], 8 * px, 0, 2 * Math.PI); c.stroke(); });
      // the tool: what the next click makes, with its sizes, and the point it sticks to
      const tg = K_.sp;
      if (K_.tool !== "select" && tg) {
        const p = tg.p, pv = make(p);
        c.setLineDash([5 * px, 4 * px]); c.strokeStyle = GHOST; c.lineWidth = 1.5 * px;
        pv.forEach(e => { c.beginPath(); path(c, e); c.stroke(); });
        c.setLineDash([]);
        const a = K_.a;
        if (a && pv.length) {
          const t = K_.tool, e0 = pv[0];
          if (t === "line") { const len = Math.hypot(p[0] - a[0], p[1] - a[1]), ang = ((Math.atan2(-(p[1] - a[1]), p[0] - a[0]) / RAD) + 360) % 360; label(c, px, (a[0] + p[0]) / 2, (a[1] + p[1]) / 2 - 12 * px, `${fmt(len)} mm  ${fmt(+ang.toFixed(1))}°`, GHOST); }
          else if (t === "circle") label(c, px, a[0], a[1] - 12 * px, `Ø${fmt(2 * e0.r)}`, GHOST);
          else if (t === "rect") label(c, px, (pv[0].x1 + pv[1].x2) / 2, (pv[0].y1 + pv[1].y2) / 2, `${fmt(Math.abs(pv[0].x2 - pv[0].x1))} × ${fmt(Math.abs(pv[1].y2 - pv[1].y1))} mm`, GHOST);
          else if (t === "poly") label(c, px, a[0], a[1], `${sidesN()} sides  R${fmt(Math.hypot(pv[0].x1 - a[0], pv[0].y1 - a[1]))}`, GHOST);
          else if (t === "slot") label(c, px, (a[0] + p[0]) / 2, (a[1] + p[1]) / 2, `${fmt(slotW())} × ${fmt(Math.hypot(pv[0].x2 - pv[0].x1, pv[0].y2 - pv[0].y1) + slotW())} mm`, GHOST);
          else if (t === "arc" && e0.t === "A") label(c, px, p[0], p[1] - 14 * px, `R${fmt(arcG(e0).r)}`, GHOST);
        }
        const s = 5 * px, own = tg.sp && (tg.sp.own || tg.sp.shape !== "grid");
        c.strokeStyle = own ? "#7CFC9A" : GHOST; c.lineWidth = 1.5 * px; c.beginPath();
        if (own) c.rect(p[0] - s, p[1] - s, 2 * s, 2 * s); else { c.moveTo(p[0] - s, p[1]); c.lineTo(p[0] + s, p[1]); c.moveTo(p[0], p[1] - s); c.lineTo(p[0], p[1] + s); }
        c.stroke();
        label(c, px, p[0], p[1] + 16 * px, `${fmt(p[0])}, ${fmt(uy(p[1]))}${tg.sp && tg.sp.what && tg.sp.what !== "grid" ? "  " + tg.sp.what : ""}`, "#9aa7b4");
      } else if (K_.drag && K_.sp) {
        const p = K_.sp.p; label(c, px, p[0], p[1] + 16 * px, `${fmt(p[0])}, ${fmt(uy(p[1]))}${K_.sp.sp && K_.sp.sp.what && K_.sp.sp.what !== "grid" ? "  " + K_.sp.sp.what : ""}`, "#9aa7b4");
      }
    }

    return { HELP, TOOLS, init, open, finish, cancel, active, undo: () => step(-1), redo: () => step(1), setTool, onDown, onMove, onUp, onKey, dbl, draw, state: () => K_, bulge3, bulgeR };
  };
})(typeof window !== "undefined" ? window : globalThis);
