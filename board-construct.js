/* =============================================================================
   CONSTRUCTION GEOMETRY (no DOM, Node-testable): dashed reference lines, rays, segments,
   offsets of the board's edges and outline, circles and arcs round holes and pads, linear and
   polar arrays, and reference points, all tied to what they were drawn from, so that moving the
   outline, a hole or a part moves them (and the mounting holes placed on them) too.

   It lives in the board document as board.construct = { items: [...], hide, lock } and in the
   holes it places (hole.at). Nothing here is copper or a hole: no export reads it.

   Frame: everything here is in the user's frame, millimetres from the board's bottom-left corner,
   X to the right and Y UP (the board document keeps y down from the top edge: Y = h - y).
   Angles in degrees, counter-clockwise from +X.

   A point (P) is { x, y } (fixed) or { ref, dx, dy } (dx, dy from a reference point; dx/dy may be
   left out) or { ref, pr, pa } (pr mm at pa° from it). A reference point (ref) is one of
     { t: "origin" }                         the board's origin (bottom left)
     { t: "board", at }                      BL BR TL TR C (centre) B R T L (edge middles),
                                             aBL aBR aTL aTR (the centres of the rounded corners)
     { t: "hole", id } / { t: "via", id }    a mounting hole's / via's centre
     { t: "pad", part, num } / { t: "part", key }   a pad's centre / a part's origin
     { t: "ko", id, k }                      a keep-out area's corner
     { t: "c", id, k }                       a construction item's k-th point (a point: 0)
     { t: "ctr", id }                        a circle's or polar array's centre
     { t: "x", a: G, b: G, i }               the i-th crossing of two curves
     { t: "mid", g: G } / { t: "end", g: G, e }   the middle / an end of a segment
     { t: "on", g: G, u | a }                on a curve: u mm along a line from its first point,
                                             or at a° on a circle
     { t: "tan", from: P, g: G, i }          where a line from P touches a circle
   and a curve (G) is { id, k }: the k-th curve of a construction item, of the board outline
   ("@outline": 0 bottom, 1 right, 2 top, 3 left edge, 4–7 the rounded corners BR TR TL BL) or of
   a keep-out area ("@ko:<id>": its k-th edge).

   Items: { id, k: kind, ... }
     point   { at: P }
     line    { a: P, b: P } or { a: P, ang, rel: G }, ext: "line" (endless) | "ray" | "seg"
     offset  { of: G (k left out: every curve of the item; "@outline" without k: the whole
               contour), d }: d > 0 into the board for its edges, outwards for circles and
               keep-out edges, to the left of a line's direction
     circle  { c: P, r, rim (r from the hole's or pad's edge), arc: [a0, a1] (counter-clockwise) }
     array   { of: id, n, by: "step" | "span", step, span, ang (left out: square to a line) }
     polar   { c: P, of: id (left out: n rays from c), n, by, step, span, a0 }
     fixed   { prims, pts }: a detached item, plain coordinates
   ============================================================================= */
(function (root) {
  "use strict";
  const EPS = 1e-9, R4 = v => Math.round(v * 1e4) / 1e4, RAD = Math.PI / 180;
  const KINDS = ["point", "line", "offset", "circle", "array", "polar", "fixed"];
  const NAMES = { point: "Reference point", line: "Construction line", offset: "Offset", circle: "Construction circle", array: "Linear array", polar: "Polar array", fixed: "Construction (detached)" };
  const BOARD_AT = { BL: "bottom-left corner", BR: "bottom-right corner", TL: "top-left corner", TR: "top-right corner", C: "centre", B: "bottom edge middle", R: "right edge middle", T: "top edge middle", L: "left edge middle", aBL: "bottom-left corner arc centre", aBR: "bottom-right corner arc centre", aTL: "top-left corner arc centre", aTR: "top-right corner arc centre" };
  const EDGE_NAMES = ["bottom edge", "right edge", "top edge", "left edge", "bottom-right corner arc", "top-right corner arc", "top-left corner arc", "bottom-left corner arc"];

  // ---------------------------------------------------------------------------
  // The document
  // ---------------------------------------------------------------------------
  /** board.construct made whole: items with ids, unknown kinds dropped; ids of holes, vias and
      keep-outs made unique (a copied hole keeps no one else's id) */
  function normalise(board) {
    const c = board.construct && typeof board.construct === "object" ? board.construct : {};
    const items = Array.isArray(c.items) ? c.items.filter(it => it && KINDS.includes(it.k)) : [];
    board.construct = { items, hide: !!c.hide, lock: !!c.lock };
    const seen = new Set();
    items.forEach(it => { if (!it.id || seen.has(it.id)) it.id = newId(board, "c", seen); seen.add(it.id); });
    ["holes", "vias", "keepouts"].forEach(l => { const s = new Set(); (board[l] || []).forEach(o => { if (o && o.id) { if (s.has(o.id)) delete o.id; else s.add(o.id); } }); });
    return board.construct;
  }
  function newId(board, prefix, seen) {
    const used = new Set(seen || []);
    ((board.construct && board.construct.items) || []).forEach(it => used.add(it.id));
    ["holes", "vias", "keepouts"].forEach(l => (board[l] || []).forEach(o => o && o.id && used.add(o.id)));
    let n = 1; while (used.has(prefix + n)) n++;
    return prefix + n;
  }
  /** the id of a hole, via or keep-out, given one when it has none */
  function idOf(board, obj, prefix) { if (!obj.id) obj.id = newId(board, prefix); return obj.id; }
  const add = (board, item) => { normalise(board); item.id = newId(board, "c"); board.construct.items.push(item); return item; };

  // ---------------------------------------------------------------------------
  // Geometry: curves are { t: "L", x1, y1, x2, y2, ext } and { t: "C", cx, cy, r, a0, a1 }
  // ---------------------------------------------------------------------------
  const L = (x1, y1, x2, y2, ext) => ({ t: "L", x1, y1, x2, y2, ext: ext || "line" });
  const C = (cx, cy, r, a0, a1) => (a0 === undefined || a1 === undefined ? { t: "C", cx, cy, r } : { t: "C", cx, cy, r, a0, a1 });
  const norm360 = a => ((a % 360) + 360) % 360;
  // is the angle a (deg) on the arc from a0 counter-clockwise to a1?
  function onArc(c, a) {
    if (c.a0 === undefined) return true;
    const span = norm360(c.a1 - c.a0) || 360, off = norm360(a - c.a0);
    return off <= span + 1e-7 || off >= 360 - 1e-7;
  }
  function inExt(l, t) { return l.ext === "seg" ? t >= -1e-9 && t <= 1 + 1e-9 : l.ext === "ray" ? t >= -1e-9 : true; }
  const angOf = (c, x, y) => norm360(Math.atan2(y - c.cy, x - c.cx) / RAD);
  /** where two curves cross: [[x, y]...] in a fixed order (along the first line; the circles' ± roots) */
  function intersect(p, q) {
    if (!p || !q) return [];
    if (p.t === "C" && q.t === "L") return intersect(q, p);
    const out = [];
    if (p.t === "L" && q.t === "L") {
      const dx1 = p.x2 - p.x1, dy1 = p.y2 - p.y1, dx2 = q.x2 - q.x1, dy2 = q.y2 - q.y1, den = dx1 * dy2 - dy1 * dx2;
      if (Math.abs(den) < EPS * Math.hypot(dx1, dy1) * Math.hypot(dx2, dy2) + 1e-14) return out;
      const t = ((q.x1 - p.x1) * dy2 - (q.y1 - p.y1) * dx2) / den, u = ((q.x1 - p.x1) * dy1 - (q.y1 - p.y1) * dx1) / den;
      if (inExt(p, t) && inExt(q, u)) out.push([p.x1 + t * dx1, p.y1 + t * dy1]);
      return out;
    }
    if (p.t === "L" && q.t === "C") {
      const dx = p.x2 - p.x1, dy = p.y2 - p.y1, a = dx * dx + dy * dy, fx = p.x1 - q.cx, fy = p.y1 - q.cy;
      const b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - q.r * q.r;
      let disc = b * b - 4 * a * c;
      if (disc < -1e-9 * a) return out;
      disc = Math.max(0, disc);
      const s = Math.sqrt(disc), ts = s < 1e-12 ? [-b / (2 * a)] : [(-b - s) / (2 * a), (-b + s) / (2 * a)];
      ts.forEach(t => { const x = p.x1 + t * dx, y = p.y1 + t * dy; if (inExt(p, t) && onArc(q, angOf(q, x, y))) out.push([x, y]); });
      return out;
    }
    // two circles
    const dx = q.cx - p.cx, dy = q.cy - p.cy, d = Math.hypot(dx, dy);
    if (d < 1e-12 || d > p.r + q.r + 1e-9 || d < Math.abs(p.r - q.r) - 1e-9) return out;
    const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
    const mx = p.cx + a * dx / d, my = p.cy + a * dy / d;
    const pts = h < 1e-9 ? [[mx, my]] : [[mx + h * dy / d, my - h * dx / d], [mx - h * dy / d, my + h * dx / d]];
    pts.forEach(([x, y]) => { if (onArc(p, angOf(p, x, y)) && onArc(q, angOf(q, x, y))) out.push([x, y]); });
    return out;
  }
  /** the nearest point of a curve to (x, y): { p: [x, y], d, u | a } */
  function nearest(c, x, y) {
    if (c.t === "L") {
      const dx = c.x2 - c.x1, dy = c.y2 - c.y1, len = Math.hypot(dx, dy); if (len < EPS) return null;
      let t = ((x - c.x1) * dx + (y - c.y1) * dy) / (len * len);
      if (c.ext === "seg") t = Math.max(0, Math.min(1, t)); else if (c.ext === "ray") t = Math.max(0, t);
      const px = c.x1 + t * dx, py = c.y1 + t * dy;
      return { p: [px, py], d: Math.hypot(x - px, y - py), u: t * len };
    }
    let a = angOf(c, x, y);
    if (!onArc(c, a)) { const e0 = norm360(c.a0), e1 = norm360(c.a1), d0 = Math.abs(((a - e0 + 540) % 360) - 180), d1 = Math.abs(((a - e1 + 540) % 360) - 180); a = d0 <= d1 ? e0 : e1; }
    const px = c.cx + c.r * Math.cos(a * RAD), py = c.cy + c.r * Math.sin(a * RAD);
    return { p: [px, py], d: Math.hypot(x - px, y - py), a };
  }
  /** a curve d away: a line to its left, a circle outwards */
  function offsetCurve(c, d, ext) {
    if (c.t === "L") {
      const dx = c.x2 - c.x1, dy = c.y2 - c.y1, len = Math.hypot(dx, dy); if (len < EPS) return null;
      const nx = -dy / len * d, ny = dx / len * d;
      return L(c.x1 + nx, c.y1 + ny, c.x2 + nx, c.y2 + ny, ext || c.ext);
    }
    const r = c.r + d; return r > 1e-9 ? C(c.cx, c.cy, r, c.a0, c.a1) : null;
  }
  const moveCurve = (c, dx, dy) => (c.t === "L" ? L(c.x1 + dx, c.y1 + dy, c.x2 + dx, c.y2 + dy, c.ext) : C(c.cx + dx, c.cy + dy, c.r, c.a0, c.a1));
  function turnPt(p, cx, cy, deg) { const s = Math.sin(deg * RAD), co = Math.cos(deg * RAD), x = p[0] - cx, y = p[1] - cy; return [cx + x * co - y * s, cy + x * s + y * co]; }
  function turnCurve(c, cx, cy, deg) {
    if (c.t === "L") { const a = turnPt([c.x1, c.y1], cx, cy, deg), b = turnPt([c.x2, c.y2], cx, cy, deg); return L(a[0], a[1], b[0], b[1], c.ext); }
    const m = turnPt([c.cx, c.cy], cx, cy, deg); return C(m[0], m[1], c.r, c.a0 === undefined ? undefined : c.a0 + deg, c.a1 === undefined ? undefined : c.a1 + deg);
  }
  /** points where a line from p touches circle c: the two tangent points, or none from inside */
  function tangents(p, c) {
    const dx = p[0] - c.cx, dy = p[1] - c.cy, d = Math.hypot(dx, dy);
    if (d <= c.r + 1e-9) return [];
    const base = Math.atan2(dy, dx), off = Math.acos(c.r / d);
    return [base + off, base - off].map(a => [c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a)]).filter(q => onArc(c, angOf(c, q[0], q[1])));
  }
  /** the board outline as curves, user frame: 4 edges, then the 4 rounded corners (null when square) */
  function outlineCurves(o, d) {
    d = d || 0;
    const w = o.w, h = o.h, r0 = Math.max(0, Math.min(o.r || 0, w / 2, h / 2)), r = r0 - d, x0 = d, y0 = d, x1 = w - d, y1 = h - d;
    if (x1 - x0 < 1e-9 || y1 - y0 < 1e-9) return [];
    if (r <= 1e-9) return [L(x0, y0, x1, y0, "seg"), L(x1, y0, x1, y1, "seg"), L(x1, y1, x0, y1, "seg"), L(x0, y1, x0, y0, "seg"), null, null, null, null];
    // the corner centres stay where the outline's are; the straight runs end where the arcs begin
    const cx0 = r0, cy0 = r0, cx1 = w - r0, cy1 = h - r0;
    return [L(cx0, y0, cx1, y0, "seg"), L(x1, cy0, x1, cy1, "seg"), L(cx1, y1, cx0, y1, "seg"), L(x0, cy1, x0, cy0, "seg"),
      C(cx1, cy0, r, 270, 360), C(cx1, cy1, r, 0, 90), C(cx0, cy1, r, 90, 180), C(cx0, cy0, r, 180, 270)];
  }

  // ---------------------------------------------------------------------------
  // Solving: every item's curves and points, from the board as it is now
  // ---------------------------------------------------------------------------
  /** { items: { id: { curves, pts, centre, err } }, outline, ko: { id: curves }, pointOf, refPt, curve, holes } */
  function solve(board, model) {
    normalise(board);
    const o = board.outline, H = o.h, items = board.construct.items, byId = new Map(items.map(it => [it.id, it]));
    const out = {}, busy = new Set(), holeBusy = new Set();
    const outline = outlineCurves(o);
    const ko = {};
    (board.keepouts || []).forEach(k => { if (k.id) ko[k.id] = k.pts.map((p, i) => { const q = k.pts[(i + 1) % k.pts.length]; return L(p[0], H - p[1], q[0], H - q[1], "seg"); }); });
    const hole = id => (board.holes || []).find(h => h.id === id);
    function holeAt(h) {
      if (h.at && !holeBusy.has(h)) { holeBusy.add(h); const p = pointOf(h.at); holeBusy.delete(h); if (p) return p; }
      return [h.x, H - h.y];
    }
    function curvesOf(id) {
      if (id === "@outline") return outline;
      if (typeof id === "string" && id.startsWith("@ko:")) return ko[id.slice(4)] || [];
      const r = item(id); return r ? r.curves : [];
    }
    function curve(g) { if (!g) return null; const cs = curvesOf(g.id); return cs[g.k || 0] || null; }
    function refPt(ref) {
      if (!ref || typeof ref !== "object") return null;
      switch (ref.t) {
        case "origin": return [0, 0];
        case "board": {
          const r = Math.max(0, Math.min(o.r || 0, o.w / 2, o.h / 2));
          const P = { BL: [0, 0], BR: [o.w, 0], TL: [0, o.h], TR: [o.w, o.h], C: [o.w / 2, o.h / 2], B: [o.w / 2, 0], T: [o.w / 2, o.h], L: [0, o.h / 2], R: [o.w, o.h / 2],
            aBL: [r, r], aBR: [o.w - r, r], aTL: [r, o.h - r], aTR: [o.w - r, o.h - r] };
          return P[ref.at] || null;
        }
        case "hole": { const h = hole(ref.id); return h ? holeAt(h) : null; }
        case "via": { const v = (board.vias || []).find(q => q.id === ref.id); return v ? [v.x, H - v.y] : null; }
        case "pad": { const p = model && model.pads.find(q => q.part === ref.part && String(q.num) === String(ref.num)); return p ? [p.x, H - p.y] : null; }
        case "part": { const g = model && model.parts.find(q => q.key === ref.key); return g && g.place ? [g.place.x, H - g.place.y] : null; }
        case "ko": { const k = (board.keepouts || []).find(q => q.id === ref.id), p = k && k.pts[ref.k || 0]; return p ? [p[0], H - p[1]] : null; }
        case "c": { const r = item(ref.id); return r ? r.pts[ref.k || 0] || null : null; }
        case "ctr": { const r = item(ref.id); return r && r.centre ? r.centre : null; }
        case "x": { const xs = intersect(curve(ref.a), curve(ref.b)); return xs[ref.i || 0] || (xs.length === 1 ? xs[0] : null); }
        case "mid": { const c = curve(ref.g); return c && c.t === "L" ? [(c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2] : c ? [c.cx, c.cy] : null; }
        case "end": { const c = curve(ref.g); return c && c.t === "L" ? (ref.e ? [c.x2, c.y2] : [c.x1, c.y1]) : null; }
        case "on": {
          const c = curve(ref.g); if (!c) return null;
          if (c.t === "L") { const len = Math.hypot(c.x2 - c.x1, c.y2 - c.y1); if (len < EPS) return null; const t = (ref.u || 0) / len; return [c.x1 + t * (c.x2 - c.x1), c.y1 + t * (c.y2 - c.y1)]; }
          return [c.cx + c.r * Math.cos((ref.a || 0) * RAD), c.cy + c.r * Math.sin((ref.a || 0) * RAD)];
        }
        case "tan": { const p = pointOf(ref.from), c = curve(ref.g); if (!p || !c || c.t !== "C") return null; const ts = tangents(p, c); return ts[ref.i || 0] || null; }
        default: return null;
      }
    }
    function pointOf(P) {
      if (!P || typeof P !== "object") return null;
      if (!P.ref) return Number.isFinite(P.x) && Number.isFinite(P.y) ? [P.x, P.y] : null;
      const b = refPt(P.ref); if (!b) return null;
      if (Number.isFinite(P.pr)) return [b[0] + P.pr * Math.cos((P.pa || 0) * RAD), b[1] + P.pr * Math.sin((P.pa || 0) * RAD)];
      return [b[0] + (P.dx || 0), b[1] + (P.dy || 0)];
    }
    // the radius a circle's "rim" adds: the hole's or pad's own radius
    function rimOf(P) {
      const r = P && P.ref; if (!r) return 0;
      if (r.t === "hole") { const h = hole(r.id); return h ? h.d / 2 : 0; }
      if (r.t === "pad") { const p = model && model.pads.find(q => q.part === r.part && String(q.num) === String(r.num)); return p ? Math.max(p.w, p.h) / 2 : 0; }
      if (r.t === "ctr") { const c = item(r.id); return c && c.curves[0] && c.curves[0].t === "C" ? c.curves[0].r : 0; }
      return 0;
    }
    function item(id) {
      if (out[id]) return out[id];
      const it = byId.get(id); if (!it) return null;
      if (busy.has(id)) return { curves: [], pts: [], err: "it depends on itself" };
      busy.add(id);
      let r;
      try { r = build(it); } catch (e) { r = { curves: [], pts: [], err: String(e && e.message || e) }; }
      busy.delete(id);
      return (out[id] = r);
    }
    // curve(s) d away from the curve g (see the header for which way d > 0 goes)
    function offsetOf(g, d) {
      if (!g) return lost;
      if (g.id === "@outline") {
        if (g.k === undefined || g.k === null) return { curves: outlineCurves(o, d), pts: [] };
        const c = outline[g.k]; if (!c) return lost;
        return { curves: [c.t === "L" ? offsetCurve(c, d, "line") : offsetCurve(c, -d)].filter(Boolean), pts: [] };   // edges run counter-clockwise: left is inwards
      }
      if (typeof g.id === "string" && g.id.startsWith("@ko:")) {
        const k = (board.keepouts || []).find(q => q.id === g.id.slice(4)), cs = ko[g.id.slice(4)], c = cs && cs[g.k || 0]; if (!c) return lost;
        // outwards: the keep-out's corners turn clockwise or counter-clockwise in the user's frame
        return { curves: [offsetCurve(c, koTurn(k) > 0 ? -d : d, "line")], pts: [] };
      }
      const src = item(g.id); if (!src) return lost; if (src.err) return { curves: [], pts: [], err: src.err };
      const cs = g.k === undefined || g.k === null ? src.curves : [src.curves[g.k]].filter(Boolean);
      if (!cs.length) return lost;
      return { curves: cs.map(c => offsetCurve(c, d)).filter(Boolean), pts: [] };
    }
    const koTurn = k => { let A = 0; k.pts.forEach((p, i) => { const q = k.pts[(i + 1) % k.pts.length]; A += (p[0] * (H - q[1]) - q[0] * (H - p[1])); }); return A; };
    const lost = { curves: [], pts: [], err: "its reference is gone" };
    function build(it) {
      if (it.k === "point") { const p = pointOf(it.at); return p ? { curves: [], pts: [p] } : lost; }
      if (it.k === "line") {
        const a = pointOf(it.a); if (!a) return lost;
        let b = it.b ? pointOf(it.b) : null;
        if (!it.b) {
          let ang = +it.ang || 0;
          if (it.rel) { const c = curve(it.rel); if (!c || c.t !== "L") return lost; ang += Math.atan2(c.y2 - c.y1, c.x2 - c.x1) / RAD; }
          b = [a[0] + 10 * Math.cos(ang * RAD), a[1] + 10 * Math.sin(ang * RAD)];
        }
        if (!b) return lost;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return { curves: [], pts: [], err: "its two points are the same" };
        return { curves: [L(a[0], a[1], b[0], b[1], it.ext || "line")], pts: [] };
      }
      if (it.k === "offset") return offsetOf(it.of, +it.d || 0);
      if (it.k === "circle") {
        const c = pointOf(it.c); if (!c) return lost;
        const r = (+it.r || 0) + (it.rim ? rimOf(it.c) : 0);
        if (!(r > 1e-6)) return { curves: [], pts: [], centre: c, err: "its radius is zero" };
        const arc = Array.isArray(it.arc) && it.arc.length === 2 && Number.isFinite(+it.arc[0]) && Number.isFinite(+it.arc[1]) && norm360(+it.arc[1] - +it.arc[0]) > 1e-6 ? it.arc.map(Number) : null;
        return { curves: [arc ? C(c[0], c[1], r, arc[0], arc[1]) : C(c[0], c[1], r)], pts: [], centre: c };
      }
      if (it.k === "array" || it.k === "polar") {
        const n = Math.max(2, Math.min(200, Math.round(+it.n || 2)));
        const src = it.of ? item(it.of) : null;
        if (it.of && (!src || src.err)) return src && src.err ? { curves: [], pts: [], err: src.err } : lost;
        if (it.k === "array") {
          const step = it.by === "span" ? (+it.span || 0) / (n - 1) : +it.step || 0;
          let ux = 1, uy = 0;
          if (Number.isFinite(+it.ang) && it.ang !== null && it.ang !== "" && it.ang !== undefined) { ux = Math.cos(it.ang * RAD); uy = Math.sin(it.ang * RAD); }
          else if (src.curves.length === 1 && src.curves[0].t === "L") { const c = src.curves[0], len = Math.hypot(c.x2 - c.x1, c.y2 - c.y1); ux = -(c.y2 - c.y1) / len; uy = (c.x2 - c.x1) / len; }
          const curves = [], pts = [];
          for (let i = 1; i < n; i++) { const dx = ux * step * i, dy = uy * step * i; src.curves.forEach(c => curves.push(moveCurve(c, dx, dy))); src.pts.forEach(p => pts.push([p[0] + dx, p[1] + dy])); if (src.centre && !src.pts.length) pts.push([src.centre[0] + dx, src.centre[1] + dy]); }
          return { curves, pts, srcPts: src.pts.length ? src.pts : src.centre ? [src.centre] : [] };
        }
        const c = pointOf(it.c); if (!c) return lost;
        const span = +it.span || 0, full = Math.abs(span) >= 360 - 1e-9;
        const step = it.by === "span" ? span / (full ? n : n - 1) : +it.step || 0, a0 = +it.a0 || 0;
        const curves = [], pts = [];
        if (!src) { for (let i = 0; i < n; i++) { const a = (a0 + step * i) * RAD; curves.push(L(c[0], c[1], c[0] + 10 * Math.cos(a), c[1] + 10 * Math.sin(a), "ray")); } return { curves, pts, centre: c, srcPts: [] }; }
        for (let i = 1; i < n; i++) { const a = step * i; src.curves.forEach(q => curves.push(turnCurve(q, c[0], c[1], a))); src.pts.forEach(p => pts.push(turnPt(p, c[0], c[1], a))); if (src.centre && !src.pts.length) pts.push(turnPt(src.centre, c[0], c[1], a)); }
        return { curves, pts, centre: c, srcPts: src.pts.length ? src.pts : src.centre ? [src.centre] : [] };
      }
      if (it.k === "fixed") {
        const curves = (it.prims || []).map(c => (c.t === "L" ? L(+c.x1, +c.y1, +c.x2, +c.y2, c.ext) : c.t === "C" ? C(+c.cx, +c.cy, +c.r, c.a0, c.a1) : null)).filter(Boolean);
        return { curves, pts: (it.pts || []).map(p => [+p[0], +p[1]]) };
      }
      return lost;
    }
    items.forEach(it => item(it.id));
    return { items: out, outline, ko, pointOf, refPt, curve, curvesOf, holeAt, rimOf, offsetOf, koTurn, H, board, model };
  }

  // ---------------------------------------------------------------------------
  // Holes tied to the construction (hole.at): they follow it; a hole moved by hand keeps its tie
  // with the new offset. last: a WeakMap of where each hole was put the last time (user frame).
  // ---------------------------------------------------------------------------
  function applyHoles(sol, last) {
    const board = sol.board, H = board.outline.h, lost = [];
    (board.holes || []).forEach(h => {
      if (!h.at) return;
      const now = [h.x, H - h.y], was = last && last.get(h);
      if (was && Math.hypot(was[0] - now[0], was[1] - now[1]) > 1e-6) { rebase(sol, h.at, now); last.set(h, now); return; }
      const p = sol.pointOf(h.at);
      if (!p) { lost.push(h); if (last) last.set(h, now); return; }
      h.x = R4(p[0]); h.y = R4(H - p[1]);
      if (last) last.set(h, [h.x, H - h.y]);
    });
    return lost;
  }
  /** a point P made to land on `to` (user frame), keeping its reference: dx, dy from it */
  function rebase(sol, P, to) {
    if (!P) return P;
    if (!P.ref) { P.x = R4(to[0]); P.y = R4(to[1]); return P; }
    const b = sol.refPt(P.ref);
    if (!b) { delete P.ref; delete P.dx; delete P.dy; delete P.pr; delete P.pa; P.x = R4(to[0]); P.y = R4(to[1]); return P; }
    delete P.pr; delete P.pa; P.dx = R4(to[0] - b[0]); P.dy = R4(to[1] - b[1]);
    return P;
  }
  const fixedPt = p => ({ x: R4(p[0]), y: R4(p[1]) });
  /** an item cut loose from what it was drawn from: fixed coordinates where it is now */
  function detach(sol, it) {
    const r = sol.items[it.id]; if (!r) return false;
    if (it.k === "point") { if (!r.pts[0]) return false; it.at = fixedPt(r.pts[0]); return true; }
    if (it.k === "line" && r.curves[0]) { const c = r.curves[0]; it.a = fixedPt([c.x1, c.y1]); it.b = fixedPt([c.x2, c.y2]); delete it.ang; delete it.rel; return true; }
    if (it.k === "circle" && r.curves[0]) { const c = r.curves[0]; it.c = fixedPt([c.cx, c.cy]); it.r = R4(c.r); delete it.rim; return true; }
    if (!r.curves.length && !r.pts.length) return false;
    const keep = { id: it.id, name: it.name };
    Object.keys(it).forEach(k => delete it[k]);
    Object.assign(it, keep, { k: "fixed", prims: r.curves.map(c => (c.t === "L" ? { t: "L", x1: R4(c.x1), y1: R4(c.y1), x2: R4(c.x2), y2: R4(c.y2), ext: c.ext } : { t: "C", cx: R4(c.cx), cy: R4(c.cy), r: R4(c.r), a0: c.a0, a1: c.a1 })), pts: r.pts.map(p => [R4(p[0]), R4(p[1])]) });
    if (!it.name) delete it.name;
    return true;
  }
  /** what depends on an item: other items and holes that name it */
  function dependents(board, id) {
    const uses = v => JSON.stringify(v).includes(`"id":"${id}"`) || JSON.stringify(v).includes(`"of":"${id}"`);
    return { items: board.construct.items.filter(it => it.id !== id && uses(it)), holes: (board.holes || []).filter(h => h.at && uses(h.at)) };
  }

  // ---------------------------------------------------------------------------
  // Snapping: points to stick to near (x, y) (user frame), each with the reference to keep
  // ---------------------------------------------------------------------------
  const SNAP_DEFAULT = { points: true, inter: true, mid: true, centre: true, end: true, tangent: true, on: true };
  /** every curve the snaps and the offset tool can use: [{ id, k, c, cons }] */
  function allCurves(sol, opts) {
    const list = [];
    if (!opts || opts.outline !== false) sol.outline.forEach((c, k) => c && list.push({ id: "@outline", k, c, cons: false }));
    if (!opts || opts.keepouts !== false) Object.entries(sol.ko).forEach(([id, cs]) => cs.forEach((c, k) => list.push({ id: "@ko:" + id, k, c, cons: false })));
    if (!opts || opts.cons !== false) Object.entries(sol.items).forEach(([id, r]) => r.curves.forEach((c, k) => c && list.push({ id, k, c, cons: true })));
    return list;
  }
  /** snap candidates near (x, y) within tol: [{ p, what, shape, ref, pri, d }] best first
      (points, crossings, centres, middles, ends, tangent points; then "on a curve") */
  function snaps(sol, x, y, tol, set, from) {
    const S = { ...SNAP_DEFAULT, ...(set || {}) }, out = [];
    const put = (p, what, shape, ref, pri) => { if (!p) return; const d = Math.hypot(p[0] - x, p[1] - y); if (d <= tol) out.push({ p: [R4(p[0]), R4(p[1])], what, shape, ref, pri, d }); };
    const items = sol.board.construct.items;
    if (S.points) items.forEach(it => { const r = sol.items[it.id]; if (r) r.pts.forEach((p, k) => put(p, `${label(it)} point${r.pts.length > 1 ? " " + (k + 1) : ""}`, "centre", { t: "c", id: it.id, k }, 0)); });
    if (S.centre) {
      items.forEach(it => { const r = sol.items[it.id]; if (r && r.centre && it.k !== "point") put(r.centre, `centre of ${label(it)}`, "centre", { t: "ctr", id: it.id }, 1); });
      const o = sol.board.outline; if (o.r > 0) ["aBL", "aBR", "aTL", "aTR"].forEach(at => put(sol.refPt({ t: "board", at }), `board ${BOARD_AT[at]}`, "centre", { t: "board", at }, 1));
    }
    const near = allCurves(sol).map(e => ({ ...e, n: nearest(e.c, x, y) })).filter(e => e.n && e.n.d <= tol);
    if (S.inter) for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j]; if (!a.cons && !b.cons) continue;
      intersect(a.c, b.c).forEach((p, k) => put(p, `crossing: ${curveName(sol, a)} × ${curveName(sol, b)}`, "corner", { t: "x", a: { id: a.id, k: a.k }, b: { id: b.id, k: b.k }, i: k }, 0));
    }
    near.filter(e => e.cons && e.c.t === "L").forEach(e => {
      if (S.mid && e.c.ext === "seg") put([(e.c.x1 + e.c.x2) / 2, (e.c.y1 + e.c.y2) / 2], `middle of ${curveName(sol, e)}`, "corner", { t: "mid", g: { id: e.id, k: e.k } }, 1);
      if (S.end && e.c.ext !== "line") { put([e.c.x1, e.c.y1], `end of ${curveName(sol, e)}`, "corner", { t: "end", g: { id: e.id, k: e.k }, e: 0 }, 1); if (e.c.ext === "seg") put([e.c.x2, e.c.y2], `end of ${curveName(sol, e)}`, "corner", { t: "end", g: { id: e.id, k: e.k }, e: 1 }, 1); }
    });
    // a circle's quarter points (0°, 90°, 180°, 270°)
    if (S.centre) near.filter(e => e.cons && e.c.t === "C").forEach(e => [0, 90, 180, 270].forEach(a => { if (onArc(e.c, a)) put([e.c.cx + e.c.r * Math.cos(a * RAD), e.c.cy + e.c.r * Math.sin(a * RAD)], `${a}° on ${curveName(sol, e)}`, "corner", { t: "on", g: { id: e.id, k: e.k }, a }, 1); }));
    if (S.tangent && from && from.p) near.filter(e => e.c.t === "C").forEach(e => tangents(from.p, e.c).forEach((p, i) => put(p, `tangent to ${curveName(sol, e)}`, "tan", { t: "tan", from: from.P, g: { id: e.id, k: e.k }, i }, 1)));
    if (S.on) near.filter(e => e.cons).forEach(e => put(e.n.p, `on ${curveName(sol, e)}`, "on", e.c.t === "L" ? { t: "on", g: { id: e.id, k: e.k }, u: R4(e.n.u) } : { t: "on", g: { id: e.id, k: e.k }, a: R4(e.n.a) }, 3));
    return out.sort((a, b) => a.pri - b.pri || a.d - b.d);
  }
  /** the curve under (x, y): { id, k, c, cons, d } or null; opts as allCurves */
  function pick(sol, x, y, tol, opts) {
    let best = null;
    allCurves(sol, opts).forEach(e => { const n = nearest(e.c, x, y); if (n && n.d <= tol && (!best || n.d < best.d - 1e-9)) best = { ...e, d: n.d, n }; });
    return best;
  }
  /** the construction item under (x, y) (its curves or its points), for selecting: id or null */
  function hitItem(sol, x, y, tol) {
    let best = null, bd = tol;
    sol.board.construct.items.forEach(it => { const r = sol.items[it.id]; if (!r) return; r.pts.forEach(p => { const d = Math.hypot(p[0] - x, p[1] - y); if (d <= bd) { bd = d; best = it.id; } }); });
    if (best) return best;
    const e = pick(sol, x, y, tol, { outline: false, keepouts: false });
    return e ? e.id : null;
  }

  // ---------------------------------------------------------------------------
  // Words for the inspector
  // ---------------------------------------------------------------------------
  function label(it) { return it.name || `${({ point: "point", line: "line", offset: "offset", circle: "circle", array: "array", polar: "polar array", fixed: "construction" })[it.k] || it.k} ${String(it.id).replace(/^c/, "C")}`; }
  function curveName(sol, g) {
    if (g.id === "@outline") return `board ${EDGE_NAMES[g.k] || "edge"}`;
    if (typeof g.id === "string" && g.id.startsWith("@ko:")) { const k = (sol.board.keepouts || []).find(q => q.id === g.id.slice(4)); return `keep-out ${k && k.name ? `"${k.name}" ` : ""}edge ${(g.k || 0) + 1}`; }
    const it = sol.board.construct.items.find(q => q.id === g.id); if (!it) return "a curve that is gone";
    const r = sol.items[g.id], many = r && r.curves.length > 1;
    return `${label(it)}${many && g.k !== undefined && g.k !== null ? ` #${g.k + 1}` : ""}`;
  }
  function refName(sol, ref) {
    if (!ref) return "a fixed place";
    const b = sol.board;
    switch (ref.t) {
      case "origin": return "the board's origin";
      case "board": return `the board's ${BOARD_AT[ref.at] || ref.at}`;
      case "hole": { const h = (b.holes || []).find(q => q.id === ref.id); return h ? `hole Ø${h.d} (${String(ref.id).toUpperCase()})` : "a hole that is gone"; }
      case "via": return "a via";
      case "pad": { const p = sol.model && sol.model.pads.find(q => q.part === ref.part && String(q.num) === String(ref.num)); return p ? `pad ${p.ref}-${p.num}` : `pad ${ref.num} of a part that is gone`; }
      case "part": { const g = sol.model && sol.model.parts.find(q => q.key === ref.key); return g ? `${g.ref}'s origin` : "a part that is gone"; }
      case "ko": return `keep-out corner ${(ref.k || 0) + 1}`;
      case "c": { const it = b.construct.items.find(q => q.id === ref.id); return it ? (it.k === "point" ? label(it) : `${label(it)} point ${(ref.k || 0) + 1}`) : "an item that is gone"; }
      case "ctr": { const it = b.construct.items.find(q => q.id === ref.id); return it ? `the centre of ${label(it)}` : "an item that is gone"; }
      case "x": return `the crossing of ${curveName(sol, ref.a)} and ${curveName(sol, ref.b)}`;
      case "mid": return `the middle of ${curveName(sol, ref.g)}`;
      case "end": return `an end of ${curveName(sol, ref.g)}`;
      case "on": return `a point on ${curveName(sol, ref.g)}`;
      case "tan": return `the tangent point on ${curveName(sol, ref.g)}`;
      default: return "?";
    }
  }
  /** a point in words: "10.00, 5.00 from the board's bottom-left corner" */
  function pointName(sol, P) {
    if (!P) return "—";
    if (!P.ref) return `X ${(+P.x).toFixed(2)}, Y ${(+P.y).toFixed(2)} (fixed)`;
    const off = Number.isFinite(P.pr) ? `${(+P.pr).toFixed(2)} mm at ${(+P.pa || 0).toFixed(1)}° from ` : (P.dx || P.dy) ? `Δx ${(+P.dx || 0).toFixed(2)}, Δy ${(+P.dy || 0).toFixed(2)} from ` : "";
    return off + refName(sol, P.ref);
  }
  /** the item's tie in one line, e.g. "Offset = 5.00 mm from board bottom edge" */
  function describe(sol, it) {
    switch (it.k) {
      case "point": return `At ${pointName(sol, it.at)}`;
      case "line": return it.b ? `Through ${pointName(sol, it.a)} and ${pointName(sol, it.b)}` : `Through ${pointName(sol, it.a)} at ${(+it.ang || 0).toFixed(1)}° ${it.rel ? `to ${curveName(sol, it.rel)}` : "to the X axis"}`;
      case "offset": return `Offset = ${(+it.d || 0).toFixed(2)} mm from ${it.of && it.of.id === "@outline" && (it.of.k === undefined || it.of.k === null) ? "the board outline (the whole contour)" : curveName(sol, it.of || {})}`;
      case "circle": return `R = ${(+it.r || 0).toFixed(2)} mm${it.rim ? " from the rim" : ""} round ${pointName(sol, it.c)}`;
      case "array": return `${it.n} × ${it.by === "span" ? `over ${(+it.span || 0).toFixed(2)} mm` : `every ${(+it.step || 0).toFixed(2)} mm`} of ${(() => { const s = sol.board.construct.items.find(q => q.id === it.of); return s ? label(s) : "an item that is gone"; })()}`;
      case "polar": return `${it.n} × ${it.by === "span" ? `over ${(+it.span || 0).toFixed(1)}°` : `every ${(+it.step || 0).toFixed(1)}°`} round ${pointName(sol, it.c)}${it.of ? ` of ${(() => { const s = sol.board.construct.items.find(q => q.id === it.of); return s ? label(s) : "an item that is gone"; })()}` : ""}`;
      case "fixed": return "Fixed coordinates (detached)";
      default: return "";
    }
  }
  /** every placement point of an item, each with the reference a hole keeps: [{ p, ref }] (user
      frame). An array's begin with its original's; a circle's is its centre. */
  function pointsOf(sol, it) {
    const r = sol.items[it.id]; if (!r) return [];
    const out = [];
    if ((it.k === "array" || it.k === "polar") && it.of) {
      const src = sol.board.construct.items.find(q => q.id === it.of);
      if (src) pointsOf(sol, src).forEach(e => out.push(e));
    }
    if (it.k === "circle" && r.centre) out.push({ p: r.centre, ref: { t: "ctr", id: it.id } });
    r.pts.forEach((p, k) => out.push({ p, ref: { t: "c", id: it.id, k } }));
    return out;
  }

  root.BoardConstruct = { KINDS, NAMES, BOARD_AT, EDGE_NAMES, SNAP_DEFAULT, normalise, newId, idOf, add, intersect, nearest, offsetCurve, tangents, outlineCurves, onArc, turnCurve, solve, applyHoles, rebase, detach, dependents, allCurves, snaps, pick, hitItem, label, curveName, refName, pointName, describe, pointsOf };
})(typeof window !== "undefined" ? window : globalThis);
