/* Driving dimensions and geometric constraints of the Board (the 2D sketcher way): a dimension
   between two features of the board (a part's origin or one of its pads, a mounting hole, a via, a
   text, a keep-out corner or edge, a board corner or edge, a construction point or line) holds them
   that far apart, and moving one moves what is tied to it. Pure geometry, no DOM: board-dimui.js
   draws it and runs the tool.

   board.dims = { items: [dim], hide }   dim = { id, k, a, b, v?, ref?, o? }
     k: "dx" | "dy" (horizontal / vertical distance, signed: b minus a, user frame Y up),
        "dist" (aligned distance), "pl" (point a to line b, signed: left of the line > 0),
        "hz" (same Y: aligned horizontally), "vt" (same X: aligned vertically)
     a, b: features. Points: { t: "part", key } | { t: "pad", part, num } | { t: "hole", id } |
       { t: "via", id } | { t: "text", id } | { t: "ko", id, k } | { t: "board", at } | { t: "origin" } |
       { t: "cp", ref } (a construction point: a board-construct.js ref).
       Lines: { t: "edge", k } (board edge 0–3: bottom, right, top, left) | { t: "koe", id, k } (keep-out
       edge from corner k) | { t: "cl", g } (a construction line, a board-construct.js curve ref).
     ref: a reference (driven) dimension: it reads the distance and holds nothing.
     o: where its line is drawn, mm off the features (the label's offset).

   Every body (part, hole, via, text, keep-out) only slides: its unknowns are tx, ty from where it is.
   The dimensions are equations F(t) = 0, solved by Newton steps of least change (the SolveSpace way):
   each step is the smallest weighted move that meets the linearised equations, so what was not asked
   to move stays put, and a body the user just moved (pinned: a heavy weight) stays where it was put.
   Board coordinates (y down) inside; values in the user frame (Y up from the bottom-left corner). */
(function (root) {
  "use strict";
  const R4 = v => Math.round(v * 1e4) / 1e4;
  const KINDS = ["dx", "dy", "dist", "pl", "hz", "vt", "rad", "dia"];
  const NAMES = { dx: "Horizontal dimension", dy: "Vertical dimension", dist: "Aligned dimension", pl: "Distance to a line", hz: "Aligned horizontally", vt: "Aligned vertically", rad: "Radius", dia: "Diameter" };
  const HAS_VALUE = { dx: true, dy: true, dist: true, pl: true, hz: false, vt: false, rad: true, dia: true };
  const LINE_T = new Set(["edge", "koe", "cl", "oe"]);
  const EDGE_NAMES = ["bottom edge", "right edge", "top edge", "left edge"];
  const BOARD_AT = { BL: "bottom-left corner", BR: "bottom-right corner", TL: "top-left corner", TR: "top-right corner", C: "centre", B: "bottom edge middle", R: "right edge middle", T: "top edge middle", L: "left edge middle" };
  const TOL = 1e-6;   // mm: an equation counts as met

  function normalise(board) {
    const d = board.dims && typeof board.dims === "object" ? board.dims : {};
    const items = Array.isArray(d.items) ? d.items.filter(it => it && KINDS.includes(it.k) && it.a && it.b) : [];
    board.dims = { items, hide: !!d.hide };
    const seen = new Set();
    items.forEach(it => { if (!it.id || seen.has(it.id)) { let n = 1; while (seen.has("d" + n) || items.some(q => q !== it && q.id === "d" + n)) n++; it.id = "d" + n; } seen.add(it.id); });
    (board.texts || []).forEach((t, i, arr) => { if (t && t.id && arr.findIndex(q => q && q.id === t.id) !== i) delete t.id; });
    return board.dims;
  }
  function newId(board) { const used = new Set(normalise(board).items.map(it => it.id)); let n = 1; while (used.has("d" + n)) n++; return "d" + n; }
  /** an id for a text (texts had none before) */
  function textId(board, t) {
    if (t.id) return t.id;
    const used = new Set((board.texts || []).map(q => q && q.id).filter(Boolean)); let n = 1; while (used.has("t" + n)) n++;
    t.id = "t" + n; return t.id;
  }
  const isLine = f => !!f && LINE_T.has(f.t);

  // ---------------------------------------------------------------------------
  // The board outline as something the dimensions move: its corners slide (bodies "ov:K"), every
  // line keeps its direction and every arc its angle (see implicit), so a dimension changes lengths
  // and places, never the kind of shape. K counts the outline's segments in order, as the
  // construction's "@outline" curves do; corner K is where segment K starts. A plain rectangle has
  // four: bottom-left, bottom-right, top-right, top-left (its edges 0–3: bottom, right, top, left).
  // ---------------------------------------------------------------------------
  const OLB = () => root.BoardOutline;
  const isOv = k => typeof k === "string" && k.startsWith("ov:");
  const RECT_AT = { BL: [0], BR: [1], TR: [2], TL: [3], B: [0, 1], R: [1, 2], T: [2, 3], L: [3, 0], C: [0, 1, 2, 3] };
  /** the corners: [{ x, y, b (bulge of the segment that starts here), n (the next corner), loop, i }] */
  function overts(board) {
    const o = board.outline || {}, OL = OLB();
    if (o.shape && OL) {
      const out = OL.segs(o).map(s => ({ x: s.x1, y: s.y1, b: s.t === "A" ? +o.shape[s.loop][s.i][2] || 0 : 0, loop: s.loop, i: s.i }));
      out.forEach((v, k) => { v.n = k + 1 < out.length && out[k + 1].loop === v.loop ? k + 1 : out.findIndex(q => q.loop === v.loop); });
      // a whole circle: a loop of two half turns
      out.forEach(v => { v.full = Math.abs(Math.abs(v.b) - 1) < 1e-9 && out.filter(q => q.loop === v.loop).length === 2 && Math.abs(Math.abs(out[v.n].b) - 1) < 1e-9; });
      return out;
    }
    const w = +o.w || 0, h = +o.h || 0;
    return [[0, h], [w, h], [w, 0], [0, 0]].map((p, k) => ({ x: p[0], y: p[1], b: 0, n: (k + 1) % 4, loop: 0, i: k }));
  }
  /** the outline corners a feature stands on (indexes), [] when none */
  function ovOf(board, f, ov) {
    if (!f) return [];
    ov = ov || overts(board);
    if (f.t === "ov") return ov[f.k] ? [f.k] : [];
    if (f.t === "oe" || f.t === "oc") return ov[f.k] ? [f.k, ov[f.k].n] : [];
    if (board.outline && board.outline.shape) return [];
    if (f.t === "edge") return ov[f.k] ? [f.k, ov[f.k].n] : [];
    if (f.t === "board") return RECT_AT[f.at] || [];
    return [];
  }
  /** every body a feature moves with (a part, a hole…, or the outline's corners) */
  function featKeys(board, f, ov) {
    const k = bodyOf(board, f); if (k && !isOv(k)) return [k];
    return ovOf(board, f, ov).map(i => "ov:" + i);
  }
  /** what should move for a dimension whose second pick is `second`: a part, hole… before the outline */
  function movers(board, dim, second) {
    const first = second === dim.a ? dim.b : dim.a, plain = f => { const k = bodyOf(board, f); return k && !isOv(k) ? k : null; };
    const k = plain(second) || plain(first);
    if (k) return new Set([k]);
    const a = featKeys(board, second), out = new Set(a.length ? a : featKeys(board, first));
    // the other end of the dimension is what the moving one is measured from: it stands still if it can
    out.anchor = new Set(featKeys(board, a.length ? first : second).filter(q => !out.has(q)));
    return out;
  }
  /** the outline with its corners moved (moves: Map "ov:K" → [dx, dy], board frame) → { o, dx, dy }: the
      new outline with its box at 0, 0 and how far everything on the board goes with it; null: no change;
      { error }: the corners would no longer make an outline */
  function movedOutline(board, moves) {
    const o = board.outline, ov = overts(board), OL = OLB();
    const t = k => moves.get("ov:" + k) || [0, 0];
    if (![...moves].some(([k, v]) => isOv(k) && Math.hypot(v[0], v[1]) > 5e-5)) return null;
    if (!o.shape) {
      const P = ov.map((v, k) => [v.x + t(k)[0], v.y + t(k)[1]]), xs = P.map(p => p[0]), ys = P.map(p => p[1]);
      const x1 = Math.min(...xs), y1 = Math.min(...ys), w = R4(Math.max(...xs) - x1), h = R4(Math.max(...ys) - y1);
      if (!(w >= 1 && h >= 1)) return { error: "the board would have no size" };
      return { o: { ...o, w, h }, dx: R4(-x1) + 0, dy: R4(-y1) + 0 };
    }
    const loops = o.shape.map(l => l.map(p => p.slice()));
    ov.forEach((v, k) => { const q = loops[v.loop][v.i]; q[0] += t(k)[0]; q[1] += t(k)[1]; });
    const n = OL.normalise(loops);
    if (!(n.w >= 1 && n.h >= 1)) return { error: "the board would have no size" };
    // still an outline: nothing crossing, every cut-out inside, no edge shrunk away
    const chk = OL.fromEntities(OL.toEntities({ w: n.w, h: n.h, shape: n.shape }));
    if (chk.error) return { error: chk.error };
    if (OL.segs({ w: n.w, h: n.h, shape: n.shape }).length !== ov.length) return { error: "an edge would shrink to nothing" };
    return { o: { ...o, shape: n.shape.map(l => l.map(p => (p[2] ? [R4(p[0]), R4(p[1]), p[2]] : [R4(p[0]), R4(p[1])]))), w: n.w, h: n.h }, dx: n.dx + 0, dy: n.dy + 0 };
  }
  /** a sketch gave the outline other segments: map { old K: new K } renumbers the dimensions on them
      (null: none of them is left); → how many dimensions went with their corner or edge */
  function remapOutline(board, map) {
    const d = normalise(board), keep = [];
    d.items.forEach(it => {
      let ok = true;
      [it.a, it.b].forEach(f => { if (!f || !["ov", "oe", "oc"].includes(f.t)) return; const k = map ? map[f.k] : undefined; if (k === undefined || k < 0) ok = false; else f.k = k; });
      if (ok) keep.push(it);
    });
    const gone = d.items.length - keep.length; d.items = keep; return gone;
  }

  // ---------------------------------------------------------------------------
  // Bodies: what slides when a feature moves
  // ---------------------------------------------------------------------------
  /** the body a feature belongs to ("part:K", "hole:h1", …), or null when it cannot move */
  function bodyOf(board, f) {
    if (!f) return null;
    const find = (l, id) => (board[l] || []).find(o => o && o.id === id);
    switch (f.t) {
      case "part": case "pad": { const k = f.t === "part" ? f.key : f.part, p = board.parts && board.parts[k]; return p && !p.locked ? "part:" + k : null; }
      case "hole": { const h = find("holes", f.id); return h && !h.locked && !h.at ? "hole:" + f.id : null; }
      case "via": { const v = find("vias", f.id); return v && !v.locked ? "via:" + f.id : null; }
      case "text": { const t = find("texts", f.id); return t && !t.locked ? "text:" + f.id : null; }
      case "ko": case "koe": { const k = find("keepouts", f.id); return k && !k.locked ? "ko:" + f.id : null; }
      case "ov": case "oe": case "oc": case "edge": case "board": { const a = ovOf(board, f); return a.length ? "ov:" + a[0] : null; }
      default: return null;
    }
  }
  /** the object of a body key */
  function objOfBody(board, key) {
    const i = key.indexOf(":"), t = key.slice(0, i), id = key.slice(i + 1);
    if (t === "part") return board.parts && board.parts[id];
    const l = { hole: "holes", via: "vias", text: "texts", ko: "keepouts" }[t];
    return (board[l] || []).find(o => o && o.id === id) || null;
  }
  /** where a body is now (board frame): its x, y, or a keep-out's first corner */
  function bodyPos(board, key) { if (isOv(key)) { const v = overts(board)[+key.slice(3)]; return v ? [v.x, v.y] : null; } const o = objOfBody(board, key); if (!o) return null; return o.pts ? [o.pts[0][0], o.pts[0][1]] : [o.x, o.y]; }
  /** a body slid by dx, dy (board frame) */
  function moveBody(board, key, dx, dy) {
    if (isOv(key)) return;   // the outline moves as a whole: movedOutline
    const o = objOfBody(board, key); if (!o) return;
    if (o.pts) o.pts = o.pts.map(p => [R4(p[0] + dx), R4(p[1] + dy)]);
    else { o.x = R4(o.x + dx); o.y = R4(o.y + dy); }
  }

  // ---------------------------------------------------------------------------
  // Features: where they are (board frame) for given body offsets
  // ---------------------------------------------------------------------------
  /** env: { board, model, csol } → the features' base points and lines, and their bodies */
  function makeEnv(board, model, csol) {
    const H = board.outline.h, o = board.outline;
    // look-ups made once: objects by id, each feature's body
    const byId = {}; ["holes", "vias", "texts", "keepouts"].forEach(l => { byId[l] = new Map(); (board[l] || []).forEach(q => { if (q && q.id && !byId[l].has(q.id)) byId[l].set(q.id, q); }); });
    const find = (l, id) => byId[l].get(id);
    const bodies = new WeakMap(), body = f => { if (!f) return null; if (!bodies.has(f)) bodies.set(f, bodyOf(board, f)); return bodies.get(f); };
    // the outline's corners, each with the slide of its body
    const ov = overts(board), rect = !o.shape;
    const vp = (k, T) => { const v = ov[k]; if (!v) return null; const t = (T && T.get("ov:" + k)) || [0, 0]; return [v.x + t[0], v.y + t[1]]; };
    const mean = (ks, T) => { const P = ks.map(k => vp(k, T)); return P.length && P.every(Boolean) ? [P.reduce((s, p) => s + p[0], 0) / P.length, P.reduce((s, p) => s + p[1], 0) / P.length] : null; };
    // an arc's centre lies s chords to the side of its chord's middle (s from its bulge alone)
    const arcS = k => { const b = ov[k] ? ov[k].b : 0; return b ? (1 - b * b) / (4 * b) : null; };
    /** the arc that starts at corner k: { a, b (its ends), c (centre), r, f (radius per chord length), full } */
    function arc(f, T) {
      if (!f || (f.t !== "oe" && f.t !== "oc")) return null;
      const v = ov[f.k], s = arcS(f.k); if (!v || s === null) return null;
      const a = vp(f.k, T), b = vp(v.n, T), ux = b[0] - a[0], uy = b[1] - a[1], fr = (1 + v.b * v.b) / (4 * Math.abs(v.b));
      return { a, b, c: [(a[0] + b[0]) / 2 - uy * s, (a[1] + b[1]) / 2 + ux * s], r: Math.hypot(ux, uy) * fr, f: fr, full: !!v.full, sw: 4 * Math.atan(v.b) };
    }
    /** how a feature's point follows its bodies: [[body, ∂x/∂tx, ∂x/∂ty, ∂y/∂tx, ∂y/∂ty], …] */
    const jacs = new WeakMap();
    function jac(f) {
      if (!f) return [];
      if (jacs.has(f)) return jacs.get(f);
      let out;
      const ks = ovOf(board, f, ov);
      if (f.t === "oc" && ks.length) { const s = arcS(f.k) || 0; out = [["ov:" + ks[0], 0.5, s, -s, 0.5], ["ov:" + ks[1], 0.5, -s, s, 0.5]]; }
      else if (f.t === "board" && ks.length) out = ks.map(k => ["ov:" + k, 1 / ks.length, 0, 0, 1 / ks.length]);
      else if (ks.length) out = [["ov:" + ks[0], 1, 0, 0, 1]];   // a line goes with its first corner: it keeps its direction
      else { const k = body(f); out = k ? [[k, 1, 0, 0, 1]] : []; }
      jacs.set(f, out); return out;
    }
    const fromU = p => (p ? [p[0], H - p[1]] : null);
    // each pad's place on its part, from the model built for the board as it is now (a part only slides)
    const padOff = new Map();
    if (model) model.pads.forEach(pd => { const bp = board.parts && board.parts[pd.part]; if (bp) padOff.set(pd.part + "|" + pd.num, [pd.x - bp.x, pd.y - bp.y]); });
    // a point feature: [x, y] with the body's slide added; null when it is gone
    function point(f, T) {
      if (!f) return null;
      const bk = body(f), t = (bk && T && T.get(bk)) || [0, 0];
      let p = null;
      switch (f.t) {
        case "origin": return [0, H];
        case "ov": return vp(f.k, T);
        case "oc": { const a = arc(f, T); return a ? a.c : null; }
        case "board": {
          if (rect) return mean(RECT_AT[f.at] || [], T);
          const P = { BL: [0, H], BR: [o.w, H], TL: [0, 0], TR: [o.w, 0], C: [o.w / 2, H / 2], B: [o.w / 2, H], T: [o.w / 2, 0], L: [0, H / 2], R: [o.w, H / 2] };
          return P[f.at] || null;
        }
        case "part": { const bp = board.parts && board.parts[f.key]; p = bp ? [bp.x, bp.y] : null; break; }
        case "pad": {
          const bp = board.parts && board.parts[f.part], off = padOff.get(f.part + "|" + f.num);
          p = bp && off ? [bp.x + off[0], bp.y + off[1]] : null; break;
        }
        case "hole": { const h = find("holes", f.id); p = h ? [h.x, h.y] : null; break; }
        case "via": { const v = find("vias", f.id); p = v ? [v.x, v.y] : null; break; }
        case "text": { const x = find("texts", f.id); p = x ? [x.x, x.y] : null; break; }
        case "ko": { const k = find("keepouts", f.id), q = k && k.pts[f.k || 0]; p = q ? [q[0], q[1]] : null; break; }
        case "cp": return csol ? fromU(csol.refPt(f.ref)) : null;
        default: return null;
      }
      return p ? [p[0] + t[0], p[1] + t[1]] : null;
    }
    // a line feature: [x1, y1, x2, y2]
    function line(f, T) {
      if (!f) return null;
      if (f.t === "oe" || (f.t === "edge" && rect)) { const v = ov[f.k]; if (!v || v.b) return null; const a = vp(f.k, T), b = vp(v.n, T); return [a[0], a[1], b[0], b[1]]; }
      if (f.t === "edge") return [[0, H, o.w, H], [o.w, H, o.w, 0], [o.w, 0, 0, 0], [0, 0, 0, H]][f.k] || null;
      if (f.t === "koe") {
        const k = find("keepouts", f.id); if (!k || !k.pts.length) return null;
        const bk = body(f), t = (bk && T && T.get(bk)) || [0, 0], a = k.pts[(f.k || 0) % k.pts.length], b = k.pts[((f.k || 0) + 1) % k.pts.length];
        return [a[0] + t[0], a[1] + t[1], b[0] + t[0], b[1] + t[1]];
      }
      if (f.t === "cl") { const c = csol && csol.curve(f.g); return c && c.t === "L" ? [c.x1, H - c.y1, c.x2, H - c.y2] : null; }
      return null;
    }
    return { board, model, csol, point, line, H, body, arc, jac, ov, vp };
  }

  // the residual of a dimension (board frame inside, values in the user frame); null when a feature is gone
  function residual(env, d, T) {
    if (d.k === "par") {   // a segment of the outline keeps its direction (c: its chord as it was, a unit vector)
      const a = env.vp(d.i, T), b = env.vp(d.j, T); if (!a || !b) return null;
      return d.c[0] * (b[1] - a[1]) - d.c[1] * (b[0] - a[0]);
    }
    if (d.k === "len") {   // an arc of the outline keeps its size (c: its chord's length as it was)
      const a = env.vp(d.i, T), b = env.vp(d.j, T); if (!a || !b) return null;
      return Math.hypot(b[0] - a[0], b[1] - a[1]) - d.c;
    }
    if (d.k === "rad" || d.k === "dia") {
      const a = env.arc(d.a, T); if (!a) return null;
      return a.r * (d.k === "dia" ? 2 : 1) - Math.abs(+d.v || 0);
    }
    if (d.k === "pl") {
      const p = env.point(d.a, T), l = env.line(d.b, T); if (!p || !l) return null;
      return signedDist(p, l) - (+d.v || 0);
    }
    const a = env.point(d.a, T), b = env.point(d.b, T); if (!a || !b) return null;
    switch (d.k) {
      case "dx": return (b[0] - a[0]) - (+d.v || 0);
      case "dy": return -(b[1] - a[1]) - (+d.v || 0);
      case "dist": return Math.hypot(b[0] - a[0], b[1] - a[1]) - Math.abs(+d.v || 0);
      case "hz": return b[1] - a[1];
      case "vt": return b[0] - a[0];
      default: return null;
    }
  }
  // left of the line (as drawn, in the user frame) > 0; the board frame's y is flipped, so the sign is too
  function signedDist(p, l) {
    const dx = l[2] - l[0], dy = l[3] - l[1], len = Math.hypot(dx, dy); if (len < 1e-12) return Math.hypot(p[0] - l[0], p[1] - l[1]);
    return -((dx * (p[1] - l[1]) - dy * (p[0] - l[0])) / len);
  }
  // the gradient of a residual by the slides of its bodies: [[body, ∂/∂tx, ∂/∂ty], …] (a body twice adds up)
  function grad(env, d, T) {
    const ka = d.a, kb = d.b, out = [];
    // the feature's point moves with its bodies: the chain rule through its Jacobian
    const put = (f, gx, gy) => { env.jac(f).forEach(([k, xx, xy, yx, yy]) => out.push([k, gx * xx + gy * yx, gx * xy + gy * yy])); };
    switch (d.k) {
      case "par": out.push(["ov:" + d.j, -d.c[1], d.c[0]], ["ov:" + d.i, d.c[1], -d.c[0]]); break;
      case "len": {
        const a = env.vp(d.i, T), b = env.vp(d.j, T), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        out.push(["ov:" + d.j, ux, uy], ["ov:" + d.i, -ux, -uy]); break;
      }
      case "rad": case "dia": {
        const a = env.arc(d.a, T); if (!a) break;
        const L = Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]) || 1, m = a.f * (d.k === "dia" ? 2 : 1), ux = (a.b[0] - a.a[0]) / L * m, uy = (a.b[1] - a.a[1]) / L * m;
        out.push(["ov:" + env.ov[d.a.k].n, ux, uy], ["ov:" + d.a.k, -ux, -uy]); break;
      }
      case "dx": put(kb, 1, 0); put(ka, -1, 0); break;
      case "dy": put(kb, 0, -1); put(ka, 0, 1); break;
      case "hz": put(kb, 0, 1); put(ka, 0, -1); break;
      case "vt": put(kb, 1, 0); put(ka, -1, 0); break;
      case "dist": {
        const a = env.point(d.a, T), b = env.point(d.b, T); if (!a || !b) break;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = L > 1e-9 ? (b[0] - a[0]) / L : 1, uy = L > 1e-9 ? (b[1] - a[1]) / L : 0;
        put(kb, ux, uy); put(ka, -ux, -uy); break;
      }
      case "pl": {
        const l = env.line(d.b, T); if (!l) break;
        const dx = l[2] - l[0], dy = l[3] - l[1], len = Math.hypot(dx, dy); if (len < 1e-12) break;
        put(ka, dy / len, -dx / len); put(kb, -dy / len, dx / len); break;
      }
    }
    return out;
  }
  /** what a dimension reads now (user frame): its value as it would be made driving */
  function measure(env, d) {
    const z = { ...d, v: 0 }, r = residual(env, z, null);
    return r === null ? null : R4(r);
  }
  const bodiesOf = (board, d) => (d.k === "par" || d.k === "len" ? ["ov:" + d.i, "ov:" + d.j] : [...new Set(featKeys(board, d.a).concat(featKeys(board, d.b)))]);
  /** the equations the outline brings itself: each segment of a loop some corner of which may move
      keeps its direction (a line stays level, upright or at its angle; an arc of a fixed angle keeps its
      chord's, so it only grows, shrinks and moves and stays tangent to what it rounds) */
  function implicit(env, keys, arcs) {
    const loops = new Set(); keys.forEach(k => { if (isOv(k) && env.ov[+k.slice(3)]) loops.add(env.ov[+k.slice(3)].loop); });
    const rows = [];
    env.ov.forEach((v, i) => {
      if (!loops.has(v.loop)) return;
      const q = env.ov[v.n], L = Math.hypot(q.x - v.x, q.y - v.y); if (L < 1e-9) return;
      rows.push({ id: "~par" + i, k: "par", i, j: v.n, c: [(q.x - v.x) / L, (q.y - v.y) / L] });
      // arcs: a fillet or a round cut-out keeps its radius, unless a radius or diameter dimension drives it
      if (arcs && v.b && !arcs.has(i)) rows.push({ id: "~len" + i, k: "len", i, j: v.n, c: L });
    });
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Linear algebra (small, dense)
  // ---------------------------------------------------------------------------
  // A x = b by elimination with partial pivoting; rows with no pivot (dependent equations) get x = 0
  function solveSym(A, b) {
    const n = b.length, M = A.map((r, i) => { const x = new Float64Array(n + 1); x.set(r); x[n] = b[i]; return x; });
    let scale = 1e-30; for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i][i]));
    const col = []; let row = 0;
    // forward elimination with partial pivoting; a column with no pivot (a dependent equation) is skipped
    for (let c = 0; c < n && row < n; c++) {
      let best = row; for (let r = row + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[best][c])) best = r;
      if (Math.abs(M[best][c]) < 1e-11 * scale) continue;
      const t = M[row]; M[row] = M[best]; M[best] = t;
      const P = M[row], pc = P[c];
      for (let r = row + 1; r < n; r++) { const Rr = M[r], f = Rr[c] / pc; if (f) for (let k = c; k <= n; k++) Rr[k] -= f * P[k]; }
      col[row] = c; row++;
    }
    const x = new Float64Array(n);
    for (let r = row - 1; r >= 0; r--) { const P = M[r], c = col[r]; let s = P[n]; for (let k = c + 1; k < n; k++) s -= P[k] * x[k]; x[c] = s / P[c]; }
    return x;
  }
  // an orthonormal basis of the rows (Gram–Schmidt); its length is the rank
  function rowBasis(J) {
    const B = [];
    J.forEach(r => {
      const v = r.slice(); B.forEach(b => { let d = 0; for (let i = 0; i < v.length; i++) d += v[i] * b[i]; for (let i = 0; i < v.length; i++) v[i] -= d * b[i]; });
      const n = Math.hypot(...v); if (n > 1e-9) B.push(v.map(x => x / n));
    });
    return B;
  }

  // ---------------------------------------------------------------------------
  // The solver
  // ---------------------------------------------------------------------------
  /** solve the driving dimensions.
      opts: { csol, pinned: Set of body keys (the user just moved them), prefer: Set (move these first),
              only: dims to solve (default: every driving one), iterations }
      → { ok, T: Map body → [dx, dy] (board frame), bad: [dim ids], lost: [dim ids], err (mm), vars, J, rows } */
  function solve(board, model, opts) {
    opts = opts || {};
    // what the user just moved stays exactly where it was put: held still, not merely heavy
    const pinned = opts.pinned || new Set(), prefer = opts.prefer || new Set();
    if (pinned.size && !opts.held) {
      const r = solve(board, model, { ...opts, held: pinned, pinned: new Set() });
      if (r.ok) return r;
      // it cannot stay exactly there: as near as it can (a heavy weight), so it slides along what is free
      return solveHeld(board, model, { ...opts, heavy: pinned }, new Set());
    }
    // a new dimension moves only what it was asked to move, when that is enough
    if (prefer.size && !opts.held) {
      normalise(board);
      const others = new Set(); board.dims.items.forEach(d => { if (!d.ref) bodiesOf(board, d).forEach(k => { if (!prefer.has(k)) others.add(k); }); });
      let r = solve(board, model, { ...opts, held: others });
      if (r.ok) return r;
      // an edge of the outline takes its neighbours along: only what it is measured from is held, first
      // with the parts and holes of the other dimensions too
      const anchor = prefer.anchor || new Set();
      if (anchor.size) {
        r = solve(board, model, { ...opts, held: new Set([...others].filter(k => !isOv(k) || anchor.has(k))) }); if (r.ok) return r;
        r = solve(board, model, { ...opts, held: anchor }); if (r.ok) return r;
      }
      return solve(board, model, { ...opts, held: new Set() });
    }
    return solveHeld(board, model, opts, opts.held || new Set());
  }
  function solveHeld(board, model, opts, held) {
    // arcs keep their size first; when the dimensions cannot be met so (a slot made wider), they may change
    const r = solveCore(board, model, opts, held, true);
    return r.ok || !r.arcRows ? r : solveCore(board, model, opts, held, false);
  }
  function solveCore(board, model, opts, held, arcsHeld) {
    normalise(board);
    const env = makeEnv(board, model, opts.csol);
    const dims = (opts.only || board.dims.items).filter(d => !d.ref);
    const lost = [], rows = [];
    dims.forEach(d => { if (residual(env, d, null) === null) lost.push(d.id); else rows.push(d); });
    const prefer = opts.prefer || new Set();
    // the outline stays as it is unless it was asked to move: a dimension set on it (prefer), or its
    // shape was just changed and its own dimensions pull it back (ovFree)
    const ovFree = !!opts.ovFree || [...prefer].some(isOv);
    // the unknowns: tx, ty of each body some dimension touches
    const keys = []; rows.forEach(d => bodiesOf(board, d).forEach(k => { if (!keys.includes(k) && !held.has(k) && (ovFree || !isOv(k))) keys.push(k); }));
    if (ovFree) {
      // a loop moves as a whole: all its corners are unknowns, each segment keeps its direction
      const loops = new Set(keys.filter(isOv).map(k => env.ov[+k.slice(3)].loop));
      env.ov.forEach((v, i) => { const k = "ov:" + i; if (loops.has(v.loop) && !keys.includes(k) && !held.has(k)) keys.push(k); });
      // an arc with a driving radius or diameter is that dimension's to size (a circle's two halves both)
      const sized = new Set(); rows.forEach(d => { if (d.k === "rad" || d.k === "dia") { const v = env.ov[d.a.k]; sized.add(d.a.k); if (v && v.full) sized.add(v.n); } });
      implicit(env, keys, arcsHeld ? sized : null).forEach(r => rows.push(r));
    }
    const arcRows = rows.some(d => d.k === "len");
    const n = keys.length * 2, idx = new Map(keys.map((k, i) => [k, i]));
    const heavy = opts.heavy || new Set();
    // what a move costs: a part or a hole by how far it goes; a corner of the outline by how far its two
    // edges go sideways (an edge that only gets longer or shorter costs next to nothing), so the edge a
    // dimension asks to move moves, and its neighbours stretch to it. Winv: the inverse, a 2 × 2 block a body
    const Winv = keys.map(k => {
      const v = heavy.has(k) ? 1e6 : prefer.size ? (prefer.has(k) ? 1 : isOv(k) ? 1e7 : 1e4) : isOv(k) ? 1e6 : 1;
      if (!isOv(k)) return [1 / v, 0, 0, 1 / v];
      const i = +k.slice(3), me = env.ov[i], nx = env.ov[me.n], pv = env.ov[env.ov.findIndex(q => q.n === i)] || me;
      let a = 1e-7, b = 0, d = 1e-7;
      [[me, nx], [pv, me]].forEach(([p, q]) => { const L = Math.hypot(q.x - p.x, q.y - p.y); if (L < 1e-9) return; const n0 = -(q.y - p.y) / L, n1 = (q.x - p.x) / L; a += n0 * n0 / 2; b += n0 * n1 / 2; d += n1 * n1 / 2; });
      const det = (a * d - b * b) * v;
      return [d / det, -b / det, -b / det, a / det];
    });
    const q = new Float64Array(n);
    const Tof = qq => new Map(keys.map((k, i) => [k, [qq[2 * i], qq[2 * i + 1]]]));
    const F = qq => { const T = Tof(qq); return rows.map(d => residual(env, d, T)); };
    // the Jacobian, sparse: each row a list of [column, value]
    const jac = qq => {
      const T = Tof(qq);
      return rows.map(d => {
        const r = [];
        grad(env, d, T).forEach(([k, gx, gy]) => {
          const i = idx.get(k); if (i === undefined) return;
          [[2 * i, gx], [2 * i + 1, gy]].forEach(([c, v]) => { if (!v) return; const e = r.find(x => x[0] === c); if (e) e[1] += v; else r.push([c, v]); });
        });
        return r;
      });
    };
    const norm = f => f.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    let f = F(q), err = norm(f), it = 0;
    const maxIt = opts.iterations || 60, m = rows.length;
    while (err > TOL && it++ < maxIt && m) {
      const J = jac(q);
      // the step of least weighted change: (J W⁻¹ Jᵀ) μ = F − J r, Δ = −r − W⁻¹ Jᵀ μ, r = q − q0 (q0 = 0)
      const byCol = Array.from({ length: n }, () => []);
      J.forEach((r, i) => r.forEach(([c, v]) => byCol[c].push([i, v])));
      const A = Array.from({ length: m }, () => new Float64Array(m));
      // J W⁻¹ Jᵀ, block by block: the columns 2k, 2k + 1 of body k
      for (let k = 0; k < keys.length; k++) {
        const [xx, xy, yx, yy] = Winv[k], X = byCol[2 * k], Y = byCol[2 * k + 1];
        for (const [i, vi] of X) { for (const [j, vj] of X) A[i][j] += vi * vj * xx; for (const [j, vj] of Y) A[i][j] += vi * vj * xy; }
        for (const [i, vi] of Y) { for (const [j, vj] of X) A[i][j] += vi * vj * yx; for (const [j, vj] of Y) A[i][j] += vi * vj * yy; }
      }
      const rhs = f.map((fi, i) => { let s = fi; for (const [c, v] of J[i]) s -= v * q[c]; return s; });
      const mu = solveSym(A, rhs);
      const step = new Float64Array(n);
      const g = new Float64Array(n);
      for (let c = 0; c < n; c++) { let s = 0; for (const [i, v] of byCol[c]) s += v * mu[i]; g[c] = s; }
      for (let k = 0; k < keys.length; k++) { const [xx, xy, yx, yy] = Winv[k], gx = g[2 * k], gy = g[2 * k + 1]; step[2 * k] = -q[2 * k] - (xx * gx + xy * gy); step[2 * k + 1] = -q[2 * k + 1] - (yx * gx + yy * gy); }
      // halve the step while it makes things worse (a distance far from where it started)
      let a = 1, q2, f2, e2;
      for (let k = 0; k < 12; k++) { q2 = q.map((v, c) => v + a * step[c]); f2 = F(q2); e2 = norm(f2); if (e2 < err || e2 <= TOL) break; a /= 2; }
      if (!(e2 < err) && e2 > TOL) break;   // no progress: these equations cannot all be met
      q.set(q2);
      f = f2; err = e2;
    }
    const T = Tof(q), bad = rows.filter((d, i) => Math.abs(f[i]) > 1e-4).map(d => d.id).filter(id => !String(id).startsWith("~"));
    return { ok: err <= 1e-4, T, bad, lost, err, keys, rows, q, env, arcRows };
  }
  /** the rank test: does the dimension add an equation, or is it already implied by the others? */
  function redundant(board, model, dim, csol) {
    const env = makeEnv(board, model, csol), driving = board.dims.items.filter(d => !d.ref && d !== dim && residual(env, d, null) !== null);
    const keys = []; driving.concat([dim]).forEach(d => bodiesOf(board, d).forEach(k => { if (!keys.includes(k)) keys.push(k); }));
    if (!bodiesOf(board, dim).length) return true;   // nothing it touches can move
    env.ov.forEach((v, i) => { const k = "ov:" + i; if (!keys.includes(k) && keys.some(q => isOv(q) && env.ov[+q.slice(3)].loop === v.loop)) keys.push(k); });
    const J = jacobian(env, implicit(env, keys).concat(driving, [dim]), keys);
    return rowBasis(J).length <= rowBasis(J.slice(0, -1)).length;
  }
  function jacobian(env, rows, keys) {
    const n = keys.length * 2, idx = new Map(keys.map((k, i) => [k, i]));
    return rows.map(d => { const r = new Array(n).fill(0); grad(env, d, null).forEach(([k, gx, gy]) => { const i = idx.get(k); if (i === undefined) return; r[2 * i] += gx; r[2 * i + 1] += gy; }); return r; });
  }
  /** how free each body touched by a dimension still is: Map body → { x: fixed?, y: fixed? }
      (a slide is fixed when it lies in the span of the equations' gradients) */
  function freedom(board, model, csol) {
    normalise(board);
    const env = makeEnv(board, model, csol), rows = board.dims.items.filter(d => !d.ref && residual(env, d, null) !== null);
    // against the board as it is: the outline counts as standing still here
    const keys = []; board.dims.items.forEach(d => bodiesOf(board, d).forEach(k => { if (!keys.includes(k) && !isOv(k)) keys.push(k); }));
    const basis = rowBasis(jacobian(env, rows, keys)), out = new Map();
    // a slide along the axis (or along any direction): fixed when its projection on the basis is whole
    const inSpan = vec => { let s = 0; basis.forEach(b => { let d = 0; for (let i = 0; i < vec.length; i++) d += vec[i] * b[i]; s += d * d; }); return s > 1 - 1e-6; };
    keys.forEach((k, i) => {
      const ex = new Array(keys.length * 2).fill(0), ey = ex.slice(); ex[2 * i] = 1; ey[2 * i + 1] = 1;
      out.set(k, { x: inSpan(ex), y: inSpan(ey) });
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Names (English; the Russian comes from the dictionary's patterns)
  // ---------------------------------------------------------------------------
  function featureName(board, model, f) {
    if (!f) return "nothing";
    const find = (l, id) => (board[l] || []).find(q => q && q.id === id);
    switch (f.t) {
      case "origin": return "the origin";
      case "board": return `board ${BOARD_AT[f.at] || f.at}`;
      case "part": { const p = board.parts && board.parts[f.key]; return p ? `${p.ref} origin` : "a part that is gone"; }
      case "pad": { const p = board.parts && board.parts[f.part]; return p ? `pad ${p.ref}-${f.num}` : "a pad that is gone"; }
      case "hole": { const h = find("holes", f.id); return h ? `hole Ø${h.d} (${String(f.id).toUpperCase()})` : "a hole that is gone"; }
      case "via": return find("vias", f.id) ? `via ${String(f.id).toUpperCase()}` : "a via that is gone";
      case "text": { const t = find("texts", f.id); return t ? `text "${String(t.text).slice(0, 20)}"` : "a text that is gone"; }
      case "ko": { const k = find("keepouts", f.id); return k ? `keep-out ${k.name ? `"${k.name}" ` : ""}corner ${(f.k || 0) + 1}` : "a keep-out that is gone"; }
      case "koe": { const k = find("keepouts", f.id); return k ? `keep-out ${k.name ? `"${k.name}" ` : ""}edge ${(f.k || 0) + 1}` : "a keep-out that is gone"; }
      case "edge": return `board ${EDGE_NAMES[f.k] || "edge"}`;
      case "ov": return `board outline corner ${f.k + 1}`;
      case "oe": { const v = overts(board)[f.k]; return v ? `board outline ${v.b ? (v.full ? "circle" : "arc") : "edge"} ${f.k + 1}` : "an outline edge that is gone"; }
      case "oc": { const v = overts(board)[f.k]; return v ? `centre of board outline ${v.full ? "circle" : "arc"} ${f.k + 1}` : "an outline arc that is gone"; }
      case "cp": return "a construction point";
      case "cl": return "a construction line";
      default: return "?";
    }
  }
  function describe(board, model, d) {
    const A = featureName(board, model, d.a), Bn = featureName(board, model, d.b), v = Math.abs(+d.v || 0).toFixed(2);
    switch (d.k) {
      case "rad": return `${A} radius ${v} mm`;
      case "dia": return `${A} diameter ${v} mm`;
      case "dx": return `${Bn} ${v} mm ${d.v < 0 ? "left of" : "right of"} ${A}`;
      case "dy": return `${Bn} ${v} mm ${d.v < 0 ? "below" : "above"} ${A}`;
      case "dist": return `${Bn} ${v} mm from ${A}`;
      case "pl": return `${A} ${v} mm from ${Bn}`;
      case "hz": return `${Bn} level with ${A} (same Y)`;
      case "vt": return `${Bn} in line with ${A} (same X)`;
      default: return "";
    }
  }

  /** the dimensions that name a body's object (to list or remove them with it) */
  function onBody(board, key) { return normalise(board).items.filter(d => bodyOf(board, d.a) === key || bodyOf(board, d.b) === key || featBody(d.a) === key || featBody(d.b) === key); }
  // the body key a feature would have even when locked
  function featBody(f) {
    if (!f) return null;
    if (f.t === "part") return "part:" + f.key; if (f.t === "pad") return "part:" + f.part;
    if (f.t === "hole" || f.t === "via" || f.t === "text") return f.t + ":" + f.id;
    if (f.t === "ko" || f.t === "koe") return "ko:" + f.id;
    return null;
  }

  root.BoardDims = { KINDS, NAMES, HAS_VALUE, EDGE_NAMES, normalise, newId, textId, isLine, isOv, overts, ovOf, featKeys, movers, movedOutline, remapOutline, implicit, bodiesOf, bodyOf, featBody, objOfBody, bodyPos, moveBody, makeEnv, residual, grad, measure, signedDist, solve, redundant, freedom, featureName, describe, onBody, rowBasis, solveSym };
})(typeof window !== "undefined" ? window : globalThis);
