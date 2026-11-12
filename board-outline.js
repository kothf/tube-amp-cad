/* =============================================================================
   BOARD OUTLINE SHAPES (no DOM, Node-testable): a board whose edge is not a plain rectangle.

   board.outline = { w, h, r, shape? }. Without `shape` the board is the w × h rectangle with
   corner radius r, as always. With it, shape is a list of closed loops, the first the board's
   edge and the rest cut-outs inside it; w and h are then the size of the box round the edge
   (kept by normalise(), so everything that only needs the board's extent still works).

   A loop is a list of vertices [x, y, b]: board coordinates (mm, y down, the box's top-left
   corner at 0, 0) and b the bulge of the run to the next vertex (left out or 0: a straight line;
   else an arc turning through 4·atan(b), positive to the left of travel as the numbers read,
   so b = 1 is a half circle). The edge runs so that the board is on its left (positive area as
   the numbers read), the cut-outs the other way round.

   Here: the loops of any outline (a rectangle's too), their segments, polygons (arcs in
   steps), the signed distance from the edge, clipping lines to the board, the area outside
   it (for copper pours), and the sketch: loose lines, arcs and circles chained into loops
   and checked (closed, not crossing, cut-outs inside).
   ============================================================================= */
(function (root) {
  "use strict";
  const TAU = 2 * Math.PI, R4 = v => Math.round(v * 1e4) / 1e4, Q = Math.tan(Math.PI / 8);   // Q: a quarter circle's bulge
  const isShape = o => !!(o && Array.isArray(o.shape) && o.shape.length && Array.isArray(o.shape[0]) && o.shape[0].length >= 2);

  // ---------------------------------------------------------------------------
  // Loops and segments
  // ---------------------------------------------------------------------------
  /** the rectangle with rounded corners as a loop */
  function rectLoop(w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    if (r < 1e-9) return [[0, 0], [w, 0], [w, h], [0, h]];
    const L = [[r, 0], [w - r, 0, Q], [w, r], [w, h - r, Q], [w - r, h], [r, h, Q], [0, h - r], [0, r, Q]];
    // a side used up by its corners leaves no straight run
    return L.filter((p, i) => { const q = L[(i + 1) % L.length]; return p[2] || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9; });
  }
  const circleLoop = (cx, cy, r) => [[cx - r, cy, 1], [cx + r, cy, 1]];
  /** a regular polygon: n corners on a circle of radius r, the first at a0 radians */
  function polygonLoop(cx, cy, r, n, a0) { const P = []; for (let k = 0; k < n; k++) { const a = (a0 || 0) + k * TAU / n; P.push([R4(cx + r * Math.cos(a)), R4(cy + r * Math.sin(a))]); } return P; }
  const loopsOf = o => (isShape(o) ? o.shape : [rectLoop(o.w, o.h, o.r)]);

  /** the arc from p to q with bulge b: { cx, cy, r, a0, sw } (sw: the signed sweep) */
  function arcOf(x1, y1, x2, y2, b) {
    const ux = x2 - x1, uy = y2 - y1, c = Math.hypot(ux, uy), d = c / 2, k = d * (1 - b * b) / (2 * b);
    const cx = (x1 + x2) / 2 - uy / c * k, cy = (y1 + y2) / 2 + ux / c * k;
    return { cx, cy, r: d * (1 + b * b) / (2 * Math.abs(b)), a0: Math.atan2(y1 - cy, x1 - cx), sw: 4 * Math.atan(b) };
  }
  /** a loop's segments: { t: "L" | "A", x1, y1, x2, y2, loop, i } and for an arc cx, cy, r, a0, sw */
  function loopSegs(loop, li) {
    const out = [];
    loop.forEach((p, i) => {
      const q = loop[(i + 1) % loop.length], b = +p[2] || 0, s = { t: "L", x1: p[0], y1: p[1], x2: q[0], y2: q[1], loop: li || 0, i };
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9) return;
      if (Math.abs(b) > 1e-9) Object.assign(s, { t: "A" }, arcOf(p[0], p[1], q[0], q[1], b));
      out.push(s);
    });
    return out;
  }
  const cache = new WeakMap();
  function geom(o) {
    const key = isShape(o) ? o.shape : null;
    if (key && cache.has(key)) return cache.get(key);
    const loops = loopsOf(o), g = { loops, segs: [].concat(...loops.map(loopSegs)), polys: new Map() };
    if (key) cache.set(key, g);
    return g;
  }
  const segs = o => geom(o).segs;
  // where an angle falls along an arc: 0..|sw| when on it
  const along = (s, ang) => { const t = s.sw > 0 ? ang - s.a0 : s.a0 - ang; return ((t % TAU) + TAU) % TAU; };
  const onArc = (s, ang) => along(s, ang) <= Math.abs(s.sw) + 1e-12;
  const arcPt = (s, t) => { const a = s.a0 + s.sw * t; return [s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)]; };
  const segMid = s => (s.t === "A" ? arcPt(s, 0.5) : [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2]);
  const segLen = s => (s.t === "A" ? Math.abs(s.sw) * s.r : Math.hypot(s.x2 - s.x1, s.y2 - s.y1));

  // a segment's points from its start up to (not with) its end, an arc in steps no further than tol from the
  // curve; its rightmost, leftmost, top and bottom points are among them, so the polygon is as big as the arc
  function segPts(s, tol) {
    const pts = [[R4(s.x1), R4(s.y1)]];
    if (s.t !== "A") return pts;
    const cuts = [0, 1], A = Math.abs(s.sw);
    for (let k = 0; k < 4; k++) { const t = along(s, k * Math.PI / 2) / A; if (t > 1e-6 && t < 1 - 1e-6) cuts.push(t); }
    cuts.sort((p, q) => p - q);
    const step = Math.min(Math.max(2 * Math.acos(Math.max(0, 1 - (tol || 0.01) / s.r)), 1e-3), Math.PI / 16);
    for (let c = 0; c + 1 < cuts.length; c++) {
      const t0 = cuts[c], t1 = cuts[c + 1], n = Math.max(1, Math.ceil((t1 - t0) * A / step));
      for (let k = c ? 0 : 1; k < n; k++) { const p = arcPt(s, t0 + (t1 - t0) * k / n); pts.push([R4(p[0]), R4(p[1])]); }
    }
    return pts;
  }
  /** the outline traced on a canvas context (or a Path2D): fill it "evenodd", so cut-outs stay open */
  function trace(o, c) {
    geom(o).loops.forEach(loop => {
      loopSegs(loop).forEach((s, i) => { if (!i) c.moveTo(s.x1, s.y1); if (s.t === "A") c.arc(s.cx, s.cy, s.r, s.a0, s.a0 + s.sw, s.sw < 0); else c.lineTo(s.x2, s.y2); });
      c.closePath();
    });
  }
  /** the outline as an SVG path (fill-rule evenodd) */
  function svgPath(o) {
    const f = v => +(+v).toFixed(4);
    return geom(o).loops.map(loop => loopSegs(loop).map((s, i) => (i ? "" : `M${f(s.x1)} ${f(s.y1)}`) + (s.t === "A" ? `A${f(s.r)} ${f(s.r)} 0 ${Math.abs(s.sw) > Math.PI ? 1 : 0} ${s.sw > 0 ? 1 : 0} ${f(s.x2)} ${f(s.y2)}` : `L${f(s.x2)} ${f(s.y2)}`)).join("") + "Z").join("");
  }
  /** a loop as a polygon, its arcs in steps no further than tol from the true curve */
  const tessellate = (loop, tol) => [].concat(...loopSegs(loop).map(s => segPts(s, tol)));
  /** every loop of the outline as a polygon (the edge first) */
  function polys(o, tol) {
    const g = geom(o), k = tol || 0.01;
    if (!g.polys.has(k)) g.polys.set(k, g.loops.map(l => tessellate(l, k)));
    return g.polys.get(k);
  }
  const poly = (o, tol) => polys(o, tol)[0];
  const polyArea = P => { let s = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += P[j][0] * P[i][1] - P[i][0] * P[j][1]; return s / 2; };
  /** a loop's signed area, exactly: its corners' polygon and each arc's segment */
  const loopArea = loop => loopSegs(loop).reduce((a, s) => a + (s.x1 * s.y2 - s.x2 * s.y1) / 2 + (s.t === "A" ? Math.sign(s.sw) * s.r * s.r / 2 * (Math.abs(s.sw) - Math.sin(Math.abs(s.sw))) : 0), 0);
  /** the board's area (cut-outs taken off), mm² */
  const area = o => loopsOf(o).reduce((s, l, i) => s + (i ? -1 : 1) * Math.abs(loopArea(l)), 0);
  const perimeter = o => segs(o).reduce((s, q) => s + segLen(q), 0);

  /** the box round loops: [x1, y1, x2, y2] (arcs at their true extent) */
  function bbox(loops) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
    loops.forEach(l => loopSegs(l).forEach(s => {
      add(s.x1, s.y1); add(s.x2, s.y2);
      if (s.t === "A") for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; if (onArc(s, a)) add(s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)); }
    }));
    return [x1, y1, x2, y2];
  }

  // ---------------------------------------------------------------------------
  // Inside, and the distance from the edge
  // ---------------------------------------------------------------------------
  const lineDist = (s, x, y) => { const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / l2)) : 0; return Math.hypot(x - s.x1 - t * dx, y - s.y1 - t * dy); };
  function segDist(s, x, y) {
    if (s.t !== "A") return lineDist(s, x, y);
    if (onArc(s, Math.atan2(y - s.cy, x - s.cx))) return Math.abs(Math.hypot(x - s.cx, y - s.cy) - s.r);
    return Math.min(Math.hypot(x - s.x1, y - s.y1), Math.hypot(x - s.x2, y - s.y2));
  }
  /** on the board (inside the edge, in no cut-out): crossings of a ray to the right, even-odd */
  function inside(o, x, y) {
    const S = segs(o); let n = 0;
    y += 1.37e-7;   // off every corner and tangent point
    for (let k = 0; k < S.length; k++) {
      const s = S[k];
      if (s.t !== "A") { if ((s.y1 > y) !== (s.y2 > y) && x < (s.x2 - s.x1) * (y - s.y1) / (s.y2 - s.y1) + s.x1) n++; continue; }
      const dy = y - s.cy; if (Math.abs(dy) >= s.r) continue;
      const dx = Math.sqrt(s.r * s.r - dy * dy);
      if (s.cx + dx > x && onArc(s, Math.atan2(dy, dx))) n++;
      if (s.cx - dx > x && onArc(s, Math.atan2(dy, -dx))) n++;
    }
    return (n & 1) === 1;
  }
  /** signed distance from the nearest edge (a cut-out's too), positive on the board */
  function dist(o, x, y) {
    const S = segs(o); let m = Infinity;
    for (let k = 0; k < S.length; k++) { const d = segDist(S[k], x, y); if (d < m) m = d; }
    return inside(o, x, y) ? m : -m;
  }
  /** the segment nearest to a point: { s, k, d } */
  function nearest(o, x, y) {
    const S = segs(o); let best = null;
    S.forEach((s, k) => { const d = segDist(s, x, y); if (!best || d < best.d) best = { s, k, d }; });
    return best;
  }

  // ---------------------------------------------------------------------------
  // For the outputs
  // ---------------------------------------------------------------------------
  /** the pieces of a polyline at least `inset` inside the board: [[[x, y]...]...] */
  function clipPolyline(o, pts, inset) {
    const out = [], e = inset || 0, f = (x, y) => dist(o, x, y) - e;
    let cur = null;
    for (let k = 1; k < pts.length; k++) {
      const [x1, y1] = pts[k - 1], [x2, y2] = pts[k], len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(len / 0.25));
      const at = t => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
      // where the sign changes between two samples (bisection)
      const cut = (ta, tb, ina) => { for (let i = 0; i < 24; i++) { const tm = (ta + tb) / 2, p = at(tm); if ((f(p[0], p[1]) >= 0) === ina) ta = tm; else tb = tm; } const p = at(ina ? ta : tb); return [R4(p[0]), R4(p[1])]; };
      let tin = f(x1, y1) >= 0;
      if (tin && !cur) { cur = [[R4(x1), R4(y1)]]; out.push(cur); }
      if (!tin) cur = null;
      for (let i = 1; i <= n; i++) {
        const t = i / n, p = at(t), now = f(p[0], p[1]) >= 0;
        if (now !== tin) {
          const c = cut((i - 1) / n, t, tin);
          if (tin) { cur.push(c); cur = null; } else { cur = [c]; out.push(cur); }
          tin = now;
        }
      }
      if (tin) cur.push([R4(x2), R4(y2)]);
    }
    return out.filter(l => l.length >= 2 && l.some((p, i) => i && Math.hypot(p[0] - l[0][0], p[1] - l[0][1]) > 1e-4));
  }
  /** everything outside the edge as one polygon: a frame m mm round the box with the edge cut out of it
      (joined by a slit straight up from the edge's topmost point, which nothing can cross) */
  function outside(o, m, tol) {
    const P = poly(o, tol || 0.02), M = m || 2;
    let k = 0; P.forEach((p, i) => { if (p[1] < P[k][1] - 1e-9 || (Math.abs(p[1] - P[k][1]) <= 1e-9 && p[0] < P[k][0])) k = i; });
    const A = [P[k][0], -M], ring = [];
    for (let i = 0; i <= P.length; i++) ring.push(P[(k - i + 2 * P.length) % P.length]);   // the edge backwards, from its top point round to it again
    return [A, [o.w + M, -M], [o.w + M, o.h + M], [-M, o.h + M], [-M, -M], A, ...ring];
  }
  /** the segments d mm inside the board (lines moved over, mitred where two meet; arcs on their own
      centres): the same list as segs(), null where nothing is left */
  function offsetSegs(o, d) {
    const S = segs(o).map(s => {
      if (s.t === "A") { const r = s.sw > 0 ? s.r - d : s.r + d; return r > 1e-6 ? { ...s, r, x1: s.cx + r * Math.cos(s.a0), y1: s.cy + r * Math.sin(s.a0), x2: s.cx + r * Math.cos(s.a0 + s.sw), y2: s.cy + r * Math.sin(s.a0 + s.sw) } : null; }
      const l = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), nx = -(s.y2 - s.y1) / l * d, ny = (s.x2 - s.x1) / l * d;
      return { ...s, x1: s.x1 + nx, y1: s.y1 + ny, x2: s.x2 + nx, y2: s.y2 + ny };
    });
    const src = segs(o);
    src.forEach((s, k) => {
      const j = src.findIndex(q => q.loop === s.loop && q.i === (s.i + 1) % geom(o).loops[s.loop].length), a = S[k], b = j >= 0 ? S[j] : null;
      if (!a || !b || a.t !== "L" || b.t !== "L" || j === k) return;
      const dx = a.x2 - a.x1, dy = a.y2 - a.y1, ex = b.x2 - b.x1, ey = b.y2 - b.y1, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) return;
      const t = ((b.x1 - a.x1) * ey - (b.y1 - a.y1) * ex) / den, x = a.x1 + t * dx, y = a.y1 + t * dy;
      a.x2 = x; a.y2 = y; b.x1 = x; b.y1 = y;
    });
    return S;
  }

  /** the bulge of the arc from p to q that passes through m (0: the three are in line) */
  function bulge3(p, q, m) {
    const cr = (q[0] - p[0]) * (m[1] - p[1]) - (q[1] - p[1]) * (m[0] - p[0]);
    const a = [p[0] - m[0], p[1] - m[1]], b = [q[0] - m[0], q[1] - m[1]], la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
    if (la < 1e-9 || lb < 1e-9 || Math.abs(cr) < 1e-9) return 0;
    const g = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb))));
    return -Math.sign(cr) * Math.tan((Math.PI - g) / 2);
  }

  // ---------------------------------------------------------------------------
  // Making a shape
  // ---------------------------------------------------------------------------
  const reverseLoop = loop => loop.map((p, i) => { const q = loop[(i + 1) % loop.length], b = -(+p[2] || 0); return b ? [q[0], q[1], b] : [q[0], q[1]]; }).reverse();
  const moveLoop = (loop, dx, dy) => loop.map(p => (p[2] ? [R4(p[0] + dx), R4(p[1] + dy), p[2]] : [R4(p[0] + dx), R4(p[1] + dy)]));
  /** loops made a shape: the edge turned so the board is on its left, the cut-outs the other way, all
      moved so the edge's box starts at 0, 0. → { shape, w, h, dx, dy } (dx, dy: how far it was moved) */
  function normalise(loops) {
    const turned = loops.map((l, i) => ((loopArea(l) > 0) === (i === 0) ? l : reverseLoop(l)));
    const [x1, y1, x2, y2] = bbox([turned[0]]);
    return { shape: turned.map(l => moveLoop(l, -x1, -y1)), w: R4(x2 - x1), h: R4(y2 - y1), dx: R4(-x1), dy: R4(-y1) };
  }
  /** { w, h, r } when a shape is just the rectangle (its corners rounded alike) the box holds, else null */
  function asRect(shape, w, h) {
    if (shape.length !== 1) return null;
    const S = loopSegs(shape[0]), arcs = S.filter(s => s.t === "A"), r = arcs.length ? arcs[0].r : 0;
    if (arcs.length && arcs.length !== 4) return null;
    const want = loopSegs(rectLoop(w, h, r));
    if (want.length !== S.length) return null;
    const same = (a, b) => Math.abs(a - b) < 1e-3, mid = s => segMid(s);
    const ok = S.every(s => want.some(q => q.t === s.t && ((same(q.x1, s.x1) && same(q.y1, s.y1) && same(q.x2, s.x2) && same(q.y2, s.y2)) || (same(q.x1, s.x2) && same(q.y1, s.y2) && same(q.x2, s.x1) && same(q.y2, s.y1))) && same(mid(q)[0], mid(s)[0]) && same(mid(q)[1], mid(s)[1])));
    return ok ? { w, h, r: R4(r) } : null;
  }

  // ---------------------------------------------------------------------------
  // The sketch: loose entities → loops
  //   { t: "L", x1, y1, x2, y2 }   { t: "A", x1, y1, x2, y2, b }   { t: "C", cx, cy, r }
  // ---------------------------------------------------------------------------
  /** an outline's loops as sketch entities (a round cut-out or board: one circle) */
  function toEntities(o) {
    const out = [];
    loopsOf(o).forEach(loop => {
      const S = loopSegs(loop);
      if (S.length === 2 && S.every(s => s.t === "A") && Math.hypot(S[0].cx - S[1].cx, S[0].cy - S[1].cy) < 1e-4 && Math.abs(S[0].r - S[1].r) < 1e-4) { out.push({ t: "C", cx: R4(S[0].cx), cy: R4(S[0].cy), r: R4(S[0].r) }); return; }
      loop.forEach((p, i) => { const q = loop[(i + 1) % loop.length], b = +p[2] || 0; if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9) out.push(b ? { t: "A", x1: p[0], y1: p[1], x2: q[0], y2: q[1], b } : { t: "L", x1: p[0], y1: p[1], x2: q[0], y2: q[1] }); });
    });
    return out;
  }
  const cross = (a, b, c, d) => {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]), E = 1e-9;
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    return ((d1 > E && d2 < -E) || (d1 < -E && d2 > E)) && ((d3 > E && d4 < -E) || (d3 < -E && d4 > E));
  };
  // a corner of one lying on the other (edges that are not neighbours may not even touch)
  const touch = (p, q) => { const d = (s, pt) => lineDist({ x1: s.a[0], y1: s.a[1], x2: s.b[0], y2: s.b[1] }, pt[0], pt[1]); return Math.min(d(p, q.a), d(p, q.b), d(q, p.a), d(q, p.b)) < 1e-6; };
  /** entities chained into closed loops and checked.
      → { shape, w, h, dx, dy, ents: [[entity index per vertex]...] } or { error, at: [[x, y]...] } */
  function fromEntities(ents, tol) {
    const T = tol || 0.01, nodes = [], edges = [], loops = [], lents = [];
    const node = (x, y) => { let k = nodes.findIndex(n => Math.hypot(n.x - x, n.y - y) <= T); if (k < 0) { k = nodes.length; nodes.push({ x, y, e: [] }); } return k; };
    ents.forEach((e, i) => {
      if (e.t === "C") { if (e.r > T) { loops.push(circleLoop(e.cx, e.cy, e.r)); lents.push([i, i]); } return; }
      const a = node(e.x1, e.y1), b = node(e.x2, e.y2);
      if (a === b) return;   // too short to count
      const ed = { a, b, bl: e.t === "A" ? +e.b || 0 : 0, i, used: false }; edges.push(ed); nodes[a].e.push(ed); nodes[b].e.push(ed);
    });
    if (!edges.length && !loops.length) return { error: "The sketch is empty: draw a closed shape", at: [] };
    const open = nodes.filter(n => n.e.length === 1), fork = nodes.filter(n => n.e.length > 2);
    if (open.length) return { error: `The outline is not closed: ${open.length} loose end${open.length > 1 ? "s" : ""} (marked red). Join each end to another`, at: open.map(n => [n.x, n.y]) };
    if (fork.length) return { error: "More than two lines meet at a point (marked red): an outline cannot branch", at: fork.map(n => [n.x, n.y]) };
    edges.forEach(e0 => {
      if (e0.used) return;
      const L = [], li = []; let at = e0.a, e = e0;
      for (;;) {
        e.used = true;
        const fw = e.a === at, n = nodes[at]; L.push(e.bl ? [R4(n.x), R4(n.y), fw ? e.bl : -e.bl] : [R4(n.x), R4(n.y)]); li.push(e.i);
        at = fw ? e.b : e.a;
        const nx = nodes[at].e.find(q => !q.used);
        if (!nx) break;
        e = nx;
      }
      loops.push(L); lents.push(li);
    });
    // each loop a real area, no edge crossing another
    const P = loops.map(l => tessellate(l, 0.01)), A = P.map(polyArea);
    // every polygon edge with the entity it came from
    const E = [];
    loops.forEach((l, li) => {
      const S = loopSegs(l);
      S.forEach((s, si) => { const pts = segPts(s, 0.01).concat([[R4(s.x2), R4(s.y2)]]); for (let k = 0; k + 1 < pts.length; k++) E.push({ a: pts[k], b: pts[k + 1], li, si, n: S.length }); });
    });
    for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
      const p = E[i], q = E[j];
      if (p.li === q.li && (p.si === q.si || (p.si + 1) % p.n === q.si || (q.si + 1) % q.n === p.si)) continue;
      if (cross(p.a, p.b, q.a, q.b) || touch(p, q)) return { error: "The outline crosses itself (marked red)", at: [[(p.a[0] + p.b[0] + q.a[0] + q.b[0]) / 4, (p.a[1] + p.b[1] + q.a[1] + q.b[1]) / 4]] };
    }
    const flat = A.findIndex(a => Math.abs(a) < 0.01);
    if (flat >= 0) return { error: "A part of the sketch encloses no area (marked red)", at: [P[flat][0]] };
    // the largest loop is the edge; every other one a cut-out inside it, and not inside another
    let big = 0; A.forEach((a, i) => { if (Math.abs(a) > Math.abs(A[big])) big = i; });
    const pin = (p, Pl) => { let ins = false; for (let i = 0, j = Pl.length - 1; i < Pl.length; j = i++) { const [xi, yi] = Pl[i], [xj, yj] = Pl[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
    for (let i = 0; i < loops.length; i++) {
      if (i === big) continue;
      if (!pin(P[i][0], P[big])) return { error: "A shape lies outside the board's edge (marked red): a board is one piece. Put it inside as a cut-out, or delete it", at: [P[i][0]] };
      for (let j = 0; j < loops.length; j++) if (j !== i && j !== big && pin(P[i][0], P[j])) return { error: "A cut-out lies inside another cut-out (marked red)", at: [P[i][0]] };
    }
    const order = [big, ...loops.map((_, i) => i).filter(i => i !== big)];
    // a turned loop's vertices are those of the reversed list: its entities turn with it
    const n = normalise(order.map(i => loops[i]));
    const entsOut = order.map((i, k) => ((polyArea(P[i]) > 0) === (k === 0) ? lents[i] : lents[i].slice().reverse()));
    if (n.w < 2 || n.h < 2) return { error: "The board is too small (under 2 mm)", at: [] };
    return { ...n, ents: entsOut };
  }
  /** a board outline from a sketch result (a plain rectangle goes back to { w, h, r }) */
  function outlineOf(res) { const r = asRect(res.shape, res.w, res.h); return r ? r : { w: res.w, h: res.h, r: 0, shape: res.shape }; }
  /** a round board of diameter d */
  const circleOutline = d => ({ w: d, h: d, r: 0, shape: [circleLoop(d / 2, d / 2, d / 2)] });
  /** a short description: "rectangle", "round Ø60", "custom shape, 2 cut-outs" */
  function describe(o) {
    if (!isShape(o)) return `${o.w} × ${o.h} mm${o.r ? `, corners R${o.r}` : ""}`;
    const E = toEntities({ shape: [o.shape[0]] }), cuts = o.shape.length - 1, c = cuts ? `, ${cuts} cut-out${cuts > 1 ? "s" : ""}` : "";
    const f = v => +(+v).toFixed(2);
    if (E.length === 1 && E[0].t === "C") return `round Ø${f(2 * E[0].r)} mm${c}`;
    return `custom shape ${f(o.w)} × ${f(o.h)} mm${c}`;
  }

  root.BoardOutline = { Q, isShape, rectLoop, circleLoop, polygonLoop, loopsOf, arcOf, bulge3, loopSegs, segs, segMid, segLen, arcPt, onArc, tessellate, trace, svgPath, polys, poly, polyArea, loopArea, area, perimeter, bbox, inside, dist, segDist, nearest, clipPolyline, outside, offsetSegs, reverseLoop, moveLoop, normalise, asRect, toEntities, fromEntities, outlineOf, circleOutline, describe };
})(typeof window !== "undefined" ? window : globalThis);
