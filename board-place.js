/* =============================================================================
   BOARD DESIGN — placement repair for routing (no DOM, Node-testable). When Freerouting
   leaves connections unrouted, the parts near them are nudged so the next pass has room:
     movable(board, model, rats, opts)        -> [part keys]  the parts that may move
     nudge(board, model, keys, opts)          -> { moved, cost0, cost1, tried, taken }
   nudge moves the given parts in board.parts (shift on the 1.27 mm grid, turn by 90°, swap
   two parts of one footprint) by simulated annealing (TimberWolf, Sechen and
   Sangiovanni-Vincentelli 1985) on a cost of
     wire length (half-perimeter of each net's pads, high-voltage and heater nets double)
     + congestion (RUDY, Spindler and Johannes 2007: each net's wire, its pads' spanning
       tree, spread evenly over its pads' box; the squared excess over what a cell's
       tracks can carry on the board's layers, less what its pads take)
     + ratsnest crossings between nets (each a via, or a detour, for the router)
     + how far each part went from where it was (the layout stays the user's).
   A move is taken only when it keeps the rules the design-rule check asks of a part:
   inside the outline, courtyards apart, clear of mounting holes and part keep-outs,
   electrolytics away from hot parts, pads the clearance (by voltage) from other nets'
   pads and from locked copper. Nets with a pour, and the ground with star grounding,
   reach their pads through the pour: they count little and cross nothing.
   Depends on: board-core.js
   ============================================================================= */
(function (root) {
  "use strict";
  const B = () => root.BoardCore;
  const GRID = 1.27, CELL = 2.54;
  // parts that stay where the user put them: valves, transformers, controls, connectors, things on panels
  const FIXED = new Set(["tube", "gasreg", "neon", "eye", "opt_se", "opt_cat", "opt_pp", "ptx", "ptx_cat", "itx", "pot", "switch", "spst", "rotary", "jack", "iec", "terminal", "header", "faston", "fuse", "heater", "star"]);
  const BIG = 1200;   // mm² of courtyard: bigger parts stay too

  // a seeded random source (mulberry32): the same board and seed give the same moves
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // distance from segment s to box b (0 when they meet)
  function segBox(s, b) {
    const C = B(), inB = (x, y) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
    if (inB(s[0], s[1]) || inB(s[2], s[3])) return 0;
    const P = C.boxPoly(b);
    return Math.min(...P.map((p, i) => { const q = P[(i + 1) % 4]; return C.segSeg(s, [p[0], p[1], q[0], q[1]]); }));
  }
  const area = b => (b.x2 - b.x1) * (b.y2 - b.y1);
  const inside = (b, o) => [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2]].every(([x, y]) => B().edgeDist(x, y, o) >= 0.25);

  /** The parts that may move to make room for the unrouted connections (rats: the ratsnest
      lines left): on the board, not locked, not a valve, transformer, control or connector,
      not huge, and within opts.radius (mm, default 8) of an unrouted line */
  function movable(board, model, rats, opts) {
    const o = opts || {}, R = o.radius || 8, C = B();
    return model.parts.filter(g => {
      if (!g.place || !g.fp || g.place.locked || FIXED.has(g.type)) return false;
      const b = C.partBox(g);
      if (area(b) > BIG || !inside(b, board.outline)) return false;
      return rats.some(r => segBox([r.x1, r.y1, r.x2, r.y2], b) <= R);
    }).map(g => g.key);
  }

  /** Nudge the parts keys (in board.parts) by simulated annealing; model: BoardCore.model of the
      board as it is. opts: { clr: BoardCore.clearanceRules, hv: Set of high-voltage nets,
      netlist (for hot parts), conn: BoardCore.connectivity (locked copper), seed, moves,
      weights: { wire, crowd, cross, move }, reach: how far (mm) a part may go }. The best placement found is left in
      board.parts. Returns { moved: [{ key, ref, from, to }], cost0, cost1, tried, taken } */
  function nudge(board, model, keys, opts) {
    const C = B(), o = opts || {}, R = board.rules, outl = board.outline, rand = rng(o.seed === undefined ? 1 : o.seed);
    const W = Object.assign({ wire: 1, crowd: 0.25, cross: 4, move: 0.4 }, o.weights || {});
    const parts = model.parts.filter(g => g.place && g.fp), byKey = new Map(parts.map(g => [g.key, g]));
    const mov = keys.map(k => byKey.get(k)).filter(Boolean);
    if (!mov.length) return { moved: [], cost0: 0, cost1: 0, tried: 0, taken: 0 };
    const pl = new Map(parts.map(g => [g.key, { ...g.place }]));      // the trial placements
    const start = new Map(mov.map(g => [g.key, { ...g.place }]));
    const onB = new Set(parts.filter(g => inside(C.partBox(g), outl)).map(g => g.key));
    // pads: each part's in footprint order, with their nets
    const padsOf = new Map(); model.pads.forEach(p => { if (!padsOf.has(p.part)) padsOf.set(p.part, []); padsOf.get(p.part).push(p); });
    const local = new Map(parts.map(g => [g.key, g.fp.pads]));
    const where = (k, i) => { const q = local.get(k)[i], P = pl.get(k), [x, y] = C.place([q.x, q.y], P), odd = (P.rot || 0) & 1; return { x, y, w: odd ? q.h : q.w, h: odd ? q.w : q.h, shape: q.shape }; };
    const boxOf = k => C.partBox({ fp: byKey.get(k).fp, place: pl.get(k) });
    // nets: their pads (part key, index) and how much they count
    const poured = new Set((board.zones || []).map(z => z.net)), names = model.names;
    const nets = new Map();
    parts.forEach(g => (padsOf.get(g.key) || []).forEach((p, i) => { if (p.net === null || !onB.has(g.key)) return; if (!nets.has(p.net)) nets.set(p.net, []); nets.get(p.net).push([g.key, i]); }));
    [...nets.keys()].forEach(n => { if (nets.get(n).length < 2) nets.delete(n); });
    const netList = [...nets.keys()], nIdx = new Map(netList.map((n, i) => [n, i]));
    const quiet = netList.map(n => { const nm = names[n] || String(n); return poured.has(nm) || (R.ground === "star" && nm === "GND"); });
    const weight = netList.map((n, i) => (quiet[i] ? 0.2 : (o.hv && o.hv.has(n)) || C.isHeaterNet(names[n]) ? 2 : 1));
    const netsOfPart = new Map(parts.map(g => [g.key, [...new Set((padsOf.get(g.key) || []).filter(p => nIdx.has(p.net)).map(p => nIdx.get(p.net)))]]));
    // each net's shape: box, spanning tree (segments) and its length
    function shape(ni) {
      const pts = nets.get(netList[ni]).map(([k, i]) => where(k, i));
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      pts.forEach(p => { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); });
      const segs = []; let len = 0;
      if (!quiet[ni] && pts.length <= 40) {
        const inT = [0], d = pts.map((p, j) => (j ? Math.hypot(p.x - pts[0].x, p.y - pts[0].y) : Infinity)), from = pts.map(() => 0), done = pts.map((_, j) => j === 0);
        for (let s = 1; s < pts.length; s++) {
          let j = -1; for (let q = 0; q < pts.length; q++) if (!done[q] && (j < 0 || d[q] < d[j])) j = q;
          done[j] = true; inT.push(j); len += d[j]; segs.push([pts[from[j]].x, pts[from[j]].y, pts[j].x, pts[j].y]);
          for (let q = 0; q < pts.length; q++) if (!done[q]) { const e = Math.hypot(pts[q].x - pts[j].x, pts[q].y - pts[j].y); if (e < d[q]) { d[q] = e; from[q] = j; } }
        }
      }
      return { x1, y1, x2, y2, hp: (x2 - x1) + (y2 - y1), segs, len };
    }
    const shapes = netList.map((_, i) => shape(i));
    // congestion: wire demand and track capacity per cell
    const nx = Math.max(1, Math.ceil(outl.w / CELL)), ny = Math.max(1, Math.ceil(outl.h / CELL)), demand = new Float64Array(nx * ny), cap = new Float64Array(nx * ny);
    const pitch = Math.max(0.2, (R.track || 0.5) + (R.clearance || 0.3)), layers = C.COPPER.length;
    cap.fill(layers * CELL * CELL / pitch);
    function spread(ni, sign) {
      const s = shapes[ni]; if (quiet[ni] || !s.len) return;
      const bx1 = s.x1 - pitch, by1 = s.y1 - pitch, bx2 = s.x2 + pitch, by2 = s.y2 + pitch, dens = s.len / ((bx2 - bx1) * (by2 - by1));
      const i1 = Math.max(0, Math.floor(bx1 / CELL)), i2 = Math.min(nx - 1, Math.floor(bx2 / CELL)), j1 = Math.max(0, Math.floor(by1 / CELL)), j2 = Math.min(ny - 1, Math.floor(by2 / CELL));
      for (let j = j1; j <= j2; j++) for (let i = i1; i <= i2; i++) {
        const ov = (Math.min(bx2, (i + 1) * CELL) - Math.max(bx1, i * CELL)) * (Math.min(by2, (j + 1) * CELL) - Math.max(by1, j * CELL));
        if (ov > 0) demand[j * nx + i] += sign * dens * ov;
      }
    }
    function block(k, sign) {
      if (!onB.has(k)) return;
      local.get(k).forEach((q, i) => {
        const p = where(k, i), ci = Math.floor(p.x / CELL), cj = Math.floor(p.y / CELL);
        if (ci < 0 || cj < 0 || ci >= nx || cj >= ny) return;
        cap[cj * nx + ci] -= sign * (q.smd ? 1 : layers) * (p.w + pitch) * (p.h + pitch) / pitch;
      });
    }
    netList.forEach((_, i) => spread(i, 1));
    parts.forEach(g => block(g.key, 1));
    const overflow = () => { let s = 0; for (let c = 0; c < demand.length; c++) { const e = demand[c] - cap[c]; if (e > 0) s += e * e; } return s; };
    // ratsnest crossings, net against net (box test first)
    const crossSeg = (a, b) => {
      const o1 = (b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0]), o2 = (b[2] - a[0]) * (a[3] - a[1]) - (b[3] - a[1]) * (a[2] - a[0]);
      const o3 = (a[0] - b[0]) * (b[3] - b[1]) - (a[1] - b[1]) * (b[2] - b[0]), o4 = (a[2] - b[0]) * (b[3] - b[1]) - (a[3] - b[1]) * (b[2] - b[0]);
      return o1 * o2 < -1e-9 && o3 * o4 < -1e-9;
    };
    function crossPair(a, b) {
      const A = shapes[a], Bs = shapes[b];
      if (!A.segs.length || !Bs.segs.length || A.x2 < Bs.x1 || Bs.x2 < A.x1 || A.y2 < Bs.y1 || Bs.y2 < A.y1) return 0;
      let n = 0; A.segs.forEach(s => Bs.segs.forEach(t => { if (crossSeg(s, t)) n++; })); return n;
    }
    function crossInvolving(set) {
      let n = 0;
      set.forEach(a => { for (let b = 0; b < netList.length; b++) if (!(set.has(b) && b <= a) && b !== a) n += crossPair(a, b); });
      return n;
    }
    let crossings = 0; for (let a = 0; a < netList.length; a++) for (let b = a + 1; b < netList.length; b++) crossings += crossPair(a, b);
    let wire = shapes.reduce((s, sh, i) => s + weight[i] * sh.hp, 0), over = overflow();
    const disp = k => { const a = start.get(k), b = pl.get(k); return a ? Math.hypot(b.x - a.x, b.y - a.y) + (((b.rot || 0) - (a.rot || 0)) & 3 ? 1 : 0) : 0; };
    let dsum = 0;
    const cost = () => W.wire * wire + W.crowd * over + W.cross * crossings + W.move * dsum;
    // the rules a part's new place must keep
    const hot = new Map(parts.map(g => [g.key, g.type === "electrolytic" ? "cap" : C.hotWhy(g, o.netlist, R) ? "hot" : ""]));
    const heat = R.heatGap > 0 ? R.heatGap : 10, gapC = 0.25;
    const locked = [];
    if (o.conn) o.conn.items.forEach(it => { if ((it.kind === "track" && board.tracks[it.ti] && board.tracks[it.ti].locked) || (it.kind === "via" && board.vias[it.vi] && board.vias[it.vi].locked)) locked.push(it); });
    const needC = (a, b) => (o.clr ? o.clr.need(a, b).c : Math.max(R.clearance || 0.3, 0.3));
    function legal(k) {
      const b = boxOf(k), g = byKey.get(k), side = pl.get(k).side || "F";
      if (!inside(b, outl)) return false;
      for (const q of parts) {
        if (q.key === k || !onB.has(q.key)) continue;
        const c = boxOf(q.key), hk = hot.get(k), hq = hot.get(q.key), gp = (hk === "cap" && hq === "hot") || (hk === "hot" && hq === "cap") ? heat + 0.5 : (pl.get(q.key).side || "F") === side ? gapC : -1;
        if (gp >= 0 && b.x1 < c.x2 + gp && b.x2 > c.x1 - gp && b.y1 < c.y2 + gp && b.y2 > c.y1 - gp) return false;
      }
      for (const h of board.holes || []) { const r = h.d / 2 + 1.9, dx = Math.max(b.x1 - h.x, 0, h.x - b.x2), dy = Math.max(b.y1 - h.y, 0, h.y - b.y2); if (Math.hypot(dx, dy) < r) return false; }
      for (const ko of board.keepouts || []) if (ko.parts && C.polyHitsPoly(C.boxPoly(b), ko.pts)) return false;
      // pads: the edge, other parts' pads of other nets, locked copper
      const mine = (padsOf.get(k) || []).map((p, i) => { const w = where(k, i); return { net: p.net, layers: p.smd ? [side + ".Cu"] : C.COPPER, ...C.padCapsule(w), x: w.x, y: w.y, rr: Math.max(w.w, w.h) / 2 }; });
      if (mine.some(m => C.edgeDist(m.x, m.y, outl) < (R.edgeClearance || 0.5) + m.rr)) return false;
      for (const q of parts) {
        if (q.key === k || !onB.has(q.key)) continue;
        const c = boxOf(q.key); if (c.x1 > b.x2 + 6 || c.x2 < b.x1 - 6 || c.y1 > b.y2 + 6 || c.y2 < b.y1 - 6) continue;
        const qs = pl.get(q.key).side || "F";
        for (let i = 0; i < local.get(q.key).length; i++) {
          const pq = padsOf.get(q.key)[i], w = where(q.key, i), cq = C.padCapsule(w), ql = pq.smd ? [qs + ".Cu"] : C.COPPER;
          for (const m of mine) {
            if (m.net !== null && m.net === pq.net) continue;
            if (!m.layers.some(L => ql.includes(L))) continue;
            if (C.segSeg(m.s, cq.s) - m.r - cq.r < needC(m.net, pq.net) - 1e-6) return false;
          }
        }
      }
      for (const it of locked) for (const m of mine) {
        if (it.net === m.net || !m.layers.some(L => it.layers.includes(L))) continue;
        if (C.segSeg(m.s, it.s) - m.r - it.r < needC(m.net, it.net) - 1e-6) return false;
      }
      return !!g;
    }
    // apply a change to some parts' places, keeping every sum up to date; returns the undo
    function apply(changes) {
      const ks = changes.map(c => c.k), touched = new Set(ks.flatMap(k => netsOfPart.get(k) || []));
      const before = { wire, over, crossings, dsum, shapes: new Map([...touched].map(i => [i, shapes[i]])), places: changes.map(c => ({ k: c.k, p: pl.get(c.k) })) };
      crossings -= crossInvolving(touched);
      touched.forEach(i => { spread(i, -1); wire -= weight[i] * shapes[i].hp; });
      ks.forEach(k => { block(k, -1); dsum -= disp(k); });
      changes.forEach(c => pl.set(c.k, c.p));
      ks.forEach(k => { block(k, 1); dsum += disp(k); });
      touched.forEach(i => { shapes[i] = shape(i); spread(i, 1); wire += weight[i] * shapes[i].hp; });
      crossings += crossInvolving(touched);
      over = overflow();
      return () => {
        touched.forEach(i => spread(i, -1)); ks.forEach(k => block(k, -1));
        before.places.forEach(({ k, p }) => pl.set(k, p));
        before.shapes.forEach((s, i) => { shapes[i] = s; spread(i, 1); }); ks.forEach(k => block(k, 1));
        wire = before.wire; over = before.over; crossings = before.crossings; dsum = before.dsum;
      };
    }
    // a random move: shift (up to `reach` grid steps), turn about the part's middle, or swap two alike
    const snap = v => Math.round(v / GRID) * GRID;
    function propose(reach) {
      const g = mov[Math.floor(rand() * mov.length)], P = pl.get(g.key), r = rand();
      if (r < 0.15) {
        const twins = mov.filter(q => q !== g && q.fp.name === g.fp.name && (pl.get(q.key).side || "F") === (P.side || "F"));
        if (twins.length) { const q = twins[Math.floor(rand() * twins.length)], Q = pl.get(q.key); return [{ k: g.key, p: { ...P, x: Q.x, y: Q.y, rot: Q.rot } }, { k: q.key, p: { ...Q, x: P.x, y: P.y, rot: P.rot } }]; }
      }
      if (r < 0.3) {
        const b = boxOf(g.key), cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, rot = ((P.rot || 0) + (rand() < 0.5 ? 1 : 3)) & 3;
        const nb = C.partBox({ fp: g.fp, place: { ...P, rot } });
        return [{ k: g.key, p: { ...P, rot, x: snap(P.x + cx - (nb.x1 + nb.x2) / 2), y: snap(P.y + cy - (nb.y1 + nb.y2) / 2) } }];
      }
      const step = () => Math.round((rand() * 2 - 1) * reach) * GRID;
      let dx = step(), dy = step(); if (!dx && !dy) dx = rand() < 0.5 ? GRID : -GRID;
      return [{ k: g.key, p: { ...P, x: +(P.x + dx).toFixed(4), y: +(P.y + dy).toFixed(4) } }];
    }
    const cost0 = cost();
    const N = o.moves || Math.min(6000, Math.max(600, 250 * mov.length));
    // the starting temperature: most uphill moves taken at first
    let ups = 0, nUp = 0;
    for (let s = 0; s < 40; s++) { const ch = propose(4), c0 = cost(), undo = apply(ch); const d = cost() - c0; undo(); if (d > 0) { ups += d; nUp++; } }
    const T0 = nUp ? -(ups / nUp) / Math.log(0.6) : 1, T1 = T0 * 0.002;
    let T = T0, cur = cost(), best = cur, bestPl = new Map(mov.map(g => [g.key, pl.get(g.key)])), tried = 0, taken = 0;
    const cool = Math.pow(T1 / T0, 1 / N);
    for (let s = 0; s < N; s++, T *= cool) {
      const reach = Math.max(1, Math.round(5 * T / T0 + 0.5)), ch = propose(reach), undo = apply(ch); tried++;
      if (!ch.every(c => legal(c.k) && (!o.reach || Math.hypot(pl.get(c.k).x - start.get(c.k).x, pl.get(c.k).y - start.get(c.k).y) <= o.reach))) { undo(); continue; }
      const c = cost(), d = c - cur;
      if (d <= 0 || rand() < Math.exp(-d / T)) { cur = c; taken++; if (c < best - 1e-9) { best = c; bestPl = new Map(mov.map(g => [g.key, pl.get(g.key)])); } }
      else undo();
    }
    // the best placement goes on the board
    const moved = [];
    mov.forEach(g => {
      const a = start.get(g.key), b = bestPl.get(g.key);
      if (Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.y - b.y) > 1e-6 || ((a.rot || 0) & 3) !== ((b.rot || 0) & 3)) {
        Object.assign(board.parts[g.key], { x: b.x, y: b.y, rot: b.rot });
        moved.push({ key: g.key, ref: g.ref, from: { x: a.x, y: a.y, rot: a.rot || 0 }, to: { x: b.x, y: b.y, rot: b.rot || 0 } });
      }
    });
    return { moved, cost0, cost1: best, tried, taken };
  }

  /** "R7 2.5 mm, C3 turned 90°": what nudge moved, in words */
  function describe(moved) {
    return moved.map(m => {
      const d = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y), t = ((m.to.rot - m.from.rot) & 3) * 90, bits = [];
      if (d > 1e-6) bits.push(`${+d.toFixed(1)} mm`);
      if (t) bits.push(`turned ${t === 270 ? 90 : t}°`);
      return `${m.ref} ${bits.join(", ")}`;
    }).join(", ");
  }

  root.BoardPlace = { movable, nudge, describe, FIXED, rng };
})(typeof window !== "undefined" ? window : globalThis);
