/* =============================================================================
   BOARD DESIGN — smart measure: what one clicked thing is (a pad's size and drill, a via's
   ring, a hole's diameter, a track's width and length, the board's size) and what relates
   two of them (pitch centre to centre, copper edge to edge against the clearance rule, centre
   to a track or the board edge square to it, the gap between parallel tracks, the angle
   between two segments). Pure geometry: the Board window snaps the clicks onto entities
   and draws the result; the 3D view measures its own way (board-3d-view.js).
   Entities: { kind: point | pad | via | hole | track | edge, p: [x, y] (where it stuck), what,
   pad | via | hole, seg: [x1, y1, x2, y2] (a track's segment or a board edge), track, net }
   Results: { title, value, vtype, prefix, rows: [[label, type, value]], lines, aux, at, modes, mode, ok }
   Board coordinates are mm with y down; shown y counts up from the board's bottom edge.
   ============================================================================= */
(function (root) {
  "use strict";
  const hyp = Math.hypot, EPS = 1e-6;

  // closest points of two segments (each may be a point): { d, a, b }
  function closest(s1, s2) {
    const [px, py, qx, qy] = s1, [rx, ry, sx, sy] = s2;
    const d1x = qx - px, d1y = qy - py, d2x = sx - rx, d2y = sy - ry, wx = px - rx, wy = py - ry;
    const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * wx + d2y * wy;
    const cl = v => Math.max(0, Math.min(1, v));
    let s = 0, t = 0;
    if (a < 1e-18 && e < 1e-18) { s = t = 0; }
    else if (a < 1e-18) { t = cl(f / e); }
    else {
      const c = d1x * wx + d1y * wy;
      if (e < 1e-18) s = cl(-c / a);
      else {
        const b = d1x * d2x + d1y * d2y, den = a * e - b * b;
        s = den > 1e-18 ? cl((b * f - c * e) / den) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = cl(-c / a); } else if (t > 1) { t = 1; s = cl((b - c) / a); }
      }
    }
    // crossing segments: they touch
    const A = [px + d1x * s, py + d1y * s], B = [rx + d2x * t, ry + d2y * t];
    return { d: hyp(A[0] - B[0], A[1] - B[1]), a: A, b: B };
  }
  // the foot of point c on the infinite line through seg, and whether it falls on the segment
  function foot(c, seg) {
    const [ax, ay, bx, by] = seg, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? ((c[0] - ax) * dx + (c[1] - ay) * dy) / L2 : 0, f = [ax + t * dx, ay + t * dy];
    return { f, d: hyp(c[0] - f[0], c[1] - f[1]), on: t >= -EPS && t <= 1 + EPS, end: t < 0 ? [ax, ay] : [bx, by] };
  }
  const capsule = p => (root.BoardCore ? root.BoardCore.padCapsule(p) : (() => {
    const r = Math.min(p.w, p.h) / 2, l = Math.max(p.w, p.h) / 2 - r, hz = p.w >= p.h;
    return { s: hz ? [p.x - l, p.y, p.x + l, p.y] : [p.x, p.y - l, p.x, p.y + l], r: p.shape === "rect" ? r * 1.15 : r };
  })());
  const ringOf = h => (h.pad > h.d ? h.pad : +(h.d + 2.8).toFixed(3));
  // its outline for distances (copper, or the drilled wall of a bare hole) and its drill
  function shape(e, env) {
    const R = (env && env.rules) || {};
    if (e.kind === "pad") { const c = capsule(e.pad); return { s: c.s, r: c.r, drill: e.pad.smd ? 0 : e.pad.drill || 0, copper: true }; }
    if (e.kind === "via") { const v = e.via; return { s: [v.x, v.y, v.x, v.y], r: (v.pad || R.viaPad || 1.2) / 2, drill: v.drill || R.viaDrill || 0.6, copper: true }; }
    if (e.kind === "hole") { const h = e.hole; return { s: [h.x, h.y, h.x, h.y], r: (h.plated ? ringOf(h) : h.d) / 2, drill: h.d, copper: !!h.plated }; }
    if (e.kind === "track") return { s: e.seg, r: e.track.w / 2, drill: 0, copper: true };
    if (e.kind === "edge") return { s: e.seg, r: 0, drill: 0, copper: false };
    return { s: [e.p[0], e.p[1], e.p[0], e.p[1]], r: 0, drill: 0, copper: false };
  }
  const centred = e => e.kind === "pad" || e.kind === "via" || e.kind === "hole";
  const linear = e => e.kind === "track" || e.kind === "edge";
  const centre = e => (e.kind === "pad" ? [e.pad.x, e.pad.y] : e.kind === "via" ? [e.via.x, e.via.y] : e.kind === "hole" ? [e.hole.x, e.hole.y] : e.p);
  const segLen = s => hyp(s[2] - s[0], s[3] - s[1]);
  // shown angle of a direction, y up, in degrees
  const angOf = (dx, dy) => Math.atan2(-dy, dx) * 180 / Math.PI;
  const deltas = (a, b) => [["Δx", "len", b[0] - a[0]], ["Δy", "len", -(b[1] - a[1]) || 0], ["Direction", "ang", hyp(b[0] - a[0], b[1] - a[1]) ? angOf(b[0] - a[0], b[1] - a[1]) : 0]];
  const trackLen = t => t.pts.reduce((s, p, k) => (k ? s + hyp(p[0] - t.pts[k - 1][0], p[1] - t.pts[k - 1][1]) : 0), 0);
  const netRow = (e, env) => (e.net !== null && e.net !== undefined && env && env.netName ? [["Net", "text", env.netName(e.net)]] : []);

  // ---------------------------------------------------------------------------
  // one thing: its size
  // ---------------------------------------------------------------------------
  function single(e, env) {
    const o = (env && env.outline) || { w: 0, h: 0 }, out = (title, value, vtype, rows, extra) => ({ title, value, vtype, prefix: "", rows, lines: [], aux: [], at: e.p, ...(extra || {}) });
    if (e.kind === "pad") {
      const p = e.pad, rows = [["Size", "size", [p.w, p.h]], ["Shape", "text", p.shape === "rect" ? "square / rectangle" : p.w === p.h ? "round" : "oblong"]];
      if (!p.smd && p.drill) rows.push(["Drill", "len", p.drill], ["Annular ring", "len", (Math.min(p.w, p.h) - p.drill) / 2]);
      rows.push(["Mount", "text", p.smd ? `SMD, ${(p.layers || [])[0] === "B.Cu" ? "bottom" : "top"}` : "through hole, both layers"], ...netRow(e, env), ["Centre", "pos", [p.x, p.y]]);
      return out(`Pad ${p.ref}-${p.num}`, [p.w, p.h], "size", rows);
    }
    if (e.kind === "via") {
      const s = shape(e, env), rows = [["Drill", "len", s.drill], ["Pad", "len", 2 * s.r], ["Annular ring", "len", s.r - s.drill / 2], ...netRow(e, env), ["Centre", "pos", [e.via.x, e.via.y]]];
      return out("Via", 2 * s.r, "len", rows, { prefix: "Ø " });
    }
    if (e.kind === "hole") {
      const h = e.hole, rows = [["Drill", "len", h.d]];
      if (h.plated) rows.push(["Copper ring", "len", ringOf(h)]);
      const ed = Math.min(h.x, h.y, o.w - h.x, o.h - h.y);
      if (o.w) rows.push(["Centre to the nearest board edge", "len", ed], ["Rim to the nearest board edge", "len", ed - h.d / 2]);
      rows.push(["Centre", "pos", [h.x, h.y]]);
      return out(h.part ? `Hole of ${h.ref || "a part"}` : h.plated ? "Plated mounting hole" : "Mounting hole", h.d, "len", rows, { prefix: "Ø " });
    }
    if (e.kind === "track") {
      const s = e.seg, t = e.track, L = segLen(s);
      const rows = [["Width", "len", t.w], ["Segment angle", "ang", angOf(s[2] - s[0], s[3] - s[1])], ["Whole track", "len", trackLen(t)], ["Corners", "text", String(Math.max(0, t.pts.length - 2))], ["Layer", "text", t.layer === "B.Cu" ? "bottom (B.Cu)" : "top (F.Cu)"], ...netRow(e, env)];
      return out("Track segment", L, "len", rows, { aux: [s] });
    }
    if (e.kind === "edge") {
      const rows = [["Width × height", "size", [o.w, o.h]], ["Area", "area", o.w * o.h / 100], ["This edge", "len", segLen(e.seg)]];
      return out("Board", [o.w, o.h], "size", rows);
    }
    const rows = [["Position", "pos", e.p]];
    if (e.track) rows.push(["Track width", "len", e.track.w], ["Whole track", "len", trackLen(e.track)]);
    return out(e.what && e.what !== "grid" ? e.what[0].toUpperCase() + e.what.slice(1) : "Point", null, "none", rows);
  }

  // the copper gap (or the drilled wall's, or to the board edge) between two things, with the rule
  function gapCheck(A, B, sa, sb, cl, env) {
    const rows = [], gap = cl.d - sa.r - sb.r;
    if (sa.copper && sb.copper) {
      const same = A.net !== null && A.net !== undefined && A.net === B.net;
      rows.push([gap < 0 ? "Copper overlaps by" : "Copper edge to edge", "len", Math.abs(gap)]);
      if (same) rows.push(["Clearance rule", "text", "same net: none needed"]);
      else if (env && env.need) { const n = env.need(A.net, B.net); rows.push(["Clearance rule", "check", { gap, need: n.c, note: n.ipc ? `IPC-2221B, ${Math.round(n.v)} V between them` : "" }]); return { rows, gap, ok: gap >= n.c - EPS }; }
      return { rows, gap };
    }
    const edge = A.kind === "edge" ? sb : B.kind === "edge" ? sa : null;
    if (edge && edge.copper) {
      rows.push([gap < 0 ? "Copper past the board edge by" : "Copper to the board edge", "len", Math.abs(gap)]);
      const need = env && env.rules ? env.rules.edgeClearance : null;
      if (need !== null && need !== undefined) { rows.push(["Edge clearance rule", "check", { gap, need }]); return { rows, gap, ok: gap >= need - EPS }; }
      return { rows, gap };
    }
    const bare = (A.kind === "hole" && !sa.copper) ? [A, sb] : (B.kind === "hole" && !sb.copper) ? [B, sa] : null;
    if (bare && bare[1].copper) {
      const other = bare[0] === A ? B : A;
      rows.push([gap < 0 ? "Copper over the hole by" : "Copper to the hole's wall", "len", Math.abs(gap)]);
      if (env && env.toChassis) { const n = env.toChassis(other.net); rows.push(["Clearance rule", "check", { gap, need: n.c, note: "the screw is at chassis potential" }]); return { rows, gap, ok: gap >= n.c - EPS }; }
    }
    return { rows, gap };
  }
  // the ends of the shortest line between the outlines (cl between the cores, minus each radius)
  function rimLine(cl, ra, rb) {
    const dx = cl.b[0] - cl.a[0], dy = cl.b[1] - cl.a[1], L = hyp(dx, dy) || 1, ux = dx / L, uy = dy / L;
    return [cl.a[0] + ux * ra, cl.a[1] + uy * ra, cl.b[0] - ux * rb, cl.b[1] - uy * rb];
  }
  const sameThing = (A, B) => A.kind === B.kind && (A.kind === "pad" ? A.pad === B.pad : A.kind === "via" ? A.via === B.via : A.kind === "hole" ? A.hole === B.hole : A.kind === "track" ? A.track === B.track && A.seg.join() === B.seg.join() : A.kind === "edge" ? A.seg.join() === B.seg.join() : false);
  const MODES = ["centre", "min", "max"];

  // ---------------------------------------------------------------------------
  // two things: what relates them. mode: centre | min (edge to edge) | max (outer span)
  // ---------------------------------------------------------------------------
  function pair(A, B, env, mode) {
    if (sameThing(A, B)) return single(A, env);
    const sa = shape(A, env), sb = shape(B, env), cl = closest(sa.s, sb.s), names = ["Between", "text", `${A.what} → ${B.what}`];
    const res = (title, value, rows, lines, extra) => ({ title, value, vtype: "len", prefix: "", rows: rows.concat([names]), lines, aux: [], at: lines.length ? [(lines[0][0] + lines[0][2]) / 2, (lines[0][1] + lines[0][3]) / 2] : B.p, ...(extra || {}) });

    // pads, vias, holes: pitch centre to centre, edge to edge, outer span
    if (centred(A) && centred(B)) {
      const ca = centre(A), cb = centre(B), L = hyp(cb[0] - ca[0], cb[1] - ca[1]);
      const g = gapCheck(A, B, sa, sb, cl, env), ux = L ? (cb[0] - ca[0]) / L : 1, uy = L ? (cb[1] - ca[1]) / L : 0;
      // how far each outline reaches along the line between the centres
      const reach = (s, c, sgn) => s.r + Math.max(...[[s.s[0], s.s[1]], [s.s[2], s.s[3]]].map(q => sgn * ((q[0] - c[0]) * ux + (q[1] - c[1]) * uy)));
      const span = L + reach(sa, ca, -1) + reach(sb, cb, 1);
      const rows = [["Centre to centre (pitch)", "len", L], ...deltas(ca, cb)];
      rows.push(...g.rows);
      if (!(sa.copper && sb.copper) && !g.rows.length) rows.push([g.gap < 0 ? "Overlap" : "Edge to edge", "len", Math.abs(g.gap)]);
      if (sa.drill && sb.drill) rows.push(["Drill wall to wall", "len", L - sa.drill / 2 - sb.drill / 2]);
      rows.push(["Outer span", "len", span]);
      const m = MODES.includes(mode) ? mode : "centre";
      if (m === "min") return res(g.gap < 0 ? "Edge to edge (overlap)" : "Edge to edge", g.gap, rows, [rimLine(cl, sa.r, sb.r)], { modes: MODES, mode: m, ok: g.ok });
      if (m === "max") return res("Outer span", span, rows, [[ca[0] - ux * reach(sa, ca, -1), ca[1] - uy * reach(sa, ca, -1), cb[0] + ux * reach(sb, cb, 1), cb[1] + uy * reach(sb, cb, 1)]], { modes: MODES, mode: m, ok: g.ok });
      return res("Pitch (centre to centre)", L, rows, [[ca[0], ca[1], cb[0], cb[1]]], { modes: MODES, mode: m, ok: g.ok, legs: [ca, cb] });
    }

    // a centre or a point against a track or the board edge: square to it
    const pt = centred(A) || A.kind === "point" ? A : centred(B) || B.kind === "point" ? B : null, ln = pt === A ? B : A;
    if (pt && linear(ln)) {
      const c = centre(pt), F = foot(c, ln.seg), g = gapCheck(pt, ln, shape(pt, env), shape(ln, env), closest(shape(pt, env).s, ln.seg), env);
      const what = ln.kind === "edge" ? "board edge" : "track";
      const rows = [[centred(pt) ? `Centre to the ${what}` : `Square to the ${what}`, "len", F.d], ["Foot", "text", F.on ? `on the ${ln.kind === "edge" ? "edge" : "segment"}` : "on the line past its end"], ["Foot at", "pos", F.f]];
      rows.push(...g.rows);
      const sh = closest([c[0], c[1], c[0], c[1]], ln.seg);
      if (Math.abs(sh.d - F.d) > 1e-4) rows.push(["Shortest distance", "len", sh.d]);
      const aux = F.on ? [] : [[F.f[0], F.f[1], F.end[0], F.end[1]]];
      const m = centred(pt) && g.rows.length ? (mode === "min" ? "min" : "centre") : null;
      if (m === "min") { const cl2 = closest(shape(pt, env).s, ln.seg); return { ...res(`${pt.kind === "via" ? "Via" : pt.kind === "pad" ? "Pad" : "Hole"} to the ${what}, edge to edge`, g.gap, rows, [rimLine(cl2, shape(pt, env).r, shape(ln, env).r)]), aux, modes: ["centre", "min"], mode: m, ok: g.ok }; }
      return { ...res(centred(pt) ? `Centre to the ${what}` : `Point to the ${what}`, F.d, rows, [[c[0], c[1], F.f[0], F.f[1]]]), aux, ...(m ? { modes: ["centre", "min"], mode: m } : {}), ok: g.ok };
    }

    // two tracks or edges: parallel gap, or the angle between them
    if (linear(A) && linear(B)) {
      const a = A.seg, b = B.seg, la = segLen(a) || 1, lb = segLen(b) || 1;
      const ua = [(a[2] - a[0]) / la, (a[3] - a[1]) / la], ub = [(b[2] - b[0]) / lb, (b[3] - b[1]) / lb], cross = ua[0] * ub[1] - ua[1] * ub[0];
      const g = gapCheck(A, B, sa, sb, cl, env), both = A.kind === "track" && B.kind === "track" ? "tracks" : A.kind === "edge" && B.kind === "edge" ? "edges" : "";
      if (Math.abs(cross) < 1e-6) {
        const F = foot([a[0], a[1]], b), ma = [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2], mb = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        const along = Math.abs((mb[0] - ma[0]) * ua[0] + (mb[1] - ma[1]) * ua[1]);
        const rows = [[both === "tracks" ? "Centre line to centre line" : "Distance square to them", "len", F.d], ...g.rows, ["Offset along them", "len", along]];
        if (Math.abs(cl.d - F.d) > 1e-4) rows.push(["Shortest distance", "len", cl.d]);
        const Fm = foot(ma, b), title = F.d < 1e-6 ? "In line" : both === "tracks" ? "Parallel tracks" : both === "edges" ? "Parallel edges" : "Parallel to the board edge";
        if (F.d < 1e-6) return res(title, cl.d, rows, [[cl.a[0], cl.a[1], cl.b[0], cl.b[1]]], { ok: g.ok });
        if (mode === "min" && g.rows.length) return res(title + ", edge to edge", g.gap, rows, [rimLine({ a: ma, b: Fm.f }, sa.r, sb.r)], { modes: ["centre", "min"], mode: "min", ok: g.ok });
        return res(title, F.d, rows, [[ma[0], ma[1], Fm.f[0], Fm.f[1]]], g.rows.length ? { modes: ["centre", "min"], mode: "centre", ok: g.ok } : { ok: g.ok });
      }
      let ang = Math.acos(Math.max(-1, Math.min(1, Math.abs(ua[0] * ub[0] + ua[1] * ub[1])))) * 180 / Math.PI;
      // where the two lines cross, on both segments or on their extensions
      const den = ua[0] * ub[1] - ua[1] * ub[0], wx = b[0] - a[0], wy = b[1] - a[1], s = (wx * ub[1] - wy * ub[0]) / den, t = (wx * ua[1] - wy * ua[0]) / den;
      const X = [a[0] + ua[0] * s, a[1] + ua[1] * s], real = s >= -EPS && s <= la + EPS && t >= -EPS && t <= lb + EPS;
      const rows = [["Supplement", "ang", 180 - ang], ["Lines cross at", "pos", X], ["Crossing", "text", real ? "on both" : "on the extension"], ["Shortest distance", "len", cl.d], ...g.rows];
      const far = q => hyp(q[0] - X[0], q[1] - X[1]), endA = far([a[0], a[1]]) > far([a[2], a[3]]) ? [a[0], a[1]] : [a[2], a[3]], endB = far([b[0], b[1]]) > far([b[2], b[3]]) ? [b[0], b[1]] : [b[2], b[3]];
      ang = +ang.toFixed(6);
      return { ...res("Angle", ang, rows, [[endA[0], endA[1], X[0], X[1]], [X[0], X[1], endB[0], endB[1]]]), vtype: "ang", at: X, ok: g.ok };
    }

    // a point and a pad, via or hole, or two points: the distance
    const a = A.kind === "point" ? A.p : centre(A), b = B.kind === "point" ? B.p : centre(B), d = hyp(b[0] - a[0], b[1] - a[1]);
    const rows = [...deltas(a, b)], c = centred(A) ? A : centred(B) ? B : null;
    if (c) rows.push(["From its rim", "len", d - shape(c, env).r]);
    return res("Distance", d, rows, [[a[0], a[1], b[0], b[1]]], { legs: [a, b] });
  }

  // ---------------------------------------------------------------------------
  // formatting: mm, mil or inch; angles in degrees; positions with y up from the board's bottom
  // ---------------------------------------------------------------------------
  const UNITS = { mm: { k: 1, dp: 3, name: "mm" }, mil: { k: 1 / 0.0254, dp: 1, name: "mil" }, in: { k: 1 / 25.4, dp: 4, name: "in" } };
  function len(v, units) {
    const u = UNITS[units] || UNITS.mm, x = v * u.k, dp = units === "mm" || !UNITS[units] ? (Math.abs(x) >= 100 ? 2 : 3) : u.dp;
    return `${(+x.toFixed(dp)).toFixed(dp).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")} ${u.name}`;
  }
  function fmt(v, type, units, oh) {
    if (v === null || v === undefined) return "";
    if (type === "len") return len(v, units);
    if (type === "lens") return v.map(x => len(x, units)).join(" / ");
    if (type === "size") { const u = UNITS[units] || UNITS.mm; return `${len(v[0], units).replace(" " + u.name, "")} × ${len(v[1], units)}`; }
    if (type === "ang") return `${(+v.toFixed(2))}°`;
    if (type === "area") return `${(+v.toFixed(2))} cm²`;
    if (type === "pos") return `X ${len(v[0], units)}, Y ${len((oh || 0) - v[1], units)}`;
    if (type === "check") return v.gap >= v.need - EPS ? `≥ ${len(v.need, units)}: OK${v.note ? " (" + v.note + ")" : ""}` : `≥ ${len(v.need, units)}: ${len(v.need - v.gap, units)} too close${v.note ? " (" + v.note + ")" : ""}`;
    return String(v);
  }
  // the one-line label on the board
  const label = (r, units) => (r.vtype === "none" ? r.title : r.prefix + fmt(r.value, r.vtype, units));

  root.BoardMeasure = { single, pair, fmt, label, closest, foot, UNITS, MODES };
})(typeof window !== "undefined" ? window : globalThis);
