/* =============================================================================
   BOARD DESIGN — high-speed helpers (no DOM, Node-testable): controlled impedance from the
   stack-up, differential pairs, routed lengths, length groups and meanders.
     layerGeom(board, layer) -> { kind: "microstrip" | "stripline", h | h1, h2, t, er }
     impedance(board, layer, w, gap) -> { z0, zdiff, kind, er, h... }   (Ω; gap: a pair's edge gap)
     widthFor(board, layer, z0) / gapFor(board, layer, w, zdiff)        (mm, by bisection)
     netLengths(conn) -> Map(net -> routed mm)
     pairsOf(board, names) / groupsOf(board, names): the rules' pairs and length groups by net id
     drc(board, model, conn) -> [{ kind: "length" | "skew", x, y, msg }]
     offsetPath(pts, d) -> pts: a track's path moved sideways by d (a pair's partner)
     meander(pts, k, extra, o) -> { pts } | { fail }: serpentine on segment k adding extra mm
   Formulas: microstrip by Hammerstad and Jensen (1980) with Wheeler's thickness correction;
   stripline and the edge-coupled differential terms from IPC-2141A. Estimates within a few per
   cent of a field solver for usual FR4 geometry; solder mask (which lowers a microstrip's Z0 by
   2-3 Ω) is not counted. Ask the fab for its stack-up and their numbers for a controlled-impedance
   order.
   ============================================================================= */
(function (root) {
  "use strict";
  const C = () => root.BoardCore;
  // the dielectric thickness between neighbouring copper layers (mm): the stack-up's own list when
  // it has one (stackup.diel), else the board's thickness shared out evenly (as the KiCad export)
  function dielectrics(board) {
    const st = board.stackup || {}, CU = C().copperOf(board), n = CU.length;
    const tOut = (st.copper || 35) / 1000, tIn = (st.innerCopper || st.copper || 35) / 1000, total = st.thickness || 1.6;
    if (Array.isArray(st.diel) && st.diel.length === n - 1 && st.diel.every(v => +v > 0)) return st.diel.map(Number);
    const d = Math.max(0.05, (total - 2 * tOut - (n - 2) * tIn) / (n - 1));
    return Array.from({ length: n - 1 }, () => d);
  }
  function layerGeom(board, layer) {
    const st = board.stackup || {}, CU = C().copperOf(board), i = Math.max(0, CU.indexOf(layer)), D = dielectrics(board);
    const er = st.er > 0 ? +st.er : 4.5, outer = i === 0 || i === CU.length - 1;
    const t = (outer ? st.copper || 35 : st.innerCopper || st.copper || 35) / 1000;
    if (outer) return { kind: "microstrip", h: i === 0 ? D[0] : D[D.length - 1], t, er };
    return { kind: "stripline", h1: D[i - 1], h2: D[i], t, er };
  }
  // microstrip: Hammerstad-Jensen, w widened by the strip's thickness (Wheeler)
  function microstrip(w, h, t, er) {
    let we = w;
    if (t > 0) we += (t / Math.PI) * (1 + Math.log(w / h > 1 / (2 * Math.PI) ? (2 * h) / t : (4 * Math.PI * w) / t));
    const u = we / h;
    let ee = (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + 12 / u, -0.5);
    if (u < 1) ee += ((er - 1) / 2) * 0.04 * (1 - u) * (1 - u);
    const z0 = u <= 1 ? (60 / Math.sqrt(ee)) * Math.log(8 / u + u / 4) : (120 * Math.PI) / (Math.sqrt(ee) * (u + 1.393 + 0.667 * Math.log(u + 1.444)));
    return { z0, eeff: ee };
  }
  // stripline between two planes h1 and h2 away (IPC-2141A, asymmetric as the parallel of two symmetric ones)
  function stripline(w, h1, h2, t, er) {
    const zs = b => (60 / Math.sqrt(er)) * Math.log((1.9 * b) / (0.8 * w + t));
    const a = zs(2 * h1 + t), b = zs(2 * h2 + t);
    return { z0: (2 * a * b) / (a + b), eeff: er };
  }
  function impedance(board, layer, w, gap) {
    const g = layerGeom(board, layer);
    let z0, zdiff = null, eeff;
    if (g.kind === "microstrip") {
      ({ z0, eeff } = microstrip(w, g.h, g.t, g.er));
      if (gap > 0) zdiff = 2 * z0 * (1 - 0.48 * Math.exp((-0.96 * gap) / g.h));
    } else {
      ({ z0, eeff } = stripline(w, g.h1, g.h2, g.t, g.er));
      if (gap > 0) zdiff = 2 * z0 * (1 - 0.347 * Math.exp((-2.9 * gap) / (g.h1 + g.h2 + g.t)));
    }
    // delay: ps per mm from the effective permittivity
    return Object.assign({ z0, zdiff, eeff, delay: Math.sqrt(eeff) * 3.3356 }, g);
  }
  // the width (mm) giving z0 Ω on layer; null when out of reach (0.05 to 10 mm)
  function widthFor(board, layer, z0) {
    let lo = 0.05, hi = 10;
    const z = w => impedance(board, layer, w).z0;
    if (z(lo) < z0 || z(hi) > z0) return null;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (z(m) > z0) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  // the edge gap (mm) giving zdiff Ω for width w; null when out of reach (0.05 to 10 mm)
  function gapFor(board, layer, w, zdiff) {
    let lo = 0.05, hi = 10;
    const z = g => impedance(board, layer, w, g).zdiff;
    if (z(lo) > zdiff || z(hi) < zdiff) return null;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (z(m) < zdiff) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  // routed copper length per net: the tracks' centre lines (vias not counted)
  function netLengths(conn) {
    const L = new Map();
    for (const it of conn.items) if (it.kind === "track" && it.net !== null && it.net !== "short") L.set(it.net, (L.get(it.net) || 0) + Math.hypot(it.s[2] - it.s[0], it.s[3] - it.s[1]));
    return L;
  }
  const idOf = names => { const m = new Map(); Object.entries(names || {}).forEach(([id, nm]) => m.set(nm, isNaN(+id) ? id : +id)); return m; };
  // the rules' pairs: { p, n (net ids), pn, nn (names), width, gap, skew } for both nets present
  function pairsOf(board, names) {
    const ids = idOf(names);
    return ((board.rules || {}).pairs || []).map(q => ({ ...q, pn: q.p, nn: q.n, p: ids.get(q.p), n: ids.get(q.n) })).filter(q => q.p !== undefined && q.n !== undefined);
  }
  function groupsOf(board, names) {
    const ids = idOf(names);
    return ((board.rules || {}).lengths || []).map(g => ({ ...g, ids: (g.nets || []).map(n => ids.get(n)).filter(v => v !== undefined) })).filter(g => g.ids.length > 1);
  }
  // nets named like a pair: X+ / X-, X_P / X_N, XP / XN (for the rules window's suggestions)
  function guessPairs(netNames) {
    const set = new Set(netNames), out = [];
    for (const nm of netNames) {
      for (const [a, b] of [["+", "-"], ["_P", "_N"], ["_p", "_n"], ["P", "N"]]) {
        if (nm.endsWith(a) && nm.length > a.length) { const o = nm.slice(0, -a.length) + b; if (set.has(o)) out.push([nm, o]); break; }
      }
    }
    return out;
  }
  // where a net's copper is, for a check's marker
  const where = (conn, net) => { const it = conn.items.find(x => x.kind === "track" && x.net === net) || conn.items.find(x => x.net === net); return it ? [(it.s[0] + it.s[2]) / 2, (it.s[1] + it.s[3]) / 2] : [0, 0]; };
  function drc(board, model, conn) {
    const out = [], names = model.names || {}, L = netLengths(conn), nm = n => names[n] || String(n);
    for (const q of pairsOf(board, names)) {
      const a = L.get(q.p) || 0, b = L.get(q.n) || 0, tol = q.skew > 0 ? +q.skew : 0.5;
      if (a && b && Math.abs(a - b) > tol + 1e-6) { const [x, y] = where(conn, a < b ? q.p : q.n); out.push({ kind: "skew", x, y, msg: `Pair ${q.pn} / ${q.nn}: ${a.toFixed(2)} and ${b.toFixed(2)} mm, ${Math.abs(a - b).toFixed(2)} mm apart (skew ${tol} mm at most): lengthen ${a < b ? q.pn : q.nn}` }); }
    }
    for (const g of groupsOf(board, names)) {
      const ls = g.ids.map(n => [n, L.get(n) || 0]).filter(([, l]) => l > 0); if (ls.length < 2) continue;
      const max = Math.max(...ls.map(([, l]) => l)), tol = g.tol > 0 ? +g.tol : 1;
      if (g.target > 0) ls.forEach(([n, l]) => { if (Math.abs(l - g.target) > tol + 1e-6) { const [x, y] = where(conn, n); out.push({ kind: "length", x, y, msg: `${nm(n)} is ${l.toFixed(2)} mm; length group "${g.name || "group"}" wants ${g.target} ± ${tol} mm` }); } });
      else ls.forEach(([n, l]) => { if (max - l > tol + 1e-6) { const [x, y] = where(conn, n); out.push({ kind: "length", x, y, msg: `${nm(n)} is ${l.toFixed(2)} mm, ${(max - l).toFixed(2)} mm shorter than the longest of length group "${g.name || "group"}" (${max.toFixed(2)} mm, ± ${tol} mm): add a meander` }); } });
    }
    return out;
  }
  // a path moved sideways by d (left of its direction for d > 0), corners mitred
  function offsetPath(pts, d) {
    const n = pts.length; if (n < 2) return pts.map(p => p.slice());
    const nrm = k => { const dx = pts[k + 1][0] - pts[k][0], dy = pts[k + 1][1] - pts[k][1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
    const out = [];
    for (let k = 0; k < n; k++) {
      if (k === 0 || k === n - 1) { const m = nrm(k === 0 ? 0 : n - 2); out.push([pts[k][0] + m[0] * d, pts[k][1] + m[1] * d]); continue; }
      const a = nrm(k - 1), b = nrm(k), s = [a[0] + b[0], a[1] + b[1]], dot = 1 + a[0] * b[0] + a[1] * b[1];
      if (dot < 1e-6) { out.push([pts[k][0] + a[0] * d, pts[k][1] + a[1] * d]); continue; }   // a U-turn: keep the first side
      out.push([pts[k][0] + (s[0] * d) / dot, pts[k][1] + (s[1] * d) / dot]);
    }
    return out.map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]);
  }
  // a serpentine on segment k of pts adding `extra` mm: bumps of amplitude A at pitch 2·s (s = the
  // gap between runs, centre to centre), 45° chamfers c = s / 4 on the outer corners, on side o.side (+1 left, -1 right),
  // with at least s clear of each end. o: { s, amax, side, smin }. The last amplitude is trimmed so the
  // added length is exact. A segment too short for runs s apart tries them closer, down to o.smin.
  function meander(pts, k, extra, o) {
    const A0 = pts[k], B0 = pts[k + 1], L = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]);
    if (!(extra > 0)) return { fail: "nothing to add" };
    const s = o.s, c = s / 4, amax = o.amax || 3 * s, side = o.side || 1, loss = 2 * c * (2 - Math.SQRT2);
    const closer = o.smin > 0 && s > o.smin + 1e-9 ? () => meander(pts, k, extra, Object.assign({}, o, { s: Math.max(o.smin, s * 0.85), amax })) : null;
    // n bumps span (2n - 1)·s, with s clear at each end
    const nMax = Math.floor((L - s) / (2 * s));
    if (nMax < 1) return closer ? closer() : { fail: `the segment is too short for a meander (${L.toFixed(2)} mm; ${(3 * s).toFixed(2)} mm at least)` };
    const per = 2 * amax - loss, n = Math.ceil(extra / per);
    if (n > nMax) return closer ? closer() : { fail: `not enough room: ${(nMax * per).toFixed(2)} mm at most on this segment, ${extra.toFixed(2)} mm wanted` };
    const A = (extra / n + loss) / 2;
    if (A < 2 * c) return meander(pts, k, extra, Object.assign({}, o, { s: s * 0.75 }));
    const e = [(B0[0] - A0[0]) / L, (B0[1] - A0[1]) / L], u = [-e[1] * side, e[0] * side];
    const at = (t, a) => [A0[0] + e[0] * t + u[0] * a, A0[1] + e[1] * t + u[1] * a];
    const t0 = (L - n * 2 * s + s) / 2, out = [];
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 2 * s;
      out.push(at(t, 0), at(t, A - c), at(t + c, A), at(t + s - c, A), at(t + s, A - c), at(t + s, 0));
    }
    const res = pts.slice(0, k + 1).concat(out, pts.slice(k + 1)).map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]);
    return { pts: res, n, A };
  }
  const pathLength = pts => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  // the part of a path from length a to length b along it (0 ≤ a < b ≤ its length)
  function subPath(pts, a, b) {
    const out = []; let run = 0;
    const at = (k, t) => [Math.round((pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t) * 1e4) / 1e4, Math.round((pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t) * 1e4) / 1e4];
    for (let k = 0; k + 1 < pts.length; k++) {
      const l = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]), r0 = run, r1 = run + l; run = r1;
      if (r1 < a - 1e-9 || l < 1e-9) continue;
      if (!out.length) out.push(at(k, Math.max(0, (a - r0) / l)));
      if (r1 >= b - 1e-9) { out.push(at(k, (b - r0) / l)); break; }
      out.push(pts[k + 1].slice());
    }
    return out;
  }
  root.BoardHs = { dielectrics, layerGeom, microstrip, stripline, impedance, widthFor, gapFor, netLengths, pairsOf, groupsOf, guessPairs, drc, offsetPath, meander, pathLength, subPath };
})(typeof window !== "undefined" ? window : globalThis);
