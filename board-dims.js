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
  const KINDS = ["dx", "dy", "dist", "pl", "hz", "vt"];
  const NAMES = { dx: "Horizontal dimension", dy: "Vertical dimension", dist: "Aligned dimension", pl: "Distance to a line", hz: "Aligned horizontally", vt: "Aligned vertically" };
  const HAS_VALUE = { dx: true, dy: true, dist: true, pl: true, hz: false, vt: false };
  const LINE_T = new Set(["edge", "koe", "cl"]);
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
  function bodyPos(board, key) { const o = objOfBody(board, key); if (!o) return null; return o.pts ? [o.pts[0][0], o.pts[0][1]] : [o.x, o.y]; }
  /** a body slid by dx, dy (board frame) */
  function moveBody(board, key, dx, dy) {
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
    const find = (l, id) => (board[l] || []).find(q => q && q.id === id);
    const fromU = p => (p ? [p[0], H - p[1]] : null);
    // each pad's place on its part, from the model built for the board as it is now (a part only slides)
    const padOff = new Map();
    if (model) model.pads.forEach(pd => { const bp = board.parts && board.parts[pd.part]; if (bp) padOff.set(pd.part + "|" + pd.num, [pd.x - bp.x, pd.y - bp.y]); });
    // a point feature: [x, y] with the body's slide added; null when it is gone
    function point(f, T) {
      if (!f) return null;
      const body = bodyOf(board, f), t = (body && T && T.get(body)) || [0, 0];
      let p = null;
      switch (f.t) {
        case "origin": return [0, H];
        case "board": {
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
      if (f.t === "edge") return [[0, H, o.w, H], [o.w, H, o.w, 0], [o.w, 0, 0, 0], [0, 0, 0, H]][f.k] || null;
      if (f.t === "koe") {
        const k = find("keepouts", f.id); if (!k || !k.pts.length) return null;
        const body = bodyOf(board, f), t = (body && T && T.get(body)) || [0, 0], a = k.pts[(f.k || 0) % k.pts.length], b = k.pts[((f.k || 0) + 1) % k.pts.length];
        return [a[0] + t[0], a[1] + t[1], b[0] + t[0], b[1] + t[1]];
      }
      if (f.t === "cl") { const c = csol && csol.curve(f.g); return c && c.t === "L" ? [c.x1, H - c.y1, c.x2, H - c.y2] : null; }
      return null;
    }
    return { board, model, csol, point, line, H };
  }

  // the residual of a dimension (board frame inside, values in the user frame); null when a feature is gone
  function residual(env, d, T) {
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
    const board = env.board, ka = bodyOf(board, d.a), kb = bodyOf(board, d.b), out = [];
    const put = (k, gx, gy) => { if (k) out.push([k, gx, gy]); };
    switch (d.k) {
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
  const bodiesOf = (board, d) => [bodyOf(board, d.a), bodyOf(board, d.b)].filter(Boolean);

  // ---------------------------------------------------------------------------
  // Linear algebra (small, dense)
  // ---------------------------------------------------------------------------
  // A x = b by elimination with partial pivoting; rows with no pivot (dependent equations) get x = 0
  function solveSym(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat([b[i]])), piv = [], scale = Math.max(1e-30, ...A.map((r, i) => Math.abs(r[i])));
    let row = 0; const col = [];
    for (let c = 0; c < n && row < n; c++) {
      let best = row; for (let r = row + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[best][c])) best = r;
      if (Math.abs(M[best][c]) < 1e-11 * scale) continue;
      [M[row], M[best]] = [M[best], M[row]];
      for (let r = 0; r < n; r++) if (r !== row) { const f = M[r][c] / M[row][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[row][k]; }
      col[row] = c; piv.push(c); row++;
    }
    const x = new Array(n).fill(0);
    for (let r = 0; r < row; r++) x[col[r]] = M[r][n] / M[r][col[r]];
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
      const r = solve(board, model, { ...opts, held: others });
      if (r.ok) return r;
      return solve(board, model, { ...opts, held: new Set() });
    }
    return solveHeld(board, model, opts, opts.held || new Set());
  }
  function solveHeld(board, model, opts, held) {
    normalise(board);
    const env = makeEnv(board, model, opts.csol);
    const dims = (opts.only || board.dims.items).filter(d => !d.ref);
    const lost = [], rows = [];
    dims.forEach(d => { if (residual(env, d, null) === null) lost.push(d.id); else rows.push(d); });
    // the unknowns: tx, ty of each body some dimension touches
    const keys = []; rows.forEach(d => bodiesOf(board, d).forEach(k => { if (!keys.includes(k) && !held.has(k)) keys.push(k); }));
    const n = keys.length * 2, idx = new Map(keys.map((k, i) => [k, i]));
    const prefer = opts.prefer || new Set();
    const heavy = opts.heavy || new Set();
    const w = keys.flatMap(k => { const v = heavy.has(k) ? 1e6 : prefer.size ? (prefer.has(k) ? 1 : 1e4) : 1; return [v, v]; });
    const q = new Array(n).fill(0);
    const Tof = qq => new Map(keys.map((k, i) => [k, [qq[2 * i], qq[2 * i + 1]]]));
    const F = qq => { const T = Tof(qq); return rows.map(d => residual(env, d, T)); };
    const jac = qq => {
      const T = Tof(qq);
      return rows.map(d => { const r = new Array(n).fill(0); grad(env, d, T).forEach(([k, gx, gy]) => { const i = idx.get(k); if (i === undefined) return; r[2 * i] += gx; r[2 * i + 1] += gy; }); return r; });
    };
    const norm = f => f.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    let f = F(q), err = norm(f), it = 0;
    const maxIt = opts.iterations || 60;
    while (err > TOL && it++ < maxIt && rows.length) {
      const J = jac(q), m = rows.length;
      // the step of least weighted change: (J W⁻¹ Jᵀ) μ = F − J r, Δ = −r − W⁻¹ Jᵀ μ, r = q − q0 (q0 = 0)
      const nz = J.map(r => { const l = []; r.forEach((v, c) => { if (v) l.push(c); }); return l; });
      const A = Array.from({ length: m }, () => new Array(m).fill(0));
      for (let i = 0; i < m; i++) for (let j = i; j < m; j++) { let s = 0; for (const c of nz[i]) if (J[j][c]) s += J[i][c] * J[j][c] / w[c]; A[i][j] = A[j][i] = s; }
      const rhs = f.map((fi, i) => { let s = fi; for (let c = 0; c < n; c++) s -= J[i][c] * q[c]; return s; });
      const mu = solveSym(A, rhs);
      const step = q.map((qc, c) => { let s = 0; for (let i = 0; i < m; i++) s += J[i][c] * mu[i]; return -qc - s / w[c]; });
      // halve the step while it makes things worse (a distance far from where it started)
      let a = 1, q2, f2, e2;
      for (let k = 0; k < 12; k++) { q2 = q.map((v, c) => v + a * step[c]); f2 = F(q2); e2 = norm(f2); if (e2 < err || e2 <= TOL) break; a /= 2; }
      if (!(e2 < err) && e2 > TOL) break;   // no progress: these equations cannot all be met
      for (let c = 0; c < n; c++) q[c] = q2[c];
      f = f2; err = e2;
    }
    const T = Tof(q), bad = rows.filter((d, i) => Math.abs(f[i]) > 1e-4).map(d => d.id);
    return { ok: err <= 1e-4, T, bad, lost, err, keys, rows, q, env };
  }
  /** the rank test: does the dimension add an equation, or is it already implied by the others? */
  function redundant(board, model, dim, csol) {
    const env = makeEnv(board, model, csol), driving = board.dims.items.filter(d => !d.ref && d !== dim && residual(env, d, null) !== null);
    const keys = []; driving.concat([dim]).forEach(d => bodiesOf(board, d).forEach(k => { if (!keys.includes(k)) keys.push(k); }));
    if (!bodiesOf(board, dim).length) return true;   // nothing it touches can move
    const J = jacobian(env, driving.concat([dim]), keys);
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
    const keys = []; board.dims.items.forEach(d => bodiesOf(board, d).forEach(k => { if (!keys.includes(k)) keys.push(k); }));
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
      case "cp": return "a construction point";
      case "cl": return "a construction line";
      default: return "?";
    }
  }
  function describe(board, model, d) {
    const A = featureName(board, model, d.a), Bn = featureName(board, model, d.b), v = Math.abs(+d.v || 0).toFixed(2);
    switch (d.k) {
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

  root.BoardDims = { KINDS, NAMES, HAS_VALUE, EDGE_NAMES, normalise, newId, textId, isLine, bodyOf, featBody, objOfBody, bodyPos, moveBody, makeEnv, residual, grad, measure, signedDist, solve, redundant, freedom, featureName, describe, onBody, rowBasis, solveSym };
})(typeof window !== "undefined" ? window : globalThis);
